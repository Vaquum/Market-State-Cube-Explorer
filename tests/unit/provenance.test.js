"use strict";
// U30 (T-model): E.model of src/encoding.js, loaded through tests/support/enc.js.
//
// Oracles (none is the code under test):
//   1. The record of API.md B.13 / DR-13, transcribed by hand below (ISO_A -1.06, ISO_B 0.486, fit range
//      6..13, history start 2021-01-01, extraction 2026-09-24, unknowns null, upper bound 2026-09-25).
//   2. `Date.UTC` for the two boundary instants (the part holds them as literals) and the lattice
//      arithmetic of the page for the base positions of API.md A.5 (T0 = 1609459200 s, BASE = 56.25 s per
//      base column: position * 56.25 + T0, in seconds), for the four status vectors and the recorded page's
//      cutoff (base 3214083 = 2026-09-24T12:02:48.75Z).
//   3. `Math.pow(2, 0.486 - 1)` for the baseline, and hand tables for the applicability rule.
//   4. A text lint on every string the module can return.
// E.model.describe and E.model.fit read their words from E.text (part 04) when they are asked for them.
// While part 04 does not exist the tests run on a stub part 04 assembled in a temporary directory beside
// the real parts, with the model strings of INTEGRATION.md D.11; once part 04 exists the real one is
// used (`only: model, text`), so the same file runs unchanged at gate A0. The module may be evaluated in a
// vm context (ENCODING_PARTS_DIR), so records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const E = require("../support/enc");
const { mulberry32 } = require("../support/rng");

// The module can be of another realm (vm context): errors are matched by name.
const isTypeError = (e) => e.name === "TypeError";
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---- the module with words ---------------------------------------------------------------------------------

const STUB_TEXT = `  // @part 04-text
  // @requires
  // @prefix txt
  // @provides text
  // Test stub of part 04: the model strings and the vintage sentence of INTEGRATION.md D.11.
  API.text = Object.freeze({
    model: Object.freeze({
      retrospective: "Retrospective model: estimated on later data than this cutoff (external reference)",
      timingUnverified: "Model timing unverified: estimated on 2026-09-24 data",
      eligibleByBound: "Model estimated before this cutoff by the conservative bound 2026-09-25 00:00 UTC (exact time unknown)",
      extrapolated: "Model extrapolated beyond fitted levels",
      exactUnknown: "Exact fit time and method version are unknown",
      applicability: "Range-derived model applied to touched rows; not proven neutral at every level",
      diagonalUse: "The diagonal chooser uses the same fitted model (ISO_A -1.06, n = 6 to 13)",
    }),
    vintage: "Replay on currently available history; original vintages not guaranteed",
  });
`;

const partsDir = process.env.ENCODING_PARTS_DIR ? path.resolve(process.env.ENCODING_PARTS_DIR) : null;
const { loadParts } = require("../support/assemble-encoding.js");

// M: a module that has both E.model and the words.
function withWords() {
  if (E.text && E.text.model && typeof E.text.vintage === "string") return E;
  if (!partsDir) return null;
  if (fs.existsSync(path.join(partsDir, "04-text.js"))) return loadParts({ dir: partsDir, only: ["model", "text"] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u30-parts-"));
  try {
    for (const f of ["00-header.js", "18-model.js", "99-footer.js"]) fs.copyFileSync(path.join(partsDir, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, "04-text.js"), STUB_TEXT);
    return loadParts({ dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const M = withWords();
const needM = { skip: M === null && "needs ENCODING_PARTS_DIR or a module that has E.text" };
const model = E.model;

// ---- the record (B.13, DR-13) -----------------------------------------------------------------------------

const RECORD = {
  id: "efficiency-diagonal@1",
  formula: "log2((Echild/Eparent)/2**(ISO_B-1))",
  ISO_A: -1.06,
  ISO_B: 0.486,
  baseline: 0.7002781604436024,
  fit: {
    method: "least squares of log2(median column price range / 125) against n",
    exponentText: "0.49",
    nMin: 6,
    nMax: 13,
    historyStart: "2021-01-01T00:00:00Z",
    extraction: "2026-09-24",
  },
  estimatedAt: null,
  precision: null,
  methodVersion: null,
  latestTrainingObservation: null,
  eligibilityUpperBound: "2026-09-25T00:00:00Z",
  appliesTo: ["efficiency", "diagonal"],
  applicability: "range-derived model applied to touched rows; not proven neutral at every level",
};

test("E.model exposes exactly PROVENANCE, status, fit, describe (DD-54: no E.MODEL_PROVENANCE)", () => {
  assert.deepEqual(Object.keys(model).sort(), ["PROVENANCE", "describe", "fit", "status"]);
  assert.ok(Object.isFrozen(model));
  assert.equal(E.MODEL_PROVENANCE, undefined);
  assert.equal(model.status.length, 1);
  assert.equal(model.fit.length, 2);
  assert.equal(model.describe.length, 3);
});

test("PROVENANCE holds the recorded values of DR-13 and nothing else", () => {
  assert.deepEqual(plain(model.PROVENANCE), RECORD);
  const p = model.PROVENANCE;
  assert.equal(p.ISO_A, -1.06);
  assert.equal(p.ISO_B, 0.486);
  assert.equal(p.fit.nMin, 6);
  assert.equal(p.fit.nMax, 13);
  assert.equal(p.fit.historyStart.slice(0, 10), "2021-01-01");
  assert.equal(p.fit.extraction, "2026-09-24");
});

test("the baseline is the actual 2 ** (ISO_B - 1) = 0.7003, not the rounded 0.70", () => {
  const p = model.PROVENANCE;
  assert.equal(p.baseline, Math.pow(2, p.ISO_B - 1));
  assert.equal(p.baseline, 0.7002781604436024);
  assert.notEqual(p.baseline, 0.7);
});

test("the unknowns stay unknown: fit time, precision, method version and last training observation are null", () => {
  const p = model.PROVENANCE;
  for (const key of ["estimatedAt", "precision", "methodVersion", "latestTrainingObservation"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(p, key), `${key} is present (unknown is recorded, not omitted)`);
    assert.equal(p[key], null, key);
  }
});

test("the upper bound is a conservative eligibility bound, never worded as a training or estimation time", () => {
  const p = model.PROVENANCE;
  assert.equal(p.eligibilityUpperBound, "2026-09-25T00:00:00Z");
  assert.equal(Date.parse(p.eligibilityUpperBound), 1790294400000);
  assert.ok(Date.parse(p.eligibilityUpperBound) >= Date.parse(p.fit.extraction), "the bound is not before the extraction");
  const text = JSON.stringify(p);
  assert.doesNotMatch(text, /trained|training on|estimated at|estimated on|fitted at|vintage recovered|revised|verified revision/i);
  for (const key of Object.keys(p)) assert.doesNotMatch(key, /^(trainedAt|trainingEnd|fittedAt|trainedOn)$/);
});

test("the record is JSON-safe and survives a round trip unchanged (the portable payload's models[] block)", () => {
  const walk = (x, at) => {
    if (x === null || typeof x === "string" || typeof x === "boolean") return;
    if (typeof x === "number") return assert.ok(Number.isFinite(x), `${at} is finite`);
    assert.ok(typeof x === "object", `${at} is a plain value`);
    for (const k of Object.keys(x)) walk(x[k], `${at}.${k}`);
  };
  walk(model.PROVENANCE, "PROVENANCE");
  assert.deepEqual(plain(plain(model.PROVENANCE)), RECORD);
});

test("the record is frozen all the way down", () => {
  const p = model.PROVENANCE;
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.fit) && Object.isFrozen(p.appliesTo));
  assert.throws(() => {
    "use strict";
    p.ISO_B = 0.5;
  }, isTypeError);
  assert.throws(() => {
    "use strict";
    p.fit.nMax = 20;
  }, isTypeError);
  assert.throws(() => {
    "use strict";
    p.appliesTo.push("x");
  }, isTypeError);
});

// ---- status (C.14, DD-35) -------------------------------------------------------------------------------------

// The page's lattice (API.md A.5): milliseconds of a base position.
const T0 = 1609459200;
const BASE = 56.25;
const ms = (base) => (T0 + base * BASE) * 1000;

test("the boundaries are 2026-09-24T00:00Z and 2026-09-25T00:00Z (Date.UTC as oracle) at base 3213312 and 3214848", () => {
  assert.equal(ms(3213312), Date.UTC(2026, 8, 24));
  assert.equal(ms(3214848), Date.UTC(2026, 8, 25));
  assert.equal(Date.UTC(2026, 8, 24), 1790208000000);
  assert.equal(Date.UTC(2026, 8, 25), 1790294400000);
});

test("status at the four base positions of API.md A.5", () => {
  assert.equal(model.status(ms(3213311.99)), "retrospective");
  assert.equal(model.status(ms(3213312)), "timing-unverified");
  assert.equal(model.status(ms(3214847.99)), "timing-unverified");
  assert.equal(model.status(ms(3214848)), "eligible-by-bound");
});

test("status is exact to the millisecond around both boundaries", () => {
  const a = Date.UTC(2026, 8, 24);
  const b = Date.UTC(2026, 8, 25);
  assert.equal(model.status(a - 1), "retrospective");
  assert.equal(model.status(a), "timing-unverified");
  assert.equal(model.status(b - 1), "timing-unverified");
  assert.equal(model.status(b), "eligible-by-bound");
});

test("the recorded page's cutoff (base 3214083 = 2026-09-24T12:02:48.75Z) is timing-unverified, permanently", () => {
  assert.equal(ms(3214083), 1790251368750);
  assert.equal(new Date(1790251368750).toISOString(), "2026-09-24T12:02:48.750Z");
  assert.equal(model.status(ms(3214083)), "timing-unverified");
});

test("status applies to the effective cutoff in every mode: it takes nothing but the cutoff", () => {
  assert.equal(model.status(0), "retrospective");
  assert.equal(model.status(-1e12), "retrospective");
  assert.equal(model.status(Date.UTC(2021, 0, 1)), "retrospective", "history start");
  assert.equal(model.status(Date.UTC(2030, 0, 1)), "eligible-by-bound");
  // A second argument (a mode, say) changes nothing.
  assert.equal(model.status(ms(3213311.99), "live"), "retrospective");
  assert.equal(model.status(ms(3213311.99), "replay"), "retrospective");
});

test("status is monotone in the cutoff (seeded pairs, every ordered pair never goes back a state)", () => {
  const rank = { retrospective: 0, "timing-unverified": 1, "eligible-by-bound": 2 };
  const next = mulberry32(30);
  const around = Date.UTC(2026, 8, 24);
  for (let k = 0; k < 500; k++) {
    const a = around + Math.floor((next() - 0.5) * 4 * 86400000);
    const b = a + Math.floor(next() * 3 * 86400000);
    assert.ok(rank[model.status(a)] <= rank[model.status(b)], `${a} then ${b}`);
  }
});

test("status refuses a cutoff that is not a finite number (NaN would compare false and read as eligible)", () => {
  for (const bad of [NaN, undefined, null, "1790208000000", Infinity, -Infinity, {}]) assert.throws(() => model.status(bad), (e) => e.name === "TypeError", String(bad));
});

// ---- applicability (C.14, S1-148) ----------------------------------------------------------------------------

test("fit: Efficiency is within only when both n and n + 1 are fitted levels (6 within, 12 within, 13 and 5 extrapolated)", needM, () => {
  const within = (n) => M.model.fit("efficiency", n).within;
  assert.deepEqual([5, 6, 7, 12, 13, 14, 0, 20].map(within), [false, true, true, true, false, false, false, false]);
});

test("fit: the diagonal is within for n in 6..13, extrapolated outside", needM, () => {
  const within = (n) => M.model.fit("diagonal", n).within;
  assert.deepEqual([5, 6, 7, 12, 13, 14, 0, 20].map(within), [false, true, true, true, true, false, false, false]);
});

test("fit answers {within, label}: label is null inside and E.text.model.extrapolated outside", needM, () => {
  const inside = M.model.fit("efficiency", 8);
  assert.deepEqual(Object.keys(inside), ["within", "label"]);
  assert.equal(inside.label, null);
  const outside = M.model.fit("efficiency", 13);
  assert.equal(outside.within, false);
  assert.equal(outside.label, M.text.model.extrapolated);
  assert.match(outside.label, /extrapolated beyond fitted levels/i);
});

test("fit refuses an unknown use and a non-numeric level", () => {
  assert.throws(() => model.fit("cascade", 8), (e) => e.name === "RangeError");
  assert.throws(() => model.fit(undefined, 8), (e) => e.name === "RangeError");
  assert.throws(() => model.fit("efficiency", NaN), (e) => e.name === "TypeError");
  assert.throws(() => model.fit("diagonal", "8"), (e) => e.name === "TypeError");
});

test("fit does not need the words while the model is inside its fitted levels", () => {
  if (partsDir === null) return;
  const bare = loadParts({ dir: partsDir, only: ["model"] });
  assert.equal(bare.text, undefined);
  assert.equal(bare.model.fit("efficiency", 8).label, null);
  assert.equal(bare.model.status(1790251368750), "timing-unverified");
});

// ---- describe (C.14, B.13, S1-145..151) -------------------------------------------------------------------------

const CUTS = {
  retrospective: Date.UTC(2026, 8, 23, 12),
  "timing-unverified": 1790251368750,
  "eligible-by-bound": Date.UTC(2026, 9, 1),
};

test("describe: {status, within, labels, provenance, note} for every status x within, timing label first", needM, () => {
  const T = M.text;
  const timing = { retrospective: [T.model.retrospective], "timing-unverified": [T.model.timingUnverified], "eligible-by-bound": [] };
  for (const [status, cut] of Object.entries(CUTS)) {
    for (const [use, n, within] of [["efficiency", 8, true], ["efficiency", 13, false], ["diagonal", 13, true], ["diagonal", 14, false], ["diagonal", 5, false]]) {
      const note = M.model.describe(use, cut, n);
      assert.deepEqual(Object.keys(note), ["status", "within", "labels", "provenance", "note"], `${status} ${use} ${n}`);
      assert.equal(note.status, status);
      assert.equal(note.within, within);
      assert.deepEqual(plain(note.labels), timing[status].concat(within ? [] : [T.model.extrapolated]), `${status} ${use} ${n}`);
      assert.equal(note.provenance, M.model.PROVENANCE, "the shared record itself, not a copy");
      assert.equal(note.note, T.vintage);
    }
  }
});

test("describe: the labels are the words of E.text.model, and say retrospective / timing unverified / extrapolated", needM, () => {
  const T = M.text;
  assert.match(T.model.retrospective, /retrospective/i);
  assert.match(T.model.timingUnverified, /timing unverified/i);
  assert.match(M.model.describe("efficiency", CUTS.retrospective, 8).labels[0], /retrospective/i);
  assert.match(M.model.describe("efficiency", CUTS["timing-unverified"], 8).labels[0], /timing unverified/i);
  assert.equal(M.model.describe("efficiency", CUTS["eligible-by-bound"], 8).labels.length, 0);
});

test("the recorded page: Efficiency at any fitted level reads timing-unverified, and its extrapolation label is added, not swapped", needM, () => {
  const note = M.model.describe("efficiency", 1790251368750, 13);
  assert.equal(note.status, "timing-unverified");
  assert.equal(note.labels.length, 2);
  assert.equal(note.labels[1], M.text.model.extrapolated);
});

test("describe: the model note is separate from scale eligibility (an eligible scale does not make a later-fitted model eligible)", needM, () => {
  // The scale's own provenance (API.md B.6) as a caller might hold it: eligible, fitted before the cutoff.
  // describe takes the cutoff, never the scale, so no such record can change what it says.
  const eligibleScale = { eligible: true, provenance: { kind: "auto", throughMs: CUTS.retrospective - 60000 } };
  for (const scale of [eligibleScale, null, { eligible: false }]) {
    const note = M.model.describe("efficiency", CUTS.retrospective, 8, scale);
    assert.equal(note.status, "retrospective");
    assert.equal(note.labels[0], M.text.model.retrospective);
  }
  // Three provenance records exist apart (B.2 observation, B.6 scale, B.13 model): a ModelNote has none of
  // the other two, and its `provenance` is the model record only.
  const note = M.model.describe("efficiency", CUTS.retrospective, 8);
  assert.equal(note.observation, undefined);
  assert.equal(note.scale, undefined);
  assert.equal(note.provenance.id, "efficiency-diagonal@1");
});

test("describe survives a portable round trip: the record is unchanged and the status is recomputed from the cutoff, not stored", needM, () => {
  const note = M.model.describe("efficiency", CUTS.retrospective, 8);
  const trip = plain(note);
  assert.deepEqual(trip.provenance, RECORD);
  assert.equal(trip.status, "retrospective");
  // A payload block holds the record and the cutoff; the status of the importing page is recomputed.
  assert.equal(M.model.status(CUTS.retrospective), trip.status);
  assert.equal(M.model.status(CUTS["eligible-by-bound"]), "eligible-by-bound");
});

test("describe refuses what fit and status refuse", needM, () => {
  assert.throws(() => M.model.describe("efficiency", NaN, 8), (e) => e.name === "TypeError");
  assert.throws(() => M.model.describe("nope", CUTS.retrospective, 8), (e) => e.name === "RangeError");
  assert.throws(() => M.model.describe("efficiency", CUTS.retrospective), (e) => e.name === "TypeError");
});

test("no string the module returns claims a recovered vintage, a revision or a training time", needM, () => {
  const seen = [];
  for (const cut of Object.values(CUTS)) {
    for (const use of ["efficiency", "diagonal"]) {
      for (const n of [5, 6, 8, 13, 14]) {
        const note = M.model.describe(use, cut, n);
        seen.push(...note.labels, note.note);
      }
    }
  }
  assert.ok(seen.length > 0);
  for (const s of seen) {
    assert.doesNotMatch(s, /vintage recovered|revised|verified revision|trained|estimated at/i, s);
  }
  assert.ok(seen.some((s) => /original vintages not guaranteed/.test(s)));
});

test("describe reads E.text at call time: without part 04 it fails by naming it, instead of returning wrong words", { skip: partsDir === null && "needs ENCODING_PARTS_DIR to assemble a module without part 04" }, () => {
  const bare = loadParts({ dir: partsDir, only: ["model"] });
  assert.equal(bare.text, undefined);
  assert.throws(() => bare.model.describe("efficiency", CUTS.retrospective, 8), (e) => e.name === "Error" && /04-text/.test(e.message));
  assert.throws(() => bare.model.fit("efficiency", 13), (e) => e.name === "Error" && /04-text/.test(e.message));
});
