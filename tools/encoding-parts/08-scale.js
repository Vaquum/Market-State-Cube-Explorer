  // @part 08-scale
  // @requires 01-util 02-hash
  // @prefix scl
  // @provides scale
  // == §08 scale: numerical mappings (descriptors), their fits, evaluation, ids and compatibility (API.md B.5, C.3, C.4, C.5, C.7, C.8) ==
  // A Descriptor is the JSON-safe record of ONE mapping from a measured value to a coordinate t: the value
  // fit (log1p or linear), the 257-knot rank, the fixed shares and ratios, zero-only and the axis window.
  // Everything here is pure. Fits allocate (they run once per settled fit, off the draw path); `plan` and
  // the closures it returns are the per-cell path and allocate nothing (INTEGRATION D.15, DD-44).

  // Clip codes (C.5): a small-integer alphabet so a warning tally can count them without strings.
  // EXACT_* is a value exactly on an endpoint: drawn at the end of the ramp but NOT out of range.
  const sclClip = Object.freeze({ NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 });
  const sclNone = 0;
  const sclLow = 1;
  const sclHigh = 2;
  const sclExactLow = 3;
  const sclExactHigh = 4;
  // The eight kinds of B.5. `none` is "No calibration": it has no coordinate and is never persisted.
  const sclKinds = Object.freeze(["value-log1p", "value-linear", "rank-type7-257", "fixed-linear", "fixed-diverging", "zero-only", "none", "axis-linear"]);
  // The only members a descriptor may carry. Anything else in an imported record is refused by `validate`.
  const sclFields = Object.freeze(["v", "id", "kind", "signed", "params", "clip", "algorithm"]);
  // The one memo of the module (DD-44, an exception to DD-02: it is unobservable and needs no reset): a
  // plan per descriptor OBJECT. Descriptors are frozen when made here, so a cached plan cannot go stale.
  const sclPlans = new WeakMap();

  function sclIsNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
  }

  function sclIsObject(x) {
    // The tag test (not a prototype check) also accepts objects made in another realm, such as a test's
    // literals handed to a module evaluated in a vm context.
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function sclDeepFreeze(v) {
    if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) sclDeepFreeze(v[keys[i]]);
    }
    return v;
  }

  // The record that is hashed (C.7): {v, kind, signed, params, clip}. It EXCLUDES units, measure, context,
  // cohort, provenance, appearance, theme, the LUT and the `algorithm` and `id` fields (DR-03), so two
  // measures with the same (U, k) share an id and compatibility is decided from the context (C.8), never
  // from the id. `v` is the record's own mapping version, which is the header's VERSION.mapping for every
  // descriptor made here (and for a hand-built record that leaves it out); a record that says another
  // version gets another id, so an id is always a function of the record it names (`validate` then refuses
  // the record itself).
  function sclMappingInput(desc) {
    return { v: desc.v === undefined ? VERSION.mapping : desc.v, kind: desc.kind, signed: desc.signed, params: desc.params, clip: desc.clip };
  }

  // E.scale.canonical (API.md A.3, C.7): the exact JSON text that the id hashes.
  function sclCanonical(desc) {
    return API.hash.canonical(sclMappingInput(desc));
  }

  // E.scale.id (API.md A.3, C.7, DR-03, DR-34): 16 base64url characters of the first 96 bits of
  // SHA-256(canonical mapping record). E.hash.id96 canonicalises INSIDE, so it is given the record and
  // never its text.
  function sclId(desc) {
    return API.hash.id96(sclMappingInput(desc));
  }

  // A finished descriptor: id computed, deep-frozen (the plan cache and every holder of the record rely on
  // it never changing). `algorithm` is provenance only and is not hashed.
  function sclMake(kind, signed, params, algorithm) {
    const desc = { v: VERSION.mapping, id: "", kind, signed, params, clip: kind === "axis-linear" ? "axis@1" : "clamp01@1", algorithm };
    desc.id = sclId(desc);
    return sclDeepFreeze(desc);
  }

  // E.scale.zeroOnly (API.md A.3, C.4): the calibration of a valid cohort whose every measured value is
  // zero (D3: a zero-only calibration, NEVER U = 1). A later nonzero value is out of domain until a fit
  // replaces it (see `apply`, DD-95).
  function sclZeroOnly(signed) {
    return sclMake("zero-only", Boolean(signed), null, "value-fit@1");
  }

  // The values of a cohort: `{values}` as E.cohort makes it, or a bare array/typed array (handy in tests
  // and for callers that only have numbers).
  function sclValuesOf(cohort) {
    // Not `cohort.values !== undefined` alone: every Array has a `values` METHOD. Only a plain object counts.
    if (sclIsObject(cohort) && cohort.values !== undefined) return cohort.values;
    return cohort === null || cohort === undefined ? [] : cohort;
  }

  function sclNoCalibration(reason) {
    return { state: "no-calibration", descriptor: null, reason };
  }

  // E.scale.fitValue (API.md A.3, C.4, DR-09, S1-072..076): the Value mapping of a cohort.
  //   empty (no eligible value)   -> No calibration, "empty cohort" (never U = 1)
  //   only zeros                  -> zero-only (a measured all-zero cohort is a valid calibration)
  //   otherwise                   -> U = the largest magnitude, k = the Type-7 median of the nonzero
  //                                  magnitudes; an all-equal cohort gives U = k (it maps to the maximum)
  // Signed fits pool the magnitudes of BOTH signs into one (U, k) (DR-09): the sign only selects the arm,
  // so neither side is systematically stronger. Unsigned fits take values >= 0 and leave negatives out (E.cohort
  // counts them). Non-finite values are never members (E.cohort counts those too); they are skipped here
  // as well so a stray NaN cannot poison the sort.
  function sclFitValue(cohort, opts = {}) {
    const signed = Boolean(opts && opts.signed);
    const linear = Boolean(opts && opts.linear);
    const values = sclValuesOf(cohort);
    const mags = new Float64Array(values.length);
    let nonzero = 0;
    let eligible = 0;
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (!sclIsNumber(x)) continue;
      if (x < 0 && !signed) continue;
      eligible++;
      if (x !== 0) mags[nonzero++] = x < 0 ? -x : x;
    }
    if (eligible === 0) return sclNoCalibration("empty cohort");
    if (nonzero === 0) return { state: "ok", descriptor: sclZeroOnly(signed) };
    const sorted = mags.subarray(0, nonzero);
    sorted.sort();
    const U = sorted[nonzero - 1];
    // Type-7 median: for an even count the mean of the two middle values; for equal magnitudes it is that
    // magnitude, so an all-equal cohort needs no branch of its own.
    const k = API.util.median7(sorted);
    const descriptor = linear ? sclMake("value-linear", signed, { U }, "value-fit@1") : sclMake("value-log1p", signed, { U, k }, "value-fit@1");
    return { state: "ok", descriptor };
  }

  // E.scale.fitRank (API.md A.3, C.3, DD-09, S1-077..080): the 257-knot Type-7 quantile approximation of
  // the finite POSITIVE values of a cohort (zeros are separately keyed and must not compress the low end;
  // rank is offered only for unsigned unbounded measures). knots[j] is the Type-7 quantile at q = j/256,
  // made non-decreasing after rounding. It is an APPROXIMATION and says so (algorithm "type7-257@1"): it is
  // not an exact empirical midrank between knots. An empty positive set is No calibration (C.3 literally).
  function sclFitRank(cohort) {
    const values = sclValuesOf(cohort);
    const buf = new Float64Array(values.length);
    let n = 0;
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (sclIsNumber(x) && x > 0) buf[n++] = x;
    }
    if (n === 0) return sclNoCalibration("empty cohort");
    const s = buf.subarray(0, n);
    s.sort();
    const knots = [];
    for (let j = 0; j < LIMITS.RANK_KNOTS; j++) {
      // The one quantile routine of the module (DD-10): q = j/256 is exact in binary, so h = (N-1)q is the
      // exact ((N-1)*j)/256 of the specification. The clamp keeps interpolation rounding inside the two
      // sample values it lies between, and the running maximum keeps the table non-decreasing.
      let v = API.util.quantile7(s, j / 256);
      const lo = Math.floor(((n - 1) * j) / 256);
      if (lo < n - 1) {
        if (v < s[lo]) v = s[lo];
        else if (v > s[lo + 1]) v = s[lo + 1];
      }
      if (j > 0 && v < knots[j - 1]) v = knots[j - 1];
      knots.push(v);
    }
    return { state: "ok", descriptor: sclMake("rank-type7-257", false, { knots, q: "j/256" }, "type7-257@1") };
  }

  // The reason a manual share window is refused for a fixed kind, or null when it is fine (DD-66). A window
  // is [lo, hi] as S.scale.window stores it. A Taker-flow window must stay symmetric about 0.5 so its sign
  // arms and its midpoint survive (a "narrowed" asymmetric window would silently move the midpoint).
  function sclWindowProblem(kind, win) {
    if (!Array.isArray(win) || win.length !== 2 || !sclIsNumber(win[0]) || !sclIsNumber(win[1])) return "a window is two finite numbers [lo, hi]";
    const lo = win[0];
    const hi = win[1];
    if (!(lo >= 0 && hi <= 1 && lo < hi)) return "a window must satisfy 0 <= lo < hi <= 1";
    if (kind === "share-diverging") {
      if (Math.abs(lo + hi - 1) > 1e-12) return "a Taker flow window must be symmetric about 0.5 (lo + hi = 1)";
      if (!(lo > 0)) return "a Taker flow window must be narrower than 0..1";
    }
    return null;
  }

  // E.scale.fixed (API.md A.3, B.5, C.5, DD-07, DD-66): the fixed descriptors, shared by every measure that
  // uses them (units are not in the id):
  //   share-diverging  Taker shares, sign arms about 0.5: fixed-diverging {lo:0, hi:1, mid:0.5}
  //   unsigned-share   Dwell, an unsigned 0..100 % share: fixed-linear {lo:0, hi:1}
  //   log2-ratio       Cascade, Efficiency, Relative volume: fixed-diverging {lo:-2, hi:2, mid:0}
  // The optional manual window keeps the measure's KIND. A share-diverging window stays fixed-diverging with
  // mid 0.5 (never fixed-linear: the arms and the midpoint must survive); an unsigned-share window is
  // fixed-linear {lo, hi}. The pair is used as given, so the descriptor carries exactly the decimals the
  // user typed and an address round-trips them. An invalid window THROWS a RangeError whose message is the
  // reason (callers validate first and show it; a bad window is a programming error here, not data).
  function sclFixed(kind, win) {
    const given = win !== undefined && win !== null;
    if (kind === "share-diverging") {
      if (!given) return sclMake("fixed-diverging", true, { lo: 0, hi: 1, mid: 0.5 }, "fixed@1");
      const problem = sclWindowProblem(kind, win);
      if (problem) throw new RangeError(problem);
      return sclMake("fixed-diverging", true, { lo: win[0], hi: win[1], mid: 0.5 }, "fixed@1");
    }
    if (kind === "unsigned-share") {
      if (!given) return sclMake("fixed-linear", false, { lo: 0, hi: 1 }, "fixed@1");
      const problem = sclWindowProblem(kind, win);
      if (problem) throw new RangeError(problem);
      return sclMake("fixed-linear", false, { lo: win[0], hi: win[1] }, "fixed@1");
    }
    if (kind === "log2-ratio") {
      if (given) throw new RangeError("the log2 ratio has a fixed -2..2 domain and no manual window");
      return sclMake("fixed-diverging", true, { lo: -2, hi: 2, mid: 0 }, "fixed@1");
    }
    throw new RangeError("unknown fixed kind: " + String(kind));
  }

  // E.scale.manual (API.md A.3, C.9, A-17): a mapping the user typed. Value kinds need finite positive U
  // (and k for log1p, with k <= U as every fit gives); window kinds need lo < hi. Answers a Fit with
  // origin "manual"; a refused input is {state:"no-calibration", descriptor:null, reason}, so a form can
  // show the reason without a try/catch. The mapping id ignores the origin (it hashes the numbers only).
  function sclManual(spec) {
    const refuse = (reason) => ({ state: "no-calibration", descriptor: null, reason, origin: "manual" });
    if (!sclIsObject(spec)) return refuse("a manual domain is an object");
    const kind = spec.kind;
    const signed = Boolean(spec.signed);
    if (kind === "value-log1p" || kind === "value-linear") {
      if (!sclIsNumber(spec.U) || !(spec.U > 0)) return refuse("U must be a finite positive number");
      if (kind === "value-linear") return { state: "ok", descriptor: sclMake(kind, signed, { U: spec.U }, "manual@1"), origin: "manual" };
      if (!sclIsNumber(spec.k) || !(spec.k > 0)) return refuse("k must be a finite positive number");
      if (spec.k > spec.U) return refuse("k must not exceed U");
      if (!Number.isFinite(spec.U / spec.k)) return refuse("U / k is too large");
      return { state: "ok", descriptor: sclMake(kind, signed, { U: spec.U, k: spec.k }, "manual@1"), origin: "manual" };
    }
    if (kind === "fixed-linear" || kind === "fixed-diverging") {
      if (!sclIsNumber(spec.lo) || !sclIsNumber(spec.hi) || !(spec.lo < spec.hi)) return refuse("lo must be below hi (both finite)");
      if (kind === "fixed-linear") {
        if (signed) return refuse("a linear window is unsigned");
        return { state: "ok", descriptor: sclMake(kind, false, { lo: spec.lo, hi: spec.hi }, "manual@1"), origin: "manual" };
      }
      const mid = spec.mid === undefined ? (spec.lo + spec.hi) / 2 : spec.mid;
      if (!sclIsNumber(mid) || !(spec.lo < mid && mid < spec.hi)) return refuse("mid must lie strictly between lo and hi");
      return { state: "ok", descriptor: sclMake(kind, true, { lo: spec.lo, hi: spec.hi, mid }, "manual@1"), origin: "manual" };
    }
    return refuse("a manual domain is value-log1p, value-linear, fixed-linear or fixed-diverging");
  }

  // The params a kind may carry, checked by `validate`: exact key sets, finite numbers, the ordering rules
  // of B.5. Returns {reason, path} for the first failure or null. `path` is relative to the descriptor.
  function sclParamsProblem(kind, p) {
    const has = (names) => {
      if (!sclIsObject(p)) return { reason: "params must be an object", path: "params" };
      const keys = Object.keys(p);
      for (let i = 0; i < keys.length; i++) if (names.indexOf(keys[i]) < 0) return { reason: "unknown parameter", path: "params." + keys[i] };
      for (let i = 0; i < names.length; i++) if (!Object.prototype.hasOwnProperty.call(p, names[i])) return { reason: "missing parameter", path: "params." + names[i] };
      for (let i = 0; i < names.length; i++) {
        if (names[i] === "q" || names[i] === "knots") continue;
        if (!sclIsNumber(p[names[i]])) return { reason: "must be a finite number", path: "params." + names[i] };
      }
      return null;
    };
    let bad;
    switch (kind) {
      case "value-log1p":
        bad = has(["U", "k"]);
        if (bad) return bad;
        if (!(p.k > 0)) return { reason: "k must be positive", path: "params.k" };
        if (!(p.U > 0)) return { reason: "U must be positive", path: "params.U" };
        if (p.k > p.U) return { reason: "k must not exceed U", path: "params.k" };
        if (!Number.isFinite(p.U / p.k)) return { reason: "U / k is too large", path: "params.U" };
        return null;
      case "value-linear":
        bad = has(["U"]);
        if (bad) return bad;
        return p.U > 0 ? null : { reason: "U must be positive", path: "params.U" };
      case "rank-type7-257": {
        bad = has(["knots", "q"]);
        if (bad) return bad;
        if (p.q !== "j/256") return { reason: "q must be j/256", path: "params.q" };
        if (!Array.isArray(p.knots)) return { reason: "knots must be an array", path: "params.knots" };
        if (p.knots.length !== LIMITS.RANK_KNOTS) return { reason: "knots must hold exactly " + LIMITS.RANK_KNOTS + " values", path: "params.knots" };
        for (let i = 0; i < p.knots.length; i++) {
          if (!sclIsNumber(p.knots[i])) return { reason: "a knot must be a finite number", path: "params.knots[" + i + "]" };
          if (i > 0 && p.knots[i] < p.knots[i - 1]) return { reason: "knots must not decrease", path: "params.knots[" + i + "]" };
        }
        return null;
      }
      case "fixed-linear":
      case "axis-linear":
        bad = has(["lo", "hi"]);
        if (bad) return bad;
        return p.lo < p.hi ? null : { reason: "lo must be below hi", path: "params.lo" };
      case "fixed-diverging":
        bad = has(["lo", "hi", "mid"]);
        if (bad) return bad;
        return p.lo < p.mid && p.mid < p.hi ? null : { reason: "lo < mid < hi is required", path: "params.mid" };
      default:
        return p === null ? null : { reason: "this kind has no parameters", path: "params" };
    }
  }

  // E.scale.validate (API.md A.3, D9, S1-164): validation of ONE descriptor, as an import needs it. Returns
  // {ok:true} or {ok:false, reason, path} naming the first failure (path is where, e.g. "params.knots[17]").
  // It checks the version, the kind, the signedness each kind requires, the clip policy, exact parameter
  // sets, finite positive U and k with k <= U, exactly 257 non-decreasing finite rank knots, and that the
  // id, when present, equals the recomputed id. opts.requireId makes a missing id a failure too (an
  // imported record must carry one); a descriptor made here always has one.
  function sclValidate(desc, opts = {}) {
    const bad = (reason, path) => ({ ok: false, reason, path });
    if (!sclIsObject(desc)) return bad("a descriptor must be an object", "$");
    const keys = Object.keys(desc);
    for (let i = 0; i < keys.length; i++) if (sclFields.indexOf(keys[i]) < 0) return bad("unknown field", keys[i]);
    if (desc.v !== VERSION.mapping) return bad("unknown mapping version", "v");
    if (typeof desc.kind !== "string" || sclKinds.indexOf(desc.kind) < 0) return bad("unknown kind", "kind");
    if (typeof desc.signed !== "boolean") return bad("signed must be true or false", "signed");
    if (desc.kind === "rank-type7-257" && desc.signed) return bad("rank is unsigned", "signed");
    if (desc.kind === "fixed-linear" && desc.signed) return bad("a linear window is unsigned", "signed");
    if (desc.kind === "fixed-diverging" && !desc.signed) return bad("a diverging mapping is signed", "signed");
    if (desc.clip !== (desc.kind === "axis-linear" ? "axis@1" : "clamp01@1")) return bad("unknown clip policy for this kind", "clip");
    const problem = sclParamsProblem(desc.kind, desc.params);
    if (problem) return bad(problem.reason, problem.path);
    if (desc.algorithm !== undefined && (typeof desc.algorithm !== "string" || desc.algorithm.length > LIMITS.STRING_MAX)) return bad("algorithm must be a short string", "algorithm");
    if (desc.id === undefined) return opts && opts.requireId ? bad("the id is missing", "id") : { ok: true };
    if (typeof desc.id !== "string" || desc.id !== sclId(desc)) return bad("the id does not match the mapping", "id");
    return { ok: true };
  }

  // E.scale.index (API.md A.3): the LUT index of a coordinate, round(clamp(|t|, 0, 1) * 255), ties up
  // (Math.round). The sign selects the arm elsewhere, so only |t| counts. Written without helpers so the
  // hot path is one call: NaN falls out at 0 rather than at a plausible colour.
  function sclIndex(t) {
    const a = t < 0 ? -t : t;
    return a >= 1 ? 255 : a > 0 ? Math.round(a * 255) : 0;
  }

  // ---- evaluators (E.scale.plan): each writes out.t, out.clip and out.state and returns out ----------
  // Contract of every evaluator: x is a finite measured value (typed non-values never reach a mapping); a
  // NaN answers t = NaN so a caller bug is visible instead of coloured. out.state is reset on every call
  // (null, or "out-of-domain" / "no-calibration"), so a reused `out` never carries a stale state.

  // Value, log1p arm (C.4): t = log1p(|x|/k) / log1p(U/k). The denominator is computed ONCE per plan and
  // DIVIDED by (never multiplied by its reciprocal), so t(U) is exactly 1: the same expression divided by
  // itself. Overflow is decided in VALUE space (|x| > U), not on t, so a rounding of log1p can never
  // produce a false overflow; the drawing coordinate is clipped to 1, the raw value stays with the caller.
  function sclLogEvaluator(signed, U, k) {
    const denom = Math.log1p(U / k);
    return function (x, out) {
      const a = x < 0 ? -x : x;
      out.state = null;
      if (a === 0) {
        out.t = 0;
        out.clip = sclNone;
        return out;
      }
      let t = Math.log1p(a / k) / denom;
      if (a > U) {
        out.clip = sclHigh;
        t = 1;
      } else {
        out.clip = a === U ? sclExactHigh : sclNone;
        if (t > 1) t = 1;
      }
      out.t = signed && x < 0 ? -t : t;
      return out;
    };
  }

  // Value, linear alternative (D3): t = |x| / U, the same overflow rule.
  function sclLinearEvaluator(signed, U) {
    return function (x, out) {
      const a = x < 0 ? -x : x;
      out.state = null;
      if (a === 0) {
        out.t = 0;
        out.clip = sclNone;
        return out;
      }
      let t = a / U;
      if (a > U) {
        out.clip = sclHigh;
        t = 1;
      } else {
        out.clip = a === U ? sclExactHigh : sclNone;
        if (t > 1) t = 1;
      }
      out.t = signed && x < 0 ? -t : t;
      return out;
    };
  }

  // Rank (C.3): two bisections over the 257 knots per value. An exact repeated value maps to the midpoint
  // of its group's first and last q; a value between distinct knots interpolates from the lower group's
  // last q to the upper group's first q; outside the support it maps to 0 or 1 WITH an indication (LOW or
  // HIGH). An all-equal cohort (every knot the same) maps its value to 0.5 through the same first rule
  // (first q 0, last q 256) and everything else to an end with an indication.
  // A measured ZERO is not below the support: the knots are of the positive values only (zeros are
  // separately keyed, DD-09), so a zero maps to 0 WITHOUT an indication, exactly as under Value. Otherwise
  // every sparse view would count its empty cells as "out of range" and raise Scale range exceeded.
  function sclRankEvaluator(knots) {
    const lowerBound = API.util.lowerBound;
    const upperBound = API.util.upperBound;
    const lo = knots[0];
    const hi = knots[knots.length - 1];
    return function (x, out) {
      out.state = null;
      if (x === 0) {
        out.t = 0;
        out.clip = sclNone;
        return out;
      }
      if (x < lo) {
        out.t = 0;
        out.clip = sclLow;
        return out;
      }
      if (x > hi) {
        out.t = 1;
        out.clip = sclHigh;
        return out;
      }
      const i1 = lowerBound(knots, x);
      const i2 = upperBound(knots, x);
      out.clip = sclNone;
      if (i1 < i2) {
        out.t = (i1 + (i2 - 1)) / 512;
      } else {
        // knots[i1-1] < x < knots[i1]: the two groups' facing indices are i1-1 and i1 (one q apart).
        const a = knots[i1 - 1];
        out.t = (i1 - 1 + (x - a) / (knots[i1] - a)) / 256;
      }
      return out;
    };
  }

  // A fixed unsigned window (C.5), also the coordinate along an axis window (kind axis-linear, where t is
  // the position between lo and hi, whatever the axis's sign). Below lo and above hi the coordinate is the
  // end and the mark is counted (LOW/HIGH); exactly on an endpoint it is EXACT_*, drawn at the end and not
  // counted as out of range.
  function sclWindowEvaluator(lo, hi) {
    const span = hi - lo;
    return function (x, out) {
      out.state = null;
      if (x < lo) {
        out.t = 0;
        out.clip = sclLow;
      } else if (x > hi) {
        out.t = 1;
        out.clip = sclHigh;
      } else if (x === lo) {
        out.t = 0;
        out.clip = sclExactLow;
      } else if (x === hi) {
        out.t = 1;
        out.clip = sclExactHigh;
      } else {
        out.t = (x - lo) / span;
        out.clip = sclNone;
      }
      return out;
    };
  }

  // A fixed diverging window (C.5): t in [-1, 1], the arm chosen by the side of `mid`, each arm scaled by
  // its own half-width so a manual window keeps its midpoint. The midpoint is exactly 0 (never -0).
  function sclDivergingEvaluator(lo, hi, mid) {
    const upper = hi - mid;
    const lower = mid - lo;
    return function (x, out) {
      out.state = null;
      if (x < lo) {
        out.t = -1;
        out.clip = sclLow;
      } else if (x > hi) {
        out.t = 1;
        out.clip = sclHigh;
      } else if (x === lo) {
        out.t = -1;
        out.clip = sclExactLow;
      } else if (x === hi) {
        out.t = 1;
        out.clip = sclExactHigh;
      } else {
        out.t = x >= mid ? (x - mid) / upper : (x - mid) / lower;
        out.clip = sclNone;
      }
      return out;
    };
  }

  // Zero-only (C.4, DD-95): a measured zero is fine; any other value is out of domain until a fit
  // replaces this calibration. It is clipped (HIGH, on its own side for a signed mapping), flagged with
  // state "out-of-domain" and therefore COUNTED by the warning tally, never silently coloured.
  function sclZeroEvaluator(signed) {
    return function (x, out) {
      if (x === 0) {
        out.t = 0;
        out.clip = sclNone;
        out.state = null;
      } else {
        out.t = signed && x < 0 ? -1 : 1;
        out.clip = sclHigh;
        out.state = "out-of-domain";
      }
      return out;
    };
  }

  function sclNoneEvaluator(x, out) {
    out.t = 0;
    out.clip = sclNone;
    out.state = "no-calibration";
    return out;
  }

  function sclBuildPlan(desc) {
    const p = desc.params;
    let evaluate;
    switch (desc.kind) {
      case "value-log1p":
        evaluate = sclLogEvaluator(desc.signed, p.U, p.k);
        break;
      case "value-linear":
        evaluate = sclLinearEvaluator(desc.signed, p.U);
        break;
      case "rank-type7-257":
        if (!Array.isArray(p.knots) || p.knots.length !== LIMITS.RANK_KNOTS) throw new TypeError("plan: a rank descriptor needs " + LIMITS.RANK_KNOTS + " knots");
        evaluate = sclRankEvaluator(p.knots);
        break;
      case "fixed-linear":
      case "axis-linear":
        evaluate = sclWindowEvaluator(p.lo, p.hi);
        break;
      case "fixed-diverging":
        evaluate = sclDivergingEvaluator(p.lo, p.hi, p.mid);
        break;
      case "zero-only":
        evaluate = sclZeroEvaluator(desc.signed);
        break;
      case "none":
        evaluate = sclNoneEvaluator;
        break;
      default:
        throw new TypeError("plan: unknown descriptor kind " + String(desc.kind));
    }
    return Object.freeze({ signed: desc.signed, kind: desc.kind, apply: evaluate, index: sclIndex });
  }

  // E.scale.plan (API.md A.3, DD-44): the per-descriptor precomputed evaluator {signed, kind, apply(x, out),
  // index}. It captures 1/log1p(U/k), U, the rank arrays and the window once; a Frame holds the plan and
  // `encode` does no per-cell setup. Cached per descriptor OBJECT. It trusts the descriptor (`validate`
  // is the import gate) but refuses one it cannot evaluate.
  function sclPlan(desc) {
    if (desc === null || typeof desc !== "object") throw new TypeError("plan needs a descriptor object");
    let plan = sclPlans.get(desc);
    if (plan === undefined) {
      plan = sclBuildPlan(desc);
      sclPlans.set(desc, plan);
    }
    return plan;
  }

  // E.scale.apply (API.md A.3, C.4, C.5): the coordinate of one value. Writes out.t (0..1 unsigned, -1..1
  // signed), out.clip (CLIP) and out.state (null | "out-of-domain" | "no-calibration") and returns `out`.
  function sclApply(desc, x, out) {
    return sclPlan(desc).apply(x, out);
  }

  // E.scale.sameWithin (API.md A.3, C.10, DD-19): are two descriptors the same mapping within tolerance?
  // Auto uses it to KEEP its active descriptor when a refit differs only by last-bit jitter (a new id would
  // raise a spurious "Scale changed"). `a` is the active one. Same id, or same kind/signedness/clip and
  // every parameter (U, k, lo, hi, mid, or every rank knot) within THRESHOLDS.TOL_REL of a's own value.
  function sclSameWithin(a, b) {
    if (a === b) return true;
    if (!sclIsObject(a) || !sclIsObject(b)) return false;
    if (typeof a.id === "string" && a.id === b.id) return true;
    if (a.kind !== b.kind || a.signed !== b.signed || a.clip !== b.clip) return false;
    const pa = a.params;
    const pb = b.params;
    if (pa === null || pb === null) return pa === pb;
    if (!sclIsObject(pa) || !sclIsObject(pb)) return false;
    const near = (x, y) => sclIsNumber(x) && sclIsNumber(y) && Math.abs(x - y) <= THRESHOLDS.TOL_REL * Math.abs(x);
    const keys = Object.keys(pa);
    if (keys.length !== Object.keys(pb).length) return false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "knots") {
        if (!Array.isArray(pa.knots) || !Array.isArray(pb.knots) || pa.knots.length !== pb.knots.length) return false;
        for (let j = 0; j < pa.knots.length; j++) if (!near(pa.knots[j], pb.knots[j])) return false;
      } else if (key === "q") {
        if (pa.q !== pb.q) return false;
      } else if (!near(pa[key], pb[key])) {
        return false;
      }
    }
    return true;
  }

  // The context inside x: a Ctx itself, or the `ctx` of a Calibration; null for a bare descriptor.
  function sclCtxOf(x) {
    if (!sclIsObject(x)) return null;
    if (sclIsObject(x.ctx)) return x.ctx;
    return x.consumer !== undefined ? x : null;
  }

  function sclVersionOf(ctx) {
    const at = ctx && typeof ctx.formula === "string" ? ctx.formula.lastIndexOf("@") : -1;
    return at < 0 ? null : ctx.formula.slice(at + 1);
  }

  // E.scale.compat (API.md A.3, C.8, DR-07, S1-101..106): may a held (Comparison-lock) mapping serve this
  // other measure? Two contexts (or Calibrations, or bare descriptors) are compatible when their
  // compatibility classes are equal (E.context.compatClass: formula family, transform kind, signedness,
  // rank algorithm) and the formula versions agree. {ok:true}, or {ok:false, reason} with one of:
  // "amount vs intensity", "different formula family", "signed vs unsigned", "different transform",
  // "different rank algorithm", "different formula version". A bare descriptor carries no family or
  // version, so those two checks are skipped for it. Cells Amount and Rows Amount share a class: reuse is
  // allowed only through an explicit lock, which is the caller's rule, not this predicate's (S1-105).
  function sclCompat(a, b) {
    if (!API.context) throw new Error("E.scale.compat needs E.context (part 10-context)");
    const ka = API.context.compatClass(a).split("|");
    const kb = API.context.compatClass(b).split("|");
    const ca = sclCtxOf(a);
    const cb = sclCtxOf(b);
    if (ka[0] !== "-" && kb[0] !== "-" && ka[0] !== kb[0]) {
      const pair = ca && cb && ca.measure === cb.measure && ((ca.basis === "amount" && cb.basis === "intensity") || (ca.basis === "intensity" && cb.basis === "amount"));
      return { ok: false, reason: pair ? "amount vs intensity" : "different formula family" };
    }
    if (ka[2] !== kb[2]) return { ok: false, reason: "signed vs unsigned" };
    if (ka[1] !== kb[1]) return { ok: false, reason: "different transform" };
    if (ka[3] !== kb[3]) return { ok: false, reason: "different rank algorithm" };
    if (ca && cb && sclVersionOf(ca) !== sclVersionOf(cb)) return { ok: false, reason: "different formula version" };
    return { ok: true };
  }

  API.scale = Object.freeze({
    fitValue: sclFitValue,
    fitRank: sclFitRank,
    fixed: sclFixed,
    manual: sclManual,
    zeroOnly: sclZeroOnly,
    canonical: sclCanonical,
    id: sclId,
    validate: sclValidate,
    plan: sclPlan,
    apply: sclApply,
    CLIP: sclClip,
    index: sclIndex,
    sameWithin: sclSameWithin,
    compat: sclCompat,
  });
