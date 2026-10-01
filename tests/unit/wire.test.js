"use strict";
// U03 wire.test.js (H2): the bridge's binary blocks, byte for byte.
// Oracles: (1) tests/fixtures/wire/vectors.json, written by tests/reference/wire_golden.py, a standard-library Python
// re-implementation of the layouts with `struct` (NaN is the string "NaN" in the JSON); (2) the DECODER BELOW, written from the
// layout table of tools/cube_bridge.py's docstring with a DataView and sharing no code with tests/support/wire.js; (3) hand
// arithmetic for the block meta (col0 = floor(b0 / 2^n), col1 = ceil(b1 / 2^n)). Only decompressed payloads are compared: gzip
// bytes depend on the zlib version.
// It also shows that malformed() can produce every corrupt variant the page has a reaction to (bad magic, truncated or empty
// gzip, bad base64, short payload, non-JSON), and that each one fails to decode here with the error that names it.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const wire = require("../support/wire.js");
const { startFake } = require("../support/cube-fake.js");

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "wire", "vectors.json"), "utf8"));
const num = (v) => (v === "NaN" ? NaN : v);
const columnsOf = (cells) => Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.map(num)]));

// ---- the independent decoder: layout table -> arrays (little-endian, arrays back to back after 32 bytes) ----
const LAYOUT = {
  MSC2: [["vol", "f64"], ["tbvol", "f64"], ["cnt", "f64"], ["tbcnt", "f64"], ["col", "u32"], ["row", "u32"]],
  MSC3: [["vol", "f64"], ["tbvol", "f64"], ["cnt", "f64"], ["tbcnt", "f64"], ["path", "f64"], ["dwell", "f64"], ["high", "f64"], ["low", "f64"], ["col", "u32"], ["row", "u32"]],
  MSCB: [["open", "f64"], ["high", "f64"], ["low", "f64"], ["close", "f64"], ["vol", "f64"], ["tbvol", "f64"], ["btc", "f64"], ["cnt", "f64"], ["col", "u32"]],
  MSCC: [["col", "u32"], ["poc", "u32"], ["vol", "f32"], ["tbvol", "f32"]],
};
const SIZE = { f64: 8, u32: 4, f32: 4 };

function independentDecode(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  const head = { magic, n: dv.getUint8(4), m: dv.getUint8(5), pad: dv.getUint16(6, true), col0: dv.getUint32(8, true), col1: dv.getUint32(12, true), count: dv.getUint32(16, true) };
  for (let i = 20; i < 32; i++) assert.equal(dv.getUint8(i), 0, `header byte ${i} is padding`);
  let at = 32;
  const arrays = {};
  for (const [key, kind] of LAYOUT[magic]) {
    assert.equal(at % SIZE[kind], 0, `${key} starts aligned`);
    arrays[key] = [];
    for (let i = 0; i < head.count; i++, at += SIZE[kind]) {
      arrays[key].push(kind === "f64" ? dv.getFloat64(at, true) : kind === "f32" ? dv.getFloat32(at, true) : dv.getUint32(at, true));
    }
  }
  assert.equal(at, bytes.length, "no trailing bytes");
  return { ...head, arrays };
}

const same = (a, b) => a.length === b.length && a.every((v, i) => (Number.isNaN(v) ? Number.isNaN(b[i]) : Object.is(v, b[i]) || v === b[i]));

describe("payload layouts against the Python goldens", () => {
  const encoders = {
    MSC2: (v) => wire.encodeMsc2({ n: v.n, m: v.m, col0: v.col0, col1: v.col1, cells: columnsOf(v.cells), first: v.first }),
    MSC3: (v) => wire.encodeMsc2({ n: v.n, m: v.m, col0: v.col0, col1: v.col1, cells: columnsOf(v.cells), first: v.first, motion: true }),
    MSCB: (v) => wire.encodeMscB({ n: v.n, col0: v.col0, col1: v.col1, bars: columnsOf(v.cells) }),
    MSCC: (v) => wire.encodeMscC({ n: v.n, m: v.m, col0: v.col0, col1: v.col1, columns: columnsOf(v.cells) }),
  };

  for (const v of vectors.payloads) {
    it(`${v.name}: the encoder produces the golden payload`, () => {
      const bytes = encoders[v.magic](v);
      assert.equal(bytes.toString("hex"), v.payloadHex);
    });

    it(`${v.name}: the header is <4sBBHIII12x and the arrays decode to the vector's cells`, () => {
      const bytes = Buffer.from(v.payloadHex, "hex");
      const d = independentDecode(bytes);
      assert.equal(d.magic, v.magic);
      assert.deepEqual([d.n, d.m, d.pad, d.col0, d.col1, d.count], [v.n, v.m, 0, v.col0, v.col1, v.count]);
      const expected = columnsOf(v.cells);
      for (const [key, kind] of LAYOUT[v.magic]) {
        const want = expected[key].slice(v.first);
        const got = kind === "f32" ? d.arrays[key] : d.arrays[key];
        assert.ok(same(got, kind === "f32" ? want.map(Math.fround) : want), `${key}: ${got} vs ${want}`);
      }
    });

    it(`${v.name}: wire.decode agrees with the independent decoder`, () => {
      const bytes = Buffer.from(v.payloadHex, "hex");
      const mine = wire.decode(bytes);
      const theirs = independentDecode(bytes);
      assert.deepEqual([mine.magic, mine.n, mine.m, mine.col0, mine.col1, mine.count], [theirs.magic, theirs.n, theirs.m, theirs.col0, theirs.col1, theirs.count]);
      for (const [key] of LAYOUT[v.magic]) assert.ok(same(Array.from(mine[key]), theirs.arrays[key]), key);
    });
  }

  it("header count is the tail's for a delta tail, and the arrays are the cells from `first` on", () => {
    const plain = vectors.payloads.find((v) => v.name === "msc2-plain");
    const tail = vectors.payloads.find((v) => v.name === "msc2-tail");
    assert.equal(plain.count, 5);
    assert.equal(tail.count, 2);
    assert.deepEqual(independentDecode(Buffer.from(tail.payloadHex, "hex")).arrays.col, [200003, 200003]);
  });

  it("f64 arrays start 8-aligned and the u32 arrays follow them (offsets from the layout table)", () => {
    for (const [magic, fields] of Object.entries(LAYOUT)) {
      for (const count of [0, 1, 3, 7]) {
        let at = 32;
        for (const [, kind] of fields) {
          assert.equal(at % SIZE[kind], 0, `${magic} ${count}`);
          at += SIZE[kind] * count;
        }
      }
    }
  });

  it("the golden cells are sorted and unique by (col, row), as the page's bisection assumes", () => {
    for (const v of vectors.payloads.filter((p) => ["MSC2", "MSC3"].includes(p.magic))) {
      const c = columnsOf(v.cells);
      for (let i = 1; i < c.col.length; i++) assert.ok(c.col[i] > c.col[i - 1] || (c.col[i] === c.col[i - 1] && c.row[i] > c.row[i - 1]), `${v.name} cell ${i}`);
    }
  });

  it("NaN is written as the canonical quiet NaN, whatever bits the source NaN carries", () => {
    const odd = new Float64Array(new Uint32Array([1, 0x7ff80000]).buffer); // a NaN with a payload bit set
    assert.ok(Number.isNaN(odd[0]));
    const bytes = wire.encodeMsc2({
      n: 0, m: 0, col0: 0, col1: 1, motion: true,
      cells: { vol: [0], tbvol: [0], cnt: [0], tbcnt: [0], path: [0], dwell: [1], high: odd, low: [NaN], col: [0], row: [0] },
    });
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const highAt = 32 + 6 * 8;
    assert.equal(dv.getUint32(highAt, true), 0);
    assert.equal(dv.getUint32(highAt + 4, true), 0x7ff80000);
  });

  it("refuses arrays of different lengths and header values beyond 32 bits", () => {
    assert.throws(() => wire.encodeMsc2({ n: 0, m: 0, col0: 0, col1: 1, cells: { vol: [1], tbvol: [], cnt: [1], tbcnt: [1], col: [0], row: [0] } }), /tbvol has 0 entries/);
    assert.throws(() => wire.encodeMsc2({ n: 0, m: 0, col0: 2 ** 32, col1: 1, cells: { vol: [], tbvol: [], cnt: [], tbcnt: [], col: [], row: [] } }), /col0/);
  });
});

describe("block() meta and time conversion", () => {
  for (const b of vectors.blocks) {
    it(`block(${b.n}, ${b.m}, ${b.b0}, ${b.b1}) spans columns ${b.col0}..${b.col1} and carries its ISO edges`, () => {
      const cells = { vol: [], tbvol: [], cnt: [], tbcnt: [], col: [], row: [] };
      const meta = wire.block(b.n, b.m, b.b0, b.b1, cells);
      assert.deepEqual([meta.n, meta.m, meta.b0, meta.b1, meta.col0, meta.col1], [b.n, b.m, b.b0, b.b1, b.col0, b.col1]);
      assert.equal(meta.start, b.start);
      assert.equal(meta.end, b.end);
      assert.deepEqual([meta.count, meta.encoding, meta.layout], [0, "gzip+base64", "MSC2"]);
      const d = independentDecode(zlib.gunzipSync(Buffer.from(meta.gzip_base64, "base64")));
      assert.deepEqual([d.magic, d.n, d.m, d.col0, d.col1, d.count], ["MSC2", b.n, b.m, b.col0, b.col1, 0], "the binary header repeats col0 and col1");
    });
  }

  it("a motion block says MSC3", () => {
    const empty = { vol: [], tbvol: [], cnt: [], tbcnt: [], path: [], dwell: [], high: [], low: [], col: [], row: [] };
    const meta = wire.block(0, 0, 10, 20, empty, true);
    assert.equal(meta.layout, "MSC3");
    assert.equal(independentDecode(zlib.gunzipSync(Buffer.from(meta.gzip_base64, "base64"))).magic, "MSC3");
  });

  for (const { base, iso } of vectors.isos) {
    it(`iso(${base}) is ${iso}, and baseUnits reads it back to a nanoposition`, () => {
      assert.equal(wire.iso(base), iso);
      assert.ok(Math.abs(wire.baseUnits(iso) - base) < 1e-9, `${wire.baseUnits(iso)} vs ${base}`);
    });
  }

  it("baseUnits is the page's expression, so a minute-edge cutoff of the pack is bit-identical to the page's CUT", () => {
    const stamp = "2026-09-24T12:02:00.000000Z";
    assert.equal(wire.baseUnits(stamp), (Date.parse(stamp) / 1000 - 1609459200) / 56.25);
    assert.throws(() => wire.baseUnits("nonsense"), /not a time/);
  });
});

describe("transport: base64(gzip(payload))", () => {
  const payload = Buffer.from(vectors.payloads[0].payloadHex, "hex");

  it("round-trips, and the compressed bytes are a gzip stream (RFC 1952 magic)", () => {
    const text = wire.gzipBase64(payload);
    assert.deepEqual([...Buffer.from(text, "base64").subarray(0, 2)], [0x1f, 0x8b]);
    assert.equal(wire.gunzipBase64(text).toString("hex"), payload.toString("hex"));
  });

  it("rejects what the page's atob would: stray characters and bad lengths", () => {
    assert.throws(() => wire.gunzipBase64("!!!!"), /not base64/);
    assert.throws(() => wire.gunzipBase64("abc"), /not base64/);
  });

  it("decode names a bad magic, a short header and a payload whose size does not match its count", () => {
    const bad = Buffer.from(payload);
    bad.write("XXXX", 0, "latin1");
    assert.throws(() => wire.decode(bad), /bad magic "XXXX"/);
    assert.throws(() => wire.decode(payload.subarray(0, 20)), /short payload/);
    assert.throws(() => wire.decode(payload.subarray(0, payload.length - 4)), /payload has/);
  });
});

describe("malformed() produces every corrupt variant, and each fails the way the page's reaction expects", () => {
  let fake, url;
  before(async () => {
    fake = await startFake({ profile: "mini" });
    const cut = Math.floor(fake.info().cutoffBase);
    url = `/cube/tile?n=0&m=0&b0=${cut - 200}&b1=${cut}&pack=${fake.info().packToken}&proto=2`;
  });
  after(() => fake.close());

  const tile = async () => {
    const response = await fetch(fake.url + url);
    return { status: response.status, text: await response.text() };
  };

  it("unmodified, the answer is a valid MSC2 block", async () => {
    const { status, text } = await tile();
    assert.equal(status, 200);
    const d = wire.decode(wire.gunzipBase64(JSON.parse(text).block.gzip_base64));
    assert.equal(d.magic, "MSC2");
    assert.ok(d.count > 0);
  });

  const cases = {
    magic: (text) => assert.throws(() => wire.decode(wire.gunzipBase64(JSON.parse(text).block.gzip_base64)), /bad magic "XXXX"/), // the page: "Invalid block of cells"
    gzip: (text) => assert.throws(() => wire.gunzipBase64(JSON.parse(text).block.gzip_base64)), // the page: a TypeError, "the server can't be reached"
    base64: (text) => assert.throws(() => wire.gunzipBase64(JSON.parse(text).block.gzip_base64), /not base64/), // the page: InvalidCharacterError from atob
    short: (text) => assert.throws(() => wire.decode(wire.gunzipBase64(JSON.parse(text).block.gzip_base64)), /payload has/), // the header promises more records than the payload holds
    json: (text) => assert.throws(() => JSON.parse(text), SyntaxError),
  };
  for (const [how, check] of Object.entries(cases)) {
    it(`malformed(${how})`, async () => {
      const rule = fake.on({ route: /^\/cube\/tile/ }).malformed(how);
      try {
        const { status, text } = await tile();
        assert.equal(status, 200);
        check(text);
      } finally {
        rule.remove();
      }
    });
  }

  it("an empty gzip stream decodes to nothing, which is not a block", () => {
    const empty = zlib.gzipSync(Buffer.alloc(0)).toString("base64");
    assert.throws(() => wire.decode(wire.gunzipBase64(empty)), /short payload/);
  });

  it("empty() gives a valid block with count 0", async () => {
    const rule = fake.on({ route: /^\/cube\/tile/ }).empty();
    try {
      const { text } = await tile();
      const block = JSON.parse(text).block;
      assert.equal(block.count, 0);
      const d = wire.decode(wire.gunzipBase64(block.gzip_base64));
      assert.equal(d.count, 0);
    } finally {
      rule.remove();
    }
  });
});
