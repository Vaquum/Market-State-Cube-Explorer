"use strict";
// Native selects change before their transaction is measured. A refusal must restore the committed record every time.
const { test, expect } = require("./fixtures.js");
test.use({ reducedMotion: "reduce" });
const KEY = "market-state-cube-explorer:comparison:v1:BTC/USDT", CAP = 4 * 1024 * 1024;
const HASH = "#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=24600~25400&r=4,0&vis=2&marks=none&lines=";
const panel = (page) => page.locator("#ol-comparisonWorkspace");
const control = (page, name) => panel(page).locator(`[data-comparison-control="${name}"]`);
const volume = (page) => panel(page).locator('.ol-comparison-focus [data-metric="volume"]');
async function counters(page) {
  return panel(page).evaluate((node) => ({ stats: node.dataset.stats, writes: node.dataset.writes, revision: node.dataset.revision }));
}

for (const [name, rejected, retained] of [
  ["basis", "intensity", "auto"],
  ["sort", "volume", "time"],
  ["reference", "bench-cell-1", ""],
]) {
  test(`repeated size-rejected ${name} selection restores the committed control and comparison`, async ({ page, fakeFor, probe }) => {
    const { comparisonFixture } = await import("../../tools/benchmark/comparison.mjs");
    // The padding belongs to an off-page scalar fact; focused metrics remain ordinary independently authored values.
    const record = comparisonFixture(32, CAP), raw = JSON.stringify(record);
    expect(Buffer.byteLength(raw, "utf8")).toBe(CAP);
    await page.addInitScript(({ key, raw }) => sessionStorage.setItem(key, raw), { key: KEY, raw });
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/" + HASH);
    await probe.waitForReady({ timeout: 20000 });
    await probe.waitForQuiet({ quietMs: 300 });
    await page.locator("#ol-tab-compare").click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator(".ol-comparison-entries [data-capture-id]")).toHaveCount(24);
    await expect(volume(page)).toHaveAttribute("data-canonical", "1");
    await expect(volume(page)).toHaveAttribute("data-formula", "cells.volume.amount@1");
    const before = await counters(page), first = panel(page).locator(".ol-comparison-entries [data-capture-id]").first();
    // The first rejection changes the notice; the identical second rejection must not be skipped by the render cache.
    for (let attempt = 0; attempt < 2; attempt++) {
      await control(page, name).focus();
      await control(page, name).selectOption(rejected);
      await expect(panel(page).locator("[data-comparison-status]")).toContainText("4 MiB");
      await expect(control(page, name)).toHaveValue(retained);
      await expect(control(page, name)).toBeFocused();
      await expect(control(page, "basis")).toHaveValue("auto");
      await expect(control(page, "sort")).toHaveValue("time");
      await expect(control(page, "reference")).toHaveValue("");
      await expect(panel(page).locator(".ol-comparison-basis-note")).toHaveText("Auto → Amount");
      await expect(volume(page)).toHaveAttribute("data-canonical", "1");
      await expect(volume(page)).toHaveAttribute("data-formula", "cells.volume.amount@1");
      await expect(volume(page).locator(".ol-comparison-difference")).toContainText("−15.5 USDT");
      await expect(first).toHaveAttribute("data-capture-id", "bench-cell-0");
      expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe(raw);
      expect(await counters(page)).toEqual(before);
    }
  });
}
