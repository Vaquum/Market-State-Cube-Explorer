"use strict";
// B37 two-tone-pixels.spec.js (PRD-0002 S2, #47 section 1 and the acceptance list): the selection's two-tone boundary in COMPOSED output, over the backgrounds a
// plot really has and where it coincides with other marks.
//
// U50 does the arithmetic over every entry of the ramps; this reads pixels. For a selection made with the page's own tool the test takes the plot without it,
// then with it, and along the four edges of its rectangle (away from the corner ticks) it asks at each cross-section:
//   (1) the composed pixels across the edge are the ones the geometry gives: the background that was there, the surface-coloured backing at its coverage of
//       each pixel, the ink core at its coverage (the coverage of a stroke of width w centred at c over the pixel [j, j + 1] is the overlap of the intervals);
//   (2) a component has 3:1 contrast to the background UNDER it: the core against the pixel that was there, or the backing against it, either one (the ink
//       core is dark and the backing light, so over a dark fill the backing carries it and over a light one the core does);
//   (3) the geometry is usable in the composed output: some pixel of the cross-section, as composed, has 3:1 against the background it covers.
// And where the boundary is the same line as a Geometry cell's outline, a movement cell's stroke, an open column's cap or the Level line, the selection is
// on top of it there (the composite above) and the other mark is still there wherever the selection does not paint: its pixels outside the selection's
// footprint are as they were without the selection.
// Oracles (none is the code under test): the WCAG contrast of tests/reference/contrast.js, the coverage arithmetic written out below, the page's own pixels at
// DPR 1 with reduced motion, and the recorded operations for what the selection and the other marks paint.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const masks = require("./masks.js");
const ref = require("../reference/contrast.js");
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// The canvas rasterises with 4 subsamples down a pixel, so each side of a horizontal edge lies on a quarter pixel; across a pixel (a vertical edge) the coverage is
// exact. The coverage of the pixel [j, j + 1] by a stroke of width w centred at c is the overlap of the pixel with the interval whose ends are c - w / 2 and
// c + w / 2, on that grid.
const snap = (v, axis) => (axis === "y" ? Math.round(v * 4) / 4 : v);
const coverage = (c, w, j, axis) => Math.max(0, Math.min(snap(c + w / 2, axis), j + 1) - Math.max(snap(c - w / 2, axis), j));
const blend = (under, over, a) => under.map((u, i) => u * (1 - a) + over[i] * a);
async function pixels(page, points) {
  return page.evaluate((pts) => {
    const ctx = document.getElementById("ol-canvas").getContext("2d", { willReadFrequently: true });
    return pts.map(([x, y]) => Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)));
  }, points);
}
async function ready(page, fake, probe) {
  await probe.waitForReady({ timeout: 30000 });
}
async function open(page, fake, probe, address) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/${address}`);
  await ready(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
}
// The selection's frame as painted: the surface backing of 3.5 px and the ink core of 1.5 px on one closed rectangle.
function ringOf(frame) {
  const closed = frame.strokes.filter((k) => k.path.length === 4 && k.subs?.[0]?.[1] === 1);
  const core = closed.find((k) => k.width === 1.5 && k.stroke !== "#ffffff");
  const casing = closed.find((k) => k.width === 3.5 && JSON.stringify(k.path) === JSON.stringify(core.path));
  return { core, casing, x0: core.path[0][0], y0: core.path[0][1], x1: core.path[2][0], y1: core.path[2][1] };
}
// Cross-sections of the frame's edges: seven pixels across (the outer two are clear of the 3.5 px backing), at positions along each edge that stay clear of the corner ticks (6 px) and of each other.
function crossSections(ring, step = 9) {
  const out = [];
  const edge = (axis, c, from, to) => {
    for (let t = from + 14; t <= to - 14; t += step) {
      const along = Math.floor(t) + 0.5;
      const rows = [-3, -2, -1, 0, 1, 2, 3].map((d) => Math.floor(c) + d);
      out.push({ axis, c, rows, points: rows.map((j) => (axis === "y" ? [along, j + 0.5] : [j + 0.5, along])) });
    }
  };
  edge("y", ring.y0, ring.x0, ring.x1);
  edge("y", ring.y1, ring.x0, ring.x1);
  edge("x", ring.x0, ring.y0, ring.y1);
  edge("x", ring.x1, ring.y0, ring.y1);
  return out;
}
// Reads the plot without the selection, selects, reads the same cross-sections with it, and checks (1) to (3) at each.
async function twoToneOver(page, fake, probe, pane, { address, select, prepare = async () => {} }) {
  await open(page, fake, probe, address);
  await prepare(page);
  await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
  const noSelection = await pane.last();
  // the selection comes from the address: its rectangle is exactly what the test names
  await page.goto(`${fake.url}/${address}&sel=${select}`);
  await ready(page, fake, probe);
  await prepare(page);
  await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
  const composed = await pane.last(),
    ring = ringOf(composed),
    plot = (await layoutOf(page)).slice(0, 4),
    sections = crossSections(ring);
  const flat = sections.flatMap((s) => s.points);
  const now = await pixels(page, flat);
  // the plot without the selection, read from the page that shows it (the same address, no selection)
  await page.goto(`${fake.url}/${address}`);
  await ready(page, fake, probe);
  await prepare(page);
  await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
  const was = await pixels(page, flat);
  const without = await pane.last();
  const ink = rgb(ring.core.stroke),
    surface = rgb(ring.casing.stroke);
  const problems = [];
  let at = 0,
    worst = Infinity,
    changedUnder = 0;
  const covered = [];
  for (const s of sections) {
    const nowRow = now.slice(at, at + 7),
      wasRow = was.slice(at, at + 7);
    at += 7;
    // a cell the selection's edge cuts is painted again inside it with the part the rectangle holds (observed amounts): where that changes what lies under
    // the boundary the background is the cell's repaint, which is judged by place elsewhere (B35), so the section is counted and left out
    const clear = s.rows.map((j, k) => [j, k]).filter(([j]) => coverage(s.c, ring.casing.width, j, s.axis) === 0).map(([, k]) => k);
    const outer = clear.some((k) => nowRow[k].some((v, ch) => Math.abs(v - wasRow[k][ch]) > 2));
    if (outer) {
      changedUnder++;
      continue;
    }
    // (1) the composed pixels are the geometry's
    s.rows.forEach((j, k) => {
      // the frame is painted under the plot's clip: a pixel outside the plot is the page's, whatever the frame's geometry says
      const [px, py] = s.points[k];
      const inPlot = px >= plot[0] && px <= plot[0] + plot[2] && py >= plot[1] && py <= plot[1] + plot[3];
      const want = inPlot ? blend(blend(wasRow[k], surface, coverage(s.c, ring.casing.width, j, s.axis)), ink, coverage(s.c, ring.core.width, j, s.axis)) : wasRow[k];
      // (4 of 255, as the other pixel tests allow: the selection's frame is a path, rasterised with its coverage quantised, so a pixel at a fractional edge is within a few
      // levels of the exact blend; a coverage wrong by a sixteenth would move it by 12 or more. A cell the selection's edge cuts used to be painted twice there and its
      // stacked edge pixel put such a section among those left out above; each pixel is painted once now and the section is judged.)
      for (let ch = 0; ch < 3; ch++) if (Math.abs(nowRow[k][ch] - want[ch]) > 4) problems.push(`${s.axis} edge ${s.c} pixel ${j} ch ${ch}: ${nowRow[k][ch]} against ${want[ch].toFixed(1)} from the geometry`);
    });
    // (2) a component has 3:1 against the background under it (the pixel at the centre line, as it was without the selection)
    const under = wasRow[3];
    const coreRatio = ref.contrast(ink, under),
      casingRatio = ref.contrast(surface, under);
    // (3) the composed output has a pixel of 3:1 against what it covers
    const usable = Math.max(...nowRow.map((p, k) => ref.contrast(p.map(Math.round), wasRow[k].map(Math.round))));
    const edgeOnPlot = s.points.some(([px, py]) => !(px >= plot[0] && px <= plot[0] + plot[2] && py >= plot[1] && py <= plot[1] + plot[3]));
    worst = Math.min(worst, Math.max(coreRatio, casingRatio));
    if (Math.max(coreRatio, casingRatio) < 3) problems.push(`${s.axis} edge ${s.c} over ${under}: core ${coreRatio.toFixed(2)}, backing ${casingRatio.toFixed(2)}`);
    if (usable < 3 && !edgeOnPlot) problems.push(`${s.axis} edge ${s.c} over ${under}: no composed pixel reaches 3:1 (best ${usable.toFixed(2)})`);
    covered.push(under.join(","));
  }
  return { problems, worst, backgrounds: new Set(covered), sections: sections.length, changedUnder, ring, composed, noSelection: without, pixelsWithout: (pts) => pixels(page, pts), pixelsWith: null };
}

const VIEW = "#t=2026-09-23T00:00Z~2026-09-24T12:00Z&p=22000~23500&r=7,0&vis=2";

test.describe("B37 the two-tone boundary over the backgrounds a plot has", () => {
  test("over fills of many values and empty cells: the composed pixels are the geometry's, with 3:1 through one component and a usable pixel", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    const out = await twoToneOver(page, fake, probe, pane, { address: VIEW, select: "2026-09-23T08:00Z~2026-09-24T08:00Z,22250~22875" });
    expect(out.problems, "cross-sections that fail").toEqual([]);
    expect(out.sections, "cross-sections were read").toBeGreaterThan(60);
    expect(out.changedUnder, "few sections lie over a cut cell's repaint").toBeLessThan(out.sections * 0.25);
    expect(out.backgrounds.size, "the boundary crosses several different backgrounds").toBeGreaterThan(5);
    console.log(`two-tone: ${out.sections} cross-sections (${out.changedUnder} over cut cells' repaint, left out) over ${out.backgrounds.size} backgrounds, the weakest has ${out.worst.toFixed(2)}:1 through its better component`);
  });

  test("over the hatch of a future that replay hides, and across its edge", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    const out = await twoToneOver(page, fake, probe, pane, { address: `${VIEW}&replay=1&at=2026-09-24T00:00Z`, select: "2026-09-23T12:00Z~2026-09-24T09:00Z,22125~23250" });
    expect(out.problems, "cross-sections that fail").toEqual([]);
    expect(out.backgrounds.size, "fills, empty cells and the hatch").toBeGreaterThan(4);
    console.log(`two-tone over the hatch: ${out.sections} cross-sections over ${out.backgrounds.size} backgrounds, the weakest ${out.worst.toFixed(2)}:1`);
  });
});

// ---- where the boundary is the same line as another mark ----------------------------------------------------------------

// Points along the footprints of the other mark's operations (a pixel centre every `step` px), outside the selection's own footprint: wherever the selection
// does not paint, the other mark must be as it was without the selection.
function pointsAlong(ops, ringOps, painted, step = 10) {
  const out = [];
  // a point is kept when the selection does not paint it and nothing else is painted over the mark there, in either frame (the column POCs, which a selection
  // draws for its own rectangle only, cross some outlines)
  // another mark painted on or beside this one in either frame (the column POCs and their halos, which a selection draws for its own rectangle only, cross
  // some of them) puts the pixel in that mark's hands too: such a point is not compared
  // (a rectangle drawn as a stroke, another cell's outline or a movement mark, is not such a mark: the cells' outlines sit side by side)
  const isRect = (o) => o.kind === "ring" || (o.segs && o.segs.length === 4 && o.segs.every((q) => q[0] === q[2] || q[1] === q[3]));
  const keep = (x, y) => !ringOps.some((o) => masks.covers(o, x, y, 2.5)) && !painted.some((all) => all.some((o) => !isRect(o) && o.kind !== "rect" && !ops.some((m) => m.key === o.key) && masks.covers(o, x, y, 2)));
  for (const o of ops) {
    const segs = o.segs ?? (o.box ? [[o.box[0], (o.box[1] + o.box[3]) / 2, o.box[2], (o.box[1] + o.box[3]) / 2]] : []);
    for (const [x0, y0, x1, y1] of segs) {
      const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 0; k <= n; k++) {
        const x = Math.floor(x0 + ((x1 - x0) * k) / n) + 0.5,
          y = Math.floor(y0 + ((y1 - y0) * k) / n) + 0.5;
        if (keep(x, y)) out.push([x, y]);
      }
    }
  }
  return out;
}
async function coincident(page, fake, probe, pane, options) {
  const out = await twoToneOver(page, fake, probe, pane, options);
  expect(out.problems, "the selection is on top of the other mark: the composed pixels across its edge are its geometry's over what was there").toEqual([]);
  // the selection's own marks: its backing and core on the rectangle and its corner ticks, which are drawn last
  const ringOps = masks.opsOf(out.composed).filter((o) => o.segs && (o.width === 3.5 || o.width === 1.5) && o.seq >= out.ring.casing.seq);
  const others = options.other(out.noSelection);
  const points = pointsAlong(others, ringOps, [masks.opsOf(out.noSelection), masks.opsOf(out.composed)]);
  expect(points.length, "the other mark has pixels the selection does not paint").toBeGreaterThan(options.least ?? 10);
  const was = await out.pixelsWithout(points);
  return { out, points, was };
}

test.describe("B37 the boundary where it is the same line as another mark", () => {
  test("a Geometry cell's outline: the selection is over it, and the outlines of the other cells are as they were", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    const address = `${VIEW}&mode=geometry`;
    const { out, points, was } = await coincident(page, fake, probe, pane, {
      address,
      select: "2026-09-23T10:00Z~2026-09-24T06:00Z,22250~22875",
      other: (frame) => masks.opsOf(frame).filter((o) => o.kind === "ring" && o.width === 1 && o.segs.length === 4),
      least: 20,
    });
    // read the same points with the selection on
    await page.goto(`${fake.url}/${address}&sel=2026-09-23T10:00Z~2026-09-24T06:00Z,22250~22875`);
    await ready(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
    const now = await pixels(page, points);
    const { x0, y0, x1, y1 } = out.ring;
    const inside = (p) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1;
    // outside the rectangle nothing is painted twice: the outlines are as they were. Inside it the page paints the whole block's cells and then the rectangle's
    // again, so a 1 px outline of the occupancy ink is laid on itself there and reads bolder; it is never lighter, and never gone.
    const outsideChanged = points.filter((p, i) => !inside(p) && now[i].some((v, ch) => Math.abs(v - was[i][ch]) > 2));
    expect(outsideChanged, "an outline pixel outside the selection changed").toEqual([]);
    const lighter = points.filter((p, i) => inside(p) && now[i].reduce((a, v) => a + v, 0) > was[i].reduce((a, v) => a + v, 0) + 6);
    expect(lighter, "an outline pixel inside the selection is lighter than it was").toEqual([]);
    const outside = points.filter((p) => !inside(p)).length;
    expect(outside, "outline pixels outside the selection were compared").toBeGreaterThan(10);
    console.log(`two-tone over Geometry: ${out.sections} cross-sections, ${outside} outline pixels outside the rectangle unchanged, ${points.length - outside} inside it as dark or darker`);
  });

  test("a movement cell's stroke: the selection is over it, and the strokes of the other cells are as they were", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("micro:paths");
    const address = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24750~25500&r=0,0&mode=path&vis=2";
    // the rectangle is the column 2 of the fixture, rows 199 to 202: four movement-only cells stacked, its left and right edges their sides
    const select = "2021-01-01T00:01:52.500Z~2021-01-01T00:02:48.750Z,24875~25375";
    const { out, points, was } = await coincident(page, fake, probe, pane, {
      address,
      select,
      other: (frame) => masks.opsOf(frame).filter((o) => o.kind === "ring" && o.width === 1.5),
      least: 20,
    });
    await page.goto(`${fake.url}/${address}&sel=${select}`);
    await ready(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
    const now = await pixels(page, points);
    const { x0, y0, x1, y1 } = out.ring;
    const inside = (p) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1;
    const changedOutside = points.filter((p, i) => !inside(p) && now[i].some((v, ch) => Math.abs(v - was[i][ch]) > 2));
    expect(changedOutside, "a stroke pixel outside the selection changed").toEqual([]);
    // inside it the cells are painted again, but a movement mark paints its opaque interior first, so the stroke is laid down as it was
    const changedInside = points.filter((p, i) => inside(p) && now[i].some((v, ch) => Math.abs(v - was[i][ch]) > 2));
    expect(changedInside, "a movement stroke inside the selection changed").toEqual([]);
    console.log(`two-tone over movement strokes: ${out.sections} cross-sections, ${points.length} stroke pixels unchanged`);
  });

  test("an open column's cap: the selection's top edge is the plot's top, over the cap, and the cap is still painted and keyed", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    // a view that reaches past the cutoff, at 1 h columns: the column that holds the cutoff is open and carries the cap
    const out = await twoToneOver(page, fake, probe, pane, { address: "#t=2026-09-24T00:00Z~2026-09-24T12:30Z&p=22000~23500&r=6,0&vis=2", select: "2026-09-24T06:00Z~2026-09-24T12:02Z,22250~23500" });
    expect(out.problems, "the boundary is on top of the cap: the composed pixels across its edge are its geometry's over what was there").toEqual([]);
    const caps = (frame) => masks.opsOf(frame).filter((o) => o.kind === "rect" && Math.abs(o.box[3] - o.box[1] - 1.5) < 1e-9 && o.alpha === 1 && o.box[1] === out.ring.y0);
    expect(caps(out.composed).length, "the cap is painted with the selection on").toBeGreaterThan(0);
    expect(caps(out.noSelection).length, "and without it").toBeGreaterThan(0);
    expect(out.ring.y0, "the selection's top edge is the plot's top, where the cap is").toBeCloseTo(caps(out.composed)[0].box[1], 0);
    await expect(page.locator("#ol-key-open"), "the key of the open column's cap").toBeVisible();
    console.log(`two-tone over the open cap: ${out.sections} cross-sections`);
  });

  test("the Level line: the selection's bottom edge is its price, over it, and the line is as it was outside the selection", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    const select = "2026-09-23T14:00Z~2026-09-24T06:00Z,22250~22562.5";
    const level = async (p) => {
      // X puts the line on the centre of the price row under the pointer: the row 22500 to 22625 is centred on 22562.5
      const layout = await layoutOf(p),
        box = await p.locator("#ol-canvas").boundingBox();
      await p.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + ((23500 - 22562.5) / 1500) * layout[3]);
      await p.keyboard.press("x");
      await p.mouse.move(box.x + 5, box.y + box.height - 5);
    };
    const { out, points, was } = await coincident(page, fake, probe, pane, {
      address: VIEW,
      select,
      prepare: level,
      other: (frame) => masks.opsOf(frame).filter((o) => o.kind === "stroke" && o.key.includes("[8,3,2,3]") && o.segs.length === 1),
      least: 15,
    });
    await page.goto(`${fake.url}/${VIEW}&sel=${select}`);
    await ready(page, fake, probe);
    await level(page);
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
    const now = await pixels(page, points);
    const changed = points.filter((p, i) => now[i].some((v, ch) => Math.abs(v - was[i][ch]) > 2));
    expect(changed, "a pixel of the Level line outside the selection's boundary changed").toEqual([]);
    console.log(`two-tone over the Level line: ${out.sections} cross-sections, ${points.length} pixels of the line unchanged`);
  });
});
