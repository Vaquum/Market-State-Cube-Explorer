"use strict";
// tests/reference/snapshot.js (H3): an independent decoder of data/snapshot.json (layout MSC1) and an exact aggregator.
//
// The recorded snapshot is the only real market data in the repository, and it holds only the measures of MSC1: volume,
// taker-buy volume and the two trade counts per base cell, nothing else (no path, dwell, high, low, bars). Tests on it
// therefore cover exactly those measures (U08); anything that needs more uses the synthetic sequences of
// tests/fixtures/trades/ and never a number derived from these aggregates.
//
// This file re-implements the wire layout of maps/bridge-fake-cube.md 1.3 from the layout table only: node:zlib, a DataView
// and BigInt. It imports nothing from src/, tests/support/ or vendor/ (tests/unit/independence.test.js), so it is a second
// decoder next to the page's own (`unpack` in src/explorer.js) and next to the Python one in golden.py that pinned the cells.
//
//   header  32 bytes, little endian: magic "MSC1" (4), n u8, m u8, pad u16, col0 u32, col1 u32, count u32, 12 zero bytes
//   arrays  each `count` long, back to back: vol f64, tbvol f64, col u32, row u32, ct u32, bt u32
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const R = require("./rational.js");

const SNAPSHOT_FILE = path.resolve(__dirname, "..", "..", "data", "snapshot.json");
const LAYOUT = [["vol", "f64"], ["tbvol", "f64"], ["col", "u32"], ["row", "u32"], ["ct", "u32"], ["bt", "u32"]];

// decodeMsc1(base64Text) -> {magic, n, m, col0, col1, count, length, vol, tbvol, col, row, ct, bt}: typed arrays in fresh aligned buffers.
function decodeMsc1(text) {
  const bytes = zlib.gunzipSync(Buffer.from(text, "base64"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "MSC1") throw new RangeError(`not an MSC1 block: magic ${JSON.stringify(magic)}`);
  const out = { magic, n: dv.getUint8(4), m: dv.getUint8(5), col0: dv.getUint32(8, true), col1: dv.getUint32(12, true), count: dv.getUint32(16, true), length: bytes.length };
  for (let i = 20; i < 32; i++) if (dv.getUint8(i) !== 0) throw new RangeError(`header byte ${i} is not zero`);
  const size = 32 + LAYOUT.reduce((s, [, kind]) => s + (kind === "f64" ? 8 : 4) * out.count, 0);
  if (size !== bytes.length) throw new RangeError(`MSC1 with ${out.count} records is ${size} bytes, the payload has ${bytes.length}`);
  let offset = 32;
  for (const [name, kind] of LAYOUT) {
    const Kind = kind === "f64" ? Float64Array : Uint32Array;
    // the arrays are copied out one element at a time through the DataView: no aligned-view assumptions at all
    const array = new Kind(out.count);
    for (let i = 0; i < out.count; i++) array[i] = kind === "f64" ? dv.getFloat64(offset + 8 * i, true) : dv.getUint32(offset + 4 * i, true);
    out[name] = array;
    offset += (kind === "f64" ? 8 : 4) * out.count;
  }
  return out;
}

// loadSnapshot(file?) -> {pack, bytes, blocks: {recent, reference, overview}} with each block decoded.
function loadSnapshot(file = SNAPSHOT_FILE) {
  const bytes = fs.readFileSync(file);
  const pack = JSON.parse(bytes.toString("utf8"));
  const blocks = {};
  for (const key of ["recent", "reference", "overview"]) blocks[key] = decodeMsc1(pack.blocks[key].gzip_base64);
  return { pack, bytes, blocks };
}

// exactSum(doubles): the exact rational sum of doubles (an array or typed array), no rounding at all.
function exactSum(values) {
  let total = R.ZERO;
  for (const x of values) total = R.add(total, R.fromDouble(x));
  return total;
}

// aggregate(block, {n, m, colLo, colHi}) -> [{c, r, vol, tbvol, ct, bt}] sorted by (c, r): the base cells (block must be level (0, 0))
// of level columns [colLo, colHi) summed into level-(n, m) cells, volumes as exact sums rounded once to a double.
function aggregate(block, { n, m, colLo, colHi }) {
  if (block.n !== 0 || block.m !== 0) throw new RangeError("aggregate needs base cells (level 0, 0)");
  const acc = new Map();
  for (let i = 0; i < block.count; i++) {
    const c = block.col[i] >> n;
    if (c < colLo || c >= colHi) continue;
    const r = block.row[i] >> m;
    const key = `${c}:${r}`;
    let cell = acc.get(key);
    if (!cell) acc.set(key, (cell = { c, r, vol: R.ZERO, tbvol: R.ZERO, ct: 0, bt: 0 }));
    cell.vol = R.add(cell.vol, R.fromDouble(block.vol[i]));
    cell.tbvol = R.add(cell.tbvol, R.fromDouble(block.tbvol[i]));
    cell.ct += block.ct[i];
    cell.bt += block.bt[i];
  }
  return [...acc.values()].sort((a, b) => a.c - b.c || a.r - b.r).map((x) => ({ c: x.c, r: x.r, vol: R.toDouble(x.vol), tbvol: R.toDouble(x.tbvol), ct: x.ct, bt: x.bt }));
}

// cutoffBase(isoText) -> {ms, base}: the cutoff as integer milliseconds since 2021-01-01T00:00:00Z and as the exact rational number of
// base columns (56.25 s each). Refuses fractional digits below the millisecond rather than truncating them silently.
function cutoffBase(iso) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/.exec(iso);
  if (!m) throw new RangeError(`cutoff ${JSON.stringify(iso)} is not an ISO UTC time`);
  const digits = (m[2] ?? "").padEnd(6, "0");
  if (!/^0*$/.test(digits.slice(3))) throw new RangeError(`cutoff ${iso} has sub-millisecond digits`);
  const ms = Date.parse(`${m[1]}.${digits.slice(0, 3)}Z`) - Date.parse("2021-01-01T00:00:00Z");
  return { ms, base: R.q(BigInt(ms), 56250n) };
}

module.exports = { SNAPSHOT_FILE, decodeMsc1, loadSnapshot, exactSum, aggregate, cutoffBase };
