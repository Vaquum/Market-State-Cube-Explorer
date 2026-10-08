"use strict";
// Independent records and real UTF-8 byte counts exercise the tab-only boundary and retention policy.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const SOURCE = fs.readFileSync(path.join(__dirname, "../../src/state.js"), "utf8");
const KEY = "market-state-cube-explorer:comparison:v2:BTC/USDT", CAP = 4 * 1024 * 1024;
class Storage {
  constructor(copy) { this.map = new Map(copy?.map); this.writes = []; this.readError = null; this.writeError = null; this.removeError = null; }
  getItem(key) { if (this.readError) throw this.readError; return this.map.get(key) ?? null; }
  setItem(key, text) { if (this.writeError) throw this.writeError; this.map.set(key, String(text)); this.writes.push({ key, text: String(text) }); }
  removeItem(key) { if (this.removeError) throw this.removeError; this.map.delete(key); }
}
const failure = (name) => Object.assign(new Error("blocked"), { name });
function load(local = new Storage(), session = new Storage(), blocked = false) {
  const window = { localStorage: local, sessionStorage: session };
  if (blocked) Object.defineProperty(window, "sessionStorage", { get() { throw failure("SecurityError"); } });
  vm.runInNewContext(SOURCE, { window, console: { warn() {} } });
  return { state: window.explorerState, comparison: window.explorerState.comparison, local, session };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const capture = (row = 0) => ({
  contextOrigin: "legacy-structural", context: { supports: {}, histories: [], originatingObservation: null }, originatingObservation: null,
  id: "cell-" + row, instrument: "BTC/USDT", level: { n: 0, m: 0 }, origin: 1000, c: 0, r: row,
  nominal: { t0: 1000000, t1: 1060000, low: row * 125, high: (row + 1) * 125 },
  observed: { t0: 1000000, t1: 1030000, low: row * 125, high: (row + 1) * 125, seconds: 30, width: 125 },
  capturedAt: 2000000, measuredThrough: 1030000, source: "pack-1", completeness: "unfinished · portion",
  metrics: {
    volume: { tag: "finite", value: 10, formula: "cells.volume.amount@1", unit: "usdt", supportEnd: 1030000, knownThrough: 1030000, numerator: 10, denominator: null },
    size: { tag: "undefined", value: null, formula: "cells.size.mean@1", unit: "usdt/trade", supportEnd: 1030000, knownThrough: 1030000, denominator: "trades" },
  },
  detail: [{ label: "Original row volume", value: 150, unit: "USDT", tag: "finite", supportEnd: 1900000, knownThrough: 1900000 }],
  when: { knownAtMs: null, knownAtReason: "column is unfinished", eventStartMs: 1000000, eventEndMs: 1030000 },
  shortExposure: false, originalScale: "Explore",
});
const record = (count = 1) => ({
  comparisonVersion: 2, selectedMetric: "volume", instrument: "BTC/USDT", captures: Array.from({ length: count }, (_, row) => capture(row)),
  focus: count ? "cell-0" : null, reference: null, basis: "auto", sort: { key: "time", direction: "asc" },
  view: "grid", page: 0, poc: null, expanded: false, restoreLayout: null,
});
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test("comparison keeps its full schema in a dedicated session slot, independent of visualVersion", () => {
  const a = load(); assert.equal(a.comparison.read("BTC/USDT").status, "absent");
  const expected = record(); assert.equal(a.comparison.validate(expected).ok, true);
  assert.equal(a.comparison.write("BTC/USDT", expected).ok, true);
  assert.deepEqual(plain(load(a.local, a.session).comparison.read("BTC/USDT").value), expected);
  assert.deepEqual([...a.session.map.keys()], [KEY]); assert.equal(a.local.map.size, 0);
  const foreign = { ...expected, visualVersion: 99 };
  assert.equal(a.comparison.validate(foreign).ok, false, "visual-version metadata is not comparison schema");
});
test("captured partial and independently supported diagnostics are retained exactly", () => {
  const a = load(), expected = record();
  expected.captures[0].metrics.volume.supportEnd = 1060000;
  expected.captures[0].metrics.volume.knownThrough = 1080000;
  expected.captures[0].metrics.size.supportEnd = null;
  expected.captures[0].metrics.size.knownThrough = null;
  assert.equal(a.comparison.write("BTC/USDT", expected).ok, true);
  assert.deepEqual(plain(a.comparison.read("BTC/USDT").value), expected, "support can exceed clipped observation; null finality is preserved");
});
test("the whole record rejects duplicate identities, dangling settings and inconsistent support", () => {
  const a = load();
  const invalid = [
    (v) => { v.captures.push({ ...capture(), id: "other-id" }); },
    (v) => { v.captures.push(capture()); },
    (v) => { v.focus = "missing"; },
    (v) => { v.reference = "missing"; },
    (v) => { v.sort.key = "cascade"; },
    (v) => { v.sort.direction = "down"; },
    (v) => { v.page = 1; },
    (v) => { v.basis = "automatic"; },
    (v) => { v.view = "other"; },
    (v) => { v.expanded = true; },
    (v) => { v.captures[0].observed.t1 = 1070000; },
    (v) => { v.captures[0].observed.seconds = -1; },
    (v) => { v.captures[0].observed.seconds = 10; },
    (v) => { v.captures[0].observed.width = 100; },
    (v) => { v.captures[0].observed.width = 126; },
    (v) => { v.captures[0].metrics.volume.knownThrough = 1020000; },
    (v) => { v.captures[0].metrics.volume.supportEnd = 1060001; },
    (v) => { v.captures[0].metrics.volume.value = Infinity; },
    (v) => { v.captures[0].metrics.size.value = 0; },
    (v) => { v.captures[0].metrics.volume.tag = "complete"; },
    (v) => { v.captures[0].metrics.volume.profile = [1, 2]; },
    (v) => { v.captures[0].detail[0].value = [1, 2]; },
    (v) => { v.captures[0].instrument = "ETH/USDT"; },
    (v) => { v.captures[0].level.n = -1; },
  ];
  for (const corrupt of invalid) {
    const value = record(); corrupt(value);
    assert.equal(a.comparison.validate(value).ok, false, corrupt.toString());
    assert.equal(a.comparison.write("BTC/USDT", value).ok, false);
  }
  assert.equal(a.session.writes.length, 0);
});
test("frozen POC and expanded restoration layout round-trip with the same session", () => {
  const a = load(), value = record();
  value.expanded = true; value.restoreLayout = { sideOpen: true, sideWidth: 312, drawerHeight: 260, drawerOpen: true, drawer: "compare" };
  value.poc = { id: "90d", label: "90 days", period: "90d", price: 70062.5, rowSize: 125, approximate: true, supportEnd: 1900000, knownThrough: 1900000, from: 100000, through: 1900000, source: "pack-1" };
  assert.equal(a.comparison.write("BTC/USDT", value).ok, true); assert.deepEqual(plain(a.comparison.read("BTC/USDT").value), value);
  value.poc.supportEnd = 1800000; assert.equal(a.comparison.validate(value).ok, false);
});
test("32 and 128 captures have no count cap and reload all off-page facts", () => {
  const a = load();
  for (const count of [32, 128]) {
    const value = record(count); value.page = Math.ceil(count / 24) - 1;
    assert.equal(a.comparison.write("BTC/USDT", value).ok, true); assert.equal(a.comparison.read("BTC/USDT").value.captures.length, count);
  }
});
test("corrupt and newer text remain verbatim; Retry cannot replace them without discard", () => {
  for (const raw of ["{broken", JSON.stringify({ ...record(), comparisonVersion: 3 }), JSON.stringify({ ...record(), focus: "missing" })]) {
    const a = load(); a.session.map.set(KEY, raw);
    const read = a.comparison.read("BTC/USDT"); assert.equal(read.value, null); assert.equal(read.raw, raw);
    assert.equal(a.comparison.write("BTC/USDT", record()).status, "retained"); assert.equal(a.session.getItem(KEY), raw);
    assert.equal(a.comparison.write("BTC/USDT", record(2)).status, "retained", "manual retry is not implicit discard");
    assert.equal(a.comparison.discard("BTC/USDT").ok, true); assert.equal(a.comparison.write("BTC/USDT", record(2)).ok, true);
  }
});
test("rejected raw latches until explicit discard even if the slot is later removed", () => {
  const a = load(); a.session.map.set(KEY, "bad"); a.comparison.read("BTC/USDT"); a.session.removeItem(KEY);
  assert.equal(a.comparison.write("BTC/USDT", record()).status, "retained");
  a.comparison.discard("BTC/USDT"); assert.equal(a.comparison.write("BTC/USDT", record()).ok, true);
});
test("UTF-8 cap accepts exactly 4 MiB and refuses the next byte before changing stored work", () => {
  const a = load(), value = record(), emptyBytes = Buffer.byteLength(JSON.stringify(value));
  value.captures[0].source += "x".repeat(CAP - emptyBytes);
  const serialized = a.comparison.serialize(value); assert.equal(serialized.ok, true); assert.equal(serialized.bytes, CAP); assert.equal(Buffer.byteLength(serialized.raw), CAP);
  assert.equal(a.comparison.write("BTC/USDT", serialized).ok, true); const before = a.session.getItem(KEY), writes = a.session.writes.length;
  value.captures[0].source += "x";
  assert.equal(a.comparison.serialize(value).status, "oversized"); assert.equal(a.comparison.write("BTC/USDT", value).status, "oversized");
  assert.equal(a.session.getItem(KEY), before); assert.equal(a.session.writes.length, writes);
});
test("an empty collection enforces the whole-record UTF-8 cap on POC metadata", () => {
  for (const text of ["x", "€😀"]) {
    const a = load(), value = record(0);
    value.poc = { id: "90d", label: "90 days", period: "90d", price: 70062.5, rowSize: 125, approximate: true, supportEnd: 1900000, knownThrough: 1900000, from: 100000, through: 1900000, source: "pack-1" };
    const remaining = CAP - Buffer.byteLength(JSON.stringify(value)), unitBytes = Buffer.byteLength(text);
    value.poc.label += text.repeat(Math.floor(remaining / unitBytes)) + "x".repeat(remaining % unitBytes);
    assert.equal(Buffer.byteLength(JSON.stringify(value)), CAP, "the independent byte count reaches the exact boundary");
    const measured = a.comparison.measure(value), serialized = a.comparison.serialize(value);
    assert.equal(measured.ok, true); assert.equal(measured.bytes, CAP); assert.equal(measured.raw, undefined);
    assert.equal(serialized.ok, true); assert.equal(serialized.bytes, CAP); assert.equal(Buffer.byteLength(serialized.raw), CAP);
    assert.equal(a.comparison.write("BTC/USDT", value).ok, true);
    const before = a.session.getItem(KEY), writes = a.session.writes.length;
    assert.deepEqual(plain(a.comparison.read("BTC/USDT").value), value, "an empty collection at the boundary reloads");
    value.poc.label += "x";
    assert.equal(a.comparison.validate(value).ok, true, "valid metadata remains governed by the whole-record byte cap");
    assert.equal(a.comparison.measure(value).status, "oversized");
    assert.equal(a.comparison.serialize(value).status, "oversized");
    assert.equal(a.comparison.write("BTC/USDT", value).status, "oversized");
    assert.equal(a.session.getItem(KEY), before); assert.equal(a.session.writes.length, writes);
    if (text !== "x") assert.ok(JSON.stringify(value).length < CAP, "multibyte metadata exceeds the cap before its string length does");
  }
});
test("multi-byte and surrogate text use actual UTF-8 size, not string length", () => {
  const a = load(), value = record(); value.captures[0].source = "€😀\ud800";
  const serialized = a.comparison.serialize(value);
  assert.equal(serialized.bytes, Buffer.byteLength(serialized.raw));
  value.captures[0].source = "€".repeat(Math.floor(CAP / 3));
  assert.ok(JSON.stringify(value).length < CAP); assert.equal(a.comparison.serialize(value).status, "oversized");
});
test("oversized stored raw is retained and never JSON-parsed", () => {
  const a = load(), raw = "[" + "😀".repeat(CAP / 4) + "]";
  a.session.map.set(KEY, raw); const read = a.comparison.read("BTC/USDT");
  assert.equal(read.status, "oversized", "invalid JSON still takes the preparse size branch"); assert.equal(read.value, null); assert.equal(read.raw, raw);
  assert.equal(a.comparison.write("BTC/USDT", record()).status, "retained"); assert.equal(a.session.getItem(KEY), raw);
});
test("quota failure keeps the last stored record; Retry saves the latest running state", () => {
  const a = load(); a.comparison.write("BTC/USDT", record()); const raw = a.session.getItem(KEY);
  a.session.writeError = failure("QuotaExceededError"); const working = record(2);
  assert.equal(a.comparison.write("BTC/USDT", working).status, "unsaved"); assert.equal(a.session.getItem(KEY), raw); assert.equal(working.captures.length, 2);
  working.focus = "cell-1"; a.session.writeError = null;
  assert.equal(a.comparison.write("BTC/USDT", working).ok, true); assert.equal(a.comparison.read("BTC/USDT").value.focus, "cell-1");
});
test("blocked getters/read/remove return explicit failures and do not destroy rejected text", () => {
  const blocked = load(undefined, undefined, true);
  assert.equal(blocked.comparison.read("BTC/USDT").status, "unreadable"); assert.equal(blocked.comparison.write("BTC/USDT", record()).status, "unsaved");
  const a = load(); a.session.map.set(KEY, "bad"); a.comparison.read("BTC/USDT"); a.session.removeError = failure("SecurityError");
  assert.equal(a.comparison.discard("BTC/USDT").status, "unsaved"); assert.equal(a.session.getItem(KEY), "bad");
  a.session.removeError = null; assert.equal(a.comparison.write("BTC/USDT", record()).status, "retained");
});
test("duplicated tabs initially copy captures then save independently; fresh tabs are absent", () => {
  const a = load(); a.comparison.write("BTC/USDT", record());
  const b = load(a.local, new Storage(a.session)); assert.deepEqual(plain(b.comparison.read("BTC/USDT").value), record());
  b.comparison.write("BTC/USDT", record(2)); a.comparison.write("BTC/USDT", record(3));
  assert.equal(a.comparison.read("BTC/USDT").value.captures.length, 3); assert.equal(b.comparison.read("BTC/USDT").value.captures.length, 2);
  assert.equal(load(a.local).comparison.read("BTC/USDT").status, "absent");
});
test("immutable capture JSON is cached while mutable captures are reserialized", () => {
  const a = load(), value = record(); let visits = 0;
  Object.defineProperty(value.captures[0], "source", { enumerable: true, configurable: true, get() { visits++; return "pack-1"; } });
  freeze(value.captures[0]); const first = a.comparison.serialize(value); assert.equal(first.ok, true); const firstVisits = visits;
  value.focus = null; value.view = "matrix";
  const next = a.comparison.serialize(value); assert.equal(next.ok, true); assert.equal(visits, firstVisits, "presentation saves reuse validated immutable capture serialization");
  const mutable = record(); a.comparison.serialize(mutable); mutable.captures[0].metrics.volume.value = 42;
  assert.equal(JSON.parse(a.comparison.serialize(mutable).raw).captures[0].metrics.volume.value, 42);
});
test("serialized strings are validated and a successful frozen result writes without reparsing", () => {
  const a = load(), value = record(), serialized = a.comparison.serialize(value);
  assert.equal(Object.isFrozen(serialized), true); assert.equal(a.comparison.write("BTC/USDT", serialized).ok, true);
  assert.equal(a.comparison.write("BTC/USDT", JSON.stringify(record(2))).ok, true);
  assert.equal(a.comparison.write("BTC/USDT", JSON.stringify({ ...value, reference: "missing" })).ok, false);
  assert.equal(a.comparison.write("ETH/USDT", value).ok, false);
  assert.equal(a.comparison.write("BTC/USDT", { ok: true, raw: "bad" }).ok, false, "forged serializer results cannot bypass validation");
});


test("size-only preflight reuses cached captures without joining a near-cap record", () => {
  const a = load(), value = record(128), remaining = CAP - Buffer.byteLength(JSON.stringify(value));
  value.captures[0].source += "x".repeat(remaining - 32);
  value.captures.forEach(freeze);
  const first = a.comparison.measure(value); assert.equal(first.ok, true); assert.equal(first.bytes, CAP - 32); assert.equal(first.raw, undefined);
  value.focus = "cell-100"; value.sort = { key: "volume", direction: "desc" };
  const measured = a.comparison.measure(value); assert.equal(measured.ok, true); assert.equal(measured.raw, undefined);
  assert.equal(measured.bytes, Buffer.byteLength(a.comparison.serialize(value).raw));
  assert.equal(a.session.writes.length, 0, "preflight never writes storage");
});
test("previously verified slots still reject changed corrupt text before another save", () => {
  const a = load(); assert.equal(a.comparison.write("BTC/USDT", record()).ok, true);
  a.session.map.set(KEY, "corrupt after save");
  assert.equal(a.comparison.write("BTC/USDT", record(2)).status, "retained"); assert.equal(a.session.getItem(KEY), "corrupt after save");
});


test("exposure interval validation permits only representational epoch subtraction rounding", () => {
  const a = load(), value = record(), capture = value.captures[0], epoch = Date.parse("2026-10-04T06:00:00Z");
  capture.nominal.t0 += epoch; capture.nominal.t1 += epoch; capture.observed.t0 = epoch + 1000000.1234; capture.observed.t1 = epoch + 1030000.5678;
  capture.observed.seconds = 30.0004444; capture.measuredThrough += epoch;
  capture.when.eventStartMs += epoch; capture.when.eventEndMs += epoch;
  for (const metric of Object.values(capture.metrics)) { metric.supportEnd += epoch; metric.knownThrough += epoch; }
  assert.equal(a.comparison.validate(value).ok, true);
  capture.observed.seconds += .01; assert.equal(a.comparison.validate(value).ok, false, "a meaningful exposure change is not roundoff");
});


test("a failed initial read protects a recovered valid record until adoption or explicit discard", () => {
  const a = load(), original = record(3), raw = JSON.stringify(original), working = record(2);
  a.session.map.set(KEY, raw); a.session.readError = failure("SecurityError");
  const unread = a.comparison.read("BTC/USDT"); assert.equal(unread.status, "unreadable"); assert.equal(unread.raw, null);
  a.session.readError = null;
  for (const retry of [record(0), working, { ...working, focus: "cell-1" }]) {
    const result = a.comparison.write("BTC/USDT", retry);
    assert.equal(result.status, "retained"); assert.equal(result.raw, raw); assert.match(result.reason, /reload/i);
    assert.equal(a.session.getItem(KEY), raw); assert.equal(a.session.writes.length, 0);
  }
  assert.deepEqual(plain(load(a.local, a.session).comparison.read("BTC/USDT").value), original, "a normal reload restores the original captures");
  a.session.removeError = failure("SecurityError"); assert.equal(a.comparison.discard("BTC/USDT").ok, false);
  assert.equal(a.comparison.write("BTC/USDT", working).status, "retained", "failed discard cannot authorize replacement");
  a.session.removeError = null; assert.equal(a.comparison.discard("BTC/USDT").ok, true);
  working.focus = "cell-1"; assert.equal(a.comparison.write("BTC/USDT", working).ok, true);
  assert.deepEqual(plain(a.comparison.read("BTC/USDT").value), working, "explicit discard saves latest working state");
});
test("explicit successful read adopts recovered captures while absent or previously read slots keep latest Retry", () => {
  const a = load(), original = record(3); a.session.map.set(KEY, JSON.stringify(original)); a.session.readError = failure("SecurityError");
  a.comparison.read("BTC/USDT"); a.session.readError = null; assert.equal(a.comparison.write("BTC/USDT", record(0)).status, "retained");
  assert.deepEqual(plain(a.comparison.read("BTC/USDT").value), original);
  assert.equal(a.comparison.write("BTC/USDT", { ...original, focus: "cell-2" }).ok, true);
  for (const known of [null, record(1)]) {
    const b = load(); if (known) b.session.map.set(KEY, JSON.stringify(known));
    assert.equal(b.comparison.read("BTC/USDT").ok, true); b.session.readError = failure("SecurityError");
    b.comparison.read("BTC/USDT"); assert.equal(b.comparison.write("BTC/USDT", record(2)).status, "unsaved"); b.session.readError = null;
    const latest = record(2); latest.focus = "cell-1"; assert.equal(b.comparison.write("BTC/USDT", latest).ok, true);
    assert.deepEqual(plain(b.comparison.read("BTC/USDT").value), latest);
  }
  const absent = load(); absent.session.readError = failure("SecurityError"); absent.comparison.read("BTC/USDT"); absent.session.readError = null;
  assert.equal(absent.comparison.write("BTC/USDT", record(2)).ok, true, "recovered absence has no unread captures to replace");
});
test("initial read failure does not weaken corrupt or newer raw retention", () => {
  for (const raw of ["{broken", JSON.stringify({ ...record(), comparisonVersion: 3 })]) {
    const a = load(); a.session.map.set(KEY, raw); a.session.readError = failure("SecurityError"); a.comparison.read("BTC/USDT"); a.session.readError = null;
    assert.equal(a.comparison.write("BTC/USDT", record()).status, "retained"); assert.equal(a.session.getItem(KEY), raw);
    a.session.removeItem(KEY); assert.equal(a.comparison.write("BTC/USDT", record()).status, "retained");
    assert.equal(a.comparison.discard("BTC/USDT").ok, true); assert.equal(a.comparison.write("BTC/USDT", record(2)).ok, true);
  }
});


test("recovered absence stays known when an owned write succeeds but its verification read fails", () => {
  const a = load(); a.session.readError = failure("SecurityError"); a.comparison.read("BTC/USDT"); a.session.readError = null;
  const set = a.session.setItem.bind(a.session);
  a.session.setItem = (key, raw) => { set(key, raw); a.session.readError = failure("SecurityError"); };
  assert.equal(a.comparison.write("BTC/USDT", record(2)).status, "unsaved");
  a.session.readError = null; assert.equal(JSON.parse(a.session.getItem(KEY)).captures.length, 2, "the first write reached the empty slot");
  a.session.setItem = set;
  const latest = record(3); latest.focus = "cell-2";
  assert.equal(a.comparison.write("BTC/USDT", latest).ok, true, "Retry can advance the owned record rather than retain it as unread");
  assert.deepEqual(plain(a.comparison.read("BTC/USDT").value), latest);
});

const LEGACY_KEY = KEY.replace(":v2:", ":v1:");
const legacy = () => { const v = record(); v.comparisonVersion = 1; delete v.selectedMetric; for (const c of v.captures) { delete c.contextOrigin; delete c.context; delete c.originatingObservation; } return v; };
test("legacy restore is read-only; first verified v2 mutation retires only unchanged copied legacy text", () => {
  const a = load(), raw = JSON.stringify(legacy()); a.session.map.set(LEGACY_KEY, raw);
  const got = a.comparison.read("BTC/USDT"); assert.equal(got.value.comparisonVersion, 2); assert.equal(got.value.captures[0].contextOrigin, "legacy-structural");
  assert.equal(a.session.writes.length, 0); assert.equal(a.session.getItem(LEGACY_KEY), raw);
  got.value.selectedMetric = "trades"; assert.equal(a.comparison.write("BTC/USDT", got.value).ok, true);
  assert.equal(a.session.getItem(LEGACY_KEY), null); assert.equal(JSON.parse(a.session.getItem(KEY)).selectedMetric, "trades");
});
test("failed migration retains exact v1 and working record; changed rollback is retained separately", () => {
  const a = load(), raw = JSON.stringify(legacy()); a.session.map.set(LEGACY_KEY, raw); const working = a.comparison.read("BTC/USDT").value;
  a.session.writeError = failure("QuotaExceededError"); assert.equal(a.comparison.write("BTC/USDT", working).ok, false); assert.equal(a.session.getItem(LEGACY_KEY), raw);
  a.session.writeError = null; const changed = raw + " "; a.session.map.set(LEGACY_KEY, changed);
  const saved = a.comparison.write("BTC/USDT", working); assert.equal(saved.ok, true); assert.match(saved.legacyNotice, /Changed rollback/); assert.equal(a.session.getItem(LEGACY_KEY), changed);
});
test("invalid v2 never falls back to valid v1", () => {
  const a = load(); a.session.map.set(LEGACY_KEY, JSON.stringify(legacy())); a.session.map.set(KEY, "bad");
  assert.equal(a.comparison.read("BTC/USDT").value, null); assert.equal(a.comparison.write("BTC/USDT", record()).status, "retained");
});
test("context caps and references reject atomically without truncating or altering stored captures", () => {
  const a = load(), value = record(), c = value.captures[0]; c.contextOrigin = "frame-v2";
  c.context.supports = { observation: { supportEnd: 1030000, knownThrough: 1030000 }, atr: { supportEnd: 1000000, knownThrough: 1000000, result: { tag: "finite", value: 100 } } };
  c.context.histories = [{ id: "volume", formula: "cells.volume.amount@1", unit: "usdt", slots: Array.from({length:12}, () => ({result:{tag:"finite",value:1},supportId:"observation",denominatorIds:["atr"]})) }];
  assert.equal(a.comparison.write("BTC/USDT", value).ok, true); const stored = a.session.getItem(KEY);
  for (const mutate of [v => v.captures[0].context.histories[0].slots.push(v.captures[0].context.histories[0].slots[0]), v => v.captures[0].context.histories[0].slots[0].denominatorIds=["unknown"], v => v.captures[0].context.supports.atr.source="€".repeat(6000), v => v.captures[0].context.supports.atr.bad=Infinity]) {
    const broken = plain(value); mutate(broken); assert.equal(a.comparison.write("BTC/USDT", broken).ok, false); assert.equal(a.session.getItem(KEY), stored);
  }
});

test("v2 context accepts four histories, twelve slots and exactly 16 KiB UTF-8; one-byte excess is atomic", () => {
  const a=load(), value=record(), c=value.captures[0]; c.contextOrigin="frame-v2";
  c.context.supports={observation:{supportEnd:1030000,knownThrough:1030000,source:"€\""}};
  c.context.histories=["volume","trades","flow","delta"].map(id=>({id,formula:"fixture@1",unit:"usdt",slots:Array.from({length:12},()=>({result:{tag:"finite",value:1},supportId:"observation",denominatorIds:[]}))}));
  c.context.supports.observation.source += "x".repeat(16384-Buffer.byteLength(JSON.stringify(c.context)));
  assert.equal(Buffer.byteLength(JSON.stringify(c.context)),16384);
  assert.equal(a.comparison.write("BTC/USDT",value).ok,true); const raw=a.session.getItem(KEY);
  const over=plain(value); over.captures[0].context.supports.observation.source+="x";
  assert.equal(a.comparison.write("BTC/USDT",over).ok,false); assert.equal(a.session.getItem(KEY),raw);
  const fifth=plain(value); fifth.captures[0].context.supports.observation.source="small"; fifth.captures[0].context.histories.push({...fifth.captures[0].context.histories[0],id:"size"});
  assert.equal(a.comparison.write("BTC/USDT",fifth).ok,false); assert.equal(a.session.getItem(KEY),raw);
});
test("failed v2 readback during migration retains the exact legacy rollback", () => {
  const a=load(), raw=JSON.stringify(legacy()); a.session.map.set(LEGACY_KEY,raw); const working=a.comparison.read("BTC/USDT").value;
  const original=a.session.getItem.bind(a.session); a.session.getItem=key=>key===KEY && a.session.map.has(KEY)?null:original(key);
  const result=a.comparison.write("BTC/USDT",working); assert.equal(result.ok,false); assert.equal(result.status,"unsaved");
  assert.equal(a.session.map.get(LEGACY_KEY),raw); assert.equal(working.captures.length,1);
});


test("a legacy JSON string whose v2 upgrade exceeds the byte cap cannot replace saved work", () => {
  const a = load(), value = legacy();
  value.captures[0].source += "x".repeat(CAP - Buffer.byteLength(JSON.stringify(value)));
  const raw = JSON.stringify(value);
  assert.equal(Buffer.byteLength(raw), CAP, "the incoming v1 is valid at the existing cap");
  assert.equal(a.comparison.validate(JSON.parse(raw)).ok, true);
  assert.equal(a.comparison.write("BTC/USDT", record(2)).ok, true);
  const before = a.session.getItem(KEY), writes = a.session.writes.length;
  const failed = a.comparison.write("BTC/USDT", raw);
  assert.equal(failed.status, "oversized"); assert.equal(failed.ok, false);
  assert.equal(a.session.getItem(KEY), before); assert.equal(a.session.writes.length, writes);
  assert.deepEqual(plain(a.comparison.read("BTC/USDT").value), record(2));
});
