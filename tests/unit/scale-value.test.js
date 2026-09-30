"use strict";
// U15 (T-scale, Value): E.scale fitValue / manual / zeroOnly / plan / apply / index / id / validate /
// sameWithin of src/encoding.js, loaded through tests/support/enc.js.
// Oracles (none is the code under test): the hand vectors of API.md Appendix A.2 and A.3 and of TESTPLAN.md
// U15 (worked out by hand and rechecked with a calculator, quoted below); the closed forms
// log1p(|x|/k)/log1p(U/k) and |x|/U written out again inside this file with plain Math (a different
// structure from the module's plan closures); the nine mapping ids of API.md A.2 and the canonical text of
// C.7; a hand-written sorted-array Type-7 median (mean of the two middle values) for k; d3.quantileSorted
// (vendor/d3.min.js) for the median of random cohorts; a seeded property test whose invariants are stated
// as inequalities, not recomputed with the module.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): its arrays and errors are of another
// realm, so records are compared through JSON and errors by name.
// The Python decimal goldens (tests/fixtures/scales/value-vectors.json, 80 digits, package H3) are compared in
// the last test of this file: a third oracle that shares neither code nor arithmetic with the module.
// Not here: cohort EXTRACTION (placeholders, partial and open cells, unread) is U17 (part 09).
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const d3 = require("../../vendor/d3.min.js");
const { mulberry32 } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (e) => typeof e === "object" && e !== null && /Error$/.test(e.name);
const fit = (values, opts = {}) => E.scale.fitValue({ values: Float64Array.from(values) }, opts);
// One evaluation as a plain triple.
function at(desc, x) {
  const out = {};
  E.scale.apply(desc, x, out);
  return { t: out.t, clip: out.clip, state: out.state };
}
const CLIP = { NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 };
// The closed forms, written again here.
const logT = (x, U, k) => Math.log1p(Math.abs(x) / k) / Math.log1p(U / k);

test("CLIP is the frozen small-integer alphabet of C.5; index is round(clamp(|t|,0,1)*255) with ties up", () => {
  assert.deepEqual(plain(E.scale.CLIP), CLIP);
  assert.ok(Object.isFrozen(E.scale.CLIP));
  const idx = E.scale.index;
  assert.equal(idx(0), 0);
  assert.equal(idx(1), 255);
  assert.equal(idx(0.5), 128, "127.5 rounds up");
  assert.equal(idx(-0.5), 128, "only |t| counts: the sign picks the arm elsewhere");
  assert.equal(idx(-1), 255);
  assert.equal(idx(1.191870644681009), 255, "clamped above");
  assert.equal(idx(7), 255);
  assert.equal(idx(0.04), 10);
  assert.equal(idx(0.4), 102);
  assert.equal(idx(1 / 255), 1);
  assert.equal(idx(0.5 / 255 - 1e-12), 0, "just below the first tie");
  assert.equal(idx(0.5 / 255 + 1e-12), 1, "just above it");
  assert.equal(idx(NaN), 0, "a NaN never becomes a plausible colour");
});

test("fit hand vector [1,2,3,4,100]: U = 100, k = 3, and the coordinates of TESTPLAN U15", () => {
  const f = fit([1, 2, 3, 4, 100]);
  assert.equal(f.state, "ok");
  const d = f.descriptor;
  assert.equal(d.kind, "value-log1p");
  assert.equal(d.signed, false);
  assert.deepEqual(plain(d.params), { U: 100, k: 3 });
  assert.equal(d.clip, "clamp01@1");
  assert.equal(d.algorithm, "value-fit@1");
  assert.equal(d.id, E.scale.id(d));
  const t3 = at(d, 3);
  assert.ok(Math.abs(t3.t - 0.19601931707907) < 1e-14, "t(3) = " + t3.t);
  assert.equal(E.scale.index(t3.t), 50);
  assert.equal(t3.clip, CLIP.NONE);
  const t1 = at(d, 1);
  assert.ok(Math.abs(t1.t - 0.08135536717084396) < 1e-16);
  assert.equal(E.scale.index(t1.t), 21);
  const top = at(d, 100);
  assert.equal(top.t, 1, "t(U) is exactly 1: the same expression divided by itself");
  assert.equal(top.clip, CLIP.EXACT_HIGH, "the maximum sits on the endpoint and is not out of range");
  // A later value above the fitted maximum: the drawing coordinate is clipped to 1 and flagged HIGH; the
  // unclipped coordinate is 1.191870644681009 (the readout keeps the raw value, S1-071).
  const over = at(d, 200);
  assert.equal(over.t, 1);
  assert.equal(over.clip, CLIP.HIGH);
  assert.ok(Math.abs(logT(200, 100, 3) - 1.191870644681009) < 1e-15, "the documented unclipped coordinate");
  assert.equal(at(d, 0).t, 0);
  assert.equal(at(d, 0).clip, CLIP.NONE);
});

test("fit vectors of API.md A.3: [5,5,5], [0,0], [], [1,2,3,10] and the signed [-3,3,0,9]", () => {
  assert.deepEqual(plain(fit([5, 5, 5]).descriptor.params), { U: 5, k: 5 });
  const zero = fit([0, 0]);
  assert.equal(zero.state, "ok");
  assert.equal(zero.descriptor.kind, "zero-only");
  assert.equal(zero.descriptor.params, null);
  const empty = fit([]);
  assert.equal(empty.state, "no-calibration");
  assert.equal(empty.descriptor, null);
  assert.equal(empty.reason, "empty cohort");
  assert.deepEqual(plain(fit([1, 2, 3, 10]).descriptor.params), { U: 10, k: 2.5 }, "even count: the mean of the two middle magnitudes");
  const s = fit([-3, 3, 0, 9], { signed: true });
  assert.equal(s.descriptor.signed, true);
  assert.deepEqual(plain(s.descriptor.params), { U: 9, k: 3 }, "pooled magnitudes 3,3,9; the zero is counted, not a member of k");
});

test("all-equal nonzero cohort: U = k = that value and it maps to the maximum", () => {
  for (const v of [5, 0.25, 3e9]) {
    const d = fit([v, v, v, v]).descriptor;
    assert.deepEqual(plain(d.params), { U: v, k: v });
    const r = at(d, v);
    assert.equal(r.t, 1);
    assert.equal(r.clip, CLIP.EXACT_HIGH);
  }
  const one = fit([42]).descriptor;
  assert.deepEqual(plain(one.params), { U: 42, k: 42 });
});

test("signed pooled fit [-5,-1,0,2,10]: U = 10, k = 3.5, the arm is chosen by sign, zero is the midpoint without 0/0", () => {
  const d = fit([-5, -1, 0, 2, 10], { signed: true }).descriptor;
  assert.deepEqual(plain(d.params), { U: 10, k: 3.5 });
  assert.ok(Math.abs(at(d, -5).t - -0.6572973064836486) < 1e-15);
  assert.ok(Math.abs(at(d, 5).t - 0.6572973064836486) < 1e-15, "one pooled scale: +5 and -5 are equally strong");
  assert.ok(Math.abs(at(d, 2).t - 0.3348219707545264) < 1e-15);
  assert.ok(Math.abs(at(d, -1).t - -logT(1, 10, 3.5)) < 1e-15);
  const zero = at(d, 0);
  assert.equal(zero.t, 0);
  assert.ok(Object.is(zero.t, 0), "a plain +0, never NaN and never -0");
  assert.equal(zero.clip, CLIP.NONE);
  assert.ok(Object.is(at(d, -0).t, 0));
  const low = at(d, -10);
  assert.equal(low.t, -1);
  assert.equal(low.clip, CLIP.EXACT_HIGH, "the largest magnitude is the endpoint on either side");
  const beyond = at(d, -25);
  assert.equal(beyond.t, -1);
  assert.equal(beyond.clip, CLIP.HIGH, "beyond the fitted maximum on the negative side");
});

test("the unsigned fit uses values >= 0 only; negatives and non-finite values are never members", () => {
  const f = fit([0, 0, 5, -3, 10, NaN, Infinity, -Infinity]);
  assert.deepEqual(plain(f.descriptor.params), { U: 10, k: 7.5 }, "members 5 and 10 (the zeros are not members of k)");
  const onlyBad = fit([NaN, -1, Infinity]);
  assert.equal(onlyBad.state, "no-calibration");
  assert.equal(onlyBad.reason, "empty cohort");
  // Signed keeps both signs and still drops non-finite values.
  assert.deepEqual(plain(fit([-4, NaN, 2, 8], { signed: true }).descriptor.params), { U: 8, k: 4 });
  // A cohort given as a plain array (not {values}) works the same, although every Array has a values method.
  assert.deepEqual(plain(E.scale.fitValue([1, 2, 3, 10]).descriptor.params), { U: 10, k: 2.5 });
  assert.equal(E.scale.fitValue([]).state, "no-calibration");
});

test("linear alternative: t = |x| / U with the same overflow rule; the kind and id differ from log1p", () => {
  const d = fit([1, 2, 3, 10], { linear: true }).descriptor;
  assert.equal(d.kind, "value-linear");
  assert.deepEqual(plain(d.params), { U: 10 });
  assert.equal(at(d, 5).t, 0.5);
  assert.equal(at(d, 10).t, 1);
  assert.equal(at(d, 10).clip, CLIP.EXACT_HIGH);
  assert.equal(at(d, 12).t, 1);
  assert.equal(at(d, 12).clip, CLIP.HIGH);
  assert.notEqual(d.id, fit([1, 2, 3, 10]).descriptor.id);
  const s = fit([-2, 4], { linear: true, signed: true }).descriptor;
  assert.equal(at(s, -2).t, -0.5);
  assert.equal(at(s, 4).t, 1);
});

test("zero-only (D3, DD-95): a measured zero is fine; any other value is out of domain, clipped and flagged", () => {
  const d = E.scale.zeroOnly(false);
  assert.equal(d.kind, "zero-only");
  assert.equal(d.signed, false);
  assert.equal(d.params, null);
  assert.deepEqual(at(d, 0), { t: 0, clip: CLIP.NONE, state: null });
  assert.deepEqual(at(d, 7), { t: 1, clip: CLIP.HIGH, state: "out-of-domain" });
  const s = E.scale.zeroOnly(true);
  assert.equal(s.signed, true);
  assert.deepEqual(at(s, -7), { t: -1, clip: CLIP.HIGH, state: "out-of-domain" }, "a signed mapping keeps the side of the value");
  assert.deepEqual(at(s, 3), { t: 1, clip: CLIP.HIGH, state: "out-of-domain" });
  assert.notEqual(d.id, s.id);
});

test("apply writes into and returns the caller's out object, and never leaves a stale state behind", () => {
  const out = { t: 9, clip: 9, state: "stale" };
  const zero = E.scale.zeroOnly(false);
  assert.equal(E.scale.apply(zero, 5, out), out);
  assert.equal(out.state, "out-of-domain");
  const d = fit([1, 2, 3, 10]).descriptor;
  assert.equal(E.scale.apply(d, 5, out), out);
  assert.equal(out.state, null, "a value evaluator resets the state");
  E.scale.apply(zero, 5, out);
  E.scale.apply(E.scale.fixed("unsigned-share"), 0.5, out);
  assert.equal(out.state, null);
});

test("plan: {signed, kind, apply, index}, cached per descriptor object, frozen; apply is the same evaluator", () => {
  const d = fit([1, 2, 3, 10]).descriptor;
  const p = E.scale.plan(d);
  assert.equal(p, E.scale.plan(d), "one plan per descriptor object (DD-44)");
  assert.deepEqual(Object.keys(p).sort(), ["apply", "index", "kind", "signed"]);
  assert.equal(p.kind, "value-log1p");
  assert.equal(p.signed, false);
  assert.equal(p.index, E.scale.index);
  assert.ok(Object.isFrozen(p));
  const a = {};
  const b = {};
  p.apply(4, a);
  E.scale.apply(d, 4, b);
  assert.deepEqual(plain(a), plain(b));
  assert.equal(p.apply(4, a), a);
  assert.throws(() => E.scale.plan(null), isError);
  assert.throws(() => E.scale.plan({ kind: "nope", params: null }), (e) => isError(e) && /unknown descriptor kind/.test(e.message));
  // "none": No calibration has no coordinate.
  const none = E.scale.plan({ v: 1, kind: "none", signed: false, params: null, clip: "clamp01@1" });
  assert.equal(none.apply(3, {}).state, "no-calibration");
  // A descriptor is frozen, so a cached plan cannot go stale.
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(d.params));
});

test("descriptors are JSON-safe and round-trip through JSON with the same id and the same coordinates", () => {
  for (const d of [fit([1, 2, 3, 4, 100]).descriptor, fit([-5, -1, 2, 10], { signed: true }).descriptor, E.scale.zeroOnly(true), fit([1, 3], { linear: true }).descriptor]) {
    const back = JSON.parse(JSON.stringify(d));
    assert.deepEqual(back, plain(d));
    assert.deepEqual(plain(E.scale.validate(back, { requireId: true })), { ok: true });
    assert.equal(E.scale.id(back), d.id);
    for (const x of [0, 0.5, 1, 2, 3, 4, 10, 100, 250, -3, -20]) assert.deepEqual(at(back, x), at(d, x), "x = " + x);
  }
});

test("mapping ids and canonical JSON: the vectors of API.md A.2 and C.7", () => {
  const vec = (kind, signed, params) => ({ v: 1, kind, signed, params, clip: "clamp01@1" });
  assert.equal(E.scale.canonical(vec("value-log1p", false, { U: 1000, k: 12.5 })), '{"clip":"clamp01@1","kind":"value-log1p","params":{"U":1000,"k":12.5},"signed":false,"v":1}');
  assert.equal(E.scale.id(vec("value-log1p", false, { U: 1000, k: 12.5 })), "UZux2TUwWna1lHYf");
  assert.equal(E.scale.id(vec("value-log1p", false, { U: 26791234.56, k: 48211.3 })), "3s_XdONgi8CSqyOl");
  assert.equal(E.scale.id(vec("value-log1p", true, { U: 1204551.25, k: 8830.5 })), "ot_D8yL_NiaSousm");
  assert.equal(E.scale.id(vec("value-linear", false, { U: 26791234.56 })), "omnQDSYNT2RkWZdf");
  assert.equal(E.scale.id(vec("zero-only", false, null)), "C5LleVNGDTk1DpfK");
  // The same through the constructors: units, measure and origin are not in the id (DR-03).
  assert.equal(E.scale.manual({ kind: "value-log1p", signed: false, U: 26791234.56, k: 48211.3 }).descriptor.id, "3s_XdONgi8CSqyOl");
  assert.equal(E.scale.manual({ kind: "value-log1p", signed: true, U: 1204551.25, k: 8830.5 }).descriptor.id, "ot_D8yL_NiaSousm");
  assert.equal(E.scale.manual({ kind: "value-linear", signed: false, U: 26791234.56 }).descriptor.id, "omnQDSYNT2RkWZdf");
  assert.equal(E.scale.zeroOnly(false).id, "C5LleVNGDTk1DpfK");
  assert.equal(fit([5, 5, 5]).descriptor.id, E.scale.id(vec("value-log1p", false, { U: 5, k: 5 })), "a fit and a hand-built record with the same numbers share the id");
  // The id ignores the algorithm and id fields and -0 spelling; it changes with any hashed field.
  const base = vec("value-log1p", false, { U: 1000, k: 12.5 });
  assert.equal(E.scale.id({ ...base, algorithm: "manual@1", id: "anything" }), "UZux2TUwWna1lHYf");
  assert.notEqual(E.scale.id({ ...base, signed: true }), "UZux2TUwWna1lHYf");
  assert.notEqual(E.scale.id({ ...base, v: 2 }), "UZux2TUwWna1lHYf", "the mapping version is hashed");
  const { v, ...noVersion } = base;
  assert.equal(E.scale.id(noVersion), "UZux2TUwWna1lHYf", "a hand-built record without v hashes the current mapping version");
  assert.notEqual(E.scale.id(vec("value-log1p", false, { U: 1000, k: 12.500000000000002 })), "UZux2TUwWna1lHYf");
  assert.equal(E.scale.id(vec("fixed-linear", false, { lo: -0, hi: 1 })), E.scale.id(vec("fixed-linear", false, { lo: 0, hi: 1 })));
});

test("manual: validates finite positive U and k (k <= U), or lo < hi; origin manual; refusals carry a reason", () => {
  const ok = E.scale.manual({ kind: "value-log1p", signed: false, U: 100, k: 3 });
  assert.equal(ok.state, "ok");
  assert.equal(ok.origin, "manual");
  assert.equal(ok.descriptor.algorithm, "manual@1");
  assert.equal(ok.descriptor.id, fit([1, 2, 3, 4, 100]).descriptor.id, "the same numbers give the same id whatever their origin");
  const lin = E.scale.manual({ kind: "value-linear", U: 8 });
  assert.equal(lin.descriptor.kind, "value-linear");
  assert.equal(lin.descriptor.signed, false);
  const win = E.scale.manual({ kind: "fixed-linear", lo: 0.2, hi: 0.8 });
  assert.deepEqual(plain(win.descriptor.params), { lo: 0.2, hi: 0.8 });
  const div = E.scale.manual({ kind: "fixed-diverging", lo: 0.4, hi: 0.6 });
  assert.deepEqual(plain(div.descriptor.params), { lo: 0.4, hi: 0.6, mid: 0.5 });
  assert.equal(div.descriptor.signed, true);
  const refused = [
    [{ kind: "value-log1p", U: 0, k: 1 }, /U must be/],
    [{ kind: "value-log1p", U: -5, k: 1 }, /U must be/],
    [{ kind: "value-log1p", U: NaN, k: 1 }, /U must be/],
    [{ kind: "value-log1p", U: Infinity, k: 1 }, /U must be/],
    [{ kind: "value-log1p", U: 5, k: 0 }, /k must be/],
    [{ kind: "value-log1p", U: 5 }, /k must be/],
    [{ kind: "value-log1p", U: 5, k: 6 }, /k must not exceed U/],
    [{ kind: "value-linear", U: 0 }, /U must be/],
    [{ kind: "fixed-linear", lo: 1, hi: 1 }, /lo must be below hi/],
    [{ kind: "fixed-linear", lo: 2, hi: 1 }, /lo must be below hi/],
    [{ kind: "fixed-linear", lo: NaN, hi: 1 }, /lo must be below hi/],
    [{ kind: "fixed-linear", lo: 0, hi: 1, signed: true }, /unsigned/],
    [{ kind: "fixed-diverging", lo: 0, hi: 1, mid: 1 }, /mid must lie/],
    [{ kind: "rank-type7-257", U: 1 }, /manual domain is/],
    [null, /object/],
  ];
  for (const [input, why] of refused) {
    const r = E.scale.manual(input);
    assert.equal(r.state, "no-calibration", JSON.stringify(input));
    assert.equal(r.descriptor, null);
    assert.match(r.reason, why, JSON.stringify(input));
    assert.equal(r.origin, "manual");
  }
});

test("validate accepts every kind it makes and rejects malformed descriptors with a reason and a path", () => {
  const good = fit([1, 2, 3, 10]).descriptor;
  assert.deepEqual(plain(E.scale.validate(good)), { ok: true });
  assert.deepEqual(plain(E.scale.validate(good, { requireId: true })), { ok: true });
  for (const d of [E.scale.zeroOnly(false), E.scale.fixed("share-diverging"), E.scale.fixed("unsigned-share"), E.scale.fixed("log2-ratio"), fit([1, 2, 3], { linear: true }).descriptor,
    { v: 1, kind: "axis-linear", signed: false, params: { lo: 0, hi: 1920000000 }, clip: "axis@1" }]) {
    assert.deepEqual(plain(E.scale.validate(d)), { ok: true }, d.kind);
  }
  // A record without an id is fine unless the import demands one.
  const noId = { v: 1, kind: "value-log1p", signed: false, params: { U: 100, k: 3 }, clip: "clamp01@1" };
  assert.deepEqual(plain(E.scale.validate(noId)), { ok: true });
  const bad = (change, reason, where, opts) => {
    const d = { ...plain(good), ...change };
    const r = plain(E.scale.validate(d, opts));
    assert.equal(r.ok, false, JSON.stringify(change));
    assert.match(r.reason, reason, JSON.stringify(change));
    assert.equal(r.path, where, JSON.stringify(change));
  };
  bad({ id: "AAAAAAAAAAAAAAAA" }, /id does not match/, "id");
  bad({ id: 12 }, /id does not match/, "id");
  bad({ id: undefined }, /id is missing/, "id", { requireId: true });
  bad({ v: 2 }, /version/, "v");
  bad({ kind: "value-exp" }, /unknown kind/, "kind");
  bad({ signed: "no" }, /signed/, "signed");
  bad({ clip: "none" }, /clip/, "clip");
  bad({ clip: "axis@1" }, /clip/, "clip");
  bad({ extra: 1 }, /unknown field/, "extra");
  bad({ algorithm: 5 }, /algorithm/, "algorithm");
  bad({ params: { U: 100, k: 200 } }, /k must not exceed U/, "params.k");
  bad({ params: { U: 100, k: 0 } }, /k must be positive/, "params.k");
  bad({ params: { U: 0, k: 0 } }, /positive/, "params.k");
  bad({ params: { U: -1, k: 0.5 } }, /U must be positive/, "params.U");
  bad({ params: { U: 100, k: NaN } }, /finite/, "params.k");
  bad({ params: { U: Infinity, k: 3 } }, /finite/, "params.U");
  bad({ params: { U: "100", k: 3 } }, /finite/, "params.U");
  bad({ params: { U: 100 } }, /missing/, "params.k");
  bad({ params: { U: 100, k: 3, z: 1 } }, /unknown parameter/, "params.z");
  bad({ params: null }, /object/, "params");
  bad({ params: { U: 1e308, k: 1e-300 } }, /too large/, "params.U");
  assert.equal(plain(E.scale.validate(null)).ok, false);
  assert.equal(plain(E.scale.validate([])).ok, false);
  assert.equal(plain(E.scale.validate("x")).path, "$");
  assert.equal(plain(E.scale.validate({ ...plain(E.scale.zeroOnly(false)), params: { U: 1 } })).ok, false, "zero-only has no parameters");
  assert.equal(plain(E.scale.validate({ ...plain(E.scale.fixed("share-diverging")), signed: false })).ok, false, "a diverging mapping is signed");
  assert.equal(plain(E.scale.validate({ ...plain(E.scale.fixed("unsigned-share")), signed: true })).ok, false, "a linear window is unsigned");
  assert.equal(plain(E.scale.validate({ ...plain(E.scale.fixed("share-diverging")), params: { lo: 0, hi: 1, mid: 1 } })).path, "params.mid");
});

test("sameWithin (DD-19): same id, or every parameter within 1e-12 of the active one; otherwise different", () => {
  const a = E.scale.manual({ kind: "value-log1p", signed: false, U: 1000, k: 12.5 }).descriptor;
  assert.equal(E.scale.sameWithin(a, a), true);
  assert.equal(E.scale.sameWithin(a, E.scale.manual({ kind: "value-log1p", signed: false, U: 1000, k: 12.5 }).descriptor), true, "equal ids");
  const jitter = E.scale.manual({ kind: "value-log1p", signed: false, U: 1000 * (1 + 4e-13), k: 12.5 * (1 - 4e-13) }).descriptor;
  assert.notEqual(jitter.id, a.id, "a last-bit refit would mint a new id...");
  assert.equal(E.scale.sameWithin(a, jitter), true, "...which Auto must not accept as a change");
  const off = E.scale.manual({ kind: "value-log1p", signed: false, U: 1000 * (1 + 2e-12), k: 12.5 }).descriptor;
  assert.equal(E.scale.sameWithin(a, off), false);
  assert.equal(E.scale.sameWithin(a, E.scale.manual({ kind: "value-log1p", signed: true, U: 1000, k: 12.5 }).descriptor), false, "signedness");
  assert.equal(E.scale.sameWithin(a, E.scale.manual({ kind: "value-linear", signed: false, U: 1000 }).descriptor), false, "kind");
  assert.equal(E.scale.sameWithin(E.scale.zeroOnly(false), E.scale.zeroOnly(false)), true);
  assert.equal(E.scale.sameWithin(E.scale.zeroOnly(false), a), false);
  assert.equal(E.scale.sameWithin(a, null), false);
  assert.equal(E.scale.sameWithin(null, null), true, "the very same (absent) thing");
  const w1 = E.scale.fixed("share-diverging", [0.45, 0.55]);
  const w2 = E.scale.fixed("share-diverging", [0.45 * (1 + 1e-13), 0.55]);
  assert.equal(E.scale.sameWithin(w1, w2), true);
  assert.equal(E.scale.sameWithin(w1, E.scale.fixed("share-diverging", [0.4, 0.6])), false);
});

// ---- properties -------------------------------------------------------------------------------------

// A cohort with the awkward shapes of D10: ties, tiny and huge magnitudes, zeros, both signs.
function randomCohort(next, signed) {
  const n = 1 + Math.floor(next() * 400);
  const scale = Math.pow(10, Math.floor(next() * 14) - 4);
  const pool = [];
  const values = [];
  for (let i = 0; i < n; i++) {
    let v;
    const r = next();
    if (r < 0.1) v = 0;
    else if (r < 0.3 && pool.length) v = pool[Math.floor(next() * pool.length)];
    else v = Math.exp((next() - 0.5) * 9) * scale;
    if (v !== 0) pool.push(v);
    values.push(signed && next() < 0.5 ? -v : v);
  }
  return values;
}

test("property (500 seeded cohorts): no finite cohort value maps above 1, t(U) === 1, monotone in |x|, never NaN", () => {
  const next = mulberry32(20260930);
  let zeroOnlyFits = 0;
  for (let c = 0; c < 500; c++) {
    const signed = c % 2 === 1;
    const linear = c % 5 === 0;
    const values = randomCohort(next, signed);
    const f = fit(values, { signed, linear });
    assert.equal(f.state, "ok", "cohort " + c);
    const d = f.descriptor;
    if (d.kind === "zero-only") {
      zeroOnlyFits++;
      continue;
    }
    const { U, k } = plain(d.params);
    const mags = values.filter((v) => v !== 0).map(Math.abs);
    assert.equal(U, Math.max(...mags), "U is the largest magnitude, cohort " + c);
    if (!linear) {
      assert.ok(k > 0 && k <= U, "0 < k <= U, cohort " + c);
      const sorted = Float64Array.from(mags).sort();
      assert.equal(k, d3.quantileSorted(sorted, 0.5), "k is the Type-7 median (d3), cohort " + c);
    }
    const top = at(d, U);
    assert.equal(top.t, 1, "t(U) === 1, cohort " + c);
    assert.equal(top.clip, CLIP.EXACT_HIGH);
    let prev = -Infinity;
    for (const x of Float64Array.from(mags).sort()) {
      const r = at(d, x);
      assert.ok(Number.isFinite(r.t) && r.t > 0 && r.t <= 1, "0 < t <= 1 for a cohort value, cohort " + c + " x " + x + " t " + r.t);
      assert.notEqual(r.clip, CLIP.HIGH, "a cohort value never overflows its own fit");
      assert.notEqual(r.clip, CLIP.LOW);
      assert.ok(r.t >= prev, "monotone non-decreasing in |x|, cohort " + c);
      prev = r.t;
      if (signed) assert.equal(at(d, -x).t, -r.t, "the sign only selects the arm");
      const closed = linear ? x / U : logT(x, U, k);
      assert.ok(Math.abs(r.t - Math.min(1, closed)) <= 1e-15 * Math.max(1, Math.abs(closed)) * 4, "closed form, cohort " + c);
    }
    assert.equal(at(d, 0).t, 0);
    // A value beyond the fitted maximum is flagged, its drawing coordinate clipped to 1.
    const beyond = at(d, U * 1.5);
    assert.equal(beyond.t, 1);
    assert.equal(beyond.clip, CLIP.HIGH);
  }
  assert.ok(zeroOnlyFits < 500, "the generator produces real cohorts, not only zeros");
});

test("property: tiny and huge magnitudes, subnormal-adjacent k and U/k that stays finite never give NaN or a t above 1", () => {
  for (const [U, k] of [[1e-300, 1e-300], [1e300, 1e300], [1e300, 1], [1, 1e-300], [5e-324, 5e-324], [1.7976931348623157e308, 1.7976931348623157e308]]) {
    const r = E.scale.manual({ kind: "value-log1p", signed: false, U, k });
    if (r.state !== "ok") continue; // U / k overflowed: refused, never a NaN mapping
    for (const x of [0, k, U, U / 2, U * 2, 5e-324]) {
      const v = at(r.descriptor, x);
      assert.ok(Number.isFinite(v.t) && v.t >= 0 && v.t <= 1, "U " + U + " k " + k + " x " + x + " -> " + v.t);
    }
  }
});

// The golden fixture of package H3 (format value-golden-1, see its `note`): t is evaluated at 80 significant
// digits and rounded once to a double, NOT clipped, so the module's clipped coordinate is compared with
// min(|t|, 1) carrying the sign of x. Tolerance 1e-15 relative (the stated one; two libm log1p evaluations
// may differ by a few ulps, an ulp of a number near 1 is 1.1e-16). `over` (|x| above U) must raise the HIGH
// flag, `atU` the exact-end flag; `index` is compared unless it is null, which says that a double t could fall
// on either side of a rounding tie, so then either neighbour is acceptable. NaN travels as the string "NaN".
const fs = require("node:fs");
const path = require("node:path");
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/scales/value-vectors.json"), "utf8"));
const fromJson = (x) => (x === "NaN" ? NaN : x === "Infinity" ? Infinity : x === "-Infinity" ? -Infinity : x === "-0" ? -0 : x);

test("goldens vs tests/fixtures/scales/value-vectors.json at 1e-15 relative (package H3)", () => {
  assert.equal(GOLDEN.format, "value-golden-1");
  assert.ok(GOLDEN.cases.length >= 12, "the fixture holds its twelve cases");
  let probes = 0;
  let ties = 0;
  for (const c of GOLDEN.cases) {
    const cohort = c.cohort.map(fromJson);
    for (const linear of [false, true]) {
      const kind = linear ? "linear" : "log1p";
      const f = fit(cohort, { signed: c.signed, linear });
      const tag = c.name + " " + kind;
      if (c.state === "no-calibration") {
        assert.equal(f.state, "no-calibration", tag);
        assert.equal(f.descriptor, null, tag);
        continue;
      }
      assert.equal(f.state, "ok", tag);
      if (c.state === "zero-only") {
        assert.equal(f.descriptor.kind, "zero-only", tag);
        continue;
      }
      const d = f.descriptor;
      assert.equal(d.kind, linear ? "value-linear" : "value-log1p", tag);
      assert.equal(d.signed, c.signed, tag);
      assert.equal(d.params.U, fromJson(c.U), tag + ": U is a selected cohort value, so it is exact");
      if (!linear) assert.equal(d.params.k, fromJson(c.k), tag + ": k = " + c.kExact + " is an exact double");
      for (const p of c[kind]) {
        const x = fromJson(p.x);
        const got = at(d, x);
        const want = fromJson(p.t);
        const at1 = Math.max(-1, Math.min(1, want));
        assert.ok(Math.abs(got.t - at1) <= 1e-15 * Math.max(1, Math.abs(at1)), tag + " x " + x + ": t " + got.t + ", golden " + want);
        if (Math.abs(want) > 1) assert.ok(Math.abs(got.t) === 1, tag + " x " + x + ": the drawing coordinate is clipped to the end");
        assert.equal(got.clip === CLIP.HIGH, p.over, tag + " x " + x + ": HIGH exactly above U");
        assert.equal(got.clip === CLIP.EXACT_HIGH, p.atU, tag + " x " + x + ": the exact-end flag exactly at U");
        if (p.over === false && p.atU === false) assert.equal(got.clip, CLIP.NONE, tag + " x " + x + ": no flag inside the fitted range");
        const idx = E.scale.index(got.t);
        if (p.index === null) {
          ties++;
          // either side of the tie: the two neighbours of round(|t| * 255) differ by one, and idx is one of them
          assert.ok(Math.abs(idx / 255 - Math.min(1, Math.abs(want))) <= 0.5 / 255 + 1e-9, tag + " x " + x + ": index " + idx + " is a neighbour of the tie");
        } else {
          assert.equal(idx, p.index, tag + " x " + x + ": index");
        }
        probes++;
      }
    }
  }
  assert.ok(probes >= 250, "a fixture that compares nothing proves nothing: " + probes + " probes");
  assert.ok(ties > 0, "the tie rule is exercised");
});
