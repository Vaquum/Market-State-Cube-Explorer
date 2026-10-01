"use strict";
// B53 view-summary.spec.js (PRD-0002 S3, #48 section 5, the capture-ready summary): the Query tab says, in one place, what a screenshot of the view should say.
//
// A view with Cells, Rows, an Efficiency pane, a profile track, a held scale and a replay edge is opened on a fake cube, and the summary is read:
//   1. every item the PRD names is there: the measures with their bases and units, the scalar transform and its numerical domain, the scale policy, the cohort, the cutoff
//      the scale was fitted through, the mapping id, the common support and quality of the Rows, the clipping, the data cutoff, the canonical cutoff, the replay edge, the
//      model and its status, the appearance and its version, and the sentence that original vintages are not recorded and no export or snapshot is offered;
//   2. it says what the popovers say: each channel's rows are the same fields with the same text as its Details popover (they are the same record), and the Rows' own
//      lines are the Rows popover's;
//   3. the copy is the same words, and opening the summary reads nothing from the cube and writes nothing: no request, no storage.
// Oracles (none is the code under test): the page's own popovers (read through the observation surface, D.18), the chip datasets, the cube fake's request log, and the
// words pinned in text.test.js.
const { test, expect, observe } = require("./fixtures.js");
const S = require("./rows-support.js");
const P = require("./persistence-support.js");

const REPLAY = "2026-09-24T06:00Z";
const ADDRESS = `#w=7d&vis=2&rows=volume&period=30d&pane=efficiency&lines=1d&replay=1&at=${REPLAY}`;

async function fieldsOf(locator) {
  return locator.evaluate((el) => {
    const out = {};
    for (const dd of el.querySelectorAll("dd[data-field]")) out[dd.dataset.field] ??= { text: dd.textContent.trim(), value: dd.dataset.value ?? null, label: dd.previousElementSibling?.textContent.trim() ?? "" };
    return out;
  });
}

test.describe("B53 the view summary", () => {
  test("every item the PRD names is in the Query tab's summary, and it says what the popovers say", async ({ page, probe, fakeFor, context }) => {
    const fake = await fakeFor("standard");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fake.url });
    await page.setViewportSize({ width: 1500, height: 950 });
    const surface = observe(page);
    await page.goto(`${fake.url}/${ADDRESS}`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    // the scale is held (one action), so a policy, a cohort and a fit cutoff are all on the page
    await P.popoverAction(page, surface, "Comparison lock");
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    // the popovers' own details, read first (opening one is not what is under test)
    const cellsPopover = (await surface.details("cells")).fields;
    const rowsPopover = (await surface.details("rows")).fields;
    const requests = fake.log().length;
    // open the drawer and its Query tab (the drawer's own preference is saved by that, as it always was)
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("t");
    await page.locator("#ol-tab-query").click();
    await page.waitForTimeout(400);
    const storedBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    const summary = page.locator("#ol-summary");
    await expect(summary).toBeVisible();
    await expect(page.locator("#ol-summary-title")).toHaveText("View summary");
    await expect(page.locator('#ol-summary [data-section="cells"]')).toBeVisible();
    await expect.poll(() => page.locator("#ol-summary [data-section]").count(), { timeout: 30000 }).toBeGreaterThanOrEqual(6);
    const section = (id) => page.locator(`#ol-summary [data-section="${id}"]`);
    const view = await fieldsOf(section("view"));
    // 1. the view's own items
    for (const field of ["place", "level", "cellsMeasure", "columnsMeasure", "rowsMeasure", "dataCutoff", "replay", "source", "model", "appearance", "vintage", "limit"]) {
      if (field === "vintage" || field === "limit") continue;
      expect(view[field], `the view section has ${field}`).toBeTruthy();
    }
    expect(view.replay.text, "the replay edge is named").toMatch(/^At 2026-09-24T06:00Z/);
    expect(view.dataCutoff.value, "and it is the cutoff of the data the page draws").toBe(String(Date.parse("2026-09-24T06:00:00Z")));
    expect(view.appearance.text).toContain("version 2");
    expect(view.appearance.text).toContain(P.AP.split("-")[0]);
    expect(view.model.value, "the model has a status").toMatch(/^(retrospective|timing-unverified|eligible-by-bound)$/);
    // 2. each channel says what its popover says, field by field
    const cells = await fieldsOf(section("cells"));
    const shared = Object.keys(cells).filter((k) => cellsPopover[k] !== undefined && !k.includes("#"));
    for (const field of ["measure", "basis", "unit", "transform", "policy", "mappingId", "appearanceId"]) expect(cells[field], `Cells: ${field}`).toBeTruthy();
    expect(shared.length, "the summary and the popover share most of their fields").toBeGreaterThan(12);
    for (const field of shared) expect(cells[field].text, `Cells: ${field} is the popover's`).toBe(cellsPopover[field].text);
    expect(cells.policy.text, "the held scale is named").toMatch(/comparison|lock/i);
    expect(cells.mappingId.text).toMatch(/^[A-Za-z0-9_-]{16}/);
    for (const field of ["cohortCount", "fitThrough", "clipHighFinite", "clipLowFinite", "obsCutoff"]) expect(cells[field], `Cells: ${field}`).toBeTruthy();
    expect(cells.fitThrough.text, "the fit cutoff is an instant").toMatch(/^\d{4}-\d\d-\d\dT/);
    const rows = await fieldsOf(section("rows"));
    for (const field of ["rowPeriod", "rowSize", "rowQuality"]) {
      expect(rows[field], `Rows: ${field}`).toBeTruthy();
      expect(rows[field].text, `Rows: ${field} is the popover's`).toBe(rowsPopover[field].text);
    }
    // the axes and the profile tracks
    const axes = await fieldsOf(section("axes"));
    expect(Object.keys(axes).filter((k) => k.startsWith("axis:")).length, "the pane's axis is named with its policy and domain").toBeGreaterThan(0);
    expect(Object.values(axes)[0].text).toMatch(/\d/);
    expect((await fieldsOf(section("profile"))).profileComparison, "the profile comparison").toBeTruthy();
    // the vintage and the limits, in the module's words
    const vintage = await fieldsOf(section("vintage"));
    expect(vintage.vintage.text).toBe("Replay on currently available history; original vintages not guaranteed");
    expect(vintage.limit.text).toContain("original vintages are not recorded");
    expect(vintage.limit.text).toContain("No hosted export and no immutable data snapshot");
    // 3. opening it reads nothing from the cube and writes nothing
    await page.waitForTimeout(600);
    expect(fake.log().length, "no request was made to build the summary").toBe(requests);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage })), "and building the summary stored nothing").toBe(storedBefore);
    // the copy is the same words, section by section
    await page.locator("#ol-copy-summary").click();
    await expect(page.locator("#ol-copy-status")).toHaveText("Summary copied");
    const copied = await P.clipboardText(page);
    for (const id of ["view", "cells", "rows", "axes", "profile", "vintage"]) {
      const title = await section(id).locator("h4").textContent();
      expect(copied, `the copy has the section ${title}`).toContain(title);
    }
    for (const field of ["measure", "mappingId", "transform"]) expect(copied).toContain(`${cells[field].label}: ${cells[field].text}`);
    expect(copied).toContain("original vintages are not recorded");
  });

  test("the summary follows the view: another measure changes its Cells section, and a live view says it is live", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&mode=volume`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("t");
    await page.locator("#ol-tab-query").click();
    const read = async () => fieldsOf(page.locator('#ol-summary [data-section="cells"]'));
    await expect.poll(async () => (await read()).measure?.text, { timeout: 30000 }).toContain("Volume");
    const volume = await read();
    const view = await fieldsOf(page.locator('#ol-summary [data-section="view"]'));
    expect(view.replay.text, "a live view is live").toBe("Live");
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.getElementById("ol-mode-text")?.textContent !== "Volume");
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    await expect.poll(async () => (await read()).measure?.text, { timeout: 30000 }).not.toBe(volume.measure.text);
    const next = await read();
    expect(next.mappingId.text, "another measure is another mapping").not.toBe(volume.mappingId.text);
  });
});
