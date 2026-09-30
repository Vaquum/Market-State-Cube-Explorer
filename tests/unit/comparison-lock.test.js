"use strict";
// U26 (T-policy): Comparison lock (API.md C.8, C.9, DR-07, DD-18, DD-22, DD-65, S1-101..106, S1-109/110, S1-143):
// ONE action that holds each enabled colour mapping per compatibility class, freezes each displayed Auto axis at
// its displayed domain, stores a resume policy and suspends Auto; Fit while locked replaces the held mapping and
// stays locked; an incompatible change falls back to Explore with a visible reason; explicit locks are exempt from
// the replay invalidation and flagged external.
//
// Oracles (none is the code under test): the held-mapping keys of API.md B.8 and DD-65 written out as strings
// (`c|amount.usdt|log1p|u|-` for Cells Amount, `r|amount.usdt|log1p|u|-` for Rows Amount: the same class held
// SEPARATELY under two channels); the compatibility reasons of C.8 as a table (Volume vs Trades "different formula
// family", Volume Amount vs Intensity "amount vs intensity", Value vs rank or linear "different transform", a
// formula version mismatch "different formula version"), each with its English of INTEGRATION.md D.11; the
// limit of 8 held mappings (LIMITS.HELD_MAX, header); the mapping id of API.md A.2. Contexts and descriptors are
// built with E.context and E.scale, which only SUPPLY data here.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects are of another realm, so structures
// are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => JSON.parse(JSON.stringify(E.policy.DEFAULTS));
const withPrefs = (over) => Object.assign(fresh(), over);
const red = (scale, action, env) => E.policy.reduce(scale, action, env);

const cellsCtx = E.context.cellsKey({ measure: "volume", n: 4, m: 0 });
const rowsCtx = E.context.rowsKey({ measure: "volume", period: "roll:90", rowSize: 3 });
const CELLS_KEY = "c|amount.usdt|log1p|u|-";
const ROWS_KEY = "r|amount.usdt|log1p|u|-";
const desc = (U, k) => E.scale.manual({ kind: "value-log1p", signed: false, U, k }).descriptor;

function calOf(ctx, obsEndMs, over) {
  return Object.assign({ v: 1, key: E.context.keyString(ctx), ctx, desc: desc(1000, 10), policy: "explore", origin: "fit", workspace: "live", cohort: { kind: ctx.consumer, n: 40, zeros: 1, nonzero: 39 }, obsEndMs, cutMs: obsEndMs }, over || {});
}

const activeC = calOf(cellsCtx, 1000, { desc: desc(26791234.56, 48211.3) });
const activeR = calOf(rowsCtx, 1000, { desc: desc(5000, 50) });
const AXES = [
  { id: "pane.volume", domain: [0, 1920000000], through: 1000 },
  { id: "pane.delta", domain: [-5, 5] },
];
const LOCK_ENV = { mode: "volume", rows: "volume", live: true, active: { cells: activeC, rows: activeR }, axes: AXES };

// ---- the lock is ONE action -------------------------------------------------------------------------------

test("lock: one action holds each enabled colour mapping under channel|class, freezes the displayed axes, stores the resume policy, suspends Auto", () => {
  const scale = withPrefs({ cells: "auto", rows: "explore" });
  const before = JSON.stringify(scale);
  const out = red(scale, { type: "lock" }, LOCK_ENV);
  assert.equal(out.rejected, null);
  assert.equal(JSON.stringify(scale), before, "the input is not mutated");
  const s = plain(out.scale);
  assert.equal(s.lock, true);
  assert.deepEqual(s.resume, { cells: "auto", rows: "explore" });
  assert.equal(s.cells, "explore", "Auto colour is suspended while locked");
  assert.equal(s.rows, "explore");
  // Cells Amount and Rows Amount share a class, and are held SEPARATELY (DD-65)
  assert.deepEqual(Object.keys(s.held).sort(), [CELLS_KEY, ROWS_KEY]);
  assert.equal(s.held[CELLS_KEY].desc.id, "3s_XdONgi8CSqyOl", "the active Cells mapping of API.md A.2");
  assert.equal(s.held[ROWS_KEY].desc.id, activeR.desc.id);
  assert.notEqual(s.held[CELLS_KEY].desc.id, s.held[ROWS_KEY].desc.id);
  for (const k of [CELLS_KEY, ROWS_KEY]) {
    assert.equal(s.held[k].policy, "comparison", k);
    assert.equal(s.held[k].origin, "fit", "the origin of the fit is kept");
  }
  assert.equal(s.held[CELLS_KEY].ctx.consumer, "cells");
  assert.equal(s.held[ROWS_KEY].ctx.consumer, "rows");
  // the original support travels with the held mapping (C.8: original and current support)
  assert.deepEqual(s.held[CELLS_KEY].cohort, { kind: "cells", n: 40, zeros: 1, nonzero: 39 });
  assert.equal(s.held[CELLS_KEY].obsEndMs, 1000);
  assert.deepEqual(s.frozen, { "pane.volume": { lo: 0, hi: 1920000000 }, "pane.delta": { lo: -5, hi: 5 } });
  assert.deepEqual(plain(out.effects), [
    { type: "invalidate", channel: "all" },
    { type: "freeze-axis", id: "pane.volume", domain: [0, 1920000000], through: 1000 },
    { type: "freeze-axis", id: "pane.delta", domain: [-5, 5], through: null },
  ]);
  assert.deepEqual(plain(out.notices), []);
});

test("lock holds only what is enabled and unbounded: fixed and unavailable channels are not held; with nothing active the lock still engages", () => {
  const fixed = Object.assign({}, activeC, { desc: E.scale.fixed("share-diverging") });
  const onlyRows = red(fresh(), { type: "lock" }, { mode: "flow", rows: "volume", live: true, active: { cells: fixed, rows: activeR } });
  assert.deepEqual(Object.keys(plain(onlyRows.scale.held)), [ROWS_KEY]);
  const none = red(fresh(), { type: "lock" }, { mode: "volume", rows: "volume" });
  assert.equal(none.scale.lock, true);
  assert.deepEqual(plain(none.scale.held), {});
  assert.deepEqual(plain(none.scale.frozen), {});
  assert.deepEqual(plain(none.effects), [{ type: "invalidate", channel: "all" }]);
  // a record with no descriptor or a "No calibration" one is skipped, not an error
  const skip = red(fresh(), { type: "lock" }, { active: { cells: { desc: { kind: "none" } }, rows: null } });
  assert.deepEqual(plain(skip.scale.held), {});
  // an axis entry that is malformed is skipped
  assert.deepEqual(Object.keys(plain(red(fresh(), { type: "lock" }, { axes: [{ id: "a", domain: [0, 1] }, { id: "b" }, null, { domain: [0, 1] }] }).scale.frozen)), ["a"]);
});

test("lock twice is a no-op; a lock that would hold more than the limit of 8 mappings is refused with the limit notice", () => {
  const locked = red(fresh(), { type: "lock" }, LOCK_ENV).scale;
  const again = red(locked, { type: "lock" }, LOCK_ENV);
  assert.equal(again.scale, locked);
  assert.deepEqual(plain(again.effects), []);
  assert.equal(E.LIMITS.HELD_MAX, 8);
  const held = {};
  for (let i = 0; i < 8; i++) held["c|manual.class" + i + "|log1p|u|-"] = { origin: "manual" };
  const scale = withPrefs({ held });
  const refused = red(scale, { type: "lock" }, LOCK_ENV);
  assert.equal(refused.scale, scale);
  assert.equal(refused.rejected.item, "lock");
  assert.equal(refused.rejected.reason, "The view has more than 8 active scales. Release one before adding another.");
  assert.deepEqual(plain(refused.notices), [{ code: "limit", params: { max: 8 } }]);
});

test("a manual domain the person set stays as it is: the lock holds what was ACTIVE, not over a manual hold", () => {
  const manual = Object.assign(calOf(cellsCtx, 5, { origin: "manual", policy: "comparison", desc: desc(123, 3) }));
  const scale = withPrefs({ held: { [CELLS_KEY]: manual } });
  const out = red(scale, { type: "lock" }, LOCK_ENV);
  assert.equal(out.scale.held[CELLS_KEY], manual, "untouched");
  assert.equal(plain(out.scale.held[ROWS_KEY]).desc.id, activeR.desc.id);
});

// ---- unlock ---------------------------------------------------------------------------------------------

test("unlock restores each channel's prior policy, removes what the lock held, keeps manual domains, unfreezes the axes", () => {
  const manual = Object.assign(calOf(cellsCtx, 5, { origin: "manual", policy: "comparison", desc: desc(123, 3) }));
  const start = withPrefs({ cells: "auto", rows: "auto", held: { "c|size.usdt-per-trade|log1p|u|-": manual } });
  const locked = red(start, { type: "lock" }, LOCK_ENV).scale;
  assert.equal(Object.keys(locked.held).length, 3);
  const out = red(locked, { type: "unlock" }, LOCK_ENV);
  const s = plain(out.scale);
  assert.equal(s.lock, false);
  assert.equal(s.resume, null);
  assert.equal(s.cells, "auto");
  assert.equal(s.rows, "auto");
  assert.deepEqual(Object.keys(s.held), ["c|size.usdt-per-trade|log1p|u|-"], "only the manual one stays");
  assert.deepEqual(s.frozen, {});
  assert.deepEqual(plain(out.effects), [{ type: "invalidate", channel: "all" }, { type: "unfreeze-axis", id: "pane.volume" }, { type: "unfreeze-axis", id: "pane.delta" }]);
  assert.equal(red(start, { type: "unlock" }, {}).scale, start, "unlock when not locked is a no-op");
});

test("lock then unlock returns the preferences exactly (the round trip leaves nothing behind)", () => {
  const start = withPrefs({ basis: "intensity", transform: "rank", cells: "auto", rows: "auto", local: true, window: [0.45, 0.55] });
  const back = red(red(start, { type: "lock" }, LOCK_ENV).scale, { type: "unlock" }, LOCK_ENV).scale;
  assert.deepEqual(plain(back), plain(start));
});

test("unlock with a missing or damaged resume policy falls back to Explore, never to a wrong value", () => {
  const damaged = withPrefs({ lock: true, resume: { cells: "bogus" }, cells: "explore", rows: "explore" });
  const out = red(damaged, { type: "unlock" }, {}).scale;
  assert.equal(out.cells, "explore");
  assert.equal(out.rows, "explore");
  const none = withPrefs({ lock: true, resume: null });
  assert.equal(red(none, { type: "unlock" }, {}).scale.lock, false);
});

// ---- Auto is suspended ------------------------------------------------------------------------------------

test("while locked Auto colour is withheld: the policy action is rejected with the 'Auto paused: comparison lock' label, Explore is a no-op", () => {
  const locked = red(fresh(), { type: "lock" }, LOCK_ENV).scale;
  const a = red(locked, { type: "policy", channel: "cells", value: "auto" }, LOCK_ENV);
  assert.equal(a.scale, locked);
  assert.equal(a.rejected.reason, "Auto paused: comparison lock");
  assert.equal(red(locked, { type: "policy", channel: "rows", value: "auto" }, LOCK_ENV).rejected.item, "policy.auto");
  assert.equal(red(locked, { type: "policy", channel: "cells", value: "explore" }, LOCK_ENV).scale, locked);
});

// ---- Fit while locked -------------------------------------------------------------------------------------

test("Fit while locked asks for a fit flagged locked; the page then replaces the held mapping with `hold` and the lock stays on", () => {
  const locked = red(fresh(), { type: "lock" }, LOCK_ENV).scale;
  const fit = red(locked, { type: "fit", channel: "cells" }, LOCK_ENV);
  assert.deepEqual(plain(fit.effects), [{ type: "request-fit", channel: "cells", kind: "fit", locked: true }, { type: "invalidate", channel: "cells" }]);
  assert.equal(fit.scale.lock, true);
  const refit = calOf(cellsCtx, 2000, { desc: desc(9999, 99) });
  const out = red(locked, { type: "hold", channel: "cells", record: refit }, LOCK_ENV);
  assert.equal(out.scale.lock, true, "stays locked");
  const s = plain(out.scale);
  assert.equal(s.held[CELLS_KEY].desc.params.U, 9999, "the held mapping is replaced");
  assert.equal(s.held[CELLS_KEY].policy, "comparison");
  assert.equal(s.held[CELLS_KEY].obsEndMs, 2000);
  assert.equal(s.held[ROWS_KEY].desc.id, activeR.desc.id, "the other channel's hold is untouched");
  assert.equal(Object.keys(s.held).length, 2);
  assert.deepEqual(plain(out.effects), [{ type: "invalidate", channel: "cells" }]);
  // not locked and not manual: there is nothing to hold
  const no = red(fresh(), { type: "hold", channel: "cells", record: refit }, {});
  assert.equal(no.rejected.item, "hold");
  assert.throws(() => red(locked, { type: "hold", channel: "cells", record: { desc: refit.desc } }, {}), (e) => e.name === "TypeError");
});

// ---- resolve under the lock -----------------------------------------------------------------------------

function lockedScale() {
  return red(withPrefs({ cells: "auto" }), { type: "lock" }, LOCK_ENV).scale;
}

function resolveWith(ctx, over) {
  return E.policy.resolve(Object.assign({ channel: "c", ctx, scale: lockedScale(), store: E.store.create(), workspace: "live", cutMs: 2000 }, over));
}

test("a held mapping is used for the same class at another level: levels, periods and consumers may differ (S1-102)", () => {
  const n7 = E.context.cellsKey({ measure: "volume", n: 7, m: 2 });
  const r = resolveWith(n7);
  assert.equal(r.state, "ok");
  assert.equal(r.policy, "comparison");
  assert.equal(r.id, "3s_XdONgi8CSqyOl");
  assert.equal(r.origin, "fit");
  assert.equal(r.fallback, null);
  assert.equal(r.key, "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n7m2");
  assert.equal(r.record.cohort.n, 40, "the original support is still on the record");
  // Rows at another period
  const other = E.context.rowsKey({ measure: "volume", period: "cal:mo:2026-10-01", rowSize: 5 });
  const rr = resolveWith(other, { channel: "r" });
  assert.equal(rr.state, "ok");
  assert.equal(rr.id, activeR.desc.id);
  assert.equal(rr.policy, "comparison");
  // a replay workspace uses the same held mapping: the lock is not per workspace
  assert.equal(resolveWith(n7, { workspace: "replay" }).id, "3s_XdONgi8CSqyOl");
});

test("Cells and Rows hold separately: the Rows channel never reads the Cells hold, and the Cells channel never the Rows one (DD-65)", () => {
  const onlyCells = withPrefs({ lock: true, resume: { cells: "explore", rows: "explore" }, held: { [CELLS_KEY]: calOf(cellsCtx, 1000, { policy: "comparison" }) } });
  const r = E.policy.resolve({ channel: "r", ctx: rowsCtx, scale: onlyCells, store: E.store.create(), workspace: "live", cutMs: 2000 });
  assert.equal(r.state, "no-calibration");
  assert.equal(r.fallback, "not-held");
  const c = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: onlyCells, store: E.store.create(), workspace: "live", cutMs: 2000 });
  assert.equal(c.state, "ok");
  // a Cells manual domain leaves the Rows resolved id unchanged
  const store = E.store.create();
  store.commit("live", calOf(rowsCtx, 1000));
  const manual = red(fresh(), { type: "manual", channel: "cells", kind: "value-log1p", U: 26791234.56, k: 48211.3 }, { mode: "volume", rows: "volume", live: true, contexts: { cells: cellsCtx, rows: rowsCtx }, cutMs: 1 }).scale;
  const rowsBefore = E.policy.resolve({ channel: "r", ctx: rowsCtx, scale: fresh(), store, workspace: "live", cutMs: 2000 });
  const rowsAfter = E.policy.resolve({ channel: "r", ctx: rowsCtx, scale: manual, store, workspace: "live", cutMs: 2000 });
  assert.equal(rowsAfter.id, rowsBefore.id);
  assert.equal(E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: manual, store, workspace: "live", cutMs: 2000 }).id, "3s_XdONgi8CSqyOl");
});

test("incompatible measures fall back to Explore with a stated reason (A-18): Volume vs Trades, Delta, Intensity, Rank, linear, Path", () => {
  const cases = [
    [{ measure: "trades", n: 4, m: 0 }, "different formula family", "different formula family"],
    [{ measure: "delta", n: 4, m: 0 }, "different formula family", "different formula family"],
    [{ measure: "size", n: 4, m: 0 }, "different formula family", "different formula family"],
    [{ measure: "path", n: 4, m: 0 }, "different formula family", "different formula family"],
    [{ measure: "volume", basis: "intensity", n: 4, m: 0 }, "amount and intensity are different bases", "amount vs intensity"],
    [{ measure: "volume", transform: "rank", n: 4, m: 0 }, "different transform", "different transform"],
    [{ measure: "volume", transform: "value", curve: "linear", n: 4, m: 0 }, "different transform", "different transform"],
  ];
  for (const [spec, text] of cases.map((c) => [c[0], c[1]])) {
    const r = resolveWith(E.context.cellsKey(spec));
    const name = JSON.stringify(spec);
    assert.equal(r.state, "no-calibration", name);
    assert.equal(r.fallback, "not-held", name);
    assert.equal(r.policy, "explore", name + ": Auto is suspended, the fallback is Explore");
    assert.equal(r.desc, null, name);
    assert.equal(r.detail, "Not held by Comparison lock: " + text, name);
    assert.equal(r.reason, "uninitialized", name);
  }
});

test("under the lock the fallback is Explore even if the preference still says Auto (an imported address: Auto is suspended, not honoured)", () => {
  const imported = withPrefs({ lock: true, cells: "auto", resume: { cells: "auto", rows: "explore" } });
  const store = E.store.create();
  store.commit("live", calOf(cellsCtx, 1000));
  const r = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: imported, store, workspace: "live", cutMs: 2000 });
  assert.equal(r.fallback, "not-held");
  assert.equal(r.policy, "explore");
  // unlocked, the same preference is Auto
  assert.equal(E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: Object.assign({}, imported, { lock: false }), store, workspace: "live", cutMs: 2000 }).policy, "auto");
});

test("with several mappings held for a channel, the reason is given against the one of the same measure", () => {
  const deltaCtx = E.context.cellsKey({ measure: "delta", n: 4, m: 0 });
  const held = {
    "c|delta.usdt|log1p|s|-": calOf(deltaCtx, 1000, { policy: "comparison", desc: E.scale.manual({ kind: "value-log1p", signed: true, U: 100, k: 10 }).descriptor }),
    [CELLS_KEY]: calOf(cellsCtx, 1000, { policy: "comparison" }),
  };
  const scale = withPrefs({ lock: true, resume: { cells: "explore", rows: "explore" }, held });
  const r = E.policy.resolve({ channel: "c", ctx: E.context.cellsKey({ measure: "volume", basis: "intensity", n: 4, m: 0 }), scale, store: E.store.create(), workspace: "live", cutMs: 2000 });
  assert.equal(r.detail, "Not held by Comparison lock: amount and intensity are different bases", "not the Delta hold's reason");
  const t = E.policy.resolve({ channel: "c", ctx: E.context.cellsKey({ measure: "trades", n: 4, m: 0 }), scale, store: E.store.create(), workspace: "live", cutMs: 2000 });
  assert.equal(t.detail, "Not held by Comparison lock: different formula family", "no hold of the same measure: the first held mapping is named");
});

test("the fallback is visible and then Explore works as usual: with an Explore record in the store the channel draws it, labelled not held", () => {
  const trades = E.context.cellsKey({ measure: "trades", n: 4, m: 0 });
  const store = E.store.create();
  store.commit("live", calOf(trades, 1000, { desc: desc(77, 7) }));
  const r = resolveWith(trades, { store });
  assert.equal(r.state, "ok");
  assert.equal(r.policy, "explore");
  assert.equal(r.desc.params.U, 77);
  assert.equal(r.fallback, "not-held");
  assert.equal(r.detail, "Not held by Comparison lock: different formula family");
});

test("a held mapping of another formula VERSION is refused: same class, different version (A-18)", () => {
  const v2 = Object.assign({}, cellsCtx, { formula: "cells.volume.amount@2" });
  const r = resolveWith(v2);
  assert.equal(r.fallback, "incompatible");
  assert.equal(r.state, "no-calibration");
  assert.equal(r.detail, "Not held by Comparison lock: different formula version");
  assert.equal(r.policy, "explore");
});

test("under the lock with nothing held for the channel the plain 'Not held by Comparison lock' is shown (DD-22), never a silent fit-and-freeze", () => {
  const lockedNothing = withPrefs({ lock: true, resume: { cells: "explore", rows: "explore" }, cells: "explore", rows: "explore" });
  const r = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: lockedNothing, store: E.store.create(), workspace: "live", cutMs: 2000 });
  assert.equal(r.state, "no-calibration");
  assert.equal(r.fallback, "not-held");
  assert.equal(r.detail, "Not held by Comparison lock");
  assert.equal(r.reason, "uninitialized");
});

test("a restored lock with no held descriptor for the active class shows 'Not held', it does not silently unlock (A-23)", () => {
  const restored = E.policy.restore({ scale: { lock: true, transform: "rank" }, records: [] });
  assert.equal(restored.scale.lock, true);
  assert.deepEqual(plain(restored.scale.resume), { cells: "explore", rows: "explore" });
  const r = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: restored.scale, store: E.store.create(), workspace: "live", cutMs: 2000 });
  assert.equal(r.fallback, "not-held");
  assert.equal(r.state, "no-calibration");
});

// ---- explicit locks and replay ---------------------------------------------------------------------------

test("an explicit lock is exempt from the replay invalidation and is labelled external when its observations are after the cutoff", () => {
  const scale = lockedScale();
  const store = E.store.create();
  store.commit("live", calOf(cellsCtx, 500, { desc: desc(1, 1) }));
  const after = resolveWith(cellsCtx, { store, cutMs: 400 });
  assert.equal(after.state, "ok", "the held mapping (obsEnd 1000) stays although the cutoff is earlier");
  assert.equal(after.policy, "comparison");
  assert.equal(after.external, true, "external comparison override");
  assert.equal(after.id, "3s_XdONgi8CSqyOl");
  assert.equal(resolveWith(cellsCtx, { store, cutMs: 1000 }).external, false);
  assert.equal(resolveWith(cellsCtx, { store, cutMs: 1001 }).external, false);
  // the same store record, without the lock, is an ordinary implicit record and IS invalidated by the same cutoff
  const unlocked = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: fresh(), store, workspace: "live", cutMs: 400 });
  assert.equal(unlocked.state, "no-calibration");
  assert.equal(unlocked.reason, "replay");
  assert.ok(scale.lock);
});

test("a manual domain holds without the lock and reads external the same way", () => {
  const manual = withPrefs({ held: { [CELLS_KEY]: calOf(cellsCtx, 5000, { origin: "manual", policy: "comparison", desc: desc(26791234.56, 48211.3) }) } });
  const r = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: manual, store: E.store.create(), workspace: "live", cutMs: 100 });
  assert.equal(r.state, "ok");
  assert.equal(r.policy, "comparison");
  assert.equal(r.origin, "manual");
  assert.equal(r.external, true);
  assert.equal(manual.lock, false);
});

test("a stale lock keeps its mapping and the warnings report the clipping: values above the held U are HIGH and counted", { skip: E.warn ? false : "needs part 17-warn, which a standalone ENCODING_ONLY=policy run does not load" }, () => {
  const plan = E.scale.plan(desc(1000, 10));
  const t = E.warn.tally();
  const out = { t: 0, clip: 0, state: null };
  for (const v of [5, 50, 500, 1000, 1500, 2500, 9000, 12000, 30, 40]) {
    plan.apply(v, out);
    t.add(plan.index(out.t), out.clip, true, v !== 0);
  }
  // by hand: 1000 is the exact endpoint (not outside); 1500, 2500, 9000, 12000 are beyond U: 4 of 10 marks
  assert.equal(t.outside, 4);
  assert.equal(t.exactHigh, 1);
  assert.equal(E.warn.evaluate(t).rangeExceeded, true, "40 % of the marks is more than 10 %");
});

test("lock and unlock keep the held and frozen maps as plain data: JSON-safe and independent of the input", () => {
  const out = red(fresh(), { type: "lock" }, LOCK_ENV);
  E.result.assertJsonSafe(plain(out.scale));
  out.scale.frozen["pane.volume"].hi = 1;
  assert.equal(AXES[0].domain[1], 1920000000, "the page's axis description was not aliased");
});
