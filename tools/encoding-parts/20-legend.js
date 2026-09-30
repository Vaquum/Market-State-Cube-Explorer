  // @part 20-legend
  // @requires 01-util 03-result 04-text 06-ratio 08-scale 11-lut 12-role 19-readout
  // @prefix leg
  // @provides legend
  // == §20 legend: the generated legend model, its bar pixels and its marker (API.md B.11, S1-019, S1-160, DD-45, DD-90, DD-94) ==
  // A Legend is DERIVED from the frame that paints the marks: it never restates a scale. The frame's
  // `legendInput()` hands over the descriptor, the Lut, the role of the bar and the measure identity; this
  // part turns them into samples (the actual Lut read through the actual coordinate), ticks (at the true
  // transform positions, found with the frame's own plan), keys with counts, warnings with their actions,
  // a details list and the strings. So the colour a legend shows for a value is, by construction, the
  // colour the canvas draws for it (S1-019), and a tick can never sit where the encoder would not.
  //
  // Pure and JSON-safe: same input gives a byte-equal model. Numbers that are displayed are formatted by an
  // INJECTED `fmt(value, unit) -> string` (S1-011): the canonical number travels beside its text
  // (`details[i].canonical`, `ticks[i].value`), and swapping the formatter changes strings only. Strings
  // come from E.text; the few words D.11 does not list (a detail's label, "U" and "k") are the local
  // literals of `legLabels`, marked TEXT(S1), requested for 04-text in the report.
  //
  // Positions. A bar is drawn left to right over its COORDINATE: an unsigned scale runs t = 0..1 and a
  // signed one t = -1..1 with its midpoint in the middle (`p` = the position along the bar, 0..1). A bar is
  // not a function of the value axis: a value scale bends where the values sit (that is what the ticks
  // show), the colours along the bar are the Lut by index of t.

  const legSamples = 33;
  // The default formatter: deterministic, locale-free, plain. The page passes its own (compact, k/M).
  function legDefaultFmt(value, unit) {
    if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
    if (unit === "share") return String(Number((value * 100).toPrecision(4))) + "%";
    return String(Number(value.toPrecision(4)));
  }

  // The words D.11 has no key for: labels of the details list and the two symbols of a Value calibration.
  // TEXT(S1): the owner of 04-text is asked to move them there (the report lists them); English and ASCII.
  const legLabels = Object.freeze({
    measure: "Measure",
    unit: "Unit",
    mappingId: "Mapping",
    appearanceId: "Appearance",
    context: "Context",
    support: "Support",
    U: "U",
    k: "k",
    domain: "Domain",
    knotsCount: "Knots",
    cohortCount: "Cohort",
    excludedCount: "Excluded",
    calibratedOn: "Calibrated on",
    fitOrigin: "Origin",
    fitThrough: "Fitted through",
    clipExactEndpoint: "At the endpoint",
    shareMarks: "Marks outside the scale",
    shareArea: "Area outside the scale",
    warnings: "Warnings",
    obsSource: "Source",
    obsCutoff: "Cutoff",
    obsCanonical: "Canonical through",
    obsToken: "Token",
    observationNote: "Observation",
    scaleChangeCause: "Changed by",
    scaleChangeFrom: "Was",
    scaleChangeTo: "Now",
    revisionStatus: "Revision",
    modelStatus: "Model",
    modelIsoA: "ISO A",
    modelIsoB: "ISO B",
    modelBaseline: "Baseline",
    modelFitRange: "Fitted levels",
    modelHistoryStart: "History start",
    modelExtraction: "Extraction",
    modelFitTimestamp: "Fit time",
    modelUpperBound: "Eligibility upper bound",
    knots: "knots",
  });

  // ---- text ---------------------------------------------------------------------------------------------

  function legT() {
    return API.text;
  }

  function legFill(template, params) {
    return legT().fill(template, params);
  }

  // The text of a measure basis id (E.measure.FORMULAS basisKind) and of a unit id, by E.text. An id with no
  // string of its own reads as itself: a wrong wording is visible, a missing legend is not.
  function legBasisText(basis) {
    const t = legT();
    switch (basis) {
      case "amount":
      case "period-amount-per-row":
        return t.basis.amount;
      case "intensity":
        return t.basis.intensity;
      case "mean":
        return t.basis.mean;
      case "row-spans":
        return t.basis.spans;
      case "usdt-moved":
        return t.basis.usdt;
      case "row-spans-per-min":
        return t.basis.perMinute;
      case "share":
        return t.unit.share;
      case "log2-ratio":
        return t.unit.log2;
      default:
        return typeof basis === "string" ? basis : "";
    }
  }

  function legUnitText(unit) {
    const t = legT().unit;
    switch (unit) {
      case "usdt":
        return t.usdt;
      case "trades":
        return t.trades;
      case "usdt-per-trade":
        return t.usdtPerTrade;
      case "row-spans":
        return t.rowSpans;
      case "row-spans-per-min":
        return t.rowSpansPerMinute;
      case "share":
        return t.share;
      case "log2-ratio":
        return t.log2;
      case "seconds":
        return t.seconds;
      case "usdt-per-min-per-125usdt":
        return t.usdt + " " + t.intensity;
      case "trades-per-min-per-125usdt":
        return t.trades + " " + t.intensity;
      default:
        return typeof unit === "string" ? unit : "";
    }
  }

  function legTransformText(transform) {
    const t = legT().transform;
    switch (transform) {
      case "value-log":
        return t.valueLog;
      case "value-linear":
        return t.valueLinear;
      case "rank":
        return t.rank;
      case "fixed":
        return t.fixed;
      case "axis":
        return t.value;
      default:
        return "";
    }
  }

  function legPolicyText(input) {
    const t = legT().policy;
    if (input.channel === "pane") {
      if (input.policy === "auto") return t.axisAuto;
      if (input.policy === "frozen") return t.axisFrozen;
      if (input.policy === "fixed") return t.fixed;
      return "";
    }
    if (input.origin === "manual") return t.manual;
    switch (input.policy) {
      case "explore":
        return t.explore;
      case "comparison":
        return t.comparison;
      case "auto":
        return t.auto;
      case "local":
        return t.local;
      case "fixed":
        return t.fixed;
      default:
        return "";
    }
  }

  function legCapital(s) {
    return typeof s === "string" && s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function legShow(fmt, value, unit) {
    return String(fmt(value, unit));
  }

  // ---- bar: ramps, samples, ticks -------------------------------------------------------------------------

  function legHex(rgb) {
    return "#" + API.hash.hex(Uint8Array.from(rgb));
  }

  function legCopy(list) {
    return Array.prototype.slice.call(list);
  }

  // The colours along the bar as the model carries them (JSON-safe strings): what `samples` reads and what
  // `barPixels` blits. Four shapes: `unsigned` (one ramp), `signed` (two arms and their midpoint), `flat`
  // (one colour: the outline and a constant column bar) and `flat-signed` (the two arm colours of a signed
  // column bar). A Rows band is the COMPOSITE of its raw role over the surface at the fixed Rows alpha
  // (DD-86), which is what the legend shows; without a composite it shows the raw roles.
  function legRamps(input) {
    const lut = input.lut;
    const desc = input.desc;
    if (input.barRole === "outline" || (input.channel !== "pane" && desc === null)) return { kind: "flat", css: lut.occupancy.css };
    if (input.channel === "pane") {
      if (input.barRole === "signed") return { kind: "flat-signed", negative: lut.negative.css[255], positive: lut.positive.css[255], midpoint: lut.midpoint.css };
      return { kind: "flat", css: lut.bar.css };
    }
    if (input.barRole === "rows-projection") {
      const c = input.composite;
      if (desc.signed) {
        return {
          kind: "signed",
          negative: legCopy(c !== null && c.negative ? c.negative.css : lut.negative.css),
          positive: legCopy(c !== null && c.positive ? c.positive.css : lut.positive.css),
          midpoint: c !== null && c.midpoint ? legHex(c.midpoint) : lut.midpoint.css,
        };
      }
      return { kind: "unsigned", unsigned: legCopy(c !== null && c.css ? c.css : lut.rows.css) };
    }
    if (desc.signed) return { kind: "signed", negative: legCopy(lut.negative.css), positive: legCopy(lut.positive.css), midpoint: lut.midpoint.css };
    return { kind: "unsigned", unsigned: legCopy(lut.unsigned.css) };
  }

  // The colour at coordinate t: the Lut entry by index, the arm by sign.
  function legColourAt(ramps, t) {
    const i = API.scale.index(t);
    if (ramps.kind === "unsigned") return ramps.unsigned[i];
    if (ramps.kind === "signed") return t < 0 ? ramps.negative[i] : t > 0 ? ramps.positive[i] : ramps.midpoint;
    if (ramps.kind === "flat-signed") return t < 0 ? ramps.negative : t > 0 ? ramps.positive : ramps.midpoint;
    return ramps.css;
  }

  function legIsSigned(ramps) {
    return ramps.kind === "signed" || ramps.kind === "flat-signed";
  }

  function legSamples33(ramps) {
    const signed = legIsSigned(ramps);
    const out = [];
    for (let i = 0; i < legSamples; i++) {
      const p = i / (legSamples - 1);
      const t = signed ? 2 * p - 1 : p;
      out.push({ t, css: legColourAt(ramps, t) });
    }
    return out;
  }

  // One tick: the value, its coordinate (by the frame's own mapping, so it is where the encoder puts the
  // value), the position along the bar, its text and what it marks.
  function legTick(input, scratch, fmt, value, kind, label, extra) {
    input.apply(value, scratch);
    const signed = input.signedBar;
    const tick = { t: scratch.t, p: signed ? (scratch.t + 1) / 2 : scratch.t, value, label: label !== null ? label : legShow(fmt, value, input.unit), kind };
    if (extra !== undefined) Object.assign(tick, extra);
    return tick;
  }

  // The ticks of a bar, by kind of mapping (S1-019, S1-070): Value at 0, k and U (and their negatives);
  // a linear Value at 0, U/2, U; Rank at the knots of quarters; a fixed share at its ends and middle; the
  // log2 ratio at 1/4x .. 4x; a pane axis at its ends, its middle or its guides. A zero-only calibration has
  // only its zero.
  function legTicks(input, fmt) {
    const desc = input.desc;
    const scratch = { t: 0, clip: 0 };
    const ticks = [];
    if (input.barRole === "outline" || typeof input.apply !== "function") return ticks;
    if (input.channel === "pane") return legAxisTicks(input, fmt, scratch);
    const tick = (value, kind, label, extra) => ticks.push(legTick(input, scratch, fmt, value, kind, label, extra));
    const p = desc.params;
    switch (desc.kind) {
      case "value-log1p":
        if (desc.signed) {
          tick(-p.U, "end", null);
          if (p.k < p.U) tick(-p.k, "k", null);
          tick(0, "end", null);
          if (p.k < p.U) tick(p.k, "k", null);
          tick(p.U, "end", null);
        } else {
          tick(0, "end", null);
          if (p.k < p.U) tick(p.k, "k", null);
          tick(p.U, "end", null);
        }
        break;
      case "value-linear":
        if (desc.signed) {
          tick(-p.U, "end", null);
          tick(-p.U / 2, "mid", null);
          tick(0, "end", null);
          tick(p.U / 2, "mid", null);
          tick(p.U, "end", null);
        } else {
          tick(0, "end", null);
          tick(p.U / 2, "mid", null);
          tick(p.U, "end", null);
        }
        break;
      case "rank-type7-257": {
        // The rank axis is placed at its knots: a tick at each quarter of the cohort, carrying the knot's
        // value (the quantile) and its q, never a position invented for a value.
        for (const j of [0, 64, 128, 192, 256]) tick(p.knots[j], j === 0 || j === 256 ? "end" : "knot", null, { q: j / 256 });
        break;
      }
      case "fixed-linear":
        tick(p.lo, "end", null);
        tick((p.lo + p.hi) / 2, "mid", null);
        tick(p.hi, "end", null);
        break;
      case "fixed-diverging":
        if (input.unit === "log2-ratio") {
          for (const r of API.ratio.TICKS) tick(r.value, r.value === 0 ? "mid" : "end", r.label);
        } else {
          tick(p.lo, "end", null);
          tick(p.mid, "mid", null);
          tick(p.hi, "end", null);
        }
        break;
      case "zero-only":
        tick(0, "end", null);
        break;
      default:
        break;
    }
    return ticks;
  }

  // The ticks of a column axis (B.12): the domain's ends (and zero for a symmetric axis), the guides of an
  // oscillator (RSI 30 and 70), the five ratio ticks for a ratio axis.
  function legAxisTicks(input, fmt, scratch) {
    const axis = input.axis;
    const ticks = [];
    if (axis === null || axis.typed === "none") return ticks;
    const tick = (value, kind, label) => ticks.push(legTick(input, scratch, fmt, value, kind, label));
    if (axis.typed === "zero-only" || !Array.isArray(axis.domain)) {
      tick(0, "end", null);
      return ticks;
    }
    const lo = axis.domain[0];
    const hi = axis.domain[1];
    if (axis.sign === "ratio") {
      for (const r of API.ratio.TICKS) if (r.value >= lo && r.value <= hi) tick(r.value, r.value === 0 ? "mid" : "end", r.label);
      return ticks;
    }
    tick(lo, "end", null);
    if (axis.sign === "signed-symmetric") tick(0, "mid", null);
    const guides = Array.isArray(axis.guides) ? axis.guides : [];
    for (const g of guides) if (g > lo && g < hi) tick(g, "guide", null);
    tick(hi, "end", null);
    return ticks;
  }

  // ---- keys ---------------------------------------------------------------------------------------------

  // The keys a channel can show, in display order (ids of E.role.keyEntries). `undefined` stands for the
  // three tags that share the "Not defined" swatch and text (undefined, empty-population, no-coarser-parent):
  // their counts are added, so one key says one thing once.
  const legKeyIds = Object.freeze({
    unsigned: ["zero", "undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high", "no-calibration"],
    signed: ["undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high", "no-calibration"],
    share: ["undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    dwell: ["zero", "undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    cascade: ["undefined", "waiting-for-complete-parent", "negative-infinite", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    relvol: ["negative-infinite", "no-reference", "empty-both", "outside-support", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    geometry: ["occupied"],
    pane: ["zero-tick", "undefined", "negative-infinite", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
  });
  const legNotDefined = Object.freeze(["undefined", "empty-population", "no-coarser-parent"]);

  function legKeyGroup(input) {
    if (input.channel === "pane") return "pane";
    if (input.channel === "rows") return input.mode === "relvol" ? "relvol" : input.desc !== null && input.desc.signed ? "signed" : "unsigned";
    if (input.mode === "geometry") return "geometry";
    if (input.mode === "cascade") return "cascade";
    if (input.mode === "dwell") return "dwell";
    if (input.mode === "flow" || input.mode === "flowtrades") return "share";
    if (input.mode === "delta") return "signed";
    return "unsigned";
  }

  function legCount(counts, id) {
    const n = counts[id];
    return typeof n === "number" && n > 0 ? n : 0;
  }

  // The keys of a legend with their counts. `counts` is keyed by key id (the caller's settled pass counts
  // the marks of each role). An id with no swatch of its own in E.role (the pane's zero tick) is built here.
  function legKeys(input, counts) {
    const ids = legKeyIds[legKeyGroup(input)];
    const summed = {};
    for (const id of ids) {
      if (id === "undefined") {
        let n = 0;
        for (const alias of legNotDefined) n += legCount(counts, alias);
        summed[id] = n;
      } else summed[id] = legCount(counts, id);
    }
    const keys = [];
    for (const id of ids) {
      if (id === "zero-tick") {
        keys.push({ id: "zero-tick", glyph: "tick", role: "state-ink", key: "key.zeroTick", label: legT().key.zeroTick, count: summed[id] });
        continue;
      }
      const entry = API.role.keyEntries([id], summed)[0];
      const k = { id: entry.id, glyph: entry.glyph, role: entry.role, key: entry.key, label: entry.label, count: entry.count };
      if (input.channel === "pane" && id === "undefined") k.glyph = "diamond";
      keys.push(k);
    }
    return keys;
  }

  // ---- state, warnings, strings ----------------------------------------------------------------------------

  function legState(input, opts) {
    if (opts.failed === true) return "failed";
    if (input.channel === "pane") {
      if (input.state === "no-calibration") return "no-calibration";
      if (opts.paused) return "paused";
      if (opts.updating === true) return "updating";
      if (input.state === "zero-only") return "zero-only";
      return input.policy === "fixed" ? "fixed" : "ok";
    }
    if (input.state === "no-calibration") return "no-calibration";
    if (input.state === "pending") return "pending";
    if (input.state === "updating" || opts.updating === true) return "updating";
    if (input.barRole === "outline") return "outline";
    if (input.desc !== null && input.desc.kind === "zero-only") return "zero-only";
    if (opts.paused) return "paused";
    return input.policy === "fixed" ? "fixed" : "ok";
  }

  function legPct(fmt, x) {
    return legShow(fmt, typeof x === "number" && Number.isFinite(x) ? x : 0, "share");
  }

  // The warnings of a legend (INTEGRATION D.18 ids). The actions are the ones DD-94 names: a main-chart
  // warning offers Fit, Auto color and "Open lens" (which changes no state); a lens warning offers Fit, Auto
  // color and Local contrast. Channel states that are warnings too (no calibration, updating, paused,
  // zero-only, an external override) carry their own text and the action that resolves them.
  function legWarnings(input, warn, fmt, opts, state) {
    const t = legT();
    const out = [];
    const lens = opts.channel === "lens";
    const actions = input.channel === "pane" ? [] : lens ? ["fit", "auto", "local"] : ["fit", "auto", "open-lens"];
    const shares = warn !== null && warn !== undefined && warn.shares ? warn.shares : null;
    if (state === "no-calibration") out.push({ id: "no-calibration", text: t.state.noCalibration, shares: null, actions: input.channel === "pane" ? [] : ["fit"] });
    if (state === "updating") out.push({ id: "updating", text: t.state.updating, shares: null, actions: [] });
    if (state === "zero-only") out.push({ id: "zero-only", text: t.state.zeroOnly, shares: null, actions: ["fit"] });
    if (opts.paused) out.push({ id: "paused", text: opts.paused === "lock" ? t.state.autoPausedLock : t.state.autoPaused, shares: null, actions: [] });
    if (input.external === true) {
      out.push({ id: "external-override", text: t.state.external, shares: null, actions: [] });
      if (opts.afterEdge === true) out.push({ id: "override-after-edge", text: t.state.externalAfterEdge, shares: null, actions: [] });
    }
    if (warn !== null && warn !== undefined && warn.rangeExceeded === true) {
      out.push({
        id: "range-exceeded",
        text: t.warn.rangeExceeded,
        detail: legFill(t.warn.rangeDetail, { marks: legPct(fmt, shares !== null ? shares.marks : 0), area: legPct(fmt, shares !== null ? shares.area : 0) }),
        shares: { marks: shares !== null && typeof shares.marks === "number" ? shares.marks : 0, area: shares !== null && typeof shares.area === "number" ? shares.area : 0 },
        actions: actions.slice(),
      });
    }
    if (warn !== null && warn !== undefined && (warn.lowDiscrimination === "low" || warn.lowDiscrimination === "high")) {
      const low = warn.lowDiscrimination === "low";
      const share = shares !== null ? (low ? shares.low : shares.high) : 0;
      out.push({
        id: "low-discrimination",
        text: t.warn.lowDisc,
        detail: legFill(low ? t.warn.lowDiscLow : t.warn.lowDiscHigh, { share: legPct(fmt, share) }),
        shares: { marks: shares !== null && typeof shares.marks === "number" ? shares.marks : 0, area: shares !== null && typeof shares.area === "number" ? shares.area : 0 },
        actions: actions.slice(),
      });
    }
    if (opts.shortExposure !== undefined && opts.shortExposure !== null && opts.shortExposure !== false) {
      const s = opts.shortExposure;
      const detail = s !== true && typeof s === "object" && s.t !== undefined && s.w !== undefined ? legFill(t.exposure.detail, { t: legPct(fmt, s.t), w: legPct(fmt, s.w) }) : null;
      out.push({ id: "short-exposure", text: t.exposure.short, detail, shares: null, actions: [] });
    }
    return out;
  }

  function legCalibrationText(input, fmt) {
    const t = legT();
    const desc = input.desc;
    if (input.channel === "pane") return "";
    if (input.state === "no-calibration" || desc === null) return input.barRole === "outline" && input.state !== "no-calibration" ? "" : t.state.noCalibration;
    const p = desc.params;
    const unit = input.unit;
    switch (desc.kind) {
      case "value-log1p":
        return legLabels.U + " " + legShow(fmt, p.U, unit) + " \u00b7 " + legLabels.k + " " + legShow(fmt, p.k, unit);
      case "value-linear":
        return legLabels.U + " " + legShow(fmt, p.U, unit);
      case "rank-type7-257":
        return t.transform.rank + " (" + p.knots.length + " " + legLabels.knots + ")";
      case "fixed-linear":
      case "fixed-diverging":
        return legShow(fmt, p.lo, unit) + " \u2013 " + legShow(fmt, p.hi, unit);
      case "zero-only":
        return t.state.zeroOnly;
      default:
        return "";
    }
  }

  // The clipping statement: what lies outside the scale, in the words of the keys (no new strings).
  function legClippingText(counts) {
    const t = legT().key;
    const parts = [];
    if (legCount(counts, "clip-low") > 0) parts.push(t.below + ": " + legCount(counts, "clip-low"));
    if (legCount(counts, "clip-high") > 0) parts.push(t.above + ": " + legCount(counts, "clip-high"));
    if (legCount(counts, "negative-infinite") > 0) parts.push(t.negInf + ": " + legCount(counts, "negative-infinite"));
    if (legCount(counts, "no-reference") > 0) parts.push(t.noRef + ": " + legCount(counts, "no-reference"));
    return parts.join(" \u00b7 ");
  }

  function legSupportText(input) {
    const rec = input.calibration;
    if (rec === null || rec === undefined || !rec.cohort) return "";
    const c = rec.cohort;
    const ex = c.excluded ? c.excluded : null;
    let excluded = 0;
    if (ex !== null) for (const key of Object.keys(ex)) if (typeof ex[key] === "number") excluded += ex[key];
    return legFill(legT().note.calibratedOn, { support: typeof c.calibratedOn === "string" ? c.calibratedOn : "", n: typeof c.n === "number" ? c.n : 0, excluded });
  }

  // The "top" of the scale as the chip shows it (the U of a Value scale, the range of a fixed one).
  function legTopText(input, fmt, ticks) {
    const desc = input.desc;
    if (input.channel === "pane") {
      const axis = input.axis;
      if (axis === null || axis.typed === "none") return legT().axis.none;
      if (axis.typed === "zero-only" || !Array.isArray(axis.domain)) return legT().axis.zero;
      const hi = legShow(fmt, axis.domain[1], input.unit);
      return axis.sign === "signed-symmetric" ? "\u00b1" + hi : hi;
    }
    if (desc === null) return "";
    const p = desc.params;
    switch (desc.kind) {
      case "value-log1p":
      case "value-linear":
        return legShow(fmt, p.U, input.unit);
      case "fixed-linear":
        return legShow(fmt, p.lo, input.unit) + "\u2013" + legShow(fmt, p.hi, input.unit);
      case "fixed-diverging":
        return input.unit === "log2-ratio" ? ticks.length > 0 ? ticks[0].label + "\u2013" + ticks[ticks.length - 1].label : "" : legShow(fmt, p.lo, input.unit) + "\u2013" + legShow(fmt, p.hi, input.unit);
      case "zero-only":
        return legShow(fmt, 0, input.unit);
      default:
        return "";
    }
  }

  // ---- details (D.18 fields) ------------------------------------------------------------------------------

  function legDetails(input, summary, warnings, counts, warn, opts, fmt) {
    const t = legT();
    const out = [];
    const add = (field, label, value, canonical) => out.push({ field, label, value: typeof value === "string" ? value : String(value), canonical: canonical === undefined ? null : canonical });
    const desc = input.desc;
    const rec = input.calibration;
    const cohort = rec !== null && rec !== undefined && rec.cohort ? rec.cohort : null;
    add("measure", legLabels.measure, summary.measure, input.measure);
    add("basis", t.ui.basis, summary.basis, input.basis);
    add("unit", legLabels.unit, summary.unit, input.unit);
    add("transform", t.ui.transform, summary.transform, input.transform);
    add("policy", t.ui.policy, summary.policy, input.policy);
    add("mappingId", legLabels.mappingId, desc !== null ? desc.id + " \u00b7 " + desc.kind : "", desc !== null ? desc.id : null);
    add("appearanceId", legLabels.appearanceId, input.lut.id, input.lut.id);
    if (typeof input.contextKey === "string") add("context", legLabels.context, input.contextKey, input.contextKey);
    if (summary.support !== "") add("support", legLabels.support, summary.support, cohort !== null && typeof cohort.calibratedOn === "string" ? cohort.calibratedOn : null);
    if (desc !== null && desc.params !== null) {
      const p = desc.params;
      if (typeof p.U === "number") add("U", legLabels.U, legShow(fmt, p.U, input.unit), p.U);
      if (typeof p.k === "number") add("k", legLabels.k, legShow(fmt, p.k, input.unit), p.k);
      if (Array.isArray(p.knots)) add("knotsCount", legLabels.knotsCount, String(p.knots.length), p.knots.length);
      if (typeof p.lo === "number" && typeof p.hi === "number") add("domain", legLabels.domain, legShow(fmt, p.lo, input.unit) + " \u2013 " + legShow(fmt, p.hi, input.unit), [p.lo, p.hi]);
    }
    if (input.channel === "pane" && input.axis !== null && Array.isArray(input.axis.domain)) {
      const d = input.axis.domain;
      add("domain", legLabels.domain, legShow(fmt, d[0], input.unit) + " \u2013 " + legShow(fmt, d[1], input.unit), d.slice());
    }
    if (cohort !== null) {
      if (typeof cohort.n === "number") add("cohortCount", legLabels.cohortCount, String(cohort.n), cohort.n);
      if (cohort.excluded) {
        let excluded = 0;
        for (const key of Object.keys(cohort.excluded)) if (typeof cohort.excluded[key] === "number") excluded += cohort.excluded[key];
        add("excludedCount", legLabels.excludedCount, String(excluded), excluded);
      }
      if (typeof cohort.calibratedOn === "string") add("calibratedOn", legLabels.calibratedOn, cohort.calibratedOn, cohort.calibratedOn);
    }
    if (input.origin !== null && input.origin !== undefined) add("fitOrigin", legLabels.fitOrigin, input.origin, input.origin);
    if (rec !== null && rec !== undefined && typeof rec.obsEndMs === "number") add("fitThrough", legLabels.fitThrough, String(rec.obsEndMs), rec.obsEndMs);
    add("clipLowFinite", t.key.below, String(legCount(counts, "clip-low")), legCount(counts, "clip-low"));
    add("clipHighFinite", t.key.above, String(legCount(counts, "clip-high")), legCount(counts, "clip-high"));
    add("clipNegInf", t.key.negInf, String(legCount(counts, "negative-infinite")), legCount(counts, "negative-infinite"));
    add("clipNoRef", t.key.noRef, String(legCount(counts, "no-reference")), legCount(counts, "no-reference"));
    const exact = legCount(counts, "exact-low") + legCount(counts, "exact-high");
    add("clipExactEndpoint", legLabels.clipExactEndpoint, String(exact), exact);
    const shares = warn !== null && warn !== undefined && warn.shares ? warn.shares : null;
    if (shares !== null) {
      add("shareMarks", legLabels.shareMarks, legPct(fmt, shares.marks), typeof shares.marks === "number" ? shares.marks : null);
      add("shareArea", legLabels.shareArea, legPct(fmt, shares.area), typeof shares.area === "number" ? shares.area : null);
    }
    const ids = [];
    for (const w of warnings) ids.push(w.id);
    add("warnings", legLabels.warnings, ids.join(", "), ids);
    const obs = input.observation;
    if (obs !== null && obs !== undefined) {
      if (typeof obs.source === "string") add("obsSource", legLabels.obsSource, obs.source, obs.source);
      if (typeof obs.cutoffMs === "number") add("obsCutoff", legLabels.obsCutoff, String(obs.cutoffMs), obs.cutoffMs);
      if (typeof obs.canonicalThroughMs === "number") add("obsCanonical", legLabels.obsCanonical, String(obs.canonicalThroughMs), obs.canonicalThroughMs);
      if (typeof obs.token === "string") add("obsToken", legLabels.obsToken, obs.token, obs.token);
      const provenance = Array.isArray(obs.provenance) ? obs.provenance.slice() : [];
      const note = obs.replay === true ? t.vintage : provenance.join(", ");
      if (note !== "") add("observationNote", legLabels.observationNote, note, provenance);
      const rev = obs.revision;
      if (rev !== undefined && rev !== null) {
        if (rev.kind === "provisional-replaced") add("revisionStatus", legLabels.revisionStatus, legFill(t.revision.replaced, { t: String(rev.throughMs) }), "provisional-replaced");
        else add("revisionStatus", legLabels.revisionStatus, t.revision.unknown, "unknown");
      } else if (opts.revisionStatus === "none") add("revisionStatus", legLabels.revisionStatus, "", "none");
    }
    if (opts.note !== undefined && opts.note !== null) {
      const causes = Array.isArray(opts.note.causes) ? opts.note.causes.slice() : [];
      add("scaleChangeCause", legLabels.scaleChangeCause, causes.map((c) => (typeof t.note.cause[c] === "string" ? t.note.cause[c] : c)).join(", "), causes);
      if (opts.note.from !== undefined) add("scaleChangeFrom", legLabels.scaleChangeFrom, typeof opts.note.from === "string" ? opts.note.from : "", opts.note.from);
      if (opts.note.to !== undefined) add("scaleChangeTo", legLabels.scaleChangeTo, typeof opts.note.to === "string" ? opts.note.to : "", opts.note.to);
    }
    if (input.external === true) add("override", t.state.external, t.state.external, "external");
    if (opts.evicted === true) add("evicted", t.note.evicted, t.note.evicted, true);
    const model = input.model;
    if (model !== null && model !== undefined && model.provenance) {
      const pv = model.provenance;
      add("modelStatus", legLabels.modelStatus, model.status === "eligible-by-bound" ? t.model.eligibleByBound : model.labels.length > 0 ? model.labels[0] : model.status, model.status);
      add("modelApplicability", t.model.applicability, t.model.applicability, pv.applicability);
      add("modelIsoA", legLabels.modelIsoA, String(pv.ISO_A), pv.ISO_A);
      add("modelIsoB", legLabels.modelIsoB, String(pv.ISO_B), pv.ISO_B);
      add("modelBaseline", legLabels.modelBaseline, legShow(fmt, pv.baseline, "log2-ratio"), pv.baseline);
      add("modelFitRange", legLabels.modelFitRange, pv.fit.nMin + " \u2013 " + pv.fit.nMax, [pv.fit.nMin, pv.fit.nMax]);
      add("modelHistoryStart", legLabels.modelHistoryStart, pv.fit.historyStart, pv.fit.historyStart);
      add("modelExtraction", legLabels.modelExtraction, pv.fit.extraction, pv.fit.extraction);
      add("modelFitTimestamp", legLabels.modelFitTimestamp, t.model.exactUnknown, pv.estimatedAt);
      add("modelUpperBound", legLabels.modelUpperBound, pv.eligibilityUpperBound, pv.eligibilityUpperBound);
    }
    return out;
  }

  // ---- E.legend.build -------------------------------------------------------------------------------------

  // E.legend.build (API.md B.11): the Legend of a frame. `frame` is a Frame (or the object its
  // `legendInput()` returns); `warn` is the WarnReport of E.warn.evaluate for this channel (or null);
  // `fmt(value, unit) -> string` formats numbers for display (absent: a plain deterministic default);
  // `opts` = { channel ("cells"|"rows"|"lens"|"pane", default: the frame's), counts (marks per key id,
  // counted in the settled pass), measureLabel, note ({causes, from, to}: a scale change), paused (false |
  // "lock" | "play"), updating, failed, afterEdge, shortExposure (true | {t, w}), evicted, revisionStatus }.
  function legBuild(frame, warn, fmt, opts) {
    const o = opts !== undefined && opts !== null ? opts : {};
    const f = typeof fmt === "function" ? fmt : legDefaultFmt;
    // A copy: build adds two derived fields to it and never changes the caller's object.
    const input = Object.assign({}, typeof frame.legendInput === "function" ? frame.legendInput() : frame);
    const w = warn !== undefined ? warn : null;
    const counts = o.counts !== undefined && o.counts !== null ? o.counts : {};
    const t = legT();
    const channel = typeof o.channel === "string" ? o.channel : input.channel;
    input.signedBar = input.barRole === "outline" ? false : input.channel === "pane" ? input.barRole === "signed" : input.desc !== null && input.desc.signed === true;
    if (typeof input.apply !== "function" && input.desc !== null) input.apply = (value, out) => API.scale.apply(input.desc, value, out);
    const ramps = legRamps(input);
    const state = legState(input, o);
    const ticks = legTicks(input, f);
    const keys = legKeys(input, counts);
    const warnings = legWarnings(input, w, f, Object.assign({}, o, { channel }), state);
    const stateToken = state === "no-calibration" ? t.state.noCalibration : state === "updating" ? t.state.updating : "";
    const summary = {
      measure: typeof o.measureLabel === "string" ? o.measureLabel : legCapital(input.measure),
      basis: legBasisText(input.basis),
      unit: legUnitText(input.unit),
      transform: legTransformText(input.transform),
      policy: legPolicyText(input),
      support: legSupportText(input),
      calibration: legCalibrationText(input, f),
      clipping: legClippingText(counts),
      scaleId: input.desc !== null ? input.desc.id : input.mappingId,
      appearance: input.lut.id,
      top: legTopText(input, f, ticks),
    };
    const noteTexts = [];
    if (o.note !== undefined && o.note !== null) {
      const causes = Array.isArray(o.note.causes) ? o.note.causes : [];
      const words = [];
      for (const c of causes) words.push(typeof t.note.cause[c] === "string" ? t.note.cause[c] : c);
      noteTexts.push(legFill(t.note.scaleChanged, { causes: words.join(", ") }));
    }
    const legend = {
      v: VERSION.legend,
      channel,
      summary,
      bar: {
        role: input.barRole,
        ramps,
        samples: legSamples33(ramps),
        ticks,
        midpoint: legIsSigned(ramps) ? 0.5 : null,
        edges: {
          low: { glyph: "tri-down", count: legCount(counts, "clip-low") },
          high: { glyph: "tri-up", count: legCount(counts, "clip-high") },
        },
      },
      keys,
      marker: null,
      warnings,
      notes: noteTexts,
      details: [],
      state,
      level: input.level === null || input.level === undefined ? null : { n: input.level.n, m: input.level.m },
      stateToken,
    };
    legend.details = legDetails(input, summary, warnings, counts, w, o, f);
    return legend;
  }

  // ---- E.legend.chip --------------------------------------------------------------------------------------

  // E.legend.chip (API.md B.11, INTEGRATION D.7): {text, state, label}. `text` is short: the top of the
  // scale, the transform and the policy ("26.8 M . Value (log) . Explore") plus AT MOST ONE state token by
  // priority: No calibration > Updating > Scale range exceeded > Low discrimination > Scale changed. A pane
  // chip reads from its axis record ("Auto axis . +-1.92 B"; No data, Updating, Auto paused). `label` is
  // the full sentence for the accessible name.
  function legChip(legend) {
    const t = legT();
    const s = legend.summary;
    const sep = " \u00b7 ";
    const ids = [];
    for (const w of legend.warnings) ids.push(w.id);
    let token = "";
    if (legend.state === "no-calibration") token = t.state.noCalibration;
    else if (legend.state === "updating") token = t.state.updating;
    else if (ids.indexOf("range-exceeded") >= 0) token = t.warn.rangeExceeded;
    else if (ids.indexOf("low-discrimination") >= 0) token = t.warn.lowDisc;
    else if (legend.notes.length > 0) token = legend.notes[0];
    let text;
    if (legend.channel === "pane") {
      if (legend.state === "no-calibration") text = t.axis.none;
      else if (legend.state === "paused") text = t.axis.paused;
      else if (legend.state === "updating") text = t.axis.updating;
      else text = [s.policy, s.top].filter((x) => x !== "").join(sep);
    } else {
      const parts = [s.top, s.transform, s.policy].filter((x) => x !== "");
      if (token !== "") parts.push(token);
      text = parts.join(sep);
    }
    const label = [t.ui.scale + ": " + s.measure, s.basis, s.unit, s.transform, s.policy, s.calibration, s.support, s.clipping, token].filter((x) => x !== "" && x !== undefined).join(", ");
    return { text, state: legend.state, label };
  }

  // E.legend.details (API.md B.11): the details list of a legend, `[{field, label, value, canonical}]`:
  // `field` is the D.18 data-field, `value` the formatted text, `canonical` the exact JSON-safe value.
  function legDetailsOf(legend) {
    return legend.details.slice();
  }

  // ---- E.legend.marker ------------------------------------------------------------------------------------

  // E.legend.marker (API.md B.11, C.16): where a readout's value sits on the bar, {t, clip, p}, or null when
  // it sits nowhere: no coordinate (a non-value, an occupancy-only mark), a bar that is an outline, a record
  // of another mapping or of another level than the legend describes (a table at a different level must not
  // draw a marker on this legend, DR-22). `t` is the record's own coordinate, so the marker equals the tick
  // the same value would get.
  function legMarker(legend, readout) {
    if (readout === null || readout === undefined || readout.coordinate === null || readout.coordinate === undefined) return null;
    if (legend.bar.role === "outline") return null;
    const r = readout.scale;
    if (r && typeof r.id === "string" && legend.summary.scaleId !== "" && r.id !== legend.summary.scaleId) return null;
    if (legend.level !== null && readout.level !== null && readout.level !== undefined) {
      if (readout.level.n !== legend.level.n || readout.level.m !== legend.level.m) return null;
    }
    const t = readout.coordinate.t;
    if (typeof t !== "number" || !Number.isFinite(t)) return null;
    return { t, clip: readout.coordinate.clip, p: legIsSigned(legend.bar.ramps) ? (t + 1) / 2 : t };
  }

  // ---- E.legend.barPixels ---------------------------------------------------------------------------------

  function legChannel(css, at) {
    return parseInt(css.slice(1 + at * 2, 3 + at * 2), 16);
  }

  // E.legend.barPixels (API.md B.11, DD-45): ONE row of `widthPx` RGBA pixels, the Lut read through the
  // coordinate exactly (no gradient, no interpolation): pixel x sits at p = x / (widthPx - 1), so the first
  // pixel is the low end and the last the high end. The page blits the row with putImageData. Pure Node, no
  // canvas: a test compares every pixel with the Lut's own bytes.
  function legBarPixels(legend, widthPx) {
    if (typeof widthPx !== "number" || !Number.isFinite(widthPx) || widthPx < 0) throw new RangeError("E.legend.barPixels: widthPx must be a non-negative number");
    const w = Math.floor(widthPx);
    const out = new Uint8ClampedArray(w * 4);
    const ramps = legend.bar.ramps;
    const signed = legIsSigned(ramps);
    for (let x = 0; x < w; x++) {
      const p = w > 1 ? x / (w - 1) : 0.5;
      const css = legColourAt(ramps, signed ? 2 * p - 1 : p);
      out[x * 4] = legChannel(css, 0);
      out[x * 4 + 1] = legChannel(css, 1);
      out[x * 4 + 2] = legChannel(css, 2);
      out[x * 4 + 3] = 255;
    }
    return out;
  }

  // ---- E.legend.keyOf -------------------------------------------------------------------------------------

  function legKeyPart(x) {
    if (x === null || x === undefined) return "";
    if (typeof x === "object") {
      if (x.n !== undefined || x.m !== undefined) return "n" + String(x.n) + "m" + String(x.m);
      if (x.t !== undefined) return String(x.t) + "," + String(x.clip);
      return JSON.stringify(x);
    }
    return String(x);
  }

  // E.legend.keyOf (API.md B.11, DD-90): the DOM-write guard. It is computed from ids ONLY, before any
  // Legend model exists, so a steady frame builds no model: explorer.js calls `build` only when this key
  // changed. Each field is length-prefixed, so no two different field lists can give the same key, and the
  // key changes if and only if one of the listed fields changes.
  function legKeyOf(f) {
    const names = ["mappingId", "appearanceId", "themeEpoch", "policy", "state", "warnStamp", "marker", "level"];
    let key = "";
    for (let i = 0; i < names.length; i++) {
      const part = legKeyPart(f[names[i]]);
      key += (i > 0 ? "|" : "") + part.length + ":" + part;
    }
    return key;
  }

  API.legend = Object.freeze({
    build: legBuild,
    chip: legChip,
    details: legDetailsOf,
    marker: legMarker,
    barPixels: legBarPixels,
    keyOf: legKeyOf,
  });
