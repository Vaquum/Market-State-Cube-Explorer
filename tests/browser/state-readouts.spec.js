"use strict";
// B38 state-readouts.spec.js (PRD-0002 S2, #47 section 4 and the acceptance list): the readout half of the measure-by-state table, with the rendering half beside it.
//
// state-table.spec.js (B30) names, for each row of the PRD's table, the test that holds its rendering. This file holds what a person reads for a cell in each state
// that has a cell: the tooltip's own words, hovered where the cell is, and, in the same test, the mark the cell has on the canvas, so no state is only drawn or only
// said. It also holds the co-occurrence rules: read and coverage say whether a measurement exists; the formula's tag says why there is no ratio; finality
// annotates a value that can be drawn or is waiting; and no pair of them is one ambiguous fill (provisional with zero, open with a waiting parent, a failed read
// with an empty cell).
// Oracles (none is the code under test): the hand fixtures (which cell is which state, tests/fixtures/trades), the pinned LUT and the pattern tiles asked of the
// module the page carries, the PRD's table written out, and the words the readout module publishes for each tag (E.text).
const { test: base, expect, probeTools } = require("./fixtures.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox } = require("./cells-support.js");
const paneCanvas = require("./pane-canvas.js");

const A = "&vis=2&ap=slate2-8f7890f7";
const VIEW = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

async function open({ freshContext, fakeFor }, { profile, level, mode, prepare = () => {} }) {
  const fake = await fakeFor(profile);
  prepare(fake);
  const context = await freshContext({ reducedMotion: "reduce" });
  await addRecorder(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  const probe = probeTools.forPage(page);
  await openView(page, fake, probe, `#t=${VIEW.from}~${VIEW.to}&p=${VIEW.low}~${VIEW.high}&r=${level[0]},${level[1]}&mode=${mode}${A}`);
  await probe.waitForQuiet({ quietMs: 600, timeout: 20000 });
  return { page, fake, probe, draw: await lastDraw(page), colours: await pageColours(page) };
}
// The tooltip of the cell (c, r) at the level, hovered at its centre, as one line of text.
async function tipOf(page, draw, level, c, r) {
  const box = boxOf(draw.plot, rectOf(VIEW), level[0], level[1], c, r),
    cb = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(cb.x + 3, cb.y + cb.height - 3);
  await page.mouse.move(cb.x + (box.x0 + box.x1) / 2, cb.y + (box.y0 + box.y1) / 2);
  const tip = page.locator("#ol-tip");
  await expect(tip).toBeVisible();
  return { tip, box, ops: opsOfBox(draw, box) };
}

test.describe("B38 a cell in each state says what it is and is drawn as what it is", () => {
  test("pending (row 5): the read has not answered: dots on the canvas, 'not measured by the cube yet' in the readout, never a zero", async ({ freshContext, fakeFor }) => {
    const { page, draw, colours } = await open({ freshContext, fakeFor }, { profile: "micro:paths", level: [0, 0], mode: "path", prepare: (fake) => fake.motionThrough(4) });
    const { tip, ops } = await tipOf(page, draw, [0, 0], 4, 199);
    expect(ops[0].style, "the dots tile of a reading cell").toBe(colours.tiles["pattern-dots"]);
    await expect(tip).toContainText(/Path, dwell\s*not measured by the cube yet/);
    await expect(tip).not.toContainText(/Path \/ price span\s*0 row spans/);
  });

  test("failed (row 6): the value is an invalid input: the crosshatch on the canvas, the error in the readout, not a zero and not a colour", async ({ freshContext, fakeFor }) => {
    const { page, draw, colours } = await open({ freshContext, fakeFor }, { profile: "micro:nonvalues", level: [0, 0], mode: "dwell", prepare: (fake) => fake.corrupt({ dwell: -1 }) });
    const { tip, ops } = await tipOf(page, draw, [0, 0], 0, 200);
    expect(ops[0].style, "the crosshatch of a failed value").toBe(colours.tiles["pattern-cross"]);
    await expect(tip).toContainText(/Dwell\s*Invalid input: negative-dwell/);
    await expect(tip).toContainText(/Dwell-1 s · Invalid input: negative-dwell/);
  });

  test("a parent that is not complete (row 9): the neutral waiting pattern, 'waiting for the complete parent (open)', and the cell's own column still says Complete", async ({ freshContext, fakeFor }) => {
    const { page, draw, colours } = await open({ freshContext, fakeFor }, { profile: "micro:nonvalues", level: [1, 1], mode: "cascade" });
    const { tip, ops } = await tipOf(page, draw, [1, 1], 2, 101);
    expect(ops[0].style, "the slate pattern of not yet defined").toBe(colours.tiles["pattern-slate"]);
    await expect(tip).toContainText(/Cascade\s*Waiting for the complete parent \(open\)/);
    // finality annotates: the cell's own column is complete, the parent's openness is the formula's tag, and neither stands in for the other
    await expect(tip).toContainText(/Column\s*Complete/);
    await expect(tip, "no ratio is shown while the parent waits").not.toContainText(/Of its parent\s*[0-9]/);
  });

  test("a cell with no trades in a provisional range (provisional with zero): both facts are said, and neither is the other", async ({ freshContext, fakeFor }) => {
    const { page, draw, colours } = await open({ freshContext, fakeFor }, { profile: "micro:paths", level: [0, 0], mode: "volume" });
    const { tip, ops } = await tipOf(page, draw, [0, 0], 0, 203);
    await expect(tip).toContainText(/No trades in this cell/);
    await expect(tip).toContainText(/Source\s*provisional minutes/);
    // drawn as an empty cell, not as a value of the provisional kind: no quantitative fill, no outline of an occupied one
    expect(ops.filter((o) => o.op === "fillRect" && colours.unsigned.includes(o.style)), "no ramp fill for a cell with no trades").toEqual([]);
    // (the provisional boundary is its own dashed line where the archive ends, with its key: B30 row 13)
  });
});

test.describe("B38 the states of a standard live view: archive, provisional, open and hidden", () => {
  const live = "#t=2026-09-23T12:00Z~2026-09-24T12:30Z&p=22000~23500&r=6,0&vis=2";
  async function openLive(page, fake, probe, hash) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${hash}`);
    await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { timeout: 30000 }).toBe(true);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
  }
  async function hoverAt(page, hour, price) {
    const L = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number)),
      cb = await page.locator("#ol-canvas").boundingBox();
    const a = Date.parse("2026-09-23T12:00Z"),
      b = Date.parse("2026-09-24T12:30Z");
    const x = L[0] + ((Date.parse(hour) - a) / (b - a)) * L[2],
      y = L[1] + ((23500 - price) / 1500) * L[3];
    await page.mouse.move(cb.x + 3, cb.y + cb.height - 3);
    await page.mouse.move(cb.x + x, cb.y + y);
    const tip = page.locator("#ol-tip");
    await expect(tip).toBeVisible();
    return tip;
  }

  test("archive and provisional (row 13): a provisional minute says so, an archived one does not, and both are complete", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await openLive(page, fake, probe, live);
    const archived = await hoverAt(page, "2026-09-23T20:30Z", 22937);
    await expect(archived).toContainText(/Column\s*Complete/);
    await expect(archived, "an archived hour has no provisional source").not.toContainText(/Source\s*provisional/);
    const provisional = await hoverAt(page, "2026-09-24T06:30Z", 22562);
    await expect(provisional).toContainText(/Column\s*Complete/);
    await expect(provisional).toContainText(/Source\s*provisional minutes/);
  });

  test("open but already measured (row 12): the value stays, and the column says it is still open, a portion, and provisional: three facts, none of them the value", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await openLive(page, fake, probe, "#t=2026-09-23T00:00Z~2026-09-24T16:00Z&p=22000~23500&r=9,2&vis=2");
    const L = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number)),
      cb = await page.locator("#ol-canvas").boundingBox();
    // the open 8-hour column (08:00 to 16:00 holds the cutoff, 12:02): a point in its first half, in a row that traded
    const a = Date.parse("2026-09-23T00:00Z"),
      b = Date.parse("2026-09-24T16:00Z");
    await page.mouse.move(cb.x + L[0] + ((Date.parse("2026-09-24T09:00Z") - a) / (b - a)) * L[2], cb.y + L[1] + ((23500 - 22250) / 1500) * L[3]);
    const tip = page.locator("#ol-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/Column\s*Still open · portion/);
    await expect(tip).toContainText(/Source\s*provisional minutes/);
    await expect(tip, "the value is kept: an amount, a count and its place on the scale").toContainText(/Volume · Amount[0-9.]+ [kM]? ?USDT/);
    await expect(tip).toContainText(/Position on scale[0-9.]+%/);
  });

  test("hidden by replay or past the data (row 16): the future is named, not filled: 'Hidden in replay' under replay, 'After the data cutoff' live", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await openLive(page, fake, probe, `${live}&replay=1&at=2026-09-24T06:00Z`);
    await expect(await hoverAt(page, "2026-09-24T10:30Z", 22750)).toContainText(/Hidden in replay/);
    await openLive(page, fake, probe, live);
    await expect(await hoverAt(page, "2026-09-24T12:20Z", 22750)).toContainText(/After the data cutoff/);
  });
});

test.describe("B38 unsupported history and a coarser level than asked", () => {
  test("unsupported (row 7): the recorded snapshot has no 125 USDT rows at a year's columns: the slash on every column of the pane, and the readout says what is missing and where it exists", async ({ page, probe, fakeFor, pane }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fake = await fakeFor("recorded");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=1y&vis=2&pane=efficiency`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
    const L = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number)),
      cb = await page.locator("#ol-canvas").boundingBox(),
      frame = await pane.last();
    // the slash of the role table is a pattern: one run of it across the columns the snapshot has no rows for, as wide as that run (the pattern is a fill, not a bar)
    const runs = frame.rects.filter((r) => r.fill === "pattern" && r.y >= L[12] - 1 && r.w > 100);
    expect(runs.length, "the unsupported columns are one patterned run in the pane").toBeGreaterThan(0);
    const run = runs.reduce((a, b) => (b.w > a.w ? b : a));
    const bars = frame.rects.filter((r) => r.alpha === 0.85 && r.y >= L[12] && r.x >= run.x && r.x + r.w <= run.x + run.w);
    expect(bars, "no bar inside the run: there is no number there").toEqual([]);
    expect(run.x + run.w, "the run ends where the snapshot's rows begin, before the right edge").toBeLessThan(L[0] + L[2] - 20);
    await page.mouse.move(cb.x + L[0] + L[2] * 0.5, cb.y + L[12] + 20);
    const tip = page.locator("#ol-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/Not supported here: live cube only/);
    await expect(tip).toContainText(/The recorded snapshot has no 125 USDT rows here/);
    await expect(tip, "never a zero").not.toContainText(/Efficiency\s*[−+0-9]/);
  });

  test("coarser than asked (row 14): the cell is drawn at the level that is loaded, its value kept, and its readout says 'coarser than requested'", async ({ page, probe, fakeFor, pane, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fake = await fakeFor("standard");
    fake.on({ route: /^\/cube\/tile/ }).fail({ status: 500 });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2`);
    await page.waitForFunction(() => {
      const line = document.getElementById("ol-loading");
      return line.hidden || line.getAttribute("role") === "alert";
    });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
    const L = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number)),
      cb = await page.locator("#ol-canvas").boundingBox(),
      frame = await pane.last();
    const cells = frame.rects.filter((r) => r.alpha === 1 && r.w >= 8 && r.h >= 8 && r.x >= L[0] && r.y >= L[1] && r.y + r.h <= L[1] + L[3] && r.w < L[2] / 2 && r.fill !== "#ffffff");
    expect(cells.length, "coarse cells are drawn").toBeGreaterThan(10);
    const c = cells[Math.floor(cells.length / 2)];
    await page.mouse.move(cb.x + c.x + c.w / 2, cb.y + c.y + c.h / 2);
    const tip = page.locator("#ol-tip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/Detail\s*coarser than requested/);
    await expect(tip, "the value is kept: an amount and its place on the scale").toContainText(/Volume · Amount[0-9.]+ [kM] USDT/);
    await expect(page.locator("#ol-data-coarse"), "and the key says it").toBeVisible();
  });
});

test.describe("B38 co-occurrence: a cell whose own column is open and whose parent is not complete", () => {
  test("Cascade at 8-hour columns: the open column's cell is waiting for its parent AND still open, each said on its own; the waiting pattern is a fill and the open edge a cap, neither standing in for the other", async ({ page, probe, fakeFor, pane }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#t=2026-09-23T00:00Z~2026-09-24T16:00Z&p=22000~23500&r=9,2&vis=2&mode=cascade`);
    await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { timeout: 30000 }).toBe(true);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 800, timeout: 30000 });
    const L = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number)),
      cb = await page.locator("#ol-canvas").boundingBox();
    const a = Date.parse("2026-09-23T00:00Z"),
      b = Date.parse("2026-09-24T16:00Z");
    // a cell of the open 8-hour column that traded (the pane's column has a value for it)
    let found = null;
    for (const price of [22250, 22375, 22125, 22750, 22875, 22625, 22500, 23000]) {
      const x = cb.x + L[0] + ((Date.parse("2026-09-24T09:00Z") - a) / (b - a)) * L[2],
        y = cb.y + L[1] + ((23500 - price) / 1500) * L[3];
      await page.mouse.move(cb.x + 3, cb.y + cb.height - 3);
      await page.mouse.move(x, y);
      await page.waitForTimeout(250);
      const text = ((await page.locator("#ol-tip").isVisible()) && (await page.locator("#ol-tip").textContent())) || "";
      if (/Waiting for the complete parent/.test(text)) {
        found = { x, y, text: text.replace(/\s+/g, " ") };
        break;
      }
    }
    expect(found, "a cell in the open column that waits for its parent").toBeTruthy();
    expect(found.text, "its parent is not complete").toMatch(/Cascade\s*Waiting for the complete parent \(open\)/);
    expect(found.text, "and its own column is still open: a separate fact").toMatch(/Column\s*Still open · portion/);
    expect(found.text, "no ratio is shown for it").not.toMatch(/Of its parent\s*[0-9]/);
    // drawn: the waiting pattern is one fill and the open edge's cap another mark, neither standing in for the other
    await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
    const frame = await pane.last();
    const patterns = frame.rects.filter((r) => r.fill === "pattern" && r.x >= L[0] && r.y >= L[1] && r.y < L[1] + L[3]);
    expect(patterns.length, "the waiting pattern is painted").toBeGreaterThan(0);
    const caps = frame.rects.filter((r) => Math.abs(r.h - 1.5) < 1e-9 && r.alpha === 1 && Math.abs(r.y - L[1]) < 1e-6);
    expect(caps.length, "the open column's cap is painted").toBeGreaterThan(0);
    // (the focus's own two-tone boundary, over any cell, is B26's)
  });
});

test.describe("B38 an undefined column", () => {
  test("a column whose trades all sit at one price has no Choppiness: the hollow diamond on the baseline in the pane, and its readout says it is not defined and why, never a zero", async ({ page, probe, fakeFor, pane }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fake = await fakeFor("micro:mixed");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:05Z&p=24375~26875&r=0,0&mode=path`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 400, timeoutMs: 20000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
    const L = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number)),
      cb = await page.locator("#ol-canvas").boundingBox(),
      frame = await pane.last(),
      colours = await pane.colours();
    // columns 2, 3 and 4 traded at one price (the fixture's hand values): a diamond each, on the baseline of the pane
    const area = paneCanvas.paneRect(frame, colours.surface);
    const diamonds = paneCanvas.glyphsOf(frame, colours.state).diamond;
    expect(diamonds.length, "a diamond for each undefined column").toBe(3);
    // hover the middle of the first diamond's slot: the tooltip of the column
    await page.mouse.move(cb.x + diamonds[0][0], cb.y + area.y + area.h / 2);
    const tip = page.locator("#ol-tip");
    await expect(tip).toBeVisible();
    await expect(tip, "named by what is missing").toContainText(/Undefined: price range is 0/);
    await expect(tip, "and never a number for the column's value").not.toContainText(/Choppiness\s*[0-9.]+\s*$/);
    await expect(tip, "the typed reason and its denominator").toContainText(/Choppiness · path ÷ range\s*Undefined: price range is 0/);
  });
});
