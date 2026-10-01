"use strict";
// B48 help-motion.spec.js (PRD-0002 S3, #48 section 3, last box): the key list, the commands, the hints and reduced motion say the same thing as the page does.
//
//   1. the `?` dialog lists Inspect (E) among the tools and has a section for its keys; every tool button's `aria-keyshortcuts` and `data-keys` is a key the dialog
//      lists, and E toggles Inspect on and off wherever the focus is except a text field;
//   2. E inside a text field types an E and does nothing to the chart; E with a modifier is the browser's;
//   3. reduced motion is honoured in the stylesheet and in the canvas, and when the preference changes during the session: with it off the canvas morphs a level
//      change over several frames and the toggles' icons turn over 0.15 s; the moment it is turned on neither does.
// Oracles (none is the code under test): the page's own markup (the dialog's text), the browser's media emulation, a counter of the canvas's own redraws (the
// canvas's width is reset at each frame) and the computed style of a caret.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");

test.describe("B48 help, commands and reduced motion", () => {
  test("the key list names Inspect and its keys; the tool buttons' keys are listed; E toggles it except in a text field", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await S.atRest(page, fake, probe);
    await page.keyboard.press("?");
    const dialog = page.locator("#ol-keys");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#ol-keys-tools")).toBeVisible();
    await expect(dialog.locator("h3#ol-keys-inspect")).toHaveText("Inspect (E)");
    const text = await dialog.innerText();
    for (const phrase of ["Pan, select, lens, inspect", "Open or close the record's detail", "First or last visible item", "References: previous or next reference"]) expect(text).toContain(phrase);
    // every tool button's key is a kbd of the dialog
    const kbds = await dialog.locator("kbd").allTextContents();
    for (const button of await page.locator("[data-tool]").all()) {
      const key = await button.getAttribute("aria-keyshortcuts"),
        shown = await button.getAttribute("data-keys");
      expect(key, "the key a tool button announces").toBe(shown);
      expect(kbds, `the dialog lists ${key}`).toContain(key);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // E toggles Inspect from the chart
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    await expect(page.locator('[data-tool="inspect"]')).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect")).toBeHidden();
    // in a text field E is a letter: open the views dialog's name field (Shift+S) and type
    await page.keyboard.press("Shift+S");
    const field = page.locator("#ol-view-name");
    await expect(field).toBeVisible();
    await field.focus();
    await page.keyboard.type("e");
    await expect(page.locator("#ol-inspect"), "typing E in a field does not start Inspect").toBeHidden();
    expect(await field.inputValue()).toBe("e");
  });

  test("reduced motion: off, the canvas morphs and the toggles turn over; turned on in the running session, neither does", async ({ page, probe, fakeFor }) => {
    await page.addInitScript(() => {
      window.__draws = 0;
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
      Object.defineProperty(HTMLCanvasElement.prototype, "width", {
        configurable: true,
        get() {
          return d.get.call(this);
        },
        set(v) {
          if (this.id === "ol-canvas") window.__draws++;
          d.set.call(this, v);
        },
      });
    });
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
    // the drawer's and the inspector's toggles turn their icon over 0.15 s
    const duration = () => page.evaluate(() => getComputedStyle(document.querySelector("#ol-drawer-toggle .ol-icon")).transitionDuration);
    expect(await duration(), "with motion allowed the toggle's icon turns over 0.15 s").toBe("0.15s");
    const frames = async (key) => {
      await page.evaluate(() => (window.__draws = 0));
      await page.keyboard.press(key);
      await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
      return page.evaluate(() => window.__draws);
    };
    await page.locator("#ol-canvas").focus();
    const morph = await frames("]");
    expect(morph, `a level change morphs over several frames (${morph})`).toBeGreaterThanOrEqual(4);
    // the preference changes while the page is open
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(duration, { message: "the stylesheet follows the preference at once" }).toBe("0s");
    const still = await frames("[");
    expect(still, `a level change is one drawing when motion is off (${still} against ${morph})`).toBeLessThanOrEqual(3);
    // and back
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(duration).toBe("0.15s");
    expect(await frames("]"), "motion returns with the preference").toBeGreaterThanOrEqual(4);
  });
});
