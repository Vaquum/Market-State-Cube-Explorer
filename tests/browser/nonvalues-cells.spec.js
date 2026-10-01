"use strict";
// nonvalues-cells.spec.js (package C): B16a, the keyed presentation of what a Cells mark is when it is not a plain value
// (TESTPLAN 3.4 B16 "a"; the catalogue's one file nonvalues.spec.js is split by owner so that the three packages add three files
// and never one: B16b is Rows', B16c the Columns').
//
// Covers: S1-040, S1-064, S1-065 (zero Delta at the midpoint, the unsigned zero keyed "Zero (occupied)", Cascade's non-values as
// neutral patterns), DR-21, DD-16, DD-38 (Cascade's structure before the child), the Geometry outline (C-05) and the Path and
// Dwell marks (C-08a..d), all read on the CANVAS.
//
// Oracles (none of them is the code under test's output for the same question):
//   - tests/fixtures/trades/*.json: hand-computed cells, the `notes` of each say why (balanced: two 100 USDT trades, one taker buy,
//     one sell, so volume 200, bv 100 and Delta exactly 0 while the count is 2);
//   - tests/reference (exact-rational cells and motion from the trade list) for the counts and the cells of a view;
//   - the pinned Lut entry and the pattern tiles, asked of window.explorerEncoding in the page (the module whose hash U18 pins);
//     which ENTRY a coordinate is comes from the fixture's hand value and the fixed domain of the measure (Cascade -2..+2, Dwell
//     0..1): the expected index is written out from those, not read from the page;
//   - the recorder of cells-support.js, which observes the ops the page issued on the canvas, and getImageData at DPR 1.
// Every test runs in a context with reducedMotion "reduce" so that no 170 ms morph frame can be the one captured.
//
// What this does NOT cover (other packages' spec or not yet in the tree): the legend keys and the chip (U, B23), the tooltip and
// table readouts (T, B03), the tally and the warnings (S, B09), a measure's Amount/Intensity choice (U's menu).
const { test, expect, probeTools } = require("./fixtures.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox, expectMovementMark } = require("./cells-support.js");
const reference = require("../reference/index.js");
const fs = require("node:fs");
const path = require("node:path");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "trades", `${name}.json`), "utf8"));

// The whole-minute rectangle the nonvalues fixture is measured on: 00:00 to 00:06 is 6.4 base columns, the cutoff, so the last
// (open) column holds nothing and every cell of the fixture is complete.
const VIEW = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
const address = (view, level, mode) => `#t=${view.from}~${view.to}&p=${view.low}~${view.high}&r=${level[0]},${level[1]}&mode=${mode}`;

// The entry of a coordinate: round(|t| * 255) (E.scale.index, API C.3), written out here so that the expected entry is not read back
// from the code under test. A fixed 0..1 measure has t = its value; the fixed log2 measure t = value / 2 (domain -2..+2, midpoint 0).
const entry = (t) => Math.round(Math.abs(t) * 255);

async function open({ freshContext, fakeFor }, profile, hash) {
  const fake = await fakeFor(profile);
  const context = await freshContext({ reducedMotion: "reduce" });
  await addRecorder(context);
  const page = await context.newPage();
  const probe = probeTools.forPage(page);
  await openView(page, fake, probe, hash);
  return { fake, context, page, probe };
}

const hex = (px) => `#${px.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const pixel = (page, x, y) =>
  page.evaluate(([px, py]) => [...document.getElementById("ol-canvas").getContext("2d").getImageData(px, py, 1, 1).data], [Math.round(x), Math.round(y)]).then(hex);

test.describe("B16a zero, midpoint and outlines", () => {
  test("a balanced traded Delta cell is drawn at the midpoint, not at the surface", async ({ freshContext, fakeFor }) => {
    // micro:balanced: one cell (column 0, row 200) with volume 200 and Delta exactly 0, and nothing around it.
    const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:02Z", low: 25000, high: 25125 };
    const { page } = await open({ freshContext, fakeFor }, "micro:balanced", address(view, [0, 0], "delta"));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const box = boxOf(draw.plot, rectOf(view), 0, 0, 0, 200);
    const ops = opsOfBox(draw, box);
    expect(ops, "the one cell is painted exactly once").toHaveLength(1);
    expect(ops[0].op, "a signed zero is a fill").toBe("fillRect");
    expect(ops[0].style, "at the midpoint entry of the pinned Lut").toBe(colours.midpoint);
    expect(colours.midpoint, "which is not the empty surface").not.toBe(colours.surface);
    // The pixel at the cell's centre is that entry, and the empty column beside it (the open column) is the surface.
    expect(await pixel(page, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2)).toBe(colours.midpoint);
    expect(await pixel(page, box.x1 + 60, (box.y0 + box.y1) / 2), "the surface shows where nothing traded").toBe(colours.surface);
  });

  test("an unsigned zero is the occupancy outline 'Zero (occupied)': never a fill, never the lowest entry", async ({ freshContext, fakeFor }) => {
    // The same two trades at one price: Path is exactly 0 in the traded cell (column 0) and in the movement-only cell after it
    // (column 1, where the price only held). Both are occupied cells with no magnitude.
    const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:02Z", low: 25000, high: 25125 };
    const { page } = await open({ freshContext, fakeFor }, "micro:balanced", address(view, [0, 0], "path"));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const rect = rectOf(view);
    for (const c of [0, 1]) {
      const box = boxOf(draw.plot, rect, 0, 0, c, 200);
      const ops = opsOfBox(draw, box);
      expect(ops, `column ${c}: painted once`).toHaveLength(1);
      expect(ops[0].op, `column ${c}: an outline, not a fill`).toBe("strokeRect");
      expect(ops[0].style, `column ${c}: in the occupancy ink`).toBe(colours.lutOccupancy);
      expect(ops[0].lineWidth, "one pixel wide, set explicitly").toBe(1);
      expect(ops[0].alpha, "at alpha 1").toBe(1);
      expect(await pixel(page, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2), `column ${c}: the inside is the surface`).toBe(colours.surface);
    }
    // No fill anywhere in the plot takes the lowest entry of the unsigned ramp: an entry 0 would say "least", not "zero".
    const lowest = draw.ops.filter((op) => op.op === "fillRect" && op.style === colours.unsigned[0]);
    expect(lowest, "no mark is drawn with entry 0").toEqual([]);
  });

  test("Geometry draws one occupancy outline per occupied cell, at alpha 1, one pixel wide", async ({ freshContext, fakeFor }) => {
    const trades = fixture("nonvalues");
    const { page } = await open({ freshContext, fakeFor }, "micro:nonvalues", address(VIEW, [0, 0], "geometry"));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const occupied = reference.cells(trades.trades, { n: 0, m: 0, b0: 0, b1: 7 });
    expect(occupied, "the fixture has three occupied cells").toHaveLength(3);
    const [px, py, pw, ph] = draw.plot;
    const outlines = draw.ops.filter((op) => op.op === "strokeRect" && op.style === colours.lutOccupancy && op.x >= px && op.y >= py && op.x + op.w <= px + pw + 1 && op.y + op.h <= py + ph + 1);
    expect(outlines, "one outline in the occupancy ink per occupied cell").toHaveLength(occupied.length);
    for (const op of outlines) {
      expect(op.lineWidth).toBe(1);
      expect(op.alpha, "not the 0.4 of the green it replaces").toBe(1);
    }
    // Each one lies on an occupied cell's box.
    const rect = rectOf(VIEW);
    for (const cell of occupied) {
      const box = boxOf(draw.plot, rect, 0, 0, cell.c, cell.r);
      expect(opsOfBox({ ops: outlines }, box), `cell ${cell.c}:${cell.r}`).toHaveLength(1);
    }
    expect(draw.ops.filter((op) => op.op === "fillRect" && op.style.startsWith("pattern:")), "Geometry has no pattern").toEqual([]);
  });

  test("Cascade: a complete parent is coloured on the fixed -2..+2 scale, an open parent is the neutral pattern", async ({ freshContext, fakeFor }) => {
    // nonvalues at level (1,1): children (0,100) and (1,101) (100 and 101.5 USDT, hand values of the fixture) share the parent (0,50)
    // of 201.5 USDT, log2(4 x 100 / 201.5) = 0.9892 and log2(4 x 101.5 / 201.5) = 1.0107; child (2,101) is alone in a parent that
    // covers columns 4..8 and so runs past the cutoff (6.4): the parent is not complete and the child has no value yet, which the
    // baseline drew as a plain line colour.
    const trades = fixture("nonvalues");
    const { page } = await open({ freshContext, fakeFor }, "micro:nonvalues", address(VIEW, [1, 1], "cascade"));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const rect = rectOf(VIEW);
    const level = reference.cells(trades.trades, { n: 1, m: 1, b0: 0, b1: 7 });
    const parents = reference.cells(trades.trades, { n: 2, m: 2, b0: 0, b1: 7 });
    expect(level.map((z) => `${z.c}:${z.r}`)).toEqual(["0:100", "1:101", "2:101"]);
    const cutoffBase = 6.4;
    for (const z of level) {
      const pc = Math.floor(z.c / 2);
      const parent = parents.find((p) => p.c === pc && p.r === Math.floor(z.r / 2));
      const open = (pc + 1) * 4 > cutoffBase;
      const box = boxOf(draw.plot, rect, 1, 1, z.c, z.r);
      const ops = opsOfBox(draw, box);
      expect(ops, `cell ${z.c}:${z.r} painted once`).toHaveLength(1);
      if (open) {
        expect(ops[0].op).toBe("fillRect");
        expect(ops[0].style, `cell ${z.c}:${z.r}: the neutral pattern of "not yet defined" (waiting for its parent)`).toBe(colours.tiles["pattern-slate"]);
      } else {
        const value = Math.log2((4 * z.v) / parent.v);
        expect(parent.v, "hand value of the parent").toBe(201.5);
        expect(ops[0].style, `cell ${z.c}:${z.r}: the positive arm at t = value / 2`).toBe(colours.positive[entry(value / 2)]);
      }
    }
  });

  test("a pattern cell too small for its tile is a flat neutral fill", async ({ freshContext, fakeFor }) => {
    // micro:balanced at level (1,0) over 10,000 to 40,000 USDT: the cell's parent runs past the cutoff (waiting for it), and one
    // row of the 240 in view is 2.65 px tall, under the 4 px a hatch needs to be seen.
    const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:02Z", low: 10000, high: 40000 };
    const { page } = await open({ freshContext, fakeFor }, "micro:balanced", address(view, [1, 0], "cascade"));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const box = boxOf(draw.plot, rectOf(view), 1, 0, 0, 200);
    expect(box.y1 - box.y0, "under the 4 px threshold").toBeLessThan(4);
    const ops = opsOfBox(draw, box);
    expect(ops, "painted once").toHaveLength(1);
    expect(ops[0].style, "the state ink, flat").toBe(colours.state);
    expect(ops[0].alpha, "at a fraction of the ink").toBeCloseTo(0.3, 6);
    expect(draw.ops.filter((op) => op.style.startsWith("pattern:") && op.y >= box.y0 - 2 && op.y <= box.y1 + 2), "no tile over the cell").toEqual([]);
  });

  test("at device pixel ratio 2 the pattern tile is twice the pixels and keeps its css period", async ({ freshContext, fakeFor }) => {
    // The waiting cell of the Cascade view above, on a canvas of 2 device px per css px. The tile is built in device pixels (12 for
    // a 6 css px period) and the pattern undoes the device scale, so the hatch repeats every 6 css px = 12 device px across a row.
    const fake = await fakeFor("micro:nonvalues");
    const context = await freshContext({ reducedMotion: "reduce", deviceScaleFactor: 2 });
    await addRecorder(context);
    const page = await context.newPage();
    await openView(page, fake, probeTools.forPage(page), address(VIEW, [1, 1], "cascade"));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const box = boxOf(draw.plot, rectOf(VIEW), 1, 1, 2, 101);
    const ops = opsOfBox(draw, box);
    expect(ops).toHaveLength(1);
    expect(ops[0].style.startsWith("pattern:12x12:"), "a 12 x 12 device pixel tile").toBe(true);
    expect(ops[0].style, "the tile the module builds at this ratio").toBe(colours.tiles["pattern-slate"]);
    // Along one row inside the cell (near its top, clear of the price line that crosses its middle) the hatch lines cross every
    // 12 device pixels. The faint "unfinished" hatch the page lays over a cell next to the live edge is lighter than this ink.
    // (a label's plate is opaque, so a row is chosen that no label covers: the first of several that shows the whole hatch)
    const x0 = Math.round((box.x0 + 8) * 2);
    let at = [];
    for (const offset of [40, 56, 72, 88, 104, 24]) {
      const y = Math.round(box.y0 * 2) + offset;
      const row = await page.evaluate(([x, yy, n]) => {
        const data = document.getElementById("ol-canvas").getContext("2d").getImageData(x, yy, n, 1).data;
        const out = [];
        for (let i = 0; i < n; i++) out.push(data[i * 4]);
        return out;
      }, [x0, y, 120]);
      const ink = row.map((v, i) => (v < 150 ? i : -1)).filter((i) => i >= 0);
      // Group adjacent ink pixels into one crossing each and take their centres.
      const centres = [];
      for (const i of ink) {
        const last = centres[centres.length - 1];
        if (last && i - last.end <= 1) last.end = i;
        else centres.push({ start: i, end: i });
      }
      at = centres.map((c) => (c.start + c.end) / 2);
      if (at.length >= 8 && at.every((v, i) => i === 0 || Math.abs(v - at[i - 1] - 12) < 0.5)) break;
    }
    expect(at.length, "several crossings in 120 device px").toBeGreaterThanOrEqual(8);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1], "one crossing every 12 device px").toBeCloseTo(12, 0);
  });

  test("Dwell cells: traded cells are filled, movement-only cells outlined in the colour of their value, zero dwell in the occupancy ink", async ({ freshContext, fakeFor }) => {
    // nonvalues, hand values of the fixture: (col, row, dwell seconds, traded). A column's covered time is 56.25 s, so the share is
    // w / 56.25 on the fixed 0..1 mapping: nothing is renormalised, column 0's 46.25 s is 0.822 and not 1.
    const expected = fixture("nonvalues").expected.motion["0:0"];
    const { page } = await open({ freshContext, fakeFor }, "micro:nonvalues", address(VIEW, [0, 0], "dwell"));
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const rect = rectOf(VIEW);
    expect(expected).toHaveLength(9);
    for (const z of expected) {
      const box = boxOf(draw.plot, rect, 0, 0, z.c, z.r);
      const ops = opsOfBox(draw, box);
      const share = z.w / 56.25;
      if (z.w !== 0 && !(z.ct > 0)) {
        expectMovementMark(expect, draw, box, colours.unsigned[entry(share)], colours.surface, `cell ${z.c}:${z.r}: share ${share}, the movement mark in its own colour`);
        continue;
      }
      expect(ops, `cell ${z.c}:${z.r}: painted once`).toHaveLength(1);
      if (z.w === 0) {
        expect(ops[0].op, `cell ${z.c}:${z.r}: zero dwell is an outline`).toBe("strokeRect");
        expect(ops[0].style, "in the occupancy ink").toBe(colours.lutOccupancy);
      } else if (z.ct > 0) {
        expect(ops[0].op, `cell ${z.c}:${z.r}: a traded cell is filled`).toBe("fillRect");
        expect(ops[0].style, `share ${share}`).toBe(colours.unsigned[entry(share)]);
      }
    }
  });
});
