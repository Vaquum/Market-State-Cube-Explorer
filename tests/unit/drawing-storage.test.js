"use strict";
// Real storage failure shapes and independent sealed fixtures verify authored-data preservation.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto");
const E = require("../support/enc"), SOURCE = fs.readFileSync(require("node:path").join(__dirname, "../../src/state.js"), "utf8"), P = "market-state-cube-explorer:";
class Storage {
  constructor(other) { this.map = new Map(other?.map); this.fail = null; this.writes = []; }
  get length() { return this.map.size; } key(n) { return [...this.map.keys()][n] ?? null; }
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k, v) { if (this.fail?.(k)) throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); this.map.set(k, String(v)); this.writes.push(k); }
  removeItem(k) { this.map.delete(k); }
}
function load(local = new Storage(), session = new Storage()) {
  const window = { localStorage: local, sessionStorage: session, crypto, explorerEncoding: E };
  vm.runInNewContext(SOURCE, { window, console: { warn() {} } }); return { state: window.explorerState, local, session };
}
const T = Date.UTC(2026, 0, 1), id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const collection = (n) => ({ schemaVersion: 1, instrument: "binance:spot:BTCUSDT", visible: true, objects: n === 0 ? [] : [{ id: id(n), name: `Line ${n}`, a: { timeMs: T, priceCents: 1 }, b: { timeMs: T + 1, priceCents: 2 }, color: "#123456", visible: true, locked: false, ordinal: n }] });
const plain = (x) => JSON.parse(JSON.stringify(x));
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
function entry(name, n) { const body = { visualVersion: 3, kind: "view", query: { t1: 1, t2: 2, p1: 1, p2: 2, tR: 0, pR: 0 }, view: { window: "24h" }, drawings: collection(n) }; return { name, created: 100 + n, visualVersion: 3, span: 1, lead: 0, tA: 1, tB: 2, cut: 2, n: 4, m: 0, live: false, auto: true, hash: "#w=24h&vis=2", payload: { ...body, id: crypto.createHash("sha256").update(canon(body)).digest().subarray(0, 12).toString("base64url") } }; }
const records = (local) => [...local.map.entries()].filter(([k]) => k.includes("drawings:v1:record:")).map(([, v]) => JSON.parse(v));

test("fresh tabs start absent; reload restores only its session collection and forks before writing", () => {
  const a = load(); assert.equal(a.state.drawings.load().status, "absent");
  assert.equal(a.state.drawings.save(collection(1), 1).ok, true);
  const writerA = records(a.local)[0].writer, reload = load(a.local, a.session);
  assert.deepEqual(plain(reload.state.drawings.load().collection), collection(1));
  reload.state.drawings.save(collection(2), 2); assert.notEqual(records(a.local).at(-1).writer, writerA);
  const fresh = load(a.local); assert.equal(fresh.state.drawings.load().status, "absent"); assert.equal(fresh.state.drawings.load().collection, null);
});
test("duplicated tabs fork and never replace each other's workspace; raced/lost indexes cannot erase immutable recoveries", () => {
  const a = load(); a.state.drawings.save(collection(1), 1);
  const b = load(a.local, new Storage(a.session)); assert.equal(b.state.drawings.load().collection.objects[0].id, id(1));
  b.state.drawings.save(collection(2), 2); a.state.drawings.save(collection(3), 3);
  assert.equal(a.state.drawings.load().collection.objects[0].id, id(3)); assert.equal(b.state.drawings.load().collection.objects[0].id, id(2));
  assert.equal(new Set(records(a.local).map((r) => r.writer)).size, 2);
  a.local.setItem(P + "drawings:v1:index", JSON.stringify({ storageVersion: 1, ids: [] }));
  assert.ok(a.state.drawings.load().recoveries.some((r) => r.collection.objects[0]?.id === id(2)));
});
test("two latest own validated revisions plus pinned replacement survive pruning and preceding-build writes", () => {
  const a = load(); a.state.drawings.save(collection(1), 1); const pin = a.state.drawings.preserve(collection(1)); assert.equal(pin.ok, true);
  a.state.drawings.save(collection(2), 2); a.state.drawings.save(collection(3), 3); a.state.drawings.save(collection(4), 4);
  assert.deepEqual(records(a.local).filter((r) => !r.pinned).map((r) => r.revision).sort(), [3, 4]);
  assert.equal(a.state.drawings.recover(pin.id).collection.objects[0].id, id(1));
  const protectedBefore = [...a.local.map.entries()].filter(([k]) => k.includes("drawings:v1:"));
  // Preceding writers save their known view/named keys; they cannot discover/rewrite protected records.
  a.local.setItem(P + "view:v5", JSON.stringify({ version: 5, visualVersion: 2, view: "#w=7d&vis=2" }));
  a.local.setItem(P + "views:v1", JSON.stringify([{ name: "legacy", hash: "#w=7d" }]));
  a.session.setItem(P + "history:v1", JSON.stringify({ entries: [], index: 0 }));
  assert.deepEqual([...a.local.map.entries()].filter(([k]) => k.includes("drawings:v1:")), protectedBefore);
  assert.equal(load(a.local, a.session).state.drawings.load().collection.objects[0].id, id(4));
});
test("quota or pointer failure keeps previous pointer/data; preservation failure and invalid writes are explicit", () => {
  const a = load(); a.state.drawings.save(collection(1), 1); const before = a.session.getItem(P + "drawings:v1:session");
  a.local.fail = (k) => k.includes("drawings:v1:record:");
  assert.equal(a.state.drawings.save(collection(2), 2).ok, false); assert.equal(a.state.drawings.preserve(collection(1)).ok, false);
  assert.equal(a.session.getItem(P + "drawings:v1:session"), before); assert.equal(a.state.drawings.load().collection.objects[0].id, id(1));
  a.local.fail = null; a.session.fail = () => true;
  assert.equal(a.state.drawings.save(collection(3), 3).ok, false); assert.equal(a.session.getItem(P + "drawings:v1:session"), before);
  assert.ok(a.state.drawings.load().recoveries.some((r) => r.collection.objects[0]?.id === id(3)));
  assert.equal(a.state.drawings.save({ ...collection(2), schemaVersion: 2 }, 2).ok, false);
});
test("corrupt, missing and unsupported recovery are not silent empty successes; originals remain verbatim", () => {
  const a = load(), saved = a.state.drawings.save(collection(1), 1), key = P + "drawings:v1:record:" + saved.id;
  a.local.setItem(key, "{broken"); assert.equal(a.state.drawings.load().status, "unreadable"); assert.equal(a.local.getItem(key), "{broken");
  a.local.removeItem(key); assert.equal(a.state.drawings.load().status, "unreadable"); assert.match(a.state.drawings.load().reason, /missing/);
  a.local.setItem(key, JSON.stringify({ storageVersion: 2, id: saved.id })); assert.equal(a.state.drawings.load().status, "unknown-version"); assert.equal(JSON.parse(a.local.getItem(key)).storageVersion, 2);
});
test("protected named snapshots retain full payload/order/rename/delete Undo while legacy writers stay isolated", () => {
  const a = load(), first = [entry("One", 1), entry("Two", 2)]; assert.equal(a.state.saveNamedViews(first).ok, true);
  assert.deepEqual(plain(a.state.namedViews()), first);
  const renamed = [{ ...first[0], name: "Renamed" }, first[1]]; assert.equal(a.state.saveNamedViews(renamed).ok, true);
  a.state.saveNamedViews([renamed[1]]); assert.deepEqual(plain(a.state.namedViews().map((e) => e.name)), ["Two"]);
  a.state.saveNamedViews(renamed); assert.deepEqual(plain(a.state.namedViews().map((e) => e.name)), ["Renamed", "Two"]);
  a.state.saveViews([{ name: "Legacy", hash: "#w=24h" }]); assert.deepEqual(plain(a.state.namedViews().map((e) => e.name)), ["Renamed", "Two"]);
  const pointer = JSON.parse(a.local.getItem(P + "drawing-views:v1:pointer"));
  a.local.removeItem(P + "drawing-views:v1:record:" + pointer.id); assert.equal(a.state.namedViewsStatus().status, "unreadable");
  assert.equal(a.state.saveNamedViews(first).ok, false, "do not overwrite an unrecoverable pointer with a successful-looking empty list");
});
test("two named writers preserve concurrent additions from their last-read baselines; invalid or quota writes preserve prior names", () => {
  const a = load(), b = load(a.local); a.state.namedViews(); b.state.namedViews();
  a.state.saveNamedViews([entry("A", 1)]); b.state.saveNamedViews([entry("B", 2)]);
  assert.deepEqual(new Set(a.state.namedViews().map((e) => e.name)), new Set(["A", "B"]));
  const before = a.local.getItem(P + "drawing-views:v1:pointer");
  assert.equal(a.state.saveNamedViews([{ name: "Bad", hash: "#w=24h" }]).ok, false);
  assert.equal(a.local.getItem(P + "drawing-views:v1:pointer"), before);
  a.local.fail = () => true; assert.equal(a.state.saveNamedViews([entry("C", 3)]).ok, false); assert.equal(a.local.getItem(P + "drawing-views:v1:pointer"), before);
});

const legacy = (name) => ({ name, visualVersion: 2, span: 1, lead: 0, tA: 1, tB: 2, cut: 2, n: 4, m: 0, live: false, auto: true, hash: "#w=24h&vis=2" });
test("legacy upgrade preserves unified order and delete Undo; one pointer failure keeps the authoritative list", () => {
  const a = load(), original = [legacy("A"), legacy("B")], foreign = { name: "Future", visualVersion: 99, opaque: "keep" };
  a.local.setItem(P + "views:v1", JSON.stringify([...original, foreign]));
  const untouched = a.local.getItem(P + "views:v1");
  assert.equal(a.state.namedViewsStatus().status, "absent"); a.state.namedViews();
  assert.equal(a.state.saveNamedViews(original).ok, true);
  assert.deepEqual(plain(load(a.local).state.namedViews()), original);
  const upgraded = [entry("A", 1), original[1]];
  assert.equal(a.state.saveNamedViews(upgraded).ok, true);
  assert.deepEqual(plain(load(a.local).state.namedViews()), upgraded, "upgrade must not move A after B");
  const before = a.local.getItem(P + "drawing-views:v1:pointer");
  a.local.fail = (key) => key === P + "drawing-views:v1:pointer";
  assert.equal(a.state.saveNamedViews([upgraded[1]]).ok, false);
  assert.equal(a.local.getItem(P + "drawing-views:v1:pointer"), before);
  assert.deepEqual(plain(load(a.local).state.namedViews()), upgraded, "failed deletion applies no durable change");
  a.local.fail = null;
  assert.equal(a.state.saveNamedViews([upgraded[1]]).ok, true);
  assert.deepEqual(plain(load(a.local).state.namedViews()), [upgraded[1]]);
  assert.equal(a.state.saveNamedViews(upgraded).ok, true);
  assert.deepEqual(plain(load(a.local).state.namedViews()), upgraded, "delete Undo restores the original position");
  assert.equal(a.local.getItem(P + "views:v1"), untouched, "new writers never rewrite legacy or foreign records");
  assert.equal(a.local.writes.includes(P + "views:v1"), true);
  assert.equal(a.local.writes.filter((key) => key === P + "views:v1").length, 1);
});
test("concurrent migration cannot downgrade an upgraded legacy view", () => {
  const a = load(), original = [legacy("A"), legacy("B")]; a.local.setItem(P + "views:v1", JSON.stringify(original));
  const b = load(a.local); a.state.namedViews(); b.state.namedViews();
  assert.equal(a.state.saveNamedViews([entry("A", 1), original[1]]).ok, true);
  assert.equal(b.state.saveNamedViews([...original, entry("C", 3)]).ok, true);
  const got = plain(b.state.namedViews());
  assert.equal(got[0].name, "A"); assert.equal(got[0].visualVersion, 3);
  assert.deepEqual(got.map((view) => view.name), ["A", "B", "C"]);
});
test("named camera metadata and complete payloads are validated before publication or loading", () => {
  const a = load(), good = entry("A", 1); a.state.saveNamedViews([good]);
  const before = a.local.getItem(P + "drawing-views:v1:pointer");
  for (const mutation of [{ span: 0 }, { span: -1 }, { lead: Infinity }, { tA: null }, { tB: "2" }, { cut: NaN }, { n: undefined }, { m: null }, { live: 1 }, { auto: "true" }, { payload: undefined }, { payload: { ...good.payload, drawings: collection(2) } }, { visualVersion: 4 }]) {
    assert.equal(a.state.saveNamedViews([{ ...good, ...mutation }]).ok, false, JSON.stringify(mutation));
    assert.equal(a.local.getItem(P + "drawing-views:v1:pointer"), before);
  }
  const pointer = JSON.parse(before), key = P + "drawing-views:v1:record:" + pointer.id;
  const raw = JSON.parse(a.local.getItem(key)); raw.entries[0].live = "false"; a.local.setItem(key, JSON.stringify(raw));
  assert.equal(a.state.namedViewsStatus().status, "unreadable");
  assert.deepEqual(plain(a.state.namedViews()), []);
  assert.equal(JSON.parse(a.local.getItem(key)).entries[0].live, "false");
});

test("a stale named baseline cannot resurrect a concurrent deletion", () => {
  const a = load(), first = [legacy("A"), entry("B", 2)]; a.state.saveNamedViews(first); a.state.namedViews();
  const b = load(a.local); b.state.namedViews();
  assert.equal(a.state.saveNamedViews([first[1]]).ok, true);
  assert.equal(b.state.saveNamedViews([...first, entry("C", 3)]).ok, true);
  assert.deepEqual(plain(b.state.namedViews().map((view) => view.name)), ["B", "C"]);
});
