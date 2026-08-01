const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

function loadInternals() {
  const filename = path.join(__dirname, "..", "patch-core.js");
  const source = fs.readFileSync(filename, "utf8").replace(
    "module.exports = { run };",
    "module.exports = { run, chip, TRANSCRIPT_PROBE };",
  );
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require,
    __filename: filename,
    __dirname: path.dirname(filename),
    console,
  });
  return module.exports;
}

function loadChip() {
  return loadInternals().chip;
}

function runProbe(entries, { sessionId = "session-1", cwd = "/tmp/probe-project" } = {}) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-status-probe-"));
  const projectDir = path.join(
    configDir,
    "projects",
    cwd.replace(/[^A-Za-z0-9]/g, "-"),
  );
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, `${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  try {
    return childProcess.execFileSync(
      process.execPath,
      ["-e", loadInternals().TRANSCRIPT_PROBE, sessionId, cwd],
      {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
      },
    ).trim();
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

test("transcript probe returns latest main assistant context tokens", () => {
  const stdout = runProbe([
    {
      type: "assistant",
      message: {
        role: "assistant",
        model: "older-model",
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    },
    {
      type: "assistant",
      isSidechain: true,
      message: {
        role: "assistant",
        model: "sidechain-model",
        usage: { input_tokens: 999, output_tokens: 999 },
      },
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        model: "<synthetic>",
        usage: { input_tokens: 888, output_tokens: 888 },
      },
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        model: "xopglm51",
        usage: {
          input_tokens: 70000,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 2000,
          output_tokens: 4000,
        },
      },
    },
  ]);

  assert.deepEqual(JSON.parse(stdout), { kind: "usage", totalTokens: 77000 });
});

test("transcript probe prefers compact postTokens over older assistant usage", () => {
  const stdout = runProbe([
    {
      type: "assistant",
      message: {
        role: "assistant",
        model: "xopglm51",
        usage: { input_tokens: 80000, output_tokens: 3146 },
      },
    },
    {
      type: "system",
      subtype: "compact_boundary",
      compactMetadata: {
        preTokens: 83146,
        postTokens: 6750,
        cumulativeDroppedTokens: 76396,
      },
    },
  ]);

  assert.deepEqual(JSON.parse(stdout), { kind: "compact", totalTokens: 6750 });
});

test("transcript probe derives compact tokens when postTokens is absent", () => {
  const stdout = runProbe([
    {
      type: "system",
      subtype: "compact_boundary",
      compactMetadata: { preTokens: 83146, cumulativeDroppedTokens: 76396 },
    },
  ]);

  assert.deepEqual(JSON.parse(stdout), { kind: "compact", totalTokens: 6750 });
});

test("transcript probe prefers newer assistant usage after compact", () => {
  const stdout = runProbe([
    {
      type: "system",
      subtype: "compact_boundary",
      compactMetadata: { postTokens: 6750 },
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        model: "xopglm51",
        usage: { input_tokens: 7000, output_tokens: 500 },
      },
    },
  ]);

  assert.deepEqual(JSON.parse(stdout), { kind: "usage", totalTokens: 7500 });
});

test("transcript probe ignores invalid session ids", () => {
  assert.equal(runProbe([], { sessionId: "../escape" }), "");
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function makeSession() {
  const signalPrototype = {};
  Object.defineProperty(signalPrototype, "value", {
    get() { return this.current; },
    set(value) { this.current = value; },
    configurable: true,
  });
  const usageData = Object.create(signalPrototype);
  usageData.current = { contextWindow: 200000, totalTokens: 1000, totalCost: 0 };
  const processedMessages = [];
  return {
    usageData,
    processedMessages,
    processMessage(event) {
      processedMessages.push({ event, receiver: this });
      if (event.type === "assistant" && !event.parent_tool_use_id && event.message?.usage) {
        const usage = event.message.usage;
        const totalTokens = (usage.input_tokens || 0)
          + (usage.cache_creation_input_tokens || 0)
          + (usage.cache_read_input_tokens || 0)
          + (usage.output_tokens || 0);
        this.usageData.value = { ...this.usageData.value, totalTokens };
      } else if (event.type === "system" && event.subtype === "compact_boundary") {
        this.usageData.value = { ...this.usageData.value, totalTokens: 0 };
      } else if (event.type === "system" && event.subtype === "init" && event.session_id) {
        this.sessionId.value = event.session_id;
        this.usageData.value = {
          ...this.usageData.value,
          totalTokens: 0,
          totalCost: 0,
        };
      }
      return "original-result";
    },
    sessionId: { value: "session-1" },
    cwd: { value: "/tmp/probe-project" },
    busy: { value: false },
    connection: { value: null },
    currentMainLoopModel: { value: "claude-sonnet-4-8" },
    gitBranch: { value: "main" },
    worktree: { value: null },
    messages: { value: [{}] },
    modelSelection: { value: "default" },
    effortLevel: { value: "medium" },
    thinkingLevel: { value: "off" },
  };
}

function contextPill(result) {
  return result.props.children.find(
    (child) => child.props && child.props["data-seg"] === "ctx",
  );
}

test("stream usage updates context while preserving confirmed cache", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  const startResult = sess.processMessage({
    type: "stream_event",
    parent_tool_use_id: null,
    event: {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 70000,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 2000,
          output_tokens: 0,
        },
      },
    },
  });
  sess.processMessage({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "message_delta", usage: { output_tokens: 4000 } },
  });
  sess.processMessage({
    type: "stream_event",
    parent_tool_use_id: "tool-1",
    event: {
      type: "message_start",
      message: { usage: { input_tokens: 999999, output_tokens: 0 } },
    },
  });
  const result = render(jsx, sess, browserWindow, () => 1, immediateTimeout);

  assert.equal(startResult, "original-result");
  assert.equal(sess.processedMessages.length, 3);
  assert.equal(sess.processedMessages[0].receiver, sess);
  assert.equal(sess.__cpLiveT, 77000);
  assert.equal(sess.__cpLiveActive, true);
  assert.equal(sess.__cpLastT, 1000);
  assert.match(contextPill(result).props.title, /^77k\/200k \(39%\)/);
});

test("stream UTF-8 fallback estimates output and a new message_start replaces its base", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.processMessage({
    type: "stream_event",
    event: {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
        },
      },
    },
  });
  sess.processMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "abc" } },
  });
  sess.processMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "你" } },
  });
  sess.processMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
  });

  assert.equal(sess.__cpLiveT, 1003);
  assert.equal(sess.__cpLastT, 1000);

  sess.processMessage({
    type: "stream_event",
    event: {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 90000,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 4000,
          output_tokens: 0,
        },
      },
    },
  });
  sess.processMessage({
    type: "stream_event",
    event: { type: "message_delta", usage: { output_tokens: 500 } },
  });

  assert.equal(sess.__cpLiveT, 95500);
  assert.equal(sess.__cpLastT, 1000);
});

test("stream refresh throttle coalesces deltas within 100ms", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const timers = [];
  const fakeTimeout = (fn, delay) => {
    timers.push({ fn, delay });
    return timers.length;
  };
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;

  try {
    render(
      jsx,
      sess,
      { __cpStatus: { customCW: () => 0 } },
      () => 1,
      fakeTimeout,
    );
    sess.processMessage({
      type: "stream_event",
      event: { type: "message_start", message: {} },
    });
    for (const text of ["abc", "def", "ghi"]) {
      sess.processMessage({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text } },
      });
    }

    assert.equal(timers.length, 1);
    now += 100;
    timers.shift().fn();
    assert.equal(sess.__cpLiveT, 1003);
    assert.equal(sess.__cpLastT, 1000);
  } finally {
    Date.now = originalNow;
  }
});

test("native assistant usage replaces live context", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.processMessage({
    type: "stream_event",
    event: {
      type: "message_start",
      message: { usage: { input_tokens: 70000, cache_read_input_tokens: 3000 } },
    },
  });
  sess.processMessage({
    type: "content_block_delta",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "draft" } },
  });
  assert.equal(sess.__cpLiveActive, true);

  sess.processMessage({
    type: "assistant",
    message: {
      role: "assistant",
      model: "xopglm51",
      usage: {
        input_tokens: 70000,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 2000,
        output_tokens: 4500,
      },
      content: [],
    },
  });

  assert.equal(sess.usageData.value.totalTokens, 77500);
  assert.equal(sess.__cpLastT, 77500);
  assert.equal(sess.__cpLiveActive, false);
});

test("invalid native assistant usage does not discard live context", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const immediateTimeout = (fn) => fn();

  render(
    jsx,
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
    immediateTimeout,
  );
  sess.processMessage({
    type: "stream_event",
    event: { type: "message_start", message: { usage: { input_tokens: 70000 } } },
  });
  sess.processMessage({
    type: "assistant",
    message: {
      role: "assistant",
      model: "xopglm51",
      usage: { input_tokens: -1, output_tokens: 0 },
      content: [],
    },
  });

  assert.equal(sess.__cpLiveActive, true);
  assert.equal(sess.__cpLiveT, 70000);
});

test("compact boundary resets live context and probes before busy completion", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.usageData.current = {
    contextWindow: 200000,
    totalTokens: 83146,
    totalCost: 1.25,
    maxOutputTokens: 32000,
    extra: "keep",
  };
  const calls = [];
  sess.connection.value = {
    exec(command, args) {
      calls.push({ command, args });
      return Promise.resolve({
        stdout: command === "node"
          ? '{"kind":"compact","totalTokens":6750}'
          : "",
      });
    },
  };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.processMessage({
    type: "stream_event",
    event: {
      type: "message_start",
      message: { usage: { input_tokens: 83146 } },
    },
  });
  sess.processMessage({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "manual", pre_tokens: 83146 },
  });

  assert.equal(sess.usageData.value.totalTokens, 0);
  assert.equal(sess.__cpLiveActive, false);
  assert.equal(calls.filter((call) => call.command === "node").length, 4);
  await flushPromises();

  assert.deepEqual(sess.usageData.value, {
    contextWindow: 200000,
    totalTokens: 6750,
    totalCost: 1.25,
    maxOutputTokens: 32000,
    extra: "keep",
  });
  assert.equal(sess.__cpLastT, 6750);
});

test("compact boundary applies raw post_tokens without transcript", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const calls = [];
  sess.connection.value = {
    exec(command) {
      calls.push(command);
      return Promise.resolve({ stdout: "" });
    },
  };

  render(
    jsx,
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
    (fn) => fn(),
  );
  sess.processMessage({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { pre_tokens: 1000, post_tokens: 125 },
  });

  assert.equal(sess.usageData.value.totalTokens, 125);
  assert.equal(sess.__cpLastT, 125);
  assert.equal(calls.filter((command) => command === "node").length, 0);

  sess.processMessage({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { pre_tokens: 125, post_tokens: 0 },
  });
  assert.equal(sess.usageData.value.totalTokens, 0);
  assert.equal(sess.__cpLastT, 0);
  assert.equal(calls.filter((command) => command === "node").length, 0);
});

test("reused-store init clears live and confirmed context", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const immediateTimeout = (fn) => fn();

  render(
    jsx,
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
    immediateTimeout,
  );
  sess.processMessage({
    type: "stream_event",
    event: { type: "message_start", message: { usage: { input_tokens: 70000 } } },
  });
  assert.equal(sess.__cpLiveActive, true);

  sess.processMessage({
    type: "system",
    subtype: "init",
    session_id: "session-2",
    model: "xopglm51",
  });

  assert.equal(sess.sessionId.value, "session-2");
  assert.equal(sess.usageData.value.totalTokens, 0);
  assert.equal(sess.__cpLastT, 0);
  assert.equal(sess.__cpLastCW, 0);
  assert.equal(sess.__cpLiveT, 0);
  assert.equal(sess.__cpLiveActive, false);
  assert.equal(sess.__cpStreamBase, 0);
  assert.equal(sess.__cpStreamBytes, 0);
});

test("transcript result replaces retained live context", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.connection.value = {
    exec: (command) => Promise.resolve({
      stdout: command === "node"
        ? '{"kind":"usage","totalTokens":80000}'
        : "",
    }),
  };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.processMessage({
    type: "stream_event",
    event: { type: "message_start", message: { usage: { input_tokens: 76000 } } },
  });
  sess.busy.value = false;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  await flushPromises();

  assert.equal(sess.usageData.value.totalTokens, 80000);
  assert.equal(sess.__cpLiveActive, false);
  assert.equal(sess.__cpLiveT, 0);
});

test("busy start prevents prior transcript probes from replacing new live context", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const pending = [];
  sess.connection.value = {
    exec(command) {
      if (command !== "node") return Promise.resolve({ stdout: "" });
      return new Promise((resolve) => pending.push(resolve));
    },
  };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.busy.value = false;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  assert.equal(pending.length, 3);

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.processMessage({
    type: "stream_event",
    event: { type: "message_start", message: { usage: { input_tokens: 90000 } } },
  });
  pending[0]({ stdout: '{"kind":"usage","totalTokens":40000}' });
  await flushPromises();

  assert.equal(sess.__cpLiveActive, true);
  assert.equal(sess.__cpLiveT, 90000);
  assert.equal(sess.usageData.value.totalTokens, 1000);
});

test("clear invalidates a pending stream refresh timer", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const timers = [];
  const fakeTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };

  render(
    jsx,
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
    fakeTimeout,
  );
  sess.processMessage({
    type: "stream_event",
    event: { type: "message_start", message: { usage: { input_tokens: 70000 } } },
  });
  assert.equal(timers.length, 1);

  sess.processMessage({
    type: "system",
    subtype: "init",
    session_id: "session-2",
  });
  timers[0]();

  assert.equal(sess.__cpLiveActive, false);
  assert.equal(sess.__cpLiveT, 0);
  assert.equal(sess.usageData.value.totalTokens, 0);
});

test("transcript fallback works without processMessage", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const sess = makeSession();
  delete sess.processMessage;
  sess.usageData.current = { contextWindow: 200000, totalTokens: 0, totalCost: 0 };
  sess.connection.value = {
    exec: (command) => Promise.resolve({
      stdout: command === "node"
        ? '{"kind":"usage","totalTokens":77000}'
        : "",
    }),
  };

  assert.doesNotThrow(() => render(
    (type, props) => ({ type, props }),
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
    (fn) => fn(),
  ));
  await flushPromises();

  assert.equal(sess.usageData.value.totalTokens, 77000);
  assert.equal(sess.__cpStreamHooked, undefined);
});

test("stream wrapper preserves original processMessage errors", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const sess = makeSession();
  const originalError = new Error("original failure");
  sess.processMessage = function () {
    throw originalError;
  };

  render(
    (type, props) => ({ type, props }),
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
    (fn) => fn(),
  );

  assert.throws(
    () => sess.processMessage({ type: "stream_event", event: { type: "message_start" } }),
    (error) => error === originalError,
  );
});

test("idle session with zero usage applies transcript fallback once", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.usageData.current = {
    contextWindow: 200000,
    totalTokens: 0,
    totalCost: 1.25,
    maxOutputTokens: 32000,
    extra: "keep",
  };
  const calls = [];
  sess.connection.value = {
    exec(command, args) {
      calls.push({ command, args });
      return Promise.resolve({
        stdout: command === "node" ? '{"kind":"usage","totalTokens":77000}' : "",
      });
    },
  };

  render(jsx, sess, { __cpStatus: { customCW: () => 0 } }, () => 1, (fn) => fn());
  await flushPromises();

  const nodeCalls = calls.filter((call) => call.command === "node");
  assert.equal(nodeCalls.length, 3);
  assert.deepEqual(nodeCalls[0].args.slice(0, 2), ["-e", loadInternals().TRANSCRIPT_PROBE]);
  assert.deepEqual(nodeCalls[0].args.slice(2), ["session-1", "/tmp/probe-project"]);
  assert.deepEqual(sess.usageData.value, {
    contextWindow: 200000,
    totalTokens: 77000,
    totalCost: 1.25,
    maxOutputTokens: 32000,
    extra: "keep",
  });

  render(jsx, sess, { __cpStatus: { customCW: () => 0 } }, () => 1, (fn) => fn());
  await flushPromises();
  assert.equal(calls.filter((call) => call.command === "node").length, 3);
});

test("busy completion applies current generation and ignores stale results", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const pending = [];
  sess.connection.value = {
    exec(command) {
      if (command !== "node") return Promise.resolve({ stdout: "" });
      return new Promise((resolve) => pending.push(resolve));
    },
  };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.busy.value = false;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  assert.equal(pending.length, 3);

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.busy.value = false;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  assert.equal(pending.length, 6);

  pending[0]({ stdout: '{"kind":"usage","totalTokens":40000}' });
  pending[3]({ stdout: '{"kind":"usage","totalTokens":80000}' });
  await flushPromises();

  assert.equal(sess.usageData.value.totalTokens, 80000);
});

test("compact result lowers usage and preserves other usage fields", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.usageData.current = {
    contextWindow: 200000,
    totalTokens: 83146,
    totalCost: 1.25,
    maxOutputTokens: 32000,
    extra: "keep",
  };
  sess.connection.value = {
    exec: (command) => Promise.resolve({
      stdout: command === "node"
        ? '{"kind":"compact","totalTokens":6750}'
        : "",
    }),
  };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.busy.value = false;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  await flushPromises();

  assert.deepEqual(sess.usageData.value, {
    contextWindow: 200000,
    totalTokens: 6750,
    totalCost: 1.25,
    maxOutputTokens: 32000,
    extra: "keep",
  });
  assert.equal(sess.__cpLastT, 6750);
});

test("zero compact result clears cache only for that assignment", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.connection.value = {
    exec: (command) => Promise.resolve({
      stdout: command === "node"
        ? '{"kind":"compact","totalTokens":0}'
        : "",
    }),
  };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.busy.value = false;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  await flushPromises();

  assert.equal(sess.usageData.value.totalTokens, 0);
  assert.equal(sess.__cpLastT, 0);

  sess.usageData.value = { contextWindow: 200000, totalTokens: 900, totalCost: 0 };
  sess.usageData.value = { contextWindow: 0, totalTokens: 0, totalCost: 0 };
  assert.equal(sess.usageData.value.totalTokens, 900);
  assert.equal(sess.__cpLastT, 900);
});

test("session change clears usage caches and accepts clear reset", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const browserWindow = { __cpStatus: { customCW: () => 0 } };

  render(jsx, sess, browserWindow, () => 1, () => 1);
  const previousGeneration = sess.__cpProbeGen || 0;
  sess.sessionId.value = "session-2";
  sess.usageData.value = { contextWindow: 0, totalTokens: 0, totalCost: 0 };

  assert.equal(sess.usageData.value.totalTokens, 0);
  assert.equal(sess.usageData.value.contextWindow, 200000);
  assert.equal(sess.__cpLastT, 0);
  assert.equal(sess.__cpLastCW, 0);
  assert.ok(sess.__cpProbeGen > previousGeneration);
});

test("first session id assignment keeps valid first usage", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.sessionId.value = "";
  sess.usageData.current = { contextWindow: 0, totalTokens: 0, totalCost: 0 };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };

  render(jsx, sess, browserWindow, () => 1, () => 1);
  sess.sessionId.value = "session-1";
  sess.usageData.value = { contextWindow: 0, totalTokens: 1200, totalCost: 0 };

  assert.equal(sess.usageData.value.totalTokens, 1200);
  assert.equal(sess.__cpLastT, 1200);
});

test("old transcript result cannot restore usage after session clear", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const pending = [];
  sess.connection.value = {
    exec(command) {
      if (command !== "node") return Promise.resolve({ stdout: "" });
      return new Promise((resolve) => pending.push(resolve));
    },
  };
  const browserWindow = { __cpStatus: { customCW: () => 0 } };
  const immediateTimeout = (fn) => fn();

  sess.busy.value = true;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  sess.busy.value = false;
  render(jsx, sess, browserWindow, () => 1, immediateTimeout);
  assert.equal(pending.length, 3);

  sess.sessionId.value = "session-2";
  sess.usageData.value = { contextWindow: 0, totalTokens: 0, totalCost: 0 };
  pending[0]({ stdout: '{"kind":"usage","totalTokens":80000}' });
  await flushPromises();

  assert.equal(sess.usageData.value.totalTokens, 0);
  assert.equal(sess.__cpLastT, 0);
});

test("invalid transcript probe output leaves usage unchanged", async () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval", "setTimeout",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.usageData.current.totalTokens = 0;
  sess.connection.value = {
    exec: (command) => Promise.resolve({
      stdout: command === "node" ? "not-json" : "",
    }),
  };

  render(
    jsx,
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
    (fn) => fn(),
  );
  await flushPromises();

  assert.equal(sess.usageData.value.totalTokens, 0);
});

test("existing usage seeds cache before a later zero reset", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const browserWindow = { __cpStatus: { customCW: () => 0 } };

  render(jsx, sess, browserWindow, () => 1);
  assert.equal(sess.__cpLastT, 1000);
  assert.equal(sess.__cpLastCW, 200000);
  assert.equal(sess.__cpSetCount, 0);

  sess.usageData.value = { contextWindow: 0, totalTokens: 0, totalCost: 0 };
  const second = render(jsx, sess, browserWindow, () => 1);
  const contextPill = second.props.children.find(
    (child) => child.props && child.props["data-seg"] === "ctx",
  );

  assert.equal(sess.usageData.value.totalTokens, 1000);
  assert.equal(sess.usageData.value.contextWindow, 200000);
  assert.equal(sess.__cpSetCount, 1);
  assert.match(contextPill.props.title, /^1k\/200k \(1%\) \[set:1\|lastT:1000\]$/);
});

test("debug state survives later chip renders and setter count accumulates", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  const browserWindow = { __cpStatus: { customCW: () => 0 } };

  render(jsx, sess, browserWindow, () => 1);
  assert.equal(sess.__cpSetCount, 0);

  sess.usageData.value = { contextWindow: 0, totalTokens: 1200, totalCost: 0 };
  const second = render(jsx, sess, browserWindow, () => 1);
  const contextPill = second.props.children.find(
    (child) => child.props && child.props["data-seg"] === "ctx",
  );

  assert.equal(sess.__cpSetCount, 1);
  assert.equal(sess.__cpLastT, 1200);
  assert.match(contextPill.props.title, /\[set:1\|lastT:1200\]$/);
});

test("missing debug fields fall back to zero", () => {
  const chip = loadChip();
  const expression = chip("jsx", "sess").slice(1);
  const render = new Function(
    "jsx", "sess", "window", "setInterval",
    `return (${expression});`,
  );
  const jsx = (type, props) => ({ type, props });
  const sess = makeSession();
  sess.__cpCWFixed = true;

  const result = render(
    jsx,
    sess,
    { __cpStatus: { customCW: () => 0 } },
    () => 1,
  );
  const contextPill = result.props.children.find(
    (child) => child.props && child.props["data-seg"] === "ctx",
  );

  assert.match(contextPill.props.title, /\[set:0\|lastT:0\]$/);
});
