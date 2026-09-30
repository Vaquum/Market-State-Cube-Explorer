  // @part 10-context
  // @requires 01-util
  // @prefix ctx
  // @provides context
  // == §10 context: the identity of a calibration context, its key string, period identities and the Comparison-lock class (API.md B.7, C.8) ==
  // A context key says WHICH calibration a mapping belongs to: the measure and its basis and unit, the
  // transform, the measurement quality, the workspace and, for Cells, the EFFECTIVE level (n, m), for Rows the
  // period identity and the effective row size. It is NOT a mapping id (the id hashes the numbers of the
  // mapping, C.7) and no key equals an id. Pure: nothing here reads a clock or the page.

  // The catalogue of API.md B.3 as this part needs it: the formula id, the compatibility family, the
  // canonical unit and whether the measure is signed, per (measure, basis). It repeats E.measure.FORMULAS on
  // purpose (part 05 is not a dependency of this part, so contexts can be built and tested without it);
  // U24 compares the two tables whenever both parts are loaded, so a change of one without the other fails.
  // `fixed` measures have a natural fixed domain and no store; they still get a key (disclosure, diff).
  const ctxCellFormulas = Object.freeze({
    volume: Object.freeze({
      amount: Object.freeze({ formula: "cells.volume.amount@1", family: "amount.usdt", unit: "usdt", signed: false }),
      intensity: Object.freeze({ formula: "cells.volume.intensity@1", family: "intensity.usdt", unit: "usdt-per-min-per-125usdt", signed: false }),
    }),
    trades: Object.freeze({
      amount: Object.freeze({ formula: "cells.trades.amount@1", family: "amount.trades", unit: "trades", signed: false }),
      intensity: Object.freeze({ formula: "cells.trades.intensity@1", family: "intensity.trades", unit: "trades-per-min-per-125usdt", signed: false }),
    }),
    delta: Object.freeze({
      amount: Object.freeze({ formula: "cells.delta.amount@1", family: "delta.usdt", unit: "usdt", signed: true }),
      intensity: Object.freeze({ formula: "cells.delta.intensity@1", family: "intensity.delta", unit: "usdt-per-min-per-125usdt", signed: true }),
    }),
    size: Object.freeze({
      mean: Object.freeze({ formula: "cells.size.mean@1", family: "size.usdt-per-trade", unit: "usdt-per-trade", signed: false }),
    }),
    path: Object.freeze({
      spans: Object.freeze({ formula: "cells.path.spans@1", family: "path.spans", unit: "row-spans", signed: false }),
      usdt: Object.freeze({ formula: "cells.path.usdt@1", family: "path.usdt", unit: "usdt", signed: false }),
      perMinute: Object.freeze({ formula: "cells.path.perminute@1", family: "path.perminute", unit: "row-spans-per-min", signed: false }),
    }),
    dwell: Object.freeze({ share: Object.freeze({ formula: "cells.dwell.share@1", family: "fixed.share", unit: "share", signed: false }) }),
    flow: Object.freeze({ share: Object.freeze({ formula: "cells.flow.share@1", family: "fixed.share", unit: "share", signed: true }) }),
    flowtrades: Object.freeze({ share: Object.freeze({ formula: "cells.flowtrades.share@1", family: "fixed.share", unit: "share", signed: true }) }),
    cascade: Object.freeze({ log2: Object.freeze({ formula: "cells.cascade.log2@1", family: "fixed.log2-ratio", unit: "log2-ratio", signed: true }) }),
  });
  // The Cells measures that have a natural fixed domain, and the ones Rank is offered for (unsigned unbounded
  // measures only, DD-09).
  const ctxCellFixed = Object.freeze(["dwell", "flow", "flowtrades", "cascade"]);
  const ctxCellRank = Object.freeze(["volume", "trades", "size", "path"]);
  // The default basis of a measure when the caller gives none, and the only basis of a measure that has one.
  const ctxCellDefaultBasis = Object.freeze({ volume: "amount", trades: "amount", delta: "amount", size: "mean", path: "spans", dwell: "share", flow: "share", flowtrades: "share", cascade: "log2" });

  const ctxRowFormulas = Object.freeze({
    volume: Object.freeze({ formula: "rows.volume.amount@1", family: "amount.usdt", unit: "usdt", signed: false, basis: "period-amount-per-row" }),
    delta: Object.freeze({ formula: "rows.delta.amount@1", family: "delta.usdt", unit: "usdt", signed: true, basis: "period-amount-per-row" }),
    time: Object.freeze({ formula: "rows.time.seconds@1", family: "time.seconds", unit: "seconds", signed: false, basis: "period-amount-per-row" }),
    relvol: Object.freeze({ formula: "rows.relvol@2", family: "fixed.log2-ratio", unit: "log2-ratio", signed: true, basis: "log2-ratio" }),
  });
  const ctxRowFixed = Object.freeze(["relvol"]);
  const ctxRowRank = Object.freeze(["volume", "time"]);

  // formula name WITHOUT its version -> {family, signed}: what compatClass reads from a context. The version
  // is not part of the class (E.scale.compat compares it separately and names it), so a mapping persisted
  // under an older formula version still has a class and is refused for its version, not for an unknown name.
  const ctxFormulaFacts = ctxIndexFormulas();

  function ctxFormulaName(formula) {
    const at = typeof formula === "string" ? formula.lastIndexOf("@") : -1;
    return at < 0 ? formula : formula.slice(0, at);
  }

  function ctxIndexFormulas() {
    const facts = {};
    const measures = Object.keys(ctxCellFormulas);
    for (let i = 0; i < measures.length; i++) {
      const bases = Object.keys(ctxCellFormulas[measures[i]]);
      for (let j = 0; j < bases.length; j++) {
        const f = ctxCellFormulas[measures[i]][bases[j]];
        facts[ctxFormulaName(f.formula)] = Object.freeze({ family: f.family, signed: f.signed });
      }
    }
    const rows = Object.keys(ctxRowFormulas);
    for (let i = 0; i < rows.length; i++) {
      const f = ctxRowFormulas[rows[i]];
      facts[ctxFormulaName(f.formula)] = Object.freeze({ family: f.family, signed: f.signed });
    }
    return Object.freeze(facts);
  }

  const ctxWorkspaces = Object.freeze(["live", "replay"]);
  // The grammar of a Rows period identity (periodIdentity below writes exactly these) and of a quality.
  const ctxPeriodPattern = /^(roll:[1-9][0-9]*|cal:(wk|mo|yr):[0-9]{4}-[0-9]{2}-[0-9]{2}|day:[0-9]{4}-[0-9]{2}-[0-9]{2}|all:[0-9]{4}-[0-9]{2}-[0-9]{2})$/;
  const ctxRowQualityPattern = /^(exact|approx-start|approx-rows:[1-9][0-9]*)$/;
  // The rolling periods of the page's LINES, in days: the fallback when the environment gives no `days`.
  const ctxRollingDays = Object.freeze({ "1d": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365, "3y": 1095 });
  const ctxDayPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

  // A real calendar date written YYYY-MM-DD (the page's isDay also demands it be the UTC day it names).
  function ctxRealDay(text) {
    if (!ctxDayPattern.test(text)) return false;
    const y = +text.slice(0, 4);
    const mo = +text.slice(5, 7);
    const d = +text.slice(8, 10);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const last = mo === 2 ? (leap ? 29 : 28) : mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31;
    return mo >= 1 && mo <= 12 && d >= 1 && d <= last;
  }

  function ctxIsObject(x) {
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function ctxLevel(x, name) {
    if (!Number.isInteger(x) || x < 0) throw new RangeError("context: " + name + " must be a non-negative integer");
    return x;
  }

  // A text field of a key: never contains the separator, so the key string is injective.
  function ctxText(x, name) {
    if (typeof x !== "string" || x.length === 0 || x.length > LIMITS.STRING_MAX || x.indexOf("|") >= 0) throw new RangeError("context: " + name + " must be a short text without \"|\"");
    return x;
  }

  function ctxWorkspace(spec) {
    const ws = spec.workspace === undefined ? "live" : spec.workspace;
    if (ctxWorkspaces.indexOf(ws) < 0) throw new RangeError("context: workspace must be live or replay");
    return ws;
  }

  // The `transform` field of B.7 (DD-43): "value-log", "value-linear", "rank", or "fixed" for a measure with
  // a natural fixed domain. The caller may pass what E.policy.effective returns ({transform:"value"|"rank",
  // curve:"log"|"linear"}) or the finished names. A curve change is a different context, so a linear fit never
  // overwrites a log fit.
  function ctxTransform(spec, fixed, rankOk, measure) {
    if (fixed) return "fixed";
    const t = spec.transform === undefined ? "value" : spec.transform;
    if (t === "rank") {
      if (!rankOk) throw new RangeError("context: rank is not offered for " + measure);
      return "rank";
    }
    if (t === "value" || t === "value-log" || t === "value-linear") {
      const curve = t === "value-linear" ? "linear" : t === "value-log" ? "log" : spec.curve === undefined ? "log" : spec.curve;
      if (curve !== "log" && curve !== "linear") throw new RangeError("context: curve must be log or linear");
      return "value-" + curve;
    }
    throw new RangeError("context: unknown transform " + String(t));
  }

  // The Cells basis of a measure, from what E.policy.effective gives: Volume, Trades and Delta take
  // `basis` (amount | intensity); Path takes `pathBasis` (spans | usdt | perMinute); every other measure has
  // exactly one basis and ignores what it is given (effective() has already coerced a choice the measure
  // does not offer, and the raw preference must not change the key).
  function ctxCellBasis(spec, measure) {
    if (measure === "path") {
      const pb = spec.pathBasis === undefined ? "spans" : spec.pathBasis;
      if (!Object.prototype.hasOwnProperty.call(ctxCellFormulas.path, pb)) throw new RangeError("context: unknown path basis " + String(pb));
      return pb;
    }
    if (measure === "volume" || measure === "trades" || measure === "delta") {
      const b = spec.basis === undefined ? "amount" : spec.basis;
      if (b !== "amount" && b !== "intensity") throw new RangeError("context: basis must be amount or intensity");
      return b;
    }
    return ctxCellDefaultBasis[measure];
  }

  // E.context.cellsKey (API.md A.3, B.7, DR-06): the Cells context of one displayed level.
  //   spec = {measure (S.mode), basis, pathBasis, transform, curve, n, m, workspace?, instrument?, lens?}
  // n and m are the EFFECTIVE level (renderN, renderM): a requested level that differs while the effective
  // one is equal gives the SAME key, and a coarser-than-requested display keys on the level it shows.
  // Anything else on the spec (theme, token, selection, cutoff, src.id) is ignored: none of it is identity
  // (D4). Quality is `exact` and only `exact`: "approximate" is reserved and is never emitted (DR-08); a
  // spec that asks for another quality throws. `geometry` has no calibration and throws.
  // With spec.lens = {bounds:[b0,b1,b2,b3], n, m} the result is the Local-contrast context of the lens
  // (B.7): {consumer:"lens", base:<the Cells context>, bounds, n, m}. It has its own key and is never stored
  // in the 64-context LRU.
  function ctxCellsKey(spec) {
    if (!ctxIsObject(spec)) throw new TypeError("cellsKey needs a spec object");
    const measure = spec.measure;
    if (typeof measure !== "string" || !Object.prototype.hasOwnProperty.call(ctxCellFormulas, measure)) throw new RangeError("context: no calibration context for measure " + String(measure));
    if (spec.quality !== undefined && spec.quality !== "exact") throw new RangeError("context: Cells quality is exact only");
    const basis = ctxCellBasis(spec, measure);
    const f = ctxCellFormulas[measure][basis];
    const fixed = ctxCellFixed.indexOf(measure) >= 0;
    const ctx = {
      consumer: "cells",
      instrument: spec.instrument === undefined ? "BTC/USDT" : ctxText(spec.instrument, "instrument"),
      measure,
      basis,
      unit: f.unit,
      transform: ctxTransform(spec, fixed, ctxCellRank.indexOf(measure) >= 0, measure),
      formula: f.formula,
      quality: "exact",
      workspace: ctxWorkspace(spec),
      n: ctxLevel(spec.n, "n"),
      m: ctxLevel(spec.m, "m"),
    };
    Object.freeze(ctx);
    if (spec.lens === undefined || spec.lens === null) return ctx;
    const lens = spec.lens;
    if (!ctxIsObject(lens) || !Array.isArray(lens.bounds) || lens.bounds.length !== 4) throw new TypeError("context: a lens needs bounds [b0, b1, b2, b3]");
    for (let i = 0; i < 4; i++) if (typeof lens.bounds[i] !== "number" || !Number.isFinite(lens.bounds[i])) throw new RangeError("context: lens bounds must be finite numbers");
    return Object.freeze({ consumer: "lens", base: ctx, bounds: Object.freeze(lens.bounds.slice()), n: ctxLevel(lens.n, "lens n"), m: ctxLevel(lens.m, "lens m") });
  }

  // E.context.rowsKey (API.md A.3, B.7, DR-08, DR-06): the Rows context of one period at one row size.
  //   spec = {measure (volume | delta | time | relvol), transform, curve, quality, period, rowSize,
  //           workspace?, instrument?}
  // `period` is the identity string of periodIdentity; `rowSize` the effective row size (a level m). There is
  // NO n: Rows do not depend on the column level. Quality is `exact`, `approx-rows:<rowPrice>` (recorded
  // rows coarser than the base row) or `approx-start`; the trimmed start of a coarse period is provenance,
  // not identity. The advancing endpoint of a period is never in the key.
  function ctxRowsKey(spec) {
    if (!ctxIsObject(spec)) throw new TypeError("rowsKey needs a spec object");
    const measure = spec.measure;
    if (typeof measure !== "string" || !Object.prototype.hasOwnProperty.call(ctxRowFormulas, measure)) throw new RangeError("context: no Rows context for measure " + String(measure));
    const f = ctxRowFormulas[measure];
    const quality = spec.quality === undefined ? "exact" : spec.quality;
    if (typeof quality !== "string" || !ctxRowQualityPattern.test(quality)) throw new RangeError("context: unknown Rows quality " + String(quality));
    if (typeof spec.period !== "string" || !ctxPeriodPattern.test(spec.period)) throw new RangeError("context: a Rows period is a periodIdentity string");
    return Object.freeze({
      consumer: "rows",
      instrument: spec.instrument === undefined ? "BTC/USDT" : ctxText(spec.instrument, "instrument"),
      measure,
      basis: f.basis,
      unit: f.unit,
      transform: ctxTransform(spec, ctxRowFixed.indexOf(measure) >= 0, ctxRowRank.indexOf(measure) >= 0, measure),
      formula: f.formula,
      quality,
      workspace: ctxWorkspace(spec),
      period: spec.period,
      rowSize: ctxLevel(spec.rowSize, "rowSize"),
    });
  }

  // E.context.keyString (API.md A.3, B.7): the string whose equality IS context equality.
  //   cells|instrument|measure|basis|unit|transform|formula|quality|workspace|n<n>m<m>
  //   rows |instrument|measure|basis|unit|transform|formula|quality|workspace|<period>|m<rowSize>
  //   lens |<the Cells key string>|b<b0>,<b1>,<b2>,<b3>|n<n>m<m>
  // Every field is free of "|", so two different contexts never share a string. Throws on a malformed
  // context (an import is validated before its keys are used).
  function ctxKeyString(ctx) {
    if (!ctxIsObject(ctx)) throw new TypeError("keyString needs a context object");
    if (ctx.consumer === "lens") {
      if (!ctxIsObject(ctx.base) || ctx.base.consumer !== "cells" || !Array.isArray(ctx.bounds) || ctx.bounds.length !== 4) throw new TypeError("context: a lens context holds a Cells base and four bounds");
      return "lens|" + ctxKeyString(ctx.base) + "|b" + ctx.bounds.join(",") + "|n" + ctxLevel(ctx.n, "lens n") + "m" + ctxLevel(ctx.m, "lens m");
    }
    if (ctx.consumer !== "cells" && ctx.consumer !== "rows") throw new RangeError("context: consumer must be cells or rows");
    const head = [ctx.consumer, ctx.instrument, ctx.measure, ctx.basis, ctx.unit, ctx.transform, ctx.formula, ctx.quality, ctx.workspace];
    for (let i = 0; i < head.length; i++) ctxText(head[i], "field " + i);
    if (ctx.consumer === "cells") return head.join("|") + "|n" + ctxLevel(ctx.n, "n") + "m" + ctxLevel(ctx.m, "m");
    if (typeof ctx.period !== "string" || !ctxPeriodPattern.test(ctx.period)) throw new RangeError("context: a Rows period is a periodIdentity string");
    return head.join("|") + "|" + ctx.period + "|m" + ctxLevel(ctx.rowSize, "rowSize");
  }

  // E.context.equal (API.md A.3, C.8): exact-key equality (keys and counts, never volumes).
  function ctxEqual(a, b) {
    if (!ctxIsObject(a) || !ctxIsObject(b)) return false;
    return ctxKeyString(a) === ctxKeyString(b);
  }

  // E.context.periodIdentity (API.md A.3, B.7, DR-06, D4): what a Rows period IS, so that a period that
  // grows does not become a new context every minute and a rollover does.
  //   rolling  1d 7d 30d 90d 1y 3y -> "roll:<days>"         (the duration; span[0] slides and is not identity)
  //   calendar wk mo yr            -> "cal:<wk|mo|yr>:<UTC date of span[0]>"   (the resolved start)
  //   a chosen day YYYY-MM-DD      -> "day:<that date>"      (its anchor)
  //   all history                  -> "all:<UTC date of T0>" (the history start, 2021-01-01)
  // `span` is [start, end] in base columns as the page's lineSpan gives it; its end is never used.
  // env = {days?(key) -> number, T0?, BASE?}: the page passes its LINES table and PACK.t0/base_seconds; the
  // defaults are the recorded lattice and the page's rolling periods. An unknown key throws.
  function ctxPeriodIdentity(key, span, env) {
    const e = env || {};
    const T0 = e.T0 === undefined ? LATTICE.T0 : e.T0;
    const BASE = e.BASE === undefined ? LATTICE.BASE : e.BASE;
    if (typeof key !== "string") throw new TypeError("periodIdentity needs a period key");
    if (key === "all") return "all:" + API.time.utcDay(T0 * 1000);
    if (key === "wk" || key === "mo" || key === "yr") {
      if (!Array.isArray(span) || typeof span[0] !== "number" || !Number.isFinite(span[0])) throw new TypeError("periodIdentity: a calendar period needs its span");
      return "cal:" + key + ":" + API.time.utcDay(API.time.baseToMs(span[0], T0, BASE));
    }
    if (ctxRealDay(key)) return "day:" + key;
    const days = typeof e.days === "function" ? e.days(key) : ctxRollingDays[key];
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0 || days !== Math.floor(days)) throw new RangeError("periodIdentity: unknown period " + key);
    return "roll:" + days;
  }

  // The fields a diff compares, in the order `changed` lists them; a lens context is flattened to its Cells
  // base plus its own level and bounds.
  const ctxDiffFields = Object.freeze(["consumer", "instrument", "measure", "basis", "unit", "transform", "formula", "quality", "workspace", "n", "m", "period", "rowSize", "lensN", "lensM", "lensBounds"]);

  function ctxFlat(ctx) {
    if (ctx.consumer === "lens") {
      const flat = Object.assign({}, ctx.base);
      flat.consumer = "lens";
      flat.lensN = ctx.n;
      flat.lensM = ctx.m;
      flat.lensBounds = ctx.bounds.join(",");
      return flat;
    }
    return ctx;
  }

  // E.context.diff (API.md A.3, C.8, A-39): what changed between two contexts and why it is disclosed.
  //   changed  the field names that differ (in ctxDiffFields order)
  //   cause    the causes joined with "/" in this order, each a key of E.text.note.cause.*:
  //            resolution (n, m, lens level or rowSize), period, measure, basis, transform, quality,
  //            workspace; both a level and a period change give "resolution/period". A change of measure
  //            subsumes the basis, unit, formula and transform it brings with it. The caller adds `lock`,
  //            `pin`, `policy`, `fit`. null when nothing has a cause (or either side is missing).
  function ctxDiff(prev, next) {
    if (!ctxIsObject(prev) || !ctxIsObject(next)) return { changed: [], cause: null };
    const a = ctxFlat(prev);
    const b = ctxFlat(next);
    const changed = [];
    for (let i = 0; i < ctxDiffFields.length; i++) {
      const name = ctxDiffFields[i];
      if (a[name] !== b[name]) changed.push(name);
    }
    const has = (name) => changed.indexOf(name) >= 0;
    const measure = has("measure");
    const causes = [];
    if (has("n") || has("m") || has("rowSize") || has("lensN") || has("lensM")) causes.push("resolution");
    if (has("period")) causes.push("period");
    if (measure) causes.push("measure");
    if (!measure && (has("basis") || has("unit") || has("formula"))) causes.push("basis");
    if (!measure && has("transform")) causes.push("transform");
    if (has("quality")) causes.push("quality");
    if (has("workspace")) causes.push("workspace");
    return { changed, cause: causes.length ? causes.join("/") : null };
  }

  // The Ctx inside x: a Ctx (a lens through its Cells base), or the `ctx` of a Calibration; null otherwise.
  function ctxOf(x) {
    if (!ctxIsObject(x)) return null;
    const c = ctxIsObject(x.ctx) ? x.ctx : x.consumer !== undefined ? x : null;
    return c && c.consumer === "lens" ? c.base : c;
  }

  // E.context.compatClass (API.md A.3, C.8, DR-07, DD-65): the Comparison-lock class,
  //   family "|" transformKind "|" ("s" | "u") "|" ("type7-257@1" | "-")
  // with transformKind in log1p | linear | rank | fixed. For a Cells Amount context that is
  // "amount.usdt|log1p|u|-", and Rows Amount gives the same string (both are amount.usdt); the held-mapping
  // key adds the channel (DD-65) so the two are still held separately. A bare Descriptor has no family: its
  // family reads "-" and E.scale.compat then skips the family and version checks.
  function ctxCompatClass(x) {
    const ctx = ctxOf(x);
    if (ctx) {
      const facts = ctxFormulaFacts[ctxFormulaName(ctx.formula)];
      if (!facts) throw new RangeError("compatClass: unknown formula " + String(ctx.formula));
      const kind = ctx.transform === "value-log" ? "log1p" : ctx.transform === "value-linear" ? "linear" : ctx.transform === "rank" ? "rank" : ctx.transform === "fixed" ? "fixed" : null;
      if (kind === null) throw new RangeError("compatClass: unknown transform " + String(ctx.transform));
      // The rank algorithm is the one this build writes unless a Calibration carries a descriptor that names
      // another (a mapping imported from a later version): then the classes differ and the lock says why.
      const alg = x.desc && x.desc.kind === "rank-type7-257" && typeof x.desc.algorithm === "string" ? x.desc.algorithm : "type7-257@1";
      return facts.family + "|" + kind + "|" + (facts.signed ? "s" : "u") + "|" + (kind === "rank" ? alg : "-");
    }
    if (!ctxIsObject(x) || typeof x.kind !== "string") throw new TypeError("compatClass needs a context, a calibration or a descriptor");
    const kind = x.kind === "value-log1p" ? "log1p" : x.kind === "value-linear" ? "linear" : x.kind === "rank-type7-257" ? "rank" : x.kind === "zero-only" || x.kind === "none" ? "none" : "fixed";
    const alg = typeof x.algorithm === "string" ? x.algorithm : "type7-257@1";
    return "-|" + kind + "|" + (x.signed ? "s" : "u") + "|" + (kind === "rank" ? alg : "-");
  }

  API.context = Object.freeze({
    cellsKey: ctxCellsKey,
    rowsKey: ctxRowsKey,
    keyString: ctxKeyString,
    equal: ctxEqual,
    periodIdentity: ctxPeriodIdentity,
    diff: ctxDiff,
    compatClass: ctxCompatClass,
  });
