"use strict";
// U27 (T-replay): replay eligibility and the period identities around it (API.md C.9, C.10, DR-06, DR-16, DD-20,
// DD-22, S1-140..144): a fit is valid only at a cutoff at or after the end of its observations, backward scrubs and
// zoom-moving edges invalidate implicit mappings BEFORE display, forward Play never invalidates and never refits,
// the live and replay stores are separate, explicit locks are exempt and flagged, and a growing or rolling period
// keeps its identity until its start changes.
//
// Oracles (none is the code under test): the millisecond values below were computed with Python from T0 =
// 1609459200 s and BASE = 56.25 s (2026-09-24T00:00Z = base 3213312 = 1790208000000 ms; the recorded cutoff
// 2026-09-24T12:02:48.750Z = base 3214083 = 1790251368750 ms; 2026-09-28T00:00Z = 3219456 = 1790553600000;
// 2026-10-01T00:00Z = 3224064 = 1790812800000; 2027-01-01T00:00Z = 3365376 = 1798761600000; the zoom-moving edge
// of anchor 3213400.5: floor to n=4 is 3213392 = 1790212500000, to n=6 is 3213376 = 1790211600000); the week,
// month and year starts come from `Date.UTC` in the test, an independent calendar; the eligibility rule is read off
// "obsEnd <= cut" by hand. Stores, contexts and descriptors are built with E.store, E.context and E.scale, which
// only SUPPLY data here.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects are of another realm, so structures
// are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => JSON.parse(JSON.stringify(E.policy.DEFAULTS));
const T0 = 1609459200;
const BASE = 56.25;

const MS = {
  recorded: 1790251368750, // 3214083
  n4Edge: 1790212500000, // 3213392
  n6Edge: 1790211600000, // 3213376
  midnight24: 1790208000000, // 3213312
  midnight25: 1790294400000, // 3214848
  mon28: 1790553600000, // 3219456
  oct1: 1790812800000, // 3224064
  jan1: 1798761600000, // 3365376
};

const desc = (U, k) => E.scale.manual({ kind: "value-log1p", signed: false, U, k }).descriptor;
const cellsAt = (n, extra) => E.context.cellsKey(Object.assign({ measure: "volume", n, m: 0, workspace: "live" }, extra || {}));
function cal(ctx, obsEndMs, over) {
  return Object.assign({ v: 1, key: E.context.keyString(ctx), ctx, desc: desc(1000, 10), policy: "explore", origin: "fit", workspace: ctx.workspace, cohort: { kind: ctx.consumer, n: 9, zeros: 0, nonzero: 9 }, obsEndMs, cutMs: obsEndMs }, over || {});
}
function resolve(store, ctx, cutMs, over) {
  return E.policy.resolve(Object.assign({ channel: ctx.consumer === "rows" ? "r" : "c", ctx, scale: fresh(), store, workspace: ctx.workspace, cutMs }, over || {}));
}

// ---- eligibility at the paint-time cutoff ----------------------------------------------------------------

test("the eligibility rule in integer milliseconds: obsEnd <= cut, evaluated at the exact values of the recorded page", () => {
  const store = E.store.create();
  const ctx = cellsAt(4);
  store.commit("live", cal(ctx, MS.recorded));
  assert.equal(resolve(store, ctx, MS.recorded).state, "ok");
  assert.equal(resolve(store, ctx, MS.recorded - 1).state, "no-calibration", "one millisecond before the observation end");
  assert.equal(resolve(store, ctx, MS.recorded + 56250).state, "ok", "one base column later");
  assert.equal(resolve(store, ctx, MS.recorded - 56250).state, "no-calibration", "one base column earlier");
});

test("a backward scrub invalidates the future-fitted record BEFORE display and finds the newest prior one (S1-140)", () => {
  const store = E.store.create();
  const ctx = cellsAt(4);
  store.commit("live", cal(ctx, MS.n4Edge, { desc: desc(400, 4) }));
  store.commit("live", cal(ctx, MS.recorded, { desc: desc(900, 9) }));
  assert.equal(resolve(store, ctx, MS.recorded).desc.params.U, 900, "at the live edge the newest record");
  const back = resolve(store, ctx, MS.n4Edge);
  assert.equal(back.state, "ok");
  assert.equal(back.desc.params.U, 400, "scrubbed back: the record fitted on later data is not used");
  assert.equal(back.ineligibleNewer, true);
  const further = resolve(store, ctx, MS.n6Edge);
  assert.equal(further.state, "no-calibration", "nothing earlier exists: No calibration, not the later mapping");
  assert.equal(further.reason, "replay");
  assert.equal(further.desc, null);
  // and forward again: the record is eligible again (nothing was deleted by looking)
  assert.equal(resolve(store, ctx, MS.recorded).desc.params.U, 900);
});

test("zoom-moving edge: the floor of the anchor differs per level, so a level change ALONE can invalidate (anchor 3213400.5)", () => {
  // n=4 floors 3213400.5 to 3213392, n=6 to 3213376 (16 and 64 base columns). A context record fitted with its
  // observations ending at the n=4 edge is valid at the n=4 cutoff and invalid at the n=6 cutoff.
  const store = E.store.create();
  const ctx = cellsAt(6);
  store.commit("live", cal(ctx, MS.n4Edge));
  assert.equal(resolve(store, ctx, MS.n4Edge).state, "ok");
  assert.equal(resolve(store, ctx, MS.n6Edge).state, "no-calibration");
  assert.equal(MS.n4Edge - MS.n6Edge, 900000, "16 base columns of 56.25 s: 15 minutes apart");
  assert.equal(3213392 - 3213376, 16);
  // the two levels are different contexts, so each has its own record and neither borrows the other's
  const c4 = cellsAt(4);
  assert.equal(resolve(store, c4, MS.n4Edge).state, "no-calibration");
});

test("a cutoff at the very start of a replay day makes every same-day record ineligible; the next day's boundary does too", () => {
  const store = E.store.create();
  const ctx = cellsAt(4);
  store.commit("live", cal(ctx, MS.recorded));
  assert.equal(resolve(store, ctx, MS.midnight24).state, "no-calibration");
  assert.equal(resolve(store, ctx, MS.midnight25).state, "ok");
});

// ---- forward Play -----------------------------------------------------------------------------------------

test("forward Play keeps the cutoff monotone: nothing is invalidated, nothing refits, the same mapping is resolved at every step", () => {
  const store = E.store.create();
  const ctx = cellsAt(4);
  store.commit("replay", cal(cellsAt(4, { workspace: "replay" }), MS.n4Edge, { workspace: "replay", desc: desc(400, 4) }));
  const rctx = cellsAt(4, { workspace: "replay" });
  const ids = new Set();
  for (let cut = MS.n4Edge; cut <= MS.n4Edge + 10 * 56250; cut += 56250) {
    const r = resolve(store, rctx, cut);
    assert.equal(r.state, "ok", "cut " + cut);
    assert.equal(r.ineligibleNewer, false);
    assert.equal(r.external, false);
    ids.add(r.id);
  }
  assert.equal(ids.size, 1);
  assert.equal(store.keys("replay").length, 1);
  assert.equal(store.keys("live").length, 0);
  assert.ok(ctx);
});

test("during Play Auto is paused (no timer) and only the first Explore initialisation may run, causally; a pause then allows a settled update", () => {
  const ctl = E.lifecycle.controller();
  const ok = { ok: true, reasons: [] };
  const at = (now, extra) => plain(ctl.due("cells", Object.assign({ now, lastGestureAt: -Infinity, held: [], playing: true, coherent: ok }, extra || {})));
  ctl.request("cells", "auto", "k");
  assert.deepEqual(at(1000), { run: false, waitMs: null, reason: "play" });
  ctl.request("cells", "init", "k2");
  assert.deepEqual(at(1001), { run: true }, "the first initialisation of a replay context is causal by construction");
  ctl.ran("cells", "init", 1001);
  ctl.request("cells", "auto", "k3");
  assert.deepEqual(at(1002), { run: false, waitMs: null, reason: "play" });
  assert.deepEqual(at(1003, { playing: false, lastGestureAt: 1000 }), { run: false, waitMs: 197, reason: "gesture" }, "paused: the settle time still applies");
  assert.deepEqual(at(1200, { playing: false, lastGestureAt: 1000 }), { run: true });
});

// ---- live and replay are separate ------------------------------------------------------------------------

test("entering replay does not overwrite the live mapping, leaving restores it exactly, and each workspace resolves its own", () => {
  const store = E.store.create();
  const live = cellsAt(4);
  const rep = cellsAt(4, { workspace: "replay" });
  store.commit("live", cal(live, MS.recorded, { desc: desc(900, 9) }));
  const liveJson = JSON.stringify(store.toJSON("live"));
  // the person scrubs into replay: a replay fit of the SAME measure and level lands in the replay workspace
  store.commit("replay", cal(rep, MS.n4Edge, { workspace: "replay", desc: desc(400, 4) }));
  assert.equal(resolve(store, rep, MS.n4Edge).desc.params.U, 400);
  assert.equal(resolve(store, live, MS.recorded).desc.params.U, 900);
  assert.notEqual(E.context.keyString(rep), E.context.keyString(live), "the workspace is part of the context key");
  assert.equal(JSON.stringify(store.toJSON("live")), liveJson);
  // exit: the replay workspace is tab memory and is simply dropped
  store.clear("replay");
  assert.equal(JSON.stringify(store.toJSON("live")), liveJson, "byte-equal live descriptors after exit");
  assert.equal(resolve(store, live, MS.recorded).desc.params.U, 900);
  assert.equal(resolve(store, rep, MS.n4Edge, { workspace: "replay" }).state, "no-calibration");
});

test("a live store is read in replay only through its own workspace: a replay lookup never finds a live record", () => {
  const store = E.store.create();
  store.commit("live", cal(cellsAt(4), MS.n4Edge));
  assert.equal(store.lookup("replay", E.context.keyString(cellsAt(4)), MS.recorded), null);
  assert.equal(store.lookup("replay", E.context.keyString(cellsAt(4, { workspace: "replay" })), MS.recorded), null);
});

// ---- explicit locks ---------------------------------------------------------------------------------------

test("explicit comparison records survive a backward scrub and read external; implicit ones of the same age do not", () => {
  const store = E.store.create();
  const held = cellsAt(4);
  const implicit = cellsAt(5);
  store.commit("live", cal(held, MS.recorded, { policy: "comparison" }));
  store.commit("live", cal(implicit, MS.recorded, { policy: "explore" }));
  const a = store.lookup("live", E.context.keyString(held), MS.n4Edge);
  assert.equal(a.external, true);
  assert.equal(a.record.obsEndMs, MS.recorded);
  assert.equal(store.lookup("live", E.context.keyString(implicit), MS.n4Edge), null);
  // the flag survives serialisation: the record keeps its policy, so a portable code can label it external
  assert.equal(plain(store.toJSON()).contexts.find((c) => c.key === E.context.keyString(held)).records[0].policy, "comparison");
});

test("the scale-eligibility and the model status are independent: an eligible scale can sit beside a retrospective model", { skip: E.model ? false : "needs part 18-model, which a standalone run does not load" }, () => {
  const store = E.store.create();
  const ctx = cellsAt(4);
  const cut = MS.midnight24 - 1000; // earlier than 2026-09-24T00:00Z
  store.commit("live", cal(ctx, cut - 1000));
  assert.equal(resolve(store, ctx, cut).state, "ok", "the scale is eligible at this cutoff");
  assert.equal(E.model.status(cut), "retrospective", "the model was estimated on later data");
  assert.equal(E.model.status(MS.recorded), "timing-unverified");
});

// ---- period identity, growth and rollover ----------------------------------------------------------------

// The UTC start of the week (Monday), month and year that contain a base column, by the calendar rather than by
// the code under test.
function startBase(kind, base) {
  const d = new Date((T0 + base * BASE) * 1000);
  let start;
  if (kind === "wk") start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else if (kind === "mo") start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  else start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return (start / 1000 - T0) / BASE;
}

function rowsCtx(kind, cutBase) {
  const s = startBase(kind, cutBase);
  return E.context.rowsKey({ measure: "volume", period: E.context.periodIdentity(kind, [s, cutBase]), rowSize: 3, workspace: "live" });
}

test("rollover creates a new identity at the exact edges: one base column before the edge is the old period, at the edge the new one (S1 D4)", () => {
  assert.equal(startBase("wk", 3219456), 3219456, "sanity: 2026-09-28T00:00Z is a Monday start");
  const cases = [
    ["wk", 3219455, 3219456, "cal:wk:2026-09-21", "cal:wk:2026-09-28"],
    ["mo", 3224063, 3224064, "cal:mo:2026-09-01", "cal:mo:2026-10-01"],
    ["yr", 3365375, 3365376, "cal:yr:2026-01-01", "cal:yr:2027-01-01"],
  ];
  for (const [kind, before, at, oldId, newId] of cases) {
    assert.equal(E.context.periodIdentity(kind, [startBase(kind, before), before]), oldId, kind + " one column before");
    assert.equal(E.context.periodIdentity(kind, [startBase(kind, at), at]), newId, kind + " at the edge");
    assert.notEqual(E.context.keyString(rowsCtx(kind, before)), E.context.keyString(rowsCtx(kind, at)), kind);
  }
  assert.equal(MS.mon28 / 1000 - T0, 3219456 * BASE);
  assert.equal(MS.oct1 / 1000 - T0, 3224064 * BASE);
  assert.equal(MS.jan1 / 1000 - T0, 3365376 * BASE);
});

test("growth: a period's end advances every minute and its context (and so its mapping) does not change; rollover gives a fresh context with no record", () => {
  const store = E.store.create();
  const monday = 3219456;
  const week1 = rowsCtx("wk", monday + 10);
  store.commit("live", cal(week1, MS.mon28 + 600000));
  for (const grown of [monday + 10, monday + 500, monday + 1535, monday + 1536 * 6 + 1535]) {
    const ctx = rowsCtx("wk", grown);
    assert.equal(E.context.keyString(ctx), E.context.keyString(week1), "the same week at base " + grown);
    assert.equal(resolve(store, ctx, MS.mon28 + 7 * 86400000 - 1).state, "ok");
  }
  // the next Monday: a new key, the old record is inactive, the Rows channel shows No calibration
  const next = rowsCtx("wk", monday + 1536 * 7);
  assert.notEqual(E.context.keyString(next), E.context.keyString(week1));
  const r = resolve(store, next, MS.mon28 + 7 * 86400000);
  assert.equal(r.state, "no-calibration");
  assert.equal(r.reason, "uninitialized");
  assert.equal(store.keys("live").length, 1, "the old period's record is still there (LRU), just not active");
});

test("rolling, since-day and all-history identities do not move while the period grows (S1 D4)", () => {
  const id = (key, span) => E.context.periodIdentity(key, span);
  assert.equal(id("90d", [1, 2]), id("90d", [500000, 600000]), "a rolling period is its duration, not its sliding start");
  assert.equal(id("90d", [1, 2]), "roll:90");
  assert.equal(id("2026-09-01", [3177984, 3214083]), id("2026-09-01", [3177984, 3299999]));
  assert.equal(id("all", [0, 10]), id("all", [0, 10000000]));
  assert.equal(id("all", [0, 10]), "all:2021-01-01");
});

test("stale rows of the previous period are never fitted: coherence names the gap, so no cohort forms until the new period reads", () => {
  const c = E.lifecycle.coherent({ ready: true, readiness: "ready", coverage: { ok: true }, rows: { state: "ready", stale: true, span1: 3219455, expectedEnd: 3219456 } });
  assert.equal(c.ok, false);
  assert.deepEqual(plain(c.reasons), ["rows-stale", "rows-span"]);
  const ready = E.lifecycle.coherent({ ready: true, readiness: "ready", coverage: { ok: true }, rows: { state: "ready", stale: false, span1: 3219456, expectedEnd: 3219456 } });
  assert.equal(ready.ok, true);
});

test("a stale lock keeps its mapping across the rollover: the held Rows mapping is still the one resolved, flagged external only if it reaches past the cutoff", () => {
  const before = rowsCtx("wk", 3219455);
  const after = rowsCtx("wk", 3219456);
  const held = cal(before, MS.mon28 - 56250, { policy: "comparison" });
  const scale = Object.assign(fresh(), { lock: true, resume: { cells: "explore", rows: "explore" }, held: { "r|amount.usdt|log1p|u|-": held } });
  const r = E.policy.resolve({ channel: "r", ctx: after, scale, store: E.store.create(), workspace: "live", cutMs: MS.mon28 });
  assert.equal(r.state, "ok");
  assert.equal(r.policy, "comparison");
  assert.equal(r.id, held.desc.id);
  assert.equal(r.external, false);
  assert.equal(r.key, E.context.keyString(after), "resolved for the NEW context, with the held mapping");
});

test("a replay period rollover by scrubbing across Monday moves the identity both ways", () => {
  const sun = rowsCtx("wk", 3219455);
  const mon = rowsCtx("wk", 3219456);
  const store = E.store.create();
  store.commit("live", cal(sun, MS.mon28 - 56250));
  assert.equal(resolve(store, sun, MS.mon28 - 56250).state, "ok");
  assert.equal(resolve(store, mon, MS.mon28).state, "no-calibration");
  // scrubbing back to Sunday: the old record is the context again, eligible at its own end
  assert.equal(resolve(store, rowsCtx("wk", 3219455), MS.mon28 - 56250).state, "ok");
});
