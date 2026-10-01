"use strict";
// U51 (PRD-0002 S2, #47 section 3): the comparison of the adjacent profile tracks, E.axis.profile.
// Oracle (none is the code under test): tests/reference/rational.js, exact BigInt rationals. Every expected amount is written out from the
// definition by brute force over the partition's bins: a bin's amount is the exact sum of the source rows that lie inside it (a coarse row is
// never split, the finer side is summed), a share is the exact quotient by the exact total of the window W, and the code's floating-point
// results must equal these after ONE rounding (relative 1e-12, the code's own tolerance for sums).
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const R = require("../reference/rational.js");

const TOL = 1e-12;
const close = (got, want, what) => assert.ok(Math.abs(got - want) <= TOL * Math.max(1, Math.abs(want)), `${what}: ${got} vs ${want}`);

// A small deterministic generator (no Math.random: a failure must replay).
function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// Rows at exponent m, sorted by r, from `first` for `count` rows, each traded with probability p.
function rowsOf(rand, m, first, count, p) {
  const out = [];
  for (let i = 0; i < count; i++) {
    if (rand() > p) continue;
    const v = Math.round(rand() * 1e5) / 100 + 0.01;
    out.push({ r: first + i, v, bv: Math.round(v * rand() * 100) / 100, w: Math.round(rand() * 1e4) / 10 + 0.1 });
  }
  return out;
}

// The brute-force oracle: the exact amount of each partition bin of exponent `m` from rows of exponent `from`, and the exact sum of a set.
function binAmounts(rows, from, m, read) {
  const k = 2 ** (m - from),
    bins = new Map();
  for (const x of rows) {
    const r = Math.floor(x.r / k);
    bins.set(r, R.add(bins.get(r) ?? R.ZERO, R.fromDouble(read(x))));
  }
  return bins;
}
const binsOverlapping = (from, view, rows) => rows.filter((x) => (x.r + 1) * 2 ** from > view.lo && x.r * 2 ** from < view.hi);
// The exact amount of each bin of exponent `m` that lies WHOLLY inside the view [lo, hi), from rows of exponent `from`: every row of such a bin is summed (the
// view is a union of whole bins, so none of its rows is outside it), and a bin that straddles an edge of the view is in no side (PR #52, review of the first
// version, which filtered the rows by the view before coarsening them and so compared a half bin of one side with a whole bin of the other).
function wholeBins(rows, from, m, view, read) {
  const size = 2 ** m,
    lo = Math.ceil(view.lo / size),
    hi = Math.floor(view.hi / size) - 1,
    k = 2 ** (m - from),
    bins = new Map();
  for (const x of rows) {
    const r = Math.floor(x.r / k);
    if (r < lo || r > hi) continue;
    bins.set(r, R.add(bins.get(r) ?? R.ZERO, R.fromDouble(read(x))));
  }
  return bins;
}

function plan(mode, cur, ref, view) {
  return E.axis.profile({ mode, cur, ref, view });
}

test("independent is the default and offers itself, needing nothing", () => {
  const p = plan("independent", { rows: [], m: 0 }, null, { lo: 0, hi: 10 });
  assert.equal(p.mode, "independent");
  assert.equal(p.state, "independent");
  assert.equal(p.offers.independent.ok, true);
  assert.equal(p.cur, null);
  assert.equal(plan(undefined, { rows: [], m: 0 }, null, { lo: 0, hi: 10 }).mode, "independent", "no mode is independent");
  assert.equal(plan("nonsense", { rows: [], m: 0 }, null, { lo: 0, hi: 10 }).mode, "independent", "an unknown mode is independent");
});

test("which comparisons a reference offers: unlike measures and signed distributions are disabled, each with its reason", () => {
  const cur = { rows: [{ r: 1, v: 1, bv: 0 }], m: 0, ready: true };
  const ref = (kind, extra = {}) => ({ kind, rows: [{ r: 1, v: 1, bv: 0, w: 1 }], m: 0, ready: true, ...extra });
  const offers = (c, r) => {
    const o = plan("independent", c, r, { lo: 0, hi: 4 }).offers;
    return [o.absolute.ok ? "ok" : o.absolute.reason, o.share.ok ? "ok" : o.share.reason];
  };
  assert.deepEqual(offers(cur, ref("volume")), ["ok", "ok"], "Volume against Volume: both");
  assert.deepEqual(offers(cur, ref("time")), ["unlike-measure", "ok"], "Time at price is another measure, yet a nonnegative distribution");
  assert.deepEqual(offers(cur, ref("delta")), ["unlike-measure", "signed"], "a signed Delta is not a row-share distribution");
  assert.deepEqual(offers(cur, ref("relvol")), ["unlike-measure", "unlike-measure"], "a ratio is not a distribution");
  assert.deepEqual(offers(cur, null), ["no-reference", "no-reference"]);
  assert.deepEqual(offers(cur, ref("volume", { ready: false })), ["reference-not-ready", "reference-not-ready"]);
  assert.deepEqual(offers({ ...cur, ready: false }, ref("volume")), ["current-not-ready", "current-not-ready"]);
  assert.deepEqual(offers(cur, ref("volume", { m: 1.5 })), ["not-aligned", "not-aligned"], "a row size that is no power of two has no exact common partition");
  assert.deepEqual(offers(null, ref("volume")), ["current-not-ready", "current-not-ready"]);
});

test("a mode that is not offered falls back to independent, names why and keeps what was asked", () => {
  const cur = { rows: [{ r: 1, v: 1, bv: 0 }], m: 0, ready: true };
  const p = plan("absolute", cur, { kind: "delta", rows: [{ r: 1, v: 1, bv: 0, w: 1 }], m: 0, ready: true }, { lo: 0, hi: 4 });
  assert.equal(p.asked, "absolute");
  assert.equal(p.mode, "independent");
  assert.equal(p.reason, "unlike-measure");
  assert.equal(p.cur, null);
});

test("shared absolute: the finer side is summed exactly onto the coarser partition, a coarse row is never split, and only the bins wholly inside the view are shown", () => {
  const rand = lcg(7);
  let shown = 0;
  for (let trial = 0; trial < 300; trial++) {
    const curM = Math.floor(rand() * 3),
      refM = curM + Math.floor(rand() * 4),
      first = Math.floor(rand() * 40),
      cur = { rows: rowsOf(rand, curM, first * 2 ** (refM - curM), 30 * 2 ** (refM - curM), 0.6), m: curM, ready: true },
      ref = { kind: "volume", rows: rowsOf(rand, refM, first + Math.floor(rand() * 6), 34, 0.7), m: refM, ready: true },
      lo = (first + rand() * 10) * 2 ** refM,
      view = { lo, hi: lo + (3 + rand() * 20) * 2 ** refM },
      p = plan("absolute", cur, ref, view);
    assert.equal(p.mode, "absolute");
    assert.equal(p.m, refM, "the coarser exponent is the partition");
    const curIn = wholeBins(cur.rows, curM, refM, view, (x) => x.v),
      curBuy = wholeBins(cur.rows, curM, refM, view, (x) => x.bv),
      refIn = wholeBins(ref.rows, refM, refM, view, (x) => x.v);
    assert.deepEqual(p.cur.map((x) => x.r), [...curIn.keys()].sort((a, b) => a - b), "the current bins, sorted");
    for (const x of p.cur) {
      close(x.v, R.toDouble(curIn.get(x.r)), `current bin ${x.r}`);
      close(x.bv, R.toDouble(curBuy.get(x.r)), `current buy ${x.r}`);
      assert.equal(x.t, x.v, "absolute draws the amount itself");
    }
    // the reference rows are exactly its own (coarse rows unsplit)
    assert.deepEqual(p.ref.map((x) => x.r), [...refIn.keys()].sort((a, b) => a - b));
    for (const x of p.ref) close(x.v, R.toDouble(refIn.get(x.r)), `reference bin ${x.r}`);
    shown += p.cur.length + p.ref.length;
    let want = -Infinity,
      count = 0;
    for (const side of [curIn, refIn]) for (const v of side.values()) { want = Math.max(want, R.toDouble(v)); count++; }
    assert.equal(p.summary.count, count, "the domain is summarised over BOTH displayed sets");
    if (count) close(p.summary.max, want, "the shared maximum");
  }
  assert.ok(shown > 1000, "the trials show something");
});

test("identical distributions on two partitions give equal bars: a coarse row of 20 against two fine rows of 10, whole bins only (PR #52 review)", () => {
  const fine = { kind: "volume", rows: [{ r: 0, v: 10, bv: 0, w: 1 }, { r: 1, v: 10, bv: 0, w: 1 }], m: 0, ready: true },
    coarse = { rows: [{ r: 0, v: 20, bv: 5 }], m: 1, ready: true };
  // the reference is the fine side
  let p = plan("absolute", coarse, fine, { lo: 0, hi: 2 });
  assert.deepEqual(p.cur.map((x) => [x.r, x.v]), [[0, 20]]);
  assert.deepEqual(p.ref.map((x) => [x.r, x.v]), [[0, 20]], "the two fine rows are one coarse bin, both of them");
  // the current is the fine side
  p = plan("absolute", { rows: fine.rows, m: 0, ready: true }, { kind: "volume", rows: [{ r: 0, v: 20, bv: 0, w: 1 }], m: 1, ready: true }, { lo: 0, hi: 2 });
  assert.deepEqual(p.cur.map((x) => [x.r, x.v]), [[0, 20]]);
  assert.deepEqual(p.ref.map((x) => [x.r, x.v]), [[0, 20]]);
  // a view that holds half of the coarse bin shows no bin of it at all, rather than 10 against 20
  p = plan("absolute", coarse, fine, { lo: 1, hi: 2 });
  assert.equal(p.state, "none");
  assert.equal(p.reason, "no-window");
  assert.deepEqual([p.cur, p.ref], [null, null]);
  // two bins, one of them wholly inside: only that one, on both sides
  p = plan("absolute", { rows: [{ r: 0, v: 20, bv: 0 }, { r: 1, v: 6, bv: 0 }], m: 1, ready: true }, { kind: "volume", rows: [...fine.rows, { r: 2, v: 2, bv: 0, w: 1 }, { r: 3, v: 4, bv: 0, w: 1 }], m: 0, ready: true }, { lo: 0, hi: 3 });
  assert.deepEqual(p.cur.map((x) => [x.r, x.v]), [[0, 20]]);
  assert.deepEqual(p.ref.map((x) => [x.r, x.v]), [[0, 20]]);
  assert.deepEqual(p.window, { first: 0, last: 0, bins: 1 });
});

test("shared absolute coarsens a finer reference onto the current partition too", () => {
  const rand = lcg(11);
  for (let trial = 0; trial < 120; trial++) {
    const curM = 2,
      refM = 0,
      cur = { rows: rowsOf(rand, curM, 10, 25, 0.8), m: curM, ready: true },
      ref = { kind: "volume", rows: rowsOf(rand, refM, 40, 100, 0.8), m: refM, ready: true },
      view = { lo: 41 + rand() * 20, hi: 120 + rand() * 20 },
      p = plan("absolute", cur, ref, view),
      want = wholeBins(ref.rows, refM, curM, view, (x) => x.v),
      wantCur = wholeBins(cur.rows, curM, curM, view, (x) => x.v);
    assert.equal(p.m, curM);
    assert.deepEqual(p.ref.map((x) => x.r), [...want.keys()].sort((a, b) => a - b));
    for (const x of p.ref) close(x.v, R.toDouble(want.get(x.r)), `reference bin ${x.r}`);
    assert.deepEqual(p.cur.map((x) => x.r), [...wantCur.keys()].sort((a, b) => a - b));
    for (const x of p.cur) close(x.v, R.toDouble(wantCur.get(x.r)), `current bin ${x.r}`);
  }
});

test("shared row share: each side over the exact total of the same window W, both denominators reported, W wholly inside view and support", () => {
  const rand = lcg(23);
  let checked = 0;
  for (let trial = 0; trial < 300; trial++) {
    const curM = Math.floor(rand() * 2),
      refM = curM + Math.floor(rand() * 3),
      kind = rand() < 0.5 ? "volume" : "time",
      read = kind === "volume" ? (x) => x.v : (x) => x.w,
      cur = { rows: rowsOf(rand, curM, 2 * 2 ** (refM - curM), 60 * 2 ** (refM - curM), 0.7), m: curM, ready: true },
      ref = { kind, rows: rowsOf(rand, refM, 8 + Math.floor(rand() * 8), 18 + Math.floor(rand() * 20), 0.8), m: refM, ready: true },
      view = { lo: (4 + rand() * 8) * 2 ** refM, hi: (30 + rand() * 30) * 2 ** refM },
      p = plan("share", cur, ref, view);
    assert.equal(p.mode, "share");
    if (!ref.rows.length) continue;
    const size = 2 ** refM,
      refFirst = Math.floor(ref.rows[0].r / 2 ** 0),
      refLast = ref.rows[ref.rows.length - 1].r,
      first = Math.max(Math.ceil(view.lo / size), refFirst),
      last = Math.min(Math.floor(view.hi / size) - 1, refLast);
    if (last < first) {
      assert.equal(p.state, "none");
      assert.equal(p.reason, "no-window");
      continue;
    }
    assert.deepEqual(p.window, { first, last, bins: last - first + 1 });
    const inW = (r) => r >= first && r <= last,
      curBins = binAmounts(curRowsAll(cur), curM, refM, (x) => x.v),
      refBins = binAmounts(ref.rows, refM, refM, read);
    let dc = R.ZERO,
      dr = R.ZERO;
    for (const [r, v] of curBins) if (inW(r)) dc = R.add(dc, v);
    for (const [r, v] of refBins) if (inW(r)) dr = R.add(dr, v);
    close(p.denominators.cur, R.toDouble(dc), "current denominator");
    close(p.denominators.ref, R.toDouble(dr), "reference denominator");
    if (dc.n === 0n || dr.n === 0n) {
      assert.equal(p.state, "undefined", "a zero total is undefined, never a share of 0");
      assert.equal(p.reason, "zero-total");
      assert.equal(p.cur, null);
      continue;
    }
    assert.equal(p.state, "ok");
    let shares = 0;
    for (const x of p.cur) {
      assert.ok(inW(x.r), "current rows outside W are not compared");
      close(x.t, R.toDouble(R.div(curBins.get(x.r), dc)), `current share ${x.r}`);
      shares += x.t;
    }
    close(shares, 1, "the current shares of W sum to one");
    shares = 0;
    for (const x of p.ref) {
      assert.ok(inW(x.r), "reference rows outside W are not compared");
      close(x.t, R.toDouble(R.div(refBins.get(x.r), dr)), `reference share ${x.r}`);
      shares += x.t;
    }
    close(shares, 1, "the reference shares of W sum to one");
    checked++;
  }
  assert.ok(checked > 100, "the trials exercised the defined case (" + checked + ")");
});
const curRowsAll = (cur) => cur.rows;

test("share over a window with no common support says so; a zero total is undefined", () => {
  const cur = { rows: [{ r: 0, v: 5, bv: 1 }], m: 0, ready: true },
    far = { kind: "volume", rows: [{ r: 500, v: 5, bv: 0, w: 1 }], m: 0, ready: true };
  const none = plan("share", cur, far, { lo: 0, hi: 10 });
  assert.equal(none.state, "none");
  assert.equal(none.reason, "no-window");
  assert.equal(none.summary.count, 0);
  const zero = plan("share", { rows: [{ r: 2, v: 0, bv: 0 }], m: 0, ready: true }, { kind: "volume", rows: [{ r: 2, v: 3, bv: 0, w: 1 }, { r: 4, v: 1, bv: 0, w: 1 }], m: 0, ready: true }, { lo: 0, hi: 10 });
  assert.equal(zero.state, "undefined", "the current total over W is zero");
  assert.equal(zero.reason, "zero-total");
  assert.deepEqual(zero.denominators, { cur: 0, ref: 4 }, "the denominators are still reported");
  assert.equal(zero.summary.count, 0, "no domain is made up for it");
});

test("rows outside the view are not displayed and the summary is of the displayed ones only", () => {
  const cur = { rows: [{ r: 0, v: 1000, bv: 0 }, { r: 5, v: 2, bv: 1 }], m: 0, ready: true },
    ref = { kind: "volume", rows: [{ r: 0, v: 9000, bv: 0, w: 1 }, { r: 5, v: 7, bv: 0, w: 1 }], m: 0, ready: true },
    p = plan("absolute", cur, ref, { lo: 4.5, hi: 8 });
  assert.deepEqual(p.cur.map((x) => x.r), [5]);
  assert.deepEqual(p.ref.map((x) => x.r), [5]);
  assert.equal(p.summary.max, 7, "the maximum of what is shown, not of the whole period");
});

test("the plan reads no more than the view: rows are found by binary search, the list is not rewritten", () => {
  const big = Array.from({ length: 50000 }, (_, i) => ({ r: i, v: 1 + (i % 7), bv: 0, w: 1 }));
  const frozen = Object.freeze(big.map(Object.freeze));
  const cur = { rows: frozen, m: 0, ready: true },
    p = plan("absolute", cur, { kind: "volume", rows: frozen, m: 0, ready: true }, { lo: 25000, hi: 25020 });
  assert.equal(p.cur.length, 20);
  assert.equal(p.ref.length, 20);
});

test("a view that is not a range is a caller bug", () => {
  assert.throws(() => E.axis.profile({ mode: "absolute", cur: null, ref: null, view: { lo: 3, hi: 3 } }), RangeError);
  assert.throws(() => E.axis.profile(null), TypeError);
});
