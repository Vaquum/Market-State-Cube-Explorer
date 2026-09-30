"use strict";
// U22 (T-warn): E.warn (part 17), the screen-area accumulator and the two warnings "Scale range exceeded" and
// "Low discrimination" (API.md C.11, DR-11, S1-070/071/120), plus the clip codes they consume (C.5).
//
// Oracles (none is the code under test): hand-counted marks and areas (for example three 10 x 10 marks of
// which one is out of range = 1/3 of the marks and 1/3 of the area); the thresholds written as integers that
// sit exactly on each side of the limit (10 of 100 is not more than 10 %, 11 of 100 is; an area share of
// 2500/10000 is not more than 25 %, 2501/10000 is; 90 of 100 nonzero marks is not more than 90 %, 91 is); the
// LUT band edges by arithmetic (13 of 256 entries = 5.08 % per end: indexes 0..12 and 243..255); and the
// endpoint vocabulary of API.md C.5 (exactly +2 is on the axis, 2 + 1e-9 is overflow). E.ratio.coordinate and
// E.scale.apply only PRODUCE clip codes here, as the real feeders do; they are other parts' code and the
// expectations below do not derive from them.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects are of another realm, so structures
// are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const CLIP = { NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 };
const PLOT = { x0: 0, y0: 0, x1: 100000, y1: 100000 };

// ---- bandOf ---------------------------------------------------------------------------------------------

test("bandOf: 13 of 256 entries per end (indexes 0..12 low, 243..255 high); anything that is not a whole index has none", () => {
  for (let i = 0; i <= 12; i++) assert.equal(E.warn.bandOf(i), "low", "index " + i);
  for (let i = 13; i <= 242; i++) assert.equal(E.warn.bandOf(i), null, "index " + i);
  for (let i = 243; i <= 255; i++) assert.equal(E.warn.bandOf(i), "high", "index " + i);
  // 13 / 256 = 5.078 % per end: the "lowest and highest 5 %" of D4 rounded up to whole LUT entries.
  assert.ok(Math.abs(13 / 256 - 0.0508) < 1e-4);
  // -1 is the encoder's "no index"; it must not read as the low band.
  for (const bad of [-1, 256, 1000, NaN, 12.5, 243.5, Infinity, -Infinity, "3", null, undefined]) assert.equal(E.warn.bandOf(bad), null, String(bad));
});

// ---- the tally: what counts -------------------------------------------------------------------------------

test("a fresh tally is all zero; two tallies share nothing; reset zeroes it", () => {
  const a = E.warn.tally();
  const b = E.warn.tally();
  const keys = ["marks", "outside", "low", "high", "exactLow", "exactHigh", "negInf", "noRef", "nonzero", "lowBand", "highBand", "area", "areaOutside"];
  for (const k of keys) assert.equal(a[k], 0, k);
  a.add(5, CLIP.HIGH, true, true);
  a.addBox(0, 0, 4, 4, PLOT, 100, CLIP.LOW, true, true);
  assert.equal(b.marks, 0);
  assert.equal(a.marks, 2);
  a.reset();
  for (const k of keys) assert.equal(a[k], 0, "after reset " + k);
});

test("only drawn marks with a defined value count: a non-value is not a mark and adds no area", () => {
  const t = E.warn.tally();
  t.add(10, CLIP.NONE, false, true);
  t.addBox(0, 0, 10, 10, PLOT, 10, CLIP.NONE, false, true);
  t.addNoRef();
  assert.equal(t.marks, 0);
  assert.equal(t.area, 0);
  assert.equal(t.noRef, 1, "a no-reference mark is counted for its key only");
  t.add(10, CLIP.NONE, true, true);
  assert.equal(t.marks, 1);
});

test("exact endpoints are on the scale, not outside it; finite overflow and underflow are outside and counted apart", () => {
  const t = E.warn.tally();
  t.add(255, CLIP.EXACT_HIGH, true, true);
  t.add(0, CLIP.EXACT_LOW, true, true);
  t.add(255, CLIP.HIGH, true, true);
  t.add(0, CLIP.LOW, true, true);
  t.add(128, CLIP.NONE, true, true);
  assert.equal(t.marks, 5);
  assert.equal(t.outside, 2);
  assert.equal(t.high, 1);
  assert.equal(t.low, 1);
  assert.equal(t.exactHigh, 1);
  assert.equal(t.exactLow, 1);
});

test("the clip codes of the ratio coordinate feed it: exactly +2 is not clipped, 2 + 1e-9 is finite overflow, -2 - 1e-9 underflow (S1-070)", { skip: E.ratio ? false : "needs part 06-ratio, which a standalone ENCODING_ONLY=warn run does not load" }, () => {
  const t = E.warn.tally();
  const feed = (v) => {
    const c = E.ratio.coordinate(v, -2, 2);
    t.add(E.scale.index(c.t), c.clip, true, v !== 0);
    return c;
  };
  assert.equal(feed(2).clip, CLIP.EXACT_HIGH);
  assert.equal(feed(-2).clip, CLIP.EXACT_LOW);
  assert.equal(feed(1).clip, CLIP.NONE);
  assert.equal(t.outside, 0, "the endpoints are real values on the axis");
  assert.equal(feed(2 + 1e-9).clip, CLIP.HIGH);
  assert.equal(feed(-2 - 1e-9).clip, CLIP.LOW);
  assert.equal(t.outside, 2);
  assert.equal(t.high, 1);
  assert.equal(t.low, 1);
  assert.equal(t.exactHigh, 1);
  assert.equal(t.exactLow, 1);
});

test("a measured zero on a rank scale is {t:0, clip:NONE}: it is not below the support, so it is never counted as out of range (DR-40)", () => {
  const fit = E.scale.fitRank([1, 2, 3, 5, 8]);
  assert.equal(fit.state, "ok");
  const out = { t: 9, clip: 9, state: null };
  const t = E.warn.tally();
  E.scale.apply(fit.descriptor, 0, out);
  assert.equal(out.t, 0);
  assert.equal(out.clip, CLIP.NONE);
  t.add(E.scale.index(out.t), out.clip, true, false);
  // a positive value BELOW the support is a real underflow and IS counted
  E.scale.apply(fit.descriptor, 0.5, out);
  assert.equal(out.clip, CLIP.LOW);
  t.add(E.scale.index(out.t), out.clip, true, true);
  assert.equal(t.marks, 2);
  assert.equal(t.outside, 1);
  assert.equal(t.low, 1);
  // a sparse view: 50 empty cells and 5 real ones inside the support never raise "Scale range exceeded"
  const sparse = E.warn.tally();
  for (let i = 0; i < 50; i++) {
    E.scale.apply(fit.descriptor, 0, out);
    sparse.add(E.scale.index(out.t), out.clip, true, false);
  }
  for (const v of [1, 2, 3, 5, 8]) {
    E.scale.apply(fit.descriptor, v, out);
    sparse.add(E.scale.index(out.t), out.clip, true, true);
  }
  assert.equal(sparse.outside, 0);
  assert.equal(E.warn.evaluate(sparse).rangeExceeded, false);
});

test("a nonzero value under a zero-only calibration is out of domain (clip HIGH) and is counted as outside (DD-95)", () => {
  const t = E.warn.tally();
  const d = E.scale.zeroOnly(false);
  const out = { t: 0, clip: 0, state: null };
  E.scale.apply(d, 0, out);
  t.add(E.scale.index(out.t), out.clip, true, false);
  E.scale.apply(d, 5, out);
  assert.equal(out.state, "out-of-domain");
  t.add(E.scale.index(out.t), out.clip, true, true);
  assert.equal(t.marks, 2);
  assert.equal(t.outside, 1);
});

test("negative infinity is an occupied mark AND an out-of-range one (DR-11); no-reference is neither", () => {
  const t = E.warn.tally();
  t.add(128, CLIP.NONE, true, true);
  t.addNegInf();
  t.addBoxNegInf(0, 0, 10, 10, PLOT);
  t.addNoRef();
  t.addNoRef();
  assert.equal(t.marks, 3);
  assert.equal(t.outside, 2);
  assert.equal(t.negInf, 2);
  assert.equal(t.noRef, 2);
  assert.equal(t.area, 100);
  assert.equal(t.areaOutside, 100);
});

test("zero never counts toward the LUT bands: only NONZERO marks have a low or high band", () => {
  const t = E.warn.tally();
  for (let i = 0; i < 10; i++) t.add(0, CLIP.NONE, true, false);
  t.add(0, CLIP.NONE, true, true);
  t.add(12, CLIP.NONE, true, true);
  t.add(13, CLIP.NONE, true, true);
  t.add(243, CLIP.NONE, true, true);
  t.add(242, CLIP.NONE, true, true);
  assert.equal(t.nonzero, 5);
  assert.equal(t.lowBand, 2);
  assert.equal(t.highBand, 1);
  assert.equal(t.marks, 15);
});

// ---- screen area ------------------------------------------------------------------------------------------

test("hand example (DR-11): three 10 x 10 marks, one out of range = 33.33 % of the marks and 33.33 % of the area", () => {
  const t = E.warn.tally();
  t.addBox(0, 0, 10, 10, PLOT, 100, CLIP.NONE, true, true);
  t.addBox(10, 0, 20, 10, PLOT, 100, CLIP.NONE, true, true);
  t.addBox(20, 0, 30, 10, PLOT, 255, CLIP.HIGH, true, true);
  const r = E.warn.evaluate(t);
  assert.equal(t.area, 300);
  assert.equal(t.areaOutside, 100);
  assert.ok(Math.abs(r.shares.marks - 1 / 3) < 1e-15);
  assert.ok(Math.abs(r.shares.area - 1 / 3) < 1e-15);
  assert.equal(r.rangeExceeded, true, "33 % is more than 10 % of the marks");
});

test("a mark's area is clipped to the plot AND the measurement rectangle; a box with nothing on screen is not a drawn mark", () => {
  const t = E.warn.tally();
  const clip = { plot: { x0: 0, y0: 0, x1: 100, y1: 100 }, meas: { x0: 50, y0: 0, x1: 100, y1: 100 } };
  // x 40..60 is cut to 50..60 by the measurement rectangle; y 10..20 is whole: 10 x 10 = 100.
  t.addBox(40, 10, 60, 20, clip, 100, CLIP.NONE, true, true);
  assert.equal(t.area, 100);
  // wholly left of the measurement rectangle, wholly below the plot: nothing on screen.
  t.addBox(0, 0, 40, 10, clip, 100, CLIP.NONE, true, true);
  t.addBox(60, 200, 70, 210, clip, 100, CLIP.HIGH, true, true);
  assert.equal(t.marks, 1);
  assert.equal(t.area, 100);
  assert.equal(t.outside, 0);
  // a plain {x0, y0, x1, y1} rectangle clips too; overhang past the plot edge is cut: 90..110 -> 90..100.
  t.addBox(90, 0, 110, 10, { x0: 0, y0: 0, x1: 100, y1: 100 }, 100, CLIP.HIGH, true, true);
  assert.equal(t.area, 200);
  assert.equal(t.areaOutside, 100);
});

test("a measurement rectangle of null leaves just the plot; sub-pixel marks are included", () => {
  const t = E.warn.tally();
  t.addBox(0, 0, 0.5, 0.5, { plot: { x0: 0, y0: 0, x1: 10, y1: 10 }, meas: null }, 100, CLIP.NONE, true, true);
  assert.equal(t.marks, 1);
  assert.equal(t.area, 0.25);
});

// ---- thresholds: strictly more than ---------------------------------------------------------------------

function marksTally(outside, total) {
  const t = E.warn.tally();
  for (let i = 0; i < total; i++) t.add(128, i < outside ? CLIP.HIGH : CLIP.NONE, true, true);
  return t;
}

test("Scale range exceeded by marks: 10 of 100 is not more than 10 %, 11 of 100 is (S1-120)", () => {
  assert.equal(E.warn.evaluate(marksTally(10, 100)).rangeExceeded, false);
  assert.equal(E.warn.evaluate(marksTally(11, 100)).rangeExceeded, true);
  // tenths that floating point would miss by a hair if the test multiplied: 7 of 70, 3 of 30.
  assert.equal(E.warn.evaluate(marksTally(7, 70)).rangeExceeded, false);
  assert.equal(E.warn.evaluate(marksTally(3, 30)).rangeExceeded, false);
  assert.equal(E.warn.evaluate(marksTally(4, 30)).rangeExceeded, true);
  assert.equal(E.warn.evaluate(marksTally(0, 0)).rangeExceeded, false, "no marks, no warning");
});

// 10 marks inside plus one outside keep the mark share at 1/11 = 9.1 %, so only the AREA can warn.
function areaTally(outsideArea, insideAreas) {
  const t = E.warn.tally();
  t.addBox(0, 0, outsideArea, 1, PLOT, 255, CLIP.HIGH, true, true);
  for (const a of insideAreas) t.addBox(0, 10, a, 11, PLOT, 100, CLIP.NONE, true, true);
  return t;
}

test("Scale range exceeded by area: 25.00 % is not more than 25 %, 25.01 % is", () => {
  // total area 10000 in both: 2500 + 7500 and 2501 + 7499 (nine boxes of 833 and one of 2 / 0 adjusted).
  const inside = [833, 833, 833, 833, 833, 833, 833, 833, 833, 3];
  assert.equal(inside.reduce((a, b) => a + b, 0), 7500);
  const exact = E.warn.evaluate(areaTally(2500, inside));
  assert.equal(exact.shares.area, 0.25);
  assert.ok(exact.shares.marks < 0.1, "1 of 11 marks");
  assert.equal(exact.rangeExceeded, false);
  const over = E.warn.evaluate(areaTally(2501, inside.slice(0, 9).concat([2])));
  assert.equal(over.shares.area, 2501 / 10000);
  assert.equal(over.rangeExceeded, true);
});

test("Low discrimination: more than 90 % of the NONZERO marks in one band; 90 of 100 is not, 91 is; each end on its own", () => {
  const lowTally = (k, n) => {
    const t = E.warn.tally();
    for (let i = 0; i < n; i++) t.add(i < k ? 3 : 100, CLIP.NONE, true, true);
    return t;
  };
  assert.equal(E.warn.evaluate(lowTally(90, 100)).lowDiscrimination, null);
  assert.equal(E.warn.evaluate(lowTally(91, 100)).lowDiscrimination, "low");
  const highTally = (k, n) => {
    const t = E.warn.tally();
    for (let i = 0; i < n; i++) t.add(i < k ? 250 : 100, CLIP.NONE, true, true);
    return t;
  };
  assert.equal(E.warn.evaluate(highTally(90, 100)).lowDiscrimination, null);
  assert.equal(E.warn.evaluate(highTally(91, 100)).lowDiscrimination, "high");
  // a bimodal cohort split 50/50 across both ends does NOT warn: neither end holds more than 90 %.
  const both = E.warn.tally();
  for (let i = 0; i < 100; i++) both.add(i < 50 ? 2 : 250, CLIP.NONE, true, true);
  assert.equal(E.warn.evaluate(both).lowDiscrimination, null);
  // zero marks are outside the denominator: 91 low + 9 zero, nothing else, is 100 % of the nonzero marks.
  const zeros = E.warn.tally();
  for (let i = 0; i < 91; i++) zeros.add(2, CLIP.NONE, true, true);
  for (let i = 0; i < 9; i++) zeros.add(0, CLIP.NONE, true, false);
  assert.equal(E.warn.evaluate(zeros).lowDiscrimination, "low");
});

test("a natural fixed domain reports its clip counts but never warns; explicit thresholds override the defaults", () => {
  const t = marksTally(50, 100);
  const fixed = plain(E.warn.evaluate(t, { meaningful: false }));
  assert.equal(fixed.rangeExceeded, false);
  assert.equal(fixed.lowDiscrimination, null);
  assert.deepEqual(fixed.warnings, []);
  // even a pile-up at one end is not reported on a natural domain
  const pile = E.warn.tally();
  for (let i = 0; i < 100; i++) pile.add(1, CLIP.NONE, true, true);
  assert.equal(E.warn.evaluate(pile).lowDiscrimination, "low");
  assert.equal(E.warn.evaluate(pile, { meaningful: false }).lowDiscrimination, null);
  assert.equal(fixed.counts.high, 50, "the clip counts are still there for the legend key");
  assert.equal(fixed.shares.marks, 0.5);
  assert.equal(E.warn.evaluate(marksTally(11, 100), { marks: 0.2 }).rangeExceeded, false);
});

test("the report carries the actual shares and counts, and evaluating changes neither the tally nor a later answer", () => {
  const t = E.warn.tally();
  t.addBox(0, 0, 10, 10, PLOT, 3, CLIP.NONE, true, true);
  t.addBox(10, 0, 20, 10, PLOT, 250, CLIP.HIGH, true, true);
  const before = plain(t);
  const a = plain(E.warn.evaluate(t));
  const b = plain(E.warn.evaluate(t));
  assert.deepEqual(a, b);
  assert.deepEqual(plain(t), before);
  assert.deepEqual(a.shares, { marks: 0.5, area: 0.5, low: 0.5, high: 0.5 });
  assert.deepEqual(
    a.warnings.map((w) => w.id),
    ["range-exceeded"],
    "a 50/50 split across the ends is not low discrimination"
  );
  assert.equal(a.counts.marks, 2);
  assert.equal(a.counts.area, 200);
  assert.equal(a.meaningful, true);
});

test("an empty pass reports zeros, not NaN, and no warning", () => {
  const r = plain(E.warn.evaluate(E.warn.tally()));
  assert.deepEqual(r.shares, { marks: 0, area: 0, low: 0, high: 0 });
  assert.equal(r.rangeExceeded, false);
  assert.equal(r.lowDiscrimination, null);
  assert.deepEqual(r.warnings, []);
  JSON.stringify(r);
});

test("namespace shape: tally, evaluate, bandOf; frozen", () => {
  assert.deepEqual(Object.keys(E.warn).sort(), ["bandOf", "evaluate", "tally"]);
  assert.ok(Object.isFrozen(E.warn));
});

test("hot path (INTEGRATION D.15): add and addBox build nothing per mark", () => {
  const t = E.warn.tally();
  for (const fn of [t.add, t.addBox, t.addNegInf, t.addBoxNegInf]) {
    const src = fn.toString();
    for (const bad of ["new ", ".map(", ".filter(", ".slice(", ".sort(", "...", "Object.assign", "Array.from", "d3."]) assert.equal(src.indexOf(bad), -1, bad + " in " + src.slice(0, 40));
  }
  const heap = () => process.memoryUsage().heapUsed;
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    const before = heap();
    const clip = { plot: { x0: 0, y0: 0, x1: 500, y1: 500 }, meas: { x0: 10, y0: 10, x1: 400, y1: 400 } };
    for (let i = 0; i < 1e6; i++) t.addBox(20 + (i % 300), 20, 24 + (i % 300), 24, clip, i % 256, i % 5, true, i % 3 !== 0);
    globalThis.gc();
    assert.ok(heap() - before < 1024 * 1024, "1e6 marks grew the heap by more than 1 MB");
    assert.ok(t.marks > 0);
  }
});
