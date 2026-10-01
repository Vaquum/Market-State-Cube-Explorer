"use strict";
// One report for all CI shards; the inventory check below is part of the deploy gate.
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
module.exports = {
  testDir: __dirname,
  reporter: [
    ["json", { outputFile: path.join(ROOT, "reports", "browser.json") }],
    ["junit", { outputFile: path.join(ROOT, "reports", "browser.xml") }],
    ["html", { outputFolder: path.join(ROOT, "playwright-report"), open: "never" }],
  ],
};
