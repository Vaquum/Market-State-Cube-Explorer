"use strict";
// The page mutates the list returned by namedViews before saving it. The adapter's
// private last-read baseline must remain intact for its deletion/edit merge.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const SOURCE = fs.readFileSync(path.join(__dirname, "../../src/state.js"), "utf8");
const PREFIX = "market-state-cube-explorer:";
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
}
const legacy = (name) => ({
  name, visualVersion: 2, span: 1, lead: 0, tA: 1, tB: 2, cut: 2,
  n: 4, m: 0, live: false, auto: true, hash: "#w=24h&vis=2", mode: "volume",
});
function adapter(localStorage) {
  const window = { localStorage, sessionStorage: new MemoryStorage(), crypto };
  vm.runInNewContext(SOURCE, { window, console: { warn() {} } });
  return window.explorerState;
}
function seeded() {
  const localStorage = new MemoryStorage(), state = adapter(localStorage);
  assert.equal(state.saveNamedViews([legacy("A"), legacy("B")]).ok, true);
  return { state, localStorage };
}
function authoritative(local) {
  const records = [...local.map.entries()].filter(([key]) => key.startsWith(PREFIX + "drawing-views:v2:record:")) .map(([, value]) => JSON.parse(value));
  const newest = records.sort((a, b) => b.clock - a.clock)[0];
  return newest.cells.filter((cell) => cell.value !== null).sort((a, b) => a.position - b.position).map((cell) => cell.value);
}

test("splicing the returned named list deletes the name rather than resurrecting it", () => {
  const { state, localStorage } = seeded();
  const list = state.namedViews();
  list.splice(0, 1);
  assert.equal(state.saveNamedViews(list).ok, true);
  assert.deepEqual(authoritative(localStorage), [legacy("B")]);
});

test("replacing a returned named entry publishes its edited snapshot in the original position", () => {
  const { state, localStorage } = seeded();
  const list = state.namedViews();
  const edited = { ...legacy("A"), hash: "#w=7d&vis=2&mode=delta", mode: "delta" };
  list[0] = edited;
  assert.equal(state.saveNamedViews(list).ok, true);
  assert.deepEqual(authoritative(localStorage), [edited, legacy("B")]);
});


test("an absent protected snapshot returns the same legacy list used as its deletion baseline", () => {
  const localStorage = new MemoryStorage(), reader = adapter(localStorage), other = adapter(localStorage);
  const original = JSON.stringify([legacy("Legacy")]);
  localStorage.setItem(PREFIX + "views:v1", original);
  const snapshot = reader.namedViews({ snapshot: true });
  assert.equal(snapshot.status, "absent");
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries)), [legacy("Legacy")]);
  const concurrent = other.namedViews({ snapshot: true });
  assert.equal(other.saveNamedViews([...concurrent.entries, legacy("Other tab")]).ok, true);
  snapshot.entries.push(legacy("This tab"));
  assert.equal(reader.saveNamedViews(snapshot.entries).ok, true);
  assert.deepEqual(authoritative(localStorage).map((view) => view.name).sort(), ["Legacy", "Other tab", "This tab"]);
  assert.equal(localStorage.getItem(PREFIX + "views:v1"), original);
});

test("deleting from one protected snapshot preserves a name another tab acknowledges after that read", () => {
  const { localStorage } = seeded(), reader = adapter(localStorage), other = adapter(localStorage);
  const snapshot = reader.namedViews({ snapshot: true });
  assert.equal(snapshot.status, "ok");
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries)), [legacy("A"), legacy("B")]);
  const concurrent = other.namedViews();
  assert.equal(other.saveNamedViews([...concurrent, legacy("Other tab")]).ok, true);
  reader.namedViewsStatus(); // A diagnostic read must not replace the UI's last-read baseline.
  snapshot.entries.splice(0, 1);
  assert.equal(reader.saveNamedViews(snapshot.entries).ok, true);
  assert.deepEqual(authoritative(localStorage).map((view) => view.name).sort(), ["B", "Other tab"]);
});


test("adding to the default named list preserves every existing legacy View on first publication", () => {
  const localStorage = new MemoryStorage(), state = adapter(localStorage);
  const original = JSON.stringify([legacy("A"), legacy("B")]);
  localStorage.setItem(PREFIX + "views:v1", original);
  const list = state.namedViews();
  list.push(legacy("Added"));
  assert.equal(state.saveNamedViews(list).ok, true);
  assert.deepEqual(authoritative(localStorage), [legacy("A"), legacy("B"), legacy("Added")]);
  assert.equal(localStorage.getItem(PREFIX + "views:v1"), original);
});

test("deleting from the default legacy list retains another tab's newly acknowledged View", () => {
  const localStorage = new MemoryStorage(), reader = adapter(localStorage), other = adapter(localStorage);
  const original = JSON.stringify([legacy("A"), legacy("B")]);
  localStorage.setItem(PREFIX + "views:v1", original);
  const list = reader.namedViews();
  assert.deepEqual(JSON.parse(JSON.stringify(list)), [legacy("A"), legacy("B")]);
  const concurrent = other.namedViews();
  assert.equal(other.saveNamedViews([...concurrent, legacy("Other tab")]).ok, true);
  list.splice(0, 1);
  assert.equal(reader.saveNamedViews(list).ok, true);
  assert.deepEqual(authoritative(localStorage).map((view) => view.name).sort(), ["B", "Other tab"]);
  assert.equal(localStorage.getItem(PREFIX + "views:v1"), original);
});


for (const form of ["array", "snapshot"]) test(`a failed ${form} named read cannot delete prior Views after storage recovers`, () => {
  const { localStorage } = seeded(), reader = adapter(localStorage);
  const read = () => form === "array" ? reader.namedViews() : reader.namedViews({ snapshot: true }).entries;
  assert.equal(read().length, 2);
  const get = localStorage.getItem;
  localStorage.getItem = function (key) {
    if (key.startsWith(PREFIX + "drawing-views:v2:record:")) throw Object.assign(new Error("temporary access denial"), { name: "SecurityError" });
    return get.call(this, key);
  };
  const failedList = read();
  assert.equal(failedList.length, 0);
  localStorage.getItem = get;
  assert.equal(reader.namedViewsStatus().status, "ok", "diagnostic success must not adopt a replacement deletion baseline");
  const before = [...localStorage.map.entries()];
  failedList.push(legacy("Added"));
  const rejected = reader.saveNamedViews(failedList);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /read.*again/i);
  assert.deepEqual([...localStorage.map.entries()], before, "failed-read additions cannot mutate durable Views after access recovers");
  assert.deepEqual(authoritative(localStorage), [legacy("A"), legacy("B")]);
  const retry = read(); retry.push(legacy("Added"));
  assert.equal(reader.saveNamedViews(retry).ok, true);
  assert.deepEqual(authoritative(localStorage), [legacy("A"), legacy("B"), legacy("Added")]);
});
