"use strict";
// tests/support/trades.js (H2): the trade model and the fake cube's store.
//
// A trade is {t, price, qty, buy, count}: t in milliseconds since 2021-01-01T00:00:00Z (integer),
// price in 1e-2 USDT (integer), qty in 1e-8 BTC (integer), buy = taker bought (is_buyer_maker = 0),
// count = how many executions the record stands for (default 1; a "burst" scales trade counts
// without changing path or dwell). Ids are the order of the records: bars open with the first and
// close with the last record of a column. Base column = floor(t / 56250); base row = floor(price /
// 12500) (125 USDT); volume in USDT = price * qty / 1e10.
//
// The store answers three questions from those records: the base cells (sums per (col, row) in
// summation order), the movement cells (path, dwell, high, low) and the bars. Everything coarser
// is an aggregation of base cells (aggregate) or a pass over the trades at the asked level.
//
// Motion semantics are THE FAKE'S OWN (TESTPLAN 4.5), stated so that no test mistakes them for
// Origo's: for consecutive trades i-1 -> i, path = |p_i - p_{i-1}| USDT, belonging to trade i's base
// column and split across the base rows the price interval crosses in proportion to the length
// inside each row; the first trade has no path. The price of trade i holds from t_i until t_{i+1}
// (the last trade until the data end) and its dwell, in seconds, belongs to trade i's row, split at
// column boundaries; intervals listed as gaps are not attributed. high and low are the extreme trade
// prices of the cell (NaN in a cell that has no trades, which movement alone can create).
const { BASE_MS, DAY } = require("./wire.js");

const DAY_MS = DAY * BASE_MS; // 86,400,000
const ROW_CENTS = 12500; // 125 USDT in 1e-2 USDT
const MAX_ROW = 65536; // the fake keys a cell as col * 65536 + row; 8.19 M USDT is far beyond any profile

// First index whose value is >= x in a sorted array-like (typed or plain), searching [lo, hi).
function lowerBound(values, x, lo = 0, hi = values.length) {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// A 32-bit mix of (salt, k): the order in which jitter sums the trades of a cell.
function mix(salt, k) {
  let h = Math.imul((salt ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

class TradeStore {
  constructor() {
    this.t = [];
    this.price = [];
    this.qty = [];
    this.buy = [];
    this.count = [];
    this.col = []; // base column of each trade, kept beside t so no pass recomputes it
    this.row = [];
    this.gaps = []; // [[t0, t1)] in ms: dwell inside them is not attributed
    this.jitterSeed = null;
    this.cellsCache = null;
    this.builtTo = 0;
    this.dayCache = null;
  }

  get length() {
    return this.t.length;
  }

  // TradeStore.fromList(trades, {gaps}): trades as objects {t, price, qty, buy, count?} (t_ms is accepted for t
  // and takerBuy for buy, the names of the fixture files).
  static fromList(list, { gaps = [] } = {}) {
    const store = new TradeStore();
    store.append(list);
    store.setGaps(gaps);
    return store;
  }

  // append(list): add trades after the current last one. Validates what every consumer assumes:
  // integers, non-decreasing time, rows that fit the cell key.
  append(list) {
    let last = this.t.length ? this.t[this.t.length - 1] : -Infinity;
    for (const raw of list) {
      const t = raw.t ?? raw.t_ms;
      const buy = raw.buy ?? raw.takerBuy;
      const count = raw.count ?? 1;
      if (!Number.isInteger(t) || t < 0) throw new RangeError(`trade time ${t} must be a non-negative integer of milliseconds`);
      if (t < last) throw new RangeError(`trades must be in time order: ${t} follows ${last}`);
      if (!Number.isInteger(raw.price) || raw.price < 1) throw new RangeError(`trade price ${raw.price} must be a positive integer of 1e-2 USDT`);
      if (!Number.isInteger(raw.qty) || raw.qty < 1) throw new RangeError(`trade qty ${raw.qty} must be a positive integer of 1e-8 BTC`);
      if (!Number.isInteger(count) || count < 1) throw new RangeError(`trade count ${count} must be a positive integer`);
      const row = Math.floor(raw.price / ROW_CENTS);
      if (row >= MAX_ROW) throw new RangeError(`price ${raw.price / 100} USDT is beyond the fake's row range`);
      this.t.push(t);
      this.price.push(raw.price);
      this.qty.push(raw.qty);
      this.buy.push(buy ? 1 : 0);
      this.count.push(count);
      this.col.push(Math.floor(t / BASE_MS));
      this.row.push(row);
      last = t;
    }
    this.dayCache = null;
  }

  setGaps(gaps) {
    // Sorted and merged, so the dwell subtraction can walk them once.
    const sorted = gaps.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const g of sorted) {
      if (!(g[1] > g[0])) continue;
      if (merged.length && g[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], g[1]);
      else merged.push(g);
    }
    this.gaps = merged;
  }

  clone() {
    const copy = new TradeStore();
    for (const key of ["t", "price", "qty", "buy", "count", "col", "row"]) copy[key] = this[key].slice();
    copy.gaps = this.gaps.map((g) => g.slice());
    copy.jitterSeed = this.jitterSeed;
    if (this.cellsCache) {
      copy.cellsCache = Object.fromEntries(Object.entries(this.cellsCache).map(([k, v]) => [k, v.slice()]));
      copy.builtTo = this.builtTo;
    }
    return copy;
  }

  // The UTC days (day index since 2021-01-01) that hold at least one trade, ascending.
  days() {
    if (!this.dayCache) {
      const out = [];
      let last = -1;
      for (let i = 0; i < this.t.length; i++) {
        const d = Math.floor(this.t[i] / DAY_MS);
        if (d !== last) {
          out.push(d);
          last = d;
        }
      }
      this.dayCache = out;
    }
    return this.dayCache;
  }

  // jitter(seed | null): sum the trades of every cell in a seeded pseudo-random order instead of time order,
  // which changes volumes in the last bits (a cell of one trade cannot change) and nothing else.
  setJitter(seed) {
    this.jitterSeed = seed === null ? null : seed >>> 0;
    this.cellsCache = null;
    this.builtTo = 0;
  }

  // scaleDay(day, factor, extraCount): a revision of one UTC day: quantities times factor (rounded to whole
  // 1e-8 BTC, at least 1) and extraCount more executions on every trade of the day.
  scaleDay(day, factor, extraCount = 0) {
    const lo = lowerBound(this.t, day * DAY_MS);
    const hi = lowerBound(this.t, (day + 1) * DAY_MS);
    for (let i = lo; i < hi; i++) {
      this.qty[i] = Math.max(1, Math.round(this.qty[i] * factor));
      this.count[i] += extraCount;
    }
    this.cellsCache = null;
    this.builtTo = 0;
    return hi - lo;
  }

  // ---- base cells ----

  // cells(): the base cells (0, 0) over all trades as columnar typed arrays sorted by (col, row). Built once and
  // extended incrementally: an append recomputes only the columns from the one holding the previous last trade.
  cells() {
    if (!this.cellsCache) {
      this.cellsCache = this.build(0, this.t.length);
      this.builtTo = this.t.length;
    } else if (this.builtTo < this.t.length) {
      const anchor = this.col[this.builtTo - 1];
      const first = lowerBound(this.col, anchor);
      const keep = lowerBound(this.cellsCache.col, anchor);
      const tail = this.build(first, this.t.length);
      const head = this.cellsCache;
      const joined = {};
      for (const key of Object.keys(head)) {
        const out = new (head[key].constructor)(keep + tail[key].length);
        out.set(head[key].subarray(0, keep), 0);
        out.set(tail[key], keep);
        joined[key] = out;
      }
      this.cellsCache = joined;
      this.builtTo = this.t.length;
    }
    return this.cellsCache;
  }

  build(from, to) {
    const vol = [], tbvol = [], cnt = [], tbcnt = [], col = [], row = [];
    const salt = this.jitterSeed;
    let i = from;
    while (i < to) {
      const c = this.col[i];
      let j = i + 1;
      while (j < to && this.col[j] === c) j++;
      const idx = [];
      for (let k = i; k < j; k++) idx.push(k);
      idx.sort((a, b) => this.row[a] - this.row[b] || (salt === null ? a - b : mix(salt, a) - mix(salt, b) || a - b));
      let p = 0;
      while (p < idx.length) {
        const r = this.row[idx[p]];
        let v = 0, bv = 0, ct = 0, bt = 0;
        for (; p < idx.length && this.row[idx[p]] === r; p++) {
          const k = idx[p];
          const notional = (this.price[k] * this.qty[k]) / 1e10;
          v += notional;
          ct += this.count[k];
          if (this.buy[k]) {
            bv += notional;
            bt += this.count[k];
          }
        }
        vol.push(v); tbvol.push(bv); cnt.push(ct); tbcnt.push(bt); col.push(c); row.push(r);
      }
      i = j;
    }
    return {
      vol: Float64Array.from(vol), tbvol: Float64Array.from(tbvol), cnt: Float64Array.from(cnt), tbcnt: Float64Array.from(tbcnt),
      col: Uint32Array.from(col), row: Uint32Array.from(row),
    };
  }

  // ---- movement cells (MSC3) ----

  // motionCells({n, m, b0, b1, r0, r1, dataEndMs}): level-(n, m) cells with path, dwell, high and low over base columns
  // [b0, b1) and base rows [r0, r1) (null: all rows), including the cells the price only passed or held. Time bounds
  // cut on base columns (a trade counts when its base column is inside), row bounds on base rows. dataEndMs is where
  // the last trade's price stops holding (the data end).
  motionCells({ n, m, b0, b1, r0 = null, r1 = null, dataEndMs }) {
    const step = 2 ** n, rstep = 2 ** m;
    const loMs = b0 * BASE_MS, hiMs = b1 * BASE_MS;
    const inRows = (r) => r0 === null || (r >= r0 && r < r1);
    const acc = new Map();
    const cell = (C, R) => {
      const key = C * MAX_ROW + R;
      let a = acc.get(key);
      if (!a) {
        a = { col: C, row: R, vol: 0, tbvol: 0, cnt: 0, tbcnt: 0, path: 0, dwell: 0, high: -Infinity, low: Infinity };
        acc.set(key, a);
      }
      return a;
    };
    const start = Math.max(0, lowerBound(this.t, loMs) - 1); // the trade before the range may still hold into it
    const colMs = step * BASE_MS;
    for (let i = start; i < this.t.length && this.t[i] < hiMs; i++) {
      const row = this.row[i];
      const inTime = this.col[i] >= b0 && this.col[i] < b1;
      if (inTime && inRows(row)) {
        const a = cell(Math.floor(this.col[i] / step), Math.floor(row / rstep));
        const notional = (this.price[i] * this.qty[i]) / 1e10;
        a.vol += notional;
        a.cnt += this.count[i];
        if (this.buy[i]) {
          a.tbvol += notional;
          a.tbcnt += this.count[i];
        }
        a.high = Math.max(a.high, this.price[i] / 100);
        a.low = Math.min(a.low, this.price[i] / 100);
      }
      // Path: the move from the previous trade, split over the base rows it crosses, to this trade's column.
      if (inTime && i > 0 && this.price[i - 1] !== this.price[i]) {
        const lo = Math.min(this.price[i - 1], this.price[i]);
        const hi = Math.max(this.price[i - 1], this.price[i]);
        for (let r = Math.floor(lo / ROW_CENTS); r * ROW_CENTS < hi; r++) {
          if (!inRows(r)) continue;
          const part = Math.min(hi, (r + 1) * ROW_CENTS) - Math.max(lo, r * ROW_CENTS);
          if (part > 0) cell(Math.floor(this.col[i] / step), Math.floor(r / rstep)).path += part / 100;
        }
      }
      // Dwell: this trade's price holds until the next trade (the data end for the last), clipped to the range,
      // minus gaps, split at level column boundaries.
      if (inRows(row)) {
        const from = Math.max(this.t[i], loMs);
        const to = Math.min(i + 1 < this.t.length ? this.t[i + 1] : dataEndMs, hiMs);
        if (to > from) {
          for (const [a, z] of this.without(from, to)) {
            let cur = a;
            while (cur < z) {
              const C = Math.floor(cur / colMs);
              const next = Math.min(z, (C + 1) * colMs);
              cell(C, Math.floor(row / rstep)).dwell += (next - cur) / 1000;
              cur = next;
            }
          }
        }
      }
    }
    const cells = [...acc.entries()].sort((x, y) => x[0] - y[0]).map(([, a]) => a);
    const out = { vol: [], tbvol: [], cnt: [], tbcnt: [], path: [], dwell: [], high: [], low: [], col: [], row: [] };
    for (const a of cells) {
      out.vol.push(a.vol); out.tbvol.push(a.tbvol); out.cnt.push(a.cnt); out.tbcnt.push(a.tbcnt);
      out.path.push(a.path); out.dwell.push(a.dwell);
      out.high.push(a.cnt > 0 ? a.high : NaN); out.low.push(a.cnt > 0 ? a.low : NaN);
      out.col.push(a.col); out.row.push(a.row);
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, k === "col" || k === "row" ? Uint32Array.from(v) : Float64Array.from(v)]));
  }

  // [from, to) minus the gaps, as a list of [a, z).
  without(from, to) {
    if (!this.gaps.length) return [[from, to]];
    const out = [];
    let cur = from;
    for (const [g0, g1] of this.gaps) {
      if (g1 <= cur) continue;
      if (g0 >= to) break;
      if (g0 > cur) out.push([cur, g0]);
      cur = Math.max(cur, g1);
    }
    if (cur < to) out.push([cur, to]);
    return out;
  }

  // ---- bars (MSCB) ----

  // bars({n, b0, b1}): one bar per level-n column that has trades among base columns [b0, b1), in time order:
  // open = first trade, close = last, high and low = extreme prices (USDT), vol = USDT, tbvol = taker-buy USDT,
  // btc = base volume, cnt = trade count.
  bars({ n, b0, b1 }) {
    const step = 2 ** n;
    const out = { open: [], high: [], low: [], close: [], vol: [], tbvol: [], btc: [], cnt: [], col: [] };
    let i = lowerBound(this.t, b0 * BASE_MS);
    while (i < this.t.length && this.t[i] < b1 * BASE_MS) {
      const C = Math.floor(this.col[i] / step);
      let high = -Infinity, low = Infinity, vol = 0, tbvol = 0, btc = 0, cnt = 0;
      const open = this.price[i] / 100;
      let close = open;
      for (; i < this.t.length && this.t[i] < b1 * BASE_MS && Math.floor(this.col[i] / step) === C; i++) {
        const p = this.price[i] / 100;
        const notional = (this.price[i] * this.qty[i]) / 1e10;
        high = Math.max(high, p);
        low = Math.min(low, p);
        close = p;
        vol += notional;
        if (this.buy[i]) tbvol += notional;
        btc += this.qty[i] / 1e8;
        cnt += this.count[i];
      }
      for (const [key, value] of [["open", open], ["high", high], ["low", low], ["close", close], ["vol", vol], ["tbvol", tbvol], ["btc", btc], ["cnt", cnt], ["col", C]]) out[key].push(value);
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, k === "col" ? Uint32Array.from(v) : Float64Array.from(v)]));
  }
}

// aggregate(base, n, m, lo, hi, r0, r1): level-(n, m) cells from the base cells at indices [lo, hi), keeping only base
// rows in [r0, r1) when given. Base cells are summed in their (col, row) order; the result is sorted by (col, row).
function aggregate(base, n, m, lo, hi, r0 = null, r1 = null) {
  const step = 2 ** n, rstep = 2 ** m;
  const out = { vol: [], tbvol: [], cnt: [], tbcnt: [], col: [], row: [] };
  let i = lo;
  while (i < hi) {
    const C = Math.floor(base.col[i] / step);
    const rows = new Map();
    for (; i < hi && Math.floor(base.col[i] / step) === C; i++) {
      const r = base.row[i];
      if (r0 !== null && (r < r0 || r >= r1)) continue;
      const R = Math.floor(r / rstep);
      let a = rows.get(R);
      if (!a) rows.set(R, (a = [0, 0, 0, 0]));
      a[0] += base.vol[i]; a[1] += base.tbvol[i]; a[2] += base.cnt[i]; a[3] += base.tbcnt[i];
    }
    for (const R of [...rows.keys()].sort((x, y) => x - y)) {
      const a = rows.get(R);
      out.vol.push(a[0]); out.tbvol.push(a[1]); out.cnt.push(a[2]); out.tbcnt.push(a[3]); out.col.push(C); out.row.push(R);
    }
  }
  return {
    vol: Float64Array.from(out.vol), tbvol: Float64Array.from(out.tbvol), cnt: Float64Array.from(out.cnt), tbcnt: Float64Array.from(out.tbcnt),
    col: Uint32Array.from(out.col), row: Uint32Array.from(out.row),
  };
}

// cellsOf(store, n, m, b0, b1, r0, r1): the level cells over base columns [b0, b1) (binary search on the sorted base cells).
function cellsOf(store, n, m, b0, b1, r0 = null, r1 = null) {
  const base = store.cells();
  return aggregate(base, n, m, lowerBound(base.col, b0), lowerBound(base.col, b1), r0, r1);
}

module.exports = { TradeStore, aggregate, cellsOf, lowerBound, DAY_MS, ROW_CENTS, MAX_ROW };
