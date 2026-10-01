"use strict";
// U14b (T-relvol): Relative volume v2 of src/encoding.js E.relvol (part 07), API.md C.2, DR-19.
// Oracles (none is the code under test):
//  - hand vectors of U14b and API.md Appendix A.4 (cur {a:1,b:3} against per {a:2,b:2}: a = -1 exactly, b =
//    log2(1.5) = 0.5849625007211562; the coarse example with C = 55, P = 102, dropped 4; W = rows 5..20 keeps only
//    bin [8..15]; W = rows 9..14 is unsupported);
//  - an independent brute-force reference written in this file: it expands every row to base rows and bins them
//    with plain loops and exact BigInt integer sums, and forms each ratio as an exact rational
//    (cur_j * P) / (per_j * C) before a single division, so it shares no code, no summation order and no
//    floating-point pipeline with the implementation;
//  - seeded random volumes (tests/support/rng.js, mulberry32) for the identity over 20 (W, bm) combinations.
// The module may be evaluated in a vm context: records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const { mulberry32, int } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));
const rows = (map) => Object.entries(map).map(([r, v]) => ({ r: Number(r), v })).sort((a, b) => a.r - b.r);
const at = (rel, bin) => plain(rel.at(bin));
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

// Independent reference. `periodBase` and `currentBase` are arrays of volumes per BASE row (index = base row).
// Returns Map(bin -> {kind, value}) for the bins that overlap W (exact period), computed with exact integers.
function reference({ periodBase, currentBase, w0, w1, bm }) {
  const size = 2 ** bm;
  const per = new Map();
  const cur = new Map();
  for (let r = w0; r < w1; r++) {
    const j = Math.floor(r / size);
    per.set(j, (per.get(j) || 0n) + BigInt(periodBase[r] || 0));
    cur.set(j, (cur.get(j) || 0n) + BigInt(currentBase[r] || 0));
  }
  let C = 0n;
  let P = 0n;
  for (const v of cur.values()) C += v;
  for (const v of per.values()) P += v;
  const out = new Map();
  for (const j of per.keys()) {
    const c = cur.get(j);
    const p = per.get(j);
    // ratio of shares = (c/C) / (p/P) = (c*P) / (p*C), exact
    if (c === 0n && p === 0n) out.set(j, { kind: "empty-both" });
    else if (c === 0n) out.set(j, { kind: "negative-infinite" });
    else if (p === 0n) out.set(j, { kind: "no-reference" });
    else out.set(j, { kind: "finite", value: Math.log2(Number(c * P) / Number(p * C)) });
  }
  return out;
}

// Rows at level bm from base-row volumes restricted to [w0, w1): the rectangle's measured part.
function currentRows(currentBase, w0, w1, bm) {
  const size = 2 ** bm;
  const bins = new Map();
  for (let r = w0; r < w1; r++) if (currentBase[r] !== undefined) bins.set(Math.floor(r / size), (bins.get(Math.floor(r / size)) || 0) + currentBase[r]);
  return [...bins.entries()].map(([r, v]) => ({ r, v })).sort((a, b) => a.r - b.r);
}
const baseRows = (arr) => arr.map((v, r) => ({ r, v }));

test("hand vector: cur {a:1, b:3} against per {a:2, b:2}: a is -1 exactly, b is log2(1.5)", () => {
  const rel = E.relvol.compute({
    W: [0, 2],
    period: { rows: rows({ 0: 2, 1: 2 }), own: 0, exact: true },
    current: { rows: rows({ 0: 1, 1: 3 }), m: 0 },
    bm: 0,
  });
  assert.equal(rel.state, "ok");
  assert.deepEqual(at(rel, 0), { tag: "finite", value: -1 });
  assert.deepEqual(at(rel, 1), { tag: "finite", value: 0.5849625007211562 });
  assert.deepEqual(plain(rel.counts), { finite: 2, zero: 0, negativeInfinite: 0, noReference: 0, emptyBoth: 0, underflow: 0, overflow: 0, exactLow: 0, exactHigh: 0 });
});

test("identical conditional distributions read exactly 0 on every row, whatever W is, and junk outside W changes nothing", () => {
  // current {r0:10, r1:20, r2:30, r3:40}; the period is 3.5 times that on r0..r3, with 999 of junk on r4.
  const cur = { 0: 10, 1: 20, 2: 30, 3: 40 };
  const period = { 0: 35, 1: 70, 2: 105, 3: 140, 4: 999 };
  const inW = (W) => Object.fromEntries(Object.entries(cur).filter(([r]) => Number(r) >= W[0] && Number(r) < W[1]));
  for (const W of [[0, 4], [1, 3], [2, 4], [1, 2], [0, 1], [3, 4]]) {
    const rel = E.relvol.compute({ W, period: { rows: rows(period), own: 0, exact: true }, current: { rows: rows(inW(W)), m: 0 }, bm: 0 });
    for (let r = W[0]; r < W[1]; r++) assert.deepEqual(at(rel, r), { tag: "finite", value: 0 }, "W " + W + " row " + r);
    assert.equal(rel.counts.finite, W[1] - W[0]);
    assert.equal(rel.counts.zero, W[1] - W[0]);
  }
  // The junk row is in the period but outside W = [0,4): it is not part of the comparison.
  const rel = E.relvol.compute({ W: [0, 4], period: { rows: rows(period), own: 0, exact: true }, current: { rows: rows(cur), m: 0 }, bm: 0 });
  assert.deepEqual(at(rel, 4), { tag: "outside-support", reason: "outside price support" });
  // Without the junk the answers are the same numbers.
  const clean = E.relvol.compute({ W: [0, 4], period: { rows: rows({ 0: 35, 1: 70, 2: 105, 3: 140 }), own: 0, exact: true }, current: { rows: rows(cur), m: 0 }, bm: 0 });
  for (let r = 0; r < 4; r++) assert.deepEqual(at(rel, r), at(clean, r));
});

test("identity on 20 (W, bm) combinations with seeded random volumes: every bin is finite 0 (partial edge bins included)", () => {
  const next = mulberry32(12345);
  const period = Array.from({ length: 40 }, () => int(next, 1, 1000));
  let checked = 0;
  for (const bm of [0, 1, 2, 3])
    for (const [w0, w1] of [[0, 40], [5, 33], [8, 24], [13, 14], [3, 39]]) {
      // The rectangle trades exactly like the period inside W, summed into bins of 2**bm.
      const rel = E.relvol.compute({
        W: [w0, w1],
        period: { rows: baseRows(period), own: 0, exact: true },
        current: { rows: currentRows(period, w0, w1, bm), m: bm },
        bm,
      });
      assert.equal(rel.state, "ok");
      const size = 2 ** bm;
      for (let j = Math.floor(w0 / size); j <= Math.floor((w1 - 1) / size); j++) {
        const t = at(rel, j);
        assert.equal(t.tag, "finite", `bm ${bm} W ${w0},${w1} bin ${j}`);
        assert.ok(Math.abs(t.value) < 1e-12, `bm ${bm} W ${w0},${w1} bin ${j}: ${t.value}`);
        checked++;
      }
      assert.equal(rel.counts.finite, Math.floor((w1 - 1) / size) - Math.floor(w0 / size) + 1);
    }
  assert.ok(checked > 20);
});

test("random non-identical rectangles agree with the independent brute-force reference (exact rational, exact sums)", () => {
  const next = mulberry32(2026);
  for (let trial = 0; trial < 150; trial++) {
    const n = int(next, 4, 60);
    const bm = int(next, 0, 3);
    const w0 = int(next, 0, n - 2);
    const w1 = int(next, w0 + 1, n);
    // Sparse rows: some base rows have no trades at all on one side or both, some have explicit zeros.
    const pBase = Array.from({ length: n }, () => (next() < 0.25 ? 0 : int(next, 1, 1000)));
    const cBase = Array.from({ length: n }, () => (next() < 0.4 ? 0 : int(next, 1, 500)));
    const pRows = [];
    pBase.forEach((v, r) => {
      if (v > 0 || next() < 0.5) pRows.push({ r, v });
    });
    const cur = currentRows(cBase, w0, w1, bm);
    const rel = E.relvol.compute({ W: [w0, w1], period: { rows: pRows, own: 0, exact: true }, current: { rows: cur, m: bm }, bm });
    const periodBase = new Array(n).fill(0);
    pRows.forEach((x) => (periodBase[x.r] = x.v));
    const expected = reference({ periodBase, currentBase: cBase, w0, w1, bm });
    const sumC = cBase.slice(w0, w1).reduce((a, b) => a + b, 0);
    const sumP = periodBase.slice(w0, w1).reduce((a, b) => a + b, 0);
    if (!(sumC > 0) || !(sumP > 0)) {
      assert.equal(rel.state, "typed", `trial ${trial}`);
      assert.equal(rel.typed.tag, "empty-population");
      assert.equal(rel.typed.denominator, sumC > 0 ? "reference total" : "current total");
      continue;
    }
    assert.equal(rel.state, "ok", `trial ${trial}`);
    const size = 2 ** bm;
    const cSeen = new Set(cur.map((x) => x.r));
    const pSeen = new Set(pRows.filter((x) => x.r >= w0 && x.r < w1).map((x) => Math.floor(x.r / size)));
    for (let j = Math.floor(w0 / size); j <= Math.floor((w1 - 1) / size); j++) {
      const got = at(rel, j);
      const want = expected.get(j);
      if (!want || (!cSeen.has(j) && !pSeen.has(j))) {
        assert.equal(got.tag, "empty-both", `trial ${trial} bin ${j}: a bin with no data at all is empty on both sides`);
        continue;
      }
      assert.equal(got.tag, want.kind, `trial ${trial} bin ${j}`);
      if (want.kind === "finite") assert.ok(near(got.value, want.value, 1e-12), `trial ${trial} bin ${j}: ${got.value} vs ${want.value}`);
    }
    // Outside W and beyond it: never a zero-current row.
    for (const j of [Math.floor(w0 / size) - 1, Math.floor((w1 - 1) / size) + 1, -3, 1e6]) assert.equal(at(rel, j).tag, "outside-support");
  }
});

test("union iteration: rows only the rectangle traded are no-reference, rows only the period traded are negative-infinite, explicit zeros are empty-both", () => {
  const rel = E.relvol.compute({
    W: [0, 5],
    period: { rows: rows({ 0: 10, 1: 20, 2: 0, 4: 0 }), own: 0, exact: true },
    current: { rows: rows({ 0: 5, 2: 0, 3: 5 }), m: 0 },
    bm: 0,
  });
  // C = 10, P = 30. r0: (5/10)/(10/30) = 1.5; r1: current 0; r2: 0 and 0; r3: period absent; r4: 0 and 0.
  assert.deepEqual(at(rel, 0), { tag: "finite", value: 0.5849625007211562 });
  assert.deepEqual(at(rel, 1), { tag: "negative-infinite", reason: "no current volume" });
  assert.deepEqual(at(rel, 2), { tag: "empty-both" });
  assert.deepEqual(at(rel, 3), { tag: "no-reference", reason: "no reference volume" });
  assert.deepEqual(at(rel, 4), { tag: "empty-both" });
  assert.deepEqual(plain(rel.counts), { finite: 1, zero: 0, negativeInfinite: 1, noReference: 1, emptyBoth: 2, underflow: 0, overflow: 0, exactLow: 0, exactHigh: 0 });
  // A base row inside W that nobody traded is empty on both sides, and counted (not drawn per row, A-28).
  const sparse = E.relvol.compute({ W: [0, 8], period: { rows: rows({ 0: 10, 7: 10 }), own: 0, exact: true }, current: { rows: rows({ 0: 1 }), m: 0 }, bm: 0 });
  assert.equal(sparse.counts.emptyBoth, 6, "bins 1..6 have no data at all");
  assert.deepEqual(at(sparse, 3), { tag: "empty-both" });
  assert.deepEqual(at(sparse, 7), { tag: "negative-infinite", reason: "no current volume" });
});

test("clipping counts: exact endpoints are not outside range, finite underflow and overflow are counted apart", () => {
  // Period total 64 and current total 128 with shares chosen as powers of two so every ratio is exact.
  const rel = E.relvol.compute({
    W: [0, 5],
    period: { rows: rows({ 0: 4, 1: 4, 2: 4, 3: 4, 4: 48 }), own: 0, exact: true },
    current: { rows: rows({ 0: 32, 1: 64, 2: 2, 3: 1, 4: 29 }), m: 0 },
    bm: 0,
  });
  assert.deepEqual(at(rel, 0), { tag: "finite", value: 2 }, "a quarter share against a sixteenth: 4x, exactly +2");
  assert.deepEqual(at(rel, 1), { tag: "finite", value: 3 }, "8x: overflow");
  assert.deepEqual(at(rel, 2), { tag: "finite", value: -2 }, "1/4x: exactly -2");
  assert.deepEqual(at(rel, 3), { tag: "finite", value: -3 }, "1/8x: underflow");
  assert.equal(at(rel, 4).tag, "finite");
  assert.deepEqual(plain(rel.counts), { finite: 5, zero: 0, negativeInfinite: 0, noReference: 0, emptyBoth: 0, underflow: 1, overflow: 1, exactLow: 1, exactHigh: 1 });
});

test("outside W is outside-support, never a zero-current row; a changed W changes the record's support field", () => {
  const input = (W) => ({
    W,
    period: { rows: rows({ 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5 }), own: 0, exact: true },
    current: { rows: rows({ 2: 1, 3: 1 }), m: 0 },
    bm: 0,
  });
  const a = E.relvol.compute(input([2, 4]));
  for (const r of [0, 1, 4, 5, 99, -1]) assert.deepEqual(at(a, r), { tag: "outside-support", reason: "outside price support" }, "row " + r);
  assert.deepEqual([at(a, 2).tag, at(a, 3).tag], ["finite", "finite"]);
  const b = E.relvol.compute(input([1, 5]));
  assert.notDeepEqual(plain(a.support), plain(b.support));
  assert.deepEqual(plain(a.support), { w: [2, 4], bm: 0, exact: true, kind: "exact-rows", first: 2, last: 3, bins: 2, used: 2 });
  assert.deepEqual(plain(b.support), { w: [1, 5], bm: 0, exact: true, kind: "exact-rows", first: 1, last: 4, bins: 4, used: 4 });
  assert.equal(a.restriction, null, "an exact period restricts nothing that a drop count would have to name");
  // In b, rows 1 and 4 are in W but the rectangle did not trade there: negative-infinite, not "outside".
  assert.equal(at(b, 1).tag, "negative-infinite");
  assert.equal(at(b, 4).tag, "negative-infinite");
});

test("W-restricted sums are separate from the unrestricted bands: inputs are never written to and results are independent", () => {
  const freeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v);
    return Object.freeze(o);
  };
  const input = freeze({
    W: [1, 3],
    period: { rows: rows({ 0: 100, 1: 10, 2: 30, 3: 100 }), own: 0, exact: true },
    current: { rows: rows({ 1: 1, 2: 3 }), m: 0 },
    bm: 0,
  });
  const before = JSON.stringify(input);
  let rel;
  assert.doesNotThrow(() => (rel = E.relvol.compute(input)), "frozen inputs: compute writes nothing to what it is given");
  assert.equal(JSON.stringify(input), before);
  // The unrestricted period (POC and value area read it) still holds rows 0 and 3 and the full total 240.
  assert.equal(input.period.rows.reduce((a, x) => a + x.v, 0), 240);
  // The same period with a different W gives an independent answer; neither result reflects the other.
  const wide = E.relvol.compute({ W: [0, 4], period: input.period, current: { rows: rows({ 0: 1, 1: 1, 2: 3, 3: 1 }), m: 0 }, bm: 0 });
  assert.notEqual(wide, rel);
  assert.deepEqual(at(rel, 0), { tag: "outside-support", reason: "outside price support" });
  assert.equal(at(wide, 0).tag, "finite");
  assert.equal(rel.counts.finite, 2);
  assert.equal(wide.counts.finite, 4);
});

test("an exact period visits only the rows inside W (binary search): rows outside are never read", () => {
  const touched = [];
  const trap = (r, v) => ({
    r,
    get v() {
      touched.push(r);
      return v;
    },
  });
  const period = [];
  for (let r = 0; r < 1000; r++) period.push(trap(r, 1 + (r % 7)));
  const rel = E.relvol.compute({ W: [400, 410], period: { rows: period, own: 0, exact: true }, current: { rows: rows({ 400: 1, 405: 2 }), m: 0 }, bm: 0 });
  assert.equal(rel.state, "ok");
  assert.deepEqual([...new Set(touched)].sort((a, b) => a - b), [400, 401, 402, 403, 404, 405, 406, 407, 408, 409]);
});

test("partial edge bins are exact when the period is exact: W cutting a bin keeps only its in-W base rows on both sides", () => {
  // bm = 2: bins of 4 base rows. W = [2, 10) cuts bin 0 (rows 0..3, in W: 2, 3) and bin 2 (rows 8..11, in W: 8, 9).
  const period = [7, 3, 11, 5, 2, 9, 4, 8, 13, 6, 100, 100];
  const inW = period.map((v, r) => (r >= 2 && r < 10 ? v : undefined));
  const rel = E.relvol.compute({
    W: [2, 10],
    period: { rows: baseRows(period), own: 0, exact: true },
    current: { rows: currentRows(inW, 2, 10, 2), m: 2 },
    bm: 2,
  });
  for (const bin of [0, 1, 2]) {
    const t = at(rel, bin);
    assert.equal(t.tag, "finite", "bin " + bin);
    assert.ok(Math.abs(t.value) < 1e-12, "bin " + bin + " should be 0, got " + t.value + " (the edge bins hold only their in-W rows)");
  }
  assert.equal(at(rel, 3).tag, "outside-support");
  assert.equal(at(rel, -1).tag, "outside-support");
});

test("coarse recorded period (rowPrice 8, own 3): only bins wholly inside W count; the rest are dropped and counted", () => {
  // API.md A.4: period rows {r:0..4, v:100+r}, current {r:1,v:40},{r:2,v:55},{r:3,v:21} at level 3.
  const period = { rows: rows({ 0: 100, 1: 101, 2: 102, 3: 103, 4: 104 }), own: 3, exact: false };
  const current = { rows: rows({ 1: 40, 2: 55, 3: 21 }), m: 3 };
  const rel = E.relvol.compute({ W: [10, 30], period, current, bm: 3 });
  assert.equal(rel.state, "ok");
  // Only bin 2 (base rows 16..23) is wholly inside [10, 30]; C = 55 and P = 102, so the value is 0.
  assert.deepEqual(at(rel, 2), { tag: "finite", value: 0 });
  assert.deepEqual(plain(rel.restriction), { kind: "coarse-common-bins", dropped: 4 });
  assert.deepEqual(plain(rel.support), { w: [10, 30], bm: 3, exact: false, kind: "coarse-common-bins", first: 2, last: 2, bins: 1, used: 1 });
  for (const bin of [0, 1, 3, 4]) assert.deepEqual(at(rel, bin), { tag: "outside-support", reason: "outside price support" }, "dropped edge bin " + bin);
  // W = base rows 5..20 keeps only bin 1 ([8..15]).
  const w2 = E.relvol.compute({ W: [5, 20], period, current, bm: 3 });
  assert.deepEqual(at(w2, 1), { tag: "finite", value: 0 });
  assert.equal(at(w2, 2).tag, "outside-support", "bin [16..23] sticks out of W on the high side");
  assert.equal(at(w2, 0).tag, "outside-support", "bin [0..7] sticks out on the low side");
  assert.equal(w2.restriction.dropped, 4);
  // W = base rows 9..14 holds no whole bin: unsupported, with the reason of the spec.
  const none = E.relvol.compute({ W: [9, 14], period, current, bm: 3 });
  assert.equal(none.state, "typed");
  assert.deepEqual(plain(none.typed), { tag: "unsupported", reason: "no fully covered common bin" });
  assert.deepEqual(at(none, 1), { tag: "unsupported", reason: "no fully covered common bin" });
  assert.equal(none.counts.finite, 0);
  assert.deepEqual(plain(none.restriction), { kind: "coarse-common-bins", dropped: 5 });
  // The example of API.md A.4 with W = [10, 15]: no whole bin.
  assert.equal(E.relvol.compute({ W: [10, 15], period, current, bm: 3 }).typed.reason, "no fully covered common bin");
});

test("coarse period with several whole bins: shares are over the used bins only, hand-computed", () => {
  const period = { rows: rows({ 0: 100, 1: 200, 2: 300, 3: 999 }), own: 3, exact: false };
  const current = { rows: rows({ 0: 10, 1: 10, 2: 40, 3: 5 }), m: 3 };
  // W = [0, 24] wholly contains bins 0, 1, 2 (base rows 0..23); bin 3 is outside. C = 60, P = 600.
  const rel = E.relvol.compute({ W: [0, 24], period, current, bm: 3 });
  assert.deepEqual(at(rel, 0), { tag: "finite", value: 0 }, "(10/60)/(100/600) = 1");
  assert.deepEqual(at(rel, 1), { tag: "finite", value: -1 }, "(10/60)/(200/600) = 1/2");
  assert.ok(near(at(rel, 2).value, Math.log2(4 / 3)));
  assert.ok(near(at(rel, 2).value, 0.4150374992788438));
  assert.equal(at(rel, 3).tag, "outside-support");
  assert.equal(rel.restriction.dropped, 1);
  // A finer band level than the period's rows (bm > own) merges period rows into bins.
  const finer = E.relvol.compute({ W: [0, 32], period, current: { rows: rows({ 0: 10 }), m: 4 }, bm: 4 });
  assert.equal(finer.state, "ok");
  assert.equal(at(finer, 0).tag, "finite");
});

test("empty totals: an empty rectangle or an empty period is empty-population naming which total", () => {
  const period = { rows: rows({ 0: 5, 1: 5 }), own: 0, exact: true };
  const noCurrent = E.relvol.compute({ W: [0, 2], period, current: { rows: [], m: 0 }, bm: 0 });
  assert.equal(noCurrent.state, "typed");
  assert.deepEqual(plain(noCurrent.typed), { tag: "empty-population", reason: "current total is 0", denominator: "current total" });
  assert.deepEqual(at(noCurrent, 0), plain(noCurrent.typed));
  assert.deepEqual(at(noCurrent, 5), { tag: "outside-support", reason: "outside price support" }, "outside W stays outside");
  const zeros = E.relvol.compute({ W: [0, 2], period, current: { rows: rows({ 0: 0, 1: 0 }), m: 0 }, bm: 0 });
  assert.equal(zeros.typed.denominator, "current total", "explicit zero rows are still an empty rectangle");
  const noPeriod = E.relvol.compute({ W: [0, 2], period: { rows: rows({ 7: 5 }), own: 0, exact: true }, current: { rows: rows({ 0: 1 }), m: 0 }, bm: 0 });
  assert.deepEqual(plain(noPeriod.typed), { tag: "empty-population", reason: "reference total is 0", denominator: "reference total" });
  // Nothing in W at all: both are empty, the current total is named first.
  const nothing = E.relvol.compute({ W: [0, 2], period: { rows: [], own: 0, exact: true }, current: { rows: [], m: 0 }, bm: 0 });
  assert.equal(nothing.typed.denominator, "current total");
  assert.equal(nothing.counts.finite, 0);
});

test("read and coverage status come first: failed, pending, not recorded, replay", () => {
  const base = { W: [0, 2], period: { rows: rows({ 0: 5, 1: 5 }), own: 0, exact: true }, current: { rows: rows({ 0: 1, 1: 1 }), m: 0 }, bm: 0 };
  const run = (read, more) => E.relvol.compute(Object.assign({}, base, { read }, more));
  assert.equal(run(undefined).state, "ok");
  assert.equal(run({}).state, "ok");
  assert.deepEqual(plain(run({ meas: { state: "failed", reason: "boom" } }).typed), { tag: "failed", reason: "boom" });
  assert.deepEqual(plain(run({ res: { state: "failed", reason: "no rows" } }).typed), { tag: "failed", reason: "no rows" });
  assert.deepEqual(plain(run({ meas: { state: "pending" } }).typed), { tag: "pending", reason: "reading" });
  assert.deepEqual(plain(run({ res: { state: "pending", reason: "reading the period" } }).typed), { tag: "pending", reason: "reading the period" });
  assert.deepEqual(plain(run({ res: { state: "unrecorded" } }).typed), { tag: "unsupported", reason: "not recorded" });
  assert.deepEqual(plain(run({ res: { state: "none" } }).typed), { tag: "hidden", reason: "replay" });
  assert.deepEqual(plain(run({}, { hidden: true }).typed), { tag: "hidden", reason: "replay" });
  // Failed beats pending beats unsupported beats hidden, across the two reads.
  assert.equal(run({ meas: { state: "pending" }, res: { state: "failed", reason: "x" } }).typed.tag, "failed");
  assert.equal(run({ meas: { state: "pending" }, res: { state: "unrecorded" } }).typed.tag, "pending");
  assert.equal(run({ res: { state: "unrecorded" } }, { hidden: true }).typed.tag, "unsupported");
  // A ready measurement and ready rows are no status; states such as "cube" or "exact" are not pending.
  assert.equal(run({ meas: { state: "cube" }, res: { state: "ready" } }).state, "ok");
  // Every bin answers with the whole result.
  const failed = run({ meas: { state: "failed", reason: "boom" } });
  for (const bin of [-1, 0, 1, 50]) assert.deepEqual(at(failed, bin), { tag: "failed", reason: "boom" });
  assert.equal(failed.counts.finite, 0);
  // stale is disclosure, never a status.
  const stale = run({ meas: { state: "cube" }, stale: true });
  assert.equal(stale.state, "ok");
  assert.equal(stale.stale, true);
  assert.equal(run({}).stale, false);
});

test("inputs are validated: a non-finite W or volume, an impossible level", () => {
  const good = { W: [0, 2], period: { rows: rows({ 0: 5 }), own: 0, exact: true }, current: { rows: rows({ 0: 1 }), m: 0 }, bm: 0 };
  assert.throws(() => E.relvol.compute({ ...good, W: [NaN, 2] }), { name: "TypeError" });
  assert.throws(() => E.relvol.compute({ ...good, W: undefined }), { name: "TypeError" });
  assert.throws(() => E.relvol.compute({ ...good, bm: -1 }), { name: "RangeError" });
  assert.throws(() => E.relvol.compute({ ...good, bm: 0.5 }), { name: "RangeError" });
  assert.throws(() => E.relvol.compute({ ...good, period: { rows: rows({ 0: 5 }), own: 3, exact: false }, bm: 2 }), { name: "RangeError" }, "bm below the period's own level");
  assert.throws(() => E.relvol.compute({ ...good, current: { rows: rows({ 0: 1 }), m: 1 } }), { name: "RangeError" }, "the rectangle's rows cannot be coarser than the bins");
  // A non-finite volume is invalid input for the whole result, never a NaN share.
  const bad = E.relvol.compute({ ...good, current: { rows: [{ r: 0, v: NaN }], m: 0 } });
  assert.deepEqual(plain(bad.typed), { tag: "invalid-input", reason: "non-finite" });
  const bad2 = E.relvol.compute({ ...good, period: { rows: [{ r: 0, v: Infinity }], own: 0, exact: true } });
  assert.equal(bad2.typed.tag, "invalid-input");
  // An empty W is an empty support: everything is outside.
  const empty = E.relvol.compute({ ...good, W: [3, 3] });
  assert.deepEqual(plain(empty.typed), { tag: "outside-support", reason: "outside price support" });
  // The rectangle's level defaults to bm when it is not stated.
  const dflt = E.relvol.compute({ W: [0, 2], period: { rows: rows({ 0: 2, 1: 2 }), own: 0, exact: true }, current: { rows: rows({ 0: 1, 1: 3 }) }, bm: 0 });
  assert.deepEqual(at(dflt, 0), { tag: "finite", value: -1 });
});

test("every answer is JSON-safe and a shared record is never mutable", () => {
  const rel = E.relvol.compute({
    W: [0, 6],
    period: { rows: rows({ 0: 10, 1: 20, 2: 0, 4: 5 }), own: 0, exact: true },
    current: { rows: rows({ 0: 5, 2: 0, 3: 5 }), m: 0 },
    bm: 0,
  });
  for (const bin of [-1, 0, 1, 2, 3, 4, 5, 6]) {
    const t = rel.at(bin);
    assert.doesNotThrow(() => E.result.assertJsonSafe(t), "bin " + bin);
    assert.ok(E.result.TAGS.includes(t.tag));
  }
  assert.doesNotThrow(() => E.result.assertJsonSafe(rel.counts));
  assert.doesNotThrow(() => E.result.assertJsonSafe(rel.support));
  assert.ok(Object.isFrozen(rel) && Object.isFrozen(rel.support));
  // The typed records of the fixed shapes are shared and frozen.
  assert.ok(Object.isFrozen(rel.at(1)));
  assert.equal(rel.at(1), rel.at(1));
});
