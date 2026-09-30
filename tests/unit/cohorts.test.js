"use strict";
// U17 (T-cohort): E.cohort.cells / motionCells / rows / columns of src/encoding.js (part 09).
// Oracles (none is the code under test):
//   1. hand-worked grids of API.md C.4.3 and the U17 row of TESTPLAN.md: the level is n = 2, m = 1 (a cell is
//      4 base columns = 225 s wide and 2 base rows = 250 USDT high), the rectangle is written in base units,
//      and every expected member, exclusion count, value list, support and obsEnd below was counted by hand
//      from that picture (the comment above each test says how);
//   2. an independent membership oracle for a seeded property test: interval CONTAINMENT in integer base
//      units (the cell lies inside [t0, t1] x [r0, r1] and ends at or before the edge), where the module
//      works with exposure fractions, so the two share no arithmetic;
//   3. the fit vectors of API.md A.3 worked by hand for the nine-cell cohort (U = 55, k = 44) and the
//      zero-only / No calibration answers that D3 names for the all-zero and the empty cohort.
// The module may be evaluated in a vm context: records are compared through JSON.
// Not here: the decision WHEN a cohort is taken (coherence, settling, the memo key) is E.lifecycle (U25);
// that a disclosed coarse measurement calibrates only its coarse context is E.context / E.store (U24, U23):
// this part records `quality` and refuses an unanswered, failed, stale or updating read, nothing more.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const { mulberry32, int } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));
// The module may live in another realm (a vm context), so `instanceof TypeError` would fail: test the name.
const isType = (e) => typeof e === "object" && e !== null && e.name === "TypeError";
const vals = (c) => Array.from(c.values);
const LEVEL = { n: 2, m: 1 };
const TS = 4; // 2 ** n base columns
const PS = 2; // 2 ** m base rows
const GEOM = { BASE: 56.25, PR: 125 };
const EMPTY = { partial: 0, open: 0, unread: 0, nonFinite: 0, negative: 0, stale: 0, placeholder: 0 };
const excl = (over) => Object.assign({}, EMPTY, over);

// One cell with every field a kernel may read; v = 10 * c + r unless the test says otherwise.
function cell(c, r, over) {
  return Object.assign({ c, r, v: 10 * c + r, bv: 0, ct: 1, bt: 0, p: 0, w: 0, hi: NaN, lo: NaN }, over);
}
function grid(cs, rs, make) {
  const out = [];
  for (const c of cs) for (const r of rs) out.push(make ? make(c, r) : cell(c, r));
  return out;
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// The standard picture: 36 cells c = 1..6, r = 1..6 (column c spans base columns [4c, 4c + 4], row r spans
// [2r, 2r + 2]) against the rectangle [10, 24] x [5, 12].
//   inside in time: c = 3, 4, 5 (12..16, 16..20, 20..24); c = 2 (8..12) sticks out on the left, c = 6
//   (24..28) on the right, c = 1 (4..8) is outside altogether
//   inside in price: r = 3, 4, 5 (6..8, 8..10, 10..12); r = 2 (4..6) and r = 6 (12..14) stick out
const RECT = [10, 24, 5, 12];
const CELLS = grid(range(1, 6), range(1, 6));
function cells(over) {
  return E.cohort.cells(Object.assign({ cells: CELLS, mode: "volume", basis: "amount", b: RECT, level: LEVEL, cut: 1000, CUT: 1000, end: Infinity, replay: false, geom: GEOM }, over));
}

test("the cells cohort is the fully covered cells inside the rectangle: viewport-cut cells are partial and counted", () => {
  const c = cells({});
  // members c = 3..5 x r = 3..5 in loop order: 10c + r
  assert.deepEqual(vals(c), [33, 34, 35, 43, 44, 45, 53, 54, 55]);
  assert.equal(c.kind, "cells");
  assert.equal(c.n, 9);
  assert.equal(c.zeros, 0);
  assert.equal(c.nonzero, 9);
  assert.deepEqual(plain(c.excluded), excl({ partial: 27 }), "36 cells - 9 members; none open (cut 1000)");
  assert.equal(c.calibratedOn, "view");
  assert.deepEqual(plain(c.bounds), RECT);
  assert.deepEqual(plain(c.level), LEVEL);
  assert.equal(c.obsEndBase, 24, "the last member ends at base column 24");
  assert.deepEqual(plain(c.support), { timeBase: [12, 24], priceRows: [6, 12] });
  assert.ok(c.values instanceof Float64Array || Object.prototype.toString.call(c.values) === "[object Float64Array]");
});

test("a selection names itself, the lens names itself, quality is recorded", () => {
  assert.equal(cells({ selection: true }).calibratedOn, "selection", "the declared rectangle AT INIT (A-13c)");
  const lens = cells({ kind: "lens", calibratedOn: "lens" });
  assert.equal(lens.kind, "lens");
  assert.equal(lens.calibratedOn, "lens");
  assert.deepEqual(vals(lens), vals(cells({})), "the same extraction over the lens rectangle");
  assert.equal(cells({ quality: "coarse" }).quality, "coarse");
  assert.equal(cells({ read: { state: "recorded" } }).quality, "recorded", "else the read state of the block");
  assert.equal(cells({}).quality, null);
});

test("the level is named by {n, m} or by the steps ts and ps; an unusual step has no level to name", () => {
  const byStep = cells({ level: undefined, ts: TS, ps: PS });
  assert.deepEqual(plain(byStep.level), LEVEL);
  assert.deepEqual(vals(byStep), vals(cells({})));
  assert.equal(cells({ level: undefined, ts: 3, ps: 2 }).level, null);
});

test("an open column is excluded before anything else: live it crosses CUT, in replay it crosses the cutoff", () => {
  // CUT = 18: a cell ending after 18 is open, i.e. c = 4, 5, 6 (ends 20, 24, 28), 18 cells, whatever their rows.
  // Of the remaining c = 1, 2, 3 only c = 3 is inside in time, and r = 3..5 inside in price: 3 members; the other
  // 15 are partial (c = 1, 2: 12 cells; c = 3 with r = 1, 2, 6: 3 cells).
  const live = cells({ cut: 18, CUT: 18 });
  assert.deepEqual(vals(live), [33, 34, 35]);
  assert.deepEqual(plain(live.excluded), excl({ open: 18, partial: 15 }));
  assert.equal(live.obsEndBase, 16);
  // In replay the live edge is a choice, not a limit: CUT = 18 is ignored, the cutoff 30 is what counts, and
  // nothing ends after 30, so the standard picture is back (9 members, 27 partial).
  const replay = cells({ replay: true, CUT: 18, cut: 30 });
  assert.deepEqual(vals(replay), vals(cells({})));
  assert.deepEqual(plain(replay.excluded), excl({ partial: 27 }));
  // A replay cutoff of 18 crops exactly like the live edge.
  assert.deepEqual(plain(cells({ replay: true, CUT: 1000, cut: 18 }).excluded), excl({ open: 18, partial: 15 }));
  // Live, the cutoff may be the smaller: min(cut, CUT).
  assert.deepEqual(plain(cells({ cut: 18, CUT: 1000 }).excluded), excl({ open: 18, partial: 15 }));
  // A cell that ends EXACTLY on the edge is whole, not open (20 is a member edge for CUT = 20).
  const exact = cells({ cut: 20, CUT: 20 });
  assert.deepEqual(vals(exact), [33, 34, 35, 43, 44, 45]);
  assert.equal(exact.obsEndBase, 20);
});

test("selection-cut and cutoff-cut cells are partial or open, and an empty intersection is an empty cohort, not a failure", () => {
  const cut = cells({ b: [10, 22, 5, 12] });
  assert.deepEqual(vals(cut), [33, 34, 35, 43, 44, 45], "c = 5 (20..24) sticks out of a selection ending at 22");
  assert.deepEqual(plain(cut.excluded), excl({ partial: 30 }));
  const none = cells({ b: [13, 15, 5, 12] });
  assert.equal(none.n, 0);
  assert.equal(none.obsEndBase, null);
  assert.deepEqual(plain(none.support), { timeBase: null, priceRows: null });
  assert.equal(none.ok, undefined, "an empty cohort is a cohort (the fit answers No calibration), not a refusal");
});

test("motion: cells at or after the motion end are unread, the last measured column is a member, movement-only cells count", () => {
  // Path in USDT moved (z.p); motion end = 20 base columns. c = 5, 6 start at 20 and 24: unread, 12 cells. c = 4 ends
  // exactly at 20: whole. c = 3, 4 x r = 3..5 are the six members; the other c = 1..4 cells are partial (18).
  const motion = E.cohort.motionCells({
    cells: grid(range(1, 6), range(1, 6), (c, r) => cell(c, r, { v: 0, ct: c === 3 && r === 3 ? 0 : 1, p: 100 * c + r })),
    mode: "path",
    pathBasis: "usdt",
    b: RECT,
    level: LEVEL,
    cut: 1000,
    CUT: 1000,
    end: 20,
    geom: GEOM,
  });
  assert.equal(motion.kind, "motion");
  assert.deepEqual(vals(motion), [303, 304, 305, 403, 404, 405]);
  assert.deepEqual(plain(motion.excluded), excl({ unread: 12, partial: 18 }));
  assert.equal(motion.obsEndBase, 20);
  // The movement-only cell (ct = 0: it moved, it did not trade) c = 3, r = 3 is a member with its 303 USDT.
  assert.ok(vals(motion).includes(303));
  // `measured(z)` false (a base cell the motion summary has no entry for) is unread as well, and is asked only
  // about cells the page drew.
  const asked = [];
  const measured = (z) => (asked.push(z.c + "," + z.r), !(z.c === 4 && z.r === 4));
  const some = E.cohort.motionCells({
    cells: grid(range(3, 4), range(3, 5), (c, r) => cell(c, r, { p: 100 * c + r })),
    mode: "path",
    pathBasis: "usdt",
    b: RECT,
    level: LEVEL,
    cut: 1000,
    CUT: 1000,
    end: 20,
    measured,
    geom: GEOM,
  });
  assert.deepEqual(vals(some), [303, 304, 305, 403, 405]);
  assert.deepEqual(plain(some.excluded), excl({ unread: 1 }));
  assert.equal(asked.length, 6);
});

test("motion measures read the covered time and width: Path spans, Dwell share, invalid dwell is counted", () => {
  // Every cell whole: a cell is 225 s x 250 USDT. Path 500 USDT over 250 USDT of height = 2 row spans.
  const spans = E.cohort.motionCells({ cells: [cell(3, 3, { p: 500 }), cell(3, 4, { p: 250 }), cell(3, 5, { p: 0 })], mode: "path", pathBasis: "spans", b: RECT, level: LEVEL, cut: 1000, CUT: 1000, end: 1000, geom: GEOM });
  assert.deepEqual(vals(spans), [2, 1, 0]);
  assert.equal(spans.zeros, 1);
  assert.equal(spans.nonzero, 2);
  // Dwell 112.5 s of 225 s = 0.5; a full 225 s = 1; 0 s = 0 (a measured zero); more than the covered time or
  // a negative dwell is an invalid input and counted nonFinite; it is never clamped into the cohort.
  const dwell = E.cohort.motionCells({ cells: [cell(3, 3, { w: 112.5 }), cell(3, 4, { w: 225 }), cell(3, 5, { w: 0 }), cell(4, 3, { w: 300 }), cell(4, 4, { w: -5 })], mode: "dwell", b: RECT, level: LEVEL, cut: 1000, CUT: 1000, end: 1000, geom: GEOM });
  assert.deepEqual(vals(dwell), [0.5, 1, 0]);
  assert.deepEqual(plain(dwell.excluded), excl({ nonFinite: 2 }));
});

test("non-members are counted by kind: NaN is nonFinite, a negative unsigned value is negative, nothing to measure is a placeholder, an unanswered read is unread", () => {
  const nonFinite = cells({ cells: [cell(3, 3, { v: NaN }), cell(3, 4, { v: Infinity }), cell(3, 5, { v: 7 })] });
  assert.deepEqual(vals(nonFinite), [7]);
  assert.deepEqual(plain(nonFinite.excluded), excl({ nonFinite: 2 }));
  const negative = cells({ cells: [cell(3, 3, { v: -3 }), cell(3, 4, { v: 4 })] });
  assert.deepEqual(vals(negative), [4]);
  assert.deepEqual(plain(negative.excluded), excl({ negative: 1 }), "Volume is unsigned: counted, never clamped");
  // Delta is signed: its negative values are members (2 bv - v).
  const delta = cells({ mode: "delta", cells: [cell(3, 3, { bv: 0, v: 6 }), cell(3, 4, { bv: 5, v: 6 }), cell(3, 5, { bv: 3, v: 6 })] });
  assert.deepEqual(vals(delta), [-6, 4, 0]);
  assert.equal(delta.zeros, 1);
  assert.deepEqual(plain(delta.excluded), EMPTY);
  // Size without trades and Flow without volume have nothing to measure: placeholders, not zeros.
  const size = cells({ mode: "size", basis: "mean", cells: [cell(3, 3, { ct: 0, v: 0 }), cell(3, 4, { ct: 2, v: 10 })] });
  assert.deepEqual(vals(size), [5]);
  assert.deepEqual(plain(size.excluded), excl({ placeholder: 1 }));
  const flow = cells({ mode: "flow", cells: [cell(3, 3, { v: 0, bv: 0 }), cell(3, 4, { v: 8, bv: 2 })] });
  assert.deepEqual(vals(flow), [0.25]);
  assert.deepEqual(plain(flow.excluded), excl({ placeholder: 1 }));
  // A Cascade cell with no source yet is unread, and the level's own typed answer for one that has a source
  // decides the rest: a waiting-for-parent entry is a placeholder.
  const noSource = cells({ mode: "cascade", cells: [cell(3, 3)] });
  assert.deepEqual(plain(noSource.excluded), excl({ unread: 1 }));
  assert.equal(noSource.n, 0);
  const cascade = (z, out) => {
    if (z.r === 3) {
      out.tag = 0;
      out.value = 1;
    } else {
      out.tag = E.result.TAG["waiting-for-complete-parent"];
      out.value = NaN;
    }
  };
  const withSource = cells({ mode: "cascade", cascade, cells: [cell(3, 3), cell(3, 4)] });
  assert.deepEqual(vals(withSource), [1]);
  assert.deepEqual(plain(withSource.excluded), excl({ placeholder: 1 }));
});

test("measured zeros are members and decide the zero-only case; placeholders never create one (D3, S1-074, S1-075)", () => {
  const zeros = cells({ cells: [cell(3, 3, { v: 0 }), cell(3, 4, { v: 0 }), cell(3, 5, { v: 0 })] });
  assert.deepEqual(vals(zeros), [0, 0, 0]);
  assert.equal(zeros.zeros, 3);
  assert.equal(zeros.nonzero, 0);
  // Nothing but placeholders: no members at all, so the cohort is empty (No calibration), not a zero cohort.
  const placeholders = cells({ mode: "size", basis: "mean", cells: [cell(3, 3, { ct: 0, v: 0 }), cell(3, 4, { ct: 0, v: 0 })] });
  assert.equal(placeholders.n, 0);
  assert.equal(placeholders.zeros, 0);
  const unread = cells({ measured: () => false });
  assert.equal(unread.n, 0);
  assert.equal(unread.excluded.unread, 36);
  const fits = E.scale ? { zero: E.scale.fitValue(zeros), empty: E.scale.fitValue(placeholders), rank0: E.scale.fitRank(zeros), rankEmpty: E.scale.fitRank(unread) } : null;
  if (fits) {
    assert.equal(fits.zero.descriptor.kind, "zero-only");
    assert.equal(fits.empty.state, "no-calibration");
    assert.equal(fits.empty.reason, "empty cohort");
    assert.equal(fits.rank0.descriptor.kind, "zero-only", "DR-40: the rank fit of a measured all-zero cohort is the same zero-only calibration");
    assert.equal(fits.rank0.descriptor.id, fits.zero.descriptor.id);
    assert.equal(fits.rankEmpty.state, "no-calibration");
  }
});

test("the cohort feeds the fits: the nine-cell cohort gives U = 55, k = 44 and a 257-knot rank from 33 to 55", { todo: E.scale ? false : "part 08-scale is not in this build (ENCODING_ONLY=cohort)" }, () => {
  if (!E.scale) return;
  const c = cells({});
  // Hand: members 33 34 35 43 44 45 53 54 55; the largest is 55, the median of nine is the fifth, 44.
  const v = E.scale.fitValue(c);
  assert.deepEqual(plain(v.descriptor.params), { U: 55, k: 44 });
  const r = E.scale.fitRank(c);
  assert.equal(r.descriptor.params.knots[0], 33);
  assert.equal(r.descriptor.params.knots[256], 55);
});

test("a cohort is refused, not shrunk, while a read has not answered: failed, unsupported, pending, stale, updating, loading", () => {
  const cases = [
    [{ state: "failed" }, "failed"],
    [{ state: "unsupported" }, "unsupported"],
    [{ state: "pending" }, "pending"],
    [{}, "pending"],
    [{ state: "exact", stale: true }, "stale"],
    [{ state: "cube", updating: true }, "updating"],
    [{ state: "recorded", loading: true }, "loading"],
  ];
  for (const [read, reason] of cases) {
    assert.deepEqual(plain(cells({ read })), { ok: false, reason }, JSON.stringify(read));
    assert.deepEqual(plain(E.cohort.motionCells(Object.assign({ cells: CELLS, mode: "path", pathBasis: "usdt", b: RECT, level: LEVEL, read }))), { ok: false, reason });
  }
  assert.deepEqual(plain(cells({ loading: true })), { ok: false, reason: "loading" }, "any tier still loading (the page-wide flag)");
  // Several reads: the most severe one is named, and every one must have answered.
  assert.deepEqual(plain(cells({ read: [{ state: "exact" }, { state: "pending" }, { state: "failed" }] })), { ok: false, reason: "failed" });
  assert.deepEqual(plain(cells({ read: [{ state: "exact" }, { state: "cube", updating: true }], loading: true })), { ok: false, reason: "updating" });
  assert.equal(cells({ read: [{ state: "exact" }, { state: "cube" }] }).n, 9);
  for (const state of ["exact", "recorded", "cube"]) assert.equal(cells({ read: { state } }).n, 9, state);
  assert.equal(cells({ read: null }).n, 9, "no read needed");
  // The geometry has nothing to fit.
  assert.deepEqual(plain(cells({ mode: "geometry" })), { ok: false, reason: "unsupported" });
});

test("programmer errors throw: no cells, an unknown mode, no level, no rectangle", () => {
  assert.throws(() => E.cohort.cells(null), isType);
  assert.throws(() => E.cohort.cells({ mode: "volume", b: RECT, level: LEVEL }), isType);
  assert.throws(() => cells({ mode: "nope" }), isType);
  assert.throws(() => cells({ level: undefined }), isType);
  assert.throws(() => cells({ b: [1, 2, 3] }), isType);
  assert.throws(() => cells({ b: [NaN, 2, 3, 4] }), isType);
  assert.throws(() => E.cohort.columns({ columns: [], b: [0, 1, 0, 1], level: LEVEL }), isType, "no key");
});

test("the inputs are never mutated and a cohort without its values is JSON-safe", () => {
  const cs = grid(range(1, 6), range(1, 6));
  const before = JSON.stringify(cs);
  const b = RECT.slice();
  const c = E.cohort.cells({ cells: cs, mode: "volume", basis: "amount", b, level: LEVEL, cut: 1000, CUT: 1000, geom: GEOM });
  assert.equal(JSON.stringify(cs), before);
  assert.deepEqual(b, RECT);
  const { values, ...record } = c;
  assert.equal(values.length, c.n);
  E.result.assertJsonSafe(record);
  // An unbounded rectangle is legal input, but its record has no bounds to write.
  const open = cells({ b: [-Infinity, Infinity, -Infinity, Infinity] });
  assert.equal(open.n, 36);
  assert.equal(open.bounds, null);
  E.result.assertJsonSafe((({ values: _v, ...rest }) => rest)(open));
});

// Independent oracle: membership by CONTAINMENT in integer base units. The module computes exposure
// fractions; this is the same rule as the prose of C.4.3 written as intervals.
test("property (seeded): the cohort equals interval containment, and its ledger adds up to the cell count", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const next = mulberry32(seed);
    const n = int(next, 0, 5);
    const m = int(next, 0, 3);
    const ts = 2 ** n;
    const ps = 2 ** m;
    const t0 = int(next, -5, 40);
    const t1 = t0 + int(next, 1, 60);
    const r0 = int(next, -5, 30);
    const r1 = r0 + int(next, 1, 40);
    const replay = next() < 0.4;
    const pick = (hi) => (next() < 0.3 ? Infinity : int(next, 0, hi));
    const cut = pick(80);
    const end = next() < 0.5 ? Infinity : int(next, 0, 80);
    const CUT = pick(80);
    const cs = [];
    for (let i = 0; i < 60; i++) {
      const x = next();
      cs.push({ c: int(next, 0, 40 >> n), r: int(next, 0, 30 >> m), v: x < 0.1 ? 0 : x < 0.15 ? -2 : x < 0.2 ? NaN : int(next, 1, 99), bv: 0, ct: 1, bt: 0, p: 0, w: 0 });
    }
    const readable = (z) => (z.c * 7 + z.r) % 5 !== 0;
    const got = E.cohort.cells({ cells: cs, mode: "volume", basis: "amount", b: [t0, t1, r0, r1], level: { n, m }, cut, CUT, end, replay, measured: readable, geom: GEOM });
    const want = { values: [], excluded: excl({}), t1: -Infinity };
    for (const z of cs) {
      const edge = Math.min(cut, end, replay ? Infinity : CUT);
      if (!readable(z) || z.c * ts >= end) want.excluded.unread++;
      else if ((z.c + 1) * ts > edge) want.excluded.open++;
      else if (!(z.c * ts >= t0 && (z.c + 1) * ts <= t1 && z.r * ps >= r0 && (z.r + 1) * ps <= r1)) want.excluded.partial++;
      else if (Number.isNaN(z.v)) want.excluded.nonFinite++;
      else if (z.v < 0) want.excluded.negative++;
      else {
        want.values.push(z.v);
        want.t1 = Math.max(want.t1, (z.c + 1) * ts);
      }
    }
    assert.deepEqual(vals(got), want.values, "values, seed " + seed);
    assert.deepEqual(plain(got.excluded), want.excluded, "excluded, seed " + seed);
    assert.equal(got.n, want.values.length);
    assert.equal(got.zeros, want.values.filter((x) => x === 0).length);
    assert.equal(got.n + Object.values(want.excluded).reduce((a, b) => a + b, 0), cs.length, "every cell is somewhere, seed " + seed);
    assert.equal(got.obsEndBase, want.values.length ? want.t1 : null);
  }
});

// ---- Rows ------------------------------------------------------------------------------------------------

const READY = { state: "ready", span: [100, 200] };
// Rows at the effective size m = 2 (4 base rows each): r = 9 is far off screen and is the peak.
const ROWS = [
  { r: 0, v: 5, bv: 2, w: 1.5 },
  { r: 1, v: 40, bv: 30, w: 0 },
  { r: 2, v: 7, bv: 1, w: 12 },
  { r: 3, v: 0, bv: 0, w: 4 },
  { r: 9, v: 900, bv: 100, w: 3 },
];
function rows(over) {
  return E.cohort.rows(Object.assign({ rows: ROWS, measure: "volume", m: 2, res: READY, stale: false, span: [100, 200], cut: Infinity }, over));
}

test("Rows: ALL rows of the period at the effective row size, off-screen rows included (a peak off screen still sets U)", () => {
  const c = rows({});
  assert.deepEqual(vals(c), [5, 40, 7, 0, 900]);
  assert.equal(c.kind, "rows");
  assert.equal(c.n, 5);
  assert.equal(c.zeros, 1);
  assert.equal(c.nonzero, 4);
  assert.deepEqual(plain(c.excluded), EMPTY);
  assert.equal(c.calibratedOn, "period");
  assert.equal(c.bounds, null);
  assert.equal(c.level, null);
  assert.equal(c.obsEndBase, 200);
  // rows r = 0..9 of 4 base rows each span base rows [0, 40]; the period's time span is [100, 200].
  assert.deepEqual(plain(c.support), { timeBase: [100, 200], priceRows: [0, 40] });
  if (E.scale) assert.equal(E.scale.fitValue(c).descriptor.params.U, 900, "the off-screen peak sets U");
});

test("Rows: Delta is 2 bv - v (signed, negatives are members), Time is w, each from the rows that carry it", () => {
  const delta = rows({ measure: "delta" });
  assert.deepEqual(vals(delta), [-1, 20, -5, 0, -700]);
  assert.equal(delta.zeros, 1);
  assert.deepEqual(plain(delta.excluded), EMPTY);
  const time = rows({ measure: "time", res: { state: "ready", span: [100, 200], end: 180 } });
  assert.deepEqual(vals(time), [1.5, 0, 12, 4, 3]);
  assert.equal(time.zeros, 1);
  assert.equal(time.obsEndBase, 180, "Time at price is observed to the last complete base column the dwell covers");
  // The rows of a dwell result carry no volume: the field is missing, which is NOT read as zero (a cohort of
  // invented zeros would be a false zero-only calibration, rows-underlay gotcha 5).
  const dwellRows = [{ r: 0, w: 2 }, { r: 1, w: 5 }];
  const falseZeros = rows({ rows: dwellRows, measure: "volume" });
  assert.equal(falseZeros.n, 0);
  assert.deepEqual(plain(falseZeros.excluded), excl({ nonFinite: 2 }));
  if (E.scale) assert.equal(E.scale.fitValue(falseZeros).state, "no-calibration");
  assert.deepEqual(vals(rows({ rows: dwellRows, measure: "time" })), [2, 5]);
  assert.equal(rows({ rows: [{ r: 0, v: 3 }], measure: "delta" }).excluded.nonFinite, 1, "Delta needs both v and bv");
});

test("Rows: negative unsigned values and non-finite values are counted and left out", () => {
  const c = rows({ rows: [{ r: 0, v: -4, bv: 0, w: 0 }, { r: 1, v: NaN, bv: 0, w: 0 }, { r: 2, v: 6, bv: 0, w: 0 }] });
  assert.deepEqual(vals(c), [6]);
  assert.deepEqual(plain(c.excluded), excl({ negative: 1, nonFinite: 1 }));
  assert.equal(rows({ rows: [] }).n, 0);
});

test("Rows: observation end is the period end, never beyond the cutoff", () => {
  assert.equal(rows({ cut: 150 }).obsEndBase, 150);
  assert.equal(rows({ cut: 250 }).obsEndBase, 200);
  assert.deepEqual(plain(rows({ cut: 150 }).support.timeBase), [100, 150]);
  assert.equal(rows({ cut: 150, measure: "time", res: { state: "ready", span: [100, 200], end: 180 } }).obsEndBase, 150);
  assert.equal(rows({ res: { state: "ready" }, span: [100, 200] }).obsEndBase, 200, "without the result's span the period's own end");
  assert.equal(rows({ res: { state: "ready" }, span: null }).obsEndBase, null);
});

test("Rows: stale, pending and failed results are refused (never fitted from the previous period's rows)", () => {
  assert.deepEqual(plain(rows({ stale: true })), { ok: false, reason: "stale" });
  assert.deepEqual(plain(rows({ res: { state: "ready", span: [100, 200], stale: true } })), { ok: false, reason: "stale" });
  assert.deepEqual(plain(rows({ span: [100, 260] })), { ok: false, reason: "stale" }, "the result ends elsewhere than the period does now (rollover)");
  assert.deepEqual(plain(rows({ res: { state: "pending", span: [100, 200] } })), { ok: false, reason: "pending" });
  assert.deepEqual(plain(rows({ res: null })), { ok: false, reason: "pending" });
  assert.deepEqual(plain(rows({ res: { state: "failed", reason: "x" } })), { ok: false, reason: "failed" });
  assert.deepEqual(plain(rows({ stale: true, res: { state: "pending" } })), { ok: false, reason: "stale" }, "lineShown's stale stand-in");
  // Relative volume has a fixed domain and no cohort.
  assert.deepEqual(plain(rows({ measure: "relvol" })), { ok: false, reason: "unsupported" });
  assert.throws(() => rows({ measure: "nope" }), isType);
  assert.throws(() => rows({ m: undefined }), isType);
  assert.throws(() => rows({ m: -1 }), isType);
  assert.throws(() => rows({ rows: null }), isType);
});

// ---- columns: counts only --------------------------------------------------------------------------------

function col(c, over) {
  return Object.assign({ c, v: 10, bv: 5, ct: 2, bt: 1, p: 4, hi: 9, lo: 1 }, over);
}

test("columns: counts only (n, complete, partial, open, zeros), never values and never a fit", () => {
  // ts = 4, rectangle 10..24, CUT = 26. c = 1 (4..8) and c = 2 (8..12) stick out on the left: partial. c = 3..5
  // (12..24) are complete. c = 6 (24..28) and c = 7 (28..32) end after CUT: open (open is decided first).
  const columns = [col(1), col(2), col(3, { v: 0, bv: 0 }), col(4), col(5), col(6, { v: 0, bv: 0 }), col(7)];
  const got = E.cohort.columns({ columns, key: "volume", b: [10, 24, -Infinity, Infinity], level: LEVEL, cut: 1000, CUT: 26, geom: GEOM });
  assert.deepEqual(plain(got), { n: 7, complete: 3, partial: 2, open: 2, zeros: 2 });
  assert.deepEqual(Object.keys(got), ["n", "complete", "partial", "open", "zeros"]);
  assert.equal("values" in got, false);
  assert.equal(got.n, got.complete + got.partial + got.open);
  // Delta zeros: a balanced column (2 bv - v = 0); Size with no trades is undefined, not zero.
  const delta = E.cohort.columns({ columns: [col(3, { v: 10, bv: 5 }), col(4, { v: 10, bv: 6 })], key: "delta", b: [10, 24, -Infinity, Infinity], level: LEVEL, cut: 1000, CUT: 1000 });
  assert.equal(delta.zeros, 1);
  const size = E.cohort.columns({ columns: [col(3, { v: 0, ct: 0 }), col(4, { v: 0, ct: 2 })], key: "size", b: [10, 24, -Infinity, Infinity], level: LEVEL, cut: 1000, CUT: 1000 });
  assert.equal(size.zeros, 1, "only the column with trades and no volume is a measured zero");
  // Replay: CUT is not a limit, the cutoff is.
  const replay = E.cohort.columns({ columns, key: "volume", b: [10, 24, -Infinity, Infinity], level: LEVEL, cut: 1000, CUT: 26, replay: true });
  assert.deepEqual(plain(replay), { n: 7, complete: 3, partial: 4, open: 0, zeros: 2 }, "c = 6, 7 lie right of the rectangle: partial");
  // No columns, no counts.
  assert.deepEqual(plain(E.cohort.columns({ columns: [], key: "volume", b: [0, 1, 0, 1], level: LEVEL })), { n: 0, complete: 0, partial: 0, open: 0, zeros: 0 });
  // A per-column context (the ratio columns take their structure from the page, per column).
  const ratio = E.cohort.columns({ columns: [col(3), col(4)], key: "cascade", b: [10, 24, -Infinity, Infinity], level: LEVEL, cut: 1000, CUT: 1000, ctxFor: () => ({ read: { state: "pending" } }) });
  assert.equal(ratio.zeros, 0, "a pending column is not a zero");
});
