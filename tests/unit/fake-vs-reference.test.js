"use strict";
// U07 fake-vs-reference.test.js (H3): the fake cube's answers against the exact-rational reference calculator.
//
// What is compared: the fake (tests/support/cube-fake.js, served over real HTTP, decoded here with a DataView and node:zlib) and the
// reference calculator (tests/reference, BigInt rationals, no code shared with the fake) on the same trade lists: every hand-authored
// micro-sequence of tests/fixtures/trades/ and 20 seeded random sets of 200-2000 trades. For each: the base and coarser cells at levels
// (0,0), (2,1), (4,0), (6,1) and (12,3) over the whole history and over a rectangle cut inside columns and rows, the movement cells of
// the same rectangles, the bars at every bar level, and the summaries (totals and points of control).
//
// Oracle: tests/reference (exact sums rounded once) and, for the micro-sequences, the hand-computed `expected` blocks, which are checked
// against the fake directly as well so that a shared misreading of the reference and the fake cannot hide behind their agreement.
// Tolerances are exactly D4: near(a, b) := |a - b| <= 1e-12 max(|a|, |b|) + 1e-12 for USDT volumes, counts and keys exact; path and
// dwell use the motion floors (1e-9 absolute plus 1e-12 relative); high and low are prices and must be bit-equal.
// The random inputs come from tests/support/rng.js (mulberry32): they are INPUTS, never expectations.
// Not covered: what the real Origo does (TESTPLAN 4.7 L1-L4): the motion semantics compared here are the fake's own, stated in
// tests/reference/motion.js.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { startFake } = require("../support/cube-fake.js");
const { mulberry32, int, normal, subSeed } = require("../support/rng.js");
const ref = require("../reference/index.js");

const TRADES_DIR = path.join(__dirname, "..", "fixtures", "trades");
const EPOCH = Date.parse("2021-01-01T00:00:00Z");
const LEVELS = [[0, 0], [2, 1], [4, 0], [6, 1], [12, 3]];
const BAR_LEVELS = [2, 4, 6, 8, 9];
const SEED = 20260930;

// ---- comparison helpers ----

const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;
const nearFloor = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) + 1e-9;
const sameNumber = (a, b) => (Number.isNaN(a) ? Number.isNaN(b) : a === b);

// decode(block): an independent decoder of the layouts of maps/bridge-fake-cube.md 1.3 (DataView, no shared code with tests/support/wire.js).
const FIELDS = {
  MSC2: [["vol", 8], ["tbvol", 8], ["ct", 8], ["bt", 8], ["col", 4], ["row", 4]],
  MSC3: [["vol", 8], ["tbvol", 8], ["ct", 8], ["bt", 8], ["path", 8], ["dwell", 8], ["high", 8], ["low", 8], ["col", 4], ["row", 4]],
  MSCB: [["open", 8], ["high", 8], ["low", 8], ["close", 8], ["vol", 8], ["tbvol", 8], ["btc", 8], ["cnt", 8], ["col", 4]],
};
function decode(meta) {
  const bytes = zlib.gunzipSync(Buffer.from(meta.gzip_base64, "base64"));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const magic = bytes.toString("latin1", 0, 4);
  const count = dv.getUint32(16, true);
  const out = { magic, n: dv.getUint8(4), m: dv.getUint8(5), col0: dv.getUint32(8, true), col1: dv.getUint32(12, true), count };
  let at = 32;
  for (const [name, size] of FIELDS[magic]) {
    out[name] = [];
    for (let i = 0; i < count; i++) out[name].push(size === 8 ? dv.getFloat64(at + 8 * i, true) : dv.getUint32(at + 4 * i, true));
    at += size * count;
  }
  assert.equal(at, bytes.length, `${magic} payload size`);
  return out;
}

const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
async function ask(fake, route, params, token) {
  const response = await fetch(`${fake.url}/cube/${route}?${qs({ ...params, pack: token, proto: 2 })}`);
  const text = await response.text();
  assert.equal(response.status, 200, `${route} ${qs(params)}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// cellsEqual(got, want, where): the decoded MSC2 block against reference cells: set and order, counts exact, volumes near.
function cellsEqual(got, want, where) {
  assert.deepEqual(got.col.map((c, i) => [c, got.row[i]]), want.map((x) => [x.c, x.r]), `${where}: the set and order of cells`);
  want.forEach((w, i) => {
    assert.equal(got.ct[i], w.ct, `${where} ${w.c},${w.r}: count`);
    assert.equal(got.bt[i], w.bt, `${where} ${w.c},${w.r}: taker-buy count`);
    assert.ok(near(got.vol[i], w.v), `${where} ${w.c},${w.r}: volume ${got.vol[i]} vs ${w.v}`);
    assert.ok(near(got.tbvol[i], w.bv), `${where} ${w.c},${w.r}: taker-buy volume ${got.tbvol[i]} vs ${w.bv}`);
  });
}

// motionEqual(got, want, where): the decoded MSC3 block against reference movement cells.
function motionEqual(got, want, where) {
  assert.deepEqual(got.col.map((c, i) => [c, got.row[i]]), want.map((x) => [x.c, x.r]), `${where}: the set and order of movement cells`);
  want.forEach((w, i) => {
    const at = `${where} ${w.c},${w.r}`;
    assert.equal(got.ct[i], w.ct, `${at}: count`);
    assert.equal(got.bt[i], w.bt, `${at}: taker-buy count`);
    assert.ok(near(got.vol[i], w.v), `${at}: volume`);
    assert.ok(near(got.tbvol[i], w.bv), `${at}: taker-buy volume`);
    assert.ok(nearFloor(got.path[i], w.p), `${at}: path ${got.path[i]} vs ${w.p}`);
    assert.ok(nearFloor(got.dwell[i], w.w), `${at}: dwell ${got.dwell[i]} vs ${w.w}`);
    assert.ok(sameNumber(got.high[i], w.hi), `${at}: high ${got.high[i]} vs ${w.hi}`);
    assert.ok(sameNumber(got.low[i], w.lo), `${at}: low ${got.low[i]} vs ${w.lo}`);
  });
}

function barsEqual(got, want, where) {
  assert.deepEqual(got.col, want.map((b) => b.col), `${where}: the columns that have bars`);
  want.forEach((w, i) => {
    const at = `${where} bar ${w.col}`;
    for (const [a, b] of [["open", "open"], ["high", "high"], ["low", "low"], ["close", "close"]]) assert.equal(got[a][i], w[b], `${at}: ${a}`);
    assert.ok(near(got.vol[i], w.volume), `${at}: volume`);
    assert.ok(near(got.tbvol[i], w.takerBuyVolume), `${at}: taker-buy volume`);
    assert.ok(near(got.btc[i], w.baseVolume), `${at}: base volume`);
    assert.equal(got.cnt[i], w.trades, `${at}: trades`);
  });
}

// ---- one trade list, every comparison ----

const rowOf = (price) => Math.floor(price / 12500);

// compareAll(fake, trades, gaps, label): everything the fake answers that the reference can, at the fake's current cutoff.
async function compareAll(fake, trades, gaps, label) {
  const info = fake.info();
  const token = info.packToken;
  const cutMs = Date.parse(info.cutoff) - EPOCH;
  const top = Math.ceil(info.cutoffBase);
  const closed = Math.floor(info.cutoffBase);
  const rows = trades.map((t) => rowOf(t.price));
  const rowLo = Math.min(...rows);
  const rowHi = Math.max(...rows);
  // two rectangles: everything, and one cut inside columns and rows (when the data is wide enough to cut)
  const rects = [{ name: "all", b0: 0, b1: top, r0: null, r1: null }];
  if (top >= 8 && rowHi - rowLo >= 3) rects.push({ name: "cut", b0: Math.floor(top / 4) + 1, b1: top - 1, r0: rowLo + 1, r1: rowHi });
  let checks = 0;
  for (const rect of rects) {
    for (const [n, m] of LEVELS) {
      const where = `${label} ${rect.name} (${n},${m})`;
      const params = { n, m, b0: rect.b0, b1: rect.b1, r0: rect.r0, r1: rect.r1 };
      // cells and the cube's own summary (the query route carries both)
      const answer = await ask(fake, "query", params, token);
      const want = ref.cells(trades, { n, m, b0: rect.b0, b1: rect.b1, r0: rect.r0, r1: rect.r1 });
      cellsEqual(decode(answer.block), want, where);
      // summary: totals near/exact, the points of control (level rows, lower row wins ties)
      const s = ref.summary(trades, { n, m, b0: rect.b0, b1: rect.b1, r0: rect.r0, r1: rect.r1 });
      assert.ok(near(answer.summary.volume, s.volume), `${where}: summary volume`);
      assert.ok(near(answer.summary.taker_buy_volume, s.takerBuyVolume), `${where}: summary taker-buy volume`);
      assert.equal(answer.summary.trade_count, s.trades, `${where}: summary trades`);
      assert.equal(answer.summary.taker_buy_trade_count, s.takerBuyTrades, `${where}: summary taker-buy trades`);
      assert.equal(answer.summary.poc, s.poc, `${where}: point of control`);
      assert.equal(answer.summary.taker_buy_poc, s.takerBuyPoc, `${where}: taker-buy point of control`);
      // movement cells over the same rectangle: never the open column, measures end at the last closed column
      if (rect.b0 < closed) {
        // /cube/query, not /cube/tile: the tile route never reads r0/r1 (maps/bridge-fake-cube.md 1.4)
        const moved = await ask(fake, "query", { ...params, motion: 1 }, token);
        const wantMotion = ref.motion(trades, { n, m, b0: rect.b0, b1: Math.min(rect.b1, closed), r0: rect.r0, r1: rect.r1, end: cutMs, gaps });
        motionEqual(decode(moved.block), wantMotion, `${where} motion`);
        checks++;
      }
      checks += 2;
    }
  }
  // bars at every level over the whole history
  for (const n of BAR_LEVELS) {
    const answer = await ask(fake, "bars", { n, b0: 0, b1: top }, token);
    barsEqual(decode(answer.bars), ref.bars(trades, { n, b0: 0, b1: closed }), `${label} bars n=${n}`);
    checks++;
  }
  return checks;
}

// ---- the hand-authored micro-sequences ----

const microNames = fs.readdirSync(TRADES_DIR).filter((f) => f.endsWith(".json") && f !== "provenance.json").map((f) => f.slice(0, -5)).sort();

describe("the hand-authored micro-sequences: fake == reference == hand-computed expectations", () => {
  for (const name of microNames) {
    const fixture = JSON.parse(fs.readFileSync(path.join(TRADES_DIR, `${name}.json`), "utf8"));
    describe(`micro:${name}`, () => {
      let fake;
      before(async () => { fake = await startFake({ profile: `micro:${name}` }); });
      after(() => fake.close());

      it("every level, rectangle, bar level and summary equals the reference", async () => {
        assert.ok((await compareAll(fake, fixture.trades, fixture.gaps, name)) >= 20);
      });

      it("the cutoff is the fixture's and the open column is where the notes say", () => {
        const info = fake.info();
        assert.equal(Date.parse(info.cutoff) - EPOCH, fixture.expected.rect.cutMs);
        assert.equal(Math.ceil(info.cutoffBase), fixture.expected.rect.cellsB1);
        assert.equal(Math.floor(info.cutoffBase), fixture.expected.rect.motionB1);
      });

      it("the fake's answers equal the HAND-COMPUTED expectations directly (cells, movement cells, bars)", async () => {
        const e = fixture.expected;
        const token = fake.info().packToken;
        for (const [level, list] of Object.entries(e.cells ?? {})) {
          const [n, m] = level.split(":").map(Number);
          const answer = await ask(fake, "tile", { n, m, b0: e.rect.b0, b1: e.rect.cellsB1 }, token);
          const got = decode(answer.block);
          assert.deepEqual(got.col.map((c, i) => [c, got.row[i]]), list.map((x) => [x.c, x.r]), `${name} cells ${level}`);
          list.forEach((w, i) => {
            assert.deepEqual([got.vol[i], got.tbvol[i], got.ct[i], got.bt[i]], [w.v, w.bv, w.ct, w.bt], `${name} cell ${w.c},${w.r} at ${level}`);
            assert.equal(2 * got.tbvol[i] - got.vol[i], w.d, `${name} Delta at ${w.c},${w.r}`);
          });
        }
        for (const [level, list] of Object.entries(e.motion ?? {})) {
          const [n, m] = level.split(":").map(Number);
          const answer = await ask(fake, "tile", { n, m, b0: e.rect.b0, b1: e.rect.cellsB1, motion: 1 }, token);
          const got = decode(answer.block);
          assert.deepEqual(got.col.map((c, i) => [c, got.row[i]]), list.map((x) => [x.c, x.r]), `${name} motion ${level}`);
          list.forEach((w, i) => {
            const at = `${name} movement cell ${w.c},${w.r} at ${level}`;
            assert.deepEqual([got.vol[i], got.tbvol[i], got.ct[i], got.bt[i]], [w.v, w.bv, w.ct, w.bt], at);
            // path and dwell are summed in floating point by the fake: the motion floors apply
            assert.ok(nearFloor(got.path[i], w.p), `${at}: path ${got.path[i]} vs ${w.p}`);
            assert.ok(nearFloor(got.dwell[i], w.w), `${at}: dwell ${got.dwell[i]} vs ${w.w}`);
            const hi = w.hi === "NaN" ? NaN : w.hi;
            const lo = w.lo === "NaN" ? NaN : w.lo;
            assert.ok(sameNumber(got.high[i], hi) && sameNumber(got.low[i], lo), `${at}: high/low`);
          });
        }
        for (const [nText, list] of Object.entries(e.bars ?? {})) {
          const answer = await ask(fake, "bars", { n: Number(nText), b0: 0, b1: e.rect.cellsB1 }, token);
          const got = decode(answer.bars);
          assert.deepEqual(got.col, list.map((b) => b.col), `${name} bars ${nText}`);
          list.forEach((w, i) => {
            assert.deepEqual([got.open[i], got.high[i], got.low[i], got.close[i], got.cnt[i]], [w.open, w.high, w.low, w.close, w.trades], `${name} bar ${w.col} at n=${nText}`);
            assert.ok(near(got.vol[i], w.volume) && near(got.tbvol[i], w.takerBuyVolume) && near(got.btc[i], w.baseVolume), `${name} bar ${w.col} volumes`);
          });
        }
      });
    });
  }
});

// ---- seeded random sets ----

// randomSet(i): 200-2000 trades, a price walk that crosses several 125 USDT rows, bursts of `count`, a few same-millisecond trades, two gaps.
function randomSet(i) {
  const next = mulberry32(subSeed(SEED, `set:${i}`));
  const size = 200 + Math.round((i * 1800) / 19);
  const trades = [];
  let t = int(next, 0, 50000);
  let price = 2500000 + int(next, -40000, 40000);
  for (let k = 0; k < size; k++) {
    t += next() < 0.03 ? 0 : int(next, 1, 12000); // now and then a same-millisecond trade (the order is the id)
    price = Math.max(100, Math.round(price + normal(next, 0, 9000)));
    trades.push({
      t_ms: t, price, qty: int(next, 20000, 1500000), takerBuy: next() < 0.5, ...(next() < 0.1 ? { count: int(next, 2, 9) } : {}),
    });
  }
  const last = trades[trades.length - 1].t_ms;
  let cutoffMs = Math.ceil((last + 1) / 60000) * 60000;
  if (i % 2 === 1) {
    // odd sets: the first minute edge whose open column (the base column the cutoff falls in) already holds the last three trades
    const third = trades[trades.length - 3].t_ms;
    for (let j = 0; j < 12; j++) {
      const c = cutoffMs + j * 60000;
      if (Math.floor(c / 56250) * 56250 <= third) {
        cutoffMs = c;
        break;
      }
    }
  } else {
    cutoffMs += int(next, 0, 3) * 60000;
  }
  const gaps = [];
  for (let g = 0; g < 2; g++) {
    const a = int(next, 0, Math.max(1, last - 1000));
    gaps.push([a, a + int(next, 500, Math.min(600000, cutoffMs))]);
  }
  return { trades, gaps, cutoffIso: new Date(EPOCH + cutoffMs).toISOString().replace(".000Z", "Z") };
}

describe("20 seeded random sets of 200-2000 trades: fake == reference", () => {
  for (let i = 0; i < 20; i++) {
    it(`set ${i}`, async () => {
      const set = randomSet(i);
      assert.ok(set.trades.length >= 200 && set.trades.length <= 2000);
      const fake = await startFake({ profile: { ...set, name: `rand-${i}` } });
      try {
        assert.ok((await compareAll(fake, set.trades, set.gaps, `set ${i}`)) >= 35);
      } finally {
        await fake.close();
      }
    });
  }

  it("the sets exercise what they are for: same-millisecond trades, bursts, trades in the open column, movement-only cells, gaps that remove dwell, multi-row moves", () => {
    let sameMs = 0, openSets = 0;
    for (let i = 0; i < 20; i++) {
      const { trades, gaps, cutoffIso } = randomSet(i);
      const cutMs = Date.parse(cutoffIso) - EPOCH;
      const closed = Math.floor(cutMs / 56250);
      sameMs += trades.filter((t, k) => k && t.t_ms === trades[k - 1].t_ms).length;
      if (trades.some((t) => Math.floor(t.t_ms / 56250) >= closed)) openSets++;
      assert.ok(trades.some((t) => t.count > 1), `set ${i}: bursts`);
      const withGaps = ref.motion(trades, { n: 0, m: 0, b0: 0, b1: closed, end: cutMs, gaps });
      const without = ref.motion(trades, { n: 0, m: 0, b0: 0, b1: closed, end: cutMs });
      assert.ok(withGaps.some((x) => x.ct === 0 && x.p > 0), `set ${i}: movement-only cells`);
      assert.ok(without.reduce((s, x) => s + x.w, 0) > withGaps.reduce((s, x) => s + x.w, 0), `set ${i}: a gap removes dwell`);
      const perColumn = new Map();
      for (const x of withGaps) if (x.p > 0) perColumn.set(x.c, (perColumn.get(x.c) ?? 0) + 1);
      assert.ok(Math.max(...perColumn.values()) >= 2, `set ${i}: a move crosses rows`);
    }
    assert.ok(sameMs >= 5, `${sameMs} same-millisecond trades over 20 sets`);
    assert.ok(openSets >= 8, `${openSets} sets with trades in the open column`);
  });

  it("the sets are deterministic (a seed reproduces its set) and differ from one another", () => {
    assert.deepEqual(randomSet(3), randomSet(3));
    assert.notDeepEqual(randomSet(3).trades.slice(0, 5), randomSet(4).trades.slice(0, 5));
    assert.equal(randomSet(0).trades.length, 200);
    assert.equal(randomSet(19).trades.length, 2000);
  });
});

// ---- the comparison has teeth ----

describe("the comparison itself: it passes equal answers, tolerates last bits and fails a real difference", () => {
  let fake, trades, gaps, token, top, closed, cellsAnswer, motionAnswer, barsAnswer;
  before(async () => {
    const f = JSON.parse(fs.readFileSync(path.join(TRADES_DIR, "mixed.json"), "utf8"));
    ({ trades, gaps } = f);
    fake = await startFake({ profile: "micro:mixed" });
    const info = fake.info();
    token = info.packToken;
    top = Math.ceil(info.cutoffBase);
    closed = Math.floor(info.cutoffBase);
    cellsAnswer = await ask(fake, "query", { n: 0, m: 0, b0: 0, b1: top }, token);
    motionAnswer = await ask(fake, "query", { n: 0, m: 0, b0: 0, b1: top, motion: 1 }, token);
    barsAnswer = await ask(fake, "bars", { n: 2, b0: 0, b1: top }, token);
  });
  after(() => fake.close());

  const want = () => ref.cells(trades, { n: 0, m: 0, b0: 0, b1: top });
  const wantMotion = () => ref.motion(trades, { n: 0, m: 0, b0: 0, b1: closed, end: 300000, gaps });
  const wantBars = () => ref.bars(trades, { n: 2, b0: 0, b1: closed });

  it("the untouched answers pass", () => {
    cellsEqual(decode(cellsAnswer.block), want(), "cells");
    motionEqual(decode(motionAnswer.block), wantMotion(), "motion");
    barsEqual(decode(barsAnswer.bars), wantBars(), "bars");
  });

  it("a relative difference of 1e-13 passes (last bits) and of 1e-9 fails, for volumes; counts have no tolerance", () => {
    const a = decode(cellsAnswer.block);
    a.vol[0] *= 1 + 1e-13;
    cellsEqual(a, want(), "last bits");
    a.vol[0] *= 1 + 1e-9;
    assert.throws(() => cellsEqual(a, want(), "drift"), /volume/);
    const b = decode(cellsAnswer.block);
    b.ct[2] += 1;
    assert.throws(() => cellsEqual(b, want(), "count"), /count/);
    const c = decode(cellsAnswer.block);
    c.row[1] += 1;
    assert.throws(() => cellsEqual(c, want(), "cell"), /the set and order/);
  });

  it("path and dwell have the 1e-9 floor, highs and lows none, NaN must be NaN", () => {
    const a = decode(motionAnswer.block);
    a.path[0] += 5e-10;
    a.dwell[1] += 5e-10;
    motionEqual(a, wantMotion(), "within the floor");
    a.path[0] += 1e-6;
    assert.throws(() => motionEqual(a, wantMotion(), "path"), /path/);
    const b = decode(motionAnswer.block);
    b.dwell[3] += 1e-6;
    assert.throws(() => motionEqual(b, wantMotion(), "dwell"), /dwell/);
    const c = decode(motionAnswer.block);
    c.high[0] += 1e-9; // 25,000.000000001: far below any tolerance of a price, and still wrong
    assert.throws(() => motionEqual(c, wantMotion(), "high"), /high/);
    const d = decode(motionAnswer.block);
    const nan = d.high.findIndex(Number.isNaN);
    assert.ok(nan >= 0);
    d.high[nan] = 0;
    assert.throws(() => motionEqual(d, wantMotion(), "NaN"), /high/);
  });

  it("bars: open and close are exact, a bar missing is found", () => {
    const a = decode(barsAnswer.bars);
    a.close[0] += 0.01;
    assert.throws(() => barsEqual(a, wantBars(), "close"), /close/);
    const b = decode(barsAnswer.bars);
    b.col.pop();
    assert.throws(() => barsEqual(b, wantBars(), "bars"), /columns that have bars/);
  });
});

// ---- jitter and advance ----

// A dense set: 2,000 trades in 20 minutes over a narrow band, about 50 trades per base cell, so that summing in another order moves bits.
function denseSet() {
  const next = mulberry32(subSeed(SEED, "dense"));
  const trades = [];
  let t = 0;
  let price = 2506250;
  for (let k = 0; k < 2000; k++) {
    t += int(next, 0, 1200);
    price = Math.min(2512000, Math.max(2500500, Math.round(price + normal(next, 0, 30))));
    trades.push({ t_ms: t, price, qty: int(next, 10000, 900000), takerBuy: next() < 0.5 });
  }
  const cutoffMs = Math.ceil((t + 1) / 60000) * 60000 + 60000;
  return { trades, gaps: [], cutoffIso: new Date(EPOCH + cutoffMs).toISOString().replace(".000Z", "Z") };
}

describe("jitter(seed): equivalent sums in another order", () => {
  let fake, set;
  before(async () => {
    set = denseSet();
    fake = await startFake({ profile: { ...set, name: "dense" } });
  });
  after(() => fake.close());

  it("changes only last bits: counts identical, every volume still within near() of the exact sum, and tails() still answers a delta", async () => {
    const before = fake.info();
    const top = Math.ceil(before.cutoffBase);
    const params = { n: 0, m: 0, b0: 0, b1: top };
    const oldToken = before.packToken;
    const one = decode((await ask(fake, "tile", params, oldToken)).block);
    const want = ref.cells(set.trades, params);
    cellsEqual(one, want, "before jitter");
    // the premise: cells hold many trades, so a different summation order can move a bit
    assert.ok(Math.max(...want.map((w) => w.ct)) > 20);

    fake.jitter(7);
    const after = fake.info();
    assert.notEqual(after.packToken, oldToken, "a new token");
    const two = decode((await ask(fake, "tile", params, after.packToken)).block);
    cellsEqual(two, want, "after jitter");
    assert.deepEqual(two.ct, one.ct, "counts identical");
    assert.deepEqual(two.bt, one.bt);
    assert.deepEqual(two.col, one.col);
    assert.deepEqual(two.row, one.row);
    let differing = 0;
    for (let i = 0; i < one.vol.length; i++) {
      assert.ok(near(one.vol[i], two.vol[i]));
      if (one.vol[i] !== two.vol[i] || one.tbvol[i] !== two.tbvol[i]) differing++;
    }
    assert.ok(differing > 0, "at least one cell's volume differs in its last bits, which is what makes the two reads equivalent rather than identical");

    // the bridge's tails() rule (rtol 1e-12) calls such a change unchanged data: the poll answers a delta, not a whole pack
    const poll = await (await fetch(`${fake.url}/cube/pack?since=${oldToken}&proto=2`)).json();
    assert.equal(poll.status, "delta");
    fake.jitter(null);
  });

  it("a cell of a single trade cannot change", async () => {
    const one = [{ t_ms: 5000, price: 2500000, qty: 400000, takerBuy: true }, { t_ms: 70000, price: 2512500, qty: 123457, takerBuy: false }];
    const f = await startFake({ profile: { trades: one, cutoffIso: "2021-01-01T00:03:00Z", name: "singles" } });
    try {
      const params = { n: 0, m: 0, b0: 0, b1: 4 };
      const a = decode((await ask(f, "tile", params, f.info().packToken)).block);
      f.jitter(99);
      const b = decode((await ask(f, "tile", params, f.info().packToken)).block);
      assert.deepEqual(b.vol, a.vol);
    } finally {
      await f.close();
    }
  });
});

describe("advance: new trades after the old cutoff are in the next token's reads and not in the old one's", () => {
  it("the open column gains trades; reads under the old token keep the state the page holds", async () => {
    const f = await startFake({ profile: "micro:mixed" });
    try {
      const fixture = JSON.parse(fs.readFileSync(path.join(TRADES_DIR, "mixed.json"), "utf8"));
      const oldToken = f.info().packToken;
      const extra = [
        { t_ms: 305000, price: 2500000, qty: 400000, takerBuy: true },
        { t_ms: 330000, price: 2525000, qty: 400000, takerBuy: false },
      ];
      f.advance({ toIso: "2021-01-01T00:06:00Z", trades: extra });
      const all = [...fixture.trades, ...extra];
      const token = f.info().packToken;
      const info = f.info();
      const top = Math.ceil(info.cutoffBase);
      const fresh = decode((await ask(f, "tile", { n: 0, m: 0, b0: 0, b1: top }, token)).block);
      cellsEqual(fresh, ref.cells(all, { n: 0, m: 0, b0: 0, b1: top }), "after advance");
      const held = decode((await ask(f, "tile", { n: 0, m: 0, b0: 0, b1: 6 }, oldToken)).block);
      cellsEqual(held, ref.cells(fixture.trades, { n: 0, m: 0, b0: 0, b1: 6 }), "old token");
    } finally {
      await f.close();
    }
  });
});
