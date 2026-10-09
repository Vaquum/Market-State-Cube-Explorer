"use strict";
// U31 (T-codec, address half): E.codec.VISUAL_KEYS, formatAddress, parseAddress, checkView, classify,
// descriptorCount and the address limits (API.md B.15, C.13, DD-27, DD-92, DR-14; part 22-codec).
//
// Oracles (none is the code under test):
//   - the grammar of the baseline 8c82ca1 (maps/persistence.md 1.2) as hand-derived fixtures in
//     tests/fixtures/legacy/addresses.json: 2026-09-24T00:00Z is base column 3213312, 16 columns are 15
//     minutes, 125 USDT per row, so every expected column and row in this file is arithmetic done by hand;
//   - the canonical order and the one-letter values of B.15, written out as literal address strings;
//   - the example record of B.15 (`sc=c:e:G1204551.25,8830.5:delta.a.8.1.l.e:1790251320000,9312,3:ot_D8yL_NiaSousm`)
//     and the ids of Appendix A.2, which were computed by the design's own prototypes, not by this module;
//   - length arithmetic for the ladder: 257 float64 = 2056 bytes = 2742 base64url characters, so replacing
//     one rank body "q<2742 chars>" by "q~<16 chars>" saves exactly 2725 characters; the full URL is
//     baseLength + hash.length and the limit is 8192.
// The module may run in a vm context (ENCODING_PARTS_DIR): arrays are of another realm, so structures are
// compared through JSON and errors by name. Tests that need part 14-policy (package W1-E) are todo until
// the assembly gate.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");

const C = E.codec;
const plain = (x) => JSON.parse(JSON.stringify(x));
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/legacy/addresses.json"), "utf8"));
const ENV = { T0: 1609459200, BASE: 56.25, PR: 125, CUT: FIX.env.CUT };
const AP = FIX.env.appearance;
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;

// A view at its defaults, the way checkView returns one.
const base = (patch) => ({
  window: "24h", tA: NaN, tB: NaN, pA: NaN, pB: NaN, auto: true, n: null, m: null, selection: null, anchor: null, replay: false,
  follow: "refit", mode: "volume", pane: "cells", rows: "off", period: "90d", level: null, poc: false, area: false, untested: false,
  lines: [], tab: "context", evidenceKind: "poc", horizon: 1, barrier: 1, profileCmp: "independent", profileOpen: false,
  scale: { basis: "amount", pathBasis: "spans", transform: "value", curve: "log", rowsTransform: "value", cells: "explore", rows: "explore", local: false, window: null, lock: false },
  appearance: AP, scales: [], axes: [],
  ...(patch || {}),
});
const withScale = (patch, rest) => base({ scale: { ...base().scale, ...patch }, ...(rest || {}) });
const HEAD = "#w=24h&vis=2&ap=" + AP;

// A record the way the spine builds one from the store: the descriptor from E.scale, the context from E.context.
const cellsCtx = (measure, n, m, extra) => E.context.cellsKey({ measure, basis: "amount", transform: "value", curve: "log", n, m, ...(extra || {}) });
function record(channel, desc, ctx, extra) {
  return {
    channel, policy: channel === "l" ? "l" : "e", external: false, origin: "fit", desc, ctx, cohort: { n: 9312, excluded: 3 },
    obsEndMs: 1790251320000, cutMs: 1790251320000, canonicalThroughMs: null, token: null, ...(extra || {}),
  };
}
const valueDesc = (U, k, signed) => E.scale.manual({ kind: "value-log1p", signed: Boolean(signed), U, k }).descriptor;
function rankDesc(seed) {
  const values = [];
  for (let i = 0; i < 600; i++) values.push(1 + ((i * 7919 + seed) % 10007) + i * 13);
  return E.scale.fitRank(values).descriptor;
}
const rowsCtx = (measure, rowSize) => E.context.rowsKey({ measure, transform: measure === "delta" ? "value" : "rank", period: "roll:90", rowSize, quality: "exact" });

// ---- VISUAL_KEYS ------------------------------------------------------------------------------------------

// The fields of one address setting at a non-default value, and the text it is written as (B.15). One row per
// VISUAL_KEYS entry; the test below fails when an entry has no row or a row has no entry.
const SAMPLES = {
  follow: [{ follow: "coupled" }, "f=coupled"],
  mode: [{ mode: "path" }, "mode=path"],
  pane: [{ pane: "rsi4h" }, "pane=rsi4h"],
  rows: [{ rows: "time" }, "rows=time"],
  period: [{ period: "1y" }, "period=1y"],
  level: [{ level: 520.004 }, "level=65000.5"],
  marks: [{ poc: false, area: true, untested: false }, "marks=area"],
  lines: [{ lines: ["1d", "7d"] }, "lines=1d,7d"],
  tab: [{ tab: "evidence" }, "tab=continuations"],
  evidenceKind: [{ evidenceKind: "barrier" }, "outcome=barrier"],
  horizon: [{ horizon: 8 }, "h=8"],
  barrier: [{ barrier: 4 }, "dist=4"],
  "scale.basis": [{ scale: { basis: "intensity" } }, "bs=i"],
  "scale.pathBasis": [{ scale: { pathBasis: "usdt" } }, "pb=u"],
  "scale.transform": [{ scale: { transform: "rank" } }, "tr=r"],
  "scale.curve": [{ scale: { curve: "linear" } }, "cv=l"],
  "scale.rowsTransform": [{ scale: { rowsTransform: "rank" } }, "rt=r"],
  "scale.cells": [{ scale: { cells: "auto" } }, "cp=a"],
  "scale.rows": [{ scale: { rows: "auto" } }, "rp=a"],
  "scale.local": [{ scale: { local: true } }, "lc=1"],
  "scale.window": [{ mode: "flow", scale: { window: [0.25, 0.75] } }, "sw=0.25~0.75"],
  "scale.lock": [{ scale: { lock: true } }, "lk=1"],
  profileCmp: [{ profileCmp: "share" }, "pc=s"],
  profileOpen: [{ profileOpen: true }, "po=1"],
};
const DEFAULTS = {
  follow: { follow: "refit" }, mode: { mode: "volume" }, pane: { pane: "cells" }, rows: { rows: "off" }, period: { period: "90d" }, level: { level: null },
  marks: { poc: false, area: false, untested: false }, lines: { lines: [] }, tab: { tab: "context" }, evidenceKind: { evidenceKind: "poc" }, horizon: { horizon: 1 },
  barrier: { barrier: 1 }, "scale.basis": { "scale.basis": "amount" }, "scale.pathBasis": { "scale.pathBasis": "spans" }, "scale.transform": { "scale.transform": "value" },
  "scale.curve": { "scale.curve": "log" }, "scale.rowsTransform": { "scale.rowsTransform": "value" }, "scale.cells": { "scale.cells": "explore" },
  "scale.rows": { "scale.rows": "explore" }, "scale.local": { "scale.local": false }, "scale.window": { "scale.window": null }, "scale.lock": { "scale.lock": false },
  profileCmp: { profileCmp: "independent" }, profileOpen: { profileOpen: false },
};

test("VISUAL_KEYS is the single table: ids, params, fields, defaults; no visual key is a navigation key", () => {
  const keys = plain(C.VISUAL_KEYS);
  assert.equal(keys.length, 24, "12 legacy entries (marks folds poc, area and untested), 10 S1 settings and the 2 S2 profile settings");
  assert.deepEqual(keys.map((k) => k.id).sort(), Object.keys(SAMPLES).sort());
  assert.deepEqual(
    keys.map((k) => k.param),
    ["f", "mode", "pane", "rows", "period", "level", "marks", "lines", "tab", "outcome", "h", "dist", "bs", "pb", "tr", "cv", "rt", "cp", "rp", "lc", "sw", "lk", "pc", "po"],
    "canonical order of B.15 (sel, at and replay sit after lines and are navigation code)",
  );
  assert.equal(new Set(keys.map((k) => k.param)).size, keys.length, "no parameter twice");
  for (const nav of ["w", "t", "p", "r", "sel", "at", "replay"]) assert.ok(!keys.some((k) => k.param === nav), "visual key " + nav + " would become navigation");
  // The 19 legacy keys are these 12 plus the seven navigation ones (w t p r sel at replay).
  assert.equal(keys.filter((k) => k.legacy).length, 12);
  assert.equal(keys.filter((k) => k.legacy).length + 7, 19);
  for (const k of C.VISUAL_KEYS) {
    assert.ok(Object.isFrozen(k) && Object.isFrozen(k.fields) && Object.isFrozen(k.defaults), k.id + " is frozen");
    assert.equal(typeof k.read, "function");
    assert.equal(typeof k.check, "function");
    assert.equal(typeof k.write, "function");
    assert.deepEqual(plain(k.defaults), DEFAULTS[k.id], k.id + " default");
  }
  assert.ok(Object.isFrozen(C.VISUAL_KEYS));
  assert.deepEqual(plain(keys.find((k) => k.id === "marks").fields), ["poc", "area", "untested"]);
});

test("the exported constants of the limits: 8192 characters, 257 knots, 1 MiB, 16 descriptors", () => {
  assert.equal(E.LIMITS.ADDRESS_MAX, 8192);
  assert.equal(E.LIMITS.RANK_KNOTS, 257);
  assert.equal(E.LIMITS.PAYLOAD_MAX_BYTES, 1048576);
  assert.equal(E.LIMITS.DESCRIPTORS_MAX, 16);
});

test("the writer emits only [A-Za-z0-9_.:,;~!@-] in a value: anything else is refused where it is made; a selection that is not finite is dropped, not thrown", () => {
  for (const patch of [{ mode: "a&b" }, { mode: "a=b" }, { pane: "a b" }, { lines: ["x%20"] }, { period: "a+b" }]) assert.throws(() => C.formatAddress(base(patch), ENV), isError("TypeError"), JSON.stringify(patch));
  const r = C.formatAddress(base({ selection: [1, NaN, 3, 4], anchor: Infinity, replay: true }), ENV);
  assert.equal(r.hash, HEAD);
  assert.deepEqual(plain(r.dropped.map((d) => d.key).sort()), ["at", "sel"]);
  const lockedNoLevel = C.formatAddress(base({ auto: false, n: null, m: null }), ENV);
  assert.equal(lockedNoLevel.hash, HEAD);
  assert.deepEqual(plain(lockedNoLevel.dropped.map((d) => d.key)), ["r"]);
  // every address the writer makes matches the alphabet of B.15 outside its structure
  const all = C.formatAddress(withScale({ window: [0.25, 0.75] }, { mode: "flow", level: 520.004, lines: ["vwap:2026-09-01", "1d"], period: "2026-09-01" }), ENV).hash;
  assert.match(all, /^#[A-Za-z0-9_.:,;~!@=&-]+$/);
  assert.equal(all.includes("%") || all.includes("+"), false);
});

// ---- formatAddress: what is written ------------------------------------------------------------------------

test("a default view is #w=24h&vis=2&ap=<id>: vis and ap are always written, every other default is omitted", () => {
  const r = C.formatAddress(base(), ENV, { budget: true });
  assert.equal(r.hash, "#w=24h&vis=2&ap=slate2-8f7890f7");
  assert.equal(r.level, 0);
  assert.deepEqual(plain(r.dropped), []);
  assert.throws(() => C.formatAddress(base({ appearance: undefined }), ENV), isError("TypeError"), "ap= is always written, so the appearance is required");
  assert.throws(() => C.formatAddress(base({ appearance: "not an id" }), ENV), isError("TypeError"));
});

test("each VISUAL_KEYS entry at a non-default value is written alone behind vis and ap, and read back to the same fields", () => {
  for (const id of Object.keys(SAMPLES)) {
    const [patch, text] = SAMPLES[id];
    const state = patch.scale ? withScale(patch.scale, patch.mode ? { mode: patch.mode } : {}) : base(patch);
    const expected = "#w=24h&vis=2&ap=" + AP + (patch.mode && id === "scale.window" ? "&mode=flow" : "") + "&" + text;
    // mode=flow comes first in canonical order, then the window key
    const hash = C.formatAddress(state, ENV, { budget: true }).hash;
    assert.equal(hash, id === "scale.window" ? "#w=24h&vis=2&ap=" + AP + "&mode=flow&sw=0.25~0.75" : expected, id);
    const parsed = C.parseAddress(hash, ENV);
    assert.equal(parsed.kind, "v2", id);
    assert.deepEqual(plain(parsed.dropped), [], id);
    const want = patch.scale ? withScale(patch.scale, patch.mode ? { mode: patch.mode } : {}) : base(patch);
    for (const field of ["follow", "mode", "pane", "rows", "period", "level", "poc", "area", "untested", "lines", "tab", "evidenceKind", "horizon", "barrier"])
      assert.deepEqual(plain({ v: parsed.view[field] }), plain({ v: want[field] }), id + "." + field);
    assert.deepEqual(plain(parsed.view.scale), plain(want.scale), id + ".scale");
    assert.equal(parsed.view.appearance, AP);
  }
});

test("the canonical order: w|t,p; r; vis; ap; f mode pane rows period level marks lines sel at replay tab outcome h dist; bs pb tr cv rt cp rp lc sw lk; sc", () => {
  const state = withScale(
    { basis: "intensity", pathBasis: "usdt", transform: "rank", curve: "linear", rowsTransform: "rank", cells: "auto", rows: "auto", local: true, window: [0.25, 0.75], lock: true },
    {
      window: "", tA: 3213312, tB: 3214080, pA: 512, pB: 528, auto: false, n: 6, m: 0, follow: "coupled", mode: "flow", pane: "volume", rows: "volume", period: "1y", level: 520.004,
      poc: false, area: true, lines: ["1d", "7d"], selection: [3213840, 3213984, 516, 520], anchor: 3214000, replay: true, tab: "evidence", evidenceKind: "barrier", horizon: 2, barrier: 2,
      scales: [record("c", valueDesc(1204551.25, 8830.5, true), cellsCtx("delta", 8, 1))],
    },
  );
  assert.equal(
    C.formatAddress(state, ENV).hash,
    "#t=2026-09-24T00:00Z~2026-09-24T12:00Z&p=64000~66000&r=6,0&vis=2&ap=" + AP +
      "&f=coupled&mode=flow&pane=volume&rows=volume&period=1y&level=65000.5&marks=area&lines=1d,7d" +
      "&sel=2026-09-24T08:15Z~2026-09-24T10:30Z,64500~65000&at=2026-09-24T10:45Z&replay=1&tab=continuations&outcome=barrier&h=2&dist=2" +
      "&bs=i&pb=u&tr=r&cv=l&rt=r&cp=a&rp=a&lc=1&sw=0.25~0.75&lk=1" +
      "&sc=c:e:G1204551.25,8830.5:delta.a.8.1.l.e:1790251320000,9312,3:ot_D8yL_NiaSousm",
  );
});

test("times: an address time is UTC ISO with seconds and milliseconds only when set (the baseline's stamp)", () => {
  // base 3213312 is 2026-09-24T00:00Z; +1 column is 56.25 s
  const at = (b) => C.formatAddress(base({ window: "", tA: b, tB: b + 100000, pA: 512, pB: 528 }), ENV).hash.match(/t=([^~&]+)~/)[1];
  assert.equal(at(3213312), "2026-09-24T00:00Z");
  assert.equal(at(3213312 + 16), "2026-09-24T00:15Z");
  assert.equal(at(3213312 + 1), "2026-09-24T00:00:56.250Z");
  assert.equal(at(3213312 + 8), "2026-09-24T00:07:30Z");
  assert.equal(at(3213312 + 2), "2026-09-24T00:01:52.500Z");
});

test("the settings window sw: a Taker flow window must be symmetric about 0.5 and narrower than 0..1; Dwell takes any window", () => {
  const w = (mode, win) => C.formatAddress(withScale({ window: win }, { mode }), ENV);
  assert.equal(w("flow", [0.25, 0.75]).hash, "#w=24h&vis=2&ap=" + AP + "&mode=flow&sw=0.25~0.75");
  assert.equal(w("dwell", [0.2, 0.6]).hash, "#w=24h&vis=2&ap=" + AP + "&mode=dwell&sw=0.2~0.6");
  // a raw preference the current measure cannot read is not written (the reader would refuse it), and the drop is listed
  const bad = w("flow", [0.2, 0.6]);
  assert.equal(bad.hash, "#w=24h&vis=2&ap=" + AP + "&mode=flow");
  assert.deepEqual(plain(bad.dropped.map((d) => d.key)), ["sw"]);
  const read = (mode, win) => C.parseAddress("#w=24h&vis=2&ap=" + AP + "&mode=" + mode + "&sw=" + win, ENV);
  assert.deepEqual(plain(read("flowtrades", "0.4~0.6").view.scale.window), [0.4, 0.6]);
  const asym = read("flow", "0.2~0.6");
  assert.equal(asym.view.scale.window, null);
  assert.deepEqual(plain(asym.dropped.map((d) => d.key)), ["sw"]);
  assert.match(asym.dropped[0].reason, /symmetric about 0\.5/);
  assert.equal(read("flow", "0~1").view.scale.window, null, "not narrower than 0..1");
  assert.deepEqual(plain(read("dwell", "0.2~0.6").view.scale.window), [0.2, 0.6]);
  assert.equal(read("dwell", "0.6~0.2").view.scale.window, null, "lo < hi");
  assert.equal(read("dwell", "abc").view.scale.window, null);
});

// ---- the legacy grammar: every key, default and non-default -------------------------------------------------

test("the legacy fixtures: each of the 19 keys, at its default and away from it, parses to the hand-derived view", () => {
  assert.ok(FIX.cases.length >= 35);
  const keysSeen = new Set();
  for (const c of FIX.cases) {
    const parsed = C.parseAddress(c.hash, ENV);
    assert.equal(parsed.kind, c.kind, c.id + " kind");
    if (c.view === null) {
      assert.equal(parsed.view, null, c.id);
    } else {
      const got = plain(parsed.view);
      for (const k of Object.keys(c.view)) assert.deepEqual(got[k], c.view[k], c.id + "." + k);
      // what a legacy view gets for what it never had
      assert.deepEqual(got.scale, plain(base().scale), c.id + " scale defaults");
      assert.equal(parsed.appearance, null, c.id + " has no appearance");
      assert.equal(parsed.version, null);
    }
    assert.deepEqual([...new Set(parsed.dropped.map((d) => d.key))].sort(), [...c.dropped].sort(), c.id + " dropped");
    for (const part of c.hash.replace(/^#/, "").split("&")) keysSeen.add(part.split("=")[0]);
  }
  for (const k of ["w", "t", "p", "r", "f", "mode", "pane", "rows", "period", "level", "marks", "lines", "sel", "at", "replay", "tab", "outcome", "h", "dist"])
    assert.ok(keysSeen.has(k), "no fixture uses " + k);
});

test("format(parse(legacy)) writes the view again under vis=2 in canonical order (the legacy choices survive)", () => {
  for (const c of FIX.cases.filter((x) => x.v2 !== null)) {
    const parsed = C.parseAddress(c.hash, ENV);
    const back = C.formatAddress({ ...parsed.view, appearance: AP, scales: [], axes: [] }, ENV, { budget: true });
    assert.equal(back.hash, c.v2, c.id);
    // and the v2 address reads back to the same view
    const again = C.parseAddress(back.hash, ENV);
    assert.equal(again.kind, "v2", c.id);
    assert.deepEqual(plain({ ...again.view, scale: undefined, appearance: undefined }), plain({ ...parsed.view, scale: undefined, appearance: undefined }), c.id + " round trip");
    assert.deepEqual(plain(again.dropped), [], c.id + " v2 address has nothing to drop");
  }
});

test("a legacy address never claims v2: S1 keys and sc are ignored and listed, and the place is stamped only on new writes", () => {
  const p = C.parseAddress("#w=24h&bs=i&lk=1&ap=" + AP + "&sc=c:e:z:x:-:x", ENV);
  assert.equal(p.kind, "legacy");
  assert.deepEqual(plain(p.view.scale), plain(base().scale));
  assert.deepEqual(plain(p.dropped.map((d) => d.key).sort()), ["ap", "bs", "lk", "sc"]);
  assert.ok(p.dropped.every((d) => /needs vis=2/.test(d.reason)));
});

// ---- classification --------------------------------------------------------------------------------------

test("classification: vis absent + place = legacy, vis=2 = v2, vis=3 / vis= / vis=2.1 / garbage = reject with the version seen, no place = bare", () => {
  const table = [
    ["#w=24h", "legacy", null],
    ["#t=2026-09-24T00:00Z~2026-09-24T12:00Z&p=64000~66000", "legacy", null],
    ["#w=24h&vis=2&ap=" + AP, "v2", 2],
    ["#w=24h&vis=3", "reject", "3"],
    ["#w=24h&vis=", "reject", ""],
    ["#w=24h&vis=2.1", "reject", "2.1"],
    ["#w=24h&vis=abc", "reject", "abc"],
    ["#w=24h&vis=%32", "v2", 2],
    ["#vis=3", "reject", "3"],
    ["#vis=2", "bare", null],
    ["#mode=delta", "bare", null],
    ["#w=bogus", "bare", null],
    ["", "bare", null],
    ["#", "bare", null],
  ];
  for (const [text, kind, version] of table) {
    const p = C.parseAddress(text, ENV);
    assert.equal(p.kind, kind, text);
    if (kind === "reject") {
      assert.equal(p.version, version, text);
      assert.equal(p.view, null, "a rejected address applies nothing: " + text);
      assert.ok(p.reasons.length >= 1 && p.reasons[0].includes("visual version"), text);
    } else if (kind === "v2") assert.equal(p.version, 2);
    // classify agrees with parse wherever it can see the text alone (a percent-escaped digit is decoded by parse only)
    if (!text.includes("%")) {
      const c = C.classify(text);
      assert.equal(c.kind, kind, "classify " + text);
      if (kind === "reject") {
        assert.equal(c.version, version);
        assert.ok(c.reason);
      }
    }
  }
  assert.equal(C.parseAddress("#w=24h&vis=%E0%A4%A", ENV).kind, "reject", "a malformed version marker is not a silent default");
});

test("classify of stored payloads: visualVersion 2 = v2, absent and non-empty = legacy, unknown versions or non-integers = reject, empty = bare", () => {
  assert.deepEqual(plain(C.classify({ version: 5, visualVersion: 2, prefs: {} })), { kind: "v2", version: 2 });
  assert.equal(C.classify({ version: 5, prefs: {}, view: "#w=24h" }).kind, "legacy");
  assert.equal(C.classify([{ name: "x" }]).kind, "legacy");
  assert.equal(C.classify([]).kind, "bare");
  assert.equal(C.classify({}).kind, "bare");
  assert.equal(C.classify(null).kind, "bare");
  assert.equal(C.classify(undefined).kind, "bare");
  assert.deepEqual(plain(C.classify({ visualVersion: 3 })), { kind: "v3", version: 3 });
  for (const v of [4, 2.1, "2", 1, 0, null, -2, 99]) {
    const c = C.classify({ visualVersion: v });
    assert.equal(c.kind, "reject", JSON.stringify(v));
    assert.equal(c.version, v);
    assert.ok(c.reason);
  }
  // codes
  assert.equal(C.classify("origo-cube:2.H4sI").kind, "v2");
  assert.equal(C.classify("origo-cube:2j.%7B%7D").kind, "v2");
  assert.equal(C.classify("origo-cube:%7B%22query%22").kind, "legacy");
  assert.equal(C.classify("origo-cube:{}").kind, "legacy");
  const newer = C.classify("origo-cube:4.abc");
  assert.equal(newer.kind, "reject");
  assert.equal(newer.version, "4");
  assert.match(newer.reason, /newer or unknown version/);
  assert.equal(C.classify("origo-cube:zzz").kind, "reject");
  assert.equal(C.classify('{"t1":1,"t2":2,"p1":1,"p2":2,"tR":1,"pR":0}').kind, "query", "a bare cube query is not a view payload");
  assert.equal(C.classify('{"query":{},"view":{}}').kind, "legacy");
  assert.equal(C.classify('{"visualVersion":2}').kind, "v2");
  assert.equal(C.classify('{"visualVersion":3}').kind, "v3");
  assert.equal(C.classify("{not json").kind, "reject");
});

// ---- tolerance --------------------------------------------------------------------------------------------

test("tolerance (A-23): unknown keys, malformed escapes and duplicates never stop a readable view; everything dropped is listed with a reason", () => {
  const p = C.parseAddress("#w=24h&vis=2&ap=" + AP + "&mode=delta&foo=1&mode=trades&lines=%zz&bar", ENV);
  assert.equal(p.kind, "v2");
  assert.equal(p.view.mode, "trades", "the last duplicate wins");
  assert.deepEqual(plain(p.dropped.map((d) => [d.key, d.reason])), [["lines", "malformed percent escape"], ["foo", "unknown key"]]);
  assert.equal(p.place, "w=24h", "place() is the navigation params in address order");
  const both = C.parseAddress("#r=6,0&w=24h&vis=2&ap=" + AP + "&mode=delta&replay=1&t=x", ENV);
  assert.equal(both.place, "r=6,0&w=24h&replay=1&t=x");
});

test("the page decides what it can show: live-only modes, panes, rows, periods and lines are dropped and listed, never guessed", () => {
  const env = {
    ...ENV,
    modes: () => ["volume", "flow", "delta"],
    panes: () => ["cells", "volume"],
    rowsChoices: () => ["off", "volume"],
    validPeriod: (k) => k === "90d" || k === "30d",
    normalizeLines: (list) => list.filter((k) => k !== "vwap:2026-09-01"),
  };
  const p = C.parseAddress("#w=24h&vis=2&ap=" + AP + "&mode=path&pane=macd1d&rows=time&period=1y&lines=1d,vwap:2026-09-01", env);
  assert.equal(p.view.mode, "volume");
  assert.equal(p.view.pane, "cells");
  assert.equal(p.view.rows, "off");
  assert.equal(p.view.period, "90d");
  assert.deepEqual(plain(p.view.lines), ["1d"]);
  assert.deepEqual(plain(p.dropped.map((d) => d.key).sort()), ["lines", "mode", "pane", "period", "rows"]);
  assert.equal(C.parseAddress("#w=24h&mode=delta&period=30d", env).dropped.length, 0, "what the page offers is kept");
});

// ---- checkView -----------------------------------------------------------------------------------------------

test("checkView is the baseline's validator behind an env: windows, rectangles, levels, selection, anchor, replay, enumerations", () => {
  const ok = (raw) => C.checkView(raw, ENV);
  const w = { window: "24h" };
  assert.equal(ok({ window: "1" }).window, "24h", "legacy window 1");
  assert.equal(ok({ window: "7" }).window, "7d", "legacy window 7");
  assert.equal(ok({ window: "zzz" }), null, "no window and no rectangle");
  assert.equal(ok({ window: "", tA: 10, tB: 20, pA: 1, pB: 2 }).tB, 20);
  assert.equal(ok({ window: "", tA: 20, tB: 10, pA: 1, pB: 2 }), null, "tB > tA");
  assert.equal(ok({ window: "", tA: 10, tB: 20, pA: 2, pB: 2 }), null, "pB > pA");
  assert.equal(ok({ window: "", tA: 10, tB: 20, pA: -1, pB: 2 }), null, "pA >= 0");
  assert.equal(ok({ window: "", tA: FIX.env.CUT, tB: FIX.env.CUT + 9, pA: 1, pB: 2 }), null, "tA < CUT");
  assert.equal(ok({ ...w, auto: true, n: 6, m: 0 }).n, null, "an automatic level carries no n");
  const locked = ok({ ...w, auto: false, n: 99.4, m: 99 });
  assert.equal(locked.auto, false);
  assert.equal(locked.n, 20);
  assert.equal(locked.m, 9);
  assert.equal(ok({ ...w, auto: false, n: NaN, m: 1 }).auto, true, "an unreadable level is automatic");
  assert.equal(ok({ ...w, anchor: 0 }).anchor, null);
  assert.equal(ok({ ...w, anchor: FIX.env.CUT + 1 }).anchor, null);
  assert.equal(ok({ ...w, anchor: 100, replay: true }).replay, true);
  assert.equal(ok({ ...w, anchor: null, replay: true }).replay, false, "a replay needs its anchor");
  assert.deepEqual(plain(ok({ ...w, selection: [3214000, 9999999, 1, 2] }).selection), [3214000, 3214083, 1, 2], "the end is clamped to ceil(CUT)");
  assert.equal(ok({ ...w, selection: [3214000, 3214010, 2, 1] }).selection, null);
  assert.equal(ok({ ...w, selection: [1, 2, 3] }).selection, null);
  assert.equal(ok({ ...w, horizon: 3 }).horizon, 1);
  assert.equal(ok({ ...w, horizon: 8 }).horizon, 8);
  assert.equal(ok({ ...w, barrier: 4 }).barrier, 4);
  assert.equal(ok({ ...w, follow: "x" }).follow, "refit");
  assert.equal(ok({ ...w, tab: "x" }).tab, "context");
  assert.equal(ok({ ...w, evidenceKind: "x" }).evidenceKind, "poc");
  assert.equal(ok({ ...w, poc: false }).poc, false);
  assert.equal(ok({ ...w, area: 1 }).area, false, "only true is true");
  assert.equal(ok({ ...w, level: -3 }).level, null);
  assert.equal(ok({ ...w, level: 500 }).level, 500);
  assert.equal(ok({ ...w, mode: "density" }).mode, "volume", "the retired density mode");
  assert.deepEqual(plain(ok({ ...w }).scale), plain(base().scale), "a view without S1 settings gets the defaults");
  assert.equal(ok({ ...w, appearance: "slate2-8f7890f7" }).appearance, AP);
  assert.equal(ok({ ...w, appearance: "<script>" }).appearance, null);
  assert.equal(ok(null), null);
  assert.equal(ok("#w=24h"), null);
});

test("checkView uses the page's own predicates from env and validates the nested settings", () => {
  const seen = [];
  const env = {
    ...ENV,
    windowKey: (k) => (k === "special" ? "special" : ""),
    modes: () => ["volume", "delta"],
    panes: ["cells"],
    validPeriod: (k) => { seen.push(k); return k === "7d"; },
    normalizeLines: (l) => { seen.push("lines"); return l.slice(0, 1); },
    N_MAX: 5,
    M_MAX: 2,
  };
  const v = C.checkView({ window: "special", mode: "flow", pane: "volume", period: "7d", lines: ["a", "b"], auto: false, n: 9, m: 9 }, env);
  assert.equal(v.window, "special");
  assert.equal(v.mode, "volume");
  assert.equal(v.pane, "cells");
  assert.equal(v.period, "7d");
  assert.deepEqual(plain(v.lines), ["a"]);
  assert.equal(v.n, 5);
  assert.equal(v.m, 2);
  assert.deepEqual(seen, ["7d", "lines"]);
  assert.equal(C.checkView({ window: "24h" }, env), null, "this page's windowKey does not know 24h");
  const s = C.checkView({ window: "special", mode: "flow", scale: { basis: "intensity", transform: "bogus", curve: "linear", local: true, lock: "yes", window: [0.2, 0.9] } }, { ...env, modes: () => ["flow"] });
  assert.equal(s.scale.basis, "intensity");
  assert.equal(s.scale.transform, "value", "a value outside its enumeration reads as the default");
  assert.equal(s.scale.curve, "linear");
  assert.equal(s.scale.local, true);
  assert.equal(s.scale.lock, false, "only true is true");
  assert.equal(s.scale.window, null, "an asymmetric Taker flow window");
  const d = C.checkView({ window: "special", mode: "dwell", scale: { window: [0.2, 0.9] } }, { ...env, modes: () => ["dwell"] });
  assert.deepEqual(plain(d.scale.window), [0.2, 0.9]);
});

// ---- sc: descriptors in the address ---------------------------------------------------------------------------

const EXAMPLE = "c:e:G1204551.25,8830.5:delta.a.8.1.l.e:1790251320000,9312,3:ot_D8yL_NiaSousm";

test("the B.15 example record is written and read exactly, and its context is rebuilt from the page's tables", () => {
  const r = C.formatAddress(base({ scales: [record("c", valueDesc(1204551.25, 8830.5, true), cellsCtx("delta", 8, 1))] }), ENV);
  assert.equal(r.hash, HEAD + "&sc=" + EXAMPLE);
  const p = C.parseAddress(r.hash, ENV);
  assert.deepEqual(plain(p.dropped), []);
  assert.equal(p.scales.length, 1);
  const rec = p.scales[0];
  assert.equal(rec.channel, "c");
  assert.equal(rec.policy, "e");
  assert.equal(rec.origin, "fit");
  assert.equal(rec.external, false);
  assert.equal(rec.desc.id, "ot_D8yL_NiaSousm", "Appendix A.2: the id of {U:1204551.25,k:8830.5} signed");
  assert.deepEqual(plain(rec.desc.params), { U: 1204551.25, k: 8830.5 });
  assert.equal(rec.desc.signed, true);
  assert.equal(E.context.keyString(rec.ctx), "cells|BTC/USDT|delta|amount|usdt|value-log|cells.delta.amount@1|exact|live|n8m1");
  assert.deepEqual(plain(rec.cohort), { n: 9312, excluded: 3 });
  assert.equal(rec.obsEndMs, 1790251320000);
  assert.equal(rec.cutMs, null, "cutMs is not in an address (DD-92)");
  assert.equal(rec.token, null);
  assert.ok(Object.isFrozen(rec.desc), "a restored descriptor is frozen like every descriptor of E.scale");
});

test("every body letter of B.15 round trips: g G n N q f d z Z and the policy flags ! and m", () => {
  const cases = [
    ["g", valueDesc(26791234.56, 48211.3, false), cellsCtx("volume", 4, 0), "3s_XdONgi8CSqyOl", "g26791234.56,48211.3"],
    ["G", valueDesc(1204551.25, 8830.5, true), cellsCtx("delta", 8, 1), "ot_D8yL_NiaSousm", "G1204551.25,8830.5"],
    ["n", E.scale.manual({ kind: "value-linear", signed: false, U: 5000 }).descriptor, cellsCtx("trades", 3, 0, { curve: "linear", transform: "value" }), null, "n5000"],
    ["N", E.scale.manual({ kind: "value-linear", signed: true, U: 75.5 }).descriptor, cellsCtx("delta", 3, 0, { curve: "linear", transform: "value" }), null, "N75.5"],
    ["f", E.scale.manual({ kind: "fixed-linear", signed: false, lo: 0.2, hi: 0.8 }).descriptor, cellsCtx("dwell", 4, 0), null, "f0.2,0.8"],
    ["z", E.scale.zeroOnly(false), cellsCtx("volume", 4, 0), "C5LleVNGDTk1DpfK", "z"],
    ["Z", E.scale.zeroOnly(true), cellsCtx("delta", 4, 0), null, "Z"],
  ];
  for (const [letter, desc, ctx, id, body] of cases) {
    if (id) assert.equal(desc.id, id, "Appendix A.2 id for " + letter);
    const rec = record("c", desc, ctx);
    const hash = C.formatAddress(base({ scales: [rec] }), ENV).hash;
    assert.match(hash, new RegExp("&sc=c:e:" + body.replace(/[.,]/g, "\\$&") + ":"), letter);
    const p = C.parseAddress(hash, ENV);
    assert.deepEqual(plain(p.dropped), [], letter);
    assert.equal(p.scales[0].desc.id, desc.id, letter);
    assert.deepEqual(plain(p.scales[0].desc.params), plain(desc.params), letter);
    assert.equal(p.scales[0].desc.signed, desc.signed);
  }
  // flags: ! is an external comparison override, m a manual origin, k a Comparison-lock hold
  const held = record("c", valueDesc(1204551.25, 8830.5, true), cellsCtx("delta", 8, 1), { policy: "k", external: true, origin: "manual" });
  const hash = C.formatAddress(base({ scales: [held] }), ENV).hash;
  assert.ok(hash.includes("sc=c:k!m:G1204551.25"), hash);
  const p = C.parseAddress(hash, ENV).scales[0];
  assert.equal(p.policy, "k");
  assert.equal(p.external, true);
  assert.equal(p.origin, "manual");
  assert.equal(p.desc.algorithm, "manual@1", "provenance follows the origin");
});

test("an axis record carries its frozen domain: a.<id>:x:d<lo>,<hi>:-:<through>:<id>; the id of the B.12 example is reproduced", () => {
  const r = C.formatAddress(base({ axes: [{ id: "pane.volume", domain: [0, 1920000000], policy: "frozen", through: 1790251320000 }, { id: "pane.delta", domain: [-5, 5], policy: "auto", through: null }] }), ENV);
  // the auto axis is the default and is not written; a.pane.volume reproduces the mappingId of API.md B.12
  assert.equal(r.hash, HEAD + "&sc=a.pane.volume:x:d0,1920000000:-:1790251320000,0,0:fAie68jq2OF1287z");
  const p = C.parseAddress(r.hash, ENV);
  assert.deepEqual(plain(p.dropped), []);
  assert.deepEqual(plain(p.axes), [{ id: "pane.volume", domain: [0, 1920000000], policy: "frozen", through: 1790251320000, mappingId: "fAie68jq2OF1287z" }]);
  assert.equal(p.scales.length, 0);
  assert.equal(p.sc.length, 1);
  // a signed-symmetric domain is a signed axis mapping; zero-width and non-finite domains cannot be frozen
  const sym = C.formatAddress(base({ axes: [{ id: "pane.macd1d", domain: [-2.5, 2.5], policy: "frozen", through: null }] }), ENV);
  assert.match(sym.hash, /sc=a\.pane\.macd1d:x:d-2\.5,2\.5:-:-:/);
  assert.equal(C.parseAddress(sym.hash, ENV).axes[0].domain[0], -2.5);
  const flat = C.formatAddress(base({ axes: [{ id: "pane.volume", domain: [0, 0], policy: "frozen", through: null }] }), ENV);
  assert.equal(flat.hash, HEAD);
  assert.match(flat.dropped[0].reason, /lo < hi/);
});

test("a rank record carries 257 float64 knots: 2056 bytes are 2742 characters, bit exact; ids-only is q~<id>", () => {
  const rk = rankDesc(3);
  assert.equal(rk.params.knots.length, 257);
  const rec = record("c", rk, cellsCtx("volume", 4, 0, { transform: "rank" }));
  const hash = C.formatAddress(base({ scales: [rec] }), ENV).hash;
  const body = /sc=c:e:q([A-Za-z0-9_-]+):/.exec(hash)[1];
  assert.equal(body.length, 2742);
  assert.equal(Math.ceil((257 * 8 * 4) / 3), 2742, "257 doubles = 2056 bytes = 2742 base64url characters");
  const p = C.parseAddress(hash, ENV);
  assert.deepEqual(plain(p.dropped), []);
  assert.equal(p.scales[0].desc.id, rk.id);
  assert.equal(p.scales[0].desc.params.knots.length, 257);
  for (let i = 0; i < 257; i++) assert.ok(Object.is(p.scales[0].desc.params.knots[i], rk.params.knots[i]), "knot " + i + " is bit exact");
  assert.equal(E.context.keyString(p.scales[0].ctx), "cells|BTC/USDT|volume|amount|usdt|rank|cells.volume.amount@1|exact|live|n4m0");
});

test("Rows and lens records: the context is rebuilt with its period identity; the lens is the Cells context at the lens level", () => {
  const rowsRec = record("r", valueDesc(9000000, 120000, false), E.context.rowsKey({ measure: "volume", transform: "value-log", period: "cal:mo:2026-09-01", rowSize: 3, quality: "approx-rows:8" }));
  const lensRec = record("l", valueDesc(4000, 80, false), E.context.cellsKey({ measure: "volume", basis: "amount", transform: "value-log", n: 8, m: 1, lens: { bounds: [10, 20, 30, 40], n: 5, m: 0 } }));
  const r = C.formatAddress(base({ scales: [lensRec, rowsRec] }), ENV);
  // channel order in an address is c, r, l whatever the order the state lists them in
  const recs = r.hash.split("&sc=")[1].split(";");
  assert.ok(recs[0].startsWith("r:e:g9000000,120000:volume.cal-mo-2026-09-01.3.ar8.l:"), recs[0]);
  assert.ok(recs[1].startsWith("l:l:g4000,80:volume.a.5.0.l.e:"), recs[1]);
  const p = C.parseAddress(r.hash, ENV);
  assert.deepEqual(plain(p.dropped), []);
  assert.equal(E.context.keyString(p.scales[0].ctx), "rows|BTC/USDT|volume|period-amount-per-row|usdt|value-log|rows.volume.amount@1|approx-rows:8|live|cal:mo:2026-09-01|m3");
  assert.equal(E.context.keyString(p.scales[1].ctx), "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n5m0", "the lens bounds are not persisted");
  for (const period of ["roll:90", "day:2026-09-01", "all:2021-01-01"]) {
    const x = record("r", valueDesc(1000, 10, false), E.context.rowsKey({ measure: "volume", transform: "value-log", period, rowSize: 0, quality: "exact" }));
    const back = C.parseAddress(C.formatAddress(base({ scales: [x] }), ENV).hash, ENV);
    assert.equal(back.scales[0].ctx.period, period);
  }
  // the zero-only transform is not in the body: the settings of the same address decide (a gap in the B.15 grammar, see cdcCtxTransform)
  const zero = C.formatAddress(withScale({ curve: "linear" }, { scales: [record("c", E.scale.zeroOnly(false), cellsCtx("volume", 4, 0, { curve: "linear" }))] }), ENV).hash;
  assert.equal(C.parseAddress(zero, ENV).scales[0].ctx.transform, "value-linear");
});

test("a bad sc keeps every setting and drops only the records that fail, each with its reason (A-23)", () => {
  const good = EXAMPLE;
  const flip = "c:e:G1204551.25,8830.5:delta.a.8.1.l.e:1790251320000,9312,3:ot_D8yL_NiaSousX";
  const cases = [
    [flip, /hash mismatch/],
    ["c:e:G1204551.25,8830.5:delta.a.8.1.l.e:1790251320000,9312,3", /six fields/],
    ["q:e:G1:x:-:x", /unknown channel/],
    ["c:z:G1204551.25,8830.5:delta.a.8.1.l.e:1790251320000,9312,3:ot_D8yL_NiaSousm", /unknown policy/],
    ["c:e:G-1,2:delta.a.8.1.l.e:-:ot_D8yL_NiaSousm", /invalid descriptor|log1p body/],
    ["c:e:G10,20:delta.a.8.1.l.e:-:ot_D8yL_NiaSousm", /invalid descriptor: k must not exceed U/],
    ["c:e:Gabc,2:delta.a.8.1.l.e:-:ot_D8yL_NiaSousm", /log1p body is U,k/],
    ["c:e:g1204551.25,8830.5:delta.a.8.1.l.e:-:" + E.scale.id(valueDesc(1204551.25, 8830.5, false)), /signedness does not match the measure/],
    ["c:e:G1204551.25,8830.5:delta.a.8.1.l.ar8:-:ot_D8yL_NiaSousm", /context is not valid/],
    ["c:e:G1204551.25,8830.5:delta.a.99.1.l.e:-:ot_D8yL_NiaSousm", /beyond this page's levels/],
    ["c:e:G1204551.25,8830.5:nosuch.a.8.1.l.e:-:ot_D8yL_NiaSousm", /basis code does not belong|context is not valid/],
    ["c:e:G1204551.25,8830.5:delta.a.8.1.l.e:12,x,3:ot_D8yL_NiaSousm", /calibration segment/],
    ["c:e:z:delta.a.8.1.l.e:-:C5LleVNGDTk1DpfK", /signedness does not match the measure/],
    ["c:e:qAAAA:volume.a.4.0.l.e:-:C5LleVNGDTk1DpfK", /rank knots/],
    ["a.pane.volume:e:d0,10:-:-:fAie68jq2OF1287z", /axis record is frozen/],
    ["a.pane.volume:x:g1,1:-:-:fAie68jq2OF1287z", /axis record carries a domain/],
    ["c:x:d0,10:-:-:fAie68jq2OF1287z", /x is for an axis record/],
    ["l:e:g4000,80:volume.a.5.0.l.e:-:xxxxxxxxxxxxxxxx", /lens carries Local contrast/],
  ];
  for (const [bad, why] of cases) {
    const p = C.parseAddress(HEAD + "&mode=delta&bs=i&sc=" + bad + ";" + good, ENV);
    assert.equal(p.kind, "v2", bad);
    assert.equal(p.view.mode, "delta", "settings stay: " + bad);
    assert.equal(p.view.scale.basis, "intensity", "settings stay: " + bad);
    assert.equal(p.scales.length, 1, "the good record stays: " + bad);
    const drops = p.dropped.filter((d) => d.key === "sc");
    assert.equal(drops.length, 1, bad);
    assert.equal(drops[0].index, 0);
    assert.match(drops[0].reason, why, bad);
  }
  // every record bad: nothing restored, settings intact
  const none = C.parseAddress(HEAD + "&mode=delta&sc=" + flip, ENV);
  assert.equal(none.scales.length, 0);
  assert.equal(none.view.mode, "delta");
});

test("16 active scales are accepted and 17 rejected, on write AND read; 21 frozen axes and 22 likewise", () => {
  const many = (count) => {
    const list = [];
    for (let i = 0; i < count; i++) list.push(record("c", valueDesc(1000 + i, 10 + i, false), cellsCtx("volume", i % 16, Math.floor(i / 16))));
    return list;
  };
  const w16 = C.formatAddress(base({ scales: many(16) }), ENV);
  assert.equal(w16.level, 0);
  assert.equal(C.parseAddress(w16.hash, ENV).scales.length, 16);
  assert.equal(C.descriptorCount(base({ scales: many(16) })), 16);
  assert.equal(C.descriptorCount(base({ scales: many(17) })), 17);
  assert.equal(C.descriptorCount({}), 0);
  assert.equal(C.descriptorCount(null), 0);
  assert.throws(() => C.formatAddress(base({ scales: many(17) }), ENV), isError("LimitError"));
  // read: a hand-made address with 17 records keeps the settings and uses none of them, and says why
  const records = w16.hash.split("&sc=")[1].split(";");
  const extra = "c:e:g1017,27:volume.a.0.1.l.e:-:" + E.scale.id(valueDesc(1017, 27, false));
  const p17 = C.parseAddress(w16.hash + ";" + extra, ENV);
  assert.equal(p17.scales.length, 0);
  assert.equal(p17.view.window, "24h");
  assert.match(p17.dropped.find((d) => d.key === "sc").reason, /more than 16 active scales/);
  assert.equal(records.length, 16);
  const axes = (count) => Array.from({ length: count }, (_, i) => ({ id: "pane.a" + i, domain: [0, 10 + i], policy: "frozen", through: null }));
  const a21 = C.formatAddress(base({ axes: axes(21) }), ENV);
  assert.equal(C.parseAddress(a21.hash, ENV).axes.length, 21);
  assert.throws(() => C.formatAddress(base({ axes: axes(22) }), ENV), isError("LimitError"));
  const p22 = C.parseAddress(a21.hash + ";a.pane.a21:x:d0,30:-:-:" + E.scale.id({ v: 1, kind: "axis-linear", signed: false, params: { lo: 0, hi: 30 }, clip: "axis@1" }), ENV);
  assert.equal(p22.axes.length, 0);
  assert.match(p22.dropped.find((d) => d.key === "sc").reason, /21 frozen axes/);
});

test("DD-92: an Auto descriptor whose cutMs advances leaves the address byte-identical (sc carries obsEndMs, nCohort, nExcluded only)", () => {
  const d = valueDesc(1204551.25, 8830.5, true);
  const at = (cutMs, extra) => C.formatAddress(base({ scales: [record("c", d, cellsCtx("delta", 8, 1), { policy: "a", cutMs, ...(extra || {}) })] }), ENV, { budget: true }).hash;
  const first = at(1790251320000);
  assert.equal(at(1790251380000), first, "a live advance of one minute");
  assert.equal(at(1790251320000 + 86400000), first, "a day");
  assert.equal(at(null), first);
  assert.equal(at(1790251320000, { fittedAtMs: 5, token: "abcd1234", canonicalThroughMs: 1790208000000 }), first, "fittedAt, token and canonicalThrough stay out too");
  assert.notEqual(at(1790251320000, { obsEndMs: 1790251380000 }), first, "a refit on newer data IS a different record");
  assert.equal(first.includes("cutMs"), false);
});

// ---- the degrade ladder ------------------------------------------------------------------------------------

function ladderState() {
  return base({
    scales: [
      record("c", rankDesc(1), cellsCtx("volume", 4, 0, { transform: "rank" })),
      record("r", rankDesc(2), rowsCtx("volume", 3)),
      record("l", rankDesc(3), cellsCtx("volume", 5, 0, { transform: "rank" }), { policy: "l" }),
    ],
  });
}

test("the ladder at 8191, 8192 and 8193 characters, counted against the FULL URL (origin + path + hash)", () => {
  const two = base({ scales: ladderState().scales.slice(0, 2) });
  const full = C.formatAddress(two, ENV).hash.length; // level 0 without a budget
  assert.ok(full > 5500 && full < 6500, "two rank records are about 5.8k characters: " + full);
  const at = (total) => C.formatAddress(two, { ...ENV, baseLength: total - full }, { budget: true });
  const r8191 = at(8191);
  const r8192 = at(8192);
  const r8193 = at(8193);
  assert.equal(r8191.level, 0);
  assert.equal(r8192.level, 0, "exactly 8192 characters fit");
  assert.equal(r8193.level, 1, "8193 do not");
  assert.equal(r8192.hash.length + (8192 - full), 8192);
  assert.deepEqual(plain(r8192.dropped), []);
  assert.equal(r8193.hash.length, full - 2725, "one rank body (1 + 2742 characters) became q~ + a 16-character id (2 + 16)");
  assert.deepEqual(plain(r8193.dropped.map((d) => d.channel)), ["r"], "Rows first: the lens is absent, Cells comes last");
  assert.match(r8193.dropped[0].reason, /not exact/);
  // deterministic: the same state and budget give the same string
  assert.equal(C.formatAddress(two, { ...ENV, baseLength: 8193 - full }, { budget: true }).hash, r8193.hash);
  // without a budget nothing is shortened
  assert.equal(C.formatAddress(two, { ...ENV, baseLength: 100000 }).level, 0);
});

test("the ladder: L0 full records, L1 rank knots replaced by ids (lens, Rows, Cells), L2 settings only, L3 refuse; never truncating", () => {
  const state = ladderState();
  const full = C.formatAddress(state, ENV).hash.length;
  const fits = (n) => ({ ...ENV, baseLength: 8192 - n });
  // the order of replacement is lens, then Rows, then Cells, one record at a time, stopping as soon as it fits
  const l1 = C.formatAddress(state, fits(full - 2725), { budget: true });
  assert.equal(l1.level, 1);
  assert.deepEqual(plain(l1.dropped.map((d) => d.channel)), ["l"]);
  assert.match(l1.hash, /l:l:q~[A-Za-z0-9_-]{16}:volume\.a\.5\.0\.l\.e:[^;]*:[A-Za-z0-9_-]{16}/);
  assert.equal(l1.hash.length, full - 2725);
  const l1b = C.formatAddress(state, fits(full - 2725 - 1), { budget: true });
  assert.deepEqual(plain(l1b.dropped.map((d) => d.channel)), ["l", "r"]);
  assert.equal(l1b.hash.length, full - 2 * 2725);
  const l1c = C.formatAddress(state, fits(full - 2 * 2725 - 1), { budget: true });
  assert.deepEqual(plain(l1c.dropped.map((d) => d.channel)), ["l", "r", "c"]);
  assert.equal(l1c.level, 1);
  assert.equal(l1c.hash.length, full - 3 * 2725);
  // a reference-only record reads back as its id, marked as not exact
  const back = C.parseAddress(l1c.hash, ENV);
  assert.deepEqual(plain(back.dropped), []);
  assert.equal(back.scales.length, 3);
  for (const s of back.scales) {
    assert.equal(s.desc, null);
    assert.match(s.mappingId, /^[A-Za-z0-9_-]{16}$/);
  }
  assert.equal(back.scales.find((s) => s.channel === "c").mappingId, state.scales[0].desc.id);
  // L2: still too long with ids only: settings-only, nothing truncated
  const settings = C.formatAddress(state, { ...ENV, baseLength: 0 }, { budget: true });
  assert.equal(settings.level, 1, "at baseLength 0 two ids-only rank records and one full one fit");
  const l2 = C.formatAddress(state, fits(HEAD.length + 1), { budget: true });
  assert.equal(l2.level, 2);
  assert.equal(l2.hash, HEAD);
  assert.ok(l2.dropped.every((d) => /settings-only URL, not exact calibration/.test(d.reason)));
  assert.equal(l2.dropped.length, 3);
  // L3: even the settings do not fit: refuse, the caller keeps the address it has
  const l3 = C.formatAddress(state, fits(HEAD.length - 1), { budget: true });
  assert.equal(l3.level, 3);
  assert.equal(l3.hash, null);
  // every line above is a level the UI can name
  assert.equal(E.text.address.level.exact, "Address: exact");
  assert.equal(E.text.address.level.ids, "Address: scale IDs only, not exact");
  assert.equal(E.text.address.level.settings, "Settings-only URL, not exact calibration");
  assert.ok(E.text.address.level.refused);
});

test("the address limit is enforced on READ too: a longer address is rejected, counted against the full URL", () => {
  const long = "#w=24h&vis=2&ap=" + AP + "&lines=" + "a".repeat(8192);
  const r = C.parseAddress(long, ENV);
  assert.equal(r.kind, "reject");
  assert.match(r.reasons[0], /longer than 8192/);
  const fill = (n) => HEAD + "&lines=" + "a".repeat(n - HEAD.length - "&lines=".length);
  const exact = fill(8191); // 8191 + "#" = 8192 characters behind an empty base
  assert.equal(C.parseAddress(exact, ENV).kind, "v2");
  assert.equal(C.parseAddress(exact, { ...ENV, baseLength: 1 }).kind, "v2", "base + # + hash = 8193 is over");
});

// ---- part 14-policy contract (todo until W1-E lands) --------------------------------------------------------

test("the settings the address carries are the persisted subset of E.policy (DEFAULTS and persisted/restore agree with VISUAL_KEYS)", { todo: E.policy ? false : "part 14-policy (package W1-E) is not in this build; this must turn green at the assembly gate" }, () => {
  const defaults = plain(E.policy.DEFAULTS);
  for (const name of Object.keys(base().scale)) assert.deepEqual(defaults[name], plain(base().scale)[name], "default of " + name);
  // persisted(scale) is raw preferences; what it names is what the address writes
  const scale = { ...plain(E.policy.DEFAULTS), basis: "intensity", curve: "linear", lock: true };
  const persisted = plain(E.policy.persisted(scale));
  const address = C.formatAddress(withScale({ basis: "intensity", curve: "linear", lock: true }), ENV).hash;
  assert.equal(address, "#w=24h&vis=2&ap=" + AP + "&bs=i&cv=l&lk=1");
  for (const name of ["basis", "curve", "lock"]) assert.deepEqual(persisted[name], scale[name], name);
  // restore takes the envelope of API.md C.13: {scale, records, axes, replay}.
  const restored = plain(E.policy.restore({ scale: persisted }));
  assert.deepEqual(restored.dropped, []);
  assert.equal(restored.scale.basis, "intensity");
});
