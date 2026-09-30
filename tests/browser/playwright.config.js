"use strict";
// tests/browser/playwright.config.js (H7a): the one configuration of the browser suite (TESTPLAN 3.1, DD-T07).
//
// Pinned Playwright 1.63.0, the headless shell (no channel) for the functional tests, one project, no retries: a test that
// passes only on a second try is a defect in the test or the page, and CI additionally fails on any flaky result and on a
// leftover test.only. The viewport and the colour scheme are fixed so that pixel and geometry assertions do not depend on
// the machine; reduced motion stays "no-preference" here for the specs that assert the morph, and every spec that compares
// pixels or timing across builds creates its context with reducedMotion: "reduce" (DD-T33).
//
// Outputs (all ignored by git): test-results/ (wiped by Playwright at the start of every run), reports/browser.json,
// reports/browser.xml, playwright-report/. Run it with `npm run test:browser -- <spec name>`.
const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..", "..");
const CI = !!process.env.CI;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "**/*.spec.js",
  outputDir: path.join(ROOT, "test-results"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(ROOT, "reports", "browser.json") }],
    ["junit", { outputFile: path.join(ROOT, "reports", "browser.xml") }],
    ["html", { outputFolder: path.join(ROOT, "playwright-report"), open: "never" }],
  ],
  retries: 0,
  forbidOnly: CI,
  failOnFlakyTests: CI,
  fullyParallel: true,
  workers: CI ? 2 : undefined,
  timeout: 60000,
  expect: { timeout: 10000 },
  globalSetup: path.join(__dirname, "global-setup.js"),
  use: {
    viewport: { width: 1500, height: 950 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: {} }],
});
