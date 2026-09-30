"use strict";
// U16 (T-scale, Rank): E.scale.fitRank and apply for kind rank-type7-257 of src/encoding.js, loaded through
// tests/support/enc.js.
// Oracles (none is the code under test), three that must agree on every knot:
//   1. an exact-rational Type-7 written INSIDE this file with BigInt fractions: every double is converted
//      to its exact rational, h = (N-1)j/256 is an integer division, and the knot is the exact rational
//      s[lo] + f (s[lo+1] - s[lo]) rounded once to a double;
//   2. d3.quantileSorted (vendor/d3.min.js), the reference Type-7;
//   3. the hand vectors of API.md C.3 and A.3 and of TESTPLAN U16 (worked out by hand).
// The rank APPLY is checked against a second exact-rational oracle that uses a linear scan over the knots
// (the module bisects), so the two share no structure. Restoration is checked bit-exactly through
// Buffer (node's own big-endian double codec) and JSON.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): records are compared through JSON.
// Not here: rank-vectors.json (Python decimal goldens, package H3) is a todo until that fixture exists;
// the availability table (rank is not offered for signed Delta, fixed shares and ratios, RSI) is
// E.policy.offers (U26b, package W1-E).
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const d3 = require("../../vendor/d3.min.js");
const { mulberry32 } = require("../support/rng");

const plain = (x) => JSON.parse(JSON.stringify(x));
const CLIP = { NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 };
const fitRank = (values) => E.scale.fitRank({ values: Float64Array.from(values) });
const knotsOf = (f) => Array.from(f.descriptor.params.knots);
function at(desc, x) {
  const out = {};
  E.scale.apply(desc, x, out);
  return { t: out.t, clip: out.clip };
}

// ---- exact-rational oracle (BigInt fractions) -------------------------------------------------------
function ratOf(x) {
  let y = x;
  let d = 1n;
  while (!Number.isInteger(y)) {
    y *= 2; // exact in binary floating point
    d *= 2n;
  }
  return { n: BigInt(y), d };
}
const ratSub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const ratAdd = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const ratMul = (a, b) => ({ n: a.n * b.n, d: a.d * b.d });
const ratDiv = (a, b) => ({ n: a.n * b.d, d: a.d * b.n });
const bitLen = (n) => (n === 0n ? 0 : (n < 0n ? -n : n).toString(2).length);
// The nearest double to a rational, to within one rounding of the truncated quotient (about 100 bits).
function ratToNumber(r) {
  if (r.n === 0n) return 0;
  const neg = (r.n < 0n) !== (r.d < 0n);
  const n = r.n < 0n ? -r.n : r.n;
  const d = r.d < 0n ? -r.d : r.d;
  const shift = 100 - (bitLen(n) - bitLen(d));
  const q = shift >= 0 ? (n << BigInt(shift)) / d : n / (d << BigInt(-shift));
  let v = Number(q);
  // Two steps so neither factor overflows or underflows on the way.
  const half = Math.trunc(-shift / 2);
  v = v * Math.pow(2, half) * Math.pow(2, -shift - half);
  return neg ? -v : v;
}
// The exact Type-7 knots of ascending numbers s.
function exactKnots(s) {
  const N = s.length;
  const out = [];
  for (let j = 0; j < 257; j++) {
    const prod = BigInt(N - 1) * BigInt(j);
    const lo = Number(prod / 256n);
    if (lo >= N - 1) {
      out.push(s[N - 1]);
      continue;
    }
    const f = { n: prod % 256n, d: 256n };
    const a = ratOf(s[lo]);
    const b = ratOf(s[lo + 1]);
    out.push(ratToNumber(ratAdd(a, ratMul(f, ratSub(b, a)))));
  }
  // The specification's running maximum (a no-op for exact arithmetic, kept so the oracle is the whole rule).
  for (let j = 1; j < 257; j++) if (out[j] < out[j - 1]) out[j] = out[j - 1];
  return out;
}
// The rank coordinate of x by exact rational arithmetic and a LINEAR scan (C.3): {t, clip}.
function exactRank(knots, x) {
  const lo = knots[0];
  const hi = knots[256];
  if (x < lo) return { t: 0, clip: CLIP.LOW };
  if (x > hi) return { t: 1, clip: CLIP.HIGH };
  let first = -1;
  let last = -1;
  for (let j = 0; j < 257; j++) {
    if (knots[j] === x) {
      if (first < 0) first = j;
      last = j;
    }
  }
  if (first >= 0) return { t: (first + last) / 512, clip: CLIP.NONE }; // exact repeated value: midpoint of its first and last q
  let i = 1;
  while (knots[i] < x) i++; // knots[i-1] < x < knots[i]
  const a = ratOf(knots[i - 1]);
  const b = ratOf(knots[i]);
  const frac = ratDiv(ratSub(ratOf(x), a), ratSub(b, a));
  const t = ratDiv(ratAdd({ n: BigInt(i - 1), d: 1n }, frac), { n: 256n, d: 1n });
  return { t: ratToNumber(t), clip: CLIP.NONE };
}
const ulps = (a, b) => Math.abs(a - b) / Math.max(Number.EPSILON * Math.abs(b), 5e-324);

// ---- fixtures ---------------------------------------------------------------------------------------
const HAND = [1, 1, 1, 2, 3, 5, 5, 8, 13, 21];
// N = 257: 129 fives then 128 nines, so h = j and knots 0..128 are 5 and 129..256 are 9.
const TWO_GROUP = [...Array(129).fill(5), ...Array(128).fill(9)];

function cohorts() {
  const next = mulberry32(20260930);
  const list = [HAND, TWO_GROUP, [7], [7, 7, 7], [3, 9], [1, 2, 3]];
  for (const n of [4, 7, 100, 256, 257, 258, 1000, 4096]) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(Math.exp((next() - 0.5) * 12));
    list.push(a);
    // duplicate-heavy: a few distinct values repeated
    const b = [];
    const pool = [0.001, 1, 1, 2.5, 1e6, 3e9];
    for (let i = 0; i < n; i++) b.push(pool[Math.floor(next() * pool.length)]);
    list.push(b);
  }
  return list;
}

test("hand vector [1,1,1,2,3,5,5,8,13,21]: knots and the apply table of API.md A.3", () => {
  const f = fitRank(HAND);
  assert.equal(f.state, "ok");
  const d = f.descriptor;
  assert.equal(d.kind, "rank-type7-257");
  assert.equal(d.signed, false);
  assert.equal(d.params.q, "j/256");
  const k = knotsOf(f);
  assert.equal(k.length, 257);
  for (let j = 0; j <= 56; j++) assert.equal(k[j], 1, "knot " + j);
  assert.ok(k[57] > 1);
  assert.deepEqual(k.slice(254), [20.4375, 20.71875, 21]);
  assert.equal(k[0], 1);
  assert.equal(k[256], 21);
  const near = (x, want, clip = CLIP.NONE) => {
    const r = at(d, x);
    assert.ok(Math.abs(r.t - want) < 1e-15, "apply(" + x + ") = " + r.t + ", expected " + want);
    assert.equal(r.clip, clip, "clip of " + x);
  };
  near(0.5, 0, CLIP.LOW);
  near(1, 0.109375);
  near(1.5, 0.2777777777777778);
  near(2, 0.3333333333333333);
  near(4, 0.5);
  near(5, 0.611328125);
  near(6, 0.7037037037037037);
  near(21, 1);
  near(30, 1, CLIP.HIGH);
});

test("a measured zero maps to 0 without an indication (zeros are separately keyed; they must not count as out of range)", () => {
  for (const values of [HAND, [7, 7, 7], TWO_GROUP, [0, 0, 0, 2, 4, 8]]) {
    const d = fitRank(values).descriptor;
    assert.deepEqual(at(d, 0), { t: 0, clip: CLIP.NONE });
    assert.deepEqual(at(d, -0), { t: 0, clip: CLIP.NONE });
  }
  // Any other value below the support still carries the indication.
  assert.deepEqual(at(fitRank(HAND).descriptor, 0.5), { t: 0, clip: CLIP.LOW });
  assert.deepEqual(at(fitRank(HAND).descriptor, 1e-300), { t: 0, clip: CLIP.LOW });
});

test("n = 1 and an all-equal cohort: every knot equal, the value maps to 0.5, below and above map to 0 and 1 with an indication", () => {
  for (const values of [[7], [7, 7, 7], Array(1000).fill(7)]) {
    const f = fitRank(values);
    assert.ok(knotsOf(f).every((v) => v === 7));
    const d = f.descriptor;
    assert.deepEqual(at(d, 7), { t: 0.5, clip: CLIP.NONE });
    assert.deepEqual(at(d, 6), { t: 0, clip: CLIP.LOW });
    assert.deepEqual(at(d, 8), { t: 1, clip: CLIP.HIGH });
    assert.deepEqual(at(d, 6.999999999999999), { t: 0, clip: CLIP.LOW });
    assert.deepEqual(at(d, 7.000000000000001), { t: 1, clip: CLIP.HIGH });
  }
});

test("two-group cohort (knots 0..128 equal 5, 129..256 equal 9): 7 -> 0.501953125, 5 -> 0.25, 9 -> 0.751953125, outside support flagged", () => {
  const f = fitRank(TWO_GROUP);
  const k = knotsOf(f);
  for (let j = 0; j <= 128; j++) assert.equal(k[j], 5);
  for (let j = 129; j <= 256; j++) assert.equal(k[j], 9);
  const d = f.descriptor;
  assert.deepEqual(at(d, 7), { t: 0.5 + 0.5 / 256, clip: CLIP.NONE });
  assert.equal(0.5 + 0.5 / 256, 0.501953125);
  assert.deepEqual(at(d, 5), { t: 0.25, clip: CLIP.NONE }, "the midpoint of the first and last q of its group");
  assert.deepEqual(at(d, 9), { t: 0.751953125, clip: CLIP.NONE });
  assert.deepEqual(at(d, 4.999), { t: 0, clip: CLIP.LOW }, "below support: 0, flagged");
  assert.deepEqual(at(d, 9.001), { t: 1, clip: CLIP.HIGH }, "above support: 1, flagged");
  // Between the groups the coordinate runs from the lower group's LAST q (128) to the upper's FIRST (129).
  assert.ok(Math.abs(at(d, 6).t - (128 + 0.25) / 256) < 1e-15);
  assert.ok(Math.abs(at(d, 8).t - (128 + 0.75) / 256) < 1e-15);
});

test("three oracles agree on every knot: exact-rational Type-7 (within 2 ulp of one rounding), d3.quantileSorted and the module", () => {
  for (const values of cohorts()) {
    const sorted = Float64Array.from(values).sort();
    const got = knotsOf(fitRank(values));
    const exact = exactKnots(Array.from(sorted));
    assert.equal(got.length, 257);
    for (let j = 0; j < 257; j++) {
      const viaD3 = d3.quantileSorted(sorted, j / 256);
      assert.ok(ulps(got[j], exact[j]) <= 2, "N=" + values.length + " knot " + j + ": module " + got[j] + " exact " + exact[j]);
      assert.ok(ulps(got[j], viaD3) <= 1, "N=" + values.length + " knot " + j + ": module " + got[j] + " d3 " + viaD3);
    }
    for (let j = 1; j < 257; j++) assert.ok(got[j] >= got[j - 1], "non-decreasing");
    assert.equal(got[0], sorted[0]);
    assert.equal(got[256], sorted[sorted.length - 1]);
  }
});

test("apply agrees with the exact-rational, linear-scan oracle on probes at every knot value, between knots and outside the support", () => {
  const next = mulberry32(77);
  for (const values of cohorts()) {
    const f = fitRank(values);
    const d = f.descriptor;
    const k = knotsOf(f);
    const probes = [];
    for (let j = 0; j < 257; j += 1 + Math.floor(next() * 9)) {
      probes.push(k[j]);
      if (j > 0 && k[j] !== k[j - 1]) probes.push((k[j] + k[j - 1]) / 2, k[j - 1] + (k[j] - k[j - 1]) * next());
    }
    probes.push(k[0] / 2, k[256] * 2, k[0] * (1 - 1e-12), k[256] * (1 + 1e-12));
    for (const x of probes) {
      if (!(x > 0) || !Number.isFinite(x)) continue;
      const got = at(d, x);
      const want = exactRank(k, x);
      assert.equal(got.clip, want.clip, "clip at " + x);
      assert.ok(ulps(got.t, want.t) <= 8 || Math.abs(got.t - want.t) < 1e-15, "N=" + values.length + " x " + x + ": " + got.t + " vs " + want.t);
    }
  }
});

test("apply is monotone non-decreasing over a dense probe, inside [0,1], and only out-of-support values carry LOW or HIGH", () => {
  for (const values of cohorts()) {
    const d = fitRank(values).descriptor;
    const k = Array.from(d.params.knots);
    const lo = k[0];
    const hi = k[256];
    const span = hi > lo ? hi - lo : Math.abs(lo);
    let prev = -Infinity;
    for (let i = -20; i <= 1020; i++) {
      const x = lo + ((hi - lo) * i) / 1000 + (hi > lo ? 0 : (span * i) / 1000);
      if (!(x > 0)) continue;
      const r = at(d, x);
      assert.ok(r.t >= 0 && r.t <= 1 && !Number.isNaN(r.t), "t in [0,1] at " + x + ": " + r.t);
      assert.ok(r.t >= prev, "monotone at " + x + " (N=" + values.length + "): " + r.t + " < " + prev);
      prev = r.t;
      if (x < lo) assert.equal(r.clip, CLIP.LOW);
      else if (x > hi) assert.equal(r.clip, CLIP.HIGH);
      else assert.equal(r.clip, CLIP.NONE, "an in-support value is never counted as out of range");
    }
  }
});

test("jump cohort (99 tiny values and one huge) and a long plateau: knots survive, the coordinates stay ordered", () => {
  const jump = [...Array.from({ length: 99 }, (_, i) => 1e-9 * (i + 1)), 1e12];
  const f = fitRank(jump);
  const k = knotsOf(f);
  assert.equal(k[0], 1e-9);
  assert.equal(k[256], 1e12);
  assert.ok(k[250] < 1e-6, "h = 99*250/256 = 96.7: still between two tiny values");
  assert.ok(k[255] > 1e11, "h = 98.6: the interpolation reaches into the outlier, so the last knots jump");
  const d = f.descriptor;
  assert.ok(at(d, 5e-8).t < 0.6);
  assert.ok(at(d, 1e-7).t < at(d, 1e11).t);
  assert.equal(at(d, 1e12).t, 1, "the huge value is the exact top knot");
  const plateau = [...Array(5000).fill(3), 1, 2, 4, 5, 6];
  const p = fitRank(plateau);
  const pk = knotsOf(p);
  assert.ok(pk.filter((v) => v === 3).length > 250, "a long run of one value is a long run of equal knots");
  const first = pk.indexOf(3);
  const last = pk.lastIndexOf(3);
  assert.ok(Math.abs(at(p.descriptor, 3).t - (first + last) / 512) < 1e-15, "midpoint of its group's first and last q");
});

test("restoration is exact: knots serialised as float64 base64url or as JSON come back bit-identical, with the same id and the same coordinates on a 1,000-point probe", () => {
  const next = mulberry32(5);
  for (const values of [HAND, TWO_GROUP, cohorts()[12], cohorts()[13], [7, 7, 7]]) {
    const f = fitRank(values);
    const d = f.descriptor;
    const knots = Array.from(d.params.knots);
    // 257 doubles -> 2056 bytes -> 2742 base64url characters (S1-079), decoded by node's own codec.
    const text = E.hash.f64ToB64(knots);
    assert.equal(text.length, 2742);
    const bytes = Buffer.from(text, "base64url");
    assert.equal(bytes.length, 2056);
    const viaBuffer = Array.from({ length: 257 }, (_, i) => bytes.readDoubleBE(i * 8));
    for (let j = 0; j < 257; j++) assert.ok(Object.is(viaBuffer[j], knots[j]), "bit-exact knot " + j);
    const decoded = Array.from(E.hash.b64ToF64(text, 257));
    const fromJson = JSON.parse(JSON.stringify(d)).params.knots;
    for (const restored of [decoded, fromJson]) {
      const back = { v: 1, id: d.id, kind: "rank-type7-257", signed: false, params: { knots: restored, q: "j/256" }, clip: "clamp01@1", algorithm: "type7-257@1" };
      assert.deepEqual(plain(E.scale.validate(back, { requireId: true })), { ok: true });
      assert.equal(E.scale.id(back), d.id, "the same mapping id after a round trip");
      const lo = knots[0];
      const hi = knots[256];
      for (let i = 0; i < 1000; i++) {
        const x = lo * 0.9 + (hi * 1.1 - lo * 0.9) * next();
        const a = at(d, x);
        const b = at(back, x);
        assert.ok(Object.is(a.t, b.t) && a.clip === b.clip, "bit-identical coordinate at " + x);
      }
    }
  }
});

test("the record says what it is: kind, signedness, q, algorithm and clip policy, an approximation and not an exact midrank", () => {
  const d = fitRank(HAND).descriptor;
  assert.deepEqual(Object.keys(d.params).sort(), ["knots", "q"]);
  assert.equal(d.algorithm, "type7-257@1");
  assert.equal(d.clip, "clamp01@1");
  assert.equal(d.signed, false);
  assert.equal(d.id, E.scale.id(d));
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.params) && Object.isFrozen(d.params.knots));
  assert.equal(E.scale.plan(d).kind, "rank-type7-257");
  assert.equal(E.scale.canonical(d).includes('"q":"j/256"'), true, "q is hashed: the algorithm identity");
});

test("the id of knots 1..257 is the published vector of API.md A.2", () => {
  const knots = Array.from({ length: 257 }, (_, i) => i + 1);
  assert.equal(E.scale.id({ v: 1, kind: "rank-type7-257", signed: false, params: { knots, q: "j/256" }, clip: "clamp01@1" }), "YOsRNro-FFbbskXX");
});

test("fitRank uses finite POSITIVE values only: zeros, negatives and non-finite values are not members; nothing finite and non-negative is No calibration", () => {
  const f = E.scale.fitRank({ values: Float64Array.from([0, 0, -4, NaN, Infinity, 2, 4, 6, 8, 0]) });
  assert.deepEqual(knotsOf(f)[0], 2);
  assert.deepEqual(knotsOf(f)[256], 8);
  assert.equal(f.descriptor.id, fitRank([2, 4, 6, 8]).descriptor.id, "the zeros do not compress the low end");
  for (const values of [[], [-1, NaN, -Infinity], [-3, -0.5]]) {
    const r = fitRank(values);
    assert.equal(r.state, "no-calibration");
    assert.equal(r.descriptor, null);
    assert.equal(r.reason, "empty cohort");
  }
  // A bare array works as a cohort too (every Array has a values METHOD: the module must not take it).
  assert.equal(E.scale.fitRank([1, 2, 3]).state, "ok");
});

test("validate rejects 256 and 258 knots, NaN and Infinity, non-monotone knots, a q other than j/256, typed arrays and a wrong id", () => {
  const good = plain(fitRank(HAND).descriptor);
  const check = (mutate, reason, where, opts) => {
    const d = plain(good);
    mutate(d);
    const r = plain(E.scale.validate(d, opts));
    assert.equal(r.ok, false, reason);
    assert.match(r.reason, reason);
    if (where) assert.equal(r.path, where);
  };
  assert.deepEqual(plain(E.scale.validate(good, { requireId: true })), { ok: true });
  check((d) => d.params.knots.pop(), /exactly 257/, "params.knots");
  check((d) => d.params.knots.push(30), /exactly 257/, "params.knots");
  check((d) => (d.params.knots = []), /exactly 257/, "params.knots");
  check((d) => (d.params.knots[100] = null), /finite/, "params.knots[100]");
  check((d) => (d.params.knots[100] = "5"), /finite/, "params.knots[100]");
  check((d) => (d.params.knots[3] = 2), /must not decrease/, "params.knots[4]"); // knots[4] is 1 and now falls below its left neighbour
  check((d) => (d.params.knots[256] = 0.5), /must not decrease/, "params.knots[256]");
  check((d) => (d.params.q = "j/255"), /q must be/, "params.q");
  check((d) => delete d.params.q, /missing/, "params.q");
  check((d) => (d.params.extra = 1), /unknown parameter/, "params.extra");
  check((d) => (d.signed = true), /unsigned/, "signed");
  check((d) => (d.id = "AAAAAAAAAAAAAAAA"), /id does not match/, "id");
  check((d) => (d.params.knots[0] = 0.5), /id does not match/, "id"); // a changed but still monotone knot, no re-hash
  // NaN and Infinity cannot survive JSON, so they are put in by hand.
  for (const bad of [NaN, Infinity, -Infinity]) {
    const d = { ...good, params: { ...good.params, knots: good.params.knots.slice() } };
    d.params.knots[7] = bad;
    const r = plain(E.scale.validate(d));
    assert.equal(r.ok, false);
    assert.equal(r.path, "params.knots[7]");
  }
  const typed = { ...good, params: { ...good.params, knots: Float64Array.from(good.params.knots) } };
  assert.equal(plain(E.scale.validate(typed)).reason, "knots must be an array", "descriptors are JSON: plain arrays");
});

test("plan refuses a rank descriptor without 257 knots instead of evaluating garbage", () => {
  assert.throws(() => E.scale.plan({ v: 1, kind: "rank-type7-257", signed: false, params: { knots: [1, 2], q: "j/256" }, clip: "clamp01@1" }), (e) => /Error$/.test(e.name));
});

test("goldens vs tests/fixtures/scales/rank-vectors.json (Python decimal, package H3): the third oracle", { todo: "package H3 has not committed tests/fixtures/scales/rank-vectors.json" }, () => {});

// DR-40 / D3 ("All-zero valid cohort produces a zero-only calibration"): a rank cohort holds positive values
// only, so an ALL-ZERO cohort is not "empty positives" but a measured zero-only one, exactly as fitValue has it.
test("an ALL-ZERO cohort gives the zero-only calibration exactly as fitValue does (DR-40); an empty one stays No calibration", () => {
  for (const values of [[0], [0, 0, 0], [-0, 0], [0, 0, -4, NaN, Infinity], [-0]]) {
    const r = fitRank(values);
    assert.equal(r.state, "ok", JSON.stringify(values));
    assert.equal(r.descriptor.kind, "zero-only");
    assert.equal(r.descriptor.signed, false, "rank is unsigned");
    assert.equal(r.descriptor.params, null);
    assert.equal(r.descriptor.algorithm, "value-fit@1", "the same record fitValue makes, algorithm string included");
    assert.equal(r.descriptor.id, "C5LleVNGDTk1DpfK", "the hand-pinned id of the unsigned zero-only mapping (scale-value.test.js)");
    assert.deepEqual(plain(r), plain(E.scale.fitValue({ values: Float64Array.from(values) }, { signed: false })), "record for record the Value answer");
    assert.equal(E.scale.validate(r.descriptor, { requireId: true }).ok, true);
  }
  // Its apply is the zero-only one (DD-95): a measured zero is t = 0 with no indication, anything else is
  // out of domain, clipped HIGH and flagged until a fit replaces it.
  const d = fitRank([0, 0]).descriptor;
  assert.deepEqual(at(d, 0), { t: 0, clip: CLIP.NONE });
  const out = {};
  E.scale.apply(d, 3, out);
  assert.equal(out.t, 1);
  assert.equal(out.clip, CLIP.HIGH);
  assert.equal(out.state, "out-of-domain");
  // One positive value anywhere makes it a real rank fit again: the zeros are still not members.
  const mixed = fitRank([0, 0, 5]);
  assert.equal(mixed.descriptor.kind, "rank-type7-257");
  assert.equal(mixed.descriptor.id, fitRank([5]).descriptor.id);
  // Nothing measured, or nothing but values that are not members, is not a zero cohort.
  for (const values of [[], [NaN], [-1, -2], [Infinity, -Infinity]]) assert.equal(fitRank(values).state, "no-calibration", JSON.stringify(values));
  assert.equal(E.scale.fitRank({ values: [] }).reason, "empty cohort");
  assert.equal(E.scale.fitRank(null).state, "no-calibration");
});

