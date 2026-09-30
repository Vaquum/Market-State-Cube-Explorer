"use strict";
// preset-context.spec.js (S, B06): presets, Fit and Auto against the calibration context (TESTPLAN 3.4, DR-06, DD-71, DD-74).
//
// Requirement ids covered (API.md Appendix E): S1-107 (Explore keeps the mapping of a context), S1-109 (Fit replaces the mapping
// only when activated), S1-111 (Auto refits the settled measurement; a same-context preset keeps the mapping and a
// level-changing one selects its own context, never borrowing the previous level's mapping), DD-71 (Value log and Value
// linear are two contexts), S1-163 (the curve is part of the address).
//
// Oracle: relations between observed values, as in B05: equality of context, id and counter across actions that must not
// change them, an increment of the counter by exactly one for an action that must fit, and the probe's frame log for what the
// page painted while it moved (every frame carries the chip attributes written in that same draw, D.18).
//
// What needs another package: the Scale section of the Cells menu (U) and the address (P) in the last test; the popover
// buttons Fit and Auto color (U). They fail by naming the missing element until those packages have merged.
//
// Not covered: Rows (B10), the lens (B12), replay (B13), the lock (B07).
const { test, expect } = require("./fixtures.js");
const { calm, gotoWindow, identity, field, popoverAction } = require("./scale-helpers.js");

// Every frame of the log that shows a mapping: its id and the context it was painted in. The one invariant of "no carry-over":
// an id belongs to ONE context (two contexts with the very same numbers would share an id, which a real view does not produce).
async function contextsOfIds(probe) {
  const byId = new Map();
  const empty = [];
  for (const frame of await probe.frames()) {
    const chip = frame.attrs && frame.attrs.cells;
    if (!chip) continue;
    if (!chip.mappingId) {
      empty.push({ context: chip.context, state: chip.state, updating: chip.updating });
      continue;
    }
    if (!byId.has(chip.mappingId)) byId.set(chip.mappingId, new Set());
    byId.get(chip.mappingId).add(chip.context);
  }
  return { byId, empty };
}

test("a preset that keeps the context keeps the mapping; Fit and Auto are what change it", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  // 1h, 30m and 15m are three windows of one effective level on this viewport.
  await page.goto(`${fake.url}/#w=1h`);
  const first = await calm(ctx);
  for (const name of ["2", "1"]) {
    await surface.pressPreset(name);
    const data = await calm(ctx);
    expect(data.context, `window key ${name} keeps the effective level`).toBe(first.context);
    expect(identity(data), `window key ${name}: the mapping and the counter are unchanged`).toEqual(identity(first));
  }

  // A warning or an open popover never changes the mapping: only an activation does.
  const details = await surface.details("cells");
  expect(field(details, "mappingId")).toBe(first.mappingId);
  expect(identity((await calm(ctx)))).toEqual(identity(first));

  // Fit, activated with the keyboard: exactly one new calibration of the same context.
  await popoverAction(page, surface, "cells", "Fit");
  let data = await calm(ctx);
  expect(data.context).toBe(first.context);
  expect(Number(data.fitSeq), "Fit calibrates once").toBe(Number(first.fitSeq) + 1);
  const afterFit = data;

  // Auto colour refits the settled data when the view changes inside the context; Explore would not.
  await popoverAction(page, surface, "cells", "Auto color");
  data = await calm(ctx);
  expect(data.policy).toBe("auto");
  const beforeAuto = Number(data.fitSeq);
  await surface.pressPreset("3");
  data = await calm(ctx);
  expect(data.context, "the same context").toBe(afterFit.context);
  expect(Number(data.fitSeq), "Auto refitted for the new view").toBeGreaterThan(beforeAuto);
});

test("an uncached context is No calibration and Updating, never the mapping of the level it came from", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=24h`);
  const home = await calm(ctx);
  // Wheel zoom out through levels nobody has visited.
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(60);
  }
  const data = await calm(ctx);
  expect(data.context, "the zoom moved to another context").not.toBe(home.context);
  expect(data.mappingId, "and it calibrated after the settle").not.toBe("");
  const { byId, empty } = await contextsOfIds(probe);
  for (const [id, contexts] of byId) expect(contexts.size, `mapping ${id} was painted in one context only (no carry-over)`).toBe(1);
  // While the new context waited for its fit the chart said so.
  const waiting = empty.filter((f) => f.context !== home.context);
  expect(waiting.length, "frames of an uncached context were painted without a mapping").toBeGreaterThan(0);
  for (const f of waiting) expect(["no-calibration", "updating", "pending"], `state while uncached: ${f.state}`).toContain(f.state);
  expect(waiting.some((f) => f.updating === "true"), "and they were marked updating").toBe(true);
});

// DD-71: the curve is part of the context, so linear and log never overwrite each other.
test("Value (linear) is another context than Value (log), and log comes back with its own mapping", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=24h`);
  const log = await calm(ctx);
  expect(log.transform).toBe("value-log");

  const choose = async (name) => {
    await page.locator("#ol-mode").click();
    await page.getByRole("menuitemradio", { name }).click();
    return calm(ctx);
  };
  const linear = await choose(/Value \(linear\)/);
  expect(linear.transform).toBe("value-linear");
  expect(linear.context, "another context").not.toBe(log.context);
  expect(linear.mappingId, "a new fit with a different mapping").not.toBe(log.mappingId);
  expect(Number(linear.fitSeq)).toBe(Number(log.fitSeq) + 1);
  // The curve is in the address (DD-71, S1-164) and survives a reload of the address.
  await expect.poll(() => page.url(), { message: "cv=l is written to the address" }).toMatch(/[#&]cv=l(&|$)/);

  const back = await choose(/Value \(log\)/);
  expect(back.context).toBe(log.context);
  expect(back.mappingId, "switching back restores the log mapping").toBe(log.mappingId);
  expect(Number(back.fitSeq), "and fits nothing").toBe(Number(linear.fitSeq));
});
