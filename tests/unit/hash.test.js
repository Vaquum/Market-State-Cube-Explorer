"use strict";
// U11 (T-hash): E.hash of src/encoding.js, loaded through tests/support/enc.js.
// Oracles (none is the code under test): node:crypto for SHA-256; TextEncoder / TextDecoder({fatal}) for
// UTF-8; Buffer for base64url, hex and big-endian doubles; a canonical-JSON writer written INSIDE this
// file with a different structure than the module's (entries sorted by string comparison, scalars through
// JSON.stringify); the hand-published vectors of API.md Appendix A.2 (nine mapping ids plus the first one
// of C.7) and the FIPS 180 vector for "abc".
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): its arrays, typed arrays and errors
// are of another realm, so results are compared through Buffer/Array conversions and errors by name.
const test = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const E = require("../support/enc");

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomBytes(r, n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256);
  return b;
}
const nodeSha = (bytes) => nodeCrypto.createHash("sha256").update(bytes).digest();
const hexOf = (u8) => Buffer.from(u8).toString("hex");
const named = (name) => ({ name });
// Any error object, whatever realm it comes from.
const isError = (e) => typeof e === "object" && e !== null && /Error$/.test(e.name);

// Independent canonical JSON (C.7): sorted by UTF-16 code unit, no whitespace, numbers as the language's
// shortest round-trip text, -0 as "0".
function oracleCanonical(v) {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return v === 0 ? "0" : JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(oracleCanonical).join(",") + "]";
  const entries = Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, x]) => JSON.stringify(k) + ":" + oracleCanonical(x)).join(",") + "}";
}

// ---- SHA-256 ---------------------------------------------------------------

test("sha256: FIPS vectors", () => {
  assert.equal(hexOf(E.hash.sha256(Buffer.from("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hexOf(E.hash.sha256(new Uint8Array(0))), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(hexOf(E.hash.sha256(Buffer.alloc(1000000, "a"))), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});

test("sha256: 32 bytes out; equals node:crypto for every length 0..300", () => {
  const r = rng(11);
  for (let n = 0; n <= 300; n++) {
    const bytes = randomBytes(r, n);
    const got = E.hash.sha256(bytes);
    assert.equal(got.length, 32);
    assert.equal(hexOf(got), nodeSha(bytes).toString("hex"), `length ${n}`);
  }
});

test("sha256: the padding boundaries 55/56/63/64/119/120 and their neighbours", () => {
  const r = rng(12);
  for (const n of [54, 55, 56, 57, 62, 63, 64, 65, 118, 119, 120, 121, 127, 128, 129, 191, 192]) {
    const bytes = randomBytes(r, n);
    assert.equal(hexOf(E.hash.sha256(bytes)), nodeSha(bytes).toString("hex"), `length ${n}`);
  }
});

test("sha256: a 1 MiB input and 300 seeded random lengths up to 5000", () => {
  const r = rng(13);
  const big = randomBytes(r, 1048576);
  assert.equal(hexOf(E.hash.sha256(big)), nodeSha(big).toString("hex"));
  for (let i = 0; i < 300; i++) {
    const bytes = randomBytes(r, Math.floor(r() * 5000));
    assert.equal(hexOf(E.hash.sha256(bytes)), nodeSha(bytes).toString("hex"), `case ${i} length ${bytes.length}`);
  }
});

test("sha256: reads only the view it is given (byteOffset), accepts plain arrays, rejects non-bytes", () => {
  const backing = Buffer.from("xxxxabcxxxx");
  const view = new Uint8Array(backing.buffer, backing.byteOffset + 4, 3);
  assert.equal(hexOf(E.hash.sha256(view)), nodeSha(Buffer.from("abc")).toString("hex"));
  assert.equal(hexOf(E.hash.sha256([97, 98, 99])), nodeSha(Buffer.from("abc")).toString("hex"));
  assert.throws(() => E.hash.sha256("abc"), named("TypeError"));
  assert.throws(() => E.hash.sha256(null), named("TypeError"));
});

test("sha256 of multi-byte UTF-8 text", () => {
  for (const s of ["", "é", "日本語のテキスト", "𝒳𝓎𝓏", "a\u0000b", "−×·→≈₂", "\u{10FFFF}"]) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(hexOf(E.hash.sha256(E.hash.utf8(s))), nodeSha(bytes).toString("hex"), s);
  }
});

// ---- UTF-8 -----------------------------------------------------------------

test("utf8 equals TextEncoder, including lone surrogates (U+FFFD) and every plane", () => {
  const enc = new TextEncoder();
  const cases = ["", "abc", "é", "€", "日本語", "😀", "a😀b", "\ud800", "\udc00x", "x\ud83d", "\ud83d😀", "\u0000\u007f\u0080߿ࠀ￿", "\u{10000}\u{10FFFF}"];
  for (const s of cases) assert.deepEqual(Array.from(E.hash.utf8(s)), Array.from(enc.encode(s)), JSON.stringify(s));
  const r = rng(21);
  for (let i = 0; i < 300; i++) {
    let s = "";
    const n = Math.floor(r() * 30);
    for (let j = 0; j < n; j++) s += String.fromCharCode(Math.floor(r() * 0x10000));
    assert.deepEqual(Array.from(E.hash.utf8(s)), Array.from(enc.encode(s)), `random ${i}`);
  }
});

test("fromUtf8 equals a fatal TextDecoder on valid input and round-trips utf8", () => {
  const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const r = rng(22);
  for (let i = 0; i < 300; i++) {
    let s = "";
    const n = Math.floor(r() * 40);
    for (let j = 0; j < n; j++) {
      const k = Math.floor(r() * 4);
      s += k === 0 ? String.fromCharCode(Math.floor(r() * 0x80)) : k === 1 ? String.fromCharCode(0x80 + Math.floor(r() * 0x700)) : k === 2 ? String.fromCharCode(0x800 + Math.floor(r() * 0xd000)) : String.fromCodePoint(0x10000 + Math.floor(r() * 0x100000));
    }
    const bytes = new TextEncoder().encode(s);
    assert.equal(E.hash.fromUtf8(bytes), dec.decode(bytes));
    assert.equal(E.hash.fromUtf8(E.hash.utf8(s)), s);
  }
  // Longer than the internal chunk size, so the chunked concatenation is exercised.
  const long = "aé日😀".repeat(3000);
  assert.equal(E.hash.fromUtf8(new TextEncoder().encode(long)), long);
  assert.equal(E.hash.fromUtf8(new Uint8Array(0)), "");
});

test("fromUtf8 is fatal: every malformed sequence throws", () => {
  const bad = {
    "lone continuation": [0x80],
    "lone continuation after ascii": [0x41, 0xbf],
    "overlong 2-byte NUL": [0xc0, 0x80],
    "overlong 2-byte slash": [0xc1, 0xbf],
    "overlong 3-byte": [0xe0, 0x80, 0x80],
    "overlong 3-byte (E0 9F)": [0xe0, 0x9f, 0xbf],
    "overlong 4-byte": [0xf0, 0x80, 0x80, 0x80],
    "overlong 4-byte (F0 8F)": [0xf0, 0x8f, 0xbf, 0xbf],
    "encoded surrogate D800": [0xed, 0xa0, 0x80],
    "encoded surrogate DFFF": [0xed, 0xbf, 0xbf],
    "above U+10FFFF (F4 90)": [0xf4, 0x90, 0x80, 0x80],
    "lead F5": [0xf5, 0x80, 0x80, 0x80],
    "lead FF": [0xff],
    "lead FE": [0xfe],
    "truncated 2-byte": [0xc3],
    "truncated 3-byte": [0xe2, 0x82],
    "truncated 4-byte": [0xf0, 0x9f, 0x98],
    "missing continuation": [0xe2, 0x41, 0x41],
    "bad second continuation": [0xe2, 0x82, 0x41],
    "truncated after valid text": [0x61, 0x62, 0xe2, 0x82],
  };
  for (const [name, bytes] of Object.entries(bad)) {
    assert.throws(() => E.hash.fromUtf8(Uint8Array.from(bytes)), named("TypeError"), name);
    assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)), Error, `oracle agrees that "${name}" is invalid`);
  }
  // The largest valid code points at each length decode.
  assert.equal(E.hash.fromUtf8(Uint8Array.from([0xdf, 0xbf])), "߿");
  assert.equal(E.hash.fromUtf8(Uint8Array.from([0xef, 0xbf, 0xbf])), "￿");
  assert.equal(E.hash.fromUtf8(Uint8Array.from([0xf4, 0x8f, 0xbf, 0xbf])), "\u{10FFFF}");
  assert.equal(E.hash.fromUtf8(Uint8Array.from([0xed, 0x9f, 0xbf])), "퟿");
});

// ---- base64url and hex -----------------------------------------------------

test("b64urlEncode equals Buffer base64url (unpadded) for lengths 0..300 and decodes back", () => {
  const r = rng(31);
  for (let n = 0; n <= 300; n++) {
    const bytes = randomBytes(r, n);
    const text = E.hash.b64urlEncode(bytes);
    assert.equal(text, bytes.toString("base64url"), `length ${n}`);
    assert.ok(/^[A-Za-z0-9_-]*$/.test(text));
    assert.deepEqual(Array.from(E.hash.b64urlDecode(text)), Array.from(bytes), `round trip ${n}`);
  }
  const big = randomBytes(r, 100000);
  assert.equal(E.hash.b64urlEncode(big), big.toString("base64url"));
  assert.deepEqual(Array.from(E.hash.b64urlDecode(big.toString("base64url"))), Array.from(big));
  assert.equal(E.hash.b64urlEncode(Uint8Array.from([0xfb, 0xff, 0xfe])), "-__-", "the url alphabet has - and _ where standard base64 has + and /");
});

test("b64urlDecode answers null for anything b64urlEncode could not have written", () => {
  const { b64urlDecode } = E.hash;
  assert.equal(b64urlDecode("QQ").length, 1);
  assert.deepEqual(Array.from(b64urlDecode("QUI")), [65, 66]);
  assert.equal(b64urlDecode("").length, 0);
  for (const [text, why] of [
    ["QQ==", "padding"],
    ["Q", "length 4k+1"],
    ["QUJDR", "length 4k+1"],
    ["+/+/", "standard alphabet"],
    ["ab cd", "space"],
    ["QR", "non-zero trailing bits (2 chars)"],
    ["QUJ", "non-zero trailing bits (3 chars)"],
    ["QQ\n", "newline"],
    ["éé", "non-ASCII"],
    ["aĀ", "non-ASCII code unit"],
  ]) assert.equal(b64urlDecode(text), null, `${JSON.stringify(text)}: ${why}`);
  for (const v of [null, undefined, 5, {}, ["QQ"], new Uint8Array(2)]) assert.equal(b64urlDecode(v), null, `non-string ${String(v)}`);
});

test("hex equals Buffer hex and honours the byte count", () => {
  const r = rng(41);
  const bytes = randomBytes(r, 40);
  assert.equal(E.hash.hex(bytes), bytes.toString("hex"));
  assert.equal(E.hash.hex(bytes, 4), bytes.subarray(0, 4).toString("hex"));
  assert.equal(E.hash.hex(bytes, 0), "");
  assert.equal(E.hash.hex(bytes, -3), "");
  assert.equal(E.hash.hex(bytes, 1000), bytes.toString("hex"));
  assert.equal(E.hash.hex(new Uint8Array(0)), "");
  assert.equal(E.hash.hex(Uint8Array.from([0, 15, 16, 255])), "000f10ff");
  assert.equal(E.hash.hex(E.hash.sha256(Buffer.from("abc")), 4), "ba7816bf");
});

// ---- canonical JSON --------------------------------------------------------

test("canonical: the API.md C.7 example and structural rules", () => {
  assert.equal(E.hash.canonical({ v: 1, kind: "value-log1p", signed: false, params: { U: 1000, k: 12.5 }, clip: "clamp01@1" }), '{"clip":"clamp01@1","kind":"value-log1p","params":{"U":1000,"k":12.5},"signed":false,"v":1}');
  assert.equal(E.hash.canonical(null), "null");
  assert.equal(E.hash.canonical(true), "true");
  assert.equal(E.hash.canonical(false), "false");
  assert.equal(E.hash.canonical("a\"b\\c\n"), '"a\\"b\\\\c\\n"');
  assert.equal(E.hash.canonical([]), "[]");
  assert.equal(E.hash.canonical({}), "{}");
  assert.equal(E.hash.canonical([3, [2, { b: 1, a: [] }], null]), '[3,[2,{"a":[],"b":1}],null]', "array order is kept, object keys are sorted, no whitespace");
  assert.equal(E.hash.canonical({ b: 1, a: 2 }), E.hash.canonical({ a: 2, b: 1 }), "key insertion order does not matter");
});

test("canonical: keys sort by UTF-16 code unit (not numerically, not by code point)", () => {
  assert.equal(E.hash.canonical({ "9": 1, "10": 2, b: 3, B: 4 }), '{"10":2,"9":1,"B":4,"b":3}', "integer-like keys are strings here");
  // U+1F600 is the surrogate pair D83D DE00; U+FF5E is a single unit FF5E. By code unit D83D < FF5E, by
  // code point the order would be reversed.
  assert.equal(E.hash.canonical({ "～": 1, "\u{1F600}": 2 }), '{"\u{1F600}":2,"～":1}');
  assert.equal(E.hash.canonical({ "é": 1, z: 2, a: 3 }), '{"a":3,"z":2,"é":1}');
});

test("canonical: numbers are the shortest round-trip decimal, -0 is 0", () => {
  const cases = [
    [0, "0"], [-0, "0"], [1, "1"], [-1, "-1"], [0.1, "0.1"], [0.1 + 0.2, "0.30000000000000004"], [1e21, "1e+21"], [1.5e-7, "1.5e-7"],
    [1e-7, "1e-7"], [123456789012345680000, "123456789012345680000"], [2 ** 53, "9007199254740992"], [5e-324, "5e-324"],
    [1.7976931348623157e308, "1.7976931348623157e+308"], [12.5, "12.5"], [26791234.56, "26791234.56"], [-2, "-2"], [0.000001, "0.000001"],
  ];
  for (const [n, text] of cases) {
    assert.equal(E.hash.canonical(n), text, String(n));
    assert.equal(Number(E.hash.canonical(n)), n === 0 ? 0 : n, "round trip");
  }
  assert.equal(E.hash.canonical({ x: -0, y: [-0] }), '{"x":0,"y":[0]}');
});

test("canonical: strings use JSON escapes (control characters, quotes, well-formed surrogates)", () => {
  const cases = ["", "plain", "quote\"", "back\\slash", "\u0000\u001f", "  ", "tab\t", "é日😀", "\ud800", "x\udc00y"];
  for (const s of cases) assert.equal(E.hash.canonical(s), JSON.stringify(s), JSON.stringify(s));
});

test("canonical rejects what has no canonical form", () => {
  const bad = {
    NaN: NaN,
    Infinity: Infinity,
    "-Infinity": -Infinity,
    undefined: undefined,
    function: () => 1,
    symbol: Symbol("s"),
    bigint: 10n,
    Map: new Map(),
    Set: new Set(),
    Date: new Date(0),
    Float64Array: new Float64Array(2),
    Uint8Array: new Uint8Array(2),
    RegExp: /a/,
    "boxed Number": Object(1),
  };
  for (const [name, v] of Object.entries(bad)) {
    assert.throws(() => E.hash.canonical(v), isError, `top-level ${name}`);
    assert.throws(() => E.hash.canonical({ a: [v] }), isError, `nested ${name}`);
  }
  assert.throws(() => E.hash.canonical({ a: 1, b: undefined }), isError, "an undefined member is refused, not dropped");
  assert.throws(() => E.hash.canonical([1, undefined]), isError, "an undefined item is refused, not written as null");
  assert.throws(() => E.hash.canonical([1, , 3]), isError, "an array hole is undefined");
  const cyc = { a: 1 };
  cyc.self = cyc;
  assert.throws(() => E.hash.canonical(cyc), isError, "a cycle");
  let deep = [];
  for (let i = 0; i < 200; i++) deep = [deep];
  assert.throws(() => E.hash.canonical(deep), isError, "absurd depth");
});

test("canonical equals the in-test canonicaliser on seeded random structures", () => {
  const r = rng(51);
  const keys = ["a", "b", "U", "k", "v", "kind", "10", "9", "z", "é", "\u{1F600}", "～", "", "with space", "q\"uote"];
  const number = () => {
    const k = Math.floor(r() * 6);
    if (k === 0) return Math.floor(r() * 1000) - 500;
    if (k === 1) return (r() - 0.5) * 10 ** (Math.floor(r() * 40) - 20);
    if (k === 2) return -0;
    if (k === 3) return 2 ** Math.floor(r() * 60);
    if (k === 4) return Math.round(r() * 1e6) / 1e3;
    return r();
  };
  const make = (depth) => {
    const k = Math.floor(r() * (depth > 4 ? 4 : 6));
    if (k === 0) return number();
    if (k === 1) return r() < 0.5;
    if (k === 2) return r() < 0.1 ? null : "s" + Math.floor(r() * 100) + (r() < 0.3 ? "é\n" : "");
    if (k === 3) return null;
    if (k === 4) return Array.from({ length: Math.floor(r() * 4) }, () => make(depth + 1));
    const o = {};
    for (let i = Math.floor(r() * 5); i > 0; i--) o[keys[Math.floor(r() * keys.length)]] = make(depth + 1);
    return o;
  };
  for (let i = 0; i < 500; i++) {
    const v = make(0);
    const want = oracleCanonical(v);
    assert.equal(E.hash.canonical(v), want, `case ${i}`);
    assert.deepEqual(JSON.parse(want), JSON.parse(JSON.stringify(v)), "the canonical text is the same data");
  }
});

// ---- ids -------------------------------------------------------------------

const mapping = (kind, signed, params, clip = "clamp01@1") => ({ v: 1, kind, signed, params, clip });
const knots257 = Array.from({ length: 257 }, (_, i) => i + 1);
const A2 = [
  ["value-log1p unsigned {U:1000,k:12.5} (C.7)", mapping("value-log1p", false, { U: 1000, k: 12.5 }), "UZux2TUwWna1lHYf"],
  ["value-log1p unsigned {U:26791234.56,k:48211.3}", mapping("value-log1p", false, { U: 26791234.56, k: 48211.3 }), "3s_XdONgi8CSqyOl"],
  ["value-log1p signed {U:1204551.25,k:8830.5}", mapping("value-log1p", true, { U: 1204551.25, k: 8830.5 }), "ot_D8yL_NiaSousm"],
  ["value-linear unsigned {U:26791234.56}", mapping("value-linear", false, { U: 26791234.56 }), "omnQDSYNT2RkWZdf"],
  ["fixed-diverging {lo:0,hi:1,mid:0.5} (taker share)", mapping("fixed-diverging", true, { lo: 0, hi: 1, mid: 0.5 }), "bladfrSuC76_siSl"],
  ["fixed-diverging {lo:-2,hi:2,mid:0} (log2 ratio)", mapping("fixed-diverging", true, { lo: -2, hi: 2, mid: 0 }), "F5um4Aa89S5b18PC"],
  ["fixed-linear {lo:0,hi:1}", mapping("fixed-linear", false, { lo: 0, hi: 1 }), "wWmkD33ohHZSpvyn"],
  ["zero-only unsigned", mapping("zero-only", false, null), "C5LleVNGDTk1DpfK"],
  ["axis-linear {lo:0,hi:1920000000}, axis@1", mapping("axis-linear", false, { lo: 0, hi: 1920000000 }, "axis@1"), "fAie68jq2OF1287z"],
  ["rank-type7-257 knots 1..257", mapping("rank-type7-257", false, { knots: knots257, q: "j/256" }), "YOsRNro-FFbbskXX"],
];

test("id96: the ten pinned vectors of API.md Appendix A.2 / C.7", () => {
  for (const [name, record, id] of A2) assert.equal(E.hash.id96(record), id, name);
});

test("id96 is the first 12 bytes of node:crypto SHA-256 over the canonical text, as 16 base64url characters", () => {
  const r = rng(61);
  for (const [, record] of A2) {
    const want = nodeSha(Buffer.from(oracleCanonical(record), "utf8")).subarray(0, 12).toString("base64url");
    assert.equal(E.hash.id96(record), want);
    assert.equal(want.length, 16);
  }
  for (let i = 0; i < 200; i++) {
    const v = { v: 1, kind: "k" + i, signed: r() < 0.5, params: { U: r() * 1e9, k: r() * 1e3 }, clip: "clamp01@1" };
    const id = E.hash.id96(v);
    assert.equal(id, nodeSha(Buffer.from(oracleCanonical(v), "utf8")).subarray(0, 12).toString("base64url"));
    assert.match(id, /^[A-Za-z0-9_-]{16}$/);
  }
  assert.equal(E.hash.id96("plain string"), nodeSha(Buffer.from('"plain string"')).subarray(0, 12).toString("base64url"), "any JSON-safe value, canonicalised inside id96");
});

test("id96 ignores key order and -0, and is sensitive to every hashed field", () => {
  const base = mapping("value-log1p", false, { U: 1000, k: 12.5 });
  const id = E.hash.id96(base);
  assert.equal(E.hash.id96({ clip: "clamp01@1", params: { k: 12.5, U: 1000 }, signed: false, kind: "value-log1p", v: 1 }), id, "key order");
  assert.equal(E.hash.id96(mapping("fixed-linear", false, { lo: -0, hi: 1 })), E.hash.id96(mapping("fixed-linear", false, { lo: 0, hi: 1 })), "-0 hashes as 0");
  const variants = [
    { ...base, v: 2 },
    { ...base, kind: "value-linear" },
    { ...base, signed: true },
    { ...base, params: { U: 1001, k: 12.5 } },
    { ...base, params: { U: 1000, k: 12.6 } },
    { ...base, params: { U: 1000, k: 12.5, extra: 0 } },
    { ...base, clip: "axis@1" },
  ];
  const seen = new Set([id]);
  for (const v of variants) {
    const other = E.hash.id96(v);
    assert.ok(!seen.has(other), "each change gives a different id: " + JSON.stringify(v));
    seen.add(other);
  }
  // One ulp of U changes the id: numbers are hashed exactly, never rounded.
  const next = Object.assign(new Float64Array([1000]), {});
  const bits = new BigUint64Array(next.buffer);
  bits[0] += 1n;
  assert.notEqual(E.hash.id96({ ...base, params: { U: next[0], k: 12.5 } }), id);
});

test("id96 changes with each of the 257 rank knots (and with q)", () => {
  const baseRecord = mapping("rank-type7-257", false, { knots: knots257, q: "j/256" });
  const baseId = E.hash.id96(baseRecord);
  const seen = new Set([baseId]);
  for (let j = 0; j < 257; j++) {
    const knots = knots257.slice();
    knots[j] += 0.5;
    const id = E.hash.id96(mapping("rank-type7-257", false, { knots, q: "j/256" }));
    assert.ok(!seen.has(id), `knot ${j}`);
    seen.add(id);
  }
  assert.ok(!seen.has(E.hash.id96(mapping("rank-type7-257", false, { knots: knots257, q: "j/255" }))));
});

test("id96 refuses what canonical refuses", () => {
  assert.throws(() => E.hash.id96({ v: 1, params: { U: NaN } }), isError);
  assert.throws(() => E.hash.id96({ v: 1, params: { U: undefined } }), isError);
});

test("E.scale.id excludes units, measure, context, cohort, provenance, appearance, theme, LUT and the algorithm string (DR-03)", (t) => {
  if (!(E.scale && E.scale.id)) {
    t.todo("part 08-scale is not present yet; this must turn green at assembly gate A0");
    return;
  }
  const desc = { v: 1, kind: "value-log1p", signed: false, params: { U: 1000, k: 12.5 }, clip: "clamp01@1", algorithm: "value-fit@1" };
  const id = E.scale.id(desc);
  assert.equal(id, "UZux2TUwWna1lHYf");
  const extras = {
    units: "trades", measure: "volume", context: { n: 8, m: 1 }, ctx: { n: 9 }, cohort: { count: 5 }, provenance: { fittedAtMs: 1 },
    appearance: "slate2-8f7890f7", theme: "dark", lut: "abc", token: "t", cutMs: 5, obsEndMs: 6, algorithm: "other@2", id: "0000000000000000",
  };
  for (const [key, value] of Object.entries(extras)) assert.equal(E.scale.id({ ...desc, [key]: value }), id, `${key} must not enter the id`);
  assert.notEqual(E.scale.id({ ...desc, v: 2 }), id);
  assert.notEqual(E.scale.id({ ...desc, kind: "value-linear" }), id);
  assert.notEqual(E.scale.id({ ...desc, signed: true }), id);
  assert.notEqual(E.scale.id({ ...desc, params: { U: 1000, k: 12.6 } }), id);
  assert.notEqual(E.scale.id({ ...desc, clip: "axis@1" }), id);
});

// ---- float64 packing -------------------------------------------------------

test("f64ToB64 / b64ToF64: 257 knots are 2056 bytes and 2742 characters; bit-exact big-endian", () => {
  const r = rng(71);
  const knots = [];
  for (let i = 0; i < 257; i++) knots.push(i === 0 ? -0 : (r() - 0.3) * 10 ** (Math.floor(r() * 30) - 10));
  const text = E.hash.f64ToB64(knots);
  assert.equal(text.length, 2742);
  const wantBytes = Buffer.alloc(257 * 8);
  knots.forEach((v, i) => wantBytes.writeDoubleBE(v, i * 8));
  assert.equal(text, wantBytes.toString("base64url"), "same bytes as Buffer.writeDoubleBE");
  assert.equal(Buffer.from(E.hash.b64urlDecode(text)).length, 2056);
  const back = E.hash.b64ToF64(text, 257);
  assert.equal(back.length, 257);
  assert.equal(Object.prototype.toString.call(back), "[object Float64Array]");
  knots.forEach((v, i) => assert.ok(Object.is(back[i], v), `knot ${i}: ${v} vs ${back[i]}`));
});

test("f64ToB64 keeps -0, the smallest and largest doubles and the empty list", () => {
  const values = [0, -0, 5e-324, -5e-324, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 0.1, 1 / 3, 2 ** 53];
  const back = E.hash.b64ToF64(E.hash.f64ToB64(values), values.length);
  values.forEach((v, i) => assert.ok(Object.is(back[i], v), String(v)));
  assert.equal(E.hash.f64ToB64([]), "");
  assert.equal(E.hash.b64ToF64("", 0).length, 0);
  assert.equal(E.hash.f64ToB64(Float64Array.from([1, 2])), Buffer.concat([Buffer.alloc(8), Buffer.alloc(8)].map((b, i) => (b.writeDoubleBE(i + 1), b))).toString("base64url"), "typed-array input");
});

test("f64ToB64 refuses a non-finite or non-number value; b64ToF64 answers null for a bad text, a wrong length or a non-finite double", () => {
  for (const bad of [NaN, Infinity, -Infinity, "1", undefined, null]) assert.throws(() => E.hash.f64ToB64([1, bad]), isError, String(bad));
  const good = E.hash.f64ToB64([1, 2, 3]);
  assert.notEqual(E.hash.b64ToF64(good, 3), null);
  assert.equal(E.hash.b64ToF64(good, 2), null, "count too small");
  assert.equal(E.hash.b64ToF64(good, 4), null, "count too large");
  assert.equal(E.hash.b64ToF64(good.slice(0, -2), 3), null, "truncated text");
  assert.equal(E.hash.b64ToF64(good + "A", 3), null, "length 4k+1");
  assert.equal(E.hash.b64ToF64("ab+/", 3), null, "not base64url");
  assert.equal(E.hash.b64ToF64(null, 3), null);
  for (const [name, value] of [["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity]]) {
    const b = Buffer.alloc(24);
    b.writeDoubleBE(1, 0);
    b.writeDoubleBE(value, 8);
    b.writeDoubleBE(3, 16);
    assert.equal(E.hash.b64ToF64(b.toString("base64url"), 3), null, name + " in the middle");
  }
  const signalling = Buffer.from("7ff0000000000001", "hex");
  assert.equal(E.hash.b64ToF64(signalling.toString("base64url"), 1), null, "a NaN payload");
  for (const count of [-1, 1.5, NaN, undefined, "3"]) assert.throws(() => E.hash.b64ToF64(good, count), named("TypeError"), `count ${String(count)}`);
});
