"use strict";
// B36 movement-cores.spec.js (PRD-0002 S2, #47 acceptance): the cores of the quantitative movement strokes, asserted apart from the fills and not masked out.
//
// A cell the price only moved through has no trades, so its value is carried by ONE thing: a stroke of 1.5 px in the value's colour on a neutral interior,
// with a backing of 3.5 px of the surface colour under it. That stroke is the only carrier of the number, so it is never masked out of a test. At DPR 1 a
// 1.5 px line centred on a whole pixel line covers three quarters of each of the two pixels it lies across, so no pixel holds the colour itself: the test
// says what each pixel across an edge must hold from the geometry (coverage of the core, coverage of the backing, the interior) and compares the page's pixel
// with it, for every movement mark of the fixture and each of its four sides, and then shows the same pixels unchanged under a selection and an anchor.
// Oracles (none is the code under test): the hand-computed paths fixture (which cells are movement-only, and how many), the pinned LUT's entries (what colour
// a value is), the coverage arithmetic written out below (a stroke of width w centred at c covers a pixel [j, j+1] by the length of the overlap), and the
// pixels of the canvas read back at DPR 1.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const masks = require("./masks.js");
const fs = require("node:fs");
const path = require("node:path");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "trades", "paths.json"), "utf8"));
const MOVEMENT_ONLY = fixture.expected.motion["0:0"].filter((z) => z.ct === 0 && z.p > 0);
const ADDRESS = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24750~25500&r=0,0&mode=path&vis=2";

async function open(page, fake, probe) {
  // reduced motion: no morph frame can be the one captured
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/${ADDRESS}`);
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 600, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
async function pixels(page, points) {
  return page.evaluate((pts) => {
    const ctx = document.getElementById("ol-canvas").getContext("2d", { willReadFrequently: true });
    return pts.map(([x, y]) => Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3)));
  }, points);
}
// The movement marks of a frame: a surface casing of 3.5 px and an ink-free core of 1.5 px on one rectangle (stroke rectangles drawn together).
function marksOf(frame) {
  const key = (r) => [r.x, r.y, r.w, r.h].join(":");
  const casings = new Map(frame.strokeRects.filter((r) => r.width === 3.5 && r.stroke === "#ffffff").map((r) => [key(r), r]));
  return frame.strokeRects.filter((r) => r.width === 1.5 && casings.has(key(r))).map((core) => ({ core, casing: casings.get(key(core)) }));
}
// The coverage of the pixel [j, j + 1] by a stroke of width w centred at c, along the normal: the overlap of the pixel with the interval between the two sides of
// the stroke. A rectangle drawn with strokeRect is rasterised with exact area coverage (a stroke made of a path, the selection's frame, is sampled four times down
// a pixel: tests/browser/two-tone-pixels.spec.js).
const coverage = (c, w, j) => Math.max(0, Math.min(c + w / 2, j + 1) - Math.max(c - w / 2, j));
const blend = (under, over, a) => under.map((u, i) => u * (1 - a) + over[i] * a);
// What the pixel row (or column) j across an edge at centre c must hold: the interior, then the backing at its coverage, then the core at its coverage.
function expectedAcross(c, j, axis, { interior, casing, core, coreWidth, casingWidth }) {
  return blend(blend(interior, casing, coverage(c, casingWidth, j)), core, coverage(c, coreWidth, j));
}

test.describe("B36 the movement stroke is the only carrier of its value, and its pixels are what its geometry says", () => {
  test("the fixture's movement-only cells are exactly the marks drawn, each a 1.5 px core on 3.5 px of backing", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("micro:paths");
    await open(page, fake, probe);
    const marks = marksOf(await pane.last());
    expect(MOVEMENT_ONLY.length, "the fixture has movement-only cells").toBe(7);
    expect(marks.length, "a mark for each").toBe(MOVEMENT_ONLY.length);
    for (const m of marks) {
      expect(m.core.alpha).toBe(1);
      expect(m.core.stroke, "the core is a colour of the pinned ramp, not the surface").not.toBe("#ffffff");
    }
  });

  test("every side of every mark holds, across the stroke, the pixels its coverage gives: the core and the backing on the neutral interior", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("micro:paths");
    await open(page, fake, probe);
    const frame = await pane.last(),
      marks = marksOf(frame),
      ops = masks.opsOf(frame);
    const interior = rgb("#ffffff"); // the neutral interior is the surface
    let skipped = 0;
    let compared = 0;
    for (const { core, casing } of marks) {
      const style = { interior, casing: rgb(casing.stroke), core: rgb(core.stroke), coreWidth: core.width, casingWidth: casing.width };
      // the neutral interior: the surface-coloured fill that holds the stroke (pixels outside it are the plot's, not part of this mark)
      const inner = frame.rects.find((r) => r.alpha === 1 && r.fill === "#ffffff" && r.x <= casing.x - 1 && r.y <= casing.y - 1 && r.x + r.w >= casing.x + casing.w + 1 && r.y + r.h >= casing.y + casing.h + 1 && r.w < 400);
      expect(inner, "the mark's interior").toBeTruthy();
      // the four edges of the stroked rectangle, sampled at a quarter, a half and three quarters of the way along, five pixels across each
      const sides = [
        { c: core.y, along: (t) => core.x + core.w * t, across: (j) => [null, j], axis: "y" },
        { c: core.y + core.h, along: (t) => core.x + core.w * t, across: (j) => [null, j], axis: "y" },
        { c: core.x, along: (t) => core.y + core.h * t, across: (j) => [j, null], axis: "x" },
        { c: core.x + core.w, along: (t) => core.y + core.h * t, across: (j) => [j, null], axis: "x" },
      ];
      for (const side of sides)
        for (const t of [0.25, 0.5, 0.75]) {
          const base = Math.floor(side.c) - 2,
            along = Math.floor(side.along(t)) + 0.5;
          const rows = [0, 1, 2, 3, 4].map((k) => base + k);
          const points = rows.map((j) => (side.axis === "y" ? [along, j + 0.5] : [j + 0.5, along]));
          const got = await pixels(page, points);
          rows.forEach((j, k) => {
            if (!(points[k][0] >= inner.x && points[k][0] <= inner.x + inner.w && points[k][1] >= inner.y && points[k][1] <= inner.y + inner.h)) return;
            // what the page paints over the stroke afterwards (the column POC line and its halo cross some marks) is judged by its own footprint, not here
            if (ops.some((o) => o.seq > core.seq && masks.covers(o, points[k][0], points[k][1], 1.5))) return void skipped++;
            const want = expectedAcross(side.c, j, side.axis, style);
            for (let ch = 0; ch < 3; ch++) expect(Math.abs(got[k][ch] - want[ch]), `a ${side.axis} edge at ${side.c}: pixel ${j} channel ${ch} is ${got[k][ch]}, its coverage gives ${want[ch].toFixed(1)}`).toBeLessThanOrEqual(4);
            compared++;
          });
        }
    }
    expect(compared, "many pixels across the strokes were compared").toBeGreaterThan(300);
    // (the tolerance is 4 of 255, the rasteriser's 8-bit coverage and the blend's rounding; a coverage wrong by a sixteenth would move these pixels by 12 or more)
    console.log(`movement cores: ${marks.length} marks, ${compared} pixels across their strokes compared with the coverage arithmetic, ${skipped} under other marks`);
  });

  test("the cores are unchanged under a selection: every sampled pixel of a stroke nothing else paints over is as it was", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("micro:paths");
    await open(page, fake, probe);
    const layout = await layoutOf(page),
      before = await pane.last(),
      beforeMarks = marksOf(before);
    const pointsOf = (marks) =>
      marks.flatMap(({ core }) =>
        [0.25, 0.5, 0.75].flatMap((t) => [
          [core.x + core.w * t, core.y - 0.5],
          [core.x + core.w * t, core.y + 0.5],
          [core.x + core.w * t, core.y + core.h - 0.5],
          [core.x + core.w * t, core.y + core.h + 0.5],
          [core.x - 0.5, core.y + core.h * t],
          [core.x + 0.5, core.y + core.h * t],
          [core.x + core.w - 0.5, core.y + core.h * t],
          [core.x + core.w + 0.5, core.y + core.h * t],
        ]),
      );
    const points = pointsOf(beforeMarks);
    const was = await pixels(page, points);
    const box = await page.locator("#ol-canvas").boundingBox();
    // a selection over part of the plot
    await page.keyboard.press("s");
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.28, box.y + layout[1] + layout[3] * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.6, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await probe.waitForQuiet({ quietMs: 600, timeout: 20000 });
    const after = await pane.last(),
      ops = masks.opsOf(after);
    const opsBefore = masks.opsOf(before);
    const now = await pixels(page, points);
    // the marks the selection's edge cuts are repainted inside it with the part of the cell it holds: judged by place, not here
    const [sx0, sy0, sx1, sy1] = (() => {
      const core = after.strokes.find((k) => k.path.length === 4 && k.width === 1.5 && k.subs?.[0]?.[1] === 1);
      return [core.path[0][0], core.path[0][1], core.path[2][0], core.path[2][1]];
    })();
    const cut = (m) => m.core.x < sx1 && m.core.x + m.core.w > sx0 && m.core.y < sy1 && m.core.y + m.core.h > sy0 && !(m.core.x >= sx0 && m.core.x + m.core.w <= sx1 && m.core.y >= sy0 && m.core.y + m.core.h <= sy1);
    const afterMarks = marksOf(after);
    const same_ = (a, b) => [a.x, a.y, a.w, a.h].every((v, i) => v === [b.x, b.y, b.w, b.h][i]);
    let same = 0,
      painted = 0,
      skipped = 0;
    points.forEach((p, i) => {
      const owner = beforeMarks.find((m) => Math.abs(p[0] - (m.core.x + m.core.w / 2)) <= m.core.w / 2 + 1 && Math.abs(p[1] - (m.core.y + m.core.h / 2)) <= m.core.h / 2 + 1);
      if (cut(owner)) return void skipped++;
      const mine = afterMarks.find((m) => same_(m.core, owner.core));
      expect(mine, "the mark is drawn again in the same place").toBeTruthy();
      // what is painted over a stroke, in either frame, is judged by its own footprint; the page paints a halo and a line over some of these
      const coveredIn = (ops, seq) => ops.some((o) => o.seq > seq && masks.covers(o, p[0], p[1], 1.5));
      if (coveredIn(opsBefore, owner.core.seq) || coveredIn(ops, mine.core.seq)) return void painted++;
      expect(now[i], `the pixel at ${p.map((v) => v.toFixed(1))} of an uncovered stroke is as it was`).toEqual(was[i]);
      same++;
    });
    expect(same, "most of the stroke pixels are compared").toBeGreaterThan(points.length * 0.4);
    console.log(`movement cores under a selection: ${same} pixels as they were, ${painted} under the selection's own marks, ${skipped} on cells its edge cuts`);
  });

  // The block's cells are painted outside the selection and the selection's own inside it, so that no pixel is painted twice: an outline alone (Geometry has no backing to cover
  // a second pass) would stack the coverage of its antialiased edge pixels and read bolder inside a selection than outside it.
  test("an outline-only mark inside a selection is painted once: its antialiased edge pixels are those it has without the selection", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("micro:paths");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24750~25500&r=0,0&mode=geometry&vis=2`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    await page.locator("#ol-poc").uncheck({ force: true });
    await probe.waitForQuiet({ quietMs: 500, timeout: 20000 });
    const layout = await layoutOf(page),
      box = await page.locator("#ol-canvas").boundingBox();
    // the pixels across the top edge of every outline the frame draws (a 1 px stroke on a half pixel: at these coordinates the edge pixels hold fractions of its colour)
    // (not those within 12 px of the plot's edge, where the selection's own frame and corner ticks are painted over them)
    const outlines = (await pane.last()).strokeRects.filter(
      (r) => r.width === 1 && r.alpha === 1 && r.w > 20 && r.h > 20 && r.y > layout[1] + 12 && r.y < layout[1] + layout[3] - 12 && r.x > layout[0] + 12 && r.x + r.w < layout[0] + layout[2] - 12,
    );
    expect(outlines.length, "Geometry outlines the occupied cells").toBeGreaterThan(3);
    const points = outlines.flatMap((r) => [-1, 0, 1].map((k) => [Math.floor(r.x + r.w / 2) + 0.5, Math.floor(r.y) + k + 0.5]));
    const fractional = outlines.filter((r) => Math.abs(r.y - Math.round(r.y)) > 0.1).length;
    expect(fractional, "some edges are not on a pixel line: they are the antialiased ones the stacking would show in").toBeGreaterThan(0);
    const was = await pixels(page, points);
    // a selection over the whole plot: every outline is inside it
    await page.keyboard.press("s");
    await page.mouse.move(box.x + layout[0] + 3, box.y + layout[1] + 3);
    await page.mouse.down();
    await page.mouse.move(box.x + layout[0] + layout[2] - 3, box.y + layout[1] + layout[3] - 3, { steps: 8 });
    await page.mouse.up();
    await page.mouse.move(box.x + 3, box.y + box.height - 3);
    await probe.waitForQuiet({ quietMs: 600, timeout: 20000 });
    const now = await pixels(page, points);
    points.forEach((p, i) => {
      for (let ch = 0; ch < 3; ch++) expect(Math.abs(now[i][ch] - was[i][ch]), `the pixel at ${p.map((v) => v.toFixed(1))} channel ${ch}: ${now[i][ch]} inside the selection, ${was[i][ch]} without it`).toBeLessThanOrEqual(2);
    });
  });

  test("tiny unresolved marks: every cell the price only moved through has its exact readout, and the key counts them all", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("micro:paths");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1500, height: 950 });
    // 480 rows in the plot: each is about a pixel, so no movement-only cell can show an honest outline
    await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=0~60000&r=0,0&mode=path&vis=2`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
    await expect(page.locator("#ol-key-detail-text"), "represented and unresolved counts").toHaveText(`Detail unresolved: ${MOVEMENT_ONLY.length} of ${MOVEMENT_ONLY.length} moved-through cells`);
    const layout = await layoutOf(page),
      box = await page.locator("#ol-canvas").boundingBox(),
      tip = page.locator("#ol-tip");
    for (const z of MOVEMENT_ONLY) {
      // the cell's centre: column c of 56.25 s over the six minutes, row r of 125 USDT over 60,000
      const x = layout[0] + (((z.c + 0.5) * 56.25) / 360) * layout[2],
        y = layout[1] + ((60000 - (z.r * 125 + 62.5)) / 60000) * layout[3];
      await page.mouse.move(box.x + 5, box.y + box.height - 5);
      await page.mouse.move(box.x + x, box.y + y);
      await expect(tip).toBeVisible();
      await expect(tip, `cell ${z.c}:${z.r}: the hand-computed path in USDT`).toContainText(new RegExp(`USDT moved\\s*${z.p} USDT`));
      await expect(tip, `cell ${z.c}:${z.r}: and in row spans`).toContainText(new RegExp(`Path / price span\\s*${z.p / 125} row spans`));
    }
  });
});
