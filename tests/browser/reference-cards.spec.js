"use strict";
// P7-S2 oracles: hand-built three 8h bars per UTC day, each high/low ±50.
// Daily range is 120 USDT; Wilder ATR stays 120 after its 14 completed-day seed.
// Formulas/timing follow the approved PRD; no detector result supplies an expected value.
const { test, expect } = require("./fixtures.js");
const DAY = 86400000, HOUR = 3600000, EPOCH = Date.parse("2021-01-01T00:00:00Z");
const trades = Array.from({ length: 48 }, (_, d) => [0, 1, 2].flatMap((part) => [-50, 50].map((offset, k) => ({ t_ms: d * DAY + part * 8 * HOUR + (k + 1) * 60000, price: (10000 + d * 100 + part * 10 + offset) * 100, qty: 100000000, takerBuy: k === 1 })))).flat();
const cutoffIso = "2021-02-17T12:00:00Z";
const view = "#t=2021-02-17T08:00Z~2021-02-17T12:00Z&p=9000~15500&r=8,0&vis=2";
test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
async function reference(page, fakeFor, probe, lines, match, viewHash = view) {
  const fake = await fakeFor({ trades: trades.filter((x) => x.t_ms <= Date.parse(cutoffIso) - EPOCH), cutoffIso });
  await page.goto(`${fake.url}/${viewHash}&lines=${lines}`); await probe.waitForReady();
  await page.keyboard.press("e"); await page.locator('[data-surface="references"]').click();
  const options = page.locator("#ol-inspect-reference option");
  await expect.poll(() => options.allTextContents()).toContainEqual(expect.stringMatching(match));
  const name = (await options.allTextContents()).find((x) => match.test(x));
  await page.locator("#ol-inspect-reference").selectOption({ label: name });
  return { fake, card: page.locator("#ol-inspect-readout") };
}
for (const theme of ["light", "dark"]) test(`${theme}: session reference uses completed 8h close, signed prior ATR and four readable slots`, async ({ page, fakeFor, probe }) => {
  await page.addInitScript((value) => localStorage.setItem("origo-theme", value), theme);
  const { card } = await reference(page, fakeFor, probe, "pdhlc", /^PDH$/);
  await expect(card).toHaveAttribute("data-presentation", "core");
  const figures = card.locator(".ol-core-stats > .ol-cell-stat"); await expect(figures).toHaveCount(4);
  await expect(figures.locator("dd")).toHaveCount(4);
  expect(await figures.locator("dd").evaluateAll((nodes) => nodes.map((n) => Number.parseFloat(getComputedStyle(n).fontSize)))).toEqual([28, 18, 18, 18]);
  const record = JSON.parse(await card.getAttribute("data-observation"));
  // Day 46 high=14670; day 47 first completed 8h close=14750, prior ATR=120.
  expect(record.result.value).toBe(14670); expect(record.denominators[0].close).toBe(14750);
  expect(record.denominators[0].denominator).toBeCloseTo(120, 12);
  await expect(figures.nth(1).locator("dd")).toHaveAttribute("data-canonical", String(80 / 120));
  await expect(card.locator(".ol-reference-track")).toHaveAttribute("aria-label", /completed 8-hour close.*UTC/);
  await card.locator(".ol-cell-details > summary").click();
  await expect(card.locator(".ol-card-history")).toBeVisible();
  expect(record.history).toHaveLength(12);
  const before = record.result;
  await page.setViewportSize({ width: 1100, height: 1080 }); await probe.waitForReady();
  expect(JSON.parse(await card.getAttribute("data-observation")).result).toEqual(before);
});
test("Clock Inspect selects a stable nearest funding event and discloses assumed scheduling", async ({ page, fakeFor, probe }) => {
  const { card } = await reference(page, fakeFor, probe, "funding", /Funding/);
  await expect(card).toContainText("Assumed funding schedule");
  await expect(card).toContainText("not measured funding rates");
  await expect(card).toContainText(/Elapsed since event|Until event/);
  const record = JSON.parse(await card.getAttribute("data-observation"));
  expect(record.source).toBe("Calendar definition");
  expect(record.denominators[0].numerator).toBeNull();
  const at = record.denominators[0].observedAt, day = Math.floor(at / 1536) * 1536;
  const candidates = [-512, 0, 512, 1024, 1536].map((offset) => day + offset).sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b);
  expect(record.result.value).toBe(candidates[0]);
  await expect(card.locator(".ol-reference-track")).toHaveAttribute("aria-label", /Effective observation edge/);
});
test("Fibonacci shows unclamped depth and candidate/as-of construction with anchor timing", async ({ page, fakeFor, probe }) => {
  const { card } = await reference(page, fakeFor, probe, "fib30", /^30D 50.0%$/);
  await expect(card).toContainText("Continuous retracement depth");
  await expect(card).toContainText("unclamped depth");
  await expect(card).toContainText("Developing rolling extremes");
  await expect(card.locator(".ol-reference-track")).toHaveAttribute("aria-label", /Earlier anchor.*Later anchor/);
});
test("Moving average preserves native filter and shows price location plus causal slope", async ({ page, fakeFor, probe }) => {
  const { card } = await reference(page, fakeFor, probe, "ema21", /21 EMA/, "#t=2021-02-16T08:00Z~2021-02-16T12:00Z&p=9000~15500&r=8,0&vis=2");
  await expect(card).toContainText("Average slope / daily ATR per native bar");
  await expect(card).toContainText("EMA(21)");
  const record = JSON.parse(await card.getAttribute("data-observation"));
  expect(record.result.value).toBeCloseTo(13670, 10);
  const stats = card.locator(".ol-core-stats > .ol-cell-stat dd");
  expect(Number(await stats.nth(1).getAttribute("data-canonical"))).toBeCloseTo(1000 / 120, 10);
  expect(Number(await stats.nth(2).getAttribute("data-canonical"))).toBeCloseTo(100 / 120, 10);
  await expect(card.locator(".ol-related-plot")).toHaveAttribute("aria-label", /Native close/);
  await card.locator(".ol-cell-details > summary").click();
  await expect(card.locator(".ol-card-history").first()).toBeVisible();
});

test("historical Fibonacci inspection withholds depth until its fixed current anchor construction is known", async ({ page, fakeFor, probe }) => {
  const { card } = await reference(page, fakeFor, probe, "fib30", /^30D 50.0%$/, "#t=2021-02-16T08:00Z~2021-02-16T12:00Z&p=9000~15500&r=8,0&vis=2");
  const record = JSON.parse(await card.getAttribute("data-observation"));
  expect(record.result.tag).toBe("unsupported");
  expect(record.denominators[0].knownAt).toBeGreaterThan(record.denominators[0].observedAt);
  await expect(card).toContainText("Retrospective comparison before anchor construction is known");
});
