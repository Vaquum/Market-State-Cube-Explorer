"use strict";
// inspect-average-first-value.spec.js (#120): before an average's first value, Inspect's References reads one bar, not two.
//
// While the cursor is before an average's first full window, averageTip's readout (the heading) reads that first value, "At the close of"
// its bar. The card under it read the cursor's own bar, where the average has no value yet, so under a heading that names a price its
// primary measure read "Not supported here", and a Bollinger band's %B "Invalid input: non-finite". Each case opens a view on 6 Jan 2021,
// before any of the averages' first values, enters Inspect (E), goes to References and reads the average: the card has to read the
// heading's bar.
// Oracles: the RAMP trades of reference-cards.spec.js have a day each from 1 Jan 2021 to the cutoff on 17 Feb, and day d closes at
// 10070 + 100d (its last trade, 50 over 10000 + 100d + 20). So:
//   - the 21-day EMA's first value is day 20's (21 Jan): the mean of the first 21 closes, 11,070, under that day's close, 12,070;
//   - the 20-day Bollinger bands' is day 19's (20 Jan): the middle 11,020 (the mean of 20 closes) ± 2σ, σ = 100·√(399/12) (20 closes
//     100 apart), with that day's close at 11,970.
// The prior completed day's ATR is 120 from the 14th day on (reference-cards.spec.js). A day is 1536 base units, three 8-hour bars of 512.
const { test, expect } = require("./fixtures.js");

test.use({ reducedMotion: "reduce" });

const DAY = 86400000, HOUR = 3600000, UNITS = 1536;
const CUTOFF = "2021-02-17T12:00:00Z", CUT_MS = Date.parse(CUTOFF) - Date.parse("2021-01-01T00:00:00Z");
// Day d has three 8-hour parts, each a trade 50 under and one 50 over 10000 + 100d + 10·part (RAMP of reference-cards.spec.js).
const RAMP = Array.from({ length: 48 }, (_, d) => [0, 1, 2].flatMap((part) => [-50, 50].map((offset, k) => ({ t_ms: d * DAY + part * 8 * HOUR + (k + 1) * 60000, price: (10000 + d * 100 + part * 10 + offset) * 100, qty: 100000000, takerBuy: k === 1 })))).flat().filter((x) => x.t_ms <= CUT_MS);
// A view on 6 Jan 2021: the cursor Inspect starts at, the view's middle (10:00), is nearest day 4's close, at 00:00, where neither average
// has a value.
const EARLY = "#t=2021-01-06T08:00Z~2021-01-06T12:00Z&p=9000~15500&r=8,0&vis=2";

// Open the early view with `lines` on, enter Inspect (E) and go to References, which reads the first reference once the average's bars are
// read. Returns the readout.
async function references(page, fakeFor, probe, lines) {
  const fake = await fakeFor({ trades: RAMP, cutoffIso: CUTOFF });
  await page.goto(`${fake.url}/${EARLY}&lines=${lines}`);
  await probe.waitForReady();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("e");
  // enabled once a reference is listed: the average's curves, once its bars are read
  await page.locator('[data-surface="references"]').click();
  await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "references");
  await page.locator("#ol-inspect").focus();
  return page.locator("#ol-inspect-readout");
}
const observation = async (readout) => JSON.parse((await readout.getAttribute("data-observation")) ?? "null");

test("21 EMA · 1 day before its first value: the card reads the first value's bar, as its heading does", async ({ page, fakeFor, probe }) => {
  const readout = await references(page, fakeFor, probe, "ema21");
  await expect(page.locator("#ol-inspect-position")).toHaveText("21 EMA · 1 day · 1 of 1");
  // the heading: day 20's value, at its close
  await expect(readout.locator(".ol-tip-head")).toHaveText("21 EMA · 1 day · 11,070 USDT");
  await expect(readout.locator(".ol-tip-sub")).toHaveText("At the close of 21 Jan 2021");
  await expect(readout).toHaveAttribute("data-presentation", "core");
  // the card: the same bar and the same value
  await expect.poll(async () => (await observation(readout))?.time, { message: "the card reads day 20, the heading's bar" }).toEqual([20 * UNITS, 21 * UNITS]);
  expect((await observation(readout)).result.value).toBeCloseTo(11070, 9);
  const stats = readout.locator(".ol-core-stats > .ol-cell-stat dd");
  await expect(stats.first()).not.toContainText("Not supported here");
  expect(Number(await stats.nth(0).getAttribute("data-canonical"))).toBeCloseTo(11070, 9);
  // the close, 12,070, is 1,000 over the average: 1,000 / 120 ATR
  expect(Number(await stats.nth(1).getAttribute("data-canonical"))).toBeCloseTo(1000 / 120, 9);
  expect(Number(await stats.nth(3).getAttribute("data-canonical"))).toBe(12070);
});

test("Bollinger · 1 day before its first value: each band's card reads the first value's bar, %B too", async ({ page, fakeFor, probe }) => {
  const readout = await references(page, fakeFor, probe, "bb1d");
  const sigma = 100 * Math.sqrt(399 / 12),
    percentB = readout.locator('dd[data-field="Price in envelope · unclamped %B"]');
  for (const [i, part] of ["Upper", "Middle", "Lower"].entries()) {
    if (i) await page.keyboard.press("ArrowDown");
    await expect(page.locator("#ol-inspect-position")).toHaveText(`Bollinger (20, 2σ) · 1 day · BB 1D ${part} · ${i + 1} of 3`);
    // the heading: day 19's middle, at its close
    await expect(readout.locator(".ol-tip-head")).toHaveText("Bollinger (20, 2σ) · 1 day · 11,020 USDT");
    await expect(readout.locator(".ol-tip-sub")).toHaveText("At the close of 20 Jan 2021");
    await expect(readout).toHaveAttribute("data-presentation", "core");
    // the card: the same bar; its bandwidth is 4σ over the middle
    await expect.poll(async () => (await observation(readout))?.time, { message: `${part}: the card reads day 19, the heading's bar` }).toEqual([19 * UNITS, 20 * UNITS]);
    expect((await observation(readout)).result.value).toBeCloseTo((4 * sigma) / 11020, 12);
    await expect(percentB).not.toContainText("Invalid input");
    // the close, 11,970, in the envelope from 11,020 − 2σ to 11,020 + 2σ
    expect(Number(await percentB.getAttribute("data-canonical"))).toBeCloseTo((11970 - (11020 - 2 * sigma)) / (4 * sigma), 12);
  }
});
