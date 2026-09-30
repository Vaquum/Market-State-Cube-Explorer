"use strict";
// tests/support/bridge-model.js (H2): a pure model of tools/cube_bridge.py, without HTTP.
//
// The fake cube stands at the bridge's HTTP boundary (what the page sees), so this file re-implements
// the bridge's PAGE-VISIBLE logic function by function (the names and line order follow the Python so
// a reader can hold the two side by side): the three tiers, the state token, the held packs, the pins
// and the 409 cube_changed rule, the tails() decision between a delta and a whole pack, the open
// column taken from the pack's own snapshot, motion and bars ending at the last closed column, the
// answer caches, and the summaries. What the bridge asks Origo for is replaced by a Cube over a
// TradeStore (below), whose semantics are the fake's own and are stated in trades.js (limit L1..L4 of
// TESTPLAN 4.7: nothing here validates Origo).
//
// DRIFT RULE (TESTPLAN 4.6): any change to the protocol behaviour of tools/cube_bridge.py updates this
// file, tests/fixtures/wire/*.json (tests/reference/wire_golden.py) and the plan in the same PR;
// tests/reference/bridge_crosscheck.py compares the two where numpy exists.
//
// Everything is synchronous and deterministic: no Date.now(), no Math.random(); the token is a hash of
// the cutoff, the pins and a salt that only rebuild() and jitter() move.
const crypto = require("node:crypto");
const wire = require("./wire.js");
const { TradeStore, aggregate, lowerBound, DAY_MS } = require("./trades.js");
const { EPOCH_MS } = require("./profiles.js");

const { BASE_SECONDS, BASE_MS, BASE_PRICE, DAY, T0 } = wire;

const PACK_MAX_AGE_SECONDS = 60;
const PACKS_HELD = 16;
const MOTION_HELD = 8;
const TOUCHES_HELD = 32;
const BARS_HELD = 64;
const BAR_LEVELS = [2, 4, 6, 8, 9];
const VOLUME_ROUNDING = 1e-12; // how far two reads of the same cells' volume may differ: the last bits of a float sum
const MAX_COLUMNS = 4096;
const MAX_CELLS = 1000000;
const HISTORY_COLUMNS = 100000;
const MAX_TIME_EXPONENT = 24;
const MAX_PRICE_EXPONENT = 12;
const PROTOCOL = "2";
const OUTDATED = "the explorer was updated; reload the page to see the latest data";
const FIELDS = ["vol", "tbvol", "cnt", "tbcnt", "col", "row"]; // MSC2 order
const TIERS = [
  { id: "overview", n: 12, m: 3 },
  { id: "recent", n: 0, m: 0, days: 7 },
  { id: "reference", n: 4, m: 0, days: 30, complete: true },
];
const NOTES = [
  "Every block is read live from the market state cube through its supported reader.",
  "Recent has the last seven days at base resolution, up to the cube's data cutoff.",
  "Reference has 30 days of completed 15-minute columns. Filter each candidate outcome to end before the replay anchor.",
  "Overview is contextual: 64 hours x 1000 USDT over the whole history.",
  "Any rectangle, finer detail and the continuations' history are read from the cube on demand.",
];

// ---- the bridge's exceptions ----

class ValueError extends Error {} // -> 400 {"error": message}
class CubeChanged extends Error {} // -> 409 {"error": "cube_changed", "detail": message}
// The cube's own refusal (market_state_reader.MarketStateError): status and body of the service's answer.
class MarketStateError extends Error {
  constructor(status, body) {
    super(`market state service answered ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

// ---- exact sums: math.fsum ----

// fsum(values): the correctly rounded sum, as Python's math.fsum computes it (Shewchuk's partials, with the
// half-way correction of CPython's implementation), so totals and points of control are order independent.
function fsum(values) {
  const partials = [];
  for (let x of values) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  let n = partials.length;
  let hi = 0;
  if (n > 0) {
    hi = partials[--n];
    let lo = 0;
    while (n > 0) {
      const x = hi;
      const y = partials[--n];
      hi = x + y;
      lo = y - (hi - x);
      if (lo !== 0) break;
    }
    if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
      const y = lo * 2;
      const x = hi + y;
      if (y === x - hi) hi = x;
    }
  }
  return hi;
}

// ---- small helpers on columnar cells ----

const empty = (cells) => Object.fromEntries(Object.keys(cells).map((key) => [key, cells[key].subarray(0, 0)]));
const slice = (cells, a, b) => Object.fromEntries(FIELDS.map((key) => [key, cells[key].subarray(a, b)]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");
const pyFloor = (x) => Math.floor(x); // Python's // on floats
const isoOfMs = (ms) => new Date(EPOCH_MS + ms).toISOString().replace("Z", "000Z"); // microsecond form of a whole millisecond

// totals(cells): the four totals over the cells, volumes summed exactly.
function totals(cells) {
  let trades = 0, buyTrades = 0;
  for (let i = 0; i < cells.cnt.length; i++) {
    trades += cells.cnt[i];
    buyTrades += cells.tbcnt[i];
  }
  return { volume: fsum(cells.vol), taker_buy_volume: fsum(cells.tbvol), trade_count: trades, taker_buy_trade_count: buyTrades };
}

// pointOfControl(cells, field, m): the centre of the price row with the most volume, from exact row sums; the lower
// row wins a tie and there is none without volume, as the cube defines it.
function pointOfControl(cells, field, m) {
  if (!cells.row.length) return null;
  const rows = new Map();
  for (let i = 0; i < cells.row.length; i++) {
    const list = rows.get(cells.row[i]);
    if (list) list.push(cells[field][i]);
    else rows.set(cells.row[i], [cells[field][i]]);
  }
  const order = [...rows.keys()].sort((a, b) => a - b);
  const sums = order.map((row) => fsum(rows.get(row)));
  let best = -Infinity;
  for (const sum of sums) if (sum > best) best = sum;
  if (best <= 0) return null;
  return (order[sums.indexOf(best)] + 0.5) * BASE_PRICE * 2 ** m;
}

// merge(cells, extra, n, m): the cells with base cells `extra` added into their level-(n, m) cells; a cell hit by more
// than one addend is summed exactly.
function merge(cells, extra, n, m) {
  if (!extra.col.length) return cells;
  const grown = {};
  for (const key of FIELDS) {
    const add = key === "col" ? Array.from(extra.col, (c) => Math.floor(c / 2 ** n)) : key === "row" ? Array.from(extra.row, (r) => Math.floor(r / 2 ** m)) : extra[key];
    grown[key] = Array.from(cells[key]).concat(Array.from(add));
  }
  const order = grown.col.map((_, i) => i).sort((a, b) => grown.col[a] - grown.col[b] || grown.row[a] - grown.row[b] || a - b);
  const groups = [];
  for (const i of order) {
    const last = groups[groups.length - 1];
    if (last && grown.col[last[0]] === grown.col[i] && grown.row[last[0]] === grown.row[i]) last.push(i);
    else groups.push([i]);
  }
  const out = { vol: [], tbvol: [], cnt: [], tbcnt: [], col: [], row: [] };
  for (const g of groups) {
    out.col.push(grown.col[g[0]]);
    out.row.push(grown.row[g[0]]);
    for (const field of ["vol", "tbvol", "cnt", "tbcnt"]) out[field].push(g.length > 1 ? fsum(g.map((i) => grown[field][i])) : grown[field][g[0]]);
  }
  return {
    vol: Float64Array.from(out.vol), tbvol: Float64Array.from(out.tbvol), cnt: Float64Array.from(out.cnt), tbcnt: Float64Array.from(out.tbcnt),
    col: Uint32Array.from(out.col), row: Uint32Array.from(out.row),
  };
}

// rowsTouched(col, row, vol): each column's USDT and how many rows its trades touched, from cells at 125 USDT rows: the rows
// its cells hold; given parent columns (col >> 1), the rows across both a parent's columns, each counted once.
function rowsTouched(col, row, vol) {
  if (!col.length) return { col: [], rows: [], volume: [] };
  const order = Array.from(col, (_, i) => i).sort((a, b) => col[a] - col[b] || row[a] - row[b] || a - b);
  const out = { col: [], rows: [], volume: [] };
  let i = 0;
  while (i < order.length) {
    const c = col[order[i]];
    const volumes = [];
    let rows = 0, lastRow = -1;
    for (; i < order.length && col[order[i]] === c; i++) {
      const r = row[order[i]];
      if (r !== lastRow) rows++;
      lastRow = r;
      volumes.push(vol[order[i]]);
    }
    out.col.push(c);
    out.rows.push(rows);
    out.volume.push(fsum(volumes));
  }
  return out;
}

// columnsOf(cells): each column of the cells: its volume, taker-buy volume (both f32 in the answer) and POC row (the lower row on a tie).
function columnsOf(cells) {
  const out = { col: [], poc: [], vol: [], tbvol: [] };
  let i = 0;
  while (i < cells.col.length) {
    const c = cells.col[i];
    let best = -Infinity, first = i, v = 0, bv = 0;
    for (; i < cells.col.length && cells.col[i] === c; i++) {
      if (cells.vol[i] > best) {
        best = cells.vol[i];
        first = i;
      }
      v += cells.vol[i];
      bv += cells.tbvol[i];
    }
    out.col.push(c);
    out.poc.push(cells.row[first]);
    out.vol.push(v);
    out.tbvol.push(bv);
  }
  return out;
}

// tails(old, new): the new pack's tiers as what a page holding the old pack lacks, or null when it can't be. The old pack must be a prefix of the
// new: every partition it read is unchanged, and the columns the page keeps (from the new tier's first column up to the one holding the old
// tier's end edge) hold the same cells in both: identical trade counts, columns and rows, and volumes to within VOLUME_ROUNDING (numpy allclose
// with atol 0, i.e. |was - now| <= 1e-12 * |now|, so a `now` of zero needs an exact zero). The old open column is always re-sent.
function tails(old, next) {
  for (const [key, identity] of Object.entries(old.pins)) if (!same(next.pins[key], identity)) return null;
  const blocks = {};
  for (const tier of TIERS) {
    const before = old.tiers[tier.id];
    const after = next.tiers[tier.id];
    const meta = after.block;
    const first = pyFloor(before.block.b1 / 2 ** tier.n);
    const kept = [before, after].map((side) => [lowerBound(side.cells.col, meta.col0), lowerBound(side.cells.col, first)]);
    const was = slice(before.cells, kept[0][0], kept[0][1]);
    const now = slice(after.cells, kept[1][0], kept[1][1]);
    const identical = ["col", "row", "cnt", "tbcnt"].every((key) => was[key].length === now[key].length && was[key].every((v, i) => v === now[key][i]));
    if (!identical) return null;
    for (const key of ["vol", "tbvol"]) {
      for (let i = 0; i < was[key].length; i++) {
        if (!(Math.abs(was[key][i] - now[key][i]) <= 0 + VOLUME_ROUNDING * Math.abs(now[key][i]))) return null;
      }
    }
    blocks[tier.id] = { ...meta, from: first, gzip_base64: wire.msc2(tier.n, tier.m, meta.col0, meta.col1, after.cells, kept[1][1]) };
  }
  return blocks;
}

// ---- summaries (cube_summary, merged_summary) ----

// cubeSummary(summary, response, n, m): the cube's own summary of a rectangle, as the page reads it.
function cubeSummary(summary, response, n, m) {
  return {
    t1: summary.t1 ?? null, t2: summary.t2 ?? null, p1: summary.p1 ?? null, p2: summary.p2 ?? null, tR: BASE_SECONDS * 2 ** n, pR: BASE_PRICE * 2 ** m,
    first_column_partial: Boolean(summary.first_column_partial), last_column_partial: Boolean(summary.last_column_partial),
    first_row_partial: Boolean(summary.first_row_partial), last_row_partial: Boolean(summary.last_row_partial),
    last_column_unfinished: Boolean(summary.last_column_unfinished),
    volume: summary.volume, trade_count: Math.trunc(summary.trade_count), taker_buy_volume: summary.taker_buy_volume,
    taker_buy_trade_count: Math.trunc(summary.taker_buy_trade_count), poc: summary.poc ?? null, taker_buy_poc: summary.taker_buy_poc ?? null,
    cell_count: Math.trunc(summary.cell_count ?? 0), source: "cube",
  };
}

// mergedSummary(...): the summary of a rectangle whose open column came from the pack, computed the way the cube computes its own: exact sums over the
// cells, and POCs from exact row sums.
function mergedSummary(cells, n, m, b0, b1, r0, r1, summary, extent, cutoff) {
  let p1, p2;
  if (r0 !== null) {
    p1 = r0 * BASE_PRICE;
    p2 = r1 * BASE_PRICE;
  } else {
    // Automatic prices: the cube's extent over the closed part, grown by the open column's.
    let low = summary === null || summary.p1 == null ? null : summary.p1 / BASE_PRICE;
    let high = summary === null || summary.p2 == null ? null : summary.p2 / BASE_PRICE;
    if (extent) {
      low = low === null ? extent[0] : Math.min(low, extent[0]);
      high = high === null ? extent[1] : Math.max(high, extent[1]);
    }
    p1 = low === null ? null : low * BASE_PRICE;
    p2 = high === null ? null : high * BASE_PRICE;
  }
  const stepP = BASE_PRICE * 2 ** m;
  return {
    t1: wire.iso(b0), t2: wire.iso(b1), p1, p2, tR: BASE_SECONDS * 2 ** n, pR: stepP,
    first_column_partial: b0 % 2 ** n !== 0, last_column_partial: b1 % 2 ** n !== 0,
    first_row_partial: p1 !== null && p1 % stepP !== 0, last_row_partial: p2 !== null && p2 % stepP !== 0,
    last_column_unfinished: b1 > cutoff,
    ...totals(cells), poc: pointOfControl(cells, "vol", m), taker_buy_poc: pointOfControl(cells, "tbvol", m),
    cell_count: cells.col.length, source: "cube+pack",
  };
}

const summaryTotals = (summary) => ({
  volume: summary.volume, buyVolume: summary.taker_buy_volume, trades: summary.trade_count, buyTrades: summary.taker_buy_trade_count,
});

// ---- the cube (stands in for Origo's market state cube) ----

// A Cube is the LIVE store a bridge reads: trades, a cutoff, per-day pins and a motion coverage. Its mutations (advance, revise, setCanonical) change
// what later reads see at once; a pack already built keeps what it read (the bridge's held packs), which is what makes a stale token detectable.
class Cube {
  constructor({ store, cutoffMs, canonicalThroughMs, extend, maxCells = MAX_CELLS }) {
    this.store = store;
    this.cutoffMs = cutoffMs;
    this.canonicalMs = canonicalThroughMs;
    this.extend = extend;
    this.maxCells = maxCells;
    this.revisions = new Map(); // UTC day -> how often it was revised
    this.coverage = null; // base position up to which motion and bars are measured (null: to the cutoff)
    this.barOverrides = new Map(); // n -> bars {open, ...}
    this.corruption = null; // {dwell?, path?, volume?}: values written into the first cell of every motion block
  }

  get cutoffIso() {
    return isoOfMs(this.cutoffMs);
  }

  get canonicalIso() {
    return this.canonicalMs === null ? null : isoOfMs(this.canonicalMs);
  }

  // The cube's answer envelope: what the bridge reads as `response` (data_cutoff, canonical_through).
  response() {
    return { data_cutoff: this.cutoffIso, canonical_through: this.canonicalIso };
  }

  // One partition per UTC day: `day:YYYY-MM-DD` once the archive has the whole day, else `prov:YYYY-MM-DD` (its minutes are provisional). The
  // identity is [revision, build]: revise() moves the revision, and a day that becomes canonical is a NEW key (the old one vanishes), which is how the
  // bridge sees "a provisional minute replaced by an archive day".
  pin(day) {
    const canonical = this.canonicalMs === null || (day + 1) * DAY_MS <= this.canonicalMs;
    const date = new Date(EPOCH_MS + day * DAY_MS).toISOString().slice(0, 10);
    return [`${canonical ? "day" : "prov"}:${date}`, [this.revisions.get(day) ?? 0, canonical ? 1 : 0]];
  }

  // The pins of the days that have trades among base columns [b0, b1).
  pinsFor(b0, b1) {
    const days = this.store.days();
    const d0 = Math.floor(b0 / DAY);
    const d1 = Math.floor((Math.ceil(b1) - 1) / DAY);
    const out = {};
    for (let i = lowerBound(days, d0); i < days.length && days[i] <= d1; i++) {
      const [key, identity] = this.pin(days[i]);
      out[key] = identity;
    }
    return out;
  }

  // read(n, m, b0, b1, r0, r1, motion): the cube's level-(n, m) cells over base columns [b0, b1) (null: to the cutoff) and base rows [r0, r1)
  // (null: all), its response, its summary and the pins it read. With motion the cells carry path, dwell, high and low and include the cells the price
  // moved through or held in without trading; measures end at `coverage`.
  read(n, m, b0, b1, r0 = null, r1 = null, motion = false) {
    const top = Math.ceil(this.cutoffMs / BASE_MS);
    let hi = b1 === null ? top : b1;
    let response = this.response();
    let cells;
    if (motion) {
      if (this.coverage !== null) {
        if (this.coverage < b0) throw new MarketStateError(409, { error: "outside_coverage", data_cutoff: wire.iso(this.coverage) });
        response = { ...response, data_cutoff: wire.iso(Math.min(this.coverage, this.cutoffMs / BASE_MS)) };
        hi = Math.min(hi, this.coverage);
      }
      cells = this.store.motionCells({ n, m, b0, b1: hi, r0, r1, dataEndMs: this.cutoffMs });
      if (this.corruption) cells = this.corrupted(cells);
    } else {
      const base = this.store.cells();
      cells = aggregate(base, n, m, lowerBound(base.col, b0), lowerBound(base.col, hi), r0, r1);
    }
    if (cells.col.length > this.maxCells) throw new ValueError(`${cells.col.length} cells is more than ${this.maxCells}; ask for coarser cells`);
    return { response, cells, summary: this.summarize(cells, n, m, b0, hi, r0, r1, motion), pins: this.pinsFor(b0, hi) };
  }

  // The cube's summary of what it read (the Origo summary table): exact totals and POCs, the bounds it applied and whether its edges cut cells.
  summarize(cells, n, m, b0, b1, r0, r1, motion) {
    const stepP = BASE_PRICE * 2 ** m;
    let p1 = null, p2 = null;
    if (r0 !== null) {
      p1 = r0 * BASE_PRICE;
      p2 = r1 * BASE_PRICE;
    } else if (cells.row.length) {
      let low = Infinity, high = -Infinity; // automatic prices: the extent of the cells, on level rows (a loop: spread arguments overflow at ~100k cells)
      for (const row of cells.row) {
        if (row < low) low = row;
        if (row > high) high = row;
      }
      p1 = low * stepP;
      p2 = (high + 1) * stepP;
    }
    const summary = {
      t1: wire.iso(b0), t2: wire.iso(b1), p1, p2,
      first_column_partial: b0 % 2 ** n !== 0, last_column_partial: b1 % 2 ** n !== 0,
      first_row_partial: p1 !== null && p1 % stepP !== 0, last_row_partial: p2 !== null && p2 % stepP !== 0, last_column_unfinished: false,
      ...totals(cells), poc: pointOfControl(cells, "vol", m), taker_buy_poc: pointOfControl(cells, "tbvol", m), cell_count: cells.col.length,
    };
    if (motion) {
      summary.path_length = fsum(cells.path);
      summary.dwell = fsum(cells.dwell);
    }
    return summary;
  }

  // corrupt({dwell, path, volume}): a validation-failure input: the first cell of every motion block carries these values instead
  // (a negative or impossible dwell, say), so typed invalid-input tests have something real to reject.
  corrupted(cells) {
    if (!cells.col.length) return cells;
    const out = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.slice()]));
    for (const [field, key] of [["dwell", "dwell"], ["path", "path"], ["volume", "vol"]]) {
      if (this.corruption[field] !== undefined) out[key][0] = this.corruption[field];
    }
    return out;
  }

  // barRead(n, b0, b1): the cube's bars at level n over base columns [b0, b1): its response and the bars, with the pins it read.
  barRead(n, b0, b1) {
    let response = this.response();
    let hi = b1;
    if (this.coverage !== null) {
      if (this.coverage < b0) throw new MarketStateError(409, { error: "outside_coverage", data_cutoff: wire.iso(this.coverage) });
      response = { ...response, data_cutoff: wire.iso(Math.min(this.coverage, this.cutoffMs / BASE_MS)) };
      hi = Math.min(hi, this.coverage);
    }
    let bars;
    if (this.barOverrides.has(n)) {
      const set = this.barOverrides.get(n);
      const keep = [];
      for (let i = 0; i < set.col.length; i++) if (set.col[i] * 2 ** n >= b0 && set.col[i] * 2 ** n < hi) keep.push(i);
      bars = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, (k === "col" ? Uint32Array : Float64Array).from(keep.map((i) => v[i]))]));
    } else {
      bars = this.store.bars({ n, b0, b1: hi });
    }
    return { response, bars, pins: this.pinsFor(b0, hi) };
  }

  // ---- mutations ----

  advance(toMs, trades = null) {
    if (toMs <= this.cutoffMs) throw new RangeError(`advance to ${toMs} ms does not move the cutoff (${this.cutoffMs} ms)`);
    if (toMs % 60000 !== 0) throw new RangeError("the cutoff is a minute edge");
    if (trades) {
      for (const t of trades) {
        const at = t.t ?? t.t_ms;
        if (at <= this.cutoffMs || at > toMs) throw new RangeError(`trade at ${at} ms is outside (${this.cutoffMs}, ${toMs}]`);
      }
      this.store.append(trades);
    } else {
      this.extend(this.store, this.cutoffMs, toMs);
    }
    this.cutoffMs = toMs;
  }

  // revise({day | col, factor, count}): a real revision of one UTC day: quantities x factor, `count` more executions per trade, and the day's pin moves.
  revise({ day, col, factor = 1.01, count = 0 }) {
    const d = day !== undefined ? (typeof day === "string" ? Math.floor((Date.parse(`${day}T00:00:00Z`) - EPOCH_MS) / DAY_MS) : day) : Math.floor(col / DAY);
    if (!Number.isInteger(d)) throw new RangeError("revise: name a UTC day (YYYY-MM-DD or index) or a base column");
    const touched = this.store.scaleDay(d, factor, count);
    if (!touched) throw new RangeError(`revise: the day ${d} has no trades`);
    this.revisions.set(d, (this.revisions.get(d) ?? 0) + 1);
  }

  setCanonical(ms) {
    this.canonicalMs = ms === null ? null : Math.min(ms, this.cutoffMs);
  }
}

// ---- the bridge (Explorer) ----

class Bridge {
  constructor(cube, { label, packsHeld = PACKS_HELD, quiet = 2, next = 3, pageVersion = "fake-page-1" } = {}) {
    this.cube = cube;
    this.label = label;
    this.packsHeld = packsHeld;
    this.quiet = quiet;
    this.nextSeconds = next;
    this.pageVersion = pageVersion;
    this.salt = 0;
    this.clock = 0; // seconds, advanced only by the fake's advance(): the injected clock of DD-T09
    this.pack = null;
    this.packedAt = 0;
    this.stale = true; // no pack yet, or the cube moved past it: the next current_pack() builds one at once (event driven, not clock driven)
    this.held = new Map(); // pack token -> {pins, tiers {block, cells}, cutoff, state}
    this.motions = new Map();
    this.touches = new Map();
    this.barAnswers = new Map();
  }

  // ---- packs ----

  // pack(): the three tiers as one consistent pack, every pin the pack read, and each tier's cells. (No retry loop: nothing changes while a
  // synchronous pack is read.)
  buildPack() {
    const cube = this.cube;
    const overview = cube.read(12, 3, 0, null);
    const state = overview.response;
    const cutoff = wire.baseUnits(state.data_cutoff);
    const top = Math.ceil(cutoff);
    const pinned = {};
    for (const key of Object.keys(overview.pins).sort()) pinned[key] = overview.pins[key];
    const blocks = { overview: wire.block(12, 3, 0.0, cutoff, overview.cells) };
    const cells = { overview: overview.cells };
    blocks.overview.totals = summaryTotals(overview.summary);
    for (const tier of TIERS.slice(1)) {
      const step = 2 ** tier.n;
      const b1 = tier.complete ? Math.floor(cutoff) - (Math.floor(cutoff) % 16) : top;
      const b0 = Math.max(0, pyFloor((b1 - tier.days * DAY) / step) * step);
      const read = cube.read(tier.n, tier.m, b0, b1);
      blocks[tier.id] = wire.block(tier.n, tier.m, b0, Math.min(b1, cutoff), read.cells);
      blocks[tier.id].totals = summaryTotals(read.summary);
      cells[tier.id] = read.cells;
    }
    // The cutoff is digested too: a pack whose data advanced always carries a new token. The salt moves only when the fake is asked for
    // a rebuild (same content, new token).
    const digest = sha256(JSON.stringify([state.data_cutoff, Object.entries(pinned), this.salt]));
    return {
      pack: {
        source: this.label, t0: T0, base_seconds: BASE_SECONDS, base_price: BASE_PRICE, cutoff: state.data_cutoff, cutoffBase: cutoff,
        data_cutoff: state.data_cutoff, canonical_through: state.canonical_through, state_token: digest, partitions: Object.keys(pinned).length,
        snapshot: false, live: true, notes: [this.label, ...NOTES], blocks,
      },
      pinned,
      cells,
    };
  }

  // current_pack(): the current pack and its age in seconds, rebuilt when a mutation or a read found the cube had moved past it.
  currentPack() {
    if (this.pack !== null && !this.stale) return [this.pack, this.clock - this.packedAt];
    const { pack, pinned, cells } = this.buildPack();
    const tiers = Object.fromEntries(Object.entries(pack.blocks).map(([key, meta]) => [key, {
      block: Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "gzip_base64")), cells: cells[key],
    }]));
    this.pack = pack;
    this.stale = false;
    // A token built again moves to the end, so the oldest held pack is always first.
    this.held.delete(pack.state_token);
    this.held.set(pack.state_token, {
      pins: pinned, tiers, cutoff: pack.cutoffBase,
      // The pack's state, without its payloads: sixteen packs stay small.
      state: { cutoff: pack.cutoff, data_cutoff: pack.data_cutoff, canonical_through: pack.canonical_through, state_token: pack.state_token },
    });
    this.trim();
    this.packedAt = this.clock;
    return [pack, 0.0];
  }

  trim() {
    while (this.held.size > this.packsHeld) this.held.delete(this.held.keys().next().value);
  }

  // timing(age): the pack's age, how long the cube has had no new data (fixed: `quiet`), when a page should next ask (fixed: `next`), and the page
  // this server serves (a constant unless the fake is told to change it).
  timing(age) {
    return { age: Math.round(age * 10) / 10, quiet: this.quiet, next: this.nextSeconds, page: this.pageVersion };
  }

  // update(since): what a page holding pack `since` needs to hold the current pack.
  update(since) {
    const [current, age] = this.currentPack();
    const token = current.state_token;
    if (since === token) return { status: "current", state_token: token, ...this.timing(age) };
    const old = this.held.get(since);
    const now = this.held.get(token);
    const blocks = old && now ? tails(old, now) : null;
    if (blocks === null) return { status: "pack", pack: current, ...this.timing(age) };
    const fields = ["cutoff", "cutoffBase", "data_cutoff", "canonical_through", "state_token", "partitions"];
    return { status: "delta", ...Object.fromEntries(fields.map((key) => [key, current[key]])), blocks, ...this.timing(age) };
  }

  holding(token) {
    const held = this.held.get(token);
    if (held === undefined) throw new CubeChanged("the page's pack is no longer held by the server");
    return held;
  }

  // check(pins, held, token): every partition read must be one the page's pack read, at the same identity.
  check(pins, held, token) {
    const changed = Object.keys(pins).filter((key) => !same(held.pins[key], pins[key]));
    if (changed.length) {
      // The newest pack is behind the cube: the page's next ask gets a new one.
      if (this.pack !== null && this.pack.state_token === token) this.stale = true;
      throw new CubeChanged(`${changed.length} partition(s) differ from the page's pack, first ${changed[0]}`);
    }
  }

  // ---- reads ----

  // rectangle_cells(spec, token): one rectangle's level-(n, m) cells for the page holding pack `token`: read from the cube up to the last complete base
  // column before the pack's cutoff, and the open column, when the rectangle reaches it, from the pack's own, so they are the state the page holds even
  // after the cube has moved on.
  rectangleCells(spec, token) {
    const { n, m, b0, b1, r0, r1 } = spec;
    const held = this.holding(token);
    const cutoff = held.cutoff;
    const closed = Math.floor(cutoff);
    const top = Math.ceil(cutoff);
    if (b1 > top) throw new ValueError("b1 is after the pack's cutoff");
    const stop = Math.min(b1, closed);
    let cells = null, summary = null, response = null;
    if (b0 < stop) {
      const read = this.cube.read(n, m, b0, stop, r0, r1);
      ({ response, cells, summary } = read);
      this.check(read.pins, held, token);
    }
    const opened = b1 > closed && top > closed;
    let extent = null;
    if (opened || summary === null) {
      if (cells === null) cells = empty(slice(held.tiers.recent.cells, 0, 0));
      let extra = empty(slice(cells, 0, 0));
      if (opened) {
        const recent = held.tiers.recent.cells;
        const keep = [];
        for (let i = 0; i < recent.col.length; i++) if (recent.col[i] === closed && (r0 === null || (recent.row[i] >= r0 && recent.row[i] < r1))) keep.push(i);
        extra = Object.fromEntries(FIELDS.map((key) => [key, (key === "col" || key === "row" ? Uint32Array : Float64Array).from(keep.map((i) => recent[key][i]))]));
        if (extra.row.length) extent = [Math.min(...extra.row), Math.max(...extra.row) + 1];
      }
      cells = merge(cells, extra, n, m);
    }
    return { cells, held, response, summary, opened, extent };
  }

  // measure(spec, token): the cube's cells and summary for one rectangle, for the page holding pack `token`.
  measure(spec, token) {
    const { n, m, b0, b1, r0, r1 } = spec;
    const { cells, held, response, summary, opened, extent } = this.rectangleCells(spec, token);
    const cutoff = held.cutoff;
    const top = Math.ceil(cutoff);
    const answer = !opened && summary !== null
      ? cubeSummary(summary, response, n, m)
      : mergedSummary(cells, n, m, b0, opened ? top : b1, r0, r1, summary, extent, cutoff);
    const end = Math.min(opened ? top : b1, cutoff);
    const state = held.state;
    Object.assign(answer, { data_cutoff: state.data_cutoff, canonical_through: state.canonical_through, state_token: state.state_token });
    return { cutoff: state.cutoff, block: wire.block(n, m, b0, end, cells), summary: answer };
  }

  // touched(n, b0, b1, token): each column's USDT and the 125 USDT rows its trades touched, at level n and one level up, over base columns [b0, b1).
  // Kept per pack and span, as a page asks each chunk once; a cached answer is served without asking whether the pack is still held.
  touched(n, b0, b1, token) {
    const key = JSON.stringify([token, n, b0, b1]);
    const hit = this.touches.get(key);
    if (hit !== undefined) return hit;
    const { cells, held } = this.rectangleCells({ n, m: 0, b0, b1, r0: null, r1: null }, token);
    const answer = {
      n, b0, b1, cutoff: held.state.cutoff,
      columns: rowsTouched(cells.col, cells.row, cells.vol),
      parents: rowsTouched(Array.from(cells.col, (c) => Math.floor(c / 2)), cells.row, cells.vol),
    };
    this.touches.set(key, answer);
    while (this.touches.size > TOUCHES_HELD) this.touches.delete(this.touches.keys().next().value);
    return answer;
  }

  // history(n, m, token): each complete column's POC row, volume and taker-buy volume at level (n, m), for up to the last HISTORY_COLUMNS columns before
  // the pack's cutoff (MSCC).
  history(n, m, token) {
    const held = this.holding(token);
    const step = 2 ** n;
    const end = pyFloor(Math.floor(held.cutoff) / step) * step;
    const start = Math.max(0, end - HISTORY_COLUMNS * step);
    let cols = columnsOf(empty(slice(held.tiers.recent.cells, 0, 0)));
    if (start < end) {
      const read = this.cube.read(n, m, start, end);
      this.check(read.pins, held, token);
      cols = columnsOf(read.cells);
    }
    const payload = wire.mscc(n, m, start / step, end / step, cols);
    return {
      cutoff: held.state.cutoff,
      columns: { n, m, b0: start, b1: end, count: cols.col.length, layout: "MSCC", gzip_base64: payload },
    };
  }

  // motion_read(...): level-(n, m) cells with path, dwell, high and low over base columns [b0, b1), checked against the page's pack: the cells, the cube's
  // response and summary, and where the measures end: b1, or earlier where the cube's coverage of them ends.
  motionRead(n, m, b0, b1, held, token, r0 = null, r1 = null) {
    if (b0 >= b1) return { cells: this.noCells(), response: null, summary: null, end: b0 };
    let read;
    try {
      read = this.cube.read(n, m, b0, b1, r0, r1, true);
    } catch (error) {
      // The cube hasn't measured this time yet: nothing, measured up to where it has.
      if (error instanceof MarketStateError && error.status === 409 && error.body.error === "outside_coverage") {
        return { cells: this.noCells(), response: null, summary: null, end: Math.min(b0, wire.baseUnits(String(error.body.data_cutoff))) };
      }
      throw error;
    }
    this.check(read.pins, held, token);
    return { cells: read.cells, response: read.response, summary: read.summary, end: Math.min(b1, wire.baseUnits(read.response.data_cutoff)) };
  }

  noCells() {
    return {
      vol: new Float64Array(0), tbvol: new Float64Array(0), cnt: new Float64Array(0), tbcnt: new Float64Array(0), path: new Float64Array(0),
      dwell: new Float64Array(0), high: new Float64Array(0), low: new Float64Array(0), col: new Uint32Array(0), row: new Uint32Array(0),
    };
  }

  // bars(n, b0, b1, token): bars at level n over base columns [b0, b1) for the page holding pack `token`, up to the pack's last complete base column, or where
  // the cube's measures end: `end`, a base position. Kept per pack and span (a cached answer is served even after the pack is no longer held).
  bars(n, b0, b1, token) {
    const key = JSON.stringify([token, n, b0, b1]);
    const hit = this.barAnswers.get(key);
    if (hit !== undefined) return hit;
    const held = this.holding(token);
    const cutoff = held.cutoff;
    if (b1 > Math.ceil(cutoff)) throw new ValueError("b1 is after the pack's cutoff");
    const stop = Math.min(b1, Math.floor(cutoff));
    let bars = { open: [], high: [], low: [], close: [], vol: [], tbvol: [], btc: [], cnt: [], col: [] };
    let end = b0;
    if (b0 < stop) {
      try {
        const read = this.cube.barRead(n, b0, stop);
        bars = read.bars;
        this.check(read.pins, held, token);
        end = Math.min(stop, wire.baseUnits(read.response.data_cutoff));
      } catch (error) {
        // The cube hasn't measured this time yet: no bars, measured up to where it has.
        if (!(error instanceof MarketStateError && error.status === 409 && error.body.error === "outside_coverage")) throw error;
        end = Math.min(b0, wire.baseUnits(String(error.body.data_cutoff)));
      }
    }
    const step = 2 ** n;
    const col0 = Math.floor(b0 / step);
    const col1 = Math.max(col0, Math.ceil(Math.ceil(end) / step));
    const answer = {
      n, b0, b1, end, through: wire.iso(end), state_token: token, cutoff: held.state.cutoff, canonical_through: held.state.canonical_through,
      bars: { n, col0, col1, count: bars.col.length, layout: "MSCB", encoding: "gzip+base64", gzip_base64: wire.mscb(n, col0, col1, bars) },
    };
    this.barAnswers.set(key, answer);
    while (this.barAnswers.size > BARS_HELD) this.barAnswers.delete(this.barAnswers.keys().next().value);
    return answer;
  }

  // motion(tierId, token, start): one tier of the page's pack with path, dwell, high and low (MSC3), up to the pack's last complete base column: the whole tier,
  // or its columns from the one holding base edge `start` on, which the page puts in place of its own from that column.
  motion(tierId, token, start) {
    const tier = TIERS.find((t) => t.id === tierId);
    if (!tier) throw new ValueError("tier must be overview, recent or reference");
    const held = this.holding(token);
    const { n, m } = tier;
    const step = 2 ** n;
    const meta = held.tiers[tierId].block;
    const closed = Math.floor(held.cutoff);
    const stop = tier.complete ? closed - (closed % step) : closed;
    const first = start === null ? Math.trunc(meta.b0) : Math.max(Math.trunc(meta.b0), pyFloor(start / step) * step);
    const key = JSON.stringify([token, tierId, first]);
    const hit = this.motions.get(key);
    if (hit !== undefined) return hit;
    const { cells, end } = this.motionRead(n, m, first, stop, held, token);
    const motionBlock = wire.block(n, m, first, Math.max(first, end), cells, true);
    const answer = {
      tier: tierId, col0: meta.col0, from: pyFloor(first / step), whole: first === Math.trunc(meta.b0), end, through: wire.iso(end), state_token: token,
      canonical_through: held.state.canonical_through, block: motionBlock,
    };
    this.motions.set(key, answer);
    while (this.motions.size > MOTION_HELD) this.motions.delete(this.motions.keys().next().value);
    return answer;
  }

  // motion_measure(spec, token, summarized): one rectangle's cells with path, dwell, high and low (MSC3), up to the last complete base column before the
  // pack's cutoff, and with `summarized` the cube's summary of them.
  motionMeasure(spec, token, summarized) {
    const { n, m, b0, b1, r0, r1 } = spec;
    const held = this.holding(token);
    const cutoff = held.cutoff;
    if (b1 > Math.ceil(cutoff)) throw new ValueError("b1 is after the pack's cutoff");
    const { cells, response, summary, end } = this.motionRead(n, m, b0, Math.min(b1, Math.floor(cutoff)), held, token, r0, r1);
    const answer = {
      cutoff: held.state.cutoff, end, through: wire.iso(end), canonical_through: held.state.canonical_through,
      block: wire.block(n, m, b0, Math.max(b0, end), cells, true),
    };
    if (summarized) {
      answer.summary = summary !== null
        ? { ...cubeSummary(summary, response, n, m), path_length: summary.path_length, dwell: summary.dwell }
        : { path_length: 0.0, dwell: 0.0, cell_count: 0, source: "cube" };
    }
    return answer;
  }
}

// ---- request validation (Handler.integer, level, rectangle) ----

// parse_qs semantics: percent-decoded, blank values dropped, first value wins.
function queryArgs(search) {
  const args = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (value === "") continue;
    (args[key] ??= []).push(value);
  }
  return args;
}

// integer(args, key): float(value).is_integer(), so "3.0" and "1e3" pass; anything else is 400 "<key> must be an integer".
function integer(args, key) {
  const text = args[key]?.[0];
  const ok = typeof text === "string" && /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(text);
  const value = ok ? Number(text) : NaN;
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw new ValueError(`${key} must be an integer`);
  return value;
}

function level(args) {
  const n = integer(args, "n");
  const m = integer(args, "m");
  if (!(n >= 0 && n <= MAX_TIME_EXPONENT && m >= 0 && m <= MAX_PRICE_EXPONENT)) throw new ValueError(`n must be 0..${MAX_TIME_EXPONENT} and m 0..${MAX_PRICE_EXPONENT}`);
  return [n, m];
}

// rectangle(args, prices): a rectangle in base columns and rows, checked: at most MAX_COLUMNS columns wide.
function rectangle(args, prices) {
  const [n, m] = level(args);
  const b0 = integer(args, "b0");
  const b1 = integer(args, "b1");
  if (!(b0 >= 0 && b0 < b1)) throw new ValueError("b0 and b1 must be base edges with b0 < b1");
  if (Math.ceil(b1 / 2 ** n) - Math.floor(b0 / 2 ** n) > MAX_COLUMNS) throw new ValueError(`more than ${MAX_COLUMNS} columns`);
  let r0 = null, r1 = null;
  if (prices && ("r0" in args || "r1" in args)) {
    r0 = integer(args, "r0");
    r1 = integer(args, "r1");
    if (!(r0 >= 0 && r0 < r1 && r1 <= 2 ** 32)) throw new ValueError("r0 and r1 must be base rows with r0 < r1");
  }
  return { n, m, b0, b1, r0, r1 };
}

// injectPack(text, data): the page with the pack in place of the recorded snapshot. The bridge replaces the first match (count = 1), so a page with
// two blocks would silently pass; the fake counts them all and fails on anything but exactly one, so a build that duplicates or drops the block is
// caught by the first test that loads the page (map gotcha 20). The message is the bridge's, raised as a RuntimeError the handler turns into a 502.
function injectPack(text, data) {
  const pattern = /(<script type="application\/json" id="origo-lens-data">)[\s\S]*?(<\/script>)/g;
  const hits = text.match(pattern);
  if (!hits || hits.length !== 1) {
    const error = new Error("index.html has no origo-lens-data block; run tools/build.py first.");
    error.name = "RuntimeError";
    throw error;
  }
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return text.replace(pattern, (match, open, close) => open + json + close);
}

module.exports = {
  PACK_MAX_AGE_SECONDS, PACKS_HELD, MOTION_HELD, TOUCHES_HELD, BARS_HELD, BAR_LEVELS, VOLUME_ROUNDING, MAX_COLUMNS, MAX_CELLS, HISTORY_COLUMNS,
  MAX_TIME_EXPONENT, MAX_PRICE_EXPONENT, PROTOCOL, OUTDATED, FIELDS, TIERS, NOTES,
  ValueError, CubeChanged, MarketStateError, fsum, totals, pointOfControl, merge, rowsTouched, columnsOf, tails, cubeSummary, mergedSummary,
  Cube, Bridge, queryArgs, integer, level, rectangle, injectPack, isoOfMs, TradeStore,
};
