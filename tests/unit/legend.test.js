"use strict";
// U20 (T-legend): E.legend of src/encoding.js, loaded through tests/support/enc.js. The generated legend
// (API.md B.11, S1-019, S1-160, DD-45, DD-90, DD-94): its samples are the encoder's colours, its ticks sit
// at the true transform positions, its keys count the non-values, its bar pixels are the Lut bytes.
//
// Oracles (none is the code under test):
//   1. Hand vectors from the design: k = 48211.3 of U = 26791234.56 sits at t = log1p(1) / log1p(U/k) =
//      0.1096 (API.md B.11, A.2); the mapping id of that descriptor is 3s_XdONgi8CSqyOl (API.md B.5).
//   2. The Lut of part 11 (E.lut.build; its bytes are pinned against d3 in U18): every expected colour is
//      `lut[role].css[index]` or `.rgb` with the index of a hand-coded round(|t| * 255).
//   3. A source-over composite written out by hand for the Rows projection: the raw Lut colour at alpha
//      0.16 over the surface, within one channel value of E.lut.composite (the canvas paints the raw colour
//      at globalAlpha, the legend shows the composite; DD-86).
//   4. The strings of E.text (part 04; its own test holds the English) and a test formatter `compact`
//      (k / M / B, percent) written here.
// Tests that need part 17-warn (E.warn feeds the warnings) are t.todo while it is absent and must turn green
// at assembly. The module may run in a vm context (ENCODING_PARTS_DIR): records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;
// The module may be of another realm: compare its structures through JSON.
const deq = (actual, expected, message) => assert.deepEqual(actual === undefined ? actual : plain(actual), expected, message);

// ---- fixtures -------------------------------------------------------------------------------------------

const GEOM = { BASE: 56.25, PR: 125 };
const LEVEL = { n: 4, m: 1 };
const U = 26791234.56;
const K = 48211.3;
const LOGU = E.scale.manual({ kind: "value-log1p", signed: false, U, k: K }).descriptor;
const LOGS = E.scale.manual({ kind: "value-log1p", signed: true, U: 1204551.25, k: 8830.5 }).descriptor;
const LINU = E.scale.manual({ kind: "value-linear", signed: false, U: 1000 }).descriptor;
const SHARE = E.scale.fixed("share-diverging");
const DWELL = E.scale.fixed("unsigned-share");
const LOG2 = E.scale.fixed("log2-ratio");
const LUTS = { light: E.lut.build("slate2", "light"), dark: E.lut.build("slate2", "dark") };
const SURFACE = { light: [255, 255, 255], dark: [0x16, 0x1f, 0x19] };

// The test formatter: k / M / B for amounts, percent for shares, plain otherwise.
function compact(v, unit) {
  if (unit === "share") return String(Number((v * 100).toFixed(1))) + "%";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + " B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + " M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + " k";
  return String(Number(v.toPrecision(3)));
}

const idxOf = (t) => Math.round(Math.min(1, Math.abs(t)) * 255);

function cellsSpec(mode, desc, theme = "light", extra = {}) {
  const fixed = mode === "flow" || mode === "flowtrades" || mode === "dwell" || mode === "cascade";
  return Object.assign(
    {
      mode,
      basis: mode === "flow" || mode === "flowtrades" || mode === "dwell" ? "share" : mode === "cascade" ? "log2" : "amount",
      level: LEVEL,
      bounds: [3200, 3264, 400, 416],
      cut: 3250,
      end: 3300,
      geom: GEOM,
      CUT: 3258,
      mapping: fixed ? desc : { state: "ok", desc, policy: "explore", origin: "fit" },
      lut: LUTS[theme],
    },
    extra,
  );
}
const cells = (mode, desc, theme, extra) => E.readout.cellsFrame(cellsSpec(mode, desc, theme, extra));
const volume = (theme, extra) => cells("volume", LOGU, theme, extra);

const RECORD = {
  v: 1,
  key: "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n4m1",
  desc: LOGU,
  policy: "explore",
  origin: "fit",
  cohort: { kind: "cells", n: 1523, zeros: 0, nonzero: 1523, excluded: { partial: 41, open: 2 }, calibratedOn: "view" },
  obsEndMs: 1790251320000,
};

// ---- the bar: samples, ticks, positions ------------------------------------------------------------------------

test("T-legend: a Value legend has 33 samples that ARE the Lut at each coordinate, and ticks at 0, k and U at their true transform positions", () => {
  for (const theme of ["light", "dark"]) {
    const legend = E.legend.build(volume(theme), null, compact, {});
    assert.equal(legend.bar.role, "unsigned");
    assert.equal(legend.bar.samples.length, 33);
    legend.bar.samples.forEach((s, i) => {
      assert.equal(s.t, i / 32, "the sample coordinate");
      assert.equal(s.css, LUTS[theme].unsigned.css[idxOf(i / 32)], `sample ${i}`);
    });
    const ticks = legend.bar.ticks;
    deq(ticks.map((t) => t.kind), ["end", "k", "end"]);
    deq(ticks.map((t) => t.value), [0, K, U]);
    // k sits at t = log1p(1) / log1p(U/k) = 0.1096 (hand vector of the design), not at the quantile position.
    const tk = Math.log1p(1) / Math.log1p(U / K);
    assert.equal(Math.round(tk * 10000) / 10000, 0.1096);
    assert.ok(Math.abs(ticks[1].t - tk) < 1e-15, `k tick ${ticks[1].t} vs ${tk}`);
    assert.equal(ticks[0].t, 0);
    assert.equal(ticks[2].t, 1);
    deq(ticks.map((t) => t.label), ["0", "48.2 k", "26.8 M"], "labels come from the injected formatter");
    assert.equal(legend.bar.midpoint, null);
  }
  assert.equal(E.scale.id(LOGU), "3s_XdONgi8CSqyOl", "the design's mapping id for this descriptor");
});

test("T-legend: the colour at each tick is the encoder's colour for the tick's value (legend = encoder by construction)", () => {
  const frame = volume("light");
  const legend = E.legend.build(frame, null, compact, {});
  const out = {};
  for (const tick of legend.bar.ticks) {
    if (tick.value === 0) continue; // zero is the zero role (an outline), not a ramp entry
    frame.encode({ c: 201, r: 203, v: tick.value, bv: 0, ct: 1, bt: 0 }, out);
    assert.equal(out.css, LUTS.light.unsigned.css[idxOf(tick.t)], `tick ${tick.kind}`);
    assert.equal(out.css, legend.bar.ramps.unsigned[idxOf(tick.t)]);
  }
  // A linear Value scale: ticks at 0, U/2 and U; the coordinate is the plain fraction.
  const lin = E.legend.build(cells("volume", LINU), null, compact, {});
  deq(lin.bar.ticks.map((t) => [t.value, t.t]), [[0, 0], [500, 0.5], [1000, 1]]);
});

test("T-legend: a signed Delta bar has its zero at the midpoint colour in the middle, arms either side, ticks at -U -k 0 k U", () => {
  const legend = E.legend.build(cells("delta", LOGS, "dark"), null, compact, {});
  assert.equal(legend.bar.role, "signed");
  assert.equal(legend.bar.midpoint, 0.5);
  assert.equal(legend.bar.samples[16].t, 0);
  assert.equal(legend.bar.samples[16].css, LUTS.dark.midpoint.css, "Delta zero is drawn at the midpoint");
  legend.bar.samples.forEach((s, i) => {
    const t = (2 * i) / 32 - 1;
    assert.equal(s.t, t);
    const want = t < 0 ? LUTS.dark.negative.css[idxOf(t)] : t > 0 ? LUTS.dark.positive.css[idxOf(t)] : LUTS.dark.midpoint.css;
    assert.equal(s.css, want, `sample ${i}`);
  });
  assert.equal(legend.bar.samples[0].css, LUTS.dark.negative.css[255], "the far end of the negative arm");
  assert.equal(legend.bar.samples[32].css, LUTS.dark.positive.css[255]);
  const ticks = legend.bar.ticks;
  deq(ticks.map((t) => t.value), [-1204551.25, -8830.5, 0, 8830.5, 1204551.25]);
  assert.equal(ticks[2].t, 0);
  assert.equal(ticks[2].p, 0.5);
  assert.ok(Math.abs(ticks[3].t - Math.log1p(1) / Math.log1p(1204551.25 / 8830.5)) < 1e-15, "k of the positive arm");
  assert.equal(ticks[0].p, 0);
  assert.equal(ticks[4].p, 1);
  // Arm entry 0 is the midpoint colour: the arms start at it.
  deq(Array.from(LUTS.dark.positive.rgb.slice(0, 3)), Array.from(LUTS.dark.midpoint.rgb));
  deq(Array.from(LUTS.dark.negative.rgb.slice(0, 3)), Array.from(LUTS.dark.midpoint.rgb));
});

test("T-legend: the ratio axis has its five ticks 1/4x .. 4x at t = -1 .. 1 and the +1 tick takes index 128", () => {
  const frame = cells("cascade", LOG2);
  const legend = E.legend.build(frame, null, compact, {});
  assert.equal(legend.bar.role, "fixed");
  const ticks = legend.bar.ticks;
  deq(ticks.map((t) => t.label), ["1/4×", "1/2×", "1×", "2×", "4×"]);
  deq(ticks.map((t) => t.value), [-2, -1, 0, 1, 2]);
  deq(ticks.map((t) => t.t), [-1, -0.5, 0, 0.5, 1]);
  deq(ticks.map((t) => t.p), [0, 0.25, 0.5, 0.75, 1]);
  const out = {};
  const entry = (value) => (z, o) => {
    o.tag = 0;
    o.value = value;
    o.reason = null;
    o.denominator = null;
  };
  const colourOf = (value) => {
    E.readout.cellsFrame(cellsSpec("cascade", LOG2, "light", { cascade: entry(value) })).encode({ c: 1, r: 1 }, out);
    return out.css;
  };
  assert.equal(colourOf(1), LUTS.light.positive.css[128], "+1 is half of the positive arm, never +2's colour");
  assert.equal(colourOf(-1), LUTS.light.negative.css[128]);
  assert.equal(colourOf(2), LUTS.light.positive.css[255]);
  assert.equal(colourOf(-2), LUTS.light.negative.css[255]);
  assert.equal(colourOf(0), LUTS.light.midpoint.css);
  assert.equal(legend.bar.samples[24].css, LUTS.light.positive.css[128], "the sample at the 2x tick");
});

test("T-legend: a share legend ticks 0, 50 and 100 percent; Dwell is an unsigned 0..100 percent bar", () => {
  const flow = E.legend.build(cells("flow", SHARE), null, compact, {});
  deq(flow.bar.ticks.map((t) => t.label), ["0%", "50%", "100%"]);
  deq(flow.bar.ticks.map((t) => t.t), [-1, 0, 1], "share 0.5 is the midpoint of the signed arms");
  assert.equal(flow.bar.midpoint, 0.5);
  assert.equal(flow.summary.transform, "Fixed scale");
  assert.equal(flow.summary.policy, "Fixed scale");
  assert.equal(flow.state, "fixed");
  const dwell = E.legend.build(cells("dwell", DWELL), null, compact, {});
  deq(dwell.bar.ticks.map((t) => [t.label, t.t]), [["0%", 0], ["50%", 0.5], ["100%", 1]]);
  assert.equal(dwell.bar.role, "fixed");
  assert.equal(dwell.bar.midpoint, null);
  assert.equal(dwell.bar.samples[16].css, LUTS.light.unsigned.css[128]);
  // A manual narrower window keeps the measure's kind: its ticks are its own ends.
  const narrow = E.scale.fixed("share-diverging", [0.45, 0.55]);
  const w = E.legend.build(cells("flow", narrow), null, compact, {});
  deq(w.bar.ticks.map((t) => t.value), [0.45, 0.5, 0.55]);
  deq(w.bar.ticks.map((t) => t.t), [-1, 0, 1]);
});

test("T-legend: a Rank legend is placed at its knots (the quarter quantiles), never at positions invented for values", () => {
  const values = Array.from({ length: 1000 }, (_, i) => i + 1);
  const desc = E.scale.fitRank(values).descriptor;
  const legend = E.legend.build(cells("volume", desc), null, compact, {});
  const knots = desc.params.knots;
  deq(legend.bar.ticks.map((t) => t.q), [0, 0.25, 0.5, 0.75, 1]);
  deq(legend.bar.ticks.map((t) => t.value), [knots[0], knots[64], knots[128], knots[192], knots[256]]);
  legend.bar.ticks.forEach((t) => assert.ok(Math.abs(t.t - t.q) < 1e-12, `the knot of q ${t.q} sits at t = q: ${t.t}`));
  assert.equal(legend.summary.transform, "Relative rank");
  assert.match(legend.summary.calibration, /257 knots/);
});

test("T-legend: a zero-only calibration has only its zero tick and says so; No calibration has no bar colours but the outline", () => {
  const zero = E.legend.build(cells("volume", E.scale.zeroOnly(false)), null, compact, {});
  assert.equal(zero.state, "zero-only");
  deq(zero.bar.ticks.map((t) => t.value), [0]);
  assert.ok(zero.warnings.some((w) => w.id === "zero-only" && w.text === E.text.state.zeroOnly && w.actions.includes("fit")));
  const none = E.legend.build(cells("volume", null, "light", { mapping: { state: "no-calibration", desc: null } }), null, compact, {});
  assert.equal(none.state, "no-calibration");
  assert.equal(none.bar.role, "outline");
  deq(none.bar.ticks, []);
  assert.ok(none.bar.samples.every((s) => s.css === LUTS.light.occupancy.css));
  assert.equal(none.summary.calibration, E.text.state.noCalibration);
  assert.ok(none.warnings.some((w) => w.id === "no-calibration"));
  assert.equal(E.legend.chip(none).state, "no-calibration");
});

test("T-legend: Geometry and movement outlines are the occupancy role, with the one occupied key", () => {
  const geo = E.readout.cellsFrame({ mode: "geometry", level: LEVEL, bounds: [0, 1, 0, 1], geom: GEOM, mapping: null, lut: LUTS.dark });
  const legend = E.legend.build(geo, null, compact, {});
  assert.equal(legend.bar.role, "outline");
  assert.equal(legend.state, "outline");
  assert.ok(legend.bar.samples.every((s) => s.css === LUTS.dark.occupancy.css));
  deq(legend.keys.map((k) => k.id), ["occupied"]);
  assert.equal(legend.keys[0].glyph, "outline");
  assert.equal(legend.keys[0].role, "occupancy");
  assert.equal(legend.keys[0].label, E.text.key.outline);
  assert.equal(legend.summary.scaleId, "");
});

// ---- Rows: the composite ------------------------------------------------------------------------------------------------

test("T-legend: a Rows legend samples the COMPOSITE of the raw rows role at the fixed alpha over the surface (the named rows-projection role)", () => {
  for (const theme of ["light", "dark"]) {
    const desc = E.scale.manual({ kind: "value-log1p", signed: false, U: 1e9, k: 1e6 }).descriptor;
    const frame = E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc, policy: "explore" }, lut: LUTS[theme], surface: SURFACE[theme] });
    const legend = E.legend.build(frame, null, compact, {});
    assert.equal(legend.bar.role, "rows-projection");
    assert.equal(E.lut.ROWS_ALPHA, 0.16);
    const composite = E.lut.composite("rows", 0.16, SURFACE[theme], LUTS[theme]);
    deq(plain(legend.bar.ramps.unsigned), plain(composite.css), "every entry is E.lut.composite");
    legend.bar.samples.forEach((s, i) => assert.equal(s.css, composite.css[idxOf(i / 32)], `sample ${i}`));
    // By hand: raw role colour at alpha over the surface, within one channel value.
    for (const i of [0, 37, 128, 200, 255]) {
      const raw = LUTS[theme].rows.rgb.slice(i * 3, i * 3 + 3);
      const hex = legend.bar.ramps.unsigned[i];
      for (let c = 0; c < 3; c++) {
        const by = Math.round(0.16 * raw[c] + 0.84 * SURFACE[theme][c]);
        assert.ok(Math.abs(parseInt(hex.slice(1 + 2 * c, 3 + 2 * c), 16) - by) <= 1, `entry ${i} channel ${c}`);
      }
    }
    // The encoder paints the RAW role (at globalAlpha): the legend differs from the raw ramp on purpose.
    const out = {};
    frame.encode({ r: 5, v: 5e7 }, out);
    assert.equal(out.css, LUTS[theme].rows.css[out.idx]);
    assert.notEqual(out.css, legend.bar.ramps.unsigned[out.idx]);
  }
  // Delta bands: the arms composite too, and the midpoint colour composited over the surface.
  const signed = E.scale.manual({ kind: "value-log1p", signed: true, U: 1e9, k: 1e6 }).descriptor;
  const delta = E.readout.rowsFrame({ kind: "delta", rowSize: 3, mapping: { state: "ok", desc: signed }, lut: LUTS.light, surface: SURFACE.light });
  const dl = E.legend.build(delta, null, compact, {});
  assert.equal(dl.bar.role, "rows-projection");
  assert.equal(dl.bar.midpoint, 0.5);
  deq(plain(dl.bar.ramps.positive), plain(E.lut.composite("positive", 0.16, SURFACE.light, LUTS.light).css));
  deq(plain(dl.bar.ramps.negative), plain(E.lut.composite("negative", 0.16, SURFACE.light, LUTS.light).css));
  assert.equal(dl.bar.samples[16].css, "#" + Array.from(E.lut.over(LUTS.light.midpoint.rgb, 0.16, SURFACE.light)).map((x) => x.toString(16).padStart(2, "0")).join(""));
  // Without a surface the legend shows the raw roles and claims no projection colours.
  const raw = E.legend.build(E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc: LOGU }, lut: LUTS.light }), null, compact, {});
  deq(plain(raw.bar.ramps.unsigned), plain(LUTS.light.rows.css));
});

// ---- keys ----------------------------------------------------------------------------------------------------------------------

test("T-legend: the keys of each mode carry a glyph, a role, the E.text label and a count per typed tag; Not defined adds its three tags", () => {
  const counts = { zero: 1, undefined: 2, "empty-population": 3, "no-coarser-parent": 4, pending: 5, failed: 6, unsupported: 7, "invalid-input": 8, "clip-low": 9, "clip-high": 10, "no-calibration": 11 };
  const legend = E.legend.build(volume("light"), null, compact, { counts });
  const byId = Object.fromEntries(legend.keys.map((k) => [k.id, k]));
  deq(legend.keys.map((k) => k.id), ["zero", "undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high", "no-calibration"]);
  assert.equal(byId.zero.count, 1);
  assert.equal(byId.zero.glyph, "zero-outline");
  assert.equal(byId.zero.label, "Zero (occupied)");
  assert.equal(byId.undefined.count, 9, "undefined + empty-population + no-coarser-parent share one swatch and one text");
  assert.equal(byId.undefined.glyph, "pattern-slate");
  assert.equal(byId.undefined.label, "Not defined");
  deq(["pending", "failed", "unsupported", "invalid-input"].map((id) => [byId[id].glyph, byId[id].label, byId[id].count]), [
    ["pattern-dots", "Reading", 5],
    ["pattern-cross", "Failed", 6],
    ["pattern-slash", "Unsupported", 7],
    ["pattern-cross", "Invalid input", 8],
  ]);
  deq([byId["clip-low"].glyph, byId["clip-low"].label, byId["clip-low"].count], ["tri-down", "Below range", 9]);
  deq([byId["clip-high"].glyph, byId["clip-high"].label, byId["clip-high"].count], ["tri-up", "Above range", 10]);
  deq(plain(legend.bar.edges), { low: { glyph: "tri-down", count: 9 }, high: { glyph: "tri-up", count: 10 } });
  assert.equal(byId["no-calibration"].label, "No calibration");
  // Counts the caller did not give are zero (the keys are there for the popover; the footer shows count > 0).
  assert.ok(E.legend.build(volume("light"), null, compact, {}).keys.every((k) => k.count === 0));
  // Delta has no zero key: its zero is the midpoint fill.
  assert.ok(!E.legend.build(cells("delta", LOGS), null, compact, {}).keys.some((k) => k.id === "zero"));
  // Cascade: the parent that runs past the data says "Open" and a child absent from a complete parent has its infinity key.
  const cascade = E.legend.build(cells("cascade", LOG2), null, compact, { counts: { "waiting-for-complete-parent": 2, "negative-infinite": 3, "no-coarser-parent": 4 } });
  const c = Object.fromEntries(cascade.keys.map((k) => [k.id, k]));
  assert.equal(c["waiting-for-complete-parent"].label, "Open");
  assert.equal(c["waiting-for-complete-parent"].count, 2);
  assert.equal(c["negative-infinite"].glyph, "infinity");
  assert.equal(c["negative-infinite"].label, E.text.key.negInf);
  assert.equal(c["negative-infinite"].count, 3);
  assert.equal(c.undefined.count, 4);
  // Relative volume: the typed cases of its v2 definition each have a key.
  const rel = E.readout.rowsFrame({ kind: "relvol", rowSize: 0, mapping: LOG2, lut: LUTS.light, relvol: { at: () => ({ tag: "empty-both" }) } });
  const r = E.legend.build(rel, null, compact, { counts: { "negative-infinite": 1, "no-reference": 2, "empty-both": 3, "outside-support": 4 } });
  const rk = Object.fromEntries(r.keys.map((k) => [k.id, k]));
  deq(["negative-infinite", "no-reference", "empty-both", "outside-support"].map((id) => rk[id].count), [1, 2, 3, 4]);
  assert.equal(rk["no-reference"].label, E.text.key.noRef);
  assert.equal(rk["empty-both"].label, E.text.key.emptyBoth);
  assert.equal(rk["outside-support"].glyph, null, "outside the comparison support has a count and no swatch");
});

test("T-legend: every key has a swatch that E.role.paint can draw, and its label is the E.text string of its key", () => {
  const frames = [volume("light"), cells("cascade", LOG2), cells("flow", SHARE), cells("dwell", DWELL)];
  for (const f of frames) {
    for (const k of E.legend.build(f, null, compact, {}).keys) {
      if (k.glyph !== null) assert.ok(E.role.GLYPHS[k.glyph], `${k.id}: glyph ${k.glyph}`);
      const text = k.key.split(".").reduce((n, part) => n[part], E.text);
      assert.equal(k.label, text, k.id);
    }
  }
});

// ---- summary, chip, details ------------------------------------------------------------------------------------------------------

test("T-legend: the summary names measure, basis, unit, transform, policy, calibration, support and clipping; the chip is the short form", () => {
  const frame = volume("light", { mapping: { state: "ok", record: RECORD, policy: "explore" }, observation: { source: "Binance BTCUSDT spot", cutoffMs: 1790251320000, provenance: [] } });
  const legend = E.legend.build(frame, null, compact, { counts: { "clip-high": 37 }, measureLabel: "Volume" });
  deq(plain(legend.summary), {
    measure: "Volume",
    basis: "Amount",
    unit: "USDT",
    transform: "Value (log)",
    policy: "Explore",
    support: "Calibrated on the view (1523 observations, 43 excluded)",
    calibration: "U 26.8 M · k 48.2 k",
    clipping: "Above range: 37",
    scaleId: "3s_XdONgi8CSqyOl",
    appearance: LUTS.light.id,
    top: "26.8 M",
  });
  const chip = E.legend.chip(legend);
  assert.equal(chip.text, "26.8 M · Value (log) · Explore", "the design's chip text");
  assert.equal(chip.state, "ok");
  assert.equal(chip.label, "Scale: Volume, Amount, USDT, Value (log), Explore, U 26.8 M · k 48.2 k, Calibrated on the view (1523 observations, 43 excluded), Above range: 37");
  // Policies and basis words come from E.text, per measure.
  const intensity = E.legend.build(cells("volume", LOGU, "light", { basis: "intensity" }), null, compact, {});
  assert.equal(intensity.summary.basis, "Intensity");
  assert.equal(intensity.summary.unit, "USDT per minute per 125-USDT price band");
  const path = E.legend.build(cells("path", LOGU, "light", { pathBasis: "perMinute" }), null, compact, {});
  assert.equal(path.summary.basis, "Row spans per minute");
  assert.equal(path.summary.unit, "row spans per minute");
  const manual = E.legend.build(volume("light", { mapping: { state: "ok", desc: LOGU, policy: "comparison", origin: "manual" } }), null, compact, {});
  assert.equal(manual.summary.policy, "Manual domain");
  assert.equal(E.legend.build(volume("light", { mapping: { state: "ok", desc: LOGU, policy: "comparison" } }), null, compact, {}).summary.policy, "Comparison lock");
  assert.equal(E.legend.build(volume("light", { mapping: { state: "ok", desc: LOGU, policy: "auto" } }), null, compact, {}).summary.policy, "Auto color");
});

test("T-legend: the chip carries at most one state token, by priority: No calibration > Updating > range exceeded > Low discrimination > Scale changed", () => {
  const warnBoth = { rangeExceeded: true, lowDiscrimination: "low", shares: { marks: 0.25, area: 0.4, low: 0.95, high: 0 } };
  const note = { causes: ["resolution"], from: "aaa", to: "bbb" };
  const text = (frame, warn, opts) => E.legend.chip(E.legend.build(frame, warn, compact, opts)).text;
  const base = "26.8 M · Value (log) · Explore";
  assert.equal(text(volume("light"), null, {}), base);
  assert.equal(text(volume("light"), warnBoth, { note }), base + " · Scale range exceeded", "range beats low discrimination and the note");
  assert.equal(text(volume("light"), { rangeExceeded: false, lowDiscrimination: "low", shares: { marks: 0, area: 0, low: 0.95, high: 0 } }, { note }), base + " · Low discrimination");
  assert.equal(text(volume("light"), null, { note }), base + " · Scale changed: resolution");
  assert.equal(text(volume("light", { mapping: { state: "updating", desc: LOGU, policy: "explore" } }), warnBoth, { note }), base + " · Updating", "Updating beats the warnings");
  const nc = E.legend.chip(E.legend.build(cells("volume", null, "light", { mapping: { state: "no-calibration", desc: null } }), warnBoth, compact, { note }));
  assert.ok(nc.text.endsWith(E.text.state.noCalibration), "No calibration beats everything");
  // Never two tokens.
  assert.ok(!text(volume("light"), warnBoth, { note }).includes("Low discrimination"));
});

test("T-legend: the details list has the D.18 fields with the formatted text and the canonical value beside it", () => {
  const frame = volume("light", { mapping: { state: "ok", record: RECORD, policy: "explore" }, observation: { source: "Binance BTCUSDT spot", cutoffMs: 1790251320000, canonicalThroughMs: 1790208000000, token: "f3a1", provenance: ["provisional-tail"], replay: false }, ctx: undefined });
  const legend = E.legend.build(frame, { rangeExceeded: true, lowDiscrimination: null, shares: { marks: 0.062, area: 0.281, low: 0, high: 0 } }, compact, { counts: { "clip-high": 37, "negative-infinite": 2, "exact-high": 1 } });
  const details = E.legend.details(legend);
  const d = Object.fromEntries(details.map((x) => [x.field, x]));
  assert.equal(d.measure.value, "Volume");
  assert.equal(d.mappingId.canonical, "3s_XdONgi8CSqyOl");
  assert.equal(d.mappingId.value, "3s_XdONgi8CSqyOl · value-log1p");
  assert.equal(d.appearanceId.canonical, LUTS.light.id);
  assert.equal(d.U.canonical, U, "the canonical number is never the formatted one");
  assert.equal(d.U.value, "26.8 M");
  assert.equal(d.k.canonical, K);
  assert.equal(d.cohortCount.canonical, 1523);
  assert.equal(d.excludedCount.canonical, 43);
  assert.equal(d.calibratedOn.canonical, "view");
  assert.equal(d.fitOrigin.canonical, "fit");
  assert.equal(d.fitThrough.canonical, 1790251320000);
  assert.equal(d.clipHighFinite.canonical, 37);
  assert.equal(d.clipNegInf.canonical, 2);
  assert.equal(d.clipExactEndpoint.canonical, 1);
  assert.equal(d.shareMarks.canonical, 0.062);
  assert.equal(d.shareMarks.value, "6.2%");
  assert.equal(d.shareArea.canonical, 0.281);
  deq(plain(d.warnings.canonical), ["range-exceeded"]);
  assert.equal(d.obsSource.value, "Binance BTCUSDT spot");
  assert.equal(d.obsCutoff.canonical, 1790251320000);
  assert.equal(d.obsCanonical.canonical, 1790208000000);
  assert.equal(d.obsToken.canonical, "f3a1");
  deq(plain(d.observationNote.canonical), ["provisional-tail"]);
  // The vintage sentence replaces the note in replay (S1-149).
  const replay = E.legend.details(E.legend.build(volume("light", { observation: { replay: true, provenance: [] } }), null, compact, {}));
  assert.equal(replay.find((x) => x.field === "observationNote").value, E.text.vintage);
  // A scale change names its cause and both ids.
  const changed = E.legend.details(E.legend.build(volume("light"), null, compact, { note: { causes: ["resolution", "period"], from: "aaaaaaaaaaaaaaaa", to: "bbbbbbbbbbbbbbbb" } }));
  const c = Object.fromEntries(changed.map((x) => [x.field, x]));
  assert.equal(c.scaleChangeCause.value, "resolution, period");
  assert.equal(c.scaleChangeFrom.canonical, "aaaaaaaaaaaaaaaa");
  assert.equal(c.scaleChangeTo.canonical, "bbbbbbbbbbbbbbbb");
  // Every detail is a record of four fields and JSON-safe.
  for (const x of details) deq(Object.keys(x).sort(), ["canonical", "field", "label", "value"], x.field);
  E.result.assertJsonSafe(plain(details));
});

test("T-legend: the model note reaches the details as the D.18 model fields, with the unknowns left unknown", () => {
  const note = E.model.describe("efficiency", 1790251368750, 8);
  const legend = E.legend.build(cells("cascade", LOG2, "light", { model: note }), null, compact, {});
  const d = Object.fromEntries(legend.details.map((x) => [x.field, x]));
  assert.equal(d.modelStatus.canonical, "timing-unverified");
  assert.equal(d.modelStatus.value, E.text.model.timingUnverified);
  assert.equal(d.modelIsoA.canonical, -1.06);
  assert.equal(d.modelIsoB.canonical, 0.486);
  assert.equal(d.modelBaseline.canonical, 2 ** (0.486 - 1));
  deq(plain(d.modelFitRange.canonical), [6, 13]);
  assert.equal(d.modelHistoryStart.canonical, "2021-01-01T00:00:00Z");
  assert.equal(d.modelExtraction.canonical, "2026-09-24");
  assert.equal(d.modelFitTimestamp.canonical, null, "the exact fit time is unknown, not guessed");
  assert.equal(d.modelFitTimestamp.value, E.text.model.exactUnknown);
  assert.equal(d.modelUpperBound.canonical, "2026-09-25T00:00:00Z");
  assert.equal(d.modelApplicability.value, E.text.model.applicability);
  const eligible = E.legend.build(cells("cascade", LOG2, "light", { model: E.model.describe("efficiency", 1790294400000, 8) }), null, compact, {});
  assert.equal(eligible.details.find((x) => x.field === "modelStatus").value, E.text.model.eligibleByBound, "the consumer renders the eligible-by-bound line (DR-42)");
});

// ---- warnings ----------------------------------------------------------------------------------------------------------------------------

test("T-legend: a main-chart warning offers Fit, Auto color and Open lens; a lens warning offers Fit, Auto color and Local contrast (DD-94)", () => {
  const warn = { rangeExceeded: true, lowDiscrimination: "high", shares: { marks: 0.062, area: 0.281, low: 0, high: 0.93 } };
  const main = E.legend.build(volume("light"), warn, compact, {});
  const range = main.warnings.find((w) => w.id === "range-exceeded");
  assert.equal(range.text, E.text.warn.rangeExceeded);
  deq(plain(range.shares), { marks: 0.062, area: 0.281 });
  deq(plain(range.actions), ["fit", "auto", "open-lens"]);
  assert.equal(range.detail, "6.2% of occupied marks and 28.1% of occupied screen area are outside the scale");
  const low = main.warnings.find((w) => w.id === "low-discrimination");
  assert.equal(low.text, E.text.warn.lowDisc);
  assert.equal(low.detail, "93% of nonzero marks use the highest 5% of the scale");
  const lens = E.legend.build(volume("light"), warn, compact, { channel: "lens" });
  assert.equal(lens.channel, "lens");
  deq(plain(lens.warnings.find((w) => w.id === "range-exceeded").actions), ["fit", "auto", "local"]);
  // Nothing exceeded, no warning.
  deq(plain(E.legend.build(volume("light"), { rangeExceeded: false, lowDiscrimination: null, shares: { marks: 0, area: 0, low: 0, high: 0 } }, compact, {}).warnings), []);
  // The low end reads its own sentence.
  const lowEnd = E.legend.build(volume("light"), { rangeExceeded: false, lowDiscrimination: "low", shares: { marks: 0, area: 0, low: 0.95, high: 0 } }, compact, {});
  assert.equal(lowEnd.warnings[0].detail, "95% of nonzero marks use the lowest 5% of the scale");
});

test("T-legend: states that are warnings carry their text: paused, external override, override after the replay edge, short exposure", () => {
  const paused = E.legend.build(volume("light"), null, compact, { paused: "lock" });
  assert.equal(paused.state, "paused");
  assert.ok(paused.warnings.some((w) => w.id === "paused" && w.text === E.text.state.autoPausedLock));
  assert.ok(E.legend.build(volume("light"), null, compact, { paused: "play" }).warnings.some((w) => w.id === "paused" && w.text === E.text.state.autoPaused));
  const ext = E.legend.build(volume("light", { mapping: { state: "ok", desc: LOGU, policy: "comparison", external: true } }), null, compact, { afterEdge: true });
  assert.ok(ext.warnings.some((w) => w.id === "external-override" && w.text === E.text.state.external));
  assert.ok(ext.warnings.some((w) => w.id === "override-after-edge" && w.text === E.text.state.externalAfterEdge));
  assert.equal(ext.state, "ok", "an external override is data-override, not a chip state");
  assert.equal(ext.details.find((x) => x.field === "override").canonical, "external");
  const short = E.legend.build(volume("light"), null, compact, { shortExposure: { t: 0.0625, w: 1 } });
  const s = short.warnings.find((w) => w.id === "short-exposure");
  assert.equal(s.text, "Short exposure");
  assert.equal(s.detail, "6.3% of the time span, 100% of the price span", "the test formatter rounds to one decimal");
  assert.equal(E.legend.build(volume("light"), null, compact, {}).warnings.length, 0);
  assert.equal(E.legend.build(volume("light", { mapping: { state: "updating", desc: LOGU, policy: "explore" } }), null, compact, {}).state, "updating");
  assert.equal(E.legend.build(volume("light"), null, compact, { failed: true }).state, "failed");
});

test("T-legend: the legend accepts the WarnReport of E.warn.evaluate", (t) => {
  if (E.warn === undefined) {
    t.todo("needs part 17-warn: E.warn.tally() / evaluate(tally, {meaningful}) (API.md C.11); the legend reads rangeExceeded, lowDiscrimination and shares; exercised at assembly");
    return;
  }
  const tally = E.warn.tally();
  for (let i = 0; i < 100; i++) tally.add(i < 30 ? 200 : 100, i < 30 ? E.scale.CLIP.HIGH : E.scale.CLIP.NONE, true, true);
  const report = E.warn.evaluate(tally, { meaningful: true });
  const legend = E.legend.build(volume("light"), report, compact, {});
  assert.ok(legend.warnings.some((w) => w.id === "range-exceeded"), "30% of the marks are outside: more than 10%");
  assert.ok(Math.abs(legend.warnings.find((w) => w.id === "range-exceeded").shares.marks - 0.3) < 1e-12);
  const quiet = E.legend.build(volume("light"), E.warn.evaluate(E.warn.tally(), { meaningful: true }), compact, {});
  assert.equal(quiet.warnings.length, 0);
});

// ---- panes -------------------------------------------------------------------------------------------------------------------------------

test("T-legend: a pane legend reads from its axis record: ends, zero, the oscillator's guides, the five ratio ticks", () => {
  const axis = (over) => Object.assign({ id: "pane.volume", channel: "columns", policy: "auto", sign: "unsigned", typed: "finite", domain: [0, 1920000000], natural: null, unit: "usdt", mappingId: "m", hold: null, provenance: null }, over);
  const pane = (key, a) => E.readout.paneFrame({ key, axis: a, lut: LUTS.light });
  const vol = E.legend.build(pane("volume", axis({})), null, compact, {});
  assert.equal(vol.channel, "pane");
  deq(vol.bar.ticks.map((t) => [t.value, t.t]), [[0, 0], [1920000000, 1]]);
  assert.ok(vol.bar.samples.every((s) => s.css === LUTS.light.bar.css), "a constant unsigned bar");
  assert.equal(E.legend.chip(vol).text, "Auto axis · 1.9 B");
  assert.equal(vol.summary.policy, "Auto axis");
  const signed = E.legend.build(pane("delta", axis({ id: "pane.delta", sign: "signed-symmetric", domain: [-1920000000, 1920000000] })), null, compact, {});
  deq(signed.bar.ticks.map((t) => [t.value, t.t]), [[-1920000000, -1], [0, 0], [1920000000, 1]]);
  assert.equal(E.legend.chip(signed).text, "Auto axis · ±1.9 B");
  assert.equal(signed.bar.samples[0].css, LUTS.light.negative.css[255]);
  assert.equal(signed.bar.samples[32].css, LUTS.light.positive.css[255]);
  // RSI: fixed [0,100] with the guides 30 and 70: ticks 0, 30, 70, 100.
  const rsi = E.legend.build(pane("volume", axis({ id: "pane.rsi1d", policy: "fixed", domain: [0, 100], natural: [0, 100], unit: "index", guides: [30, 70] })), null, compact, {});
  deq(rsi.bar.ticks.map((t) => [t.value, t.kind]), [[0, "end"], [30, "guide"], [70, "guide"], [100, "end"]]);
  deq(rsi.bar.ticks.map((t) => t.t), [0, 0.3, 0.7, 1]);
  // Ratio: the five ticks of the log2 axis.
  const ratio = E.legend.build(pane("cascade", axis({ id: "pane.cascade", policy: "fixed", sign: "ratio", domain: [-2, 2], natural: [-2, 2], unit: "log2-ratio" })), null, compact, {});
  deq(ratio.bar.ticks.map((t) => t.label), ["1/4×", "1/2×", "1×", "2×", "4×"]);
  deq(ratio.bar.ticks.map((t) => t.t), [-1, -0.5, 0, 0.5, 1]);
  // Typed states of the axis: No data, zero-only; a pane key for the zero tick and the diamond.
  const none = E.legend.build(pane("volume", axis({ typed: "none", domain: null })), null, compact, {});
  assert.equal(E.legend.chip(none).text, E.text.axis.none);
  assert.equal(none.state, "no-calibration");
  deq(none.bar.ticks, []);
  const zero = E.legend.build(pane("volume", axis({ typed: "zero-only", domain: null })), null, compact, {});
  assert.equal(E.legend.chip(zero).text, E.text.policy.axisAuto + " \u00b7 " + E.text.axis.zero);
  assert.equal(zero.state, "zero-only");
  const keys = Object.fromEntries(vol.keys.map((k) => [k.id, k]));
  assert.equal(keys["zero-tick"].glyph, "tick");
  assert.equal(keys["zero-tick"].label, "Zero", "the signed zero tick, where the unsigned outline reads Zero (occupied)");
  assert.equal(keys.undefined.glyph, "diamond", "an undefined column is a hollow diamond on the baseline");
  assert.equal(E.legend.build(pane("volume", axis({})), null, compact, { paused: "play" }).state, "paused");
  assert.equal(E.legend.chip(E.legend.build(pane("volume", axis({})), null, compact, { paused: "play" })).text, E.text.axis.paused);
  assert.equal(E.legend.chip(E.legend.build(pane("volume", axis({})), null, compact, { updating: true })).text, E.text.axis.updating);
});

// ---- marker ------------------------------------------------------------------------------------------------------------------------------

test("T-legend: the marker is the record's coordinate; it is null where a record has none, describes another mapping or another level", () => {
  const frame = volume("light", { mapping: { state: "ok", record: RECORD, policy: "explore" } });
  const legend = E.legend.build(frame, null, compact, {});
  // A cell whose volume is exactly k sits at the k tick.
  const r = frame.readout({ c: 201, r: 203, v: K, bv: 0, ct: 1, bt: 0 });
  const marker = E.legend.marker(legend, r);
  const tick = legend.bar.ticks.find((t) => t.kind === "k");
  assert.equal(marker.t, tick.t, "the marker of the value k is the k tick");
  assert.equal(marker.clip, "none");
  assert.equal(marker.p, marker.t);
  assert.equal(E.legend.marker(legend, null), null);
  // A non-value has no coordinate and no marker.
  assert.equal(E.legend.marker(legend, frame.readout({ c: 201, r: 203, v: NaN })), null);
  // Another mapping id: the record was made under a different scale than this legend shows.
  const other = cells("volume", LINU).readout({ c: 201, r: 203, v: 500, bv: 0, ct: 1, bt: 0 });
  assert.equal(E.legend.marker(legend, other), null);
  // Another level (the drawer table at its own level, DR-22).
  const coarse = E.readout.cellsFrame(cellsSpec("volume", LOGU, "light", { level: { n: 6, m: 1 }, mapping: { state: "ok", record: RECORD, policy: "explore" } })).readout({ c: 50, r: 203, v: K });
  assert.equal(E.legend.marker(legend, coarse), null);
  // An outline legend has no marker; a clipped value reports its clip; a signed value is placed on the half bar.
  const outline = E.legend.build(E.readout.cellsFrame({ mode: "geometry", level: LEVEL, bounds: [0, 1, 0, 1], geom: GEOM, mapping: null, lut: LUTS.light }), null, compact, {});
  assert.equal(E.legend.marker(outline, r), null);
  const above = frame.readout({ c: 201, r: 203, v: U * 10, bv: 0, ct: 1, bt: 0 });
  deq(plain(E.legend.marker(legend, above)), { t: 1, clip: "high", p: 1 });
  const sFrame = cells("delta", LOGS);
  const sLegend = E.legend.build(sFrame, null, compact, {});
  const neg = E.legend.marker(sLegend, sFrame.readout({ c: 201, r: 203, v: 1000, bv: 100, ct: 1, bt: 0 }));
  assert.ok(neg.t < 0 && neg.p < 0.5 && neg.p === (neg.t + 1) / 2);
  const zeroCell = E.legend.marker(sLegend, sFrame.readout({ c: 201, r: 203, v: 1000, bv: 500, ct: 1, bt: 0 }));
  deq(plain(zeroCell), { t: 0, clip: "none", p: 0.5 });
});

// ---- bar pixels ------------------------------------------------------------------------------------------------------------------------------

function bytesOf(rgbArray, i) {
  return [rgbArray[i * 3], rgbArray[i * 3 + 1], rgbArray[i * 3 + 2]];
}

test("T-legend: barPixels is the Lut read through the coordinate, pixel by pixel, exactly (unsigned, signed, composite, flat)", () => {
  const pixels = (legend, w) => Array.from(E.legend.barPixels(legend, w));
  for (const theme of ["light", "dark"]) {
    const lut = LUTS[theme];
    // Unsigned: pixel x is at p = x / (w - 1); index round(p * 255) of the unsigned ramp (hand-coded).
    for (const w of [1, 2, 3, 64, 97, 256, 300]) {
      const out = pixels(E.legend.build(volume(theme), null, compact, {}), w);
      assert.equal(out.length, w * 4);
      for (let x = 0; x < w; x++) {
        const p = w > 1 ? x / (w - 1) : 0.5;
        deq(out.slice(x * 4, x * 4 + 3), bytesOf(lut.unsigned.rgb, idxOf(p)), `w ${w} x ${x}`);
        assert.equal(out[x * 4 + 3], 255);
      }
    }
    // Signed: p < 0.5 the negative arm at index round((1 - 2p) * 255), p > 0.5 the positive, the centre the midpoint.
    const sl = E.legend.build(cells("delta", LOGS, theme), null, compact, {});
    for (const w of [2, 5, 64, 101]) {
      const out = pixels(sl, w);
      for (let x = 0; x < w; x++) {
        const p = w > 1 ? x / (w - 1) : 0.5;
        const t = 2 * p - 1;
        const want = t < 0 ? bytesOf(lut.negative.rgb, idxOf(t)) : t > 0 ? bytesOf(lut.positive.rgb, idxOf(t)) : Array.from(lut.midpoint.rgb);
        deq(out.slice(x * 4, x * 4 + 3), want, `signed w ${w} x ${x}`);
      }
    }
    // The composite (Rows): the bytes of E.lut.composite.
    const desc = E.scale.manual({ kind: "value-log1p", signed: false, U: 1e9, k: 1e6 }).descriptor;
    const rows = E.legend.build(E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc }, lut, surface: SURFACE[theme] }), null, compact, {});
    const comp = E.lut.composite("rows", 0.16, SURFACE[theme], lut);
    const out = pixels(rows, 40);
    for (let x = 0; x < 40; x++) deq(out.slice(x * 4, x * 4 + 3), bytesOf(comp.rgb, idxOf(x / 39)), `rows x ${x}`);
    // Flat: the outline is the occupancy colour, a constant column bar is Lut.bar.
    const flat = pixels(E.legend.build(E.readout.cellsFrame({ mode: "geometry", level: LEVEL, bounds: [0, 1, 0, 1], geom: GEOM, mapping: null, lut }), null, compact, {}), 3);
    for (let x = 0; x < 3; x++) deq(flat.slice(x * 4, x * 4 + 3), Array.from(lut.occupancy.rgb));
  }
  deq(pixels(E.legend.build(volume("light"), null, compact, {}), 0), []);
  assert.throws(() => E.legend.barPixels(E.legend.build(volume("light"), null, compact, {}), NaN), isError("RangeError"));
  assert.throws(() => E.legend.barPixels(E.legend.build(volume("light"), null, compact, {}), -1), isError("RangeError"));
  assert.equal(E.legend.barPixels(E.legend.build(volume("light"), null, compact, {}), 5).constructor.name, "Uint8ClampedArray");
});

// ---- keyOf, determinism, theme ------------------------------------------------------------------------------------------------------------

test("T-legend: keyOf changes if and only if one of its listed fields changes, and needs no Legend model (DD-90)", () => {
  const base = { mappingId: "3s_XdONgi8CSqyOl", appearanceId: "slate2-8f7890f7", themeEpoch: 3, policy: "explore", state: "ok", warnStamp: "w1", marker: "8388611", level: { n: 4, m: 1 } };
  const k0 = E.legend.keyOf(base);
  assert.equal(typeof k0, "string");
  assert.equal(E.legend.keyOf(Object.assign({}, base)), k0, "deterministic");
  assert.equal(E.legend.keyOf(Object.assign({}, base, { unrelated: 99, label: "x" })), k0, "fields it does not list never change it");
  for (const [field, value] of [["mappingId", "other"], ["appearanceId", "ramp1-a53783c5"], ["themeEpoch", 4], ["policy", "auto"], ["state", "updating"], ["warnStamp", "w2"], ["marker", "8388612"], ["level", { n: 5, m: 1 }]]) {
    assert.notEqual(E.legend.keyOf(Object.assign({}, base, { [field]: value })), k0, field);
  }
  assert.notEqual(E.legend.keyOf(Object.assign({}, base, { level: { n: 4, m: 2 } })), k0, "the second half of the level counts too");
  // Missing fields are allowed (an early frame): null, undefined and the empty string agree, and two different field lists never collide.
  assert.equal(E.legend.keyOf({ mappingId: "a" }), E.legend.keyOf({ mappingId: "a", policy: null }));
  assert.notEqual(E.legend.keyOf({ mappingId: "a|1" }), E.legend.keyOf({ mappingId: "a", appearanceId: "1" }), "no ambiguity through the separator");
  assert.notEqual(E.legend.keyOf({ mappingId: "ab", appearanceId: "" }), E.legend.keyOf({ mappingId: "a", appearanceId: "b" }));
  // A marker given as a coordinate counts by its coordinate.
  assert.notEqual(E.legend.keyOf({ marker: { t: 0.5, clip: "none" } }), E.legend.keyOf({ marker: { t: 0.6, clip: "none" } }));
});

test("T-legend: the same input gives a byte-equal model, JSON-safe; the theme changes the colours and never the mapping id", () => {
  const a = E.legend.build(volume("light", { mapping: { state: "ok", record: RECORD, policy: "explore" } }), { rangeExceeded: true, lowDiscrimination: null, shares: { marks: 0.2, area: 0.3, low: 0, high: 0 } }, compact, { counts: { "clip-high": 3 }, note: { causes: ["pin"], from: "a", to: "b" } });
  const b = E.legend.build(volume("light", { mapping: { state: "ok", record: RECORD, policy: "explore" } }), { rangeExceeded: true, lowDiscrimination: null, shares: { marks: 0.2, area: 0.3, low: 0, high: 0 } }, compact, { counts: { "clip-high": 3 }, note: { causes: ["pin"], from: "a", to: "b" } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  E.result.assertJsonSafe(a);
  const dark = E.legend.build(volume("dark", { mapping: { state: "ok", record: RECORD, policy: "explore" } }), null, compact, {});
  assert.equal(dark.summary.scaleId, a.summary.scaleId, "the mapping id is theme independent");
  assert.equal(dark.summary.appearance, a.summary.appearance, "the appearance id covers both themes");
  assert.notDeepEqual(plain(dark.bar.samples), plain(a.bar.samples), "the colours follow the theme");
  deq(plain(dark.bar.ticks), plain(a.bar.ticks), "the ticks do not");
  assert.equal(a.v, 1);
  assert.equal(a.channel, "cells");
  deq(Object.keys(a).sort(), ["bar", "channel", "details", "keys", "level", "marker", "notes", "state", "stateToken", "summary", "v", "warnings"]);
  deq(plain(a.notes), ["Scale changed: pin"]);
  assert.equal(a.marker, null, "build sets no marker: it is derived from a readout by E.legend.marker");
});

test("T-legend: build takes a Frame or the object its legendInput() returns, and never changes it", () => {
  const frame = volume("light");
  const input = frame.legendInput();
  const snapshot = Object.keys(input).sort();
  const viaInput = E.legend.build(input, null, compact, {});
  assert.equal(JSON.stringify(viaInput), JSON.stringify(E.legend.build(frame, null, compact, {})));
  deq(Object.keys(input).sort(), snapshot, "the caller's object is not extended");
  // The default formatter works without one, and is locale free.
  const plainLegend = E.legend.build(frame, null, undefined, {});
  assert.equal(plainLegend.bar.ticks[2].label, "26790000");
  assert.equal(E.legend.build(cells("flow", SHARE), null, null, {}).bar.ticks[1].label, "50%");
});
