"use strict";
// Oracle: hand-written two-case inventory, then incomplete/duplicate/skipped/flaky report mutations.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verify } = require("../../tools/check-browser-report.js");
const spec = (id) => ({ id, file: "hand.spec.js", title: id, ok: true, tests: [{ projectId: "chromium", projectName: "chromium", expectedStatus: "passed", status: "expected", results: [{ status: "passed", retry: 0, errors: [] }] }] });
const report = (...ids) => ({ suites: [{ suites: [{ specs: ids.map(spec) }] }], errors: [] });
const inventory = report("first", "second");

test("blob-merged reports omit internal project IDs but must preserve the inventory's project names", () => {
  const merged = report("first", "second");
  for (const s of merged.suites[0].suites[0].specs) delete s.tests[0].projectId;
  assert.equal(verify(merged, inventory), 2);
  merged.suites[0].suites[0].specs[0].tests[0].projectName = "another-project";
  assert.throws(() => verify(merged, inventory), /Unexpected browser case/);
});

test("complete full inventory passes; empty, missing, extra and duplicate cases fail", () => {
  assert.equal(verify(report("first", "second"), inventory), 2);
  assert.throws(() => verify(report(), report()), /inventory is empty/);
  assert.throws(() => verify(report("first"), inventory), /coverage incomplete/);
  assert.throws(() => verify(report("first", "second", "extra"), inventory), /Unexpected/);
  assert.throws(() => verify(report("first", "first", "second"), inventory), /Duplicate/);
  assert.throws(() => verify(report("first"), report("first", "first")), /inventory contains duplicate/);
});

test("skipped, expected-failing, flaky, retried and failed cases cannot certify coverage", () => {
  const mutations = [
    (s) => { s.tests[0].results[0].status = "skipped"; },
    (s) => { s.tests[0].expectedStatus = "failed"; },
    (s) => { s.tests[0].status = "flaky"; },
    (s) => { s.tests[0].results[0].retry = 1; },
    (s) => { s.tests[0].results.push({ status: "passed", retry: 1 }); },
    (s) => { s.tests[0].results[0].status = "failed"; },
    (s) => { s.tests[0].results[0].errors.push({ message: "fault" }); },
    (s) => { s.ok = false; },
  ];
  for (const mutate of mutations) {
    const r = report("first", "second");
    mutate(r.suites[0].suites[0].specs[0]);
    assert.throws(() => verify(r, inventory), /did not pass once/);
  }
});

test("report-level errors and malformed inventories fail", () => {
  const r = report("first", "second");
  r.errors.push({ message: "missing shard" });
  assert.throws(() => verify(r, inventory), /contains errors/);
  assert.throws(() => verify(report("first"), {}), /no suites/);
  const malformed = report("first");
  delete malformed.suites[0].suites[0].specs[0].tests[0].projectName;
  assert.throws(() => verify(r, malformed), /invalid project/);
});
