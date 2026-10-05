"use strict";
// Observes production DOM and documented portable JSON. Expected geometry is independent
// affine interpolation of the explicitly pinned camera; no src/ drawing helper is imported.
const { expect } = require("@playwright/test");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const persistence = require("./persistence-support.js");
const CAMERA = Object.freeze({
  tA: Date.parse("2026-09-23T12:00:00Z"), tB: Date.parse("2026-09-24T12:00:00Z"),
  pA: 2460000, pB: 2540000,
});
const HASH = "#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=24600~25400&r=4,0&vis=2";
async function ready(page) {
  await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /\d/);
  await expect(page.locator("#ol-trend")).toBeVisible();
  await expect.poll(() => page.locator("#ol-canvas").getAttribute("data-drawing-count")).toMatch(/^\d+$/);
}
async function open(page, fake, extra = "") {
  await page.goto(fake.url + "/" + HASH + extra);
  await ready(page);
}
async function plot(page) {
  // Toolbars can change plot height between Trend placement and committed Pan.
  // Read the rendered layout after ResizeObserver and the next paint have settled.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.locator("#ol-canvas").evaluate((n) => {
    const [x, y, width, height] = n.dataset.layout.split(",").map(Number), box = n.getBoundingClientRect();
    return { x: x + box.x, y: y + box.y, width, height, localX: x, localY: y };
  });
}
const point = (p, fx, fy) => ({ x: p.x + p.width * fx, y: p.y + p.height * fy });
const expected = (fx, fy) => ({ timeMs: Math.round(CAMERA.tA + (CAMERA.tB - CAMERA.tA) * fx), priceCents: Math.round(CAMERA.pA + (CAMERA.pB - CAMERA.pA) * (1 - fy)) });
async function count(page) { return Number(await page.locator("#ol-canvas").getAttribute("data-drawing-count")); }
async function active(page) { return page.locator("#ol-canvas").getAttribute("data-drawing-active"); }
async function rows(page) {
  return page.locator("[data-drawing-row]").evaluateAll((nodes) => nodes.map((n) => ({
    id: n.dataset.drawingRow, name: n.dataset.name, color: n.dataset.color,
    visible: n.dataset.visible === "true", locked: n.dataset.locked === "true", state: n.dataset.state,
    a: { timeMs: Number(n.dataset.aTimeMs), priceCents: Number(n.dataset.aPriceCents) },
    b: { timeMs: Number(n.dataset.bTimeMs), priceCents: Number(n.dataset.bPriceCents) },
  })));
}
async function row(page, id) { return (await rows(page)).find((r) => r.id === id); }
async function manager(page) {
  if (await page.locator("#ol-lines-pop").isHidden()) await page.locator("#ol-lines").click();
  await expect(page.locator("#ol-drawing-section")).toBeVisible();
}
async function closeManager(page) { if (await page.locator("#ol-lines-pop").isVisible()) await page.keyboard.press("Escape"); }
async function action(page, id, command) {
  await manager(page);
  const target = page.locator(`[data-drawing-row="${id}"] [data-drawing-action="${command}"]`);
  if (await target.isHidden()) await page.locator(`[data-drawing-row="${id}"] summary`).click();
  await target.click();
}
async function drawing(page, a = [.25, .75], b = [.75, .25], { drag = false, touch = false } = {}) {
  await closeManager(page);
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("g");
  await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  const p = await plot(page), A = point(p, ...a), B = point(p, ...b), n = await count(page);
  if (touch) {
    await page.touchscreen.tap(A.x, A.y);
    await page.touchscreen.tap(B.x, B.y);
  } else if (drag) {
    await page.mouse.move(A.x, A.y); await page.mouse.down();
    await page.mouse.move(B.x, B.y, { steps: 6 }); await page.mouse.up();
  } else {
    await page.mouse.click(A.x, A.y); await page.mouse.move(B.x, B.y); await page.mouse.click(B.x, B.y);
  }
  await expect.poll(() => count(page)).toBe(n + 1);
  const id = await active(page);
  expect(id, "new committed object is active").toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
  const committedPlot = await plot(page);
  return { id, A: point(committedPlot, ...a), B: point(committedPlot, ...b), p: committedPlot };
}
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
}
async function edit(page, id) {
  await action(page, id, "edit");
  await expect(page.locator("#ol-drawing-editor")).toBeVisible();
}
function decodeCode(code) {
  const match = /^origo-cube:(3)(j?)\.(.*)$/.exec(code);
  if (!match) throw new Error("complete drawing code must use outer version 3");
  const json = match[2] ? decodeURIComponent(match[3]) : zlib.gunzipSync(Buffer.from(match[3], "base64url")).toString("utf8");
  return JSON.parse(json);
}
function plainCode(payload) {
  const body = { ...payload }; delete body.id;
  const canonical = (x) => Array.isArray(x) ? "[" + x.map(canonical).join(",") + "]" : x && typeof x === "object" ? "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}" : JSON.stringify(x);
  const id = crypto.createHash("sha256").update(canonical(body), "utf8").digest().subarray(0, 12).toString("base64url");
  return "origo-cube:3j." + encodeURIComponent(JSON.stringify({ ...body, id }));
}
async function copyCode(page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await persistence.openQuery(page);
  await page.locator("#ol-copy-view").click();
  await expect.poll(() => persistence.clipboardText(page)).toMatch(/^origo-cube:3j?\./);
  return persistence.clipboardText(page);
}
module.exports = { CAMERA, HASH, ready, open, plot, point, expected, count, active, rows, row, manager, closeManager, action, drawing, drag, edit, decodeCode, plainCode, copyCode, persistence };
