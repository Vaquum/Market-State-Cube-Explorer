"use strict";
// U32 (T-codec, portable-code half): E.codec.encodePortable, decodePortable, validatePortable (API.md B.15,
// C.13, DD-28, DD-29, DR-14; part 22-codec).
//
// Oracles (none is the code under test):
//   - node:zlib (gzipSync, gunzipSync with maxOutputLength) and the platform's CompressionStream /
//     DecompressionStream, which are the two real implementations the injected deflate and inflate stand for;
//   - node:crypto and a canonical-JSON function written in this file: the payload id is the first 96 bits of
//     SHA-256 over the sorted-key JSON of the payload without its id, so every tampered payload in this file
//     is re-sealed with an id computed here, and a failure is about the content and not about the seal;
//   - the limits of D9 and C.13 as literals: 1 MiB = 1048576 bytes, a compressed code is at most
//     ceil(1048576 * 4 / 3) + 64 = 1398166 characters, percent-encoded at most 3 MiB, depth 8, strings 256;
//   - hand-built hostile inputs: a 1 MiB + 1 byte bomb (zlib.deflate of zeros, about 1 KB), a truncated gzip,
//     bytes that are not UTF-8, a nesting bomb, `__proto__` / `constructor` keys (checked through a fresh
//     object of the module's own realm, so a polluted Object.prototype would show);
//   - the legacy codes of tests/fixtures/legacy/codes.json, written with the baseline's own expression
//     encodeURIComponent(JSON.stringify(x)).
// The module may run in a vm context (ENCODING_PARTS_DIR): arrays are of another realm, so structures are
// compared through JSON and errors by name.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const E = require("../support/enc");

const C = E.codec;
const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;
const AP = "slate2-8f7890f7";
const CODES = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/legacy/codes.json"), "utf8"));
const MiB = 1048576;

// ---- independent oracles --------------------------------------------------------------------------------------

function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
const id96 = (obj) => crypto.createHash("sha256").update(Buffer.from(canon(obj), "utf8")).digest().subarray(0, 12).toString("base64url");
function seal(p) {
  const body = { ...p };
  delete body.id;
  return { ...body, id: id96(body) };
}
const gz = (text) => zlib.gzipSync(Buffer.from(text, "utf8"));
const code2 = (bytes) => "origo-cube:2." + Buffer.from(bytes).toString("base64url");
const tooLarge = () => Object.assign(new Error("too large"), { name: "TooLarge" });

// The two real implementations of the injected functions.
const zlibDeflate = async (u8) => zlib.gzipSync(Buffer.from(u8));
const zlibInflate = async (u8, max) => {
  try {
    return zlib.gunzipSync(Buffer.from(u8), { maxOutputLength: max });
  } catch (error) {
    if (error && error.code === "ERR_BUFFER_TOO_LARGE") throw tooLarge();
    throw error;
  }
};
// The recommended page implementation: a reader with a running byte counter that cancels at the limit.
function streamInflate(spy) {
  return async (u8, max) => {
    const ds = new DecompressionStream("gzip");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const cancel = reader.cancel.bind(reader);
    reader.cancel = (...a) => {
      spy.cancelled = (spy.cancelled || 0) + 1;
      return cancel(...a);
    };
    const fed = writer.write(Buffer.from(u8)).then(() => writer.close()).catch(() => {});
    const chunks = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      spy.read = total;
      if (total > max) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
    await fed;
    return Buffer.concat(chunks);
  };
}
async function compress(text) {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const fed = writer.write(Buffer.from(text, "utf8")).then(() => writer.close());
  const reader = cs.readable.getReader();
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await fed;
  return Buffer.concat(chunks);
}
const rejects = async (promise, code, pattern) => {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.name, "CodeError", "a CodeError: " + error.message);
    if (code) assert.equal(error.code, code, error.message);
    if (pattern) assert.match(error.reason, pattern);
    assert.equal(error.reason, error.message);
    return error;
  }
  assert.fail("the code was accepted, " + (code || "expected a rejection"));
};

// ---- a payload the way the page assembles one -----------------------------------------------------------------

// The model record of API.md B.13, typed in by hand (not read from E.model, so this file needs only the codec).
const MODEL = {
  id: "efficiency-diagonal@1",
  formula: "log2((Echild/Eparent)/2**(ISO_B-1))",
  ISO_A: -1.06,
  ISO_B: 0.486,
  baseline: 0.7002781604436024,
  fit: { method: "least squares of log2(median column price range / 125) against n", exponentText: "0.49", nMin: 6, nMax: 13, historyStart: "2021-01-01T00:00:00Z", extraction: "2026-09-24" },
  estimatedAt: null,
  precision: null,
  methodVersion: null,
  latestTrainingObservation: null,
  eligibilityUpperBound: "2026-09-25T00:00:00Z",
  appliesTo: ["efficiency", "diagonal"],
  applicability: "range-derived model applied to touched rows; not proven neutral at every level",
};

const cellsCtx = (measure, n, m, extra) => E.context.cellsKey({ measure, basis: "amount", transform: "value", curve: "log", n, m, ...(extra || {}) });
const valueDesc = (U, k, signed) => E.scale.manual({ kind: "value-log1p", signed: Boolean(signed), U, k }).descriptor;
function record(channel, desc, ctx, extra) {
  return { channel, policy: channel === "l" ? "l" : "e", external: false, origin: "fit", desc, ctx, cohort: { n: 9312, excluded: 3 }, obsEndMs: 1790251320000, cutMs: null, canonicalThroughMs: null, token: null, ...(extra || {}) };
}
function rankDesc() {
  const values = [];
  for (let i = 0; i < 600; i++) values.push(1 + ((i * 7919) % 10007) + i * 13);
  return E.scale.fitRank(values).descriptor;
}
function payload(extra) {
  return plain({
    visualVersion: 2,
    kind: "view",
    query: { t1: 3213840, t2: 3213984, p1: 516, p2: 520, tR: 6, pR: 0 },
    view: {
      mode: "delta", pane: "volume", poc: true, area: false, untested: false, rows: "off", period: "90d", level: null, lines: ["1d", "7d"], tab: "context", replay: false, anchor: null,
      horizon: 1, evidenceKind: "poc", barrier: 1, follow: "refit", auto: false, window: "", viewport: [3213312, 3214080, 512, 528],
      scale: { basis: "intensity", pathBasis: "spans", transform: "value", curve: "log", rowsTransform: "value", cells: "explore", rows: "auto", local: false, window: null, lock: true },
    },
    appearance: { id: AP },
    scales: [
      record("c", valueDesc(1204551.25, 8830.5, true), cellsCtx("delta", 8, 1), { cutMs: 1790251320000, canonicalThroughMs: 1790208000000, token: "f3a1c0de" }),
      record("r", rankDesc(), E.context.rowsKey({ measure: "volume", transform: "rank", period: "roll:90", rowSize: 3, quality: "exact" }), { policy: "a" }),
      record("c", E.scale.manual({ kind: "fixed-linear", signed: false, lo: 0.2, hi: 0.8 }).descriptor, cellsCtx("dwell", 8, 1), { origin: "manual", policy: "k", external: true }),
    ],
    axes: [{ id: "pane.volume", domain: [0, 1920000000], policy: "frozen", through: 1790251320000 }],
    models: [{ ...MODEL, status: "timing-unverified" }],
    observation: { source: "SYNTHETIC fixture standard seed 1 - not market data", instrument: "BTC/USDT", cutoffMs: 1790251368750, canonicalThroughMs: null, token: null, note: "Replay on currently available history; original vintages not guaranteed" },
    ...(extra || {}),
  });
}
function mutate(fn) {
  const p = payload();
  fn(p);
  return seal(p);
}

// ---- round trip -----------------------------------------------------------------------------------------------

test("encodePortable: origo-cube:2. + base64url(gzip(canonical JSON)); the id is filled in; the same view is the same code", async () => {
  const p = payload();
  const a = await C.encodePortable(p, { deflate: zlibDeflate });
  const b = await C.encodePortable(payload(), { deflate: zlibDeflate });
  assert.equal(a, b, "deterministic");
  assert.match(a, /^origo-cube:2\.[A-Za-z0-9_-]+$/);
  const json = zlib.gunzipSync(Buffer.from(a.slice("origo-cube:2.".length), "base64url")).toString("utf8");
  const parsed = JSON.parse(json);
  assert.equal(parsed.id, id96(p), "the id is the id96 of the canonical payload without it (node:crypto)");
  assert.equal(json, canon(parsed), "the text is the canonical JSON: sorted keys, no whitespace");
  assert.equal(parsed.visualVersion, 2);
  assert.equal(parsed.id.length, 16);
  assert.ok(!("id" in p), "the caller's payload is not modified");
  assert.ok(Buffer.byteLength(json) < MiB);
  assert.ok(a instanceof String || typeof a === "string");
});

test("round trip: a code made with zlib is decoded with zlib AND with DecompressionStream; one made with CompressionStream decodes too", async () => {
  const code = await C.encodePortable(payload(), { deflate: zlibDeflate });
  const viaZlib = await C.decodePortable(code, { inflate: zlibInflate });
  const viaStream = await C.decodePortable(code, { inflate: streamInflate({}) });
  assert.deepEqual(plain(viaStream), plain(viaZlib));
  assert.equal(viaZlib.kind, "v2");
  assert.equal(viaZlib.version, 2);
  assert.match(viaZlib.digest, /^[0-9a-f]{16}$/);
  assert.equal(viaZlib.digest, crypto.createHash("sha256").update(code).digest("hex").slice(0, 16), "digest = first 8 bytes of SHA-256 of the code text");
  assert.deepEqual(plain(viaZlib.payload), seal(payload()));
  // a code compressed by the platform decodes as well
  const other = "origo-cube:2." + (await compress(canon(seal(payload())))).toString("base64url");
  assert.deepEqual(plain((await C.decodePortable(other, { inflate: zlibInflate })).payload), seal(payload()));
  // surrounding whitespace from a paste is ignored
  assert.equal((await C.decodePortable("  " + code + "\n", { inflate: zlibInflate })).kind, "v2");
  const v = C.validatePortable((await C.decodePortable(code, { inflate: zlibInflate })).payload, {});
  assert.equal(v.ok, true, JSON.stringify(v.reasons));
  assert.deepEqual(plain(v.reasons), []);
});

test("without deflate the code is uncompressed percent-encoded JSON behind origo-cube:2j. and decodes without inflate", async () => {
  const code = await C.encodePortable(payload());
  assert.ok(code.startsWith("origo-cube:2j."));
  assert.equal(decodeURIComponent(code.slice("origo-cube:2j.".length)), canon(seal(payload())));
  const d = await C.decodePortable(code);
  assert.equal(d.kind, "v2");
  assert.deepEqual(plain(d.payload), seal(payload()));
  await rejects(C.decodePortable(await C.encodePortable(payload(), { deflate: zlibDeflate })), "inflate", /cannot decompress/);
});

test("a v2 code restores to the validated pieces: query, view, appearance, descriptors (full records), axes, models, observation", async () => {
  const code = await C.encodePortable(payload(), { deflate: zlibDeflate });
  const v = C.validatePortable((await C.decodePortable(code, { inflate: zlibInflate })).payload, { CUT: 3214083 });
  assert.equal(v.ok, true, JSON.stringify(v.reasons));
  const value = plain(v.value);
  assert.equal(value.visualVersion, 2);
  assert.equal(value.id, id96(payload()));
  assert.deepEqual(value.query, payload().query);
  assert.equal(value.appearance, AP);
  assert.equal(value.view.mode, "delta");
  assert.equal(value.view.auto, false);
  assert.equal(value.view.n, 6);
  assert.equal(value.view.m, 0);
  assert.deepEqual(value.view.scale, payload().view.scale);
  assert.equal(value.scales.length, 3);
  assert.equal(value.scales[0].desc.id, "ot_D8yL_NiaSousm");
  assert.equal(value.scales[0].cutMs, 1790251320000, "a portable record is a snapshot and keeps cutMs, canonicalThrough and the token");
  assert.equal(value.scales[0].canonicalThroughMs, 1790208000000);
  assert.equal(value.scales[0].token, "f3a1c0de");
  assert.equal(value.scales[1].desc.params.knots.length, 257);
  assert.equal(value.scales[2].external, true);
  assert.equal(value.scales[2].origin, "manual");
  assert.deepEqual(value.axes, payload().axes);
  assert.equal(value.models.length, 1);
  assert.equal(value.observation.instrument, "BTC/USDT");
  assert.equal(value.observation.note, "Replay on currently available history; original vintages not guaranteed");
  assert.deepEqual(plain(v.dropped), []);
});

test("self-contained (S1-168): every record carries its full descriptor; a reference-only mapping cannot be written or read", async () => {
  await assert.rejects(C.encodePortable(payload({ scales: [{ ...record("c", null, cellsCtx("volume", 4, 0)), desc: null }] })), isError("CodeError"));
  const p = mutate((x) => { x.scales[0].desc = null; });
  const v = C.validatePortable(p, {});
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /carries its descriptor/);
  // nothing in the payload can point at the workspace cache: the allowlist has no such member
  const refs = mutate((x) => { x.scales[0].cacheKey = "cells|BTC/USDT|volume"; });
  assert.match(C.validatePortable(refs, {}).reasons[0], /"cacheKey" is not part of a view code/);
});

// ---- legacy codes -----------------------------------------------------------------------------------------------

test("legacy percent-encoded codes are still accepted; a bare cube query is a query, not a view", async () => {
  const byId = Object.fromEntries(CODES.cases.map((c) => [c.id, c]));
  assert.ok(byId.typical.text.startsWith("origo-cube:%7B"));
  const t = await C.decodePortable(byId.typical.text);
  assert.equal(t.kind, "legacy");
  assert.equal(t.version, null);
  assert.deepEqual(plain(t.payload), byId.typical.decoded);
  for (const id of ["plain-json", "brace-after-prefix"]) {
    const d = await C.decodePortable(byId[id].text);
    assert.equal(d.kind, "legacy", id);
    assert.deepEqual(plain(d.payload), byId[id].decoded, id);
  }
  const q = await C.decodePortable(byId["bare-cube-query"].text);
  assert.equal(q.kind, "query");
  assert.deepEqual(plain(q.payload), byId["bare-cube-query"].decoded);
  // the same safety applies to legacy input: a prototype key is refused
  await rejects(C.decodePortable('origo-cube:{"query":{},"view":{"__proto__":{"polluted":1}}}'), "structure", /__proto__/);
  await rejects(C.decodePortable("origo-cube:%7Bnot"), "json");
  await rejects(C.decodePortable("origo-cube:%7B%E0%A4%A"), "percent");
  await rejects(C.decodePortable("origo-cube:%E0%A4%A"), "version", /unrecognised/);
  await rejects(C.decodePortable("#w=24h"), "structure", /not a view code/);
  await rejects(C.decodePortable("{}"), "structure", /empty/);
  await rejects(C.decodePortable(42), "type");
});

// ---- version, size and bounded decompression ------------------------------------------------------------------

test("an unknown version is rejected whole, with the version seen: a newer code tag, a newer visualVersion, a non-integer", async () => {
  const e1 = await rejects(C.decodePortable("origo-cube:4.abcdef"), "version", /newer or unknown version \(4\)/);
  assert.equal(e1.version, "4");
  await rejects(C.decodePortable("origo-cube:zzz"), "version", /unrecognised/);
  const future = "origo-cube:4." + Buffer.from(gz(canon({ visualVersion: 4, kind: "view" }))).toString("base64url");
  await rejects(C.decodePortable(future, { inflate: zlibInflate }), "version", /version \(4\)/);
  const v = C.validatePortable({visualVersion: 4, kind: "view"}, {});
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /visual version 4 was made by a newer or unknown version/);
  const plainFuture = await rejects(C.decodePortable('{"visualVersion":4,"kind":"view"}'), "version", /version 4/);
  assert.equal(plainFuture.version, 4);
  for (const bad of [2.1, "2", 1, null]) {
    const r = C.validatePortable({ visualVersion: bad, kind: "view" }, {});
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.reasons[0], /newer or unknown version/);
  }
  assert.match(C.validatePortable({ kind: "view" }, {}).reasons[0], /legacy payload/);
  assert.match(C.validatePortable([], {}).reasons[0], /is an object/);
});

test("the size of the text is checked BEFORE anything is decoded: 1398166 characters compressed, 3 MiB percent-encoded", async () => {
  let called = 0;
  const spy = async () => {
    called++;
    return Buffer.alloc(0);
  };
  const big = "origo-cube:2." + "A".repeat(1398166 - "origo-cube:2.".length + 1);
  assert.equal(big.length, 1398167);
  await rejects(C.decodePortable(big, { inflate: spy }), "too-large", /longer than 1398166 characters/);
  assert.equal(called, 0, "inflate was never called");
  // 1398166 - 13 = 1398153 is 4k + 1 characters, which no byte count produces; the longest valid text is 1398165
  const ok = "origo-cube:2." + "A".repeat(1398152);
  assert.equal(ok.length, 1398165);
  await rejects(C.decodePortable(ok, { inflate: spy }), "inflate", undefined).catch(() => {});
  assert.equal(called, 1, "exactly at the limit the text is decoded");
  await rejects(C.decodePortable("origo-cube:2j." + "%20".repeat(1048576 + 1)), "too-large", /longer than 3145728 characters|more than 1048576 bytes/);
  await rejects(C.decodePortable("origo-cube:%7B" + "A".repeat(3 * MiB)), "too-large", /longer than 3145728 characters/);
  await rejects(C.decodePortable("origo-cube:2.***"), "base64", /base64url/);
  await rejects(C.decodePortable("origo-cube:2.AAAAA"), "base64", /base64url/, "length 4k+1 is no byte count");
  await rejects(C.decodePortable("origo-cube:2.AAA=", { inflate: spy }), "base64", /base64url/, "padding is not base64url");
});

test("the 1 MiB decoded limit is exact: a payload of exactly 1048576 bytes is read, one more byte is refused at the running counter", async () => {
  const json = canon(seal(payload()));
  const pad = (n) => json + " ".repeat(n - Buffer.byteLength(json));
  const exact = code2(gz(pad(MiB)));
  const good = await C.decodePortable(exact, { inflate: zlibInflate });
  assert.equal(good.kind, "v2");
  const over = code2(gz(pad(MiB + 1)));
  await rejects(C.decodePortable(over, { inflate: zlibInflate }), "too-large", /more than 1048576 bytes/);
});

test("a decompression bomb (1 MiB + 1 byte of zeros, about 1 KB compressed) is rejected at the limit and the stream is cancelled", async () => {
  const bomb = zlib.deflateSync(Buffer.alloc(MiB + 1), { level: 9 });
  assert.ok(bomb.length < 2000, "the bomb is tiny: " + bomb.length);
  const gzBomb = zlib.gzipSync(Buffer.alloc(MiB + 1), { level: 9 });
  assert.ok(gzBomb.length < 2000);
  const code = code2(gzBomb);
  assert.ok(code.length < 4000, "the text passes the size check; only the running byte counter can stop it");
  await rejects(C.decodePortable(code, { inflate: zlibInflate }), "too-large", /more than 1048576 bytes/);
  const spy = {};
  const error = await rejects(C.decodePortable(code, { inflate: streamInflate(spy) }), "too-large", /more than 1048576 bytes/);
  assert.equal(spy.cancelled, 1, "reader.cancel() was called exactly once");
  assert.ok(spy.read > MiB && spy.read <= MiB + 65536 * 4, "memory is bounded by the limit plus a chunk, not by the bomb: " + spy.read);
  assert.equal(error.code, "too-large");
  // a bomb larger than anything a test should inflate still stops at the same place
  const huge = code2(zlib.gzipSync(Buffer.alloc(64 * MiB), { level: 9 }));
  const spy2 = {};
  await rejects(C.decodePortable(huge, { inflate: streamInflate(spy2) }), "too-large");
  assert.ok(spy2.read <= MiB + 65536 * 4, "64 MiB of zeros, never more than a chunk over the limit was read: " + spy2.read);
  // a misbehaving inflate that returns more than it was allowed is caught by the module too
  await rejects(C.decodePortable(code, { inflate: async () => Buffer.alloc(MiB + 1) }), "too-large");
  await rejects(C.decodePortable(code, { inflate: async () => null }), "inflate");
  await rejects(C.decodePortable(code, { inflate: async () => { throw new Error("boom"); } }), "inflate", /could not be decompressed/);
});

test("hostile content: truncated gzip, bytes that are not UTF-8, invalid JSON, empty input, a non-object", async () => {
  const good = gz(canon(seal(payload())));
  await rejects(C.decodePortable(code2(good.subarray(0, good.length >> 1)), { inflate: zlibInflate }), "inflate");
  await rejects(C.decodePortable(code2(good.subarray(0, good.length >> 1)), { inflate: streamInflate({}) }), "inflate");
  await rejects(C.decodePortable(code2(zlib.gzipSync(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]))), { inflate: zlibInflate }), "utf8", /not valid UTF-8/);
  await rejects(C.decodePortable(code2(zlib.gzipSync(Buffer.from([0x22, 0xc3, 0x28, 0x22]))), { inflate: zlibInflate }), "utf8");
  await rejects(C.decodePortable(code2(zlib.gzipSync(Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]))), { inflate: zlibInflate }), "utf8", undefined, "an encoded surrogate");
  await rejects(C.decodePortable(code2(gz("{not json")), { inflate: zlibInflate }), "json", /not valid JSON/);
  await rejects(C.decodePortable(code2(gz("")), { inflate: zlibInflate }), "json");
  await rejects(C.decodePortable(code2(gz("[1,2,3]")), { inflate: zlibInflate }), "structure", /not a view/);
  await rejects(C.decodePortable(code2(gz('"text"')), { inflate: zlibInflate }), "structure");
  await rejects(C.decodePortable(code2(gz("null")), { inflate: zlibInflate }), "structure");
});

test("a nesting bomb is refused by a scan, not by recursion: 9 levels are too deep, 8 are not; 200000 levels cost one pass", async () => {
  const nest = (n) => "[".repeat(n) + "]".repeat(n);
  const at = (n) => code2(gz('{"visualVersion":2,"kind":"view","x":' + nest(n - 1) + "}"));
  // depth counts the object that holds the list: {"x": [[...]]} has depth 1 + (n - 1)
  const eight = await rejects(C.decodePortable(at(8), { inflate: zlibInflate }), "structure", /member "x" is not part of a view code/);
  assert.ok(eight, "8 levels pass the depth check and meet the allowlist instead");
  await rejects(C.decodePortable(at(9), { inflate: zlibInflate }), "depth", /nested deeper than 8/);
  const bomb = code2(gz('{"a":' + nest(200000) + "}"));
  await rejects(C.decodePortable(bomb, { inflate: zlibInflate }), "depth", /nested deeper than 8/);
  // brackets inside strings do not count, escaped quotes do not end a string
  const text = JSON.stringify({ visualVersion: 2, kind: "view", id: "x", query: "[[[[[[[[[[[[[[[[[[[[[\\\"[[[[[[[[[[" });
  assert.equal((await C.decodePortable(code2(gz(text)), { inflate: zlibInflate })).kind, "v2", "no depth error: the brackets are inside a string");
  assert.equal(C.validatePortable(JSON.parse('{"visualVersion":2,"kind":"view","x":' + nest(9) + "}"), {}).ok, false);
  assert.match(C.validatePortable(JSON.parse('{"visualVersion":2,"kind":"view","query":' + nest(9) + "}"), {}).reasons[0], /nested deeper than 8/);
});

test("prototype pollution: __proto__, constructor and prototype keys are rejected anywhere, and no prototype is touched", async () => {
  const dirty = (inner) => '{"visualVersion":2,"kind":"view",' + inner + "}";
  const cases = [
    dirty('"__proto__":{"polluted":true}'),
    dirty('"constructor":{"prototype":{"polluted":true}}'),
    dirty('"view":{"__proto__":{"polluted":true}}'),
    dirty('"scales":[{"__proto__":{"polluted":true}}]'),
    dirty('"view":{"scale":{"prototype":{"polluted":true}}}'),
  ];
  for (const text of cases) {
    await rejects(C.decodePortable(code2(gz(text)), { inflate: zlibInflate }), "structure", /is not allowed/);
    const r = C.validatePortable(JSON.parse(text), {});
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /is not allowed/);
  }
  assert.equal(({}).polluted, undefined, "the test realm");
  // the realm of the module itself: an object it made
  const made = C.classify({});
  assert.equal(Object.getPrototypeOf(made).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const ok = C.validatePortable(seal(payload()), {});
  assert.equal(ok.ok, true);
  assert.equal(ok.value.polluted, undefined);
  assert.equal(Object.getPrototypeOf(ok.value).polluted, undefined);
});

test("strings over 256 characters, arrays over 512 items and members outside the allowlist reject the whole payload", async () => {
  const at = async (fn) => {
    const p = payload();
    fn(p);
    return C.validatePortable(seal(p), {});
  };
  let r = await at((p) => { p.observation.note = "x".repeat(257); });
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /longer than 256 characters at observation\.note/);
  r = await at((p) => { p.observation.note = "x".repeat(256); });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  r = await at((p) => { p.view.lines = Array.from({ length: 513 }, () => "1d"); });
  assert.match(r.reasons[0], /array longer than 512/);
  r = await at((p) => { p.evil = 1; });
  assert.match(r.reasons[0], /"evil" is not part of a view code/);
  r = await at((p) => { p.view.script = "<script>"; });
  assert.match(r.reasons[0], /"script" is not part of a view code \(at view\)/);
  r = await at((p) => { p.scales[0].desc.params.extra = 1; });
  assert.match(r.reasons[0], /"extra" is not part of a view code/);
  r = await at((p) => { p.view.window = 7; });
  assert.match(r.reasons[0], /view\.window is text/);
  r = await at((p) => { p.view.poc = "yes"; });
  assert.match(r.reasons[0], /view\.poc is true or false/);
});

// ---- validatePortable: every branch of C.13 ---------------------------------------------------------------------

test("the payload id is recomputed and compared: a changed byte anywhere rejects the WHOLE code as an integrity failure", () => {
  const p = seal(payload());
  assert.equal(C.validatePortable(p, {}).ok, true);
  for (const tamper of [
    (x) => { x.view.mode = "trades"; },
    (x) => { x.query.t1 = 3213841; },
    (x) => { x.scales[0].desc.params.U = 1204551.26; },
    (x) => { x.observation.cutoffMs += 1; },
    (x) => { x.id = x.id.slice(0, 15) + (x.id.endsWith("A") ? "B" : "A"); },
  ]) {
    const q = JSON.parse(JSON.stringify(p));
    tamper(q);
    const r = C.validatePortable(q, {});
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /integrity check failed/);
  }
  const noId = JSON.parse(JSON.stringify(p));
  delete noId.id;
  assert.match(C.validatePortable(noId, {}).reasons[0], /payload id is missing/);
  assert.match(C.validatePortable({ ...p, kind: "snapshot" }, {}).reasons[0], /not a view/);
});

test("descriptor validation, every branch: channel, policy, transform, formula and unit, U and k, knots and q, domains, levels, period, tags", () => {
  const bad = (fn, pattern, label) => {
    const r = C.validatePortable(mutate(fn), {});
    assert.equal(r.ok, false, label);
    assert.match(r.reasons.join("; "), pattern, label);
  };
  // the channel is in the registry, the policy and origin from their enumerations
  bad((p) => { p.scales[0].channel = "z"; }, /scales\[0\]: a scale record is for channel c, r or l/, "channel");
  bad((p) => { p.scales[0].channel = "a.pane.volume"; }, /channel c, r or l/, "axis channel on a scale");
  bad((p) => { p.scales[0].policy = "q"; }, /unknown policy/, "policy");
  bad((p) => { p.scales[0].policy = "x"; }, /unknown policy/, "axis policy on a scale");
  bad((p) => { p.scales[0].origin = "guess"; }, /unknown origin/, "origin");
  bad((p) => { p.scales[0].external = "yes"; }, /external is true or false/, "external");
  bad((p) => { p.scales[0].channel = "l"; }, /lens carries Local contrast/, "lens policy");
  // transform and formula tags come from the page's tables
  bad((p) => { p.scales[0].ctx.transform = "bogus"; }, /context is not valid|does not match/, "transform enum");
  bad((p) => { p.scales[0].ctx.formula = "cells.delta.amount@9"; }, /does not match the formula tables|not valid/, "formula version");
  bad((p) => { p.scales[0].ctx.formula = "cells.nosuch.amount@1"; }, /does not match the formula tables|not valid/, "formula name");
  bad((p) => { p.scales[0].ctx.unit = "btc"; }, /does not match the formula tables/, "unit not allowed for the formula");
  bad((p) => { p.scales[1].ctx.formula = "rows.relvol@2"; p.scales[1].ctx.unit = "usdt"; }, /does not match the formula tables/, "relvol@2 with unit usdt");
  bad((p) => { p.scales[0].ctx.instrument = "ETH/USDT"; }, /instrument is BTC\/USDT/, "instrument");
  bad((p) => { p.scales[0].ctx.quality = "approximate"; }, /context is not valid|does not match/, "quality tag");
  bad((p) => { p.scales[0].ctx.n = 8.5; }, /level is not valid/, "n integer");
  bad((p) => { p.scales[0].ctx.n = 21; }, /level is not valid/, "n range");
  bad((p) => { p.scales[0].ctx.m = -1; }, /level is not valid/, "m range");
  bad((p) => { p.scales[0].ctx.m = 10; }, /level is not valid/, "m range high");
  bad((p) => { p.scales[1].ctx.period = "roll:0"; }, /context is not valid|period/, "period identity");
  bad((p) => { p.scales[1].ctx.period = "whenever"; }, /context is not valid|period/, "period identity text");
  bad((p) => { p.scales[1].ctx.rowSize = 10; }, /row size is not valid/, "row size");
  bad((p) => { p.scales[0].ctx = null; }, /needs a context/, "context missing");
  bad((p) => { p.scales[1].ctx.consumer = "cells"; }, /does not belong|not valid|does not match/, "rows channel with a cells context");
  // U and k finite, positive, k <= U; all-equal U === k is valid
  bad((p) => { p.scales[0].desc.params.U = 0; }, /invalid descriptor: U must be positive/, "U zero");
  bad((p) => { p.scales[0].desc.params.k = -1; }, /invalid descriptor: k must be positive/, "k negative");
  bad((p) => { p.scales[0].desc.params.k = 2e6; }, /k must not exceed U/, "k > U");
  bad((p) => { p.scales[0].desc.params.U = "big"; }, /must be a finite number/, "U text");
  bad((p) => { delete p.scales[0].desc.params.k; }, /missing parameter/, "k missing");
  const equal = payload();
  equal.scales[0].desc = plain(valueDesc(5000, 5000, true));
  assert.equal(C.validatePortable(seal(equal), {}).ok, true, "U === k (an all-equal cohort) is valid");
  // zero-only and none carry no parameters
  bad((p) => { p.scales[0].desc = { ...plain(E.scale.zeroOnly(true)), params: { U: 1 } }; }, /invalid descriptor: this kind has no parameters|id does not match/, "zero-only with params");
  bad((p) => { p.scales[0].desc = plain(E.scale.fixed("log2-ratio")); p.scales[0].ctx = plain(cellsCtx("delta", 8, 1)); }, /does not match the context transform/, "fixed mapping for a Value context");
  bad((p) => { p.scales[0].desc = plain(E.scale.zeroOnly(false)); }, /signedness does not match the measure/, "unsigned zero-only for Delta");
  const none = plain(valueDesc(1000, 10, true));
  none.kind = "none";
  none.params = null;
  none.id = E.scale.id(none);
  bad((p) => { p.scales[0].desc = none; }, /colour mapping/, "none is never persisted");
  // 257 finite non-decreasing knots and q = j/256
  bad((p) => { p.scales[1].desc.params.knots = p.scales[1].desc.params.knots.slice(0, 256); }, /knots must hold exactly 257 values/, "256 knots");
  bad((p) => { p.scales[1].desc.params.knots.push(1e9); }, /knots must hold exactly 257 values/, "258 knots");
  bad((p) => { const k = p.scales[1].desc.params.knots; [k[10], k[11]] = [k[11], k[10]]; }, /knots must not decrease/, "decreasing knots");
  bad((p) => { p.scales[1].desc.params.knots[3] = "x"; }, /a knot must be a finite number/, "text knot");
  bad((p) => { p.scales[1].desc.params.q = "j/255"; }, /q must be j\/256/, "q");
  bad((p) => { delete p.scales[1].desc.params.q; }, /missing parameter/, "q missing");
  // domains finite and lo < hi, symmetric where required
  bad((p) => { p.scales[2].desc.params.lo = 0.9; }, /lo must be below hi/, "fixed-linear window");
  bad((p) => { p.axes[0].domain = [5, 5]; }, /axes\[0\]: an axis domain is lo < hi/, "axis domain");
  bad((p) => { p.axes[0].domain = null; }, /frozen axis carries its domain/, "frozen axis without a domain");
  bad((p) => { p.axes[0].policy = "locked"; }, /unknown axis policy/, "axis policy");
  bad((p) => { p.axes[0].id = "Pane Volume"; }, /dotted id/, "axis id");
  bad((p) => { p.axes[0].through = -1; }, /through is an integer/, "through");
  const symmetric = payload();
  symmetric.scales[0].desc = plain(E.scale.fixed("share-diverging", [0.25, 0.75]));
  symmetric.scales[0].ctx = plain(cellsCtx("flow", 8, 1));
  assert.equal(C.validatePortable(seal(symmetric), {}).ok, true, "a symmetric Taker flow window");
  const skew = plain(E.scale.manual({ kind: "fixed-diverging", signed: true, lo: 0.25, hi: 0.75, mid: 0.6 }).descriptor);
  assert.equal(skew.params.mid, 0.6);
  // tags and counts
  bad((p) => { p.scales[0].obsEndMs = 1.5; }, /obsEndMs is an integer number of milliseconds/, "obsEndMs");
  bad((p) => { p.scales[0].token = "NOT HEX"; }, /token is hex text/, "token");
  bad((p) => { p.scales[0].cohort = { n: -1 }; }, /cohort needs a count n/, "cohort");
  bad((p) => { p.scales[0].cohort = { n: 5, calibratedOn: "anywhere" }; }, /unknown cohort support/, "cohort support tag");
  bad((p) => { p.scales[0].cohort = { n: 5, quality: "approximate" }; }, /unknown cohort quality/, "cohort quality tag");
  bad((p) => { p.scales[0].cohort = { n: 5, excluded: { partial: "41" } }; }, /cohort\.excluded\.partial is a count/, "excluded count");
  bad((p) => { p.scales[0].cohort = { n: 5, kind: "everything" }; }, /unknown cohort kind/, "cohort kind");
  bad((p) => { p.scales[0].cohort = { n: 5, level: { n: 4 } }; }, /cohort\.level is \{n, m\}/, "cohort level");
  const rich = payload();
  rich.scales[0].cohort = { kind: "cells", n: 1523, zeros: 0, nonzero: 1523, excluded: { partial: 41, open: 2, unread: 0, nonFinite: 0, negative: 0, stale: 0, placeholder: 0 }, calibratedOn: "view", bounds: [3213312, 3214083, 656, 688], level: { n: 4, m: 0 }, quality: "exact", obsEndBase: 3214082.1333, support: { timeBase: [3213312, 3214083], priceRows: [656, 688] } };
  assert.equal(C.validatePortable(seal(rich), {}).ok, true, "the full cohort record of B.6 is accepted");
  bad((p) => { p.scales[0].desc.kind = "value-cubic"; }, /unknown kind|invalid descriptor/, "kind");
  bad((p) => { p.scales[0].desc.v = 2; }, /unknown mapping version/, "mapping version");
  bad((p) => { p.scales[0].desc.clip = "wrap"; }, /unknown clip policy/, "clip");
  // the id of a descriptor is recomputed and compared: one wrong character rejects the whole code
  const flipped = payload();
  flipped.scales[0].desc.id = "ot_D8yL_NiaSousX";
  const r = C.validatePortable(seal(flipped), {});
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /scales\[0\]: hash mismatch: the id does not match the mapping \(id\)/);
  assert.equal(r.value, undefined, "a rejected payload yields no value to apply");
  bad((p) => { delete p.scales[0].desc.id; }, /id is missing/, "descriptor id missing");
});

test("the profile tracks' choice and disclosure travel in a view code (S2) and come back; a bad value is refused; absent means independent and closed", async () => {
  const withProfile = (cmp, open) => mutate((p) => { p.view.profileCmp = cmp; p.view.profileOpen = open; });
  for (const [cmp, open] of [["absolute", false], ["share", true], ["independent", true]]) {
    const code = await C.encodePortable(JSON.parse(JSON.stringify({ ...payload(), view: { ...payload().view, profileCmp: cmp, profileOpen: open } })), { deflate: zlibDeflate });
    const decoded = await C.decodePortable(code, { inflate: zlibInflate });
    const checked = C.validatePortable(decoded.payload, {});
    assert.equal(checked.ok, true, checked.reasons.join("; "));
    assert.equal(checked.value.view.profileCmp, cmp);
    assert.equal(checked.value.view.profileOpen, open);
  }
  const plainView = C.validatePortable(seal(payload()), {});
  assert.equal(plainView.ok, true);
  assert.equal(plainView.value.view.profileCmp, "independent", "a code without the setting is independent");
  assert.equal(plainView.value.view.profileOpen, false, "and closed");
  assert.equal(C.validatePortable(withProfile("both", false), {}).ok, false, "an unknown comparison is refused");
  assert.match(C.validatePortable(withProfile("both", false), {}).reasons[0], /independent, absolute or share/);
  assert.match(C.validatePortable(withProfile("share", "yes"), {}).reasons[0], /true or false/);
});

test("limits on read: 16 scales are accepted, 17 rejected; 21 axes accepted, 22 rejected; 4 models accepted, 5 rejected", () => {
  const scalesOf = (n) => Array.from({ length: n }, (_, i) => plain(record("c", valueDesc(1000 + i, 10 + i, false), cellsCtx("volume", i % 16, Math.floor(i / 16)))));
  const axesOf = (n) => Array.from({ length: n }, (_, i) => ({ id: "pane.a" + i, domain: [0, 10 + i], policy: "frozen", through: null }));
  const modelsOf = (n) => Array.from({ length: n }, (_, i) => plain({ ...MODEL, id: "model" + i }));
  const ok = (extra) => C.validatePortable(seal({ ...payload({ scales: [], axes: [], models: [] }), ...extra }), {});
  assert.equal(ok({ scales: scalesOf(16) }).ok, true);
  assert.match(ok({ scales: scalesOf(17) }).reasons[0], /more than 16 active scales \(17\)/);
  assert.equal(ok({ axes: axesOf(21) }).ok, true);
  assert.match(ok({ axes: axesOf(22) }).reasons[0], /more than 21 frozen axes \(22\)/);
  assert.equal(ok({ models: modelsOf(4) }).ok, true);
  assert.match(ok({ models: modelsOf(5) }).reasons[0], /more than 4 models \(5\)/);
});

test("write-side limits: encodePortable refuses what a reader would refuse (17 scales, 22 axes, 256 knots, a bad descriptor), naming why", async () => {
  const scalesOf = (n) => Array.from({ length: n }, (_, i) => plain(record("c", valueDesc(1000 + i, 10 + i, false), cellsCtx("volume", i % 16, Math.floor(i / 16)))));
  await C.encodePortable(payload({ scales: scalesOf(16) }), { deflate: zlibDeflate });
  await assert.rejects(C.encodePortable(payload({ scales: scalesOf(17) }), { deflate: zlibDeflate }), (e) => e.name === "LimitError" && /more than 16 active scales/.test(e.reason) && e.code === "limit");
  await assert.rejects(C.encodePortable(payload({ axes: Array.from({ length: 22 }, (_, i) => ({ id: "pane.a" + i, domain: [0, 10 + i], policy: "frozen", through: null })) })), (e) => e.name === "LimitError");
  const short = payload();
  short.scales[1].desc.params.knots = short.scales[1].desc.params.knots.slice(0, 256);
  await assert.rejects(C.encodePortable(short), (e) => e.name === "CodeError" && /257/.test(e.reason));
  const nan = payload();
  nan.query.t1 = NaN;
  await assert.rejects(C.encodePortable(nan), isError("TypeError"), "a non-finite number is found where it is made");
  await assert.rejects(C.encodePortable(payload(), { deflate: async () => Buffer.alloc(2 * MiB) }), (e) => e.name === "LimitError" && /longer than 1398166/.test(e.reason));
  await assert.rejects(C.encodePortable(payload(), { deflate: async () => "text" }), isError("CodeError"));
  await assert.rejects(C.encodePortable(null), isError("TypeError"));
  assert.equal(typeof C.encodePortable(payload()).then, "function", "encodePortable returns a promise");
});

test("the query and the view: numbers and enumerations checked; what this page cannot show is DROPPED and listed, not a reason to refuse", () => {
  const bad = (fn, pattern) => {
    const r = C.validatePortable(mutate(fn), { CUT: 3214083 });
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], pattern);
  };
  bad((p) => { p.query.t1 = "x"; }, /query\.t1 is a finite number/);
  bad((p) => { p.query.tR = 6.5; }, /query\.tR is a non-negative integer/);
  bad((p) => { p.query.tR = 21; }, /outside this page's levels/);
  bad((p) => { p.query.p2 = 500; }, /not ordered/);
  bad((p) => { p.query.t2 = 4000000; }, /beyond this page's history/);
  bad((p) => { p.view.follow = "sideways"; }, /unknown follow mode/);
  bad((p) => { p.view.horizon = 3; }, /horizon is 1, 2, 4 or 8/);
  bad((p) => { p.view.viewport = [1, 2, 3]; }, /viewport is four finite numbers/);
  bad((p) => { p.view.scale.basis = "rate"; }, /scale\.basis is not one of amount, intensity/);
  bad((p) => { p.view.scale.transform = "rank2"; }, /scale\.transform is not one of value, rank/);
  bad((p) => { p.view.scale.lock = 1; }, /scale\.lock is true or false/);
  bad((p) => { p.view.mode = "flow"; p.view.scale.window = [0.2, 0.6]; }, /not a valid window: a Taker flow window must be symmetric about 0\.5/);
  bad((p) => { p.appearance.id = "NOT AN ID"; }, /appearance id is not well formed/);
  bad((p) => { p.observation.instrument = "ETH/USDT"; }, /instrument is BTC\/USDT/);
  bad((p) => { p.observation.cutoffMs = -5; }, /cutoffMs is an integer/);
  // a page that has no path mode, no macd pane and no rows: dropped and listed, the rest applies
  const env = { CUT: 3214083, modes: () => ["volume", "flow", "delta"], panes: () => ["cells"], rowsChoices: () => ["off"], normalizeLines: (l) => l.filter((k) => k !== "7d") };
  const r = C.validatePortable(mutate((p) => { p.view.mode = "path"; p.view.pane = "macd1d"; p.view.rows = "time"; p.view.lines = ["1d", "7d"]; }), env);
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(r.value.view.mode, "volume");
  assert.equal(r.value.view.pane, "cells");
  assert.deepEqual(plain(r.value.view.lines), ["1d"]);
  assert.deepEqual(plain(r.dropped.map((d) => d.key).sort()), ["lines", "mode", "pane", "rows"]);
  const r2 = C.validatePortable(mutate((p) => { p.view.replay = true; p.view.anchor = 9999999; }), env);
  assert.equal(r2.ok, true);
  assert.equal(r2.value.view.replay, false);
  assert.deepEqual(plain(r2.dropped.map((d) => d.key).sort()), ["anchor", "lines", "pane", "replay"], "lines and pane of the default payload are not in this page's lists either");
  // a code made on one page opened on another with a different lattice still restores its settings
  assert.equal(C.validatePortable(mutate((p) => { p.view.window = "24h"; p.view.viewport = [0, 0, 0, 0]; }), { CUT: 3214083 }).value.view.window, "24h");
});

test("the model block is display only: well-formed or refused, never applied to this page's model (S1-148)", () => {
  const model = (fn) => C.validatePortable(mutate((p) => fn(p.models[0])), {});
  assert.equal(model(() => {}).ok, true);
  assert.match(model((m) => { m.ISO_B = "0.486"; }).reasons[0], /ISO_A and ISO_B are finite numbers/);
  assert.match(model((m) => { m.fit.nMin = 14; }).reasons[0], /nMin <= nMax/);
  assert.match(model((m) => { m.fit.extraction = "2026-9-24"; }).reasons[0], /extraction date is YYYY-MM-DD/);
  assert.match(model((m) => { m.eligibilityUpperBound = "soon"; }).reasons[0], /eligibility bound is an ISO time/);
  assert.match(model((m) => { m.eligibilityUpperBound = "2026-09-01T00:00:00Z"; }).reasons[0], /before the extraction/);
  assert.match(model((m) => { m.status = "eligible"; }).reasons[0], /unknown model status/);
  assert.match(model((m) => { m.baseline = -1; }).reasons[0], /baseline is a positive number/);
  assert.match(model((m) => { delete m.fit; }).reasons[0], /fitted range/);
  // an import that carries other ISO values is shown, and the page's own record is unchanged
  const foreign = C.validatePortable(mutate((p) => { p.models[0].ISO_B = 0.9; p.models[0].baseline = 2 ** (0.9 - 1); }), {});
  assert.equal(foreign.ok, true);
  assert.equal(foreign.value.models[0].ISO_B, 0.9);
  assert.equal(MODEL.ISO_B, 0.486, "the input record is not modified by validation");
  if (E.model) {
    assert.equal(E.model.PROVENANCE.ISO_B, 0.486, "the page's model is not touched");
    assert.equal(E.model.PROVENANCE.baseline, 2 ** (0.486 - 1));
    assert.notEqual(foreign.value.models[0], E.model.PROVENANCE);
    assert.equal(E.model.status(1790251368750), "timing-unverified", "the status of this page is still its own");
  }
});

// ---- two serialisations, one canonical object ----------------------------------------------------------------------

test("two serialisations parse to the same canonical record and id: the address's positional record and the portable JSON", async () => {
  const env = { T0: 1609459200, BASE: 56.25, PR: 125, CUT: 3214083 };
  const recs = [
    record("c", valueDesc(1204551.25, 8830.5, true), cellsCtx("delta", 8, 1)),
    record("r", rankDesc(), E.context.rowsKey({ measure: "volume", transform: "rank", period: "cal:mo:2026-09-01", rowSize: 3, quality: "approx-rows:8" }), { policy: "a" }),
    record("l", valueDesc(4000, 80, false), E.context.cellsKey({ measure: "volume", basis: "amount", transform: "value-log", n: 5, m: 0, lens: { bounds: [1, 2, 3, 4], n: 5, m: 0 } })),
    record("c", E.scale.manual({ kind: "fixed-linear", signed: false, lo: 0.2, hi: 0.8 }).descriptor, cellsCtx("dwell", 4, 0), { origin: "manual", policy: "k", external: true }),
  ];
  const address = C.formatAddress({ window: "24h", appearance: AP, scales: recs, axes: [] }, env);
  const fromAddress = C.parseAddress(address.hash, env);
  assert.deepEqual(plain(fromAddress.dropped), []);
  const portable = C.validatePortable(seal(payload({ scales: recs.map(plain), axes: [], models: [] })), env);
  assert.equal(portable.ok, true, JSON.stringify(portable.reasons));
  // The address carries no provenance text: `algorithm` is not hashed and is derived from the origin there.
  const strip = (r) => {
    const x = { ...plain(r), cutMs: null, canonicalThroughMs: null, token: null };
    delete x.desc.algorithm;
    return x;
  };
  const key = (r) => E.context.keyString(r.ctx.consumer === "lens" ? r.ctx.base : r.ctx) + "|" + r.channel + "|" + r.policy + "|" + r.desc.id;
  const a = [...fromAddress.scales].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  const b = [...portable.value.scales].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  assert.equal(a.length, 4);
  for (let i = 0; i < 4; i++) {
    const x = strip(a[i]);
    const y = strip(b[i]);
    // the lens context is written and read as the Cells context at the lens level in the address only
    if (x.channel === "l") {
      assert.deepEqual(x.ctx, { ...plain(y.ctx.base), n: y.ctx.n, m: y.ctx.m });
      x.ctx = y.ctx;
    }
    assert.deepEqual(x, y);
    assert.equal(a[i].desc.id, b[i].desc.id, "the mapping id is the same from both serialisations");
    assert.equal(E.scale.id(a[i].desc), a[i].desc.id);
  }
});

// ---- nothing is executed -----------------------------------------------------------------------------------------

test("nothing in a payload is executed: the codec source has no eval, Function, dynamic import, innerHTML or string timers", () => {
  const dir = process.env.ENCODING_PARTS_DIR;
  const file = dir ? path.resolve(dir, "22-codec.js") : path.resolve(__dirname, "../../src/encoding.js");
  const text = fs.readFileSync(file, "utf8");
  const code = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const re of [/\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/, /\bimport\s*\(/, /\binnerHTML\b/, /\bdocument\b/, /\bsetTimeout\s*\(\s*["'`]/, /\bsetInterval\s*\(\s*["'`]/, /Object\.assign\s*\(\s*S\b/, /\bwith\s*\(/])
    assert.equal(re.test(code), false, "found " + re);
  // a payload full of script-like text comes back as plain data
  const hostile = mutate((p) => { p.observation.source = "<img src=x onerror=alert(1)>"; p.observation.note = "javascript:alert(1)"; });
  const r = C.validatePortable(hostile, {});
  assert.equal(r.ok, true);
  assert.equal(r.value.observation.source, "<img src=x onerror=alert(1)>");
  assert.equal(typeof r.value.observation.source, "string");
});
