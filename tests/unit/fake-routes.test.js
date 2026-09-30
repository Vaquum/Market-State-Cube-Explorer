"use strict";
// U05 fake-routes.test.js (H2): the fake cube's HTTP boundary, route by route.
// Oracles: the route table and every error message of maps/bridge-fake-cube.md 1.4 (which follow tools/cube_bridge.py's Handler,
// integer, level and rectangle), copied here as literals; the closed-form `uniform` profile of TESTPLAN 4.4 (every full base cell
// holds 9 trades of a constant 0.004 BTC, so its volume is 9 * (0.5 * row + 0.25) USDT; path and dwell per cell are derived by hand
// in the comment of the motion test); decoding done with node:zlib and typed arrays in this file; and tests/fixtures/profiles/pins.json,
// the one self-pin: it only shows that the generators are stable (UPDATE_PINS=1 rewrites it after a deliberate change).
// The tests run the fake in-process and talk to it over real HTTP with the global fetch.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync } = require("node:child_process");
const { startFake } = require("../support/cube-fake.js");
const model = require("../support/bridge-model.js");
const wire = require("../support/wire.js");
const { resolvePageRoot, buildPageRoot } = require("../support/pageroot.js");
const { materialise } = require("../support/builds.js");

const ROOT = path.resolve(__dirname, "..", "..");
const PINS = path.join(ROOT, "tests", "fixtures", "profiles", "pins.json");
// Temporary directories made by these tests, removed when the file is done.
const made = [];
const tmpdir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const OUTDATED = "the explorer was updated; reload the page to see the latest data";

// ---- helpers ----

async function get(fake, pathAndQuery, headers = {}) {
  const response = await fetch(fake.url + pathAndQuery, { headers });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), text, json, headers: response.headers };
}

const qs = (params) => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
const cube = (fake, route, params, token) => get(fake, `/cube/${route}?${qs({ ...params, pack: token ?? fake.info().packToken, proto: 2 })}`);
const decodeOf = (block) => {
  // Independent of wire.decode: node:zlib and a DataView.
  const bytes = zlib.gunzipSync(Buffer.from(block.gzip_base64, "base64"));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const magic = bytes.toString("latin1", 0, 4);
  const count = dv.getUint32(16, true);
  const layouts = {
    MSC2: ["vol", "tbvol", "cnt", "tbcnt", "col", "row"], MSC3: ["vol", "tbvol", "cnt", "tbcnt", "path", "dwell", "high", "low", "col", "row"],
    MSCB: ["open", "high", "low", "close", "vol", "tbvol", "btc", "cnt", "col"], MSCC: ["col", "poc", "vol", "tbvol"],
  };
  const out = { magic, n: dv.getUint8(4), m: dv.getUint8(5), col0: dv.getUint32(8, true), col1: dv.getUint32(12, true), count };
  let at = 32;
  for (const key of layouts[magic]) {
    const kind = key === "col" || key === "row" || key === "poc" ? "u32" : magic === "MSCC" ? "f32" : "f64";
    out[key] = [];
    for (let i = 0; i < count; i++) {
      out[key].push(kind === "u32" ? dv.getUint32(at, true) : kind === "f32" ? dv.getFloat32(at, true) : dv.getFloat64(at, true));
      at += kind === "f64" ? 8 : 4;
    }
  }
  assert.equal(at, bytes.length);
  return out;
};
const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;
const sum = (values) => values.reduce((a, b) => a + b, 0); // plain summation: the tolerance of `near` covers its rounding, and no code under test is used as the oracle
const baseOf = (iso) => (Date.parse(iso) - Date.parse("2021-01-01T00:00:00Z")) / 56250;

describe("validation and error shapes", () => {
  let fake;
  before(async () => { fake = await startFake({ profile: "mini" }); });
  after(() => fake.close());

  const info = () => fake.info();
  const top = () => Math.ceil(info().cutoffBase);
  const closed = () => Math.floor(info().cutoffBase);

  it("the protocol is checked before routing, for every /cube/ path including unknown ones", async () => {
    const exact = JSON.stringify({ error: OUTDATED, reload: true });
    for (const url of ["/cube/xyz", "/cube/pack", "/cube/pack?proto=1", "/cube/pack?proto=3", "/cube/tile?n=0&m=0&b0=0&b1=1", "/cube/pack?since=&proto="]) {
      const r = await get(fake, url);
      assert.equal(r.status, 409, url);
      assert.equal(r.text, exact, url);
      assert.equal(r.type, "application/json");
      assert.equal(r.cache, "no-store");
    }
    const bad = fake.log().filter((e) => e.unexpected && /protocol mismatch/.test(e.unexpected));
    assert.equal(bad.length, 6);
    fake.clearLog();
  });

  const cases = [
    ["level: n too big", "tile", { n: 25, m: 0, b0: 0, b1: 10 }, "n must be 0..24 and m 0..12"],
    ["level: m too big", "tile", { n: 0, m: 13, b0: 0, b1: 10 }, "n must be 0..24 and m 0..12"],
    ["level: n negative", "tile", { n: -1, m: 0, b0: 0, b1: 10 }, "n must be 0..24 and m 0..12"],
    ["n missing", "tile", { m: 0, b0: 0, b1: 10 }, "n must be an integer"],
    ["n not an integer", "tile", { n: 1.5, m: 0, b0: 0, b1: 10 }, "n must be an integer"],
    ["b0 not a number", "tile", { n: 0, m: 0, b0: "abc", b1: 10 }, "b0 must be an integer"],
    ["b1 missing", "tile", { n: 0, m: 0, b0: 0 }, "b1 must be an integer"],
    ["rectangle: b0 == b1", "tile", { n: 0, m: 0, b0: 5, b1: 5 }, "b0 and b1 must be base edges with b0 < b1"],
    ["rectangle: b0 negative", "tile", { n: 0, m: 0, b0: -1, b1: 5 }, "b0 and b1 must be base edges with b0 < b1"],
    ["rectangle: more than 4096 columns", "tile", { n: 0, m: 0, b0: 0, b1: 4097 }, "more than 4096 columns"],
    ["rectangle: 4097 columns at n = 1", "tile", { n: 1, m: 0, b0: 0, b1: 8193 }, "more than 4096 columns"],
    ["query: r1 missing", "query", { n: 0, m: 0, b0: 0, b1: 10, r0: 5 }, "r1 must be an integer"],
    ["query: r0 == r1", "query", { n: 0, m: 0, b0: 0, b1: 10, r0: 5, r1: 5 }, "r0 and r1 must be base rows with r0 < r1"],
    ["query: r1 beyond 2**32", "query", { n: 0, m: 0, b0: 0, b1: 10, r0: 5, r1: 4294967297 }, "r0 and r1 must be base rows with r0 < r1"],
    ["b1 after the pack's cutoff (tile)", "tile", () => ({ n: 0, m: 0, b0: top() - 5, b1: top() + 1 }), "b1 is after the pack's cutoff"],
    ["b1 after the pack's cutoff (query)", "query", () => ({ n: 0, m: 0, b0: top() - 5, b1: top() + 1 }), "b1 is after the pack's cutoff"],
    ["b1 after the pack's cutoff (motion tile)", "tile", () => ({ n: 0, m: 0, b0: top() - 5, b1: top() + 1, motion: 1 }), "b1 is after the pack's cutoff"],
    ["touched: n out of range", "touched", { n: 24, b0: 0, b1: 4 }, "n must be 0..23"],
    ["touched: not whole parent columns", "touched", { n: 0, b0: 1, b1: 4 }, "b0 and b1 must be the edges of whole parent columns, b0 < b1"],
    ["touched: b1 not on a parent edge", "touched", { n: 1, b0: 0, b1: 6 }, "b0 and b1 must be the edges of whole parent columns, b0 < b1"],
    ["touched: more than 4096 columns", "touched", { n: 0, b0: 0, b1: 8194 }, "more than 4096 columns"],
    ["bars: level set", "bars", { n: 3, b0: 0, b1: 8 }, "n must be 2, 4, 6, 8 or 9: bars of 3.75 minutes, 15 minutes, 1, 4 or 8 hours"],
    ["bars: b0 not a bar's edge", "bars", { n: 2, b0: 3, b1: 10 }, "b0 must be a bar's edge and b1 after it"],
    ["bars: b1 not after b0", "bars", { n: 2, b0: 8, b1: 8 }, "b0 must be a bar's edge and b1 after it"],
    ["bars: more than 4096 bars", "bars", { n: 2, b0: 0, b1: 4 * 4097 }, "more than 4096 bars"],
    ["bars: b1 after the cutoff", "bars", () => ({ n: 2, b0: 3214080, b1: 3214090 }), "b1 is after the pack's cutoff"],
    ["motion: unknown tier", "motion", { tier: "nope" }, "tier must be overview, recent or reference"],
    ["motion: tier missing", "motion", {}, "tier must be overview, recent or reference"],
    ["motion: negative from", "motion", { tier: "recent", from: -1 }, "from must be a base edge"],
    ["motion: from not an integer", "motion", { tier: "recent", from: "x" }, "from must be an integer"],
    ["columns: level", "columns", { n: 0, m: 99 }, "n must be 0..24 and m 0..12"],
  ];
  for (const [name, route, params, message] of cases) {
    it(`400 ${name}`, async () => {
      const r = await cube(fake, route, typeof params === "function" ? params() : params);
      assert.equal(r.status, 400, r.text);
      assert.equal(r.text, JSON.stringify({ error: message }));
    });
  }

  it("integers are floats that are whole: 3.0 and 1e3 pass, and blank values count as missing (parse_qs)", async () => {
    const ok = await cube(fake, "tile", { n: 0, m: 0, b0: "3.0", b1: "1e3" });
    assert.equal(ok.status, 200);
    const blank = await get(fake, `/cube/tile?n=0&m=0&b0=&b1=10&pack=${info().packToken}&proto=2`);
    assert.equal(blank.text, JSON.stringify({ error: "b0 must be an integer" }));
    const first = await get(fake, `/cube/tile?n=0&m=0&b0=1&b0=999&b1=10&pack=${info().packToken}&proto=2`);
    assert.equal(first.status, 200, "the first value wins");
  });

  it("/cube/tile ignores r0 and r1; /cube/query validates them", async () => {
    const tile = await cube(fake, "tile", { n: 0, m: 0, b0: closed() - 5, b1: closed(), r0: 9, r1: 3 });
    assert.equal(tile.status, 200);
    assert.ok(!("summary" in tile.json));
  });

  it("an unknown path is a 404 `not found`, logged as unexpected; so is /__fake/ without the control API", async () => {
    fake.clearLog();
    const r = await get(fake, "/nope");
    assert.equal(r.status, 404);
    assert.equal(r.text, "not found");
    assert.equal(r.type, "text/plain");
    const c = await get(fake, "/__fake/info");
    assert.equal(c.status, 404);
    const unknown = await cube(fake, "xyz", {});
    assert.equal(unknown.status, 404, "a /cube/ path with the protocol but no route");
    assert.throws(() => fake.assertNoUnexpected(), /404 \/nope[\s\S]*404 \/__fake\/info[\s\S]*404 \/cube\/xyz/);
    fake.clearLog();
    fake.assertNoUnexpected();
  });

  it("/healthz answers ok, /favicon.ico is 204 and neither is unexpected", async () => {
    fake.clearLog();
    const h = await get(fake, "/healthz");
    assert.deepEqual([h.status, h.text, h.type], [200, "ok", "text/plain"]);
    assert.equal((await get(fake, "/favicon.ico")).status, 204);
    fake.assertNoUnexpected();
  });

  it("an unknown token is 409 cube_changed for every read that needs a held pack", async () => {
    const body = JSON.stringify({ error: "cube_changed", detail: "the page's pack is no longer held by the server" });
    const c = closed();
    const reads = [
      ["tile", { n: 0, m: 0, b0: c - 5, b1: c }], ["query", { n: 0, m: 0, b0: c - 5, b1: c }], ["tile", { n: 0, m: 0, b0: c - 5, b1: c, motion: 1 }],
      ["query", { n: 0, m: 0, b0: c - 5, b1: c, motion: 1 }], ["touched", { n: 0, b0: c - (c % 2) - 4, b1: c - (c % 2) }], ["motion", { tier: "recent" }],
      ["columns", { n: 4, m: 0 }], ["bars", { n: 2, b0: 3214060, b1: 3214080 }],
    ];
    for (const [route, params] of reads) {
      const r = await cube(fake, route, params, "0".repeat(64));
      assert.equal(r.status, 409, `${route} ${JSON.stringify(params)}`);
      assert.equal(r.text, body);
    }
  });

  it("bars are served from the cache before the pack is asked for, but a new span needs a held pack", async () => {
    fake.reset();
    const token = fake.info().packToken;
    const params = { n: 9, b0: 3211264, b1: closed() };
    assert.equal((await cube(fake, "bars", params, token)).status, 200);
    fake.expirePack(token);
    assert.equal((await cube(fake, "bars", params, token)).status, 200, "cached: bars are answered before holding()");
    assert.equal((await cube(fake, "bars", { ...params, b1: closed() - 1 }, token)).status, 409);
  });

  it("the cell cap answers 400 with the bridge's wording", async () => {
    fake.reset();
    const c = closed();
    const token = info().packToken;
    fake.setMaxCells(20);
    try {
      const r = await cube(fake, "tile", { n: 0, m: 0, b0: c - 400, b1: c }, token);
      assert.equal(r.status, 400);
      assert.match(r.json.error, /^\d+ cells is more than 20; ask for coarser cells$/);
    } finally {
      fake.setMaxCells(model.MAX_CELLS);
    }
  });
});

describe("the pack, the tiers and the page", () => {
  let fake;
  before(async () => { fake = await startFake({ profile: "mini" }); });
  after(() => fake.close());

  it("the whole pack has the bridge's keys, three tiers laid out as cube_bridge.pack() lays them out, and says SYNTHETIC", async () => {
    const r = await get(fake, "/cube/pack?since=&proto=2");
    assert.deepEqual(Object.keys(r.json), ["status", "pack", "age", "quiet", "next", "page"]);
    const p = r.json.pack;
    assert.deepEqual(Object.keys(p), ["source", "t0", "base_seconds", "base_price", "cutoff", "cutoffBase", "data_cutoff", "canonical_through", "state_token", "partitions", "snapshot", "live", "notes", "blocks"]);
    assert.equal(p.source, "SYNTHETIC fixture mini seed 20260924 - not market data");
    assert.equal(p.notes[0], p.source);
    assert.deepEqual([p.t0, p.base_seconds, p.base_price, p.live, p.snapshot], [1609459200, 56.25, 125, true, false]);
    assert.equal(p.cutoff, "2026-09-24T12:02:00.000000Z");
    assert.equal(p.cutoff, p.data_cutoff);
    assert.equal(p.canonical_through, "2026-09-24T00:00:00.000000Z");
    assert.equal(p.cutoffBase, (Date.parse(p.cutoff) / 1000 - 1609459200) / 56.25, "the page's CUT expression");
    assert.match(p.state_token, /^[0-9a-f]{64}$/);
    assert.equal(p.partitions, 3, "one pin per UTC day with trades: 09-22, 09-23, 09-24");
    assert.deepEqual([r.json.quiet, r.json.next, r.json.page], [2, 3, "fake-page-1"]);
    const cutoff = p.cutoffBase;
    const top = Math.ceil(cutoff);
    const b = p.blocks;
    assert.deepEqual([b.overview.n, b.overview.m, b.overview.b0, b.overview.b1], [12, 3, 0, cutoff]);
    assert.deepEqual([b.recent.n, b.recent.m, b.recent.b0, b.recent.b1], [0, 0, top - 10752, cutoff]);
    const ref = Math.floor(cutoff) - (Math.floor(cutoff) % 16);
    assert.deepEqual([b.reference.n, b.reference.m, b.reference.b0, b.reference.b1], [4, 0, ref - 46080, ref]);
    for (const [id, meta] of Object.entries(b)) {
      assert.deepEqual(Object.keys(meta), ["n", "m", "b0", "b1", "start", "end", "count", "col0", "col1", "encoding", "layout", "gzip_base64", "totals"], id);
      assert.equal(meta.col0, Math.floor(meta.b0 / 2 ** meta.n));
      assert.equal(meta.col1, Math.ceil(meta.b1 / 2 ** meta.n));
      const d = decodeOf(meta);
      assert.deepEqual([d.magic, d.n, d.m, d.col0, d.col1, d.count], ["MSC2", meta.n, meta.m, meta.col0, meta.col1, meta.count], id);
      assert.ok(d.col.every((c, i) => i === 0 || c > d.col[i - 1] || (c === d.col[i - 1] && d.row[i] > d.row[i - 1])), `${id} sorted and unique`);
      assert.equal(meta.totals.trades, d.cnt.reduce((a, c) => a + c, 0));
      assert.ok(near(meta.totals.volume, d.vol.reduce((a, c) => a + c, 0)));
    }
    assert.equal(b.recent.col1, top, "the open column is in the recent tier");
  });

  it("two fakes with equal options serve byte-equal packs and pages; a different seed does not", async () => {
    const other = await startFake({ profile: "mini" });
    const different = await startFake({ profile: "mini", seed: 7 });
    try {
      assert.equal(JSON.stringify(fake.currentPack()), JSON.stringify(other.currentPack()));
      assert.equal((await get(fake, "/")).text, (await get(other, "/")).text);
      assert.notEqual(JSON.stringify(fake.currentPack()), JSON.stringify(different.currentPack()));
      fake.advance({ minutes: 5 });
      other.advance({ minutes: 5 });
      assert.equal(JSON.stringify(fake.currentPack()), JSON.stringify(other.currentPack()), "the same advance gives the same trades");
    } finally {
      await other.close();
      await different.close();
      fake.reset();
    }
  });

  it("advance(): whole minutes only, later than the cutoff, and the incremental cells equal a rebuild from the trades", () => {
    fake.reset();
    const start = fake.cube.cutoffMs;
    assert.throws(() => fake.advance({ toIso: "2026-09-24T12:02:00Z" }), /does not move the cutoff/);
    fake.advance({ toIso: "2026-09-24T12:05:30Z" });
    assert.equal(fake.cube.cutoffMs, start + 3 * 60000, "12:05:30 snaps down to the minute edge 12:05");
    const incremental = fake.cube.store.cells();
    const fresh = fake.cube.store.clone();
    fresh.cellsCache = null;
    const rebuilt = fresh.cells();
    for (const key of Object.keys(rebuilt)) assert.deepEqual(Array.from(incremental[key]), Array.from(rebuilt[key]), key);
    fake.reset();
  });

  it("the page: the pack is injected with the bridge's regex, timing included, and everything else is byte-preserved", async () => {
    const dir = tmpdir("fake-page-");
    fs.mkdirSync(path.join(dir, "vendor"));
    fs.writeFileSync(path.join(dir, "vendor", "d3.min.js"), "//d3");
    const head = "<!doctype html><title>t</title>";
    const tail = "<script>var x = 1;</script>";
    fs.writeFileSync(path.join(dir, "index.html"), `${head}<script type="application/json" id="origo-lens-data">{"recorded":true}</script>${tail}`);
    const f = await startFake({ profile: "mini", pageRoot: dir });
    try {
      for (const p of ["/", "/index.html"]) {
        const r = await get(f, p);
        assert.equal(r.status, 200);
        assert.equal(r.type, "text/html; charset=utf-8");
        assert.ok(r.text.startsWith(`${head}<script type="application/json" id="origo-lens-data">`));
        assert.ok(r.text.endsWith(`</script>${tail}`));
        const data = JSON.parse(/id="origo-lens-data">(.*?)<\/script>/s.exec(r.text)[1]);
        assert.equal(data.live, true);
        assert.equal(data.page, "fake-page-1");
        assert.equal(data.state_token, f.currentPack().state_token);
        assert.ok(!("recorded" in data));
      }
      const vendor = await get(f, "/vendor/d3.min.js");
      assert.deepEqual([vendor.status, vendor.type, vendor.text], [200, "application/javascript", "//d3"]);
      assert.equal((await get(f, "/vendor/other.js")).status, 404, "only the two allow-listed vendor files");
      assert.equal((await get(f, "/vendor/..%2findex.html")).status, 404, "no path out of vendor/");
    } finally {
      await f.close();
    }
  });

  it("injectPack escapes '<' like the bridge and fails on anything but exactly one block", () => {
    const block = '<script type="application/json" id="origo-lens-data">{}</script>';
    const out = model.injectPack(`a${block}b`, { note: "</script><!--" });
    assert.ok(out.startsWith('a<script type="application/json" id="origo-lens-data">') && out.endsWith("</script>b"));
    assert.ok(!out.slice(60, -10).includes("<"), "no raw '<' inside the injected data");
    assert.deepEqual(JSON.parse(/>(\{.*\})<\/script>b$/.exec(out)[1]), { note: "</script><!--" });
    for (const bad of ["<html></html>", `${block}${block}`, `<script id="origo-lens-data" type="application/json">{}</script>`]) {
      assert.throws(() => model.injectPack(bad, {}), (e) => e.name === "RuntimeError" && e.message === "index.html has no origo-lens-data block; run tools/build.py first.");
    }
  });

  it("a page without the block is a 502 with the bridge's message, logged as unanswerable", async () => {
    const dir = tmpdir("fake-page-");
    fs.writeFileSync(path.join(dir, "index.html"), "<html>no data block here</html>");
    const f = await startFake({ profile: "mini", pageRoot: dir });
    try {
      const r = await get(f, "/");
      assert.equal(r.status, 502);
      assert.equal(r.text, JSON.stringify({ error: "RuntimeError: index.html has no origo-lens-data block; run tools/build.py first." }));
      assert.throws(() => f.assertNoUnexpected(), /unanswerable: RuntimeError/);
    } finally {
      await f.close();
    }
  });

  it("recorded mode serves the file unmodified and treats every /cube/ request as unexpected", async () => {
    const dir = tmpdir("fake-page-");
    fs.mkdirSync(path.join(dir, "vendor"));
    fs.writeFileSync(path.join(dir, "vendor", "d3.min.js"), "//d3");
    const html = '<script type="application/json" id="origo-lens-data">{"snapshot":true}</script>';
    fs.writeFileSync(path.join(dir, "index.html"), html);
    const f = await startFake({ mode: "recorded", pageRoot: dir });
    try {
      assert.equal((await get(f, "/")).text, html);
      f.assertNoUnexpected();
      const r = await get(f, "/cube/pack?since=&proto=2");
      assert.equal(r.status, 404);
      assert.throws(() => f.assertNoUnexpected(), /recorded page/);
      assert.throws(() => f.advance({ minutes: 1 }), /recorded page/);
      assert.deepEqual(f.info(), { mode: "recorded", pageRoot: dir });
    } finally {
      await f.close();
    }
  });

  it("Basic auth, when configured, guards everything but /healthz", async () => {
    const f = await startFake({ profile: "mini", auth: { user: "u", pass: "p" } });
    try {
      const denied = await get(f, "/");
      assert.equal(denied.status, 401);
      assert.equal(denied.text, "Authentication required.");
      assert.equal(denied.headers.get("www-authenticate"), 'Basic realm="Market State Cube", charset="UTF-8"');
      assert.equal((await get(f, "/healthz")).status, 200);
      const wrong = await get(f, "/", { Authorization: `Basic ${Buffer.from("u:x").toString("base64")}` });
      assert.equal(wrong.status, 401);
      const ok = await get(f, "/cube/pack?since=&proto=2", { Authorization: `Basic ${Buffer.from("u:p").toString("base64")}` });
      assert.equal(ok.status, 200);
    } finally {
      await f.close();
    }
  });
});

describe("reads: the open column, the last closed column, coverage and summaries", () => {
  let fake;
  // 12:13 is 48.8 s into base column 3214093, so the open column holds a few of the mini profile's trades (12:02 is 7.5 s in: often none).
  before(async () => { fake = await startFake({ profile: "mini", cutoff: "2026-09-24T12:13:00Z" }); });
  after(() => fake.close());

  const cutoff = () => fake.info().cutoffBase;
  const closed = () => Math.floor(cutoff());
  const top = () => Math.ceil(cutoff());

  it("tile and query merge the open column FROM the pack: a later advance() does not leak into reads under the old token", async () => {
    fake.reset();
    const token = fake.info().packToken;
    const open = closed(); // captured now: after advance() the cube's cutoff, and so closed(), moves on
    const recent = decodeOf(fake.currentPack().blocks.recent);
    const openCells = recent.col.map((c, i) => [c, i]).filter(([c]) => c === open);
    assert.ok(openCells.length > 0, "the mini cutoff is fractional, so column `closed` is open and has trades");
    const params = { n: 0, m: 0, b0: open, b1: top() };
    const before = await cube(fake, "tile", params, token);
    const block = decodeOf(before.json.block);
    assert.deepEqual(block.col, openCells.map(() => open));
    assert.deepEqual(block.vol, openCells.map(([, i]) => recent.vol[i]), "the open cells are the pack's own");
    assert.equal(before.json.block.b1, cutoff(), "block b1 = min(top, cutoff)");
    // One explicit trade one second after the cutoff, inside the same base column (48.8 s in, 56.25 s long): the live store's open column grows.
    const store = fake.cube.store;
    fake.advance({ minutes: 1, trades: [{ t: fake.cube.cutoffMs + 1000, price: store.price[store.length - 1], qty: 100000000, buy: true }] });
    const live = fake.cube.store.cells();
    const liveOpen = Array.from(live.col).map((c, i) => [c, i]).filter(([c]) => c === open).reduce((s, [, i]) => s + live.vol[i], 0);
    assert.ok(liveOpen > block.vol.reduce((a, c) => a + c, 0), "the live store's open column gained trades");
    const after = await cube(fake, "tile", params, token);
    assert.equal(after.text, before.text, "byte-equal: the old pack's open column, not the cube's");
    const query = await cube(fake, "query", params, token);
    assert.equal(query.json.summary.source, "cube+pack");
    assert.equal(query.json.summary.last_column_unfinished, true);
    assert.ok(near(query.json.summary.volume, sum(block.vol)), "the summary's volume is the sum of the cells it merged");
    fake.reset();
  });

  it("query: the summary the page reads (volume, taker-buy volume, counts, POCs) is exact over the cells, and its source says where the cells came from", async () => {
    fake.reset();
    const c = closed();
    const params = { n: 2, m: 1, b0: c - (c % 4) - 400, b1: c, r0: 150, r1: 300 };
    const r = await cube(fake, "query", params);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json), ["cutoff", "block", "summary"]);
    const s = r.json.summary;
    assert.deepEqual(Object.keys(s), [
      "t1", "t2", "p1", "p2", "tR", "pR", "first_column_partial", "last_column_partial", "first_row_partial", "last_row_partial", "last_column_unfinished",
      "volume", "trade_count", "taker_buy_volume", "taker_buy_trade_count", "poc", "taker_buy_poc", "cell_count", "source", "data_cutoff", "canonical_through", "state_token",
    ]);
    const d = decodeOf(r.json.block);
    assert.equal(s.source, "cube");
    assert.equal(s.cell_count, d.count);
    assert.ok(near(s.volume, sum(d.vol)));
    assert.equal(s.trade_count, d.cnt.reduce((a, x) => a + x, 0));
    assert.equal(s.taker_buy_trade_count, d.tbcnt.reduce((a, x) => a + x, 0));
    assert.deepEqual([s.tR, s.pR, s.p1, s.p2], [56.25 * 4, 250, 150 * 125, 300 * 125]);
    // POC: the centre of the level row with the most volume (lower row wins a tie).
    const perRow = new Map();
    d.row.forEach((row, i) => perRow.set(row, (perRow.get(row) ?? 0) + d.vol[i]));
    const best = [...perRow.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    assert.equal(s.poc, (best + 0.5) * 125 * 2);
    assert.equal(s.data_cutoff, fake.currentPack().data_cutoff);
    assert.equal(s.state_token, fake.info().packToken);
    assert.equal(s.canonical_through, "2026-09-24T00:00:00.000000Z");
    assert.equal(s.first_column_partial, false);
  });

  it("the read is bounded by the base rows asked for, in base rows", async () => {
    const c = closed();
    const all = decodeOf((await cube(fake, "query", { n: 0, m: 0, b0: c - 100, b1: c, r0: 0, r1: 100000 })).json.block);
    const rows = [...new Set(all.row)].sort((a, b) => a - b);
    assert.ok(rows.length >= 2);
    const cut = decodeOf((await cube(fake, "query", { n: 0, m: 0, b0: c - 100, b1: c, r0: rows[1], r1: rows[1] + 1 })).json.block);
    assert.ok(cut.row.every((r) => r === rows[1]));
    assert.equal(cut.count, all.row.filter((r) => r === rows[1]).length);
  });

  it("motion, bars and columns stop at floor(cutoff); the pack tiers alone hold the open column", async () => {
    fake.reset();
    const c = closed();
    const token = fake.info().packToken;
    const rec = (await cube(fake, "motion", { tier: "recent" }, token)).json;
    assert.deepEqual([rec.tier, rec.whole, rec.end, rec.through, rec.state_token], ["recent", true, c, wire.iso(c), token]);
    assert.equal(rec.block.b1, c);
    assert.equal(rec.from, rec.col0, "the whole tier: from = the tier's first column");
    const d = decodeOf(rec.block);
    assert.equal(d.magic, "MSC3");
    assert.ok(d.col.every((x) => x < c), "no open column in motion");
    const ref = (await cube(fake, "motion", { tier: "reference" }, token)).json;
    assert.equal(ref.end, c - (c % 16), "the reference tier stops at its last complete 15-minute column");
    const ov = (await cube(fake, "motion", { tier: "overview" }, token)).json;
    assert.equal(ov.end, c);
    const part = (await cube(fake, "motion", { tier: "recent", from: c - 100 }, token)).json;
    assert.deepEqual([part.whole, part.from, part.block.b0], [false, c - 100, c - 100]);
    assert.ok(decodeOf(part.block).col.every((x) => x >= c - 100 && x < c));

    const bars = (await cube(fake, "bars", { n: 9, b0: 3211264, b1: top() }, token)).json;
    assert.deepEqual([bars.end, bars.through, bars.n, bars.bars.layout, bars.bars.encoding], [c, wire.iso(c), 9, "MSCB", "gzip+base64"]);
    const b = decodeOf(bars.bars);
    assert.equal(b.m, 20);
    assert.ok(b.col.every((x) => x < Math.ceil(c / 512)));
    assert.equal(bars.bars.col1, Math.ceil(c / 512));

    const cols = (await cube(fake, "columns", { n: 4, m: 0 }, token)).json;
    assert.deepEqual([cols.columns.layout, cols.columns.b1, cols.columns.b0], ["MSCC", c - (c % 16), Math.max(0, c - (c % 16) - 1600000)]);
    const h = decodeOf(cols.columns);
    assert.equal(h.col1, (c - (c % 16)) / 16);
    assert.ok(h.col.every((x) => x < h.col1) && h.count === cols.columns.count && h.count > 0);

    const tile = (await cube(fake, "tile", { n: 0, m: 0, b0: c - 50, b1: top(), motion: 1 }, token)).json;
    assert.deepEqual([tile.end, tile.through], [c, wire.iso(c)]);
    assert.ok(decodeOf(tile.block).col.every((x) => x < c));
    assert.ok(!("summary" in tile));
    const query = (await cube(fake, "query", { n: 0, m: 0, b0: c - 50, b1: c, motion: 1 }, token)).json;
    assert.ok(query.summary.path_length > 0 && query.summary.dwell > 0);
    assert.equal(query.summary.source, "cube");
  });

  it("motionThrough(): measures end early, and a read wholly beyond the coverage is an empty block that ends at the coverage", async () => {
    fake.reset();
    const c = closed();
    const token = fake.info().packToken;
    fake.motionThrough(c - 82);
    const early = (await cube(fake, "tile", { n: 0, m: 0, b0: c - 200, b1: c, motion: 1 }, token)).json;
    assert.deepEqual([early.end, early.through, early.block.b1], [c - 82, wire.iso(c - 82), c - 82]);
    assert.ok(early.end < c && decodeOf(early.block).col.every((x) => x < c - 82));
    const beyond = (await cube(fake, "tile", { n: 0, m: 0, b0: c - 40, b1: c, motion: 1 }, token)).json;
    assert.equal(beyond.block.count, 0);
    assert.equal(beyond.end, c - 82, "end stays at the coverage, before b0");
    assert.equal(beyond.block.b1, c - 40, "the block's b1 = max(b0, end)");
    const bars = (await cube(fake, "bars", { n: 2, b0: c - (c % 4) - 400, b1: c }, token)).json;
    assert.equal(bars.end, c - 82);
    fake.motionThrough(wire.iso(c - 10));
    assert.equal((await cube(fake, "motion", { tier: "recent" }, token)).json.end, c - 10, "an ISO string works too");
    fake.motionThrough(null);
    assert.equal((await cube(fake, "motion", { tier: "recent" }, token)).json.end, c);
  });

  it("a day revised after the pack was built breaks only the reads that touch it (409 cube_changed), and the next poll gets a whole pack", async () => {
    fake.reset();
    const token = fake.info().packToken;
    const at = (iso) => Math.round(baseOf(iso));
    fake.revise({ day: "2026-09-22", factor: 1.5 });
    const clean = await cube(fake, "tile", { n: 0, m: 0, b0: at("2026-09-23T02:00:00Z"), b1: at("2026-09-23T03:00:00Z") }, token);
    assert.equal(clean.status, 200, "a read of another day is unaffected");
    const dirty = await cube(fake, "tile", { n: 0, m: 0, b0: at("2026-09-22T18:00:00Z"), b1: at("2026-09-22T19:00:00Z") }, token);
    assert.equal(dirty.status, 409);
    assert.match(dirty.json.detail, /^1 partition\(s\) differ from the page's pack, first day:2026-09-22$/);
    const spanning = await cube(fake, "tile", { n: 0, m: 0, b0: at("2026-09-22T23:00:00Z"), b1: at("2026-09-23T01:00:00Z") }, token);
    assert.equal(spanning.status, 409);
    const poll = await get(fake, `/cube/pack?since=${token}&proto=2`);
    assert.equal(poll.json.status, "pack");
    assert.equal((await cube(fake, "tile", { n: 0, m: 0, b0: at("2026-09-22T18:00:00Z"), b1: at("2026-09-22T19:00:00Z") }, poll.json.pack.state_token)).status, 200);
    fake.reset();
  });

  it("touched: per-column USDT and distinct rows, at level n and one level up", async () => {
    const c = closed();
    const b1 = c - (c % 4);
    const r = await cube(fake, "touched", { n: 1, b0: b1 - 40, b1 });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json), ["n", "b0", "b1", "cutoff", "columns", "parents"]);
    const cols = r.json.columns;
    const cells = decodeOf((await cube(fake, "tile", { n: 1, m: 0, b0: b1 - 40, b1 })).json.block);
    assert.deepEqual(cols.col, [...new Set(cells.col)]);
    cols.col.forEach((col, i) => {
      const mine = cells.col.map((x, k) => [x, k]).filter(([x]) => x === col).map(([, k]) => k);
      assert.equal(cols.rows[i], new Set(mine.map((k) => cells.row[k])).size);
      assert.ok(near(cols.volume[i], sum(mine.map((k) => cells.vol[k]))));
    });
    const parents = r.json.parents;
    assert.deepEqual(parents.col, [...new Set(cells.col.map((x) => x >> 1))]);
  });
});

describe("the uniform profile is closed form (TESTPLAN 4.4, DD-T11)", () => {
  let fake;
  before(async () => { fake = await startFake({ profile: "uniform" }); });
  after(() => fake.close());
  const closed = () => Math.floor(fake.info().cutoffBase);

  // Trade k (t = 1250 ms * k) sits in base row 200 + k mod 5 at price 125 * row + 62.5 USDT, 0.004 BTC. A base column is 45 steps, so
  // each of its five rows holds 9 trades: cnt 9, and volume 9 * (0.5 * row + 0.25) USDT. Taker buys alternate with k.
  it("every full base cell holds 9 trades and 9 * (0.5 * row + 0.25) USDT", async () => {
    const c = closed();
    const r = await cube(fake, "tile", { n: 0, m: 0, b0: c - 200, b1: c });
    const d = decodeOf(r.json.block);
    assert.equal(d.count, 200 * 5);
    for (let i = 0; i < d.count; i++) {
      assert.ok(d.row[i] >= 200 && d.row[i] <= 204);
      assert.equal(d.cnt[i], 9);
      assert.equal(d.vol[i], 9 * (0.5 * d.row[i] + 0.25));
      assert.ok(d.tbcnt[i] === 4 || d.tbcnt[i] === 5);
      assert.equal(d.tbvol[i], d.tbcnt[i] * (0.5 * d.row[i] + 0.25));
    }
  });

  // Motion by hand. Steps between trades go 200 -> 201 -> 202 -> 203 -> 204 -> 200, one step per 1.25 s. Row centres are 125 USDT apart, so
  // each up-step of 125 USDT is half in the lower row and half in the upper (62.5 + 62.5); the wrap 204 -> 200 is 500 USDT: half of row 204
  // (62.5), all of 203, 202, 201 (125 each) and half of row 200 (62.5). Per cycle of five trades: row 200 = 62.5 + 62.5 = 125, rows 201-203 =
  // 62.5 + 62.5 + 125 = 250, row 204 = 62.5 + 62.5 = 125. A column holds nine cycles and its first trade's step (the wrap) comes from the previous
  // column's last trade, so per cell path = 1125 (rows 200, 204) or 2250 (rows 201-203). Each trade holds its price 1.25 s, so a row's dwell is
  // 9 * 1.25 = 11.25 s; the whole column's is 56.25 s. High = low = the row's centre price.
  it("motion: path 1125 / 2250 / 2250 / 2250 / 1125 USDT, dwell 11.25 s and high = low = 125 * row + 62.5 in every full cell", async () => {
    const c = closed();
    const r = await cube(fake, "tile", { n: 0, m: 0, b0: c - 20, b1: c, motion: 1 });
    const d = decodeOf(r.json.block);
    assert.equal(d.magic, "MSC3");
    assert.equal(d.count, 100);
    const path = { 200: 1125, 201: 2250, 202: 2250, 203: 2250, 204: 1125 };
    for (let i = 0; i < d.count; i++) {
      assert.ok(near(d.path[i], path[d.row[i]]), `path ${d.path[i]} in row ${d.row[i]}`);
      assert.ok(near(d.dwell[i], 11.25));
      assert.equal(d.high[i], 125 * d.row[i] + 62.5);
      assert.equal(d.low[i], d.high[i]);
      assert.equal(d.cnt[i], 9);
    }
    const q = await cube(fake, "query", { n: 0, m: 0, b0: c - 20, b1: c, motion: 1 });
    assert.ok(near(q.json.summary.dwell, 20 * 56.25), "a column's dwell over all rows is its time");
    assert.ok(near(q.json.summary.path_length, 20 * 9 * 1000));
  });

  it("aggregation to a coarser level sums the same cells (n = 2, m = 3: four columns, rows 200-204 all in row 25)", async () => {
    const c = closed();
    const b0 = c - (c % 4) - 8;
    const r = await cube(fake, "tile", { n: 2, m: 3, b0, b1: b0 + 8 });
    const d = decodeOf(r.json.block);
    assert.equal(d.count, 2);
    assert.deepEqual(d.row, [25, 25]);
    for (let i = 0; i < 2; i++) {
      assert.equal(d.cnt[i], 4 * 45);
      assert.ok(near(d.vol[i], 4 * 9 * (0.5 * (200 + 201 + 202 + 203 + 204) + 5 * 0.25)));
    }
  });
});

describe("faults, gates, the request log and the controls", () => {
  let fake;
  before(async () => { fake = await startFake({ profile: "mini" }); });
  after(() => fake.close());
  const tile = (extra = {}) => cube(fake, "tile", { n: 0, m: 0, b0: Math.floor(fake.info().cutoffBase) - 30, b1: Math.floor(fake.info().cutoffBase), ...extra });

  it("fail() answers with the given status and body, honours after and times, and a rule can be removed", async () => {
    const rule = fake.on({ route: /^\/cube\/tile/, after: 1, times: 2 }).fail({ status: 503, body: { error: "busy" } });
    assert.equal((await tile()).status, 200, "the first match is skipped");
    const second = await tile();
    assert.deepEqual([second.status, second.text], [503, JSON.stringify({ error: "busy" })]);
    assert.equal((await tile()).status, 503);
    assert.equal((await tile()).status, 200, "times: 2 is used up");
    assert.equal(rule.hits, 2);
    assert.equal(fake.log().filter((e) => e.note === "fault:fail").length, 2);
    fake.clearFaults();
    fake.on({ route: "/cube/tile", when: (q) => q.n === "0" }).fail();
    assert.equal((await tile()).status, 500);
    assert.equal((await tile()).json.error, "injected failure");
    fake.clearFaults();
  });

  it("delay() answers late; drop() closes the socket; hang() never answers until the client gives up", async () => {
    fake.on({ route: /^\/cube\/tile/ }).delay(120);
    const t = performance.now();
    assert.equal((await tile()).status, 200);
    assert.ok(performance.now() - t >= 110);
    fake.clearFaults();
    fake.on({ route: /^\/cube\/tile/ }).drop();
    await assert.rejects(tile(), TypeError);
    fake.clearFaults();
    fake.on({ route: /^\/cube\/tile/ }).hang();
    const controller = new AbortController();
    const hung = fetch(`${fake.url}/cube/tile?n=0&m=0&b0=1&b1=2&pack=${fake.info().packToken}&proto=2`, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await assert.rejects(hung, { name: "AbortError" });
    await fake.idle({ quietMs: 50 });
    fake.clearFaults();
  });

  it("gate() holds a request until release() or fail(): arrived() says when it got there", async () => {
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    const first = tile();
    await gate.arrived();
    assert.equal(gate.held, 1);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fake.log().at(-1).status, null, "not answered while held");
    gate.release();
    assert.equal((await first).status, 200);
    const second = tile();
    await gate.arrived(2);
    gate.fail(409, { error: "cube_changed", detail: "gate" });
    const answered = await second;
    assert.deepEqual([answered.status, answered.json.error], [409, "cube_changed"]);
    assert.equal(gate.count, 2);
    fake.clearFaults();
    assert.equal((await tile()).status, 200, "clearing faults opens the gate for good");
  });

  it("the request log carries seq, slot, query without proto and pack, the pack token, answer kind and in-flight count", async () => {
    fake.reset();
    const token = fake.info().packToken;
    await get(fake, "/");
    await get(fake, `/cube/pack?since=${token}&proto=2`);
    fake.advance({ minutes: 1 });
    await get(fake, `/cube/pack?since=${token}&proto=2`);
    const c = Math.floor(fake.info().cutoffBase);
    await cube(fake, "tile", { n: 0, m: 0, b0: c - 5, b1: c }, fake.info().packToken);
    await cube(fake, "motion", { tier: "recent" });
    const log = fake.log();
    assert.deepEqual(log.map((e) => e.slot), ["page", "poll", "poll", "cube", "motion"]);
    assert.deepEqual(log.map((e) => e.answer), [null, "current", "delta", null, null]);
    assert.deepEqual(log.map((e) => e.seq), [1, 2, 3, 4, 5]);
    assert.deepEqual(log[3].query, { n: "0", m: "0", b0: String(c - 5), b1: String(c) });
    assert.equal(log[3].packToken, fake.info().packToken);
    assert.equal(log[3].status, 200);
    assert.ok(log[3].bytes > 0 && log[3].ms >= 0 && log[0].inFlightAtStart === 0);
    fake.assertNoUnexpected();
    // Two reads in one slot at once are flagged.
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    const a = tile();
    await gate.arrived();
    const b = tile();
    await gate.arrived(2);
    gate.release();
    await Promise.all([a, b]);
    fake.clearFaults();
    assert.throws(() => fake.assertNoUnexpected(), /overlapping cube reads/);
    fake.reset();
  });

  it("idle() resolves after a quiet period and times out while a request is in flight", async () => {
    fake.reset();
    await fake.idle({ quietMs: 30 });
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    const pending = tile();
    await gate.arrived();
    await assert.rejects(fake.idle({ quietMs: 20, timeoutMs: 120 }), /not idle/);
    gate.release();
    await pending;
    fake.clearFaults();
    fake.reset();
  });

  it("overrideBars(), corrupt() and setQuiet()/setNext()/setPageVersion() change what the page sees", async () => {
    fake.reset();
    const c = Math.floor(fake.info().cutoffBase);
    const col = Math.floor((c - 512) / 512);
    fake.overrideBars(9, [{ col, open: 1, high: 4, low: 0.5, close: 3, volume: 10, takerBuyVolume: 4, baseVolume: 2, trades: 7 }]);
    const bars = await cube(fake, "bars", { n: 9, b0: 512 * col, b1: c });
    const d = decodeOf(bars.json.bars);
    assert.deepEqual([d.col, d.open, d.high, d.low, d.close, d.vol, d.tbvol, d.btc, d.cnt], [[col], [1], [4], [0.5], [3], [10], [4], [2], [7]]);
    fake.corrupt({ dwell: -5, path: 2e9 });
    const m = decodeOf((await cube(fake, "tile", { n: 0, m: 0, b0: c - 10, b1: c, motion: 1 })).json.block);
    assert.deepEqual([m.dwell[0], m.path[0]], [-5, 2e9]);
    fake.corrupt(null);
    fake.setQuiet(400).setNext(7).setPageVersion("v2");
    const poll = (await get(fake, `/cube/pack?since=${fake.info().packToken}&proto=2`)).json;
    assert.deepEqual([poll.quiet, poll.next, poll.page], [400, 7, "v2"]);
    fake.reset();
  });

  it("the control API (CLI mode) advances, rebuilds, injects faults and reports, and its requests are not page requests", async () => {
    const f = await startFake({ profile: "mini", control: true });
    try {
      const post = (p, body) => fetch(`${f.url}/__fake/${p}`, { method: "POST", body: JSON.stringify(body ?? {}) }).then((r) => r.json());
      const before = (await (await fetch(`${f.url}/__fake/info`)).json()).cutoff;
      assert.deepEqual(await post("advance", { minutes: 2 }), { ok: true });
      assert.notEqual((await (await fetch(`${f.url}/__fake/info`)).json()).cutoff, before);
      await post("rebuild");
      await post("fault", { route: "^/cube/tile", action: "fail", status: 502, times: 1 });
      const token = f.info().packToken;
      const r = await get(f, `/cube/tile?n=0&m=0&b0=1&b1=2&pack=${token}&proto=2`);
      assert.equal(r.status, 502);
      assert.equal((await post("fault", { route: "x", action: "explode" })).error.slice(0, 10), "RangeError");
      assert.equal(f.log().filter((e) => e.path.startsWith("/__fake")).length, 0);
      await post("clear-faults");
      await post("reset");
      assert.equal((await (await fetch(`${f.url}/__fake/log`)).json()).length, 0);
    } finally {
      await f.close();
    }
  });

  it("recorded/live options are validated", async () => {
    await assert.rejects(startFake({ mode: "sideways" }), /use live or recorded/);
    await assert.rejects(startFake({ profile: "nope" }), /unknown profile/);
    await assert.rejects(startFake({ profile: "micro:missing" }), /micro:missing/);
  });
});

describe("determinism pins of the generated profiles (self-pin, tests/fixtures/profiles/pins.json)", () => {
  const measure = async (name) => {
    const f = await startFake({ profile: name });
    try {
      const pack = f.currentPack();
      const tiers = {};
      let decodedBytes = 0;
      for (const [id, meta] of Object.entries(pack.blocks)) {
        const bytes = zlib.gunzipSync(Buffer.from(meta.gzip_base64, "base64"));
        decodedBytes += bytes.length;
        tiers[id] = { cells: meta.count, decodedBytes: bytes.length };
      }
      const recent = zlib.gunzipSync(Buffer.from(pack.blocks.recent.gzip_base64, "base64"));
      return {
        trades: f.cube.store.length, baseCells: f.cube.store.cells().col.length, tiers, packDecodedBytes: decodedBytes,
        recentSha256: crypto.createHash("sha256").update(recent).digest("hex"),
      };
    } finally {
      await f.close();
    }
  };
  const names = ["mini", "standard", "deep", "uniform", "skew"];

  if (process.env.UPDATE_PINS === "1") {
    it("UPDATE_PINS=1: rewrite pins.json from the generators", async () => {
      const out = {};
      for (const n of names) out[n] = await measure(n);
      fs.writeFileSync(PINS, `${JSON.stringify({ seed: 20260924, cutoff: "2026-09-24T12:02:00.000000Z", profiles: out }, null, 2)}\n`);
    });
    return;
  }

  const pins = JSON.parse(fs.readFileSync(PINS, "utf8"));
  for (const name of names) {
    it(`${name}: trade count, base cells, tier cells, decoded sizes and the recent block hash are as pinned`, async () => {
      assert.deepEqual(await measure(name), pins.profiles[name]);
    });
  }

  it("the expected orders of magnitude of TESTPLAN 4.4 hold (standard: ~286k trades, ~98k base cells; deep: ~407k trades)", () => {
    assert.ok(Math.abs(pins.profiles.standard.trades - 286000) < 3000);
    assert.ok(Math.abs(pins.profiles.standard.baseCells - 97600) < 2000);
    assert.ok(Math.abs(pins.profiles.deep.trades - 407000) < 3000);
    assert.ok(Math.abs(pins.profiles.mini.trades - 11000) < 1000);
    assert.equal(pins.profiles.uniform.trades, 138247, "one trade every 1.25 s for two days, to the cutoff");
  });
});

describe("the page root and materialised builds", () => {
  const D3_SHA256 = "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539"; // vendor/d3.min.js, pinned in THIRD_PARTY_NOTICES.md and by U01
  const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
  const tmp = () => tmpdir("fake-root-");
  const page = (dir) => {
    fs.mkdirSync(path.join(dir, "vendor"), { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "vendor", "d3.min.js"), "//d3");
    return dir;
  };

  it("EXPLORER_PAGE_ROOT wins, absolute or relative to the repository root, and a directory without a page is refused by name", () => {
    const dir = page(tmp());
    assert.equal(resolvePageRoot({ env: { EXPLORER_PAGE_ROOT: dir, CONVERGENCE: "1" } }), dir);
    const repo = tmp();
    page(path.join(repo, "reports", "page"));
    assert.equal(resolvePageRoot({ env: { EXPLORER_PAGE_ROOT: "reports/page" }, repoRoot: repo }), path.join(repo, "reports", "page"));
    assert.throws(() => resolvePageRoot({ env: { EXPLORER_PAGE_ROOT: tmp() } }), /EXPLORER_PAGE_ROOT: .*index\.html does not exist/);
  });

  it("CONVERGENCE=1 serves the repository root: the committed index.html", () => {
    assert.equal(resolvePageRoot({ env: { CONVERGENCE: "1" } }), ROOT);
    assert.throws(() => resolvePageRoot({ env: { CONVERGENCE: "1" }, repoRoot: tmp() }), /committed page/);
  });

  it("otherwise the working tree is built into a temporary directory and the committed index.html is left alone", { skip: !fs.existsSync(path.join(ROOT, "src", "encoding.js")) && "src/encoding.js does not exist yet (gate A0)" }, () => {
    const committed = sha256(fs.readFileSync(path.join(ROOT, "index.html")));
    const dir = buildPageRoot(tmp());
    assert.ok(/id="origo-lens-data"/.test(fs.readFileSync(path.join(dir, "index.html"), "utf8")));
    assert.equal(sha256(fs.readFileSync(path.join(dir, "vendor", "d3.min.js"))), D3_SHA256);
    assert.equal(sha256(fs.readFileSync(path.join(ROOT, "index.html"))), committed);
  });

  it("a failing build says why instead of serving nothing", () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, "tools"));
    fs.writeFileSync(path.join(repo, "tools", "build.py"), "import sys\nsys.exit('cannot build: nothing here')\n");
    assert.throws(() => buildPageRoot(path.join(repo, "out"), { repoRoot: repo }), /building the working tree failed: cannot build: nothing here/);
  });

  const haveBaseline = (() => { try { execFileSync("git", ["-C", ROOT, "cat-file", "-e", "8c82ca1^{commit}"], { stdio: "ignore" }); return true; } catch { return false; } })();

  it("materialise() writes the committed page and d3 of a SHA byte for byte and the fake serves it", { skip: !haveBaseline && "commit 8c82ca1 is not in this clone" }, async () => {
    const out = tmp();
    const built = materialise("8c82ca1", "baseline", { outRoot: out });
    assert.equal(path.basename(built.dir), "baseline-8c82ca1");
    assert.equal(built.sha.length, 40);
    // The oracle is git itself: the same bytes through `git show`, hashed here.
    const viaGit = execFileSync("git", ["-C", ROOT, "show", "8c82ca1:index.html"], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(built.indexSha256, sha256(viaGit));
    assert.equal(built.vendorSha256, D3_SHA256);
    assert.ok(fs.existsSync(path.join(built.dir, "vendor", "D3-LICENSE")));
    const f = await startFake({ profile: "mini", pageRoot: built.dir });
    try {
      const r = await get(f, "/");
      assert.equal(r.status, 200);
      assert.ok(r.text.includes('<script src="vendor/d3.min.js">'));
      assert.equal(JSON.parse(/id="origo-lens-data">(.*?)<\/script>/s.exec(r.text)[1]).source, "SYNTHETIC fixture mini seed 20260924 - not market data");
      const served = Buffer.from(await (await fetch(`${f.url}/vendor/d3.min.js`)).arrayBuffer());
      assert.equal(sha256(served), D3_SHA256, "the fake serves d3 from the build's own vendor/");
    } finally {
      await f.close();
    }
  });

  it("materialise() refuses an unknown commit with the fetch hint, a non-hex id and a label that is not a file name", () => {
    assert.throws(() => materialise("deadbeefdeadbeef", "old"), /git fetch --no-tags --depth=1 origin deadbeefdeadbeef/);
    assert.throws(() => materialise("not-a-sha", "old"), /not a commit id/);
    assert.throws(() => materialise("8c82ca1", "../x"), /plain file name/);
  });
});
