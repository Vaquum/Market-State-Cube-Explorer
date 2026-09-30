  // @part 05-measure
  // @requires 01-util 03-result
  // @prefix msr
  // @provides measure
  // == §05 measure: what a cell, a column and an exposure measure (API.md B.3, B.4, C.1.1 to C.1.6) ==
  // Physical measurements only. A value leaves this part as a number in the unit the formula names (USDT,
  // trades, USDT per minute per 125-USDT band, row spans, seconds share, ...) or as a typed reason why there
  // is none (B.1). The scale coordinate and the colour are a later, separate step (S1-009): nothing here
  // knows a palette, a mapping or a theme.

  // Tag indexes of E.result.TAGS (part 03), captured at load time (03-result is in @requires) so the
  // per-cell kernel writes a small integer and never looks a tag up by name.
  const msrTag = API.result.TAG;
  const msrFinite = msrTag["finite"];
  const msrUndefined = msrTag["undefined"];
  const msrEmptyPop = msrTag["empty-population"];
  const msrHidden = msrTag["hidden"];
  const msrPending = msrTag["pending"];
  const msrFailed = msrTag["failed"];
  const msrUnsupported = msrTag["unsupported"];
  const msrInvalid = msrTag["invalid-input"];
  // D2 / DR-10: below this fraction of the nominal span a cell carries the Short exposure cue.
  const msrShortAt = THRESHOLDS.SHORT_EXPOSURE;
  // Intensity is a rate per MINUTE per 125-USDT band (D2). 125 is part of the unit's NAME, not the lattice:
  // the unit id "usdt-per-min-per-125usdt" would be a lie for any other band width, so it is not read from
  // the geometry the page hands in.
  const msrPerMinute = 60;
  const msrBandUsdt = 125;

  // Which exposure denominators a measure divides by (C.1.3, DD-70). Shared frozen objects: usesOf runs
  // per cell and must not allocate.
  const msrUsesNone = Object.freeze({ t: false, w: false });
  const msrUsesT = Object.freeze({ t: true, w: false });
  const msrUsesW = Object.freeze({ t: false, w: true });
  const msrUsesBoth = Object.freeze({ t: true, w: true });

  // ---- catalogues (B.3) -------------------------------------------------------------------------------

  function msrFormula(family, unit, signed, basisKind, version) {
    return Object.freeze({ family, unit, signed, basisKind, version });
  }

  // E.measure.FORMULAS (B.3, DD-06). `family` is what Comparison lock compares (A-18); it is null for the
  // measures whose transfer function is a fixed, absolute coordinate (shares, log ratios): there is nothing
  // to hold for them, the domain is part of the definition. The pane measures are bar lengths on their own
  // registered axes, not colour mappings, so they have no family either.
  const msrFormulas = Object.freeze({
    "cells.volume.amount@1": msrFormula("amount.usdt", "usdt", false, "amount", 1),
    "cells.trades.amount@1": msrFormula("amount.trades", "trades", false, "amount", 1),
    "cells.delta.amount@1": msrFormula("delta.usdt", "usdt", true, "amount", 1),
    "cells.volume.intensity@1": msrFormula("intensity.usdt", "usdt-per-min-per-125usdt", false, "intensity", 1),
    "cells.trades.intensity@1": msrFormula("intensity.trades", "trades-per-min-per-125usdt", false, "intensity", 1),
    "cells.delta.intensity@1": msrFormula("intensity.delta", "usdt-per-min-per-125usdt", true, "intensity", 1),
    "cells.size.mean@1": msrFormula("size.usdt-per-trade", "usdt-per-trade", false, "mean", 1),
    "cells.path.spans@1": msrFormula("path.spans", "row-spans", false, "row-spans", 1),
    "cells.path.usdt@1": msrFormula("path.usdt", "usdt", false, "usdt-moved", 1),
    "cells.path.perminute@1": msrFormula("path.perminute", "row-spans-per-min", false, "row-spans-per-min", 1),
    "cells.dwell.share@1": msrFormula(null, "share", false, "share", 1),
    "cells.flow.share@1": msrFormula(null, "share", true, "share", 1),
    "cells.flowtrades.share@1": msrFormula(null, "share", true, "share", 1),
    "cells.cascade.log2@1": msrFormula(null, "log2-ratio", true, "log2-ratio", 1),
    "rows.volume.amount@1": msrFormula("amount.usdt", "usdt", false, "period-amount-per-row", 1),
    "rows.delta.amount@1": msrFormula("delta.usdt", "usdt", true, "period-amount-per-row", 1),
    "rows.time.seconds@1": msrFormula("time.seconds", "seconds", false, "period-amount-per-row", 1),
    // The one formula that is at version 2: the spec names v2, v1 is the retired baseline behaviour (DD-06).
    "rows.relvol@2": msrFormula(null, "log2-ratio", true, "log2-ratio", 2),
    "columns.volume@1": msrFormula(null, "usdt", false, "amount", 1),
    "columns.delta@1": msrFormula(null, "usdt", true, "amount", 1),
    "columns.takertrades@1": msrFormula(null, "trades", true, "amount", 1),
    "columns.trades@1": msrFormula(null, "trades", false, "amount", 1),
    "columns.size@1": msrFormula(null, "usdt-per-trade", false, "mean", 1),
    "columns.choppiness@1": msrFormula(null, "path-per-range", false, "ratio", 1),
    "columns.perpath@1": msrFormula(null, "usdt-per-usdt-moved", false, "ratio", 1),
    "columns.cascade@1": msrFormula(null, "log2-ratio", true, "ratio", 1),
    "columns.efficiency@1": msrFormula(null, "log2-ratio", true, "ratio", 1),
    "osc.rsi14@1": msrFormula(null, "index", false, "oscillator", 1),
    "osc.macd@1": msrFormula(null, "usdt", true, "oscillator", 1),
  });

  function msrMode(kind, signed, bases, rank, fixed) {
    return Object.freeze({ kind, signed, bases: Object.freeze(bases), rank, fixed: fixed === null ? null : Object.freeze(fixed) });
  }

  // E.measure.MODES (B.3): what each S.mode is and which controls it can meaningfully offer. `signed` is
  // true for the measures drawn on two arms about a midpoint (Delta, both taker shares, Cascade). `fixed`
  // names the absolute descriptor of a fixed measure in the vocabulary of E.scale.fixed (C.5).
  const msrModes = Object.freeze({
    volume: msrMode("unbounded", false, ["amount", "intensity"], true, null),
    trades: msrMode("unbounded", false, ["amount", "intensity"], true, null),
    delta: msrMode("unbounded", true, ["amount", "intensity"], false, null),
    size: msrMode("unbounded", false, ["mean"], true, null),
    path: msrMode("unbounded", false, ["spans", "usdt", "perMinute"], true, null),
    flow: msrMode("fixed", true, ["share"], false, { kind: "share-diverging", lo: 0, hi: 1, mid: 0.5 }),
    flowtrades: msrMode("fixed", true, ["share"], false, { kind: "share-diverging", lo: 0, hi: 1, mid: 0.5 }),
    dwell: msrMode("fixed", false, ["share"], false, { kind: "unsigned-share", lo: 0, hi: 1 }),
    cascade: msrMode("fixed", true, ["log2"], false, { kind: "log2-ratio", lo: -2, hi: 2, mid: 0 }),
    geometry: msrMode("occupancy", false, [], false, null),
  });

  // E.measure.ROWS (DD-73): the Rows measures, so the menu and E.policy.offers("rows", ...) hard-code
  // nothing. Relative volume is fixed and diverging; Delta has no rank (signed).
  const msrRows = Object.freeze({
    volume: Object.freeze({ kind: "unbounded", signed: false, rank: true, formula: "rows.volume.amount@1", fixed: null }),
    delta: Object.freeze({ kind: "unbounded", signed: true, rank: false, formula: "rows.delta.amount@1", fixed: null }),
    time: Object.freeze({ kind: "unbounded", signed: false, rank: true, formula: "rows.time.seconds@1", fixed: null }),
    relvol: Object.freeze({
      kind: "fixed",
      signed: true,
      rank: false,
      formula: "rows.relvol@2",
      fixed: Object.freeze({ kind: "log2-ratio", lo: -2, hi: 2, mid: 0 }),
    }),
  });

  // The formula id of a (mode, basis) pair. Path takes its variant from `pathBasis`, the amount measures
  // from `basis`; every other mode has one formula.
  const msrCellFormulas = Object.freeze({
    "volume|amount": "cells.volume.amount@1",
    "volume|intensity": "cells.volume.intensity@1",
    "trades|amount": "cells.trades.amount@1",
    "trades|intensity": "cells.trades.intensity@1",
    "delta|amount": "cells.delta.amount@1",
    "delta|intensity": "cells.delta.intensity@1",
    "size|mean": "cells.size.mean@1",
    "path|spans": "cells.path.spans@1",
    "path|usdt": "cells.path.usdt@1",
    "path|perMinute": "cells.path.perminute@1",
    "dwell|share": "cells.dwell.share@1",
    "flow|share": "cells.flow.share@1",
    "flowtrades|share": "cells.flowtrades.share@1",
    "cascade|log2": "cells.cascade.log2@1",
  });

  // The basis a kernel evaluates: Path variants live in pathBasis, the amount measures in basis (anything
  // but "intensity" reads as Amount, so a stale preference from another measure cannot break a cell), the
  // single-basis measures have no choice.
  function msrBasisOf(mode, basis, pathBasis) {
    if (mode === "path") return pathBasis === "usdt" || pathBasis === "perMinute" ? pathBasis : "spans";
    if (mode === "volume" || mode === "trades" || mode === "delta") return basis === "intensity" ? "intensity" : "amount";
    if (mode === "size") return "mean";
    if (mode === "dwell" || mode === "flow" || mode === "flowtrades") return "share";
    if (mode === "cascade") return "log2";
    return null;
  }

  // ---- tolerance helpers (C.1.1, DD-36) ---------------------------------------------------------------
  // For comparing two measurements of the same thing (tests, equivalence checks). They are never applied
  // to an input: a value is stored and drawn exactly as measured.

  function msrEpsUsdt(x) {
    return THRESHOLDS.TOL_REL * Math.abs(x) + THRESHOLDS.TOL_USDT;
  }

  function msrEpsPath(x) {
    return THRESHOLDS.TOL_REL * Math.abs(x) + THRESHOLDS.TOL_PATH;
  }

  function msrEpsSeconds(x) {
    return THRESHOLDS.TOL_REL * Math.abs(x) + THRESHOLDS.TOL_SECONDS;
  }

  function msrCloseUsdt(a, b) {
    return Math.abs(a - b) <= THRESHOLDS.TOL_REL * Math.max(Math.abs(a), Math.abs(b)) + THRESHOLDS.TOL_USDT;
  }

  function msrClosePath(a, b) {
    return Math.abs(a - b) <= THRESHOLDS.TOL_REL * Math.max(Math.abs(a), Math.abs(b)) + THRESHOLDS.TOL_PATH;
  }

  function msrCloseSeconds(a, b) {
    return Math.abs(a - b) <= THRESHOLDS.TOL_REL * Math.max(Math.abs(a), Math.abs(b)) + THRESHOLDS.TOL_SECONDS;
  }

  // The error bound that Delta = 2*bv - v inherits from its two inputs (A-35). A near-balanced cell is a
  // cancellation: the relative error of the result is unbounded, the absolute error is not, so Delta is
  // compared against THIS bound and never with a relative tolerance on the (nearly zero) result.
  function msrDeltaEps(bv, v) {
    return 2 * msrEpsUsdt(bv) + msrEpsUsdt(v);
  }

  // The same for log2(v / V): the relative errors of the two amounts, in log2 units.
  function msrLog2Eps(v, V) {
    return (msrEpsUsdt(v) / v + msrEpsUsdt(V) / V) / Math.LN2;
  }

  // close.delta(a, b, bv, v): are two Delta values within the bound propagated from the inputs (bv, v) of
  // the reference record? close.log2(a, b, v, V): the same for a log2 ratio of two amounts.
  const msrClose = Object.freeze({
    usdt: msrCloseUsdt,
    path: msrClosePath,
    seconds: msrCloseSeconds,
    delta: (a, b, bv, v) => Math.abs(a - b) <= msrDeltaEps(bv, v),
    log2: (a, b, v, V) => Math.abs(a - b) <= msrLog2Eps(v, V),
    epsUsdt: msrEpsUsdt,
    epsPath: msrEpsPath,
    epsSeconds: msrEpsSeconds,
    deltaEps: msrDeltaEps,
    log2Eps: msrLog2Eps,
  });

  // ---- exposure (C.1.3, B.4) --------------------------------------------------------------------------

  function msrNewExposure() {
    return {
      seconds: 0,
      width: 0,
      timeFraction: 1,
      priceFraction: 1,
      nominalSeconds: 0,
      nominalWidth: 0,
      short: false,
      uses: msrUsesNone,
      coverage: "range",
      coveredTo: null,
    };
  }

  // E.measure.exposure (API.md C.1.3): the part of a cell that was actually observed. `b` = [t0, t1, r0, r1]
  // in base units (the measured rectangle), `cut` the activeCutoff in base units, `end` the last column a
  // motion measure covers (Infinity for the volume measures), `ts`/`ps` the EFFECTIVE step of the drawn
  // level in base units (2**n, 2**m), `geom` = {BASE, PR}. Time is clipped to the rectangle, the cutoff and
  // the motion end; price to the rectangle. The two fractions are taken in base units (covered / step)
  // rather than as seconds over nominal seconds: a step is a power of two, so the division is exact and a
  // covered span of 1.6 base columns on a 16-column cell is exactly 0.1, never 0.09999999999999999 through
  // the detour over BASE. `short` and `uses` describe a MEASURE, not a cell, and are set by cellValue and
  // cellMeasurement; this function leaves them neutral (false, no denominators). Reuses `out` when given
  // (no allocation), which is what the per-cell kernel does.
  function msrExposure(z, b, cut, end, ts, ps, geom, out) {
    const g = geom || LATTICE;
    const o = out || msrNewExposure();
    const dt = Math.max(0, Math.min((z.c + 1) * ts, b[1], cut, end) - Math.max(z.c * ts, b[0]));
    const dp = Math.max(0, Math.min((z.r + 1) * ps, b[3]) - Math.max(z.r * ps, b[2]));
    o.seconds = dt * g.BASE;
    o.width = dp * g.PR;
    o.nominalSeconds = ts * g.BASE;
    o.nominalWidth = ps * g.PR;
    o.timeFraction = dt / ts;
    o.priceFraction = dp / ps;
    o.short = false;
    o.uses = msrUsesNone;
    o.coverage = "range";
    o.coveredTo = end === Infinity ? null : "end";
    return o;
  }

  // E.measure.usesOf (API.md C.1.3, DD-70): does a measure divide by covered time (t), by measured price
  // width (w), by neither? Its only job is to say WHETHER the Short exposure label applies to the measure
  // at all ("any measure with an exposure denominator", DR-10): Intensity {t,w}, Path spans {w}, Path per
  // minute {t,w}, Dwell {t}; Path USDT and every Amount never carry the label. `basis` is the amount basis
  // for volume, trades and delta and the Path variant for path.
  function msrUsesOf(measureKey, basis) {
    if (measureKey === "volume" || measureKey === "trades" || measureKey === "delta") return basis === "intensity" ? msrUsesBoth : msrUsesNone;
    if (measureKey === "path") return basis === "perMinute" ? msrUsesBoth : basis === "usdt" ? msrUsesNone : msrUsesW;
    if (measureKey === "dwell") return msrUsesT;
    return msrUsesNone;
  }

  // E.measure.isShort (API.md C.1.3, DD-70): strictly below 10% of the nominal span on EITHER fraction, for a
  // measure that has an exposure denominator at all. A Dwell cell with a full time fraction and a price
  // fraction of 0.05 IS short: DR-10 says "on either", and the first design that tested only the fractions
  // a measure "used" silently narrowed it.
  function msrIsShort(exposure, uses) {
    return (uses.t || uses.w) && (exposure.timeFraction < msrShortAt || exposure.priceFraction < msrShortAt);
  }

  // E.measure.cellState (API.md C.1.3): the one shared predicate for a cell's finality. `open`: the cell's
  // column runs past the live edge (never in replay, where the edge is a choice). `portion`: the cell sticks
  // out of the measured rectangle, so its value is that of a part. `partial`: portion, or it runs past the
  // cutoff. The baseline had this twice (cellState and querySummary) and the two could drift.
  function msrCellState(z, b, cut, CUT, replay, ts, ps) {
    const open = !replay && (z.c + 1) * ts > CUT;
    const portion = z.c * ts < b[0] || (z.c + 1) * ts > b[1] || z.r * ps < b[2] || (z.r + 1) * ps > b[3];
    return { open, portion, partial: portion || (z.c + 1) * ts > cut };
  }

  // ---- typed results without allocation (the hot path) ------------------------------------------------

  // A reason from a cube error message can be longer than a Typed allows (B.1); cut it here, off the hot
  // path, exactly as part 03 does. Rare: only a failed read carries a long string.
  function msrClipReason(s) {
    return s.length <= LIMITS.STRING_MAX ? s : s.slice(0, LIMITS.STRING_MAX - 3) + "...";
  }

  // Write a non-value into a caller-owned scratch object: an integer tag, the interned reason or
  // denominator (or null), and NaN for the value so a consumer that forgets to test the tag cannot draw a
  // plausible number (baseline gotcha: a NaN colour keeps the previous fillStyle; here that would at least
  // be visible in a test, where a silent 0 would not).
  function msrSetTyped(out, tag, reason, denominator) {
    out.tag = tag;
    out.value = NaN;
    out.reason = reason;
    out.denominator = denominator;
    return out;
  }

  // A measured number: finite -> a value; anything else -> invalid-input "non-finite", never clamped and
  // never a NaN fill (D2, DR-12).
  function msrSetValue(out, x) {
    if (Number.isFinite(x)) {
      out.tag = msrFinite;
      out.value = x;
      out.reason = null;
      out.denominator = null;
      return out;
    }
    return msrSetTyped(out, msrInvalid, "non-finite", null);
  }

  // Read and coverage status BEFORE mathematics (API.md C.1.2, DD-05), allocation-free. `read` is null once
  // every read the consumer needs has answered. Returns true when it wrote a result.
  function msrReadStatus(read, out) {
    if (!read) return false;
    const state = read.state;
    if (state === "failed") {
      msrSetTyped(out, msrFailed, typeof read.reason === "string" ? msrClipReason(read.reason) : "read failed", null);
      return true;
    }
    if (state === "pending") {
      msrSetTyped(out, msrPending, typeof read.reason === "string" ? read.reason : "reading", null);
      return true;
    }
    if (state === "unsupported") {
      msrSetTyped(out, msrUnsupported, typeof read.reason === "string" ? read.reason : "not supported", null);
      return true;
    }
    return false;
  }

  function msrTs(k) {
    return k.ts !== undefined ? k.ts : Math.pow(2, k.level.n);
  }

  function msrPs(k) {
    return k.ps !== undefined ? k.ps : Math.pow(2, k.level.m);
  }

  // The kernel's exposure for the cell in `k.z`: covered seconds and measured width inside the rectangle,
  // the cutoff and (for the motion measures) the motion end. Fills and returns the kernel's ONE scratch
  // exposure object, created on first use.
  function msrKernelExposure(k, end) {
    const ex = k.exposure || (k.exposure = msrNewExposure());
    return msrExposure(k.z, k.bounds, k.cut, end, msrTs(k), msrPs(k), k.geom, ex);
  }

  // ---- dwell validation (C.1.5) -----------------------------------------------------------------------

  function msrTol(x) {
    return THRESHOLDS.TOL_SECONDS + THRESHOLDS.TOL_REL * Math.abs(x);
  }

  // The reason a dwell is invalid, or null. A dwell inside the tolerance is NOT clamped: it passes
  // through unchanged, so the tolerance is a decision about validity and never a way to edit a value.
  function msrDwellReason(w, seconds) {
    if (!Number.isFinite(w) || !Number.isFinite(seconds)) return "non-finite";
    if (w < -msrTol(w)) return "negative-dwell";
    if (w > seconds + msrTol(seconds)) return "dwell-exceeds-covered";
    return null;
  }

  // E.measure.dwellCheck (API.md C.1.5, S1-036..038): invalid-input for a material negative dwell or one
  // that exceeds the covered time; null when the value may be used. Validation failure, never a clamp.
  function msrDwellCheck(w, seconds) {
    const reason = msrDwellReason(w, seconds);
    return reason === null ? null : API.result.make("invalid-input", { reason });
  }

  // E.measure.dwellResidual (API.md C.1.5): the time of a column that no shown row accounts for.
  // `rowsSum` is the dwell summed over ALL of the column's rows, or null when only the rectangle's rows are
  // known, which is the case for any single-cell reading: then the residual is "not measurable", never 0
  // and never 100%. Dwell is never renormalised to fill the column.
  function msrDwellResidual(colSeconds, rowsSum) {
    if (!Number.isFinite(colSeconds)) return API.result.make("invalid-input", { reason: "non-finite" });
    if (rowsSum === null || rowsSum === undefined) return { measurable: false, reason: "rectangle rows only" };
    if (!Number.isFinite(rowsSum)) return API.result.make("invalid-input", { reason: "non-finite" });
    if (colSeconds <= 0) return { measurable: false, reason: "no covered time" };
    const residual = colSeconds - rowsSum;
    if (residual < -msrTol(colSeconds)) return API.result.make("invalid-input", { reason: "dwell-exceeds-covered" });
    return { measurable: true, seconds: residual, share: residual / colSeconds };
  }

  // ---- the per-cell kernel (C.1.4) --------------------------------------------------------------------

  // E.measure.cellValue (API.md C.1.4, DD-17, DD-85): the physical value of ONE cell, written into the
  // caller's scratch `out` as {tag (index in E.result.TAGS; 0 = a value), value (NaN unless tag 0), signed,
  // short, reason, denominator}. Allocation-free: `k` is the frame's one mutable kernel that the encoder
  // re-points at each cell (k.z, k.bounds) instead of building a spec literal per cell.
  //   k = { mode, basis, pathBasis, z, bounds: [t0,t1,r0,r1], cut, end, CUT, replay, geom: {BASE, PR},
  //         level: {n, m} (or the steps ts, ps directly), read, measured, cascade, exposure }
  // `read` is null unless the DISPLAYED block itself cannot answer for the cell (DD-84); `measured(z)` is
  // false for a base cell not yet read or a motion cell at or after the motion end; `cascade(z, out)` fills
  // out.tag/value/reason/denominator from the level's Cascade entry (part 06 builds those). Evaluation order:
  // read status, replay-hidden, unmeasured, then the formula. The scale coordinate and the colour are NOT
  // applied here (S1-009).
  function msrCellValue(k, out) {
    const z = k.z;
    const mode = k.mode;
    out.signed = mode === "delta" || mode === "flow" || mode === "flowtrades" || mode === "cascade";
    out.short = false;
    if (msrReadStatus(k.read, out)) return out;
    if (k.replay && z.c * msrTs(k) >= k.cut) return msrSetTyped(out, msrHidden, "replay", null);
    const measured = k.measured;
    if (typeof measured === "function" && measured(z) === false) return msrSetTyped(out, msrPending, "column not complete", null);
    let ex = null;
    switch (mode) {
      case "volume":
      case "trades":
      case "delta": {
        const amount = mode === "volume" ? z.v : mode === "trades" ? z.ct : 2 * z.bv - z.v;
        if (k.basis !== "intensity") return msrSetValue(out, amount);
        ex = msrKernelExposure(k, Infinity);
        out.short = ex.timeFraction < msrShortAt || ex.priceFraction < msrShortAt;
        if (ex.seconds <= 0) return msrSetTyped(out, msrUndefined, null, "covered time");
        if (ex.width <= 0) return msrSetTyped(out, msrUndefined, null, "price span");
        // Never floored: a positive exposure of 1e-9 s still divides.
        return msrSetValue(out, (amount * msrPerMinute * msrBandUsdt) / (ex.seconds * ex.width));
      }
      case "size":
        if (z.ct === 0) return msrSetTyped(out, msrUndefined, null, "trades");
        return msrSetValue(out, z.v / z.ct);
      case "flow":
        if (z.v <= 0) return msrSetTyped(out, msrEmptyPop, "total volume is 0", "total volume");
        return msrSetValue(out, z.bv / z.v);
      case "flowtrades":
        if (z.ct <= 0) return msrSetTyped(out, msrEmptyPop, "total trades is 0", "total trades");
        return msrSetValue(out, z.bt / z.ct);
      case "path": {
        const pb = k.pathBasis;
        if (pb === "usdt") return msrSetValue(out, z.p);
        ex = msrKernelExposure(k, k.end);
        out.short = ex.timeFraction < msrShortAt || ex.priceFraction < msrShortAt;
        if (pb === "perMinute") {
          if (ex.seconds <= 0) return msrSetTyped(out, msrUndefined, null, "covered time");
          if (ex.width <= 0) return msrSetTyped(out, msrUndefined, null, "price span");
          return msrSetValue(out, (msrPerMinute * z.p) / (ex.width * ex.seconds));
        }
        // Row spans: path over the MEASURED price height of the cell, i.e. cell heights at the drawn row
        // size (DR-12; the baseline's extrapolation to the full cell time is gone).
        if (ex.width <= 0) return msrSetTyped(out, msrUndefined, null, "price span");
        return msrSetValue(out, z.p / ex.width);
      }
      case "dwell": {
        ex = msrKernelExposure(k, k.end);
        out.short = ex.timeFraction < msrShortAt || ex.priceFraction < msrShortAt;
        const bad = msrDwellReason(z.w, ex.seconds);
        if (bad !== null) return msrSetTyped(out, msrInvalid, bad, null);
        if (ex.seconds <= 0) return msrSetTyped(out, msrUndefined, null, "covered time");
        return msrSetValue(out, z.w / ex.seconds);
      }
      case "cascade": {
        const entry = k.cascade;
        // No Cascade source yet (the page has not built the level's parents): pending, never a value.
        if (typeof entry !== "function") return msrSetTyped(out, msrPending, "reading", null);
        msrSetTyped(out, msrPending, null, null);
        entry(z, out);
        if (out.tag === msrFinite) return msrSetValue(out, out.value);
        return out;
      }
      default:
        return msrSetTyped(out, msrUnsupported, "no measurement for this mode", null);
    }
  }

  // ---- allocating records -----------------------------------------------------------------------------

  // A finished scratch -> a Typed record (B.1), through E.result.make so the required fields are checked.
  function msrToTyped(o) {
    const tag = API.result.TAGS[o.tag];
    const fields = {};
    if (o.tag === 0) fields.value = o.value;
    else {
      if (typeof o.reason === "string") fields.reason = o.reason;
      if (typeof o.denominator === "string") fields.denominator = o.denominator;
      if (tag === "waiting-for-complete-parent") fields.open = true;
    }
    return API.result.make(tag, fields);
  }

  function msrNumber(x) {
    return Number.isFinite(x) ? x : null;
  }

  // E.measure.cellMeasurement (API.md B.4): the full, allocating record of one cell's measurement, for
  // readouts, tooltips and the portable capture. `spec` has the fields of the kernel. The numerator and the
  // denominator are what was AGGREGATED before the ratio (S1-010): sums of USDT, trades, seconds, never
  // averages of ratios.
  function msrCellMeasurement(spec) {
    const k = spec.exposure ? spec : Object.assign({}, spec);
    const out = { tag: 0, value: NaN, signed: false, short: false, reason: null, denominator: null };
    msrCellValue(k, out);
    const mode = k.mode;
    const basis = msrBasisOf(mode, k.basis, k.pathBasis);
    const id = msrCellFormulas[mode + "|" + basis] || null;
    const z = k.z;
    const uses = msrUsesOf(mode, basis);
    let exposure = null;
    if (uses.t || uses.w) {
      // The kernel computed it unless a non-value came first (read status, hidden, unmeasured).
      const ex = msrKernelExposure(k, mode === "path" || mode === "dwell" ? k.end : Infinity);
      exposure = {
        seconds: msrNumber(ex.seconds),
        width: msrNumber(ex.width),
        timeFraction: msrNumber(ex.timeFraction),
        priceFraction: msrNumber(ex.priceFraction),
        nominalSeconds: ex.nominalSeconds,
        nominalWidth: ex.nominalWidth,
        short: msrIsShort(ex, uses),
        uses: { t: uses.t, w: uses.w },
        coverage: "range",
        coveredTo: mode === "path" || mode === "dwell" ? "end" : null,
      };
    }
    let numerator = null;
    let numeratorUnit = null;
    let denominator = null;
    let denominatorUnit = null;
    if (mode === "volume" || mode === "trades" || mode === "delta") {
      numerator = msrNumber(mode === "volume" ? z.v : mode === "trades" ? z.ct : 2 * z.bv - z.v);
      numeratorUnit = mode === "trades" ? "trades" : "usdt";
      if (basis === "intensity" && exposure) {
        denominator = msrNumber((exposure.seconds * exposure.width) / (msrPerMinute * msrBandUsdt));
        denominatorUnit = "usdt*s/60/125";
      }
    } else if (mode === "size") {
      numerator = msrNumber(z.v);
      numeratorUnit = "usdt";
      denominator = msrNumber(z.ct);
      denominatorUnit = "trades";
    } else if (mode === "flow") {
      numerator = msrNumber(z.bv);
      numeratorUnit = "usdt";
      denominator = msrNumber(z.v);
      denominatorUnit = "usdt";
    } else if (mode === "flowtrades") {
      numerator = msrNumber(z.bt);
      numeratorUnit = "trades";
      denominator = msrNumber(z.ct);
      denominatorUnit = "trades";
    } else if (mode === "path") {
      numerator = msrNumber(z.p);
      numeratorUnit = "usdt";
      if (basis !== "usdt" && exposure) {
        denominator = basis === "perMinute" ? msrNumber((exposure.width * exposure.seconds) / msrPerMinute) : exposure.width;
        denominatorUnit = basis === "perMinute" ? "usdt*s/60" : "usdt";
      }
    } else if (mode === "dwell") {
      numerator = msrNumber(z.w);
      numeratorUnit = "seconds";
      if (exposure) {
        denominator = exposure.seconds;
        denominatorUnit = "seconds";
      }
    }
    return {
      v: 1,
      formula: id,
      measure: mode,
      basis,
      unit: id ? msrFormulas[id].unit : null,
      numerator,
      numeratorUnit,
      denominator,
      denominatorUnit,
      exposure,
      aggregation: denominator === null ? "sum" : "sum-then-ratio",
      result: msrToTyped(out),
      model: null,
    };
  }

  // ---- columns (C.1.6) --------------------------------------------------------------------------------

  // Write one column's measure into `o` ({tag, value, reason, denominator}); a ratio column asks part 06
  // with the inputs the page gathered in ctx.ratio (the level's Cascade context or the touched-row counts).
  function msrColumnInto(key, col, ctx, o) {
    const c = ctx || null;
    if (c !== null) {
      if (msrReadStatus(c.read, o)) return o;
      if (c.hidden) return msrSetTyped(o, msrHidden, "replay", null);
    }
    switch (key) {
      case "volume":
        return msrSetValue(o, col.v);
      case "trades":
        return msrSetValue(o, col.ct);
      case "delta":
        return msrSetValue(o, 2 * col.bv - col.v);
      case "takertrades":
        return msrSetValue(o, 2 * col.bt - col.ct);
      case "size":
        if (col.ct === 0) return msrSetTyped(o, msrUndefined, null, "trades");
        return msrSetValue(o, col.v / col.ct);
      case "choppiness":
        if (col.ct === 0) return msrSetTyped(o, msrUndefined, null, "trades");
        // A movement-only column has NaN high and low: no range, so no ratio (never a 0 bar).
        if (!(col.hi > col.lo)) return msrSetTyped(o, msrUndefined, null, "price range");
        return msrSetValue(o, col.p / (col.hi - col.lo));
      case "perpath":
        if (!(col.p > 0)) return msrSetTyped(o, msrUndefined, null, "path");
        return msrSetValue(o, col.v / col.p);
      case "cascade":
      case "efficiency": {
        const input = c !== null ? c.ratio : null;
        if (!input) return msrSetTyped(o, msrPending, "reading", null);
        const typed = key === "cascade" ? API.ratio.cascade(input) : API.ratio.efficiency(input);
        o.tag = msrTag[typed.tag];
        o.value = typed.tag === "finite" ? typed.value : NaN;
        o.reason = typeof typed.reason === "string" ? typed.reason : null;
        o.denominator = typeof typed.denominator === "string" ? typed.denominator : null;
        return o;
      }
      default:
        return msrSetTyped(o, msrUnsupported, "no measurement for this column", null);
    }
  }

  // E.measure.columnValue (API.md C.1.6, S1-044/S1-063): the value of one pane column. `key` is one of
  // volume, trades, delta, takertrades, size, choppiness, perpath, cascade, efficiency; `col` the column's
  // summary {v, bv, ct, bt, p, hi, lo}; `ctx` may carry {read, hidden, ratio} (the ratio columns take their
  // structure and amounts in ctx.ratio, in the shape of E.ratio.cascade / efficiency). The baseline
  // answered 0 for an undefined denominator and drew a zero-length bar; now the answer is a typed
  // non-value that every reading renders alike. With `out` ({tag, value, reason, denominator}) it writes the
  // tag and value without allocating (used once per column per frame; the two ratio keys still build one
  // small Typed inside part 06); without it a Typed record is returned.
  function msrColumnValue(key, col, ctx, out) {
    if (out) return msrColumnInto(key, col, ctx, out);
    return msrToTyped(msrColumnInto(key, col, ctx, { tag: 0, value: NaN, reason: null, denominator: null }));
  }

  API.measure = Object.freeze({
    FORMULAS: msrFormulas,
    MODES: msrModes,
    ROWS: msrRows,
    exposure: msrExposure,
    usesOf: msrUsesOf,
    isShort: msrIsShort,
    cellValue: msrCellValue,
    cellMeasurement: msrCellMeasurement,
    columnValue: msrColumnValue,
    dwellCheck: msrDwellCheck,
    dwellResidual: msrDwellResidual,
    cellState: msrCellState,
    close: msrClose,
  });
