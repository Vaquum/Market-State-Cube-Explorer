"use strict";
// cells-edge.spec.js (package C, stage 2b): the cases of the Cells canvas that the matrix does not reach.
//
//   1. balanced traded Delta draws the midpoint and differs from the empty surface, in both themes (DD-16, A-30: the baseline drew it in
//      the surface colour, so an occupied balanced cell vanished);
//   2. Relative rank is not offered for Delta: a Delta address that asks for it draws the Value mapping and the chip says so (API.md
//      B.3: delta has rank false);
//   3. a theme flip at run time recolours every mark from the other theme's Lut with no new fit and no request (D12: a theme is a lookup),
//      and the pattern tiles are the new theme's;
//   4. a selection fades the block's cells at alpha 0.25 through the whole-block frame (`sc.cellsFull`) and redraws the selected ones on
//      top at alpha 1, both in the colours of the one mapping (fitted over the selection, A-13c);
//   5. Path on the recorded snapshot, which holds no motion: the page does not offer it and draws Volume (no pattern of a missing read).
//
// Oracles: the hand values of tests/fixtures/trades/*.json, the rules of API.md C.3 to C.5 written out in cells-matrix.spec.js's helper
// shapes (repeated here in small), the pinned Lut and pattern tiles asked of the page's module, the recorder and getImageData.
const { test, expect, observe, probeTools } = require("./fixtures.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox } = require("./cells-support.js");
const reference = require("../reference/index.js");
const fs = require("node:fs");
const path = require("node:path");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "trades", `${name}.json`), "utf8"));
const A = "&vis=2&ap=slate2-8f7890f7";
const hex = (px) => `#${px.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const pixel = (page, x, y) =>
  page.evaluate(([px, py]) => [...document.getElementById("ol-canvas").getContext("2d").getImageData(px, py, 1, 1).data], [Math.round(x), Math.round(y)]).then(hex);

async function open({ freshContext, fakeFor }, profile, hash, options = {}) {
  const fake = await fakeFor(profile);
  const context = await freshContext({ reducedMotion: "reduce", ...options });
  await addRecorder(context);
  const page = await context.newPage();
  const probe = probeTools.forPage(page);
  await openView(page, fake, probe, hash);
  const surface = observe(page);
  await expect.poll(async () => (await surface.chip("cells")).data.updating, { timeout: 10000 }).toBe("false");
  await probe.waitForQuiet({ quietMs: 500, timeout: 20000 });
  return { fake, page, probe, surface, context };
}

test.describe("Cells canvas, edge cases", () => {
  for (const theme of ["light", "dark"]) {
    test(`balanced traded Delta is the midpoint entry and not the surface (${theme})`, async ({ freshContext, fakeFor }) => {
      const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:02Z", low: 25000, high: 25125 };
      const { page, context } = await open({ freshContext, fakeFor }, "micro:balanced", `#t=${view.from}~${view.to}&p=${view.low}~${view.high}&r=0,0&mode=delta${A}`, { colorScheme: theme });
      const colours = await pageColours(page, theme);
      const draw = await lastDraw(page);
      const box = boxOf(draw.plot, rectOf(view), 0, 0, 0, 200);
      const ops = opsOfBox(draw, box);
      expect(ops).toHaveLength(1);
      expect(ops[0].op, "a signed zero is a fill").toBe("fillRect");
      expect(ops[0].style, "the midpoint entry").toBe(colours.midpoint);
      expect(colours.midpoint).not.toBe(colours.surface);
      const centre = await pixel(page, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2 + 10);
      expect(centre, "on the canvas too").toBe(colours.midpoint);
      // the empty surface beside it (the open column)
      expect(await pixel(page, box.x1 + 60, (box.y0 + box.y1) / 2 + 10)).toBe(colours.surface);
      await context.close();
    });
  }

  test("Relative rank is not offered for Delta: the Value mapping is drawn and the chip says so", async ({ freshContext, fakeFor }) => {
    const base = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24750~25500&r=0,0&mode=delta";
    const a = await open({ freshContext, fakeFor }, "micro:mixed", `${base}${A}&tr=r`);
    const b = await open({ freshContext, fakeFor }, "micro:mixed", `${base}${A}`);
    const chipA = (await a.surface.chip("cells")).data;
    const chipB = (await b.surface.chip("cells")).data;
    expect(chipA.transform, "the chip names the mapping it drew").toBe("value-log");
    expect(chipA.mappingId, "the same mapping as without the request").toBe(chipB.mappingId);
    const drawA = await lastDraw(a.page);
    const drawB = await lastDraw(b.page);
    const fills = (d) => d.ops.filter((op) => op.op === "fillRect" && /^#/.test(op.style)).map((op) => `${Math.round(op.x)},${Math.round(op.y)},${op.style}`).sort();
    expect(fills(drawA), "the same marks").toEqual(fills(drawB));
    await a.context.close();
    await b.context.close();
  });

  test("a theme flip at run time recolours the marks from the other Lut with no refit and no request", async ({ freshContext, fakeFor }) => {
    const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
    const { page, fake, probe, surface, context } = await open({ freshContext, fakeFor }, "micro:nonvalues", `#t=${view.from}~${view.to}&p=${view.low}~${view.high}&r=1,1&mode=cascade${A}`, { colorScheme: "light" });
    const before = await lastDraw(page);
    const lightColours = await pageColours(page, "light");
    const seq = (await surface.chip("cells")).data.fitSeq;
    const rect = rectOf(view);
    const waiting = boxOf(before.plot, rect, 1, 1, 2, 101);
    expect(opsOfBox(before, waiting)[0].style, "the light tile").toBe(lightColours.tiles["pattern-slate"]);
    const requests = fake.log ? fake.log.length : null;
    await page.emulateMedia({ colorScheme: "dark" });
    await probe.waitForQuiet({ quietMs: 700, timeout: 20000 });
    const darkColours = await pageColours(page, "dark");
    const after = await lastDraw(page);
    expect(darkColours.tiles["pattern-slate"], "the two tiles differ").not.toBe(lightColours.tiles["pattern-slate"]);
    const ops = opsOfBox(after, boxOf(after.plot, rect, 1, 1, 2, 101));
    expect(ops).toHaveLength(1);
    expect(ops[0].style, "the dark tile").toBe(darkColours.tiles["pattern-slate"]);
    // a complete parent's children: the positive arm of the dark Lut at the same entry
    const trades = fixture("nonvalues").trades;
    const child = reference.cells(trades, { n: 1, m: 1, b0: 0, b1: 7 }).find((z) => z.c === 0 && z.r === 100);
    const parent = reference.cells(trades, { n: 2, m: 2, b0: 0, b1: 7 }).find((z) => z.c === 0 && z.r === 50);
    const entry = Math.round((Math.log2((4 * child.v) / parent.v) / 2) * 255);
    const mark = opsOfBox(after, boxOf(after.plot, rect, 1, 1, 0, 100));
    expect(mark).toHaveLength(1);
    expect(mark[0].style).toBe(darkColours.positive[entry]);
    expect(mark[0].style).not.toBe(lightColours.positive[entry]);
    expect((await surface.chip("cells")).data.fitSeq, "no new fit").toBe(seq);
    if (requests !== null) expect(fake.log.length, "no request for a theme").toBe(requests);
    await context.close();
  });

  test("a selection fades the block's cells at 0.25 and redraws the selected ones on top, in the colours of one mapping", async ({ freshContext, fakeFor }) => {
    // mixed, Volume. The selection is the first four columns (00:00:00 to 00:03:45) over every row of the fixture: six cells. Explore is
    // fitted over the selection (A-13c), the fade layer paints all nine cells in that mapping at alpha 0.25, then the six again at 1.
    const view = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
    const { page, context } = await open(
      { freshContext, fakeFor },
      "micro:mixed",
      `#t=${view.from}~${view.to}&p=${view.low}~${view.high}&r=0,0&mode=volume&sel=00:00:00~00:03:45,24750~25500${A}`.replace("sel=00:00:00~00:03:45", "sel=2021-01-01T00:00Z~2021-01-01T00:03:45Z"),
    );
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const cells = fixture("mixed").expected.cells["0:0"];
    const selected = cells.filter((z) => z.c < 4);
    expect(selected, "six cells in the first four columns").toHaveLength(6);
    const mags = selected.map((z) => z.v);
    const U = Math.max(...mags);
    const k = reference.median7(mags);
    const idx = (x) => Math.round(Math.min(1, Math.log1p(x / k) / Math.log1p(U / k)) * 255);
    const rect = rectOf(view);
    const CUT = 300000 / 56250;
    for (const z of cells) {
      const ops = opsOfBox(draw, boxOf(draw.plot, rect, 0, 0, z.c, z.r, CUT));
      const style = colours.unsigned[idx(z.v)];
      const faded = ops.filter((op) => Math.abs(op.alpha - 0.25) < 1e-9);
      const solid = ops.filter((op) => op.alpha === 1);
      expect(faded, `cell ${z.c}:${z.r}: one faded mark`).toHaveLength(1);
      expect(faded[0].style, `cell ${z.c}:${z.r}: the colour of the selection's mapping`).toBe(style);
      if (z.c < 4) {
        expect(solid, `cell ${z.c}:${z.r}: selected, drawn again on top`).toHaveLength(1);
        expect(solid[0].style).toBe(style);
      } else expect(solid, `cell ${z.c}:${z.r}: outside the selection, faded only`).toHaveLength(0);
    }
    await context.close();
  });

  test("the recorded snapshot holds no motion: an address that asks for Path draws Volume, never a Path colour", async ({ freshContext, fakeFor }) => {
    const { page, context, surface } = await open(
      { freshContext, fakeFor },
      "recorded",
      `#t=2026-09-22T00:00Z~2026-09-23T00:00Z&p=85000~87000&r=4,1&mode=path${A}`,
    );
    const chip = (await surface.chip("cells")).data;
    expect(chip.context, "the context is the Volume one: there is no Path measurement to calibrate").toContain("|volume|");
    expect(chip.context).not.toContain("|path|");
    // every cell mark is a colour of the unsigned ramp (Volume), none is a pattern of a missing read
    const colours = await pageColours(page);
    const draw = await lastDraw(page);
    const tiles = new Set(Object.values(colours.tiles));
    expect(draw.ops.filter((op) => tiles.has(op.style)), "no pattern tile: nothing is waiting for a read").toEqual([]);
    await context.close();
  });
});
