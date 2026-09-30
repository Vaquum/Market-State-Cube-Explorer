"use strict";
// persistence-limits-faults.spec.js (package P): B15, malformed, oversized, unknown, unavailable and failing persistence
// (TESTPLAN 3.4; API B.14, B.15, C.13; INTEGRATION D.9, D.14 items 8 and 9; issue #46 D9 and Acc.6). Requirement ids: S1-166,
// S1-167 (import validation and limits, enforced on read and on write), S1-169 (the ladder, storage and history failures, nothing
// truncated, nothing refitted), S1-172 (failures are visible), DR-14 and DR-31 (no cap on named views: a failed write is a visible
// notice and the running state stays usable).
//
// On the page of the working tree against a `mini` fake cube:
//   * a bad `sc` in an address keeps every setting, drops the descriptors visibly (scale-dropped) and rewrites the address without
//     them; `vis=3` is refused with its reason and the default view shows;
//   * a pasted code over a limit (a decompression bomb past 1 MiB, an unknown version, a truncated gzip, a code of a newer
//     visualVersion) is rejected WHOLE: the reason is shown (status and banner), the address and the storage are as they were, the
//     bounded inflate cancels its reader (counted by a spy on ReadableStreamDefaultReader.cancel), and the page stays responsive;
//   * a state over 8192 characters: at the ladder's first level the address is scale ids only and #ol-copy-status names it, Copy
//     link offers the full view code, and the URL never exceeds 8192 characters (counted over the WHOLE url, origin and path
//     included) at any level; at the second level it is settings only, and at the third it is not rewritten at all; the full
//     code restores the exact state in a fresh context; an address carrying ids only, opened with an empty cache, says it is not
//     exact and shows no scale;
//   * setItem throwing QuotaExceededError: the page keeps running and there is ONE storage-failed notice whose count grows;
//     replaceState throwing: one history-failed notice and the running view is unchanged; a denied clipboard: the status says so and
//     the text is selected for copying;
//   * storage written by another version is kept, not overwritten: the notice names it, the named views of a newer build survive a
//     save, and the unreadable or foreign payload is copied aside (backup:<key>) before any overwrite.
//
// Not covered here: a mapping FITTED by the page after a fallback (the "fresh Explore fit" of the wording: the fit is package S's; here
// the descriptors are dropped and the page shows no scale of the link's), and the banner's own markup (package U: the specs read the
// D.18 contract of #ol-notice).
const zlib = require("node:zlib");
const { test, expect } = require("./fixtures.js");
const S = require("./persistence-support.js");

const STORE = "market-state-cube-explorer:";
const CLIPBOARD = ["clipboard-read", "clipboard-write"];

// What the fake's pack says about the lattice and the cutoff (the tests build payloads inside the page's history).
async function packOf(page) {
  return page.evaluate(() => {
    const p = JSON.parse(document.getElementById("origo-lens-data").textContent);
    return { cutoff: p.cutoff, t0: p.t0, base: p.base_seconds, pr: p.base_price };
  });
}

// A version-2 payload the way the page exports one, with `scales` given, for a code a person would paste.
function payloadOf(pack, scales, settings = {}) {
  const cut = Math.ceil((Date.parse(pack.cutoff) / 1000 - pack.t0) / pack.base);
  return {
    visualVersion: 2,
    kind: "view",
    query: { t1: cut - 1536, t2: cut, p1: 500, p2: 540, tR: 4, pR: 0 },
    view: {
      mode: "volume", pane: "cells", poc: true, area: false, untested: false, rows: "off", period: "90d", level: null, lines: [], tab: "context",
      replay: false, anchor: null, horizon: 1, evidenceKind: "poc", barrier: 1, follow: "refit", auto: true, window: "24h", viewport: [cut - 1536, cut, 500, 540],
      scale: { basis: "amount", pathBasis: "spans", transform: "rank", curve: "log", rowsTransform: "value", cells: "explore", rows: "explore", local: false, window: null, lock: true, ...settings },
    },
    appearance: { id: S.AP },
    scales,
    axes: [],
    models: [{ ...S.plain(S.E.model.PROVENANCE), status: "timing-unverified" }],
    observation: { source: "SYNTHETIC fixture mini - not market data", instrument: "BTC/USDT", cutoffMs: Date.parse(pack.cutoff), canonicalThroughMs: null, token: null, note: "Replay on currently available history; original vintages not guaranteed" },
  };
}
async function codeOf(payload) {
  return S.E.codec.encodePortable(payload, { deflate: async (u8) => zlib.gzipSync(Buffer.from(u8)) });
}
// Four Comparison-held rank mappings (Volume, Trades, Trade size, Path): 4 x 2742 characters of knots, over the address budget.
function heldRanks() {
  const values = (k) => Array.from({ length: 500 }, (_, i) => 1 + ((i * 37 + k * 11) % 53) + (i % 4));
  return [
    S.rankRecord("volume", 4, 0, values(1), { policy: "k" }),
    S.rankRecord("trades", 4, 0, values(2), { policy: "k" }),
    S.rankRecord("size", 4, 0, values(3), { policy: "k" }),
    S.rankRecord("path", 4, 0, values(4), { policy: "k", ctx: S.E.context.cellsKey({ measure: "path", basis: "spans", transform: "rank", n: 4, m: 0 }) }),
  ];
}

// A page of the working tree that opened `fake` and is ready.
async function open(page, fake, hash = "") {
  await page.goto(fake.url + "/" + hash);
  await page.locator("#ol-canvas").waitFor();
  await fake.idle();
}

test.describe("B15 persistence: limits, malformed input and failing storage", () => {
  // The fake cube is closed by a fixture that is torn down before the page is: a live page polling the pack in that gap logs a failed
  // fetch, which is the harness's teardown order and no behaviour of the page. The pages are closed first.
  test.afterEach(async ({ context }) => {
    await Promise.all(context.pages().map((p) => p.close().catch(() => {})));
  });

  test("a bad scale in an address keeps the settings, drops the descriptor visibly and rewrites the address without it", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    const good = S.address({ mode: "volume", pane: "volume" }, [S.valueRecord("volume", 4, 0, 1204551.25, 8830.5)]).hash;
    const bad = good.replace(/:[A-Za-z0-9_-]{16}$/, ":AAAAAAAAAAAAAAAA");
    expect(bad).not.toBe(good);
    await open(page, fake, bad);
    // every setting survived, the descriptor did not
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP + "&pane=volume");
    // the descriptor of the link is not in the address any more (a fresh Explore mapping may be)
    expect(S.scOf((await S.where(page)).hash) ?? "c:e:").toMatch(/^c:e:/);
    expect(S.scOf((await S.where(page)).hash) ?? "").not.toContain("AAAAAAAAAAAAAAAA");
    const list = await S.notices(page);
    expect(list.map((n) => n.code)).toContain("scale-dropped");
    expect(S.said(list.find((n) => n.code === "scale-dropped"))).toContain("hash mismatch");
  });

  test("vis=3 is refused with its reason and the default view shows", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    await open(page, fake, "#w=7d&vis=3&mode=delta");
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP);
    const refused = (await S.notices(page)).find((n) => n.code === "import-rejected");
    expect(refused).toBeTruthy();
    expect(S.said(refused)).toContain("visual version");
    expect(S.said(refused)).toContain("3");
  });

  test("a code over a limit is rejected whole: a 1 MiB + 1 byte bomb, an unknown version, a truncated gzip, a newer visualVersion", async ({ page, context, fakeFor }) => {
    await context.addInitScript(() => {
      // a spy: the bounded inflate must cancel its reader at the limit (the stream is not read to the end)
      window.__cancels = 0;
      const original = ReadableStreamDefaultReader.prototype.cancel;
      ReadableStreamDefaultReader.prototype.cancel = function (...args) {
        window.__cancels++;
        return original.apply(this, args);
      };
    });
    const fake = await fakeFor("mini");
    await open(page, fake, "#w=7d&vis=2&ap=" + S.AP + "&mode=delta");
    // the fitted mapping of the view joins the address a moment after the first paint: wait for it, so "unchanged" is exact
    await expect.poll(async () => S.scOf((await S.where(page)).hash), { timeout: 10000 }).toMatch(/^c:e:/);
    const pack = await packOf(page);
    const before = { where: await S.where(page) };
    const good = await codeOf(payloadOf(pack, [S.valueRecord("volume", 4, 0, 1204551.25, 8830.5)]));
    const newer = S.gzipCode(JSON.stringify({ visualVersion: 3, kind: "view" }));
    const cases = [
      { name: "bomb", text: S.bombCode(1), reason: /decompresses to more than 1048576 bytes/ },
      { name: "unknown tag", text: "origo-cube:9.abcdef", reason: /newer or unknown version \(9\)/ },
      // half of the gzip bytes, re-encoded: valid base64url, a stream that ends early
      { name: "truncated gzip", text: "origo-cube:2." + S.b64url(Buffer.from(good.slice("origo-cube:2.".length), "base64url").subarray(0, 120)), reason: /could not be decompressed/ },
      { name: "newer visualVersion", text: newer, reason: /visual version 3 was made by a newer or unknown version/ },
    ];
    for (const c of cases) {
      const started = Date.now();
      await S.importCode(page, c.text);
      await expect(page.locator("#ol-copy-status"), c.name).toHaveText(c.reason);
      // the page answered, and nothing it shows or keeps has changed
      expect(Date.now() - started, c.name + " is fast").toBeLessThan(10000);
      expect((await S.where(page)).hash, c.name).toBe(before.where.hash);
      // the stored last view is still the one of before the attempt (opening the drawer saves its own preference, nothing else)
      expect(JSON.parse((await S.storage(page)).local["view:v5"]).view, c.name).toBe(before.where.hash);
      await expect(page.locator("#ol-import-apply")).toBeEnabled();
    }
    expect(await page.evaluate(() => window.__cancels), "the bomb's reader was cancelled").toBeGreaterThanOrEqual(1);
    const codes = (await S.notices(page)).map((n) => n.code);
    expect(codes.filter((c) => c === "import-rejected").length).toBeGreaterThanOrEqual(1);
  });

  test("a valid code is applied; pasting garbage keeps the baseline words; an over-long text is refused before it is decoded", async ({ page, fakeFor }) => {
    const fake = await fakeFor("mini");
    await open(page, fake);
    const pack = await packOf(page);
    await S.importCode(page, "not a code");
    await expect(page.locator("#ol-copy-status")).toContainText("That isn't a cube query or a view code");
    await S.importCode(page, "origo-cube:2." + "A".repeat(1398166 + 10));
    await expect(page.locator("#ol-copy-status")).toContainText("longer than 1398166 characters");
    const code = await codeOf(payloadOf(pack, [S.rankRecord("volume", 4, 0, S.DUPLICATE_VALUES)]));
    await S.importCode(page, code);
    await expect(page.locator("#ol-copy-status")).toHaveText("View restored");
    expect(S.param((await S.where(page)).hash, "lk")).toBe("1");
  });

  test("a browser that cannot compress writes the uncompressed code (origo-cube:2j.), and any browser reads it back", async ({ page, context, fakeFor, freshContext }) => {
    await context.addInitScript(() => {
      delete window.CompressionStream;
    });
    const fake = await fakeFor("mini");
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    await open(page, fake, "#w=24h&vis=2&ap=" + S.AP + "&mode=delta&bs=i");
    await S.openQuery(page);
    await page.locator("#ol-copy-view").click();
    await expect.poll(() => S.clipboardText(page)).toMatch(/^origo-cube:2j\./);
    const code = await S.clipboardText(page);
    // the uncompressed form is percent-encoded canonical JSON of the same payload
    expect(JSON.parse(decodeURIComponent(code.slice("origo-cube:2j.".length)))).toMatchObject({ visualVersion: 2, kind: "view", appearance: { id: S.AP } });
    const other = await freshContext();
    const tab = await other.newPage();
    await tab.goto(fake.url + "/");
    await tab.locator("#ol-canvas").waitFor();
    await S.importCode(tab, code);
    await expect(tab.locator("#ol-copy-status")).toHaveText("View restored");
    expect(S.param((await S.where(tab)).hash, "mode")).toBe("delta");
    expect(S.param((await S.where(tab)).hash, "bs")).toBe("i");
  });

  test("more than 8192 characters: the address is scale ids only, the status names the level, Copy link offers the full code, the code restores exactly", async ({ page, context, fakeFor, freshContext }) => {
    const fake = await fakeFor("mini");
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    await open(page, fake);
    const pack = await packOf(page);
    const ranks = heldRanks();
    // the four full records are more than the budget (4 x 2742 characters of knots alone)
    expect(S.address({ scale: { lock: true, transform: "rank" } }, ranks, []).hash.length).toBeGreaterThan(S.ADDRESS_MAX);
    const code = await codeOf(payloadOf(pack, ranks));
    await S.importCode(page, code);
    await expect(page.locator("#ol-copy-status")).toHaveText("View restored");
    await expect(page.locator("#ol-copy-status")).toHaveAttribute("data-address-level", "ids");
    // the ladder replaces rank knots by ids one mapping at a time, only as many as the budget needs: here two of the four
    const where = await S.where(page);
    const hash = where.hash;
    expect((hash.match(/q~[A-Za-z0-9_-]{16}/g) || []).length).toBe(2);
    expect((hash.match(/:q[A-Za-z0-9_-]{2000,}:/g) || []).length).toBe(2);
    expect(where.href.length).toBeLessThanOrEqual(S.ADDRESS_MAX);
    // Copy link: the clipboard holds a URL within the budget, the status names the level and offers the code
    await S.openViews(page);
    await page.locator("#ol-copy-link").click();
    await expect.poll(() => S.clipboardText(page)).toContain("#w=24h");
    const link = await S.clipboardText(page);
    expect(link.length).toBeLessThanOrEqual(S.ADDRESS_MAX);
    await expect(page.locator("#ol-views-status")).toContainText("scale IDs only, not exact");
    await expect(page.locator("#ol-views-status button")).toHaveText("Copy view code");
    // the offered code is the whole view
    await page.locator("#ol-views-status button").click();
    await expect.poll(() => S.clipboardText(page)).toMatch(/^origo-cube:2\./);
    const full = await S.clipboardText(page);
    const other = await freshContext();
    const tab = await other.newPage();
    await tab.goto(fake.url + "/");
    await tab.locator("#ol-canvas").waitFor();
    await S.importCode(tab, full);
    await expect(tab.locator("#ol-copy-status")).toHaveText("View restored");
    expect((await S.where(tab)).hash).toBe(hash);
    // an ids-only address opened with an empty cache: said to be not exact, no scale is shown, every setting stays
    const third = await freshContext();
    const ids = await third.newPage();
    await ids.goto(link);
    await ids.locator("#ol-canvas").waitFor();
    const dropped = (await S.notices(ids)).find((n) => n.code === "scale-dropped");
    expect(S.said(dropped)).toContain("scale IDs only, not exact");
    expect(S.param((await S.where(ids)).hash, "lk")).toBe("1");
    // the two mappings the link carried in full are restored; the two it carried as ids are not (nothing is refitted to fill them)
    const after = (await S.where(ids)).hash;
    expect(after).not.toContain("q~");
    expect((after.match(/:q[A-Za-z0-9_-]{2000,}:/g) || []).length).toBe(2);
  });

  test("a named view saved at a shortened address keeps the full code beside it, and opens exactly from it", async ({ page, fakeFor, freshContext }) => {
    const fake = await fakeFor("mini");
    await open(page, fake);
    const pack = await packOf(page);
    await S.importCode(page, await codeOf(payloadOf(pack, heldRanks())));
    await expect(page.locator("#ol-copy-status")).toHaveAttribute("data-address-level", "ids");
    const exact = (await S.where(page)).hash;
    await S.openViews(page);
    await page.locator("#ol-view-name").fill("Four ranks");
    await page.locator("#ol-view-form button[type=submit]").click();
    await expect.poll(async () => (await S.storage(page)).local["views:v1"]).toContain("Four ranks");
    const [entry] = JSON.parse((await S.storage(page)).local["views:v1"]);
    // the entry is versioned, carries its (shortened) address, and the code that is exact
    expect(entry.visualVersion).toBe(2);
    expect(entry.hash).toContain("q~");
    expect(entry.code).toMatch(/^origo-cube:2\./);
    expect(entry.code.length).toBeLessThanOrEqual(64 * 1024);
    // in a fresh browser with only that list, opening the view restores the two mappings the address alone could not
    const other = await freshContext();
    await other.addInitScript(
      ({ prefix, list }) => {
        try {
          if (localStorage.getItem("__seeded")) return;
          localStorage.setItem("__seeded", "1");
          localStorage.setItem(prefix + "views:v1", list);
        } catch {
          // a blank page has no storage
        }
      },
      { prefix: STORE, list: JSON.stringify([entry]) },
    );
    const tab = await other.newPage();
    await tab.goto(fake.url + "/");
    await tab.locator("#ol-canvas").waitFor();
    await S.openViews(tab);
    await tab.locator("#ol-saved .ol-entry").first().click();
    await expect.poll(async () => (await S.where(tab)).hash).toBe(exact);
  });

  test("the ladder's second and third level: settings only, then the address is not rewritten; the URL never exceeds 8192 characters", async ({ page, context, fakeFor }) => {
    const fake = await fakeFor("mini");
    await context.grantPermissions(CLIPBOARD, { origin: fake.url });
    const start = "/?pad=";
    const room = (spare) => "x".repeat(S.ADDRESS_MAX - spare - (fake.url + start).length);
    // the settings-only address is about 40 characters: leave room for it but not for three ids
    await page.goto(fake.url + start + room(70) + "#w=24h&vis=2&ap=" + S.AP);
    await page.locator("#ol-canvas").waitFor();
    const pack = await packOf(page);
    await S.importCode(page, await codeOf(payloadOf(pack, heldRanks())));
    await expect(page.locator("#ol-copy-status")).toHaveText("View restored");
    await expect(page.locator("#ol-copy-status")).toHaveAttribute("data-address-level", "settings");
    const settings = (await S.where(page)).href;
    expect(settings.length).toBeLessThanOrEqual(S.ADDRESS_MAX);
    expect(settings).not.toContain("sc=");
    await S.openViews(page);
    await page.locator("#ol-copy-link").click();
    await expect.poll(() => S.clipboardText(page)).toContain("?pad=");
    expect((await S.clipboardText(page)).length).toBeLessThanOrEqual(S.ADDRESS_MAX);
    await expect(page.locator("#ol-views-status")).toContainText("Settings-only URL, not exact calibration");
    // no room even for the settings: the address is left as it is and the status says the code is the way to keep the view
    await page.goto(fake.url + start + room(12) + "#w=24h");
    await page.locator("#ol-canvas").waitFor();
    const held = (await S.where(page)).href;
    await S.importCode(page, await codeOf(payloadOf(pack, heldRanks())));
    await expect(page.locator("#ol-copy-status")).toHaveAttribute("data-address-level", "refused");
    expect((await S.where(page)).href).toBe(held);
    expect((await S.where(page)).href.length).toBeLessThanOrEqual(S.ADDRESS_MAX);
  });

  test("setItem throwing QuotaExceededError: the page keeps running, one storage-failed notice whose count grows", async ({ page, context, fakeFor }) => {
    await context.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      };
    });
    const fake = await fakeFor("mini");
    await open(page, fake);
    for (let i = 0; i < 3; i++) await page.keyboard.press("m");
    // the running state is usable: the address followed the mode changes
    await expect.poll(async () => S.param((await S.where(page)).hash, "mode")).not.toBeNull();
    const failed = (await S.notices(page)).filter((n) => n.code === "storage-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].count).toBeGreaterThan(1);
  });

  test("replaceState throwing: one history-failed notice and the running view is unchanged", async ({ page, context, fakeFor }) => {
    await context.addInitScript(() => {
      history.replaceState = function () {
        throw new DOMException("Too many calls.", "SecurityError");
      };
    });
    const fake = await fakeFor("mini");
    await open(page, fake);
    await page.keyboard.press("m");
    // it is the most serious row, so the banner shows it; reading the banner empties it, so wait for it first and read once
    await expect(page.locator('#ol-notice [data-code="history-failed"]')).toHaveCount(1);
    const history = (await S.notices(page)).filter((n) => n.code === "history-failed");
    expect(history).toHaveLength(1);
    // the bar kept its address; the running view moved on and the stored last view says how
    expect((await S.where(page)).hash).toBe("");
    await expect.poll(async () => JSON.parse((await S.storage(page)).local["view:v5"]).view).toContain("mode=");
  });

  test("a denied clipboard: the status says so and the address is selected for copying", async ({ page, context, fakeFor }) => {
    await context.addInitScript(() => {
      const deny = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", { value: { write: deny, writeText: deny, readText: deny }, configurable: true });
    });
    const fake = await fakeFor("mini");
    await open(page, fake);
    await S.openViews(page);
    await page.locator("#ol-copy-link").click();
    await expect(page.locator("#ol-copy-status")).toContainText("Selected for copy");
    await expect(page.locator("#ol-query-text")).toHaveValue(/#w=24h&vis=2&ap=slate2-8f7890f7(&sc=[^&]*)?$/);
    expect(await S.noticeCodes(page)).toContain("clipboard");
  });

  test("storage written by another version is kept: a newer view, named views and history are named and never lost", async ({ page, context, fakeFor }) => {
    const foreignView = JSON.stringify({ version: 5, visualVersion: 3, prefs: {}, view: "#w=7d&vis=3" });
    const entry = { name: "Newer", live: false, span: 10, lead: 0, auto: true, mode: "volume", pane: "cells", rows: "off", period: "90d", hash: "#w=7d&vis=3", tA: 1, tB: 2, cut: 3, n: 6, m: 0, window: "7d", replay: false, visualVersion: 3 };
    const mine = { ...entry, name: "Mine", hash: "#w=24h&vis=2&ap=" + S.AP, visualVersion: 2 };
    const junk = "not an entry";
    await context.addInitScript(
      ({ prefix, foreignView, list }) => {
        try {
          if (localStorage.getItem("__seeded")) return;
          localStorage.setItem("__seeded", "1");
          localStorage.setItem(prefix + "view:v5", foreignView);
          localStorage.setItem(prefix + "views:v1", list);
          sessionStorage.setItem(prefix + "history:v1", JSON.stringify({ visualVersion: 3, entries: [], index: 0 }));
        } catch {
          // a blank page has no storage
        }
      },
      { prefix: STORE, foreignView, list: JSON.stringify([entry, mine, junk]) },
    );
    const fake = await fakeFor("mini");
    await open(page, fake);
    // the default view shows, and the banner names what was left alone
    expect(S.withoutSc((await S.where(page)).hash)).toBe("#w=24h&vis=2&ap=" + S.AP);
    const kept = (await S.notices(page)).filter((n) => n.code === "import-rejected");
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept.some((n) => S.said(n).includes("newer or unknown version"))).toBe(true);
    // the first write copies the foreign payload aside, verbatim, before replacing it
    await page.keyboard.press("m");
    await expect.poll(async () => (await S.storage(page)).local["backup:view:v5"]).toBe(foreignView);
    await expect.poll(async () => (await S.storage(page)).session["backup:history:v1"]).toContain('"visualVersion":3');
    // a saved view keeps the entries of the newer build (and the one that is no entry) exactly as they were
    await S.openViews(page);
    await page.locator("#ol-view-name").fill("Another");
    await page.locator("#ol-view-form button[type=submit]").click();
    await expect.poll(async () => JSON.parse((await S.storage(page)).local["views:v1"]).length).toBe(4);
    const stored = JSON.parse((await S.storage(page)).local["views:v1"]);
    expect(stored.find((x) => x.name === "Newer")).toEqual(entry);
    expect(stored).toContain(junk);
    expect(stored.map((x) => (typeof x === "string" ? x : x.name)).sort()).toEqual(["Another", "Mine", "Newer", junk].sort());
    // the newer build's entry is not shown as a row (this page cannot open it), and no cap was applied to anything
    await expect(page.locator("#ol-saved .ol-saved-row")).toHaveCount(2);
  });

  test("named views have no cap: many views are saved, a write that fails is a visible notice and the list stays usable", async ({ page, context, fakeFor }) => {
    const many = Array.from({ length: 250 }, (_, i) => ({ name: "View " + i, live: false, span: 10, lead: 0, auto: true, mode: "volume", pane: "cells", rows: "off", period: "90d", hash: "#w=24h&vis=2&ap=" + S.AP, tA: 1, tB: 2, cut: 3, n: 6, m: 0, window: "24h", replay: false, visualVersion: 2 }));
    await context.addInitScript(
      ({ prefix, list }) => {
        try {
          if (localStorage.getItem("__seeded")) return;
          localStorage.setItem("__seeded", "1");
          localStorage.setItem(prefix + "views:v1", list);
        } catch {
          // a blank page has no storage
        }
      },
      { prefix: STORE, list: JSON.stringify(many) },
    );
    const fake = await fakeFor("mini");
    await open(page, fake);
    await S.openViews(page);
    await page.locator("#ol-view-name").fill("Two hundred and fifty-one");
    await page.locator("#ol-view-form button[type=submit]").click();
    await expect.poll(async () => JSON.parse((await S.storage(page)).local["views:v1"]).length).toBe(251);
    await expect(page.locator("#ol-saved .ol-saved-row")).toHaveCount(251);
    // now the storage refuses writes: the save is reported and the rows on the page stay
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      };
    });
    await page.locator("#ol-view-name").fill("Refused");
    await page.locator("#ol-view-form button[type=submit]").click();
    await expect(page.locator("#ol-views-status")).toContainText("can't be saved");
    expect(await S.noticeCodes(page)).toContain("storage-failed");
    await expect(page.locator("#ol-saved .ol-saved-row")).toHaveCount(251);
  });
});
