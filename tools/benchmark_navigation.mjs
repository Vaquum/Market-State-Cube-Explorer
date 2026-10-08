#!/usr/bin/env node
// tools/benchmark_navigation.mjs (H9): the D12 navigation benchmark, TESTPLAN.md section 5.
//
//   npm run benchmark                  the full protocol on this machine (30 to 90 minutes; leave the machine alone)
//   npm run benchmark:smoke            the same code on a reduced protocol: proves the tool works and its report validates
//   node tools/benchmark_navigation.mjs --config tools/benchmark/navigation.v1.json --out reports/benchmark
//        [--baseline <sha>] [--preceding <sha>] [--candidate <sha|HEAD|working>] [--smoke] [--browser-mode chromium-new-headless|headless-shell]
//        [--label <name>] [--designated <name>] [--cpu-throttle <rate>] [--allow-dirty] [--force-inconclusive]
//        [--comparison-only] (v4 DOM actions); --candidate working --allow-dirty snapshots the explicit built working page
//
// What it does, in the order D12 states it: materialise each build from git (never rebuilt), serve it from a fake cube (one fake per build,
// the same profile and seed, the same pack token asserted), run 10 alternating A/A pairs on the original build for the per-case noise
// floors, screen 5 randomised A/B pairs, confirm with 20 pairs over the whole core when screening shows a signal, run the heavy
// combinations for their incremental cost, and write navigation-report.v1 as JSON plus summary.md under --out. A pair is two trials
// of one case; a trial is a new browser process, a new context, the case's view, one COLD run of the gesture, a reset of the view by
// hash, and one STEADY run (the compared metric). No frame is ever selected or discarded. CI never gates on the numbers.
//
// The pure parts (statistics, schedules, schema, report) are in tools/benchmark/ and are unit-tested; this file is the part that needs
// a browser.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { aaSchedule, abSchedule } from "./benchmark/schedule.mjs";
import { validateConfig } from "./benchmark/schema.mjs";
import { analyse, analyseAA, analyseScreening } from "./benchmark/stats.mjs";
import { buildReport, writeReport } from "./benchmark/report.mjs";
import { evidenceFixture } from "./benchmark/evidence-fixture.mjs";
import { COMPARISON_KEY, comparisonFixture, comparisonSummary } from "./benchmark/comparison.mjs";

const require = createRequire(import.meta.url);
const { startFake } = require("../tests/support/cube-fake.js");
const { materialise } = require("../tests/support/builds.js");
const { PROTOCOL } = require("../tests/support/bridge-model.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const INSTRUMENT = path.join(HERE, "benchmark", "instrument.js");
const ORIGINAL_SHA = "8c82ca1f03d80d3f35ff1ab6326902f4286f7b92";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (text) => process.stderr.write(`${text}\n`);

// ---- arguments ----

export function parseArgs(argv) {
  const args = { config: "tools/benchmark/navigation.v1.json", out: "reports/benchmark", smoke: false, allowDirty: false, forceInconclusive: false };
  const takesValue = new Set(["--config", "--out", "--baseline", "--preceding", "--candidate", "--browser-mode", "--label", "--designated", "--cpu-throttle"]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--smoke") args.smoke = true;
    else if (flag === "--allow-dirty") args.allowDirty = true;
    else if (flag === "--comparison-only") args.comparisonOnly = true;
    else if (flag === "--force-inconclusive") args.forceInconclusive = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (takesValue.has(flag)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      args[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    } else throw new Error(`unknown option ${flag} (see the header of tools/benchmark_navigation.mjs)`);
  }
  if (args.cpuThrottle !== undefined) {
    args.cpuThrottle = Number(args.cpuThrottle);
    if (!(args.cpuThrottle >= 1)) throw new Error("--cpu-throttle must be a rate of at least 1");
  }
  return args;
}

// Legacy smoke runs benchmark the baseline against itself. A config with DOM comparison
// diagnostics needs a candidate that has Compare, so its default is the committed HEAD.
export function candidateReference(args, config, baseline) {
  return args.candidate ?? (args.smoke && !config.comparison ? baseline : "HEAD");
}

export function requireComparisonSurface(build) {
  const html = fs.readFileSync(path.join(build.dir, "index.html"), "utf8");
  const required = ["ol-tab-compare", "ol-panel-compare", "ol-comparisonWorkspace"];
  const missing = required.filter((id) => !new RegExp(`\\s+id\\s*=\\s*["']${id}["']`).test(html));
  if (missing.length) throw new Error(`Comparison diagnostics unsupported for candidate ${build.sha}: required Compare surface missing (${missing.join(", ")}). Select a commit with Compare; no DOM samples were measured.`);
}

const git = (...args) => execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function resolveCommit(ref) {
  try {
    return git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  } catch {
    throw new Error(`${ref} is not a commit of this clone; fetch it with: git fetch --no-tags --depth=1 origin ${ref}`);
  }
}

// An explicitly requested working candidate is copied once before any trial. Its HEAD identifies
// the parent commit; the report identifies the tested bytes with their hashes and workingTree flag.
function snapshotWorkingPage(sha, label) {
  const dir = path.join(REPO_ROOT, "reports", "builds", `${label}-working-${sha.slice(0, 7)}-${Date.now()}`);
  for (const relative of ["index.html", "vendor/d3.min.js", "vendor/D3-LICENSE"]) {
    const target = path.join(dir, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, relative), target);
  }
  const hashFile = (relative) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, relative))).digest("hex");
  return { dir, sha, workingTree: true, indexSha256: hashFile("index.html"), vendorSha256: hashFile("vendor/d3.min.js") };
}

// The protocol this run executes: the configuration as committed, or, for --smoke, its `smoke` block laid over it. The family size
// always follows the cases actually compared, so the Bonferroni level is never claimed for cases that were not run.
function effective(config, smoke) {
  const byId = (list) => new Map(list.map((c) => [c.id, c]));
  if (!smoke) {
    return { protocol: config.protocol, gesture: config.gesture, core: config.core, heavy: [...config.heavy, ...(config.candleCases ?? [])] };
  }
  const s = config.smoke;
  const core = s.coreIds.map((id) => byId(config.core).get(id));
  const heavy = [...s.heavyIds.map((id) => byId(config.heavy).get(id)), ...(config.candleCases ?? [])];
  const protocol = {
    ...config.protocol,
    aaPairs: s.aaPairs,
    screeningPairs: s.screeningPairs,
    confirmationPairs: s.confirmationPairs,
    heavyPairs: s.heavyPairs,
    bootstrapResamples: s.bootstrapResamples,
    familySize: core.length * 2,
  };
  let gesture = config.gesture;
  if (s.gesture) {
    gesture = {
      ...config.gesture,
      wheel: { ...config.gesture.wheel, in: s.gesture.wheelIn, out: s.gesture.wheelOut },
      drags: config.gesture.drags.slice(0, s.gesture.drags),
    };
  }
  return { protocol, gesture, core, heavy };
}

// ---- one run of the gesture in a page ----

const evaluate = (page, fn, arg) => page.evaluate(fn, arg);

// D12: 12 wheel zooms in and 12 out, 40 ms apart, then four 300 px drags. The wheel goes in with a negative deltaY (the page multiplies
// the span by exp(0.003 deltaY)), out with a positive one. Every wheel tick is scheduled against the start of the gesture rather
// than the previous tick, so the intervals do not drift with the cost of one call.
async function gestureRun(page, g, center, pauseMs) {
  await page.mouse.move(center.x, center.y);
  await evaluate(page, () => window.__bench.begin());
  const started = performance.now();
  const ticks = g.wheel.in + g.wheel.out;
  for (let i = 0; i < ticks; i++) {
    const wait = started + i * g.wheel.intervalMs - performance.now();
    if (wait > 0) await sleep(wait);
    await page.mouse.wheel(0, i < g.wheel.in ? -g.wheel.deltaY : g.wheel.deltaY);
  }
  await sleep(pauseMs);
  for (const drag of g.drags) {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (let s = 1; s <= g.dragSteps; s++) {
      await page.mouse.move(center.x + (drag.dx * s) / g.dragSteps, center.y + (drag.dy * s) / g.dragSteps);
      await sleep(g.dragStepMs);
    }
    await page.mouse.up();
  }
  // The page settles 220 ms after the last zoom tick and draws again: that work belongs to the gesture.
  await sleep(pauseMs);
  await evaluate(page, () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return evaluate(page, () => window.__bench.end());
}

function readsOf(fake) {
  const all = fake.log();
  const cube = all.filter((e) => e.path.startsWith("/cube/"));
  const reads = {};
  for (const e of cube) reads[e.path] = (reads[e.path] ?? 0) + 1;
  return { bytes: cube.reduce((sum,e)=>sum+e.bytes,0), reads, readOrder: cube.slice(0, 200).map((e) => e.path), unexpected: all.filter((e) => e.unexpected).length };
}

// fits: the candidate's in-page fit commit counter (data-fit-seq of the Cells chip, INTEGRATION.md D.18); the baseline has none and
// records null.
const fitsOf = (page) =>
  evaluate(page, () => {
    const v = document.getElementById("ol-legend")?.getAttribute("data-fit-seq");
    const n = v === null || v === undefined ? NaN : Number(v);
    return Number.isInteger(n) ? n : null;
  });

// ---- one trial ----

async function trial({ build, caseDef, config, gesture, mode, cpuThrottle, reducedMotion }) {
  const fake = caseDef.mode === "recorded" ? build.recorded : build.live;
  fake.clearLog();
  const browser = await (await import("@playwright/test")).chromium.launch(launchOptions(mode));
  try {
    const context = await browser.newContext({
      viewport: config.viewport,
      deviceScaleFactor: config.dpr,
      colorScheme: "light",
      reducedMotion,
      serviceWorkers: "block",
    });
    await context.addInitScript({ path: INSTRUMENT });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    if (cpuThrottle) {
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
    }
    const loadStarted = performance.now();
    await page.goto(`${fake.url}/${caseDef.view}`, { waitUntil: "load", timeout: config.trial.loadTimeoutMs });
    // The page is ready when its loading line is hidden: all three blocks are decoded (#ol-loading is the same element in both builds).
    await page.waitForFunction(() => document.getElementById("ol-loading")?.hidden === true, null, { timeout: config.trial.loadTimeoutMs });
    await fake.idle({ quietMs: config.trial.idleQuietMs, timeoutMs: config.trial.idleTimeoutMs });
    await sleep(config.trial.pauseMs);

    const coldLoadMs = performance.now() - loadStarted;
    const timerResolutionMs = await evaluate(page, () => window.__bench.timerResolution());
    const box = await page.locator("#ol-canvas").boundingBox();
    if (!box) throw new Error("#ol-canvas has no box: the page did not draw");
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // A case may need a tool before the gesture (the lens: press L, move to the canvas centre).
    for (const key of caseDef.preGesture?.keys ?? []) await page.keyboard.press(key);
    if (caseDef.preGesture) await page.mouse.move(center.x, center.y);
    await sleep(config.trial.pauseMs);

    const cold = await gestureRun(page, gesture, center, config.trial.pauseMs);
    await fake.idle({ quietMs: config.trial.idleQuietMs, timeoutMs: config.trial.idleTimeoutMs });
    const coldReads = readsOf(fake);
    const coldFits = await fitsOf(page);
    const coldCandle = await evaluate(page, () => { const node=document.getElementById("ol-candle-legend"), d=node && !node.hidden ? node.dataset : null; return d ? {ranges:+d.cacheRanges,records:+d.cacheRecords,bytes:+d.cacheBytes,decodeMs:+d.decodeMs,encodedBytes:+d.encodedBytes,decodedBytes:+d.decodedBytes} : null; });

    // Reset the view by hash: the page takes an address it did not write whole (popstate), so the steady run starts from the case's
    // view with everything it has already loaded and calibrated. The detour through an address that names no view makes sure the
    // second assignment is a change and therefore fires popstate.
    fake.clearLog();
    await evaluate(page, (view) => { location.hash = "#reset"; location.hash = view; }, caseDef.view);
    await sleep(config.trial.pauseMs);
    await fake.idle({ quietMs: config.trial.idleQuietMs, timeoutMs: config.trial.idleTimeoutMs });
    await evaluate(page, () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    fake.clearLog();

    const steady = await gestureRun(page, gesture, center, config.trial.pauseMs);
    await fake.idle({ quietMs: config.trial.idleQuietMs, timeoutMs: config.trial.idleTimeoutMs });
    const steadyReads = readsOf(fake);
    const steadyFits = await fitsOf(page);
    const steadyCandle = await evaluate(page, () => { const node=document.getElementById("ol-candle-legend"), d=node && !node.hidden ? node.dataset : null; return d ? {ranges:+d.cacheRanges,records:+d.cacheRecords,bytes:+d.cacheBytes,decodeMs:+d.decodeMs,encodedBytes:+d.encodedBytes,decodedBytes:+d.decodedBytes} : null; });

    const toggles = [];
    if (caseDef.view.includes("mode=candles")) {
      for (const target of ["Volume", "Candles"]) {
        fake.clearLog();
        await evaluate(page, () => window.__bench.begin());
        await page.keyboard.press("k");
        await page.waitForFunction(target => document.getElementById("ol-mode-text")?.textContent === target, target);
        await fake.idle({ quietMs: config.trial.idleQuietMs, timeoutMs: config.trial.idleTimeoutMs });
        await evaluate(page, () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        toggles.push({ target, ...await evaluate(page, () => window.__bench.end()), ...readsOf(fake) });
      }
    }

    const run = (r, reads, fits, candle) => ({
      readBytes: reads.bytes, candle,
      draws: r.draws,
      frameIntervals: r.frameIntervals,
      inputToPaint: r.inputToPaint,
      unpainted: r.unpainted,
      reads: reads.reads,
      readOrder: reads.readOrder,
      fits,
      errors: pageErrors.length,
      unexpected: reads.unexpected,
    });
    return { cold: { ...run(cold, coldReads, coldFits, coldCandle), loadMs: coldLoadMs }, steady: { ...run(steady, steadyReads, steadyFits, steadyCandle), toggles }, timerResolutionMs, version: browser.version(), pageErrors };
  } finally {
    await browser.close();
  }
}

function launchOptions(mode) {
  // "chromium-new-headless" is the full Chrome for Testing build in its new headless mode; "headless-shell" is the stripped binary the
  // tests and the smoke run use. The mode is recorded in the report.
  return mode === "chromium-new-headless" ? { headless: true, channel: "chromium" } : { headless: true };
}

// Candidate-only Compare diagnostics reuse the same runner, fake, page instrumentation and report
// directory. Older builds have no comparison surface, so these are not folded into the paired
// navigation verdict. --candidate working --allow-dirty explicitly records the actual built bytes.
async function runEvidenceDiagnostics({config,args,build,browser,out}) {
  const samples=[];
  for(const days of [config.evidence.longDays,config.evidence.withheldDays]) {
    const fake=await startFake({mode:"live",profile:evidenceFixture(days),pageRoot:build.dir}), context=await browser.newContext({viewport:config.viewport,reducedMotion:"reduce"});
    try {
      const page=await context.newPage(), errors=[]; page.on("pageerror",e=>errors.push(String(e)));
      const begin=performance.now();
      await page.goto(`${fake.url}/#w=30d&r=${config.evidence.n},${config.evidence.m}&auto=0&vis=2&tab=evidence`,{timeout:config.trial.loadTimeoutMs});
      await page.locator('#ol-evidence-tab').click();
      await page.waitForFunction(()=>!!document.getElementById('ol-evidence-intervals')?.dataset.bootstrap,null,{timeout:config.trial.idleTimeoutMs});
      const result=await page.locator('#ol-evidence-intervals').evaluate(node=>JSON.parse(node.dataset.bootstrap)), reads=readsOf(fake);
      const qualified=Object.values(result.intervals).some(parts=>Object.values(parts).some(x=>x.result.tag==="finite"));
      samples.push({days,elapsedMs:performance.now()-begin,qualified,...result,readBytes:reads.bytes,reads:reads.reads,errors});
      if(errors.length || days===config.evidence.longDays && (!qualified || result.fullMatched<20) || days===config.evidence.withheldDays && qualified) throw new Error(`Evidence fixture qualification mismatch for ${days} days`);
    } finally {await context.close();await fake.close();}
  }
  fs.writeFileSync(path.join(out,"evidence-context.json"),JSON.stringify({kind:"candidate-only-evidence-diagnostic",statement:"Synthetic current-source intervals; no designated-machine timing certificate or new timing gate",samples},null,2)+"\n");
}
async function runComparisonDiagnostics({ config, configPath, configBytes, args, mode }) {
  if (!config.comparison) throw new Error("Comparison diagnostics require navigation.v4.json");
  const candidateRef = args.candidate ?? "HEAD";
  const working = candidateRef === "working";
  if (working && !args.allowDirty) throw new Error("--candidate working requires --allow-dirty");
  if (!working && candidateRef === "HEAD" && !args.allowDirty && git("status", "--porcelain", "--untracked-files=no")) throw new Error("Commit the candidate or explicitly name --candidate working --allow-dirty");
  const sha = resolveCommit(working ? "HEAD" : candidateRef);
  const build = working ? snapshotWorkingPage(sha, "comparison-candidate") : materialise(sha, "comparison-candidate");
  requireComparisonSurface(build);
  const fake = await startFake({ mode: "live", profile: config.data.profile, seed: config.data.seed, cutoff: config.data.cutoff, pageRoot: build.dir });
  const browser = await (await import("@playwright/test")).chromium.launch(launchOptions(mode)), samples = [], errors = [];
  try {
    const version = browser.version();
    if (Number.parseInt(version, 10) !== config.browser.expectMajor) throw new Error(`Chromium ${version} is not pinned major ${config.browser.expectMajor}`);
    const cases = [...config.comparison.counts.map((count) => ({ id: `comparison-${count}`, count, bytes: 0 })), { id: "comparison-near-cap", count: 128, bytes: config.comparison.nearLimitBytes }];
    for (const caseDef of cases) {
      const model = comparisonFixture(caseDef.count, caseDef.bytes), raw = JSON.stringify(model), recordBytes = Buffer.byteLength(raw, "utf8");
      const context = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: config.dpr, colorScheme: "light", reducedMotion: config.browser.reducedMotion, serviceWorkers: "block" });
      try {
        await context.addInitScript({ path: INSTRUMENT });
        await context.addInitScript(({ key, text }) => sessionStorage.setItem(key, text), { key: COMPARISON_KEY, text: raw });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(String(error)));
        if (args.cpuThrottle) { const session = await context.newCDPSession(page); await session.send("Emulation.setCPUThrottlingRate", { rate: args.cpuThrottle }); }
        await page.goto(`${fake.url}/#w=24h&vis=2&n=4&m=0&auto=0&poc=0&lines=`, { waitUntil: "load", timeout: config.trial.loadTimeoutMs });
        await page.waitForFunction(() => document.getElementById("ol-loading")?.hidden, null, { timeout: config.trial.loadTimeoutMs });
        await fake.idle({ quietMs: config.trial.idleQuietMs, timeoutMs: config.trial.idleTimeoutMs });
        await page.locator("#ol-tab-compare").click();
        const workspace = page.locator("#ol-comparisonWorkspace");
        if (caseDef.count) await workspace.locator('[data-comparison-action="expand"]').click();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        for (const action of config.comparison.actions) {
          if (!caseDef.count && action !== "expand") continue;
          for (let iteration = 0; iteration < config.comparison.samples; iteration++) {
            fake.clearLog();
            const before = await workspace.evaluate((node) => { window.__bench.armComparison(); return { stats: +node.dataset.stats, writes: +node.dataset.writes, bytes: +node.dataset.bytes }; });
            if (action === "focus") {
              const id = iteration % 2 ? "bench-cell-2" : "bench-cell-1";
              await workspace.locator(`[data-comparison-action="focus"][data-id="${id}"]`).click();
            } else if (action === "sort") {
              await workspace.locator('[data-comparison-control="sort"]').selectOption(iteration % 2 ? "time" : "volume");
            } else if (action === "matrix") {
              await workspace.locator(`[data-comparison-action="view"][data-value="${iteration % 2 ? "grid" : "matrix"}"]`).click();
            } else if (action === "expand") await workspace.locator('[data-comparison-action="expand"]').click();
            await page.waitForFunction(() => window.__bench.comparisonResult() !== null, null, { timeout: config.trial.idleTimeoutMs });
            const result = await page.evaluate(() => window.__bench.comparisonResult());
            await fake.idle({ quietMs: config.trial.idleQuietMs, timeoutMs: config.trial.idleTimeoutMs });
            const reads = readsOf(fake), settled = await workspace.evaluate((node) => ({ stats: +node.dataset.stats, writes: +node.dataset.writes, bytes: +node.dataset.bytes }));
            samples.push({ case: caseDef.id, action, iteration, captureCount: caseDef.count, recordBytes, ...result,
              paintCounters: { stats: result.stats, writes: result.writes, bytes: result.bytes },
              stats: settled.stats - before.stats, writes: settled.writes - before.writes, bytes: settled.bytes - before.bytes,
              readBytes: reads.bytes, reads: reads.reads, readOrder: reads.readOrder, unexpected: reads.unexpected });
          }
        }
        log(`[comparison] ${caseDef.id}: ${recordBytes} stored bytes`);
      } finally { await context.close(); }
    }
    const summary = comparisonSummary(samples, config.comparison.budgets);
    const report = { kind: "comparison-action-diagnostic", schemaVersion: 1, createdAtUtc: new Date().toISOString(),
      candidate: { sha, workingTree: working, indexSha256: build.indexSha256, vendorSha256: build.vendorSha256 },
      config: { path: path.relative(REPO_ROOT, configPath), sha256: crypto.createHash("sha256").update(configBytes).digest("hex") },
      environment: { os: `${os.type()} ${os.release()} ${os.arch()}`, cpuModel: os.cpus()[0]?.model || "unknown", cores: os.cpus().length, node: process.version, browser: { version, mode }, viewport: config.viewport, dpr: config.dpr, reducedMotion: config.browser.reducedMotion, cpuThrottle: args.cpuThrottle ?? null, ci: Boolean(process.env.CI) },
      definition: "Input click/change timestamp to committed comparison-render then two native animation frames; DOM/layout paint opportunity, not compositor presentation or canvas input-to-paint. Storage counters also recorded after action settlement.",
      statement: "Candidate-only local diagnostics against predeclared budgets; no paired navigation, CI precision gate or designated-machine certificate.",
      budgets: config.comparison.budgets, samples, summary, errors };
    const out = path.resolve(REPO_ROOT, args.out); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "comparison-actions.json"), JSON.stringify(report, null, 2) + "\n");
    const markdown = ["# Comparison action diagnostics", "", report.statement, "", `Build ${sha}${working ? " (working tree)" : ""}; index SHA-256 ${build.indexSha256}.`, "", report.definition, "", "| Case | Action | Samples | p95 ms | Mounted max | Declared budget |", "|---|---|---|---|---|---|", ...summary.map((row) => `| ${row.case} | ${row.action} | ${row.samples} | ${row.p95ActionToVisibleMs.toFixed(2)} | ${row.maxMounted} | ${row.meetsDeclaredBudget ? "met locally" : "exceeded locally"} |`), ""];
    fs.writeFileSync(path.join(out, "comparison-actions.md"), markdown.join("\n"));
    log(`comparison diagnostics: ${path.relative(REPO_ROOT, out)}/comparison-actions.json`);
    if (errors.length) throw new Error(`Comparison diagnostics recorded ${errors.length} page error(s)`);
    if (config.evidence) await runEvidenceDiagnostics({config,args,build,browser,out});
  } finally { await browser.close(); await fake.close(); }
}

// ---- main ----

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")}\n`);
    return;
  }
  const configPath = path.resolve(REPO_ROOT, args.config);
  const configBytes = fs.readFileSync(configPath);
  const config = JSON.parse(configBytes.toString("utf8"));
  const problems = validateConfig(config);
  if (problems.length) throw new Error(`${args.config} is not a valid configuration:\n  ${problems.join("\n  ")}`);

  const smoke = args.smoke;
  const plan = effective(config, smoke);
  const mode = args.browserMode ?? config.browser.mode;
  if (!["chromium-new-headless", "headless-shell"].includes(mode)) throw new Error(`--browser-mode ${mode}: use chromium-new-headless or headless-shell`);
  if (args.comparisonOnly) { await runComparisonDiagnostics({ config, configPath, configBytes, args, mode }); return; }
  const coreIds = plan.core.map((c) => c.id);
  const heavyIds = plan.heavy.map((c) => c.id);
  const caseById = new Map([...plan.core, ...plan.heavy].map((c) => [c.id, c]));
  const { protocol } = plan;
  const seed = config.seed;

  // Committed builds are materialised exactly; an explicit working candidate is snapshotted once.
  const baseline = resolveCommit(args.baseline ?? ORIGINAL_SHA);
  const preceding = resolveCommit(args.preceding ?? baseline);
  const candidateRef = candidateReference(args, config, baseline);
  const working = candidateRef === "working";
  if (working && !args.allowDirty) throw new Error("--candidate working requires --allow-dirty");
  const candidate = resolveCommit(working ? "HEAD" : candidateRef);
  if (candidateRef === "HEAD" && !args.allowDirty && git("status", "--porcelain", "--untracked-files=no")) {
    throw new Error("the working tree has uncommitted changes and the candidate is HEAD: commit them, name a commit with --candidate, or pass --allow-dirty");
  }
  const roles = { original: baseline, preceding, candidate };
  const builds = new Map(), roleKeys = {};
  for (const [role, sha] of Object.entries(roles)) {
    const key = role === "candidate" && working ? `${sha}:working` : sha;
    roleKeys[role] = key;
    if (!builds.has(key)) builds.set(key, { sha, roles: [], ...(role === "candidate" && working ? snapshotWorkingPage(sha, "navigation-candidate") : materialise(sha, role)) });
    builds.get(key).roles.push(role);
  }
  const buildOf = (role) => builds.get(roleKeys[role]);
  if (config.comparison) requireComparisonSurface(buildOf("candidate"));

  const needLive = [...plan.core, ...plan.heavy].some((c) => c.mode === "fake-live");
  for (const build of builds.values()) {
    build.recorded = await startFake({ mode: "recorded", pageRoot: build.dir });
    build.live = needLive ? await startFake({ mode: "live", profile: config.data.profile, seed: config.data.seed, cutoff: config.data.cutoff, pageRoot: build.dir }) : null;
  }
  const live = [...builds.values()].map((b) => b.live).filter(Boolean);
  const infos = live.map((f) => f.info());
  for (const info of infos) {
    if (info.packToken !== infos[0].packToken || info.cutoff !== infos[0].cutoff || info.seed !== infos[0].seed) {
      throw new Error("the fakes of the builds do not serve the same data (pack token, cutoff or seed differ); a comparison would be meaningless");
    }
  }
  const data = infos.length
    ? { profile: infos[0].profile, seed: infos[0].seed, packToken: infos[0].packToken, cutoff: infos[0].cutoff }
    : { profile: "none", seed: config.data.seed, packToken: "recorded-only", cutoff: config.data.cutoff };

  // ---- the trials ----
  const samples = [];
  const warnings = working ? [`Candidate is an explicit working-page snapshot based on HEAD ${candidate}; the candidate SHA is its parent commit, not the tested working contents. Exact index/vendor hashes and workingTree=true identify those bytes.`] : [];
  let timerResolutionMs = 0;
  let browserVersion = null;
  const trialOptions = { config, gesture: plan.gesture, mode, cpuThrottle: args.cpuThrottle ?? null, reducedMotion: config.browser.reducedMotion };

  // One trial, retried once if the browser or the page failed to do its job (a failed trial yielded no samples, so a retry selects
  // nothing); a second failure ends the run, because a report with a hole in its schedule is not the protocol.
  async function runTrial(build, caseDef) {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await trial({ build, caseDef, ...trialOptions });
        timerResolutionMs = Math.max(timerResolutionMs, result.timerResolutionMs ?? 0);
        browserVersion = result.version;
        for (const e of result.pageErrors.slice(0, 3)) warnings.push(`page error in ${caseDef.id} (${build.roles[0]}): ${e.slice(0, 200)}`);
        return result;
      } catch (error) {
        if (attempt >= 2) throw new Error(`trial ${caseDef.id} on ${build.roles[0]} failed twice: ${error.message}`);
        warnings.push(`trial ${caseDef.id} on ${build.roles[0]} failed once and was repeated: ${String(error.message).split("\n")[0]}`);
      }
    }
  }

  let done = 0;
  // The first arm of each pair index, as the report records it ("AB" or "BA").
  const pairOrders = (entries, pairs) => Array.from({ length: pairs }, (_, p) => (entries.find((e) => e.pair === p).first === "A" ? "AB" : "BA"));
  async function runPair(entry, reference, test, referenceRole, testRole, total) {
    const arms = entry.first === "A" ? ["A", "B"] : ["B", "A"];
    const caseDef = caseById.get(entry.case);
    for (const [index, arm] of arms.entries()) {
      const build = arm === "A" ? reference : test;
      const role = arm === "A" ? referenceRole : testRole;
      const result = await runTrial(build, role === "candidate" ? caseDef : { ...caseDef, view: caseDef.comparisonView ?? caseDef.view });
      const base = { phase: entry.phase, vs: entry.vs, pair: entry.pair, order: index + 1, arm, build: role, case: entry.case };
      samples.push({ ...base, run: "cold", ...result.cold }, { ...base, run: "steady", ...result.steady });
    }
    done++;
    log(`[${entry.phase}${entry.vs ? ` vs ${entry.vs}` : ""}] pair ${entry.pair + 1} ${entry.case} (${done}/${total})`);
  }
  async function runSchedule(entries, reference, test, referenceRole, testRole) {
    done = 0;
    for (const entry of entries) await runPair(entry, reference, test, referenceRole, testRole, entries.length);
  }

  // The browser's version is part of the environment and must be the pinned major before any trial counts.
  {
    const probe = await (await import("@playwright/test")).chromium.launch(launchOptions(mode));
    browserVersion = probe.version();
    await probe.close();
    const major = Number.parseInt(browserVersion, 10);
    if (major !== config.browser.expectMajor) throw new Error(`Chromium ${browserVersion} is not the pinned major ${config.browser.expectMajor}: run npx playwright install chromium (the revision of the lockfile's Playwright)`);
  }

  const phases = { aa: { ran: false, pairs: 0 }, screening: { ran: false, pairs: 0 }, confirmation: { ran: false, pairs: 0 }, heavy: { ran: false, pairs: 0 } };
  const original = buildOf("original");

  // D12 1: A/A on the original build.
  const aa = aaSchedule({ pairs: protocol.aaPairs, caseIds: coreIds, seed });
  log(`A/A: ${protocol.aaPairs} alternating pairs x ${coreIds.length} cases`);
  await runSchedule(aa, original, original, "original", "original");
  phases.aa = { ran: true, pairs: protocol.aaPairs, orders: pairOrders(aa, protocol.aaPairs) };
  const aaResult = analyseAA(samples, protocol, coreIds, timerResolutionMs);
  const force = args.forceInconclusive || smoke;
  const forced = !aaResult.gate.ok && force;
  if (!aaResult.gate.ok) {
    log(`environment inconclusive: ${aaResult.gate.offending.map((o) => `${o.case} ${o.floorMs.toFixed(3)} ms`).join(", ")} above ${aaResult.gate.limitMs} ms${force ? " (A/B continues: forced)" : " (A/B refused; pass --force-inconclusive to run it anyway)"}`);
  }

  const comparisons = [];
  if (aaResult.gate.ok || force) {
    // The comparisons of D12 5: against preceding main AND the original core. When they are the same commit, one set of pairs answers both.
    const runs = [];
    if (roles.preceding !== roles.original) runs.push({ vs: "preceding", reference: buildOf("preceding"), referenceRole: "preceding" });
    runs.push({ vs: "original", reference: original, referenceRole: "original" });
    if (roles.preceding === roles.original) comparisons.push({ vs: "preceding", coincidesWith: "original" });
    const test = buildOf("candidate");
    for (const { vs, reference, referenceRole } of runs) {
      comparisons.push({ vs });
      log(`${vs}: screening ${protocol.screeningPairs} randomised pairs x ${coreIds.length} cases`);
      const screening = abSchedule({ phase: "screening", vs, pairs: protocol.screeningPairs, caseIds: coreIds, seed });
      await runSchedule(screening, reference, test, referenceRole, "candidate");
      phases.screening = { ran: true, pairs: protocol.screeningPairs, orders: { ...phases.screening.orders, [vs]: pairOrders(screening, protocol.screeningPairs) } };
      const signal = analyseScreening(samples, vs, coreIds, aaResult.floors).signal;
      if (signal || smoke) {
        log(`${vs}: ${signal ? "a screening median exceeds its floor" : "smoke run"}: confirmation, ${protocol.confirmationPairs} pairs over the entire core`);
        const confirmation = abSchedule({ phase: "confirmation", vs, pairs: protocol.confirmationPairs, caseIds: coreIds, seed });
        await runSchedule(confirmation, reference, test, referenceRole, "candidate");
        phases.confirmation = { ran: true, pairs: protocol.confirmationPairs, reason: signal ? "screening signal" : "smoke run", orders: { ...phases.confirmation.orders, [vs]: pairOrders(confirmation, protocol.confirmationPairs) } };
      } else {
        log(`${vs}: no screening signal: no regression detected at this resolution`);
      }
      if (heavyIds.length) {
        log(`${vs}: heavy combinations, ${protocol.heavyPairs} pairs x ${heavyIds.length} cases (report only)`);
        const heavy = abSchedule({ phase: "heavy", vs, pairs: protocol.heavyPairs, caseIds: heavyIds, seed });
        await runSchedule(heavy, reference, test, referenceRole, "candidate");
        phases.heavy = { ran: true, pairs: protocol.heavyPairs, orders: { ...phases.heavy.orders, [vs]: pairOrders(heavy, protocol.heavyPairs) } };
      }
    }
  }

  if (!(timerResolutionMs > 0)) throw new Error("the page reported no timer resolution: the instrumentation did not run");
  const analysis = analyse({ samples, protocol, budgets: config.budgets, coreIds, heavyIds, timerResolutionMs, comparisons, seed, smoke, forced });

  for (const build of builds.values()) {
    await build.recorded.close();
    await build.live?.close();
  }
  const unexpected = samples.reduce((n, s) => n + s.unexpected, 0);
  if (unexpected) warnings.push(`the fakes logged ${unexpected} unexpected request(s) over all runs (a /cube/ read from a recorded page, a 404, or overlapping reads in one slot); see the samples`);
  const noFits = samples.filter((s) => s.run === "steady" && s.build === "candidate" && s.fits === null && !s.case.startsWith("candles-")).length;
  if (noFits) warnings.push(`${noFits} steady candidate run(s) had no data-fit-seq attribute (expected for a build that predates the observation surface; the baseline has none)`);

  const { json, markdown } = writeReport(
    buildReport({
      createdAtUtc: new Date().toISOString(),
      label: (args.label ?? (smoke ? "smoke" : `candidate-${candidate.slice(0, 7)}`)).replace(/[^A-Za-z0-9._-]/g, "-"),
      smoke,
      config: { path: path.relative(REPO_ROOT, configPath), sha256: crypto.createHash("sha256").update(configBytes).digest("hex"), seed },
      environment: {
        os: `${os.type()} ${os.release()} ${os.arch()}`,
        cpuModel: os.cpus()[0]?.model?.trim() || "unknown",
        cores: os.cpus().length,
        memoryGb: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
        node: process.version,
        playwright: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "node_modules", "@playwright", "test", "package.json"), "utf8")).version,
        browser: { name: "Chromium", version: browserVersion, major: Number.parseInt(browserVersion, 10), mode, args: [] },
        dpr: config.dpr,
        viewport: config.viewport,
        reducedMotion: config.browser.reducedMotion,
        timerResolutionMs,
        ci: Boolean(process.env.CI),
        designated: args.designated ?? null,
        cpuThrottle: args.cpuThrottle ?? null,
      },
      roles,
      builds: [...builds.values()].map((b) => ({ label: b.roles.join("/") + (b.workingTree ? " (working page)" : ""), sha: b.sha, workingTree: Boolean(b.workingTree), indexSha256: b.indexSha256, vendorSha256: b.vendorSha256, protocol: Number(PROTOCOL) })),
      data,
      protocol: { ...protocol, coreIds, heavyIds },
      budgets: config.budgets,
      phases,
      samples,
      analysis,
      forcedInconclusive: forced,
      warnings,
    }),
    { outDir: path.resolve(REPO_ROOT, args.out), stamp: new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z") },
  );
  log(`verdict: ${analysis.verdict}`);
  log(`report: ${path.relative(REPO_ROOT, json)}`);
  log(`summary: ${path.relative(REPO_ROOT, markdown)}`);
  if (config.comparison) await runComparisonDiagnostics({ config, configPath, configBytes, args: { ...args, candidate: working ? "working" : candidate }, mode });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`benchmark failed: ${error.stack ?? error}\n`);
    process.exit(1);
  },
);
