"use strict";
// warnings.spec.js (S, B09): "Scale range exceeded" and "Low discrimination" with their actual shares (TESTPLAN 3.4, DR-11, DD-76, DD-94, DD-95).
//
// Requirement ids covered (API.md Appendix E): S1-120 (the two warnings, their thresholds and the shares shown; a warning never
// recolours, refits or changes a mapping), S1-071 (clipping is counted, the raw value is kept), S1-074 (a zero-only calibration),
// S1-056 (a manual window names its clipping counts), DD-66 (a narrowed Taker-flow window is symmetric about 0.5), DD-95 (a nonzero
// value under a zero-only calibration is out of domain and counted), A-17 (a manual domain).
//
// Oracle: the exact-rational reference calculator (tests/reference) over the trades the `skew` fake serves: a low regime for three
// days and a 200-fold regime for the next three. The level is pinned (#...&r=5,0, 30-minute columns) and every rectangle is
// cell-aligned and ends before the open column, so each occupied cell is fully measured and has the same box: the marks share
// and the area share are then the same number, outside / occupied. The boundary fixtures are FOUND by searching the reference
// cells for a rectangle whose outside share is exactly 10 % and another just above it (the test states what it found), so the
// strict "more than 10 %" of the document is hit from both sides, not approached. The index of a mark is the document's own
// formula, t = log1p(v/k) / log1p(U/k), idx = round(255 t), evaluated here from the displayed U and k (D3): a hand calculation, not
// the module.
//
// What needs another package: the Cells marks hook (C) feeds the tally; the chip popover (U) shows the warnings; the address (P)
// restores a window. Each fails by naming the missing element or hook until it has merged.
//
// Not covered: pixels of the legend bar (B03/B23), the Rows tally (B10), the lens tally (B12).
const { test, expect } = require("./fixtures.js");
const ref = require("../reference/index.js");
const { EPOCH_MS } = require("../support/profiles.js");
const { calm, field, popoverAction, tradesOf, baseOf, priceRowsOf } = require("./scale-helpers.js");

const N = 5; // 30-minute columns
const COLS = 32; // base columns in one of them
const stamp = (column) => new Date(EPOCH_MS + column * COLS * 56250).toISOString().slice(0, 16) + "Z";
const hashOf = (c0, c1, rows) => `#t=${stamp(c0)}~${stamp(c1)}&p=${rows[0] * 125}~${rows[1] * 125}&r=${N},0`;

// The skew fixture as the reference sees it: the cells of every column of the history at level (5, 0), the column that holds the
// change of regime (3 days before the cutoff) and the rows that hold every trade.
function skew() {
  const trades = tradesOf("skew");
  const first = Math.ceil(baseOf("2026-09-18T13:00Z") / COLS);
  const last = Math.floor(baseOf("2026-09-24T12:00Z") / COLS);
  const rows = priceRowsOf(trades, "2026-09-18T12:00Z", "2026-09-24T13:00Z");
  const cells = ref.cells(trades, { n: N, m: 0, b0: first * COLS, b1: last * COLS, r0: rows[0], r1: rows[1] });
  return { trades, first, last, rows, cells, boundary: Math.floor(baseOf("2026-09-21T12:02Z") / COLS) };
}

// What the chart shows for a set of cells under a Value scale with the displayed numbers: the clip counts and the shares of marks
// in the lowest and the highest 13 entries (idx 0..12, 243..255) among the nonzero ones. A value on the top of the scale is ON it
// (D3); two doubles that differ in the last bit are the same number (D4).
function look(cells, { U, k }) {
  const out = { occupied: 0, above: 0, low: 0, high: 0 };
  for (const c of cells) {
    if (!(c.v > 0)) continue;
    out.occupied += 1;
    if (c.v > U * (1 + 1e-12)) out.above += 1;
    const t = Math.min(1, Math.log1p(c.v / k) / Math.log1p(U / k));
    const idx = Math.round(255 * t);
    if (idx <= 12) out.low += 1;
    if (idx >= 243) out.high += 1;
  }
  return out;
}

const between = (cells, c0, c1) => cells.filter((c) => c.c >= c0 && c.c < c1);

async function scaleOf(surface) {
  const details = await surface.details("cells");
  return { U: Number(field(details, "U")), k: Number(field(details, "k")), details };
}

async function go(page, hash) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}

// The range warning at the boundary: init on the low regime, then rectangles whose outside share is exactly 10 % and just above.
test("Scale range exceeded is shown for more than 10 % of the marks outside, with the actual shares", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("skew");
  const ctx = { page, fake, probe, surface };
  const s = skew();
  // Explore is initialised on the low regime only.
  await page.goto(`${fake.url}/${hashOf(s.boundary - 120, s.boundary - 2, s.rows)}`);
  const init = await calm(ctx);
  expect(init.effectiveN).toBe(String(N));
  const { U, k } = await scaleOf(surface);
  const initial = await surface.details("cells");
  expect(initial.warnings.map((w) => w.warning), "nothing outside the scale it was fitted on").not.toContain("range-exceeded");

  // Find the rectangles in the reference: [c0, c1) around the change of regime with exactly 10 % outside, and with the smallest share above 10 %.
  let exact = null;
  let above = null;
  for (let c0 = s.boundary - 150; c0 < s.boundary - 2; c0++) {
    for (let c1 = s.boundary + 1; c1 < s.boundary + 70; c1++) {
      const v = look(between(s.cells, c0, c1), { U, k });
      if (v.occupied === 0) continue;
      const share = v.above / v.occupied;
      if (v.above > 0 && v.occupied === 10 * v.above && exact === null) exact = { c0, c1, ...v };
      if (share > 0.1 && (above === null || share < above.above / above.occupied)) above = { c0, c1, ...v };
    }
  }
  expect(exact, "the reference has a rectangle with exactly 10 % of its marks outside").not.toBeNull();
  expect(above, "and one just above 10 %").not.toBeNull();
  expect(above.above / above.occupied).toBeGreaterThan(0.1);
  expect(above.above / above.occupied, "the second fixture is the nearest one above the line").toBeLessThan(0.12);

  // Exactly 10 %: no warning (the threshold is strict).
  await go(page, hashOf(exact.c0, exact.c1, s.rows));
  let data = await calm(ctx);
  expect(data.context, "the same Explore context").toBe(init.context);
  expect(data.mappingId, "a warning never changes the mapping").toBe(init.mappingId);
  let details = await surface.details("cells");
  expect(Number(field(details, "clipHighFinite")), "the clip count is the reference count").toBe(exact.above);
  expect(details.warnings.map((w) => w.warning), "exactly 10 % is not more than 10 %").not.toContain("range-exceeded");

  // Just above 10 %: the warning, with the share the reference computes (counts exact, area within 1e-9).
  await go(page, hashOf(above.c0, above.c1, s.rows));
  data = await calm(ctx);
  expect(data.mappingId).toBe(init.mappingId);
  expect(data.fitSeq, "and never refits").toBe(init.fitSeq);
  await expect.poll(async () => (await surface.details("cells")).warnings.map((w) => w.warning), { message: "the warning appears" }).toContain("range-exceeded");
  details = await surface.details("cells");
  const warning = details.warnings.find((w) => w.warning === "range-exceeded");
  expect(Number(warning.shareMarks), "the share of marks").toBe(above.above / above.occupied);
  expect(Math.abs(Number(warning.shareArea) - above.above / above.occupied), "the share of screen area").toBeLessThan(1e-9);
  expect(Number(field(details, "clipHighFinite"))).toBe(above.above);
});

// Low discrimination: more than 90 % of the nonzero marks in the lowest 13 or the highest 13 of 256 entries, each end alone.
test("Low discrimination: one end above 90 % warns, a 50/50 split does not", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("skew");
  const ctx = { page, fake, probe, surface };
  const s = skew();
  // Calibrated on the HIGH regime, the low regime sits at the bottom of the scale: nearly every mark is in the lowest entries.
  await page.goto(`${fake.url}/${hashOf(s.boundary + 5, s.boundary + 130, s.rows)}`);
  const init = await calm(ctx);
  const { U, k } = await scaleOf(surface);
  await go(page, hashOf(s.boundary - 120, s.boundary - 2, s.rows));
  await calm(ctx);
  const lowRect = look(between(s.cells, s.boundary - 120, s.boundary - 2), { U, k });
  expect(lowRect.low / lowRect.occupied, "the scenario puts more than 90 % in the lowest entries").toBeGreaterThan(0.9);
  await expect.poll(async () => (await surface.details("cells")).warnings.map((w) => w.warning)).toContain("low-discrimination");
  let warning = (await surface.details("cells")).warnings.find((w) => w.warning === "low-discrimination");
  expect(warning, "the warning names the lowest entries").toBeDefined();
  expect((await calm(ctx)).mappingId, "never a refit").toBe(init.mappingId);

  // A rectangle of half low and half high cells (by the reference's own classification): 50 % is not more than 90 %.
  let mixed = null;
  for (let c0 = s.boundary - 60; c0 < s.boundary - 2 && mixed === null; c0++) {
    for (let c1 = s.boundary + 2; c1 < s.boundary + 60; c1++) {
      const v = look(between(s.cells, c0, c1), { U, k });
      if (v.occupied > 40 && Math.abs(v.low / v.occupied - 0.5) < 0.004) {
        mixed = { c0, c1, ...v };
        break;
      }
    }
  }
  expect(mixed, "the reference has a rectangle with about half of its marks in the lowest entries").not.toBeNull();
  await go(page, hashOf(mixed.c0, mixed.c1, s.rows));
  await calm(ctx);
  expect((await surface.details("cells")).warnings.map((w) => w.warning), "a 50/50 split does not warn").not.toContain("low-discrimination");
});

// The two actions a main-chart warning offers change nothing until activated; Open lens only focuses the lens toggle (DD-94).
test("a warning recolours nothing and its actions change state only when activated", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("skew");
  const ctx = { page, fake, probe, surface };
  const s = skew();
  await page.goto(`${fake.url}/${hashOf(s.boundary - 120, s.boundary - 2, s.rows)}`);
  // Keep the docked chart geometry fixed while opening and closing scale details.
  await page.locator("#ol-reference-toggle").click();
  await page.locator("#ol-reference-topic").selectOption("scales");
  const init = await calm(ctx);
  await go(page, hashOf(s.boundary + 5, s.boundary + 100, s.rows));
  const warned = await calm(ctx);
  await expect.poll(async () => (await surface.details("cells")).warnings.map((w) => w.warning)).toContain("range-exceeded");

  // A pixel of a fixed cell is identical with the details open and closed, and the mapping and counter did not move.
  const box = await page.locator("#ol-canvas").boundingBox();
  const at = { x: Math.round(box.width * 0.5), y: Math.round(box.height * 0.4) };
  const before = await surface.pixelAt(at);
  const opened = await surface.openLegendDetails("cells");
  expect(await surface.pixelAt(at), "opening the details recolours nothing").toEqual(before);
  await opened.close().catch(() => {});
  const after = (await surface.chip("cells")).data;
  expect(after.mappingId).toBe(warned.mappingId);
  expect(after.fitSeq).toBe(warned.fitSeq);
  expect(after.mappingId, "still the mapping of the low regime").toBe(init.mappingId);

  // Fit and Auto color are the actions, reached with the keyboard; they change state only when activated.
  const details = await surface.details("cells");
  expect(details.warnings.find((w) => w.warning === "range-exceeded")).toBeDefined();
  await popoverAction(page, surface, "cells", "Fit");
  const fitted = await calm(ctx);
  expect(Number(fitted.fitSeq), "Fit fitted once").toBe(Number(warned.fitSeq) + 1);
  expect(fitted.mappingId, "to a scale that fits the marks").not.toBe(init.mappingId);
  await expect.poll(async () => (await surface.details("cells")).warnings.map((w) => w.warning), { message: "the warning is gone with the fit" }).not.toContain("range-exceeded");
});

// A manual domain: typed numbers, an id that is the id of those numbers, its clipping counts, held without the global lock (A-17).
test("a manual domain is a mapping of its own numbers with its clipping counts", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("skew");
  const ctx = { page, fake, probe, surface };
  const s = skew();
  await page.goto(`${fake.url}/${hashOf(s.boundary - 120, s.boundary - 2, s.rows)}`);
  const init = await calm(ctx);
  const { U } = await scaleOf(surface);
  // A top a quarter of the fitted one: the cells above it are a count the reference knows.
  const manualU = U / 4;
  const manualK = manualU / 50;
  const opened = await surface.openLegendDetails("cells");
  await opened.popover.getByLabel("U", { exact: true }).fill(String(manualU));
  await opened.popover.getByLabel("k", { exact: true }).fill(String(manualK));
  await opened.popover.getByRole("button", { name: /^Apply/ }).click();
  await opened.close().catch(() => {});
  const data = await calm(ctx);
  const id = await page.evaluate(([u, k]) => window.explorerEncoding.scale.id({ v: 1, kind: "value-log1p", signed: false, params: { U: u, k }, clip: "clamp01@1" }), [manualU, manualK]);
  expect(data.mappingId, "the id of the typed numbers").toBe(id);
  expect(data.policy, "an explicit comparison without the global lock").toBe("comparison");
  const details = await surface.details("cells");
  expect(field(details, "fitOrigin")).toBe("manual");
  const expected = look(between(s.cells, s.boundary - 120, s.boundary - 2), { U: manualU, k: manualK });
  expect(expected.above, "the scenario clips something").toBeGreaterThan(0);
  expect(Number(field(details, "clipHighFinite")), "its clipping count is the reference count").toBe(expected.above);
  expect(data.mappingId).not.toBe(init.mappingId);
});

// B09c: a Taker-flow window typed in the popover.
test("a Taker-flow window must be symmetric about 50 %, names its clipping counts and travels in the address", async ({ page, fakeFor, probe, surface, openLink }) => {
  const fake = await fakeFor("skew");
  const ctx = { page, fake, probe, surface };
  const s = skew();
  await page.goto(`${fake.url}/${hashOf(s.boundary - 120, s.boundary - 2, s.rows)}&mode=flow`);
  await calm(ctx);
  const apply = async (lo, hi) => {
    const opened = await surface.openLegendDetails("cells");
    // The two numbers are named "lo" and "hi" and labelled Low and High (INTEGRATION D.7, package U's words).
    await opened.popover.getByLabel("Low", { exact: true }).fill(String(lo));
    await opened.popover.getByLabel("High", { exact: true }).fill(String(hi));
    await opened.popover.getByRole("button", { name: /^Apply/ }).click();
    const text = await opened.popover.textContent();
    await opened.close().catch(() => {});
    return text;
  };
  // An asymmetric pair is refused with the document's own words, and nothing changes.
  const before = (await surface.chip("cells")).data;
  expect(await apply(0.45, 0.6)).toMatch(/symmetric about 50%/);
  expect((await calm(ctx)).mappingId).toBe(before.mappingId);

  // 45 % to 55 %: a fixed-diverging window; the cells whose buy share is outside it are counted (the reference share of bv / v).
  await apply(0.45, 0.55);
  const data = await calm(ctx);
  expect(data.policy).toBe("fixed");
  expect(data.mappingId, "a narrower window is another fixed mapping").not.toBe(before.mappingId);
  const cells = between(s.cells, s.boundary - 120, s.boundary - 2).filter((c) => c.v > 0);
  const outside = cells.filter((c) => c.bv / c.v < 0.45 || c.bv / c.v > 0.55).length;
  expect(outside, "the scenario puts some cells outside the window").toBeGreaterThan(0);
  const details = await surface.details("cells");
  const counted = Number(field(details, "clipLowFinite")) + Number(field(details, "clipHighFinite"));
  expect(counted, "the clipping counts add up to the reference count").toBe(outside);
  // The window is in the address and a fresh browser restores it.
  await expect.poll(() => page.url(), { message: "sw is written to the address" }).toMatch(/[#&]sw=0\.45~0\.55(&|$)/);
  const other = await openLink(page.url());
  const { observe } = require("./observe.js");
  await other.waitForTimeout(1500);
  expect((await observe(other).chip("cells")).data.mappingId, "restored").toBe(data.mappingId);
});

// DD-95: a value under a zero-only calibration is out of domain, counted and keyed; Fit clears it.
test("a zero-only calibration shows later nonzero values as out of domain until Fit", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("micro:balanced");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:06Z&p=24000~26000&r=0,0&mode=delta`);
  const zero = await calm(ctx);
  expect(zero.state, "a cohort of only balanced cells is a zero-only calibration").toBe("zero-only");
  // A trade with a one-sided taker flow after the cutoff (00:04:00, base column 4), and the cutoff moves past its column so the cell
  // is complete. The view shows the cutoff, so it follows it: the new column is in view, the old one has moved out.
  fake.advance({ toIso: "2021-01-01T00:06:00Z", trades: [{ t_ms: 240000, price: 2500000, qty: 400000, takerBuy: true }] });
  await expect.poll(async () => page.locator("#ol-cutoff").textContent(), { timeout: 15000 }).toContain("00:06");
  const later = await calm(ctx);
  expect(later.state, "Explore does not refit").toBe("zero-only");
  expect(later.mappingId).toBe(zero.mappingId);
  await expect.poll(async () => Number(field(await surface.details("cells"), "clipHighFinite")), { message: "the new cell is counted as out of domain" }).toBe(1);
  await popoverAction(page, surface, "cells", "Fit");
  const fitted = await calm(ctx);
  expect(fitted.state, "Fit replaces the zero-only calibration").toBe("ready");
  expect(fitted.mappingId).not.toBe(zero.mappingId);
  expect(Number(field(await surface.details("cells"), "clipHighFinite"))).toBe(0);
});
