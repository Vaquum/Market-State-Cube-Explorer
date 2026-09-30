"use strict";
// U14 (T-ratio): the D2 typed ladder and the ratio kernels of src/encoding.js E.ratio (part 06), plus the
// ordinary-denominator cases of E.measure.columnValue (part 05).
// Oracles (none is the code under test): hand vectors from D2, API.md C.1.7 and C.5 and the U14 row of TESTPLAN.md
// (Cascade +2 / 0 / +1 exactly, the column +1 at half the arm of +2 with LUT index round(0.5*255) = 128, the
// Efficiency identity -0.486 and the baseline 0.7002781604436024 = 2**(0.486-1)); log2 constants written out by
// hand (log2(5) = 2.321928094887362, log2(3) = 1.584962500721156); JSON.stringify round trips for JSON safety;
// the precedence order checked as "the highest-priority condition that is present wins" over all combinations.
// The module may be evaluated in a vm context: records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const BASELINE = 0.7002781604436024;
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

const cascade = (over) => plain(E.ratio.cascade(Object.assign({ structure: "complete", childV: 10, parentV: 40, factor: 4 }, over)));
const efficiency = (over) =>
  plain(E.ratio.efficiency(Object.assign({ structure: "complete", child: { v: 100, rows: 4 }, parent: { v: 400, rows: 10 }, baseline: BASELINE }, over)));

test("Cascade: a cell's share of its parent as log2(4 * share): +2 exactly for the whole parent, 0 at a quarter, +1 at half", () => {
  assert.deepEqual(cascade({ childV: 40, parentV: 40 }), { tag: "finite", value: 2 }, "the cell IS its parent: log2(4) = 2, exactly");
  assert.deepEqual(cascade({ childV: 10, parentV: 40 }), { tag: "finite", value: 0 }, "a quarter: log2(1) = 0, exactly");
  assert.deepEqual(cascade({ childV: 20, parentV: 40 }), { tag: "finite", value: 1 });
  assert.ok(near(cascade({ childV: 30, parentV: 40 }).value, Math.log2(3)));
  assert.ok(near(cascade({ childV: 30, parentV: 40 }).value, 1.584962500721156));
  // A tiny share is a large negative number, unclamped: only the drawing coordinate is ever clipped.
  const tiny = cascade({ childV: 1, parentV: 1e6 });
  assert.equal(tiny.tag, "finite");
  assert.ok(near(tiny.value, Math.log2(4e-6), 1e-9));
  assert.ok(tiny.value < -2);
  // No pseudocount: a vanishing child is still a value, never smoothed toward zero or floored.
  const vanishing = cascade({ childV: 1e-300, parentV: 1 });
  assert.equal(vanishing.tag, "finite");
  assert.ok(vanishing.value < -990);
});

test("Cascade column (factor 2): log2(2 * share), +1 exactly when the column is its whole parent column, 0 at half", () => {
  assert.deepEqual(cascade({ factor: 2, childV: 40, parentV: 40 }), { tag: "finite", value: 1 });
  assert.deepEqual(cascade({ factor: 2, childV: 20, parentV: 40 }), { tag: "finite", value: 0 });
  assert.deepEqual(cascade({ factor: 2, childV: 10, parentV: 40 }), { tag: "finite", value: -1 });
});

test("Cascade: the column +1 sits at exactly half the arm of the cell +2 (signed coordinate 0.5 vs 1, LUT index 128 vs 255)", () => {
  // The fixed axis is -2..+2 with midpoint 0. The signed arm fraction is (t - 0.5) * 2 for t from coordinate().
  const arm = (value) => {
    const c = E.ratio.coordinate(value, -2, 2);
    return { arm: (c.t - 0.5) * 2, clip: c.clip };
  };
  const cell = arm(cascade({ childV: 40, parentV: 40 }).value);
  const column = arm(cascade({ factor: 2, childV: 40, parentV: 40 }).value);
  assert.equal(cell.arm, 1);
  assert.equal(column.arm, 0.5);
  assert.equal(column.arm, cell.arm / 2);
  // LUT index = round(arm * 255) (DR-02): 255 for the +2 cell, 128 for the +1 column.
  assert.equal(Math.round(cell.arm * 255), 255);
  assert.equal(Math.round(column.arm * 255), 128);
  // Neither is clipped as overflow: +2 is an exact endpoint (4), +1 is interior (0).
  assert.equal(cell.clip, 4);
  assert.equal(column.clip, 0);
});

test("Cascade structure is decided before the child: an absent child in an incomplete parent is waiting, not 'no value'", () => {
  assert.deepEqual(cascade({ structure: "coarsest", childV: 10, parentV: 40 }), { tag: "no-coarser-parent" });
  assert.deepEqual(cascade({ structure: "open", childV: undefined, parentV: 40 }), { tag: "waiting-for-complete-parent", open: true });
  assert.deepEqual(cascade({ structure: "open", childV: 10, parentV: 0 }), { tag: "waiting-for-complete-parent", open: true });
  assert.deepEqual(cascade({ structure: "outside", childV: 10 }), { tag: "unsupported", reason: "parent not covered by block" });
  // coarsest beats open (a lattice edge has no parent at all).
  assert.equal(cascade({ structure: "coarsest", parentV: 0 }).tag, "no-coarser-parent");
});

test("Cascade: parent volume 0 is empty-population, a child that did not trade is negative-infinite (readout only)", () => {
  assert.deepEqual(cascade({ childV: 10, parentV: 0 }), { tag: "empty-population", reason: "parent volume is 0", denominator: "parent volume" });
  assert.deepEqual(cascade({ childV: 0, parentV: 0 }), { tag: "empty-population", reason: "parent volume is 0", denominator: "parent volume" }, "0/0 is not negative-infinite");
  assert.deepEqual(cascade({ childV: 0, parentV: 40 }), { tag: "negative-infinite", reason: "no current volume" });
  assert.deepEqual(cascade({ childV: undefined, parentV: 40 }), { tag: "negative-infinite", reason: "no current volume" }, "an absent cell of a complete, positive parent");
  assert.deepEqual(cascade({ childV: null, parentV: 40 }), { tag: "negative-infinite", reason: "no current volume" });
});

test("Cascade: non-finite input is invalid-input, and a factor must be given", () => {
  assert.deepEqual(cascade({ childV: NaN }), { tag: "invalid-input", reason: "non-finite" });
  assert.deepEqual(cascade({ childV: Infinity }), { tag: "invalid-input", reason: "non-finite" });
  assert.deepEqual(cascade({ parentV: NaN }), { tag: "invalid-input", reason: "non-finite" });
  assert.deepEqual(cascade({ parentV: Infinity }), { tag: "invalid-input", reason: "non-finite" });
  for (const factor of [undefined, 0, -4, NaN, Infinity, "4"]) assert.throws(() => E.ratio.cascade({ structure: "complete", childV: 1, parentV: 1, factor }), { name: "RangeError" });
  assert.throws(() => E.ratio.cascade({ structure: "sideways", childV: 1, parentV: 1, factor: 4 }), { name: "RangeError" });
});

test("Efficiency: log2((child v/rows) / (parent v/rows) / baseline) with the baseline 0.7002781604436024", () => {
  assert.equal(BASELINE, 2 ** (0.486 - 1), "the recorded baseline is 2**(ISO_B - 1)");
  // (100/4) / (400/10) = 25/40 = 0.625 -> log2(5/8) - log2(baseline) = (log2(5) - 3) + 0.514
  const r = efficiency({});
  assert.equal(r.tag, "finite");
  assert.ok(near(r.value, 2.321928094887362 - 3 + 0.514, 1e-12), "got " + r.value);
  // The identity of the model: r_c = r_p = 1 and v_c = v_p / 2 gives exactly the model's -0.486 (within 1e-12).
  const identity = efficiency({ child: { v: 50, rows: 1 }, parent: { v: 100, rows: 1 } });
  assert.equal(identity.tag, "finite");
  assert.ok(near(identity.value, -0.486, 1e-12), "got " + identity.value);
  // Equal per-row volume at both levels reads log2(1/baseline) = 0.514.
  assert.ok(near(efficiency({ child: { v: 10, rows: 5 }, parent: { v: 20, rows: 10 } }).value, 0.514, 1e-12));
  // The value is unclamped: beyond +-2 stays finite (the coordinate is where clipping lives).
  const big = efficiency({ child: { v: 1e6, rows: 1 }, parent: { v: 1, rows: 1 } });
  assert.equal(big.tag, "finite");
  assert.ok(big.value > 2);
  // A missing baseline is a programming error, not a silent default of 1.
  assert.throws(() => E.ratio.efficiency({ structure: "complete", child: { v: 1, rows: 1 }, parent: { v: 1, rows: 1 } }), { name: "TypeError" });
  for (const baseline of [0, -1, NaN, Infinity, "0.7"]) assert.throws(() => E.ratio.efficiency({ structure: "complete", child: { v: 1, rows: 1 }, parent: { v: 1, rows: 1 }, baseline }), { name: "TypeError" });
});

test("Efficiency: read status, then structure, then the four counts in order; a zero is empty-population, never negative-infinite", () => {
  assert.deepEqual(efficiency({ structure: "coarsest" }), { tag: "no-coarser-parent" });
  assert.deepEqual(efficiency({ structure: "open" }), { tag: "waiting-for-complete-parent", open: true });
  assert.deepEqual(efficiency({ structure: "unavailable" }), { tag: "unsupported", reason: "live cube only" });
  assert.deepEqual(efficiency({ read: { state: "pending" } }), { tag: "pending", reason: "reading" });
  assert.deepEqual(efficiency({ read: { state: "failed", reason: "cube_unavailable" } }), { tag: "failed", reason: "cube_unavailable" });
  // The counts, in the order child volume, child touched rows, parent volume, parent touched rows.
  const empty = (child, parent) => efficiency({ child, parent }).denominator;
  assert.equal(empty({ v: 0, rows: 4 }, { v: 400, rows: 10 }), "child volume");
  assert.equal(empty({ v: 100, rows: 0 }, { v: 400, rows: 10 }), "child touched rows");
  assert.equal(empty({ v: 100, rows: 4 }, { v: 0, rows: 10 }), "parent volume");
  assert.equal(empty({ v: 100, rows: 4 }, { v: 400, rows: 0 }), "parent touched rows");
  assert.equal(empty({ v: 0, rows: 0 }, { v: 0, rows: 0 }), "child volume", "the first empty count is the one named");
  assert.equal(efficiency({ child: { v: 0, rows: 0 } }).tag, "empty-population");
  assert.deepEqual(efficiency({ child: undefined, parent: undefined }), { tag: "empty-population", reason: "child volume is absent", denominator: "child volume" }, "an absent column is the baseline's none");
  assert.deepEqual(efficiency({ child: { v: NaN, rows: 4 } }), { tag: "invalid-input", reason: "non-finite" });
  // Order of the ladder: read before structure before counts.
  assert.equal(efficiency({ read: { state: "failed", reason: "x" }, structure: "coarsest", child: { v: 0, rows: 0 } }).tag, "failed");
  assert.equal(efficiency({ structure: "coarsest", child: { v: 0, rows: 0 } }).tag, "no-coarser-parent");
  assert.equal(efficiency({ structure: "open", child: { v: 0, rows: 0 } }).tag, "waiting-for-complete-parent");
});

test("baseline states map onto typed tags (A-29): coarsest, open, outside, none, unavailable, pending, failed", () => {
  // Cascade cells: coarsest -> no-coarser-parent, open -> waiting, outside -> unsupported,
  // none (absent child, complete parent) -> negative-infinite, and a parent with no volume -> empty-population.
  assert.equal(cascade({ structure: "coarsest" }).tag, "no-coarser-parent");
  assert.equal(cascade({ structure: "open" }).tag, "waiting-for-complete-parent");
  assert.equal(cascade({ structure: "outside" }).tag, "unsupported");
  assert.equal(cascade({ structure: "complete", childV: 0 }).tag, "negative-infinite");
  assert.equal(cascade({ structure: "complete", parentV: 0 }).tag, "empty-population");
  // Efficiency columns: unavailable -> unsupported, pending/failed reads pass through, none -> empty-population.
  assert.equal(efficiency({ structure: "unavailable" }).tag, "unsupported");
  assert.equal(efficiency({ read: { state: "pending" } }).tag, "pending");
  assert.equal(efficiency({ read: { state: "failed", reason: "boom" } }).tag, "failed");
  assert.equal(efficiency({ child: { v: 0, rows: 0 } }).tag, "empty-population");
});

test("precedence: read and coverage status come before every mathematical case (all 96 combinations)", () => {
  // failed > pending > unsupported > hidden > outside > coarsest > open > empty parent volume > the value.
  const reads = [null, { state: "failed", reason: "boom" }, { state: "pending" }, { state: "unsupported", reason: "not recorded" }];
  const wantRead = [null, "failed", "pending", "unsupported"];
  for (let r = 0; r < reads.length; r++)
    for (const hidden of [false, true])
      for (const outside of [false, true])
        for (const structure of ["complete", "coarsest", "open"])
          for (const parentZero of [false, true]) {
            const input = { structure, childV: 10, parentV: parentZero ? 0 : 40, factor: 4, read: reads[r], hidden, outside: outside ? { reason: "outside selection" } : null };
            let want = "finite";
            if (parentZero && structure === "complete") want = "empty-population";
            if (structure === "open") want = "waiting-for-complete-parent";
            if (structure === "coarsest") want = "no-coarser-parent";
            if (outside) want = "outside-support";
            if (hidden) want = "hidden";
            if (wantRead[r]) want = wantRead[r];
            assert.equal(plain(E.ratio.cascade(input)).tag, want, JSON.stringify(input));
          }
  assert.deepEqual(plain(E.ratio.cascade({ structure: "complete", childV: 1, parentV: 1, factor: 4, outside: { reason: "outside price support" } })), { tag: "outside-support", reason: "outside price support" });
  assert.deepEqual(plain(E.ratio.cascade({ structure: "complete", childV: 1, parentV: 1, factor: 4, hidden: true })), { tag: "hidden", reason: "replay" });
});

test("classify: the generic ladder in its fixed order, and null when nothing was asked of the ratio", () => {
  const c = (input) => {
    const r = E.ratio.classify(input);
    return r === null ? null : plain(r);
  };
  // Nothing wrong and no pair to divide: the ladder passes.
  assert.equal(c({}), null);
  assert.equal(c({ structure: "complete", totals: [{ name: "total", value: 5 }] }), null);
  // Totals, in order, the first non-positive one is named.
  assert.deepEqual(c({ totals: [{ name: "current total", value: 5 }, { name: "reference total", value: 0 }, { name: "x", value: 0 }] }), {
    tag: "empty-population", reason: "reference total is 0", denominator: "reference total",
  });
  assert.equal(c({ totals: [{ name: "t", value: -3 }] }).reason, "t is not positive");
  assert.deepEqual(c({ totals: [{ name: "t", value: NaN }] }), { tag: "invalid-input", reason: "non-finite" });
  // Ordinary denominators are UNDEFINED, not empty-population.
  assert.deepEqual(c({ ordinary: [{ name: "price range", value: 0 }] }), { tag: "undefined", denominator: "price range" });
  assert.deepEqual(c({ ordinary: [{ name: "trades", value: 4 }] }), null);
  // The pair: both zero, current zero, reference zero, finite log2.
  assert.deepEqual(c({ current: 0, reference: 0 }), { tag: "empty-both" });
  assert.deepEqual(c({ current: 0, reference: 3 }), { tag: "negative-infinite", reason: "no current volume" });
  assert.deepEqual(c({ current: 3, reference: 0 }), { tag: "no-reference", reason: "no reference volume" });
  assert.deepEqual(c({ current: 6, reference: 3 }), { tag: "finite", value: 1 });
  assert.deepEqual(c({ current: 1, reference: 4 }), { tag: "finite", value: -2 });
  assert.deepEqual(c({ current: 6, reference: 3, divisor: 2 }), { tag: "finite", value: 0 });
  assert.deepEqual(c({ current: NaN, reference: 3 }), { tag: "invalid-input", reason: "non-finite" });
  assert.deepEqual(c({ current: -1, reference: 3 }), { tag: "invalid-input", reason: "non-finite" });
  // Structure reasons can be overridden by the caller, and every result is JSON-safe.
  assert.deepEqual(c({ structure: "unavailable", reason: "no block" }), { tag: "unsupported", reason: "no block" });
  assert.throws(() => E.ratio.classify({ structure: "diagonal" }), { name: "RangeError" });
  // The status order also holds against totals and pairs.
  assert.equal(c({ read: { state: "pending" }, totals: [{ name: "t", value: 0 }], current: 0, reference: 0 }).tag, "pending");
});

test("defined zero stays a value with occupancy independent; a value is never turned into a non-value", () => {
  // log2(1) = 0 is a finite result, not "no value".
  assert.deepEqual(cascade({ childV: 10, parentV: 40 }), { tag: "finite", value: 0 });
  assert.equal(E.result.isValue(E.ratio.cascade({ structure: "complete", childV: 10, parentV: 40, factor: 4 })), true);
  assert.equal(E.result.isValue(E.ratio.cascade({ structure: "complete", childV: 0, parentV: 40, factor: 4 })), false);
});

test("ordinary denominators (size, choppiness, volume per path) are UNDEFINED naming the denominator, never 0", (t) => {
  if (!E.measure) return t.skip("needs part 05-measure; run with ENCODING_ONLY=measure,ratio");
  const col = (o) => Object.assign({ v: 0, bv: 0, ct: 0, bt: 0, p: 0, hi: NaN, lo: NaN }, o);
  const v = (key, c) => plain(E.measure.columnValue(key, c));
  assert.deepEqual(v("size", col({ v: 100, ct: 0 })), { tag: "undefined", denominator: "trades" });
  assert.deepEqual(v("choppiness", col({ ct: 3, p: 10, hi: 5, lo: 5 })), { tag: "undefined", denominator: "price range" });
  assert.deepEqual(v("perpath", col({ v: 100, p: 0 })), { tag: "undefined", denominator: "path" });
  // A defined zero is a value: a column that moved nothing but traded is choppiness 0 over a real range.
  assert.deepEqual(v("choppiness", col({ ct: 3, p: 0, hi: 9, lo: 5 })), { tag: "finite", value: 0 });
});

test("every result is JSON-safe: no NaN, no Infinity, and a JSON round trip is the identity", () => {
  const samples = [
    E.ratio.cascade({ structure: "complete", childV: 40, parentV: 40, factor: 4 }),
    E.ratio.cascade({ structure: "complete", childV: 0, parentV: 40, factor: 4 }),
    E.ratio.cascade({ structure: "complete", childV: 1, parentV: 0, factor: 4 }),
    E.ratio.cascade({ structure: "open", childV: 1, parentV: 1, factor: 4 }),
    E.ratio.cascade({ structure: "complete", childV: NaN, parentV: 1, factor: 4 }),
    E.ratio.efficiency({ structure: "complete", child: { v: 100, rows: 4 }, parent: { v: 400, rows: 10 }, baseline: BASELINE }),
    E.ratio.efficiency({ structure: "complete", child: { v: 0, rows: 0 }, parent: { v: 0, rows: 0 }, baseline: BASELINE }),
    E.ratio.efficiency({ structure: "unavailable", baseline: BASELINE }),
    E.ratio.classify({ current: 0, reference: 5 }),
    E.ratio.classify({ current: 5, reference: 0 }),
  ];
  for (const s of samples) {
    assert.doesNotThrow(() => E.result.assertJsonSafe(s));
    assert.deepEqual(plain(s), JSON.parse(JSON.stringify(plain(s))));
    assert.ok(E.result.TAGS.includes(s.tag));
    assert.equal("value" in s, s.tag === "finite");
  }
});

test("coordinate: a value on the fixed axis as {t, clip}; clipping only touches the coordinate", () => {
  const coord = (v, lo = -2, hi = 2) => plain(E.ratio.coordinate(v, lo, hi));
  // codes: NONE 0, LOW 1, HIGH 2, EXACT_LOW 3, EXACT_HIGH 4
  assert.deepEqual(coord(0), { t: 0.5, clip: 0 });
  assert.deepEqual(coord(1), { t: 0.75, clip: 0 });
  assert.deepEqual(coord(-1), { t: 0.25, clip: 0 });
  assert.deepEqual(coord(-2), { t: 0, clip: 3 });
  assert.deepEqual(coord(2), { t: 1, clip: 4 });
  assert.deepEqual(coord(2 + 1e-9), { t: 1, clip: 2 });
  assert.deepEqual(coord(-2 - 1e-9), { t: 0, clip: 1 });
  assert.deepEqual(coord(100), { t: 1, clip: 2 });
  assert.deepEqual(coord(Infinity), { t: 1, clip: 2 });
  assert.deepEqual(coord(-Infinity), { t: 0, clip: 1 });
  // Other axes: RSI-like 0..100, and a fractional interior point.
  assert.deepEqual(coord(30, 0, 100), { t: 0.3, clip: 0 });
  assert.deepEqual(coord(0, 0, 100), { t: 0, clip: 3 });
  assert.deepEqual(coord(100, 0, 100), { t: 1, clip: 4 });
  assert.throws(() => E.ratio.coordinate(NaN, -2, 2), { name: "TypeError" });
  assert.throws(() => E.ratio.coordinate(0, 2, -2), { name: "RangeError" });
  assert.throws(() => E.ratio.coordinate(0, 1, 1), { name: "RangeError" });
  // The raw value is the caller's: coordinate never rounds or returns it (S1-071).
  assert.equal(Object.keys(plain(E.ratio.coordinate(3.7, -2, 2))).sort().join(), "clip,t");
});

test("TICKS: the five ticks of the fixed log2 axis with their factors; ratioTicks keeps those with 12 px between them, ends first", () => {
  const T = E.ratio.TICKS;
  assert.ok(Array.isArray(T));
  assert.deepEqual(plain(T).map((t) => t.value), [-2, -1, 0, 1, 2]);
  assert.deepEqual(plain(T).map((t) => t.factor), [0.25, 0.5, 1, 2, 4]);
  assert.deepEqual(plain(T).map((t) => t.label), ["1/4×", "1/2×", "1×", "2×", "4×"]);
  assert.ok(Object.isFrozen(T) && Object.isFrozen(T[0]));
  const values = (room) => plain(E.ratio.ratioTicks(room)).map((t) => t.value);
  // The full span -2..+2 is `room` px, so adjacent ticks are room/4 apart.
  assert.deepEqual(values(120), [-2, -1, 0, 1, 2]);
  assert.deepEqual(values(48), [-2, -1, 0, 1, 2], "exactly 12 px between neighbours fits");
  assert.deepEqual(values(47.9), [-2, 0, 2], "the halves drop first; ends and centre stay");
  assert.deepEqual(values(36), [-2, 0, 2]);
  assert.deepEqual(values(24), [-2, 0, 2], "12 px between the ends and the centre");
  assert.deepEqual(values(23.9), [-2, 2], "only the ends");
  assert.deepEqual(values(12), [-2, 2]);
  assert.deepEqual(values(11.9), [-2], "one end when even the two ends do not fit");
  assert.deepEqual(values(0), []);
  assert.deepEqual(values(-5), []);
  assert.deepEqual(values(NaN), []);
  // Spacing property over many rooms: kept ticks are >= 12 px apart and always ascending.
  for (let room = 1; room <= 200; room += 0.5) {
    const kept = plain(E.ratio.ratioTicks(room));
    for (let i = 1; i < kept.length; i++) {
      assert.ok(kept[i].value > kept[i - 1].value);
      assert.ok(((kept[i].value - kept[i - 1].value) / 4) * room >= 12 - 1e-9, "room " + room);
    }
  }
});
