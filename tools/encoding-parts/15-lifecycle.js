  // @part 15-lifecycle
  // @requires
  // @prefix lif
  // @provides lifecycle
  // == §15 lifecycle: coherence, settling, the fit cadence and the memo key (API.md C.10, DR-16, DR-17, S1-115..117) ==
  // When may a calibration be fitted from the data on screen, and how often? D4 answers in four pieces, all pure
  // here so a test supplies numbers instead of events:
  //   coherent   every read the consumer needs has answered, at ONE accepted generation, with the coverage the
  //              view declares (a partial arrival or a failure never becomes a "complete" cohort);
  //   settled    200 ms without an active gesture (a separate predicate from the page's `gesturing()`, which
  //              also gates continuations and the cutoff follower: DR-17);
  //   cadence    Auto colour refits the settled measurement at most once per 500 ms per channel, the leading
  //              edge immediately after an idle spell; an explicit Fit and the first (Explore) initialisation
  //              are not data-driven and have no cap;
  //   memo key   generation + measurement bounds + effective resolution + configuration + cohort identity
  //              (+ the cutoff when the rectangle reaches the open column), so same-pack navigation gets a new
  //              key and an unchanged view hits the memo.
  // The page owns the timer (INTEGRATION D.2 `scaleArm`/`scaleTick`); this part only says what is due and
  // how long to wait. It reads no clock: `now`, the last gesture stamp and the held holds are arguments.

  // The reasons `coherent` can give, each named: the page shows them in the details and tests assert them.
  // Order is the order they are evaluated in.
  const lifReasons = Object.freeze({
    notReady: "not-ready",
    viewRead: "view-read-pending",
    loading: "readiness-loading",
    unavailable: "readiness-unavailable",
    coverage: "coverage",
    measState: "measurement-state",
    measUpdating: "measurement-updating",
    motionSource: "motion-source",
    motionState: "motion-state",
    motionUpdating: "motion-updating",
    rowsState: "rows-state",
    rowsStale: "rows-stale",
    rowsSpan: "rows-span",
    barsPending: "bars-pending",
    barsState: "bars-state",
    snapshot: "snapshot-changed",
  });
  // A measurement answers a cell from these states (C.10): its own rectangle exact, a recorded block, or the cube.
  const lifMeasOk = Object.freeze(["exact", "recorded", "cube"]);
  const lifMotionOk = Object.freeze(["exact", "cube"]);

  function lifIsObject(x) {
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  // E.lifecycle.coherent (API.md A.3, C.10, DD-79, DD-80): is the data behind a consumer complete and at one
  // accepted generation? `input` is assembled by the page from variables it already has; a part that is absent
  // (undefined or null) is a consumer that does not need it, so a Cells consumer passes `meas` only and a
  // Rows consumer `rows` only.
  //   ready            the page finished loading
  //   viewReadPending  a view read is outstanding (a FAILED read is not: it resolves to its typed result)
  //   readiness        "ready" | "loading" | "unavailable" | ...: what the source tier says. Loading is not
  //                    coherent. "unavailable" (terminal) is coherent ONLY when the coverage holds: the fit
  //                    then belongs to the labelled coarser context; a terminal failure never authorises a
  //                    partial cohort
  //   coverage         {ok} or a boolean: the displayed block covers the declared view (`s0 <= a && s1 >= e`)
  //   meas             {state, updating}: the measurement; state must be exact, recorded or cube
  //   motion           {src, state, updating}: motion consumers: a source exists, its rectangle is exact or cube
  //   rows             {state, stale, span1, expectedEnd}: state "ready", not stale, span end equals the expected
  //   bars             {pending, state}: no pending bar-chunk read, series state "ready"
  //   snapshot/current the accepted state {generation, token, cut, canon} read at input time and the one now:
  //                    equal (token is compared for equality only; it is provenance, never a key element)
  // -> {ok, reasons[]} with the named reasons above, in evaluation order.
  function lifCoherent(input) {
    if (!lifIsObject(input)) throw new TypeError("coherent needs an input object");
    const reasons = [];
    if (input.ready === false) reasons.push(lifReasons.notReady);
    if (input.viewReadPending) reasons.push(lifReasons.viewRead);
    if (input.readiness === "loading") reasons.push(lifReasons.loading);
    const coverageOk = input.coverage === undefined || input.coverage === null ? true : lifIsObject(input.coverage) ? Boolean(input.coverage.ok) : Boolean(input.coverage);
    if (input.readiness === "unavailable" && !coverageOk) reasons.push(lifReasons.unavailable);
    if (!coverageOk) reasons.push(lifReasons.coverage);
    const meas = input.meas;
    if (meas !== undefined && meas !== null) {
      if (lifMeasOk.indexOf(meas.state) < 0) reasons.push(lifReasons.measState);
      if (meas.updating) reasons.push(lifReasons.measUpdating);
    }
    const motion = input.motion;
    if (motion !== undefined && motion !== null) {
      if (!motion.src) reasons.push(lifReasons.motionSource);
      else if (lifMotionOk.indexOf(motion.state) < 0) reasons.push(lifReasons.motionState);
      if (motion.updating) reasons.push(lifReasons.motionUpdating);
    }
    const rows = input.rows;
    if (rows !== undefined && rows !== null) {
      if (rows.state !== "ready") reasons.push(lifReasons.rowsState);
      if (rows.stale) reasons.push(lifReasons.rowsStale);
      if (rows.span1 !== rows.expectedEnd) reasons.push(lifReasons.rowsSpan);
    }
    const bars = input.bars;
    if (bars !== undefined && bars !== null) {
      if (bars.pending) reasons.push(lifReasons.barsPending);
      if (bars.state !== "ready") reasons.push(lifReasons.barsState);
    }
    const a = input.snapshot;
    const b = input.current;
    if (lifIsObject(a) && lifIsObject(b) && (a.generation !== b.generation || a.cut !== b.cut || a.canon !== b.canon || a.token !== b.token)) reasons.push(lifReasons.snapshot);
    return { ok: reasons.length === 0, reasons };
  }

  // E.lifecycle.memoKey (API.md A.3, C.10, S1-116): the key a fit is remembered under.
  //   [generation, edgeCut, b0, b1, b2, b3, n, m, configKey, cohortId].join("|")
  // parts = {generation, CUT, bounds:[b0,b1,b2,b3], n, m, config, cohortId} with n, m the EFFECTIVE level.
  // edgeCut is the cutoff when the rectangle reaches the open column (b1 > floor(CUT), the baseline idiom), else
  // "", so a delta that only advances the open column does not change the key of a view that cannot see it.
  // `config` is a finished string or an object {mode, basis, pathBasis, transform, policy, lock, window}
  // joined in that order (window as "lo~hi" or ""). NOT in the key, on purpose: the pack token (it changes at
  // every advance), the tile or block id (D4: a replaced exact tile is not another quality class), the theme and
  // the selection (Explore does not refit on a selection).
  function lifConfigKey(config) {
    if (typeof config === "string") return config;
    if (!lifIsObject(config)) throw new TypeError("memoKey: config is a string or {mode, basis, pathBasis, transform, policy, lock, window}");
    const w = Array.isArray(config.window) ? config.window[0] + "~" + config.window[1] : "";
    return [config.mode, config.basis, config.pathBasis, config.transform, config.policy, config.lock ? "1" : "0", w].join(",");
  }

  function lifMemoKey(parts) {
    if (!lifIsObject(parts)) throw new TypeError("memoKey needs a parts object");
    const b = parts.bounds;
    if (!Array.isArray(b) || b.length !== 4) throw new TypeError("memoKey: bounds is [b0, b1, b2, b3]");
    for (let i = 0; i < 4; i++) if (typeof b[i] !== "number" || !Number.isFinite(b[i])) throw new RangeError("memoKey: bounds must be finite numbers");
    const edge = parts.CUT !== undefined && parts.CUT !== null && b[1] > Math.floor(parts.CUT) ? String(parts.CUT) : "";
    return [parts.generation, edge, b[0], b[1], b[2], b[3], parts.n, parts.m, lifConfigKey(parts.config), parts.cohortId].join("|");
  }

  // E.lifecycle.settled (API.md A.3, C.10, DR-17): has the last gesture been quiet for settleMs?
  //   {now, lastGestureAt, held, settleMs} -> {settled, waitMs}
  // A hold still active (`held`: the NAMES of the active holds: drag, pinch, pointer, zoomKey, stepKey,
  // zoomEnd, resize) means not settled and no countdown (waitMs null: the wake is the gesture's end).
  // Otherwise waitMs = max(0, settleMs - (now - lastGestureAt)) and settled = waitMs === 0. `lastGestureAt`
  // starts at -Infinity (A-34): the first paint is not artificially "gesturing", unlike the baseline stamp
  // of 0 which made it so for 200 ms.
  function lifSettled(input) {
    if (!lifIsObject(input)) throw new TypeError("settled needs an input object");
    const settleMs = input.settleMs === undefined ? TIMING.SETTLE_MS : input.settleMs;
    if (typeof input.now !== "number" || !Number.isFinite(input.now)) throw new TypeError("settled needs a finite now (ms)");
    if (Array.isArray(input.held) ? input.held.length > 0 : Boolean(input.held)) return { settled: false, waitMs: null };
    const last = input.lastGestureAt === undefined ? -Infinity : input.lastGestureAt;
    const left = settleMs - (input.now - last);
    const waitMs = left > 0 ? left : 0;
    return { settled: waitMs === 0, waitMs };
  }

  // The answers of `due`, shared and frozen where they carry no number (exactly the fields of the cadence
  // trace in API.md A.6: a run is just {run:true}).
  const lifDueRun = Object.freeze({ run: true });
  const lifDueNone = Object.freeze({ run: false, waitMs: null });
  const lifDuePlay = Object.freeze({ run: false, waitMs: null, reason: "play" });
  const lifDueGestureHeld = Object.freeze({ run: false, waitMs: null, reason: "gesture" });
  // Which want survives when two meet on one channel: an explicit Fit is never displaced by a background
  // request (it is the person's act); init and auto replace each other (a different policy, a different want).
  const lifKinds = Object.freeze(["init", "auto", "fit"]);

  // E.lifecycle.controller (API.md A.3, C.10, DD-21, DD-46, DD-81): the per-channel wants and the auto cadence.
  // `{settleMs?, autoMs?}` default to TIMING.SETTLE_MS and TIMING.AUTO_MS. Time and gesture state arrive with
  // every call; the controller keeps only the wants and the last Auto run per channel.
  //   request(channel, kind, key) -> boolean   one pending want per channel; `kind` is "init" (first
  //        calibration of a context), "auto" (refit) or "fit" (explicit). Returns true when this call created
  //        or changed the want (the caller then arms its timer) and false when the same want was already
  //        pending or a pending explicit Fit was kept.
  //   due(channel, env) -> {run, waitMs?, reason?}    env = {now, lastGestureAt?, held?, playing?, coherent:{ok},
  //        poll?}; see A.6 (first matching row):
  //          no want                      {run:false, waitMs:null}
  //          not coherent                 {run:false, waitMs:RETRY_MS, reason:"read"}   (waitMs null when env.poll
  //                                        is false: a hidden tab or no view read outstanding, DD-79)
  //          not settled                  {run:false, waitMs:remaining | null while held, reason:"gesture"}
  //          init | fit                   {run:true}     (an explicit Fit bypasses the cap and Play, DR-16)
  //          auto, playing                {run:false, waitMs:null, reason:"play"}    ("Auto paused")
  //          auto, < autoMs since last    {run:false, waitMs:remaining, reason:"cap"}
  //          auto                         {run:true}     (leading edge: the first after idle is immediate)
  //   ran(channel, kind, now) -> boolean   the want of that kind is done (cleared); an Auto run also records the
  //        channel's lastAutoAt. The caller may clear an Auto want it did not run through `cancel`.
  //   cancel(channel?) -> boolean   drop one channel's want (or every want)
  //   nextWake(env) -> ms | null   the earliest waitMs among the wants (the page's ONE re-arm); never called per
  //        frame or per pointer move, because it needs coherence
  //   hasWants() -> boolean   O(1), allocation-free: any want pending (DD-81)
  //   snapshot() -> {wants:{channel:{kind,key}}, lastAutoAt:{channel:ms}}   a copy, for tests and details
  function lifController(options) {
    const opts = options !== null && typeof options === "object" ? options : {};
    const settleMs = opts.settleMs === undefined ? TIMING.SETTLE_MS : opts.settleMs;
    const autoMs = opts.autoMs === undefined ? TIMING.AUTO_MS : opts.autoMs;
    if (typeof settleMs !== "number" || !Number.isFinite(settleMs) || settleMs < 0 || typeof autoMs !== "number" || !Number.isFinite(autoMs) || autoMs < 0) throw new TypeError("E.lifecycle.controller: settleMs and autoMs are numbers of milliseconds, 0 or more");
    const wants = new Map();
    const lastAuto = new Map();

    function request(channel, kind, key) {
      if (typeof channel !== "string" || channel === "") throw new TypeError("request needs a channel name");
      if (lifKinds.indexOf(kind) < 0) throw new RangeError("request: kind is init, auto or fit");
      const k = String(key);
      const cur = wants.get(channel);
      if (cur !== undefined) {
        if (cur.kind === "fit" && kind !== "fit") return false;
        if (cur.kind === kind && cur.key === k) return false;
      }
      wants.set(channel, { kind, key: k });
      return true;
    }

    function due(channel, env) {
      const want = wants.get(channel);
      if (want === undefined) return lifDueNone;
      if (!lifIsObject(env) || typeof env.now !== "number" || !Number.isFinite(env.now)) throw new TypeError("due needs env.now (ms)");
      if (!lifIsObject(env.coherent)) throw new TypeError("due needs env.coherent ({ok}); a fit must never run on data nobody checked");
      if (!env.coherent.ok) return { run: false, waitMs: env.poll === false ? null : TIMING.RETRY_MS, reason: "read" };
      const s = lifSettled({ now: env.now, lastGestureAt: env.lastGestureAt, held: env.held, settleMs });
      if (!s.settled) return s.waitMs === null ? lifDueGestureHeld : { run: false, waitMs: s.waitMs, reason: "gesture" };
      if (want.kind !== "auto") return lifDueRun;
      if (env.playing) return lifDuePlay;
      const last = lastAuto.get(channel);
      const gap = last === undefined ? Infinity : env.now - last;
      if (gap < autoMs) return { run: false, waitMs: autoMs - gap, reason: "cap" };
      return lifDueRun;
    }

    function ran(channel, kind, now) {
      if (kind === "auto") {
        if (typeof now !== "number" || !Number.isFinite(now)) throw new TypeError("ran needs the finite time (ms) of an Auto run");
        lastAuto.set(channel, now);
      }
      const want = wants.get(channel);
      if (want !== undefined && want.kind === kind) {
        wants.delete(channel);
        return true;
      }
      return false;
    }

    function cancel(channel) {
      if (channel === undefined) {
        const any = wants.size > 0;
        wants.clear();
        return any;
      }
      return wants.delete(channel);
    }

    function nextWake(env) {
      let best = null;
      for (const channel of wants.keys()) {
        const d = due(channel, env);
        if (d.run) return 0;
        if (typeof d.waitMs === "number" && (best === null || d.waitMs < best)) best = d.waitMs;
      }
      return best;
    }

    function hasWants() {
      return wants.size > 0;
    }

    function snapshot() {
      const w = {};
      for (const [channel, want] of wants) w[channel] = { kind: want.kind, key: want.key };
      const a = {};
      for (const [channel, at] of lastAuto) a[channel] = at;
      return { wants: w, lastAutoAt: a };
    }

    return Object.freeze({ request, due, ran, cancel, nextWake, hasWants, snapshot });
  }

  API.lifecycle = Object.freeze({
    coherent: lifCoherent,
    memoKey: lifMemoKey,
    controller: lifController,
    settled: lifSettled,
  });
