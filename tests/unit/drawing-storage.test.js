"use strict";
// Real storage failure shapes and independent sealed fixtures verify authored-data preservation.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto");
const E = require("../support/enc"), SOURCE = fs.readFileSync(require("node:path").join(__dirname, "../../src/state.js"), "utf8"), P = "market-state-cube-explorer:";
class Storage {
  constructor(other) { this.map = new Map(other?.map); this.fail = null; this.writes = []; this.beforeWrite = null; }
  get length() { return this.map.size; } key(n) { return [...this.map.keys()][n] ?? null; }
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k, v) { if (this.fail?.(k)) throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); this.beforeWrite?.(k, String(v)); this.map.set(k, String(v)); this.writes.push(k); }
  removeItem(k) { this.map.delete(k); }
}
function load(local = new Storage(), session = new Storage(), identityCrypto = crypto) {
  const window = { localStorage: local, sessionStorage: session, crypto: identityCrypto, explorerEncoding: E };
  vm.runInNewContext(SOURCE, { window, console: { warn() {} } }); return { state: window.explorerState, local, session };
}
const T = Date.UTC(2026, 0, 1), id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const collection = (n) => ({ schemaVersion: 1, instrument: "binance:spot:BTCUSDT", visible: true, objects: n === 0 ? [] : [{ id: id(n), name: `Line ${n}`, a: { timeMs: T, priceCents: 1 }, b: { timeMs: T + 1, priceCents: 2 }, color: "#123456", visible: true, locked: false, ordinal: n }] });
const plain = (x) => JSON.parse(JSON.stringify(x));
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
function entry(name, n) { const body = { visualVersion: 3, kind: "view", query: { t1: 1, t2: 2, p1: 1, p2: 2, tR: 0, pR: 0 }, view: { window: "24h" }, drawings: collection(n) }; return { name, created: 100 + n, visualVersion: 3, span: 1, lead: 0, tA: 1, tB: 2, cut: 2, n: 4, m: 0, live: false, auto: true, hash: "#w=24h&vis=2", payload: { ...body, id: crypto.createHash("sha256").update(canon(body)).digest().subarray(0, 12).toString("base64url") } }; }
const namedRecords = (local) => [...local.map.entries()].filter(([key]) => key.includes("drawing-views:v2:record:")).map(([key, value]) => ({ key, ...JSON.parse(value) }));
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
  assert.deepEqual(records(a.local).filter((r) => !r.pinned).map((r) => r.revision).sort(), [1, 2, 3, 4]);
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
  a.local.setItem(key, "{broken"); assert.equal(a.state.drawings.recover(saved.id).status, "unreadable"); assert.equal(a.state.drawings.load().status, "ok", "complete session is independent of corrupt recovery history"); assert.equal(a.local.getItem(key), "{broken");
  a.local.removeItem(key); assert.equal(a.state.drawings.recover(saved.id).status, "absent"); assert.equal(a.state.drawings.load().status, "ok");
  a.local.setItem(key, JSON.stringify({ storageVersion: 2, id: saved.id })); assert.equal(a.state.drawings.recover(saved.id).status, "unknown-version"); assert.equal(JSON.parse(a.local.getItem(key)).storageVersion, 2);
  a.session.setItem(P + "drawings:v1:session", JSON.stringify({ storageVersion: 3, id: saved.id })); assert.equal(a.state.drawings.load().status, "unknown-version");
});
test("protected named snapshots retain full payload/order/rename/delete Undo while legacy writers stay isolated", () => {
  const a = load(), first = [entry("One", 1), entry("Two", 2)]; assert.equal(a.state.saveNamedViews(first).ok, true);
  assert.deepEqual(plain(a.state.namedViews()), first);
  const renamed = [{ ...first[0], name: "Renamed" }, first[1]]; assert.equal(a.state.saveNamedViews(renamed).ok, true);
  a.state.saveNamedViews([renamed[1]]); assert.deepEqual(plain(a.state.namedViews().map((e) => e.name)), ["Two"]);
  a.state.saveNamedViews(renamed); assert.deepEqual(plain(a.state.namedViews().map((e) => e.name)), ["Renamed", "Two"]);
  a.state.saveViews([{ name: "Legacy", hash: "#w=24h" }]); assert.deepEqual(plain(a.state.namedViews().map((e) => e.name)), ["Renamed", "Two"]);
  const current = namedRecords(a.local).sort((a, b) => b.clock - a.clock)[0];
  a.local.setItem(current.key, "{broken"); assert.equal(a.state.namedViewsStatus().status, "unreadable");
  assert.equal(a.state.saveNamedViews(first).ok, false, "do not overwrite an unrecoverable pointer with a successful-looking empty list");
});
test("two named writers preserve concurrent additions from their last-read baselines; invalid or quota writes preserve prior names", () => {
  const a = load(), b = load(a.local); a.state.namedViews(); b.state.namedViews();
  a.state.saveNamedViews([entry("A", 1)]); b.state.saveNamedViews([entry("B", 2)]);
  assert.deepEqual(new Set(a.state.namedViews().map((e) => e.name)), new Set(["A", "B"]));
  const before = JSON.stringify(namedRecords(a.local));
  assert.equal(a.state.saveNamedViews([{ name: "Bad", hash: "#w=24h" }]).ok, false);
  assert.equal(JSON.stringify(namedRecords(a.local)), before);
  a.local.fail = () => true; assert.equal(a.state.saveNamedViews([entry("C", 3)]).ok, false); assert.equal(JSON.stringify(namedRecords(a.local)), before);
});

const legacy = (name) => ({ name, visualVersion: 2, span: 1, lead: 0, tA: 1, tB: 2, cut: 2, n: 4, m: 0, live: false, auto: true, hash: "#w=24h&vis=2" });
test("legacy upgrade preserves unified order and delete Undo; one publication failure keeps the authoritative list", () => {
  const a = load(), original = [legacy("A"), legacy("B")], foreign = { name: "Future", visualVersion: 99, opaque: "keep" };
  a.local.setItem(P + "views:v1", JSON.stringify([...original, foreign]));
  const untouched = a.local.getItem(P + "views:v1");
  assert.equal(a.state.namedViewsStatus().status, "absent"); a.state.namedViews();
  assert.equal(a.state.saveNamedViews(original).ok, true);
  assert.deepEqual(plain(load(a.local).state.namedViews()), original);
  const upgraded = [entry("A", 1), original[1]];
  assert.equal(a.state.saveNamedViews(upgraded).ok, true);
  assert.deepEqual(plain(load(a.local).state.namedViews()), upgraded, "upgrade must not move A after B");
  const before = JSON.stringify(namedRecords(a.local));
  a.local.fail = (key) => key.includes("drawing-views:v2:record:");
  assert.equal(a.state.saveNamedViews([upgraded[1]]).ok, false);
  assert.equal(JSON.stringify(namedRecords(a.local)), before);
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
  const before = JSON.stringify(namedRecords(a.local));
  for (const mutation of [{ span: 0 }, { span: -1 }, { lead: Infinity }, { tA: null }, { tB: "2" }, { cut: NaN }, { n: undefined }, { m: null }, { live: 1 }, { auto: "true" }, { payload: undefined }, { payload: { ...good.payload, drawings: collection(2) } }, { visualVersion: 4 }]) {
    assert.equal(a.state.saveNamedViews([{ ...good, ...mutation }]).ok, false, JSON.stringify(mutation));
    assert.equal(JSON.stringify(namedRecords(a.local)), before);
  }
  const key = namedRecords(a.local).sort((a, b) => b.clock - a.clock)[0].key;
  const raw = JSON.parse(a.local.getItem(key)); raw.cells[0].value.live = "false"; a.local.setItem(key, JSON.stringify(raw));
  assert.equal(a.state.namedViewsStatus().status, "unreadable");
  assert.deepEqual(plain(a.state.namedViews()), []);
  assert.equal(JSON.parse(a.local.getItem(key)).cells[0].value.live, "false");
});

test("a stale named baseline cannot resurrect a concurrent deletion", () => {
  const a = load(), first = [legacy("A"), entry("B", 2)]; a.state.saveNamedViews(first); a.state.namedViews();
  const b = load(a.local); b.state.namedViews();
  assert.equal(a.state.saveNamedViews([first[1]]).ok, true);
  assert.equal(b.state.saveNamedViews([...first, entry("C", 3)]).ok, true);
  assert.deepEqual(plain(b.state.namedViews().map((view) => view.name)), ["B", "C"]);
});


test("an untouched duplicate survives original advances and rolling recovery expiry, including reload", () => {
  const original = load(); const saved = original.state.drawings.save(collection(1), 1);
  const duplicateSession = new Storage(original.session); // Copy only the browser's complete session bytes; never load or edit the duplicate.
  for (let n = 2; n <= 60; n++) assert.equal(original.state.drawings.save(collection(n), n).ok, true);
  assert.equal(original.local.getItem(P + "drawings:v1:record:" + saved.id), null, "old shared recovery actually expired");
  assert.equal(records(original.local).length, 24);
  const duplicate = load(original.local, duplicateSession);
  assert.deepEqual(plain(duplicate.state.drawings.load().collection), collection(1));
  assert.deepEqual(plain(load(original.local, duplicateSession).state.drawings.load().collection), collection(1));
  assert.equal(original.state.drawings.load().collection.objects[0].id, id(60));
});

test("ordinary and prior-replacement recoveries remain bounded across hundreds of documents and imports", () => {
  const local = new Storage(); let firstSession, oldestPin, last, current;
  for (let n = 1; n <= 120; n++) {
    current = load(local); assert.equal(current.state.drawings.save(collection(n), n).ok, true);
    if (n === 1) firstSession = new Storage(current.session);
    const pinned = current.state.drawings.preserve(collection(n)); assert.equal(pinned.ok, true); if (n === 1) oldestPin = pinned.id;
    const all = records(local); assert.ok(all.filter((r) => !r.pinned).length <= 24); assert.ok(all.filter((r) => r.pinned).length <= 8);
  }
  last = current.state.drawings.save(collection(121), 121); assert.equal(last.ok, true);
  assert.equal(current.state.drawings.save(collection(122), 122).ok, true);
  const all = records(local), activeWriter = JSON.parse(current.session.getItem(P + "drawings:v1:session")).writer;
  assert.equal(all.length, 32); assert.deepEqual(all.filter((r) => r.writer === activeWriter && !r.pinned).map((r) => r.revision).slice(-2), [121, 122]);
  assert.equal(current.state.drawings.recover(oldestPin).status, "absent", "replacement pins expire independently of current tab data");
  assert.deepEqual(plain(load(local, firstSession).state.drawings.load().collection), collection(1));
});

test("legacy drawing pointers migrate to full tab snapshots; failed migration cannot pretend to be protected", () => {
  const original = load(), saved = original.state.drawings.save(collection(1), 1);
  const oldPointer = JSON.stringify({ storageVersion: 1, id: saved.id }), oldSession = new Storage();
  oldSession.setItem(P + "drawings:v1:session", oldPointer);
  const migrating = load(original.local, oldSession); assert.deepEqual(plain(migrating.state.drawings.load().collection), collection(1));
  assert.equal(JSON.parse(oldSession.getItem(P + "drawings:v1:session")).storageVersion, 2);
  const refusing = new Storage(); refusing.setItem(P + "drawings:v1:session", oldPointer); refusing.fail = () => true;
  assert.equal(load(original.local, refusing).state.drawings.load().status, "unreadable");
  assert.equal(refusing.getItem(P + "drawings:v1:session"), oldPointer);
  assert.ok(load(original.local, refusing).state.drawings.load().recoveries.some((r) => r.id === saved.id));
});

test("getRandomValues-only origins can save complete drawings and named Views with secure UUIDv4 identities", () => {
  const fallback = { getRandomValues: (bytes) => crypto.webcrypto.getRandomValues(bytes) }, a = load(undefined, undefined, fallback);
  assert.equal(a.state.drawings.save(collection(1), 1).ok, true);
  assert.equal(a.state.saveNamedViews([entry("LAN", 1)]).ok, true);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const record of [...records(a.local), ...namedRecords(a.local)]) { assert.match(record.id, uuid); assert.match(record.writer, uuid); }
});

test("session identities and recovery timestamps are validated without poisoning future valid saves", () => {
  const a = load(), saved = a.state.drawings.save(collection(1), 1), key = P + "drawings:v1:record:" + saved.id;
  const original = JSON.parse(a.local.getItem(key));
  for (const createdAt of [-1, 0.5, "tomorrow", Number.MAX_SAFE_INTEGER + 1, null]) {
    const malformed = JSON.stringify({ ...original, createdAt }); a.local.setItem(key, malformed);
    assert.equal(a.state.drawings.recover(saved.id).status, "unreadable"); assert.equal(a.local.getItem(key), malformed);
  }
  const legacyRecord = { ...original }; delete legacyRecord.createdAt; a.local.setItem(key, JSON.stringify(legacyRecord));
  assert.equal(a.state.drawings.recover(saved.id).status, "ok", "old records without timestamp are valid");
  const sessionText = a.session.getItem(P + "drawings:v1:session"), complete = JSON.parse(sessionText);
  for (const mutation of [{ id: "bad" }, { writer: "bad" }, { revision: -1 }, { revision: 1.5 }, { collection: null }]) {
    const raw = JSON.stringify({ ...complete, ...mutation }); a.session.setItem(P + "drawings:v1:session", raw);
    assert.equal(a.state.drawings.load().status, "unreadable"); assert.equal(a.session.getItem(P + "drawings:v1:session"), raw);
  }
  a.session.setItem(P + "drawings:v1:session", sessionText);
  assert.equal(a.state.drawings.save(collection(2), 2).ok, true); assert.equal(a.state.drawings.load().collection.objects[0].id, id(2));
});

test("truly interleaved named publications preserve both additions, rather than testing only stale sequential reads", () => {
  const a = load(), b = load(a.local); a.state.namedViews(); b.state.namedViews();
  let bResult, publications = [];
  a.local.beforeWrite = (key, text) => {
    if (!key.includes("drawing-views:v2:record:")) return;
    publications.push(JSON.parse(text));
    a.local.beforeWrite = (innerKey, innerText) => { if (innerKey.includes("drawing-views:v2:record:")) publications.push(JSON.parse(innerText)); };
    bResult = b.state.saveNamedViews([entry("B", 2)]); // A already read/built; neither A nor B sees the other's publication.
  };
  assert.equal(a.state.saveNamedViews([entry("A", 1)]).ok, true); a.local.beforeWrite = null;
  assert.equal(bResult.ok, true); assert.deepEqual(publications.map((r) => r.clock), [1, 1], "both authors saw the same pre-publication registry");
  assert.deepEqual(new Set(load(a.local).state.namedViews().map((view) => view.name)), new Set(["A", "B"]));
  assert.equal(load(a.local).state.saveNamedViews([entry("A", 1), entry("B", 2)]).ok, true);
  assert.ok(namedRecords(a.local).length <= 2, "a subsequent merged publication compacts the branches");
});

test("a truly interleaved edit and independent deletion merge; same-name conflicts use deterministic version stamps", () => {
  const seed = load(), first = [entry("A", 1), entry("B", 2)]; seed.state.saveNamedViews(first);
  const a = load(seed.local), b = load(seed.local); a.state.namedViews(); b.state.namedViews();
  seed.local.beforeWrite = (key) => { if (!key.includes("drawing-views:v2:record:")) return; seed.local.beforeWrite = null; assert.equal(b.state.saveNamedViews([first[0]]).ok, true); };
  assert.equal(a.state.saveNamedViews([entry("A", 3), first[1]]).ok, true);
  const got = plain(load(seed.local).state.namedViews()); assert.deepEqual(got, [entry("A", 3)]);
  const c = load(seed.local), d = load(seed.local); c.state.namedViews(); d.state.namedViews();
  seed.local.beforeWrite = (key) => { if (!key.includes("drawing-views:v2:record:")) return; seed.local.beforeWrite = null; assert.equal(d.state.saveNamedViews([entry("A", 5)]).ok, true); };
  assert.equal(c.state.saveNamedViews([entry("A", 4)]).ok, true);
  const candidates = namedRecords(seed.local).flatMap((r) => r.cells).filter((cell) => cell.name === "A").sort((x, y) => y.valueStamp[0] - x.valueStamp[0] || y.valueStamp[1].localeCompare(x.valueStamp[1]));
  assert.deepEqual(plain(load(seed.local).state.namedViews()), [candidates[0].value]);
});

test("named full registry history compacts across hundreds of new writers; deletions release authored payloads", () => {
  const local = new Storage();
  for (let n = 1; n <= 180; n++) {
    const document = load(local); document.state.namedViews(); assert.equal(document.state.saveNamedViews([entry("Current", n)]).ok, true);
    assert.ok(namedRecords(local).length <= 2, "obsolete full registry records must not accumulate across reloads");
  }
  const deleting = load(local); deleting.state.namedViews(); assert.equal(deleting.state.saveNamedViews([]).ok, true);
  for (let n = 181; n <= 183; n++) { const document = load(local); document.state.namedViews(); assert.equal(document.state.saveNamedViews([entry("Next", n)]).ok, true); }
  const snapshots = namedRecords(local); assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) assert.equal(snapshot.cells.find((cell) => cell.name === "Current").value, null, "delete causality is small metadata, not the deleted full payload");
  assert.ok(snapshots.every((snapshot) => !JSON.stringify(snapshot).includes(id(180))));
  assert.deepEqual(plain(load(local).state.namedViews()), [entry("Next", 183)]);
});

test("successful v1 named migration reclaims old full snapshots but retains required and unreadable originals", () => {
  const a = load(), previousId = id(900), currentId = id(901), badId = id(902), first = [entry("A", 1), legacy("B")];
  a.local.setItem(P + "drawing-views:v1:record:" + previousId, JSON.stringify({ storageVersion: 1, id: previousId, entries: [entry("Previous", 2)] }));
  a.local.setItem(P + "drawing-views:v1:record:" + currentId, JSON.stringify({ storageVersion: 1, id: currentId, entries: first }));
  a.local.setItem(P + "drawing-views:v1:record:" + badId, "{broken");
  a.local.setItem(P + "drawing-views:v1:pointer", JSON.stringify({ storageVersion: 1, id: currentId }));
  assert.deepEqual(plain(a.state.namedViews()), first);
  const originalBytes = [...a.local.map.entries()]; a.local.fail = (key) => key.includes("drawing-views:v2:record:");
  assert.equal(a.state.saveNamedViews(first).ok, false); assert.deepEqual([...a.local.map.entries()], originalBytes);
  a.local.fail = null; assert.equal(a.state.saveNamedViews(first).ok, true);
  assert.equal(a.local.getItem(P + "drawing-views:v1:record:" + previousId), null);
  assert.ok(a.local.getItem(P + "drawing-views:v1:record:" + currentId)); assert.equal(a.local.getItem(P + "drawing-views:v1:record:" + badId), "{broken");
  assert.deepEqual(plain(load(a.local).state.namedViews()), first);
});


test("cached immutable recoveries cannot be poisoned through public load/recover and rewritten raw always revalidates", () => {
  const a = load(), saved = a.state.drawings.save(collection(1), 1), returned = a.state.drawings.recover(saved.id);
  assert.throws(() => { returned.collection.objects[0].a.timeMs = T + 99; }, TypeError);
  assert.throws(() => { returned.value.collection.objects.push(collection(2).objects[0]); }, { name: "TypeError" });
  assert.deepEqual(plain(a.state.drawings.recover(saved.id).collection), collection(1));
  const key = P + "drawings:v1:record:" + saved.id, raw = JSON.parse(a.local.getItem(key)); raw.collection.objects[0].color = "#abcdef";
  a.local.setItem(key, JSON.stringify(raw)); assert.equal(a.state.drawings.recover(saved.id).collection.objects[0].color, "#abcdef");
  raw.collection.objects[0].a.timeMs = "not-time"; a.local.setItem(key, JSON.stringify(raw)); assert.equal(a.state.drawings.recover(saved.id).status, "unreadable");
  assert.equal(a.state.drawings.load().collection.objects[0].color, "#123456", "private complete session remains independent");
});

test("successive registry GC races fail explicitly instead of returning a false legacy or empty registry", () => {
  const writer = load(); writer.state.saveNamedViews([entry("Keep", 1)]); writer.state.saveNamedViews([entry("Keep", 1)]);
  const reader = load(writer.local), getItem = writer.local.getItem.bind(writer.local); let churns = 0, active = false;
  writer.local.getItem = (key) => {
    if (!active && key.includes("drawing-views:v2:record:") && getItem(key) !== null && churns < 2) {
      active = true; churns++; writer.state.saveNamedViews([entry("Keep", 1)]); writer.state.saveNamedViews([entry("Keep", 1)]); active = false;
    }
    return getItem(key);
  };
  const got = reader.state.namedViewsStatus(); assert.equal(churns, 2); assert.equal(got.status, "unreadable"); assert.match(got.reason, /retry/);
  writer.local.getItem = getItem; assert.deepEqual(plain(reader.state.namedViews()), [entry("Keep", 1)]);
});


test("ordinary saves preserve unreadable complete sessions verbatim before overwrite; backup failure preserves their original authority", () => {
  const original = load(); original.state.drawings.save(collection(1), 1);
  const complete = JSON.parse(original.session.getItem(P + "drawings:v1:session"));
  for (const raw of ["{broken session", JSON.stringify({ ...complete, storageVersion: 99, collection: { future: "authored work" } })]) {
    const a = load(); a.session.setItem(P + "drawings:v1:session", raw);
    a.local.fail = (key) => key.includes("drawings:v1:unreadable-session:");
    assert.equal(a.state.drawings.save(collection(2), 2).ok, false);
    assert.equal(a.session.getItem(P + "drawings:v1:session"), raw); assert.equal(records(a.local).length, 0);
    a.local.fail = null; a.session.fail = () => true;
    assert.equal(a.state.drawings.save(collection(2), 2).ok, false);
    assert.equal(a.state.drawings.save(collection(2), 2).ok, false);
    const backups = [...a.local.map.entries()].filter(([key]) => key.includes("drawings:v1:unreadable-session:"));
    assert.equal(backups.length, 1, "retry retains one deduplicated original rather than accumulating copies");
    assert.equal(JSON.parse(backups[0][1]).raw, raw); assert.equal(a.session.getItem(P + "drawings:v1:session"), raw);
    a.session.fail = null; assert.equal(a.state.drawings.save(collection(2), 2).ok, true);
    assert.equal(a.state.drawings.load().collection.objects[0].id, id(2));
    assert.equal(a.local.getItem(backups[0][0]), backups[0][1], "successful new work retains unreadable original bytes");
  }
});
