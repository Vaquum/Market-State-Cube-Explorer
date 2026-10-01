"use strict";
// tests/browser/rows-support.js (R): what the Rows browser specs (rows.spec.js B10, relative-volume.spec.js B11, nonvalues.spec.js
// B16b) share: hand-authored trade streams with closed-form answers, and readers of the canvas and of the profile strip.
//
// Oracles, none of them the code under test:
//   * the trade streams below are built so that the expected Relative volume of every row follows from which rows traded where
//     (equal conditional distributions read 0; a row the period traded and the rectangle did not is negative-infinite; the
//     reverse is no-reference): the expectation is a set statement about the streams, not a computed number;
//   * the period's rows come from tests/reference (exact rational sums over the same trades);
//   * colours are the PINNED LUT entries of the encoding module's build (window.explorerEncoding.lut.build), composited with the
//     same source-over arithmetic a 2D canvas uses, which is checked here against the canvas itself (one pixel, +-1).
// Nothing here imports src/.
const { T0 } = require("../support/wire.js");

const BASE_MS = 56250;
const CUTOFF_ISO = "2026-09-24T12:02:00Z";
const CUTOFF_COL = (Date.parse(CUTOFF_ISO) / 1000 - T0) / 56.25; // 3214082.1333...
const END_COL = Math.ceil(CUTOFF_COL); // the period ends at the edge that closes the data: 3214083
const DAY_COLS = 1536; // a rolling day in base columns (86,400 s / 56.25 s)

// One trade per row and per base column over [fromCol, toCol): the six trades of a column sit in its first three seconds, so the
// open column at the cutoff (7.5 s in) already holds all of them. A row's price is its centre; its quantity is `weight` x 0.004 BTC.
function columnTrades({ fromCol, toCol, rows }) {
  const trades = [];
  for (let c = fromCol; c < toCol; c++) {
    let i = 0;
    for (const [row, weight] of Object.entries(rows)) {
      trades.push({ t_ms: c * BASE_MS + 500 + 500 * i++, price: Number(row) * 12500 + 6250, qty: 400000 * weight, takerBuy: (c + i) % 2 === 0 });
    }
  }
  return trades;
}

const byTime = (a, b) => a.t_ms - b.t_ms;

// Stream A, "identical": every column of the last day and a bit more trades the same six rows in the same proportions, so the
// rectangle of ANY whole-column selection trades exactly like the period does, on any price range W.
const ROWS_A = { 200: 1, 201: 2, 202: 3, 203: 4, 204: 3, 205: 2 };
function identical() {
  const trades = columnTrades({ fromCol: END_COL - DAY_COLS - 100, toCol: END_COL - 1, rows: ROWS_A });
  // The open column is the last one: it also holds all six trades.
  trades.push(...columnTrades({ fromCol: END_COL - 1, toCol: END_COL, rows: ROWS_A }));
  return { name: "rows-identical", trades: trades.sort(byTime), cutoffIso: CUTOFF_ISO, rows: Object.keys(ROWS_A).map(Number) };
}

// Stream B, "disjoint": the last day trades rows 200 to 205; three days earlier, for two hours, only rows 200 and 210 traded. A
// selection over those two hours against the 1-day period therefore has, on W = rows 199..211 (W is half open: [199, 212)):
//   row 200       both traded           finite
//   rows 201..205 the period only       negative-infinite (no current volume)
//   row 210       the rectangle only    no-reference
//   every other row of W                empty-both
const ROWS_B_PERIOD = { 200: 1, 201: 2, 202: 3, 203: 4, 204: 3, 205: 2 };
const EARLY_FROM = END_COL - 3 * DAY_COLS;
const EARLY_TO = EARLY_FROM + 128; // two hours
function disjoint() {
  const trades = [
    ...columnTrades({ fromCol: EARLY_FROM, toCol: EARLY_TO, rows: { 200: 1, 210: 1 } }),
    ...columnTrades({ fromCol: END_COL - DAY_COLS - 10, toCol: END_COL, rows: ROWS_B_PERIOD }),
  ];
  return {
    name: "rows-disjoint",
    trades: trades.sort(byTime),
    cutoffIso: CUTOFF_ISO,
    expect: { finite: [200], negativeInfinite: [201, 202, 203, 204, 205], noReference: [210], W: [199, 212] },
    early: [EARLY_FROM, EARLY_TO],
  };
}

// An address stamp (YYYY-MM-DDTHH:MM:SS.sssZ, trailing zeros dropped as the page writes them) of a base column edge.
function stamp(col) {
  return new Date((T0 + col * 56.25) * 1000).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z");
}

// The price of a base row edge in USDT as the address writes it.
const usd = (row) => String(row * 125);

// "#t=..&p=.." of a rectangle in base columns and rows, with Rows on.
function address({ cols, rows, rowsKind, period = "1d", selection = null, extra = "" }) {
  const view = `t=${stamp(cols[0])}~${stamp(cols[1])}&p=${usd(rows[0])}~${usd(rows[1])}`;
  const sel = selection ? `&sel=${stamp(selection.cols[0])}~${stamp(selection.cols[1])},${usd(selection.rows[0])}~${usd(selection.rows[1])}` : "";
  return `#${view}&rows=${rowsKind}&period=${period}${sel}${extra}`;
}

// ---- readers of the page (run in the page; the page exposes window.explorerEncoding, a production global) ----

// The colours the bands have at rest: the raw role colour at the fixed Rows alpha over what lies under them. Right of the data's
// cutoff the plot shows the page background (the surface is painted only where there is coverage), so that is what the pixels of
// such a band are composited over; the legend samples the composite over the surface (E.lut.composite), which is the same
// arithmetic on another base.
async function bandColours(page) {
  return page.evaluate(() => {
    const E = window.explorerEncoding;
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const colour = (name) => {
      probe.style.color = `var(--ol-${name})`;
      return E.lut.parseColor(getComputedStyle(probe).color);
    };
    const surface = colour("surface");
    const background = colour("bg");
    probe.remove();
    const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, E.lut.themeOf(surface));
    const over = (rgb, base) => E.lut.over(rgb, E.lut.ROWS_ALPHA, base);
    return {
      surface, background, alpha: E.lut.ROWS_ALPHA, midpoint: lut.midpoint.css, midpointOverSurface: over(lut.midpoint.rgb, surface),
      midpointOverBackground: over(lut.midpoint.rgb, background), positive255: lut.positive.css[255], stateInk: lut.stateInk.css, lutId: lut.id,
    };
  });
}

// One column of the canvas at DPR 1 as [[r, g, b], ...] from the top (x in css px).
async function canvasColumn(page, x) {
  return page.evaluate((px) => {
    const canvas = document.getElementById("ol-canvas");
    if (window.devicePixelRatio !== 1) throw new Error("the pixel reads need DPR 1");
    const data = canvas.getContext("2d").getImageData(Math.round(px), 0, 1, canvas.height).data;
    const out = [];
    for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]]);
    return out;
  }, x);
}

const near = (a, b, tol = 1) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

// The vertical runs of a pixel column whose colour is within `tol` of `rgb`, as [{y0, y1}] (y1 exclusive), runs a gridline
// apart (up to `gap` pixels) kept as one.
function runsOf(column, rgb, { tol = 1, gap = 2 } = {}) {
  const runs = [];
  for (let y = 0; y < column.length; y++) {
    if (!near(column[y], rgb, tol)) continue;
    const last = runs[runs.length - 1];
    if (last && y - last.y1 <= gap) last.y1 = y + 1;
    else runs.push({ y0: y, y1: y + 1 });
  }
  return runs;
}

// Loaded, every read answered and no draw for a moment: the page is at rest (the same rule as the S0 parity spec).
async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 600, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

// The plot of the canvas: where it is, found from the pixels (the page exposes no geometry). The surface is painted only where the
// data has coverage, so along a column (x) that crosses the covered part the first pixel that is not the page background and the
// first background pixel after it are the plot's top and bottom (y0, y1), and along a row just under the top the first and last
// surface-coloured pixels are the coverage's left and right edge (x0 and `covered`, the data's cutoff). Right of the cutoff the plot is the page background too; its right edge is where the first gridline
// below the top stops (a gridline crosses the whole plot), which gives x1.
async function plotRect(page, { x, y }) {
  return page.evaluate(({ x, y }) => {
    const E = window.explorerEncoding;
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    probe.style.color = "var(--ol-bg)";
    const bg = E.lut.parseColor(getComputedStyle(probe).color);
    probe.style.color = "var(--ol-surface)";
    const surface = E.lut.parseColor(getComputedStyle(probe).color);
    probe.remove();
    const canvas = document.getElementById("ol-canvas");
    const c = canvas.getContext("2d");
    const isBg = (data, k) => data[4 * k] === bg[0] && data[4 * k + 1] === bg[1] && data[4 * k + 2] === bg[2];
    const edges = (data, n) => {
      let a = -1;
      for (let k = 0; k < n; k++) {
        if (a < 0 && !isBg(data, k)) a = k;
        else if (a >= 0 && isBg(data, k)) return [a, k];
      }
      return [a, n];
    };
    const col = c.getImageData(Math.round(x), 0, 1, canvas.height).data;
    const [y0, y1] = edges(col, canvas.height);
    // The row that finds the coverage's edge must cross the plot above the data (no cell, no band): near its top.
    // (the last surface-coloured pixel of the row: its labels draw text that is not the background either)
    const row = c.getImageData(0, y0 + 8, canvas.width, 1).data;
    // The page writes where the heatmap ends (data-layout: x, y, w, h of the plot, then the Rows strip and the tracks), so the scan stops
    // there: the strip beside the plot is surface-coloured too and is not coverage.
    const layout = (canvas.dataset.layout || "").split(",").map(Number);
    const plotRight = layout.length >= 4 && layout.every(Number.isFinite) ? Math.round(layout[0] + layout[2]) : canvas.width;
    let x0 = -1;
    let covered = -1;
    for (let k = 0; k < plotRight; k++) {
      if (row[4 * k] === surface[0] && row[4 * k + 1] === surface[1] && row[4 * k + 2] === surface[2]) {
        if (x0 < 0) x0 = k;
        covered = k + 1;
      }
    }
    // The plot's right edge: a gridline crosses the whole plot, so a non-background pixel right of the coverage that belongs to a
    // long horizontal run of them is on one (a band or a vertical line is not).
    const probeX = Math.min(covered + 150, plotRight - 1);
    const right = c.getImageData(probeX, 0, 1, canvas.height).data;
    let x1 = covered; // no gridline beyond the coverage: the coverage reaches the plot's edge
    for (let k = y0 + 2; k < y1; k++) {
      if (isBg(right, k)) continue;
      const line = c.getImageData(0, k, canvas.width, 1).data;
      let a = probeX;
      let b = probeX;
      while (a > 0 && !isBg(line, a - 1)) a--;
      while (b + 1 < canvas.width && !isBg(line, b + 1)) b++;
      if (b - a >= 200) {
        x1 = Math.min(b + 1, plotRight);
        break;
      }
    }
    return { x0, covered, x1, y0, y1, width: canvas.width, height: canvas.height };
  }, { x, y });
}

module.exports = { atRest, plotRect, BASE_MS, CUTOFF_ISO, CUTOFF_COL, END_COL, DAY_COLS, ROWS_A, identical, disjoint, stamp, usd, address, bandColours, canvasColumn, runsOf, near };
