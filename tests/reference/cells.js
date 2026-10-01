"use strict";
// tests/reference/cells.js (H3): cell sums, summaries, period rows and exposure from a trade list, in exact arithmetic.
//
// The reference calculator of TESTPLAN 4.5. It answers the same questions as the fake cube's store
// (tests/support/trades.js) but shares nothing with it: no import of src/, tests/support/ or vendor/, sums in BigInt
// instead of Float64 in time order, and the straightforward definition instead of a cache. A difference between the
// two is therefore a finding about one of them, and the size of the difference is the floating-point summation error.
//
// Trade model (TESTPLAN 4.1 and DR-45): {t_ms, price, qty, takerBuy, count?} with t_ms in integer milliseconds since
// 2021-01-01T00:00:00Z, price in 1e-2 USDT, qty in 1e-8 BTC, all integers, in time order; the array order is the trade
// id order. `t`/`buy` are accepted for `t_ms`/`takerBuy`. Notional of one trade in USDT = price * qty / 1e10, exactly.
//
// Geometry: a BASE column is 56.25 s = 56,250 ms; a base ROW is 125 USDT = 12,500 cents. A level (n, m) cell is
// column floor(base_col / 2^n), row floor(base_row / 2^m). A trade belongs to base column floor(t_ms / 56250) and base
// row floor(price / 12500); a rectangle takes the trades whose base column is in [b0, b1) and, when r0/r1 are given,
// whose base row is in [r0, r1).
const R = require("./rational.js");

const BASE_MS = 56250n;
const ROW_CENTS = 12500n;
const NOTIONAL_DEN = 10n ** 10n; // USDT = price * qty / 1e10
const BASE_SECONDS = R.q(225, 4); // 56.25
const BASE_PRICE = 125n;

// normalize(trades): the list with BigInt fields, validated as the fixture shape requires.
function normalize(trades) {
  let last = -1;
  return trades.map((raw, index) => {
    const t = raw.t_ms ?? raw.t;
    const buy = raw.takerBuy ?? raw.buy;
    for (const [name, v] of [["t_ms", t], ["price", raw.price], ["qty", raw.qty]]) {
      if (!Number.isInteger(v)) throw new RangeError(`trade ${index}: ${name} ${v} must be an integer`);
    }
    if (t < last) throw new RangeError(`trade ${index}: time ${t} is before the previous trade (${last})`);
    last = t;
    const count = raw.count ?? 1;
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`trade ${index}: count ${count} must be a positive integer`);
    const tms = BigInt(t);
    const cents = BigInt(raw.price);
    return {
      id: index, t: tms, price: cents, qty: BigInt(raw.qty), buy: Boolean(buy), count: BigInt(count),
      col: tms / BASE_MS, row: cents / ROW_CENTS, // both non-negative, so integer division floors
      notional: cents * BigInt(raw.qty), // over NOTIONAL_DEN
    };
  });
}

// inRect(trade, rect): the trade's base cell is inside [b0, b1) x [r0, r1) (rows unbounded when null/undefined).
function inRect(trade, { b0, b1, r0 = null, r1 = null }) {
  if (trade.col < BigInt(b0) || trade.col >= BigInt(b1)) return false;
  return r0 === null || (trade.row >= BigInt(r0) && trade.row < BigInt(r1));
}

const keyOf = (c, r) => `${c}:${r}`;

// cells(trades, {n, m, b0, b1, r0, r1}) -> [{c, r, v, bv, ct, bt}] sorted by (c, r): the level-(n, m) cells of the
// rectangle. v and bv are the exact sums rounded once to a double; `exact` holds them as "num/den" strings.
function cells(trades, rect) {
  const { n, m } = rect;
  const stepC = 1n << BigInt(n);
  const stepR = 1n << BigInt(m);
  const acc = new Map();
  for (const x of normalize(trades)) {
    if (!inRect(x, rect)) continue;
    const c = x.col / stepC;
    const r = x.row / stepR;
    const key = keyOf(c, r);
    let cell = acc.get(key);
    if (!cell) acc.set(key, (cell = { c, r, v: 0n, bv: 0n, ct: 0n, bt: 0n }));
    cell.v += x.notional;
    cell.ct += x.count;
    if (x.buy) {
      cell.bv += x.notional;
      cell.bt += x.count;
    }
  }
  return [...acc.values()]
    .sort((a, b) => (a.c === b.c ? (a.r < b.r ? -1 : a.r > b.r ? 1 : 0) : a.c < b.c ? -1 : 1))
    .map((x) => ({
      c: Number(x.c), r: Number(x.r),
      v: R.ratioToDouble(x.v, NOTIONAL_DEN), bv: R.ratioToDouble(x.bv, NOTIONAL_DEN), ct: Number(x.ct), bt: Number(x.bt),
      exact: { v: R.show(R.q(x.v, NOTIONAL_DEN)), bv: R.show(R.q(x.bv, NOTIONAL_DEN)) },
    }));
}

// Point of control of a list of {row, sum} (exact BigInt sums): the row with the largest sum, the LOWER row on a tie;
// null when the largest sum is not positive.
function pointOfControl(rows) {
  let best = null;
  for (const [row, sum] of [...rows.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (sum > 0n && (best === null || sum > best.sum)) best = { row, sum };
  }
  return best;
}

// summary(trades, {n, m, b0, b1, r0, r1}) -> {volume, takerBuyVolume, trades, takerBuyTrades, pocRow, poc, takerBuyPocRow,
// takerBuyPoc, cells}: the totals of a rectangle and its points of control at level rows of 2^m base rows (m defaults to
// 0 and n is not needed: rows only). poc is the row's centre price (row + 0.5) * 125 * 2^m in USDT, the bridge's definition;
// null without volume.
function summary(trades, rect) {
  const m = rect.m ?? 0;
  const stepR = 1n << BigInt(m);
  let v = 0n, bv = 0n, ct = 0n, bt = 0n;
  const rows = new Map();
  const buyRows = new Map();
  const cellKeys = new Set();
  const stepC = 1n << BigInt(rect.n ?? 0);
  for (const x of normalize(trades)) {
    if (!inRect(x, rect)) continue;
    const r = x.row / stepR;
    v += x.notional;
    ct += x.count;
    rows.set(r, (rows.get(r) ?? 0n) + x.notional);
    cellKeys.add(keyOf(x.col / stepC, r));
    if (x.buy) {
      bv += x.notional;
      bt += x.count;
      buyRows.set(r, (buyRows.get(r) ?? 0n) + x.notional);
    }
  }
  const price = (best) => (best === null ? null : R.toDouble(R.mul(R.add(R.q(best.row), R.q(1, 2)), R.q(BASE_PRICE * stepR))));
  const poc = pointOfControl(rows);
  const buyPoc = pointOfControl(buyRows);
  return {
    volume: R.ratioToDouble(v, NOTIONAL_DEN), takerBuyVolume: R.ratioToDouble(bv, NOTIONAL_DEN), trades: Number(ct), takerBuyTrades: Number(bt),
    pocRow: poc === null ? null : Number(poc.row), poc: price(poc),
    takerBuyPocRow: buyPoc === null ? null : Number(buyPoc.row), takerBuyPoc: price(buyPoc),
    cells: cellKeys.size,
  };
}

// periodRows(trades, {b0, b1, m}) -> [{r, v, bv, ct, bt}] ascending by row: the volume at each row of 2^m base rows
// summed over ALL base columns [b0, b1): what a Rows period holds (the cohort of Rows scales covers every row of it).
function periodRows(trades, { b0, b1, m = 0 }) {
  const stepR = 1n << BigInt(m);
  const acc = new Map();
  for (const x of normalize(trades)) {
    if (!inRect(x, { b0, b1 })) continue;
    const r = x.row / stepR;
    let row = acc.get(r);
    if (!row) acc.set(r, (row = { r, v: 0n, bv: 0n, ct: 0n, bt: 0n }));
    row.v += x.notional;
    row.ct += x.count;
    if (x.buy) {
      row.bv += x.notional;
      row.bt += x.count;
    }
  }
  return [...acc.values()]
    .sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0))
    .map((x) => ({
      r: Number(x.r), v: R.ratioToDouble(x.v, NOTIONAL_DEN), bv: R.ratioToDouble(x.bv, NOTIONAL_DEN), ct: Number(x.ct), bt: Number(x.bt),
    }));
}

// exposure({c, r}, rect, cutMs, n, m) -> {seconds, width, timeFraction, widthFraction, whole}: how much of the level-(n, m)
// cell (c, r) a measurement actually covers. rect = {b0, b1, r0, r1} in base columns and base rows (r0/r1 may be null:
// unbounded; a bound may be fractional, given as a rational {n, d} or a double); cutMs is the data cutoff in integer milliseconds since 2021-01-01T00:00:00Z (the open column ends there).
// Exact rationals throughout: seconds = covered base columns * 56.25, width = covered base rows * 125 USDT, the fractions
// are against the NOMINAL cell (2^n * 56.25 s, 2^m * 125 USDT). `whole` iff both fractions are exactly 1. Doubles out.
function exposure(cell, rect, cutMs, n, m) {
  // Bounds may be integers, BigInts, rationals {n, d} (an exact fractional bound) or doubles (taken at their exact value).
  const toQ = (x) => (typeof x === "object" ? x : typeof x === "bigint" || Number.isInteger(x) ? R.q(x) : R.fromDouble(x));
  const ts = R.q(1n << BigInt(n));
  const ps = R.q(1n << BigInt(m));
  const c = R.q(cell.c);
  const r = R.q(cell.r);
  const cut = R.q(BigInt(cutMs), BASE_MS); // the cutoff in base columns
  const inf = null;
  const lowest = (...xs) => xs.filter((x) => x !== inf).reduce((a, b) => (R.cmp(a, b) <= 0 ? a : b));
  const highest = (...xs) => xs.filter((x) => x !== inf).reduce((a, b) => (R.cmp(a, b) >= 0 ? a : b));
  const t0 = highest(R.mul(c, ts), toQ(rect.b0));
  const t1 = lowest(R.mul(R.add(c, R.ONE), ts), toQ(rect.b1), cut);
  const p0 = highest(R.mul(r, ps), rect.r0 === null || rect.r0 === undefined ? inf : toQ(rect.r0));
  const p1 = lowest(R.mul(R.add(r, R.ONE), ps), rect.r1 === null || rect.r1 === undefined ? inf : toQ(rect.r1));
  const covered = (a, b) => (R.cmp(b, a) > 0 ? R.sub(b, a) : R.ZERO);
  const seconds = R.mul(covered(t0, t1), BASE_SECONDS);
  const width = R.mul(covered(p0, p1), R.q(BASE_PRICE));
  const timeFraction = R.div(seconds, R.mul(ts, BASE_SECONDS));
  const widthFraction = R.div(width, R.mul(ps, R.q(BASE_PRICE)));
  return {
    seconds: R.toDouble(seconds), width: R.toDouble(width), timeFraction: R.toDouble(timeFraction), widthFraction: R.toDouble(widthFraction),
    whole: R.eq(timeFraction, R.ONE) && R.eq(widthFraction, R.ONE),
  };
}

module.exports = { cells, summary, periodRows, exposure, normalize, inRect, pointOfControl, BASE_MS, ROW_CENTS, NOTIONAL_DEN };
