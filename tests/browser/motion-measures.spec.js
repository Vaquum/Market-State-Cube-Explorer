"use strict";
// motion-measures.spec.js (package C): B17, what the Path and Dwell cells look like on the canvas (TESTPLAN 3.4 B17, the part that is
// Cells' to draw; the hover numbers, the Short exposure labels and the readout lines of the same catalogue row are read from the
// tooltip and the table, which package T builds, so they are T's B03 and not written here).
//
// Covers: S1-034..038 (Dwell is never renormalised and a material negative dwell is a typed failure, not a clamp), S1-047 and
// S1-051..055 (Path in row spans, the cohort stops where the read ends), DR-12, C-08a..d (traded cells filled, cells the price only
// moved through or held in outlined, cells not read yet drawn as the pending pattern).
//
// Oracles (none of them is the code under test's output for the same question):
//   - tests/fixtures/trades/paths.json, gaps.json and nonvalues.json: the hand-computed motion cells of the fixtures (path in USDT,
//     dwell in seconds, trade counts), whose `notes` derive them; a cell's Path in row spans is its hand path over the 125 USDT
//     row, its Dwell share its hand seconds over the column's 56.25 s: nothing is renormalised;
//   - the fitted mapping of the Path views is computed here from those hand values: U is the largest, k the Type-7 median of the
//     non-zero ones (API C.4), by the module the page carries (tests/support/enc.js) applied to OUR cohort, so a cohort that
//     differs from the page's (one that kept a cell beyond the read's end, or left a movement-only cell out) gives another entry;
//   - the pinned Lut and the pattern tiles asked of window.explorerEncoding in the page, and the canvas recorder of cells-support.js.
// Every test runs with reducedMotion "reduce" (no morph frame can be the one captured).
//
// What this does NOT cover: the Amount/Intensity and the Path basis choices (a menu, package U), Intensity of cut cells on the
// `uniform` profile (needs that choice), the legend and the warnings (S, U), the readouts (T).
const { test, expect, probeTools } = require("./fixtures.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox } = require("./cells-support.js");
const E = require("../support/enc.js");
const fs = require("node:fs");
const path = require("node:path");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "trades", `${name}.json`), "utf8"));

const VIEW = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
const address = (mode) => `#t=${VIEW.from}~${VIEW.to}&p=${VIEW.low}~${VIEW.high}&r=0,0&mode=${mode}`;
const entry = (t) => Math.round(Math.abs(t) * 255);
const COLUMN_SECONDS = 56.25;
const ROW_USDT = 125;

async function open({ freshContext, fakeFor }, profile, mode, prepare = () => {}) {
  const fake = await fakeFor(profile);
  prepare(fake);
  const context = await freshContext({ reducedMotion: "reduce" });
  await addRecorder(context);
  const page = await context.newPage();
  await openView(page, fake, probeTools.forPage(page), address(mode));
  return { fake, page };
}

// The Explore mapping of a cohort of values: the module's own fit and evaluation, on the values we computed.
function explore(values) {
  const fit = E.scale.fitValue(values, { signed: false });
  expect(fit.state).toBe("ok");
  const out = { t: 0, clip: 0, state: null };
  const plan = E.scale.plan(fit.descriptor);
  return { desc: fit.descriptor, index: (x) => entry(plan.apply(x, out).t) };
}

// What each hand cell must be painted as: a traded cell with a value is a fill, a zero an outline in the occupancy ink, a cell
// only crossed or held in an outline in the colour of its value.
function expectMark(ops, z, value, index, colours, what) {
  expect(ops, `${what}: painted once`).toHaveLength(1);
  if (value === 0) {
    expect(ops[0].op, `${what}: zero is an outline`).toBe("strokeRect");
    expect(ops[0].style, `${what}: in the occupancy ink`).toBe(colours.lutOccupancy);
  } else if (z.ct > 0) {
    expect(ops[0].op, `${what}: a traded cell is a fill`).toBe("fillRect");
    expect(ops[0].style, `${what}: value ${value}`).toBe(colours.unsigned[index(value)]);
  } else {
    expect(ops[0].op, `${what}: a cell the price only crossed or held in is an outline`).toBe("strokeRect");
    expect(ops[0].style, `${what}: value ${value}, in its own colour`).toBe(colours.unsigned[index(value)]);
  }
}

test.describe("B17 Path and Dwell on the canvas", () => {
  test("Path in row spans is shaded on the Value mapping fitted over the whole cohort, movement-only cells included", async ({ freshContext, fakeFor }) => {
    const cells = fixture("paths").expected.motion["0:0"];
    const spans = cells.map((z) => z.p / ROW_USDT);
    const { page } = await open({ freshContext, fakeFor }, "micro:paths", "path");
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const { index } = explore(spans);
    // Hand check of the fit: six cells at 0.5 and four at 1 (the zeros do not count), so U = 1 and the median k = 0.5.
    expect(index(1), "the largest value takes the last entry").toBe(255);
    expect(index(0.5), "t = log1p(0.5 / 0.5) / log1p(1 / 0.5) = 0.6309").toBe(161);
    cells.forEach((z, i) => expectMark(opsOfBox(draw, boxOf(draw.plot, rectOf(VIEW), 0, 0, z.c, z.r)), z, spans[i], index, colours, `cell ${z.c}:${z.r}`));
  });

  test("a motion read that ends early: the cohort stops at its end and the unread traded cells are the pending pattern", async ({ freshContext, fakeFor }) => {
    // The cube measures the first four base columns only. Columns 4 and 5 were never read: their traded cells are "reading", never
    // a value and never a zero. The fit is over the cells before the end: eight non-zero spans, four at 0.5 and four at 1, so the
    // median is 0.75 and not the 0.5 of the whole cohort.
    const all = fixture("paths").expected;
    const read = all.motion["0:0"].filter((z) => z.c < 4);
    const spans = read.map((z) => z.p / ROW_USDT);
    const { page } = await open({ freshContext, fakeFor }, "micro:paths", "path", (fake) => fake.motionThrough(4));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const { index } = explore(spans);
    expect(index(0.5), "log1p(0.5 / 0.75) / log1p(1 / 0.75)").toBe(154);
    read.forEach((z, i) => expectMark(opsOfBox(draw, boxOf(draw.plot, rectOf(VIEW), 0, 0, z.c, z.r)), z, spans[i], index, colours, `cell ${z.c}:${z.r}`));
    const unread = all.cells["0:0"].filter((z) => z.c >= 4);
    expect(unread.length, "the fixture has traded cells after the end").toBeGreaterThan(0);
    for (const z of unread) {
      const ops = opsOfBox(draw, boxOf(draw.plot, rectOf(VIEW), 0, 0, z.c, z.r));
      expect(ops, `cell ${z.c}:${z.r} is painted once`).toHaveLength(1);
      expect(ops[0].style, `cell ${z.c}:${z.r}: the pattern of a read that has not finished`).toBe(colours.tiles["pattern-dots"]);
    }
  });

  test("Dwell is each cell's seconds over its column's covered seconds, never renormalised to fill the column", async ({ freshContext, fakeFor }) => {
    // gaps: two intervals the cube did not observe. Column 1 holds 3.75 s of dwell in a 56.25 s column: a share of 0.0667 and not 1.
    const cells = fixture("gaps").expected.motion["0:0"];
    const { page } = await open({ freshContext, fakeFor }, "micro:gaps", "dwell");
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const shares = cells.map((z) => z.w / COLUMN_SECONDS);
    expect(shares[1], "hand value of column 1").toBeCloseTo(0.0667, 4);
    cells.forEach((z, i) => expectMark(opsOfBox(draw, boxOf(draw.plot, rectOf(VIEW), 0, 0, z.c, z.r)), z, shares[i], (v) => entry(v), colours, `cell ${z.c}:${z.r}`));
  });

  test("a material negative dwell is a failed input drawn as the crosshatch, not clamped to zero or to a colour", async ({ freshContext, fakeFor }) => {
    // The fake writes dwell -1 into the first cell of every motion block, (0, 200). Every other cell keeps its hand value.
    const cells = fixture("nonvalues").expected.motion["0:0"];
    const { page } = await open({ freshContext, fakeFor }, "micro:nonvalues", "dwell", (fake) => fake.corrupt({ dwell: -1 }));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const bad = opsOfBox(draw, boxOf(draw.plot, rectOf(VIEW), 0, 0, 0, 200));
    expect(bad, "the corrupted cell is painted once").toHaveLength(1);
    expect(bad[0].op).toBe("fillRect");
    expect(bad[0].style, "as the crosshatch of a failed value").toBe(colours.tiles["pattern-cross"]);
    // A neighbour is untouched: column 4's traded cell keeps its 56.25 s of 56.25.
    const z = cells.find((c) => c.c === 4 && c.r === 203);
    const ok = opsOfBox(draw, boxOf(draw.plot, rectOf(VIEW), 0, 0, z.c, z.r));
    expect(ok).toHaveLength(1);
    expect(ok[0].style).toBe(colours.unsigned[255]);
  });
});
