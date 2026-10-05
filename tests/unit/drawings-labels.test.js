"use strict";
// Authored label vectors and independent SHA-256/gzip readers verify text stays distinct from inventory names.
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto"), zlib = require("node:zlib");
const E = require("../support/enc"), D = E.drawings;
const T = Date.UTC(2026, 0, 1), id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (n, extra = {}) => ({ id: id(n), name: `Inventory ${n}`, a: { timeMs: T, priceCents: 123 }, b: { timeMs: T + 1000, priceCents: 456 }, color: "#123456", visible: true, locked: false, ordinal: n, ...extra });
const collection = (...objects) => ({ schemaVersion: 1, instrument: "binance:spot:BTCUSDT", visible: true, objects });
const plain = (value) => JSON.parse(JSON.stringify(value));
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
const seal = (body) => ({ ...body, id: crypto.createHash("sha256").update(canon(body)).digest().subarray(0, 12).toString("base64url") });
const payload = (drawings) => seal({ visualVersion: 3, kind: "view", query: { t1: 1, t2: 2, p1: 1, p2: 2, tR: 0, pR: 0 }, view: { window: "24h" }, drawings });

test("legacy and new default drawings remain unlabeled; blank labels clear without changing inventory names or old wire shape", () => {
  const legacy = collection(line(1)); assert.deepEqual(plain(D.normalizeCollection(legacy)), legacy);
  for (const label of ["", " ", "  \u00a0 "]) {
    const raw = line(1, { label }); assert.deepEqual(plain(D.normalizeObject(raw)), line(1)); assert.equal(raw.label, label, "normalization never mutates authored input");
  }
  const made = D.newObject(collection(), { id: id(2), a: line(1).a, b: line(1).b, color: "#123456" });
  assert.equal(Object.hasOwn(made, "label"), false); assert.equal(made.name, "Trend line 1");
  const blank = D.newObject(collection(), { id: id(3), label: "  ", a: line(1).a, b: line(1).b, color: "#123456" });
  assert.equal(Object.hasOwn(blank, "label"), false);
  assert.equal(Object.hasOwn(D.duplicate(legacy, id(1)), "label"), false);
});

test("labels are trimmed plain text bounded by Unicode code points; invalid text and color overrides reject whole", () => {
  const text = "Resistance <A & B> 😀";
  const normalized = D.normalizeObject(line(1, { label: "  " + text + "  " }));
  assert.equal(normalized.label, text); assert.equal(normalized.name, "Inventory 1");
  assert.equal(D.normalizeObject(line(1, { label: "😀".repeat(80) })).label, "😀".repeat(80));
  for (const label of [null, 7, false, {}, "😀".repeat(81), "a\nb", "a\rb", "a\tb", "\u0000", "\u007f", "\u0085", "\ud800", "\udc00"]) {
    assert.throws(() => D.normalizeObject(line(1, { label })), /label/);
    assert.throws(() => D.normalizeCollection(collection(line(1), line(2, { label }))), /label/);
  }
  assert.throws(() => D.normalizeObject(line(1, { label: "R", labelColor: "#abcdef" })), /unsupported field labelColor/);
});

test("creation, translation and duplication preserve authored labels independently of required inventory names", () => {
  const made = D.newObject(collection(), { id: id(1), name: "Internal inventory", label: "  Breakout 😀  ", a: line(1).a, b: line(1).b, color: "#ABCDEF" });
  assert.equal(made.name, "Internal inventory"); assert.equal(made.label, "Breakout 😀"); assert.equal(made.color, "#abcdef");
  const original = { ...made, locked: true, visible: false }, duplicate = D.duplicate(collection(original), made.id);
  assert.equal(duplicate.label, "Breakout 😀"); assert.equal(duplicate.color, "#abcdef");
  assert.equal(duplicate.name, "Internal inventory copy 1"); assert.notEqual(duplicate.id, made.id); assert.equal(duplicate.visible, true); assert.equal(duplicate.locked, false);
  const moved = D.translate(made, 2000, 3.21);
  assert.equal(moved.label, made.label); assert.equal(moved.name, made.name); assert.equal(moved.a.timeMs, T + 2000); assert.equal(moved.b.priceCents - moved.a.priceCents, 333);
  const recolored = D.normalizeObject({ ...made, color: "#FEDCBA" });
  assert.equal(recolored.label, made.label); assert.equal(recolored.color, "#fedcba"); assert.equal(Object.hasOwn(recolored, "labelColor"), false);
});

test("label create, edit, clear and delete are atomic history steps; Undo/Redo restore exact text and branching clears Redo", () => {
  const store = D.createStore(collection());
  store.commit("Create", collection(line(1, { label: "Support" }))); assert.equal(store.state.objects[0].label, "Support");
  store.commit("Edit", collection(line(1, { label: "Resistance 😀" }))); assert.equal(store.undoLabel, "Edit");
  assert.equal(store.undo(), true); assert.equal(store.state.objects[0].label, "Support");
  assert.equal(store.redo(), true); assert.equal(store.state.objects[0].label, "Resistance 😀");
  store.commit("Clear", collection({ ...store.state.objects[0], label: "" })); assert.equal(Object.hasOwn(store.state.objects[0], "label"), false);
  store.undo(); assert.equal(store.state.objects[0].label, "Resistance 😀"); store.redo(); assert.equal(Object.hasOwn(store.state.objects[0], "label"), false);
  store.undo(); store.commit("Delete", collection()); assert.equal(store.state.objects.length, 0); assert.equal(store.canRedo, false);
  store.undo(); assert.equal(store.state.objects[0].label, "Resistance 😀"); assert.equal(store.state.objects[0].name, "Inventory 1");
  assert.throws(() => { store.state.objects[0].label = "mutated"; }, { name: "TypeError" });
  const before = store.state, revision = store.revision;
  assert.throws(() => store.commit("Invalid", collection(line(1, { label: "x\ny" }))), /label/);
  assert.equal(store.state, before); assert.equal(store.revision, revision); assert.equal(store.canRedo, true);
});

test("compressed and plain complete code3 preserve hidden labeled drawings with independently sealed text", async () => {
  const drawings = { ...collection(line(1, { label: "Target <A & B> 😀", visible: false, locked: true })), visible: false }, p = payload(drawings);
  const code = await E.codec.encodePortable(p); assert.ok(code.startsWith("origo-cube:3j."));
  const wire = JSON.parse(decodeURIComponent(code.slice("origo-cube:3j.".length)));
  assert.deepEqual(wire, p); assert.equal(wire.id, p.id, "content seal covers the exact authored label");
  const decoded = await E.codec.decodePortable(code), checked = E.codec.validatePortable(decoded.payload, {});
  assert.equal(checked.ok, true); assert.deepEqual(plain(checked.value.drawings), drawings);
  const zipped = await E.codec.encodePortable(p, { deflate: async (bytes) => zlib.gzipSync(bytes) });
  assert.ok(zipped.startsWith("origo-cube:3."));
  const independent = JSON.parse(zlib.gunzipSync(Buffer.from(zipped.slice("origo-cube:3.".length), "base64url")).toString("utf8"));
  assert.deepEqual(independent, p);
  const restored = await E.codec.decodePortable(zipped, { inflate: async (bytes) => zlib.gunzipSync(bytes) });
  assert.deepEqual(plain(E.codec.validatePortable(restored.payload, {}).value.drawings), drawings);
});

test("legacy unlabeled complete codes retain their exact payload and content identity", async () => {
  const p = payload(collection(line(1))), original = "origo-cube:3j." + encodeURIComponent(canon(p));
  assert.equal(await E.codec.encodePortable(p), original);
  const decoded = await E.codec.decodePortable(original), checked = E.codec.validatePortable(decoded.payload, {});
  assert.equal(checked.ok, true); assert.deepEqual(plain(checked.value.drawings), p.drawings); assert.equal(Object.hasOwn(checked.value.drawings.objects[0], "label"), false);
  const cleared = D.normalizeCollection(collection(line(1, { label: " " })));
  assert.equal(await E.codec.encodePortable(payload(cleared)), original, "clearing text restores the compatible unlabeled wire value");
});

test("tampered and re-sealed invalid labels reject complete snapshots without dropping valid peer objects", () => {
  const p = payload(collection(line(1, { label: "Support" }), line(2, { label: "Target" }))), tampered = structuredClone(p);
  tampered.drawings.objects[0].label = "Different text";
  assert.equal(E.codec.validatePortable(tampered, {}).ok, false);
  assert.match(E.codec.validatePortable(tampered, {}).reasons.join(" "), /integrity/);
  for (const label of ["a\nb", "😀".repeat(81), null, { text: "untrusted" }]) {
    const hostile = payload(collection(line(1, { label: "Valid" }), line(2, { label })));
    assert.equal(E.codec.validatePortable(hostile, {}).ok, false);
  }
  assert.equal(E.codec.validatePortable(payload(collection(line(1, { label: "R", labelColor: "#ffffff" }))), {}).ok, false);
  assert.equal(p.drawings.objects[0].label, "Support");
});
