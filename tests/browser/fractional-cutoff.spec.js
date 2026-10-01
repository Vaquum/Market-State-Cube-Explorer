"use strict";
// B56 fractional-cutoff.spec.js (issue #49): path and dwell on a cube whose cutoff is not a whole base column.
//
// The cube's data cutoff is the time of its last trade, so it is almost never a whole number of 56.25 s base columns. A tile that reaches it is reported by the cube with that
// fraction as its end, and the page asked for the tile's path and dwell with that end as b1: the cube answers "b1 must be an integer" and the view said "path and dwell couldn't
// be read" for as long as the cutoff stayed where it was (a 1-year view, Choppiness, the live edge). The standard fake's cutoff is a whole column and so never showed it.
// What is asserted, on a fake whose cutoff is 13 s past a whole minute, for each of five views that need a motion tile:
//   1. no read of any /cube/ route is refused, and nothing on the chart says that path and dwell could not be read;
//   2. the motion read was made (a /cube/tile with motion=1) and answered, over the SAME span as the view's ordinary tile (the same n, m and b0, and the same b1), and that b1 is the
//      whole column that holds the cutoff (ceil of the cutoff in base columns), not one past it: the span the page's own rectangle reads use;
//   3. what it answers ends at the last complete base column before the cutoff (the page reads path and dwell up to there and measures the open column once it completes), so no path
//      or dwell comes from the column that holds the cutoff, let alone from after the data;
//   4. the movement cells are drawn from it: the Cells legend has its mapping, and no cell is left as the pending or failed pattern.
// Oracles (none is the code under test): the fake's own request log (the bridge model's integer check is the cube's: tests/support/bridge-model.js), the response bodies as the browser
// received them, the cutoff written out in this file, and the page's canvas record.
const { test: base, expect, observe } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const EPOCH_MS = Date.parse("2021-01-01T00:00:00Z");
const HOUR = 3600000;
const DAY = 24 * HOUR;
const BASE_MS = 56250;
const ms = (iso) => Date.parse(iso) - EPOCH_MS;
const iso = (t) => new Date(t + EPOCH_MS).toISOString();
const TE = ms("2026-09-01T00:00:00Z");
// a cutoff 13 s past a whole minute: 3 days and 20 minutes into the busy path, and not a multiple of 56.25 s
const CUT = TE + 3 * DAY + 20 * 60000 + 13000;
const price = (t) => 25000 + 150 * Math.sin((2 * Math.PI * t) / (9 * HOUR)) + 40 * Math.sin((2 * Math.PI * t) / (1.3 * HOUR));
const TRADES = (() => {
  const out = [];
  for (let k = Math.ceil((TE - 12 * HOUR) / 100000); ; k++) {
    const t = k * 100000 + 17000;
    if (t > CUT) break;
    out.push({ t_ms: t, price: Math.round(price(t) * 100), qty: 100000 + ((k * 7919) % 400000), takerBuy: k % 3 !== 0 });
  }
  return out;
})();

const VIEWS = [
  ["a week at the base level, path", "#w=7d&r=0,0&mode=path&vis=2"],
  ["a week, dwell, a finer level than the default", "#w=7d&vis=2&lines=1d,7d&mode=dwell&r=1,0"],
  ["a year, path, with the Choppiness pane (the report)", "#w=1y&vis=2&mode=path&pane=choppiness"],
  ["a year, dwell", "#w=1y&vis=2&mode=dwell"],
  ["all history, path", "#w=all&vis=2&mode=path"],
];

test.describe("B56 path and dwell on a cube whose cutoff is not a whole base column", () => {
  test("the cutoff of these cases is not a whole base column (so the cases below mean something)", async () => {
    expect((CUT / BASE_MS) % 1, "a fraction of a base column").toBeGreaterThan(0.01);
    expect((CUT / BASE_MS) % 1).toBeLessThan(0.99);
  });

  for (const [name, hash] of VIEWS)
    test(`${name}: every read is answered, path and dwell are read over the tile's own span and end at the cutoff, and the cells are drawn from them`, async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor({ trades: TRADES, cutoffIso: iso(CUT) });
      const surface = observe(page);
      const motionBodies = [];
      page.on("response", async (r) => {
        const u = new URL(r.url());
        if (u.pathname === "/cube/tile" && u.searchParams.get("motion") === "1" && r.ok()) motionBodies.push(await r.json().catch(() => null));
      });
      await page.setViewportSize({ width: 1500, height: 950 });
      await page.goto(`${fake.url}/${hash}`);
      await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { message: "startup is over", timeout: 120000 }).toBe(true);
      await S.atRest(page, fake, probe);
      await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
      // 1. nothing refused, nothing said
      const refused = fake.log().filter((e) => e.path.startsWith("/cube/") && e.status >= 400);
      expect(refused.map((e) => `${e.path} ${e.status} ${JSON.stringify(e.query)}`), "no read is refused").toEqual([]);
      const frame = await pane.last();
      expect(frame.texts.map((x) => x.text).filter((x) => /couldn't be read/.test(x)), "nothing on the chart says path and dwell could not be read").toEqual([]);
      await expect(page.locator("#ol-loading")).toBeHidden();
      // 2. the motion read is the tile's own span, ending on the whole column that holds the cutoff
      const tiles = fake.log().filter((e) => e.path === "/cube/tile");
      const motion = tiles.filter((e) => e.query.motion === "1"),
        plain = tiles.filter((e) => e.query.motion !== "1");
      expect(motion.length, "a motion read of a tile was made").toBeGreaterThan(0);
      expect(motion.every((e) => e.status === 200), "and answered").toBe(true);
      const cutColumn = Math.ceil(CUT / BASE_MS);
      for (const m of motion) {
        const same = plain.find((p) => p.query.n === m.query.n && p.query.m === m.query.m && p.query.b0 === m.query.b0);
        expect(same, `the view's own tile of the same level and start (n=${m.query.n}, b0=${m.query.b0}) was read`).toBeTruthy();
        expect(m.query.b1, "over the same span: the same b1 as that tile").toBe(same.query.b1);
        expect(Number(m.query.b1), "which is the whole column that holds the cutoff, not one past it").toBe(cutColumn);
      }
      // 3. it answers up to the last complete column, and no further
      expect(motionBodies.length, "the answers were received").toBe(motion.length);
      for (const body of motionBodies) expect(body.end, "it ends at the last complete column before the cutoff: nothing from the open column or after the data").toBe(Math.floor(CUT / BASE_MS));
      // 4. the cells are drawn from it
      // (a mapping fitted from the data, "ready", or one that is fixed by the measure, as dwell's is: not pending, updating or without a calibration)
      expect(["ready", "fixed"], "the Cells legend has its mapping").toContain((await surface.chip("cells")).data.state);
      expect(frame.patterns, "no cell is left as the pending or failed pattern").toBe(0);
      expect(frame.rects.length, "cells are painted").toBeGreaterThan(10);
    });
});
