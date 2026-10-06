"use strict";
// comparison-lock.spec.js (S, B07): the Comparison lock, one action (TESTPLAN 3.4, DR-07, DD-22, DD-65).
//
// Requirement ids covered (API.md Appendix E): S1-105 and S1-110 (a held mapping has a compatibility class; Cells and Rows hold
// their own mappings; an incompatible change falls back with a reason), S1-109 (the lock and Fit while locked), S1-114 (the lock
// freezes each displayed Auto axis at its domain), S1-120 (saturation is disclosed with its actual shares), S1-168 (a locked
// address restores in a fresh browser), A-17 (a manual domain).
//
// Oracle: for the shares, the exact-rational reference calculator (tests/reference) over the same trades the fake serves: the
// rectangle is cell-aligned at a pinned level (#...&r=n,m) and ends before the open column, so every cell is fully measured and
// every drawn mark has the same box, which makes the marks share and the area share the same number, outside / occupied. For the
// manual domain, E.scale.id of the typed numbers (a consistency check, stated as such). Everything else is a relation between
// observed values (equal id across levels, an increment of the counter by one for a Fit).
//
// What needs another package: the popover buttons and the Scale menu items (U), the Rows chip (R), the axis chips (X), the
// address (P). Each assertion that reads one fails by naming the missing element until that package has merged.
//
// Not covered: replay (B13), Auto timing (B08), the lens (B12).
const { test, expect } = require("./fixtures.js");
const { calm, go, identity, field, popoverAction, tradesOf, priceRowsOf, referenceShares } = require("./scale-helpers.js");

// Two cell-aligned rectangles over the last days of the `standard` profile: a FINE one (2-hour columns) to calibrate on, and a
// COARSE one (8-hour columns, four times the volume per cell) to look at under the lock.
const FINE = { from: "2026-09-22T00:00Z", to: "2026-09-23T00:00Z", n: 7, m: 0 };
const COARSE = { from: "2026-09-17T00:00Z", to: "2026-09-24T00:00Z", n: 9, m: 0 };

// The address of a rectangle: explicit times and prices (USDT, on the 125 grid) and a pinned level.
const hashOf = (r, rows) => `#t=${r.from}~${r.to}&p=${rows[0] * 125}~${rows[1] * 125}&r=${r.n},${r.m}`;

async function openFine({ page, fake, probe, surface }, rows) {
  await page.goto(`${fake.url}/${hashOf(FINE, rows)}`);
  return calm({ page, fake, probe, surface });
}

test("one action holds the mapping across levels and discloses the saturation with its actual shares", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  const trades = tradesOf("standard");
  const rows = priceRowsOf(trades, COARSE.from, COARSE.to);
  const fine = await openFine(ctx, rows);
  expect(fine.policy).toBe("explore");
  const U = Number(field(await surface.details("cells"), "U"));

  await popoverAction(page, surface, "cells", "Comparison lock");
  let data = await calm(ctx);
  expect(data.policy, "the lock holds what is on the chart").toBe("comparison");
  expect(data.mappingId).toBe(fine.mappingId);

  // The same mapping at another level: the lock keeps the id, and the clipping is reported instead of hidden.
  await go(page, hashOf(COARSE, rows));
  data = await calm(ctx);
  expect(data.effectiveN, "the level changed").toBe(String(COARSE.n));
  expect(data.policy).toBe("comparison");
  expect(data.mappingId, "the held mapping is the same").toBe(fine.mappingId);
  expect(Number(data.fitSeq), "nothing was fitted").toBe(Number(fine.fitSeq));

  const expected = referenceShares(trades, { ...COARSE, rows, U });
  expect(expected.outside, "the scenario saturates (otherwise it tests nothing)").toBeGreaterThan(0);
  // The warnings live in the chip's popover (D.18 "Details"): read them there, opening it the way a keyboard user does.
  await expect.poll(async () => (await surface.details("cells")).warnings.map((w) => w.warning), { message: "the range warning is shown" }).toContain("range-exceeded");
  const warning = (await surface.details("cells")).warnings.find((w) => w.warning === "range-exceeded");
  expect(Number(warning.shareMarks), "the share of marks outside the scale is the reference share").toBe(expected.share);
  expect(Math.abs(Number(warning.shareArea) - expected.share), "and so is the share of screen area").toBeLessThan(1e-9);
  const details = await surface.details("cells");
  expect(Number(field(details, "clipHighFinite")), "the count above the scale").toBe(expected.outside);
  expect(field(details, "support"), "the support of the held mapping is shown").not.toBe("");
});

test("Fit while locked replaces the held mapping and the lock stays on", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  const rows = priceRowsOf(tradesOf("standard"), COARSE.from, COARSE.to);
  await openFine(ctx, rows);
  await popoverAction(page, surface, "cells", "Comparison lock");
  await calm(ctx);
  await go(page, hashOf(COARSE, rows));
  const held = await calm(ctx);
  await popoverAction(page, surface, "cells", "Fit");
  const fitted = await calm(ctx);
  expect(fitted.policy, "the lock stays on").toBe("comparison");
  expect(Number(fitted.fitSeq), "one fit").toBe(Number(held.fitSeq) + 1);
  expect(fitted.mappingId, "the held mapping is the new one (a coarser level needs a higher top)").not.toBe(held.mappingId);
  // The new mapping is the held one from now on: another level keeps it.
  await go(page, hashOf(FINE, rows));
  const again = await calm(ctx);
  expect(again.mappingId).toBe(fitted.mappingId);
});

test("a change of basis under the lock falls back to Explore with a visible reason; unlock restores the policy", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  const rows = priceRowsOf(tradesOf("standard"), COARSE.from, COARSE.to);
  await openFine(ctx, rows);
  // Auto colour is the policy to come back to.
  await popoverAction(page, surface, "cells", "Auto color");
  expect((await calm(ctx)).policy).toBe("auto");
  await popoverAction(page, surface, "cells", "Comparison lock");
  const locked = await calm(ctx);
  expect(locked.policy).toBe("comparison");

  // Amount -> Intensity: the held mapping is of another basis, so this channel is Explore, and says why.
  await page.locator("#ol-mode").click();
  await page.locator('#ol-mode-menu [data-mode-step="basis"]').click();
  await page.getByRole("menuitemradio", { name: /Intensity/ }).click();
  await page.keyboard.press("Escape");
  const fallback = await calm(ctx);
  expect(fallback.policy, "no held mapping for the new basis: Explore").toBe("explore");
  const opened = await surface.openLegendDetails("cells");
  await expect(opened.popover).toContainText(/Not held by Comparison lock/);
  await opened.close();

  // Back to Amount: the held mapping is found again.
  await page.locator("#ol-mode").click();
  await page.locator('#ol-mode-menu [data-mode-step="basis"]').click();
  await page.getByRole("menuitemradio", { name: /^Amount/ }).click();
  await page.keyboard.press("Escape");
  const back = await calm(ctx);
  expect(back.policy).toBe("comparison");
  expect(back.mappingId).toBe(locked.mappingId);

  // Release: each channel's prior policy comes back (Auto colour), not a default.
  await popoverAction(page, surface, "cells", "Comparison lock");
  const released = await calm(ctx);
  expect(released.policy, "the policy before the lock").toBe("auto");
});

test("Cells and Rows hold their own mappings: a Cells manual domain leaves Rows alone", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=7d&rows=volume`);
  const cells = await calm(ctx);
  const rowsChip = await calm(ctx, { channel: "rows" });
  expect(rowsChip.mappingId, "Rows have a mapping of their own").not.toBe("");
  expect(rowsChip.mappingId, "unlocked, Cells and Rows never share an id").not.toBe(cells.mappingId);

  // A manual domain on Cells: typed U and k in the popover form. It holds ONE channel and does not engage the lock.
  const U = 123456.5;
  const k = 4321.25;
  const opened = await surface.openLegendDetails("cells");
  await opened.popover.getByLabel("U", { exact: true }).fill(String(U));
  await opened.popover.getByLabel("k", { exact: true }).fill(String(k));
  await opened.popover.getByRole("button", { name: /^Apply/ }).click();
  await opened.close().catch(() => {});
  const manual = await calm(ctx);
  const id = await page.evaluate(([u, kk]) => window.explorerEncoding.scale.id({ v: 1, kind: "value-log1p", signed: false, params: { U: u, k: kk }, clip: "clamp01@1" }), [U, k]);
  expect(manual.mappingId, "the id of the typed numbers").toBe(id);
  expect(manual.policy, "a manual domain is an explicit comparison, without the global lock").toBe("comparison");
  expect((await calm(ctx, { channel: "rows" })).mappingId, "Rows are untouched").toBe(rowsChip.mappingId);
});

test("the lock freezes every displayed Auto axis at its domain (Columns)", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=7d&r=7,0`);
  await calm(ctx);
  await expect.poll(async () => (await surface.chip("axis")).data.axisState, { message: "the Columns axis is Auto" }).toBe("auto");
  const before = (await surface.chip("axis")).data;
  await popoverAction(page, surface, "cells", "Comparison lock");
  await calm(ctx);
  const after = (await surface.chip("axis")).data;
  expect(after.axisState).toBe("frozen");
  expect(after.domain, "frozen at the domain that was displayed").toBe(before.domain);
  // A gesture that would refit an Auto axis leaves it where it was.
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await calm(ctx);
  expect((await surface.chip("axis")).data.domain).toBe(before.domain);
});

test("a locked address restores the lock, the held mapping and the frozen domains in a fresh browser", async ({ page, fakeFor, probe, surface, openLink }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=7d&r=7,0`);
  const before = await calm(ctx);
  await popoverAction(page, surface, "cells", "Comparison lock");
  const locked = await calm(ctx);
  const axis = (await surface.chip("axis")).data;
  const address = page.url();
  expect(address, "the lock is in the address").toMatch(/[#&]lk=1(&|$)/);
  const other = await openLink(address);
  const { observe } = require("./observe.js");
  const fresh = observe(other);
  await other.waitForTimeout(1500);
  const data = (await fresh.chip("cells")).data;
  expect(data.policy).toBe("comparison");
  expect(data.mappingId, "the held mapping travels by its descriptor").toBe(locked.mappingId);
  expect(data.mappingId).toBe(before.mappingId);
  expect((await fresh.chip("axis")).data.domain, "and so does the frozen axis").toBe(axis.domain);
});
