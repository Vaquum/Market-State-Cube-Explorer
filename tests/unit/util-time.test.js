"use strict";
// U45 (T-util, T-time): E.util and E.time of src/encoding.js, loaded through tests/support/enc.js.
// Oracles (none of them is the code under test): d3.quantileSorted from vendor/d3.min.js for the Type-7
// quantile; an exact BigInt rational computation of Type-7 for integer data at p = j/256; hand vectors;
// straightforward linear scans for lowerBound and upperBound; the platform's Date (Date.UTC and
// toISOString) for every calendar value; the base <-> time vectors of TESTPLAN.md section 0
// (2026-09-24T00:00Z = base 3213312, T0 = 1609459200, BASE = 56.25).
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const d3 = require("../../vendor/d3.min.js");

// The module may be evaluated in a vm context (ENCODING_PARTS_DIR), so its errors are of another realm:
// an error is matched by name, never by class.

// mulberry32, inlined so this file needs nothing but the module and d3.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("E.util.clamp: limits, identity inside, NaN stays NaN", () => {
  const { clamp } = E.util;
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.25, 0, 1), 0.25);
  assert.equal(clamp(0, 0, 1), 0);
  assert.equal(clamp(1, 0, 1), 1);
  assert.equal(clamp(Infinity, 0, 1), 1);
  assert.equal(clamp(-Infinity, 0, 1), 0);
  assert.equal(clamp(3, 3, 3), 3);
  assert.equal(clamp(-7, -10, -2), -7);
  assert.ok(Number.isNaN(clamp(NaN, 0, 1)), "clamp must not invent a boundary value for NaN");
});

test("E.util.quantile7: hand vectors (Type-7, h = (N-1)p)", () => {
  const { quantile7 } = E.util;
  assert.equal(quantile7([1, 2, 3, 10], 0.5), 2.5, "median of four: mean of the two middle values (API.md A.3)");
  assert.equal(quantile7([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(quantile7([1, 2, 3, 4, 5], 0.75), 4);
  assert.equal(quantile7([10, 20], 0.1), 11);
  assert.equal(quantile7([10, 20], 0.5), 15);
  assert.equal(quantile7([1, 1, 1, 2, 3, 5, 5, 8, 13, 21], 1), 21);
  assert.equal(quantile7([1, 1, 1, 2, 3, 5, 5, 8, 13, 21], 0), 1);
  // API.md Appendix A.3: the last three knots of the rank fit of [1,1,1,2,3,5,5,8,13,21] are the
  // quantiles j/256 for j = 254, 255, 256: 20.4375, 20.71875, 21 (h = 9*j/256).
  const v = [1, 1, 1, 2, 3, 5, 5, 8, 13, 21];
  assert.equal(quantile7(v, 254 / 256), 20.4375);
  assert.equal(quantile7(v, 255 / 256), 20.71875);
  assert.equal(quantile7(v, 256 / 256), 21);
  assert.equal(quantile7([7], 0.3), 7, "one value is every quantile");
  assert.equal(quantile7([5, 5, 5], 0.5), 5);
});

test("E.util.quantile7: outside [0,1] clamps to the extremes; empty and NaN p have no quantile", () => {
  const { quantile7 } = E.util;
  assert.equal(quantile7([1, 2, 3], -1), 1);
  assert.equal(quantile7([1, 2, 3], 2), 3);
  assert.ok(Number.isNaN(quantile7([], 0.5)));
  assert.ok(Number.isNaN(quantile7([1, 2, 3], NaN)));
});

test("E.util.quantile7 equals d3.quantileSorted bit for bit on seeded random data", () => {
  const { quantile7, median7 } = E.util;
  const r = rng(45);
  for (let round = 0; round < 400; round++) {
    const n = 1 + Math.floor(r() * 60);
    const a = [];
    for (let i = 0; i < n; i++) a.push((r() - 0.5) * 10 ** Math.floor(r() * 12));
    a.sort((x, y) => x - y);
    for (const p of [0, 0.5, 1, r(), r(), r(), Math.floor(r() * 257) / 256]) {
      assert.ok(Object.is(quantile7(a, p), d3.quantileSorted(a, p)), `n=${n} p=${p}`);
    }
    assert.ok(Object.is(median7(a), d3.quantileSorted(a, 0.5)), `median n=${n}`);
  }
});

test("E.util.quantile7 equals an exact rational Type-7 for integer data at p = j/256 (the rank knots)", () => {
  const { quantile7 } = E.util;
  const r = rng(7);
  for (let round = 0; round < 60; round++) {
    const n = 1 + Math.floor(r() * 300);
    const s = [];
    for (let i = 0; i < n; i++) s.push(Math.floor(r() * 2000000) - 1000000);
    s.sort((x, y) => x - y);
    for (let j = 0; j <= 256; j++) {
      // h * 256 = (n-1)*j exactly; value * 256 = s[i]*256 + frac256 * (s[i+1]-s[i]).
      const h256 = BigInt(n - 1) * BigInt(j);
      const i = Number(h256 / 256n);
      const frac256 = h256 - BigInt(i) * 256n;
      const at = BigInt(s[i]);
      const next = i + 1 < n ? BigInt(s[i + 1]) : at;
      const times256 = at * 256n + frac256 * (next - at);
      assert.equal(quantile7(s, j / 256), Number(times256) / 256, `n=${n} j=${j}`);
    }
  }
});

test("E.util.median7: odd, even, single, and typed-array input", () => {
  const { median7 } = E.util;
  assert.equal(median7([1, 2, 3]), 2);
  assert.equal(median7([1, 2, 3, 10]), 2.5);
  assert.equal(median7([4]), 4);
  assert.equal(median7(Float64Array.from([1, 3])), 2);
  assert.ok(Number.isNaN(median7([])));
});

// The oracles for the two bisections are the definitions themselves, as linear scans.
function firstAtLeast(a, x) { for (let i = 0; i < a.length; i++) if (a[i] >= x) return i; return a.length; }
function firstGreater(a, x) { for (let i = 0; i < a.length; i++) if (a[i] > x) return i; return a.length; }

test("E.util.lowerBound / upperBound: hand vectors", () => {
  const { lowerBound, upperBound } = E.util;
  const a = [1, 1, 1, 2, 3, 5, 5, 8, 13, 21];
  assert.equal(lowerBound(a, 1), 0);
  assert.equal(upperBound(a, 1), 3);
  assert.equal(lowerBound(a, 5), 5);
  assert.equal(upperBound(a, 5), 7);
  assert.equal(lowerBound(a, 4), 5, "absent value: both bounds point at the next larger one");
  assert.equal(upperBound(a, 4), 5);
  assert.equal(lowerBound(a, 0), 0);
  assert.equal(upperBound(a, 0), 0);
  assert.equal(lowerBound(a, 21), 9);
  assert.equal(upperBound(a, 21), 10);
  assert.equal(lowerBound(a, 22), 10);
  assert.equal(upperBound(a, 22), 10);
  assert.equal(lowerBound([], 3), 0);
  assert.equal(upperBound([], 3), 0);
  assert.equal(lowerBound([7], 7), 0);
  assert.equal(upperBound([7], 7), 1);
});

test("E.util.lowerBound / upperBound equal the linear-scan definitions on seeded arrays with ties", () => {
  const { lowerBound, upperBound } = E.util;
  const r = rng(99);
  for (let round = 0; round < 300; round++) {
    const n = Math.floor(r() * 40);
    const a = [];
    for (let i = 0; i < n; i++) a.push(Math.floor(r() * 12) / 2);
    a.sort((x, y) => x - y);
    const typed = Float64Array.from(a);
    for (let x = -1; x <= 7; x += 0.25) {
      assert.equal(lowerBound(a, x), firstAtLeast(a, x), `lower ${JSON.stringify(a)} ${x}`);
      assert.equal(upperBound(a, x), firstGreater(a, x), `upper ${JSON.stringify(a)} ${x}`);
      assert.equal(lowerBound(typed, x), firstAtLeast(a, x));
      assert.equal(upperBound(typed, x), firstGreater(a, x));
      const equal = a.filter((v) => v === x).length;
      assert.equal(upperBound(a, x) - lowerBound(a, x), equal, "the two bounds delimit the run of equal values");
    }
  }
});

// ---- E.time ----------------------------------------------------------------

test("E.time.baseToMs / msToBase: the TESTPLAN.md section 0 vectors, defaults and explicit lattice", () => {
  const { baseToMs, msToBase } = E.time;
  const T0 = 1609459200;
  const BASE = 56.25;
  const vectors = [
    [3213312, Date.UTC(2026, 8, 24)],
    [3214848, Date.UTC(2026, 8, 25)],
    [3219456, Date.UTC(2026, 8, 28)],
    [3224064, Date.UTC(2026, 9, 1)],
    [3365376, Date.UTC(2027, 0, 1)],
    [0, Date.UTC(2021, 0, 1)],
  ];
  for (const [base, ms] of vectors) {
    assert.equal(baseToMs(base), ms, `default lattice, base ${base}`);
    assert.equal(baseToMs(base, T0, BASE), ms, `explicit lattice, base ${base}`);
    assert.equal(msToBase(ms), base);
    assert.equal(msToBase(ms, T0, BASE), base);
  }
  assert.equal(baseToMs(3213312), 1790208000000, "the literal used by E.model (DR-13)");
  assert.equal(baseToMs(3214848), 1790294400000);
  // The recorded cutoff 2026-09-24T12:02:48.75Z is base 3214083 (TESTPLAN.md section 0).
  assert.equal(baseToMs(3214083), Date.UTC(2026, 8, 24, 12, 2, 48, 750));
  assert.equal(msToBase(Date.UTC(2026, 8, 24, 12, 2, 48, 750)), 3214083);
});

test("E.time.baseToMs: a fractional base rounds to a whole millisecond; another lattice is honoured", () => {
  const { baseToMs, msToBase } = E.time;
  // 0.5 base of 56.25 s = 28.125 s: 28125 ms exactly. 0.4 base = 22.5 s.
  assert.equal(baseToMs(0.5, 0, 56.25), 28125);
  assert.equal(baseToMs(0.4, 0, 56.25), 22500);
  // 1/3 base of 60 s = 20 s; 1e-9 base rounds to 0 ms.
  assert.equal(baseToMs(1 / 3, 100, 60), 120000);
  assert.equal(baseToMs(1e-9, 0, 56.25), 0);
  assert.equal(msToBase(120000, 100, 60), 1 / 3 + 0, "(120 s - 100 s) / 60 s");
  assert.ok(Number.isInteger(baseToMs(12345.678)));
});

test("E.time: msToBase inverts baseToMs on whole milliseconds (seeded)", () => {
  const { baseToMs, msToBase } = E.time;
  const r = rng(2026);
  for (let i = 0; i < 2000; i++) {
    const ms = Date.UTC(2021, 0, 1) + Math.floor(r() * 6e11);
    assert.equal(baseToMs(msToBase(ms)), ms, `ms=${ms}`);
  }
});

test("E.time.utcDay: hand vectors around the boundaries that matter", () => {
  const { utcDay } = E.time;
  assert.equal(utcDay(0), "1970-01-01");
  assert.equal(utcDay(-1), "1969-12-31", "just before the epoch is the previous day");
  assert.equal(utcDay(Date.UTC(2026, 8, 24)), "2026-09-24");
  assert.equal(utcDay(Date.UTC(2026, 8, 24) - 1), "2026-09-23", "one ms before midnight");
  assert.equal(utcDay(Date.UTC(2026, 8, 24, 23, 59, 59, 999)), "2026-09-24");
  assert.equal(utcDay(1790208000000), "2026-09-24");
  assert.equal(utcDay(1790294400000 - 1), "2026-09-24");
  assert.equal(utcDay(1790294400000), "2026-09-25");
  assert.equal(utcDay(Date.UTC(2000, 1, 29)), "2000-02-29", "2000 is a leap year");
  assert.equal(utcDay(Date.UTC(1900, 1, 28) + 86400000), "1900-03-01", "1900 is not");
  assert.equal(utcDay(Date.UTC(2100, 1, 28) + 86400000), "2100-03-01", "2100 is not");
  assert.equal(utcDay(Date.UTC(2024, 11, 31, 23, 59, 59, 999)), "2024-12-31");
  assert.equal(utcDay(Date.UTC(2021, 0, 1)), "2021-01-01");
  assert.equal(utcDay(1609459200 * 1000), "2021-01-01", "the history origin T0");
  assert.equal(utcDay(0.9), "1970-01-01", "a fractional millisecond stays inside its day");
});

test("E.time.utcDay equals Date.toISOString for every day from 1900 to 2200, at both ends of the day", () => {
  const { utcDay } = E.time;
  const first = Date.UTC(1900, 0, 1);
  const last = Date.UTC(2200, 11, 31);
  for (let ms = first; ms <= last; ms += 86400000) {
    const want = new Date(ms).toISOString().slice(0, 10);
    assert.equal(utcDay(ms), want, `start of ${want}`);
    assert.equal(utcDay(ms + 86399999), want, `end of ${want}`);
  }
});

test("E.time.utcDay equals Date.toISOString on seeded milliseconds between 0000 and 9999", () => {
  const { utcDay } = E.time;
  const r = rng(31);
  const from = -62167219200000; // 0000-01-01T00:00:00Z
  const to = 253402300799999; // 9999-12-31T23:59:59.999Z
  for (let i = 0; i < 20000; i++) {
    const ms = Math.floor(from + r() * (to - from));
    assert.equal(utcDay(ms), new Date(ms).toISOString().slice(0, 10), `ms=${ms}`);
  }
  assert.equal(utcDay(from), "0000-01-01");
  assert.equal(utcDay(to), "9999-12-31");
});

test("E.time.utcDay throws instead of inventing a key for input that has none", () => {
  const { utcDay } = E.time;
  assert.throws(() => utcDay(NaN), { name: "TypeError" });
  assert.throws(() => utcDay(Infinity), { name: "TypeError" });
  assert.throws(() => utcDay("2026-09-24"), { name: "TypeError" });
  assert.throws(() => utcDay(undefined), { name: "TypeError" });
  assert.throws(() => utcDay(253402300800000), { name: "RangeError" }, "year 10000");
  assert.throws(() => utcDay(-62167219200001), { name: "RangeError" }, "year -1");
});
