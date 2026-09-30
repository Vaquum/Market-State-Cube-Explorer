"use strict";
// U43 (T-scale, fixed transfer functions): E.scale.fixed / apply / plan for the fixed kinds of src/encoding.js,
// loaded through tests/support/enc.js.
// Oracles (none is the code under test): the hand-computed vectors of TESTPLAN U43 and API.md C.5 (each
// value is worked out in its comment); the closed forms (x-mid)/(hi-mid), (x-mid)/(mid-lo), (x-lo)/(hi-lo)
// written out again in this file; the mapping ids of API.md A.2.
// The level enters a fixed share only through the share the measurement layer hands over: E.scale has no
// level input at all, so "linear 0-100 % at every level, no automatic narrowing" is tested by giving the
// SAME share from cells of very different size (n = 4 and n = 12) and by asserting that the descriptor of
// the natural window is one and the same object of numbers whatever the caller does before.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): records are compared through JSON and
// errors by name.
// Not here: E.ratio.TICKS and ratioTicks (U14, package W1-B) and the RSI axis 0-100 with guides 30/70
// (E.axis, U22, package W1-E) are checked only if those parts are loaded (see the last test).
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isRange = (e) => typeof e === "object" && e !== null && e.name === "RangeError";
const CLIP = { NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 };
function at(desc, x) {
  const out = {};
  E.scale.apply(desc, x, out);
  return { t: out.t, clip: out.clip, state: out.state };
}
const near = (a, b, tol = 1e-15) => Math.abs(a - b) <= tol;

// A cell's Taker share as the measurement layer supplies it: taker-buy USDT over USDT. At n = 4 a cell is
// small and its counts are small; at n = 12 it is a huge aggregate. The share is what the mapping sees.
const SHARE_052 = [
  { n: 4, bv: 26, v: 50 },
  { n: 12, bv: 5200000, v: 10000000 },
];

test("Taker share is LINEAR 0-100 % about 0.5 at every level: 0.52 -> arm 0.04 -> LUT index 10, distinguishable and never saturated", () => {
  const d = E.scale.fixed("share-diverging");
  assert.equal(d.kind, "fixed-diverging");
  assert.equal(d.signed, true);
  assert.deepEqual(plain(d.params), { lo: 0, hi: 1, mid: 0.5 });
  for (const { n, bv, v } of SHARE_052) {
    const share = bv / v;
    assert.ok(near(share, 0.52), "the share at n = " + n);
    const r = at(d, share);
    assert.ok(near(r.t, 0.04, 1e-15), "n = " + n + " t = " + r.t);
    assert.equal(E.scale.index(r.t), 10, "round(0.04 * 255) = 10 at n = " + n);
    assert.equal(r.clip, CLIP.NONE);
    assert.notEqual(E.scale.index(r.t), E.scale.index(0), "distinguishable from the midpoint");
    assert.notEqual(E.scale.index(r.t), 255, "never saturated");
    // 0.5 + 0.03: arm (0.53 - 0.5) / 0.5 = 0.06, index round(15.3) = 15 (S1-056: the fact recorded at (12, 3)).
    assert.ok(near(at(d, 0.53).t, 0.06, 1e-15));
    assert.equal(E.scale.index(at(d, 0.53).t), 15);
  }
  // The other shares of the table: 0.75 -> arm 0.5 -> index round(127.5) = 128 (ties up); 0.25 is the same
  // distance on the other side, so the same index with the negative sign.
  assert.equal(at(d, 0.75).t, 0.5);
  assert.equal(E.scale.index(at(d, 0.75).t), 128);
  assert.equal(at(d, 0.25).t, -0.5);
  assert.equal(E.scale.index(at(d, 0.25).t), 128);
  // The midpoint is exactly zero (never -0, never a tiny number) and the arms meet there.
  assert.ok(Object.is(at(d, 0.5).t, 0));
  assert.equal(at(d, 0.5).clip, CLIP.NONE);
  // The natural endpoints are exact, not out of range.
  assert.deepEqual(at(d, 0), { t: -1, clip: CLIP.EXACT_LOW, state: null });
  assert.deepEqual(at(d, 1), { t: 1, clip: CLIP.EXACT_HIGH, state: null });
  // Closed form on a grid: a straight line either side of 0.5, no 25/75 saturation window, no activity term.
  for (let i = 1; i < 100; i++) {
    const x = i / 100;
    const want = (x - 0.5) / 0.5; // the same straight line on both sides of the midpoint
    assert.ok(near(at(d, x).t, want, 1e-15), "share " + x);
  }
});

test("the natural window never narrows by itself: fixed(kind) is the same mapping every time, at any level, whatever was asked before", () => {
  const before = E.scale.fixed("share-diverging").id;
  E.scale.fixed("share-diverging", [0.45, 0.55]);
  E.scale.fixed("unsigned-share", [0.2, 0.8]);
  assert.equal(E.scale.fixed("share-diverging").id, before);
  assert.equal(E.scale.fixed("share-diverging", null).id, before, "no window and a null window are the natural one");
  assert.equal(E.scale.fixed("share-diverging").id, "bladfrSuC76_siSl");
  // A share of 0.99 at a coarse level is near the end of the ramp, not saturated by a hidden window.
  const r = at(E.scale.fixed("share-diverging"), 0.99);
  assert.ok(near(r.t, 0.98, 1e-15));
  assert.equal(r.clip, CLIP.NONE);
  assert.ok(E.scale.index(r.t) < 255);
});

test("a manually narrowed Taker window 0.45..0.55 stays fixed-diverging about 0.5: 0.52 -> arm 0.4 -> index 102, 0.56 -> 1 flagged HIGH", () => {
  const d = E.scale.fixed("share-diverging", [0.45, 0.55]);
  assert.equal(d.kind, "fixed-diverging", "never fixed-linear: the arms and the midpoint survive");
  assert.equal(d.signed, true);
  assert.deepEqual(plain(d.params), { lo: 0.45, hi: 0.55, mid: 0.5 });
  for (const { n, bv, v } of SHARE_052) {
    const r = at(d, bv / v);
    assert.ok(near(r.t, 0.4, 1e-13), "n = " + n + " t = " + r.t);
    assert.equal(E.scale.index(r.t), 102, "round(0.4 * 255) = 102 at n = " + n);
    assert.equal(r.clip, CLIP.NONE);
  }
  const high = at(d, 0.56);
  assert.deepEqual(high, { t: 1, clip: CLIP.HIGH, state: null });
  assert.deepEqual(at(d, 0.44), { t: -1, clip: CLIP.LOW, state: null });
  assert.deepEqual(at(d, 0.55), { t: 1, clip: CLIP.EXACT_HIGH, state: null });
  assert.deepEqual(at(d, 0.45), { t: -1, clip: CLIP.EXACT_LOW, state: null });
  assert.ok(Object.is(at(d, 0.5).t, 0));
  // Its own id, distinct from the natural one, and the clipping is not applied to the raw value: the caller
  // keeps 0.56 (only the drawing coordinate is clipped).
  assert.notEqual(d.id, E.scale.fixed("share-diverging").id);
  assert.equal(d.id, E.scale.id({ v: 1, kind: "fixed-diverging", signed: true, params: { lo: 0.45, hi: 0.55, mid: 0.5 }, clip: "clamp01@1" }));
  assert.deepEqual(plain(E.scale.validate(d, { requireId: true })), { ok: true });
});

test("an asymmetric or otherwise invalid Taker window is rejected with its reason, and changes nothing", () => {
  const cases = [
    [[0.4, 0.55], /symmetric about 0\.5/],
    [[0.3, 0.5], /symmetric about 0\.5/],
    [[0.45, 0.56], /symmetric about 0\.5/],
    [[0, 1], /narrower than 0\.\.1/],
    [[0.55, 0.45], /0 <= lo < hi <= 1/],
    [[0.5, 0.5], /0 <= lo < hi <= 1/],
    [[-0.1, 1.1], /0 <= lo < hi <= 1/],
    [[0.45], /two finite numbers/],
    [[0.45, NaN], /two finite numbers/],
    [[0.45, "0.55"], /two finite numbers/],
    ["0.45..0.55", /two finite numbers/],
    [{ lo: 0.45, hi: 0.55 }, /two finite numbers/],
  ];
  for (const [win, why] of cases) {
    assert.throws(() => E.scale.fixed("share-diverging", win), (e) => isRange(e) && why.test(e.message), JSON.stringify(win));
  }
  assert.throws(() => E.scale.fixed("unsigned-share", [0.8, 0.2]), isRange);
  assert.throws(() => E.scale.fixed("unsigned-share", [-0.1, 0.5]), isRange);
  assert.throws(() => E.scale.fixed("unsigned-share", [0.2, 1.2]), isRange);
  assert.throws(() => E.scale.fixed("log2-ratio", [-1, 1]), (e) => isRange(e) && /no manual window/.test(e.message));
  assert.throws(() => E.scale.fixed("nope"), (e) => isRange(e) && /unknown fixed kind/.test(e.message));
  // Symmetry is checked to a tolerance, not exactly: 0.45 + 0.55 need not be exactly 1 in binary.
  assert.doesNotThrow(() => E.scale.fixed("share-diverging", [0.1, 0.9]));
  assert.doesNotThrow(() => E.scale.fixed("share-diverging", [0.49, 0.51]));
});

test("Dwell is an unsigned linear 0-100 % share (no rank): coordinate = share; a window 0.2..0.8 is fixed-linear and its clipping is named", () => {
  const d = E.scale.fixed("unsigned-share");
  assert.equal(d.kind, "fixed-linear");
  assert.equal(d.signed, false);
  assert.deepEqual(plain(d.params), { lo: 0, hi: 1 });
  assert.equal(d.id, "wWmkD33ohHZSpvyn");
  for (const share of [0.01, 0.25, 0.5, 0.9, 0.999]) assert.equal(at(d, share).t, share, "the coordinate IS the share");
  assert.deepEqual(at(d, 0), { t: 0, clip: CLIP.EXACT_LOW, state: null });
  assert.deepEqual(at(d, 1), { t: 1, clip: CLIP.EXACT_HIGH, state: null });
  assert.equal(E.scale.index(at(d, 0.02).t), 5, "a 2 % share is index round(5.1) = 5");
  const w = E.scale.fixed("unsigned-share", [0.2, 0.8]);
  assert.equal(w.kind, "fixed-linear");
  assert.deepEqual(plain(w.params), { lo: 0.2, hi: 0.8 });
  assert.ok(near(at(w, 0.5).t, 0.5, 1e-15));
  assert.ok(near(at(w, 0.65).t, (0.65 - 0.2) / (0.8 - 0.2), 1e-15));
  assert.deepEqual(at(w, 0.1), { t: 0, clip: CLIP.LOW, state: null });
  assert.deepEqual(at(w, 0.9), { t: 1, clip: CLIP.HIGH, state: null });
  assert.deepEqual(at(w, 0.2), { t: 0, clip: CLIP.EXACT_LOW, state: null });
  assert.deepEqual(at(w, 0.8), { t: 1, clip: CLIP.EXACT_HIGH, state: null });
  assert.notEqual(w.id, d.id);
  assert.deepEqual(plain(E.scale.validate(w, { requireId: true })), { ok: true });
});

test("log2 ratio: linear on -2..+2 (1/4x .. 4x); exact endpoints, finite clipping and column +1 that does not take +2's colour", () => {
  const d = E.scale.fixed("log2-ratio");
  assert.equal(d.kind, "fixed-diverging");
  assert.deepEqual(plain(d.params), { lo: -2, hi: 2, mid: 0 });
  assert.equal(d.id, "F5um4Aa89S5b18PC");
  // The five tick values of D3: 1/4x, 1/2x, 1x, 2x, 4x are the log2 values -2, -1, 0, 1, 2.
  const ticks = [-2, -1, 0, 1, 2];
  const want = [-1, -0.5, 0, 0.5, 1];
  ticks.forEach((v, i) => assert.equal(at(d, v).t, want[i], "log2 = " + v));
  assert.equal(at(d, -2).clip, CLIP.EXACT_LOW);
  assert.equal(at(d, 2).clip, CLIP.EXACT_HIGH);
  assert.equal(at(d, 0).clip, CLIP.NONE);
  // Cascade column +1 is index 128 of the positive arm; +2 is 255: the column does not acquire +2's colour.
  assert.equal(E.scale.index(at(d, 1).t), 128);
  assert.equal(E.scale.index(at(d, 2).t), 255);
  assert.notEqual(E.scale.index(at(d, 1).t), E.scale.index(at(d, 2).t));
  // Efficiency may exceed either end: the drawing coordinate is clipped and flagged, the raw ratio is the caller's.
  assert.deepEqual(at(d, 2.5), { t: 1, clip: CLIP.HIGH, state: null });
  assert.deepEqual(at(d, -2.5), { t: -1, clip: CLIP.LOW, state: null });
  assert.deepEqual(at(d, 1e9), { t: 1, clip: CLIP.HIGH, state: null });
  assert.deepEqual(at(d, -1e9), { t: -1, clip: CLIP.LOW, state: null });
  // A straight line in between.
  for (let i = -19; i <= 19; i++) {
    const x = i / 10;
    assert.ok(near(at(d, x).t, x / 2, 1e-15), "log2 " + x);
  }
});

test("an axis window is a linear coordinate between lo and hi with the axis clip policy (API.md A.2 id)", () => {
  const axis = { v: 1, kind: "axis-linear", signed: false, params: { lo: 0, hi: 1920000000 }, clip: "axis@1" };
  assert.equal(E.scale.id(axis), "fAie68jq2OF1287z");
  assert.equal(at(axis, 960000000).t, 0.5);
  assert.deepEqual(at(axis, 0), { t: 0, clip: CLIP.EXACT_LOW, state: null });
  assert.deepEqual(at(axis, 1920000000), { t: 1, clip: CLIP.EXACT_HIGH, state: null });
  assert.deepEqual(at(axis, 3e9), { t: 1, clip: CLIP.HIGH, state: null });
  assert.deepEqual(at(axis, -5), { t: 0, clip: CLIP.LOW, state: null });
  assert.deepEqual(plain(E.scale.validate(axis, { requireId: false })), { ok: true });
  assert.equal(plain(E.scale.validate({ ...axis, clip: "clamp01@1" })).ok, false, "an axis window carries the axis clip policy");
  assert.equal(plain(E.scale.validate({ ...axis, params: { lo: 1, hi: 1 } })).ok, false);
  const symmetric = { v: 1, kind: "axis-linear", signed: true, params: { lo: -10, hi: 10 }, clip: "axis@1" };
  assert.equal(at(symmetric, 0).t, 0.5, "the axis coordinate is a position from lo to hi, whatever the sign");
  assert.equal(at(symmetric, -10).t, 0);
});

test("a diverging window scales each arm by its OWN half-width (an asymmetric hand-made window: lo 0.3, mid 0.5, hi 0.6)", () => {
  const d = E.scale.manual({ kind: "fixed-diverging", lo: 0.3, hi: 0.6, mid: 0.5 }).descriptor;
  assert.equal(d.kind, "fixed-diverging");
  // Upper arm: (x - 0.5) / (0.6 - 0.5); lower arm: (x - 0.5) / (0.5 - 0.3).
  assert.ok(near(at(d, 0.55).t, 0.5, 1e-15));
  assert.ok(near(at(d, 0.45).t, -0.25, 1e-15));
  assert.ok(near(at(d, 0.4).t, -0.5, 1e-15));
  assert.ok(near(at(d, 0.58).t, 0.8, 1e-15));
  assert.deepEqual(at(d, 0.3), { t: -1, clip: CLIP.EXACT_LOW, state: null });
  assert.deepEqual(at(d, 0.6), { t: 1, clip: CLIP.EXACT_HIGH, state: null });
  assert.deepEqual(at(d, 0.29), { t: -1, clip: CLIP.LOW, state: null });
  assert.deepEqual(at(d, 0.61), { t: 1, clip: CLIP.HIGH, state: null });
});

test("raw values are never modified: apply reads x and writes only the coordinate, clip and state of out", () => {
  const d = E.scale.fixed("log2-ratio");
  const out = {};
  const x = 3.75;
  E.scale.apply(d, x, out);
  assert.equal(x, 3.75);
  assert.deepEqual(Object.keys(out).sort(), ["clip", "state", "t"]);
  assert.equal(out.t, 1);
  assert.equal(out.clip, CLIP.HIGH);
});

test("the plan of a fixed descriptor is cached and frozen like any other and evaluates the same as apply", () => {
  const d = E.scale.fixed("share-diverging", [0.45, 0.55]);
  const p = E.scale.plan(d);
  assert.equal(p, E.scale.plan(d));
  assert.equal(p.kind, "fixed-diverging");
  assert.equal(p.signed, true);
  const a = {};
  const b = {};
  for (const x of [0.4, 0.45, 0.47, 0.5, 0.52, 0.55, 0.6]) {
    p.apply(x, a);
    E.scale.apply(d, x, b);
    assert.deepEqual(plain(a), plain(b), "x = " + x);
  }
});

test("the ratio ticks of D3 (E.ratio.TICKS) are the same five log2 values, when part 06 is loaded", { todo: E.ratio ? false : "part 06-ratio (package W1-B) is not in this build; U14 owns E.ratio" }, () => {
  if (!E.ratio) return;
  const ticks = plain(E.ratio.TICKS).map((t) => t.value);
  assert.deepEqual(ticks, [-2, -1, 0, 1, 2]);
  const d = E.scale.fixed("log2-ratio");
  for (const t of ticks) assert.ok(Math.abs(at(d, t).t) <= 1);
});
