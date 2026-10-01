"use strict";
// B46 inspect-lens.spec.js (PRD-0002 S3, #48 section 3, touch and lens): Inspect on the lens.
//
// What is asserted, on a fake cube with a hand-made trade list:
//   1. the lens's values are the FINER record: a cell of the lens level, at its own level (a quarter of the chart's cell in time here), whose volume is the exact
//      sum of the trades in that finer cell, from the reference calculator, not the coarse cell's volume;
//   2. Inspect holds the lens frame still while the cursor moves inside it, and that is not Pin: Pin, from the lens bar, still promotes the lens region and its
//      level to the chart, and the held lens goes with it;
//   3. leaving the lens surface or Inspect restores the tool the lens came from, and the lens controls are there while it is held;
//   4. the transient lens contains Cells and no Rows: the external Rows strip is the same pixels with the lens open, held and inspected as without it, and the
//      Rows measure and period in the address are unchanged.
// Oracles (none is the code under test): tests/reference/cells.js (exact arithmetic on the integer trades), the hand-made trade list below, the address read back.
const { test: base, expect } = require("./fixtures.js");
const reference = require("../reference/index.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./rows-support.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

const EPOCH_MS = Date.parse("2021-01-01T00:00:00Z");
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ms = (iso) => Date.parse(iso) - EPOCH_MS;
const iso = (t) => new Date(t + EPOCH_MS).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");
const TE = ms("2026-09-01T00:00:00Z");
// a busy path: a trade every 100 s with a drift and a swing, quantities that differ so that one finer cell's volume is not another's
function price(t) {
  return 25000 + 150 * Math.sin((2 * Math.PI * t) / (9 * HOUR)) + 40 * Math.sin((2 * Math.PI * t) / (1.3 * HOUR));
}
const TRADES = (() => {
  const out = [];
  for (let k = Math.ceil((TE - 12 * HOUR) / 100000); ; k++) {
    const t = k * 100000 + 17000;
    if (t > TE + 3 * DAY) break;
    out.push({ t_ms: t, price: Math.round(price(t) * 100), qty: 100000 + ((k * 7919) % 400000), takerBuy: k % 3 !== 0 });
  }
  return out;
})();
const CUTOFF = iso(TE + 3 * DAY);

async function ready(page, fake, probe) {
  await expect.poll(() => fake.log().some((e) => e.path === "/cube/pack" && e.query.since), { message: "startup is over", timeout: 120000 }).toBe(true);
  await S.atRest(page, fake, probe);
}
const nav = (page) => page.locator("#ol-inspect").evaluate((n) => ({ c: Number(n.dataset.c), r: Number(n.dataset.r), ts: Number(n.dataset.ts), ps: Number(n.dataset.ps), surface: n.dataset.surface, inside: n.dataset.inside }));
const strip = (page, layout) =>
  page.evaluate(([x, y, w, h]) => Array.from(document.getElementById("ol-canvas").getContext("2d").getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data).join(","), layout);

test.describe("B46 Inspect on the lens", () => {
  test("the lens's values are the finer record, held still for the cursor; Pin still pins; the Rows strip never changes", async ({ page, probe, fakeFor, pane }) => {
    const fake = await fakeFor({ trades: TRADES, cutoffIso: CUTOFF });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#t=${iso(TE - 6 * HOUR)}~${iso(TE + 54 * HOUR)}&p=24600~25400&r=6,3&vis=2&rows=volume&period=7d`);
    await ready(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    const layout = (await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout)).split(",").map(Number),
      box = await page.locator("#ol-canvas").boundingBox(),
      stripArea = [layout[4], layout[1], layout[5], layout[3]];
    const rowsAddress = (hash) => (/rows=\w+/.exec(hash) ?? [""])[0] + (/period=[\w-]+/.exec(hash) ?? [""])[0];
    const before = { strip: await strip(page, stripArea), rows: rowsAddress(await page.evaluate(() => location.hash)) };
    expect(before.rows, "the Rows underlay and its period are in the address").toContain("rows=volume");
    // the lens tool, with the lens over the middle of the plot
    await page.keyboard.press("l");
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
    await expect.poll(async () => (await pane.last()).texts.some((t) => /^Lens/.test(t.text)), { message: "the lens is drawn with its caption", timeout: 60000 }).toBe(true);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    expect(await strip(page, stripArea), "the Rows strip is the same pixels with the lens open").toBe(before.strip);
    // Inspect on the lens: E holds the lens still and starts the cursor in it
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "lens");
    expect(await page.locator("#ol-inspect-position").textContent()).toMatch(/^Lens · /);
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await probe.waitForQuiet({ quietMs: 600, timeout: 60000 });
    await expect(page.locator("#ol-lens-pin"), "the lens controls are there while it is held, Pin among them").toBeVisible();
    expect(await strip(page, stripArea), "and the strip is the same with the lens held and inspected").toBe(before.strip);
    // walk the cursor to a finer cell that has trades and compare its volume with the reference's exact sum over that cell
    let found = null;
    for (let step = 0; step < 40 && !found; step++) {
      const readout = page.locator("#ol-inspect-readout dd[data-field='volume']");
      if (await readout.count()) found = Number(await readout.first().getAttribute("data-canonical"));
      else await page.locator("#ol-inspect").focus().then(() => page.keyboard.press(step % 7 === 6 ? "ArrowUp" : "ArrowRight"));
    }
    expect(found, "a finer cell with trades is under the cursor").not.toBeNull();
    const at = await nav(page);
    expect(at.ts, "the lens is finer in time than the chart's 64-column cells").toBeLessThan(64);
    expect(at.ps, "and in price").toBeLessThan(8);
    const ref = reference.cells(TRADES, { n: Math.log2(at.ts), m: Math.log2(at.ps), b0: at.c * at.ts, b1: (at.c + 1) * at.ts, r0: at.r * at.ps, r1: (at.r + 1) * at.ps });
    expect(ref.length, "the reference has the cell").toBe(1);
    expect(found, "its volume is the reference's exact sum for the finer cell, not the coarse cell's").toBeCloseTo(Number(ref[0].v), 3);
    await expect(page.locator("#ol-inspect-readout")).toContainText("finer record");
    // leaving the lens surface lets the lens go and Inspect stays; Escape leaves for the tool the lens came from
    await page.locator('[data-surface="cells"]').click();
    await expect(page.locator("#ol-lens-pin")).toBeHidden();
    await page.locator('[data-surface="lens"]').click();
    await expect(page.locator("#ol-lens-pin")).toBeVisible();
    await page.locator("#ol-inspect").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect")).toBeHidden();
    await expect(page.locator('[data-tool="lens"]'), "the tool the lens came from is the tool again").toHaveAttribute("aria-pressed", "true");
    // and Pin, which is not Inspect, still promotes the lens region: hold it again, then press Pin
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
    await page.keyboard.press("e");
    const hashBefore = await page.evaluate(() => location.hash);
    await page.locator("#ol-lens-pin").click();
    await expect.poll(() => page.evaluate(() => location.hash), { message: "Pin makes the lens region the view", timeout: 30000 }).not.toBe(hashBefore);
    await expect(page.locator("#ol-lens-pin"), "the held lens went with the pin").toBeHidden();
    expect(rowsAddress(await page.evaluate(() => location.hash)), "the Rows measure and period are unchanged by it").toBe(before.rows);
  });
});
