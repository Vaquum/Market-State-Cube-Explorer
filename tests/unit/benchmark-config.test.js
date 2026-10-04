"use strict";
// U39 benchmark-config.test.js (H9): the committed benchmark configuration, the schedules derived from its seed, the report schema and
// writer, and the init script's draw-frame definition.
// Oracles: the D12 text of issue45.md and TESTPLAN.md 5.2 as literals (the case matrix, the protocol numbers, the budgets); the address
// keys and values the BASELINE page reads (state read from `git show 8c82ca1:src/explorer.js` readView, windowKey, MODES, ROWS, PANES
// and the LINES and TOGGLES tables, copied here as lists); the recorded snapshot's tier dates (8c82ca1 index.html: recent from
// 2026-09-17, reference from 2026-08-25, cutoff 2026-09-24); a hand-built tiny report (tests/fixtures/benchmark/sample-report.json, all
// inputs dyadic fractions so its floors, medians and intervals are exact, derived on paper in its provenance.json); and a stub page
// (node:vm) whose clock and frame queue the test drives by hand.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..", "..");
const BENCH = path.join(ROOT, "tools", "benchmark");
const load = (name) => import(pathToFileURL(path.join(BENCH, name)).href);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const CONFIG = path.join(BENCH, "navigation.v1.json");
const config = () => readJson(CONFIG);
const clone = (x) => JSON.parse(JSON.stringify(x));

describe("the committed configuration", () => {
  it("validates against schema.mjs", async () => {
    const { validateConfig } = await load("schema.mjs");
    assert.deepEqual(validateConfig(config()), []);
  });

  it("holds the D12 numbers: browser, viewport, gesture, protocol, budgets and the committed seed", () => {
    const c = config();
    assert.equal(c.schemaVersion, 1);
    assert.ok(Number.isInteger(c.seed) && c.seed > 0, "a committed seed");
    assert.equal(c.data.profile, "bench");
    assert.ok(Number.isInteger(c.data.seed) && /^2026-09-24T12:02:00/.test(c.data.cutoff), "the data seed and cutoff are pinned inside the configuration");
    assert.deepEqual(c.viewport, { width: 1500, height: 950 });
    assert.equal(c.dpr, 1);
    assert.equal(c.browser.expectMajor, 153);
    assert.deepEqual(c.gesture.wheel, { in: 12, out: 12, intervalMs: 40, deltaY: 100, at: "canvas-center" });
    assert.deepEqual(c.gesture.drags, [{ dx: 300, dy: 0 }, { dx: 0, dy: 300 }, { dx: -300, dy: 0 }, { dx: 0, dy: -300 }]);
    assert.equal(c.gesture.dragSteps, 10);
    assert.equal(c.gesture.dragStepMs, 16);
    const p = c.protocol;
    assert.equal(p.aaPairs, 10);
    assert.equal(p.screeningPairs, 5);
    assert.equal(p.confirmationPairs, 20);
    assert.equal(p.bootstrapResamples, 10000);
    assert.equal(p.alpha, 0.01);
    assert.equal(p.familySize, 16);
    assert.equal(p.floorPercentile, 0.95);
    assert.equal(p.environmentInconclusiveMeanDrawMs, 0.2);
    assert.match(p.floorMinMs, /timer resolution/);
    assert.deepEqual(c.budgets, { p95DrawMs: 10, p95FrameMs: 20, gestureIntervalOver33_3MsMaxShare: 0.01, p95InputToPaintMs: 50, drawOverMs: 16.7, frameOverMs: 50 });
  });

  it("the core is {recorded, fake-live} x {24h, 7d, all, old tiled week}: eight cases, family 16 with two metrics", () => {
    const c = config();
    const ids = ["recorded", "fake-live"].flatMap((m) => ["24h", "7d", "all", "old-week"].map((w) => `${m}-${w}`));
    assert.deepEqual(c.core.map((x) => x.id), ids);
    assert.deepEqual(c.core.map((x) => x.mode), ["recorded", "recorded", "recorded", "recorded", "fake-live", "fake-live", "fake-live", "fake-live"]);
    for (const mode of ["recorded", "fake-live"]) {
      const of = (w) => c.core.find((x) => x.id === `${mode}-${w}`).view;
      assert.equal(of("24h"), "#w=24h");
      assert.equal(of("7d"), "#w=7d");
      assert.equal(of("all"), "#w=all");
    }
    assert.equal(c.core.length * 2, c.protocol.familySize);
  });

  it("the old tiled week is older than the tier the page already holds, in both modes", () => {
    const c = config();
    const week = (id) => {
      const m = /^#t=(\d{4}-\d{2}-\d{2})T00:00Z~(\d{4}-\d{2}-\d{2})T00:00Z&p=(\d+)~(\d+)$/.exec(c.core.find((x) => x.id === id).view);
      assert.ok(m, `${id} is a time and price rectangle`);
      return { from: m[1], to: m[2], lo: Number(m[3]), hi: Number(m[4]), days: (Date.parse(`${m[2]}T00:00Z`) - Date.parse(`${m[1]}T00:00Z`)) / 864e5 };
    };
    const recorded = week("recorded-old-week");
    const live = week("fake-live-old-week");
    assert.equal(recorded.days, 7);
    assert.equal(live.days, 7);
    // The recorded snapshot: recent tier from 2026-09-17, reference tier (15-minute columns) 2026-08-25 to 2026-09-24. The week is inside the
    // reference tier and before the recent one, so the page has no finer block for it.
    assert.ok(recorded.from >= "2026-08-25" && recorded.to <= "2026-09-17", `${recorded.from}..${recorded.to}`);
    // The fake-live page holds the recent 7 days and 30 days of reference before the 2026-09-24 cutoff (from 2026-08-25): the week ends before that,
    // so it needs tile reads from the cube.
    assert.ok(live.to < "2026-08-25", `${live.from}..${live.to}`);
    assert.ok(recorded.lo < recorded.hi && live.lo < live.hi);
  });

  it("the heavy list covers Rows, movement, reference families, RSI, MACD, continuations, the lens and the Geometry outline", () => {
    const heavy = config().heavy;
    const by = Object.fromEntries(heavy.map((h) => [h.id, h]));
    assert.deepEqual(heavy.map((h) => h.id), ["rows-volume", "rows-relvol", "movement-path", "movement-dwell", "reference-families", "rsi", "macd", "continuations", "lens", "geometry-outline"]);
    assert.match(by["rows-volume"].view, /[#&]rows=volume(&|$)/);
    assert.match(by["rows-relvol"].view, /[#&]rows=relvol(&|$)/);
    assert.match(by["movement-path"].view, /[#&]mode=path(&|$)/);
    assert.match(by["movement-dwell"].view, /[#&]mode=dwell(&|$)/);
    assert.match(by["reference-families"].view, /[#&]lines=[^&]*ema21/);
    assert.match(by.rsi.view, /[#&]pane=rsi1d(&|$)/);
    assert.match(by.macd.view, /[#&]pane=macd1d(&|$)/);
    assert.match(by.continuations.view, /[#&]tab=continuations(&|$)/);
    assert.match(by["geometry-outline"].view, /[#&]mode=geometry(&|$)/);
    assert.deepEqual(by.lens.preGesture, { keys: ["l"], moveTo: "canvas-center" }, "press L, move to the canvas centre");
    for (const h of heavy) assert.equal(h.mode, "fake-live", `${h.id}: path, dwell, RSI and the rest need the live cube`);
  });

  it("every view is an address the baseline page reads", () => {
    // From 8c82ca1 readView / checkView: the parameter names, the window keys, the encodings, the row choices, the panes and the line keys.
    const KEYS = ["w", "t", "p", "r", "f", "mode", "pane", "rows", "period", "level", "marks", "lines", "sel", "at", "replay", "tab", "outcome", "h", "dist"];
    const WINDOWS = ["15m", "30m", "1h", "4h", "12h", "24h", "7d", "30d", "1y", "ytd", "lastyear", "all"];
    const MODES = ["volume", "flow", "delta", "cascade", "trades", "flowtrades", "size", "path", "dwell", "geometry"];
    const ROWS = ["off", "volume", "delta", "relvol", "time"];
    const PANES = ["cells", "volume", "delta", "trades", "size", "efficiency", "choppiness", "perpath", "rsi1d", "rsi4h", "macd1d"];
    const LINES = ["1d", "wk", "7d", "mo", "30d", "90d", "yr", "1y", "3y", "ema21", "sma50", "sma100", "sma200", "bb15m", "bb1h", "bb4h", "bb1d", "svwap", "ema1h", "ema4h"];
    const c = config();
    for (const item of [...c.core, ...c.heavy]) {
      const q = new Map(item.view.slice(1).split("&").map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]));
      for (const key of q.keys()) assert.ok(KEYS.includes(key), `${item.id}: ${key} is not an address key`);
      assert.ok(q.has("w") !== (q.has("t") && q.has("p")), `${item.id}: a window, or a time and a price range, not both`);
      if (q.has("w")) assert.ok(WINDOWS.includes(q.get("w")), `${item.id}: window ${q.get("w")}`);
      if (q.has("mode")) assert.ok(MODES.includes(q.get("mode")), item.id);
      if (q.has("rows")) assert.ok(ROWS.includes(q.get("rows")), item.id);
      if (q.has("pane")) assert.ok(PANES.includes(q.get("pane")), item.id);
      if (q.has("lines")) for (const l of q.get("lines").split(",")) assert.ok(LINES.includes(l), `${item.id}: line ${l}`);
      if (q.has("tab")) assert.equal(q.get("tab"), "continuations");
    }
  });

  it("the smoke block names real cases and stays small", () => {
    const c = config();
    const coreIds = new Set(c.core.map((x) => x.id));
    const heavyIds = new Set(c.heavy.map((x) => x.id));
    assert.ok(c.smoke.coreIds.every((id) => coreIds.has(id)));
    assert.ok(c.smoke.heavyIds.every((id) => heavyIds.has(id)));
    assert.ok(c.smoke.coreIds.some((id) => id.startsWith("recorded")) && c.smoke.coreIds.some((id) => id.startsWith("fake-live")), "both modes are exercised");
    assert.ok(c.smoke.aaPairs <= 3 && c.smoke.screeningPairs <= 3 && c.smoke.confirmationPairs <= 3 && c.smoke.bootstrapResamples <= 1000);
  });

  it("npm run benchmark and benchmark:smoke run this tool with this configuration", () => {
    const scripts = readJson(path.join(ROOT, "package.json")).scripts;
    assert.match(scripts.benchmark, /^node tools\/benchmark_navigation\.mjs --config tools\/benchmark\/navigation\.v1\.json --out reports\/benchmark$/);
    assert.match(scripts["benchmark:smoke"], /^node tools\/benchmark_navigation\.mjs --config tools\/benchmark\/navigation\.v1\.json --out reports\/benchmark-smoke --smoke --browser-mode headless-shell$/);
    assert.ok(fs.existsSync(path.join(ROOT, "tools", "benchmark_navigation.mjs")));
  });
});

describe("the configuration validator", () => {
  const bad = async (mutate, pattern) => {
    const { validateConfig } = await load("schema.mjs");
    const c = clone(config());
    mutate(c);
    const errors = validateConfig(c);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern}, got ${JSON.stringify(errors)}`);
  };

  it("refuses a wrong kind, a missing seed, a bad browser mode and a family that does not match the core", async () => {
    await bad((c) => { c.kind = "x"; }, /config\.kind/);
    await bad((c) => { delete c.seed; }, /config\.seed/);
    await bad((c) => { c.browser.mode = "firefox"; }, /config\.browser\.mode/);
    await bad((c) => { c.protocol.familySize = 12; }, /familySize: must equal core cases x 2 metrics = 16/);
  });

  it("refuses duplicate case ids, a view that is not an address hash and a smoke block naming an unknown case", async () => {
    await bad((c) => { c.core[1].id = c.core[0].id; }, /duplicate case id/);
    await bad((c) => { c.core[0].view = "w=24h"; }, /core\[0\]\.view/);
    await bad((c) => { c.smoke.coreIds = ["nope"]; }, /smoke\.coreIds/);
    await bad((c) => { c.heavy[0].preGesture = { keys: [], moveTo: "elsewhere" }; }, /preGesture\.moveTo/);
  });

  it("does not throw on junk", async () => {
    const { validateConfig, validateReport } = await load("schema.mjs");
    for (const junk of [null, 1, "x", [], {}]) {
      assert.ok(validateConfig(junk).length > 0);
      assert.ok(validateReport(junk).length > 0);
    }
  });
});

describe("schedules from the seed", () => {
  const cores = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("A/A pairs alternate strictly: A first on even pairs, B first on odd ones, every case once per pair", async () => {
    const { aaSchedule, aaOrders } = await load("schedule.mjs");
    assert.deepEqual(aaOrders(10), ["AB", "BA", "AB", "BA", "AB", "BA", "AB", "BA", "AB", "BA"]);
    const s = aaSchedule({ pairs: 10, caseIds: cores, seed: 20260930 });
    assert.equal(s.length, 80);
    for (let pair = 0; pair < 10; pair++) {
      const rows = s.filter((e) => e.pair === pair);
      assert.deepEqual(rows.map((e) => e.case).sort(), cores, `pair ${pair} holds each case once`);
      assert.ok(rows.every((e) => e.first === (pair % 2 === 0 ? "A" : "B") && e.phase === "aa" && e.vs === null));
    }
    // Entries come grouped by pair, in pair order.
    assert.deepEqual(s.map((e) => e.pair), s.map((e) => e.pair).slice().sort((a, b) => a - b));
  });

  it("randomised A/B orders are balanced: 20 pairs 10/10, 5 pairs 3/2 either way, 4 pairs 2/2", async () => {
    const { abOrders } = await load("schedule.mjs");
    const split = (orders) => [orders.filter((o) => o === "AB").length, orders.filter((o) => o === "BA").length];
    for (const seed of [1, 20260930, 99999]) {
      assert.deepEqual(split(abOrders({ pairs: 20, seed, label: "confirmation|original" })), [10, 10]);
      assert.deepEqual(split(abOrders({ pairs: 4, seed, label: "x" })), [2, 2]);
      const five = split(abOrders({ pairs: 5, seed, label: "screening|original" }));
      assert.ok((five[0] === 3 && five[1] === 2) || (five[0] === 2 && five[1] === 3), JSON.stringify(five));
    }
  });

  it("the same seed gives the same schedule, another seed another one, and the orders are shuffled not sorted", async () => {
    const { abSchedule, abOrders } = await load("schedule.mjs");
    const make = (seed) => abSchedule({ phase: "confirmation", vs: "original", pairs: 20, caseIds: cores, seed });
    assert.deepEqual(make(20260930), make(20260930));
    assert.notDeepEqual(make(20260930), make(20260931));
    const orders = abOrders({ pairs: 20, seed: 20260930, label: "confirmation|original" });
    assert.notDeepEqual(orders, orders.slice().sort(), "not AB...AB BA...BA");
    const s = make(20260930);
    for (let pair = 0; pair < 20; pair++) {
      const rows = s.filter((e) => e.pair === pair);
      assert.equal(rows.length, 8);
      assert.deepEqual(rows.map((e) => e.case).sort(), cores);
      assert.equal(new Set(rows.map((e) => e.first)).size, 1, "one order per pair index, shared by its cases (so each case is balanced)");
      assert.ok(rows.every((e) => e.vs === "original" && e.phase === "confirmation"));
    }
  });

  it("the committed configuration's schedules have the D12 shape", async () => {
    const { aaSchedule, abSchedule } = await load("schedule.mjs");
    const c = config();
    const ids = c.core.map((x) => x.id);
    assert.equal(aaSchedule({ pairs: c.protocol.aaPairs, caseIds: ids, seed: c.seed }).length, 10 * 8);
    assert.equal(abSchedule({ phase: "screening", vs: "original", pairs: c.protocol.screeningPairs, caseIds: ids, seed: c.seed }).length, 5 * 8);
    assert.equal(abSchedule({ phase: "confirmation", vs: "original", pairs: c.protocol.confirmationPairs, caseIds: ids, seed: c.seed }).length, 20 * 8);
  });
});

describe("the report: sample-report.json, the writer and the statement", () => {
  const fixture = () => readJson(path.join(ROOT, "tests", "fixtures", "benchmark", "sample-report.json"));

  it("validates, and its hand-derived analysis is what the file says", () => {
    const report = fixture();
    const a = report.analysis;
    // A/A draw differences (B - A) 0.0625 and 0.125 -> |.| sorted [0.0625, 0.125], rank ceil(0.95 * 2) = 2 -> 0.125, above the timer step 0.03125.
    // A/A frame differences 0.25 and 0 -> rank 2 of [0, 0.25] -> 0.25.
    assert.deepEqual(a.floors, { "recorded-24h": { meanDrawMs: 0.125, meanFrameIntervalMs: 0.25 } });
    const original = a.comparisons.find((c) => c.vs === "original");
    // Screening draw differences 0.5 and 0.25 -> median 0.375 > 0.125 (signal); frame differences 0.5 and 0 -> median 0.25, not above 0.25.
    assert.deepEqual(original.screening.cells.map((c) => [c.metric, c.median, c.exceedsFloor]), [["meanDrawMs", 0.375, true], ["meanFrameIntervalMs", 0.25, false]]);
    // Confirmation: every pair's draw difference is 0.5, frame difference 0.125, so each bootstrap interval is the point [d, d]:
    // 0.5 > 0.125 is blocking; 0.125 <= 0.25 is no regression detected at this resolution.
    assert.deepEqual(original.confirmation.intervals.map((i) => [i.metric, i.lower, i.upper, i.floor, i.verdict]), [
      ["meanDrawMs", 0.5, 0.5, 0.125, "blocking"],
      ["meanFrameIntervalMs", 0.125, 0.125, 0.25, "no-regression-detected-at-this-resolution"],
    ]);
    // One core case x two metrics = family 2: tail 0.01 / (2 * 2) = 0.0025, level 0.995.
    assert.equal(a.familySize, 2);
    assert.equal(a.tailProbability, 0.0025);
    assert.equal(a.level, 0.995);
    assert.equal(original.verdict, "blocking");
    assert.equal(report.verdict, "blocking");
  });

  it("round-trips: the validator accepts it, the analyser reproduces its analysis and the builder its statement", async () => {
    const { validateReport } = await load("schema.mjs");
    const { analyse } = await load("stats.mjs");
    const { buildReport } = await load("report.mjs");
    const report = fixture();
    assert.deepEqual(validateReport(report), []);
    const again = analyse({
      samples: report.samples, protocol: report.protocol, budgets: report.budgets, coreIds: report.protocol.coreIds, heavyIds: report.protocol.heavyIds,
      timerResolutionMs: report.environment.timerResolutionMs, comparisons: report.analysis.comparisons.map((c) => ({ vs: c.vs, coincidesWith: c.coincidesWith })),
      seed: report.config.seed, smoke: report.smoke, forced: report.forcedInconclusive,
    });
    assert.deepEqual(again, report.analysis);
    // The limits are prose that report.mjs owns and may reword; the fixture's copy is only checked to be present (schema), not equal.
    const rebuilt = buildReport({ ...report, analysis: again });
    assert.deepEqual({ ...rebuilt, limits: null }, { ...report, limits: null });
    assert.ok(rebuilt.limits.length >= 6);
    assert.match(report.statement, /Not a designated environment; not a precision certificate\./);
  });

  it("an environment-inconclusive run (A/B refused, or forced) still produces a valid report that says so", async () => {
    const { validateReport } = await load("schema.mjs");
    const { analyse } = await load("stats.mjs");
    const { buildReport } = await load("report.mjs");
    const report = fixture();
    // Widen every A/A difference to 0.5 ms: the mean-draw floor 0.5 is above the 0.2 ms limit.
    const aa = clone(report.samples.filter((s) => s.phase === "aa"));
    for (const s of aa) if (s.arm === "B") s.draws = s.draws.map((d) => d + 0.5);
    const common = { protocol: report.protocol, budgets: report.budgets, coreIds: report.protocol.coreIds, heavyIds: [], timerResolutionMs: 0.03125, seed: 20260930, smoke: false };
    const refused = buildReport({ ...report, samples: aa, phases: { ...report.phases, screening: { ran: false, pairs: 0 }, confirmation: { ran: false, pairs: 0 }, heavy: { ran: false, pairs: 0 } }, analysis: analyse({ ...common, samples: aa, comparisons: [] }) });
    assert.deepEqual(validateReport(refused), []);
    assert.equal(refused.verdict, "environment-inconclusive");
    assert.match(refused.statement, /environment is inconclusive/);
    assert.match(refused.statement, /A\/B phases were not run/);
    const forcedSamples = [...aa, ...clone(report.samples.filter((s) => s.phase !== "aa"))];
    const forced = buildReport({ ...report, samples: forcedSamples, forcedInconclusive: true, analysis: analyse({ ...common, samples: forcedSamples, comparisons: [{ vs: "original" }], forced: true }) });
    assert.deepEqual(validateReport(forced), []);
    assert.equal(forced.verdict, "environment-inconclusive", "a forced run keeps the gate's verdict");
    assert.notEqual(forced.analysis.abVerdict, null, "its A/B outcome is kept apart, as exploratory");
    assert.match(forced.statement, /only because --force-inconclusive was given/);
  });

  it("the writer refuses an invalid report and writes JSON plus summary.md for a valid one", async () => {
    const { writeReport, renderSummary } = await load("report.mjs");
    const report = fixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-report-"));
    try {
      const broken = clone(report);
      delete broken.analysis.floors;
      assert.throws(() => writeReport(broken, { outDir: dir, stamp: "20260930T120000Z" }), /does not validate against schema\.mjs/);
      assert.deepEqual(fs.readdirSync(dir), [], "nothing is written for an invalid report");
      const { json, markdown } = writeReport(report, { outDir: dir, stamp: "20260930T120000Z" });
      assert.equal(path.basename(json), "20260930T120000Z-sample.json");
      assert.deepEqual(readJson(json), report);
      const md = fs.readFileSync(markdown, "utf8");
      assert.equal(md, renderSummary(report));
      assert.match(md, /Verdict: \*\*blocking\*\*/);
      assert.match(md, /A\/A noise floors/);
      assert.match(md, /B-L3/, "the limits travel with every report");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the validator names the path of each problem", async () => {
    const { validateReport } = await load("schema.mjs");
    const errs = (mutate) => {
      const r = clone(fixture());
      mutate(r);
      return validateReport(r);
    };
    assert.ok(errs((r) => { r.builds[0].sha = "abc"; }).some((e) => /report\.builds\[0\]\.sha/.test(e)));
    assert.ok(errs((r) => { r.samples[0].case = "unknown"; }).some((e) => /report\.samples\[0\]\.case/.test(e)));
    assert.ok(errs((r) => { r.samples[0].draws = [1, "x"]; }).some((e) => /samples\[0\]\.draws/.test(e)));
    assert.ok(errs((r) => { r.samples[0].vs = "original"; }).some((e) => /samples\[0\]\.vs/.test(e)));
    assert.ok(errs((r) => { r.smoke = true; }).some((e) => /report\.verdict/.test(e)), "smoke and verdict must agree");
    assert.ok(errs((r) => { r.environment.nonDesignatedNotice = "fine"; }).some((e) => /nonDesignatedNotice/.test(e)));
    assert.ok(errs((r) => { r.verdict = "equal"; }).some((e) => /report\.verdict/.test(e)));
    assert.ok(errs((r) => { r.kind = "x"; }).some((e) => /report\.kind/.test(e)));
    assert.ok(errs((r) => { r.limits = []; }).some((e) => /report\.limits/.test(e)));
  });

  it("the statement uses only the D12 vocabulary", async () => {
    const { statement } = await load("report.mjs");
    const base = fixture();
    const say = (analysis, extra = {}) => statement({ ...clone(base), ...extra, analysis: { ...clone(base.analysis), ...analysis } });
    const cell = (verdict) => ({ case: "x", metric: "meanDrawMs", pairs: 20, resamples: 10000, lower: 0, upper: 1, floor: 0.1, meanDifference: 0.5, verdict });
    const comparison = (verdict, intervals) => ({ vs: "original", coincidesWith: null, verdict, screening: { cells: [{ pairs: 5 }], signal: intervals !== null }, confirmation: intervals && { intervals, level: 0.999375 }, budgets: [], heavy: [], cold: [] });
    const none = say({ environment: { gate: { ok: true, limitMs: 0.2, offending: [] }, forced: false, timerResolutionMs: 0.1 }, comparisons: [comparison("no-regression-detected-at-this-resolution", null)] });
    assert.match(none, /no regression detected at this resolution/);
    assert.match(none, /not a proof of equality/);
    const inconclusive = say({ environment: { gate: { ok: true, limitMs: 0.2, offending: [] }, forced: false, timerResolutionMs: 0.1 }, comparisons: [comparison("inconclusive", [cell("inconclusive")])] });
    assert.match(inconclusive, /inconclusive/);
    assert.match(inconclusive, /not a claim of zero overhead/);
    const env = say({ environment: { gate: { ok: false, limitMs: 0.2, offending: [{ case: "x", floorMs: 0.4 }] }, forced: false, timerResolutionMs: 0.1 }, comparisons: [] });
    assert.match(env, /environment is inconclusive/);
    assert.match(env, /A\/B phases were not run/);
    const designated = say({}, { environment: { ...base.environment, designated: "bench-machine-1" } });
    assert.match(designated, /named by the operator as designated: bench-machine-1/);
    assert.doesNotMatch(designated, /Not a designated/);
    const smoke = say({ verdict: "smoke" }, { smoke: true, verdict: "smoke" });
    assert.match(smoke, /SMOKE RUN/);
    for (const text of [none, inconclusive, env, smoke]) assert.doesNotMatch(text, /\b(identical|equivalent|no overhead|faster|slower)\b/i);
  });
});

// ---- the init script, in a stub page ----

describe("instrument.js", () => {
  const SOURCE = fs.readFileSync(path.join(BENCH, "instrument.js"), "utf8");
  // Arrays made inside the vm context have another Array prototype; comparing them as JSON keeps the assertions about values.
  const plain = (x) => JSON.parse(JSON.stringify(x));

  // A page with just enough of a browser: a frame queue the test flushes by hand, a clock it sets by hand, canvases with width and
  // height accessors on a shared prototype, and window event listeners it fires by hand.
  function stubPage({ autoClock = false } = {}) {
    const listeners = {};
    const queue = [];
    const state = { t: 0 };
    class HTMLCanvasElement {
      constructor(id) { this.id = id; this._w = 300; this._h = 150; }
    }
    for (const [name, key] of [["width", "_w"], ["height", "_h"]]) {
      Object.defineProperty(HTMLCanvasElement.prototype, name, { configurable: true, enumerable: true, get() { return this[key]; }, set(v) { this[key] = v; } });
    }
    const window = {
      requestAnimationFrame(cb) { queue.push(cb); return queue.length; },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    };
    const performance = { now: () => (autoClock ? (state.t += 0.25) : state.t) };
    vm.runInContext(SOURCE, vm.createContext({ window, HTMLCanvasElement, performance, Object }));
    return {
      window, HTMLCanvasElement, state,
      fire: (type, timeStamp) => { for (const fn of listeners[type] ?? []) fn({ timeStamp }); },
      // Run the callbacks queued so far with a frame timestamp (callbacks queued by them wait for the next flush).
      flush: (timestamp) => { for (const cb of queue.splice(0)) cb(timestamp); },
    };
  }

  it("records a draw exactly when a width or height assignment on #ol-canvas happened inside the callback (DD-T28)", () => {
    const page = stubPage();
    const canvas = new page.HTMLCanvasElement("ol-canvas");
    const other = new page.HTMLCanvasElement("probe");
    const { window, state } = page;
    // The wrapper reads the clock just before it calls the page's callback and just after, so each step sets the clock to the start time
    // first and the callback moves it to the end time.
    window.__bench.begin();
    state.t = 10;
    window.requestAnimationFrame(() => { canvas.width = 100; state.t = 12; }); // a draw: 2 ms
    page.flush(0);
    state.t = 13;
    window.requestAnimationFrame(() => { other.width = 50; state.t = 15; }); // another canvas: not a draw
    page.flush(16);
    state.t = 16;
    window.requestAnimationFrame(() => { state.t = 18; }); // no assignment: not a draw
    page.flush(33);
    state.t = 20;
    window.requestAnimationFrame(() => { canvas.height = 80; state.t = 25; }); // a height assignment: a draw, 5 ms
    page.flush(50);
    const r = plain(window.__bench.end());
    assert.deepEqual(r.draws, [2, 5]);
    assert.equal(canvas.width, 100, "the assignment reaches the real setter");
    assert.equal(canvas.height, 80);
    assert.equal(other.width, 50);
  });

  it("a width or height assignment OUTSIDE every page callback is not a draw, is counted apart, and never leaks into the next callback (AM-H7a-3)", async () => {
    const page = stubPage();
    const canvas = new page.HTMLCanvasElement("ol-canvas");
    const { window, state } = page;
    window.__bench.begin();
    canvas.width = 11; // before any callback: a resize handler, say
    state.t = 10;
    window.requestAnimationFrame(() => { state.t = 12; }); // no assignment of its own
    page.flush(0);
    state.t = 13;
    window.requestAnimationFrame(() => {
      state.t = 14;
      // a microtask runs after the callback has returned, so this assignment is outside it
      queueMicrotask(() => { canvas.height = 7; });
    });
    page.flush(16);
    await Promise.resolve();
    canvas.width = 12; // between frames
    state.t = 20;
    window.requestAnimationFrame(() => { state.t = 21; });
    page.flush(33);
    state.t = 30;
    window.requestAnimationFrame(() => { canvas.width = 13; state.t = 34; }); // the only draw
    page.flush(50);
    const r = plain(window.__bench.end());
    assert.deepEqual(r.draws, [4], "only the assignment inside a callback makes a draw");
    assert.equal(r.outsideSets, 3, "the three outside assignments are counted apart");
    assert.equal(canvas.width, 13, "every assignment still reaches the real setter");
    assert.equal(canvas.height, 7);
    // and outside begin()..end() nothing is counted at all
    canvas.width = 99;
    window.__bench.begin();
    assert.equal(plain(window.__bench.end()).outsideSets, 0, "begin() starts from zero");
    canvas.width = 98;
    assert.equal(plain(window.__bench.end()).outsideSets, 0, "a stopped recorder counts nothing");
  });

  it("a callback that invokes another recorded callback synchronously stays a callback until the outer one returns", () => {
    const page = stubPage();
    const canvas = new page.HTMLCanvasElement("ol-canvas");
    const { window, state } = page;
    window.__bench.begin();
    state.t = 10;
    let inner;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {});
      inner = true;
      state.t = 11;
      page.flush(1); // runs the callback just queued: a nested wrapped callback, which returns first
      canvas.width = 5; // still inside the outer callback
      state.t = 15;
    });
    page.flush(0);
    const r = plain(window.__bench.end());
    assert.equal(inner, true);
    assert.deepEqual(r.draws, [5], "the assignment after the inner callback returned is inside the outer one");
    assert.equal(r.outsideSets, 0);
  });

  it("frame intervals are differences of the heartbeat's timestamps, taken only while recording", () => {
    const page = stubPage();
    const { window } = page;
    window.requestAnimationFrame(() => {});
    page.flush(0);
    window.__bench.begin();
    for (const ts of [100, 116, 133, 150]) page.flush(ts);
    const r = plain(window.__bench.end());
    assert.deepEqual(r.frameIntervals, [16, 17, 17]);
    assert.equal(r.frameCount, 4);
    page.flush(200); // after end(): the heartbeat has stopped
    assert.equal(window.__bench.end().frameCount, 4, "the heartbeat does not re-arm after end()");
  });

  it("input to paint: the end of the first draw that began after the event, minus the event's timestamp", () => {
    const page = stubPage();
    const canvas = new page.HTMLCanvasElement("ol-canvas");
    const { window, state } = page;
    window.__bench.begin();
    page.fire("wheel", 9); // before the first draw began (t = 10): answered by it
    page.fire("pointermove", 11); // after that draw began: waits for the next
    state.t = 10;
    window.requestAnimationFrame(() => { canvas.width = 1; state.t = 12; });
    page.flush(0);
    page.fire("pointermove", 30); // never answered
    state.t = 20;
    window.requestAnimationFrame(() => { canvas.width = 1; state.t = 25; });
    page.flush(16);
    const r = plain(window.__bench.end());
    assert.deepEqual(r.draws, [2, 5]);
    assert.deepEqual(r.inputToPaint, [12 - 9, 25 - 11]);
    assert.equal(r.unpainted, 1);
  });

  it("does not record outside begin()..end(), and an exception in a page callback still reaches the page", () => {
    const page = stubPage();
    const canvas = new page.HTMLCanvasElement("ol-canvas");
    const { window, state } = page;
    window.requestAnimationFrame(() => { canvas.width = 1; });
    page.fire("wheel", 1);
    page.flush(0);
    window.__bench.begin();
    state.t = 40;
    window.requestAnimationFrame(() => { canvas.width = 2; state.t = 43; throw new Error("page bug"); });
    assert.throws(() => page.flush(16), /page bug/);
    const r = plain(window.__bench.end());
    assert.deepEqual(r.draws, [3], "the draw that threw is still a draw");
    assert.deepEqual(r.inputToPaint, []);
  });

  it("timerResolution is the smallest positive step of the clock", () => {
    const page = stubPage({ autoClock: true });
    assert.equal(page.window.__bench.timerResolution(), 0.25);
  });

  it("installs once and cannot be replaced", () => {
    const page = stubPage();
    const bench = page.window.__bench;
    assert.equal(bench.version, 1);
    assert.throws(() => { page.window.__bench = {}; }, TypeError);
    assert.equal(page.window.__bench, bench);
  });
});

describe("P4-S1 predeclared v2", () => {
  it("pins candle budgets, cases, cache and all real levels without changing v1", async () => {
    const v2 = readJson(path.join(BENCH, "navigation.v2.json"));
    const { validateConfig } = await load("schema.mjs");
    assert.deepEqual(validateConfig(v2), []);
    assert.equal(v2.schemaVersion, 2);
    assert.deepEqual(v2.core, config().core);
    assert.deepEqual(v2.protocol, config().protocol);
    assert.deepEqual(v2.budgets, config().budgets);
    assert.equal(v2.budgetCondition, "baseline-meets-budget");
    assert.deepEqual(v2.candleCache, { ranges: 64, records: 65536, bytes: 16777216, recordBytes: 192 });
    assert.deepEqual(v2.candleCases.map(x => x.id), ["candles-24h", "candles-7d", "candles-all", "candles-lens"]);
    assert.deepEqual(v2.realHost.requiredLevels, Array.from({length:21},(_,n)=>n));
    v2.candleCache.ranges++;
    assert.ok(validateConfig(v2).some(x => x.includes("candleCache")));
  });
});
it("v3 extends the immutable candle matrix without changing any acceptance number", async () => {
 const v2=readJson(path.join(BENCH,"navigation.v2.json")),v3=readJson(path.join(BENCH,"navigation.v3.json"));
 const {validateConfig}=await load("schema.mjs");assert.deepEqual(validateConfig(v3),[]);
 for(const key of ["protocol","budgets","budgetCondition","candleCache","realHost","core"])assert.deepEqual(v3[key],v2[key],key);
 assert.deepEqual(v3.candleCases.slice(0,4),v2.candleCases);assert.deepEqual(v3.candleCases.slice(4).map(x=>x.id),["candles-old-week","candles-rows-references","candles-replay"]);
});
