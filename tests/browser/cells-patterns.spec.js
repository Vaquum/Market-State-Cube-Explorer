"use strict";
// cells-patterns.spec.js (package C, stage 2b): the non-value patterns and the zero outline around the 4 css px threshold, at three
// device pixel ratios (DR-21, DD-37: "below minPx (4 css px in either dimension) a flat state-ink blend is used and the readout carries
// the tag"; tiles are built in device pixels and the pattern undoes the device scale, so the period stays 6 css px).
//
// For each kind a mark can have, a cell is drawn 3.4 css px tall and again 4.8 css px tall (the price range of the address is set so
// that one base row is that tall on the plot the page really drew):
//   - slate  ("not defined / waiting for its parent"): micro:balanced under Cascade, a child whose parent runs past the cutoff;
//   - dots   ("reading"): micro:paths under Path with the motion read ending at column 4, a traded cell of column 4;
//   - cross  ("failed / invalid input"): micro:nonvalues under Dwell with a corrupted (negative) dwell in its first cell;
//   - zero   (an unsigned zero, "Zero (occupied)"): micro:balanced under Path, the traded cell with no path; checked at 4.8, 3.4 and
//     2.6 px because a Path or Dwell zero keeps the movement outline geometry (catalogue N-06), not the flat 0.3 fill of a volume zero.
// Below the threshold each pattern is a fill of the state ink at alpha 0.3; above it each is the tile (asked of the page's own module at
// the page's ratio). The tile is 6 css px times the ratio wide for the hatched kinds, and the hatch keeps its css period: measured on
// the canvas along a row.
//
// Oracles: the threshold and the alpha are the documented numbers (API.md B.9, DR-21), the period is the role table's 6 px; the tile
// hashes come from the page's module as in cells-support.js; the cell's size on the plot is read from the recorder and the box rule.
const { test, expect, probeTools } = require("./fixtures.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox } = require("./cells-support.js");

const A = "&vis=2&ap=slate2-8f7890f7";
const ROW_USDT = 125;
const T = (from, to) => `#t=2021-01-01T${from}Z~2021-01-01T${to}Z`;

// Where a cell of row r is: one row is `px` css px tall. The plot's height comes from a first look at the page.
const rangeFor = (plotHeight, px, row) => {
  const span = (plotHeight / px) * ROW_USDT;
  const centre = (row + 0.5) * ROW_USDT;
  return { low: centre - span / 2, high: centre + span / 2 };
};

const CASES = [
  { kind: "slate", profile: "micro:balanced", mode: "cascade", level: [1, 0], time: ["00:00", "00:02"], cell: { c: 0, r: 200 }, tile: "pattern-slate", period: 6 },
  { kind: "dots", profile: "micro:paths", mode: "path", level: [0, 0], time: ["00:00", "00:06"], cell: { c: 4, r: 199 }, tile: "pattern-dots", prepare: (fake) => fake.motionThrough(4), period: 5 },
  { kind: "cross", profile: "micro:nonvalues", mode: "dwell", level: [0, 0], time: ["00:00", "00:06"], cell: { c: 0, r: 200 }, tile: "pattern-cross", prepare: (fake) => fake.corrupt({ dwell: -1 }), period: 6 },
];

async function look({ freshContext, fakeFor }, spec, dpr, px) {
  const fake = await fakeFor(spec.profile);
  if (spec.prepare) spec.prepare(fake);
  const context = await freshContext({ reducedMotion: "reduce", deviceScaleFactor: dpr });
  await addRecorder(context);
  const page = await context.newPage();
  const probe = probeTools.forPage(page);
  const address = (range) => `${T(...spec.time)}&p=${range.low}~${range.high}&r=${spec.level[0]},${spec.level[1]}&mode=${spec.mode}${A}`;
  // A first look at a generous range gives the plot's height; the second puts the cell at the height asked for.
  await openView(page, fake, probe, address({ low: 24000, high: 26000 }));
  const first = await lastDraw(page);
  const range = rangeFor(first.plot[3], px, spec.cell.r);
  await page.evaluate((h) => (location.hash = h), address(range));
  await probe.waitForQuiet({ quietMs: 700, timeout: 20000 });
  const draw = await lastDraw(page);
  const rect = { ...rectOf({ from: `2021-01-01T${spec.time[0]}Z`, to: `2021-01-01T${spec.time[1]}Z`, low: range.low, high: range.high }) };
  const box = boxOf(draw.plot, rect, spec.level[0], spec.level[1], spec.cell.c, spec.cell.r);
  return { page, context, draw, box, ops: opsOfBox(draw, box, 1.6) };
}

for (const spec of CASES) {
  for (const dpr of [1, 1.5, 2]) {
    test.describe(`${spec.kind} at device pixel ratio ${dpr}`, () => {
      test("3.4 css px tall: a flat fill of the state ink at 0.3, no tile", async ({ freshContext, fakeFor }) => {
        const { page, context, draw, box, ops } = await look({ freshContext, fakeFor }, spec, dpr, 3.4);
        const colours = await pageColours(page);
        expect(box.y1 - box.y0, "the cell is under the threshold").toBeLessThan(4);
        expect(ops, "painted once").toHaveLength(1);
        expect(ops[0].op).toBe("fillRect");
        expect(ops[0].style, "the state ink, flat").toBe(colours.state);
        expect(ops[0].alpha).toBeCloseTo(0.3, 6);
        expect(draw.ops.filter((op) => op.style.startsWith("pattern:") && op.y >= box.y0 - 2 && op.y <= box.y1 + 2), "no tile over it").toEqual([]);
        await context.close();
      });

      test("4.8 css px tall: the tile of its kind at this ratio, keeping its css period", async ({ freshContext, fakeFor }) => {
        const { page, context, box, ops } = await look({ freshContext, fakeFor }, spec, dpr, 4.8);
        const colours = await pageColours(page);
        expect(box.y1 - box.y0, "the cell is over the threshold").toBeGreaterThan(4.3);
        expect(ops, "painted once").toHaveLength(1);
        expect(ops[0].op).toBe("fillRect");
        expect(ops[0].style, "the tile the module builds for this kind at this ratio").toBe(colours.tiles[spec.tile]);
        // the tile is built in device pixels: its side is the css period times the ratio, to the pixel
        const side = Number(/^pattern:(\d+)x/.exec(ops[0].style)[1]);
        expect(Math.abs(side - spec.period * dpr), `a ${spec.period} css px tile is ${spec.period * dpr} device px`).toBeLessThanOrEqual(1);
        if (spec.tile !== "pattern-dots") {
          // along a row inside the cell the hatch lines cross every period * dpr device px
          const y = Math.round(((box.y0 + box.y1) / 2) * dpr);
          const x0 = Math.round((box.x0 + 12) * dpr);
          const n = Math.round(150 * dpr);
          const row = await page.evaluate(([x, yy, len]) => {
            const d = document.getElementById("ol-canvas").getContext("2d").getImageData(x, yy, len, 1).data;
            return Array.from({ length: len }, (_, i) => d[i * 4]);
          }, [x0, y, n]);
          const surface = Math.max(...row);
          const ink = row.map((v, i) => (v < surface - 40 ? i : -1)).filter((i) => i >= 0);
          const centres = [];
          for (const i of ink) {
            const last = centres[centres.length - 1];
            if (last && i - last.end <= 1) last.end = i;
            else centres.push({ start: i, end: i });
          }
          const at = centres.map((c) => (c.start + c.end) / 2);
          expect(at.length, "several crossings along the row").toBeGreaterThanOrEqual(6);
          const gaps = at.slice(1).map((v, i) => v - at[i]).sort((a, b) => a - b);
          const median = gaps[Math.floor(gaps.length / 2)];
          // a crosshatch's two diagonals cross a row at offsets that may interleave: half the period is the same tile
          const periods = spec.tile === "pattern-cross" ? [spec.period * dpr, (spec.period * dpr) / 2] : [spec.period * dpr];
          expect(Math.min(...periods.map((q) => Math.abs(median - q))), `the hatch repeats every ${periods.join(" or ")} device px`).toBeLessThanOrEqual(0.75);
        }
        await context.close();
      });
    });
  }
}

test.describe("an unsigned zero around the threshold", () => {
  const spec = { profile: "micro:balanced", mode: "path", level: [0, 0], time: ["00:00", "00:02"], cell: { c: 0, r: 200 } };
  test("4.8 css px tall: a 1 px outline in the occupancy ink at alpha 1", async ({ freshContext, fakeFor }) => {
    const { page, context, box, ops } = await look({ freshContext, fakeFor }, spec, 1, 4.8);
    const colours = await pageColours(page);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe("strokeRect");
    expect(ops[0].style).toBe(colours.lutOccupancy);
    expect(ops[0].lineWidth).toBe(1);
    expect(ops[0].alpha).toBe(1);
    expect(box.y1 - box.y0).toBeGreaterThan(4.3);
    await context.close();
  });
  // Path and Dwell keep the movement outline geometry for a zero (motionMark, which S2 owns): an outline while the cell is over 3 px, a
  // fill at alpha 0.45 of the same ink where it is not (the catalogue's N-06: listed, not changed by S1).
  test("3.4 css px tall (Path): still an outline, inset by one pixel", async ({ freshContext, fakeFor }) => {
    const { page, context, ops } = await look({ freshContext, fakeFor }, spec, 1, 3.4);
    const colours = await pageColours(page);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe("strokeRect");
    expect(ops[0].style).toBe(colours.lutOccupancy);
    expect(ops[0].alpha).toBe(1);
    await context.close();
  });
  test("2.6 css px tall (Path): a fill of the occupancy ink at 0.45", async ({ freshContext, fakeFor }) => {
    const { page, context, box, ops } = await look({ freshContext, fakeFor }, spec, 1, 2.6);
    const colours = await pageColours(page);
    expect(box.y1 - box.y0).toBeLessThan(3);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe("fillRect");
    expect(ops[0].style).toBe(colours.lutOccupancy);
    expect(ops[0].alpha).toBeCloseTo(0.45, 6);
    await context.close();
  });
});
