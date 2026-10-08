"use strict";
// PRD-0007 S1. Independent oracle: seven one-trade 56.25s intervals at the
// same UTC weekday/clock, quote volumes 100..700. Six prior matches mean 350;
// the target seasonal ratio is 2. Reported records are counts, not orders.
// These vectors test Explorer and the fake wire, not a live Origo certificate.
const { test, expect } = require("./fixtures.js");
const DAY = 86400000, WEEK = 7 * DAY;
const trades = Array.from({ length: 7 }, (_, i) => ({ t_ms: i * WEEK + 1000, price: 2500000, qty: (i + 1) * 400000, takerBuy: i % 2 === 0 }));
const VIEW = "#t=2021-02-12T00:00Z~2021-02-12T00:03Z&p=24875~25250&r=0,0&vis=2";
test.use({ reducedMotion: "reduce", viewport: { width: 1920, height: 1080 } });
async function open(page, fakeFor, probe, pane = "volume") {
  const fake = await fakeFor({ trades, cutoffIso: "2021-02-12T00:03:00Z" });
  await page.goto(`${fake.url}/${VIEW}&${pane === "takertrades" ? "pane=cells&mode=flowtrades" : pane === "cascade" ? "pane=cells&mode=cascade" : "pane=" + pane}`);
  await probe.waitForReady();
  await page.keyboard.press("e");
  await page.locator('[data-surface="columns"]').click();
  await page.locator("#ol-inspect").focus();
  await page.keyboard.press("Home");
  return fake;
}
for (const [pane, expected] of [["volume", 700], ["trades", 1], ["size", 700], ["delta", 700], ["takertrades", 1], ["choppiness", "undefined"], ["perpath", "undefined"], ["cascade", 1], ["efficiency", .514]]) {
  test(`${pane}: primary remains canonical with three readable companion slots`, async ({ page, fakeFor, probe }) => {
    await open(page, fakeFor, probe, pane);
    const card = page.locator("#ol-inspect-readout");
    await expect(card).toHaveAttribute("data-presentation", "core");
    const figures = card.locator(".ol-core-stats > .ol-cell-stat");
    await expect(figures).toHaveCount(4);
    if (typeof expected === "number") await expect.poll(async () => Number(await figures.first().locator("dd").getAttribute("data-canonical"))).toBeCloseTo(expected, 14);
    else await expect(figures.first().locator("dd")).toHaveAttribute("data-canonical", expected);
    await probe.waitForReady();
    // Measure geometry after the optional reads and their committed draw settle.
    await expect.poll(() => figures.locator("dd").evaluateAll((nodes) => nodes.map((n) => parseFloat(getComputedStyle(n).fontSize)))).toEqual([28, 18, 18, 18]);
    const geometry = await figures.locator("dd").evaluateAll((nodes) => nodes.map((n) => ({ bottom: n.getBoundingClientRect().bottom, width: n.getBoundingClientRect().width, connected: n.isConnected, html: n.outerHTML, detail: n.closest("details")?.outerHTML.slice(0, 120) })));
    for (const box of geometry) { expect(box.bottom).toBeLessThan(1080); expect(box.width, JSON.stringify(box)).toBeGreaterThan(0); }
    if (["choppiness", "perpath"].includes(pane)) await expect(card.locator('dd[data-field="volume"]')).toHaveAttribute("data-canonical", "700");
    const record = JSON.parse(await card.getAttribute("data-observation"));
    expect(record.version).toBe("card-observation@1"); expect(record.time).toEqual([64512, 64513]);
    expect(record.price).toEqual(["cascade", "efficiency"].includes(pane) ? null : [24875, 25250]); expect(record.history).toHaveLength(12);
  });
}
test("seasonal context shares one history and preserves exact six offsets and precision", async ({ page, fakeFor, probe }) => {
  const fake = await open(page, fakeFor, probe);
  const card = page.locator("#ol-inspect-readout");
  await expect(card.locator('dd[data-field="seasonal"]')).toHaveAttribute("data-canonical", "2");
  const record = JSON.parse(await card.getAttribute("data-observation")), cohort = record.denominators[0];
  expect(cohort.count).toBe(6); expect(cohort.denominator).toBe(350); expect(cohort.matches.map((x) => x.offset)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(cohort.precision).toBe("Float32");
  await fake.idle();
  expect(fake.log().filter((x) => x.path === "/cube/columns")).toHaveLength(1);
  await card.locator(".ol-cell-details > summary").click();
  await expect(card.locator(".ol-card-history").first()).toBeVisible();
  await expect(card.locator(".ol-cell-details > summary")).toBeFocused();
});

test("an uninspected pointer sweep adds no optional context reads", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades, cutoffIso: "2021-02-12T00:03:00Z" });
  await page.goto(`${fake.url}/${VIEW}&pane=volume`); await probe.waitForReady(); await fake.idle();
  fake.clearLog(); const canvas = await page.locator("#ol-canvas").boundingBox();
  for (let i = 0; i < 100; i++) await page.mouse.move(canvas.x + 50 + i * (canvas.width - 120) / 100, canvas.y + canvas.height - 90);
  await fake.idle();
  expect(fake.log().filter((e) => e.path === "/cube/columns" || e.path === "/cube/bars" || e.path === "/cube/query" && e.query.b0 === "64501")).toEqual([]);
});

test("leaving Inspect aborts optional transport; reopening retries and preserves disclosure focus", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades, cutoffIso: "2021-02-12T00:03:00Z" });
  const gate = fake.on({ route: /^\/cube\/columns/ }).gate();
  const canceled = page.waitForEvent("requestfailed", { predicate: (request) => new URL(request.url()).pathname === "/cube/columns" });
  try {
    await page.goto(`${fake.url}/${VIEW}&pane=volume`); await probe.waitForReady();
    await page.keyboard.press("e"); await page.locator('[data-surface="columns"]').click();
    await page.locator("#ol-inspect").focus(); await page.keyboard.press("Home"); await gate.arrived();
    await page.locator("#ol-inspect-exit").click(); await canceled;
    await page.keyboard.press("e"); await page.locator('[data-surface="columns"]').click();
    await page.locator("#ol-inspect").focus(); await page.keyboard.press("Home"); await gate.arrived(2);
    const disclosure = page.locator("#ol-inspect-readout .ol-cell-details > summary");
    await disclosure.click(); gate.open();
    await expect(page.locator('#ol-inspect-readout dd[data-field="seasonal"]')).toHaveAttribute("data-canonical", "2");
    await expect(disclosure).toBeFocused();
    await expect(page.locator("#ol-inspect-readout .ol-cell-details")).toHaveAttribute("open", "");
    expect(fake.log().filter((x) => x.path === "/cube/columns")).toHaveLength(2);
  } finally { gate.open(); }
});

test("Measures has declared profile construction and keeps raw primary counts", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed");
  await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:00:56.250Z&p=25000~25125&r=0,0&vis=2`); await probe.waitForReady();
  await expect(page.locator("#ol-vol")).toHaveAttribute("data-canonical", "300");
  await expect(page.locator("#ol-count")).toHaveAttribute("data-canonical", "2");
  await expect(page.locator(".ol-measures-profile svg")).toHaveAttribute("data-price-domain", "[25000,25125]");
  await expect(page.locator(".ol-measures-profile")).toContainText("70% and may exceed it");
  const onlyBin = page.locator(".ol-measures-profile svg rect");
  await expect(onlyBin).toHaveCount(1);
  await expect(onlyBin).toHaveAttribute("y", "4"); await expect(onlyBin).toHaveAttribute("height", "56");
  await expect(page.locator(".ol-measures-profile svg path").filter({ has: page.locator("title", { hasText: "POC centre" }) })).toHaveAttribute("d", "M2 32 H145");
  const record = JSON.parse(await page.locator("#ol-vol").evaluate((n) => n.parentElement.dataset.observation));
  expect(record.result.value).toBe(300); expect(record.time).toEqual([0, 2]); expect(record.price).toEqual([25000, 25125]);
});

for (const theme of ["light", "dark"]) test(`${theme}: compact card remains readable when the pane narrows`, async ({ page, fakeFor, probe }, testInfo) => {
  await page.emulateMedia({ colorScheme: theme }); await open(page, fakeFor, probe);
  const card = page.locator("#ol-inspect-readout");
  await expect(card.locator('dd[data-field="seasonal"]')).toHaveAttribute("data-canonical", "2");
  await page.screenshot({ path: `reports/core-cards-${theme}.png` });
  await page.setViewportSize({ width: 960, height: 540 });
  await expect(card.locator(".ol-core-stats > .ol-cell-stat")).toHaveCount(4);
  const sizes = await card.locator(".ol-core-stats dt").evaluateAll((nodes) => nodes.map((n) => parseFloat(getComputedStyle(n).fontSize)));
  expect(sizes.every((n) => n >= 14)).toBe(true);
  await page.screenshot({ path: `reports/core-cards-${theme}-narrow.png` });
  await testInfo.attach("narrow", { path: `reports/core-cards-${theme}-narrow.png`, contentType: "image/png" });
});

test("Rows off: hover and Inspect use row totals, not the cell-key map", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: [{ t_ms: 1000, price: 2500000, qty: 1200000, takerBuy: true }], cutoffIso: "2021-01-01T00:03:00Z" });
  await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:00:56.250Z&p=24875~25250&r=0,0&vis=2`);
  await probe.waitForReady();
  const canvas = page.locator("#ol-canvas"), box = await canvas.boundingBox();
  const layout = (await canvas.getAttribute("data-layout")).split(",").map(Number);
  await page.mouse.move(box.x + layout[4] + 20, box.y + layout[1] + layout[3] / 2);
  const hover = page.locator("#ol-tip");
  await expect(hover.locator('.ol-core-stats > .ol-cell-stat:first-child dd')).toHaveAttribute("data-canonical", "300");
  await expect(hover.locator('.ol-core-stats > .ol-cell-stat').nth(2).locator("dd")).toHaveAttribute("data-canonical", "1");
  await page.keyboard.press("e"); await page.locator('[data-surface="rows"]').click();
  await page.locator("#ol-inspect").focus(); await page.keyboard.press("End"); await page.keyboard.press("ArrowUp");
  const card = page.locator("#ol-inspect-readout");
  await expect(card.locator('.ol-core-stats > .ol-cell-stat:first-child dd')).toHaveAttribute("data-canonical", "300");
  await expect(card.locator('.ol-core-stats > .ol-cell-stat').nth(2).locator("dd")).toHaveAttribute("data-canonical", "1");
});

test("held empty bars retain a typed all-price response without dropping activity", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades, cutoffIso: "2021-02-12T00:03:00Z" });
  fake.on({ route: /^\/cube\/bars/, when: (q) => q.n === "0" }).empty();
  await page.goto(`${fake.url}/${VIEW}&pane=volume`); await probe.waitForReady();
  await page.keyboard.press("e"); await page.locator('[data-surface="columns"]').click();
  await page.locator("#ol-inspect").focus(); await page.keyboard.press("Home");
  const card = page.locator("#ol-inspect-readout");
  await card.locator(".ol-cell-details > summary").click();
  await expect(card.locator('dd[data-field="response"]')).toHaveAttribute("data-canonical", "empty-population");
  await expect(card.locator('dd[data-field="response"]')).toContainText("Undefined: all-price reported trades is 0");
  await expect(card.locator('.ol-core-stats > .ol-cell-stat:first-child dd')).toHaveAttribute("data-canonical", "700");
});

test("a delta keeps completed history cached and lets an older-token read finish", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades, cutoffIso: "2021-02-12T00:03:00Z" });
  const gate = fake.on({ route: /^\/cube\/columns/ }).gate();
  let originalPack;
  const failures = []; page.on("requestfailed", (request) => { if (new URL(request.url()).pathname === "/cube/columns") failures.push(request.failure()); });
  try {
    await page.goto(`${fake.url}/${VIEW}&pane=volume`); await probe.waitForReady();
    await page.keyboard.press("e"); await page.locator('[data-surface="columns"]').click();
    await page.locator("#ol-inspect").focus(); await page.keyboard.press("Home"); await gate.arrived();
    originalPack = JSON.parse(await page.locator("#origo-lens-data").textContent()).state_token;
    expect(typeof originalPack).toBe("string"); expect(originalPack.length).toBeGreaterThan(0);
    fake.rebuild();
    await expect.poll(() => fake.log().filter((x) => x.path === "/cube/pack" && x.answer === "delta").length, { timeout: 30000 }).toBe(1);
    const card = page.locator("#ol-inspect-readout");
    await expect.poll(async () => JSON.parse(await card.getAttribute("data-observation")).pack).not.toBe(originalPack);
    gate.open();
    await expect(card.locator('dd[data-field="seasonal"]')).toHaveAttribute("data-canonical", "2");
    const record = JSON.parse(await card.getAttribute("data-observation"));
    expect(record.denominators[0].sourcePack).toBe(originalPack);
    expect(record.pack).not.toBe(originalPack);
    expect(failures).toEqual([]);
    expect(fake.log().filter((x) => x.path === "/cube/columns")).toHaveLength(1);
    fake.rebuild();
    await expect.poll(() => fake.log().filter((x) => x.path === "/cube/pack" && x.answer === "delta").length, { timeout: 30000 }).toBe(2);
    await fake.idle();
    expect(fake.log().filter((x) => x.path === "/cube/columns")).toHaveLength(1);
  } finally { gate.open(); }
});

for (const state of ["pending", "failed"]) test(`${state}: Measures details do not invent zero aggressor activity`, async ({ page, fakeFor, allowConsole }) => {
  if (state === "failed") allowConsole(/Failed to load resource/);
  const fake = await fakeFor("standard", { next: 300 });
  const rule = fake.on({ route: "/cube/query", when: (q) => "r0" in q });
  const gate = state === "pending" ? rule.gate() : null;
  if (state === "failed") rule.fail({ status: 503, body: { error: "rectangle measurement rejected" } });
  try {
    await page.goto(`${fake.url}/#t=2026-09-16T12:07Z~2026-09-25T05:00Z&p=15000~45000`);
    if (gate) await gate.arrived();
    const card = page.locator("#ol-vol").locator("..");
    await expect(page.locator("#ol-vol")).toHaveAttribute("data-canonical", state);
    await card.locator(".ol-core-details > summary").click();
    await expect(card.locator(".ol-core-details")).toContainText(state === "pending" ? /Buyer-initiated Reading|Buyer-initiated Measuring/ : /Buyer-initiated Read failed: rectangle measurement rejected/);
    await expect(card.locator(".ol-core-details")).not.toContainText(/initiated 0 USDT/);
    if (gate) { gate.open(); await fake.idle(); }
  } finally { gate?.open(); }
});

test("leading no-trade intervals retain the later response support and mismatch", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: [{ t_ms: 57250, price: 2500000, qty: 1200000, takerBuy: true }], cutoffIso: "2021-01-01T00:10:00Z" });
  await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:10Z&p=24875~25250&r=0,0&vis=2&sel=2021-01-01T00:00Z~2021-01-01T00:01:52.500Z,25000~25125`);
  await probe.waitForReady();
  const card = page.locator("#ol-vol").locator("..");
  await card.locator(".ol-core-details > summary").click();
  await expect(card.locator(".ol-core-details")).toContainText("Different measured-through boundaries");
  await expect.poll(async () => {
    const record = JSON.parse(await card.getAttribute("data-observation"));
    return record.denominators?.[1]?.time;
  }).toEqual([1, 2]);
  const record = JSON.parse(await card.getAttribute("data-observation"));
  expect(record.time).toEqual([0, 2]);
});

test("failed seasonal and column-context reads keep their actual failure reason", async ({ page, fakeFor, probe, allowConsole }) => {
  allowConsole(/Failed to load resource/);
  const localTrades = Array.from({ length: 20 }, (_, c) => ({ t_ms: c * 56250 + 1000, price: 2500000, qty: 400000, takerBuy: true }));
  const fake = await fakeFor({ trades: localTrades, cutoffIso: "2021-01-15T00:00:00Z" });
  fake.on({ route: "/cube/columns" }).fail({ status: 503, body: { error: "seasonal source rejected" } });
  fake.on({ route: "/cube/query", when: (q) => q.n === "0" && Number(q.b1) - Number(q.b0) === 12 && !q.motion && !("r0" in q) }).fail({ status: 503, body: { error: "column context rejected" } });
  await page.goto(`${fake.url}/#t=2021-01-01T00:12Z~2021-01-01T00:20Z&p=24875~25250&r=0,0&auto=0&vis=2&pane=volume`); await probe.waitForReady();
  await page.keyboard.press("e"); await page.locator('[data-surface="columns"]').click(); await page.locator("#ol-inspect").focus(); await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) {
    const c = Number(await page.locator("#ol-inspect").getAttribute("data-c"));
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#ol-inspect")).toHaveAttribute("data-c", String(c + 1));
  }
  const card = page.locator("#ol-inspect-readout");
  await expect(card.locator('dd[data-field="seasonal"]')).toHaveAttribute("data-canonical", "failed");
  await expect(card.locator('dd[data-field="seasonal"]')).toContainText("seasonal source rejected");
  await expect.poll(() => fake.log().some((x) => x.path === "/cube/query" && Number(x.query.b1) - Number(x.query.b0) === 12 && x.status === 503)).toBe(true);
  await expect.poll(async () => JSON.parse(await card.getAttribute("data-observation")).history.filter((x) => x.result.tag === "failed").map((x) => x.result.reason)).not.toEqual([]);
  const record = JSON.parse(await card.getAttribute("data-observation"));
  expect(record.history.filter((x) => x.result.tag === "failed").every((x) => x.result.reason === "column context rejected")).toBe(true);
});

// A 15-minute candle can be unfinished even when every retained 56.25s interval is complete.
test("forming higher-level candle keeps open status after excluding the forming base interval", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: [{ t_ms: 1000, price: 2500000, qty: 100000000, takerBuy: true }, { t_ms: 300000, price: 2500100, qty: 100000000, takerBuy: false }], cutoffIso: "2021-01-01T00:10:00Z" });
  await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:15Z&p=24875~25250&r=4,0&auto=0&mode=candles`); await probe.waitForReady();
  await page.keyboard.press("e"); await page.locator('button[data-surface="cells"]').click();
  await page.locator("#ol-inspect").focus(); await page.keyboard.press("Home");
  const card = page.locator("#ol-inspect-readout");
  await expect(card).toHaveAttribute("data-presentation", "candle");
  await expect.poll(async () => JSON.parse(await card.getAttribute("data-observation")).completeness).toBe("open");
  const record = JSON.parse(await card.getAttribute("data-observation"));
  expect(record.time[1]).toBeLessThanOrEqual(Math.floor(600 / 56.25));
  await expect(card).toContainText(/So far/);
});
