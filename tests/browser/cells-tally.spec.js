"use strict";
// cells-tally.spec.js (package C, stage 2b): what the Cells marks hook feeds the warnings and the generated keys with (DD-76, DD-11).
//
// The hook `cellsMarks` walks the drawn marks once the view has settled and puts each in the tally (clip counts, shares of marks and of
// screen area) and in the legend's keys (an unsigned zero, each kind of non-value). This spec builds cases whose counts and shares are
// worked out by hand from the fixtures, opens them through the real spine and reads the page's own details and keys.
//
// Covers: S1-120 (Scale range exceeded with its shares, for a manual window only), S1-056 and DD-66 (a manual window names its clip
// counts), S1-071 (clipping is counted, the value is kept), DR-21 (the keys "Zero (occupied)", "Reading", "Open" count their marks).
//
// Oracles: tests/fixtures/trades/mixed.json and nonvalues.json (hand-computed cells and motion; `notes` derive them). The counts are
// written out from the rule "below the window is low, above it is high, both outside" and the area share from box geometry: a full
// cell weighs 1, the open column's cells weigh the part of the column before the cutoff (1/3 for the mixed fixture's 5.333).
// Nothing is read from the module for an expected number.
//
// Also here: the hook gives the same answer when it runs twice and after a draw of another view (it does not depend on the last
// frame), checked through the keys of a Cascade view after the view has been left and come back.
const { test, expect, observe, probeTools } = require("./fixtures.js");
const { openView } = require("./cells-support.js");
const fs = require("node:fs");
const path = require("node:path");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "trades", `${name}.json`), "utf8"));
const A = "&vis=2&ap=slate2-8f7890f7";
const VIEW = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24750~25500";

async function open({ freshContext, fakeFor }, profile, hash) {
  const fake = await fakeFor(profile);
  const context = await freshContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const probe = probeTools.forPage(page);
  await openView(page, fake, probe, hash);
  const surface = observe(page);
  await expect.poll(async () => (await surface.chip("cells")).data.updating, { timeout: 10000 }).toBe("false");
  await probe.waitForQuiet({ quietMs: 600, timeout: 20000 });
  return { fake, page, probe, surface, context };
}

const num = (details, name) => Number(details.fields[name].value);

// The counts a window gives a list of {value, weight}: below lo is low, above hi is high (both outside), a value exactly on an end is
// an exact endpoint and not outside.
function expectedShares(marks, lo, hi) {
  let low = 0;
  let high = 0;
  let outsideWeight = 0;
  let weight = 0;
  for (const { value, weight: w } of marks) {
    weight += w;
    if (value < lo) low++;
    else if (value > hi) high++;
    else continue;
    outsideWeight += w;
  }
  return { low, high, marks: (low + high) / marks.length, area: outsideWeight / weight };
}

test.describe("the Cells marks feed the tally and the keys", () => {
  test("Taker flow with a manual window: the clip counts and both shares equal the hand count", async ({ freshContext, fakeFor }) => {
    // mixed, Taker flow (USDT) in the window 0.3..0.7: the share of each of the nine cells is bv / v (hand values of the fixture).
    // The open column (5) is drawn up to the cutoff 5.333, a third of a column wide.
    const cells = fixture("mixed").expected.cells["0:0"];
    const marks = cells.map((z) => ({ value: z.bv / z.v, weight: z.c >= 5 ? 1 / 3 : 1 }));
    const want = expectedShares(marks, 0.3, 0.7);
    expect([want.low, want.high], "hand count: shares 0 x3 below, 1 x4 above, 1/3 and 2/3 inside").toEqual([3, 4]);
    const { surface, context } = await open({ freshContext, fakeFor }, "micro:mixed", `${VIEW}&r=0,0&mode=flow&sw=0.3~0.7${A}`);
    const details = await surface.details("cells");
    expect(num(details, "clipLowFinite")).toBe(want.low);
    expect(num(details, "clipHighFinite")).toBe(want.high);
    expect(num(details, "shareMarks")).toBeCloseTo(want.marks, 12);
    expect(num(details, "shareArea")).toBeCloseTo(want.area, 12);
    expect(details.warnings.map((w) => w.warning), "a manual window is meaningful: more than 10 % outside warns").toContain("range-exceeded");
    await context.close();
  });

  test("Dwell with a manual window: the clip counts and shares equal the hand count, the zero cells are keyed", async ({ freshContext, fakeFor }) => {
    // nonvalues, Dwell in the window 0.2..0.6: a cell's share is its seconds over the column's 56.25 s (hand values of the fixture);
    // every cell is a full cell. Two cells hold no dwell at all (an unsigned zero: below the window, and keyed "Zero (occupied)").
    const cells = fixture("nonvalues").expected.motion["0:0"];
    const marks = cells.map((z) => ({ value: z.w / 56.25, weight: 1 }));
    const want = expectedShares(marks, 0.2, 0.6);
    const { surface, context } = await open({ freshContext, fakeFor }, "micro:nonvalues", `${VIEW}&r=0,0&mode=dwell&sw=0.2~0.6${A}`);
    const details = await surface.details("cells");
    expect(num(details, "clipLowFinite")).toBe(want.low);
    expect(num(details, "clipHighFinite")).toBe(want.high);
    expect(num(details, "shareMarks")).toBeCloseTo(want.marks, 12);
    expect(num(details, "shareArea")).toBeCloseTo(want.area, 12);
    const zero = details.keys.find((k) => k.key === "zero");
    expect(zero.count, "two cells hold no dwell").toBe(cells.filter((z) => z.w === 0).length);
    expect(zero.role, "the key is the zero outline of the role table").toBe("zero-outline");
    expect(details.keys.find((k) => k.key === "pending").count, "every cell was read: nothing is 'Reading'").toBe(0);
    await context.close();
  });

  test("Cascade: the keys count the open parents, and the same after the view has been left and come back", async ({ freshContext, fakeFor }) => {
    // nonvalues at level (1,1): one child (2,101) sits in a parent that runs past the cutoff, which is "Open" (waiting for it).
    const hash = `${VIEW}&r=1,1&mode=cascade${A}`;
    const { surface, page, probe, context } = await open({ freshContext, fakeFor }, "micro:nonvalues", hash);
    const count = async () => (await surface.details("cells")).keys.find((k) => k.key === "waiting-for-complete-parent").count;
    expect(await count(), "one open child").toBe(1);
    // Leave for another measure and level, then return: the count is worked out again from the state now, not from the last draw.
    await page.evaluate((h) => (location.hash = h), `${VIEW}&r=0,0&mode=volume${A}`);
    await probe.waitForQuiet({ quietMs: 700, timeout: 20000 });
    await page.evaluate((h) => (location.hash = h), hash);
    await probe.waitForQuiet({ quietMs: 700, timeout: 20000 });
    await expect.poll(count, { timeout: 10000 }).toBe(1);
    await context.close();
  });

  test("Path before the read has answered: the base cells are counted as 'Reading', never as values", async ({ freshContext, fakeFor }) => {
    // The cube reads the first four base columns of paths.json; its traded cells in columns 4 and 5 were never read.
    const all = fixture("paths").expected;
    const unread = all.cells["0:0"].filter((z) => z.c >= 4).length;
    const fake = await fakeFor("micro:paths");
    fake.motionThrough(4);
    const context = await freshContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const probe = probeTools.forPage(page);
    await openView(page, fake, probe, `${VIEW}&r=0,0&mode=path${A}`);
    const surface = observe(page);
    await expect.poll(async () => (await surface.chip("cells")).data.updating, { timeout: 10000 }).toBe("false");
    await probe.waitForQuiet({ quietMs: 600, timeout: 20000 });
    const details = await surface.details("cells");
    expect(unread, "the fixture has unread traded cells").toBeGreaterThan(0);
    expect(details.keys.find((k) => k.key === "pending").count).toBe(unread);
    await context.close();
  });

  test("every generated key of a Cells legend names a glyph of the role table, for every measure", async ({ freshContext, fakeFor }) => {
    // B16: "every legend key data-role exists in the glyph table". The page's own table (window.explorerEncoding) is the list of ids;
    // the keys are read from the Cells popover for each family of keys (unsigned, signed, share, dwell, cascade, geometry).
    const views = [
      ["micro:nonvalues", "volume"],
      ["micro:nonvalues", "delta"],
      ["micro:nonvalues", "flow"],
      ["micro:nonvalues", "dwell"],
      ["micro:nonvalues", "cascade"],
      ["micro:nonvalues", "geometry"],
    ];
    const { page, surface, context } = await open({ freshContext, fakeFor }, views[0][0], `${VIEW}&r=0,0&mode=volume${A}`);
    const glyphs = await page.evaluate(() => Object.keys(window.explorerEncoding.role.GLYPHS));
    for (const [, mode] of views) {
      await page.evaluate((h) => (location.hash = h), `${VIEW}&r=${mode === "cascade" ? "1,1" : "0,0"}&mode=${mode}${A}`);
      // Geometry has no mapping (its chip is the outline); every other measure names itself in its context key.
      await expect
        .poll(async () => {
          const data = (await surface.chip("cells")).data;
          return mode === "geometry" ? data.state : data.context;
        }, { timeout: 10000 })
        [mode === "geometry" ? "toBe" : "toContain"](mode === "geometry" ? "outline" : `|${mode}|`);
      await page.waitForTimeout(700);
      const details = await surface.details("cells");
      expect(details.keys.length, `${mode}: the popover lists its keys`).toBeGreaterThan(0);
      for (const key of details.keys) expect(glyphs, `${mode}: key ${key.key} names the glyph ${key.role}`).toContain(key.role);
    }
    await context.close();
  });
});
