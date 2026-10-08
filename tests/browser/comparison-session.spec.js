"use strict";
// Hand-built captures test set arithmetic, tab ownership and DOM ergonomics independently of capture resolution.
const { test, expect } = require("./fixtures.js");
test.use({ reducedMotion: "reduce" });
const KEY = "market-state-cube-explorer:comparison:v2:BTC/USDT", CAP = 4 * 1024 * 1024;
const HASH = "#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=24600~25400&r=4,0&vis=2";
const START = Date.parse("2026-09-23T12:00:00Z");
function cell(index) {
  const amount = index + 1, end = START + (index + 1) * 60000;
  const metric = (value, formula, unit) => ({ tag: "finite", value, formula, unit, supportEnd: end, knownThrough: end, numerator: value, denominator: null });
  return { contextOrigin: "legacy-structural", context: { supports: {}, histories: [], originatingObservation: null }, originatingObservation: null, id: "cell-" + index, instrument: "BTC/USDT", level: { n: 0, m: 0 }, origin: START / 1000, c: index, r: 561 + index,
    nominal: { t0: end - 60000, t1: end, low: 70125 + index * 125, high: 70250 + index * 125 },
    observed: { t0: end - 60000, t1: end, low: 70125 + index * 125, high: 70250 + index * 125, seconds: 60, width: 125 },
    capturedAt: Date.parse("2026-10-04T18:00:00Z"), measuredThrough: end, source: "hand fixture", completeness: "Complete",
    metrics: {
      "volume.amount": metric(amount, "cells.volume.amount@1", "usdt"), "volume.intensity": metric(amount, "cells.volume.intensity@1", "usdt-per-min-per-125usdt"),
      "trades.amount": metric(amount, "cells.trades.amount@1", "trades"), "trades.intensity": metric(amount, "cells.trades.intensity@1", "trades-per-min-per-125usdt"),
      size: metric(1, "cells.size.mean@1", "usdt-per-trade"), flow: metric(.75, "cells.flow.share@1", "share"),
      flowtrades: metric(.5, "cells.flowtrades.share@1", "share"), "delta.amount": metric(amount - 50, "cells.delta.amount@1", "usdt"),
      "delta.intensity": metric(amount - 50, "cells.delta.intensity@1", "usdt-per-min-per-125usdt"),
      path: metric(.25, "cells.path.spans@1", "row-spans"), dwell: metric(.5, "cells.dwell.share@1", "share"),
    }, detail: [{ label: "Taker buys", value: amount * .75, unit: "usdt", tag: "finite", supportEnd: end, knownThrough: end }],
    when: { knownAtMs: end, knownAtReason: "the end of the interval", eventStartMs: end - 60000, eventEndMs: end }, shortExposure: false, originalScale: "fixture scale",
  };
}
function collection(count) {
  return { comparisonVersion: 2, selectedMetric: "volume", instrument: "BTC/USDT", captures: Array.from({ length: count }, (_, i) => cell(i)), focus: count ? "cell-0" : null,
    reference: null, basis: "auto", sort: { key: "time", direction: "asc" }, view: "grid", page: 0, poc: null, expanded: false, restoreLayout: null };
}
async function seed(page, value) {
  await page.addInitScript(({ key, raw }) => {
    if (!sessionStorage.getItem("comparison-test-seeded")) { sessionStorage.setItem(key, raw); sessionStorage.setItem("comparison-test-seeded", "1"); }
  }, { key: KEY, raw: typeof value === "string" ? value : JSON.stringify(value) });
}
const panel = (page) => page.locator("#ol-comparisonWorkspace");
const action = (page, name) => panel(page).locator(`[data-comparison-action="${name}"]`);
const control = (page, name) => panel(page).locator(`[data-comparison-control="${name}"]`);
const focusMetric = (page, metric) => panel(page).locator(`.ol-comparison-focus [data-metric="${metric}"]`);
const entries = (page) => panel(page).locator(".ol-comparison-entries [data-capture-id]");
async function stored(page) { return page.evaluate((key) => { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }, KEY); }
async function open(page, fake, value, hash = HASH) {
  if (value !== undefined) await seed(page, value);
  await page.goto(fake.url + "/" + hash);
  await expect(page.locator("#ol-tab-compare")).toBeVisible();
  await page.locator("#ol-tab-compare").click();
  await expect(panel(page)).toBeVisible();
}
async function persisted(page, predicate) { await expect.poll(async () => predicate(await stored(page))).toBe(true); }

for (const count of [1, 2, 3, 6, 32, 128]) {
  test(`${count} captures retain readable values and use the entire set for comparisons`, async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini"); await open(page, fake, collection(count));
    await expect(page.locator("#ol-tab-compare")).toHaveText(`Compare · ${count}`);
    await expect(entries(page)).toHaveCount(Math.min(count, 24));
    await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "1");
    if (count === 1) {
      await expect(focusMetric(page, "volume")).toContainText("Only comparable cell");
      await expect(panel(page).locator(".ol-comparison-collection")).toBeHidden();
      await expect(focusMetric(page, "volume").locator(".ol-comparison-track")).toHaveCount(0);
    } else {
      await expect(focusMetric(page, "volume")).toContainText(`Rank ${count} of ${count}`);
      const expected = (1 - (count + 1) / 2).toLocaleString("en-US", { maximumFractionDigits: 2 });
      await expect(focusMetric(page, "volume").locator(".ol-comparison-difference")).toContainText(expected.replace("-", "−") + " USDT");
    }
    const sizes = await focusMetric(page, "volume").evaluate((element) => ({ value: parseFloat(getComputedStyle(element.querySelector("strong")).fontSize), label: parseFloat(getComputedStyle(element.querySelector(".ol-comparison-label")).fontSize) }));
    expect(sizes.value).toBeGreaterThanOrEqual(28); expect(sizes.label).toBeGreaterThanOrEqual(14);
    if (count > 1) {
      const card = entries(page).first();
      expect(await card.locator(".ol-comparison-value").first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18);
      expect((await card.boundingBox()).width).toBeGreaterThanOrEqual(200);
    }
  });
}

for (const [endpoint, start, end] of [
  ["start", 8.64e15 + 60000, 8.64e15 + 120000],
  ["end", 8.64e15 - 60000, 8.64e15 + 60000],
]) {
  test(`a restored finite out-of-Date-range ${endpoint} keeps Focus, Cards and Matrix usable`, async ({ page, fakeFor }) => {
    const value = collection(2), capture = value.captures[0];
    capture.nominal = { ...capture.nominal, t0: start, t1: end };
    capture.observed = { ...capture.observed, t0: start, t1: end, seconds: (end - start) / 1000 };
    capture.measuredThrough = end;
    capture.when = { ...capture.when, knownAtMs: end, eventStartMs: start, eventEndMs: end };
    for (const record of [...Object.values(capture.metrics), ...capture.detail]) {
      record.supportEnd = end; record.knownThrough = end;
    }
    const fake = await fakeFor("mini"); await open(page, fake, value);
    expect(await page.evaluate((record) => window.explorerState.comparison.validate(record).ok, value)).toBe(true);
    await expect(panel(page).locator(".ol-comparison-focus h2")).toHaveText("Time unavailable");
    const invalid = panel(page).locator('.ol-comparison-entries [data-capture-id="cell-0"]');
    await expect(invalid.locator(".ol-comparison-card-focus")).toContainText("Time unavailable");
    await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "1");
    await action(page, "view").filter({ hasText: "Matrix" }).click();
    await expect(panel(page).locator(".ol-comparison-matrix tbody tr")).toHaveCount(2);
    await expect(invalid.locator(".ol-comparison-matrix-focus")).toContainText("Time unavailable");
    await panel(page).locator('.ol-comparison-entries [data-capture-id="cell-1"] [data-comparison-action="focus"]').click();
    await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "2");
    await expect(panel(page).locator(".ol-comparison-focus h2")).not.toHaveText("Time unavailable");
    await persisted(page, (v) => v?.captures.length === 2 && v.focus === "cell-1" && v.view === "matrix");
  });
}

test("off-page cohorts survive Matrix, sorting, pinned reference and focus removal", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(32));
  await action(page, "view").filter({ hasText: "Matrix" }).click();
  await expect(entries(page)).toHaveCount(24); await expect(panel(page).locator(".ol-comparison-matrix tbody tr")).toHaveCount(24);
  await action(page, "page").filter({ hasText: "Next" }).click();
  await expect(entries(page)).toHaveCount(8); await expect(panel(page).locator("[data-comparison-position]")).toContainText("25–32 of 32");
  await expect(focusMetric(page, "volume")).toContainText("−15.5 USDT");
  await control(page, "reference").selectOption("cell-31");
  await expect(focusMetric(page, "volume")).toContainText("−31 USDT");
  await control(page, "sort").selectOption("volume");
  await expect(entries(page).first()).toHaveAttribute("data-capture-id", "cell-31");
  await expect(focusMetric(page, "volume")).toContainText("Rank 32 of 32");
  await entries(page).first().locator('[data-comparison-action="focus"]').click();
  await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "32");
  await action(page, "remove").first().click();
  await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "31");
  await expect(control(page, "reference")).toHaveValue("");
  await expect(panel(page).locator("[data-comparison-status]")).toContainText("Reference removed");
  await expect(page.locator("#ol-tab-compare")).toHaveText("Compare · 31");
});

for (const [name, count, initialPage] of [["empty", 0, 0], ["first-page", 32, 0], ["final-page", 32, 1]]) {
  test(`Lines-off startup preserves restored ${name} comparison control availability`, async ({ page, fakeFor }) => {
    const value = collection(count); value.page = initialPage; value.focus = count ? `cell-${initialPage ? 31 : 0}` : null; value.expanded = true;
    value.restoreLayout = { sideOpen: true, sideWidth: 318, drawerHeight: 420, drawerOpen: true, drawer: "compare" };
    const fake = await fakeFor("mini"); await seed(page, value); await page.goto(fake.url + "/" + HASH + "&lines=");
    // Restoration opens Compare itself; clicking its tab would repair the overwritten button state.
    await expect(panel(page)).toBeVisible(); await expect(page.locator("#ol-tab-compare")).toBeEnabled();
    await fake.idle({ quietMs: 300, timeoutMs: 20000 });
    const previous = action(page, "page").filter({ hasText: "Previous" }), next = action(page, "page").filter({ hasText: "Next" });
    async function assertAvailability() {
      await expect(page.locator("#ol-tab-compare")).toHaveAttribute("aria-expanded", "true");
      await expect(entries(page)).toHaveCount(Math.min(24, count - initialPage * 24));
      await expect(previous).toHaveJSProperty("disabled", initialPage === 0);
      await expect(next).toHaveJSProperty("disabled", count === 0 || initialPage === 1);
      await expect(action(page, "clear")).toHaveJSProperty("disabled", count === 0);
      await expect(control(page, "basis")).toBeEnabled(); await expect(control(page, "sort")).toBeEnabled();
    }
    await assertAvailability();
    for (const button of [previous, next, action(page, "clear")]) {
      if (await button.isDisabled()) await button.evaluate((element) => element.click());
    }
    expect(await stored(page)).toEqual(value); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(panel(page).locator("[data-comparison-status]")).not.toContainText("invalid comparison page");
    if (count) {
      await (initialPage ? previous : next).click(); await expect(entries(page)).toHaveCount(initialPage ? 24 : 8);
      await (initialPage ? next : previous).click(); await assertAvailability();
      await persisted(page, (record) => record?.page === initialPage && record.expanded);
    }
    await page.reload(); await expect(panel(page)).toBeVisible(); await expect(page.locator("#ol-tab-compare")).toBeEnabled();
    await fake.idle({ quietMs: 300, timeoutMs: 20000 }); await assertAvailability();
  });
}

test("signed delta sort uses algebraic order and equal POC distances retain collection order", async ({ page, fakeFor }) => {
  const value = collection(3); value.poc = { id: "frozen-poc", label: "Frozen 90 days", period: "90d", price: 70062.5, rowSize: 125, approximate: true,
    supportEnd: START, knownThrough: START, from: START - 86400000, through: START, source: "hand fixture" };
  const fake = await fakeFor("mini"); await open(page, fake, value);
  await control(page, "sort").selectOption("delta");
  await expect(entries(page).first()).toHaveAttribute("data-capture-id", "cell-2");
  await control(page, "sort").selectOption("poc");
  await expect(entries(page).first()).toHaveAttribute("data-capture-id", "cell-0");
  await expect(focusMetric(page, "poc")).toHaveAttribute("data-canonical", "62.5");
  await expect(focusMetric(page, "poc")).toContainText("Above");
});

test("removing unfocused cells retains focus; Clear confirms the count and retains expanded presentation", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(3));
  await entries(page).last().locator('[data-comparison-action="remove"]').click();
  await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "1");
  await action(page, "expand").click(); await action(page, "clear").click();
  await expect(page.getByRole("dialog")).toContainText("Clear all 2 comparison cells?");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click(); await expect(entries(page)).toHaveCount(2);
  await action(page, "clear").click(); await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(panel(page).locator(".ol-comparison-empty")).toBeVisible();
  await expect(page.locator("#origo-lens")).toHaveAttribute("data-comparison-expanded", "true");
  await expect(action(page, "expand")).toHaveText("Restore chart");
});

test("reload preserves collection, basis, sort, Matrix, focus and a frozen POC", async ({ page, fakeFor }) => {
  const value = collection(6); value.poc = { id: "frozen-poc", label: "Frozen 90 days", period: "90d", price: 70062.5, rowSize: 125, approximate: true,
    supportEnd: START, knownThrough: START, from: START - 86400000, through: START, source: "hand fixture" };
  const fake = await fakeFor("mini"); await open(page, fake, value);
  await control(page, "basis").selectOption("intensity"); await control(page, "sort").selectOption("volume");
  await entries(page).first().locator('[data-comparison-action="focus"]').click();
  await action(page, "reference").click(); await action(page, "view").filter({ hasText: "Matrix" }).click();
  await persisted(page, (v) => v?.view === "matrix" && v.focus === "cell-5" && v.reference === "cell-5");
  await page.reload(); await page.locator("#ol-tab-compare").click();
  await expect(control(page, "basis")).toHaveValue("intensity"); await expect(control(page, "sort")).toHaveValue("volume");
  await expect(control(page, "reference")).toHaveValue("cell-5"); await expect(panel(page)).toHaveAttribute("data-view", "matrix");
  await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "6");
  await expect(control(page, "poc")).toHaveValue("frozen-poc"); await expect(focusMetric(page, "poc")).toHaveAttribute("data-canonical", "687.5");
});

test("a frozen POC with a price-bearing id stays absent from replay DOM until both support edges and restores exactly", async ({ page, fakeFor }) => {
  const value = collection(1), supportEnd = START + 15 * 60000, knownThrough = START + 30 * 60000;
  value.poc = { id: JSON.stringify(["90d", START - 86400000, supportEnd, 70062.5, "frozen-future-poc"]),
    label: "Frozen 90 days · 70,062.5 USDT", period: "90d", price: 70062.5, rowSize: 125, approximate: true,
    supportEnd, knownThrough, from: START - 86400000, through: supportEnd, source: "hand fixture" };
  const fake = await fakeFor("mini"); await open(page, fake, value);
  expect(await page.evaluate((record) => window.explorerState.comparison.validate(record).ok, value)).toBe(true);
  const before = await stored(page), select = control(page, "poc"), note = panel(page).locator(".ol-comparison-poc-note");
  await expect(select).toHaveValue(value.poc.id); await expect(note).toHaveText(value.poc.label);
  await expect(focusMetric(page, "poc")).toHaveAttribute("data-canonical", "62.5");
  for (const at of ["2026-09-23T12:00:00Z", "2026-09-23T12:15:00Z"]) {
    await page.evaluate((hash) => { location.hash = hash; }, HASH + "&replay=1&at=" + at);
    await expect(page.locator("#ol-replay")).toHaveAttribute("aria-pressed", "true");
    await expect(select.locator("option:checked")).toHaveText("Unavailable in replay");
    await expect(select.locator("option:checked")).toHaveJSProperty("disabled", true);
    await expect(note).toHaveText("Unavailable in replay");
    await expect(focusMetric(page, "poc")).toHaveAttribute("data-state", "hidden");
    expect(await focusMetric(page, "poc").getAttribute("data-canonical")).toBeNull();
    const dom = await panel(page).evaluate((root) => ({ html: root.outerHTML, text: root.innerText,
      options: Array.from(root.querySelector('[data-comparison-control="poc"]').options, (option) => ({ value: option.value, label: option.label })) }));
    for (const text of ["70062.5", "70,062.5", "frozen-future-poc", value.poc.label]) {
      expect(dom.html).not.toContain(text); expect(dom.text).not.toContain(text); expect(JSON.stringify(dom.options)).not.toContain(text);
    }
    expect(await stored(page)).toEqual(before);
  }
  await page.evaluate((hash) => { location.hash = hash; }, HASH + "&replay=1&at=2026-09-23T12:30:00Z");
  await expect(select).toHaveValue(value.poc.id); await expect(note).toHaveText(value.poc.label);
  await expect(select.locator("option:checked")).toHaveJSProperty("disabled", false);
  await expect(focusMetric(page, "poc")).toHaveAttribute("data-canonical", "62.5");
  await page.locator("#ol-replay").click(); await expect(page.locator("#ol-replay")).toHaveAttribute("aria-pressed", "false");
  await expect(select).toHaveValue(value.poc.id); await expect(note).toHaveText(value.poc.label);
  expect(await stored(page)).toEqual(before);
});

test("two tabs initially share a copied session then diverge; a fresh tab starts empty", async ({ page, context, fakeFor }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(3));
  const duplicatePromise = context.waitForEvent("page"); await page.evaluate((url) => window.open(url, "_blank"), fake.url + "/" + HASH);
  const duplicate = await duplicatePromise; await duplicate.waitForLoadState(); await duplicate.locator("#ol-tab-compare").click();
  await expect(entries(duplicate)).toHaveCount(3);
  await entries(duplicate).last().locator('[data-comparison-action="remove"]').click();
  await persisted(duplicate, (v) => v?.captures.length === 2); await expect(entries(page)).toHaveCount(3);
  const fresh = await context.newPage(); await open(fresh, fake);
  await expect(panel(fresh).locator(".ol-comparison-empty")).toBeVisible();
  await page.reload(); await page.locator("#ol-tab-compare").click(); await expect(entries(page)).toHaveCount(3);
});

test("quota failure keeps running focus and Retry saves its latest state", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(3));
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem; window.comparisonQuotaFault = true;
    Storage.prototype.setItem = function (name, value) { if (name === key && window.comparisonQuotaFault) throw new DOMException("comparison quota fault", "QuotaExceededError"); return set.call(this, name, value); };
  }, KEY);
  await entries(page).last().locator('[data-comparison-action="focus"]').click();
  await expect(panel(page).locator("[data-comparison-status]")).toContainText("Unsaved comparison");
  await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "3"); expect((await stored(page)).focus).toBe("cell-0");
  await entries(page).nth(1).locator('[data-comparison-action="focus"]').click();
  await page.evaluate(() => { window.comparisonQuotaFault = false; }); await action(page, "retry").click();
  await persisted(page, (v) => v?.focus === "cell-1"); await expect(action(page, "retry")).toBeHidden();
});

test("successful Copy keeps a quota-failed new capture visibly unsaved until Retry persists it", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(1), HASH + "&marks=none&lines=");
  await probe.waitForReady({ timeout: 20000 }); await probe.waitForQuiet({ quietMs: 300 });
  const before = await stored(page);
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem; window.comparisonQuotaFault = true;
    Storage.prototype.setItem = function (name, value) { if (name === key && window.comparisonQuotaFault) throw new DOMException("comparison quota fault", "QuotaExceededError"); return set.call(this, name, value); };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.comparisonCopiedText = text; } } });
  }, KEY);
  await page.locator("#ol-tab-cells").click();
  await page.locator("#ol-table-body tr").first().getByRole("button", { name: "Add to comparison" }).click();
  await expect(page.locator("#ol-tab-compare")).toHaveText("Compare · 2");
  const status = panel(page).locator("[data-comparison-status]");
  await expect(status).toContainText("Unsaved comparison"); await expect(entries(page)).toHaveCount(2);
  expect(await stored(page)).toEqual(before);
  await action(page, "copy").click();
  await expect.poll(() => page.evaluate(() => window.comparisonCopiedText)).toContain("Volume:");
  await expect(status).toHaveText("Unsaved comparison · Cell copied"); await expect(action(page, "retry")).toBeVisible();
  expect(await stored(page)).toEqual(before); await expect(entries(page)).toHaveCount(2);
  await page.evaluate(() => { window.comparisonQuotaFault = false; }); await action(page, "retry").click();
  await persisted(page, (value) => value?.captures.length === 2 && value.focus !== "cell-0");
  await expect(action(page, "retry")).toBeHidden(); await expect(status).not.toContainText("Unsaved comparison");
});

for (const rejected of ["{invalid JSON", JSON.stringify({ ...collection(1), comparisonVersion: 3 })]) {
  test(`rejected ${rejected.startsWith("{") && rejected.includes("comparisonVersion") ? "newer" : "corrupt"} text survives until confirmed Discard`, async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini"); await open(page, fake, rejected);
    await expect(panel(page).locator(".ol-comparison-empty")).toBeVisible(); await expect(action(page, "discard")).toBeVisible(); await expect(action(page, "retry")).toBeHidden();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe(rejected);
    await action(page, "discard").click(); await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe(rejected);
    await action(page, "discard").click(); await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await persisted(page, (v) => v?.comparisonVersion === 2 && v.captures.length === 0); await expect(action(page, "discard")).toBeHidden();
  });
}

test("near-cap oversized mutation leaves the collection and stored bytes unchanged", async ({ page, fakeFor }) => {
  const value = collection(2); value.captures[0].metrics["volume.amount"].audit = "";
  const remaining = CAP - Buffer.byteLength(JSON.stringify(value)); value.captures[0].metrics["volume.amount"].audit = "x".repeat(remaining);
  const fake = await fakeFor("mini"); await open(page, fake, value);
  await expect(entries(page)).toHaveCount(2); await control(page, "basis").selectOption("intensity");
  await expect(panel(page).locator("[data-comparison-status]")).toContainText("4 MiB"); await expect(control(page, "basis")).toHaveValue("auto");
  expect(await page.evaluate((key) => new TextEncoder().encode(sessionStorage.getItem(key)).length, KEY)).toBe(CAP);
  expect((await stored(page)).basis).toBe("auto"); await expect(entries(page)).toHaveCount(2);
});

test("expanded reload restores this tab's stashed layout over changed shared preferences", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(6));
  await probe.waitForReady({ timeout: 20000 });
  await page.locator("#ol-res").click();
  if (await page.locator("#ol-auto").getAttribute("aria-pressed") !== "true") await page.locator("#ol-auto").click();
  await page.keyboard.press("Escape"); await probe.waitForReady({ timeout: 20000 }); await probe.waitForQuiet({ quietMs: 400 });
  const initial = await page.locator("#ol-main").getAttribute("data-side");
  const beforeHash = new URL(page.url()).hash, initialN = await page.locator("#ol-n").textContent(), initialM = await page.locator("#ol-m").textContent();
  await action(page, "expand").click();
  await expect(page.locator("#ol-canvas")).toBeHidden(); await expect(page.locator("#ol-side")).toHaveJSProperty("inert", true);
  await persisted(page, (v) => v?.expanded === true && v.restoreLayout !== null);
  await page.setViewportSize({ width: 900, height: 800 }); await probe.waitForQuiet({ quietMs: 300 });
  expect(new URL(page.url()).hash).toBe(beforeHash); expect(await page.locator("#ol-n").textContent()).toBe(initialN); expect(await page.locator("#ol-m").textContent()).toBe(initialM);
  await page.evaluate(() => {
    const key = "market-state-cube-explorer:view:v5", saved = JSON.parse(localStorage.getItem(key));
    saved.prefs = { ...saved.prefs, sideOpen: false, sideWidth: 520, drawerHeight: 550 }; localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload(); await expect(action(page, "expand")).toHaveText("Restore chart"); await expect(page.locator("#ol-canvas")).toBeHidden();
  await action(page, "expand").click(); await expect(page.locator("#ol-canvas")).toBeVisible();
  await expect(page.locator("#ol-main")).toHaveAttribute("data-side", initial); await expect(page.locator("#ol-side")).toHaveJSProperty("inert", false);
  await persisted(page, (v) => v?.expanded === false && v.restoreLayout === null);
  expect((await stored(page)).captures).toHaveLength(6);
});

for (const theme of ["light", "dark"]) {
  test(`${theme} narrow comparison and 2× page scale preserve readable typography and stack the panes`, async ({ page, fakeFor }) => {
    await page.emulateMedia({ colorScheme: theme });
    const fake = await fakeFor("mini"); await open(page, fake, collection(6)); await action(page, "expand").click();
    const client = await page.context().newCDPSession(page); await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await page.setViewportSize({ width: 500, height: 1000 });
    const sizes = await panel(page).evaluate((root) => {
      const primary = root.querySelector('.ol-comparison-focus [data-metric="volume"] strong'), value = root.querySelector('.ol-comparison-focus [data-metric="trades"] strong'), card = root.querySelector('.ol-comparison-card'), label = root.querySelector('.ol-comparison-label');
      const focus = root.querySelector('.ol-comparison-focus').getBoundingClientRect(), collection = root.querySelector('.ol-comparison-collection').getBoundingClientRect();
      return { primary: parseFloat(getComputedStyle(primary).fontSize), value: parseFloat(getComputedStyle(value).fontSize), label: parseFloat(getComputedStyle(label).fontSize), cardValue: parseFloat(getComputedStyle(card.querySelector('strong.ol-comparison-value')).fontSize), cardWidth: card.getBoundingClientRect().width, focus, collection, overflow: root.scrollWidth - root.clientWidth };
    });
    expect(sizes.primary).toBeGreaterThanOrEqual(28); expect(sizes.value).toBeGreaterThanOrEqual(20); expect(sizes.label).toBeGreaterThanOrEqual(14); expect(sizes.cardValue).toBeGreaterThanOrEqual(18);
    expect(sizes.cardWidth).toBeGreaterThanOrEqual(200); expect(sizes.collection.y).toBeGreaterThanOrEqual(sizes.focus.y + sizes.focus.height - 1); expect(sizes.overflow).toBeLessThanOrEqual(1);
    await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 }); await client.detach();
  });
}

test("removing the only last-page entry clamps the page and reveals its previous neighbor", async ({ page, fakeFor }) => {
  const value = collection(25); value.page = 1; value.focus = "cell-24";
  const fake = await fakeFor("mini"); await open(page, fake, value);
  await expect(entries(page)).toHaveCount(1); await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "25");
  await action(page, "remove").first().click();
  await expect(page.locator("#ol-tab-compare")).toHaveText("Compare · 24"); await expect(entries(page)).toHaveCount(24);
  await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "24");
  await persisted(page, (v) => v?.page === 0 && v.focus === "cell-23" && v.captures.length === 24);
});

test("discarding rejected storage preserves valid running captures and latest focus", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(3));
  await page.evaluate((key) => sessionStorage.setItem(key, "corrupt after restore"), KEY);
  await entries(page).last().locator('[data-comparison-action="focus"]').click();
  await expect(action(page, "discard")).toBeVisible(); await expect(action(page, "retry")).toBeHidden(); await expect(entries(page)).toHaveCount(3);
  await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "3");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe("corrupt after restore");
  await action(page, "discard").click(); await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await persisted(page, (v) => v?.captures.length === 3 && v.focus === "cell-2"); await expect(entries(page)).toHaveCount(3);
});

test("Escape after an Expand quota failure saves the restored layout and clears the stale warning", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini"); await open(page, fake, collection(3));
  await probe.waitForReady({ timeout: 20000 }); await probe.waitForQuiet({ quietMs: 300 });
  const before = await stored(page), side = await page.locator("#ol-main").getAttribute("data-side");
  const drawerHeight = await page.locator("#ol-drawer").evaluate((node) => node.style.getPropertyValue("--drawer-h"));
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem; window.comparisonQuotaFault = true; window.comparisonRecoveredSave = null;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && window.comparisonQuotaFault) throw new DOMException("comparison quota fault", "QuotaExceededError");
      const result = set.call(this, name, value);
      if (name === key) window.comparisonRecoveredSave = JSON.parse(value);
      return result;
    };
  }, KEY);
  await action(page, "expand").click(); await expect(page.locator("#ol-canvas")).toBeHidden();
  const status = panel(page).locator("[data-comparison-status]");
  await expect(status).toContainText("Unsaved comparison"); await expect(action(page, "retry")).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await page.evaluate(() => { window.comparisonQuotaFault = false; });
  await action(page, "expand").focus(); await page.keyboard.press("Escape");
  await expect(page.locator("#ol-canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.comparisonRecoveredSave?.expanded === false && window.comparisonRecoveredSave?.restoreLayout === null)).toBe(true);
  expect(await stored(page)).toEqual(before);
  await expect(page.locator("#ol-main")).toHaveAttribute("data-side", side);
  expect(await page.locator("#ol-drawer").evaluate((node) => node.style.getPropertyValue("--drawer-h"))).toBe(drawerHeight);
  await expect(status).toHaveText(""); await expect(action(page, "retry")).toBeHidden();
});


for (const recovery of ["reload", "discard"]) {
  test(`a failed startup read retains recovered saved captures until ${recovery}`, async ({ page, fakeFor, probe }) => {
    const original = collection(3); original.focus = "cell-2"; original.reference = "cell-1"; original.view = "matrix";
    const raw = JSON.stringify(original), fake = await fakeFor("mini");
    await page.addInitScript(({ key, raw }) => {
      const get = Storage.prototype.getItem;
      const seeded = get.call(sessionStorage, "comparison-read-failure-seeded");
      if (!seeded) { sessionStorage.setItem(key, raw); sessionStorage.setItem("comparison-read-failure-seeded", "1"); }
      window.comparisonInitialReadBlocked = !seeded;
      Storage.prototype.getItem = function (name) {
        if (name === key && window.comparisonInitialReadBlocked) throw new DOMException("initial comparison read blocked", "SecurityError");
        return get.call(this, name);
      };
    }, { key: KEY, raw });
    await open(page, fake, undefined, HASH + "&marks=none&lines=");
    await probe.waitForReady({ timeout: 20000 }); await probe.waitForQuiet({ quietMs: 300 });
    await expect(panel(page).locator(".ol-comparison-empty")).toBeVisible();
    await expect(panel(page).locator("[data-comparison-status]")).toContainText("Unsaved comparison");
    for (let retry = 0; retry < 2; retry++) {
      await action(page, "retry").click(); await expect(action(page, "retry")).toBeVisible();
    }
    await page.evaluate(() => { window.comparisonInitialReadBlocked = false; });
    await action(page, "retry").click();
    await expect(action(page, "discard")).toBeVisible(); await expect(action(page, "retry")).toBeHidden();
    await expect(panel(page).locator("[data-comparison-status]")).toContainText("reload to restore");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe(raw);
    if (recovery === "reload") {
      await page.reload(); await page.locator("#ol-tab-compare").click();
      await expect(entries(page)).toHaveCount(3); await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", "3");
      await expect(action(page, "discard")).toBeHidden(); await expect(action(page, "retry")).toBeHidden();
      expect(await stored(page)).toEqual(original);
    } else {
      await page.locator("#ol-tab-cells").click();
      const row = page.locator("#ol-table-body tr").first();
      const volume = Number(await row.locator('[data-field="volume"]').getAttribute("data-canonical"));
      await row.getByRole("button", { name: "Add to comparison" }).click();
      await expect(page.locator("#ol-tab-compare")).toHaveText("Compare · 1");
      await expect(focusMetric(page, "volume")).toHaveAttribute("data-canonical", String(volume));
      await expect(action(page, "discard")).toBeVisible();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe(raw);
      await action(page, "discard").click(); await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), KEY)).toBe(raw);
      await action(page, "discard").click(); await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
      await persisted(page, (value) => value?.captures.length === 1 && value.focus === value.captures[0].id && value.captures[0].metrics["volume.amount"].value === volume);
      expect((await stored(page)).captures[0].id).not.toMatch(/^cell-/);
      await expect(action(page, "discard")).toBeHidden(); await expect(action(page, "retry")).toBeHidden();
    }
  });
}

test("selected metric shares four-figure cards while original reading and captured history remain frozen",async({page,fakeFor})=>{
  const value=collection(2), capture=value.captures[0], through=capture.observed.t1;
  capture.contextOrigin="frame-v2";
  const original={formula:"fixture.volume@1",unit:"usdt",basis:"amount",result:{tag:"finite",value:1},comparisonMetric:"volume",supportId:"observation",historyIds:["volume"]};
  capture.originatingObservation=original;
  capture.context={supports:{observation:{supportEnd:through,knownThrough:through}},originatingObservation:original,histories:[{id:"volume",formula:"fixture.volume@1",unit:"usdt",slots:[1,null,3].map(v=>({result:v===null?{tag:"unsupported",reason:"Fixture gap"}:{tag:"finite",value:v},supportId:"observation",denominatorIds:[]}))}]};
  capture.context.histories.push({id:"imbalance",formula:"cells.imbalance@1",unit:"signed-share",slots:[{result:{tag:"finite",value:.5},supportId:"observation",denominatorIds:[]}]});
  const fake=await fakeFor("mini");await open(page,fake,value);
  const focus=panel(page).locator('.ol-comparison-focus');
  await expect(focus.locator(':scope > .ol-comparison-metrics > .ol-comparison-metric')).toHaveCount(4);
  await expect(focus.locator('.ol-comparison-history')).toHaveCount(1);
  await control(page,'selectedMetric').selectOption('trades');
  await expect(focus.locator('.ol-comparison-primary')).toHaveAttribute('data-metric','trades');
  await expect(entries(page).first().locator('.ol-comparison-primary')).toHaveAttribute('data-metric','trades');
  await focus.locator('.ol-comparison-details summary').click();
  await expect(focus.locator('.ol-comparison-details')).toContainText('fixture.volume@1');
  await expect(focus.locator('[data-history="volume"]')).toContainText('Fixture gap');
  await expect(focus.locator('[data-history="imbalance"]')).toContainText('Net taker imbalance');
  await expect(focus.locator('[data-history="imbalance"] li')).toHaveAttribute('data-canonical','0.5');
  await action(page,'view').filter({hasText:'Matrix'}).click();
  await expect(panel(page).locator('.ol-comparison-matrix thead th').nth(1)).toHaveText('Trades');
  await persisted(page,v=>v?.selectedMetric==='trades');
  const stored=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),KEY);
  expect(stored.captures[0].originatingObservation).toEqual(original);
  expect(stored.captures[0].context).toEqual(capture.context);
  await page.screenshot({path:'reports/p7-s3-comparison-frozen.png'});
});

for (const selectedMetric of ["volume", "trades"]) {
  test(`${selectedMetric} capture preserves imbalance history in details and Copy cell independently of ranked metrics`, async ({ page, fakeFor }) => {
    const value = collection(1), capture = value.captures[0], through = capture.observed.t1;
    value.selectedMetric = selectedMetric;
    capture.contextOrigin = "frame-v2";
    const unit = selectedMetric === "volume" ? "usdt" : "trades";
    const original = { formula: `fixture.${selectedMetric}@1`, unit, basis: "amount", result: { tag: "finite", value: 1 },
      comparisonMetric: selectedMetric, supportId: "observation", historyIds: [selectedMetric] };
    capture.originatingObservation = original;
    capture.context = {
      supports: {
        observation: { supportEnd: through, knownThrough: through },
        later: { supportEnd: through, knownThrough: START + 3 * 60000 },
      },
      originatingObservation: original,
      histories: [
        { id: selectedMetric, formula: original.formula, unit, slots: [{ result: { tag: "finite", value: 1 }, supportId: "observation", denominatorIds: [] }] },
        { id: "imbalance", formula: "cells.delta.amount@1", unit: "usdt", slots: [
          { result: { tag: "finite", value: 987.125 }, supportId: "later", denominatorIds: [] },
          { result: { tag: "unsupported", reason: "Fixture imbalance gap" }, supportId: "observation", denominatorIds: [] },
          { result: { tag: "finite", value: -321.5 }, supportId: "observation", denominatorIds: [] },
        ] },
      ],
    };
    const fake = await fakeFor("mini"); await open(page, fake, value);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.comparisonCopiedText = text; } } });
    });
    const focus = panel(page).locator(".ol-comparison-focus"), history = focus.locator('[data-history="imbalance"]');
    await focus.locator(".ol-comparison-details summary").click();
    await expect(focus.locator(".ol-comparison-frozen-history")).toHaveCount(2);
    await expect(history).toContainText("Net taker imbalance · frozen");
    await expect(history.locator("li")).toHaveText(["987.125 USDT", "Fixture imbalance gap", "-321.5 USDT"]);
    await expect(control(page, "selectedMetric").locator("option")).toHaveCount(9);
    await expect(control(page, "selectedMetric").locator('option[value="imbalance"]')).toHaveCount(0);
    await action(page, "copy").click();
    await expect.poll(() => page.evaluate(() => window.comparisonCopiedText)).toContain("Net taker imbalance frozen history: 987.125; Fixture imbalance gap; -321.5");

    await page.evaluate((hash) => { location.hash = hash; }, HASH.replace("r=4,0", "r=0,0") + "&replay=1&at=2026-09-23T12:02:00Z");
    await expect(history.locator("li").first()).toHaveAttribute("data-canonical", "hidden");
    await expect(history.locator("li")).toHaveText(["Unavailable in replay", "Fixture imbalance gap", "-321.5 USDT"]);
    expect(await history.innerHTML()).not.toContain("987.125");
    await action(page, "copy").click();
    await expect.poll(() => page.evaluate(() => window.comparisonCopiedText)).toContain("Net taker imbalance frozen history: Unavailable in replay; Fixture imbalance gap; -321.5");
    expect(await page.evaluate(() => window.comparisonCopiedText)).not.toContain("987.125");
    expect((await stored(page)).captures[0].context).toEqual(capture.context);
  });
}
