"use strict";
// tests/support/wire.js (H2): the bridge's binary blocks, byte for byte.
// tools/cube_bridge.py builds every block as base64(gzip(payload)); the page reads it with
// atob + DecompressionStream("gzip") and then typed-array views (src/explorer.js unpack,
// unpackBars, unpackHistory). This module encodes and decodes the same layouts in Node so the fake
// cube can serve them and the unit tests can take them apart again. Nothing here imports src/.
//
// Layouts (little-endian, no padding between arrays; header `<4sBBHIII12x` = 32 bytes):
//   MSC2  vol f64, tbvol f64, cnt f64, tbcnt f64, col u32, row u32
//   MSC3  vol, tbvol, cnt, tbcnt, path f64 (USDT), dwell f64 (s), high f64, low f64 (NaN: no trades), col, row
//   MSCB  open, high, low, close, vol, tbvol, btc, cnt (f64), col u32; header m = 20
//   MSCC  col u32, poc u32, vol f32, tbvol f32
// Cells are columnar objects of typed arrays sorted by (col, row), as in the bridge; plain arrays
// are accepted and converted.
//
// Compression: gzip level 6. The compressed bytes are not comparable across zlib versions (and
// Python writes its mtime into the header), so goldens compare the DECOMPRESSED payload only.
const zlib = require("node:zlib");

const T0 = 1609459200; // 2021-01-01T00:00:00Z, epoch seconds
const BASE_SECONDS = 56.25;
const BASE_MS = 56250;
const BASE_PRICE = 125;
const DAY = 1536; // base columns per UTC day
const BAR_PRICE_EXPONENT = 20;
const HEADER = 32;

const MSC2_FIELDS = ["vol", "tbvol", "cnt", "tbcnt", "col", "row"];
const MSC3_FIELDS = ["vol", "tbvol", "cnt", "tbcnt", "path", "dwell", "high", "low", "col", "row"];
// The bridge's BAR_FIELDS: [key in the columnar dict, name in the bar]; MSCB stores them in this order.
const BAR_FIELDS = ["open", "high", "low", "close", "vol", "tbvol", "btc", "cnt"];
const MSCC_FIELDS = ["col", "poc", "vol", "tbvol"];
const U32 = new Set(["col", "row", "poc"]);
const F32 = new Set(["vol", "tbvol"]); // only inside MSCC: elsewhere vol and tbvol are f64

// ---- time <-> base position (the bridge's edge() and base_units()) ----

// edge(base) -> "2026-09-24T12:02:00.000000Z": the bridge's ISO string with microseconds. The
// microsecond count is rounded once from the base position, which is exact for every base position
// that is a whole quarter second and within a microsecond for the float cutoffs of minute edges.
function iso(base) {
  const us = Math.round(base * BASE_SECONDS * 1e6);
  const ms = T0 * 1000 + Math.floor(us / 1000);
  const micro = ((us % 1000) + 1000) % 1000;
  return new Date(ms).toISOString().replace("Z", String(micro).padStart(3, "0") + "Z");
}

// baseUnits(stamp): the page's own expression for CUT (explorer.js line 18), so a cutoff computed here
// is bit-identical to the one the page derives from the same string.
function baseUnits(stamp) {
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) throw new RangeError(`baseUnits: ${stamp} is not a time`);
  return (ms / 1000 - T0) / BASE_SECONDS;
}

// ---- columnar helpers ----

function column(key, values) {
  if (values instanceof Float64Array || values instanceof Uint32Array || values instanceof Float32Array) return values;
  return U32.has(key) ? Uint32Array.from(values) : Float64Array.from(values);
}

// The number of cells of a columnar object, checking that every named array has the same length.
function lengthOf(cells, fields) {
  const n = cells[fields[0]].length;
  for (const key of fields) if (cells[key].length !== n) throw new RangeError(`column ${key} has ${cells[key].length} entries, expected ${n}`);
  return n;
}

function u32(name, value) {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** 32) throw new RangeError(`${name} = ${value} does not fit an unsigned 32-bit header field`);
  return value;
}

// One ArrayBuffer for the whole payload and aligned views on it: the arrays start at 32 + k*8*count
// (8-aligned) and the u32 arrays follow the f64 ones (4-aligned). A pooled Buffer.buffer with an
// arbitrary byteOffset would break the alignment, so no Buffer is ever viewed here.
function encodeLayout(magic, n, m, col0, col1, count, fields, cells, first, kinds) {
  const bytes = { f64: 8, u32: 4, f32: 4 };
  const size = HEADER + fields.reduce((sum, key) => sum + bytes[kinds[key]] * count, 0);
  const ab = new ArrayBuffer(size);
  const dv = new DataView(ab);
  for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
  dv.setUint8(4, n);
  dv.setUint8(5, m);
  dv.setUint32(8, u32("col0", col0), true);
  dv.setUint32(12, u32("col1", col1), true);
  dv.setUint32(16, count, true);
  let offset = HEADER;
  for (const key of fields) {
    const kind = kinds[key];
    const view = kind === "f64" ? new Float64Array(ab, offset, count) : kind === "f32" ? new Float32Array(ab, offset, count) : new Uint32Array(ab, offset, count);
    const source = cells[key];
    // A NaN is written as the canonical quiet NaN (0x7ff8...): the bridge's numpy writes that pattern and the
    // golden vectors carry it, so no NaN payload bits leak from whatever computed the value.
    for (let i = 0; i < count; i++) {
      const v = source[first + i];
      view[i] = v !== v ? NaN : v;
    }
    offset += bytes[kind] * count;
  }
  return Buffer.from(ab);
}

const kindsOf = (fields, f32) => Object.fromEntries(fields.map((key) => [key, U32.has(key) ? "u32" : f32 && F32.has(key) ? "f32" : "f64"]));

// encodeMsc2({n, m, col0, col1, cells, first = 0, motion = false}) -> Buffer (the uncompressed payload):
// the cells from index `first` on (a delta tail), MSC3 with motion. The header count is the number of
// cells written, i.e. the TAIL's length for a delta, while the block meta's `count` is the tier's.
function encodeMsc2({ n, m, col0, col1, cells, first = 0, motion = false }) {
  const fields = motion ? MSC3_FIELDS : MSC2_FIELDS;
  const columns = Object.fromEntries(fields.map((key) => [key, column(key, cells[key])]));
  const count = lengthOf(columns, fields) - first;
  if (count < 0) throw new RangeError(`first = ${first} is beyond the ${count + first} cells`);
  return encodeLayout(motion ? "MSC3" : "MSC2", n, m, col0, col1, count, fields, columns, first, kindsOf(fields, false));
}

// encodeMscB({n, col0, col1, bars}): bars = {open, high, low, close, vol, tbvol, btc, cnt, col}, one per
// column with trades in time order; the header's m is 20 (one row holds every price).
function encodeMscB({ n, col0, col1, bars }) {
  const fields = [...BAR_FIELDS, "col"];
  const columns = Object.fromEntries(fields.map((key) => [key, column(key, bars[key])]));
  const count = lengthOf(columns, fields);
  return encodeLayout("MSCB", n, BAR_PRICE_EXPONENT, col0, col1, count, fields, columns, 0, kindsOf(fields, false));
}

// encodeMscC({n, m, col0, col1, columns}): columns = {col, poc, vol, tbvol}; volumes are f32, so callers
// compare with Math.fround.
function encodeMscC({ n, m, col0, col1, columns }) {
  const cols = Object.fromEntries(MSCC_FIELDS.map((key) => [key, column(key, columns[key])]));
  const count = lengthOf(cols, MSCC_FIELDS);
  return encodeLayout("MSCC", n, m, col0, col1, count, MSCC_FIELDS, cols, 0, kindsOf(MSCC_FIELDS, true));
}

// ---- transport: base64(gzip(payload)) ----

const gzipBase64 = (payload) => zlib.gzipSync(payload, { level: 6 }).toString("base64");

// gunzipBase64(text) -> Buffer. Strict base64 (the page's atob rejects stray characters, Buffer.from
// silently skips them), then gunzip; a corrupt or truncated stream throws.
function gunzipBase64(text) {
  if (typeof text !== "string" || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new RangeError("not base64");
  return zlib.gunzipSync(Buffer.from(text, "base64"));
}

// The bridge's function names, for readability at the call sites: text = base64(gzip(payload)).
const msc2 = (n, m, col0, col1, cells, first = 0, motion = false) => gzipBase64(encodeMsc2({ n, m, col0, col1, cells, first, motion }));
const mscb = (n, col0, col1, bars) => gzipBase64(encodeMscB({ n, col0, col1, bars }));
const mscc = (n, m, col0, col1, columns) => gzipBase64(encodeMscC({ n, m, col0, col1, columns }));

// block(n, m, b0, b1, cells, motion) -> the bridge's block meta with its payload. b0 and b1 are base
// positions (floats); col0 = floor(b0 / 2^n) and col1 = ceil(b1 / 2^n) are the level columns they span.
function block(n, m, b0, b1, cells, motion = false) {
  const col0 = Math.floor(b0 / 2 ** n);
  const col1 = Math.ceil(b1 / 2 ** n);
  const count = cells.col.length;
  return {
    n, m, b0, b1, start: iso(b0), end: iso(b1), count, col0, col1, encoding: "gzip+base64",
    layout: motion ? "MSC3" : "MSC2", gzip_base64: msc2(n, m, col0, col1, cells, 0, motion),
  };
}

// ---- decoding (for tests and for the fake's own checks) ----

// decode(payload) -> {magic, n, m, col0, col1, count, arrays...}: every array is a copy in a fresh,
// aligned ArrayBuffer. Throws on a bad magic or a payload whose size does not match its header.
function decode(payload) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buffer.length < HEADER) throw new RangeError("short payload");
  const magic = buffer.toString("latin1", 0, 4);
  const layouts = {
    MSC2: [MSC2_FIELDS, false], MSC3: [MSC3_FIELDS, false], MSCB: [[...BAR_FIELDS, "col"], false], MSCC: [MSCC_FIELDS, true],
  };
  if (!layouts[magic]) throw new RangeError(`bad magic ${JSON.stringify(magic)}`);
  const [fields, f32] = layouts[magic];
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
  const dv = new DataView(ab);
  const out = { magic, n: dv.getUint8(4), m: dv.getUint8(5), col0: dv.getUint32(8, true), col1: dv.getUint32(12, true), count: dv.getUint32(16, true) };
  const kinds = kindsOf(fields, f32);
  const size = HEADER + fields.reduce((sum, key) => sum + (kinds[key] === "f64" ? 8 : 4) * out.count, 0);
  if (size !== buffer.length) throw new RangeError(`${magic} with ${out.count} records is ${size} bytes, the payload has ${buffer.length}`);
  let offset = HEADER;
  for (const key of fields) {
    const Kind = kinds[key] === "f64" ? Float64Array : kinds[key] === "f32" ? Float32Array : Uint32Array;
    out[key] = new Kind(ab, offset, out.count);
    offset += Kind.BYTES_PER_ELEMENT * out.count;
  }
  return out;
}

// Convenience: decode the payload of a block or a bars/columns object that carries gzip_base64.
const decodeBlock = (meta) => decode(gunzipBase64(meta.gzip_base64));

// A hex string of a payload, the form the golden vectors are stored in.
const toHex = (payload) => Buffer.from(payload).toString("hex");

module.exports = {
  T0, BASE_SECONDS, BASE_MS, BASE_PRICE, DAY, BAR_PRICE_EXPONENT, HEADER,
  MSC2_FIELDS, MSC3_FIELDS, BAR_FIELDS, MSCC_FIELDS,
  iso, baseUnits,
  encodeMsc2, encodeMscB, encodeMscC, gzipBase64, gunzipBase64, msc2, mscb, mscc, block,
  decode, decodeBlock, toHex,
};
