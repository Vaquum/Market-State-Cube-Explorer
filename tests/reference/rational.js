"use strict";
// tests/reference/rational.js (H3): exact rational arithmetic on BigInt, the floor of the independent reference calculator.
//
// A rational is a plain object {n, d} with BigInt n and d > 0n, always in lowest terms, so two equal rationals are
// deep-equal. Nothing here imports src/, tests/support/ or vendor/ (tests/unit/independence.test.js enforces it); the
// only dependency is the language. The one place a double enters or leaves is explicit: fromDouble (exact, every finite
// double is a dyadic rational) and toDouble / ratioToDouble (ONE correct rounding, round half to even), so a sum that
// the code under test computes in floating point can be compared with the value its real-number definition has.

const ZERO = { n: 0n, d: 1n };
const ONE = { n: 1n, d: 1n };

const abs = (a) => (a < 0n ? -a : a);

function gcd(a, b) {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

// q(n, d = 1n): the rational n / d in lowest terms. Accepts BigInt or integer-valued numbers.
function q(n, d = 1n) {
  n = BigInt(n);
  d = BigInt(d);
  if (d === 0n) throw new RangeError("rational with a zero denominator");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}

const add = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => q(a.n * b.n, a.d * b.d);
const div = (a, b) => {
  if (b.n === 0n) throw new RangeError("division by the rational zero");
  return q(a.n * b.d, a.d * b.n);
};
const neg = (a) => ({ n: -a.n, d: a.d });
const cmp = (a, b) => {
  const x = a.n * b.d;
  const y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
};
const eq = (a, b) => a.n === b.n && a.d === b.d;
const min = (a, b) => (cmp(a, b) <= 0 ? a : b);
const max = (a, b) => (cmp(a, b) >= 0 ? a : b);
const isInt = (a) => a.d === 1n;
const sign = (a) => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);

// floor(a) as a BigInt (toward minus infinity, also for negative rationals).
function floor(a) {
  const r = a.n / a.d; // truncates toward zero
  return a.n < 0n && a.n % a.d !== 0n ? r - 1n : r;
}

const bitLength = (x) => (x === 0n ? 0 : x.toString(2).length);

// ratioToDouble(num, den): the double nearest to num / den (BigInt operands), ties to even: exactly one rounding of
// the exact quotient, which is what IEEE division of two exactly representable operands gives and what a sum of
// many terms does not. Handles subnormals (the quantum never goes below 2^-1074) and overflows to +-Infinity.
function ratioToDouble(num, den) {
  num = BigInt(num);
  den = BigInt(den);
  if (den === 0n) throw new RangeError("ratioToDouble: zero denominator");
  if (num === 0n) return 0;
  const negative = (num < 0n) !== (den < 0n);
  const a = abs(num);
  const b = abs(den);
  // Choose the exponent e of the last kept bit so that the integer quotient floor(a / (b * 2^e)) has 53 bits
  // (or fewer, in the subnormal range where e is pinned at -1074).
  let e = bitLength(a) - bitLength(b) - 53;
  if (e < -1074) e = -1074;
  let quotient, remainder, divisor;
  for (;;) {
    const scaledNum = e >= 0 ? a : a << BigInt(-e);
    const scaledDen = e >= 0 ? b << BigInt(e) : b;
    quotient = scaledNum / scaledDen;
    remainder = scaledNum % scaledDen;
    divisor = scaledDen;
    if (quotient >= 1n << 53n) e += 1; // one bit too many: the estimate from the bit lengths can be one short
    else break;
  }
  // Round half to even on the discarded remainder.
  const twice = remainder * 2n;
  if (twice > divisor || (twice === divisor && (quotient & 1n) === 1n)) quotient += 1n;
  // quotient <= 2^53 is an exact double; 2^e is an exact power of two (subnormal at the bottom). The product is exact
  // unless it overflows, which Infinity then reports.
  let value = Number(quotient);
  // Multiply in two steps when 2^e itself would leave the double range while the product does not.
  if (e < -1022) value = value * 2 ** (e + 600) * 2 ** -600;
  else value *= 2 ** e;
  return negative ? -value : value;
}

const toDouble = (a) => ratioToDouble(a.n, a.d);

// fromDouble(x): the exact rational value of a finite double.
function fromDouble(x) {
  if (!Number.isFinite(x)) throw new RangeError(`fromDouble: ${x} is not finite`);
  if (x === 0) return ZERO;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const negative = (hi >>> 31) === 1;
  const exponent = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (exponent === 0) {
    e = -1074; // subnormal: no implicit leading bit
  } else {
    mantissa |= 1n << 52n;
    e = exponent - 1075;
  }
  const value = e >= 0 ? q(mantissa << BigInt(e)) : q(mantissa, 1n << BigInt(-e));
  return negative ? neg(value) : value;
}

// parse(text): a decimal such as "-12.375", "5", "1e-3" or a fraction "3/8" as an exact rational.
function parse(text) {
  const s = String(text).trim();
  const slash = s.indexOf("/");
  if (slash >= 0) return div(parse(s.slice(0, slash)), parse(s.slice(slash + 1)));
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) throw new RangeError(`parse: ${JSON.stringify(text)} is not a decimal`);
  const fraction = m[3] ?? "";
  let n = BigInt((m[2] || "0") + fraction);
  let exp = (m[4] ? Number(m[4]) : 0) - fraction.length;
  if (m[1] === "-") n = -n;
  return exp >= 0 ? q(n * 10n ** BigInt(exp)) : q(n, 10n ** BigInt(-exp));
}

// sum(list of rationals) and the text form "n/d" (for messages and exact fields).
const sum = (list) => list.reduce(add, ZERO);
const show = (a) => (a.d === 1n ? String(a.n) : `${a.n}/${a.d}`);

module.exports = {
  ZERO, ONE, q, add, sub, mul, div, neg, cmp, eq, min, max, isInt, sign, floor, abs: (a) => (a.n < 0n ? neg(a) : a),
  ratioToDouble, toDouble, fromDouble, parse, sum, show, bitLength,
};
