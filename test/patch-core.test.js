const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadChip() {
  const filename = path.join(__dirname, "..", "patch-core.js");
  const source = fs.readFileSync(filename, "utf8").replace(
    "module.exports = { run };",
    "module.exports = { run, chip };",
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
  return module.exports.chip;
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
    currentMainLoopModel: { value: "claude-sonnet-4-8" },
    gitBranch: { value: "main" },
    worktree: { value: null },
    messages: { value: [{}] },
    modelSelection: { value: "default" },
    effortLevel: { value: "medium" },
    thinkingLevel: { value: "off" },
  };
}

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
