"use strict";
// B34 events-readouts.spec.js (PRD-0002 S2, #47 section 6): the readouts of the annotations that are summaries, statuses, definitions and samples rather
// than conditions on a bar (B33 replays those): a period's POC and a day's POC and value area (a retrospective summary as of the cutoff), an untested
// POC (a status as of the edge), a clock line (a calendar definition, not a measured trade event) and a continuation (known at its anchor, its sample
// floor kept).
// Oracles (none is the code under test): the cutoff of the fake's profile (a minute edge, in base columns: ms / 56,250), the PRD's table, and the sample
// count the page itself prints for the anchored column (the floor of 30 is the PRD's).
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");
const { DEFAULT_CUTOFF } = require("../support/profiles.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const EPOCH_MS = Date.parse("2021-01-01T00:00:00Z");
const CUTOFF_BASE = (Date.parse(DEFAULT_CUTOFF) - EPOCH_MS) / 56250;
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));

// The tag plate of a line (a 16 px rounded plate, the widest of the three the page draws for it), once the page has it.
async function tagPlate(page, rec) {
  await expect.poll(async () => (await rec.last()).roundRects.some((r) => r.h === 16 && r.w > 40), { message: "a line's tag is drawn", timeout: 20000 }).toBe(true);
  const plates = (await rec.last()).roundRects.filter((r) => r.h === 16 && r.w > 40);
  return plates.reduce((a, b) => (b.w > a.w ? b : a));
}
async function hover(page, x, y) {
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  const tip = page.locator("#ol-tip");
  await expect(tip).toBeVisible();
  return tip;
}

test.describe("B34 summaries, statuses, definitions and samples say from when they are known", () => {
  test("a period's POC is a retrospective summary as of the cutoff, not known when the period started", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=7d`);
    await S.atRest(page, fake, probe);
    const plate = await tagPlate(page, pane);
    const tip = await hover(page, plate.x + plate.w / 2, plate.y + plate.h / 2);
    await expect(tip).toHaveAttribute("data-event", "period|retrospective");
    expect(Number(await tip.locator('dd[data-field="knownAt"]').getAttribute("data-canonical")), "as of the cutoff").toBeCloseTo(CUTOFF_BASE, 3);
    await expect(tip).toContainText(/Status\s*A retrospective summary/);
  });

  test("a day's POC and value area: the day still forming is so far, as of the cutoff", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=dpoc`);
    await S.atRest(page, fake, probe);
    const plate = await tagPlate(page, pane);
    const tip = await hover(page, plate.x + plate.w / 2, plate.y + plate.h / 2);
    await expect(tip).toHaveAttribute("data-event", "period|so far");
    expect(Number(await tip.locator('dd[data-field="knownAt"]').getAttribute("data-canonical"))).toBeCloseTo(CUTOFF_BASE, 3);
    await expect(tip).toContainText(/The period is still open: a summary so far, as of the cutoff/);
  });

  test("a clock line is a calendar definition: no known-at, not a measured trade event", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=cday`);
    await S.atRest(page, fake, probe);
    const layout = await layoutOf(page),
      frame = await pane.last();
    const verticals = frame.strokes.filter((k) => k.path.length >= 2 && k.path.every((p) => p[0] === k.path[0][0]) && Math.abs(Math.max(...k.path.map((p) => p[1])) - Math.min(...k.path.map((p) => p[1])) - layout[3]) < 1);
    expect(verticals.length, "day starts across the plot").toBeGreaterThan(2);
    const line = verticals[Math.floor(verticals.length / 2)];
    const tip = await hover(page, line.path[0][0], layout[1] + layout[3] / 2);
    await expect(tip).toHaveAttribute("data-event", "clock|calendar");
    await expect(tip.locator('dd[data-field="knownAt"]')).toHaveAttribute("data-canonical", "null");
    await expect(tip).toContainText(/Known at\s*a calendar definition/);
    await expect(tip).toContainText(/A calendar definition, not a measured trade event/);
  });

  test("an untested POC is a status as of the edge", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=30d&vis=2&lines=udpoc`);
    await S.atRest(page, fake, probe);
    const plate = await tagPlate(page, pane);
    const tip = await hover(page, plate.x + plate.w / 2, plate.y + plate.h / 2);
    await expect(tip).toHaveAttribute("data-event", "untested|as of");
    const knownAt = Number(await tip.locator('dd[data-field="knownAt"]').getAttribute("data-canonical"));
    expect(Math.abs(knownAt - CUTOFF_BASE), "as of the bars' edge, a base column or so from the cutoff").toBeLessThan(2);
    await expect(tip).toContainText(/Status\s*As of this edge/);
  });

  // Seasonal conditioning needs six covered prior weeks. Controlled 180/1800-day sources straddle the unchanged 30-case floor.
  for (const profile of ["short seasonal", "long seasonal"])
  test(`a continuation is known at its anchor and says when its sample is below the floor (${profile})`, async ({ page, probe, fakeFor }) => {
    test.setTimeout(90000);
    const { evidenceFixture } = await import("../../tools/benchmark/evidence-fixture.mjs");
    const fake = await fakeFor(evidenceFixture(profile === "short seasonal" ? 180 : 1800));
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=30d&r=9,0&auto=0&vis=2`);
    await S.atRest(page, fake, probe);
    const layout = await layoutOf(page),
      box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.click(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
    await expect.poll(async () => (await page.locator("#ol-case-n").textContent()) !== "—", { message: "the anchored column's cases are counted", timeout: 60000 }).toBe(true);
    const time = page.locator("#ol-anchor-time");
    const cases = Number((await page.locator("#ol-case-n").textContent()).replace(/[^0-9]/g, ""));
    expect(Number.isFinite(cases)).toBe(true);
    await expect(time, "known at the anchor, the column's end").toHaveAttribute("data-known-at", /^\d+(\.\d+)?$/);
    await expect(time, "withheld exactly below 30 cases").toHaveAttribute("data-withheld", String(cases < 30));
    await expect(time).toHaveAttribute("title", cases < 30 ? /Fewer than 30 cases/ : /An empirical sample summary as it stood at the anchor, not a forecast/);
    await expect(time).toHaveAttribute("title", /^At its anchor: /);
    expect(cases < 30, `the ${profile} stream's sample is ${profile === "short seasonal" ? "under" : "over"} the floor (${cases} cases)`).toBe(profile === "short seasonal");
    // sample withholding and the counts survive: below the floor the shares are the counts of cases and the note says why; above it they are percentages
    const shares = await Promise.all(["up", "flat", "down"].map((k) => page.locator(`#ol-prob-${k}`).textContent()));
    if (profile === "short seasonal") {
      for (const share of shares) expect(share, "a count of cases, not a percentage").toMatch(/^\d+ cases$/);
      await expect(page.locator("#ol-evidence-note")).toContainText("Below 30 matches: percentages and matching boxes withheld.");
    } else {
      for (const share of shares) expect(share, "a percentage").toMatch(/^\d+%$/);
      await expect(page.locator("#ol-evidence-note")).toContainText("Empirical shares; overlapping cases, not calibrated odds.");
    }
    expect(Number((await page.locator("#ol-case-all").textContent()).replace(/[^0-9]/g, "")), "all states' count is kept beside the matched count").toBeGreaterThanOrEqual(cases);
  });
});
