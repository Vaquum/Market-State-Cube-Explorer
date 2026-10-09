"use strict";
// U33 (T-storage): src/state.js, the browser storage adapter, run in a vm context over stub storage
// (API.md B.15, INTEGRATION.md D.9 `state.js` row, DR-14, DR-31, DD-62, DD-68).
//
// Oracles (none is the code under test):
//   - the stub storage of this file: a Map with getItem/setItem/removeItem whose failures are the ones a browser
//     produces (a DOMException-shaped QuotaExceededError on setItem, a SecurityError thrown by the
//     `localStorage` getter when site data is blocked) and whose contents the tests read directly;
//   - the BASELINE reader: the original 28-line state.js of commit 8c82ca1, pasted below as a string and run
//     over the very storage this build writes to, which is the definition of "entries stay readable by the
//     baseline reader" (rollback: unknown members are ignored);
//   - the rules of the decision record written out as expected values: the four statuses, `backup:<key>` once
//     and never replaced, `scales:v1` read-modify-write with last writer wins per key and at most 64
//     contexts, no `storage` event following, no `snapshot:v1` key, and (DR-31) NO cap on named views: a
//     stored list of 250 is read and rewritten intact, a failed write is a visible failure and loses nothing.
// Not here: what explorer.js does with a foreign payload (package P, Wave 2), and the notice and ladder
// rules for a named view's code (explorer.js): they need the page.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../src/state.js"), "utf8");
const P = "market-state-cube-explorer:";

// The original state.js of the baseline 8c82ca1, verbatim (comments trimmed).
const BASELINE = `(() => {
  "use strict";
  const prefix = "market-state-cube-explorer:";
  const read = (area, key) => {
    try {
      const text = window[area].getItem(prefix + key);
      return text === null ? null : JSON.parse(text);
    } catch (error) {
      console.warn(\`The explorer's saved \${key} could not be read.\`, error);
      return null;
    }
  };
  const write = (area, key, value) =>
    window[area].setItem(prefix + key, JSON.stringify(value));
  window.explorerState = {
    saved: read("localStorage", "view:v5") || read("localStorage", "view:v4"),
    save: (state) => write("localStorage", "view:v5", state),
    views: () => read("localStorage", "views:v1"),
    saveViews: (list) => write("localStorage", "views:v1", list),
    viewsKey: prefix + "views:v1",
    history: () => read("sessionStorage", "history:v1"),
    saveHistory: (history) => write("sessionStorage", "history:v1", history),
  };
})();`;

function quota() {
  const e = new Error("The quota has been exceeded.");
  e.name = "QuotaExceededError";
  return e;
}
function security() {
  const e = new Error("The operation is insecure.");
  e.name = "SecurityError";
  return e;
}
// A storage area: a Map behind the Storage methods the page uses. `failWrite(key, text)` throws the error it returns.
class Stub {
  constructor() {
    this.map = new Map();
    this.failWrite = null;
    this.failRead = null;
    this.writes = [];
  }
  getItem(k) {
    if (this.failRead) throw this.failRead();
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    const error = this.failWrite ? this.failWrite(k, String(v)) : null;
    if (error) throw error;
    this.map.set(k, String(v));
    this.writes.push(k);
  }
  removeItem(k) {
    this.map.delete(k);
  }
  get length() {
    return this.map.size;
  }
}
// A browser window: two stub areas, optionally with a getter that throws like blocked site data.
function makeWindow(opts) {
  const local = new Stub();
  const session = new Stub();
  const win = {};
  if (opts && opts.blocked) {
    Object.defineProperty(win, "localStorage", { get() { throw security(); } });
    Object.defineProperty(win, "sessionStorage", { get() { throw security(); } });
  } else {
    win.localStorage = local;
    win.sessionStorage = session;
  }
  return { win, local, session };
}
function load(win, source) {
  const warns = [];
  const ctx = vm.createContext({ window: win, console: { warn: (...a) => warns.push(a.map(String).join(" ")), log() {} } });
  vm.runInContext(source || SOURCE, ctx, { filename: "state.js" });
  return { state: win.explorerState, warns };
}
const put = (area, key, value) => area.map.set(P + key, typeof value === "string" ? value : JSON.stringify(value));
const raw = (area, key) => (area.map.has(P + key) ? area.map.get(P + key) : undefined);
const json = (area, key) => JSON.parse(raw(area, key));
const plain = (x) => JSON.parse(JSON.stringify(x));

const V5_LEGACY = { version: 5, prefs: { sideOpen: true }, view: "#w=30d&mode=delta" };
const V5_NEW = { version: 5, visualVersion: 2, prefs: { sideOpen: false }, view: "#w=24h&vis=2&ap=slate2-8f7890f7" };

// ---- statuses ------------------------------------------------------------------------------------------------

test("read(key) -> {status, value, raw, reason}: absent, ok (legacy and v2), unreadable, unknown-version", () => {
  const { win, local, session } = makeWindow();
  const { state } = load(win);
  assert.deepEqual(plain(state.read("view:v5")), { status: "absent", value: null, raw: null, reason: null });
  put(local, "view:v5", V5_LEGACY);
  const legacy = state.read("view:v5");
  assert.equal(legacy.status, "ok");
  assert.deepEqual(plain(legacy.value), V5_LEGACY, "a payload without visualVersion is legacy and is ok: the caller classifies it");
  assert.equal(legacy.raw, JSON.stringify(V5_LEGACY));
  assert.equal(legacy.reason, null);
  put(local, "view:v5", V5_NEW);
  assert.equal(state.read("view:v5").status, "ok");
  put(local, "view:v5", "{not json");
  const bad = state.read("view:v5");
  assert.equal(bad.status, "unreadable");
  assert.equal(bad.value, null);
  assert.equal(bad.raw, "{not json", "the text is kept so it can be preserved");
  assert.match(bad.reason, /not valid JSON/);
  put(local, "view:v5", [1, 2]);
  assert.equal(state.read("view:v5").status, "unreadable");
  assert.match(state.read("view:v5").reason, /not an object/);
  // a newer build's payload: never applied (value null), kept (raw), named
  put(local, "view:v5", { version: 5, visualVersion: 3, prefs: {}, view: "#w=24h&vis=3" });
  const future = state.read("view:v5");
  assert.equal(future.status, "unknown-version");
  assert.equal(future.value, null);
  assert.match(future.reason, /visual version 3 was written by a newer or unknown version/);
  assert.equal(JSON.parse(future.raw).visualVersion, 3);
  for (const v of [2.1, "2", 1, 0, null]) {
    put(local, "view:v5", { version: 5, visualVersion: v });
    assert.equal(state.read("view:v5").status, "unknown-version", JSON.stringify(v));
  }
  put(local, "view:v5", { version: 6, prefs: {} });
  assert.match(state.read("view:v5").reason, /version 6 is not one this page reads/);
  assert.equal(state.read("view:v5").status, "unknown-version");
  // the other keys
  put(local, "views:v1", [{ name: "a", hash: "#w=24h" }]);
  assert.equal(state.read("views:v1").status, "ok");
  put(local, "views:v1", { visualVersion: 3, list: [] });
  assert.equal(state.read("views:v1").status, "unknown-version");
  put(local, "views:v1", { list: [] });
  assert.equal(state.read("views:v1").status, "unreadable");
  put(session, "history:v1", { entries: [], index: 0 });
  assert.equal(state.read("history:v1").status, "ok", "history is read from sessionStorage");
  put(session, "history:v1", { visualVersion: 9, entries: [] });
  assert.equal(state.read("history:v1").status, "unknown-version");
  put(local, "scales:v1", { contexts: [] });
  assert.equal(state.read("scales:v1").status, "unreadable", "a cache without visualVersion 2 is not usable");
  put(local, "scales:v1", { visualVersion: 3, contexts: [] });
  assert.equal(state.read("scales:v1").status, "unknown-version");
  put(local, "scales:v1", { visualVersion: 2, contexts: [{ key: "k" }] });
  assert.equal(state.read("scales:v1").status, "ok");
  assert.equal(state.read("anything:else").status, "absent", "a key that never existed");
  // read never throws, whatever is stored
  put(local, "view:v5", "null");
  assert.equal(state.read("view:v5").status, "unreadable");
});

test("storage that refuses access (blocked site data): load does not throw, reads say unreadable, writes of the new methods return the failure", () => {
  const { win } = makeWindow({ blocked: true });
  const { state, warns } = load(win);
  assert.equal(state.saved, null);
  assert.ok(warns.length >= 1, "a warning, as the baseline gave");
  const r = state.read("view:v5");
  assert.equal(r.status, "unreadable");
  assert.equal(r.raw, null);
  assert.match(r.reason, /storage is unavailable \(SecurityError/);
  assert.equal(state.scales().status, "unreadable");
  assert.equal(state.notice().status, "unreadable");
  assert.deepEqual(plain(state.backup("view:v5")).ok, false);
  const s = state.saveScales({ visualVersion: 2, contexts: [{ key: "a" }] });
  assert.equal(s.ok, false);
  assert.match(s.reason, /SecurityError/);
  assert.equal(state.saveNotice({}).ok, false);
  assert.equal(state.views(), null);
  assert.equal(state.history(), null);
  // the existing writers throw exactly as the baseline's did: the callers' catch blocks report it
  assert.throws(() => state.save({ version: 5 }), (e) => e.name === "SecurityError");
  assert.throws(() => state.saveViews([]), (e) => e.name === "SecurityError");
  assert.throws(() => state.saveHistory({ entries: [], index: 0 }), (e) => e.name === "SecurityError");
});

test("QuotaExceededError on setItem: the new methods return the failure and never throw; the running state stays usable; the old writers throw as before", () => {
  const { win, local, session } = makeWindow();
  const { state } = load(win);
  local.failWrite = () => quota();
  session.failWrite = () => quota();
  const s = state.saveScales({ visualVersion: 2, contexts: [{ key: "a", records: [] }] });
  assert.equal(s.ok, false);
  assert.match(s.reason, /QuotaExceededError/);
  const n = state.saveNotice({});
  assert.equal(n.ok, false);
  assert.match(n.reason, /QuotaExceededError/);
  assert.throws(() => state.save({ version: 5, prefs: {}, view: "#w=24h" }), (e) => e.name === "QuotaExceededError");
  assert.throws(() => state.saveViews([{ name: "a" }]), (e) => e.name === "QuotaExceededError");
  assert.throws(() => state.saveHistory({ entries: [], index: 0 }), (e) => e.name === "QuotaExceededError");
  // nothing was half written and reads still work
  assert.equal(local.map.size, 0);
  assert.equal(state.read("view:v5").status, "absent");
  // the quota clears: the same calls work again (no sticky failure state)
  local.failWrite = null;
  session.failWrite = null;
  assert.equal(state.saveScales({ visualVersion: 2, contexts: [{ key: "a" }] }).ok, true);
  state.save({ version: 5, prefs: {}, view: "#w=24h" });
  assert.equal(json(local, "view:v5").view, "#w=24h");
});

// ---- the baseline properties keep their shapes --------------------------------------------------------------------

test("the existing properties keep their shapes: saved (v5 or v4), views(), history(), viewsKey, and the keys and areas are unchanged", () => {
  const { win, local, session } = makeWindow();
  put(local, "view:v4", { version: 4, window: "7d" });
  let { state } = load(win);
  assert.deepEqual(plain(state.saved), { version: 4, window: "7d" }, "a version-4 view is read when no version-5 one exists");
  put(local, "view:v5", V5_LEGACY);
  ({ state } = load(win));
  assert.deepEqual(plain(state.saved), V5_LEGACY, "version 5 wins");
  assert.equal(state.viewsKey, P + "views:v1");
  assert.equal(state.views(), null);
  assert.equal(state.history(), null);
  put(local, "views:v1", [{ name: "a" }]);
  put(session, "history:v1", { entries: [{ id: "h1" }], index: 0 });
  assert.deepEqual(plain(state.views()), [{ name: "a" }]);
  assert.deepEqual(plain(state.history()), { entries: [{ id: "h1" }], index: 0 });
  assert.deepEqual(Object.keys(state).sort(), ["backup", "comparison", "drawings", "history", "namedViews", "namedViewsStatus", "notice", "read", "returning", "save", "saveHistory", "saveNamedViews", "saveNotice", "saveScales", "saved", "saveViews", "scales", "views", "viewsKey"].sort(), "additive: seven baseline members and the new ones");
  // a newer build's view is not handed to the page as if it were its own; it stays in storage
  put(local, "view:v5", { version: 5, visualVersion: 3, prefs: {}, view: "#vis=3" });
  const { state: s2, warns } = load(win);
  assert.equal(s2.saved, null);
  assert.ok(warns.some((w) => /visual version 3/.test(w)));
  assert.equal(json(local, "view:v5").visualVersion, 3);
  // a corrupt version 5 is not silently replaced by an older version 4
  put(local, "view:v4", { version: 4 });
  put(local, "view:v5", "{oops");
  assert.equal(load(win).state.saved, null);
});

test("writes add visualVersion 2 additively: view:v5 and history:v1 envelopes; the keys, version numbers and members are unchanged", () => {
  const { win, local, session } = makeWindow();
  const { state } = load(win);
  const view = { version: 5, prefs: { sideOpen: true, lensDepth: 2 }, view: "#w=24h&vis=2&ap=slate2-8f7890f7" };
  state.save(view);
  assert.deepEqual(json(local, "view:v5"), { ...view, visualVersion: 2 });
  assert.equal(json(local, "view:v5").version, 5, "the envelope version stays 5 (rollback-tolerant)");
  assert.ok(!("visualVersion" in view), "the caller's object is not modified");
  const history = { entries: [{ id: "h1", hash: "#w=24h&vis=2&ap=x" }], index: 0 };
  state.saveHistory(history);
  assert.deepEqual(json(session, "history:v1"), { visualVersion: 2, entries: history.entries, index: 0 });
  assert.equal([...session.map.keys()].join(), P + "history:v1", "history lives in sessionStorage");
  assert.equal([...local.map.keys()].join(), P + "view:v5", "the last view lives in localStorage under the same key");
  // entries of the list carry their own version: the list is stored as given
  const list = [
    { name: "old", hash: "#w=24h" },
    { name: "new", visualVersion: 2, hash: "#w=24h&vis=2&ap=x" },
    { name: "later", visualVersion: 3, hash: "#vis=3", unknown: { a: 1 } },
  ];
  state.saveViews(list);
  assert.deepEqual(json(local, "views:v1"), list, "a legacy entry stays legacy, a foreign entry stays untouched: a list rewrite never re-stamps what it did not make");
  assert.ok(Array.isArray(json(local, "views:v1")), "views:v1 is still a bare array: wrapping it would break rollback");
  assert.equal(plain(state.views()).length, 3);
});

test("rollback: everything this build writes is read by the BASELINE reader, which ignores what it does not know", () => {
  const { win, local, session } = makeWindow();
  const { state } = load(win);
  state.save(V5_NEW);
  state.saveHistory({ entries: [{ id: "h1", label: "Opened", hash: "#w=24h&vis=2&ap=slate2-8f7890f7" }], index: 0 });
  state.saveViews([{ name: "a", visualVersion: 2, hash: "#w=24h&vis=2&ap=slate2-8f7890f7", tA: 1, tB: 2, cut: 3, n: 4, m: 0, span: 1, lead: 0 }]);
  state.saveScales({ visualVersion: 2, contexts: [{ key: "k", ctx: {}, records: [] }] });
  state.saveNotice({});
  const old = load(win, BASELINE).state;
  assert.equal(old.saved.version, 5);
  assert.equal(old.saved.view, V5_NEW.view);
  assert.deepEqual(plain(old.saved.prefs), V5_NEW.prefs);
  assert.equal(old.views().length, 1);
  assert.equal(old.views()[0].name, "a");
  assert.equal(old.history().entries.length, 1);
  assert.equal(old.history().index, 0);
  // the new keys are simply ignored by the old page
  assert.deepEqual([...local.map.keys()].map((k) => k.slice(P.length)).sort(), ["notice:v2", "scales:v1", "view:v5", "views:v1"]);
  assert.deepEqual([...session.map.keys()].map((k) => k.slice(P.length)), ["history:v1"]);
  assert.ok(![...local.map.keys(), ...session.map.keys()].some((k) => /snapshot/.test(k)), "there is no snapshot:v1 key (DD-68)");
  assert.equal(/snapshot:v1/.test(SOURCE), false);
});

// ---- foreign and unreadable payloads are preserved -----------------------------------------------------------------

test("a foreign or unreadable payload is preserved verbatim and copied to backup:<key> BEFORE anything overwrites it, once", () => {
  for (const [key, areaName, write, foreign] of [
    ["view:v5", "local", (s) => s.save({ version: 5, prefs: {}, view: "#w=24h&vis=2&ap=x" }), JSON.stringify({ version: 5, visualVersion: 3, prefs: {}, view: "#vis=3" })],
    ["view:v5", "local", (s) => s.save({ version: 5, prefs: {}, view: "#w=24h&vis=2&ap=x" }), "{truncated"],
    ["views:v1", "local", (s) => s.saveViews([{ name: "mine", visualVersion: 2, hash: "#w=24h&vis=2&ap=x" }]), JSON.stringify({ visualVersion: 3, list: [{ name: "future" }] })],
    ["views:v1", "local", (s) => s.saveViews([]), "not json at all"],
    ["history:v1", "session", (s) => s.saveHistory({ entries: [], index: 0 }), JSON.stringify({ visualVersion: 7, entries: [{ id: "x" }], index: 0 })],
    ["history:v1", "session", (s) => s.saveHistory({ entries: [], index: 0 }), "[[["],
    ["scales:v1", "local", (s) => s.saveScales({ visualVersion: 2, contexts: [{ key: "mine" }] }), JSON.stringify({ visualVersion: 3, contexts: [{ key: "future" }] })],
  ]) {
    const { win, local, session } = makeWindow();
    const area = areaName === "local" ? local : session;
    put(area, key, foreign);
    const { state } = load(win);
    assert.equal(raw(area, key), foreign, "untouched by load and by read");
    state.read(key);
    assert.equal(raw(area, key), foreign, "untouched by read");
    assert.equal(raw(area, "backup:" + key), undefined, "no backup until something would overwrite");
    write(state);
    assert.equal(raw(area, "backup:" + key), foreign, key + ": the foreign payload was copied verbatim first");
    assert.notEqual(raw(area, key), foreign, "and then the new state was written");
    // a second foreign payload does not replace the backup of the first
    put(area, key, foreign + "X");
    const { state: again } = load(win);
    write(again);
    assert.equal(raw(area, "backup:" + key), foreign, "the backup is written ONCE and never replaced");
    assert.equal(again.backup(key).copied, false);
  }
});

test("if the backup cannot be written the overwrite is refused: the foreign payload is never lost", () => {
  const { win, local } = makeWindow();
  const foreign = JSON.stringify({ version: 5, visualVersion: 3 });
  put(local, "view:v5", foreign);
  const { state } = load(win);
  local.failWrite = (k) => (k === P + "backup:view:v5" ? quota() : null);
  assert.throws(() => state.save({ version: 5, prefs: {}, view: "#w=24h" }), /could not be kept before it was replaced/);
  assert.equal(raw(local, "view:v5"), foreign);
  assert.equal(raw(local, "backup:view:v5"), undefined);
  // the new methods report it instead of throwing
  put(local, "scales:v1", JSON.stringify({ visualVersion: 3, contexts: [] }));
  local.failWrite = (k) => (k === P + "backup:scales:v1" ? quota() : null);
  const r = state.saveScales({ visualVersion: 2, contexts: [{ key: "a" }] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not be kept/);
  assert.equal(JSON.parse(raw(local, "scales:v1")).visualVersion, 3);
});

test("backup(key): copies only an unreadable or foreign payload, returns what happened, never replaces an existing backup", () => {
  const { win, local } = makeWindow();
  const { state } = load(win);
  assert.deepEqual(plain(state.backup("view:v5")), { ok: true, copied: false, reason: "nothing is stored" });
  put(local, "view:v5", V5_LEGACY);
  assert.deepEqual(plain(state.backup("view:v5")), { ok: true, copied: false, reason: "the saved payload is readable" });
  assert.equal(raw(local, "backup:view:v5"), undefined);
  put(local, "view:v5", "{x");
  assert.deepEqual(plain(state.backup("view:v5")), { ok: true, copied: true, reason: null });
  assert.equal(raw(local, "backup:view:v5"), "{x");
  put(local, "view:v5", "{y");
  assert.deepEqual(plain(state.backup("view:v5")), { ok: true, copied: false, reason: "a backup already exists" });
  assert.equal(raw(local, "backup:view:v5"), "{x");
  local.failRead = () => security();
  assert.equal(state.backup("view:v5").ok, false);
});

test("a write whose slot still holds what this page wrote does not look at the payload again (Play saves several times a second)", () => {
  const { win, local } = makeWindow();
  const { state } = load(win);
  let reads = 0;
  const get = local.getItem.bind(local);
  local.getItem = (k) => {
    reads++;
    return get(k);
  };
  state.save(V5_NEW);
  const afterFirst = reads;
  for (let i = 0; i < 20; i++) state.save({ ...V5_NEW, view: "#w=24h&vis=2&ap=slate2-8f7890f7&h=" + (i % 2 ? 2 : 1) });
  // one getItem per save (the text check), and no JSON classification of the slot: no backup work at all
  assert.equal(reads - afterFirst, 20);
  assert.equal(raw(local, "backup:view:v5"), undefined);
});

// ---- scales:v1, the workspace cache --------------------------------------------------------------------------------

const ctxOf = (n, extra) => ({ key: "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n" + n + "m0", ctx: { workspace: "live", n }, records: [{ seq: n, ...(extra || {}) }] });

test("scales:v1 is a read-modify-write union: two writers sharing one stub keep each other's contexts, last writer wins per key", () => {
  const { win, local } = makeWindow();
  const a = load(win).state;
  const b = load(win).state; // another tab: its own state object over the same browser storage
  assert.deepEqual(plain(a.saveScales({ visualVersion: 2, contexts: [ctxOf(1, { by: "a" })] })), { ok: true, contexts: 1, skipped: 0 });
  assert.deepEqual(plain(b.saveScales({ visualVersion: 2, contexts: [ctxOf(2, { by: "b" })] })), { ok: true, contexts: 2, skipped: 0 });
  let stored = json(local, "scales:v1");
  assert.equal(stored.visualVersion, 2);
  assert.deepEqual(stored.contexts.map((c) => c.records[0].by), ["a", "b"], "the union: b did not know a's context and did not erase it");
  // a refits context 1 with a stale in-memory view of the world (it never saw b's write)
  a.saveScales({ visualVersion: 2, contexts: [ctxOf(1, { by: "a2" })] });
  stored = json(local, "scales:v1");
  assert.deepEqual(stored.contexts.map((c) => c.records[0].by), ["b", "a2"], "last writer wins for its own key; it is the most recently used and goes last");
  // the union also holds when both write the same key
  b.saveScales({ visualVersion: 2, contexts: [ctxOf(1, { by: "b3" })] });
  assert.deepEqual(json(local, "scales:v1").contexts.map((c) => c.records[0].by), ["b", "b3"]);
  assert.equal(a.scales().status, "ok");
  assert.equal(a.scales().value.contexts.length, 2);
  // the record is never given a generation or anything session-local by this module
  assert.deepEqual(Object.keys(stored).sort(), ["contexts", "visualVersion"]);
});

test("scales:v1 holds at most 64 contexts (the newest), skips the replay workspace and malformed entries, and refuses what is not a cache", () => {
  const { win, local } = makeWindow();
  const { state } = load(win);
  const many = Array.from({ length: 70 }, (_, i) => ctxOf(i));
  const r = state.saveScales({ visualVersion: 2, contexts: many });
  assert.deepEqual(plain(r), { ok: true, contexts: 64, skipped: 0 });
  const stored = json(local, "scales:v1").contexts;
  assert.equal(stored.length, 64);
  assert.equal(stored[0].key, many[6].key, "the oldest six went");
  assert.equal(stored[63].key, many[69].key);
  // a second tab adds one: the oldest of the union goes
  assert.equal(state.saveScales({ visualVersion: 2, contexts: [ctxOf(100)] }).contexts, 64);
  assert.equal(json(local, "scales:v1").contexts[0].key, many[7].key);
  // replay is tab memory and never reaches storage (S1-140): by key and by context
  const replay = { key: "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|replay|n4m0", ctx: { workspace: "replay" }, records: [] };
  const byCtx = { key: "x", ctx: { workspace: "replay" }, records: [] };
  const res = state.saveScales({ visualVersion: 2, contexts: [replay, byCtx, null, 5, { records: [] }, { key: "" }, ctxOf(200)] });
  assert.deepEqual(plain(res), { ok: true, contexts: 64, skipped: 6 });
  const keys = json(local, "scales:v1").contexts.map((c) => c.key);
  assert.ok(!keys.includes(replay.key) && !keys.includes("x"));
  assert.ok(keys.includes(ctxOf(200).key));
  for (const bad of [null, undefined, {}, { contexts: "no" }, [], "text"]) assert.equal(state.saveScales(bad).ok, false, JSON.stringify(bad));
  assert.equal(state.saveScales({}).reason, "not a calibration cache");
});

test("no storage-event following: state.js registers no listener, and a change by another tab never reaches the active snapshot", () => {
  assert.equal(/addEventListener|onstorage|storage["']/.test(SOURCE.replace(/\/\/[^\n]*/g, "")), false);
  const { win, local } = makeWindow();
  put(local, "view:v5", V5_LEGACY);
  const events = [];
  win.addEventListener = (...a) => events.push(a);
  const { state } = load(win);
  assert.equal(events.length, 0);
  // another tab saves a different last view: this tab's load-time snapshot is not rewritten by it
  put(local, "view:v5", V5_NEW);
  assert.deepEqual(plain(state.saved), V5_LEGACY);
  assert.equal(state.read("view:v5").value.prefs.sideOpen, false, "an explicit read sees the current text");
});

test("the one-time notice flag notice:v2: read as a status, written with visualVersion 2, failure returned", () => {
  const { win, local } = makeWindow();
  const { state } = load(win);
  assert.equal(state.notice().status, "absent");
  assert.deepEqual(plain(state.saveNotice({})), { ok: true });
  assert.deepEqual(json(local, "notice:v2"), { shown: true, visualVersion: 2 });
  const n = state.notice();
  assert.equal(n.status, "ok");
  assert.equal(n.value.shown, true);
  assert.deepEqual(plain(state.saveNotice({ atMs: 5 })), { ok: true });
  assert.deepEqual(json(local, "notice:v2"), { shown: true, atMs: 5, visualVersion: 2 });
  put(local, "notice:v2", { visualVersion: 3 });
  assert.equal(state.notice().status, "unknown-version");
  state.saveNotice({});
  assert.equal(raw(local, "backup:notice:v2"), JSON.stringify({ visualVersion: 3 }), "even this flag preserves a foreign payload");
});

// ---- DR-31: no cap on named views ------------------------------------------------------------------------------------

test("DR-31: there is no cap on named views: a stored list of 250 is read and rewritten intact; a failed write is a visible failure and loses nothing", () => {
  const { win, local } = makeWindow();
  const list = Array.from({ length: 250 }, (_, i) => ({ name: "view " + i, hash: "#w=24h&vis=2&ap=slate2-8f7890f7", visualVersion: 2, tA: 1, tB: 2, cut: 3, n: 4, m: 0, span: 1, lead: 0 }));
  put(local, "views:v1", list);
  const { state } = load(win);
  assert.equal(plain(state.views()).length, 250, "read in full");
  state.saveViews(state.views().concat([{ name: "view 250", visualVersion: 2, hash: "#w=24h&vis=2&ap=x" }]));
  assert.equal(json(local, "views:v1").length, 251, "a 251st is written: nothing refuses a new save or a list of any length");
  assert.equal(raw(local, "backup:views:v1"), undefined, "a readable list needs no backup");
  // the quota is the only limit, and it is reported by the write that hits it (the caller shows it), the stored list intact
  const before = raw(local, "views:v1");
  local.failWrite = (k, text) => (k === P + "views:v1" && text.length > before.length ? quota() : null);
  assert.throws(() => state.saveViews(json(local, "views:v1").concat([{ name: "one more", visualVersion: 2, hash: "#w=24h&vis=2&ap=x" }])), (e) => e.name === "QuotaExceededError");
  assert.equal(raw(local, "views:v1"), before, "the stored list is exactly as it was");
  assert.equal(/NAMED_VIEWS_MAX|named-views-limit|\b200\b/.test(SOURCE), false, "no cap constant exists in state.js");
});

test("state.js source: the existing members are untouched in meaning, nothing is executed from storage, nothing is evaluated", () => {
  const code = SOURCE.replace(/\/\/[^\n]*/g, "");
  for (const re of [/\beval\s*\(/, /\bnew\s+Function\b/, /\binnerHTML\b/, /\bdocument\b/, /Object\.assign\s*\(\s*(?:window|S)\b/])
    assert.equal(re.test(code), false, String(re));
  // the keys are the baseline's, plus scales:v1, notice:v2 and backup:<key>
  const keys = [...new Set([...code.matchAll(/"((?:view|views|history|scales|notice|backup)(?::[a-z0-9]+)+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(keys, ["backup:history:v1", "history:v1", "notice:v2", "scales:v1", "view:v4", "view:v5", "views:v1"].sort());
});
