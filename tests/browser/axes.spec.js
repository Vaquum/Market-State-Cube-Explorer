"use strict";
// axes.spec.js (X): B18, the registered axes of the Columns pane and the oscillators (TESTPLAN 3.4; INTEGRATION D.6, D.18; API C.12).
//
// Requirements covered (WORKPLAN 4.6 X, TESTPLAN B18): S1-017 and S1-018 (an axis is No data, 0 or the exact maximum, never `|| 1`, no
// nice rounding), S1-112 to S1-114 and S1-125 (MACD, Signal and the histogram share ONE symmetric axis; RSI is fixed 0 to 100 with its
// 30 and 70 guides; the ratio axis is fixed at -2..+2 with its 1/4x to 4x ticks), D4's settle (a domain holds during a gesture and then
// follows, without any further input).
//
// Two kinds of assertion, on purpose. What the pane DRAWS is read off the canvas (pane-canvas.js): the tallest bar of an Auto axis
// reaches the top of the axis, every other bar is its value over that maximum, so the axis maximum is the data's maximum and no rounded
// number, whatever the chip says. What the pane SAYS is read off the axis chip (D.18: #ol-axis-chip, data-domain, data-axis-state),
// which is package U's DOM over package S's registry; a test that needs the chip fails with the missing element's name when it is not
// there (observe.js), so the two halves are separate tests.
//
// Oracles (none is the code under test): the exact-rational reference calculator (tests/reference) for the column sums of `mini`, the
// hand-computed Wilder and EMA series of tests/fixtures/indicators (python-stdlib, fractions), and the rules written out below for the
// ratio ticks (12 px between two kept labels, ends first, then the centre, then the halves) and the RSI guides (top + 4 + (1 - v / 100)
// * (height - 8)).
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const ref = require("../reference/index.js");
const { resolveProfile, EPOCH_MS } = require("../support/profiles.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const BASE_MS = 56250;
const baseOf = (iso) => (Date.parse(iso) - EPOCH_MS) / BASE_MS;
const tradeList = (store) =>
  Array.from(store.t, (t, i) => ({ t_ms: t, price: store.price[i], qty: store.qty[i], takerBuy: Boolean(store.buy[i]), count: store.count[i] }));

// A cell-aligned view of `mini`: 15-minute columns (n = 4) over the last 12 hours of its second day, 125 USDT rows over a band that holds
// every trade. `#t=..~..&p=..~..&r=n,m` is the address grammar of the page (viewParams), so the expected cohort is the reference's.
const MINI = { n: 4, m: 0, from: "2026-09-24T00:00Z", to: "2026-09-24T12:00Z", lo: 24000, hi: 26000 };
const addressOf = (view, pane) => `#t=${view.from}~${view.to}&p=${view.lo}~${view.hi}&r=${view.n},${view.m}&pane=${pane}`;
const rectOf = (view) => ({ n: view.n, m: view.m, b0: baseOf(view.from), b1: baseOf(view.to), r0: view.lo / 125, r1: view.hi / 125 });

// The reference's columns of a rectangle: per column the sums of its cells, ascending.
function columnsOf(trades, rect) {
  const by = new Map();
  for (const z of ref.cells(trades, rect)) {
    const c = by.get(z.c) ?? { c: z.c, v: 0, bv: 0, ct: 0, bt: 0 };
    c.v += z.v;
    c.bv += z.bv;
    c.ct += z.ct;
    c.bt += z.bt;
    by.set(z.c, c);
  }
  return [...by.values()].sort((a, b) => a.c - b.c);
}

// Loaded, every read answered and no draw for a moment: the page is at rest (s0-parity.spec.js).
async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 400, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

// A test that reads the axis chip (package U's DOM over package S's registry, D.18) cannot pass on a page that has none. It is fixme with
// the reason until the chip is in the page, and fails naming the missing element under CONVERGENCE=1, where the page is the merged one
// and a missing chip is a defect (K's run), so nothing is skipped silently.
async function needChip(surface) {
  const absent = await surface.missing(["axis"]);
  test.fixme(absent.length > 0 && process.env.CONVERGENCE !== "1", `needs package U: ${absent.join(", ")} is not in this page`);
}

// The axis chip (D.18): the attributes the draw wrote, with the domain as numbers.
async function axisChip(surface) {
  await needChip(surface);
  const chip = await surface.chip("axis");
  const domain = chip.data.domain ? chip.data.domain.split(",").map(Number) : null;
  return { id: chip.data.axisId, state: chip.data.axisState, policy: chip.data.policy, domain, text: chip.text, data: chip.data };
}

test.describe("B18: the Auto axis of an ordinary column pane", () => {
  test("Volume: the tallest bar is the exact maximum and every bar is its value over it (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/${addressOf(MINI, "volume")}`);
    await atRest(page, fake, probe);

    const columns = columnsOf(tradeList(resolveProfile("mini").store), rectOf(MINI));
    expect(columns.length, "the reference has a full set of dense columns").toBe(48);
    const vmax = Math.max(...columns.map((c) => c.v));

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const bars = paneCanvas.barsOf(frame, area, { fill: colours.bar, alpha: 0.65 });
    expect(bars.length, "one bar per column that traded").toBe(columns.length);
    for (const bar of bars) expect(bar.y + bar.h, "bars stand on the baseline").toBeCloseTo(area.bottom, 9);
    // The axis is as long as the data: the tallest bar fills the pane but for its 4 px inset, so the axis maximum is not a rounded number.
    const tallest = Math.max(...bars.map((b) => b.h));
    expect(tallest).toBeCloseTo(area.h - 4, 9);
    // And every other bar is its value over the maximum (time order, left to right).
    columns.forEach((column, i) => expect(bars[i].h / tallest, `column ${column.c}`).toBeCloseTo(column.v / vmax, 9));
    expect(columns.find((c) => c.v === vmax), "the tallest bar is the largest column").toBeTruthy();
    expect(bars.findIndex((b) => b.h === tallest)).toBe(columns.findIndex((c) => c.v === vmax));
  });

  test("Volume: the chip domain is 0 to the reference maximum, to the last digit", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/${addressOf(MINI, "volume")}`);
    await atRest(page, fake, probe);
    const columns = columnsOf(tradeList(resolveProfile("mini").store), rectOf(MINI));
    const vmax = Math.max(...columns.map((c) => c.v));

    const chip = await axisChip(surface);
    expect(chip.id).toBe("pane.volume");
    expect(chip.domain[0]).toBe(0);
    // Not a nice number (the maximum of a dense synthetic day is not round) and not more than the summation order moves it.
    expect(chip.domain[1]).toBeCloseTo(vmax, 6);
    expect(Math.abs(chip.domain[1] - vmax) / vmax).toBeLessThan(1e-12);
    expect(chip.state).toBe("auto");
  });

  test("Delta: one axis symmetric about zero, as long as the largest |Delta| (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/${addressOf(MINI, "delta")}`);
    await atRest(page, fake, probe);

    const columns = columnsOf(tradeList(resolveProfile("mini").store), rectOf(MINI));
    const deltas = columns.map((c) => 2 * c.bv - c.v);
    const dmax = Math.max(...deltas.map(Math.abs));
    expect(deltas.some((d) => d > 0) && deltas.some((d) => d < 0), "the day has Delta of both signs").toBe(true);

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const zero = area.y + area.h / 2;
    const up = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.65 });
    const down = paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.65 });
    expect(up.length + down.length).toBe(deltas.filter((d) => d !== 0).length);
    // A positive bar stands on the centre line and a negative one hangs from it, each as long as its share of the largest |Delta|.
    const room = area.h / 2 - 4;
    for (const bar of up) expect(bar.y + bar.h).toBeCloseTo(zero, 9);
    for (const bar of down) expect(bar.y).toBeCloseTo(zero, 9);
    const lengths = [...up, ...down].sort((a, b) => a.x - b.x).map((b) => b.h);
    const expected = columns.map((c, i) => ({ c: c.c, len: (Math.abs(deltas[i]) / dmax) * room })).filter((x) => x.len > 0);
    expected.forEach((x, i) => expect(lengths[i], `column ${x.c}`).toBeCloseTo(x.len, 8));
    expect(Math.max(...lengths), "the largest of either sign fills half the pane").toBeCloseTo(room, 9);
  });
});

// ---- the oscillators, on the hand-computed series --------------------------------------------------------------------------------

const DAY_MS = 86400000;
const INDICATORS = require("../fixtures/indicators/macd.json").cases;
const RSI_CASES = require("../fixtures/indicators/rsi.json").cases;
const num = (x) => (x === "NaN" ? NaN : x);

// A fake whose history is `days` whole UTC days from 2021-01-01 and whose daily closes are `closes`: two trades (the page wants some
// data), and the 8-hour bars (level 9, three to a day) written out by hand, every bar of a day closing at the day's close, so the daily
// frame of the page is the fixture's series exactly (a day's close is its last bar's close).
async function dailyFake(fakeFor, closes) {
  const cutoffIso = new Date(EPOCH_MS + closes.length * DAY_MS).toISOString();
  const trades = [
    { t_ms: 1000, price: 2500000, qty: 400000, takerBuy: true },
    { t_ms: closes.length * DAY_MS - 60000, price: 2500000, qty: 400000, takerBuy: false },
  ];
  const fake = await fakeFor({ trades, cutoffIso });
  const bars = [];
  closes.forEach((close, day) => {
    for (let k = 0; k < 3; k++) bars.push({ col: 3 * day + k, open: close, high: close, low: close, close, volume: 1, takerBuyVolume: 0.5, baseVolume: 0.01, trades: 1 });
  });
  fake.overrideBars(9, bars);
  return { fake, cutoffIso };
}
const wholeHistory = (closes) => `#t=2021-01-01T00:00Z~${new Date(EPOCH_MS + closes.length * DAY_MS).toISOString().slice(0, 16)}Z&p=24000~26000&r=12,3`;
const caseNamed = (cases, name) => cases.find((c) => c.name === name);

// The text the pane put in the price labels' column (right-aligned, inside the pane's rows), top to bottom.
const paneTexts = (frame, area) =>
  frame.texts.filter((t) => t.align === "right" && t.y >= area.y && t.y <= area.bottom).sort((a, b) => a.y - b.y).map((t) => t.text);

// The strokes of a recorded frame that are paths of the given width and colour inside the pane, as [x, y] vertex lists.
const pathsOf = (frame, area, { width, stroke }) =>
  frame.strokes
    .filter((s) => s.width === width && s.stroke === stroke && s.path.length >= 2 && s.path.every(([, y]) => y >= area.y - 1e-6 && y <= area.bottom + 1e-6))
    .map((s) => s.path);

test.describe("B18: MACD, one axis for three series (hand series walk120)", () => {
  const closes = caseNamed(INDICATORS, "walk120");
  const macd = closes.macd.map(num);
  const signal = closes.signal.map(num);
  const hist = closes.hist.map(num);
  const finite = (xs) => xs.filter(Number.isFinite);
  const M = Math.max(...finite(macd).map(Math.abs), ...finite(signal).map(Math.abs), ...finite(hist).map(Math.abs));

  test("the line, the signal and the histogram are all scaled by the largest of the three (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const { fake } = await dailyFake(fakeFor, closes.closes);
    await page.goto(`${fake.url}/${wholeHistory(closes.closes)}&pane=macd1d`);
    await atRest(page, fake, probe);

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const zero = area.y + area.h / 2;
    const room = area.h / 2 - 6;
    // The MACD line: one vertex per day from the 26th, at zero - value / M * room, M the largest of macd, signal and histogram.
    const [line] = pathsOf(frame, area, { width: 1.5, stroke: colours.ink });
    expect(line, "the MACD line is drawn").toBeTruthy();
    expect(line.length).toBe(finite(macd).length);
    finite(macd).forEach((v, i) => expect(zero - line[i][1], `MACD day ${i}`).toBeCloseTo((v / M) * room, 7));
    // The signal shares that axis: its own extreme is its own share of M, not the full room.
    const signalPath = frame.strokes.find((s) => s.width === 1.25 && s.path.length === finite(signal).length);
    expect(signalPath, "the signal line is drawn").toBeTruthy();
    finite(signal).forEach((v, i) => expect(zero - signalPath.path[i][1], `signal day ${i}`).toBeCloseTo((v / M) * room, 7));
    // The histogram bars, positive arm above the centre line and negative below, each |value| / M of the room.
    const up = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.45 });
    const down = paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.45 });
    const bars = [...up, ...down].sort((a, b) => a.x - b.x);
    expect(bars.length).toBe(finite(hist).length);
    finite(hist).forEach((v, i) => expect(bars[i].h, `histogram day ${i}`).toBeCloseTo((Math.abs(v) / M) * room, 7));
    // One axis: the largest thing drawn, of any of the three, reaches the edge of the room and nothing goes past it.
    const reach = Math.max(...line.map(([, y]) => Math.abs(zero - y)), ...signalPath.path.map(([, y]) => Math.abs(zero - y)), ...bars.map((b) => b.h));
    expect(reach).toBeCloseTo(room, 7);
  });

  test("the chip is one symmetric domain, -M to +M", async ({ page, fakeFor, probe, surface }) => {
    const { fake } = await dailyFake(fakeFor, closes.closes);
    await page.goto(`${fake.url}/${wholeHistory(closes.closes)}&pane=macd1d`);
    await atRest(page, fake, probe);
    const chip = await axisChip(surface);
    expect(chip.id).toBe("pane.macd1d");
    expect(chip.domain[1]).toBeCloseTo(M, 12);
    expect(chip.domain[0]).toBe(-chip.domain[1]);
    expect(chip.state).toBe("auto");
  });

  // ramp10: ten closes, so no MACD value yet (the first is on the 26th day). flat60: every close equal, so MACD, signal and histogram
  // are all exactly 0 from their first values.
  const ramp = caseNamed(INDICATORS, "ramp10").closes;
  const flat = caseNamed(INDICATORS, "flat60").closes;

  test("before its first value the pane says No data and draws nothing, never a scale of 1 (ramp10, canvas)", async ({ page, fakeFor, probe, pane }) => {
    const { fake } = await dailyFake(fakeFor, ramp);
    await page.goto(`${fake.url}/${wholeHistory(ramp)}&pane=macd1d`);
    await atRest(page, fake, probe);
    const none = await page.evaluate(() => window.explorerEncoding.text.axis.none);
    expect(none).toBe("No data");
    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    expect(paneTexts(frame, area), "the pane says No data in the price labels' column").toContain(none);
    expect(frame.strokes.filter((s) => s.width === 1.5 && s.stroke === colours.ink).length, "and draws no MACD line").toBe(0);
    expect(paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.45 }).length + paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.45 }).length, "or histogram").toBe(0);
  });

  test("before its first value the chip has no domain (ramp10)", async ({ page, fakeFor, probe, surface }) => {
    const { fake } = await dailyFake(fakeFor, ramp);
    await page.goto(`${fake.url}/${wholeHistory(ramp)}&pane=macd1d`);
    await atRest(page, fake, probe);
    const chip = await axisChip(surface);
    expect(chip.state).toBe("none");
    expect(chip.domain, "no data has no domain").toBeNull();
  });

  test("on a flat series every value is 0: the pane says 0 and draws a line at zero, not a spike against a maximum of 1 (flat60, canvas)", async ({ page, fakeFor, probe, pane }) => {
    const { fake } = await dailyFake(fakeFor, flat);
    await page.goto(`${fake.url}/${wholeHistory(flat)}&pane=macd1d`);
    await atRest(page, fake, probe);
    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    expect(paneTexts(frame, area), "the pane says 0").toContain("0");
    const [line] = pathsOf(frame, area, { width: 1.5, stroke: colours.ink });
    expect(line, "the line is drawn").toBeTruthy();
    for (const [, y] of line) expect(y).toBeCloseTo(area.y + area.h / 2, 9);
  });

  test("on a flat series the chip is 0 to 0, zero-only (flat60)", async ({ page, fakeFor, probe, surface }) => {
    const { fake } = await dailyFake(fakeFor, flat);
    await page.goto(`${fake.url}/${wholeHistory(flat)}&pane=macd1d`);
    await atRest(page, fake, probe);
    const chip = await axisChip(surface);
    expect(chip.state).toBe("zero-only");
    expect(chip.domain).toEqual([0, 0]);
  });
});

test.describe("B18: RSI is fixed at 0 to 100 with guides at 30 and 70 (hand series walk120)", () => {
  const walk = caseNamed(RSI_CASES, "walk120");
  const rsi = walk.runs.find((r) => r.n === 14).expected.map(num);

  test("the line, the guides and their labels stand where 0 to 100 puts them (canvas)", async ({ page, fakeFor, probe, pane }) => {
    const { fake } = await dailyFake(fakeFor, walk.closes);
    await page.goto(`${fake.url}/${wholeHistory(walk.closes)}&pane=rsi1d`);
    await atRest(page, fake, probe);
    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const y = (v) => area.y + 4 + (1 - v / 100) * (area.h - 8);

    const [line] = pathsOf(frame, area, { width: 1.5, stroke: colours.ink });
    expect(line, "the RSI line is drawn").toBeTruthy();
    expect(line.length).toBe(rsi.filter(Number.isFinite).length);
    rsi.filter(Number.isFinite).forEach((v, i) => expect(line[i][1], `day ${i}`).toBeCloseTo(y(v), 7));
    // The guides are dashed hairlines across the pane at 30 and 70.
    const guides = frame.strokes.filter((s) => s.dash.length === 2 && s.dash[0] === 3 && s.dash[1] === 3 && s.width === 1 && s.stroke === colours.line && s.path.length === 2);
    expect(guides.map((g) => g.path[0][1]).sort((a, b) => a - b)).toEqual([y(70), y(30)].map((v) => expect.closeTo(v, 7)));
    // The labels: the guides always, the two ends where they are 12 px clear of a guide's.
    const clearOfGuides = (v) => [30, 70].every((g) => Math.abs(y(g) - y(v)) >= 12);
    const expected = ["70", "30", ...[100, 0].filter(clearOfGuides).map(String)].sort();
    expect(paneTexts(frame, area).sort()).toEqual(expected);
  });

  test("the chip is the fixed domain 0 to 100", async ({ page, fakeFor, probe, surface }) => {
    const { fake } = await dailyFake(fakeFor, walk.closes);
    await page.goto(`${fake.url}/${wholeHistory(walk.closes)}&pane=rsi1d`);
    await atRest(page, fake, probe);
    const chip = await axisChip(surface);
    expect(chip.id).toBe("pane.rsi1d");
    expect(chip.domain).toEqual([0, 100]);
    expect(chip.state).toBe("fixed");
  });
});

// ---- the ratio columns: fixed -2..+2 with the 1/4x to 4x ticks --------------------------------------------------------------------

// The rule of E.ratio.ratioTicks, written out: the five ticks sit at ((v + 2) / 4) * room px from the bottom of a room-long axis; ends
// first, then the centre, then the halves, each kept when it is 12 px or more from every kept one.
function ratioLabels(room) {
  const ticks = [
    { v: -2, label: "1/4×" },
    { v: -1, label: "1/2×" },
    { v: 0, label: "1×" },
    { v: 1, label: "2×" },
    { v: 2, label: "4×" },
  ];
  const at = (t) => ((t.v + 2) / 4) * room;
  const kept = [];
  for (const i of [0, 4, 2, 1, 3]) if (kept.every((k) => Math.abs(at(k) - at(ticks[i])) >= 12)) kept.push(ticks[i]);
  return kept.map((t) => t.label);
}

test.describe("B18: the ratio columns have a fixed axis", () => {
  for (const name of ["efficiency", "cascade"]) {
    const view = name === "cascade" ? `#t=${MINI.from}~${MINI.to}&p=${MINI.lo}~${MINI.hi}&r=${MINI.n},${MINI.m}&mode=cascade` : addressOf(MINI, name);

    test(`${name}: the price labels are the 1/4x to 4x ticks that fit (canvas)`, async ({ page, fakeFor, probe, pane }) => {
      const fake = await fakeFor("mini");
      await page.goto(`${fake.url}/${view}`);
      await atRest(page, fake, probe);
      const frame = await pane.last();
      const colours = await pane.colours();
      const area = paneCanvas.paneRect(frame, colours.surface);
      const room = 2 * (area.h / 2 - 4);
      expect(paneTexts(frame, area).sort()).toEqual(ratioLabels(room).sort());
    });

    test(`${name}: the chip is fixed, -2 to +2`, async ({ page, fakeFor, probe, surface }) => {
      const fake = await fakeFor("mini");
      await page.goto(`${fake.url}/${view}`);
      await atRest(page, fake, probe);
      const chip = await axisChip(surface);
      expect(chip.id).toBe(`pane.${name}`);
      expect(chip.domain).toEqual([-2, 2]);
      expect(chip.state).toBe("fixed");
    });
  }
});

// ---- the settle: a domain holds through a gesture and then follows, with no further input --------------------------------------------

test.describe("B18: the domain holds during a gesture and follows once it has settled", () => {
  test("a replay step forward that reveals the largest column: Updating at the old domain, then the exact new maximum after 200 ms", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor("mini");
    const columns = columnsOf(tradeList(resolveProfile("mini").store), rectOf(MINI));
    const vmax = Math.max(...columns.map((c) => c.v));
    const at = columns.findIndex((c) => c.v === vmax);
    const before = Math.max(...columns.slice(0, at).map((c) => c.v));
    expect(before, "the maximum changes when the largest column appears").toBeLessThan(vmax);
    // Replay at the edge that closes the column before the largest: stepping forward one column shows the largest. (Stepping BACK
    // drops a domain fitted on later data at once, before it is painted: that is D4's replay rule, B13's to test, not a settle.)
    const edge = new Date(EPOCH_MS + columns[at - 1 >= 0 ? at : 0].c * 2 ** MINI.n * BASE_MS).toISOString().slice(0, 16) + "Z";
    await page.goto(`${fake.url}/${addressOf(MINI, "volume")}&replay=1&at=${edge}`);
    await atRest(page, fake, probe);
    await needChip(surface);
    const domain = async () => {
      const attrs = await page.evaluate(() => ({ ...document.getElementById("ol-axis-chip").dataset }));
      return { hi: Number(attrs.domain.split(",")[1]), state: attrs.axisState };
    };
    expect((await domain()).hi).toBeCloseTo(before, 6);

    await probe.reset();
    const pressedAt = await page.evaluate(() => performance.now());
    await page.keyboard.press(".");
    // With no further input the domain follows to the exact maximum of what is shown.
    await expect.poll(async () => (await domain()).hi, { timeout: 5000 }).toBeCloseTo(vmax, 6);
    expect((await domain()).state).toBe("auto");

    // The mutation log of the chip says what happened in between (a poll could miss a state that lasts 200 ms): it was Updating while the
    // domain was still the old one, and the new domain was written no sooner than the settle time after the step.
    const log = (await probe.mutations()).filter((m) => m.channel === "axis" && m.old !== m.value);
    const written = log.find((m) => m.name === "data-domain");
    expect(written, "the domain was rewritten").toBeTruthy();
    expect(Number(written.old.split(",")[1])).toBeCloseTo(before, 6);
    expect(written.t - pressedAt, "not before the 200 ms of settle").toBeGreaterThanOrEqual(190);
    const held = log.find((m) => m.name === "data-axis-state" && m.value === "updating");
    expect(held, "the chip said Updating").toBeTruthy();
    expect(held.t, "while the old domain was still in force").toBeLessThan(written.t);
    expect(held.t - pressedAt, "from the step itself").toBeLessThan(150);
  });
});

// ---- the tooltip reads the same axis -----------------------------------------------------------------------------------------------

test.describe("B18: a bar's tooltip and the axis agree", () => {
  // The bar under the pointer: its column's reference values, and the rendered tooltip (fields the pane wrote for a test, D.18).
  async function hoverBar(page, fake, probe, surface, pane) {
    await page.goto(`${fake.url}/${addressOf(MINI, "volume")}`);
    await atRest(page, fake, probe);
    const columns = columnsOf(tradeList(resolveProfile("mini").store), rectOf(MINI));
    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const bars = paneCanvas.barsOf(frame, area, { fill: colours.bar, alpha: 0.65 });
    const column = columns[17];
    await surface.hoverCell({ x: bars[17].x + bars[17].w / 2, y: area.y + area.h - 2 });
    await expect.poll(async () => (await surface.tip()).readout).toBe(`pane:pane.volume:${column.c}`);
    return { tip: await surface.tip(), column, vmax: Math.max(...columns.map((c) => c.v)) };
  }

  test("Volume: the tooltip's canonical numbers are the reference column and its place on the axis", async ({ page, fakeFor, probe, surface, pane }) => {
    const fake = await fakeFor("mini");
    const { tip, column, vmax } = await hoverBar(page, fake, probe, surface, pane);
    expect(Number(tip.fields.value.canonical), "the column's volume").toBeCloseTo(column.v, 6);
    expect(Number(tip.fields.trades.canonical), "and its trades").toBe(column.ct);
    // Where the value sits on the axis: its share of the maximum, and the maximum itself, to the last digit.
    expect(Number(tip.fields.axisPosition.canonical)).toBeCloseTo(column.v / vmax, 9);
    expect(Number(tip.fields.axisHigh.canonical)).toBeCloseTo(vmax, 6);
  });

  test("Volume: the tooltip and the chip are one record", async ({ page, fakeFor, probe, surface, pane }) => {
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/${addressOf(MINI, "volume")}`);
    await atRest(page, fake, probe);
    await needChip(surface);
    const { tip } = await hoverBar(page, fake, probe, surface, pane);
    const chip = await axisChip(surface);
    expect(Number(tip.fields.axisHigh.canonical)).toBe(chip.domain[1]);
  });
});

// ---- Comparison lock ---------------------------------------------------------------------------------------------------------------

test.describe("B18: Comparison lock freezes an axis", () => {
  // The lock itself is the spine's (S), its action is the legend popover's (U) and the address that restores it is P's: none of them is in
  // a page that has only this package. The steps, for the merged page: pane Volume on `mini` at the address of MINI, open the axis chip's
  // details, press Comparison lock (the chip says `frozen`, with the domain it had), scrub the view to a day with a larger maximum and see
  // the domain unchanged and the bars beyond it clamped with their triangle and count; copy the link, open it in a fresh context (storage
  // empty) and find the same frozen domain to the last digit, `data-axis-state` `frozen`.
  test.fixme("Comparison lock freezes the domain and the address restores it in a fresh context (needs S, U and P)", async () => {});
});
