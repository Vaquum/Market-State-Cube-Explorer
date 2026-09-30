  // @part 16-axis
  // @requires 06-ratio 08-scale
  // @prefix axs
  // @provides axis
  // == §16 axis: typed axis domains, the registered-axis catalogue and the Auto-axis state machine (API.md B.12, C.12, DR-18, DD-64) ==
  // Every bar, profile and oscillator length used to divide by `max || 1`: an empty view drew against 1, an
  // all-zero view claimed a maximum of 1, and every draw rescaled (D4/S1-017/018). Here an axis is a
  // REGISTERED, typed thing: its domain is "No data" (nothing displayed), "zero-only" (everything displayed is 0,
  // the label is "0", never a claimed maximum) or the EXACT displayed maximum (no nice rounding), symmetric
  // about 0 for the signed ones (MACD, Signal and histogram share ONE axis). Fixed axes (RSI 0..100, the log2
  // ratio -2..+2) return their natural domain. The pure functions (`domain`, `coordinate`, `ticks`) are
  // stateless; `registry` is a factory whose state (one slot per workspace and axis id) lives only inside the
  // object it returns (DD-02). It reads no clock and no gesture state of its own: `frame()` is given `now`, the
  // held flags and the cutoff on every call, so a test drives the whole machine with numbers.
  //
  // A record (API.md B.12) is a plain object the registry OWNS and hands out by reference: the caller treats it
  // as read-only, except `clipped` (the counts of bars beyond a held domain, which the caller that draws the
  // bars fills in: the registry only resets it when the domain is refitted). Fields: id, channel, policy
  // ("auto" | "fixed" | "frozen" | "navigation"), sign, typed ("none" | "zero-only" | "finite"), domain ([lo, hi] or
  // null), natural, unit, mappingId, provenance {kind, through, generation, token, workspace, cohort:{count}},
  // hold (null | "gesture" | "play" | "cap" | "waiting" | "settling"), clipped {low, high, count, total}, and two
  // additions to B.12: `external` (a FROZEN axis whose observations end after the cutoff: the replay "external
  // comparison override") and `initial` (this record came from the very first fit, made at once even in a
  // gesture, DD-40).

  const axsClip = API.scale.CLIP;
  // The registered axes (B.12, DD-23: ids use dots). `sign`: "unsigned" | "signed-symmetric" | "ratio" (a fixed,
  // signed log2 axis). `policy` is the DEFAULT one: "auto" (fits the displayed values), "fixed" (a natural
  // domain) or "navigation" (the main time and price axes: read-only records, never persisted).
  function axsEntry(id, channel, sign, policy, natural, unit, guides) {
    return Object.freeze({
      id,
      channel,
      sign,
      policy,
      natural: natural === null ? null : Object.freeze(natural),
      unit,
      guides: guides === null ? null : Object.freeze(guides),
    });
  }

  const axsCatalogue = Object.freeze({
    "pane.volume": axsEntry("pane.volume", "columns", "unsigned", "auto", null, "usdt", null),
    "pane.trades": axsEntry("pane.trades", "columns", "unsigned", "auto", null, "trades", null),
    "pane.size": axsEntry("pane.size", "columns", "unsigned", "auto", null, "usdt-per-trade", null),
    "pane.choppiness": axsEntry("pane.choppiness", "columns", "unsigned", "auto", null, "path-per-range", null),
    "pane.perpath": axsEntry("pane.perpath", "columns", "unsigned", "auto", null, "usdt-per-usdt-moved", null),
    "pane.delta": axsEntry("pane.delta", "columns", "signed-symmetric", "auto", null, "usdt", null),
    "pane.takertrades": axsEntry("pane.takertrades", "columns", "signed-symmetric", "auto", null, "trades", null),
    "pane.cascade": axsEntry("pane.cascade", "columns", "ratio", "fixed", [-2, 2], "log2-ratio", null),
    "pane.efficiency": axsEntry("pane.efficiency", "columns", "ratio", "fixed", [-2, 2], "log2-ratio", null),
    "pane.rsi1d": axsEntry("pane.rsi1d", "oscillator", "unsigned", "fixed", [0, 100], "index", [30, 70]),
    "pane.rsi4h": axsEntry("pane.rsi4h", "oscillator", "unsigned", "fixed", [0, 100], "index", [30, 70]),
    "pane.macd1d": axsEntry("pane.macd1d", "oscillator", "signed-symmetric", "auto", null, "usdt", null),
    "profile.current": axsEntry("profile.current", "profile", "unsigned", "auto", null, "usdt-per-row", null),
    "profile.reference.volume": axsEntry("profile.reference.volume", "reference", "unsigned", "auto", null, "usdt", null),
    "profile.reference.time": axsEntry("profile.reference.time", "reference", "unsigned", "auto", null, "seconds", null),
    "profile.reference.delta": axsEntry("profile.reference.delta", "reference", "signed-symmetric", "auto", null, "usdt", null),
    "profile.reference.relvol": axsEntry("profile.reference.relvol", "reference", "ratio", "fixed", [-2, 2], "log2-ratio", null),
    "nav.time": axsEntry("nav.time", "navigation", "unsigned", "navigation", null, "time", null),
    "nav.price": axsEntry("nav.price", "navigation", "unsigned", "navigation", null, "usdt", null),
  });
  const axsIds = Object.freeze(Object.keys(axsCatalogue));

  function axsIsObject(x) {
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function axsFiniteNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
  }

  // E.axis.domain (API.md C.12, DR-18): the typed domain of DISPLAYED values. `summary` = {count, max, min}:
  // how many values are displayed and their extremes (the caller scans the displayed values once; no sort).
  //   no values           -> {typed:"none", domain:null}            label "No data", never max = 1
  //   unsigned, max 0     -> {typed:"zero-only", domain:[0, 0]}     label "0", never a claimed maximum
  //   unsigned            -> {typed:"finite", domain:[0, max]}      the exact maximum, no nice rounding
  //   signed-symmetric    -> M = max(|min|, |max|); M 0 is zero-only, else [-M, +M] (MACD, Signal and
  //                          histogram are summarised TOGETHER, so they share one axis)
  // A summary that is not numbers (NaN, a missing extreme) is a caller bug and throws: an axis must never
  // be silently fitted to nothing. `sign` "ratio" is a fixed axis and has no fitted domain.
  function axsDomain(sign, summary) {
    if (sign !== "unsigned" && sign !== "signed-symmetric") throw new RangeError("axis domain: sign must be unsigned or signed-symmetric, not " + String(sign));
    if (!axsIsObject(summary) || !axsFiniteNumber(summary.count) || summary.count < 0) throw new TypeError("axis domain: summary needs a count of displayed values");
    if (summary.count === 0) return { typed: "none", domain: null };
    if (!axsFiniteNumber(summary.max) || !axsFiniteNumber(summary.min)) throw new TypeError("axis domain: summary needs a finite max and min when count > 0");
    if (sign === "unsigned") {
      if (summary.max < 0) throw new RangeError("axis domain: an unsigned axis cannot have a negative maximum");
      return summary.max === 0 ? { typed: "zero-only", domain: [0, 0] } : { typed: "finite", domain: [0, summary.max] };
    }
    const lo = summary.min < 0 ? -summary.min : summary.min;
    const hi = summary.max < 0 ? -summary.max : summary.max;
    const M = lo > hi ? lo : hi;
    return M === 0 ? { typed: "zero-only", domain: [0, 0] } : { typed: "finite", domain: [-M, M] };
  }

  // The mapping id of an axis record (B.12): the id of the axis-linear descriptor {lo, hi} (clip "axis@1"),
  // which is how a frozen domain travels and is compared; zero-only axes use the zero-only descriptor's id;
  // "none" has no mapping.
  function axsMappingId(sign, typed, domain) {
    if (typed === "none" || domain === null) return null;
    const signed = sign !== "unsigned";
    if (typed === "zero-only") return API.scale.zeroOnly(signed).id;
    return API.scale.id({ v: VERSION.mapping, kind: "axis-linear", signed, params: { lo: domain[0], hi: domain[1] }, clip: "axis@1" });
  }

  function axsRecord(entry, workspace, policy, typed, domain, provenance) {
    return {
      id: entry.id,
      channel: entry.channel,
      policy,
      sign: entry.sign,
      typed,
      domain,
      natural: entry.natural === null ? null : entry.natural.slice(),
      unit: entry.unit,
      mappingId: axsMappingId(entry.sign, typed, domain),
      provenance,
      hold: null,
      clipped: { low: 0, high: 0, count: 0, total: provenance.cohort.count },
      external: false,
      initial: false,
    };
  }

  function axsSameDomain(rec, fresh) {
    if (rec.typed !== fresh.typed) return false;
    if (rec.domain === null || fresh.domain === null) return rec.domain === fresh.domain;
    return rec.domain[0] === fresh.domain[0] && rec.domain[1] === fresh.domain[1];
  }

  // The natural domain of a fixed axis: the catalogue's, or a caller's [lo, hi] (a manual window). A signed
  // or ratio axis must stay symmetric about 0 so its bars keep their midpoint.
  function axsFixedDomain(entry, given) {
    const d = Array.isArray(given) ? given : entry.natural;
    if (!d || d.length !== 2 || !axsFiniteNumber(d[0]) || !axsFiniteNumber(d[1]) || !(d[0] < d[1])) throw new RangeError("axis " + entry.id + ": a fixed domain is [lo, hi] with lo < hi");
    if (entry.sign !== "unsigned" && d[0] !== -d[1]) throw new RangeError("axis " + entry.id + ": a signed fixed domain is symmetric about 0");
    return [d[0], d[1]];
  }

  function axsWorkspace(x) {
    const ws = x === undefined ? "live" : x;
    if (ws !== "live" && ws !== "replay") throw new RangeError("axis: workspace must be live or replay");
    return ws;
  }

  function axsEntryOf(id) {
    const entry = typeof id === "string" && Object.prototype.hasOwnProperty.call(axsCatalogue, id) ? axsCatalogue[id] : null;
    if (entry === null) throw new RangeError("axis: unknown axis id " + String(id));
    return entry;
  }

  // E.axis.coordinate (API.md A.3, C.12, S1-112): where a value sits on an axis record, as {t, clip} (into
  // `out` when given, so a per-column loop allocates nothing). Unsigned axes give t in 0..1 from the domain's
  // low end; signed-symmetric and ratio axes give t in -1..1 with 0 at the midpoint (t = value / M). A value
  // beyond a held or frozen domain is clipped to the end WITH its clip code (LOW or HIGH: the bar is
  // clamped and the overflow triangle drawn, "interim overflow"); a value exactly on an end is EXACT_LOW or
  // EXACT_HIGH (on the axis, not beyond it). A zero-only axis places 0 at t 0 and any other value out of
  // domain (HIGH on the positive side, LOW on the negative), the same way a zero-only colour calibration does
  // (DD-95). An axis with no domain ("No data") places nothing: t 0 with no clip, and the caller checks
  // `record.typed`. A NaN has no place and throws.
  function axsCoordinate(record, value, out) {
    const o = out === undefined || out === null ? { t: 0, clip: axsClip.NONE } : out;
    if (value !== value) throw new TypeError("axis coordinate needs a number, not NaN");
    if (!axsIsObject(record) || record.domain === null || record.domain === undefined || record.typed === "none") {
      o.t = 0;
      o.clip = axsClip.NONE;
      return o;
    }
    const lo = record.domain[0];
    const hi = record.domain[1];
    if (record.sign !== "unsigned") {
      // Symmetric about 0: domain [-M, +M].
      if (hi === 0) {
        if (value === 0) {
          o.t = 0;
          o.clip = axsClip.NONE;
        } else {
          o.t = value < 0 ? -1 : 1;
          o.clip = value < 0 ? axsClip.LOW : axsClip.HIGH;
        }
        return o;
      }
      if (value < lo) {
        o.t = -1;
        o.clip = axsClip.LOW;
      } else if (value > hi) {
        o.t = 1;
        o.clip = axsClip.HIGH;
      } else if (value === lo) {
        o.t = -1;
        o.clip = axsClip.EXACT_LOW;
      } else if (value === hi) {
        o.t = 1;
        o.clip = axsClip.EXACT_HIGH;
      } else {
        o.t = value / hi;
        o.clip = axsClip.NONE;
      }
      return o;
    }
    if (lo === hi) {
      if (value === lo) {
        o.t = 0;
        o.clip = axsClip.NONE;
      } else {
        o.t = value < lo ? 0 : 1;
        o.clip = value < lo ? axsClip.LOW : axsClip.HIGH;
      }
      return o;
    }
    if (value < lo) {
      o.t = 0;
      o.clip = axsClip.LOW;
    } else if (value > hi) {
      o.t = 1;
      o.clip = axsClip.HIGH;
    } else if (value === lo) {
      o.t = 0;
      o.clip = axsClip.EXACT_LOW;
    } else if (value === hi) {
      o.t = 1;
      o.clip = axsClip.EXACT_HIGH;
    } else {
      o.t = (value - lo) / (hi - lo);
      o.clip = axsClip.NONE;
    }
    return o;
  }

  // E.axis.ticks (API.md C.12): the tick marks of a record as [{value, t, kind, label?}], where `t` is the
  // coordinate of E.axis.coordinate. Unsigned axes: 0 and the maximum; signed: -M, 0, +M; RSI: 0, 30, 70, 100
  // (the guides); log2 ratios: the five ticks of E.ratio.ratioTicks that fit `room` px, each with its reading
  // ("1/4x" ... "4x"). No domain -> none; zero-only -> just 0. Numbers carry no label: formatting them is the
  // caller's (an injected formatter), so no English or locale enters this part.
  function axsTicks(record, room) {
    if (!axsIsObject(record) || record.typed === "none" || !record.domain) return [];
    const lo = record.domain[0];
    const hi = record.domain[1];
    if (record.typed === "zero-only") return [{ value: 0, t: 0, kind: "zero" }];
    const at = (value) => axsCoordinate(record, value).t;
    if (record.sign === "ratio") {
      const kept = API.ratio.ratioTicks(room);
      const out = [];
      for (let i = 0; i < kept.length; i++) out.push({ value: kept[i].value, t: at(kept[i].value), kind: "ratio", label: kept[i].label });
      return out;
    }
    const entry = Object.prototype.hasOwnProperty.call(axsCatalogue, record.id) ? axsCatalogue[record.id] : null;
    if (entry !== null && entry.guides !== null) {
      const out = [{ value: lo, t: at(lo), kind: "end" }];
      for (let i = 0; i < entry.guides.length; i++) out.push({ value: entry.guides[i], t: at(entry.guides[i]), kind: "guide" });
      out.push({ value: hi, t: at(hi), kind: "end" });
      return out;
    }
    if (record.sign === "unsigned") return [{ value: lo, t: 0, kind: "end" }, { value: hi, t: 1, kind: "end" }];
    return [{ value: lo, t: -1, kind: "end" }, { value: 0, t: 0, kind: "zero" }, { value: hi, t: 1, kind: "end" }];
  }

  // E.axis.registry (API.md A.3, C.12, DD-40, DD-64): the Auto-axis state machine. `{settleMs?, autoMs?}` default
  // to TIMING.SETTLE_MS (200) and TIMING.AUTO_MS (500). One slot per `workspace|id`, so the live and the replay
  // axes never share a record (replay drops its own, live is untouched and restored on exit).
  //
  // frame(id, input) -> record. input = {sign?, workspace?, cutMs, now, eligible, held:{gesture, play}, sig,
  // summary(), fixed?, lastGestureAt?, generation?, token?, through?, domain? (navigation only)}:
  //   sign        overrides the catalogue's sign ("unsigned" | "signed-symmetric") for an Auto axis
  //   cutMs       the effective cutoff in epoch ms; `now` the caller's clock in ms; both are numbers
  //   eligible    the consumer's data is coherent (the registry never fits from partial data)
  //   held        {gesture, play}: a gesture is active / Play is running. `lastGestureAt` (optional) is the
  //               stamp of the last gesture event, so a wheel step that holds nothing still counts
  //   sig         a string that changes exactly when the displayed values might (the caller composes it:
  //               workspace, id, generation, bars version, cutoff edge, measure, range, level, read state)
  //   summary()   the scan of the DISPLAYED values -> {count, max, min}; called only when `sig` changed
  //   fixed       [lo, hi] a fixed domain (the catalogue's natural one for a fixed axis); absent -> Auto
  // Auto steps, in this order (C.12):
  //   1 a record fitted on observations AFTER the cutoff (provenance.through > cutMs: a replay scrubbed back) is
  //     dropped BEFORE anything is painted with it, then the steps below refit it;
  //   2 not eligible: keep the record (hold "waiting") or, with none, answer {typed:"none", hold:"waiting"}
  //     (nothing is stored);
  //   3 no record: fit NOW and commit (nothing to freeze, even in a gesture: DD-40; `initial` is true);
  //   4 sig unchanged, or the fresh domain equals the held one: nothing is pending, hold null;
  //   5 the domain really changed and a gesture (hold "gesture") or Play (hold "play") is active: keep it;
  //   6 otherwise keep it while settleMs has not passed since the last held frame or gesture (hold
  //     "settling") or autoMs since the last update (hold "cap"): the later of the two decides the label;
  //   7 else refit from the fresh domain (new record: provenance.through = min(through ?? cutMs, cutMs)).
  // A FROZEN slot (Comparison lock, or a restored address) is returned unchanged with `external` set when its
  // through is after the cutoff; the caller counts the bars beyond it. A FIXED axis returns its natural domain.
  function axsRegistry(options) {
    const opts = options !== null && typeof options === "object" ? options : {};
    const settleMs = opts.settleMs === undefined ? TIMING.SETTLE_MS : opts.settleMs;
    const autoMs = opts.autoMs === undefined ? TIMING.AUTO_MS : opts.autoMs;
    if (!axsFiniteNumber(settleMs) || settleMs < 0 || !axsFiniteNumber(autoMs) || autoMs < 0) throw new TypeError("E.axis.registry: settleMs and autoMs are numbers of milliseconds, 0 or more");
    // key "workspace|id" -> {rec, sig, lastUpdateMs, heldAt, gestureAt}
    const slots = new Map();

    function provenance(kind, through, input, ws, count) {
      return {
        kind,
        through,
        generation: axsFiniteNumber(input.generation) ? input.generation : 0,
        token: typeof input.token === "string" ? input.token : null,
        workspace: ws,
        cohort: { count },
      };
    }

    function fixedRecord(entry, ws, input, key) {
      const d = axsFixedDomain(entry, input.fixed);
      const slot = slots.get(key);
      if (slot && slot.rec.policy === "fixed" && slot.rec.domain[0] === d[0] && slot.rec.domain[1] === d[1]) return slot.rec;
      const rec = axsRecord(entry, ws, "fixed", "finite", d, provenance("fixed", null, input, ws, 0));
      slots.set(key, { rec, sig: null, lastUpdateMs: -Infinity, heldAt: -Infinity, gestureAt: -Infinity });
      return rec;
    }

    function navigationRecord(entry, ws, input) {
      const d = Array.isArray(input.domain) && input.domain.length === 2 && axsFiniteNumber(input.domain[0]) && axsFiniteNumber(input.domain[1]) ? [input.domain[0], input.domain[1]] : null;
      const rec = axsRecord(entry, ws, "navigation", d === null ? "none" : "finite", d, provenance("navigation", null, input, ws, 0));
      rec.mappingId = null;
      return rec;
    }

    function waitingRecord(entry, ws, input) {
      const rec = axsRecord(entry, ws, "auto", "none", null, provenance("auto", null, input, ws, 0));
      rec.hold = "waiting";
      return rec;
    }

    function fit(entry, ws, key, input, now, cutMs, fresh, count, initial, heldAt, gestureAt) {
      const through = axsFiniteNumber(input.through) && input.through < cutMs ? input.through : cutMs;
      const rec = axsRecord(entry, ws, "auto", fresh.typed, fresh.domain, provenance("auto", through, input, ws, count));
      rec.initial = initial;
      slots.set(key, { rec, sig: input.sig, lastUpdateMs: now, heldAt, gestureAt });
      return rec;
    }

    function frame(id, input) {
      const entry = axsEntryOf(id);
      if (!axsIsObject(input)) throw new TypeError("axis frame needs an input object");
      const ws = axsWorkspace(input.workspace);
      if (entry.policy === "navigation") return navigationRecord(entry, ws, input);
      const key = ws + "|" + id;
      if (input.fixed !== undefined || entry.policy === "fixed") return fixedRecord(entry, ws, input, key);
      const cutMs = input.cutMs;
      const now = input.now;
      if (!axsFiniteNumber(cutMs) || !axsFiniteNumber(now)) throw new TypeError("axis frame needs a finite cutMs and now (ms)");
      let slot = slots.get(key);
      // A frozen slot is an explicit comparison domain: untouched, flagged when it reaches past the cutoff.
      if (slot !== undefined && slot.rec.policy === "frozen") {
        const through = slot.rec.provenance.through;
        slot.rec.external = through !== null && through > cutMs;
        slot.rec.hold = null;
        return slot.rec;
      }
      // 1 future-fitted: never painted (replay scrubbed back, or a zoom moved the edge).
      if (slot !== undefined && slot.rec.provenance.through > cutMs) {
        slots.delete(key);
        slot = undefined;
      }
      const held = axsIsObject(input.held) ? input.held : null;
      const play = held !== null && Boolean(held.play);
      const holding = held !== null && (Boolean(held.gesture) || play);
      const lastGesture = axsFiniteNumber(input.lastGestureAt) ? input.lastGestureAt : -Infinity;
      // 2 not eligible: the data is not coherent, so nothing is fitted and nothing is shown as current.
      if (!input.eligible) {
        if (slot !== undefined) {
          slot.rec.hold = "waiting";
          return slot.rec;
        }
        return waitingRecord(entry, ws, input);
      }
      if (typeof input.summary !== "function") throw new TypeError("axis frame needs a summary() callback for an Auto axis");
      const sign = input.sign === undefined ? entry.sign : input.sign;
      // 3 first fit: immediate, in a gesture too (DD-40: an axis with no record would draw nothing in a pan).
      if (slot === undefined) {
        const s = input.summary();
        const heldAt = holding ? now : -Infinity;
        return fit(entry, ws, key, input, now, cutMs, axsDomain(sign, s), s.count, true, heldAt, Math.max(heldAt, lastGesture));
      }
      if (holding) slot.heldAt = now;
      if (lastGesture > slot.gestureAt) slot.gestureAt = lastGesture;
      if (slot.heldAt > slot.gestureAt) slot.gestureAt = slot.heldAt;
      const rec = slot.rec;
      // 4 nothing pending: the signature is the cheap guard, the fresh domain the exact one.
      if (input.sig === slot.sig) {
        rec.hold = null;
        return rec;
      }
      const s = input.summary();
      const fresh = axsDomain(sign, s);
      if (axsSameDomain(rec, fresh)) {
        slot.sig = input.sig;
        rec.hold = null;
        return rec;
      }
      // 5 a real change is waiting behind a gesture or Play.
      if (holding) {
        rec.hold = play ? "play" : "gesture";
        return rec;
      }
      // 6 ... behind the settle time or the per-axis cap; the later of the two decides the label.
      const settleLeft = slot.gestureAt + settleMs - now;
      const capLeft = slot.lastUpdateMs + autoMs - now;
      if (settleLeft > 0 || capLeft > 0) {
        rec.hold = settleLeft > capLeft ? "settling" : "cap";
        return rec;
      }
      // 7 refit.
      return fit(entry, ws, key, input, now, cutMs, fresh, s.count, false, slot.heldAt, slot.gestureAt);
    }

    // freeze(id, {workspace?, domain?, through?, cutMs?, generation?, token?}) -> record | null: make an Auto axis
    // FROZEN (Comparison lock, or a restored address). With no `domain` the DISPLAYED domain of the current
    // record is frozen; with none recorded there is nothing to freeze and the answer is null (DD-22: a lock never
    // silently creates frozen state). An explicit `domain` [lo, hi] is validated (finite, lo <= hi, unsigned
    // from 0, signed symmetric) and creates the record, which is how an address restores one. `through` is
    // the end of the observations it was fitted on (null when unknown: then it is never "external").
    function freezeAxis(id, options2) {
      const entry = axsEntryOf(id);
      if (entry.policy !== "auto") throw new RangeError("axis " + id + " is not an Auto axis and cannot be frozen");
      const o = axsIsObject(options2) ? options2 : {};
      const ws = axsWorkspace(o.workspace);
      const key = ws + "|" + id;
      const slot = slots.get(key);
      let typed;
      let domain;
      let count = 0;
      let through = null;
      if (o.domain !== undefined) {
        const d = o.domain;
        if (!Array.isArray(d) || d.length !== 2 || !axsFiniteNumber(d[0]) || !axsFiniteNumber(d[1]) || d[0] > d[1]) throw new RangeError("freeze: a domain is [lo, hi] with lo <= hi");
        if (entry.sign === "unsigned" ? d[0] !== 0 : d[0] !== -d[1]) throw new RangeError("freeze: the domain must run from 0 (unsigned) or be symmetric about 0 (signed)");
        domain = [d[0], d[1]];
        typed = d[1] === 0 ? "zero-only" : "finite";
        through = axsFiniteNumber(o.through) ? o.through : null;
      } else {
        if (slot === undefined || slot.rec.domain === null) return null;
        domain = slot.rec.domain.slice();
        typed = slot.rec.typed;
        count = slot.rec.provenance.cohort.count;
        through = slot.rec.provenance.through;
      }
      const prov = provenance("frozen", through, o, ws, count);
      const rec = axsRecord(entry, ws, "frozen", typed, domain, prov);
      slots.set(key, { rec, sig: null, lastUpdateMs: -Infinity, heldAt: -Infinity, gestureAt: -Infinity });
      return rec;
    }

    // unfreeze(id, {workspace?}) -> record | null: a frozen axis goes back to Auto, keeping its domain until the
    // next eligible `frame()` refits it (its signature is cleared and no cap applies, so the refit is
    // immediate once the settle time has passed). Null when the axis was not frozen.
    function unfreezeAxis(id, options2) {
      axsEntryOf(id);
      const ws = axsWorkspace(axsIsObject(options2) ? options2.workspace : undefined);
      const slot = slots.get(ws + "|" + id);
      if (slot === undefined || slot.rec.policy !== "frozen") return null;
      const rec = slot.rec;
      rec.policy = "auto";
      rec.provenance.kind = "auto";
      rec.external = false;
      rec.hold = null;
      slot.sig = null;
      slot.lastUpdateMs = -Infinity;
      return rec;
    }

    function get(id, workspace) {
      axsEntryOf(id);
      const slot = slots.get(axsWorkspace(workspace) + "|" + id);
      return slot === undefined ? null : slot.rec;
    }

    // list(workspace?) -> the stored records, in catalogue order (live before replay when no workspace is named).
    function list(workspace) {
      const out = [];
      const spaces = workspace === undefined ? ["live", "replay"] : [axsWorkspace(workspace)];
      for (let w = 0; w < spaces.length; w++) {
        for (let i = 0; i < axsIds.length; i++) {
          const slot = slots.get(spaces[w] + "|" + axsIds[i]);
          if (slot !== undefined) out.push(slot.rec);
        }
      }
      return out;
    }

    // drop(id, workspace) -> how many records were removed. With `id` null or undefined it empties the whole
    // workspace (leaving replay discards every replay axis; nothing in the live workspace changes).
    function drop(id, workspace) {
      const ws = axsWorkspace(workspace);
      if (id === null || id === undefined) {
        let n = 0;
        for (let i = 0; i < axsIds.length; i++) if (slots.delete(ws + "|" + axsIds[i])) n++;
        return n;
      }
      axsEntryOf(id);
      return slots.delete(ws + "|" + id) ? 1 : 0;
    }

    // hasPending() -> is any record waiting on something (a non-null hold). O(#axes), allocation-free.
    function hasPending() {
      for (const slot of slots.values()) if (slot.rec.hold !== null) return true;
      return false;
    }

    // nextWake(env) -> ms until the earliest record whose hold a timer can end, or null. env = {now, playing?}.
    // Records held for a gesture, the cap or settling each become refittable at
    //   max(last held frame or gesture + settleMs, last update + autoMs)
    // so the answer is that minus `now` (0 when already due). A record held by Play ("Auto paused"), one
    // waiting for data, and every record while `env.playing` is true have no timer: they wake from data events
    // and from the pause, so the answer there is null (API.md C.12 vectors: a gesture ends at 1000 ->
    // nextWake 200, frame() at 1200 refits; lastUpdateMs 1000, a refit asked at 1200 -> hold "cap", nextWake 300).
    function nextWake(env) {
      const e = axsIsObject(env) ? env : {};
      if (!axsFiniteNumber(e.now)) throw new TypeError("axis nextWake needs a finite now (ms)");
      if (e.playing) return null;
      let best = null;
      for (const slot of slots.values()) {
        const hold = slot.rec.hold;
        if (hold !== "gesture" && hold !== "cap" && hold !== "settling") continue;
        const at = Math.max(slot.gestureAt + settleMs, slot.lastUpdateMs + autoMs);
        const wait = at > e.now ? at - e.now : 0;
        if (best === null || wait < best) best = wait;
      }
      return best;
    }

    return Object.freeze({ frame, freeze: freezeAxis, unfreeze: unfreezeAxis, get, list, drop, nextWake, hasPending });
  }

  API.axis = Object.freeze({
    CATALOGUE: axsCatalogue,
    domain: axsDomain,
    registry: axsRegistry,
    coordinate: axsCoordinate,
    ticks: axsTicks,
  });
