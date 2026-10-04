"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const fixture = require("../fixtures/drawings/collections.json");
test.use({ reducedMotion: "reduce" });
const PREFIX = "market-state-cube-explorer:";
const collectionOf = (payload) => payload.drawings;
const drawingStorage = (page) => page.evaluate((prefix) => ({
  session: Object.fromEntries(Object.keys(sessionStorage).filter((k) => k.startsWith(prefix + "drawings:")).map((k) => [k, sessionStorage.getItem(k)])),
  local: Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith(prefix + "drawings:") || k.startsWith(prefix + "drawing-views:v1:")).map((k) => [k, localStorage.getItem(k)])),
}), PREFIX);

test("tab reload and same-tab history keep drawings; fresh chart links and another tab start empty", async ({ page, context, freshContext, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page), original = await D.row(page, id);
  await page.locator("#ol-canvas").focus(); await page.keyboard.press("7"); await expect.poll(() => new URL(page.url()).hash).toContain("w=7d");
  await page.goBack(); await expect.poll(() => D.row(page, id)).toEqual(original);
  await page.reload(); await D.ready(page); await expect.poll(() => D.row(page, id)).toEqual(original);
  const fresh = await freshContext(), linked = await fresh.newPage(); await linked.goto(page.url()); await D.ready(linked); expect(await D.count(linked)).toBe(0);
  const other = await context.newPage(); await D.open(other, fake); expect(await D.count(other)).toBe(0);
  const b = await D.drawing(other, [.2, .2], [.6, .5]);
  await page.reload(); await D.ready(page); expect((await D.rows(page)).map((r) => r.id)).toEqual([id]);
  await other.reload(); await D.ready(other); expect((await D.rows(other)).map((r) => r.id)).toEqual([b.id]);
});

test("duplicate tab forks before writing and immutable revisions retain both collections", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page), original = await D.row(page, id);
  const waiting = page.context().waitForEvent("page"); await page.evaluate(() => window.open(location.href, "_blank"));
  const duplicate = await waiting; await duplicate.waitForLoadState(); await D.ready(duplicate);
  expect(await D.row(duplicate, id)).toEqual(original);
  const created = await D.drawing(duplicate, [.15, .3], [.45, .4]);
  await page.reload(); await D.ready(page); expect((await D.rows(page)).map((r) => r.id)).toEqual([id]);
  await duplicate.reload(); await D.ready(duplicate); expect((await D.rows(duplicate)).map((r) => r.id)).toEqual([id, created.id]);
  const raw = await drawingStorage(page);
  expect(Object.values(raw.local).join("\n"), "recoverable records retain the duplicate tab's committed object").toContain(created.id);
  expect(Object.values(raw.local).join("\n"), "the source's prior revision remains durable").toContain(id);
});

test("complete code includes hidden/locked objects; invalid input rejects camera and objects atomically", async ({ page, freshContext, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page);
  await D.action(page, id, "lock"); await D.action(page, id, "visible"); const original = await D.row(page, id);
  await D.closeManager(page); const code = await D.copyCode(page), payload = D.decodeCode(code);
  expect(payload.visualVersion).toBe(3);
  expect(collectionOf(payload)).toMatchObject({ schemaVersion: 1, instrument: "binance:spot:BTCUSDT", objects: [{ id, a: original.a, b: original.b, visible: false, locked: true }] });
  const fresh = await freshContext(), restored = await fresh.newPage(); await D.open(restored, fake);
  await D.persistence.importCode(restored, code); await expect.poll(() => D.count(restored)).toBe(1);
  expect(await D.row(restored, id)).toMatchObject(original);
  const before = await D.rows(restored), hash = new URL(restored.url()).hash;
  const bad = structuredClone(payload); bad.drawings = structuredClone(fixture.one); bad.drawings.objects[0].a.timeMs = 1; bad.query.window = "7d";
  await D.persistence.importCode(restored, D.plainCode(bad));
  await expect(restored.locator("#ol-copy-status")).not.toHaveText("View restored");
  expect(await D.rows(restored)).toEqual(before); expect(new URL(restored.url()).hash).toBe(hash);
});

test("opening differing and explicitly empty complete snapshots offers Cancel/Keep/Replace; replacement is undoable", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const first = await D.drawing(page), code = await D.copyCode(page), payload = D.decodeCode(code);
  await page.locator("#ol-drawer-toggle").click();
  const second = await D.drawing(page, [.2, .2], [.6, .5]), before = await D.rows(page);
  await D.persistence.importCode(page, code);
  const dialog = page.locator("#ol-drawing-replace"); await expect(dialog).toBeVisible();
  await dialog.locator('[data-drawing-replace="cancel"]').click(); expect(await D.rows(page)).toEqual(before);
  await D.persistence.importCode(page, code); await dialog.locator('[data-drawing-replace="keep"]').click(); expect(await D.rows(page)).toEqual(before);
  await D.persistence.importCode(page, code); await dialog.locator('[data-drawing-replace="replace"]').click();
  await expect.poll(() => D.count(page)).toBe(1); expect((await D.rows(page)).map((r) => r.id)).toEqual([first.id]);
  expect(Object.values((await drawingStorage(page)).local).join("\n"), "pre-replacement collection has durable recovery").toContain(second.id);
  await page.locator("#ol-drawer-toggle").click(); await D.manager(page);
  await page.locator("#ol-drawing-section").getByRole("button", { name: /^Undo/ }).click(); await expect.poll(() => D.rows(page)).toEqual(before);
  await D.closeManager(page); payload.drawings = fixture.empty;
  await D.persistence.importCode(page, D.plainCode(payload)); await expect(dialog).toBeVisible(); await dialog.locator('[data-drawing-replace="replace"]').click();
  await expect.poll(() => D.count(page)).toBe(0);
});

test("drawing-bearing named View carries full payload and preserves hidden flags without recipient-local lookups", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page); await D.action(page, id, "visible");
  const before = await D.row(page, id); await D.closeManager(page); await D.persistence.openViews(page);
  await page.locator("#ol-view-name").fill("Authored fixture"); await page.locator("#ol-view-form button[type=submit]").click();
  await expect.poll(async () => Object.values((await drawingStorage(page)).local).join("\n")).toContain("Authored fixture");
  const state = await drawingStorage(page), records = Object.entries(state.local).filter(([k]) => k.includes("drawing-views:v1:record:"));
  expect(records.length, "protected immutable named records exist").toBeGreaterThan(0);
  expect(records.some(([, raw]) => raw.includes(id) && raw.includes(String(before.a.timeMs)) && raw.includes('"visible":false')), "complete committed object is in a protected named record").toBe(true);
  await page.keyboard.press("Escape"); await D.action(page, id, "delete"); await D.closeManager(page); await D.persistence.openViews(page);
  await page.locator("#ol-saved .ol-entry").filter({ hasText: "Authored fixture" }).click();
  await expect.poll(() => D.row(page, id)).toMatchObject(before);
});

test("quota failure keeps running objects and prior durable revisions, with complete-code export available", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const first = await D.drawing(page), before = await drawingStorage(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("market-state-cube-explorer:drawings:v1:record:")) throw new DOMException("Drawing quota fixture", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const second = await D.drawing(page, [.1, .2], [.3, .4]);
  expect((await D.rows(page)).map((r) => r.id)).toEqual([first.id, second.id]);
  expect((await drawingStorage(page)).local, "failed write leaves prior immutable records intact").toEqual(before.local);
  await D.manager(page); await expect(page.locator("#ol-drawing-storage-status")).toContainText("Unsaved drawings"); await expect(page.locator("#ol-drawing-storage-status")).toBeVisible(); await D.closeManager(page);
  const payload = D.decodeCode(await D.copyCode(page)); expect(payload.drawings.objects.map((r) => r.id)).toEqual([first.id, second.id]);
});

test("two successive candidate revisions and named payload survive actual preceding-build navigation and saves", async ({ page, fakeFor }) => {
  const fs = require("node:fs"), path = require("node:path"), { materialise } = require("../support/builds.js");
  const preceding = materialise("4900a005b60147d20321ce23c670026566f2c29c", "drawing-rollback");
  const oldHTML = fs.readFileSync(path.join(preceding.dir, "index.html"), "utf8"), fake = await fakeFor("mini");
  // The old document is served at the same origin. Its real view writers mutate the
  // same browser storage as the candidate; protected records are not copied/mocked.
  await page.route("**/rollback.html*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: oldHTML }));
  await D.open(page, fake); const first = await D.drawing(page);
  await D.persistence.openViews(page); await page.locator("#ol-view-name").fill("Protected drawing snapshot"); await page.locator("#ol-view-form button[type=submit]").click();
  // Compression and validation finish asynchronously; wait for the actual sealed
  // protected payload to publish before taking the old-writer preservation snapshot.
  await expect.poll(async () => (await D.persistence.namedEntries(page)).find((entry) => entry.name === "Protected drawing snapshot")?.payload?.drawings?.objects[0]?.id).toBe(first.id);
  const saved = (await D.persistence.namedEntries(page)).find((entry) => entry.name === "Protected drawing snapshot");
  expect(saved.payload).toMatchObject({ visualVersion: 3, id: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/), drawings: { objects: [{ id: first.id }] } });
  await page.keyboard.press("Escape");
  for (let revision = 0; revision < 2; revision++) {
    if (revision) {
      await D.edit(page, first.id); await page.locator("#ol-drawing-name").fill("Second committed revision"); await page.locator("#ol-drawing-color").fill("#00ff00"); await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
    }
    const objects = await D.rows(page), protectedBefore = await drawingStorage(page);
    await page.goto(fake.url + "/rollback.html#w=24h"); await expect(page.locator("#ol-canvas")).toBeVisible();
    await page.keyboard.press("7"); await D.persistence.openViews(page); await page.locator("#ol-view-name").fill("Preceding writer " + revision); await page.locator("#ol-view-form button[type=submit]").click();
    await page.keyboard.press("Escape"); await page.keyboard.press("m");
    expect((await drawingStorage(page)).local, "real old writers preserve every protected drawing/named record").toEqual(protectedBefore.local);
    await D.open(page, fake); await expect.poll(() => D.rows(page)).toEqual(objects);
    await D.persistence.openViews(page); await expect(page.locator("#ol-saved")).toContainText("Protected drawing snapshot"); await page.keyboard.press("Escape");
  }
});
