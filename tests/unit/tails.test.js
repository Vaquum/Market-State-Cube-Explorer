"use strict";
// U04 tails.test.js (H2): the bridge's delta-versus-whole rule, as the fake reproduces it.
// Oracles: tests/fixtures/wire/tails-vectors.json, whose delta or pack outcome for every case is stated by hand next to its data
// (tests/reference/wire_golden.py refuses to write a case that its own plain-Python version of the rule contradicts, and
// tests/reference/bridge_crosscheck.py --require-numpy runs the same vectors through the real cube_bridge.tails); the expected
// tail payloads are laid out by Python's `struct`; and, for the exact sum helper, the documented results of Python's math.fsum.
// Then the same rule is driven end to end: a fake served over HTTP answers /cube/pack?since with a delta after advance() and a
// rebuild(), and with a whole pack after revise(), a moved archive boundary and an expired pack.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const model = require("../support/bridge-model.js");
const wire = require("../support/wire.js");
const { startFake } = require("../support/cube-fake.js");

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "wire", "tails-vectors.json"), "utf8"));

// A vector pack as the bridge holds it: {pins, tiers: {id: {block, cells}}} with columnar typed arrays.
function held(pack, side) {
  const tiers = {};
  for (const { id, n, m } of vectors.tiers) {
    const t = pack.tiers[id];
    const rows = t.cells;
    tiers[id] = {
      block: { n, m, b0: 0, b1: t.b1, col0: t.col0 ?? 0, col1: t.col1 ?? 0, count: rows.length, encoding: "gzip+base64", layout: "MSC2" },
      cells: {
        vol: Float64Array.from(rows, (r) => r[2]), tbvol: Float64Array.from(rows, (r) => r[3]), cnt: Float64Array.from(rows, (r) => r[4]),
        tbcnt: Float64Array.from(rows, (r) => r[5]), col: Uint32Array.from(rows, (r) => r[0]), row: Uint32Array.from(rows, (r) => r[1]),
      },
    };
  }
  return { pins: pack.pins, tiers, side };
}

describe("tails(old, new) on the hand-stated vectors", () => {
  for (const c of vectors.cases) {
    it(`${c.name}: ${c.expect.kind}`, () => {
      const blocks = model.tails(held(c.old, "old"), held(c.new, "new"));
      if (c.expect.kind === "pack") {
        assert.equal(blocks, null, c.note);
        return;
      }
      assert.deepEqual(Object.keys(blocks), ["overview", "recent", "reference"]);
      for (const [id, want] of Object.entries(c.expect.tiers)) {
        const block = blocks[id];
        assert.equal(block.from, want.from, `${id} from = floor(old b1 / 2^n)`);
        assert.equal(block.col0, want.col0, `${id}: the header takes the NEW block's col0`);
        assert.equal(block.col1, want.col1);
        assert.equal(block.count, c.new.tiers[id].cells.length, `${id}: the block meta keeps the tier's own count`);
        assert.equal(block.encoding, "gzip+base64");
        const payload = zlib.gunzipSync(Buffer.from(block.gzip_base64, "base64"));
        assert.equal(payload.readUInt32LE(16), want.count, `${id}: the header count is the tail's length`);
        assert.equal(payload.toString("hex"), want.payloadHex, `${id}: tail payload`);
      }
    });
  }

  it("the vector set covers every branch the plan lists (U04)", () => {
    const names = vectors.cases.map((c) => c.name).join(" ");
    for (const part of ["delta-open-column", "4503-ulps", "4504-ulps", "now-zero", "trade-count", "row-changed", "column-changed", "pin-changed", "pin-missing", "one-tier-differs", "delta-empty-tail"]) {
      assert.ok(names.includes(part), `no case for ${part}`);
    }
    assert.ok(vectors.cases.some((c) => c.expect.kind === "delta") && vectors.cases.some((c) => c.expect.kind === "pack"));
  });

  it("the old open column is always re-sent: the tail starts at the column holding the old end edge", () => {
    const c = vectors.cases.find((x) => x.name === "delta-open-column-grew");
    const blocks = model.tails(held(c.old, "old"), held(c.new, "new"));
    const recent = wire.decode(zlib.gunzipSync(Buffer.from(blocks.recent.gzip_base64, "base64")));
    assert.equal(blocks.recent.from, 1002, "old b1 was 1002.4: the open column 1002");
    assert.deepEqual(Array.from(recent.col), [1002, 1002, 1003, 1004]);
  });

  it("the tolerance is exactly numpy.allclose(atol = 0): |was - now| <= 1e-12 * |now|", () => {
    const one = (was, now) => {
      const side = (v) => ({
        pins: {},
        tiers: Object.fromEntries(model.TIERS.map((t) => [t.id, {
          block: { n: t.n, m: t.m, b0: 0, b1: 1, col0: 0, col1: 1, count: 1 },
          cells: { vol: Float64Array.of(v), tbvol: Float64Array.of(0), cnt: Float64Array.of(1), tbcnt: Float64Array.of(0), col: Uint32Array.of(0), row: Uint32Array.of(0) },
        }])),
      });
      return model.tails(side(was), side(now)) !== null;
    };
    assert.equal(one(2, 2 + 1e-12), true, "1e-12 is half of 1e-12 * 2");
    assert.equal(one(2, 2 + 4e-12), false);
    assert.equal(one(0, 0), true);
    assert.equal(one(1e-300, 0), false, "a zero now needs an exact zero");
    assert.equal(one(0, 1e-300), false, "the tolerance scales with now, not was");
  });
});

describe("exact sums (math.fsum)", () => {
  // Python documents fsum([.1] * 10) == 1.0 while sum() gives 0.9999999999999999, and fsum([1e100, 1.0, -1e100, 1e-100, 1e50, -1.0, -1e50]) == 1e-100.
  it("matches the documented results of math.fsum", () => {
    assert.equal(model.fsum(Array(10).fill(0.1)), 1.0);
    assert.notEqual(Array(10).fill(0.1).reduce((a, b) => a + b, 0), 1.0);
    assert.equal(model.fsum([1e100, 1.0, -1e100, 1e-100, 1e50, -1.0, -1e50]), 1e-100);
    assert.equal(model.fsum([]), 0);
    assert.equal(model.fsum([3]), 3);
  });
});

describe("the rule end to end over HTTP", () => {
  let fake;
  before(async () => {
    fake = await startFake({ profile: "mini" });
  });
  after(() => fake.close());

  const poll = async (since) => (await fetch(`${fake.url}/cube/pack?since=${since}&proto=2`)).json();
  const boot = async () => {
    fake.reset();
    return (await poll("")).pack.state_token;
  };

  it("a poll with the current token answers `current`; an empty or unknown `since` gets the whole pack", async () => {
    const token = await boot();
    const cur = await poll(token);
    assert.deepEqual(Object.keys(cur), ["status", "state_token", "age", "quiet", "next", "page"]);
    assert.equal(cur.status, "current");
    for (const since of ["", "nonsense"]) assert.equal((await poll(since)).status, "pack");
  });

  it("advance(): a delta whose tiers start at floor(old b1 / 2^n), with the new block's col0 and col1", async () => {
    const token = await boot();
    const before = fake.currentPack();
    fake.advance({ minutes: 3 });
    const body = await poll(token);
    assert.equal(body.status, "delta");
    assert.deepEqual(Object.keys(body), ["status", "cutoff", "cutoffBase", "data_cutoff", "canonical_through", "state_token", "partitions", "blocks", "age", "quiet", "next", "page"]);
    assert.notEqual(body.state_token, token);
    for (const t of model.TIERS) {
      const b = body.blocks[t.id];
      assert.equal(b.from, Math.floor(before.blocks[t.id].b1 / 2 ** t.n), t.id);
      const d = wire.decode(wire.gunzipBase64(b.gzip_base64));
      assert.equal(d.col0, b.col0);
      assert.equal(d.col1, b.col1);
      assert.ok(Array.from(d.col).every((c) => c >= b.from), "no kept column travels");
    }
    // The old open column (1 of the recent tier's columns >= floor(old b1)) is among the tail even though it is not new.
    const recent = wire.decode(wire.gunzipBase64(body.blocks.recent.gzip_base64));
    assert.equal(recent.col[0], Math.floor(before.blocks.recent.b1), "the old open column is re-sent");
  });

  it("rebuild(): a new token over the same content is a delta", async () => {
    const token = await boot();
    fake.rebuild();
    const body = await poll(token);
    assert.equal(body.status, "delta");
    assert.notEqual(body.state_token, token);
  });

  it("jitter(): equivalent sums in another order (last bits, same counts) are still a delta", async () => {
    const token = await boot();
    const before = fake.currentPack();
    fake.jitter(12345);
    const body = await poll(token);
    assert.equal(body.status, "delta");
    assert.equal(body.blocks.recent.count, before.blocks.recent.count, "counts identical");
  });

  it("revise(): a real revision of a closed day is a whole pack", async () => {
    const token = await boot();
    fake.revise({ day: "2026-09-22", factor: 1.5 });
    const body = await poll(token);
    assert.equal(body.status, "pack");
    assert.ok(body.pack.state_token && !("age" in body.pack), "timing sits outside pack");
  });

  it("a day that becomes canonical is a new partition: a whole pack", async () => {
    const token = await boot();
    fake.setCanonicalThrough("2026-09-24T00:00:00Z"); // already the default: nothing moves
    assert.equal((await poll(token)).status, "current", "the same boundary changes nothing");
    fake.setCanonicalThrough("2026-09-25T00:00:00Z"); // clipped to the cutoff: 09-24 stays provisional
    fake.setCanonicalThrough(null);
    assert.equal((await poll(token)).status, "pack", "every day archived: the prov: key of the last day is gone");
  });

  it("an expired pack, and more than 16 held packs, are whole packs", async () => {
    let token = await boot();
    fake.expirePack(token);
    fake.advance({ minutes: 1 });
    assert.equal((await poll(token)).status, "pack", "not held: whole");
    fake.reset();
    const first = (await poll("")).pack.state_token;
    for (let i = 0; i < 16; i++) {
      fake.advance({ minutes: 1 });
      token = (await poll("")).pack.state_token;
    }
    assert.equal(fake.bridge.held.size, 16);
    assert.ok(!fake.bridge.held.has(first), "the oldest of 17 packs was dropped");
    assert.equal((await poll(first)).status, "pack");
  });

  it("holdPacks(1) keeps only the newest pack", async () => {
    const token = await boot();
    fake.holdPacks(1);
    fake.advance({ minutes: 1 });
    assert.equal((await poll(token)).status, "pack");
    fake.holdPacks(16);
  });
});
