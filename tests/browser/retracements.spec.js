"use strict";
// retracements.spec.js (#108): Structure's retracements with Classic levels, Extensions, the last 4-hour swing and a chosen day.
//
// Oracles: hand-built trades whose highs and lows are written out here, and the retracement rule later − f × (later − earlier).
//   RAMP: day d has three 8-hour parts, each a trade 50 under and one 50 over 10000 + 100d + 10·part. The cutoff, 2021-02-17 12:00 UTC,
//   leaves parts 0 and 1 of day 47, so its high is 14760 (08:00). The last 30 sessions start on day 18, whose low is 11750 (00:00): the
//   move is upward, 11750 → 14760. Since 10 Feb (day 40) its low is 13950: 13950 → 14760.
//   SHAPED: each part trades 50 either side of a daily price: 10000 to day 19, up 300 a day to 13000 on day 29, down 300 a day to 10000
//   on day 39, then up 100 a day. On the 4-hour bars (one a part) the ATR zigzag confirms the high of 13050 on day 31 and the low of 9950
//   on day 43, so the last two 4-hour swings are 13050 → 9950 (worked through in the PR's notes, by hand from the bars).
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const DAY = 86400000, HOUR = 3600000;
const CUTOFF = "2021-02-17T12:00:00Z", CUT_MS = Date.parse(CUTOFF) - Date.parse("2021-01-01T00:00:00Z");
const tradesOf = (days, priceOf) =>
  Array.from({ length: days }, (_, d) => [0, 1, 2].flatMap((part) => [-50, 50].map((offset, k) => ({ t_ms: d * DAY + part * 8 * HOUR + (k + 1) * 60000, price: (priceOf(d, part) + offset) * 100, qty: 100000000, takerBuy: k === 1 })))).flat();
const RAMP = tradesOf(48, (d, part) => 10000 + d * 100 + part * 10).filter((x) => x.t_ms <= CUT_MS);
const SHAPED = tradesOf(48, (d) => (d < 20 ? 10000 : d <= 29 ? 10000 + (d - 19) * 300 : d <= 39 ? 13000 - (d - 29) * 300 : 10000 + (d - 39) * 100)).filter((x) => x.t_ms <= CUT_MS);
const VIEW = "#t=2021-02-17T08:00Z~2021-02-17T12:00Z&r=8,0&vis=2";
const level = (earlier, later, f) => later - f * (later - earlier);
const percent = (f) => `${(f * 100).toFixed(1)}%`;

test.use({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });

// Inspect → References: the names of every reference on, and the named level of one of them.
async function references(page) {
  await page.keyboard.press("e");
  await page.locator('[data-surface="references"]').click();
  return page.locator("#ol-inspect-reference option");
}
// The Lines menu with Structure open (it opens by itself while one of its lines is on).
async function openStructure(page) {
  await page.locator("#ol-lines").click();
  const head = page.locator("#ol-family-structure-head");
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
}
async function namedLevel(page, name) {
  await page.locator("#ol-inspect-reference").selectOption({ label: name });
  const card = page.locator("#ol-inspect-readout");
  const figure = card.locator(".ol-core-stats .ol-cell-stat", { hasText: `Named retracement level · ${name.split(" ").pop()}` });
  return { card, value: Number(await figure.locator("dd").getAttribute("data-canonical")) };
}

test("without the level rows a retracement keeps its three key levels", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: RAMP, cutoffIso: CUTOFF });
  await page.goto(`${fake.url}/${VIEW}&p=9000~15500&lines=fib30`);
  await probe.waitForReady();
  const options = await references(page);
  await expect.poll(async () => (await options.allTextContents()).filter((x) => x.startsWith("30D")).sort()).toEqual(["30D 38.2%", "30D 50.0%", "30D 61.8%"]);
});

test("Classic levels and Extensions add theirs to every retracement at later − f × (later − earlier)", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: RAMP, cutoffIso: CUTOFF });
  await page.goto(`${fake.url}/${VIEW}&p=9000~15500&lines=fib30,fibclassic,fibext`);
  await probe.waitForReady();
  const options = await references(page),
    all = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
  await expect.poll(async () => (await options.allTextContents()).filter((x) => x.startsWith("30D")).sort()).toEqual(all.map((f) => `30D ${percent(f)}`).sort());
  for (const f of all) {
    const { value } = await namedLevel(page, `30D ${percent(f)}`);
    expect(value, `30D ${percent(f)}`).toBeCloseTo(level(11750, 14760, f), 6);
  }
  // An extension says it lies past the earlier extreme.
  const { card } = await namedLevel(page, "30D 161.8%");
  await expect(card).toContainText("this line is its 161.8% level");
});

test("the added levels are tagged only while their price is in view", async ({ page, fakeFor, probe, pane }) => {
  const fake = await fakeFor({ trades: RAMP, cutoffIso: CUTOFF });
  // 12,800–13,700 holds 38.2, 50 and 61.8% (13,610.18, 13,255, 12,899.82) and none of 0, 23.6, 78.6 or 100% (14,760, 14,049.64, 12,394.14, 11,750).
  await page.goto(`${fake.url}/${VIEW}&p=12800~13700&lines=fib30,fibclassic`);
  await probe.waitForReady();
  const tags = async () => paneCanvas.textsOf(await pane.last()).filter((x) => x.startsWith("30D"));
  await expect.poll(tags).toEqual(expect.arrayContaining(["30D 38.2%", "30D 50.0%", "30D 61.8%"]));
  for (const f of [0, 0.236, 0.786, 1]) expect((await tags()).some((x) => x.startsWith(`30D ${percent(f)}`)), `no tag for ${percent(f)}, at the edge or in view`).toBe(false);
  await openStructure(page);
  await expect(page.locator('.ol-line-row[data-ref-key="fibclassic"]')).toHaveAttribute("data-ref-state", "offscreen");
  await expect(page.locator('.ol-line-row[data-ref-key="fib30"]')).toHaveAttribute("data-ref-state", "shown");
  await page.keyboard.press("Escape");
  await page.goto(`${fake.url}/${VIEW}&p=11000~15000&lines=fib30,fibclassic`);
  await page.reload();
  await probe.waitForReady();
  await expect.poll(tags).toEqual(expect.arrayContaining([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((f) => `30D ${percent(f)}`)));
});

test("a chosen UTC day adds a removable retracement since that day, kept in the address", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: RAMP, cutoffIso: CUTOFF });
  await page.goto(`${fake.url}/${VIEW}&p=9000~15500&lines=fibclassic`);
  await probe.waitForReady();
  await openStructure(page);
  const value = (key) => page.locator(`[data-line-value="${key}"]`);
  await expect(value("fibclassic")).toHaveText("with a retracement");
  await page.locator("#ol-lines-fdate").fill("2021-02-10");
  await page.locator("#ol-lines-fadd button[type=submit]").click();
  await expect(page.locator("#ol-lines-fdays .ol-line-row")).toHaveCount(1);
  await expect(page.locator("#ol-lines-fdays .ol-line-name")).toHaveText("Retracements since 10 Feb 2021");
  await expect(value("fib:2021-02-10")).toHaveText("50% 14,355");
  await expect(value("fibclassic")).toHaveText("");
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash));
  await expect.poll(hash).toContain("fib:2021-02-10");
  // The address brings it back.
  await page.reload();
  await probe.waitForReady();
  const options = await references(page);
  await expect.poll(async () => (await options.allTextContents()).filter((x) => x.startsWith("Since 10 Feb")).length).toBe(7);
  for (const f of [0, 0.5, 1]) expect((await namedLevel(page, `Since 10 Feb ${percent(f)}`)).value).toBeCloseTo(level(13950, 14760, f), 6);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await openStructure(page);
  await page.locator('#ol-lines-fdays [data-line-remove="fib:2021-02-10"]').click();
  await expect(page.locator("#ol-lines-fdays .ol-line-row")).toHaveCount(0);
  await expect.poll(hash).not.toContain("fib:");
});

test("Retracements · last 4h swing measures the last two 4-hour swings", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: SHAPED, cutoffIso: CUTOFF });
  await page.goto(`${fake.url}/${VIEW}&p=9000~15500&lines=fibswing4h`);
  await probe.waitForReady();
  const options = await references(page);
  await expect.poll(async () => (await options.allTextContents()).filter((x) => x.startsWith("4h Swing")).sort(), { timeout: 30000 }).toEqual(["4h Swing 38.2%", "4h Swing 50.0%", "4h Swing 61.8%"]);
  for (const f of [0.382, 0.5, 0.618]) {
    const { card, value } = await namedLevel(page, `4h Swing ${percent(f)}`);
    expect(value, `4h Swing ${percent(f)}`).toBeCloseTo(level(13050, 9950, f), 6);
    await expect(card).toContainText("Confirmed swing anchor");
  }
});
