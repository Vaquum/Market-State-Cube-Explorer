"use strict";
// B47 inspect-touch.spec.js (PRD-0002 S3, #48 section 3, touch): synthesized coarse-pointer tests.
//
// A touch context (hasTouch, isMobile: `pointer: coarse`, `hover: none`), taps made as touches:
//   1. outside Inspect a tap anchors the column it landed on, as before, and the evidence is read;
//   2. inside Inspect a tap is a reading and nothing else: the cursor goes where it landed, and the address, the history, the anchor, the evidence tab, the selection
//      and the replay edge are as they were; a long hold peeks the lens and, let go, returns to Inspect with the same absence of side effects;
//   3. a tap with several references within a finger's reach moves no cursor and shows a chooser, a 44 px row for each; choosing one reads it;
//   4. every DOM control is a 44 px target each way; the resolution plane's buttons and the canvas's own marks are the documented dense visuals, each with a
//      large-target route (the steppers and the plane's keys; the navigator, its steppers, its chooser and its tabs), and the routes are 44 px too.
//   5. the large-target resolution steppers, tapped, reach every level of the lattice, n = 0 to 20 and m = 0 to 9 (docs/data-and-semantics.md), and make no anchor.
// Oracles (none is the code under test): the address and history read back from the page, the page's own media queries, the geometry of the elements.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});
test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 1, viewport: { width: 900, height: 820 } });

const state = (page) => page.evaluate(() => ({ hash: location.hash, history: history.length, cases: document.getElementById("ol-case-n")?.textContent ?? "" }));
const where = (page) => page.locator("#ol-inspect").evaluate((n) => ({ c: Number(n.dataset.c), r: Number(n.dataset.r), surface: n.dataset.surface }));
async function open(page, fake, probe, hash) {
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
}
const plot = (page) => page.evaluate(() => ({ layout: document.getElementById("ol-canvas").dataset.layout.split(",").map(Number), box: document.getElementById("ol-canvas").getBoundingClientRect().toJSON() }));

test.describe("B47 Inspect and touch", () => {
  test("outside Inspect a tap anchors; inside Inspect a tap and a long hold read and change nothing else", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=24h&vis=2&lines=7d");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "a coarse pointer").toBe(true);
    const { layout, box } = await plot(page),
      at = (fx, fy) => [box.x + layout[0] + layout[2] * fx, box.y + layout[1] + layout[3] * fy];
    // 1. Pan's tap anchors the column: the evidence has its cases
    expect((await state(page)).cases, "no anchor yet").toBe("—");
    await page.touchscreen.tap(...at(0.4, 0.5));
    await expect.poll(async () => (await state(page)).cases, { message: "the tap anchored the column and its cases are counted", timeout: 60000 }).not.toBe("—");
    // 2. Inspect: a tap moves the cursor and changes nothing the page keeps
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    const before = await state(page),
      start = await where(page);
    await page.touchscreen.tap(...at(0.7, 0.3));
    await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
    const moved = await where(page);
    expect(moved.c !== start.c || moved.r !== start.r, "the cursor went where the tap landed").toBe(true);
    expect(moved.surface).toBe("cells");
    expect(await state(page), "the address, the history, the evidence: nothing but the cursor changed").toEqual(before);
    await expect(page.locator('[data-tool="inspect"]')).toHaveAttribute("aria-pressed", "true");
    // a long hold, as a finger would: the lens peeks while it is held and is gone, with Inspect's readout back, when it is let go
    const client = await page.context().newCDPSession(page),
      [hx, hy] = at(0.55, 0.55);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: hx, y: hy }] });
    await page.waitForTimeout(650);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
    await expect(page.locator("#ol-inspect")).toBeVisible();
    expect(await state(page), "a hold peeked the lens and changed nothing the page keeps").toEqual(before);
    await expect(page.locator("#ol-inspect-readout")).not.toBeEmpty();
  });

  test("several references within a finger's reach: a chooser with a 44 px row each, and nothing guessed", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    // a price range wide enough that the POC lines of different periods are a few pixels apart
    await open(page, fake, probe, "#w=7d&vis=2&lines=1d,7d,30d,90d&p=15000~35000");
    const { layout, box } = await plot(page),
      frame = await pane.last(),
      c = await pane.colours();
    const ys = [];
    for (const k of frame.strokes.filter((k) => k.stroke === c.poc && k.width === 1.5))
      for (let i = 0; i + 1 < k.path.length; i += 2) if (k.path[i][1] === k.path[i + 1][1] && k.path[i + 1][0] - k.path[i][0] > 100) ys.push(k.path[i][1]);
    expect(ys.length, "POC lines are on the plot (the standard cube puts them on one price row, so one tap is within reach of several)").toBeGreaterThan(0);
    await page.keyboard.press("e");
    // a first reading, early in the view: the chooser's tap below is later, and what a chosen reference is read at is the tap's time, not this one
    const earlyX = box.x + layout[0] + layout[2] * 0.2;
    await page.touchscreen.tap(earlyX, box.y + layout[1] + layout[3] * 0.05);
    await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
    const before = await state(page),
      start = await where(page);
    // (the 1-day line begins late in the view: near its end both it and the 7-day line, on the same price row, are within a finger's reach)
    await page.touchscreen.tap(box.x + layout[0] + layout[2] * 0.9, box.y + ys[0]);
    await expect(page.locator("#ol-inspect-chooser")).toBeVisible();
    const rows = page.locator("#ol-inspect-chooser button");
    expect(await rows.count(), "several references are named").toBeGreaterThan(1);
    for (const b of await rows.all()) expect((await b.boundingBox()).height, "each row is 44 px").toBeGreaterThanOrEqual(44);
    expect(await where(page), "no cursor moved until one is chosen").toEqual(start);
    const name = await rows.nth(1).textContent();
    await rows.nth(1).click();
    await expect(page.locator("#ol-inspect-chooser")).toBeHidden();
    await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "references");
    expect(await page.locator("#ol-inspect-position").textContent()).toContain(name.trim());
    expect(await state(page), "choosing changed nothing the page keeps").toEqual(before);
    // PR #53 review: the chosen reference is read where the finger was: the cursor's time is the tap's, not the earlier reading's
    const chosen = await where(page);
    expect(chosen.c, "the cursor's time moved to the tap's").toBeGreaterThan(start.c);
    await page.touchscreen.tap(box.x + layout[0] + layout[2] * 0.9, box.y + layout[1] + layout[3] * 0.02);
    await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
    expect(chosen.c, "the same column as a tap at that time on a place with no reference").toBe((await where(page)).c);
  });

  // the gap rectangle the plot draws (a 1 px outline at 70%): the one that is tall and wide enough for its middle to be farther than a finger's reach from every edge.
  // (Each of the two taps below is on a page of its own: the readout a first tap leaves lies where the second would land.)
  async function openGap(page, fake, probe, pane) {
    await open(page, fake, probe, "#w=30d&vis=2&lines=cme");
    const { box } = await plot(page),
      gap = (await pane.last()).strokeRects.find((r) => r.alpha === 0.7 && r.width === 1 && r.w > 52 && r.h > 100);
    expect(gap, "a tall gap is drawn on the standard cube's month").toBeTruthy();
    await page.keyboard.press("e");
    return { box, gap };
  }
  test("a CME gap is found by its outline: a tap on the border reads the gap", async ({ page, probe, fakeFor, pane }) => {
    const { box, gap } = await openGap(page, await fakeFor("standard"), probe, pane);
    await page.touchscreen.tap(box.x + gap.x, box.y + gap.y + gap.h / 2);
    await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
    expect((await where(page)).surface, "on its outline: the gap is read").toBe("references");
    await expect(page.locator("#ol-inspect-readout")).toContainText("Friday close");
    expect(await page.locator("#ol-inspect-position").textContent()).toMatch(/^Binance spot weekend proxy · /);
  });
  test("a CME gap is not found by its inside: a tap well inside it reads the cell", async ({ page, probe, fakeFor, pane }) => {
    const { box, gap } = await openGap(page, await fakeFor("standard"), probe, pane);
    await page.touchscreen.tap(box.x + gap.x + gap.w / 2, box.y + gap.y + gap.h / 2);
    await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
    expect((await where(page)).surface, "inside the gap, away from its outline: the cell is read").toBe("cells");
    await expect(page.locator("#ol-inspect-readout")).not.toContainText("Friday close");
  });

  test("the large-target resolution steppers reach every level of the lattice, n = 0..20 and m = 0..9, with 44 px taps and nothing else changed", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&mode=volume");
    await page.locator("#ol-res").click();
    const tap = async (selector) => {
      const b = await page.locator(selector).boundingBox();
      expect(Math.min(b.width, b.height), `${selector} is a 44 px target`).toBeGreaterThanOrEqual(44);
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(120);
    };
    const level = async () => ({ n: Number((await page.locator("#ol-n").textContent()).replace(/\D/g, "")), m: Number((await page.locator("#ol-m").textContent()).replace(/\D/g, "")) });
    // time: all the way down to the finest column, then all the way up to the coarsest; the lattice of the page's documentation (docs/data-and-semantics.md)
    const seen = { n: new Set(), m: new Set() };
    const walk = async (axis, down, up) => {
      seen[axis].add((await level())[axis]);
      for (let i = 0; i < 40 && (await page.locator(down).isEnabled()); i++) {
        await tap(down);
        seen[axis].add((await level())[axis]);
      }
      expect(await page.locator(down).isDisabled(), `${down} ends at the lattice's edge`).toBe(true);
      for (let i = 0; i < 40 && (await page.locator(up).isEnabled()); i++) {
        await tap(up);
        seen[axis].add((await level())[axis]);
      }
      expect(await page.locator(up).isDisabled(), `${up} ends at the lattice's other edge`).toBe(true);
    };
    const before = await state(page);
    await walk("n", "#ol-tminus", "#ol-tplus");
    await walk("m", "#ol-pminus", "#ol-pplus");
    expect([...seen.n].sort((a, b) => a - b), "every column level, with no gap").toEqual(Array.from({ length: 21 }, (_, k) => k));
    expect([...seen.m].sort((a, b) => a - b), "every row level, with no gap").toEqual(Array.from({ length: 10 }, (_, k) => k));
    const after = await state(page);
    expect(after.cases, "no anchor was made by any of the taps").toBe(before.cases);
    // the keys of the plane do the same work (the other large-target route) and a level the plane shows is the level the page is at
    const here = await level();
    expect(here.n).toBe(20);
    expect(here.m).toBe(9);
  });

  test("every DOM control is a 44 px target each way; the plane and the canvas's marks are the dense visuals, with large-target routes that are 44 px too", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await open(page, fake, probe, "#w=7d&vis=2&lines=7d,30d&rows=volume&level=25500");
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    const small = await page.evaluate(() => {
      const out = [];
      for (const n of document.querySelectorAll("#origo-lens button, #origo-lens select, #origo-lens input, #origo-lens [role=tab], #origo-lens summary, #origo-lens a")) {
        const r = n.getBoundingClientRect(),
          cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden" || (r.width === 0 && r.height === 0) || n.closest("[hidden]")) continue;
        // the resolution plane's compact buttons are a dense visual; a checkbox or radio is the target of its label
        if (n.closest("#ol-plane")) continue;
        const label = n.closest("label");
        if (n.matches('input[type="checkbox"], input[type="radio"]') && label && Math.min(label.getBoundingClientRect().width, label.getBoundingClientRect().height) >= 44) continue;
        if (Math.min(r.width, r.height) < 44) out.push(`${n.tagName}#${n.id || ""} ${Math.round(r.width)}x${Math.round(r.height)} ${(n.getAttribute("aria-label") || n.textContent || "").trim().slice(0, 24)}`);
      }
      return out;
    });
    expect(small, small.join("\n")).toEqual([]);
    // the large-target routes of the dense visuals exist and are among those measured: the level's steppers, the navigator's steppers and chooser
    await page.locator("#ol-res").click();
    for (const sel of ["#ol-tminus", "#ol-tplus", "#ol-pminus", "#ol-pplus", '#ol-inspect [data-step="left"]', '#ol-inspect [data-step="up"]', "#ol-inspect-reference"]) {
      const b = await page.locator(sel).boundingBox();
      expect(b, `${sel} is on the page`).not.toBeNull();
      expect(Math.min(b.width, b.height), `${sel} is a 44 px target`).toBeGreaterThanOrEqual(44);
    }
  });
});
