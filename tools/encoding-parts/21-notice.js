  // @part 21-notice
  // @requires 04-text
  // @prefix ntc
  // @provides notice
  // == §21 notice: the banner's queue, coalescing and once-per-payload memory (API.md B.14, DD-53) ==
  // The page shows ONE dismissible banner (INTEGRATION.md D.7) fed by everything that can go wrong or
  // change quietly: storage and history failures, a shortened address, a rejected import, a migrated
  // legacy view. This part is the queue behind it and nothing else: no DOM, no timer, no storage. The page
  // reads `version` (a counter that changes exactly when what the banner would show changes), and only
  // then rebuilds the banner's DOM (DD-53), so a Play-speed stream of the same failure is one row with a
  // growing count and one cheap DOM write per change, never a stream of banners.
  // DR-31: there is no `named-views-limit` code. The named-view cap is void; a storage quota failure is
  // reported through `storage-failed` while the running state stays usable.

  // The codes of B.14 (without the void one): the default level of each and where its English lives in
  // E.text (part 04). Errors are the ones that mean something did not happen (a write, an import, the scale
  // display itself); warnings mean something happened in a reduced form; info is a fact the person may want.
  const ntcCodes = Object.freeze({
    "legacy-migrated": { level: "info", group: "notice", name: "legacy" },
    "version-default": { level: "info", group: "notice", name: "versionDefault" },
    "scale-changed": { level: "info", group: "note", name: "scaleChanged" },
    "address-degraded": { level: "warning", group: "notice", name: "addressDegraded" },
    "storage-failed": { level: "error", group: "notice", name: "storageFailed" },
    "history-failed": { level: "warning", group: "notice", name: "historyFailed" },
    "import-rejected": { level: "error", group: "notice", name: "importRejected" },
    "import-partial": { level: "warning", group: "notice", name: "importPartial" },
    "scale-dropped": { level: "warning", group: "notice", name: "scaleDropped" },
    "scale-context-differs": { level: "info", group: "notice", name: "scaleContextDiffers" },
    "appearance-mismatch": { level: "info", group: "notice", name: "appearanceMismatch" },
    "limit": { level: "warning", group: "notice", name: "limit" },
    "clipboard": { level: "info", group: "notice", name: "clipboard" },
    "code-not-stored": { level: "info", group: "notice", name: "codeNotStored" },
    "scale-fault": { level: "error", group: "notice", name: "scaleFault" },
  });
  // Which of two notices shows first: the higher level, then the newer.
  const ntcRank = Object.freeze({ info: 1, warning: 2, error: 3 });
  // Bounds, so a session that misbehaves for days cannot grow the queue or the memory of digests: the rows
  // kept (a dismissed row goes first, then the oldest) and the digests remembered (the oldest goes first).
  const ntcRowsMax = 32;
  const ntcSeenMax = 256;

  // The words of a code: its E.text template filled with `params` (E.text.fill never throws and leaves a
  // missing {name} visible). Falls back to the code itself when part 04 has no such string, because an
  // odd banner is better than none.
  function ntcWords(code, params) {
    const entry = ntcCodes[code];
    const group = API.text[entry.group];
    const template = group ? group[entry.name] : undefined;
    return typeof template === "string" ? API.text.fill(template, params) : code;
  }

  // A row as the page sees it: a frozen copy in the field order of B.14, so the queue's own rows can never
  // be changed from outside. `details` is frozen once when the row is made and shared.
  function ntcSnapshot(row) {
    return Object.freeze({
      id: row.id,
      code: row.code,
      level: row.level,
      text: row.text,
      details: row.details,
      key: row.key,
      count: row.count,
      atMs: row.atMs,
      dismissed: row.dismissed,
    });
  }

  // E.notice.create (API.md A.3, B.14, DD-02): `{now, coalesceMs?}` -> the queue. `now` is the caller's
  // clock (a function returning milliseconds; this part has none of its own). `coalesceMs` defaults to
  // TIMING.NOTICE_COALESCE_MS (5000). A missing clock or a bad window is a programming error found at
  // start-up, so it throws here; nothing thrown later (post is called from catch blocks).
  function ntcCreate(options) {
    const opts = options !== null && typeof options === "object" ? options : {};
    if (typeof opts.now !== "function") throw new TypeError("E.notice.create needs {now}, a function returning milliseconds");
    const coalesceMs = opts.coalesceMs === undefined ? TIMING.NOTICE_COALESCE_MS : opts.coalesceMs;
    if (typeof coalesceMs !== "number" || !Number.isFinite(coalesceMs) || coalesceMs < 0) throw new TypeError("E.notice.create: coalesceMs is a number of milliseconds, 0 or more");
    const rows = [];
    const digests = new Set();
    let seq = 0;
    let version = 0;
    let lastAt = 0;

    // The clock, tolerantly: a clock that throws or answers a non-number reads as "no time has passed".
    function at() {
      try {
        const t = Number(opts.now());
        if (Number.isFinite(t)) lastAt = t;
      } catch (error) {
        // keep lastAt
      }
      return lastAt;
    }

    // post({code, params?, text?, details?, level?, key?}) -> the row, or null (API.md B.14). It NEVER
    // throws, because it is called from the catch blocks of failing writes: an unknown code or a `text`
    // that is not a string is refused with null and nothing changes. `text` is the caller's words; without
    // it the words are the code's E.text string filled with `params`. `key` is what coalesces: the same key
    // within `coalesceMs` of the row's LAST occurrence adds to its `count` instead of making a row (a
    // failure that keeps happening stays one row, even across many windows, and a row the person dismissed
    // stays dismissed while it keeps happening). The default key is code + ":" + text, so different words
    // are different notices; pass a key such as "legacy-migrated:3fa9c2" to coalesce by payload.
    function post(input) {
      try {
        if (input === null || typeof input !== "object") return null;
        const code = input.code;
        if (typeof code !== "string" || !Object.prototype.hasOwnProperty.call(ntcCodes, code)) return null;
        if (input.text !== undefined && typeof input.text !== "string") return null;
        const text = input.text !== undefined ? input.text : ntcWords(code, input.params);
        const key = typeof input.key === "string" && input.key !== "" ? input.key : code + ":" + text;
        const now = at();
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          if (row.key !== key) continue;
          if (now - row.atMs < coalesceMs) {
            row.count++;
            row.atMs = now;
            if (!row.dismissed) version++;
            return ntcSnapshot(row);
          }
          break;
        }
        const level = typeof input.level === "string" && Object.prototype.hasOwnProperty.call(ntcRank, input.level) ? input.level : ntcCodes[code].level;
        const lines = Array.isArray(input.details) ? input.details.filter((d) => typeof d === "string") : [];
        seq++;
        const row = { id: "n" + seq, seq, code, level, text, details: Object.freeze(lines), key, count: 1, atMs: now, dismissed: false };
        rows.push(row);
        while (rows.length > ntcRowsMax) {
          let drop = 0;
          for (let i = 0; i < rows.length; i++) {
            if (rows[i].dismissed) {
              drop = i;
              break;
            }
          }
          rows.splice(drop, 1);
        }
        version++;
        return ntcSnapshot(row);
      } catch (error) {
        return null;
      }
    }

    // list() -> every row still kept, oldest first, dismissed ones included (they carry `dismissed: true`).
    function list() {
      return rows.map(ntcSnapshot);
    }

    // current() -> the one notice the banner shows: among the rows not dismissed the highest level, then
    // the newest; null when there is none. The rest wait in the queue and appear as this one is dismissed.
    function current() {
      let best = null;
      for (const row of rows) {
        if (row.dismissed) continue;
        if (best === null || ntcRank[row.level] > ntcRank[best.level] || (ntcRank[row.level] === ntcRank[best.level] && row.seq > best.seq)) best = row;
      }
      return best === null ? null : ntcSnapshot(best);
    }

    // dismiss(id) -> true when it hid a notice that was showing or queued; false for an unknown id or one
    // already dismissed (nothing changes, so `version` does not move).
    function dismiss(id) {
      for (const row of rows) {
        if (row.id !== id) continue;
        if (row.dismissed) return false;
        row.dismissed = true;
        version++;
        return true;
      }
      return false;
    }

    // seen(digest) and mark(digest): once per payload and tab (B.14). The digest is the caller's short
    // text for "this payload" (E.codec.digest). `mark` returns true when the digest was new, so
    // `if (notices.mark(d)) notices.post(...)` is the whole once-only rule; the caller persists the set for
    // the tab by remembering what it marked. Neither touches `version`: a digest is not visible.
    function seen(digest) {
      return typeof digest === "string" && digests.has(digest);
    }

    function mark(digest) {
      if (typeof digest !== "string" || digest === "" || digests.has(digest)) return false;
      digests.add(digest);
      if (digests.size > ntcSeenMax) digests.delete(digests.values().next().value);
      return true;
    }

    return Object.freeze({
      post,
      list,
      current,
      dismiss,
      seen,
      mark,
      // A counter that only grows and changes exactly when the banner's content would (a row appears, a
      // visible row's count moves, a row is dismissed): the DOM write guard (DD-53).
      get version() {
        return version;
      },
    });
  }

  API.notice = Object.freeze({
    create: ntcCreate,
  });
