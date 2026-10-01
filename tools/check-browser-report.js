"use strict";
// Oracle: a fresh, unfiltered Playwright --list inventory from the same checkout.
// A green subset, missing shard, duplicate execution or skipped case cannot certify the full suite.
const fs = require("node:fs");

function cases(report) {
  if (!Array.isArray(report.suites)) throw new Error("Browser report has no suites");
  const result = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      if (!spec.id || !Array.isArray(spec.tests) || !spec.tests.length) throw new Error("Browser report contains an invalid spec");
      for (const test of spec.tests) {
        if (typeof test.projectId !== "string" || !test.projectId) throw new Error("Browser report contains an invalid project");
        result.push({ key: `${spec.id}:${test.projectId}`, spec, test });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  report.suites.forEach(visit);
  return result;
}

function verify(report, inventory) {
  const expected = cases(inventory);
  const actual = cases(report);
  if (!expected.length) throw new Error("Full browser inventory is empty");
  const wanted = new Set(expected.map((c) => c.key));
  if (wanted.size !== expected.length) throw new Error("Full browser inventory contains duplicate cases");
  if (report.errors?.length || inventory.errors?.length) throw new Error("Browser report or inventory contains errors");
  const seen = new Set();
  for (const { key, spec, test } of actual) {
    if (!wanted.has(key)) throw new Error(`Unexpected browser case: ${spec.file}: ${spec.title}`);
    if (seen.has(key)) throw new Error(`Duplicate browser case: ${spec.file}: ${spec.title}`);
    seen.add(key);
    const results = test.results ?? [];
    if (spec.ok !== true || test.expectedStatus !== "passed" || test.status !== "expected" || results.length !== 1 ||
        results[0].status !== "passed" || results[0].retry !== 0 || results[0].errors?.length) {
      throw new Error(`Browser case did not pass once without retries: ${spec.file}: ${spec.title}`);
    }
  }
  if (seen.size !== wanted.size) throw new Error(`Browser coverage incomplete: ${seen.size}/${wanted.size} cases`);
  return seen.size;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: node tools/check-browser-report.js <merged-report.json> <full-inventory.json>");
    const count = verify(...process.argv.slice(2).map((file) => JSON.parse(fs.readFileSync(file, "utf8"))));
    console.log(`Full browser coverage verified: ${count} cases passed once, no skips or retries.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { cases, verify };
