"use strict";
// inspect-average-warmup.spec.js (#118): an average with no value yet reads as warming up in Inspect's References, never as a VWAP.
//
// Inspect lists an average's curves as references once its bars are read, whether or not they hold a full window. A curve with no value (fewer
// bars than its length, or no bars at all where its bars are the view's) fell through averageTip to structureTip's curve branch, which reads a
// VWAP's points, and threw on the empty list ("undefined is not iterable", from inspectRender); the fixture fails a test on any uncaught error.
// Each case first waits for the chart to say the average is warming up (the canvas's own count of reasons), then reads it in References:
//   1. the report: the rally view with Bollinger · 1D on, whose three curves need 20 days;
//   2. a 50-day SMA beside a 21-day EMA that has a value: the SMA warms up, and the EMA still reads its card;
//   3. the 15-minute EMAs over a view before the data, where their bars are none at all.
// Oracles: the mini profile's history is the two days to its cutoff, 24 Sep 2026 12:02 UTC (tests/support/profiles.js), so its days are the 22nd,
// 23rd and 24th, and the rally view (27 Jun) is before its first trade; the RAMP trades of reference-cards.spec.js have a day each from 1 Jan 2021
// to the cutoff on 17 Feb, 48 days.
const { test, expect } = require("./fixtures.js");

test.use({ reducedMotion: "reduce" });

const DAY = 86400000, HOUR = 3600000;
const CUTOFF = "2021-02-17T12:00:00Z", CUT_MS = Date.parse(CUTOFF) - Date.parse("2021-01-01T00:00:00Z");
// Day d has three 8-hour parts, each a trade 50 under and one 50 over 10000 + 100d + 10·part (RAMP of reference-cards.spec.js).
const RAMP = Array.from({ length: 48 }, (_, d) => [0, 1, 2].flatMap((part) => [-50, 50].map((offset, k) => ({ t_ms: d * DAY + part * 8 * HOUR + (k + 1) * 60000, price: (10000 + d * 100 + part * 10 + offset) * 100, qty: 100000000, takerBuy: k === 1 })))).flat().filter((x) => x.t_ms <= CUT_MS);
// The address of the report: the mini profile's rally view (rallies.spec.js).
const RALLY_VIEW = "#t=2026-06-27T11:39:00Z~2026-06-27T11:55:00Z&p=60000~60625&r=0,0";

// Open the address and wait until the chart's reasons for the references it did not draw are `reasons`; then enter Inspect (E) and go to
// References, which reads the first reference. Returns the chooser's options.
async function references(page, fake, probe, hash, reasons) {
  await page.goto(`${fake.url}/${hash}`);
  await probe.waitForReady();
  await expect.poll(() => page.locator("#ol-canvas").evaluate((n) => n.dataset.referenceReasons ?? ""), { message: "the chart says the average is warming up", timeout: 30000 }).toBe(reasons);
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("e");
  const tab = page.locator('[data-surface="references"]');
  await expect(tab).toBeEnabled();
  await tab.click();
  await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "references");
  await page.locator("#ol-inspect").focus();
  return page.locator("#ol-inspect-reference option");
}

test("Bollinger · 1D with no value yet, the report: each of its three curves reads as warming up", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  const options = await references(page, fake, probe, `${RALLY_VIEW}&lines=bb1d`, "warmup:1");
  await expect(options).toHaveText([/^Bollinger \(20, 2σ\) · 1 day · BB 1D Upper$/, /^Bollinger \(20, 2σ\) · 1 day · BB 1D Middle$/, /^Bollinger \(20, 2σ\) · 1 day · BB 1D Lower$/]);
  const position = page.locator("#ol-inspect-position"),
    readout = page.locator("#ol-inspect-readout");
  for (const [i, part] of ["Upper", "Middle", "Lower"].entries()) {
    if (i) await page.keyboard.press("ArrowDown");
    await expect(position).toHaveText(new RegExp(`· BB 1D ${part} · ${i + 1} of 3$`));
    await expect(readout).toContainText("Warming up: no value yet");
    await expect(readout, "the mini profile's three days, of the 20 the band needs").toContainText("3 of the 20 its first value needs");
  }
});

test("a 50-day SMA on 48 days warms up, and the 21-day EMA beside it still reads its card", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: RAMP, cutoffIso: CUTOFF });
  const options = await references(page, fake, probe, "#t=2021-02-17T08:00Z~2021-02-17T12:00Z&p=9000~15500&r=8,0&vis=2&lines=ema21,sma50", "warmup:1");
  await expect(options).toHaveText(["21 EMA · 1 day", "50 SMA · 1 day"]);
  const position = page.locator("#ol-inspect-position"),
    readout = page.locator("#ol-inspect-readout");
  await expect(position).toHaveText("21 EMA · 1 day · 1 of 2");
  await expect(readout).toHaveAttribute("data-presentation", "core");
  await expect(readout).toContainText("EMA(21)");
  await expect(readout).not.toContainText("Warming up");
  await page.keyboard.press("ArrowDown");
  await expect(position).toHaveText("50 SMA · 1 day · 2 of 2");
  await expect(readout).toContainText("Warming up: no value yet");
  await expect(readout, "the RAMP's 48 days, of the 50 the average needs").toContainText("48 of the 50 its first value needs");
  // the warm-up's own readout, not a card of measures that have no value
  await expect(readout).not.toHaveAttribute("data-presentation", "core");
});

test("the 15-minute EMAs over a view before the data have no bars at all, and read as warming up", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  const options = await references(page, fake, probe, `${RALLY_VIEW}&lines=ema15m`, "warmup:1");
  await expect(options).toHaveText([/^9 EMA · 15 minutes/, /^21 EMA · 15 minutes/]);
  const position = page.locator("#ol-inspect-position"),
    readout = page.locator("#ol-inspect-readout");
  for (const [i, n] of [9, 21].entries()) {
    if (i) await page.keyboard.press("ArrowDown");
    await expect(position).toHaveText(new RegExp(`^${n} EMA · 15 minutes.* · ${i + 1} of 2$`));
    await expect(readout).toContainText("Warming up: no value yet");
    await expect(readout).toContainText(`0 of the ${n} its first value needs`);
  }
});
