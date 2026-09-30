"use strict";
// tests/reference/typeseven.js (H3): Type-7 quantiles and the 257-knot rank mapping in exact rational arithmetic.
//
// Type 7 (the default of R, NumPy and d3.quantileSorted): for a sorted sample s of size N and a probability p,
// h = (N - 1) p, lo = floor(h), f = h - lo, and the quantile is s[lo] + f (s[lo + 1] - s[lo]) (s[N - 1] at the top).
// Every step here is on exact rationals built from the exact value of each double, and the result is rounded to a
// double ONCE, so a float implementation that loses a bit to s[lo] + f * (s[lo + 1] - s[lo]) is told by how much.
//
// The rank mapping follows issue #46 section 3 (the lower group's last q to the upper group's first q between
// distinct groups, the midpoint of the first and last q of an exactly repeated value, endpoints with an indication
// outside the support) written out from the rule, not from the code under test.
const R = require("./rational.js");

function assertSorted(values) {
  for (let i = 1; i < values.length; i++) {
    if (!(values[i - 1] <= values[i])) throw new RangeError(`typeSeven: the sample is not sorted ascending at index ${i}`);
  }
}

// typeSevenExact(sortedValues, p): the exact rational quantile; p is a rational {n, d} or "j/256" style text.
function typeSevenExact(sortedValues, p) {
  if (!sortedValues.length) throw new RangeError("typeSeven of an empty sample");
  assertSorted(sortedValues);
  const prob = typeof p === "object" ? p : R.parse(p);
  if (R.cmp(prob, R.ZERO) < 0 || R.cmp(prob, R.ONE) > 0) throw new RangeError("typeSeven: p must be in [0, 1]");
  const N = sortedValues.length;
  const h = R.mul(R.q(N - 1), prob);
  const lo = Number(R.floor(h));
  if (lo >= N - 1) return R.fromDouble(sortedValues[N - 1]);
  const f = R.sub(h, R.q(lo));
  const a = R.fromDouble(sortedValues[lo]);
  const b = R.fromDouble(sortedValues[lo + 1]);
  return R.add(a, R.mul(f, R.sub(b, a)));
}

// typeSeven(sortedValues, p): the quantile as a double (one rounding of the exact value).
const typeSeven = (sortedValues, p) => R.toDouble(typeSevenExact(sortedValues, p));

// median7(values): the Type-7 median of an unsorted sample: the mean of the two middle values for an even count.
function median7(values) {
  const sorted = Array.from(values).sort((x, y) => x - y);
  return typeSeven(sorted, R.q(1, 2));
}

// knots257(values): the 257 knots j/256, j = 0..256, of a sample of finite values > 0 (the rank cohort, DR-09/DR-40), as
// doubles. The doubles are non-decreasing by construction (correct rounding is monotone).
function knots257(values) {
  const sorted = Array.from(values).sort((x, y) => x - y);
  const out = [];
  for (let j = 0; j <= 256; j++) out.push(typeSeven(sorted, R.q(j, 256)));
  return out;
}

// rankApply(knots, x): {t, clip} for one value: t in [0, 1] as a double (one rounding of the exact rational), clip one of
// "none", "low", "high" (outside the support: the endpoint with an indication).
function rankApply(knots, x) {
  if (knots.length !== 257) throw new RangeError("rankApply: 257 knots expected");
  const lo = knots[0];
  const hi = knots[256];
  if (lo === hi) {
    // All-equal cohort: the value itself maps to the midpoint, anything else to an endpoint with an indication.
    if (x === lo) return { t: 0.5, clip: "none" };
    return x < lo ? { t: 0, clip: "low" } : { t: 1, clip: "high" };
  }
  if (x < lo) return { t: 0, clip: "low" };
  if (x > hi) return { t: 1, clip: "high" };
  // first and last index whose knot equals x, by a plain scan (no bisection, so no shared structure with an implementation)
  let first = -1;
  let last = -1;
  for (let j = 0; j <= 256; j++) {
    if (knots[j] === x) {
      if (first < 0) first = j;
      last = j;
    }
  }
  if (first >= 0) return { t: R.toDouble(R.q(first + last, 512)), clip: "none" };
  // strictly between two distinct knots k[j] < x < k[j + 1]: the lower group's last q is j/256, the upper group's first is (j + 1)/256
  let j = 0;
  while (!(knots[j] < x && x < knots[j + 1])) j++;
  const a = R.fromDouble(knots[j]);
  const b = R.fromDouble(knots[j + 1]);
  const along = R.div(R.sub(R.fromDouble(x), a), R.sub(b, a));
  return { t: R.toDouble(R.div(R.add(R.q(j), along), R.q(256))), clip: "none" };
}

module.exports = { typeSeven, typeSevenExact, median7, knots257, rankApply };
