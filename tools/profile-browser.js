"use strict";
// Execution costs from Playwright's recorded results, not a designated-machine performance certificate.
const fs = require("node:fs");
const { cases } = require("./check-browser-report.js");
const file = process.argv[2] || "reports/browser.json";
const report = JSON.parse(fs.readFileSync(file, "utf8"));
const files = new Map();
let work = 0;
const entries = cases(report);
for (const { spec, test } of entries) {
  const duration = (test.results || []).reduce((total, result) => total + result.duration, 0);
  work += duration;
  files.set(spec.file, (files.get(spec.file) || 0) + duration);
}
console.log(`${entries.length} cases; elapsed ${(report.stats.duration / 1000).toFixed(1)}s; aggregate test time ${(work / 1000).toFixed(1)}s; workers ${report.config.workers}`);
console.log("Slowest files (aggregate seconds; share of test time):");
for (const [name, duration] of [...files].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`${(duration / 1000).toFixed(1)}s (${(100 * duration / work).toFixed(1)}%) ${name}`);
}
