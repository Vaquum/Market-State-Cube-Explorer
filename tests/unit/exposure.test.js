"use strict";
// U13 (T-measure): exposure, Short exposure and cell state of src/encoding.js E.measure (part 05).
// Oracles (none is the code under test): hand-computed vectors of API.md C.1.3 and the U13 row of TESTPLAN.md
// (n = 4: nominal 900 s, 89.99 s short and 90 s not; m = 1: nominal 250 USDT, 24.99 short and 25 not; fractions
// 0.0625 short, 0.125 not, exactly 0.1 not; a fractional cutoff 3214082.1333 gives 7.5 s in the open column);
// the closed-form arithmetic of a uniform-rate cell (the Intensity of a partial cell equals the whole cell's,
// the Amount is in the ratio of the covered portion). No expectation is computed by calling the module.
// The module may be evaluated in a vm context: records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const GEOM = { BASE: 56.25, PR: 125 };
const WIDE = [-Infinity, Infinity, -Infinity, Infinity];
// One cell; the nominal span is 2**n columns of 56.25 s and 2**m rows of 125 USDT.
function exposure(over) {
  const o = Object.assign({ z: { c: 0, r: 0 }, b: WIDE, cut: Infinity, end: Infinity, ts: 16, ps: 2, geom: GEOM }, over);
  return E.measure.exposure(o.z, o.b, o.cut, o.end, o.ts, o.ps, o.geom, o.out);
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("a whole cell: full seconds and width, both fractions exactly 1, nominal span of the EFFECTIVE level", () => {
  const e = exposure({});
  assert.equal(e.seconds, 900);
  assert.equal(e.width, 250);
  assert.equal(e.timeFraction, 1);
  assert.equal(e.priceFraction, 1);
  assert.equal(e.nominalSeconds, 900);
  assert.equal(e.nominalWidth, 250);
  assert.equal(e.coverage, "range");
  assert.equal(e.coveredTo, null);
  // Another level: n = 0, m = 0 is one base column and one base row.
  const b = exposure({ ts: 1, ps: 1 });
  assert.deepEqual([b.seconds, b.width, b.nominalSeconds, b.nominalWidth], [56.25, 125, 56.25, 125]);
  // A cell away from the origin: the position does not matter, only its overlap with the bounds.
  const far = exposure({ z: { c: 7, r: 40 }, b: [0, 1e9, 0, 1e9] });
  assert.deepEqual([far.seconds, far.width, far.timeFraction, far.priceFraction], [900, 250, 1, 1]);
});

test("viewport-cut, selection-cut, cutoff-cut and motion-end-cut cells", () => {
  // The rectangle cuts the cell's time in half and its price to a quarter.
  let e = exposure({ b: [0, 8, 0, 0.5] });
  assert.deepEqual([e.seconds, e.width, e.timeFraction, e.priceFraction], [450, 62.5, 0.5, 0.25]);
  // A rectangle that starts inside the cell.
  e = exposure({ b: [4, 100, 1, 100] });
  assert.deepEqual([e.seconds, e.width, e.timeFraction, e.priceFraction], [675, 125, 0.75, 0.5]);
  // The cutoff (activeCutoff, base units) cuts time only.
  e = exposure({ cut: 12 });
  assert.deepEqual([e.seconds, e.width, e.timeFraction, e.priceFraction], [675, 250, 0.75, 1]);
  // The motion end cuts time only and marks the coverage as reaching "the end".
  e = exposure({ end: 4 });
  assert.deepEqual([e.seconds, e.timeFraction, e.priceFraction, e.coveredTo, e.coverage], [225, 0.25, 1, "end", "range"]);
  // The tightest of rectangle, cutoff and end wins.
  e = exposure({ b: [0, 10, 0, 2], cut: 6, end: 9 });
  assert.equal(e.seconds, 6 * 56.25);
  // A cell wholly outside the rectangle, or after the cutoff: nothing covered, never negative.
  e = exposure({ z: { c: 5, r: 0 }, b: [0, 16, 0, 2] });
  assert.deepEqual([e.seconds, e.timeFraction], [0, 0]);
  e = exposure({ z: { c: 0, r: 9 }, b: [0, 16, 0, 2] });
  assert.deepEqual([e.width, e.priceFraction], [0, 0]);
  e = exposure({ cut: -5 });
  assert.equal(e.seconds, 0);
});

test("the open column: the minute-edge cutoff 3214082.1333 leaves 7.5 s of the last base column", () => {
  // 12:02:00Z is base 3214082.13333...; the column that starts at 3214082 holds 2/15 of a column = 7.5 s.
  // (A double near 3.2e6 has a spacing of 4.7e-10, so the seconds are good to about 1e-8.)
  const cut = 3214082 + 2 / 15;
  const e = exposure({ z: { c: 3214082, r: 0 }, ts: 1, ps: 1, cut });
  assert.ok(near(e.seconds, 7.5, 1e-7), "seconds " + e.seconds);
  assert.ok(near(e.timeFraction, 2 / 15, 1e-9));
  assert.equal(e.priceFraction, 1);
  // At n = 4 the coarse column that starts at 3214080 is covered for 2 + 2/15 base columns (120 s): 0.1333 of it.
  const coarse = exposure({ z: { c: 3214080 / 16, r: 0 }, ts: 16, ps: 1, cut });
  assert.ok(near(coarse.seconds, 120, 1e-7), "seconds " + coarse.seconds);
  assert.ok(near(coarse.timeFraction, (2 + 2 / 15) / 16, 1e-9));
  const state = E.measure.cellState({ c: 3214082, r: 0 }, WIDE, cut, cut, false, 1, 1);
  assert.deepEqual(plain(state), { open: true, portion: false, partial: true }, "partial AND open are separate flags");
});

test("Short exposure is strictly below 10% on the TIME fraction (n = 4: nominal 900 s)", () => {
  const uses = E.measure.usesOf("volume", "intensity");
  // t = 89.99 s is 1.59983 columns; t = 90 s is 1.6 columns, fraction exactly 0.1.
  const t = (seconds) => exposure({ b: [0, seconds / 56.25, 0, 2] });
  const short = t(89.99);
  assert.ok(short.timeFraction < 0.1);
  assert.equal(E.measure.isShort(short, uses), true);
  const edge = t(90);
  assert.equal(edge.timeFraction, 0.1, "1.6 columns of 16 is exactly 0.1: divided in base units, not through 56.25");
  assert.equal(E.measure.isShort(edge, uses), false);
  assert.equal(E.measure.isShort(t(90.01), uses), false);
  // The fractions 0.0625 (1/16) short, 0.125 (2/16) not.
  const sixteenth = exposure({ b: [0, 1, 0, 2] });
  assert.equal(sixteenth.timeFraction, 0.0625);
  assert.equal(E.measure.isShort(sixteenth, uses), true);
  const eighth = exposure({ b: [0, 2, 0, 2] });
  assert.equal(eighth.timeFraction, 0.125);
  assert.equal(E.measure.isShort(eighth, uses), false);
});

test("Short exposure on the PRICE fraction (m = 1: nominal 250 USDT)", () => {
  const uses = E.measure.usesOf("volume", "intensity");
  const w = (usdt) => exposure({ b: [0, 16, 0, usdt / 125] });
  assert.equal(E.measure.isShort(w(24.99), uses), true);
  assert.ok(w(24.99).priceFraction < 0.1);
  assert.equal(w(25).priceFraction, 0.1);
  assert.equal(E.measure.isShort(w(25), uses), false);
  assert.equal(E.measure.isShort(w(25.01), uses), false);
  assert.equal(E.measure.isShort(w(250), uses), false);
});

test("Short exposure is 'on EITHER fraction': one short fraction is enough, both fractions are always reported", () => {
  const uses = E.measure.usesOf("volume", "intensity");
  const timeShort = exposure({ b: [0, 1, 0, 2] });
  const priceShort = exposure({ b: [0, 16, 0, 0.1] });
  const neither = exposure({ b: [0, 16, 0, 2] });
  const both = exposure({ b: [0, 1, 0, 0.1] });
  assert.deepEqual([timeShort.timeFraction, timeShort.priceFraction], [0.0625, 1]);
  assert.deepEqual([priceShort.timeFraction, priceShort.priceFraction], [1, 0.05]);
  assert.deepEqual([E.measure.isShort(timeShort, uses), E.measure.isShort(priceShort, uses), E.measure.isShort(neither, uses), E.measure.isShort(both, uses)], [true, true, false, true]);
});

test("usesOf: the denominators of each measure (DD-70), and which measures can carry the label at all", () => {
  const uses = (m, b) => plain(E.measure.usesOf(m, b));
  for (const m of ["volume", "trades", "delta"]) {
    assert.deepEqual(uses(m, "intensity"), { t: true, w: true }, m + " intensity");
    assert.deepEqual(uses(m, "amount"), { t: false, w: false }, m + " amount");
  }
  assert.deepEqual(uses("path", "spans"), { t: false, w: true });
  assert.deepEqual(uses("path", "perMinute"), { t: true, w: true });
  assert.deepEqual(uses("path", "usdt"), { t: false, w: false });
  assert.deepEqual(uses("dwell", "share"), { t: true, w: false });
  for (const m of ["size", "flow", "flowtrades", "cascade", "geometry"]) assert.deepEqual(uses(m, null), { t: false, w: false }, m);
  assert.deepEqual(uses("path", undefined), { t: false, w: true }, "an unstated Path variant is the default, row spans");
  // The answers are shared frozen objects: usesOf runs per cell.
  assert.equal(E.measure.usesOf("volume", "intensity"), E.measure.usesOf("path", "perMinute"));
  assert.ok(Object.isFrozen(E.measure.usesOf("dwell", "share")));
});

test("Short exposure labels every measure that has an exposure denominator, and never Amount or Path USDT", () => {
  const sliver = exposure({ b: [0, 1, 0, 0.1] }); // both fractions far below 0.1
  const labelled = (measure, basis) => E.measure.isShort(sliver, E.measure.usesOf(measure, basis));
  assert.equal(labelled("volume", "intensity"), true);
  assert.equal(labelled("trades", "intensity"), true);
  assert.equal(labelled("delta", "intensity"), true);
  assert.equal(labelled("path", "spans"), true);
  assert.equal(labelled("path", "perMinute"), true);
  assert.equal(labelled("dwell", "share"), true);
  assert.equal(labelled("volume", "amount"), false);
  assert.equal(labelled("trades", "amount"), false);
  assert.equal(labelled("delta", "amount"), false);
  assert.equal(labelled("path", "usdt"), false);
  assert.equal(labelled("size", "mean"), false);
  assert.equal(labelled("flow", "share"), false);
});

test("DD-70: a Dwell cell with a full time fraction and a price fraction of 0.05 IS short; Path spans the mirror case", () => {
  const dwell = exposure({ b: [0, 16, 0, 0.1] });
  assert.deepEqual([dwell.timeFraction, dwell.priceFraction], [1, 0.05]);
  assert.equal(E.measure.isShort(dwell, E.measure.usesOf("dwell", "share")), true);
  // The same cell as a Path per-minute or Path spans reading is short too; Path USDT is not labelled.
  assert.equal(E.measure.isShort(dwell, E.measure.usesOf("path", "spans")), true);
  assert.equal(E.measure.isShort(dwell, E.measure.usesOf("path", "usdt")), false);
  const timeOnly = exposure({ b: [0, 1, 0, 2] });
  assert.equal(E.measure.isShort(timeOnly, E.measure.usesOf("path", "spans")), true, "Path spans divides by width, but the cue is on either fraction");
});

test("isShort through the kernel: out.short follows the same rule for each measure", () => {
  const short = (over) => {
    const out = {};
    E.measure.cellValue(
      Object.assign(
        { mode: "volume", basis: "amount", pathBasis: "spans", z: { c: 0, r: 0, v: 100, bv: 50, ct: 3, bt: 1, p: 10, w: 0.5 }, bounds: [0, 1, 0, 0.1], cut: 1e9, end: Infinity, geom: GEOM, level: { n: 4, m: 1 } },
        over,
      ),
      out,
    );
    return out.short;
  };
  assert.equal(short({ mode: "volume", basis: "amount" }), false);
  assert.equal(short({ mode: "volume", basis: "intensity" }), true);
  assert.equal(short({ mode: "trades", basis: "intensity" }), true);
  assert.equal(short({ mode: "delta", basis: "intensity" }), true);
  assert.equal(short({ mode: "path", pathBasis: "usdt" }), false);
  assert.equal(short({ mode: "path", pathBasis: "spans" }), true);
  assert.equal(short({ mode: "path", pathBasis: "perMinute" }), true);
  assert.equal(short({ mode: "dwell" }), true);
  assert.equal(short({ mode: "size" }), false);
  assert.equal(short({ mode: "flow" }), false);
  // A whole cell is never short.
  assert.equal(short({ mode: "volume", basis: "intensity", bounds: [0, 16, 0, 2] }), false);
  assert.equal(short({ mode: "dwell", bounds: [0, 16, 0, 2], z: { c: 0, r: 0, w: 100 } }), false);
});

test("missing intervals are not covered time: the coverage is a range, gaps are unobservable", () => {
  const e = exposure({ end: 10 });
  assert.equal(e.coverage, "range");
  assert.equal(e.coveredTo, "end");
  assert.equal(exposure({}).coveredTo, null);
  // Covered time is what the range allows, not what a hypothetical gap-free stream would have delivered.
  assert.equal(exposure({ end: 10 }).seconds, 10 * 56.25);
});

test("uniform-rate fixture: the Intensity of a partial cell equals the whole cell's, the Amount is in the ratio of the portion", () => {
  // A cell that traded at a constant rate: 900 USDT over its 900 s and 250 USDT of price. The measured
  // portion of a half-time cell holds half the amount over half the time.
  const value = (mode, basis, v, bounds) => {
    const out = {};
    E.measure.cellValue({ mode, basis, z: { c: 0, r: 0, v, bv: 0, ct: 1 }, bounds, cut: 1e9, end: Infinity, geom: GEOM, level: { n: 4, m: 1 } }, out);
    return out.value;
  };
  const whole = value("volume", "intensity", 900, [0, 16, 0, 2]);
  const half = value("volume", "intensity", 450, [0, 8, 0, 2]);
  const quarter = value("volume", "intensity", 225, [0, 16, 0, 0.5]);
  assert.equal(whole, 30, "900 USDT in 900 s over 250 USDT: 900*7500/(900*250)");
  assert.ok(near(half, 30, 1e-9));
  assert.ok(near(quarter, 30, 1e-9));
  // Amount: half the time observed is half the amount.
  assert.equal(value("volume", "amount", 450, [0, 8, 0, 2]) / value("volume", "amount", 900, [0, 16, 0, 2]), 0.5);
});

test("zero or unknown exposure is a non-value, never a rate of 1; a positive tiny exposure still divides", () => {
  const out = {};
  const run = (bounds, cut = 1e9) => {
    E.measure.cellValue({ mode: "volume", basis: "intensity", z: { c: 0, r: 0, v: 5 }, bounds, cut, end: Infinity, geom: GEOM, level: { n: 4, m: 1 } }, out);
    return out;
  };
  assert.equal(run([0, 0, 0, 2]).denominator, "covered time");
  assert.equal(run([0, 16, 0, 0]).denominator, "price span");
  assert.equal(run(WIDE, 0).denominator, "covered time");
  const tiny = run([0, 1e-9 / 56.25, 0, 2]);
  assert.equal(tiny.tag, E.result.TAG.finite);
  assert.ok(tiny.value > 0 && Number.isFinite(tiny.value));
  // A fully unknown exposure (NaN bounds) is invalid, never a plausible rate.
  assert.notEqual(run([NaN, NaN, NaN, NaN]).tag, E.result.TAG.finite);
});

test("exposure reuses `out` when given (no allocation) and neutral short/uses are left for the measure to set", () => {
  const out = { seconds: -1, junk: true };
  const e = exposure({ out });
  assert.equal(e, out);
  assert.equal(out.seconds, 900);
  assert.equal(out.short, false);
  assert.deepEqual(plain(out.uses), { t: false, w: false });
  // Without out it returns a fresh complete record.
  const a = exposure({});
  const b = exposure({});
  assert.notEqual(a, b);
  assert.deepEqual(Object.keys(plain(a)).sort(), ["coverage", "coveredTo", "nominalSeconds", "nominalWidth", "priceFraction", "seconds", "short", "timeFraction", "uses", "width"]);
  // geom defaults to the recorded lattice when the caller passes none.
  const d = E.measure.exposure({ c: 0, r: 0 }, WIDE, Infinity, Infinity, 1, 1, undefined);
  assert.deepEqual([d.seconds, d.width], [56.25, 125]);
});

test("cellState: open, portion and partial are separate, one predicate", () => {
  const S = (z, b, cut, CUT, replay, ts, ps) => plain(E.measure.cellState(z, b, cut, CUT, replay, ts, ps));
  const cell = { c: 2, r: 3 };
  const whole = [0, 100, 0, 100];
  // Interior, finished: nothing.
  assert.deepEqual(S(cell, whole, 1000, 1000, false, 4, 2), { open: false, portion: false, partial: false });
  // The cell's column ends after the live edge: open (and partial, it runs past the cutoff).
  assert.deepEqual(S(cell, whole, 10, 10, false, 4, 2), { open: true, portion: false, partial: true });
  // A replay edge before the live edge: partial, but never open (the edge is a choice).
  assert.deepEqual(S(cell, whole, 10, 1000, true, 4, 2), { open: false, portion: false, partial: true });
  assert.deepEqual(S(cell, whole, 10, 10, true, 4, 2), { open: false, portion: false, partial: true });
  // Sticking out of the rectangle on each side: a portion.
  assert.deepEqual(S(cell, [9, 100, 0, 100], 1000, 1000, false, 4, 2), { open: false, portion: true, partial: true });
  assert.deepEqual(S(cell, [0, 11, 0, 100], 1000, 1000, false, 4, 2), { open: false, portion: true, partial: true });
  assert.deepEqual(S(cell, [0, 100, 7, 100], 1000, 1000, false, 4, 2), { open: false, portion: true, partial: true });
  assert.deepEqual(S(cell, [0, 100, 0, 7], 1000, 1000, false, 4, 2), { open: false, portion: true, partial: true });
  // Exactly on the edges is whole.
  assert.deepEqual(S(cell, [8, 12, 6, 8], 12, 12, false, 4, 2), { open: false, portion: false, partial: false });
});

test("exposure and cellState take the EFFECTIVE step of the level, so contexts at other levels differ", () => {
  const z = { c: 1, r: 1 };
  const b = [0, 100, 0, 100];
  const at = (n, m) => exposure({ z, b, ts: 2 ** n, ps: 2 ** m });
  assert.deepEqual([at(0, 0).nominalSeconds, at(3, 0).nominalSeconds, at(3, 2).nominalWidth], [56.25, 450, 500]);
  // The same rectangle cuts a coarser cell differently.
  assert.equal(exposure({ z: { c: 0, r: 0 }, b: [0, 4, 0, 2], ts: 8, ps: 2 }).timeFraction, 0.5);
  assert.equal(exposure({ z: { c: 0, r: 0 }, b: [0, 4, 0, 2], ts: 4, ps: 2 }).timeFraction, 1);
});
