"use strict";
// Independent product vectors: cents/ms/date grammar, atomic transactions, clipped Euclidean ink.
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto"), zlib = require("node:zlib");
const E = require("../support/enc"), D = E.drawings;
const T = Date.UTC(2026, 0, 1), id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (n, extra = {}) => ({ id: id(n), name: `Line ${n}`, a: { timeMs: T, priceCents: 123 }, b: { timeMs: T + 1, priceCents: 124 }, color: "#aBcDeF", visible: true, locked: false, ordinal: n, ...extra });
const collection = (...objects) => ({ schemaVersion: 1, instrument: "binance:spot:BTCUSDT", visible: true, objects });
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
const seal = (body) => ({ ...body, id: crypto.createHash("sha256").update(canon(body)).digest().subarray(0, 12).toString("base64url") });
const payload = (drawings) => seal({ visualVersion: 3, kind: "view", query: { t1: 1, t2: 2, p1: 1, p2: 2, tR: 0, pR: 0 }, view: { window: "24h" }, drawings });

test("integer precision quantizes once with upward ties; translation preserves the original vector", () => {
  assert.deepEqual(D.point(T + 0.5, 1.235), { timeMs: T + 1, priceCents: 124 });
  const o = D.translate(line(1), -0.5, -0.005);
  assert.equal(o.a.timeMs, T); assert.equal(o.a.priceCents, 123);
  assert.equal(o.b.timeMs - o.a.timeMs, 1); assert.equal(o.b.priceCents - o.a.priceCents, 1);
  assert.throws(() => D.translate(line(1, { a: { timeMs: Date.UTC(2009, 0, 1), priceCents: 0 } }), -1, 0), /2009/);
  assert.throws(() => D.translate(line(1, { locked: true }), 1, 1), /Unlock/);
  assert.throws(() => D.point(T, Infinity), /finite/);
});
test("exact editor accepts UTC milliseconds and cents, rejecting rollover, extra precision, signs and exponents", () => {
  assert.equal(D.parseTime("2024-02-29T12:03:04.005Z"), 1709208184005);
  assert.equal(D.formatTime(T), "2026-01-01T00:00:00.000Z");
  assert.equal(D.parsePrice("001.2"), 120); assert.equal(D.formatPrice(123), "1.23");
  for (const text of ["2023-02-29T00:00:00Z", "2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:00:00.01Z", "2026-01-01T00:00:00+00:00"]) assert.throws(() => D.parseTime(text));
  for (const text of ["1.001", "-1", "+1", ".25", "1.", "1e3", " 1", "10000000.01"]) assert.throws(() => D.parsePrice(text));
  assert.equal(D.parseTime("2100-01-01T00:00:00.000Z"), 4102444800000);
  assert.equal(D.parsePrice("10000000.00"), 1000000000);
});
test("whole collections normalize casing/order without silent defaults, dropping or applying invalid objects", () => {
  const input = collection(line(2), line(1)), out = D.normalizeCollection(input);
  assert.deepEqual(out.objects.map((o) => o.ordinal), [1, 2]); assert.equal(out.objects[0].color, "#abcdef"); assert.equal(input.objects[0].color, "#aBcDeF");
  for (const bad of [collection(line(1), line(1)), collection(line(1), line(2, { ordinal: 1 })), { ...input, instrument: "other" }, { ...input, schemaVersion: 2 }, { ...input, visible: 1 }, { ...input, objects: Array.from({ length: 201 }, (_, n) => line(n)) }]) assert.throws(() => D.normalizeCollection(bad));
  for (const o of [line(1, { color: "red" }), line(1, { color: "#ffffff00" }), line(1, { id: id(1).toUpperCase().replace("00000000", "ABCDEF00") }), line(1, { name: "\ud800" }), line(1, { name: "a\nb" }), line(1, { name: "😀".repeat(81) }), line(1, { b: { timeMs: T, priceCents: 123 } }), line(1, { a: { timeMs: T + .1, priceCents: 123 } })]) assert.throws(() => D.normalizeObject(o));
  assert.equal(D.normalizeObject(line(1, { name: "  😀".repeat(1) + " " })).name, "😀");
});
test("100 delta transactions include group reveal, replacement and undo; branch commits clear redo and IDs stay immutable", () => {
  const store = D.createStore({ ...collection(), visible: false });
  store.commit("Create", collection(line(1))); assert.equal(store.undoLabel, "Create"); assert.equal(store.state.visible, true);
  assert.equal(store.undo(), true); assert.equal(store.state.objects.length, 0); assert.equal(store.state.visible, false);
  assert.equal(store.redo(), true); assert.equal(store.state.objects.length, 1);
  assert.throws(() => { store.state.objects[0].a.priceCents = 9; }, TypeError);
  store.commit("Replace", collection(line(2), line(3))); store.undo(); assert.deepEqual(store.state.objects.map((o) => o.id), [id(1)]);
  assert.throws(() => store.commit("Bad", collection(line(1), line(1)))); assert.equal(store.canRedo, true);
  store.commit("Hide", { ...store.state, visible: false }); assert.equal(store.canRedo, false);
  let last;
  for (let n = 0; n < 101; n++) last = store.commit("Toggle " + n, { ...store.state, visible: !store.state.visible });
  assert.equal(last.truncated, true); let count = 0; while (store.undo()) count++; assert.equal(count, 100);
});
test("creation ordinals do not rewind after delete or Undo; duplicate is visible/unlocked and bounded in Unicode length", () => {
  const store = D.createStore(collection(line(12)));
  store.commit("Delete", collection());
  const a = D.newObject(store.state, { id: id(20), a: line(1).a, b: line(1).b, color: "#ffffff" }); assert.equal(a.ordinal, 13); assert.equal(a.name, "Trend line 14");
  store.commit("Create", collection(a)); store.undo();
  const b = D.newObject(store.state, { id: id(21), a: line(1).a, b: line(1).b, color: "#ffffff" }); assert.equal(b.ordinal, 14);
  const duplicate = D.duplicate(collection(line(1, { name: "😀".repeat(80), locked: true, visible: false })), id(1));
  assert.match(duplicate.name, / copy 1$/); assert.equal(Array.from(duplicate.name).length, 80); assert.equal(duplicate.locked, false); assert.equal(duplicate.visible, true); assert.notEqual(duplicate.id, id(1));
});
test("clipping handles far anchors, vertical/horizontal edges and tiny nonzero segments; distance uses visible geometry", () => {
  const rect = { x: 0, y: 0, w: 20, h: 20 };
  assert.deepEqual(D.clip({ x: -1000000, y: 10 }, { x: 1000000, y: 10 }, rect), { a: { x: 0, y: 10 }, b: { x: 20, y: 10 } });
  assert.equal(D.clip({ x: -10, y: -10 }, { x: -1, y: -1 }, rect), null);
  assert.deepEqual(D.clip({ x: 10, y: -20 }, { x: 10, y: 40 }, rect), { a: { x: 10, y: 0 }, b: { x: 10, y: 20 } });
  assert.equal(D.distance({ x: 5, y: 3 }, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }), 3);
  assert.equal(D.distance({ x: 13, y: 4 }, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }), 5);
  assert.ok(D.clip({ x: 1, y: 1 }, { x: 1 + 1e-8, y: 1 }, rect));
});
test("solid capsules use Euclidean grid footprint, union once with glyphs; diagonal never charges its bounding rectangle", () => {
  const rect = { x: 0, y: 0, w: 20, h: 20 };
  const stroke = (a, b, width) => ({ id: "ink", hot: true, rank: 0, rects: [], strokes: [{ a, b, width }] });
  const diag = stroke({ x: 0, y: 0 }, { x: 20, y: 20 }, 1);
  // Ten diagonal squares plus nine corner-touching neighbors on each side.
  assert.equal(E.role.occlusion([diag], rect).used, 28);
  // At radius1.75, the next diagonal of eight cells per side also intersects.
  const wide = { ...diag, strokes: [{ ...diag.strokes[0], width: 3.5 }] };
  assert.equal(E.role.occlusion([wide], rect).used, 44);
  assert.equal(E.role.occlusion([stroke({ x: -1e9, y: -1e9 }, { x: 1e9, y: 1e9 }, 3.5)], rect).used, 44);
  assert.equal(E.role.occlusion([wide, { ...wide, id: "same" }], rect).used, 44);
  assert.equal(E.role.occlusion([stroke({ x: 2, y: 5 }, { x: 18, y: 5 }, 1)], rect).used, 10);
  assert.equal(E.role.occlusion([stroke({ x: 5, y: 2 }, { x: 5, y: 18 }, 1)], rect).used, 10);
});
test("combined explicit priority retains Level/focus before hot refs; active ink is not exempt", () => {
  const plot = { x: 0, y: 0, w: 100, h: 100 }, band = (y) => [[0, y, 100, y + 9]];
  const got = E.role.occlusion([{ id: "active", priority: 3, hot: false, rank: 0, rects: band(30) }, { id: "ref", priority: 2, hot: true, rank: 0, rects: band(20) }, { id: "focus", priority: 1, hot: true, rank: 0, rects: band(10) }, { id: "level", priority: 0, hot: true, rank: 0, rects: band(0) }], plot);
  assert.deepEqual([...got.off], ["active"]); assert.equal(got.focusOver, true);
});
test("complete drawing code3/3j includes hidden objects; empty is explicit and v2 rejects drawing members", async () => {
  const p = payload({ ...collection(line(1, { visible: false })), visible: false });
  const code = await E.codec.encodePortable(p); assert.ok(code.startsWith("origo-cube:3j."));
  const decoded = await E.codec.decodePortable(code); assert.equal(decoded.kind, "v3"); assert.equal(decoded.version, 3);
  const checked = E.codec.validatePortable(decoded.payload, {}); assert.equal(checked.ok, true); assert.equal(checked.value.drawings.objects[0].visible, false);
  const zipped = await E.codec.encodePortable(p, { deflate: async (bytes) => zlib.gzipSync(bytes) }); assert.ok(zipped.startsWith("origo-cube:3."));
  assert.equal((await E.codec.decodePortable(zipped, { inflate: async (bytes) => zlib.gunzipSync(bytes) })).version, 3);
  assert.equal(E.codec.validatePortable(payload(collection()), {}).value.drawings.objects.length, 0);
  assert.equal(E.codec.validatePortable(seal({ ...p, drawings: undefined }), {}).ok, false);
  const old = { ...p, visualVersion: 2 }; delete old.id; assert.equal(E.codec.validatePortable(seal(old), {}).ok, false);
  const mismatched = "origo-cube:2j." + encodeURIComponent(JSON.stringify(p)); await assert.rejects(E.codec.decodePortable(mismatched), /disagree/);
});
test("tampered, foreign and 201-object complete snapshots reject whole, including re-sealed hostile content", () => {
  const p = payload(collection(line(1))); const tampered = structuredClone(p); tampered.drawings.objects[0].color = "#000000";
  assert.equal(E.codec.validatePortable(tampered, {}).ok, false);
  for (const c of [{ ...collection(), instrument: "foreign" }, { ...collection(), schemaVersion: 2 }, collection(...Array.from({ length: 201 }, (_, n) => line(n)))]) assert.equal(E.codec.validatePortable(payload(c), {}).ok, false);
});

// Independent capsule oracle: a rectangular strip plus two circular end caps, intersected against
// every grid square using convex-polygon SAT. Production scans a narrow segment strip instead.
function capsuleCells(a, b, radius, plot) {
  const length = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / length * radius, ny = (b.x - a.x) / length * radius;
  const polygon = [[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]], cells = new Set();
  const projectionsOverlap = (p, q, axis) => {
    const pp = p.map(([x, y]) => x * axis[0] + y * axis[1]), qq = q.map(([x, y]) => x * axis[0] + y * axis[1]);
    return Math.max(...pp) >= Math.min(...qq) - 1e-9 && Math.max(...qq) >= Math.min(...pp) - 1e-9;
  };
  for (let r = 0; r < Math.ceil(plot.h / 2); r++) for (let c = 0; c < Math.ceil(plot.w / 2); c++) {
    const x = plot.x + 2 * c, y = plot.y + 2 * r, xmax = Math.min(x + 2, plot.x + plot.w), ymax = Math.min(y + 2, plot.y + plot.h);
    const square = [[x, y], [xmax, y], [xmax, ymax], [x, ymax]], axes = [[1, 0], [0, 1]];
    for (let i = 0; i < 4; i++) { const v = polygon[i], w = polygon[(i + 1) % 4]; axes.push([v[1] - w[1], w[0] - v[0]]); }
    const body = axes.every((axis) => projectionsOverlap(polygon, square, axis));
    const cap = [a, b].some((p) => Math.hypot(Math.max(x - p.x, 0, p.x - xmax), Math.max(y - p.y, 0, p.y - ymax)) <= radius + 1e-9);
    if (body || cap) cells.add(r * Math.ceil(plot.w / 2) + c);
  }
  return cells;
}
test("mixed scenes agree with independent body-plus-disks union and greedy budget replay", () => {
  let seed = 7621; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const plot = { x: 3, y: 7, w: 31, h: 25 }, limit = Math.floor(16 * 13 * .2);
  for (let scene = 0; scene < 80; scene++) {
    const candidates = Array.from({ length: 5 }, (_, id) => ({ id, rank: id, hot: id === 0 && scene % 3 === 0, strokes: [{ a: { x: plot.x + random() * plot.w, y: plot.y + random() * plot.h }, b: { x: plot.x + random() * plot.w, y: plot.y + random() * plot.h }, width: 3.5 }] }));
    const used = new Set(), off = new Set(); let focusOver = false;
    for (const candidate of candidates) {
      const stroke = candidate.strokes[0], mine = capsuleCells(stroke.a, stroke.b, stroke.width / 2, plot), total = new Set([...used, ...mine]);
      if (total.size > limit && !candidate.hot) { off.add(candidate.id); continue; }
      if (total.size > limit) focusOver = true;
      for (const cell of mine) used.add(cell);
    }
    const got = E.role.occlusion(candidates, plot);
    assert.deepEqual(got.off, off, `retained IDs in scene ${scene}`); assert.equal(got.used, used.size); assert.equal(got.focusOver, focusOver);
  }
});
test("unprioritized reserved hot footprint stays ahead of explicit Level/drawing priorities", () => {
  const plot = { x: 0, y: 0, w: 20, h: 20 };
  const got = E.role.occlusion([{ id: "active", priority: 3, hot: false, rank: 0, rects: [[0, 0, 20, 2]] }, { id: "reserved", hot: true, rank: 0, rects: [[0, 0, 20, 20]] }], plot);
  assert.equal(got.off.has("active"), true); assert.equal(got.off.has("reserved"), false); assert.equal(got.focusOver, true);
});
