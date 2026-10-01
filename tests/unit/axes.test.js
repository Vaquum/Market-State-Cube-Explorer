"use strict";
// U28 (T-axis): E.axis (part 16), the registered-axis catalogue, typed domains, the coordinate and ticks of an
// axis record and the Auto-axis state machine (API.md B.12, C.12, DR-18, DD-23, DD-40, DD-64, S1-017/018/112..114/125).
//
// Oracles (none is the code under test): the axis catalogue of API.md B.12 written out id by id; the typed
// domains by hand (no data -> "No data"; all zero -> "0"; otherwise the EXACT displayed maximum, 1.92e9 stays
// 1.92e9; the MACD, Signal and histogram series [-3, 2], [1, -5] and [4, 0.5] have extremes -5 and 4 and so ONE
// axis of +-5); the two ids of API.md A.2 for axis domains (`axis-linear` unsigned {0, 1920000000} ->
// fAie68jq2OF1287z, zero-only unsigned -> C5LleVNGDTk1DpfK); the cadence vectors of C.12 and DD-64 written as
// timelines on a fake clock the test moves by hand (a gesture ends at 1000: nextWake 200 and frame() at 1200
// refits; lastUpdateMs 1000 with a refit asked at 1200 answers hold "cap" and nextWake 300); the RSI and log2
// tick positions by arithmetic (t = value / 100, t = value / 2) and the ratio tick spacing (12 px between two
// kept ticks: a 48 px axis keeps all five, 47.9 px drops the halves). The registry reads no clock, so every
// `now` below is a number the test chose.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects are of another realm, so structures
// are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const CLIP = { NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 };
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;

// One summary callback that counts how often it is called, so "the signature is unchanged: no scan" is a fact.
function feed(max, min, count) {
  const f = () => {
    f.calls++;
    return { count: count === undefined ? 3 : count, max, min: min === undefined ? 0 : min };
  };
  f.calls = 0;
  return f;
}

function input(over) {
  return Object.assign({ sign: "unsigned", workspace: "live", cutMs: 1e12, now: 0, eligible: true, held: { gesture: false, play: false }, sig: "s0", summary: feed(100) }, over);
}

// ---- catalogue ------------------------------------------------------------------------------------------

test("catalogue: the 19 registered axes of B.12, ids with dots, each with its sign, default policy, natural domain and unit", () => {
  const expected = {
    "pane.volume": ["columns", "unsigned", "auto", null, "usdt"],
    "pane.trades": ["columns", "unsigned", "auto", null, "trades"],
    "pane.size": ["columns", "unsigned", "auto", null, "usdt-per-trade"],
    "pane.choppiness": ["columns", "unsigned", "auto", null, "path-per-range"],
    "pane.perpath": ["columns", "unsigned", "auto", null, "usdt-per-usdt-moved"],
    "pane.delta": ["columns", "signed-symmetric", "auto", null, "usdt"],
    "pane.takertrades": ["columns", "signed-symmetric", "auto", null, "trades"],
    "pane.cascade": ["columns", "ratio", "fixed", [-2, 2], "log2-ratio"],
    "pane.efficiency": ["columns", "ratio", "fixed", [-2, 2], "log2-ratio"],
    "pane.rsi1d": ["oscillator", "unsigned", "fixed", [0, 100], "index"],
    "pane.rsi4h": ["oscillator", "unsigned", "fixed", [0, 100], "index"],
    "pane.macd1d": ["oscillator", "signed-symmetric", "auto", null, "usdt"],
    "profile.current": ["profile", "unsigned", "auto", null, "usdt-per-row"],
    "profile.reference.volume": ["reference", "unsigned", "auto", null, "usdt"],
    "profile.reference.time": ["reference", "unsigned", "auto", null, "seconds"],
    "profile.reference.delta": ["reference", "signed-symmetric", "auto", null, "usdt"],
    "profile.reference.relvol": ["reference", "ratio", "fixed", [-2, 2], "log2-ratio"],
    "nav.time": ["navigation", "unsigned", "navigation", null, "time"],
    "nav.price": ["navigation", "unsigned", "navigation", null, "usdt"],
  };
  const got = plain(E.axis.CATALOGUE);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(expected).sort());
  assert.equal(Object.keys(expected).length, E.LIMITS.AXES_MAX, "19 axes: the import limit of B.12");
  for (const id of Object.keys(expected)) {
    const [channel, sign, policy, natural, unit] = expected[id];
    assert.equal(got[id].id, id);
    assert.equal(got[id].channel, channel, id);
    assert.equal(got[id].sign, sign, id);
    assert.equal(got[id].policy, policy, id);
    assert.deepEqual(got[id].natural, natural, id);
    assert.equal(got[id].unit, unit, id);
  }
  assert.deepEqual(got["pane.rsi1d"].guides, [30, 70]);
  assert.deepEqual(got["pane.rsi4h"].guides, [30, 70]);
  assert.ok(Object.isFrozen(E.axis.CATALOGUE));
  // Cells Delta and Columns Delta are one axis: there is a single `pane.delta`, not one per consumer.
  assert.equal(Object.keys(got).filter((k) => /delta/.test(k) && k.indexOf("reference") < 0).length, 1);
});

test("namespace shape", () => {
  assert.deepEqual(Object.keys(E.axis).sort(), ["CATALOGUE", "coordinate", "domain", "registry", "ticks"]);
  assert.ok(Object.isFrozen(E.axis));
  const r = E.axis.registry();
  assert.deepEqual(Object.keys(r).sort(), ["drop", "frame", "freeze", "get", "hasPending", "list", "nextWake", "unfreeze"]);
  assert.ok(Object.isFrozen(r));
});

// ---- typed domains --------------------------------------------------------------------------------------

test("domain: no displayed values is No data (never a maximum of 1)", () => {
  assert.deepEqual(plain(E.axis.domain("unsigned", { count: 0, max: 0, min: 0 })), { typed: "none", domain: null });
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 0, max: 0, min: 0 })), { typed: "none", domain: null });
});

test("domain: all zero is zero-only (label 0), never a claimed maximum", () => {
  assert.deepEqual(plain(E.axis.domain("unsigned", { count: 5, max: 0, min: 0 })), { typed: "zero-only", domain: [0, 0] });
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 5, max: 0, min: 0 })), { typed: "zero-only", domain: [0, 0] });
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 2, max: 0, min: -0 })), { typed: "zero-only", domain: [0, 0] });
});

test("domain: otherwise the EXACT displayed maximum, no nice rounding (1.92e9 stays 1.92e9)", () => {
  assert.deepEqual(plain(E.axis.domain("unsigned", { count: 58, max: 1920000000, min: 3 })), { typed: "finite", domain: [0, 1920000000] });
  assert.deepEqual(plain(E.axis.domain("unsigned", { count: 2, max: 1234567.891, min: 0 })), { typed: "finite", domain: [0, 1234567.891] });
  assert.deepEqual(plain(E.axis.domain("unsigned", { count: 1, max: 1e-300, min: 1e-300 })), { typed: "finite", domain: [0, 1e-300] });
});

test("domain: signed axes are symmetric about 0 over the larger magnitude of the two extremes", () => {
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 4, max: 3, min: -7 })), { typed: "finite", domain: [-7, 7] });
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 4, max: 9, min: -2 })), { typed: "finite", domain: [-9, 9] });
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 1, max: 0.25, min: 0.25 })), { typed: "finite", domain: [-0.25, 0.25] });
});

test("MACD, Signal and histogram share ONE symmetric axis (by hand: extremes -5 and 4 -> +-5)", () => {
  const macd = [-3, 2];
  const signal = [1, -5];
  const hist = [4, 0.5];
  const all = macd.concat(signal, hist);
  const summary = { count: all.length, max: 4, min: -5 }; // hand-read extremes of the six numbers
  assert.equal(Math.max(...all), 4);
  assert.equal(Math.min(...all), -5);
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", summary)), { typed: "finite", domain: [-5, 5] });
  // each series on its own would have drawn against a different axis: that is what "one axis" removes.
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 2, max: 2, min: -3 })).domain, [-3, 3]);
  assert.deepEqual(plain(E.axis.domain("signed-symmetric", { count: 2, max: 4, min: 0.5 })).domain, [-4, 4]);
});

test("domain: a summary that is not numbers is a caller bug and throws; a ratio axis has no fitted domain", () => {
  assert.throws(() => E.axis.domain("unsigned", null), isError("TypeError"));
  assert.throws(() => E.axis.domain("unsigned", {}), isError("TypeError"));
  assert.throws(() => E.axis.domain("unsigned", { count: 3, max: NaN, min: 0 }), isError("TypeError"));
  assert.throws(() => E.axis.domain("unsigned", { count: 3, max: 5 }), isError("TypeError"));
  assert.throws(() => E.axis.domain("unsigned", { count: 3, max: -5, min: -6 }), isError("RangeError"));
  assert.throws(() => E.axis.domain("ratio", { count: 3, max: 1, min: 0 }), isError("RangeError"));
  assert.throws(() => E.axis.domain("bogus", { count: 3, max: 1, min: 0 }), isError("RangeError"));
});

// ---- coordinate -----------------------------------------------------------------------------------------

function rec(sign, typed, domain) {
  return { sign, typed, domain };
}

test("coordinate: unsigned axis places a value from the low end, with exact ends and overflow named", () => {
  const r = rec("unsigned", "finite", [0, 100]);
  assert.deepEqual(plain(E.axis.coordinate(r, 50)), { t: 0.5, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(r, 25)), { t: 0.25, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(r, 0)), { t: 0, clip: CLIP.EXACT_LOW });
  assert.deepEqual(plain(E.axis.coordinate(r, 100)), { t: 1, clip: CLIP.EXACT_HIGH });
  assert.deepEqual(plain(E.axis.coordinate(r, 100.0001)), { t: 1, clip: CLIP.HIGH });
  assert.deepEqual(plain(E.axis.coordinate(r, -1)), { t: 0, clip: CLIP.LOW });
  // a held domain: the bar is clamped WITH the overflow flag (interim overflow, S1-112)
  assert.deepEqual(plain(E.axis.coordinate(rec("unsigned", "finite", [0, 1920000000]), 2400000000)), { t: 1, clip: CLIP.HIGH });
});

test("coordinate: an unsigned axis that does not start at 0 (a caller's fixed window) measures from its low end", () => {
  const r = rec("unsigned", "finite", [20, 120]);
  assert.deepEqual(plain(E.axis.coordinate(r, 70)), { t: 0.5, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(r, 20)), { t: 0, clip: CLIP.EXACT_LOW });
  assert.deepEqual(plain(E.axis.coordinate(r, 10)), { t: 0, clip: CLIP.LOW });
  assert.deepEqual(plain(E.axis.coordinate(r, 95)), { t: 0.75, clip: CLIP.NONE });
});

test("coordinate: signed axis is t in -1..1 with 0 at the midpoint", () => {
  const r = rec("signed-symmetric", "finite", [-5, 5]);
  assert.deepEqual(plain(E.axis.coordinate(r, 2.5)), { t: 0.5, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(r, -2.5)), { t: -0.5, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(r, 0)), { t: 0, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(r, 5)), { t: 1, clip: CLIP.EXACT_HIGH });
  assert.deepEqual(plain(E.axis.coordinate(r, -5)), { t: -1, clip: CLIP.EXACT_LOW });
  assert.deepEqual(plain(E.axis.coordinate(r, 6)), { t: 1, clip: CLIP.HIGH });
  assert.deepEqual(plain(E.axis.coordinate(r, -6)), { t: -1, clip: CLIP.LOW });
});

test("coordinate: a log2 ratio axis is the signed axis of +-2 (column Cascade +1 is half of +2)", () => {
  const r = rec("ratio", "finite", [-2, 2]);
  assert.deepEqual(plain(E.axis.coordinate(r, 1)), { t: 0.5, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(r, 2)), { t: 1, clip: CLIP.EXACT_HIGH });
  assert.deepEqual(plain(E.axis.coordinate(r, 2 + 1e-9)), { t: 1, clip: CLIP.HIGH });
  assert.deepEqual(plain(E.axis.coordinate(r, -2 - 1e-9)), { t: -1, clip: CLIP.LOW });
});

test("coordinate: a zero-only axis places 0 at t 0 and any other value out of domain, like a zero-only colour (DD-95)", () => {
  assert.deepEqual(plain(E.axis.coordinate(rec("unsigned", "zero-only", [0, 0]), 0)), { t: 0, clip: CLIP.NONE });
  assert.deepEqual(plain(E.axis.coordinate(rec("unsigned", "zero-only", [0, 0]), 3)), { t: 1, clip: CLIP.HIGH });
  assert.deepEqual(plain(E.axis.coordinate(rec("unsigned", "zero-only", [0, 0]), -3)), { t: 0, clip: CLIP.LOW });
  assert.deepEqual(plain(E.axis.coordinate(rec("signed-symmetric", "zero-only", [0, 0]), 3)), { t: 1, clip: CLIP.HIGH });
  assert.deepEqual(plain(E.axis.coordinate(rec("signed-symmetric", "zero-only", [0, 0]), -3)), { t: -1, clip: CLIP.LOW });
});

test("coordinate: an axis with no domain places nothing (t 0, no clip); NaN has no place; `out` is reused", () => {
  assert.deepEqual(plain(E.axis.coordinate(rec("unsigned", "none", null), 7)), { t: 0, clip: CLIP.NONE });
  assert.throws(() => E.axis.coordinate(rec("unsigned", "finite", [0, 10]), NaN), isError("TypeError"));
  const out = { t: -9, clip: -9 };
  const back = E.axis.coordinate(rec("unsigned", "finite", [0, 10]), 5, out);
  assert.equal(back, out);
  assert.equal(out.t, 0.5);
  assert.equal(out.clip, CLIP.NONE);
});

// ---- ticks ----------------------------------------------------------------------------------------------

test("ticks: unsigned 0 and the maximum; signed -M, 0, +M; zero-only just 0; no data none", () => {
  assert.deepEqual(plain(E.axis.ticks(rec("unsigned", "finite", [0, 80]), 100)).map((t) => [t.value, t.t]), [[0, 0], [80, 1]]);
  assert.deepEqual(plain(E.axis.ticks(rec("signed-symmetric", "finite", [-8, 8]), 100)).map((t) => [t.value, t.t]), [[-8, -1], [0, 0], [8, 1]]);
  assert.deepEqual(plain(E.axis.ticks(rec("unsigned", "zero-only", [0, 0]), 100)).map((t) => t.value), [0]);
  assert.deepEqual(plain(E.axis.ticks(rec("unsigned", "none", null), 100)), []);
});

test("ticks: RSI is 0, 30, 70, 100 at t = value / 100; numbers carry no label (the caller formats them)", () => {
  const r = E.axis.registry().frame("pane.rsi1d", { cutMs: 1, now: 0, eligible: true, sig: "x" });
  const t = plain(E.axis.ticks(r, 120));
  assert.deepEqual(t.map((x) => x.value), [0, 30, 70, 100]);
  assert.deepEqual(t.map((x) => x.t), [0, 0.3, 0.7, 1]);
  assert.deepEqual(t.map((x) => x.kind), ["end", "guide", "guide", "end"]);
  for (const x of t) assert.equal(x.label, undefined);
});

test("ticks: a log2 ratio axis keeps the ticks that fit, with their readings; 12 px between two kept ticks", () => {
  const r = E.axis.registry().frame("pane.cascade", { cutMs: 1, now: 0, eligible: true, sig: "x" });
  const full = plain(E.axis.ticks(r, 120));
  assert.deepEqual(full.map((x) => x.value), [-2, -1, 0, 1, 2]);
  assert.deepEqual(full.map((x) => x.t), [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(full.map((x) => x.label), ["1/4×", "1/2×", "1×", "2×", "4×"]);
  // 48 px: the five ticks sit exactly 12 px apart, which is allowed; 47.9 px: 11.975 apart, the halves drop.
  assert.equal(plain(E.axis.ticks(r, 48)).length, 5);
  assert.deepEqual(plain(E.axis.ticks(r, 47.9)).map((x) => x.value), [-2, 0, 2]);
  assert.deepEqual(plain(E.axis.ticks(r, 0)), []);
});

// ---- registry: fixed axes, navigation, errors ----------------------------------------------------------

test("fixed axes return their natural domain and the same record every frame; the caller fills in clip counts on it", () => {
  const reg = E.axis.registry();
  const a = reg.frame("pane.cascade", { cutMs: 1, now: 0, eligible: true });
  assert.equal(a.policy, "fixed");
  assert.equal(a.typed, "finite");
  assert.deepEqual(plain(a.domain), [-2, 2]);
  assert.deepEqual(plain(a.natural), [-2, 2]);
  assert.equal(a.provenance.kind, "fixed");
  assert.equal(a.hold, null);
  assert.equal(a.mappingId, E.scale.id({ v: 1, kind: "axis-linear", signed: true, params: { lo: -2, hi: 2 }, clip: "axis@1" }));
  a.clipped.count = 3;
  const b = reg.frame("pane.cascade", { cutMs: 2, now: 99, eligible: false });
  assert.equal(b, a, "the same record, eligible or not: a natural domain needs no data");
  assert.equal(b.clipped.count, 3);
  const r = reg.frame("pane.rsi1d", { cutMs: 1, now: 0, eligible: true });
  assert.deepEqual(plain(r.domain), [0, 100]);
  assert.equal(r.sign, "unsigned");
  assert.equal(reg.hasPending(), false, "a fixed axis never waits");
  assert.equal(reg.nextWake({ now: 0 }), null);
});

test("a fixed axis with a caller's domain must keep its symmetry (signed) or its order", () => {
  const reg = E.axis.registry();
  assert.deepEqual(plain(reg.frame("pane.cascade", { cutMs: 1, now: 0, fixed: [-3, 3] }).domain), [-3, 3]);
  assert.throws(() => reg.frame("pane.efficiency", { cutMs: 1, now: 0, fixed: [-1, 3] }), isError("RangeError"));
  assert.throws(() => reg.frame("pane.rsi4h", { cutMs: 1, now: 0, fixed: [50, 50] }), isError("RangeError"));
});

test("navigation axes are read-only records, never stored or persisted", () => {
  const reg = E.axis.registry();
  const n = reg.frame("nav.time", { domain: [10, 20], cutMs: 1, now: 0 });
  assert.equal(n.policy, "navigation");
  assert.deepEqual(plain(n.domain), [10, 20]);
  assert.equal(n.mappingId, null);
  assert.equal(reg.frame("nav.price", {}).typed, "none");
  assert.deepEqual(plain(reg.list()), []);
  assert.equal(reg.get("nav.time"), null);
  assert.throws(() => reg.freeze("nav.time", { domain: [0, 1] }), isError("RangeError"));
});

test("errors: an unknown id, a workspace that is neither live nor replay, a missing clock or summary", () => {
  const reg = E.axis.registry();
  assert.throws(() => reg.frame("pane.nothing", input()), isError("RangeError"));
  assert.throws(() => reg.frame("pane.volume", input({ workspace: "both" })), isError("RangeError"));
  assert.throws(() => reg.frame("pane.volume", input({ now: undefined })), isError("TypeError"));
  assert.throws(() => reg.frame("pane.volume", input({ cutMs: undefined })), isError("TypeError"));
  assert.throws(() => reg.frame("pane.volume", input({ summary: undefined })), isError("TypeError"));
  assert.throws(() => reg.frame("pane.volume", null), isError("TypeError"));
  assert.throws(() => E.axis.registry({ settleMs: -1 }), isError("TypeError"));
  assert.throws(() => reg.nextWake({}), isError("TypeError"));
  assert.equal(reg.frame("pane.volume", input({ summary: feed(0, 0, 0) })).typed, "none", "a failed fit above did not store anything");
});

// ---- registry: the Auto-axis machine --------------------------------------------------------------------

test("initial fit is immediate and exact: nothing to freeze, even while a gesture is active (DD-40); initial is labelled", () => {
  const reg = E.axis.registry();
  const r = reg.frame("pane.volume", input({ now: 500, cutMs: 9000, held: { gesture: true, play: false }, summary: feed(1920000000) }));
  assert.equal(r.policy, "auto");
  assert.equal(r.typed, "finite");
  assert.deepEqual(plain(r.domain), [0, 1920000000]);
  assert.equal(r.mappingId, "fAie68jq2OF1287z", "the id of the axis-linear domain {0, 1.92e9} (API.md A.2)");
  assert.equal(r.initial, true);
  assert.equal(r.hold, null);
  assert.deepEqual(plain(r.provenance), { kind: "auto", through: 9000, generation: 0, token: null, workspace: "live", cohort: { count: 3 } });
  assert.deepEqual(plain(r.clipped), { low: 0, high: 0, count: 0, total: 3 });
  assert.equal(reg.get("pane.volume"), r);
  assert.deepEqual(plain(reg.list().map((x) => x.id)), ["pane.volume"]);
});

test("No data and zero-only are typed, never a maximum of 1; their mapping ids are none and the zero-only id", () => {
  const reg = E.axis.registry();
  const none = reg.frame("pane.volume", input({ summary: feed(0, 0, 0) }));
  assert.equal(none.typed, "none");
  assert.equal(none.domain, null);
  assert.equal(none.mappingId, null);
  const reg2 = E.axis.registry();
  const zero = reg2.frame("pane.trades", input({ summary: feed(0, 0, 4) }));
  assert.equal(zero.typed, "zero-only");
  assert.deepEqual(plain(zero.domain), [0, 0]);
  assert.equal(zero.mappingId, "C5LleVNGDTk1DpfK", "the zero-only unsigned id (API.md A.2)");
});

test("a signed axis (MACD) fits one symmetric domain over all three series", () => {
  const reg = E.axis.registry();
  const r = reg.frame("pane.macd1d", input({ sign: "signed-symmetric", summary: feed(4, -5, 6) }));
  assert.deepEqual(plain(r.domain), [-5, 5]);
  assert.equal(r.sign, "signed-symmetric");
});

test("a gesture ends at 1000: nextWake is 200 and frame() at 1200 refits (API.md C.12, DD-64)", () => {
  const reg = E.axis.registry();
  const s = feed(200);
  assert.deepEqual(plain(reg.frame("pane.volume", input({ now: 0, sig: "s0" })).domain), [0, 100]);
  const held = reg.frame("pane.volume", input({ now: 1000, sig: "s1", held: { gesture: true }, summary: s }));
  assert.deepEqual(plain(held.domain), [0, 100], "the old domain is kept during the gesture");
  assert.equal(held.hold, "gesture");
  assert.equal(reg.hasPending(), true);
  assert.equal(reg.nextWake({ now: 1000 }), 200);
  const settling = reg.frame("pane.volume", input({ now: 1100, sig: "s1", summary: s }));
  assert.equal(settling.hold, "settling", "less than 200 ms quiet: keep");
  assert.equal(reg.nextWake({ now: 1100 }), 100);
  const fresh = reg.frame("pane.volume", input({ now: 1200, sig: "s1", summary: s }));
  assert.deepEqual(plain(fresh.domain), [0, 200]);
  assert.equal(fresh.hold, null);
  assert.equal(fresh.initial, false);
  assert.equal(reg.hasPending(), false);
  assert.equal(reg.nextWake({ now: 1200 }), null);
});

test("cap: a refit asked 200 ms after the last update answers hold cap and nextWake 300; it refits at 500 (API.md C.12)", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 1000, sig: "s0" }));
  const s = feed(300);
  const capped = reg.frame("pane.volume", input({ now: 1200, sig: "s1", summary: s }));
  assert.equal(capped.hold, "cap");
  assert.deepEqual(plain(capped.domain), [0, 100]);
  assert.equal(reg.nextWake({ now: 1200 }), 300);
  assert.equal(reg.frame("pane.volume", input({ now: 1499, sig: "s1", summary: s })).hold, "cap");
  const refit = reg.frame("pane.volume", input({ now: 1500, sig: "s1", summary: s }));
  assert.equal(refit.hold, null);
  assert.deepEqual(plain(refit.domain), [0, 300]);
});

test("the later of the settle time and the cap decides the label; a wheel stamp without a held flag counts as a gesture", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 900, sig: "s0" }));
  const s = feed(150);
  // gesture at 1000 (lastGestureAt), frame at 1100: settle ends 1200, cap ends 1400 -> cap is later.
  const r = reg.frame("pane.volume", input({ now: 1100, sig: "s1", lastGestureAt: 1000, summary: s }));
  assert.equal(r.hold, "cap");
  assert.equal(reg.nextWake({ now: 1100 }), 300);
  // gesture at 1350, frame at 1360: settle ends 1550, later than the cap (1400): settling.
  const r2 = reg.frame("pane.volume", input({ now: 1360, sig: "s1", lastGestureAt: 1350, summary: s }));
  assert.equal(r2.hold, "settling");
  assert.equal(reg.nextWake({ now: 1360 }), 190);
  assert.equal(reg.frame("pane.volume", input({ now: 1550, sig: "s1", lastGestureAt: 1350, summary: s })).hold, null);
});

test("an unchanged signature is a no-op: the displayed values are not scanned again", () => {
  const reg = E.axis.registry();
  const s = feed(100);
  reg.frame("pane.volume", input({ now: 0, sig: "a", summary: s }));
  assert.equal(s.calls, 1);
  for (let t = 100; t < 2000; t += 100) reg.frame("pane.volume", input({ now: t, sig: "a", summary: s }));
  assert.equal(s.calls, 1);
});

test("Updating only while a fresh domain would differ: a new signature with the same domain leaves no hold and no wake", () => {
  const reg = E.axis.registry();
  const s = feed(100);
  reg.frame("pane.volume", input({ now: 0, sig: "a", summary: s }));
  const r = reg.frame("pane.volume", input({ now: 1000, sig: "b", held: { gesture: true }, summary: s }));
  assert.equal(r.hold, null, "panning over the same maximum is not an update in waiting");
  assert.equal(reg.hasPending(), false);
  assert.equal(reg.nextWake({ now: 1000 }), null);
  assert.equal(s.calls, 2);
  // the signature was taken over, so the next frame with "b" does not scan again.
  reg.frame("pane.volume", input({ now: 1100, sig: "b", summary: s }));
  assert.equal(s.calls, 2);
});

test("Play holds the record (Auto paused) and has no timer; pausing lets the refit run after the settle time", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 0, sig: "a" }));
  const s = feed(500);
  const r = reg.frame("pane.volume", input({ now: 2000, sig: "b", held: { play: true }, summary: s }));
  assert.equal(r.hold, "play");
  assert.deepEqual(plain(r.domain), [0, 100]);
  assert.equal(reg.hasPending(), true);
  assert.equal(reg.nextWake({ now: 2000 }), null, "Play has no timer: it wakes from the pause");
  assert.equal(reg.nextWake({ now: 2000, playing: true }), null);
  // paused at 2100: the last Play frame was at 2000, so 200 ms must pass.
  assert.equal(reg.frame("pane.volume", input({ now: 2100, sig: "b", summary: s })).hold, "settling");
  assert.deepEqual(plain(reg.frame("pane.volume", input({ now: 2200, sig: "b", summary: s })).domain), [0, 500]);
});

test("while Play runs no Auto axis has a timer, whatever else holds it (env.playing)", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 1000, sig: "a" }));
  assert.equal(reg.frame("pane.volume", input({ now: 1200, sig: "b", summary: feed(300) })).hold, "cap");
  assert.equal(reg.nextWake({ now: 1200 }), 300);
  assert.equal(reg.nextWake({ now: 1200, playing: true }), null);
  assert.equal(reg.nextWake({ now: 1200, playing: false }), 300);
});

test("not eligible: the record is kept and marked waiting; with none, nothing is fitted or stored", () => {
  const reg = E.axis.registry();
  const s = feed(100);
  const w = reg.frame("pane.volume", input({ eligible: false, summary: s }));
  assert.equal(w.typed, "none");
  assert.equal(w.domain, null);
  assert.equal(w.hold, "waiting");
  assert.equal(s.calls, 0, "no scan of incoherent data");
  assert.equal(reg.get("pane.volume"), null);
  assert.deepEqual(plain(reg.list()), []);
  reg.frame("pane.volume", input({ now: 10, sig: "a", summary: s }));
  const kept = reg.frame("pane.volume", input({ now: 20, sig: "b", eligible: false, summary: feed(9999) }));
  assert.deepEqual(plain(kept.domain), [0, 100]);
  assert.equal(kept.hold, "waiting");
  assert.equal(reg.hasPending(), true);
  assert.equal(reg.nextWake({ now: 20 }), null, "waiting wakes from data events, not a timer");
  // eligible again and nothing changed: the hold clears.
  assert.equal(reg.frame("pane.volume", input({ now: 30, sig: "a" })).hold, null);
});

test("replay: a record fitted on observations after the cutoff is dropped BEFORE painting and refitted at once", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 0, cutMs: 1000, sig: "a", summary: feed(100) }));
  // scrub back to 900 at now 10: the old record's through (1000) is in the future of the replay edge.
  const r = reg.frame("pane.volume", input({ now: 10, cutMs: 900, sig: "b", summary: feed(40) }));
  assert.deepEqual(plain(r.domain), [0, 40], "the future-fitted domain is never shown");
  assert.equal(r.provenance.through, 900);
  assert.equal(r.hold, null, "no cap and no settle applies to a dropped record");
  // not eligible at that moment: dropped, and nothing stands in for it.
  const reg2 = E.axis.registry();
  reg2.frame("pane.volume", input({ now: 0, cutMs: 1000, sig: "a" }));
  const w = reg2.frame("pane.volume", input({ now: 10, cutMs: 900, sig: "b", eligible: false }));
  assert.equal(w.typed, "none");
  assert.equal(w.hold, "waiting");
  assert.equal(reg2.get("pane.volume"), null);
  // a record fitted at or before the cutoff stays: through === cutMs is not in the future.
  const reg3 = E.axis.registry();
  reg3.frame("pane.volume", input({ now: 0, cutMs: 1000, sig: "a" }));
  assert.equal(reg3.frame("pane.volume", input({ now: 10, cutMs: 1000, sig: "a" })).provenance.through, 1000);
});

test("live and replay axes are separate records; dropping the replay workspace leaves live alone", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ workspace: "live", summary: feed(100) }));
  reg.frame("pane.volume", input({ workspace: "replay", summary: feed(7) }));
  reg.frame("pane.trades", input({ workspace: "replay", summary: feed(9) }));
  assert.deepEqual(plain(reg.get("pane.volume", "live").domain), [0, 100]);
  assert.deepEqual(plain(reg.get("pane.volume", "replay").domain), [0, 7]);
  assert.equal(reg.get("pane.volume", "live").provenance.workspace, "live");
  assert.equal(reg.get("pane.volume", "replay").provenance.workspace, "replay");
  assert.deepEqual(plain(reg.list().map((r) => r.provenance.workspace + ":" + r.id)), ["live:pane.volume", "replay:pane.volume", "replay:pane.trades"]);
  assert.equal(reg.drop(null, "replay"), 2);
  assert.deepEqual(plain(reg.list().map((r) => r.provenance.workspace + ":" + r.id)), ["live:pane.volume"]);
  assert.equal(reg.drop("pane.volume", "live"), 1);
  assert.equal(reg.drop("pane.volume", "live"), 0);
  assert.deepEqual(plain(reg.list()), []);
});

test("freeze: the DISPLAYED domain is held (Comparison lock); frame() returns it unchanged and does not scan", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 0, cutMs: 1000, sig: "a", summary: feed(100) }));
  const f = reg.freeze("pane.volume");
  assert.equal(f.policy, "frozen");
  assert.deepEqual(plain(f.domain), [0, 100]);
  assert.equal(f.provenance.kind, "frozen");
  assert.equal(f.provenance.through, 1000);
  assert.equal(f.mappingId, reg.get("pane.volume").mappingId);
  const s = feed(9999);
  const again = reg.frame("pane.volume", input({ now: 5000, cutMs: 1000, sig: "zzz", held: { gesture: true }, summary: s }));
  assert.equal(again, f);
  assert.deepEqual(plain(again.domain), [0, 100]);
  assert.equal(again.hold, null);
  assert.equal(s.calls, 0);
  assert.equal(again.external, false);
  assert.equal(reg.hasPending(), false);
});

test("a frozen axis whose observations end after the cutoff is flagged external (replay), never invalidated", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 0, cutMs: 1000, sig: "a", summary: feed(100) }));
  reg.freeze("pane.volume");
  const r = reg.frame("pane.volume", input({ now: 10, cutMs: 900, sig: "b" }));
  assert.deepEqual(plain(r.domain), [0, 100]);
  assert.equal(r.external, true);
  assert.equal(reg.frame("pane.volume", input({ now: 20, cutMs: 1000, sig: "b" })).external, false);
});

test("freeze with nothing recorded creates nothing (DD-22: a lock never makes frozen state from nothing); an explicit domain does", () => {
  const reg = E.axis.registry();
  assert.equal(reg.freeze("pane.volume"), null);
  assert.equal(reg.get("pane.volume"), null);
  const r = reg.freeze("pane.volume", { domain: [0, 1234567.891], through: 500 });
  assert.equal(r.policy, "frozen");
  assert.equal(String(r.domain[1]), "1234567.891", "the decimal round-trips exactly");
  assert.equal(r.provenance.through, 500);
  assert.equal(reg.freeze("pane.delta", { domain: [-0.30000000000000004, 0.30000000000000004] }).domain[1], 0.30000000000000004);
  assert.equal(reg.freeze("pane.size", { domain: [0, 0] }).typed, "zero-only");
  // through 500 is after a cutoff of 1: external; a domain restored with no `through` is never external.
  assert.equal(reg.frame("pane.volume", input({ cutMs: 1, sig: "q" })).external, true);
  reg.freeze("pane.trades", { domain: [0, 10] });
  assert.equal(reg.frame("pane.trades", input({ cutMs: 1, sig: "q" })).external, false);
});

test("freeze validates: unsigned from 0, signed symmetric, lo <= hi, finite; fixed and navigation axes cannot be frozen", () => {
  const reg = E.axis.registry();
  for (const bad of [[1, 5], [0, -1], [NaN, 5], [0, Infinity], "x", [0], [0, 1, 2]]) assert.throws(() => reg.freeze("pane.volume", { domain: bad }), isError("RangeError"), JSON.stringify(bad));
  for (const bad of [[-3, 5], [0, 5], [-5, 3]]) assert.throws(() => reg.freeze("pane.delta", { domain: bad }), isError("RangeError"), JSON.stringify(bad));
  assert.throws(() => reg.freeze("pane.cascade", { domain: [-2, 2] }), isError("RangeError"));
  assert.throws(() => reg.freeze("pane.rsi1d", { domain: [0, 100] }), isError("RangeError"));
});

test("unfreeze returns the axis to Auto: it keeps its domain until the next eligible frame refits it; unknown or unfrozen is null", () => {
  const reg = E.axis.registry();
  reg.frame("pane.volume", input({ now: 0, cutMs: 1000, sig: "a", summary: feed(100) }));
  reg.freeze("pane.volume");
  const back = reg.unfreeze("pane.volume");
  assert.equal(back.policy, "auto");
  assert.equal(back.provenance.kind, "auto");
  assert.deepEqual(plain(back.domain), [0, 100]);
  assert.equal(reg.unfreeze("pane.volume"), null, "already auto");
  assert.equal(reg.unfreeze("pane.trades"), null, "nothing recorded");
  const r = reg.frame("pane.volume", input({ now: 1000, cutMs: 1000, sig: "a", summary: feed(250) }));
  assert.deepEqual(plain(r.domain), [0, 250], "the cleared signature makes the next frame re-evaluate, and no cap applies");
});

test("the registry keeps state inside the object it returns: two registries share nothing (DD-02)", () => {
  const a = E.axis.registry();
  const b = E.axis.registry();
  a.frame("pane.volume", input({ summary: feed(5) }));
  assert.equal(b.get("pane.volume"), null);
  assert.equal(b.hasPending(), false);
});

test("settleMs and autoMs are the registry's own: a slower registry waits longer", () => {
  const reg = E.axis.registry({ settleMs: 1000, autoMs: 2000 });
  reg.frame("pane.volume", input({ now: 0, sig: "a" }));
  const s = feed(300);
  assert.equal(reg.frame("pane.volume", input({ now: 1500, sig: "b", summary: s })).hold, "cap");
  assert.equal(reg.nextWake({ now: 1500 }), 500);
  assert.deepEqual(plain(reg.frame("pane.volume", input({ now: 2000, sig: "b", summary: s })).domain), [0, 300]);
});

// ---- the per-bar path allocates nothing ----------------------------------------------------------------

test("hot path (INTEGRATION D.15): E.axis.coordinate with an `out` has no per-call construction beyond the optional default", () => {
  // A source guard in the spirit of U49: the per-column call is the only per-bar function of this part. The
  // default `out` literal (used when a caller passes none) is the one allowed object; nothing else may be built.
  const src = E.axis.coordinate.toString().replace(/throw new [A-Za-z]+\([^)]*\);/g, "");
  for (const bad of ["new ", ".map(", ".filter(", ".slice(", ".sort(", "...", "Object.assign", "Array.from", "d3.", "Math.log"]) assert.equal(src.indexOf(bad), -1, bad);
  const out = { t: 0, clip: 0 };
  const r = rec("signed-symmetric", "finite", [-8, 8]);
  const heap = () => (typeof process.memoryUsage === "function" ? process.memoryUsage().heapUsed : 0);
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    const before = heap();
    for (let i = 0; i < 1e6; i++) E.axis.coordinate(r, (i % 17) - 8, out);
    globalThis.gc();
    assert.ok(heap() - before < 1024 * 1024, "1e6 calls grew the heap by more than 1 MB");
  } else {
    for (let i = 0; i < 1e5; i++) E.axis.coordinate(r, (i % 17) - 8, out);
  }
  assert.equal(out.clip, CLIP.NONE);
});
