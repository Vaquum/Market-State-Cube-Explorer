"use strict";
// tests/reference/motion.js (H3): movement cells (path, dwell, high, low) from a trade list, in exact arithmetic.
//
// The semantics are THE FAKE'S OWN (TESTPLAN 4.5, limit L4), taken from the prose of docs/data-and-semantics.md lines 15
// and 94, never Origo's (whose rules for gaps, day boundaries and the first trade of a range this repository does not
// hold). Written here from the rules, not from the store that serves them:
//
//   path   For consecutive trades i-1 -> i with prices p0, p1: the move |p1 - p0| USDT belongs to the BASE COLUMN OF
//          TRADE i (the later trade) and is split over the base rows the price interval crosses in proportion to the length
//          inside each row (rows are multiples of 125 USDT). The first trade of the whole dataset has no path. A move is
//          counted when trade i's base column is inside [b0, b1), whatever the column of trade i-1 was.
//   dwell  The price of trade i holds from t_i until t_{i+1} (the last trade until `end`), and its seconds belong to the
//          base ROW OF TRADE i, split at level column boundaries. The hold is clipped to the rectangle's time range
//          [b0 * 56.25 s, b1 * 56.25 s) and intervals listed in `gaps` are not attributed to anything.
//   high/low  The extreme trade prices (USDT) of the cell; NaN in a cell that has no trade (movement alone can create it).
//
// Amounts are exact: path is an integer number of cents (over 100), dwell an integer number of milliseconds (over 1000),
// both rounded once to a double on output.
const R = require("./rational.js");
const { normalize, inRect, BASE_MS, ROW_CENTS, NOTIONAL_DEN } = require("./cells.js");

const keyOf = (c, r) => `${c}:${r}`;

// mergeGaps(gaps): [[t0, t1)] in ms as sorted, disjoint BigInt pairs (empty and inverted intervals dropped).
function mergeGaps(gaps) {
  const sorted = gaps.map(([a, b]) => [BigInt(a), BigInt(b)]).filter(([a, b]) => b > a).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const out = [];
  for (const g of sorted) {
    if (out.length && g[0] <= out[out.length - 1][1]) {
      if (g[1] > out[out.length - 1][1]) out[out.length - 1][1] = g[1];
    } else out.push([g[0], g[1]]);
  }
  return out;
}

// [from, to) minus the gaps, as a list of [a, z) pieces.
function withoutGaps(from, to, gaps) {
  const out = [];
  let cursor = from;
  for (const [g0, g1] of gaps) {
    if (g1 <= cursor) continue;
    if (g0 >= to) break;
    if (g0 > cursor) out.push([cursor, g0]);
    if (g1 > cursor) cursor = g1;
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

// motion(trades, {n, m, b0, b1, r0, r1, end, gaps}) -> [{c, r, p, w, hi, lo, v, bv, ct, bt}] sorted by (c, r):
// the level-(n, m) cells over base columns [b0, b1) and base rows [r0, r1) (null: all rows) that hold a trade, a path or a dwell.
// `end` is the data end in ms (where the last trade's price stops holding; default: the end of the rectangle), `gaps` the
// unattributed intervals in ms. p is USDT, w is seconds; movement-only cells have v = bv = ct = bt = 0 and NaN hi/lo.
function motion(trades, rect) {
  const { n, m, b0, b1, gaps = [] } = rect;
  const list = normalize(trades);
  const stepC = 1n << BigInt(n);
  const stepR = 1n << BigInt(m);
  const lo = BigInt(b0) * BASE_MS;
  const hi = BigInt(b1) * BASE_MS;
  const end = rect.end === undefined || rect.end === null ? hi : BigInt(rect.end);
  const holes = mergeGaps(gaps);
  const colMs = stepC * BASE_MS;
  const rowOk = (row) => rect.r0 === null || rect.r0 === undefined || (row >= BigInt(rect.r0) && row < BigInt(rect.r1));
  const acc = new Map();
  const cell = (c, r) => {
    const key = keyOf(c, r);
    let x = acc.get(key);
    if (!x) acc.set(key, (x = { c, r, v: 0n, bv: 0n, ct: 0n, bt: 0n, path: 0n, dwell: 0n, hi: null, lo: null }));
    return x;
  };
  list.forEach((x, i) => {
    // trades of the rectangle: sums and extremes
    if (inRect(x, rect)) {
      const target = cell(x.col / stepC, x.row / stepR);
      target.v += x.notional;
      target.ct += x.count;
      if (x.buy) {
        target.bv += x.notional;
        target.bt += x.count;
      }
      if (target.hi === null || x.price > target.hi) target.hi = x.price;
      if (target.lo === null || x.price < target.lo) target.lo = x.price;
    }
    // path: the move from the previous trade, cents per base row it crosses, to the column of THIS trade
    if (i > 0 && x.col >= BigInt(b0) && x.col < BigInt(b1) && list[i - 1].price !== x.price) {
      const a = list[i - 1].price < x.price ? list[i - 1].price : x.price;
      const z = list[i - 1].price < x.price ? x.price : list[i - 1].price;
      for (let row = a / ROW_CENTS; row * ROW_CENTS < z; row++) {
        const from = a > row * ROW_CENTS ? a : row * ROW_CENTS;
        const to = z < (row + 1n) * ROW_CENTS ? z : (row + 1n) * ROW_CENTS;
        if (to > from && rowOk(row)) cell(x.col / stepC, row / stepR).path += to - from;
      }
    }
    // dwell: this trade's price holds until the next trade (the data end for the last one), inside the time range, minus gaps
    if (rowOk(x.row)) {
      const nextT = i + 1 < list.length ? list[i + 1].t : end;
      const from = x.t > lo ? x.t : lo;
      const to = (nextT < hi ? nextT : hi);
      if (to > from) {
        for (const [a, z] of withoutGaps(from, to, holes)) {
          let at = a;
          while (at < z) {
            const c = at / colMs;
            const stop = (c + 1n) * colMs < z ? (c + 1n) * colMs : z;
            cell(c, x.row / stepR).dwell += stop - at;
            at = stop;
          }
        }
      }
    }
  });
  const order = (a, b) => (a.c === b.c ? (a.r < b.r ? -1 : a.r > b.r ? 1 : 0) : a.c < b.c ? -1 : 1);
  return [...acc.values()].sort(order).map((x) => ({
    c: Number(x.c), r: Number(x.r),
    p: R.ratioToDouble(x.path, 100n), w: R.ratioToDouble(x.dwell, 1000n),
    hi: x.ct > 0n ? R.ratioToDouble(x.hi, 100n) : NaN, lo: x.ct > 0n ? R.ratioToDouble(x.lo, 100n) : NaN,
    v: R.ratioToDouble(x.v, NOTIONAL_DEN), bv: R.ratioToDouble(x.bv, NOTIONAL_DEN), ct: Number(x.ct), bt: Number(x.bt),
  }));
}

module.exports = { motion, mergeGaps, withoutGaps };
