"use strict";
// U24b (T-store): E.store (part 13), the calibration store: per-context records ascending by the end of their
// observations, eligibility against a cutoff, the 64-context LRU with protection, tombstones, live and replay
// workspaces, and the persistence JSON (API.md B.6, C.9, DR-14, DR-16, DD-20, DD-22, A-44).
//
// Oracles (none is the code under test): hand-built timelines of commits and lookups whose answers are read off
// the rule "eligible iff obsEnd <= cut (integer milliseconds), or an explicit lock, or an external mapping"; the
// LRU order written out by hand (capacity 3: a, b, c, touch a, commit d evicts b); the limits of the header (64
// contexts, 8 records per context, 64 tombstones); the record shape of API.md B.6; descriptor ids taken from
// API.md A.2 (value-log1p {26791234.56, 48211.3} is 3s_XdONgi8CSqyOl, so a tampered record is one whose id no
// longer matches its numbers); the context key strings of API.md B.7. Records are built with E.scale and
// E.context, which are other parts' code and only SUPPLY data here.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects are of another realm, so structures
// are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;

const ctxOf = (n, extra) => E.context.cellsKey(Object.assign({ measure: "volume", n, m: 0 }, extra || {}));
const keyOf = (n, extra) => E.context.keyString(ctxOf(n, extra));
const descOf = (U, k) => E.scale.manual({ kind: "value-log1p", signed: false, U: U === undefined ? 1000 : U, k: k === undefined ? 10 : k }).descriptor;

// A Calibration (B.6) for level n observed to obsEndMs.
function cal(n, obsEndMs, over) {
  const ctx = ctxOf(n);
  return Object.assign(
    { v: 1, key: E.context.keyString(ctx), ctx, desc: descOf(), policy: "explore", origin: "fit", workspace: "live", cohort: { kind: "cells", n: 12, zeros: 0, nonzero: 12 }, obsEndMs, cutMs: obsEndMs, fittedAtMs: 77, algorithm: "value-fit@1" },
    over || {}
  );
}

// ---- create ---------------------------------------------------------------------------------------------

test("create: defaults are the header's 64 contexts and 8 records per context; bad sizes throw", () => {
  assert.equal(E.LIMITS.CONTEXTS_MAX, 64);
  assert.equal(E.LIMITS.RECORDS_PER_CONTEXT, 8);
  for (const bad of [0, -1, 1.5, "3", null]) assert.throws(() => E.store.create({ capacity: bad }), isError("TypeError"), "capacity " + String(bad));
  for (const bad of [0, 2.5, "x"]) assert.throws(() => E.store.create({ recordsPer: bad }), isError("TypeError"), "recordsPer " + String(bad));
  const s = E.store.create();
  assert.deepEqual(Object.keys(s).sort(), ["clear", "commit", "keys", "latest", "lookup", "mergeJSON", "remove", "touch", "toJSON", "wasEvicted"].sort());
  assert.ok(Object.isFrozen(s));
});

test("two stores share nothing (DD-02)", () => {
  const a = E.store.create();
  const b = E.store.create();
  a.commit("live", cal(4, 1000));
  assert.equal(b.lookup("live", keyOf(4), 5000), null);
  assert.deepEqual(plain(b.keys("live")), []);
});

// ---- commit and lookup ----------------------------------------------------------------------------------

test("commit stores a frozen copy without the session-local generation; lookup answers the newest eligible record", () => {
  const s = E.store.create();
  const r = cal(4, 1000, { generation: 9 });
  const out = s.commit("live", r);
  assert.equal(out.updated, false);
  assert.deepEqual(plain(out.evicted), []);
  assert.equal(out.overflow, false);
  assert.equal(out.record.generation, undefined, "generation is never persisted or compared across tabs");
  assert.ok(Object.isFrozen(out.record));
  assert.equal(r.generation, 9, "the caller's own object is untouched");
  const hit = s.lookup("live", keyOf(4), 1000);
  assert.equal(hit.record, out.record);
  assert.equal(hit.ineligibleNewer, false);
  assert.equal(hit.external, false);
  assert.equal(s.lookup("live", keyOf(5), 1000), null, "a miss never borrows another context's record (DR-06)");
});

test("eligibility is obsEnd <= cut in integer milliseconds: the exact cut is eligible, one millisecond earlier is not", () => {
  const s = E.store.create();
  s.commit("live", cal(4, 1790251368750));
  assert.notEqual(s.lookup("live", keyOf(4), 1790251368750), null, "obsEnd == cut");
  assert.notEqual(s.lookup("live", keyOf(4), 1790251368751), null);
  assert.equal(s.lookup("live", keyOf(4), 1790251368749), null, "one millisecond before the observation end");
  assert.notEqual(s.lookup("live", keyOf(4)), null, "no cutoff: nothing is later than it");
  assert.notEqual(s.lookup("live", keyOf(4), null), null);
  assert.throws(() => s.lookup("live", keyOf(4), NaN), isError("TypeError"));
  assert.throws(() => s.lookup("live", keyOf(4), "9"), isError("TypeError"));
});

test("a backward scrub chooses the newest record that could have existed then; newer ones are skipped and reported", () => {
  const s = E.store.create();
  s.commit("live", cal(4, 3000, { desc: descOf(3000, 30) }));
  s.commit("live", cal(4, 1000, { desc: descOf(1000, 10) }));
  s.commit("live", cal(4, 2000, { desc: descOf(2000, 20) }));
  const at = (cut) => s.lookup("live", keyOf(4), cut);
  assert.equal(at(3500).record.obsEndMs, 3000);
  assert.equal(at(3500).ineligibleNewer, false);
  assert.equal(at(2500).record.obsEndMs, 2000);
  assert.equal(at(2500).ineligibleNewer, true);
  assert.equal(at(1500).record.obsEndMs, 1000);
  assert.equal(at(1500).ineligibleNewer, true);
  assert.equal(at(999), null);
  assert.equal(s.latest("live", keyOf(4)).obsEndMs, 3000, "latest ignores the cutoff (the page shows it only if eligible)");
  assert.equal(s.latest("live", keyOf(9)), null);
});

test("explicit locks and external mappings are exempt from invalidation and flagged when they reach past the cutoff (A-19)", () => {
  const s = E.store.create();
  s.commit("live", cal(4, 5000, { policy: "comparison" }));
  const held = s.lookup("live", keyOf(4), 1000);
  assert.equal(held.record.obsEndMs, 5000);
  assert.equal(held.external, true);
  assert.equal(s.lookup("live", keyOf(4), 5000).external, false, "not past the cutoff: not flagged");
  s.commit("live", cal(5, 5000, { origin: "external" }));
  assert.equal(s.lookup("live", keyOf(5), 1000).external, true);
  // an implicit record of the same age is invalidated
  s.commit("live", cal(6, 5000, { policy: "auto" }));
  assert.equal(s.lookup("live", keyOf(6), 1000), null);
});

test("a refit to identical numbers is not a new record: same descriptor id and obsEnd only move the cutoff", () => {
  const s = E.store.create();
  s.commit("live", cal(4, 1000, { cutMs: 1000, fittedAtMs: 1 }));
  const again = s.commit("live", cal(4, 1000, { cutMs: 1060, fittedAtMs: 2 }));
  assert.equal(again.updated, true);
  assert.equal(plain(s.toJSON().contexts[0].records).length, 1);
  assert.equal(s.latest("live", keyOf(4)).cutMs, 1060);
  assert.equal(s.latest("live", keyOf(4)).fittedAtMs, 2);
  assert.equal(s.latest("live", keyOf(4)).desc.id, descOf().id);
  // a different descriptor at the same end, or the same descriptor at a later end, is a new record
  s.commit("live", cal(4, 1000, { desc: descOf(2000, 20) }));
  s.commit("live", cal(4, 1001));
  assert.equal(plain(s.toJSON().contexts[0].records).length, 3);
  // an update that carries no cutoff keeps the one it has
  s.commit("live", (() => { const r = cal(4, 1001); delete r.cutMs; delete r.fittedAtMs; return r; })());
  assert.equal(s.latest("live", keyOf(4)).cutMs, 1001);
});

test("records of a context are kept ascending by obsEnd whatever order they arrive in, at most `recordsPer` of the newest", () => {
  const s = E.store.create({ recordsPer: 3 });
  for (const t of [5, 3, 4, 1, 2]) s.commit("live", cal(4, t * 100, { desc: descOf(t * 100, t) }));
  const ends = plain(s.toJSON().contexts[0].records).map((r) => r.obsEndMs);
  assert.deepEqual(ends, [300, 400, 500], "the two oldest were dropped");
  assert.equal(E.LIMITS.RECORDS_PER_CONTEXT, 8);
  const d = E.store.create();
  for (let t = 1; t <= 10; t++) d.commit("live", cal(4, t * 100, { desc: descOf(t * 100, t) }));
  assert.deepEqual(plain(d.toJSON().contexts[0].records).map((r) => r.obsEndMs), [300, 400, 500, 600, 700, 800, 900, 1000]);
});

test("two records with the same observation end but different mappings: the later commit is the newest", () => {
  const s = E.store.create();
  s.commit("live", cal(4, 100, { desc: descOf(10, 1) }));
  s.commit("live", cal(4, 100, { desc: descOf(20, 2) }));
  assert.equal(s.latest("live", keyOf(4)).desc.params.U, 20);
  assert.equal(s.lookup("live", keyOf(4), 100).record.desc.params.U, 20);
  assert.deepEqual(plain(s.toJSON().contexts[0].records.map((r) => r.desc.params.U)), [10, 20]);
});

test("what cannot be stored throws: No calibration, a key that is not the context's, a foreign workspace, no obsEnd", () => {
  const s = E.store.create();
  assert.throws(() => s.commit("live", cal(4, 1, { desc: { v: 1, id: "x", kind: "none", signed: false, params: null, clip: "clamp01@1" } })), isError("RangeError"));
  assert.throws(() => s.commit("live", cal(4, 1, { key: "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n9m9" })), isError("RangeError"));
  assert.throws(() => s.commit("live", cal(4, 1, { workspace: "replay" })), isError("RangeError"));
  assert.throws(() => s.commit("live", cal(4, NaN)), isError("TypeError"));
  assert.throws(() => s.commit("live", cal(4, 1, { key: "" })), isError("TypeError"));
  assert.throws(() => s.commit("live", null), isError("TypeError"));
  assert.throws(() => s.commit("both", cal(4, 1)), isError("RangeError"));
  assert.deepEqual(plain(s.keys("live")), []);
});

// ---- the LRU --------------------------------------------------------------------------------------------

test("LRU: capacity 3, a b c, a is used, d arrives: b (the least recently used) is evicted and remembered", () => {
  const s = E.store.create({ capacity: 3 });
  for (const n of [1, 2, 3]) s.commit("live", cal(n, 100));
  assert.deepEqual(plain(s.keys("live")), [keyOf(1), keyOf(2), keyOf(3)], "least recently used first");
  assert.equal(s.touch("live", keyOf(1)), true);
  assert.equal(s.touch("live", keyOf(9)), false);
  assert.deepEqual(plain(s.keys("live")), [keyOf(2), keyOf(3), keyOf(1)]);
  const out = s.commit("live", cal(4, 100));
  assert.deepEqual(plain(out.evicted), [keyOf(2)]);
  assert.equal(out.overflow, false);
  assert.equal(s.wasEvicted("live", keyOf(2)), true);
  assert.equal(s.wasEvicted("live", keyOf(3)), false);
  assert.deepEqual(plain(s.keys("live")), [keyOf(3), keyOf(1), keyOf(4)]);
  assert.equal(s.lookup("live", keyOf(2), 1000), null);
});

test("a lookup counts as use: reading a context keeps it alive", () => {
  const s = E.store.create({ capacity: 2 });
  s.commit("live", cal(1, 100));
  s.commit("live", cal(2, 100));
  s.lookup("live", keyOf(1), 100);
  const out = s.commit("live", cal(3, 100));
  assert.deepEqual(plain(out.evicted), [keyOf(2)]);
  // even a lookup that finds nothing ELIGIBLE uses the entry: it is the context on screen
  s.lookup("live", keyOf(1), 1);
  assert.deepEqual(plain(s.keys("live")).slice(-1), [keyOf(1)]);
});

test("the 65th context evicts the oldest inactive one (capacity 64 by default)", () => {
  const s = E.store.create();
  for (let n = 0; n < 64; n++) s.commit("live", cal(n, 100));
  assert.equal(s.keys("live").length, 64);
  const out = s.commit("live", cal(64, 100));
  assert.deepEqual(plain(out.evicted), [keyOf(0)]);
  assert.equal(s.keys("live").length, 64);
  assert.equal(s.wasEvicted("live", keyOf(0)), true);
  assert.equal(s.wasEvicted("live", keyOf(1)), false);
});

test("active and held contexts are never evicted: the store skips them and evicts the next oldest", () => {
  const s = E.store.create({ capacity: 3 });
  for (const n of [1, 2, 3]) s.commit("live", cal(n, 100));
  const out = s.commit("live", cal(4, 100), () => new Set([keyOf(1), keyOf(2)]));
  assert.deepEqual(plain(out.evicted), [keyOf(3)]);
  assert.equal(out.overflow, false);
  assert.deepEqual(plain(s.keys("live")).sort(), [keyOf(1), keyOf(2), keyOf(4)].sort());
  // protect may also be a Set or an array
  const s2 = E.store.create({ capacity: 2 });
  s2.commit("live", cal(1, 1));
  s2.commit("live", cal(2, 1));
  assert.deepEqual(plain(s2.commit("live", cal(3, 1), new Set([keyOf(1)])).evicted), [keyOf(2)]);
  assert.deepEqual(plain(s2.commit("live", cal(4, 1), [keyOf(1), keyOf(3)]).evicted), [], "everything else is protected");
});

test("all-protected overflow: the store exceeds its capacity, evicts nothing, and says so", () => {
  const s = E.store.create({ capacity: 2 });
  s.commit("live", cal(1, 1));
  s.commit("live", cal(2, 1));
  const out = s.commit("live", cal(3, 1), () => [keyOf(1), keyOf(2)]);
  assert.deepEqual(plain(out.evicted), []);
  assert.equal(out.overflow, true);
  assert.equal(s.keys("live").length, 3);
  assert.equal(s.wasEvicted("live", keyOf(1)), false);
  // the entry just committed is always protected: with nothing else protected it survives its own commit
  const t = E.store.create({ capacity: 1 });
  t.commit("live", cal(1, 1));
  assert.deepEqual(plain(t.commit("live", cal(2, 1)).evicted), [keyOf(1)]);
  assert.deepEqual(plain(t.keys("live")), [keyOf(2)]);
});

test("tombstones: a ring of 64 evicted keys; committing a key again removes it (disclosure: 'initialised after eviction')", () => {
  const s = E.store.create({ capacity: 1 });
  for (let n = 0; n < 70; n++) s.commit("live", cal(n, 1));
  // 69 evictions (contexts 0..68 in order); the ring keeps the last 64: contexts 5..68
  assert.equal(s.wasEvicted("live", keyOf(4)), false, "the oldest tombstones fell off the ring");
  assert.equal(s.wasEvicted("live", keyOf(5)), true);
  assert.equal(s.wasEvicted("live", keyOf(68)), true);
  assert.equal(s.wasEvicted("live", keyOf(69)), false, "the context still present");
  assert.equal(E.LIMITS.TOMBSTONES_MAX, 64);
  s.commit("live", cal(30, 1));
  assert.equal(s.wasEvicted("live", keyOf(30)), false, "present again (the ring's oldest entry is context 5, so it is not the ring shifting that cleared it)");
  assert.equal(s.wasEvicted("live", keyOf(31)), true);
  assert.equal(s.wasEvicted("live", keyOf(69)), true, "the context evicted by this commit");
});

test("remove and clear drop entries without tombstones; clear(ws) touches only that workspace", () => {
  const s = E.store.create();
  s.commit("live", cal(1, 1));
  s.commit("live", cal(2, 1));
  s.commit("replay", cal(1, 1, { workspace: "replay" }));
  assert.equal(s.remove("live", keyOf(1)), true);
  assert.equal(s.remove("live", keyOf(1)), false);
  assert.equal(s.wasEvicted("live", keyOf(1)), false, "removal is not eviction");
  s.clear("replay");
  assert.equal(s.keys("replay").length, 0);
  assert.equal(s.keys("live").length, 1);
  s.clear();
  assert.equal(s.keys("live").length, 0);
  assert.throws(() => s.clear("both"), isError("RangeError"));
});

// ---- live and replay workspaces ---------------------------------------------------------------------------

test("live and replay are separate stores: nothing written in replay reaches live, and leaving replay restores live untouched", () => {
  const s = E.store.create();
  s.commit("live", cal(4, 1000, { desc: descOf(900, 9) }));
  const liveBefore = JSON.stringify(s.toJSON("live"));
  s.commit("replay", cal(4, 500, { workspace: "replay", desc: descOf(50, 5) }));
  s.commit("replay", cal(7, 500, { workspace: "replay" }));
  assert.equal(s.lookup("replay", keyOf(4), 500).record.desc.params.U, 50);
  assert.equal(s.lookup("live", keyOf(4), 1000).record.desc.params.U, 900);
  assert.equal(s.lookup("live", keyOf(7), 1000), null);
  assert.equal(JSON.stringify(s.toJSON("live")), liveBefore, "live is byte-identical after replay activity");
  s.clear("replay");
  assert.equal(JSON.stringify(s.toJSON("live")), liveBefore, "and after leaving replay");
  assert.equal(s.lookup("replay", keyOf(4), 500), null);
  // LRU pressure in one workspace never evicts the other's
  const t = E.store.create({ capacity: 1 });
  t.commit("live", cal(1, 1));
  t.commit("replay", cal(1, 1, { workspace: "replay" }));
  t.commit("replay", cal(2, 1, { workspace: "replay" }));
  assert.deepEqual(plain(t.keys("live")), [keyOf(1)]);
});

test("a record made for one workspace cannot be committed to the other (the fit's workspace is captured at request time)", () => {
  const s = E.store.create();
  assert.throws(() => s.commit("replay", cal(4, 1, { workspace: "live" })), isError("RangeError"));
  assert.throws(() => s.commit("live", cal(4, 1, { workspace: "replay" })), isError("RangeError"));
});

// ---- toJSON / mergeJSON -----------------------------------------------------------------------------------

test("toJSON: {visualVersion 2, contexts least recently used first}, records without `generation`, JSON-safe, at most 64 contexts", () => {
  const s = E.store.create();
  s.commit("live", cal(1, 100, { generation: 4 }));
  s.commit("live", cal(2, 100));
  s.touch("live", keyOf(1));
  const j = plain(s.toJSON());
  assert.equal(j.visualVersion, 2);
  assert.deepEqual(j.contexts.map((c) => c.key), [keyOf(2), keyOf(1)]);
  assert.equal(j.contexts[0].records.length, 1);
  assert.equal(JSON.stringify(j).indexOf("generation"), -1);
  assert.doesNotThrow(() => E.result.assertJsonSafe(s.toJSON()));
  assert.equal(j.contexts[0].ctx.n, 2);
  // over capacity because of protection: only the `capacity` most recently used are written
  const big = E.store.create({ capacity: 2 });
  for (const n of [1, 2, 3]) big.commit("live", cal(n, 1), () => [keyOf(1), keyOf(2), keyOf(3)]);
  assert.equal(big.keys("live").length, 3);
  assert.deepEqual(plain(big.toJSON().contexts.map((c) => c.key)), [keyOf(2), keyOf(3)]);
  assert.deepEqual(plain(E.store.create().toJSON()), { visualVersion: 2, contexts: [] });
});

test("mergeJSON restores what toJSON wrote, in the same use order, through a JSON round trip", () => {
  const a = E.store.create();
  for (const n of [1, 2, 3]) a.commit("live", cal(n, 100 * n, { desc: descOf(100 * n, n) }));
  a.touch("live", keyOf(1));
  const json = JSON.parse(JSON.stringify(a.toJSON()));
  const b = E.store.create();
  const out = b.mergeJSON(json);
  assert.equal(out.rejected, null);
  assert.equal(out.added, 3);
  assert.deepEqual(plain(out.skipped), []);
  assert.deepEqual(plain(b.keys("live")), plain(a.keys("live")));
  for (const n of [1, 2, 3]) assert.deepEqual(plain(b.lookup("live", keyOf(n), 1e6).record), plain(a.lookup("live", keyOf(n), 1e6).record), "context " + n);
  assert.equal(JSON.stringify(b.toJSON()), JSON.stringify(a.toJSON()));
});

test("mergeJSON is a union in which this tab wins per key; contexts it lacks arrive as the OLDEST in use order", () => {
  const stored = E.store.create();
  stored.commit("live", cal(1, 100, { desc: descOf(111, 1) }));
  stored.commit("live", cal(2, 100, { desc: descOf(222, 2) }));
  const json = JSON.parse(JSON.stringify(stored.toJSON()));
  const mine = E.store.create({ capacity: 3 });
  mine.commit("live", cal(2, 100, { desc: descOf(999, 9) }));
  mine.commit("live", cal(3, 100));
  const out = mine.mergeJSON(json);
  assert.equal(out.added, 1, "context 2 is this tab's own and is kept");
  assert.equal(mine.latest("live", keyOf(2)).desc.params.U, 999);
  assert.equal(mine.latest("live", keyOf(1)).desc.params.U, 111);
  // under pressure the merged-in context goes first, not this tab's own
  const evict = mine.commit("live", cal(4, 100));
  assert.deepEqual(plain(evict.evicted), [keyOf(1)]);
  // preferIncoming (an explicit import) replaces
  const other = E.store.create();
  other.commit("live", cal(2, 100, { desc: descOf(5, 1) }));
  assert.equal(other.mergeJSON(json, { preferIncoming: true }).added, 2);
  assert.equal(other.lookup("live", keyOf(2), 1e6).record.desc.params.U, 222);
});

test("mergeJSON rejects a whole payload of another version and PRESERVES it verbatim (DR-14)", () => {
  const s = E.store.create();
  s.commit("live", cal(1, 100));
  const before = JSON.stringify(s.toJSON());
  for (const bad of [{ visualVersion: 3, contexts: [] }, { visualVersion: 1, contexts: [] }, { contexts: [] }, { visualVersion: "2", contexts: [] }, { visualVersion: 2 }, { visualVersion: 2, contexts: "x" }]) {
    const out = s.mergeJSON(bad);
    assert.equal(typeof out.rejected, "string", JSON.stringify(bad));
    assert.equal(out.preserve, bad, "the raw payload is handed back untouched");
    assert.equal(out.added, 0);
  }
  for (const notObject of [null, undefined, 5, "x", []]) assert.equal(typeof s.mergeJSON(notObject).rejected, "string");
  assert.equal(JSON.stringify(s.toJSON()), before, "nothing changed");
  const tooMany = { visualVersion: 2, contexts: new Array(65).fill(0).map((_, i) => ({ key: "k" + i })) };
  assert.match(s.mergeJSON(tooMany).rejected, /65 contexts/);
  assert.equal(E.store.create({ capacity: 2 }).mergeJSON({ visualVersion: 2, contexts: [1, 2, 3] }).preserve.contexts.length, 3);
});

test("mergeJSON trusts nothing: a context or record that fails validation is skipped and named, the rest still load", () => {
  const src = E.store.create();
  for (const n of [1, 2, 3, 4, 5, 6, 7]) src.commit("live", cal(n, 100));
  const json = JSON.parse(JSON.stringify(src.toJSON()));
  const at = (n) => json.contexts.findIndex((c) => c.key === keyOf(n));
  // 1: the descriptor's numbers were changed and its id no longer matches
  json.contexts[at(1)].records[0].desc.params.U = 2000;
  // 2: 256 knots instead of 257
  json.contexts[at(2)].records[0].desc = E.scale.fitRank([1, 2, 3, 4]).descriptor;
  json.contexts[at(2)].records[0].desc = JSON.parse(JSON.stringify(json.contexts[at(2)].records[0].desc));
  json.contexts[at(2)].records[0].desc.params.knots.pop();
  // 3: obsEndMs is not a number
  json.contexts[at(3)].records[0].obsEndMs = "soon";
  // 4: the key is not the key string of the context
  json.contexts[at(4)].ctx.n = 9;
  // 5: unknown policy
  json.contexts[at(5)].records[0].policy = "sometimes";
  // 6: a NaN smuggled in (not JSON-safe once it is a real number)
  json.contexts[at(6)].records[0].cohort.n = NaN;
  // 7: fine
  const dst = E.store.create();
  const out = dst.mergeJSON(json);
  assert.equal(out.rejected, null);
  assert.equal(out.added, 1);
  assert.deepEqual(plain(dst.keys("live")), [keyOf(7)]);
  assert.deepEqual(plain(out.skipped.map((x) => x.key)).sort(), [1, 2, 3, 4, 5, 6].map((n) => keyOf(n)).sort());
  const why = (n) => out.skipped.find((x) => x.key === keyOf(n)).reason;
  assert.match(why(1), /id does not match/);
  assert.match(why(2), /knots/);
  assert.match(why(3), /obsEndMs/);
  assert.match(why(4), /key/);
  assert.match(why(5), /policy/);
  assert.match(why(6), /JSON-safe|NaN/);
});

test("mergeJSON refuses records of another workspace, kind none, too many records per context, and contexts without a record list", () => {
  const src = E.store.create();
  src.commit("live", cal(1, 100));
  const good = JSON.parse(JSON.stringify(src.toJSON()));
  const mk = (mutate) => {
    const j = JSON.parse(JSON.stringify(good));
    mutate(j.contexts[0]);
    return E.store.create().mergeJSON(j);
  };
  assert.match(mk((c) => { c.records[0].workspace = "replay"; }).skipped[0].reason, /replay/);
  assert.match(mk((c) => { c.records[0].desc = { v: 1, id: "x", kind: "none", signed: false, params: null, clip: "clamp01@1" }; }).skipped[0].reason, /never stored/);
  assert.match(mk((c) => { c.records = []; }).skipped[0].reason, /records/);
  assert.match(mk((c) => { delete c.records; }).skipped[0].reason, /records/);
  assert.match(mk((c) => { c.records = new Array(9).fill(c.records[0]); }).skipped[0].reason, /more than 8 records/);
  assert.match(mk((c) => { delete c.ctx; }).skipped[0].reason, /context/);
  assert.equal(mk((c) => { c.records[0].extra = 1; }).added, 1, "unknown extra fields are harmless");
});

test("mergeJSON runs the caller's own validator on every record; a record it refuses is skipped with its reason", () => {
  const src = E.store.create();
  src.commit("live", cal(1, 100));
  src.commit("live", cal(2, 100));
  const json = JSON.parse(JSON.stringify(src.toJSON()));
  const dst = E.store.create();
  const out = dst.mergeJSON(json, { validate: (r) => (r.ctx.n === 1 ? { ok: false, reason: "no level 1 here" } : true) });
  assert.equal(out.added, 1);
  assert.deepEqual(plain(out.skipped), [{ key: keyOf(1), reason: "no level 1 here" }]);
  const dst2 = E.store.create();
  assert.equal(dst2.mergeJSON(json, { validate: () => false }).added, 0);
});

test("mergeJSON into the replay workspace is allowed only for records made for it", () => {
  const src = E.store.create();
  src.commit("replay", cal(1, 100, { workspace: "replay" }));
  const json = JSON.parse(JSON.stringify(src.toJSON("replay")));
  const dst = E.store.create();
  assert.equal(dst.mergeJSON(json).added, 0, "a replay record is not stored in live");
  assert.equal(dst.mergeJSON(json, { workspace: "replay" }).added, 1);
  assert.equal(dst.keys("replay").length, 1);
});

test("mergeJSON keeps the capacity: incoming contexts beyond it are evicted oldest-first and named, this tab's own stay", () => {
  const theirs = E.store.create();
  for (const n of [10, 11, 12]) theirs.commit("live", cal(n, 1));
  const json = JSON.parse(JSON.stringify(theirs.toJSON()));
  const mine = E.store.create({ capacity: 3 });
  mine.commit("live", cal(1, 1));
  mine.commit("live", cal(2, 1));
  const out = mine.mergeJSON(json);
  assert.equal(out.added, 3);
  assert.deepEqual(plain(out.evicted), [keyOf(10), keyOf(11)]);
  assert.deepEqual(plain(mine.keys("live")), [keyOf(12), keyOf(1), keyOf(2)]);
  // `protect` names contexts the merge must not evict either
  const again = E.store.create({ capacity: 3 });
  again.commit("live", cal(1, 1));
  again.commit("live", cal(2, 1));
  const kept = again.mergeJSON(json, { protect: [keyOf(10)] });
  assert.deepEqual(plain(kept.evicted), [keyOf(11), keyOf(12)]);
});
