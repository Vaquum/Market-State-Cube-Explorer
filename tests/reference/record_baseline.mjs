// tests/reference/record_baseline.mjs (W1-A part 2, TESTPLAN.md DD-T02 "baseline-8c82ca1"): a one-off
// that records what the UNMODIFIED indicator functions of the baseline build return, so that the moved
// copy in src/encoding.js (part 23) is held to them exactly. It is run by a person, when the fixture has
// to be made again, and never by the test suite: the suite reads the committed fixture only.
//
//   node tests/reference/record_baseline.mjs                (writes tests/fixtures/indicators-baseline/)
//   node tests/reference/record_baseline.mjs --check        (re-records in memory and compares bytes)
//
// What it does, in order:
//   1. `git show 8c82ca1:src/explorer.js` (the baseline; needs the full history, hence "one-off");
//   2. cuts lines 6189-6337 (smaOf through divergencesOf, with the squeeze constants between them) and
//      the text of each of the nine functions;
//   3. evaluates that cut ALONE with `new Function`, so nothing of the moved copy, of src/ or of
//      tests/support is involved (this file imports only Node built-ins and the seeded generator);
//   4. runs it on the series below and writes inputs, outputs and the nine function texts.
// The inputs are hand-written series and, for the two squeeze functions (whose defaults look back 500 bars
// and 182 days), seeded synthetic ones (mulberry32, seed SEED). The fixture stores the inputs themselves,
// so the tests never regenerate them. The outputs are the baseline's, whatever they are: this is a
// regression pin of behaviour, not a claim that the baseline is correct (the tests check correctness
// against an exact-rational oracle separately).
//
// Encoding of numbers JSON cannot carry: "NaN", "Infinity", "-Infinity" and "-0" are strings; typed
// arrays are {"$type": "Float64Array" | "Uint8Array", "v": [...]}. A string that is one of those four
// tokens is never otherwise used in the cases.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { mulberry32 } = require("../support/rng.js");

const BASELINE = "8c82ca1";
const FIRST_LINE = 6189;
const LAST_LINE = 6337;
const SEED = 20260930;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "tests/fixtures/indicators-baseline");
const NAMES = ["smaOf", "emaOf", "rsiOf", "bollingerOf", "macdOf", "crossesOf", "squeezeBelow", "squeezeLowest", "divergencesOf"];

// ---- 1-3: the baseline functions -------------------------------------------------------------------

const full = execFileSync("git", ["show", `${BASELINE}:src/explorer.js`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
const lines = full.split("\n");
const cut = lines.slice(FIRST_LINE - 1, LAST_LINE);
if (!cut[0].startsWith("  function smaOf(") || cut[cut.length - 1] !== "  }" || !cut.some((l) => l.startsWith("  function divergencesOf(")))
  throw new Error(`lines ${FIRST_LINE}-${LAST_LINE} of ${BASELINE}:src/explorer.js are not smaOf..divergencesOf; the baseline moved?`);
const code = cut.join("\n");
const fn = new Function(`"use strict";\n${code}\nreturn { ${NAMES.join(", ")} };`)();

// The text of one function: from its 2-space "function" line to the next line that is exactly "  }".
function functionText(name) {
  const start = cut.findIndex((l) => l.startsWith(`  function ${name}(`));
  if (start < 0) throw new Error(`no function ${name}`);
  let end = start;
  while (cut[end] !== "  }") end++;
  return cut.slice(start, end + 1).join("\n");
}
const sources = {};
for (const name of NAMES) sources[name] = functionText(name);
// The three squeeze constants, as the baseline declares them (one chain there, three statements in part 23).
const constants = { SQUEEZE_BARS: 500, SQUEEZE_RANK: 0.1, SQUEEZE_DAYS: 182 };
for (const [k, v] of Object.entries(constants)) if (!new RegExp(`${k} = ${v}[,;]`).test(code)) throw new Error(`the baseline no longer declares ${k} = ${v}`);

// ---- the series -----------------------------------------------------------------------------------------

// 40 closes by hand: a rise, a drop, a range, a spike (BTC-like integers and halves).
const C40 = [100, 101, 102.5, 101.5, 103, 105, 104, 106, 107.5, 107, 108, 106, 104.5, 105, 103, 101, 99.5, 100, 98, 97, 96.5, 98, 99, 101, 102,
  104, 103.5, 105, 107, 110, 108, 107, 109, 111, 112, 110.5, 109, 108, 108.5, 107];
// 70 closes for MACD (needs 26 + 9): the 40 above continued.
const C70 = C40.concat([106, 105, 103, 104, 102, 100, 101, 99, 98, 97, 99, 100, 102, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 113, 115, 114, 116, 118, 117, 119]);
const FLAT = new Array(30).fill(50);
const UP = Array.from({ length: 20 }, (_, i) => 10 + i);
const DOWN = Array.from({ length: 20 }, (_, i) => 100 - 2 * i);
const ZIGZAG = Array.from({ length: 24 }, (_, i) => (i % 2 ? 11 : 10));

// A seeded width series: a wandering positive value with a NaN warm-up, like Bollinger bandwidth.
function widths(length, warm, seed) {
  const next = mulberry32(seed);
  const out = [];
  let w = 0.04;
  for (let i = 0; i < length; i++) {
    if (i < warm) out.push(NaN);
    else {
      w = Math.max(0.002, w + (next() - 0.5) * 0.006);
      out.push(w);
    }
  }
  return out;
}

const cases = [];
const add = (name, note, ...args) => cases.push({ fn: name, note, args });

for (const n of [1, 3, 5, 20, 40]) add("smaOf", `C40, n = ${n}`, C40, n);
add("smaOf", "series shorter than the window: all NaN", C40, 41);
add("smaOf", "empty series", [], 3);
add("smaOf", "hand vector [1..5], n = 3", [1, 2, 3, 4, 5], 3);
add("smaOf", "negative and fractional values", [-1.5, 2.25, -3.125, 4.0625, 0], 2);

for (const n of [1, 3, 5, 12, 26]) add("emaOf", `C40, n = ${n}`, C40, n);
add("emaOf", "from = 3 (seed window starts at 3)", C40, 5, 3);
add("emaOf", "from leaves fewer than n values: all NaN", C40, 5, 37);
add("emaOf", "hand vector [1..5], n = 3", [1, 2, 3, 4, 5], 3);
add("emaOf", "series with NaN prefix, from = 4 (the MACD signal usage)", [NaN, NaN, NaN, NaN, 1, 2, 3, 4, 5, 4, 3], 3, 4);

add("rsiOf", "C40, default n = 14", C40);
add("rsiOf", "C40, n = 5", C40, 5);
add("rsiOf", "C70, n = 14", C70, 14);
add("rsiOf", "rising only: 100", UP, 14);
add("rsiOf", "falling only: 0", DOWN, 14);
add("rsiOf", "flat: down = 0 answers 100 before up = 0 is asked", FLAT, 14);
add("rsiOf", "alternating +1 / -1", ZIGZAG, 14);
add("rsiOf", "length <= n: all NaN", C40.slice(0, 14), 14);
add("rsiOf", "length n + 1: one value", C40.slice(0, 15), 14);

add("bollingerOf", "C40, default (20, 2)", C40);
add("bollingerOf", "C40, (5, 1.5)", C40, 5, 1.5);
add("bollingerOf", "flat series: zero deviation", FLAT);
add("bollingerOf", "shorter than n: all NaN", C40.slice(0, 10));

add("macdOf", "C70", C70);
add("macdOf", "C40 (signal has 15 values)", C40);
add("macdOf", "exactly 26 closes (one MACD value, no signal)", C40.slice(0, 26));
add("macdOf", "shorter than 26: all NaN", C40.slice(0, 20));

add("crossesOf", "touches on the line are not crossings: three crossings, at 2, 4 and 6", [1, 2, 3, 2, 1, 2, 3], [2, 2, 2, 2, 2, 2, 2]);
add("crossesOf", "a touch that turns back is none", [1, 2, 1, 2, 3], [2, 2, 2, 2, 2]);
add("crossesOf", "NaN bars are skipped", [NaN, 1, NaN, 3, 1, 3], [1, 2, 2, NaN, 2, 2]);
add("crossesOf", "equal from the start", [1, 1, 1], [1, 1, 1]);

const W600 = widths(600, 19, SEED);
add("squeezeBelow", "seeded widths, 600 bars, defaults (500, 0.1)", W600);
add("squeezeBelow", "the same, size 50", W600, 50);
add("squeezeBelow", "the same, size 50, p = 0.25", W600, 50, 0.25);
add("squeezeBelow", "shorter than the window: all zero", W600.slice(0, 200));
add("squeezeBelow", "size 5, hand widths", [NaN, 5, 4, 3, 2, 1, 2, 3, 0.5, 4], 5, 0.2);
// A daily squeeze needs the newest width to be the lowest of 182 days: pin two such days at the end
// (below the generator's floor of 0.002, so nothing before them ties).
const W400 = widths(400, 19, SEED + 1);
W400[398] = 0.001;
W400[399] = 0.001;
add("squeezeLowest", "seeded widths, 400 days, default 182, the last two days the lowest", W400);
add("squeezeLowest", "the same without the pinned days", widths(400, 19, SEED + 1));
add("squeezeLowest", "size 5, hand widths", [3, 2, 4, 1, 5, 0.5, 2, 2], 5);
add("squeezeLowest", "NaN at the window start suppresses the flag", [NaN, 2, 3, 1, 1, 1], 4);

const SW = (kind, i, price) => ({ kind, i, price });
add("divergencesOf", "two highs (bearish) and two lows (bullish)",
  [SW("high", 2, 100), SW("low", 4, 90), SW("high", 6, 105), SW("low", 8, 85), SW("high", 10, 103), SW("low", 12, 88)],
  [0, 0, 70, 0, 30, 0, 65, 0, 35, 0, 66, 0, 40]);
add("divergencesOf", "confirmation (price and RSI both higher) and a lower high with a higher RSI are not divergences",
  [SW("high", 1, 10), SW("high", 3, 12), SW("high", 5, 11), SW("low", 2, 5), SW("low", 4, 6)], [0, 50, 40, 60, 30, 70]);
add("divergencesOf", "a swing on a NaN RSI is skipped", [SW("high", 1, 10), SW("high", 3, 12), SW("high", 5, 14)], [NaN, 60, NaN, NaN, NaN, 55]);
add("divergencesOf", "no swings", [], [1, 2, 3]);

// ---- 4: run and encode ------------------------------------------------------------------------------------

function enc(x) {
  if (typeof x === "number") {
    if (Number.isNaN(x)) return "NaN";
    if (x === Infinity) return "Infinity";
    if (x === -Infinity) return "-Infinity";
    if (Object.is(x, -0)) return "-0";
    return x;
  }
  if (x instanceof Float64Array || x instanceof Uint8Array) return { $type: x.constructor.name, v: Array.from(x, enc) };
  if (Array.isArray(x)) return x.map(enc);
  if (x !== null && typeof x === "object") {
    const out = {};
    for (const k of Object.keys(x)) out[k] = enc(x[k]);
    return out;
  }
  return x;
}

for (const c of cases) {
  // The arguments are deep-copied through the encoding first: the baseline must see what the test will pass.
  const args = c.args.map((a) => JSON.parse(JSON.stringify(enc(a))));
  const live = c.args.map((a) => (Array.isArray(a) ? a.slice() : a));
  c.expect = enc(fn[c.fn](...live));
  c.args = args;
}

const provenance = {
  kind: "synthetic",
  expectationSource: "baseline-8c82ca1",
  generator: "tests/reference/record_baseline.mjs",
  seed: SEED,
  source: `Inputs and outputs of the nine indicator functions of ${BASELINE}:src/explorer.js (lines ${FIRST_LINE}-${LAST_LINE}), run unmodified; inputs are hand-written series and, for the squeeze cases, seeded synthetic bandwidth series (tests/support/rng.js mulberry32). Not market data.`,
  extractedOn: new Date().toISOString().slice(0, 10),
  notes: "Expected values are what the baseline functions returned, recorded once; the fixture also stores the text of each baseline function so that the moved copy can be compared with it after reversing its part-23 names. Numbers JSON cannot carry are the strings NaN, Infinity, -Infinity and -0; typed arrays are {$type, v}. Re-record with tests/reference/record_baseline.mjs (needs the git history).",
};
const fixture = { baseline: BASELINE, lines: [FIRST_LINE, LAST_LINE], constants, sources, cases };
const files = {
  "baseline-8c82ca1.json": JSON.stringify(fixture, null, 1) + "\n",
  "provenance.json": JSON.stringify(provenance, null, 2) + "\n",
};

if (process.argv.includes("--check")) {
  // The date in provenance.json is the recording day, not part of what is compared.
  const strip = (s) => s.replace(/"extractedOn": "[^"]*"/, "");
  let bad = 0;
  for (const [name, text] of Object.entries(files)) {
    const have = fs.existsSync(path.join(OUT, name)) ? fs.readFileSync(path.join(OUT, name), "utf8") : null;
    if (have === null || strip(have) !== strip(text)) {
      console.error(`differs: ${path.join("tests/fixtures/indicators-baseline", name)}`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log("indicators-baseline fixture matches a fresh recording");
} else {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), text);
  console.log(`wrote ${cases.length} cases to tests/fixtures/indicators-baseline/`);
}
