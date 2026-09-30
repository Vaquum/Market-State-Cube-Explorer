"use strict";
// U25 (T-lifecycle): E.lifecycle (part 15): coherence, the settle predicate, the per-channel fit cadence and the
// memo key (API.md C.10, Appendix A.6, DR-16, DR-17, DD-21, DD-46, DD-79, DD-80, DD-81, S1-115..117).
//
// Oracles (none is the code under test): the cadence trace of API.md Appendix A.6, row by row, on a fake clock
// the test moves by hand (settleMs 200, autoMs 500); the settle boundary by arithmetic (a gesture at 1000 is
// settled at 1200 and not at 1199; `lastGestureAt` starts at -Infinity so the first paint is not "gesturing");
// the coherence rules of C.10 as a table of (input, expected reasons), including the two corrections of the
// design-owner pass (DD-79: a FAILED read is not outstanding; DD-80: a tier that is loading but not needed by the
// view blocks nothing); and the memo key written out by hand as the join of [generation, edgeCut, b0..b3, n, m,
// configKey, cohortId] with "|" (edgeCut is the cutoff only when b1 > floor(CUT), the baseline idiom).
// Replay eligibility of a record (obsEnd <= cut) lives in store.test.js and replay.test.js; the axis registry's
// timers in axes.test.js.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects are of another realm, so structures
// are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;
const OK = { ok: true, reasons: [] };

function env(over) {
  return Object.assign({ now: 0, lastGestureAt: -Infinity, held: [], playing: false, coherent: OK }, over);
}

// ---- the cadence trace of API.md A.6 -----------------------------------------------------------------------

test("cadence trace A.6, row by row (settleMs 200, autoMs 500)", () => {
  const ctl = E.lifecycle.controller({ settleMs: 200, autoMs: 500 });
  const due = (channel, over) => plain(ctl.due(channel, env(over)));

  // t=0: want cells:init, lastGestureAt = -Infinity, coherent -> run (the first paint is not "gesturing")
  assert.equal(ctl.request("cells", "init", "k0"), true);
  assert.deepEqual(due("cells", { now: 0 }), { run: true });

  // t=1100: wheel ticks at 1000/1040/1080 (lastGestureAt 1080), want init -> wait 180 ms
  assert.deepEqual(due("cells", { now: 1100, lastGestureAt: 1080 }), { run: false, waitMs: 180, reason: "gesture" });

  // t=1280: same, nothing held -> run, then ran(cells, init)
  assert.deepEqual(due("cells", { now: 1280, lastGestureAt: 1080 }), { run: true });
  assert.equal(ctl.ran("cells", "init", 1280), true);
  assert.equal(ctl.hasWants(), false);

  // t=1500: want cells:auto, lastAutoAt unset -> leading edge: run now, then ran(auto, 1500)
  assert.equal(ctl.request("cells", "auto", "m1"), true);
  assert.deepEqual(due("cells", { now: 1500, lastGestureAt: 1080 }), { run: true });
  ctl.ran("cells", "auto", 1500);

  // t=1700: want auto again, settled -> the cap: 300 ms to go
  assert.equal(ctl.request("cells", "auto", "m2"), true);
  assert.deepEqual(due("cells", { now: 1700, lastGestureAt: 1080 }), { run: false, waitMs: 300, reason: "cap" });

  // t=2000: same -> run
  assert.deepEqual(due("cells", { now: 2000, lastGestureAt: 1080 }), { run: true });

  // t=2100: playing, want auto -> no timer, "Auto paused"
  assert.deepEqual(due("cells", { now: 2100, lastGestureAt: 1080, playing: true }), { run: false, waitMs: null, reason: "play" });

  // t=2100: a drag is held, want init -> not settled, no countdown (the gesture's end is the wake)
  const ctl2 = E.lifecycle.controller();
  ctl2.request("cells", "init", "k");
  assert.deepEqual(plain(ctl2.due("cells", env({ now: 2100, held: ["drag"] }))), { run: false, waitMs: null, reason: "gesture" });

  // t=2100: not coherent, want init -> poll every RETRY_MS (DD-46)
  assert.deepEqual(plain(ctl2.due("cells", env({ now: 2100, coherent: { ok: false, reasons: ["view-read-pending"] } }))), { run: false, waitMs: 200, reason: "read" });

  // t=2100: want cells:fit, playing, settled -> an explicit Fit bypasses Play and the cap
  const ctl3 = E.lifecycle.controller();
  ctl3.request("cells", "fit", "f");
  assert.deepEqual(plain(ctl3.due("cells", env({ now: 2100, playing: true, lastGestureAt: 1080 }))), { run: true });
});

test("the RETRY_MS of the trace is the header's constant, and the defaults are TIMING's 200 and 500", () => {
  assert.equal(E.TIMING.RETRY_MS, 200);
  assert.equal(E.TIMING.SETTLE_MS, 200);
  assert.equal(E.TIMING.AUTO_MS, 500);
  const ctl = E.lifecycle.controller();
  ctl.request("rows", "auto", "k");
  ctl.ran("rows", "auto", 1000);
  ctl.request("rows", "auto", "k2");
  assert.deepEqual(plain(ctl.due("rows", env({ now: 1100 }))), { run: false, waitMs: 400, reason: "cap" });
  assert.deepEqual(plain(ctl.due("rows", env({ now: 1500 }))), { run: true });
});

test("an init or fit request is not data-driven: no cap and (for init) it may run causally during Play (DR-16)", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "auto", "a");
  ctl.ran("cells", "auto", 1000);
  ctl.request("cells", "init", "i");
  assert.deepEqual(plain(ctl.due("cells", env({ now: 1001, playing: true }))), { run: true });
  ctl.request("cells", "fit", "f");
  assert.deepEqual(plain(ctl.due("cells", env({ now: 1002, playing: true }))), { run: true });
});

test("the cap is per channel: Cells and Rows do not share a last-run time (DD-21)", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "auto", "a");
  ctl.ran("cells", "auto", 1000);
  ctl.request("cells", "auto", "b");
  ctl.request("rows", "auto", "c");
  assert.deepEqual(plain(ctl.due("cells", env({ now: 1100 }))), { run: false, waitMs: 400, reason: "cap" });
  assert.deepEqual(plain(ctl.due("rows", env({ now: 1100 }))), { run: true }, "the Rows channel has never run an Auto fit");
});

test("only an Auto run records the cap time: an init does not start one", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "init", "a");
  ctl.ran("cells", "init", 1000);
  ctl.request("cells", "auto", "b");
  assert.deepEqual(plain(ctl.due("cells", env({ now: 1001 }))), { run: true });
  assert.deepEqual(plain(ctl.snapshot()), { wants: { cells: { kind: "auto", key: "b" } }, lastAutoAt: {} });
});

test("a channel with no want answers {run:false, waitMs:null} without needing the environment", () => {
  const ctl = E.lifecycle.controller();
  assert.deepEqual(plain(ctl.due("cells")), { run: false, waitMs: null });
  assert.equal(ctl.hasWants(), false);
});

test("due needs a stated coherence: a fit must never run on data nobody checked", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "init", "k");
  assert.throws(() => ctl.due("cells", { now: 0 }), isError("TypeError"));
  assert.throws(() => ctl.due("cells", { coherent: OK }), isError("TypeError"));
  assert.throws(() => ctl.due("cells"), isError("TypeError"));
});

test("incoherent outranks unsettled: a read in flight polls, even with a gesture held (A.6 order)", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "init", "k");
  assert.deepEqual(plain(ctl.due("cells", env({ now: 5, held: ["drag"], coherent: { ok: false, reasons: ["x"] } }))), { run: false, waitMs: 200, reason: "read" });
});

test("polling can be switched off by the page: a hidden tab or no outstanding view read has no retry timer (DD-79)", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "init", "k");
  const bad = { ok: false, reasons: ["view-read-pending"] };
  assert.deepEqual(plain(ctl.due("cells", env({ coherent: bad, poll: false }))), { run: false, waitMs: null, reason: "read" });
  assert.equal(ctl.nextWake(env({ coherent: bad, poll: false })), null);
  assert.equal(ctl.nextWake(env({ coherent: bad })), 200);
});

// ---- requests, wants, nextWake ---------------------------------------------------------------------------

test("request: one want per channel; the same want again changes nothing; a new key or kind replaces it", () => {
  const ctl = E.lifecycle.controller();
  assert.equal(ctl.request("cells", "init", "k1"), true);
  assert.equal(ctl.request("cells", "init", "k1"), false, "already pending: the caller need not arm a timer again");
  assert.equal(ctl.request("cells", "init", "k2"), true, "a new key for the same channel replaces it");
  assert.deepEqual(plain(ctl.snapshot().wants), { cells: { kind: "init", key: "k2" } });
  assert.equal(ctl.request("cells", "auto", "k2"), true, "init and auto replace each other");
  assert.equal(ctl.request("rows", "init", "r"), true);
  assert.deepEqual(Object.keys(plain(ctl.snapshot().wants)).sort(), ["cells", "rows"]);
});

test("an explicit Fit is never displaced by a background request, only by another Fit", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "fit", "f1");
  assert.equal(ctl.request("cells", "init", "i"), false);
  assert.equal(ctl.request("cells", "auto", "a"), false);
  assert.deepEqual(plain(ctl.snapshot().wants), { cells: { kind: "fit", key: "f1" } });
  assert.equal(ctl.request("cells", "fit", "f2"), true);
  assert.deepEqual(plain(ctl.snapshot().wants), { cells: { kind: "fit", key: "f2" } });
});

test("request validates its arguments", () => {
  const ctl = E.lifecycle.controller();
  assert.throws(() => ctl.request("", "init", "k"), isError("TypeError"));
  assert.throws(() => ctl.request(undefined, "init", "k"), isError("TypeError"));
  assert.throws(() => ctl.request("cells", "bogus", "k"), isError("RangeError"));
});

test("ran clears the want of that kind only; cancel drops one channel or all; hasWants follows", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "init", "k");
  ctl.request("rows", "auto", "k");
  assert.equal(ctl.hasWants(), true);
  assert.equal(ctl.ran("cells", "auto", 10), false, "a different kind is not the pending want: it stays");
  assert.equal(ctl.hasWants(), true);
  assert.equal(ctl.ran("cells", "init", 10), true);
  assert.deepEqual(Object.keys(plain(ctl.snapshot().wants)), ["rows"]);
  assert.equal(ctl.cancel("rows"), true);
  assert.equal(ctl.cancel("rows"), false);
  assert.equal(ctl.hasWants(), false);
  ctl.request("cells", "fit", "k");
  ctl.request("rows", "fit", "k");
  assert.equal(ctl.cancel(), true);
  assert.equal(ctl.hasWants(), false);
  assert.equal(ctl.cancel(), false);
  assert.throws(() => ctl.ran("cells", "auto"), isError("TypeError"), "an Auto run needs its time");
});

test("a pending Auto want that was overtaken still stamps the channel's last Auto run", () => {
  const ctl = E.lifecycle.controller();
  ctl.request("cells", "auto", "a");
  ctl.request("cells", "fit", "f");
  assert.equal(ctl.ran("cells", "auto", 700), false, "the Fit want is the pending one");
  assert.deepEqual(plain(ctl.snapshot()), { wants: { cells: { kind: "fit", key: "f" } }, lastAutoAt: { cells: 700 } });
});

test("nextWake is the earliest wait among the wants (null with none, 0 when something is due)", () => {
  const ctl = E.lifecycle.controller();
  assert.equal(ctl.nextWake(env()), null);
  ctl.request("cells", "init", "a");
  ctl.request("rows", "auto", "b");
  ctl.ran("rows", "auto", 1000);
  ctl.request("rows", "auto", "c");
  // cells init: waits 50 ms of settle; rows auto: cap 400 ms. The earliest is 50.
  assert.equal(ctl.nextWake(env({ now: 1100, lastGestureAt: 950 })), 50);
  // nothing held and settled: cells is due now.
  assert.equal(ctl.nextWake(env({ now: 1100 })), 0);
  // while playing the Auto want has no timer; the init does.
  assert.equal(ctl.nextWake(env({ now: 1100, lastGestureAt: 950, playing: true })), 50);
  ctl.cancel("cells");
  assert.equal(ctl.nextWake(env({ now: 1100, playing: true })), null, "only an Auto want, and Play holds it");
  assert.equal(ctl.nextWake(env({ now: 1100 })), 400);
});

test("a controller keeps its state to itself (DD-02)", () => {
  const a = E.lifecycle.controller();
  const b = E.lifecycle.controller();
  a.request("cells", "init", "k");
  assert.equal(b.hasWants(), false);
  assert.throws(() => E.lifecycle.controller({ settleMs: -5 }), isError("TypeError"));
  assert.throws(() => E.lifecycle.controller({ autoMs: "x" }), isError("TypeError"));
  assert.deepEqual(Object.keys(a).sort(), ["cancel", "due", "hasWants", "nextWake", "ran", "request", "snapshot"]);
  assert.ok(Object.isFrozen(a));
});

// ---- settled -----------------------------------------------------------------------------------------------

test("settled: 1199 no, 1200 yes (a gesture at 1000, settleMs 200); held holds block it without a countdown", () => {
  const s = (over) => plain(E.lifecycle.settled(Object.assign({ now: 0, lastGestureAt: 1000, held: [], settleMs: 200 }, over)));
  assert.deepEqual(s({ now: 1199 }), { settled: false, waitMs: 1 });
  assert.deepEqual(s({ now: 1200 }), { settled: true, waitMs: 0 });
  assert.deepEqual(s({ now: 1000 }), { settled: false, waitMs: 200 });
  assert.deepEqual(s({ now: 5000 }), { settled: true, waitMs: 0 });
  for (const name of ["drag", "pinch", "pointer", "zoomKey", "stepKey", "zoomEnd", "resize"]) assert.deepEqual(s({ now: 9999, held: [name] }), { settled: false, waitMs: null }, name);
});

test("settled: the initial gesture stamp is -Infinity, so the first paint is not artificially gesturing (A-34)", () => {
  assert.deepEqual(plain(E.lifecycle.settled({ now: 0, lastGestureAt: -Infinity, held: [], settleMs: 200 })), { settled: true, waitMs: 0 });
  assert.deepEqual(plain(E.lifecycle.settled({ now: 0, held: [] })), { settled: true, waitMs: 0 }, "an absent stamp is -Infinity and the default settle time is 200");
  assert.deepEqual(plain(E.lifecycle.settled({ now: 50, lastGestureAt: 0 })), { settled: false, waitMs: 150 }, "the baseline's gestureAt = 0 would have made the first 200 ms gesturing");
  assert.throws(() => E.lifecycle.settled({ held: [] }), isError("TypeError"));
  assert.throws(() => E.lifecycle.settled(null), isError("TypeError"));
});

// ---- coherent ----------------------------------------------------------------------------------------------

const cohOk = () => ({
  ready: true,
  viewReadPending: false,
  readiness: "ready",
  coverage: { ok: true },
  meas: { state: "exact", updating: false },
});

function reasons(over) {
  return plain(E.lifecycle.coherent(Object.assign(cohOk(), over)));
}

test("coherent: a ready page, nothing in flight, coverage held, an exact measurement is coherent", () => {
  assert.deepEqual(reasons({}), { ok: true, reasons: [] });
  for (const state of ["exact", "recorded", "cube"]) assert.equal(reasons({ meas: { state, updating: false } }).ok, true, state);
});

test("coherent: each failing condition contributes its own named reason", () => {
  assert.deepEqual(reasons({ ready: false }).reasons, ["not-ready"]);
  assert.deepEqual(reasons({ viewReadPending: true }).reasons, ["view-read-pending"]);
  assert.deepEqual(reasons({ readiness: "loading" }).reasons, ["readiness-loading"]);
  assert.deepEqual(reasons({ coverage: { ok: false } }).reasons, ["coverage"]);
  assert.deepEqual(reasons({ coverage: false }).reasons, ["coverage"]);
  assert.deepEqual(reasons({ meas: { state: "pending", updating: false } }).reasons, ["measurement-state"]);
  assert.deepEqual(reasons({ meas: { state: "failed", updating: false } }).reasons, ["measurement-state"]);
  assert.deepEqual(reasons({ meas: { state: "exact", updating: true } }).reasons, ["measurement-updating"]);
  assert.deepEqual(reasons({ meas: { state: "pending", updating: true } }).reasons, ["measurement-state", "measurement-updating"]);
  assert.equal(reasons({ viewReadPending: true }).ok, false);
});

test("coherent (DD-79): a view read that FAILED is not outstanding, so the page passes viewReadPending false and the fit is not deferred forever", () => {
  // The page computes viewReadPending(); a failed read is excluded there. Here: no pending read, but the
  // measurement failed -> the fit is incoherent for a NAMED reason, never an endless "reading".
  const r = reasons({ viewReadPending: false, meas: { state: "failed", updating: false } });
  assert.deepEqual(r.reasons, ["measurement-state"]);
});

test("coherent (DD-80): a tier that is loading but NOT needed by the view blocks nothing: readiness ready and coverage ok is coherent", () => {
  // No `loadState` term exists: the page reports readiness of what the view needs (resolutionReadiness answers
  // "ready" when the displayed block covers the view) and coverage.ok; an unneeded loading tier is invisible.
  assert.deepEqual(reasons({ readiness: "ready", coverage: { ok: true } }), { ok: true, reasons: [] });
  assert.equal(reasons({ readiness: "ready", coverage: { ok: false } }).ok, false, "coverage.ok false is incoherent");
});

test("coherent: a terminal 'unavailable' tier is coherent ONLY when the coverage holds (the fit is then the coarser context's)", () => {
  assert.deepEqual(reasons({ readiness: "unavailable", coverage: { ok: true } }), { ok: true, reasons: [] });
  assert.deepEqual(reasons({ readiness: "unavailable", coverage: { ok: false } }).reasons, ["readiness-unavailable", "coverage"]);
});

test("coherent: motion consumers need a source and an exact or cube rectangle, not updating", () => {
  assert.deepEqual(reasons({ motion: { src: false, state: "exact", updating: false } }).reasons, ["motion-source"]);
  assert.deepEqual(reasons({ motion: { src: true, state: "pending", updating: false } }).reasons, ["motion-state"]);
  assert.deepEqual(reasons({ motion: { src: true, state: "exact", updating: true } }).reasons, ["motion-updating"]);
  assert.equal(reasons({ motion: { src: true, state: "cube", updating: false } }).ok, true);
  assert.equal(reasons({ motion: { src: true, state: "exact", updating: false } }).ok, true);
  assert.equal(reasons({ motion: { src: true, state: "recorded", updating: false } }).ok, false, "a recorded block has no motion");
});

test("coherent: Rows need a ready, not stale result whose span ends where the period does", () => {
  const rows = (o) => ({ rows: Object.assign({ state: "ready", stale: false, span1: 3219456, expectedEnd: 3219456 }, o) });
  assert.equal(reasons(rows({})).ok, true);
  assert.deepEqual(reasons(rows({ state: "pending" })).reasons, ["rows-state"]);
  assert.deepEqual(reasons(rows({ stale: true })).reasons, ["rows-stale"], "the previous period's rows during a rollover gap are never fitted");
  assert.deepEqual(reasons(rows({ span1: 3219400 })).reasons, ["rows-span"]);
});

test("coherent: bar-based axes need an unpending chunk read and a ready series", () => {
  assert.equal(reasons({ bars: { pending: false, state: "ready" } }).ok, true);
  assert.deepEqual(reasons({ bars: { pending: true, state: "ready" } }).reasons, ["bars-pending"]);
  assert.deepEqual(reasons({ bars: { pending: false, state: "loading" } }).reasons, ["bars-state"]);
});

test("coherent: the accepted state read at input time must equal the one now (generation, cutoff, canonical bound, token)", () => {
  const snap = { generation: 3, cut: 1790251368750, canon: 1790208000000, token: "abc" };
  assert.deepEqual(reasons({ snapshot: snap, current: Object.assign({}, snap) }), { ok: true, reasons: [] });
  for (const change of [{ generation: 4 }, { cut: 1790251425000 }, { canon: 1790294400000 }, { token: "abd" }, { token: null }]) {
    assert.deepEqual(reasons({ snapshot: snap, current: Object.assign({}, snap, change) }).reasons, ["snapshot-changed"], JSON.stringify(change));
  }
  // a whole pack between read and commit voids the fit: the generation moved.
  assert.equal(reasons({ snapshot: { generation: 0, cut: 1, canon: null, token: null }, current: { generation: 1, cut: 1, canon: null, token: null } }).ok, false);
});

test("coherent: reasons come in evaluation order; absent parts need nothing; the input must be an object", () => {
  const r = reasons({ ready: false, viewReadPending: true, readiness: "loading", coverage: false, meas: { state: "pending", updating: true } });
  assert.deepEqual(r.reasons, ["not-ready", "view-read-pending", "readiness-loading", "coverage", "measurement-state", "measurement-updating"]);
  assert.deepEqual(plain(E.lifecycle.coherent({})), { ok: true, reasons: [] }, "an empty input asks for nothing");
  assert.throws(() => E.lifecycle.coherent(null), isError("TypeError"));
  assert.throws(() => E.lifecycle.coherent("x"), isError("TypeError"));
});

// ---- memoKey ------------------------------------------------------------------------------------------------

const bounds = [3213312, 3213440, 656, 688];
function parts(over) {
  return Object.assign({ generation: 3, CUT: 3214083.5, bounds, n: 4, m: 0, config: "volume,amount,spans,value,explore,0,", cohortId: "src7|exact" }, over);
}

test("memoKey is the join of generation, edge cutoff, the four bounds, the effective level, the configuration and the cohort", () => {
  // b1 = 3213440 is not beyond floor(CUT) = 3214083: the rectangle does not reach the open column: edgeCut is "".
  assert.equal(E.lifecycle.memoKey(parts()), "3||3213312|3213440|656|688|4|0|volume,amount,spans,value,explore,0,|src7|exact");
});

test("memoKey carries the cutoff only when the rectangle reaches the open column (b1 > floor(CUT))", () => {
  const open = E.lifecycle.memoKey(parts({ bounds: [3213312, 3214100, 656, 688] }));
  assert.equal(open, "3|3214083.5|3213312|3214100|656|688|4|0|volume,amount,spans,value,explore,0,|src7|exact");
  // exactly floor(CUT) is not beyond it
  assert.equal(E.lifecycle.memoKey(parts({ bounds: [3213312, 3214083, 656, 688] })).split("|")[1], "");
  assert.equal(E.lifecycle.memoKey(parts({ bounds: [3213312, 3214083.25, 656, 688] })).split("|")[1], "3214083.5");
  // a live advance changes the key of a view that sees the open column and NOT of one that cannot
  const closed = (cut) => E.lifecycle.memoKey(parts({ CUT: cut }));
  assert.equal(closed(3214083.5), closed(3214084.5));
  const seen = (cut) => E.lifecycle.memoKey(parts({ CUT: cut, bounds: [3213312, 3214100, 656, 688] }));
  assert.notEqual(seen(3214083.5), seen(3214084.5));
});

test("memoKey: same-pack navigation is a new key, an unchanged view is the same key, and the token is not part of it", () => {
  const k = E.lifecycle.memoKey(parts());
  assert.equal(E.lifecycle.memoKey(parts()), k);
  assert.notEqual(E.lifecycle.memoKey(parts({ bounds: [3213313, 3213440, 656, 688] })), k, "panned");
  assert.notEqual(E.lifecycle.memoKey(parts({ bounds: [3213312, 3213440, 656, 689] })), k, "zoomed in price");
  assert.notEqual(E.lifecycle.memoKey(parts({ n: 5 })), k, "effective level");
  assert.notEqual(E.lifecycle.memoKey(parts({ m: 1 })), k);
  assert.notEqual(E.lifecycle.memoKey(parts({ generation: 4 })), k, "a whole pack");
  assert.notEqual(E.lifecycle.memoKey(parts({ cohortId: "src8|exact" })), k);
  assert.equal(E.lifecycle.memoKey(parts({ token: "abc", theme: "dark", srcId: "tile-9", selection: [1, 2, 3, 4] })), k, "token, theme, block id and selection are not key elements");
});

test("memoKey: the configuration is a string or an object joined in a fixed order (mode, basis, pathBasis, transform, policy, lock, window)", () => {
  const cfg = { mode: "volume", basis: "intensity", pathBasis: "spans", transform: "rank", policy: "auto", lock: false, window: null };
  assert.equal(E.lifecycle.memoKey(parts({ config: cfg })), "3||3213312|3213440|656|688|4|0|volume,intensity,spans,rank,auto,0,|src7|exact");
  assert.equal(E.lifecycle.memoKey(parts({ config: Object.assign({}, cfg, { lock: true, window: [0.45, 0.55] }) })), "3||3213312|3213440|656|688|4|0|volume,intensity,spans,rank,auto,1,0.45~0.55|src7|exact");
  assert.throws(() => E.lifecycle.memoKey(parts({ config: 7 })), isError("TypeError"));
});

test("memoKey validates its parts: four finite bounds, an object", () => {
  assert.throws(() => E.lifecycle.memoKey(null), isError("TypeError"));
  assert.throws(() => E.lifecycle.memoKey(parts({ bounds: [1, 2, 3] })), isError("TypeError"));
  assert.throws(() => E.lifecycle.memoKey(parts({ bounds: [1, 2, 3, NaN] })), isError("RangeError"));
  assert.throws(() => E.lifecycle.memoKey(parts({ bounds: undefined })), isError("TypeError"));
});

test("namespace shape", () => {
  assert.deepEqual(Object.keys(E.lifecycle).sort(), ["coherent", "controller", "memoKey", "settled"]);
  assert.ok(Object.isFrozen(E.lifecycle));
});
