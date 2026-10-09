"use strict";
// persistence-fresh.spec.js (package P): B14, fresh-browser round trips and migration (TESTPLAN 3.4; API B.15, C.13; INTEGRATION D.9,
// D.14 items 8 and 9; issue #46 Acc.6). Requirement ids: S1-077..080 (exact restoration), S1-119 (each tab keeps its own active
// snapshot), S1-163..165 (versioned storage, classification, migration), S1-168 and S1-170 (a view code is self-contained; a
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
//     when re-saved as a protected complete v3 snapshot; Back and Forward: a place change is an entry, a setting change is not;
//   * cv=l and sw= round-trip; an unknown or different appearance is refused with a notice and the default stays; a live advance
//     leaves the address, history.length and history.state of a view with an Auto mapping untouched (DD-92).
//
// What these assertions read are the observation surface of INTEGRATION D.18 (the notice banner, #ol-copy-status) and the address
// bar; every expected address is written from the grammar of B.15 by persistence-support.js.
//
// Not covered here: the mappings the page FITS (packages S, C, R: a fit's id after a fresh context needs a fit to exist), the pixels
// of a restored mapping (package C), and the popover and menu controls that change the scale (package U). The descriptors these
// tests restore are made in the test and carried by an address or a code, which is exactly what a second browser receives.
const { test, expect, observe } = require("./fixtures.js");
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
  // The fake cube is closed by a fixture that is torn down before the page is: a live page polling the pack in that gap logs a failed
  // fetch, which is the harness's teardown order and no behaviour of the page. The pages are closed first.
  test.afterEach(async ({ context }) => {
    await Promise.all(context.pages().map((p) => p.close().catch(() => {})));
  });

  test("the default-only address is #w=24h&vis=2&ap=<id>, and a fresh browser has no workspace cache", async ({ page, fakeFor }) => {
    // what the browser held when the first script ran: nothing
    await page.context().addInitScript(() => {
      try {
        window.__keysAtStart = Object.keys(localStorage);
      } catch {
        window.__keysAtStart = null;
      }
    });
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/");
    await fake.idle();
    expect(await page.evaluate(() => window.__keysAtStart)).toEqual([]);
    // the settings part of the address is the default-only form ...
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP);
    // ... and once the Explore mapping is fitted it is in the address too (a fresh context restores it from the address alone)
    await expect.poll(async () => S.scOf((await S.where(page)).hash), { timeout: 10000 }).toMatch(/^c:e:/);
    // the workspace cache is written after the commit (debounced), holding the mapping of the live workspace
    await expect.poll(async () => (await S.storage(page)).local["scales:v1"], { timeout: 10000 }).toContain("contexts");
    // a setting changes the address and keeps the two fixed parameters in their place
    await page.keyboard.press("m");
    await expect.poll(async () => (await S.where(page)).hash).toMatch(/^#w=24h&vis=2&ap=slate2-8f7890f7&mode=/);
    // a browser with nothing stored is new: nothing changed for it, so no notice
    expect(await S.noticeCodes(page)).toEqual([]);
  });

  test("a customised view (Path, Intensity, Comparison lock, Rows), copied as a link and as a code, restores byte for byte in a fresh context", async ({ page, context, fakeFor, freshContext }) => {
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
    // Rows is on, so the page fits its Rows mapping once the view has settled, and that active mapping travels in the address
    // beside the ones the link carried (an Explore record: r:e:...)
    await expect.poll(async () => S.scOf((await S.where(page)).hash), { message: "the Rows mapping joins the address" }).toContain(";r:e:");
    const settled = (await S.where(page)).hash;
    expect(settled.startsWith(made.hash.split("&sc=")[0]), "the settings did not change").toBe(true);
    expect(S.scOf(settled)).toContain(S.scOf(made.hash).split(";")[0]);
    // copy the link: the clipboard holds the address the page wrote
    await page.locator("#ol-hist").click();
    await page.locator("#ol-copy-link").click();
    await expect.poll(() => S.clipboardText(page)).toContain(settled);
    const link = await S.clipboardText(page);
    // a fresh context (storage empty) opens the link: the same address, no scales:v1 written, no notice about a scale
    const other = await freshContext();
    const tab = await other.newPage();
    expect((await other.storageState()).origins).toEqual([]);
    await tab.goto(link);
    await tab.locator("#ol-canvas").waitFor();
    await expect.poll(async () => (await S.where(tab)).hash).toBe(settled);
    expect(await S.noticeCodes(tab)).not.toContain("scale-dropped");
    // the view code: copied here, pasted there, gives the same view and the same address
    await S.openQuery(page);
    await page.locator("#ol-copy-view").click();
    await expect.poll(() => S.clipboardText(page)).toMatch(/^origo-cube:3\./);
    const code = await S.clipboardText(page);
    const third = await freshContext();
    const pasted = await third.newPage();
    await pasted.goto(fake.url + "/");
    await pasted.locator("#ol-canvas").waitFor();
    await S.importCode(pasted, code);
    await expect(pasted.locator("#ol-copy-status")).toHaveText("View restored");
    // the Rows mapping the code carried joins the address once it first displays
    await expect.poll(async () => S.scOf((await S.where(pasted)).hash), { message: "the restored Rows mapping is in the address" }).toContain(";r:e:");
    const restored = (await S.where(pasted)).hash;
    expect(S.param(restored, "mode")).toBe("path");
    expect(S.param(restored, "lk")).toBe("1");
    expect(S.param(restored, "bs")).toBe("i");
    expect(S.scOf(restored)).toBe(S.scOf(settled));
    expect(S.param(restored, "ap")).toBe(S.AP);
  });

  test("a FITTED view (Path, Intensity, the Comparison lock taken in the page) copied as a link and as a code restores the same mapping, policy, frozen axis and canvas in a fresh context with no cache", async ({ page, context, fakeFor, freshContext, probe }) => {
    const fake = await fakeFor("mini");
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    const surface = observe(page);
    await page.goto(fake.url + "/#w=24h&r=4,0&vis=2&ap=" + S.AP + "&mode=path&pane=volume&bs=i");
    await page.locator("#ol-canvas").waitFor();
    // the page fits the mapping by itself (Explore), then one action holds it and freezes the displayed Auto axis
    const calm = async (p, pr, su) => {
      await fake.idle({ quietMs: 300 });
      await pr.waitForQuiet({ quietMs: 450 });
      await expect.poll(async () => (await su.chip("cells")).data.updating).toBe("false");
      await pr.waitForQuiet({ quietMs: 300 });
    };
    await calm(page, probe, surface);
    await expect.poll(async () => (await surface.chip("cells")).data.state).toBe("ready");
    await S.popoverAction(page, surface, "Comparison lock");
    await calm(page, probe, surface);
    const read = async (su) => {
      const cells = (await su.chip("cells")).data;
      const axis = (await su.chip("axis")).data;
      return { cells: [cells.state, cells.policy, cells.mappingId, cells.context, cells.fitThrough], axis: [axis.axisId, axis.axisState, axis.domain] };
    };
    const before = await read(surface);
    expect(before.cells[1]).toBe("comparison");
    expect(before.cells[2]).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(before.axis[1]).toBe("frozen");
    const hash = (await S.where(page)).hash;
    expect(S.param(hash, "lk")).toBe("1");
    expect(S.scOf(hash)).toContain("a.pane.volume:x:");
    const canvas = await S.canvasHash(page);
    await page.locator("#ol-hist").click();
    await page.locator("#ol-copy-link").click();
    await expect.poll(() => S.clipboardText(page)).toContain(hash);
    const link = await S.clipboardText(page);
    await S.openQuery(page);
    await page.locator("#ol-copy-view").click();
    await expect.poll(() => S.clipboardText(page)).toMatch(/^origo-cube:3\./);
    const code = await S.clipboardText(page);
    // a fresh context, nothing stored: the link alone carries the calibration and the frozen axis
    const other = await freshContext();
    const tab = await other.newPage();
    expect((await other.storageState()).origins).toEqual([]);
    await tab.goto(link);
    await tab.locator("#ol-canvas").waitFor();
    const fresh = observe(tab);
    await expect.poll(async () => (await fresh.chip("cells")).data.state).toBe("ready");
    await fake.idle({ quietMs: 400 });
    await tab.waitForTimeout(600);
    expect(await read(fresh)).toEqual(before);
    expect((await S.where(tab)).hash).toBe(hash);
    // the held mapping came back as the one that was fitted (its observation bound is the source's: nothing was refitted here)
    expect((await fresh.chip("cells")).data.fitThrough).toBe(before.cells[4]);
    // the same mapping draws the same pixels (DPR 1, the same fake data)
    expect(await S.canvasHash(tab)).toBe(canvas);
    // the view code does the same in a third context
    const third = await freshContext();
    const pasted = await third.newPage();
    await pasted.goto(fake.url + "/");
    await pasted.locator("#ol-canvas").waitFor();
    await S.importCode(pasted, code);
    await expect(pasted.locator("#ol-copy-status")).toHaveText("View restored");
    const again = observe(pasted);
    await expect.poll(async () => (await again.chip("cells")).data.state).toBe("ready");
    await fake.idle({ quietMs: 400 });
    await pasted.waitForTimeout(600);
    expect(await read(again)).toEqual(before);
    // the import was made in the open drawer, and a browser with nothing stored shows the neutral version notice: both take room from
    // the chart, so with the drawer closed and the banner dismissed the chart is the source's
    await S.notices(pasted);
    await pasted.locator("#ol-canvas").press("t");
    await expect(pasted.locator("#ol-drawer")).toHaveAttribute("data-open", "false");
    await fake.idle({ quietMs: 400 });
    await pasted.waitForTimeout(600);
    expect(await S.canvasHash(pasted)).toBe(canvas);
  });

  test("a Rows mapping and a Local-contrast mapping carried by a link are used by the page and written back with the fitted Cells mapping", async ({ page, fakeFor }) => {
    const fake = await fakeFor("standard");
    // the Rows context the page shows for a rolling 7 day period at row level 0: measure, period identity, row size, quality, workspace
    const rowsCtx = S.E.context.rowsKey({ measure: "volume", transform: "value", curve: "log", quality: "exact", period: "roll:7", rowSize: 0, workspace: "live", instrument: "BTC/USDT" });
    const rows = S.valueRecord("volume", 4, 0, 9051.25, 130.5, { channel: "r", ctx: rowsCtx, cohort: { n: 50, excluded: 0 } });
    const lens = S.valueRecord("volume", 4, 0, 5551.25, 330.5, { channel: "l", policy: "l", origin: "fit" });
    const made = S.address({ rows: "volume", period: "7d", scale: { local: true } }, [rows, lens]);
    expect(made.dropped).toEqual([]);
    await page.goto(fake.url + "/" + made.hash);
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    // the Rows chip shows the carried mapping (not a fit of its own), for the context the link names
    const chip = observe(page);
    await expect.poll(async () => (await chip.chip("rows")).data.state, { timeout: 15000 }).toBe("ready");
    const shown = (await chip.chip("rows")).data;
    expect(shown.mappingId).toBe(rows.desc.id);
    expect(shown.context).toBe("rows|BTC/USDT|volume|period-amount-per-row|usdt|value-log|rows.volume.amount@1|exact|live|roll:7|m0");
    // the address the page writes keeps both carried records, and adds the Cells mapping it fitted itself
    await expect.poll(async () => S.scOf((await S.where(page)).hash) ?? "", { timeout: 15000 }).toMatch(/^c:e:.*;r:e:.*;l:l:/);
    const written = S.scOf((await S.where(page)).hash);
    expect(written).toContain(S.scOf(made.hash).split(";")[0]);
    expect(written).toContain(S.scOf(made.hash).split(";")[1]);
    expect(S.param((await S.where(page)).hash, "lc")).toBe("1");
    expect(await S.noticeCodes(page)).not.toContain("scale-dropped");
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
    await expect.poll(async () => S.withoutSc((await S.where(page)).hash)).toBe(S.withoutSc(made.hash));
  });

  test("the bare root: a stored version-2 view restores silently", async ({ page, context, fakeFor }) => {
    const fake = await fakeFor("mini");
    await seed(context, { "view:v5": { version: 5, visualVersion: 2, prefs: {}, view: V2_VIEW } });
    await page.goto(fake.url + "/");
    await fake.idle();
    expect(S.withoutSc((await S.where(page)).hash)).toBe(V2_VIEW);
    expect(await S.noticeCodes(page)).toEqual([]);
  });

  test("the bare root: a stored legacy view restores with the legacy notice, once", async ({ page, context, fakeFor }) => {
    const fake = await fakeFor("mini");
    await seed(context, { "view:v5": LEGACY_V5 });
    await page.goto(fake.url + "/");
    await fake.idle();
    // the view is the legacy one, now written as version 2
    const hash = S.withoutSc((await S.where(page)).hash);
    expect(hash).toMatch(/^#w=7d&vis=2&ap=slate2-8f7890f7&mode=flow&pane=volume&rows=relvol$/);
    const list = await S.notices(page);
    expect(list.map((n) => n.code)).toEqual(["legacy-migrated"]);
    // the notice lists every setting whose meaning changed: mode, Rows and the pane (the words come from the module's migrate table,
    // behind the banner's Details toggle)
    for (const setting of ["mode", "rows", "pane"]) expect(S.said(list[0])).toContain(setting);
    // the next open of this browser sees a version-2 view: no notice
    const again = await page.context().newPage();
    await again.goto(fake.url + "/");
    await again.locator("#ol-canvas").waitFor();
    expect(await S.noticeCodes(again)).toEqual([]);
  });

  test("the bare root: a stored version-4 view (the recorded legacy fixture) restores migrated, with the legacy notice", async ({ page, context, fakeFor }) => {
    const fake = await fakeFor("mini");
    const v4 = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "../fixtures/legacy/view-v4.json"), "utf8"));
    await seed(context, { "view:v4": v4 });
    await page.goto(fake.url + "/");
    await fake.idle();
    // the fixture's window, mode and level lock come back as a version-2 address, and the notice names the migrated mode;
    // it stored Column POCs on, so they stay on
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=7d&vis=2&ap=" + S.AP + "&mode=flow&marks=poc");
    const list = await S.notices(page);
    expect(list.map((n) => n.code)).toEqual(["legacy-migrated"]);
    expect(S.said(list[0])).toContain("mode");
    // the workspace of the fixture (its prefs) came back too
    expect((await S.storage(page)).local["view:v5"]).toContain("visualVersion");
  });

  test("the bare root: nothing stored gives the default view and no notice, and the flag is written so a later visit stays quiet", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/");
    await fake.idle();
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP);
    expect(await S.noticeCodes(page)).toEqual([]);
    expect((await S.storage(page)).local["notice:v2"]).toBeTruthy();
  });

  test("the bare root: a browser used before, with no view stored, gets the default view and one neutral notice, once", async ({ page, context, fakeFor }) => {
    const fake = await fakeFor("mini");
    await seed(context, { "views:v1": [] });
    await page.goto(fake.url + "/");
    await fake.idle();
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP);
    const list = await S.notices(page);
    expect(list.map((n) => n.code)).toEqual(["version-default"]);
    expect(list[0].count).toBe(1);
    // a second tab of the same browser: the flag is stored, no second notice
    const tab = await context.newPage();
    await tab.goto(fake.url + "/");
    await tab.locator("#ol-canvas").waitFor();
    expect(await S.noticeCodes(tab)).toEqual([]);
  });

  test("a link at startup restores the preferences and skips the stored view, with no notice for it", async ({ page, context, fakeFor }) => {
    const fake = await fakeFor("mini");
    await seed(context, { "view:v5": { ...LEGACY_V5, prefs: { drawer: "cells", drawerOpen: true } } });
    await page.goto(fake.url + "/#w=30d&vis=2&ap=" + S.AP);
    await fake.idle();
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=30d&vis=2&ap=" + S.AP);
    // the preference (the open drawer) came back; the stored legacy view was neither applied nor reported
    await expect(page.locator("#ol-drawer")).toHaveAttribute("data-open", "true");
    expect(await S.noticeCodes(page)).toEqual([]);
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

  test("a legacy link migrates with one notice per payload and tab; the address becomes version 2", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    await page.goto(fake.url + "/" + "#w=24h&mode=flow&rows=relvol&pane=volume");
    await fake.idle();
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP + "&mode=flow&pane=volume&rows=relvol");
    // the same payload again in this tab (an address typed into the bar) is not reported again
    await page.evaluate(() => {
      location.hash = "#w=24h&mode=flow&rows=relvol&pane=volume";
    });
    await expect.poll(async () => S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP + "&mode=flow&pane=volume&rows=relvol");
    await page.waitForTimeout(300);
    // the banner's rows: one report, seen once (a second report would be a second row or a count of 2)
    const reports = (await S.notices(page)).filter((n) => n.code === "legacy-migrated");
    expect(reports).toHaveLength(1);
    expect(reports[0].count).toBe(1);
  });

  test("a legacy named view opens migrated and re-saving protects a complete v3 snapshot while retaining legacy bytes", async ({ page, context, fakeFor }) => {
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
    expect((await S.noticeCodes(page)).filter((c) => c === "legacy-migrated")).toHaveLength(1);
    // the stored entry is exactly what it was
    expect((await S.storage(page)).local["views:v1"]).toBe(raw);
    // Re-saving creates a protected complete v3 snapshot; the legacy record stays verbatim.
    await S.openViews(page);
    await page.locator("#ol-view-name").fill("Old flow");
    await page.locator("#ol-view-form button[type=submit], #ol-view-form .ol-solid").first().click();
    await expect.poll(async () => (await S.namedEntries(page)).find((x) => x.name === "Old flow")?.visualVersion).toBe(3);
    const protectedEntry = (await S.namedEntries(page)).find((x) => x.name === "Old flow");
    expect(protectedEntry.payload).toMatchObject({ visualVersion: 3, drawings: { schemaVersion: 1, objects: [] } });
    expect((await S.storage(page)).local["views:v1"]).toBe(raw);
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

  test("an appearance the page does not build keeps the default and says so", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    for (const ap of ["nosuch9-12345678", "slate2-00000000"]) {
      const tab = await page.context().newPage();
      await tab.goto(fake.url + "/#w=24h&vis=2&ap=" + ap);
      await tab.locator("#ol-canvas").waitFor();
      await expect.poll(async () => S.withoutSc((await S.where(tab)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP);
      expect(await S.noticeCodes(tab)).toContain("appearance-mismatch");
      await tab.close();
    }
  });

  test("the original build opens vis=2 addresses and legacy names while preserving protected v3 snapshots (rollback, B22)", async ({ page, context, fakeFor, baselinePage }) => {
    const fake = await fakeFor("mini");
    const legacyNamed = { name: "Legacy kept", live: false, span: 10, lead: 0, auto: true, mode: "delta", pane: "cells", rows: "off", period: "90d", hash: "#w=24h&vis=2&ap=" + S.AP + "&mode=delta", tA: 1, tB: 2, cut: 3, n: 6, m: 0, window: "24h", replay: false, visualVersion: 2 };
    await seed(context, { "views:v1": [legacyNamed] });
    const descriptor = S.address({ mode: "delta", scale: { basis: "intensity" } }, [S.valueRecord("delta", 4, 0, 1204551.25, 8830.5, { policy: "k", origin: "manual" })]);
    await page.goto(fake.url + "/" + descriptor.hash);
    await fake.idle();
    await S.openViews(page);
    await page.locator("#ol-view-name").fill("Kept");
    await page.locator("#ol-view-form button[type=submit]").click();
    await expect.poll(async () => (await S.namedEntries(page)).map((x) => x.name)).toContain("Kept");
    // any action that saves writes the last view (a named view writes only its own list)
    await page.keyboard.press("Escape");
    await page.keyboard.press("i");
    await expect.poll(async () => (await S.storage(page)).local["view:v5"]).toContain("visualVersion");
    const written = await S.storage(page);
    // the keys, envelopes and entries this build writes are the ones the original build reads
    expect(JSON.parse(written.local["view:v5"])).toMatchObject({ version: 5, visualVersion: 2 });
    expect(JSON.parse(written.session["history:v1"])).toMatchObject({ visualVersion: 2 });
    expect((await S.namedEntries(page)).find((x) => x.name === "Kept")).toMatchObject({ name: "Kept", visualVersion: 3, payload: { visualVersion: 3, drawings: { schemaVersion: 1, objects: [] } } });
    // the original build, given that storage and then an address with the version-2 parameters
    const seedStorage = ({ local, session }) => {
      try {
        if (localStorage.getItem("__seeded")) return;
        localStorage.setItem("__seeded", "1");
        for (const [k, v] of Object.entries(local)) localStorage.setItem("market-state-cube-explorer:" + k, v);
        for (const [k, v] of Object.entries(session)) sessionStorage.setItem("market-state-cube-explorer:" + k, v);
      } catch {
        // a blank page
      }
    };
    const strip = (area) => Object.fromEntries(Object.entries(area).filter(([k]) => !k.startsWith("notice:") && !k.startsWith("backup:")));
    const { page: old } = await baselinePage({ mode: "live", url: "/", initScripts: [{ fn: seedStorage, arg: { local: strip(written.local), session: {} } }] });
    await old.locator("#ol-canvas").waitFor();
    // a stored last view with version-2 members: restored by its place and settings, the members it does not know ignored
    await expect.poll(async () => (await S.where(old)).hash).toBe("#w=24h&mode=delta");
    await S.openViews(old);
    await expect(old.locator("#ol-saved")).toContainText("Legacy kept");
    // Old readers do not offer v3 snapshots, but leave their protected records intact.
    await expect(old.locator("#ol-saved")).not.toContainText("Kept");
    expect(await S.namedStorage(old)).toEqual(Object.fromEntries(Object.entries(strip(written.local)).filter(([k]) => /^drawing-views:v[12]:/.test(k)).map(([k, v]) => ["market-state-cube-explorer:" + k, v])));
    const { page: linked } = await baselinePage({ mode: "live", url: "/" + descriptor.hash });
    await linked.locator("#ol-canvas").waitFor();
    await expect.poll(async () => (await S.where(linked)).hash).toBe("#w=24h&mode=delta");
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
