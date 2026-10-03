"use strict";
// Whole-module smoke (package WX): one synthetic cohort through the entire chain of the assembled module for
// EVERY mode of E.measure.MODES, every basis each mode offers and every transform it offers, in BOTH themes:
//   cells -> (hand-coded measure) -> E.scale fit (or the fixed descriptor) -> E.lut -> E.readout.cellsFrame ->
//   encode -> readout -> E.warn tally -> E.legend.build -> marker, bar pixels and ticks.
// Structural equality is the assertion (API.md C.16, DR-22): for one cell the encoder's index, the readout's
// index and the tick the legend marker points at are ONE number, and the colour the encoder chose is the colour
// the legend's bar shows at that marker.
//
// Oracles (none is the code under test):
//   - a hand-coded measure per mode and basis (volume z.v, trades z.ct, delta 2*bv - v, size v/ct, flow bv/v,
//     flowtrades bt/ct, path and dwell from the test's own exposure arithmetic: covered base columns times
//     56.25 s and covered base rows times 125 USDT, API.md C.1.3; Intensity = amount * 60 * 125 / (seconds *
//     width); path per minute = 60 * path / (width * seconds));
//   - a hand-coded transfer function per descriptor kind with plain Math (log1p, linear, fixed-linear,
//     fixed-diverging) and the index rule round(clamp(|t|, 0, 1) * 255); the fitted U and k are checked against
//     a largest-magnitude scan and d3.quantileSorted (the reference Type-7) of the test's own values;
//   - the LUT through E.lut.build and E.legend.barPixels read as bytes: the pixel at the marker's position is
//     compared with the parsed colour string of the encoder, so the two sides of the legend's promise
//     (S1-019) meet in integers;
//   - the cell fixture is seeded (tests/support/rng.js) and the exposure of each cell is worked out here.
// The module may run in a vm context (ENCODING_PARTS_DIR): records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const d3 = require("../../vendor/d3.min.js");
const { mulberry32 } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));

// ---- fixtures -------------------------------------------------------------------------------------------

const GEOM = { BASE: 56.25, PR: 125 };
const LEVEL = { n: 4, m: 1 }; // ts = 16 base columns, ps = 2 base rows
const TS = 16;
const PS = 2;
const BOUNDS = [3200, 3264, 400, 416];
const CUT = 3250;
const LIVE = 3258;
const END = 3300; // the motion end of Path and Dwell
const TAG = {};
E.result.TAGS.forEach((name, i) => (TAG[name] = i));
const ROLE_NAME = ["none", "unsigned", "positive", "negative", "midpoint", "pattern", "occupancy", "zero", "rows"];
const CLIP_NAME = ["none", "low", "high", "exact-low", "exact-high"];

function exposure(z, end = Infinity) {
  const dt = Math.max(0, Math.min((z.c + 1) * TS, BOUNDS[1], CUT, end) - Math.max(z.c * TS, BOUNDS[0]));
  const dp = Math.max(0, Math.min((z.r + 1) * PS, BOUNDS[3]) - Math.max(z.r * PS, BOUNDS[2]));
  return { seconds: dt * GEOM.BASE, width: dp * GEOM.PR };
}

// 5 columns x 9 rows of cells, seeded; some with nothing to divide by (v 0, ct 0) and the rest inside what the
// cell's own exposure allows (dwell <= covered seconds).
function cellsFixture(seed) {
  const next = mulberry32(seed);
  const out = [];
  for (let c = 200; c <= 204; c++) {
    for (let r = 199; r <= 207; r++) {
      if ((c === 204 && r !== 203) || (r === 199 && c !== 201)) continue;
      const v = Math.pow(10, next() * 6);
      const ct = 1 + Math.floor(next() * 500);
      const ex = exposure({ c, r }, END);
      out.push({ c, r, v, bv: v * next(), ct, bt: Math.floor(next() * (ct + 1)), p: next() * 40, w: next() * ex.seconds });
    }
  }
  out.push({ c: 202, r: 210, v: 0, bv: 0, ct: 0, bt: 0, p: 0, w: 0 });
  out.push({ c: 203, r: 210, v: 0, bv: 0, ct: 3, bt: 0, p: 0, w: 0 });
  return out;
}
const CELLS = cellsFixture(2026);

// The Cascade entry of a stub level: columns 0 mod 2 have a complete parent and a child, 1 mod 4 a parent with
// no child volume, 3 mod 4 a waiting (open) parent.
const PARENT = 4e6;
function cascadeEntry(z, out) {
  out.reason = null;
  out.denominator = null;
  if (z.v <= 0) {
    out.tag = TAG["negative-infinite"];
    out.value = NaN;
    out.reason = "no current volume";
  } else if (z.c % 2 === 0) {
    out.tag = TAG["finite"];
    out.value = Math.log2((4 * z.v) / PARENT);
  } else if (z.c % 4 === 1) {
    out.tag = TAG["negative-infinite"];
    out.value = NaN;
    out.reason = "no current volume";
  } else {
    out.tag = TAG["waiting-for-complete-parent"];
    out.value = NaN;
  }
}

// One row per (mode, basis): the hand-coded value of a cell, or null where the measure is not a value.
const perRate = (amount, z, end) => {
  const e = exposure(z, end);
  return e.seconds <= 0 || e.width <= 0 ? null : (amount * 60 * 125) / (e.seconds * e.width);
};
const ROWS = [
  { mode: "volume", basis: "amount", value: (z) => z.v },
  { mode: "volume", basis: "intensity", value: (z) => perRate(z.v, z) },
  { mode: "trades", basis: "amount", value: (z) => z.ct },
  { mode: "trades", basis: "intensity", value: (z) => perRate(z.ct, z) },
  { mode: "delta", basis: "amount", value: (z) => 2 * z.bv - z.v },
  { mode: "delta", basis: "intensity", value: (z) => perRate(2 * z.bv - z.v, z) },
  { mode: "size", basis: "mean", value: (z) => (z.ct === 0 ? null : z.v / z.ct) },
  { mode: "path", pathBasis: "spans", end: END, value: (z) => { const e = exposure(z, END); return e.width <= 0 ? null : z.p / e.width; } },
  { mode: "path", pathBasis: "usdt", end: END, value: (z) => z.p },
  { mode: "path", pathBasis: "perMinute", end: END, value: (z) => { const e = exposure(z, END); return e.seconds <= 0 || e.width <= 0 ? null : (60 * z.p) / (e.width * e.seconds); } },
  { mode: "flow", basis: "share", value: (z) => (z.v <= 0 ? null : z.bv / z.v) },
  { mode: "flowtrades", basis: "share", value: (z) => (z.ct <= 0 ? null : z.bt / z.ct) },
  { mode: "dwell", basis: "share", end: END, value: (z) => { const e = exposure(z, END); return e.seconds <= 0 ? null : z.w / e.seconds; } },
  { mode: "cascade", basis: "log2", cascade: cascadeEntry, value: (z) => (z.v > 0 && z.c % 2 === 0 ? Math.log2((4 * z.v) / PARENT) : null) },
  { mode: "geometry", basis: undefined, value: () => undefined },
  { mode: "candles", basis: undefined, value: () => undefined },
];

// Hand-coded transfer functions: the coordinate of a value under a descriptor, clipped to the window.
function tOf(desc, x) {
  const p = desc.params;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  switch (desc.kind) {
    case "value-log1p":
      return (desc.signed ? sign : 1) * Math.min(1, Math.log1p(a / p.k) / Math.log1p(p.U / p.k));
    case "value-linear":
      return (desc.signed ? sign : 1) * Math.min(1, a / p.U);
    case "fixed-linear":
      return Math.min(1, Math.max(0, (x - p.lo) / (p.hi - p.lo)));
    case "fixed-diverging":
      return Math.min(1, Math.max(-1, x >= p.mid ? (x - p.mid) / (p.hi - p.mid) : (x - p.mid) / (p.mid - p.lo)));
    default:
      return null; // rank: the structure is checked, the value is not recomputed here
  }
}
const idxOf = (t) => Math.round(Math.min(1, Math.abs(t)) * 255);

// A hand-written scan for U and the Type-7 median of the nonzero magnitudes (d3 as the second opinion).
function handUK(values) {
  const mags = values.filter((x) => x !== 0).map(Math.abs).sort((a, b) => a - b);
  const n = mags.length;
  const med = n % 2 === 1 ? mags[(n - 1) / 2] : (mags[n / 2 - 1] + mags[n / 2]) / 2;
  assert.ok(Math.abs(med - d3.quantileSorted(mags, 0.5)) <= 1e-12 * med, "the two Type-7 medians agree");
  return { U: mags[n - 1], k: med };
}

// The descriptors a mode is offered with: its fixed window, or Value (log and linear) and, where the mode
// has a rank, Rank; fitted on the hand-coded values of the synthetic cohort.
function descriptorsOf(row, values) {
  const info = E.measure.MODES[row.mode];
  if (info.kind === "occupancy") return [{ name: "occupancy", desc: null }];
  if (info.kind === "fixed") {
    const f = E.scale.fixed(info.fixed.kind);
    // the catalogue's window, as written in API.md B.3: share 0..1 about 0.5, dwell 0..1, log2 -2..2 about 0
    assert.equal(f.params.lo, info.fixed.lo);
    assert.equal(f.params.hi, info.fixed.hi);
    return [{ name: info.fixed.kind, desc: f }];
  }
  const list = [];
  const signed = info.signed;
  const log = E.scale.fitValue({ values: Float64Array.from(values) }, { signed });
  assert.equal(log.state, "ok", row.mode);
  const uk = handUK(values);
  assert.equal(log.descriptor.params.U, uk.U, row.mode + ": U is the largest magnitude");
  assert.ok(Math.abs(log.descriptor.params.k - uk.k) <= 1e-12 * uk.k, row.mode + ": k is the Type-7 median of the nonzero magnitudes");
  list.push({ name: "value-log", desc: log.descriptor });
  list.push({ name: "value-linear", desc: E.scale.fitValue({ values: Float64Array.from(values) }, { signed, linear: true }).descriptor });
  if (info.rank) {
    const rank = E.scale.fitRank({ values: Float64Array.from(values) });
    assert.equal(rank.state, "ok");
    list.push({ name: "rank", desc: rank.descriptor });
  }
  return list;
}

const LUTS = { light: E.lut.build("slate2", "light"), dark: E.lut.build("slate2", "dark") };

function specOf(row, desc, theme) {
  const fixedMode = E.measure.MODES[row.mode].kind !== "unbounded";
  return {
    mode: row.mode,
    basis: row.basis,
    pathBasis: row.pathBasis,
    level: LEVEL,
    bounds: BOUNDS,
    cut: CUT,
    end: row.end,
    geom: GEOM,
    CUT: LIVE,
    replay: false,
    mapping: ["geometry", "candles"].includes(row.mode) ? null : fixedMode ? desc : { state: "ok", desc, policy: "explore", origin: "fit" },
    lut: LUTS[theme],
    cascade: row.cascade || null,
    observation: { source: "fixture", instrument: "BTC/USDT", read: "cube", cutoffMs: 1790251320000, liveCutoffMs: 1790251320000, canonicalThroughMs: 1790208000000, token: null, provenance: [] },
  };
}

const rgbOf = (css) => [parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16)];
function pixel(pixels, x) {
  return [pixels[x * 4], pixels[x * 4 + 1], pixels[x * 4 + 2]];
}

// ---- the smoke -------------------------------------------------------------------------------------------

test("the smoke table covers every mode of E.measure.MODES and every basis each mode offers", () => {
  const seen = {};
  for (const r of ROWS) (seen[r.mode] = seen[r.mode] || new Set()).add(r.basis === undefined ? r.pathBasis : r.basis);
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(E.measure.MODES).sort(), "a new mode needs a row here");
  for (const [mode, info] of Object.entries(E.measure.MODES)) {
    if (info.kind === "occupancy") continue;
    // the path bases are named spans, usdt and perMinute; every other mode names its basis
    for (const b of info.bases) assert.ok(seen[mode].has(b), `${mode} offers ${b} and the smoke has no row for it`);
  }
});

for (const theme of ["light", "dark"]) {
  for (const row of ROWS) {
    const label = `${row.mode}${row.basis ? " " + row.basis : row.pathBasis ? " " + row.pathBasis : ""}`;
    const values = CELLS.map(row.value).filter((x) => x !== null && x !== undefined && Number.isFinite(x));
    const handValue = ["geometry", "candles"].includes(row.mode) ? null : values;

    for (const variant of ["geometry", "candles"].includes(row.mode) ? [{ name: "occupancy", desc: null }] : descriptorsOf(row, handValue)) {
      test(`smoke (${theme}): ${label} / ${variant.name}: encode, readout and legend marker are one index, one coordinate, one colour`, () => {
        const spec = specOf(row, variant.desc, theme);
        const frame = E.readout.cellsFrame(spec);
        const legend = E.legend.build(frame, null, null, {});
        const lut = LUTS[theme];
        const tally = E.warn.tally();
        const out = {};
        const signedBar = variant.desc !== null && variant.desc.signed;
        const pixels = legend.bar.role === "outline" ? null : E.legend.barPixels(legend, signedBar ? 511 : 256);
        let drawn = 0;
        let defined = 0;
        let nonvalue = 0;
        const seenIdx = new Map(); // t -> idx, to check monotonicity of a rank by the value order

        for (const z of CELLS) {
          frame.encode(z, out);
          const r = frame.readout(z);
          const marker = E.legend.marker(legend, r);
          const want = row.value(z);
          E.result.assertJsonSafe(r);

          if (["geometry", "candles"].includes(row.mode)) {
            // an outline: the occupancy role, no measurement, no coordinate, no marker
            assert.equal(ROLE_NAME[out.role], "occupancy");
            assert.equal(out.css, lut.occupancy.css);
            assert.equal(r.coordinate, null);
            assert.equal(marker, null, "an outline has no marker");
            drawn++;
            continue;
          }
          if (want === null) {
            // a non-value: a pattern or nothing, never a colour, and no place on the bar
            nonvalue++;
            assert.notEqual(out.tag, 0, `${label} ${z.c},${z.r}: a typed non-value`);
            assert.equal(out.css, null);
            assert.equal(out.idx, -1);
            assert.equal(r.coordinate, null);
            assert.equal(marker, null, "a non-value sits nowhere on the bar");
            continue;
          }
          defined++;
          assert.equal(out.tag, 0, `${label} ${z.c},${z.r}`);
          assert.ok(Math.abs(out.value - want) <= 1e-12 * Math.abs(want) + 1e-12, `${label} ${z.c},${z.r}: value ${out.value} vs hand ${want}`);
          tally.addBox(z.c * 10, z.r * 10, z.c * 10 + 8, z.r * 10 + 8, { plot: { x0: 0, y0: 0, x1: 1e6, y1: 1e6 }, meas: null }, out.idx, out.clip, true, out.value !== 0);

          // the coordinate by the hand-coded transfer function (rank: only its range)
          const t = tOf(variant.desc, out.value);
          if (t !== null) {
            assert.ok(Math.abs(out.t - t) <= 1e-12, `${label}: t ${out.t} vs hand ${t}`);
          } else {
            assert.ok(out.t >= 0 && out.t <= 1, "a rank coordinate is in 0..1");
          }

          // one record, three consumers: the encoder, the readout and the legend marker
          assert.ok(marker !== null, `${label} ${z.c},${z.r}: a value has a marker`);
          assert.equal(r.coordinate.t, out.t);
          assert.equal(marker.t, out.t, "the marker is the record's coordinate");
          assert.equal(marker.clip, CLIP_NAME[out.clip]);
          assert.equal(r.coordinate.clip, CLIP_NAME[out.clip]);
          assert.equal(marker.p, signedBar ? (out.t + 1) / 2 : out.t, "the position along the bar");

          if (out.role === E.readout.ROLE.ZERO) {
            // zero is keyed separately: no index, the outline colour, and its place is the start of the bar
            assert.equal(out.idx, -1);
            assert.equal(r.coordinate.idx, -1);
            assert.equal(out.css, lut.occupancy.css);
            assert.equal(marker.t, 0);
            continue;
          }
          drawn++;
          // encode idx == readout idx == the index of the marker's tick
          const markerIdx = idxOf(marker.t);
          if (signedBar && marker.t === 0) {
            assert.equal(out.role, E.readout.ROLE.MIDPOINT);
            assert.equal(out.idx, 0);
          } else {
            assert.equal(out.idx, markerIdx, `${label} ${z.c},${z.r}: encode index ${out.idx}, marker tick ${markerIdx}`);
          }
          assert.equal(r.coordinate.idx, out.idx, "the readout's index is the encoder's");
          assert.equal(r.coordinate.role, ROLE_NAME[out.role]);
          if (t !== null) assert.equal(out.idx, idxOf(t), "and the hand-coded index");

          // the colour the encoder chose is the colour the legend's bar shows at the marker's position
          const arm = out.role === E.readout.ROLE.NEGATIVE ? lut.negative : out.role === E.readout.ROLE.POSITIVE ? lut.positive : lut.unsigned;
          if (out.role === E.readout.ROLE.MIDPOINT) {
            assert.equal(out.css, lut.midpoint.css);
            assert.deepEqual(pixel(pixels, 255), rgbOf(lut.midpoint.css), "the bar's middle pixel");
          } else {
            assert.equal(out.css, arm.css[out.idx], "the colour is the LUT entry of the role and index");
            const x = signedBar ? (out.role === E.readout.ROLE.NEGATIVE ? 255 - out.idx : 255 + out.idx) : out.idx;
            assert.deepEqual(pixel(pixels, x), rgbOf(out.css), `${label} ${z.c},${z.r}: the bar pixel at the marker (x ${x}) is the cell's colour`);
            assert.deepEqual(Array.from(arm.rgb.slice(out.idx * 3, out.idx * 3 + 3)), rgbOf(out.css), "the LUT bytes agree with its strings");
          }
          if (variant.name === "rank") seenIdx.set(out.value, out.t);
        }

        if (!["geometry", "candles"].includes(row.mode)) {
          assert.ok(defined >= 8, `${label}: the cohort exercises values (${defined})`);
          assert.ok(nonvalue + defined === CELLS.length, "every cell is one or the other");
        } else assert.equal(drawn, CELLS.length);

        // a rank coordinate never decreases with the value
        if (variant.name === "rank") {
          let last = -1;
          for (const [, t] of [...seenIdx.entries()].sort((a, b) => a[0] - b[0])) {
            assert.ok(t >= last, "rank is monotone in the value");
            last = t;
          }
        }

        // the ticks of the legend sit where the hand-coded transfer function puts their values
        if (variant.desc !== null) {
          for (const tick of legend.bar.ticks) {
            const hand = tOf(variant.desc, tick.value);
            if (hand !== null) assert.ok(Math.abs(tick.t - hand) <= 1e-12, `${label} tick ${tick.kind} ${tick.value}: ${tick.t} vs hand ${hand}`);
            else if (tick.q !== undefined) {
              // a rank tick carries the knot's value; a value that fills several knots (repeated values of a
              // count measure) sits at the middle of its group, (first + last) / 512 (issue #46 section 3)
              const knots = variant.desc.params.knots;
              const at = [];
              knots.forEach((kv, j) => kv === tick.value && at.push(j));
              const handRank = (at[0] + at[at.length - 1]) / 512;
              assert.ok(Math.abs(tick.t - handRank) <= 1e-12, `${label} rank tick q ${tick.q}: ${tick.t} vs hand ${handRank}`);
            }
          }
          // the bar: the left and right end pixels are the ends of the ramp
          if (pixels !== null) {
            const arms = signedBar ? [[0, lut.negative.css[255]], [510, lut.positive.css[255]], [255, lut.midpoint.css]] : [[0, lut.unsigned.css[0]], [255, lut.unsigned.css[255]]];
            for (const [x, css] of arms) assert.deepEqual(pixel(pixels, x), rgbOf(css), `${label}: bar pixel ${x}`);
          }
        }

        // the tally of the pass and the legend built from its report stay consistent with the cohort
        const report = E.warn.evaluate(tally, { meaningful: E.measure.MODES[row.mode].kind === "unbounded" });
        assert.equal(report.counts.marks, defined);
        const again = E.legend.build(frame, report, null, {});
        assert.equal(again.channel, "cells");
        assert.equal(E.legend.chip(again).state, again.state);
        E.result.assertJsonSafe(plain(again));
        // the same legend twice is byte-equal (pure)
        assert.equal(JSON.stringify(E.legend.build(frame, report, null, {})), JSON.stringify(again));
      });
    }
  }
}

test("the two themes encode the same indices and differ in colour: the LUT is read, not the theme's name", () => {
  for (const row of ROWS.filter((r) => r.mode === "volume" && r.basis === "amount" || r.mode === "delta" && r.basis === "amount" || r.mode === "flow")) {
    const values = CELLS.map(row.value).filter((x) => x !== null && Number.isFinite(x));
    const desc = descriptorsOf(row, values)[0].desc;
    const light = E.readout.cellsFrame(specOf(row, desc, "light"));
    const dark = E.readout.cellsFrame(specOf(row, desc, "dark"));
    assert.notEqual(light.fingerprint(), dark.fingerprint(), "the fingerprint includes the LUT");
    const a = {};
    const b = {};
    let differ = 0;
    for (const z of CELLS) {
      light.encode(z, a);
      dark.encode(z, b);
      assert.equal(a.idx, b.idx, row.mode + ": the index does not depend on the theme");
      assert.equal(a.t, b.t);
      assert.equal(a.role, b.role);
      if (a.css !== b.css) differ++;
    }
    assert.ok(differ > 0, row.mode + ": some colour differs between themes");
  }
});

// ---- Rows and panes ---------------------------------------------------------------------------------------

test("smoke: a Rows frame and a pane frame through the same chain (marker, index and bar agree) for each unbounded Rows measure and each column measure", () => {
  const theme = "light";
  const lut = LUTS[theme];
  // Rows: volume, delta, time at a period; the band role is the raw Rows colour (DD-86), so the index is the
  // coordinate's and the legend shows the composite
  const rowsData = Array.from({ length: 24 }, (_, i) => ({ r: 100 + i, v: Math.pow(10, 3 + (i % 7)), bv: Math.pow(10, 3 + (i % 7)) * ((i % 5) / 4), w: 60 * (1 + (i % 9)) }));
  const rowValue = { volume: (z) => z.v, delta: (z) => 2 * z.bv - z.v, time: (z) => z.w };
  for (const kind of ["volume", "delta", "time"]) {
    const info = E.measure.ROWS[kind];
    const values = rowsData.map(rowValue[kind]);
    const fit = E.scale.fitValue({ values: Float64Array.from(values) }, { signed: info.signed });
    const frame = E.readout.rowsFrame({ kind, rowSize: 3, mapping: { state: "ok", desc: fit.descriptor, policy: "explore" }, lut, info: { period: "roll:90", quality: "exact" } });
    const legend = E.legend.build(frame, null, null, {});
    const out = {};
    for (const z of rowsData) {
      frame.encode(z, out);
      const r = frame.readout(z);
      const marker = E.legend.marker(legend, r);
      const t = tOf(fit.descriptor, rowValue[kind](z));
      assert.ok(Math.abs(out.t - t) <= 1e-12, `rows ${kind}: t`);
      assert.equal(out.idx === -1 ? 0 : out.idx, out.idx === -1 ? 0 : idxOf(t), `rows ${kind}: index`);
      if (r.coordinate !== null) {
        assert.equal(r.coordinate.idx, out.idx);
        assert.equal(marker.t, out.t);
      }
    }
  }
  // columns: every key with a registered axis, through the registry's record
  const cols = [
    ["volume", "pane.volume", { v: 1234 }, 1234],
    ["trades", "pane.trades", { ct: 77 }, 77],
    ["delta", "pane.delta", { v: 300, bv: 100 }, -100],
    ["size", "pane.size", { v: 900, ct: 3 }, 300],
  ];
  for (const [key, id, col, value] of cols) {
    const sign = E.axis.CATALOGUE[id].sign;
    const M = Math.max(Math.abs(value) * 2, 1);
    const record = E.axis.registry().frame(id, { cutMs: 1e12, now: 0, eligible: true, held: {}, sig: "s", summary: () => ({ count: 3, max: M, min: sign === "unsigned" ? 0 : -M }) });
    const frame = E.readout.paneFrame({ key, axis: record, lut });
    const legend = E.legend.build(frame, null, null, {});
    const out = {};
    frame.encode(col, out);
    assert.equal(out.value, value, key);
    const r = frame.readout(col);
    const marker = E.legend.marker(legend, r);
    assert.equal(marker.t, out.t, key + ": the marker is the bar's coordinate");
    assert.ok(Math.abs(out.t - value / M) <= 1e-15, key + ": the closed form x / max");
    assert.equal(r.coordinate.idx, out.idx);
    const tick = legend.bar.ticks.find((x) => x.kind === "end" && x.value === M);
    assert.ok(tick && tick.t === 1, key + ": the top tick sits at the end of the bar");
  }
});
