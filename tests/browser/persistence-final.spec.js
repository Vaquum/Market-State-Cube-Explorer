"use strict";
// B52 persistence-final.spec.js (PRD-0002 S3, #48 section 5): #46's portable-state tests, run again after the final palette and interaction changes, for the cases the
// earlier fresh-context specs (B14, B15) leave to others: an approximate Rows mapping, a replay edge that carries an external comparison override and the model, a
// link opened on a cube whose history has changed, and the temporary states of #47 and #48 that must NOT travel.
//
// Each case copies the view as a link and as a view code from one browser context and opens it in FRESH contexts (storage empty, asserted), with no calibration cache:
//   1. an approximate Rows mapping (the recorded snapshot's coarse rows) comes back with its quality, its row size in the context and its mapping id, and a link and a
//      code agree;
//   2. a view in replay holding a live Comparison lock past the edge comes back in replay, with the same held mapping, the external override and the same model
//      status, from a link and from a code;
//   3. the same link opened on a cube whose history has changed (another seed) keeps the mapping it carries (the same id, the same fit cutoff: nothing is refitted
//      behind the person's back), draws the data it finds and not the data it was made on, and the summary says that original vintages are not recorded;
//   4. Focus, Show all and Inspect, which are temporary, are in neither the address nor the view code: the link and the code are the same with and without them, and a
//      fresh context opened on them has none.
// Oracles (none is the code under test): the page's own record of what it was (the chips' datasets before the copy), the address and code the page writes, the
// browser's storage as a fresh context finds it, and the pixels of the same page under the same data.
const { test, expect, observe, probeTools } = require("./fixtures.js");
const S = require("./rows-support.js");
const P = require("./persistence-support.js");
const H = require("./scale-helpers.js");

const CLIPBOARD = ["clipboard-read", "clipboard-write"];

// What the page says about a channel's mapping, from its chip.
async function reading(surface, channel = "cells") {
  const d = (await surface.chip(channel)).data;
  return { state: d.state, policy: d.policy, mappingId: d.mappingId, context: d.context, fitThrough: d.fitThrough, override: d.override, quality: d.quality ?? null, rowSize: d.rowSize ?? null };
}
async function copyBoth(page) {
  await page.locator("#ol-hist").click();
  await page.locator("#ol-copy-link").click();
  await expect.poll(() => P.clipboardText(page)).toContain("#");
  const link = await P.clipboardText(page);
  await P.openQuery(page);
  await page.locator("#ol-copy-view").click();
  await expect.poll(() => P.clipboardText(page)).toMatch(/^origo-cube:3\./);
  return { link, code: await P.clipboardText(page) };
}
async function openLink(freshContext, link, ready) {
  const other = await freshContext();
  expect((await other.storageState()).origins, "a fresh context: nothing stored").toEqual([]);
  const tab = await other.newPage();
  await tab.goto(link);
  await tab.locator("#ol-canvas").waitFor();
  await ready(tab);
  return { other, tab, surface: observe(tab) };
}

test.describe("B52 portable state after the final changes", () => {
  // The recorded snapshot's coarse rows are an approximation with the row size in their context; a view that pins its rectangle and level restores exactly.
  const RECT = "#t=2021-01-01T00:00Z~2026-09-24T12:02Z&p=75000~88000&r=15,1&rows=volume&period=90d";
  for (const way of ["link", "code"])
    test(`an approximate Rows mapping of a rectangle comes back with its quality, its row size and its id, from a ${way}`, async ({ page, context, fakeFor, probe, surface, freshContext }) => {
      const fake = await fakeFor("recorded");
      await context.grantPermissions(CLIPBOARD, { origin: fake.url });
      await page.goto(`${fake.url}/${RECT}&vis=2&ap=${P.AP}`);
      await S.atRest(page, fake, probe);
      await expect.poll(async () => (await surface.chip("rows")).data.state, { timeout: 60000 }).toBe("ready");
      await probe.waitForQuiet({ quietMs: 700, timeout: 60000 });
      const before = await reading(surface, "rows");
      expect(before.quality, "the coarse rows are a labelled approximation").toMatch(/^approx-rows:[1-9][0-9]*$/);
      expect(before.context, "and the quality is part of the context").toContain(`|${before.quality}|`);
      const { link, code } = await copyBoth(page);
      const settle = async (tab) => {
        const s = observe(tab);
        await expect.poll(async () => (await s.chip("rows")).data.state, { timeout: 60000 }).toBe("ready");
        await tab.waitForTimeout(800);
      };
      let tab, other;
      if (way === "link") ({ tab, other } = await openLink(freshContext, link, settle));
      else {
        other = await freshContext();
        tab = await other.newPage();
        await tab.goto(`${fake.url}/`);
        await tab.locator("#ol-canvas").waitFor();
        await P.importCode(tab, code);
        await expect(tab.locator("#ol-copy-status")).toHaveText("View restored");
        await settle(tab);
      }
      expect(await reading(observe(tab), "rows"), `the ${way} carries the approximate mapping`).toEqual(before);
      await other.close();
    });

  test("a restored window keeps its period Rows scale and names any refitted Cells level", async ({ page, context, fakeFor, probe, surface, freshContext }) => {
    const fake = await fakeFor("recorded");
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    await page.goto(`${fake.url}/#w=all&rows=volume&period=90d&vis=2&ap=${P.AP}`);
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await surface.chip("rows")).data.state, { timeout: 60000 }).toBe("ready");
    await expect.poll(async () => (await surface.chip("cells")).data.state, { timeout: 60000 }).toBe("ready");
    await probe.waitForQuiet({ quietMs: 700, timeout: 60000 });
    const before = await reading(surface, "rows"), cellsBefore = await reading(surface);
    const { code } = await copyBoth(page);
    const other = await freshContext();
    const tab = await other.newPage();
    await tab.goto(`${fake.url}/`);
    await tab.locator("#ol-canvas").waitFor();
    await P.importCode(tab, code);
    await expect(tab.locator("#ol-copy-status")).toHaveText("View restored");
    const s = observe(tab);
    await expect.poll(async () => (await s.chip("rows")).data.state, { timeout: 60000 }).toBe("ready");
    await expect.poll(async () => (await s.chip("cells")).data.state, { timeout: 60000 }).toBe("ready");
    await tab.waitForTimeout(900);
    const after = await reading(s, "rows"), cellsAfter = await reading(s);
    expect(after, "the background's scale belongs to its period, independently of restored canvas prices").toEqual(before);
    // The carried-scale notice compares Cells levels, which may refit with the window's prices.
    const fitted = /n(\d+)m(\d+)$/.exec(cellsBefore.context),
      shows = /n(\d+)m(\d+)$/.exec(cellsAfter.context);
    expect(fitted).toBeTruthy(); expect(shows).toBeTruthy();
    const said = await P.notices(tab);
    if (fitted[1] !== shows[1] || fitted[2] !== shows[2]) {
      expect(cellsAfter.context, "the Cells context is the one this page shows").not.toBe(cellsBefore.context);
      const note = said.find((n) => n.code === "scale-context-differs");
      expect(note, "and the page names why").toBeTruthy();
      expect(note.text).toContain(`fitted at n=${fitted[1]}, m=${fitted[2]}`);
      expect(note.text).toContain(`shows n=${shows[1]}, m=${shows[2]}`);
    } else expect(said.map((n) => n.code), "the same mapping needs no such notice").not.toContain("scale-context-differs");
    await other.close();
  });

  test("a replay edge that holds a live Comparison lock past it comes back in replay with the same mapping, the override and the model's status", async ({ page, context, fakeFor, probe, surface, freshContext }) => {
    const fake = await fakeFor("standard");
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    const ctx = { page, fake, probe, surface };
    await page.goto(`${fake.url}/#w=24h&r=4,0&vis=2&ap=${P.AP}&pane=efficiency`);
    const live = await H.calm(ctx);
    await P.popoverAction(page, surface, "Comparison lock");
    await H.calm(ctx);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("r");
    const before = await H.calm(ctx);
    expect(before.workspace, "in replay").toBe("replay");
    expect(before.override, "holding the live lock past the edge").toBe("external");
    expect(before.mappingId, "the live mapping").toBe(live.mappingId);
    const modelBefore = (await surface.details("cells")).fields,
      paneBefore = (await surface.details("axis")).fields;
    const { link, code } = await copyBoth(page);
    expect(link, "the replay edge is in the address").toMatch(/[#&]replay=1/);
    const settle = async (tab) => {
      const s = observe(tab);
      await expect.poll(async () => (await s.chip("cells")).data.state, { timeout: 60000 }).toBe("ready");
      await tab.waitForTimeout(900);
    };
    const check = async (tab) => {
      const s = observe(tab),
        data = (await s.chip("cells")).data;
      expect(data.workspace, "back in replay").toBe("replay");
      expect(data.mappingId, "the same held mapping").toBe(before.mappingId);
      expect(data.override, "still labelled an external override").toBe("external");
      expect(data.policy).toBe("comparison");
      const fields = (await s.details("cells")).fields;
      expect(fields.modelStatus?.text ?? null, "the model status at the replay cutoff").toBe(modelBefore.modelStatus?.text ?? null);
      expect(fields.override?.text, "the override is a field of the details").toBe(modelBefore.override?.text);
      const axis = (await s.details("axis")).fields;
      expect(axis.modelStatus?.text ?? null).toBe(paneBefore.modelStatus?.text ?? null);
    };
    const viaLink = await openLink(freshContext, link, settle);
    await check(viaLink.tab);
    const third = await freshContext();
    const pasted = await third.newPage();
    await pasted.goto(`${fake.url}/`);
    await pasted.locator("#ol-canvas").waitFor();
    await P.importCode(pasted, code);
    await expect(pasted.locator("#ol-copy-status")).toHaveText("View restored");
    await settle(pasted);
    await check(pasted);
    await viaLink.other.close();
    await third.close();
  });

  test("a link opened on a cube whose history has changed keeps the mapping it carries, draws what it finds, and the summary says original vintages are not recorded", async ({ page, context, fakeFor, probe, surface, freshContext }) => {
    const first = await fakeFor("standard");
    await context.grantPermissions(CLIPBOARD, { origin: first.url });
    const ctx = { page, fake: first, probe, surface };
    await page.goto(`${first.url}/#w=7d&r=7,0&vis=2&ap=${P.AP}&mode=delta`);
    await H.calm(ctx);
    await P.popoverAction(page, surface, "Comparison lock");
    const before = await H.calm(ctx);
    expect(before.policy).toBe("comparison");
    const canvasBefore = await P.canvasHash(page);
    const { link } = await copyBoth(page);
    // the cube's history is not the same one: another seed of the same profile, so the same days hold other trades
    const second = await fakeFor("standard", { seed: 7 });
    const other = await freshContext();
    expect((await other.storageState()).origins).toEqual([]);
    const tab = await other.newPage();
    const target = link.replace(first.url, second.url);
    await tab.goto(target);
    await tab.locator("#ol-canvas").waitFor();
    const s = observe(tab);
    await expect.poll(async () => (await s.chip("cells")).data.state, { timeout: 60000 }).toBe("ready");
    await second.idle({ quietMs: 500 });
    await tab.waitForTimeout(900);
    const after = (await s.chip("cells")).data;
    expect(after.policy, "the lock the link carries").toBe("comparison");
    expect(after.mappingId, "the same mapping: it is a scale, not a snapshot of the data").toBe(before.mappingId);
    expect(after.fitThrough, "its fit cutoff is the source's: nothing was refitted behind the person's back").toBe(before.fitThrough);
    expect(await P.canvasHash(tab), "the page draws the data it finds, not the data the link was made on").not.toBe(canvasBefore);
    // the summary says what is not promised
    await P.openQuery(tab);
    const limits = tab.locator('#ol-summary [data-section="vintage"] [data-field="limit"]');
    await expect(limits).toContainText("original vintages are not recorded");
    await expect(limits).toContainText("No hosted export and no immutable data snapshot");
    await other.close();
  });

  test("Focus, Show all and Inspect are temporary: the link and the code are the same with and without them, and a fresh context opened on them has none", async ({ page, context, fakeFor, probe, surface, freshContext }) => {
    const fake = await fakeFor("standard");
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&ap=${P.AP}&lines=1d,7d,30d`);
    await S.atRest(page, fake, probe);
    await probe.waitForQuiet({ quietMs: 800, timeout: 60000 });
    const plain = await copyBoth(page);
    const storedBefore = await P.storage(page);
    // Focus a line from the Lines menu, then Inspect, then look at what the page would carry
    await page.locator("#ol-lines").click();
    await page.locator('[data-line-focus="7d"]').click();
    await expect(page.locator("#ol-focus-chip")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#ol-canvas").focus();
    await page.keyboard.press("e");
    await expect(page.locator("#ol-inspect")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-inspect")).toBeHidden();
    await page.locator("#ol-lines").click();
    await page.locator('[data-line-focus="30d"]').click();
    await expect(page.locator("#ol-focus-chip")).toBeVisible();
    const marked = await copyBoth(page);
    expect(marked.link, "the link is the same with a Focus on").toBe(plain.link);
    expect(await P.storage(page), "and nothing about it is stored").toEqual(storedBefore);
    // the code carries the same state whether or not a line is in focus: both are DECODED (a code that cannot be is a failure, not a comparison of lengths) and the
    // payloads are the same payload, so the Focus is in neither
    const decode = (code) => page.evaluate(async (text) => {
      const gz = /^origo-cube:3\.([A-Za-z0-9_-]+)$/.exec(text);
      const plainJson = /^origo-cube:3j\.(.*)$/s.exec(text);
      if (plainJson) return JSON.parse(decodeURIComponent(plainJson[1]));
      if (!gz) throw new Error("not a version 3 complete code: " + text.slice(0, 40));
      const bytes = Uint8Array.from(atob(gz[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }, code);
    const a = await decode(plain.code);
    const b = await decode(marked.code);
    expect(a && typeof a === "object" && a.view && typeof a.view === "object", "the plain code decodes to a payload with a view").toBeTruthy();
    expect(b.view.lines, "the same lines").toEqual(a.view.lines);
    expect(Object.keys(b.view).sort(), "the same view keys").toEqual(Object.keys(a.view).sort());
    expect(b, "the whole payload is the same: no Focus, no Inspect cursor, no temporary state").toEqual(a);
    const opened = await openLink(freshContext, marked.link, async (tab) => {
      await probeTools.forPage(tab).waitForReady({ timeout: 60000 });
    });
    await expect(opened.tab.locator("#ol-focus-chip"), "a fresh context has no Focus").toBeHidden();
    await expect(opened.tab.locator("#ol-inspect")).toBeHidden();
    await opened.other.close();
  });
});
