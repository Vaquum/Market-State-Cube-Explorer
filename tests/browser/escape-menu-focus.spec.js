"use strict";
// escape-menu-focus.spec.js (#124): where the focus goes when a menu closes.
//
// Popovers are one at a time, and an outside click or Escape closes them. Closing one hands the focus back to its button when the focus was
// in it, so that hiding the menu doesn't drop it, or when nothing had it. A focus the menu never had stays where it is. H opens History
// without taking the focus, and a menu the focus leaves by keyboard stays open, so that focus can be on the chart, in the comparison
// workspace or elsewhere, and the keys there keep their meaning.
// What is asserted:
//   1. Inspect with the focus on the chart: H, then Escape, closes History and the chart keeps the focus, so Right still steps the cursor and
//      pans nothing;
//   2. a replay with the focus on the chart: H, then Escape, and Space plays the replay rather than pressing History's button;
//   3. the Lines menu, which takes the focus, gives it back to its button on Escape, and so does History when nothing had the focus; with the
//      focus moved out to the Compare tab, Escape closes the menu and the tab keeps the focus; with it moved to the chart, P closes the menu
//      and the chart keeps it.
// Oracles: the menu's hidden state and its button's aria-expanded, the page's focus, the address (a pan rewrites it), the navigator's cell
// number, and the play button's pressed state.
const { test, expect } = require("./fixtures.js");

async function open(page, fake, probe, hash = "#w=24h&vis=2") {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/${hash}`);
  await probe.waitForReady({ timeout: 20000 });
  await probe.waitForQuiet({ quietMs: 500, timeout: 60000 });
}
async function closed(page, panel, button) {
  await expect(page.locator(panel), `${panel} is closed`).toBeHidden();
  await expect(page.locator(button)).toHaveAttribute("aria-expanded", "false");
}
const column = (page) => page.locator("#ol-inspect").evaluate((n) => Number(n.dataset.c));
const hashOf = (page) => page.evaluate(() => location.hash);

test("Inspect with the focus on the chart: H then Escape closes History, the chart keeps the focus, and Right still steps the cursor", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeVisible();
  // a click on the chart moves the cursor there and gives the chart the focus
  await page.locator("#ol-canvas").click();
  await expect(page.locator("#ol-canvas")).toBeFocused();
  await page.keyboard.press("h");
  await expect(page.locator("#ol-hist-pop")).toBeVisible();
  await expect(page.locator("#ol-canvas"), "History took no focus").toBeFocused();
  await page.keyboard.press("Escape");
  await closed(page, "#ol-hist-pop", "#ol-hist");
  await expect(page.locator("#ol-inspect"), "Inspect stays").toBeVisible();
  await expect(page.locator("#ol-canvas"), "the chart keeps the focus").toBeFocused();
  // so the chart's keys are still Inspect's: Right steps the cursor and pans nothing
  const at = await column(page),
    before = await hashOf(page);
  await page.keyboard.press("ArrowRight");
  expect(await column(page), "Right is the next time cell").toBe(at + 1);
  expect(await hashOf(page), "and the view did not pan").toBe(before);
});

test("a replay with the focus on the chart: H then Escape, and Space plays the replay rather than pressing History's button", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe, "#w=7d&vis=2");
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("r");
  await expect(page.locator("#ol-transport")).toBeVisible();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("h");
  await expect(page.locator("#ol-hist-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  await closed(page, "#ol-hist-pop", "#ol-hist");
  await expect(page.locator("#ol-canvas"), "the chart keeps the focus").toBeFocused();
  await page.keyboard.press(" ");
  await expect(page.locator("#ol-play"), "Space plays the replay").toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ol-hist-pop"), "and History stays closed").toBeHidden();
  await page.keyboard.press(" ");
  await expect(page.locator("#ol-play")).toHaveAttribute("aria-pressed", "false");
});

test("a menu's button gets the focus back only when the menu had it or nothing did; from the Compare tab and from the chart the focus stays", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  const canvas = page.locator("#ol-canvas"),
    lines = page.locator("#ol-lines");
  // the Lines menu takes the focus, and its Escape gives it back to its button
  await canvas.focus();
  await page.keyboard.press("p");
  await expect(page.locator("#ol-lines-pop :focus"), "the menu has the focus").toHaveCount(1);
  await page.keyboard.press("Escape");
  await closed(page, "#ol-lines-pop", "#ol-lines");
  await expect(lines, "back on its button").toBeFocused();
  // nothing has the focus (as after a pointer press that focuses no button): Escape gives it to History's button
  await canvas.focus();
  await page.keyboard.press("h");
  await expect(page.locator("#ol-hist-pop")).toBeVisible();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Escape");
  await closed(page, "#ol-hist-pop", "#ol-hist");
  await expect(page.locator("#ol-hist"), "the focus that was nowhere is on History's button").toBeFocused();
  // the focus moved out of the open Lines menu to the Compare tab with the keyboard: Escape closes the menu, and the tab keeps the focus
  await canvas.focus();
  await page.keyboard.press("p");
  await expect(page.locator("#ol-lines-pop :focus")).toHaveCount(1);
  const tab = page.locator("#ol-tab-compare");
  await tab.focus();
  await expect(page.locator("#ol-lines-pop"), "moving the focus out leaves the menu open").toBeVisible();
  await page.keyboard.press("Escape");
  await closed(page, "#ol-lines-pop", "#ol-lines");
  await expect(tab, "the Compare tab keeps the focus").toBeFocused();
  // the focus moved out to the chart: P closes the open menu, and the chart keeps the focus
  await canvas.focus();
  await page.keyboard.press("p");
  await expect(page.locator("#ol-lines-pop :focus")).toHaveCount(1);
  await canvas.focus();
  await page.keyboard.press("p");
  await closed(page, "#ol-lines-pop", "#ol-lines");
  await expect(canvas, "the chart keeps the focus").toBeFocused();
});
