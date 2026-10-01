"use strict";
// U38 benchmark-stats.test.js (H9): the statistics of the D12 decision procedure (tools/benchmark/stats.mjs), on synthetic data
// whose answers are known.
// Oracles: hand-computed vectors written out as literals (nearest-rank and Type-7 positions worked on paper in the comments), the
// closed-form bootstrap of a two-point sample (resample means 0, 1/2, 1 with probabilities 1/4, 1/2, 1/4), the normal model of a
// shifted sample (mean 1.0, sd 0.1: its 99.94 % interval is about 1.0 +- 0.04, far from 0.5), and tests/support/rng.js as the
// independent copy of the seeded generator. Nothing here recomputes an expected value with the function under test.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const rng = require("../support/rng.js");

const stats = (async () => import(pathToFileURL(path.resolve(__dirname, "..", "..", "tools", "benchmark", "stats.mjs")).href))();
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} expected ${expected}, got ${actual}`);

describe("the seeded generator", () => {
  it("mulberry32 in stats.mjs gives the first 1,000 draws of tests/support/rng.js for fixed seeds", async () => {
    const S = await stats;
    for (const seed of [1, 20260930, 4294967295, 0]) {
      const a = S.mulberry32(seed);
      const b = rng.mulberry32(seed);
      for (let i = 0; i < 1000; i++) assert.equal(a(), b(), `seed ${seed}, draw ${i}`);
    }
  });

  it("subSeed and shuffle agree with tests/support/rng.js", async () => {
    const S = await stats;
    for (const label of ["", "aa", "bootstrap|original|fake-live-24h|meanDrawMs"]) assert.equal(S.subSeed(20260930, label), rng.subSeed(20260930, label));
    const list = [1, 2, 3, 4, 5, 6, 7, 8];
    assert.deepEqual(S.shuffle(S.mulberry32(7), list), rng.shuffle(rng.mulberry32(7), list));
    assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8], "the input is not modified");
  });
});

describe("descriptive statistics", () => {
  it("mean and median by hand", async () => {
    const S = await stats;
    assert.equal(S.mean([1, 2, 3, 6]), 3);
    assert.equal(S.median([3, 1, 2]), 2);
    assert.equal(S.median([4, 1, 3, 2]), 2.5, "an even count: the mean of the middle two");
    assert.equal(S.median([5]), 5);
    assert.throws(() => S.mean([]), /no samples/);
    assert.throws(() => S.mean([1, NaN]), /not a finite number/);
  });

  it("Type-7 quantile: h = (n - 1) p, linear between neighbours", async () => {
    const S = await stats;
    // [1,2,3,4]: p=0.25 -> h=0.75 -> 1 + 0.75 (2-1) = 1.75; p=0.5 -> h=1.5 -> 2.5
    assert.equal(S.quantileType7([1, 2, 3, 4], 0.25), 1.75);
    assert.equal(S.quantileType7([1, 2, 3, 4], 0.5), 2.5);
    // [10,20,30,40,50]: p=0.9 -> h=3.6 -> 40 + 0.6 (50-40) = 46
    assert.equal(S.quantileType7([10, 20, 30, 40, 50], 0.9), 46);
    assert.equal(S.quantileType7([10, 20, 30, 40, 50], 0), 10);
    assert.equal(S.quantileType7([10, 20, 30, 40, 50], 1), 50);
    assert.equal(S.quantileType7([7], 0.3), 7);
    assert.throws(() => S.quantileType7([1, 2], 1.5), /outside/);
  });

  it("the Bonferroni tails of 10,000 sorted means sit at h = 9999 * 0.0003125 = 3.1246875 and 9996 - 0.1246875", async () => {
    const S = await stats;
    const sorted = Float64Array.from({ length: 10000 }, (_, i) => i); // the value is the index, so the quantile is the position h
    near(S.quantileType7(sorted, 0.0003125), 3.1246875, 1e-9);
    near(S.quantileType7(sorted, 1 - 0.0003125), 9995.8753125, 1e-9);
  });

  it("nearest-rank percentile: rank ceil(p n), from 1", async () => {
    const S = await stats;
    const ten = [9, 3, 7, 1, 10, 2, 8, 4, 6, 5]; // unsorted on purpose
    assert.equal(S.percentileNearestRank(ten, 0.95), 10, "n = 10: ceil(9.5) = 10, the largest");
    assert.equal(S.percentileNearestRank(ten, 0.5), 5, "ceil(5) = 5");
    const twenty = Array.from({ length: 20 }, (_, i) => 20 - i);
    assert.equal(S.percentileNearestRank(twenty, 0.95), 19, "n = 20: 0.95 * 20 is 19, not 20");
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(S.percentileNearestRank(hundred, 0.95), 95);
    assert.equal(S.percentileNearestRank([4], 0.95), 4);
    assert.equal(S.percentileNearestRank([1, 2, 3], 1), 3);
    assert.throws(() => S.percentileNearestRank([], 0.95), /no samples/);
    assert.throws(() => S.percentileNearestRank([1], 0), /outside/);
  });

  it("share and count above a limit are strict", async () => {
    const S = await stats;
    assert.equal(S.share([1, 2, 33.3, 33.4], 33.3), 0.25);
    assert.equal(S.countOver([16.7, 16.8, 50, 51], 50), 1);
  });
});

describe("paired differences and the A/A floor", () => {
  it("pairedDifferences is B - A", async () => {
    const S = await stats;
    assert.deepEqual(S.pairedDifferences([1, 2, 3], [1.5, 1, 3]), [0.5, -1, 0]);
    assert.throws(() => S.pairedDifferences([1], [1, 2]), /against/);
  });

  it("the floor is the 95th percentile of |B - A| over the pairs, never below the timer resolution", async () => {
    const S = await stats;
    const diffs = [0.01, -0.03, 0.02, 0.0, -0.02, 0.04, -0.01, 0.015, -0.005, 0.03]; // |.|: the largest is 0.04 = rank 10
    assert.equal(S.noiseFloor(diffs, { percentile: 0.95, timerResolutionMs: 0.005 }), 0.04);
    assert.equal(S.noiseFloor(diffs, { percentile: 0.95, timerResolutionMs: 0.1 }), 0.1, "a difference below the clock's step is no difference");
    assert.equal(S.noiseFloor([0, 0, 0], { timerResolutionMs: 0.005 }), 0.005, "all-zero A/A differences still leave the timer step");
    assert.throws(() => S.noiseFloor(diffs, { timerResolutionMs: 0 }), /timer resolution/);
  });

  it("the environment gate fires on a core mean-draw floor strictly above 0.2 ms", async () => {
    const S = await stats;
    const floors = (draw) => ({ a: { meanDrawMs: 0.05, meanFrameIntervalMs: 5 }, b: { meanDrawMs: draw, meanFrameIntervalMs: 0.01 } });
    assert.equal(S.environmentGate(floors(0.2), 0.2).ok, true, "0.2 ms is not above 0.2 ms");
    const bad = S.environmentGate(floors(0.2001), 0.2);
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.offending, [{ case: "b", floorMs: 0.2001 }]);
    assert.equal(S.environmentGate({ a: { meanDrawMs: 0.01, meanFrameIntervalMs: 50 } }, 0.2).ok, true, "only the draw floor counts; a wide frame-interval floor does not");
  });
});

describe("Bonferroni and the bootstrap", () => {
  it("family 16 at alpha 0.01: each tail is 0.01 / 32 = 0.0003125", async () => {
    const S = await stats;
    near(S.bonferroniTail({ alpha: 0.01, family: 16 }), 0.0003125, 1e-15);
    near(S.bonferroniTail({ alpha: 0.05, family: 1 }), 0.025, 1e-15);
    assert.throws(() => S.bonferroniTail({ alpha: 0.01, family: 1.5 }), /positive integer/);
    assert.throws(() => S.bonferroniTail({ alpha: 1, family: 16 }), /outside/);
  });

  it("a constant difference d gives the interval [d, d]", async () => {
    const S = await stats;
    const ci = S.bootstrapMeanInterval(Array(20).fill(0.5), { resamples: 10000, tail: 0.0003125, seed: 20260930 });
    assert.equal(ci.lower, 0.5);
    assert.equal(ci.upper, 0.5);
    assert.equal(ci.meanDifference, 0.5);
    assert.equal(ci.pairs, 20);
  });

  it("symmetric zero-mean noise has an interval that contains 0", async () => {
    const S = await stats;
    const diffs = Array.from({ length: 20 }, (_, i) => (i % 2 ? 1 : -1) * (1 + 0.1 * i));
    const ci = S.bootstrapMeanInterval(diffs, { resamples: 10000, tail: 0.0003125, seed: 20260930 });
    assert.ok(ci.lower < 0 && ci.upper > 0, `[${ci.lower}, ${ci.upper}]`);
    assert.ok(Math.abs(ci.meanDifference) < 0.6, "the sample mean itself is near zero");
  });

  it("shifted noise (mean +1.0, sd 0.1, 20 pairs) has its whole interval above 0.5", async () => {
    const S = await stats;
    const next = rng.mulberry32(99);
    const diffs = Array.from({ length: 20 }, () => rng.normal(next, 1.0, 0.1));
    const ci = S.bootstrapMeanInterval(diffs, { resamples: 10000, tail: 0.0003125, seed: 20260930 });
    assert.ok(ci.lower > 0.5, `lower ${ci.lower}`);
    assert.ok(ci.upper < 1.5, `upper ${ci.upper}`);
    near(ci.meanDifference, 1.0, 0.1);
  });

  it("a two-point sample {0, 1}: the resample means are 0, 1/2, 1 with probabilities 1/4, 1/2, 1/4", async () => {
    const S = await stats;
    // Only the first fifth of draws matter for n = 2: tail 0.3 lands in the 1/2 block (zeros fill the lowest quarter, ones the highest).
    const mid = S.bootstrapMeanInterval([0, 1], { resamples: 10000, tail: 0.3, seed: 5 });
    assert.equal(mid.lower, 0.5);
    assert.equal(mid.upper, 0.5);
    // A tail of 0.05 reaches the 0 block below and the 1 block above.
    const wide = S.bootstrapMeanInterval([0, 1], { resamples: 10000, tail: 0.05, seed: 5 });
    assert.equal(wide.lower, 0);
    assert.equal(wide.upper, 1);
    // The resample count and the tail are recorded for the report.
    assert.equal(wide.resamples, 10000);
    assert.equal(wide.tail, 0.05);
  });

  it("the same seed gives the same interval and another seed another one", async () => {
    const S = await stats;
    const diffs = [0.2, -0.1, 0.4, 0.05, 0.3, -0.2, 0.15, 0.25];
    const a = S.bootstrapMeanInterval(diffs, { resamples: 2000, tail: 0.025, seed: 11 });
    const b = S.bootstrapMeanInterval(diffs, { resamples: 2000, tail: 0.025, seed: 11 });
    const c = S.bootstrapMeanInterval(diffs, { resamples: 2000, tail: 0.025, seed: 12 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.throws(() => S.bootstrapMeanInterval([], { resamples: 10, tail: 0.1, seed: 1 }), /no pairs/);
    assert.throws(() => S.bootstrapMeanInterval([1], { resamples: 0, tail: 0.1, seed: 1 }), /positive integer/);
  });
});

describe("verdicts", () => {
  it("lower above the floor is blocking; upper at or below it is no-regression; spanning is inconclusive", async () => {
    const S = await stats;
    assert.equal(S.intervalVerdict({ lower: 0.06, upper: 0.2 }, 0.05), "blocking");
    assert.equal(S.intervalVerdict({ lower: 0.05, upper: 0.2 }, 0.05), "inconclusive", "a lower bound equal to the floor is not above it");
    assert.equal(S.intervalVerdict({ lower: -0.3, upper: 0.05 }, 0.05), "no-regression-detected-at-this-resolution", "upper equal to the floor counts");
    assert.equal(S.intervalVerdict({ lower: -0.3, upper: 0.4 }, 0.05), "inconclusive");
    assert.equal(S.intervalVerdict({ lower: -0.3, upper: -0.1 }, 0.05), "no-regression-detected-at-this-resolution", "a speed-up is not a regression");
  });

  it("the worst verdict of a family: blocking over inconclusive over no-regression", async () => {
    const S = await stats;
    const none = S.VERDICTS.none;
    assert.equal(S.worstVerdict([none, none]), none);
    assert.equal(S.worstVerdict([none, "inconclusive", none]), "inconclusive");
    assert.equal(S.worstVerdict([none, "inconclusive", "blocking"]), "blocking");
    assert.throws(() => S.worstVerdict([]), /no verdicts/);
    assert.throws(() => S.worstVerdict(["environment-inconclusive"]), /not an A\/B verdict/);
  });
});

describe("budgets", () => {
  const budgets = { p95DrawMs: 10, p95FrameMs: 20, gestureIntervalOver33_3MsMaxShare: 0.01, p95InputToPaintMs: 50, drawOverMs: 16.7, frameOverMs: 50 };
  const run = (draws, frameIntervals, inputToPaint) => ({ draws, frameIntervals, inputToPaint });

  it("pooled percentiles, the share above 33.3 ms and the two counts of D12", async () => {
    const S = await stats;
    // draws 1..6 and 7,8,9,10,12,17: pooled n = 12 -> rank ceil(11.4) = 12 -> 17; only 17 is above 16.7 -> 1
    const a = run([1, 2, 3, 4, 5, 6], [16.7, 16.7, 16.7], [10, 20]);
    const b = run([7, 8, 9, 10, 12, 17], [16.7, 16.7, 40, 55], [30, 40]);
    const m = S.budgetMetrics([a, b], budgets);
    assert.equal(m.runs, 2);
    assert.equal(m.drawCount, 12);
    assert.equal(m.p95DrawMs, 17);
    assert.equal(m.drawsOverMs, 1);
    // frames: 7 intervals: 16.7 x5, 40, 55 -> rank ceil(6.65) = 7 -> 55; above 33.3: 2 of 7; above 50: 1
    assert.equal(m.p95FrameMs, 55);
    assert.equal(m.gestureIntervalOver33_3MsShare, 2 / 7);
    assert.equal(m.framesOverMs, 1);
    // input-to-paint: 10, 20, 30, 40 -> rank ceil(3.8) = 4 -> 40
    assert.equal(m.p95InputToPaintMs, 40);
    assert.deepEqual(m.perRunP95DrawMs, [6, 17]);
    assert.throws(() => S.budgetMetrics([], budgets), /no steady runs/);
  });

  it("a budget is held against the candidate only where the baseline meets it", async () => {
    const S = await stats;
    const base = { p95DrawMs: 4, p95FrameMs: 25, gestureIntervalOver33_3MsShare: 0, p95InputToPaintMs: 30 };
    const cand = { p95DrawMs: 12, p95FrameMs: 30, gestureIntervalOver33_3MsShare: 0.005, p95InputToPaintMs: null };
    const checks = S.budgetChecks(cand, base, budgets);
    const by = Object.fromEntries(checks.map((c) => [c.budget, c]));
    assert.equal(by.p95DrawMs.status, "exceeds-where-baseline-meets", "12 > 10 and the baseline's 4 is within");
    assert.equal(by.p95FrameMs.status, "exceeds-baseline-also-exceeds", "30 > 20 but the baseline's 25 is over too");
    assert.equal(by.gestureIntervalOver33_3MsMaxShare.status, "meets");
    assert.equal(by.p95InputToPaintMs.status, "not-measured", "no input-to-paint sample is not a pass");
  });
});

// A sample of one steady (or cold) run whose draws and frame intervals are constant, so its two means are what the test says.
const sample = (phase, vs, pair, arm, caseId, draw, frame, run = "steady") => ({
  phase, vs, pair, order: 1, arm, build: arm === "A" ? "original" : "candidate", case: caseId, run,
  draws: [draw, draw, draw], frameIntervals: [frame, frame, frame], inputToPaint: [20, 20], unpainted: 0, reads: {}, fits: null,
});

describe("the decision procedure on synthetic samples", () => {
  const protocol = { aaPairs: 10, screeningPairs: 5, confirmationPairs: 20, alpha: 0.01, familySize: 4, bootstrapResamples: 2000, floorPercentile: 0.95, environmentInconclusiveMeanDrawMs: 0.2 };
  const budgets = { p95DrawMs: 10, p95FrameMs: 20, gestureIntervalOver33_3MsMaxShare: 0.01, p95InputToPaintMs: 50, drawOverMs: 16.7, frameOverMs: 50 };
  const coreIds = ["c1", "c2"];

  // aaGap: |B - A| of every A/A pair (so the floor is max(timer, aaGap)); ab(phase, pairs, dDraw): B = A + dDraw(pair, case).
  const build = ({ aaGap = 0.01, screening = () => 0, confirmation = null, confirmPairs = 20 }) => {
    const samples = [];
    for (const c of coreIds) {
      for (let p = 0; p < 10; p++) {
        samples.push(sample("aa", null, p, "A", c, 1.0, 16.7), sample("aa", null, p, "B", c, 1.0 + aaGap, 16.7 + aaGap));
      }
      for (let p = 0; p < 5; p++) {
        const d = screening(p, c);
        samples.push(sample("screening", "original", p, "A", c, 1.0, 16.7), sample("screening", "original", p, "B", c, 1.0 + d, 16.7 + d));
      }
      if (confirmation) {
        for (let p = 0; p < confirmPairs; p++) {
          const d = confirmation(p, c);
          samples.push(sample("confirmation", "original", p, "A", c, 1.0, 16.7), sample("confirmation", "original", p, "B", c, 1.0 + d, 16.7 + d));
        }
      }
    }
    return samples;
  };
  const run = async (samples, extra = {}) => {
    const S = await stats;
    return S.analyse({ samples, protocol, budgets, coreIds, timerResolutionMs: 0.005, comparisons: [{ vs: "original" }], seed: 20260930, ...extra });
  };

  it("floors: the largest |B - A| over the A/A pairs, per case and metric", async () => {
    const out = await run(build({}));
    near(out.floors.c1.meanDrawMs, 0.01, 1e-12); // 1.01 - 1.0 is not exactly 0.01 in binary
    near(out.floors.c2.meanFrameIntervalMs, 0.01, 1e-12);
    assert.equal(out.environment.gate.ok, true);
    assert.equal(out.familySize, 4);
    near(out.tailProbability, 0.01 / 8, 1e-15);
  });

  it("no signal in screening: no regression detected at this resolution, and no confirmation interval", async () => {
    const out = await run(build({ screening: () => 0 }));
    const [comparison] = out.comparisons;
    assert.equal(comparison.screening.signal, false);
    assert.equal(comparison.confirmation, null);
    assert.equal(out.verdict, "no-regression-detected-at-this-resolution");
  });

  it("a screening median above the floor in one case sends the whole core to confirmation; a steady +0.5 ms is blocking", async () => {
    const out = await run(build({ screening: (p, c) => (c === "c2" ? 0.5 : 0), confirmation: () => 0.5 }));
    const [comparison] = out.comparisons;
    assert.equal(comparison.screening.signal, true);
    assert.deepEqual(comparison.screening.cells.filter((x) => x.exceedsFloor).map((x) => x.case), ["c2", "c2"]);
    assert.equal(comparison.confirmation.intervals.length, 4, "every (case, metric) of the core, not only the selected case");
    assert.equal(comparison.confirmation.verdict, "blocking");
    assert.equal(out.verdict, "blocking");
    for (const i of comparison.confirmation.intervals) {
      assert.equal(i.lower, 0.5);
      assert.equal(i.upper, 0.5);
      assert.equal(i.verdict, "blocking");
    }
  });

  it("an interval that spans the floor is inconclusive", async () => {
    const out = await run(build({ screening: () => 0.5, confirmation: (p) => (p % 2 ? 0.3 : -0.3) }));
    assert.equal(out.comparisons[0].confirmation.verdict, "inconclusive");
    assert.equal(out.verdict, "inconclusive");
  });

  it("an interval wholly at or below the floor after a screening signal is no regression detected", async () => {
    const out = await run(build({ screening: () => 0.5, confirmation: () => 0 }));
    assert.equal(out.comparisons[0].confirmation.verdict, "no-regression-detected-at-this-resolution");
    assert.equal(out.verdict, "no-regression-detected-at-this-resolution");
  });

  it("a core mean-draw floor above 0.2 ms makes the verdict environment-inconclusive, whatever the A/B pairs say", async () => {
    const out = await run(build({ aaGap: 0.3, screening: () => 0 }));
    assert.equal(out.environment.gate.ok, false);
    assert.equal(out.verdict, "environment-inconclusive");
    assert.equal(out.abVerdict, "no-regression-detected-at-this-resolution", "kept apart, for a forced run");
    const refused = await run(build({ aaGap: 0.3 }).filter((s) => s.phase === "aa"), { comparisons: [] });
    assert.equal(refused.verdict, "environment-inconclusive");
    assert.deepEqual(refused.comparisons, []);
  });

  it("a timer resolution above every A/A difference is the floor", async () => {
    const S = await stats;
    const out = S.analyse({ samples: build({ aaGap: 0.001 }), protocol, budgets, coreIds, timerResolutionMs: 0.1, comparisons: [{ vs: "original" }], seed: 1 });
    assert.equal(out.floors.c1.meanDrawMs, 0.1);
  });

  it("a comparison that coincides with another is analysed once and reported under both names", async () => {
    const out = await run(build({ screening: () => 0 }), { comparisons: [{ vs: "preceding", coincidesWith: "original" }, { vs: "original" }] });
    assert.deepEqual(out.comparisons.map((c) => [c.vs, c.coincidesWith]), [["preceding", "original"], ["original", null]]);
    assert.deepEqual(out.comparisons[0].screening, out.comparisons[1].screening);
  });

  it("smoke runs are never given a D12 verdict", async () => {
    const out = await run(build({ screening: () => 0 }), { smoke: true });
    assert.equal(out.verdict, "smoke");
  });

  it("the result is identical for the same seed on two runs and differs for another seed", async () => {
    const samples = build({ screening: () => 0.5, confirmation: (p) => 0.01 * p - 0.05 });
    const a = await run(samples);
    const b = await run(samples);
    const c = await run(samples, { seed: 7 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.comparisons[0].confirmation.intervals, c.comparisons[0].confirmation.intervals);
  });

  it("an instrumentation failure (a run with no draw frame) is an error, not a zero", async () => {
    const S = await stats;
    const broken = build({});
    broken.find((s) => s.phase === "aa").draws = [];
    assert.throws(() => S.analyse({ samples: broken, protocol, budgets, coreIds, timerResolutionMs: 0.005, comparisons: [], seed: 1 }), /no draw frame was recorded/);
  });

  it("a wrong family size is refused rather than silently adjusted", async () => {
    const S = await stats;
    const samples = build({ screening: () => 0.5, confirmation: () => 0.5 });
    assert.throws(() => S.analyse({ samples, protocol: { ...protocol, familySize: 16 }, budgets, coreIds, timerResolutionMs: 0.005, comparisons: [{ vs: "original" }], seed: 1 }), /not the configured 16/);
  });
});
