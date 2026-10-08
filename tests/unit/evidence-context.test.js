"use strict";
// S3-STATE/OUTCOME/BOOTSTRAP: literal method vectors, hand-built candidate ledger
// and disjoint populations. No renderer, fake service or detector supplies expectations.
const test = require("node:test"), assert = require("node:assert/strict");
const H = require("../../src/evidence.js"), E = require("../../src/encoding.js");
const key = ["seasonal-state@1","block-bootstrap@2","next-poc","example",0,0,[0,100,0,1],100,100,[100,100,null,100],"0".repeat(64),[0,1],[1,2],[0,1,2],1,1,8,64521,"prior-positive-volume","prior-seasonal-eligible","observed-f32"];
const provenance = { instrument: "example", sourceDigest: "0".repeat(64), priceLow: 0, priceHigh: 1, sourceCutoff: 100, canonicalCutoff: 100, replayEdge: null, precisionID: "observed-f32" };
function input(cols, n = 0) { return { cols, n, m: 0, a: cols.length - 1, b0: 0, b1: cols.length * 2 ** n, barrier: 1, kind: "next-poc", horizon: 1, provenance,
  seasonal: ({ numerator, start, end }) => ({ result: { tag: "finite", value: numerator / 10 }, numerator, denominator: 10, time: [start, end], matches: [] }) }; }
const cols = (count) => Array.from({ length: count }, (_, c) => ({ c, v: 10, bv: 5, poc: 100, covered: true }));
test("literal UTF-8 FNV suffix and sequential xorshift32 stream", () => {
  const seed = H.fnv(JSON.stringify(key) + H.BOOTSTRAP); assert.equal(seed, 307206015);
  const rng = H.random(seed), actual = Array.from({ length: 6 }, rng);
  assert.deepEqual(actual, [4104184527,4158103763,2054547349,375635478,1435014662,2923872738]);
  assert.deepEqual(actual.map((x) => Math.floor(x / 4294967296 * 2)), [1,1,0,0,0,1]);
  assert.equal(H.quantile([0,10,20,30], 1 / 3), 10); assert.equal(H.quantile([0,10,20,30], 2 / 3), 20);
  assert.ok(Math.abs(H.quantile([0,10,20,30], .025) - .75) < 1e-14); assert.equal(H.quantile([0,10,20,30], .975), 29.25);
});
test("duplicate terciles use the upper bucket, baseline contains matches, unfinished horizons remain in ledger", async () => {
  const out = await H.compute(input(cols(40)));
  assert.deepEqual(out.thresholds, { share: [.5,.5], seasonal: [1,1] }); assert.deepEqual(out.state, [1,2,2]);
  assert.equal(out.ledger.length, 40); assert.equal(out.ledger[0].reason, "No contiguous predecessor POC");
  assert.equal(out.cases[1].length, 38); assert.equal(out.matched[1].length, 38);
  assert.equal(out.ledger[39].outcomes[1].reason, "Unfinished horizon");
  assert.equal(out.uncertainty.intervals.flat.conditional.result.reason, "Fewer than 20 full matched blocks");
});
test("coverage, observed empty, missing POC and predecessor failures are disjoint; early barrier needs the complete horizon", async () => {
  const series = cols(40); series[2].v = 0; series[2].poc = null; series[4].poc = null; series[6].covered = false;
  series[10].poc = 100; series[11].poc = 103; series[12].covered = false;
  const out = await H.compute(input(series));
  assert.equal(out.ledger[2].reason, "Observed empty POC population"); assert.equal(out.ledger[4].reason, "Missing POC"); assert.equal(out.ledger[6].reason, "Missing coverage"); assert.equal(out.ledger[3].reason, "No contiguous predecessor POC");
  assert.equal(out.cases[1].find((c) => c.c === 10).first, 1);
  assert.equal(out.cases[2].some((c) => c.c === 10), false); assert.equal(out.ledger[10].outcomes[2].reason, "Missing horizon coverage");
});
test("actual weekly eligibility refuses MSCC omissions and coarse non-tiling, without raw-volume fallback", async () => {
  const series = cols(200), index = E.measure.seasonalIndex({ cols: series, n: 9, b0: 0, b1: 200 * 512, precision: "Float32", source: "MSCC" });
  const args = input(series, 9); args.seasonal = (x) => E.measure.seasonalActivity({ ...x, index });
  const out = await H.compute(args);
  assert.equal(out.ledger[1].reason, "Ineligible seasonal support"); assert.equal(out.ledger[84].seasonal.count, 4); assert.equal(out.ledger[84].reason, null);
  const coarse = E.measure.seasonalIndex({ cols: cols(100), n: 10, b0: 0, b1: 102400 });
  assert.equal(E.measure.seasonalActivity({ index: coarse, numerator: 10, start: 90 * 1024, end: 91 * 1024, cutoff: 102400 }).result.tag, "unsupported");
});
test("bounded calculation cancels before publishing an obsolete study", async () => {
  let cancelled = false; const promise = H.compute(input(cols(5000)), { cancelled: () => cancelled });
  setTimeout(() => { cancelled = true; }, 0); assert.equal(await promise, null);
});
test("shared block bootstrap keeps empty/partial calendar blocks and component degeneracy separate", async () => {
  const n = 9, length = 135, cases = [], matched = [];
  // 21 full blocks plus partial boundaries. Every full block holds two matches
  // (always higher) and four baseline cases with a changing lower fraction.
  for (let block = 0; block < 22; block++) for (let j = 0; j < 6; j++) {
    const c = { c: block * length + 20 + j, end: block * length + 21 + j, delta: j < 2 ? 1 : block % 3 === 0 ? -1 : 1, matched: j < 2 }; c.direction = Math.sign(c.delta); c.first = c.direction;
    cases.push(c); if (c.matched) matched.push(c);
  }
  const result = { a: 22 * length - 1, n, m: 0, barrier: 1, blockLength: length, thresholds: { share: [0,1], seasonal: [1,2] }, state: [2,1,2], cases: Array.from({ length: 9 }, () => cases), matched: Array.from({ length: 9 }, () => matched) };
  const args = { b0: 1 * 512, b1: 22 * length * 512, provenance };
  const out = await H.bootstrap(args, result, "next-poc", 1);
  assert.equal(out.fullMatched, 21); assert.equal(out.calendarBlocks, 22);
  assert.equal(out.intervals.up.conditional.validDraws, 2000); assert.equal(out.intervals.up.conditional.result.reason, "Degenerate resampling interval");
  assert.equal(out.intervals.up.baseline.result.tag, "finite"); assert.equal(out.intervals.up.difference.result.tag, "finite");
  const again = await H.bootstrap(args, result, "next-poc", 1); assert.deepEqual(out, again);
});
