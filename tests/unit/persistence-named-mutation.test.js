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
function seeded() {
  const localStorage = new MemoryStorage();
  const window = { localStorage, sessionStorage: new MemoryStorage(), crypto };
  vm.runInNewContext(SOURCE, { window, console: { warn() {} } });
  const state = window.explorerState;
  assert.equal(state.saveNamedViews([legacy("A"), legacy("B")]).ok, true);
  return { state, localStorage };
}
function authoritative(local) {
  const pointer = JSON.parse(local.getItem(PREFIX + "drawing-views:v1:pointer"));
  return JSON.parse(local.getItem(PREFIX + "drawing-views:v1:record:" + pointer.id)).entries;
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
