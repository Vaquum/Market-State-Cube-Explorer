"use strict";
const { test, expect } = require("./fixtures.js");
const { addRecorder, lastDraw, rectOf, boxOf } = require("./cells-support.js");

const FROM = "2021-01-01T00:00Z", TO = "2021-01-01T00:20Z";
const VIEW = `#t=${FROM}~${TO}&p=24800~25500&r=0,0`;
const RECT = rectOf({ from: FROM, to: TO, low: 24800, high: 25500 });
const trades = Array.from({ length: 20 }, (_, c) => ({ t_ms: c * 56250 + 1000, price: 2500000, qty: (c + 1) * 400000, takerBuy: c % 2 === 0 }));

test.use({ reducedMotion: "reduce" });
async function open(page, fakeFor, probe, mode = "volume") {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-01T00:20:00Z" });
  await page.goto(fake.url + "/" + VIEW + "&mode=" + mode);
  await probe.waitForReady();
  return fake;
}
async function atCell(page, c, r = 200, click = false) {
  const canvas = await page.locator("#ol-canvas").boundingBox();
  const frame = await lastDraw(page), box = boxOf(frame.plot, RECT, 0, 0, c, r);
  const x = canvas.x + (box.x0 + box.x1) / 2, y = canvas.y + (box.y0 + box.y1) / 2;
  if (click) await page.mouse.click(x, y); else await page.mouse.move(x, y);
}

test("ten cell clicks replace one right-pane profile; one close restores the existing default tab", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-evidence-tab").click();
  await page.keyboard.press("e");
  const pane = await page.locator("#ol-side").boundingBox(), inspector = await page.locator("#ol-inspect").boundingBox(), canvas = await page.locator("#ol-canvas").boundingBox();
  expect(inspector.x).toBeGreaterThanOrEqual(pane.x);
  expect(inspector.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
  await expect(page.locator("#ol-side-body")).toBeHidden();
  await atCell(page, 0, 200, true);
  await page.locator("#ol-inspect").focus(); await page.keyboard.press("Enter");
  for (let c = 1; c <= 10; c++) {
    await atCell(page, c, 200, true);
    await expect(page.locator("#ol-inspect")).toHaveAttribute("data-c", String(c));
    await expect(page.locator("#ol-inspect-detail-body .ol-cell-stat").first().locator("dd")).toHaveAttribute("data-canonical", String((c + 1) * 100));
    await expect(page.locator("#ol-inspect")).toHaveCount(1);
    await expect(page.locator("#ol-inspect-detail")).toHaveCount(1);
  }
  await expect(page.locator("#ol-tip")).toBeHidden();
  const content = await page.locator("#ol-inspect").boundingBox();
  await page.mouse.move(content.x + content.width / 2, content.y + content.height / 2);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => page.locator("#ol-inspect").evaluate(n => n.scrollTop)).toBeGreaterThan(100);
  const close = await page.locator("#ol-inspect-exit").boundingBox();
  expect(close.y).toBeGreaterThanOrEqual(content.y);
  expect(close.y + close.height).toBeLessThan(content.y + 100);
  await page.locator("#ol-inspect-exit").click();
  await expect(page.locator("#ol-inspect")).toBeHidden();
  await expect(page.locator("#ol-side-body")).toBeVisible();
  await expect(page.locator("#ol-evidence-tab")).toHaveAttribute("aria-pressed", "true");
});

test("Inspect temporarily opens a collapsed pane and restores its layout on close", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-side-toggle").click();
  await expect(page.locator("#ol-main")).toHaveAttribute("data-side", "closed");
  await page.keyboard.press("e");
  await expect(page.locator("#ol-main")).toHaveAttribute("data-side", "open");
  await page.locator("#ol-inspect-exit").click();
  await expect(page.locator("#ol-main")).toHaveAttribute("data-side", "closed");
});

for (const mode of ["volume", "trades", "size", "delta", "flow", "flowtrades", "cascade", "path", "dwell"]) {
  test(`${mode}: four readable key figures, explicit units and causal visual histories`, async ({ page, fakeFor, probe }) => {
    await open(page, fakeFor, probe, mode);
    await atCell(page, 15);
    const tip = page.locator("#ol-tip");
    await expect(tip).toHaveAttribute("data-presentation", "cell");
    await expect(tip.locator(".ol-cell-stat")).toHaveCount(4);
    await expect(tip.locator(".ol-cell-details")).toBeHidden();
    await expect(tip.locator(".ol-sparkline")).toHaveCount(4);
    for (const value of await tip.locator(".ol-cell-stat dd").all()) {
      expect(await value.evaluate((n) => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(18);
    }
    if (["volume", "trades", "size", "delta", "flow", "flowtrades"].includes(mode)) expect(await tip.locator(".ol-cell-stats").innerText()).not.toContain("ATR");
    if (mode === "volume") {
      const samples = JSON.parse(await tip.locator(".ol-sparkline").first().getAttribute("data-samples"));
      expect(samples).toEqual(Array.from({ length: 12 }, (_, i) => (i + 5) * 100));
      await expect(tip.locator(".ol-sparkline").first()).toHaveAttribute("data-trend", "rising");
    }
    if (mode === "path") await expect(tip.locator(".ol-cell-stat").first().locator(".ol-reading-unit")).toHaveText("row spans");
  });
}

test("one observed cell does not pretend to have a flat history", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe); await atCell(page, 0);
  const spark = page.locator("#ol-tip .ol-sparkline").first();
  await expect(spark).toHaveAttribute("data-trend", "unavailable");
  expect(JSON.parse(await spark.getAttribute("data-samples"))).toEqual([...Array(11).fill(null), 100]);
});

test("a balanced signed figure keeps its zero guide at the visual midpoint", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor("micro:balanced");
  await page.goto(fake.url + "/" + VIEW + "&mode=delta");
  await probe.waitForReady(); await atCell(page, 0);
  await expect(page.locator("#ol-tip .ol-cell-stat").first().locator("dd")).toHaveAttribute("data-canonical", "0");
  await expect(page.locator("#ol-tip .ol-sparkline").first().locator("path").first()).toHaveAttribute("d", "M3 15 H69");
});

test("candle displacement and range use prior daily ATR; price stays USDT and later volatility cannot leak in", async ({ page, fakeFor, probe }) => {
  const DAY = 86400000;
  const stream = Array.from({ length: 20 }, (_, d) => ({ t_ms: d * DAY + 1000, price: 2500000, qty: 400000, takerBuy: true }));
  stream.push({ t_ms: 15 * DAY + 2000, price: 2480000, qty: 400000, takerBuy: false }, { t_ms: 15 * DAY + 3000, price: 2530000, qty: 400000, takerBuy: true }, { t_ms: 15 * DAY + 4000, price: 2520000, qty: 400000, takerBuy: true });
  stream.sort((a, b) => a.t_ms - b.t_ms);
  const fake = await fakeFor({ trades: stream, cutoffIso: "2021-01-21T00:00:00Z" });
  fake.overrideBars(9, Array.from({ length: 60 }, (_, col) => ({ col, open: 25000, close: col === 45 ? 25200 : 25000, high: col === 45 ? 25300 : col < 45 ? 25100 : 50000, low: col === 45 ? 24800 : col < 45 ? 24900 : 10000, volume: 100, takerBuyVolume: 50, baseVolume: .004, trades: 1 })));
  await page.goto(fake.url + "/#t=2021-01-16T00:00Z~2021-01-16T08:00Z&p=24500~26000&r=9,0&mode=candles");
  await probe.waitForReady(); await page.keyboard.press("e"); await probe.waitForReady();
  const stats = page.locator("#ol-inspect-readout .ol-cell-stats");
  await expect(stats.locator(".ol-cell-stat").filter({ hasText: "Net move" }).locator("dd")).toContainText("+1.00");
  await expect(stats.locator(".ol-cell-stat").filter({ hasText: "High − low" }).locator("dd")).toContainText("2.50");
  await expect(stats.locator(".ol-cell-stat").filter({ hasText: "Net move" }).locator(".ol-reading-unit")).toHaveText("daily ATR");
  await expect(stats.locator(".ol-cell-stat").first().locator(".ol-reading-unit")).toHaveText("USDT");
});
