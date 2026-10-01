"use strict";
// Oracle: literal command order and exit outcomes; a typo or unit failure never reaches browser execution.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { run, selectedSpecs } = require("../../tools/test-dev.js");
const ROOT = path.resolve(__dirname, "..", "..");

test("selection accepts existing exact specs and rejects typos, flags and outside files", () => {
  assert.deepEqual(selectedSpecs(["tests/browser/boot.spec.js", "tests/browser/boot.spec.js"]), ["tests/browser/boot.spec.js"]);
  for (const arg of ["boot", "tests/browser/typo.spec.js", "--grep=boot", "../boot.spec.js", "tests/unit/repo.test.js"]) {
    assert.throws(() => selectedSpecs([arg]), /Expected an existing/);
  }
});

test("all unit tests precede the explicit browser selection; no selection means full suite", () => {
  for (const selection of [[], ["tests/browser/boot.spec.js"]]) {
    const calls = [];
    assert.equal(run(selection, { spawn: (executable, args, options) => { calls.push({ executable, args, options }); return { status: 0 }; } }), 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, ["--test", "--test-reporter=spec", "tests/unit/**/*.test.js"]);
    assert.deepEqual(calls[1].args, [path.join(ROOT, "node_modules", "@playwright", "test", "cli.js"), "test", "--config", "tests/browser/playwright.config.js", ...selection]);
    assert.ok(calls.every((c) => c.executable === process.execPath && c.options.cwd === ROOT));
  }
});

test("unit failure or interruption stops before the browser; browser failure is propagated", () => {
  for (const status of [1, null]) {
    let calls = 0;
    assert.equal(run([], { spawn: () => { calls++; return { status }; } }), 1);
    assert.equal(calls, 1);
  }
  let calls = 0;
  assert.equal(run([], { spawn: () => ({ status: ++calls === 1 ? 0 : 7 }) }), 7);
  assert.equal(calls, 2);
});
