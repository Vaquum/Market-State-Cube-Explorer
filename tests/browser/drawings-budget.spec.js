"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const recorder = require("./pane-canvas.js");
test.use({ reducedMotion: "reduce" });
// 200 independently authored horizontal segments cover far more than the inherited
// persistent budget. Each RGB identifies one object in actual recorded strokes, so
// the DOM's Shown/Held back claims can be checked against paint rather than trusted.
test("max-count budget paint and inventory retain the same IDs; Focus recovers a held-back drawing", async ({ page, fakeFor }) => {
  await recorder.addRecorder(page); const pane = recorder.forPage(page), fake = await fakeFor("mini"); await D.open(page, fake);
  const payload = D.decodeCode(await D.copyCode(page)), objects = Array.from({ length: 200 }, (_, ordinal) => {
    const priceCents = 2460400 + ordinal * 396;
    return { id: `00000000-0000-4000-8000-${(ordinal + 1).toString(16).padStart(12, "0")}`, name: "Budget fixture " + ordinal,
      a: { timeMs: D.CAMERA.tA + 8640000, priceCents }, b: { timeMs: D.CAMERA.tB - 8640000, priceCents },
      color: "#ec" + ordinal.toString(16).padStart(2, "0") + "37", visible: true, locked: false, ordinal };
  });
  payload.drawings = { schemaVersion: 1, instrument: "binance:spot:BTCUSDT", visible: true, objects };
  await D.persistence.importCode(page, D.plainCode(payload)); await expect(page.locator("#ol-copy-status")).toHaveText("View restored"); await expect.poll(() => D.count(page)).toBe(200);
  await page.locator("#ol-canvas").press("t"); await D.lines(page); await D.plot(page);
  await expect.poll(async () => (await D.rows(page)).filter((r) => r.state === "Shown").length).toBeGreaterThan(0);
  await expect.poll(async () => (await D.rows(page)).filter((r) => r.state === "Held back").length).toBeGreaterThan(0);
  const rows = await D.rows(page), shown = rows.filter((r) => r.state === "Shown"), held = rows.filter((r) => r.state === "Held back");
  expect(held.length, "the over-budget scene actually suppresses objects").toBeGreaterThan(0); expect(shown.length + held.length).toBe(200);
  const colors = new Set(objects.map((o) => o.color)), painted = (await pane.last()).strokes.filter((s) => s.width === 1.5 && s.path.length === 2 && colors.has(s.stroke.toLowerCase())).map((s) => s.stroke.toLowerCase());
  expect([...new Set(painted)].sort(), "painted object IDs equal committed inventory claims").toEqual(shown.map((r) => r.color).sort());
  await D.action(page, held[0].id, "focus"); await D.closeManager(page); await D.lines(page); await D.plot(page); await expect.poll(async () => (await D.row(page, held[0].id)).state).toBe("Shown");
  await D.closeManager(page);
  await expect.poll(async () => (await pane.last()).strokes.some((s) => s.width === 1.5 && s.path.length === 2 && s.stroke.toLowerCase() === held[0].color)).toBe(true);
});
