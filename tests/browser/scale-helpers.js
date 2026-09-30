"use strict";
// tests/browser/scale-helpers.js (S): what the spine specs (B05-B09, B13, B20, B21) share, so each spec reads as its scenario.
//
// Nothing here computes an expected value. It waits for the page to be calm, reads the D.18 surface through observe.js,
// and gives the specs the same small vocabulary: a settled chip, a context change, the actions of a chip's popover
// (named by their accessible names, INTEGRATION.md D.7), and the replay edge of every draw frame.
//
// The timing contract (D.1, DR-17) that "calm" relies on: a calibration lands at most the settle time (200 ms) after
// the last gesture plus one fit and one draw, and every read the view needs is answered first. So calm = the fake has
// no request for a while, no draw frame for a while, and the chip says it is no longer updating.
const { expect } = require("@playwright/test");

// The window keys of the page (observe.js PRESET_KEYS), by name.
const KEY_OF = Object.freeze({ "24h": "6", "7d": "7", "30d": "8", "1y": "9", all: "0" });

// Calm: no request in flight or recent, no draw frame for a while, and the chip settled. Returns the chip's dataset.
async function calm({ fake, probe, surface }, { channel = "cells", quietMs = 450 } = {}) {
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

module.exports = { KEY_OF, calm, gotoWindow, identity, field, popoverAction, edgeLogger, framesWithEdge };
