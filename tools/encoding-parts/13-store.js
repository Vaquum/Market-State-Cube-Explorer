  // @part 13-store
  // @requires 03-result 08-scale 10-context
  // @prefix sto
  // @provides store
  // == §13 store: the calibration store, its 64-context LRU, eligibility and persistence JSON (API.md C.9, DR-06, DR-14, DR-16, DD-20) ==
  // A Calibration (B.6) is one fitted mapping for one context. The store keeps them per workspace ("live" and
  // "replay": the replay workspace is tab memory only, nothing written in replay reaches live, and leaving
  // replay simply stops reading it). Per context it keeps up to `recordsPer` records ascending by the end of
  // their observations, because a backward scrub needs "the newest record that could have existed then". Across
  // contexts it is an LRU of `capacity` (64) entries with PROTECTION: the contexts in use and the ones a
  // Comparison lock holds are never evicted (the store may then exceed its capacity and says so). Evicted
  // keys go to a ring of tombstones so a later initialisation can disclose "initialised after eviction".
  // There is no clock: use order is a counter, eligibility compares integer milliseconds handed in, so every
  // behaviour is deterministic and a test needs no timer.
  //
  // Eligibility (DD-20): a record is eligible at cutoff `cutMs` iff it is an explicit lock (`policy
  // "comparison"`), an external mapping (`origin "external"`), or its observations end at or before the
  // cutoff (`obsEndMs <= cutMs`). Explore and Auto records fitted on LATER observations are invalid at an earlier
  // cutoff (replay scrubbed back) and are skipped; explicit locks are kept and reported as `external` when they
  // reach past the cutoff, never invalidated.
  //
  // What the store refuses to keep: a mapping of kind "none" (No calibration is not a mapping), a record whose
  // `key` is not the key string of its own `ctx`, a record of another workspace, and a session-local
  // `generation` (stripped: it is never persisted or compared across tabs).

  const stoWorkspaces = Object.freeze(["live", "replay"]);
  const stoPolicies = Object.freeze(["explore", "auto", "comparison", "local"]);
  const stoOrigins = Object.freeze(["fit", "manual", "restored", "external"]);

  function stoIsObject(x) {
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function stoWorkspace(ws) {
    if (stoWorkspaces.indexOf(ws) < 0) throw new RangeError("store: workspace must be live or replay, not " + String(ws));
    return ws;
  }

  // The cutoff a lookup compares against: a finite number of ms, or none (null/undefined: nothing is
  // later than "no cutoff", so every record is eligible, which is what a live page with no edge wants).
  function stoCut(cutMs) {
    if (cutMs === undefined || cutMs === null) return Infinity;
    if (typeof cutMs !== "number" || cutMs !== cutMs) throw new TypeError("store: the cutoff is a number of milliseconds");
    return cutMs;
  }

  // Is this record eligible at cutMs, and does it reach past it (an explicit lock or external mapping that
  // is exempt from invalidation but must be labelled)?
  function stoExempt(rec) {
    return rec.policy === "comparison" || rec.origin === "external";
  }

  // The shallow copy the store keeps: frozen, `generation` removed, the nested descriptor is already deeply
  // frozen by E.scale. Throws on a record that is not storable (a programming error in the caller).
  function stoKeep(ws, rec) {
    if (!stoIsObject(rec)) throw new TypeError("store: a calibration record is an object");
    if (typeof rec.key !== "string" || rec.key === "") throw new TypeError("store: a record needs its context key string");
    if (!stoIsObject(rec.desc)) throw new TypeError("store: a record needs its descriptor");
    if (rec.desc.kind === "none") throw new RangeError("store: No calibration (kind none) is never stored");
    if (typeof rec.obsEndMs !== "number" || !Number.isFinite(rec.obsEndMs)) throw new TypeError("store: a record needs a finite obsEndMs");
    if (rec.workspace !== undefined && rec.workspace !== ws) throw new RangeError("store: a " + String(rec.workspace) + " record cannot enter the " + ws + " workspace");
    if (stoIsObject(rec.ctx) && API.context.keyString(rec.ctx) !== rec.key) throw new RangeError("store: the record's key is not the key string of its context");
    const copy = {};
    const keys = Object.keys(rec);
    for (let i = 0; i < keys.length; i++) if (keys[i] !== "generation") copy[keys[i]] = rec[keys[i]];
    return Object.freeze(copy);
  }

  // The reason an INCOMING record (a stored or imported one) is refused, or null. Stricter than stoKeep: it
  // trusts nothing (D9): the descriptor is validated and its id recomputed, the enumerations are checked, and
  // the whole record must be JSON-safe.
  function stoIncomingProblem(rec, key, ws, extra) {
    if (!stoIsObject(rec)) return "a record must be an object";
    if (rec.key !== key) return "the record's key differs from its context's";
    if (stoPolicies.indexOf(rec.policy) < 0) return "unknown policy";
    if (stoOrigins.indexOf(rec.origin) < 0) return "unknown origin";
    if (typeof rec.obsEndMs !== "number" || !Number.isFinite(rec.obsEndMs)) return "obsEndMs must be a finite number";
    if (rec.cutMs !== undefined && (typeof rec.cutMs !== "number" || !Number.isFinite(rec.cutMs))) return "cutMs must be a finite number";
    if (rec.workspace !== undefined && rec.workspace !== ws) return "a " + String(rec.workspace) + " record is not stored";
    if (!stoIsObject(rec.desc)) return "the descriptor is missing";
    if (rec.desc.kind === "none") return "No calibration is never stored";
    const v = API.scale.validate(rec.desc, { requireId: true });
    if (!v.ok) return "descriptor: " + v.reason + (v.path ? " (" + v.path + ")" : "");
    try {
      API.result.assertJsonSafe(rec);
    } catch (error) {
      return String(error && error.message ? error.message : error);
    }
    if (typeof extra === "function") {
      const r = extra(rec);
      if (r === false) return "refused by the caller's validator";
      if (stoIsObject(r) && r.ok === false) return typeof r.reason === "string" ? r.reason : "refused by the caller's validator";
    }
    return null;
  }

  // The keys a commit must not evict: the contexts in use and the Comparison-held ones. `protect` is a
  // function returning them (the page computes them at commit time), a Set or an array.
  function stoProtected(protect) {
    const set = new Set();
    let items = protect;
    if (typeof protect === "function") items = protect();
    if (items === undefined || items === null) return set;
    for (const k of items) set.add(k);
    return set;
  }

  // E.store.create (API.md A.3, C.9, DD-02): `{capacity = LIMITS.CONTEXTS_MAX, recordsPer = LIMITS.RECORDS_PER_CONTEXT}`
  // -> a Store. Every method takes the workspace first ("live" | "replay").
  //   lookup(ws, key, cutMs) -> {record, ineligibleNewer, external} | null   newest ELIGIBLE record of the
  //        context, or null; `ineligibleNewer` says a newer record exists that the cutoff made ineligible;
  //        `external` is true for an exempt record that reaches past the cutoff. Touches the entry (it is in use).
  //   latest(ws, key) -> the newest record regardless of eligibility (null if none); touches nothing
  //   commit(ws, rec, protect) -> {record, updated, evicted[], overflow}   see below
  //   touch(ws, key) -> boolean, remove(ws, key) -> boolean, clear(ws?) -> void
  //   wasEvicted(ws, key) -> boolean   the key was evicted and has not been committed again
  //   keys(ws) -> string[]   least recently used first
  //   toJSON(ws = "live") / mergeJSON(json, opts)   persistence of the cache (live only)
  function stoCreate(options) {
    const opts = options !== null && typeof options === "object" ? options : {};
    const capacity = opts.capacity === undefined ? LIMITS.CONTEXTS_MAX : opts.capacity;
    const recordsPer = opts.recordsPer === undefined ? LIMITS.RECORDS_PER_CONTEXT : opts.recordsPer;
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(recordsPer) || recordsPer < 1) throw new TypeError("E.store.create: capacity and recordsPer are positive integers");
    // One space per workspace: entries (key -> {key, ctx, records, used}) and the tombstone ring.
    const spaces = {
      live: { entries: new Map(), tombstones: [] },
      replay: { entries: new Map(), tombstones: [] },
    };
    // Use order is a counter, never a clock: deterministic and monotone. Entries merged in from storage
    // take numbers BELOW every existing one (they are older than anything this tab has used).
    let seq = 0;

    function space(ws) {
      return spaces[stoWorkspace(ws)];
    }

    function lookup(ws, key, cutMs) {
      const entry = space(ws).entries.get(key);
      if (entry === undefined) return null;
      entry.used = ++seq;
      const cut = stoCut(cutMs);
      let newer = false;
      for (let i = entry.records.length - 1; i >= 0; i--) {
        const rec = entry.records[i];
        const exempt = stoExempt(rec);
        if (exempt || rec.obsEndMs <= cut) return { record: rec, ineligibleNewer: newer, external: exempt && rec.obsEndMs > cut };
        newer = true;
      }
      return null;
    }

    function latest(ws, key) {
      const entry = space(ws).entries.get(key);
      return entry === undefined || entry.records.length === 0 ? null : entry.records[entry.records.length - 1];
    }

    function touch(ws, key) {
      const entry = space(ws).entries.get(key);
      if (entry === undefined) return false;
      entry.used = ++seq;
      return true;
    }

    function remove(ws, key) {
      return space(ws).entries.delete(key);
    }

    function clear(ws) {
      const list = ws === undefined ? stoWorkspaces : [stoWorkspace(ws)];
      for (let i = 0; i < list.length; i++) {
        spaces[list[i]].entries.clear();
        spaces[list[i]].tombstones.length = 0;
      }
    }

    function wasEvicted(ws, key) {
      return space(ws).tombstones.indexOf(key) >= 0;
    }

    function keys(ws) {
      const list = Array.from(space(ws).entries.values());
      list.sort((a, b) => a.used - b.used);
      return list.map((e) => e.key);
    }

    // Evict the least recently used entries that are not protected until the store fits, or nothing evictable is
    // left (then the store exceeds its capacity and the caller is told). Evicted keys join the tombstone ring.
    function shrink(sp, protect, evicted) {
      while (sp.entries.size > capacity) {
        let victim = null;
        for (const entry of sp.entries.values()) {
          if (protect.has(entry.key)) continue;
          if (victim === null || entry.used < victim.used) victim = entry;
        }
        if (victim === null) return true;
        sp.entries.delete(victim.key);
        evicted.push(victim.key);
        sp.tombstones.push(victim.key);
        if (sp.tombstones.length > LIMITS.TOMBSTONES_MAX) sp.tombstones.shift();
      }
      return false;
    }

    // commit(ws, rec, protect) (C.9): add a record, most recently used. A record with the same descriptor id and
    // the same observation end as one already kept is NOT a new record (a refit to identical numbers): only its
    // `cutMs` and fit time move (`updated` true). Otherwise it is inserted ascending by obsEndMs (later commits
    // after equal ends) and the oldest records beyond `recordsPer` are dropped. The entry just committed is
    // always protected; `protect` adds the page's active and held keys. Returns the evicted keys and whether
    // the store is over capacity because everything left is protected.
    function commit(ws, rec, protect) {
      const sp = space(ws);
      const kept = stoKeep(ws, rec);
      let entry = sp.entries.get(kept.key);
      let updated = false;
      if (entry === undefined) {
        entry = { key: kept.key, ctx: stoIsObject(kept.ctx) ? kept.ctx : null, records: [], used: 0 };
        sp.entries.set(kept.key, entry);
      }
      entry.used = ++seq;
      let stored = kept;
      for (let i = 0; i < entry.records.length; i++) {
        const old = entry.records[i];
        if (old.desc.id === kept.desc.id && old.obsEndMs === kept.obsEndMs) {
          const fresh = {};
          if (kept.cutMs !== undefined) fresh.cutMs = kept.cutMs;
          if (kept.fittedAtMs !== undefined) fresh.fittedAtMs = kept.fittedAtMs;
          stored = Object.freeze(Object.assign({}, old, fresh));
          entry.records[i] = stored;
          updated = true;
          break;
        }
      }
      if (!updated) {
        let at = entry.records.length;
        while (at > 0 && entry.records[at - 1].obsEndMs > kept.obsEndMs) at--;
        entry.records.splice(at, 0, kept);
        while (entry.records.length > recordsPer) entry.records.shift();
      }
      // A committed key is present again: it is no longer "evicted".
      const ghost = sp.tombstones.indexOf(kept.key);
      if (ghost >= 0) sp.tombstones.splice(ghost, 1);
      const guard = stoProtected(protect);
      guard.add(kept.key);
      const evicted = [];
      const overflow = shrink(sp, guard, evicted);
      return { record: stored, updated, evicted, overflow };
    }

    // toJSON(ws = "live") -> {visualVersion:2, contexts:[{key, ctx, records}]} (API.md C.9): at most `capacity`
    // contexts (the most recently used), ordered least recently used first so a merge restores the order.
    // Records are the stored (frozen) objects; none carries `generation`. Only live is meant to be persisted: the
    // replay workspace is tab memory, but the method serves both so a test can see either.
    function toJSON(ws) {
      const sp = space(ws === undefined ? "live" : ws);
      const list = Array.from(sp.entries.values());
      list.sort((a, b) => a.used - b.used);
      const kept = list.length > capacity ? list.slice(list.length - capacity) : list;
      const contexts = [];
      for (let i = 0; i < kept.length; i++) contexts.push({ key: kept[i].key, ctx: kept[i].ctx, records: kept[i].records.slice() });
      return { visualVersion: VERSION.visual, contexts };
    }

    // mergeJSON(json, {workspace?, validate?, protect?, preferIncoming?}) (API.md C.9, A-44, DR-14): the read
    // half of the read-modify-write a tab does on the shared cache. Nothing is trusted: each record is checked
    // with E.scale.validate (id recomputed), its key against its context, its enumerations and JSON-safety, plus
    // the caller's own `validate(record)` (false, or {ok:false, reason}). A record or context that fails is SKIPPED
    // and named in `skipped`; it never aborts the others. Whole-payload failures are REJECTED and preserved
    // verbatim, never overwritten (DR-14): a `visualVersion` other than this build's (newer or unknown), a
    // payload that is not an object with a contexts array, or more contexts than the store holds.
    // Union, last writer wins per key: the writer is THIS tab, so a context already in the store keeps its
    // records (this tab's own state); contexts it lacks are added, as the OLDEST in use order, so the tab's
    // own contexts outlive them under pressure. `preferIncoming: true` flips that (an explicit import).
    // -> {added, skipped:[{key, reason}], rejected:null|string, preserve?:json, evicted:[]}
    function mergeJSON(json, options2) {
      const o = options2 !== null && typeof options2 === "object" ? options2 : {};
      const ws = stoWorkspace(o.workspace === undefined ? "live" : o.workspace);
      const refuse = (reason) => ({ added: 0, skipped: [], rejected: reason, preserve: json, evicted: [] });
      if (!stoIsObject(json)) return refuse("the stored cache is not an object");
      if (json.visualVersion !== VERSION.visual) return refuse("visualVersion " + String(json.visualVersion) + " is not " + VERSION.visual + " (newer or unknown)");
      if (!Array.isArray(json.contexts)) return refuse("the stored cache has no contexts list");
      if (json.contexts.length > capacity) return refuse("the stored cache holds " + json.contexts.length + " contexts (more than " + capacity + ")");
      const sp = space(ws);
      const skipped = [];
      const accepted = [];
      for (let i = 0; i < json.contexts.length; i++) {
        const c = json.contexts[i];
        const name = stoIsObject(c) && typeof c.key === "string" ? c.key : "#" + i;
        if (!stoIsObject(c) || typeof c.key !== "string" || !Array.isArray(c.records) || c.records.length === 0) {
          skipped.push({ key: name, reason: "a context needs a key and a list of records" });
          continue;
        }
        if (c.records.length > recordsPer) {
          skipped.push({ key: name, reason: "more than " + recordsPer + " records" });
          continue;
        }
        let problem = null;
        try {
          if (!stoIsObject(c.ctx)) problem = "the context is missing";
          else if (API.context.keyString(c.ctx) !== c.key) problem = "the key is not the key string of the context";
        } catch (error) {
          problem = "the context is malformed";
        }
        for (let j = 0; problem === null && j < c.records.length; j++) problem = stoIncomingProblem(c.records[j], c.key, ws, o.validate);
        if (problem !== null) {
          skipped.push({ key: name, reason: problem });
          continue;
        }
        accepted.push(c);
      }
      // Older than everything this tab has used: numbers below the smallest existing one, in payload order.
      let floor = seq + 1;
      for (const entry of sp.entries.values()) if (entry.used < floor) floor = entry.used;
      let base = floor - accepted.length - 1;
      let added = 0;
      for (let i = 0; i < accepted.length; i++) {
        const c = accepted[i];
        const present = sp.entries.get(c.key);
        base++;
        if (present !== undefined && o.preferIncoming !== true) continue;
        const records = c.records.map((r) => stoKeep(ws, r));
        records.sort((a, b) => a.obsEndMs - b.obsEndMs);
        const entry = { key: c.key, ctx: c.ctx, records, used: present !== undefined ? ++seq : base };
        sp.entries.set(c.key, entry);
        const ghost = sp.tombstones.indexOf(c.key);
        if (ghost >= 0) sp.tombstones.splice(ghost, 1);
        added++;
      }
      const evicted = [];
      shrink(sp, stoProtected(o.protect), evicted);
      return { added, skipped, rejected: null, evicted };
    }

    return Object.freeze({ lookup, latest, commit, touch, remove, clear, wasEvicted, keys, toJSON, mergeJSON });
  }

  API.store = Object.freeze({
    create: stoCreate,
  });
