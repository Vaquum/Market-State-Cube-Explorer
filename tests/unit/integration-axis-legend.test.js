"use strict";
// Cross-part integration tests, first file (package WX): the seams between E.axis, E.readout (paneFrame and
// cellsFrame), E.warn and E.legend, which no single package's tests could write because each package owned
// only one side of them.
//   (a) the bar coordinate of a pane frame equals E.axis.coordinate(record, value) for signed, unsigned,
//       ratio, zero-only and frozen axes (DR-48, package F2's note: paneFrame builds its own evaluator from
//       the record's domain, so the two implementations must agree), and the ticks the legend draws sit at
//       the coordinate the bar would have;
//   (b) E.legend.build consumes exactly what E.warn.tally and E.warn.evaluate produce (rangeExceeded,
//       lowDiscrimination, shares) and the per-key counts (API.md C.11, DR-48 F2).
//
// Oracles (none is the code under test):
//   - (a) closed forms written in this file: an unsigned bar is x / hi, a signed or ratio bar x / hi with the
//     sign choosing the arm, a value beyond the window is clamped to +-1 with its clip named by comparison
//     (x > hi high, x < lo low, x === hi or lo an exact end), and the values of each column are worked out by
//     hand from the column record (delta 2*bv - v, log2(2 * child / parent) for a column Cascade);
//   - (b) hand counts: the test counts which cells have a value above U, the index band each one lands in
//     (the index rule round(clamp(t) * 255) with t = log1p(v / k) / log1p(U / k), written with plain Math)
//     and the area of each cell box, then divides, so every share in the report and in the legend is compared
//     with a number the test computed from the cells and not from the tally. The strict thresholds are the
//     literals of DR-11 (more than 10% of the marks, 25% of the area, 90% of the nonzero marks in a band of
//     13 of 256 entries).
// The module may run in a vm context (ENCODING_PARTS_DIR): records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const { mulberry32 } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));
const CLIP = { NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 };
const LUT = E.lut.build("slate2", "light");

// ---- (a) pane bar coordinate == axis coordinate ----------------------------------------------------------

// A real axis record from the registry, the way the page gets one.
function autoRecord(id, max, min) {
  const reg = E.axis.registry();
  return reg.frame(id, { cutMs: 1e12, now: 0, eligible: true, held: { gesture: false, play: false }, sig: "s", summary: () => ({ count: 4, max, min }) });
}
function fixedRecord(id) {
  return E.axis.registry().frame(id, { cutMs: 1e12, now: 0, eligible: true, held: { gesture: false, play: false }, sig: "s" });
}

// One case: a pane key, a record and the columns to draw, each with the value the column must measure by
// hand (the test's own arithmetic) and the coordinate the closed form gives.
const CASES = [
  {
    name: "unsigned Volume axis [0, 1000]",
    key: "volume",
    record: autoRecord("pane.volume", 1000, 0),
    // [column, hand value]
    columns: [[{ v: 1 }, 1], [{ v: 250 }, 250], [{ v: 999.5 }, 999.5], [{ v: 1000 }, 1000], [{ v: 1000.0001 }, 1000.0001], [{ v: 4000 }, 4000]],
    hi: 1000,
    signed: false,
  },
  {
    name: "signed-symmetric Delta axis [-500, 500]",
    key: "delta",
    record: autoRecord("pane.delta", 500, -300),
    columns: [
      [{ v: 500, bv: 0 }, -500], // exactly the low end
      [{ v: 500, bv: 500 }, 500], // exactly the high end
      [{ v: 300, bv: 100 }, -100],
      [{ v: 300, bv: 250 }, 200],
      [{ v: 700, bv: 0 }, -700], // beyond the low end
      [{ v: 500, bv: 600 }, 700], // beyond the high end
      [{ v: 10, bv: 6 }, 2],
    ],
    hi: 500,
    signed: true,
  },
  {
    name: "ratio Cascade axis [-2, 2] (a fixed log2 window)",
    key: "cascade",
    record: fixedRecord("pane.cascade"),
    // a column Cascade is log2(2 * child / parent): the ctx carries the structure per column
    columns: [
      [{ ctx: { ratio: { structure: "complete", childV: 1, parentV: 1, factor: 2 } } }, 1],
      [{ ctx: { ratio: { structure: "complete", childV: 1, parentV: 4, factor: 2 } } }, -1],
      [{ ctx: { ratio: { structure: "complete", childV: 2, parentV: 1, factor: 2 } } }, 2], // exactly the high end
      [{ ctx: { ratio: { structure: "complete", childV: 4, parentV: 1, factor: 2 } } }, 3], // beyond it
      [{ ctx: { ratio: { structure: "complete", childV: 1, parentV: 8, factor: 2 } } }, -2], // exactly the low end
      [{ ctx: { ratio: { structure: "complete", childV: 1, parentV: 16, factor: 2 } } }, -3], // beyond it
      [{ ctx: { ratio: { structure: "complete", childV: 3, parentV: 5, factor: 2 } } }, Math.log2(6 / 5)],
    ],
    hi: 2,
    signed: true,
  },
  {
    name: "a frozen unsigned axis [0, 100] (Comparison lock): later, larger columns clip at its end",
    key: "volume",
    record: (() => {
      const reg = E.axis.registry();
      return reg.freeze("pane.volume", { domain: [0, 100], through: 1000 });
    })(),
    columns: [[{ v: 40 }, 40], [{ v: 100 }, 100], [{ v: 100.5 }, 100.5], [{ v: 2500 }, 2500]],
    hi: 100,
    signed: false,
  },
  {
    name: "a frozen signed axis [-8, 8]",
    key: "delta",
    record: E.axis.registry().freeze("pane.delta", { domain: [-8, 8], through: 1000 }),
    columns: [[{ v: 20, bv: 3 }, -14], [{ v: 20, bv: 14 }, 8], [{ v: 20, bv: 6 }, -8], [{ v: 20, bv: 11 }, 2], [{ v: 20, bv: 0 }, -20]],
    hi: 8,
    signed: true,
  },
];

// The closed form: position along the window and the clip word by comparison.
function want(c, x) {
  const hi = c.hi;
  const lo = c.signed ? -hi : 0;
  if (x > hi) return { t: 1, clip: CLIP.HIGH };
  if (x < lo) return { t: c.signed ? -1 : 0, clip: CLIP.LOW };
  if (x === hi) return { t: 1, clip: CLIP.EXACT_HIGH };
  if (x === lo) return { t: c.signed ? -1 : 0, clip: CLIP.EXACT_LOW };
  return { t: x / hi, clip: CLIP.NONE };
}

for (const c of CASES) {
  test(`(a) ${c.name}: the pane frame's bar equals E.axis.coordinate and the closed form for every column`, () => {
    const frame = E.readout.paneFrame({ key: c.key, axis: c.record, lut: LUT });
    const out = {};
    for (const [col, x] of c.columns) {
      frame.encode(col, out, col.ctx);
      assert.equal(out.tag, 0, `${JSON.stringify(col)}: a value`);
      assert.ok(Math.abs(out.value - x) <= 1e-12 * Math.abs(x) + 1e-12, `${JSON.stringify(col)}: measured ${out.value}, hand ${x}`);
      const coord = E.axis.coordinate(c.record, out.value);
      const closed = want(c, x);
      assert.ok(Math.abs(coord.t - closed.t) <= 1e-15, `axis.coordinate(${x}) = ${coord.t}, closed form ${closed.t}`);
      assert.equal(coord.clip, closed.clip, `axis.coordinate clip at ${x}`);
      // the seam itself: the frame draws the bar where the axis says the value sits, and counts the same clip
      assert.ok(Math.abs(out.t - coord.t) <= 1e-15, `${c.key} ${x}: the bar is at ${out.t}, the axis puts the value at ${coord.t}`);
      assert.equal(out.clip, coord.clip, `${c.key} ${x}: clip of the bar ${out.clip}, of the axis ${coord.clip}`);
      // the readout and the legend marker carry the same number (one record, four consumers)
      const r = frame.readout(col, col.ctx === undefined ? undefined : { ctx: col.ctx });
      assert.equal(r.coordinate.t, out.t);
      assert.equal(r.coordinate.clip, ["none", "low", "high", "exact-low", "exact-high"][out.clip]);
    }
  });

  test(`(a) ${c.name}: every tick the legend draws is at the coordinate of its value, and a column of that value gets the same bar`, () => {
    const frame = E.readout.paneFrame({ key: c.key, axis: c.record, lut: LUT });
    const legend = E.legend.build(frame, null, null, {});
    assert.ok(legend.bar.ticks.length >= 2, "a window has at least its two ends");
    for (const tick of legend.bar.ticks) {
      const coord = E.axis.coordinate(c.record, tick.value);
      assert.ok(Math.abs(tick.t - coord.t) <= 1e-15, `${c.key} tick ${tick.value}: legend ${tick.t}, axis ${coord.t}`);
      assert.ok(Math.abs(tick.p - (c.signed ? (coord.t + 1) / 2 : coord.t)) <= 1e-15, "the position along the bar: a signed bar runs -1..1 over 0..1");
    }
    // the ends of the window are at the ends of the bar
    const ends = legend.bar.ticks.filter((t) => t.kind === "end");
    assert.ok(ends.some((t) => t.p === 0) && ends.some((t) => t.p === 1), "the window ends sit at p 0 and p 1");
  });
}

test("(a) a zero column is a tick of the bar, not a bar: t 0, no clip and the state ink, on every axis kind", () => {
  for (const c of CASES) {
    const frame = E.readout.paneFrame({ key: c.key, axis: c.record, lut: LUT });
    const out = {};
    const col = c.key === "volume" ? { v: 0 } : c.key === "delta" ? { v: 10, bv: 5 } : { ctx: { ratio: { structure: "complete", childV: 1, parentV: 2, factor: 2 } } };
    frame.encode(col, out, col.ctx);
    assert.equal(out.value, 0, c.name);
    assert.equal(out.pattern, "tick", c.name);
    assert.equal(out.css, LUT.stateInk.css, c.name);
    assert.equal(out.t, 0, c.name);
    assert.equal(out.clip, CLIP.NONE, c.name + ": a defined zero is never an exact end or an overflow");
  }
});

test("(a) a zero-only axis: zero is a tick and any other value is out of domain, on the side it lies (frame == E.axis.coordinate)", () => {
  for (const [id, key, sign] of [["pane.volume", "volume", "unsigned"], ["pane.delta", "delta", "signed-symmetric"]]) {
    const record = autoRecord(id, 0, 0);
    assert.equal(record.typed, "zero-only");
    const frame = E.readout.paneFrame({ key, axis: record, lut: LUT });
    const out = {};
    const cols = key === "volume" ? [{ v: 5 }, { v: 0 }] : [{ v: 5, bv: 5 }, { v: 5, bv: 0 }, { v: 4, bv: 2 }];
    for (const col of cols) {
      frame.encode(col, out);
      const coord = E.axis.coordinate(record, out.value);
      if (out.value === 0) {
        assert.equal(out.clip, CLIP.NONE);
        continue;
      }
      assert.ok(out.clip === CLIP.HIGH || out.clip === CLIP.LOW, "out of domain is counted");
      assert.equal(out.clip, coord.clip, `${sign} ${out.value}: the bar and the axis name the same side`);
      assert.equal(out.t, coord.t, `${sign} ${out.value}: and the same end`);
    }
  }
});

test("(a) the legend's own apply for a zero-only pane axis agrees with the frame's encoder (the marker and the tally read different code paths)", () => {
  const record = autoRecord("pane.delta", 0, 0);
  const frame = E.readout.paneFrame({ key: "delta", axis: record, lut: LUT });
  const input = frame.legendInput();
  const out = {};
  const scratch = {};
  for (const col of [{ v: 5, bv: 5 }, { v: 5, bv: 0 }]) {
    frame.encode(col, out);
    input.apply(out.value, scratch);
    assert.equal(scratch.clip, out.clip, `apply clip at ${out.value}`);
    assert.equal(scratch.t, out.t, `apply t at ${out.value}`);
  }
});

test("(a) a record with no data draws nothing: no bar, no role, and the axis places the value nowhere", () => {
  const record = E.axis.registry().frame("pane.volume", { cutMs: 1e12, now: 0, eligible: false, held: {}, sig: "s", summary: () => ({ count: 0, max: 0, min: 0 }) });
  assert.equal(record.typed, "none");
  const frame = E.readout.paneFrame({ key: "volume", axis: record, lut: LUT });
  const out = {};
  frame.encode({ v: 12 }, out);
  assert.equal(out.role, E.readout.ROLE.NONE);
  assert.equal(out.css, null);
  assert.deepEqual(plain(E.axis.coordinate(record, 12)), { t: 0, clip: CLIP.NONE });
  assert.equal(frame.readout({ v: 12 }).coordinate, null);
});

// ---- (b) legend <- warn ----------------------------------------------------------------------------------

const GEOM = { BASE: 56.25, PR: 125 };
const BOUNDS = [3200, 3264, 400, 416];
const TS = 16;
const PS = 2;

// Cells c = 200..202, rows r = 200..207 at level (4, 1): all inside the rectangle and before the cutoff
// (3250), so every one is a complete mark. `v` spans six decades, seeded.
function cellsFixture(seed) {
  const next = mulberry32(seed);
  const out = [];
  for (let c = 200; c <= 202; c++)
    for (let r = 200; r <= 207; r++) out.push({ c, r, v: r === 203 ? 0 : Math.pow(10, next() * 6) });
  return out;
}
const CELLS = cellsFixture(4711);
// a box per cell whose width varies with the column, so the area shares differ from the mark shares
const box = (z) => {
  const w = 5 + (z.c % 3) * 5;
  return { x0: z.c * 10, y0: z.r * 10, x1: z.c * 10 + w, y1: z.r * 10 + 8 };
};
const CLIPBOX = { plot: { x0: 0, y0: 0, x1: 100000, y1: 100000 }, meas: null };

function frameFor(U, k) {
  const desc = E.scale.manual({ kind: "value-log1p", signed: false, U, k }).descriptor;
  return {
    desc,
    frame: E.readout.cellsFrame({
      mode: "volume",
      basis: "amount",
      level: { n: 4, m: 1 },
      bounds: BOUNDS,
      cut: 3250,
      geom: GEOM,
      CUT: 3258,
      replay: false,
      mapping: { state: "ok", desc, policy: "explore", origin: "fit" },
      lut: LUT,
      observation: { source: "fixture", instrument: "BTC/USDT", read: "cube", cutoffMs: 1790251320000, liveCutoffMs: 1790251320000, canonicalThroughMs: 1790208000000, token: null, provenance: [] },
    }),
  };
}

// Feed the tally the way the page's hooks do and count by hand what the report must say.
function pass(U, k) {
  const { desc, frame } = frameFor(U, k);
  const tally = E.warn.tally();
  const out = {};
  const hand = { marks: 0, outside: 0, nonzero: 0, lowBand: 0, highBand: 0, area: 0, areaOutside: 0, high: 0, low: 0, zero: 0 };
  for (const z of CELLS) {
    frame.encode(z, out);
    const b = box(z);
    tally.addBox(b.x0, b.y0, b.x1, b.y1, CLIPBOX, out.idx, out.clip, out.tag === 0, out.value !== 0);
    // the test's own count
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    hand.marks++;
    hand.area += area;
    if (z.v === 0) hand.zero++;
    else {
      hand.nonzero++;
      const t = Math.min(1, Math.log1p(z.v / k) / Math.log1p(U / k));
      const idx = Math.round(t * 255);
      if (idx <= 12) hand.lowBand++;
      if (idx >= 243) hand.highBand++;
    }
    if (z.v > U) {
      hand.outside++;
      hand.high++;
      hand.areaOutside += area;
    }
  }
  return { desc, frame, tally, hand };
}

// The legend's per-key counts from a tally: the clip counters are named for the words of the tally and the
// keys for the words of E.role, so the page maps them; written once here, from the report only.
function countsOf(report) {
  const c = report.counts;
  return { "clip-low": c.low, "clip-high": c.high, "negative-infinite": c.negInf, "no-reference": c.noRef, "exact-low": c.exactLow, "exact-high": c.exactHigh };
}
const spyFmt = (value, unit) => (unit === "share" ? (value * 100).toFixed(1) + "%" : String(value));

test("(b) the report of a real pass equals the hand count, and the legend built from it carries the same shares, ids and counts", () => {
  // 1e3 as the maximum: about half of the cells (values between 1 and 1e6) are above it
  const { frame, tally, hand } = pass(1000, 100);
  assert.ok(hand.outside > 0 && hand.outside < hand.marks, "the fixture has cells inside and outside the scale");
  const report = E.warn.evaluate(tally);
  assert.equal(report.counts.marks, hand.marks);
  assert.equal(report.counts.outside, hand.outside);
  assert.equal(report.counts.high, hand.high);
  assert.equal(report.counts.nonzero, hand.nonzero);
  assert.equal(report.counts.lowBand, hand.lowBand);
  assert.equal(report.counts.highBand, hand.highBand);
  assert.ok(Math.abs(report.counts.area - hand.area) < 1e-9);
  assert.ok(Math.abs(report.shares.marks - hand.outside / hand.marks) < 1e-15);
  assert.ok(Math.abs(report.shares.area - hand.areaOutside / hand.area) < 1e-12);
  assert.ok(Math.abs(report.shares.low - hand.lowBand / hand.nonzero) < 1e-15);
  assert.ok(Math.abs(report.shares.high - hand.highBand / hand.nonzero) < 1e-15);
  // DR-11, strict: more than 10% of the marks or more than 25% of the area
  assert.equal(report.rangeExceeded, hand.outside / hand.marks > 0.1 || hand.areaOutside / hand.area > 0.25);
  assert.equal(report.rangeExceeded, true);
  E.result.assertJsonSafe(plain(report));

  const legend = E.legend.build(frame, report, spyFmt, { counts: countsOf(report) });
  // the warnings of the report, in its order, are the legend's warnings with the same shares
  const ids = legend.warnings.map((w) => w.id).filter((id) => id === "range-exceeded" || id === "low-discrimination");
  assert.deepEqual(ids, report.warnings.map((w) => w.id));
  const range = legend.warnings.find((w) => w.id === "range-exceeded");
  assert.deepEqual(plain(range.shares), plain(report.warnings[0].shares));
  assert.ok(range.detail.includes(spyFmt(report.shares.marks, "share")) && range.detail.includes(spyFmt(report.shares.area, "share")), "the detail states the shares the report holds: " + range.detail);
  assert.deepEqual(plain(range.actions), ["fit", "auto", "open-lens"]);
  // the per-key counts: the clip-high key and the bar edge say how many cells are above U, by the hand count
  const keyCount = (id) => legend.keys.find((k) => k.id === id).count;
  assert.equal(keyCount("clip-high"), hand.high);
  assert.equal(keyCount("clip-low"), 0);
  assert.equal(keyCount("zero"), 0, "the zero key counts only what the caller counted under it");
  assert.equal(legend.bar.edges.high.count, hand.high);
  assert.equal(legend.bar.edges.low.count, 0);
  // and the details list holds the exact numbers, not their text
  const detail = (field) => legend.details.find((d) => d.field === field);
  assert.equal(detail("shareMarks").canonical, report.shares.marks);
  assert.equal(detail("shareArea").canonical, report.shares.area);
  assert.equal(detail("clipHighFinite").canonical, hand.high);
  assert.deepEqual(plain(detail("warnings").canonical), ["range-exceeded"]);
  assert.match(E.legend.chip(legend).text, new RegExp(E.text.warn.rangeExceeded), "the chip names the warning");
  assert.equal(E.legend.chip(legend).state, "ok");
  E.result.assertJsonSafe(plain(legend));
});

test("(b) a pass that is all inside the scale gives a report with no warning, and a legend with none", () => {
  const { frame, tally, hand } = pass(1e7, 1e5);
  assert.equal(hand.outside, 0);
  const report = E.warn.evaluate(tally);
  assert.equal(report.rangeExceeded, false);
  assert.deepEqual(plain(report.warnings), []);
  const legend = E.legend.build(frame, report, spyFmt, { counts: countsOf(report) });
  assert.deepEqual(legend.warnings.map((w) => w.id), []);
  assert.equal(legend.keys.find((k) => k.id === "clip-high").count, 0);
});

test("(b) Low discrimination at the low end: more than 90% of the nonzero marks in the lowest 13 entries, offered with its own actions", () => {
  // U and k so large that every value of the fixture lands at index 0..12
  const { frame, tally, hand } = pass(1e15, 1e14);
  assert.equal(hand.lowBand, hand.nonzero, "by hand: all nonzero marks are in the low band");
  const report = E.warn.evaluate(tally);
  assert.equal(report.lowDiscrimination, "low");
  assert.equal(report.rangeExceeded, false);
  assert.ok(Math.abs(report.shares.low - 1) < 1e-15);
  const legend = E.legend.build(frame, report, spyFmt, { counts: countsOf(report) });
  const w = legend.warnings.find((x) => x.id === "low-discrimination");
  assert.ok(w, "the legend has the warning the report has");
  assert.equal(w.text, E.text.warn.lowDisc);
  assert.ok(w.detail.includes(spyFmt(report.shares.low, "share")), w.detail);
  assert.deepEqual(plain(legend.details.find((d) => d.field === "warnings").canonical), ["low-discrimination"]);
  assert.equal(E.legend.chip(legend).text.includes(E.text.warn.lowDisc), true);
});

test("(b) Low discrimination at the high end and Scale range exceeded together: both warnings, in the report's order", () => {
  // U and k tiny: every nonzero value is above U, clipped at index 255
  const { frame, tally, hand } = pass(0.5, 0.25);
  assert.equal(hand.outside, hand.nonzero);
  const report = E.warn.evaluate(tally);
  assert.equal(report.lowDiscrimination, "high");
  assert.equal(report.rangeExceeded, true);
  assert.deepEqual(report.warnings.map((w) => w.id), ["range-exceeded", "low-discrimination"]);
  const legend = E.legend.build(frame, report, spyFmt, { counts: countsOf(report) });
  assert.deepEqual(legend.warnings.filter((w) => w.id === "range-exceeded" || w.id === "low-discrimination").map((w) => w.id), ["range-exceeded", "low-discrimination"]);
  assert.ok(legend.warnings.find((w) => w.id === "low-discrimination").detail.includes(spyFmt(report.shares.high, "share")));
  assert.equal(legend.keys.find((k) => k.id === "clip-high").count, hand.high);
  // the chip shows at most one state token, by priority: range exceeded before low discrimination
  assert.ok(E.legend.chip(legend).text.includes(E.text.warn.rangeExceeded));
  assert.ok(!E.legend.chip(legend).text.includes(E.text.warn.lowDisc));
});

test("(b) a channel with a natural fixed domain reports its clip counts but never a warning (meaningful false), and the legend stays quiet", () => {
  const { frame, tally } = pass(0.5, 0.25);
  const report = E.warn.evaluate(tally, { meaningful: false });
  assert.equal(report.meaningful, false);
  assert.equal(report.rangeExceeded, false);
  assert.equal(report.lowDiscrimination, null);
  assert.deepEqual(plain(report.warnings), []);
  assert.ok(report.counts.high > 0, "the clip counts are still reported");
  const legend = E.legend.build(frame, report, spyFmt, { counts: countsOf(report) });
  assert.deepEqual(legend.warnings.map((w) => w.id), []);
  assert.equal(legend.keys.find((k) => k.id === "clip-high").count, report.counts.high, "and the key still counts what is outside");
});

test("(b) legend.build accepts the report as the tally produces it, and a legend without a report (null) has no shares and no warnings", () => {
  const { frame, tally } = pass(1000, 100);
  const report = E.warn.evaluate(tally);
  const before = JSON.stringify(report);
  E.legend.build(frame, report, spyFmt, { counts: countsOf(report) });
  assert.equal(JSON.stringify(report), before, "build never changes the report it reads");
  const none = E.legend.build(frame, null, spyFmt, {});
  assert.deepEqual(none.warnings.map((w) => w.id), []);
  assert.equal(none.details.find((d) => d.field === "shareMarks"), undefined, "no shares without a report");
  // a report of an empty pass: everything is 0, not NaN
  const empty = E.warn.evaluate(E.warn.tally());
  assert.deepEqual(plain(empty.shares), { marks: 0, area: 0, low: 0, high: 0 });
  const legend = E.legend.build(frame, empty, spyFmt, { counts: countsOf(empty) });
  assert.deepEqual(legend.warnings.map((w) => w.id), []);
  E.result.assertJsonSafe(plain(legend));
});

test("(b) a pane's bars feed the same tally through add(), and the axis legend reads the report like any other", () => {
  // a frozen axis of 100: columns above it are HIGH and counted; the pane legend shows the same count
  const record = E.axis.registry().freeze("pane.volume", { domain: [0, 100], through: 1000 });
  const frame = E.readout.paneFrame({ key: "volume", axis: record, lut: LUT });
  const tally = E.warn.tally();
  const out = {};
  const values = [10, 20, 50, 99, 100, 101, 400, 1000, 7, 3];
  for (const v of values) {
    frame.encode({ v }, out);
    tally.add(out.idx, out.clip, out.tag === 0, out.value !== 0);
  }
  const above = values.filter((v) => v > 100).length;
  const report = E.warn.evaluate(tally);
  assert.equal(report.counts.high, above);
  assert.equal(report.counts.exactHigh, 1, "the column exactly at the end is on the axis, not beyond it");
  assert.equal(report.counts.marks, values.length);
  const legend = E.legend.build(frame, report, spyFmt, { counts: countsOf(report) });
  assert.equal(legend.keys.find((k) => k.id === "clip-high").count, above);
  assert.equal(legend.bar.edges.high.count, above);
  assert.equal(legend.details.find((d) => d.field === "clipExactEndpoint").canonical, 1);
});
