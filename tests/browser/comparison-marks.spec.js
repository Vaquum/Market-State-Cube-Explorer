"use strict";
// B41 comparison-marks.spec.js (PRD-0002 S3, #48 section 1): the historical comparison is neutral, and its two sets are told apart by shape and by words.
//
// What is asserted, on the standard fake cube with a column anchored (an empirical sample far over the floor of 30):
//   1. no mark of the chart is drawn in the violet of the retired evidence token (#7664a9 and #b4a1df): the cone's boxes and medians, the anchor line and
//      the label use the neutral comparison hue (the muted ink of the page), the same hue as the Lines menu's neutral family;
//   2. the matching states' median is marked by a filled square and all states' by a ring, one pair at each horizon that has a sample of 30 or more, and
//      the two sets are named in words beside the last box: "Matching states" and "All states";
//   3. the inspector's legend carries the same two shapes (a square, a ring) beside the same words, and its outcome tracks are the neutral hue, not a violet;
//   4. the anchor line is dashed [3,4] in the comparison hue, one pixel wide, behind nothing else of the family.
// Oracles (none is the code under test): the design tokens read back through a canvas, the hexes of the retired token written out here, the marker
// geometry of the PRD (a square and a ring, 6 px across), and the computed style of the legend's keys.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const RETIRED_VIOLET = ["#7664a9", "#b4a1df"];

test.describe("B41 the historical comparison is neutral: a square for the matching states, a ring for all states", () => {
  test("the cone, its medians, its anchor line and its legend use the neutral hue and the two shapes", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await S.atRest(page, fake, probe);
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.keyboard.press("c");
    // anchor a column of the plot: a click with the Pan tool
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await expect.poll(async () => (await page.locator("#ol-case-n").textContent()) !== "—", { message: "the anchored column's cases are counted", timeout: 60000 }).toBe(true);
    const cases = Number((await page.locator("#ol-case-n").textContent()).replace(/[^0-9]/g, ""));
    expect(cases, "a sample over the floor, so the matching boxes are drawn").toBeGreaterThanOrEqual(30);
    await page.mouse.move(box.x + 3, box.y + 3);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const c = await pane.colours();
    await expect
      .poll(async () => (await pane.last()).strokeRects.filter((r) => r.stroke === c.compare).length, { message: "the cone's boxes are drawn in the comparison hue", timeout: 60000 })
      .toBeGreaterThan(0);
    const frame = await pane.last();
    // 1. nothing of the retired violet anywhere in the frame
    const colours = new Set([
      ...frame.rects.map((r) => r.fill),
      ...frame.strokeRects.map((r) => r.stroke),
      ...frame.strokes.map((k) => k.stroke),
      ...frame.fills.map((f) => f.fill),
      ...frame.texts.map((t) => t.fill),
    ]);
    for (const violet of RETIRED_VIOLET) expect(colours.has(violet), `${violet} is not drawn`).toBe(false);
    expect(c.compare, "the comparison hue is the muted ink of the page, a neutral").not.toBe(c.line);
    // 2. the shapes: filled squares for the matching states and rings for all states, 6 px across; the casing under each is the surface
    const squares = frame.fills.filter((f) => f.fill === c.compare && f.path.length === 4 && Math.abs(Math.max(...f.path.map((p) => p[0])) - Math.min(...f.path.map((p) => p[0])) - 6) < 1e-6);
    const rings = frame.arcs.filter((a) => a.r === 3);
    expect(squares.length, "a square median for each matching set shown").toBeGreaterThan(0);
    expect(rings.length, "a ring median for each all-states set shown").toBeGreaterThanOrEqual(squares.length);
    const words = frame.texts.map((t) => t.text);
    expect(words.includes("Matching states") && words.includes("All states"), "the two sets are named").toBe(true);
    // 4. the anchor line: dashed [3,4], one pixel, in the comparison hue, the full height of the plot
    const anchors = frame.strokes.filter((k) => k.stroke === c.compare && JSON.stringify(k.dash) === JSON.stringify([3, 4]) && k.width === 1 && k.path.length === 2 && k.path[0][0] === k.path[1][0]);
    expect(anchors.length, "the anchor's dashed line").toBe(1);
    // 3. the inspector: the legend's keys are a square and a ring, its tracks the neutral hue
    const shapes = await page.evaluate(() => {
      const after = (sel) => {
        const s = getComputedStyle(document.querySelector(sel), "::after");
        return { width: s.width, radius: s.borderTopLeftRadius };
      };
      const hex = (css) => {
        const scratch = document.createElement("canvas").getContext("2d");
        scratch.fillStyle = "#000000";
        scratch.fillStyle = css;
        return scratch.fillStyle;
      };
      return {
        match: after(".ol-evidence-legend .ol-match-key"),
        all: after(".ol-evidence-legend .ol-all-key"),
        track: hex(getComputedStyle(document.getElementById("ol-bar-up")).backgroundColor),
      };
    });
    expect(shapes.match.width, "the matching key's square is 7 px across").toBe("7px");
    expect(shapes.match.radius, "with square corners").toBe("0px");
    expect(shapes.all.width).toBe("7px");
    expect(shapes.all.radius, "the all-states key is a ring").toBe("50%");
    expect(shapes.track, "the outcome track is the neutral hue").toBe(c.compare);
    await expect(page.locator(".ol-evidence-legend")).toContainText("Matching states");
    await expect(page.locator(".ol-evidence-legend")).toContainText("All seasonally eligible states");
  });
});
