"use strict";
// nonvalues-panes.spec.js (X): B16c, the basic keyed non-value presentation in the Columns pane (TESTPLAN 3.4, B16; INTEGRATION D.6 and
// D.18; DR-21). B16a (cells, package C) and B16b (Rows, package R) are the other two thirds of the catalogue's `nonvalues.spec.js`; three
// packages cannot each create that file without an add/add conflict, so this one is named for its part.
//
// Requirements covered: S1-040 (an undefined ratio is a hollow diamond on the baseline, never a zero-length bar), S1-064 and S1-065 (a
// measured zero is a zero tick, and a finite value beyond the axis is clamped to the edge with a triangle and a count, its raw value kept),
// S1-160 (the keys are generated from the same marks), D2's typed reasons (a column whose denominator is 0 is marked, never drawn as 0).
//
// What the pane draws is read off the canvas (pane-canvas.js records every path): a spec counts diamonds, ticks and triangles by their
// GEOMETRY, then compares the count and the place with the reference. The authoritative key counts (`[data-key][data-count]` in
// #ol-keys-scale, D.18) are package U's DOM: those assertions are fixme with the reason on a page that lacks the container, and a failure
// naming it under CONVERGENCE=1 (K's merged page).
//
// Oracles (none is the code under test): the hand-computed `expected.motion` cells of the micro fixtures (tests/fixtures/trades/*.json:
// each column's path, high and low, derived on paper from the trades), the exact-rational reference calculator for the column sums and the
// touched rows of the Efficiency fixture, and the rules written out below for where a glyph sits (a column's slot is its bar's width plus
// the 1 px gap; the baseline of an unsigned axis is the pane's bottom edge, a signed axis's the centre line).
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const ref = require("../reference/index.js");
const { resolveProfile } = require("../support/profiles.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const tradeList = (store) =>
  Array.from(store.t, (t, i) => ({ t_ms: t, price: store.price[i], qty: store.qty[i], takerBuy: Boolean(store.buy[i]), count: store.count[i] }));
const fixture = (name) => require(`../fixtures/trades/${name}.json`);
const num = (x) => (x === "NaN" ? NaN : x);

async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 400, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

// The generated keys (D.18, #ol-keys-scale) are package U's; fixme with the reason where the container is absent, a failure naming it
// under CONVERGENCE=1.
async function needKeys(surface) {
  const absent = await surface.missing(["keysContainer"]);
  test.fixme(absent.length > 0 && process.env.CONVERGENCE !== "1", `needs package U: ${absent.join(", ")} is not in this page`);
}
const keyCount = async (surface, id) => ((await surface.keys()).find((k) => k.key === id)?.count ?? 0);

// A window onto the first `minutes` of a micro fixture at its base level, the price band of its rows 195 to 215.
const microView = (minutes, pane) => `#t=2021-01-01T00:00Z~2021-01-01T00:0${minutes}Z&p=24375~26875&r=0,0&${pane}`;

// The columns of a fixture's hand-computed motion cells (level 0,0): per column its path, the highest and lowest price of its trades and
// its trade count, the way the Choppiness pane reads them (path over range; no trades or no range is undefined).
function choppiness(name) {
  const cells = fixture(name).expected.motion["0:0"];
  const by = new Map();
  for (const z of cells) {
    const c = by.get(z.c) ?? { c: z.c, p: 0, hi: -Infinity, lo: Infinity, ct: 0 };
    c.p += z.p;
    c.ct += z.ct;
    const hi = num(z.hi);
    const lo = num(z.lo);
    if (Number.isFinite(hi) && hi > c.hi) c.hi = hi;
    if (Number.isFinite(lo) && lo < c.lo) c.lo = lo;
    by.set(z.c, c);
  }
  return [...by.values()]
    .sort((a, b) => a.c - b.c)
    .map((c) => ({ ...c, value: c.ct > 0 && c.hi > c.lo ? c.p / (c.hi - c.lo) : null }));
}

// A column's slot on the canvas from two of its bars: the bar is the slot less a 1 px gap, so slots are the distance between bar starts.
const slotsFrom = (bars) => ({ x0: bars[0].x, slot: bars[1].x - bars[0].x });
const centreOf = (slots, c) => slots.x0 + c * slots.slot + slots.slot / 2;

test.describe("B16c: a column without a value is marked, never drawn as a zero bar", () => {
  test("micro:mixed under Path: a hollow diamond on the baseline for every column without a price range, bars for the rest (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("micro:mixed");
    await page.goto(`${fake.url}/${microView(5, "mode=path")}`);
    await atRest(page, fake, probe);

    const columns = choppiness("mixed");
    const defined = columns.filter((c) => c.value !== null);
    const undefinedColumns = columns.filter((c) => c.value === null);
    expect(defined.map((c) => c.c), "by hand from the fixture: columns 0 and 1 have a range").toEqual([0, 1]);
    expect(undefinedColumns.map((c) => c.c), "columns 2, 3 and 4 traded at one price").toEqual([2, 3, 4]);

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const bars = paneCanvas.barsOf(frame, area, { fill: colours.bar, alpha: 0.65 });
    expect(bars.length, "one bar per column with a value").toBe(defined.length);
    // Both values are 250 / 125 = 2: equal bars, each the full length of the axis (its maximum is the largest value).
    for (const bar of bars) expect(bar.h).toBeCloseTo(area.h - 4, 9);

    const glyphs = paneCanvas.glyphsOf(frame, colours.state);
    expect(glyphs.diamond.length, "a diamond for every undefined column").toBe(undefinedColumns.length);
    const slots = slotsFrom(bars);
    glyphs.diamond.forEach(([x, y], i) => {
      expect(x, `diamond ${i} is centred on column ${undefinedColumns[i].c}`).toBeCloseTo(centreOf(slots, undefinedColumns[i].c), 6);
      expect(y, "on the baseline, inside the pane").toBeCloseTo(area.bottom - 4, 9);
    });
  });

  test("micro:nonvalues under Path: every column is undefined, so the pane is all diamonds and no bar, and its axis is No data (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("micro:nonvalues");
    await page.goto(`${fake.url}/${microView(6, "mode=path")}`);
    await atRest(page, fake, probe);
    const columns = choppiness("nonvalues");
    expect(columns.every((c) => c.value === null), "by hand: no column of this fixture has a price range").toBe(true);

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    expect(paneCanvas.barsOf(frame, area, { fill: colours.bar, alpha: 0.65 }).length, "no bar").toBe(0);
    const glyphs = paneCanvas.glyphsOf(frame, colours.state);
    expect(glyphs.diamond.length, "a diamond per column").toBe(columns.length);
    expect(paneCanvas.textsOf(frame).filter((t) => t === "No data").length, "and the axis says No data").toBe(1);
  });

  test("the keys count the diamonds (Path on micro:mixed)", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor("micro:mixed");
    await page.goto(`${fake.url}/${microView(5, "mode=path")}`);
    await atRest(page, fake, probe);
    await needKeys(surface);
    expect(await keyCount(surface, "undefined"), "the count of the Not defined key is the reference count").toBe(choppiness("mixed").filter((c) => c.value === null).length);
  });
});

test.describe("B16c: a measured zero is a tick on the baseline", () => {
  test("micro:ties under Delta: columns 1 to 3 are +100 (full bars), column 0 is exactly 0 (a tick at the centre line) (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("micro:ties");
    await page.goto(`${fake.url}/${microView(5, "pane=delta")}`);
    await atRest(page, fake, probe);

    // By the exact reference: column Delta = 2 * taker-buy USDT - USDT. Column 0 holds two rows of 63 buy + 63 sell, so it is 0 with trades.
    const cells = ref.cells(tradeList(resolveProfile("micro:ties").store), { n: 0, m: 0, b0: 0, b1: 6 });
    const delta = new Map();
    for (const z of cells) delta.set(z.c, (delta.get(z.c) ?? 0) + (2 * z.bv - z.v));
    const zeros = [...delta.entries()].filter(([, d]) => d === 0).map(([c]) => c);
    const positives = [...delta.entries()].filter(([, d]) => d > 0).map(([c]) => c);
    expect(zeros).toEqual([0]);
    expect(positives).toEqual([1, 2, 3]);

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const bars = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.65 });
    expect(bars.length, "one positive bar per positive column").toBe(positives.length);
    for (const bar of bars) expect(bar.h, "each is the maximum").toBeCloseTo(area.h / 2 - 4, 9);

    const glyphs = paneCanvas.glyphsOf(frame, colours.state);
    expect(glyphs.tick.length, "one tick for the one zero column").toBe(zeros.length);
    const [x, y, width] = glyphs.tick[0];
    expect(y, "on the centre line of a signed axis").toBeCloseTo(area.y + area.h / 2, 9);
    // The tick spans column 0's slot, which ends where column 1's bar starts.
    expect(x + width / 2, "to the start of the next column").toBeCloseTo(bars[0].x, 6);
  });

  test("micro:balanced under Delta: the one column is 0, so the axis is 0 (not a maximum of 1) and the zero is ticked (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("micro:balanced");
    await page.goto(`${fake.url}/${microView(2, "pane=delta")}`);
    await atRest(page, fake, probe);
    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    expect(paneCanvas.glyphsOf(frame, colours.state).tick.length, "the balanced column is a zero tick").toBe(1);
    expect(paneCanvas.textsOf(frame)).toContain("0");
    expect(paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.65 }).length + paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.65 }).length, "and no bar").toBe(0);
  });

  test("the keys count the zero ticks (Delta on micro:ties)", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor("micro:ties");
    await page.goto(`${fake.url}/${microView(5, "pane=delta")}`);
    await atRest(page, fake, probe);
    await needKeys(surface);
    expect(await keyCount(surface, "zero")).toBe(1);
  });
});

// ---- Efficiency: finite values beyond the axis, and columns with no trades ------------------------------------------------------------

// Two columns under one parent: column 0 is one trade of about 100,000 USDT in one row; column 1 nine trades of about 95 USDT in nine other
// rows. Column 0 then has far more USDT per touched row than its parent and column 1 far less: log2 of their ratios to the recorded
// baseline is about +3.8 and -6.2, beyond the axis's +2 and -2. Columns 2 and 3 have no trades at all (their parent is whole: a column
// with nothing in it is a typed empty population), and column 4's parent runs past the data (open).
const EFFICIENCY_TRADES = (() => {
  const trades = [{ t_ms: 10000, price: 2500100, qty: 400000000, takerBuy: true }];
  for (let i = 0; i < 9; i++) trades.push({ t_ms: 60000 + i * 1000, price: (190 + i) * 12500 + 100, qty: 400000, takerBuy: i % 2 === 0 });
  return trades;
})();
const EFFICIENCY_VIEW = "#t=2021-01-01T00:00Z~2021-01-01T00:04Z&p=23500~25600&r=0,0&pane=efficiency";

// The reference values of columns 0 and 1: USDT per touched base row over the parent's, against 2 ** (0.486 - 1) (DR-13, written out).
function efficiencyOf() {
  const at = (n) => {
    const by = new Map();
    for (const z of ref.cells(EFFICIENCY_TRADES, { n, m: 0, b0: 0, b1: 5 })) {
      const c = by.get(z.c) ?? { v: 0, rows: 0 };
      c.v += z.v;
      c.rows += 1;
      by.set(z.c, c);
    }
    return by;
  };
  const own = at(0);
  const parents = at(1);
  const baseline = 2 ** (0.486 - 1);
  return [0, 1].map((c) => Math.log2(own.get(c).v / own.get(c).rows / (parents.get(0).v / parents.get(0).rows) / baseline));
}

test.describe("B16c: a finite value beyond the fixed axis is clamped to its edge, with a triangle and a count, and keeps its raw value", () => {
  test("Efficiency beyond +2 and below -2: full bars, one triangle up at the top edge and one down at the bottom (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor({ trades: EFFICIENCY_TRADES, cutoffIso: "2021-01-01T00:04:00Z" });
    await page.goto(`${fake.url}/${EFFICIENCY_VIEW}`);
    await atRest(page, fake, probe);
    const [high, low] = efficiencyOf();
    expect(high, "by the reference, column 0 is beyond +2").toBeGreaterThan(2);
    expect(low, "and column 1 beyond -2").toBeLessThan(-2);

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const up = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.85 });
    const down = paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.85 });
    expect([up.length, down.length], "one bar of each arm").toEqual([1, 1]);
    // Clamped: each is the full half of the pane, whatever its raw value.
    expect(up[0].h).toBeCloseTo(area.h / 2 - 4, 9);
    expect(down[0].h).toBeCloseTo(area.h / 2 - 4, 9);

    const glyphs = paneCanvas.glyphsOf(frame, colours.state);
    expect(glyphs.triUp.length, "a triangle for the overflow").toBe(1);
    expect(glyphs.triDown.length, "and for the underflow").toBe(1);
    const slot = down[0].x - up[0].x;
    expect(glyphs.triUp[0][0], "centred on column 0").toBeCloseTo(up[0].x + slot / 2, 6);
    expect(glyphs.triUp[0][1], "at the top edge").toBeCloseTo(area.y + 4, 9);
    expect(glyphs.triDown[0][0], "centred on column 1").toBeCloseTo(down[0].x + slot / 2, 6);
    expect(glyphs.triDown[0][1], "at the bottom edge").toBeCloseTo(area.bottom - 4, 9);
  });

  test("the raw value survives: the tooltip of the clamped bar has the reference value and its place on the axis", async ({ page, fakeFor, probe, surface, pane }) => {
    const fake = await fakeFor({ trades: EFFICIENCY_TRADES, cutoffIso: "2021-01-01T00:04:00Z" });
    await page.goto(`${fake.url}/${EFFICIENCY_VIEW}`);
    await atRest(page, fake, probe);
    const [high] = efficiencyOf();
    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const [bar] = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.85 });
    await surface.hoverCell({ x: bar.x + bar.w / 2, y: area.y + area.h / 2 - 6 });
    await expect.poll(async () => (await surface.tip()).readout).toBe("pane:pane.efficiency:0");
    const tip = await surface.tip();
    expect(Number(tip.fields.value.canonical), "the unclamped value").toBeCloseTo(high, 9);
    expect(Number(tip.fields.axisPosition.canonical), "drawn at the axis's edge").toBe(1);
    expect(tip.text, "and says it is beyond it").toContain("beyond the axis");
  });

  test("the keys count the triangles (one below, one above)", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor({ trades: EFFICIENCY_TRADES, cutoffIso: "2021-01-01T00:04:00Z" });
    await page.goto(`${fake.url}/${EFFICIENCY_VIEW}`);
    await atRest(page, fake, probe);
    await needKeys(surface);
    expect(await keyCount(surface, "clip-high")).toBe(1);
    expect(await keyCount(surface, "clip-low")).toBe(1);
  });

  test("columns with no trades under a whole parent are one neutral pattern across both (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor({ trades: EFFICIENCY_TRADES, cutoffIso: "2021-01-01T00:04:00Z" });
    await page.goto(`${fake.url}/${EFFICIENCY_VIEW}`);
    await atRest(page, fake, probe);
    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const up = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.85 });
    const down = paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.85 });
    const slot = down[0].x - up[0].x;
    // Columns 2 and 3 are adjacent, so they are one rectangle of the pattern: two slots wide, the pane's full height, starting where column 2 does.
    const patterned = frame.rects.filter((r) => r.fill === "pattern" && r.y >= area.y - 1e-6 && r.y + r.h <= area.bottom + 1e-6);
    expect(patterned.length, "one pattern rectangle in the pane").toBe(1);
    expect(patterned[0].x).toBeCloseTo(up[0].x + 2 * slot, 6);
    expect(patterned[0].w).toBeCloseTo(2 * slot, 6);
    expect(patterned[0].y).toBeCloseTo(area.y, 9);
    expect(patterned[0].h).toBeCloseTo(area.h, 9);
  });
});
