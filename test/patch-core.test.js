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
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-status-probe-"));
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

  assert.deepEqual(JSON.parse(stdout), { totalTokens: 77000 });
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
  return {
    usageData,
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
        stdout: command === "node" ? '{"totalTokens":77000}' : "",
      });
    },
  };

  render(jsx, sess, { __ccStatus: { customCW: () => 0 } }, () => 1, (fn) => fn());
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

  render(jsx, sess, { __ccStatus: { customCW: () => 0 } }, () => 1, (fn) => fn());
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
  const browserWindow = { __ccStatus: { customCW: () => 0 } };
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

  pending[0]({ stdout: '{"totalTokens":40000}' });
  pending[3]({ stdout: '{"totalTokens":80000}' });
  await flushPromises();

  assert.equal(sess.usageData.value.totalTokens, 80000);
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
    { __ccStatus: { customCW: () => 0 } },
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
  const browserWindow = { __ccStatus: { customCW: () => 0 } };

  render(jsx, sess, browserWindow, () => 1);
  assert.equal(sess.__ccLastT, 1000);
  assert.equal(sess.__ccLastCW, 200000);
  assert.equal(sess.__ccSetCount, 0);

  sess.usageData.value = { contextWindow: 0, totalTokens: 0, totalCost: 0 };
  const second = render(jsx, sess, browserWindow, () => 1);
  const contextPill = second.props.children.find(
    (child) => child.props && child.props["data-seg"] === "ctx",
  );

  assert.equal(sess.usageData.value.totalTokens, 1000);
  assert.equal(sess.usageData.value.contextWindow, 200000);
  assert.equal(sess.__ccSetCount, 1);
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
  const browserWindow = { __ccStatus: { customCW: () => 0 } };

  render(jsx, sess, browserWindow, () => 1);
  assert.equal(sess.__ccSetCount, 0);

  sess.usageData.value = { contextWindow: 0, totalTokens: 1200, totalCost: 0 };
  const second = render(jsx, sess, browserWindow, () => 1);
  const contextPill = second.props.children.find(
    (child) => child.props && child.props["data-seg"] === "ctx",
  );

  assert.equal(sess.__ccSetCount, 1);
  assert.equal(sess.__ccLastT, 1200);
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
  sess.__ccCWFixed = true;

  const result = render(
    jsx,
    sess,
    { __ccStatus: { customCW: () => 0 } },
    () => 1,
  );
  const contextPill = result.props.children.find(
    (child) => child.props && child.props["data-seg"] === "ctx",
  );

  assert.match(contextPill.props.title, /\[set:0\|lastT:0\]$/);
});
