"use strict";
// U48 (T-notice): E.notice (part 21), the queue behind the banner: coalescing, once-per-payload memory,
// dismissal and the `version` counter (API.md A.3, B.14, DD-53, INTEGRATION.md D.7).
//
// Oracles (none is the code under test): the timelines below, written by hand on a fake clock whose
// value the test sets ("a failure every 250 ms for 2.25 s is one row of count 10"; "4999 ms after the
// last occurrence is inside a 5000 ms window, 5000 ms is outside"); the record shape of B.14, listed
// field by field; the English of INTEGRATION.md D.11 for the codes (literal strings); the 15 codes of
// B.14 (DR-31 voids `named-views-limit`); JSON round trips for the record. Expectations about the number
// of `version` steps are counted by hand from the definition "changes exactly when the banner's content
// would": a row appears, a visible row's count moves, a row is dismissed.
// The module may run in a vm context (ENCODING_PARTS_DIR): arrays and errors are of another realm, so
// structures are compared through JSON and errors by name.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;

// A queue on a clock the test moves by hand.
function make(extra) {
  const clock = { t: 1000 };
  const n = E.notice.create({ now: () => clock.t, ...(extra || {}) });
  return { n, clock, tick: (ms) => (clock.t += ms) };
}

const CODES = ["legacy-migrated", "version-default", "scale-changed", "address-degraded", "storage-failed", "history-failed",
  "import-rejected", "import-partial", "scale-dropped", "scale-context-differs", "appearance-mismatch", "limit", "clipboard",
  "code-not-stored", "scale-fault"];
const STORAGE_TEXT = "This browser could not save the view. The explorer keeps working; changes will not persist.";

// ---- create ---------------------------------------------------------------------------------------------

test("create: needs a clock function and a sane window; the queue starts empty at version 0", () => {
  for (const bad of [undefined, null, {}, { now: 5 }, { now: "x" }, 5]) assert.throws(() => E.notice.create(bad), isError("TypeError"), JSON.stringify(bad));
  for (const bad of [-1, NaN, Infinity, "5", null]) assert.throws(() => E.notice.create({ now: () => 0, coalesceMs: bad }), isError("TypeError"), String(bad));
  const { n } = make();
  assert.deepEqual(plain(n.list()), []);
  assert.equal(n.current(), null);
  assert.equal(n.version, 0);
  assert.deepEqual(Object.keys(n).sort(), ["current", "dismiss", "list", "mark", "post", "seen", "version"]);
  assert.ok(Object.isFrozen(n));
});

test("create: two queues share nothing (DD-02), and the default window is TIMING.NOTICE_COALESCE_MS = 5000", () => {
  const a = make();
  const b = make();
  a.n.post({ code: "clipboard" });
  a.n.mark("d1");
  assert.equal(b.n.list().length, 0);
  assert.equal(b.n.seen("d1"), false);
  assert.equal(E.TIMING.NOTICE_COALESCE_MS, 5000);
  a.n.post({ code: "history-failed" });
  a.tick(4999);
  a.n.post({ code: "history-failed" });
  assert.equal(a.n.list().length, 2, "the default window is 5000 ms: 4999 ms is inside it");
});

// ---- post: the record -----------------------------------------------------------------------------------

test("post: the record has the fields of B.14 in order, ids n1, n2, ..., and the words of D.11", () => {
  const { n, clock } = make();
  clock.t = 123456;
  const row = n.post({ code: "storage-failed" });
  assert.deepEqual(Object.keys(row), ["id", "code", "level", "text", "details", "key", "count", "atMs", "dismissed"]);
  assert.deepEqual(plain(row), {
    id: "n1",
    code: "storage-failed",
    level: "error",
    text: STORAGE_TEXT,
    details: [],
    key: "storage-failed:" + STORAGE_TEXT,
    count: 1,
    atMs: 123456,
    dismissed: false,
  });
  const second = n.post({ code: "clipboard" });
  assert.equal(second.id, "n2");
  assert.equal(second.text, "The clipboard was not available. The text is selected for copying.");
  assert.equal(plain(row).id, "n1");
  assert.equal(n.version, 2);
});

test("post: every one of the 15 codes has its D.11 words; parameters are filled; a missing one stays visible", () => {
  const words = {
    "legacy-migrated": ["Opened a view saved before visual version 2. Its settings were kept; colours and scales now use version 2.", {}],
    "version-default": ["This version measures and colours differently (visual version 2). The default view is shown.", {}],
    "scale-changed": ["Scale changed: period, lock", { causes: "period, lock" }],
    "address-degraded": ["The address was shortened: Address: exact. Copy the full view code to keep the exact scales.", { level: "Address: exact" }],
    "storage-failed": [STORAGE_TEXT, {}],
    "history-failed": ["This browser could not update the history entry. The view is unchanged.", {}],
    "import-rejected": ["The view code was not applied: unknown version", { reason: "unknown version" }],
    "import-partial": ["The view code was applied without its scale: bad hash", { reason: "bad hash" }],
    "scale-dropped": ["The scale in this link could not be used; a fresh Explore scale is in use", {}],
    "scale-context-differs": ["The scale in this link was fitted at n=8, m=2; this window shows n=9, m=3, so a fresh scale is in use", { n: 8, m: 2, n2: 9, m2: 3 }],
    "appearance-mismatch": ["This link was made with appearance a1b2c3d4; this page uses 8f7890f7. Mapping ids still match.", { ap: "a1b2c3d4", current: "8f7890f7" }],
    "limit": ["The view has more than 16 active scales. Release one before adding another.", { max: 16 }],
    "clipboard": ["The clipboard was not available. The text is selected for copying.", {}],
    "code-not-stored": ["The full view code was not stored with this view; copy it separately to keep the exact scales.", {}],
    "scale-fault": ["The scale display hit an error and was turned off for this session; the chart shows occupancy only. Reload the page.", {}],
  };
  assert.deepEqual(Object.keys(words).sort(), [...CODES].sort());
  for (const code of CODES) {
    const { n } = make();
    const row = n.post({ code, params: words[code][1] });
    assert.equal(row.text, words[code][0], code);
    assert.equal(row.code, code);
    assert.ok(["info", "warning", "error"].includes(row.level), code);
  }
  const { n } = make();
  assert.equal(n.post({ code: "import-rejected" }).text, "The view code was not applied: {reason}", "a missing name stays visible; post does not throw");
});

test("post: explicit text, details, level and key override the defaults; details keep only strings and are frozen", () => {
  const { n } = make();
  const row = n.post({ code: "legacy-migrated", text: "Opened an old view.", details: ["Volume: was A; now B", 7, null, "Flow: was C; now D"], level: "warning", key: "legacy-migrated:3fa9c2", params: { ignored: 1 } });
  assert.equal(row.text, "Opened an old view.", "given text is used as it is");
  assert.deepEqual(plain(row.details), ["Volume: was A; now B", "Flow: was C; now D"]);
  assert.equal(row.level, "warning");
  assert.equal(row.key, "legacy-migrated:3fa9c2");
  assert.ok(Object.isFrozen(row) && Object.isFrozen(row.details));
  const odd = n.post({ code: "clipboard", level: "fatal", details: "not an array", key: "" });
  assert.equal(odd.level, "info", "an unknown level falls back to the code's default");
  assert.deepEqual(plain(odd.details), []);
  assert.equal(odd.key, "clipboard:" + odd.text, "an empty key falls back to the default key");
});

test("post: default levels by code (errors: things that did not happen; warnings: reduced; info: facts)", () => {
  const level = {};
  for (const code of CODES) level[code] = make().n.post({ code, params: {} }).level;
  assert.deepEqual(level, {
    "legacy-migrated": "info", "version-default": "info", "scale-changed": "info", "address-degraded": "warning", "storage-failed": "error",
    "history-failed": "warning", "import-rejected": "error", "import-partial": "warning", "scale-dropped": "warning",
    "scale-context-differs": "info", "appearance-mismatch": "info", "limit": "warning", "clipboard": "info", "code-not-stored": "info", "scale-fault": "error",
  });
});

test("post never throws: refused input answers null and changes nothing (it runs inside catch blocks)", () => {
  const { n } = make();
  const bad = [undefined, null, 5, "storage-failed", [], {}, { code: 5 }, { code: "nope" }, { code: "constructor" }, { code: "__proto__" }, { code: "toString" },
    { code: "named-views-limit" }, { code: "storage-failed", text: 5 }, { code: "storage-failed", text: {} }];
  for (const input of bad) {
    let out;
    assert.doesNotThrow(() => {
      out = n.post(input);
    }, JSON.stringify(input));
    assert.equal(out, null, JSON.stringify(input));
  }
  assert.equal(n.version, 0);
  assert.equal(n.list().length, 0);
  const hostile = { code: "clipboard", get params() { throw new Error("getter"); } };
  assert.doesNotThrow(() => n.post(hostile));
  assert.doesNotThrow(() => n.post({ code: "clipboard", params: new Proxy({}, { get() { throw new Error("x"); }, has() { throw new Error("x"); } }) }));
  assert.equal(n.version, 1, "an input whose getter throws is refused; params that only fail inside fill still post the words");
  assert.equal(n.list()[0].text, "The clipboard was not available. The text is selected for copying.");
});

test("DR-31: there is no named-views-limit code", () => {
  const { n } = make();
  assert.equal(n.post({ code: "named-views-limit", text: "This browser keeps 200 named views." }), null);
  assert.equal(n.list().length, 0);
});

test("post survives a clock that throws or answers a non-number: no time has passed", () => {
  let mode = "ok";
  let t = 500;
  const n = E.notice.create({ now: () => { if (mode === "throw") throw new Error("clock"); return mode === "nan" ? NaN : t; } });
  assert.equal(n.post({ code: "history-failed" }).atMs, 500);
  mode = "throw";
  const again = n.post({ code: "history-failed" });
  assert.equal(again.count, 2, "the same key at 'no time passed' coalesces");
  assert.equal(again.atMs, 500);
  mode = "nan";
  assert.equal(n.post({ code: "history-failed" }).count, 3);
});

// ---- coalescing -----------------------------------------------------------------------------------------

test("coalescing: 10 storage failures 250 ms apart are ONE row with count 10, and one visible step each", () => {
  const { n, clock } = make();
  clock.t = 0;
  let last;
  for (let i = 0; i < 10; i++) {
    clock.t += 250;
    last = n.post({ code: "storage-failed" });
  }
  assert.equal(n.list().length, 1);
  assert.equal(last.count, 10);
  assert.equal(last.id, "n1");
  assert.equal(last.atMs, 2500, "atMs is the latest occurrence");
  assert.equal(n.current().count, 10);
  assert.equal(n.version, 10, "one step for the row, nine for the visible count moving");
});

test("coalescing: the window slides from the LAST occurrence: a failure that keeps happening stays one row", () => {
  const { n, clock } = make();
  for (let i = 0; i < 6; i++) {
    n.post({ code: "history-failed" });
    clock.t += 4000;
  }
  assert.equal(n.list().length, 1, "six occurrences 4 s apart, 20 s in all, are one row");
  assert.equal(n.list()[0].count, 6);
});

test("coalescing: the boundary is exclusive: 4999 ms after the last occurrence coalesces, 5000 ms starts a new row", () => {
  const { n, clock } = make();
  n.post({ code: "history-failed" });
  clock.t += 4999;
  assert.equal(n.post({ code: "history-failed" }).count, 2);
  clock.t += 5000;
  const fresh = n.post({ code: "history-failed" });
  assert.equal(fresh.count, 1);
  assert.equal(fresh.id, "n2");
  assert.equal(n.list().length, 2);
});

test("coalescing: a custom window, and a window of 0 never coalesces", () => {
  const short = make({ coalesceMs: 1000 });
  short.n.post({ code: "clipboard" });
  short.tick(999);
  assert.equal(short.n.post({ code: "clipboard" }).count, 2);
  short.tick(1000);
  assert.equal(short.n.post({ code: "clipboard" }).count, 1);
  const none = make({ coalesceMs: 0 });
  none.n.post({ code: "clipboard" });
  none.n.post({ code: "clipboard" });
  assert.equal(none.n.list().length, 2);
});

test("coalescing: only the same key coalesces; the default key includes the words, an explicit key overrides them", () => {
  const { n } = make();
  n.post({ code: "storage-failed" });
  n.post({ code: "history-failed" });
  assert.equal(n.list().length, 2, "different codes are different rows");
  n.post({ code: "import-rejected", params: { reason: "unknown version" } });
  n.post({ code: "import-rejected", params: { reason: "too large" } });
  assert.equal(n.list().length, 4, "different words are different notices: the second reason is not hidden behind the first");
  n.post({ code: "import-rejected", params: { reason: "too large" } });
  assert.equal(n.list().length, 4);
  assert.equal(n.list()[3].count, 2);
  n.post({ code: "legacy-migrated", key: "legacy-migrated:aaa" });
  n.post({ code: "legacy-migrated", key: "legacy-migrated:bbb" });
  n.post({ code: "legacy-migrated", key: "legacy-migrated:aaa", text: "other words, same payload" });
  assert.equal(n.list().length, 6);
  assert.equal(n.list()[4].count, 2, "the same key coalesces whatever the words");
  assert.equal(n.list()[4].text, "Opened a view saved before visual version 2. Its settings were kept; colours and scales now use version 2.", "the row keeps its first words");
});

// ---- current, queue and dismissal ----------------------------------------------------------------------

test("current: the highest level shows first, then the newest; the rest wait in the queue", () => {
  const { n } = make();
  n.post({ code: "clipboard" });
  n.post({ code: "scale-changed", params: { causes: "period" } });
  assert.equal(n.current().code, "scale-changed", "same level (info): the newer");
  const warn = n.post({ code: "limit", params: { max: 16 } });
  assert.equal(n.current().id, warn.id, "a warning beats two infos");
  const err = n.post({ code: "storage-failed" });
  assert.equal(n.current().id, err.id, "an error beats a warning");
  n.post({ code: "import-partial", params: { reason: "x" } });
  assert.equal(n.current().id, err.id, "a newer warning does not displace an older error");
  n.post({ code: "scale-fault" });
  assert.equal(n.current().code, "scale-fault", "two errors: the newer");
});

test("dismiss: the next in the queue shows; all dismissed leaves none; dismissed rows stay in list() with the flag", () => {
  const { n } = make();
  const a = n.post({ code: "clipboard" });
  const b = n.post({ code: "history-failed" });
  const c = n.post({ code: "storage-failed" });
  assert.equal(n.version, 3);
  assert.equal(n.dismiss(c.id), true);
  assert.equal(n.version, 4);
  assert.equal(n.current().id, b.id);
  assert.equal(n.dismiss(b.id), true);
  assert.equal(n.current().id, a.id);
  assert.equal(n.dismiss(a.id), true);
  assert.equal(n.current(), null);
  assert.equal(n.version, 6);
  assert.deepEqual(plain(n.list().map((r) => [r.id, r.dismissed])), [["n1", true], ["n2", true], ["n3", true]]);
});

test("dismiss: an unknown or already dismissed id answers false and moves nothing", () => {
  const { n } = make();
  const a = n.post({ code: "clipboard" });
  assert.equal(n.dismiss("n99"), false);
  assert.equal(n.dismiss(undefined), false);
  assert.equal(n.dismiss(null), false);
  assert.equal(n.dismiss(5), false);
  assert.equal(n.dismiss(a.id), true);
  const v = n.version;
  assert.equal(n.dismiss(a.id), false);
  assert.equal(n.version, v);
});

test("dismissal sticks while the failure keeps happening: the count grows quietly, the banner does not come back", () => {
  const { n, tick } = make();
  const row = n.post({ code: "storage-failed" });
  n.dismiss(row.id);
  const v = n.version;
  for (let i = 0; i < 5; i++) {
    tick(250);
    n.post({ code: "storage-failed" });
  }
  assert.equal(n.current(), null, "still dismissed");
  assert.equal(n.version, v, "a count moving on a hidden row is not a visible change");
  assert.equal(n.list()[0].count, 6);
  assert.equal(n.list().length, 1);
  tick(5000);
  const back = n.post({ code: "storage-failed" });
  assert.equal(back.id, "n2", "after a quiet window the failure is news again");
  assert.equal(n.current().id, "n2");
  assert.equal(n.version, v + 1);
});

// ---- version --------------------------------------------------------------------------------------------

test("version is monotone, moves on every visible change, and only then", () => {
  const { n, tick } = make();
  const seen = [n.version];
  const step = () => seen.push(n.version);
  n.post({ code: "clipboard" });
  step();
  tick(10);
  n.post({ code: "clipboard" });
  step();
  n.post({ code: "history-failed" });
  step();
  n.dismiss("n2");
  step();
  assert.deepEqual(seen, [0, 1, 2, 3, 4]);
  // None of these is visible.
  const v = n.version;
  n.list();
  n.current();
  n.seen("d");
  n.mark("d");
  n.mark("e");
  n.dismiss("n2");
  n.dismiss("nope");
  n.post(null);
  n.post({ code: "nope" });
  assert.equal(n.version, v);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1]);
});

// ---- once per payload -----------------------------------------------------------------------------------

test("seen and mark: mark answers true once, so `if (mark(d)) post(...)` posts once per payload", () => {
  const { n } = make();
  assert.equal(n.seen("3fa9c2"), false);
  assert.equal(n.mark("3fa9c2"), true);
  assert.equal(n.seen("3fa9c2"), true);
  assert.equal(n.mark("3fa9c2"), false);
  assert.equal(n.seen("other"), false);
  let posted = 0;
  for (let i = 0; i < 4; i++) if (n.mark("payload-1")) { n.post({ code: "legacy-migrated" }); posted++; }
  assert.equal(posted, 1);
  assert.equal(n.list().length, 1);
});

test("seen and mark: not a string, or empty, is never remembered", () => {
  const { n } = make();
  for (const bad of [undefined, null, 5, {}, [], "", true]) {
    assert.equal(n.mark(bad), false, String(bad));
    assert.equal(n.seen(bad), false, String(bad));
  }
  assert.equal(n.seen("constructor"), false);
  assert.equal(n.seen("__proto__"), false);
  assert.equal(n.mark("__proto__"), true, "a digest is only text");
  assert.equal(n.seen("__proto__"), true);
});

test("seen and mark: the memory is bounded (the oldest digest is forgotten past 256)", () => {
  const { n } = make();
  for (let i = 0; i < 300; i++) n.mark("d" + i);
  assert.equal(n.seen("d299"), true);
  assert.equal(n.seen("d43"), false, "forgotten: 300 marked, the newest 256 (d44 to d299) kept");
  assert.equal(n.seen("d0"), false);
  assert.equal(n.seen("d44"), true);
  assert.equal(n.mark("d43"), true, "a forgotten digest is new again");
});

// ---- snapshots and bounds -------------------------------------------------------------------------------

test("a returned row is a frozen copy: changing it cannot change the queue", () => {
  const { n } = make();
  const row = n.post({ code: "storage-failed", details: ["a"] });
  assert.throws(() => {
    "use strict";
    row.count = 99;
  }, isError("TypeError"));
  assert.throws(() => {
    "use strict";
    row.details.push("b");
  }, isError("TypeError"));
  const listed = n.list();
  listed.length = 0;
  listed.push({ fake: true });
  assert.equal(n.list().length, 1);
  assert.equal(n.list()[0].count, 1);
  n.post({ code: "storage-failed", details: ["a"] });
  assert.equal(row.count, 1, "an earlier snapshot does not move");
  assert.equal(n.list()[0].count, 2);
});

test("every row is JSON-safe and survives a JSON round trip unchanged", () => {
  const { n } = make();
  n.post({ code: "legacy-migrated", details: ["Volume: was A; now B"], key: "legacy-migrated:3fa9" });
  n.post({ code: "limit", params: { max: 16 } });
  const rows = n.list();
  assert.deepEqual(plain(rows), JSON.parse(JSON.stringify(rows)));
  for (const row of rows) for (const v of Object.values(plain(row))) assert.ok(v === null || ["string", "number", "boolean", "object"].includes(typeof v));
});

test("the queue keeps at most 32 rows: a dismissed row goes first, then the oldest", () => {
  const { n } = make();
  for (let i = 0; i < 32; i++) n.post({ code: "clipboard", key: "k" + i });
  assert.equal(n.list().length, 32);
  n.dismiss("n5");
  n.post({ code: "clipboard", key: "k32" });
  const ids = n.list().map((r) => r.id);
  assert.equal(ids.length, 32);
  assert.ok(!ids.includes("n5"), "the dismissed row was dropped");
  assert.ok(ids.includes("n1"), "the oldest visible row was kept");
  n.post({ code: "clipboard", key: "k33" });
  const after = n.list().map((r) => r.id);
  assert.equal(after.length, 32);
  assert.ok(!after.includes("n1"), "with nothing dismissed the oldest goes");
  assert.ok(after.includes("n34"), "the newest row is kept");
  for (let i = 0; i < 100; i++) n.post({ code: "clipboard", key: "flood" + i });
  assert.equal(n.list().length, 32, "a flood cannot grow the queue");
});
