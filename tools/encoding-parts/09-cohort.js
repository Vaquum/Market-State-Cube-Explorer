  // @part 09-cohort
  // @requires 03-result 05-measure
  // @prefix coh
  // @provides cohort
  // == §09 cohort: which observations a calibration is fitted on (API.md B.6, C.4.3, DD-12, DD-73, DD-88) ==
  // A cohort is the list of finite values a fit sees, plus the ledger of what was left out and why. It is
  // extracted from the CURRENT frame inputs at fire time (the page hands over what it draws, never a
  // captured copy, DD-88), off the draw path, once per settled fit: O(observations), no sort here (the fit
  // sorts). Pure and stateless: nothing is cached and the inputs are never mutated.
  //
  // What makes a cell a member (S1-081, D4): it is fully covered, at the EFFECTIVE level, by the declared
  // rectangle, by the cutoff and by the data edge, it is measured (not a placeholder the page stands in for
  // an unread cell), and its measure has a finite value. Everything else is counted, never silently
  // dropped, in one of seven buckets: partial, open, unread, nonFinite, negative, stale, placeholder.
  // Measured zeros ARE members (they are counted in `zeros` and decide the zero-only case of a fit, S1-074);
  // a placeholder can never create one (S1-075).
  //
  // A cohort that cannot be taken yet is not a smaller cohort, it is `{ok: false, reason}`: a failed,
  // pending, unsupported, stale or updating read, or a tier that is still loading, must never fit (a partial
  // arrival, a terminal failure or an initial placeholder would otherwise calibrate on a fragment, S1-115).
  // Programmer errors (a missing array, an unknown mode, no level) throw, exactly as the measure kernels do
  // (DR-39e); data problems are typed results.
  //
  // `columns` returns COUNTS ONLY and never a fit (DD-12, DD-73): an axis is autoscaled over every displayed
  // value (C.12), so the counts only tell the axis record how many of them were complete.

  // Tag indexes of E.result.TAGS (part 03), captured at load time so a cell's value is classified by a
  // small integer, never by a string compare per cell.
  const cohTag = API.result.TAG;
  const cohFinite = cohTag["finite"];
  const cohInvalid = cohTag["invalid-input"];
  const cohPending = cohTag["pending"];
  const cohFailed = cohTag["failed"];
  const cohHidden = cohTag["hidden"];
  const cohUnsupported = cohTag["unsupported"];
  // The read states that may calibrate (data-lifecycle 4.1: meas.state in exact, recorded, cube).
  const cohReadyStates = Object.freeze(["exact", "recorded", "cube"]);
  // Why a cohort is refused, most severe first. The order decides which reason is reported when several
  // reads disagree: a failed read is the one the viewer must be told about.
  const cohRefusals = Object.freeze(["failed", "unsupported", "pending", "stale", "updating", "loading"]);
  const cohCalibratedOn = Object.freeze(["view", "selection", "period", "lens"]);

  function cohNumber(x, fallback) {
    return typeof x === "number" && !Number.isNaN(x) ? x : fallback;
  }

  function cohNewExcluded() {
    return { partial: 0, open: 0, unread: 0, nonFinite: 0, negative: 0, stale: 0, placeholder: 0 };
  }

  // The refusal of ONE read record {state, updating?, stale?, loading?}, or null when it may calibrate. A
  // read that has not said it is exact, recorded or cube has not answered: pending.
  function cohReadRefusal(read) {
    if (read === null || read === undefined) return null;
    const state = read.state;
    if (state === "failed") return "failed";
    if (state === "unsupported") return "unsupported";
    if (cohReadyStates.indexOf(state) < 0) return "pending";
    if (read.stale) return "stale";
    if (read.updating) return "updating";
    if (read.loading) return "loading";
    return null;
  }

  // The most severe refusal among the reads a consumer needs (one record or an array of them) and the
  // page-wide `loading` flag (any tier still loading, the predicate the UI already uses for its hatching).
  function cohRefusal(read, loading) {
    let worst = loading ? cohRefusals.indexOf("loading") : -1;
    let found = worst >= 0;
    const reads = Array.isArray(read) ? read : [read];
    for (let i = 0; i < reads.length; i++) {
      const why = cohReadRefusal(reads[i]);
      if (why === null) continue;
      const rank = cohRefusals.indexOf(why);
      if (!found || rank < worst) worst = rank;
      found = true;
    }
    return found ? cohRefusals[worst] : null;
  }

  function cohStep(input, key, letter) {
    if (input[key] !== undefined) return input[key];
    if (input.level) return Math.pow(2, input.level[letter]);
    throw new TypeError("a cohort needs level {n, m} (or the steps ts and ps)");
  }

  function cohRect(b) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every((x) => typeof x === "number" && !Number.isNaN(x))) throw new TypeError("a cohort needs the measured rectangle b = [t0, t1, r0, r1]");
    return b;
  }

  function cohFiniteAll(list) {
    return list.every(Number.isFinite);
  }

  // The level of a record: the given {n, m}, or the powers of two the steps are, or null (an unusual step
  // has no level to name).
  function cohLevel(input, ts, ps) {
    if (input.level) return { n: input.level.n, m: input.level.m };
    const n = Math.log2(ts);
    const m = Math.log2(ps);
    return Number.isInteger(n) && Number.isInteger(m) ? { n, m } : null;
  }

  function cohQuality(input) {
    if (typeof input.quality === "string") return input.quality;
    const reads = Array.isArray(input.read) ? input.read : [input.read];
    for (let i = 0; i < reads.length; i++) if (reads[i] && typeof reads[i].state === "string") return reads[i].state;
    return null;
  }

  // What the cohort was taken on (A-13c): the declared rectangle AT INIT, so a later selection never
  // refits Explore; the lens and the Rows period name themselves.
  function cohCalibratedOnOf(input, fallback) {
    if (cohCalibratedOn.indexOf(input.calibratedOn) >= 0) return input.calibratedOn;
    return input.selection ? "selection" : fallback;
  }

  // The bucket of a non-finite kernel result. A typed non-value is never a member: a read that has not
  // answered is `unread`, an invalid number is `nonFinite`, and a cell that has nothing to measure (Size
  // without trades, Flow without volume, a Cascade cell without a comparable parent) is a `placeholder`,
  // so none of them can manufacture a zero cohort.
  function cohBucketOf(tag) {
    if (tag === cohInvalid) return "nonFinite";
    if (tag === cohPending || tag === cohFailed || tag === cohHidden || tag === cohUnsupported) return "unread";
    return "placeholder";
  }

  // The cells cohort (C.4.3), shared by cells, motionCells and the lens. Returns the Cohort record or
  // {ok: false, reason}.
  function cohCollect(kind, input) {
    if (input === null || typeof input !== "object") throw new TypeError("E.cohort needs an input object");
    if (!Array.isArray(input.cells)) throw new TypeError("E.cohort needs the cells array");
    const mode = input.mode;
    const spec = API.measure.MODES[mode];
    if (!spec) throw new TypeError("unknown measure mode: " + String(mode));
    const b = cohRect(input.b);
    const ts = cohStep(input, "ts", "n");
    const ps = cohStep(input, "ps", "m");
    const refusal = cohRefusal(input.read, input.loading);
    if (refusal !== null) return { ok: false, reason: refusal };
    // The geometry (occupancy) has no value to fit.
    if (spec.kind === "occupancy") return { ok: false, reason: "unsupported" };
    const geom = input.geom || LATTICE;
    const cut = cohNumber(input.cut, Infinity);
    const end = cohNumber(input.end, Infinity);
    const CUT = cohNumber(input.CUT, Infinity);
    const replay = Boolean(input.replay);
    const measured = typeof input.measured === "function" ? input.measured : null;
    // The data edge a whole cell must not cross: the cutoff, the motion end and, live, the open column (in
    // replay the live edge is a choice, not a limit, so CUT does not apply).
    const edge = Math.min(cut, end, replay ? Infinity : CUT);
    // One kernel and one exposure scratch for the whole pass (the frame's own pattern, DD-85). `measured`
    // and `read` stay out of the kernel: they are decided here, before any value is computed.
    const k = {
      mode,
      basis: input.basis,
      pathBasis: input.pathBasis,
      z: null,
      bounds: b,
      cut,
      end,
      CUT,
      replay,
      geom,
      ts,
      ps,
      level: input.level,
      read: null,
      measured: undefined,
      cascade: input.cascade,
    };
    const out = { tag: 0, value: NaN, signed: false, short: false, reason: null, denominator: null };
    const scratch = {};
    const cells = input.cells;
    const buf = new Float64Array(cells.length);
    const excluded = cohNewExcluded();
    let n = 0;
    let zeros = 0;
    let t0 = Infinity;
    let t1 = -Infinity;
    let r0 = Infinity;
    let r1 = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const z = cells[i];
      // A placeholder (an unread base cell, a motion cell at or after the motion end) is not a member and
      // cannot create a zero cohort. The motion end is also tested here: a cell that starts at or after it
      // was never read, whether or not the page supplied `measured`.
      if ((measured !== null && measured(z) === false) || z.c * ts >= end) {
        excluded.unread++;
        continue;
      }
      if ((z.c + 1) * ts > edge) {
        excluded.open++;
        continue;
      }
      const ex = API.measure.exposure(z, b, cut, end, ts, ps, geom, scratch);
      if (ex.timeFraction < 1 || ex.priceFraction < 1) {
        excluded.partial++;
        continue;
      }
      k.z = z;
      API.measure.cellValue(k, out);
      if (out.tag !== cohFinite) {
        excluded[cohBucketOf(out.tag)]++;
        continue;
      }
      // An unsigned measure takes no negative value (they are counted, not clamped).
      if (!out.signed && out.value < 0) {
        excluded.negative++;
        continue;
      }
      buf[n++] = out.value;
      if (out.value === 0) zeros++;
      if (z.c * ts < t0) t0 = z.c * ts;
      if ((z.c + 1) * ts > t1) t1 = (z.c + 1) * ts;
      if (z.r * ps < r0) r0 = z.r * ps;
      if ((z.r + 1) * ps > r1) r1 = (z.r + 1) * ps;
    }
    return {
      kind,
      values: buf.slice(0, n),
      n,
      zeros,
      nonzero: n - zeros,
      excluded,
      calibratedOn: cohCalibratedOnOf(input, "view"),
      bounds: cohFiniteAll(b) ? b.slice() : null,
      level: cohLevel(input, ts, ps),
      quality: cohQuality(input),
      // The latest edge any member observed (<= the cutoff by construction), and the rectangle the members
      // span in base units: time columns and price rows.
      obsEndBase: n > 0 ? t1 : null,
      support: n > 0 ? { timeBase: [t0, t1], priceRows: [r0, r1] } : { timeBase: null, priceRows: null },
    };
  }

  // E.cohort.cells (API.md C.4.3, S1-081): the fully covered, measured cells of `input.cells` (the drawn
  // cells at the effective level) inside the declared rectangle `b`.
  //   input = { cells, mode, basis, pathBasis, b: [t0,t1,r0,r1], cut, end, CUT, replay, level: {n, m}
  //             (or ts, ps), geom, measured(z), cascade(z, out), read, loading, selection, quality,
  //             calibratedOn, kind }
  // `read` is one read record {state, updating?, stale?, loading?} or an array of them (every read the
  // consumer needs); `selection` says the rectangle is a selection; `kind: "lens"` and `calibratedOn:
  // "lens"` name the lens cohort (the same extraction over the lens rectangle). `end` is Infinity for the
  // volume measures and the motion end for Path and Dwell; `cut` the effective cutoff, `CUT` the live edge.
  function cohCells(input) {
    const kind = input && input.kind === "lens" ? "lens" : "cells";
    return cohCollect(kind, input);
  }

  // E.cohort.motionCells (API.md C.4.3): the same over the motion summary's cells (mv.shown.cells),
  // movement-only cells (ct = 0 with path or dwell) included when they are measured. A base cell of the
  // displayed block that has no motion entry is not in this array; if the page keeps it there,
  // `measured(z)` says false and it is counted `unread`.
  function cohMotionCells(input) {
    return cohCollect("motion", input);
  }

  // E.cohort.rows (API.md C.4.3, S1-083, DD-74): ALL measured rows of the declared period at the effective
  // row size `m`, including rows that are off screen (a peak row off screen still sets U).
  //   input = { rows: [{r, v, bv, w}], measure: "volume" | "delta" | "time", m, res: {state, span?, end?,
  //             stale?}, stale, span: [a, b], cut }
  // Each measure is read only from the result that carries it: the caller passes the rows of the VOLUME
  // result for volume and delta and those of the DWELL result for time (a dwell result's bands have v = bv =
  // 0, so volume read from them would be a false all-zero cohort, rows-underlay gotcha 5). A missing field
  // is a non-number and is counted `nonFinite`, never read as zero. `span` is the period's span as the
  // page has it NOW: a result that ends elsewhere is the previous period's and is refused as stale (a fit
  // made from it would calibrate the new period on the old one, data-lifecycle 1.10 #4). Relative volume has
  // a fixed domain and no cohort.
  function cohRows(input) {
    if (input === null || typeof input !== "object") throw new TypeError("E.cohort needs an input object");
    if (!Array.isArray(input.rows)) throw new TypeError("E.cohort.rows needs the rows array");
    const measure = input.measure;
    const spec = API.measure.ROWS[measure];
    if (!spec) throw new TypeError("unknown Rows measure: " + String(measure));
    if (!Number.isInteger(input.m) || input.m < 0) throw new TypeError("E.cohort.rows needs the effective row size m (a non-negative integer)");
    // Relative volume is a fixed domain: there is no cohort, whatever the reads say.
    if (spec.kind !== "unbounded") return { ok: false, reason: "unsupported" };
    const res = input.res || null;
    if (res !== null && res.state === "failed") return { ok: false, reason: "failed" };
    const periodSpan = Array.isArray(input.span) ? input.span : null;
    const resSpan = res !== null && Array.isArray(res.span) ? res.span : null;
    if (input.stale || (res !== null && res.stale) || (periodSpan !== null && resSpan !== null && resSpan[1] !== periodSpan[1])) return { ok: false, reason: "stale" };
    if (res === null || res.state !== "ready") return { ok: false, reason: "pending" };
    const cut = cohNumber(input.cut, Infinity);
    const rows = input.rows;
    const buf = new Float64Array(rows.length);
    const excluded = cohNewExcluded();
    let n = 0;
    let zeros = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const x = rows[i];
      const value = measure === "volume" ? x.v : measure === "delta" ? 2 * x.bv - x.v : x.w;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        excluded.nonFinite++;
        continue;
      }
      if (!spec.signed && value < 0) {
        excluded.negative++;
        continue;
      }
      buf[n++] = value;
      if (value === 0) zeros++;
      if (x.r < lo) lo = x.r;
      if (x.r > hi) hi = x.r;
    }
    // Where the result observed to: the period's end (Time at price: the last complete base column the
    // dwell covers), never beyond the cutoff.
    const edge = measure === "time" && res.end !== undefined ? res.end : resSpan !== null ? resSpan[1] : periodSpan !== null ? periodSpan[1] : null;
    const obsEndBase = typeof edge === "number" && Number.isFinite(edge) ? Math.min(edge, cut) : null;
    const from = resSpan !== null ? resSpan[0] : periodSpan !== null ? periodSpan[0] : null;
    const step = Math.pow(2, input.m);
    return {
      kind: "rows",
      values: buf.slice(0, n),
      n,
      zeros,
      nonzero: n - zeros,
      excluded,
      calibratedOn: "period",
      bounds: null,
      level: null,
      quality: typeof input.quality === "string" ? input.quality : null,
      obsEndBase,
      support: {
        timeBase: obsEndBase !== null && typeof from === "number" && Number.isFinite(from) ? [from, obsEndBase] : null,
        priceRows: n > 0 && Number.isFinite(lo) ? [lo * step, (hi + 1) * step] : null,
      },
    };
  }

  // E.cohort.columns (API.md C.4.3, DD-12, DD-73): COUNTS ONLY over the displayed columns of a pane measure,
  // {n, complete, partial, open, zeros}. `open` is a column that runs past the cutoff, the data end or (live)
  // the open column; `partial` one that sticks out of the measured time range; `complete` the rest. `zeros`
  // counts the displayed columns whose measure is a finite zero. It never returns values and it is never a
  // fit: the axis scans the displayed values itself and only reports these counts in its provenance.
  //   input = { columns: [{c, ...column summary}], key: a E.measure.columnValue key, b, cut, end, CUT,
  //             replay, level: {n} (or ts), ctx | ctxFor(col) }
  function cohColumns(input) {
    if (input === null || typeof input !== "object") throw new TypeError("E.cohort needs an input object");
    if (!Array.isArray(input.columns)) throw new TypeError("E.cohort.columns needs the columns array");
    if (typeof input.key !== "string") throw new TypeError("E.cohort.columns needs the column measure key");
    const b = cohRect(input.b);
    const ts = cohStep(input, "ts", "n");
    const cut = cohNumber(input.cut, Infinity);
    const end = cohNumber(input.end, Infinity);
    const CUT = cohNumber(input.CUT, Infinity);
    const edge = Math.min(cut, end, input.replay ? Infinity : CUT);
    const ctxFor = typeof input.ctxFor === "function" ? input.ctxFor : null;
    const out = { tag: 0, value: NaN, reason: null, denominator: null };
    const cols = input.columns;
    let partial = 0;
    let open = 0;
    let zeros = 0;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if ((col.c + 1) * ts > edge) open++;
      else if (col.c * ts < b[0] || (col.c + 1) * ts > b[1]) partial++;
      API.measure.columnValue(input.key, col, ctxFor !== null ? ctxFor(col) : input.ctx, out);
      if (out.tag === cohFinite && out.value === 0) zeros++;
    }
    return { n: cols.length, complete: cols.length - partial - open, partial, open, zeros };
  }

  API.cohort = Object.freeze({
    cells: cohCells,
    motionCells: cohMotionCells,
    rows: cohRows,
    columns: cohColumns,
  });
