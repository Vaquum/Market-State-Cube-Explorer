"use strict";
// tests/browser/scale-helpers.js (S): what the spine specs (B05-B09, B13, B20, B21) share, so each spec reads as its scenario.
//
// Nothing here computes an expected value. It waits for the page to be calm, reads the D.18 surface through observe.js,
// and gives the specs the same small vocabulary: a settled chip, a context change, the actions of a chip's popover
// (named by their accessible names, INTEGRATION.md D.7), and the replay edge of every draw frame.
//
// Calm observes completion of required reads, browser decoding and short scheduled work, then the settled chip in its
// corresponding draw. Timing specs with page.clock keep their existing Node-clock quiet windows: the test owns that clock.
const { expect } = require("@playwright/test");
const { resolveProfile, EPOCH_MS } = require("../support/profiles.js");
const ref = require("../reference/index.js");

// The window keys of the page (observe.js PRESET_KEYS), by name.
const KEY_OF = Object.freeze({ "24h": "6", "7d": "7", "30d": "8", "1y": "9", all: "0" });

// Returns the settled chip dataset.
async function calm({ fake, probe, surface }, { channel = "cells", quietMs = 450 } = {}) {
  if (!(await probe.readiness([channel])).clock) {
    await probe.waitForReady({ channels: [channel] });
    return (await surface.chip(channel)).data;
  }
  await fake.idle({ quietMs: 300 });
  await probe.waitForQuiet({ quietMs });
  await expect
    .poll(async () => (await surface.chip(channel)).data.updating, { timeout: 10000, message: `the ${channel} chip stays updating` })
    .toBe("false");
  await probe.waitForQuiet({ quietMs: 300 });
  return (await surface.chip(channel)).data;
}

// Choose a window by its real key and wait until the page is calm.
async function gotoWindow(ctx, name) {
  await ctx.surface.pressPreset(KEY_OF[name]);
  return calm(ctx);
}

// Move to another place (a hash of the navigation keys) WITHOUT leaving the scale: the address the page writes carries the scale
// settings (vis, ap, lk, sc, tr, bs ...) beside the place, and a hash that names only the place is a link, which restores the
// preferences it does not carry to their defaults (DR-14, D9). So the navigation keys of the target replace the current ones and
// every other key stays, which is what dragging or zooming to that place would leave.
async function go(page, hash) {
  await page.evaluate((target) => {
    const NAV = ["w", "t", "p", "r", "sel", "at", "replay"];
    const now = new URLSearchParams(location.hash.slice(1));
    const next = new URLSearchParams(String(target).replace(/^#/, ""));
    for (const key of NAV) now.delete(key);
    for (const key of NAV) if (next.has(key)) now.set(key, next.get(key));
    location.hash = now.toString();
  }, hash);
}

// The part of a chip that says WHICH scale and WHICH context (what an action must not change, or must).
function identity(data) {
  return { context: data.context, mappingId: data.mappingId, fitSeq: data.fitSeq, n: data.effectiveN, m: data.effectiveM };
}

// A details field's canonical value (data-value), as text.
function field(details, name) {
  const f = details.fields[name];
  if (!f) throw new Error(`the details list has no field ${name}: ${Object.keys(details.fields).join(", ")}`);
  return f.value;
}

// One action of a chip's popover (D.7: Fit, Auto color, Comparison lock, Local contrast are native buttons with those
// names). The popover is opened with the keyboard, as a keyboard user does, the button is activated with Enter, and the
// popover is closed again.
async function popoverAction(page, surface, channel, name) {
  const opened = await surface.openLegendDetails(channel);
  const button = opened.popover.getByRole("button", { name: new RegExp(`^${name}`, "i") }).first();
  await button.focus();
  await page.keyboard.press("Enter");
  await opened.close().catch(() => {});
}

// The replay edge of every draw frame (D.18 "Frame invariants"). The page shows the edge as text in #ol-replay-at
// ("24 Sep 06:00", UTC, the year left out while it is the cutoff's) and writes it in update(), immediately before the
// draw it belongs to; this init script logs every change with the REAL clock (the same clock as the probe's frame times,
// captured before any page.clock), so a frame's edge is the last logged change at or before the frame's time. It needs
// the edge to be minute-aligned, which it is at every level from n = 4 (a column of 900 s), and the year of the cutoff,
// which every profile has (2026).
function edgeLogger(year = 2026) {
  const install = (yearOfCutoff) => {
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const parse = (text) => {
      const m = /^(\d+) (\w{3})(?: (\d{4}))? (\d\d):(\d\d)(?::(\d\d))?/.exec(text);
      return m ? Date.UTC(m[3] ? Number(m[3]) : yearOfCutoff, months[m[2]], Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)) : NaN;
    };
    const now = performance.now.bind(performance);
    const log = [];
    window.__edges = log;
    let watching = false;
    const attach = () => {
      const node = document.getElementById("ol-replay-at");
      if (!node || watching) return;
      watching = true;
      const take = () => {
        const text = node.textContent.trim();
        if (text && (!log.length || log[log.length - 1].text !== text)) log.push({ t: now(), text, ms: parse(text) });
      };
      take();
      new MutationObserver(take).observe(node, { childList: true, characterData: true, subtree: true });
    };
    new MutationObserver(attach).observe(document, { childList: true, subtree: true });
    attach();
  };
  return { install, year };
}

// For each logged draw frame: the replay edge in force and the chip attribute pair the invariant compares.
function framesWithEdge(frames, edges) {
  return frames.map((frame) => {
    let edge = null;
    for (const e of edges) if (e.t <= frame.t) edge = e.ms;
    const cells = frame.attrs && frame.attrs.cells ? frame.attrs.cells : null;
    return { t: frame.t, edge, cells };
  });
}

// ---- the reference side (tests/reference: exact arithmetic, no code of the page or of the fake) ----

// The trades of a fake profile as the reference calculator reads them.
function tradesOf(profile, options) {
  const { store } = resolveProfile(profile, options);
  const out = [];
  for (let i = 0; i < store.length; i++) out.push({ t_ms: store.t[i], price: store.price[i], qty: store.qty[i], takerBuy: store.buy[i] === 1, count: store.count[i] });
  return out;
}

// The base column (a number of 56.25 s columns since 2021-01-01T00:00Z) of a UTC stamp; an integer when the stamp is on a column edge.
function baseOf(iso) {
  return (Date.parse(iso) - EPOCH_MS) / 56250;
}

// For the cells of a cell-aligned rectangle at level (n, m) against the top U of a Value scale: how many are occupied and how many
// of them lie ABOVE it (a value exactly on U is on the scale, not beyond it). The marks share is outside / occupied; the area share
// equals it when every occupied cell has the same box, which a cell-aligned rectangle inside the plot guarantees.
function referenceShares(trades, { n, m, from, to, rows, U }) {
  const cells = ref.cells(trades, { n, m, b0: baseOf(from), b1: baseOf(to), r0: rows[0], r1: rows[1] });
  const occupied = cells.filter((c) => c.v > 0);
  const outside = occupied.filter((c) => c.v > U).length;
  return { occupied: occupied.length, outside, share: occupied.length ? outside / occupied.length : 0 };
}

// The base rows [r0, r1) that hold every trade of [from, to) (a rectangle whose prices enclose the data, on the 125 USDT grid).
function priceRowsOf(trades, from, to) {
  const a = Date.parse(from) - EPOCH_MS;
  const b = Date.parse(to) - EPOCH_MS;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of trades) {
    if (x.t_ms < a || x.t_ms >= b) continue;
    lo = Math.min(lo, x.price);
    hi = Math.max(hi, x.price);
  }
  return [Math.floor(lo / 12500), Math.floor(hi / 12500) + 1];
}

module.exports = {
  tradesOf, baseOf, referenceShares, priceRowsOf, KEY_OF, calm, gotoWindow, go, identity, field, popoverAction, edgeLogger, framesWithEdge };
