"use strict";
// U08 snapshot.test.js (H3): data/snapshot.json, the recorded real-data export, read by an independent decoder.
//
// Oracles, none of which is the code under test:
//   1. The MSC1 layout table of maps/bridge-fake-cube.md 1.3 (header <4sBBHIII12x, six arrays) applied by tests/reference/snapshot.js
//      (DataView + node:zlib + BigInt) and, separately, by golden.py (struct + zlib + fractions): tests/fixtures/snapshot/pinned-cells.json
//      holds the Python decode, this file re-decodes in JavaScript and requires equality, so a decoder bug must exist twice.
//   2. Facts recorded in the engineering map (maps/bridge-fake-cube.md 1.2.2, taken by an earlier prototype that decoded the file in
//      Node) and typed here as literals: cell counts, column counts, row ranges, maximum cell, trade totals.
//   3. Exact-rational sums (tests/reference/rational.js): the recent block aggregated to (4, 0) is compared with the reference block
//      over their shared complete columns, counts exactly and volumes as the exact sum rounded once.
// "Snapshot data tests only the measures it contains" (issue #46 section 7): nothing here mentions path, dwell, high, low or bars
// except to assert that the file has none.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ref = require("../reference/index.js");
const S = ref.snapshot;
const R = ref.rational;

const PINS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "snapshot", "pinned-cells.json"), "utf8"));
const snap = S.loadSnapshot();
const { pack, blocks } = snap;
// D4: near(a, b) := |a - b| <= 1e-12 max(|a|, |b|) + 1e-12 (USDT volumes)
const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;
// relative difference, 0 when both are 0 (a cell without taker-buy volume)
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));

describe("the file and its layout", () => {
  it("is the file the pins were taken from (sha256); a refreshed snapshot must re-pin on purpose", () => {
    assert.equal(crypto.createHash("sha256").update(snap.bytes).digest("hex"), PINS.snapshotSha256);
  });

  it("is a snapshot, not a live pack: no live flag, token or canonical boundary; recorded page semantics", () => {
    assert.equal(pack.snapshot, true);
    for (const k of ["live", "state_token", "canonical_through", "data_cutoff", "age", "quiet", "next", "page"]) assert.ok(!(k in pack), `${k} must be absent`);
    assert.deepEqual(Object.keys(pack.blocks).sort(), ["overview", "recent", "reference"]);
    assert.equal(pack.t0, 1609459200, "2021-01-01T00:00:00Z");
    assert.equal(pack.base_seconds, 56.25);
    assert.equal(pack.base_price, 125);
  });

  it("every block is MSC1 with exactly six arrays: no path, dwell, high, low, bars (the snapshot only holds volume and count measures)", () => {
    for (const [key, b] of Object.entries(blocks)) {
      const meta = pack.blocks[key];
      assert.equal(b.magic, "MSC1", key);
      assert.equal(meta.layout, "MSC1", key);
      assert.equal(b.length, 32 + b.count * (8 + 8 + 4 + 4 + 4 + 4), `${key}: 32-byte header plus six arrays of ${b.count}`);
      assert.deepEqual(Object.keys(b).filter((k) => b[k] && b[k].length === b.count).sort(), ["bt", "col", "ct", "row", "tbvol", "vol"], `${key}: the six arrays`);
      for (const banned of ["path", "dwell", "high", "low", "bars", "open", "close"]) assert.ok(!(banned in b), `${key}.${banned}`);
      for (const banned of ["path", "dwell", "high", "low", "bars"]) assert.ok(!(banned in meta), `meta ${key}.${banned}`);
    }
  });

  it("header and metadata agree: level, columns, count and the JSON totals", () => {
    const expected = { recent: [0, 0], reference: [4, 0], overview: [12, 3] };
    for (const [key, b] of Object.entries(blocks)) {
      const meta = pack.blocks[key];
      assert.deepEqual([b.n, b.m], expected[key], key);
      assert.deepEqual([meta.n, meta.m], expected[key], key);
      assert.equal(b.count, meta.count);
      assert.equal(b.col0, meta.col0);
      assert.equal(b.col1, meta.col1);
      assert.equal(meta.col0, Math.floor(meta.b0 / 2 ** b.n), "col0 = floor(b0 / 2^n)");
      assert.equal(meta.col1, Math.ceil(meta.b1 / 2 ** b.n), "col1 = ceil(b1 / 2^n)");
      assert.equal(ref.snapshot.exactSum(b.ct).n, BigInt(meta.totals.trades), `${key}: trade total is an exact integer`);
      assert.equal(Number(ref.snapshot.exactSum(b.bt).n), meta.totals.buyTrades);
      assert.ok(near(R.toDouble(S.exactSum(b.vol)), meta.totals.volume), `${key}: volume total`);
      assert.ok(near(R.toDouble(S.exactSum(b.tbvol)), meta.totals.buyVolume), `${key}: taker-buy volume total`);
    }
  });

  it("cells are sorted by (col, row), unique, inside the declared columns, with bt <= ct and tbvol <= vol", () => {
    for (const [key, b] of Object.entries(blocks)) {
      for (let i = 0; i < b.count; i++) {
        if (i > 0) assert.ok(b.col[i - 1] < b.col[i] || (b.col[i - 1] === b.col[i] && b.row[i - 1] < b.row[i]), `${key} ${i}: order and uniqueness`);
        assert.ok(b.col[i] >= b.col0 && b.col[i] < b.col1, `${key} ${i}: column in range`);
        assert.ok(b.bt[i] <= b.ct[i], `${key} ${i}: bt <= ct`);
        assert.ok(b.tbvol[i] <= b.vol[i], `${key} ${i}: tbvol <= vol`);
        assert.ok(b.vol[i] > 0 && Number.isFinite(b.vol[i]));
      }
    }
  });
});

describe("what the recorded facts say (maps/bridge-fake-cube.md 1.2.2, typed from the map)", () => {
  const facts = (b) => {
    const perColumn = new Map();
    for (let i = 0; i < b.count; i++) perColumn.set(b.col[i], (perColumn.get(b.col[i]) ?? 0) + 1);
    let maxVol = 0, maxCt = 0, minRow = Infinity, maxRow = -Infinity;
    for (let i = 0; i < b.count; i++) {
      maxVol = Math.max(maxVol, b.vol[i]);
      maxCt = Math.max(maxCt, b.ct[i]);
      minRow = Math.min(minRow, b.row[i]);
      maxRow = Math.max(maxRow, b.row[i]);
    }
    const histogram = {};
    for (const n of perColumn.values()) histogram[n] = (histogram[n] ?? 0) + 1;
    return { columns: perColumn.size, histogram, maxVol, maxCt, minRow, maxRow };
  };

  it("recent (0,0): 14,328 cells over 10,752 columns, every column occupied, 7,329 with one cell, 3,299 with two, at most 8; rows 608..699", () => {
    const b = blocks.recent;
    const f = facts(b);
    assert.equal(b.count, 14328);
    assert.equal(f.columns, 10752);
    assert.equal(f.histogram[1], 7329);
    assert.equal(f.histogram[2], 3299);
    assert.equal(Math.max(...Object.keys(f.histogram).map(Number)), 8);
    assert.deepEqual([f.minRow, f.maxRow], [608, 699], "76,000 - 87,500 USDT");
    assert.equal(Math.round(f.maxVol / 1e5) / 10, 26.8, "max cell about 26.8 M USDT");
    assert.equal(f.maxCt, 18297);
    assert.equal(S.exactSum(b.ct).n, 20649431n);
    assert.equal([b.col0, b.col1].join(" "), "3203331 3214083", "2026-09-17T12:02:48.75Z to 2026-09-24T12:02:48.75Z");
  });

  it("reference (4,0): 7,399 cells over 2,880 columns, rows 599..699, 93,145,211 trades", () => {
    const b = blocks.reference;
    const f = facts(b);
    assert.equal(b.count, 7399);
    assert.equal(f.columns, 2880);
    assert.deepEqual([f.minRow, f.maxRow], [599, 699]);
    assert.equal(S.exactSum(b.ct).n, 93145211n);
    assert.equal(pack.blocks.reference.b0, 3168000);
    assert.equal(pack.blocks.reference.b1, 3214080, "whole 15-minute columns only: the cutoff floored to 16 base columns");
  });

  it("overview (12,3): 3,818 cells over 785 columns, rows 15..126, 6,173,120,060 trades; its last column is incomplete", () => {
    const b = blocks.overview;
    const f = facts(b);
    assert.equal(b.count, 3818);
    assert.equal(f.columns, 785);
    assert.deepEqual([f.minRow, f.maxRow], [15, 126], "15,000 - 127,000 USDT");
    assert.equal(S.exactSum(b.ct).n, 6173120060n);
    assert.equal(pack.blocks.overview.b0, 0);
    assert.equal(pack.blocks.overview.b1, 3214083);
    assert.equal(3214083 % 4096 === 0, false, "column 784 covers base 3,211,264 - 3,215,360: cut by the cutoff");
  });

  it("the cutoff 2026-09-24T12:02:48.75Z is base column 3,214,083 EXACTLY (an integer): the snapshot has no open column", () => {
    const { ms, base } = S.cutoffBase(pack.cutoff);
    assert.deepEqual(base, { n: 3214083n, d: 1n });
    assert.equal(ms, 180792168750);
    assert.equal(pack.cutoffBase, 3214083);
    assert.equal(pack.blocks.recent.b1, 3214083);
    assert.equal(ms, Date.parse("2026-09-24T12:02:48.750Z") - Date.parse("2021-01-01T00:00:00Z"), "the calendar agrees");
    assert.equal(PINS.cutoffBaseIsInteger, true);
    assert.equal(PINS.cutoffMs, ms);
  });

  it("the cutoff helper refuses digits below the millisecond and non-UTC text instead of truncating", () => {
    assert.throws(() => S.cutoffBase("2026-09-24T12:02:48.750500Z"), /sub-millisecond/);
    assert.throws(() => S.cutoffBase("2026-09-24 12:02:48"), /not an ISO UTC time/);
    assert.deepEqual(S.cutoffBase("2021-01-01T00:01:07.5Z").base, R.q(67500n, 56250n));
  });
});

describe("recent aggregated to (4,0) equals reference over the shared span", () => {
  // level-4 columns wholly inside recent: ceil(3,203,331 / 16) = 200,209 up to the reference block's end 200,880
  const lo = Math.ceil(pack.blocks.recent.b0 / 16);
  const hi = Math.min(blocks.reference.col1, Math.floor(pack.blocks.recent.b1 / 16));
  const agg = S.aggregate(blocks.recent, { n: 4, m: 0, colLo: lo, colHi: hi });
  const theirs = [];
  for (let i = 0; i < blocks.reference.count; i++) {
    const c = blocks.reference.col[i];
    if (c >= lo && c < hi) theirs.push({ c, r: blocks.reference.row[i], vol: blocks.reference.vol[i], tbvol: blocks.reference.tbvol[i], ct: blocks.reference.ct[i], bt: blocks.reference.bt[i] });
  }

  it("the same 1,852 cells, in the same order", () => {
    assert.deepEqual([lo, hi], [200209, 200880]);
    assert.equal(agg.length, 1852);
    assert.deepEqual(agg.map((x) => [x.c, x.r]), theirs.map((x) => [x.c, x.r]));
  });

  it("counts are exact; volumes agree within near() and, as exact sums rounded once, to the last bit of the recorded export", () => {
    let worst = 0;
    agg.forEach((x, i) => {
      const y = theirs[i];
      assert.equal(x.ct, y.ct, `count at ${x.c},${x.r}`);
      assert.equal(x.bt, y.bt, `taker-buy count at ${x.c},${x.r}`);
      assert.ok(near(x.vol, y.vol) && near(x.tbvol, y.tbvol), `volume at ${x.c},${x.r}`);
      worst = Math.max(worst, rel(x.vol, y.vol), rel(x.tbvol, y.tbvol));
    });
    // The Python decode found the exact-sum difference to be 0 (the export's grouping rounds the exact sum once); pinned, not assumed.
    assert.equal(worst, PINS.recentToReference.maxRelativeVolumeDifference);
    assert.ok(worst <= 1e-15);
  });

  it("a plain floating-point sum in file order differs from the export by no more than the recorded 3.83e-16 relative", () => {
    // The map recorded 3.83e-16 as the largest relative difference of this aggregation done with ordinary doubles.
    const naive = new Map();
    const b = blocks.recent;
    for (let i = 0; i < b.count; i++) {
      const c = b.col[i] >> 4;
      if (c < lo || c >= hi) continue;
      const key = `${c}:${b.row[i]}`;
      naive.set(key, (naive.get(key) ?? 0) + b.vol[i]);
    }
    let worst = 0;
    for (const y of theirs) worst = Math.max(worst, rel(naive.get(`${y.c}:${y.r}`), y.vol));
    assert.ok(worst <= 4e-16, `largest relative difference ${worst}`);
    assert.ok(worst > 0, "the difference exists: two reads of the same cells are not always bit-equal, which D4's tolerance is for");
  });

  it("the pinned consistency facts match", () => {
    assert.deepEqual(PINS.recentToReference.columns, [lo, hi]);
    assert.equal(PINS.recentToReference.cells, agg.length);
    assert.equal(PINS.recentToReference.sameCellSet, true);
    assert.equal(PINS.recentToReference.countsExact, true);
  });
});

describe("pinned cells: the Python decode against the JavaScript decode", () => {
  it("12 cells, four per block, equal to the last bit", () => {
    assert.equal(PINS.cells.length, 12);
    for (const cell of PINS.cells) {
      const b = blocks[cell.block];
      const i = cell.index;
      assert.deepEqual(
        { col: b.col[i], row: b.row[i], vol: b.vol[i], tbvol: b.tbvol[i], ct: b.ct[i], bt: b.bt[i] },
        { col: cell.col, row: cell.row, vol: cell.vol, tbvol: cell.tbvol, ct: cell.ct, bt: cell.bt },
        `${cell.block} ${cell.which} (index ${i})`,
      );
    }
    for (const key of Object.keys(blocks)) assert.equal(PINS.cells.filter((c) => c.block === key).length, 4);
  });

  it("the pinned cells are where the labels say: first, middle, largest volume, last", () => {
    for (const key of Object.keys(blocks)) {
      const b = blocks[key];
      const at = (which) => PINS.cells.find((c) => c.block === key && c.which === which).index;
      assert.equal(at("first"), 0);
      assert.equal(at("last"), b.count - 1);
      assert.equal(at("middle"), Math.floor(b.count / 2));
      const top = at("max volume");
      assert.ok(b.vol.every((v) => v <= b.vol[top]));
      assert.equal(b.vol.indexOf(b.vol[top]), top, "the first of equal maxima");
    }
  });

  it("the recorded facts of each block (Python) equal what this decoder computes", () => {
    for (const [key, b] of Object.entries(blocks)) {
      const p = PINS.blocks[key];
      assert.equal(p.count, b.count);
      assert.deepEqual([p.n, p.m, p.col0, p.col1], [b.n, b.m, b.col0, b.col1]);
      assert.equal(p.payloadBytes, b.length);
      assert.equal(p.trades, Number(S.exactSum(b.ct).n));
      assert.equal(p.takerBuyTrades, Number(S.exactSum(b.bt).n));
      assert.equal(p.volume, R.toDouble(S.exactSum(b.vol)), "exact sum rounded once, in both languages");
      assert.equal(p.takerBuyVolume, R.toDouble(S.exactSum(b.tbvol)));
      assert.equal(p.minRow, Math.min(...b.row));
      assert.equal(p.maxRow, Math.max(...b.row));
      assert.equal(p.minCol, Math.min(...b.col));
      assert.equal(p.maxCol, Math.max(...b.col));
      assert.equal(p.distinctColumns, new Set(b.col).size);
      assert.equal(p.maxVolume, Math.max(...b.vol));
      assert.equal(p.maxTrades, Math.max(...b.ct));
      assert.equal(p.sorted, true);
    }
  });
});

describe("the decoder refuses what is not a snapshot block", () => {
  const zlib = require("node:zlib");
  const gz = (buffer) => zlib.gzipSync(buffer).toString("base64");
  const header = (magic, count) => {
    const b = Buffer.alloc(32);
    b.write(magic, 0, "latin1");
    b.writeUInt32LE(count, 16);
    return b;
  };

  it("a bad magic, a wrong size, a non-zero pad and a corrupt stream", () => {
    assert.throws(() => S.decodeMsc1(gz(header("MSC2", 0))), /not an MSC1 block/);
    assert.throws(() => S.decodeMsc1(gz(header("MSC1", 1))), /is 64 bytes, the payload has 32/);
    const dirty = header("MSC1", 0);
    dirty[25] = 7;
    assert.throws(() => S.decodeMsc1(gz(dirty)), /header byte 25/);
    assert.throws(() => S.decodeMsc1("not a gzip stream"));
  });

  it("an empty block decodes to empty arrays; one record round-trips through the layout", () => {
    assert.equal(S.decodeMsc1(gz(header("MSC1", 0))).count, 0);
    const b = Buffer.alloc(32 + 32);
    header("MSC1", 1).copy(b);
    b.writeDoubleLE(123.5, 32);
    b.writeDoubleLE(60.25, 40);
    b.writeUInt32LE(7, 48);
    b.writeUInt32LE(9, 52);
    b.writeUInt32LE(11, 56);
    b.writeUInt32LE(5, 60);
    const one = S.decodeMsc1(gz(b));
    assert.deepEqual([one.vol[0], one.tbvol[0], one.col[0], one.row[0], one.ct[0], one.bt[0]], [123.5, 60.25, 7, 9, 11, 5]);
  });
});
