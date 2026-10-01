"use strict";
// U23 (T-equivalence): source equivalence of E.readout frames (API.md C.1.1, C.16, S1-066, D4/S1-201, A-35).
// Identical canonical input gives identical output (deep-equal readout, coordinate, LUT index, legend model),
// last-bit-different input gives output within the PROPAGATED tolerance of its inputs, and both sides of every
// boundary are pinned (clip at U, sign at 0, a rank tie at a persisted knot). No input is ever rounded.
//
// Oracles (none is the code under test):
//   1. The propagated-error bounds of API.md C.1.1, written out here: eps(x) = 1e-12 * |x| + 1e-12,
//      Delta 2 * eps(bv) + eps(v), log-ratio (eps(v) / v + eps(V) / V) / ln 2 (the test's own arithmetic; it does
//      not call E.measure.close for the bound it checks against, and checks E.measure.close against it).
//   2. Hand-coded transfer functions and the index rule round(|t| * 255) (as in readout.test.js).
//   3. The cancellation vector of the design: bv = 5,000,000,000.000 and v = 10,000,000,000.000 against
//      bv' = 5,000,000,000.004 and v' = 9,999,999,999.99 give Delta 0 and about 0.018, both within the
//      propagated 0.02, while the relative error of the pair is infinite (A-35).
//   4. The documented Rank jump (API.md C.3): a value AT a duplicate group's knot maps to the midpoint of the
//      group's first and last q (0.25 for a group that spans q = 0 .. 0.5), one ulp above it to about 0.5: a
//      64-index step that is expected, not a bug.
//   5. The Lut of part 11, for the colours.
// The module may run in a vm context (ENCODING_PARTS_DIR), so records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const { mulberry32 } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));

const GEOM = { BASE: 56.25, PR: 125 };
const LEVEL = { n: 4, m: 1 };
const LUT = E.lut.build("slate2", "light");
const U = 26791234.56;
const K = 48211.3;
const LOGU = () => E.scale.manual({ kind: "value-log1p", signed: false, U, k: K }).descriptor;
const idxOf = (t) => Math.round(Math.min(1, Math.abs(t)) * 255);
const eps = (x) => 1e-12 * Math.abs(x) + 1e-12;

function spec(mode, desc, extra = {}) {
  const fixed = mode === "flow" || mode === "flowtrades" || mode === "dwell" || mode === "cascade";
  return Object.assign(
    {
      mode,
      basis: mode === "intensity" ? "intensity" : "amount",
      level: LEVEL,
      bounds: [3200, 3264, 400, 416],
      cut: 3264,
      geom: GEOM,
      CUT: 3300,
      mapping: fixed ? desc : { state: "ok", desc, policy: "explore", origin: "fit" },
      lut: LUT,
    },
    extra,
  );
}
const frameOf = (mode, desc, extra) => E.readout.cellsFrame(spec(mode, desc, extra));

// ---- identical input, identical output --------------------------------------------------------------------

test("T-equivalence: identical canonical record + descriptor + appearance + theme gives deep-equal readout, coordinate, index and legend", () => {
  const next = mulberry32(7);
  const cells = Array.from({ length: 60 }, (_, i) => ({ c: 200 + (i % 4), r: 200 + Math.floor(i / 4) % 8, v: Math.pow(10, next() * 6), bv: next() * 1e5, ct: 1 + Math.floor(next() * 40), bt: 1, p: next() * 10, w: 1 }));
  for (const mode of ["volume", "delta", "size", "trades"]) {
    const desc = () => (mode === "delta" ? E.scale.manual({ kind: "value-log1p", signed: true, U: 1e6, k: 1e4 }).descriptor : LOGU());
    // Two frames built from separately constructed but identical inputs (fresh descriptor objects, fresh specs).
    const f1 = frameOf(mode, desc());
    const f2 = frameOf(mode, desc());
    const o1 = {};
    const o2 = {};
    for (const z of cells) {
      f1.encode(z, o1);
      f2.encode(z, o2);
      assert.deepEqual(plain(o1), plain(o2), `${mode} encode`);
      assert.equal(JSON.stringify(f1.readout(z)), JSON.stringify(f2.readout(z)), `${mode} readout`);
    }
    assert.equal(JSON.stringify(E.legend.build(f1, null, String, {})), JSON.stringify(E.legend.build(f2, null, String, {})), `${mode} legend`);
    assert.equal(f1.fingerprint(), f2.fingerprint());
  }
  // The appearance and theme are part of the identity: another theme changes the colours and nothing numeric.
  const dark = E.readout.cellsFrame(spec("volume", LOGU(), { lut: E.lut.build("slate2", "dark") }));
  const light = frameOf("volume", LOGU());
  const z = cells[3];
  const a = {};
  const b = {};
  light.encode(z, a);
  dark.encode(z, b);
  assert.equal(a.idx, b.idx);
  assert.equal(a.t, b.t);
  assert.notEqual(a.css, b.css);
});

// ---- the cancellation vector (A-35) -------------------------------------------------------------------------

test("T-equivalence: the design's cancellation vector is equivalent within the PROPAGATED tolerance while the relative error is infinite", () => {
  const A = { c: 201, r: 203, bv: 5000000000.0, v: 10000000000.0, ct: 10, bt: 5 };
  const B = { c: 201, r: 203, bv: 5000000000.004, v: 9999999999.99, ct: 10, bt: 5 };
  const desc = E.scale.manual({ kind: "value-log1p", signed: true, U: 1e10, k: 1e7 }).descriptor;
  const frame = frameOf("delta", desc);
  const a = {};
  const b = {};
  frame.encode(A, a);
  frame.encode(B, b);
  assert.equal(a.value, 0, "a balanced cell");
  assert.ok(Math.abs(b.value - 0.018) < 1e-5, `delta of the perturbed cell is ${b.value}`);
  // The propagated bound of the reference record (the test's own arithmetic) covers the pair; the relative
  // error of a value against a zero does not exist.
  const bound = 2 * eps(A.bv) + eps(A.v);
  assert.ok(Math.abs(bound - 0.02) < 1e-9, `bound ${bound}`);
  assert.ok(Math.abs(a.value - b.value) <= bound, "equivalent within the propagated tolerance");
  assert.equal(Math.abs(a.value - b.value) / Math.abs(a.value), Infinity, "a relative tolerance on the result would call them different");
  assert.ok(E.measure.close.delta(a.value, b.value, A.bv, A.v), "E.measure.close.delta agrees with the hand-written bound");
  assert.ok(!E.measure.close.delta(a.value, 0.05, A.bv, A.v), "and refuses a difference beyond it");
  // Colours within one index, and the arm's entry 0 IS the midpoint colour, so the zero and the tiny positive agree.
  assert.ok(Math.abs(a.idx - b.idx) <= 1, `indices ${a.idx} and ${b.idx}`);
  assert.equal(a.css, LUT.midpoint.css);
  assert.equal(b.css, LUT.positive.css[b.idx]);
  assert.equal(LUT.positive.css[0], LUT.midpoint.css);
  assert.equal(LUT.negative.css[0], LUT.midpoint.css);
  assert.deepEqual(Array.from(LUT.positive.rgb.slice(0, 3)), Array.from(LUT.midpoint.rgb), "LUT midpoint == arm 0");
  // The readouts: the same classification of role at the two ends of the tolerance.
  assert.equal(frame.readout(A).coordinate.role, "midpoint");
  assert.equal(frame.readout(B).coordinate.role, "positive");
});

test("T-equivalence: near-equal volumes (1e-13 apart) read equivalent within the propagated tolerance and within one LUT index", () => {
  const next = mulberry32(11);
  const frame = frameOf("volume", LOGU());
  const a = {};
  const b = {};
  for (let i = 0; i < 400; i++) {
    const v = Math.pow(10, next() * 7);
    const w = v * (1 + 1e-13);
    frame.encode({ c: 201, r: 203, v }, a);
    frame.encode({ c: 201, r: 203, v: w }, b);
    assert.ok(Math.abs(a.value - b.value) <= eps(v) + eps(w), "the amounts themselves");
    assert.ok(E.measure.close.usdt(a.value, b.value));
    assert.ok(Math.abs(a.idx - b.idx) <= 1, `${v}: ${a.idx} vs ${b.idx}`);
    assert.ok(Math.abs(a.t - b.t) <= 1e-12);
  }
  // A log ratio: the propagated error of log2(4 v / V) from the two amounts.
  const cascade = (child, parent) => (z, o) => {
    o.tag = 0;
    o.value = Math.log2((4 * child) / parent);
    o.reason = null;
    o.denominator = null;
  };
  const V = 3.3e6;
  const v = 8.1e5;
  const f1 = E.readout.cellsFrame(spec("cascade", E.scale.fixed("log2-ratio"), { cascade: cascade(v, V) }));
  const f2 = E.readout.cellsFrame(spec("cascade", E.scale.fixed("log2-ratio"), { cascade: cascade(v * (1 + 1e-13), V * (1 - 1e-13)) }));
  f1.encode({ c: 1, r: 1 }, a);
  f2.encode({ c: 1, r: 1 }, b);
  const log2Eps = (eps(v) / v + eps(V) / V) / Math.LN2;
  assert.ok(Math.abs(a.value - b.value) <= 2 * log2Eps, "within the propagated log-ratio bound");
  assert.ok(E.measure.close.log2(a.value, b.value, v, V), "E.measure.close.log2 agrees");
  assert.ok(Math.abs(a.idx - b.idx) <= 1);
});

test("T-equivalence: Intensity with a tiny positive exposure is finite and unfloored; the same input gives the same number (motion floors)", () => {
  // A rectangle that covers 1e-6 of a base column of the cell: seconds = 5.625e-5, never floored to a minimum.
  const sliver = spec("volume", LOGU(), { basis: "intensity", bounds: [3215.999999, 3264, 400, 416] });
  const z = { c: 200, r: 203, v: 1000, bv: 400, ct: 5, bt: 2 };
  const out = {};
  E.readout.cellsFrame(sliver).encode(z, out);
  const seconds = (3216 - 3215.999999) * 56.25;
  const width = 2 * 125;
  assert.equal(out.tag, 0);
  assert.ok(Math.abs(out.value / ((1000 * 60 * 125) / (seconds * width)) - 1) < 1e-6, "amount * 60 * 125 / (seconds * width), no floor");
  assert.equal(out.short, true);
  assert.equal(out.clip, E.scale.CLIP.HIGH, "it lies far above the scale and is counted, not hidden");
  const again = {};
  E.readout.cellsFrame(sliver).encode(z, again);
  assert.equal(again.value, out.value, "deterministic");
});

// ---- both sides of every boundary -----------------------------------------------------------------------------------

test("T-equivalence: the clip at U, both sides: U, U(1+1e-13) and U(1-1e-13) all take index 255 and differ only in the clip code", () => {
  const frame = frameOf("volume", LOGU());
  const out = {};
  const at = (v) => {
    frame.encode({ c: 201, r: 203, v }, out);
    return { idx: out.idx, t: out.t, clip: out.clip, role: out.role };
  };
  const exact = at(U);
  const above = at(U * (1 + 1e-13));
  const below = at(U * (1 - 1e-13));
  assert.ok(U * (1 + 1e-13) > U && U * (1 - 1e-13) < U, "the three are different doubles");
  assert.equal(exact.idx, 255);
  assert.equal(above.idx, 255);
  assert.equal(below.idx, 255);
  assert.equal(exact.clip, E.scale.CLIP.EXACT_HIGH, "exactly on the endpoint: drawn at the end, not out of range");
  assert.equal(above.clip, E.scale.CLIP.HIGH);
  assert.equal(below.clip, E.scale.CLIP.NONE);
  assert.equal(exact.t, 1);
  assert.equal(above.t, 1, "only the drawing coordinate is clipped");
  assert.ok(below.t > 1 - 1e-12 && below.t <= 1);
  // The raw value stays in the readout (S1-071).
  assert.equal(frame.readout({ c: 201, r: 203, v: U * (1 + 1e-13) }).supplied.value, U * (1 + 1e-13));
  assert.equal(frame.readout({ c: 201, r: 203, v: U * (1 + 1e-13) }).coordinate.clip, "high");
});

test("T-equivalence: the sign boundary at 0: a measured zero is the midpoint, the smallest values either side take entry 0 of their arm, which is the midpoint colour", () => {
  const desc = E.scale.manual({ kind: "value-log1p", signed: true, U: 1e6, k: 1e4 }).descriptor;
  const frame = frameOf("delta", desc);
  const out = {};
  const delta = (d) => {
    frame.encode({ c: 201, r: 203, v: 2e3, bv: 1e3 + d / 2, ct: 1 }, out);
    return { role: out.role, idx: out.idx, css: out.css, value: out.value };
  };
  const zero = delta(0);
  const plus = delta(1e-9);
  const minus = delta(-1e-9);
  assert.equal(zero.value, 0);
  assert.equal(zero.role, E.readout.ROLE.MIDPOINT);
  assert.equal(plus.role, E.readout.ROLE.POSITIVE);
  assert.equal(minus.role, E.readout.ROLE.NEGATIVE);
  assert.equal(plus.idx, 0);
  assert.equal(minus.idx, 0);
  assert.equal(plus.css, zero.css, "the colours agree across the sign boundary");
  assert.equal(minus.css, zero.css);
  // -0 is a zero as well: it must not select the negative arm.
  frame.encode({ c: 201, r: 203, v: 0, bv: -0, ct: 1 }, out);
  assert.equal(out.role, E.readout.ROLE.MIDPOINT);
});

test("T-equivalence: a Rank value at an exact persisted knot is deterministic and identical for identical input; one ulp above it stays within one index", () => {
  // 257 distinct knots: knots[j] = 10 + j (the value 10 + j sits at t = j / 256 by the definition of the table).
  const knots = Array.from({ length: 257 }, (_, j) => 10 + j);
  const make = () => {
    const desc = { v: 1, id: "", kind: "rank-type7-257", signed: false, params: { knots: knots.slice(), q: "j/256" }, clip: "clamp01@1", algorithm: "type7-257@1" };
    desc.id = E.scale.id(desc);
    return desc;
  };
  const f1 = frameOf("volume", make());
  const f2 = frameOf("volume", make());
  const a = {};
  const b = {};
  for (const j of [1, 2, 64, 128, 255]) {
    f1.encode({ c: 1, r: 1, v: 10 + j }, a);
    f2.encode({ c: 1, r: 1, v: 10 + j }, b);
    assert.deepEqual(plain(a), plain(b), `knot ${j}`);
    assert.ok(Math.abs(a.t - j / 256) < 1e-12, `the value at knot ${j} sits at q = ${j / 256}: ${a.t}`);
    assert.equal(a.idx, idxOf(j / 256));
    const up = 10 + j + 1e-9;
    f1.encode({ c: 1, r: 1, v: up }, b);
    assert.ok(Math.abs(b.idx - a.idx) <= 1, `one step above knot ${j}`);
  }
});

test("T-equivalence: the DOCUMENTED Rank jump: at a duplicate group's knot the value takes the midpoint of the group (0.25), one ulp above it about 0.5: a 64-index step", () => {
  // Knots 0..128 are all 1 (a group spanning q = 0 .. 0.5), then rise linearly to 2.
  const knots = Array.from({ length: 257 }, (_, j) => (j <= 128 ? 1 : 1 + (j - 128) / 128));
  const desc = { v: 1, id: "", kind: "rank-type7-257", signed: false, params: { knots, q: "j/256" }, clip: "clamp01@1", algorithm: "type7-257@1" };
  desc.id = E.scale.id(desc);
  const frame = frameOf("volume", desc);
  const out = {};
  frame.encode({ c: 1, r: 1, v: 1 }, out);
  const atKnot = { t: out.t, idx: out.idx };
  const ulp = 1 + Number.EPSILON;
  frame.encode({ c: 1, r: 1, v: ulp }, out);
  const above = { t: out.t, idx: out.idx };
  assert.equal(atKnot.t, 0.25, "midpoint of the group's first and last q");
  assert.ok(Math.abs(above.t - 0.5) < 1e-6, `one ulp above: ${above.t}`);
  assert.equal(atKnot.idx, idxOf(0.25));
  assert.equal(atKnot.idx, 64);
  assert.equal(above.idx, 128);
  assert.equal(above.idx - atKnot.idx, 64, "a 64-index step: expected, not a bug");
  // Identical input gives the identical answer on both sides, every time.
  for (let i = 0; i < 3; i++) {
    frame.encode({ c: 1, r: 1, v: 1 }, out);
    assert.equal(out.t, 0.25);
  }
});

test("T-equivalence: smooth-region pairs within 1e-12 relative are within one LUT index (Value log, Value linear, fixed shares)", () => {
  const next = mulberry32(99);
  const a = {};
  const b = {};
  const checks = [
    ["volume", LOGU(), (x) => ({ c: 1, r: 1, v: x, bv: 0, ct: 1, bt: 0 }), () => K + next() * (U - K)],
    ["volume", E.scale.manual({ kind: "value-linear", signed: false, U: 1e6 }).descriptor, (x) => ({ c: 1, r: 1, v: x, bv: 0, ct: 1, bt: 0 }), () => 1 + next() * 1e6],
    ["flow", E.scale.fixed("share-diverging"), (x) => ({ c: 1, r: 1, v: 1, bv: x, ct: 1, bt: 0 }), () => next()],
  ];
  for (const [mode, desc, cellOf, draw] of checks) {
    const f = frameOf(mode, desc);
    for (let i = 0; i < 300; i++) {
      const x = draw();
      f.encode(cellOf(x), a);
      f.encode(cellOf(x * (1 + 1e-12)), b);
      assert.ok(Math.abs(a.idx - b.idx) <= 1, `${mode} ${x}: ${a.idx} vs ${b.idx}`);
    }
  }
});

// ---- no input rounding -----------------------------------------------------------------------------------------------------

// Comments and string contents blanked, so the scan reads code only.
function codeOf(fn) {
  const src = fn.toString();
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

test("T-equivalence: no input is rounded anywhere on the value path (no toFixed, toPrecision, Math.round, floor, trunc, parseFloat in encode, cellValue or a plan)", () => {
  const forbidden = /toFixed|toPrecision|Math\.round|Math\.floor|Math\.ceil|Math\.trunc|parseFloat|parseInt|Math\.fround/;
  const functions = new Map();
  functions.set("E.measure.cellValue", E.measure.cellValue);
  functions.set("cells encode", frameOf("volume", LOGU()).encode);
  functions.set("rows encode", E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc: LOGU() }, lut: LUT }).encode);
  functions.set("pane encode", E.readout.paneFrame({ key: "volume", axis: { id: "p", sign: "unsigned", typed: "finite", domain: [0, 1], mappingId: "x" }, lut: LUT }).encode);
  const descriptors = {
    log: LOGU(),
    logSigned: E.scale.manual({ kind: "value-log1p", signed: true, U: 10, k: 1 }).descriptor,
    linear: E.scale.manual({ kind: "value-linear", signed: false, U: 10 }).descriptor,
    rank: E.scale.fitRank([1, 2, 3, 4, 5]).descriptor,
    fixedLinear: E.scale.fixed("unsigned-share"),
    fixedDiverging: E.scale.fixed("share-diverging"),
    zero: E.scale.zeroOnly(false),
  };
  for (const [name, desc] of Object.entries(descriptors)) functions.set("plan " + name, E.scale.plan(desc).apply);
  for (const [name, fn] of functions) {
    const code = codeOf(fn);
    assert.ok(code.length > 20, name + " was read");
    assert.ok(!forbidden.test(code), `${name} rounds something: ${(code.match(forbidden) || [""])[0]}`);
  }
  // The one rounding of the module is the INDEX of a coordinate (a table position), not an input.
  assert.ok(/Math\.round/.test(codeOf(E.scale.index)));
});

test("T-equivalence: the readout reports the value exactly as measured, however many digits it has", () => {
  const frame = frameOf("volume", LOGU());
  for (const v of [0.1 + 0.2, 1 / 3, 123456789.123456789, 5e-324, 1.7976931348623157e300]) {
    const r = frame.readout({ c: 201, r: 203, v, bv: 0, ct: 1, bt: 0 });
    assert.equal(r.observed.value, v, "observed amount, bit for bit");
    assert.equal(r.supplied.value, v);
    assert.equal(r.typed.value, v);
  }
});
