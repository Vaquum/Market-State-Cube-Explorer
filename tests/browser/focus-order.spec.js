"use strict";
// B54 focus-order.spec.js (PRD-0002 S3, #48 section 6, screen-reader and focus-order evidence): what a screen reader is told and where the keyboard goes, read from the
// accessibility tree and the focus itself, not from a screenshot.
//
//   1. the accessibility tree of the Inspect navigator is what the contract says: a group named Inspection with a tablist of the surfaces, the four named cursor buttons,
//      the reference chooser and a status; the Cells table has its own table, rows and columns;
//   2. the announcement is words: each term of the readout is announced as "term: value" and the sentences are separated, so that nothing is read as "Row7.52";
//   3. Tab visits the controls of the navigator in the order they stand in the document and Shift+Tab visits them in the opposite order; nothing hidden takes the focus, and the
//      table has exactly one tab stop;
//   4. a modal holds the focus while it is open (thirty Tabs stay inside), closes on Escape and gives the focus back to where it was; nothing traps the keyboard in the
//      navigator (Tab leaves it for the next control of the page).
// Oracles (none is the code under test): the page's own document order (a DOM query for what is tabbable, in tree order), the browser's accessibility tree (ariaSnapshot) and
// the page's own tooltip structure (dt and dd) read back from the readout.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");

async function open(page, fake, probe, hash) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
  await page.locator("#ol-canvas").focus();
}
// The tabbable controls inside a root, in document order, as the browser sees them (visible, enabled, tabindex not -1).
const tabbable = (page, root) =>
  page.locator(root).evaluate((r) => {
    const sel = 'a[href],button,input,select,textarea,summary,[tabindex]';
    return [...r.querySelectorAll(sel)]
      .filter((n) => !n.disabled && n.tabIndex >= 0 && !n.closest("[hidden]") && !n.closest("[inert]") && getComputedStyle(n).visibility !== "hidden" && getComputedStyle(n).display !== "none" && n.getBoundingClientRect().width > 0)
      .map((n) => n.id || n.dataset.surface || n.dataset.step || n.getAttribute("aria-label") || n.tagName);
  });
const focused = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.dataset?.surface || document.activeElement?.dataset?.step || document.activeElement?.getAttribute?.("aria-label") || document.activeElement?.tagName);

test.describe("B54 screen reader and focus order", () => {
  test("the accessibility tree of the navigator and of the table says what they are", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&lines=7d&rows=volume&period=7d");
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    const tree = await page.locator("#ol-inspect").ariaSnapshot();
    for (const line of [
      'group "Inspection"',
      'tablist "What to inspect"',
      'tab "Cells" [selected]',
      'tab "Rows"',
      'tab "Columns"',
      'tab "References"',
      'tab "Lens"',
      'button "Exit"',
      'group "Move the cursor"',
      'button "Previous time cell"',
      'button "Next time cell"',
      'button "Next higher price row"',
      'button "Next lower price row"',
      'combobox "Reference"',
      "status",
    ])
      expect(tree, `the navigator has ${line}`).toContain(line);
    // the drawer's table is a table of named columns, each sortable by its own button
    await page.keyboard.press("Escape");
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("t");
    const drawer = await page.locator("#ol-drawer").ariaSnapshot();
    for (const line of ['tablist "Details"', 'tab "Cells" [selected]', "table", 'columnheader "Time · UTC"', 'columnheader "USDT volume"', 'columnheader "State"', 'button "Previous"', 'button "Next"']) expect(drawer, `the drawer has ${line}`).toContain(line);
    // rows of the Cells table are rows of the table
    await expect.poll(() => page.getByRole("row").count(), { message: "the table has its rows", timeout: 60000 }).toBeGreaterThan(1);
  });

  test("the announcement is words: each term is a term and its value, and the sentences are apart", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&lines=7d&rows=volume&period=7d");
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    for (const surface of ["cells", "rows", "columns", "references"]) {
      await page.locator(`#ol-inspect [role=tab][data-surface="${surface}"]`).click();
      await page.waitForTimeout(300);
      const pairs = await page.locator("#ol-inspect-readout").evaluate((r) => [...r.querySelectorAll("dt")].map((dt) => [dt.textContent.trim(), dt.nextElementSibling?.textContent.trim() ?? ""]));
      const live = await page.locator("#ol-inspect-live").textContent();
      expect(pairs.length, `${surface}: the readout has terms`).toBeGreaterThan(1);
      for (const [term, value] of pairs) expect(live, `${surface}: "${term}: ${value}" is announced as a term and its value`).toContain(`${term}: ${value}`);
      expect(live, `${surface}: no term runs into the previous value`).not.toMatch(/[a-z)%]{1}[A-Z][a-z]+\d/);
      expect(live.split(". ").length, `${surface}: the sentences are separated`).toBeGreaterThan(pairs.length);
    }
  });

  test("the surfaces are a native tablist: Left, Right, Home and End choose among them and the focus goes with the choice", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&lines=7d&rows=volume&period=7d");
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    const tabs = page.locator("#ol-inspect [role=tab]:not([disabled])");
    const names = await tabs.evaluateAll((all) => all.map((n) => n.dataset.surface));
    expect(names.length, "the surfaces that are available").toBeGreaterThanOrEqual(4);
    await page.locator("#ol-inspect [role=tab][aria-selected=true]").focus();
    const surface = () => page.locator("#ol-inspect").getAttribute("data-surface");
    expect(await surface()).toBe(names[0]);
    await page.keyboard.press("ArrowRight");
    expect(await surface(), "Right chooses the next surface").toBe(names[1]);
    expect(await page.evaluate(() => document.activeElement?.dataset.surface), "and the focus goes with it").toBe(names[1]);
    await page.keyboard.press("End");
    expect(await surface(), "End chooses the last").toBe(names.at(-1));
    await page.keyboard.press("ArrowRight");
    expect(await surface(), "Right after the last wraps to the first").toBe(names[0]);
    await page.keyboard.press("ArrowLeft");
    expect(await surface(), "Left before the first wraps to the last").toBe(names.at(-1));
    await page.keyboard.press("Home");
    expect(await surface(), "Home chooses the first").toBe(names[0]);
    // none of that moved the chart or made an address of its own
    expect(await page.evaluate(() => location.hash)).toContain("w=7d");
  });

  test("Tab visits the navigator's controls in document order and Shift+Tab in the opposite order; nothing hidden takes the focus; the table has one tab stop", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&lines=7d&rows=volume&period=7d");
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    const stops = await tabbable(page, "#ol-inspect");
    expect(stops.length, "the navigator has controls to visit").toBeGreaterThan(6);
    // the surfaces are one tab stop (a roving tablist), so the stops are: one tab, Exit, the four buttons, the chooser (document order)
    await page.locator("#ol-inspect [role=tab][tabindex='0']").first().focus();
    const forward = [await focused(page)];
    for (let i = 1; i < stops.length; i++) {
      await page.keyboard.press("Tab");
      forward.push(await focused(page));
    }
    expect(forward, "Tab goes through the stops in the order they stand in the document").toEqual(stops);
    const back = [forward.at(-1)];
    for (let i = 1; i < stops.length; i++) {
      await page.keyboard.press("Shift+Tab");
      back.push(await focused(page));
    }
    expect(back, "Shift+Tab goes through them the other way").toEqual([...stops].reverse());
    // nothing hidden or inert took the focus on the way
    const hiddenFocused = await page.evaluate(() => Boolean(document.activeElement?.closest("[hidden],[inert]")));
    expect(hiddenFocused).toBe(false);
    // the keyboard is not trapped: Tab goes on out of the navigator
    await page.locator("#ol-inspect [data-step]").last().focus();
    let left = false;
    for (let i = 0; i < 8 && !left; i++) {
      await page.keyboard.press("Tab");
      left = await page.evaluate(() => !document.activeElement?.closest("#ol-inspect"));
    }
    expect(left, "Tab leaves the navigator for the next control of the page").toBe(true);
    // the drawer's table: exactly one row is a tab stop
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press("t");
    await expect(page.locator("#ol-table-body tr").first()).toBeVisible();
    expect(await page.locator("#ol-table-body tr[tabindex='0']").count(), "one row is the table's tab stop").toBe(1);
    expect(await page.locator("#ol-table-body tr[tabindex='-1']").count(), "and the others are reached by the arrows").toBeGreaterThan(0);
  });

  test("a modal holds the focus, closes on Escape and gives the focus back; the chart's keys do nothing behind it", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2");
    const before = await page.evaluate(() => location.hash);
    await page.keyboard.press("?");
    const dialog = page.locator("#ol-keys");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.getElementById("ol-keys").contains(document.activeElement)), "the focus is inside the dialog").toBe(true);
    expect(await dialog.evaluate((d) => d.matches(":modal")), "it is a modal dialog: the page behind is inert").toBe(true);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      // inside the dialog, or in the browser's own chrome (which a modal leaves reachable: document.body then holds the focus); never on a control of the page behind it
      expect(await page.evaluate(() => document.getElementById("ol-keys").contains(document.activeElement) || document.activeElement === document.body), `Tab ${i + 1} stays out of the page behind the modal`).toBe(true);
    }
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("e");
    expect(await page.evaluate(() => location.hash), "the chart's keys do nothing behind the modal").toBe(before);
    await expect(page.locator("#ol-inspect"), "E did not start Inspect behind the modal").toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await focused(page), "the focus is back on the chart").toBe("ol-canvas");
  });
});
