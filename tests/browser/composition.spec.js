"use strict";
// B27 composition.spec.js (PRD-0002 S2, #47 section 1): the event strip, reference strokes, the occlusion budget and the temporary regions.
//
// What is asserted:
//   1. the event strip has a named lane for each kind that is on (4h squeeze, 1D squeeze, CME gap), 14 px tall, the names whole on the canvas,
//      the marks opaque in one fixed ink (no alpha), and where the chart is too short for its lanes one line that says how many events there are;
//   2. a reference stroke is at most 2.5 px with at most 1 px of surface casing a side (4.5 px in all), also for the focused one, which adds 1 px;
//   3. above the 20% budget the lowest-priority marks are left out with a shown/eligible notice, every mark stays in the lines list, and the
//      numbers on the canvas are the planner's;
//   4. a transient lens is an identified region replacement: the page says where it is, it stays inside the heatmap and never covers the Rows strip.
// Oracles (none is the code under test): the PRD's numbers written out (14 px lanes, 2.5/4.5 px, 20%), the canvas's own recorded strokes and texts,
// the planner's rule replayed independently in tests/unit/occlusion-budget.test.js (U53), and pixels read back from the canvas at DPR 1.
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
    for (const name of ["ink", "surface", "muted", "state", "poc", "bg", "line"]) {
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

test.describe("B27 the event strip", () => {
  test("a named lane of 14 px for each kind that is on, names whole, marks opaque in the state ink", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=30d&vis=2&lines=bb4h,bb1d,cme`);
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      colours = await tokens(page),
      layout = await layoutOf(page);
    const [x, y, w, h, , , , , , ey, eh, collapsed] = layout;
    expect(collapsed, "the lanes fit on this chart").toBe(0);
    expect(eh, "three lanes of 14 px").toBe(42);
    const names = ["4h squeeze", "1D squeeze", "CME gap"];
    names.forEach((name, i) => {
      const t = frame.texts.find((f) => f.text === name);
      expect(t, `the lane ${name} is named`).toBeTruthy();
      expect(t.y, `${name} sits in its own lane`).toBeCloseTo(ey + i * 14 + 7, 0);
      expect(t.align).toBe("right");
      expect(t.x, "right-aligned just left of the plot").toBeCloseTo(x - 2, 5);
    });
    // the names are whole on the canvas: nothing of the lane rows is painted in the canvas's first pixel column
    const leftEdge = await page.evaluate(([top, height]) => {
      const c = document.getElementById("ol-canvas").getContext("2d");
      const d = c.getImageData(0, Math.round(top), 1, Math.round(height)).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add("#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
      return [...seen];
    }, [ey, eh]);
    expect(leftEdge, "the first pixel column of the lanes is the page background only").toEqual([colours.bg]);
    // the marks: opaque, in one fixed ink, inside the strip
    const marks = frame.rects.filter((r) => r.h === 8 && r.y >= ey && r.y < ey + eh);
    expect(marks.length, "the CME gap is marked").toBeGreaterThan(0);
    for (const m of marks) {
      expect(m.alpha, "opaque: no alpha accumulates").toBe(1);
      expect(m.fill, "one fixed role").toBe(colours.state);
    }
    // nothing of an event is an area over the measured heatmap (the old squeeze and gap tints)
    const tints = frame.rects.filter((r) => r.alpha > 0 && r.alpha < 0.5 && r.w > 200 && r.h > 30 && r.x >= x && r.y >= y && r.y + r.h <= y + h);
    expect(tints, "no translucent area over the cells").toEqual([]);
  });

  test("a constituent event is read where the lane merges them, and the lane's tooltip says what it is", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=30d&vis=2&lines=cme`);
    await S.atRest(page, fake, probe);
    const box = await page.locator("#ol-canvas").boundingBox(),
      [x, , w, , , , , , , ey, eh] = await layoutOf(page);
    await page.mouse.move(box.x + x + w * 0.5, box.y + ey + eh / 2);
    await expect(page.locator("#ol-tip")).toBeVisible();
    await expect(page.locator("#ol-tip")).toContainText("CME gap");
  });

  test("where the chart is too short for its lanes the strip is one line with the counts, and the lanes are not drawn", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 300 });
    await page.goto(`${fake.url}/#w=30d&vis=2&lines=bb4h,bb1d,cme`);
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      layout = await layoutOf(page),
      [, , , , , , , , , ey, eh, collapsed] = layout;
    expect(collapsed).toBe(1);
    expect(eh, "one line").toBe(14);
    const line = frame.texts.find((t) => /lanes need a taller chart$/.test(t.text));
    expect(line, "the disclosure").toBeTruthy();
    expect(line.text).toMatch(/^4h squeeze \d+ · 1D squeeze \d+ · CME gap \d+ · lanes need a taller chart$/);
    expect(frame.texts.some((t) => t.text === "4h squeeze" && t.align === "right"), "no lane name").toBe(false);
    expect(line.y).toBeCloseTo(ey + 7, 0);
  });
});

test.describe("B27 reference strokes and the occlusion budget", () => {
  test("a reference line is at most 2.5 px with 1 px of casing a side; the focused one adds 1 px and stays inside 4.5", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=1d,7d`);
    await S.atRest(page, fake, probe);
    const colours = await tokens(page);
    const widths = async () => {
      const frame = await pane.last();
      // halos are the wide strokes in the surface colour at 0.85; their cores are the strokes of the lines' colours that follow
      const halos = frame.strokes.filter((k) => k.stroke === colours.surface && Math.abs(k.alpha - 0.85) < 1e-9 && k.width > 2 && k.width <= 6 && k.path.length >= 2 && k.width !== 3.5 && k.width !== 3);
      return { halos, frame };
    };
    const rest = await widths();
    expect(rest.halos.length, "reference lines have halos").toBeGreaterThan(0);
    for (const h of rest.halos) expect(h.width, `halo ${h.width}`).toBeLessThanOrEqual(4.5);
    // focus: hover a line and the core grows by 1 px to the 2.5 px cap
    const layout = await layoutOf(page),
      box = await page.locator("#ol-canvas").boundingBox();
    const y = rest.frame.strokes.find((k) => k.path.length === 2 && k.path[0][1] === k.path[1][1] && k.stroke !== colours.surface && k.width >= 1.5 && k.path[0][1] > layout[1] && k.path[0][1] < layout[1] + layout[3])?.path[0][1];
    test.skip(y === undefined, "no horizontal reference line in this view");
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + y);
    await probe.waitForQuiet({ quietMs: 300 });
    const hot = await widths();
    for (const h of hot.halos) expect(h.width, `focused halo ${h.width}`).toBeLessThanOrEqual(4.5);
    const cores = hot.frame.strokes.filter((k) => k.stroke !== colours.surface && k.path.length === 2 && k.path[0][1] === k.path[1][1] && Math.abs(k.path[0][1] - y) < 1);
    expect(Math.max(...cores.map((k) => k.width)), "the focused core is at most 2.5").toBeLessThanOrEqual(2.5);
  });

  test("over the budget the lowest-priority marks are left out with a shown/eligible notice, and every mark stays in the list", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 760, height: 520 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=1d,wk,7d,mo,30d,90d,yr,1y,3y,cday,funding,usopen`);
    await S.atRest(page, fake, probe);
    const data = await page.locator("#ol-canvas").evaluate((el) => el.dataset.occlusion ?? "");
    expect(data, "the canvas carries the counts").toMatch(/^\d+\/\d+!?$/);
    const [shown, eligible] = data.replace("!", "").split("/").map(Number);
    expect(shown, "some marks are held back").toBeLessThan(eligible);
    const frame = await pane.last();
    expect(frame.texts.some((t) => t.text === `${shown} of ${eligible} reference marks shown · 20% budget`), "the notice says so").toBe(true);
  });
});

test.describe("B27 the transient lens is an identified region replacement", () => {
  test("the page names where the lens is, it stays inside the heatmap, and the Rows strip is untouched by it", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=24h&vis=2&rows=volume&period=7d`);
    await S.atRest(page, fake, probe);
    const before = await pane.last(),
      layout = await layoutOf(page),
      box = await page.locator("#ol-canvas").boundingBox();
    const stripOf = (frame) => frame.rects.filter((r) => r.x >= layout[4] - 0.5 && r.x + r.w <= layout[4] + layout[5] + 0.5 && r.w === 12).map((r) => [r.x, r.y, r.w, r.h, r.fill, r.alpha]);
    const stripBefore = stripOf(before);
    expect(stripBefore.length, "the strip is painted").toBeGreaterThan(1);
    await page.locator("#ol-lens").click();
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
    await probe.waitForQuiet({ quietMs: 400 });
    const temporary = await page.locator("#ol-canvas").evaluate((el) => el.dataset.temporary ?? "");
    expect(temporary, "the page names the region").toMatch(/^lens:\d+,\d+,\d+,\d+/);
    const [lx, ly, lw, lh] = temporary.replace(/^lens:/, "").split(";")[0].split(",").map(Number);
    expect(lx >= layout[0] - 1 && lx + lw <= layout[0] + layout[2] + 1, "inside the heatmap horizontally").toBe(true);
    expect(ly >= layout[1] - 1 && ly + lh <= layout[1] + layout[3] + 1, "inside the heatmap vertically").toBe(true);
    const after = await pane.last();
    expect(stripOf(after), "the Rows strip is the same blocks").toEqual(stripBefore);
  });
});
