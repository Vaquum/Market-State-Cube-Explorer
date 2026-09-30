"use strict";
// persistence-fresh.spec.js (package P): B14, fresh-browser round trips and migration (TESTPLAN 3.4; API B.15, C.13; INTEGRATION D.9,
// D.14 items 8 and 9; issue #46 Acc.6). Requirement ids: S1-077..080 (exact restoration), S1-119 (each tab keeps its own active
// snapshot), S1-163..165 (version 2 everywhere, classification, migration), S1-168 and S1-170 (a view code is self-contained; a
// scale is not a market-data snapshot), S1-172 (Back and Forward).
//
// What is asserted, on the page of the working tree against a `mini` fake cube (the persistence paths do not need `standard`'s
// volume; the fake's cutoff never enters an address):
//   * the default-only address is #w=24h&vis=2&ap=<id>, and every address the page writes carries vis=2 and ap=;
//   * a customised view (Path, Intensity, Comparison lock, Rows) copied as a link and as a view code restores its address byte for
//     byte in a FRESH context (storage empty, asserted), with no workspace cache: the active mappings, a frozen axis and the
//     appearance id come back exactly, and a rank mapping with repeated values in its cohort comes back bit for bit (same id);
//   * the bare-root rule: a stored version-2 view restores silently, a stored legacy view restores with the legacy notice, nothing
//     stored gives the default view and one neutral notice, once per browser; a link restores the preferences and skips the stored
//     view (no notice for it either);
//   * two tabs of one browser keep their own active snapshot (no `storage` event following); the browser-wide cache is read once;
//   * a legacy link and a legacy named view migrate with one notice per payload and tab, and the stored named view is not rewritten
//     until the person saves it again; Back and Forward: a place change is an entry, a setting change is not;
//   * cv=l and sw= round-trip; an unknown or different appearance is refused with a notice and the default stays; a live advance
//     leaves the address, history.length and history.state of a view with an Auto mapping untouched (DD-92).
//
// What these assertions read are the observation surface of INTEGRATION D.18 (the notice banner, #ol-copy-status) and the address
// bar; every expected address is written from the grammar of B.15 by persistence-support.js.
//
// Not covered here: the mappings the page FITS (packages S, C, R: a fit's id after a fresh context needs a fit to exist), the pixels
// of a restored mapping (package C), and the popover and menu controls that change the scale (package U). The descriptors these
// tests restore are made in the test and carried by an address or a code, which is exactly what a second browser receives.
const { test, expect } = require("./fixtures.js");
const S = require("./persistence-support.js");

const STORE = "market-state-cube-explorer:";
const CLIPBOARD = ["clipboard-read", "clipboard-write"];

// Seed the storage of a context BEFORE the first page runs, once per browser context.
async function seed(context, entries) {
  await context.addInitScript(
    ({ entries, prefix }) => {
      // a blank page (about:blank before the first navigation) has no storage to seed: that is not an error
      try {
        // once per BROWSER: a second tab, or a reload, must find what the first page left, not the seed again
        if (localStorage.getItem("__seeded")) return;
        localStorage.setItem("__seeded", "1");
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(prefix + key, typeof value === "string" ? value : JSON.stringify(value));
      } catch {
        // nothing to seed here
      }
    },
    { entries, prefix: STORE },
  );
}

const V2_VIEW = "#w=7d&vis=2&ap=" + S.AP + "&mode=delta";
const LEGACY_VIEW = "#w=7d&mode=flow&rows=relvol&pane=volume";
const LEGACY_V5 = { version: 5, prefs: {}, view: LEGACY_VIEW };

test.describe("B14 persistence: fresh browser, round trips and migration", () => {
  test("the default-only address is #w=24h&vis=2&ap=<id>, and a fresh browser has no workspace cache", async ({ page, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/");
    await fake.idle();
    expect((await S.where(page)).hash).toBe("#w=24h&vis=2&ap=" + S.AP);
    const stored = await S.storage(page);
    expect(Object.keys(stored.local)).not.toContain("scales:v1");
    // a setting changes the address and keeps the two fixed parameters in their place
    await page.keyboard.press("m");
    await expect.poll(async () => (await S.where(page)).hash).toMatch(/^#w=24h&vis=2&ap=slate2-8f7890f7&mode=/);
    // one neutral version notice for a browser with nothing stored (no other)
    expect(await S.noticeCodes(surface)).toEqual(["version-default"]);
  });

  test("a customised view (Path, Intensity, Comparison lock, Rows), copied as a link and as a code, restores byte for byte in a fresh context", async ({ page, context, fakeFor, freshContext, surface }) => {
    const fake = await fakeFor("mini");
    const axes = [{ id: "pane.volume", domain: [0, 1920000000], policy: "frozen", through: 1790251320000 }];
    const scales = [S.valueRecord("path", 4, 0, 730.25, 41.5, { policy: "k", origin: "manual" })];
    // a path context is bases spans/usdt/perMinute: the record's context must say the page's basis, so it is written for usdt
    scales[0].ctx = S.E.context.cellsKey({ measure: "path", basis: "usdt", pathBasis: "usdt", transform: "value", curve: "log", n: 4, m: 0 });
    const made = S.address({ mode: "path", rows: "volume", pane: "volume", scale: { basis: "intensity", pathBasis: "usdt", lock: true, cells: "auto" } }, scales, axes);
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    await page.goto(fake.url + "/" + made.hash);
    await fake.idle();
    // the page adopted what the link carried and writes it back the same
    const opened = (await S.where(page)).hash;
    expect(opened).toBe(made.hash);
    expect(S.param(opened, "lk")).toBe("1");
    expect(S.scOf(opened)).toContain("a.pane.volume:x:d0,1920000000");
    // copy the link: the clipboard holds the address the page wrote
    await page.locator("#ol-hist").click();
    await page.locator("#ol-copy-link").click();
    await expect.poll(() => S.clipboardText(page)).toContain(made.hash);
    const link = await S.clipboardText(page);
    // a fresh context (storage empty) opens the link: the same address, no scales:v1 written, no notice about a scale
    const other = await freshContext();
    const tab = await other.newPage();
    expect((await other.storageState()).origins).toEqual([]);
    await tab.goto(link);
    await tab.locator("#ol-canvas").waitFor();
    await expect.poll(async () => (await S.where(tab)).hash).toBe(made.hash);
    const again = await S.storage(tab);
    expect(Object.keys(again.local)).not.toContain("scales:v1");
    expect(await S.noticeCodes(require("./observe.js").observe(tab))).not.toContain("scale-dropped");
    // the view code: copied here, pasted there, gives the same view and the same address
    await S.openQuery(page);
    await page.locator("#ol-copy-view").click();
    await expect.poll(() => S.clipboardText(page)).toMatch(/^origo-cube:2\./);
    const code = await S.clipboardText(page);
    const third = await freshContext();
    const pasted = await third.newPage();
    await pasted.goto(fake.url + "/");
    await pasted.locator("#ol-canvas").waitFor();
    await S.importCode(pasted, code);
    await expect(pasted.locator("#ol-copy-status")).toHaveText("View restored");
    const restored = (await S.where(pasted)).hash;
    expect(S.param(restored, "mode")).toBe("path");
    expect(S.param(restored, "lk")).toBe("1");
    expect(S.param(restored, "bs")).toBe("i");
    expect(S.scOf(restored)).toBe(S.scOf(made.hash));
    expect(S.param(restored, "ap")).toBe(S.AP);
    void surface;
  });

  test("a rank mapping with repeated values in its cohort comes back bit for bit: the same id in the address of a fresh context", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    const rank = S.rankRecord("volume", 4, 0, S.DUPLICATE_VALUES);
    // the knots contain runs of equal values (the case a rounding restore would break)
    const knots = rank.desc.params.knots;
    expect(new Set(knots).size).toBeLessThan(knots.length / 4);
    const made = S.address({ scale: { transform: "rank" } }, [rank]);
    expect(made.level).toBe(0);
    await page.goto(fake.url + "/" + made.hash);
    await fake.idle();
    await expect.poll(async () => (await S.where(page)).hash).toBe(made.hash);
    // the mapping id in the record is the id of the descriptor in the address, recomputed here from the knots (a consistency check)
    expect(S.scOf(made.hash).endsWith(":" + S.E.scale.id(rank.desc))).toBe(true);
    expect(S.E.scale.id(rank.desc)).toBe(rank.desc.id);
  });

  test("cv=l and sw= round-trip in a fresh context", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    const made = S.address({ mode: "flow", scale: { curve: "linear", window: [0.4, 0.6] } });
    expect(made.hash).toContain("&cv=l");
    expect(made.hash).toContain("&sw=0.4~0.6");
    await page.goto(fake.url + "/" + made.hash);
    await fake.idle();
    await expect.poll(async () => (await S.where(page)).hash).toBe(made.hash);
  });

  test("the bare root: a stored version-2 view restores silently", async ({ page, context, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    await seed(context, { "view:v5": { version: 5, visualVersion: 2, prefs: {}, view: V2_VIEW } });
    await page.goto(fake.url + "/");
    await fake.idle();
    expect((await S.where(page)).hash).toBe(V2_VIEW);
    expect(await S.noticeCodes(surface)).toEqual([]);
  });

  test("the bare root: a stored legacy view restores with the legacy notice, once", async ({ page, context, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    await seed(context, { "view:v5": LEGACY_V5 });
    await page.goto(fake.url + "/");
    await fake.idle();
    // the view is the legacy one, now written as version 2
    const hash = (await S.where(page)).hash;
    expect(hash).toMatch(/^#w=7d&vis=2&ap=slate2-8f7890f7&mode=flow&pane=volume&rows=relvol$/);
    const list = await S.notices(surface);
    expect(list.map((n) => n.code)).toEqual(["legacy-migrated"]);
    // the notice lists every setting whose meaning changed: mode, Rows and the pane (the words come from the module's migrate table)
    for (const setting of ["mode=flow", "rows=relvol", "pane=volume"]) expect(list[0].text).toContain(setting);
    // the next open of this browser sees a version-2 view: no notice
    const again = await page.context().newPage();
    await again.goto(fake.url + "/");
    await again.locator("#ol-canvas").waitFor();
    expect(await S.noticeCodes(require("./observe.js").observe(again))).toEqual([]);
  });

  test("the bare root: nothing stored gives the default view and one neutral notice, once per browser", async ({ page, context, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/");
    await fake.idle();
    expect((await S.where(page)).hash).toBe("#w=24h&vis=2&ap=" + S.AP);
    const list = await S.notices(surface);
    expect(list.map((n) => n.code)).toEqual(["version-default"]);
    expect(list[0].count).toBe(1);
    // a second tab of the same browser: the flag is stored, no second notice
    const tab = await context.newPage();
    await tab.goto(fake.url + "/");
    await tab.locator("#ol-canvas").waitFor();
    expect(await S.noticeCodes(require("./observe.js").observe(tab))).toEqual([]);
  });

  test("a link at startup restores the preferences and skips the stored view, with no notice for it", async ({ page, context, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    await seed(context, { "view:v5": { ...LEGACY_V5, prefs: { drawer: "cells", drawerOpen: true } } });
    await page.goto(fake.url + "/#w=30d&vis=2&ap=" + S.AP);
    await fake.idle();
    expect((await S.where(page)).hash).toBe("#w=30d&vis=2&ap=" + S.AP);
    // the preference (the open drawer) came back; the stored legacy view was neither applied nor reported
    await expect(page.locator("#ol-drawer")).toHaveAttribute("data-open", "true");
    expect(await S.noticeCodes(surface)).toEqual([]);
  });

  test("two tabs of one browser keep their own active snapshot; the cache is read once and a storage event changes nothing", async ({ context, fakeFor }) => {
    const fake = await fakeFor("mini");
    const cached = S.valueRecord("volume", 4, 0, 1204551.25, 8830.5);
    const key = S.E.context.keyString(cached.ctx);
    const cache = { visualVersion: 2, contexts: [{ key, ctx: cached.ctx, records: [{ v: 1, key, ctx: cached.ctx, desc: cached.desc, policy: "explore", origin: "fit", workspace: "live", cohort: { kind: "cells", n: 9312, zeros: 0, nonzero: 9312 }, obsEndMs: cached.obsEndMs }] }] };
    await seed(context, { "scales:v1": cache });
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto(fake.url + "/#w=24h&vis=2&ap=" + S.AP + "&r=4,0");
    await b.goto(fake.url + "/#w=24h&vis=2&ap=" + S.AP + "&r=4,0");
    await a.locator("#ol-canvas").waitFor();
    await b.locator("#ol-canvas").waitFor();
    // the cache was read at load into each tab's live store: a settings change writes the address, and it now carries the cached mapping
    await a.keyboard.press("i");
    await expect.poll(async () => (await S.where(a)).hash).toContain("sc=");
    const back = (await S.where(a)).hash;
    expect(back).toContain("sc=c:e:g1204551.25,8830.5:volume.a.4.0.l.e:");
    // another tab writes a different cache and a `storage` event reaches this one: its active snapshot does not move
    const before = (await S.where(b)).hash;
    await a.evaluate((prefix) => localStorage.setItem(prefix + "scales:v1", JSON.stringify({ visualVersion: 2, contexts: [] })), STORE);
    await b.waitForTimeout(300);
    expect((await S.where(b)).hash).toBe(before);
    // and tab A's own change did not touch tab B's view (B still shows the volume view it opened with)
    expect(S.param(before, "mode")).toBeNull();
  });

  test("a legacy link migrates with one notice per payload and tab; the address becomes version 2", async ({ page, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/" + "#w=24h&mode=flow&rows=relvol&pane=volume");
    await fake.idle();
    expect((await S.where(page)).hash).toBe("#w=24h&vis=2&ap=" + S.AP + "&mode=flow&pane=volume&rows=relvol");
    const first = await S.notices(surface);
    expect(first.filter((n) => n.code === "legacy-migrated")).toHaveLength(1);
    // the same payload again in this tab (an address typed into the bar) is not reported again
    await page.evaluate(() => {
      location.hash = "#w=24h&mode=flow&rows=relvol&pane=volume";
    });
    await expect.poll(async () => (await S.where(page)).hash).toBe("#w=24h&vis=2&ap=" + S.AP + "&mode=flow&pane=volume&rows=relvol");
    const second = (await S.notices(surface)).filter((n) => n.code === "legacy-migrated");
    expect(second).toHaveLength(1);
    expect(second[0].count).toBe(1);
  });

  test("a legacy named view opens migrated and is not rewritten until it is saved again", async ({ page, context, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    const entry = { name: "Old flow", live: false, span: 10, lead: 0, auto: true, mode: "flow", pane: "cells", rows: "off", period: "90d", hash: "#w=7d&mode=flow", tA: 1, tB: 2, cut: 3, n: 6, m: 0, window: "7d", replay: false };
    await seed(context, { "views:v1": [entry] });
    await page.goto(fake.url + "/#w=24h&vis=2&ap=" + S.AP);
    await fake.idle();
    const raw = (await S.storage(page)).local["views:v1"];
    await S.openViews(page);
    // the row says it was saved before version 2
    await expect(page.locator("#ol-saved")).toContainText("saved before visual version 2");
    await page.locator("#ol-saved .ol-entry").first().click();
    await expect.poll(async () => (await S.where(page)).hash).toContain("mode=flow");
    expect((await S.noticeCodes(surface)).filter((c) => c === "legacy-migrated")).toHaveLength(1);
    // the stored entry is exactly what it was
    expect((await S.storage(page)).local["views:v1"]).toBe(raw);
    // saving it again stamps version 2
    await S.openViews(page);
    await page.locator("#ol-view-name").fill("Old flow");
    await page.locator("#ol-view-form button[type=submit], #ol-view-form .ol-solid").first().click();
    await expect.poll(async () => JSON.parse((await S.storage(page)).local["views:v1"])[0].visualVersion).toBe(2);
  });

  test("Back and Forward: a place change is an entry, a setting change is not", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/#w=24h&vis=2&ap=" + S.AP);
    await fake.idle();
    const start = (await S.where(page)).length;
    await page.keyboard.press("m");
    await expect.poll(async () => (await S.where(page)).hash).toContain("mode=");
    expect((await S.where(page)).length).toBe(start);
    await page.keyboard.press("7");
    await expect.poll(async () => (await S.where(page)).hash).toContain("w=7d");
    expect((await S.where(page)).length).toBe(start + 1);
    // Back returns to the place and leaves how it is shown alone
    await page.goBack();
    await expect.poll(async () => (await S.where(page)).hash).toContain("w=24h");
    expect(S.param((await S.where(page)).hash, "mode")).not.toBeNull();
  });

  test("an appearance the page does not build keeps the default and says so", async ({ page, fakeFor, surface }) => {
    const fake = await fakeFor("mini");
    for (const ap of ["nosuch9-12345678", "slate2-00000000"]) {
      const tab = await page.context().newPage();
      await tab.goto(fake.url + "/#w=24h&vis=2&ap=" + ap);
      await tab.locator("#ol-canvas").waitFor();
      await expect.poll(async () => (await S.where(tab)).hash).toBe("#w=24h&vis=2&ap=" + S.AP);
      expect(await S.noticeCodes(require("./observe.js").observe(tab))).toContain("appearance-mismatch");
      await tab.close();
    }
    void surface;
  });

  test("a live advance leaves the address, history.length and history.state of a view with a mapping untouched (DD-92)", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    const made = S.address({ auto: false, n: 4, m: 0 }, [S.valueRecord("volume", 4, 0, 1204551.25, 8830.5)]);
    await page.goto(fake.url + "/" + made.hash);
    await fake.idle();
    const before = await S.where(page);
    expect(before.hash).toBe(made.hash);
    fake.advance({ minutes: 3 });
    await expect.poll(() => fake.log().some((r) => r.answer === "delta" || r.answer === "pack"), { timeout: 15000 }).toBe(true);
    await fake.idle();
    const after = await S.where(page);
    expect(after.hash).toBe(before.hash);
    expect(after.length).toBe(before.length);
    expect(after.state).toBe(before.state);
  });
});
