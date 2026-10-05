(() => {
  "use strict";
  // Browser storage for the explorer. This browser keeps the workspace, the last view and the
  // named views for every tab; each tab keeps its own history. Storage can be unavailable
  // (private windows, blocked site data): reads then come back empty and writes throw.
  //
  // S1 adds to this file and changes nothing that was there: the properties `saved`, `save`, `views`,
  // `saveViews`, `viewsKey`, `history` and `saveHistory` keep their shapes and their failure behaviour
  // (a write that fails throws, so the callers' catch blocks still report it). The new methods never
  // throw; they return what happened, so a caller can put it in front of the person and keep the
  // running state usable. This file cannot import the encoding module (it loads before it), so the few
  // rules it needs about versions are written here, in their smallest form.
  const prefix = "market-state-cube-explorer:";
  // The one version this build writes (visualVersion, DR-14). A stored payload without it is legacy and
  // is still read; one that names a version other than this is a newer build's and is never overwritten.
  const VISUAL_VERSION = 2;
  // Browser-wide calibration cache: the contexts kept (S1-118, LIMITS.CONTEXTS_MAX in the module).
  const CONTEXTS_MAX = 64;
  // The history of a tab lives in sessionStorage; everything else is browser-wide.
  const areaOf = (key) => (key === "history:v1" || key === "backup:history:v1" ? "sessionStorage" : "localStorage");
  const describe = (error) =>
    (error && error.name ? error.name : "Error") + (error && error.message ? ": " + error.message : "");
  const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  // The text in a storage slot, or why it could not be read (the storage object itself may throw).
  const fetchText = (area, key) => {
    try {
      return { ok: true, text: window[area].getItem(prefix + key) };
    } catch (error) {
      return { ok: false, error };
    }
  };
  // A payload from a newer build names another visualVersion: the reason, or null.
  const newer = (x) =>
    isObject(x) && x.visualVersion !== undefined && x.visualVersion !== VISUAL_VERSION
      ? "visual version " + JSON.stringify(x.visualVersion) + " was written by a newer or unknown version"
      : null;
  // What a parsed payload of each key must look like: {status, reason} for a payload that cannot be
  // used, null for one that can. `unknown-version` means "from a newer build: keep it, never overwrite".
  const problem = (key, value) => {
    const foreign = newer(value);
    switch (key) {
      case "view:v5":
      case "view:v4":
        if (!isObject(value)) return { status: "unreadable", reason: "not an object" };
        if (foreign) return { status: "unknown-version", reason: foreign };
        if (key === "view:v4" ? value.version !== 4 : value.version !== 4 && value.version !== 5)
          return { status: "unknown-version", reason: "version " + JSON.stringify(value.version) + " is not one this page reads" };
        return null;
      case "views:v1":
        if (Array.isArray(value)) return null;
        return foreign ? { status: "unknown-version", reason: foreign } : { status: "unreadable", reason: "not a list of views" };
      case "history:v1":
      case "notice:v2":
        if (!isObject(value) && !(key === "notice:v2" && typeof value === "boolean")) return { status: "unreadable", reason: "not an object" };
        return foreign ? { status: "unknown-version", reason: foreign } : null;
      case "scales:v1":
        if (!isObject(value)) return { status: "unreadable", reason: "not an object" };
        if (foreign) return { status: "unknown-version", reason: foreign };
        if (value.visualVersion !== VISUAL_VERSION || !Array.isArray(value.contexts))
          return { status: "unreadable", reason: "not a calibration cache of visual version 2" };
        return null;
      default:
        return null;
    }
  };
  // read(key) -> {status, value, raw, reason}. status is "absent" (nothing stored), "ok" (value is the
  // parsed payload; a legacy payload without visualVersion is ok: the caller classifies it), "unreadable"
  // (storage refused, or the text is not usable; raw keeps the text when there is one) or "unknown-version"
  // (a newer build's payload; value is null so nothing applies it, raw keeps it). Never throws.
  const read = (key) => {
    const got = fetchText(areaOf(key), key);
    if (!got.ok) return { status: "unreadable", value: null, raw: null, reason: "storage is unavailable (" + describe(got.error) + ")" };
    if (got.text === null) return { status: "absent", value: null, raw: null, reason: null };
    let value;
    try {
      value = JSON.parse(got.text);
    } catch (error) {
      return { status: "unreadable", value: null, raw: got.text, reason: "the saved text is not valid JSON" };
    }
    const bad = problem(key, value);
    if (bad) return { status: bad.status, value: null, raw: got.text, reason: bad.reason };
    return { status: "ok", value, raw: got.text, reason: null };
  };
  // backup(key) -> {ok, copied, reason}: copies an unreadable or foreign payload to `backup:<key>` before
  // anything overwrites it, ONCE: an existing backup is never replaced, so the first foreign payload
  // survives. A readable or absent payload needs no backup. Never throws.
  const backup = (key) => {
    const area = areaOf(key);
    const got = fetchText(area, key);
    if (!got.ok) return { ok: false, copied: false, reason: "storage is unavailable (" + describe(got.error) + ")" };
    if (got.text === null) return { ok: true, copied: false, reason: "nothing is stored" };
    const status = read(key).status;
    if (status !== "unreadable" && status !== "unknown-version") return { ok: true, copied: false, reason: "the saved payload is readable" };
    const had = fetchText(area, "backup:" + key);
    if (had.ok && had.text !== null) return { ok: true, copied: false, reason: "a backup already exists" };
    try {
      window[area].setItem(prefix + "backup:" + key, got.text);
      return { ok: true, copied: true, reason: null };
    } catch (error) {
      return { ok: false, copied: false, reason: describe(error) };
    }
  };
  // The text this page wrote or verified last, per key: a write whose slot still holds it needs no
  // look at what is there (Play saves several times a second).
  const known = new Map();
  // Every write goes through here. Before it replaces a payload it cannot use (not JSON, or from a newer
  // build) it copies it to `backup:<key>`; if that copy fails the write is refused, so such a payload is
  // never lost. It throws like the baseline setItem did: the callers' catch blocks report it.
  const store = (key, value) => {
    const area = areaOf(key);
    const text = JSON.stringify(value);
    const got = fetchText(area, key);
    if (got.ok && got.text !== null && known.get(key) !== got.text) {
      const status = read(key).status;
      if (status === "unreadable" || status === "unknown-version") {
        const copy = backup(key);
        if (!copy.ok) throw new Error("the saved " + key + " could not be kept before it was replaced: " + copy.reason);
      }
    }
    window[area].setItem(prefix + key, text);
    known.set(key, text);
  };
  // What the baseline's read returned: the parsed value, or null for anything unusable (warning once per
  // failure, as it did). A newer build's payload reads as null here too, and stays in storage.
  const parsed = (key, got = read(key)) => {
    if (got.status === "unreadable" || got.status === "unknown-version")
      console.warn(`The explorer's saved ${key} could not be used: ${got.reason}.`);
    return got.status === "ok" ? got.value : null;
  };
  // A payload this build writes carries visualVersion 2 beside what it always had, so an older build
  // still reads it (unknown members are ignored there).
  const stamp = (x) => (isObject(x) ? Object.assign({}, x, { visualVersion: VISUAL_VERSION }) : x);
  // The last view: version 5 is written; a version-4 view is read when no version-5 one exists.
  const loadSaved = () => {
    const v5 = read("view:v5");
    return v5.status === "absent" ? parsed("view:v4") : parsed("view:v5", v5);
  };
  // saveScales(x) -> {ok, reason?, contexts, skipped}: read-modify-write of the browser-wide live
  // calibration cache (`x` is E.store.toJSON() of the live workspace: {visualVersion, contexts:[{key, ...}]}).
  // The stored contexts and the given ones are united by key; the given ones win (last writer wins per
  // key) and come last (most recently used); beyond 64 the oldest go. The replay store is tab memory and
  // never reaches storage: a context of the replay workspace is skipped and counted. There is no `storage`
  // event following anywhere: each tab keeps its own active snapshot (S1-119), this cache only seeds the
  // next page load. Never throws.
  const saveScales = (x) => {
    if (!isObject(x) || !Array.isArray(x.contexts)) return { ok: false, reason: "not a calibration cache", contexts: 0, skipped: 0 };
    const isReplay = (c) => /\|replay\|/.test(c.key) || (isObject(c.ctx) && c.ctx.workspace === "replay");
    const usable = (c) => isObject(c) && typeof c.key === "string" && c.key !== "";
    let skipped = 0;
    const incoming = [];
    for (const c of x.contexts) {
      if (!usable(c) || isReplay(c)) skipped++;
      else incoming.push(c);
    }
    const now = read("scales:v1");
    const merged = new Map();
    if (now.status === "ok") for (const c of now.value.contexts) if (usable(c)) merged.set(c.key, c);
    for (const c of incoming) {
      merged.delete(c.key);
      merged.set(c.key, c);
    }
    const list = [...merged.values()].slice(-CONTEXTS_MAX);
    try {
      store("scales:v1", { visualVersion: VISUAL_VERSION, contexts: list });
      return { ok: true, contexts: list.length, skipped };
    } catch (error) {
      return { ok: false, reason: describe(error), contexts: 0, skipped };
    }
  };
  // The one-time version-change notice flag (DR-14): `notice()` reads it, `saveNotice()` sets it. Never throws.
  const saveNotice = (x) => {
    try {
      store("notice:v2", Object.assign({ shown: true }, isObject(x) ? x : {}, { visualVersion: VISUAL_VERSION }));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: describe(error) };
    }
  };
  // Authored data has a protected namespace. Legacy view writers never touch these keys.
  // A document forks its writer even when duplicate-tab sessionStorage inherited its pointer.
  const drawingRoot = "drawings:v1:", drawingSessionKey = drawingRoot + "session", drawingIndexKey = drawingRoot + "index";
  const namedRoot = "drawing-views:v1:", namedPointerKey = namedRoot + "pointer", namedMergedRoot = "drawing-views:v2:";
  let drawingWriter = null, drawingSequence = 0, namedBaseline = null;
  const protectedUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const protectedId = () => {
    const crypto = window.crypto || globalThis.crypto;
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto?.getRandomValues !== "function") throw new Error("secure drawing storage identities are unavailable");
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  };
  const writerId = () => drawingWriter || (drawingWriter = protectedId());
  const protectedRead = (area, key) => {
    const got = fetchText(area, key);
    if (!got.ok) return { status: "unreadable", value: null, raw: null, reason: "storage is unavailable (" + describe(got.error) + ")" };
    if (got.text === null) return { status: "absent", value: null, raw: null, reason: null };
    try { return { status: "ok", value: JSON.parse(got.text), raw: got.text, reason: null }; }
    catch { return { status: "unreadable", value: null, raw: got.text, reason: "saved authored data is not valid JSON" }; }
  };
  const verifiedWrite = (area, key, value) => {
    const text = JSON.stringify(value); window[area].setItem(prefix + key, text);
    if (window[area].getItem(prefix + key) !== text) throw new Error("authored storage write could not be verified");
  };
  const protectedKeys = (root) => {
    const area = window.localStorage, keys = [];
    for (let i = 0; i < area.length; i++) { const key = area.key(i); if (typeof key === "string" && key.startsWith(prefix + root + "record:")) keys.push(key.slice(prefix.length)); }
    return keys;
  };
  const drawingRecordCache = new Map();
  const freezeProtected = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const member of Object.values(value)) freezeProtected(member); Object.freeze(value); } return value; };
  const drawingRecord = (id) => {
    const key = drawingRoot + "record:" + id, text = fetchText("localStorage", key), cached = drawingRecordCache.get(id);
    if (text.ok && cached?.raw === text.text) return cached;
    drawingRecordCache.delete(id);
    const got = protectedRead("localStorage", key);
    if (got.status !== "ok") return { ...got, collection: null };
    const r = got.value;
    if (!isObject(r) || r.storageVersion !== 1) return { ...got, status: "unknown-version", value: null, collection: null, reason: "unsupported authored recovery version" };
    if (!protectedUuid(id) || r.id !== id || !protectedUuid(r.writer) || !Number.isSafeInteger(r.sequence) || r.sequence < 0 || !Number.isSafeInteger(r.revision) || r.revision < 0 || typeof r.pinned !== "boolean" || (r.createdAt !== undefined && (!Number.isSafeInteger(r.createdAt) || r.createdAt < 0))) return { ...got, status: "unreadable", value: null, collection: null, reason: "invalid authored recovery record" };
    try {
      const collection = freezeProtected(window.explorerEncoding.drawings.normalizeCollection(r.collection)), validated = freezeProtected({ ...got, value: { ...r, collection }, collection });
      drawingRecordCache.set(id, validated);
      if (drawingRecordCache.size > 64) drawingRecordCache.delete(drawingRecordCache.keys().next().value);
      return validated;
    }
    catch (error) { return { ...got, status: /unsupported drawing schema/.test(error.message) ? "unknown-version" : "unreadable", value: null, collection: null, reason: error.message }; }
  };
  const drawingRecoveries = () => {
    try {
      const recoveries = [];
      for (const key of protectedKeys(drawingRoot)) {
        const got = drawingRecord(key.slice((drawingRoot + "record:").length));
        if (got.status === "ok") recoveries.push({ id: got.value.id, writer: got.value.writer, revision: got.value.revision, sequence: got.value.sequence, pinned: got.value.pinned, createdAt: got.value.createdAt ?? 0, collection: got.collection });
      }
      return recoveries.sort((a, b) => b.createdAt - a.createdAt || b.sequence - a.sequence || a.id.localeCompare(b.id));
    } catch { return []; }
  };
  const drawingLoad = (recoveries = drawingRecoveries()) => {
    const session = protectedRead("sessionStorage", drawingSessionKey);
    if (session.status !== "ok") return { ...session, collection: null, recoveries };
    const value = session.value;
    if (!isObject(value) || ![1, 2].includes(value.storageVersion)) return { status: "unknown-version", collection: null, raw: session.raw, reason: "unsupported or invalid drawing session", recoveries };
    if (value.storageVersion === 2) {
      try {
        if (!protectedUuid(value.id) || !protectedUuid(value.writer) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("invalid complete drawing session");
        return { ...session, collection: window.explorerEncoding.drawings.normalizeCollection(value.collection), recoveries };
      } catch (error) { return { status: /unsupported drawing schema/.test(error.message) ? "unknown-version" : "unreadable", collection: null, raw: session.raw, reason: error.message, recoveries }; }
    }
    if (!protectedUuid(value.id)) return { status: "unreadable", collection: null, raw: session.raw, reason: "invalid drawing session identity", recoveries };
    const got = drawingRecord(value.id);
    if (got.status === "absent") return { status: "unreadable", collection: null, raw: session.raw, reason: "this tab's saved drawing revision is missing; choose a recovery", recoveries };
    if (got.status === "ok") {
      // Migrate the pointer once so another tab's subsequent history pruning cannot erase this tab.
      try { verifiedWrite("sessionStorage", drawingSessionKey, { storageVersion: 2, id: value.id, writer: got.value.writer, revision: got.value.revision, collection: got.collection }); }
      catch (error) { return { status: "unreadable", collection: null, raw: session.raw, reason: "the tab's drawing snapshot could not be protected (" + describe(error) + "); choose recovery or export", recoveries }; }
    }
    return { ...got, recoveries };
  };
  const drawingWrite = (collection, revision, pinned) => {
    try {
      const normalized = window.explorerEncoding.drawings.normalizeCollection(collection);
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("invalid drawing revision");
      if (!pinned) {
        const previous = drawingLoad([]);
        if (!["ok", "absent"].includes(previous.status)) {
          if (previous.raw === null) throw new Error(previous.reason);
          // Deduplicate a verified byte-for-byte copy before replacing an unreadable tab snapshot.
          const digest = window.explorerEncoding.hash.hex(window.explorerEncoding.hash.sha256(window.explorerEncoding.hash.utf8(JSON.stringify(previous.raw)))),
            key = drawingRoot + "unreadable-session:" + digest, backup = protectedRead("localStorage", key);
          if (backup.status === "absent") verifiedWrite("localStorage", key, { storageVersion: 1, raw: previous.raw });
          else if (backup.status !== "ok" || backup.value?.storageVersion !== 1 || backup.value.raw !== previous.raw)
            throw new Error("unreadable drawing session backup conflicts; the original session remains preserved");
        }
      }
      const before = drawingRecoveries(), writer = writerId(), id = protectedId(), sequence = ++drawingSequence,
        createdAt = Math.max(Date.now(), ...before.map((record) => record.createdAt + 1));
      if (!Number.isSafeInteger(createdAt)) throw new Error("drawing recovery timestamp exhausted");
      const record = { storageVersion: 1, id, writer, sequence, revision, pinned, createdAt, collection: normalized };
      verifiedWrite("localStorage", drawingRoot + "record:" + id, record);
      // Recovery history is rolling; each tab's complete session snapshot remains its own authority.
      const records = drawingRecoveries(), ordinary = records.filter((r) => !r.pinned), pins = records.filter((r) => r.pinned);
      const retained = new Set(ordinary.filter((r) => r.writer === writer).slice(0, 2).map((r) => r.id));
      for (const r of ordinary) if (retained.size < 24) retained.add(r.id);
      for (const r of pins.slice(0, 8)) retained.add(r.id);
      verifiedWrite("localStorage", drawingIndexKey, { storageVersion: 1, ids: [...retained] });
      if (!pinned) verifiedWrite("sessionStorage", drawingSessionKey, { storageVersion: 2, writer, id, revision, collection: normalized });
      let expired = 0;
      for (const r of records) if (!retained.has(r.id)) {
        try { window.localStorage.removeItem(prefix + drawingRoot + "record:" + r.id); expired++; } catch { /* an extra recovery is safe */ }
      }
      return { ok: true, id, expired };
    } catch (error) { return { ok: false, reason: describe(error) }; }
  };
  const drawingRecover = (id) => { const got = drawingRecord(id); return { ...got, recoveries: drawingRecoveries() }; };
  const validateNamedEntry = (entry) => {
    if (!isObject(entry) || typeof entry.name !== "string" || !entry.name.trim()) throw new Error("named view needs its name");
    if (![entry.span, entry.lead, entry.tA, entry.tB, entry.cut, entry.n, entry.m].every(Number.isFinite) || entry.span <= 0)
      throw new Error("named view " + entry.name + " needs finite camera metadata and a positive span");
    if (["live", "auto"].some((key) => entry[key] !== undefined && typeof entry[key] !== "boolean"))
      throw new Error("named view " + entry.name + " needs boolean live/auto metadata");
    if (entry.visualVersion === 3) {
      if (!isObject(entry.payload) || entry.payload.visualVersion !== 3) throw new Error("named view needs its complete version-3 payload");
      if (window.explorerEncoding.hash.utf8(window.explorerEncoding.hash.canonical(entry.payload)).length > window.explorerEncoding.LIMITS.PAYLOAD_MAX_BYTES) throw new Error("named view exceeds the complete payload byte limit");
      const checked = window.explorerEncoding.codec.validatePortable(entry.payload, {});
      if (!checked.ok) throw new Error("named view " + entry.name + ": " + checked.reasons.join("; "));
    } else {
      if (entry.visualVersion !== undefined && entry.visualVersion !== VISUAL_VERSION) throw new Error("unsupported named-view visual version");
      if (typeof entry.hash !== "string" || !entry.hash || entry.payload !== undefined) throw new Error("legacy named view needs its chart address");
    }
    // Keep legacy metadata and the sealed original: normalized portable values are not wire payloads.
    return JSON.parse(JSON.stringify(entry));
  };
  const validateNamedList = (list) => {
    if (!Array.isArray(list)) throw new Error("protected named views must be a list");
    const names = new Set();
    return list.map((entry) => {
      const checked = validateNamedEntry(entry);
      if (names.has(checked.name)) throw new Error("repeated named view " + checked.name); names.add(checked.name);
      return checked;
    });
  };
  // The old namespace is read only by this new registry. Foreign entries stay there verbatim.
  // Seed the first last-read baseline so a second tab cannot downgrade a concurrently upgraded view.
  const legacyNamedBaseline = () => {
    const got = read("views:v1"), entries = [], names = new Set();
    if (got.status === "ok") for (const entry of got.value) {
      if (entry?.visualVersion !== undefined && entry.visualVersion !== VISUAL_VERSION) continue;
      try {
        const checked = validateNamedEntry(entry);
        if (!names.has(checked.name)) { entries.push(checked); names.add(checked.name); }
      } catch { /* unusable legacy entries remain in their original namespace */ }
    }
    return entries;
  };
  const legacyProtectedNamedRead = () => {
    const pointer = protectedRead("localStorage", namedPointerKey);
    if (pointer.status !== "ok") return { ...pointer, entries: [] };
    if (!isObject(pointer.value) || pointer.value.storageVersion !== 1) return { status: "unknown-version", entries: [], raw: pointer.raw, reason: "unsupported protected named-view pointer" };
    if (!protectedUuid(pointer.value.id)) return { status: "unreadable", entries: [], raw: pointer.raw, reason: "invalid protected named-view pointer identity" };
    const got = protectedRead("localStorage", namedRoot + "record:" + pointer.value.id);
    if (got.status !== "ok") return { ...got, status: got.status === "absent" ? "unreadable" : got.status, entries: [], reason: got.reason || "protected named payload is missing" };
    if (!isObject(got.value) || got.value.storageVersion !== 1) return { ...got, status: "unknown-version", value: null, entries: [], reason: "unsupported protected named-view version" };
    try { if (got.value.id !== pointer.value.id) throw new Error("protected named-view record identity mismatch"); return { ...got, entries: validateNamedList(got.value.entries) }; }
    catch (error) { return { ...got, status: "unreadable", value: null, entries: [], reason: error.message }; }
  };
  const stampCompare = (a, b) => a[0] - b[0] || (a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1);
  const validStamp = (stamp) => Array.isArray(stamp) && stamp.length === 2 && Number.isSafeInteger(stamp[0]) && stamp[0] >= 0 && (stamp[0] === 0 ? stamp[1] === "" : protectedUuid(stamp[1]));
  const namedCells = (entries) => entries.map((value, position) => ({ name: value.name, value, valueStamp: [0, ""], position, orderStamp: [0, ""] }));
  const validateNamedRecord = (raw, id) => {
    if (!isObject(raw) || raw.storageVersion !== 2) throw new Error("unsupported merged named-view version");
    if (!protectedUuid(id) || raw.id !== id || !protectedUuid(raw.writer) || !Number.isSafeInteger(raw.clock) || raw.clock < 1 || !Array.isArray(raw.cells)) throw new Error("invalid merged named-view record");
    const names = new Set();
    for (const cell of raw.cells) {
      if (!isObject(cell) || typeof cell.name !== "string" || !cell.name.trim() || names.has(cell.name) || !validStamp(cell.valueStamp) || !validStamp(cell.orderStamp) || !Number.isSafeInteger(cell.position) || cell.position < 0 || cell.valueStamp[0] > raw.clock || cell.orderStamp[0] > raw.clock) throw new Error("invalid merged named-view cell");
      if (cell.value !== null && validateNamedEntry(cell.value).name !== cell.name) throw new Error("named-view cell name does not match its payload");
      names.add(cell.name);
    }
    return raw;
  };
  const mergeNamedCells = (records) => {
    const merged = new Map();
    for (const record of records) for (const cell of record.cells) {
      const old = merged.get(cell.name);
      if (!old) merged.set(cell.name, { ...cell });
      else {
        if (stampCompare(cell.valueStamp, old.valueStamp) > 0) { old.value = cell.value; old.valueStamp = cell.valueStamp; }
        if (stampCompare(cell.orderStamp, old.orderStamp) > 0) { old.position = cell.position; old.orderStamp = cell.orderStamp; }
      }
    }
    return [...merged.values()];
  };
  const cellsToEntries = (cells) => cells.filter((cell) => cell.value !== null).sort((a, b) => a.position - b.position || stampCompare(a.orderStamp, b.orderStamp) || a.name.localeCompare(b.name)).map((cell) => cell.value);
  const protectedNamedRead = () => {
    try {
      let keys = protectedKeys(namedMergedRoot), records = [];
      // A compactor may remove a key after enumeration. Re-enumerate once before returning a view.
      for (let attempt = 0; attempt < 2; attempt++) {
        records = []; let disappeared = false;
        for (const key of keys) {
          const got = protectedRead("localStorage", key);
          if (got.status === "absent") { disappeared = true; continue; }
          if (got.status !== "ok") return { ...got, entries: [], cells: [], records: [] };
          try { records.push(validateNamedRecord(got.value, key.slice((namedMergedRoot + "record:").length))); }
          catch (error) { return { status: /unsupported/.test(error.message) ? "unknown-version" : "unreadable", entries: [], cells: [], records: [], raw: got.raw, reason: error.message }; }
        }
        if (!disappeared) break;
        if (attempt === 1) return { status: "unreadable", entries: [], cells: [], records: [], raw: null, reason: "named views changed while reading; retry" };
        keys = protectedKeys(namedMergedRoot);
      }
      if (!records.length) {
        const legacy = legacyProtectedNamedRead();
        return { ...legacy, cells: namedCells(legacy.status === "ok" ? legacy.entries : legacyNamedBaseline()), records: [], clock: 0 };
      }
      const cells = mergeNamedCells(records), entries = cellsToEntries(cells);
      return { status: "ok", value: null, raw: null, reason: null, entries, cells, records, clock: Math.max(...records.map((record) => record.clock)) };
    } catch (error) { return { status: "unreadable", entries: [], cells: [], records: [], raw: null, reason: describe(error) }; }
  };
  const protectedNamedViews = (options) => {
    const got = protectedNamedRead(), entries = got.status === "absent" ? cellsToEntries(got.cells) : got.entries;
    // The UI, status and deletion baseline must describe the same read, even if another tab publishes next.
    if (got.status === "ok" || got.status === "absent") namedBaseline = JSON.parse(JSON.stringify(entries));
    return options?.snapshot ? { ...got, entries } : got.entries;
  };
  const pruneNamedRecords = () => {
    const got = protectedNamedRead(); if (got.status !== "ok") return;
    const records = got.records.slice().sort((a, b) => b.clock - a.clock || b.id.localeCompare(a.id)), keep = new Set(records.slice(0, 2).map((r) => r.id));
    // Immutable IDs are safe to remove only when a retained full snapshot dominates every cell.
    for (const record of records) {
      if (keep.has(record.id)) continue;
      const covered = records.some((other) => {
        if (!keep.has(other.id) || other.id === record.id) return false;
        const cells = new Map(other.cells.map((cell) => [cell.name, cell]));
        return record.cells.every((cell) => {
          const next = cells.get(cell.name);
          return next && stampCompare(next.valueStamp, cell.valueStamp) >= 0 && stampCompare(next.orderStamp, cell.orderStamp) >= 0;
        });
      });
      if (!covered) { keep.add(record.id); continue; }
      try { window.localStorage.removeItem(prefix + namedMergedRoot + "record:" + record.id); } catch { /* retaining an extra registry snapshot is safe */ }
    }
    const legacy = legacyProtectedNamedRead();
    if (legacy.status === "ok") for (const key of protectedKeys(namedRoot)) {
      const old = protectedRead("localStorage", key);
      if (old.status !== "ok" || old.value?.storageVersion !== 1 || old.value?.id === legacy.value.id) continue;
      try { validateNamedList(old.value.entries); window.localStorage.removeItem(prefix + key); } catch { /* unsupported or unreadable originals remain preserved */ }
    }
  };
  const protectedSaveNamedViews = (list) => {
    try {
      const incoming = validateNamedList(list), current = protectedNamedRead();
      if (current.status !== "ok" && current.status !== "absent") throw new Error(current.reason);
      const baseline = namedBaseline || (current.status === "absent" ? cellsToEntries(current.cells) : current.entries),
        before = new Map(baseline.map((entry) => [entry.name, JSON.stringify(entry)])), next = new Map(incoming.map((entry) => [entry.name, entry])),
        cells = new Map(current.cells.map((cell) => [cell.name, { ...cell }])), writer = writerId(), clock = current.clock + 1, stamp = [clock, writer];
      if (!Number.isSafeInteger(clock)) throw new Error("named-view version clock exhausted");
      for (const name of before.keys()) if (!next.has(name)) {
        const old = cells.get(name); cells.set(name, { name, value: null, valueStamp: stamp, position: old?.position || 0, orderStamp: old?.orderStamp || stamp });
      }
      incoming.forEach((entry, position) => {
        const old = cells.get(entry.name), changed = !before.has(entry.name) || before.get(entry.name) !== JSON.stringify(entry);
        // Unchanged stale entries cannot resurrect a concurrent deletion or downgrade an upgrade.
        if (!old && !changed) return;
        cells.set(entry.name, { name: entry.name, value: changed ? entry : old.value, valueStamp: changed ? stamp : old.valueStamp, position, orderStamp: stamp });
      });
      const id = protectedId(), record = { storageVersion: 2, id, writer, clock, cells: [...cells.values()] };
      // This one immutable atomic write publishes the whole transaction; there is no raced pointer.
      verifiedWrite("localStorage", namedMergedRoot + "record:" + id, record);
      namedBaseline = JSON.parse(JSON.stringify(incoming));
      pruneNamedRecords(); return { ok: true, id };
    } catch (error) { return { ok: false, reason: describe(error) }; }
  };
  const protectedDrawings = Object.freeze({ load: () => drawingLoad(), save: (collection, revision = 0) => drawingWrite(collection, revision, false), preserve: (collection) => drawingWrite(collection, 0, true), recover: drawingRecover });

  window.explorerState = {
    drawings: protectedDrawings,
    namedViews: protectedNamedViews,
    namedViewsStatus: protectedNamedRead,
    saveNamedViews: protectedSaveNamedViews,
    // Version 4 kept the workspace and the view in one object; version 5 splits them.
    saved: loadSaved(),
    save: (state) => store("view:v5", stamp(state)),
    views: () => parsed("views:v1"),
    // The list is stored as given: each entry carries its own visualVersion (a legacy entry stays
    // legacy, a newer build's entry stays untouched), so a list rewrite never re-stamps what it did not make.
    saveViews: (list) => store("views:v1", list),
    viewsKey: prefix + "views:v1",
    history: () => parsed("history:v1"),
    saveHistory: (history) => store("history:v1", stamp(history)),
    read,
    backup,
    scales: () => read("scales:v1"),
    saveScales,
    notice: () => read("notice:v2"),
    saveNotice,
  };
})();
