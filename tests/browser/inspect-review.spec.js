"use strict";
// B55 inspect-review.spec.js (PRD-0002 S3, #48 section 3, the review of PR #53): the Inspect tool where its first version was wrong.
//
// What is asserted:
//   1. an arrow with no meaning on the surface (Left and Right on Rows and References, Up and Down on Columns) does nothing, and does not fall through to the chart,
//      which would pan: the key is consumed and the view in the address is the same;
//   2. Rows read prices only and Columns read time only: a cursor carried out of the view on the axis the surface ignores neither blocks a step nor is moved by it;
//   3. the columns of an oscillator pane are its own bars (a day here), the step is one bar, and the position says "Bar";
//   4. no two references of the list are named alike: the three curves of one Bollinger band, the days of the session VWAP, are told apart, in the position line,
//      the announcement and the chooser;
//   5. the swings' equal highs and lows and the crosses, which the plot draws with their own hover details, are in the list;
//   6. a Cells reading is the cell's record, never a reference line that happens to lie under the cursor;
//   7. choosing a reference in the navigator's chooser reads it, from whichever surface the cursor was on;
//   8. a clock reference says whether its lines are drawn at all: held back by the budget is not "yes".
// Oracles (none is the code under test): the address read back, the navigator's own data attributes, the hand series of tests/fixtures/indicators, the chart's
// recorded frame for what was drawn.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");
const { EPOCH_MS } = require("../support/profiles.js");

const RSI_CASES = require("../fixtures/indicators/rsi.json").cases;
const num = (x) => (x === "NaN" ? NaN : x);

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const DAY_MS = 86400000;
const BASE_MS = 56250;
const HOUR_MS = 3600000;
// a busy path for the lens test (the same as inspect-lens.spec.js), ending 20 minutes into an hour so that the column the cutoff is in is open
const ms = (iso) => Date.parse(iso) - EPOCH_MS;
const iso = (t) => new Date(t + EPOCH_MS).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");
const TE = ms("2026-09-01T00:00:00Z");
const CUT = TE + 3 * DAY_MS + 20 * 60000;
const pathPrice = (t) => 25000 + 150 * Math.sin((2 * Math.PI * t) / (9 * HOUR_MS)) + 40 * Math.sin((2 * Math.PI * t) / (1.3 * HOUR_MS));
const TRADES = (() => {
  const out = [];
  for (let k = Math.ceil((TE - 12 * HOUR_MS) / 100000); ; k++) {
    const t = k * 100000 + 17000;
    if (t > CUT) break;
    out.push({ t_ms: t, price: Math.round(pathPrice(t) * 100), qty: 100000 + ((k * 7919) % 400000), takerBuy: k % 3 !== 0 });
  }
  return out;
})();
const ADDRESS = "#w=24h&vis=2&lines=7d,30d&level=25100";

async function open(page, fake, probe, hash = ADDRESS) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 500, timeout: 60000 });
}
// A fake whose history is the days of a fixture's closes from 2021-01-01, the 8-hour bars written out by hand (the same as axes.spec.js): the page's daily frame is the
// fixture's series exactly.
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
  return fake;
}
const wholeHistory = (closes) => `#t=2021-01-01T00:00Z~${new Date(EPOCH_MS + closes.length * DAY_MS).toISOString().slice(0, 16)}Z&p=24000~26000&r=12,3`;
// the address without the scale record `sc`, which the page writes when a fit lands (on a slow runner that can be between two readings); the view, the selection and the
// replay edge are what these tests hold still
const hashOf = (page) => page.evaluate(() => location.hash.replace(/&sc=[^&]*/, ""));
const cell = (page) => page.locator("#ol-inspect").evaluate((n) => ({ c: Number(n.dataset.c), r: Number(n.dataset.r), ts: Number(n.dataset.ts), ps: Number(n.dataset.ps), inside: n.dataset.inside, surface: n.dataset.surface }));
const position = (page) => page.locator("#ol-inspect-position").textContent();
const boundary = (page) => page.locator("#ol-inspect-boundary").textContent();
const surface = async (page, name) => {
  await page.locator(`button[data-surface="${name}"]`).click();
  await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", name);
  await page.locator("#ol-inspect").focus();
};
const options = (page) => page.locator("#ol-inspect-reference option").allTextContents();
// a drag across the chart in the Inspect tool pans it (the existing B44 test does the same), so a cursor can be left outside the view on one axis
async function drag(page, dx, dy) {
  const box = await page.locator("#ol-canvas").boundingBox(),
    x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test.describe("B55 Inspect: the review of PR #53", () => {
  test("an arrow with no meaning on the surface does nothing, is consumed, and never pans the chart", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    // what the page's own handlers left of each keydown, as the last listener on the window sees it: a consumed key is default-prevented
    await page.evaluate(() => {
      window.__keys = [];
      const note = (e) => window.__keys.push([e.key, e.defaultPrevented]);
      document.getElementById("ol-inspect").addEventListener("keydown", note);
      document.addEventListener("keydown", note);
    });
    await page.keyboard.press("e");
    const before = await hashOf(page);
    const inert = { rows: ["ArrowLeft", "ArrowRight"], columns: ["ArrowUp", "ArrowDown"], references: ["ArrowLeft", "ArrowRight"] };
    for (const [name, keys] of Object.entries(inert)) {
      await surface(page, name);
      const at = await cell(page),
        said = await position(page);
      for (const key of keys) {
        await page.evaluate(() => (window.__keys.length = 0));
        await page.keyboard.press(key);
        await probe.waitForQuiet({ quietMs: 250, timeout: 30000 });
        expect(await page.evaluate(() => window.__keys.at(-1)), `${key} on ${name} is consumed`).toEqual([key, true]);
        expect(await hashOf(page), `${key} on ${name} moved nothing: the view in the address is the same`).toBe(before);
        expect(await cell(page), `${key} on ${name}: the cursor is where it was`).toEqual(at);
        expect(await position(page), `${key} on ${name}: and says the same`).toBe(said);
      }
    }
  });

  test("an arrow on the navigator's own controls is consumed too: Up and Down on a focused surface tab pan nothing, and its own Left and Right still move the tabs", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    await page.keyboard.press("e");
    const before = await hashOf(page);
    const tab = page.locator('button[data-surface="cells"]');
    await tab.focus();
    await expect(tab).toBeFocused();
    for (const key of ["ArrowUp", "ArrowDown"]) {
      await page.evaluate(() => {
        window.__tabKeys = [];
        const note = (e) => window.__tabKeys.push([e.key, e.defaultPrevented]);
        document.addEventListener("keydown", note, { once: true });
      });
      await page.keyboard.press(key);
      await probe.waitForQuiet({ quietMs: 300, timeout: 30000 });
      expect(await hashOf(page), `${key} on a tab: the view did not move`).toBe(before);
      expect(await page.evaluate(() => document.activeElement?.dataset?.surface), `${key} on a tab: the focus stayed on it`).toBe("cells");
    }
    // the tablist's own keys are untouched by it
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('button[data-surface="rows"]'), "Right is the next tab").toBeFocused();
    expect(await hashOf(page)).toBe(before);
  });

  test("Rows read prices only and Columns read time only: the axis a surface ignores neither blocks a step nor moves", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    await page.keyboard.press("e");
    // Rows, with the cursor's time carried out of the view by a pan to the right
    await surface(page, "rows");
    await page.keyboard.press("Home");
    const home = await cell(page);
    await drag(page, 700, 0);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    const viewed = await hashOf(page);
    await page.locator('button[data-surface="cells"]').click();
    expect((await cell(page)).inside, "on Cells the cursor is outside the carried view (so the pan did carry it out)").toBe("false");
    await surface(page, "rows");
    expect((await cell(page)).inside, "on Rows, which reads prices only, it is inside").toBe("true");
    await page.keyboard.press("ArrowDown");
    const down = await cell(page);
    expect(down.r, "a row below: the step was made though the time is outside").toBe(home.r - 1);
    expect(await boundary(page), "no edge is announced").toBe("");
    expect(await hashOf(page), "and the view did not move").toBe(viewed);
    await page.keyboard.press("ArrowUp");
    expect((await cell(page)).r).toBe(home.r);
    expect((await cell(page)).c, "the time the surface does not read is not touched").toBe(home.c);
    // Columns, with the cursor's price carried out of the view by a pan up (Home on Cells has brought the time back in first)
    await page.locator('button[data-surface="cells"]').click();
    await page.locator("#ol-inspect").focus();
    await page.keyboard.press("Home");
    await page.locator('button[data-surface="cells"]').click();
    expect((await cell(page)).inside, "the cursor is back in the view on Cells").toBe("true");
    // the cursor on the top row, and the chart pulled up: the view moves to lower prices and the cursor's is above it
    for (let i = 0; i < 200 && (await boundary(page)) !== "Top of the view"; i++) await page.keyboard.press("ArrowUp");
    await drag(page, 0, -450);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    expect((await cell(page)).inside, "on Cells the cursor's price is now outside the carried view").toBe("false");
    await surface(page, "columns");
    expect((await cell(page)).inside, "on Columns, which reads time only, the cursor is inside").toBe("true");
    const col = await cell(page);
    await page.keyboard.press("ArrowRight");
    const next = await cell(page);
    expect(next.c, "the next column, though the price is outside").toBe(col.c + 1);
    expect(await boundary(page)).toBe("");
    expect(next.r, "the price the surface does not read is not touched").toBe(col.r);
  });

  test("an oscillator's columns are its own bars: a day's bar is a step, named a bar, and its value is the series' value for that day", async ({ page, probe, fakeFor }) => {
    const walk = RSI_CASES.find((c) => c.name === "walk120"),
      rsi = walk.runs.find((r) => r.n === 14).expected.map(num);
    const fake = await dailyFake(fakeFor, walk.closes);
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${wholeHistory(walk.closes)}&pane=rsi1d`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 500, timeout: 60000 });
    await page.keyboard.press("e");
    const gridStep = (await cell(page)).ts;
    expect(gridStep, "the Cells' column is not a day here (so the two can be told apart)").not.toBe(DAY_MS / BASE_MS);
    await surface(page, "columns");
    await page.keyboard.press("Home");
    const first = await cell(page);
    expect(first.ts, "the step of Columns on the RSI pane is a day, not the Cells' column").toBe(DAY_MS / BASE_MS);
    expect(await position(page), "named a bar").toMatch(/^Bar /);
    // 14 bars on is the first bar with a value: each Right is the next bar and nothing is skipped or repeated
    let at = first.c;
    for (let day = 1; day <= 16; day++) {
      await page.keyboard.press("ArrowRight");
      const now = await cell(page);
      expect(now.c, `step ${day}: the next bar`).toBe(at + 1);
      at = now.c;
      if (day >= 14) await expect(page.locator("#ol-inspect-readout"), `bar ${at}: the series' value for that day`).toContainText(rsi[at].toFixed(2));
    }
    // End is the last bar of the view and its edge is the view's
    await page.keyboard.press("End");
    const last = await cell(page);
    expect(last.c).toBe(walk.closes.length - 1);
    await expect(page.locator("#ol-inspect-readout")).toContainText(rsi[last.c].toFixed(2));
    await page.keyboard.press("ArrowRight");
    expect(await boundary(page)).toBe("End of the view");
    expect((await cell(page)).c).toBe(last.c);
  });

  // a view with many kinds of reference on: the three curves of two Bollinger bands, the days of the session VWAP, swings and their equal pairs, crosses, calendar lines
  const RICH = "#w=30d&vis=2&lines=bb4h,bb1d,svwap,swing4h,swing1d,gdcross,cme,7d,30d,cday,funding";
  async function openRich(page, fake, probe) {
    await open(page, fake, probe, RICH);
    await page.keyboard.press("e");
    await surface(page, "references");
  }

  test("no two references of the list are named alike: the curves of a band and the days of the session VWAP are told apart, in the chooser, the position and the announcement", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await openRich(page, fake, probe);
    const names = await options(page);
    expect(names.length, "the list is long").toBeGreaterThan(40);
    expect(new Set(names).size, `every name is its own: ${names.filter((n, i) => names.indexOf(n) !== i).join("; ")}`).toBe(names.length);
    const band = names.filter((n) => /^Bollinger/.test(n));
    expect(band.length, "three curves for each of two timeframes").toBe(6);
    for (const part of ["Upper", "Middle", "Lower"]) expect(band.filter((n) => n.includes(part)).length, `a ${part} curve for each timeframe`).toBe(2);
    expect(names.filter((n) => /^Session VWAP/.test(n)).length, "a day each of a month").toBeGreaterThan(20);
    // the position line and the announcement name the entry the cursor is on by the same name, entry by entry
    await page.keyboard.press("Home");
    const seen = new Set();
    for (let i = 0; i < names.length; i++) {
      const said = await position(page);
      expect(said.startsWith(names[i] + " · "), `entry ${i + 1}: the position names ${names[i]}, said "${said}"`).toBe(true);
      expect(await page.locator("#ol-inspect-live").textContent(), `entry ${i + 1}: and so does the announcement`).toContain(names[i]);
      seen.add(said);
      if (i < names.length - 1) await page.keyboard.press("ArrowDown");
    }
    expect(seen.size, "no two entries are said alike").toBe(names.length);
  });

  test("the equal highs and lows and the crosses the plot draws are in the list, and each reads as itself", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await openRich(page, fake, probe);
    const names = await options(page),
      frame = await pane.last();
    const drawnEq = frame.texts.filter((x) => /^\d+h EQ[HL]$/.test(x.text)).length;
    expect(drawnEq, "the plot draws an equal pair").toBeGreaterThan(0);
    const equal = names.filter((n) => /equal (highs|lows) · /.test(n)),
      cross = names.filter((n) => /^(Golden|Death) cross · /.test(n));
    expect(equal.length, "each equal pair drawn is a reference").toBeGreaterThanOrEqual(drawnEq);
    expect(cross.length, "the crosses of the daily averages are references").toBeGreaterThan(0);
    for (const name of [equal[0], cross[0], cross.at(-1)]) {
      await page.locator("#ol-inspect-reference").selectOption({ label: name });
      expect(await position(page)).toContain(name);
      const text = await page.locator("#ol-inspect-readout").textContent();
      expect(text, `${name}: a record of its own, not the cell's or another line's`).toMatch(name.includes("equal") ? /Equal|equal/ : /50 SMA/);
      expect(text).toMatch(/Known at|Timeframe/);
    }
  });

  test("a Cells reading is the cell's record: a reference line under the cursor does not take its place", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    // the 7-day POC of the standard cube stands at 22,937.5, the middle of the row of 22,875 to 23,000
    await open(page, fake, probe, "#w=24h&vis=2&lines=7d,30d");
    await page.keyboard.press("e");
    for (let i = 0; i < 80 && !(await position(page)).includes("22,875–23,000 USDT"); i++) await page.keyboard.press(/22,[0-7]\d\d–/.test(await position(page)) ? "ArrowUp" : "ArrowDown");
    expect(await position(page), "the cursor is on the row the line passes through").toContain("22,875–23,000 USDT");
    const readout = await page.locator("#ol-inspect-readout").textContent();
    expect(readout, "it reads the cell, a time and a price").toMatch(/UTC · /);
    expect(readout, "and not the line").not.toMatch(/POC/);
    expect(await page.locator("#ol-inspect").getAttribute("data-surface")).toBe("cells");
    expect(await page.locator("#ol-tip").getAttribute("data-readout") ?? "", "the tip is the cell's").not.toMatch(/poc/i);
  });

  test("choosing a reference in the chooser reads it, from Cells, Rows and Columns alike", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&lines=7d,30d");
    await page.keyboard.press("e");
    const names = await options(page),
      pick = names[1];
    for (const from of ["cells", "rows", "columns"]) {
      await surface(page, from);
      expect(await page.locator("#ol-inspect").getAttribute("data-surface")).toBe(from);
      const was = await hashOf(page);
      await page.locator("#ol-inspect-reference").selectOption({ label: pick });
      await expect(page.locator("#ol-inspect"), `from ${from}: the cursor is on the reference`).toHaveAttribute("data-surface", "references");
      expect(await position(page), `from ${from}: the position names it`).toContain(pick);
      await expect(page.locator("#ol-inspect-readout"), `from ${from}: the readout is its record`).toContainText(/Period|Known at/);
      expect(await page.locator("#ol-inspect-live").textContent(), `from ${from}: and it is announced`).toContain(pick);
      expect(await hashOf(page), "and the address does not change").toBe(was);
    }
  });

  test("a calendar reference says whether its lines are drawn, and agrees with the inventory when the budget holds them back", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await openRich(page, fake, probe);
    const state = {};
    await page.keyboard.press("e");
    await page.locator("#ol-lines").click();
    for (const key of ["cday", "funding", "cme"]) state[key] = await page.locator(`.ol-line-row[data-ref-key="${key}"]`).getAttribute("data-ref-state");
    await page.keyboard.press("Escape");
    await page.keyboard.press("e");
    await surface(page, "references");
    expect(Object.values(state), "the budget holds some calendar kind back and draws another").toEqual(expect.arrayContaining(["occlusion"]));
    expect(Object.values(state).some((s) => s !== "occlusion"), "and not all of them").toBe(true);
    for (const [key, name] of [["cday", "Day start"], ["funding", "Funding"], ["cme", "CME"]]) {
      await page.locator("#ol-inspect-reference").selectOption({ label: name });
      const drawn = await page.locator('#ol-inspect-readout dt:has-text("Drawn") + dd').textContent();
      if (state[key] === "occlusion") expect(drawn, `${name} is held back by the budget`).toMatch(/^no: held back by the 20% budget/);
      else expect(drawn, `${name} is drawn`).toMatch(/^yes/);
    }
  });

  test("the lens keeps the unfinished state: an empty finer cell of the open column is not a completed zero, and a measured one says its column is open", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: iso(CUT) });
    await page.setViewportSize({ width: 1500, height: 950 });
    const a = CUT - 10 * HOUR_MS,
      b = CUT + 2 * HOUR_MS;
    await page.goto(`${fake.url}/#t=${iso(a)}~${iso(b)}&p=24600~25400&r=6,3&vis=2`);
    await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { message: "startup is over", timeout: 120000 }).toBe(true);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    const layout = (await page.locator("#ol-canvas").getAttribute("data-layout")).split(",").map(Number),
      box = await page.locator("#ol-canvas").boundingBox();
    // the lens over the open column, a few minutes before the cutoff
    await page.keyboard.press("l");
    await page.mouse.move(box.x + layout[0] + layout[2] * ((CUT - 3 * 60000 - a) / (b - a)), box.y + layout[1] + layout[3] * 0.5);
    await expect.poll(async () => (await pane.last()).texts.some((x) => /^Lens/.test(x.text)), { message: "the lens is drawn", timeout: 60000 }).toBe(true);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "lens");
    await page.locator("#ol-inspect").focus();
    const readout = page.locator("#ol-inspect-readout");
    // the finer cell the lens starts on has trades in an hour that is not over
    await expect(readout, "a measured finer cell").toContainText("Taker buys");
    await expect(readout, "in the open column, and says so").toContainText(/Column\s*Still open/);
    // and the next cell down is empty: not a completed zero
    await page.keyboard.press("ArrowDown");
    await expect(readout, "an empty finer cell of the open column").toContainText("Still open: no trades yet");
    await expect(readout).not.toContainText("No trades in this finer cell");
    // a column that is over: a measured cell says Complete, an empty one is a completed zero
    await page.keyboard.press("ArrowLeft");
    const text = await readout.textContent();
    expect(text, "an earlier column is over").not.toMatch(/Still open/);
    if (/Taker buys/.test(text)) expect(text).toMatch(/Column\s*Complete/);
    else expect(text).toContain("No trades in this finer cell");
  });
});
