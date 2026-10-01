"use strict";
// B50 sign-marks.spec.js (PRD-0002 S3, #48 section 4, the sign mark): a signed measure carries the sign a second time, without hue, where the cell is big enough.
//
// What is asserted, on the recorded canvas and on its pixels:
//   1. a signed measure (Delta) draws exactly one mark for each signed cell that is at least 12 css px across each way, and none for a smaller one: a plus on a positive
//      cell, a minus on a negative one, a ring on the midpoint (a balanced cell), centred on the cell, in both themes;
//   2. the fill is kept: outside the mark's own box every pixel of a marked cell is the fill the mapping gave it, and the mark covers at most a fifth of the cell (the
//      occlusion rule of #47 applied to the smallest cell that carries one);
//   3. the mark is drawn in whichever of the ink and the surface colour contrasts more with its fill, and what is RENDERED (the pixels, not the token pair) is 3:1 or
//      better over the fill: the bars are whole css px, so no pixel of one is blended away (a 1.5 px line at one pixel per css px loses a quarter of its contrast);
//   4. no mark where the cells are narrower than 12 px (a wide window) or shorter than 12 px (a wide price range), and then the footer's key states the limit and where the
//      sign is read instead; none for an unsigned measure, and no key.
// Oracles (none is the code under test): the LUT's pinned entries (which colour is a positive, a negative or a midpoint fill), the tokens parsed from the stylesheet, the
// WCAG contrast of tests/reference/contrast.js, and the PRD's 12 px and one-fifth numbers written out here.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const E = require("../support/enc");
const ref = require("../reference/contrast.js");
const S = require("./rows-support.js");
const fs = require("node:fs");
const path = require("node:path");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});
const TOKENS = ref.tokensFromCss(fs.readFileSync(path.resolve(__dirname, "../../src/explorer.css"), "utf8"));
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const MIN = 12,
  GAP = 1,
  FIFTH = 0.2;

// The shapes a cell's fill colour allows, from the LUT's entries of one theme: the positive and negative arms start at the midpoint, so the first entries of an arm
// round to the midpoint's own colour (8 bits cannot tell them apart), and a cell of that colour may carry the ring, the plus or the minus.
function roleTable(theme) {
  const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, theme),
    at = (ramp, i) => hex([ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]]),
    map = new Map(),
    add = (colour, shape) => map.set(colour, (map.get(colour) ?? new Set()).add(shape));
  for (let i = 1; i < 256; i++) {
    add(at(lut.positive, i), "plus");
    add(at(lut.negative, i), "minus");
  }
  add(hex(Array.from(lut.midpoint.rgb)), "zero");
  return map;
}
// The marks of a recorded frame, by shape: a plus is two bars (a 6 x 2 and a 2 x 6 rectangle in one path), a minus one 6 x 2 bar, a ring an arc of the ring's radius.
function marksOf(frame) {
  const S6 = E.role.SIGN.SIZE,
    W = E.role.SIGN.STROKE,
    out = [];
  for (const f of frame.fills) {
    if (f.subs.length === 0 || f.path.length !== 4 * f.subs.length) continue;
    const boxes = f.subs.map(([from]) => {
      const pts = f.path.slice(from, from + 4),
        xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const bars = boxes.map((b) => [b.x1 - b.x0, b.y1 - b.y0]);
    const isH = (d) => d[0] === S6 && d[1] === W,
      isV = (d) => d[0] === W && d[1] === S6;
    if (bars.length === 1 && isH(bars[0])) out.push({ shape: "minus", cx: boxes[0].x0 + S6 / 2, cy: boxes[0].y0 + W / 2, ink: f.fill });
    else if (bars.length === 2 && bars.some(isH) && bars.some(isV)) {
      const h = boxes[bars.findIndex(isH)];
      out.push({ shape: "plus", cx: h.x0 + S6 / 2, cy: h.y0 + W / 2, ink: f.fill });
    }
  }
  // each ring is an arc and then one stroke in the mark's colour
  const rings = frame.arcs.filter((a) => a.r === E.role.SIGN.RING_RADIUS);
  const strokes = frame.strokes.filter((s) => s.width === W && s.path.length === 0);
  rings.forEach((a, i) => out.push({ shape: "zero", cx: a.x, cy: a.y, ink: strokes[i]?.stroke }));
  return out;
}
// Where the PRD's rule puts the mark: the centre of the cell, or the centre of its upper half in a cell 16 px tall or more (a line through the row's centre misses it).
const raised = (top, height) => top + (height >= 16 ? height / 4 : height / 2);
// The signed cells a frame painted: the fills of the LUT's signed entries, with the cell's own size (the drawn rectangle and the gap around it).
const cellsOf = (frame, roles) =>
  frame.rects
    .filter((r) => roles.has(r.fill) && r.w > 0 && r.h > 0 && r.alpha === 1)
    .map((r) => ({ shapes: roles.get(r.fill), x: r.x, y: r.y, w: r.w, h: r.h, fill: r.fill, cx: r.x + r.w / 2, cy: raised(r.y - GAP / 2, r.h + GAP), cw: r.w + GAP, ch: r.h + GAP, inside: !r.clip || (r.x >= r.clip[0] && r.y >= r.clip[1] && r.x + r.w <= r.clip[2] && r.y + r.h <= r.clip[3]) }));

async function open(page, fake, probe, hash, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
}

for (const theme of ["light", "dark"])
  test.describe(`B50 the sign mark (${theme})`, () => {
    test("one mark for each signed cell of 12 px or more, the right shape, centred, and none for a smaller cell", async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor("standard");
      await page.setViewportSize({ width: 1500, height: 950 });
      await open(page, fake, probe, "#w=4h&vis=2&mode=delta", theme);
      const frame = await pane.last(),
        roles = roleTable(theme),
        cells = cellsOf(frame, roles),
        marks = marksOf(frame);
      expect(cells.length, "the view has signed cells").toBeGreaterThan(40);
      const big = cells.filter((c) => c.w >= MIN - GAP + 0.2 && c.h >= MIN - GAP + 0.2),
        small = cells.filter((c) => c.w < MIN - GAP - 1 || c.h < MIN - GAP - 1);
      expect(big.length, "some cells are big enough").toBeGreaterThan(10);
      expect(small.length, "and some are too short").toBeGreaterThan(0);
      expect(big.length + small.length, "(the rest are within a pixel of the limit and are not asserted)").toBeLessThanOrEqual(cells.length);
      const at = (c) => marks.filter((m) => Math.abs(m.cx - Math.round(c.cx)) <= 1 && Math.abs(m.cy - Math.round(c.cy)) <= 1);
      const seen = new Set();
      for (const c of big) {
        const here = at(c);
        expect(here.length, `a ${[...c.shapes]} cell at ${Math.round(c.x)},${Math.round(c.y)} (${c.cw.toFixed(1)} x ${c.ch.toFixed(1)}) has one mark`).toBe(1);
        expect(c.shapes.has(here[0].shape), `its shape is one its fill allows (${[...c.shapes]}, not ${here[0].shape})`).toBe(true);
        seen.add(here[0].shape);
      }
      for (const c of small) expect(at(c).length, `a ${[...c.shapes]} cell of ${c.cw.toFixed(1)} x ${c.ch.toFixed(1)} has none`).toBe(0);
      expect([...seen].sort(), "both signs of a mixed day are marked").toEqual(expect.arrayContaining(["minus", "plus"]));
      // the key says how many signed cells were left unmarked, and where their sign is
      const text = await page.locator("#ol-key-sign-text").textContent(),
        left = /(\d[\d,]*) cells under 12 px unmarked/.exec(text);
      expect(left, `the key counts the cells it could not mark: "${text}"`).toBeTruthy();
      expect(Number(left[1].replace(/,/g, "")), "at least the short cells of this view").toBeGreaterThanOrEqual(small.length);
      // nothing else is drawn as a mark: as many marks as cells that carry one, to within the cells at the limit
      const limit = cells.length - big.length - small.length;
      expect(marks.length, "no stray mark").toBeGreaterThanOrEqual(big.length);
      expect(marks.length, "no stray mark").toBeLessThanOrEqual(big.length + limit);
    });

    test("the fill is kept around the mark, the mark covers at most a fifth of its cell, and what is rendered is 3:1 over the fill", async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor("standard");
      await page.setViewportSize({ width: 1500, height: 950 });
      await open(page, fake, probe, "#w=4h&vis=2&mode=delta", theme);
      // the column POCs' line crosses the centre of its row's cells: it is a reference over the cell, not part of the mark or of the fill, so it is off here
      await page.evaluate(() => {
        const box = document.getElementById("ol-poc");
        box.checked = false;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
      const frame = await pane.last(),
        roles = roleTable(theme),
        marks = marksOf(frame),
        ink = TOKENS["--ol-ink"][theme],
        surface = TOKENS["--ol-surface"][theme];
      // (a cell at the edge of the plot is clipped by it, and what is clipped is not on the canvas to be measured)
      const cells = cellsOf(frame, roles).filter((c) => c.inside && c.w >= MIN - GAP + 0.2 && c.h >= MIN - GAP + 0.2);
      expect(cells.length).toBeGreaterThan(10);
      // the pixels of every marked cell, read back from the canvas
      const read = await page.evaluate((boxes) => {
        const ctx = document.getElementById("ol-canvas").getContext("2d", { willReadFrequently: true });
        return boxes.map(([x, y, w, h]) => {
          const d = ctx.getImageData(x, y, w, h).data,
            px = [];
          for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
          return { w, h, px };
        });
      }, cells.map((c) => [Math.ceil(c.x), Math.ceil(c.y), Math.floor(c.w) - 1, Math.floor(c.h) - 1]));
      const worst = { cover: 0, contrast: Infinity };
      cells.forEach((c, i) => {
        const { w, h, px } = read[i],
          fill = fromHex(c.fill),
          mark = marks.find((m) => Math.abs(m.cx - Math.round(c.cx)) <= 1 && Math.abs(m.cy - Math.round(c.cy)) <= 1);
        expect(mark, "the cell has its mark").toBeTruthy();
        let differing = 0,
          strongest = 0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const p = px[y * w + x];
            if (p.every((v, k) => Math.abs(v - fill[k]) <= 2)) continue;
            differing++;
            // a pixel that is not the fill lies inside the mark's own box (its bars or its ring, with a pixel for the edge)
            const gx = Math.ceil(c.x) + x + 0.5,
              gy = Math.ceil(c.y) + y + 0.5,
              reach = E.role.SIGN.SIZE / 2 + 1;
            expect(Math.abs(gx - mark.cx) <= reach + 1 && Math.abs(gy - mark.cy) <= reach + 1, `a pixel outside the mark's box differs from the fill at ${gx},${gy}: ${p} over ${c.fill}, cell ${JSON.stringify(c)}, mark ${JSON.stringify(mark)}`).toBe(true);
            strongest = Math.max(strongest, ref.contrast(p, fill));
          }
        const share = differing / (c.cw * c.ch);
        worst.cover = Math.max(worst.cover, share);
        worst.contrast = Math.min(worst.contrast, strongest);
        expect(share, `the mark covers ${(100 * share).toFixed(1)}% of a ${c.cw.toFixed(1)} x ${c.ch.toFixed(1)} cell`).toBeLessThanOrEqual(FIFTH);
        expect(differing, "something was drawn").toBeGreaterThan(0);
        // its colour is the one of the pair that contrasts more with the fill
        const chosen = ref.contrast(ink, fill) >= ref.contrast(surface, fill) ? ink : surface;
        expect(hex(chosen), "the ink is the better of ink and surface").toBe(mark.ink);
      });
      // rendered, the strongest pixel of every mark is the full contrast of its colour over the fill: no mark is blended into its fill
      expect(worst.contrast, `the weakest mark's strongest pixel is ${worst.contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      console.log(`B50 ${theme}: ${cells.length} marked cells, the largest cover ${(100 * worst.cover).toFixed(1)}%, the weakest rendered contrast ${worst.contrast.toFixed(2)}:1`);
    });

    test("none where the cells are narrower than 12 px, with the limit stated; none for an unsigned measure and no key then", async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor("standard");
      await page.setViewportSize({ width: 1500, height: 950 });
      const key = page.locator("#ol-key-sign");
      await open(page, fake, probe, "#w=4h&vis=2&mode=delta", theme);
      await expect(key, "a mark is on the plot: its key is").toBeVisible();
      await expect(key).toContainText("ring at the midpoint");
      expect(await page.locator('#ol-key-sign [data-stroke-role="sign"] canvas').count(), "the key's swatch is painted by the plot's painter").toBe(1);
      // a wide window: the same measure's cells are 9 px wide; there is no mark, and the key says so and where the sign is
      await open(page, fake, probe, "#w=24h&vis=2&mode=delta", theme);
      expect(marksOf(await pane.last()).length, "no mark on a cell narrower than 12 px").toBe(0);
      await expect(key, "the detail limit is stated").toBeVisible();
      await expect(key).toContainText("Sign not marked under 12 px: read it in the readout, the table or Inspect");
      // columns of 32 px but rows of 4 px (a wide price range at a fixed level): the other dimension is a limit too
      await open(page, fake, probe, "#t=2026-09-20T00:00Z~2026-09-20T04:00Z&p=15000~35000&r=3,0&vis=2&mode=delta", theme);
      const flat = cellsOf(await pane.last(), roleTable(theme));
      expect(flat.length, "signed cells are drawn").toBeGreaterThan(10);
      expect(Math.max(...flat.map((c) => c.ch)), "none is 12 px tall").toBeLessThan(MIN);
      expect(Math.max(...flat.map((c) => c.cw)), "though they are wider than 12 px").toBeGreaterThanOrEqual(MIN);
      expect(marksOf(await pane.last()).length, "no mark on a cell too short for it").toBe(0);
      await expect(key).toContainText("Sign not marked under 12 px");
      // an unsigned measure
      await open(page, fake, probe, "#w=4h&vis=2&mode=volume", theme);
      expect(marksOf(await pane.last()).length, "no mark on an unsigned fill").toBe(0);
      await expect(key).toBeHidden();
    });
  });
