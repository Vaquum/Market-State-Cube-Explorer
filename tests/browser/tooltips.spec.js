"use strict";
// Oracle: the user's 500 ms interval and actual control/value targets, hand-written
// quantity/action meanings, native select change semantics, DOM and request counts.
// The dense-target case checks bounded work, not a designated-machine certificate.
const { test, expect } = require("./fixtures.js");
test.use({ reducedMotion: "reduce" });
async function open(page, fakeFor, probe, profile = "mini") {
  const fake = await fakeFor(profile);
  await page.goto(fake.url + "/#w=24h&vis=2");
  await probe.waitForReady();
  if (await page.locator("#ol-side-toggle").getAttribute("aria-expanded") === "false") await page.locator("#ol-side-toggle").click();
  await page.locator("#ol-context-tab").click();
  await expect(page.locator(VOLUME)).toBeVisible();
  await probe.waitForReady();
  return fake;
}
const VOLUME = '#ol-selection-card .ol-cell-stat[data-measure="volume"] dd';
const TRADES = '#ol-selection-card .ol-cell-stat[data-measure="trades"] dd';
const bubble = page => page.locator("#ol-help-tooltip");
async function frozen(page) {
  const now = new Date("2026-10-17T12:00:00Z");
  await page.clock.install({ time: now });
  // Pause ahead of installation so elapsed setup time cannot put the target in the past.
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
}
test("the read value itself explains its quantity at 500 ms and preserves existing descriptions", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await frozen(page);
  const value = page.locator(VOLUME);
  await value.dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(499);
  await expect(bubble(page)).not.toBeVisible();
  await page.clock.runFor(1);
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page)).toContainText("Total USDT value of reported trades");
  await expect(value).toHaveAttribute("aria-describedby", /ol-help-tooltip/);
  await value.dispatchEvent("pointerout", { pointerType: "mouse" });
  await page.clock.runFor(150);
  await expect(bubble(page)).toBeHidden();
  expect((await value.getAttribute("aria-describedby")) || "").not.toContain("ol-help-tooltip");
  await page.locator("#ol-window-text").dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(500);
  await expect(bubble(page)).toContainText("Time span currently covered by the chart");
});
test("a tooltip cannot intercept a neighboring menu action, and missing comparison history explains its state", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-window").click();
  await page.locator('[data-window="7d"]').hover();
  await expect(bubble(page)).toBeVisible();
  const next = page.locator('#ol-window-menu [data-window]').first();
  const key = await next.getAttribute('data-window');
  const rect = await next.boundingBox();
  await bubble(page).evaluate((node, rect) => Object.assign(node.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }), rect);
  await next.click();
  await expect(page.locator('#ol-window-menu')).toBeHidden();
  expect(await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('w'))).toBe(key);
  await page.evaluate(() => { const note=document.createElement('span'); note.className='ol-comparison-history-note'; note.textContent='Frozen context not recorded'; document.querySelector('#origo-lens').append(note); });
  await page.locator('.ol-comparison-history-note').hover();
  await expect(bubble(page)).toContainText('not a zero measurement');
});
test("leaving before the delay cancels work, and an icon receives its button's explanation", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await frozen(page);
  await page.locator(VOLUME).dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(250);
  await page.locator(VOLUME).dispatchEvent("pointerout", { pointerType: "mouse" });
  await page.clock.runFor(500);
  await expect(bubble(page)).not.toBeVisible();
  await page.locator("#ol-lines svg").first().dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(500);
  await expect(bubble(page)).toContainText("Column overlays");
});
test("moving from an explained value to another value still waits 500 ms", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await frozen(page);
  await page.locator(VOLUME).dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(500);
  await expect(bubble(page)).toContainText("Total USDT");
  await page.locator(TRADES).dispatchEvent("pointerover", { pointerType: "mouse" });
  await expect(bubble(page)).toBeHidden();
  await page.clock.runFor(499);
  await expect(bubble(page)).toBeHidden();
  await page.clock.runFor(1);
  await expect(bubble(page)).toContainText("Number of reported trades");
});
test("generated menu items and a disabled control explain their own actions", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe, "recorded");
  await page.locator("#ol-window").click();
  await page.locator('[data-window="7d"]').hover();
  await expect(bubble(page)).toContainText("trading history");
  await page.keyboard.press("Escape");
  await page.locator("#ol-tab-rallies").click();
  await expect(page.locator("#ol-rally-discover")).toBeDisabled();
  await page.locator("#ol-rally-discover").hover();
  await expect(bubble(page)).toContainText("Unavailable in the current state");
});
test("dropdown choices have help, preserve change events and keep typing inside their list", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-tab-rallies").click();
  const select = page.locator("#ol-rally-mode");
  await select.click();
  const list = page.locator("#ol-help-choices");
  await expect(list).toBeVisible();
  const controlled = list.getByRole("option", { name: "Controlled advance", exact: true });
  await controlled.hover();
  await expect(bubble(page)).toContainText("permitted pullback");
  await controlled.click();
  await expect(select).toHaveValue("controlled_advance");
  await expect(page.locator("#ol-rally-pullback")).toBeVisible();
  await expect(list).toBeHidden();
  await select.press("Enter");
  await page.keyboard.press("s");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("swing");
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "false");
  await expect(select).toBeFocused();
});
test("modal fields show their explanation above the native dialog", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-trend").click();
  await page.locator("#ol-drawing-more").click();
  await page.locator('[data-drawing-action="new-exact"]').click();
  await page.locator("#ol-drawing-a-price").hover();
  await expect(bubble(page)).toContainText("first endpoint");
  expect(await bubble(page).evaluate(node => node.parentElement.id)).toBe("ol-drawing-editor");
  const rect = await bubble(page).boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
});
test("dropdown activation uses option identity after asynchronous replacement and ignores vanished choices", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-tab-rallies").click();
  const select = page.locator("#ol-rally-mode"), list = page.locator("#ol-help-choices");
  await select.click();
  await select.evaluate(node => {
    const current = node.value; node.replaceChildren(...Array.from(node.options).reverse()); node.value = current;
  });
  await list.getByRole("option", { name: "Controlled advance", exact: true }).click();
  await expect(select).toHaveValue("controlled_advance");
  await select.click();
  await select.evaluate(node => node.querySelector('[value="swing"]').remove());
  const before = await select.inputValue();
  await list.getByRole("option", { name: "Swing", exact: true }).click();
  await expect(select).toHaveValue(before);
  await expect(list).toBeHidden();
});
test("filtered reference choices stay above their pane and use viewport positioning", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-reference-toggle").click();
  await page.locator("#ol-reference-search").fill("Grid precision");
  await page.locator("#ol-reference-topic").click();
  const list = page.locator("#ol-help-choices");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option")).toHaveText("Grid precision");
  expect(await list.evaluate(node => getComputedStyle(node).position)).toBe("fixed");
  expect(await list.getByRole("option").evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
});
test("title-only help hides on leave and value labels take precedence over broad metric keys", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-lines").click();
  const label = page.locator('#ol-poc').locator('..');
  await label.hover();
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page)).toContainText("Each column's point of control");
  await label.evaluate(node => node.append(document.createTextNode(" · current")));
  await expect(bubble(page)).toContainText("Each column's point of control");
  await page.mouse.move(0, 0);
  await expect(bubble(page)).toBeHidden();
  const meanings = await page.evaluate(() => ({
    distance: window.explorerHelp.meaning("POC distance", "poc"),
    path: window.explorerHelp.meaning("Path / price span", "path"),
  }));
  // The collection metric is a nonnegative band gap; signed ATR context is separate.
  expect(meanings.distance).toContain("Nonnegative distance");
  expect(meanings.distance).toContain("contains or touches");
  expect(meanings.path).toContain("divided by the price-row width");
});
test("changing a hovered value refreshes its help without polling or stale title restoration", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator(VOLUME).hover();
  await expect(bubble(page)).toContainText("Total USDT");
  await page.locator(VOLUME).evaluate(node => { node.textContent = "2.5K"; node.title = "2,500 USDT"; });
  await expect(bubble(page)).toContainText("2,500 USDT");
  await page.mouse.move(0, 0);
  await expect(bubble(page)).toBeHidden();
  await expect(page.locator(VOLUME)).toHaveAttribute("title", "2,500 USDT");
});
test("thousands of dynamic values need no registration, one hover timer and no extra requests", async ({ page, fakeFor, probe }) => {
  const fake = await open(page, fakeFor, probe);
  await frozen(page);
  const requests = fake.log().length;
  const result = await page.evaluate(() => {
    const host = document.createElement("div"), reads = new Array(2000).fill(0), live = new Set();
    // Keep the existing chart geometry and scroll position fixed while adding targets.
    host.style.cssText = "position:fixed;left:8px;top:8px;width:200px;height:20px;overflow:auto";
    let listeners = 0, high = 0;
    const add = EventTarget.prototype.addEventListener, set = window.setTimeout, clear = window.clearTimeout;
    EventTarget.prototype.addEventListener = function (...args) { listeners++; return add.apply(this, args); };
    window.setTimeout = function (fn, delay, ...args) {
      let id; id = set(() => { live.delete(id); fn(...args); }, delay);
      if (delay === 500) { live.add(id); high = Math.max(high, live.size); }
      return id;
    };
    window.clearTimeout = function (id) { live.delete(id); return clear(id); };
    for (let i = 0; i < reads.length; i++) {
      const node = document.createElement("span"); node.dataset.field = "volume"; node.textContent = "10";
      Object.defineProperty(node, "textContent", { configurable: true, get() { reads[i]++; return "10"; } });
      host.append(node);
    }
    document.querySelector("#origo-lens").append(host);
    const start = performance.now();
    for (const node of host.children) node.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    const elapsed = performance.now() - start;
    window.__tooltipDense = { reads, host, restore() { EventTarget.prototype.addEventListener = add; window.setTimeout = set; window.clearTimeout = clear; } };
    return { reads: reads.reduce((a, b) => a + b, 0), listeners, high, pending: live.size, elapsed };
  });
  expect(result.reads).toBe(0);
  expect(result.listeners).toBe(0);
  expect(result.high).toBe(1);
  expect(result.pending).toBe(1);
  await page.clock.runFor(500);
  await expect(bubble(page)).toContainText("Total USDT");
  const readCounts = await page.evaluate(() => { const data = window.__tooltipDense; data.restore(); return data.reads.filter(Boolean).length; });
  expect(readCounts).toBe(1);
  expect(await page.locator(".ol-hint").count()).toBe(1);
  expect(fake.log().length).toBe(requests);
  test.info().annotations.push({ type: "dense-hover", description: `2,000 target changes: ${result.elapsed.toFixed(2)} ms; one pending timer` });
});
test("refreshing an active control description retains one accessible description", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator("#ol-lines").hover();
  await expect(bubble(page)).toContainText("Column overlays");
  const counts = await page.locator("#ol-lines").evaluate(async node => {
    const before = document.querySelectorAll('[id^="ol-desc-"]').length;
    for (let i = 0; i < 30; i++) { node.dataset.hint = `Current line controls, revision ${i}`; await Promise.resolve(); }
    return { before, after: document.querySelectorAll('[id^="ol-desc-"]').length, ids: node.getAttribute('aria-describedby') };
  });
  expect(counts.after).toBe(counts.before);
  expect(counts.ids.split(/\s+/)).toContain("ol-help-tooltip");
  await expect(bubble(page)).toContainText("revision 29");
});
test("static and generated control/value targets resolve explanatory copy without registration", async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  for (const selector of ["#ol-window", "#ol-res", "#ol-lines", "#ol-tab-query", "#ol-tab-compare"]) {
    await page.locator(selector).click();
    const missing = await page.evaluate(() => {
      const root = document.querySelector("#origo-lens");
      // Independent surface inventory: controls plus the value elements named by the user's rule.
      return [...root.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a,summary,output,td,dd,.ol-metric>strong,.ol-row>span:last-child,.ol-comparison-value')]
        .filter(node => !node.closest('.ol-hint,.ol-tip,.ol-sr,#ol-keys dd,#ol-reference-article dd') && !node.matches('input[type="file"][hidden]'))
        .filter(node => { const target = window.explorerHelp.target(node, root); const info = target && window.explorerHelp.describe(target); return !info?.label || !info.text || info.text.length < 12; })
        .map(node => node.id || node.outerHTML.slice(0, 120));
    });
    expect(missing).toEqual([]);
    await page.keyboard.press("Escape");
  }
});
