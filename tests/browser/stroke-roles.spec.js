"use strict";
// B26 stroke-roles.spec.js (PRD-0002 S2, #47 section 1): the marks that say how a cell or an edge stands, and their keys.
//
// What is asserted:
//   1. every footer key that stands for a mark is painted by the function of the stroke-role table that paints the mark: the swatch's own pixels
//      are where that function puts its ink (a 1.5 px cap across the top for Open, a dashed line for the provisional edge, a ring for the
//      moved-through outline, a two-tone frame for the selection and for a linked cell, the gold line and its triangle or diamond for the POCs);
//   2. the keys of a mark appear with the mark: Selection with a selection, Linked cell under the pointer, Provisional edge and Open with their
//      marks on the plot;
//   3. a movement cell too small to outline (a side of 3 px or less) is the neutral occupancy mark and not a paler fill, the key says how many of
//      the moved-through cells that is, and the count is the fixture's own;
//   4. the selection is a two-tone frame (3.5 px of surface under 1.5 px of ink, four short corner ticks) and nothing is faded;
//   5. a linked cell is a two-tone boundary 1.5 px inside it, and 3.5 px inside where it meets the selection's edge, which it never replaces;
//   6. the open column is a 1.5 px neutral cap along its top edge, and no state mark is the gold of the profile.
// Oracles (none is the code under test): the stroke table of the PRD written out (1.5/3.5, 1/3, 1.5 cap, the 3 px threshold), the hand-computed
// motion cells of tests/fixtures/trades/paths.json, the page's own design tokens read back through the canvas, and the swatch pixels the table's
// geometry puts at known places on an 11 px canvas at DPR 1.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox } = require("./cells-support.js");
const { probeTools } = require("./fixtures.js");
const S = require("./rows-support.js");
const fs = require("node:fs");
const path = require("node:path");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "trades", `${name}.json`), "utf8"));

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

// The page's design tokens as "#rrggbb", read back through a canvas.
function tokens(page) {
  return page.evaluate(() => {
    const scratch = document.createElement("canvas").getContext("2d");
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const out = {};
    for (const name of ["ink", "surface", "muted", "state", "poc", "occupancy", "line"]) {
      probe.style.color = `var(--ol-${name})`;
      scratch.fillStyle = "#000000";
      scratch.fillStyle = getComputedStyle(probe).color;
      out[name] = scratch.fillStyle;
    }
    probe.remove();
    return out;
  });
}

// A pixel of a footer key's swatch (DPR 1), as "#rrggbb".
function swatchPixel(page, role, x, y) {
  return page.evaluate(
    ([r, px, py]) => {
      const canvas = document.querySelector(`[data-stroke-role="${r}"] canvas`);
      if (!canvas) return null;
      const d = canvas.getContext("2d").getImageData(px, py, 1, 1).data;
      return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    },
    [role, x, y],
  );
}

async function ready(page, fake, probe) {
  await S.atRest(page, fake, probe);
}

test.describe("B26 the footer keys are painted by the stroke-role table", () => {
  test("each swatch has its ink where the painter of its row puts it", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await ready(page, fake, probe);
    const c = await tokens(page);
    // Open: the 1.5 px cap covers the whole of the top pixel row
    expect(await swatchPixel(page, "open", 5, 0), "the open cap across the top").toBe(c.state);
    // the provisional edge: a dashed 1 px line down the middle, two on and three off
    expect(await swatchPixel(page, "provisional", 5, 0), "dash").toBe(c.state);
    expect(await swatchPixel(page, "provisional", 5, 3), "gap").toBe(c.surface);
    // the moved-through outline: the core ring passes through the pixel column 1
    expect(await swatchPixel(page, "moved", 1, 5), "the ring's core").toBe(c.state);
    expect(await swatchPixel(page, "moved", 5, 5), "the neutral interior").toBe(c.surface);
    // the POCs: a gold line through the middle row, the triangle at its end for the POC and a hollow diamond for the Buy POC
    expect(await swatchPixel(page, "poc", 2, 5), "the POC line").toBe(c.poc);
    expect(await swatchPixel(page, "bpoc", 1, 5), "the Buy POC dash").toBe(c.poc);
    expect(await swatchPixel(page, "poc", 5, 5), "the triangle is filled").toBe(c.poc);
    expect(await swatchPixel(page, "bpoc", 8, 5), "the diamond's own point is not filled (its middle)").not.toBe(c.poc);
    // the selection's frame and a linked cell's boundary: ink cores in surface backing
    expect(await swatchPixel(page, "selection", 2, 5), "the selection's core").toBe(c.ink);
    expect(await swatchPixel(page, "hover", 1, 5), "the linked cell's core").toBe(c.ink);
    // the Inspect focus of #48: corner brackets of a 2 px ink core in 4 px of surface, ready for its cursor
    expect(await swatchPixel(page, "inspect", 2, 3), "the Inspect bracket's core").toBe(c.ink);
    expect(await swatchPixel(page, "inspect", 5, 5), "and nothing inside it").not.toBe(c.ink);
    // the swatches of the detail mark (occupancy ink) and of Zero trades (a hairline in the line colour)
    expect(await swatchPixel(page, "detail", 5, 5), "detail unresolved is the occupancy ink").toBe(c.occupancy);
    expect(await swatchPixel(page, "empty", 0, 5), "an empty cell's hairline").toBe(c.line);
    // no swatch is gold but the two POC keys: state keys took the gold out
    for (const role of ["open", "provisional", "moved", "unavailable", "partial", "pending"]) {
      const seen = new Set();
      for (let x = 0; x < 11; x++) for (let y = 0; y < 11; y++) seen.add(await swatchPixel(page, role, x, y));
      expect(seen.has(c.poc), `${role}'s key has no gold`).toBe(false);
    }
  });

  test("the keys of a mark appear with the mark: Open and the provisional edge now, Selection and Linked cell when drawn", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await ready(page, fake, probe);
    await expect(page.locator("#ol-key-open")).toBeVisible();
    await expect(page.locator("#ol-key-provisional")).toBeVisible();
    await expect(page.locator("#ol-key-selection")).toBeHidden();
    await expect(page.locator("#ol-key-hover")).toBeHidden();
    const box = await page.locator("#ol-canvas").boundingBox();
    const layout = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
    // a cell under the pointer is linked: look for one
    let found = false;
    for (let fy = 0.2; fy < 0.7 && !found; fy += 0.02)
      for (let fx = 0.1; fx < 0.9 && !found; fx += 0.04) {
        await page.mouse.move(box.x + layout[0] + layout[2] * fx, box.y + layout[1] + layout[3] * fy);
        await probe.waitForQuiet({ quietMs: 200 });
        found = await page.locator("#ol-key-hover").isVisible();
      }
    expect(found, "a cell of the chart is under the pointer").toBe(true);
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await probe.waitForQuiet({ quietMs: 300 });
    await expect(page.locator("#ol-key-hover")).toBeHidden();
    // a selection is drawn
    await page.keyboard.press("s");
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.3, box.y + layout[1] + layout[3] * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.6, box.y + layout[1] + layout[3] * 0.6, { steps: 5 });
    await page.mouse.up();
    await probe.waitForQuiet({ quietMs: 300 });
    await expect(page.locator("#ol-key-selection")).toBeVisible();
  });
});

test.describe("B26 the selection, a linked cell and the open column on the plot", () => {
  async function selected(page, fake, probe, pane) {
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await ready(page, fake, probe);
    const box = await page.locator("#ol-canvas").boundingBox();
    const layout = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
    await page.keyboard.press("s");
    const a = [box.x + layout[0] + layout[2] * 0.3, box.y + layout[1] + layout[3] * 0.25],
      b = [box.x + layout[0] + layout[2] * 0.6, box.y + layout[1] + layout[3] * 0.6];
    await page.mouse.move(...a);
    await page.mouse.down();
    await page.mouse.move(...b, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await ready(page, fake, probe);
    return { box, layout, frame: await pane.last(), colours: await tokens(page) };
  }

  test("the selection is 3.5 px of surface under 1.5 px of ink on one rectangle, with four corner ticks, and no cell is faded", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    const { frame, colours } = await selected(page, fake, probe, pane);
    const frameStrokes = frame.strokes.filter((k) => k.path.length === 4 && k.width === 3.5 && k.stroke === colours.surface);
    expect(frameStrokes.length, "a surface casing of 3.5 px on the selection's rectangle").toBe(1);
    const casing = frameStrokes[0];
    const core = frame.strokes.filter((k) => k.path.length === 4 && k.width === 1.5 && k.stroke === colours.ink && JSON.stringify(k.path) === JSON.stringify(casing.path));
    expect(core.length, "an ink core of 1.5 px on the same rectangle").toBe(1);
    const ticks = frame.strokes.filter((k) => k.path.length === 16 && k.width === 1.5 && k.stroke === colours.ink);
    expect(ticks.length, "the corner ticks, one stroke of four L-shaped pairs").toBe(1);
    // each tick is 6 px long and leaves the corner outward
    const [x1, y1] = casing.path[0],
      [x2, y2] = casing.path[2];
    const lengths = [];
    for (let i = 0; i < 16; i += 2) lengths.push(Math.hypot(ticks[0].path[i][0] - ticks[0].path[i + 1][0], ticks[0].path[i][1] - ticks[0].path[i + 1][1]));
    expect(lengths.every((l) => Math.abs(l - 6) < 1e-9), "each tick is 6 px").toBe(true);
    expect(ticks[0].path.some(([x, y]) => x < x1 || y < y1 || x > x2 || y > y2), "the ticks reach outward").toBe(true);
    // nothing is faded: no fill at 0.25 of anything over the plot (the former 25% selection fade)
    expect(frame.rects.filter((r) => Math.abs(r.alpha - 0.25) < 1e-9 && r.w > 0 && r.h > 0).length, "no 25% fade").toBe(0);
  });

  test("a linked cell is a two-tone boundary 1.5 px inside it, and 3.5 px inside where it meets the selection's edge", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    const { box, layout, colours } = await selected(page, fake, probe, pane);
    // find a drawn cell under the pointer by moving over the plot until the linked key shows
    const at = async (fx, fy) => {
      await page.mouse.move(box.x + layout[0] + layout[2] * fx, box.y + layout[1] + layout[3] * fy);
      await probe.waitForQuiet({ quietMs: 250 });
      return page.locator("#ol-key-hover").isVisible();
    };
    let found = null;
    for (let fy = 0.3; fy < 0.6 && !found; fy += 0.02) for (let fx = 0.32; fx < 0.6 && !found; fx += 0.04) if (await at(fx, fy)) found = [fx, fy];
    expect(found, "a cell of the selection is under the pointer").not.toBeNull();
    const frame = await pane.last();
    // the two strokes of the hover: a 3 px surface casing and a 1 px ink core on the same inset rectangle
    const casings = frame.strokes.filter((k) => k.path.length === 4 && k.width === 3 && k.stroke === colours.surface);
    expect(casings.length, "a 3 px casing").toBe(1);
    const cores = frame.strokes.filter((k) => k.path.length === 4 && k.width === 1 && k.stroke === colours.ink && JSON.stringify(k.path) === JSON.stringify(casings[0].path));
    expect(cores.length, "a 1 px ink core on it").toBe(1);
    // the selection's frame is still there: a hover never replaces it
    expect(frame.strokes.some((k) => k.path.length === 4 && k.width === 3.5 && k.stroke === colours.surface), "the selection edge stays").toBe(true);
  });

  test("the layers come in the order of the composition: Rows projection, state marks, selection, what the pointer links, then the external strip", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2&rows=volume&period=7d`);
    await ready(page, fake, probe);
    const box = await page.locator("#ol-canvas").boundingBox();
    const layout = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
    await page.keyboard.press("s");
    const a = [box.x + layout[0] + layout[2] * 0.3, box.y + layout[1] + layout[3] * 0.25],
      b = [box.x + layout[0] + layout[2] * 0.6, box.y + layout[1] + layout[3] * 0.6];
    await page.mouse.move(...a);
    await page.mouse.down();
    await page.mouse.move(...b, { steps: 6 });
    await page.mouse.up();
    // a cell of the selection under the pointer
    let found = false;
    for (let fy = 0.3; fy < 0.6 && !found; fy += 0.02)
      for (let fx = 0.32; fx < 0.6 && !found; fx += 0.04) {
        await page.mouse.move(box.x + layout[0] + layout[2] * fx, box.y + layout[1] + layout[3] * fy);
        await probe.waitForQuiet({ quietMs: 200 });
        found = await page.locator("#ol-key-hover").isVisible();
      }
    expect(found).toBe(true);
    const frame = await pane.last(),
      colours = await tokens(page);
    const first = (list) => Math.min(...list.map((x) => x.seq));
    const band = first(frame.rects.filter((r) => Math.abs(r.alpha - 0.16) < 1e-9 && r.w > 0)),
      cap = first(frame.rects.filter((r) => r.h === 1.5 && r.fill === colours.state && r.alpha === 1 && Math.abs(r.y - layout[1]) < 1e-9)),
      provisional = first(frame.strokes.filter((k) => k.stroke === colours.state && k.width === 1 && JSON.stringify(k.dash) === "[2,3]")),
      selection = first(frame.strokes.filter((k) => k.path.length === 4 && k.width === 3.5 && k.stroke === colours.surface)),
      linked = first(frame.strokes.filter((k) => k.path.length === 4 && k.width === 3 && k.stroke === colours.surface)),
      strip = first(frame.rects.filter((r) => r.w === 12 && r.x > layout[0] + layout[2] - 1 && r.fill === colours.surface));
    for (const [name, v] of Object.entries({ band, cap, provisional, selection, linked, strip })) expect(Number.isFinite(v), `${name} was painted`).toBe(true);
    expect(band, "the projection first").toBeLessThan(cap);
    expect(cap, "then the state marks").toBeLessThan(selection);
    expect(provisional).toBeLessThan(selection);
    expect(selection, "the selection above them").toBeLessThan(linked);
    expect(linked, "what the pointer links above that").toBeLessThan(strip);
  });

  test("the corner ticks are not handles: dragging from one moves no edge of the selection", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    const { box, layout } = await selected(page, fake, probe, pane);
    const selOf = async () => (await page.evaluate(() => location.hash)).match(/[#&]sel=([^&]*)/)?.[1] ?? null;
    await expect.poll(selOf, { message: "the selection is in the address" }).not.toBeNull();
    const before = await selOf();
    const frame = await pane.last();
    const colours = await tokens(page);
    const casing = frame.strokes.find((k) => k.path.length === 4 && k.width === 3.5 && k.stroke === colours.surface);
    // the top-left tick: 3 px out along the top edge from the corner, in the pan tool
    const [cx, cy] = casing.path[0];
    await page.locator("#ol-pan").click();
    await page.mouse.move(box.x + cx - 3, box.y + cy);
    await page.mouse.down();
    await page.mouse.move(box.x + cx - 40, box.y + cy - 30, { steps: 5 });
    await page.mouse.up();
    await ready(page, fake, probe);
    expect(await selOf(), "the selection's edges are where they were (the view panned, nothing resized)").toBe(before);
  });

  test("the open column's cap is one 1.5 px neutral bar along the plot's top, and no state mark is gold", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await ready(page, fake, probe);
    const frame = await pane.last(),
      colours = await tokens(page),
      layout = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
    const caps = frame.rects.filter((r) => r.h === 1.5 && r.fill === colours.state && r.alpha === 1 && Math.abs(r.y - layout[1]) < 1e-9);
    expect(caps.length, "the open cap: a 1.5 px bar of the state ink along the plot's top").toBeGreaterThanOrEqual(1);
    expect(frame.texts.filter((t) => t.text === "Open").every((t) => t.fill === colours.state), "the word Open is in the state ink").toBe(true);
    // the old gold marks: a 3 px cap, 1 px corner ticks and hatching of the open column in the profile's gold
    expect(frame.strokes.filter((k) => k.stroke === colours.poc && k.width === 3).length, "no 3 px gold cap").toBe(0);
    expect(frame.strokes.filter((k) => k.stroke === colours.poc && k.width === 1 && k.alpha === 0.25).length, "no gold hatch").toBe(0);
    expect(frame.strokes.filter((k) => k.stroke === colours.poc && k.width === 1 && k.alpha === 0.35).length, "no gold coverage hatch").toBe(0);
  });
});

test.describe("B26 movement marks", () => {
  const ADDRESS = (low, high) => `#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=${low}~${high}&r=0,0&mode=path&vis=2`;
  const VIEW = (low, high) => ({ from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low, high });

  async function open({ freshContext, fakeFor }, low, high) {
    const fake = await fakeFor("micro:paths");
    const context = await freshContext({ reducedMotion: "reduce" });
    await addRecorder(context);
    const page = await context.newPage();
    await openView(page, fake, probeTools.forPage(page), ADDRESS(low, high));
    return { page, fake };
  }

  test("cells of 3 px or less that the price only moved through are the neutral detail mark, keyed and counted, never a paler fill", async ({ freshContext, fakeFor }) => {
    // 480 rows in the plot: each row is about a pixel, so every movement-only cell is unresolvable.
    const { page } = await open({ freshContext, fakeFor }, 0, 60000);
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const moved = fixture("paths").expected.motion["0:0"].filter((z) => z.ct === 0 && z.p > 0);
    expect(moved.length, "the fixture has moved-through cells with a path").toBe(7);
    for (const z of moved) {
      const box = boxOf(draw.plot, rectOf(VIEW(0, 60000)), 0, 0, z.c, z.r);
      expect(Math.min(box.x1 - box.x0, box.y1 - box.y0), `cell ${z.c}:${z.r} is 3 px or less`).toBeLessThanOrEqual(3);
      const ops = opsOfBox(draw, box, 0.3);
      expect(ops, `cell ${z.c}:${z.r}: one mark`).toHaveLength(1);
      expect(ops[0].op).toBe("fillRect");
      expect(ops[0].style, `cell ${z.c}:${z.r}: the occupancy ink`).toBe(colours.lutOccupancy);
      expect(ops[0].alpha, `cell ${z.c}:${z.r}: at full strength, no alpha stands for a value`).toBe(1);
    }
    // (the only 0.45-alpha fills left are the unsigned zeros' flat stand-ins of the role table, none of them in these cells)
    await expect(page.locator("#ol-key-detail")).toBeVisible();
    await expect(page.locator("#ol-key-detail-text")).toHaveText(`Detail unresolved: ${moved.length} of ${moved.length} moved-through cells`);
    // the key's swatch is the table's detail mark
    expect(await swatchPixel(page, "detail", 5, 5)).toBe((await tokens(page)).occupancy);
  });

  test("the same cells at a size that fits are outlined, and the detail key is not shown", async ({ freshContext, fakeFor }) => {
    const { page } = await open({ freshContext, fakeFor }, 24750, 25500);
    await expect(page.locator("#ol-key-moved")).toBeVisible();
    await expect(page.locator("#ol-key-detail")).toBeHidden();
  });
});
