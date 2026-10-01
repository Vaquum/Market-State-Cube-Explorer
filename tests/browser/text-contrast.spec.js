"use strict";
// B43 text-contrast.spec.js (PRD-0002 S3, #48 section 2 and acceptance): the contrast of every text of the composed chart, measured on the pixels the
// page actually painted, not on a token pair.
//
// For each text the canvas drew in a busy scene (cells, reference lines with their tags, equal highs, a CME gap, a selection, the Level, the cutoff label and the
// state labels), its box is read back from the canvas: the background is the colour that most pixels of the box have (a plate of the surface, or the page
// background where the text sits outside the plot), and
//   1. the text's own colour against that background is at least 4.5:1 (WCAG 2.x, written in tests/reference/contrast.js), whatever hue the label belongs to;
//   2. what the rasteriser made of it is checked apart from that formula: the strongest pixel of the box, antialiased, is still at least 3:1 against the
//      background, so a thin 11 px stroke has not faded into it;
//   3. no text sits straight on a cell: the box's background is the surface or the page background, never a colour of a cell's fill.
// Oracles (none is the code under test): tests/reference/contrast.js (a contrast written from the definition, validated on published anchors in U19), the
// pixels read back from the canvas at DPR 1, the surface and background tokens read back through a canvas.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const ref = require("../reference/contrast.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const hex = (h) => ref.hexToRgb(h);

// The distinct colours of each box of the canvas, with their pixel counts: [[r, g, b, n], ...] for every box.
function colourCounts(page, boxes) {
  return page.evaluate((list) => {
    const canvas = document.getElementById("ol-canvas"),
      ctx = canvas.getContext("2d");
    return list.map(([x0, y0, x1, y1]) => {
      const x = Math.max(0, Math.floor(x0)),
        y = Math.max(0, Math.floor(y0)),
        w = Math.max(1, Math.min(canvas.width - x, Math.ceil(x1) - x)),
        h = Math.max(1, Math.min(canvas.height - y, Math.ceil(y1) - y)),
        d = ctx.getImageData(x, y, w, h).data,
        seen = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      return [...seen].map(([k, n]) => [k >> 16, (k >> 8) & 255, k & 255, n]);
    });
  }, boxes);
}

// A text's box on the canvas: its width and the 11 px type's height, from its anchor and alignment.
function boxOf(t) {
  const left = t.align === "right" ? t.x - t.width : t.align === "center" ? t.x - t.width / 2 : t.x;
  return [left, t.y - 6, left + t.width, t.y + 6];
}

// The audit of one frame: every text of it, against the pixels it stands on.
async function audit(page, pane, label, minimum = 8) {
  const frame = await pane.last(),
    c = await pane.colours();
  const texts = frame.texts.filter((t) => t.text.trim().length > 0 && t.width > 0);
  expect(texts.length, `${label}: the scene has texts`).toBeGreaterThan(minimum);
  const counts = await colourCounts(page, texts.map(boxOf));
  const surface = hex(c.surface);
  const problems = [],
    stats = { checked: 0, minFormula: Infinity, minRendered: Infinity };
  texts.forEach((t, i) => {
    const colours = counts[i];
    // the background is the most common colour of the box; a box with no clear majority is itself a failure
    const total = colours.reduce((a, k) => a + k[3], 0),
      mode = colours.reduce((a, k) => (k[3] > a[3] ? k : a));
    if (mode[3] < total * 0.4) {
      problems.push(`"${t.text}": no background colour holds even 40% of its box (it sits on busy pixels)`);
      return;
    }
    const bg = [mode[0], mode[1], mode[2]],
      fg = hex(t.fill);
    stats.checked++;
    const formula = ref.contrast(fg, bg);
    stats.minFormula = Math.min(stats.minFormula, formula);
    if (formula < 4.5) problems.push(`"${t.text}": ${t.fill} on its background rgb(${bg.join(",")}) is ${formula.toFixed(2)}:1, below 4.5:1`);
    // the strongest pixel of the box against the background, as rendered
    let strongest = 1;
    for (const k of colours) strongest = Math.max(strongest, ref.contrast([k[0], k[1], k[2]], bg));
    stats.minRendered = Math.min(stats.minRendered, strongest);
    if (strongest < 3) problems.push(`"${t.text}": its strongest rendered pixel is ${strongest.toFixed(2)}:1 against its background, below 3:1`);
    // no text straight on a cell: the background is the surface or the page's own, which are the only two plain grounds
    const plain = [surface, hex(c.bg ?? "#f7f9f7")].some((p) => p[0] === bg[0] && p[1] === bg[1] && p[2] === bg[2]);
    if (!plain) problems.push(`"${t.text}": its background rgb(${bg.join(",")}) is neither the surface nor the page's background`);
  });
  console.log(`B43 ${label}: ${stats.checked} texts checked, the lowest formula contrast ${stats.minFormula.toFixed(2)}:1, the weakest strongest-pixel ${stats.minRendered.toFixed(2)}:1`);
  expect(problems, problems.join("\n")).toEqual([]);
  return texts.map((t) => t.text);
}

test.describe("B43 every text of the composed chart reads against the pixels it was painted on", () => {
  test("a busy scene: formula contrast of the text over its actual background, the strongest rendered pixel, and no text straight on a cell", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=1d,7d,30d,dopen,ath,cme,cday,funding&marks=poc,area,untested&rows=volume&level=25500`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    await page.mouse.move(8, 8);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    await audit(page, pane, "lines and tags", 15);
  });

  test("the continuation's labels, the lens caption and the replay's labels", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await S.atRest(page, fake, probe);
    const box = await page.locator("#ol-canvas").boundingBox();
    // an anchored column: the cone, with "Matching states" and "All states" beside its last boxes
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await expect.poll(async () => (await page.locator("#ol-case-n").textContent()) !== "—", { timeout: 60000 }).toBe(true);
    await page.mouse.move(8, 8);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    const cone = await audit(page, pane, "the cone", 8);
    expect(cone.includes("Matching states") && cone.includes("All states"), "the empirical-range labels are among them").toBe(true);
    // the lens, with its caption
    await page.keyboard.press("l");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    const lens = await audit(page, pane, "the lens", 8);
    expect(lens.some((s) => /^Lens|Finest|Base cells|Detail/.test(s)), "the lens caption is among them").toBe(true);
    await page.keyboard.press("Escape");
    // a replay: its edge, "Replay", and the hidden future
    await page.keyboard.press("r");
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    await audit(page, pane, "the replay", 8);
  });
});
