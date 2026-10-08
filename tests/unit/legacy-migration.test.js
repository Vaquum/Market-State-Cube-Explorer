"use strict";
// U34 (T-migrate): E.codec.migrateLegacy and the rules around a legacy payload (API.md C.13, D9, A-43, DR-14;
// part 22-codec, with the words of part 04-text and the queue of part 21-notice).
//
// Oracles (none is the code under test):
//   - the migration table of maps/persistence.md 4.2, itself read off the baseline code: which legacy setting
//     meant what (`amount()` at the full-cell rate then rank; paleness by activity; log1p over the block's 99.5th
//     percentile; ... ) and which S1 definition replaced it. It is written below as a hand table of
//     setting -> E.text.migrate key, and the words are checked for the distinctive phrases of the OLD meaning
//     (taken from the baseline docs and code) and the NEW one (D2 and D3);
//   - the legacy fixtures tests/fixtures/legacy/* (hand-derived from the baseline grammar, never captured from
//     users): addresses, view:v4 and view:v5 payloads, views:v1 entries, history:v1;
//   - the rule of D9 in words: a legacy payload keeps its choices, gets Amount + Value + Explore, names what
//     changed, says old unsaved colours cannot be recovered, and is announced ONCE per payload digest per tab
//     (E.notice seen/mark), never rewritten by an open, never re-stamped with vis=2.
// What is page behaviour (the bare-root startup rule, a link skipping the stored view, opening a named view) is
// tested here at the level of its inputs: what classify, parseAddress, checkView and the storage adapter hand to
// it. The page itself is tested in the browser suite (B14, B15).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const E = require("../support/enc");

const C = E.codec;
const plain = (x) => JSON.parse(JSON.stringify(x));
const FIX = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/legacy", name), "utf8"));
const ADDR = FIX("addresses.json");
const ENV = { T0: 1609459200, BASE: 56.25, PR: 125, CUT: ADDR.env.CUT };
const AP = ADDR.env.appearance;
const DEFAULT_SCALE = { basis: "amount", pathBasis: "spans", transform: "value", curve: "log", rowsTransform: "value", cells: "explore", rows: "explore", local: false, window: null, lock: false };

const view = (patch) => C.checkView({ window: "24h", ...(patch || {}) }, ENV);

// ---- the table: every legacy setting whose interpretation changed ------------------------------------------------------

// [legacy choice, the E.text.migrate key that names it, a phrase of the OLD meaning, a phrase of the NEW one]
const MODES = [
  ["volume", "volume", /full-cell rate/, /Amount.*Value.*Explore/],
  ["trades", "trades", /same as Volume/, /Trade size is Value/],
  ["size", "size", /same as Volume/, /Trade size is Value/],
  ["flow", "flow", /25% and 75%/, /linear 0-100%/],
  ["flowtrades", "flow", /25% and 75%/, /no activity multiplier/],
  ["delta", "delta", /99\.5th percentile/, /pooled \(U, k\)/],
  ["cascade", "cascade", /paler by activity/, /without an activity term/],
  ["path", "path", /full-cell-time extrapolation/, /row spans/],
  ["dwell", "dwell", /ranked share/, /linear 0-100%/],
  ["geometry", "geometry", /green outline/, /neutral occupancy outline/],
];

test("migrateLegacy: every Cells mode names its change once, with the old and the new meaning (A-43)", () => {
  for (const [mode, key, oldPhrase, newPhrase] of MODES) {
    const v = view({ mode });
    const r = C.migrateLegacy(v);
    const hit = r.changes.filter((c) => c.setting === "mode=" + mode);
    assert.equal(hit.length, 1, mode);
    assert.equal(hit[0].key, key, mode);
    assert.equal(hit[0].text, E.text.migrate[key], "the words are the E.text.migrate string, not a copy");
    assert.match(hit[0].text, oldPhrase, mode + " says what it was");
    assert.match(hit[0].text, newPhrase, mode + " says what it is now");
    if (mode !== "trades" && mode !== "size") assert.match(hit[0].text, /\bwas\b.*\bnow\b/, mode + " names both");
  }
  // trades and size share one text as implemented (DR-41), and flow and flowtrades one
  assert.equal(E.text.migrate.trades, E.text.migrate.size);
});

test("migrateLegacy: Rows and the panes", () => {
  const cases = [
    ["rows", "volume", "rows", /square root of the share of the peak/, /Value over all measured rows/],
    ["rows", "delta", "rows", /square root of the share of the peak/, /Explore/],
    ["rows", "time", "rows", /square root of the share of the peak/, /Explore/],
    ["rows", "relvol", "relvol", /original formula.*unknown/, /rows.relvol@3/],
  ];
  for (const [param, value, key, oldPhrase, newPhrase] of cases) {
    const r = C.migrateLegacy(view({ rows: value }));
    const hit = r.changes.filter((c) => c.setting === param + "=" + value);
    assert.equal(hit.length, 1, value);
    assert.equal(hit[0].key, key);
    assert.match(hit[0].text, oldPhrase);
    assert.match(hit[0].text, newPhrase);
  }
  assert.deepEqual(plain(C.migrateLegacy(view({ rows: "off" })).changes.filter((c) => /^rows=/.test(c.setting))), [], "no Rows, nothing to name");
  // a pane that drew bars scaled to the bars in view is a registered Auto axis now; RSI was a fixed axis and is not named
  const panes = ["cells", "volume", "delta", "trades", "size", "efficiency", "choppiness", "perpath", "macd1d"];
  for (const pane of panes) {
    const hit = C.migrateLegacy(view({ pane })).changes.filter((c) => c.setting === "pane=" + pane);
    assert.ok(hit.some((c) => c.key === "pane"), pane);
    assert.match(E.text.migrate.pane, /every draw.*registered Auto axis/);
  }
  for (const pane of ["rsi1d", "rsi4h"]) assert.deepEqual(plain(C.migrateLegacy(view({ pane })).changes.filter((c) => /^pane=/.test(c.setting))), [], pane);
  const eff = C.migrateLegacy(view({ pane: "efficiency" })).changes.filter((c) => c.setting === "pane=efficiency");
  assert.deepEqual(plain(eff.map((c) => c.key)), ["pane", "efficiency"]);
  assert.match(eff[1].text, /0\.70 expected.*recorded model reference and its provenance/);
});

test("migrateLegacy: the notice lists EVERY setting whose interpretation changed, in a fixed order, and only those", () => {
  const v = view({ mode: "path", rows: "relvol", pane: "efficiency", period: "1y", lines: ["1d"], level: 500, follow: "coupled", tab: "evidence", horizon: 2 });
  const r = C.migrateLegacy(v);
  assert.deepEqual(plain(r.changes.map((c) => c.setting)), ["mode=path", "rows=relvol", "pane=efficiency", "pane=efficiency"], "mode, Rows, pane, efficiency");
  assert.deepEqual(plain(r.changes.map((c) => c.key)), ["path", "relvol", "pane", "efficiency"]);
  // the default view is Volume on the Cells pane: two things changed meaning, nothing else
  const d = C.migrateLegacy(view({}));
  assert.deepEqual(plain(d.changes.map((c) => c.setting)), ["mode=volume", "pane=cells"]);
  // the settings that kept their meaning are not named
  const kept = C.migrateLegacy(view({ period: "1y", lines: ["1d", "7d"], level: 500, follow: "coupled", marks: undefined, tab: "evidence", evidenceKind: "barrier", horizon: 4, barrier: 2, pane: "rsi1d" }));
  assert.deepEqual(plain(kept.changes.map((c) => c.setting)), ["mode=volume"]);
  // every key it can name exists in E.text.migrate, and every key of E.text.migrate is reachable
  const reached = new Set();
  for (const [, key] of MODES) reached.add(key);
  reached.add("rows").add("relvol").add("pane").add("efficiency");
  assert.deepEqual([...reached].sort(), Object.keys(E.text.migrate).sort());
  for (const key of reached) assert.equal(typeof E.text.migrate[key], "string", key);
});

// ---- what is kept, what is reset ---------------------------------------------------------------------------------------

test("a legacy view keeps every choice (w t p r f mode pane rows period level marks lines sel at replay tab outcome h dist) and gets Amount + Value + Explore", () => {
  for (const c of ADDR.cases.filter((x) => x.kind === "legacy")) {
    const parsed = C.parseAddress(c.hash, ENV);
    const before = JSON.stringify(parsed.view);
    const r = C.migrateLegacy(parsed.view);
    assert.equal(JSON.stringify(parsed.view), before, c.id + ": the input is not modified");
    for (const k of Object.keys(c.view)) assert.deepEqual(plain(r.view)[k], c.view[k], c.id + "." + k + " is kept");
    assert.deepEqual(plain(r.view.scale), DEFAULT_SCALE, c.id + ": Amount + Value + Explore (log, no window, no lock)");
    assert.equal(r.view.appearance, null, "the page applies its own appearance");
    assert.ok(r.changes.length >= 1, c.id);
    assert.ok(r.changes.every((x) => typeof x.text === "string" && x.text.length > 20 && typeof x.key === "string" && typeof x.setting === "string"));
  }
  assert.throws(() => C.migrateLegacy(null), (e) => e.name === "TypeError");
  assert.throws(() => C.migrateLegacy("#w=24h"), (e) => e.name === "TypeError");
  // a stale scale on the input (it cannot exist in a legacy view, but a caller's mistake must not leak) is reset
  assert.deepEqual(plain(C.migrateLegacy({ ...view({}), scale: { basis: "intensity", lock: true } }).view.scale), DEFAULT_SCALE);
});

test("the legacy fixtures: stored view:v4, view:v5, named views and history entries all go through the same validator and migration", () => {
  // view:v4: one object of prefs and raw view fields
  const v4 = FIX("view-v4.json");
  const fromV4 = C.checkView({ window: v4.window, tA: v4.tA, tB: v4.tB, pA: v4.pA, pB: v4.pB, auto: v4.auto !== false, n: v4.n, m: v4.m, follow: v4.diagonal ? "diagonal" : v4.coupled ? "coupled" : v4.refit === false ? "free" : "refit", mode: v4.mode, poc: v4.poc !== false, area: v4.area === true, untested: v4.untested === true, selection: v4.selection, anchor: v4.anchor, replay: v4.replay === true, tab: v4.tab, evidenceKind: v4.evidenceKind, horizon: v4.horizon, barrier: v4.barrier }, ENV);
  assert.equal(fromV4.window, "7d");
  assert.equal(fromV4.mode, "flow");
  assert.deepEqual(plain(C.migrateLegacy(fromV4).changes.map((c) => c.key)), ["flow", "pane"]);
  // view:v5: the view is an address, unversioned
  const v5 = FIX("view-v5.json");
  assert.equal(C.classify(v5).kind, "legacy");
  assert.equal(C.classify(v5.view).kind, "legacy");
  const p5 = C.parseAddress(v5.view, ENV);
  assert.equal(p5.kind, "legacy");
  assert.equal(p5.view.mode, "delta");
  assert.deepEqual(plain(C.migrateLegacy(p5.view).changes.map((c) => c.key)), ["delta", "pane"]);
  // named views: a bare array of entries without visualVersion; each entry's address is legacy
  const named = FIX("views-v1.json");
  assert.equal(C.classify(named).kind, "legacy");
  for (const entry of named) {
    assert.equal(C.classify(entry).kind, "legacy", entry.name);
    const p = C.parseAddress(entry.hash, ENV);
    assert.equal(p.kind, "legacy", entry.name);
    assert.ok(C.migrateLegacy(p.view).changes.length >= 2);
  }
  // history: navigation only; a known entry is never migrated, so nothing here names a change
  const hist = FIX("history-v1.json");
  assert.equal(C.classify(hist).kind, "legacy");
  for (const e of hist.entries) assert.equal(C.parseAddress(e.hash, ENV).kind, "legacy");
});

// ---- once per payload, per tab ---------------------------------------------------------------------------------------

test("the notice is once per payload digest per tab: E.codec.digest identifies the payload, E.notice seen/mark remembers it", { todo: E.notice ? false : "part 21-notice (package W1-F) is not in this build" }, () => {
  const a = "#w=24h&mode=delta";
  const b = "#w=24h&mode=trades";
  assert.match(C.digest(a), /^[0-9a-f]{16}$/);
  assert.equal(C.digest(a), C.digest(a));
  assert.notEqual(C.digest(a), C.digest(b));
  assert.equal(C.digest(""), "e3b0c44298fc1c14", "first 8 bytes of SHA-256 of the empty text (FIPS 180-4 test vector)");
  assert.equal(C.digest("abc"), "ba7816bf8f01cfea", "first 8 bytes of SHA-256('abc')");
  const clock = { t: 1000 };
  const n = E.notice.create({ now: () => clock.t });
  const open = (hash) => {
    const parsed = C.parseAddress(hash, ENV);
    if (parsed.kind !== "legacy") return null;
    const digest = C.digest(hash);
    if (n.seen(digest)) return null;
    n.mark(digest);
    const { changes } = C.migrateLegacy(parsed.view);
    return n.post({ code: "legacy-migrated", key: "legacy-migrated:" + digest, details: changes.map((c) => c.setting + ": " + c.text) });
  };
  const first = open(a);
  assert.ok(first);
  assert.equal(first.code, "legacy-migrated");
  assert.equal(first.level, "info");
  assert.equal(first.text, E.text.notice.legacy);
  assert.equal(first.details.length, 2);
  assert.equal(open(a), null, "the same payload in the same tab: no second notice");
  assert.equal(n.list().length, 1);
  const second = open(b);
  assert.ok(second, "a different payload is a new notice");
  assert.equal(n.list().length, 2);
  // a v2 address is never announced
  assert.equal(open("#w=24h&vis=2&ap=" + AP), null);
  // the words say what cannot be recovered
  assert.equal(E.text.notice.legacyUnsaved, "Colours from the old version cannot be recovered.");
  assert.match(E.text.notice.legacy, /visual version 2/);
});

// ---- ordinary saves, named views, history, bare root -------------------------------------------------------------------

function storage(seed) {
  const map = new Map(Object.entries(seed || {}));
  const writes = [];
  const area = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      writes.push(k);
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
  return { area, map, writes };
}
function loadState(win) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/state.js"), "utf8"), vm.createContext({ window: win, console: { warn() {} } }));
  return win.explorerState;
}
const P = "market-state-cube-explorer:";

test("opening a legacy named view migrates it in memory and writes nothing; the entry is stored as it was until a normal save", () => {
  const named = FIX("views-v1.json");
  const local = storage({ [P + "views:v1"]: JSON.stringify(named) });
  const state = loadState({ localStorage: local.area, sessionStorage: storage().area });
  const list = plain(state.views());
  const entry = list[0];
  const parsed = C.parseAddress(entry.hash, ENV);
  assert.equal(parsed.kind, "legacy");
  const migrated = C.migrateLegacy(parsed.view);
  assert.ok(migrated.changes.length);
  assert.deepEqual(local.writes, [], "opening wrote nothing");
  assert.equal(local.map.get(P + "views:v1"), JSON.stringify(named), "byte for byte the stored text");
  // deleting another view rewrites the list: the legacy entries are not re-stamped with a version they do not have
  state.saveViews(list.filter((e) => e.name !== "Flow"));
  const after = JSON.parse(local.map.get(P + "views:v1"));
  assert.deepEqual(after, named.filter((e) => e.name !== "Flow"));
  assert.ok(after.every((e) => !("visualVersion" in e)), "still legacy: nothing claimed v2 for them");
  // the normal save action writes the versioned entry, from the v2 address of the migrated view
  const v2 = C.formatAddress({ ...migrated.view, appearance: AP, scales: [], axes: [] }, ENV, { budget: true }).hash;
  assert.match(v2, /&vis=2&ap=slate2-8f7890f7/);
  state.saveViews(after.concat([{ name: "Morning range, version 2", visualVersion: 2, hash: v2 }]));
  const final = JSON.parse(local.map.get(P + "views:v1"));
  assert.equal(final.find((e) => e.name === "Morning range, version 2").visualVersion, 2);
  assert.equal(final.filter((e) => e.visualVersion === undefined).length, 2, "the two untouched legacy entries stay legacy");
});

test("legacy history:v1 entries serve Back and Forward only: their hashes are kept verbatim, no notice, no vis=2 stamped on an old address", () => {
  const hist = FIX("history-v1.json");
  const session = storage({ [P + "history:v1"]: JSON.stringify(hist) });
  const state = loadState({ localStorage: storage().area, sessionStorage: session.area });
  const got = plain(state.history());
  assert.deepEqual(got, hist);
  assert.equal(state.read("history:v1").status, "ok");
  assert.equal(C.classify(state.history()).kind, "legacy");
  state.saveHistory(got);
  const stored = JSON.parse(session.map.get(P + "history:v1"));
  assert.equal(stored.visualVersion, 2, "the envelope is this build's");
  assert.deepEqual(stored.entries, hist.entries, "each entry's address is exactly what it was: an old address is never re-stamped");
  for (const e of stored.entries) assert.equal(/vis=/.test(e.hash), false);
  // reading an old address for navigation is unchanged by S1: its place is what the baseline's place() gave
  assert.equal(C.parseAddress(hist.entries[1].hash, ENV).place, "w=7d");
  assert.equal(C.parseAddress("#w=30d&t=2026-09-24T00:00Z~2026-09-24T12:00Z&p=64000~66000&r=4,0&mode=delta", ENV).place, "w=30d&t=2026-09-24T00:00Z~2026-09-24T12:00Z&p=64000~66000&r=4,0");
});

test("the bare-root rule (DR-14) from its inputs: stored v2 restores silently, stored legacy restores with the legacy notice, nothing stored is the default with one neutral version notice", () => {
  const decide = (hash, seed) => {
    const local = storage(seed);
    const state = loadState({ localStorage: local.area, sessionStorage: storage().area });
    const link = C.parseAddress(hash, ENV);
    const stored = state.read("view:v5");
    if (link.kind !== "bare") return { path: "link", prefsOnly: true, storedViewApplied: false, kind: link.kind };
    if (stored.status === "ok") {
      const cls = C.classify(stored.value);
      const address = C.parseAddress(stored.value.view, ENV);
      if (cls.kind === "v2" && address.kind === "v2") return { path: "stored-v2", notice: null };
      if (cls.kind === "legacy" && address.kind === "legacy") return { path: "stored-legacy", notice: "legacy-migrated", changes: C.migrateLegacy(address.view).changes.length };
    }
    if (stored.status === "unknown-version") return { path: "preserve-and-default", notice: "import-rejected-or-version" };
    const flag = state.notice();
    return { path: "default", notice: flag.status === "absent" ? "version-default" : null };
  };
  const v2 = JSON.stringify({ version: 5, visualVersion: 2, prefs: {}, view: "#w=30d&vis=2&ap=slate2-8f7890f7&mode=delta" });
  const legacy = JSON.stringify({ version: 5, prefs: {}, view: "#w=30d&mode=delta" });
  assert.deepEqual(decide("", { [P + "view:v5"]: v2 }), { path: "stored-v2", notice: null });
  assert.equal(decide("#", { [P + "view:v5"]: legacy }).notice, "legacy-migrated");
  assert.equal(decide("", { [P + "view:v5"]: legacy }).changes, 2);
  assert.deepEqual(decide("", {}), { path: "default", notice: "version-default" });
  assert.deepEqual(decide("", { [P + "notice:v2"]: JSON.stringify({ shown: true, visualVersion: 2 }) }), { path: "default", notice: null }, "one-time: the flag says it was shown");
  assert.equal(decide("", { [P + "view:v5"]: JSON.stringify({ version: 5, visualVersion: 3 }) }).path, "preserve-and-default");
  // a link restores prefs only: the stored view is skipped whatever it is (no migration, no notice for it)
  assert.deepEqual(decide("#w=24h&vis=2&ap=slate2-8f7890f7", { [P + "view:v5"]: legacy }), { path: "link", prefsOnly: true, storedViewApplied: false, kind: "v2" });
  assert.equal(decide("#w=7d", { [P + "view:v5"]: v2 }).kind, "legacy");
  // #vis=2 alone names no place: it is a bare root, not a link
  assert.equal(decide("#vis=2", { [P + "view:v5"]: v2 }).path, "stored-v2");
  // the default view written after the first open is the v2 default
  assert.equal(C.formatAddress({ window: "24h", appearance: AP }, ENV, { budget: true }).hash, "#w=24h&vis=2&ap=slate2-8f7890f7");
});

test("a legacy code is migrated like a legacy address: classify names it, the decoded view goes through checkView and migrateLegacy", async () => {
  const codes = FIX("codes.json");
  const typical = codes.cases.find((c) => c.id === "typical");
  assert.equal(C.classify(typical.text).kind, "legacy");
  const d = await C.decodePortable(typical.text);
  assert.equal(d.kind, "legacy");
  const v = C.checkView({ window: "", tA: d.payload.view.viewport[0], tB: d.payload.view.viewport[1], pA: d.payload.view.viewport[2], pB: d.payload.view.viewport[3], auto: false, n: d.payload.query.tR, m: d.payload.query.pR, mode: d.payload.view.mode, pane: d.payload.view.pane, rows: d.payload.view.rows, period: d.payload.view.period, lines: d.payload.view.lines, poc: d.payload.view.poc, tab: d.payload.view.tab }, ENV);
  assert.equal(v.mode, "delta");
  assert.equal(v.n, 6);
  const m = C.migrateLegacy(v);
  assert.deepEqual(plain(m.changes.map((c) => c.key)), ["delta", "pane"]);
  assert.equal(C.digest(typical.text).length, 16, "the digest of the code text is the once-per-payload key");
  assert.equal(C.classify(codes.cases.find((c) => c.id === "bare-cube-query").text).kind, "query", "a bare cube query is not a view payload: no legacy notice");
});
