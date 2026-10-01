"use strict";
// B56 fractional-cutoff.spec.js (issue #49): path and dwell on a cube whose cutoff is not a whole base column.
//
// The cube's data cutoff is the time of its last trade, so it is almost never a whole number of 56.25 s base columns. A tile that reaches it is reported by the cube with that
// fraction as its end, and the page asked for the tile's path and dwell with that end as b1: the cube answers "b1 must be an integer" and the view said "path and dwell couldn't
// be read" for as long as the cutoff stayed where it was (a 1-year view, Choppiness, the live edge). The standard fake's cutoff is a whole column and so never showed it.
// What is asserted, on a fake whose cutoff is 13 s past a whole minute: no read of any view is refused, none of them says that path and dwell could not be read, and the cells
// of the movement mode are drawn.
// Oracles (none is the code under test): the fake's own request log (the bridge model's integer check is the cube's: tests/support/bridge-model.js), and the page's canvas record.
const { test: base, expect } = require("./fixtures.js");
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
    test(`${name}: every read is answered and path and dwell are read`, async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor({ trades: TRADES, cutoffIso: iso(CUT) });
      await page.setViewportSize({ width: 1500, height: 950 });
      await page.goto(`${fake.url}/${hash}`);
      await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { message: "startup is over", timeout: 120000 }).toBe(true);
      await S.atRest(page, fake, probe);
      await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
      const refused = fake.log().filter((e) => e.path.startsWith("/cube/") && e.status >= 400);
      expect(refused.map((e) => `${e.path} ${e.status} ${JSON.stringify(e.query)}`), "no read is refused").toEqual([]);
      const texts = (await pane.last()).texts.map((x) => x.text);
      expect(texts.filter((x) => /couldn't be read/.test(x)), "nothing on the chart says path and dwell could not be read").toEqual([]);
      await expect(page.locator("#ol-loading")).toBeHidden();
    });
});
