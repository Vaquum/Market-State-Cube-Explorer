"use strict";
// Independent mixed.json counters: columns 0..1, rows 200..202 total
// 602.25 USDT, 301.5 buy USDT, 9 trades, 4 buy trades. Ratios divide sums.
const { test, expect } = require("./fixtures.js");
const VIEW = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&marks=none&lines=";
const SEL = "&sel=2021-01-01T00:00Z~2021-01-01T00:01:52.500Z,25000~25375";
const CARD = "#ol-selection-card";
async function open(page, fakeFor, probe, suffix = SEL) {
  const fake = await fakeFor("micro:mixed"); await page.goto(fake.url + "/" + VIEW + suffix); await probe.waitForReady(); return fake;
}
const field = (page, key) => page.locator(`${CARD} dd[data-field="${key}"]`);
async function canonical(page, key, expected) { await expect.poll(async () => Number(await field(page, key).getAttribute("data-canonical"))).toBeCloseTo(expected, 10); }

test("area selection uses the cell sections and summed counters instead of mean cell ratios", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await expect(page.locator(CARD)).toHaveAttribute("data-presentation", "cell");
  await canonical(page, "volume", 602.25); await canonical(page, "trades", 9);
  await canonical(page, "delta", .75); await canonical(page, "imbalance", .75 / 602.25);
  await canonical(page, "size", 602.25 / 9); await canonical(page, "buySize", 301.5 / 4); await canonical(page, "sellSize", 300.75 / 5);
  await canonical(page, "countShare", 4 / 9);
  await expect(page.locator(`${CARD} .ol-flow-labels`)).toContainText("50.1%");
  expect(await page.locator(`${CARD} h3`).allTextContents()).toEqual(["Activity", "Aggression", "Reported trade size", "Location", "Selection profile"]);
  await expect(page.locator(`${CARD} .ol-card-profile`)).toBeVisible();
  await page.locator("#ol-clear").click(); await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.locator("#ol-vol")).toBeVisible(); await expect(page.locator("#ol-vol")).toHaveAttribute("data-canonical", "953.375");
});

test("one-cell selection and Cell share canonical composition and section styling", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "&sel=2021-01-01T00:00Z~2021-01-01T00:00:56.250Z,25000~25125");
  await canonical(page, "size", 150); await canonical(page, "imbalance", -1 / 3);
  const canvas = page.locator("#ol-canvas"), box = await canvas.boundingBox(), layout = (await canvas.getAttribute("data-layout")).split(",").map(Number);
  await page.mouse.move(box.x + layout[0] + layout[2] * 28.125 / 360, box.y + layout[1] + layout[3] * (25500 - 25062.5) / 700);
  await page.keyboard.press("e"); await page.getByRole("tab", { name: "Cells", exact: true }).click();
  for (const key of ["size", "imbalance", "buySize", "sellSize"]) {
    await expect(page.locator(`#ol-inspect-readout dd[data-field="${key}"]`)).toHaveAttribute("data-canonical", await field(page, key).getAttribute("data-canonical"));
    const sizes = await page.locator(`#ol-inspect-readout dd[data-field="${key}"], ${CARD} dd[data-field="${key}"]`).evaluateAll(ns => ns.map(n => getComputedStyle(n).fontSize));
    expect(new Set(sizes).size).toBe(1);
  }
});

test("selection histories compare equal-duration windows in the same band and retain zero versus missing support", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "&sel=2021-01-01T00:01:52.500Z~2021-01-01T00:03:45Z,25000~25375");
  const record = await page.locator(CARD).evaluate(n => JSON.parse(n.dataset.observation));
  expect(record.time).toEqual([2, 4]); expect(record.price).toEqual([25000, 25375]);
  expect(record.history.slice(-2).map(x => x.time)).toEqual([[0, 2], [2, 4]]);
  const histories = await page.locator(CARD).evaluate(n => JSON.parse(n.dataset.compactHistories));
  expect(histories.find(h => h.id === "volume").slots.slice(-2).map(x => x.result)).toEqual([{ tag: "finite", value: 602.25 }, { tag: "finite", value: 0 }]);
  expect(histories.find(h => h.id === "imbalance").slots.at(-1).result).toEqual({ tag: "undefined", denominator: "cell volume" });
  expect(histories[0].slots[0].result.tag).toBe("unsupported");
  await expect(page.locator(CARD)).toContainText("No trades in this selection");
});

test("selection movement uses its own covered seconds and measured price width", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, SEL + "&mode=path");
  // Hand fixture: path 250 + 125 + 125 = 500 USDT; dwell 41.25 + 10 + 3.75 + 40 + 12.5 = 107.5 s.
  await expect(page.locator(`${CARD} [data-group="movement"]`)).toBeVisible();
  await canonical(page, "dwellShare", 107.5 / 112.5);
  const record = await page.locator(CARD).evaluate(n => JSON.parse(n.dataset.observation));
  expect(record.time).toEqual([0, 2]); expect(record.result.value).toBeCloseTo(500 / 375, 12);
});

for (const theme of ["light", "dark"]) test(`${theme}: narrow selection preserves readable groups and disclosure focus`, async ({ page, fakeFor, probe }) => {
  await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 960, height: 700 });
  const fake = await open(page, fakeFor, probe);
  const summary = page.locator(`${CARD} .ol-cell-details > summary`); await summary.click();
  await expect(summary).toBeFocused();
  fake.revise({ day: "2021-01-01", factor: 2 });
  await expect.poll(async () => Number(await field(page, "volume").getAttribute("data-canonical"))).toBe(1204.5);
  await expect(page.locator(`${CARD} .ol-cell-details`)).toHaveAttribute("open", ""); await expect(summary).toBeFocused();
  const geometry = await field(page, "size").evaluate(n => ({ font: parseFloat(getComputedStyle(n).fontSize), width: n.getBoundingClientRect().width }));
  expect(geometry.font).toBeGreaterThanOrEqual(18); expect(geometry.width).toBeGreaterThan(0);
  await page.screenshot({ path: `reports/selection-card-${theme}.png` });
});
