  // @part 19-readout
  // @requires 01-util 03-result 05-measure 06-ratio 08-scale 10-context 11-lut 12-role
  // @prefix rdo
  // @provides readout
  // == §19 readout: one frame behind the encoder, the tooltip, the table and the legend marker (API.md B.10, C.16, DD-17, DD-85) ==
  // A Frame is built ONCE per draw for one channel (Cells, Rows, a pane). It holds everything a mark needs:
  // the kernel of the physical measurement, the plan of the numerical mapping, the colour tables. Two
  // functions hang off it and run the SAME three calls (E.measure.cellValue -> the plan -> the LUT):
  //   encode(z, out)    allocation-free; writes an integer role, a table index, a clip code and the CSS
  //                     colour of ONE mark into the caller's scratch `out`;
  //   readout(z, extra) allocating; runs the same encode into a private scratch and builds the Readout of
  //                     B.10, for the cells somebody inspects.
  // The numbers of the canvas, the tooltip, the table row and the legend marker can therefore not differ:
  // there is one computation, not four that agree (S1-008, S1-019, DR-22). This part reads no clock, no
  // page and no palette: the Lut and the resolved mapping are arguments. It never formats a number for
  // display (a formatter is a legend argument, S1-011): readouts hold canonical numbers only.
  //
  // The scratch `out` is ANY object: encode assigns every field it promises on every call, so a stale
  // value cannot leak from the previous mark. Fields: tag (index in E.result.TAGS; 0 = a value), value (NaN
  // unless tag 0), signed, short, reason, denominator (from E.measure.cellValue), role (ROLE code), idx
  // (table index, -1 when the colour is not a table entry), clip (E.scale.CLIP), t (the scale coordinate:
  // 0..1 unsigned, -1..1 signed), pattern (a glyph id or null), css (the colour, null for a pattern or no
  // fill). `geometry` mode has no measurement: its tag is 0 and its value NaN, and role OCCUPANCY says it.

  // Frozen small-integer codes (C.16). ROWS is the raw Rows-band role of DD-86 (the canvas paints it at the
  // fixed Rows alpha); Delta and Relative-volume bands use POSITIVE, NEGATIVE and MIDPOINT.
  const rdoRole = Object.freeze({ NONE: 0, UNSIGNED: 1, POSITIVE: 2, NEGATIVE: 3, MIDPOINT: 4, PATTERN: 5, OCCUPANCY: 6, ZERO: 7, ROWS: 8 });
  const rdoRoleNone = 0;
  const rdoRoleUnsigned = 1;
  const rdoRolePositive = 2;
  const rdoRoleNegative = 3;
  const rdoRoleMidpoint = 4;
  const rdoRolePattern = 5;
  const rdoRoleOccupancy = 6;
  const rdoRoleZero = 7;
  const rdoRoleRows = 8;
  // The LUT role names a readout states (the `role` of its coordinate): never RGB, which is derivable.
  const rdoRoleNames = Object.freeze(["none", "unsigned", "positive", "negative", "midpoint", "pattern", "occupancy", "zero", "rows"]);
  const rdoClipNames = Object.freeze(["none", "low", "high", "exact-low", "exact-high"]);
  // cellKey(c, r) of explorer.js (line 559): the numeric key of a cell; carried so the tooltip, the table
  // row and the marker can be matched without parsing.
  const rdoCellStride = 2097152;
  // Lut.bar is unsigned entry 160 (DD-87): a constant bar's readout states the entry it is drawn with.
  const rdoBarIndex = 160;
  // The glyph that marks each tag of E.result.TAGS, by tag index (E.role.glyphFor once, at load: the
  // per-cell path is one array read). `null` = no mark of its own (finite, outside-support, hidden).
  const rdoTag = API.result.TAG;
  const rdoFinite = rdoTag["finite"];
  const rdoUndefined = rdoTag["undefined"];
  const rdoInvalid = rdoTag["invalid-input"];
  const rdoPending = rdoTag["pending"];
  const rdoFailed = rdoTag["failed"];
  const rdoUnsupported = rdoTag["unsupported"];
  const rdoGlyphByTag = API.result.TAGS.map((tag) => API.role.glyphFor(tag));
  const rdoProbeCell = Object.freeze({ c: 0, r: 0, v: 0, bv: 0, ct: 0, bt: 0, p: 0, w: 0 });

  // ---- small helpers (allocating paths only) ----------------------------------------------------------

  function rdoNum(x) {
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  }

  function rdoText(x) {
    return typeof x === "string" ? x : null;
  }

  // A programmer error is loud (DD-91: the page wraps frame construction in its fault guard).
  function rdoRequire(ok, message) {
    if (!ok) throw new TypeError("E.readout: " + message);
  }

  function rdoIsDescriptor(m) {
    return m !== null && typeof m === "object" && typeof m.kind === "string" && typeof m.signed === "boolean" && m.clip !== undefined;
  }

  // The mapping a frame draws with, from what the caller has: a bare Descriptor (a fixed mapping: Flow,
  // Dwell, Cascade, Relative volume), a Resolved record of E.policy.resolve (`{state, record, policy,
  // external, reason}`, or `{state, desc, ...}`), or nothing (No calibration). `state` is "ok",
  // "no-calibration", "updating" or "pending": a frame draws values only for a mapping it has a
  // descriptor for and whose state is neither no-calibration nor pending (C.16); "updating" keeps the
  // retained mapping drawing and only the legend says so (DR-06).
  function rdoMapping(m) {
    if (m === null || m === undefined) return { state: "no-calibration", desc: null, policy: null, origin: null, external: false, record: null, reason: "uninitialized" };
    if (rdoIsDescriptor(m)) return { state: "ok", desc: m.kind === "none" ? null : m, policy: "fixed", origin: "fixed", external: false, record: null, reason: null };
    const record = m.record !== undefined && m.record !== null ? m.record : null;
    let desc = m.desc !== undefined ? m.desc : record !== null ? record.desc : null;
    if (desc === undefined || desc === null || desc.kind === "none") desc = null;
    const policy = m.policy !== undefined && m.policy !== null ? m.policy : record !== null && record.policy !== undefined ? record.policy : null;
    const origin = m.origin !== undefined && m.origin !== null ? m.origin : record !== null && record.origin !== undefined ? record.origin : null;
    return { state: typeof m.state === "string" ? m.state : "ok", desc, policy, origin, external: m.external === true, record, reason: typeof m.reason === "string" ? m.reason : null };
  }

  // May this mapping colour marks at all?
  function rdoDrawable(map) {
    return map.desc !== null && map.state !== "no-calibration" && map.state !== "pending";
  }

  // A descriptor whose signedness disagrees with the measure is a wiring error: a signed measure needs
  // its two arms, an unsigned one must never paint an arm.
  function rdoCheckSigned(map, signed, what) {
    if (map.desc !== null && map.desc.signed !== signed) throw new RangeError("E.readout: a " + (map.desc.signed ? "signed" : "unsigned") + " mapping cannot colour " + what + ", a " + (signed ? "signed" : "unsigned") + " measure");
  }

  // The transform id a context and the DOM state speak (D.18 data-transform), from the descriptor: the
  // kinds map to value-log, value-linear, rank or fixed; a zero-only calibration has no curve of its own,
  // so it reads as the default Value curve unless the caller says otherwise (`spec.transformId`).
  function rdoTransformOf(desc, override) {
    if (typeof override === "string") return override;
    if (desc === null) return null;
    switch (desc.kind) {
      case "value-log1p":
        return "value-log";
      case "value-linear":
        return "value-linear";
      case "rank-type7-257":
        return "rank";
      case "fixed-linear":
      case "fixed-diverging":
        return "fixed";
      case "axis-linear":
        return "axis";
      default:
        return "value-log";
    }
  }

  function rdoFingerprint(mappingId, state, lut) {
    return [mappingId, state, lut.id, lut.theme].join("|");
  }

  function rdoContextKey(spec, map) {
    if (spec.ctx !== undefined && spec.ctx !== null) return API.context.keyString(spec.ctx);
    if (typeof spec.contextKey === "string") return spec.contextKey;
    return map.record !== null && typeof map.record.key === "string" ? map.record.key : null;
  }

  // ---- the observation, scale, state blocks of a readout (B.10) -------------------------------------------

  // B.2 as a readout carries it. `read` (from `extra`, because meas.state feeds readouts and legends but
  // never a mark's fill, DD-84) wins over the frame's own observation. Everything a caller did not give is
  // null, never undefined: a readout is JSON-safe.
  function rdoObservation(obs, readOverride, level) {
    const o = obs !== undefined && obs !== null ? obs : {};
    let read = readOverride !== undefined && readOverride !== null ? readOverride : o.read;
    let updating = o.updating === true;
    if (read !== null && typeof read === "object") {
      if (read.updating === true) updating = true;
      read = read.state;
    }
    return {
      source: rdoText(o.source),
      instrument: rdoText(o.instrument),
      read: rdoText(read),
      updating,
      cutoffMs: rdoNum(o.cutoffMs),
      liveCutoffMs: rdoNum(o.liveCutoffMs),
      canonicalThroughMs: rdoNum(o.canonicalThroughMs),
      token: rdoText(o.token),
      generation: rdoNum(o.generation),
      replay: o.replay === true,
      coverage: typeof o.coverage === "string" ? o.coverage : "range",
      revision: o.revision !== undefined && o.revision !== null ? o.revision : null,
      provenance: Array.isArray(o.provenance) ? o.provenance.slice() : [],
      level: level === null ? null : { n: level.n, m: level.m },
    };
  }

  // The mapping summary of a readout: the id and kind of the descriptor, the policy and origin, the context
  // key, the state, the observation end of the calibration and whether it is an external override.
  function rdoScaleBlock(map, contextKey, warnings) {
    const record = map.record;
    return {
      id: map.desc !== null ? map.desc.id : null,
      kind: map.desc !== null ? map.desc.kind : "none",
      policy: map.policy,
      origin: map.origin,
      contextKey,
      state: map.state,
      obsEndMs: record !== null ? rdoNum(record.obsEndMs) : null,
      external: map.external,
      warnings: Array.isArray(warnings) ? warnings.slice() : [],
    };
  }

  // D7's independent dimensions, kept apart: occupancy, numerical validity, read state, finality,
  // calibration and interaction (support and level are their own fields).
  function rdoStateBlock(typed, observation, finality, calibration, extra) {
    return {
      occupancy: extra !== null && typeof extra.occupancy === "string" ? extra.occupancy : "occupied",
      validity: typed === null ? "none" : typed.tag === "finite" ? "defined" : typed.tag,
      read: observation.read,
      finality,
      calibration,
      interaction: extra !== null && typeof extra.interaction === "string" ? extra.interaction : null,
    };
  }

  function rdoCoordinate(scratch) {
    if (scratch.tag !== rdoFinite || scratch.role === rdoRoleNone || scratch.role === rdoRolePattern || scratch.role === rdoRoleOccupancy) return null;
    return { t: scratch.t, idx: scratch.idx, role: rdoRoleNames[scratch.role], clip: rdoClipNames[scratch.clip] };
  }

  function rdoNewScratch() {
    return { tag: 0, value: NaN, signed: false, short: false, reason: null, denominator: null, role: 0, idx: -1, clip: 0, t: 0, pattern: null, css: null };
  }

  // ---- Cells --------------------------------------------------------------------------------------------

  // The measure identity of a cells frame (formula, basis, unit) through the public E.measure record, asked
  // with an all-zero cell once per frame and only when somebody needs it (readout, legend): the catalogue
  // stays in part 05 and is never repeated here.
  function rdoCellsMeta(kernel) {
    const probe = Object.assign({}, kernel, { z: rdoProbeCell, read: null, replay: false, measured: null, cascade: null, exposure: null, bounds: null });
    const m = API.measure.cellMeasurement(probe);
    return { formula: m.formula, measure: m.measure, basis: m.basis, unit: m.unit };
  }

  function rdoStepOf(level, letter) {
    return Math.pow(2, level[letter]);
  }

  // The support of a cell in base units: its time and price extent clipped to the measured rectangle, the
  // cutoff and (for a motion measure) the motion end. A cell entirely outside keeps an empty extent.
  function rdoCellSupport(z, b, cut, end, ts, ps, state) {
    const t0 = Math.max(z.c * ts, b[0]);
    const t1 = Math.max(t0, Math.min((z.c + 1) * ts, b[1], cut, end));
    const p0 = Math.max(z.r * ps, b[2]);
    const p1 = Math.max(p0, Math.min((z.r + 1) * ps, b[3]));
    return { time: [t0, t1], price: [p0, p1], portion: state.portion, open: state.open, partial: state.partial };
  }

  function rdoExposureRecord(ex) {
    if (ex === null) return null;
    return {
      seconds: rdoNum(ex.seconds),
      width: rdoNum(ex.width),
      timeFraction: rdoNum(ex.timeFraction),
      priceFraction: rdoNum(ex.priceFraction),
      nominalSeconds: rdoNum(ex.nominalSeconds),
      nominalWidth: rdoNum(ex.nominalWidth),
      short: ex.short === true,
      uses: { t: ex.uses.t === true, w: ex.uses.w === true },
      coverage: ex.coverage,
      coveredTo: ex.coveredTo,
    };
  }

  // E.readout.cellsFrame (API.md C.16). `spec` = { mode, basis, pathBasis, level:{n,m}, bounds, cut, cutMs,
  // end, geom:{BASE,PR}, CUT, replay, mapping, lut, read, measured, cascade, observation, model, ctx |
  // contextKey, transformId, t0 }. `mapping` is a Resolved record of E.policy.resolve or, for a fixed
  // measure, its bare Descriptor. `read` is null unless the DISPLAYED block itself cannot answer for the
  // cell (DD-84): a pan into an unmeasured rectangle must not turn every loaded cell into a pattern.
  function rdoCellsFrame(spec) {
    rdoRequire(spec !== null && typeof spec === "object", "cellsFrame needs a spec object");
    const mode = spec.mode;
    const info = Object.prototype.hasOwnProperty.call(API.measure.MODES, mode) ? API.measure.MODES[mode] : undefined;
    if (info === undefined) throw new RangeError("E.readout.cellsFrame: unknown mode " + JSON.stringify(mode));
    const level = spec.level;
    rdoRequire(level !== null && typeof level === "object" && Number.isFinite(level.n) && Number.isFinite(level.m), "cellsFrame needs the effective level {n, m}");
    const lut = spec.lut;
    rdoRequire(lut !== null && typeof lut === "object" && lut.unsigned !== undefined && lut.occupancy !== undefined, "cellsFrame needs a Lut (E.lut.build)");
    const map = rdoMapping(spec.mapping);
    const geometry = mode === "geometry";
    if (!geometry) rdoCheckSigned(map, info.signed, mode);
    const drawable = !geometry && rdoDrawable(map);
    const plan = drawable ? API.scale.plan(map.desc) : null;
    const signed = plan !== null && plan.signed;
    const index = API.scale.index;
    // ONE mutable kernel per frame (DD-85): encode re-points z and bounds, never builds a spec literal.
    const kernel = {
      mode,
      basis: spec.basis,
      pathBasis: spec.pathBasis,
      geom: spec.geom,
      cut: spec.cut,
      end: spec.end,
      CUT: spec.CUT,
      replay: spec.replay === true,
      level,
      read: spec.read !== undefined ? spec.read : null,
      measured: typeof spec.measured === "function" ? spec.measured : null,
      cascade: typeof spec.cascade === "function" ? spec.cascade : null,
      z: null,
      bounds: spec.bounds !== undefined ? spec.bounds : null,
      exposure: null,
    };
    const defaultBounds = kernel.bounds;
    const sc = { t: 0, clip: 0, state: null };
    const scratch = rdoNewScratch();
    const cellValue = API.measure.cellValue;
    const glyphs = rdoGlyphByTag;
    const occupancyCss = lut.occupancy.css;
    const midpointCss = lut.midpoint.css;
    const unsignedCss = lut.unsigned.css;
    const positiveCss = lut.positive.css;
    const negativeCss = lut.negative.css;
    const mappingId = map.desc !== null ? map.desc.id : "";
    const fingerprint = rdoFingerprint(mappingId, map.state, lut);
    let meta = null;

    // The steady-frame path: no allocation, no formatting, one LUT read. Comments stay above the function:
    // the hot-path test scans its source.
    function encode(z, out, bounds) {
      out.css = null;
      out.pattern = null;
      out.role = rdoRoleNone;
      out.idx = -1;
      out.clip = 0;
      out.t = 0;
      if (geometry) {
        out.tag = rdoFinite;
        out.value = NaN;
        out.signed = false;
        out.short = false;
        out.reason = null;
        out.denominator = null;
        out.role = rdoRoleOccupancy;
        out.css = occupancyCss;
        return out;
      }
      kernel.z = z;
      kernel.bounds = bounds === undefined ? defaultBounds : bounds;
      cellValue(kernel, out);
      if (out.tag !== rdoFinite) {
        const g = glyphs[out.tag];
        if (g !== null) {
          out.role = rdoRolePattern;
          out.pattern = g;
        }
        return out;
      }
      if (plan === null) {
        out.role = rdoRoleOccupancy;
        out.css = occupancyCss;
        return out;
      }
      plan.apply(out.value, sc);
      const t = sc.t;
      out.t = t;
      out.clip = sc.clip;
      if (signed) {
        if (t > 0) {
          out.role = rdoRolePositive;
          out.idx = index(t);
          out.css = positiveCss[out.idx];
        } else if (t < 0) {
          out.role = rdoRoleNegative;
          out.idx = index(t);
          out.css = negativeCss[out.idx];
        } else {
          out.role = rdoRoleMidpoint;
          out.idx = 0;
          out.css = midpointCss;
        }
      } else if (out.value === 0) {
        out.role = rdoRoleZero;
        out.css = occupancyCss;
      } else {
        out.role = rdoRoleUnsigned;
        out.idx = index(t);
        out.css = unsignedCss[out.idx];
      }
      return out;
    }

    // The Readout of B.10 for one inspected cell: the SAME encode into a private scratch, plus the
    // allocating record of the measurement (E.measure.cellMeasurement), the cell's state and support.
    // `extra` = { read (the meas.state that feeds readouts, never a fill), interaction, occupancy,
    // warnings, t0 }.
    function readout(z, extra) {
      const ex = extra !== undefined && extra !== null ? extra : null;
      const b = spec.bounds !== undefined && spec.bounds !== null ? spec.bounds : [-Infinity, Infinity, -Infinity, Infinity];
      const ts = rdoStepOf(level, "n");
      const ps = rdoStepOf(level, "m");
      const cutBase = spec.cut === undefined ? Infinity : spec.cut;
      const observation = rdoObservation(spec.observation, ex !== null ? ex.read : undefined, level);
      const key = z.c * rdoCellStride + z.r;
      const warnings = ex !== null ? ex.warnings : undefined;
      const scale = rdoScaleBlock(map, rdoContextKey(spec, map), warnings);
      const motion = mode === "path" || mode === "dwell";
      const cs = API.measure.cellState(z, b, cutBase, spec.CUT === undefined ? Infinity : spec.CUT, spec.replay === true, ts, ps);
      const support = rdoCellSupport(z, b, cutBase, motion && spec.end !== undefined ? spec.end : Infinity, ts, ps, cs);
      const geom = spec.geom !== undefined ? spec.geom : LATTICE;
      const T0 = spec.t0 !== undefined ? spec.t0 : LATTICE.T0;
      const startMs = API.time.baseToMs(z.c * ts, T0, geom.BASE);
      const endMs = Math.max(startMs, API.time.baseToMs(Math.min((z.c + 1) * ts, cutBase), T0, geom.BASE));
      const finality = cs.open ? "open" : cs.partial ? "partial" : "complete";
      const when = { eventStartMs: startMs, eventEndMs: endMs, knownAtMs: null, knownAtReason: "defined by #47" };
      const base = { v: VERSION.readout, key, consumer: "cells", level: { n: level.n, m: level.m }, observation };
      if (geometry) {
        return Object.assign(base, {
          measure: { formula: null, measure: mode, basis: null, unit: null },
          observed: null,
          supplied: null,
          coordinate: null,
          typed: null,
          scale,
          support,
          exposure: null,
          state: rdoStateBlock(null, observation, finality, map.state, ex),
          when,
          model: spec.model !== undefined ? spec.model : null,
          level2: null,
        });
      }
      const probe = Object.assign({}, kernel, { z, bounds: b, exposure: null, read: ex !== null && ex.read !== undefined ? ex.read : kernel.read });
      const m = API.measure.cellMeasurement(probe);
      encode(z, scratch);
      const typed = m.result;
      const coordinate = typed.tag === "finite" ? rdoCoordinate(scratch) : null;
      return Object.assign(base, {
        measure: { formula: m.formula, measure: m.measure, basis: m.basis, unit: m.unit },
        observed: m.numerator === null ? null : { value: m.numerator, unit: m.numeratorUnit },
        supplied: typed.tag === "finite" ? { value: typed.value, unit: m.unit } : null,
        coordinate,
        typed,
        scale,
        support,
        exposure: m.exposure,
        state: rdoStateBlock(typed, observation, finality, map.state, ex),
        when,
        model: spec.model !== undefined ? spec.model : null,
        level2: null,
      });
    }

    // What E.legend.build needs, and nothing else: the descriptor, the Lut, the role of the bar, the level,
    // the measure identity. Allocates, so it is asked only when the legend's id key changed (DD-90).
    function legendInput() {
      if (meta === null) meta = rdoCellsMeta(kernel);
      let barRole = "unsigned";
      if (geometry) barRole = "outline";
      else if (map.desc === null) barRole = "outline";
      else if (map.desc.kind === "fixed-linear" || map.desc.kind === "fixed-diverging") barRole = "fixed";
      else if (map.desc.signed) barRole = "signed";
      return {
        channel: "cells",
        kind: "cells",
        mode,
        measure: meta.measure,
        formula: meta.formula,
        basis: meta.basis,
        unit: meta.unit,
        fixed: info.kind === "fixed",
        transform: rdoTransformOf(map.desc, spec.transformId),
        desc: map.desc,
        mappingId,
        state: map.state,
        policy: map.policy,
        origin: map.origin,
        external: map.external,
        reason: map.reason,
        calibration: map.record,
        lut,
        barRole,
        level: { n: level.n, m: level.m },
        contextKey: rdoContextKey(spec, map),
        observation: spec.observation !== undefined ? spec.observation : null,
        model: spec.model !== undefined ? spec.model : null,
        composite: null,
      };
    }

    return Object.freeze({
      kind: "cells",
      mode,
      level: Object.freeze({ n: level.n, m: level.m }),
      bounds: defaultBounds,
      mappingId,
      mappingState: map.state,
      encode,
      readout,
      fingerprint: () => fingerprint,
      legendInput,
    });
  }

  // ---- Rows ---------------------------------------------------------------------------------------------

  function rdoSetTyped(out, tag, reason, denominator) {
    out.tag = tag;
    out.value = NaN;
    out.reason = reason;
    out.denominator = denominator;
    return out;
  }

  // The value of one band (C.16): volume `v`, delta `2*bv - v`, time `w`, Relative volume from the typed
  // per-bin result. A number that is not finite is a validation failure, never a fill.
  function rdoRowValue(kind, band, relvol, out) {
    let x;
    if (kind === "volume") x = band.v;
    else if (kind === "delta") x = 2 * band.bv - band.v;
    else if (kind === "time") x = band.w;
    else {
      if (relvol === null) return rdoSetTyped(out, rdoPending, "reading", null);
      const typed = relvol.at(band.r);
      if (typed.tag === "finite") {
        out.tag = rdoFinite;
        out.value = typed.value;
        out.reason = null;
        out.denominator = null;
        return out;
      }
      return rdoSetTyped(out, rdoTag[typed.tag], typeof typed.reason === "string" ? typed.reason : null, typeof typed.denominator === "string" ? typed.denominator : null);
    }
    if (Number.isFinite(x)) {
      out.tag = rdoFinite;
      out.value = x;
      out.reason = null;
      out.denominator = null;
      return out;
    }
    return rdoSetTyped(out, rdoInvalid, "non-finite", null);
  }

  // The read status of a Rows channel (precedence, DD-05): failed, pending and unsupported reads beat any
  // arithmetic. Relative volume carries its own status inside `relvol.at`.
  function rdoRowRead(read, out) {
    if (read === null || read === undefined) return false;
    const state = read.state;
    if (state === "failed") {
      rdoSetTyped(out, rdoFailed, typeof read.reason === "string" ? read.reason : "read failed", null);
      return true;
    }
    if (state === "pending") {
      rdoSetTyped(out, rdoPending, typeof read.reason === "string" ? read.reason : "reading", null);
      return true;
    }
    if (state === "unsupported") {
      rdoSetTyped(out, rdoUnsupported, typeof read.reason === "string" ? read.reason : "not supported", null);
      return true;
    }
    return false;
  }

  // E.readout.rowsFrame (API.md C.16). `spec` = { kind: "volume"|"delta"|"time"|"relvol", rowSize (the level
  // m of the effective bands), mapping, lut, relvol (an E.relvol result, for kind relvol), read, surface
  // (the surface RGB the legend composites over), composite (an optional precomputed E.lut.composite, or
  // {positive, negative} for the signed kinds), info (a JSON-safe description of the period: the period
  // identity, effective row size, quality, endpoint, stale; copied into the readout unchanged),
  // observation, model, ctx | contextKey }. The CANVAS paints the raw role colour at the fixed Rows alpha
  // (DD-86); the composite exists for the legend's samples only.
  function rdoRowsFrame(spec) {
    rdoRequire(spec !== null && typeof spec === "object", "rowsFrame needs a spec object");
    const kind = spec.kind;
    const info = Object.prototype.hasOwnProperty.call(API.measure.ROWS, kind) ? API.measure.ROWS[kind] : undefined;
    if (info === undefined) throw new RangeError("E.readout.rowsFrame: unknown kind " + JSON.stringify(kind));
    const lut = spec.lut;
    rdoRequire(lut !== null && typeof lut === "object" && lut.rows !== undefined, "rowsFrame needs a Lut (E.lut.build)");
    const map = rdoMapping(spec.mapping);
    rdoCheckSigned(map, info.signed, "rows " + kind);
    const drawable = rdoDrawable(map);
    const plan = drawable ? API.scale.plan(map.desc) : null;
    const signed = plan !== null && plan.signed;
    const index = API.scale.index;
    const relvol = spec.relvol !== undefined && spec.relvol !== null ? spec.relvol : null;
    const read = spec.read !== undefined ? spec.read : null;
    const sc = { t: 0, clip: 0, state: null };
    const scratch = rdoNewScratch();
    const glyphs = rdoGlyphByTag;
    const occupancyCss = lut.occupancy.css;
    const midpointCss = lut.midpoint.css;
    const rowsCss = lut.rows.css;
    const positiveCss = lut.positive.css;
    const negativeCss = lut.negative.css;
    const mappingId = map.desc !== null ? map.desc.id : "";
    const fingerprint = rdoFingerprint(mappingId, map.state, lut);
    const rowSize = spec.rowSize;

    // One band: the same order as a cell (read status, value, pattern for a non-value, then the mapping).
    // Volume and Time at price use the raw `rows` role; Delta and Relative volume use the arms.
    function encode(band, out) {
      out.css = null;
      out.pattern = null;
      out.role = rdoRoleNone;
      out.idx = -1;
      out.clip = 0;
      out.t = 0;
      out.signed = signed;
      out.short = false;
      if (!rdoRowRead(read, out)) rdoRowValue(kind, band, relvol, out);
      if (out.tag !== rdoFinite) {
        const g = glyphs[out.tag];
        if (g !== null) {
          out.role = rdoRolePattern;
          out.pattern = g;
        }
        return out;
      }
      if (plan === null) {
        out.role = rdoRoleOccupancy;
        out.css = occupancyCss;
        return out;
      }
      plan.apply(out.value, sc);
      const t = sc.t;
      out.t = t;
      out.clip = sc.clip;
      if (signed) {
        if (t > 0) {
          out.role = rdoRolePositive;
          out.idx = index(t);
          out.css = positiveCss[out.idx];
        } else if (t < 0) {
          out.role = rdoRoleNegative;
          out.idx = index(t);
          out.css = negativeCss[out.idx];
        } else {
          out.role = rdoRoleMidpoint;
          out.idx = 0;
          out.css = midpointCss;
        }
      } else if (out.value === 0) {
        out.role = rdoRoleZero;
        out.css = occupancyCss;
      } else {
        out.role = rdoRoleRows;
        out.idx = index(t);
        out.css = rowsCss[out.idx];
      }
      return out;
    }

    const formula = info.formula;
    const formulaRecord = API.measure.FORMULAS[formula];

    function readout(band, extra) {
      const ex = extra !== undefined && extra !== null ? extra : null;
      const observation = rdoObservation(spec.observation, ex !== null ? ex.read : undefined, null);
      const stepRows = Math.pow(2, rowSize);
      const scratchOut = encode(band, scratch);
      // A read status handed to the readout (meas.state) outranks the arithmetic there, exactly as in the
      // kernel; the mark itself keeps the frame's own read (DD-84).
      const readScratch = rdoNewScratch();
      const typed = ex !== null && rdoRowRead(ex.read, readScratch) ? rdoScratchTyped(readScratch) : rdoScratchTyped(scratchOut);
      const observedValue = kind === "volume" ? band.v : kind === "delta" ? 2 * band.bv - band.v : kind === "time" ? band.w : null;
      const observedUnit = kind === "time" ? "seconds" : "usdt";
      const observed = observedValue !== null && Number.isFinite(observedValue) ? { value: observedValue, unit: observedUnit } : null;
      return {
        v: VERSION.readout,
        key: "row:" + band.r,
        consumer: "rows",
        level: { n: null, m: rowSize },
        observation,
        measure: { formula, measure: kind, basis: formulaRecord.basisKind, unit: formulaRecord.unit },
        observed,
        supplied: typed.tag === "finite" ? { value: typed.value, unit: formulaRecord.unit } : null,
        coordinate: typed.tag === "finite" ? rdoCoordinate(scratchOut) : null,
        typed,
        scale: rdoScaleBlock(map, rdoContextKey(spec, map), ex !== null ? ex.warnings : undefined),
        support: { time: null, price: [band.r * stepRows, (band.r + 1) * stepRows], portion: false, open: false, partial: false },
        exposure: null,
        state: rdoStateBlock(typed, observation, "complete", map.state, ex),
        when: { eventStartMs: null, eventEndMs: null, knownAtMs: null, knownAtReason: "defined by #47" },
        model: spec.model !== undefined ? spec.model : null,
        rows: spec.info !== undefined && spec.info !== null ? spec.info : null,
        level2: null,
      };
    }

    function legendInput() {
      // The bar role enum of B.11: a Rows band is always the named rows-projection role (DD-72); whether its
      // ramp has one arm or two is the descriptor's signedness, which the legend reads from `desc`.
      const barRole = map.desc === null ? "outline" : "rows-projection";
      return {
        channel: "rows",
        kind: "rows",
        mode: kind,
        measure: kind,
        formula,
        basis: formulaRecord.basisKind,
        unit: formulaRecord.unit,
        fixed: info.kind === "fixed",
        transform: rdoTransformOf(map.desc, spec.transformId),
        desc: map.desc,
        mappingId,
        state: map.state,
        policy: map.policy,
        origin: map.origin,
        external: map.external,
        reason: map.reason,
        calibration: map.record,
        lut,
        barRole,
        level: { n: null, m: rowSize },
        contextKey: rdoContextKey(spec, map),
        observation: spec.observation !== undefined ? spec.observation : null,
        model: spec.model !== undefined ? spec.model : null,
        composite: rdoRowsComposite(spec, lut, map.desc, info),
        info: spec.info !== undefined ? spec.info : null,
      };
    }

    return Object.freeze({
      kind: "rows",
      mode: kind,
      level: Object.freeze({ n: null, m: rowSize }),
      bounds: null,
      mappingId,
      mappingState: map.state,
      encode,
      readout,
      fingerprint: () => fingerprint,
      legendInput,
    });
  }

  // The Typed record of a finished scratch (for a readout; allocates).
  function rdoTypedFields(o) {
    const fields = {};
    if (o.tag === rdoFinite) fields.value = o.value;
    else {
      if (typeof o.reason === "string") fields.reason = o.reason;
      if (typeof o.denominator === "string") fields.denominator = o.denominator;
      if (API.result.TAGS[o.tag] === "waiting-for-complete-parent") fields.open = true;
    }
    return fields;
  }

  function rdoScratchTyped(o) {
    return API.result.make(API.result.TAGS[o.tag], rdoTypedFields(o));
  }

  // What the legend shows for a Rows mapping: the composite of the raw role over the surface at the fixed
  // Rows alpha (DD-86), the colours the bands actually have. `spec.composite` wins (a caller that already
  // computed it); else it is made from `spec.surface`; with neither, the legend samples the raw roles and
  // says nothing about a projection. Volume and Time use the rows role, Delta and Relative volume the arms.
  function rdoRowsComposite(spec, lut, desc, info) {
    if (spec.composite !== undefined && spec.composite !== null) return spec.composite;
    if (!Array.isArray(spec.surface) || desc === null) return null;
    const alpha = API.lut.ROWS_ALPHA;
    if (desc.signed) {
      return {
        positive: API.lut.composite("positive", alpha, spec.surface, lut),
        negative: API.lut.composite("negative", alpha, spec.surface, lut),
        midpoint: API.lut.over(lut.midpoint.rgb, alpha, spec.surface),
      };
    }
    return API.lut.composite("rows", alpha, spec.surface, lut);
  }

  // ---- Panes --------------------------------------------------------------------------------------------

  // The coordinate descriptor of an axis record (B.12): an axis-linear window over its domain. Its `t` is the
  // position between lo and hi, and the plan's clip codes are those of any fixed window (C.5), so a bar's
  // length and its clipping are computed by the same evaluator as a colour coordinate.
  function rdoAxisPlan(axis) {
    if (axis === null || axis === undefined || axis.typed !== "finite" || !Array.isArray(axis.domain) || axis.domain.length !== 2) return null;
    if (!(Number.isFinite(axis.domain[0]) && Number.isFinite(axis.domain[1]) && axis.domain[0] < axis.domain[1])) return null;
    const desc = { v: VERSION.mapping, id: typeof axis.mappingId === "string" ? axis.mappingId : "", kind: "axis-linear", signed: axis.sign !== "unsigned", params: { lo: axis.domain[0], hi: axis.domain[1] }, clip: "axis@1", algorithm: "axis@1" };
    return API.scale.plan(desc);
  }

  // E.readout.paneFrame (API.md C.16). `spec` = { key (volume, trades, delta, takertrades, size,
  // choppiness, perpath, cascade, efficiency), axis (an AxisRecord of E.axis: id, sign, typed, domain,
  // policy, mappingId, unit, hold, clipped, provenance, guides), lut, ctx (the default {read, hidden,
  // ratio} of E.measure.columnValue), observation, model }. encode(col, out, ctx): the third argument is
  // the column's own context (the ratio columns need their structure per column). `out.t` is the bar
  // length as a fraction of the axis (0..1 unsigned, -1..1 signed and ratio), `out.clip` a counted clip.
  // The fill: the constant bar colour (Lut.bar) for an unsigned axis, the arm colours for a signed or
  // ratio axis; a zero is a tick, an undefined column a diamond on the baseline, other non-values the
  // pattern of their tag (B.9).
  function rdoPaneFrame(spec) {
    rdoRequire(spec !== null && typeof spec === "object", "paneFrame needs a spec object");
    const key = spec.key !== undefined ? spec.key : spec.measure;
    rdoRequire(typeof key === "string", "paneFrame needs the column measure key");
    const lut = spec.lut;
    rdoRequire(lut !== null && typeof lut === "object" && lut.unsigned !== undefined && lut.bar !== undefined, "paneFrame needs a Lut (E.lut.build)");
    const axis = spec.axis !== undefined ? spec.axis : null;
    const plan = rdoAxisPlan(axis);
    const axisSigned = axis !== null && axis.sign !== "unsigned";
    const zeroOnly = axis !== null && axis.typed === "zero-only";
    const sc = { t: 0, clip: 0, state: null };
    const scratch = rdoNewScratch();
    const columnValue = API.measure.columnValue;
    const glyphs = rdoGlyphByTag;
    const bar = lut.bar.css;
    const positiveTop = lut.positive.css[255];
    const negativeTop = lut.negative.css[255];
    const stateInk = lut.stateInk.css;
    const defaultCtx = spec.ctx !== undefined ? spec.ctx : null;
    const axisId = axis !== null ? axis.id : null;
    const mappingId = axis !== null && typeof axis.mappingId === "string" ? axis.mappingId : "";
    const axisState = axis !== null ? axis.typed : "none";
    const fingerprint = rdoFingerprint(mappingId, axisState, lut);

    // One column. The bar's coordinate is the position in the axis window; a signed or ratio axis maps it
    // to -1..1 about its midpoint so the sign picks the arm.
    function encode(col, out, ctx) {
      out.css = null;
      out.pattern = null;
      out.role = rdoRoleNone;
      out.idx = -1;
      out.clip = 0;
      out.t = 0;
      columnValue(key, col, ctx === undefined ? defaultCtx : ctx, out);
      if (out.tag !== rdoFinite) {
        const g = out.tag === rdoUndefined ? "diamond" : glyphs[out.tag];
        if (g !== null) {
          out.role = rdoRolePattern;
          out.pattern = g;
        }
        return out;
      }
      const x = out.value;
      if (x === 0) {
        out.role = rdoRoleZero;
        out.pattern = "tick";
        out.css = stateInk;
        return out;
      }
      let t;
      if (plan !== null) {
        plan.apply(x, sc);
        out.clip = sc.clip;
        t = axisSigned ? 2 * sc.t - 1 : sc.t;
      } else if (zeroOnly) {
        out.clip = 2;
        t = axisSigned && x < 0 ? -1 : 1;
      } else return out;
      out.t = t;
      if (!axisSigned) {
        out.role = rdoRoleUnsigned;
        out.idx = rdoBarIndex;
        out.css = bar;
      } else if (x > 0) {
        out.role = rdoRolePositive;
        out.idx = 255;
        out.css = positiveTop;
      } else {
        out.role = rdoRoleNegative;
        out.idx = 255;
        out.css = negativeTop;
      }
      return out;
    }

    const formula = "columns." + key + "@1";
    const formulaRecord = Object.prototype.hasOwnProperty.call(API.measure.FORMULAS, formula) ? API.measure.FORMULAS[formula] : null;

    function readout(col, extra) {
      const ex = extra !== undefined && extra !== null ? extra : null;
      const observation = rdoObservation(spec.observation, ex !== null ? ex.read : undefined, null);
      const ctx = ex !== null && ex.ctx !== undefined ? ex.ctx : defaultCtx;
      encode(col, scratch, ctx === null ? undefined : ctx);
      const typed = rdoScratchTyped(scratch);
      const unit = formulaRecord !== null ? formulaRecord.unit : axis !== null ? axis.unit : null;
      const finite = typed.tag === "finite";
      const scale = {
        id: mappingId === "" ? null : mappingId,
        kind: "axis-linear",
        policy: axis !== null ? axis.policy : null,
        origin: "axis",
        contextKey: axisId,
        state: axisState,
        obsEndMs: axis !== null && axis.provenance !== undefined && axis.provenance !== null ? rdoNum(axis.provenance.through) : null,
        external: false,
        warnings: ex !== null && Array.isArray(ex.warnings) ? ex.warnings.slice() : [],
      };
      return {
        v: VERSION.readout,
        key: "col:" + (col.c !== undefined ? col.c : ex !== null && ex.index !== undefined ? ex.index : "?"),
        consumer: "pane",
        level: null,
        observation,
        measure: { formula: formulaRecord !== null ? formula : null, measure: key, basis: formulaRecord !== null ? formulaRecord.basisKind : null, unit },
        observed: finite ? { value: typed.value, unit } : null,
        supplied: finite ? { value: typed.value, unit } : null,
        coordinate: finite && scratch.role !== rdoRoleNone ? { t: scratch.t, idx: scratch.idx, role: rdoRoleNames[scratch.role], clip: rdoClipNames[scratch.clip] } : null,
        typed,
        scale,
        axis: axis === null ? null : { id: axis.id, policy: axis.policy, sign: axis.sign, typed: axis.typed, domain: Array.isArray(axis.domain) ? axis.domain.slice() : null, unit: axis.unit, hold: axis.hold !== undefined ? axis.hold : null },
        support: null,
        exposure: null,
        state: rdoStateBlock(typed, observation, "complete", axisState, ex),
        when: { eventStartMs: null, eventEndMs: null, knownAtMs: null, knownAtReason: "defined by #47" },
        model: spec.model !== undefined ? spec.model : null,
        level2: null,
      };
    }

    function legendInput() {
      return {
        channel: "pane",
        kind: "pane",
        mode: key,
        measure: key,
        formula: formulaRecord !== null ? formula : null,
        basis: formulaRecord !== null ? formulaRecord.basisKind : null,
        unit: formulaRecord !== null ? formulaRecord.unit : axis !== null ? axis.unit : null,
        fixed: false,
        transform: "axis",
        desc: null,
        mappingId,
        state: axisState === "none" ? "no-calibration" : axisState === "zero-only" ? "zero-only" : "ok",
        policy: axis !== null ? axis.policy : null,
        origin: "axis",
        external: false,
        reason: null,
        calibration: null,
        lut,
        barRole: axis === null || axis.typed === "none" ? "outline" : axisSigned ? "signed" : "unsigned",
        level: null,
        contextKey: axisId,
        observation: spec.observation !== undefined ? spec.observation : null,
        model: spec.model !== undefined ? spec.model : null,
        composite: null,
        axis,
      };
    }

    return Object.freeze({
      kind: "pane",
      mode: key,
      level: null,
      bounds: null,
      mappingId,
      mappingState: axisState,
      encode,
      readout,
      fingerprint: () => fingerprint,
      legendInput,
    });
  }

  API.readout = Object.freeze({
    ROLE: rdoRole,
    cellsFrame: rdoCellsFrame,
    rowsFrame: rdoRowsFrame,
    paneFrame: rdoPaneFrame,
  });
