"use strict";
// B03 readout-agreement.spec.js (package T): the tooltip, the Cells-table row, the legend marker and the canvas pixel of ONE cell are
// the same record (PRD-0002 S1: issue46 "Migrate current pointer/table-hover consumers", #46 Acc.3, DR-22, DD-17, DD-84, DD-93;
// S1-004..009, S1-019, S1-022..024, S1-033, S1-066, S1-160..162, S1-202).
//
// What it asserts, on the real page behind the fake cube:
//   * for every measure (Volume, Trades, Size, Delta, Flow, Flow trades, Cascade, Path, Dwell, and Intensity where the page offers a
//     basis choice) the canonical numbers of the tooltip and of the table row of the same cell (`data-canonical` of the fields both
//     carry, same `data-readout` / `data-cell-key` string "<n>:<m>:<c>:<r>") are identical; for Volume, Trades, Size, Delta, Flow,
//     Flow trades, Path and Dwell they are also the hand-computed numbers of tests/fixtures/trades/mixed.json;
//   * where the page shows a legend marker, the marker's coordinate equals the coordinate of the tooltip and of the table row
//     (hovering either), and the canvas pixel inside the cell equals the LUT entry at that index (E.lut.build, the pinned table);
//   * a table row carries the level it was listed at; with the view wider than one read holds (the page draws coarser than the
//     requested level) the rows are at the DRAWN level, and hovering a row outlines its cell on the chart (DR-22 level fix);
//   * a balanced traded Delta cell (two 100 USDT trades, one taker buy, one sell) reads Buy 100, Sell 100, Volume 200, Delta 0,
//     Trades 2, and its pixel is the midpoint entry, which differs from the empty surface (micro:balanced);
//   * a cell without trades has a Trade size that is typed undefined (the table row of a moved-through cell);
//   * the pointer resting on the price axis for 2 s draws no frame after the first two; a theme flip re-derives a visible tip once
//     without a draw loop; the legend marker is hidden within one frame after the pointer leaves (DD-93);
//   * the tooltip of a loaded cell while the rectangle is still being measured is a value, not "reading" (DD-84).
//
// Oracles, none of them the code under test: the hand-computed cells of tests/fixtures/trades/mixed.json and balanced.json (their
// "notes" derive every number: cell 0,200 holds v 300, bv 100, ct 2, bt 1; its motion p 250 USDT, w 41.25 s; one row is 125 USDT,
// one column 56.25 s), the pinned LUT (`explorerEncoding.lut.build`, whose hash U18 pins) for the pixel, and the agreement of two
// separately built DOM records of the same cell.
//
// Parts that need another package are NOT skipped silently: when the page has no legend chip or marker (the DOM package) or its
// mapping is not resolved (the spine) the test records an annotation "not checked: <why>" and runs everything else. The reach of
// this spec in a worktree without those packages is stated in the package report.
//
// What this does NOT prove: anything at device pixel ratio other than 1, the tooltip in a dark theme, touch taps, keyboard inspection
// (not in the baseline and owned by #48), the exact Intensity numbers without the basis control.
const { test, expect } = require("./fixtures.js");

const VIEW = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500";
// The cell every measure is read at: column 0, row 200 of the level 0:0 (25,000 to 25,125 USDT, the first 56.25 s).
const KEY = "0:0:0:200";
const MODES = ["volume", "trades", "size", "delta", "flow", "flowtrades", "cascade", "path", "dwell"];
// Hand-computed from mixed.json for the cell 0,200 (see the notes of the fixture): amounts, ratios and the motion of the cell.
const EXPECT = {
  volume: { value: 300 },
  trades: { value: 2 },
  size: { value: 150 },
  delta: { value: -100 },
  flow: { value: 100 / 300 },
  flowtrades: { value: 1 / 2 },
  // path 250 USDT over one 125 USDT row in row spans; dwell 41.25 s of a 56.25 s column
  path: { value: 250 / 125 },
  dwell: { value: 41.25 / 56.25 },
};
const FIELDS = { volume: 300, trades: 2, buyVolume: 100, buyTrades: 1, sellVolume: 200, delta: -100 };
const MOTION_FIELDS = { path: 250, dwell: 41.25, pathSpans: 2, width: 125, seconds: 56.25 };
const SIGNED = new Set(["delta", "flow", "flowtrades", "cascade"]);

async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 600, timeoutMs: 30000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
}

// The readout key under the pointer at canvas point (x, y), or null (no tooltip, or a tooltip with no cell readout). This reads the
// same attribute as observe.tip(); a scan cannot use that helper because it waits for the attribute.
async function readoutAt(page, canvas, x, y) {
  await page.mouse.move(canvas.x + x, canvas.y + y);
  return page.evaluate(() => {
    const tip = document.getElementById("ol-tip");
    return !tip.hidden && tip.dataset.readout ? tip.dataset.readout : null;
  });
}

// The box of the cell `key` on the canvas, found by looking: a coarse scan for a point that reads the key, then a bisection to each
// of its four edges (the readout changes exactly at the cell's edge). The page does not say where a cell is (D.18), so a spec
// measures it; the expected NUMBERS never come from here.
async function boxOf(page, canvas, key) {
  let seed = null;
  for (let y = 40; y < canvas.height - 40 && !seed; y += 30)
    for (let x = 40; x < canvas.width - 40 && !seed; x += 30) if ((await readoutAt(page, canvas, x, y)) === key) seed = { x, y };
  if (!seed) throw new Error(`no point of the canvas reads the cell ${key}`);
  const inside = async (x, y) => (await readoutAt(page, canvas, x, y)) === key;
  const edge = async (from, limit, horizontal) => {
    let a = from, b = limit;
    while (Math.abs(b - a) > 1) {
      const m = Math.round((a + b) / 2);
      if (await inside(horizontal ? m : seed.x, horizontal ? seed.y : m)) a = m;
      else b = m;
    }
    return a;
  };
  const x0 = await edge(seed.x, 1, true), x1 = await edge(seed.x, canvas.width - 1, true);
  const y0 = await edge(seed.y, 1, false), y1 = await edge(seed.y, canvas.height - 1, false);
  return { x0, x1, y0, y1, cx: Math.round((x0 + x1) / 2), cy: Math.round((y0 + y1) / 2) };
}

// The LUT entry a pixel must equal: the pinned table of the page's appearance in the light theme, read through the public module.
function lutEntry(page, role, idx) {
  return page.evaluate(({ role, idx }) => {
    const E = window.explorerEncoding;
    const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, "light");
    const css = role === "midpoint" ? lut.midpoint.css : lut[role].css[idx];
    return E.lut.parseColor(css);
  }, { role, idx });
}

// The colour most of a 3 x 3 grid of pixels inside the cell has, at DPR 1. The price path and the rule lines cross cells, so the
// centre alone could be a line; the mode of nine interior samples is the fill.
async function fillOf(surface, box) {
  const seen = new Map();
  for (const fx of [0.25, 0.5, 0.75])
    for (const fy of [0.25, 0.5, 0.75]) {
      const p = await surface.pixelAt({ x: box.x0 + (box.x1 - box.x0) * fx, y: box.y0 + (box.y1 - box.y0) * fy });
      seen.set(p.slice(0, 3).join(","), (seen.get(p.slice(0, 3).join(",")) ?? 0) + 1);
    }
  const [top] = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  return top[0].split(",").map(Number);
}

// Is a mapping resolved and shown, so that a colour, a coordinate and a marker can be compared? Without the DOM package's chip there
// is nothing that says so; without the spine's resolution every cell is occupancy and there is nothing to compare.
async function scaleShown(surface, page) {
  const absent = await surface.missing(["cells", "marker"]);
  if (absent.length) return { ok: false, why: `the DOM package has not put ${absent.join(" and ")} on the page` };
  const chip = await surface.chip("cells");
  if (!["ready", "fixed"].includes(chip.data.state)) return { ok: false, why: `the cells scale is "${chip.data.state}", not resolved` };
  return { ok: true };
}

// The canonical value of a field of a readout as text, "none" where the record has no such field (a cell with no coordinate).
const canon = (read, name) => (read.fields[name] ? read.fields[name].canonical : "none");
const same = (a, b) => a === b || (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= 1e-9 * Math.max(1, Math.abs(Number(a))));

function note(testInfo, text) {
  testInfo.annotations.push({ type: "not checked", description: text });
}

test.describe("B03 readout agreement", () => {
  for (const mode of MODES) {
    test(`${mode}: tooltip, table row, legend marker and pixel are one record`, async ({ page, fakeFor, surface, probe }, testInfo) => {
      const fake = await fakeFor("micro:mixed");
      await page.goto(`${fake.url}/${VIEW}&mode=${mode}`);
      await atRest(page, fake, probe);
      // The table is listed when the drawer shows it.
      await page.locator('[data-drawer="cells"]').click();
      const canvas = await page.locator("#ol-canvas").boundingBox();
      const box = await boxOf(page, canvas, KEY);

      // --- the tooltip ---
      await page.mouse.move(canvas.x + box.cx, canvas.y + box.cy);
      const tip = await surface.tip();
      expect(tip.readout, "the tooltip names the cell and its level").toBe(KEY);
      for (const [name, value] of Object.entries(FIELDS)) expect(Number(canon(tip, name)), `tooltip ${name}`).toBeCloseTo(value, 9);
      if (mode === "path" || mode === "dwell") for (const [name, value] of Object.entries(MOTION_FIELDS)) expect(Number(canon(tip, name)), `tooltip ${name}`).toBeCloseTo(value, 9);
      if (EXPECT[mode]) expect(Number(canon(tip, "value")), `the ${mode} value the chart encodes`).toBeCloseTo(EXPECT[mode].value, 9);
      else expect(canon(tip, "value"), "a Cascade value, or the tag of why it has none").not.toBe("none");
      // Dwell names both its numerator and its denominator; Path its raw inputs (DR-12).
      if (mode === "path" || mode === "dwell") {
        expect(tip.text).toContain("of 56.25 s covered");
        expect(tip.text).toContain("Coverage");
        expect(tip.text).toContain("Unattributed");
      }
      const shown = await scaleShown(surface, page);
      const tipCoordinate = canon(tip, "coordinate");
      const tipIndex = canon(tip, "index");
      if (shown.ok) {
        const marker = await surface.legendMarker();
        expect(marker.visible, "the marker is on the legend while the tip shows").toBe(true);
        expect(marker.readout, "the marker names the tip's readout").toBe(KEY);
        expect(Number(marker.coordinate), "the marker stands where the tip says").toBeCloseTo(Number(tipCoordinate), 9);
        // The pixel is the LUT entry at the index of the readout.
        const idx = Number(tipIndex), t = Number(tipCoordinate);
        if (idx >= 0) {
          const role = SIGNED.has(mode) ? (t > 0 ? "positive" : t < 0 ? "negative" : "midpoint") : "unsigned";
          expect(await fillOf(surface, box), "the pixel is the LUT entry at the readout's index").toEqual(await lutEntry(page, role, idx));
        }
      } else note(testInfo, `marker and pixel: ${shown.why}`);

      // --- the table row of the same cell: the same numbers ---
      await page.mouse.move(2, 2);
      await expect.poll(async () => (await surface.readout(KEY)).source, { message: "the tooltip has gone and the table answers" }).toBe("table");
      const row = await surface.readout(KEY);
      expect(row.level, "the row says the level it was listed at").toBe("0:0");
      for (const name of ["volume", "trades", "buyVolume", "buyTrades", "value", "coordinate", "index"]) expect(same(canon(row, name), canon(tip, name)), `${name}: table ${canon(row, name)} vs tooltip ${canon(tip, name)}`).toBe(true);
      if (mode === "path" || mode === "dwell") for (const name of ["path", "dwell"]) expect(same(canon(row, name), canon(tip, name)), `${name}: table ${canon(row, name)} vs tooltip ${canon(tip, name)}`).toBe(true);

      // --- hovering the row puts its value on the legend, and leaving clears it within a frame ---
      if (shown.ok) {
        await page.locator(`tr[data-cell-key="${KEY}"]`).hover();
        await expect.poll(async () => (await surface.legendMarker()).visible, { message: "a hovered row shows its marker" }).toBe(true);
        const marker = await surface.legendMarker();
        expect(marker.readout).toBe(KEY);
        expect(Number(marker.coordinate)).toBeCloseTo(Number(tipCoordinate), 9);
        await page.mouse.move(canvas.x + 5, canvas.y + 5);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect((await surface.legendMarker()).visible, "the marker is cleared within a frame of the pointer leaving the row").toBe(false);
      }
    });
  }

  test("Intensity: the tooltip and the table row carry one record, where the page offers the basis", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("micro:mixed");
    await page.goto(`${fake.url}/${VIEW}`);
    await atRest(page, fake, probe);
    await page.locator("#ol-mode").click();
    const item = page.getByRole("menuitemradio", { name: /Intensity/ });
    test.skip((await item.count()) === 0, "Intensity cannot be chosen from outside yet: the Scale section of the Cells menu (DOM package) and the address form of the basis (persistence) are not on this page");
    await item.click();
    await page.locator('[data-drawer="cells"]').click();
    const canvas = await page.locator("#ol-canvas").boundingBox();
    const box = await boxOf(page, canvas, KEY);
    await page.mouse.move(canvas.x + box.cx, canvas.y + box.cy);
    const tip = await surface.tip();
    // 300 USDT over 56.25 s x 125 USDT = 300 * 60 * 125 / (56.25 * 125) = 320 USDT per minute per 125 USDT band
    expect(Number(canon(tip, "value"))).toBeCloseTo((300 * 60 * 125) / (56.25 * 125), 9);
    expect(Number(canon(tip, "exposureSeconds"))).toBeCloseTo(56.25, 9);
    await page.mouse.move(2, 2);
    const row = await surface.readout(KEY);
    expect(same(canon(row, "value"), canon(tip, "value"))).toBe(true);
  });

  test("a balanced traded Delta cell reads Buy 100, Sell 100, Volume 200, Delta 0, Trades 2 and is the midpoint colour", async ({ page, fakeFor, surface, probe }, testInfo) => {
    const fake = await fakeFor("micro:balanced");
    await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:03Z&p=24800~25500&mode=delta`);
    await atRest(page, fake, probe);
    const canvas = await page.locator("#ol-canvas").boundingBox();
    const box = await boxOf(page, canvas, KEY);
    await page.mouse.move(canvas.x + box.cx, canvas.y + box.cy);
    const tip = await surface.tip();
    expect(Number(canon(tip, "buyVolume"))).toBe(100);
    expect(Number(canon(tip, "sellVolume"))).toBe(100);
    expect(Number(canon(tip, "volume"))).toBe(200);
    expect(Number(canon(tip, "delta"))).toBe(0);
    expect(Number(canon(tip, "trades"))).toBe(2);
    // Zero Delta of a traded cell is a value (the midpoint), never "no trades"
    expect(Number(canon(tip, "value"))).toBe(0);
    expect(tip.text).not.toContain("No trades");
    const shown = await scaleShown(surface, page);
    if (!shown.ok) return note(testInfo, `the midpoint pixel: ${shown.why}`);
    expect(Number(canon(tip, "coordinate"))).toBe(0);
    const pixel = await fillOf(surface, box);
    expect(pixel, "the midpoint entry of the LUT").toEqual(await lutEntry(page, "midpoint", 0));
    const empty = await surface.pixelAt({ x: box.x1 + 40, y: box.cy });
    expect(pixel, "and not the empty surface").not.toEqual(empty.slice(0, 3));
  });

  test("a cell without trades has a Trade size that is undefined, naming the denominator", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("micro:mixed");
    // A column pane that follows the price path lists the cells the price moved through without a trade in the table.
    await page.goto(`${fake.url}/${VIEW}&mode=size&pane=choppiness`);
    await atRest(page, fake, probe);
    await page.locator('[data-drawer="cells"]').click();
    const row = await surface.readout("0:0:4:199");
    expect(row.fields.trades.canonical).toBe("0");
    expect(row.fields.value.canonical, "the typed tag of the Trade size of a cell with no trades").toBe("undefined");
    expect(row.fields.index.canonical).toBe("none");
  });

  test("a view wider than one read lists the table at the level drawn, and a row outlines its cell", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("standard");
    // 7 days at the finest level is 10,752 columns: more than one read holds, so the chart draws a coarser level than requested.
    await page.goto(`${fake.url}/#w=7d&r=0,0`);
    await atRest(page, fake, probe);
    await page.locator('[data-drawer="cells"]').click();
    const canvas = await page.locator("#ol-canvas").boundingBox();
    let drawn = null;
    for (let y = 60; y < canvas.height - 60 && !drawn; y += 40)
      for (let x = 60; x < canvas.width - 60 && !drawn; x += 40) drawn = await readoutAt(page, canvas, x, y);
    expect(drawn, "some cell of the chart has a readout").not.toBeNull();
    const [n, m] = drawn.split(":").map(Number);
    expect(n, "the chart draws coarser in time than the requested level 0").toBeGreaterThan(0);
    await expect(page.locator("tr[data-cell-key]").first()).toBeVisible();
    const levels = await page.evaluate(() => [...new Set([...document.querySelectorAll("#ol-table-body tr")].map((tr) => tr.dataset.level))]);
    expect(levels, "every row of the table is at the level the chart draws").toEqual([`${n}:${m}`]);
    // Hover the first row: its cell is outlined on the chart at the row's own level (a 2 px ink stroke).
    await probe.reset();
    await page.locator("tr[data-cell-key]").first().hover();
    await probe.waitForDrawFrames(1);
    const frames = await probe.frames();
    const outlined = frames.some((frame) => frame.styles.some((s) => s.op === "strokeRect" && s.lineWidth === 2));
    expect(outlined, "a 2 px outline was drawn for the hovered row").toBe(true);
  });

  test("the pointer resting on the price axis draws no frame after the first two, and a theme flip re-derives the tip without a loop", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("micro:mixed");
    await page.goto(`${fake.url}/${VIEW}`);
    await atRest(page, fake, probe);
    const canvas = await page.locator("#ol-canvas").boundingBox();
    const box = await boxOf(page, canvas, KEY);
    // A tip is showing; then the pointer goes to the price labels, where the tip is hidden at once while the hover stays.
    await page.mouse.move(canvas.x + box.cx, canvas.y + box.cy);
    await surface.tip();
    await probe.reset();
    await page.mouse.move(canvas.x + 20, canvas.y + box.cy);
    await page.waitForTimeout(2000);
    const frames = await probe.frames();
    expect(frames.length, "frames drawn in 2 s with the pointer at rest on the price axis").toBeLessThanOrEqual(2);

    // A visible tip under a changed theme is derived again (the stamp names the theme epoch) and the page settles.
    await page.mouse.move(canvas.x + box.cx, canvas.y + box.cy);
    const before = await surface.tip();
    await probe.reset();
    await page.emulateMedia({ colorScheme: "dark" });
    await probe.waitForQuiet({ quietMs: 500, timeout: 10000 });
    const after = await surface.tip();
    expect(after.readout, "the same cell").toBe(before.readout);
    expect(after.visible).toBe(true);
    expect((await probe.stats()).drawFrames, "a theme flip is a handful of frames, not a loop").toBeLessThan(20);
  });

  test("a loaded cell read while the rectangle is being measured is a value, not a reading", async ({ page, fakeFor, surface, probe }) => {
    // A 30 day window on the standard profile is measured by the cube (its edges are not on a block's cells), so a pan asks again.
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=30d`);
    await atRest(page, fake, probe);
    const canvas = await page.locator("#ol-canvas").boundingBox();
    // Hold the cube's answer for the rectangle, then pan: the chart keeps the loaded cells and only the numbers of the rectangle wait.
    const gate = fake.on({ route: "/cube/query" }).gate();
    await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.4 + 60, canvas.y + canvas.height * 0.4, { steps: 6 });
    await page.mouse.up();
    await gate.arrived();
    // Find a cell with a readout and read it while the answer is held.
    let key = null;
    for (let y = 60; y < canvas.height - 60 && !key; y += 30)
      for (let x = 60; x < canvas.width - 60 && !key; x += 30) key = await readoutAt(page, canvas, x, y);
    expect(key, "a loaded cell has a readout while the rectangle is being measured").not.toBeNull();
    const tip = await surface.tip();
    expect(Number.isFinite(Number(canon(tip, "value"))), `the value of ${key} is a number while measuring (is "${canon(tip, "value")}")`).toBe(true);
    // Let every read finish before the fake goes: a request cut off by the teardown is a console error.
    gate.open();
    await fake.idle({ quietMs: 800, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
  });
});
