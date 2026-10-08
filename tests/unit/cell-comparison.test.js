"use strict";
// PRD-0006 D3-D6. Oracles: hand-calculated arithmetic and explicit input
// records, not encoding/comparison helpers. 100 USDT / (60 s × 125 USDT)
// and 200 USDT / (120 s × 125 USDT) both have intensity 100. Tied values
// [10,10,5] have competition ranks [1,1,3], median 10; shares differ in pp.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const C = require("../../src/comparison.js");
const FORMULAS = {
  "volume.amount": ["cells.volume.amount@1", "usdt"],
  "volume.intensity": ["cells.volume.intensity@1", "usdt-per-min-per-125usdt"],
  "trades.amount": ["cells.trades.amount@1", "trades"],
  "trades.intensity": ["cells.trades.intensity@1", "trades-per-min-per-125usdt"],
  "delta.amount": ["cells.delta.amount@1", "usdt"],
  "delta.intensity": ["cells.delta.intensity@1", "usdt-per-min-per-125usdt"],
  size: ["cells.size.mean@1", "usdt-per-trade"],
  flow: ["cells.flow.share@1", "share"],
  flowtrades: ["cells.flowtrades.share@1", "share"],
  path: ["cells.path.spans@1", "row-spans"],
  dwell: ["cells.dwell.share@1", "share"],
};
const T = Date.UTC(2021, 0, 1);
function record(key, value, extra = {}) {
  return { tag: "finite", value, formula: FORMULAS[key][0], unit: FORMULAS[key][1], supportEnd: T + 60000, knownThrough: T + 60000, ...extra };
}
function capture(id, values = {}, extra = {}) {
  return {
    id, instrument: "BTC/USDT", origin: T / 1000, c: 0, r: 200, level: { n: 0, m: 0 },
    nominal: { t0: T, t1: T + 60000, low: 25000, high: 25125 },
    observed: { t0: T, t1: T + 60000, low: 25000, high: 25125, seconds: 60, width: 125 },
    capturedAt: T + 60001, measuredThrough: T + 60000, source: { pack: "hand-vector" },
    completeness: "complete", metrics: Object.fromEntries(Object.entries(values).map(([key, amount]) => [key, record(key, amount)])), detail: [], ...extra,
  };
}
const entry = (analysis, key, id) => analysis.metrics[key][id];
test("closed descriptors and browser/CommonJS exports", () => {
  assert.deepEqual(C.METRICS.map((m) => m.key), ["volume", "trades", "size", "flow", "flowtrades", "delta", "path", "dwell", "poc"]);
  assert.equal(C.METRICS.find((m) => m.key === "volume").units.intensity, "usdt-per-min-per-125usdt");
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../src/comparison.js"), "utf8"), context);
  assert.equal(typeof context.window.explorerComparison.analyze, "function");
});
test("identity depends on original cell geometry, not capture revision or context", () => {
  const a = capture("a"), b = capture("other", {}, { capturedAt: T + 999999, source: "revised", detail: [{ label: "context", value: 9 }] });
  assert.equal(C.identity(a), C.identity(b));
  assert.notEqual(C.identity(a), C.identity({ ...a, level: { n: 1, m: 0 } }));
  assert.notEqual(C.identity(a), C.identity({ ...a, nominal: { ...a.nominal, high: 25250 } }));
  assert.throws(() => C.identity({ ...a, nominal: { ...a.nominal, t1: T } }), /identity/);
});
test("exact ties, median, unit difference and percentage are independently hand-derived", () => {
  const a = C.analyze([capture("a", { "volume.amount": 10 }), capture("b", { "volume.amount": 10 }), capture("c", { "volume.amount": 5 })]);
  assert.deepEqual(["a", "b", "c"].map((id) => entry(a, "volume", id).rank), [1, 1, 3]);
  assert.equal(entry(a, "volume", "c").reference, 10);
  assert.equal(entry(a, "volume", "c").difference, -5);
  assert.equal(entry(a, "volume", "c").percent, -50);
  assert.equal(entry(a, "volume", "c").count, 3);
  assert.deepEqual(entry(a, "volume", "a").domain, [0, 10]);
});
test("even medians stay finite and preserve equal subnormal values", () => {
  const large = C.analyze([capture("a", { "volume.amount": 1e308 }), capture("b", { "volume.amount": 1.6e308 })]);
  assert.equal(entry(large, "volume", "a").reference, 1.3e308);
  const tiny = C.analyze([capture("a", { "volume.amount": Number.MIN_VALUE }), capture("b", { "volume.amount": Number.MIN_VALUE })]);
  assert.equal(entry(tiny, "volume", "a").reference, Number.MIN_VALUE);
  const opposite = C.analyze([capture("a", { "delta.amount": -Number.MAX_VALUE }), capture("b", { "delta.amount": Number.MAX_VALUE })]);
  assert.equal(entry(opposite, "delta", "a").reference, 0);
});
test("signed algebraic ranks/sort preserve sign; shares use pp despite diverging colour metadata", () => {
  const a = C.analyze([capture("a", { "delta.amount": -100, flow: 0.25, dwell: 0.1, path: 2 }), capture("b", { "delta.amount": 1, flow: 0.5, dwell: 0.4, path: 4 }), capture("c", { "delta.amount": 2, flow: 0.75, dwell: 0.7, path: 6 })], { sort: { key: "delta" } });
  assert.deepEqual(a.ordered.map((c) => c.id), ["c", "b", "a"]);
  assert.deepEqual(["a", "b", "c"].map((id) => entry(a, "delta", id).rank), [3, 2, 1]);
  assert.equal(entry(a, "delta", "a").difference, -101);
  assert.equal(entry(a, "delta", "a").percent, null);
  assert.deepEqual(entry(a, "delta", "a").domain, [-100, 100]);
  assert.equal(entry(a, "flow", "a").difference, -25);
  assert.equal(entry(a, "flow", "a").percent, null);
  assert.ok(Math.abs(entry(a, "dwell", "a").difference + 30) < 1e-12);
  assert.equal(entry(a, "path", "a").difference, -2);
  assert.equal(entry(a, "path", "a").percent, null);
});
test("zero reference, missing pinned reference and singleton never manufacture peer evidence", () => {
  const captures = [capture("a", { "volume.amount": 0, path: 7 }), capture("b", { "volume.amount": 20 })];
  const a = C.analyze(captures, { reference: "a" });
  assert.equal(entry(a, "volume", "b").difference, 20);
  assert.equal(entry(a, "volume", "b").percent, null);
  assert.equal(entry(a, "path", "a").reason, "Only comparable cell");
  assert.equal(entry(a, "path", "a").rank, null);
  assert.equal(entry(a, "path", "a").domain, null);
  const b = C.analyze(captures, { reference: "missing" });
  assert.equal(entry(b, "volume", "a").reason, "Reference unavailable");
  assert.equal(entry(b, "volume", "b").difference, null);
  assert.equal(entry(b, "volume", "b").rank, 1);
});
test("Auto compares exact exposure area; explicit basis sticks; fixed intensity sort stays fixed", () => {
  const a = capture("a", { "volume.amount": 100, "volume.intensity": 100 });
  const b = capture("b", { "volume.amount": 200, "volume.intensity": 100 }, { observed: { t0: T, t1: T + 120000, low: 25000, high: 25125, seconds: 120, width: 125 } });
  const mixed = C.analyze([a, b]);
  assert.equal(mixed.basis, "intensity");
  assert.equal(mixed.geometryDiffers, true);
  assert.deepEqual(["a", "b"].map((id) => entry(mixed, "volume", id).rank), [1, 1]);
  const forced = C.analyze([a, b], { basis: "amount", sort: { key: "intensity", direction: "desc" } });
  assert.equal(forced.basis, "amount");
  assert.equal(forced.geometryDiffers, true);
  assert.equal(entry(forced, "volume", "b").difference, 50);
  assert.deepEqual(forced.ordered.map((c) => c.id), ["a", "b"]);
  const shaped = capture("c", { "volume.amount": 100 }, { observed: { seconds: 30, width: 250 } });
  assert.equal(C.analyze([a, shaped]).basis, "amount");
});
test("incompatible and typed nonvalues remain out of exact cohorts and last in both sort directions", () => {
  const a = capture("a", { "volume.amount": 10 }), b = capture("b", { "volume.amount": 99 }), c = capture("c", { "volume.amount": 8 });
  b.metrics["volume.amount"].formula = "cells.volume.amount@2";
  c.metrics["volume.amount"] = { tag: "undefined", reason: "No covered time", formula: "cells.volume.amount@1", unit: "usdt", supportEnd: T + 60000, knownThrough: T + 60000 };
  for (const direction of ["asc", "desc"]) {
    const analysis = C.analyze([b, a, c], { sort: { key: "volume", direction } });
    assert.deepEqual(analysis.ordered.map((item) => item.id), ["a", "b", "c"]);
    assert.equal(entry(analysis, "volume", "b").tag, "incompatible");
    assert.equal(entry(analysis, "volume", "a").count, 1);
    assert.equal(entry(analysis, "volume", "c").reason, "No covered time");
  }
});
test("replay requires actual support AND known-through; equality is allowed; stored values stay owned", () => {
  const a = capture("a", { "volume.amount": 934567.891234 });
  a.metrics["volume.amount"].knownThrough = T + 120000;
  a.metrics["volume.amount"].numerator = 934567.891234;
  a.metrics["volume.amount"].denominator = 999;
  const before = C.value(a, "volume", "amount", T + 60000);
  assert.equal(before.tag, "hidden");
  for (const field of ["value", "numerator", "denominator"]) assert.equal(Object.hasOwn(before, field), false);
  assert.equal(C.value(a, "volume", "amount", T + 120000).value, 934567.891234);
  a.metrics["volume.amount"].supportEnd = T + 180000;
  assert.equal(C.value(a, "volume", "amount", T + 120000).tag, "hidden");
  a.metrics["volume.amount"].supportEnd = null;
  assert.equal(C.value(a, "volume", "amount", T + 300000).tag, "hidden");
  assert.equal(C.value(a, "volume").value, 934567.891234);
  assert.equal(a.metrics["volume.amount"].numerator, 934567.891234);
});
test("POC centre-distance: lower edge contains, upper edge touches, and hidden reference never sorts numerically", () => {
  const poc = { price: 25125, label: "90 days", supportEnd: T + 60000, knownThrough: T + 120000 };
  const a = capture("a"), b = capture("b", {}, { nominal: { t0: T, t1: T + 60000, low: 25125, high: 25250 } }), c = capture("c", {}, { nominal: { t0: T, t1: T + 60000, low: 25375, high: 25500 } });
  const visible = C.analyze([c, a, b], { poc, edge: T + 120000, sort: { key: "poc" } });
  assert.deepEqual(visible.ordered.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(entry(visible, "poc", "a").relation, "Touches");
  assert.equal(entry(visible, "poc", "b").relation, "Contains");
  assert.equal(entry(visible, "poc", "c").value, 250);
  assert.deepEqual(["a", "b", "c"].map((id) => entry(visible, "poc", id).rank), [1, 1, 3]);
  const hidden = C.analyze([c, a, b], { poc, edge: T + 60000, sort: { key: "poc" } });
  assert.deepEqual(hidden.ordered.map((item) => item.id), ["c", "a", "b"]);
  assert.equal(entry(hidden, "poc", "a").value, null);
  assert.equal(entry(hidden, "poc", "a").rank, null);
});
test("all off-page values participate, sorts stay stable, and analysis does not mutate captures", () => {
  const records = Array.from({ length: 128 }, (_, i) => capture(String(i), { "volume.amount": i }));
  const before = JSON.stringify(records);
  const a = C.analyze(records, { sort: { key: "volume" } });
  assert.equal(entry(a, "volume", "0").reference, 63.5);
  assert.equal(entry(a, "volume", "0").rank, 128);
  assert.equal(entry(a, "volume", "0").count, 128);
  assert.equal(a.ordered[0].id, "127");
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(C.analyze(records, { sort: { key: "added", direction: "desc" } }).ordered.slice(0, 2).map((item) => item.id), ["127", "126"]);
});
test("zero/equal scales and derived overflow never create numeric infinity", () => {
  const zero = C.analyze([capture("a", { "volume.amount": 0 }), capture("b", { "volume.amount": 0 })]);
  assert.deepEqual(entry(zero, "volume", "a").domain, [0, 0]);
  assert.equal(entry(zero, "volume", "a").allEqual, true);
  const equal = C.analyze([capture("a", { "volume.amount": 20 }), capture("b", { "volume.amount": 20 })]);
  assert.equal(entry(equal, "volume", "a").allEqual, true);
  assert.equal(entry(zero, "volume", "a").difference, 0);
  assert.equal(entry(zero, "volume", "a").percent, null);
  const over = C.analyze([capture("a", { "delta.amount": -Number.MAX_VALUE }), capture("b", { "delta.amount": Number.MAX_VALUE })], { reference: "a" });
  assert.equal(entry(over, "delta", "b").difference, null);
  assert.equal(entry(over, "delta", "b").differenceReason, "Difference unavailable");
  const percent = C.analyze([capture("a", { "volume.amount": Number.MIN_VALUE }), capture("b", { "volume.amount": 1 })], { reference: "a" });
  assert.equal(entry(percent, "volume", "b").percent, null);
  assert.equal(entry(percent, "volume", "b").percentReason, "Percentage unavailable");
});
test("exact text copying gates every metric, scalar context and frozen POC, without raw numerator leakage", () => {
  const a = capture("a", { "volume.amount": 934567.891234, "volume.intensity": 918273.123456 }, { detail: [
    { label: "Context row", value: "Secret 827364.123", supportEnd: T + 60000, knownThrough: T + 60000 },
    { label: "USDT moved", value: 786543.123456, unit: "usdt", tag: "finite", supportEnd: T + 60000, knownThrough: T + 60000 },
  ] });
  a.metrics["volume.amount"].numerator = 999111.555;
  a.shortExposure = true; a.originalScale = "hand-scale"; a.when = { knownAtMs: null, knownAtReason: "Partial interval" };
  const poc = { price: 987654.4321, label: "90 days", supportEnd: T + 60000, knownThrough: T + 60000 };
  const hidden = C.captureText(a, { edge: T + 59999, poc });
  for (const secret of ["934567.891234", "918273.123456", "827364.123", "786543.123456", "987654.4321", "999111.555"]) assert.equal(hidden.includes(secret), false, secret);
  assert.ok(hidden.includes("Unavailable in replay"));
  const copied = C.captureText(a, { edge: T + 60000, poc });
  assert.ok(copied.includes("934567.891234 usdt"));
  assert.ok(copied.includes("786543.123456 usdt"));
  assert.ok(copied.includes("987654.4321 USDT"));
  assert.equal(copied.includes("999111.555"), false);
  for (const expected of ["Completeness: complete", "Exposure: Short exposure", "Original chart scale: hand-scale; not a comparison scale", "Structural whole-cell known at: Partial interval"]) assert.ok(copied.includes(expected), expected);
});
test("resort consumes cached gated statistics, including fixed intensity, without reanalysis", () => {
  const a = capture("a", { "volume.amount": 20, "volume.intensity": 40 });
  const b = capture("b", { "volume.amount": 10, "volume.intensity": 100 });
  const analysis = C.analyze([a, b], { basis: "amount", edge: T + 60000 });
  a.metrics["volume.amount"].value = 999;
  a.metrics["volume.intensity"].value = 999;
  b.metrics["volume.intensity"].supportEnd = T + 120000;
  assert.deepEqual(C.sort([a, b], { key: "volume", direction: "asc" }, analysis.metrics).map((item) => item.id), ["b", "a"]);
  assert.deepEqual(C.sort([a, b], { key: "intensity" }, analysis.metrics).map((item) => item.id), ["b", "a"]);
  assert.deepEqual(C.sort([a, b], { key: "added", direction: "desc" }, analysis.metrics).map((item) => item.id), ["b", "a"]);
  const later = C.analyze([a, b], { basis: "amount", edge: T + 60000 });
  assert.deepEqual(C.sort([a, b], { key: "intensity", direction: "asc" }, later.metrics).map((item) => item.id), ["a", "b"]);
});

test("signed normalized POC context preserves unsigned ranks and independently gates capture, ATR and reference", () => {
  const c = capture("a", {"volume.amount":10}, {contextOrigin:"frame-v2",context:{supports:{atr:{supportEnd:T,knownThrough:T,result:{tag:"finite",value:250}}},histories:[]}});
  const poc = {price:25250,supportEnd:T+60000,knownThrough:T+60000,label:"Prior POC"};
  assert.equal(C.normalizedPoc(c,poc).value,-.5); assert.equal(C.analyze([c],{poc}).metrics.poc.a.value,125);
  assert.equal(C.normalizedPoc(c,{...poc,price:24875}).value,.5);
  assert.equal(C.normalizedPoc(c,{...poc,price:25125}).relation,"Touches");
  assert.equal(C.normalizedPoc(c,{...poc,price:25000}).relation,"Contains");
  assert.match(C.normalizedPoc(c,{...poc,knownThrough:T+70000}).causal,/Later reference/);
  assert.equal(C.normalizedPoc(c,poc,T+59999).tag,"hidden"); assert.equal(C.normalizedPoc(c,poc,T+59999).numerator,undefined);
  c.context.supports.atr.knownThrough=T+70000;assert.equal(C.normalizedPoc(c,poc,T+60000).tag,"hidden");
  c.context.supports.atr.result.value=0;assert.equal(C.normalizedPoc(c,poc).tag,"undefined");
});
test("frozen history gates its own denominators independently of selected metric and retains explicit absence", () => {
  const c=capture("a",{}, {contextOrigin:"frame-v2",context:{supports:{own:{supportEnd:T,knownThrough:T},later:{supportEnd:T+60000,knownThrough:T+60000}},histories:[{id:"volume",formula:"fixture@1",unit:"usdt",slots:[{result:{tag:"finite",value:12},supportId:"own",denominatorIds:["later"]}]}]}});
  assert.equal(C.frozenHistory(c,"volume",T).slots[0].result.tag,"hidden");
  assert.equal(C.frozenHistory(c,"volume",T+60000).slots[0].result.value,12);
  assert.match(C.frozenHistory(c,"trades").reason,/not captured/);
  assert.match(C.frozenHistory({...c,contextOrigin:"legacy-structural"},"volume").reason,/not recorded/);
});

test("copy includes every frozen compact companion without adding comparison metrics",()=>{
  const c=capture("a",{}, {contextOrigin:"frame-v2",context:{supports:{own:{supportEnd:T,knownThrough:T}},histories:[{id:"imbalance",formula:"cells.imbalance@1",unit:"signed-share",slots:[{result:{tag:"finite",value:.5},supportId:"own",denominatorIds:[]}]}]}});
  assert.match(C.captureText(c),/Net taker imbalance frozen history: 0.5/);
  assert.equal(C.METRICS.length,9);
});
