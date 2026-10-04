"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
test.use({ reducedMotion: "reduce" });

test("G creates continuous anchors once, returns to Pan, and moves endpoints and body without changing the vector", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const { id, A, B, p } = await D.drawing(page);
  const original = await D.row(page, id);
  expect(original.a).toEqual(D.expected(.25, .75)); expect(original.b).toEqual(D.expected(.75, .25));
  expect(new URL(page.url()).hash, "authored coordinates stay outside chart links").not.toMatch(/drawing|00000000|Trend/);
  const movedA = { x: A.x + p.width / 16, y: A.y - p.height / 16 };
  await D.drag(page, A, movedA);
  await expect.poll(async () => (await D.row(page, id)).a).toEqual(D.expected(.3125, .6875));
  expect((await D.row(page, id)).b, "A adjustment preserves B exactly").toEqual(original.b);
  const beforeBody = await D.row(page, id), middle = { x: (movedA.x + B.x) / 2, y: (movedA.y + B.y) / 2 };
  await D.drag(page, middle, { x: middle.x + 36, y: middle.y - 18 });
  await expect.poll(async () => (await D.row(page, id)).a).not.toEqual(beforeBody.a);
  const translated = await D.row(page, id);
  expect(translated.b.timeMs - translated.a.timeMs).toBe(beforeBody.b.timeMs - beforeBody.a.timeMs);
  expect(translated.b.priceCents - translated.a.priceCents).toBe(beforeBody.b.priceCents - beforeBody.a.priceCents);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => D.row(page, id)).toEqual(beforeBody);
  await page.keyboard.press("ControlOrMeta+Shift+z"); await expect.poll(() => D.row(page, id)).toEqual(translated);
  await D.drawing(page, [.15, .2], [.35, .4], { drag: true }); expect(await D.count(page)).toBe(2);
});

test("draft Undo, Escape, mode switch and late release never commit a canceled transaction", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  let p = await D.plot(page), a = D.point(p, .25, .75), b = D.point(p, .75, .25);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("g"); await page.mouse.click(a.x, a.y);
  await page.keyboard.press("ControlOrMeta+z"); await page.mouse.click(b.x, b.y);
  expect(await D.count(page), "Undo on first draft leaves no object").toBe(0);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  const made = await D.drawing(page), before = await D.row(page, made.id);
  await page.mouse.move(made.A.x, made.A.y); await page.mouse.down(); await page.mouse.move(made.A.x + 40, made.A.y - 20);
  await page.keyboard.press("Escape"); await page.mouse.up(); expect(await D.row(page, made.id)).toEqual(before);
  await page.mouse.move(made.B.x, made.B.y); await page.mouse.down(); await page.mouse.move(made.B.x - 30, made.B.y + 20);
  await page.keyboard.press("k"); await page.mouse.up();
  await expect(page.locator("#ol-mode-text")).toHaveText("Candles"); expect(await D.row(page, made.id)).toEqual(before);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("g");
  p = await D.plot(page); a = D.point(p, .2, .2); b = D.point(p, .5, .5);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y);
  await page.setViewportSize({ width: 1420, height: 910 }); await page.mouse.up();
  expect(await D.count(page), "resize invalidates the held drag release").toBe(1); expect(await D.row(page, made.id)).toEqual(before);
});

test("exact edit is atomic; fields own native Undo; lock and hide block canvas ownership; explicit Delete remains undoable", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page), before = await D.row(page, id);
  await D.edit(page, id); await page.locator("#ol-drawing-name").fill("Exact annotation");
  await page.locator("#ol-drawing-a-time").fill("2026-02-30T00:00:00Z"); await page.locator("#ol-drawing-apply").click();
  await expect(page.locator("#ol-drawing-editor")).toBeVisible(); expect(await D.row(page, id)).toEqual(before);
  await page.locator("#ol-drawing-a-time").fill("2026-09-23T16:00:00.123Z"); await page.locator("#ol-drawing-a-price").fill("24800.25");
  await page.locator("#ol-drawing-b-time").fill("2026-09-24T04:00:00.456Z"); await page.locator("#ol-drawing-b-price").fill("25100.75");
  await page.locator("#ol-drawing-color").fill("#Aa00Ff"); await page.locator("#ol-drawing-apply").click();
  await expect(page.locator("#ol-drawing-editor")).toBeHidden();
  const applied = await D.row(page, id); expect(applied).toMatchObject({ name: "Exact annotation", color: "#aa00ff", a: { timeMs: Date.parse("2026-09-23T16:00:00.123Z"), priceCents: 2480025 }, b: { timeMs: Date.parse("2026-09-24T04:00:00.456Z"), priceCents: 2510075 } });
  await D.edit(page, id); await page.locator("#ol-drawing-name").focus(); await page.keyboard.press("End"); await page.keyboard.type(" typed");
  await page.keyboard.press("ControlOrMeta+z"); await expect(page.locator("#ol-drawing-name")).toHaveValue("Exact annotation"); expect(await D.row(page, id)).toEqual(applied);
  await page.locator("#ol-drawing-cancel").click(); expect(await D.row(page, id)).toEqual(applied);
  await D.action(page, id, "lock"); await D.edit(page, id);
  for (const key of ["a-time", "a-price", "b-time", "b-price"]) await expect(page.locator("#ol-drawing-" + key)).toBeDisabled();
  await page.locator("#ol-drawing-cancel").click(); await D.closeManager(page); await page.locator("#ol-canvas").focus(); await page.keyboard.press("Delete"); expect(await D.count(page)).toBe(1);
  await D.action(page, id, "visible"); expect(await D.active(page)).toBe("");
  expect((await D.row(page, id)).visible).toBe(false);
  await D.action(page, id, "delete"); await expect.poll(() => D.count(page)).toBe(0);
  await page.locator("#ol-drawing-section").getByRole("button", { name: /^Undo/ }).click(); await expect.poll(() => D.count(page)).toBe(1);
  expect(await D.row(page, id)).toMatchObject({ id, name: applied.name, color: applied.color, a: applied.a, b: applied.b, locked: true, visible: false });
});

test("chart Delete retains drawing Undo ownership, duplicate chooser reaches siblings and evidence anchoring", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const { id, A, B } = await D.drawing(page);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("Delete"); await expect.poll(() => D.count(page)).toBe(0);
  await page.keyboard.press("ControlOrMeta+z"); await expect.poll(() => D.count(page)).toBe(1);
  await D.action(page, id, "duplicate"); const duplicate = await D.active(page); expect(duplicate).not.toBe(id);
  await D.closeManager(page); const middle = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  await page.mouse.click(middle.x, middle.y); await expect(page.locator("#ol-drawing-chooser")).toBeVisible();
  await expect(page.locator("#ol-drawing-chooser")).toContainText("Trend line");
  await page.locator("#ol-drawing-chooser").getByRole("button", { name: /Anchor evidence here/ }).click();
  await expect(page.locator("#ol-drawing-chooser")).toBeHidden();
  await expect.poll(() => new URL(page.url()).hash).toContain("at=");
  expect(await D.count(page)).toBe(2);
});

test("coincident B keeps A for correction and explicit Keep drawing retains Trend until disabled", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); await page.locator("#ol-canvas").focus(); await page.keyboard.press("g");
  const p = await D.plot(page), a = D.point(p, .25, .75), b = D.point(p, .75, .25);
  await page.mouse.click(a.x, a.y); await page.mouse.click(a.x, a.y);
  expect(await D.count(page)).toBe(0); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(b.x, b.y); await expect.poll(() => D.count(page)).toBe(1);
  expect((await D.rows(page))[0].a).toEqual(D.expected(.25, .75));
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("g"); await page.locator("#ol-drawing-keep").check();
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y); await expect.poll(() => D.count(page)).toBe(2);
  await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#ol-drawing-keep").uncheck(); await page.locator("#ol-canvas").focus(); await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await expect.poll(() => D.count(page)).toBe(3); await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
});

test("keyboard Coordinates creates only on Apply; Cancel commits nothing; native checkbox Space leaves replay paused", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake, "&replay=1&at=2026-09-23T21:00Z");
  await page.locator("#ol-lines").focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#ol-drawing-section")).toBeVisible();
  await page.locator("#ol-drawing-group-visible").focus(); const play = await page.locator("#ol-play").getAttribute("aria-pressed");
  await page.keyboard.press("Space"); await expect(page.locator("#ol-drawing-group-visible")).not.toBeChecked(); await expect(page.locator("#ol-play")).toHaveAttribute("aria-pressed", play);
  await page.locator("#ol-drawing-new-exact").focus(); await page.keyboard.press("Enter"); await expect(page.locator("#ol-drawing-editor")).toBeVisible();
  expect(await D.count(page)).toBe(0); await page.locator("#ol-drawing-cancel").focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#ol-drawing-editor")).toBeHidden(); expect(await D.count(page)).toBe(0); await expect(page.locator("#ol-drawing-new-exact")).toBeFocused();
  await page.keyboard.press("Enter");
  for (const [key, value] of Object.entries({ name: "Keyboard authored", "a-time": "2026-09-23T16:00:00.123Z", "a-price": "24800.25", "b-time": "2026-09-24T04:00:00.456Z", "b-price": "25100.75", color: "#123456" })) {
    await page.locator("#ol-drawing-" + key).focus(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type(value);
  }
  await page.locator("#ol-drawing-apply").focus(); await page.keyboard.press("Enter"); await expect.poll(() => D.count(page)).toBe(1);
  expect((await D.rows(page))[0]).toMatchObject({ name: "Keyboard authored", color: "#123456", a: { timeMs: Date.parse("2026-09-23T16:00:00.123Z"), priceCents: 2480025 }, b: { timeMs: Date.parse("2026-09-24T04:00:00.456Z"), priceCents: 2510075 } });
  await page.locator("#ol-drawing-undo").focus(); await page.keyboard.press("Enter"); await expect.poll(() => D.count(page)).toBe(0); await expect(page.locator("#ol-drawing-group-visible")).not.toBeChecked();
});


test("Alt pressed during creation, endpoint and body drags retains drawing ownership and commits once", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const revision = async () => Number(await page.locator("#ol-canvas").getAttribute("data-drawing-revision"));
  const lensRegion = async () => await page.locator("#ol-canvas").getAttribute("data-temporary") || "";
  const heldAltDrag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.keyboard.down("Alt");
    await page.mouse.move(to.x, to.y, { steps: 6 });
    expect(await lensRegion(), "Alt cannot replace an established drawing owner").not.toContain("lens:");
    await page.mouse.up(); await page.keyboard.up("Alt");
  };
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("g");
  let p = await D.plot(page); const a = D.point(p, .25, .75), b = D.point(p, .75, .25);
  const beforeCreate = await revision(); await heldAltDrag(a, b);
  await expect.poll(() => D.count(page)).toBe(1); expect(await revision()).toBe(beforeCreate + 1);
  const id = await D.active(page); expect(await D.row(page, id)).toMatchObject({ a: D.expected(.25, .75), b: D.expected(.75, .25) });
  p = await D.plot(page);
  const beforeEndpoint = await revision(), committedA = D.point(p, .25, .75), movedA = D.point(p, .3125, .6875);
  await heldAltDrag(committedA, movedA); expect(await revision()).toBe(beforeEndpoint + 1);
  expect(await D.row(page, id)).toMatchObject({ a: D.expected(.3125, .6875), b: D.expected(.75, .25) });
  const beforeBody = await D.row(page, id), beforeTranslate = await revision();
  const center = D.point(p, .53125, .46875); await heldAltDrag(center, D.point(p, .5625, .4375));
  expect(await revision()).toBe(beforeTranslate + 1);
  const translated = await D.row(page, id);
  expect(translated.a).toEqual(D.expected(.34375, .65625)); expect(translated.b).toEqual(D.expected(.78125, .21875));
  expect(translated.b.timeMs - translated.a.timeMs).toBe(beforeBody.b.timeMs - beforeBody.a.timeMs);
  expect(translated.b.priceCents - translated.a.priceCents).toBe(beforeBody.b.priceCents - beforeBody.a.priceCents);
  await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
  const blank = D.point(p, .125, .125); await page.mouse.move(blank.x, blank.y); await page.keyboard.down("Alt");
  await page.mouse.move(blank.x + 1, blank.y); await expect.poll(lensRegion).toContain("lens:");
  await page.keyboard.up("Alt"); await expect.poll(lensRegion).not.toContain("lens:");
  expect(await D.count(page)).toBe(1); expect(await revision()).toBe(beforeTranslate + 1);
});

test("G from focused tool buttons toggles Trend and returns to the entry tool while native text stays owned", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  for (const previous of ["pan", "select", "lens"]) {
    const button = page.locator(`[data-tool="${previous}"]`); await button.click(); await expect(button).toBeFocused();
    await page.keyboard.press("g"); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("g"); await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "false");
  }
  await page.locator('[data-tool="pan"]').click(); await D.manager(page); await page.locator("#ol-drawing-new-exact").click();
  const input = page.locator("#ol-drawing-name"), before = await input.inputValue();
  await input.focus(); await page.keyboard.press("End"); await page.keyboard.press("g");
  await expect(input).toHaveValue(before + "g"); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#ol-drawing-cancel").click(); expect(await D.count(page)).toBe(0);
});

test("draft toolbar reports exact A and preview B without committing either before placement", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); await page.locator("#ol-canvas").focus(); await page.keyboard.press("g");
  const p = await D.plot(page), a = D.point(p, .25, .75), b = D.point(p, .75, .25);
  await page.mouse.click(a.x, a.y); await page.mouse.move(b.x, b.y);
  for (const exact of ["A · 2026-09-23T18:00:00.000Z · 24800.00 USDT", "B · 2026-09-24T06:00:00.000Z · 25200.00 USDT"])
    await expect(page.locator("#ol-drawing-toolbar-status")).toContainText(exact);
  expect(await D.count(page)).toBe(0); expect(await D.rows(page)).toEqual([]);
  await expect(page.locator("#ol-canvas")).toHaveAttribute("data-drawing-revision", "0");
  await page.keyboard.press("Escape"); expect(await D.count(page)).toBe(0);
  await expect(page.locator("#ol-drawing-toolbar-status")).not.toContainText("2026-09-23T18:00:00.000Z");
});


test("held ArrowRight repeats camera movement before and after drawing activity while held G toggles once", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const camera = async () => D.persistence.param(new URL(page.url()).hash, "t");
  const repeatPan = async () => {
    await page.locator("#ol-canvas").focus(); const before = await camera();
    await page.keyboard.down("ArrowRight"); await expect.poll(camera).not.toBe(before); const first = await camera();
    await page.keyboard.down("ArrowRight"); await expect.poll(camera).not.toBe(first); await page.keyboard.up("ArrowRight");
    const times = [before, first, await camera()].map((range) => range.split("~").map((value) => Date.parse(value)));
    expect(times[1][0]).toBeGreaterThan(times[0][0]); expect(times[2][0]).toBeGreaterThan(times[1][0]);
    expect(times[2][1] - times[2][0]).toBe(times[0][1] - times[0][0]);
  };
  await repeatPan(); expect(await D.count(page)).toBe(0);
  const made = await D.drawing(page); const object = await D.row(page, made.id); await repeatPan();
  expect(await D.row(page, made.id)).toEqual(object);
  await page.keyboard.down("g"); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.down("g"); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("g"); await page.keyboard.press("g"); await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
});
