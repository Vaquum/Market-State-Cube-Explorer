// tests/reference/record_behaviour.mjs (H7b, TESTPLAN.md section 1 "record_behaviour.mjs"): a one-off that records how the UNMODIFIED build behaves, so
// that rollback-baseline.spec.js (B22) can hold the candidate to it. It is run by a person, when the fixtures have to be made again, and never by
// the test suite: the suite reads the committed fixtures only.
//
//   node tests/reference/record_behaviour.mjs              (writes tests/fixtures/behaviour/)
//   node tests/reference/record_behaviour.mjs --check      (records again, in memory, and compares with the committed files)
//
// What it records (from build 8c82ca1, `git show`, served by the fake cube in a headless Chromium):
//   shortcuts-baseline.json   every `aria-keyshortcuts` value by element id, and the keyboard help dialog rows
//   history-baseline.json     for each scripted action (window keys, encodings, zoom, pan, Back, ...) the growth of `history.length`
//
// Why this file only starts another one: a reference file may import nothing but node: built-ins (U09, tests/unit/independence.test.js), and
// driving a browser needs Playwright, the fake cube and the baseline materialiser. The driving lives in tests/browser/behaviour-support.js
// (`--record`), which prints one JSON document; this file checks its shape, stamps the provenance (what was recorded, when, from which build)
// and writes the fixtures. The numbers are the original build's, whatever they are: a regression pin of behaviour, not a claim that the
// original is right.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "tests/fixtures/behaviour");
const BASELINE = "8c82ca1f03d80d3f35ff1ab6326902f4286f7b92";
const check = process.argv.includes("--check");

// The recording: the driver prints exactly one JSON document on stdout; anything it says on stderr is passed through.
const stdout = execFileSync("node", ["tests/browser/behaviour-support.js", "--record"], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const recorded = JSON.parse(stdout);

// ---- shape checks (a recording that is not what B22 reads must not be written) ----
const fail = (text) => {
  throw new Error(`record_behaviour: ${text}`);
};
if (recorded.build?.sha !== BASELINE) fail(`the recording is of ${recorded.build?.sha}, not of ${BASELINE}`);
const ariaIds = Object.keys(recorded.shortcuts?.aria ?? {});
if (ariaIds.length !== 11) fail(`expected the 11 aria-keyshortcuts of the original build, found ${ariaIds.length}: ${ariaIds.join(", ")}`);
if (!Array.isArray(recorded.shortcuts.help) || recorded.shortcuts.help.length < 30) fail("the keyboard help dialog rows were not read");
if (!Array.isArray(recorded.history) || recorded.history.length === 0) fail("no history actions were recorded");
for (const row of recorded.history) {
  if (typeof row.name !== "string" || typeof row.how !== "string" || !Number.isInteger(row.delta)) fail(`a history row is malformed: ${JSON.stringify(row)}`);
  if (row.delta < 0) fail(`${row.name}: history.length cannot shrink by more than a truncation would; the recording is suspect (${row.delta})`);
}

const today = new Date().toISOString().slice(0, 10);
const files = {
  "shortcuts-baseline.json": { build: BASELINE, aria: recorded.shortcuts.aria, help: recorded.shortcuts.help },
  "history-baseline.json": { build: BASELINE, viewport: "1500x950", profile: "mini", actions: recorded.history },
  "provenance.json": {
    kind: "recorded",
    expectationSource: "baseline-8c82ca1",
    generator: "tests/reference/record_behaviour.mjs",
    seed: null,
    source: `what build ${BASELINE} does: the aria-keyshortcuts of its controls and the rows of its keyboard help dialog, and how much history.length grows for each of a fixed list of keyboard actions (tests/browser/behaviour-support.js ACTIONS). Recorded in Chromium ${recorded.browser} at 1500x950, device pixel ratio 1, behind the synthetic mini fake cube (the page's own data source is not part of what is recorded).`,
    extractedOn: today,
    notes: "Not a claim that the original behaviour is right: a regression pin. A back action has delta 0 (Back moves inside the list) and the move after it may be smaller than one because it drops the entries ahead of the new branch.",
  },
};

let drift = 0;
for (const [name, value] of Object.entries(files)) {
  const target = path.join(OUT, name);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    // The recording date is not part of what is compared.
    const now = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null;
    const same = now && JSON.stringify({ ...now, extractedOn: null, source: null }) === JSON.stringify({ ...value, extractedOn: null, source: null });
    if (!same) {
      drift++;
      console.error(`${name}: differs from a fresh recording`);
    }
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(target, text);
    console.log(`wrote ${path.relative(ROOT, target)}`);
  }
}
if (check) {
  if (drift) process.exit(1);
  console.log("the committed fixtures equal a fresh recording");
}
