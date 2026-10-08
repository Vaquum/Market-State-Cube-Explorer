"use strict";
const { test, expect } = require("./fixtures.js");
const { addRecorder, lastDraw, rectOf, boxOf } = require("./cells-support.js");
const FROM = "2021-01-01T00:00Z", TO = "2021-01-01T00:20Z";
const VIEW = `#t=${FROM}~${TO}&p=24800~25500&r=0,0&auto=0&vis=2&lines=`;
const KEY = "market-state-cube-explorer:comparison:v2:BTC/USDT";
const amounts = [100000, 100000, 100000, 225000, 225000];
const trades = Array.from({ length: 20 }, (_, c) => [
  ...amounts.map((qty, i) => ({ t_ms: c * 56250 + 1000 + i, price: 2500000, qty, takerBuy: i < 3 })),
  { t_ms: c * 56250 + 2000, price: 2800000, qty: 500000, takerBuy: false },
]).flat();
test.use({ reducedMotion: "reduce" });

async function atCell(page, c, r = 200, click = false) {
  const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
  const [from, to] = params.get("t").split("~"), [low, high] = params.get("p").split("~").map(Number);
  const canvas = await page.locator("#ol-canvas").boundingBox();
  const frame = await lastDraw(page), box = boxOf(frame.plot, rectOf({ from, to, low, high }), 0, 0, c, r);
  const x = canvas.x + (box.x0 + box.x1) / 2, y = canvas.y + (box.y0 + box.y1) / 2;
  if (click) await page.mouse.click(x, y); else await page.mouse.move(x, y);
}
const field = (page, key) => page.locator(`#ol-inspect-readout .ol-cell-stat dd[data-field="${key}"]`);
const samples = async (page, key = "value") => JSON.parse(await field(page, key).locator("..").locator(".ol-sparkline").getAttribute("data-samples"));

for (const mode of ["volume", "flow", "path"]) test(`${mode}: a scaled 4K desktop shows the complete cell profile through Movement without shrinking type`, async ({ page, fakeFor, probe }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-01T00:20:00Z" });
  await page.goto(fake.url + "/" + VIEW + "&mode=" + mode); await probe.waitForReady(); await atCell(page, 15);
  await page.keyboard.press("e");
  await expect(field(page, "dwellShare")).toHaveAttribute("data-canonical", /[\d.]+/);
  await expect(field(page, "buySize")).toHaveAttribute("data-canonical", "25");
  await expect(field(page, "sellSize")).toHaveAttribute("data-canonical", "56.25");
  await expect(field(page, "imbalance")).toHaveAttribute("data-canonical", "-0.2");
  const inspector = page.locator("#ol-inspect");
  const movement = page.locator('#ol-inspect-readout [data-group="movement"]');
  await expect(movement).toBeVisible();
  // Measure one complete DOM frame; optional context can replace the readout
  // between separate locator boundingBox calls.
  const { pane, section } = await inspector.evaluate(n => {
    const bounds = node => { const r = node.getBoundingClientRect(); return { y: r.y, height: r.height }; };
    return { pane: bounds(n), section: bounds(n.querySelector('[data-group="movement"]')) };
  });
  await testInfo.attach("profile geometry", { body: JSON.stringify(await inspector.evaluate(n => ({
    panel: { height: n.clientHeight, scroll: n.scrollHeight },
    groups: Array.from(n.querySelectorAll('[data-group]')).map(e => ({ group: e.dataset.group, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })),
    rows: Array.from(n.querySelectorAll('.ol-cell-stat')).map(e => ({ label: e.querySelector('dt').textContent, height: e.getBoundingClientRect().height, columns: getComputedStyle(e).gridTemplateColumns })),
  }))), contentType: "application/json" });
  expect(section.y + section.height, "Movement is above the fold at 200% desktop scaling").toBeLessThan(pane.y + pane.height - 16);
  expect(await inspector.evaluate(n => n.scrollTop)).toBe(0);
  expect(await inspector.evaluate(n => n.scrollWidth)).toBeLessThanOrEqual(await inspector.evaluate(n => n.clientWidth));
  const type = await inspector.evaluate(n => ({
    labels: Array.from(n.querySelectorAll('.ol-cell-stat dt'), e => parseFloat(getComputedStyle(e).fontSize)),
    values: Array.from(n.querySelectorAll('.ol-cell-stat dd'), e => parseFloat(getComputedStyle(e).fontSize)),
  }));
  for (const size of type.labels) expect(size).toBeGreaterThanOrEqual(14);
  for (const size of type.values) expect(size).toBeGreaterThanOrEqual(18);
  await expect(inspector.locator(".ol-sparkline")).toHaveCount(mode === "flow" ? 13 : 12);
  if (mode === "volume") {
    const grip = page.locator('#ol-side-grip');
    await grip.focus();
    for (let i = 0; i < 4; i++) await grip.press('ArrowRight');
    await expect(grip).toHaveAttribute('aria-valuenow', '260');
    const narrow = await inspector.evaluate(n => ({
      width: n.clientWidth, scroll: n.scrollWidth,
      labels: Array.from(n.querySelectorAll('.ol-cell-group .ol-cell-stat'), e => ({
        label: e.querySelector('dt').getBoundingClientRect().left,
        value: e.querySelector('dd').getBoundingClientRect().left,
      })),
    }));
    expect(narrow.scroll).toBeLessThanOrEqual(narrow.width);
    for (const row of narrow.labels) expect(row.value).toBeCloseTo(row.label, 0);
  }
});

test("cell composition agrees across hover, inspector and captured copy; concentration uses off-screen prices", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-01T00:20:00Z" });
  await page.goto(fake.url + "/" + VIEW); await probe.waitForReady(); await atCell(page, 15);
  await expect(page.locator('#ol-tip dd[data-field="imbalance"]')).toHaveAttribute("data-canonical", "-0.2");
  await page.keyboard.press("e");
  await expect(field(page, "value")).toHaveAttribute("data-canonical", "187.5");
  await expect(field(page, "imbalance")).toHaveAttribute("data-canonical", "-0.2");
  await expect(field(page, "imbalance").locator("..").locator(".ol-sparkline")).toHaveAttribute("data-domain", "[-1,1]");
  await expect(field(page, "buySize")).toHaveAttribute("data-canonical", "25");
  await expect(field(page, "sellSize")).toHaveAttribute("data-canonical", "56.25");
  await expect(field(page, "columnShare")).toHaveAttribute("data-canonical", String(187.5 / 327.5));
  await expect(field(page, "sizeRatio")).toHaveAttribute("data-canonical", "2.25");
  expect(await samples(page, "sizeRatio")).toEqual(Array(12).fill(2.25));
  expect(await samples(page, "countShare")).toEqual(Array(12).fill(.6));
  await expect(page.locator("#ol-inspect-readout .ol-flow-labels")).toContainText("Buyer-initiated 40.0%");
  await expect(field(page, "pathSpans")).toHaveAttribute("data-canonical", /[\d.]+/);
  const path = Number(await field(page, "pathSpans").getAttribute("data-canonical"));
  const dwell = Number(await field(page, "dwellShare").getAttribute("data-canonical"));
  await page.locator("#ol-inspect").focus(); await page.keyboard.press("Enter");
  await page.locator("#ol-inspect-detail-body").getByRole("button", { name: "Add to comparison", exact: true }).click();
  await expect.poll(async () => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key))?.captures[0]?.detail.find((x) => x.label === "Net taker imbalance · cell volume")?.value, KEY)).toBe(-.2);
  const capture = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).captures[0], KEY);
  expect(capture.detail.find((x) => x.label === "Buyer-initiated mean reported trade").value).toBe(25);
  expect(capture.detail.find((x) => x.label === "Cell share of interval volume · all prices").value).toBe(187.5 / 327.5);
  expect(capture.metrics.path.value).toBe(path);
  expect(capture.metrics.dwell.value).toBe(dwell);
});

test("the same cell retains its twelve observations when the camera excludes earlier intervals and other price rows", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-01T00:20:00Z" });
  for (const from of [FROM, "2021-01-01T00:12Z"]) {
    await page.goto(fake.url + "/" + VIEW.replace(FROM, from)); await probe.waitForReady();
    await atCell(page, 15); await page.keyboard.press("e");
    expect(await samples(page)).toEqual(Array(12).fill(187.5));
    await expect(field(page, "columnShare")).toHaveAttribute("data-canonical", String(187.5 / 327.5));
    const window = page.locator('#ol-inspect-readout [data-history-from]');
    await expect(window).toHaveText("Same price band · 12 intervals");
    await expect(window).toHaveAttribute("title", /previous 11 intervals and this interval/);
  }
});

test("unvisited intervals are zero activity but have undefined ratios and an explicit explanation", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades: [{ t_ms: 15 * 56250 + 1000, price: 2500000, qty: 400000, takerBuy: true }], cutoffIso: "2021-01-01T00:20:00Z" });
  await page.goto(fake.url + "/" + VIEW); await probe.waitForReady(); await atCell(page, 15); await page.keyboard.press("e");
  expect(await samples(page)).toEqual([...Array(11).fill(0), 100]);
  expect(await samples(page, "buySize")).toEqual([...Array(11).fill(null), 100]);
  await expect(field(page, "buySize").locator("..")).toContainText("No earlier defined values");
  await expect(field(page, "sellSize")).toHaveAttribute("data-canonical", "undefined");
});

test("an undefined current ratio shows its earlier history without claiming a current trend", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-01T00:20:00Z" });
  await page.goto(fake.url + "/" + VIEW); await probe.waitForReady(); await atCell(page, 20); await page.keyboard.press("e");
  expect(await samples(page, "buySize")).toEqual([...Array(11).fill(25), null]);
  await expect(field(page, "buySize").locator("..").locator(".ol-sparkline")).toHaveAttribute("data-trend", "unavailable");
  await expect(field(page, "buySize").locator("..").locator(".ol-sparkline")).toHaveAttribute("aria-label", /current value unavailable/);
});

test("history outside the loaded time tile is fetched with all prices; pending coverage stays a gap", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-15T00:00:00Z" });
  const gate = fake.on({ route: "/cube/query", when: q => q.n === "0" && q.m === "0" && q.b0 === "4" && q.b1 === "16" && !q.motion }).gate();
  await page.goto(fake.url + "/" + VIEW.replace(FROM, "2021-01-01T00:12Z"));
  await probe.waitForReady(); await atCell(page, 15); await page.keyboard.press("e");
  await expect.poll(() => fake.log().some(x => x.path === "/cube/query" && x.query.b0 === "4" && !x.query.motion)).toBe(true);
  expect((await samples(page)).slice(0, 8)).toEqual(Array(8).fill(null));
  await expect(page.locator("#ol-inspect-readout")).toContainText("Reading earlier intervals from the cube");
  const request = fake.log().find(x => x.path === "/cube/query" && x.query.b0 === "4" && !x.query.motion);
  expect(request.query.r0).toBeUndefined(); expect(request.query.r1).toBeUndefined();
  const disclosure = page.locator("#ol-inspect-readout .ol-cell-details > summary");
  await disclosure.click();
  await expect(disclosure).toBeFocused();
  gate.open();
  await expect.poll(() => samples(page)).toEqual(Array(12).fill(187.5));
  await expect(disclosure).toBeFocused();
  await expect(disclosure.locator("..")).toHaveJSProperty("open", true);
  await expect(field(page, "columnShare")).toHaveAttribute("data-canonical", String(187.5 / 327.5));
});

test("an unavailable cube history is named and never converted into zero activity", async ({ page, fakeFor, probe, allowConsole }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-15T00:00:00Z" });
  fake.on({ route: "/cube/query", when: q => q.n === "0" && q.m === "0" && q.b0 === "4" && q.b1 === "16" && !q.motion }).fail({ status: 503 });
  allowConsole(/Failed to load resource/);
  await page.goto(fake.url + "/" + VIEW.replace(FROM, "2021-01-01T00:12Z"));
  await probe.waitForReady(); await atCell(page, 15); await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect-readout")).toContainText("Earlier intervals unavailable:");
  expect((await samples(page)).slice(0, 8)).toEqual(Array(8).fill(null));
  expect((await samples(page)).at(-1)).toBe(187.5);
});

test("a clipped cell's concentration uses only its observed time support, across all prices", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const c = 15, stream = [
    { t_ms: 2 * c * 56250 + 1000, price: 2500000, qty: 3600000, takerBuy: true },
    { t_ms: (2 * c + 1) * 56250 + 1000, price: 2500000, qty: 400000, takerBuy: false },
    { t_ms: 2 * c * 56250 + 2000, price: 2800000, qty: 20000000, takerBuy: true },
    { t_ms: (2 * c + 1) * 56250 + 2000, price: 2800000, qty: 500000, takerBuy: false },
  ];
  const fake = await fakeFor({ trades: stream.sort((a, b) => a.t_ms - b.t_ms), cutoffIso: "2021-01-01T01:00:00Z" });
  const from = new Date(Date.UTC(2021, 0, 1) + (2 * c + 1) * 56250).toISOString(), to = "2021-01-01T00:40Z";
  await page.goto(fake.url + `/#t=${from}~${to}&p=24800~25500&r=1,0&auto=0&vis=2&lines=`);
  await probe.waitForReady();
  const canvas = await page.locator("#ol-canvas").boundingBox(), frame = await lastDraw(page);
  const band = boxOf(frame.plot, rectOf({ from, to, low: 24800, high: 25500 }), 1, 0, c, 200);
  await page.mouse.move(canvas.x + frame.plot[0] + 2, canvas.y + (band.y0 + band.y1) / 2);
  await page.keyboard.press("e");
  await expect(field(page, "value")).toHaveAttribute("data-canonical", "100");
  await expect(field(page, "columnShare")).toHaveAttribute("data-canonical", String(100 / 240));
  await expect(page.locator("#ol-inspect-readout .ol-cell-state")).toContainText("Partial cell");
});

test("location names the preceding completed UTC session and uses the full price band without later-session leakage", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const DAY = 86400000, c = 1536 + 10;
  const stream = [
    { t_ms: 1000, price: 2500000, qty: 400000, takerBuy: true },
    { t_ms: DAY + 1000, price: 2800000, qty: 40000000, takerBuy: true },
    { t_ms: c * 56250 + 1000, price: 2500000, qty: 400000, takerBuy: false },
    { t_ms: 2 * DAY + 1000, price: 3000000, qty: 40000000, takerBuy: true },
  ];
  const fake = await fakeFor({ trades: stream, cutoffIso: "2021-01-04T00:00:00Z" });
  await page.goto(fake.url + "/#t=2021-01-02T00:00Z~2021-01-02T00:20Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=");
  await probe.waitForReady(); await atCell(page, c); await page.keyboard.press("e");
  const location = page.locator('#ol-inspect-readout [data-group="location"]');
  await expect(location).toHaveAttribute("data-state", "ready");
  await expect(location).toHaveAttribute("data-poc", "25062.5");
  await expect(location).toHaveAttribute("data-through", "1536");
  await expect(location).toContainText("Prior UTC session · 1 Jan 2021 · final");
  await expect(location).toContainText("Inside value area · Contains POC");
  await page.locator("#ol-inspect-exit").click();
  await page.goto(fake.url + "/#t=2021-01-02T00:00Z~2021-01-02T00:20Z&p=24800~25500&r=0,0&auto=0&vis=2&lines=&replay=1&at=2021-01-02T00:15Z");
  await probe.waitForReady(); await atCell(page, c); await page.keyboard.press("e");
  await expect(location).toHaveAttribute("data-poc", "25062.5");
  await expect(location).toHaveAttribute("data-through", "1536");
});


test("a short history response preserves uncovered intervals as unavailable, including their denominators", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-15T00:00:00Z" });
  await page.route("**/cube/query?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("n") === "0" && url.searchParams.get("b0") === "4" && url.searchParams.get("b1") === "16" && !url.searchParams.has("motion")) {
      url.searchParams.set("b1", "8");
      const response = await route.fetch({ url: url.toString() });
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.goto(fake.url + "/" + VIEW.replace(FROM, "2021-01-01T00:12Z"));
  await probe.waitForReady(); await atCell(page, 15); await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect-readout")).toContainText("Earlier intervals unavailable: cube returned incomplete coverage");
  const values = await samples(page);
  expect(values.slice(0, 4)).toEqual(Array(4).fill(187.5));
  expect(values.slice(4, 8)).toEqual(Array(4).fill(null));
  expect(values.slice(8)).toEqual(Array(4).fill(187.5));
  expect((await samples(page, "columnShare")).slice(4, 8)).toEqual(Array(4).fill(null));
});

test("rewinding past a previously measured cell hides every composition figure", async ({ page, fakeFor, probe }) => {
  await addRecorder(page);
  const fake = await fakeFor({ trades, cutoffIso: "2021-01-01T00:20:00Z" });
  await page.goto(fake.url + "/" + VIEW); await probe.waitForReady(); await atCell(page, 15);
  await expect(page.locator('#ol-tip dd[data-field="imbalance"]')).toHaveAttribute("data-canonical", "-0.2");
  await page.evaluate(hash => { location.hash = hash; }, VIEW + "&replay=1&at=2021-01-01T00:12Z");
  await probe.waitForReady(); await atCell(page, 15);
  await expect(page.locator("#ol-tip")).toContainText("Hidden in replay");
  await expect(page.locator("#ol-tip .ol-cell-stat")).toHaveCount(0);
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect-readout .ol-cell-stat")).toHaveCount(0);
});
