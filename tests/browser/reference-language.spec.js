"use strict";
// B40 reference-language.spec.js (PRD-0002 S3, #48 section 1): the reference language on the real page.
//
// What is asserted, on one engineered chart (a hand-made trade list on a fake cube, not market data):
//   1. a family has ONE hue and ONE stroke whatever the timeframe of a line: the POC lines of 1 day, 7 days and 30 days, and the moving average and the
//      Bollinger bands, are drawn at 1.5 px, fully opaque, in their family's colour; no tier tokens remain;
//   2. the pattern says how a mark is known, inside the span it is supported over: the held extension is dashed [5,4], a swing's lead-in dotted [1,3] and
//      the span solid, in the price levels' hue and in the profile's;
//   3. the Bollinger bands are three solid strokes named Upper, Middle and Lower, not a dash;
//   4. the user's Level is the one long dash-dot [8,3,2,3] in the ink, ending in a diamond, and tagged Level;
//   5. every clock line is the same width and each kind has its own pattern, in the neutral hue;
//   6. the swing triangle is one size for 4-hour and daily swings;
//   7. the Lines button has one dot for each colour (Session levels and Structure are two groups of one violet), the menu says the two groups are price
//      levels, and each family's key in the footer is painted by the plot's own painters (line, pattern, glyph);
//   8. the profile's value-area marks are gold with a square endpoint, and the POC glyph is a triangle.
// Oracles (none is the code under test): the PRD's table written out in the spec (hues by token, patterns [5,4], [1,3], [8,3,2,3], 1.5 px), the
// design tokens read back through a canvas, and the pixels of the key swatches at DPR 1 (the line runs through the middle row of an 11 px canvas).
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

async function ready(page, fake, probe) {
  await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { message: "startup is over", timeout: 120000 }).toBe(true);
  await S.atRest(page, fake, probe);
}

const EPOCH_MS = Date.parse("2021-01-01T00:00:00Z");
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ms = (iso) => Date.parse(iso) - EPOCH_MS;
const iso = (t) => new Date(t + EPOCH_MS).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");

function tradesOf(from, to, priceAt) {
  const out = [];
  for (let k = Math.ceil((from - 150000) / 300000); ; k++) {
    const t = k * 300000 + 150000;
    if (t > to) break;
    out.push({ t_ms: t, price: Math.round(priceAt(t) * 100), qty: 400000, takerBuy: k % 2 === 0 });
  }
  return out;
}
// a drift, a ten-hour rally of 700 USDT, a plateau and a fall in ten minutes at 16:00 UTC: one 4-hour and one daily swing high
const TE = ms("2026-09-01T00:00:00Z");
const drift = (t) => 25000 + 40 * Math.sin((2 * Math.PI * t) / (14 * HOUR));
function price(t) {
  const dt = t - TE;
  if (dt < 0) return drift(t);
  if (dt < 10 * HOUR) return drift(t) + 700 * (dt / (10 * HOUR));
  if (dt < 16 * HOUR) return 25700 + 5 * Math.sin((2 * Math.PI * t) / (3 * HOUR));
  if (dt < 16 * HOUR + 600000) return 25700 - 700 * ((dt - 16 * HOUR) / 600000);
  return drift(t);
}
const TRADES = tradesOf(ms("2026-08-02T00:00:00Z"), TE + 3 * DAY, price);
const CUTOFF = iso(TE + 3 * DAY);
const EDGE = TE + 44 * HOUR;

// the page's design tokens as "#rrggbb", read back through a canvas
function hues(page) {
  return page.evaluate(() => {
    const scratch = document.createElement("canvas").getContext("2d");
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const out = {};
    for (const name of ["ink", "surface", "muted", "poc", "line-poc", "line-level", "line-average", "line-vwap", "line-clock", "line-compare"]) {
      probe.style.color = `var(--ol-${name})`;
      scratch.fillStyle = "#000000";
      scratch.fillStyle = getComputedStyle(probe).color;
      out[name] = scratch.fillStyle;
    }
    probe.remove();
    return out;
  });
}

const horizontal = (k) => k.path.length >= 2 && k.path.every((p, i) => i % 2 === 0 || p[1] === k.path[i - 1][1]);
// a line of the chart, not a mark in a profile track's gutter (those are a few dozen px long)
const wide = (k) => Math.max(...k.path.map((p) => p[0])) - Math.min(...k.path.map((p) => p[0])) > 100;
const vertical = (k) => k.path.length >= 2 && k.path.every((p, i) => i % 2 === 0 || p[0] === k.path[i - 1][0]);
const dashes = (strokes) => [...new Set(strokes.map((k) => JSON.stringify(k.dash)))].sort();

const ADDRESS = (lines, extra = "") =>
  `#t=${iso(TE - 3 * DAY)}~${iso(TE + 6.5 * DAY)}&p=24800~26200&r=6,3&vis=2&lines=${lines}${extra}&replay=1&at=${iso(EDGE)}`;

test.describe("B40 the reference language: one hue and one stroke for a family, and the pattern says how a mark is known", () => {
  test("a family's lines are one hue at 1.5 px whatever their timeframe; the held extension is dashed, the lead-in dotted, the span solid", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${ADDRESS("1d,7d,30d,swing4h,swing1d,ema21,bb4h", "&level=25300")}`);
    await ready(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const c = await hues(page);
    // the averages' bars are read after the view's own reads: wait until their curves are on the plot
    await expect
      .poll(async () => (await pane.last()).strokes.filter((k) => k.stroke === c["line-average"] && k.path.length > 20).length, { message: "the three bands are drawn", timeout: 120000 })
      .toBeGreaterThanOrEqual(3);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const frame = await pane.last();
    // 1. the POC lines of three timeframes: horizontal strokes in the gold, every one 1.5 px, opaque, and nothing else of the family at another weight
    const poc = frame.strokes.filter((k) => k.stroke === c["line-poc"] && horizontal(k) && wide(k));
    expect(poc.length, "the POC lines are drawn").toBeGreaterThan(0);
    for (const k of poc) {
      expect(k.width, "a profile reference is 1.5 px whatever its period").toBe(1.5);
      expect(k.alpha, "and opaque").toBe(1);
    }
    expect(dashes(poc), "solid span and dashed held extension of the profile").toEqual([JSON.stringify([]), JSON.stringify([5, 4])].sort());
    // 2. the price levels (swings, 4-hour and daily): lead-in dotted, span solid, held extension dashed; all 1.5 px and opaque
    const level = frame.strokes.filter((k) => k.stroke === c["line-level"] && horizontal(k) && wide(k));
    expect(level.length).toBeGreaterThan(0);
    for (const k of level) {
      expect(k.width).toBe(1.5);
      expect(k.alpha).toBe(1);
    }
    expect(dashes(level), "the three patterns of a supported span").toEqual([JSON.stringify([]), JSON.stringify([1, 3]), JSON.stringify([5, 4])].sort());
    // 3. the average and the three Bollinger bands: solid curves at 1.5 px, no dash among them
    const curves = frame.strokes.filter((k) => k.stroke === c["line-average"] && k.path.length >= 3 && !horizontal(k));
    expect(curves.filter((k) => k.path.length > 20).length, "the upper, middle and lower band, a vertex a bar").toBe(3);
    expect(curves.length, "and the 21 EMA on daily bars").toBeGreaterThanOrEqual(4);
    for (const k of curves) {
      expect(k.width).toBe(1.5);
      expect(k.dash, "a curve is solid inside its span").toEqual([]);
    }
    // 4. the user's Level: ink, long dash-dot, a diamond at the right end, and its tag
    const lv = frame.strokes.filter((k) => k.stroke === c.ink && horizontal(k) && JSON.stringify(k.dash) === JSON.stringify([8, 3, 2, 3]));
    expect(lv.length, "the Level is one stroke").toBe(1);
    expect(lv[0].width).toBe(1.5);
    const diamonds = frame.fills.filter((f) => f.fill === c.ink && f.path.length === 4 && Math.abs(Math.max(...f.path.map((p) => p[0])) - Math.min(...f.path.map((p) => p[0])) - 9) < 1e-6);
    expect(diamonds.length, "its endpoint diamond").toBe(1);
    expect(frame.texts.some((t) => t.text === "Level"), "tagged Level").toBe(true);
    // 6. one size for the swing triangle, 4-hour or daily
    const triangles = frame.fills.filter((f) => f.fill === c["line-level"] && f.path.length === 3);
    expect(triangles.length, "the swings' triangles").toBeGreaterThan(0);
    const sizes = new Set(triangles.map((f) => `${(Math.max(...f.path.map((p) => p[0])) - Math.min(...f.path.map((p) => p[0]))).toFixed(3)}x${(Math.max(...f.path.map((p) => p[1])) - Math.min(...f.path.map((p) => p[1]))).toFixed(3)}`));
    expect(sizes.size, `one triangle size, found ${[...sizes].join(", ")}`).toBe(1);
    // the labels carry the bands' words and the timeframe
    for (const word of ["Upper", "Middle", "Lower"]) expect(frame.texts.some((t) => t.text.includes(`BB 4h ${word}`)), `a tag says ${word}`).toBe(true);
    // no tier tokens remain on the page
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("origo-lens")).getPropertyValue("--ol-tier-short-width"))).toBe("");
  });

  test("every clock line is the same width and each kind has its own pattern, in the neutral hue", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${ADDRESS("cday,cweek,funding,usopen,deribit")}`);
    await ready(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const frame = await pane.last(),
      c = await hues(page);
    const clock = frame.strokes.filter((k) => k.stroke === c["line-clock"] && vertical(k));
    expect(clock.length, "the clock kinds in view").toBeGreaterThanOrEqual(4);
    for (const k of clock) expect(k.width, "a clock line is the stable width").toBe(1.5);
    expect(dashes(clock), "one pattern for each kind: day start, week open, funding, US open, Deribit").toEqual(
      [[], [12, 3], [1, 3], [4, 3], [2, 2]].map((d) => JSON.stringify(d)).sort(),
    );
  });

  test("the Lines button has a dot for each colour, the menu names the two price-level groups, and the footer keys are painted by the plot's painters", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${ADDRESS("7d,va,dopen,ath,ema21,cday,funding", "&level=25300")}`);
    await ready(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const c = await hues(page);
    // 7. a dot for the gold, the violet (Session levels and Structure together), the olive, the clock's neutral and the user's ink
    const dots = await page.locator("#ol-lines-dots i").evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).backgroundColor));
    expect(dots.length, "one dot for each colour that has lines on").toBe(5);
    expect(new Set(dots).size, "no two dots of one colour").toBe(5);
    await page.locator("#ol-lines").click();
    for (const id of ["session", "structure"]) await expect(page.locator(`[data-family="${id}"] .ol-family-kin`)).toHaveText("price levels");
    // a clock kind's swatch carries its own pattern, the Level's the dash-dot
    expect(await page.locator('[data-line-swatch="funding"]').evaluate((n) => getComputedStyle(n).backgroundImage), "a dotted swatch for funding").toContain("linear-gradient");
    expect(await page.locator(".ol-level-swatch").evaluate((n) => getComputedStyle(n).backgroundImage), "the Level's dash-dot").toContain("linear-gradient");
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-lines-pop")).toBeHidden();
    // the footer keys: a family's key is its line in its hue; the patterns' keys are their dashes in the ink; the Level's key is its dash-dot
    const keys = await page.locator("#ol-keys-ref [data-ref-key]").evaluateAll((nodes) => nodes.map((n) => [n.dataset.refKey, n.textContent.trim()]));
    expect(keys.map((k) => k[0]), "a key for each family on and for each pattern").toEqual([
      "family:profile",
      "family:level",
      "family:average",
      "family:clock",
      "family:user",
      "pattern:support",
      "pattern:held",
      "pattern:lead",
    ]);
    expect(keys.find((k) => k[0] === "family:level")[1]).toBe("Price levels");
    const pixel = (key, x, y) =>
      page.evaluate(
        ([k, px, py]) => {
          const canvas = document.querySelector(`[data-ref-key="${k}"] canvas`);
          const d = canvas.getContext("2d").getImageData(px, py, 1, 1).data;
          return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        },
        [key, x, y],
      );
    expect(await pixel("family:level", 12, 5), "the price levels' line is the violet").toBe(c["line-level"]);
    expect(await pixel("family:average", 12, 5), "the averages' line is the olive").toBe(c["line-average"]);
    expect(await pixel("family:clock", 12, 5), "the clock's line is the neutral").toBe(c["line-clock"]);
    expect(await pixel("family:profile", 12, 5), "the profile's line is the gold").toBe(c["line-poc"]);
    expect(await pixel("pattern:held", 3, 5), "the dashed key's first dash").toBe(c.ink);
    expect(await pixel("pattern:held", 8, 5), "and its gap: 5 on, 4 off from x = 1").toBe(c.surface);
    expect(await pixel("pattern:lead", 1, 5), "the dotted key's first dot").toBe(c.ink);
    expect(await pixel("pattern:lead", 3, 5), "and its gap").toBe(c.surface);
    expect(await pixel("family:user", 3, 5), "the Level's first dash").toBe(c.ink);
    expect(await pixel("family:user", 10, 5), "and its first gap: 8 on, 3 off from x = 1").toBe(c.surface);
  });

  test("the profile's value area is gold with a square endpoint and the POC a triangle", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${ADDRESS("7d,va", "&marks=poc,area,untested")}`);
    await ready(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const frame = await pane.last(),
      c = await hues(page);
    // the endpoint glyphs at the end of the observed spans: filled gold triangles for the POC, hollow gold squares (closed four-vertex strokes) for VAH and VAL
    const triangles = frame.fills.filter((f) => f.fill === c.poc && f.path.length === 3);
    const squares = frame.strokes.filter((k) => k.stroke === c.poc && k.width === 1.25 && k.path.length === 4 && k.path[0][1] === k.path[1][1]);
    expect(triangles.length, "a POC triangle for the 7-day line").toBeGreaterThan(0);
    expect(squares.length, "a square for each edge of the value area").toBeGreaterThanOrEqual(2);
    // the value area's edges are the same gold as the POC, 1.5 px, with their names
    const edges = frame.strokes.filter((k) => k.stroke === c["line-poc"] && horizontal(k) && wide(k));
    expect(edges.length).toBeGreaterThan(0);
    for (const k of edges) expect(k.width).toBe(1.5);
    expect(frame.texts.some((t) => /VAH/.test(t.text)) && frame.texts.some((t) => /VAL/.test(t.text)), "VAH and VAL are named").toBe(true);
    // the column marks of the same family: the 70% value-area boxes, the POC polyline and the untested rays are all the profile's gold
    expect(frame.strokeRects.filter((r) => r.stroke === c.poc && r.alpha === 0.5 && r.width === 1).length, "the columns' value-area boxes are gold").toBeGreaterThan(0);
    expect(frame.strokes.filter((k) => k.stroke === c.poc && Math.abs(k.width - 1.7) < 1e-3 && k.path.length >= 3).length, "the column POC polyline is gold").toBeGreaterThan(0);
    expect(frame.strokes.filter((k) => k.stroke === c.poc && k.alpha === 0.36 && horizontal(k)).length, "the untested rays are gold").toBeGreaterThan(0);
    // the footer says what they are: the value area's key is the gold line ending in a square, the untested key a dot and a thin line
    const key = (role, x, y) =>
      page.evaluate(
        ([r, px, py]) => {
          const canvas = document.querySelector(`[data-stroke-role="${r}"] canvas`);
          const d = canvas.getContext("2d").getImageData(px, py, 1, 1).data;
          return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        },
        [role, x, y],
      );
    expect(await key("va", 2, 5), "the value area's key line is the gold").toBe(c.poc);
    await expect(page.locator("#ol-key-area")).toContainText("VAH and VAL");
    await expect(page.locator("#ol-ray-count")).toContainText("untested levels");
    expect(await page.locator('[data-stroke-role="untested"] canvas').count(), "the untested key is painted").toBe(1);
  });
});
