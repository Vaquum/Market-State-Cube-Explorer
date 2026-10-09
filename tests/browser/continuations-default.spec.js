"use strict";
// Issues #91/#92: observable tab, URL/history/storage and rendered CSS focus.
// Oracles: requested opt-in policy and independent DOM geometry; no implementation state reads.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");
const P = require("./persistence-support.js");
const off = async (page) => {
  await expect(page.locator("#ol-context-tab")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#ol-evidence-tab")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#ol-evidence")).toBeHidden();
};
async function open(page, fake, probe, hash = "#w=24h&vis=2") {
  await page.goto(`${fake.url}/${hash}`);
  await S.atRest(page, fake, probe);
}
const state = (page) => page.evaluate(() => ({ hash: location.hash, history: history.length, entries: JSON.stringify(history.state) }));
async function point(page) {
  return page.locator("#ol-canvas").evaluate((n) => {
    const b = n.getBoundingClientRect(), g = n.dataset.layout.split(",").map(Number);
    return { x: b.x + g[0] + g[2] * .4, y: b.y + g[1] + g[3] * .4 };
  });
for (const profile of ["recorded", "mini"]) {
  test(`${profile}: default stays off through Pan clicks and inactive anchor keys; C explicitly enables it`, async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor(profile);
    await open(page, fake, probe);
    await off(page);
    const before = await state(page), p = await point(page);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press(",");
    await page.keyboard.press(".");
    await off(page);
    expect(await state(page)).toEqual(before);
    await page.keyboard.press("c");
    await expect(page.locator("#ol-evidence-tab")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("at=");
    await page.keyboard.press("c");
    await off(page);
    const disabled = await state(page);
    await page.mouse.click(p.x + 10, p.y);
    await page.keyboard.press(".");
    expect(await state(page)).toEqual(disabled);
  });
}
for (const version of [4, 5]) {
  test(`bare-root version ${version} restore starts off, explicit links and reload keep the encoded choice`, async ({ page, context, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    const raw = version === 4 ? { ...require("../fixtures/legacy/view-v4.json"), tab: "evidence" } : {
      version: 5, visualVersion: 2, prefs: {}, view: P.address({ window: "7d", mode: "flow", tab: "evidence" }).hash,
    };
    await context.addInitScript(({ version, raw }) => {
      if (!localStorage.getItem("__continuationSeed")) {
        localStorage.setItem("__continuationSeed", "1");
        localStorage.setItem(`market-state-cube-explorer:view:v${version}`, JSON.stringify(raw));
      }
    }, { version, raw });
    await open(page, fake, probe, "");
    await off(page);
    expect(await page.evaluate(() => location.hash)).toContain("w=7d");
    expect(await page.evaluate(() => location.hash)).toContain("mode=flow");
    await open(page, fake, probe, "#w=24h&vis=2&tab=continuations");
    await expect(page.locator("#ol-evidence-tab")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await S.atRest(page, fake, probe);
    await expect(page.locator("#ol-evidence-tab")).toHaveAttribute("aria-pressed", "true");
    await open(page, fake, probe, "");
    await off(page);
  });
}
for (const scheme of ["light", "dark"]) {
  test(`${scheme}: focus has no canvas perimeter; keyboard cue is above the plot`, async ({ page, fakeFor, probe }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, await fakeFor("recorded"), probe);
    const canvas = page.locator("#ol-canvas"), cue = page.locator("#ol-chart-focus");
    const noPerimeter = async () => {
      expect(await canvas.evaluate((n) => {
        const s = getComputedStyle(n);
        return { outline: s.outlineStyle, border: s.borderTopWidth, shadow: s.boxShadow };
      })).toEqual({ outline: "none", border: "0px", shadow: "none" });
    };
    const p = await point(page);
    await page.mouse.click(p.x, p.y);
    for (const key of ["c", "c", "i", "i", "t", "t", "x", "Shift", "ArrowLeft", "j"]) {
      await page.keyboard.press(key);
      await noPerimeter();
    }
    await page.keyboard.press("e");
    await page.keyboard.press("Escape");
    await expect(canvas).toBeFocused();
    await noPerimeter();
    await expect(cue).toBeVisible();
    const cb = await cue.boundingBox(), plot = await canvas.boundingBox();
    expect(cb.y + cb.height).toBeLessThanOrEqual(plot.y);
    // Tab and Shift+Tab still reach the chart; other controls retain their own focus ring.
    await page.locator("#ol-reset-canvas").focus();
    await page.keyboard.press("Tab");
    await expect(canvas).toBeFocused();
    await expect(cue).toBeVisible();
    await noPerimeter();
    await page.keyboard.press("Tab");
    await expect(cue).toBeHidden();
    await page.keyboard.press("Shift+Tab");
    await expect(canvas).toBeFocused();
    await noPerimeter();
    await page.locator("#ol-reset-canvas").focus();
    expect(await page.locator("#ol-reset-canvas").evaluate((n) => getComputedStyle(n).outlineStyle)).toBe("solid");
    await expect(cue).toBeHidden();
    await page.setViewportSize({ width: 375, height: 812 });
    await canvas.focus();
    await noPerimeter();
    await expect(cue).toBeVisible();
    await page.screenshot({ path: `reports/continuations-focus-${scheme}.png` });
  });
}
