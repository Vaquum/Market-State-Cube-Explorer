"use strict";
// replay.spec.js (S, B13): calibration in replay (TESTPLAN 3.4, DR-07, DR-16, DD-20, DD-47, D.14 walk-throughs 4 and 10).
//
// Requirement ids covered (API.md Appendix E): S1-140 (replay has its own workspace, live is untouched), S1-141 (eligibility is
// decided right after the cutoff is known), S1-142 (no frame paints a mapping fitted on observations after the edge; Play and
// scrubbing), S1-143 (an explicit lock is exempt and is labelled an external comparison override past the edge), S1-144 (a
// calendar period changes across its boundary), S1-117 (forward Play pauses Auto, Explore initialises once), S1-147 (the model
// status follows the edge), S1-149 (the provenance statement: original vintages are not guaranteed).
//
// The invariant that carries this file is the FRAME LOG (D.18 "Frame invariants"): the probe records, for every draw frame, the chip
// attributes written in that draw; the page writes the replay edge as text in the same update that precedes the draw (#ol-replay-at),
// which scale-helpers.edgeLogger() stamps with the real clock the probe uses; so for every frame in replay the test knows the edge
// and the chip's data-fit-through and asserts fit-through <= edge. A backward scrub, a level change that moves the edge back,
// Play and leaving replay all run under that one check.
//
// Oracle: the edge as the page prints it (the address sets the anchor and every step is one column of the level, so the expected
// edge of a phase is arithmetic on the address), and the comparison of ids across the live and the replay workspaces. No value is
// taken from the module.
//
// What needs another package: the popover (U) for the lock test and the provenance text, the model status (X/F2), the address and
// the portable code (P); Rows (R) for the calendar identity. Each fails by naming the missing element until it has merged.
//
// Not covered: the portable code's carrying of an override (B14), a rollover at the month or year (B10).
const { test, expect } = require("./fixtures.js");
const { calm, edgeLogger, framesWithEdge, popoverAction, field } = require("./scale-helpers.js");

const MINUTE = 60000;
const edgeOf = (iso) => Date.parse(iso);

async function withEdges(page) {
  const logger = edgeLogger(2026);
  await page.addInitScript(logger.install, logger.year);
}

// Every frame in the log that was painted in replay: its edge and the chip's fit-through. Fails with the first violation.
async function assertNoFutureFit(page, probe, what) {
  const frames = framesWithEdge(await probe.frames(), await page.evaluate(() => window.__edges));
  let seen = 0;
  for (const f of frames) {
    if (!f.cells || f.cells.workspace !== "replay" || f.edge === null) continue;
    seen += 1;
    if (f.cells.fitThrough === "") continue;
    if (Number(f.cells.fitThrough) > f.edge)
      throw new Error(`${what}: a replay frame painted mapping ${f.cells.mappingId} fitted through ${new Date(Number(f.cells.fitThrough)).toISOString()}, after its edge ${new Date(f.edge).toISOString()}`);
  }
  expect(seen, `${what}: the log holds replay frames to check`).toBeGreaterThan(5);
}

test("scrubbing back never paints a mapping fitted after the edge; leaving replay restores the live mapping", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await withEdges(page);
  await page.goto(`${fake.url}/#w=24h`);
  const live = await calm(ctx);
  expect(live.workspace).toBe("live");

  // Into replay, at a chosen anchor, inside the same page (the live workspace must survive it): the replay workspace has no
  // mapping yet, so it is calibrated from what existed then.
  await page.evaluate(() => {
    location.hash = "#w=24h&replay=1&at=2026-09-24T06:00Z";
  });
  const first = await calm(ctx);
  expect(first.workspace).toBe("replay");
  expect(Number(first.fitThrough), "fitted on observations up to the edge").toBeLessThanOrEqual(edgeOf("2026-09-24T06:00Z"));
  expect(first.mappingId).not.toBe("");

  // One column back: the record fitted through 06:00 cannot exist at 05:45. The chip says no calibration or the mapping of a
  // record that could have existed, never the later one.
  await page.keyboard.press(",");
  const second = await calm(ctx);
  expect(Number(second.fitThrough)).toBeLessThanOrEqual(edgeOf("2026-09-24T05:45Z"));
  // (Two cells fewer need not move the top and the median of a hundred: the identity may coincide, the calibration may not.)
  expect(Number(second.fitSeq), "a new calibration for the earlier edge").toBe(Number(first.fitSeq) + 1);
  expect(Number(second.fitThrough)).toBeLessThan(Number(first.fitThrough));

  // Twelve columns back in one burst, then forward again: frames in between are checked by the log.
  for (let i = 0; i < 12; i++) await page.keyboard.press(",");
  await calm(ctx);
  for (let i = 0; i < 12; i++) await page.keyboard.press(".");
  const forward = await calm(ctx);
  expect(Number(forward.fitThrough), "going forward keeps the newest mapping that could have existed").toBeLessThanOrEqual(edgeOf("2026-09-24T05:45Z"));

  // A level change that moves the edge back (the 7d window counts 2-hour columns: the edge is floored to that grid).
  await surface.pressPreset("7");
  await calm(ctx);

  await assertNoFutureFit(page, probe, "scrubbing and zooming in replay");

  // Leaving replay (a window key does: it returns to the live cutoff): the live workspace was never written, so its mapping is back.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await surface.pressPreset("6");
  const after = await calm(ctx);
  expect(after.workspace).toBe("live");
  expect(after.context, "the live context of the start").toBe(live.context);
  expect(after.mappingId, "the live mapping is exactly what it was").toBe(live.mappingId);
});

test("a live Comparison lock entering replay is an external comparison override, labelled when it reaches past the edge", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=24h`);
  const live = await calm(ctx);
  await popoverAction(page, surface, "cells", "Comparison lock");
  await calm(ctx);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("r");
  const data = await calm(ctx);
  expect(data.workspace).toBe("replay");
  expect(data.mappingId, "the lock is exempt from the edge rule: it still holds the live mapping").toBe(live.mappingId);
  expect(data.override, "and says so").toBe("external");
  expect(Number(data.fitThrough), "its observations end after the replay edge").toBeGreaterThan(Number(live.fitThrough) - 1);
  const details = await surface.details("cells");
  expect(details.warnings.map((w) => w.warning)).toEqual(expect.arrayContaining(["external-override", "override-after-edge"]));
  // The provenance statement of replay: currently available history, never "revised" or "verified".
  const opened = await surface.openLegendDetails("cells");
  await expect(opened.popover).toContainText(/original vintages not guaranteed/);
  expect(await opened.popover.textContent()).not.toMatch(/revised|verified revision/i);
  await opened.close().catch(() => {});
});

// Forward Play: Auto is paused (B08), Explore initialises once and then freezes (DR-16): no calibration lands while Play runs.
test("Play commits nothing after the first calibration of the replay context", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await withEdges(page);
  await page.clock.install({ time: Date.now() });
  await page.goto(`${fake.url}/#w=24h&replay=1&at=2026-09-24T06:00Z`);
  const start = await calm(ctx);
  await probe.waitForQuiet({ quietMs: 600 });
  await page.clock.pauseAt(Date.now() + 200);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Space");
  const seqs = new Set();
  for (let spent = 0; spent < 6000; spent += 50) {
    await page.clock.runFor(50);
    await fake.idle({ quietMs: 30 });
    seqs.add((await surface.chip("cells")).data.fitSeq);
  }
  expect(seqs.size, "Explore calibrates once and freezes while Play runs").toBeLessThanOrEqual(1);
  expect([...seqs][0]).toBe(start.fitSeq);
  await assertNoFutureFit(page, probe, "Play");
});

// D.14 walk-through 4: a scrub across Monday changes the calendar period of the Rows channel (R).
test("scrubbing across Monday changes the calendar identity of Rows", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=7d&rows=volume&period=wk&replay=1&at=2026-09-21T06:00Z`);
  const monday = await calm(ctx, { channel: "rows" });
  expect(monday.context).toContain("cal:wk:2026-09-21");
  // Six 2-hour columns back: Sunday evening, the previous calendar week.
  for (let i = 0; i < 6; i++) await page.keyboard.press(",");
  const sunday = await calm(ctx, { channel: "rows" });
  expect(sunday.context, "the week before").toContain("cal:wk:2026-09-14");
  expect(sunday.mappingId, "another period is another mapping").not.toBe(monday.mappingId);
});

// S1-147, S1-151: the model status follows the replay edge and is not a property of the scale's eligibility.
test("a scale fitted in replay before 2026-09-24 carries the retrospective model label", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=24h&replay=1&at=2026-09-20T06:00Z`);
  await calm(ctx);
  const details = await surface.details("cells");
  expect(field(details, "modelStatus"), "the replay edge is before the model was estimated").toBe("retrospective");
});
