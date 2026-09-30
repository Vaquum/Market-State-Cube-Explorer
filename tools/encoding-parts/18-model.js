  // @part 18-model
  // @requires
  // @prefix mdl
  // @provides model
  // == §18 model: provenance, timing status and applicability of the empirical model (API.md B.13, C.14) ==
  // The page draws two things from one fitted model: the diagonal chooser (m = round(ISO_A + ISO_B n)) and
  // the Efficiency baseline (2 ** (ISO_B - 1)). D5 asks that its provenance be explicit, and that what is
  // NOT known stay unknown: the exact fit time, its precision, the method version and the last training
  // observation are recorded as null, never guessed. The one date the record does carry, 2026-09-25 00:00
  // UTC, is a conservative UPPER BOUND on when the fit could have been made (the extraction happened on
  // 2026-09-24 and the code was committed after it); it is never worded as a training or estimation time.
  // This part reads no clock and no string table at load: the caller passes the effective cutoff, and the
  // words come from E.text (part 04) at call time, so the part loads and its numbers test without part 04.

  const mdlIsoA = -1.06;
  const mdlIsoB = 0.486;
  // The fitted levels (n = 6..13 on the 2026-09-24 extraction): the range inside which the model was
  // measured. Outside it the model is an extrapolation, and equality with it is still drawn (S1-148).
  const mdlNMin = 6;
  const mdlNMax = 13;
  // Date.UTC(2026, 8, 24) and Date.UTC(2026, 8, 25) as literals (2026-09-24T00:00Z and 2026-09-25T00:00Z):
  // the constants of a frozen table, so this part never constructs a Date (purity rule). The unit test
  // recomputes both with Date.UTC as an independent oracle.
  const mdlExtractionMs = 1790208000000;
  const mdlBoundMs = 1790294400000;

  // Every nested object is frozen, so a consumer that holds the record (the portable payload, the drawer)
  // cannot change the model the page draws with.
  function mdlDeepFreeze(x) {
    if (x !== null && typeof x === "object") {
      const keys = Object.keys(x);
      for (let i = 0; i < keys.length; i++) mdlDeepFreeze(x[keys[i]]);
      Object.freeze(x);
    }
    return x;
  }

  // E.model.PROVENANCE (API.md B.13, DR-13; "MODEL_PROVENANCE" in DR-13 is this record's concept name,
  // DD-54). `baseline` is computed with the page's own expression, 2 ** (ISO_B - 1) (0.7002781604436024),
  // not typed as a literal, so it cannot drift from ISO_B.
  const mdlProvenance = mdlDeepFreeze({
    id: "efficiency-diagonal@1",
    formula: "log2((Echild/Eparent)/2**(ISO_B-1))",
    ISO_A: mdlIsoA,
    ISO_B: mdlIsoB,
    baseline: 2 ** (mdlIsoB - 1),
    fit: {
      method: "least squares of log2(median column price range / 125) against n",
      exponentText: "0.49",
      nMin: mdlNMin,
      nMax: mdlNMax,
      historyStart: "2021-01-01T00:00:00Z",
      extraction: "2026-09-24",
    },
    estimatedAt: null,
    precision: null,
    methodVersion: null,
    latestTrainingObservation: null,
    eligibilityUpperBound: "2026-09-25T00:00:00Z",
    appliesTo: ["efficiency", "diagonal"],
    applicability: "range-derived model applied to touched rows; not proven neutral at every level",
  });

  // A word from part 04, looked up when it is needed. A missing string is a wiring error and says so by
  // name; returning an empty label would silently drop the "retrospective" disclosure (S1-147).
  function mdlWord(group, key) {
    const text = API.text;
    const table = text === undefined || text === null ? undefined : group === null ? text : text[group];
    const word = table === undefined || table === null ? undefined : table[key];
    if (typeof word !== "string") throw new Error("E.model needs part 04-text (E.text" + (group === null ? "" : "." + group) + "." + key + ")");
    return word;
  }

  function mdlNumber(x, what) {
    if (typeof x !== "number" || !Number.isFinite(x)) throw new TypeError("E.model: " + what + " must be a finite number");
    return x;
  }

  // E.model.status (API.md C.14, DD-35): three states on the effective UTC cutoff in milliseconds, in ALL
  // modes (the spec speaks of replay only; live has a cutoff too). Before the extraction day the model was
  // estimated on LATER data than the cutoff (`retrospective`, an external reference); during the extraction
  // day the fit time is unknown (`timing-unverified`); from the upper bound on, the model can only have
  // been fitted before the cutoff (`eligible-by-bound`). A cutoff that is not a finite number throws: NaN
  // compares false with everything and would otherwise read as eligible.
  function mdlStatus(cutMs) {
    mdlNumber(cutMs, "cutMs");
    if (cutMs < mdlExtractionMs) return "retrospective";
    if (cutMs < mdlBoundMs) return "timing-unverified";
    return "eligible-by-bound";
  }

  // The bare rule of fit(): the efficiency use compares a column (level n) with its parent (level n + 1),
  // so both must be fitted levels; the diagonal chooser reads the model at n only.
  function mdlWithin(use, n) {
    mdlNumber(n, "n");
    if (use === "efficiency") return n >= mdlNMin && n + 1 <= mdlNMax;
    if (use === "diagonal") return n >= mdlNMin && n <= mdlNMax;
    throw new RangeError("E.model: unknown use " + JSON.stringify(use) + " (efficiency or diagonal)");
  }

  // E.model.fit (API.md C.14, S1-148): {within, label}. `label` is E.text.model.extrapolated when the
  // model is applied outside its fitted levels and null when inside. The value is still computed and
  // drawn either way; the label only discloses it.
  function mdlFit(use, n) {
    const within = mdlWithin(use, n);
    return { within, label: within ? null : mdlWord("model", "extrapolated") };
  }

  // E.model.describe (API.md C.14, B.13): the ModelNote a pane label, tooltip, drawer or portable payload
  // shows. It is a record of its own, apart from the observation and scale provenance (S1-150), and the
  // status comes from the effective cutoff alone, so an eligible SCALE never makes a later-fitted MODEL
  // look eligible (S1-151). `labels` holds the disclosure strings that apply, timing first: eligible-by-
  // bound needs no timing disclosure in the label list (its status is the record's `status`). `note`
  // is the standing sentence that a vintage is not recoverable (E.text.vintage).
  function mdlDescribe(use, cutMs, n) {
    const status = mdlStatus(cutMs);
    const fit = mdlFit(use, n);
    const labels = [];
    if (status === "retrospective") labels.push(mdlWord("model", "retrospective"));
    else if (status === "timing-unverified") labels.push(mdlWord("model", "timingUnverified"));
    if (fit.label !== null) labels.push(fit.label);
    return { status, within: fit.within, labels, provenance: mdlProvenance, note: mdlWord(null, "vintage") };
  }

  API.model = Object.freeze({
    PROVENANCE: mdlProvenance,
    status: mdlStatus,
    fit: mdlFit,
    describe: mdlDescribe,
  });
