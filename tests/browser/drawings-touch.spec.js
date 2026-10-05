"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 1, viewport: { width: 900, height: 820 }, reducedMotion: "reduce" });

test("touch drawing target holds never become Lens; blank Pan hold retains Lens and management has coarse targets", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const made = await D.drawing(page, [.25, .75], [.75, .25], { touch: true });
  const before = await D.row(page, made.id), client = await page.context().newCDPSession(page);
  const middle = { x: (made.A.x + made.B.x) / 2, y: (made.A.y + made.B.y) / 2 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [middle] });
  await page.waitForTimeout(550);
  expect(await page.locator("#ol-canvas").getAttribute("data-temporary") || "").not.toContain("lens:");
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await D.row(page, made.id)).toEqual(before);
  await D.pan(page); const blank = D.point(await D.plot(page), .12, .12);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [blank] });
  await expect.poll(async () => await page.locator("#ol-canvas").getAttribute("data-temporary") || "").toContain("lens:");
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => await page.locator("#ol-canvas").getAttribute("data-temporary") || "").not.toContain("lens:");
  await D.edit(page, made.id);
  for (const selector of ["#ol-drawing-name", "#ol-drawing-a-time", "#ol-drawing-a-price", "#ol-drawing-b-time", "#ol-drawing-b-price", "#ol-drawing-color", "#ol-drawing-apply", "#ol-drawing-cancel"]) {
    const box = await page.locator(selector).boundingBox(); expect(box.height, `${selector} is a coarse route`).toBeGreaterThanOrEqual(44);
  }
  await page.locator("#ol-drawing-cancel").click(); expect(await D.count(page)).toBe(1);
});

test("two-finger pinch interrupts a first draft and release creates no object; a later touch drag still commits once", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const client = await page.context().newCDPSession(page);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("g");
  const p = await D.plot(page), a = D.point(p, .3, .6), b = D.point(p, .7, .4);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...a, id: 1 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + 30, y: a.y - 10, id: 1 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...a, id: 1 }, { ...b, id: 2 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x - 50, y: a.y + 25, id: 1 }, { x: b.x + 50, y: b.y - 25, id: 2 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await D.count(page)).toBe(0);
  // Finish the queued pinch refit before measuring the next independent drag.
  await probe.waitForReady();
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.locator("#ol-canvas").focus(); await page.keyboard.press("g");
  await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  const now = await D.plot(page), start = D.point(now, .3, .6), end = D.point(now, .6, .3);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...end, id: 1 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const after = await D.plot(page), status = await page.locator("#ol-copy-status").textContent();
  await expect.poll(() => D.count(page), { message: "Touch recovery dimensions: " + JSON.stringify({ before: now, after, status }) }).toBe(1); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
});


test("Trend touch pickup of an inactive body or endpoint owns the first held gesture without creating another line", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const first = await D.drawing(page, [.25, .75], [.75, .75], { touch: true });
  const neighbor = await D.drawing(page, [.125, .25], [.625, .25], { touch: true }), client = await page.context().newCDPSession(page);
  const revision = () => page.locator("#ol-canvas").getAttribute("data-drawing-revision").then(Number);
  for (const [fromFraction, toFraction, expected] of [
    [[.5, .75], [.5625, .6875], { a: D.expected(.3125, .6875), b: D.expected(.8125, .6875) }],
    [[.3125, .6875], [.375, .5625], { a: D.expected(.375, .5625), b: D.expected(.8125, .6875) }],
  ]) {
    const p = await D.plot(page), select = D.point(p, .375, .25); await page.touchscreen.tap(select.x, select.y);
    await expect.poll(() => D.active(page)).toBe(neighbor.id);
    const from = D.point(p, ...fromFraction), to = D.point(p, ...toFraction), before = await D.row(page, first.id), beforeRevision = await revision();
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
    await expect.poll(() => D.active(page)).toBe(first.id);
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...to, id: 1 }] });
    expect(await D.row(page, first.id)).toEqual(before); expect(await revision()).toBe(beforeRevision);
    expect(await page.locator("#ol-canvas").getAttribute("data-temporary") || "").not.toContain("lens:");
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => D.row(page, first.id)).toMatchObject(expected);
    expect(await revision()).toBe(beforeRevision + 1); expect(await D.count(page)).toBe(2);
    if (fromFraction[0] === .5) {
      const after = await D.row(page, first.id);
      expect(after.b.timeMs - after.a.timeMs).toBe(before.b.timeMs - before.a.timeMs);
      expect(after.b.priceCents - after.a.priceCents).toBe(before.b.priceCents - before.a.priceCents);
    }
    await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  }
});
