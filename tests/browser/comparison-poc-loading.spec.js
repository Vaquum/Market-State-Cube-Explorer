"use strict";
// Ready Lines must remain available when recorded tiers arrive or an expanded comparison reloads.
// Oracles: independently decoded MSC1 overview rows with exact rational sums, and mixed.json's hand POC.
const { test, expect } = require("./fixtures.js");
const snapshot = require("../reference/snapshot.js");
const rational = require("../reference/rational.js");
test.use({ reducedMotion: "reduce" });
const KEY = "market-state-cube-explorer:comparison:v1:BTC/USDT", WORK = "#ol-comparisonWorkspace";
const RECORDED = "#w=24h&r=4,0&auto=0&vis=2&marks=none&lines=";
const MIXED = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&marks=none&lines=";
const picker = (page) => page.locator(`${WORK} [data-comparison-control="poc"]`);
const saved = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), KEY);
const reads = (fake) => fake.log().filter((entry) => entry.path.startsWith("/cube/") && entry.path !== "/cube/pack");
function recordedPoc() {
  const { pack, blocks } = snapshot.loadSnapshot(), block = blocks.overview, step = 2 ** block.n;
  const end = Math.ceil((Date.parse(pack.cutoff) / 1000 - pack.t0) / pack.base_seconds), start = end - 90 * 1536;
  const rows = new Map();
  // Only whole overview columns after the requested start are observable; the snapshot owns its cutoff column.
  for (let i = 0; i < block.count; i++) {
    const at = block.col[i] * step;
    if (at < Math.ceil(start / step) * step || at >= end) continue;
    const row = block.row[i];
    rows.set(row, rational.add(rows.get(row) || rational.ZERO, rational.fromDouble(block.vol[i])));
  }
  const ordered = [...rows].sort(([a], [b]) => a - b);
  let peak = null, maximum = rational.ZERO;
  for (const [row, total] of ordered) if (rational.cmp(total, maximum) > 0) { peak = row; maximum = total; }
  if (peak === null) throw new Error("The independent recorded 90-day profile is empty");
  return { period: "90d", price: (peak + .5) * 2 ** block.m * pack.base_price, rowSize: 2 ** block.m * pack.base_price,
    approximate: true, from: (pack.t0 + start * pack.base_seconds) * 1000, through: (pack.t0 + end * pack.base_seconds) * 1000 };
}
async function assertChoice(page, fake, expected) {
  const select = picker(page);
  await expect(select.locator("option")).toHaveCount(2);
  const id = await select.locator("option").nth(1).getAttribute("value");
  const before = await saved(page), stats = await page.evaluate(() => window.__probe.stats());
  fake.clearLog();
  await select.selectOption(id);
  await expect.poll(async () => (await saved(page))?.poc?.id).toBe(id);
  const after = await saved(page);
  expect(after.poc).toMatchObject(expected);
  expect(after.poc.supportEnd).toBe(expected.through); expect(after.poc.knownThrough).toBe(expected.through);
  expect(after.captures).toEqual(before?.captures || []);
  expect(reads(fake)).toHaveLength(0);
  return stats;
}

test("recorded long-period POC becomes selectable when startup tiers replace an equally sized Lines cache", async ({ page, fakeFor, probe }) => {
  // Hold the second startup decode: the initial recent-only draw must cache the unloaded 90-day period first.
  await page.addInitScript(() => {
    let calls = 0, release;
    const gate = new Promise((resolve) => { release = resolve; }), original = Response.prototype.arrayBuffer;
    window.__comparisonTierGate = { waiting: false, open: () => release() };
    Response.prototype.arrayBuffer = async function (...args) {
      if (++calls === 2) { window.__comparisonTierGate.waiting = true; await gate; }
      return original.apply(this, args);
    };
  });
  const fake = await fakeFor("recorded"), expected = recordedPoc();
  await page.goto(fake.url + "/" + RECORDED + "90d");
  await expect.poll(() => page.evaluate(() => window.__comparisonTierGate.waiting)).toBe(true);
  await page.locator("#ol-tab-compare").click();
  await expect(picker(page).locator("option")).toHaveCount(1);
  await page.evaluate(() => window.__comparisonTierGate.open());
  await expect(page.locator("#ol-loading")).toBeHidden();
  await probe.waitForReady({ timeout: 30000 }); await probe.waitForQuiet({ quietMs: 300 });
  // Lines itself already owns the ready result; Compare must expose it without toggling or asking for it again.
  await page.locator("#ol-lines").click();
  await expect(page.locator('[data-line-value="90d"]')).toContainText(expected.price.toLocaleString("en-US"));
  await page.keyboard.press("Escape");
  await assertChoice(page, fake, expected);
  expect(fake.log().filter((entry) => entry.path.startsWith("/cube/"))).toHaveLength(0);
});

for (const [profile, hash, period] of [["micro:mixed", MIXED, "1d"], ["recorded", RECORDED, "90d"]]) {
  test(`expanded ${profile} reload offers its loaded Lines POC without hidden chart work or reads`, async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor(profile);
    await page.goto(fake.url + "/" + hash);
    await expect(page.locator("#ol-loading")).toBeHidden();
    await probe.waitForReady({ timeout: 30000 }); await probe.waitForQuiet({ quietMs: 300 });
    // Enable after full startup to isolate expanded reload from the recorded cache replacement regression above.
    await page.locator("#ol-lines").click(); await page.locator(`input[data-line="${period}"]`).check();
    await page.keyboard.press("Escape"); await probe.waitForQuiet({ quietMs: 300 });
    await page.locator("#ol-tab-cells").click();
    await page.locator("#ol-table-body tr").first().getByRole("button", { name: "Add to comparison" }).click();
    await expect.poll(async () => (await saved(page))?.captures.length).toBe(1);
    await expect(picker(page).locator("option")).toHaveCount(2);
    const id = await picker(page).locator("option").nth(1).getAttribute("value");
    const expected = profile === "recorded" ? recordedPoc() : { period: "1d", price: 25062.5, rowSize: 125, approximate: false,
      from: Date.parse("2021-01-01T00:00:00Z"), through: Date.parse("2021-01-01T00:05:37.500Z") };
    await page.locator(`${WORK} [data-comparison-action="expand"]`).click();
    await expect.poll(async () => (await saved(page))?.expanded).toBe(true);
    const before = await saved(page); expect(before.poc).toBeNull();
    fake.clearLog(); await page.reload();
    await expect(page.locator(`${WORK} [data-comparison-action="expand"]`)).toHaveText("Restore chart");
    await expect(page.locator("#ol-canvas")).toBeHidden(); await expect(page.locator("#ol-side")).toHaveJSProperty("inert", true);
    await expect(page.locator("#ol-loading")).toBeHidden(); await probe.waitForQuiet({ quietMs: 300 });
    expect((await probe.stats()).drawFrames).toBe(0);
    expect(reads(fake)).toHaveLength(0);
    await expect(picker(page).locator("option")).toHaveCount(2);
    await expect(picker(page).locator("option").nth(1)).toHaveAttribute("value", id);
    const stats = await assertChoice(page, fake, expected);
    expect((await saved(page)).captures).toEqual(before.captures);
    expect((await saved(page)).expanded).toBe(true);
    const after = await probe.stats();
    expect(after.drawFrames).toBe(0); expect(after.widthSets).toBe(stats.widthSets); expect(after.heightSets).toBe(stats.heightSets);
    await expect(page.locator("#ol-canvas")).toBeHidden(); expect(reads(fake)).toHaveLength(0);
  });
}
