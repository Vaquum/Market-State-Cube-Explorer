"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");

test.use({ reducedMotion: "reduce" });
const COMPARISON_KEY = "market-state-cube-explorer:comparison:v1:BTC/USDT";
const comparison = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), COMPARISON_KEY);
const params = (page) => new URLSearchParams(new URL(page.url()).hash.slice(1));
async function defaults(page) {
  await expect(page.locator("#ol-window-text")).toHaveText("24h");
  await expect(page.locator("#ol-mode-text")).toHaveText("Volume");
  await expect(page.locator("#ol-pane-text")).toHaveText("Same as cells");
  await expect(page.locator("#ol-rows-text")).toHaveText("Off");
  await expect(page.locator("#ol-follow")).toHaveAttribute("data-mode", "refit");
  await expect(page.locator("#ol-replay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ol-poc")).toBeChecked();
  await expect(page.locator("#ol-area")).not.toBeChecked();
  await expect(page.locator("#ol-untested")).not.toBeChecked();
  await expect(page.locator("#ol-clear")).toBeHidden();
  await expect(page.locator("#ol-reset-canvas")).toBeFocused();
  await expect.poll(() => params(page).get("w")).toBe("24h");
  for (const key of ["level", "lines", "sel", "at", "replay", "mode", "pane", "rows", "period", "bs", "cp", "lk", "sw"])
    expect(params(page).has(key), key + " restored to its default").toBe(false);
}

test("Reset canvas restores the default chart and persists it without a dialog when there is no authored work", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await D.open(page, fake, "&mode=candles&pane=delta&rows=volume&period=7d&level=25000&marks=poc,area,untested&f=diagonal&bs=i&cp=a&lk=1&replay=1&at=2026-09-24T00:00Z");
  await page.locator("#ol-lens").click();
  await page.getByRole("button", { name: "Reset canvas", exact: true }).click();
  await expect(page.locator("#ol-reset-confirm")).toBeHidden();
  await defaults(page);
  await probe.waitForReady();
  await page.screenshot({ path: "reports/canvas-reset-desktop.png" });
  await page.reload();
  await D.ready(page);
  await expect(page.locator("#ol-window-text")).toHaveText("24h");
  await expect(page.locator("#ol-mode-text")).toHaveText("Volume");
  await expect(page.locator("#ol-rows-text")).toHaveText("Off");
  await expect(page.locator("#ol-replay")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await comparison(page))?.captures.length).toBe(0);
});

test("confirmation cancels without changes, clears hidden and locked drawings and comparison cells, and retains saved views", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini");
  await D.open(page, fake, "&level=25000&marks=poc,area,untested&rows=volume");
  const { id } = await D.drawing(page);
  await D.action(page, id, "lock");
  await D.action(page, id, "visible");
  const original = await D.row(page, id);
  await D.closeManager(page);
  await page.locator("#ol-tab-cells").click();
  const add = page.locator("#ol-table-body").getByRole("button", { name: "Add to comparison" }).first();
  await expect(add).toBeEnabled();
  await add.click();
  await expect.poll(async () => (await comparison(page))?.captures.length).toBe(1);
  await page.locator("#ol-hist").click();
  await page.locator("#ol-view-name").fill("Before reset");
  await page.locator("#ol-view-form").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#ol-saved")).toContainText("Before reset");
  await page.keyboard.press("Escape");
  const beforeHash = page.url(), beforeComparison = await comparison(page);
  await page.locator("#ol-reset-canvas").click();
  await expect(page.locator("#ol-reset-confirm-note")).toContainText("1 drawing (1 locked) and 1 comparison cell");
  await expect(page.locator("#ol-reset-cancel")).toBeFocused();
  await page.keyboard.press("r");
  await page.locator("#ol-reset-cancel").press("Enter");
  await expect(page.locator("#ol-reset-confirm")).toBeHidden();
  expect(page.url()).toBe(beforeHash);
  expect(await comparison(page)).toEqual(beforeComparison);
  expect(await D.row(page, id)).toEqual(original);
  await page.locator("#ol-reset-canvas").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-reset-canvas")).toBeFocused();
  expect(page.url()).toBe(beforeHash);
  await page.locator("#ol-reset-canvas").click();
  await page.locator("#ol-reset-apply").press("Enter");
  await defaults(page);
  await expect.poll(() => D.count(page)).toBe(0);
  await expect.poll(async () => (await comparison(page))?.captures.length).toBe(0);
  await page.locator("#ol-hist").click();
  await expect(page.locator("#ol-saved")).toContainText("Before reset");
  await page.keyboard.press("Escape");
  await D.manager(page);
  await page.locator("#ol-drawing-undo").click();
  await expect.poll(() => D.count(page)).toBe(1);
  expect(await D.row(page, id)).toEqual(original);
});

for (const width of [375, 600]) {
  test(`Reset canvas stays visible and works at ${width}px without opening the controls sheet`, async ({ page, fakeFor }) => {
    await page.setViewportSize({ width, height: 812 });
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/" + D.HASH + "&mode=delta&level=25000");
    await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /\d/);
    const button = page.getByRole("button", { name: "Reset canvas", exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await button.click();
    await defaults(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator("#ol-legend")).toHaveAttribute("data-state", "ready");
    await page.screenshot({ path: `reports/canvas-reset-${width}.png` });
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("g");
    const point = D.point(await D.plot(page), .3, .4);
    await page.mouse.click(point.x, point.y);
    await button.click();
    await expect(page.locator("#ol-reset-confirm-note")).toContainText("unfinished drawing");
    const dialog = await page.locator("#ol-reset-confirm").boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
    await page.locator("#ol-reset-apply").click();
    await defaults(page);
  });
}
