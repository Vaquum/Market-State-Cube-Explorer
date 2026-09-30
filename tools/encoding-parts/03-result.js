  // @part 03-result
  // @requires
  // @prefix res
  // @provides result
  // == §03 result: the typed outcome of a measurement (API.md B.1, C.1.2) ==
  // A measurement never answers a bare number: it answers a Typed record whose tag says WHY there is or is
  // not a value (D2). Zero is a value (`finite`, value 0); "no value" has thirteen distinct reasons that the
  // canvas, the tooltip and the legend key each render differently, so they are separate tags, not NaN.

  // DD-04: the alphabet. `finite` is index 0 so the allocation-free paths can carry a tag as a small
  // integer (`out.tag`) and test `=== 0` for "has a value".
  const resTags = Object.freeze([
    "finite",
    "negative-infinite",
    "no-reference",
    "empty-both",
    "empty-population",
    "undefined",
    "no-coarser-parent",
    "waiting-for-complete-parent",
    "outside-support",
    "hidden",
    "pending",
    "failed",
    "unsupported",
    "invalid-input",
  ]);
  const resTagIndex = Object.freeze(resMakeIndex());
  // Tags whose reason is fixed by B.1 (used when the caller gives none) and tags that must name one.
  const resDefaultReason = Object.freeze({
    "negative-infinite": "no current volume",
    "no-reference": "no reference volume",
    "hidden": "replay",
    "pending": "reading",
  });
  const resNeedsReason = Object.freeze(["failed", "unsupported", "outside-support", "invalid-input"]);
  const resNeedsDenominator = Object.freeze(["undefined", "empty-population"]);
  const resFields = Object.freeze(["value", "reason", "denominator", "open", "detail"]);
  const resDepthMax = 64;

  function resMakeIndex() {
    const map = {};
    for (let i = 0; i < resTags.length; i++) map[resTags[i]] = i;
    return map;
  }

  // Strings in a Typed are at most LIMITS.STRING_MAX characters (B.1). A cube error message can be longer;
  // it is cut (with "...") rather than refused, because the failure being reported is more important than
  // the length of its wording. The cut never splits a surrogate pair.
  function resClip(s) {
    if (s.length <= LIMITS.STRING_MAX) return s;
    let end = LIMITS.STRING_MAX - 3;
    const c = s.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end--;
    return s.slice(0, end) + "...";
  }

  // E.result.make (API.md A.3, B.1): a checked Typed. Throws on an unknown tag, on a `value` that is not a
  // finite number (or present on a tag other than `finite`), on a missing required `reason` or
  // `denominator`, and on a field the record does not have. Tags with a fixed wording fill it in (B.1), so
  // make("hidden") is complete. Only the fields that apply are present: no undefined property ever exists.
  function resMake(tag, fields) {
    if (typeof tag !== "string" || !Object.prototype.hasOwnProperty.call(resTagIndex, tag)) throw new RangeError("unknown result tag " + JSON.stringify(tag));
    const f = fields === undefined || fields === null ? {} : fields;
    for (const key of Object.keys(f)) if (resFields.indexOf(key) < 0) throw new RangeError("result field " + JSON.stringify(key) + " does not exist");
    const out = { tag };
    if (tag === "finite") {
      if (typeof f.value !== "number" || !Number.isFinite(f.value)) throw new RangeError("a finite result needs a finite value");
      out.value = f.value;
    } else if (f.value !== undefined) throw new RangeError("only a finite result carries a value (tag " + tag + ")");
    let reason = f.reason !== undefined ? f.reason : resDefaultReason[tag];
    if (reason === undefined && resNeedsReason.indexOf(tag) >= 0) throw new RangeError("result " + tag + " needs a reason");
    if (reason !== undefined) {
      if (typeof reason !== "string") throw new TypeError("result reason must be a string");
      out.reason = resClip(reason);
    }
    if (resNeedsDenominator.indexOf(tag) >= 0) {
      if (typeof f.denominator !== "string" || f.denominator === "") throw new RangeError("result " + tag + " needs a denominator");
      out.denominator = resClip(f.denominator);
    } else if (f.denominator !== undefined) throw new RangeError("only undefined and empty-population results name a denominator (tag " + tag + ")");
    if (tag === "waiting-for-complete-parent") {
      if (f.open !== undefined && f.open !== true) throw new RangeError("open is true or absent");
      out.open = true;
    } else if (f.open !== undefined) throw new RangeError("only waiting-for-complete-parent carries open (tag " + tag + ")");
    if (f.detail !== undefined) out.detail = resAssertJsonSafe(f.detail);
    return out;
  }

  // E.result.finite (API.md A.3): a measured number as a Typed. A non-finite number is a validation
  // failure, never a value and never clamped (D2, DR-12): `invalid-input` with reason "non-finite".
  function resFinite(x) {
    if (typeof x === "number" && Number.isFinite(x)) return { tag: "finite", value: x };
    return { tag: "invalid-input", reason: "non-finite" };
  }

  // E.result.isValue (API.md A.3): does this result carry a number to map?
  function resIsValue(t) {
    return t !== null && t !== undefined && t.tag === "finite";
  }

  // E.result.precedence (API.md C.1.2, DD-05): read and coverage status come BEFORE mathematics. A required
  // read that failed beats one that is pending beats one the source cannot answer; then replay-hidden; then
  // outside the comparison support. null means "carry on with structure and the formula". `read` is null
  // once every read the consumer needs has answered. Built directly (not through make) because this runs
  // per cell and must not throw on a read record that lacks wording: a failed read without a message still
  // says "failed".
  function resPrecedence(input) {
    const read = input.read;
    if (read) {
      if (read.state === "failed") return { tag: "failed", reason: resClip(typeof read.reason === "string" ? read.reason : "read failed") };
      if (read.state === "pending") return { tag: "pending", reason: typeof read.reason === "string" ? read.reason : "reading" };
      if (read.state === "unsupported") return { tag: "unsupported", reason: typeof read.reason === "string" ? read.reason : "not supported" };
    }
    if (input.hidden) return { tag: "hidden", reason: "replay" };
    if (input.outside) return { tag: "outside-support", reason: typeof input.outside.reason === "string" ? input.outside.reason : "outside selection" };
    return null;
  }

  // E.result.assertJsonSafe (API.md A.3, B): returns x when every value inside is JSON-safe and throws a
  // TypeError naming the path of the first one that is not: NaN, an infinity, undefined (also an array
  // hole), a function, a symbol, a bigint, a Map, Set, Date or typed array, or a cycle. Every writer
  // (persistence, portable code, notices) runs it, so a bad number is found where it is made.
  function resAssertJsonSafe(x) {
    resWalk(x, "$", [], 0);
    return x;
  }

  function resWalk(v, path, ancestors, depth) {
    if (v === null) return;
    const type = typeof v;
    if (type === "string" || type === "boolean") return;
    if (type === "number") {
      if (!Number.isFinite(v)) throw new TypeError("not JSON-safe: " + path + " is " + String(v));
      return;
    }
    if (type !== "object") throw new TypeError("not JSON-safe: " + path + " is " + (type === "undefined" ? "undefined" : "a " + type));
    if (depth >= resDepthMax) throw new TypeError("not JSON-safe: " + path + " is nested too deeply");
    if (ancestors.indexOf(v) >= 0) throw new TypeError("not JSON-safe: " + path + " is a cycle");
    ancestors.push(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) resWalk(v[i], path + "[" + i + "]", ancestors, depth + 1);
    } else {
      // Tag test rather than a prototype check so an object from another realm passes.
      const tag = Object.prototype.toString.call(v);
      if (tag !== "[object Object]") throw new TypeError("not JSON-safe: " + path + " is " + tag);
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) resWalk(v[keys[i]], path + "." + keys[i], ancestors, depth + 1);
    }
    ancestors.pop();
  }

  // E.result.describe (API.md A.3, INTEGRATION D.11): the ONE English rendering of a Typed, {short, long}.
  // The words live in E.text.typed[tag] (part 04, read here at call time, so this part loads without it and
  // throws a clear error only if it is asked to describe before part 04 exists). `fmt` formats a finite
  // value (the caller knows the unit); without it the plain JavaScript text is used. `short` is the
  // template filled with {value}, {reason} and {denominator}; `long` is the same text with the reason
  // appended in brackets when the template did not already show it. An entry of E.text.typed may also be
  // an object {short, long} of two templates. A tag this part does not know is described as the
  // invalid-input it is (reason "unknown-tag").
  function resDescribe(typed, fmt) {
    const text = API.text;
    if (!text || !text.typed || typeof text.fill !== "function") throw new Error("E.result.describe needs part 04-text (E.text.typed and E.text.fill)");
    let t = typed;
    if (t === null || typeof t !== "object" || !Object.prototype.hasOwnProperty.call(resTagIndex, t.tag)) t = { tag: "invalid-input", reason: "unknown-tag" };
    const entry = text.typed[t.tag];
    if (entry === undefined) throw new Error("E.text.typed has no entry for " + t.tag);
    const params = {};
    if (t.tag === "finite") params.value = typeof fmt === "function" ? String(fmt(t.value)) : String(t.value);
    if (typeof t.reason === "string") params.reason = t.reason;
    if (typeof t.denominator === "string") params.denominator = t.denominator;
    if (typeof entry === "object" && entry !== null) {
      const short = text.fill(entry.short, params);
      return { short, long: entry.long === undefined ? short : text.fill(entry.long, params) };
    }
    const short = text.fill(entry, params);
    const shown = typeof t.reason === "string" && (short.indexOf(t.reason) >= 0 || entry.indexOf("{reason}") >= 0);
    return { short, long: typeof t.reason === "string" && !shown ? short + " (" + t.reason + ")" : short };
  }

  API.result = Object.freeze({
    TAGS: resTags,
    TAG: resTagIndex,
    make: resMake,
    finite: resFinite,
    isValue: resIsValue,
    precedence: resPrecedence,
    assertJsonSafe: resAssertJsonSafe,
    describe: resDescribe,
  });
