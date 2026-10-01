"use strict";
// B25 profile-tracks.spec.js (PRD-0002 S2, #47 section 3): the adjacent current and reference profile tracks.
//
// What is asserted, on the canvas itself (the recorder of pane-canvas.js: every fillRect with its fill and alpha, every fillText) and on the
// chip and popover the page writes:
//   1. geometry: two tracks of 48 px of bars, a 14 px gutter each and a 4 px gap, headed "Volume" and "Volume · 7d", each with its own
//      numeric domain printed under it; Rows off leaves one track;
//   2. Independent axes (the default): the longest bar of each track is exactly 48 px, every other bar is its row's volume over that
//      track's own maximum, at the row the price axis puts it; the buy subset is a neutral inset (the ink) of the same bar's axis;
//   3. Shared absolute: ONE maximum over the displayed rows of both, the same pixels per unit; Shared row share: each row's share of its
//      track's total over the window W, both totals in the popover; Delta (a signed measure) disables both and says why;
//   4. the choice and the disclosure travel in the address (pc, po) and come back from it;
//   5. under 600 px the tracks are a disclosure: none is drawn, the chip is the visible summary of the domains, and the popover's button
//      shows them.
// Oracles (none is the code under test): tests/reference (exact rational rows over the same synthetic trades), the price labels the canvas
// itself draws (a linear fit of y against price, which places every bar), 48 px written out from the spec, and the period's and view's rows
// worked out here from the definitions of W and of a share.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const reference = require("../reference/index.js");
const { resolveProfile } = require("../support/profiles.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const BARS = 48,
  TRACK = BARS + 14,
  GAP = 4;

function tradesOf(store, fromMs, toMs) {
  const out = [];
  for (let i = 0; i < store.length; i++) {
    const t = store.t[i];
    if (t >= fromMs && t < toMs) out.push({ t_ms: t, price: store.price[i], qty: store.qty[i], takerBuy: Boolean(store.buy[i]), count: store.count[i] });
  }
  return out;
}
const rowsOf = (store, from, to) => reference.periodRows(tradesOf(store, from * S.BASE_MS, to * S.BASE_MS), { b0: from, b1: to, m: 0 });

// The rows and the address of the scenario: the last day in view over twelve rows around the period's peak, the period the last seven days.
function scenario() {
  const { store } = resolveProfile("standard");
  const day = [S.END_COL - S.DAY_COLS, S.END_COL],
    period = rowsOf(store, S.END_COL - 7 * S.DAY_COLS, S.END_COL),
    peak = period.reduce((best, x) => (x.v > best.v ? x : best)),
    view = [peak.r - 6, peak.r + 6],
    inView = (x) => x.r >= view[0] && x.r < view[1],
    current = rowsOf(store, day[0], day[1]).filter(inView),
    ref = period.filter(inView);
  return { day, view, current, ref, period, peak };
}
const addressOf = (sc, { kind = "volume", extra = "" } = {}) => S.address({ cols: sc.day, rows: sc.view, rowsKind: kind, period: "7d", extra: `&vis=2${extra}` });

// The price labels the canvas draws, as a linear map y(price).
function priceAxis(frame) {
  const labels = frame.texts.filter((t) => /^\d{2},\d{3}$/.test(t.text) && t.align === "right" && t.x < 60).map((t) => [Number(t.text.replace(",", "")), t.y]);
  expect(labels.length, "the price axis has labels to fit").toBeGreaterThanOrEqual(3);
  const [p0, y0] = labels[0],
    [p1, y1] = labels[labels.length - 1],
    k = (y1 - y0) / (p1 - p0);
  return (price) => y0 + (price - p0) * k;
}

// The bars of a track in a frame: the fills the page paints for it, found by colour and alpha, with the track's x.
function tracksOf(frame, colours, muted, minX = 900) {
  // Both tracks' bars are the appearance's bar colour at 70% (3:1 against the surface), the current track's POC row the gold at 90%; the tracks are told
  // apart by where they stand, the current one being the nearer to the heatmap.
  const bars = frame.rects.filter((r) => r.fill === colours.bar && Math.abs(r.alpha - 0.7) < 1e-9 && r.w > 0 && r.h > 0 && r.x > minX),
    curX = bars.length ? Math.min(...bars.map((r) => r.x)) : 0,
    cur = [...bars.filter((r) => Math.abs(r.x - curX) < 0.5), ...frame.rects.filter((r) => r.fill === colours.poc && Math.abs(r.alpha - 0.9) < 1e-9 && r.h > 0 && r.w > 0 && r.x > minX)],
    ref = bars.filter((r) => r.x > curX + 1),
    inset = frame.rects.filter((r) => r.fill === colours.ink && Math.abs(r.alpha - 0.85) < 1e-9 && r.x > minX);
  return { cur, ref, inset };
}
async function mutedColour(page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    probe.style.color = "var(--ol-muted)";
    const scratch = document.createElement("canvas").getContext("2d");
    scratch.fillStyle = getComputedStyle(probe).color;
    probe.remove();
    return scratch.fillStyle;
  });
}

// The bar of a row: the one whose top is where the price axis puts the row's upper edge.
function barOf(bars, y, r) {
  const top = y((r + 1) * 125),
    hit = bars.filter((b) => Math.abs(b.y - top) < 1.01);
  return hit.length === 1 ? hit[0] : null;
}

async function open(page, fake, probe, pane, hash) {
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
  const frame = await pane.last(),
    colours = await pane.colours(),
    muted = await mutedColour(page);
  return { frame, colours, tracks: tracksOf(frame, colours, muted), y: priceAxis(frame) };
}

async function popover(page) {
  await page.locator("#ol-profile-chip").click();
  await expect(page.locator("#ol-profile-pop")).toBeVisible();
  return page.locator("#ol-profile-pop");
}
const fieldValue = (pop, name) => pop.locator(`[data-field="${name}"]`).getAttribute("data-value");

test.describe("B25 the adjacent profile tracks", () => {
  test("independent axes: two tracks 66 px apart, each bar its row's volume over its own maximum, the domains printed under them", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const { frame, tracks, y } = await open(page, fake, probe, pane, addressOf(sc));
    const curX = Math.min(...tracks.cur.map((b) => b.x)),
      refX = Math.min(...tracks.ref.map((b) => b.x));
    expect(refX - curX, "48 px of bars, a 14 px gutter and a 4 px gap").toBe(TRACK + GAP);
    // the tracks stand right of the Rows strip and the strip is 12 px
    const strip = frame.rects.filter((r) => r.w === 12 && r.x > 900 && r.x < curX);
    expect(strip.length, "the Rows strip stands left of the tracks").toBeGreaterThan(0);
    const curMax = Math.max(...sc.current.map((x) => x.v)),
      refMax = Math.max(...sc.ref.map((x) => x.v));
    for (const x of sc.current.filter((x) => x.v > 0)) {
      const bar = barOf(tracks.cur, y, x.r);
      expect(bar, `a current bar for row ${x.r}`).not.toBeNull();
      expect(bar.w).toBeCloseTo((BARS * x.v) / curMax, 1);
    }
    for (const x of sc.ref.filter((x) => x.v > 0)) {
      const bar = barOf(tracks.ref, y, x.r);
      expect(bar, `a reference bar for row ${x.r}`).not.toBeNull();
      expect(bar.w).toBeCloseTo((BARS * x.v) / refMax, 1);
    }
    expect(Math.max(...tracks.cur.map((b) => b.w)), "the longest current bar is the whole 48 px").toBeCloseTo(BARS, 5);
    expect(Math.max(...tracks.ref.map((b) => b.w)), "the longest reference bar is the whole 48 px").toBeCloseTo(BARS, 5);
    // the buy subset is an inset on the same axis: its length is the row's taker-buy volume over the same maximum
    for (const x of sc.current.filter((x) => x.bv > 0)) {
      const top = y((x.r + 1) * 125),
        bottom = y(x.r * 125),
        inset = tracks.inset.filter((b) => b.y > top - 0.5 && b.y + b.h < bottom + 0.5 && b.x === curX);
      expect(inset.length, `the buy inset of row ${x.r}`).toBe(1);
      expect(inset[0].w).toBeCloseTo((BARS * x.bv) / curMax, 1);
    }
    // headings above, domains below, each track its own
    const text = (t) => frame.texts.find((f) => f.text === t);
    expect(text("Volume").x).toBe(curX);
    expect(text("Volume · 7d").x).toBe(refX);
    expect(text("Volume").y).toBeLessThan(y(sc.view[1] * 125) + 1);
    const domains = frame.texts.filter((f) => /^0[–-]/.test(f.text) && f.y > y(sc.view[0] * 125));
    expect(domains.map((d) => d.x).sort((a, b) => a - b), "a domain under each track").toEqual([curX, refX]);
    const chip = await page.locator("#ol-profile-chip").evaluate((e) => ({ ...e.dataset, text: e.textContent }));
    expect(chip.comparison).toBe("independent");
    expect(chip.tracks).toBe("2");
    expect(chip.text).toContain("Independent axes · Auto");
    expect(domains.map((d) => d.text).sort()).toEqual([chip.currentDomain, chip.referenceDomain].sort());
  });

  test("the current track is the view's Volume whatever the Cells measure is; the 70% area marks both tracks; POC and Buy POC are two shapes", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const base = await open(page, fake, probe, pane, addressOf(sc));
    const widths = (t, y) => sc.current.filter((x) => x.v > 0).map((x) => barOf(t.cur, y, x.r)?.w);
    const before = widths(base.tracks, base.y);
    expect(before.every((w) => typeof w === "number")).toBe(true);
    // the Cells measure changes to Delta: the profile's bars do not
    const other = await open(page, fake, probe, pane, addressOf(sc, { extra: "&mode=delta&marks=poc,area" }));
    expect(widths(other.tracks, other.y), "the same lengths under Delta").toEqual(before);
    expect(other.frame.texts.some((t) => t.text === "Volume"), "headed Volume").toBe(true);
    // the 70% area: H and L letters beside the current track, a 2 px bar down the edge of the reference track
    expect(other.frame.texts.filter((t) => t.text === "H" || t.text === "L").length, "H and L for the current track").toBe(2);
    const refX = Math.min(...other.tracks.ref.map((b) => b.x));
    expect(other.frame.rects.some((r) => r.x === refX && r.w === 2 && r.fill === other.colours.ink && Math.abs(r.alpha - 0.4) < 1e-9), "the period's 70% area as a bar down the reference track's edge").toBe(true);
    // the two POC shapes: a filled gold triangle (3 points) and a hollow gold diamond (4 points, 1.25 px stroke), each beside a letter
    const gold = other.colours.poc;
    expect(other.frame.fills.filter((f) => f.fill === gold && f.path.length === 3).length, "a filled triangle for each POC").toBeGreaterThanOrEqual(2);
    expect(other.frame.strokes.filter((k) => k.stroke === gold && k.width === 1.25 && k.path.length === 4).length, "one hollow diamond for the Buy POC").toBeGreaterThanOrEqual(1);
    expect(other.frame.texts.filter((t) => t.text === "B").length).toBe(1);
  });

  test("Rows off leaves the one current track", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const { frame, tracks } = await open(page, fake, probe, pane, S.address({ cols: sc.day, rows: sc.view, rowsKind: "volume", period: "7d" }).replace("&rows=volume&period=7d", "") + "&vis=2");
    expect(tracks.ref.length, "no reference track without Rows").toBe(0);
    expect(tracks.cur.length).toBeGreaterThan(0);
    expect(frame.texts.some((t) => t.text === "Volume")).toBe(true);
    expect(frame.texts.some((t) => /· 7d$/.test(t.text))).toBe(false);
    expect(await page.locator("#ol-profile-chip").getAttribute("data-tracks")).toBe("1");
  });

  test("shared absolute: one maximum over both displayed sets and the same pixels per unit", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const { frame, tracks, y } = await open(page, fake, probe, pane, addressOf(sc, { extra: "&pc=a" }));
    const max = Math.max(...sc.current.map((x) => x.v), ...sc.ref.map((x) => x.v));
    for (const [rows, bars, which] of [[sc.current, tracks.cur, "current"], [sc.ref, tracks.ref, "reference"]])
      for (const x of rows.filter((x) => x.v > 0)) {
        const bar = barOf(bars, y, x.r);
        expect(bar, `${which} row ${x.r}`).not.toBeNull();
        expect(bar.w, `${which} row ${x.r}: 48 px times its volume over the shared maximum`).toBeCloseTo((BARS * x.v) / max, 1);
      }
    const longest = Math.max(...tracks.cur.map((b) => b.w), ...tracks.ref.map((b) => b.w));
    expect(longest, "the longest bar of either track is the whole 48 px").toBeCloseTo(BARS, 5);
    const chip = await page.locator("#ol-profile-chip").evaluate((e) => ({ ...e.dataset }));
    expect(chip.comparison).toBe("absolute");
    expect(chip.currentDomain).toBe(chip.referenceDomain);
    expect(frame.texts.filter((t) => / · shared$/.test(t.text)).length, "one shared domain label under both tracks").toBe(1);
  });

  test("shared row share: each row's share of its track's total over the window W; both totals in the popover", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const { tracks, y } = await open(page, fake, probe, pane, addressOf(sc, { extra: "&pc=s" }));
    // W: the rows wholly inside the view and inside the period's support (its first to its last traded row)
    const first = Math.max(sc.view[0], sc.period[0].r),
      last = Math.min(sc.view[1] - 1, sc.period[sc.period.length - 1].r),
      inW = (x) => x.r >= first && x.r <= last,
      curW = sc.current.filter(inW),
      refW = sc.ref.filter(inW),
      dc = curW.reduce((a, x) => a + x.v, 0),
      dr = refW.reduce((a, x) => a + x.v, 0),
      max = Math.max(...curW.map((x) => x.v / dc), ...refW.map((x) => x.v / dr));
    for (const [rows, bars, den, which] of [[curW, tracks.cur, dc, "current"], [refW, tracks.ref, dr, "reference"]])
      for (const x of rows.filter((x) => x.v > 0)) {
        const bar = barOf(bars, y, x.r);
        expect(bar, `${which} row ${x.r}`).not.toBeNull();
        expect(bar.w, `${which} row ${x.r}: its share over the larger of the two largest shares`).toBeCloseTo((BARS * (x.v / den)) / max, 1);
      }
    const pop = await popover(page);
    expect(Number(await fieldValue(pop, "denominatorCurrent"))).toBeCloseTo(dc, 3);
    expect(Number(await fieldValue(pop, "denominatorReference"))).toBeCloseTo(dr, 3);
    expect(JSON.parse(await fieldValue(pop, "window"))).toEqual({ first, last, bins: last - first + 1 });
  });

  test("row share over a window where the view did not trade is undefined, not zero", async ({ page, probe, fakeFor, pane }) => {
    // The disjoint stream: the last day trades rows 200 to 205; two hours three days earlier only rows 200 and 210 traded. The view is those
    // two hours over rows 201 to 209: the window W is rows 201 to 205 (inside the view and the 1 day period's support), and the view has no
    // trade in it.
    const stream = S.disjoint();
    const fake = await fakeFor({ name: stream.name, trades: stream.trades, cutoffIso: stream.cutoffIso });
    const { frame } = await open(page, fake, probe, pane, S.address({ cols: stream.early, rows: [201, 210], rowsKind: "volume", period: "1d", extra: "&vis=2&pc=s" }));
    const chip = await page.locator("#ol-profile-chip").evaluate((e) => ({ ...e.dataset }));
    expect(chip.state).toBe("undefined");
    expect(chip.reason).toBe("zero-total");
    expect(frame.texts.filter((t) => t.text === "Undefined").length, "each track says so").toBe(2);
    const pop = await popover(page);
    expect(Number(await fieldValue(pop, "denominatorCurrent")), "the zero total is reported as it is").toBe(0);
    expect(Number(await fieldValue(pop, "denominatorReference")), "the period's own total over W").toBeGreaterThan(0);
    expect(JSON.parse(await fieldValue(pop, "window"))).toEqual({ first: 201, last: 205, bins: 5 });
  });

  test("Delta cannot share an axis with Volume or be a row-share distribution: both choices are disabled, each with its reason", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await open(page, fake, probe, pane, addressOf(sc, { kind: "delta", extra: "&pc=a" }));
    const chip = await page.locator("#ol-profile-chip").evaluate((e) => ({ ...e.dataset }));
    expect(chip.asked, "what was asked is kept").toBe("absolute");
    expect(chip.comparison, "what is drawn is independent").toBe("independent");
    expect(chip.reason).toBe("unlike-measure");
    expect(chip.referenceDomain).toMatch(/^±/);
    const pop = await popover(page);
    const absolute = pop.locator('button[data-value="absolute"]'),
      share = pop.locator('button[data-value="share"]');
    await expect(absolute).toHaveAttribute("aria-disabled", "true");
    await expect(share).toHaveAttribute("aria-disabled", "true");
    await expect(absolute).toHaveAttribute("data-reason", "unlike-measure");
    await expect(share).toHaveAttribute("data-reason", "signed");
    const described = await absolute.getAttribute("aria-describedby");
    expect(await page.locator(`#${described}`).textContent()).toMatch(/same measure/);
    expect(await page.locator(`#${await share.getAttribute("aria-describedby")}`).textContent()).toMatch(/signed Delta is not a row-share/);
    // a disabled choice does nothing
    await absolute.click({ force: true });
    await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-comparison", "independent");
    expect(await page.evaluate(() => location.hash)).toContain("pc=a");
  });

  test("the comparison is chosen in the popover, written to the address (pc) and restored from it", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await open(page, fake, probe, pane, addressOf(sc));
    const pop = await popover(page);
    await pop.locator('button[data-value="absolute"]').click();
    await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-comparison", "absolute");
    await expect.poll(() => page.evaluate(() => location.hash), { message: "the address says pc=a" }).toContain("pc=a");
    await page.locator("#ol-profile-pop button[data-value='share']").click();
    await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-comparison", "share");
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("pc=s");
    const hash = await page.evaluate(() => location.hash);
    await page.goto("about:blank");
    await page.goto(`${fake.url}/${hash}`);
    await S.atRest(page, fake, probe);
    await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-comparison", "share");
    await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-asked", "share");
    // independent is the default and is not written
    await page.locator("#ol-profile-chip").click();
    await page.locator("#ol-profile-pop button[data-value='independent']").click();
    await expect.poll(() => page.evaluate(() => location.hash)).not.toContain("pc=");
  });

  test("the Comparison lock freezes both track domains: the peak leaves the view and the domains stay, in the address too", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await open(page, fake, probe, pane, addressOf(sc));
    const before = await page.locator("#ol-profile-chip").evaluate((e) => ({ cur: e.dataset.currentDomain, ref: e.dataset.referenceDomain }));
    // engage the lock from the axis popover
    await page.locator("#ol-axis-chip").click();
    await page.locator('#ol-axis-pop button[data-action="lock"]').click();
    await expect.poll(() => page.evaluate(() => location.hash), { message: "the lock is in the address" }).toContain("lk=1");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("ArrowUp");
      await probe.waitForQuiet({ quietMs: 200 });
    }
    await S.atRest(page, fake, probe);
    const after = await page.locator("#ol-profile-chip").evaluate((e) => ({ cur: e.dataset.currentDomain, ref: e.dataset.referenceDomain }));
    expect(after, "the lock keeps what was declared").toEqual(before);
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/a\.profile\.current:/);
    expect(await page.evaluate(() => location.hash)).toMatch(/a\.profile\.reference\.volume:/);
    // the frozen domains come back from the address in a fresh page
    const hash = await page.evaluate(() => location.hash);
    await page.goto("about:blank");
    await page.goto(`${fake.url}/${hash}`);
    await S.atRest(page, fake, probe);
    const restored = await page.locator("#ol-profile-chip").evaluate((e) => ({ cur: e.dataset.currentDomain, ref: e.dataset.referenceDomain }));
    expect(restored, "the domains the address carried").toEqual(before);
  });

  test("control for the lock: without it the same pan moves the Auto domains", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await open(page, fake, probe, pane, addressOf(sc));
    const before = await page.locator("#ol-profile-chip").evaluate((e) => ({ cur: e.dataset.currentDomain, ref: e.dataset.referenceDomain }));
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("ArrowUp");
      await probe.waitForQuiet({ quietMs: 200 });
    }
    await S.atRest(page, fake, probe);
    await expect
      .poll(async () => (await page.locator("#ol-profile-chip").evaluate((e) => e.dataset.referenceDomain)) !== before.ref, { message: "the reference domain follows the rows in view", timeout: 8000 })
      .toBe(true);
  });

  test("during a drag the Auto domains stay where they were; once the drag settles they follow the rows", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await open(page, fake, probe, pane, addressOf(sc));
    const domains = () => page.locator("#ol-profile-chip").evaluate((e) => ({ cur: e.dataset.currentDomain, ref: e.dataset.referenceDomain }));
    const before = await domains();
    const box = await page.locator("#ol-canvas").boundingBox();
    const layout = await page.locator("#ol-canvas").evaluate((c) => c.dataset.layout.split(",").map(Number));
    const x = box.x + layout[0] + layout[2] / 2,
      y = box.y + layout[1] + layout[3] / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // pan the view down by about ten rows and hold there: the pointer is still down
    for (let step = 1; step <= 10; step++) await page.mouse.move(x, y + step * 50);
    await probe.waitForQuiet({ quietMs: 300 });
    expect(await domains(), "held through the gesture").toEqual(before);
    await page.mouse.up();
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await domains()).ref !== before.ref, { message: "settled: the reference domain follows the rows now in view", timeout: 8000 }).toBe(true);
  });

  test("a view with no trades has no domain: No data, no bars, never a maximum of 1", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const empty = { ...sc, view: [sc.peak.r + 200, sc.peak.r + 212] };
    const { frame, tracks } = await open(page, fake, probe, pane, addressOf(empty));
    const chip = await page.locator("#ol-profile-chip").evaluate((e) => ({ ...e.dataset }));
    expect(chip.currentDomain).toBe("No data");
    expect(tracks.cur.length, "no current bar").toBe(0);
    expect(frame.texts.filter((t) => t.text === "No data").length, "said on the canvas, once for each track that has none").toBeGreaterThanOrEqual(1);
  });

  test("a legacy address is independent with both domains labelled, whatever pc it carries", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const legacy = S.address({ cols: sc.day, rows: sc.view, rowsKind: "volume", period: "7d", extra: "&pc=a&po=1" });
    const { frame } = await open(page, fake, probe, pane, legacy);
    const chip = await page.locator("#ol-profile-chip").evaluate((e) => ({ ...e.dataset }));
    expect(chip.asked).toBe("independent");
    expect(chip.comparison).toBe("independent");
    expect(frame.texts.filter((t) => /^0[–-]/.test(t.text)).length, "both domains are printed").toBe(2);
  });

  test("the period's POC stays Volume-derived under Delta, with its glyph and letter, and the popover says so", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const { frame } = await open(page, fake, probe, pane, addressOf(sc, { kind: "delta" }));
    const letters = frame.texts.filter((t) => t.text === "P");
    expect(letters.length, "a P for the current track and one for the reference track").toBe(2);
    const pop = await popover(page);
    expect(await fieldValue(pop, "pocSource")).toBe("volume");
    expect(await pop.locator('[data-field="pocSource"]').textContent()).toMatch(/Volume-derived/);
  });

  test("under 600 px the tracks are a disclosure: none is drawn, the chip summarises the domains, its button shows them, and po travels", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 520, height: 800 });
    const { tracks } = await open(page, fake, probe, pane, addressOf(sc));
    expect(tracks.cur.length + tracks.ref.length, "no track is drawn while collapsed").toBe(0);
    const chip = page.locator("#ol-profile-chip");
    await expect(chip).toHaveAttribute("data-collapsed", "true");
    const text = await chip.textContent();
    expect(text, "the visible summary names both measures and both domains").toMatch(/Volume 0[–-][\d.]+ ?[kMB]? · Volume 0[–-][\d.]+ ?[kMB]?/);
    // the rows stay inspectable while collapsed: hovering the Rows strip reads the period's row
    const layout = await page.locator("#ol-canvas").evaluate((c) => c.dataset.layout.split(",").map(Number));
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.move(box.x + layout[4] + layout[5] / 2, box.y + layout[1] + layout[3] / 2);
    await expect(page.locator("#ol-tip")).toContainText("Volume · 7 days");
    await page.mouse.move(box.x + 5, box.y + 5);
    const pop = await popover(page);
    const show = pop.locator('button[data-action="profile-open"]');
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await show.click();
    await expect(chip).toHaveAttribute("data-collapsed", "false");
    await S.atRest(page, fake, probe);
    const frame = await pane.last(),
      colours = await pane.colours();
    const shown = tracksOf(frame, colours, await mutedColour(page), 300);
    expect(shown.cur.length, "the current track is drawn once shown").toBeGreaterThan(0);
    expect(shown.ref.length, "and the reference track").toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => location.hash), { message: "po=1 in the address" }).toContain("po=1");
  });

  // PR #52 review: the focus goes back to the control that had it, and each total is in its own unit
  test("showing the tracks from the popover keeps the keyboard in the popover: the button that was pressed has the focus again", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 520, height: 800 });
    await open(page, fake, probe, pane, addressOf(sc));
    const pop = await popover(page);
    const show = pop.locator('button[data-action="profile-open"]');
    await show.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-profile-chip")).toHaveAttribute("data-collapsed", "false");
    await expect.poll(() => page.evaluate(() => document.activeElement?.dataset?.action ?? document.activeElement?.tagName), { message: "the focus is on the rebuilt button, not on the page's body" }).toBe("profile-open");
    expect(await page.evaluate(() => document.getElementById("ol-profile-pop").contains(document.activeElement)), "inside the popover").toBe(true);
    // a comparison button, which has a value, gets the focus back too
    const absolute = pop.locator('button[data-action="profile-cmp"][data-value="absolute"]');
    await absolute.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => `${document.activeElement?.dataset?.action}:${document.activeElement?.dataset?.value}`)).toBe("profile-cmp:absolute");
  });

  test("with Time at price as the reference, Shared row share names each total in its own unit: the current track's in USDT, the reference's in seconds", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    await open(page, fake, probe, pane, addressOf(sc, { kind: "time", extra: "&pc=s" }));
    const pop = await popover(page);
    const current = (await pop.locator('[data-field="denominatorCurrent"]').textContent()).trim(),
      reference = (await pop.locator('[data-field="denominatorReference"]').textContent()).trim();
    expect(current, "the current track's total is USDT").toMatch(/USDT$/);
    expect(reference, "the reference's is seconds, not USDT").not.toMatch(/USDT$/);
    expect(Number(await fieldValue(pop, "denominatorCurrent"))).toBeGreaterThan(0);
    expect(Number(await fieldValue(pop, "denominatorReference"))).toBeGreaterThan(0);
  });

  test("a saved level outside the visible prices does not paint over a track's heading or its domain: the level line and the pointer's row are clipped to the plot", async ({ page, probe, fakeFor, pane }) => {
    const sc = scenario();
    const fake = await fakeFor("standard");
    const { frame } = await open(page, fake, probe, pane, addressOf(sc, { extra: "&level=90000" }));
    const layout = (await page.locator("#ol-canvas").evaluate((c) => c.dataset.layout)).split(",").map(Number);
    const levelStrokes = frame.strokes.filter((k) => k.dash.length === 2 && k.dash[0] === 6 && k.dash[1] === 4 && Math.abs(k.width - 1.3) < 1e-6);
    expect(levelStrokes.length, "the level line is drawn through the tracks").toBeGreaterThan(0);
    for (const k of levelStrokes) {
      expect(k.clip, "under a clip").not.toBeNull();
      expect(k.clip[1], "whose top is the plot's").toBeGreaterThanOrEqual(layout[1] - 0.5);
      expect(k.clip[3], "and whose bottom is the plot's").toBeLessThanOrEqual(layout[1] + layout[3] + 0.5);
    }
  });
});
