"use strict";
// B16b nonvalues.spec.js (R): the Rows half of the basic keyed non-value presentation (TESTPLAN 3.4 B16; owner R: the Relative-volume
// zero-current row with its negative-infinity key and readout, and the Rows non-value marks). B16a (Cells) and B16c (Columns) are
// the other owners' and live in their own files. Covers S1-052, S1-059, S1-063 (typed marks instead of a fake -2, a distinct
// infinity mark, a no-reference mark, each counted) and S1-160 for the Rows roles.
//
// The stream is the "disjoint" one of rows-support.js: against the 1-day period, on W = rows 199..211, the selection traded rows 200
// and 210 only and the period rows 200..205, so by construction (a set statement, not a computed number)
//   row 200       both traded        a finite value (above +2: the band is at the end of the positive arm)
//   rows 201..205 the period only    negative infinity: 5 marks
//   row 210       the rectangle only no reference: 1 mark
//   the other rows of W              neither traded: no mark at all (they are counted in the key, not drawn row by row)
// The canvas is read with the test probe: the bands are fillRects at the fixed Rows alpha, the tick of negative infinity is an
// opaque fillRect in the state ink, its plate a strokeRect and a fillText, the no-reference tick a dotted 1 px stroke. Every count is
// the DIFFERENCE between the same view with Relative volume on and with Rows off, so nothing else the page draws in that ink is
// counted. The pixels are read at DPR 1: the tick run at the plot's left edge is as tall as the five rows it marks.
// What this does NOT prove: the generated keys (`[data-key][data-count]` of D.18, which the DOM package writes: the last test states
// its dependency and skips until they exist), the warning tally (B09, the spine's), the Rows marks under a dark theme, and any
// pixel ratio other than 1.
const { test, expect, probeTools } = require("./fixtures.js");
const S = require("./rows-support.js");

const ROWS = [196, 214];
const stream = S.disjoint();
const profile = { name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso };
const cols = [stream.early[0] - 60, stream.early[1] + 60];
const url = (rowsKind) => `/${S.address({ cols, rows: ROWS, rowsKind, selection: { cols: stream.early, rows: stream.expect.W } })}`;

async function lastFrame(page, probe, fake) {
  await S.atRest(page, fake, probe);
  return (await probe.frames()).at(-1);
}

// How many canvas ops of one style a frame has: the entries of its style log that match, summed.
const countStyles = (frame, match) => frame.styles.filter(match).reduce((n, s) => n + s.count, 0);

test.describe("Rows non-value marks on the canvas", () => {
  test("negative infinity and no reference are marked where the rows are, and nothing else is drawn for them", async ({ page, probe, fakeFor, openLink }) => {
    const fake = await fakeFor(profile);
    await page.goto(fake.url + url("relvol"));
    const on = await lastFrame(page, probe, fake);
    // The same view with Rows off, in a fresh context (no storage, its own probe).
    const offPage = await openLink(fake.url + url("off"));
    const offProbe = probeTools.forPage(offPage);
    const off = await lastFrame(offPage, offProbe, fake);
    const colours = await S.bandColours(page);
    const { negativeInfinite, noReference, finite } = stream.expect;

    // Negative infinity: an opaque 2 px tick in the state ink for each of the five rows, and the plate of each (a stroked square and
    // the text "−∞"), because the rows are 35 px tall here.
    const ink = colours.stateInk;
    const ticks = (frame) => countStyles(frame, (s) => s.op === "fillRect" && s.fillStyle === ink && s.alpha === 1);
    expect(ticks(on) - ticks(off), "one tick for each row only the period traded").toBe(negativeInfinite.length);
    const plates = (frame) => countStyles(frame, (s) => s.op === "strokeRect" && s.strokeStyle === ink && s.lineWidth === 1 && s.alpha === 1);
    expect(plates(on) - plates(off), "and its plate").toBe(negativeInfinite.length);
    expect(on.ops.fillText - off.ops.fillText, "with the infinity text in it").toBe(negativeInfinite.length);

    // No reference: one dotted 1 px tick for the row only the rectangle traded.
    const dotted = (frame) => countStyles(frame, (s) => s.op === "stroke" && s.strokeStyle === ink && s.lineWidth === 1 && s.dash === "1,2" && s.alpha === 1);
    expect(dotted(on) - dotted(off), "one dotted tick for each row only the rectangle traded").toBe(noReference.length);

    // The bands: one, for the row both traded, at the fixed alpha and in the top of the positive arm; none for the typed rows.
    const bands = on.styles.filter((s) => s.op === "fillRect" && s.alpha === colours.alpha);
    expect(bands.reduce((n, s) => n + s.count, 0), "a band only where there is a number").toBe(finite.length);
    expect(bands.map((s) => s.fillStyle)).toEqual([colours.positive255]);
  });

  test("the tick run at the plot's edge is as tall as the five rows it marks, and the typed rows paint no band", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor(profile);
    await page.goto(fake.url + url("relvol"));
    await S.atRest(page, fake, probe);
    const colours = await S.bandColours(page);
    const plot = await S.plotRect(page, { x: 300, y: 300 });
    const rowPx = (plot.y1 - plot.y0) / (ROWS[1] - ROWS[0]);
    const top = (r) => plot.y0 + (ROWS[1] - r) * rowPx;
    // The ticks sit at the plot's left edge (G.x, 2 px wide).
    const edge = await S.canvasColumn(page, plot.x0 + 1);
    const ink = await page.evaluate((css) => window.explorerEncoding.lut.parseColor(css), colours.stateInk);
    const runs = S.runsOf(edge, ink, { tol: 2, gap: 1 });
    const run = runs.find((r) => Math.abs(r.y0 - top(205 + 1)) <= 3);
    expect(run, "a run of state ink starting at the top of row 205").toBeTruthy();
    expect(Math.abs(run.y1 - top(201)), "and ending at the bottom of row 201: five rows of ticks").toBeLessThanOrEqual(3);
    // The rows the period traded and the rectangle did not show the page's own surface in the middle of the plot: no band there.
    const middle = await S.canvasColumn(page, Math.round((plot.x0 + plot.x1) / 2));
    for (const r of [201, 203, 205, 207, 208]) {
      const y = Math.round((top(r + 1) + top(r)) / 2);
      expect(S.near(middle[y], colours.surface, 1), `row ${r}: the surface, no band (pixel ${middle[y]})`).toBe(true);
    }
  });

  test("the generated keys count what the canvas marks (needs the legend keys of the DOM package)", async ({ page, probe, fakeFor, surface }) => {
    const fake = await fakeFor(profile);
    await page.goto(fake.url + url("relvol"));
    await S.atRest(page, fake, probe);
    const absent = await surface.missing(["keysContainer"]);
    test.skip(absent.length > 0, `INTEGRATION.md D.18 element missing: ${absent.join(", ")}; this assertion waits for package U's generated keys`);
    const keys = await surface.keys();
    const count = (id) => keys.find((k) => k.key === id)?.count ?? 0;
    expect(count("negative-infinite"), "the key of negative infinity counts the rows marked").toBe(stream.expect.negativeInfinite.length);
    expect(count("no-reference")).toBe(stream.expect.noReference.length);
  });
});
