"use strict";
// s0-parity.spec.js (S0; K deletes it at convergence): the acceptance gate of the spine skeleton (WORKPLAN 4.3, TESTPLAN DD-T33).
//
// With every hook unregistered, the page of the working tree must draw EXACTLY what the baseline page draws. "Exactly" is tested
// as equal getImageData hashes of #ol-canvas at device pixel ratio 1, for five fixed views, against identical `mini` fake cubes:
//   24h Volume, 7d Flow, 24h Delta, 24h Cascade, 24h Path with Rows (volume) on.
// Both pages are opened in contexts created with reducedMotion "reduce" (the page reads it once at load and then starts no 170 ms
// morph, so no capture can land on a transition frame), and nothing is masked. A second test is the coarse frame-cost guard: a
// `mini` 24h wheel gesture must show a p95 draw duration within 1.5x of the baseline's in the probe (plus 0.5 ms of timer slack),
// which catches accidental per-cell work in the new draw path; the real benchmark is K's.
//
// Oracle: the ORIGINAL build 8c82ca1 (tests/support/builds.js: `git show 8c82ca1:index.html` and its vendor files, served by the
// same fake), never anything computed from the code under test. The page's own pixels are read back with getImageData and hashed
// with SHA-256 inside the page (crypto.subtle), so the comparison is over every byte of the canvas. Each test also requires the
// baseline canvas to hold more than one colour, so two blank canvases cannot pass as equal.
//
// What this does NOT prove: parity at other pixel ratios, themes or viewports, parity of anything that is not canvas (DOM text,
// attributes), or parity once a hook is registered (every later package changes pixels on purpose).
const { test, expect, probeTools } = require("./fixtures.js");

const VIEWS = [
  { name: "24h Volume", hash: "#w=24h" },
  { name: "7d Flow", hash: "#w=7d&mode=flow" },
  { name: "24h Delta", hash: "#w=24h&mode=delta" },
  { name: "24h Cascade", hash: "#w=24h&mode=cascade" },
  { name: "24h Path with Rows on", hash: "#w=24h&mode=path&rows=volume" },
];

// Console messages of a context that a clean page does not produce: errors (the fixtures also fail on them) and warnings.
function watchConsole(context) {
  const seen = [];
  context.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") seen.push(`${message.type()}: ${message.text()}`);
  });
  return seen;
}

// The canvas as the page painted it: its size, a SHA-256 of every byte, and how many distinct colours it has (capped).
async function pixelsOf(page) {
  return page.evaluate(async () => {
    const canvas = document.getElementById("ol-canvas");
    const { width, height } = canvas;
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const seen = new Set();
    for (let i = 0; i < data.length && seen.size < 64; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return { width, height, hash, colours: seen.size, dpr: window.devicePixelRatio };
  });
}

// The raw bytes of the canvas, base64, for the diagnosis of a mismatch only.
function rawPixels(page) {
  return page.evaluate(async () => {
    const canvas = document.getElementById("ol-canvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const url = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(new Blob([data]));
    });
    return url.slice(url.indexOf(",") + 1);
  });
}

// How many pixels differ between two captures, and the box they lie in.
function diff(a, b, width) {
  const x = Buffer.from(a, "base64");
  const y = Buffer.from(b, "base64");
  let count = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < Math.min(x.length, y.length); i += 4) {
    if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) {
      count++;
      const p = i / 4;
      const px = p % width, py = Math.floor(p / width);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
  }
  return { count, box: count ? [x0, y0, x1, y1] : null, sizes: [x.length, y.length] };
}

// Loaded, every tier in, every read answered and no draw for a moment: the page is at rest.
async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 600, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

const p95 = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
};

test.describe("S0 pixel parity with the baseline build", () => {
  for (const view of VIEWS) {
    test(`${view.name}: the canvas hashes are equal`, async ({ fakeFor, freshContext, baselinePage }, testInfo) => {
      const base = await baselinePage({ mode: "live", profile: "mini", contextOptions: { reducedMotion: "reduce" }, url: `/${view.hash}` });
      const baseConsole = watchConsole(base.context);
      const candidateFake = await fakeFor("mini");
      const context = await freshContext({ reducedMotion: "reduce" });
      const candidateConsole = watchConsole(context);
      const page = await context.newPage();
      await page.goto(`${candidateFake.url}/${view.hash}`);
      const probe = probeTools.forPage(page);

      await atRest(base.page, base.fake, base.probe);
      await atRest(page, candidateFake, probe);

      const a = await pixelsOf(base.page);
      const b = await pixelsOf(page);
      expect(a.dpr, "the baseline page runs at device pixel ratio 1").toBe(1);
      expect(b.dpr, "the candidate page runs at device pixel ratio 1").toBe(1);
      expect(a.colours, "the baseline canvas is not blank").toBeGreaterThan(4);
      expect([b.width, b.height], "same canvas size").toEqual([a.width, a.height]);
      if (a.hash !== b.hash) {
        const [rawA, rawB] = [await rawPixels(base.page), await rawPixels(page)];
        const d = diff(rawA, rawB, a.width);
        await testInfo.attach("baseline.png", { body: await base.page.locator("#ol-canvas").screenshot(), contentType: "image/png" });
        await testInfo.attach("candidate.png", { body: await page.locator("#ol-canvas").screenshot(), contentType: "image/png" });
        throw new Error(`${view.name}: ${d.count} pixels differ (box x0,y0,x1,y1 = ${JSON.stringify(d.box)}; ${a.width}x${a.height})`);
      }
      expect(b.hash).toBe(a.hash);
      expect(candidateConsole, "the candidate console is clean").toEqual([]);
      expect(candidateConsole, "and says what the baseline's says").toEqual(baseConsole);
    });
  }
});

test.describe("S0 frame cost", () => {
  test("a mini 24h wheel gesture draws within 1.5x of the baseline (p95)", async ({ fakeFor, freshContext, baselinePage }, testInfo) => {
    const base = await baselinePage({ mode: "live", profile: "mini", contextOptions: { reducedMotion: "reduce" }, url: "/#w=24h" });
    const candidateFake = await fakeFor("mini");
    const context = await freshContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${candidateFake.url}/#w=24h`);
    const probe = probeTools.forPage(page);
    await atRest(base.page, base.fake, base.probe);
    await atRest(page, candidateFake, probe);

    // One round: wheel in seven ticks, then out seven, each tick one frame apart, at a point in the plot.
    async function round(target, targetProbe) {
      const box = await target.locator("#ol-canvas").boundingBox();
      await targetProbe.reset();
      await target.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35);
      for (let i = 0; i < 14; i++) {
        await target.mouse.wheel(0, i < 7 ? -100 : 100);
        await target.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      }
      await targetProbe.waitForQuiet({ quietMs: 500, timeout: 20000 });
      return (await targetProbe.frames()).map((frame) => frame.dur);
    }

    const durations = { baseline: [], candidate: [] };
    for (let i = 0; i < 6; i++) {
      // Alternate who goes first, so slow moments of the machine fall on both.
      const order = i % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
      for (const which of order) {
        const frames = which === "baseline" ? await round(base.page, base.probe) : await round(page, probe);
        durations[which].push(...frames);
      }
    }
    const result = { baseline: p95(durations.baseline), candidate: p95(durations.candidate), frames: [durations.baseline.length, durations.candidate.length] };
    testInfo.annotations.push({ type: "p95 draw ms", description: JSON.stringify(result) });
    expect(durations.baseline.length, "the baseline drew during the gesture").toBeGreaterThan(20);
    expect(durations.candidate.length, "the candidate drew during the gesture").toBeGreaterThan(20);
    expect(result.candidate, `p95 draw ${JSON.stringify(result)}`).toBeLessThanOrEqual(1.5 * result.baseline + 0.5);
  });
});
