"use strict";
// inspect-open-menu.spec.js (#116): Inspect entered while a menu is open.
//
// Popovers are one at a time, and an outside click or Escape closes them. A pointer press on the Inspect tool button is a click outside an open
// menu, so the menu closes before Inspect opens; E, and the tool button pressed from the keyboard, are the same choice of tool and close it too.
// What is asserted:
//   1. E pressed in the open Lines menu enters Inspect with the menu closed: the navigator has the focus, nothing covers its surface tabs, and the
//      References tab reads the line just ticked;
//   2. Escape keeps the meaning Inspect's key table gives it (the detail, then Inspect itself), and no menu is left open where Inspect was;
//   3. the tool button closes the menu whether the pointer or the keyboard presses it.
// Oracles: the page's own hit test (document.elementFromPoint at the centre of each surface tab is the element a click there lands on), the menu's
// hidden state and its button's aria-expanded, and the key table above INSPECT_SURFACES in src/explorer.js, written out in the steps.
const { test, expect } = require("./fixtures.js");

async function open(page, fake, probe) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/#w=24h&vis=2`);
  await probe.waitForReady({ timeout: 20000 });
  await probe.waitForQuiet({ quietMs: 500, timeout: 60000 });
}
// The Lines menu opened with its key and the 7-day line ticked in it: the focus stays on the box, in the open menu.
async function tickSevenDays(page) {
  await page.keyboard.press("p");
  await expect(page.locator("#ol-lines-pop")).toBeVisible();
  const box = page.locator('[data-line="7d"]');
  await box.check();
  await expect(box).toBeFocused();
}
// The surface tabs a click at their centre would not land on, each with what is on top of it there.
const covered = (page) =>
  page.locator("#ol-inspect-surfaces [data-surface]").evaluateAll((tabs) =>
    tabs.flatMap((tab) => {
      const r = tab.getBoundingClientRect(),
        hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const by = hit ? (hit.closest("[id]") ? "#" + hit.closest("[id]").id : hit.tagName.toLowerCase()) : "nothing";
      return hit && tab.contains(hit) ? [] : [`${tab.dataset.surface} under ${by}`];
    }),
  );
async function closedMenu(page) {
  await expect(page.locator("#ol-lines-pop"), "the Lines menu is closed").toBeHidden();
  await expect(page.locator("#ol-lines")).toHaveAttribute("aria-expanded", "false");
}

test("E pressed in the open Lines menu closes it: the navigator has the focus, nothing covers its surface tabs, and References reads the line just ticked", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  await tickSevenDays(page);
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeVisible();
  expect(await covered(page), "a click at each surface tab's centre lands on it").toEqual([]);
  await closedMenu(page);
  await expect(page.locator("#ol-inspect"), "the navigator has the focus").toBeFocused();
  const tab = page.locator('[data-surface="references"]');
  await expect(tab, "the 7-day line is a reference").toBeEnabled();
  await tab.click();
  await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "references");
  await expect(page.locator("#ol-inspect-position")).toHaveText("7D · 1 of 1");
});

test("Escape after E from the open menu keeps Inspect's key table: the detail, then Inspect, and no menu is left where Inspect was", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  await tickSevenDays(page);
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#ol-inspect-detail")).toBeVisible();
  // Escape: the detail first, and Inspect stays
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-inspect-detail")).toBeHidden();
  await expect(page.locator("#ol-inspect")).toBeVisible();
  // then Inspect, for the tool it came from
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-inspect")).toBeHidden();
  await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
  await closedMenu(page);
});

test("the Inspect tool button closes the open menu whether the pointer or the keyboard presses it", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  await open(page, fake, probe);
  const button = page.locator("#ol-inspect-tool");
  // the pointer: its press is a click outside the menu
  await tickSevenDays(page);
  await button.click();
  await expect(page.locator("#ol-inspect")).toBeVisible();
  expect(await covered(page), "the pointer: nothing covers the surface tabs").toEqual([]);
  await closedMenu(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-inspect")).toBeHidden();
  // the keyboard: the button focused from the open menu and pressed with Enter, with no click outside the menu
  await page.keyboard.press("p");
  await expect(page.locator('[data-line="7d"]'), "the menu opens on the line that is on").toBeFocused();
  await button.focus();
  await expect(page.locator("#ol-lines-pop"), "moving the focus out leaves the menu open").toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#ol-inspect")).toBeVisible();
  await expect(page.locator('[data-tool="inspect"]')).toHaveAttribute("aria-pressed", "true");
  expect(await covered(page), "the keyboard: nothing covers the surface tabs").toEqual([]);
  await closedMenu(page);
});
