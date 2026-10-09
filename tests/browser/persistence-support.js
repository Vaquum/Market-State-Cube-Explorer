"use strict";
// tests/browser/persistence-support.js (package P): what the two persistence specs (B14, B15) share.
//
// Oracles of these specs (none is the page's own persistence code):
//   - the literal grammar of API.md B.15 (vis=2&ap=<id> always, every other default omitted, the `sc` record layout) and the
//     limits of D9 (8192 characters over the WHOLE url, 257 knots, 1 MiB decoded, 16 descriptors), written as numbers here;
//   - the appearance id pinned by the LUT screens (DD-86): slate2-8f7890f7;
//   - node:zlib for the codes the specs craft (a decompression bomb, a truncated gzip) and for reading back what the page
//     copied;
//   - the assembled module (tests/support/enc.js) ONLY to build inputs a person would paste or follow (an address with a
//     descriptor in it, a payload), and to recompute a mapping id from the fields a descriptor shows. That is a consistency
//     check, stated as such (TESTPLAN 3.1), never the expected value of a page behaviour.
const zlib = require("node:zlib");
const E = require("../support/enc");

// The recorded lattice: the pack the fake serves carries the same three numbers.
const ENV = { T0: 1609459200, BASE: 56.25, PR: 125, CUT: Infinity };
const AP = "slate2-8f7890f7";
const ADDRESS_MAX = 8192;

const plain = (x) => JSON.parse(JSON.stringify(x));

// A View as the codec writes it, every field at its default; `over` changes what a test is about.
function view(over = {}) {
  return {
    window: "24h", tA: NaN, tB: NaN, pA: NaN, pB: NaN, auto: true, n: null, m: null, selection: null, anchor: null, replay: false,
    follow: "refit", mode: "volume", pane: "cells", rows: "off", period: "90d", level: null, poc: false, area: false, untested: false,
    lines: [], tab: "context", evidenceKind: "poc", horizon: 1, barrier: 1, appearance: AP, scales: [], axes: [],
    scale: plain(E.policy.persisted(plain(E.policy.DEFAULTS))),
    ...over,
    // `scale` is the ten raw preferences; a test names only the ones it changes
    ...(over.scale ? { scale: { ...plain(E.policy.DEFAULTS), ...over.scale } } : {}),
  };
}

// The descriptor and record of an Explore mapping for a Cells context, the way the address carries one.
function cellsContext(measure, n, m, extra = {}) {
  return E.context.cellsKey({ measure, basis: "amount", transform: "value", curve: "log", n, m, ...extra });
}
function valueRecord(measure, n, m, U, k, extra = {}) {
  const signed = measure === "delta";
  const desc = E.scale.manual({ kind: "value-log1p", signed, U, k }).descriptor;
  return { channel: "c", policy: "e", external: false, origin: "fit", desc, ctx: cellsContext(measure, n, m), cohort: { n: 9312, excluded: 3 }, obsEndMs: 1790251320000, cutMs: null, canonicalThroughMs: null, token: null, ...extra };
}
// A rank mapping with REPEATED values in its cohort: its knots hold runs of duplicates (S1-079), the case whose restoration
// has to be bit-exact.
function rankRecord(measure, n, m, values, extra = {}) {
  const desc = E.scale.fitRank(values).descriptor;
  const ctx = E.context.cellsKey({ measure, basis: measure === "size" ? "mean" : "amount", transform: "rank", n, m });
  return { channel: "c", policy: extra.policy || "e", external: false, origin: "fit", desc, ctx, cohort: { n: values.length, excluded: 0 }, obsEndMs: 1790251320000, cutMs: null, canonicalThroughMs: null, token: null, ...extra };
}
const DUPLICATE_VALUES = Array.from({ length: 600 }, (_, i) => 1 + (i % 7) * 3 + Math.floor(i / 97));

function address(over, scales = [], axes = []) {
  return E.codec.formatAddress({ ...view(over), scales, axes }, ENV, {});
}

// The `sc` parameter of an address, as text, or null.
function scOf(hash) {
  const m = /(?:^|[#&])sc=([^&]*)/.exec(hash);
  return m ? m[1] : null;
}
// A parameter of an address, or null.
function param(hash, key) {
  const m = new RegExp("(?:^#|&)" + key + "=([^&]*)").exec(hash);
  return m ? m[1] : null;
}

// ---- codes the specs craft ----
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
function gzipCode(text) {
  return "origo-cube:2." + b64url(zlib.gzipSync(Buffer.from(text, "utf8")));
}
// A code whose decompressed size is over the 1 MiB limit by `extra` bytes; a few kilobytes of text.
function bombCode(extra = 1) {
  return "origo-cube:2." + b64url(zlib.gzipSync(Buffer.alloc(1048576 + extra, 0x20), { level: 9 }));
}

// ---- page helpers ----
// The banner shows ONE notice at a time (the most serious, then the newest; the rest wait as "+N more"), so the list of everything the
// page said is read the way a person reads it: take the visible one, with its details (the lines behind the Details toggle), dismiss
// it, and look at the next. Each item is {notice, code, count, text, details, waiting}. It empties the banner, so a test calls it
// LAST, or accepts that a dismissed row stays dismissed while the same thing keeps happening (E.notice.post).
async function notices(page) {
  const out = [];
  for (let i = 0; i < 40; i++) {
    const item = await page.evaluate(() => {
      const box = document.getElementById("ol-notice");
      if (!box || box.hidden) return null;
      // every waiting notice is in the banner; only the current one is not hidden
      const n = box.querySelector("[data-notice]:not([hidden])");
      const queued = /\+(\d+) more/.exec(box.querySelector(".ol-notice-queued")?.textContent ?? "");
      return {
        notice: n.dataset.notice, code: n.dataset.code ?? null, count: n.dataset.count === undefined ? null : Number(n.dataset.count),
        text: n.textContent.trim(), details: [...box.querySelectorAll("#ol-note-details li")].map((li) => li.textContent.trim()),
        waiting: queued ? Number(queued[1]) : 0,
      };
    });
    if (!item) break;
    out.push(item);
    // a DOM click: an open popover may sit over the banner, and what is read here is the queue, not the pointer path to its button
    await page.locator("#ol-notice-dismiss").evaluate((button) => button.click());
  }
  return out;
}
async function noticeCodes(page) {
  return (await notices(page)).map((n) => n.code);
}
// The words of one notice, its details included.
const said = (n) => [n.text, ...n.details].join(" ");
// An address without its `sc` record: the active Explore mapping of the Cells context arrives a moment after the first paint (the
// settled fit), so an assertion about the SETTINGS of an address compares this, and one about the mapping waits for `sc=`.
const withoutSc = (hash) => hash.replace(/&sc=[^&]*/, "");
// The address bar, and the history length and state of the tab.
function where(page) {
  return page.evaluate(() => ({ hash: location.hash, href: location.href, length: history.length, state: JSON.stringify(history.state) }));
}
// Everything the page keeps in the browser, as written.
function storage(page) {
  return page.evaluate(() => {
    const read = (area) => Object.fromEntries(Object.keys(area).map((k) => [k.replace("market-state-cube-explorer:", ""), area.getItem(k)]));
    return { local: read(localStorage), session: read(sessionStorage) };
  });
}
// The production storage boundary merges immutable named transactions. Assert its
// status before reading entries; never substitute a chart hash or a legacy cache.
async function namedEntries(page) {
  const status = await page.evaluate(() => window.explorerState.namedViewsStatus());
  if (!["ok", "absent"].includes(status.status) || !Array.isArray(status.entries)) throw new Error("protected named registry: " + (status.reason || status.status));
  return status.entries;
}
function namedStorage(page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /^market-state-cube-explorer:drawing-views:v[12]:/.test(k)).map((k) => [k, localStorage.getItem(k)])));
}

// Open the Query tab of the drawer (where the view code and the import live).
async function openQuery(page) {
  const panel = page.locator("#ol-panel-query");
  // a click on the tab that is already showing closes the drawer, so look before clicking
  if (await panel.isVisible()) return;
  if (!(await panel.isVisible())) await page.locator("#ol-tab-query").click();
  await panel.waitFor({ state: "visible" });
}
// Paste a code into the import field and apply it; returns the copy status text once the import has finished.
async function importCode(page, text) {
  await openQuery(page);
  if (await page.locator("#ol-import").isHidden()) await page.locator("#ol-import-toggle").click();
  await page.locator("#ol-import-text").fill(text);
  await page.locator("#ol-import-apply").click();
}
// One action of a chip's popover, by its name, the way a keyboard user takes it (open with Enter, activate with Enter, close again).
async function popoverAction(page, surface, name, channel = "cells") {
  const opened = await surface.openLegendDetails(channel);
  const button = opened.popover.getByRole("button", { name: new RegExp(`^${name}`, "i") }).first();
  await button.focus();
  await page.keyboard.press("Enter");
  await opened.close().catch(() => {});
}
// A digest of the pixels of the chart canvas at its own resolution (the harness runs at DPR 1), for "the same mapping draws the same".
function canvasHash(page) {
  return page.evaluate(() => {
    const c = document.getElementById("ol-canvas");
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0;
    return c.width + "x" + c.height + ":" + h;
  });
}
// The clipboard of a page in a context that granted it.
function clipboardText(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}
// The views popover, open.
async function openViews(page) {
  if (await page.locator("#ol-hist-pop").isHidden()) await page.locator("#ol-hist").click();
  await page.locator("#ol-hist-pop").waitFor({ state: "visible" });
}

module.exports = {
  E, ENV, AP, ADDRESS_MAX, plain, view, address, cellsContext, valueRecord, rankRecord, DUPLICATE_VALUES, scOf, param, said, withoutSc,
  gzipCode, bombCode, b64url, namedEntries, namedStorage, canvasHash, popoverAction, notices, noticeCodes, where, storage, openQuery, importCode, clipboardText, openViews,
};
