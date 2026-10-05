"use strict";
// Oracle: uniform's five traded rows are 200..204 on the 125 USDT grid.
// Their full edges are 25000..25625; a 5% margin adds 31.25 USDT on each side,
// giving 24968.75..25656.25. The address records the viewport.
// Candle lows/highs are the row centres, 25062.5..25562.5; 5% adds 25 per side.
const { test, expect } = require("./fixtures.js");
const { EPOCH_MS } = require("../support/profiles.js");

const TIME = "2026-09-24T00:00Z~2026-09-24T12:00Z";
const view = (page) => page.evaluate(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  return { time: params.get("t"), price: params.get("p")?.split("~").map(Number) };
});

for (const [mode, expected] of [["volume", [24968.75, 25656.25]], ["candles", [25037.5, 25587.5]]]) {
 for (const [name, prices] of [["expanded", "20000~30000"], ["clipped", "25125~25250"]]) {
  test(`price-axis double-click fits vertically ${name} ${mode} and preserves time`, async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("uniform");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${fake.url}/#t=${TIME}&p=${prices}&r=4,0&mode=${mode}`);
    await probe.waitForReady();
    const before = await view(page);
    const box = await page.locator("#ol-canvas").boundingBox();

    // The labels sit in the canvas's left gutter, alongside the price pane.
    await page.mouse.dblclick(box.x + 20, box.y + 100);
    await expect.poll(async () => (await view(page)).price).toEqual(expected);
    await probe.waitForReady();
    expect((await view(page)).time, "fitting prices preserves the time window").toBe(before.time);

    // The fit is one reversible navigation action.
    await page.goBack();
    await probe.waitForReady();
    expect(await view(page)).toEqual(before);
  });
 }
}

// Hand-authored candles: a 1 USDT range needs 0.05 USDT padding; a flat price
// needs the existing 0.01% fallback (2.5 USDT) to keep its viewport nonzero.
for (const [name, high, expected] of [["narrow", 2500100, [24999.95, 25001.05]], ["flat", 2500000, [24997.5, 25002.5]]]) {
  test(`price-axis double-click fits ${name} candles`, async ({ page, fakeFor, probe }) => {
    const t = Date.parse("2026-09-24T00:01Z") - EPOCH_MS;
    const fake = await fakeFor({ name: `price-fit-${name}`, cutoffIso: "2026-09-24T12:02Z", trades: [
      { t_ms: t, price: 2500000, qty: 100000000, takerBuy: true },
      { t_ms: t + 1000, price: high, qty: 100000000, takerBuy: false },
    ] });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${fake.url}/#t=${TIME}&p=24000~26000&r=4,0&mode=candles`);
    await probe.waitForReady();
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.dblclick(box.x + 20, box.y + 100);
    await expect.poll(async () => (await view(page)).price).toEqual(expected);
  });
}
