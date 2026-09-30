"use strict";
// U12 (T-measure): the D2 measurement bases of src/encoding.js E.measure (part 05), loaded through
// tests/support/enc.js.
// Oracles (none is the code under test): hand-computed vectors from D2, API.md C.1.4 to C.1.6 and the U12 row of
// TESTPLAN.md (for example Intensity of amount 1000 over 900 s and 250 USDT = 33.333333333333336, Path 500 USDT
// over a 250-USDT cell = 2 row spans and 0.13333333333333333 per minute); exact integer arithmetic for Delta
// (integers below 2**53 are exact in doubles) over seeded random cells (tests/support/rng.js); the
// user-visible unit ids of API.md B.3; a source scan of the hot function for allocation constructs.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): its objects and errors are of another
// realm, so records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const { mulberry32, int } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));
const TAGS = E.result.TAGS;
const TAG = E.result.TAG;

// One kernel at level n = 4, m = 1: a cell is 16 base columns (900 s) by 2 base rows (250 USDT).
function kernel(over) {
  return Object.assign(
    {
      mode: "volume",
      basis: "amount",
      pathBasis: "spans",
      z: { c: 0, r: 0, v: 0, bv: 0, ct: 0, bt: 0 },
      bounds: [0, 16, 0, 2],
      cut: 1e9,
      end: Infinity,
      CUT: 1e9,
      replay: false,
      geom: { BASE: 56.25, PR: 125 },
      level: { n: 4, m: 1 },
      read: null,
      measured: null,
      cascade: null,
    },
    over,
  );
}
function measure(over) {
  const out = {};
  E.measure.cellValue(kernel(over), out);
  return out;
}
const cell = (fields) => Object.assign({ c: 0, r: 0, v: 0, bv: 0, ct: 0, bt: 0 }, fields);
const isValue = (out) => out.tag === TAG.finite;
const tagName = (out) => TAGS[out.tag];

test("catalogues: FORMULAS carry family, unit, sign, basis kind and version; rows.relvol is version 2", () => {
  const F = E.measure.FORMULAS;
  assert.ok(Object.isFrozen(F));
  const want = {
    "cells.volume.amount@1": ["amount.usdt", "usdt", false],
    "cells.trades.amount@1": ["amount.trades", "trades", false],
    "cells.delta.amount@1": ["delta.usdt", "usdt", true],
    "cells.volume.intensity@1": ["intensity.usdt", "usdt-per-min-per-125usdt", false],
    "cells.trades.intensity@1": ["intensity.trades", "trades-per-min-per-125usdt", false],
    "cells.delta.intensity@1": ["intensity.delta", "usdt-per-min-per-125usdt", true],
    "cells.size.mean@1": ["size.usdt-per-trade", "usdt-per-trade", false],
    "cells.path.spans@1": ["path.spans", "row-spans", false],
    "cells.path.usdt@1": ["path.usdt", "usdt", false],
    "cells.path.perminute@1": ["path.perminute", "row-spans-per-min", false],
    "rows.volume.amount@1": ["amount.usdt", "usdt", false],
    "rows.delta.amount@1": ["delta.usdt", "usdt", true],
    "rows.time.seconds@1": ["time.seconds", "seconds", false],
  };
  for (const [id, [family, unit, signed]] of Object.entries(want)) {
    assert.equal(F[id].family, family, id);
    assert.equal(F[id].unit, unit, id);
    assert.equal(F[id].signed, signed, id);
    assert.equal(F[id].version, 1, id);
    assert.ok(Object.isFrozen(F[id]), id);
  }
  // The fixed measures have no family to hold; the unit is the whole definition.
  for (const id of ["cells.dwell.share@1", "cells.flow.share@1", "cells.flowtrades.share@1", "cells.cascade.log2@1"]) assert.equal(F[id].family, null, id);
  assert.equal(F["cells.cascade.log2@1"].unit, "log2-ratio");
  assert.equal(F["rows.relvol@2"].version, 2);
  assert.equal(F["rows.relvol@2"].unit, "log2-ratio");
  assert.equal(F["rows.relvol@1"], undefined, "v1 is the retired baseline behaviour");
  for (const id of Object.keys(F)) assert.match(id, /^[a-z]+\.[a-z0-9]+(\.[a-z0-9]+)?@\d+$/, id);
  // Cells and Rows Amount share the family (held mappings are keyed by channel, WORKPLAN mistakes list).
  assert.equal(F["cells.volume.amount@1"].family, F["rows.volume.amount@1"].family);
});

test("catalogues: MODES says which measure is unbounded, fixed or occupancy and what it offers", () => {
  const M = E.measure.MODES;
  assert.deepEqual(Object.keys(M).sort(), ["cascade", "delta", "dwell", "flow", "flowtrades", "geometry", "path", "size", "trades", "volume"]);
  for (const m of ["volume", "trades"]) {
    assert.equal(M[m].kind, "unbounded");
    assert.equal(M[m].signed, false);
    assert.deepEqual(plain(M[m].bases), ["amount", "intensity"]);
    assert.equal(M[m].rank, true);
  }
  assert.equal(M.delta.signed, true);
  assert.equal(M.delta.rank, false, "no rank for a signed measure");
  assert.deepEqual(plain(M.delta.bases), ["amount", "intensity"]);
  assert.deepEqual(plain(M.size.bases), ["mean"]);
  assert.deepEqual(plain(M.path.bases), ["spans", "usdt", "perMinute"]);
  assert.equal(M.path.rank, true);
  for (const m of ["flow", "flowtrades"]) {
    assert.equal(M[m].kind, "fixed");
    assert.deepEqual(plain(M[m].fixed), { kind: "share-diverging", lo: 0, hi: 1, mid: 0.5 });
    assert.equal(M[m].rank, false);
  }
  assert.equal(M.dwell.kind, "fixed");
  assert.deepEqual(plain(M.dwell.fixed), { kind: "unsigned-share", lo: 0, hi: 1 });
  assert.equal(M.cascade.kind, "fixed");
  assert.deepEqual(plain(M.cascade.fixed), { kind: "log2-ratio", lo: -2, hi: 2, mid: 0 });
  assert.equal(M.geometry.kind, "occupancy");
  assert.equal(M.geometry.fixed, null);
  assert.ok(Object.isFrozen(M) && Object.isFrozen(M.volume) && Object.isFrozen(M.volume.bases));
});

test("catalogues: ROWS lists the four Rows measures of DD-73", () => {
  const R = E.measure.ROWS;
  assert.deepEqual(Object.keys(R).sort(), ["delta", "relvol", "time", "volume"]);
  assert.deepEqual([R.volume.kind, R.volume.signed, R.volume.rank], ["unbounded", false, true]);
  assert.deepEqual([R.delta.kind, R.delta.signed, R.delta.rank], ["unbounded", true, false]);
  assert.deepEqual([R.time.kind, R.time.signed, R.time.rank], ["unbounded", false, true]);
  assert.deepEqual([R.relvol.kind, R.relvol.signed, R.relvol.rank], ["fixed", true, false]);
  for (const key of Object.keys(R)) assert.ok(E.measure.FORMULAS[R[key].formula], key + " names a formula that exists");
  assert.ok(Object.isFrozen(R));
});

test("Amount: Volume is v, Trades is ct, Delta is 2*bv - v", () => {
  const z = cell({ v: 1873223.5, bv: 1000000, ct: 431, bt: 200 });
  let out = measure({ mode: "volume", z });
  assert.ok(isValue(out));
  assert.equal(out.value, 1873223.5);
  assert.equal(out.signed, false);
  assert.equal(out.short, false);
  out = measure({ mode: "trades", z });
  assert.equal(out.value, 431);
  out = measure({ mode: "delta", z });
  assert.equal(out.value, 2 * 1000000 - 1873223.5);
  assert.equal(out.value, 126776.5);
  assert.equal(out.signed, true);
});

test("Amount: balanced traded Delta (buy 100, sell 100, volume 200, two trades) is a finite ZERO, not a non-value", () => {
  const z = cell({ v: 200, bv: 100, ct: 2, bt: 1 });
  const d = measure({ mode: "delta", z });
  assert.equal(TAGS[d.tag], "finite");
  assert.equal(d.value, 0);
  assert.ok(Object.is(d.value, 0) || d.value === 0);
  // The cell IS occupied: the trade count is positive and Trades reads it.
  assert.equal(measure({ mode: "trades", z }).value, 2);
  // Volume and Trades zero coincide with "no trades" only for an absent cell, which is never drawn.
  assert.equal(measure({ mode: "volume", z: cell({}) }).value, 0);
});

test("Amount: Delta over seeded random cells equals exact integer arithmetic", () => {
  const next = mulberry32(46);
  for (let i = 0; i < 500; i++) {
    const v = int(next, 0, 2 ** 40);
    const bv = int(next, 0, v);
    const out = measure({ mode: "delta", z: cell({ v, bv, ct: 1 }) });
    assert.equal(BigInt(out.value), 2n * BigInt(bv) - BigInt(v));
  }
});

test("Intensity: amount * 60 * 125 / (seconds * width), unit per minute per 125-USDT band", () => {
  // Hand vector of U12: amount 1000, covered 900 s, measured width 250 USDT -> 1000*7500/225000.
  const out = measure({ mode: "volume", basis: "intensity", z: cell({ v: 1000, ct: 5 }) });
  assert.equal(out.value, 33.333333333333336);
  assert.equal(out.short, false);
  assert.equal(E.measure.FORMULAS["cells.volume.intensity@1"].unit, "usdt-per-min-per-125usdt");
  // Trades and Delta intensities use the same denominator, on their own amounts.
  assert.equal(measure({ mode: "trades", basis: "intensity", z: cell({ v: 1000, ct: 5 }) }).value, (5 * 7500) / 225000);
  assert.equal(measure({ mode: "delta", basis: "intensity", z: cell({ v: 1000, bv: 700, ct: 5 }) }).value, (400 * 7500) / 225000);
  // Half the time and half the price covered: 1000 USDT in 450 s over 125 USDT -> 1000*7500/(450*125).
  const part = measure({ mode: "volume", basis: "intensity", bounds: [0, 8, 0, 1], z: cell({ v: 1000 }) });
  assert.ok(Math.abs(part.value - 7500000 / 56250) < 1e-9);
});

test("Intensity: a zero exposure is a typed non-value, never a rate of 1 and never NaN", () => {
  // No covered time: the rectangle ends where the cell begins.
  let out = measure({ mode: "volume", basis: "intensity", bounds: [0, 0, 0, 2], z: cell({ v: 1000 }) });
  assert.equal(tagName(out), "undefined");
  assert.equal(out.denominator, "covered time");
  assert.ok(Number.isNaN(out.value), "a non-value carries NaN, never a plausible number");
  // No measured width: the rectangle is a horizontal line.
  out = measure({ mode: "volume", basis: "intensity", bounds: [0, 16, 0, 0], z: cell({ v: 1000 }) });
  assert.equal(tagName(out), "undefined");
  assert.equal(out.denominator, "price span");
  // Covered time is checked first when both are zero.
  out = measure({ mode: "volume", basis: "intensity", bounds: [0, 0, 0, 0], z: cell({ v: 1000 }) });
  assert.equal(out.denominator, "covered time");
  // The cutoff before the cell: nothing was observed.
  out = measure({ mode: "delta", basis: "intensity", cut: 0, z: cell({ v: 10, bv: 5 }) });
  assert.equal(out.denominator, "covered time");
});

test("Intensity is never floored: a positive exposure of 1e-9 s still divides", () => {
  // One nanosecond of coverage: (1e-9 / 56.25) columns of the 16-column cell.
  const out = measure({ mode: "volume", basis: "intensity", bounds: [0, 1e-9 / 56.25, 0, 2], z: cell({ v: 1 }) });
  assert.ok(isValue(out));
  // 1 USDT in 1e-9 s over 250 USDT: 1*60*125/(1e-9*250) = 3e10.
  assert.ok(Math.abs(out.value / 3e10 - 1) < 1e-9, "got " + out.value);
  assert.ok(out.value > 0);
  assert.equal(out.short, true, "a sliver is exactly what the Short exposure cue is for");
});

test("Trade size: v / ct; a cell without trades is UNDEFINED naming trades, never 0", () => {
  assert.equal(measure({ mode: "size", z: cell({ v: 1000, ct: 4 }) }).value, 250);
  const out = measure({ mode: "size", z: cell({ v: 0, ct: 0 }) });
  assert.equal(tagName(out), "undefined");
  assert.equal(out.denominator, "trades");
});

test("Taker flow: bv/v and bt/ct; zero totals are empty-population, not 0.5", () => {
  assert.equal(measure({ mode: "flow", z: cell({ v: 400, bv: 40, ct: 3 }) }).value, 0.1);
  assert.equal(measure({ mode: "flow", z: cell({ v: 200, bv: 100, ct: 2 }) }).value, 0.5, "a real 50/50 cell");
  const flow = measure({ mode: "flow", z: cell({ v: 0, bv: 0, ct: 0 }) });
  assert.equal(tagName(flow), "empty-population");
  assert.equal(flow.denominator, "total volume");
  assert.equal(measure({ mode: "flowtrades", z: cell({ ct: 8, bt: 2 }) }).value, 0.25);
  const trades = measure({ mode: "flowtrades", z: cell({ ct: 0, bt: 0 }) });
  assert.equal(tagName(trades), "empty-population");
  assert.equal(trades.denominator, "total trades");
  assert.equal(measure({ mode: "flow", z: cell({ v: 400, bv: 40 }) }).signed, true);
});

test("Aggregation before ratios: shares come from summed inputs, not from an average of shares", () => {
  // Cells (bv 30, v 100) and (bv 10, v 300): the aggregate is (40, 400), share 0.1; the mean of the two
  // shares would be 0.16666666666666666. The kernel divides what it is given, so the caller must sum first.
  const aggregated = measure({ mode: "flow", z: cell({ v: 100 + 300, bv: 30 + 10 }) });
  assert.equal(aggregated.value, 0.1);
  assert.notEqual(aggregated.value, (0.3 + 10 / 300) / 2);
});

test("Path: default is row spans (path over the drawn cell height), alternatives are USDT moved and per minute", () => {
  const z = cell({ v: 900, ct: 9, p: 500, w: 300 });
  // m = 1: the cell is 250 USDT high, so 500 USDT of path is 2 row spans.
  const spans = measure({ mode: "path", pathBasis: "spans", z });
  assert.equal(spans.value, 2);
  assert.equal(measure({ mode: "path", pathBasis: "usdt", z }).value, 500);
  assert.equal(measure({ mode: "path", pathBasis: "perMinute", z }).value, 0.13333333333333333, "60*500/(250*900)");
  // Height is measured height: half the price range covered, the same 500 USDT is 4 spans of the 125 covered.
  assert.equal(measure({ mode: "path", pathBasis: "spans", bounds: [0, 16, 0, 1], z }).value, 4);
  // No 'time extrapolation' factor (DR-12): half the covered time changes nothing for row spans.
  assert.equal(measure({ mode: "path", pathBasis: "spans", bounds: [0, 8, 0, 2], z }).value, 2);
  // And the value is unsigned.
  assert.equal(spans.signed, false);
});

test("Path: zero width or zero covered time is a typed non-value; USDT moved has no denominator", () => {
  const z = cell({ p: 500 });
  let out = measure({ mode: "path", pathBasis: "spans", bounds: [0, 16, 0, 0], z });
  assert.deepEqual([tagName(out), out.denominator], ["undefined", "price span"]);
  out = measure({ mode: "path", pathBasis: "perMinute", bounds: [0, 0, 0, 2], z });
  assert.deepEqual([tagName(out), out.denominator], ["undefined", "covered time"]);
  out = measure({ mode: "path", pathBasis: "perMinute", bounds: [0, 16, 0, 0], z });
  assert.deepEqual([tagName(out), out.denominator], ["undefined", "price span"]);
  // USDT moved needs neither: it is the plain sum, even where the rectangle covers nothing.
  out = measure({ mode: "path", pathBasis: "usdt", bounds: [0, 0, 0, 0], z });
  assert.equal(out.value, 500);
  // A single-trade cell has a path of exactly 0: a value, not a non-value.
  assert.equal(measure({ mode: "path", pathBasis: "spans", z: cell({ p: 0 }) }).value, 0);
});

test("Path: the covered time stops at the motion end", () => {
  // Motion data ends after 8 of the 16 columns: 450 s covered, so per minute uses 450 s, not 900 s.
  const out = measure({ mode: "path", pathBasis: "perMinute", end: 8, z: cell({ p: 500 }) });
  assert.ok(Math.abs(out.value - (60 * 500) / (250 * 450)) < 1e-12);
});

test("Dwell: covered seconds in the cell over covered column seconds (unsigned share)", () => {
  const out = measure({ mode: "dwell", z: cell({ w: 300 }) });
  assert.equal(out.value, 300 / 900);
  assert.equal(out.signed, false);
  assert.equal(measure({ mode: "dwell", z: cell({ w: 0 }) }).value, 0, "a covered cell with no dwell is a real 0");
  assert.equal(measure({ mode: "dwell", z: cell({ w: 900 }) }).value, 1);
  // The denominator is the time covered inside the rectangle and up to the motion end.
  assert.equal(measure({ mode: "dwell", end: 8, z: cell({ w: 225 }) }).value, 0.5);
  const none = measure({ mode: "dwell", bounds: [0, 0, 0, 2], z: cell({ w: 0 }) });
  assert.deepEqual([tagName(none), none.denominator], ["undefined", "covered time"]);
});

test("Dwell validation: material negative or over-covered dwell is invalid-input and is NEVER clamped", () => {
  let out = measure({ mode: "dwell", z: cell({ w: -1e-8 }) });
  assert.deepEqual([tagName(out), out.reason], ["invalid-input", "negative-dwell"]);
  out = measure({ mode: "dwell", z: cell({ w: 900 + 1e-6 }) });
  assert.deepEqual([tagName(out), out.reason], ["invalid-input", "dwell-exceeds-covered"]);
  out = measure({ mode: "dwell", z: cell({ w: NaN }) });
  assert.deepEqual([tagName(out), out.reason], ["invalid-input", "non-finite"]);
  // Inside the tolerance the value passes through UNCHANGED: a slightly negative dwell stays negative.
  out = measure({ mode: "dwell", z: cell({ w: -5e-10 }) });
  assert.ok(isValue(out));
  assert.equal(out.value, -5e-10 / 900);
  out = measure({ mode: "dwell", z: cell({ w: 900 + 5e-10 }) });
  assert.ok(isValue(out));
  assert.equal(out.value, (900 + 5e-10) / 900);
  assert.ok(out.value > 1, "not clamped to 100%");
});

test("dwellCheck: the tolerance is 1e-9 s plus 1e-12 relative, both sides; null means usable", () => {
  const check = (w, s) => E.measure.dwellCheck(w, s);
  assert.equal(check(0, 900), null);
  assert.equal(check(900, 900), null);
  assert.equal(check(-1e-9 + 1e-12, 900), null);
  assert.equal(plain(check(-2e-9, 900)).reason, "negative-dwell");
  // tol(900) = 1e-9 + 9e-10 = 1.9e-9
  assert.equal(check(900 + 1.8e-9, 900), null);
  assert.equal(plain(check(900 + 2e-9, 900)).reason, "dwell-exceeds-covered");
  // A large column: tol(1e9) = 1e-9 + 1e-3
  assert.equal(check(1e9 + 5e-4, 1e9), null);
  assert.equal(plain(check(1e9 + 2e-3, 1e9)).reason, "dwell-exceeds-covered");
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(plain(check(bad, 900)), { tag: "invalid-input", reason: "non-finite" });
    assert.deepEqual(plain(check(1, bad)), { tag: "invalid-input", reason: "non-finite" });
  }
});

test("dwellResidual: the unattributed time of a column, only where the column's rows are all known", () => {
  const r = E.measure.dwellResidual;
  // Only the rectangle's rows are known: not measurable, never 0 and never 100%.
  assert.deepEqual(plain(r(900, null)), { measurable: false, reason: "rectangle rows only" });
  assert.deepEqual(plain(r(900, undefined)), { measurable: false, reason: "rectangle rows only" });
  // All rows known: the residual and its share of the column.
  assert.deepEqual(plain(r(900, 600)), { measurable: true, seconds: 300, share: 300 / 900 });
  assert.deepEqual(plain(r(900, 900)), { measurable: true, seconds: 0, share: 0 });
  // Inside the tolerance the tiny negative residual is reported as it is, not renormalised.
  assert.deepEqual(plain(r(900, 900 + 1e-10)), { measurable: true, seconds: 900 - (900 + 1e-10), share: (900 - (900 + 1e-10)) / 900 });
  // More dwell than the column's covered time is a validation failure.
  assert.deepEqual(plain(r(900, 901)), { tag: "invalid-input", reason: "dwell-exceeds-covered" });
  assert.deepEqual(plain(r(NaN, 1)), { tag: "invalid-input", reason: "non-finite" });
  assert.deepEqual(plain(r(900, NaN)), { tag: "invalid-input", reason: "non-finite" });
  assert.deepEqual(plain(r(0, 0)), { measurable: false, reason: "no covered time" });
});

test("precedence: read status, then replay, then unmeasured, then mathematics", () => {
  // A cell that would be a finite value.
  const z = cell({ v: 100, bv: 50, ct: 2 });
  assert.equal(measure({ mode: "volume", z }).value, 100);
  // A failed read beats every other condition, including bad numbers.
  let out = measure({ mode: "volume", z: cell({ v: NaN }), read: { state: "failed", reason: "cube_unavailable" }, replay: true, cut: -1, measured: () => false });
  assert.deepEqual([tagName(out), out.reason], ["failed", "cube_unavailable"]);
  out = measure({ mode: "volume", z, read: { state: "pending" }, replay: true, cut: -1 });
  assert.deepEqual([tagName(out), out.reason], ["pending", "reading"]);
  out = measure({ mode: "volume", z, read: { state: "unsupported", reason: "not recorded" } });
  assert.deepEqual([tagName(out), out.reason], ["unsupported", "not recorded"]);
  // A read that has answered (any other state) is no status at all.
  assert.equal(measure({ mode: "volume", z, read: { state: "cube" } }).value, 100);
  // Replay: a cell that starts at or after the edge is hidden; a cell that straddles it is measured.
  out = measure({ mode: "volume", z: cell({ c: 3, v: 100 }), replay: true, cut: 48, level: { n: 4, m: 1 } });
  assert.deepEqual([tagName(out), out.reason], ["hidden", "replay"]);
  out = measure({ mode: "volume", z: cell({ c: 2, v: 100 }), replay: true, cut: 40 });
  assert.equal(out.value, 100);
  assert.equal(measure({ mode: "volume", z: cell({ c: 3, v: 100 }), replay: false, cut: 48 }).value, 100, "outside replay nothing is hidden");
  // Not yet measured: pending, NEVER zero (a motion cell after the end, a base cell not read yet).
  out = measure({ mode: "volume", z, measured: () => false });
  assert.deepEqual([tagName(out), out.reason], ["pending", "column not complete"]);
  assert.equal(measure({ mode: "volume", z, measured: () => true }).value, 100);
  assert.equal(measure({ mode: "volume", z, measured: () => null }).value, 100, "null: every cell counts as measured");
  // The reads are consulted before the formula: a not-yet-measured cell with NaN is pending, not invalid.
  out = measure({ mode: "volume", z: cell({ v: NaN }), measured: () => false });
  assert.equal(tagName(out), "pending");
});

test("a failed read's message is cut to 256 characters, as in a Typed", () => {
  const out = measure({ mode: "volume", read: { state: "failed", reason: "x".repeat(400) } });
  assert.equal(out.reason.length, 256);
  assert.ok(out.reason.endsWith("..."));
});

test("non-finite input is invalid-input (never a NaN fill, never clamped)", () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    for (const mode of ["volume", "trades", "delta", "size", "flow", "flowtrades"]) {
      const out = measure({ mode, z: cell({ v: bad, bv: bad, ct: bad, bt: bad }) });
      assert.notEqual(tagName(out), "finite", mode + " " + bad);
      assert.ok(Number.isNaN(out.value), mode);
    }
  }
  const out = measure({ mode: "volume", z: cell({ v: Infinity }) });
  assert.deepEqual([tagName(out), out.reason], ["invalid-input", "non-finite"]);
  // Path/Dwell on a cell without motion fields (a volume-only cell) is invalid, not zero.
  assert.equal(tagName(measure({ mode: "path", pathBasis: "usdt", z: cell({ v: 1 }) })), "invalid-input");
  assert.equal(tagName(measure({ mode: "dwell", z: cell({ v: 1 }) })), "invalid-input");
});

test("Cascade cells come from the kernel's accessor; without one they are pending, never a value", () => {
  const calls = [];
  const accessor = (z, out) => {
    calls.push(z.c);
    out.tag = TAG.finite;
    out.value = 2;
  };
  let out = measure({ mode: "cascade", cascade: accessor, z: cell({ c: 7 }) });
  assert.deepEqual([tagName(out), out.value, out.signed], ["finite", 2, true]);
  assert.deepEqual(calls, [7]);
  out = measure({ mode: "cascade", cascade: null });
  assert.deepEqual([tagName(out), out.reason], ["pending", "reading"]);
  out = measure({ mode: "cascade", cascade: (z, o) => { o.tag = TAG["waiting-for-complete-parent"]; } });
  assert.equal(tagName(out), "waiting-for-complete-parent");
  assert.ok(Number.isNaN(out.value));
  // A finite tag with a bad number is caught here too.
  out = measure({ mode: "cascade", cascade: (z, o) => { o.tag = TAG.finite; o.value = NaN; } });
  assert.deepEqual([tagName(out), out.reason], ["invalid-input", "non-finite"]);
  // Reads still come first.
  out = measure({ mode: "cascade", cascade: accessor, read: { state: "pending" } });
  assert.equal(tagName(out), "pending");
  assert.equal(calls.length, 1);
});

test("Geometry and unknown modes have no measurement", () => {
  const out = measure({ mode: "geometry" });
  assert.equal(tagName(out), "unsupported");
  assert.equal(tagName(measure({ mode: "nonsense" })), "unsupported");
});

test("cellValue reuses the caller's out and the kernel's one exposure object (no per-cell allocation)", () => {
  const out = {};
  const k = kernel({ mode: "volume", basis: "intensity", z: cell({ v: 1000 }) });
  assert.equal(E.measure.cellValue(k, out), out);
  const exposure = k.exposure;
  assert.ok(exposure && typeof exposure === "object", "the kernel keeps its exposure scratch");
  k.z = cell({ v: 500 });
  E.measure.cellValue(k, out);
  assert.equal(k.exposure, exposure, "re-pointed, not rebuilt");
  // The scratch is complete on every call: a non-value after a value leaves no stale number behind.
  k.z = cell({ v: 500 });
  k.bounds = [0, 0, 0, 2];
  E.measure.cellValue(k, out);
  assert.equal(tagName(out), "undefined");
  assert.ok(Number.isNaN(out.value));
  assert.equal(out.reason, null);
  k.bounds = [0, 16, 0, 2];
  E.measure.cellValue(k, out);
  assert.equal(out.denominator, null);
  assert.ok(isValue(out));
  // Steady-state source scan (INTEGRATION D.15, DD-T32): no allocation construct in the hot function.
  const src = E.measure.cellValue.toString();
  for (const token of ["new ", ".map(", ".filter(", ".slice(", ".sort(", "Object.assign", "Array.from", "d3.", "Math.log(", "..."])
    assert.equal(src.includes(token), false, "cellValue contains " + token);
  // The kernel accepts the steps directly as well as a level.
  const direct = { ...kernel({ mode: "volume", basis: "intensity", z: cell({ v: 1000 }) }), level: undefined, ts: 16, ps: 2 };
  assert.equal(measure(direct).value, 33.333333333333336);
});

test("kernel defaults: no bounds, cutoff or end means no limit; no level (or steps) is refused loudly", () => {
  const bare = { mode: "volume", basis: "intensity", z: cell({ v: 1000 }), geom: { BASE: 56.25, PR: 125 }, level: { n: 4, m: 1 } };
  const out = {};
  E.measure.cellValue(bare, out);
  assert.equal(out.value, 33.333333333333336, "an unbounded rectangle covers the whole cell");
  const motion = { ...bare, mode: "path", pathBasis: "perMinute", z: cell({ p: 500 }) };
  E.measure.cellValue(motion, out);
  assert.equal(out.value, 0.13333333333333333, "no motion end: covered to the cell's end");
  const noLevel = { mode: "volume", basis: "intensity", z: cell({ v: 1 }), geom: { BASE: 56.25, PR: 125 } };
  assert.throws(() => E.measure.cellValue(noLevel, out), { name: "TypeError", message: /level/ });
  // Amount needs no exposure, so it needs no level either.
  assert.equal(measure({ mode: "volume", level: undefined, z: cell({ v: 7 }) }).value, 7);
});

test("cellValue: 1e6 calls keep the heap flat when the runtime lets us look", (t) => {
  if (typeof global.gc !== "function") return t.skip("run node with --expose-gc to measure the heap");
  const out = {};
  const k = kernel({ mode: "volume", basis: "intensity", z: cell({ v: 1000 }) });
  E.measure.cellValue(k, out);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1e6; i++) E.measure.cellValue(k, out);
  global.gc();
  assert.ok(process.memoryUsage().heapUsed - before < 1024 * 1024);
});

test("columnValue: every row of C.1.6, and an undefined denominator is typed, never a zero bar", () => {
  const col = (o) => Object.assign({ v: 0, bv: 0, ct: 0, bt: 0, p: 0, hi: NaN, lo: NaN }, o);
  const value = (key, c, ctx) => plain(E.measure.columnValue(key, c, ctx));
  assert.deepEqual(value("volume", col({ v: 12.5 })), { tag: "finite", value: 12.5 });
  assert.deepEqual(value("trades", col({ ct: 9 })), { tag: "finite", value: 9 });
  assert.deepEqual(value("delta", col({ v: 200, bv: 100 })), { tag: "finite", value: 0 });
  assert.deepEqual(value("delta", col({ v: 200, bv: 150 })), { tag: "finite", value: 100 });
  assert.deepEqual(value("takertrades", col({ ct: 10, bt: 7 })), { tag: "finite", value: 4 });
  assert.deepEqual(value("takertrades", col({ ct: 10, bt: 5 })), { tag: "finite", value: 0 });
  assert.deepEqual(value("size", col({ v: 900, ct: 3 })), { tag: "finite", value: 300 });
  assert.deepEqual(value("size", col({ v: 0, ct: 0 })), { tag: "undefined", denominator: "trades" });
  assert.deepEqual(value("choppiness", col({ ct: 4, p: 300, hi: 150, lo: 50 })), { tag: "finite", value: 3 });
  assert.deepEqual(value("choppiness", col({ ct: 0 })), { tag: "undefined", denominator: "trades" });
  assert.deepEqual(value("choppiness", col({ ct: 4, p: 300, hi: 50, lo: 50 })), { tag: "undefined", denominator: "price range" });
  assert.deepEqual(value("choppiness", col({ ct: 4, p: 0 })), { tag: "undefined", denominator: "price range" }, "a movement-only column has NaN high and low");
  assert.deepEqual(value("perpath", col({ v: 900, p: 300 })), { tag: "finite", value: 3 });
  assert.deepEqual(value("perpath", col({ v: 900, p: 0 })), { tag: "undefined", denominator: "path" });
  assert.deepEqual(value("perpath", col({ v: 900, p: NaN })), { tag: "undefined", denominator: "path" });
  // Non-finite numbers are invalid input.
  assert.deepEqual(value("volume", col({ v: NaN })), { tag: "invalid-input", reason: "non-finite" });
  // Unknown key: a non-value, not an exception on the pane's draw path.
  assert.equal(value("no-such-column", col({})).tag, "unsupported");
  // Read status and replay come first.
  assert.deepEqual(value("volume", col({ v: 1 }), { read: { state: "pending" } }), { tag: "pending", reason: "reading" });
  assert.deepEqual(value("volume", col({ v: 1 }), { hidden: true }), { tag: "hidden", reason: "replay" });
  assert.deepEqual(value("volume", col({ v: 1 }), { read: { state: "cube" } }), { tag: "finite", value: 1 });
});

test("columnValue: with `out` it writes tag and value into the caller's scratch, and only there", () => {
  const out = { tag: -1, value: -1, reason: "stale", denominator: "stale" };
  const col = { v: 900, bv: 0, ct: 3, bt: 0, p: 0, hi: NaN, lo: NaN };
  assert.equal(E.measure.columnValue("size", col, null, out), out);
  assert.deepEqual([out.tag, out.value, out.reason, out.denominator], [TAG.finite, 300, null, null]);
  E.measure.columnValue("size", { ...col, ct: 0 }, null, out);
  assert.deepEqual([out.tag, out.reason, out.denominator], [TAG.undefined, null, "trades"]);
  assert.ok(Number.isNaN(out.value));
  E.measure.columnValue("perpath", { ...col, p: 0 }, undefined, out);
  assert.equal(out.denominator, "path");
});

test("columnValue: the two ratio columns take their inputs in ctx.ratio and use E.ratio (D2 ladder)", (t) => {
  if (!E.ratio) return t.skip("needs part 06-ratio; run with ENCODING_ONLY=measure,ratio");
  const cascade = { structure: "complete", childV: 1, parentV: 2, factor: 2 };
  assert.deepEqual(plain(E.measure.columnValue("cascade", {}, { ratio: cascade })), { tag: "finite", value: 0 });
  assert.deepEqual(plain(E.measure.columnValue("cascade", {}, { ratio: { ...cascade, childV: 2 } })), { tag: "finite", value: 1 });
  assert.equal(E.measure.columnValue("cascade", {}, { ratio: { ...cascade, structure: "open" } }).tag, "waiting-for-complete-parent");
  const eff = { structure: "complete", child: { v: 100, rows: 4 }, parent: { v: 400, rows: 10 }, baseline: 0.7002781604436024 };
  const typed = plain(E.measure.columnValue("efficiency", {}, { ratio: eff }));
  assert.equal(typed.tag, "finite");
  assert.ok(Math.abs(typed.value - (Math.log2(5) - 3 + 0.514)) < 1e-12);
  // Without their inputs they are pending, and with `out` the tag is the integer index.
  assert.deepEqual(plain(E.measure.columnValue("cascade", {}, null)), { tag: "pending", reason: "reading" });
  const out = {};
  E.measure.columnValue("cascade", {}, { ratio: cascade }, out);
  assert.deepEqual([out.tag, out.value], [TAG.finite, 0]);
  E.measure.columnValue("cascade", {}, { ratio: { ...cascade, structure: "coarsest" } }, out);
  assert.equal(out.tag, TAG["no-coarser-parent"]);
});

test("cellMeasurement: the full record of B.4 for Intensity, JSON-safe, with both fractions in the exposure", () => {
  const m = plain(E.measure.cellMeasurement(kernel({ mode: "volume", basis: "intensity", z: cell({ v: 1000, ct: 5 }) })));
  assert.equal(m.v, 1);
  assert.equal(m.formula, "cells.volume.intensity@1");
  assert.equal(m.measure, "volume");
  assert.equal(m.basis, "intensity");
  assert.equal(m.unit, "usdt-per-min-per-125usdt");
  assert.equal(m.numerator, 1000);
  assert.equal(m.numeratorUnit, "usdt");
  assert.equal(m.denominator, (900 * 250) / 7500, "seconds * width / (60 * 125)");
  assert.equal(m.denominatorUnit, "usdt*s/60/125");
  assert.equal(m.aggregation, "sum-then-ratio");
  assert.deepEqual(m.result, { tag: "finite", value: 33.333333333333336 });
  assert.equal(m.model, null);
  assert.deepEqual(m.exposure, {
    seconds: 900, width: 250, timeFraction: 1, priceFraction: 1, nominalSeconds: 900, nominalWidth: 250, short: false,
    uses: { t: true, w: true }, coverage: "range", coveredTo: null,
  });
  assert.doesNotThrow(() => E.result.assertJsonSafe(E.measure.cellMeasurement(kernel({ mode: "volume", basis: "intensity", z: cell({ v: 1000 }) }))));
});

test("cellMeasurement: Amount has no denominator or exposure; ratios name their sums; Short exposure is recorded", () => {
  let m = plain(E.measure.cellMeasurement(kernel({ mode: "volume", z: cell({ v: 1873223.5 }) })));
  assert.deepEqual([m.formula, m.numerator, m.denominator, m.exposure, m.aggregation], ["cells.volume.amount@1", 1873223.5, null, null, "sum"]);
  m = plain(E.measure.cellMeasurement(kernel({ mode: "trades", z: cell({ ct: 12 }) })));
  assert.deepEqual([m.formula, m.numerator, m.numeratorUnit, m.unit], ["cells.trades.amount@1", 12, "trades", "trades"]);
  m = plain(E.measure.cellMeasurement(kernel({ mode: "delta", z: cell({ v: 200, bv: 100 }) })));
  assert.deepEqual([m.formula, m.numerator, m.result], ["cells.delta.amount@1", 0, { tag: "finite", value: 0 }]);
  m = plain(E.measure.cellMeasurement(kernel({ mode: "flow", z: cell({ v: 400, bv: 40 }) })));
  assert.deepEqual([m.formula, m.numerator, m.denominator, m.aggregation, m.unit], ["cells.flow.share@1", 40, 400, "sum-then-ratio", "share"]);
  m = plain(E.measure.cellMeasurement(kernel({ mode: "size", z: cell({ v: 900, ct: 0 }) })));
  assert.deepEqual([m.formula, m.result.tag, m.result.denominator], ["cells.size.mean@1", "undefined", "trades"]);
  m = plain(E.measure.cellMeasurement(kernel({ mode: "path", pathBasis: "spans", z: cell({ p: 500 }) })));
  assert.deepEqual([m.formula, m.numerator, m.denominator, m.denominatorUnit, m.exposure.coveredTo], ["cells.path.spans@1", 500, 250, "usdt", "end"]);
  m = plain(E.measure.cellMeasurement(kernel({ mode: "path", pathBasis: "usdt", z: cell({ p: 500 }) })));
  assert.deepEqual([m.formula, m.denominator, m.exposure], ["cells.path.usdt@1", null, null]);
  m = plain(E.measure.cellMeasurement(kernel({ mode: "dwell", z: cell({ w: 300 }) })));
  assert.deepEqual([m.formula, m.numerator, m.denominator, m.denominatorUnit], ["cells.dwell.share@1", 300, 900, "seconds"]);
  // Dwell with a full time fraction and a price fraction of 0.05 IS short (DD-70).
  m = plain(E.measure.cellMeasurement(kernel({ mode: "dwell", bounds: [0, 16, 0, 0.1], z: cell({ w: 300 }) })));
  assert.equal(m.exposure.short, true);
  assert.equal(m.exposure.priceFraction, 0.05);
  assert.equal(m.exposure.timeFraction, 1);
  // A non-value record is still complete and JSON-safe.
  m = E.measure.cellMeasurement(kernel({ mode: "volume", basis: "intensity", bounds: [0, 0, 0, 2], z: cell({ v: 1 }) }));
  assert.equal(m.result.tag, "undefined");
  assert.doesNotThrow(() => E.result.assertJsonSafe(m));
  // Geometry has no measurement.
  m = plain(E.measure.cellMeasurement(kernel({ mode: "geometry" })));
  assert.deepEqual([m.formula, m.unit, m.result.tag], [null, null, "unsupported"]);
  // The caller's spec is not modified (the kernel scratch is added to a copy).
  const spec = kernel({ mode: "volume", basis: "intensity", z: cell({ v: 1 }) });
  E.measure.cellMeasurement(spec);
  assert.equal(spec.exposure, undefined);
});

test("close: the D4 tolerances and the propagated Delta and log-ratio bounds (DD-36)", () => {
  const c = E.measure.close;
  assert.ok(Object.isFrozen(c));
  assert.equal(c.epsUsdt(0), 1e-12);
  assert.equal(c.epsUsdt(1e6), 1e-12 * 1e6 + 1e-12);
  assert.equal(c.epsPath(0), 1e-9);
  assert.equal(c.epsSeconds(900), 1e-12 * 900 + 1e-9);
  assert.equal(c.usdt(1e9, 1e9 + 5e-4), true);
  assert.equal(c.usdt(1e9, 1e9 + 2e-3), false);
  assert.equal(c.usdt(0, 5e-13), true);
  assert.equal(c.usdt(0, 5e-12), false);
  assert.equal(c.path(100, 100 + 5e-10), true);
  assert.equal(c.path(100, 100 + 5e-9), false);
  assert.equal(c.seconds(900, 900 + 1e-9), true);
  assert.equal(c.seconds(900, 900 + 1e-8), false);
  // deltaEps(bv, v) = 2*eps(bv) + eps(v). The cancellation vector of U23: bv = 5e9, v = 1e10 against
  // bv' = 5000000000.004, v' = 9999999999.99. Delta is 0 against 0.018: within the propagated 0.02, while the
  // relative error against a nearly cancelled result is infinite.
  assert.ok(Math.abs(c.deltaEps(5e9, 1e10) - 0.02) < 1e-9);
  const before = 2 * 5e9 - 1e10;
  const after = 2 * 5000000000.004 - 9999999999.99;
  assert.equal(before, 0);
  assert.ok(Math.abs(after - 0.018) < 1e-5);
  assert.equal(c.delta(before, after, 5e9, 1e10), true);
  assert.equal(c.delta(0, 0.05, 5e9, 1e10), false);
  // log2Eps(v, V) = (eps(v)/v + eps(V)/V) / ln 2
  assert.ok(Math.abs(c.log2Eps(100, 400) - (1.01e-10 / 100 + 4.01e-10 / 400) / Math.LN2) < 1e-20);
  assert.equal(c.log2(1, 1 + 1e-13, 100, 400), true);
  assert.equal(c.log2(1, 1.001, 100, 400), false);
});

test("the frozen surface: every documented name exists, frozen", () => {
  assert.ok(Object.isFrozen(E.measure));
  for (const name of ["FORMULAS", "MODES", "ROWS", "exposure", "usesOf", "isShort", "cellValue", "cellMeasurement", "columnValue", "dwellCheck", "dwellResidual", "cellState", "close"])
    assert.notEqual(E.measure[name], undefined, name);
  assert.equal(E.measure.cellValue.length, 2);
  assert.equal(E.measure.exposure.length, 8);
  assert.equal(E.measure.cellState.length, 7);
});
