  // @part 14-policy
  // @requires 04-text 05-measure 08-scale 10-context
  // @prefix pol
  // @provides policy
  // == §14 policy: the scale preferences, what a measure offers, the reducers and the mapping resolution (API.md B.8, C.9, DR-04, DR-05, DR-07, DR-09, DD-65, DD-82) ==
  // `S.scale` holds what the person CHOSE: basis, path basis, transform, curve, the Rows transform, the colour
  // policies, Local contrast, a manual share window and the Comparison lock. Nothing here writes to it in place:
  // every function is pure, `reduce` returns a new object, and what a measure can actually use is derived, not
  // stored (DD-82). That is the point of `effective`: cycling the measure (M) from Volume (Intensity, Rank)
  // through Flow and back must restore Intensity and Rank, so Flow must READ "amount" and "value" without ever
  // rewriting the preference. The names avoid `auto`, `locked`, `tier` and `neutral` for the new vocabulary
  // (DR-04): the policies are `explore` and `auto`, the lock is `lock`, Local contrast is `local`.
  //
  // What the other parts of the page hand in (nothing here reads the page):
  //   mode, rows       the current Cells measure (S.mode) and the current Rows measure key (volume | delta | time |
  //                    relvol), which decide what is offered
  //   ctx, store       a Ctx (E.context.cellsKey / rowsKey) and an E.store, for `resolve`
  //   active           the resolved Calibration records a lock holds, {cells, rows}
  //   axes             the displayed Auto axes a lock freezes, [{id, domain:[lo, hi], through?}]
  // Channels are named "cells" | "rows" in actions and "c" | "r" in held keys and resolve (DD-65).

  const polBases = Object.freeze(["amount", "intensity"]);
  const polPathBases = Object.freeze(["spans", "usdt", "perMinute"]);
  const polTransforms = Object.freeze(["value", "rank"]);
  const polCurves = Object.freeze(["log", "linear"]);
  const polColourPolicies = Object.freeze(["explore", "auto"]);
  // The preference fields a view persists (B.8); `held` and `frozen` are runtime and travel only as the
  // descriptors of the ACTIVE mappings, through the codec, and `resume` exists only while the lock is on.
  const polPersistKeys = Object.freeze(["basis", "pathBasis", "transform", "curve", "rowsTransform", "cells", "rows", "local", "window", "lock"]);
  // The measures that need the live cube (the recorded page lists them off): Path and Dwell motion, and the
  // Rows time at price.
  const polLiveOnlyCells = Object.freeze(["path", "dwell"]);
  const polLiveOnlyRows = Object.freeze(["time"]);

  function polDeepFreeze(v) {
    if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) polDeepFreeze(v[keys[i]]);
    }
    return v;
  }

  // E.policy.DEFAULTS (API.md A.3, B.8): the S.scale of a fresh page, deep-frozen. Callers clone it with
  // structuredClone. `resume` is null unless the lock is on; `held` and `frozen` are empty.
  const polDefaults = polDeepFreeze({
    basis: "amount",
    pathBasis: "spans",
    transform: "value",
    curve: "log",
    rowsTransform: "value",
    cells: "explore",
    rows: "explore",
    local: false,
    window: null,
    lock: false,
    resume: null,
    held: {},
    frozen: {},
  });

  function polIsObject(x) {
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function polNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
  }

  // The preferences object of a call: S.scale itself, or the defaults when a caller has none yet.
  function polScale(scale) {
    if (scale === undefined || scale === null) return polDefaults;
    if (!polIsObject(scale)) throw new TypeError("policy: S.scale is an object");
    return scale;
  }

  function polCapitalise(word) {
    return typeof word === "string" && word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : String(word);
  }

  function polNotOffered(label) {
    return API.text.fill(API.text.ui.notOffered, { measure: label });
  }

  function polModeOf(mode) {
    const m = typeof mode === "string" && Object.prototype.hasOwnProperty.call(API.measure.MODES, mode) ? API.measure.MODES[mode] : null;
    if (m === null) throw new RangeError("policy: unknown Cells measure " + String(mode));
    return m;
  }

  function polRowsOf(key) {
    const m = typeof key === "string" && Object.prototype.hasOwnProperty.call(API.measure.ROWS, key) ? API.measure.ROWS[key] : null;
    if (m === null) throw new RangeError("policy: unknown Rows measure " + String(key));
    return m;
  }

  // The fixed-descriptor kind a manual share window narrows, per Cells measure (DD-66): Taker flow keeps its
  // diverging arms about 0.5, Dwell its unsigned share. Every other measure has no window.
  function polWindowKind(mode) {
    return mode === "flow" || mode === "flowtrades" ? "share-diverging" : mode === "dwell" ? "unsigned-share" : null;
  }

  // The reason a window is not valid for a fixed kind (the RangeError E.scale.fixed throws, in E.text words),
  // or null when it is. The text of the message picks the wording: a symmetry failure is its own reason.
  function polWindowProblem(kind, win) {
    try {
      API.scale.fixed(kind, win);
      return null;
    } catch (error) {
      const message = error && typeof error.message === "string" ? error.message : "";
      return message.indexOf("symmetric") >= 0 ? API.text.reject.windowSymmetric : API.text.reject.windowRange;
    }
  }

  // E.policy.effective (API.md A.3, DD-82): what the raw preferences MEAN for one measure. Pure, allocates one
  // small object, never writes back.
  //   effective(scale, mode)            -> {basis, pathBasis, transform, curve, window}   (Cells)
  //   effective(scale, rowsKey, "rows") -> the same shape for a Rows measure (basis "amount", pathBasis "spans",
  //                                        window null; `rowsTransform` read as `transform`)
  // basis: the raw basis only where the measure lists it (Volume, Trades, Delta), else "amount" (a measure with
  // one basis has no Intensity, so Intensity reads as Amount). pathBasis: the raw one only for Path, else
  // "spans". transform: "rank" only where the measure has a Rank (unsigned unbounded), else "value". curve:
  // "linear" only where the measure is unbounded and Rank is not in effect, else "log". window: the raw window
  // only when it is valid for THIS measure (flow and flowtrades: symmetric about 0.5; dwell: any 0 <= lo < hi <= 1),
  // else null. The address keeps the raw values, so none of this survives as a stored change.
  function polEffective(scale, subject, channel) {
    const raw = polScale(scale);
    if (channel === "rows") {
      const m = polRowsOf(subject);
      const transform = raw.rowsTransform === "rank" && m.rank ? "rank" : "value";
      const curve = m.kind === "unbounded" && transform === "value" && raw.curve === "linear" ? "linear" : "log";
      return { basis: "amount", pathBasis: "spans", transform, curve, window: null };
    }
    const m = polModeOf(subject);
    const basis = polBases.indexOf(raw.basis) >= 0 && m.bases.indexOf(raw.basis) >= 0 ? raw.basis : "amount";
    const pathBasis = subject === "path" && m.bases.indexOf(raw.pathBasis) >= 0 ? raw.pathBasis : "spans";
    const transform = raw.transform === "rank" && m.rank ? "rank" : "value";
    const curve = m.kind === "unbounded" && transform === "value" && raw.curve === "linear" ? "linear" : "log";
    const kind = polWindowKind(subject);
    const win = kind !== null && Array.isArray(raw.window) && polWindowProblem(kind, raw.window) === null ? raw.window : null;
    return { basis, pathBasis, transform, curve, window: win };
  }

  // E.policy.offers (API.md A.3, C.9, DD-73): which controls a measure offers, so the Scale section of a menu
  // hard-codes nothing. `channel` "cells" takes `subject` = the S.mode, "rows" the Rows measure key;
  // `live` is PACK.live (false on the recorded page, where Path, Dwell and Rows time at price are not
  // available); `label` optionally names the measure in the "why not" texts (default: the key, capitalised).
  //   -> {basis[], pathBasis[], transform[], curve[], policy[], lock, fit, local, available, reasons}
  // basis: Amount and Intensity where the measure lists them (Volume, Trades, Delta); pathBasis: Path's three
  // variants; transform: "value" for every unbounded measure plus "rank" where it has one (Delta and the fixed
  // measures have none, Rows Rank only for Volume and Time at price); curve: log and linear only for an
  // unbounded measure whose Rank is not in effect; policy: explore and auto for an unbounded measure (auto
  // is withheld while the lock holds: "Auto paused"); lock: the lock can be engaged here or released; fit:
  // explicit Fit (unbounded only; a fixed domain has nothing to fit); local: Local contrast (Cells, unbounded).
  // `reasons` maps "<group>.<item>" (for example "transform.rank", "basis.intensity", "curve.linear",
  // "policy.auto", "lock", "fit", "local", "measure") to the accessible text saying why an item is disabled.
  function polOffers(channel, subject, scale, live, label) {
    if (channel !== "cells" && channel !== "rows") throw new RangeError("offers: channel is cells or rows");
    const raw = polScale(scale);
    const m = channel === "cells" ? polModeOf(subject) : polRowsOf(subject);
    const name = typeof label === "string" && label !== "" ? label : polCapitalise(subject);
    const reasons = {};
    const out = { basis: [], pathBasis: [], transform: [], curve: [], policy: [], lock: Boolean(raw.lock), fit: false, local: false, available: true, reasons };
    const liveOnly = (channel === "cells" ? polLiveOnlyCells : polLiveOnlyRows).indexOf(subject) >= 0;
    if (live === false && liveOnly) {
      out.available = false;
      reasons.measure = API.text.fill(API.text.typed.unsupported, { reason: "live cube only" });
      return out;
    }
    const unbounded = m.kind === "unbounded";
    const notOffered = polNotOffered(name);
    if (channel === "cells") {
      for (let i = 0; i < m.bases.length; i++) if (polBases.indexOf(m.bases[i]) >= 0) out.basis.push(m.bases[i]);
      if (subject === "path") for (let i = 0; i < m.bases.length; i++) out.pathBasis.push(m.bases[i]);
      if (out.basis.length === 0) reasons["basis.intensity"] = notOffered;
      if (out.pathBasis.length === 0) {
        reasons["pathBasis.usdt"] = notOffered;
        reasons["pathBasis.perMinute"] = notOffered;
      }
    }
    if (unbounded) out.transform = m.rank ? ["value", "rank"] : ["value"];
    else reasons["transform.value"] = notOffered;
    if (!m.rank) reasons["transform.rank"] = notOffered;
    const rankInEffect = (channel === "cells" ? raw.transform : raw.rowsTransform) === "rank" && m.rank;
    if (unbounded && !rankInEffect) out.curve = ["log", "linear"];
    else reasons["curve.linear"] = unbounded ? API.text.reject.curveRank : notOffered;
    if (unbounded) {
      out.policy = raw.lock ? ["explore"] : ["explore", "auto"];
      if (raw.lock) reasons["policy.auto"] = API.text.state.autoPausedLock;
      out.fit = true;
      out.lock = true;
    } else {
      reasons["policy.auto"] = notOffered;
      reasons.fit = notOffered;
      if (!raw.lock) reasons.lock = notOffered;
    }
    if (channel === "cells" && unbounded) out.local = true;
    else reasons.local = notOffered;
    return out;
  }

  // The reason words of an incompatible held mapping (E.scale.compat's machine reasons) in E.text.
  function polIncompatText(reason) {
    const t = API.text.lock.incompatible;
    if (reason === "different formula family") return t.family;
    if (reason === "amount vs intensity") return t.basis;
    if (reason === "signed vs unsigned") return t.signed;
    if (reason === "different transform") return t.transform;
    if (reason === "different rank algorithm") return t.rankAlgo;
    if (reason === "different formula version") return t.version;
    return String(reason);
  }

  function polResolved(fields) {
    return Object.freeze({
      state: fields.state,
      desc: fields.desc === undefined ? null : fields.desc,
      record: fields.record === undefined ? null : fields.record,
      policy: fields.policy,
      origin: fields.origin === undefined ? null : fields.origin,
      id: fields.desc && typeof fields.desc.id === "string" ? fields.desc.id : null,
      channel: fields.channel,
      key: fields.key === undefined ? null : fields.key,
      workspace: fields.workspace,
      external: Boolean(fields.external),
      fallback: fields.fallback === undefined ? null : fields.fallback,
      reason: fields.reason === undefined ? null : fields.reason,
      detail: fields.detail === undefined ? null : fields.detail,
      ineligibleNewer: Boolean(fields.ineligibleNewer),
      obsEndMs: fields.record ? fields.record.obsEndMs : null,
    });
  }

  // E.policy.resolve (API.md C.9, DR-06, DR-07, DD-22, DD-65, DD-74): which mapping does this channel draw with?
  //   resolve({channel "c"|"r", kind "unbounded"|"fixed"|"occupancy", ctx, classKey?, scale (RAW S.scale), store,
  //            workspace, cutMs, fixed (the descriptor, for kind "fixed")})
  // Branches, first that applies:
  //   occupancy           {state:"ok", desc:null, policy:"fixed"}            (Geometry: an outline, nothing to map)
  //   fixed               {state:"ok", desc:fixed, policy:"fixed"}           (a natural domain: no store, no lock)
  //   held                the lock (or a manual domain) holds a compatible mapping for THIS channel and class:
  //                       {state:"ok", record:held, policy:"comparison", external}, `external` true when its
  //                       observations end after the cutoff (the replay "external comparison override");
  //   not held / refused  under the lock with nothing held for this channel and class, or a held mapping
  //                       E.scale.compat refuses (a different formula version): fall through to Explore with
  //                       `fallback` ("not-held" | "incompatible"), `detail` (E.text, naming the compat reason)
  //                       and policy "explore" (Auto is suspended by the lock). Never a silent fit-and-freeze;
  //   store hit           the newest ELIGIBLE record of the context (obsEndMs <= cutMs): {state:"ok", record,
  //                       policy: "auto" | "explore" by the channel's preference};
  //   miss                {state:"no-calibration", reason:"replay" (a newer record exists but the cutoff makes
  //                       it ineligible) | "uninitialized"}. A miss NEVER borrows another context's mapping
  //                       (DR-06), and there is no "retained" branch: an eligible record is the store hit, and
  //                       "Updating" is set by the page from a pending want, not here (DD-74).
  // The result is frozen and carries every field a frame or chip reads: state, desc, record, policy, origin,
  // id, channel, key, workspace, external, fallback, reason, detail, ineligibleNewer, obsEndMs.
  function polResolve(input) {
    if (!polIsObject(input)) throw new TypeError("resolve needs an input object");
    const channel = input.channel;
    if (channel !== "c" && channel !== "r") throw new RangeError("resolve: channel is c (Cells) or r (Rows)");
    const workspace = input.workspace === undefined ? "live" : input.workspace;
    if (workspace !== "live" && workspace !== "replay") throw new RangeError("resolve: workspace is live or replay");
    const kind = input.kind === undefined ? "unbounded" : input.kind;
    if (kind === "occupancy") return polResolved({ state: "ok", policy: "fixed", origin: "fixed", channel, workspace });
    if (kind === "fixed") {
      if (!polIsObject(input.fixed)) throw new TypeError("resolve: kind fixed needs the fixed descriptor");
      return polResolved({ state: "ok", desc: input.fixed, policy: "fixed", origin: "fixed", channel, workspace });
    }
    if (!polIsObject(input.ctx)) throw new TypeError("resolve needs the context");
    if (input.store === null || typeof input.store !== "object" || typeof input.store.lookup !== "function") throw new TypeError("resolve needs the store");
    const raw = polScale(input.scale);
    const key = API.context.keyString(input.ctx);
    const classKey = typeof input.classKey === "string" ? input.classKey : API.context.compatClass(input.ctx);
    const cutMs = polNumber(input.cutMs) ? input.cutMs : Infinity;
    const heldMap = polIsObject(raw.held) ? raw.held : {};
    const locked = Boolean(raw.lock);
    const held = heldMap[channel + "|" + classKey];
    let fallback = null;
    let detail = null;
    if (polIsObject(held) && (locked || held.origin === "manual")) {
      const c = API.scale.compat(polIsObject(held.ctx) ? held : held.desc, input.ctx);
      if (c.ok) return polResolved({ state: "ok", desc: held.desc, record: held, policy: "comparison", origin: held.origin, channel, key, workspace, external: held.obsEndMs > cutMs });
      fallback = "incompatible";
      detail = API.text.state.notHeld + ": " + polIncompatText(c.reason);
    } else if (locked) {
      // Nothing is held for this channel and class: say why, against the mapping this channel DOES hold
      // (preferring the one of the same measure), so "Amount vs Intensity" reads as that and not as "none".
      fallback = "not-held";
      detail = API.text.state.notHeld;
      let pick = null;
      const names = Object.keys(heldMap);
      for (let i = 0; i < names.length; i++) {
        if (names[i].charAt(0) !== channel || !polIsObject(heldMap[names[i]])) continue;
        const h = heldMap[names[i]];
        if (pick === null || (polIsObject(h.ctx) && h.ctx.measure === input.ctx.measure)) pick = h;
      }
      if (pick !== null) {
        const c = API.scale.compat(polIsObject(pick.ctx) ? pick : pick.desc, input.ctx);
        if (!c.ok) detail = API.text.state.notHeld + ": " + polIncompatText(c.reason);
      }
    }
    const preferred = locked ? "explore" : (channel === "c" ? raw.cells : raw.rows) === "auto" ? "auto" : "explore";
    const hit = input.store.lookup(workspace, key, cutMs);
    if (hit !== null) {
      return polResolved({ state: "ok", desc: hit.record.desc, record: hit.record, policy: preferred, origin: hit.record.origin, channel, key, workspace, external: hit.external, fallback, detail, ineligibleNewer: hit.ineligibleNewer });
    }
    const last = input.store.latest(workspace, key);
    return polResolved({ state: "no-calibration", policy: preferred, channel, key, workspace, fallback, detail, reason: last !== null && last.obsEndMs > cutMs ? "replay" : "uninitialized" });
  }

  // ---- reducers (E.policy.reduce) ---------------------------------------------------------------------

  // A result with changes is a NEW object; with none (an explicit Fit changes no preference) the scale is
  // returned as it came, so the page can skip a needless save.
  function polResult(scale, changes, effects, notices) {
    const next = Object.keys(changes).length === 0 ? scale : Object.assign({}, scale, changes);
    return { scale: next, effects, notices, rejected: null };
  }

  function polNoop(scale) {
    return { scale, effects: [], notices: [], rejected: null };
  }

  // A rejected action changes NOTHING (the scale is returned as it came) and says which item and why, in E.text.
  function polReject(scale, item, reason) {
    return { scale, effects: [], notices: [], rejected: { item, reason } };
  }

  function polChannel(action) {
    const c = action.channel;
    if (c === "cells" || c === "c") return "cells";
    if (c === "rows" || c === "r") return "rows";
    throw new RangeError("policy action " + action.type + " needs channel cells or rows");
  }

  function polLetter(channel) {
    return channel === "cells" ? "c" : "r";
  }

  // The offers of the channel an action is about; the page must say which measure is current.
  function polOffersFor(channel, scale, env) {
    if (channel === "cells") {
      if (env.mode === undefined) throw new TypeError("policy: this action needs env.mode, the current Cells measure");
      return polOffers("cells", env.mode, scale, env.live, env.label);
    }
    if (env.rows === undefined) throw new TypeError("policy: this action needs env.rows, the current Rows measure");
    return polOffers("rows", env.rows, scale, env.live, env.rowsLabel);
  }

  function polHeldCopy(scale) {
    return polIsObject(scale.held) ? Object.assign({}, scale.held) : {};
  }

  function polHeldKey(channel, classKey) {
    return polLetter(channel) + "|" + classKey;
  }

  function polLimitNotice() {
    return { code: "limit", params: { max: LIMITS.HELD_MAX } };
  }

  // A held copy of a calibration: marked as an explicit comparison, everything else as it was fitted.
  function polHold(record) {
    return Object.freeze(Object.assign({}, record, { policy: "comparison" }));
  }

  function polClassOf(record) {
    return polIsObject(record.ctx) ? API.context.compatClass(record) : API.context.compatClass(record.desc);
  }

  // E.policy.reduce (API.md A.3, C.9, DR-07, DD-65, DD-66, DD-71, DD-82): every UI action as a reducer.
  //   reduce(scale, action, env) -> {scale, effects[], notices[], rejected}
  // `scale` is returned UNCHANGED (same object) for a no-op and for a rejected action; otherwise it is a new
  // object (the input is never mutated). An action that sets a value the CURRENT measure does not offer is
  // rejected with `rejected = {item, reason}` (E.text words) and changes nothing, and no action rewrites a field it
  // was not asked to set (DD-82). An unknown action type is a programming error and throws.
  // Actions:
  //   {type:"basis", value:"amount"|"intensity"}                      Cells Volume, Trades, Delta
  //   {type:"pathBasis", value:"spans"|"usdt"|"perMinute"}           Cells Path
  //   {type:"transform", value:"value"|"rank"}, {type:"rowsTransform", value}   (Rank where the measure has one)
  //   {type:"curve", value:"log"|"linear"}          (DD-71: not for a fixed measure or while Rank is in effect)
  //   {type:"policy", channel, value:"explore"|"auto"}                (Auto is withheld under the lock)
  //   {type:"lock"}, {type:"unlock"}                                  (Comparison lock, ONE action, DR-07)
  //   {type:"fit", channel}                     (explicit Fit: an effect; a manual domain of that channel is cleared)
  //   {type:"local", value:boolean}                                   (Local contrast, unbounded Cells only)
  //   {type:"window", value:[lo, hi] | null}    (DD-66: Taker flow symmetric about 0.5, Dwell any 0 <= lo < hi <= 1)
  //   {type:"manual", channel, kind:"value-log1p"|"value-linear", U, k}   (a manual domain: holds ONE channel and
  //                                                                   ONE class, does not engage the lock)
  //   {type:"clearManual", channel, classKey?}
  //   {type:"hold", channel, record}     (the page, after an explicit Fit under the lock: the new mapping replaces
  //                                       the held one and the lock stays on)
  // env = {mode, rows, live, label, rowsLabel, active:{cells, rows}, axes:[{id, domain, through?}], contexts:{cells,
  // rows}, cutMs}; only what an action names is required. `effects` are data the page executes:
  //   {type:"invalidate", channel:"cells"|"rows"|"lens"|"all"}   redraw and re-resolve
  //   {type:"request-fit", channel, kind:"fit"|"auto", locked?}  ask the lifecycle for a fit
  //   {type:"freeze-axis", id, domain, through} / {type:"unfreeze-axis", id}   the lock and its release
  // `notices` are {code, params} for E.notice.post (the held-mapping limit is the only one).
  function polReduce(scale, action, env) {
    const cur = polScale(scale);
    if (!polIsObject(action) || typeof action.type !== "string") throw new TypeError("reduce needs an action {type, ...}");
    const e = polIsObject(env) ? env : {};
    switch (action.type) {
      case "basis":
      case "pathBasis": {
        const field = action.type;
        const offers = polOffersFor("cells", cur, e);
        const list = offers[field];
        if (list.indexOf(action.value) < 0) return polReject(cur, field + "." + String(action.value), offers.reasons[field + "." + String(action.value)] || polNotOffered(polCapitalise(e.label || e.mode)));
        if (cur[field] === action.value) return polNoop(cur);
        return polResult(cur, { [field]: action.value }, [{ type: "invalidate", channel: "cells" }], []);
      }
      case "transform":
      case "rowsTransform": {
        const channel = action.type === "transform" ? "cells" : "rows";
        const offers = polOffersFor(channel, cur, e);
        if (offers.transform.indexOf(action.value) < 0) return polReject(cur, "transform." + String(action.value), offers.reasons["transform." + String(action.value)] || polNotOffered(polCapitalise(channel === "cells" ? e.label || e.mode : e.rowsLabel || e.rows)));
        if (cur[action.type] === action.value) return polNoop(cur);
        return polResult(cur, { [action.type]: action.value }, [{ type: "invalidate", channel }], []);
      }
      case "curve": {
        if (e.mode === undefined && e.rows === undefined) throw new TypeError("policy: the curve action needs env.mode or env.rows");
        if (polCurves.indexOf(action.value) < 0) return polReject(cur, "curve." + String(action.value), API.text.reject.curveRank);
        const okCells = e.mode !== undefined && polOffers("cells", e.mode, cur, e.live).curve.indexOf(action.value) >= 0;
        const okRows = e.rows !== undefined && polOffers("rows", e.rows, cur, e.live).curve.indexOf(action.value) >= 0;
        if (!okCells && !okRows) return polReject(cur, "curve." + action.value, API.text.reject.curveRank);
        if (cur.curve === action.value) return polNoop(cur);
        return polResult(cur, { curve: action.value }, [{ type: "invalidate", channel: "all" }], []);
      }
      case "policy": {
        const channel = polChannel(action);
        const offers = polOffersFor(channel, cur, e);
        if (offers.policy.indexOf(action.value) < 0) return polReject(cur, "policy." + String(action.value), offers.reasons["policy." + String(action.value)] || polNotOffered(polCapitalise(channel === "cells" ? e.label || e.mode : e.rowsLabel || e.rows)));
        if (cur[channel] === action.value) return polNoop(cur);
        const effects = [{ type: "invalidate", channel }];
        if (action.value === "auto") effects.push({ type: "request-fit", channel, kind: "auto" });
        return polResult(cur, { [channel]: action.value }, effects, []);
      }
      case "lock": {
        if (cur.lock) return polNoop(cur);
        const held = polHeldCopy(cur);
        const frozen = {};
        const effects = [{ type: "invalidate", channel: "all" }];
        const active = polIsObject(e.active) ? e.active : {};
        const channels = ["cells", "rows"];
        for (let i = 0; i < channels.length; i++) {
          const rec = active[channels[i]];
          if (!polIsObject(rec) || !polIsObject(rec.desc) || rec.desc.kind === "none" || rec.desc.kind === "fixed-linear" || rec.desc.kind === "fixed-diverging") continue;
          const name = polHeldKey(channels[i], polClassOf(rec));
          // A manual domain the person set stays as it is; the lock holds what was ACTIVE.
          if (polIsObject(held[name]) && held[name].origin === "manual") continue;
          held[name] = polHold(rec);
        }
        if (Object.keys(held).length > LIMITS.HELD_MAX) return { scale: cur, effects: [], notices: [polLimitNotice()], rejected: { item: "lock", reason: API.text.fill(API.text.notice.limit, { max: LIMITS.HELD_MAX }) } };
        const axes = Array.isArray(e.axes) ? e.axes : [];
        for (let i = 0; i < axes.length; i++) {
          const a = axes[i];
          if (!polIsObject(a) || typeof a.id !== "string" || !Array.isArray(a.domain) || !polNumber(a.domain[0]) || !polNumber(a.domain[1])) continue;
          frozen[a.id] = { lo: a.domain[0], hi: a.domain[1] };
          effects.push({ type: "freeze-axis", id: a.id, domain: [a.domain[0], a.domain[1]], through: polNumber(a.through) ? a.through : null });
        }
        return polResult(cur, { lock: true, resume: { cells: cur.cells, rows: cur.rows }, cells: "explore", rows: "explore", held, frozen }, effects, []);
      }
      case "unlock": {
        if (!cur.lock) return polNoop(cur);
        const held = {};
        const old = polHeldCopy(cur);
        const names = Object.keys(old);
        for (let i = 0; i < names.length; i++) if (polIsObject(old[names[i]]) && old[names[i]].origin === "manual") held[names[i]] = old[names[i]];
        const effects = [{ type: "invalidate", channel: "all" }];
        const ids = polIsObject(cur.frozen) ? Object.keys(cur.frozen) : [];
        for (let i = 0; i < ids.length; i++) effects.push({ type: "unfreeze-axis", id: ids[i] });
        const resume = polIsObject(cur.resume) ? cur.resume : {};
        const cells = polColourPolicies.indexOf(resume.cells) >= 0 ? resume.cells : "explore";
        const rows = polColourPolicies.indexOf(resume.rows) >= 0 ? resume.rows : "explore";
        return polResult(cur, { lock: false, resume: null, cells, rows, held, frozen: {} }, effects, []);
      }
      case "fit": {
        const channel = polChannel(action);
        const offers = polOffersFor(channel, cur, e);
        if (!offers.fit) return polReject(cur, "fit", offers.reasons.fit || polNotOffered(polCapitalise(channel === "cells" ? e.label || e.mode : e.rowsLabel || e.rows)));
        const effects = [{ type: "request-fit", channel, kind: "fit", locked: Boolean(cur.lock) }, { type: "invalidate", channel }];
        // Fit replaces a manual domain of this channel (it is the explicit way back to a fitted mapping).
        const held = polHeldCopy(cur);
        let cleared = false;
        const names = Object.keys(held);
        for (let i = 0; i < names.length; i++) {
          if (names[i].charAt(0) === polLetter(channel) && polIsObject(held[names[i]]) && held[names[i]].origin === "manual") {
            delete held[names[i]];
            cleared = true;
          }
        }
        return polResult(cur, cleared ? { held } : {}, effects, []);
      }
      case "local": {
        if (typeof action.value !== "boolean") throw new TypeError("policy: local needs true or false");
        if (action.value) {
          const offers = polOffersFor("cells", cur, e);
          if (!offers.local) return polReject(cur, "local", offers.reasons.local || polNotOffered(polCapitalise(e.label || e.mode)));
        }
        if (cur.local === action.value) return polNoop(cur);
        return polResult(cur, { local: action.value }, [{ type: "invalidate", channel: "lens" }], []);
      }
      case "window": {
        if (action.value === null) return cur.window === null ? polNoop(cur) : polResult(cur, { window: null }, [{ type: "invalidate", channel: "cells" }], []);
        if (e.mode === undefined) throw new TypeError("policy: the window action needs env.mode");
        const kind = polWindowKind(e.mode);
        if (kind === null) return polReject(cur, "window", API.text.note.windowNotApplied);
        const problem = polWindowProblem(kind, action.value);
        if (problem !== null) return polReject(cur, "window", problem);
        return polResult(cur, { window: [action.value[0], action.value[1]] }, [{ type: "invalidate", channel: "cells" }], []);
      }
      case "manual": {
        const channel = polChannel(action);
        const offers = polOffersFor(channel, cur, e);
        if (!offers.fit) return polReject(cur, "manual", offers.reasons.fit || polNotOffered(polCapitalise(channel === "cells" ? e.label || e.mode : e.rowsLabel || e.rows)));
        const ctx = polIsObject(e.contexts) ? e.contexts[channel] : null;
        if (!polIsObject(ctx)) return polReject(cur, "manual", API.text.state.noCalibration);
        if (action.kind !== "value-log1p" && action.kind !== "value-linear") return polReject(cur, "manual", API.text.reject.manual);
        const signed = API.context.compatClass(ctx).split("|")[2] === "s";
        const fit = API.scale.manual({ kind: action.kind, signed, U: action.U, k: action.k });
        if (fit.state !== "ok") return polReject(cur, "manual", API.text.reject.manual);
        const held = polHeldCopy(cur);
        const name = polHeldKey(channel, API.context.compatClass(ctx));
        const at = polNumber(e.cutMs) ? e.cutMs : 0;
        held[name] = Object.freeze({
          v: 1,
          key: API.context.keyString(ctx),
          ctx,
          desc: fit.descriptor,
          policy: "comparison",
          origin: "manual",
          workspace: ctx.workspace,
          cohort: { kind: channel, n: 0, zeros: 0, nonzero: 0 },
          obsEndMs: at,
          cutMs: at,
          algorithm: "manual@1",
        });
        if (Object.keys(held).length > LIMITS.HELD_MAX) return { scale: cur, effects: [], notices: [polLimitNotice()], rejected: { item: "manual", reason: API.text.fill(API.text.notice.limit, { max: LIMITS.HELD_MAX }) } };
        return polResult(cur, { held }, [{ type: "invalidate", channel }], []);
      }
      case "clearManual": {
        const channel = polChannel(action);
        const held = polHeldCopy(cur);
        let cleared = false;
        const names = Object.keys(held);
        for (let i = 0; i < names.length; i++) {
          const hit = names[i].charAt(0) === polLetter(channel) && polIsObject(held[names[i]]) && held[names[i]].origin === "manual" && (typeof action.classKey !== "string" || names[i] === polHeldKey(channel, action.classKey));
          if (hit) {
            delete held[names[i]];
            cleared = true;
          }
        }
        return cleared ? polResult(cur, { held }, [{ type: "invalidate", channel }], []) : polNoop(cur);
      }
      case "hold": {
        const channel = polChannel(action);
        const rec = action.record;
        if (!polIsObject(rec) || !polIsObject(rec.desc) || !polIsObject(rec.ctx)) throw new TypeError("policy: hold needs a calibration record with its context");
        if (!cur.lock && rec.origin !== "manual") return polReject(cur, "hold", API.text.ui.lock);
        const held = polHeldCopy(cur);
        held[polHeldKey(channel, polClassOf(rec))] = polHold(rec);
        if (Object.keys(held).length > LIMITS.HELD_MAX) return { scale: cur, effects: [], notices: [polLimitNotice()], rejected: { item: "hold", reason: API.text.fill(API.text.notice.limit, { max: LIMITS.HELD_MAX }) } };
        return polResult(cur, { held }, [{ type: "invalidate", channel }], []);
      }
      default:
        throw new TypeError("policy: unknown action type " + action.type);
    }
  }

  // ---- persistence of the preferences ---------------------------------------------------------------------

  // E.policy.persisted (API.md A.3, B.8): the serialised subset, RAW preferences (never the effective view), each
  // left out at its default (omitted = default under vis=2, DR-14). The runtime fields (`resume`, `held`,
  // `frozen`) are not here: the descriptors of the ACTIVE mappings travel through the codec.
  function polPersisted(scale) {
    const s = polScale(scale);
    const out = {};
    for (let i = 0; i < polPersistKeys.length; i++) {
      const k = polPersistKeys[i];
      if (k === "window") {
        if (Array.isArray(s.window)) out.window = [s.window[0], s.window[1]];
      } else if (s[k] !== undefined && s[k] !== polDefaults[k]) {
        out[k] = s[k];
      }
    }
    return out;
  }

  function polPick(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  // E.policy.sanitize (API.md A.3): for IMPORTED payloads only. Returns a new S.scale in which every
  // preference that is not a legal value for ANY measure is replaced by its default (a value that is legal
  // for some measure but not the current one is kept: that is `effective`'s business). A window must be two
  // numbers with 0 <= lo < hi <= 1; `held` and `frozen` come only from restored descriptors (`restore`) and
  // start empty; `resume` exists only with the lock.
  function polSanitize(scale) {
    const s = polIsObject(scale) ? scale : {};
    const d = polDefaults;
    const win = Array.isArray(s.window) && s.window.length === 2 && polNumber(s.window[0]) && polNumber(s.window[1]) && s.window[0] >= 0 && s.window[1] <= 1 && s.window[0] < s.window[1] ? [s.window[0], s.window[1]] : null;
    const cells = polPick(s.cells, polColourPolicies, d.cells);
    const rows = polPick(s.rows, polColourPolicies, d.rows);
    const lock = s.lock === true;
    return {
      basis: polPick(s.basis, polBases, d.basis),
      pathBasis: polPick(s.pathBasis, polPathBases, d.pathBasis),
      transform: polPick(s.transform, polTransforms, d.transform),
      curve: polPick(s.curve, polCurves, d.curve),
      rowsTransform: polPick(s.rowsTransform, polTransforms, d.rowsTransform),
      cells,
      rows,
      local: s.local === true,
      window: win,
      lock,
      resume: lock ? { cells: polPick(polIsObject(s.resume) ? s.resume.cells : undefined, polColourPolicies, "explore"), rows: polPick(polIsObject(s.resume) ? s.resume.rows : undefined, polColourPolicies, "explore") } : null,
      held: {},
      frozen: {},
    };
  }

  const polPolicyWords = Object.freeze({ e: "explore", a: "auto", k: "comparison", l: "local", x: "frozen", explore: "explore", auto: "auto", comparison: "comparison", local: "local", frozen: "frozen" });
  const polOriginWords = Object.freeze(["fit", "manual", "restored", "external"]);

  // E.policy.restore (API.md A.3, C.13 "Restoring descriptors"): turn what a link or a portable code carried into
  // the state of a page. `obj` = {scale?, records?, axes?, replay?}:
  //   scale     the persisted preference subset (missing fields are the defaults; sanitised)
  //   records   validated descriptor records {chan, policy, origin, desc, ctx, cohort, obsEndMs, cutMs, token}:
  //             chan "c" | "r" (colour), "l" (the lens's Local contrast), "a.<axisId>" (a frozen axis domain);
  //             policy as a word or the one-letter code of B.15 (e explore, a auto, k comparison, l local, x frozen)
  //   axes      [{id, domain, through?}] frozen axes of a portable code
  //   replay    true when the page has a replay to restore replay-workspace records into
  // -> {scale, commits, frozen, lens, dropped}
  //   scale     the new S.scale (preferences; `held` holds the comparison and manual records keyed
  //             `channel|classKey`; `frozen` the axis domains; with lock on, `resume` = the colour policies)
  //   commits   [{workspace, record}] for `store.commit` (implicit Explore/Auto records, origin "restored": the
  //             legend says "restored, not refitted" and Fit replaces them)
  //   frozen    [{id, domain, through}] for `axes.freeze`
  //   lens      the Local-contrast record or null
  //   dropped   [{chan, reason}]: everything that could not be placed (an unknown channel, a record whose
  //             descriptor fails E.scale.validate, a replay record on a page with no replay, a record beyond the
  //             16-descriptor limit). Nothing is refitted to fill a gap: a restored lock with no held mapping for
  //             the active class simply shows "Not held by Comparison lock" (resolve's `fallback`).
  function polRestore(obj) {
    const src = polIsObject(obj) ? obj : {};
    const scale = polSanitize(polIsObject(src.scale) ? src.scale : {});
    const commits = [];
    const frozenList = [];
    const dropped = [];
    const held = {};
    const frozen = {};
    let lens = null;
    const records = Array.isArray(src.records) ? src.records : [];
    let count = 0;
    const drop = (chan, reason) => dropped.push({ chan: String(chan), reason });
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const chanRaw = polIsObject(rec) ? (rec.chan !== undefined ? rec.chan : rec.channel) : undefined;
      if (!polIsObject(rec) || typeof chanRaw !== "string") {
        drop(chanRaw === undefined ? "#" + i : chanRaw, "a record needs a channel");
        continue;
      }
      if (count >= LIMITS.DESCRIPTORS_MAX) {
        drop(chanRaw, "more than " + LIMITS.DESCRIPTORS_MAX + " active scales");
        continue;
      }
      const v = API.scale.validate(rec.desc, { requireId: true });
      if (!v.ok) {
        drop(chanRaw, "descriptor: " + v.reason);
        continue;
      }
      const policy = polPolicyWords[rec.policy];
      if (policy === undefined) {
        drop(chanRaw, "unknown policy");
        continue;
      }
      count++;
      if (chanRaw.indexOf("a.") === 0) {
        const id = chanRaw.slice(2);
        const p = rec.desc.params;
        const domain = rec.desc.kind === "zero-only" ? [0, 0] : rec.desc.kind === "axis-linear" ? [p.lo, p.hi] : null;
        if (domain === null) {
          drop(chanRaw, "an axis record carries an axis domain");
          continue;
        }
        frozen[id] = { lo: domain[0], hi: domain[1] };
        frozenList.push({ id, domain, through: polNumber(rec.through) ? rec.through : null });
        continue;
      }
      const letter = chanRaw === "c" || chanRaw === "cells" ? "c" : chanRaw === "r" || chanRaw === "rows" ? "r" : chanRaw === "l" || chanRaw === "lens" ? "l" : null;
      if (letter === null) {
        drop(chanRaw, "unknown channel");
        continue;
      }
      if (!polIsObject(rec.ctx) || !polNumber(rec.obsEndMs)) {
        drop(chanRaw, "a record needs its context and obsEndMs");
        continue;
      }
      let key;
      try {
        key = API.context.keyString(rec.ctx);
      } catch (error) {
        drop(chanRaw, "the context is malformed");
        continue;
      }
      const workspace = rec.ctx.workspace === "replay" ? "replay" : "live";
      if (workspace === "replay" && src.replay !== true) {
        drop(chanRaw, "a replay record on a page with no replay");
        continue;
      }
      const origin = polOriginWords.indexOf(rec.origin) >= 0 ? rec.origin : "restored";
      const record = {
        v: 1,
        key,
        ctx: rec.ctx,
        desc: rec.desc,
        policy,
        origin: policy === "explore" || policy === "auto" ? "restored" : origin,
        workspace,
        cohort: polIsObject(rec.cohort) ? rec.cohort : { kind: letter === "c" ? "cells" : letter === "r" ? "rows" : "lens", n: 0, zeros: 0, nonzero: 0 },
        obsEndMs: rec.obsEndMs,
      };
      if (polNumber(rec.cutMs)) record.cutMs = rec.cutMs;
      if (typeof rec.token === "string") record.token = rec.token;
      if (letter === "l") {
        lens = Object.freeze(record);
      } else if (policy === "comparison" || rec.origin === "manual" || rec.origin === "external") {
        record.policy = "comparison";
        held[letter + "|" + polClassOf(record)] = Object.freeze(record);
      } else {
        commits.push({ workspace, record: Object.freeze(record) });
      }
    }
    const axes = Array.isArray(src.axes) ? src.axes : [];
    for (let i = 0; i < axes.length; i++) {
      const a = axes[i];
      if (!polIsObject(a) || typeof a.id !== "string" || !Array.isArray(a.domain) || !polNumber(a.domain[0]) || !polNumber(a.domain[1]) || a.domain[0] > a.domain[1]) {
        drop(polIsObject(a) && typeof a.id === "string" ? "a." + a.id : "axes[" + i + "]", "an axis record is {id, domain:[lo, hi]}");
        continue;
      }
      if (count >= LIMITS.DESCRIPTORS_MAX) {
        drop("a." + a.id, "more than " + LIMITS.DESCRIPTORS_MAX + " active scales");
        continue;
      }
      count++;
      frozen[a.id] = { lo: a.domain[0], hi: a.domain[1] };
      frozenList.push({ id: a.id, domain: [a.domain[0], a.domain[1]], through: polNumber(a.through) ? a.through : null });
    }
    scale.held = held;
    scale.frozen = frozen;
    return { scale, commits, frozen: frozenList, lens, dropped };
  }

  API.policy = Object.freeze({
    DEFAULTS: polDefaults,
    effective: polEffective,
    reduce: polReduce,
    resolve: polResolve,
    offers: polOffers,
    persisted: polPersisted,
    restore: polRestore,
    sanitize: polSanitize,
  });
