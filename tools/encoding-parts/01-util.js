  // @part 01-util
  // @requires
  // @prefix util
  // @provides util time
  // == §01 util and time: the small numeric routines every other part shares (API.md A.3, DD-58) ==
  // Pure functions only. Nothing here reads a clock: even the UTC day key is computed from the calendar
  // arithmetic below instead of `new Date`, so this part needs no purity exception and a test can pin
  // every value without a fake clock.

  // E.util.clamp (API.md A.3): x limited to [lo, hi]; lo <= hi is the caller's business. NaN is returned
  // as NaN on purpose: a clamp must never turn "not a number" into a plausible boundary value, the typed
  // results (B.1) are where non-finite input is named.
  function utilClamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  // E.util.quantile7 (API.md A.3, C.3, C.4, DD-10): the Type-7 quantile of an ascending array, h = (N-1)p.
  // The arithmetic is written exactly as d3.quantileSorted writes it (value0 + (value1 - value0) * frac),
  // so the two agree to the last bit and the test can use d3 as the independent oracle. p outside
  // [0,1] clamps to the extremes; an empty array has no quantile and answers NaN (callers branch on the
  // count first: an empty cohort is "No calibration", never a number).
  function utilQuantile7(sortedAsc, p) {
    const n = sortedAsc.length;
    if (!(n > 0) || p !== p) return NaN;
    if (p <= 0 || n < 2) return +sortedAsc[0];
    if (p >= 1) return +sortedAsc[n - 1];
    const h = (n - 1) * p;
    const i = Math.floor(h);
    const v0 = +sortedAsc[i];
    const v1 = +sortedAsc[i + 1];
    return v0 + (v1 - v0) * (h - i);
  }

  // E.util.median7 (API.md A.3): the Type-7 median, which for an even count is the midpoint of the two
  // middle values. One routine for U, k and the rank knots keeps "median" identical everywhere (DD-10).
  function utilMedian7(sortedAsc) {
    return utilQuantile7(sortedAsc, 0.5);
  }

  // E.util.lowerBound (API.md A.3): the first index whose value is >= x (the length when none is). Works
  // on any ascending indexable, typed arrays included. A NaN probe compares false against everything and
  // answers 0; callers exclude non-finite values before they search.
  function utilLowerBound(sortedAsc, x) {
    let lo = 0;
    let hi = sortedAsc.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedAsc[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // E.util.upperBound (API.md A.3): the first index whose value is > x. lowerBound and upperBound
  // together delimit the run of values equal to x, which is how the rank transform finds a tie group.
  function utilUpperBound(sortedAsc, x) {
    let lo = 0;
    let hi = sortedAsc.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedAsc[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // E.time.baseToMs (API.md A.3): epoch milliseconds of a base-column position, T0 seconds plus base
  // columns of BASE seconds each. The page passes PACK.t0 and PACK.base_seconds; the defaults are this
  // cube's recorded lattice (header LATTICE). Rounded to a whole millisecond so the value is usable as an
  // integer key. Non-finite input propagates as NaN (a conversion cannot invent a moment).
  function utilBaseToMs(base, T0 = LATTICE.T0, BASE = LATTICE.BASE) {
    return Math.round((T0 + base * BASE) * 1000);
  }

  // E.time.msToBase (API.md A.3): the inverse, a (fractional) base-column position. Not rounded: a
  // cutoff inside a column is a real position and the callers decide whether to floor it.
  function utilMsToBase(ms, T0 = LATTICE.T0, BASE = LATTICE.BASE) {
    return (ms / 1000 - T0) / BASE;
  }

  // E.time.utcDay (API.md A.3): "YYYY-MM-DD" of the UTC day that contains ms. The per-day pins, the
  // provenance date and the daily cache keys all use it. Days are counted from 1970-01-01 (floor, so
  // times before the epoch land on the right day) and turned into a civil date with the era arithmetic
  // of H. Hinnant's "days from civil" algorithm, which is exact for the proleptic Gregorian calendar.
  // A non-finite input or a year outside 0000..9999 has no four-digit key and throws.
  function utilUtcDay(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) throw new TypeError("utcDay needs a finite number of milliseconds");
    const days = Math.floor(ms / 86400000);
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    if (year < 0 || year > 9999) throw new RangeError("utcDay: year " + year + " has no four-digit key");
    const two = (v) => (v < 10 ? "0" : "") + v;
    return String(year + 10000).slice(1) + "-" + two(month) + "-" + two(day);
  }

  API.util = Object.freeze({
    clamp: utilClamp,
    quantile7: utilQuantile7,
    median7: utilMedian7,
    lowerBound: utilLowerBound,
    upperBound: utilUpperBound,
  });
  API.time = Object.freeze({
    baseToMs: utilBaseToMs,
    msToBase: utilMsToBase,
    utcDay: utilUtcDay,
  });
