"use strict";
// B42 focus-inventory.spec.js (PRD-0002 S3, #48 section 2): Focus and Show all, and the inventory of references.
//
// What is asserted:
//   1. every enabled line has a Focus control and every family one; Focus draws the line one pixel wider (2.5 px, inside the 4.5 px backing maximum) and
//      changes nothing else: not the other lines, not any hue, not the enabled set, not the address and not the browser's storage; "Show all", from the
//      Lines menu or from the chip, ends it; a reload does not bring it back; disabling the focused line ends it;
//   2. the inventory says how many of the references that are on are shown, over all of them, and gives each one that is not shown exactly one reason:
//      off screen, warming up, needs a closer zoom, no event to draw, too close together to draw; the canvas carries the numbers, the Lines menu the words and
//      each row its own reason;
//   3. over the 20% budget the references held back are counted in the inventory with the reason `occlusion`, and shown plus held back is all that is on.
// Oracles (none is the code under test): the PRD's reason list written out in the spec, the stroke numbers of #47 (1.5, +1, at most 4.5 with backing), the
// hand-made trade list below (a month of drift and one rally, so a 200-day average cannot have a value and a golden cross cannot exist), and the design
// tokens read back through a canvas.
const { test: base, expect } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

async function ready(page, fake, probe) {
  await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { message: "startup is over", timeout: 120000 }).toBe(true);
  await S.atRest(page, fake, probe);
}

const EPOCH_MS = Date.parse("2021-01-01T00:00:00Z");
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ms = (iso) => Date.parse(iso) - EPOCH_MS;
const iso = (t) => new Date(t + EPOCH_MS).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");
const TE = ms("2026-09-01T00:00:00Z");
function price(t) {
  const dt = t - TE,
    drift = 25000 + 40 * Math.sin((2 * Math.PI * t) / (14 * HOUR));
  if (dt < 0) return drift;
  if (dt < 10 * HOUR) return drift + 700 * (dt / (10 * HOUR));
  if (dt < 16 * HOUR) return 25700 + 5 * Math.sin((2 * Math.PI * t) / (3 * HOUR));
  if (dt < 16 * HOUR + 600000) return 25700 - 700 * ((dt - 16 * HOUR) / 600000);
  return drift;
}
function tradesOf(from, to) {
  const out = [];
  for (let k = Math.ceil((from - 150000) / 300000); ; k++) {
    const t = k * 300000 + 150000;
    if (t > to) break;
    out.push({ t_ms: t, price: Math.round(price(t) * 100), qty: 400000, takerBuy: k % 2 === 0 });
  }
  return out;
}
const TRADES = tradesOf(ms("2026-08-02T00:00:00Z"), TE + 3 * DAY);
const CUTOFF = iso(TE + 3 * DAY);

const horizontal = (k) => k.path.length >= 2 && k.path.every((p, i) => i % 2 === 0 || p[1] === k.path[i - 1][1]);
const wide = (k) => Math.max(...k.path.map((p) => p[0])) - Math.min(...k.path.map((p) => p[0])) > 100;
const poc = async (pane, hue) => (await pane.last()).strokes.filter((k) => k.stroke === hue && horizontal(k) && wide(k));
const widths = (strokes) => [...new Set(strokes.map((k) => k.width))].sort();

test.describe("B42 Focus and Show all", () => {
  test("Focus draws one line a pixel wider and changes nothing else; Show all, a reload and turning the line off end it", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=1d,7d,30d,90d`);
    await S.atRest(page, fake, probe);
    const colours = await pane.colours(),
      hue = colours.poc;
    await expect.poll(async () => (await poc(pane, hue)).length, { message: "the POC lines are drawn", timeout: 60000 }).toBeGreaterThan(0);
    expect(widths(await poc(pane, hue)), "at rest every line is 1.5 px").toEqual([1.5]);
    await page.locator("#ol-lines").click();
    // 1. the controls: a Focus button on each enabled row and on each family; Show all is off until something is focused
    for (const key of ["1d", "7d", "30d", "90d"]) await expect(page.locator(`[data-line-focus="${key}"]`)).toBeEnabled();
    await expect(page.locator('[data-line-focus="wk"]'), "a line that is off cannot be focused").toBeDisabled();
    await expect(page.locator('[data-focus-family="profile"]')).toBeEnabled();
    await expect(page.locator('[data-focus-family="session"]'), "a family with nothing on cannot be focused").toBeDisabled();
    await expect(page.locator("#ol-lines-showall")).toBeDisabled();
    await expect(page.locator("#ol-focus-chip")).toBeHidden();
    const before = await page.evaluate(() => ({ hash: location.hash, storage: JSON.stringify({ ...localStorage }), checked: [...document.querySelectorAll("#ol-lines-pop input[data-line]:checked")].map((b) => b.dataset.line) }));
    // Focus the 7-day line
    await page.locator('[data-line-focus="7d"]').click();
    await expect(page.locator("#ol-focus-chip")).toBeVisible();
    await expect(page.locator("#ol-focus-chip")).toHaveText("Focus: 7 days · Show all");
    await expect(page.locator('[data-line-focus="7d"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ol-lines-showall")).toBeEnabled();
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    const focused = await poc(pane, hue);
    expect(widths(focused), "the focused line is 1 px wider, the others as they were").toEqual([1.5, 2.5]);
    for (const k of (await pane.last()).strokes.filter((k) => k.stroke === colours.surface && k.width > 2)) expect(k.width, "its backing stays within 4.5 px").toBeLessThanOrEqual(4.5);
    const after = await page.evaluate(() => ({ hash: location.hash, storage: JSON.stringify({ ...localStorage }), checked: [...document.querySelectorAll("#ol-lines-pop input[data-line]:checked")].map((b) => b.dataset.line) }));
    expect(after.hash, "the address is unchanged").toBe(before.hash);
    expect(after.storage, "nothing is saved: no focus in the browser's storage").toBe(before.storage);
    expect(after.checked, "the enabled set is unchanged").toEqual(before.checked);
    // Show all from the menu
    await page.locator("#ol-lines-showall").click();
    await expect(page.locator("#ol-focus-chip")).toBeHidden();
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    expect(widths(await poc(pane, hue))).toEqual([1.5]);
    // a family's focus, ended from the chip
    await page.locator('[data-focus-family="profile"]').click();
    await expect(page.locator("#ol-focus-chip")).toHaveText("Focus: Volume profile · Show all");
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    expect(widths(await poc(pane, hue)), "every line of the family is a pixel wider").toEqual([2.5]);
    await page.locator("#ol-focus-chip").click();
    await expect(page.locator("#ol-focus-chip")).toBeHidden();
    // (a click on the chip is a click outside the menu, which closes it: open it again)
    await page.locator("#ol-lines").click();
    // turning the focused line off ends its focus
    await page.locator('[data-line-focus="30d"]').click();
    await expect(page.locator("#ol-focus-chip")).toBeVisible();
    await page.locator('[data-line="30d"]').uncheck();
    await expect(page.locator("#ol-focus-chip")).toBeHidden();
    // a focus is not kept: set one, reload, and it is gone
    await page.locator('[data-line-focus="7d"]').click();
    await expect(page.locator("#ol-focus-chip")).toBeVisible();
    await page.reload();
    await S.atRest(page, fake, probe);
    await expect(page.locator("#ol-focus-chip"), "a reload does not bring a focus back").toBeHidden();
  });
});

test.describe("B42 a focused reference that alone passes the budget says so and stays", () => {
  test("a month of funding lines over a 30-day view passes 20% of the plot by itself: focused, it is neither thinned nor hidden, and the page says so", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=30d&vis=2&lines=funding`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    const data = () => page.locator("#ol-canvas").evaluate((el) => ({ occlusion: el.dataset.occlusion ?? "", references: el.dataset.references ?? "" }));
    expect((await data()).references, "unfocused, the budget holds the funding lines back").toBe("0/1");
    await page.locator("#ol-lines").click();
    await page.locator('[data-line-focus="funding"]').click();
    await expect.poll(async () => (await data()).occlusion, { message: "the focused mark alone passes the budget", timeout: 30000 }).toMatch(/!$/);
    expect((await data()).references, "focused, it is drawn after all: a focused reference is never thinned or hidden").toBe("1/1");
    await expect(page.locator("#ol-lines-summary")).toContainText("the focused reference alone passes the 20% budget; its row and detail are here");
    const frame = await pane.last();
    expect(frame.texts.some((t) => /The focused mark alone passes the 20% budget/.test(t.text)), "and the chart says it").toBe(true);
  });
});

test.describe("B42 the inventory of references: shown over eligible, one reason for each that is not shown", () => {
  const view = (lines, t0, t1, p = "24600~26200") => `#t=${iso(t0)}~${iso(t1)}&p=${p}&r=6,3&vis=2&lines=${lines}&replay=1&at=${iso(TE + 44 * HOUR)}`;
  const summary = async (page) => {
    // on a narrow window the controls are in a sheet: open it first
    if (!(await page.locator("#ol-lines").isVisible())) await page.locator("#ol-sheet-toggle").click();
    await page.locator("#ol-lines").click();
    const text = await page.locator("#ol-lines-summary").textContent();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-lines-pop")).toBeHidden();
    return text;
  };
  const canvasData = (page) => page.locator("#ol-canvas").evaluate((el) => ({ references: el.dataset.references ?? "", reasons: el.dataset.referenceReasons ?? "" }));

  test("off screen, warming up, no event, needs a closer zoom: each reference has one reason, counted in the eligible total", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    // a two-month view: the 15-minute bands need a closer zoom (their bars are under a quarter pixel), the 200-day average has no value yet, no golden cross
    // exists in a month of data, the 21-day EMA is drawn
    await page.goto(`${fake.url}/${view("bb15m,sma200,gdcross,ema21", TE - 56 * DAY, TE + 3 * DAY)}`);
    await ready(page, fake, probe);
    await expect.poll(async () => (await canvasData(page)).references, { message: "the averages' bars are read", timeout: 120000 }).toBe("1/4");
    const data = await canvasData(page);
    expect(data.reasons, "warm-up, a closer zoom, no event, in the table's order").toBe("warmup:1 unsupported:1 none:1");
    const text = await summary(page);
    expect(text).toContain("1 of 4 references shown");
    expect(text).toContain("1 warming up (no value yet)");
    expect(text).toContain("1 needs a closer zoom or the live cube");
    expect(text).toContain("1 no event to draw");
    // each row says its own reason
    await page.locator("#ol-lines").click();
    await page.locator("#ol-family-average-head").click();
    const reason = (key) => page.locator(`.ol-line-row[data-ref-key="${key}"] .ol-line-reason`);
    await expect(reason("ema21")).toHaveText("");
    await expect(reason("sma200")).toHaveText("warming up");
    await expect(reason("gdcross")).toHaveText("no event");
    await expect(reason("bb15m")).toHaveText("zoom in");
    await expect(page.locator('.ol-line-row[data-ref-key="sma200"]')).toHaveAttribute("data-ref-state", "warmup");
  });

  test("an average whose bars the cube could not give is missing, with the cube's reason on its row", async ({ page, probe, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    fake.on({ route: "/cube/bars" }).fail({ status: 500, body: { error: "the bars are down" } });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${view("ema21", TE - 3 * DAY, TE + 3 * DAY)}`);
    await ready(page, fake, probe);
    await expect.poll(async () => (await canvasData(page)).reasons, { message: "its bars are missing", timeout: 120000 }).toBe("missing:1");
    expect((await canvasData(page)).references).toBe("0/1");
    expect(await summary(page)).toContain("1 not read yet or could not be read");
  });

  test("a reference outside the price range is off screen; lines too close to draw are too close; both stay counted", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${view("7d", TE - 3 * DAY, TE + 3 * DAY, "30000~31000")}`);
    await ready(page, fake, probe);
    await expect.poll(async () => (await canvasData(page)).reasons, { message: "the line is off the plot", timeout: 60000 }).toBe("offscreen:1");
    expect((await canvasData(page)).references).toBe("0/1");
    expect(await summary(page)).toContain("1 off screen (its tag at the edge and its row remain)");
  });

  test("funding every 8 hours in a view of a year is too close to draw, and is still counted", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=1y&vis=2&lines=funding`);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await canvasData(page)).reasons, { message: "the clock's lines are too close", timeout: 60000 }).toBe("density:1");
    expect((await canvasData(page)).references).toBe("0/1");
    expect(await summary(page)).toContain("1 too close together to draw at this zoom");
  });

  test("over the budget the references held back are counted with their reason: shown and held back are everything that is on", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 760, height: 520 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=1d,wk,7d,mo,30d,90d,yr,1y,3y,cday,funding,usopen`);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => /occlusion:\d+/.test((await canvasData(page)).reasons), { message: "some references are held back by the budget", timeout: 60000 }).toBe(true);
    const data = await canvasData(page);
    const [shown, eligible] = data.references.split("/").map(Number),
      held = Number(/occlusion:(\d+)/.exec(data.reasons)[1]);
    expect(eligible, "all twelve are on and supported").toBe(12);
    const others = [...data.reasons.matchAll(/(\w+):(\d+)/g)].filter((m) => m[1] !== "occlusion").reduce((a, m) => a + Number(m[2]), 0);
    expect(shown + held + others, "every reference is counted once").toBe(eligible);
    expect(held, "some are held back").toBeGreaterThan(0);
    expect(await summary(page)).toContain(`${held} held back by the 20% budget`);
  });
});
