  // @part 17-warn
  // @requires 08-scale
  // @prefix wrn
  // @provides warn
  // == §17 warn: the screen-area accumulator and the two warnings (API.md C.11, DR-11, S1-120) ==
  // "Scale range exceeded" and "Low discrimination" are facts about the marks the viewer is looking at, so
  // they are counted over the DRAWN marks of a settled pass, never over a cohort and never inside the paint
  // loop of a steady frame. A Tally is the small mutable accumulator the consumer hooks feed (one `add` or
  // `addBox` per drawn mark) and `evaluate` turns into a WarnReport. Everything is a pure function of the
  // marks fed: a warning never recolours, never refits and never changes a mapping (DD-94: it only offers
  // actions).
  //
  // What counts (DR-11, DD-11):
  //   occupied mark   a drawn mark with a defined value (partial and open marks are drawn, so they count; only
  //                   the calibration cohort leaves them out). Non-values and known-empty cells are not counted
  //                   at all, and the lens reports its own tally. Negative infinity IS an occupied mark and an
  //                   out-of-range one (DR-11 lists it in the numerator), so `addNegInf` counts it in both.
  //   outside         finite clipping (LOW, HIGH), a rank outside its support (the same codes) and negative
  //                   infinity. An exact endpoint (EXACT_LOW, EXACT_HIGH) is on the scale, not outside it.
  //   screen area     the CSS-px area of a mark's box clipped to the plot rectangle AND the measurement
  //                   rectangle; a box with nothing left after clipping is not a drawn mark and is skipped.
  //   lowest/highest  a NONZERO mark whose LUT index is in the lowest 13 or the highest 13 of 256 entries
  //                   (5.08% per end); zero is keyed separately and never counts.
  // The thresholds are strict ("more than"): exactly 10% of the marks, 25% of the area or 90% of the nonzero
  // marks is not a warning. Ratios are divisions (not products) so that 1/10 compares equal to the constant
  // 0.1: both are the double nearest one tenth.

  const wrnClip = API.scale.CLIP;
  const wrnLow = wrnClip.LOW;
  const wrnHigh = wrnClip.HIGH;
  const wrnExactLow = wrnClip.EXACT_LOW;
  const wrnExactHigh = wrnClip.EXACT_HIGH;

  // E.warn.bandOf (API.md A.3, C.11): which end of the LUT an index is in, "low" for the lowest 13 entries
  // (0..12), "high" for the highest 13 (243..255), else null. Only a whole index 0..255 has a band: -1 (the
  // encoder's "no index") and NaN are null, not "low".
  function wrnBandOf(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx > 255) return null;
    if (idx <= THRESHOLDS.LUT_LOW_MAX) return "low";
    if (idx >= THRESHOLDS.LUT_HIGH_MIN) return "high";
    return null;
  }

  // One mark with a defined value. Returns 1 when the mark is outside the scale (so addBox can add its area
  // to the outside area), else 0. `nonzero` decides whether the LUT band counters see it; a mark with no
  // coordinate (idx < 0, for example an occupancy-only draw) still counts as a mark and as outside when its
  // clip says so.
  function wrnCount(t, idx, clip, defined, nonzero) {
    if (!defined) return 0;
    t.marks++;
    if (nonzero) {
      t.nonzero++;
      if (idx >= 0 && idx <= THRESHOLDS.LUT_LOW_MAX) t.lowBand++;
      else if (idx >= THRESHOLDS.LUT_HIGH_MIN && idx <= 255) t.highBand++;
    }
    if (clip === wrnLow) {
      t.low++;
      t.outside++;
      return 1;
    }
    if (clip === wrnHigh) {
      t.high++;
      t.outside++;
      return 1;
    }
    if (clip === wrnExactLow) t.exactLow++;
    else if (clip === wrnExactHigh) t.exactHigh++;
    return 0;
  }

  // The part of a box that is on screen. `clip` is one rectangle {x0, y0, x1, y1}, or the pair the hooks
  // receive, {plot, meas}: the mark is then clipped to both (their intersection; `meas` may be null when
  // there is no measurement rectangle). Returns the clipped area, 0 when nothing is left.
  function wrnVisibleArea(x0, y0, x1, y1, clip) {
    let cx0 = clip.x0;
    let cy0 = clip.y0;
    let cx1 = clip.x1;
    let cy1 = clip.y1;
    if (clip.plot !== undefined) {
      const p = clip.plot;
      cx0 = p.x0;
      cy0 = p.y0;
      cx1 = p.x1;
      cy1 = p.y1;
      const m = clip.meas;
      if (m !== null && m !== undefined) {
        if (m.x0 > cx0) cx0 = m.x0;
        if (m.y0 > cy0) cy0 = m.y0;
        if (m.x1 < cx1) cx1 = m.x1;
        if (m.y1 < cy1) cy1 = m.y1;
      }
    }
    const w = (x1 < cx1 ? x1 : cx1) - (x0 > cx0 ? x0 : cx0);
    const h = (y1 < cy1 ? y1 : cy1) - (y0 > cy0 ? y0 : cy0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // E.warn.tally (API.md A.3, C.11, DD-02): a fresh accumulator. All counters are plain numbers on the
  // returned object (read them, never write them); the methods are closures over that one object, so a
  // hot loop calls them without allocating. `reset()` zeroes it for the next pass.
  //   add(idx, clip, defined, nonzero)                         a mark with no box (a pane bar)
  //   addBox(x0, y0, x1, y1, clipRect, idx, clip, defined, nonzero)   a mark with a CSS-px box (a cell, a band)
  //   addNegInf() / addBoxNegInf(x0, y0, x1, y1, clip)         a negative-infinite mark (occupied AND outside)
  //   addNoRef()                                               a no-reference mark: counted for its key only
  // `idx` is the LUT index the encoder gave the mark, `clip` its E.scale.CLIP code, `defined` whether the
  // value is a real one, `nonzero` whether it is not zero.
  function wrnTally() {
    const t = {
      marks: 0,
      outside: 0,
      low: 0,
      high: 0,
      exactLow: 0,
      exactHigh: 0,
      negInf: 0,
      noRef: 0,
      nonzero: 0,
      lowBand: 0,
      highBand: 0,
      area: 0,
      areaOutside: 0,
      add: null,
      addBox: null,
      addNegInf: null,
      addBoxNegInf: null,
      addNoRef: null,
      reset: null,
    };
    t.add = function (idx, clip, defined, nonzero) {
      wrnCount(t, idx, clip, defined, nonzero);
    };
    t.addBox = function (x0, y0, x1, y1, clipRect, idx, clip, defined, nonzero) {
      if (!defined) return;
      const a = wrnVisibleArea(x0, y0, x1, y1, clipRect);
      if (a === 0) return;
      t.area += a;
      if (wrnCount(t, idx, clip, defined, nonzero) === 1) t.areaOutside += a;
    };
    t.addNegInf = function () {
      t.marks++;
      t.outside++;
      t.negInf++;
    };
    t.addBoxNegInf = function (x0, y0, x1, y1, clipRect) {
      const a = wrnVisibleArea(x0, y0, x1, y1, clipRect);
      if (a === 0) return;
      t.area += a;
      t.areaOutside += a;
      t.marks++;
      t.outside++;
      t.negInf++;
    };
    t.addNoRef = function () {
      t.noRef++;
    };
    t.reset = function () {
      t.marks = t.outside = t.low = t.high = t.exactLow = t.exactHigh = 0;
      t.negInf = t.noRef = t.nonzero = t.lowBand = t.highBand = 0;
      t.area = t.areaOutside = 0;
    };
    return t;
  }

  // A share that is 0 (not NaN) when its denominator is 0, so a report of an empty pass is all zeros.
  function wrnShare(part, whole) {
    return whole > 0 ? part / whole : 0;
  }

  // E.warn.evaluate (API.md A.3, C.11, DR-11): the WarnReport of a tally.
  //   cfg = {meaningful?, marks?, area?, lowDisc?}   `meaningful` (default true) is false for a channel with a
  //   natural fixed domain (Taker share, Dwell, Cascade, Efficiency, Relative volume, RSI): it still reports
  //   its clip counts but never "Scale range exceeded" or "Low discrimination" (A-14); the three optional
  //   numbers override the thresholds (defaults THRESHOLDS.WARN_MARKS, WARN_AREA, LOW_DISC), for tests.
  //   -> { meaningful,
  //        rangeExceeded          boolean: marks > 10% OR area > 25% outside (strict),
  //        lowDiscrimination      "low" | "high" | null: more than 90% of the nonzero marks in that end's band,
  //                               each end tested on its own (a 50/50 split across both ends does not warn),
  //        shares                 {marks, area, low, high}: outside/marks, areaOutside/area, lowBand/nonzero,
  //                               highBand/nonzero (the actual numbers the legend shows),
  //        counts                 every counter of the tally (the clip counts the key glyphs show),
  //        warnings               [{id:"range-exceeded", shares:{marks, area}}, {id:"low-discrimination",
  //                               end, share}] in that order, ids as INTEGRATION D.18 names them }
  function wrnEvaluate(t, cfg) {
    const c = cfg !== null && typeof cfg === "object" ? cfg : {};
    const meaningful = c.meaningful === undefined ? true : Boolean(c.meaningful);
    const limitMarks = typeof c.marks === "number" ? c.marks : THRESHOLDS.WARN_MARKS;
    const limitArea = typeof c.area === "number" ? c.area : THRESHOLDS.WARN_AREA;
    const limitDisc = typeof c.lowDisc === "number" ? c.lowDisc : THRESHOLDS.LOW_DISC;
    const shares = {
      marks: wrnShare(t.outside, t.marks),
      area: wrnShare(t.areaOutside, t.area),
      low: wrnShare(t.lowBand, t.nonzero),
      high: wrnShare(t.highBand, t.nonzero),
    };
    const rangeExceeded = meaningful && t.marks > 0 && (shares.marks > limitMarks || shares.area > limitArea);
    let lowDiscrimination = null;
    if (meaningful && t.nonzero > 0) lowDiscrimination = shares.low > limitDisc ? "low" : shares.high > limitDisc ? "high" : null;
    const warnings = [];
    if (rangeExceeded) warnings.push({ id: "range-exceeded", shares: { marks: shares.marks, area: shares.area } });
    if (lowDiscrimination !== null) warnings.push({ id: "low-discrimination", end: lowDiscrimination, share: lowDiscrimination === "low" ? shares.low : shares.high });
    return {
      meaningful,
      rangeExceeded,
      lowDiscrimination,
      shares,
      counts: {
        marks: t.marks,
        outside: t.outside,
        low: t.low,
        high: t.high,
        exactLow: t.exactLow,
        exactHigh: t.exactHigh,
        negInf: t.negInf,
        noRef: t.noRef,
        nonzero: t.nonzero,
        lowBand: t.lowBand,
        highBand: t.highBand,
        area: t.area,
        areaOutside: t.areaOutside,
      },
      warnings,
    };
  }

  API.warn = Object.freeze({
    tally: wrnTally,
    evaluate: wrnEvaluate,
    bandOf: wrnBandOf,
  });
