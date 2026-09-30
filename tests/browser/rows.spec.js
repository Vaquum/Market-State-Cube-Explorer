"use strict";
// B10 rows.spec.js (R): Rows period, quality and row size (TESTPLAN 3.4 B10). Covers S1-016 to S1-018 (registered axes are not R's; the
// Rows mapping is), S1-043 to S1-045 (Rows contexts: period identity, effective row size, quality, no n), S1-081 to S1-084 (the Rows
// cohort is every measured row of the period, off-screen rows included), S1-140 to S1-144 (the period key at a rollover).
//
// What is asserted, through the chips and details of INTEGRATION.md D.18 (the observation surface the spine and the DOM package write):
//   1. the Rows mapping is period-wide: its U is the maximum over ALL rows of the period from the exact reference, INCLUDING rows that
//      are off screen, and scrolling the peak row out of view changes neither U nor the mapping id nor the fit counter;
//   2. its context has no resolution level n (stepping the column level leaves the id and the context alone) and does have the effective
//      row size (stepping the row level changes both and discloses a "Scale changed" naming the cause);
//   3. a rolling period is one identity: an hour later (fake.advance) the context and the id are the same while the period's endpoint
//      moves on; a calendar period is one identity until its start moves: at the week's rollover the new key has no record, nothing is
//      fitted from the old week's rows, and the new mapping is fitted on observations that end after the new week began;
//   4. the recorded snapshot's coarse rows are a labelled approximation: quality approx-rows:<size>, the row size in the context.
// Oracles (none is the code under test): tests/reference (exact rational period rows over the same synthetic trades); the UTC instant of
// the rollover (2026-09-28T00:00Z, a Monday) for the week; the address the page itself writes for the pan.
// Dependencies: these assertions read the chips (#ol-rows-legend data-*), the details fields and the settled disclosure, which the
// spine (S) and the DOM package (U) write. On a page without them the tests skip with the missing element named (never a silent pass).
// What this does NOT prove: Auto refits and the lens (B12), replay eligibility (B13), persistence of the Rows id (B14), any theme other
// than light, and the quality class of an exact tile that replaces a coarser one.
const { test, expect } = require("./fixtures.js");
const reference = require("../reference/index.js");
const { resolveProfile } = require("../support/profiles.js");
const S = require("./rows-support.js");

// The trades of a stored stream inside [fromMs, toMs), as the reference takes them.
function tradesOf(store, fromMs, toMs) {
  const out = [];
  for (let i = 0; i < store.length; i++) {
    const t = store.t[i];
    if (t >= fromMs && t < toMs) out.push({ t_ms: t, price: store.price[i], qty: store.qty[i], takerBuy: Boolean(store.buy[i]), count: store.count[i] });
  }
  return out;
}

// The Rows chip and its details, or the test skips saying which D.18 element is missing.
async function rowsChip(page, surface, testInfo) {
  const present = await page.locator("#ol-rows-legend[data-mapping-id]").count();
  testInfo.skip(present === 0, "INTEGRATION.md D.18 element missing: the Rows chip (#ol-rows-legend) carries no data-mapping-id; this spec waits for the spine and the DOM package");
  return surface.chip("rows");
}

const fieldOf = (details, name) => details.fields[name]?.value;

// One reading of the Rows channel: the chip's dataset and the details that matter.
async function reading(surface) {
  const chip = await surface.chip("rows");
  const details = await surface.details("rows");
  return { ...chip.data, U: Number(fieldOf(details, "U")), k: Number(fieldOf(details, "k")), cohortCount: Number(fieldOf(details, "cohortCount")), obsCutoff: fieldOf(details, "obsCutoff"), cause: fieldOf(details, "scaleChangeCause") ?? "", from: fieldOf(details, "scaleChangeFrom") ?? "", to: fieldOf(details, "scaleChangeTo") ?? "" };
}

// The price range of the address the page wrote, in USDT.
async function viewRange(page) {
  const hash = await page.evaluate(() => location.hash);
  const m = /[#&]p=([0-9.]+)~([0-9.]+)/.exec(hash);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

test.describe("Rows Explore mapping is period-wide", () => {
  test("U is the maximum over all rows of the period, off-screen rows included, and scrolling the peak out of view changes nothing", async ({ page, probe, fakeFor, surface }, testInfo) => {
    const { store } = resolveProfile("standard");
    const fake = await fakeFor("standard");
    // The period: the last 7 days in base columns, to the edge that closes the data.
    const b0 = S.END_COL - 7 * S.DAY_COLS;
    const period = reference.periodRows(tradesOf(store, b0 * S.BASE_MS, S.END_COL * S.BASE_MS), { b0, b1: S.END_COL, m: 0 });
    const peak = period.reduce((best, x) => (x.v > best.v ? x : best));
    // A view that holds the peak row with room around it: four rows, of the period's eleven.
    const view = [peak.r - 2, peak.r + 2];
    await page.goto(`${fake.url}/${S.address({ cols: [S.END_COL - S.DAY_COLS, S.END_COL], rows: view, rowsKind: "volume", period: "7d" })}`);
    await S.atRest(page, fake, probe);
    await rowsChip(page, surface, testInfo);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toBe("ready");
    const before = await reading(surface);

    expect(before.rowSize, "four rows in the view: the row size is the finest").toBe("0");
    expect(before.quality).toBe("exact");
    expect(before.cohortCount, "every row of the period is in the cohort, in view or not").toBe(period.length);
    expect(period.some((x) => x.r < view[0] || x.r >= view[1]), "the reference period does reach rows outside the view").toBe(true);
    expect(before.U / peak.v, "U is the period's largest row, exactly (to the last digits of a float sum)").toBeCloseTo(1, 9);

    // Scroll the view up until the peak row is out of it: each step is 15% of the four rows.
    const [lo0] = await viewRange(page);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("ArrowUp");
      await probe.waitForQuiet({ quietMs: 300 });
    }
    await S.atRest(page, fake, probe);
    const [lo1, hi1] = await viewRange(page);
    expect(lo1, "the view moved").toBeGreaterThan(lo0);
    expect(peak.r * 125 + 125 <= lo1 || peak.r * 125 >= hi1, `the peak row ${peak.r} is out of the view ${lo1}~${hi1}`).toBe(true);
    const after = await reading(surface);
    expect(after.mappingId, "the mapping did not change").toBe(before.mappingId);
    expect(after.U).toBe(before.U);
    expect(after.fitSeq, "nothing was refitted").toBe(before.fitSeq);
  });
});

test.describe("Rows context: no resolution level, the effective row size and the quality", () => {
  test("the column level is not part of it; the row size is, and a change of it is disclosed", async ({ page, probe, fakeFor, surface }, testInfo) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&rows=volume&period=7d`);
    await S.atRest(page, fake, probe);
    await rowsChip(page, surface, testInfo);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toBe("ready");
    const base = await reading(surface);
    expect(base.context, "the context names the period and the row size").toMatch(/\|roll:7\|m[0-9]+$/);
    expect(base.context, "and has no column level").not.toMatch(/\|n[0-9]+m[0-9]+$/);

    // `]` steps the column level (n) only.
    await page.keyboard.press("]");
    await S.atRest(page, fake, probe);
    const stepped = await reading(surface);
    expect(stepped.context, "the same context after a column-level change").toBe(base.context);
    expect(stepped.mappingId).toBe(base.mappingId);
    expect(stepped.fitSeq).toBe(base.fitSeq);

    // `}` steps the row level (m): the effective row size changes, so the context and the mapping do.
    await page.keyboard.press("}");
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await reading(surface)).rowSize).not.toBe(base.rowSize);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toBe("ready");
    const coarser = await reading(surface);
    expect(coarser.context).not.toBe(base.context);
    expect(Number(coarser.rowSize), "one level coarser").toBe(Number(base.rowSize) + 1);
    expect(coarser.mappingId).not.toBe(base.mappingId);
    expect(coarser.cause, "disclosed as a scale change and named").toMatch(/resolution/);
    expect(coarser.from).toBe(base.mappingId);
    expect(coarser.to).toBe(coarser.mappingId);
  });
});

test.describe("Rows period identity", () => {
  test("a rolling 90 day period is one identity an hour later; its endpoint moves on", async ({ page, probe, fakeFor, surface }, testInfo) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=24h&rows=volume&period=90d`);
    await S.atRest(page, fake, probe);
    await rowsChip(page, surface, testInfo);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toBe("ready");
    const before = await reading(surface);
    expect(before.context).toMatch(/\|roll:90\|m[0-9]+$/);

    fake.advance({ minutes: 60 });
    await expect.poll(async () => (await reading(surface)).obsCutoff, { timeout: 40000, message: "the period's endpoint moved with the new data" }).not.toBe(before.obsCutoff);
    await S.atRest(page, fake, probe);
    const after = await reading(surface);
    expect(after.context, "the same identity").toBe(before.context);
    expect(after.mappingId, "Explore does not refit on new data").toBe(before.mappingId);
    expect(after.fitSeq).toBe(before.fitSeq);
  });

  test("a calendar week is one identity until it rolls over; then the new key has no record until the new week is read, and nothing is fitted from the old rows", async ({ page, probe, fakeFor, surface }, testInfo) => {
    const fake = await fakeFor("standard", { cutoff: "2026-09-27T23:50:00Z" });
    await page.goto(`${fake.url}/#w=24h&rows=volume&period=wk`);
    await S.atRest(page, fake, probe);
    await rowsChip(page, surface, testInfo);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toBe("ready");
    const sunday = await reading(surface);
    expect(sunday.context, "the week that began Monday 21 September").toMatch(/\|cal:wk:2026-09-21\|m[0-9]+$/);

    // Five minutes later the week has grown and is still the same week.
    fake.advance({ minutes: 5 });
    await expect.poll(async () => (await reading(surface)).obsCutoff, { timeout: 40000 }).not.toBe(sunday.obsCutoff);
    const grown = await reading(surface);
    expect(grown.context).toBe(sunday.context);
    expect(grown.mappingId).toBe(sunday.mappingId);

    // Fifteen more: it is Monday 28 September 00:10 UTC, a new week.
    fake.advance({ minutes: 15 });
    await expect.poll(async () => (await reading(surface)).context, { timeout: 40000 }).toMatch(/\|cal:wk:2026-09-28\|/);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await surface.chip("rows")).data.state, { timeout: 40000 }).toBe("ready");
    const monday = await reading(surface);
    expect(monday.mappingId, "a new identity").not.toBe(sunday.mappingId);
    expect(monday.cause, "with its cause named").toMatch(/period/);
    // Fitted on the new week's rows, never on the old week's: what it observed ends after the new week began.
    expect(Number(monday.fitThrough), "its observations end after Monday 00:00Z").toBeGreaterThanOrEqual(Date.parse("2026-09-28T00:00:00Z"));
  });

  test("the recorded snapshot's coarse rows are a labelled approximation with their row size in the context", async ({ page, probe, fakeFor, surface }, testInfo) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/#w=all&rows=volume&period=90d`);
    await S.atRest(page, fake, probe);
    await rowsChip(page, surface, testInfo);
    await expect.poll(async () => (await surface.chip("rows")).data.state).toBe("ready");
    const coarse = await reading(surface);
    expect(coarse.quality, "approximate, with the recorded row size").toMatch(/^approx-rows:[1-9][0-9]*$/);
    expect(coarse.context, "the quality is part of the key").toContain(`|${coarse.quality}|`);
    expect(Number(coarse.rowSize), "rows coarser than the base row").toBeGreaterThan(0);
  });
});
