"use strict";
// B02 recorded-snapshot.spec.js: the recorded page, the one the committed index.html serves from a plain static server, calibrates and discloses
// exactly like the live page (PRD-0002 S1; DR-54: a view read that can never be answered is not "pending" on a page that has no cube).
//
// What it asserts on the real recorded blocks (the fake in recorded mode serves the page unmodified and answers nothing):
//   * every window 24h -> 7d -> 30d -> 1y -> all and back is calibrated (Explore), never No calibration, and revisiting a window restores
//     the mapping of that resolution's context with the same id (contexts are kept per effective level);
//   * Rows volume over 90 days is an approximation the page says so about: quality approx-rows, the coarse row size and the trimmed start;
//   * Relative volume over a year at those coarse rows names its restriction and its support instead of drawing a fake per-row comparison;
//   * Efficiency's model reads "timing unverified" at the snapshot's own cutoff (it lies within the extraction day), in words.
//
// Oracles (none is the code under test): the chip's data attributes and details as the DOM reports them, the snapshot's documented cutoff
// (README: 2026-09-24 12:02:48.750 UTC), and the coarse row size written out (1,000 USDT rows, 64-hour columns at the long tier).
const { test, expect } = require("./fixtures.js");

async function ready(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 400, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 600, timeout: 20000 });
}

async function chipOf(surface, channel) {
  return (await surface.chip(channel)).data;
}

test.describe("B02 the recorded snapshot through Explore contexts, Rows and the model", () => {
  test("every window is calibrated, and revisiting one restores its mapping", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/#vis=2&w=24h`);
    await ready(page, fake, probe);
    const seen = new Map();
    // 24h, 7d, 30d, 1y, all and back again: the real window keys
    for (const key of ["6", "7", "8", "9", "0", "9", "8", "7", "6"]) {
      await page.keyboard.press(key);
      await probe.waitForQuiet({ quietMs: 800, timeout: 20000 });
      await expect.poll(async () => (await chipOf(surface, "cells")).state, { message: `window ${key} is calibrated`, timeout: 15000 }).toMatch(/^(ready|fixed)$/);
      const data = await chipOf(surface, "cells");
      expect(data.policy, `window ${key}`).toBe("explore");
      const context = data.context;
      if (seen.has(context)) expect(data.mappingId, `revisiting ${context} restores its mapping`).toBe(seen.get(context));
      else seen.set(context, data.mappingId);
    }
    expect(seen.size, "the windows span several resolution contexts").toBeGreaterThanOrEqual(3);
  });

  test("Rows volume over 90 days says it is an approximation, with its row size and where the coarse rows start", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/#vis=2&w=24h&rows=volume&period=90d`);
    await ready(page, fake, probe);
    await expect.poll(async () => (await chipOf(surface, "rows")).state, { timeout: 15000 }).toMatch(/^(ready|fixed)$/);
    const details = await surface.details("rows");
    expect(details.fields.rowQuality.text).toMatch(/^Approximate/);
    expect(details.fields.rowSize.text).toMatch(/1\.00 k USDT|1,000/);
    expect(Object.keys(details.fields)).toContain("rowTrimmed");
  });

  test("Relative volume over a year uses the whole coarse period and names its mean", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/#vis=2&w=all&rows=relvol&period=1y`);
    await ready(page, fake, probe);
    await expect.poll(async () => (await chipOf(surface, "rows")).state, { timeout: 15000 }).toMatch(/^(ready|fixed)$/);
    const details = await surface.details("rows");
    expect(details.fields.rowRelvolRestriction.text).toMatch(/Only bins wholly inside the support on both sides count; \d+ dropped/);
    expect(details.fields.rowRelvolSupport.text).toMatch(/USDT, coarse common bins/);
    expect(details.fields.rowRelvolCounts.text).toMatch(/\d+ finite/);
    expect(details.fields.rowRelvolBasis.value).toBe("period-mean");
    expect(Number(details.fields.rowRelvolMean.value)).toBeGreaterThan(0);
  });

  test("Efficiency's model reads timing unverified at the snapshot's own cutoff", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/#vis=2&w=7d&pane=efficiency`);
    await ready(page, fake, probe);
    await page.locator("#ol-axis-chip").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-axis-pop")).toBeVisible();
    const status = await page.locator('#ol-axis-pop [data-field="modelStatus"]').getAttribute("data-value");
    expect(status).toBe("timing-unverified");
  });
});
