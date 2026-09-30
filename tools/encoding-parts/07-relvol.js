  // @part 07-relvol
  // @requires 01-util 03-result
  // @prefix rvl
  // @provides relvol
  // == §07 relvol: Relative volume v2 (API.md C.2, DR-19, DD-24, DD-89, S1-046..050) ==
  // For every price bin: log2 of the bin's share of the RECTANGLE's volume over its share of the PERIOD's
  // volume, where both shares are taken over the same comparison support W (the selection's price range, else
  // the view's). Two distributions over one support, so that a rectangle that trades exactly like its period
  // reads 0 on every row, whatever W is. The baseline compared the rectangle's shares (over W) with the
  // period's shares over ALL its rows, which is why v1 drifted from 0 as soon as W was a part of the range.
  //
  // Pure and allocation-light: flat typed arrays indexed by (bin - first bin), no Map per call, and for an
  // exact period only the rows inside W are visited (binary search on the sorted rows), so a vertical pan
  // costs O(rows in W). The result is a NEW object every call; the caller memoises it on (period rows, query,
  // w0, w1, bm) (DD-24) and keeps it apart from the unrestricted underlay bands that feed POC and value area
  // (S1-050): nothing here mutates or is derived in place from those.

  // Per-bin outcome codes of the flat arrays.
  const rvlFiniteCode = 0;
  const rvlNegInfCode = 1;
  const rvlNoRefCode = 2;
  const rvlEmptyBothCode = 3;
  const rvlAbsentCode = 255;
  // A guard, not a limit anyone reaches: W is a screen or a selection, thousands of base rows at most.
  const rvlBinsMax = 4194304;

  // The typed results with a fixed shape are shared frozen records (`at` is asked once per band per frame);
  // only a finite value allocates.
  const rvlNegInf = Object.freeze({ tag: "negative-infinite", reason: "no current volume" });
  const rvlNoRef = Object.freeze({ tag: "no-reference", reason: "no reference volume" });
  const rvlEmptyBoth = Object.freeze({ tag: "empty-both" });
  const rvlOutside = Object.freeze({ tag: "outside-support", reason: "outside price support" });

  function rvlZeroCounts() {
    return { finite: 0, zero: 0, negativeInfinite: 0, noReference: 0, emptyBoth: 0, underflow: 0, overflow: 0, exactLow: 0, exactHigh: 0 };
  }

  // First index of ascending `rows` (objects with a numeric `r`) whose r >= x.
  function rvlFirstRow(rows, x) {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].r < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // The read and coverage status of the whole result (C.2 step 1): a failed read beats a pending one beats a
  // source that cannot answer ("not recorded" on a recorded page), then replay-hidden. `read` is
  // {meas, res, stale} with meas the rectangle's measurement and res the period's rows, each {state, reason?};
  // meas.state failed and pending count, res.state failed, pending, "unrecorded" (unsupported) and "none"
  // (the period lies after the replay edge: hidden). stale is disclosure only, never a status.
  function rvlStatus(input) {
    const read = input.read || {};
    const meas = read.meas || null;
    const res = read.res || null;
    let picked = null;
    for (const state of ["failed", "pending"])
      for (const r of [meas, res]) if (r && r.state === state && picked === null) picked = r;
    if (picked === null && res && res.state === "unrecorded") picked = { state: "unsupported", reason: "not recorded" };
    const hidden = input.hidden === true || (res !== null && res.state === "none");
    return API.result.precedence({ read: picked, hidden });
  }

  // The support record of a result: W, the band level, which rows the comparison used and which bins count.
  function rvlSupport(w0, w1, bm, own, first, last, bins, used) {
    return Object.freeze({
      w: [w0, w1],
      bm,
      exact: own === 0,
      kind: own === 0 ? "exact-rows" : "coarse-common-bins",
      first: bins > 0 ? first : null,
      last: bins > 0 ? last : null,
      bins,
      used,
    });
  }

  // A result that says the same thing for every bin (a read status, an unsupported period, an empty
  // support). `sup` is the support record when one exists.
  function rvlWhole(typed, w0, w1, bm, own, stale, restriction, sup) {
    return Object.freeze({
      state: "typed",
      typed,
      stale,
      at: () => typed,
      counts: rvlZeroCounts(),
      support: sup || rvlSupport(w0, w1, bm, own, 0, 0, 0, 0),
      restriction,
    });
  }

  // E.relvol.compute (API.md C.2, DR-19). Input:
  //   read    {meas, res, stale}    see rvlStatus
  //   W       [w0, w1]              the comparison support in base rows: the selection's price range, else the
  //                                 view's (for a `recorded` state the inward bounds)
  //   period  {rows, own, exact}    the period's rows [{r, v}] ascending by r, at row level `own`
  //                                 (rowPrice 2**own; 0 = 125 USDT rows)
  //   current {rows, m}             the rectangle's rows [{r, v}] (already only its measured part inside W)
  //                                 at level m <= bm
  //   bm                            the drawn band level, max(renderM, own)
  //   hidden                        replay: nothing after the edge is shown
  // Bin j covers base rows [j*2**bm, (j+1)*2**bm).
  //  - Exact period (own = 0): period rows are restricted to W FIRST, so a partial edge bin holds only its
  //    in-W base rows and is exact on both sides; the support is every bin that overlaps W.
  //  - Coarse period (own > 0, rows of more than 125 USDT): a coarse row cannot be split, so only bins
  //    wholly inside W on BOTH sides count; the others are dropped (restriction.dropped, the number of bins
  //    with data that were left out, including bins wholly outside W) and, if none is left, the whole
  //    result is `unsupported` "no fully covered common bin".
  //  The rows visited are those of W for an exact period, all of them for a coarse one (few, by nature).
  // The result: {state: "ok" | "typed", typed (the whole-result Typed, or null), stale, at(bin) -> Typed,
  // counts, support, restriction}. `at(bin)`: a bin in the support with data -> its value or typed case;
  // in the support with no data at all -> empty-both; outside the support (outside W, or a dropped coarse
  // edge bin) -> outside-support, NEVER a zero-current row (a row that lies outside the comparison is not
  // one the rectangle failed to trade). The union of the two sides is iterated, so a bin only the
  // rectangle traded is `no-reference` and one only the period traded is `negative-infinite`.
  function rvlCompute(input) {
    const W = input.W;
    if (!Array.isArray(W) || !Number.isFinite(W[0]) || !Number.isFinite(W[1])) throw new TypeError("relvol needs a finite comparison support W = [w0, w1]");
    const w0 = W[0];
    const w1 = W[1];
    const period = input.period || { rows: [], own: 0, exact: true };
    const own = period.own || 0;
    const bm = input.bm;
    if (!Number.isInteger(bm) || bm < own) throw new RangeError("relvol needs an integer band level bm >= the period's row level");
    const current = input.current || { rows: [], m: bm };
    const qm = current.m === undefined || current.m === null ? bm : current.m;
    if (!Number.isInteger(qm) || qm < 0 || qm > bm) throw new RangeError("relvol needs the rectangle's row level between 0 and bm");
    const stale = !!(input.read && input.read.stale);
    const status = rvlStatus(input);
    if (status !== null) return rvlWhole(status, w0, w1, bm, own, stale, null);
    if (!(w1 > w0)) return rvlWhole(rvlOutside, w0, w1, bm, own, stale, null);

    const binSize = Math.pow(2, bm);
    const kP = Math.pow(2, bm - own);
    const kC = Math.pow(2, bm - qm);
    const pRows = period.rows || [];
    const cRows = current.rows || [];
    const exactPeriod = own === 0;

    // The support: the bins that count. Exact: those overlapping W (base rows w0 <= r < w1); coarse: those
    // wholly inside W.
    let supFirst;
    let supLast;
    if (exactPeriod) {
      const rMin = Math.ceil(w0);
      const rMax = Math.ceil(w1) - 1;
      supFirst = Math.floor(rMin / binSize);
      supLast = rMax >= rMin ? Math.floor(rMax / binSize) : supFirst - 1;
    } else {
      supFirst = Math.ceil(w0 / binSize);
      supLast = Math.floor(w1 / binSize) - 1;
    }
    const supCount = supLast >= supFirst ? supLast - supFirst + 1 : 0;

    // Which period rows are visited: the rows of W only for an exact period (binary search), else all.
    let pFrom = 0;
    let pTo = pRows.length;
    if (exactPeriod) {
      pFrom = rvlFirstRow(pRows, w0);
      pTo = rvlFirstRow(pRows, w1);
    }
    // The extent of the bins with data, in one pass over what will be summed.
    let minJ = Infinity;
    let maxJ = -Infinity;
    for (let i = pFrom; i < pTo; i++) {
      const x = pRows[i];
      if (!Number.isFinite(x.v)) return rvlWhole(API.result.make("invalid-input", { reason: "non-finite" }), w0, w1, bm, own, stale, null);
      const j = Math.floor(x.r / kP);
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
    for (let i = 0; i < cRows.length; i++) {
      const x = cRows[i];
      if (!Number.isFinite(x.v)) return rvlWhole(API.result.make("invalid-input", { reason: "non-finite" }), w0, w1, bm, own, stale, null);
      const j = Math.floor(x.r / kC);
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
    const n = maxJ >= minJ ? maxJ - minJ + 1 : 0;
    if (n > rvlBinsMax) throw new RangeError("relvol: " + n + " bins is beyond the guard of " + rvlBinsMax);
    const per = new Float64Array(n);
    const cur = new Float64Array(n);
    const seen = new Uint8Array(n);
    for (let i = pFrom; i < pTo; i++) {
      const x = pRows[i];
      const j = Math.floor(x.r / kP) - minJ;
      per[j] += x.v;
      seen[j] = 1;
    }
    for (let i = 0; i < cRows.length; i++) {
      const x = cRows[i];
      const j = Math.floor(x.r / kC) - minJ;
      cur[j] += x.v;
      seen[j] = 1;
    }

    // used = bins with data inside the support; C and P are the sums over them (both sides, the same bins).
    let usedCount = 0;
    let seenCount = 0;
    let C = 0;
    let P = 0;
    for (let j = 0; j < n; j++) {
      if (seen[j] === 0) continue;
      seenCount++;
      const bin = j + minJ;
      if (bin < supFirst || bin > supLast) continue;
      usedCount++;
      C += cur[j];
      P += per[j];
    }
    const restriction = exactPeriod ? null : Object.freeze({ kind: "coarse-common-bins", dropped: seenCount - usedCount });
    if (!exactPeriod && usedCount === 0) return rvlWhole(API.result.make("unsupported", { reason: "no fully covered common bin" }), w0, w1, bm, own, stale, restriction, rvlSupport(w0, w1, bm, own, supFirst, supLast, supCount, 0));
    if (!(C > 0)) return rvlWholeInSupport(API.result.make("empty-population", { denominator: "current total", reason: "current total is 0" }), w0, w1, bm, own, stale, restriction, supFirst, supLast, supCount, usedCount);
    if (!(P > 0)) return rvlWholeInSupport(API.result.make("empty-population", { denominator: "reference total", reason: "reference total is 0" }), w0, w1, bm, own, stale, restriction, supFirst, supLast, supCount, usedCount);

    // Per bin: shares over the same support, then the ladder (C.2 step 6).
    const code = new Uint8Array(n).fill(rvlAbsentCode);
    const val = new Float64Array(n);
    const counts = rvlZeroCounts();
    let bothZero = 0;
    for (let j = 0; j < n; j++) {
      const bin = j + minJ;
      if (seen[j] === 0 || bin < supFirst || bin > supLast) continue;
      const sc = cur[j] / C;
      const sp = per[j] / P;
      if (sc === 0 && sp === 0) {
        code[j] = rvlEmptyBothCode;
        bothZero++;
      } else if (sc === 0) {
        code[j] = rvlNegInfCode;
        counts.negativeInfinite++;
      } else if (sp === 0) {
        code[j] = rvlNoRefCode;
        counts.noReference++;
      } else {
        const v = Math.log2(sc / sp);
        code[j] = rvlFiniteCode;
        val[j] = v;
        counts.finite++;
        if (v === 0) counts.zero++;
        if (v < -2) counts.underflow++;
        else if (v > 2) counts.overflow++;
        else if (v === -2) counts.exactLow++;
        else if (v === 2) counts.exactHigh++;
      }
    }
    // Bins of the support that no row touched are empty on both sides: counted here, not drawn per row (A-28).
    counts.emptyBoth = bothZero + (supCount - usedCount);

    const at = (bin) => {
      if (bin < supFirst || bin > supLast) return rvlOutside;
      const j = bin - minJ;
      if (j < 0 || j >= n || code[j] === rvlAbsentCode) return rvlEmptyBoth;
      const c = code[j];
      if (c === rvlFiniteCode) return { tag: "finite", value: val[j] };
      return c === rvlNegInfCode ? rvlNegInf : c === rvlNoRefCode ? rvlNoRef : rvlEmptyBoth;
    };
    return Object.freeze({
      state: "ok",
      typed: null,
      stale,
      at,
      counts,
      support: rvlSupport(w0, w1, bm, own, supFirst, supLast, supCount, usedCount),
      restriction,
    });
  }

  // An empty total: the same typed answer for every bin IN the support, outside-support beyond it.
  function rvlWholeInSupport(typed, w0, w1, bm, own, stale, restriction, supFirst, supLast, supCount, usedCount) {
    return Object.freeze({
      state: "typed",
      typed,
      stale,
      at: (bin) => (bin < supFirst || bin > supLast ? rvlOutside : typed),
      counts: rvlZeroCounts(),
      support: rvlSupport(w0, w1, bm, own, supFirst, supLast, supCount, usedCount),
      restriction,
    });
  }

  API.relvol = Object.freeze({
    compute: rvlCompute,
  });
