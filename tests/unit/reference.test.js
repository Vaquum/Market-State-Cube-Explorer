"use strict";
// U06 reference.test.js (H3): the exact-rational reference calculator (tests/reference) against answers worked out by hand.
//
// Oracles, none of which is the code under test or the fake cube:
//   1. The `expected` block of every tests/fixtures/trades/<name>.json: cells, movement cells, bars, summaries and Rows
//      periods derived on paper from the trade list (the derivation is in the block's `notes`); this file only reads them.
//   2. Closed-form vectors typed in this file: IEEE rounding of a quotient (1/3, halves, subnormals), the Type-7 and rank
//      vectors of API.md A.3 (worked out by hand there and re-derived in the comments below), exposure fractions, the
//      sum of ten 0.1 USDT trades (1 exactly, where a float sum gives 0.9999999999999999).
//   3. The Python goldens (tests/fixtures/scales, indicators), which golden.py computes with `fractions` / `decimal`, are
//      read here only for structural hand checks (a textbook series a person can verify), never as the expectation of
//      another value computed by the same script; their byte-stability is `golden.py --check`.
// The calculator's own files import nothing from src/, tests/support/ or vendor/ (independence.test.js).
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ref = require("../reference/index.js");
const R = ref.rational;

const FIXTURES = path.join(__dirname, "..", "fixtures");
const TRADES = path.join(FIXTURES, "trades");
const names = fs.readdirSync(TRADES).filter((f) => f.endsWith(".json") && f !== "provenance.json").map((f) => f.slice(0, -5)).sort();
const load = (name) => JSON.parse(fs.readFileSync(path.join(TRADES, `${name}.json`), "utf8"));
// NaN travels as the string "NaN" in fixtures (JSON cannot carry it).
const unNaN = (x) => (x === "NaN" ? NaN : x);
const same = (a, b) => (Number.isNaN(a) ? Number.isNaN(b) : Object.is(a, b) || a === b);

// ---- the rational layer ----

describe("rational.js: exact arithmetic and one correct rounding", () => {
  it("ratioToDouble rounds once, to nearest, ties to even", () => {
    assert.equal(R.ratioToDouble(1n, 3n), 0.3333333333333333);
    assert.equal(R.ratioToDouble(2n, 3n), 0.6666666666666666);
    assert.equal(R.ratioToDouble(1n, 10n), 0.1);
    assert.equal(R.ratioToDouble(-7n, 2n), -3.5);
    assert.equal(R.ratioToDouble(7n, -2n), -3.5);
    assert.equal(R.ratioToDouble(0n, 5n), 0);
    // 2^53 + 1 is halfway between two doubles: ties to even goes DOWN to 2^53; 2^53 + 3 goes UP to 2^53 + 4.
    assert.equal(R.ratioToDouble(2n ** 53n + 1n, 1n), 2 ** 53);
    assert.equal(R.ratioToDouble(2n ** 53n + 3n, 1n), 2 ** 53 + 4);
    // Subnormals: the quantum is 2^-1074; 1.5 quanta ties to even (2 quanta), 0.5 quantum ties to 0.
    assert.equal(R.ratioToDouble(1n, 2n ** 1074n), 5e-324);
    assert.equal(R.ratioToDouble(3n, 2n ** 1075n), 1e-323);
    assert.equal(R.ratioToDouble(1n, 2n ** 1075n), 0);
    assert.equal(R.ratioToDouble(2n ** 1024n, 1n), Infinity);
  });

  it("agrees with IEEE division wherever both operands are exact doubles (seeded sweep)", () => {
    let seed = 12345;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296; // a local LCG: the sweep's inputs, never an expectation
    for (let i = 0; i < 5000; i++) {
      const a = BigInt(Math.floor(next() * 2 ** 40)) + 1n;
      const b = BigInt(Math.floor(next() * 2 ** 40)) + 1n;
      assert.equal(R.ratioToDouble(a, b), Number(a) / Number(b), `${a}/${b}`);
    }
  });

  it("fromDouble is exact: every finite double is a dyadic rational that converts back to itself", () => {
    for (const x of [0.1, 1 / 3, 5e-324, 1.7976931348623157e308, -2.5, 123456.789, 2 ** -1022, 3 * 2 ** -1060, 0, -0.75]) {
      assert.equal(R.toDouble(R.fromDouble(x)), x);
    }
    assert.deepEqual(R.fromDouble(0.75), { n: 3n, d: 4n });
    // 0.1 is not one tenth: the double is slightly above it, and the rational says by how much.
    assert.ok(R.cmp(R.fromDouble(0.1), R.q(1, 10)) > 0);
    assert.throws(() => R.fromDouble(NaN), RangeError);
    assert.throws(() => R.fromDouble(Infinity), RangeError);
  });

  it("parse, floor and the field operations", () => {
    assert.deepEqual(R.parse("-12.375"), { n: -99n, d: 8n });
    assert.deepEqual(R.parse("1e-3"), { n: 1n, d: 1000n });
    assert.deepEqual(R.parse("3/8"), { n: 3n, d: 8n });
    assert.equal(R.floor(R.q(7, 2)), 3n);
    assert.equal(R.floor(R.q(-7, 2)), -4n, "floor is toward minus infinity");
    assert.equal(R.floor(R.q(-4, 2)), -2n);
    assert.deepEqual(R.add(R.q(1, 3), R.q(1, 6)), { n: 1n, d: 2n });
    assert.deepEqual(R.mul(R.q(2, 3), R.q(3, 4)), { n: 1n, d: 2n });
    assert.deepEqual(R.div(R.q(1, 2), R.q(1, 4)), { n: 2n, d: 1n });
    assert.throws(() => R.div(R.ONE, R.ZERO), RangeError);
    assert.throws(() => R.parse("abc"), RangeError);
  });
});

// ---- exactness of sums ----

describe("exact sums: what floating point loses, the reference keeps", () => {
  it("ten trades of exactly 0.1 USDT sum to 1 (a float sum gives 0.9999999999999999)", () => {
    // price 2,500,000 cents x qty 400 (= 4e-6 BTC) / 1e10 = 0.1 USDT each.
    const trades = Array.from({ length: 10 }, (_, i) => ({ t_ms: i, price: 2500000, qty: 400, takerBuy: i % 2 === 0 }));
    let naive = 0;
    for (let i = 0; i < 10; i++) naive += (2500000 * 400) / 1e10;
    assert.notEqual(naive, 1, "the premise: floating-point summation drifts here");
    const [cell] = ref.cells(trades, { n: 0, m: 0, b0: 0, b1: 1 });
    assert.equal(cell.v, 1);
    assert.equal(cell.bv, 0.5);
    assert.equal(cell.exact.v, "1");
    assert.equal(cell.ct, 10);
    assert.equal(cell.bt, 5);
  });

  it("a balanced cell has exactly zero Delta however ugly the notional", () => {
    // 3 trades of 33.333... USDT each way: buy 1/3 of a coin at 100,000.01 is not representable, the exact difference still cancels.
    const trades = [
      { t_ms: 0, price: 1234567, qty: 98765431, takerBuy: true },
      { t_ms: 1, price: 1234567, qty: 98765431, takerBuy: false },
    ];
    const [cell] = ref.cells(trades, { n: 0, m: 0, b0: 0, b1: 1 });
    const delta = R.sub(R.mul(R.q(2), R.parse(cell.exact.bv)), R.parse(cell.exact.v));
    assert.deepEqual(delta, R.ZERO);
    assert.equal(cell.ct, 2);
  });

  it("rows, columns and levels: indices are integer floors of the raw quantities", () => {
    const trades = [
      { t_ms: 56249, price: 12499, qty: 1, takerBuy: true }, // col 0, row 0 (12,499 cents < 12,500)
      { t_ms: 56250, price: 12500, qty: 1, takerBuy: true }, // col 1, row 1
      { t_ms: 225000, price: 25000, qty: 1, takerBuy: true }, // col 4, row 2
    ];
    assert.deepEqual(ref.cells(trades, { n: 0, m: 0, b0: 0, b1: 5 }).map((x) => [x.c, x.r]), [[0, 0], [1, 1], [4, 2]]);
    assert.deepEqual(ref.cells(trades, { n: 2, m: 1, b0: 0, b1: 5 }).map((x) => [x.c, x.r]), [[0, 0], [1, 1]]); // cols 0, 1 -> 0 and col 4 -> 1; rows 0, 1 -> 0 and row 2 -> 1: the first two trades share a cell
    // the rectangle takes whole base columns [b0, b1) and, with r0/r1, base rows [r0, r1)
    assert.deepEqual(ref.cells(trades, { n: 0, m: 0, b0: 1, b1: 4 }).map((x) => [x.c, x.r]), [[1, 1]]);
    assert.deepEqual(ref.cells(trades, { n: 0, m: 0, b0: 0, b1: 5, r0: 1, r1: 2 }).map((x) => [x.c, x.r]), [[1, 1]]);
    assert.throws(() => ref.cells([{ t_ms: 5, price: 1, qty: 1, takerBuy: true }, { t_ms: 4, price: 1, qty: 1, takerBuy: true }], { n: 0, m: 0, b0: 0, b1: 1 }), /before the previous trade/);
    assert.throws(() => ref.cells([{ t_ms: 0.5, price: 1, qty: 1, takerBuy: true }], { n: 0, m: 0, b0: 0, b1: 1 }), /integer/);
  });
});

// ---- the hand-computed micro-sequences ----

describe("tests/fixtures/trades/*.json: the fixture files themselves", () => {
  it("there are micro-sequences for the profile names of TESTPLAN 4.4 (mixed, balanced, relvol, nonvalues, paths, gaps, bars)", () => {
    for (const name of ["mixed", "balanced", "relvol", "nonvalues", "paths", "gaps", "bars"]) assert.ok(names.includes(name), name);
  });

  for (const name of names) {
    it(`${name}: DR-45 shape, integers, time order, nothing after the cutoff, 2-40 trades`, () => {
      const f = load(name);
      assert.deepEqual(Object.keys(f).filter((k) => !["trades", "gaps", "cutoffIso", "canonicalThroughIso", "seed", "expected"].includes(k)), [], "only the keys of the shape");
      assert.ok(Array.isArray(f.trades) && f.trades.length >= 2 && f.trades.length <= 40, `${f.trades.length} trades`);
      assert.ok(Array.isArray(f.gaps));
      const epoch = Date.parse("2021-01-01T00:00:00Z");
      const cutMs = Date.parse(f.cutoffIso) - epoch;
      assert.ok(Number.isFinite(cutMs) && cutMs % 60000 === 0, "the cutoff is a minute edge");
      let last = -1;
      for (const t of f.trades) {
        assert.deepEqual(Object.keys(t).filter((k) => !["t_ms", "price", "qty", "takerBuy", "count"].includes(k)), []);
        for (const k of ["t_ms", "price", "qty"]) assert.ok(Number.isInteger(t[k]) && t[k] >= 0, `${k} ${t[k]}`);
        assert.equal(typeof t.takerBuy, "boolean");
        if (t.count !== undefined) assert.ok(Number.isInteger(t.count) && t.count >= 1);
        assert.ok(t.t_ms >= last, "time order");
        assert.ok(t.t_ms <= cutMs, "no trade after the cutoff");
        last = t.t_ms;
      }
      for (const [a, z] of f.gaps) assert.ok(Number.isInteger(a) && Number.isInteger(z) && z > a);
      assert.equal(f.expected.rect.cutMs, cutMs, "expected.rect.cutMs is the cutoff in ms since the epoch");
    });
  }
});

describe("reference calculator == hand-computed expectations", () => {
  for (const name of names) {
    const f = load(name);
    const e = f.expected;
    const rect = (extra) => ({ b0: e.rect.b0, b1: e.rect.cellsB1, r0: null, r1: null, ...extra });

    for (const [level, want] of Object.entries(e.cells ?? {})) {
      it(`${name}: cells at level ${level}`, () => {
        const [n, m] = level.split(":").map(Number);
        const got = ref.cells(f.trades, rect({ n, m }));
        assert.deepEqual(got.map((x) => [x.c, x.r]), want.map((x) => [x.c, x.r]), "the set and order of cells");
        got.forEach((x, i) => {
          const w = want[i];
          assert.deepEqual({ v: x.v, bv: x.bv, ct: x.ct, bt: x.bt }, { v: w.v, bv: w.bv, ct: w.ct, bt: w.bt }, `cell ${x.c},${x.r}`);
          // Delta = 2 bv - v, from the EXACT sums
          const delta = R.toDouble(R.sub(R.mul(R.q(2), R.parse(x.exact.bv)), R.parse(x.exact.v)));
          assert.equal(delta, w.d, `Delta of cell ${x.c},${x.r}`);
        });
      });
    }

    for (const [level, want] of Object.entries(e.motion ?? {})) {
      it(`${name}: movement cells at level ${level}`, () => {
        const [n, m] = level.split(":").map(Number);
        const got = ref.motion(f.trades, { n, m, b0: e.rect.b0, b1: e.rect.motionB1, end: e.rect.cutMs, gaps: f.gaps });
        assert.deepEqual(got.map((x) => [x.c, x.r]), want.map((x) => [x.c, x.r]), "the set and order of cells");
        got.forEach((x, i) => {
          const w = want[i];
          for (const k of ["p", "w", "hi", "lo", "v", "bv", "ct", "bt"]) assert.ok(same(x[k], unNaN(w[k])), `cell ${x.c},${x.r} ${k}: ${x[k]} vs ${w[k]}`);
        });
      });
    }

    for (const [nText, want] of Object.entries(e.bars ?? {})) {
      it(`${name}: bars at level ${nText}`, () => {
        const got = ref.bars(f.trades, { n: Number(nText), b0: e.rect.b0, b1: e.rect.motionB1 });
        assert.deepEqual(got, want);
      });
    }

    (e.summary ?? []).forEach((want, i) => {
      it(`${name}: summary ${i} over [${want.rect.b0}, ${want.rect.b1}) at m=${want.rect.m}`, () => {
        const { rect: r, ...fields } = want;
        const got = ref.summary(f.trades, { n: 0, m: r.m, b0: r.b0, b1: r.b1 });
        const { cells, ...rest } = got;
        assert.deepEqual(rest, fields);
      });
    });

    (e.periodRows ?? []).forEach((want) => {
      it(`${name}: period rows over [${want.b0}, ${want.b1}) at m=${want.m}`, () => {
        assert.deepEqual(ref.periodRows(f.trades, { b0: want.b0, b1: want.b1, m: want.m }), want.rows);
      });
    });

    if (e.columnDwell) {
      it(`${name}: covered dwell per column is the sum over its rows (unattributed time is the rest)`, () => {
        const got = ref.motion(f.trades, { n: 0, m: 0, b0: e.rect.b0, b1: e.rect.motionB1, end: e.rect.cutMs, gaps: f.gaps });
        const per = new Map();
        for (const x of got) per.set(x.c, (per.get(x.c) ?? 0) + x.w);
        assert.deepEqual(Object.fromEntries([...per].map(([c, w]) => [c, w])), e.columnDwell);
        for (const w of per.values()) assert.ok(w <= 56.25);
      });
    }
  }
});

// ---- the stated cases of TESTPLAN U06, each pinned by a named fixture ----

describe("the cases of TESTPLAN U06", () => {
  it("balanced traded Delta: two 100 USDT trades in one cell, one buy one sell: volume 200, buy 100, Delta 0, count 2", () => {
    const f = load("balanced");
    const [cell] = ref.cells(f.trades, { n: 0, m: 0, b0: 0, b1: 3 });
    assert.deepEqual({ v: cell.v, bv: cell.bv, ct: cell.ct, bt: cell.bt, c: cell.c, r: cell.r }, { v: 200, bv: 100, ct: 2, bt: 1, c: 0, r: 200 });
    assert.equal(2 * cell.bv - cell.v, 0);
  });

  it("a single-trade cell has path 0 and dwell equal to the hold time; the first trade of a dataset never has a path", () => {
    const one = [{ t_ms: 10000, price: 2500000, qty: 400000, takerBuy: true }];
    const [cell] = ref.motion(one, { n: 0, m: 0, b0: 0, b1: 1, end: 30000 });
    // the price holds from 10 s to the data end at 30 s, inside column 0 (0 - 56.25 s): 20 s
    assert.deepEqual({ p: cell.p, w: cell.w, ct: cell.ct }, { p: 0, w: 20, ct: 1 });
  });

  it("a jump crossing k rows is split in proportion to the length inside each row, and belongs to the later trade's column", () => {
    const f = load("paths");
    const cells = ref.motion(f.trades, { n: 0, m: 0, b0: 0, b1: 6, end: f.expected.rect.cutMs });
    const at = (c, r) => cells.find((x) => x.c === c && x.r === r);
    // trade 4's 500 USDT move down from 25,312.50 to 24,812.50: 62.5 + 3 x 125 + 62.5 in col 2
    assert.deepEqual([198, 199, 200, 201, 202].map((r) => at(2, r).p), [62.5, 125, 125, 125, 62.5]);
    assert.equal(cells.filter((x) => x.c === 2).reduce((s, x) => s + x.p, 0), 500);
    // conservation: 250 + 500 + 125 USDT travelled, all of it booked to some cell
    assert.equal(cells.reduce((s, x) => s + x.p, 0), 875);
  });

  it("a gap is unattributed dwell, not reassigned", () => {
    const f = load("gaps");
    const withGaps = ref.motion(f.trades, { n: 0, m: 0, b0: 0, b1: 6, end: f.expected.rect.cutMs, gaps: f.gaps });
    const without = ref.motion(f.trades, { n: 0, m: 0, b0: 0, b1: 6, end: f.expected.rect.cutMs });
    const total = (cells) => cells.reduce((s, x) => s + x.w, 0);
    assert.equal(total(without) - total(withGaps), 85); // 60 s + 25 s of gap inside trade 1's hold
    assert.equal(total(without), 327.5); // 10 s -> 337.5 s: nothing is held before the first trade
  });

  it("a cell the price only passed through has no trades: zero volume and count, NaN high and low", () => {
    const f = load("nonvalues");
    const cells = ref.motion(f.trades, { n: 0, m: 0, b0: 0, b1: 6, end: f.expected.rect.cutMs });
    const only = cells.filter((x) => x.ct === 0);
    assert.equal(only.length, 6);
    for (const x of only) {
      assert.ok(Number.isNaN(x.hi) && Number.isNaN(x.lo));
      assert.deepEqual([x.v, x.bv, x.bt], [0, 0, 0]);
      assert.ok(x.p > 0 || x.w > 0, "it exists because movement or dwell reached it");
    }
  });

  it("first and last trade across a column boundary: the last millisecond of a column and the first of the next", () => {
    const f = load("boundary");
    const cells = ref.cells(f.trades, { n: 0, m: 0, b0: 0, b1: 4 });
    assert.deepEqual(cells.map((x) => [x.c, x.r]), [[0, 200], [1, 200], [1, 201], [2, 201], [3, 203]]);
    const bars = ref.bars(f.trades, { n: 2, b0: 0, b1: 3 });
    assert.equal(bars.length, 1);
    assert.equal(bars[0].trades, 4, "the open column 3 (trade 5) is outside a read that stops at floor(cutoff)");
    const withOpen = ref.bars(f.trades, { n: 2, b0: 0, b1: 4 });
    assert.equal(withOpen[0].trades, 5);
  });

  it("the open column: a fractional cutoff leaves a column observed only up to the cutoff (exposure, exactly)", () => {
    // cutoff 2021-01-01T00:02:00Z = 120 s = base 2.1333...; column 2 is observed 0.1333 x 56.25 = 7.5 s
    const cut = 120000;
    const open = ref.exposure({ c: 2, r: 0 }, { b0: 0, b1: 1000, r0: null, r1: null }, cut, 0, 0);
    assert.deepEqual(open, { seconds: 7.5, width: 125, timeFraction: 7.5 / 56.25, widthFraction: 1, whole: false });
    assert.equal(ref.exposure({ c: 1, r: 0 }, { b0: 0, b1: 1000, r0: null, r1: null }, cut, 0, 0).whole, true);
  });

  it("POC ties go to the lower row, for volume and for taker-buy volume", () => {
    const f = load("ties");
    const s = ref.summary(f.trades, { n: 0, m: 0, b0: 0, b1: 1 });
    assert.equal(s.volume, 252);
    assert.equal(s.pocRow, 200);
    assert.equal(s.takerBuyPocRow, 200);
    // the same rows compared by the exact sums: equal
    const rows = ref.periodRows(f.trades, { b0: 0, b1: 1, m: 0 });
    assert.equal(rows[0].v, rows[1].v);
    assert.equal(rows[0].bv, rows[1].bv);
  });

  it("OHLC by trade id: same-millisecond trades keep their printing order, open is the first and close the last printed", () => {
    const f = load("bars");
    const bars = ref.bars(f.trades, { n: 2, b0: 0, b1: 21 });
    assert.deepEqual(bars.map((b) => b.col), [0, 1, 3, 5], "columns without trades have no bar");
    assert.equal(bars[0].open, 25000, "trade 1 before trade 2 at the same millisecond");
    assert.equal(bars[0].close, 25125, "trade 4 at 224,999 ms is the last of bar 0");
    assert.equal(bars[2].close, 24875, "of two trades at 800,000 ms the later printed closes");
    // reversing the two same-millisecond trades reverses which one closes: the order is the id
    const swapped = f.trades.slice();
    [swapped[7], swapped[8]] = [swapped[8], swapped[7]];
    assert.equal(ref.bars(swapped, { n: 2, b0: 0, b1: 21 })[2].close, 25125);
  });

  it("relative-volume inputs: rows the period traded and the rectangle did not, and the reverse", () => {
    const f = load("relvol");
    const period = ref.periodRows(f.trades, { b0: 0, b1: 4, m: 0 }).map((x) => x.r);
    const current = ref.periodRows(f.trades, { b0: 4, b1: 6, m: 0 }).map((x) => x.r);
    assert.deepEqual(period.filter((r) => !current.includes(r)), [202, 203]);
    assert.deepEqual(current.filter((r) => !period.includes(r)), [204]);
  });
});

// ---- exposure ----

describe("exposure: nominal fractions in exact arithmetic (U13 vectors)", () => {
  const full = { b0: 0, b1: 1e7, r0: null, r1: null };
  it("a whole cell covers both nominal fractions", () => {
    const x = ref.exposure({ c: 3, r: 5 }, full, 1e12, 4, 1);
    assert.deepEqual(x, { seconds: 900, width: 250, timeFraction: 1, widthFraction: 1, whole: true });
  });

  it("a viewport-cut cell: the rectangle's edge takes part of the time, a price bound part of the width", () => {
    // level 4: columns of 16 base columns. rect starts at base 2: cell col 0 is covered (16 - 2) x 56.25 = 787.5 s = 0.875
    const a = ref.exposure({ c: 0, r: 0 }, { b0: 2, b1: 100, r0: null, r1: null }, 1e12, 4, 0);
    assert.equal(a.seconds, 787.5);
    assert.equal(a.timeFraction, 0.875);
    assert.equal(a.whole, false);
    // level m = 1 is 250 USDT = 2 base rows; a price range covering base row 0 only is half: 125 of 250 = 0.5
    const b = ref.exposure({ c: 0, r: 0 }, { b0: 0, b1: 100, r0: 0, r1: 1 }, 1e12, 0, 1);
    assert.deepEqual([b.width, b.widthFraction], [125, 0.5]);
  });

  it("Short exposure thresholds are exact: 89.99 s of 900 is below 10%, 90 s is not", () => {
    // base 0.. : cell at level 4, rect ends at base 1.6 (90 s = 1.6 base columns): fraction exactly 0.1
    const edge = ref.exposure({ c: 0, r: 0 }, { b0: 0, b1: R.q(8, 5), r0: null, r1: null }, 1e12, 4, 0);
    assert.equal(edge.seconds, 90, "the rectangle bound is fractional: a bound may sit inside a column");
    assert.equal(edge.timeFraction, 0.1);
    const below = ref.exposure({ c: 0, r: 0 }, { b0: 0, b1: R.q(159, 100), r0: null, r1: null }, 1e12, 4, 0);
    assert.equal(below.seconds, 89.4375);
    assert.ok(below.timeFraction < 0.1);
  });

  it("the cutoff cuts the cell like a rectangle edge (the open column)", () => {
    // 2026-09-24T12:02:00Z: base 3214082.1333...: the open column 3214082 is observed for 7.5 s at level 0, 0.1333 x 56.25 s
    const cutMs = Date.parse("2026-09-24T12:02:00Z") - Date.parse("2021-01-01T00:00:00Z");
    const x = ref.exposure({ c: 3214082, r: 600 }, full, cutMs, 0, 0);
    assert.equal(x.seconds, 7.5);
    const parent = ref.exposure({ c: 3214082 >> 4, r: 600 }, full, cutMs, 4, 0);
    assert.equal(parent.seconds, 120, "level 4, column 200,880 starts at base 3,214,080: two whole base columns (112.5 s) plus the 7.5 s of the open one");
  });

  it("zero or negative coverage is zero, never negative", () => {
    const x = ref.exposure({ c: 10, r: 0 }, { b0: 0, b1: 5, r0: null, r1: null }, 1e12, 0, 0);
    assert.deepEqual([x.seconds, x.timeFraction, x.whole], [0, 0, false]);
  });
});

// ---- Type 7 and the rank mapping ----

describe("typeseven.js: Type-7 quantiles and the 257-knot rank in exact arithmetic", () => {
  it("quantile vectors worked out by hand", () => {
    assert.equal(ref.typeSeven([1, 2, 3, 4], R.q(1, 2)), 2.5, "h = 1.5: 2 + 0.5 (3 - 2)");
    assert.equal(ref.typeSeven([1, 2, 3, 4, 100], R.q(1, 2)), 3, "h = 2");
    assert.equal(ref.typeSeven([10, 20], R.q(1, 4)), 12.5, "h = 0.25");
    assert.equal(ref.typeSeven([5], R.q(3, 4)), 5);
    assert.equal(ref.typeSeven([1, 2, 3], R.ONE), 3);
    assert.equal(ref.typeSeven([1, 2, 3], R.ZERO), 1);
    assert.equal(ref.median7([5, 1, 3, 2]), 2.5);
    assert.throws(() => ref.typeSeven([], R.q(1, 2)), RangeError);
    assert.throws(() => ref.typeSeven([2, 1], R.q(1, 2)), RangeError, "a sample must be sorted");
  });

  it("the interpolation is rounded once from the exact rational (a float s[lo] + f (s[lo+1] - s[lo]) can be off by a bit)", () => {
    // 0.1 and 0.3 (as doubles) at p = 1/3 (N = 2, h = 1/3): exact = a + (b - a) / 3
    const exact = ref.typeSevenExact([0.1, 0.3], R.q(1, 3));
    const a = R.fromDouble(0.1);
    const b = R.fromDouble(0.3);
    assert.deepEqual(exact, R.add(a, R.div(R.sub(b, a), R.q(3))));
    assert.equal(ref.typeSeven([0.1, 0.3], R.q(1, 3)), R.toDouble(exact));
  });

  it("knots of [1,1,1,2,3,5,5,8,13,21] (API.md A.3): 1 up to j = 56, then 20.4375, 20.71875, 21 at the top", () => {
    const k = ref.knots257([1, 1, 1, 2, 3, 5, 5, 8, 13, 21]);
    assert.equal(k.length, 257);
    for (let j = 0; j <= 56; j++) assert.equal(k[j], 1, `knot ${j}`);
    assert.ok(k[57] > 1);
    assert.deepEqual(k.slice(254), [20.4375, 20.71875, 21]);
    // h = 9 j / 256 for j = 254: 8.929 -> 13 + 0.9296875 (21 - 13) = 20.4375 ✓.
    for (let j = 1; j <= 256; j++) assert.ok(k[j] >= k[j - 1]);
  });

  it("rank mapping vectors of API.md A.3 (repeated value: midpoint of first and last q; between groups: interpolated)", () => {
    const k = ref.knots257([1, 1, 1, 2, 3, 5, 5, 8, 13, 21]);
    assert.deepEqual(ref.rankApply(k, 0.5), { t: 0, clip: "low" });
    assert.deepEqual(ref.rankApply(k, 1), { t: 0.109375, clip: "none" }); // knots 0..56 equal 1: (0 + 56) / 512
    assert.deepEqual(ref.rankApply(k, 2), { t: 1 / 3, clip: "none" }); // between knots 85 (1.98828125) and 86 (2.0234375): 85 + 1/3 of a step
    assert.equal(ref.rankApply(k, 1.5).t, 0.2777777777777778);
    assert.deepEqual(ref.rankApply(k, 4), { t: 0.5, clip: "none" });
    assert.deepEqual(ref.rankApply(k, 5), { t: 0.611328125, clip: "none" });
    assert.equal(ref.rankApply(k, 6).t, 0.7037037037037037);
    assert.deepEqual(ref.rankApply(k, 21), { t: 1, clip: "none" }, "the exactly repeated top value: its group is one knot, the midpoint is 256/256");
    assert.deepEqual(ref.rankApply(k, 30), { t: 1, clip: "high" });
  });

  it("an all-equal cohort maps its value to 0.5 and everything else to an endpoint with an indication", () => {
    const k = ref.knots257([7, 7, 7]);
    assert.ok(k.every((x) => x === 7));
    assert.deepEqual(ref.rankApply(k, 7), { t: 0.5, clip: "none" });
    assert.deepEqual(ref.rankApply(k, 6), { t: 0, clip: "low" });
    assert.deepEqual(ref.rankApply(k, 8), { t: 1, clip: "high" });
  });

  it("a two-group cohort (129 fives then 128 nines, N = 257): 5 -> 0.25, 7 -> 0.501953125, 9 -> 0.751953125", () => {
    const values = [...Array(129).fill(5), ...Array(128).fill(9)];
    const k = ref.knots257(values);
    assert.equal(k[128], 5);
    assert.equal(k[129], 9);
    assert.equal(ref.rankApply(k, 5).t, 0.25, "midpoint of q 0 and q 128/256");
    assert.equal(ref.rankApply(k, 7).t, 0.501953125, "from the lower group's last q (128/256) to the upper group's first (129/256): half way");
    assert.equal(ref.rankApply(k, 9).t, 0.751953125, "midpoint of q 129/256 and 256/256");
    assert.deepEqual(ref.rankApply(k, 4.999), { t: 0, clip: "low" });
    assert.deepEqual(ref.rankApply(k, 9.001), { t: 1, clip: "high" });
  });
});

// ---- the Python goldens, checked by a second implementation in another language ----
//
// golden.py (fractions, decimal) wrote tests/fixtures/scales and tests/fixtures/indicators. Here every indicator series is recomputed
// in exact rationals in JavaScript, written separately from the Python, the rank knots and mappings by tests/reference/typeseven.js, and
// the Value transform by double-precision Math.log1p against the 80-digit decimal values: two languages, two algorithms, one number.
// Agreement is exact where both sides round an exact rational once (indicators, rank), and within 1e-14 relative where one side is IEEE
// log1p (Value). The hand vectors quoted from TESTPLAN U15/U16 and API.md A.3 pin the files to the documents.
const golden = (rel) => JSON.parse(fs.readFileSync(path.join(FIXTURES, rel), "utf8"));
const fromText = (x) => (x === "NaN" ? NaN : x);
const floats = (list) => list.map(fromText);

// exact JavaScript versions of the five indicators (rationals in, correctly rounded doubles out)
const Q = R.q;
const sumQ = (xs) => xs.reduce(R.add, R.ZERO);
const asQ = (x) => R.fromDouble(x);
const out = (list) => list.map((x) => (x === null ? NaN : R.toDouble(x)));
function smaQ(closes, n) {
  const c = closes.map(asQ);
  return c.map((_, i) => (i < n - 1 ? null : R.div(sumQ(c.slice(i - n + 1, i + 1)), Q(n))));
}
function emaQ(values, n, from = 0) {
  const res = values.map(() => null);
  if (values.length - from < n) return res;
  const alpha = Q(2, n + 1);
  let e = R.div(sumQ(values.slice(from, from + n)), Q(n));
  res[from + n - 1] = e;
  for (let i = from + n; i < values.length; i++) {
    e = R.add(R.mul(alpha, values[i]), R.mul(R.sub(R.ONE, alpha), e));
    res[i] = e;
  }
  return res;
}
function rsiQ(closes, n) {
  const c = closes.map(asQ);
  const res = c.map(() => null);
  if (c.length <= n) return res;
  let up = R.ZERO;
  let down = R.ZERO;
  for (let i = 1; i <= n; i++) {
    const d = R.sub(c[i], c[i - 1]);
    if (R.sign(d) > 0) up = R.add(up, d);
    else down = R.sub(down, d);
  }
  up = R.div(up, Q(n));
  down = R.div(down, Q(n));
  const value = () => (R.sign(down) === 0 ? Q(100) : R.sign(up) === 0 ? R.ZERO : R.sub(Q(100), R.div(Q(100), R.add(R.ONE, R.div(up, down)))));
  res[n] = value();
  for (let i = n + 1; i < c.length; i++) {
    const d = R.sub(c[i], c[i - 1]);
    up = R.div(R.add(R.mul(Q(n - 1), up), R.sign(d) > 0 ? d : R.ZERO), Q(n));
    down = R.div(R.add(R.mul(Q(n - 1), down), R.sign(d) < 0 ? R.neg(d) : R.ZERO), Q(n));
    res[i] = value();
  }
  return res;
}
function macdQ(closes) {
  const c = closes.map(asQ);
  const fast = emaQ(c, 12);
  const slow = emaQ(c, 26);
  const line = c.map((_, i) => (i < 25 ? null : R.sub(fast[i], slow[i])));
  const signal = emaQ(line.map((x) => x ?? R.ZERO), 9, 25);
  const hist = c.map((_, i) => (line[i] === null || signal[i] === null ? null : R.sub(line[i], signal[i])));
  return { line, signal, hist };
}
// floor(sqrt(n)) for a BigInt n by Newton's iteration
function isqrt(n) {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
function bollingerQ(closes, n, k) {
  const c = closes.map(asQ);
  const res = { mid: [], upper: [], lower: [], width: [] };
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) {
      for (const key of Object.keys(res)) res[key].push(null);
      continue;
    }
    const window = c.slice(i - n + 1, i + 1);
    const m = R.div(sumQ(window), Q(n));
    const variance = R.div(sumQ(window.map((x) => R.mul(R.sub(x, m), R.sub(x, m)))), Q(n));
    // sd = sqrt(p / q) to 45 decimal places: floor(sqrt(p q 10^90)) / (q 10^45)
    const scale = 10n ** 45n;
    const sd = variance.n === 0n ? R.ZERO : Q(isqrt(variance.n * variance.d * scale * scale), variance.d * scale);
    const up = R.add(m, R.mul(Q(k), sd));
    const low = R.sub(m, R.mul(Q(k), sd));
    res.mid.push(m);
    res.upper.push(up);
    res.lower.push(low);
    res.width.push(R.div(R.sub(up, low), m));
  }
  return res;
}
const exactly = (got, want, label) => {
  assert.equal(got.length, want.length, `${label}: length`);
  got.forEach((x, i) => assert.ok(same(x, fromText(want[i])), `${label}[${i}]: ${x} vs ${want[i]}`));
};

describe("Python goldens: indicators, recomputed in exact rationals in JavaScript", () => {
  const files = { sma: golden("indicators/sma.json"), ema: golden("indicators/ema.json"), rsi: golden("indicators/rsi.json"), macd: golden("indicators/macd.json"), bollinger: golden("indicators/bollinger.json") };

  it("the five files cover the same seven close series, each a list of exact quarter-tick doubles", () => {
    const names = files.sma.cases.map((c) => c.name);
    assert.deepEqual(names, ["walk120", "walk300", "flat60", "rising40", "falling40", "ramp10", "sawtooth50"]);
    for (const file of Object.values(files)) assert.deepEqual(file.cases.map((c) => c.name), names);
    for (const c of files.sma.cases) for (const x of c.closes) assert.ok(Number.isInteger(x * 4) && x > 0, `${c.name}: ${x}`);
  });

  it("SMA(n): the golden equals the exact mean of the window (bit for bit)", () => {
    for (const c of files.sma.cases) for (const run of c.runs) exactly(out(smaQ(c.closes, run.n)), run.expected, `sma ${c.name} n=${run.n}`);
  });

  it("EMA(n, from): alpha = 2/(n+1), seeded with the SMA of the first n values from `from`", () => {
    for (const c of files.ema.cases) for (const run of c.runs) exactly(out(emaQ(c.closes.map(asQ), run.n, run.from)), run.expected, `ema ${c.name} n=${run.n} from=${run.from}`);
  });

  it("RSI(n): Wilder smoothing, first value at index n, 100 when the average loss is 0", () => {
    for (const c of files.rsi.cases) for (const run of c.runs) exactly(out(rsiQ(c.closes, run.n)), run.expected, `rsi ${c.name} n=${run.n}`);
  });

  it("MACD: EMA12 - EMA26 from index 25, signal EMA9 seeded at index 25, histogram their difference", () => {
    for (const c of files.macd.cases) {
      const m = macdQ(c.closes);
      exactly(out(m.line), c.macd, `macd ${c.name}`);
      exactly(out(m.signal), c.signal, `signal ${c.name}`);
      exactly(out(m.hist), c.hist, `hist ${c.name}`);
    }
  });

  it("Bollinger(n, k): mean +- k population standard deviations, width = (upper - lower)/mean (root to 45 places against 60 in Python)", () => {
    for (const c of files.bollinger.cases) {
      for (const run of c.runs) {
        const b = bollingerQ(c.closes, run.n, run.k);
        for (const key of ["mid", "upper", "lower", "width"]) exactly(out(b[key]), run[key], `bollinger ${c.name} n=${run.n} ${key}`);
      }
    }
  });

  it("hand-checkable entries: ramp, flat, rising and falling series", () => {
    const at = (file, name) => file.cases.find((c) => c.name === name);
    // SMA(3) of 1..10 is 2, 3, ..., 9 from index 2
    assert.deepEqual(floats(at(files.sma, "ramp10").runs[0].expected), [NaN, NaN, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => x));
    // EMA(3) of 1..10: seed SMA(1,2,3) = 2 at index 2, alpha 1/2: 3, 4, ... i.e. the value minus one
    assert.deepEqual(floats(at(files.ema, "ramp10").runs[0].expected), [NaN, NaN, 2, 3, 4, 5, 6, 7, 8, 9]);
    // flat series: RSI is 100 by the zero-loss rule, Bollinger has zero width, MACD and its histogram are 0
    assert.ok(floats(at(files.rsi, "flat60").runs[0].expected).slice(14).every((x) => x === 100));
    assert.ok(floats(at(files.bollinger, "flat60").runs[0].width).slice(19).every((x) => x === 0));
    const flat = at(files.macd, "flat60");
    assert.ok(floats(flat.macd).slice(25).every((x) => x === 0) && floats(flat.hist).slice(33).every((x) => x === 0));
    // strictly rising: no losses, RSI 100; strictly falling: no gains, RSI 0
    assert.ok(floats(at(files.rsi, "rising40").runs[0].expected).slice(14).every((x) => x === 100));
    assert.ok(floats(at(files.rsi, "falling40").runs[0].expected).slice(14).every((x) => x === 0));
    // Bollinger(5, 2) of 1..5 in the last window: mean 3, variance 2, sd sqrt 2 = 1.4142135623730951
    const b = at(files.bollinger, "ramp10").runs.find((r) => r.n === 5);
    assert.equal(fromText(b.mid[4]), 3);
    assert.equal(b.upper[4], 3 + 2 * 1.4142135623730951);
    assert.ok(Math.abs(b.width[4] - (4 * 1.4142135623730951) / 3) < 1e-15);
    // warm-up: the first value index of each indicator
    assert.equal(floats(at(files.rsi, "walk120").runs[0].expected).findIndex((x) => !Number.isNaN(x)), 14);
    assert.equal(floats(at(files.macd, "walk120").signal).findIndex((x) => !Number.isNaN(x)), 33);
    assert.equal(floats(at(files.macd, "walk120").macd).findIndex((x) => !Number.isNaN(x)), 25);
  });
});

describe("Python goldens: Value transform", () => {
  const file = golden("scales/value-vectors.json");
  const byName = Object.fromEntries(file.cases.map((c) => [c.name, c]));

  it("U and k are the maximum magnitude and the Type-7 median of the nonzero magnitudes (recomputed in exact JavaScript)", () => {
    for (const c of file.cases) {
      const mags = c.cohort.filter((x) => x !== 0).map(Math.abs).sort((a, b) => a - b);
      if (c.state !== "ok") {
        assert.equal(c.U, null);
        assert.ok(c.state === "no-calibration" ? c.cohort.length === 0 : mags.length === 0, c.name);
        continue;
      }
      assert.equal(c.U, mags[mags.length - 1], `${c.name}: U`);
      assert.equal(c.k, ref.typeSeven(mags, R.q(1, 2)), `${c.name}: k`);
    }
  });

  it("the hand vectors of TESTPLAN U15 and API.md A.3", () => {
    const a = byName["hand-unsigned-1-2-3-4-100"];
    assert.deepEqual([a.U, a.k], [100, 3]);
    const t = (c, kind, x) => c[kind].find((p) => p.x === x);
    assert.ok(Math.abs(t(a, "log1p", 3).t - 0.19601931707907) < 1e-13);
    assert.equal(t(a, "log1p", 3).index, 50);
    assert.ok(Math.abs(t(a, "log1p", 1).t - 0.08135536717084396) < 2e-16, "the quoted value is one ulp below the exact one; both are within 1e-15");
    assert.equal(t(a, "log1p", 1).index, 21);
    assert.equal(t(a, "log1p", 100).t, 1);
    assert.equal(t(a, "log1p", 100).atU, true);
    assert.equal(t(a, "log1p", 100).index, 255);
    assert.ok(Math.abs(t(a, "log1p", 200).t - 1.191870644681009) < 1e-15);
    assert.equal(t(a, "log1p", 200).over, true);
    assert.equal(t(a, "linear", 50).t, 0.5);
    const s = byName["hand-signed-m5-m1-0-2-10"];
    assert.deepEqual([s.U, s.k], [10, 3.5]);
    assert.ok(Math.abs(t(s, "log1p", -5).t - -0.6572973064836486) < 1e-15);
    assert.ok(Math.abs(t(s, "log1p", 2).t - 0.3348219707545264) < 1e-15);
    assert.equal(t(s, "log1p", 0).t, 0);
    assert.deepEqual([byName["hand-all-equal-5"].U, byName["hand-all-equal-5"].k], [5, 5]);
    assert.deepEqual([byName["hand-even-count-1-2-3-10"].U, byName["hand-even-count-1-2-3-10"].k], [10, 2.5]);
    assert.deepEqual([byName["hand-signed-m3-3-0-9"].U, byName["hand-signed-m3-3-0-9"].k], [9, 3]);
    assert.equal(byName["hand-zero-only"].state, "zero-only");
    assert.equal(byName["hand-empty"].state, "no-calibration");
  });

  it("every t agrees with IEEE Math.log1p within 1e-14 relative (and the linear transform exactly), every index with the clamped t", () => {
    let probes = 0;
    let worst = 0;
    for (const c of file.cases.filter((x) => x.state === "ok")) {
      for (const p of c.log1p) {
        const a = Math.abs(p.x);
        const t = a === 0 ? 0 : Math.log1p(a / c.k) / Math.log1p(c.U / c.k);
        const want = Math.abs(p.t);
        if (want) worst = Math.max(worst, Math.abs(t - want) / want);
        assert.ok(Math.abs(t - want) <= 1e-14 * Math.max(want, 1e-300), `${c.name} x=${p.x}: ${t} vs ${want}`);
        assert.equal(p.over, a > c.U);
        assert.equal(p.atU, a === c.U);
        assert.equal(Math.sign(p.t) === -1, c.signed && p.x < 0 && a !== 0, `${c.name} x=${p.x}: sign`);
        if (p.index !== null) assert.equal(p.index, Math.floor(Math.min(Math.max(t, 0), 1) * 255 + 0.5), `${c.name} x=${p.x}: index`);
        probes++;
      }
      for (const p of c.linear) {
        assert.equal(Math.abs(p.t), Math.abs(p.x) / c.U, `${c.name} linear x=${p.x}`);
        probes++;
      }
    }
    assert.ok(probes > 200, `${probes} probes`);
    assert.ok(worst < 1e-14, `worst relative difference against IEEE log1p: ${worst}`);
  });

  it("the cohorts are what their names say and the seeded ones are large enough to matter", () => {
    const sizes = file.cases.filter((c) => c.name.startsWith("seeded")).map((c) => c.cohort.length);
    assert.deepEqual(sizes, [7, 50, 200, 500, 37]);
    assert.ok(file.cases.some((c) => c.signed && c.state === "ok" && c.cohort.some((x) => x < 0) && c.cohort.some((x) => x === 0)), "a signed cohort with zeros");
  });
});

describe("Python goldens: 257-knot rank", () => {
  const file = golden("scales/rank-vectors.json");

  it("the knots of every cohort equal the exact-rational Type-7 of tests/reference (JavaScript against Python, bit for bit)", () => {
    for (const c of file.cases) {
      assert.equal(c.knots.length, 257, c.name);
      assert.deepEqual(ref.knots257(c.cohort), c.knots, c.name);
    }
  });

  it("every probe equals the rank mapping of tests/reference (t bit for bit, clip exactly)", () => {
    let probes = 0;
    for (const c of file.cases) {
      for (const p of c.probes) {
        assert.deepEqual(ref.rankApply(c.knots, p.x), { t: p.t, clip: p.clip }, `${c.name} x=${p.x}`);
        probes++;
      }
    }
    assert.ok(probes > 100, `${probes} probes`);
  });

  it("the hand vectors of API.md A.3 and TESTPLAN U16 are in the file", () => {
    const api = file.cases.find((c) => c.name.startsWith("api-a3"));
    assert.deepEqual(api.knots.slice(254), [20.4375, 20.71875, 21]);
    const t = (c, x) => c.probes.find((p) => p.x === x);
    assert.deepEqual([t(api, 1).t, t(api, 2).t, t(api, 4).t, t(api, 5).t, t(api, 21).t], [0.109375, 1 / 3, 0.5, 0.611328125, 1]);
    assert.deepEqual(t(api, 30), { x: 30, t: 1, clip: "high" });
    assert.deepEqual(t(api, 0.5), { x: 0.5, t: 0, clip: "low" });
    const two = file.cases.find((c) => c.name.startsWith("two-groups"));
    assert.deepEqual([t(two, 5).t, t(two, 7).t, t(two, 9).t], [0.25, 0.501953125, 0.751953125]);
    assert.deepEqual(t(two, 4.999), { x: 4.999, t: 0, clip: "low" });
    assert.deepEqual(t(two, 9.001), { x: 9.001, t: 1, clip: "high" });
    assert.equal(t(file.cases.find((c) => c.name.startsWith("all-equal")), 7).t, 0.5);
    assert.equal(t(file.cases.find((c) => c.name.startsWith("single")), 42).t, 0.5);
  });

  it("a jump cohort and a long plateau restore exactly: equal knots, mapped to the midpoint of their group", () => {
    const plateau = file.cases.find((c) => c.name.startsWith("plateau"));
    assert.ok(plateau.knots.filter((k) => k === 3).length > 150);
    const jump = file.cases.find((c) => c.name.startsWith("jump"));
    assert.equal(jump.knots[256], 1e9);
    assert.ok(jump.knots[255] < 1e9 && jump.knots[255] > 1e7, "the last knot before the top group is pulled towards the huge value (Type 7 interpolates)");
  });
});
