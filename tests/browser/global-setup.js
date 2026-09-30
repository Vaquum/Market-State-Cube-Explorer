"use strict";
// tests/browser/global-setup.js (H7a): what runs once before the browser suite (TESTPLAN 3.1, DD-T24, DD-T06, DD-T07).
//
//   1. The page under test. With CONVERGENCE=1 (CI, the merger, K) `python3 tools/build.py --check` must pass and the page
//      root is the repository root, i.e. the COMMITTED index.html. Otherwise the root is EXPLORER_PAGE_ROOT or a fresh
//      temporary build of the working tree (tests/support/pageroot.js; never the committed file, so parallel worktrees do
//      not conflict on the generated 1.3 MB page). A temporary build that cannot be made (src/encoding.js is assembled
//      at A0 and does not exist before it) is NOT fatal outside convergence: the error is handed to the workers, and only
//      a spec that asks for the working-tree page fails, with that message. probe-selfcheck needs no such page.
//   2. The browser pin. One launch, and browser.version() must start with the major of the Chrome for Testing that
//      @playwright/test 1.63.0 pins (153). The binary comes from a CDN and is not hash-verified: the version is recorded in
//      reports/browser-environment.json and the JSON report metadata, never claimed as integrity.
//   3. The baseline build 8c82ca1 (git show, tests/support/builds.js). In CI a missing baseline fails the setup; locally the
//      specs that need it skip with the reason (fixtures.js).
//
// Results travel to the workers through process.env (set here, inherited by the worker processes): see ENV.
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_SHA = "8c82ca1f03d80d3f35ff1ab6326902f4286f7b92";
// The Chrome for Testing major that Playwright 1.63.0 pins (browsers.json: revision 1243, 153.0.8010.12), written out so a
// Playwright bump that moves the browser fails here by name instead of shifting every pixel quietly.
const PINNED_PLAYWRIGHT = "1.63.0";
const PINNED_CHROME_MAJOR = "153";

const ENV = Object.freeze({
  pageRoot: "EXPLORER_HARNESS_PAGE_ROOT",
  pageRootError: "EXPLORER_HARNESS_PAGE_ROOT_ERROR",
  baselineRoot: "EXPLORER_HARNESS_BASELINE_ROOT",
  baselineError: "EXPLORER_HARNESS_BASELINE_ERROR",
  environment: "EXPLORER_HARNESS_ENVIRONMENT",
});

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// The page root and how it was chosen.
function choosePage() {
  const { resolvePageRoot } = require("../support/pageroot.js");
  if (process.env.CONVERGENCE === "1") {
    if (process.env.EXPLORER_PAGE_ROOT) throw new Error("CONVERGENCE=1 certifies the committed index.html; unset EXPLORER_PAGE_ROOT (it names a different page)");
    try {
      execFileSync("python3", ["tools/build.py", "--check"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      throw new Error(`CONVERGENCE=1: python3 tools/build.py --check failed, so the committed index.html is not the build of the sources:\n${String(error.stdout || "")}${String(error.stderr || error.message)}`);
    }
    return { dir: resolvePageRoot({ env: { CONVERGENCE: "1" } }), kind: "committed index.html (CONVERGENCE=1)" };
  }
  if (process.env.EXPLORER_PAGE_ROOT) return { dir: resolvePageRoot(), kind: "EXPLORER_PAGE_ROOT" };
  return { dir: resolvePageRoot(), kind: "temporary build of the working tree" };
}

async function globalSetup(config) {
  const environment = { playwright: null, browserVersion: null, pinnedChromeMajor: PINNED_CHROME_MAJOR, node: process.version, platform: `${process.platform} ${process.arch}`, convergence: process.env.CONVERGENCE === "1", pageRoot: null, pageRootKind: null, pageRootError: null, baseline: null };

  // 1. the page under test
  try {
    const page = choosePage();
    environment.pageRoot = page.dir;
    environment.pageRootKind = page.kind;
    process.env[ENV.pageRoot] = page.dir;
  } catch (error) {
    if (process.env.CONVERGENCE === "1") throw error;
    environment.pageRootError = error.message;
    process.env[ENV.pageRootError] = error.message;
    console.warn(`[harness] no working-tree page: ${error.message}\n[harness] specs that need it will fail; probe-selfcheck does not`);
  }

  // 2. the browser pin
  const installed = require("@playwright/test/package.json").version;
  // browsers.json is not an exported subpath of playwright-core, so it is read as a file next to the package's entry point.
  const browsers = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve("playwright-core")), "browsers.json"), "utf8")).browsers;
  const chromium = browsers.find((b) => b.name === "chromium");
  const pinnedMajor = String(chromium.browserVersion).split(".")[0];
  if (installed !== PINNED_PLAYWRIGHT) throw new Error(`@playwright/test ${installed} is installed; the harness is written for exactly ${PINNED_PLAYWRIGHT} (package.json and the lockfile pin it)`);
  if (pinnedMajor !== PINNED_CHROME_MAJOR) throw new Error(`Playwright ${installed} pins Chrome for Testing ${chromium.browserVersion}, major ${pinnedMajor}, but the harness expects ${PINNED_CHROME_MAJOR}: update PINNED_CHROME_MAJOR and the pixel expectations together`);
  const { chromium: launcher } = require("@playwright/test");
  const browser = await launcher.launch();
  try {
    environment.playwright = installed;
    environment.browserVersion = browser.version();
    environment.pinnedChromeForTesting = chromium.browserVersion;
    environment.browserRevision = chromium.revision;
    if (!environment.browserVersion.startsWith(`${PINNED_CHROME_MAJOR}.`)) {
      throw new Error(`the browser is ${environment.browserVersion}; Playwright ${installed} pins Chrome for Testing ${chromium.browserVersion} (major ${PINNED_CHROME_MAJOR}). Install it with: npx playwright install chromium`);
    }
  } finally {
    await browser.close();
  }

  // 3. the baseline build
  try {
    const { materialise } = require("../support/builds.js");
    const built = materialise(BASELINE_SHA, "baseline");
    if (built.sha !== BASELINE_SHA) throw new Error(`materialise returned ${built.sha}`);
    environment.baseline = { sha: built.sha, dir: built.dir, indexSha256: built.indexSha256, vendorSha256: built.vendorSha256 };
    process.env[ENV.baselineRoot] = built.dir;
  } catch (error) {
    const message = `baseline build ${BASELINE_SHA.slice(0, 7)} is not available: ${error.message}`;
    if (process.env.CI) throw new Error(message);
    environment.baseline = { sha: BASELINE_SHA, error: message };
    process.env[ENV.baselineError] = message;
    console.warn(`[harness] ${message}\n[harness] specs that compare with the original build will skip`);
  }

  // The record of what ran, next to the reports (reports/ is ignored; the PR text quotes it).
  const reports = path.join(ROOT, "reports");
  fs.mkdirSync(reports, { recursive: true });
  const file = path.join(reports, "browser-environment.json");
  fs.writeFileSync(file, `${JSON.stringify(environment, null, 2)}\n`);
  process.env[ENV.environment] = file;
  config.metadata.harness = environment;
  console.log(`[harness] Playwright ${environment.playwright}, browser ${environment.browserVersion} (pinned ${environment.pinnedChromeForTesting}), page: ${environment.pageRoot ?? "none"} (${environment.pageRootKind ?? environment.pageRootError})`);
}

module.exports = globalSetup;
module.exports.ENV = ENV;
module.exports.BASELINE_SHA = BASELINE_SHA;
