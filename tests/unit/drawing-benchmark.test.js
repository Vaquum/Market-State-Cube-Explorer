"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
test("manual diagnostic pins the risk matrix without altering the paired navigation protocol", () => {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tools/benchmark/drawings.json"), "utf8"));
  assert.deepEqual(c.drawingCounts, [0,20,200]); assert.deepEqual(c.priceModes, ["volume","candles"]); assert.deepEqual(c.actions, ["pan","drag","play"]);
  assert.equal(c.samples, 5); assert.deepEqual(c.budgets, {p95DrawMs:10,p95FrameMs:20,p95InputToPaintMs:50,gestureIntervalOver33_3MsMaxShare:.01});
  assert.match(c.note, /diagnostic/); assert.match(c.note, /not a drawing edit/);
  assert.equal(Object.hasOwn(c,"schemaVersion"),false); assert.ok(Date.parse(c.camera.timeEnd)>Date.parse(c.camera.timeStart));
  assert.ok(c.camera.priceHighCents>c.camera.priceLowCents);
});
