#!/usr/bin/env node
// Local diagnostic matrix, deliberately separate from paired D12 acceptance.
// node tools/benchmark_drawings.mjs --workspace --smoke --out reports/drawing-diagnostic
// --candidate <sha> uses exact materialise(); --drawing-count 0|20|200 narrows the pinned matrix.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { percentileNearestRank } from "./benchmark/stats.mjs";
const require = createRequire(import.meta.url), { startFake } = require("../tests/support/cube-fake.js"), { materialise } = require("../tests/support/builds.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), configPath = path.join(ROOT, "tools/benchmark/drawings.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const { values: args } = parseArgs({ options: { workspace: { type: "boolean" }, smoke: { type: "boolean" }, candidate: { type: "string" }, out: { type: "string", default: "reports/drawing-diagnostic" }, "drawing-count": { type: "string" }, "browser-mode": { type: "string", default: "headless-shell" } } });
if (args.workspace === Boolean(args.candidate)) throw new Error("choose exactly --workspace or --candidate <sha>");
const counts = args["drawing-count"] === undefined ? config.drawingCounts : [Number(args["drawing-count"])];
if (counts.some((n) => !config.drawingCounts.includes(n))) throw new Error("drawing-count must be 0,20 or200");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), out = path.resolve(ROOT, args.out), sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
let build;
if (args.workspace) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msce-drawing-diagnostic-"));
  execFileSync("python3", ["tools/build.py", "--out", path.join(dir, "index.html")], { cwd: ROOT, stdio: "pipe" });
  fs.cpSync(path.join(ROOT, "vendor"), path.join(dir, "vendor"), { recursive: true }); build = { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
} else build = materialise(args.candidate, "drawing-diagnostic");
const provenance = { sha: build.sha || sha, pageSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(build.dir,"index.html"))).digest("hex"), configSha256: crypto.createHash("sha256").update(fs.readFileSync(configPath)).digest("hex") };
const fake = await startFake({ mode: "live", ...config.data, pageRoot: build.dir });
const browser = await chromium.launch(args["browser-mode"] === "chromium-new-headless" ? { headless: true, channel: "chromium" } : { headless: true });
const raw = [], steps = args.smoke ? 6 : config.drawSteps, samples = args.smoke ? 1 : config.samples;
const hash = (mode, play = false) => `#t=${config.camera.timeStart}~${config.camera.timeEnd}&p=${config.camera.priceLowCents / 100}~${config.camera.priceHighCents / 100}&r=4,0&vis=2&mode=${mode}${play ? "&replay=1&at=2026-09-24T06:00:00Z" : ""}`;
const ready = (page) => page.waitForFunction(() => document.getElementById("ol-loading")?.hidden && /^\d+$/.test(document.getElementById("ol-canvas")?.dataset.drawingCount || ""), null, { timeout: 60000 });
const frame = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const reads = () => fake.log().filter((r) => r.path.startsWith("/cube/"));
async function plot(page) { return page.locator("#ol-canvas").evaluate((n) => { const [x,y,w,h]=n.dataset.layout.split(",").map(Number), b=n.getBoundingClientRect(); return {x:x+b.x,y:y+b.y,w,h}; }); }
try {
  for (const mode of config.priceModes) for (const count of counts) for (const action of config.actions) for (let sample = 0; sample < samples; sample++) {
    const context = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light", serviceWorkers: "block" });
    await context.addInitScript({ path: path.join(ROOT, "tools/benchmark/instrument.js") });
    const page = await context.newPage(), errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(fake.url + "/" + hash(mode, action === "play")); await ready(page);
    await page.evaluate(({ count, camera }) => {
      const timeA = Date.parse(camera.timeStart), timeB = Date.parse(camera.timeEnd), anchor = (x, y) => ({ timeMs: Math.round(timeA + (timeB-timeA)*x), priceCents: Math.round(camera.priceLowCents + (camera.priceHighCents-camera.priceLowCents)*(1-y)) });
      const collection = { schemaVersion: 1, instrument: "binance:spot:BTCUSDT", visible: true, objects: Array.from({length:count}, (_,i) => ({ id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`, name:`Diagnostic ${i+1}`, a:anchor(.25,i===0?.75:.05+(i%19)*.045), b:anchor(.75,i===0?.25:.05+((i*7)%19)*.045), color:"#cc00ff", visible:true, locked:false, ordinal:i })) };
      const saved = window.explorerState.drawings.save(collection,1); if(!saved.ok) throw new Error(saved.reason);
    }, { count, camera: config.camera });
    await page.reload(); await ready(page); await fake.idle({ quietMs: 500, timeoutMs: 20000 }); await wait(config.pauseMs);
    if (action === "drag" && count > 0) {
      await page.locator("#ol-lines").click(); const row = page.locator('[data-drawing-row="00000000-0000-4000-8000-000000000000"]'), move = row.locator('[data-drawing-action="move"]');
      if (await move.isHidden()) await row.locator("summary").click(); await move.click();
      if (await page.locator("#ol-lines-pop").isVisible()) await page.keyboard.press("Escape");
    }
    await fake.idle({ quietMs: 300, timeoutMs: 20000 }); await wait(config.pauseMs);
    const box = await plot(page), from = action === "drag" && count ? {x:box.x+box.w*.25,y:box.y+box.h*.75} : {x:box.x+box.w*.5,y:box.y+box.h*.5};
    const before = await page.evaluate(() => window.explorerState.drawings.load().collection);
    await page.locator("#ol-canvas").focus(); await page.mouse.move(from.x, from.y); fake.clearLog();
    await page.evaluate(() => window.__bench.begin());
    if (action === "play") { await page.locator("#ol-play").click(); await wait(args.smoke ? 500 : config.playMs); await page.locator("#ol-play").click(); }
    else { await page.mouse.down(); for(let i=1;i<=steps;i++){await page.mouse.move(from.x+80*i/steps,from.y-40*i/steps);await wait(config.stepMs);} await page.mouse.up(); }
    await wait(config.pauseMs); await frame(page); const metrics = await page.evaluate(() => window.__bench.end());
    await fake.idle({ quietMs: 300, timeoutMs: 20000 });
    const requestLog = reads(), manualOnly = action === "drag" && count > 0, after = await page.evaluate(() => window.explorerState.drawings.load().collection);
    const editApplied = manualOnly ? JSON.stringify(before.objects[0].a) !== JSON.stringify(after.objects[0].a) : null;
    const result = { mode, drawingCount: count, action, actualOperation: action === "drag" ? count ? "endpoint edit" : "empty-chart pan baseline" : action, sample, ...metrics, requests: requestLog.map((r) => ({path:r.path,bytes:r.bytes})), manualOnly, editApplied, finalDrawingCount: after.objects.length, manualReadsZero: manualOnly ? requestLog.length === 0 : null, errors };
    raw.push(result); process.stderr.write(`${mode} ${count} ${action}: draws=${metrics.draws.length} reads=${requestLog.length}\n`);
    await context.close();
  }
  const summary = raw.map((s) => ({ mode:s.mode,drawingCount:s.drawingCount,action:s.action,sample:s.sample,p95DrawMs:s.draws.length ? percentileNearestRank(s.draws,.95) : null,p95FrameMs:s.frameIntervals.length ? percentileNearestRank(s.frameIntervals,.95) : null,p95InputToPaintMs:s.inputToPaint.length ? percentileNearestRank(s.inputToPaint,.95) : null,gestureIntervalOver33_3MsShare:s.frameIntervals.length ? s.frameIntervals.filter((ms)=>ms>33.3).length/s.frameIntervals.length : null,manualReadsZero:s.manualReadsZero,editApplied:s.editApplied }));
  const report = { kind: "drawing-local-diagnostic", verdict: "diagnostic", note: config.note, smoke: Boolean(args.smoke), ...provenance, workingTree: Boolean(args.workspace), browser: browser.version(), config, host: { platform: os.platform(), arch: os.arch(), cpus: os.cpus()[0]?.model }, summary, samples: raw };
  fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,"raw.json"),JSON.stringify(report,null,2)+"\n");
  if(raw.some((s)=>s.errors.length || s.manualReadsZero === false || s.editApplied === false || s.draws.length === 0)) throw new Error("diagnostic contains page errors, drawing-only reads, a missed edit or an action without painted samples; inspect raw.json");
} finally { await browser.close(); await fake.close(); build.cleanup?.(); }
