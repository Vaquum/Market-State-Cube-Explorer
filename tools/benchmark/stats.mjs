// tools/benchmark/stats.mjs (H9): the statistics of the D12 performance decision procedure, as pure code.
//
// Nothing here touches a browser, a file or a clock: every function takes numbers and, where it draws random numbers, a seed, so that
// the same samples give the same verdict on every machine (U38 pins this). The protocol it implements is issue45.md D12 and
// TESTPLAN.md 5.3; the definitions D12 leaves open are fixed in TESTPLAN.md DD-T12 and repeated where they are used:
//   percentile  = nearest rank, ceil(p * n) (what "empirical 95th percentile" of 10 pairs is: the largest of them),
//   quantile    = Type 7 (linear interpolation) for the bootstrap interval ends,
//   family      = core cases x metrics = 8 x 2 = 16, Bonferroni: each two-sided interval has tails alpha / (2 * family),
//   verdict     = lower > floor -> blocking; upper <= floor -> no-regression-detected-at-this-resolution; otherwise inconclusive.
// "No regression detected at this resolution" is never "equal" and "inconclusive" is never "zero overhead" (D12); the verdict names
// below are the only words the report uses for an A/B outcome.

// ---- seeded random numbers ----

// mulberry32(seed) -> next(): floats in [0, 1). A copy of tests/support/rng.js (this is an ES module that CommonJS test support cannot
// be imported into without a build step); U38 checks that both give the same first 1,000 draws for a fixed seed, so a drift in either
// copy is caught.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// subSeed(seed, label): an independent 32-bit seed per label (FNV-1a over the label mixed with the seed), so one committed seed gives
// every schedule and every bootstrap its own stream and no stream depends on the order in which the others are drawn. Same function as
// tests/support/rng.js.
export function subSeed(seed, label) {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// shuffle(next, list): a new array with the elements in a seeded random order (Fisher-Yates, every permutation equally likely).
export function shuffle(next, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const held = out[i];
    out[i] = out[j];
    out[j] = held;
  }
  return out;
}

// ---- descriptive statistics ----

const finite = (name, xs) => {
  if (!Array.isArray(xs) && !ArrayBuffer.isView(xs)) throw new TypeError(`${name}: expected an array of numbers`);
  for (const x of xs) if (!Number.isFinite(x)) throw new RangeError(`${name}: ${x} is not a finite number`);
};

export function mean(xs) {
  finite("mean", xs);
  if (!xs.length) throw new RangeError("mean: no samples");
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

// quantileType7(sorted, p): the R default (Hyndman and Fan type 7): position h = (n - 1) p in the sorted sample, linear between the
// two neighbours. `sorted` must be ascending.
export function quantileType7(sorted, p) {
  if (!sorted.length) throw new RangeError("quantileType7: no samples");
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantileType7: p ${p} is outside [0, 1]`);
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

const ascending = (xs) => Float64Array.from(xs).sort();

// median(xs): Type 7 at 0.5 (the middle value of an odd count, the mean of the middle two of an even one).
export function median(xs) {
  finite("median", xs);
  return quantileType7(ascending(xs), 0.5);
}

// percentileNearestRank(xs, p): the value at rank ceil(p * n) of the sorted sample, ranks from 1. The 1e-9 guards a product such as
// 0.95 * 20 = 19.000000000000004 against rounding up to rank 20.
export function percentileNearestRank(xs, p) {
  finite("percentileNearestRank", xs);
  if (!xs.length) throw new RangeError("percentileNearestRank: no samples");
  if (!(p > 0 && p <= 1)) throw new RangeError(`percentileNearestRank: p ${p} is outside (0, 1]`);
  const sorted = ascending(xs);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length - 1e-9)));
  return sorted[rank - 1];
}

export const share = (xs, limit) => {
  if (!xs.length) throw new RangeError("share: no samples");
  let over = 0;
  for (const x of xs) if (x > limit) over++;
  return over / xs.length;
};

export const countOver = (xs, limit) => {
  let over = 0;
  for (const x of xs) if (x > limit) over++;
  return over;
};

// ---- paired differences and the noise floor ----

// pairedDifferences(a, b): b[i] - a[i]. The pair is one trial of each arm of the same case, so a slow machine minute moves both.
export function pairedDifferences(a, b) {
  if (a.length !== b.length) throw new RangeError(`pairedDifferences: ${a.length} values against ${b.length}`);
  finite("pairedDifferences a", a);
  finite("pairedDifferences b", b);
  return b.map((x, i) => x - a[i]);
}

// noiseFloor(aaDifferences, {percentile, timerResolutionMs}): D12 step 1: the empirical 95th percentile of the absolute paired A/A
// differences, never below the measured timer resolution (a difference smaller than the clock's step cannot be told from zero).
export function noiseFloor(aaDifferences, { percentile = 0.95, timerResolutionMs }) {
  if (!(timerResolutionMs > 0)) throw new RangeError("noiseFloor: the measured timer resolution (> 0 ms) is required");
  return Math.max(timerResolutionMs, percentileNearestRank(aaDifferences.map(Math.abs), percentile));
}

// environmentGate(floors, limitMs): D12 step 1: a core mean-draw floor above 0.2 ms makes the environment inconclusive. `floors` maps
// a case id to {meanDrawMs, meanFrameIntervalMs}; the gate reads the mean-draw floors only.
export function environmentGate(floors, limitMs) {
  const offending = Object.entries(floors)
    .filter(([, f]) => f.meanDrawMs > limitMs)
    .map(([caseId, f]) => ({ case: caseId, floorMs: f.meanDrawMs }));
  return { ok: offending.length === 0, limitMs, offending };
}

// ---- the bootstrap ----

// bonferroniTail({alpha, family}): the probability in each tail of one two-sided interval when `family` intervals share the level
// 1 - alpha: alpha / (2 * family) (0.01 / 32 = 0.0003125 for D12's family of 16).
export function bonferroniTail({ alpha, family }) {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`bonferroniTail: alpha ${alpha} is outside (0, 1)`);
  if (!Number.isInteger(family) || family < 1) throw new RangeError(`bonferroniTail: family ${family} must be a positive integer`);
  return alpha / (2 * family);
}

// bootstrapMeanInterval(differences, {resamples, tail, seed}): the percentile bootstrap of the mean paired difference. Each resample
// draws n pairs with replacement (the PAIR is the unit: both arms of a trial pair move together) and keeps their mean; the interval is
// the Type-7 quantiles `tail` and `1 - tail` of the sorted resample means.
export function bootstrapMeanInterval(differences, { resamples, tail, seed }) {
  finite("bootstrapMeanInterval", differences);
  const n = differences.length;
  if (n < 1) throw new RangeError("bootstrapMeanInterval: no pairs");
  if (!Number.isInteger(resamples) || resamples < 1) throw new RangeError(`bootstrapMeanInterval: resamples ${resamples} must be a positive integer`);
  if (!(tail > 0 && tail < 0.5)) throw new RangeError(`bootstrapMeanInterval: tail ${tail} is outside (0, 0.5)`);
  const next = mulberry32(seed);
  const means = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += differences[Math.floor(next() * n)];
    means[b] = sum / n;
  }
  means.sort();
  return {
    pairs: n,
    meanDifference: mean(differences),
    lower: quantileType7(means, tail),
    upper: quantileType7(means, 1 - tail),
    resamples,
    tail,
  };
}

// ---- verdicts ----

export const VERDICTS = Object.freeze({
  blocking: "blocking",
  none: "no-regression-detected-at-this-resolution",
  inconclusive: "inconclusive",
  environment: "environment-inconclusive",
});
const SEVERITY = { [VERDICTS.none]: 1, [VERDICTS.inconclusive]: 2, [VERDICTS.blocking]: 3 };

// intervalVerdict({lower, upper}, floor): D12 step 3. A lower bound above the A/A floor is a blocking repeatable regression; an upper
// bound at or below it says no regression was detected at this resolution; an interval that spans the floor is inconclusive and
// needs an explanation or an operator decision (never a claim of zero overhead).
export function intervalVerdict({ lower, upper }, floor) {
  if (lower > floor) return VERDICTS.blocking;
  if (upper <= floor) return VERDICTS.none;
  return VERDICTS.inconclusive;
}

// worstVerdict(verdicts): blocking beats inconclusive beats no-regression, so one blocking cell makes the comparison blocking.
export function worstVerdict(verdicts) {
  if (!verdicts.length) throw new RangeError("worstVerdict: no verdicts");
  for (const v of verdicts) if (!(v in SEVERITY)) throw new RangeError(`worstVerdict: ${v} is not an A/B verdict`);
  return verdicts.reduce((worst, v) => (SEVERITY[v] > SEVERITY[worst] ? v : worst));
}

// ---- runs, budgets ----

export const METRICS = Object.freeze(["meanDrawMs", "meanFrameIntervalMs"]);

// runMetrics(sample): the two compared means of one steady run. A run with no draw frame or no frame interval has recorded nothing
// the comparison can use; that is an instrumentation failure (the draw-frame definition did not match the page), never a zero.
export function runMetrics(sample) {
  if (!sample.draws.length) throw new RangeError(`no draw frame was recorded for ${sample.case} (${sample.build}, pair ${sample.pair}): the draw-frame definition of DD-T28 did not match this page`);
  if (!sample.frameIntervals.length) throw new RangeError(`no frame interval was recorded for ${sample.case} (${sample.build}, pair ${sample.pair})`);
  return { meanDrawMs: mean(sample.draws), meanFrameIntervalMs: mean(sample.frameIntervals) };
}

const pooled = (samples, field) => samples.flatMap((s) => s[field]);

// budgetMetrics(steadySamples, budgets): D12 step 4 for one build and one case: pooled percentiles over its steady runs (plus the
// per-run p95 draws, so a single odd trial is visible), the share of gesture frame intervals above 33.3 ms and the two counts D12 asks
// for. Empty input is refused: a budget of no samples is not a pass.
export function budgetMetrics(steadySamples, budgets) {
  if (!steadySamples.length) throw new RangeError("budgetMetrics: no steady runs");
  const draws = pooled(steadySamples, "draws");
  const frames = pooled(steadySamples, "frameIntervals");
  const paint = pooled(steadySamples, "inputToPaint");
  return {
    runs: steadySamples.length,
    drawCount: draws.length,
    frameCount: frames.length,
    inputCount: paint.length,
    p95DrawMs: percentileNearestRank(draws, 0.95),
    p95FrameMs: percentileNearestRank(frames, 0.95),
    gestureIntervalOver33_3MsShare: share(frames, 33.3),
    p95InputToPaintMs: paint.length ? percentileNearestRank(paint, 0.95) : null,
    drawsOverMs: countOver(draws, budgets.drawOverMs),
    framesOverMs: countOver(frames, budgets.frameOverMs),
    perRunP95DrawMs: steadySamples.map((s) => percentileNearestRank(s.draws, 0.95)),
  };
}

const BUDGET_LINES = [
  { name: "p95DrawMs", limit: "p95DrawMs", value: "p95DrawMs" },
  { name: "p95FrameMs", limit: "p95FrameMs", value: "p95FrameMs" },
  { name: "gestureIntervalOver33_3MsMaxShare", limit: "gestureIntervalOver33_3MsMaxShare", value: "gestureIntervalOver33_3MsShare" },
  { name: "p95InputToPaintMs", limit: "p95InputToPaintMs", value: "p95InputToPaintMs" },
];

// budgetChecks(candidate, original, budgets): each budget against the candidate's pooled value, "where the baseline meets it"
// (D12 step 4): `applies` is the baseline's own result, so a budget the baseline already misses on this machine is reported but never
// counted against the candidate. A missing input-to-paint sample makes that line `not-measured`, never a pass.
export function budgetChecks(candidate, original, budgets) {
  return BUDGET_LINES.map(({ name, limit, value }) => {
    const limitValue = budgets[limit];
    const c = candidate[value];
    const o = original[value];
    if (c === null || o === null) return { budget: name, limit: limitValue, candidate: c, original: o, baselineMeets: null, candidateMeets: null, status: "not-measured" };
    const baselineMeets = o <= limitValue;
    const candidateMeets = c <= limitValue;
    const status = candidateMeets ? "meets" : baselineMeets ? "exceeds-where-baseline-meets" : "exceeds-baseline-also-exceeds";
    return { budget: name, limit: limitValue, candidate: c, original: o, baselineMeets, candidateMeets, status };
  });
}

// ---- the decision procedure over the collected samples ----

const byPair = (a, b) => a.pair - b.pair;

// pairsOf(samples, {phase, vs, caseId, run}): the paired steady runs of one case in one phase, ordered by pair: [{pair, a, b}] where `a` is
// arm A (the reference) and `b` arm B (the build under test).
export function pairsOf(samples, { phase, vs = null, caseId, run = "steady" }) {
  const pick = samples.filter((s) => s.phase === phase && s.vs === vs && s.case === caseId && s.run === run);
  const pairs = new Map();
  for (const s of pick) {
    const entry = pairs.get(s.pair) ?? { pair: s.pair, a: null, b: null };
    if (entry[s.arm.toLowerCase()]) throw new RangeError(`two ${s.arm} runs for ${caseId} pair ${s.pair} in ${phase}`);
    entry[s.arm.toLowerCase()] = s;
    pairs.set(s.pair, entry);
  }
  const out = [...pairs.values()].sort(byPair);
  for (const p of out) if (!p.a || !p.b) throw new RangeError(`${caseId} pair ${p.pair} in ${phase} lacks its ${p.a ? "B" : "A"} run`);
  return out;
}

const differencesOf = (pairs, metric) => pairs.map((p) => runMetrics(p.b)[metric] - runMetrics(p.a)[metric]);

// analyseAA(samples, protocol, coreIds, timerResolutionMs): the per-case, per-metric noise floors and the environment gate.
export function analyseAA(samples, { floorPercentile, environmentInconclusiveMeanDrawMs }, coreIds, timerResolutionMs) {
  const floors = {};
  const pairsPerCase = {};
  for (const caseId of coreIds) {
    const pairs = pairsOf(samples, { phase: "aa", caseId });
    if (!pairs.length) throw new RangeError(`no A/A pairs for ${caseId}`);
    pairsPerCase[caseId] = pairs.length;
    floors[caseId] = {};
    for (const metric of METRICS) {
      floors[caseId][metric] = noiseFloor(differencesOf(pairs, metric), { percentile: floorPercentile, timerResolutionMs });
    }
  }
  return { floors, pairsPerCase, timerResolutionMs, gate: environmentGate(floors, environmentInconclusiveMeanDrawMs) };
}

// analyseScreening(samples, vs, coreIds, floors): D12 step 2: for each core (case, metric) the median of the paired B - A differences
// against its floor. One median above its floor sends the comparison to confirmation; none means "no regression detected at this
// resolution", which is not equality.
export function analyseScreening(samples, vs, coreIds, floors) {
  const cells = [];
  for (const caseId of coreIds) {
    const pairs = pairsOf(samples, { phase: "screening", vs, caseId });
    for (const metric of METRICS) {
      const diffs = differencesOf(pairs, metric);
      const med = median(diffs);
      cells.push({ case: caseId, metric, pairs: pairs.length, median: med, floor: floors[caseId][metric], exceedsFloor: med > floors[caseId][metric] });
    }
  }
  return { cells, signal: cells.some((c) => c.exceedsFloor) };
}

// analyseConfirmation(samples, vs, coreIds, floors, protocol, seed): D12 step 3 over the ENTIRE core: one Bonferroni-adjusted bootstrap
// interval per (case, metric) and its verdict. Each cell has its own seeded stream, so the result does not depend on the order cells
// are visited in.
export function analyseConfirmation(samples, vs, coreIds, floors, { alpha, familySize, bootstrapResamples }, seed) {
  const family = coreIds.length * METRICS.length;
  if (family !== familySize) throw new RangeError(`the family is ${coreIds.length} cases x ${METRICS.length} metrics = ${family}, not the configured ${familySize}`);
  const tail = bonferroniTail({ alpha, family });
  const intervals = [];
  for (const caseId of coreIds) {
    const pairs = pairsOf(samples, { phase: "confirmation", vs, caseId });
    for (const metric of METRICS) {
      const diffs = differencesOf(pairs, metric);
      const ci = bootstrapMeanInterval(diffs, { resamples: bootstrapResamples, tail, seed: subSeed(seed, `bootstrap|${vs}|${caseId}|${metric}`) });
      const floor = floors[caseId][metric];
      intervals.push({ case: caseId, metric, ...ci, floor, verdict: intervalVerdict(ci, floor) });
    }
  }
  return {
    familySize: family,
    level: 1 - alpha / family,
    tail,
    intervals,
    verdict: worstVerdict(intervals.map((i) => i.verdict)),
  };
}

// analyseBudgets(samples, vs, caseIds, budgets, phases): D12 step 4 and 6 for one comparison: for every case, the candidate's and the
// original's pooled budget metrics over the steady runs of the A/B phases named, and each budget's check.
export function analyseBudgets(samples, vs, caseIds, budgets, phases) {
  return caseIds.map((caseId) => {
    const steady = (arm) => samples.filter((s) => phases.includes(s.phase) && s.vs === vs && s.case === caseId && s.run === "steady" && s.arm === arm);
    const original = budgetMetrics(steady("A"), budgets);
    const candidate = budgetMetrics(steady("B"), budgets);
    return { case: caseId, candidate, original, checks: budgetChecks(candidate, original, budgets) };
  });
}

// analyseCold(samples, vs, caseIds): the cold runs, reported separately (D12: cold work is reported apart and never mixed into the
// steady comparison): per arm the number of runs, the mean draw and the reads, with no inference.
export function analyseCold(samples, vs, caseIds, phases) {
  return caseIds.map((caseId) => {
    const side = (arm) => {
      const runs = samples.filter((s) => phases.includes(s.phase) && s.vs === vs && s.case === caseId && s.run === "cold" && s.arm === arm);
      if (!runs.length) return { runs: 0, meanDrawMs: null, drawCount: 0 };
      const draws = pooled(runs, "draws");
      return { runs: runs.length, meanDrawMs: draws.length ? mean(draws) : null, drawCount: draws.length };
    };
    return { case: caseId, original: side("A"), candidate: side("B") };
  });
}

// analyseHeavy(samples, vs, heavyIds, budgets): report-only incremental cost of the heavy combinations (D12 step 4): per case the paired
// B - A mean differences (the list itself; five pairs are too few for an interval and none is claimed), their mean, and the budget
// checks.
export function analyseHeavy(samples, vs, heavyIds, budgets) {
  return heavyIds.map((caseId) => {
    const pairs = pairsOf(samples, { phase: "heavy", vs, caseId });
    const differences = {};
    for (const metric of METRICS) {
      const diffs = differencesOf(pairs, metric);
      differences[metric] = { pairs: diffs.length, values: diffs, mean: mean(diffs) };
    }
    const [budget] = analyseBudgets(samples, vs, [caseId], budgets, ["heavy"]);
    return { case: caseId, reportOnly: true, differences, budgets: budget };
  });
}

// analyse({samples, protocol, budgets, coreIds, heavyIds, timerResolutionMs, comparisons, seed, smoke, forced}): the whole decision
// procedure. `comparisons` names the A/B comparisons that have samples: [{vs: "original"|"preceding", coincidesWith?: "original"}]; a
// comparison that coincides with another (S1: preceding main IS the original build) is analysed once and reported under both names.
export function analyse({ samples, protocol, budgets, coreIds, heavyIds = [], timerResolutionMs, comparisons, seed, smoke = false, forced = false }) {
  const aa = analyseAA(samples, protocol, coreIds, timerResolutionMs);
  const family = coreIds.length * METRICS.length;
  const out = {
    familySize: family,
    tailProbability: bonferroniTail({ alpha: protocol.alpha, family }),
    level: 1 - protocol.alpha / family,
    floors: aa.floors,
    environment: { gate: aa.gate, forced, timerResolutionMs },
    comparisons: [],
    assumptions: [
      "Paired trials: each pair is one trial of each arm of one case; the pair is the unit that is resampled.",
      `Percentile bootstrap of the mean paired difference, ${protocol.bootstrapResamples} resamples, committed seed ${seed}, Type-7 quantiles.`,
      `Bonferroni over ${family} comparisons (${coreIds.length} core cases x ${METRICS.length} metrics): two-sided level ${1 - protocol.alpha / family}, tail ${bonferroniTail({ alpha: protocol.alpha, family })}.`,
      "The A/A noise floor comes from the original build only and is shared by every comparison.",
      "Screening without a signal is 'no regression detected at this resolution', not equality; an interval that spans the floor is 'inconclusive', not zero overhead.",
    ],
  };
  const analysed = new Map();
  for (const { vs, coincidesWith = null } of comparisons) {
    const source = coincidesWith ?? vs;
    if (!analysed.has(source)) {
      const hasConfirmation = samples.some((s) => s.phase === "confirmation" && s.vs === source);
      const screening = analyseScreening(samples, source, coreIds, aa.floors);
      const confirmation = screening.signal || hasConfirmation ? analyseConfirmation(samples, source, coreIds, aa.floors, protocol, seed) : null;
      const verdict = confirmation ? confirmation.verdict : VERDICTS.none;
      const phasesUsed = ["screening", ...(confirmation ? ["confirmation"] : [])];
      analysed.set(source, {
        screening,
        confirmation,
        verdict,
        budgets: analyseBudgets(samples, source, coreIds, budgets, phasesUsed),
        heavy: heavyIds.length ? analyseHeavy(samples, source, heavyIds, budgets) : [],
        cold: analyseCold(samples, source, [...coreIds, ...heavyIds], ["screening", "confirmation", "heavy"]),
      });
    }
    out.comparisons.push({ vs, coincidesWith, ...analysed.get(source) });
  }
  // No comparison has samples when the environment gate refused the A/B phases; the verdict is then the gate's.
  const abVerdict = out.comparisons.length ? worstVerdict(out.comparisons.map((c) => c.verdict)) : null;
  out.verdict = smoke ? "smoke" : !aa.gate.ok ? VERDICTS.environment : abVerdict;
  out.abVerdict = abVerdict;
  return out;
}
