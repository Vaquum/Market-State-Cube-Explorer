"use strict";
// PRD-0006 D1/D3/D5/D6: capture ownership and source/replay boundaries through real UI routes.
// Oracles: mixed.json's hand-calculated cells/motion, independent rational reference sums,
// declared address geometry, embedded recorded wire cells and the fake's request log.
const { test, expect } = require("./fixtures.js");
const { atRest } = require("./rows-support.js");
const reference = require("../reference/index.js");
const { resolveProfile } = require("../support/profiles.js");
const wire = require("../support/wire.js");
const KEY = "market-state-cube-explorer:comparison:v1:BTC/USDT", EPOCH = wire.T0 * 1000;
const VIEW = "#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24800~25500&r=0,0&auto=0&vis=2&marks=none&lines=";
const WORK = "#ol-comparisonWorkspace";
const saved = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), KEY);
async function ready(page, fake, probe, hash = VIEW) {
  await page.goto(`${fake.url}/${hash}`); await atRest(page, fake, probe);
  await probe.waitForQuiet({ quietMs: 300, timeout: 30000 });
}
async function point(page, time = 28125, price = 25062.5) {
  const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
  const times = params.get("t").split("~").map(Date.parse), prices = params.get("p").split("~").map(Number);
  const canvas = page.locator("#ol-canvas"), box = await canvas.boundingBox(), layout = (await canvas.getAttribute("data-layout")).split(",").map(Number);
  return { x: box.x + layout[0] + layout[2] * (EPOCH + time - times[0]) / (times[1] - times[0]), y: box.y + layout[1] + layout[3] * (prices[1] - price) / (prices[1] - prices[0]) };
}
async function menu(page, p, modifiers) {
  if (modifiers) {
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    try { await page.mouse.click(p.x, p.y); } finally { for (const modifier of modifiers) await page.keyboard.up(modifier); }
  } else await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(page.locator("#ol-cell-menu")).toBeVisible();
}
async function addMenu(page, p, count = 1) {
  await menu(page, p); await page.getByRole("menuitem", { name: "Add to comparison" }).click();
  await expect.poll(async () => (await saved(page))?.captures.length).toBe(count);
}
const tableRow = (page, c, r) => page.locator(`#ol-table-body tr[data-c="${c}"][data-r="${r}"]`);
async function addTable(page, c, r, count) {
  await page.locator("#ol-tab-cells").click();
  await tableRow(page, c, r).getByRole("button", { name: "Add to comparison" }).click();
  await expect.poll(async () => (await saved(page))?.captures.length).toBe(count);
}
async function clipboard(page) {
  await page.evaluate(() => {
    window.__comparisonCopied = null;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__comparisonCopied = text; } } });
  });
}
async function copyFocused(page) {
  await page.evaluate(() => { window.__comparisonCopied = null; });
  await page.locator(`${WORK} .ol-comparison-focus [data-comparison-action="copy"]`).click();
  await expect.poll(() => page.evaluate(() => window.__comparisonCopied)).not.toBeNull();
  return page.evaluate(() => window.__comparisonCopied);
}
const cubeReads = (fake) => fake.log().filter((entry) => entry.path.startsWith("/cube/") && entry.path !== "/cube/pack");

test("matching Update replaces only that capture, preserving identity and collection order", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await addTable(page, 0, 200, 1); await addTable(page, 1, 201, 2);
  const before = await saved(page), first = before.captures[0];
  expect(first.metrics["volume.amount"].value).toBe(300);
  expect(first.metrics["trades.amount"].value).toBe(2);
  expect(first.metrics["volume.intensity"].value).toBe(320);
  expect(first.metrics.size.value).toBe(150); expect(first.metrics.flow.value).toBe(1 / 3);
  expect(first.metrics["delta.amount"].value).toBe(-100);
  expect(first.metrics["volume.amount"].formula).toBe("cells.volume.amount@1");
  fake.revise({ day: "2021-01-01", factor: 2 });
  await page.locator("#ol-tab-cells").click();
  await expect(tableRow(page, 0, 200).locator('[data-field="volume"]')).toHaveAttribute("data-canonical", "600", { timeout: 20000 });
  expect((await saved(page)).captures).toEqual(before.captures);
  await tableRow(page, 0, 200).getByRole("button", { name: "Update capture" }).click();
  await expect.poll(async () => (await saved(page)).captures[0].metrics["volume.amount"].value).toBe(600);
  const after = await saved(page);
  expect(after.captures.map((capture) => capture.id)).toEqual(before.captures.map((capture) => capture.id));
  expect(after.captures[0].nominal).toEqual(first.nominal); expect(after.captures[0].capturedAt).toBeGreaterThan(first.capturedAt);
  expect(after.captures[1]).toEqual(before.captures[1]); expect(after.focus).toBe(first.id);
});

test("a live data revision makes an already opened cell menu refuse its stale capture", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await menu(page, await point(page)); fake.revise({ day: "2021-01-01", factor: 2 });
  await expect.poll(() => fake.log().filter((entry) => entry.path === "/cube/pack" && entry.answer === "pack").length, { timeout: 20000 }).toBeGreaterThan(0);
  await probe.waitForQuiet({ quietMs: 300, timeout: 30000 });
  await page.getByRole("menuitem", { name: "Add to comparison" }).click();
  await expect(page.locator("#ol-cell-menu")).toHaveCount(0);
  await expect(page.locator("#ol-inspect-live")).toContainText("Cell changed");
  expect((await saved(page))?.captures.length || 0).toBe(0);
});

test("late motion invalidates the menu; a fresh capture keeps the canonical path and dwell", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"), gate = fake.on({ route: "/cube/motion" }).gate();
  await page.goto(`${fake.url}/${VIEW}&mode=path`); await gate.arrived();
  await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /,/);
  const p = await point(page); await menu(page, p); gate.open();
  await fake.idle({ quietMs: 300, timeoutMs: 20000 }); await probe.waitForQuiet({ quietMs: 300, timeout: 30000 });
  await page.getByRole("menuitem", { name: "Add to comparison" }).click();
  await expect(page.locator("#ol-inspect-live")).toContainText("Cell changed");
  expect((await saved(page))?.captures.length || 0).toBe(0);
  await addMenu(page, await point(page)); const capture = (await saved(page)).captures[0];
  expect(capture.metrics.path.value).toBe(2); expect(capture.metrics.dwell.value).toBe(41.25 / 56.25);
  expect(capture.metrics.path.formula).toBe("cells.path.spans@1");
  expect(capture.metrics.path.supportEnd).toBe(EPOCH + 56250); expect(capture.metrics.dwell.knownThrough).toBe(EPOCH + 56250);
});

test("Inspect Add on a held Lens captures its finer level, bounds and exact cell", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe, VIEW.replace("r=0,0", "r=2,2"));
  await page.keyboard.press("l"); const p = await point(page); await page.mouse.move(p.x, p.y);
  await probe.waitForQuiet({ quietMs: 300, timeout: 30000 }); await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toHaveAttribute("data-surface", "lens");
  await page.locator("#ol-inspect").focus(); await page.keyboard.press("Enter");
  await page.locator("#ol-inspect-detail-body").getByRole("button", { name: "Add to comparison" }).click();
  await expect.poll(async () => (await saved(page))?.captures.length).toBe(1);
  const capture = (await saved(page)).captures[0];
  expect(capture.level).toEqual({ n: 0, m: 0 }); expect([capture.c, capture.r]).toEqual([0, 200]);
  expect(capture.nominal).toEqual({ t0: EPOCH, t1: EPOCH + 56250, low: 25000, high: 25125 });
  expect(capture.observed.seconds).toBe(56.25); expect(capture.observed.width).toBe(125);
  expect(capture.metrics["volume.amount"].value).toBe(300); expect(capture.metrics["volume.intensity"].value).toBe(320);
});

test("capture uses the current replay portion; backward gating hides DOM and copy without altering owned values", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed");
  const replay = "#t=2021-01-01T00:00:56.250Z~2021-01-01T00:06Z&p=25000~25375&r=2,0&auto=0&vis=2&marks=none&lines=&replay=1&at=2021-01-01T00:03:45Z";
  await ready(page, fake, probe, replay); await addMenu(page, await point(page, 140625, 25187.5));
  const capture = (await saved(page)).captures[0];
  expect(capture.metrics["volume.amount"].value).toBe(100.5); expect(capture.metrics["trades.amount"].value).toBe(2);
  expect(capture.observed.t0).toBe(EPOCH + 56250); expect(capture.observed.t1).toBe(EPOCH + 225000);
  expect(capture.observed.seconds).toBe(168.75); expect(capture.metrics["volume.amount"].supportEnd).toBe(EPOCH + 225000);
  expect(capture.when.knownAtMs).toBeNull(); await clipboard(page);
  expect(await copyFocused(page)).toContain("Volume: 100.5 usdt");
  await page.evaluate((hash) => { location.hash = hash; }, replay.replace("r=2,0", "r=0,0").replace("00:03:45Z", "00:01:52.500Z"));
  await expect(page.locator("#ol-replay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ol-replay-at")).toHaveText("1 Jan 00:01:52.500");
  const volume = page.locator(`${WORK} .ol-comparison-focus [data-metric="volume"]`);
  await expect(volume).toHaveAttribute("data-state", "hidden"); expect(await volume.getAttribute("data-canonical")).toBeNull();
  await expect(volume).toContainText("Unavailable in replay");
  const hidden = await copyFocused(page); expect(hidden).toContain("Volume: Unavailable in replay");
  expect(hidden).not.toContain("Volume: 100.5 usdt"); expect(hidden).not.toContain("Taker buys: 100.5 usdt");
  expect((await saved(page)).captures).toEqual([capture]);
  await page.evaluate((hash) => { location.hash = hash; }, replay);
  await expect(volume).toHaveAttribute("data-canonical", "100.5");
  expect((await saved(page)).captures).toEqual([capture]);
  await page.evaluate((hash) => { location.hash = hash; }, replay.replace("&replay=1", "&replay=0"));
  await expect(volume).toHaveAttribute("data-canonical", "100.5"); expect((await saved(page)).captures).toEqual([capture]);
});

test("loaded POC choice and sort issue no reads; its price and period remain frozen after live data", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe, VIEW + "1d"); await addTable(page, 0, 200, 1);
  const select = page.locator(`${WORK} [data-comparison-control="poc"]`);
  await expect.poll(() => select.locator("option").count()).toBeGreaterThan(1); const firstId = await select.locator("option").nth(1).getAttribute("value");
  fake.clearLog(); await select.selectOption(firstId);
  await page.locator(`${WORK} [data-comparison-control="sort"]`).selectOption("poc"); await fake.idle({ quietMs: 300 });
  const frozen = (await saved(page)).poc; expect(frozen.price).toBe(25062.5); expect(frozen.rowSize).toBe(125);
  expect(cubeReads(fake)).toHaveLength(0);
  fake.advance({ minutes: 2, trades: [{ t_ms: 360000, price: 2525000, qty: 4000000, takerBuy: true }] });
  await expect.poll(() => fake.log().filter((entry) => entry.path === "/cube/pack" && entry.answer === "delta").length, { timeout: 20000 }).toBeGreaterThan(0);
  await probe.waitForQuiet({ quietMs: 300, timeout: 30000 }); expect((await saved(page)).poc).toEqual(frozen);
  await expect(select.locator(`option[value='${firstId}']`)).toHaveText(frozen.label);
  const fresh = await select.locator("option").evaluateAll((options, oldId) => options.find((option) => option.value && option.value !== oldId)?.value, firstId);
  expect(fresh).toBeTruthy(); await select.selectOption(fresh);
  await expect.poll(async () => (await saved(page)).poc.price).toBe(25312.5);
});

test("Control-click retains the chart anchor and selection tool without a primary gesture", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe, VIEW + "&at=2021-01-01T00:03:45Z");
  await page.locator('[data-tool="select"]').click();
  const before = await page.evaluate(() => ({ hash: location.hash, history: sessionStorage.getItem("market-state-cube-explorer:history:v1") }));
  const p = await point(page); await menu(page, p, ["Control"]); await page.keyboard.press("Escape");
  expect(await page.evaluate(() => location.hash)).toBe(before.hash);
  expect(await page.evaluate(() => sessionStorage.getItem("market-state-cube-explorer:history:v1"))).toBe(before.history);
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
  await menu(page, p, ["Control"]); await page.getByRole("menuitem", { name: "Add to comparison" }).click();
  await expect.poll(async () => (await saved(page))?.captures.length).toBe(1); expect(await page.evaluate(() => location.hash)).toBe(before.hash);
});

test("a covered known-zero cell is numeric while its empty ratios retain typed reasons", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed"); await ready(page, fake, probe);
  await addMenu(page, await point(page, 28125, 25312.5)); const capture = (await saved(page)).captures[0];
  expect([capture.c, capture.r]).toEqual([0, 202]);
  for (const key of ["volume.amount", "volume.intensity", "trades.amount", "delta.amount"]) {
    expect(capture.metrics[key].tag).toBe("finite"); expect(capture.metrics[key].value).toBe(0);
  }
  expect(capture.metrics.size.tag).not.toBe("finite"); expect(capture.metrics.flow.tag).not.toBe("finite");
  expect(capture.metrics.path.tag).toBe("pending"); await expect(page.locator(`${WORK} .ol-comparison-focus [data-metric="volume"]`)).toHaveAttribute("data-canonical", "0");
});

test("a pending rectangle keeps loaded cell facts, independently summed from its trade stream", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard"); await ready(page, fake, probe, "#w=30d&vis=2&marks=none&lines=");
  const gate = fake.on({ route: "/cube/query" }).gate();
  const view = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(view.x + view.width * .4, view.y + view.height * .4); await page.mouse.down();
  await page.mouse.move(view.x + view.width * .4 + 60, view.y + view.height * .4, { steps: 6 }); await page.mouse.up();
  await gate.arrived();
  await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /,/);
  const canvas = page.locator("#ol-canvas"), box = await canvas.boundingBox(), layout = (await canvas.getAttribute("data-layout")).split(",").map(Number);
  let found;
  for (let yy = 30; yy < layout[3] - 30 && !found; yy += 30) for (let xx = 30; xx < layout[2] - 30 && !found; xx += 30) {
    const p = { x: box.x + layout[0] + xx, y: box.y + layout[1] + yy };
    await page.mouse.move(p.x, p.y); await page.evaluate(() => new Promise(requestAnimationFrame));
    const tip = await page.locator("#ol-tip").evaluate((node) => ({ key: node.hidden ? null : node.dataset.readout, volume: node.querySelector('[data-field="volume"]')?.getAttribute("data-canonical") }));
    if (/^\d+:\d+:\d+:\d+$/.test(tip.key || "") && Number(tip.volume) > 0) found = { ...p, ...tip };
  }
  expect(found, "a loaded occupied cell is visible while the query is held").toBeTruthy();
  await addMenu(page, found); const capture = (await saved(page)).captures[0];
  expect(capture.metrics["volume.amount"].tag).toBe("finite"); expect(capture.metrics["volume.amount"].value).toBe(Number(found.volume));
  const { store } = resolveProfile("standard"), trades = [], from = capture.nominal.t0 - EPOCH, to = capture.nominal.t1 - EPOCH;
  for (let i = 0; i < store.length; i++) if (store.t[i] >= from && store.t[i] < to && store.price[i] / 100 >= capture.nominal.low && store.price[i] / 100 < capture.nominal.high)
    trades.push({ t_ms: store.t[i], price: store.price[i], qty: store.qty[i], takerBuy: !!store.buy[i], count: store.count[i] });
  const cell = reference.cells(trades, { n: capture.level.n, m: capture.level.m, b0: capture.c * 2 ** capture.level.n, b1: (capture.c + 1) * 2 ** capture.level.n, r0: capture.r * 2 ** capture.level.m, r1: (capture.r + 1) * 2 ** capture.level.m })[0];
  expect(capture.metrics["volume.amount"].value).toBeCloseTo(cell.v, 6); expect(capture.metrics["trades.amount"].value).toBe(cell.ct);
  expect(capture.metrics["volume.intensity"].value).toBeCloseTo(cell.v / (capture.observed.seconds / 60 * capture.observed.width / 125), 6);
  gate.open(); await fake.idle({ quietMs: 300, timeoutMs: 30000 });
});

test("recorded capture agrees with the embedded wire cell sums and never requests the cube", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("recorded"); await ready(page, fake, probe, "#w=24h&r=4,0&auto=0&vis=2&marks=none&lines=");
  const pack = await page.locator("#origo-lens-data").evaluate((node) => JSON.parse(node.textContent));
  await page.locator("#ol-tab-cells").click(); const row = page.locator("#ol-table-body tr").first();
  const pos = await row.evaluate((node) => ({ c: Number(node.dataset.c), r: Number(node.dataset.r) }));
  await row.getByRole("button", { name: "Add to comparison" }).click(); await expect.poll(async () => (await saved(page))?.captures.length).toBe(1);
  const capture = (await saved(page)).captures[0], bytes = wire.gunzipBase64(pack.blocks.recent.gzip_base64);
  expect(bytes.subarray(0, 4).toString()).toBe("MSC1");
  const cells = bytes.readUInt32LE(16), n = bytes.readUInt8(4), m = bytes.readUInt8(5); let volume = 0, count = 0;
  // MSC1's published columnar wire layout: volume f64, buy volume f64, col/row/count/buy count u32.
  for (let i = 0; i < cells; i++) {
    const c = bytes.readUInt32LE(32 + 16 * cells + 4 * i), r = bytes.readUInt32LE(32 + 20 * cells + 4 * i);
    if (Math.floor(c / 2 ** (capture.level.n - n)) === pos.c && Math.floor(r / 2 ** (capture.level.m - m)) === pos.r) {
      volume += bytes.readDoubleLE(32 + 8 * i); count += bytes.readUInt32LE(32 + 24 * cells + 4 * i);
    }
  }
  expect(capture.metrics["volume.amount"].value).toBeCloseTo(volume, 6); expect(capture.metrics["trades.amount"].value).toBe(count);
  expect(capture.measuredThrough).toBeLessThanOrEqual(Date.parse(pack.cutoff)); expect(capture.metrics.path.tag).toBe("pending");
  expect(fake.log().filter((entry) => entry.path.startsWith("/cube/"))).toHaveLength(0);
});


test("price-only clipping retains the full temporal known-at boundary", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("micro:mixed");
  await ready(page, fake, probe, VIEW.replace("p=24800~25500", "p=25125~25500").replace("r=0,0", "r=0,2"));
  await addMenu(page, await point(page, 28125, 25187.5)); const capture = (await saved(page)).captures[0];
  expect(capture.nominal).toEqual({ t0: EPOCH, t1: EPOCH + 56250, low: 25000, high: 25500 });
  expect(capture.observed.t0).toBe(capture.nominal.t0); expect(capture.observed.t1).toBe(capture.nominal.t1);
  expect(capture.observed.low).toBe(25125); expect(capture.observed.high).toBe(25500);
  expect(capture.when.knownAtMs).toBe(EPOCH + 56250); expect(capture.completeness).toContain("portion");
});


test("Relative volume with a stale period and newer rectangle hides both display and Copy between their source ends", async ({ page, fakeFor, probe }) => {
  const ms = (iso) => Date.parse(iso) - EPOCH;
  const fake = await fakeFor({ name: "comparison-relative-mixed-support", cutoffIso: "2026-09-24T12:02:00Z", trades: [
    { t_ms: ms("2026-07-01T00:00:00Z"), price: 2500000, qty: 800000, takerBuy: true },
    { t_ms: ms("2026-09-24T11:00:00Z"), price: 2500000, qty: 400000, takerBuy: true },
    { t_ms: ms("2026-09-24T11:01:00Z"), price: 2512500, qty: 400000, takerBuy: false },
  ] });
  const hash = "#t=2026-09-24T10:00Z~2026-09-24T13:10Z&p=24875~25375&r=4,0&auto=0&vis=2&marks=none&lines=&rows=volume&period=90d";
  await ready(page, fake, probe, hash);
  // Period requests have no price bounds. The current rectangle finishes before this held read.
  const gate = fake.on({ route: "/cube/query", when: (query) => !("r0" in query) }).gate();
  fake.advance({ minutes: 60, trades: [{ t_ms: ms("2026-09-24T12:30:00Z"), price: 2500000, qty: 400000, takerBuy: true }] });
  await gate.arrived(); await probe.waitForQuiet({ quietMs: 300, timeout: 30000 });
  await page.locator("#ol-tab-cells").click();
  const row = page.locator('#ol-table-body tr[data-r="200"]').first();
  await row.getByRole("button", { name: "Add to comparison" }).click();
  await expect.poll(async () => (await saved(page))?.captures.length).toBe(1);
  const capture = (await saved(page)).captures[0];
  const relative = capture.detail.find((detail) => detail.label === "Relative volume · captured context");
  const rectangle = capture.detail.find((detail) => detail.label === "Relative volume rectangle through");
  const period = capture.detail.find((detail) => detail.label === "Relative volume reference through");
  expect(relative, "the real row comparison remains finite while the next period read is held").toBeTruthy();
  expect(relative.tag).toBe("finite"); expect(Number.isFinite(relative.value)).toBe(true);
  const rewind = Date.parse("2026-09-24T12:30:00Z");
  expect(Date.parse(period.value)).toBeLessThan(rewind); expect(Date.parse(rectangle.value)).toBeGreaterThan(rewind);
  await clipboard(page);
  expect(await copyFocused(page)).toContain(`Relative volume · captured context: ${relative.value}`);
  gate.open(); await atRest(page, fake, probe);
  await page.evaluate((next) => { location.hash = next; }, hash + "&replay=1&at=2026-09-24T12:30:00Z");
  await expect(page.locator("#ol-replay-at")).toHaveText("24 Sep 12:30");
  const details = page.locator(`${WORK} .ol-comparison-details`);
  await details.locator("summary").click();
  const relativeRow = details.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^Relative volume · captured context$/ }) });
  await expect(relativeRow.locator("dd")).toHaveText("Unavailable in replay");
  const copied = await copyFocused(page);
  expect(copied).toContain("Relative volume · captured context: Unavailable in replay");
  expect(copied).not.toContain(`Relative volume · captured context: ${relative.value}`);
  expect((await saved(page)).captures).toEqual([capture]);
});
