"use strict";
// Oracle: independent exact-rational period sums, and log2(row USDT / mean traded-row USDT).
// Regression: a fixed-period background must survive canvas time/price zoom, selection and cell-resolution changes.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const test = base.extend({ pane: async ({ page }, use) => {
  await paneCanvas.addRecorder(page);
  await use(paneCanvas.forPage(page));
} });
const reference = require("../reference/index.js");
const S = require("./rows-support.js");
const { go } = require("./scale-helpers.js");
test.use({ reducedMotion: "reduce" });

async function reading(page, row, viewRows) {
  const layout = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
  const box = await page.locator("#ol-canvas").boundingBox();
  const y = layout[1] + (viewRows[1] - row - .5) / (viewRows[1] - viewRows[0]) * layout[3];
  await page.mouse.move(box.x + layout[4] + 6, box.y + y);
  await expect(page.locator("#ol-tip")).toBeVisible();
  return page.locator("#ol-tip").evaluate((el) => {
    const dt = [...el.querySelectorAll("dt")].find((x) => x.textContent.startsWith("Relative volume"));
    return { value: dt?.nextElementSibling.dataset.canonical, text: el.textContent };
  });
}

for (const period of ["1d", "1y", "3y", "all"]) {
  test(`${period} relative-volume background is its period's distribution on 24h and 7d canvases`, async ({ page, probe, fakeFor, pane, surface }) => {
    const stream = S.disjoint();
    const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
    const b0 = period === "1d" ? S.END_COL - S.DAY_COLS : period === "all" ? 0 : S.END_COL - (period === "1y" ? 365 : 1095) * S.DAY_COLS;
    const rows = reference.periodRows(stream.trades, { b0, b1: S.END_COL, m: 0 }).filter((x) => x.v > 0);
    const mean = rows.reduce((sum, x) => sum + x.v, 0) / rows.length;
    const view = [196, 214];
    await page.goto(`${fake.url}/${S.address({ cols: [S.END_COL - S.DAY_COLS, S.END_COL], rows: view, rowsKind: "relvol", period, extra: "&r=0,0&vis=2" })}`);
    await S.atRest(page, fake, probe);
    const before = (await surface.chip("rows")).data;
    const samples = rows.filter((x) => [200, 203, 210].includes(x.r));
    for (const row of samples) {
      const got = await reading(page, row.r, view);
      expect(Number(got.value)).toBeCloseTo(Math.log2(row.v / mean), 10);
      expect(got.text).toContain("Average traded row");
    }
    // Narrow selection excludes the period's peak; coarser canvas bins must not merge the background's rows.
    await go(page, S.address({ cols: [S.END_COL - 7 * S.DAY_COLS, S.END_COL], rows: view, rowsKind: "relvol", selection: { cols: stream.early, rows: [199, 202] }, extra: "&r=8,3" }));
    await S.atRest(page, fake, probe);
    for (const row of samples) {
      const got = await reading(page, row.r, view);
      expect(Number(got.value)).toBeCloseTo(Math.log2(row.v / mean), 10);
    }
    const after = (await surface.chip("rows")).data;
    expect(after.rowSize).toBe("0");
    expect(after.context).toBe(before.context);
    expect(after.mappingId).toBe(before.mappingId);
    expect(after.fitSeq).toBe(before.fitSeq);
    const details = await surface.details("rows");
    expect(details.fields.rowRelvolBasis.value).toBe("period-mean");
    expect(Number(details.fields.rowRelvolMean.value)).toBeCloseTo(mean, 8);
  });
}

for (const kind of ["volume", "delta", "time", "relvol"]) {
  test(`${kind}: period price bins and strip colours stay fixed across time and price zoom`, async ({ page, probe, fakeFor, pane, surface }) => {
    const stream = S.disjoint(), fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
    const snapshot = async (view) => {
      const layout = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
      const blocks = (await pane.last()).rects.filter((b) => Math.abs(b.x - layout[4]) < .01 && b.w === 12 && b.alpha === 1 && b.h < layout[3] - 1);
      return blocks.map((b) => ({ row: Math.round(view[1] - (b.y - layout[1]) / layout[3] * (view[1] - view[0]) - 1), fill: b.fill })).filter((b) => b.row >= 200 && b.row <= 205).sort((a, b) => a.row - b.row);
    };
    const view = [196, 214];
    await page.goto(`${fake.url}/${S.address({ cols: [S.END_COL - S.DAY_COLS, S.END_COL], rows: view, rowsKind: kind, period: "3y", extra: "&r=0,0&vis=2" })}`);
    await S.atRest(page, fake, probe);
    const before = await snapshot(view);
    expect(before.length).toBeGreaterThan(0);
    const baseline = (await surface.chip("rows")).data;
    await go(page, S.address({ cols: [S.END_COL - 7 * S.DAY_COLS, S.END_COL], rows: [190, 220], rowsKind: kind, extra: "&r=8,4" }));
    await S.atRest(page, fake, probe);
    expect(await snapshot([190, 220])).toEqual(before);
    expect((await surface.chip("rows")).data.rowSize).toBe("0");
    expect((await surface.chip("rows")).data.mappingId).toBe(baseline.mappingId);
  });
}

test("background menus share a labelled group and changing the period changes the profile", async ({ page, probe, fakeFor }) => {
  const stream = S.disjoint(), fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
  await page.goto(`${fake.url}/${S.address({ cols: [S.END_COL - S.DAY_COLS, S.END_COL], rows: [196, 214], rowsKind: "relvol", period: "1d", extra: "&r=0,0" })}`);
  await S.atRest(page, fake, probe);
  const group = page.getByRole("group", { name: "Canvas background", exact: true });
  await expect(group.locator("#ol-rows")).toBeVisible();
  await expect(group.locator("#ol-period")).toBeVisible();
  const before = Number((await reading(page, 200, [196, 214])).value);
  await page.locator("#ol-period").click();
  await page.locator('#ol-period-list [data-period="all"]').click();
  await S.atRest(page, fake, probe);
  expect(Number((await reading(page, 200, [196, 214])).value)).not.toBeCloseTo(before, 3);
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 10);
  await page.screenshot({ path: "reports/fixed-period-background-desktop.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator("#ol-sheet-toggle").click();
  await expect(group.locator("#ol-rows")).toBeVisible();
  await expect(group.locator("#ol-period")).toBeVisible();
  await page.screenshot({ path: "reports/fixed-period-background-mobile.png" });
});

test("Visible range is first and follows time navigation, persists on reload and ignores selection", async ({ page, probe, fakeFor, surface }) => {
  const stream = S.disjoint(), fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
  const view = [196, 214], cols = [S.END_COL - S.DAY_COLS, S.END_COL];
  await page.goto(`${fake.url}/${S.address({ cols, rows: view, rowsKind: "relvol", period: "visible", extra: "&r=0,0&vis=2" })}`);
  await S.atRest(page, fake, probe);
  await expect(page.locator("#ol-period-text")).toHaveText("Visible range");
  await page.locator("#ol-period").click();
  await expect(page.locator("#ol-period-list input").first()).toHaveAttribute("data-period", "visible");
  await page.keyboard.press("Escape");
  const before = Number((await reading(page, 200, view)).value);
  await go(page, S.address({ cols, rows: view, rowsKind: "relvol", selection: { cols: [cols[1] - 300, cols[1] - 100], rows: [199, 202] }, extra: "&r=8,3" }));
  await S.atRest(page, fake, probe);
  expect(Number((await reading(page, 200, view)).value)).toBeCloseTo(before, 10);
  await go(page, S.address({ cols: stream.early, rows: view, rowsKind: "relvol", extra: "&r=0,0" }));
  await S.atRest(page, fake, probe);
  const period = reference.periodRows(stream.trades, { b0: stream.early[0], b1: stream.early[1], m: 0 });
  const mean = period.reduce((sum, x) => sum + x.v, 0) / period.length;
  const current = Number((await reading(page, 200, view)).value);
  expect(current).toBeCloseTo(Math.log2(period.find((x) => x.r === 200).v / mean), 10);
  expect(current).not.toBeCloseTo(before, 3);
  const details = await surface.details("rows");
  expect(Number(details.fields.rowFrom.value)).toBe(Date.parse("2021-01-01T00:00:00Z") + stream.early[0] * S.BASE_MS);
  await page.reload();
  await S.atRest(page, fake, probe);
  await expect(page.locator("#ol-period-text")).toHaveText("Visible range");
  expect(Number((await reading(page, 200, view)).value)).toBeCloseTo(current, 10);
});
