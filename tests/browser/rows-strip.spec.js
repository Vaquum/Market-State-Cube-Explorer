"use strict";
// B28 rows-strip.spec.js (PRD-0002 S2, #47 section 2): the authoritative Rows strip and the contextual projection.
//
// What is asserted:
//   1. the strip is 12 px, immediately right of the heatmap, only while Rows is on (Rows off and 90 days stay the defaults); it is the plot's own
//      neighbour and distinct from the 48 px profile track;
//   2. each block's colour is the entry of the pinned LUT that the Rows mapping (the chip's U and k) gives the row's volume, opaque, and a
//      change of the time step alone changes neither the blocks nor the Rows scale;
//   3. a coarse recorded row is one tall block of its real size (8 rows of 125 USDT), never eight independently coloured ones;
//   4. the 16% projection behind the cells is the strip's colour at alpha 0.16 over the surface it lies on, nothing else, and cells do not tint it:
//      an opaque trade cell is exactly its own entry, a movement-only outline sits on a neutral interior;
//   5. Relative volume draws only inside its comparison support W (strip and readout), and the readout of a strip row names measure, period, W and
//      outside-support rows say so.
// Oracles (none is the code under test): tests/reference (exact rational period rows), the mapping's own U and k from the chip's details with
// log1p(v / k) / log1p(U / k) written out, the pinned LUT entries asked of the page's module only for WHICH colour an index is, 0.16 from the PRD,
// source-over compositing written out, and the recorded canvas.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const reference = require("../reference/index.js");
const { resolveProfile } = require("../support/profiles.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

function tradesOf(store, fromMs, toMs) {
  const out = [];
  for (let i = 0; i < store.length; i++) {
    const t = store.t[i];
    if (t >= fromMs && t < toMs) out.push({ t_ms: t, price: store.price[i], qty: store.qty[i], takerBuy: Boolean(store.buy[i]), count: store.count[i] });
  }
  return out;
}
const rowsOf = (store, from, to) => reference.periodRows(tradesOf(store, from * S.BASE_MS, to * S.BASE_MS), { b0: from, b1: to, m: 0 });

function scenario() {
  const { store } = resolveProfile("standard");
  const day = [S.END_COL - S.DAY_COLS, S.END_COL],
    period = rowsOf(store, S.END_COL - 7 * S.DAY_COLS, S.END_COL),
    peak = period.reduce((best, x) => (x.v > best.v ? x : best)),
    view = [peak.r - 6, peak.r + 6];
  return { day, view, period, peak, inView: period.filter((x) => x.r >= view[0] && x.r < view[1]) };
}
const addressOf = (sc, extra = "") => S.address({ cols: sc.day, rows: sc.view, rowsKind: "volume", period: "7d", extra: `&vis=2${extra}` });

const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
function priceAxis(frame) {
  const labels = frame.texts.filter((t) => /^\d{2},\d{3}$/.test(t.text) && t.align === "right" && t.x < 70).map((t) => [Number(t.text.replace(",", "")), t.y]);
  expect(labels.length, "the price axis has labels to fit").toBeGreaterThanOrEqual(3);
  const [p0, y0] = labels[0],
    [p1, y1] = labels[labels.length - 1],
    k = (y1 - y0) / (p1 - p0);
  return (price) => y0 + (price - p0) * k;
}
const hexOf = (px) => "#" + px.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
const pixelAt = (page, x, y) => page.evaluate(([px, py]) => Array.from(document.getElementById("ol-canvas").getContext("2d").getImageData(Math.round(px), Math.round(py), 1, 1).data), [x, y]).then(hexOf);
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const over = (src, alpha, ground) => rgbOf(src).map((c, i) => Math.round(alpha * c + (1 - alpha) * rgbOf(ground)[i]));

// The unsigned LUT entry of the page's own pinned table, as "#rrggbb", and the surface and page background.
async function palette(page) {
  return page.evaluate(() => {
    const E = window.explorerEncoding;
    const scratch = document.createElement("canvas").getContext("2d");
    const hex = (css) => {
      scratch.fillStyle = "#000000";
      scratch.fillStyle = css;
      return scratch.fillStyle;
    };
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const token = (name) => {
      probe.style.color = `var(--ol-${name})`;
      return hex(getComputedStyle(probe).color);
    };
    const surface = token("surface"),
      bg = token("bg");
    probe.remove();
    const theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, theme);
    return { surface, bg, unsigned: Array.from({ length: 256 }, (_, i) => hex(lut.unsigned.css[i])), rows: Array.from({ length: 256 }, (_, i) => hex(lut.rows.css[i])), midpoint: hex(lut.midpoint.css), alpha: E.lut.ROWS_ALPHA };
  });
}

// The strip's blocks of a frame: the opaque fills 12 px wide at the strip's x.
// (the strip's own background, one rectangle the height of the plot in the surface colour, is not a block)
const blocksOf = (frame, sx, plotHeight = 500) => frame.rects.filter((r) => Math.abs(r.x - sx) < 1e-9 && r.w === 12 && r.alpha === 1 && r.h > 0 && r.h < plotHeight - 1).map((r) => ({ y: r.y, h: r.h, fill: r.fill }));

test.describe("B28 the Rows strip", () => {
  test("12 px right of the heatmap only while Rows is on; Rows off and 90 days are the defaults; the profile track is another thing", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await S.atRest(page, fake, probe);
    let layout = await layoutOf(page);
    expect(layout[5], "no strip while Rows is off").toBe(0);
    await expect(page.locator("#ol-rows-legend")).toBeHidden();
    expect(await page.locator("#ol-rows-menu-button, #ol-rows").first().innerText()).toMatch(/Off/);
    const sc = scenario();
    await page.goto(`${fake.url}/${addressOf(sc)}`);
    await S.atRest(page, fake, probe);
    layout = await layoutOf(page);
    expect(layout[5], "a 12 px strip").toBe(12);
    expect(layout[4], "immediately right of the heatmap").toBeCloseTo(layout[0] + layout[2], 5);
    expect(layout[7] - (layout[4] + layout[5]), "the profile starts after it, its own 9 px on").toBe(9);
    // the default period is 90 days: a view that names Rows and no period shows "90 days"
    await page.goto(`${fake.url}/#w=24h&vis=2&rows=volume`);
    await S.atRest(page, fake, probe);
    await expect(page.locator("#ol-period-text, #ol-period").first()).toContainText(/90/);
  });

  test("each block is the LUT entry the Rows mapping gives its row, opaque and as tall as its row; a change of the time step alone changes nothing", async ({ page, probe, fakeFor, pane, surface }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${addressOf(sc)}`);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toMatch(/^(ready|fixed)$/);
    const details = await surface.details("rows");
    await S.atRest(page, fake, probe);
    const U = Number(details.fields.U.value),
      k = Number(details.fields.k.value),
      frame = await pane.last(),
      colours = await palette(page),
      layout = await layoutOf(page),
      y = priceAxis(frame);
    const blocks = blocksOf(frame, layout[4], layout[3]);
    expect(blocks.length, "a block for each row of the period in view").toBeGreaterThanOrEqual(sc.inView.filter((x) => x.v > 0).length);
    for (const x of sc.inView.filter((x) => x.v > 0)) {
      const index = Math.round(255 * (Math.log1p(x.v / k) / Math.log1p(U / k))),
        top = y((x.r + 1) * 125),
        block = blocks.find((b) => Math.abs(b.y - top) < 1.01);
      expect(block, `a block for row ${x.r}`).toBeTruthy();
      expect(block.fill, `row ${x.r}: entry ${Math.min(255, index)} of the pinned unsigned table`).toBe(colours.unsigned[Math.min(255, index)]);
      expect(block.h, `row ${x.r}: as tall as the row`).toBeCloseTo(Math.abs(y(x.r * 125) - y((x.r + 1) * 125)), 0);
    }
    // a time step alone: the same view at another column level has the same blocks and the same Rows mapping
    const before = (await surface.chip("rows")).data;
    const stepped = await fake.url;
    await page.goto(`${stepped}/${addressOf(sc, "&r=6,0")}`);
    await S.atRest(page, fake, probe);
    const after = (await surface.chip("rows")).data;
    expect(after.mappingId, "the Rows scale is the same").toBe(before.mappingId);
    const again = await pane.last();
    const relayout = await layoutOf(page);
    expect(blocksOf(again, relayout[4], relayout[3]), "and so are the blocks").toEqual(blocks);
  });

  test("the Rows legend has a bar for the strip at full strength and one for the backdrop at 16%", async ({ page, probe, fakeFor, surface }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${addressOf(sc)}`);
    await S.atRest(page, fake, probe);
    await surface.openLegendDetails("rows");
    await S.atRest(page, fake, probe);
    const pop = page.locator("#ol-rows-legend-pop");
    await expect(pop).toBeVisible();
    await expect(pop).toContainText("Strip: each row's value at full strength");
    await expect(pop).toContainText("Backdrop: the same entries at 16% over the surface");
    const colours = await palette(page);
    const ends = await pop.evaluate((el) => {
      const read = (canvas) => {
        const c = canvas.getContext("2d"),
          f = (x) => "#" + Array.from(c.getImageData(x, 0, 1, 1).data.slice(0, 3)).map((v) => v.toString(16).padStart(2, "0")).join("");
        return [f(0), f(canvas.width - 1)];
      };
      const canvases = [...el.querySelectorAll("canvas.ol-legend-canvas")];
      return { n: canvases.length, strip: read(el.querySelector('canvas[data-role="strip"]')), backdrop: read(canvases.find((c) => c.dataset.role !== "strip")) };
    });
    expect(ends.n, "two bars").toBe(2);
    expect(ends.strip, "the strip's bar runs from the first to the last entry of the unsigned table").toEqual([colours.unsigned[0], colours.unsigned[255]]);
    expect(ends.backdrop[1], "the backdrop's bar is the paler, blended end").not.toBe(ends.strip[1]);
  });

  test("a coarse recorded row is one block of its real height, never eight rows of 125 USDT", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/#w=24h&vis=2&rows=volume&period=90d`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 400, timeoutMs: 20000 });
    await probe.waitForQuiet({ quietMs: 600, timeout: 20000 });
    const frame = await pane.last(),
      layout = await layoutOf(page),
      y = priceAxis(frame);
    const blocks = blocksOf(frame, layout[4], layout[3]);
    expect(blocks.length, "the strip has blocks").toBeGreaterThan(2);
    // the recorded rows are 1,000 USDT: 8 base rows
    const tall = Math.abs(y(0) - y(1000));
    const whole = blocks.filter((b) => b.y > layout[1] + 1 && b.y + b.h < layout[1] + layout[3] - 1);
    expect(whole.length).toBeGreaterThan(2);
    for (const b of whole) expect(b.h, `a block of ${b.y.toFixed(1)} is 1,000 USDT tall`).toBeCloseTo(tall, 0);
    const details = await page.locator("#ol-rows-legend").getAttribute("data-mapping-id");
    expect(details, "the Rows mapping is calibrated").toBeTruthy();
  });
});

test.describe("B28 the strip's readout names the numeric clipping", () => {
  test("a manual Rows scale narrower than the data: the rows above it say they are clipped, the rows below it do not", async ({ page, probe, fakeFor, surface, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${addressOf(sc)}`);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toMatch(/^(ready|fixed)$/);
    const details = await surface.details("rows"),
      U = Number(details.fields.U.value),
      manualU = U / 3;
    const opened = await surface.openLegendDetails("rows");
    await opened.popover.getByLabel("U", { exact: true }).fill(String(manualU));
    await opened.popover.getByLabel("k", { exact: true }).fill(String(manualU / 50));
    await opened.popover.getByRole("button", { name: /^Apply/ }).click();
    await opened.close().catch(() => {});
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      layout = await layoutOf(page),
      y = priceAxis(frame),
      box = await page.locator("#ol-canvas").boundingBox();
    const tipAt = async (r) => {
      await page.mouse.move(box.x + layout[4] + 6, box.y + (y((r + 1) * 125) + y(r * 125)) / 2);
      await expect(page.locator("#ol-tip")).toBeVisible();
      return page.locator("#ol-tip").innerText();
    };
    const above = sc.inView.filter((x) => x.v > manualU),
      below = sc.inView.filter((x) => x.v > 0 && x.v < manualU * 0.9);
    expect(above.length, "rows above the manual top").toBeGreaterThan(0);
    expect(below.length, "rows below it").toBeGreaterThan(0);
    expect(await tipAt(above[0].r), "a row above the top says it is clipped").toMatch(/Numeric clipping/);
    expect(await tipAt(below[0].r), "a row below it does not").not.toMatch(/Numeric clipping/);
  });
});

test.describe("B28 a Geometry interior shows the projection", () => {
  test("the inside of an occupied Geometry cell is the band, not the bare surface", async ({ freshContext, fakeFor }) => {
    const { addRecorder, openView, lastDraw, rectOf, boxOf, pageColours } = require("./cells-support.js");
    const { probeTools } = require("./fixtures.js");
    const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
    const fake = await fakeFor("micro:paths");
    const context = await freshContext({ reducedMotion: "reduce" });
    await addRecorder(context);
    const page = await context.newPage();
    await openView(page, fake, probeTools.forPage(page), `#t=${view.from}~${view.to}&p=${view.low}~${view.high}&r=0,0&mode=geometry&rows=volume&period=1d&vis=2`);
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    const colours = await pageColours(page),
      ground = await palette(page),
      draw = await lastDraw(page),
      cell = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "fixtures", "trades", "paths.json"), "utf8")).expected.cells["0:0"].find((z) => z.r === 202),
      b = boxOf(draw.plot, rectOf(view), 0, 0, cell.c, cell.r);
    const seen = [];
    for (const [px, py] of [[b.x0 + 4, b.y0 + 4], [b.x1 - 4, b.y0 + 4], [b.x0 + 4, b.y1 - 4], [b.x1 - 4, b.y1 - 4]]) seen.push(await pixelAt(page, px, py));
    expect(seen.some((p) => p !== colours.surface && ground.rows.some((entry) => over(entry, 0.16, ground.surface).every((c, i) => Math.abs(c - rgbOf(p)[i]) <= 1))), `one of ${seen} is the Rows role at 16% over the surface`).toBe(true);
  });
});

test.describe("B28 the strip under Delta and Time at price", () => {
  test("Delta: each block is an entry of the positive arm above zero and of the negative arm below, by its row's taker-buy minus taker-sell", async ({ page, probe, fakeFor, pane, surface }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${S.address({ cols: sc.day, rows: sc.view, rowsKind: "delta", period: "7d", extra: "&vis=2" })}`);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toMatch(/^(ready|fixed)$/);
    const details = await surface.details("rows");
    await S.atRest(page, fake, probe);
    const U = Number(details.fields.U.value),
      k = Number(details.fields.k.value),
      frame = await pane.last(),
      layout = await layoutOf(page),
      y = priceAxis(frame),
      arms = await page.evaluate(() => {
        const E = window.explorerEncoding,
          scratch = document.createElement("canvas").getContext("2d"),
          theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
          lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, theme),
          hex = (css) => {
            scratch.fillStyle = "#000000";
            scratch.fillStyle = css;
            return scratch.fillStyle;
          };
        return { positive: Array.from({ length: 256 }, (_, i) => hex(lut.positive.css[i])), negative: Array.from({ length: 256 }, (_, i) => hex(lut.negative.css[i])) };
      });
    const blocks = blocksOf(frame, layout[4], layout[3]);
    let checked = 0;
    for (const x of sc.inView) {
      const d = 2 * x.bv - x.v;
      if (d === 0) continue;
      const index = Math.min(255, Math.round(255 * (Math.log1p(Math.abs(d) / k) / Math.log1p(U / k)))),
        block = blocks.find((b) => Math.abs(b.y - y((x.r + 1) * 125)) < 1.01);
      expect(block, `a block for row ${x.r}`).toBeTruthy();
      expect(block.fill, `row ${x.r}: delta ${d.toFixed(0)}`).toBe((d > 0 ? arms.positive : arms.negative)[index]);
      checked++;
    }
    expect(checked, "rows with a delta were checked").toBeGreaterThan(3);
  });

  test("Time at price has a strip too, in entries of the unsigned table, and its readout says what it is", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${S.address({ cols: sc.day, rows: sc.view, rowsKind: "time", period: "7d", extra: "&vis=2" })}`);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await pane.last()).rects.filter((r) => r.w === 12 && r.alpha === 1).length, { timeout: 15000 }).toBeGreaterThan(1);
    const frame = await pane.last(),
      layout = await layoutOf(page),
      colours = await palette(page),
      blocks = blocksOf(frame, layout[4], layout[3]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(colours.unsigned.includes(b.fill), `${b.fill} is an entry of the unsigned table`).toBe(true);
    const y = priceAxis(frame),
      box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.move(box.x + layout[4] + 6, box.y + blocks[0].y + blocks[0].h / 2);
    await expect(page.locator("#ol-tip")).toContainText(/Time at price · /);
    expect(y).toBeTruthy();
  });
});

test.describe("B28 the projection behind the cells", () => {
  test("a band is the strip's colour at 16% over what it lies on; cells do not tint it and it does not tint them", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    // a view that runs on past the cutoff, where the plot shows the page background and no cell covers a band
    const cols = [S.END_COL - 600, S.END_COL + 400];
    await page.goto(`${fake.url}/${S.address({ cols, rows: sc.view, rowsKind: "volume", period: "7d", extra: "&vis=2" })}`);
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      layout = await layoutOf(page),
      colours = await palette(page),
      y = priceAxis(frame);
    const blocks = blocksOf(frame, layout[4], layout[3]);
    const row = sc.inView.reduce((best, x) => (x.v > best.v ? x : best)),
      block = blocks.find((b) => Math.abs(b.y - y((row.r + 1) * 125)) < 1.01);
    expect(block, "the peak row has a block").toBeTruthy();
    const py = block.y + block.h / 2,
      plotRight = layout[0] + layout[2];
    // the pixel of the strip is exactly its entry; the band at the plot's right edge is the Rows entry at 16% over the page background
    expect(await pixelAt(page, layout[4] + 6, py), "the strip is opaque").toBe(block.fill);
    const band = await pixelAt(page, plotRight - 20, py);
    // the band is the Rows role's own entry (the peak row is the last one) at 16%, where the strip is the unsigned table's entry at full strength
    expect(block.fill, "the strip takes the last entry of the unsigned table for the peak row").toBe(colours.unsigned[255]);
    const want = over(colours.rows[255], 0.16, colours.bg),
      got = rgbOf(band);
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i]), `channel ${i}: 0.16 of the Rows role's entry over the page background (${band} vs ${want})`).toBeLessThanOrEqual(1);
  });

  test("an opaque trade cell is its own entry; a movement-only outline sits on a neutral interior while empty cells show the band", async ({ freshContext, fakeFor }) => {
    const { addRecorder, openView, pageColours, lastDraw, rectOf, boxOf } = require("./cells-support.js");
    const { probeTools } = require("./fixtures.js");
    const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
    const fake = await fakeFor("micro:paths");
    const context = await freshContext({ reducedMotion: "reduce" });
    await addRecorder(context);
    const page = await context.newPage();
    await openView(page, fake, probeTools.forPage(page), `#t=${view.from}~${view.to}&p=${view.low}~${view.high}&r=0,0&mode=path&rows=volume&period=1d&vis=2`);
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    const colours = await pageColours(page),
      draw = await lastDraw(page),
      motion = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "fixtures", "trades", "paths.json"), "utf8")).expected.motion["0:0"];
    const rect = rectOf(view);
    const centre = (z) => {
      const b = boxOf(draw.plot, rect, 0, 0, z.c, z.r);
      return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    };
    // a movement-only cell with a path: neutral interior
    const moved = motion.find((z) => z.ct === 0 && z.p > 0);
    const [mx, my] = centre(moved);
    expect(await pixelAt(page, mx, my), "the interior of a movement-only cell is the surface, whatever row colour lies under it").toBe(colours.surface);
    // a traded cell: exactly its entry (not tinted by the band under it)
    const traded = motion.find((z) => z.ct > 0 && z.p > 0);
    // an empty cell of a row the period traded in shows the projection: the surface is tinted by the Rows role at 16%
    const empty = { c: 3, r: 202 };
    expect(motion.some((z) => z.c === empty.c && z.r === empty.r), "the fixture has no motion at (3, 202)").toBe(false);
    const ebox = boxOf(draw.plot, rect, 0, 0, empty.c, empty.r),
      tinted = await pixelAt(page, (ebox.x0 + ebox.x1) / 2, (ebox.y0 + ebox.y1) / 2),
      ground = await palette(page);
    expect(tinted, "not the bare surface").not.toBe(ground.surface);
    expect(
      ground.rows.some((entry) => over(entry, 0.16, ground.surface).every((c, i) => Math.abs(c - rgbOf(tinted)[i]) <= 1)),
      `${tinted} is an entry of the Rows role at 16% over the surface`,
    ).toBe(true);
    const tbox = boxOf(draw.plot, rect, 0, 0, traded.c, traded.r);
    const fill = opsOf(draw, tbox).find((o) => o.op === "fillRect");
    // the four inner corners, three pixels in: a POC line or a grid line can cross one of them, not all
    const seen = [];
    for (const [px, py] of [[tbox.x0 + 3, tbox.y0 + 3], [tbox.x1 - 3, tbox.y0 + 3], [tbox.x0 + 3, tbox.y1 - 3], [tbox.x1 - 3, tbox.y1 - 3]]) seen.push(await pixelAt(page, px, py));
    expect(seen, "an opaque cell covers the projection completely: its own entry at an inner corner").toContain(fill.style);
  });

  function opsOf(draw, box) {
    const { opsOfBox } = require("./cells-support.js");
    return opsOfBox(draw, box);
  }
});

test.describe("B28 Relative volume draws only inside its comparison support", () => {
  const stream = S.identical();
  const VIEW_COLS = [S.END_COL - 300, S.END_COL + 300];
  const SELECTION_COLS = [S.END_COL - 200, S.END_COL - 100];
  const W = [200, 206];

  async function open(page, fakeFor, probe, pane) {
    const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
    await page.goto(`${fake.url}/${S.address({ cols: VIEW_COLS, rows: [196, 210], rowsKind: "relvol", selection: { cols: SELECTION_COLS, rows: [201, 204] }, extra: "&vis=2" })}`);
    await S.atRest(page, fake, probe);
    return { fake, frame: await pane.last(), layout: await layoutOf(page), colours: await palette(page) };
  }

  test("the strip has all period rows, including those outside the selection", async ({ page, probe, fakeFor, pane }) => {
    const { frame, layout, colours } = await open(page, fakeFor, probe, pane);
    const y = priceAxis(frame);
    const blocks = blocksOf(frame, layout[4], layout[3]).filter((b) => b.fill !== colours.surface);
    expect(blocks.length, "one block per row of W").toBe(W[1] - W[0]);
    expect(new Set(blocks.map((b) => b.fill)).size).toBeGreaterThan(1);
    for (let r = W[0]; r < W[1]; r++) expect(blocks.some((b) => Math.abs(b.y - y((r + 1) * 125)) < 1.01), `row ${r} of W`).toBe(true);
    // no block for the rows the period traded and W left out
    for (const r of [199, 206, 207]) expect(blocks.some((b) => Math.abs(b.y - y((r + 1) * 125)) < 1.01), `row ${r} is outside W`).toBe(false);
  });

  test("the strip's readout says outside comparison support outside W, and names the support inside it", async ({ page, probe, fakeFor, pane }) => {
    const { frame, layout } = await open(page, fakeFor, probe, pane);
    const y = priceAxis(frame),
      box = await page.locator("#ol-canvas").boundingBox();
    const tipAt = async (r) => {
      await page.mouse.move(box.x + layout[4] + 6, box.y + (y((r + 1) * 125) + y(r * 125)) / 2);
      await expect(page.locator("#ol-tip")).toBeVisible();
      return page.locator("#ol-tip").innerText();
    };
    expect(await tipAt(199), "a row the period traded and W left out").toContain("Outside comparison support");
    const inside = await tipAt(202);
    expect(inside, "the concentration measure").toContain("Row volume versus mean traded row");
    expect(inside, "the separate comparison").toContain("Profile-share log₂ ratio");
    expect(inside, "the support W, in USDT").toMatch(/Period price range\s*\d[\d,]*–\d[\d,]* USDT/);
    const record = JSON.parse(await page.locator("#ol-tip").getAttribute("data-observation"));
    expect(record.formula).toBe("rows.relvol@3");
    expect(record.denominators[1].formula).toBe("rows.relvol@2");
    expect(record.denominators[1].support.bm).toBe(0);
  });
});
