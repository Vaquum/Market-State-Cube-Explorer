"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

// Hand arithmetic: 75 USDT across 3 buys; 112.5 across 2 sells.
// Imbalance = -37.5 / 187.5; side means 25 and 56.25; size ratio 2.25.
const cell = { v: 187.5, bv: 75, ct: 5, bt: 3 };
test("composition uses unrounded counters and the all-price denominator", () => {
  const x = E.measure.cellComposition({ z: cell, column: { v: 327.5 } });
  assert.equal(x.imbalance.result.value, -.2);
  assert.equal(x.buySize.result.value, 25);
  assert.equal(x.sellSize.result.value, 56.25);
  assert.equal(x.sizeRatio.result.value, 2.25);
  assert.equal(x.columnShare.result.value, 187.5 / 327.5);
  assert.equal(x.imbalance.formula, "cells.delta.share@1");
  assert.equal(x.imbalance.unit, "signed-share");
});
test("zero activity, absent sides and missing denominators stay distinct", () => {
  const empty = E.measure.cellComposition({ z: { v: 0, bv: 0, ct: 0, bt: 0 }, column: { v: 100 } });
  for (const key of ["imbalance", "buySize", "sellSize", "sizeRatio"]) assert.equal(empty[key].result.tag, "undefined");
  assert.equal(empty.columnShare.result.value, 0);
  const buyOnly = E.measure.cellComposition({ z: { v: 100, bv: 100, ct: 2, bt: 2 } });
  assert.equal(buyOnly.imbalance.result.value, 1);
  assert.equal(buyOnly.buySize.result.value, 50);
  assert.equal(buyOnly.sellSize.result.tag, "undefined");
  assert.equal(buyOnly.sizeRatio.result.tag, "undefined");
  assert.equal(buyOnly.columnShare.result.tag, "pending");
});
test("read state and replay suppress derived values before arithmetic", () => {
  for (const input of [{ read: { state: "pending", reason: "reading" } }, { read: { state: "failed", reason: "failed" } }, { hidden: true }]) {
    const records = E.measure.cellComposition({ z: cell, ...input });
    for (const record of Object.values(records)) assert.equal(record.result.tag, input.hidden ? "hidden" : input.read.state);
  }
  const bad = E.measure.cellComposition({ z: { ...cell, bt: 10 } });
  for (const record of Object.values(bad)) assert.equal(record.result.tag, "invalid-input");
});
test("band location uses interval overlap and nearest-edge signed distance", () => {
  const levels = { poc: 25062.5, valueLow: 25000, valueHigh: 25250 };
  const where = (low, high) => E.measure.bandLocation({ low, high, ...levels });
  assert.deepEqual(where(25000, 25125), { pocRelation: "Contains POC", valueRelation: "Inside value area", distance: 0 });
  assert.equal(where(24900, 25100).valueRelation, "Overlaps value-area low");
  assert.equal(where(24900, 25300).valueRelation, "Spans value area");
  assert.equal(where(25250, 25375).valueRelation, "Entirely above value");
  assert.equal(where(25250, 25375).distance, 187.5);
  assert.equal(where(24875, 25000).distance, -62.5);
  assert.equal(where(24875, 25062.5).pocRelation, "Touches POC");
  assert.equal(E.measure.bandLocation({ ...levels, low: 0, high: 0 }), null);
});
