"use strict";
// recovery-faults.spec.js (S, B20): coherence and recovery under the fake cube's fault knobs (TESTPLAN 3.4, 4.3; DR-17, DD-47, DD-79,
// DD-80, DD-91, D.14 walk-throughs 3 and 11).
//
// Requirement ids covered (API.md Appendix E): S1-115 (a calibration is made only from coherent, complete data: never while a
// read is held, never from a failed or empty one), S1-116 (the memo key follows the data, not the pack token: a whole pack, a
// delta, a revision and a retry leave mapping identity alone), S1-081 (partial and open columns are not in the cohort), S1-149
// (what changed under the data is said in the details and never as "revised"), DD-79 (a failed read is not outstanding), DD-91 (a
// corrupt stored record does not stop the chart).
//
// What each scenario does is in its title. The fake's knobs are the ones of TESTPLAN 4.3: expirePack/holdPacks + advance (a whole
// pack), a gate on the view tile, fail/empty/malformed on the tile, rebuild (a delta of unchanged data), revise (409 cube_changed,
// then a whole pack), jitter (last-bit different sums), motionThrough (measures end early), setCanonicalThrough (provisional
// minutes replaced by the archive).
//
// Oracle: the exact-rational reference for what a cohort must contain (cell-aligned rectangle at a pinned level, which columns are
// open at the fractional cutoff), relations between observed values for everything else (identity unchanged, counters unchanged,
// the same id as an ungated run of the same view). The test never reads the fake's store.
//
// What needs another package: the chip popover (U) for the details fields, the browser cache `scales:v1` (P) for the corrupt-record
// test's precondition. Each fails by naming the missing element until it has merged.
//
// Not covered: the two-minute timeout message (L10 of TESTPLAN 4.7: page.clock does not advance AbortSignal.timeout), the recorded page.
const { test, expect } = require("./fixtures.js");
const { calm, field, tradesOf, priceRowsOf, baseOf } = require("./scale-helpers.js");
const ref = require("../reference/index.js");

// A view that needs a tile: 40 days back, at a level finer than any tier holds, a range that is off the cell grid.
const TILE_VIEW = "#t=2026-08-10T00:07Z~2026-08-11T00:00Z&p=10000~40000&r=2,0";

async function text(page, selector) {
  return page.locator(selector).first().textContent();
}

test("a whole pack is taken without changing the mapping, and the details never say revised", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=7d`);
  const before = await calm(ctx);
  // The page's pack falls out of the bridge's window: the next poll answers with a whole pack (new generation).
  // The log is cleared BEFORE the pack changes: the page reads what it measured again as soon as it has taken the pack, which can
  // be before the test has seen the new cutoff.
  fake.clearLog();
  fake.holdPacks(1);
  fake.advance({ minutes: 1 });
  fake.advance({ minutes: 1 });
  const cutoff = await text(page, "#ol-cutoff");
  await expect.poll(async () => text(page, "#ol-cutoff"), { timeout: 20000, message: "the page took the new pack" }).not.toBe(cutoff);
  const after = await calm(ctx);
  expect(after.mappingId, "a whole pack keeps the mapping").toBe(before.mappingId);
  expect(after.fitSeq, "and fits nothing (Explore)").toBe(before.fitSeq);
  expect(fake.log().filter((e) => e.path === "/cube/tile" || e.path === "/cube/query").length, "what was measured before is read again").toBeGreaterThan(0);
  const details = await surface.details("cells");
  expect(field(details, "revisionStatus"), "it says the data was refreshed and that it does not know what changed").toBe("unknown");
  const opened = await surface.openLegendDetails("cells");
  expect(await opened.popover.textContent()).not.toMatch(/revised|verified revision/i);
  await opened.close().catch(() => {});
});

test("a held view tile: no calibration while it is held, and then the calibration of the complete data", async ({ page, fakeFor, probe, surface }) => {
  // The calibration of the same view, ungated, is the oracle: same data, same cohort, same mapping.
  const control = await fakeFor("standard");
  await page.goto(`${control.url}/${TILE_VIEW}`);
  const expected = await calm({ page, fake: control, probe, surface });
  expect(expected.mappingId).not.toBe("");
  expect(expected.effectiveN, "the view is drawn from its own tile").toBe("2");

  const fake = await fakeFor("standard");
  const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
  try {
    const other = await page.context().newPage();
    const { observe } = require("./observe.js");
    await other.goto(`${fake.url}/${TILE_VIEW}`);
    await gate.arrived();
    await other.waitForTimeout(1500);
    const held = (await observe(other).chip("cells")).data;
    expect(["no-calibration", "updating", "pending"], "no calibration while the tile is held").toContain(held.state);
    expect(held.mappingId).toBe("");
    gate.open();
    await fake.idle({ quietMs: 1500, timeoutMs: 30000 });
    await expect.poll(async () => (await observe(other).chip("cells")).data.mappingId, { timeout: 15000, message: "calibrated after release and settle" }).not.toBe("");
    const done = (await observe(other).chip("cells")).data;
    expect(done.mappingId, "the complete cohort: the same mapping as the ungated run").toBe(expected.mappingId);
    expect(done.fitSeq).toBe("1");
  } finally {
    gate.open();
  }
});

test("a tile that fails is told, calibrates nothing from a fragment, and the coarse fallback calibrates only its own context", async ({ page, fakeFor, probe, surface, allowConsole }) => {
  const fake = await fakeFor("standard");
  fake.on({ route: /^\/cube\/tile/ }).fail({ status: 503 });
  // every injected non-2xx logs one console line: it is the expected fault here
  allowConsole(/Failed to load resource/);
  await page.goto(`${fake.url}/${TILE_VIEW}`);
  await expect.poll(async () => text(page, "#ol-loading"), { timeout: 20000 }).toMatch(/Cube tile unavailable/);
  expect(await page.locator("#ol-loading").getAttribute("role"), "the failure is an alert").toBe("alert");
  await fake.idle({ quietMs: 1500, timeoutMs: 30000 });
  const frames = await probe.frames();
  // Nothing was ever painted with a mapping of the view's own (fine) level: the tile never arrived, so its cells were never a cohort.
  const fine = frames.filter((f) => f.attrs && f.attrs.cells && f.attrs.cells.effectiveN === "2" && f.attrs.cells.mappingId !== "");
  expect(fine, "no calibration of the fine context from a failed read").toEqual([]);
  const data = (await surface.chip("cells")).data;
  // The coarse block that covers the view is what is drawn: it calibrates its own (coarse) context, labelled by its level.
  if (data.mappingId !== "") {
    expect(Number(data.effectiveN), "a coarse context, not the requested one").toBeGreaterThan(2);
  }
});

// DD-T20: a failed read is asked again when the bridge has a new pack, with the same URL, and then calibrates.
test("after a failed tile, a rebuilt pack makes the page ask again and calibrate", async ({ page, fakeFor, probe, surface, allowConsole }) => {
  const fake = await fakeFor("standard");
  allowConsole(/Failed to load resource/);
  const rule = fake.on({ route: /^\/cube\/tile/, times: 1 }).fail({ status: 503 });
  await page.goto(`${fake.url}/${TILE_VIEW}`);
  await expect.poll(async () => text(page, "#ol-loading"), { timeout: 20000 }).toMatch(/Cube tile unavailable/);
  const failed = fake.log().filter((e) => e.path === "/cube/tile");
  expect(failed.length).toBe(1);
  expect(rule.hits).toBe(1);
  fake.rebuild();
  await expect.poll(() => fake.log().filter((e) => e.path === "/cube/tile").length, { timeout: 30000, message: "the tile is asked for again" }).toBeGreaterThan(1);
  const again = fake.log().filter((e) => e.path === "/cube/tile");
  expect(again[1].query, "with the same bounds").toEqual(failed[0].query);
  const data = await calm({ page, fake, probe, surface });
  expect(data.mappingId, "and the view calibrates").not.toBe("");
});

test("a revision (409 cube_changed) is recovered through a new pack and is not a failure", async ({ page, fakeFor, probe, surface, allowConsole }) => {
  const fake = await fakeFor("standard");
  // The 409 is the fake's own answer to a read under a superseded token and the browser logs it like any non-2xx: a zero-delay rule
  // on the read routes registers the fault with the console guard (which accepts that line only beside a rule) and changes nothing.
  fake.on({ route: /^\/cube\/(query|tile|columns|touched)/ }).delay(0);
  allowConsole(/Failed to load resource.*409/);
  await page.goto(`${fake.url}/#w=30d`);
  const before = await calm({ page, fake, probe, surface });
  fake.revise({ day: "2026-09-10", factor: 1.5 });
  // Something the page has not read yet: the read under the old token answers 409, the page takes the new pack first.
  await page.keyboard.press("9");
  const after = await calm({ page, fake, probe, surface });
  expect(after.mappingId, "a calibrated view after the recovery").not.toBe("");
  expect(await page.locator("#ol-loading").getAttribute("role"), "no failure notice").not.toBe("alert");
  expect(fake.log().filter((e) => e.status === 409).length, "the read under the old token was answered 409").toBeGreaterThan(0);
  const reloads = fake.log().filter((e) => e.path === "/cube/pack" && e.answer === "pack");
  expect(reloads.length, "the new pack was taken immediately").toBeGreaterThan(0);
  const opened = await surface.openLegendDetails("cells");
  expect(await opened.popover.textContent()).not.toMatch(/revised|verified revision/i);
  await opened.close().catch(() => {});
  void before;
});

// The open column and partial columns are not in the cohort (S1-081): the cohort is the reference's complete cells.
test("the open column is left out of the cohort", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const trades = tradesOf("standard");
  const from = "2026-09-23T12:00Z";
  const rows = priceRowsOf(trades, from, "2026-09-24T12:30Z");
  // a rectangle that ends after the cutoff 12:02 (base 3214082.13): its last level-4 column holds the open base column
  await page.goto(`${fake.url}/#t=${from}~2026-09-24T12:30Z&p=${rows[0] * 125}~${rows[1] * 125}&r=4,0`);
  const data = await calm({ page, fake, probe, surface });
  const cut = baseOf("2026-09-24T12:02Z");
  const lastComplete = Math.floor(Math.floor(cut) / 16) - 1;
  const cells = ref.cells(trades, { n: 4, m: 0, b0: baseOf(from), b1: Math.ceil(cut), r0: rows[0], r1: rows[1] }).filter((c) => c.v > 0);
  const members = cells.filter((c) => c.c <= lastComplete).length;
  expect(members, "the scenario has cells").toBeGreaterThan(20);
  expect(Number(field(await surface.details("cells"), "cohortCount")), "the cohort is the complete cells").toBe(members);
  expect(Number(field(await surface.details("cells"), "excludedCount")), "and the open ones are counted as left out").toBeGreaterThan(0);
  expect(data.mappingId).not.toBe("");
});

// Last-bit different sums (a delta-carried cell against a re-read one) must not mint a new mapping under Auto (DD-19).
test("equivalent reads keep the same mapping id under Auto colour", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  await page.goto(`${fake.url}/#w=24h&r=4,0`);
  await calm({ page, fake, probe, surface });
  const opened = await surface.openLegendDetails("cells");
  await opened.popover.getByRole("button", { name: /^Auto color/ }).focus();
  await page.keyboard.press("Enter");
  await opened.close().catch(() => {});
  const auto = await calm({ page, fake, probe, surface });
  expect(auto.policy).toBe("auto");
  fake.jitter(7);
  fake.rebuild();
  const cutoff = await text(page, "#ol-cutoff");
  fake.advance({ minutes: 1 });
  await expect.poll(async () => text(page, "#ol-cutoff"), { timeout: 20000 }).not.toBe(cutoff);
  const after = await calm({ page, fake, probe, surface });
  expect(after.mappingId, "no spurious new mapping for last-bit differences").toBe(auto.mappingId);
  // No change, no field: the list carries the scale-change fields only while the page has a change to announce.
  expect((await surface.details("cells")).fields.scaleChangeFrom?.value ?? "", "and no scale change is announced").toBe("");
});

test("provisional minutes replaced by the archive are said so; empty answers calibrate nothing", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  await page.goto(`${fake.url}/#w=30d`);
  const before = await calm({ page, fake, probe, surface });
  fake.setCanonicalThrough("2026-09-24T06:00Z");
  fake.advance({ minutes: 1 });
  await expect.poll(async () => field(await surface.details("cells"), "revisionStatus"), { timeout: 30000, message: "the archive replaced provisional minutes" }).toBe("provisional-replaced");
  expect((await calm({ page, fake, probe, surface })).mappingId, "the mapping is unchanged").toBe(before.mappingId);

  // Empty answers for the view's blocks (its tile and the rectangle's own measure): no cells, so nothing to calibrate from.
  const empty = await fakeFor("standard");
  empty.on({ route: /^\/cube\/(tile|query)/ }).empty();
  await page.goto(`${empty.url}/${TILE_VIEW}`);
  await empty.idle({ quietMs: 1500, timeoutMs: 30000 });
  await page.waitForTimeout(800);
  const fine = (await probe.frames()).filter((f) => f.attrs && f.attrs.cells && f.attrs.cells.effectiveN === "2" && f.attrs.cells.mappingId !== "");
  expect(fine, "an empty tile is no cohort").toEqual([]);
});

test("a corrupt stored calibration record does not stop the chart", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  await page.addInitScript(() => {
    try {
      localStorage.setItem("market-state-cube-explorer:scales:v1", '{"visualVersion":2,"contexts":[{"key":"x","ctx":{},"records":[{"broken":true}]}');
    } catch (error) {
      /* a document with no storage (about:blank) has nothing to seed */
    }
  });
  await page.goto(`${fake.url}/#w=24h`);
  const data = await calm({ page, fake, probe, surface });
  expect(data.mappingId, "the page drew and calibrated").not.toBe("");
  expect(data.state).toBe("ready");
});
