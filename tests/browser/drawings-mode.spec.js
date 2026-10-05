"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
test.use({ reducedMotion: "reduce" });
const revision = (page) => page.locator("#ol-canvas").getAttribute("data-drawing-revision").then(Number);
const collection = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("market-state-cube-explorer:drawings:v1:session")).collection);
const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
async function project(page, anchor) {
  const p = await D.plot(page), hash = new URLSearchParams(new URL(page.url()).hash.slice(1));
  const utc = (text) => Date.parse(/Z$/.test(text) ? text : text + "Z"), [ta, tb] = hash.get("t").split("~").map(utc), [pa, pb] = hash.get("p").split("~").map(Number);
  return D.point(p, (anchor.timeMs - ta) / (tb - ta), (pb - anchor.priceCents / 100) / (pb - pa));
}
async function strokePoint(page, id) {
  const row = await D.row(page, id); return middle(await project(page, row.a), await project(page, row.b));
}
async function heldEdit(page, id, from, to, expected) {
  const before = await D.row(page, id), beforeRevision = await revision(page), beforeCount = await D.count(page);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await expect.poll(() => D.active(page)).toBe(id);
  expect(await D.row(page, id), "pointerdown selects without committing geometry").toEqual(before);
  await page.mouse.move(to.x, to.y, { steps: 6 });
  expect(await D.row(page, id), "held preview is not a committed edit").toEqual(before);
  expect(await revision(page)).toBe(beforeRevision);
  await page.mouse.up(); await expect.poll(() => D.row(page, id)).toMatchObject(expected);
  expect(await revision(page)).toBe(beforeRevision + 1); expect(await D.count(page)).toBe(beforeCount);
  await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
}

test("inactive body and either endpoint select and edit during the same held pointer gesture, including a visible card", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const first = await D.drawing(page, [.2, .7], [.7, .7]), neighbor = await D.drawing(page, [.15, .25], [.6, .25]);
  expect(await D.active(page)).toBe(neighbor.id);
  let p = await D.plot(page), from = D.point(p, .45, .7);
  await page.mouse.move(from.x, from.y); await expect(page.locator("#ol-tip")).toBeVisible();
  await heldEdit(page, first.id, from, D.point(p, .5125, .6375), { a: D.expected(.2625, .6375), b: D.expected(.7625, .6375) });
  for (const [endpoint, fraction] of [["a", [.3, .55]], ["b", [.8, .5]]]) {
    const other = await strokePoint(page, neighbor.id); await page.mouse.click(other.x, other.y);
    await expect.poll(() => D.active(page)).toBe(neighbor.id);
    const before = await D.row(page, first.id), untouched = endpoint === "a" ? "b" : "a";
    p = await D.plot(page); from = await project(page, before[endpoint]);
    await heldEdit(page, first.id, from, D.point(p, ...fraction), { [endpoint]: D.expected(...fraction), [untouched]: before[untouched] });
  }
});

test("Pan treats authored ink as read-only across clicks, double click, secondary click, Delete and navigation drags", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const made = await D.drawing(page);
  await D.pan(page); await D.lines(page);
  const visibility = page.locator(`[data-drawing-row="${made.id}"] input[data-drawing-action="visible"]`);
  await visibility.focus(); await page.keyboard.press("Space"); await expect(visibility).not.toBeChecked();
  expect((await D.row(page, made.id)).visible).toBe(false); await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space"); await expect(visibility).toBeChecked();
  await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true"); await D.closeManager(page);
  const before = await collection(page), beforeRevision = await revision(page);
  let center = await strokePoint(page, made.id); await page.mouse.click(center.x, center.y);
  expect(await D.active(page)).toBe(""); expect(await collection(page)).toEqual(before);
  center = await strokePoint(page, made.id); await page.mouse.dblclick(center.x, center.y);
  await expect(page.locator("#ol-drawing-editor")).toBeHidden(); expect(await D.active(page)).toBe("");
  center = await strokePoint(page, made.id); await page.mouse.click(center.x, center.y, { button: "right" });
  await expect(page.locator("#ol-drawing-context")).toHaveCount(0);
  await page.keyboard.press("Escape"); await page.locator("#ol-canvas").focus();
  for (const key of ["Delete", "Enter", "ControlOrMeta+z"]) {
    await page.keyboard.press(key); expect(await collection(page)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
    await expect(page.locator("#ol-drawing-editor")).toBeHidden(); await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
  }
  center = await strokePoint(page, made.id); const camera = new URL(page.url()).hash;
  await D.drag(page, center, { x: center.x + 35, y: center.y - 20 });
  await expect.poll(() => new URL(page.url()).hash).not.toBe(camera);
  const endpoint = await project(page, before.objects[0].a);
  await D.drag(page, endpoint, { x: endpoint.x + 25, y: endpoint.y + 15 });
  expect(await collection(page)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
  expect(await D.active(page)).toBe(""); await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
});

test("Trend secondary click offers Delete line without deleting; explicit locked deletion is undoable and blank space has no drawing menu", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const made = await D.drawing(page);
  await D.action(page, made.id, "lock"); await D.closeManager(page);
  const before = await D.row(page, made.id), beforeRevision = await revision(page), center = await strokePoint(page, made.id);
  await D.drag(page, center, { x: center.x + 25, y: center.y - 15 });
  expect(await D.row(page, made.id)).toEqual(before); expect(await D.count(page)).toBe(1); expect(await revision(page)).toBe(beforeRevision);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("Delete");
  expect(await D.row(page, made.id)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
  await page.mouse.click(center.x, center.y, { button: "right" });
  const menu = page.locator("#ol-drawing-context"); await expect(menu).toBeVisible(); await expect(menu).toHaveAttribute("role", "menu");
  const remove = menu.getByRole("menuitem", { name: "Delete line", exact: true }); await expect(remove).toBeVisible();
  expect(await D.row(page, made.id)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
  await menu.getByRole("menuitem", { name: "Edit line", exact: true }).click();
  await expect(page.locator("#ol-drawing-editor")).toBeVisible(); await expect(page.locator("#ol-drawing-a-time")).toBeDisabled();
  await page.locator("#ol-drawing-cancel").click(); expect(await D.count(page)).toBe(1); expect(await revision(page)).toBe(beforeRevision);
  await page.mouse.click(center.x, center.y, { button: "right" }); await page.keyboard.press("Escape"); expect(await D.count(page)).toBe(1);
  await page.mouse.click(center.x, center.y, { button: "right" }); await remove.click();
  await expect.poll(() => D.count(page)).toBe(0); expect(await revision(page)).toBe(beforeRevision + 1);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => D.row(page, made.id)).toEqual(before); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  const p = await D.plot(page), blank = D.point(p, .12, .12); await page.mouse.click(blank.x, blank.y, { button: "right" });
  await expect(menu).toHaveCount(0); expect(await D.count(page)).toBe(1);
});

test("overlapping hits never start creation; an inactive overlap offers chooser and the chosen sibling owns one held drag", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const first = await D.drawing(page);
  await D.action(page, first.id, "duplicate"); const duplicate = await D.active(page); await D.closeManager(page);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("Escape");
  expect(await D.active(page)).toBe(""); await expect(page.locator("#ol-trend")).toHaveAttribute("aria-pressed", "true");
  const p = await D.plot(page), center = D.point(p, .5, .5), before = await D.rows(page), beforeRevision = await revision(page);
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 30, center.y - 15, { steps: 6 });
  expect(await D.rows(page)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
  await page.mouse.up(); const chooser = page.locator("#ol-drawing-chooser"); await expect(chooser).toBeVisible();
  await expect(chooser.locator(`[data-drawing-choice="${first.id}"]`)).toBeVisible(); await expect(chooser.locator(`[data-drawing-choice="${duplicate}"]`)).toBeVisible();
  await chooser.locator(`[data-drawing-choice="${first.id}"]`).click();
  const original = await D.row(page, first.id), sibling = await D.row(page, duplicate);
  const body = await strokePoint(page, first.id), to = { x: body.x + p.width / 16, y: body.y - p.height / 16 };
  await heldEdit(page, first.id, body, to, { a: D.expected(.3125, .6875), b: D.expected(.8125, .1875) });
  const moved = await D.row(page, first.id); expect(moved.b.timeMs - moved.a.timeMs).toBe(original.b.timeMs - original.a.timeMs);
  expect(moved.b.priceCents - moved.a.priceCents).toBe(original.b.priceCents - original.a.priceCents); expect(await D.row(page, duplicate)).toEqual(sibling);
});


test("secondary press during a held edit retains its primary owner and commits once on terminal release", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const made = await D.drawing(page), before = await D.row(page, made.id), beforeRevision = await revision(page);
  const p = await D.plot(page), a = await project(page, before.a), to = D.point(p, .3125, .6875);
  await page.mouse.move(a.x, a.y); await page.mouse.down({ button: "left" }); await page.mouse.move(to.x, to.y, { steps: 6 });
  expect(await D.row(page, made.id)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
  await page.mouse.down({ button: "right" }); await expect(page.locator("#ol-drawing-context")).toHaveCount(0);
  await page.mouse.up({ button: "left" }); expect(await D.row(page, made.id)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
  await page.mouse.up({ button: "right" });
  const committed = { ...before, a: D.expected(.3125, .6875) };
  await expect.poll(() => D.row(page, made.id)).toEqual(committed); expect(await revision(page)).toBe(beforeRevision + 1); expect(await D.count(page)).toBe(1);
  await expect(page.locator("#ol-drawing-context")).toHaveCount(0);
  await page.mouse.move(to.x + 25, to.y - 15); expect(await D.row(page, made.id)).toEqual(committed); expect(await revision(page)).toBe(beforeRevision + 1);
});

test("an inactive endpoint takes pickup priority over an active line body at their crossing", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const endpoint = await D.drawing(page, [.5, .5], [.8, .8]), body = await D.drawing(page, [.2, .5], [.8, .5]);
  expect(await D.active(page)).toBe(body.id); const untouched = await D.row(page, body.id), before = await D.row(page, endpoint.id), p = await D.plot(page);
  await heldEdit(page, endpoint.id, D.point(p, .5, .5), D.point(p, .5, .4), { a: D.expected(.5, .4), b: before.b });
  expect(await D.row(page, body.id)).toEqual(untouched); await expect(page.locator("#ol-drawing-chooser")).toBeHidden();
});
