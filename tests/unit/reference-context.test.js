"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), E = require("../support/enc");
// Hand arithmetic in raw units. No cube detector is reimplemented by these oracles.
test("reference location is positive above with causal knowledge and a prior ATR", () => {
  const arg = { close: 110, reference: 100, atr: 5, observedAt: 50, knownAt: 40 };
  assert.equal(E.measure.referenceLocation(arg).result.value, 2);
  assert.equal(E.measure.referenceLocation({ ...arg, close: 90 }).result.value, -2);
  assert.equal(E.measure.referenceLocation({ ...arg, observedAt: 39 }).result.tag, "unsupported");
  assert.equal(E.measure.referenceLocation({ ...arg, candidate: true }).result.tag, "unsupported");
  assert.equal(E.measure.referenceLocation({ ...arg, atr: null }).result.tag, "unsupported");
  assert.equal(E.measure.referenceLocation({ ...arg, atr: 0 }).result.tag, "undefined");
});
test("native RSI slope and daily ATR price slope require adjacent completed bars", () => {
  const arg = { value: 55, previous: 50, adjacent: true, complete: true, atr: 10 };
  assert.equal(E.measure.referenceSlope({ ...arg, native: true }).result.value, 5);
  assert.equal(E.measure.referenceSlope(arg).result.value, .5);
  assert.equal(E.measure.referenceSlope({ ...arg, adjacent: false }).result.tag, "unsupported");
  assert.equal(E.measure.referenceSlope({ ...arg, complete: false }).result.tag, "unsupported");
});
test("continuous Fibonacci depth is unclamped for both impulse directions", () => {
  for (const [a, b, c, expected] of [[100, 200, 175, .25], [200, 100, 125, .25], [100, 200, 225, -.25], [100, 200, 75, 1.25]]) assert.equal(E.measure.fibonacciDepth({ earlier: a, later: b, close: c }).value, expected);
  assert.equal(E.measure.fibonacciDepth({ earlier: 100, later: 100, close: 100 }).tag, "undefined");
});
test("weekend percentages use Friday as signed denominator, with equal and stale spots distinct", () => {
  assert.ok(Math.abs(E.measure.weekendPercent({ friday: 110000, sunday: 100000 }).value + 100 / 11) < 1e-12);
  assert.equal(E.measure.weekendPercent({ friday: 100000, sunday: 110000 }).value, 10);
  assert.equal(E.measure.weekendPercent({ friday: 100000, sunday: 100000 }).value, 0);
  assert.equal(E.measure.weekendPercent({ friday: 100000, sunday: 100000, stale: true }).tag, "unsupported");
});
test("prior-cycle identity needs completed deep-low and later exceedance, never the peak date", () => {
  const bars = [{ c: 1, low: 70, high: 100 }, { c: 2, low: 40, high: 80 }, { c: 3, low: 60, high: 110 }];
  const arg = { bars, price: 100, lowStart: 20, step: 10 };
  for (const edge of [29, 30, 39]) assert.equal(E.measure.priorCycleKnown({ ...arg, edge }), null);
  assert.equal(E.measure.priorCycleKnown({ ...arg, edge: 40 }), 40);
  assert.equal(E.measure.priorCycleKnown({ ...arg, bars: [{ c: 2, low: 40, high: 110 }], edge: 100 }), null, "same input cannot establish later exceedance ordering");
});
