"use strict";
// B49 keyboard-matrix.spec.js (PRD-0002 S3, #48 sections 3 and 6): the keys, by what holds the focus, with the address, the history, the selection, the anchor and
// the replay asserted exactly.
//
//   1. every shortcut the key list documents does, in this build, what it did in the original (8c82ca1): the same keys are pressed in the same order on both and
//      the address (with the keys of the visual version taken out) and the state of the page's panels and tools are the same after each;
//   2. the new keys do not touch the others: E enters and leaves Inspect, and nothing else the key list documents changes while it is the tool except where
//      Inspect says so (the arrows, Home, End, Enter and Space of the chart and the navigator);
//   3. each holder of the focus consumes its own keys: the navigator's tabs and buttons keep theirs; a table row's arrows move along the page and its Enter reads the cell
//      in Inspect; a button's arrows pan nothing; a text field's keys are its own; a radio group's arrows choose in it; the key list (a modal) closes first on Escape and
//      leaves Inspect where it was;
//   4. Enter and Space with a lens, with a replay and with Inspect on the chart: outside Inspect Enter pins the lens and Space plays the replay; inside it they open the
//      record's detail and pin and play nothing.
// Oracles: the original build, served from git behind its own fake (a control); the page's own address and history, read back.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");

// The address as the state it holds, without the keys that only the visual version adds.
const normal = (hash) =>
  hash
    .replace(/^#/, "")
    .split("&")
    .filter((p) => p && !/^(vis|ap|sc|pc|po)=/.test(p))
    .sort()
    .join("&");
const snapshot = (page) =>
  page.evaluate(() => {
    const open = (id) => {
      const n = document.getElementById(id);
      return Boolean(n && !n.hidden);
    };
    const pressed = [...document.querySelectorAll("[data-tool]")].find((b) => b.getAttribute("aria-pressed") === "true")?.dataset.tool ?? "";
    return {
      hash: location.hash,
      lines: open("ol-lines-pop"),
      keys: Boolean(document.getElementById("ol-keys")?.open),
      drawer: document.getElementById("ol-drawer")?.dataset.open ?? "",
      side: document.getElementById("ol-main")?.dataset.side ?? "",
      tool: pressed,
    };
  });

// Every documented key of the key list, in an order that does not depend on the one before it more than both builds are dependent on it.
const SEQUENCE = [
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "End",
  "=", "-", "Shift+=", "Shift+-", "f",
  "3", "7", "0", "1", "w", "Escape",
  "a", "[", "]", "{", "}", "d",
  "m", "Shift+M", "b", "Shift+B", "u", "Shift+U", "x", "x",
  "s", "v", "l", "Shift+L", "v",
  "p", "Escape", "Shift+P", "Shift+P",
  "r", ",", ".", "r",
  "c", "c", "i", "i", "t", "t", "h", "Escape",
  "?", "?",
];

test.describe("B49 the documented shortcuts are the original's", () => {
  test("the same keys in the same order leave the same address and the same panels after each", async ({ page, probe, fakeFor, baselinePage }) => {
    test.setTimeout(420000);
    const old = await baselinePage({ mode: "live", profile: "standard", contextOptions: { reducedMotion: "reduce" }, url: "/#w=24h" });
    const fake = await fakeFor("standard");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=24h`);
    await S.atRest(page, fake, probe);
    await old.probe.waitForReady({ timeout: 120000 });
    await page.locator("#ol-canvas").focus();
    await old.page.locator("#ol-canvas").focus();
    const different = [];
    for (const key of SEQUENCE) {
      await page.keyboard.press(key);
      await old.page.keyboard.press(key);
      await Promise.all([probe.waitForReady({ timeout: 30000 }), old.probe.waitForReady({ timeout: 30000 })]);
      const a = await snapshot(old.page),
        b = await snapshot(page);
      const was = { ...a, hash: normal(a.hash) },
        now = { ...b, hash: normal(b.hash) };
      if (JSON.stringify(was) !== JSON.stringify(now)) different.push(`after ${key}: original ${JSON.stringify(was)} / now ${JSON.stringify(now)}`);
      // keep both on the canvas for the next key
      if (!(await page.evaluate(() => document.getElementById("ol-keys")?.open))) await page.locator("#ol-canvas").focus();
      await old.page.locator("#ol-canvas").focus();
    }
    expect(different, different.join("\n")).toEqual([]);
  });
});

test.describe("B49 each holder of the focus consumes its own keys", () => {
  async function open(page, fake, probe, hash) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${hash}`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 500, timeout: 60000 });
  }
  const cellOf = (page) => page.locator("#ol-inspect").evaluate((n) => ({ c: Number(n.dataset.c), r: Number(n.dataset.r) }));

  test("a button's arrows pan nothing, a text field's keys are its own, a radio group's arrows choose in it, the modal closes first", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&lines=7d&rows=volume&period=7d");
    await page.keyboard.press("e");
    const inspectAt = await cellOf(page);
    // a native button inside the navigator: its Enter presses it (Exit leaves), and its arrows move the cursor nowhere
    await page.locator("#ol-inspect-exit").focus();
    const before = await snapshot(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    expect(await cellOf(page), "a button's arrows do not move the cursor").toEqual(inspectAt);
    expect((await snapshot(page)).hash, "and pan nothing").toBe(before.hash);
    // the key list is a modal: Escape closes it first and Inspect stays
    await page.locator("#ol-inspect").focus();
    await page.keyboard.press("?");
    await expect(page.locator("#ol-keys")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-keys")).toBeHidden();
    await expect(page.locator("#ol-inspect"), "Inspect is where it was").toBeVisible();
    // a radio group (the Rows period's): its arrows choose in it, and the cursor and the view stay
    await page.locator("#ol-rows").click();
    const radio = page.locator('input[type="radio"]:checked').first();
    if (await radio.count()) {
      await radio.focus();
      const h = (await snapshot(page)).hash;
      await page.keyboard.press("ArrowDown");
      expect((await snapshot(page)).hash.replace(/period=[\w-]+/, ""), "a radio's arrow chooses in its group and pans nothing").toBe(h.replace(/period=[\w-]+/, ""));
    }
    await page.keyboard.press("Escape");
    // a text field: E and the arrows are its own
    await page.keyboard.press("Shift+S");
    const field = page.locator("#ol-view-name");
    await field.focus();
    await page.keyboard.type("ee");
    await page.keyboard.press("ArrowLeft");
    expect(await field.inputValue(), "a text field takes its letters").toBe("ee");
    expect(await cellOf(page), "and the cursor never moved").toEqual(inspectAt);
  });

  test("a table row: its arrows move along the page and pan nothing, and its Enter reads the cell in Inspect with its detail", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=24h&vis=2");
    await page.keyboard.press("t");
    await expect(page.locator("#ol-drawer")).toHaveAttribute("data-open", "true");
    // (the Cells tab is the drawer's first: clicking the chosen tab would close the drawer)
    const rows = page.locator("#ol-table-body tr");
    await expect.poll(() => rows.count(), { message: "the table lists cells", timeout: 60000 }).toBeGreaterThan(3);
    await expect(rows.first(), "one row is the table's tab stop").toHaveAttribute("tabindex", "0");
    await rows.first().focus();
    const before = await snapshot(page);
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(rows.last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rows.first()).toBeFocused();
    expect((await snapshot(page)).hash, "the table's arrows pan nothing").toBe(before.hash);
    const state = await rows.first().getAttribute("data-state");
    expect(state, "a row says its state").toMatch(/complete|unfinished/);
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    await expect(page.locator("#ol-inspect-detail")).toBeVisible();
    expect((await snapshot(page)).hash, "reading a cell anchors nothing and changes no address").toBe(before.hash);
    await expect(page.locator("#ol-table-caption")).toHaveAttribute("data-state", "ready");
  });

  test("Enter and Space: outside Inspect they pin the lens and play the replay; inside it they open the detail and do neither", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2");
    const box = await page.locator("#ol-canvas").boundingBox();
    // the lens tool: Enter pins (the address changes)
    await page.keyboard.press("l");
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
    const h0 = (await snapshot(page)).hash;
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await snapshot(page)).hash, { message: "Enter pins the lens as the view", timeout: 30000 }).not.toBe(h0);
    // a replay: Space plays it
    await page.keyboard.press("r");
    await expect(page.locator("#ol-transport")).toBeVisible();
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press(" ");
    await expect(page.locator("#ol-play")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press(" ");
    await expect(page.locator("#ol-play")).toHaveAttribute("aria-pressed", "false");
    // Inspect: Space opens the detail and does not play; Enter opens it too and pins nothing
    await page.keyboard.press("e");
    await page.keyboard.press(" ");
    await expect(page.locator("#ol-inspect-detail")).toBeVisible();
    await expect(page.locator("#ol-play"), "Space did not play").toHaveAttribute("aria-pressed", "false");
    // the state the address holds (the view, the replay edge), not the scale record `sc`: the replay workspace's scale is fitted on the page's own time and is written to
    // the address when the fit lands, which on a slow runner can be between the two readings and has nothing to do with the key
    await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
    const h1 = normal((await snapshot(page)).hash);
    await page.keyboard.press("Escape");
    await page.locator("#ol-inspect").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-inspect-detail")).toBeVisible();
    expect(normal((await snapshot(page)).hash), "Enter pinned nothing and moved no replay edge").toBe(h1);
  });

  test("the Cells table does not say one thing for every empty state: pending and failed have their own words and their own state", async ({ page, probe, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const address = "#t=2026-06-09T00:00Z~2026-06-13T00:00Z&p=21000~25000&vis=2&sel=2026-06-10T00:00Z~2026-06-12T00:00Z,22000~24000";
    await page.setViewportSize({ width: 1500, height: 950 });
    // the cube's answer held: the rectangle is being measured
    const held = await fakeFor("standard");
    const gate = held.on({ route: /^\/cube\/query/ }).gate();
    await page.goto(`${held.url}/${address}`);
    await page.waitForFunction(() => document.getElementById("ol-canvas")?.dataset.layout);
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("t");
    const caption = page.locator("#ol-table-caption");
    await expect.poll(() => caption.getAttribute("data-state"), { message: "the rectangle is being measured", timeout: 60000 }).toBe("pending");
    await expect(caption).toContainText("Measuring the rectangle in the cube");
    // the held read goes, and the page is let settle, before it is left: a page torn down with a read held starts its next one as it goes (a tile of the rectangle), and the first
    // fake, which has not yet seen the held connection close, calls that "overlapping cube reads"
    gate.open();
    await held.idle({ quietMs: 400, timeoutMs: 30000 });
    // the cube's answer a failure, from the first read on: the table says so, in other words
    const down = await fakeFor("standard");
    // (the tile the page reads after a failed measure would tile the rectangle and measure it exactly, so the tile fails too)
    down.on({ route: /^\/cube\/(query|tile)/ }).fail({ status: 500, body: { error: "the cube is down" } });
    await page.goto(`${down.url}/${address}`);
    await page.waitForFunction(() => document.getElementById("ol-canvas")?.dataset.layout);
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("t");
    await expect.poll(() => caption.getAttribute("data-state"), { message: "the answer was a failure", timeout: 60000 }).toBe("failed");
    await expect(caption).toContainText("Not measured: the cube didn't answer (the cube is down)");
    expect(await caption.textContent(), "and it is not the pending words").not.toContain("Measuring");
  });
});
