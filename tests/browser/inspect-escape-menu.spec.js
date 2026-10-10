"use strict";
// inspect-escape-menu.spec.js (#122): Escape in Inspect's navigator while a menu is open.
//
// Popovers are one at a time, and an outside click or Escape closes them. The page's Escape closes an open menu before Inspect's detail and Inspect
// itself, and so does the comparison workspace's. The navigator keeps Escape for itself, so it takes the same first step. H opens History from the
// navigator without taking the focus, and a menu the focus leaves stays open; either way the navigator's first Escape closes the menu, and the focus
// stays in the navigator, where Inspect's keys are read.
// What is asserted:
//   1. H in the navigator opens History with the focus left in the navigator; Escape closes History, Inspect stays, the navigator keeps the focus and
//      an arrow still steps the cursor and pans nothing; a later Escape leaves Inspect for the tool it came from;
//   2. from the navigator's own controls (the detail's Back button, a surface tab) the order is the same: History first, then the detail, then Inspect;
//   3. the other ways of opening a menu over Inspect move the focus out of the navigator (W, P and Shift+S into the menu, a press on History's button
//      to the button), and the page's Escape closes the menu there with Inspect kept; a menu still open when the focus comes back to the navigator
//      closes on the navigator's first Escape.
// Oracles: the menu's hidden state and its button's aria-expanded, the page's focus, the address (a pan rewrites it), the navigator's cell number, and
// the key table above INSPECT_SURFACES in src/explorer.js, written out in the steps.
const { test, expect } = require("./fixtures.js");

async function open(page, fake, probe) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/#w=24h&vis=2`);
  await probe.waitForReady({ timeout: 20000 });
  await probe.waitForQuiet({ quietMs: 500, timeout: 60000 });
}
// Inspect entered from the chart: the navigator takes the focus.
async function enter(page) {
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeVisible();
  await expect(page.locator("#ol-inspect")).toBeFocused();
}
async function historyOpen(page) {
  await expect(page.locator("#ol-hist-pop"), "History is open").toBeVisible();
  await expect(page.locator("#ol-hist")).toHaveAttribute("aria-expanded", "true");
}
async function historyClosed(page) {
  await expect(page.locator("#ol-hist-pop"), "History is closed").toBeHidden();
  await expect(page.locator("#ol-hist")).toHaveAttribute("aria-expanded", "false");
}
async function leftInspect(page) {
  await expect(page.locator("#ol-inspect")).toBeHidden();
  await expect(page.locator('[data-tool="pan"]'), "back to the tool it came from").toHaveAttribute("aria-pressed", "true");
}
const column = (page) => page.locator("#ol-inspect").evaluate((n) => Number(n.dataset.c));
const hashOf = (page) => page.evaluate(() => location.hash);

test("H in the navigator opens History and leaves the focus there; Escape closes History first, the navigator keeps the focus, and a later Escape leaves Inspect", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  await enter(page);
  await page.keyboard.press("h");
  await historyOpen(page);
  await expect(page.locator("#ol-inspect"), "History took no focus: the navigator has it").toBeFocused();
  // Escape: the open menu first, and Inspect stays
  await page.keyboard.press("Escape");
  await historyClosed(page);
  await expect(page.locator("#ol-inspect")).toBeVisible();
  await expect(page.locator('[data-tool="inspect"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ol-inspect"), "the focus stays in the navigator").toBeFocused();
  // so Inspect's keys still reach it: Right steps the cursor and pans nothing
  const at = await column(page),
    before = await hashOf(page);
  await page.keyboard.press("ArrowRight");
  expect(await column(page), "Right is the next time cell").toBe(at + 1);
  expect(await hashOf(page), "and the view did not pan").toBe(before);
  // then Inspect, with no menu left open
  await page.keyboard.press("Escape");
  await leftInspect(page);
  await historyClosed(page);
});

test("from the navigator's own controls the order is the same: History first, then the detail, then Inspect", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  await enter(page);
  // the detail's Back button has the focus while the detail is open
  await page.keyboard.press("Enter");
  await expect(page.locator("#ol-inspect-detail")).toBeVisible();
  const back = page.locator("#ol-inspect-detail-close");
  await expect(back).toBeFocused();
  await page.keyboard.press("h");
  await historyOpen(page);
  await expect(back, "History took no focus").toBeFocused();
  await page.keyboard.press("Escape");
  await historyClosed(page);
  await expect(page.locator("#ol-inspect-detail"), "the detail is still open").toBeVisible();
  await expect(back).toBeFocused();
  // then the detail, and Inspect stays
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-inspect-detail")).toBeHidden();
  await expect(page.locator("#ol-inspect")).toBeFocused();
  // a surface tab keeps its own keys, and Escape is still the navigator's
  const tab = page.locator('#ol-inspect-surfaces [data-surface="cells"]');
  await tab.focus();
  await page.keyboard.press("h");
  await historyOpen(page);
  await expect(tab, "History took no focus").toBeFocused();
  await page.keyboard.press("Escape");
  await historyClosed(page);
  await expect(page.locator("#ol-inspect"), "Inspect stays").toBeVisible();
  await expect(tab).toBeFocused();
  // and the next Escape leaves Inspect
  await page.keyboard.press("Escape");
  await leftInspect(page);
  await historyClosed(page);
});

test("the other ways of opening a menu over Inspect take the focus out of the navigator, and a menu still open when the focus comes back closes on its first Escape", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  await enter(page);
  const nav = page.locator("#ol-inspect");
  // W, P and Shift+S: the menu takes the focus, and its Escape closes it back to its button
  for (const [key, panel, button] of [
    ["w", "#ol-window-menu", "#ol-window"],
    ["p", "#ol-lines-pop", "#ol-lines"],
    ["Shift+S", "#ol-hist-pop", "#ol-hist"],
  ]) {
    await nav.focus();
    await page.keyboard.press(key);
    await expect(page.locator(panel), `${key} opens its menu`).toBeVisible();
    await expect(page.locator(`${panel} :focus`), `${key}: the menu has the focus`).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(panel), `${key}: Escape closes it`).toBeHidden();
    await expect(page.locator(button), `${key}: back on its button`).toBeFocused();
    await expect(nav, `${key}: Inspect stays`).toBeVisible();
  }
  // a press on History's button: the button takes the focus, and the page's Escape closes History first
  await nav.focus();
  await page.locator("#ol-hist").click();
  await historyOpen(page);
  await expect(page.locator("#ol-hist")).toBeFocused();
  await page.keyboard.press("Escape");
  await historyClosed(page);
  await expect(nav, "Inspect stays").toBeVisible();
  // the Lines menu stays open when the focus moves out of it with the keyboard (no click outside it); back in the navigator, Escape closes it first
  await nav.focus();
  await page.keyboard.press("p");
  await expect(page.locator("#ol-lines-pop :focus")).toHaveCount(1);
  await nav.focus();
  await expect(page.locator("#ol-lines-pop"), "moving the focus out leaves the menu open").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-lines-pop"), "the navigator's Escape closes it").toBeHidden();
  await expect(page.locator("#ol-lines")).toHaveAttribute("aria-expanded", "false");
  await expect(nav, "Inspect stays, with the focus").toBeFocused();
  await page.keyboard.press("Escape");
  await leftInspect(page);
});
