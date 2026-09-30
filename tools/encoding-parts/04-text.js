  // @part 04-text
  // @requires
  // @prefix txt
  // @provides text
  // == §04 text: every S1 user-visible string (INTEGRATION.md D.11, DD-32, DD-63) ==
  // One frozen nested table, `E.text.<group>.<name>`, and two substitution functions. The English lives
  // here and nowhere else, so that a wording change is one edit, a test can list every string, and a
  // formatter or a locale can never change what a canonical value means (S1-011): numbers inside a
  // string are formatted by the CALLER and passed as parameters; this part never sees a canonical value.
  // The key names are those of D.11 verbatim (`E.text.exposure.short`, not `shortExposure`); there is no
  // flat alias. A string another part needs and D.11 does not list is requested from this part's owner
  // (WORKPLAN.md section 7), never invented in the caller.
  // Non-ASCII characters (the typographic minus, the infinity sign) are allowed in this file's strings
  // only; the build test compares bytes between this file and the page.
  //
  // The placeholders (`{name}`) and what each stands for. tests/unit/text.test.js asserts that the
  // placeholders used below and this list are the same set, so a new placeholder is documented here first.
  //   {n} {total}   counts (bars beyond the held domain; a resolution level n)
  //   {m}           the row level of a context (the second half of "n={n}, m={m}")
  //   {n2} {m2}     the levels the current window shows, beside {n} {m} of a link
  //   {causes}      the cause words of a scale change, joined by the caller (note.cause.*)
  //   {support}     what a calibration was fitted on ("visible cells", "selection", ...)
  //   {excluded}    the count of observations left out of a calibration
  //   {marks} {area} {share}   formatted shares of occupied marks, of screen area, of nonzero marks
  //   {t} {w}       formatted shares of the time span and of the price span (short exposure)
  //   {seconds}     a formatted duration (unattributed covered time)
  //   {value}       a formatted measured value (typed.finite); the caller's formatter decides the digits
  //   {denominator} the name of the quantity that is 0 (typed.undefined, typed.empty-population)
  //   {reason}      the reason a typed result carries, or the reason an import was refused
  //   {setting} {old} {new}   one legacy setting and its old and new meaning (notice.legacyDetail)
  //   {level}       the address-degrade level text (address.level.*)
  //   {ap} {current}  the appearance id of a link and of this page (notice.appearanceMismatch)
  //   {id}          the appearance id (ui.appearance)
  //   {max}         a limit (the active-scale limit of notice.limit)
  //   {measure}     the name of a measure (ui.notOffered)
  // DR-31: D.11 also listed `notice.namedViewsLimit` ("This browser keeps {max} named views..."). The
  // named-view cap is void, so that string does not exist; a storage failure has notice.storageFailed.

  // Substitution: `{name}` where name is an identifier. One pass over the template, so a value that
  // itself contains "{x}" is never expanded again, and `$` in a value means nothing (the replacer is a
  // function). A name the caller did not give (absent, undefined or null) is "missing"; an extra name is
  // ignored. The names of missing parameters are appended to `missing`.
  const txtPattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  const txtWarnMax = 64;
  const txtWarned = new Set();

  function txtSubstitute(template, params, missing) {
    const have = params !== null && typeof params === "object" ? params : null;
    return template.replace(txtPattern, (whole, name) => {
      const v = have !== null && Object.prototype.hasOwnProperty.call(have, name) ? have[name] : undefined;
      if (v === undefined || v === null) {
        missing.push(name);
        return whole;
      }
      return typeof v === "string" ? v : String(v);
    });
  }

  // The warning of E.text.fill (DD-91): once per (template, name), through `console` when the host has one
  // (a bare vm context has none), and never more than txtWarnMax entries, so a bug that repeats at 60 Hz
  // costs one line and a bounded set. This set is the only mutable module state in the file (DD-02 says
  // none): it is diagnostic, it never changes a returned string, and it is capped.
  function txtWarn(template, names) {
    if (typeof console === "undefined" || console === null || typeof console.warn !== "function") return;
    for (const name of names) {
      const key = name + "|" + template;
      if (txtWarned.size >= txtWarnMax || txtWarned.has(key)) continue;
      txtWarned.add(key);
      console.warn("E.text.fill: no value for {" + name + "} in " + JSON.stringify(template));
    }
  }

  // E.text.fill (API.md A.3, DD-91): the production substitution. It NEVER throws: the page must not lose
  // a tooltip because a caller forgot a parameter. A missing name leaves its `{name}` visible in the text
  // and warns once; a template that is not a string answers "" (a caller bug, not a reason to fail a
  // draw); a value that cannot be turned into text (an object without toString) leaves the template as it
  // was.
  function txtFill(template, params) {
    try {
      if (typeof template !== "string") return "";
      const missing = [];
      const out = txtSubstitute(template, params, missing);
      if (missing.length > 0) txtWarn(template, missing);
      return out;
    } catch (error) {
      return typeof template === "string" ? template : "";
    }
  }

  // E.text.fillStrict (API.md A.3, DD-91): the same substitution for tests and for code that must know:
  // it throws a RangeError naming every missing `{name}`, and a TypeError for a template that is not a
  // string. Extra names are ignored, as in fill.
  function txtFillStrict(template, params) {
    if (typeof template !== "string") throw new TypeError("E.text.fillStrict needs a template string");
    const missing = [];
    const out = txtSubstitute(template, params, missing);
    if (missing.length > 0) throw new RangeError("E.text.fillStrict: no value for {" + missing.join("}, {") + "} in " + JSON.stringify(template));
    return out;
  }

  // Frozen all the way down: a caller cannot reword a string for everyone else (DD-02).
  function txtFreeze(node) {
    for (const key of Object.keys(node)) if (typeof node[key] === "object" && node[key] !== null) txtFreeze(node[key]);
    return Object.freeze(node);
  }

  // The string table. Group order and key order follow the rows of D.11. A group is one screen of the UI
  // or one family of state; `typed` has one entry per B.1 tag, named exactly as the tag (DR-35), each a
  // template string (E.result.describe also accepts {short, long}).
  const txtTable = txtFreeze({
    policy: {
      explore: "Explore",
      comparison: "Comparison lock",
      auto: "Auto color",
      local: "Local contrast",
      fixed: "Fixed scale",
      manual: "Manual domain",
      axisAuto: "Auto axis",
      axisFrozen: "Frozen",
    },
    axis: {
      none: "No data",
      zero: "0",
      updating: "Updating",
      paused: "Auto paused",
      waiting: "Waiting for data",
      frozenBy: "Frozen by Comparison lock",
      clipped: "{n} of {total} bars extend beyond the held domain",
    },
    state: {
      noCalibration: "No calibration",
      updating: "Updating",
      pending: "Reading",
      external: "External comparison override",
      externalAfterEdge: "External comparison override: uses observations after the replay edge",
      autoPausedLock: "Auto paused: comparison lock",
      autoPaused: "Auto paused",
      restored: "Restored, not refitted",
      notHeld: "Not held by Comparison lock",
      localPending: "Local contrast pending",
      zeroOnly: "Zero-only calibration: later nonzero values are out of domain until fitted",
      manualRoute: "Set a manual domain or choose Fit",
    },
    note: {
      scaleChanged: "Scale changed: {causes}",
      cause: {
        resolution: "resolution",
        period: "period",
        measure: "measure",
        basis: "basis",
        transform: "transform",
        quality: "quality",
        lock: "lock",
        pin: "pin",
        policy: "policy",
        fit: "fit",
        workspace: "workspace",
      },
      evicted: "Scale re-initialised after eviction (this browser keeps the 64 most recent contexts)",
      calibratedOn: "Calibrated on the {support} ({n} observations, {excluded} excluded)",
      windowNotApplied: "Window not applied to this measure",
    },
    warn: {
      rangeExceeded: "Scale range exceeded",
      lowDisc: "Low discrimination",
      rangeDetail: "{marks} of occupied marks and {area} of occupied screen area are outside the scale",
      lowDiscLow: "{share} of nonzero marks use the lowest 5% of the scale",
      lowDiscHigh: "{share} of nonzero marks use the highest 5% of the scale",
      action: {
        fit: "Fit",
        auto: "Auto color",
        local: "Local contrast",
        openLens: "Open lens",
      },
    },
    reject: {
      windowSymmetric: "The window must be symmetric about 50% for taker shares",
      windowRange: "The window must satisfy 0 <= low < high <= 1",
      curveRank: "Linear is offered only for Value",
      manual: "A manual domain needs finite positive U and k with k <= U",
    },
    label: {
      coverage: "Coverage",
      unattributed: "Unattributed",
    },
    exposure: {
      short: "Short exposure",
      detail: "{t} of the time span, {w} of the price span",
    },
    model: {
      retrospective: "Retrospective model: estimated on later data than this cutoff (external reference)",
      timingUnverified: "Model timing unverified: estimated on 2026-09-24 data",
      eligibleByBound: "Model estimated before this cutoff by the conservative bound 2026-09-25 00:00 UTC (exact time unknown)",
      extrapolated: "Model extrapolated beyond fitted levels",
      exactUnknown: "Exact fit time and method version are unknown",
      applicability: "Range-derived model applied to touched rows; not proven neutral at every level",
      diagonalUse: "The diagonal chooser uses the same fitted model (ISO_A -1.06, n = 6 to 13)",
    },
    vintage: "Replay on currently available history; original vintages not guaranteed",
    revision: {
      replaced: "Provisional minutes up to {t} were replaced by the archived day",
      unknown: "Data was refreshed; revision status unknown",
    },
    dwell: {
      coverage: "Covered to the end of the data; interior gaps are unobservable",
      residual: "Unattributed covered time: {seconds}",
      notMeasurable: "Not measurable: rectangle rows only",
    },
    rank: {
      approx: "Relative rank: 257-knot Type-7 quantile approximation, not an exact empirical midrank",
    },
    lock: {
      incompatible: {
        family: "different formula family",
        basis: "amount and intensity are different bases",
        signed: "signed and unsigned measures differ",
        transform: "different transform",
        rankAlgo: "different rank algorithm",
        version: "different formula version",
      },
    },
    key: {
      zero: "Zero (occupied)",
      "undefined": "Not defined",
      noRef: "No reference volume",
      negInf: "No current volume (−∞)",
      below: "Below range",
      above: "Above range",
      pending: "Reading",
      failed: "Failed",
      unsupported: "Unsupported",
      invalid: "Invalid input",
      outline: "Occupied",
      noCalibration: "No calibration",
      emptyBoth: "Empty in both",
      outside: "Outside comparison support",
    },
    typed: {
      finite: "{value}",
      "negative-infinite": "No current volume in the rectangle; the period traded here (−∞ on the log scale)",
      "no-reference": "No reference volume: the period did not trade here",
      "empty-both": "Neither traded here",
      "empty-population": "Undefined: {denominator} is 0",
      "undefined": "Undefined: {denominator} is 0",
      "no-coarser-parent": "Undefined: no coarser parent",
      "waiting-for-complete-parent": "Waiting for the complete parent (open)",
      "outside-support": "Outside comparison support",
      hidden: "Hidden in replay",
      pending: "Reading: {reason}",
      failed: "Read failed: {reason}",
      unsupported: "Not supported here: {reason}",
      "invalid-input": "Invalid input: {reason}",
    },
    basis: {
      amount: "Amount",
      intensity: "Intensity",
      mean: "Mean",
      spans: "Path / price span",
      usdt: "USDT moved",
      perMinute: "Row spans per minute",
    },
    unit: {
      usdt: "USDT",
      trades: "trades",
      usdtPerTrade: "USDT per trade",
      rowSpans: "row spans",
      rowSpansPerMinute: "row spans per minute",
      share: "share",
      log2: "log2 ratio",
      seconds: "seconds",
      intensity: "per minute per 125-USDT price band",
    },
    transform: {
      value: "Value",
      valueLog: "Value (log)",
      valueLinear: "Value (linear)",
      rank: "Relative rank",
      fixed: "Fixed scale",
    },
    address: {
      level: {
        exact: "Address: exact",
        ids: "Address: scale IDs only, not exact",
        settings: "Settings-only URL, not exact calibration",
        refused: "The address is too long to write; copy the full view code",
      },
    },
    notice: {
      legacy: "Opened a view saved before visual version 2. Its settings were kept; colours and scales now use version 2.",
      legacyDetail: "{setting}: was {old}; now {new}",
      legacyUnsaved: "Colours from the old version cannot be recovered.",
      versionDefault: "This version measures and colours differently (visual version 2). The default view is shown.",
      addressDegraded: "The address was shortened: {level}. Copy the full view code to keep the exact scales.",
      storageFailed: "This browser could not save the view. The explorer keeps working; changes will not persist.",
      historyFailed: "This browser could not update the history entry. The view is unchanged.",
      importRejected: "The view code was not applied: {reason}",
      importPartial: "The view code was applied without its scale: {reason}",
      scaleDropped: "The scale in this link could not be used; a fresh Explore scale is in use",
      scaleContextDiffers: "The scale in this link was fitted at n={n}, m={m}; this window shows n={n2}, m={m2}, so a fresh scale is in use",
      appearanceMismatch: "This link was made with appearance {ap}; this page uses {current}. Mapping ids still match.",
      clipboard: "The clipboard was not available. The text is selected for copying.",
      limit: "The view has more than {max} active scales. Release one before adding another.",
      codeNotStored: "The full view code was not stored with this view; copy it separately to keep the exact scales.",
      scaleFault: "The scale display hit an error and was turned off for this session; the chart shows occupancy only. Reload the page.",
      moduleMissing: "The explorer's measurement module did not load. Reload the page.",
    },
    ui: {
      scale: "Scale",
      basis: "Basis",
      transform: "Transform",
      policy: "Scale policy",
      fit: "Fit scale",
      lock: "Comparison lock",
      unlock: "Release comparison lock",
      local: "Local contrast",
      manual: "Manual domain",
      clearManual: "Clear manual domain",
      details: "Scale details",
      dismiss: "Dismiss",
      copyCode: "Copy view code",
      apply: "Apply",
      notOffered: "Not offered for {measure}",
      appearance: "Appearance {id} (provisional, not human-validated)",
    },
    migrate: {
      volume: "was the full-cell rate ranked over the drawn block; now observed Amount on a Value scale, Explore per resolution context",
      trades: "same as Volume; Trade size is Value with a cell of no trades undefined",
      size: "same as Volume; Trade size is Value with a cell of no trades undefined",
      flow: "was full at 25% and 75%, paler where less traded; now linear 0-100% with 50% at the midpoint and no activity multiplier",
      delta: "was log1p of the absolute Delta over the block's 99.5th percentile with zero drawn as the surface; now signed Value on one pooled (U, k) with zero at the midpoint colour",
      cascade: "was paler by activity; now the same log2 formula without an activity term",
      path: "was path over cell height times full-cell-time extrapolation, ranked; now path over the measured price span in row spans, Value, Explore",
      dwell: "was ranked share of column time; now a linear 0-100% share of covered column time",
      geometry: "was a green outline at low opacity; now a neutral occupancy outline",
      rows: "was the square root of the share of the peak among rows in view; now Value over all measured rows of the period, Explore",
      relvol: "was rectangle share over whole-period share with -2 for no current volume; now version 2 on matched support with a tagged −∞",
      pane: "was scaled to the bars in view at every draw; now a registered Auto axis",
      efficiency: "was compared with \"0.70 expected\"; now with the recorded model reference and its provenance",
    },
  });

  API.text = Object.freeze({
    ...txtTable,
    fill: txtFill,
    fillStrict: txtFillStrict,
  });
