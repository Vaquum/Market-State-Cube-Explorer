"use strict";
// B33 events-known-at.spec.js (PRD-0002 S2, #47 section 6): a 4-hour swing and a CME gap, replayed on the real page before, while forming, at and after the
// bar that completes them.
//
// An engineered price path on a fake cube (a hand-made trade list, not market data):
//   * swing: a slow drift, then a steady rally of 700 USDT over ten hours, a plateau, and at 16:00 UTC (the start of a 4-hour bar) a fall of 700 USDT in ten
//     minutes. The high of the plateau is confirmed by the bar that begins at the fall, at the END of that bar, not before;
//   * gap: a weekend in which the spot price walks from 25,000 at Friday 21:00 UTC to 25,300 at the Sunday 22:00 reopen, stays there and, at Monday 03:15 UTC,
//     falls back through 25,000 inside the hourly bar that begins at 03:00. The gap is known at the reopen; its fill at the END of that bar, not before.
// The page is opened in replay at each edge (an edge is where its data ends; the bar at the edge is read up to it), so nothing after the edge can reach it.
// The level is fixed in the address (`r=`): a replay edge is floored to the time step of the level the view is RENDERED at, and every edge here is a multiple of
// the step it settles at; far from the live edge that can be a coarser tier than the address asks for, so the crossings' data ends five days after their day
// and their views lie inside the seven days the page holds at the finest level.
// Oracles (none is the code under test): the reference bars of tests/reference/bars.js (exact arithmetic) and the reference zigzag written from the rule
// (tests/reference/swings.js), both fed only the trades before the edge; the fixture's own design (which edge is before, inside and after the bar) asserted
// first, so the scenario has teeth.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const refBars = require("../reference/bars.js");
const refSwings = require("../reference/swings.js");
const refInd = require("../reference/indicators.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

// Startup is over when the page has begun to poll the cube (its live poll is the last thing startup starts); `atRest` alone can pass before the page has
// written its first loading caption, so a view with many days of bars to unpack was read while its first tiers were still coming in.
async function ready(page, fake, probe) {
  await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { message: "startup is over", timeout: 30000 }).toBe(true);
  await S.atRest(page, fake, probe);
}

const EPOCH_MS = Date.parse("2021-01-01T00:00:00Z");
const HOUR = 3600000;
const BASE_MS = 56250; // one base column
const ms = (iso) => Date.parse(iso) - EPOCH_MS;
const iso = (t) => new Date(t + EPOCH_MS).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");
const baseOf = (t) => t / BASE_MS; // the page's time unit, in base columns
const FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

// A trade every five minutes at 2:30 into it (never on an edge), alternating sides.
function tradesOf(from, to, priceAt) {
  const out = [];
  for (let k = Math.ceil((from - 150000) / 300000); ; k++) {
    const t = k * 300000 + 150000;
    if (t > to) break;
    out.push({ t_ms: t, price: Math.round(priceAt(t) * 100), qty: 400000, takerBuy: k % 2 === 0 });
  }
  return out;
}
const drift = (t) => 25000 + 40 * Math.sin((2 * Math.PI * t) / (14 * HOUR));
const tradesBefore = (trades, edge) => trades.filter((x) => x.t_ms < edge);

// ---- the swing ---------------------------------------------------------------------------------------------------

const TE = ms("2026-09-01T00:00:00Z");
function swingPrice(t) {
  const dt = t - TE;
  if (dt < 0) return drift(t);
  if (dt < 10 * HOUR) return drift(t) + 700 * (dt / (10 * HOUR));
  if (dt < 16 * HOUR) return 25700 + 5 * Math.sin((2 * Math.PI * t) / (3 * HOUR));
  if (dt < 16 * HOUR + 600000) return 25700 - 700 * ((dt - 16 * HOUR) / 600000);
  return drift(t);
}
const SWING_TRADES = tradesOf(ms("2026-08-02T00:00:00Z"), TE + 3 * 24 * HOUR, swingPrice);
const SWING_CUTOFF = iso(TE + 3 * 24 * HOUR);
// the 4-hour bars of the reference at an edge: the complete ones and, when the edge is inside one, that bar as it stands
function swingAt(edge) {
  const list = refBars.bars(tradesBefore(SWING_TRADES, edge), { n: 8, b0: 0, b1: Math.ceil(baseOf(edge)) });
  const found = refSwings.swings(list);
  const s = found.length ? found[found.length - 1] : null;
  if (!s) return null;
  const step = 14400000;
  return { kind: s.kind, price: s.price, confirmStart: list[s.ci].col * step, confirmEnd: (list[s.ci].col + 1) * step, extremeStart: list[s.i].col * step };
}

const EDGE = {
  notBegun: TE + 16 * HOUR, // the bar that will confirm it has not begun
  forming: TE + 17 * HOUR, // it is an hour into that bar, and the fall is in it
  atEnd: TE + 20 * HOUR, // the bar has just ended
  later: TE + 44 * HOUR,
};

test.describe("B33 a 4-hour swing is known at the end of the bar that reversed from it", () => {
  test("the scenario: the reference sees no swing before the bar, a candidate inside it, and the swing known at its end", () => {
    // before the plateau's high can be confirmed the last swing is the drift's low, confirmed by the first bar of the rally
    const early = swingAt(EDGE.notBegun);
    expect(early.kind, "no high yet: the confirming bar has not begun").toBe("low");
    expect(early.confirmEnd, "the low is confirmed").toBeLessThanOrEqual(EDGE.notBegun);
    const inside = swingAt(EDGE.forming);
    expect(inside.kind).toBe("high");
    expect(inside.confirmStart).toBe(TE + 16 * HOUR);
    expect(inside.confirmEnd, "the confirming bar is still forming at the edge").toBeGreaterThan(EDGE.forming);
    const done = swingAt(EDGE.atEnd);
    expect(done.confirmEnd).toBe(EDGE.atEnd);
    expect(done.price, "the same high").toBe(inside.price);
    expect(swingAt(EDGE.later)).toEqual(done);
  });

  for (const [name, edge] of Object.entries(EDGE)) {
    test(`replay at ${name}: the Lines row says what the reference says, with its finality and known-at`, async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor({ trades: SWING_TRADES, cutoffIso: SWING_CUTOFF });
      await page.setViewportSize({ width: 1500, height: 950 });
      await page.goto(`${fake.url}/#t=${iso(TE - 36 * HOUR)}~${iso(TE + 30 * HOUR)}&p=24800~26000&r=6,3&vis=2&lines=swing4h&replay=1&at=${iso(edge)}`);
      await ready(page, fake, probe);
      // the rows of the Lines popover are written while it is open
      await page.locator("#ol-lines").click();
      const row = page.locator('[data-line-value="swing4h"]');
      await expect.poll(async () => (await row.textContent()) !== "…", { message: "the swing row has its answer" }).toBe(true);
      const want = swingAt(edge);
      const candidate = want.confirmEnd > edge;
      await expect(row, "its latest swing, and so far while only a forming bar confirms it").toHaveText(`${want.kind === "high" ? "H" : "L"} ${FORMAT.format(want.price)}${candidate ? " · so far" : ""}`);
      await expect(row).toHaveAttribute("data-finality", candidate ? "so far" : "confirmed");
      if (candidate) await expect(row, "a candidate has no known-at").not.toHaveAttribute("data-known-at", /.*/);
      else await expect(row, "known at the end of its confirming bar").toHaveAttribute("data-known-at", String(baseOf(want.confirmEnd)));
      // the same record at the swing's own line: hover its dotted lead-in
      await page.keyboard.press("Escape");
      await expect(page.locator("#ol-lines-pop")).toBeHidden();
      await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
      const frame = await pane.last();
      // every dotted lead-in of the frame is a segment [from, to] of a batched stroke; the swing in question is the latest one, the one that ends last
      const leads = [],
        hue = (await pane.colours()).level;
      for (const k of frame.strokes)
        if (k.stroke === hue && JSON.stringify(k.dash) === "[1,3]" && k.alpha === 1 && k.width === 1.5) for (let i = 0; i + 1 < k.path.length; i += 2) leads.push([k.path[i], k.path[i + 1]]);
      expect(leads.length, "the swing's lead-in is drawn").toBeGreaterThan(0);
      const lead = leads.reduce((a, b) => (b[1][0] > a[1][0] ? b : a));
      const box = await page.locator("#ol-canvas").boundingBox();
      await page.mouse.move(box.x + (lead[0][0] + lead[1][0]) / 2, box.y + lead[0][1]);
      const tip = page.locator("#ol-tip");
      await expect(tip).toBeVisible();
      await expect(tip).toHaveAttribute("data-event", candidate ? "swing|so far" : "swing|confirmed");
      await expect(tip.locator('dd[data-field="finality"]')).toHaveAttribute("data-canonical", candidate ? "so far" : "confirmed");
      await expect(tip.locator('dd[data-field="knownAt"]')).toHaveAttribute("data-canonical", candidate ? "null" : String(baseOf(want.confirmEnd)));
      await expect(tip).toContainText(candidate ? /candidate, not confirmed/ : /Confirmed/);
      await expect(tip).toContainText("4-hour bars");
    });
  }
});

// ---- the gap -----------------------------------------------------------------------------------------------------

const FRI = ms("2026-09-04T21:00:00Z"),
  SUN_REOPEN = ms("2026-09-06T22:00:00Z"),
  MON_FALL = ms("2026-09-07T03:15:00Z"),
  MON_FILL_BAR_END = ms("2026-09-07T04:00:00Z");
function gapPrice(t) {
  if (t < FRI - 6 * HOUR || t > MON_FALL + 6 * HOUR) return drift(t);
  if (t <= FRI) return 25000;
  if (t < ms("2026-09-06T21:30:00Z")) return 25000 + 300 * ((t - FRI) / (ms("2026-09-06T21:30:00Z") - FRI));
  if (t < MON_FALL) return 25300;
  if (t < MON_FALL + 600000) return 25300 - 310 * ((t - MON_FALL) / 600000);
  return 24990;
}
const GAP_TRADES = tradesOf(ms("2026-08-02T00:00:00Z"), ms("2026-09-07T12:00:00Z"), gapPrice);
const GAP_CUTOFF = "2026-09-07T12:00:00Z";
// the gap from the reference's hourly bars at an edge: the spot at each boundary is the close of the hour that ends there
function gapAt(edge) {
  const list = refBars.bars(tradesBefore(GAP_TRADES, edge), { n: 6, b0: 0, b1: Math.ceil(baseOf(edge)) });
  const hour = HOUR;
  const byStart = new Map(list.map((b) => [b.col * hour, b]));
  if (edge < SUN_REOPEN) return null;
  const fri = byStart.get(FRI - hour).close,
    sun = byStart.get(SUN_REOPEN - hour).close;
  const up = sun > fri;
  let fill = null;
  for (const b of list) {
    const start = b.col * hour;
    if (start < SUN_REOPEN) continue;
    if (up ? b.low <= fri : b.high >= fri) {
      fill = { start, end: start + hour };
      break;
    }
  }
  return { fri, sun, fill };
}
const GAP_EDGE = {
  beforeReopen: ms("2026-09-06T21:30:00Z"),
  open: ms("2026-09-06T23:30:00Z"),
  fillBarNotBegun: ms("2026-09-07T03:00:00Z"),
  forming: ms("2026-09-07T03:30:00Z"),
  atEnd: MON_FILL_BAR_END,
  later: ms("2026-09-07T10:00:00Z"),
};

test.describe("B33 a CME gap is known at the reopen and filled at the end of the bar that crossed", () => {
  test("the scenario: no gap before the reopen, open until the crossing bar forms, a candidate inside it, filled at its end", () => {
    expect(gapAt(GAP_EDGE.beforeReopen)).toBeNull();
    const open = gapAt(GAP_EDGE.open);
    expect(open.sun).toBeGreaterThan(open.fri);
    expect(open.fill).toBeNull();
    expect(gapAt(GAP_EDGE.fillBarNotBegun).fill).toBeNull();
    expect(gapAt(GAP_EDGE.forming).fill.end, "the crossing bar is still forming at the edge").toBeGreaterThan(GAP_EDGE.forming);
    expect(gapAt(GAP_EDGE.atEnd).fill).toEqual({ start: ms("2026-09-07T03:00:00Z"), end: MON_FILL_BAR_END });
    expect(gapAt(GAP_EDGE.later).fill.end).toBe(MON_FILL_BAR_END);
  });

  for (const [name, edge] of Object.entries(GAP_EDGE)) {
    test(`replay at ${name}: the gap's tooltip says what the reference says`, async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor({ trades: GAP_TRADES, cutoffIso: GAP_CUTOFF });
      await page.setViewportSize({ width: 1500, height: 950 });
      await page.goto(`${fake.url}/#t=${iso(ms("2026-09-06T18:00:00Z"))}~${iso(ms("2026-09-07T06:00:00Z"))}&p=24800~25500&r=5,2&vis=2&lines=cme&replay=1&at=${iso(edge)}`);
      await ready(page, fake, probe);
      const want = gapAt(edge);
      const frame = await pane.last();
      const boxes = frame.strokeRects.filter((r) => r.alpha === 0.7 && r.width === 1);
      if (want === null) {
        expect(boxes, "no gap before the reopen").toEqual([]);
        return;
      }
      expect(boxes.length, "the gap is drawn as an outline").toBe(1);
      const r = boxes[0],
        box = await page.locator("#ol-canvas").boundingBox();
      await page.mouse.move(box.x + r.x + r.w / 2, box.y + r.y + r.h / 2);
      const tip = page.locator("#ol-tip");
      await expect(tip).toBeVisible();
      const filled = want.fill !== null && want.fill.end <= edge,
        candidate = want.fill !== null && want.fill.end > edge;
      await expect(tip).toHaveAttribute("data-event", filled ? "cmeGap|filled" : candidate ? "cmeGap|so far" : "cmeGap|open");
      await expect(tip.locator('dd[data-field="knownAt"]'), "the gap is known at the reopen").toHaveAttribute("data-canonical", String(baseOf(SUN_REOPEN)));
      await expect(tip.locator('dd[data-field="fillKnownAt"]'), "the fill no earlier than the end of the crossing bar").toHaveAttribute("data-canonical", filled ? String(baseOf(want.fill.end)) : "null");
      if (filled) await expect(tip).toContainText("Traded backby 7 Sep 04:00 UTC");
      else if (candidate) await expect(tip).toContainText("so far: the hourly bar that crossed is still forming");
      else await expect(tip).toContainText("Traded backnot yet");
      await expect(tip).toContainText("hourly bars");
    });
  }
});

// ---- an RSI divergence and an equal pair ---------------------------------------------------------------------------

// Two swing highs a little apart: a steep rally (RSI high), a fall of 600 USDT, a slow rise to a high 60 USDT above the first (RSI lower, the fall still in
// its window), a plateau and a second fall at 60:00 that confirms the second high at the end of the bar it falls in.
const T2 = ms("2026-09-10T00:00:00Z");
function divergencePrice(t) {
  const u = t - T2,
    minute = 60000;
  if (u < 0) return drift(t);
  if (u < 8 * HOUR) return drift(t) + 800 * (u / (8 * HOUR));
  if (u < 12 * HOUR) return 25800 + 3 * Math.sin((2 * Math.PI * t) / (3 * HOUR));
  if (u < 12 * HOUR + 20 * minute) return 25800 - 600 * ((u - 12 * HOUR) / (20 * minute));
  if (u < 16 * HOUR) return 25200;
  if (u < 48 * HOUR) return 25200 + 660 * ((u - 16 * HOUR) / (32 * HOUR));
  if (u < 60 * HOUR) return 25860 + 3 * Math.sin((2 * Math.PI * t) / (3 * HOUR));
  if (u < 60 * HOUR + 20 * minute) return 25860 - 600 * ((u - 60 * HOUR) / (20 * minute));
  return 25260;
}
const DIVERGENCE_TRADES = tradesOf(ms("2026-08-02T00:00:00Z"), T2 + 96 * HOUR, divergencePrice);
const DIVERGENCE_CUTOFF = iso(T2 + 96 * HOUR);
// RSI 14 of the closes, from its definition: the first average is the mean of the first 14 changes, then Wilder's smoothing.
function rsiOf(closes, n = 14) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= n) return out;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let ag = gain / n,
    al = loss / n;
  const value = () => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  out[n] = value();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}
// The reference's swings, divergences and equal pairs at an edge (only the trades before it).
function divergenceAt(edge) {
  const list = refBars.bars(tradesBefore(DIVERGENCE_TRADES, edge), { n: 8, b0: 0, b1: Math.ceil(baseOf(edge)) });
  const found = refSwings.swings(list),
    rsi = rsiOf(list.map((b) => b.close)),
    step = 14400000;
  const divergences = [],
    equal = [],
    last = {};
  for (const s of found) {
    const was = last[s.kind];
    last[s.kind] = s;
    if (!was) continue;
    if (Math.abs(s.price - was.price) <= 125) equal.push({ a: was, b: s });
    if (Number.isFinite(rsi[was.i]) && Number.isFinite(rsi[s.i]) && (s.kind === "high" ? s.price > was.price && rsi[s.i] < rsi[was.i] : s.price < was.price && rsi[s.i] > rsi[was.i])) divergences.push({ a: was, b: s });
  }
  const end = (s) => (list[s.ci].col + 1) * step;
  return { divergences, equal, candidate: (pair) => end(pair.b) > edge, confirmEnd: (pair) => end(pair.b) };
}
const DIV_EDGE = { notBegun: T2 + 60 * HOUR, forming: T2 + 61 * HOUR, atEnd: T2 + 64 * HOUR, later: T2 + 90 * HOUR };

test.describe("B33 an RSI divergence and an equal pair are known at the later swing's confirmation", () => {
  test("the scenario: two highs 60 USDT apart, a divergence once the second is a swing, a candidate while its bar forms", () => {
    const before = divergenceAt(DIV_EDGE.notBegun);
    expect(before.divergences, "the second high is not a swing before its bar").toEqual([]);
    expect(before.equal).toEqual([]);
    const inside = divergenceAt(DIV_EDGE.forming);
    expect(inside.divergences.length).toBe(1);
    expect(inside.candidate(inside.divergences[0]), "its bar is still forming").toBe(true);
    expect(inside.equal.length).toBe(1);
    const done = divergenceAt(DIV_EDGE.atEnd);
    expect(done.divergences.length).toBe(1);
    expect(done.candidate(done.divergences[0])).toBe(false);
    expect(done.confirmEnd(done.divergences[0])).toBe(T2 + 64 * HOUR);
    expect(divergenceAt(DIV_EDGE.later).confirmEnd(divergenceAt(DIV_EDGE.later).divergences[0])).toBe(T2 + 64 * HOUR);
  });

  for (const [name, edge] of Object.entries(DIV_EDGE)) {
    test(`replay at ${name}: the divergence and the pair are drawn as the reference says and their tooltips name when they are known`, async ({ page, probe, fakeFor, pane }) => {
      const fake = await fakeFor({ trades: DIVERGENCE_TRADES, cutoffIso: DIVERGENCE_CUTOFF });
      await page.setViewportSize({ width: 1500, height: 950 });
      await page.goto(`${fake.url}/#t=${iso(T2 - 6 * HOUR)}~${iso(T2 + 72 * HOUR)}&p=24900~26000&r=6,3&vis=2&lines=swing4h&pane=rsi4h&replay=1&at=${iso(edge)}`);
      await ready(page, fake, probe);
      const want = divergenceAt(edge);
      const frame = await pane.last(),
        c = await pane.colours();
      // a divergence is a neutral line (the ink, 1.5 px) between two RSI values; an equal pair is a price-level line (1.5 px) between two highs
      const divs = frame.strokes.filter((k) => k.stroke === c.ink && k.width === 1.5 && k.alpha === 0.95 && k.path.length === 2);
      const joins = frame.strokes.filter((k) => k.stroke === c.level && k.width === 1.5 && k.alpha === 1 && k.path.length === 2 && k.path[0][0] !== k.path[1][0] && k.path[0][1] !== k.path[1][1]);
      expect(divs.length, "the divergences drawn are the reference's").toBe(want.divergences.length);
      expect(joins.length, "the equal pairs joined are the reference's").toBe(want.equal.length);
      if (want.divergences.length === 0) return;
      const candidate = want.candidate(want.divergences[0]);
      expect(JSON.stringify(divs[0].dash), "a divergence on a candidate swing is dotted, the lead-in pattern").toBe(candidate ? "[1,3]" : "[]");
      // the markers are neutral triangles, one at each swing, pointing down for two highs (the price higher, RSI lower) and up for two lows, and the
      // words say the relationship: a divergence is not a sign and borrows neither signed role
      const bearish = want.divergences[0].b.kind === "high",
        triangles = frame.fills.filter((f) => f.path.length === 3 && f.fill === c.ink && f.path[1][1] === f.path[2][1]);
      expect(triangles.length, "a triangle at each of the two swings of each divergence").toBe(2 * want.divergences.length);
      for (const t of triangles) expect(t.path[0][1] > t.path[1][1], "the apex points down for highs, up for lows").toBe(bearish);
      expect(frame.fills.filter((f) => (f.fill === c.positive || f.fill === c.negative) && f.path.length === 3), "no signed role on a divergence").toEqual([]);
      expect(frame.texts.some((t) => t.text === (bearish ? "Price higher, RSI lower" : "Price lower, RSI higher")), "the relationship in words").toBe(true);
      const box = await page.locator("#ol-canvas").boundingBox(),
        tip = page.locator("#ol-tip"),
        known = String(baseOf(want.confirmEnd(want.divergences[0])));
      // the divergence: hover at its later swing's bar, in the RSI pane
      await page.mouse.move(box.x + divs[0].path[1][0], box.y + divs[0].path[1][1]);
      await expect(tip).toBeVisible();
      await expect(tip).toHaveAttribute("data-event", candidate ? "rsiDivergence|so far" : "rsiDivergence|confirmed");
      await expect(tip.locator('dd[data-field="knownAt"]')).toHaveAttribute("data-canonical", candidate ? "null" : known);
      await expect(tip).toContainText(candidate ? /The later swing is a candidate on a bar still forming: the divergence is not confirmed/ : /Status\s*Confirmed/);
      await expect(tip).toContainText("4-hour bars");
      // the pair: hover on the segment that joins the two highs
      const join = joins[0];
      await page.mouse.move(box.x + 2, box.y + 2);
      await page.mouse.move(box.x + (join.path[0][0] + join.path[1][0]) / 2, box.y + (join.path[0][1] + join.path[1][1]) / 2);
      await expect(tip).toHaveAttribute("data-event", candidate ? "equalSwings|so far" : "equalSwings|confirmed");
      await expect(tip.locator('dd[data-field="knownAt"]')).toHaveAttribute("data-canonical", candidate ? "null" : known);
    });
  }
});

// ---- crossings ---------------------------------------------------------------------------------------------------

// 260 days of a slow fall, then a steady rally from day 190: the 50-day average crosses above the 200-day one some days after the 200-day one exists, and
// MACD crosses its signal as the rally starts. Day k is [D0 + k days, D0 + (k + 1) days); a day's close is its last trade.
const DAY = 24 * HOUR;
const D0 = ms("2025-12-01T00:00:00Z");
function crossPrice(t) {
  const d = (t - D0) / DAY,
    wiggle = 10 * Math.sin((2 * Math.PI * t) / (7 * HOUR));
  return (d < 190 ? 26000 - 5 * d : 25050 + 60 * (d - 190)) + wiggle;
}
const CROSS_TRADES = tradesOf(D0, D0 + 260 * DAY, crossPrice);
// the daily closes the page has at an edge (the day at the edge as it stands), and the crossings of a pair of series
function dailyCloses(edge) {
  const closes = [];
  for (const x of tradesBefore(CROSS_TRADES, edge)) closes[Math.floor((x.t_ms - D0) / DAY)] = x.price / 100;
  return closes;
}
function crossesAt(edge) {
  const closes = dailyCloses(edge),
    { macd, signal } = refInd.macd(closes);
  return { golden: refInd.crosses(refInd.sma(closes, 50), refInd.sma(closes, 200)), macd: refInd.crosses(macd, signal), last: closes.length - 1 };
}
const FULL = crossesAt(D0 + 260 * DAY);
const GOLDEN_DAY = FULL.golden.filter((c) => c.up).at(-1).i;
const MACD_DAY = FULL.macd.at(-1).i;
// (a replay edge is floored to the time step of the level the view is at: a view a few days wide is at a step of an hour or less, which the edges here are multiples of)
const crossEdges = (day) => ({ notBegun: D0 + day * DAY, forming: D0 + day * DAY + 20 * HOUR, atEnd: D0 + (day + 1) * DAY, later: D0 + (day + 4) * DAY });

test.describe("B33 a crossing is known at the end of its day and a candidate while the day forms", () => {
  test("the scenario: each crossing is absent before its day, a candidate late in it, known at the day's end and the same after", () => {
    expect(GOLDEN_DAY, "the 200-day average exists from day 199").toBeGreaterThanOrEqual(199);
    for (const [name, day, pick] of [["golden", GOLDEN_DAY, (c) => c.golden.filter((x) => x.up)], ["macd", MACD_DAY, (c) => c.macd]]) {
      const at = crossEdges(day);
      const lastOf = (edge) => pick(crossesAt(edge)).at(-1);
      expect(lastOf(at.notBegun)?.i ?? -1, `${name}: not yet on day ${day}`).toBeLessThan(day);
      expect(lastOf(at.forming)?.i, `${name}: a candidate late in day ${day}`).toBe(day);
      expect(crossesAt(at.forming).last, "the day forms").toBe(day);
      expect(lastOf(at.atEnd)?.i, `${name}: confirmed at the day's end`).toBe(day);
      expect(lastOf(at.later)?.i).toBe(day);
    }
  });

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayLabel = (i) => {
    const d = new Date(D0 + i * DAY + EPOCH_MS);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  };
  for (const [kind, pane, lines, pick, day] of [
    ["golden cross", "", "gdcross", (c) => c.golden.filter((x) => x.up), GOLDEN_DAY],
    ["MACD cross", "macd1d", "", (c) => c.macd, MACD_DAY],
  ])
    for (const [name, edge] of Object.entries(crossEdges(day))) {
      test(`${kind}, replay at ${name}: the marker's tooltip names when it is known`, async ({ page, probe, fakeFor, pane: rec }) => {
        // the data ends five days after the crossing's day, so the view is inside the last seven days, which the page holds at the finest level: nothing
        // to read, and the replay edge is not floored to a coarser tier
        const cutoff = D0 + (day + 5) * DAY;
        const fake = await fakeFor({ trades: CROSS_TRADES.filter((x) => x.t_ms < cutoff), cutoffIso: iso(cutoff) });
        await page.setViewportSize({ width: 1500, height: 950 });
        await page.goto(`${fake.url}/#t=${iso(D0 + day * DAY - 12 * HOUR)}~${iso(edge + 12 * HOUR)}&p=25000~27000&r=6,4&vis=2${lines ? `&lines=${lines}` : ""}${pane ? `&pane=${pane}` : ""}&replay=1&at=${iso(edge)}`);
        await ready(page, fake, probe);
        const all = crossesAt(edge),
          list = pick(all),
          want = list.at(-1);
        if (lines) {
          // the bars are read after the view's own reads: the Lines row says when the page has them, and what it found
          await page.locator("#ol-lines").click();
          const row = page.locator('[data-line-value="gdcross"]');
          await expect(row, "the page's latest crossing is the reference's").toHaveText(want ? `Golden ${dayLabel(want.i)}` : "none");
          await page.keyboard.press("Escape");
          await expect(page.locator("#ol-lines-pop")).toBeHidden();
        } else
          await expect
            .poll(async () => (await rec.last()).strokes.some((k) => k.width === 1.5 && k.stroke !== "#ffffff" && k.path.length >= 2), { message: "MACD is drawn" })
            .toBe(true);
        await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
        const frame = await rec.last(),
          colours = await rec.colours();
        // a golden or death cross is a dot (filled or ringed); a MACD crossing is a triangle: up in the positive role where MACD crosses above its signal,
        // down in the negative role where it crosses below, so the sign is in the shape and the colour both and means only MACD minus its signal
        const arcs = pane
          ? frame.fills
              .filter((f) => f.path.length === 3 && (f.fill === colours.positive || f.fill === colours.negative))
              .map((f) => {
                const [tip, base] = f.path,
                  up = tip[1] < base[1];
                return { x: tip[0], y: up ? tip[1] + 4.5 : tip[1] - 4.5, up, fill: f.fill };
              })
          : frame.arcs.filter((a) => a.r >= 3);
        if (!want) {
          expect(arcs, "no crossing yet").toEqual([]);
          return;
        }
        expect(arcs.length, "a marker for each crossing in view").toBeGreaterThan(0);
        // the newest crossing in view is the one that ends last
        const marker = arcs.reduce((a, b) => (b.x > a.x ? b : a));
        if (pane) {
          expect(frame.texts.some((t) => t.text === "0"), "the zero of MACD is named in the pane's label column").toBe(true);
          expect(marker.up, "the marker points up where MACD crossed above its signal").toBe(want.up);
          expect(marker.fill, "and its colour is the role of that sign").toBe(want.up ? colours.positive : colours.negative);
        }
        const box = await page.locator("#ol-canvas").boundingBox();
        // (two pixels inside the marker: a tooltip at the very edge of the data says the future is hidden)
        await page.mouse.move(box.x + marker.x - 2, box.y + marker.y);
        const tip = page.locator("#ol-tip");
        await expect(tip).toBeVisible();
        const candidate = edge % DAY !== 0 && want.i === all.last,
          known = String(baseOf(D0 + (want.i + 1) * DAY));
        await expect(tip).toHaveAttribute("data-event", candidate ? "cross|so far" : "cross|confirmed");
        await expect(tip.locator('dd[data-field="knownAt"]')).toHaveAttribute("data-canonical", candidate ? "null" : known);
        await expect(tip).toContainText(candidate ? /so far, not confirmed/ : /Status\s*Confirmed/);
        await expect(tip).toContainText("daily bars");
      });
    }
});

// ---- a squeeze -----------------------------------------------------------------------------------------------------

// 100 days of a wobbling price, 40 four-hour bars of a price that does not move at all, and seven more days of the wobble: the bandwidth falls below its
// 10th percentile of the last 500 bars for a run of bars that starts in the quiet stretch and ends after it, while the wobble fills the window again. Its
// lane in the event strip is the run's interval.
const SQ0 = ms("2026-02-01T00:00:00Z");
const QUIET = [SQ0 + 100 * DAY, SQ0 + 100 * DAY + 40 * 4 * HOUR];
function squeezePrice(t) {
  if (t >= QUIET[0] && t < QUIET[1]) return 25000;
  return 25000 + 300 * Math.sin((2 * Math.PI * t) / (30 * HOUR)) + 120 * Math.sin((2 * Math.PI * t) / (7.3 * HOUR));
}
const SQ_END = SQ0 + 114 * DAY;
const SQUEEZE_TRADES = tradesOf(SQ0, SQ_END, squeezePrice);
const FOUR_HOURS = 4 * HOUR;
// the 4-hour bars of the reference at an edge (the bar at the edge as it stands), the squeeze runs over them, and the last run's state for the record
function squeezeAt(edge) {
  const list = refBars.bars(tradesBefore(SQUEEZE_TRADES, edge), { n: 8, b0: 0, b1: Math.ceil(baseOf(edge)) });
  const runs = refInd.runs(refInd.squeezeBelow(refInd.bandwidth(list.map((b) => b.close))));
  const run = runs.length ? runs[runs.length - 1] : null;
  if (!run) return { list, run: null };
  const bar = (k) => [list[k].col * FOUR_HOURS, (list[k].col + 1) * FOUR_HOURS];
  const bars = [];
  for (let k = run[0]; k <= run[1]; k++) bars.push(bar(k));
  const after = run[1] + 1 < list.length ? bar(run[1] + 1) : null;
  const complete = bars[bars.length - 1][1] <= edge,
    closed = complete && after !== null && after[1] <= edge;
  const done = bars.filter((b) => b[1] <= edge);
  return { list, run, bars, after, candidate: !complete, final: closed, knownAt: done.length ? done[done.length - 1][1] : null, runStart: bars[0][0] };
}
const FULL_SQUEEZE = squeezeAt(SQ_END);
const RUN_START = FULL_SQUEEZE.runStart,
  RUN_LAST = FULL_SQUEEZE.bars[FULL_SQUEEZE.bars.length - 1][1];
const SQ_EDGE = {
  notBegun: RUN_START,
  firstBarForming: RUN_START + 2 * HOUR,
  firstBarDone: RUN_START + FOUR_HOURS,
  midRunForming: RUN_START + 5 * FOUR_HOURS + 2 * HOUR,
  lastBarForming: RUN_LAST - 2 * HOUR,
  lastBarDone: RUN_LAST,
  nextBarForming: RUN_LAST + 2 * HOUR,
  closed: RUN_LAST + FOUR_HOURS,
  later: RUN_LAST + 24 * HOUR,
};

test.describe("B33 a squeeze run is known bar by bar and final once a later complete bar does not qualify", () => {
  test("the scenario: the run sits in the quiet stretch and each edge is where the table says", () => {
    expect(FULL_SQUEEZE.run, "a run").not.toBeNull();
    expect(RUN_START).toBeGreaterThanOrEqual(QUIET[0]);
    expect(RUN_LAST, "the run outlasts the quiet stretch while the wobble fills the window again, and ends before the data does").toBeLessThan(SQ_END - 24 * HOUR);
    expect(squeezeAt(SQ_EDGE.notBegun).run === null || squeezeAt(SQ_EDGE.notBegun).runStart !== RUN_START, "before its first bar the run is not there").toBe(true);
    const first = squeezeAt(SQ_EDGE.firstBarForming);
    expect([first.runStart, first.candidate, first.knownAt]).toEqual([RUN_START, true, null]);
    const done = squeezeAt(SQ_EDGE.firstBarDone);
    expect([done.candidate, done.final, done.knownAt]).toEqual([false, false, RUN_START + FOUR_HOURS]);
    expect(squeezeAt(SQ_EDGE.midRunForming).candidate).toBe(true);
    expect(squeezeAt(SQ_EDGE.lastBarDone).final, "the last bar qualified; nothing after it yet").toBe(false);
    expect(squeezeAt(SQ_EDGE.nextBarForming).final, "the bar after it is still forming").toBe(false);
    const closed = squeezeAt(SQ_EDGE.closed);
    expect([closed.candidate, closed.final, closed.knownAt]).toEqual([false, true, RUN_LAST]);
    expect(squeezeAt(SQ_EDGE.later).final).toBe(true);
  });

  for (const [name, edge] of Object.entries(SQ_EDGE)) {
    test(`replay at ${name}: the lane's tooltip says what the reference says`, async ({ page, probe, fakeFor, pane: rec }) => {
      const fake = await fakeFor({ trades: SQUEEZE_TRADES.filter((x) => x.t_ms < SQ_END), cutoffIso: iso(SQ_END) });
      await page.setViewportSize({ width: 1500, height: 950 });
      await page.goto(`${fake.url}/#t=${iso(RUN_START - 12 * HOUR)}~${iso(edge + 12 * HOUR)}&p=24000~26000&r=6,4&vis=2&lines=bb4h&replay=1&at=${iso(edge)}`);
      await ready(page, fake, probe);
      const want = squeezeAt(edge);
      const isRun = want.run !== null && want.runStart === RUN_START;
      // the bars are read after the view's own reads: the lane appears when the page has them
      if (!isRun) {
        await probe.waitForQuiet({ quietMs: 800, timeout: 20000 });
        const frame = await rec.last();
        expect(frame.rects.filter((r) => r.h === 8 && r.alpha === 1 && r.w >= 2 && r.y > 600), "no squeeze interval before its first bar").toEqual([]);
        return;
      }
      await expect.poll(async () => (await rec.last()).rects.some((r) => r.h === 8 && r.alpha === 1 && r.w >= 2), { message: "the squeeze lane is drawn", timeout: 20000 }).toBe(true);
      await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
      const frame = await rec.last();
      const marks = frame.rects.filter((r) => r.h === 8 && r.alpha === 1 && r.w >= 2);
      expect(marks.length, "one interval in the lane").toBe(1);
      const box = await page.locator("#ol-canvas").boundingBox(),
        r = marks[0];
      await page.mouse.move(box.x + r.x + Math.min(r.w / 2, r.w - 1), box.y + r.y + r.h / 2);
      const tip = page.locator("#ol-tip");
      await expect(tip).toBeVisible();
      await expect(tip).toHaveAttribute("data-event", want.final ? "squeeze|final" : "squeeze|so far");
      await expect(tip.locator('dd[data-field="knownAt"]')).toHaveAttribute("data-canonical", want.knownAt === null ? "null" : String(baseOf(want.knownAt)));
      await expect(tip).toContainText("4-hour bars");
      await expect(tip).toContainText(want.final ? /Status\s*Final/ : /So far, not confirmed/);
      if (want.candidate) await expect(tip).toContainText(/its last bar still forming until/);
    });
  }
});
