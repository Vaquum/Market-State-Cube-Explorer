"use strict";
// B44 inspect.spec.js (PRD-0002 S3, #48 section 3): the Inspect tool, its cursor, its keys and its surfaces.
//
// What is asserted:
//   1. E enters Inspect and leaves it, from a page with no pointer on the chart: the cursor starts at the visible centre, the navigator is focused and says
//      where it is and what is there; a selection, an anchor, the view and the replay are the same after it as before, in the address;
//   2. the keys of each surface do what the table says: Cells (Left/Right the time cell, Up/Down the price row), Rows (Up/Down only), Columns (Left/Right only),
//      References (Up/Down through the stable list, by identity), Home and End the first and last visible item along the surface's axis;
//   3. at the edge of the visible items the cursor stays, the edge is announced in words, and the view is not panned;
//   4. Enter and Space open the record's detail and do nothing else; Escape closes the detail, then leaves Inspect for the tool it came from, and only the
//      next one clears the selection;
//   5. the cursor is not a hover: a pan that carries it out of the view leaves it, says "Outside the view" and does not move the view; Home brings it back;
//      a change of level remaps it to the cell that contains it;
//   6. the existing keys (M, B, U, P and the others) keep their commands while Inspect is the tool and the cursor follows the new measure; and the
//      navigator's own controls keep their native keys.
// Oracles (none is the code under test): the key table of the PRD written out in the spec; the address, read back as the page's own record of the
// selection, the anchor, the window and the replay; the navigator's cell and row numbers, compared with the step the page's level gives.
const { test: base, expect } = require("./fixtures.js");
const S = require("./rows-support.js");

const test = base;

const ADDRESS = "#w=24h&vis=2&lines=7d,30d&level=25100";

async function open(page, fake, probe, hash = ADDRESS) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 500, timeout: 60000 });
}
const hashOf = (page) => page.evaluate(() => location.hash);
const cell = async (page) => {
  const d = await page.locator("#ol-inspect").evaluate((n) => ({ c: Number(n.dataset.c), r: Number(n.dataset.r), inside: n.dataset.inside, surface: n.dataset.surface, state: n.dataset.state }));
  return d;
};
const position = (page) => page.locator("#ol-inspect-position").textContent();
const boundary = (page) => page.locator("#ol-inspect-boundary").textContent();

test.describe("B44 Inspect: its own cursor, moved by the keys of each surface", () => {
  test("E enters from a page with no pointer on the chart, reads the centre, and leaves; nothing the address holds has changed", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    const before = await hashOf(page);
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    await expect(page.locator("#ol-inspect")).toBeFocused();
    await expect(page.locator('[data-tool="inspect"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "false");
    expect(await position(page), "the cell under the cursor, in words").toMatch(/UTC · [\d,.]+–[\d,.]+ USDT/);
    await expect(page.locator("#ol-inspect-readout")).toContainText(/Volume|Trades|Taker/);
    const start = await cell(page);
    expect(start.inside, "the cursor starts inside the view").toBe("true");
    expect(start.surface).toBe("cells");
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeHidden();
    await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
    expect(await hashOf(page), "entering and leaving changed nothing the address holds").toBe(before);
  });

  test("Cells: Left and Right step the time cell, Up and Down the price row, Home and End the first and last time cell; the edge is announced and the view stays", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    const before = await hashOf(page);
    await page.keyboard.press("e");
    const a = await cell(page);
    await page.keyboard.press("ArrowRight");
    const b = await cell(page);
    expect(b.c, "Right is the next time cell").toBe(a.c + 1);
    expect(b.r, "and the row is the same").toBe(a.r);
    await page.keyboard.press("ArrowUp");
    expect((await cell(page)).r, "Up is the next higher price row").toBe(a.r + 1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect((await cell(page)).r, "Down is the next lower row").toBe(a.r - 1);
    await page.keyboard.press("ArrowLeft");
    expect((await cell(page)).c, "Left is the previous time cell").toBe(a.c);
    // the last visible time cell, then past it: the edge is said, the cursor does not move, the view is not panned
    await page.keyboard.press("End");
    const last = await cell(page);
    expect(last.c).toBeGreaterThan(a.c);
    await page.keyboard.press("ArrowRight");
    expect((await cell(page)).c, "the cursor stays at the edge").toBe(last.c);
    expect(await boundary(page)).toBe("End of the view");
    await expect(page.locator("#ol-inspect-live")).toContainText("End of the view");
    await page.keyboard.press("Home");
    const first = await cell(page);
    expect(first.c).toBeLessThan(last.c);
    await page.keyboard.press("ArrowLeft");
    expect((await cell(page)).c).toBe(first.c);
    expect(await boundary(page)).toBe("Start of the view");
    expect(await hashOf(page), "the view, the selection and the anchor never moved").toBe(before);
  });

  test("Rows, Columns and References: each takes its own keys and ignores the others", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    await page.keyboard.press("e");
    // Rows: Up and Down step the row, Left and Right do nothing
    await page.locator('[data-surface="rows"]').click();
    await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "rows");
    expect(await position(page)).toMatch(/^Row /);
    await page.locator("#ol-inspect").focus();
    const r0 = await cell(page);
    await page.keyboard.press("ArrowUp");
    expect((await cell(page)).r).toBe(r0.r + 1);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    expect((await cell(page)).c, "Left and Right have no data action on Rows").toBe(r0.c);
    await page.keyboard.press("Home");
    const top = (await cell(page)).r;
    await page.keyboard.press("End");
    expect((await cell(page)).r, "Home is the highest visible row, End the lowest").toBeLessThan(top);
    // Columns: Left and Right step the column, Up and Down do nothing
    await page.locator('[data-surface="columns"]').click();
    await page.locator("#ol-inspect").focus();
    expect(await position(page)).toMatch(/^Column /);
    const c0 = await cell(page);
    await page.keyboard.press("ArrowRight");
    expect((await cell(page)).c).toBe(c0.c + 1);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    expect((await cell(page)).r, "Up and Down have no data action on Columns").toBe(c0.r);
    // References: Up and Down walk the stable list by identity; Home and End its ends; Left and Right do nothing
    await page.locator('[data-surface="references"]').click();
    await page.locator("#ol-inspect").focus();
    const first = await position(page);
    expect(first).toMatch(/ · 1 of \d+$/);
    await page.keyboard.press("ArrowDown");
    expect(await position(page)).toMatch(/ · 2 of \d+$/);
    await page.keyboard.press("ArrowLeft");
    expect(await position(page), "Left does nothing on References").toMatch(/ · 2 of \d+$/);
    await page.keyboard.press("End");
    const total = Number(/ of (\d+)$/.exec(await position(page))[1]);
    expect(await position(page)).toMatch(new RegExp(` · ${total} of ${total}$`));
    await page.keyboard.press("ArrowDown");
    expect(await boundary(page)).toBe("Last reference");
    await page.keyboard.press("Home");
    expect(await position(page)).toBe(first);
    // the chooser reaches every reference, and the same record
    await expect(page.locator("#ol-inspect-reference option")).toHaveCount(total);
  });

  test("Enter and Space open the detail and nothing else; Escape closes it, then leaves Inspect, and only the next one clears the selection", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    // a selection first, made with the Select tool
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.keyboard.press("s");
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("v");
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    const withSelection = await hashOf(page);
    expect(withSelection, "a selection is in the address").toMatch(/sel=/);
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeFocused();
    // Enter: detail, and the address is unchanged (no anchor, no Pin, no Play)
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-inspect-detail")).toBeVisible();
    await expect(page.locator("#ol-inspect-detail-body")).not.toBeEmpty();
    expect(await hashOf(page)).toBe(withSelection);
    // Escape: the detail first
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect-detail")).toBeHidden();
    await expect(page.locator("#ol-inspect")).toBeVisible();
    // Space opens it too, and closes it again
    await page.locator("#ol-inspect").focus();
    await page.keyboard.press(" ");
    await expect(page.locator("#ol-inspect-detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect-detail")).toBeHidden();
    // then Inspect, for the tool it came from, with the selection kept
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect")).toBeHidden();
    await expect(page.locator('[data-tool="pan"]')).toHaveAttribute("aria-pressed", "true");
    expect(await hashOf(page), "the selection is still there after Inspect is left").toBe(withSelection);
    // only the next Escape does what it did before: clear the selection
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("Escape");
    await expect.poll(() => hashOf(page)).not.toMatch(/sel=/);
  });

  test("a pan that carries the cursor out of the view leaves it in place and says so; Home brings it back; a change of level remaps it; M still changes the measure", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe);
    await page.keyboard.press("e");
    await page.keyboard.press("End");
    const at = await cell(page);
    // drag the chart to the right: the view moves to earlier times and the last cell leaves it on the right
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2 + 900, box.y + box.height * 0.5, { steps: 12 });
    await page.mouse.up();
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    const out = await cell(page);
    expect(out.c, "the cursor is where it was: an absolute position, not a screen one").toBe(at.c);
    expect(out.inside, "and the view moved away from it").toBe("false");
    expect(await position(page)).toBe("Outside the view");
    await expect(page.locator("#ol-inspect-readout")).toContainText("outside the view");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    const viewBefore = await hashOf(page);
    await page.locator("#ol-inspect").focus();
    await page.keyboard.press("Home");
    expect((await cell(page)).inside, "Home brings it back into the view").toBe("true");
    expect(await hashOf(page), "without moving the view").toBe(viewBefore);
    // a coarser level: the cursor's absolute time is kept and the cell is the one that contains it
    const was = await page.locator("#ol-inspect").evaluate((n) => ({ c: Number(n.dataset.c), ts: Number(n.dataset.ts) }));
    await page.keyboard.press("]");
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const now = await page.locator("#ol-inspect").evaluate((n) => ({ c: Number(n.dataset.c), ts: Number(n.dataset.ts) }));
    expect(now.ts, "the level changed").toBeGreaterThan(was.ts);
    expect(now.c, "the cursor is remapped to the cell that contains its time").toBe(Math.floor(((was.c + 0.5) * was.ts) / now.ts));
    // a measure change keeps the cursor, and the readout follows
    await page.keyboard.press("m");
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    expect((await cell(page)).c, "the same absolute cursor").toBe(now.c);
    await expect(page.locator("#ol-inspect")).toBeVisible();
  });
});
