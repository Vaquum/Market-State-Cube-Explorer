#!/usr/bin/env python3
"""tests/reference/golden.py (H3): Python standard-library goldens for the scale and indicator math and the snapshot pins.

Nothing here imports the repository's code (not tools/, not src/): only the standard library, in exact arithmetic.

  tests/fixtures/scales/value-vectors.json   Value transform: U, k and t(x) at 80 significant digits (decimal), rounded once to a double
  tests/fixtures/scales/rank-vectors.json    257 Type-7 knots and the rank mapping t(x) in exact rationals (fractions)
  tests/fixtures/indicators/{sma,ema,rsi,macd,bollinger}.json
                                             the textbook series of the five indicators on exact rationals (fractions; the
                                             square root of Bollinger's variance at 60 digits), rounded once to a double
  tests/fixtures/snapshot/pinned-cells.json  what data/snapshot.json holds, decoded with struct/zlib/base64 (an implementation
                                             independent of the JS decoder in tests/reference/snapshot.js that checks it)

  python3 tests/reference/golden.py --write   regenerate every file (only after a deliberate change of this script or of the snapshot)
  python3 tests/reference/golden.py --check   regenerate in memory and compare BYTES with the committed files; exit 1 on any difference

Determinism: inputs come from a linear congruential generator written out below (never `random`), every float is the correctly
rounded double of an exact value (float(Fraction), float(Decimal)), JSON is written with sorted keys and Python's shortest round-trip
repr, NaN/Infinity travel as the strings "NaN"/"Infinity"/"-Infinity". The output does not depend on the Python version (3.9+).
CI never rewrites these files to make itself pass: a mismatch is a failure (TESTPLAN 4.6).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import struct
import sys
import zlib
from datetime import datetime, timezone
from decimal import Decimal, getcontext
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
SNAPSHOT = ROOT / "data" / "snapshot.json"

getcontext().prec = 80

# ---------------------------------------------------------------------------------------------------------------------------
# output: sorted keys, scalar lists wrapped, NaN as text
# ---------------------------------------------------------------------------------------------------------------------------


def scalar(x):
    """One JSON scalar. Floats are written with repr() (shortest round trip); non-finite values are text."""
    if isinstance(x, bool) or x is None or isinstance(x, str):
        return json.dumps(x)
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if math.isnan(x):
            return '"NaN"'
        if math.isinf(x):
            return '"Infinity"' if x > 0 else '"-Infinity"'
        if x == 0:
            return "0.0" if math.copysign(1.0, x) > 0 else '"-0"'
        return repr(x)
    raise TypeError(f"not a JSON scalar: {x!r}")


def dumps(value, indent=0, width=118):
    """Sorted-key JSON with two-space indent; a list of scalars is wrapped over lines of at most `width` characters."""
    pad = " " * indent
    inner = " " * (indent + 2)
    if isinstance(value, dict):
        if not value:
            return "{}"
        rows = [f"{inner}{json.dumps(k)}: {dumps(value[k], indent + 2, width)}" for k in sorted(value)]
        return "{\n" + ",\n".join(rows) + f"\n{pad}}}"
    if isinstance(value, (list, tuple)):
        if not value:
            return "[]"
        if all(not isinstance(x, (dict, list, tuple)) for x in value):
            items = [scalar(x) for x in value]
            one = "[" + ", ".join(items) + "]"
            if len(one) + indent <= width:
                return one
            lines, cur = [], inner
            for item in items:
                piece = item + ","
                if len(cur) + len(piece) + 1 > width and cur.strip():
                    lines.append(cur.rstrip())
                    cur = inner
                cur += piece + " "
            lines.append(cur.rstrip().rstrip(","))
            return "[\n" + "\n".join(lines) + f"\n{pad}]"
        rows = [f"{inner}{dumps(x, indent + 2, width)}" for x in value]
        return "[\n" + ",\n".join(rows) + f"\n{pad}]"
    return scalar(value)


def document(obj):
    return dumps(obj) + "\n"


# ---------------------------------------------------------------------------------------------------------------------------
# a local generator for INPUT series (never an expectation)
# ---------------------------------------------------------------------------------------------------------------------------


class Lcg:
    """The classic 31-bit linear congruential generator; its values are inputs, so any stable sequence would do."""

    def __init__(self, seed):
        self.state = seed % 2**31

    def next(self):
        self.state = (self.state * 1103515245 + 12345) % 2**31
        return self.state >> 8  # the high 23 bits: the low bits of an LCG are weak

    def below(self, n):
        return self.next() % n


def num(x):
    """A Fraction that is an integer or a dyadic quarter as a JSON number (int when whole, else the exact float)."""
    return int(x) if x.denominator == 1 else float(x)


def dec(q: Fraction) -> Decimal:
    return Decimal(q.numerator) / Decimal(q.denominator)


def to_float(q: Fraction) -> float:
    return float(q)  # int / int true division in CPython is correctly rounded


# ---------------------------------------------------------------------------------------------------------------------------
# indicators (exact rationals), following the definitions of the baseline's comment block (src/explorer.js 6179-6188)
# ---------------------------------------------------------------------------------------------------------------------------

NAN = float("nan")


def series(seed, length, start=400, floor=8):
    """A quarter-tick random walk: closes that are multiples of 0.25, so every input is an exact double."""
    rng = Lcg(seed)
    ticks, out = start, []
    for _ in range(length):
        ticks = max(floor, ticks + rng.below(17) - 8)
        out.append(Fraction(ticks, 4))
    return out


def sma(values, n):
    out = [None] * len(values)
    for i in range(n - 1, len(values)):
        out[i] = sum(values[i - n + 1 : i + 1], Fraction(0)) / n
    return out


def ema(values, n, start=0):
    """alpha = 2/(n+1), seeded with the SMA of the n values from `start`; values before the seed are undefined."""
    out = [None] * len(values)
    if len(values) - start < n:
        return out
    alpha = Fraction(2, n + 1)
    e = sum(values[start : start + n], Fraction(0)) / n
    out[start + n - 1] = e
    for i in range(start + n, len(values)):
        e = alpha * values[i] + (1 - alpha) * e
        out[i] = e
    return out


def rsi(closes, n=14):
    """Wilder: the first average is the simple mean of the first n changes, then ((n-1) avg + change) / n; down == 0 is 100."""
    out = [None] * len(closes)
    if len(closes) <= n:
        return out
    up = down = Fraction(0)
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            up += d
        else:
            down -= d
    up /= n
    down /= n

    def value():
        if down == 0:
            return Fraction(100)
        if up == 0:
            return Fraction(0)
        return 100 - 100 / (1 + up / down)

    out[n] = value()
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        up = ((n - 1) * up + (d if d > 0 else 0)) / n
        down = ((n - 1) * down + (-d if d < 0 else 0)) / n
        out[i] = value()
    return out


def bollinger(closes, n=20, k=2):
    """Mean +- k population standard deviations; width = (upper - lower) / mean. The root is taken at 60 digits."""
    getcontext().prec = 60
    try:
        mid, upper, lower, width = ([None] * len(closes) for _ in range(4))
        for i in range(n - 1, len(closes)):
            window = closes[i - n + 1 : i + 1]
            m = sum(window, Fraction(0)) / n
            variance = sum(((c - m) ** 2 for c in window), Fraction(0)) / n
            sd = dec(variance).sqrt() if variance else Decimal(0)
            md = dec(m)
            mid[i] = m
            upper[i] = md + k * sd
            lower[i] = md - k * sd
            width[i] = (2 * k * sd) / md
        return mid, upper, lower, width
    finally:
        getcontext().prec = 80


def macd(closes):
    """EMA12 - EMA26 from index 25, its signal the EMA9 of that seeded at index 25 (first signal at 33), histogram their difference."""
    fast, slow = ema(closes, 12), ema(closes, 26)
    line = [None] * len(closes)
    for i in range(25, len(closes)):
        line[i] = fast[i] - slow[i]
    signal = ema([x if x is not None else Fraction(0) for x in line], 9, 25)
    hist = [None] * len(closes)
    for i in range(len(closes)):
        if line[i] is not None and signal[i] is not None:
            hist[i] = line[i] - signal[i]
    return line, signal, hist


def out_floats(values):
    """Expected values: a correctly rounded double each, NaN where the indicator has no value yet."""
    result = []
    for x in values:
        if x is None:
            result.append(NAN)
        elif isinstance(x, Decimal):
            result.append(float(x))
        else:
            result.append(to_float(x))
    return result


def closes_out(closes):
    return [num(c) for c in closes]


INDICATOR_CASES = [
    ("walk120", series(20260930, 120)),
    ("walk300", series(7, 300, start=800)),
    ("flat60", [Fraction(50)] * 60),
    ("rising40", [Fraction(i) for i in range(1, 41)]),
    ("falling40", [Fraction(i) for i in range(40, 0, -1)]),
    ("ramp10", [Fraction(i) for i in range(1, 11)]),
    ("sawtooth50", [Fraction(100 + (i % 4) * 2 - (i % 2)) for i in range(50)]),
]

FORMAT_NOTE = (
    "Expected arrays have one entry per close; NaN (the string \"NaN\") before an indicator's first value. "
    "Values are the correctly rounded doubles of exact rational (fractions) results; Bollinger's square root is taken at 60 digits (decimal). "
    "Closes are multiples of 0.25, so every input is an exact double."
)


def gen_sma():
    cases = []
    for name, closes in INDICATOR_CASES:
        runs = [{"n": n, "expected": out_floats(sma(closes, n))} for n in (3, 5, 20) if n <= len(closes)]
        cases.append({"name": name, "closes": closes_out(closes), "runs": runs})
    return {"format": "sma-golden-1", "note": FORMAT_NOTE, "indicator": "SMA(n): the mean of the last n closes", "cases": cases}


def gen_ema():
    cases = []
    for name, closes in INDICATOR_CASES:
        runs = []
        for n, start in ((3, 0), (12, 0), (26, 0), (9, 5)):
            if len(closes) - start >= n:
                runs.append({"n": n, "from": start, "expected": out_floats(ema(closes, n, start))})
        cases.append({"name": name, "closes": closes_out(closes), "runs": runs})
    return {
        "format": "ema-golden-1", "note": FORMAT_NOTE,
        "indicator": "EMA(n, from): alpha = 2/(n+1), seeded with the SMA of the n values from index `from`",
        "cases": cases,
    }


def gen_rsi():
    cases = []
    for name, closes in INDICATOR_CASES:
        runs = [{"n": n, "expected": out_floats(rsi(closes, n))} for n in (14, 5) if n < len(closes)]
        cases.append({"name": name, "closes": closes_out(closes), "runs": runs})
    return {
        "format": "rsi-golden-1", "note": FORMAT_NOTE,
        "indicator": "RSI(n) by Wilder's smoothing; the first value is at index n; average loss 0 gives 100 (flat series included), average gain 0 gives 0",
        "cases": cases,
    }


def gen_bollinger():
    cases = []
    for name, closes in INDICATOR_CASES:
        runs = []
        for n in (20, 5):
            if n <= len(closes):
                mid, upper, lower, width = bollinger(closes, n, 2)
                runs.append({"n": n, "k": 2, "mid": out_floats(mid), "upper": out_floats(upper), "lower": out_floats(lower), "width": out_floats(width)})
        cases.append({"name": name, "closes": closes_out(closes), "runs": runs})
    return {
        "format": "bollinger-golden-1", "note": FORMAT_NOTE,
        "indicator": "Bollinger(n, k): SMA(n) +- k population standard deviations of the last n closes; width = (upper - lower) / mid",
        "cases": cases,
    }


def gen_macd():
    cases = []
    for name, closes in INDICATOR_CASES:
        line, signal, hist = macd(closes)
        cases.append({"name": name, "closes": closes_out(closes), "macd": out_floats(line), "signal": out_floats(signal), "hist": out_floats(hist)})
    return {
        "format": "macd-golden-1", "note": FORMAT_NOTE,
        "indicator": "MACD = EMA12 - EMA26 (from index 25); signal = EMA9 of MACD seeded at index 25 (first at 33); histogram = MACD - signal",
        "cases": cases,
    }


# ---------------------------------------------------------------------------------------------------------------------------
# scales
# ---------------------------------------------------------------------------------------------------------------------------


def type7(sorted_values, p: Fraction) -> Fraction:
    """Type-7 quantile of sorted Fractions: h = (N-1) p, s[lo] + f (s[lo+1] - s[lo])."""
    count = len(sorted_values)
    h = (count - 1) * p
    lo = h.numerator // h.denominator
    if lo >= count - 1:
        return sorted_values[-1]
    f = h - lo
    return sorted_values[lo] + f * (sorted_values[lo + 1] - sorted_values[lo])


def index_of(t: Decimal):
    """LUT index round(clamp(t, 0, 1) * 255) with ties up, or None when t * 255 is within 1e-9 of a tie (a float t could land either side)."""
    clamped = min(max(t, Decimal(0)), Decimal(1)) * 255
    floor = clamped.to_integral_value(rounding="ROUND_FLOOR")
    if abs((clamped - floor) - Decimal("0.5")) < Decimal("1e-9"):
        return None
    return int((clamped + Decimal("0.5")).to_integral_value(rounding="ROUND_FLOOR"))


def value_t(a: Fraction, U: Fraction, k: Fraction, linear: bool) -> Decimal:
    """|x| -> t: log1p(a/k) / log1p(U/k), or a/U for the linear transform; 0 for a == 0 (no 0/0 anywhere)."""
    if a == 0:
        return Decimal(0)
    if linear:
        return dec(a / U)
    return (1 + dec(a / k)).ln() / (1 + dec(U / k)).ln()


def value_case(name, cohort, signed, probes):
    values = [Fraction(x) for x in cohort]
    if not values:
        return {"name": name, "cohort": cohort, "signed": signed, "state": "no-calibration", "U": None, "k": None, "log1p": [], "linear": []}
    magnitudes = sorted(abs(v) for v in values if v != 0)
    if not magnitudes:
        return {"name": name, "cohort": cohort, "signed": signed, "state": "zero-only", "U": None, "k": None, "log1p": [], "linear": []}
    U = magnitudes[-1]
    k = type7(magnitudes, Fraction(1, 2))
    assert Fraction(float(k)) == k, f"{name}: the median {k} is not an exact double; choose a cohort of dyadic values"
    rows = {"log1p": [], "linear": []}
    for kind, linear in (("log1p", False), ("linear", True)):
        for x in probes:
            fx = Fraction(x)
            assert Fraction(float(fx)) == fx
            a = abs(fx)
            t = value_t(a, U, k, linear)
            sign = -1 if (signed and fx < 0) else 1
            rows[kind].append({"x": x, "t": sign * float(t) if t else 0.0, "over": a > U, "atU": a == U, "index": index_of(t)})
    return {
        "name": name, "cohort": cohort, "signed": signed, "state": "ok", "U": num(U), "k": num(k), "kExact": f"{k.numerator}/{k.denominator}",
        "log1p": rows["log1p"], "linear": rows["linear"],
    }


def seeded_cohort(seed, size, signed=False, zeros=0):
    rng = Lcg(seed)
    out = []
    for _ in range(size):
        v = 1 + rng.below(1000) * (1 + rng.below(50) ** 2)
        out.append(-v if signed and rng.below(2) else v)
    for i in range(zeros):
        out[(i * 7) % size] = 0
    return out


def probes_for(cohort, seed):
    """Zero, the extremes, a handful of members, halves between them and beyond the maximum: all exact doubles."""
    rng = Lcg(seed)
    magnitudes = sorted({abs(x) for x in cohort if x != 0}) or [1]
    picks = {0, 1, magnitudes[0], magnitudes[-1], magnitudes[-1] + 1, magnitudes[-1] * 2, magnitudes[len(magnitudes) // 2]}
    for _ in range(8):
        picks.add(magnitudes[rng.below(len(magnitudes))])
    picks.add(Fraction(magnitudes[len(magnitudes) // 2], 2))
    probes = sorted(picks)
    signed = any(x < 0 for x in cohort)
    return sorted({num(Fraction(p)) for p in probes} | ({-num(Fraction(p)) for p in probes if p} if signed else set()))


def gen_value_vectors():
    hand = [
        ("hand-unsigned-1-2-3-4-100", [1, 2, 3, 4, 100], False, [0, 0.5, 1, 2, 3, 4, 10, 50, 99, 100, 200, 1000]),
        ("hand-signed-m5-m1-0-2-10", [-5, -1, 0, 2, 10], True, [-12, -10, -5, -2, -1, 0, 1, 2, 5, 10, 12]),
        ("hand-all-equal-5", [5, 5, 5], False, [0, 1, 5, 6]),
        ("hand-even-count-1-2-3-10", [1, 2, 3, 10], False, [0, 1, 2.5, 3, 10, 20]),
        ("hand-signed-m3-3-0-9", [-3, 3, 0, 9], True, [-9, -3, 0, 3, 9, 18]),
        ("hand-zero-only", [0, 0], False, []),
        ("hand-empty", [], False, []),
    ]
    cases = [value_case(*h) for h in hand]
    for seed, size, signed, zeros in ((11, 7, False, 0), (12, 50, False, 3), (13, 200, True, 5), (14, 500, False, 0), (15, 37, True, 0)):
        cohort = seeded_cohort(seed, size, signed, zeros)
        cases.append(value_case(f"seeded-{seed}-n{size}{'-signed' if signed else ''}", cohort, signed, probes_for(cohort, seed)))
    return {
        "format": "value-golden-1",
        "note": (
            "Value transform vectors. U = the largest finite magnitude, k = the Type-7 median of the finite NONZERO magnitudes (signed cohorts pooled over "
            "both signs, unsigned cohorts hold no negatives); t(x) = log1p(|x|/k) / log1p(U/k) (the `log1p` rows) or |x|/U (the `linear` rows), evaluated "
            "at 80 significant digits and rounded once to a double; t is NOT clipped (t > 1 above U, `over`), `atU` marks |x| == U (t = 1 exactly), "
            "`index` = round(clamp(|t|,0,1)*255) with ties up, null when a double t could fall on either side of a tie; a signed probe carries the sign "
            "of x. `no-calibration` = empty cohort, `zero-only` = measured zeros only (no U, k)."
        ),
        "cases": cases,
    }


def rank_knots(cohort):
    s = sorted(Fraction(x) for x in cohort)
    return [type7(s, Fraction(j, 256)) for j in range(257)]


def rank_t(knots, x: Fraction):
    """{t, clip} by the rule of issue #46 section 3, in exact rationals: midpoint of a repeated value's first and last q, the lower
    group's last q to the upper group's first q between distinct groups, endpoints with an indication outside the support."""
    lo, hi = knots[0], knots[256]
    if lo == hi:
        if x == lo:
            return Fraction(1, 2), "none"
        return (Fraction(0), "low") if x < lo else (Fraction(1), "high")
    if x < lo:
        return Fraction(0), "low"
    if x > hi:
        return Fraction(1), "high"
    same = [j for j in range(257) if knots[j] == x]
    if same:
        return Fraction(same[0] + same[-1], 512), "none"
    j = max(i for i in range(256) if knots[i] < x)
    a, b = knots[j], knots[j + 1]
    assert a < x < b
    return (j + (x - a) / (b - a)) / 256, "none"


def rank_case(name, cohort, probes):
    knots = rank_knots(cohort)
    rows = []
    for x in probes:
        t, clip = rank_t(knots, Fraction(x))
        rows.append({"x": x, "t": to_float(t), "clip": clip})
    return {"name": name, "cohort": cohort, "knots": [to_float(k) for k in knots], "probes": rows}


def rank_probes(cohort, seed):
    """Members, the midpoints between neighbouring distinct members (exact doubles), below and above the support, and some knots."""
    rng = Lcg(seed)
    distinct = sorted(set(cohort))
    picks = {distinct[0] / 2, distinct[0], distinct[-1], distinct[-1] + 1, distinct[-1] * 2}
    for _ in range(10):
        picks.add(distinct[rng.below(len(distinct))])
    for _ in range(10):
        if len(distinct) > 1:
            i = rng.below(len(distinct) - 1)
            picks.add(Fraction(distinct[i] + distinct[i + 1], 2))
    knots = rank_knots(cohort)
    for j in (1, 64, 128, 200, 255):
        picks.add(knots[j])
        if j + 1 <= 256 and knots[j] != knots[j + 1]:
            picks.add((knots[j] + knots[j + 1]) / 2)
    return sorted({num(Fraction(p)) if Fraction(float(Fraction(p))) == Fraction(p) else float(Fraction(p)) for p in picks})


def gen_rank_vectors():
    cases = [
        rank_case("api-a3-1-1-1-2-3-5-5-8-13-21", [1, 1, 1, 2, 3, 5, 5, 8, 13, 21], [0.5, 1, 1.5, 2, 4, 5, 6, 8, 13, 20, 21, 30]),
        rank_case("all-equal-7", [7, 7, 7], [6, 7, 8]),
        rank_case("single-42", [42], [41, 42, 43]),
        rank_case("two-groups-129x5-128x9", [5] * 129 + [9] * 128, [4.999, 5, 6, 7, 8, 9, 9.001]),
        rank_case("jump-99-tiny-1-huge", list(range(1, 100)) + [10**9], [0.5, 1, 50, 99, 100, 1000000, 500000000, 10**9, 2 * 10**9]),
        rank_case("plateau-200x3-50x10-7x1000", [3] * 200 + [10] * 50 + [1000] * 7, [2, 3, 6.5, 10, 505, 1000, 1001]),
    ]
    for seed, size, span in ((21, 2, 50), (22, 10, 12), (23, 100, 40), (24, 257, 1000), (25, 300, 25)):
        rng = Lcg(seed)
        cohort = [1 + rng.below(span) for _ in range(size)]
        cases.append(rank_case(f"seeded-{seed}-n{size}", cohort, rank_probes(cohort, seed)))
    return {
        "format": "rank-golden-1",
        "note": (
            "Type-7 257-knot rank vectors. knots[j] is the Type-7 quantile at q = j/256 of the cohort (finite values > 0): h = (N-1) j / 256, "
            "s[lo] + (h - lo)(s[lo+1] - s[lo]), exact rational, rounded once to a double. t(x): all-equal cohort -> x == value 0.5, below 0 'low', "
            "above 1 'high'; below the support 0 'low', above 1 'high'; an exactly repeated value maps to (first + last index)/512; between knots "
            "k[j] < x < k[j+1] to (j + (x - k[j])/(k[j+1] - k[j]))/256 (the lower group's last q to the upper group's first q). Exact rational, rounded once."
        ),
        "cases": cases,
    }


# ---------------------------------------------------------------------------------------------------------------------------
# the snapshot, decoded with struct
# ---------------------------------------------------------------------------------------------------------------------------

HEADER = struct.Struct("<4sBBHIII12x")  # magic, n, m, pad, col0, col1, count, then 12 zero bytes: 32 bytes


def decode_msc1(text):
    raw = zlib.decompress(base64.b64decode(text), 16 + zlib.MAX_WBITS)  # gzip container
    magic, n, m, _pad, col0, col1, count = HEADER.unpack_from(raw, 0)
    assert magic == b"MSC1", magic
    assert HEADER.size == 32
    at = 32
    arrays = {}
    for name, fmt, size in (("vol", "d", 8), ("tbvol", "d", 8), ("col", "I", 4), ("row", "I", 4), ("ct", "I", 4), ("bt", "I", 4)):
        arrays[name] = struct.unpack_from(f"<{count}{fmt}", raw, at)
        at += size * count
    assert at == len(raw), f"MSC1 with {count} records is {at} bytes, the payload has {len(raw)}"
    return {"n": n, "m": m, "col0": col0, "col1": col1, "count": count, "length": len(raw), **arrays}


def exact_sum(values):
    total = Fraction(0)
    for v in values:
        total += Fraction(v)
    return total


def gen_snapshot():
    raw = SNAPSHOT.read_bytes()
    pack = json.loads(raw)
    decoded = {key: decode_msc1(pack["blocks"][key]["gzip_base64"]) for key in ("recent", "reference", "overview")}
    blocks, cells = {}, []
    for key, d in decoded.items():
        meta = pack["blocks"][key]
        count = d["count"]
        vol = d["vol"]
        top = max(range(count), key=lambda i: (vol[i], -i))
        blocks[key] = {
            "n": d["n"], "m": d["m"], "b0": meta["b0"], "b1": meta["b1"], "col0": d["col0"], "col1": d["col1"], "count": count,
            "payloadBytes": d["length"], "layout": meta["layout"],
            "distinctColumns": len(set(d["col"])), "minRow": min(d["row"]), "maxRow": max(d["row"]), "minCol": min(d["col"]), "maxCol": max(d["col"]),
            "volume": to_float(exact_sum(d["vol"])), "takerBuyVolume": to_float(exact_sum(d["tbvol"])),
            "trades": sum(d["ct"]), "takerBuyTrades": sum(d["bt"]),
            "maxVolume": vol[top], "maxVolumeIndex": top, "maxTrades": max(d["ct"]),
            "sorted": all((d["col"][i], d["row"][i]) < (d["col"][i + 1], d["row"][i + 1]) for i in range(count - 1)),
        }
        for label, i in (("first", 0), ("middle", count // 2), ("max volume", top), ("last", count - 1)):
            cells.append({
                "block": key, "which": label, "index": i, "col": d["col"][i], "row": d["row"][i],
                "vol": d["vol"][i], "tbvol": d["tbvol"][i], "ct": d["ct"][i], "bt": d["bt"][i],
            })
    # the recorded consistency: `recent` (0,0) aggregated to (4,0) equals `reference` over their shared complete columns
    recent, ref = decoded["recent"], decoded["reference"]
    lo = -(-pack["blocks"]["recent"]["b0"] // 16)  # first level-4 column wholly inside recent
    hi = min(ref["col1"], pack["blocks"]["recent"]["b1"] // 16)
    agg = {}
    for i in range(recent["count"]):
        c = recent["col"][i] // 16
        if lo <= c < hi:
            key = (c, recent["row"][i])
            a = agg.setdefault(key, [Fraction(0), Fraction(0), 0, 0])
            a[0] += Fraction(recent["vol"][i])
            a[1] += Fraction(recent["tbvol"][i])
            a[2] += recent["ct"][i]
            a[3] += recent["bt"][i]
    theirs = {(ref["col"][i], ref["row"][i]): (ref["vol"][i], ref["tbvol"][i], ref["ct"][i], ref["bt"][i]) for i in range(ref["count"]) if lo <= ref["col"][i] < hi}
    worst = 0.0
    for key, a in agg.items():
        if key not in theirs:
            continue
        for mine, other in ((to_float(a[0]), theirs[key][0]), (to_float(a[1]), theirs[key][1])):
            if max(abs(mine), abs(other)):
                worst = max(worst, abs(mine - other) / max(abs(mine), abs(other)))
    consistent = {
        "columns": [lo, hi], "cells": len(agg), "sameCellSet": set(agg) == set(theirs),
        "countsExact": all(agg[k][2] == theirs[k][2] and agg[k][3] == theirs[k][3] for k in agg if k in theirs),
        "maxRelativeVolumeDifference": worst,
    }
    # the cutoff as integer milliseconds since 2021-01-01T00:00:00Z (the snapshot writes it with six fractional digits)
    delta = datetime.fromisoformat(pack["cutoff"].replace("Z", "+00:00")) - datetime(2021, 1, 1, tzinfo=timezone.utc)
    assert delta.microseconds % 1000 == 0
    cutoff_ms = (delta.days * 86400 + delta.seconds) * 1000 + delta.microseconds // 1000
    base = Fraction(cutoff_ms, 56250)
    return {
        "format": "snapshot-pins-1",
        "note": (
            "What data/snapshot.json holds, decoded by struct/zlib/base64 (independent of the JavaScript decoder that checks it). MSC1: a 32-byte header "
            "<4sBBHIII12x, then vol f64, tbvol f64, col u32, row u32, ct u32, bt u32, each `count` long: six arrays, no path, dwell, high or low. "
            "`cells` pins four cells per block (first, middle, largest volume, last); `blocks` the recorded facts; `recentToReference` the recorded "
            "last-bit difference of the two reads of the same cells. The sha256 pins the file: a refreshed snapshot fails the check until this file is rewritten."
        ),
        "snapshotSha256": hashlib.sha256(raw).hexdigest(), "source": pack["source"], "cutoff": pack["cutoff"], "cutoffMs": cutoff_ms,
        "cutoffBase": num(base) if base.denominator == 1 else float(base), "cutoffBaseIsInteger": base.denominator == 1,
        "blocks": blocks, "cells": cells, "recentToReference": consistent,
    }


# ---------------------------------------------------------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------------------------------------------------------

OUTPUTS = {
    "scales/value-vectors.json": gen_value_vectors,
    "scales/rank-vectors.json": gen_rank_vectors,
    "indicators/sma.json": gen_sma,
    "indicators/ema.json": gen_ema,
    "indicators/rsi.json": gen_rsi,
    "indicators/macd.json": gen_macd,
    "indicators/bollinger.json": gen_bollinger,
    "snapshot/pinned-cells.json": gen_snapshot,
}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="regenerate every file")
    mode.add_argument("--check", action="store_true", help="regenerate in memory and compare bytes with the committed files")
    args = parser.parse_args(argv)
    failed = 0
    for rel, make in OUTPUTS.items():
        text = document(make())
        target = FIXTURES / rel
        if args.write:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {target.relative_to(ROOT)} ({len(text)} bytes)")
            continue
        if not target.exists():
            print(f"MISSING {target.relative_to(ROOT)}")
            failed += 1
        elif target.read_bytes() != text.encode("utf-8"):
            print(f"DIFFERS {target.relative_to(ROOT)} (committed {target.stat().st_size} bytes, regenerated {len(text.encode('utf-8'))})")
            failed += 1
        else:
            print(f"ok {target.relative_to(ROOT)}")
    if failed:
        print(f"golden.py --check: {failed} file(s) differ; if the change is deliberate run --write and review the diff", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
