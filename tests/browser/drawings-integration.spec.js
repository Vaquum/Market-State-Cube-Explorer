"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const recorder = require("./pane-canvas.js");
test.use({ reducedMotion: "reduce" });

for (const theme of ["light", "dark"]) test(`manual ink survives Cells/Candles, Lens and Inspect on ${theme}; drawing edits add no data reads`, async ({ page, fakeFor, probe }) => {
  await recorder.addRecorder(page); const pane = recorder.forPage(page);
  const fake = await fakeFor("mini", { next: 300 }); await page.emulateMedia({ colorScheme: theme }); await D.open(page, fake);
  await probe.waitForReady(); await fake.idle({ quietMs: 500 });
  fake.clearLog(); const made = await D.drawing(page), original = await D.row(page, made.id);
  await D.edit(page, made.id); await page.locator("#ol-drawing-color").fill("#ff00ff"); await page.locator("#ol-drawing-apply").click();
  await D.closeManager(page); await fake.idle({ quietMs: 500 });
  expect(fake.log().filter((r) => r.slot === "cube" || r.slot === "motion"), "manual create/edit makes no cube or motion read").toEqual([]);
  const ink = async () => (await pane.last()).strokes.filter((s) => s.stroke === "#ff00ff" && s.width === 1.5 && s.path.length >= 2);
  await expect.poll(async () => (await ink()).length).toBeGreaterThan(0);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("k"); await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state", "ready");
  await expect.poll(async () => (await ink()).length).toBeGreaterThan(0);
  expect(await D.row(page, made.id)).toMatchObject({ id: made.id, a: original.a, b: original.b, color: "#ff00ff" });
  await page.keyboard.press("l"); const p = await D.plot(page), middle = D.point(p, .5, .5); await page.mouse.move(middle.x, middle.y);
  await expect(page.locator("#ol-lensbar")).toBeVisible(); await expect.poll(async () => (await ink()).length).toBeGreaterThan(0);
  await page.keyboard.press("e"); await page.mouse.click(middle.x, middle.y);
  await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "references");
  await expect(page.locator("#ol-inspect-reference")).toHaveValue("drawing|" + made.id);
  await expect(page.locator("#ol-inspect-readout")).toContainText(/Trend line|User drawing|Authored/i);
  expect(await D.count(page)).toBe(1); expect(await D.active(page)).toBe("");
});

test("replay disclosures use visible committed geometry and disappear when the line is hidden", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const made = await D.drawing(page);
  await page.evaluate(() => { const q = new URLSearchParams(location.hash.slice(1)); q.set("replay", "1"); q.set("at", "2026-09-23T21:00:00Z"); location.hash = q.toString(); });
  await expect(page.locator("#ol-drawing-replay-status").getByText("User drawings may include later analysis", { exact: true })).toBeVisible();
  await expect(page.locator("#ol-drawing-replay-status").getByText("User drawings extend beyond replay", { exact: true })).toBeVisible();
  await page.evaluate(() => { const q = new URLSearchParams(location.hash.slice(1)); q.set("t", "2026-09-23T12:00Z~2026-09-23T20:00Z"); location.hash = q.toString(); });
  await expect(page.locator("#ol-drawing-replay-status").getByText("User drawings may include later analysis", { exact: true })).toBeVisible();
  await expect(page.locator("#ol-drawing-replay-status").getByText("User drawings extend beyond replay", { exact: true })).toBeHidden();
  await D.action(page, made.id, "visible");
  await expect(page.locator("#ol-drawing-replay-status").getByText("User drawings may include later analysis", { exact: true })).toBeHidden();
  await expect(page.locator("#ol-drawing-replay-status").getByText("User drawings extend beyond replay", { exact: true })).toBeHidden();
  expect(await D.count(page)).toBe(1);
});


test("overlapping authored ink through Inspect Lens reaches both references without editing and leaves Lens cells reachable", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const made = await D.drawing(page);
  await D.action(page, made.id, "duplicate"); const duplicate = await D.active(page); await D.closeManager(page);
  const before = await D.rows(page);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("l");
  const p = await D.plot(page), middle = D.point(p, .5, .5); await page.mouse.move(middle.x, middle.y);
  await page.keyboard.press("e"); await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "lens");
  await page.mouse.click(middle.x, middle.y); const chooser = page.locator("#ol-inspect-chooser");
  await expect(chooser).toBeVisible();
  for (const id of [made.id, duplicate]) await expect(chooser.locator(`[data-ref="drawing|${id}"]`)).toBeVisible();
  await chooser.locator(`[data-ref="drawing|${made.id}"]`).click();
  await expect(page.locator("#ol-inspect-reference")).toHaveValue("drawing|" + made.id);
  await expect(page.locator("#ol-inspect-readout")).toContainText("Your drawing");
  await expect(page.locator("#ol-lens-pin")).toBeVisible();
  await page.mouse.click(middle.x, middle.y); await expect(chooser).toBeVisible(); await chooser.locator(`[data-ref="drawing|${duplicate}"]`).click();
  await expect(page.locator("#ol-inspect-reference")).toHaveValue("drawing|" + duplicate);
  expect(await D.active(page)).toBe(""); expect(await D.rows(page)).toEqual(before); expect(await D.count(page)).toBe(2);
  await page.locator('#ol-inspect [data-surface="lens"]').click();
  await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "lens");
  await expect(page.locator("#ol-inspect-position")).toContainText("Lens");
});
