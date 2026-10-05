"use strict";
// Oracle: hand-computed period volumes, means and log2 ratios. The viewport is never part of a period profile.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const plain = (x) => JSON.parse(JSON.stringify(x));

test("period relative volume uses every traded row, including gaps and off-screen peaks", () => {
  const rows = [{ r: 200, v: 1 }, { r: 201, v: 3 }, { r: 203, v: 2 }, { r: 204, v: 0 }];
  const before = JSON.stringify(rows), result = E.relvol.profile({ rows, m: 0 });
  assert.equal(result.state, "ok");
  assert.equal(result.meanVolume, 2);
  assert.equal(result.tradedRows, 3);
  assert.equal(result.at(200).value, -1);
  assert.ok(Math.abs(result.at(201).value - 0.5849625007211562) < 1e-12);
  assert.equal(result.at(203).value, 0);
  assert.equal(result.at(202).tag, "empty-both");
  assert.equal(result.at(199).tag, "outside-support");
  assert.deepEqual(plain(result.support.w), [200, 204]);
  assert.equal(JSON.stringify(rows), before);
});

test("coarse recorded rows retain their real price spans and mean", () => {
  const result = E.relvol.profile({ rows: [{ r: 25, v: 10 }, { r: 26, v: 30 }], m: 3 });
  assert.deepEqual(plain(result.support.w), [200, 216]);
  assert.equal(result.support.bm, 3);
  assert.equal(result.meanVolume, 20);
  assert.equal(result.at(25).value, -1);
  assert.ok(Math.abs(result.at(26).value - 0.5849625007211562) < 1e-12);
  assert.equal(result.restriction.dropped, 0);
});

test("uniform volume changes preserve relative levels; empty periods have no ratio", () => {
  const a = E.relvol.profile({ rows: [{ r: 2, v: 5 }, { r: 3, v: 15 }] });
  const b = E.relvol.profile({ rows: [{ r: 2, v: 50 }, { r: 3, v: 150 }] });
  for (const r of [2, 3]) assert.deepEqual(plain(a.at(r)), plain(b.at(r)));
  for (const rows of [[], [{ r: 200, v: 0 }]]) {
    const result = E.relvol.profile({ rows });
    assert.equal(result.state, "typed");
    assert.equal(result.typed.tag, "empty-population");
    assert.equal(result.meanVolume, 0);
  }
});

test("period read failures, pending reads, replay and stale state are preserved", () => {
  for (const [state, tag] of [["failed", "failed"], ["pending", "pending"], ["none", "hidden"], ["unrecorded", "unsupported"]]) {
    const result = E.relvol.profile({ rows: [{ r: 2, v: 5 }], read: { res: { state } } });
    assert.equal(result.typed.tag, tag);
  }
  const result = E.relvol.profile({ rows: [{ r: 2, v: 5 }], read: { res: { state: "ready" }, stale: true } });
  assert.equal(result.stale, true);
  assert.equal(result.at(2).value, 0);
});
