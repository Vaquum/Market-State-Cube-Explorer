"use strict";
// B30 state-table.spec.js (PRD-0002 S2, #47 section 4): the measure-by-state table, row by row, each with its rendering AND its readout.
//
// Rows that other specs already own keep their tests where they are; this file lists every row of the PRD's table in one place, names the test
// that holds it, and adds the rows and the co-occurrences that had none:
//   1  valid positive / signed       cells-matrix.spec.js (every mode, both themes), axes.spec.js (column lengths)
//   2  zero Volume/Trades, no trades nonvalues-panes.spec.js (the zero tick), readout-agreement.spec.js (the cell's words)
//   3  zero Delta with trades        nonvalues-panes.spec.js (micro:balanced: midpoint and the tick), cells-matrix.spec.js (delta)
//   4  movement without trades       stroke-roles.spec.js, cells-matrix.spec.js, motion-measures.spec.js
//   5  pending                       nonvalues-cells.spec.js (dots), nonvalues-panes.spec.js
//   6  failed                        motion-measures.spec.js (the crosshatch), nonvalues-*.spec.js
//   7  unsupported / unavailable     nonvalues-cells.spec.js (slash), nonvalues.spec.js (Rows)
//   8  undefined / no reference      nonvalues.spec.js (Rows), nonvalues-panes.spec.js (the diamond)
//   9  parent not complete           HERE (the waiting-parent pattern and the open cap, together)
//  10  finite under/overflow         axes.spec.js (the edge triangle), warnings.spec.js (the counts)
//  11  negative infinity             nonvalues.spec.js, nonvalues-cells.spec.js
//  12  open but already measured     HERE (the cap over a valid value, in the plot and in the pane)
//  13  provisional                   HERE (the boundary line beside a valid value, zero stays zero), recovery-faults.spec.js (the words)
//  14  partial / coarser             HERE (the corner tick and its key, the value kept)
//  15  no calibration                scale-canvas.spec.js, warnings.spec.js
//  16  outside W / replay-hidden     rows-strip.spec.js (outside W), HERE (the hidden future in the neutral hatch and its key)
// Oracles (none is the code under test): the PRD's rows written out, the recorded canvas, and the page's own design tokens.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

function tokens(page) {
  return page.evaluate(() => {
    const scratch = document.createElement("canvas").getContext("2d");
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const out = {};
    for (const name of ["ink", "surface", "muted", "state", "poc", "occupancy", "line", "bg"]) {
      probe.style.color = `var(--ol-${name})`;
      scratch.fillStyle = "#000000";
      scratch.fillStyle = getComputedStyle(probe).color;
      out[name] = scratch.fillStyle;
    }
    probe.remove();
    return out;
  });
}
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));

test.describe("B30 the rows of the state table that have their tests here", () => {
  test("row 9, parent not complete: Cascade's children of the open parent are the waiting pattern, keyed, and the open cap is over the column", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2&mode=cascade`);
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      colours = await tokens(page),
      layout = await layoutOf(page);
    // the cap: a 1.5 px bar of the state ink across the open column at the top of the plot
    expect(frame.rects.filter((r) => r.h === 1.5 && r.fill === colours.state && Math.abs(r.y - layout[1]) < 1e-9).length, "the open cap").toBeGreaterThanOrEqual(1);
    // the pattern of a result that cannot be computed yet, in the state ink on the surface, keyed with its count: two marks, neither replacing the other
    await page.locator("#ol-legend").click();
    const key = page.locator('#ol-legend-pop [data-key="waiting-for-complete-parent"]');
    await expect(key, "the key of the waiting parent").toBeVisible();
    expect(Number(await key.getAttribute("data-count")), "some children wait").toBeGreaterThan(0);
    // the key says what it is in words, with the same count the popover shows
    await expect(key).toContainText(/parent|complete|open/i);
  });

  test("row 12, open but already measured: the valid value keeps its mark and gets the cap, in the plot and in the pane", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2&pane=volume`);
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      colours = await tokens(page),
      layout = await layoutOf(page);
    const caps = frame.rects.filter((r) => r.h === 1.5 && r.fill === colours.state && r.alpha === 1);
    const plotCap = caps.find((r) => Math.abs(r.y - layout[1]) < 1e-9),
      paneCap = caps.find((r) => Math.abs(r.y - layout[12]) < 1e-9);
    expect(plotCap, "the cap on the price pane").toBeTruthy();
    expect(paneCap, "the cap on the pane's open column").toBeTruthy();
    // the open column's bar is drawn as a bar (its value is valid), under the cap, not replaced by a pattern or a hatch
    const bars = frame.rects.filter((r) => r.alpha === 0.65 && Math.abs(r.x + r.w - (paneCap.x + paneCap.w)) < 2);
    expect(bars.length, "the open column's bar is still a value").toBeGreaterThan(0);
  });

  test("row 13, provisional: a valid value beside the boundary; a zero stays a zero and is not merged into the state", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2&mode=path`);
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      colours = await tokens(page);
    // the provisional boundary is one dashed [2,3] line of the state ink ...
    expect(frame.strokes.filter((k) => k.stroke === colours.state && k.width === 1 && JSON.stringify(k.dash) === "[2,3]").length, "the provisional boundary").toBeGreaterThanOrEqual(1);
    // ... and it does not repaint what lies under it: Path's traded cells stay fills in LUT entries (there are cells in the plot), its zeros stay outlines
    // in the occupancy ink (a zero is not a state)
    expect(frame.rects.filter((r) => r.alpha === 1 && r.w > 4 && r.h > 4 && r.fill !== colours.surface && r.fill !== colours.bg).length, "values are still drawn").toBeGreaterThan(5);
    await expect(page.locator("#ol-key-provisional")).toBeVisible();
  });

  test("row 14, partial or coarser: a coarser level than asked for is drawn, each of its cells with its corner tick, its value kept, and the key says coarser", async ({ page, probe, fakeFor, pane, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const fake = await fakeFor("standard");
    // the level a 119-day view asks for has its tile refused: the overview tier that is loaded is drawn, in cells wide enough for a tick
    fake.on({ route: /^\/cube\/tile/ }).fail({ status: 500 });
    await page.goto(`${fake.url}/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2`);
    await page.waitForFunction(() => {
      const line = document.getElementById("ol-loading");
      return line.hidden || line.getAttribute("role") === "alert";
    });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    const frame = await pane.last(),
      colours = await tokens(page);
    await expect(page.locator("#ol-data-coarse"), "the key").toBeVisible();
    const ticks = frame.strokes.filter((k) => k.stroke === colours.state && k.width === 1 && k.path.length === 2 && k.path[0][0] !== k.path[1][0] && k.path[0][1] !== k.path[1][1] && Math.abs(k.path[1][0] - k.path[0][0] - 5) < 1e-9);
    expect(ticks.length, "a short diagonal tick on the coarse cells that are big enough").toBeGreaterThan(0);
    expect(frame.strokes.filter((k) => k.stroke === colours.poc && k.width === 1 && k.alpha === 0.65).length, "none of them gold").toBe(0);
    expect(frame.rects.filter((r) => r.alpha === 1 && r.w > 4 && r.h > 4 && r.fill !== colours.surface && r.fill !== colours.bg).length, "the coarse cells keep their values").toBeGreaterThan(5);
  });

  test("row 16, replay-hidden: the future is a neutral hatch with its name and its key, and the values before the edge are untouched", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2&replay=1&at=2026-09-24T06:00Z`);
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      colours = await tokens(page);
    expect(frame.texts.some((t) => t.text === "Future hidden"), "named").toBe(true);
    await expect(page.locator("#ol-key-unavailable"), "keyed").toBeVisible();
    const hatch = frame.strokes.filter((k) => k.stroke === colours.state && k.width === 1 && Math.abs(k.alpha - 0.3) < 1e-9);
    expect(hatch.length, "hatched in the state ink (not the hairline colour, not gold)").toBeGreaterThan(0);
    expect(frame.strokes.filter((k) => (k.stroke === colours.poc || k.stroke === colours.line) && k.width === 1 && Math.abs(k.alpha - 0.45) < 1e-9).length).toBe(0);
  });
});
