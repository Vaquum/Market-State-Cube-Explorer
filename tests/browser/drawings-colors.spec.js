"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const recorder = require("./pane-canvas.js");
const fixture = require("../fixtures/drawings/collections.json");
const { contrast, hexToRgb, over } = require("../reference/contrast.js");
// Production raster and recorded geometry, not the app's color picker/role helper.
// This verifies exact RGB and the redundant authored hexagon. Universal scene contrast
// and participant recognition remain outside this finite engineering sample.
for (const colorScheme of fixture.identity.themes) for (const deviceScaleFactor of fixture.identity.deviceScaleFactors) {
  test.describe(`${colorScheme} DPR ${deviceScaleFactor}`, () => {
    test.use({ colorScheme, deviceScaleFactor, reducedMotion: "reduce" });
    test("every RGB remains exact and authored ink has a hollow six-vertex glyph", async ({ page, fakeFor }) => {
      await recorder.addRecorder(page); const pane = recorder.forPage(page), fake = await fakeFor("mini"); await D.open(page, fake);
      const made = await D.drawing(page, [.25, .5], [.75, .5]);
      for (const color of fixture.identity.colors) {
        await D.edit(page, made.id); await page.locator("#ol-drawing-color").fill(color); await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
        await expect.poll(async () => (await D.row(page, made.id)).color).toBe(color);
        await expect.poll(async () => (await pane.last()).strokes.filter((s) => s.stroke.toLowerCase() === color && s.width === 1.5 && s.path.length === 2).length).toBeGreaterThan(0);
        const frame = await pane.last();
        const core = frame.strokes.find((s) => s.stroke.toLowerCase() === color && s.width === 1.5 && s.path.length === 2);
        const casing = frame.strokes.find((s) => s.width === 3.5 && JSON.stringify(s.path) === JSON.stringify(core.path));
        expect(casing, "one bounded casing accompanies the RGB core").toBeTruthy();
        expect(contrast(hexToRgb(color), hexToRgb(casing.stroke)), "declared opaque core/casing sample exceeds the graphical contrast target").toBeGreaterThanOrEqual(3);
        expect(frame.strokes.some((s) => s.stroke.toLowerCase() === color && s.path.length === 6 && s.width <= 1.5), "authored shape stays distinct from square, diamond and triangle references").toBe(true);
        const center = core.path[0][1] * deviceScaleFactor, half = 1.5 * deviceScaleFactor / 2;
        let coverage = 0; for (let y = Math.floor(center - half); y < Math.ceil(center + half); y++) coverage = Math.max(coverage, Math.max(0, Math.min(y + 1, center + half) - Math.max(y, center - half)));
        const rgb = over(hexToRgb(color), coverage, hexToRgb(casing.stroke));
        const pixels = await page.locator("#ol-canvas").evaluate((cv, { rgb }) => {
          const [x, y, width, height] = cv.dataset.layout.split(",").map(Number), d = devicePixelRatio;
          const data = cv.getContext("2d").getImageData(Math.round((x + width / 2) * d) - 3, Math.round((y + height / 2) * d) - 3, 7, 7).data;
          let nearest = Infinity; for (let i = 0; i < data.length; i += 4) nearest = Math.min(nearest, Math.max(...rgb.map((v, c) => Math.abs(v - data[i + c])))); return nearest;
        }, { rgb });
        expect(pixels, "the core paints its geometric source-over sample within antialiasing tolerance").toBeLessThanOrEqual(2);
      }
    });
  });
}
