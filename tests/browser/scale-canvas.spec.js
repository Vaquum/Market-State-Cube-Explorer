"use strict";
// scale-canvas.spec.js (S, stage 2b): the CANVAS carries the mapping the chip names (TESTPLAN 3.3: a DOM audit cannot see the canvas).
//
// The spine resolves one mapping per channel and hands a frame to the painters; the chip says which mapping that is. This file
// closes the loop on the pixels: for every occupied cell of a cell-aligned rectangle the colour the page PAINTED (the recorder of
// cells-support.js keeps every fillRect with the fill in force) is the entry of the pinned Lut that the mapping's formula gives for
// the cell's value. Three situations, because each is a different path through the spine:
//   1. Explore on the live cube: the fitted mapping (U, k read from the chip's details) through log1p(v / k) / log1p(U / k).
//   2. A theme flip: the same cells, the same entries, the dark table; nothing is fetched and nothing is refitted (S1-012, D.12).
//   3. Replay on an earlier edge: the mapping of the REPLAY workspace, fitted on observations up to the edge, is what is painted.
//
// Oracles: the cell values come from the exact-rational reference calculator (tests/reference) over the same trades the fake serves;
// the formula is the one written in API.md C.3 (Value, unsigned: t = log1p(|v| / k) / log1p(U / k), entry = round(clamp(t) * 255)),
// typed out here; the Lut entries are the pinned table asked of the page's module (the module whose hash U18 pins), and which ENTRY
// is expected comes from the formula, never from the page. U and k are the mapping under test, read from its own details.
// Every test runs with reducedMotion "reduce" so that no 170 ms morph frame can be the one recorded.
//
// Not covered: signed scales and the non-value marks (C's B16a), Rows bands (R's B10), the lens (L's B12).
const { test, expect, probeTools } = require("./fixtures.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox } = require("./cells-support.js");
const { observe } = require("./observe.js");
const { calm, field, tradesOf, priceRowsOf, baseOf } = require("./scale-helpers.js");
const reference = require("../reference/index.js");

const FINE = { from: "2026-09-22T00:00Z", to: "2026-09-23T00:00Z", n: 7, m: 0 };
const address = (r, rows, extra = "") => `#t=${r.from}~${r.to}&p=${rows[0] * 125}~${rows[1] * 125}&r=${r.n},${r.m}${extra}`;

async function open({ freshContext, fakeFor }, hash) {
  const fake = await fakeFor("standard");
  const context = await freshContext({ reducedMotion: "reduce" });
  await addRecorder(context);
  const page = await context.newPage();
  const probe = probeTools.forPage(page);
  const surface = observe(page);
  await openView(page, fake, probe, hash);
  await page.locator("#ol-reference-toggle").click();
  await page.locator("#ol-reference-topic").selectOption("scales");
  const ctx = { page, fake, probe, surface };
  await calm(ctx);
  return ctx;
}

// The entry the formula gives for a value under (U, k): API.md C.3, unsigned Value (log).
const entryOf = (v, U, k) => Math.round(Math.min(1, Math.max(0, Math.log1p(Math.abs(v) / k) / Math.log1p(U / k))) * 255);

// For every occupied cell: the paint ops on its box, and the colour expected from the mapping. Returns the mismatches and the count.
async function compare(ctx, cells, r, n, m, edgeBase = Infinity, theme = "light") {
  const { page, surface } = ctx;
  const details = await surface.details("cells");
  const U = Number(field(details, "U"));
  const k = Number(field(details, "k"));
  const colours = await pageColours(page, theme);
  const draw = await lastDraw(page);
  const rect = rectOf({ from: r.from, to: r.to, low: r.low, high: r.high });
  const wrong = [];
  let checked = 0;
  for (const cell of cells) {
    const ts = 2 ** n;
    if ((cell.c + 1) * ts > edgeBase) continue; // not complete before the edge: not drawn as a value, not in the cohort
    const box = boxOf(draw.plot, rect, n, m, cell.c, cell.r, edgeBase);
    const ops = opsOfBox(draw, box);
    const expected = colours.unsigned[entryOf(cell.v, U, k)];
    checked += 1;
    if (ops.length !== 1 || ops[0].op !== "fillRect" || ops[0].style !== expected) wrong.push({ cell: `${cell.c}:${cell.r}`, v: cell.v, expected, painted: ops.map((op) => `${op.op} ${op.style}`) });
  }
  return { wrong, checked, U, k };
}

test("Explore: every occupied cell is painted with the Lut entry its value has under the chip's mapping", async ({ freshContext, fakeFor }) => {
  const trades = tradesOf("standard");
  const rows = priceRowsOf(trades, FINE.from, FINE.to);
  const ctx = await open({ freshContext, fakeFor }, address(FINE, rows));
  const chip = (await ctx.surface.chip("cells")).data;
  expect(chip.state).toBe("ready");
  const view = { ...FINE, low: rows[0] * 125, high: rows[1] * 125 };
  const cells = reference.cells(trades, { n: FINE.n, m: FINE.m, b0: baseOf(FINE.from), b1: baseOf(FINE.to), r0: rows[0], r1: rows[1] }).filter((c) => c.v > 0);
  expect(cells.length, "the rectangle has cells to look at").toBeGreaterThan(20);
  const { wrong, checked } = await compare(ctx, cells, view, FINE.n, FINE.m);
  expect(checked).toBe(cells.length);
  expect(wrong, "no cell is painted with another entry than its value's").toEqual([]);
  // The fit put the largest cell at the top of the scale: the maximum is the top entry, exactly (S1-107, DR-06).
  const top = cells.reduce((a, b) => (b.v > a.v ? b : a));
  const colours = await pageColours(ctx.page);
  const draw = await lastDraw(ctx.page);
  const ops = opsOfBox(draw, boxOf(draw.plot, rectOf(view), FINE.n, FINE.m, top.c, top.r));
  expect(ops[0].style, "the largest cell of the cohort takes the last entry").toBe(colours.unsigned[255]);
});

test("a theme flip paints the same entries in the dark table and asks for nothing", async ({ freshContext, fakeFor }) => {
  const trades = tradesOf("standard");
  const rows = priceRowsOf(trades, FINE.from, FINE.to);
  const ctx = await open({ freshContext, fakeFor }, address(FINE, rows));
  const before = (await ctx.surface.chip("cells")).data;
  const view = { ...FINE, low: rows[0] * 125, high: rows[1] * 125 };
  const cells = reference.cells(trades, { n: FINE.n, m: FINE.m, b0: baseOf(FINE.from), b1: baseOf(FINE.to), r0: rows[0], r1: rows[1] }).filter((c) => c.v > 0);
  const light = await compare(ctx, cells, view, FINE.n, FINE.m, Infinity, "light");
  expect(light.wrong).toEqual([]);
  ctx.fake.clearLog();
  await ctx.probe.reset();
  await ctx.page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await ctx.probe.stats()).drawFrames, { message: "the flip drew the chart again" }).toBeGreaterThan(0);
  await ctx.probe.waitForQuiet({ quietMs: 400 });
  const dark = await compare(ctx, cells, view, FINE.n, FINE.m, Infinity, "dark");
  expect(dark.wrong, "the same cells, the entries of the dark table").toEqual([]);
  expect(dark.U, "the same mapping: nothing was refitted").toBe(light.U);
  const after = (await ctx.surface.chip("cells")).data;
  expect(after.mappingId).toBe(before.mappingId);
  expect(after.fitSeq).toBe(before.fitSeq);
  // The page's own pack poll (the liveness check on its timer, slot "poll") is not something the flip asked for: a read of the
  // measurement or the tiles would be.
  expect(ctx.fake.log().filter((entry) => entry.path.startsWith("/cube/") && entry.slot !== "poll"), "no read after the flip").toEqual([]);
});

test("Replay: the canvas paints the mapping fitted in the replay workspace, on observations up to the edge", async ({ freshContext, fakeFor }) => {
  const trades = tradesOf("standard");
  const rows = priceRowsOf(trades, FINE.from, FINE.to);
  const edge = "2026-09-22T12:00Z";
  const ctx = await open({ freshContext, fakeFor }, address(FINE, rows, `&replay=1&at=${edge}`));
  const chip = (await ctx.surface.chip("cells")).data;
  expect(chip.workspace).toBe("replay");
  expect(chip.state).toBe("ready");
  expect(Number(chip.fitThrough), "fitted on what had happened by the edge").toBeLessThanOrEqual(Date.parse(edge));
  const view = { ...FINE, low: rows[0] * 125, high: rows[1] * 125 };
  const edgeBase = baseOf(edge);
  const cells = reference.cells(trades, { n: FINE.n, m: FINE.m, b0: baseOf(FINE.from), b1: edgeBase, r0: rows[0], r1: rows[1] }).filter((c) => c.v > 0);
  expect(cells.length).toBeGreaterThan(5);
  const { wrong, checked } = await compare(ctx, cells, view, FINE.n, FINE.m, edgeBase);
  expect(checked).toBe(cells.length);
  expect(wrong, "the cells before the edge take the replay mapping's entries").toEqual([]);
});
