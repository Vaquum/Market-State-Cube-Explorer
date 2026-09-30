"use strict";
// B11 relative-volume.spec.js (R): Relative volume v2 in the page (TESTPLAN 3.4 B11). Covers S1-046 to S1-050 (one comparison support W for
// both distributions, typed cases instead of -2, outside W is not a zero-current row, the period's POC and value area keep their own
// periods, absolute amounts stay in the inspection), with the unit half in tests/unit/relative-volume.test.js (U14b).
//
// What is asserted, on the canvas and on the inspection:
//   1. identical conditional distributions read 0 on every row of W, for three different selections (three different W), and every
//      row outside W reads "outside comparison support": the canvas paints exactly |W| bands, all in the midpoint colour (the probe's
//      fillRect styles at the fixed Rows alpha, and the pixels of the plot at DPR 1 against the composite of the pinned LUT entry),
//      and nothing at all outside W;
//   2. a row only the period traded reads "no current volume" (negative infinity, its own words, never -2), a row only the rectangle
//      traded reads "no reference volume", a row neither traded reads "neither traded", and a row both traded reads the number the
//      exact reference gives;
//   3. the period's absolute amount and its point of control stay in the inspection, the point of control of the WHOLE period even
//      where the row is outside W.
// Oracles (none is the code under test): the two hand-authored trade streams of rows-support.js, whose answers follow from which
// rows traded where; tests/reference (exact rational sums) for the one finite number; the pinned LUT entry for the colour, composited
// with the same source-over arithmetic as the canvas.
// What this does NOT prove: the recorded snapshot's coarse rows (no stream here is coarse), other themes, other pixel ratios, and
// anything about the legend and the keys, which the DOM package owns (B23).
const { test, expect } = require("./fixtures.js");
const reference = require("../reference/index.js");
const S = require("./rows-support.js");

const VIEW_ROWS = [196, 210];
const VIEW_COLS = [S.END_COL - 300, S.END_COL + 300]; // the data ends in the middle of the view: the right half holds no cell
const SELECTION_COLS = [S.END_COL - 200, S.END_COL - 100];

// Where the plot is and how tall a price row is, from the pixels of the page at rest.
async function geometry(page, rows) {
  const plot = await S.plotRect(page, { x: 300, y: 300 });
  const box = await page.locator("#ol-canvas").boundingBox();
  if (process.env.DBG) console.log('GEO', JSON.stringify({plot, box}));
  return { plot, box, rowPx: (plot.y1 - plot.y0) / (rows[1] - rows[0]), top: (r) => plot.y0 + (rows[1] - r) * ((plot.y1 - plot.y0) / (rows[1] - rows[0])) };
}

// The text of the tooltip row with this label, hovering the profile strip at the centre of price row r.
async function rowReading(page, g, r, label) {
  await page.mouse.move(g.box.x + g.plot.x1 + 30, g.box.y + (g.top(r + 1) + g.top(r)) / 2);
  const tip = page.locator("#ol-tip");
  await expect(tip).toBeVisible();
  return tip.evaluate((el, name) => {
    const labels = [...el.querySelectorAll("dt")];
    const at = labels.find((dt) => dt.textContent.startsWith(name));
    return { value: at ? at.nextElementSibling.textContent : null, text: el.textContent };
  }, label);
}

test.describe("Relative volume v2 on the canvas: identical conditional distributions", () => {
  const cases = [
    { W: [201, 204], note: "a window inside the period's rows" },
    { W: [200, 203], note: "a window at the bottom" },
    { W: [203, 206], note: "a window at the top" },
  ];
  for (const { W, note } of cases) {
    test(`every row of W = [${W}) reads 0 and the rest is outside the comparison support (${note})`, async ({ page, probe, fakeFor }) => {
      const stream = S.identical();
      const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
      await page.goto(`${fake.url}/${S.address({ cols: VIEW_COLS, rows: VIEW_ROWS, rowsKind: "relvol", selection: { cols: SELECTION_COLS, rows: W } })}`);
      await S.atRest(page, fake, probe);

      // The probe: the bands of this frame are the fillRects at the fixed Rows alpha; the same view with Rows off has none of them.
      const colours = await S.bandColours(page);
      const frames = await probe.frames();
      const bands = frames.at(-1).styles.filter((s) => s.op === "fillRect" && s.alpha === colours.alpha);
      const count = W[1] - W[0];
      expect(bands.reduce((n, s) => n + s.count, 0), "one band per row of W and none outside it").toBe(count);
      expect(bands.map((s) => s.fillStyle), "all in the midpoint colour (the lowest entry of each arm is the midpoint itself)").toEqual([colours.midpoint]);

      // The pixels, right of the cutoff where the plot shows the page background: one run in the composite of the pinned entry over
      // it, where the rows of W are and nowhere else.
      const g = await geometry(page, VIEW_ROWS);
      const column = await S.canvasColumn(page, g.plot.covered + 150);
      const runs = S.runsOf(column, colours.midpointOverBackground);
      expect(runs.length, "the rows of W form one block").toBe(1);
      expect(Math.abs(runs[0].y0 - g.top(W[1])), "its top is the top of the highest row of W").toBeLessThanOrEqual(2);
      expect(Math.abs(runs[0].y1 - g.top(W[0])), "its bottom is the bottom of the lowest row of W").toBeLessThanOrEqual(2);

      // The inspection: every row of W reads 0, every other row of the period reads outside support.
      for (let r = 200; r <= 205; r++) {
        const reading = await rowReading(page, g, r, "Relative volume");
        if (r >= W[0] && r < W[1]) expect(reading.value, `row ${r} in W`).toBe("0.00");
        else expect(reading.value, `row ${r} outside W`).toBe("Outside comparison support");
      }
    });
  }

  test("the period's absolute amount and its point of control stay in the inspection, the point of control of the whole period", async ({ page, probe, fakeFor }) => {
    const stream = S.identical();
    const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
    // W = rows 200..202: the period's point of control (row 203: the most USDT) is outside it.
    await page.goto(`${fake.url}/${S.address({ cols: VIEW_COLS, rows: VIEW_ROWS, rowsKind: "relvol", selection: { cols: SELECTION_COLS, rows: [200, 203] } })}`);
    await S.atRest(page, fake, probe);
    const g = await geometry(page, VIEW_ROWS);
    const inside = await rowReading(page, g, 201, "Period's USDT");
    expect(inside.value, "the period's own amount at a row of W").toMatch(/USDT · [0-9.]+% of the period$/);
    const peak = await rowReading(page, g, 203, "Relative volume");
    expect(peak.value, "outside W").toBe("Outside comparison support");
    expect(peak.text, "and still the period's point of control, as it was defined over the whole period").toContain("The period's point of control");

    // The period's amount and share at row 203 by the exact reference: 1536 columns of the last day, each trading weight 4 at that row.
    const period = reference.periodRows(stream.trades, { b0: S.END_COL - S.DAY_COLS, b1: S.END_COL, m: 0 });
    const row203 = period.find((x) => x.r === 203).v;
    const total = period.reduce((n, x) => n + x.v, 0);
    const amount = /Period's USDT([0-9.]+) k USDT · ([0-9.]+)% of the period/.exec(peak.text.replace(/\u00a0/g, " "));
    expect(amount, "the period's amount and share are in the inspection").not.toBeNull();
    expect(Number(amount[1]) * 1000, "to the digits shown").toBeGreaterThan(row203 * 0.99);
    expect(Number(amount[1]) * 1000).toBeLessThan(row203 * 1.01);
    expect(Number(amount[2]), "the share of the whole period, not of W").toBeCloseTo((100 * row203) / total, 1);
  });
});

test.describe("Relative volume v2: rows only one side traded", () => {
  test("no current volume, no reference volume, neither traded, and the finite number of the exact reference", async ({ page, probe, fakeFor }) => {
    const stream = S.disjoint();
    const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
    const rows = [196, 214];
    await page.goto(`${fake.url}/${S.address({ cols: [stream.early[0] - 60, stream.early[1] + 60], rows, rowsKind: "relvol", selection: { cols: stream.early, rows: stream.expect.W } })}`);
    await S.atRest(page, fake, probe);
    const g = await geometry(page, rows);

    // The finite row, against the exact reference: the rectangle traded rows 200 and 210 in the two hours, the period rows 200..205.
    const rectangle = reference.periodRows(stream.trades, { b0: stream.early[0], b1: stream.early[1], m: 0 });
    const period = reference.periodRows(stream.trades, { b0: S.END_COL - S.DAY_COLS, b1: S.END_COL, m: 0 });
    const [w0, w1] = stream.expect.W;
    const sum = (list) => list.filter((x) => x.r >= w0 && x.r < w1).reduce((n, x) => n + x.v, 0);
    const C = sum(rectangle);
    const P = sum(period);
    const expected = Math.log2(rectangle.find((x) => x.r === 200).v / C / (period.find((x) => x.r === 200).v / P));
    expect(expected, "the rectangle's whole volume is in the two rows, the row's share of the period is small").toBeGreaterThan(2);
    const finite = await rowReading(page, g, 200, "Relative volume");
    expect(Number(finite.value.replace("−", "-")), "rounded to two digits").toBeCloseTo(expected, 1);
    expect(finite.value.startsWith("+")).toBe(true);

    for (const r of stream.expect.negativeInfinite) {
      const reading = await rowReading(page, g, r, "Relative volume");
      expect(reading.value, `row ${r}: only the period traded`).toBe("No current volume in the rectangle; the period traded here (−∞ on the log scale)");
      expect(reading.value, "never the old -2").not.toMatch(/−2|-2/);
    }
    for (const r of stream.expect.noReference) {
      const reading = await rowReading(page, g, r, "Relative volume");
      expect(reading.value, `row ${r}: only the rectangle traded`).toBe("No reference volume: the period did not trade here");
    }
    for (const r of [206, 207, 208, 209, 211]) {
      const reading = await rowReading(page, g, r, "Relative volume");
      expect(reading.value, `row ${r}: neither traded`).toBe("Neither traded here");
    }
    const outside = await rowReading(page, g, 198, "Relative volume");
    expect(outside.value, "row 198 is below W = [199, 212)").toBe("Outside comparison support");
  });
});
