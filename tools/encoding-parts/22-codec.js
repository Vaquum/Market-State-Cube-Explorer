  // @part 22-codec
  // @requires 01-util 02-hash 03-result 04-text 08-scale 10-context
  // @prefix cdc
  // @provides codec
  // == §22 codec: the address grammar, the portable view code, view validation and legacy migration (API.md A.3, B.15, C.13, DD-27..DD-29, DR-14, DR-31) ==
  // Everything that turns a view into text and text into a view lives here, pure: no storage, no clipboard,
  // no stream, no clock. Page facts (the cutoff, the lattice, which modes this page offers) arrive in an
  // `env` object of plain values and callbacks; compression arrives as injected `deflate` / `inflate`.
  //
  // The shapes this part reads and writes (the page adapters `visualState()` and `viewEnv()` build them):
  //   View     what checkView returns: {window, tA, tB, pA, pB, auto, n, m, follow, mode, pane, rows,
  //            period, level, poc, area, untested, lines, selection, anchor, replay, tab, evidenceKind,
  //            horizon, barrier, scale, appearance}. Times are base columns, prices are rows of PR USDT,
  //            `scale` holds the ten S1 settings of B.8 (raw preferences) and `appearance` is the id of the
  //            appearance the address named (or null).
  //   State    a View plus `scales` (Record[] of the active colour mappings: Explore, Auto, Local contrast
  //            and each held Comparison mapping) and `axes` ({id, domain, policy:"frozen"}[] of the frozen
  //            axis domains). `appearance` is required on write: `ap=` is always written.
  //   Record   {channel:"c"|"r"|"l"|"a.<axisId>", policy:"e"|"a"|"k"|"l"|"x", external:boolean,
  //            origin:"fit"|"manual"|"restored", desc, ctx, cohort:{n, excluded}|null, obsEndMs, cutMs,
  //            canonicalThroughMs, token}. `policy` uses the one-letter codes of the `sc` grammar
  //            (explore, auto, comparison, local, axis-frozen) because B.15's JSON example does. `desc`
  //            is an E.scale Descriptor, or null for a reference-only rank ("q~<id>", ladder level 1),
  //            which then carries `mappingId`. The channel `l` (Local contrast) is written and read as
  //            the Cells context AT THE LENS LEVEL (n, m of the lens): the lens bounds are not persisted.
  //   env      {T0, BASE, PR, CUT, windowKey(k), modes(), panes(), rowsChoices(), validPeriod(k),
  //            normalizeLines(list), N_MAX, M_MAX, INSTRUMENT, baseLength}. Every member has a default (the
  //            recorded lattice, the page's own lists), so a test or a second consumer gives only what it
  //            needs. `baseLength` is the length of origin + path + search of the page, so the 8192 budget
  //            counts the FULL URL copyLink copies (A-09).
  // Reasons are short technical diagnostics in English, returned for the caller to quote through
  // E.text.notice.* ({reason}); they are not user-interface strings and carry no formatted numbers.
  // The one bounded-inflate contract the page adapter must keep: inflate(u8, maxBytes) resolves the
  // decompressed bytes, or rejects as soon as more than maxBytes would come out (read the stream through a
  // reader with a running byte counter and call reader.cancel()); this part checks the result length again.

  // ---- constants -----------------------------------------------------------------------------------
  // The text of a code is at most ceil(1 MiB * 4/3) + 64 characters when it is compressed base64url
  // (a 1 MiB payload cannot need more), and 3 MiB when it is percent-encoded JSON (every byte three
  // characters at worst): checked BEFORE anything is decoded.
  const cdcCodePrefix = "origo-cube:";
  const cdcCodeMax = Math.ceil((LIMITS.PAYLOAD_MAX_BYTES * 4) / 3) + 64;
  const cdcTextCodeMax = LIMITS.PAYLOAD_MAX_BYTES * 3;
  const cdcArrayMax = 512;
  const cdcNumberPattern = /^-?\d+(?:\.\d+)?(?:e-?\d+)?$/;
  const cdcAppearancePattern = /^[a-z][a-z0-9]*-[0-9a-f]{8}$/;
  const cdcIdPattern = /^[A-Za-z0-9_-]{16}$/;
  const cdcAxisPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
  const cdcInstrument = "BTC/USDT";
  const cdcDangerous = Object.freeze(["__proto__", "constructor", "prototype"]);
  const cdcDayPattern = /^\d{4}-\d{2}-\d{2}$/;
  // The defaults of env. They repeat the page's own lists (WINDOWS, MODES, PANES, ROWS, LINE_KEYS) so the
  // module is usable, and testable, without a page; the page always passes its own.
  const cdcWindows = Object.freeze(["15m", "30m", "1h", "4h", "12h", "24h", "7d", "30d", "1y", "ytd", "lastyear", "all"]);
  const cdcModes = Object.freeze(["volume", "flow", "delta", "cascade", "trades", "flowtrades", "size", "path", "dwell", "geometry"]);
  const cdcPanes = Object.freeze(["cells", "volume", "delta", "trades", "size", "efficiency", "choppiness", "perpath", "rsi1d", "rsi4h", "macd1d"]);
  const cdcRowChoices = Object.freeze(["off", "volume", "delta", "relvol", "time"]);
  const cdcPeriodKeys = Object.freeze(["1d", "7d", "30d", "90d", "1y", "3y", "wk", "mo", "yr", "all"]);
  const cdcFollows = Object.freeze(["free", "refit", "coupled", "diagonal"]);
  // The navigation keys: a visual setting may never use one (place() is a regexp over them).
  const cdcNavKeys = Object.freeze(["w", "t", "p", "r", "sel", "at", "replay"]);

  // The two error kinds of the module. LimitError: a writer was asked for more than a budget allows
  // (nothing is truncated). CodeError: a portable code or payload was refused, with `reason`, a machine
  // `code` and, when known, the `version` it named.
  function cdcError(name, message, fields) {
    const error = new Error(message);
    error.name = name;
    error.reason = message;
    if (fields) for (const key of Object.keys(fields)) error[key] = fields[key];
    return error;
  }

  function cdcIsObject(x) {
    // The tag test (not a prototype check) also accepts objects made in another realm.
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function cdcIsInt(x) {
    return typeof x === "number" && Number.isInteger(x);
  }

  function cdcIsFinite(x) {
    return typeof x === "number" && Number.isFinite(x);
  }

  // The shortest round-trip decimal, without a "+" (the address alphabet has none: B.15). -0 is "0".
  function cdcNum(x) {
    if (!cdcIsFinite(x)) throw new RangeError("codec: a number in an address must be finite");
    return String(Object.is(x, -0) ? 0 : x).replace("e+", "e");
  }

  function cdcParseNum(text) {
    return typeof text === "string" && cdcNumberPattern.test(text) ? Number(text) : NaN;
  }

  // ---- env -------------------------------------------------------------------------------------------
  function cdcWindowKeyDefault(key) {
    if (key === "1") return "24h";
    if (key === "7") return "7d";
    return typeof key === "string" && cdcWindows.indexOf(key) >= 0 ? key : "";
  }

  function cdcValidPeriodDefault(key) {
    return typeof key === "string" && (cdcPeriodKeys.indexOf(key) >= 0 || cdcDayPattern.test(key));
  }

  function cdcNormalizeLinesDefault(list) {
    const out = [];
    if (Array.isArray(list)) for (const item of list) if (typeof item === "string" && item !== "" && out.indexOf(item) < 0 && out.length < 100) out.push(item);
    return out;
  }

  // A list that the page gives as a function (`modes()`) or as an array.
  function cdcListOf(given, fallback) {
    if (typeof given === "function") {
      const list = given();
      return Array.isArray(list) ? list : fallback;
    }
    return Array.isArray(given) ? given : fallback;
  }

  function cdcEnv(env) {
    const e = env !== null && typeof env === "object" ? env : {};
    const number = (x, fallback) => (cdcIsFinite(x) ? x : fallback);
    return {
      T0: number(e.T0, LATTICE.T0),
      BASE: number(e.BASE, LATTICE.BASE),
      PR: number(e.PR, LATTICE.PR),
      CUT: typeof e.CUT === "number" && !Number.isNaN(e.CUT) ? e.CUT : Infinity,
      N_MAX: number(e.N_MAX, 20),
      M_MAX: number(e.M_MAX, 9),
      INSTRUMENT: typeof e.INSTRUMENT === "string" ? e.INSTRUMENT : cdcInstrument,
      baseLength: cdcIsInt(e.baseLength) && e.baseLength > 0 ? e.baseLength : 0,
      windowKey: typeof e.windowKey === "function" ? e.windowKey : cdcWindowKeyDefault,
      validPeriod: typeof e.validPeriod === "function" ? e.validPeriod : cdcValidPeriodDefault,
      normalizeLines: typeof e.normalizeLines === "function" ? e.normalizeLines : cdcNormalizeLinesDefault,
      modes: cdcListOf(e.modes, cdcModes),
      panes: cdcListOf(e.panes, cdcPanes),
      rowsChoices: cdcListOf(e.rowsChoices, cdcRowChoices),
    };
  }

  // ---- time and price text ---------------------------------------------------------------------------
  // "2026-09-24T10:00Z": UTC ISO with seconds and milliseconds only when set, exactly what the baseline's
  // toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z") writes. Built from the calendar arithmetic of
  // E.time.utcDay so the module needs no Date (purity rule).
  function cdcIso(ms) {
    const day = API.time.utcDay(ms);
    const rem = ms - Math.floor(ms / 86400000) * 86400000;
    const two = (v) => (v < 10 ? "0" : "") + v;
    const milli = rem % 1000;
    const text = day + "T" + two(Math.floor(rem / 3600000)) + ":" + two(Math.floor(rem / 60000) % 60) + ":" + two(Math.floor(rem / 1000) % 60) + "." + (milli < 10 ? "00" : milli < 100 ? "0" : "") + milli + "Z";
    return text.replace(".000Z", "Z").replace(/:00Z$/, "Z");
  }

  function cdcStamp(base, e) {
    return cdcIso(API.time.baseToMs(base, e.T0, e.BASE));
  }

  // Price rows to USDT with two decimals and no trailing zeros, as the baseline's usd().
  function cdcUsd(rows, e) {
    return String(+(rows * e.PR).toFixed(2));
  }

  // Reading: the baseline's own expressions. Date.parse is lenient on purpose (a hand-edited address), and
  // an unreadable time is NaN, which the view check then refuses.
  function cdcTime(text, e) {
    return (Date.parse(text) / 1000 - e.T0) / e.BASE;
  }

  function cdcRows(text, e) {
    return text === "" ? NaN : Number(text) / e.PR;
  }

  function cdcPair(text, f) {
    const parts = String(text === undefined || text === null ? "" : text).split("~").map(f);
    return parts.length === 2 ? parts : [NaN, NaN];
  }

  // Structural equality that keeps NaN distinct from null: is what the address said what the page can show?
  function cdcSame(a, b) {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return a !== a && b !== b;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!cdcSame(a[i], b[i])) return false;
      return true;
    }
    return false;
  }

  function cdcPathGet(root, path) {
    const at = path.indexOf(".");
    if (at < 0) return root === undefined || root === null ? undefined : root[path];
    const head = root === undefined || root === null ? undefined : root[path.slice(0, at)];
    return head === undefined || head === null ? undefined : head[path.slice(at + 1)];
  }

  function cdcPathSet(root, path, value) {
    const at = path.indexOf(".");
    if (at < 0) {
      root[path] = value;
      return;
    }
    const key = path.slice(0, at);
    if (!cdcIsObject(root[key])) root[key] = {};
    root[key][path.slice(at + 1)] = value;
  }

  // ---- the S1 settings (B.8, B.15) --------------------------------------------------------------------
  const cdcScaleDefaults = Object.freeze({
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
  });

  function cdcDefaultScale() {
    return {
      basis: cdcScaleDefaults.basis,
      pathBasis: cdcScaleDefaults.pathBasis,
      transform: cdcScaleDefaults.transform,
      curve: cdcScaleDefaults.curve,
      rowsTransform: cdcScaleDefaults.rowsTransform,
      cells: cdcScaleDefaults.cells,
      rows: cdcScaleDefaults.rows,
      local: false,
      window: null,
      lock: false,
    };
  }

  // A manual share window [lo, hi] (DD-66). For Taker flow (flow and flowtrades) it must stay symmetric
  // about 0.5 and narrower than 0..1 so its arms and midpoint survive; for any other measure it is a valid
  // raw preference if 0 <= lo < hi <= 1 (Dwell uses it; the effective view of the page coerces it elsewhere).
  // Returns a reason or null.
  function cdcWindowProblem(win, mode) {
    if (win === null || win === undefined) return null;
    if (!Array.isArray(win) || win.length !== 2 || !cdcIsFinite(win[0]) || !cdcIsFinite(win[1])) return "a window is two finite numbers";
    if (!(win[0] >= 0 && win[1] <= 1 && win[0] < win[1])) return "a window needs 0 <= lo < hi <= 1";
    if (mode === "flow" || mode === "flowtrades") {
      if (Math.abs(win[0] + win[1] - 1) > 1e-12) return "a Taker flow window must be symmetric about 0.5";
      if (!(win[0] > 0)) return "a Taker flow window must be narrower than 0 to 1";
    }
    return null;
  }

  // One-letter enumerations of the S1 keys: value text -> setting, and back.
  function cdcLetters(name, table, fallback) {
    const inverse = {};
    for (const key of Object.keys(table)) inverse[table[key]] = key;
    return {
      read: (text) => (text === undefined ? fallback : Object.prototype.hasOwnProperty.call(inverse, text) ? inverse[text] : "?" + text),
      write: (value) => (value === fallback ? null : Object.prototype.hasOwnProperty.call(table, value) ? table[value] : null),
      ok: (value) => Object.prototype.hasOwnProperty.call(table, value) || value === fallback,
    };
  }

  // One S1 enumeration key of the address as a VISUAL_KEYS entry.
  function cdcScaleEnum(id, param, letters, fallback) {
    const field = "scale." + id;
    return {
      id: "scale." + id,
      param,
      fields: [field],
      legacy: false,
      defaults: { [field]: fallback },
      read: (text) => ({ [field]: letters.read(text) }),
      check: (raw) => {
        const value = cdcPathGet(raw, field);
        return { [field]: letters.ok(value) ? value : fallback };
      },
      write: (view) => {
        const value = cdcPathGet(view, field);
        return value === undefined ? null : letters.write(value);
      },
    };
  }

  function cdcScaleFlag(id, param) {
    const field = "scale." + id;
    return {
      id: field,
      param,
      fields: [field],
      legacy: false,
      defaults: { [field]: false },
      read: (text) => ({ [field]: text === undefined ? false : text === "1" ? true : "?" + text }),
      check: (raw) => ({ [field]: cdcPathGet(raw, field) === true }),
      write: (view) => (cdcPathGet(view, field) === true ? "1" : null),
    };
  }

  // ---- VISUAL_KEYS (DD-27) ------------------------------------------------------------------------------
  // ONE table of the visual settings of a view, replacing the ten parallel field lists of the baseline.
  // Every entry: `id`; `param` (its address key, never a navigation key); `fields` (the paths it owns in a
  // View; `scale.x` is a member of View.scale); `legacy` (true for the 14 keys that existed before S1, which
  // migrateLegacy keeps); `defaults` (path -> default value; a default is omitted on write); `read(text)` (the
  // raw typed fields of the address text, `undefined` when the key is absent); `check(raw, env)` (the validated
  // fields of a raw view, the baseline's checkView line for line); `write(view, helpers)` (the value text to
  // write, or null when the setting is at its default or cannot be written). The navigation keys
  // w t p r sel at replay stay explicit code (place()).
  const cdcKeys = [
    {
      id: "follow",
      param: "f",
      fields: ["follow"],
      legacy: true,
      defaults: { follow: "refit" },
      read: (text) => ({ follow: text || "refit" }),
      check: (raw) => ({ follow: cdcFollows.indexOf(raw.follow) >= 0 ? raw.follow : "refit" }),
      write: (view) => (view.follow !== "refit" && cdcFollows.indexOf(view.follow) >= 0 ? view.follow : null),
    },
    {
      id: "mode",
      param: "mode",
      fields: ["mode"],
      legacy: true,
      defaults: { mode: "volume" },
      read: (text) => ({ mode: text || "volume" }),
      check: (raw, env) => ({ mode: env.modes.indexOf(raw.mode) >= 0 ? raw.mode : "volume" }),
      write: (view) => (typeof view.mode === "string" && view.mode !== "volume" ? view.mode : null),
    },
    {
      id: "pane",
      param: "pane",
      fields: ["pane"],
      legacy: true,
      defaults: { pane: "cells" },
      read: (text) => ({ pane: text || "cells" }),
      check: (raw, env) => ({ pane: env.panes.indexOf(raw.pane) >= 0 ? raw.pane : "cells" }),
      write: (view) => (typeof view.pane === "string" && view.pane !== "cells" ? view.pane : null),
    },
    {
      id: "rows",
      param: "rows",
      fields: ["rows"],
      legacy: true,
      defaults: { rows: "off" },
      read: (text) => ({ rows: text || "off" }),
      check: (raw, env) => ({ rows: env.rowsChoices.indexOf(raw.rows) >= 0 ? raw.rows : "off" }),
      write: (view) => (typeof view.rows === "string" && view.rows !== "off" ? view.rows : null),
    },
    {
      id: "period",
      param: "period",
      fields: ["period"],
      legacy: true,
      defaults: { period: "90d" },
      read: (text) => ({ period: text || "90d" }),
      check: (raw, env) => ({ period: env.validPeriod(raw.period) ? raw.period : "90d" }),
      write: (view) => (typeof view.period === "string" && view.period !== "90d" ? view.period : null),
    },
    {
      id: "level",
      param: "level",
      fields: ["level"],
      legacy: true,
      defaults: { level: null },
      read: (text, env) => ({ level: text === undefined ? null : cdcRows(text, env) }),
      check: (raw) => ({ level: cdcIsFinite(raw.level) && raw.level > 0 ? raw.level : null }),
      write: (view, helpers) => (cdcIsFinite(view.level) ? cdcUsd(view.level, helpers.env) : null),
    },
    {
      id: "marks",
      param: "marks",
      fields: ["poc", "area", "untested"],
      legacy: true,
      defaults: { poc: true, area: false, untested: false },
      read: (text) => {
        const marks = String(text === undefined ? "poc" : text).split(",");
        return { poc: marks.indexOf("poc") >= 0, area: marks.indexOf("area") >= 0, untested: marks.indexOf("untested") >= 0 };
      },
      check: (raw) => ({ poc: raw.poc !== false, area: raw.area === true, untested: raw.untested === true }),
      write: (view) => {
        const marks = ["poc", "area", "untested"].filter((k) => (k === "poc" ? view.poc !== false : view[k] === true)).join(",");
        return marks === "poc" ? null : marks || "none";
      },
    },
    {
      id: "lines",
      param: "lines",
      fields: ["lines"],
      legacy: true,
      defaults: { lines: [] },
      read: (text) => ({ lines: String(text === undefined ? "" : text).split(",").filter(Boolean) }),
      check: (raw, env) => ({ lines: env.normalizeLines(raw.lines) }),
      write: (view) => (Array.isArray(view.lines) && view.lines.length ? view.lines.join(",") : null),
      // A page may drop a line it cannot offer; losing one is a drop, re-ordering is not.
      same: (raw, checked) => checked.lines.length >= raw.lines.length,
    },
    {
      id: "tab",
      param: "tab",
      fields: ["tab"],
      legacy: true,
      defaults: { tab: "context" },
      read: (text) => ({ tab: text === "continuations" ? "evidence" : "context" }),
      check: (raw) => ({ tab: raw.tab === "evidence" ? "evidence" : "context" }),
      write: (view) => (view.tab === "evidence" ? "continuations" : null),
    },
    {
      id: "evidenceKind",
      param: "outcome",
      fields: ["evidenceKind"],
      legacy: true,
      defaults: { evidenceKind: "poc" },
      read: (text) => ({ evidenceKind: text === "barrier" ? "barrier" : "poc" }),
      check: (raw) => ({ evidenceKind: raw.evidenceKind === "barrier" ? "barrier" : "poc" }),
      write: (view) => (view.evidenceKind === "barrier" ? "barrier" : null),
    },
    {
      id: "horizon",
      param: "h",
      fields: ["horizon"],
      legacy: true,
      defaults: { horizon: 1 },
      read: (text) => ({ horizon: Number(text || 1) }),
      check: (raw) => ({ horizon: [1, 2, 4, 8].indexOf(raw.horizon) >= 0 ? raw.horizon : 1 }),
      write: (view) => (view.horizon !== 1 && [2, 4, 8].indexOf(view.horizon) >= 0 ? String(view.horizon) : null),
    },
    {
      id: "barrier",
      param: "dist",
      fields: ["barrier"],
      legacy: true,
      defaults: { barrier: 1 },
      read: (text) => ({ barrier: Number(text || 1) }),
      check: (raw) => ({ barrier: [1, 2, 4].indexOf(raw.barrier) >= 0 ? raw.barrier : 1 }),
      write: (view) => (view.barrier !== 1 && [2, 4].indexOf(view.barrier) >= 0 ? String(view.barrier) : null),
    },
    cdcScaleEnum("basis", "bs", cdcLetters("basis", { intensity: "i" }, "amount"), "amount"),
    cdcScaleEnum("pathBasis", "pb", cdcLetters("pathBasis", { usdt: "u", perMinute: "m" }, "spans"), "spans"),
    cdcScaleEnum("transform", "tr", cdcLetters("transform", { rank: "r" }, "value"), "value"),
    cdcScaleEnum("curve", "cv", cdcLetters("curve", { linear: "l" }, "log"), "log"),
    cdcScaleEnum("rowsTransform", "rt", cdcLetters("rowsTransform", { rank: "r" }, "value"), "value"),
    cdcScaleEnum("cells", "cp", cdcLetters("cells", { auto: "a" }, "explore"), "explore"),
    cdcScaleEnum("rows", "rp", cdcLetters("rows", { auto: "a" }, "explore"), "explore"),
    cdcScaleFlag("local", "lc"),
    {
      id: "scale.window",
      param: "sw",
      fields: ["scale.window"],
      legacy: false,
      defaults: { "scale.window": null },
      read: (text) => {
        if (text === undefined) return { "scale.window": null };
        const pair = cdcPair(text, cdcParseNum);
        return { "scale.window": cdcIsFinite(pair[0]) && cdcIsFinite(pair[1]) ? pair : "?" + text };
      },
      check: (raw, env, out) => {
        const win = cdcPathGet(raw, "scale.window");
        return { "scale.window": Array.isArray(win) && cdcWindowProblem(win, out.mode) === null ? [win[0], win[1]] : null };
      },
      write: (view, helpers) => {
        const win = cdcPathGet(view, "scale.window");
        if (!Array.isArray(win)) return null;
        const problem = cdcWindowProblem(win, view.mode);
        if (problem) {
          helpers.drop("sw", problem);
          return null;
        }
        return cdcNum(win[0]) + "~" + cdcNum(win[1]);
      },
      why: (raw, out) => cdcWindowProblem(cdcPathGet(raw, "scale.window"), out.mode) || "not a window",
    },
    cdcScaleFlag("lock", "lk"),
  ];
  const cdcVisualKeys = Object.freeze(
    cdcKeys.map((entry) => {
      Object.freeze(entry.fields);
      Object.freeze(entry.defaults);
      return Object.freeze(entry);
    }),
  );
  // The keys that can appear in an address beyond VISUAL_KEYS: the navigation keys, the version marker,
  // the appearance and the descriptors.
  const cdcFixedKeys = Object.freeze(["vis", "ap", "sc"]);

  // ---- checkView (the baseline's validator behind an env) ---------------------------------------------
  // checkView (explorer.js 1865-1923) moved with its page inputs supplied by `env`. Returns a View whose
  // every part can be shown here, or null without a window or a rectangle. Parts that cannot be are
  // dropped: a replay after this page's cutoff, a selection outside its history. The S1 fields ride
  // through the same table: `scale` (defaults for what is absent or invalid) and `appearance`.
  function cdcCheckView(v, env) {
    if (!cdcIsObject(v)) return null;
    const ok = (...x) => x.every(Number.isFinite);
    const w = env.windowKey(v.window);
    if (!w && !(ok(v.tA, v.tB, v.pA, v.pB) && v.tB > v.tA && v.pB > v.pA && v.tA < env.CUT && v.pA >= 0)) return null;
    const sel = Array.isArray(v.selection) ? v.selection : [];
    const anchor = Number.isFinite(v.anchor) && v.anchor > 0 && v.anchor <= env.CUT ? v.anchor : null;
    const locked = v.auto === false && ok(v.n, v.m);
    const out = {
      window: w,
      tA: v.tA,
      tB: v.tB,
      pA: v.pA,
      pB: v.pB,
      auto: !locked,
      n: locked ? API.util.clamp(Math.round(v.n), 0, env.N_MAX) : null,
      m: locked ? API.util.clamp(Math.round(v.m), 0, env.M_MAX) : null,
      selection:
        sel.length === 4 && ok(...sel) && sel[0] >= 0 && sel[1] > sel[0] && sel[0] < env.CUT && sel[2] >= 0 && sel[3] > sel[2]
          ? [sel[0], Math.min(sel[1], Math.ceil(env.CUT)), sel[2], sel[3]]
          : null,
      anchor,
      replay: v.replay === true && anchor !== null,
      scale: cdcDefaultScale(),
      appearance: typeof v.appearance === "string" && cdcAppearancePattern.test(v.appearance) ? v.appearance : null,
    };
    // `window` and the window-free rectangle are both kept as given (the baseline did), each key from
    // the table is validated in table order so `sw` sees the mode.
    for (const entry of cdcVisualKeys) {
      const checked = entry.check(v, env, out);
      for (const path of Object.keys(checked)) cdcPathSet(out, path, checked[path]);
    }
    return out;
  }

  // The raw fields a stored v4/v5 view, a code or an address hands to the validator, read through the table.
  function cdcReadFields(q, env, withSettings) {
    const raw = {};
    for (const entry of cdcVisualKeys) {
      if (!entry.legacy && !withSettings) continue;
      const part = entry.read(q.get(entry.param), env);
      for (const path of Object.keys(part)) cdcPathSet(raw, path, part[path]);
    }
    return raw;
  }

  // ---- classification ---------------------------------------------------------------------------------
  function cdcHasPlace(q) {
    return Boolean((q.get("w") || "") !== "" || ((q.get("t") || "") !== "" && (q.get("p") || "") !== ""));
  }

  // classify(x) (B.15): what kind of thing is this text or stored payload?
  //   address text   vis absent + names a place -> legacy; vis=2 -> v2; vis present but not 2 -> reject
  //                  (reason names the version seen); no place -> bare
  //   code text      origo-cube:2. and origo-cube:2j. -> v2; origo-cube:%7B and origo-cube:{ and plain JSON
  //                  with a `query` or `view` -> legacy; a plain cube query -> query (not a view: no notice);
  //                  any other tag -> reject
  //   payload object visualVersion === 2 -> v2; absent and non-empty -> legacy; anything else -> reject
  //                  (the raw payload is the caller's to preserve); empty or null -> bare
  // `version` is 2 for v2, null for legacy and bare, and the version as SEEN (text or number) for a reject.
  function cdcClassify(x) {
    if (x === null || x === undefined) return { kind: "bare", version: null };
    if (typeof x === "string") return cdcClassifyText(x);
    if (Array.isArray(x)) return x.length === 0 ? { kind: "bare", version: null } : { kind: "legacy", version: null };
    if (!cdcIsObject(x)) return { kind: "reject", version: null, reason: "not a view payload" };
    if (Object.prototype.hasOwnProperty.call(x, "visualVersion")) {
      const version = x.visualVersion;
      if (version === 2) return { kind: "v2", version: 2 };
      return { kind: "reject", version, reason: "visual version " + (cdcIsFinite(version) || typeof version === "string" ? String(version) : "of another type") + " was made by a newer or unknown version" };
    }
    return Object.keys(x).length === 0 ? { kind: "bare", version: null } : { kind: "legacy", version: null };
  }

  function cdcClassifyText(text) {
    const t = text.trim();
    if (t.startsWith(cdcCodePrefix)) {
      const rest = t.slice(cdcCodePrefix.length);
      if (rest.startsWith("2.") || rest.startsWith("2j.")) return { kind: "v2", version: 2 };
      if (/^(?:%7b|\{)/i.test(rest)) return { kind: "legacy", version: null };
      const tag = /^([A-Za-z0-9]+)\./.exec(rest);
      return { kind: "reject", version: tag ? tag[1] : null, reason: tag ? "made by a newer or unknown version (" + tag[1] + ")" : "an unrecognised view code" };
    }
    if (t.startsWith("{")) {
      if (t.length > cdcTextCodeMax) return { kind: "reject", version: null, reason: "the text is too long" };
      let parsed;
      try {
        parsed = JSON.parse(t);
      } catch (error) {
        return { kind: "reject", version: null, reason: "not valid JSON" };
      }
      if (!cdcIsObject(parsed)) return { kind: "reject", version: null, reason: "not a view payload" };
      if (Object.prototype.hasOwnProperty.call(parsed, "visualVersion") || cdcIsObject(parsed.query) || cdcIsObject(parsed.view)) return cdcClassify(parsed);
      return { kind: "query", version: null };
    }
    // An address: its keys, without decoding any value (a version marker is a plain token).
    const q = new Map();
    for (const part of t.replace(/^#/, "").split("&")) {
      const i = part.indexOf("=");
      if (i > 0) q.set(part.slice(0, i), part.slice(i + 1));
    }
    if (q.has("vis")) return q.get("vis") === "2" ? { kind: "v2", version: 2 } : { kind: "reject", version: q.get("vis"), reason: "the address names visual version \"" + q.get("vis") + "\"; this page reads 2" };
    return cdcHasPlace(q) ? { kind: "legacy", version: null } : { kind: "bare", version: null };
  }

  // E.codec.digest (B.14): the first 8 bytes of SHA-256 of the text, as hex. The once-per-payload key of a
  // notice; it is an identity for de-duplication, not a security value.
  function cdcDigest(text) {
    return API.hash.hex(API.hash.sha256(API.hash.utf8(String(text))), 8);
  }

  // E.codec.descriptorCount (C.13): the active colour mappings of a state or payload: what the limit of 16
  // counts. The frozen axis domains are counted by their own limit (LIMITS.AXES_MAX).
  function cdcDescriptorCount(state) {
    return state !== null && typeof state === "object" && Array.isArray(state.scales) ? state.scales.length : 0;
  }

  // ---- descriptor records: one canonical shape, two serialisations -------------------------------------
  const cdcBasisCode = Object.freeze({ amount: "a", intensity: "i", mean: "m", spans: "s", usdt: "u", perMinute: "p", share: "h", log2: "l" });
  // What each Cells measure calls its bases, by code: the basis a code means depends on the measure.
  const cdcMeasureBases = Object.freeze({
    volume: Object.freeze({ a: "amount", i: "intensity" }),
    trades: Object.freeze({ a: "amount", i: "intensity" }),
    delta: Object.freeze({ a: "amount", i: "intensity" }),
    size: Object.freeze({ m: "mean" }),
    path: Object.freeze({ s: "spans", u: "usdt", p: "perMinute" }),
    dwell: Object.freeze({ h: "share" }),
    flow: Object.freeze({ h: "share" }),
    flowtrades: Object.freeze({ h: "share" }),
    cascade: Object.freeze({ l: "log2" }),
  });
  const cdcPolicies = Object.freeze(["e", "a", "k", "l", "x"]);
  const cdcOrigins = Object.freeze(["fit", "manual", "restored"]);
  // Channel order in an address: Cells, Rows, lens, then the axes. The record text breaks ties.
  const cdcChannelRank = Object.freeze({ c: 0, r: 1, l: 2 });

  function cdcIsAxisChannel(channel) {
    return typeof channel === "string" && channel.length <= 64 && channel.startsWith("a.") && cdcAxisPattern.test(channel.slice(2));
  }

  function cdcChannelOk(channel) {
    return channel === "c" || channel === "r" || channel === "l" || cdcIsAxisChannel(channel);
  }

  // The provenance text of a descriptor: which algorithm made it. Not hashed (DR-03); an address does not
  // carry it, so it is derived from the kind and the origin.
  function cdcAlgorithm(kind, origin) {
    if (origin === "manual") return "manual@1";
    if (kind === "rank-type7-257") return "type7-257@1";
    if (kind === "fixed-linear" || kind === "fixed-diverging") return "fixed@1";
    if (kind === "axis-linear") return "axis@1";
    return "value-fit@1";
  }

  function cdcDeepFreeze(v) {
    if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const key of Object.keys(v)) cdcDeepFreeze(v[key]);
    }
    return v;
  }

  // A descriptor from its parts, the id computed and the record frozen (as E.scale makes them).
  function cdcMakeDesc(kind, signed, params, origin) {
    const desc = { v: VERSION.mapping, id: "", kind, signed, params, clip: kind === "axis-linear" ? "axis@1" : "clamp01@1", algorithm: cdcAlgorithm(kind, origin) };
    desc.id = API.scale.id(desc);
    return cdcDeepFreeze(desc);
  }

  // The body of a record (B.15), from a descriptor. Returns null for a kind that has no address form.
  function cdcFormatBody(desc, idsOnly) {
    const p = desc.params;
    switch (desc.kind) {
      case "value-log1p":
        return (desc.signed ? "G" : "g") + cdcNum(p.U) + "," + cdcNum(p.k);
      case "value-linear":
        return (desc.signed ? "N" : "n") + cdcNum(p.U);
      case "rank-type7-257":
        return idsOnly ? "q~" + desc.id : "q" + API.hash.f64ToB64(p.knots);
      case "fixed-linear":
        return "f" + cdcNum(p.lo) + "," + cdcNum(p.hi);
      case "axis-linear":
        return "d" + cdcNum(p.lo) + "," + cdcNum(p.hi);
      case "zero-only":
        return desc.signed ? "Z" : "z";
      case "none":
        return "0";
      default:
        return null;
    }
  }

  // The descriptor a body describes, WITHOUT its id check (the caller compares the record's own id).
  // Returns {desc} or {reference: true} (a reference-only rank) or {reason}.
  function cdcParseBody(body, id, origin) {
    const letter = body.charAt(0);
    const rest = body.slice(1);
    const two = () => {
      const parts = rest.split(",");
      if (parts.length !== 2) return null;
      const a = cdcParseNum(parts[0]);
      const b = cdcParseNum(parts[1]);
      return cdcIsFinite(a) && cdcIsFinite(b) ? [a, b] : null;
    };
    const one = () => {
      const a = cdcParseNum(rest);
      return cdcIsFinite(a) ? a : null;
    };
    if (letter === "g" || letter === "G") {
      const x = two();
      return x ? { desc: { kind: "value-log1p", signed: letter === "G", params: { U: x[0], k: x[1] } } } : { reason: "a log1p body is U,k" };
    }
    if (letter === "n" || letter === "N") {
      const x = one();
      return x !== null ? { desc: { kind: "value-linear", signed: letter === "N", params: { U: x } } } : { reason: "a linear body is U" };
    }
    if (letter === "q") {
      if (rest.charAt(0) === "~") return rest.slice(1) === id ? { reference: true } : { reason: "a reference-only rank must name its own id" };
      const knots = API.hash.b64ToF64(rest, LIMITS.RANK_KNOTS);
      return knots ? { desc: { kind: "rank-type7-257", signed: false, params: { knots: Array.from(knots), q: "j/256" } } } : { reason: "the rank knots are not " + LIMITS.RANK_KNOTS + " base64url float64 values" };
    }
    if (letter === "f") {
      const x = two();
      return x ? { desc: { kind: "fixed-linear", signed: false, params: { lo: x[0], hi: x[1] } } } : { reason: "a window body is lo,hi" };
    }
    if (letter === "d") {
      const x = two();
      return x ? { desc: { kind: "axis-linear", signed: x[0] < 0, params: { lo: x[0], hi: x[1] } } } : { reason: "an axis body is lo,hi" };
    }
    if ((letter === "z" || letter === "Z" || letter === "0") && rest === "") return { desc: { kind: letter === "0" ? "none" : "zero-only", signed: letter === "Z", params: null } };
    return { reason: "unknown body" };
  }

  // The cohort segment of a record: obsEndMs,nCohort,nExcluded or "-".
  function cdcExcludedCount(excluded) {
    if (cdcIsInt(excluded)) return excluded;
    if (cdcIsObject(excluded)) {
      let sum = 0;
      for (const key of Object.keys(excluded)) if (cdcIsInt(excluded[key])) sum += excluded[key];
      return sum;
    }
    return 0;
  }

  // The context a record's descriptor implies when the address does not say: the transform of the context
  // follows the descriptor kind; a zero-only mapping does not reveal whether it was fitted as Value (log or
  // linear) or as Rank, so the settings written in the same address decide (see the report, amendment 2).
  function cdcCtxTransform(kind, fixedMeasure, settings, rankOk) {
    if (fixedMeasure) return "fixed";
    if (kind === "value-log1p") return "value-log";
    if (kind === "value-linear") return "value-linear";
    if (kind === "rank-type7-257") return "rank";
    return rankOk && settings.transform === "rank" ? "rank" : settings.curve === "linear" ? "value-linear" : "value-log";
  }

  const cdcRankMeasures = Object.freeze(["volume", "trades", "size", "path"]);
  const cdcRowsRankMeasures = Object.freeze(["volume", "time"]);
  const cdcFixedMeasures = Object.freeze(["dwell", "flow", "flowtrades", "cascade", "relvol"]);

  // "roll-90" -> "roll:90", "cal-mo-2026-09-01" -> "cal:mo:2026-09-01": the ":" of a period identity is
  // written "-" so no ":" sits inside a record field (B.15). Returns null for text that is no period.
  function cdcPeriodFromText(text) {
    let m = /^roll-([1-9]\d*)$/.exec(text);
    if (m) return "roll:" + m[1];
    m = /^cal-(wk|mo|yr)-(\d{4}-\d{2}-\d{2})$/.exec(text);
    if (m) return "cal:" + m[1] + ":" + m[2];
    m = /^(day|all)-(\d{4}-\d{2}-\d{2})$/.exec(text);
    if (m) return m[1] + ":" + m[2];
    return null;
  }

  function cdcQualityFromText(text) {
    if (text === "e") return "exact";
    if (text === "as") return "approx-start";
    const m = /^ar([1-9]\d*)$/.exec(text);
    return m ? "approx-rows:" + m[1] : null;
  }

  function cdcQualityToText(quality) {
    if (quality === "exact") return "e";
    if (quality === "approx-start") return "as";
    const m = /^approx-rows:([1-9]\d*)$/.exec(quality);
    return m ? "ar" + m[1] : null;
  }

  // The context of a record from its address segment, rebuilt through E.context so its formula, unit and
  // quality are the page's own tables and not a copy (a segment that names an impossible context throws
  // there and the record is dropped with the reason).
  function cdcParseCtx(channel, segment, kind, settings, e) {
    const parts = segment.split(".");
    if (channel === "r") {
      if (parts.length !== 5) return { reason: "a Rows context is measure.period.rowSize.quality.workspace" };
      const period = cdcPeriodFromText(parts[1]);
      const quality = cdcQualityFromText(parts[3]);
      if (period === null) return { reason: "the Rows period is not well formed" };
      if (quality === null) return { reason: "the quality is not well formed" };
      if (!/^\d{1,2}$/.test(parts[2]) || !/^[lr]$/.test(parts[4])) return { reason: "the row size or workspace is not well formed" };
      try {
        const fixed = cdcFixedMeasures.indexOf(parts[0]) >= 0;
        return {
          ctx: API.context.rowsKey({
            measure: parts[0],
            transform: cdcCtxTransform(kind, fixed, settings, cdcRowsRankMeasures.indexOf(parts[0]) >= 0),
            quality,
            period,
            rowSize: Number(parts[2]),
            workspace: parts[4] === "l" ? "live" : "replay",
            instrument: e.INSTRUMENT,
          }),
        };
      } catch (error) {
        return { reason: "the Rows context is not valid: " + error.message };
      }
    }
    if (parts.length !== 6) return { reason: "a Cells context is measure.basis.n.m.workspace.quality" };
    const bases = Object.prototype.hasOwnProperty.call(cdcMeasureBases, parts[0]) ? cdcMeasureBases[parts[0]] : null;
    if (bases === null || !Object.prototype.hasOwnProperty.call(bases, parts[1])) return { reason: "the basis code does not belong to the measure" };
    const quality = cdcQualityFromText(parts[5]);
    if (quality === null) return { reason: "the quality is not well formed" };
    if (!/^\d{1,2}$/.test(parts[2]) || !/^\d{1,2}$/.test(parts[3]) || !/^[lr]$/.test(parts[4])) return { reason: "the level or workspace is not well formed" };
    try {
      const fixed = cdcFixedMeasures.indexOf(parts[0]) >= 0;
      return {
        ctx: API.context.cellsKey({
          measure: parts[0],
          basis: bases[parts[1]],
          pathBasis: bases[parts[1]],
          transform: cdcCtxTransform(kind, fixed, settings, cdcRankMeasures.indexOf(parts[0]) >= 0),
          quality,
          n: Number(parts[2]),
          m: Number(parts[3]),
          workspace: parts[4] === "l" ? "live" : "replay",
          instrument: e.INSTRUMENT,
        }),
      };
    } catch (error) {
      return { reason: "the Cells context is not valid: " + error.message };
    }
  }

  // The address segment of a record's context, or null (with no throw) when the context has no address form.
  function cdcFormatCtx(record) {
    const ctx = record.ctx;
    if (record.channel.charAt(0) === "a") return "-";
    if (!cdcIsObject(ctx)) return null;
    const ws = ctx.workspace === "live" ? "l" : ctx.workspace === "replay" ? "r" : null;
    if (ws === null) return null;
    if (record.channel === "r") {
      const quality = cdcQualityToText(ctx.quality);
      if (ctx.consumer !== "rows" || quality === null || !cdcIsInt(ctx.rowSize) || typeof ctx.period !== "string") return null;
      return ctx.measure + "." + ctx.period.replace(/:/g, "-") + "." + ctx.rowSize + "." + quality + "." + ws;
    }
    // Cells, and the lens (written as the Cells context at the lens level).
    const cells = ctx.consumer === "lens" ? ctx.base : ctx;
    if (!cdcIsObject(cells) || cells.consumer !== "cells") return null;
    const n = ctx.consumer === "lens" ? ctx.n : cells.n;
    const m = ctx.consumer === "lens" ? ctx.m : cells.m;
    const quality = cdcQualityToText(cells.quality);
    const code = Object.prototype.hasOwnProperty.call(cdcBasisCode, cells.basis) ? cdcBasisCode[cells.basis] : null;
    if (quality === null || code === null || !cdcIsInt(n) || !cdcIsInt(m)) return null;
    return cells.measure + "." + code + "." + n + "." + m + "." + ws + "." + quality;
  }

  // The canonical Record of a value that may carry extra members, in the order of B.15.
  function cdcCanonRecord(r) {
    return {
      channel: r.channel,
      policy: r.policy,
      external: r.external === true,
      origin: r.origin,
      desc: r.desc,
      ctx: r.ctx,
      cohort: r.cohort,
      obsEndMs: r.obsEndMs,
      cutMs: r.cutMs,
      canonicalThroughMs: r.canonicalThroughMs,
      token: r.token,
    };
  }

  // ---- `sc` records ------------------------------------------------------------------------------------
  // chan ":" pol ":" body ":" ctx ":" cal ":" id   (B.15). Returns {record} or {reason}.
  function cdcParseRecord(text, settings, e) {
    const fields = text.split(":");
    if (fields.length !== 6) return { reason: "a scale record has six fields" };
    const channel = fields[0];
    if (!cdcChannelOk(channel)) return { reason: "unknown channel" };
    const pol = /^([eaklx])(!)?(m)?$/.exec(fields[1]);
    if (!pol) return { reason: "unknown policy" };
    const axis = cdcIsAxisChannel(channel);
    if ((pol[1] === "x") !== axis) return { reason: axis ? "an axis record is frozen (x)" : "x is for an axis record" };
    if (channel === "l" && pol[1] !== "l") return { reason: "the lens carries Local contrast (l)" };
    const id = fields[5];
    if (!cdcIdPattern.test(id)) return { reason: "the mapping id is not 16 base64url characters" };
    const origin = pol[3] ? "manual" : "fit";
    const body = cdcParseBody(fields[2], id, origin);
    if (body.reason) return { reason: body.reason };
    if (axis !== (body.desc !== undefined && body.desc.kind === "axis-linear")) return { reason: axis ? "an axis record carries a domain (d)" : "a domain (d) belongs to an axis record" };
    let desc = null;
    if (body.desc) {
      const d = body.desc;
      desc = { v: VERSION.mapping, id, kind: d.kind, signed: d.signed, params: d.params, clip: d.kind === "axis-linear" ? "axis@1" : "clamp01@1", algorithm: cdcAlgorithm(d.kind, origin) };
      const verdict = API.scale.validate(desc, { requireId: true });
      if (!verdict.ok) return { reason: verdict.reason === "the id does not match the mapping" ? "hash mismatch: the id does not match the mapping" : "invalid descriptor: " + verdict.reason };
      cdcDeepFreeze(desc);
    }
    let ctx = null;
    if (!axis) {
      const parsed = cdcParseCtx(channel, fields[3], desc ? desc.kind : "rank-type7-257", settings, e);
      if (parsed.reason) return { reason: parsed.reason };
      ctx = parsed.ctx;
    } else if (fields[3] !== "-") return { reason: "an axis record has no context" };
    let obsEndMs = null;
    let cohort = null;
    if (fields[4] !== "-") {
      const m = /^(\d{1,16}),(\d{1,9}),(\d{1,9})$/.exec(fields[4]);
      if (!m) return { reason: "the calibration segment is obsEndMs,nCohort,nExcluded" };
      obsEndMs = Number(m[1]);
      cohort = axis ? null : { n: Number(m[2]), excluded: Number(m[3]) };
    }
    const record = cdcCanonRecord({ channel, policy: pol[1], external: Boolean(pol[2]), origin, desc, ctx, cohort, obsEndMs, cutMs: null, canonicalThroughMs: null, token: null });
    if (desc === null) record.mappingId = id;
    return { record };
  }

  // The record's text for an address, or {reason} when it has no address form (a fixed-diverging window
  // travels as `sw`; a mapping that is "No calibration" is never persisted).
  function cdcFormatRecord(record, idsOnly) {
    const desc = record.desc;
    if (!cdcChannelOk(record.channel)) return { reason: "unknown channel" };
    if (!cdcIsObject(desc)) return { reason: "a record without a descriptor cannot be written" };
    const body = cdcFormatBody(desc, idsOnly);
    if (body === null) return { reason: desc.kind === "fixed-diverging" ? "a fixed window travels as the settings window (sw)" : "this kind of mapping has no address form" };
    const ctx = cdcFormatCtx(record);
    if (ctx === null) return { reason: "the context has no address form" };
    if (cdcPolicies.indexOf(record.policy) < 0) return { reason: "unknown policy" };
    // An axis has no cohort: its calibration segment carries how far its domain was fitted (`through`).
    const cal = record.channel.charAt(0) === "a"
      ? (cdcIsInt(record.obsEndMs) && record.obsEndMs >= 0 ? record.obsEndMs + ",0,0" : "-")
      : cdcIsInt(record.obsEndMs) && record.obsEndMs >= 0 && cdcIsObject(record.cohort) && cdcIsInt(record.cohort.n) ? record.obsEndMs + "," + record.cohort.n + "," + cdcExcludedCount(record.cohort.excluded) : "-";
    const pol = record.policy + (record.external === true ? "!" : "") + (record.origin === "manual" ? "m" : "");
    return { text: record.channel + ":" + pol + ":" + body + ":" + ctx + ":" + cal + ":" + desc.id };
  }

  // The frozen axis domains of a state, as records the address can carry.
  function cdcAxisRecords(axes, dropped) {
    const out = [];
    for (const axis of axes) {
      if (!cdcIsObject(axis) || typeof axis.id !== "string" || !cdcAxisPattern.test(axis.id)) {
        dropped.push({ channel: "a", reason: "an axis needs a dotted id" });
        continue;
      }
      if (axis.policy !== "frozen") continue;
      const d = axis.domain;
      if (!Array.isArray(d) || d.length !== 2 || !cdcIsFinite(d[0]) || !cdcIsFinite(d[1]) || !(d[0] < d[1])) {
        dropped.push({ channel: "a." + axis.id, reason: "a frozen axis needs a domain lo < hi" });
        continue;
      }
      out.push({
        channel: "a." + axis.id,
        policy: "x",
        external: false,
        origin: "fit",
        desc: cdcMakeDesc("axis-linear", d[0] < 0, { lo: d[0], hi: d[1] }, "fit"),
        ctx: null,
        cohort: null,
        obsEndMs: cdcIsInt(axis.through) && axis.through >= 0 ? axis.through : null,
        cutMs: null,
        canonicalThroughMs: null,
        token: null,
      });
    }
    return out;
  }

  // ---- formatAddress ---------------------------------------------------------------------------------
  // formatAddress(state, env, {budget}) -> {hash, level, dropped[]} (B.15, C.13). The order is the
  // canonical one: w | t,p; r; vis; ap; the legacy keys (with sel, at, replay in their place); the S1
  // settings; sc. Defaults are omitted except vis and ap, which are ALWAYS written. Deterministic: the same
  // state gives the same string, no clock, no random. `level` is the degrade ladder (L0 full records, L1
  // rank knots replaced by their id, L2 no scales, L3 refuse: `hash` is null and the caller keeps the address
  // it has): with {budget: true} the first level whose FULL URL (env.baseLength + hash) is within 8192 wins.
  // More than 16 active mappings (or 19 frozen axes) throws LimitError: nothing is truncated.
  function cdcFormatAddress(state, env, opts) {
    const e = cdcEnv(env);
    if (!cdcIsObject(state)) throw new TypeError("formatAddress needs a state object");
    if (typeof state.appearance !== "string" || !cdcAppearancePattern.test(state.appearance)) throw new TypeError("formatAddress needs state.appearance, the appearance id: ap= is always written");
    const scales = Array.isArray(state.scales) ? state.scales : [];
    const axes = Array.isArray(state.axes) ? state.axes : [];
    if (scales.length > LIMITS.DESCRIPTORS_MAX) throw cdcError("LimitError", "more than " + LIMITS.DESCRIPTORS_MAX + " active scales (" + scales.length + ")", { code: "limit", limit: LIMITS.DESCRIPTORS_MAX });
    if (axes.length > LIMITS.AXES_MAX) throw cdcError("LimitError", "more than " + LIMITS.AXES_MAX + " frozen axes (" + axes.length + ")", { code: "limit", limit: LIMITS.AXES_MAX });
    const dropped = [];
    const helpers = { env: e, drop: (key, reason) => dropped.push({ key, reason }) };
    const add = (out, k, v) => out.push(k + "=" + v);
    const head = [];
    if (state.window) add(head, "w", state.window);
    else {
      add(head, "t", cdcStamp(state.tA, e) + "~" + cdcStamp(state.tB, e));
      add(head, "p", cdcUsd(state.pA, e) + "~" + cdcUsd(state.pB, e));
    }
    if (state.auto === false) add(head, "r", state.n + "," + state.m);
    add(head, "vis", String(VERSION.visual));
    add(head, "ap", state.appearance);
    // The settings of the table, with the three navigation keys that sit among them written in place.
    const body = [];
    for (const entry of cdcVisualKeys) {
      const value = entry.write(state, helpers);
      if (value !== null && value !== undefined) add(body, entry.param, value);
      if (entry.id === "lines") {
        if (Array.isArray(state.selection) && state.selection.length === 4) {
          const s = state.selection;
          add(body, "sel", cdcStamp(s[0], e) + "~" + cdcStamp(s[1], e) + "," + cdcUsd(s[2], e) + "~" + cdcUsd(s[3], e));
        }
        if (state.anchor !== null && state.anchor !== undefined) add(body, "at", cdcStamp(state.anchor, e));
        if (state.replay === true) add(body, "replay", "1");
      }
    }
    // The records, in a deterministic order: by channel, then by text.
    const records = [];
    const make = (record) => {
      const full = cdcFormatRecord(record, false);
      if (full.reason) {
        dropped.push({ channel: record.channel, reason: full.reason });
        return;
      }
      const ids = cdcFormatRecord(record, true);
      const rank = record.desc.kind === "rank-type7-257" && ids.text !== full.text;
      records.push({ channel: record.channel, full: full.text, ids: ids.text, rank });
    };
    for (const record of scales) make(record);
    for (const record of cdcAxisRecords(axes, dropped)) make(record);
    const rankOf = (r) => (r.channel.charAt(0) === "a" ? 3 : cdcChannelRank[r.channel]);
    records.sort((a, b) => rankOf(a) - rankOf(b) || (a.full < b.full ? -1 : a.full > b.full ? 1 : 0));
    const assemble = (texts) => "#" + head.concat(body, texts.length ? ["sc=" + texts.join(";")] : []).join("&");
    const fits = (hash) => e.baseLength + hash.length <= LIMITS.ADDRESS_MAX;
    let hash = assemble(records.map((r) => r.full));
    if (!(opts && opts.budget) || fits(hash)) return { hash, level: 0, dropped };
    // L1: replace rank knots by their ids, lens first, then Rows, then Cells, one at a time.
    const texts = records.map((r) => r.full);
    const priority = { l: 0, r: 1, c: 2 };
    const order = records.map((r, i) => i).filter((i) => records[i].rank).sort((a, b) => priority[records[a].channel] - priority[records[b].channel] || a - b);
    const replaced = [];
    for (const i of order) {
      texts[i] = records[i].ids;
      replaced.push(i);
      hash = assemble(texts);
      if (fits(hash)) {
        for (const j of replaced) dropped.push({ channel: records[j].channel, reason: "rank knots replaced by the scale id (not exact)" });
        return { hash, level: 1, dropped };
      }
    }
    // L2: settings only.
    hash = assemble([]);
    for (const r of records) dropped.push({ channel: r.channel, reason: "scales left out of the address (settings-only URL, not exact calibration)" });
    if (fits(hash)) return { hash, level: 2, dropped };
    // L3: refuse. Nothing is written; the caller keeps the address it has and says so.
    return { hash: null, level: 3, dropped };
  }

  // ---- parseAddress ------------------------------------------------------------------------------------
  // parseAddress(text, env) -> {kind, version, place, raw, view, appearance, scales, axes, sc, dropped,
  // reasons} (B.15, C.13, A-23). The grammar: "#" then params joined by "&"; a param splits on the first "="
  // (keys non-empty); the value is percent-decoded (a malformed escape drops that param and lists it);
  // the last duplicate wins; unknown keys are ignored and listed. kind is "v2" (vis=2), "legacy" (no vis,
  // a place), "bare" (no usable place: view is null and every other key is listed as dropped) or "reject"
  // (vis present but not 2, or longer than the budget: nothing is applied). A bad `sc` drops only the
  // records that fail, each with its reason, and keeps every other setting. `view` is checkView's result:
  // for a legacy address its `scale` is the defaults and `migrateLegacy` names what changed.
  function cdcParseAddress(text, env) {
    const e = cdcEnv(env);
    const raw = String(text === undefined || text === null ? "" : text);
    const hash = raw.replace(/^#/, "");
    const res = { kind: "bare", version: null, place: "", raw, view: null, appearance: null, scales: [], axes: [], sc: [], dropped: [], reasons: [] };
    if (hash.length + 1 + e.baseLength > LIMITS.ADDRESS_MAX) {
      res.kind = "reject";
      res.reasons.push("the address is longer than " + LIMITS.ADDRESS_MAX + " characters");
      return res;
    }
    const q = new Map();
    const malformed = new Set();
    const places = [];
    for (const part of hash === "" ? [] : hash.split("&")) {
      const i = part.indexOf("=");
      if (i <= 0) continue;
      const key = part.slice(0, i);
      if (cdcNavKeys.indexOf(key) >= 0 && /^(w|t|p|r|sel|at|replay)=/.test(part)) places.push(part);
      try {
        q.set(key, decodeURIComponent(part.slice(i + 1)));
      } catch (error) {
        malformed.add(key);
        res.dropped.push({ key, reason: "malformed percent escape" });
      }
    }
    res.place = places.join("&");
    // The version marker decides before anything else is read.
    if (q.has("vis") || malformed.has("vis")) {
      const seen = q.has("vis") ? q.get("vis") : "";
      if (!q.has("vis") || seen !== "2") {
        res.kind = "reject";
        res.version = seen;
        res.reasons.push(q.has("vis") ? "the address names visual version \"" + seen + "\"; this page reads 2" : "the visual version in the address is malformed");
        return res;
      }
    }
    const v2 = q.has("vis");
    const known = new Set(cdcNavKeys.concat(cdcFixedKeys, cdcVisualKeys.map((entry) => entry.param)));
    for (const key of q.keys()) if (!known.has(key)) res.dropped.push({ key, reason: "unknown key" });
    const fields = cdcReadFields(q, e, v2);
    const base = {};
    const time = (s) => cdcTime(s, e);
    const rows = (s) => cdcRows(s, e);
    const level = /^(\d+),(\d+)$/.exec(q.get("r") || "");
    const selParts = String(q.has("sel") ? q.get("sel") : "").split(",");
    const tPair = cdcPair(q.get("t"), time);
    const pPair = cdcPair(q.get("p"), rows);
    base.window = e.windowKey(q.get("w"));
    base.tA = tPair[0];
    base.tB = tPair[1];
    base.pA = pPair[0];
    base.pB = pPair[1];
    base.auto = !level;
    base.n = level ? Number(level[1]) : NaN;
    base.m = level ? Number(level[2]) : NaN;
    base.selection = q.has("sel") ? [...cdcPair(selParts[0], time), ...cdcPair(selParts[1] === undefined ? "" : selParts[1], rows)].map(Math.round) : null;
    base.anchor = q.has("at") ? Math.round(time(q.get("at"))) : null;
    base.replay = q.get("replay") === "1";
    base.appearance = v2 && q.has("ap") ? q.get("ap") : null;
    const view = cdcCheckView(Object.assign(base, fields), e);
    if (view === null) {
      // No window and no usable rectangle: nothing to show. Every other key of the address is listed.
      for (const key of q.keys()) if (key !== "vis" && known.has(key)) res.dropped.push({ key, reason: "the address names no window and no usable rectangle" });
      res.reasons.push("the address names no window and no usable rectangle");
      return res;
    }
    res.view = view;
    res.kind = v2 ? "v2" : "legacy";
    res.version = v2 ? 2 : null;
    // What the page could not show: a value that changed on its way through the validator is a drop.
    const dropIf = (param, reason) => res.dropped.push({ key: param, reason });
    for (const entry of cdcVisualKeys) {
      if (!q.has(entry.param) || (!v2 && !entry.legacy)) continue;
      const a = {};
      const b = {};
      for (const path of entry.fields) {
        a[path] = cdcPathGet(fields, path);
        b[path] = cdcPathGet(view, path);
      }
      const same = entry.same ? entry.same({ [entry.fields[0]]: a[entry.fields[0]] }, { [entry.fields[0]]: b[entry.fields[0]] }) : entry.fields.every((path) => cdcSame(a[path], b[path]));
      if (!same) dropIf(entry.param, entry.why ? entry.why(fields, view) : "not available on this page; the default is used");
    }
    if (q.has("r") && !level) dropIf("r", "the level is n,m");
    if (q.has("sel") && view.selection === null) dropIf("sel", "the selection is not on this page");
    if (q.has("at") && view.anchor === null) dropIf("at", "the anchor is not on this page");
    if (q.get("replay") === "1" && !view.replay) dropIf("replay", "a replay needs an anchor on this page");
    if (!v2) {
      for (const key of ["ap", "sc"]) if (q.has(key)) dropIf(key, "needs vis=2");
      for (const entry of cdcVisualKeys) if (!entry.legacy && q.has(entry.param)) dropIf(entry.param, "needs vis=2");
      return res;
    }
    if (q.has("ap") && view.appearance === null) dropIf("ap", "not an appearance id");
    res.appearance = view.appearance;
    if (q.has("sc") && q.get("sc") !== "") cdcParseSc(q.get("sc"), view.scale, e, res);
    return res;
  }

  function cdcParseSc(text, settings, e, res) {
    const items = text.split(";").filter((s) => s !== "");
    if (items.length > LIMITS.DESCRIPTORS_MAX + LIMITS.AXES_MAX) {
      res.dropped.push({ key: "sc", reason: "more than " + LIMITS.DESCRIPTORS_MAX + " scales and " + LIMITS.AXES_MAX + " axes; none is used" });
      return;
    }
    const kept = [];
    items.forEach((item, index) => {
      const parsed = cdcParseRecord(item, settings, e);
      if (parsed.reason) res.dropped.push({ key: "sc", index, reason: parsed.reason });
      else kept.push(parsed.record);
    });
    const scales = kept.filter((r) => !cdcIsAxisChannel(r.channel));
    const axes = kept.filter((r) => cdcIsAxisChannel(r.channel));
    if (scales.length > LIMITS.DESCRIPTORS_MAX || axes.length > LIMITS.AXES_MAX) {
      res.dropped.push({ key: "sc", reason: "more than " + LIMITS.DESCRIPTORS_MAX + " active scales or " + LIMITS.AXES_MAX + " frozen axes; none is used" });
      return;
    }
    res.scales = scales;
    res.axes = axes.map((r) => ({ id: r.channel.slice(2), domain: [r.desc.params.lo, r.desc.params.hi], policy: "frozen", through: r.obsEndMs, mappingId: r.desc.id }));
    res.sc = kept;
  }

  // ---- structural walk of an untrusted value ------------------------------------------------------------
  // The allowlist of members per object path (array items are "[]"). An object at a path that is not listed
  // has no allowed members, so an unexpected object is refused, not passed through.
  const cdcCtxKeys = ["consumer", "instrument", "measure", "basis", "unit", "transform", "formula", "quality", "workspace", "n", "m", "period", "rowSize", "base", "bounds"];
  const cdcBaseKeys = ["consumer", "instrument", "measure", "basis", "unit", "transform", "formula", "quality", "workspace", "n", "m"];
  const cdcAllowed = Object.freeze({
    "": ["visualVersion", "kind", "id", "query", "view", "appearance", "scales", "axes", "models", "observation"],
    query: ["t1", "t2", "p1", "p2", "tR", "pR"],
    view: ["mode", "pane", "poc", "area", "untested", "rows", "period", "level", "lines", "tab", "replay", "anchor", "horizon", "evidenceKind", "barrier", "follow", "auto", "window", "viewport", "selection", "scale"],
    "view.scale": ["basis", "pathBasis", "transform", "curve", "rowsTransform", "cells", "rows", "local", "window", "lock"],
    appearance: ["id"],
    "scales[]": ["channel", "policy", "external", "origin", "desc", "ctx", "cohort", "obsEndMs", "cutMs", "canonicalThroughMs", "token"],
    "scales[].desc": ["v", "id", "kind", "signed", "params", "clip", "algorithm"],
    "scales[].desc.params": ["U", "k", "lo", "hi", "mid", "knots", "q"],
    "scales[].ctx": cdcCtxKeys,
    "scales[].ctx.base": cdcBaseKeys,
    "scales[].cohort": ["kind", "n", "zeros", "nonzero", "excluded", "calibratedOn", "bounds", "level", "quality", "obsEndBase", "support"],
    "scales[].cohort.excluded": ["partial", "open", "unread", "nonFinite", "negative", "stale", "placeholder"],
    "scales[].cohort.level": ["n", "m"],
    "scales[].cohort.support": ["timeBase", "priceRows"],
    "axes[]": ["id", "domain", "policy", "through"],
    "models[]": ["id", "formula", "ISO_A", "ISO_B", "baseline", "fit", "estimatedAt", "precision", "methodVersion", "latestTrainingObservation", "eligibilityUpperBound", "appliesTo", "applicability", "status"],
    "models[].fit": ["method", "exponentText", "nMin", "nMax", "historyStart", "extraction"],
    observation: ["source", "instrument", "cutoffMs", "canonicalThroughMs", "token", "note"],
  });

  // The deepest container nesting of JSON text, counted without parsing (so a depth bomb costs one pass and
  // no recursion). Strings are skipped, escapes respected.
  function cdcJsonDepth(text) {
    let depth = 0;
    let max = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (inString) {
        if (c === 92) i++;
        else if (c === 34) inString = false;
      } else if (c === 34) inString = true;
      else if (c === 91 || c === 123) {
        depth++;
        if (depth > max) max = depth;
      } else if (c === 93 || c === 125) depth--;
    }
    return max;
  }

  // Copy an untrusted value into fresh objects, refusing what a payload may not contain: a container nested
  // deeper than DEPTH_MAX, a string longer than STRING_MAX, an array longer than 512, a key of the prototype
  // chain, and (with `allowed`) any member the allowlist does not name. Returns {value} or {reason}.
  function cdcWalk(value, allowed, path, depth) {
    if (value === null || typeof value === "boolean") return { value };
    if (typeof value === "number") return cdcIsFinite(value) ? { value } : { reason: "a number that is not finite at " + (path || "the top") };
    if (typeof value === "string") return value.length <= LIMITS.STRING_MAX ? { value } : { reason: "a string longer than " + LIMITS.STRING_MAX + " characters at " + (path || "the top") };
    if (typeof value !== "object") return { reason: "a value that is not JSON at " + (path || "the top") };
    if (depth >= LIMITS.DEPTH_MAX) return { reason: "nested deeper than " + LIMITS.DEPTH_MAX };
    if (Array.isArray(value)) {
      if (value.length > cdcArrayMax) return { reason: "an array longer than " + cdcArrayMax + " at " + (path || "the top") };
      const out = [];
      for (let i = 0; i < value.length; i++) {
        const item = cdcWalk(value[i], allowed, path + "[]", depth + 1);
        if (item.reason) return item;
        out.push(item.value);
      }
      return { value: out };
    }
    if (!cdcIsObject(value)) return { reason: "an object of a kind JSON does not have at " + (path || "the top") };
    const names = allowed ? allowed[path] || [] : null;
    const out = {};
    for (const key of Object.keys(value)) {
      if (cdcDangerous.indexOf(key) >= 0) return { reason: "the key " + key + " is not allowed" };
      if (names !== null && names.indexOf(key) < 0) return { reason: "the member \"" + key + "\" is not part of a view code (at " + (path || "the top") + ")" };
      const child = cdcWalk(value[key], allowed, path === "" ? key : path + "." + key, depth + 1);
      if (child.reason) return child;
      out[key] = child.value;
    }
    return { value: out };
  }

  // ---- portable code -----------------------------------------------------------------------------------
  // encodePortable(payload, {deflate}) -> Promise<string> (B.15, C.13): the code of a view. `payload` is the
  // JSON of B.15 without its `id` (this fills it: the id96 of the canonical payload, an integrity check
  // the reader recomputes). The text is the canonical JSON (sorted keys, so the same view is the same code),
  // gzip + base64url behind "origo-cube:2." when `deflate` (u8 -> Promise<u8>, gzip) is given, else
  // percent-encoded behind "origo-cube:2j.". Every limit is enforced on WRITE: a payload that would not be
  // accepted back throws (CodeError naming why; LimitError for a size or count).
  async function cdcEncodePortable(payload, opts) {
    API.result.assertJsonSafe(payload);
    if (!cdcIsObject(payload)) throw new TypeError("encodePortable needs a payload object");
    const body = {};
    for (const key of Object.keys(payload)) if (key !== "id") body[key] = payload[key];
    const full = Object.assign({}, body, { id: API.hash.id96(body) });
    const checked = cdcValidatePortable(full, {});
    if (!checked.ok) {
      const limit = checked.reasons.some((r) => /^more than|too large/.test(r));
      throw cdcError(limit ? "LimitError" : "CodeError", checked.reasons.join("; "), { code: limit ? "limit" : "invalid" });
    }
    const text = API.hash.canonical(full);
    const bytes = API.hash.utf8(text);
    if (bytes.length > LIMITS.PAYLOAD_MAX_BYTES) throw cdcError("LimitError", "the view is larger than " + LIMITS.PAYLOAD_MAX_BYTES + " bytes", { code: "limit" });
    if (opts && typeof opts.deflate === "function") {
      const packed = await opts.deflate(bytes);
      if (packed === null || typeof packed !== "object" || typeof packed.length !== "number") throw cdcError("CodeError", "deflate did not return bytes", { code: "deflate" });
      const code = cdcCodePrefix + "2." + API.hash.b64urlEncode(packed);
      if (code.length > cdcCodeMax) throw cdcError("LimitError", "the code is longer than " + cdcCodeMax + " characters", { code: "limit" });
      return code;
    }
    const code = cdcCodePrefix + "2j." + encodeURIComponent(text);
    if (code.length > cdcTextCodeMax) throw cdcError("LimitError", "the code is longer than " + cdcTextCodeMax + " characters", { code: "limit" });
    return code;
  }

  // decodePortable(text, {inflate}) -> Promise<{kind, version, payload, digest}> (C.13). Order, cheapest
  // first, nothing applied until all pass: (1) text length, (2) classify, (3) base64url, (4) bounded
  // inflate, (5) fatal UTF-8, (6) nesting depth and JSON.parse with no reviver, (7) the structural walk:
  // allowlisted members, depth, string and array bounds, no prototype keys, results copied into fresh
  // objects. `kind` is "v2", "legacy" or "query" (a bare cube query: not a view, no notice). The payload of a
  // v2 code is checked further by validatePortable. Any failure REJECTS with a CodeError whose `reason`,
  // `code` and (when a version was named) `version` say why; a rejected code is never partly applied.
  async function cdcDecodePortable(text, opts) {
    const reject = (code, reason, version) => cdcError("CodeError", reason, { code, version: version === undefined ? null : version });
    if (typeof text !== "string") throw reject("type", "a view code is text");
    const t = text.trim();
    const cls = cdcClassifyText(t);
    if (cls.kind === "reject") throw reject("version", cls.reason, cls.version);
    let json;
    if (t.startsWith(cdcCodePrefix + "2.")) {
      if (t.length > cdcCodeMax) throw reject("too-large", "the code is longer than " + cdcCodeMax + " characters");
      const packed = API.hash.b64urlDecode(t.slice(cdcCodePrefix.length + 2));
      if (packed === null) throw reject("base64", "the code is not base64url");
      if (!opts || typeof opts.inflate !== "function") throw reject("inflate", "this page cannot decompress a view code");
      let bytes;
      try {
        bytes = await opts.inflate(packed, LIMITS.PAYLOAD_MAX_BYTES);
      } catch (error) {
        const big = error && (error.name === "TooLarge" || error.code === "too-large");
        throw reject(big ? "too-large" : "inflate", big ? "the code decompresses to more than " + LIMITS.PAYLOAD_MAX_BYTES + " bytes" : "the code could not be decompressed");
      }
      if (bytes === null || typeof bytes !== "object" || typeof bytes.length !== "number") throw reject("inflate", "the code could not be decompressed");
      if (bytes.length > LIMITS.PAYLOAD_MAX_BYTES) throw reject("too-large", "the code decompresses to more than " + LIMITS.PAYLOAD_MAX_BYTES + " bytes");
      try {
        json = API.hash.fromUtf8(bytes);
      } catch (error) {
        throw reject("utf8", "the code is not valid UTF-8");
      }
    } else {
      if (!t.startsWith(cdcCodePrefix) && !t.startsWith("{")) throw reject("structure", "this is not a view code");
      if (t.length > cdcTextCodeMax) throw reject("too-large", "the code is longer than " + cdcTextCodeMax + " characters");
      let rest = t.startsWith(cdcCodePrefix) ? t.slice(cdcCodePrefix.length) : t;
      if (rest.startsWith("2j.")) rest = rest.slice(3);
      try {
        json = rest.startsWith("{") ? rest : decodeURIComponent(rest);
      } catch (error) {
        throw reject("percent", "the code is not valid percent-encoded text");
      }
      if (API.hash.utf8(json).length > LIMITS.PAYLOAD_MAX_BYTES) throw reject("too-large", "the code decodes to more than " + LIMITS.PAYLOAD_MAX_BYTES + " bytes");
    }
    if (cdcJsonDepth(json) > LIMITS.DEPTH_MAX) throw reject("depth", "the code is nested deeper than " + LIMITS.DEPTH_MAX);
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw reject("json", "the code is not valid JSON");
    }
    if (!cdcIsObject(parsed)) throw reject("structure", "the code is not a view");
    const coded = t.startsWith(cdcCodePrefix + "2.") || t.startsWith(cdcCodePrefix + "2j.");
    const seen = cdcClassify(parsed);
    let kind = "query";
    if (coded) kind = "v2";
    else if (Object.prototype.hasOwnProperty.call(parsed, "visualVersion")) kind = seen.kind;
    else if (cdcIsObject(parsed.query) || cdcIsObject(parsed.view)) kind = "legacy";
    if (kind === "reject") throw reject("version", seen.reason, seen.version);
    if (kind === "bare") throw reject("structure", "the code is empty");
    const walked = cdcWalk(parsed, kind === "v2" ? cdcAllowed : null, "", 0);
    if (walked.reason) throw reject("structure", walked.reason);
    return { kind, version: kind === "v2" ? 2 : null, payload: walked.value, digest: cdcDigest(t) };
  }

  const cdcConsumers = Object.freeze(["cells", "rows"]);

  // A context object of a record, verified against the page's own tables through E.context: rebuilt from
  // its members and compared by key string, so a formula, unit or transform that does not belong to the
  // measure is refused. Returns a reason or null.
  function cdcCtxProblem(ctx, channel, e) {
    if (!cdcIsObject(ctx)) return "a scale record needs a context";
    const cells = ctx.consumer === "lens" ? ctx.base : ctx;
    if (ctx.consumer === "lens") {
      if (channel !== "l") return "a lens context belongs to the lens channel";
      if (!cdcIsInt(ctx.n) || !cdcIsInt(ctx.m) || ctx.n < 0 || ctx.m < 0 || ctx.n > e.N_MAX || ctx.m > e.M_MAX) return "the lens level is not valid";
      if (!Array.isArray(ctx.bounds) || ctx.bounds.length !== 4 || !ctx.bounds.every(cdcIsFinite)) return "the lens bounds are four finite numbers";
    }
    if (!cdcIsObject(cells) || cdcConsumers.indexOf(cells.consumer) < 0) return "the context consumer is cells or rows";
    if ((channel === "r") !== (cells.consumer === "rows")) return "the context does not belong to this channel";
    if (cells.instrument !== e.INSTRUMENT) return "the instrument is " + e.INSTRUMENT;
    try {
      let rebuilt;
      if (cells.consumer === "cells") {
        if (!cdcIsInt(cells.n) || !cdcIsInt(cells.m) || cells.n < 0 || cells.m < 0 || cells.n > e.N_MAX || cells.m > e.M_MAX) return "the level is not valid";
        rebuilt = API.context.cellsKey({ measure: cells.measure, basis: cells.basis, pathBasis: cells.basis, transform: cells.transform, quality: cells.quality, n: cells.n, m: cells.m, workspace: cells.workspace, instrument: cells.instrument });
      } else {
        if (!cdcIsInt(cells.rowSize) || cells.rowSize < 0 || cells.rowSize > e.M_MAX) return "the row size is not valid";
        rebuilt = API.context.rowsKey({ measure: cells.measure, transform: cells.transform, quality: cells.quality, period: cells.period, rowSize: cells.rowSize, workspace: cells.workspace, instrument: cells.instrument });
      }
      if (API.context.keyString(rebuilt) !== API.context.keyString(cells)) return "the context does not match the formula tables";
    } catch (error) {
      return "the context is not valid: " + error.message;
    }
    return null;
  }

  // The kinds a context transform may be mapped with, and the signedness a descriptor must agree with.
  const cdcTransformKinds = Object.freeze({
    "value-log": ["value-log1p", "zero-only"],
    "value-linear": ["value-linear", "zero-only"],
    rank: ["rank-type7-257", "zero-only"],
    fixed: ["fixed-linear", "fixed-diverging"],
  });

  // checkRecord: one scale record of a portable payload. Returns {record} or {reason}.
  function cdcCheckScaleRecord(r, e) {
    if (!cdcIsObject(r)) return { reason: "a scale record is an object" };
    if (!cdcChannelOk(r.channel) || cdcIsAxisChannel(r.channel)) return { reason: "a scale record is for channel c, r or l" };
    if (cdcPolicies.indexOf(r.policy) < 0 || r.policy === "x") return { reason: "unknown policy" };
    if (r.channel === "l" && r.policy !== "l") return { reason: "the lens carries Local contrast (l)" };
    if (r.external !== undefined && typeof r.external !== "boolean") return { reason: "external is true or false" };
    if (cdcOrigins.indexOf(r.origin) < 0) return { reason: "unknown origin" };
    if (!cdcIsObject(r.desc)) return { reason: "a scale record carries its descriptor" };
    const verdict = API.scale.validate(r.desc, { requireId: true });
    if (!verdict.ok) return { reason: (verdict.reason === "the id does not match the mapping" ? "hash mismatch: " : "invalid descriptor: ") + verdict.reason + (verdict.path ? " (" + verdict.path + ")" : "") };
    if (r.desc.kind === "axis-linear" || r.desc.kind === "none") return { reason: "a scale record is a colour mapping" };
    const problem = cdcCtxProblem(r.ctx, r.channel, e);
    if (problem) return { reason: problem };
    const cells = r.ctx.consumer === "lens" ? r.ctx.base : r.ctx;
    if (cdcTransformKinds[cells.transform].indexOf(r.desc.kind) < 0) return { reason: "the descriptor kind does not match the context transform" };
    let klass;
    try {
      klass = API.context.compatClass({ ctx: cells, desc: r.desc });
    } catch (error) {
      return { reason: "the context is not valid: " + error.message };
    }
    if ((klass.split("|")[2] === "s") !== r.desc.signed) return { reason: "the descriptor signedness does not match the measure" };
    const c = r.cohort;
    if (c !== null && c !== undefined && (!cdcIsObject(c) || !cdcIsInt(c.n) || c.n < 0)) return { reason: "the cohort needs a count n" };
    for (const name of ["obsEndMs", "cutMs", "canonicalThroughMs"]) if (r[name] !== null && r[name] !== undefined && (!cdcIsInt(r[name]) || r[name] < 0)) return { reason: name + " is an integer number of milliseconds" };
    if (r.token !== null && r.token !== undefined && (typeof r.token !== "string" || !/^[0-9a-f]{1,32}$/.test(r.token))) return { reason: "the token is hex text" };
    const ctx = r.ctx.consumer === "lens" ? { consumer: "lens", base: cells, bounds: r.ctx.bounds, n: r.ctx.n, m: r.ctx.m } : cells;
    return {
      record: cdcCanonRecord({
        channel: r.channel,
        policy: r.policy,
        external: r.external === true,
        origin: r.origin,
        desc: r.desc,
        ctx,
        cohort: c === undefined ? null : c,
        obsEndMs: r.obsEndMs === undefined ? null : r.obsEndMs,
        cutMs: r.cutMs === undefined ? null : r.cutMs,
        canonicalThroughMs: r.canonicalThroughMs === undefined ? null : r.canonicalThroughMs,
        token: r.token === undefined ? null : r.token,
      }),
    };
  }

  function cdcCheckAxisEntry(a) {
    if (!cdcIsObject(a)) return { reason: "an axis entry is an object" };
    if (typeof a.id !== "string" || !cdcAxisPattern.test(a.id)) return { reason: "an axis needs a dotted id" };
    if (a.policy !== "frozen" && a.policy !== "auto" && a.policy !== "fixed") return { reason: "unknown axis policy" };
    if (a.domain !== null && a.domain !== undefined) {
      if (!Array.isArray(a.domain) || a.domain.length !== 2 || !cdcIsFinite(a.domain[0]) || !cdcIsFinite(a.domain[1]) || !(a.domain[0] < a.domain[1])) return { reason: "an axis domain is lo < hi" };
    } else if (a.policy === "frozen") return { reason: "a frozen axis carries its domain" };
    if (a.through !== null && a.through !== undefined && (!cdcIsInt(a.through) || a.through < 0)) return { reason: "through is an integer number of milliseconds" };
    return { axis: { id: a.id, domain: a.domain === undefined ? null : a.domain, policy: a.policy, through: a.through === undefined ? null : a.through } };
  }

  // The model block is DISPLAY only (S1-148): well-formed numbers and dates, and never applied to the
  // model of this page. Returns a reason or null.
  function cdcModelProblem(m) {
    if (!cdcIsObject(m)) return "a model entry is an object";
    if (typeof m.id !== "string" || typeof m.formula !== "string") return "a model has an id and a formula";
    if (!cdcIsFinite(m.ISO_A) || !cdcIsFinite(m.ISO_B)) return "ISO_A and ISO_B are finite numbers";
    if (m.baseline !== undefined && (!cdcIsFinite(m.baseline) || !(m.baseline > 0))) return "the baseline is a positive number";
    const f = m.fit;
    if (!cdcIsObject(f) || !cdcIsInt(f.nMin) || !cdcIsInt(f.nMax) || f.nMin < 0 || f.nMax > 40 || f.nMin > f.nMax) return "the fitted range is integers nMin <= nMax";
    if (typeof f.extraction !== "string" || !cdcDayPattern.test(f.extraction)) return "the extraction date is YYYY-MM-DD";
    if (f.historyStart !== undefined && (typeof f.historyStart !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(f.historyStart))) return "the history start is an ISO time";
    if (m.eligibilityUpperBound !== undefined && m.eligibilityUpperBound !== null) {
      if (typeof m.eligibilityUpperBound !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(m.eligibilityUpperBound)) return "the eligibility bound is an ISO time";
      if (m.eligibilityUpperBound.slice(0, 10) < f.extraction) return "the eligibility bound is before the extraction";
    }
    if (m.status !== undefined && ["retrospective", "timing-unverified", "eligible-by-bound"].indexOf(m.status) < 0) return "unknown model status";
    return null;
  }

  // validatePortable(obj, env) -> {ok, reasons[], value?, dropped[]} (C.13 steps 7 to 11). Checks the version
  // and integrity (the id is recomputed), the structure (the same walk as decode), the counts (16 scales, 19
  // axes, 4 models, 257 knots), every descriptor through E.scale.validate with the id recomputed and its
  // context through the page's tables, the query numbers, the view through checkView (what this page cannot
  // show is DROPPED and listed, never a reason to refuse) and the model block (display only). A version,
  // integrity, limit or descriptor failure rejects the WHOLE payload with its reasons. `value` holds the
  // validated pieces in fresh objects: {visualVersion, kind, id, query, view, appearance, scales, axes,
  // models, observation}; nothing in it is executable.
  function cdcValidatePortable(obj, env) {
    const e = cdcEnv(env);
    const reasons = [];
    const dropped = [];
    const fail = (reason) => {
      reasons.push(reason);
      return { ok: false, reasons, dropped };
    };
    if (!cdcIsObject(obj)) return fail("a view payload is an object");
    const cls = cdcClassify(obj);
    if (cls.kind !== "v2") return fail(cls.kind === "reject" ? cls.reason : "the payload names no visual version (it is a legacy payload)");
    const walked = cdcWalk(obj, cdcAllowed, "", 0);
    if (walked.reason) return fail(walked.reason);
    const p = walked.value;
    if (p.kind !== "view") return fail("the payload is not a view");
    if (typeof p.id !== "string" || !cdcIdPattern.test(p.id)) return fail("the payload id is missing");
    const body = {};
    for (const key of Object.keys(p)) if (key !== "id") body[key] = p[key];
    if (API.hash.id96(body) !== p.id) return fail("integrity check failed: the payload id does not match its content");
    const scales = Array.isArray(p.scales) ? p.scales : [];
    const axes = Array.isArray(p.axes) ? p.axes : [];
    const models = Array.isArray(p.models) ? p.models : [];
    if (scales.length > LIMITS.DESCRIPTORS_MAX) return fail("more than " + LIMITS.DESCRIPTORS_MAX + " active scales (" + scales.length + ")");
    if (axes.length > LIMITS.AXES_MAX) return fail("more than " + LIMITS.AXES_MAX + " frozen axes (" + axes.length + ")");
    if (models.length > LIMITS.MODELS_MAX) return fail("more than " + LIMITS.MODELS_MAX + " models (" + models.length + ")");
    const q = p.query;
    if (!cdcIsObject(q)) return fail("the payload needs its query");
    for (const name of ["t1", "t2", "p1", "p2"]) if (!cdcIsFinite(q[name])) return fail("query." + name + " is a finite number");
    for (const name of ["tR", "pR"]) if (!cdcIsInt(q[name]) || q[name] < 0) return fail("query." + name + " is a non-negative integer");
    if (q.tR > e.N_MAX || q.pR > e.M_MAX) return fail("the query level is outside this page's levels");
    if (!(q.t2 > q.t1) || !(q.p2 > q.p1) || q.t1 < 0 || q.p1 < 0) return fail("the query rectangle is not ordered");
    if (Number.isFinite(e.CUT) && q.t2 > Math.ceil(e.CUT)) return fail("the query rectangle lies beyond this page's history");
    const view = p.view;
    if (!cdcIsObject(view)) return fail("the payload needs its view");
    if (view.window !== undefined && typeof view.window !== "string") return fail("view.window is text");
    if (view.viewport !== undefined && (!Array.isArray(view.viewport) || view.viewport.length !== 4 || !view.viewport.every(cdcIsFinite))) return fail("view.viewport is four finite numbers");
    for (const name of ["poc", "area", "untested", "replay", "auto"]) if (view[name] !== undefined && typeof view[name] !== "boolean") return fail("view." + name + " is true or false");
    if (view.anchor !== undefined && view.anchor !== null && !cdcIsFinite(view.anchor)) return fail("view.anchor is a number or null");
    if (view.level !== undefined && view.level !== null && !cdcIsFinite(view.level)) return fail("view.level is a number or null");
    if (view.lines !== undefined && (!Array.isArray(view.lines) || !view.lines.every((s) => typeof s === "string"))) return fail("view.lines is a list of text");
    for (const name of ["mode", "pane", "rows", "period", "tab", "evidenceKind", "follow"]) if (view[name] !== undefined && typeof view[name] !== "string") return fail("view." + name + " is text");
    if (view.follow !== undefined && cdcFollows.indexOf(view.follow) < 0) return fail("unknown follow mode");
    if (view.tab !== undefined && view.tab !== "evidence" && view.tab !== "context") return fail("unknown tab");
    if (view.evidenceKind !== undefined && view.evidenceKind !== "poc" && view.evidenceKind !== "barrier") return fail("unknown evidence kind");
    if (view.horizon !== undefined && [1, 2, 4, 8].indexOf(view.horizon) < 0) return fail("view.horizon is 1, 2, 4 or 8");
    if (view.barrier !== undefined && [1, 2, 4].indexOf(view.barrier) < 0) return fail("view.barrier is 1, 2 or 4");
    // The S1 settings: a value outside its enumeration is a refused import (tags come from enumerations).
    const settings = cdcDefaultScale();
    const given = view.scale === undefined ? {} : view.scale;
    if (!cdcIsObject(given)) return fail("view.scale is an object");
    const enums = { basis: ["amount", "intensity"], pathBasis: ["spans", "usdt", "perMinute"], transform: ["value", "rank"], curve: ["log", "linear"], rowsTransform: ["value", "rank"], cells: ["explore", "auto"], rows: ["explore", "auto"] };
    for (const name of Object.keys(given)) {
      if (name === "local" || name === "lock") {
        if (typeof given[name] !== "boolean") return fail("scale." + name + " is true or false");
      } else if (name === "window") {
        if (given.window !== null && (!Array.isArray(given.window) || cdcWindowProblem(given.window, view.mode) !== null)) return fail("scale.window is not a valid window" + (Array.isArray(given.window) && cdcWindowProblem(given.window, view.mode) ? ": " + cdcWindowProblem(given.window, view.mode) : ""));
      } else if (enums[name].indexOf(given[name]) < 0) return fail("scale." + name + " is not one of " + enums[name].join(", "));
      settings[name] = given[name];
    }
    if (p.appearance !== undefined && (!cdcIsObject(p.appearance) || typeof p.appearance.id !== "string" || !cdcAppearancePattern.test(p.appearance.id))) return fail("the appearance id is not well formed");
    // Descriptors: each one valid, or the whole payload is refused.
    const outScales = [];
    for (let i = 0; i < scales.length; i++) {
      const checked = cdcCheckScaleRecord(scales[i], e);
      if (checked.reason) return fail("scales[" + i + "]: " + checked.reason);
      outScales.push(checked.record);
    }
    const outAxes = [];
    for (let i = 0; i < axes.length; i++) {
      const checked = cdcCheckAxisEntry(axes[i]);
      if (checked.reason) return fail("axes[" + i + "]: " + checked.reason);
      outAxes.push(checked.axis);
    }
    for (let i = 0; i < models.length; i++) {
      const problem = cdcModelProblem(models[i]);
      if (problem) return fail("models[" + i + "]: " + problem);
    }
    const obs = p.observation;
    if (obs !== undefined) {
      if (!cdcIsObject(obs)) return fail("the observation is an object");
      if (obs.instrument !== undefined && obs.instrument !== e.INSTRUMENT) return fail("the instrument is " + e.INSTRUMENT);
      for (const name of ["cutoffMs", "canonicalThroughMs"]) if (obs[name] !== undefined && obs[name] !== null && (!cdcIsInt(obs[name]) || obs[name] < 0)) return fail("observation." + name + " is an integer number of milliseconds");
    }
    // The view through checkView: what this page cannot show is dropped, not refused.
    const vp = Array.isArray(view.viewport) ? view.viewport : [NaN, NaN, NaN, NaN];
    const checkedView = cdcCheckView(
      {
        window: view.window || "",
        tA: vp[0],
        tB: vp[1],
        pA: vp[2],
        pB: vp[3],
        auto: view.auto !== false,
        n: q.tR,
        m: q.pR,
        follow: view.follow === undefined ? "refit" : view.follow,
        mode: view.mode === undefined ? "volume" : view.mode,
        pane: view.pane === undefined ? "cells" : view.pane,
        rows: view.rows === undefined ? "off" : view.rows,
        period: view.period === undefined ? "90d" : view.period,
        level: view.level === undefined ? null : view.level,
        poc: view.poc,
        area: view.area,
        untested: view.untested,
        lines: view.lines === undefined ? [] : view.lines,
        selection: view.selection === undefined ? null : view.selection,
        anchor: view.anchor === undefined ? null : view.anchor,
        replay: view.replay === true,
        tab: view.tab,
        evidenceKind: view.evidenceKind,
        horizon: view.horizon === undefined ? 1 : view.horizon,
        barrier: view.barrier === undefined ? 1 : view.barrier,
        scale: settings,
        appearance: p.appearance === undefined ? null : p.appearance.id,
      },
      e,
    );
    if (checkedView === null) return fail("the view names no window and no usable rectangle");
    for (const name of ["mode", "pane", "rows", "period"]) if (view[name] !== undefined && view[name] !== checkedView[name]) dropped.push({ key: name, reason: "not available on this page; the default is used" });
    if (Array.isArray(view.lines) && view.lines.length > checkedView.lines.length) dropped.push({ key: "lines", reason: "some lines are not available on this page" });
    if (view.replay === true && !checkedView.replay) dropped.push({ key: "replay", reason: "a replay needs an anchor on this page" });
    if (view.anchor !== undefined && view.anchor !== null && checkedView.anchor === null) dropped.push({ key: "anchor", reason: "the anchor is not on this page" });
    const value = {
      visualVersion: 2,
      kind: "view",
      id: p.id,
      query: { t1: q.t1, t2: q.t2, p1: q.p1, p2: q.p2, tR: q.tR, pR: q.pR },
      view: checkedView,
      appearance: p.appearance === undefined ? null : p.appearance.id,
      scales: outScales,
      axes: outAxes,
      models,
      observation: obs === undefined ? null : obs,
    };
    return { ok: true, reasons, value, dropped };
  }

  // ---- legacy migration --------------------------------------------------------------------------------
  // The settings of the baseline whose hidden or implicit interpretation S1 replaced (D9, A-43), and the key
  // of E.text.migrate that says how. A legacy view keeps every choice it made; what changes is what the
  // choice MEANS, and the notice lists each one.
  const cdcMigrateMode = Object.freeze({ volume: "volume", trades: "trades", size: "size", flow: "flow", flowtrades: "flow", delta: "delta", cascade: "cascade", path: "path", dwell: "dwell", geometry: "geometry" });
  const cdcMigrateRows = Object.freeze({ volume: "rows", delta: "rows", time: "rows", relvol: "relvol" });
  // RSI is a fixed 0 to 100 axis; every other pane drew bars scaled to the bars in view.
  const cdcFixedPanes = Object.freeze(["rsi1d", "rsi4h"]);

  // migrateLegacy(raw) -> {view, changes[]} (C.13, D9, A-43). `raw` is a legacy View (checkView of an old
  // address, of a stored view:v4/v5, or of an old code). The view keeps every choice (w t p r f mode pane rows
  // period level marks lines sel at replay tab outcome h dist) and gets `scale` = the S1 defaults (Amount,
  // Value, Explore, no window, no lock); `appearance` is null (the page applies its own). `changes` has one
  // entry per setting whose interpretation changed, {setting, key, text}: `setting` names the choice as the
  // address writes it, `key` is the E.text.migrate key and `text` the words (they already say what it was
  // and what it is now). Order: mode, rows, pane, efficiency.
  function cdcMigrateLegacy(raw) {
    if (!cdcIsObject(raw)) throw new TypeError("migrateLegacy needs a view");
    const view = {};
    for (const key of Object.keys(raw)) view[key] = raw[key];
    view.scale = cdcDefaultScale();
    view.appearance = null;
    const changes = [];
    const note = (setting, key) => changes.push({ setting, key, text: API.text.migrate[key] });
    const mode = typeof view.mode === "string" ? view.mode : "volume";
    if (Object.prototype.hasOwnProperty.call(cdcMigrateMode, mode)) note("mode=" + mode, cdcMigrateMode[mode]);
    const rows = typeof view.rows === "string" ? view.rows : "off";
    if (Object.prototype.hasOwnProperty.call(cdcMigrateRows, rows)) note("rows=" + rows, cdcMigrateRows[rows]);
    const pane = typeof view.pane === "string" ? view.pane : "cells";
    if (cdcFixedPanes.indexOf(pane) < 0) note("pane=" + pane, "pane");
    if (pane === "efficiency") note("pane=efficiency", "efficiency");
    return { view, changes };
  }

  API.codec = Object.freeze({
    VISUAL_KEYS: cdcVisualKeys,
    formatAddress: cdcFormatAddress,
    parseAddress: cdcParseAddress,
    checkView: (raw, env) => cdcCheckView(raw, cdcEnv(env)),
    classify: cdcClassify,
    encodePortable: cdcEncodePortable,
    decodePortable: cdcDecodePortable,
    validatePortable: cdcValidatePortable,
    migrateLegacy: cdcMigrateLegacy,
    digest: cdcDigest,
    descriptorCount: cdcDescriptorCount,
  });
