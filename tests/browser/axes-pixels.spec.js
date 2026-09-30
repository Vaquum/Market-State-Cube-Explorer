"use strict";
// axes-pixels.spec.js (X): the Columns pane and the oscillators as PIXELS, in both themes (TESTPLAN 3.3, WORKPLAN 4.1 rule 8; B16c, B18).
//
// A DOM audit and a recording of canvas calls cannot say what a person sees: a fillRect with the right colour can still be painted under
// something, clipped away or drawn in the other theme's colour. So this spec reads the canvas itself (getImageData at DPR 1) at the places
// the recorded geometry says a mark is, in the light and in the dark scheme, and compares the pixel with what the compositing of the
// mark's colour over the pane's surface gives.
//
// Requirements covered: S1-017, S1-018 (the bars stand where the registered axis puts them), S1-064, S1-065 (the clamped bar's triangle and
// the hollow diamond are drawn in the state ink, not filled), S1-112 (MACD's histogram arms), D11 (the new colours render in both themes).
//
// Oracle: the colours are the pinned Lut entries and the page's surface and state tokens, read back through the canvas itself (coloursOf:
// `fillStyle` read back as "#rrggbb"), and the expected pixel is written out here by hand: source-over compositing, round(alpha * src +
// (1 - alpha) * surface) per channel, which the canvas does for a fillRect at globalAlpha. A channel may differ by 2 (8-bit rounding of the
// canvas's premultiplied arithmetic). The geometry comes from the recorder (pane-canvas.js), whose numbers the other specs compare with the
// exact-rational reference calculator and the hand-computed indicator series.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const { EPOCH_MS } = require("../support/profiles.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const MINI = { n: 4, m: 0, from: "2026-09-24T00:00Z", to: "2026-09-24T12:00Z", lo: 24000, hi: 26000 };
const addressOf = (view, pane) => `#t=${view.from}~${view.to}&p=${view.lo}~${view.hi}&r=${view.n},${view.m}&pane=${pane}`;

async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 400, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// Source-over of `hex` at `alpha` on `ground`, as the canvas rounds it.
const over = (hex, alpha, ground) => rgb(hex).map((c, i) => Math.round(alpha * c + (1 - alpha) * rgb(ground)[i]));
const near = (pixel, expected, tolerance = 2) => expected.every((c, i) => Math.abs(pixel[i] - c) <= tolerance);
const distance = (a, b) => Math.hypot(...[0, 1, 2].map((i) => a[i] - b[i]));

// The centre pixel of a recorded bar, and what the page should have put there.
async function barPixel(surface, bar) {
  return surface.pixelAt({ x: bar.x + bar.w / 2, y: bar.y + bar.h / 2 });
}

for (const theme of ["light", "dark"]) {
  test.describe(`columns and oscillators as pixels, ${theme} scheme`, () => {
    test.use({ colorScheme: theme });

    test("the page is in the scheme asked for (the pixels below are that theme's)", async ({ page, fakeFor, probe, pane }) => {
      const fake = await fakeFor("mini");
      await page.goto(`${fake.url}/${addressOf(MINI, "volume")}`);
      await atRest(page, fake, probe);
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(theme === "dark");
      const colours = await pane.colours();
      // The two schemes have different surfaces: a pane painted with the other theme's token would fail every test below.
      expect(colours.surface).toMatch(/^#[0-9a-f]{6}$/);
    });

    test("Volume: a bar's pixel is the constant bar colour at .65 over the pane's surface, and the pane's own corner is the surface", async ({ page, fakeFor, probe, surface, pane }) => {
      const fake = await fakeFor("mini");
      await page.goto(`${fake.url}/${addressOf(MINI, "volume")}`);
      await atRest(page, fake, probe);
      const frame = await pane.last();
      const colours = await pane.colours();
      const area = paneCanvas.paneRect(frame, colours.surface);
      const bars = paneCanvas.barsOf(frame, area, { fill: colours.bar, alpha: 0.65 });
      expect(bars.length).toBe(48);
      // Every bar, not only one: the fill is the same constant for the whole pane (Lut.bar, DD-87).
      for (const bar of [bars[0], bars[24], bars[47], bars.reduce((a, b) => (b.h > a.h ? b : a))]) {
        const pixel = await barPixel(surface, bar);
        expect(near(pixel, over(colours.bar, 0.65, colours.surface)), `bar at x ${bar.x.toFixed(1)}: ${pixel} vs ${over(colours.bar, 0.65, colours.surface)}`).toBe(true);
      }
      // Inside the pane, one pixel under its top edge, over the first bar (no bar reaches it: they are inset 4 px): the surface.
      const above = await surface.pixelAt({ x: bars[0].x + bars[0].w / 2, y: area.y + 1 });
      expect(near(above, rgb(colours.surface), 6), `above the first bar: ${above} vs ${rgb(colours.surface)}`).toBe(true);
    });

    test("Delta: the positive arm is the positive colour and the negative arm the negative colour, both at .65", async ({ page, fakeFor, probe, surface, pane }) => {
      const fake = await fakeFor("mini");
      await page.goto(`${fake.url}/${addressOf(MINI, "delta")}`);
      await atRest(page, fake, probe);
      const frame = await pane.last();
      const colours = await pane.colours();
      const area = paneCanvas.paneRect(frame, colours.surface);
      const up = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.65 });
      const down = paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.65 });
      expect(up.length, "the day has positive Delta").toBeGreaterThan(0);
      expect(down.length, "and negative").toBeGreaterThan(0);
      const tall = (bars) => bars.filter((b) => b.h >= 4)[0];
      for (const [bar, colour, name] of [[tall(up), colours.positive, "positive"], [tall(down), colours.negative, "negative"]]) {
        expect(bar, `a ${name} bar tall enough to sample`).toBeTruthy();
        const pixel = await barPixel(surface, bar);
        expect(near(pixel, over(colour, 0.65, colours.surface)), `${name}: ${pixel} vs ${over(colour, 0.65, colours.surface)}`).toBe(true);
      }
      // The two arms are told apart by colour, not only by side of the centre line: the two pixels differ clearly.
      const a = await barPixel(surface, tall(up));
      const b = await barPixel(surface, tall(down));
      expect(distance(a, b), "positive and negative are not the same colour").toBeGreaterThan(20);
    });

    test("Efficiency: the ratio arms are drawn at .85 in the positive and negative colours", async ({ page, fakeFor, probe, surface, pane }) => {
      const fake = await fakeFor("mini");
      await page.goto(`${fake.url}/${addressOf(MINI, "efficiency")}`);
      await atRest(page, fake, probe);
      const frame = await pane.last();
      const colours = await pane.colours();
      const area = paneCanvas.paneRect(frame, colours.surface);
      const up = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.85 }).filter((b) => b.h >= 4);
      const down = paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.85 }).filter((b) => b.h >= 4);
      expect(up.length + down.length, "Efficiency has bars").toBeGreaterThan(0);
      for (const [bar, colour] of [...up.slice(0, 2).map((b) => [b, colours.positive]), ...down.slice(0, 2).map((b) => [b, colours.negative])]) {
        const pixel = await barPixel(surface, bar);
        expect(near(pixel, over(colour, 0.85, colours.surface)), `${pixel} vs ${over(colour, 0.85, colours.surface)}`).toBe(true);
      }
    });

    test("a clamped bar's triangle is filled in the state ink and a hollow diamond is not", async ({ page, fakeFor, probe, surface, pane }) => {
      // Two columns under one parent: one trade of about 100,000 USDT in column 0, nine of about 95 USDT in column 1 (Efficiency far above
      // +2 and below -2), columns 2 and 3 with no trades under a whole parent (empty population), column 4's parent open.
      const trades = [{ t_ms: 10000, price: 2500100, qty: 400000000, takerBuy: true }];
      for (let i = 0; i < 9; i++) trades.push({ t_ms: 60000 + i * 1000, price: (190 + i) * 12500 + 100, qty: 400000, takerBuy: i % 2 === 0 });
      const fake = await fakeFor({ trades, cutoffIso: "2021-01-01T00:05:00Z" });
      await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:04Z&p=23500~25600&r=0,0&pane=efficiency`);
      await atRest(page, fake, probe);
      const frame = await pane.last();
      const colours = await pane.colours();
      const { triUp, triDown } = paneCanvas.glyphsOf(frame, colours.state);
      expect(triUp.length).toBe(1);
      expect(triDown.length).toBe(1);
      // Inside a filled triangle, near its centroid: the ink itself (opaque, nothing over it).
      for (const [cx, cy] of [triUp[0], triDown[0]]) {
        const pixel = await surface.pixelAt({ x: cx, y: cy });
        expect(near(pixel, rgb(colours.state), 3), `inside the triangle: ${pixel} vs ${rgb(colours.state)}`).toBe(true);
      }
    });

    test("Path on micro:mixed: a hollow diamond is ink on its outline and the surface inside", async ({ page, fakeFor, probe, surface, pane }) => {
      const fake = await fakeFor("micro:mixed");
      await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:05Z&p=24375~26875&r=0,0&mode=path`);
      await atRest(page, fake, probe);
      const frame = await pane.last();
      const colours = await pane.colours();
      const { diamond } = paneCanvas.glyphsOf(frame, colours.state);
      expect(diamond.length).toBe(3);
      for (const [cx, cy] of diamond) {
        // The centre of a hollow diamond is the ground it stands on: the pane's surface, with no ink in it.
        const inside = await surface.pixelAt({ x: cx, y: cy });
        expect(distance(inside, rgb(colours.state)), "inside the diamond is not ink").toBeGreaterThan(distance(rgb(colours.surface), rgb(colours.state)) * 0.5);
        // Its left and right vertices are on the 1.25 px outline: at least one pixel of the pair beside each is ink-dominated.
        const probes = [];
        for (const dx of [-3, 3]) for (const ox of [-1, 0, 1]) probes.push(await surface.pixelAt({ x: cx + dx + ox, y: cy }));
        const closest = Math.min(...probes.map((p) => distance(p, rgb(colours.state))));
        expect(closest, "the outline is ink").toBeLessThan(distance(rgb(colours.surface), rgb(colours.state)) * 0.5);
      }
    });

    test("MACD: the histogram's arms are the positive and negative colours at .45 over the surface", async ({ page, fakeFor, probe, surface, pane }) => {
      const INDICATORS = require("../fixtures/indicators/macd.json").cases;
      const walk = INDICATORS.find((c) => c.name === "walk120");
      const DAY_MS = 86400000;
      const closes = walk.closes;
      const cutoffIso = new Date(EPOCH_MS + closes.length * DAY_MS).toISOString();
      const fake = await fakeFor({
        trades: [
          { t_ms: 1000, price: 2500000, qty: 400000, takerBuy: true },
          { t_ms: closes.length * DAY_MS - 60000, price: 2500000, qty: 400000, takerBuy: false },
        ],
        cutoffIso,
      });
      const bars = [];
      closes.forEach((close, day) => {
        for (let k = 0; k < 3; k++) bars.push({ col: 3 * day + k, open: close, high: close, low: close, close, volume: 1, takerBuyVolume: 0.5, baseVolume: 0.01, trades: 1 });
      });
      fake.overrideBars(9, bars);
      await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~${new Date(EPOCH_MS + closes.length * DAY_MS).toISOString().slice(0, 16)}Z&p=24000~26000&r=12,3&pane=macd1d`);
      await atRest(page, fake, probe);
      const frame = await pane.last();
      const colours = await pane.colours();
      const area = paneCanvas.paneRect(frame, colours.surface);
      const up = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.45 }).filter((b) => b.h >= 5 && b.w >= 1.5);
      const down = paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.45 }).filter((b) => b.h >= 5 && b.w >= 1.5);
      expect(up.length).toBeGreaterThan(0);
      expect(down.length).toBeGreaterThan(0);
      // The histogram's vertical middle can be crossed by the MACD or the signal line; sample at a quarter of the bar's length from its
      // free end (the end away from the centre line) where only the bar is.
      const zero = area.y + area.h / 2;
      const nearFreeEnd = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 < zero ? b.y + 1.5 : b.y + b.h - 1.5 });
      for (const [bar, colour] of [[up[0], colours.positive], [down[0], colours.negative]]) {
        const p = nearFreeEnd(bar);
        const pixel = await surface.pixelAt(p);
        // Another series can cross the same pixel: accept the arm's own composite or, failing that, say what was there.
        expect(near(pixel, over(colour, 0.45, colours.surface), 3), `${colour} histogram at ${p.x.toFixed(1)},${p.y.toFixed(1)}: ${pixel} vs ${over(colour, 0.45, colours.surface)}`).toBe(true);
      }
    });
  });
}

