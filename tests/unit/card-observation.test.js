"use strict";
// PRD-0007 / P7-S1. Oracle: hand arithmetic and declared half-open support rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

test("card observations retain typed values, support, exposure and independent denominator support", () => {
  const result = E.result.finite(12.5), observation = E.readout.observation({ formula: "columns.volume@1", unit: "usdt", result,
    time: [10, 12], price: [125, 250], level: { n: 1, m: 0 }, exposure: { seconds: 112.5 }, source: "synthetic", measuredThrough: 12,
    denominators: [{ time: [0, 10], value: 25 }], history: [{ time: [8, 10], result: E.result.make("unsupported", { reason: "gap" }) }] });
  assert.equal(observation.version, "card-observation@1");
  assert.deepEqual(JSON.parse(JSON.stringify(observation)), observation);
  assert.deepEqual(observation.time, [10, 12]);
  assert.deepEqual(observation.denominators[0].time, [0, 10]);
  assert.throws(() => E.readout.observation({ ...observation, result: { tag: "finite", value: NaN } }), /JSON-safe/);
});

test("normalization retains raw numerator and never manufactures ATR", () => {
  assert.equal(E.measure.normalized(-25, 50).result.value, -.5);
  assert.equal(E.measure.normalized(0, 50).result.value, 0);
  assert.ok(Math.abs(E.measure.normalized(1e-9, 50).result.value / 2e-11 - 1) < 1e-15);
  assert.equal(E.measure.normalized(1, null).result.tag, "unsupported");
  assert.equal(E.measure.normalized(1, 0).result.tag, "undefined");
  assert.equal(E.measure.normalized(1, -1).result.tag, "invalid-input");
});

test("daily ATR warms up on contiguous completed days and resets after gaps", () => {
  const days = Array.from({ length: 15 }, (_, k) => ({ k, high: 110, low: 90, close: 100, whole: true }));
  days[14] = { k: 14, high: 130, low: 90, close: 120, whole: true };
  const atr = E.measure.dailyATR(days);
  assert.equal(atr.has(12), false); assert.equal(atr.get(13), 20); assert.equal(atr.get(14), (13 * 20 + 40) / 14);
  const gap = [...days, ...Array.from({ length: 14 }, (_, i) => ({ k: 16 + i, high: 210, low: 190, close: 200, whole: true }))];
  const after = E.measure.dailyATR(gap);
  assert.equal(after.has(28), false); assert.equal(after.get(29), 20);
  const incomplete = days.map((x) => ({ ...x, whole: x.k !== 5 }));
  assert.equal(E.measure.dailyATR(incomplete).size, 0);
});

test("seasonal activity uses six fixed offsets and the eligible mean before division", () => {
  const cols = Array.from({ length: 80 }, (_, c) => ({ c, v: 10 }));
  const index = E.measure.seasonalIndex({ cols, n: 0, b0: 0, b1: 80, precision: "Float32", source: "synthetic" });
  const record = E.measure.seasonalActivity({ index, numerator: 40, start: 70, end: 72, cutoff: 72, week: 10 });
  assert.equal(record.count, 6); assert.equal(record.denominator, 20); assert.equal(record.result.value, 2);
  assert.deepEqual(record.matches.map((x) => x.time), [[60, 62], [50, 52], [40, 42], [30, 32], [20, 22], [10, 12]]);
  assert.equal(record.precision, "Float32");
});

test("missing coverage differs from observed zero, with no replacement weeks", () => {
  const cols = Array.from({ length: 80 }, (_, c) => ({ c, v: 10 })).filter((x) => ![60, 50, 40].includes(x.c));
  const index = E.measure.seasonalIndex({ cols, n: 0, b0: 0, b1: 80 });
  const x = E.measure.seasonalActivity({ index, numerator: 0, start: 70, end: 72, cutoff: 72, week: 10 });
  assert.equal(x.count, 3); assert.equal(x.result.tag, "unsupported");
  const zeros = E.measure.seasonalIndex({ cols: Array.from({ length: 80 }, (_, c) => ({ c, v: 0, covered: true })), n: 0, b0: 0, b1: 80 });
  for (const numerator of [0, 20]) {
    const z = E.measure.seasonalActivity({ index: zeros, numerator, start: 70, end: 72, cutoff: 72, week: 10 });
    assert.equal(z.count, 6); assert.equal(z.result.tag, "undefined");
  }
  const unknown = E.measure.seasonalIndex({ cols: [{ c: 0, v: 0 }], n: 0, b0: 0, b1: 1 });
  assert.equal(unknown.at(0, 1).tag, "unsupported");
  assert.equal(index.at(1.5, 2).tag, "unsupported");
});

test("overlapping targets, half-open contact and actual prefix length govern weekly eligibility", () => {
  const index = E.measure.seasonalIndex({ cols: Array.from({ length: 100000 }, (_, c) => ({ c, v: 1 })), n: 0, b0: 0, b1: 100000 });
  const read = (length) => E.measure.seasonalActivity({ index, numerator: length, start: 65000, end: 65000 + length, cutoff: 100000 });
  assert.equal(read(10752).count, 6); // First historical end equals target start.
  assert.equal(read(16384).count, 5);
  assert.equal(read(32768).count, 3); assert.equal(read(32768).result.tag, "unsupported");
  assert.equal(read(1024).count, 6); // A representable observed prefix is different from its nominal long interval.
  const replay = E.measure.seasonalActivity({ index, numerator: 20, start: 65000, end: 65020, cutoff: 65019 });
  assert.equal(replay.result.tag, "hidden");
});

test("VWAP bin dispersion uses centred estimated base weights and discloses approximation", () => {
  const x = E.measure.weightedBins({ rows: [{ r: 0, v: 62.5 }, { r: 1, v: 187.5 }], rowWidth: 125, vwap: 125, close: 187.5 });
  assert.equal(x.sigma, 62.5); assert.equal(x.result.value, 1); assert.equal(x.approximation, "quote volume / bin centre");
  assert.equal(E.measure.weightedBins({ rows: [{ r: 0, v: 62.5 }], rowWidth: 125, vwap: 62.5, close: 62.5 }).result.tag, "undefined");
  assert.equal(E.measure.weightedBins({ rows: [], rowWidth: 125, vwap: 125, close: 125 }).result.tag, "empty-population");
});
