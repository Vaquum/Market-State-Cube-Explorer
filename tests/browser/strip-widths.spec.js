"use strict";
// B39 strip-widths.spec.js (PRD-0002 S2, #47 section 2 and the acceptance list): the external Rows strip stays visible, at its width and in its colours, with dense cells and with a
// transient lens, at a desktop width and at a phone's; and at a phone's width the profile tracks are the named disclosure while the strip stays.
// Oracles (none is the code under test): the PRD's numbers (a 12 css px strip outside the heatmap, 600 css px for the disclosure), the recorded canvas, and the page's own layout
// record (data-layout).
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const DENSE = "#t=2026-09-24T06:00Z~2026-09-24T12:00Z&p=22000~23500&r=0,0&rows=volume&period=7d&vis=2";
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
async function ready(page, fake, probe) {
  await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { timeout: 30000 }).toBe(true);
  await S.atRest(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
}
// The strip's blocks of a frame: 12 px wide rectangles in the column right of the heatmap.
const stripOf = (frame, L) => frame.rects.filter((r) => r.w === 12 && r.x >= L[0] + L[2] - 1 && r.h > 1);

for (const [name, width, height] of [["desktop", 1500, 950], ["phone", 390, 844]])
  test.describe(`B39 ${name} (${width} px): the strip with dense cells and a lens`, () => {
    test("dense cells: the Rows strip is a 12 px column outside the heatmap, painted block by block, and the cells stay inside the heatmap", async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor("standard");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await page.goto(`${fake.url}/${DENSE}`);
      await ready(page, fake, probe);
      const L = await layoutOf(page),
        frame = await pane.last();
      const strip = stripOf(frame, L);
      expect(strip.length, "the strip has its blocks").toBeGreaterThan(3);
      for (const r of strip) {
        expect(r.x, "right of the heatmap").toBeGreaterThanOrEqual(L[0] + L[2] - 1);
        expect(r.alpha, "opaque").toBe(1);
      }
      // a row is one block of its effective height, one beside the other down the column
      const blocks = strip.filter((r) => r.h < L[3] - 2).sort((a, b) => a.y - b.y);
      for (let i = 1; i < blocks.length; i++) expect(blocks[i].y, "blocks do not overlap").toBeGreaterThanOrEqual(blocks[i - 1].y + blocks[i - 1].h - 0.01);
      // dense: far more cells than blocks, all inside the heatmap
      const cells = frame.rects.filter((r) => r.alpha === 1 && r.w > 0.2 && r.w < 10 && r.h > 2 && r.x >= L[0] - 0.5 && r.x + r.w <= L[0] + L[2] + 0.5 && r.y >= L[1] - 0.5 && r.y + r.h <= L[1] + L[3] + 0.5);
      expect(cells.length, "dense cells").toBeGreaterThan(100);
      expect(cells.some((r) => r.x + r.w > L[0] + L[2] + 0.5), "no cell reaches the strip").toBe(false);
    });

    test("a transient lens leaves the strip as it was and stays inside the heatmap", async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor("standard");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await page.goto(`${fake.url}/${DENSE}`);
      await ready(page, fake, probe);
      const L = await layoutOf(page),
        before = stripOf(await pane.last(), L).map((r) => [r.x, r.y, r.w, r.h, r.fill, r.alpha]);
      expect(before.length).toBeGreaterThan(3);
      // the lens tool by its key: at a phone's width its button is in the controls sheet
      await page.keyboard.press("l");
      const cb = await page.locator("#ol-canvas").boundingBox();
      await page.mouse.move(cb.x + L[0] + L[2] * 0.5, cb.y + L[1] + L[3] * 0.5);
      await expect.poll(async () => (await page.locator("#ol-canvas").evaluate((el) => el.dataset.temporary ?? "")).startsWith("lens:"), { timeout: 30000 }).toBe(true);
      await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
      const named = (await page.locator("#ol-canvas").evaluate((el) => el.dataset.temporary)).split(";").map((p) => p.replace(/^[a-z-]+:/, "").split(",").map(Number));
      for (const [x, y, w, h] of named) {
        expect(x >= L[0] - 1 && x + w <= L[0] + L[2] + 1, "inside the heatmap horizontally").toBe(true);
        expect(y >= L[1] - 1 && y + h <= L[1] + L[3] + 1, "inside the heatmap vertically").toBe(true);
      }
      expect(stripOf(await pane.last(), L).map((r) => [r.x, r.y, r.w, r.h, r.fill, r.alpha]), "the strip is the same blocks").toEqual(before);
    });
  });

test.describe("B39 the profile tracks at a phone's width", () => {
  test("under 600 px the tracks are the named disclosure and the strip stays; at 1500 px the tracks are drawn and the strip is beside them", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${fake.url}/${DENSE}`);
    await ready(page, fake, probe);
    const L = await layoutOf(page);
    expect(stripOf(await pane.last(), L).length, "the strip stays at a phone's width").toBeGreaterThan(3);
    const chip = page.locator("#ol-profile-chip");
    await expect(chip, "the disclosure's chip with the summary of the active measures and domains").toBeVisible();
    await expect(chip).toContainText(/Current|Volume/);
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${DENSE}`);
    await ready(page, fake, probe);
    const wide = await layoutOf(page);
    expect(stripOf(await pane.last(), wide).length, "the strip beside the tracks at a desktop's width").toBeGreaterThan(3);
  });
});
