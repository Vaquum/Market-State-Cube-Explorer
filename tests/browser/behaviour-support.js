"use strict";
// tests/browser/behaviour-support.js (H7b): the scripted behaviour of the page that the rollback spec (B22) holds the candidate to, and the
// recorder that captured it from the ORIGINAL build.
//
// Two facts are recorded from build 8c82ca1 into tests/fixtures/behaviour/ and this file is the only place that knows how they are read:
//   shortcuts-baseline.json  every `aria-keyshortcuts` of the page (element id -> value), and the keyboard help dialog as a list of
//                            [what, keys] rows (DR-05: S1 adds no global shortcut, and the list that names them did not change)
//   history-baseline.json    for each scripted action, how much `history.length` grew (Back and Forward walk the browser's history, so
//                            the number of entries an action adds IS the behaviour; a visual setting must add none, a move adds one, a
//                            run of steps of one kind within 2.5 s adds one in all)
//
// The same ACTIONS run on the original build (recording, `node tests/browser/behaviour-support.js --record`, normally started by
// tests/reference/record_behaviour.mjs) and on the candidate (rollback-baseline.spec.js, which compares). Nothing in this file computes an
// expected value: the expectation is what the original build did, written to the fixture once and read back by the spec.
//
// Why the recorder is here and not in tests/reference: the reference files may import nothing but node: built-ins (U09), and recording needs
// Playwright, the fake cube and the baseline materialiser. record_behaviour.mjs only starts this script and writes what it prints.
const fs = require("node:fs");
const path = require("node:path");

// One action = a name, the keys or gesture in words (stored in the fixture so a reader can see what was done), and a function of the page.
// Every action is keyboard-driven, so the two builds get identical input events; none needs a pointer except `pointer`, which says where.
const ACTIONS = Object.freeze([
  { name: "window-7d", how: "key 7", run: (page) => page.keyboard.press("7") },
  { name: "window-30d", how: "key 8", run: (page) => page.keyboard.press("8") },
  // The encodings are settings of HOW a place is shown, not places: no history entry.
  { name: "cells-next", how: "key M", run: (page) => page.keyboard.press("m") },
  { name: "columns-next", how: "key B", run: (page) => page.keyboard.press("b") },
  { name: "rows-next", how: "key U", run: (page) => page.keyboard.press("u") },
  { name: "lines-toggle", how: "key P", run: (page) => page.keyboard.press("p") },
  // Steps of one kind in quick succession are one entry (MERGED in the page): three zoom steps add one entry, not three.
  { name: "zoom-in-x3", how: "key = three times", run: async (page) => { for (let i = 0; i < 3; i++) await page.keyboard.press("="); } },
  { name: "pan-right-x3", how: "key ArrowRight three times", run: async (page) => { for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight"); } },
  { name: "finer-time-cells", how: "key [", run: (page) => page.keyboard.press("[") },
  // The exact-digits key changes the tooltip's text and nothing about the place.
  { name: "shift-held", how: "Shift down then up", run: async (page) => { await page.keyboard.down("Shift"); await page.keyboard.up("Shift"); } },
  { name: "window-24h", how: "key 6", run: (page) => page.keyboard.press("6") },
  // Back walks to the previous entry and adds none; the next move starts a branch, which drops the entries ahead of it.
  { name: "back", how: "the browser's Back", run: (page) => page.goBack() },
  { name: "window-4h-after-back", how: "key 4", run: (page) => page.keyboard.press("4") },
]);

// How the page settles after an action: the fake has no request in flight or recent and the canvas has not been drawn for a moment.
// `probe` is the probe of the page (probe.js forPage).
async function settle(fake, probe, { quietMs = 450 } = {}) {
  await fake.idle({ quietMs: 300, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs, timeout: 20000 });
}

const historyLength = (page) => page.evaluate(() => history.length);

// runHistory(page, settleFn) -> [{name, how, delta}]: the actions in order, each with the growth of history.length it caused. A `back`
// action is measured like the rest (its delta is 0: Back moves inside the list).
async function runHistory(page, settleFn) {
  const out = [];
  await settleFn();
  for (const action of ACTIONS) {
    const before = await historyLength(page);
    await action.run(page);
    await settleFn();
    out.push({ name: action.name, how: action.how, delta: (await historyLength(page)) - before });
  }
  return out;
}

// readShortcuts(page) -> {aria: {id: keys}, help: [[what, keys], ...]}: the page's own statements about its keys. A key label the page fills in by
// platform (Alt+Left on one system, Command-[ on another) is reduced to its data-key name so the record does not depend on the machine.
function readShortcuts(page) {
  return page.evaluate(() => {
    const aria = {};
    for (const el of document.querySelectorAll("[aria-keyshortcuts]")) aria[el.id || el.getAttribute("aria-label") || el.tagName] = el.getAttribute("aria-keyshortcuts");
    const help = [];
    for (const row of document.querySelectorAll("#ol-keys dl > div")) {
      const what = row.querySelector("dt")?.textContent.trim().replace(/\s+/g, " ") ?? "";
      const keys = [...(row.querySelector("dd")?.childNodes ?? [])]
        .map((node) => (node.nodeType === 1 && node.matches("kbd[data-key]") ? `<${node.dataset.key}>` : node.textContent))
        .join("")
        .trim()
        .replace(/\s+/g, " ");
      help.push([what, keys]);
    }
    return { aria, help };
  });
}

// ---- recording (node tests/browser/behaviour-support.js --record) ---------------------------------------------------------------------------
// Drives the ORIGINAL build (materialised from git by tests/support/builds.js) behind a `mini` fake cube in a headless Chromium at the harness
// viewport, runs ACTIONS and reads the shortcuts, and prints ONE JSON document on stdout: {build, browser, shortcuts, history}. It writes nothing:
// tests/reference/record_behaviour.mjs validates the document and writes the fixtures and their provenance.
async function record() {
  const { chromium } = require("@playwright/test");
  const { startFake } = require("../support/cube-fake.js");
  const { materialise } = require("../support/builds.js");
  const probeModule = require("./probe.js");
  const { BASELINE_SHA } = require("./global-setup.js");
  const build = materialise(BASELINE_SHA, "baseline");
  const fake = await startFake({ profile: "mini", pageRoot: build.dir, port: 0 });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "no-preference", serviceWorkers: "block" });
    await probeModule.addProbe(context);
    const page = await context.newPage();
    const problems = [];
    context.on("console", (message) => message.type() === "error" && problems.push(message.text()));
    await page.goto(`${fake.url}/#w=24h`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    const probe = probeModule.forPage(page);
    const quiet = () => settle(fake, probe);
    await quiet();
    const shortcuts = await readShortcuts(page);
    // the help dialog lists the keys in a <dialog> that is closed: its rows are in the DOM all the same
    const history = await runHistory(page, quiet);
    if (problems.length) throw new Error(`the original build reported console errors while recording: ${problems.join(" | ")}`);
    fake.assertNoUnexpected();
    process.stdout.write(`${JSON.stringify({ build: { sha: build.sha, indexSha256: build.indexSha256 }, browser: browser.version(), shortcuts, history }, null, 2)}\n`);
  } finally {
    await browser.close();
    await fake.close();
  }
}

if (require.main === module) {
  if (!process.argv.includes("--record")) {
    process.stderr.write("usage: node tests/browser/behaviour-support.js --record   (normally started by tests/reference/record_behaviour.mjs)\n");
    process.exit(2);
  }
  record().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
  });
}

const FIXTURES = path.resolve(__dirname, "..", "fixtures", "behaviour");
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

module.exports = { ACTIONS, settle, runHistory, readShortcuts, readFixture, FIXTURES };
