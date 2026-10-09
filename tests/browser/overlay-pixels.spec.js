"use strict";
// B35 overlay-pixels.spec.js (PRD-0002 S2, #47 section 1 and the acceptance list): the quantitative fill of a cell is the same under every overlay, wherever
// nothing the overlay paints covers it, and what an overlay paints is bounded.
//
// What is asserted, for the same view (explicit rectangle and level, DPR 1, light theme, the same cube) with and without an overlay (a selection, each Rows
// mode, the bands, the CME gap, the continuations' anchor, a transient lens, and all of them together):
//   (A) in every frame, the core of each cell fill (the middle of the rectangle and two points 2.5 px inside its corners) holds exactly the colour the cell
//       was painted in, unless something painted LATER covers the point: the covering is read from the operations the frame recorded (strokes at their
//       width, plates, texts, markers), never declared. A core that differs without such a cover is a failure that names the cell.
//   (B) the cells are the same: the colours of the quantitative fills (the entries of the pinned LUT) are the same multiset with and without the overlay, so
//       the same records under the same scale are drawn in the same colours whatever the overlay does to the geometry around them (Rows narrows the plot
//       by its strip, a lane takes a line of it: where the plot moves, the cells move with it and are compared by colour, not by place).
//   (C) what the overlay paints after the cells is bounded: every such mark is within the geometry the PRD allows (tests/browser/masks.js validate: a stroke
//       and its backing at most 4.5 px, a plate a line of text, a cap a bar), so an oversized halo cannot pass by being called a mask; the union of the
//       persistent marks touches at most 20% of the plot, and the interaction boundary is measured apart from them.
//   A transient lens is a named region: its pixels are excluded from (A) and nothing it paints reaches outside the region it names.
// Every page runs with reduced motion (no morph frame can be the one captured).
// Oracles (none is the code under test): the recorded operations of the page's canvas (the covering), the pinned LUT's own entries for what a cell colour is,
// the PRD's numbers (4.5 px backing, 20% budget), and the pixels of the canvas read back at DPR 1.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const masks = require("./masks.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const VIEW = "#t=2026-09-23T00:00Z~2026-09-24T12:00Z&p=22000~23500&r=7,0&vis=2";
const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));

// Startup is complete when required reads and decodes finish and the settled view is painted.
async function ready(page, fake, probe) {
  await probe.waitForReady({ timeout: 30000 });
}

// The quantitative fills of a frame: opaque rectangles of the pinned unsigned LUT's entries, in the plot, big enough to have a core.
async function lutColours(page) {
  return page.evaluate(() => {
    const scratch = document.createElement("canvas").getContext("2d");
    const E = window.explorerEncoding;
    const theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, theme);
    const hex = (css) => {
      scratch.fillStyle = "#000000";
      scratch.fillStyle = css;
      return scratch.fillStyle;
    };
    return { colours: [...new Set(Array.from({ length: 256 }, (_, i) => hex(lut.unsigned.css[i])))], dpr: window.devicePixelRatio, dark: theme === "dark" };
  });
}
function cellsOf(frame, plot, colours) {
  const set = new Set(colours);
  return frame.rects.filter(
    (r) => r.alpha === 1 && set.has(r.fill) && r.w >= 6 && r.h >= 6 && r.w <= 400 && r.h <= 400 && r.x >= plot[0] - 1 && r.y >= plot[1] - 1 && r.x + r.w <= plot[0] + plot[2] + 1 && r.y + r.h <= plot[1] + plot[3] + 1,
  );
}
// The core of a fill: its middle and two points 2.5 px inside two opposite corners (a pixel centre each).
const coreOf = (r) => [
  [Math.floor(r.x + r.w / 2) + 0.5, Math.floor(r.y + r.h / 2) + 0.5],
  [Math.floor(r.x + 2.5) + 0.5, Math.floor(r.y + 2.5) + 0.5],
  [Math.floor(r.x + r.w - 2.5) - 0.5, Math.floor(r.y + r.h - 2.5) - 0.5],
];
async function pixelsAt(page, points) {
  return page.evaluate((pts) => {
    const canvas = document.getElementById("ol-canvas"),
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    const hex = (n) => n.toString(16).padStart(2, "0");
    return pts.map(([x, y]) => {
      const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      return `#${hex(d[0])}${hex(d[1])}${hex(d[2])}`;
    });
  }, points);
}

// One frame, read: its operations, its cells, and for each unoccluded cell core the pixel and what was expected. The cell that owns a point is the topmost
// quantitative fill painted there (inside its clip); what covers it is what was painted after that fill. `skip` are boxes whose pixels are excluded from
// the comparison (a transient region), named by the page.
const insideBox = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
async function readFrame(page, pane, colours, skip = []) {
  const frame = await pane.last(),
    layout = await layoutOf(page),
    plot = layout.slice(0, 4),
    ops = masks.opsOf(frame),
    cells = cellsOf(frame, plot, colours);
  const lastCell = Math.max(...cells.map((c) => c.seq));
  // what is painted after the last cell fill: the marks that cover cells (each point is checked against what was painted after ITS fill, below)
  const over = masks.drawnAfter(ops, lastCell);
  const visible = (c, x, y) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h && (!c.clip || insideBox(c.clip, x, y));
  const points = [],
    owner = [];
  for (const c of cells)
    for (const p of coreOf(c)) {
      const top = cells.filter((o) => visible(o, p[0], p[1])).reduce((a, b) => (b.seq > a.seq ? b : a), c);
      if (top !== c) continue; // the point is another cell's: it is judged there
      if (!visible(c, p[0], p[1])) continue; // the fill is clipped away here
      if (ops.some((o) => o.seq > c.seq && masks.covers(o, p[0], p[1], 1.5))) continue;
      if (skip.some((b) => insideBox(b, p[0], p[1]))) continue;
      points.push(p);
      owner.push(c);
    }
  const pixels = await pixelsAt(page, points);
  const wrong = [];
  pixels.forEach((px, i) => {
    if (px !== owner[i].fill) wrong.push({ at: points[i], got: px, want: owner[i].fill, cell: [owner[i].x, owner[i].y, owner[i].w, owner[i].h], clip: owner[i].clip });
  });
  return { frame, layout, plot, ops, cells, over, lastCell, compared: points.length, wrong };
}
// The cells, one for each place a cell is painted at: where a frame paints a place twice (a selection paints the cells inside it again, clipped to it, with
// the amounts of the part of each cell the rectangle holds), the topmost one is the cell's colour.
const placeOf = (c) => [c.x, c.y, c.w, c.h].map((v) => Math.round(v * 100)).join(":");
const places = (cells) => {
  const top = new Map();
  for (const c of cells) if (!top.has(placeOf(c)) || c.seq > top.get(placeOf(c)).seq) top.set(placeOf(c), c);
  return top;
};
const sorted = (cells) => [...places(cells).values()].map((c) => c.fill).sort();

// The marks painted after the cells, judged: those that touch a quantitative cell (what a region of its own, a strip or a pane, a plot background or an
// empty cell's fill does not reach is no occluder of a measurement), bounded in size, and their union against the plot.
function judge(read, { allow = [] } = {}) {
  const reach = (o, c) => {
    const b = o.box ?? (o.segs ? [Math.min(...o.segs.flatMap((q) => [q[0], q[2]])) - o.half, Math.min(...o.segs.flatMap((q) => [q[1], q[3]])) - o.half, Math.max(...o.segs.flatMap((q) => [q[0], q[2]])) + o.half, Math.max(...o.segs.flatMap((q) => [q[1], q[3]])) + o.half] : [o.cx - o.r, o.cy - o.r, o.cx + o.r, o.cy + o.r]);
    return b[0] <= c.x + c.w && b[2] >= c.x && b[1] <= c.y + c.h && b[3] >= c.y;
  };
  const marks = read.over.filter((o) => read.cells.some((c) => reach(o, c) && (o.segs ? o.segs.some((q) => masks.covers({ segs: [q], half: o.half }, ...cellMid(c), Math.max(c.w, c.h))) : true)));
  return { marks, problems: masks.validate(marks, { allow }), area: masks.unionArea(marks, { x: read.plot[0], y: read.plot[1], w: read.plot[2], h: read.plot[3] }) };
}
const cellMid = (c) => [c.x + c.w / 2, c.y + c.h / 2];

async function selectRectangle(page, layout) {
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.keyboard.press("s");
  await page.mouse.move(box.x + layout[0] + layout[2] * 0.3, box.y + layout[1] + layout[3] * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + layout[0] + layout[2] * 0.6, box.y + layout[1] + layout[3] * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(box.x + 5, box.y + box.height - 5);
}

// ---- the scenarios ---------------------------------------------------------------------------------------------

const BUDGET = 0.2;
// Each overlay: how it is made (an address added to the view, or an act on the page that is already there) and how the test knows the page has what it asked.
const OVERLAYS = {
  selection: {
    act: async (page, layout) => selectRectangle(page, layout),
    wait: async (page) => expect(page.locator("#ol-key-selection")).toBeVisible(),
  },
  "rows volume": { extra: "&rows=volume&period=7d", wait: waitStrip },
  "rows delta": { extra: "&rows=delta&period=7d", wait: waitStrip },
  "rows relative volume": { extra: "&rows=relvol&period=7d", wait: waitStrip },
  "rows time at price": { extra: "&rows=time&period=7d", wait: waitStrip },
  bands: { extra: "&lines=bmsb,bb4h,bb1d", wait: async (page) => waitLinesValue(page, ["bb4h", "bb1d", "bmsb"]) },
  "cme gap": { extra: "&lines=cme", wait: async (page, fake) => expect.poll(() => fake.log().some((e) => e.path === "/cube/bars" && e.query.n === "6"), { timeout: 30000 }).toBe(true) },
  anchor: { act: clickAnchor, wait: waitAnchor },
  // every overlay but the selection and the lens at once: Rows' strip and projection, the bands and the gap with their lanes, and an anchor
  combined: {
    extra: "&rows=volume&period=7d&lines=bmsb,bb4h,bb1d,cme",
    act: clickAnchor,
    wait: async (page, fake, probe, pane) => {
      await waitStrip(page, fake, probe, pane);
      await waitLinesValue(page, ["bb4h", "bb1d", "bmsb"]);
      await waitAnchor(page);
    },
  },
  // a transient lens is a named region: its pixels are not compared, and nothing outside it differs
  lens: {
    act: async (page, layout) => {
      await page.locator("#ol-lens").click();
      const box = await page.locator("#ol-canvas").boundingBox();
      await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
    },
    wait: async (page) => expect.poll(async () => (await page.locator("#ol-canvas").evaluate((el) => el.dataset.temporary ?? "")).includes("lens-caption:"), { timeout: 30000 }).toBe(true),
    // every region the page names: the lens and its caption tab, which covers the heatmap as the lens does
    regions: async (page) => {
      const named = await page.locator("#ol-canvas").evaluate((el) => el.dataset.temporary);
      return named.split(";").map((part) => {
        const [x, y, w, h] = part.replace(/^[a-z-]+:/, "").split(",").map(Number);
        return [x, y, x + w, y + h];
      });
    },
  },
};
async function clickAnchor(page, layout) {
  await page.keyboard.press("c");
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.click(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
}
async function waitAnchor(page) {
  await expect.poll(async () => (await page.locator("#ol-case-n").textContent()) !== "—", { timeout: 30000 }).toBe(true);
}
async function waitStrip(page, fake, probe, pane) {
  await expect
    .poll(async () => {
      const frame = await pane.last(),
        plot = await layoutOf(page);
      return frame.rects.some((r) => r.w === 12 && r.x >= plot[0] + plot[2] - 1 && r.h > 1);
    }, { message: "the Rows strip is drawn", timeout: 30000 })
    .toBe(true);
}
async function waitLinesValue(page, keys) {
  await page.locator("#ol-lines").click();
  for (const k of keys) await expect.poll(async () => (await page.locator(`[data-line-value="${k}"]`).textContent()) !== "…", { timeout: 30000 }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-lines-pop")).toBeHidden();
}

async function compare(page, fake, probe, pane, name, spec, results) {
  const { colours } = results.lut;
  await page.goto(`${fake.url}/${VIEW}`);
  await ready(page, fake, probe);
  const before = await readFrame(page, pane, colours);
  if (spec.extra) {
    await page.goto(`${fake.url}/${VIEW}${spec.extra}`);
    await ready(page, fake, probe);
  }
  if (spec.act) await spec.act(page, await layoutOf(page));
  await spec.wait?.(page, fake, probe, pane);
  await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
  const regions = spec.regions ? await spec.regions(page) : [];
  const after = await readFrame(page, pane, colours, regions);
  return { before, after, regions };
}

// The selection's rectangle as the page painted it: the ink core of the two-tone frame, a closed 4-point path of 1.5 px.
const selectionOf = (frame) => {
  const core = frame.strokes.find((k) => k.path.length === 4 && k.width === 1.5 && k.subs?.[0]?.[1] === 1 && Math.abs(k.path[0][1] - k.path[1][1]) < 1e-9);
  return [core.path[0][0], core.path[0][1], core.path[2][0], core.path[2][1]];
};
test.describe("B35 every overlay leaves the cells' colours and covers only what it paints", () => {
  let lut;
  test.beforeEach(async ({ page, probe, fakeFor }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1500, height: 950 });
  });
  for (const [name, spec] of Object.entries(OVERLAYS))
    test(`${name}: the same cell colours, unoccluded cores unchanged, the marks within the PRD's geometry and its budget`, async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor("standard");
      await page.goto(`${fake.url}/${VIEW}`);
      await ready(page, fake, probe);
      const results = { lut: await lutColours(page) };
      expect([results.lut.dpr, results.lut.dark], "pinned: DPR 1, light").toEqual([1, false]);
      const { before, after, regions } = await compare(page, fake, probe, pane, name, spec, results);
      expect(before.cells.length, "the view has cells").toBeGreaterThan(20);
      expect(before.wrong, "base: a core that is not its cell's colour and is not covered").toEqual([]);
      expect(after.wrong, `${name}: a core that is not its cell's colour and is not covered by anything painted after it`).toEqual([]);
      if (name === "selection") {
        // the geometry does not move, so the cells are compared place by place; a selection's edge cuts the cells it crosses, and inside it each of those
        // shows the amounts of the part the rectangle holds (observed amounts), so its colour may differ there and nowhere else
        const [x0, y0, x1, y1] = selectionOf(after.frame);
        const was = places(before.cells),
          now = places(after.cells);
        expect([...now.keys()].sort(), "the same places").toEqual([...was.keys()].sort());
        const cut = (c) => c.x < x1 && c.x + c.w > x0 && c.y < y1 && c.y + c.h > y0 && !(c.x >= x0 && c.x + c.w <= x1 && c.y >= y0 && c.y + c.h <= y1);
        const changed = [...now.keys()].filter((k) => now.get(k).fill !== was.get(k).fill);
        for (const k of changed) expect(cut(now.get(k)), `cell ${k} changed colour inside the selection without being cut by its edge`).toBe(true);
        // and the repaint is clipped to the rectangle, never outside it
        for (const k of changed) {
          const c = now.get(k);
          expect(c.clip, `cell ${k}: painted again inside a clip`).toBeTruthy();
          expect(c.clip[0] >= x0 - 1.5 && c.clip[1] >= y0 - 1.5 && c.clip[2] <= x1 + 1.5 && c.clip[3] <= y1 + 1.5, `cell ${k}: the clip is the selection's rectangle`).toBe(true);
        }
        console.log(`selection: ${changed.length} of ${now.size} cells are cut by its edge and repainted inside it`);
        // the interaction boundary is measured apart from the persistent marks: what the selection added, in the geometry the page painted, is a small area
        const interaction = masks.added(before.ops, after.ops).filter((o) => o.kind !== "rect" || o.box[2] - o.box[0] < 60);
        const strokes = interaction.filter((o) => o.segs);
        expect(strokes.length, "the frame, its casing and its corner ticks").toBeGreaterThanOrEqual(3);
        for (const o of strokes) expect(o.width, "a selection's casing is at most 3.5 px").toBeLessThanOrEqual(3.5);
        const interactionShare = masks.unionArea(strokes, { x: after.plot[0], y: after.plot[1], w: after.plot[2], h: after.plot[3] }) / (after.plot[2] * after.plot[3]);
        expect(interactionShare, `the selection's boundary touches ${(interactionShare * 100).toFixed(1)}% of the plot`).toBeLessThan(0.08);
      } else if (regions.length) {
        // the lens repaints the cells inside its region from its own tile: those are the region's, and every other cell is as it was
        const inRegion = (box) => regions.some((r) => box[0] >= r[0] - 2 && box[1] >= r[1] - 2 && box[2] <= r[2] + 2 && box[3] <= r[3] + 2);
        // a cell is a region's when its centre is in one, or when it is painted under a clip that lies inside one (a lens cell that straddles the edge)
        const outside = (c) => !(regions.some((r) => insideBox(r, c.x + c.w / 2, c.y + c.h / 2)) || (c.clip && inRegion(c.clip)));
        expect(sorted(after.cells.filter(outside)), `${name}: every cell outside the named region is as it was`).toEqual(sorted(before.cells.filter(outside)));
        expect(after.compared, "most of the plot is compared").toBeGreaterThan(40);
      } else expect(sorted(after.cells), `${name}: the same cells in the same colours`).toEqual(sorted(before.cells));
      const judged = judge(after, { allow: regions });
      expect(judged.problems, `${name}: marks larger than the geometry allows`).toEqual([]);
      const share = judged.area / (after.plot[2] * after.plot[3]);
      expect(share, `${name}: what is painted over the cells touches at most the budget (${(share * 100).toFixed(1)}% of the plot)`).toBeLessThanOrEqual(BUDGET);
      console.log(`${name}: ${after.cells.length} cells, ${after.compared} core points compared (${before.compared} in the base), ${judged.marks.length} marks over the cells touch ${(share * 100).toFixed(1)}% of the plot`);
    });
});

test.describe("B35 the persistent marks are held to 20% of the heatmap", () => {
  test("many lines on a small chart: what is painted for them touches at most 20% of the plot, the planner says it held marks back, every mark is within its geometry", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 760, height: 520 });
    const busy = "#w=7d&vis=2&lines=1d,wk,7d,mo,30d,90d,yr,1y,3y,cday,funding,usopen";
    await page.goto(`${fake.url}/#w=7d&vis=2`);
    await ready(page, fake, probe);
    const plain = await pane.last();
    await page.goto(`${fake.url}/${busy}`);
    await ready(page, fake, probe);
    await expect.poll(async () => (await page.locator("#ol-canvas").evaluate((el) => el.dataset.occlusion ?? "")) !== "", { message: "the planner held marks back", timeout: 30000 }).toBe(true);
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
    const crowded = await pane.last(),
      layout = await layoutOf(page),
      plot = { x: layout[0], y: layout[1], w: layout[2], h: layout[3] };
    const [shown, eligible] = (await page.locator("#ol-canvas").evaluate((el) => el.dataset.occlusion)).replace("!", "").split("/").map(Number);
    expect(eligible - shown, "marks were held back").toBeGreaterThan(0);
    // what the lines painted: the operations the crowded frame has beyond the plain one (the layout does not move), inside the plot
    const marks = masks.added(masks.opsOf(plain), masks.opsOf(crowded)).filter((o) => o.kind !== "rect" || o.box[2] - o.box[0] < 2000);
    expect(masks.validate(marks), "every mark within the geometry the PRD allows").toEqual([]);
    const share = masks.unionArea(marks, plot) / (plot.w * plot.h);
    expect(marks.length, "lines were painted").toBeGreaterThan(20);
    expect(share, `the marks touch ${(share * 100).toFixed(1)}% of the plot (${shown} of ${eligible} lines shown)`).toBeLessThanOrEqual(BUDGET);
    console.log(`budget: ${shown} of ${eligible} marks shown, ${marks.length} operations touch ${(share * 100).toFixed(1)}% of the plot`);
  });
});
