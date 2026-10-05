"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const fixture = require("../fixtures/drawings/collections.json");
test.use({ reducedMotion: "reduce" });
const PREFIX = "market-state-cube-explorer:";
const revision = (page) => page.locator("#ol-canvas").getAttribute("data-drawing-revision").then(Number);

// Read the complete active tab session and its matching recovery independently
// of the storage API. Import may preserve recovery; active authority must not move.
const durable = (page) => page.evaluate((prefix) => {
  const session = sessionStorage.getItem(prefix + "drawings:v1:session");
  const pointer = session && JSON.parse(session);
  return { session, record: pointer && localStorage.getItem(prefix + "drawings:v1:record:" + pointer.id) };
}, PREFIX);
async function payload(page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText(""));
  return D.decodeCode(await D.copyCode(page));
}
const chart = (value) => ({ query: value.query, view: value.view, appearance: value.appearance, scales: value.scales, axes: value.axes });
async function closeDrawer(page) {
  if (await page.locator("#ol-drawer").getAttribute("data-open") === "true") await page.locator("#ol-drawer-toggle").click();
}
async function editName(page, id, name, color = "#00ff00") {
  await D.edit(page, id);
  await page.locator("#ol-drawing-name").fill(name);
  await page.locator("#ol-drawing-color").fill(color);
  await page.locator("#ol-drawing-apply").click();
}
async function armApplyFailure(page) {
  // Inject one browser-property failure in the real applyView path, after its
  // camera/settings assignments. No production test hook or codec stub is used.
  await page.evaluate(() => {
    const tip = document.getElementById("ol-tip"), native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
    window.__reviewApplyFailures = 0;
    let armed = true;
    Object.defineProperty(tip, "hidden", {
      configurable: true,
      get() { return native.get.call(tip); },
      set(value) {
        if (armed && new Error().stack.includes("applyView")) {
          armed = false; window.__reviewApplyFailures++;
          throw new Error("Review fixture: chart apply failed");
        }
        native.set.call(tip, value);
      },
    });
  });
}

for (const route of ["button", "keyboard"]) test(`clean exact editor ${route} Undo restores one committed edit and Redo`, async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const { id } = await D.drawing(page), original = await D.row(page, id);
  await editName(page, id, "Committed edit"); const edited = await D.row(page, id), beforeRevision = await revision(page);
  await D.edit(page, id);
  await expect(page.locator("#ol-drawing-editor-undo")).toBeEnabled();
  if (route === "button") await page.locator("#ol-drawing-editor-undo").click();
  else { await page.locator("#ol-drawing-editor-undo").focus(); await page.keyboard.press("ControlOrMeta+z"); }
  await expect(page.locator("#ol-drawing-editor")).toBeHidden();
  expect(await D.row(page, id)).toEqual(original); expect(await revision(page)).toBe(beforeRevision + 1);
  expect(JSON.parse((await durable(page)).session).collection.objects[0]).toMatchObject({ name: original.name, color: original.color });
  await D.manager(page); await page.locator("#ol-drawing-redo").click();
  expect(await D.row(page, id)).toEqual(edited); expect(await revision(page)).toBe(beforeRevision + 2);
});

test("dirty, invalid and new exact drafts cancel before committed Undo", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const { id } = await D.drawing(page); await editName(page, id, "Committed edit");
  const edited = await D.rows(page), beforeRevision = await revision(page), beforeDurable = await durable(page);
  for (const draft of ["dirty", "invalid", "new"]) {
    if (draft === "new") { await D.manager(page); await page.locator("#ol-drawing-new-exact").click(); }
    else await D.edit(page, id);
    if (draft === "dirty") await page.locator("#ol-drawing-name").fill("Unapplied draft");
    if (draft === "invalid") await page.locator("#ol-drawing-a-time").fill("invalid UTC draft");
    await expect(page.locator("#ol-drawing-editor-undo")).toHaveText("Cancel draft");
    await page.locator("#ol-drawing-editor-undo").click();
    await expect(page.locator("#ol-drawing-editor")).toBeHidden();
    expect(await D.rows(page)).toEqual(edited); expect(await revision(page)).toBe(beforeRevision);
    expect(await durable(page)).toEqual(beforeDurable);
  }
  await D.manager(page); await page.locator("#ol-drawing-undo").click();
  expect((await D.rows(page))[0].name).not.toBe("Committed edit");
  expect(await revision(page)).toBe(beforeRevision + 1);
});

for (const route of ["pasted code", "named View"]) test(`failed ${route} application preserves chart, drawings, durable revision and history`, async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const { id } = await D.drawing(page);
  let incoming;
  if (route === "named View") {
    // Save a genuine complete View before changing the live chart and drawings.
    await D.persistence.openViews(page); await page.locator("#ol-view-name").fill("Rejected application fixture");
    await page.locator("#ol-view-form button[type=submit]").click();
    await expect.poll(async () => (await D.persistence.namedEntries(page)).find((entry) => entry.name === "Rejected application fixture")?.payload?.drawings?.objects[0]?.id).toBe(id);
    await page.keyboard.press("Escape"); await D.drawing(page, [.125, .25], [.5, .625]);
    await page.locator("#ol-canvas").focus(); await page.keyboard.press("7");
    await expect.poll(() => new URL(page.url()).hash).toContain("w=7d");
  } else {
    incoming = await payload(page);
    incoming.drawings = structuredClone(fixture.one);
    incoming.view.viewport = incoming.view.viewport.map((n, i) => n + (i < 2 ? -16 : 1));
    incoming.query.t1 -= 16; incoming.query.t2 -= 16; incoming.query.p1 += 1; incoming.query.p2 += 1;
    incoming.view.mode = "delta"; incoming.view.scale.basis = "intensity";
    await closeDrawer(page);
  }
  await fake.idle();
  const beforeRows = await D.rows(page), beforeRevision = await revision(page), beforeDurable = await durable(page), beforeChart = chart(await payload(page));
  const beforeHash = new URL(page.url()).hash; await closeDrawer(page);
  if (route === "pasted code") await D.persistence.importCode(page, D.plainCode(incoming));
  else { await D.persistence.openViews(page); await page.locator("#ol-saved .ol-entry").filter({ hasText: "Rejected application fixture" }).click(); }
  const dialog = page.locator("#ol-drawing-replace"); await expect(dialog).toBeVisible();
  await armApplyFailure(page); await dialog.locator('[data-drawing-replace="replace"]').click();
  await expect.poll(() => page.evaluate(() => window.__reviewApplyFailures)).toBe(1);
  await expect(dialog).toBeHidden();
  await expect(page.locator(route === "pasted code" ? "#ol-copy-status" : '#ol-notice [data-code="import-rejected"]:not([hidden])')).toContainText("Review fixture: chart apply failed");
  expect(await D.rows(page)).toEqual(beforeRows); expect(await revision(page)).toBe(beforeRevision);
  expect(await durable(page)).toEqual(beforeDurable); expect(new URL(page.url()).hash).toBe(beforeHash);
  expect(chart(await payload(page)), "the full chart payload must roll back after assignments already ran").toEqual(beforeChart);
  await closeDrawer(page); await D.manager(page); await page.locator("#ol-drawing-undo").click();
  expect(await D.count(page)).toBe(beforeRows.length - 1);
  await page.locator("#ol-drawing-redo").click(); expect(await D.rows(page)).toEqual(beforeRows);
  await page.reload(); await D.ready(page); expect(await D.rows(page)).toEqual(beforeRows);
});


test("dismissed drawing quota failure retries cleanly and the next failure announces itself", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__reviewDrawingQuota = true;
    Storage.prototype.setItem = function (key, value) {
      if (window.__reviewDrawingQuota && key.startsWith("market-state-cube-explorer:drawings:v1:record:")) throw new DOMException("Review drawing quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await editName(page, id, "Unsaved edit"); await D.manager(page);
  await expect(page.locator("#ol-drawing-storage-status")).toContainText("Unsaved drawings");
  await expect(page.locator("#ol-drawing-retry")).toBeVisible();
  const notice = page.locator('#ol-notice [data-code="storage-failed"]:not([hidden])');
  await expect(notice).toContainText("Unsaved drawings"); const oldId = await notice.getAttribute("data-notice");
  await page.locator("#ol-notice-dismiss").evaluate((button) => button.click());
  await expect(notice).toHaveCount(0);
  await page.evaluate(() => { window.__reviewDrawingQuota = false; });
  await page.locator("#ol-drawing-retry").click();
  await expect(page.locator("#ol-drawing-storage-status")).toHaveText("");
  await expect(page.locator("#ol-drawing-retry")).toBeHidden();
  expect(JSON.parse((await durable(page)).session).collection.objects[0].name).toBe("Unsaved edit");
  await page.evaluate(() => { window.__reviewDrawingQuota = true; });
  await editName(page, id, "Another unsaved edit", "#0000ff"); await D.manager(page);
  await expect(page.locator("#ol-drawing-storage-status")).toContainText("Unsaved drawings");
  await expect(page.locator("#ol-drawing-retry")).toBeVisible();
  await expect(notice).toContainText("Unsaved drawings");
  expect(await notice.getAttribute("data-notice")).not.toBe(oldId);
  expect(JSON.parse((await durable(page)).session).collection.objects[0].name).toBe("Unsaved edit");
});


for (const neighbor of [false, true]) test(`clean editor Undo removing a creation restores ${neighbor ? "neighbor" : "New"} focus`, async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const first = await D.drawing(page), removed = neighbor ? await D.drawing(page, [.125, .25], [.5, .625]) : first;
  await D.edit(page, removed.id); await page.locator("#ol-drawing-editor-undo").click();
  await expect(page.locator("#ol-drawing-editor")).toBeHidden();
  expect(await D.count(page)).toBe(neighbor ? 1 : 0);
  await expect(page.locator(neighbor ? `[data-drawing-row="${first.id}"] [data-drawing-action="edit"]` : "#ol-drawing-new")).toBeFocused();
  await page.locator("#ol-drawing-redo").click(); expect(await D.row(page, removed.id)).toBeDefined();
});

test("untouched duplicate retains its complete session after source recovery history is pruned", async ({ page, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake);
  const { id } = await D.drawing(page), original = await D.row(page, id);
  const inherited = JSON.parse((await durable(page)).session);
  expect(inherited.storageVersion).toBe(2); expect(inherited.collection.objects[0].id).toBe(id);
  const waiting = page.context().waitForEvent("page"); await page.evaluate(() => window.open(location.href, "_blank"));
  const duplicate = await waiting; await duplicate.waitForLoadState(); await D.ready(duplicate);
  expect(await D.row(duplicate, id)).toEqual(original);
  // Exceed the actual rolling recovery capacity. The duplicate makes no save;
  // its own complete session, rather than an inherited local pointer, must survive.
  for (let i = 0; i < 26; i++) await editName(page, id, "Source revision " + i);
  expect(await page.evaluate((key) => localStorage.getItem(key), PREFIX + "drawings:v1:record:" + inherited.id)).toBeNull();
  const current = await D.row(page, id);
  await duplicate.reload(); await D.ready(duplicate); expect(await D.row(duplicate, id)).toEqual(original);
  await page.reload(); await D.ready(page); expect(await D.row(page, id)).toEqual(current);
  await editName(duplicate, id, "Duplicate independent edit", "#0000ff");
  await page.reload(); await D.ready(page); expect(await D.row(page, id)).toEqual(current);
});

test("concurrent complete named saves in two tabs retain both acknowledged snapshots", async ({ page, context, fakeFor }) => {
  const fake = await fakeFor("mini"); await D.open(page, fake); const first = await D.drawing(page);
  const other = await context.newPage(); await D.open(other, fake); const second = await D.drawing(other, [.125, .25], [.5, .625]);
  await D.persistence.openViews(page); await D.persistence.openViews(other);
  await page.locator("#ol-view-name").fill("Concurrent A"); await other.locator("#ol-view-name").fill("Concurrent B");
  await Promise.all([page.locator("#ol-view-form button[type=submit]").click(), other.locator("#ol-view-form button[type=submit]").click()]);
  await expect(page.locator("#ol-views-status")).toContainText("Saved “Concurrent A”");
  await expect(other.locator("#ol-views-status")).toContainText("Saved “Concurrent B”");
  for (const tab of [page, other]) {
    await tab.reload(); await D.ready(tab);
    const entries = await D.persistence.namedEntries(tab);
    expect(entries.map((entry) => entry.name).sort()).toEqual(["Concurrent A", "Concurrent B"]);
    expect(entries.find((entry) => entry.name === "Concurrent A").payload.drawings.objects.map((object) => object.id)).toEqual([first.id]);
    expect(entries.find((entry) => entry.name === "Concurrent B").payload.drawings.objects.map((object) => object.id)).toEqual([second.id]);
    expect(entries.every((entry) => /^[A-Za-z0-9_-]{16}$/.test(entry.payload.id))).toBe(true);
  }
});
