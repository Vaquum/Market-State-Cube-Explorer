"use strict";
// U44 (T-result): E.result of src/encoding.js, loaded through tests/support/enc.js.
// Oracles (none is the code under test): the hand-written tables of API.md B.1 (the 14 tags, their
// required fields and fixed wordings) and C.1.2 (the precedence ladder, checked as "the highest-priority
// condition that is present wins" over all 16 x 2 x 2 inputs); JSON.stringify / JSON.parse round trips for
// JSON safety; the user-visible strings of INTEGRATION.md D.11 (typed.*) for describe.
// E.result.describe reads E.text (part 04) lazily. While part 04 does not exist, its behaviour is tested
// against a small stub part 04 assembled in a temporary directory next to the real parts (so the logic of
// describe is covered today), and the test against the REAL E.text is a todo that must turn green at
// assembly gate A0.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): its objects and errors are of another
// realm, so comparisons go through JSON and errors are matched by name.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const named = (name) => ({ name });
const isError = (e) => typeof e === "object" && e !== null && /Error$/.test(e.name);

const TAGS = [
  "finite", "negative-infinite", "no-reference", "empty-both", "empty-population", "undefined", "no-coarser-parent",
  "waiting-for-complete-parent", "outside-support", "hidden", "pending", "failed", "unsupported", "invalid-input",
];

test("TAGS: the 14 tags of B.1 in order, frozen; TAG maps each to its index with finite = 0", () => {
  assert.deepEqual(Array.from(E.result.TAGS), TAGS);
  assert.ok(Object.isFrozen(E.result.TAGS));
  assert.ok(Object.isFrozen(E.result.TAG));
  assert.equal(E.result.TAG.finite, 0);
  TAGS.forEach((tag, i) => assert.equal(E.result.TAG[tag], i, tag));
  assert.equal(Object.keys(E.result.TAG).length, 14);
});

test("make: every tag with the fields B.1 requires, JSON-safe, only the fields that apply", () => {
  const { make } = E.result;
  const expected = [
    ["finite", { value: -0.415 }, { tag: "finite", value: -0.415 }],
    ["finite", { value: 0 }, { tag: "finite", value: 0 }],
    ["negative-infinite", undefined, { tag: "negative-infinite", reason: "no current volume" }],
    ["no-reference", undefined, { tag: "no-reference", reason: "no reference volume" }],
    ["empty-both", undefined, { tag: "empty-both" }],
    ["empty-population", { denominator: "parent volume", reason: "parent volume is 0" }, { tag: "empty-population", reason: "parent volume is 0", denominator: "parent volume" }],
    ["undefined", { denominator: "trades", reason: "no trades" }, { tag: "undefined", reason: "no trades", denominator: "trades" }],
    ["undefined", { denominator: "price range" }, { tag: "undefined", denominator: "price range" }],
    ["no-coarser-parent", undefined, { tag: "no-coarser-parent" }],
    ["waiting-for-complete-parent", undefined, { tag: "waiting-for-complete-parent", open: true }],
    ["waiting-for-complete-parent", { open: true }, { tag: "waiting-for-complete-parent", open: true }],
    ["outside-support", { reason: "outside price support" }, { tag: "outside-support", reason: "outside price support" }],
    ["hidden", undefined, { tag: "hidden", reason: "replay" }],
    ["pending", undefined, { tag: "pending", reason: "reading" }],
    ["pending", { reason: "column not complete" }, { tag: "pending", reason: "column not complete" }],
    ["failed", { reason: "cube_unavailable" }, { tag: "failed", reason: "cube_unavailable" }],
    ["unsupported", { reason: "not recorded" }, { tag: "unsupported", reason: "not recorded" }],
    ["invalid-input", { reason: "negative-dwell" }, { tag: "invalid-input", reason: "negative-dwell" }],
    ["finite", { value: 2, detail: { restricted: true } }, { tag: "finite", value: 2, detail: { restricted: true } }],
  ];
  for (const [tag, fields, want] of expected) {
    const got = make(tag, fields);
    assert.deepEqual(plain(got), want, tag);
    assert.deepEqual(Object.keys(got), Object.keys(want), `${tag}: only fields that apply, in the B.1 order`);
    for (const key of Object.keys(got)) assert.notEqual(got[key], undefined, `${tag}.${key} is never undefined`);
    assert.doesNotThrow(() => E.result.assertJsonSafe(got));
  }
  assert.deepEqual(plain(make("pending", { reason: "measuring" })), { tag: "pending", reason: "measuring" });
});

test("make throws on an unknown tag, a bad or misplaced value, a missing required field and a field that does not exist", () => {
  const { make } = E.result;
  for (const tag of ["", "Finite", "nope", "toString", "__proto__", "constructor", undefined, null, 3, {}]) assert.throws(() => make(tag), named("RangeError"), `tag ${String(tag)}`);
  for (const value of [NaN, Infinity, -Infinity, "1", undefined, null]) assert.throws(() => make("finite", { value }), named("RangeError"), `value ${String(value)}`);
  assert.throws(() => make("finite"), named("RangeError"), "finite without value");
  assert.throws(() => make("pending", { value: 1 }), named("RangeError"), "value on a non-finite tag");
  assert.throws(() => make("failed"), named("RangeError"), "failed needs a reason");
  assert.throws(() => make("unsupported"), named("RangeError"));
  assert.throws(() => make("outside-support"), named("RangeError"));
  assert.throws(() => make("invalid-input"), named("RangeError"));
  assert.throws(() => make("undefined"), named("RangeError"), "undefined needs a denominator");
  assert.throws(() => make("empty-population", { reason: "x" }), named("RangeError"));
  assert.throws(() => make("undefined", { denominator: "" }), named("RangeError"));
  assert.throws(() => make("finite", { value: 1, denominator: "trades" }), named("RangeError"), "denominator only on undefined / empty-population");
  assert.throws(() => make("pending", { open: true }), named("RangeError"), "open only on waiting-for-complete-parent");
  assert.throws(() => make("waiting-for-complete-parent", { open: false }), named("RangeError"));
  assert.throws(() => make("failed", { reason: 5 }), named("TypeError"));
  assert.throws(() => make("pending", { rason: "typo" }), named("RangeError"), "unknown field");
  assert.throws(() => make("finite", { value: 1, detail: { bad: NaN } }), named("TypeError"), "detail must be JSON-safe");
});

test("make keeps a string within the 256-character limit (a cube error message can be longer) without splitting a surrogate pair", () => {
  const { make } = E.result;
  const long = "e".repeat(1000);
  const failed = make("failed", { reason: long });
  assert.equal(failed.reason.length, 256);
  assert.ok(failed.reason.endsWith("..."));
  assert.equal(failed.reason.slice(0, 253), "e".repeat(253));
  assert.equal(make("failed", { reason: "e".repeat(256) }).reason, "e".repeat(256), "exactly 256 is kept");
  assert.equal(make("failed", { reason: "x" }).reason, "x");
  const pairs = "\u{1F600}".repeat(200);
  const cut = make("failed", { reason: pairs }).reason;
  assert.ok(cut.length <= 256);
  const body = cut.slice(0, -3);
  assert.doesNotMatch(body, /[\ud800-\udbff]$/, "no dangling high surrogate before the ellipsis");
  assert.equal(JSON.parse(JSON.stringify(cut)), cut);
  assert.equal(make("undefined", { denominator: long }).denominator.length, 256);
});

test("finite: a number is a value, anything else is invalid-input non-finite (never clamped, never zero)", () => {
  const { finite } = E.result;
  assert.deepEqual(plain(finite(3.5)), { tag: "finite", value: 3.5 });
  assert.deepEqual(plain(finite(0)), { tag: "finite", value: 0 });
  assert.equal(finite(-0).tag, "finite");
  assert.deepEqual(plain(finite(-1e308)), { tag: "finite", value: -1e308 });
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "1", {}, 1n]) {
    assert.deepEqual(plain(finite(bad)), { tag: "invalid-input", reason: "non-finite" }, String(bad));
  }
});

test("isValue: true only for a finite result", () => {
  const { isValue, make, finite } = E.result;
  assert.equal(isValue(finite(0)), true);
  assert.equal(isValue(make("finite", { value: 1 })), true);
  for (const tag of TAGS.slice(1)) {
    const fields = tag === "undefined" || tag === "empty-population" ? { denominator: "x" } : tag === "failed" || tag === "unsupported" || tag === "outside-support" || tag === "invalid-input" ? { reason: "r" } : undefined;
    assert.equal(isValue(make(tag, fields)), false, tag);
  }
  assert.equal(isValue(null), false);
  assert.equal(isValue(undefined), false);
  assert.equal(isValue({}), false);
});

test("precedence (C.1.2): read status, then replay, then outside support, then nothing; the highest present condition wins", () => {
  const { precedence } = E.result;
  const reads = [null, { state: "failed", reason: "cube_unavailable" }, { state: "pending", reason: "column not complete" }, { state: "unsupported", reason: "not recorded" }];
  // Hand oracle: conditions in priority order, each with the answer it forces.
  for (const read of reads) {
    for (const hidden of [false, true]) {
      for (const outside of [null, { reason: "outside selection" }]) {
        const ladder = [
          [read && read.state === "failed", { tag: "failed", reason: "cube_unavailable" }],
          [read && read.state === "pending", { tag: "pending", reason: "column not complete" }],
          [read && read.state === "unsupported", { tag: "unsupported", reason: "not recorded" }],
          [hidden, { tag: "hidden", reason: "replay" }],
          [outside, { tag: "outside-support", reason: "outside selection" }],
        ];
        const hit = ladder.find(([present]) => present);
        const want = hit ? hit[1] : null;
        const got = precedence({ read, hidden, outside });
        assert.deepEqual(got === null ? null : plain(got), want, `read=${read && read.state} hidden=${hidden} outside=${!!outside}`);
      }
    }
  }
  assert.equal(precedence({}), null, "absent fields mean nothing to report");
  assert.equal(precedence({ read: null, hidden: false, outside: null }), null);
});

test("precedence: failed is never shown as merely reading; a read that answered (any other state) does not interfere", () => {
  const { precedence } = E.result;
  assert.equal(precedence({ read: { state: "failed", reason: "x" }, hidden: true, outside: { reason: "y" } }).tag, "failed");
  assert.equal(precedence({ read: { state: "ok" }, hidden: true }).tag, "hidden");
  assert.equal(precedence({ read: { state: "ready" }, outside: { reason: "outside price support" } }).reason, "outside price support");
});

test("precedence: default wording when a read record carries none; a long failure message is cut to 256", () => {
  const { precedence } = E.result;
  assert.deepEqual(plain(precedence({ read: { state: "pending" } })), { tag: "pending", reason: "reading" });
  assert.equal(precedence({ read: { state: "failed" } }).tag, "failed");
  assert.equal(typeof precedence({ read: { state: "failed" } }).reason, "string");
  assert.equal(typeof precedence({ read: { state: "unsupported" } }).reason, "string");
  assert.equal(precedence({ read: { state: "failed", reason: "e".repeat(999) } }).reason.length, 256);
  assert.equal(precedence({ outside: {} }).tag, "outside-support");
});

test("assertJsonSafe: returns its argument when every value is JSON-safe", () => {
  const { assertJsonSafe } = E.result;
  const ok = [null, true, "s", 0, -0, 1.5, [], {}, [1, [2, { a: null }]], { a: { b: [1, "x", false] } }, { "": 1 }, "\ud800"];
  for (const v of ok) assert.equal(assertJsonSafe(v), v);
  const shared = { n: 1 };
  assert.doesNotThrow(() => assertJsonSafe({ a: shared, b: shared }), "a shared (not cyclic) object is fine");
  assert.doesNotThrow(() => assertJsonSafe(E.result.make("failed", { reason: "x", detail: { a: [1, 2] } })));
});

test("assertJsonSafe: throws a TypeError naming the path for NaN, infinities, undefined, functions, symbols, bigints, Map, Set, Date, typed arrays, boxed values, holes and cycles", () => {
  const { assertJsonSafe } = E.result;
  const bad = {
    NaN: NaN,
    Infinity: Infinity,
    "-Infinity": -Infinity,
    undefined: undefined,
    function: () => 1,
    symbol: Symbol("s"),
    bigint: 1n,
    Map: new Map(),
    Set: new Set(),
    Date: new Date(0),
    Float64Array: new Float64Array(1),
    Uint8Array: new Uint8Array(1),
    RegExp: /x/,
    "boxed String": Object("s"),
  };
  for (const [name, v] of Object.entries(bad)) {
    assert.throws(() => assertJsonSafe(v), named("TypeError"), `top-level ${name}`);
    assert.throws(() => assertJsonSafe({ a: { b: [1, v] } }), (e) => e.name === "TypeError" && e.message.includes("$.a.b[1]"), `${name} reports its path`);
  }
  assert.throws(() => assertJsonSafe([1, , 3]), (e) => e.name === "TypeError" && e.message.includes("$[1]"), "an array hole is undefined");
  assert.throws(() => assertJsonSafe({ a: undefined }), (e) => e.name === "TypeError" && e.message.includes("$.a"), "an undefined member");
  const cycle = { a: [] };
  cycle.a.push(cycle);
  assert.throws(() => assertJsonSafe(cycle), (e) => e.name === "TypeError" && /cycle/.test(e.message));
  let deep = [];
  for (let i = 0; i < 200; i++) deep = [deep];
  assert.throws(() => assertJsonSafe(deep), named("TypeError"), "absurd depth");
});

// ---- describe --------------------------------------------------------------

// A minimal part 04 with the D.11 wording of typed.*, used only while the real one does not exist.
const STUB_TEXT = `  // @part 04-text
  // @requires
  // @prefix txt
  // @provides text
  // Test stub of part 04: the typed.* strings of INTEGRATION.md D.11 and a {name} substitution.
  const txtTyped = Object.freeze({
    "finite": "{value}",
    "negative-infinite": "No current volume in the rectangle; the period traded here (\\u2212\\u221e on the log scale)",
    "no-reference": "No reference volume: the period did not trade here",
    "empty-both": "Neither traded here",
    "empty-population": "Undefined: {denominator} is 0",
    "undefined": "Undefined: {denominator} is 0",
    "no-coarser-parent": "Undefined: no coarser parent",
    "waiting-for-complete-parent": "Waiting for the complete parent (open)",
    "outside-support": "Outside comparison support",
    "hidden": "Hidden in replay",
    "pending": "Reading: {reason}",
    "failed": "Read failed: {reason}",
    "unsupported": "Not supported here: {reason}",
    "invalid-input": "Invalid input: {reason}",
  });
  function txtFill(template, params) {
    return template.replace(/\\{(\\w+)\\}/g, (m, name) => (params && name in params ? String(params[name]) : m));
  }
  API.text = Object.freeze({ typed: txtTyped, fill: txtFill });
`;

const partsDir = process.env.ENCODING_PARTS_DIR ? path.resolve(process.env.ENCODING_PARTS_DIR) : null;
const realText = Boolean(E.text && E.text.typed);
// The module describe is tested on: the real one when part 04 exists, else the parts plus the stub.
function assembleWith(withStub) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u44-parts-"));
  try {
    for (const f of fs.readdirSync(partsDir)) if (/^(00-header|01-util|02-hash|03-result|99-footer)\.js$/.test(f)) fs.copyFileSync(path.join(partsDir, f), path.join(dir, f));
    if (withStub) fs.writeFileSync(path.join(dir, "04-text.js"), STUB_TEXT);
    return require("../support/assemble-encoding.js").loadParts({ dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const D = realText ? E : partsDir ? assembleWith(true) : null;

const DESCRIBE = [
  [{ tag: "undefined", denominator: "trades", reason: "no trades" }, "Undefined: trades is 0"],
  [{ tag: "empty-population", denominator: "parent volume", reason: "parent volume is 0" }, "Undefined: parent volume is 0"],
  [{ tag: "failed", reason: "cube_unavailable" }, "Read failed: cube_unavailable"],
  [{ tag: "pending", reason: "reading" }, "Reading: reading"],
  [{ tag: "pending", reason: "column not complete" }, "Reading: column not complete"],
  [{ tag: "unsupported", reason: "not recorded" }, "Not supported here: not recorded"],
  [{ tag: "invalid-input", reason: "negative-dwell" }, "Invalid input: negative-dwell"],
  [{ tag: "hidden", reason: "replay" }, "Hidden in replay"],
  [{ tag: "outside-support", reason: "outside price support" }, "Outside comparison support"],
  [{ tag: "no-coarser-parent" }, "Undefined: no coarser parent"],
  [{ tag: "waiting-for-complete-parent", open: true }, "Waiting for the complete parent (open)"],
  [{ tag: "empty-both" }, "Neither traded here"],
  [{ tag: "no-reference", reason: "no reference volume" }, "No reference volume: the period did not trade here"],
  [{ tag: "negative-infinite", reason: "no current volume" }, "No current volume in the rectangle; the period traded here (−∞ on the log scale)"],
];

test("describe renders every tag from E.text.typed: {short, long}, values through the injected formatter", { skip: D === null && "needs ENCODING_PARTS_DIR or a module with part 04" }, () => {
  for (const [typed, short] of DESCRIBE) {
    const got = D.result.describe(typed);
    assert.equal(got.short, short, typed.tag);
    assert.equal(typeof got.long, "string");
    assert.ok(got.long.startsWith(short), `${typed.tag}: long extends short`);
  }
  assert.equal(D.result.describe({ tag: "finite", value: 0.25 }).short, "0.25", "no formatter: the plain number");
  assert.equal(D.result.describe({ tag: "finite", value: 0.25 }, (v) => (v * 100).toFixed(1) + "%").short, "25.0%");
  assert.equal(D.result.describe({ tag: "finite", value: -1234.5 }, (v) => "<" + v + ">").long, "<-1234.5>");
  assert.equal(D.result.describe({ tag: "finite", value: 0 }).short, "0", "zero is a value, described as one");
});

test("describe: long adds the reason in brackets only when the short text does not already show it", { skip: D === null && "needs ENCODING_PARTS_DIR or a module with part 04" }, () => {
  const undef = D.result.describe({ tag: "undefined", denominator: "trades", reason: "no trades" });
  assert.equal(undef.long, undef.short + " (no trades)");
  const failed = D.result.describe({ tag: "failed", reason: "cube_unavailable" });
  assert.equal(failed.long, failed.short, "the reason is already in the short text");
  const hidden = D.result.describe({ tag: "hidden" });
  assert.equal(hidden.long, hidden.short, "no reason, nothing to add");
});

test("describe: a value that is not a Typed of a known tag is described as invalid-input unknown-tag", { skip: D === null && "needs ENCODING_PARTS_DIR or a module with part 04" }, () => {
  const want = D.result.describe({ tag: "invalid-input", reason: "unknown-tag" });
  for (const bad of [null, undefined, 5, "finite", {}, { tag: "nope" }, { tag: "toString" }]) assert.deepEqual(plain(D.result.describe(bad)), plain(want), String(bad));
});

test("describe reads E.text lazily: without part 04 it throws a clear error instead of returning wrong words", { skip: partsDir === null && "needs ENCODING_PARTS_DIR to assemble a module without part 04" }, () => {
  const bare = assembleWith(false);
  assert.equal(bare.text, undefined);
  assert.throws(() => bare.result.describe({ tag: "hidden", reason: "replay" }), (e) => e.name === "Error" && /04-text/.test(e.message));
});

test("describe against the real E.text (part 04): strings of INTEGRATION.md D.11", (t) => {
  if (!realText) {
    t.todo("part 04-text is not present yet; this must turn green at assembly gate A0");
    return;
  }
  for (const [typed, short] of DESCRIBE) assert.equal(E.result.describe(typed).short, short, typed.tag);
  for (const tag of TAGS) assert.notEqual(E.text.typed[tag], undefined, `E.text.typed has "${tag}"`);
});
