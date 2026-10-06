"use strict";
const { test, expect } = require("./fixtures.js");

test.use({ reducedMotion: "reduce" });

test("the last choice finishes automatically and all settings remain selected on reopen and reload", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h");
  await probe.waitForReady();
  const menu = page.locator("#ol-mode-menu");
  await page.locator("#ol-mode").press("ArrowDown");
  await expect(menu).toHaveAttribute("data-step", "dataset");
  expect(await menu.locator("[data-scale-item]").count()).toBe(0);
  await menu.locator('[data-mode="trades"]').click();
  await expect(menu).toHaveAttribute("data-step", "transform");
  await expect(page.locator("#ol-mode-text")).toHaveText("Trades");
  await menu.locator('[data-scale-item="transform:linear"]').press("Enter");
  await expect(menu).toHaveAttribute("data-step", "basis");
  await expect(menu.locator('[data-scale-item="basis:amount"]')).toBeFocused();
  await menu.locator('[data-scale-item="basis:intensity"]').click();
  await expect(menu).toHaveAttribute("data-step", "policy");
  await menu.locator('[data-scale-item="policy:explore"]').click();
  await expect(menu).toHaveAttribute("data-step", "options");
  await expect(menu.locator('[data-scale-item="lock"]')).toBeFocused();
  await menu.locator('[data-scale-item="local"]').click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#ol-mode")).toBeFocused();
  await page.locator("#ol-mode").click();
  await menu.locator('[data-mode-step="options"]').click();
  await expect(menu.locator('[data-scale-item="local"]')).toHaveAttribute("aria-checked", "true");
  await menu.locator('[data-mode-nav="back"]').click();
  await expect(menu).toHaveAttribute("data-step", "policy");
  await menu.locator('[data-mode-nav="next"]').click();
  await menu.getByRole("menuitem", { name: "Done", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#ol-mode")).toBeFocused();
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).get("cv")).toBe("l");
  await page.reload();
  await probe.waitForReady();
  await expect(page.locator("#ol-mode-text")).toHaveText("Trades");
  await expect(page.locator("#ol-legend")).toHaveAttribute("data-context", /trades.*i.*linear/);
  await page.locator("#ol-mode").click();
  for (const [step, key] of [["transform", "transform:linear"], ["basis", "basis:intensity"], ["policy", "policy:explore"], ["options", "local"]]) {
    await menu.locator(`[data-mode-step="${step}"]`).click();
    await expect(menu.locator(`[data-scale-item="${key}"]`)).toHaveAttribute("aria-checked", "true");
  }
});

test("right-click changes one setting and finishes from every step while retaining the other settings", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h&vis=2&mode=trades&bs=i&cv=l&cp=a");
  await probe.waitForReady();
  const menu = page.locator("#ol-mode-menu");
  const params = () => new URLSearchParams(new URL(page.url()).hash.slice(1));
  await expect.poll(() => [params().get("bs"), params().get("cv"), params().get("cp")]).toEqual(["i", "l", "a"]);
  const choose = async (step, selector) => {
    await page.locator("#ol-mode").click();
    await menu.locator(`[data-mode-step="${step}"]`).click();
    await menu.locator(selector).click({ button: "right" });
    await expect(menu).toBeHidden();
    await expect(page.locator("#ol-mode")).toBeFocused();
  };
  await choose("dataset", '[data-mode="volume"]');
  await expect(page.locator("#ol-mode-text")).toHaveText("Volume");
  await expect.poll(() => [params().get("bs"), params().get("cv"), params().get("cp")]).toEqual(["i", "l", "a"]);
  await choose("transform", '[data-scale-item="transform:log"]');
  await expect.poll(() => [params().get("bs"), params().get("cv"), params().get("cp")]).toEqual(["i", null, "a"]);
  await choose("basis", '[data-scale-item="basis:amount"]');
  await expect.poll(() => [params().get("bs"), params().get("cv"), params().get("cp")]).toEqual([null, null, "a"]);
  await choose("policy", '[data-scale-item="policy:explore"]');
  await expect.poll(() => [params().get("bs"), params().get("cv"), params().get("cp")]).toEqual([null, null, null]);
  await choose("options", '[data-scale-item="local"]');
  await page.reload();
  await probe.waitForReady();
  await page.locator("#ol-mode").click();
  await menu.locator('[data-mode-step="options"]').click();
  await expect(menu.locator('[data-scale-item="local"]')).toHaveAttribute("aria-checked", "true");
});

test("fixed scales skip Transform and Basis, geometry skips all scale steps, and shortcuts retain focus", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(fake.url + "/#w=24h");
  await probe.waitForReady();
  const menu = page.locator("#ol-mode-menu");
  await page.locator("#ol-mode").click();
  await menu.locator('[data-mode="flow"]').click();
  await expect(menu).toHaveAttribute("data-step", "policy");
  expect(await menu.locator('[data-mode-step="transform"], [data-mode-step="basis"]').count()).toBe(0);
  await menu.locator('[data-mode-step="dataset"]').click();
  await menu.locator('[data-mode="geometry"]').click();
  await expect(menu).toBeHidden();
  await page.locator("#ol-mode").click();
  await expect(menu.locator("[data-mode-step]")).toHaveCount(1);
  await page.keyboard.press("m");
  await expect(page.locator("#ol-mode-text")).toHaveText("Candles");
  await expect(menu.locator('[data-mode="geometry"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-mode")).toBeFocused();
});

test("unavailable recorded datasets keep the current step and selection", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("recorded");
  await page.goto(fake.url + "/#w=24h");
  await probe.waitForReady();
  await page.locator("#ol-mode").click();
  const menu = page.locator("#ol-mode-menu"), path = menu.locator('[data-mode="path"]');
  await expect(path).toHaveAttribute("aria-disabled", "true");
  await path.press("Enter");
  await expect(menu).toHaveAttribute("data-step", "dataset");
  await expect(page.locator("#ol-mode-text")).toHaveText("Volume");
  await path.click({ button: "right", force: true });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-step", "dataset");
  await expect(page.locator("#ol-mode-text")).toHaveText("Volume");
});

for (const width of [375, 1500]) {
  test(`the step chooser fits at ${width}px with visible navigation and no horizontal overflow`, async ({ page, fakeFor, probe }, info) => {
    await page.setViewportSize({ width, height: 812 });
    const fake = await fakeFor("recorded");
    await page.goto(fake.url + "/#w=24h");
    await probe.waitForReady();
    await page.locator("#ol-mode").click();
    const menu = page.locator("#ol-mode-menu");
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(812);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(menu.locator('[data-mode-nav="next"]')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`dataset-${width}.png`) });
    await menu.locator('[data-mode="volume"]').click();
    await expect(menu).toHaveAttribute("data-step", "transform");
    await expect(menu.locator('[data-mode-nav="back"]')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`transform-${width}.png`) });
  });
}
