"use strict";
const { test: base, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const paneCanvas = require("./pane-canvas.js");
const test = base.extend({ pane: async ({ page }, use) => {
  await paneCanvas.addRecorder(page); await use(paneCanvas.forPage(page));
} });
test.use({ reducedMotion: "reduce" });

const EPOCH = Date.parse("2021-01-01T00:00Z"), BASE = 56250;
const DAY = Date.parse("2026-09-23T00:00Z") - EPOCH;
const iso = (base) => new Date(EPOCH + base * BASE).toISOString();
const start = DAY / BASE;
// Two regimes, with the later prices outside the initial price viewport.
const TRADES = Array.from({ length: 256 }, (_, i) => ({
  t_ms: DAY + (i + .5) * BASE, price: i < 96 ? 2500000 : 2600000,
  qty: i < 96 ? 100000000 : 200000000, takerBuy: i % 2 === 0,
}));
const profile = (trades = TRADES, cutoff = start + 256) => ({ name: "visible-range", trades, cutoffIso: iso(cutoff) });
const hash = (a = 32, b = 96, extra = "") => `#t=${iso(start + a)}~${iso(start + b)}&p=24500~25500&r=4,0&f=free&vis=2${extra}`;
const value = (page, key) => page.locator(`[data-line-value="${key}"]`);
const numeric = async (page, key) => Number((await value(page, key).textContent()).replace(/[^\d.-]/g, ""));
async function menu(page) {
  if (await page.locator("#ol-lines-pop").isHidden()) await page.locator("#ol-lines").click();
}
async function closeMenu(page) {
  if (await page.locator("#ol-lines-pop").isVisible()) await page.keyboard.press("Escape");
}
function camera(page) {
  const p = new URLSearchParams(new URL(page.url()).hash.slice(1));
  return p.get("t").split("~").map((s) => (Date.parse(s) - EPOCH) / BASE);
}
function oracle(trades, a, b) {
  const rows = new Map(); let volume = 0, btc = 0;
  for (const t of trades) if (t.t_ms >= a * BASE && t.t_ms < b * BASE) {
    const v = t.price * t.qty / 1e10, r = Math.floor(t.price / 100 / 125);
    rows.set(r, (rows.get(r) || 0) + v); volume += v; btc += t.qty / 1e8;
  }
  const row = [...rows].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0];
  return { poc: row === undefined ? null : (row + .5) * 125, vwap: btc ? Math.round(volume / btc * 100) / 100 : null };
}
async function correct(page, trades = TRADES, edge = Infinity) {
  await menu(page);
  const [a, b] = camera(page).map((x) => Math.floor(x + .5)), want = oracle(trades, a, Math.min(b, edge));
  await expect.poll(() => numeric(page, "visible")).toBe(want.poc);
  await expect.poll(() => numeric(page, "vvwap")).toBe(want.vwap);
  return want;
}
async function pan(page, dx, dy = 0) {
  await closeMenu(page); const p = await D.plot(page);
  await D.drag(page, D.point(p, .8, .5), D.point(p, .8 + dx, .5 + dy));
}

test("visible-range options toggle, draw their levels and persist through reload", async ({ page, fakeFor, pane }) => {
  const fake = await fakeFor(profile());
  await page.goto(fake.url + "/" + hash()); await D.ready(page); await menu(page);
  await page.locator('[data-line="visible"]').check();
  await page.locator('[data-line="va"]').check();
  await page.locator("#ol-family-vwap-head").click();
  await page.locator('[data-line="vvwap"]').check();
  await correct(page);
  await closeMenu(page);
  await expect.poll(async () => paneCanvas.textsOf(await pane.frame())).toEqual(expect.arrayContaining(["Visible", "Visible VAH", "Visible VAL", "Visible VWAP"]));
  const p = new URLSearchParams(new URL(page.url()).hash.slice(1));
  expect(p.get("lines").split(",")).toEqual(["visible", "va", "vvwap"]);
  await page.reload(); await D.ready(page); await correct(page);
  for (const key of ["visible", "va", "vvwap"]) await expect(page.locator(`[data-line="${key}"]`)).toBeChecked();
});

test("time pan and zoom recalculate visible levels while period POC stays fixed", async ({ page, fakeFor }) => {
  const fake = await fakeFor(profile());
  await page.goto(fake.url + "/" + hash(32, 96, "&lines=visible,1d,vvwap"));
  await D.ready(page); const before = await correct(page), fixed = await numeric(page, "1d");
  await pan(page, -.75); const after = await correct(page);
  expect(after.poc).not.toBe(before.poc); expect(after.vwap).not.toBe(before.vwap);
  expect(await numeric(page, "1d")).toBe(fixed);
  await closeMenu(page); const p = await D.plot(page), oldCamera = camera(page);
  await page.mouse.move(p.x + p.width * .5, p.y + p.height * .5); await page.mouse.wheel(0, -350);
  await expect.poll(() => camera(page)).not.toEqual(oldCamera);
  await correct(page);
});

test("price pan, price resolution and selection cannot redefine the visible time range", async ({ page, fakeFor }) => {
  const fake = await fakeFor(profile());
  await page.goto(fake.url + "/" + hash(32, 144, `&lines=visible,vvwap&sel=${iso(start + 32)}~${iso(start + 48)},25000~25125`));
  await D.ready(page); const before = await correct(page);
  // Visible prices exclude 26,000, and selection contains only 25,000.
  expect(before.poc).toBe(26062.5); expect(before.vwap).toBe(25600);
  await closeMenu(page); await fake.idle(); fake.clearLog(); const oldTime = camera(page);
  await pan(page, 0, .2); await correct(page);
  expect(camera(page)).toEqual(oldTime);
  await fake.idle(); expect(fake.log().filter((r) => r.path === "/cube/bars")).toHaveLength(0);
  await page.goto(fake.url + "/" + hash(32, 144, "&lines=visible,vvwap").replace("r=4,0", "r=4,3").replace("p=24500~25500", "p=27000~28000"));
  await D.ready(page); await correct(page);
});

test("both ranges stop at the replay edge, excluding later trades", async ({ page, fakeFor }) => {
  const fake = await fakeFor(profile());
  await page.goto(fake.url + "/" + hash(32, 160, `&lines=visible,vvwap&replay=1&at=${iso(start + 80)}`));
  await D.ready(page); const want = await correct(page, TRADES, start + 80);
  expect(want).toEqual({ poc: 25062.5, vwap: 25000 });
  await fake.idle();
  const reads = fake.log().filter((r) => r.path === "/cube/bars");
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every((r) => Number(r.query.b1[0]) <= start + 80)).toBe(true);
});

test("VWAP clips both coarse boundary bars instead of importing outside trades", async ({ page, fakeFor }) => {
  const trades = [[12.5, 1000, 999], [13.5, 25000, 1], [14.5, 26000, 2], [8199.5, 27000, 1], [8201.5, 40000, 999]].map(([c, price, qty]) => ({
    t_ms: DAY + c * BASE, price: price * 100, qty: qty * 1e8, takerBuy: true,
  }));
  const fake = await fakeFor(profile(trades, start + 9000));
  await page.goto(fake.url + "/" + hash(13, 8201, "&lines=visible,vvwap"));
  await D.ready(page); await correct(page, trades);
  expect(await numeric(page, "vvwap")).toBe(26000);
  await fake.idle(); const read = fake.log().find((r) => r.path === "/cube/bars");
  expect(Number(read.query.n[0])).toBeGreaterThan(0);
  expect(read.query.b0[0]).toBe(String(start + 13)); expect(read.query.b1[0]).toBe(String(start + 8201));
});

test("pending historical POC and VWAP never display the previous range's values", async ({ page, fakeFor }) => {
  const fake = await fakeFor(profile(TRADES, start + 60 * 1536));
  await page.goto(fake.url + "/" + hash(32, 96, "&lines=visible,vvwap"));
  await D.ready(page); await correct(page); await fake.idle();
  const pocGate = fake.on({ route: "/cube/query", when: (q) => !("r0" in q) }).gate();
  const vwapGate = fake.on({ route: "/cube/bars" }).gate();
  await pan(page, -.75); await pocGate.arrived(); await menu(page);
  await expect(value(page, "visible")).toHaveText("…");
  await expect(value(page, "vvwap")).toHaveText("…");
  pocGate.open(); await vwapGate.arrived(); vwapGate.open(); await correct(page);
});

test("empty and failed range VWAPs remain explicit non-values", async ({ page, fakeFor, allowConsole }) => {
  const fake = await fakeFor(profile([]));
  await page.goto(fake.url + "/" + hash(32, 96, "&lines=visible,vvwap"));
  await D.ready(page); await menu(page);
  await expect(value(page, "visible")).toHaveText("no trades");
  await expect(value(page, "vvwap")).toHaveText("no trades");
  fake.on({ route: "/cube/bars" }).fail(); allowConsole(/Failed to load resource/);
  await pan(page, -.5); await menu(page);
  await expect(value(page, "vvwap")).toHaveText("unavailable");
  await expect(page.locator('[data-family-status="vwap"]')).toContainText("couldn't be read");
});

test("recorded mode offers visible POC and explicitly disables VWAP", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("recorded");
  await page.goto(fake.url + "/#w=24h&lines=visible&vis=2"); await probe.waitForReady(); await menu(page);
  await expect(page.locator('[data-line="visible"]')).toBeChecked();
  await expect(value(page, "visible")).toHaveText(/[\d,]+/);
  await page.locator("#ol-family-vwap-head").click();
  await expect(page.locator('[data-line="vvwap"]')).toBeDisabled();
  await expect(value(page, "vvwap")).toHaveText("Live cube only");
});
