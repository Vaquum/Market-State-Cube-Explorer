"use strict";
// U21 (T-readout): E.readout of src/encoding.js, loaded through tests/support/enc.js. The structural
// equality guarantee of API.md C.16 / DR-22 / DR-29: one frame, one kernel, so the encoder, the tooltip
// numbers, the table row and the legend marker cannot disagree.
//
// Oracles (none is the code under test):
//   1. A hand-coded measure for every mode: volume z.v, trades z.ct, delta 2*bv - v, size v/ct, flow bv/v,
//      flowtrades bt/ct, path and dwell from the test's own exposure arithmetic (covered base columns times
//      56.25 s, covered base rows times 125 USDT, API.md C.1.3), Intensity amount*60*125/(seconds*width).
//   2. A hand-coded transfer function per descriptor kind (log1p, linear, fixed-linear, fixed-diverging,
//      zero-only) and the index rule round(clamp(|t|, 0, 1) * 255): the test never calls E.scale.apply or
//      E.scale.index to decide an expectation.
//   3. The Lut is read from E.lut.build (part 11, tested on its own against d3 in U18): the test only
//      asserts that the frame picks the entry the hand-coded index names.
//   4. Seeded fixtures (tests/support/rng.js mulberry32) and hand vectors: the cell c=200 at level (4, 1)
//      covers base columns 3200..3216 and base rows 400..402, and so on.
// Tests that need part 14-policy (E.policy.resolve produces the mapping) or 17-warn (E.warn feeds the
// warnings stored in a readout) are t.todo while the part is absent and must turn green at assembly.
// The module may run in a vm context (ENCODING_PARTS_DIR), so records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const { mulberry32 } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;

// ---- fixtures -------------------------------------------------------------------------------------------

const GEOM = { BASE: 56.25, PR: 125 };
const LEVEL = { n: 4, m: 1 }; // ts = 16 base columns, ps = 2 base rows
const TS = 16;
const PS = 2;
// The measured rectangle [t0, t1, r0, r1] in base units: columns 200..203, rows 200..207, and the cut and
// the live edge fall inside column 203.
const BOUNDS = [3200, 3264, 400, 416];
const CUT = 3250;
const LIVE = 3258;
const TAG = {};
E.result.TAGS.forEach((name, i) => (TAG[name] = i));

// 32 cells of the rectangle plus two that stick out of it (column 204 is beyond t1, row 199 below r0), by
// a seeded generator. Every value is hand-checkable: v 1..1e6, bv between 0 and v, ct 1..500 (one cell has
// 0 trades, one has no volume), path and dwell within what the cell's own exposure allows.
function cells(seed) {
  const next = mulberry32(seed);
  const out = [];
  for (let c = 200; c <= 204; c++) {
    for (let r = 199; r <= 207; r++) {
      if ((c === 204 && r !== 203) || (r === 199 && c !== 201)) continue;
      const v = Math.pow(10, next() * 6);
      const ct = 1 + Math.floor(next() * 500);
      const ex = exposure({ c, r }, BOUNDS);
      out.push({ c, r, v, bv: v * next(), ct, bt: Math.floor(next() * (ct + 1)), p: next() * 40, w: next() * ex.seconds });
    }
  }
  out.push({ c: 202, r: 210, v: 0, bv: 0, ct: 0, bt: 0, p: 0, w: 0 }); // a cell with nothing to divide by
  return out;
}

// The test's own exposure: covered base columns and rows of a cell inside the rectangle, the cutoff and (for
// motion) an optional end. Seconds = columns * BASE, width = rows * PR.
function exposure(z, b, end = Infinity) {
  const dt = Math.max(0, Math.min((z.c + 1) * TS, b[1], CUT, end) - Math.max(z.c * TS, b[0]));
  const dp = Math.max(0, Math.min((z.r + 1) * PS, b[3]) - Math.max(z.r * PS, b[2]));
  return { dt, dp, seconds: dt * GEOM.BASE, width: dp * GEOM.PR, tf: dt / TS, pf: dp / PS };
}

// Mapping constants of the hand-coded transfer functions.
const U = 26791234.56;
const K = 48211.3;
const SU = 1204551.25;
const SK = 8830.5;
const LOGU = E.scale.manual({ kind: "value-log1p", signed: false, U, k: K }).descriptor;
const LOGS = E.scale.manual({ kind: "value-log1p", signed: true, U: SU, k: SK }).descriptor;
const LINU = E.scale.manual({ kind: "value-linear", signed: false, U }).descriptor;
const SHARE = E.scale.fixed("share-diverging");
const DWELL = E.scale.fixed("unsigned-share");
const LOG2 = E.scale.fixed("log2-ratio");

// t of a value under a descriptor, by the formulas of API.md B.5 (hand-coded; clip to the window).
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
      throw new Error("no oracle for " + desc.kind);
  }
}
const idxOf = (t) => Math.round(Math.min(1, Math.abs(t)) * 255);

// The Cascade entry of a stub level: even columns have a complete parent and a child (finite log2(4 child /
// parent)), a column 1 mod 4 has a parent with no child volume (negative-infinite), 3 mod 4 is waiting.
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

// One row of the mode table: how the test measures and maps a mode by hand.
const MODES = [
  { mode: "volume", basis: "amount", desc: LOGU, signed: false, value: (z) => z.v },
  { mode: "volume", basis: "amount", desc: LINU, signed: false, value: (z) => z.v, name: "volume linear" },
  { mode: "trades", basis: "amount", desc: LOGU, signed: false, value: (z) => z.ct },
  { mode: "delta", basis: "amount", desc: LOGS, signed: true, value: (z) => 2 * z.bv - z.v },
  {
    mode: "volume",
    basis: "intensity",
    desc: LOGU,
    signed: false,
    value: (z) => {
      const e = exposure(z, BOUNDS);
      return e.seconds <= 0 || e.width <= 0 ? null : (z.v * 60 * 125) / (e.seconds * e.width);
    },
    name: "volume intensity",
  },
  { mode: "size", basis: "mean", desc: LOGU, signed: false, value: (z) => (z.ct === 0 ? null : z.v / z.ct) },
  { mode: "flow", basis: "share", desc: SHARE, signed: true, value: (z) => (z.v <= 0 ? null : z.bv / z.v) },
  { mode: "flowtrades", basis: "share", desc: SHARE, signed: true, value: (z) => (z.ct <= 0 ? null : z.bt / z.ct) },
  {
    mode: "path",
    pathBasis: "spans",
    desc: LOGU,
    signed: false,
    end: 3300,
    value: (z) => {
      const e = exposure(z, BOUNDS, 3300);
      return e.width <= 0 ? null : z.p / e.width;
    },
    name: "path spans",
  },
  { mode: "path", pathBasis: "usdt", desc: LOGU, signed: false, end: 3300, value: (z) => z.p, name: "path usdt" },
  {
    mode: "dwell",
    basis: "share",
    desc: DWELL,
    signed: false,
    end: 3300,
    value: (z) => {
      const e = exposure(z, BOUNDS, 3300);
      return e.seconds <= 0 ? null : z.w / e.seconds;
    },
  },
  { mode: "cascade", basis: "log2", desc: LOG2, signed: true, cascade: cascadeEntry, value: (z) => (z.v > 0 && z.c % 2 === 0 ? Math.log2((4 * z.v) / PARENT) : null) },
];

function nameOf(m) {
  return m.name || m.mode;
}

const LUTS = { light: E.lut.build("slate2", "light"), dark: E.lut.build("slate2", "dark") };

function specOf(m, theme, extra = {}) {
  return Object.assign(
    {
      mode: m.mode,
      basis: m.basis,
      pathBasis: m.pathBasis,
      level: LEVEL,
      bounds: BOUNDS,
      cut: CUT,
      end: m.end,
      geom: GEOM,
      CUT: LIVE,
      replay: false,
      mapping: m.mode === "flow" || m.mode === "flowtrades" || m.mode === "dwell" || m.mode === "cascade" ? m.desc : { state: "ok", desc: m.desc, policy: "explore", origin: "fit" },
      lut: LUTS[theme],
      cascade: m.cascade || null,
      observation: { source: "fixture", instrument: "BTC/USDT", read: "cube", cutoffMs: 1790251320000, liveCutoffMs: 1790251320000, canonicalThroughMs: 1790208000000, token: null, provenance: ["provisional-tail"] },
    },
    extra,
  );
}

// The table of role names that have a colour table, to read lut[role].css[idx].
function cssAt(lut, roleName, idx) {
  if (roleName === "unsigned") return lut.unsigned.css[idx];
  if (roleName === "positive") return lut.positive.css[idx];
  if (roleName === "negative") return lut.negative.css[idx];
  if (roleName === "rows") return lut.rows.css[idx];
  if (roleName === "midpoint") return lut.midpoint.css;
  return lut.occupancy.css;
}

const ROLE_NAME = ["none", "unsigned", "positive", "negative", "midpoint", "pattern", "occupancy", "zero", "rows"];
const FIXTURE = cells(2026);

// ---- the structural equality guarantee --------------------------------------------------------------------

for (const theme of ["light", "dark"]) {
  for (const m of MODES) {
    test(`T-readout: ${nameOf(m)} (${theme}): encode and readout of every cell agree with the hand-coded measure, index and colour`, () => {
      const frame = E.readout.cellsFrame(specOf(m, theme));
      const out = {};
      let finite = 0;
      for (const z of FIXTURE) {
        frame.encode(z, out);
        const r = frame.readout(z);
        const want = m.value(z);
        if (want === null) {
          // A non-value: a pattern (or nothing), never a colour; the readout carries the typed tag and no coordinate.
          assert.notEqual(out.tag, 0, `${nameOf(m)} ${z.c},${z.r}: a typed non-value`);
          assert.ok(out.css === null, "a non-value has no fill colour");
          assert.equal(r.coordinate, null);
          assert.notEqual(r.typed.tag, "finite");
          assert.equal(r.supplied, null);
          continue;
        }
        finite++;
        assert.equal(out.tag, 0, `${nameOf(m)} ${z.c},${z.r}`);
        // The measurement: the kernel's number is the oracle's (same double arithmetic, one operation order).
        assert.ok(Math.abs(out.value - want) <= 1e-12 * Math.abs(want) + 1e-12, `${nameOf(m)} ${z.c},${z.r}: value ${out.value} vs ${want}`);
        // The coordinate and the index, by the hand-coded transfer function.
        const t = tOf(m.desc, out.value);
        assert.ok(Math.abs(out.t - t) <= 1e-12, `t ${out.t} vs ${t}`);
        if (m.signed) {
          const role = t > 0 ? "positive" : t < 0 ? "negative" : "midpoint";
          assert.equal(ROLE_NAME[out.role], role);
          assert.equal(out.idx, t === 0 ? 0 : idxOf(t), "arm index");
        } else if (out.value === 0) {
          assert.equal(ROLE_NAME[out.role], "zero");
          assert.equal(out.idx, -1);
        } else {
          assert.equal(ROLE_NAME[out.role], "unsigned");
          assert.equal(out.idx, idxOf(t), `${nameOf(m)} ${z.c},${z.r}: index`);
        }
        // The colour is the Lut entry of that role and index.
        assert.equal(out.css, cssAt(LUTS[theme], ROLE_NAME[out.role], out.idx));
        // The readout states the SAME numbers (DR-22).
        assert.equal(r.coordinate.idx, out.idx);
        assert.equal(r.coordinate.role, ROLE_NAME[out.role]);
        assert.equal(r.coordinate.t, out.t);
        assert.equal(r.typed.tag, "finite");
        assert.equal(r.typed.value, out.value);
        assert.equal(r.supplied.value, out.value);
        assert.equal(r.level.n, LEVEL.n);
        assert.equal(r.level.m, LEVEL.m);
        assert.equal(r.key, z.c * 2097152 + z.r);
      }
      assert.ok(finite >= 10, `${nameOf(m)}: the fixture exercises values (${finite})`);
    });
  }
}

test("T-readout: the observed amount of the readout is the aggregated amount the tooltip prints (Amount, Intensity, Delta, Path, Dwell)", () => {
  const z = FIXTURE.find((c) => c.c === 201 && c.r === 203);
  const at = (name) => MODES.find((m) => nameOf(m) === name);
  const read = (m) => E.readout.cellsFrame(specOf(m, "light")).readout(z);
  assert.equal(read(at("volume")).observed.value, z.v);
  assert.equal(read(at("volume")).observed.unit, "usdt");
  assert.equal(read(at("trades")).observed.value, z.ct);
  assert.equal(read(at("trades")).observed.unit, "trades");
  assert.equal(read(at("delta")).observed.value, 2 * z.bv - z.v, "Delta: the signed amount");
  // Intensity divides the SAME amount: the numerator is the observed amount, the value is the rate.
  const iv = read(at("volume intensity"));
  assert.equal(iv.observed.value, z.v);
  assert.equal(iv.observed.unit, "usdt");
  assert.notEqual(iv.supplied.value, iv.observed.value, "observed amount, supplied rate and coordinate are different quantities");
  assert.equal(iv.supplied.unit, "usdt-per-min-per-125usdt");
  assert.equal(read(at("path usdt")).observed.value, z.p);
  assert.equal(read(at("dwell")).observed.unit, "seconds");
});

test("T-readout: the legend marker of a record equals its coordinate and the tick the value would get (one record, four consumers)", (t) => {
  if (E.legend === undefined) {
    t.skip("part 20-legend is not loaded (standalone form ENCODING_ONLY=readout); runs in every other form");
    return;
  }
  const frame = E.readout.cellsFrame(specOf(MODES[0], "light"));
  const legend = E.legend.build(frame, null, null, {});
  for (const z of FIXTURE.slice(0, 20)) {
    const r = frame.readout(z);
    const marker = E.legend.marker(legend, r);
    assert.equal(marker.t, r.coordinate.t, "the marker is the record's coordinate");
    assert.equal(marker.t, tOf(LOGU, z.v), "and the hand-coded tick position of the value");
    assert.equal(marker.clip, r.coordinate.clip);
    // The encoder's number, the tooltip's number, the marker's number: from one record.
    const out = {};
    frame.encode(z, out);
    assert.equal(out.t, marker.t);
    assert.equal(out.value, r.observed.value);
  }
});

// ---- record shape (B.10, D1) ---------------------------------------------------------------------------------

test("T-readout: a cells readout has every field of B.10 and the D1 groups, JSON-safe, with the four quantities apart", () => {
  const m = MODES[0];
  const z = FIXTURE.find((c) => c.c === 203 && c.r === 204);
  const r = E.readout.cellsFrame(specOf(m, "light", { model: null })).readout(z, { interaction: "hover", warnings: ["range-exceeded"] });
  assert.deepEqual(Object.keys(r).sort(), ["consumer", "coordinate", "exposure", "key", "level", "level2", "measure", "model", "observation", "observed", "scale", "state", "support", "supplied", "typed", "v", "when"].sort());
  assert.equal(r.v, 1);
  assert.equal(r.consumer, "cells");
  assert.deepEqual(plain(r.measure), { formula: "cells.volume.amount@1", measure: "volume", basis: "amount", unit: "usdt" });
  // Observation: source, instrument, effective level, read state, cutoff, canonical, opaque token or null, limitations.
  assert.equal(r.observation.source, "fixture");
  assert.equal(r.observation.instrument, "BTC/USDT");
  assert.deepEqual(plain(r.observation.level), { n: 4, m: 1 });
  assert.equal(r.observation.read, "cube");
  assert.equal(r.observation.cutoffMs, 1790251320000);
  assert.equal(r.observation.canonicalThroughMs, 1790208000000);
  assert.equal(r.observation.token, null);
  assert.deepEqual(plain(r.observation.provenance), ["provisional-tail"]);
  // Scale: id, policy, kind, origin, state, warnings.
  assert.equal(r.scale.id, E.scale.id(LOGU));
  assert.equal(r.scale.kind, "value-log1p");
  assert.equal(r.scale.policy, "explore");
  assert.equal(r.scale.origin, "fit");
  assert.equal(r.scale.state, "ok");
  assert.deepEqual(plain(r.scale.warnings), ["range-exceeded"]);
  assert.equal(r.scale.external, false);
  // State dimensions stay independent (D7).
  assert.deepEqual(plain(r.state), { occupancy: "occupied", validity: "defined", read: "cube", finality: "open", calibration: "ok", interaction: "hover" });
  // Support: time [max(c*16, 3200), min(204*16 = 3264, 3264, cut 3250)] = [3248, 3250], rows 204*2 = 408..410.
  assert.deepEqual(plain(r.support), { time: [3248, 3250], price: [408, 410], portion: false, open: true, partial: true });
  assert.equal(r.exposure, null, "Amount has no exposure denominator");
  // when: the cell's start and its end clipped to the cutoff; knownAt stays null with its reason (A-41).
  assert.equal(r.when.eventStartMs, Math.round((1609459200 + 3248 * 56.25) * 1000));
  assert.equal(r.when.eventEndMs, Math.round((1609459200 + 3250 * 56.25) * 1000));
  assert.equal(r.when.knownAtMs, null);
  assert.equal(r.when.knownAtReason, "defined by #47");
  assert.equal(r.model, null);
  assert.equal(r.level2, null);
  E.result.assertJsonSafe(r);
  // No RGB and no CSS colour anywhere in the record: the coordinate is an index and a role, never a colour.
  const text = JSON.stringify(r);
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(text) && !/rgb\(/.test(text), "a readout carries no colour");
  assert.deepEqual(Object.keys(r.coordinate).sort(), ["clip", "idx", "role", "t"]);
});

test("T-readout: the observed amount, the supplied measurement, the coordinate and the colour are four distinct quantities", () => {
  const m = MODES.find((x) => nameOf(x) === "volume intensity");
  const z = FIXTURE.find((c) => c.c === 200 && c.r === 203);
  const frame = E.readout.cellsFrame(specOf(m, "light"));
  const r = frame.readout(z);
  const out = {};
  frame.encode(z, out);
  const e = exposure(z, BOUNDS);
  assert.equal(r.observed.value, z.v);
  assert.ok(Math.abs(r.supplied.value - (z.v * 60 * 125) / (e.seconds * e.width)) < 1e-9);
  assert.equal(typeof r.coordinate.t, "number");
  assert.equal(typeof r.coordinate.idx, "number");
  assert.equal(out.css, LUTS.light.unsigned.css[r.coordinate.idx], "the colour is derivable from the index");
  assert.ok(r.exposure !== null, "Intensity carries the exposure");
  assert.deepEqual(plain(r.exposure.uses), { t: true, w: true });
  assert.equal(r.exposure.timeFraction, e.tf);
  assert.equal(r.exposure.priceFraction, e.pf);
  assert.equal(r.exposure.short, false);
});

test("T-readout: Short exposure is the strict <10% rule on EITHER fraction, for a measure with an exposure denominator only", () => {
  const intensity = specOf(MODES.find((x) => nameOf(x) === "volume intensity"), "light");
  const z = { c: 200, r: 203, v: 1000, bv: 400, ct: 5, bt: 2, p: 1, w: 1 };
  // Column 200 covers base columns 3200..3216; a rectangle that starts 1 base column before its end leaves
  // 1/16 = 0.0625 < 0.1, one that leaves 1.7 leaves 0.10625 >= 0.1, one that leaves 1.5 leaves 0.09375.
  const withStart = (t0) => E.readout.cellsFrame(Object.assign({}, intensity, { bounds: [t0, 3264, 400, 416] })).readout(z).exposure;
  assert.equal(withStart(3215).timeFraction, 1 / 16);
  assert.equal(withStart(3215).short, true);
  assert.equal(withStart(3214.5).short, true, "0.09375");
  assert.equal(withStart(3214.3).short, false, "0.10625");
  assert.equal(withStart(3200).short, false);
  assert.equal(withStart(3200).timeFraction, 1);
  // The price fraction alone makes a Dwell cell short (DR-10 "either"): cell row 203 covers base rows 406..408
  // and the rectangle ends at 406.1, so 0.1 of 2 base rows = 0.05.
  const dwell = Object.assign({}, specOf(MODES.find((x) => x.mode === "dwell"), "light"), { bounds: [3200, 3264, 400, 406.1] });
  const rd = E.readout.cellsFrame(dwell).readout({ c: 200, r: 203, v: 1, bv: 0, ct: 1, bt: 0, p: 0, w: 0.5 });
  assert.ok(rd.exposure.priceFraction < 0.1 && rd.exposure.timeFraction === 1);
  assert.equal(rd.exposure.short, true);
  assert.deepEqual(plain(rd.exposure.uses), { t: true, w: false }, "Dwell divides by covered time");
  // An Amount cell is never labelled, whatever its coverage.
  const amount = Object.assign({}, specOf(MODES[0], "light"), { bounds: [3215, 3264, 400, 416] });
  assert.equal(E.readout.cellsFrame(amount).readout(z).exposure, null);
});

test("T-readout: a typed non-value carries its tag and reason, no coordinate, and an absent child of a complete parent reads negative-infinite", () => {
  const cascade = MODES.find((m) => m.mode === "cascade");
  const frame = E.readout.cellsFrame(specOf(cascade, "light"));
  const finite = frame.readout({ c: 200, r: 203, v: 2e6, bv: 0, ct: 1, bt: 0 });
  assert.equal(finite.typed.tag, "finite");
  assert.equal(finite.typed.value, 1, "log2(4 * 2e6 / 4e6) = log2(2) = 1");
  const absent = frame.readout({ c: 201, r: 203, v: 0, bv: 0, ct: 0, bt: 0 });
  assert.equal(absent.typed.tag, "negative-infinite");
  assert.equal(absent.typed.reason, "no current volume");
  assert.equal(absent.coordinate, null);
  assert.equal(absent.supplied, null);
  assert.equal(absent.state.validity, "negative-infinite");
  const waiting = frame.readout({ c: 203, r: 203, v: 500, bv: 0, ct: 1, bt: 0 });
  assert.equal(waiting.typed.tag, "waiting-for-complete-parent");
  assert.equal(waiting.typed.open, true);
  const out = {};
  frame.encode({ c: 203, r: 203, v: 500 }, out);
  assert.equal(ROLE_NAME[out.role], "pattern");
  assert.equal(out.pattern, "pattern-slate");
  frame.encode({ c: 201, r: 203, v: 0 }, out);
  assert.equal(out.pattern, "infinity");
});

// ---- non-values, read and replay (DD-84) ---------------------------------------------------------------------

test("T-readout: each non-value tag draws its glyph, finite draws from the mapping; hidden and outside-support draw nothing", () => {
  const vol = MODES[0];
  const out = {};
  const z = { c: 201, r: 203, v: 500, bv: 1, ct: 2, bt: 1 };
  // A read that cannot answer: the tag of the read, by precedence.
  for (const [state, tag, pattern] of [["failed", "failed", "pattern-cross"], ["pending", "pending", "pattern-dots"], ["unsupported", "unsupported", "pattern-slash"]]) {
    const f = E.readout.cellsFrame(specOf(vol, "light", { read: { state, reason: "r" } }));
    f.encode(z, out);
    assert.equal(E.result.TAGS[out.tag], tag);
    assert.equal(ROLE_NAME[out.role], "pattern");
    assert.equal(out.pattern, pattern);
    assert.equal(out.css, null);
    assert.equal(out.idx, -1);
  }
  // Replay: a cell after the edge is hidden (no fill, no glyph) and a cell before it is drawn.
  const replay = E.readout.cellsFrame(specOf(vol, "light", { replay: true, cut: 3230 }));
  replay.encode({ c: 203, r: 203, v: 500 }, out);
  assert.equal(E.result.TAGS[out.tag], "hidden");
  assert.equal(ROLE_NAME[out.role], "none");
  assert.equal(out.pattern, null);
  assert.equal(out.css, null);
  replay.encode({ c: 200, r: 203, v: 500 }, out);
  assert.equal(out.tag, 0);
  assert.equal(ROLE_NAME[out.role], "unsigned");
  // Not yet measured: pending "column not complete", never a zero colour.
  const unmeasured = E.readout.cellsFrame(specOf(MODES.find((m) => m.mode === "dwell"), "light", { measured: (c) => c.c < 202 }));
  unmeasured.encode({ c: 203, r: 203, v: 1, w: 0 }, out);
  assert.equal(E.result.TAGS[out.tag], "pending");
  assert.equal(out.pattern, "pattern-dots");
  assert.equal(out.reason, "column not complete");
  // Non-finite input is invalid-input, never a NaN fill.
  const vf = E.readout.cellsFrame(specOf(vol, "light"));
  vf.encode({ c: 201, r: 203, v: NaN }, out);
  assert.equal(E.result.TAGS[out.tag], "invalid-input");
  assert.equal(out.pattern, "pattern-cross");
});

test("T-readout: the readout's read status (meas.state) outranks the arithmetic there, while the mark keeps its own read (DD-84)", () => {
  const frame = E.readout.cellsFrame(specOf(MODES[0], "light"));
  const z = { c: 201, r: 203, v: 500, bv: 1, ct: 2, bt: 1 };
  const out = {};
  frame.encode(z, out);
  assert.equal(out.tag, 0, "a pan into an unmeasured rectangle must not turn the loaded cell into a pattern");
  const r = frame.readout(z, { read: { state: "pending", reason: "measuring", updating: true } });
  assert.equal(r.typed.tag, "pending");
  assert.equal(r.typed.reason, "measuring");
  assert.equal(r.coordinate, null);
  assert.equal(r.observation.read, "pending");
  assert.equal(r.observation.updating, true);
  assert.equal(r.state.read, "pending");
  assert.equal(r.state.validity, "pending");
  const failed = frame.readout(z, { read: { state: "failed", reason: "cube_unavailable" } });
  assert.equal(failed.typed.tag, "failed");
  assert.equal(failed.typed.reason, "cube_unavailable");
  // Without an override the frame's own observation speaks.
  assert.equal(frame.readout(z).observation.read, "cube");
});

test("T-readout: a mapping with no calibration draws occupancy for values and keeps the patterns of non-values (C.16)", () => {
  const vol = MODES[0];
  const out = {};
  for (const state of ["no-calibration", "pending"]) {
    const f = E.readout.cellsFrame(specOf(vol, "light", { mapping: { state, desc: state === "pending" ? LOGU : null, reason: "uninitialized" } }));
    f.encode({ c: 201, r: 203, v: 500 }, out);
    assert.equal(ROLE_NAME[out.role], "occupancy", state);
    assert.equal(out.css, LUTS.light.occupancy.css);
    assert.equal(out.idx, -1);
    f.encode({ c: 201, r: 203, v: NaN }, out);
    assert.equal(ROLE_NAME[out.role], "pattern");
    const r = f.readout({ c: 201, r: 203, v: 500, bv: 0, ct: 1, bt: 0 });
    assert.equal(r.scale.state, state);
    assert.equal(r.scale.id, state === "pending" ? E.scale.id(LOGU) : null);
    assert.equal(r.coordinate, null, "no coordinate without a drawable mapping");
    assert.equal(r.typed.tag, "finite", "the measurement itself is still reported");
    assert.equal(r.state.calibration, state);
  }
  // "updating" keeps the retained mapping drawing (DR-06): only the legend says it is pending.
  const upd = E.readout.cellsFrame(specOf(vol, "light", { mapping: { state: "updating", desc: LOGU, policy: "explore" } }));
  upd.encode({ c: 201, r: 203, v: 500 }, out);
  assert.equal(ROLE_NAME[out.role], "unsigned");
  // A missing mapping is No calibration.
  const none = E.readout.cellsFrame(specOf(vol, "light", { mapping: null }));
  assert.equal(none.mappingState, "no-calibration");
  assert.equal(none.mappingId, "");
});

test("T-readout: geometry draws the occupancy role and carries no measurement", () => {
  const f = E.readout.cellsFrame({ mode: "geometry", level: LEVEL, bounds: BOUNDS, cut: CUT, geom: GEOM, mapping: null, lut: LUTS.dark });
  const out = {};
  f.encode({ c: 201, r: 203 }, out);
  assert.equal(ROLE_NAME[out.role], "occupancy");
  assert.equal(out.css, LUTS.dark.occupancy.css);
  assert.equal(out.tag, 0);
  const r = f.readout({ c: 201, r: 203 });
  assert.equal(r.typed, null);
  assert.equal(r.coordinate, null);
  assert.equal(r.observed, null);
  assert.equal(r.state.validity, "none");
  E.result.assertJsonSafe(r);
});

test("T-readout: zero is separately keyed: unsigned zero is the zero role (outline), signed zero the midpoint fill, index 0 is never a zero", () => {
  const out = {};
  const pathUsdt = E.readout.cellsFrame(specOf(MODES.find((m) => nameOf(m) === "path usdt"), "light"));
  pathUsdt.encode({ c: 201, r: 203, p: 0 }, out);
  assert.equal(ROLE_NAME[out.role], "zero");
  assert.equal(out.css, LUTS.light.occupancy.css);
  assert.equal(out.idx, -1);
  const r = pathUsdt.readout({ c: 201, r: 203, p: 0, v: 1, ct: 1 });
  assert.equal(r.coordinate.role, "zero");
  assert.equal(r.typed.value, 0, "a defined zero is finite");
  const delta = E.readout.cellsFrame(specOf(MODES.find((m) => m.mode === "delta"), "light"));
  delta.encode({ c: 201, r: 203, v: 200, bv: 100, ct: 2 }, out);
  assert.equal(ROLE_NAME[out.role], "midpoint", "balanced Delta");
  assert.equal(out.css, LUTS.light.midpoint.css);
  assert.equal(out.t, 0);
  assert.equal(out.value, 0);
  // The smallest positive value takes index 0 of its arm, whose colour IS the midpoint (arms start at it).
  delta.encode({ c: 201, r: 203, v: 200, bv: 100 + 1e-9, ct: 2 }, out);
  assert.equal(ROLE_NAME[out.role], "positive");
  assert.equal(out.idx, 0);
  assert.equal(out.css, LUTS.light.midpoint.css, "positive arm entry 0 equals the midpoint colour");
});

// ---- frame behaviour ---------------------------------------------------------------------------------------------

test("T-readout: encode returns the caller's object and resets every field it promises, so a stale value cannot leak", () => {
  const frame = E.readout.cellsFrame(specOf(MODES[0], "light"));
  const out = { tag: 99, value: 123, role: 8, idx: 77, clip: 4, t: 0.9, css: "#123456", pattern: "x", reason: "stale", denominator: "stale", short: true, signed: true };
  const back = frame.encode({ c: 201, r: 203, v: NaN }, out);
  assert.equal(back, out, "the caller's object is returned");
  assert.equal(out.css, null);
  assert.equal(out.idx, -1);
  assert.equal(out.clip, 0);
  assert.equal(out.t, 0);
  assert.equal(out.short, false);
  assert.equal(out.reason, "non-finite");
  assert.equal(out.denominator, null);
  assert.equal(frame.encode({ c: 201, r: 203, v: 1e3 }, out), out);
  assert.equal(out.pattern, null);
  assert.equal(out.reason, null);
});

test("T-readout: encode takes a per-call bounds (the lens, the whole-block fade) and defaults to the frame's", () => {
  const m = MODES.find((x) => nameOf(x) === "volume intensity");
  const frame = E.readout.cellsFrame(specOf(m, "light"));
  const z = { c: 201, r: 203, v: 500, bv: 1, ct: 2, bt: 1 };
  const a = {};
  const b = {};
  frame.encode(z, a);
  frame.encode(z, b, [3216, 3232, 406, 408]);
  const e1 = exposure(z, BOUNDS);
  const e2 = exposure(z, [3216, 3232, 406, 408]);
  assert.equal(a.value, (500 * 60 * 125) / (e1.seconds * e1.width));
  assert.equal(b.value, (500 * 60 * 125) / (e2.seconds * e2.width));
  frame.encode(z, a);
  assert.equal(a.value, (500 * 60 * 125) / (e1.seconds * e1.width), "the next call without bounds is back on the frame's");
});

test("T-readout: the level of the record is the level THIS frame describes (the drawer table at another level, DR-22, D.3)", () => {
  // A rectangle wider than 4096 columns: the table lists cells at the query level (n=4) while the canvas
  // draws level 6. Each frame's record states its own level and the legend drops the marker of the other.
  const at = (n, m) => E.readout.cellsFrame(specOf(MODES[0], "light", { level: { n, m } }));
  const drawn = at(6, 1);
  const table = at(4, 1);
  const z = { c: 50, r: 203, v: 1e5, bv: 0, ct: 1, bt: 0 };
  const rt = table.readout(z);
  const rd = drawn.readout(z);
  assert.deepEqual(plain(rt.level), { n: 4, m: 1 });
  assert.deepEqual(plain(rd.level), { n: 6, m: 1 });
  assert.equal(rt.key, rd.key, "the numeric key is the same cell address");
  assert.notDeepEqual(plain(rt.support), plain(rd.support), "the support differs by level");
  if (E.legend === undefined) return; // standalone form: the marker half needs part 20-legend
  const legend = E.legend.build(drawn, null, null, {});
  assert.equal(E.legend.marker(legend, rd) !== null, true);
  assert.equal(E.legend.marker(legend, rt), null, "a record of another level draws no marker on this legend");
});

test("T-readout: fingerprint changes with the mapping id, the mapping state, the appearance id and the theme, and nothing else", () => {
  const base = (over) => E.readout.cellsFrame(specOf(MODES[0], "light", over)).fingerprint();
  const a = base({});
  assert.equal(a, base({}));
  assert.notEqual(a, base({ mapping: { state: "ok", desc: LINU, policy: "explore" } }), "another mapping id");
  assert.notEqual(a, base({ mapping: { state: "updating", desc: LOGU, policy: "explore" } }), "another state");
  assert.notEqual(a, E.readout.cellsFrame(specOf(MODES[0], "dark")).fingerprint(), "another theme");
  assert.equal(a, base({ level: { n: 5, m: 2 }, cut: 3000 }), "the level and cutoff are not part of the stamp (they change the record, not the tooltip key)");
  assert.equal(a.split("|")[0], E.scale.id(LOGU));
  assert.equal(a.split("|")[2], E.lut.appearanceId("slate2"));
  assert.equal(a.split("|")[3], "light");
});

test("T-readout: a frame refuses what it cannot draw correctly (programmer errors throw; data problems are typed results)", () => {
  assert.throws(() => E.readout.cellsFrame(null), isError("TypeError"));
  assert.throws(() => E.readout.cellsFrame(specOf(MODES[0], "light", { mode: "bogus" })), isError("RangeError"));
  assert.throws(() => E.readout.cellsFrame(specOf(MODES[0], "light", { level: null })), isError("TypeError"));
  assert.throws(() => E.readout.cellsFrame(specOf(MODES[0], "light", { lut: null })), isError("TypeError"));
  // A signed mapping cannot colour an unsigned measure and the other way round.
  assert.throws(() => E.readout.cellsFrame(specOf(MODES[0], "light", { mapping: { state: "ok", desc: LOGS } })), isError("RangeError"));
  assert.throws(() => E.readout.cellsFrame(specOf(MODES.find((m) => m.mode === "delta"), "light", { mapping: { state: "ok", desc: LOGU } })), isError("RangeError"));
  assert.throws(() => E.readout.rowsFrame({ kind: "bogus", lut: LUTS.light }), isError("RangeError"));
  assert.throws(() => E.readout.paneFrame({ lut: LUTS.light }), isError("TypeError"));
  assert.deepEqual(plain(E.readout.ROLE), { NONE: 0, UNSIGNED: 1, POSITIVE: 2, NEGATIVE: 3, MIDPOINT: 4, PATTERN: 5, OCCUPANCY: 6, ZERO: 7, ROWS: 8 });
  assert.ok(Object.isFrozen(E.readout.ROLE));
});

test("T-readout: the zero-only calibration draws a later nonzero value at the end of its ramp with a counted clip", () => {
  const zeroOnly = E.scale.zeroOnly(false);
  const f = E.readout.cellsFrame(specOf(MODES[0], "light", { mapping: { state: "ok", desc: zeroOnly, policy: "explore" } }));
  const out = {};
  f.encode({ c: 201, r: 203, v: 0 }, out);
  assert.equal(out.clip, 0);
  assert.equal(ROLE_NAME[out.role], "zero");
  f.encode({ c: 201, r: 203, v: 5 }, out);
  assert.equal(out.clip, E.scale.CLIP.HIGH, "DD-95: an out-of-domain value is clipped, so the tally counts it");
  assert.equal(out.idx, 255);
  assert.equal(out.t, 1);
});

// ---- mappings from E.policy (part 14) ------------------------------------------------------------------------------

test("T-readout: a Resolved record (a store hit: record with its cohort, an external lock) is what the frame draws and states", () => {
  const record = { v: 1, key: "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n4m1", desc: LOGU, policy: "explore", origin: "fit", obsEndMs: 1790251320000 };
  const f = E.readout.cellsFrame(specOf(MODES[0], "light", { mapping: { state: "ok", record, policy: "explore", external: false } }));
  const r = f.readout({ c: 201, r: 203, v: 500, bv: 1, ct: 2, bt: 1 });
  assert.equal(r.scale.id, E.scale.id(LOGU));
  assert.equal(r.scale.policy, "explore");
  assert.equal(r.scale.origin, "fit");
  assert.equal(r.scale.contextKey, record.key);
  assert.equal(r.scale.obsEndMs, 1790251320000);
  assert.equal(r.scale.external, false);
  // A held mapping older than... an external comparison override is flagged, not a state.
  const held = E.readout.cellsFrame(specOf(MODES[0], "light", { mapping: { state: "ok", record: Object.assign({}, record, { policy: "comparison", origin: "manual" }), policy: "comparison", external: true } }));
  const h = held.readout({ c: 201, r: 203, v: 500, bv: 1, ct: 2, bt: 1 });
  assert.equal(h.scale.policy, "comparison");
  assert.equal(h.scale.origin, "manual");
  assert.equal(h.scale.external, true);
  assert.equal(h.scale.state, "ok", "an external override is a flag (data-override), not a chip state");
});

test("T-readout: a Resolved record of E.policy.resolve for a fixed measure and for occupancy is accepted by the frames", (t) => {
  if (E.policy === undefined) {
    t.todo("needs part 14-policy: E.policy.resolve (API.md C.9: kind fixed -> {state, desc, policy: fixed, origin: fixed}); exercised at assembly");
    return;
  }
  const args = { channel: "c", ctx: null, classKey: "", scale: E.policy.DEFAULTS, store: null, workspace: "live", cutMs: 0 };
  const fixed = E.policy.resolve(Object.assign({}, args, { kind: "fixed", fixed: SHARE }));
  const flow = E.readout.cellsFrame(specOf(MODES.find((m) => m.mode === "flow"), "light", { mapping: fixed }));
  const out = {};
  flow.encode({ c: 201, r: 203, v: 100, bv: 75, ct: 1, bt: 1 }, out);
  assert.equal(ROLE_NAME[out.role], "positive");
  assert.equal(out.idx, idxOf(0.5), "75% of a 0..100% share is half of the positive arm");
  const occ = E.policy.resolve(Object.assign({}, args, { kind: "occupancy" }));
  const geo = E.readout.cellsFrame({ mode: "geometry", level: LEVEL, bounds: BOUNDS, geom: GEOM, mapping: occ, lut: LUTS.light });
  geo.encode({ c: 201, r: 203 }, out);
  assert.equal(ROLE_NAME[out.role], "occupancy");
});

// ---- Rows ------------------------------------------------------------------------------------------------------------

test("T-readout: a Rows frame paints the raw rows role for Volume and Time, the arms for Delta, and states the period it was measured over", () => {
  const out = {};
  const rowsDesc = E.scale.manual({ kind: "value-log1p", signed: false, U: 1e9, k: 1e6 }).descriptor;
  const vol = E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc: rowsDesc, policy: "explore" }, lut: LUTS.light, info: { period: "roll:90", quality: "exact" } });
  vol.encode({ r: 10, v: 5e7, bv: 1e7, w: 100 }, out);
  const t = tOf(rowsDesc, 5e7);
  assert.equal(ROLE_NAME[out.role], "rows");
  assert.equal(out.idx, idxOf(t));
  assert.equal(out.css, LUTS.light.rows.css[idxOf(t)], "the RAW rows role, painted at the fixed Rows alpha by the canvas (DD-86)");
  const r = vol.readout({ r: 10, v: 5e7, bv: 1e7, w: 100 });
  assert.equal(r.consumer, "rows");
  assert.equal(r.key, "row:10");
  assert.equal(r.measure.formula, "rows.volume.amount@1");
  assert.equal(r.observed.value, 5e7);
  assert.deepEqual(plain(r.support.price), [80, 88], "row 10 at rowSize 3 covers base rows 80..88");
  assert.deepEqual(plain(r.rows), { period: "roll:90", quality: "exact" });
  assert.equal(r.coordinate.role, "rows");
  E.result.assertJsonSafe(r);
  const time = E.readout.rowsFrame({ kind: "time", rowSize: 3, mapping: { state: "ok", desc: rowsDesc }, lut: LUTS.dark });
  time.encode({ r: 10, v: 5e7, w: 5e7 }, out);
  assert.equal(out.css, LUTS.dark.rows.css[idxOf(t)]);
  assert.equal(time.readout({ r: 10, w: 123 }).observed.unit, "seconds");
  const signed = E.scale.manual({ kind: "value-log1p", signed: true, U: 1e9, k: 1e6 }).descriptor;
  const delta = E.readout.rowsFrame({ kind: "delta", rowSize: 3, mapping: { state: "ok", desc: signed }, lut: LUTS.light });
  delta.encode({ r: 10, v: 100, bv: 20 }, out);
  assert.equal(ROLE_NAME[out.role], "negative");
  assert.equal(out.css, LUTS.light.negative.css[idxOf(tOf(signed, -60))]);
  delta.encode({ r: 10, v: 100, bv: 50 }, out);
  assert.equal(ROLE_NAME[out.role], "midpoint");
  // Volume zero is the zero role (outline), a non-finite band is invalid-input, a failed read is a pattern.
  vol.encode({ r: 10, v: 0 }, out);
  assert.equal(ROLE_NAME[out.role], "zero");
  vol.encode({ r: 10, v: Infinity }, out);
  assert.equal(E.result.TAGS[out.tag], "invalid-input");
  const failed = E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc: rowsDesc }, lut: LUTS.light, read: { state: "failed", reason: "cube_unavailable" } });
  failed.encode({ r: 10, v: 5e7 }, out);
  assert.equal(out.pattern, "pattern-cross");
  assert.equal(out.reason, "cube_unavailable");
  assert.equal(failed.readout({ r: 10, v: 5e7 }).typed.tag, "failed");
});

test("T-readout: Relative volume bands come from the typed per-bin result: finite on the arms, negative-infinity, no-reference and empty-both as glyphs, outside the support as nothing", () => {
  const out = {};
  const table = {
    1: { tag: "finite", value: 1 },
    2: { tag: "finite", value: -2 },
    3: { tag: "negative-infinite", reason: "no current volume" },
    4: { tag: "no-reference", reason: "no reference volume" },
    5: { tag: "empty-both" },
    6: { tag: "outside-support", reason: "outside price support" },
    7: { tag: "finite", value: 0 },
  };
  const relvol = { at: (bin) => table[bin] };
  const f = E.readout.rowsFrame({ kind: "relvol", rowSize: 0, mapping: LOG2, lut: LUTS.light, relvol });
  f.encode({ r: 1 }, out);
  assert.equal(ROLE_NAME[out.role], "positive");
  assert.equal(out.idx, 128, "+1 on the log2 axis is half an arm: index 128, never +2's colour");
  assert.equal(out.t, 0.5);
  f.encode({ r: 2 }, out);
  assert.equal(ROLE_NAME[out.role], "negative");
  assert.equal(out.idx, 255);
  assert.equal(out.clip, E.scale.CLIP.EXACT_LOW, "exactly on the endpoint: drawn at the end and not out of range");
  f.encode({ r: 3 }, out);
  assert.equal(out.pattern, "infinity");
  f.encode({ r: 4 }, out);
  assert.equal(out.pattern, "pattern-slate");
  f.encode({ r: 5 }, out);
  assert.equal(out.pattern, "pattern-slate");
  f.encode({ r: 6 }, out);
  assert.equal(ROLE_NAME[out.role], "none");
  assert.equal(out.pattern, null);
  f.encode({ r: 7 }, out);
  assert.equal(ROLE_NAME[out.role], "midpoint");
  const r = f.readout({ r: 3 });
  assert.equal(r.typed.tag, "negative-infinite");
  assert.equal(r.coordinate, null);
  assert.equal(r.measure.formula, "rows.relvol@2");
  // With no result yet the band is pending (reading), never a value.
  const none = E.readout.rowsFrame({ kind: "relvol", rowSize: 0, mapping: LOG2, lut: LUTS.light, relvol: null });
  none.encode({ r: 1 }, out);
  assert.equal(E.result.TAGS[out.tag], "pending");
});

// ---- panes -------------------------------------------------------------------------------------------------------------

test("T-readout: a pane frame draws the constant bar colour, the signed arms, a zero tick, a diamond for an undefined column and the clip of the axis", () => {
  const out = {};
  const axis = { id: "pane.volume", channel: "columns", policy: "auto", sign: "unsigned", typed: "finite", domain: [0, 1000], natural: null, unit: "usdt", mappingId: "abc", hold: null, provenance: { through: 1790251320000 } };
  const vol = E.readout.paneFrame({ key: "volume", axis, lut: LUTS.light });
  vol.encode({ v: 250 }, out);
  assert.equal(ROLE_NAME[out.role], "unsigned");
  assert.equal(out.css, LUTS.light.bar.css, "constant bar colour (Lut.bar)");
  assert.equal(out.idx, 160);
  assert.equal(out.t, 0.25, "the bar's length is its position in the axis window");
  vol.encode({ v: 1000 }, out);
  assert.equal(out.clip, E.scale.CLIP.EXACT_HIGH);
  vol.encode({ v: 4000 }, out);
  assert.equal(out.clip, E.scale.CLIP.HIGH, "a counted clip, the bar is cut at the axis");
  assert.equal(out.t, 1);
  vol.encode({ v: 0 }, out);
  assert.equal(ROLE_NAME[out.role], "zero");
  assert.equal(out.pattern, "tick");
  assert.equal(out.css, LUTS.light.stateInk.css);
  const size = E.readout.paneFrame({ key: "size", axis: Object.assign({}, axis, { id: "pane.size" }), lut: LUTS.light });
  size.encode({ v: 10, ct: 0 }, out);
  assert.equal(E.result.TAGS[out.tag], "undefined");
  assert.equal(out.pattern, "diamond", "an undefined column baseline is a hollow diamond");
  const signedAxis = { id: "pane.delta", channel: "columns", policy: "auto", sign: "signed-symmetric", typed: "finite", domain: [-500, 500], natural: null, unit: "usdt", mappingId: "def", hold: null, provenance: null };
  const delta = E.readout.paneFrame({ key: "delta", axis: signedAxis, lut: LUTS.dark });
  delta.encode({ v: 300, bv: 100 }, out);
  assert.equal(ROLE_NAME[out.role], "negative", "delta -100 of a symmetric +-500 axis");
  assert.ok(Math.abs(out.t - -0.2) < 1e-12);
  assert.equal(out.css, LUTS.dark.negative.css[255]);
  delta.encode({ v: 300, bv: 250 }, out);
  assert.equal(ROLE_NAME[out.role], "positive");
  assert.ok(Math.abs(out.t - 0.4) < 1e-12);
  // A bar on an axis with no data is not drawn (no domain, no fake maximum).
  const none = E.readout.paneFrame({ key: "volume", axis: Object.assign({}, axis, { typed: "none", domain: null }), lut: LUTS.light });
  none.encode({ v: 5 }, out);
  assert.equal(ROLE_NAME[out.role], "none");
  const r = vol.readout({ c: 7, v: 250 });
  assert.equal(r.consumer, "pane");
  assert.equal(r.key, "col:7");
  assert.equal(r.measure.formula, "columns.volume@1");
  assert.equal(r.scale.contextKey, "pane.volume");
  assert.equal(r.axis.id, "pane.volume");
  assert.deepEqual(plain(r.axis.domain), [0, 1000]);
  assert.equal(r.observed.value, 250);
  assert.equal(r.coordinate.t, 0.25);
  E.result.assertJsonSafe(r);
  // The ratio columns take their structure per column, as the third argument.
  const cascadeAxis = { id: "pane.cascade", channel: "columns", policy: "fixed", sign: "ratio", typed: "finite", domain: [-2, 2], natural: [-2, 2], unit: "log2-ratio", mappingId: "ghi", hold: null, provenance: null };
  const cascade = E.readout.paneFrame({ key: "cascade", axis: cascadeAxis, lut: LUTS.light });
  cascade.encode({ v: 1 }, out, { ratio: { structure: "complete", childV: 1e6, parentV: 2e6, factor: 2 } });
  assert.equal(out.tag, 0);
  assert.equal(out.value, 0, "log2(2 * 1e6 / 2e6) = 0: a defined zero is a tick");
  assert.equal(out.pattern, "tick");
  cascade.encode({ v: 1 }, out, { ratio: { structure: "coarsest", childV: 1, parentV: 1, factor: 2 } });
  assert.equal(E.result.TAGS[out.tag], "no-coarser-parent");
  assert.equal(out.pattern, "pattern-slate");
});

test("T-readout: the Efficiency pane passes the recorded model's baseline explicitly (DR-39): the caller's ratio input needs none, and is not changed", () => {
  const axis = { id: "pane.efficiency", channel: "columns", policy: "fixed", sign: "ratio", typed: "finite", domain: [-2, 2], natural: [-2, 2], unit: "log2-ratio", mappingId: "e", hold: null, provenance: null };
  const pane = E.readout.paneFrame({ key: "efficiency", axis, lut: LUTS.light });
  const ratio = { structure: "complete", child: { v: 4000, rows: 8 }, parent: { v: 9000, rows: 12 } };
  const out = {};
  pane.encode({ v: 1 }, out, { ratio });
  // By hand: E(child) = 500, E(parent) = 750, baseline 2 ** (0.486 - 1) = 0.7002781604436024.
  const want = Math.log2(4000 / 8 / (9000 / 12) / Math.pow(2, 0.486 - 1));
  assert.equal(out.tag, 0);
  assert.ok(Math.abs(out.value - want) < 1e-15, `${out.value} vs ${want}`);
  assert.equal(ratio.baseline, undefined, "the caller's object is not extended");
  // An explicit baseline of the caller is respected (a test of another model reference).
  pane.encode({ v: 1 }, out, { ratio: Object.assign({ baseline: 1 }, ratio) });
  assert.ok(Math.abs(out.value - Math.log2(4000 / 8 / (9000 / 12))) < 1e-15);
  // The other structures are the ladder of D2, not numbers.
  pane.encode({ v: 1 }, out, { ratio: { structure: "open", child: { v: 1, rows: 1 }, parent: { v: 1, rows: 1 } } });
  assert.equal(E.result.TAGS[out.tag], "waiting-for-complete-parent");
  pane.encode({ v: 1 }, out);
  assert.equal(E.result.TAGS[out.tag], "pending", "no ratio input yet: reading, never a value");
});
