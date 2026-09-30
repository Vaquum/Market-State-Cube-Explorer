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
// Oracles (none is the code under test): the reference bars of tests/reference/bars.js (exact arithmetic) and the reference zigzag written from the rule
// (tests/reference/swings.js), both fed only the trades before the edge; the fixture's own design (which edge is before, inside and after the bar) asserted
// first, so the scenario has teeth.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const refBars = require("../reference/bars.js");
const refSwings = require("../reference/swings.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

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
      await page.goto(`${fake.url}/#t=${iso(TE - 36 * HOUR)}~${iso(TE + 30 * HOUR)}&p=24800~26000&vis=2&lines=swing4h&replay=1&at=${iso(edge)}`);
      await S.atRest(page, fake, probe);
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
      const leads = [];
      for (const k of frame.strokes)
        if (JSON.stringify(k.dash) === "[1,3]" && k.alpha === 0.9) for (let i = 0; i + 1 < k.path.length; i += 2) leads.push([k.path[i], k.path[i + 1]]);
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
      await page.goto(`${fake.url}/#t=${iso(ms("2026-09-06T18:00:00Z"))}~${iso(ms("2026-09-07T06:00:00Z"))}&p=24800~25500&vis=2&lines=cme&replay=1&at=${iso(edge)}`);
      await S.atRest(page, fake, probe);
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
      await page.goto(`${fake.url}/#t=${iso(T2 - 6 * HOUR)}~${iso(T2 + 72 * HOUR)}&p=24900~26000&vis=2&lines=swing4h&pane=rsi4h&replay=1&at=${iso(edge)}`);
      await S.atRest(page, fake, probe);
      const want = divergenceAt(edge);
      const frame = await pane.last();
      const divs = frame.strokes.filter((k) => k.width === 2 && k.alpha === 0.95 && k.path.length === 2);
      const joins = frame.strokes.filter((k) => Math.abs(k.width - 1.2) < 1e-3 && k.alpha === 1 && k.path.length === 2 && k.path[0][0] !== k.path[1][0]);
      expect(divs.length, "the divergences drawn are the reference's").toBe(want.divergences.length);
      expect(joins.length, "the equal pairs joined are the reference's").toBe(want.equal.length);
      if (want.divergences.length === 0) return;
      const candidate = want.candidate(want.divergences[0]);
      expect(JSON.stringify(divs[0].dash), "a divergence on a candidate swing is dashed").toBe(candidate ? "[3,3]" : "[]");
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
