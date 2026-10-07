"use strict";
const { test, expect } = require("./fixtures.js");

async function open(page, fakeFor, probe, extra = "") {
  const fake = await fakeFor("standard");
  await page.goto(`${fake.url}/#w=24h&vis=2&r=4,0${extra}`);
  await probe.waitForReady();
  await page.locator("#ol-reference-toggle").click();
  await expect(page.locator("#ol-reference")).toBeVisible();
  await probe.waitForReady();
}

test("one drawer entry opens a wide docked reference; settings live in their topics", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "&rows=volume&period=7d");
  const pane = await page.locator("#ol-reference").boundingBox(), chart = await page.locator("#ol-canvas").boundingBox();
  expect(pane.x + pane.width).toBeLessThanOrEqual(chart.x + 1);
  expect(pane.width).toBeGreaterThanOrEqual(440);
  await page.screenshot({ path: "reports/reference-layout.png" });
  await expect(page.locator('.ol-drawer-bar > #ol-reference-toggle + .ol-drawer-divider + .ol-drawer-tabs')).toHaveCount(1);
  await expect(page.locator('header #ol-reference-toggle')).toHaveCount(0);
  await expect(page.locator('.ol-chart #ol-legend, .ol-chart #ol-rows-legend, .ol-chart #ol-profile-chip, .ol-chart #ol-axis-chip')).toHaveCount(0);
  const options = await page.locator("#ol-reference-topic option").evaluateAll(elements => elements.map(element => element.value));
  expect(options).toEqual(["grid", "window", "resolution", "measures", "candles", "movement", "scales", "rows", "profiles", "columns", "states", "selection", "inspect", "lens", "references", "drawings", "evidence", "replay", "tables", "compare", "views"]);
  for (const topic of options) {
    await page.locator("#ol-reference-topic").selectOption(topic);
    await expect(page.locator("#ol-reference-article dt")).toHaveText(["Purpose", "Read", "Use"]);
    expect((await page.locator("#ol-reference-article dd").allTextContents()).every(text => text.length > 25)).toBe(true);
  }
  await page.locator("#ol-reference-topic").selectOption("scales");
  await page.locator("#ol-legend").click();
  await expect(page.locator('#ol-legend-pop [data-action="fit"]').first()).toBeVisible();
  await page.locator("#ol-reference-topic").selectOption("profiles");
  await expect(page.locator("#ol-legend-pop")).toBeHidden();
  await page.locator("#ol-profile-chip").click();
  await expect(page.locator('#ol-profile-pop [data-action="profile-cmp"]')).toHaveCount(3);
  await expect(page.locator('#ol-reference [data-reference-topic]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-profile-pop")).toBeHidden();
  await expect(page.locator("#ol-profile-chip")).toBeFocused();
  await page.locator("#ol-reference-close").click();
  await expect(page.locator("#ol-legend")).toBeHidden();
  await expect(page.locator("#ol-profile-chip")).toBeHidden();
  const restored = await page.locator("#ol-canvas").boundingBox();
  expect(restored.x).toBeLessThan(chart.x - 400);
});

test("five named icon toggles keep the left reference independent of the bottom panels", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  const bar = page.locator(".ol-drawer-bar");
  await expect(bar.locator("button")).toHaveCount(5);
  await expect(bar.getByRole("group", { name: "Bottom panels" })).toBeVisible();
  await expect(bar.locator("button > svg")).toHaveCount(5);
  await expect(page.locator("#ol-reference-toggle")).toHaveAttribute("aria-pressed", "true");
  for (const name of ["cells", "cases", "query", "compare"]) {
    const toggle = page.locator(`#ol-tab-${name}`);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`#ol-panel-${name}`)).toBeVisible();
    await expect(page.locator("[data-drawer][aria-expanded=true]")).toHaveCount(1);
    await expect(page.locator("#ol-reference")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#ol-drawer-body")).toBeHidden();
    await expect(page.locator("#ol-reference")).toBeVisible();
  }
  await page.locator("#ol-tab-query").click();
  await page.locator("#ol-reference-close").click();
  await expect(page.locator("#ol-panel-query")).toBeVisible();
  await expect(page.locator("#ol-reference-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#ol-reference-toggle").focus();
  for (const name of ["cells", "cases", "query", "compare"]) {
    await page.keyboard.press("Tab");
    await expect(page.locator(`#ol-tab-${name}`)).toBeFocused();
  }
  await page.locator("#ol-reference-toggle").click();
  await probe.waitForReady();
  await page.screenshot({ path: "reports/panel-icon-toggles.png" });
});

for (const target of ["#ol-canvas", "#ol-inspect"]) {
  test(`reference preserves Escape dismissal order from ${target}`, async ({ page, fakeFor, probe }) => {
    await open(page, fakeFor, probe);
    await page.locator("#ol-reference-topic").selectOption("selection");
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("s");
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("v");
    await probe.waitForQuiet({ quietMs: 400 });
    const withSelection = await page.evaluate(() => location.hash);
    expect(withSelection).toMatch(/sel=/);
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-inspect-detail")).toBeVisible();
    await page.locator(target).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect-detail")).toBeHidden();
    await expect(page.locator("#ol-inspect")).toBeVisible();
    await expect(page.locator("#ol-reference")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe(withSelection);
    await page.locator(target).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect")).toBeHidden();
    await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ol-reference")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe(withSelection);

    // Active guidance takes one Escape, even from the chart; the next belongs to the chart.
    await page.getByRole("button", { name: "Show selection", exact: true }).click();
    await expect(page.locator("#ol-reference-spotlight")).toBeVisible();
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-reference-spotlight")).toBeHidden();
    expect(await page.evaluate(() => location.hash)).toBe(withSelection);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => location.hash)).not.toMatch(/sel=/);
    await expect(page.locator("#ol-reference")).toBeVisible();
    await page.keyboard.press("s");
    await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ol-reference")).toBeVisible();

    await page.locator("#ol-reference-topic").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-reference")).toBeHidden();
    await expect(page.locator("#ol-reference-toggle")).toBeFocused();
  });
}

test("reference preserves Escape in the expanded bottom Compare panel", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-tab-compare").click();
  const expand = page.locator('#ol-comparisonWorkspace [data-comparison-action="expand"]');
  await expand.click();
  await expect(page.locator("#ol-canvas")).toBeHidden();
  await expect(expand).toHaveText("Restore chart");
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-canvas")).toBeVisible();
  await expect(expand).toHaveText("Expand");
  await expect(page.locator("#ol-panel-compare")).toBeVisible();
  await expect(page.locator("#ol-reference")).toBeVisible();
});

for (const width of [1200, 1000, 760, 390]) {
  for (const referenceFirst of [true, false]) {
    test(`reference keeps docked Inspect accessible at ${width}px (${referenceFirst ? "reference" : "Inspect"} opened first)`, async ({ page, fakeFor, probe }) => {
      await page.setViewportSize({ width, height: 950 });
      const fake = await fakeFor("standard");
      await page.goto(`${fake.url}/#w=24h&vis=2&r=4,0`);
      await probe.waitForReady();
      if (referenceFirst) await page.locator("#ol-reference-toggle").click();
      await page.locator("#ol-canvas").focus();
      await page.keyboard.press("e");
      if (!referenceFirst) await page.locator("#ol-reference-toggle").click();
      await expect(page.locator("#ol-reference")).toBeVisible();
      await expect(page.locator("#ol-inspect")).toBeVisible();
      await page.locator("#ol-inspect").scrollIntoViewIfNeeded();
      await expect(page.locator("#ol-inspect")).toBeInViewport();
      await expect(page.locator("#ol-inspect-readout")).toBeVisible();
      await expect(page.locator("#ol-inspect-readout")).not.toBeEmpty();
      await page.locator("#ol-inspect").focus();
      const before = Number(await page.locator("#ol-inspect").getAttribute("data-c"));
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("#ol-inspect")).toHaveAttribute("data-c", String(before + 1));
      await page.locator("#ol-tab-compare").click();
      const expand = page.locator('#ol-comparisonWorkspace [data-comparison-action="expand"]');
      await expand.click();
      await expect(page.locator("#ol-inspect")).toBeHidden();
      await expect(page.locator("#ol-canvas")).toBeHidden();
      await expect(page.locator("#ol-reference")).toBeVisible();
      await expand.click();
      await expect(page.locator("#ol-inspect")).toBeVisible();
      await expect(page.locator("#ol-canvas")).toBeVisible();
      await page.locator("#ol-inspect-exit").scrollIntoViewIfNeeded();
      await expect(page.locator("#ol-inspect-exit")).toBeInViewport();
      if (referenceFirst) await page.screenshot({ path: `reports/reference-inspect-${width}.png` });
      await page.locator("#ol-inspect-exit").click();
      await expect(page.locator("#ol-inspect")).toBeHidden();
      await expect(page.locator("#ol-reference")).toBeVisible();
      await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
      await page.locator("#ol-reference-close").click();
      await expect(page.locator("#ol-reference")).toBeHidden();
      await expect(page.locator("#ol-canvas")).toBeVisible();
    });
  }
}

test("spotlight identifies the exact control; dimmed clicks and Escape only dismiss guidance", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-reference-topic").selectOption("resolution");
  const hash = await page.evaluate(() => location.hash);
  await page.getByRole("button", { name: "Show resolution", exact: true }).click();
  const frame = page.locator(".ol-reference-frame");
  await expect(page.locator("#ol-reference-spotlight")).toBeVisible();
  const box = await page.locator("#ol-res").boundingBox();
  expect(Number(await frame.getAttribute("x"))).toBeCloseTo(box.x - 4, 0);
  expect(Number(await frame.getAttribute("y"))).toBeCloseTo(box.y - 4, 0);
  expect(Number(await frame.getAttribute("width"))).toBeCloseTo(box.width + 8, 0);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest("#ol-res")?.id, { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe("ol-res");
  await page.mouse.click(1490, 940);
  await expect(page.locator("#ol-reference-spotlight")).toBeHidden();
  await expect(page.locator("#ol-reference")).toBeVisible();
  await page.getByRole("button", { name: "Show resolution", exact: true }).click();
  await page.locator("#ol-res").click();
  await expect(page.locator("#ol-reference-spotlight")).toBeHidden();
  await expect(page.locator("#ol-res-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-res-pop")).toBeHidden();
  await page.getByRole("button", { name: "Show resolution", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-reference-spotlight")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-reference")).toBeHidden();
  await expect(page.locator("#ol-reference-toggle")).toBeFocused();
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

test("canvas spotlights follow resized layout and hidden features give a truthful explanation", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-reference-topic").selectOption("rows");
  await page.getByRole("button", { name: "Show row strip", exact: true }).click();
  await expect(page.locator("#ol-reference-status")).toContainText("not visible");
  await expect(page.locator("#ol-reference-spotlight")).toBeHidden();
  await page.locator("#ol-reference-topic").selectOption("grid");
  await page.getByRole("button", { name: "Show grid", exact: true }).click();
  await expect(page.locator("#ol-reference-spotlight")).toBeVisible();
  const width = Number(await page.locator(".ol-reference-frame").getAttribute("width"));
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect.poll(async () => Number(await page.locator(".ol-reference-frame").getAttribute("width"))).toBeLessThan(width);
  const pane = await page.locator("#ol-reference").boundingBox();
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest("#ol-reference")?.id, { x: pane.x + 30, y: pane.y + 30 })).toBe("ol-reference");
  await page.screenshot({ path: "reports/reference-desktop.png" });
});

test("reference works on a phone and topic keys do not navigate the chart", async ({ page, fakeFor, probe }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, fakeFor, probe);
  const pane = await page.locator("#ol-reference").boundingBox();
  expect(pane.width).toBeLessThanOrEqual(390);
  expect(pane.x).toBe(0);
  const chart = await page.locator("#ol-canvas").boundingBox();
  expect(chart.x).toBeGreaterThanOrEqual(pane.width - 1);
  const hash = await page.evaluate(() => location.hash);
  await page.locator("#ol-reference-topic").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await page.locator("#ol-reference-topic").selectOption("window");
  await page.getByRole("button", { name: "Show time window", exact: true }).click();
  await expect(page.locator("#ol-reference-spotlight")).toBeVisible();
  await page.screenshot({ path: "reports/reference-phone.png" });
  await expect(page.locator("#ol-reference-close")).toBeInViewport();
  await expect(page.locator("#ol-reference-topic")).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-reference")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-reference-toggle")).toBeFocused();
});
