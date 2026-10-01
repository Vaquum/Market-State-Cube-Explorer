"use strict";
// U29 (T-indicators): E.indicators of src/encoding.js, loaded through tests/support/enc.js. The nine
// functions are a MOVE of the baseline's smaOf .. divergencesOf (8c82ca1:src/explorer.js 6189-6337), so
// the claim under test is "behaviour unchanged, and correct by the textbook definitions".
//
// Oracles (none is the code under test):
//   1. tests/fixtures/indicators-baseline/baseline-8c82ca1.json: inputs, outputs and function texts
//      recorded from the UNMODIFIED baseline by tests/reference/record_baseline.mjs. Outputs must be
//      equal to the bit (Object.is: NaN equals NaN, -0 differs from 0), and each moved function's own
//      text, with the part-23 names reversed to the baseline's, must equal the baseline text.
//   2. An exact-rational calculator written in this file (BigInt fractions), implementing the textbook
//      definitions of SMA, EMA (alpha = 2/(n+1), seeded with the SMA), Wilder RSI, Bollinger (population
//      standard deviation) and MACD (EMA12 - EMA26, signal EMA9, histogram); the module must agree
//      within 1e-12 relative on integer-quarter closes, where every double input is exact.
//   3. Hand vectors worked out on paper, named at each test, including the classic 15-close RSI(14)
//      worksheet (its first value is published as 70.53; recomputed here exactly, and the expectation
//      is the exact value, not the quoted rounding; the closes are quoted from memory and the match to
//      the published value is what backs them, as TESTPLAN.md section 8 flags).
// The seeded random walk that feeds oracle 2 is mulberry32 (tests/support/rng.js); its values are
// inputs, never expectations.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const { mulberry32 } = require("../support/rng");

const NAMES = ["smaOf", "emaOf", "rsiOf", "bollingerOf", "macdOf", "crossesOf", "squeezeBelow", "squeezeLowest", "divergencesOf"];
const I = E.indicators;
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/indicators-baseline/baseline-8c82ca1.json"), "utf8"));

// The module may live in another realm (ENCODING_PARTS_DIR evaluates it in a vm context), so class
// identity is compared by name and structures by walking them.
const plain = (x) => JSON.parse(JSON.stringify(x));
const kind = (x) => Object.prototype.toString.call(x).slice(8, -1);

// decode: the fixture's encoding of numbers JSON cannot carry (see record_baseline.mjs).
function decode(x) {
  if (x === "NaN") return NaN;
  if (x === "Infinity") return Infinity;
  if (x === "-Infinity") return -Infinity;
  if (x === "-0") return -0;
  if (Array.isArray(x)) return x.map(decode);
  if (x !== null && typeof x === "object") {
    if (x.$type === "Float64Array") return Float64Array.from(x.v.map(decode));
    if (x.$type === "Uint8Array") return Uint8Array.from(x.v);
    const out = {};
    for (const k of Object.keys(x)) out[k] = decode(x[k]);
    return out;
  }
  return x;
}

// same: deep equality where numbers are compared with Object.is and a typed array only equals one of the
// same class. Returns "" when equal, else the path of the first difference.
function same(a, b, at = "$") {
  const ka = kind(a);
  if (ka !== kind(b)) return `${at}: ${ka} vs ${kind(b)}`;
  if (ka === "Number") return Object.is(a, b) ? "" : `${at}: ${a} vs ${b}`;
  if (ka === "Float64Array" || ka === "Uint8Array" || ka === "Array") {
    if (a.length !== b.length) return `${at}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = same(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return "";
  }
  if (ka === "Object") {
    const keys = Object.keys(a);
    if (keys.join() !== Object.keys(b).join()) return `${at}: keys ${keys} vs ${Object.keys(b)}`;
    for (const k of keys) {
      const d = same(a[k], b[k], `${at}.${k}`);
      if (d) return d;
    }
    return "";
  }
  return a === b ? "" : `${at}: ${a} vs ${b}`;
}

// ---- API shape -------------------------------------------------------------------------------------------

test("E.indicators is frozen and holds exactly the nine functions of API.md A.3", () => {
  assert.ok(Object.isFrozen(I));
  assert.deepEqual(Object.keys(I).sort(), NAMES.slice().sort());
  for (const name of NAMES) assert.equal(typeof I[name], "function", name);
});

// ---- oracle 1: the recorded baseline ---------------------------------------------------------------------

test("the fixture names the baseline it was recorded from and covers every function", () => {
  assert.equal(FIXTURE.baseline, "8c82ca1");
  assert.deepEqual(FIXTURE.lines, [6189, 6337]);
  const covered = new Set(FIXTURE.cases.map((c) => c.fn));
  for (const name of NAMES) assert.ok(covered.has(name), `${name} has recorded cases`);
  assert.ok(FIXTURE.cases.length >= 40);
});

test("every recorded case: output equal to the baseline's to the bit (values, classes, NaN positions, -0)", () => {
  const failures = [];
  for (const c of FIXTURE.cases) {
    const args = c.args.map(decode);
    const got = I[c.fn](...args);
    const diff = same(got, decode(c.expect));
    if (diff) failures.push(`${c.fn} (${c.note}): ${diff}`);
  }
  assert.deepEqual(failures, []);
});

test("the inputs of a recorded case are not modified by the call", () => {
  for (const c of FIXTURE.cases) {
    const args = c.args.map(decode);
    const before = JSON.stringify(c.args.map(decode));
    I[c.fn](...args);
    assert.equal(JSON.stringify(args), before, `${c.fn} (${c.note})`);
  }
});

// The moved functions ARE the baseline's: same text once the prefix names are reversed. This is what
// "byte-for-byte move, behaviour unchanged" (API.md A.3, DR-28) means for code that has to be renamed.
const REVERSE = [
  ["indSmaOf", "smaOf"], ["indEmaOf", "emaOf"], ["indRsiOf", "rsiOf"], ["indBollingerOf", "bollingerOf"], ["indMacdOf", "macdOf"],
  ["indCrossesOf", "crossesOf"], ["indSqueezeBelow", "squeezeBelow"], ["indSqueezeLowest", "squeezeLowest"], ["indDivergencesOf", "divergencesOf"],
  ["indSqueezeBars", "SQUEEZE_BARS"], ["indSqueezeRank", "SQUEEZE_RANK"], ["indSqueezeDays", "SQUEEZE_DAYS"],
];
test("each moved function's text equals the recorded baseline text after reversing the part-23 names", () => {
  for (const name of NAMES) {
    let text = I[name].toString();
    for (const [from, to] of REVERSE) text = text.split(from).join(to);
    assert.equal(text, FIXTURE.sources[name].trimStart(), name);
  }
});

test("the squeeze defaults are the baseline's 500 bars, 0.1 rank and 182 days (default equals explicit)", () => {
  const rec = (note) => decode(FIXTURE.cases.find((c) => c.note === note).args[0]);
  const w600 = rec("seeded widths, 600 bars, defaults (500, 0.1)");
  assert.equal(same(I.squeezeBelow(w600), I.squeezeBelow(w600, 500, 0.1)), "");
  assert.notEqual(same(I.squeezeBelow(w600), I.squeezeBelow(w600, 499, 0.1)), "", "500 is not 499");
  assert.notEqual(same(I.squeezeBelow(w600), I.squeezeBelow(w600, 500, 0.2)), "", "0.1 is not 0.2");
  // 182 days, pinned at both edges of the window with hand series of 200 widths of 1: a lower width on
  // day 17 lies outside the 182-day window ending on day 199 (days 18..199) and inside a 183-day one; a
  // lower width on day 18 lies inside the 182-day window and outside a 181-day one.
  const flat = () => new Array(200).fill(1);
  const outside = flat();
  outside[17] = 0.5;
  assert.equal(I.squeezeLowest(outside)[199], 1);
  assert.equal(I.squeezeLowest(outside, 183)[199], 0);
  const inside = flat();
  inside[18] = 0.5;
  assert.equal(I.squeezeLowest(inside)[199], 0);
  assert.equal(I.squeezeLowest(inside, 181)[199], 1);
});

// ---- oracle 3: hand vectors -------------------------------------------------------------------------------

test("smaOf: mean of the last n closes, NaN before the first full window", () => {
  assert.equal(same(I.smaOf([1, 2, 3, 4, 5], 3), Float64Array.of(NaN, NaN, 2, 3, 4)), "");
  assert.equal(same(I.smaOf([1, 2, 3], 1), Float64Array.of(1, 2, 3)), "");
  assert.equal(same(I.smaOf([1, 2], 3), Float64Array.of(NaN, NaN)), "");
  assert.equal(I.smaOf([], 3).length, 0);
});

test("emaOf: alpha = 2/(n+1), seeded with the SMA of the first n closes, at index n-1 (+from)", () => {
  // n = 3, alpha = 1/2: seed (1+2+3)/3 = 2; then 0.5*4 + 0.5*2 = 3; then 0.5*5 + 0.5*3 = 4.
  assert.equal(same(I.emaOf([1, 2, 3, 4, 5], 3), Float64Array.of(NaN, NaN, 2, 3, 4)), "");
  // n = 4, alpha = 0.4: seed 2.5 = (1+2+3+4)/4; then 0.4*10 + 0.6*2.5 = 5.5.
  assert.equal(same(I.emaOf([1, 2, 3, 4, 10], 4), Float64Array.of(NaN, NaN, NaN, 2.5, 5.5)), "");
  // `from` moves the seed window (the MACD signal uses it to skip the warm-up NaNs).
  assert.equal(same(I.emaOf([NaN, NaN, 1, 2, 3, 4, 5], 3, 2), Float64Array.of(NaN, NaN, NaN, NaN, 2, 3, 4)), "");
  assert.equal(same(I.emaOf([1, 2], 3), Float64Array.of(NaN, NaN)), "");
});

test("rsiOf: Wilder smoothing; first value at index n; 100 when nothing fell (a flat series too), 0 when nothing rose", () => {
  const up = Array.from({ length: 20 }, (_, i) => 10 + i);
  const down = Array.from({ length: 20 }, (_, i) => 100 - i);
  const flat = new Array(20).fill(7);
  for (const [series, expected] of [[up, 100], [down, 0], [flat, 100]]) {
    const r = I.rsiOf(series);
    for (let i = 0; i < 14; i++) assert.ok(Number.isNaN(r[i]), `warm-up index ${i}`);
    for (let i = 14; i < 20; i++) assert.equal(r[i], expected);
  }
  // Fewer than n + 1 closes: nothing to report.
  assert.ok(Array.from(I.rsiOf(up.slice(0, 14))).every(Number.isNaN));
  assert.equal(I.rsiOf(up.slice(0, 15)).length, 15);
  // n = 2, closes 1 2 1 3: changes +1 -1 +2. Seed averages up 1/2, down 1/2 -> RSI 50; then
  // up = (0.5*1 + 2)/2 = 1.25, down = (0.5*1 + 0)/2 = 0.25 -> 100 - 100/(1 + 5) = 83.333...
  const r = I.rsiOf([1, 2, 1, 3], 2);
  assert.ok(Number.isNaN(r[0]) && Number.isNaN(r[1]));
  assert.equal(r[2], 50);
  assert.ok(Math.abs(r[3] - 250 / 3) < 1e-12);
});

// ---- oracle 2: exact rationals ---------------------------------------------------------------------------

const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
function Q(n, d = 1n) {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
const add = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => Q(a.n * b.n, a.d * b.d);
const div = (a, b) => Q(a.n * b.d, a.d * b.n);
const isZero = (a) => a.n === 0n;
// A rational as a double, to about 2e-16 relative (the tolerance below is 1e-12).
const num = (a) => Number((a.n * 10n ** 40n) / a.d) / 1e40;
const qi = (x) => Q(BigInt(x));

// Closes in quarter units (integers), so the double the module receives is exactly the rational. The walk
// starts at 100.00 and moves by up to 5 a bar: prices of a few hundred keep the rounding error of the
// EMA difference (MACD) well below the 1e-12 the checks allow.
function walk(seed, length) {
  const next = mulberry32(seed);
  const q = [];
  let v = 400;
  for (let i = 0; i < length; i++) {
    v += Math.floor(next() * 41) - 20;
    q.push(v);
  }
  return q;
}
const QUARTERS = walk(46, 90);
const CLOSES = QUARTERS.map((v) => v / 4);
const RAT = QUARTERS.map((v) => Q(BigInt(v), 4n));

const oracle = {
  sma(x, n) {
    return x.map((_, i) => {
      if (i < n - 1) return NaN;
      let s = qi(0);
      for (let k = i - n + 1; k <= i; k++) s = add(s, x[k]);
      return num(div(s, qi(n)));
    });
  },
  // Rational EMA over x[from..]: the seed is the mean of the first n values from `from`.
  emaQ(x, n, from = 0) {
    const out = new Array(x.length).fill(null);
    if (x.length - from < n) return out;
    const a = Q(2n, BigInt(n + 1));
    const b = sub(qi(1), a);
    let s = qi(0);
    for (let k = from; k < from + n; k++) s = add(s, x[k]);
    let e = div(s, qi(n));
    out[from + n - 1] = e;
    for (let i = from + n; i < x.length; i++) out[i] = e = add(mul(a, x[i]), mul(b, e));
    return out;
  },
  rsi(x, n = 14) {
    const out = new Array(x.length).fill(NaN);
    if (x.length <= n) return out;
    let up = qi(0);
    let down = qi(0);
    const step = (i) => {
      const d = sub(x[i], x[i - 1]);
      return d.n > 0n ? [d, qi(0)] : [qi(0), sub(qi(0), d)];
    };
    for (let i = 1; i <= n; i++) {
      const [u, d] = step(i);
      up = add(up, u);
      down = add(down, d);
    }
    up = div(up, qi(n));
    down = div(down, qi(n));
    const nq = qi(n);
    const m = qi(n - 1);
    const value = () => (isZero(down) ? 100 : isZero(up) ? 0 : num(sub(qi(100), div(qi(100), add(qi(1), div(up, down))))));
    out[n] = value();
    for (let i = n + 1; i < x.length; i++) {
      const [u, d] = step(i);
      up = div(add(mul(m, up), u), nq);
      down = div(add(mul(m, down), d), nq);
      out[i] = value();
    }
    return out;
  },
  bollinger(x, n, k) {
    const mid = new Array(x.length).fill(NaN);
    const upper = mid.slice();
    const lower = mid.slice();
    const width = mid.slice();
    for (let i = n - 1; i < x.length; i++) {
      let s = qi(0);
      for (let j = i - n + 1; j <= i; j++) s = add(s, x[j]);
      const m = div(s, qi(n));
      let q = qi(0);
      for (let j = i - n + 1; j <= i; j++) q = add(q, mul(sub(x[j], m), sub(x[j], m)));
      const sd = Math.sqrt(num(div(q, qi(n))));
      mid[i] = num(m);
      upper[i] = mid[i] + k * sd;
      lower[i] = mid[i] - k * sd;
      width[i] = (upper[i] - lower[i]) / mid[i];
    }
    return { mid, upper, lower, width };
  },
  macd(x) {
    const fast = oracle.emaQ(x, 12);
    const slow = oracle.emaQ(x, 26);
    const macdQ = x.map((_, i) => (i >= 25 ? sub(fast[i], slow[i]) : null));
    // The signal is the EMA(9) of the MACD line, seeded at its first nine values (indices 25..33).
    const padded = macdQ.map((v) => v || qi(0));
    const signalQ = oracle.emaQ(padded, 9, 25);
    const toNum = (v) => (v === null ? NaN : num(v));
    return {
      macd: macdQ.map(toNum),
      signal: signalQ.map(toNum),
      hist: macdQ.map((v, i) => (v === null || signalQ[i] === null ? NaN : num(sub(v, signalQ[i])))),
    };
  },
};

const close = (got, want, what) => {
  assert.equal(got.length, want.length, `${what}: length`);
  for (let i = 0; i < want.length; i++) {
    if (Number.isNaN(want[i])) assert.ok(Number.isNaN(got[i]), `${what}[${i}] should be NaN, got ${got[i]}`);
    else assert.ok(Math.abs(got[i] - want[i]) <= 1e-12 * Math.max(1, Math.abs(want[i])), `${what}[${i}]: ${got[i]} vs ${want[i]}`);
  }
};

test("smaOf equals the exact-rational mean within 1e-12 (n = 1, 5, 20, 90)", () => {
  for (const n of [1, 5, 20, 90]) close(I.smaOf(CLOSES, n), oracle.sma(RAT, n), `sma(${n})`);
});

test("emaOf equals the exact-rational EMA within 1e-12 (n = 3, 12, 26; from = 4)", () => {
  const toNumbers = (arr) => arr.map((v) => (v === null ? NaN : num(v)));
  for (const n of [3, 12, 26]) close(I.emaOf(CLOSES, n), toNumbers(oracle.emaQ(RAT, n)), `ema(${n})`);
  close(I.emaOf(CLOSES, 5, 4), toNumbers(oracle.emaQ(RAT, 5, 4)), "ema(5, from 4)");
});

test("rsiOf equals the exact-rational Wilder RSI within 1e-12 (n = 14 and 5)", () => {
  close(I.rsiOf(CLOSES), oracle.rsi(RAT), "rsi(14)");
  close(I.rsiOf(CLOSES, 5), oracle.rsi(RAT, 5), "rsi(5)");
});

test("rsiOf on the classic 15-close worksheet: first RSI(14) equals the exact value, which prints as the published 70.53", () => {
  // The series is quoted from memory (four decimals); that its exact RSI(14) prints as the published
  // 70.53, and that the 2-decimal rounding of the same closes does not (70.46), is what supports the quote.
  const closes = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0828, 45.8931, 46.0328, 45.614, 46.282, 46.282];
  // Ten-thousandths as integers, so the rational is exact; the double the module gets is the nearest
  // double of the same decimal (within 1e-16 relative), hence a tolerance and not equality.
  const exact = oracle.rsi(closes.map((c) => Q(BigInt(Math.round(c * 10000)), 10000n)));
  const r = I.rsiOf(closes);
  assert.ok(Math.abs(r[14] - exact[14]) < 1e-9, `${r[14]} vs ${exact[14]}`);
  assert.equal(exact[14].toFixed(2), "70.53");
});

test("bollingerOf equals the exact-rational SMA +/- k population deviations within 1e-12; width = (upper - lower) / mid", () => {
  for (const [n, k] of [[20, 2], [5, 1.5], [10, 3]]) {
    const want = oracle.bollinger(RAT, n, k);
    const got = n === 20 && k === 2 ? I.bollingerOf(CLOSES) : I.bollingerOf(CLOSES, n, k);
    for (const key of ["mid", "upper", "lower", "width"]) close(got[key], want[key], `bollinger(${n},${k}).${key}`);
  }
  // Hand vector: closes 1 3 (n = 2): mean 2, population deviation 1, bands 0 and 4, width 4/2 = 2.
  const b = I.bollingerOf([1, 3], 2, 2);
  assert.equal(b.mid[1], 2);
  assert.equal(b.lower[1], 0);
  assert.equal(b.upper[1], 4);
  assert.equal(b.width[1], 2);
  assert.ok(Number.isNaN(b.mid[0]));
});

test("macdOf equals the exact-rational EMA12 - EMA26, EMA9 signal and histogram within 1e-12; warm-ups at 25, 33", () => {
  const want = oracle.macd(RAT);
  const got = I.macdOf(CLOSES);
  for (const key of ["macd", "signal", "hist"]) close(got[key], want[key], `macd.${key}`);
  assert.ok(Number.isNaN(got.macd[24]) && Number.isFinite(got.macd[25]), "the MACD line starts at index 25");
  assert.ok(Number.isNaN(got.signal[32]) && Number.isFinite(got.signal[33]), "the signal starts nine values later");
  assert.ok(Number.isNaN(got.hist[32]) && Number.isFinite(got.hist[33]));
  // A constant series has a zero MACD line, signal and histogram.
  const flat = I.macdOf(new Array(50).fill(3));
  assert.equal(flat.macd[49], 0);
  assert.equal(flat.signal[49], 0);
  assert.equal(flat.hist[49], 0);
});

test("crossesOf: where the difference changes sign between bars where both have a value; a touch that turns back is none", () => {
  assert.deepEqual(plain(I.crossesOf([1, 2, 3, 2, 1, 2, 3], [2, 2, 2, 2, 2, 2, 2])), [{ i: 2, up: true }, { i: 4, up: false }, { i: 6, up: true }]);
  assert.deepEqual(plain(I.crossesOf([1, 2, 1], [2, 2, 2])), []);
  assert.deepEqual(plain(I.crossesOf([1, NaN, 3], [2, 2, 2])), [{ i: 2, up: true }]);
});

test("squeezeBelow: below the 0.1 percentile of the trailing window, linear between order statistics; needs a full window", () => {
  // Window 5, p = 0.2: position 0.2 * 4 = 0.8, so the threshold sits 0.8 of the way from the lowest to
  // the second lowest width of the window.
  // Widths 5 4 3 2 1: at bar 4 the window sorts to 1 2 3 4 5 -> threshold 1 + 0.8 = 1.8; 1 < 1.8 -> flag.
  // At bar 5 (value 2) the window 4 3 2 1 2 sorts to 1 2 2 3 4 -> threshold 1.8; 2 is not below it.
  assert.equal(same(I.squeezeBelow([5, 4, 3, 2, 1, 2], 5, 0.2), Uint8Array.of(0, 0, 0, 0, 1, 0)), "");
  // Fewer bars than the window: never flagged; non-finite bars are skipped and do not count.
  assert.equal(same(I.squeezeBelow([1, 2, 3], 5, 0.2), Uint8Array.of(0, 0, 0)), "");
  assert.equal(same(I.squeezeBelow([NaN, 5, 4, 3, 2, 1], 5, 0.2), Uint8Array.of(0, 0, 0, 0, 0, 1)), "");
});

test("squeezeLowest: flagged when the width is at or below every width of the trailing window (ties count)", () => {
  assert.equal(same(I.squeezeLowest([3, 2, 4, 1, 5, 0.5, 2, 2], 5), Uint8Array.of(0, 0, 0, 0, 0, 1, 0, 0)), "");
  // A tie with the window's lowest counts: 2 2 2 all <= the window's low.
  assert.equal(same(I.squeezeLowest([2, 2, 2], 3), Uint8Array.of(0, 0, 1)), "");
  // A window that begins on a NaN is not evaluated.
  assert.equal(same(I.squeezeLowest([NaN, 2, 3, 1], 4), Uint8Array.of(0, 0, 0, 0)), "");
});

test("divergencesOf: bearish = higher high with a lower RSI, bullish = lower low with a higher RSI, per swing kind", () => {
  const swings = [
    { kind: "high", i: 2, price: 100 },
    { kind: "low", i: 4, price: 90 },
    { kind: "high", i: 6, price: 105 },
    { kind: "low", i: 8, price: 85 },
  ];
  const rsi = [0, 0, 70, 0, 30, 0, 65, 0, 35];
  const got = plain(I.divergencesOf(swings, rsi));
  assert.deepEqual(got.map((d) => [d.bearish, d.a.i, d.b.i, d.r0, d.r1]), [[true, 2, 6, 70, 65], [false, 4, 8, 30, 35]]);
  // Price and RSI agreeing is not a divergence.
  assert.deepEqual(plain(I.divergencesOf([{ kind: "high", i: 1, price: 10 }, { kind: "high", i: 3, price: 12 }], [0, 50, 0, 60])), []);
  // A swing on a bar without an RSI is skipped.
  assert.deepEqual(plain(I.divergencesOf([{ kind: "high", i: 1, price: 10 }, { kind: "high", i: 3, price: 12 }], [0, 50, 0, NaN])), []);
});

test("the functions return fresh arrays of the documented classes and never touch their input", () => {
  const input = CLOSES.slice();
  const copy = input.slice();
  assert.equal(kind(I.smaOf(input, 5)), "Float64Array");
  assert.equal(kind(I.emaOf(input, 5)), "Float64Array");
  assert.equal(kind(I.rsiOf(input)), "Float64Array");
  assert.equal(kind(I.bollingerOf(input).width), "Float64Array");
  assert.equal(kind(I.macdOf(input).hist), "Float64Array");
  assert.equal(kind(I.squeezeBelow(I.bollingerOf(input).width, 5, 0.2)), "Uint8Array");
  assert.equal(kind(I.squeezeLowest(I.bollingerOf(input).width, 5)), "Uint8Array");
  assert.deepEqual(input, copy);
  assert.notEqual(I.smaOf(input, 5), I.smaOf(input, 5));
});
