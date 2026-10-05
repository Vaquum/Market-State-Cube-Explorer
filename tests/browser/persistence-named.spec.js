"use strict";
// Named-view regression checks: protected authority must retain list order and a failed
// Undo must remain retryable without publishing a partial registry.
const { test, expect } = require("./fixtures.js");
const S = require("./persistence-support.js");
const PREFIX = "market-state-cube-explorer:";
const PUBLICATION = "drawing-views:v2:record:";
const legacyViews = ["A", "B"].map((name) => ({
  name, live: false, span: 10, lead: 0, auto: true, mode: "volume", pane: "cells",
  rows: "off", period: "90d", hash: "#w=24h&vis=2&ap=" + S.AP,
  tA: 1, tB: 2, cut: 3, n: 6, m: 0, window: "24h", replay: false, visualVersion: 2,
}));
const rawLegacy = JSON.stringify(legacyViews);
const rowNames = (page) => page.locator("#ol-saved .ol-entry-main");
async function openSeeded(page, context, fake) {
  await context.addInitScript(({ prefix, raw }) => {
    try {
      if (localStorage.getItem("__named_seeded")) return;
      localStorage.setItem("__named_seeded", "1");
      localStorage.setItem(prefix + "views:v1", raw);
    } catch { /* about:blank has no origin storage */ }
  }, { prefix: PREFIX, raw: rawLegacy });
  await page.goto(fake.url + "/");
  await fake.idle();
  await S.openViews(page);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
}
async function upgradeA(page) {
  await page.locator("#ol-view-name").fill("A");
  await page.locator("#ol-view-form button[type=submit]").click();
  await expect.poll(async () => (await S.namedEntries(page)).map((x) => x.visualVersion)).toEqual([3, 2]);
}

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map((p) => p.close().catch(() => {})));
});

test("upgrading and updating first legacy name retains A, B order and unchanged legacy bytes", async ({ page, context, fakeFor }) => {
  const fake = await fakeFor("mini");
  await openSeeded(page, context, fake);
  await upgradeA(page);
  const entries = await S.namedEntries(page);
  expect(entries.map((x) => x.name)).toEqual(["A", "B"]);
  expect(entries[0].payload).toMatchObject({ visualVersion: 3, drawings: { schemaVersion: 1, objects: [] } });
  expect(entries[1]).toEqual(legacyViews[1]);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
  await page.reload();
  await fake.idle();
  await S.openViews(page);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
  expect(await S.namedEntries(page)).toEqual(entries);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
  // Updating an existing protected entry must publish its changed complete snapshot.
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await expect.poll(async () => {
    const mode = S.param((await S.where(page)).hash, "mode");
    return mode !== null && mode !== entries[0].payload.view.mode;
  }).toBe(true);
  const newMode = S.param((await S.where(page)).hash, "mode");
  await S.openViews(page);
  await page.locator("#ol-view-name").fill("A");
  await page.locator("#ol-view-form button[type=submit]").click();
  await expect.poll(async () => (await S.namedEntries(page))[0].payload.view.mode).toBe(newMode);
  expect((await S.namedEntries(page)).map((x) => x.name)).toEqual(["A", "B"]);
  expect((await S.namedEntries(page))[1]).toEqual(legacyViews[1]);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
});

test("quota during named Delete Undo keeps the authoritative deletion and allows one retry in place", async ({ page, context, fakeFor }) => {
  const fake = await fakeFor("mini");
  await openSeeded(page, context, fake);
  await upgradeA(page);
  const savedA = (await S.namedEntries(page))[0];
  await page.getByRole("button", { name: "Delete “A”", exact: true }).click();
  await expect.poll(async () => (await S.namedEntries(page)).map((x) => x.name)).toEqual(["B"]);
  await expect(rowNames(page)).toHaveText(["B"]);
  const deletedStorage = await S.namedStorage(page);
  await page.evaluate((key) => {
    window.__namedOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.startsWith(key)) throw new DOMException("Named publication quota fixture", "QuotaExceededError");
      return window.__namedOriginalSetItem.call(this, name, value);
    };
  }, PREFIX + PUBLICATION);
  await page.locator("#ol-views-status").getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#ol-views-status")).toContainText("Retry Undo");
  await expect(rowNames(page)).toHaveText(["B"]);
  expect(await S.namedStorage(page)).toEqual(deletedStorage);
  expect((await S.namedEntries(page)).map((x) => x.name)).toEqual(["B"]);
  expect(await S.noticeCodes(page)).toContain("storage-failed");
  await page.evaluate(() => { Storage.prototype.setItem = window.__namedOriginalSetItem; });
  await page.locator("#ol-views-status").getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await S.namedEntries(page)).map((x) => x.name)).toEqual(["A", "B"]);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
  expect((await S.namedEntries(page))[0]).toEqual(savedA);
  expect((await S.storage(page)).local["views:v1"]).toBe(rawLegacy);
  await page.reload();
  await fake.idle();
  await S.openViews(page);
  await expect(rowNames(page)).toHaveText(["A", "B"]);
});
