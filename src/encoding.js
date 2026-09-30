/* Measurement, scale, readout and persistence definitions shared by the page and the Node tests.
   One factory, no dependencies: no DOM, no network, no d3, no storage, no clock, no randomness.
   Plain script in the page (window.explorerEncoding), require() in Node. Assembled from parts; after the
   first assembly this file is the single source of truth and is edited directly. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerEncoding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // == §00-header ==
  // @part 00-header
  // @requires
  // @prefix hdr
  // @provides VERSION LIMITS TIMING THRESHOLDS LATTICE
  // == §00 header: versions, limits and the shared constants ==
  // The only names every later part may use directly (all other cross-part calls go through
  // API.<namespace>.<function>, resolved at call time, so a part never depends on another part's
  // private names): API, VERSION, LIMITS, TIMING, THRESHOLDS, LATTICE.
  const API = {};
  // Every version a persisted or hashed record can carry. `visual` is the DR-14 visualVersion; `mapping`
  // is hashed into every mapping id (bumping it changes every id); `appearance` is the palette version.
  const VERSION = Object.freeze({
    schema: 1,
    visual: 2,
    mapping: 1,
    appearance: 2,
    readout: 1,
    legend: 1,
    codec: 1,
  });
  // Application budgets, enforced on read AND write (D9, DR-14). They are budgets of this application,
  // not browser limits.
  const LIMITS = Object.freeze({
    ADDRESS_MAX: 8192,
    RANK_KNOTS: 257,
    PAYLOAD_MAX_BYTES: 1048576,
    DESCRIPTORS_MAX: 16,
    CONTEXTS_MAX: 64,
    RECORDS_PER_CONTEXT: 8,
    HISTORY_MAX: 50,
    STRING_MAX: 256,
    DEPTH_MAX: 8,
    TOMBSTONES_MAX: 64,
    HELD_MAX: 8,
    AXES_MAX: 21,
    MODELS_MAX: 4,
  });
  // Milliseconds. SETTLE_MS and AUTO_MS are D4's 200 ms and 500 ms; RETRY_MS is the safety-net poll a
  // pending calibration request uses while its reads are incoherent (DD-46).
  const TIMING = Object.freeze({
    SETTLE_MS: 200,
    AUTO_MS: 500,
    RETRY_MS: 200,
    PERSIST_DEBOUNCE_MS: 400,
    NOTICE_COALESCE_MS: 5000,
  });
  // Numeric thresholds of D2, D4 and D11. Comparison tolerances, never input rounding.
  const THRESHOLDS = Object.freeze({
    SHORT_EXPOSURE: 0.1,
    WARN_MARKS: 0.1,
    WARN_AREA: 0.25,
    LOW_DISC: 0.9,
    LUT_LOW_MAX: 12,
    LUT_HIGH_MIN: 243,
    TOL_REL: 1e-12,
    TOL_USDT: 1e-12,
    TOL_SECONDS: 1e-9,
    TOL_PATH: 1e-9,
  });
  // The recorded lattice of this cube: base column seconds, base row USDT, and the history origin
  // (2021-01-01T00:00:00Z in epoch seconds). The page passes PACK.base_seconds / base_price / t0.
  const LATTICE = Object.freeze({ BASE: 56.25, PR: 125, T0: 1609459200 });
  API.VERSION = VERSION;
  API.LIMITS = LIMITS;
  API.TIMING = TIMING;
  API.THRESHOLDS = THRESHOLDS;
  API.LATTICE = LATTICE;

  // == §01-util ==
  // @part 01-util
  // @requires
  // @prefix util
  // @provides util time
  // == §01 util and time: the small numeric routines every other part shares (API.md A.3, DD-58) ==
  // Pure functions only. Nothing here reads a clock: even the UTC day key is computed from the calendar
  // arithmetic below instead of `new Date`, so this part needs no purity exception and a test can pin
  // every value without a fake clock.

  // E.util.clamp (API.md A.3): x limited to [lo, hi]; lo <= hi is the caller's business. NaN is returned
  // as NaN on purpose: a clamp must never turn "not a number" into a plausible boundary value, the typed
  // results (B.1) are where non-finite input is named.
  function utilClamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  // E.util.quantile7 (API.md A.3, C.3, C.4, DD-10): the Type-7 quantile of an ascending array, h = (N-1)p.
  // The arithmetic is written exactly as d3.quantileSorted writes it (value0 + (value1 - value0) * frac),
  // so the two agree to the last bit and the test can use d3 as the independent oracle. p outside
  // [0,1] clamps to the extremes; an empty array has no quantile and answers NaN (callers branch on the
  // count first: an empty cohort is "No calibration", never a number).
  function utilQuantile7(sortedAsc, p) {
    const n = sortedAsc.length;
    if (!(n > 0) || p !== p) return NaN;
    if (p <= 0 || n < 2) return +sortedAsc[0];
    if (p >= 1) return +sortedAsc[n - 1];
    const h = (n - 1) * p;
    const i = Math.floor(h);
    const v0 = +sortedAsc[i];
    const v1 = +sortedAsc[i + 1];
    return v0 + (v1 - v0) * (h - i);
  }

  // E.util.median7 (API.md A.3): the Type-7 median, which for an even count is the midpoint of the two
  // middle values. One routine for U, k and the rank knots keeps "median" identical everywhere (DD-10).
  function utilMedian7(sortedAsc) {
    return utilQuantile7(sortedAsc, 0.5);
  }

  // E.util.lowerBound (API.md A.3): the first index whose value is >= x (the length when none is). Works
  // on any ascending indexable, typed arrays included. A NaN probe compares false against everything and
  // answers 0; callers exclude non-finite values before they search.
  function utilLowerBound(sortedAsc, x) {
    let lo = 0;
    let hi = sortedAsc.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedAsc[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // E.util.upperBound (API.md A.3): the first index whose value is > x. lowerBound and upperBound
  // together delimit the run of values equal to x, which is how the rank transform finds a tie group.
  function utilUpperBound(sortedAsc, x) {
    let lo = 0;
    let hi = sortedAsc.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedAsc[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // E.time.baseToMs (API.md A.3): epoch milliseconds of a base-column position, T0 seconds plus base
  // columns of BASE seconds each. The page passes PACK.t0 and PACK.base_seconds; the defaults are this
  // cube's recorded lattice (header LATTICE). Rounded to a whole millisecond so the value is usable as an
  // integer key. Non-finite input propagates as NaN (a conversion cannot invent a moment).
  function utilBaseToMs(base, T0 = LATTICE.T0, BASE = LATTICE.BASE) {
    return Math.round((T0 + base * BASE) * 1000);
  }

  // E.time.msToBase (API.md A.3): the inverse, a (fractional) base-column position. Not rounded: a
  // cutoff inside a column is a real position and the callers decide whether to floor it.
  function utilMsToBase(ms, T0 = LATTICE.T0, BASE = LATTICE.BASE) {
    return (ms / 1000 - T0) / BASE;
  }

  // E.time.utcDay (API.md A.3): "YYYY-MM-DD" of the UTC day that contains ms. The per-day pins, the
  // provenance date and the daily cache keys all use it. Days are counted from 1970-01-01 (floor, so
  // times before the epoch land on the right day) and turned into a civil date with the era arithmetic
  // of H. Hinnant's "days from civil" algorithm, which is exact for the proleptic Gregorian calendar.
  // A non-finite input or a year outside 0000..9999 has no four-digit key and throws.
  function utilUtcDay(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) throw new TypeError("utcDay needs a finite number of milliseconds");
    const days = Math.floor(ms / 86400000);
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    if (year < 0 || year > 9999) throw new RangeError("utcDay: year " + year + " has no four-digit key");
    const two = (v) => (v < 10 ? "0" : "") + v;
    return String(year + 10000).slice(1) + "-" + two(month) + "-" + two(day);
  }

  API.util = Object.freeze({
    clamp: utilClamp,
    quantile7: utilQuantile7,
    median7: utilMedian7,
    lowerBound: utilLowerBound,
    upperBound: utilUpperBound,
  });
  API.time = Object.freeze({
    baseToMs: utilBaseToMs,
    msToBase: utilMsToBase,
    utcDay: utilUtcDay,
  });

  // == §02-hash ==
  // @part 02-hash
  // @requires
  // @prefix hash
  // @provides hash
  // == §02 hash: SHA-256, canonical JSON, mapping ids, base64url, UTF-8 and float64 packing (API.md A.3, C.7) ==
  // Everything is synchronous and platform-free: no TextEncoder, no btoa, no subtle-crypto call (that one is
  // asynchronous and secure-context only), so the same bytes come out in the page and in a bare Node vm
  // context. DR-03: a mapping id is the first 96 bits of a SHA-256 over canonical JSON.

  // FIPS 180-4 round constants (the first 32 bits of the fractional parts of the cube roots of the first
  // 64 primes). A frozen plain array: a frozen table is not module state (DD-02), a typed array cannot be
  // frozen.
  const hashK = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const hashB64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const hashHexDigits = "0123456789abcdef";
  // Character code -> 6-bit value, -1 for every character outside the base64url alphabet (padding "=" and
  // the standard-base64 "+" and "/" are deliberately outside it).
  const hashB64Reverse = hashMakeReverse();
  // Recursion guard of canonical(): a record deeper than this (or cyclic) is a bug, not an id input.
  const hashDepthMax = 64;

  function hashMakeReverse() {
    const table = [];
    for (let i = 0; i < 128; i++) table.push(-1);
    for (let i = 0; i < hashB64Alphabet.length; i++) table[hashB64Alphabet.charCodeAt(i)] = i;
    return Object.freeze(table);
  }

  // One 64-byte block of the compression function. h (8 words) and w (64 words) are scratch owned by the
  // caller so a hash of a large input allocates nothing per block. Words stay signed 32-bit (|0), the
  // rotations use the unsigned shift for the bits that wrap.
  function hashBlock(h, w, m, off) {
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      w[t] = (m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let t = 0; t < 64; t++) {
      const big1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + big1 + ch + hashK[t] + w[t]) | 0;
      const big0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (big0 + maj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }

  // E.hash.sha256 (API.md A.3): the 32-byte digest of a Uint8Array (any indexable of bytes with a length).
  // Whole blocks are read in place from the input; only the last one or two padded blocks are copied.
  function hashSha256(bytes) {
    if (bytes === null || typeof bytes !== "object" || typeof bytes.length !== "number") throw new TypeError("sha256 needs a Uint8Array");
    const len = bytes.length;
    const h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Int32Array(64);
    const full = len - (len % 64);
    for (let off = 0; off < full; off += 64) hashBlock(h, w, bytes, off);
    const rest = len - full;
    // Padding: 0x80, zeros, then the message length in bits as a 64-bit big-endian number. The length is
    // split without leaving double precision: len*8 = hi * 2^32 + lo with hi = floor(len / 2^29).
    const tail = new Uint8Array(rest < 56 ? 64 : 128);
    for (let i = 0; i < rest; i++) tail[i] = bytes[full + i];
    tail[rest] = 0x80;
    const hi = Math.floor(len / 536870912);
    const lo = (len % 536870912) * 8;
    const end = tail.length;
    tail[end - 8] = (hi >>> 24) & 255; tail[end - 7] = (hi >>> 16) & 255; tail[end - 6] = (hi >>> 8) & 255; tail[end - 5] = hi & 255;
    tail[end - 4] = (lo >>> 24) & 255; tail[end - 3] = (lo >>> 16) & 255; tail[end - 2] = (lo >>> 8) & 255; tail[end - 1] = lo & 255;
    hashBlock(h, w, tail, 0);
    if (end === 128) hashBlock(h, w, tail, 64);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = (h[i] >>> 24) & 255; out[i * 4 + 1] = (h[i] >>> 16) & 255; out[i * 4 + 2] = (h[i] >>> 8) & 255; out[i * 4 + 3] = h[i] & 255;
    }
    return out;
  }

  // E.hash.canonical (API.md A.3, C.7): the canonical JSON text that a mapping id hashes. Keys sorted by
  // UTF-16 code unit, no whitespace, numbers as JavaScript's shortest round-trip decimal (which the
  // language specifies, so every engine agrees) with -0 written "0". It THROWS instead of guessing: a
  // non-finite number, undefined, a function, a symbol, a bigint, an array hole or a non-plain object
  // (Map, Set, Date, typed array) has no canonical form, and an id computed over a silently dropped field
  // would collide with the id of a different mapping.
  function hashCanonical(value) {
    return hashCanon(value, 0);
  }

  function hashCanon(v, depth) {
    if (v === null) return "null";
    const type = typeof v;
    if (type === "boolean") return v ? "true" : "false";
    if (type === "string") return JSON.stringify(v);
    if (type === "number") {
      if (!Number.isFinite(v)) throw new RangeError("canonical: non-finite number");
      return Object.is(v, -0) ? "0" : String(v);
    }
    if (type !== "object") throw new TypeError("canonical: cannot serialise a " + type);
    if (depth >= hashDepthMax) throw new RangeError("canonical: nesting deeper than " + hashDepthMax + " (or cyclic)");
    if (Array.isArray(v)) {
      const items = [];
      for (let i = 0; i < v.length; i++) items.push(hashCanon(v[i], depth + 1));
      return "[" + items.join(",") + "]";
    }
    // The tag test (not a prototype comparison) also accepts objects made in another realm, such as a
    // test's literals handed to a module evaluated in a vm context.
    if (Object.prototype.toString.call(v) !== "[object Object]") throw new TypeError("canonical: cannot serialise " + Object.prototype.toString.call(v));
    const keys = Object.keys(v).sort();
    const members = [];
    for (let i = 0; i < keys.length; i++) members.push(JSON.stringify(keys[i]) + ":" + hashCanon(v[keys[i]], depth + 1));
    return "{" + members.join(",") + "}";
  }

  // E.hash.utf8 (API.md A.3): the UTF-8 bytes of a string, as TextEncoder writes them (a lone surrogate
  // becomes U+FFFD, so the output is always valid UTF-8).
  function hashUtf8(s) {
    const out = new Uint8Array(s.length * 3);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out[n++] = c;
      else if (c < 0x800) { out[n++] = 0xc0 | (c >> 6); out[n++] = 0x80 | (c & 63); }
      else if (c < 0x10000) { out[n++] = 0xe0 | (c >> 12); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
      else { out[n++] = 0xf0 | (c >> 18); out[n++] = 0x80 | ((c >> 12) & 63); out[n++] = 0x80 | ((c >> 6) & 63); out[n++] = 0x80 | (c & 63); }
    }
    return out.slice(0, n);
  }

  // E.hash.fromUtf8 (API.md A.3): the string of UTF-8 bytes, with FATAL decoding: a stray or missing
  // continuation byte, an overlong form, an encoded surrogate, a code point above U+10FFFF or a truncated
  // sequence throws a TypeError naming the byte offset. An imported payload that is not valid UTF-8 is
  // rejected whole, never repaired. A leading byte-order mark is kept (it is a character).
  function hashFromUtf8(bytes) {
    const units = [];
    let text = "";
    const n = bytes.length;
    let i = 0;
    while (i < n) {
      const b = bytes[i];
      let cp, need, min;
      if (b < 0x80) { cp = b; need = 0; min = 0; }
      else if (b >= 0xc2 && b <= 0xdf) { cp = b & 0x1f; need = 1; min = 0x80; }
      else if (b >= 0xe0 && b <= 0xef) { cp = b & 0x0f; need = 2; min = 0x800; }
      else if (b >= 0xf0 && b <= 0xf4) { cp = b & 0x07; need = 3; min = 0x10000; }
      else throw new TypeError("invalid UTF-8 at byte " + i);
      if (need > 0 && i + need >= n) throw new TypeError("truncated UTF-8 at byte " + i);
      for (let j = 1; j <= need; j++) {
        const c = bytes[i + j];
        if ((c & 0xc0) !== 0x80) throw new TypeError("invalid UTF-8 at byte " + (i + j));
        cp = (cp << 6) | (c & 63);
      }
      if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new TypeError("invalid UTF-8 at byte " + i);
      i += need + 1;
      if (cp >= 0x10000) {
        cp -= 0x10000;
        units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else units.push(cp);
      if (units.length >= 4096) {
        text += String.fromCharCode.apply(null, units);
        units.length = 0;
      }
    }
    return text + String.fromCharCode.apply(null, units);
  }

  // E.hash.b64urlEncode (API.md A.3): unpadded URL-safe base64 (RFC 4648 section 5). The alphabet is
  // [A-Za-z0-9_-], so the text can sit in an address without percent-escaping.
  function hashB64Encode(u8) {
    const n = u8.length;
    const chunks = [];
    let part = "";
    let i = 0;
    for (; i + 2 < n; i += 3) {
      const v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      part += hashB64Alphabet[v >> 18] + hashB64Alphabet[(v >> 12) & 63] + hashB64Alphabet[(v >> 6) & 63] + hashB64Alphabet[v & 63];
      if (part.length >= 4096) { chunks.push(part); part = ""; }
    }
    if (n - i === 1) {
      const v = u8[i] << 16;
      part += hashB64Alphabet[v >> 18] + hashB64Alphabet[(v >> 12) & 63];
    } else if (n - i === 2) {
      const v = (u8[i] << 16) | (u8[i + 1] << 8);
      part += hashB64Alphabet[v >> 18] + hashB64Alphabet[(v >> 12) & 63] + hashB64Alphabet[(v >> 6) & 63];
    }
    chunks.push(part);
    return chunks.join("");
  }

  // E.hash.b64urlDecode (API.md A.3): the bytes of unpadded base64url, or null when the text is not
  // exactly what b64urlEncode writes: any character outside the alphabet (padding included), a length that
  // no byte count produces (4k+1), or non-zero unused trailing bits (a second spelling of the same bytes
  // would let two different addresses carry one payload).
  function hashB64Decode(s) {
    if (typeof s !== "string") return null;
    const n = s.length;
    const rem = n % 4;
    if (rem === 1) return null;
    const out = new Uint8Array(Math.floor((n * 3) / 4));
    let o = 0;
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i);
      const v = c < 128 ? hashB64Reverse[c] : -1;
      if (v < 0) return null;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 255;
        acc &= (1 << bits) - 1;
      }
    }
    if (acc !== 0) return null;
    return out;
  }

  // E.hash.hex (API.md A.3): lowercase hex of the first n bytes (all of them by default). The appearance
  // hash and the LUT screens quote short prefixes such as the eight digits of "slate2-8f7890f7".
  function hashHex(u8, n) {
    const count = n === undefined ? u8.length : Math.max(0, Math.min(n, u8.length));
    let out = "";
    for (let i = 0; i < count; i++) out += hashHexDigits[u8[i] >> 4] + hashHexDigits[u8[i] & 15];
    return out;
  }

  // E.hash.id96 (API.md A.3, C.7, DR-03): the 96-bit id of any JSON-safe value, 16 base64url characters of
  // the first 12 bytes of SHA-256(UTF-8(canonical(value))). The value is canonicalised HERE, so callers
  // pass the record (for a mapping: {v, kind, signed, params, clip}), never its text.
  function hashId96(value) {
    return hashB64Encode(hashSha256(hashUtf8(hashCanonical(value))).subarray(0, 12));
  }

  // E.hash.f64ToB64 (API.md A.3, S1-079): big-endian IEEE-754 doubles packed through a DataView, then
  // base64url. 257 rank knots are 2056 bytes, 2742 characters. Bit exact, and a non-finite value is a
  // caller bug (a scale must never carry one) so it throws.
  function hashF64ToB64(values) {
    const n = values.length;
    const view = new DataView(new ArrayBuffer(n * 8));
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new RangeError("f64ToB64: value " + i + " is not a finite number");
      view.setFloat64(i * 8, v, false);
    }
    return hashB64Encode(new Uint8Array(view.buffer));
  }

  // E.hash.b64ToF64 (API.md A.3): the inverse. Answers null (the way b64urlDecode does) for text that is
  // not base64url, whose byte length is not 8*count, or that decodes to any non-finite double: an import
  // is validated as a whole and a bad knot table drops the descriptor, so it must be a value the caller
  // can test, not an exception that escapes an unguarded path. A count that is not a non-negative
  // integer is a caller bug and throws.
  function hashB64ToF64(s, count) {
    if (!Number.isInteger(count) || count < 0) throw new TypeError("b64ToF64 needs a non-negative integer count");
    const bytes = hashB64Decode(s);
    if (bytes === null || bytes.length !== count * 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const v = view.getFloat64(i * 8, false);
      if (!Number.isFinite(v)) return null;
      out[i] = v;
    }
    return out;
  }

  API.hash = Object.freeze({
    sha256: hashSha256,
    canonical: hashCanonical,
    id96: hashId96,
    b64urlEncode: hashB64Encode,
    b64urlDecode: hashB64Decode,
    hex: hashHex,
    utf8: hashUtf8,
    fromUtf8: hashFromUtf8,
    f64ToB64: hashF64ToB64,
    b64ToF64: hashB64ToF64,
  });

  // == §03-result ==
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
  // an object {short, long} of two templates. A value that is not a Typed of a known tag is described
  // as the invalid-input it is (reason "unknown-tag"). (The tag must be tested as a string: a missing tag
  // would otherwise be looked up as the key "undefined", which is a real tag.)
  function resDescribe(typed, fmt) {
    const text = API.text;
    if (!text || !text.typed || typeof text.fill !== "function") throw new Error("E.result.describe needs part 04-text (E.text.typed and E.text.fill)");
    let t = typed;
    if (t === null || typeof t !== "object" || typeof t.tag !== "string" || !Object.prototype.hasOwnProperty.call(resTagIndex, t.tag)) t = { tag: "invalid-input", reason: "unknown-tag" };
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

  // == §04-text ==
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

  // E.text.fill (API.md A.3, DD-02, DD-91, DR-41): the production substitution. It is STATELESS and it NEVER
  // throws: the page must not lose a tooltip because a caller forgot a parameter. A missing name leaves its
  // literal `{name}` visible in the text, which is the whole report (an earlier version also warned once
  // per name through a module-level Set; that was the only mutable state in the module, it made two loads
  // differ by what they had already said, and a visible `{name}` is easier to find than a console line).
  // A template that is not a string answers "" (a caller bug, not a reason to fail a draw); a value that
  // cannot be turned into text (an object without toString) leaves the template as it was.
  function txtFill(template, params) {
    try {
      if (typeof template !== "string") return "";
      return txtSubstitute(template, params, []);
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
      // DR-41: the signed zero tick of a column bar ("Zero", where the unsigned outline of key.zero says
      // "Zero (occupied)") and the key of a parent that runs past the data ("Open").
      zeroTick: "Zero",
      open: "Open",
    },
    // DR-41: the 24 strings of the mark-role table (E.role.ROLES, B.9). `role.<camelId>` is the short label
    // of a role (a key's name, a swatch caption) and `role.<camelId>Name` its accessible name, the sentence
    // a screen reader hears where the swatch is the only carrier of the meaning (S1-160). The three
    // reserved rows belong to S2 and S3; their strings exist so the table is complete and never reassigned.
    role: {
      unsigned: "Magnitude",
      unsignedName: "Magnitude fill, from the lowest to the highest value of the scale",
      positive: "Positive",
      positiveName: "Positive arm, from the midpoint toward the largest positive value",
      negative: "Negative",
      negativeName: "Negative arm, from the midpoint toward the largest negative value",
      midpoint: "Midpoint",
      midpointName: "Midpoint: zero, or an even split between the two sides",
      occupancy: "Occupied",
      occupancyName: "Occupancy outline: the cell has data and no magnitude is shown",
      zeroOutline: "Zero",
      zeroOutlineName: "Zero outline: the cell was measured and is exactly zero",
      unsignedBar: "Bar",
      unsignedBarName: "Constant bar fill for an unsigned column or profile length",
      stateInk: "State",
      stateInkName: "State ink of the patterns and glyphs that mark a value that is not a number",
      rowsProjection: "Rows band",
      rowsProjectionName: "Contextual price-row band at a fixed low opacity",
      familyReference: "Family reference",
      familyReferenceName: "Reserved for family reference marks",
      interaction: "Interaction",
      interactionName: "Reserved for hover and selection marks",
      regionReplacement: "Region replacement",
      regionReplacementName: "Reserved for marks of a replaced region",
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

  // == §05-measure ==
  // @part 05-measure
  // @requires 01-util 03-result
  // @prefix msr
  // @provides measure
  // == §05 measure: what a cell, a column and an exposure measure (API.md B.3, B.4, C.1.1 to C.1.6) ==
  // Physical measurements only. A value leaves this part as a number in the unit the formula names (USDT,
  // trades, USDT per minute per 125-USDT band, row spans, seconds share, ...) or as a typed reason why there
  // is none (B.1). The scale coordinate and the colour are a later, separate step (S1-009): nothing here
  // knows a palette, a mapping or a theme.

  // Tag indexes of E.result.TAGS (part 03), captured at load time (03-result is in @requires) so the
  // per-cell kernel writes a small integer and never looks a tag up by name.
  const msrTag = API.result.TAG;
  const msrFinite = msrTag["finite"];
  const msrUndefined = msrTag["undefined"];
  const msrEmptyPop = msrTag["empty-population"];
  const msrHidden = msrTag["hidden"];
  const msrPending = msrTag["pending"];
  const msrFailed = msrTag["failed"];
  const msrUnsupported = msrTag["unsupported"];
  const msrInvalid = msrTag["invalid-input"];
  // D2 / DR-10: below this fraction of the nominal span a cell carries the Short exposure cue.
  const msrShortAt = THRESHOLDS.SHORT_EXPOSURE;
  // Intensity is a rate per MINUTE per 125-USDT band (D2). 125 is part of the unit's NAME, not the lattice:
  // the unit id "usdt-per-min-per-125usdt" would be a lie for any other band width, so it is not read from
  // the geometry the page hands in.
  const msrPerMinute = 60;
  const msrBandUsdt = 125;

  // Which exposure denominators a measure divides by (C.1.3, DD-70). Shared frozen objects: usesOf runs
  // per cell and must not allocate.
  const msrUsesNone = Object.freeze({ t: false, w: false });
  const msrUsesT = Object.freeze({ t: true, w: false });
  const msrUsesW = Object.freeze({ t: false, w: true });
  const msrUsesBoth = Object.freeze({ t: true, w: true });

  // ---- catalogues (B.3) -------------------------------------------------------------------------------

  function msrFormula(family, unit, signed, basisKind, version) {
    return Object.freeze({ family, unit, signed, basisKind, version });
  }

  // E.measure.FORMULAS (B.3, DD-06). `family` is what Comparison lock compares (A-18); it is null for the
  // measures whose transfer function is a fixed, absolute coordinate (shares, log ratios): there is nothing
  // to hold for them, the domain is part of the definition. The pane measures are bar lengths on their own
  // registered axes, not colour mappings, so they have no family either.
  const msrFormulas = Object.freeze({
    "cells.volume.amount@1": msrFormula("amount.usdt", "usdt", false, "amount", 1),
    "cells.trades.amount@1": msrFormula("amount.trades", "trades", false, "amount", 1),
    "cells.delta.amount@1": msrFormula("delta.usdt", "usdt", true, "amount", 1),
    "cells.volume.intensity@1": msrFormula("intensity.usdt", "usdt-per-min-per-125usdt", false, "intensity", 1),
    "cells.trades.intensity@1": msrFormula("intensity.trades", "trades-per-min-per-125usdt", false, "intensity", 1),
    "cells.delta.intensity@1": msrFormula("intensity.delta", "usdt-per-min-per-125usdt", true, "intensity", 1),
    "cells.size.mean@1": msrFormula("size.usdt-per-trade", "usdt-per-trade", false, "mean", 1),
    "cells.path.spans@1": msrFormula("path.spans", "row-spans", false, "row-spans", 1),
    "cells.path.usdt@1": msrFormula("path.usdt", "usdt", false, "usdt-moved", 1),
    "cells.path.perminute@1": msrFormula("path.perminute", "row-spans-per-min", false, "row-spans-per-min", 1),
    "cells.dwell.share@1": msrFormula(null, "share", false, "share", 1),
    "cells.flow.share@1": msrFormula(null, "share", true, "share", 1),
    "cells.flowtrades.share@1": msrFormula(null, "share", true, "share", 1),
    "cells.cascade.log2@1": msrFormula(null, "log2-ratio", true, "log2-ratio", 1),
    "rows.volume.amount@1": msrFormula("amount.usdt", "usdt", false, "period-amount-per-row", 1),
    "rows.delta.amount@1": msrFormula("delta.usdt", "usdt", true, "period-amount-per-row", 1),
    "rows.time.seconds@1": msrFormula("time.seconds", "seconds", false, "period-amount-per-row", 1),
    // The one formula that is at version 2: the spec names v2, v1 is the retired baseline behaviour (DD-06).
    "rows.relvol@2": msrFormula(null, "log2-ratio", true, "log2-ratio", 2),
    "columns.volume@1": msrFormula(null, "usdt", false, "amount", 1),
    "columns.delta@1": msrFormula(null, "usdt", true, "amount", 1),
    "columns.takertrades@1": msrFormula(null, "trades", true, "amount", 1),
    "columns.trades@1": msrFormula(null, "trades", false, "amount", 1),
    "columns.size@1": msrFormula(null, "usdt-per-trade", false, "mean", 1),
    "columns.choppiness@1": msrFormula(null, "path-per-range", false, "ratio", 1),
    "columns.perpath@1": msrFormula(null, "usdt-per-usdt-moved", false, "ratio", 1),
    "columns.cascade@1": msrFormula(null, "log2-ratio", true, "ratio", 1),
    "columns.efficiency@1": msrFormula(null, "log2-ratio", true, "ratio", 1),
    "osc.rsi14@1": msrFormula(null, "index", false, "oscillator", 1),
    "osc.macd@1": msrFormula(null, "usdt", true, "oscillator", 1),
  });

  function msrMode(kind, signed, bases, rank, fixed) {
    return Object.freeze({ kind, signed, bases: Object.freeze(bases), rank, fixed: fixed === null ? null : Object.freeze(fixed) });
  }

  // E.measure.MODES (B.3): what each S.mode is and which controls it can meaningfully offer. `signed` is
  // true for the measures drawn on two arms about a midpoint (Delta, both taker shares, Cascade). `fixed`
  // names the absolute descriptor of a fixed measure in the vocabulary of E.scale.fixed (C.5).
  const msrModes = Object.freeze({
    volume: msrMode("unbounded", false, ["amount", "intensity"], true, null),
    trades: msrMode("unbounded", false, ["amount", "intensity"], true, null),
    delta: msrMode("unbounded", true, ["amount", "intensity"], false, null),
    size: msrMode("unbounded", false, ["mean"], true, null),
    path: msrMode("unbounded", false, ["spans", "usdt", "perMinute"], true, null),
    flow: msrMode("fixed", true, ["share"], false, { kind: "share-diverging", lo: 0, hi: 1, mid: 0.5 }),
    flowtrades: msrMode("fixed", true, ["share"], false, { kind: "share-diverging", lo: 0, hi: 1, mid: 0.5 }),
    dwell: msrMode("fixed", false, ["share"], false, { kind: "unsigned-share", lo: 0, hi: 1 }),
    cascade: msrMode("fixed", true, ["log2"], false, { kind: "log2-ratio", lo: -2, hi: 2, mid: 0 }),
    geometry: msrMode("occupancy", false, [], false, null),
  });

  // E.measure.ROWS (DD-73): the Rows measures, so the menu and E.policy.offers("rows", ...) hard-code
  // nothing. Relative volume is fixed and diverging; Delta has no rank (signed).
  const msrRows = Object.freeze({
    volume: Object.freeze({ kind: "unbounded", signed: false, rank: true, formula: "rows.volume.amount@1", fixed: null }),
    delta: Object.freeze({ kind: "unbounded", signed: true, rank: false, formula: "rows.delta.amount@1", fixed: null }),
    time: Object.freeze({ kind: "unbounded", signed: false, rank: true, formula: "rows.time.seconds@1", fixed: null }),
    relvol: Object.freeze({
      kind: "fixed",
      signed: true,
      rank: false,
      formula: "rows.relvol@2",
      fixed: Object.freeze({ kind: "log2-ratio", lo: -2, hi: 2, mid: 0 }),
    }),
  });

  // The formula id of a (mode, basis) pair. Path takes its variant from `pathBasis`, the amount measures
  // from `basis`; every other mode has one formula.
  const msrCellFormulas = Object.freeze({
    "volume|amount": "cells.volume.amount@1",
    "volume|intensity": "cells.volume.intensity@1",
    "trades|amount": "cells.trades.amount@1",
    "trades|intensity": "cells.trades.intensity@1",
    "delta|amount": "cells.delta.amount@1",
    "delta|intensity": "cells.delta.intensity@1",
    "size|mean": "cells.size.mean@1",
    "path|spans": "cells.path.spans@1",
    "path|usdt": "cells.path.usdt@1",
    "path|perMinute": "cells.path.perminute@1",
    "dwell|share": "cells.dwell.share@1",
    "flow|share": "cells.flow.share@1",
    "flowtrades|share": "cells.flowtrades.share@1",
    "cascade|log2": "cells.cascade.log2@1",
  });

  // The basis a kernel evaluates: Path variants live in pathBasis, the amount measures in basis (anything
  // but "intensity" reads as Amount, so a stale preference from another measure cannot break a cell), the
  // single-basis measures have no choice.
  function msrBasisOf(mode, basis, pathBasis) {
    if (mode === "path") return pathBasis === "usdt" || pathBasis === "perMinute" ? pathBasis : "spans";
    if (mode === "volume" || mode === "trades" || mode === "delta") return basis === "intensity" ? "intensity" : "amount";
    if (mode === "size") return "mean";
    if (mode === "dwell" || mode === "flow" || mode === "flowtrades") return "share";
    if (mode === "cascade") return "log2";
    return null;
  }

  // ---- tolerance helpers (C.1.1, DD-36) ---------------------------------------------------------------
  // For comparing two measurements of the same thing (tests, equivalence checks). They are never applied
  // to an input: a value is stored and drawn exactly as measured.

  function msrEpsUsdt(x) {
    return THRESHOLDS.TOL_REL * Math.abs(x) + THRESHOLDS.TOL_USDT;
  }

  function msrEpsPath(x) {
    return THRESHOLDS.TOL_REL * Math.abs(x) + THRESHOLDS.TOL_PATH;
  }

  function msrEpsSeconds(x) {
    return THRESHOLDS.TOL_REL * Math.abs(x) + THRESHOLDS.TOL_SECONDS;
  }

  function msrCloseUsdt(a, b) {
    return Math.abs(a - b) <= THRESHOLDS.TOL_REL * Math.max(Math.abs(a), Math.abs(b)) + THRESHOLDS.TOL_USDT;
  }

  function msrClosePath(a, b) {
    return Math.abs(a - b) <= THRESHOLDS.TOL_REL * Math.max(Math.abs(a), Math.abs(b)) + THRESHOLDS.TOL_PATH;
  }

  function msrCloseSeconds(a, b) {
    return Math.abs(a - b) <= THRESHOLDS.TOL_REL * Math.max(Math.abs(a), Math.abs(b)) + THRESHOLDS.TOL_SECONDS;
  }

  // The error bound that Delta = 2*bv - v inherits from its two inputs (A-35). A near-balanced cell is a
  // cancellation: the relative error of the result is unbounded, the absolute error is not, so Delta is
  // compared against THIS bound and never with a relative tolerance on the (nearly zero) result.
  function msrDeltaEps(bv, v) {
    return 2 * msrEpsUsdt(bv) + msrEpsUsdt(v);
  }

  // The same for log2(v / V): the relative errors of the two amounts, in log2 units.
  function msrLog2Eps(v, V) {
    return (msrEpsUsdt(v) / v + msrEpsUsdt(V) / V) / Math.LN2;
  }

  // close.delta(a, b, bv, v): are two Delta values within the bound propagated from the inputs (bv, v) of
  // the reference record? close.log2(a, b, v, V): the same for a log2 ratio of two amounts.
  const msrClose = Object.freeze({
    usdt: msrCloseUsdt,
    path: msrClosePath,
    seconds: msrCloseSeconds,
    delta: (a, b, bv, v) => Math.abs(a - b) <= msrDeltaEps(bv, v),
    log2: (a, b, v, V) => Math.abs(a - b) <= msrLog2Eps(v, V),
    epsUsdt: msrEpsUsdt,
    epsPath: msrEpsPath,
    epsSeconds: msrEpsSeconds,
    deltaEps: msrDeltaEps,
    log2Eps: msrLog2Eps,
  });

  // ---- exposure (C.1.3, B.4) --------------------------------------------------------------------------

  function msrNewExposure() {
    return {
      seconds: 0,
      width: 0,
      timeFraction: 1,
      priceFraction: 1,
      nominalSeconds: 0,
      nominalWidth: 0,
      short: false,
      uses: msrUsesNone,
      coverage: "range",
      coveredTo: null,
    };
  }

  // E.measure.exposure (API.md C.1.3): the part of a cell that was actually observed. `b` = [t0, t1, r0, r1]
  // in base units (the measured rectangle), `cut` the activeCutoff in base units, `end` the last column a
  // motion measure covers (Infinity for the volume measures), `ts`/`ps` the EFFECTIVE step of the drawn
  // level in base units (2**n, 2**m), `geom` = {BASE, PR}. Time is clipped to the rectangle, the cutoff and
  // the motion end; price to the rectangle. The two fractions are taken in base units (covered / step)
  // rather than as seconds over nominal seconds: a step is a power of two, so the division is exact and a
  // covered span of 1.6 base columns on a 16-column cell is exactly 0.1, never 0.09999999999999999 through
  // the detour over BASE. `short` and `uses` describe a MEASURE, not a cell, and are set by cellValue and
  // cellMeasurement; this function leaves them neutral (false, no denominators). Reuses `out` when given
  // (no allocation), which is what the per-cell kernel does.
  function msrExposure(z, b, cut, end, ts, ps, geom, out) {
    const g = geom || LATTICE;
    const o = out || msrNewExposure();
    const dt = Math.max(0, Math.min((z.c + 1) * ts, b[1], cut, end) - Math.max(z.c * ts, b[0]));
    const dp = Math.max(0, Math.min((z.r + 1) * ps, b[3]) - Math.max(z.r * ps, b[2]));
    o.seconds = dt * g.BASE;
    o.width = dp * g.PR;
    o.nominalSeconds = ts * g.BASE;
    o.nominalWidth = ps * g.PR;
    o.timeFraction = dt / ts;
    o.priceFraction = dp / ps;
    o.short = false;
    o.uses = msrUsesNone;
    o.coverage = "range";
    o.coveredTo = end === Infinity ? null : "end";
    return o;
  }

  // E.measure.usesOf (API.md C.1.3, DD-70): does a measure divide by covered time (t), by measured price
  // width (w), by neither? Its only job is to say WHETHER the Short exposure label applies to the measure
  // at all ("any measure with an exposure denominator", DR-10): Intensity {t,w}, Path spans {w}, Path per
  // minute {t,w}, Dwell {t}; Path USDT and every Amount never carry the label. `basis` is the amount basis
  // for volume, trades and delta and the Path variant for path.
  function msrUsesOf(measureKey, basis) {
    if (measureKey === "volume" || measureKey === "trades" || measureKey === "delta") return basis === "intensity" ? msrUsesBoth : msrUsesNone;
    if (measureKey === "path") return basis === "perMinute" ? msrUsesBoth : basis === "usdt" ? msrUsesNone : msrUsesW;
    if (measureKey === "dwell") return msrUsesT;
    return msrUsesNone;
  }

  // E.measure.isShort (API.md C.1.3, DD-70): strictly below 10% of the nominal span on EITHER fraction, for a
  // measure that has an exposure denominator at all. A Dwell cell with a full time fraction and a price
  // fraction of 0.05 IS short: DR-10 says "on either", and the first design that tested only the fractions
  // a measure "used" silently narrowed it.
  function msrIsShort(exposure, uses) {
    return (uses.t || uses.w) && (exposure.timeFraction < msrShortAt || exposure.priceFraction < msrShortAt);
  }

  // E.measure.cellState (API.md C.1.3): the one shared predicate for a cell's finality. `open`: the cell's
  // column runs past the live edge (never in replay, where the edge is a choice). `portion`: the cell sticks
  // out of the measured rectangle, so its value is that of a part. `partial`: portion, or it runs past the
  // cutoff. The baseline had this twice (cellState and querySummary) and the two could drift.
  function msrCellState(z, b, cut, CUT, replay, ts, ps) {
    const open = !replay && (z.c + 1) * ts > CUT;
    const portion = z.c * ts < b[0] || (z.c + 1) * ts > b[1] || z.r * ps < b[2] || (z.r + 1) * ps > b[3];
    return { open, portion, partial: portion || (z.c + 1) * ts > cut };
  }

  // ---- typed results without allocation (the hot path) ------------------------------------------------

  // A reason from a cube error message can be longer than a Typed allows (B.1); cut it here, off the hot
  // path, exactly as part 03 does. Rare: only a failed read carries a long string.
  function msrClipReason(s) {
    return s.length <= LIMITS.STRING_MAX ? s : s.slice(0, LIMITS.STRING_MAX - 3) + "...";
  }

  // Write a non-value into a caller-owned scratch object: an integer tag, the interned reason or
  // denominator (or null), and NaN for the value so a consumer that forgets to test the tag cannot draw a
  // plausible number (baseline gotcha: a NaN colour keeps the previous fillStyle; here that would at least
  // be visible in a test, where a silent 0 would not).
  function msrSetTyped(out, tag, reason, denominator) {
    out.tag = tag;
    out.value = NaN;
    out.reason = reason;
    out.denominator = denominator;
    return out;
  }

  // A measured number: finite -> a value; anything else -> invalid-input "non-finite", never clamped and
  // never a NaN fill (D2, DR-12).
  function msrSetValue(out, x) {
    if (Number.isFinite(x)) {
      out.tag = msrFinite;
      out.value = x;
      out.reason = null;
      out.denominator = null;
      return out;
    }
    return msrSetTyped(out, msrInvalid, "non-finite", null);
  }

  // Read and coverage status BEFORE mathematics (API.md C.1.2, DD-05), allocation-free. `read` is null once
  // every read the consumer needs has answered. Returns true when it wrote a result.
  function msrReadStatus(read, out) {
    if (!read) return false;
    const state = read.state;
    if (state === "failed") {
      msrSetTyped(out, msrFailed, typeof read.reason === "string" ? msrClipReason(read.reason) : "read failed", null);
      return true;
    }
    if (state === "pending") {
      msrSetTyped(out, msrPending, typeof read.reason === "string" ? read.reason : "reading", null);
      return true;
    }
    if (state === "unsupported") {
      msrSetTyped(out, msrUnsupported, typeof read.reason === "string" ? read.reason : "not supported", null);
      return true;
    }
    return false;
  }

  // The step of the drawn level in base units: given directly (k.ts, k.ps: what a frame that already holds
  // them passes) or as the level {n, m} of the frame spec (2**n columns, 2**m rows). A kernel that names
  // neither cannot say what a cell's nominal span is, so it is refused loudly rather than measured wrongly.
  function msrStep(k, key, letter) {
    if (k[key] !== undefined) return k[key];
    if (k.level) return Math.pow(2, k.level[letter]);
    throw new TypeError("the measure kernel needs level {n, m} (or the steps ts and ps)");
  }

  function msrTs(k) {
    return msrStep(k, "ts", "n");
  }

  function msrPs(k) {
    return msrStep(k, "ps", "m");
  }

  // Bounds, cutoff and motion end that a kernel leaves out mean "no limit" (an unbounded rectangle, no
  // cutoff, no motion end), never NaN.
  const msrUnbounded = Object.freeze([-Infinity, Infinity, -Infinity, Infinity]);

  // The kernel's exposure for the cell in `k.z`: covered seconds and measured width inside the rectangle,
  // the cutoff and (for the motion measures) the motion end. Fills and returns the kernel's ONE scratch
  // exposure object, created on first use.
  function msrKernelExposure(k, end) {
    const ex = k.exposure || (k.exposure = msrNewExposure());
    return msrExposure(k.z, k.bounds || msrUnbounded, k.cut === undefined ? Infinity : k.cut, end === undefined ? Infinity : end, msrTs(k), msrPs(k), k.geom, ex);
  }

  // ---- dwell validation (C.1.5) -----------------------------------------------------------------------

  function msrTol(x) {
    return THRESHOLDS.TOL_SECONDS + THRESHOLDS.TOL_REL * Math.abs(x);
  }

  // The reason a dwell is invalid, or null. A dwell inside the tolerance is NOT clamped: it passes
  // through unchanged, so the tolerance is a decision about validity and never a way to edit a value.
  function msrDwellReason(w, seconds) {
    if (!Number.isFinite(w) || !Number.isFinite(seconds)) return "non-finite";
    if (w < -msrTol(w)) return "negative-dwell";
    if (w > seconds + msrTol(seconds)) return "dwell-exceeds-covered";
    return null;
  }

  // E.measure.dwellCheck (API.md C.1.5, S1-036..038): invalid-input for a material negative dwell or one
  // that exceeds the covered time; null when the value may be used. Validation failure, never a clamp.
  function msrDwellCheck(w, seconds) {
    const reason = msrDwellReason(w, seconds);
    return reason === null ? null : API.result.make("invalid-input", { reason });
  }

  // E.measure.dwellResidual (API.md C.1.5): the time of a column that no shown row accounts for.
  // `rowsSum` is the dwell summed over ALL of the column's rows, or null when only the rectangle's rows are
  // known, which is the case for any single-cell reading: then the residual is "not measurable", never 0
  // and never 100%. Dwell is never renormalised to fill the column.
  function msrDwellResidual(colSeconds, rowsSum) {
    if (!Number.isFinite(colSeconds)) return API.result.make("invalid-input", { reason: "non-finite" });
    if (rowsSum === null || rowsSum === undefined) return { measurable: false, reason: "rectangle rows only" };
    if (!Number.isFinite(rowsSum)) return API.result.make("invalid-input", { reason: "non-finite" });
    if (colSeconds <= 0) return { measurable: false, reason: "no covered time" };
    const residual = colSeconds - rowsSum;
    if (residual < -msrTol(colSeconds)) return API.result.make("invalid-input", { reason: "dwell-exceeds-covered" });
    return { measurable: true, seconds: residual, share: residual / colSeconds };
  }

  // ---- the per-cell kernel (C.1.4) --------------------------------------------------------------------

  // E.measure.cellValue (API.md C.1.4, DD-17, DD-85): the physical value of ONE cell, written into the
  // caller's scratch `out` as {tag (index in E.result.TAGS; 0 = a value), value (NaN unless tag 0), signed,
  // short, reason, denominator}. Allocation-free: `k` is the frame's one mutable kernel that the encoder
  // re-points at each cell (k.z, k.bounds) instead of building a spec literal per cell.
  //   k = { mode, basis, pathBasis, z, bounds: [t0,t1,r0,r1], cut, end, CUT, replay, geom: {BASE, PR},
  //         level: {n, m} (or the steps ts, ps directly), read, measured, cascade, exposure }
  // `read` is null unless the DISPLAYED block itself cannot answer for the cell (DD-84); `measured(z)` is
  // false for a base cell not yet read or a motion cell at or after the motion end; `cascade(z, out)` fills
  // out.tag/value/reason/denominator from the level's Cascade entry (part 06 builds those). Evaluation order:
  // read status, replay-hidden, unmeasured, then the formula. The scale coordinate and the colour are NOT
  // applied here (S1-009).
  function msrCellValue(k, out) {
    const z = k.z;
    const mode = k.mode;
    out.signed = mode === "delta" || mode === "flow" || mode === "flowtrades" || mode === "cascade";
    out.short = false;
    if (msrReadStatus(k.read, out)) return out;
    if (k.replay && z.c * msrTs(k) >= k.cut) return msrSetTyped(out, msrHidden, "replay", null);
    const measured = k.measured;
    if (typeof measured === "function" && measured(z) === false) return msrSetTyped(out, msrPending, "column not complete", null);
    let ex = null;
    switch (mode) {
      case "volume":
      case "trades":
      case "delta": {
        const amount = mode === "volume" ? z.v : mode === "trades" ? z.ct : 2 * z.bv - z.v;
        if (k.basis !== "intensity") return msrSetValue(out, amount);
        ex = msrKernelExposure(k, Infinity);
        out.short = ex.timeFraction < msrShortAt || ex.priceFraction < msrShortAt;
        if (ex.seconds <= 0) return msrSetTyped(out, msrUndefined, null, "covered time");
        if (ex.width <= 0) return msrSetTyped(out, msrUndefined, null, "price span");
        // Never floored: a positive exposure of 1e-9 s still divides.
        return msrSetValue(out, (amount * msrPerMinute * msrBandUsdt) / (ex.seconds * ex.width));
      }
      case "size":
        if (z.ct === 0) return msrSetTyped(out, msrUndefined, null, "trades");
        return msrSetValue(out, z.v / z.ct);
      case "flow":
        if (z.v <= 0) return msrSetTyped(out, msrEmptyPop, "total volume is 0", "total volume");
        return msrSetValue(out, z.bv / z.v);
      case "flowtrades":
        if (z.ct <= 0) return msrSetTyped(out, msrEmptyPop, "total trades is 0", "total trades");
        return msrSetValue(out, z.bt / z.ct);
      case "path": {
        const pb = k.pathBasis;
        if (pb === "usdt") return msrSetValue(out, z.p);
        ex = msrKernelExposure(k, k.end);
        out.short = ex.timeFraction < msrShortAt || ex.priceFraction < msrShortAt;
        if (pb === "perMinute") {
          if (ex.seconds <= 0) return msrSetTyped(out, msrUndefined, null, "covered time");
          if (ex.width <= 0) return msrSetTyped(out, msrUndefined, null, "price span");
          return msrSetValue(out, (msrPerMinute * z.p) / (ex.width * ex.seconds));
        }
        // Row spans: path over the MEASURED price height of the cell, i.e. cell heights at the drawn row
        // size (DR-12; the baseline's extrapolation to the full cell time is gone).
        if (ex.width <= 0) return msrSetTyped(out, msrUndefined, null, "price span");
        return msrSetValue(out, z.p / ex.width);
      }
      case "dwell": {
        ex = msrKernelExposure(k, k.end);
        out.short = ex.timeFraction < msrShortAt || ex.priceFraction < msrShortAt;
        const bad = msrDwellReason(z.w, ex.seconds);
        if (bad !== null) return msrSetTyped(out, msrInvalid, bad, null);
        if (ex.seconds <= 0) return msrSetTyped(out, msrUndefined, null, "covered time");
        return msrSetValue(out, z.w / ex.seconds);
      }
      case "cascade": {
        const entry = k.cascade;
        // No Cascade source yet (the page has not built the level's parents): pending, never a value.
        if (typeof entry !== "function") return msrSetTyped(out, msrPending, "reading", null);
        msrSetTyped(out, msrPending, null, null);
        entry(z, out);
        if (out.tag === msrFinite) return msrSetValue(out, out.value);
        return out;
      }
      default:
        return msrSetTyped(out, msrUnsupported, "no measurement for this mode", null);
    }
  }

  // ---- allocating records -----------------------------------------------------------------------------

  // A finished scratch -> a Typed record (B.1), through E.result.make so the required fields are checked.
  function msrToTyped(o) {
    const tag = API.result.TAGS[o.tag];
    const fields = {};
    if (o.tag === 0) fields.value = o.value;
    else {
      if (typeof o.reason === "string") fields.reason = o.reason;
      if (typeof o.denominator === "string") fields.denominator = o.denominator;
      if (tag === "waiting-for-complete-parent") fields.open = true;
    }
    return API.result.make(tag, fields);
  }

  function msrNumber(x) {
    return Number.isFinite(x) ? x : null;
  }

  // E.measure.cellMeasurement (API.md B.4): the full, allocating record of one cell's measurement, for
  // readouts, tooltips and the portable capture. `spec` has the fields of the kernel. The numerator and the
  // denominator are what was AGGREGATED before the ratio (S1-010): sums of USDT, trades, seconds, never
  // averages of ratios.
  function msrCellMeasurement(spec) {
    const k = spec.exposure ? spec : Object.assign({}, spec);
    const out = { tag: 0, value: NaN, signed: false, short: false, reason: null, denominator: null };
    msrCellValue(k, out);
    const mode = k.mode;
    const basis = msrBasisOf(mode, k.basis, k.pathBasis);
    const id = msrCellFormulas[mode + "|" + basis] || null;
    const z = k.z;
    const uses = msrUsesOf(mode, basis);
    let exposure = null;
    if (uses.t || uses.w) {
      // The kernel computed it unless a non-value came first (read status, hidden, unmeasured).
      const ex = msrKernelExposure(k, mode === "path" || mode === "dwell" ? k.end : Infinity);
      exposure = {
        seconds: msrNumber(ex.seconds),
        width: msrNumber(ex.width),
        timeFraction: msrNumber(ex.timeFraction),
        priceFraction: msrNumber(ex.priceFraction),
        nominalSeconds: ex.nominalSeconds,
        nominalWidth: ex.nominalWidth,
        short: msrIsShort(ex, uses),
        uses: { t: uses.t, w: uses.w },
        coverage: "range",
        coveredTo: mode === "path" || mode === "dwell" ? "end" : null,
      };
    }
    let numerator = null;
    let numeratorUnit = null;
    let denominator = null;
    let denominatorUnit = null;
    if (mode === "volume" || mode === "trades" || mode === "delta") {
      numerator = msrNumber(mode === "volume" ? z.v : mode === "trades" ? z.ct : 2 * z.bv - z.v);
      numeratorUnit = mode === "trades" ? "trades" : "usdt";
      if (basis === "intensity" && exposure) {
        denominator = msrNumber((exposure.seconds * exposure.width) / (msrPerMinute * msrBandUsdt));
        denominatorUnit = "usdt*s/60/125";
      }
    } else if (mode === "size") {
      numerator = msrNumber(z.v);
      numeratorUnit = "usdt";
      denominator = msrNumber(z.ct);
      denominatorUnit = "trades";
    } else if (mode === "flow") {
      numerator = msrNumber(z.bv);
      numeratorUnit = "usdt";
      denominator = msrNumber(z.v);
      denominatorUnit = "usdt";
    } else if (mode === "flowtrades") {
      numerator = msrNumber(z.bt);
      numeratorUnit = "trades";
      denominator = msrNumber(z.ct);
      denominatorUnit = "trades";
    } else if (mode === "path") {
      numerator = msrNumber(z.p);
      numeratorUnit = "usdt";
      if (basis !== "usdt" && exposure) {
        denominator = basis === "perMinute" ? msrNumber((exposure.width * exposure.seconds) / msrPerMinute) : exposure.width;
        denominatorUnit = basis === "perMinute" ? "usdt*s/60" : "usdt";
      }
    } else if (mode === "dwell") {
      numerator = msrNumber(z.w);
      numeratorUnit = "seconds";
      if (exposure) {
        denominator = exposure.seconds;
        denominatorUnit = "seconds";
      }
    }
    return {
      v: 1,
      formula: id,
      measure: mode,
      basis,
      unit: id ? msrFormulas[id].unit : null,
      numerator,
      numeratorUnit,
      denominator,
      denominatorUnit,
      exposure,
      aggregation: denominator === null ? "sum" : "sum-then-ratio",
      result: msrToTyped(out),
      model: null,
    };
  }

  // ---- columns (C.1.6) --------------------------------------------------------------------------------

  // Write one column's measure into `o` ({tag, value, reason, denominator}); a ratio column asks part 06
  // with the inputs the page gathered in ctx.ratio (the level's Cascade context or the touched-row counts).
  function msrColumnInto(key, col, ctx, o) {
    const c = ctx || null;
    if (c !== null) {
      if (msrReadStatus(c.read, o)) return o;
      if (c.hidden) return msrSetTyped(o, msrHidden, "replay", null);
    }
    switch (key) {
      case "volume":
        return msrSetValue(o, col.v);
      case "trades":
        return msrSetValue(o, col.ct);
      case "delta":
        return msrSetValue(o, 2 * col.bv - col.v);
      case "takertrades":
        return msrSetValue(o, 2 * col.bt - col.ct);
      case "size":
        if (col.ct === 0) return msrSetTyped(o, msrUndefined, null, "trades");
        return msrSetValue(o, col.v / col.ct);
      case "choppiness":
        if (col.ct === 0) return msrSetTyped(o, msrUndefined, null, "trades");
        // A movement-only column has NaN high and low: no range, so no ratio (never a 0 bar).
        if (!(col.hi > col.lo)) return msrSetTyped(o, msrUndefined, null, "price range");
        return msrSetValue(o, col.p / (col.hi - col.lo));
      case "perpath":
        if (!(col.p > 0)) return msrSetTyped(o, msrUndefined, null, "path");
        return msrSetValue(o, col.v / col.p);
      case "cascade":
      case "efficiency": {
        const input = c !== null ? c.ratio : null;
        if (!input) return msrSetTyped(o, msrPending, "reading", null);
        const typed = key === "cascade" ? API.ratio.cascade(input) : API.ratio.efficiency(input);
        o.tag = msrTag[typed.tag];
        o.value = typed.tag === "finite" ? typed.value : NaN;
        o.reason = typeof typed.reason === "string" ? typed.reason : null;
        o.denominator = typeof typed.denominator === "string" ? typed.denominator : null;
        return o;
      }
      default:
        return msrSetTyped(o, msrUnsupported, "no measurement for this column", null);
    }
  }

  // E.measure.columnValue (API.md C.1.6, S1-044/S1-063): the value of one pane column. `key` is one of
  // volume, trades, delta, takertrades, size, choppiness, perpath, cascade, efficiency; `col` the column's
  // summary {v, bv, ct, bt, p, hi, lo}; `ctx` may carry {read, hidden, ratio} (the ratio columns take their
  // structure and amounts in ctx.ratio, in the shape of E.ratio.cascade / efficiency). The baseline
  // answered 0 for an undefined denominator and drew a zero-length bar; now the answer is a typed
  // non-value that every reading renders alike. With `out` ({tag, value, reason, denominator}) it writes the
  // tag and value without allocating (used once per column per frame; the two ratio keys still build one
  // small Typed inside part 06); without it a Typed record is returned.
  function msrColumnValue(key, col, ctx, out) {
    if (out) return msrColumnInto(key, col, ctx, out);
    return msrToTyped(msrColumnInto(key, col, ctx, { tag: 0, value: NaN, reason: null, denominator: null }));
  }

  API.measure = Object.freeze({
    FORMULAS: msrFormulas,
    MODES: msrModes,
    ROWS: msrRows,
    exposure: msrExposure,
    usesOf: msrUsesOf,
    isShort: msrIsShort,
    cellValue: msrCellValue,
    cellMeasurement: msrCellMeasurement,
    columnValue: msrColumnValue,
    dwellCheck: msrDwellCheck,
    dwellResidual: msrDwellResidual,
    cellState: msrCellState,
    close: msrClose,
  });

  // == §06-ratio ==
  // @part 06-ratio
  // @requires 01-util 03-result
  // @prefix rat
  // @provides ratio
  // == §06 ratio: Cascade, Efficiency and the fixed log-ratio coordinate (API.md C.1.7, C.5) ==
  // A ratio measure has more ways not to have a value than any other, and D2 names every one. All three
  // ratio families (Cascade, Efficiency, Relative volume) walk the same ladder, so it is written once
  // (classify) and the two kernels here only say what their inputs mean. Nothing here draws or colours:
  // a finite value is a number on a log2 scale, its coordinate on the fixed -2..+2 axis is `coordinate`.

  // The clip codes of API.md C.5, the same small integers E.scale.CLIP names (part 08 is not required here,
  // so they are repeated as literals; U22 and the scale tests pin both tables to the spec).
  const ratClipNone = 0;
  const ratClipLow = 1;
  const ratClipHigh = 2;
  const ratClipExactLow = 3;
  const ratClipExactHigh = 4;
  // The tick spacing a label needs (C.5): 12 px between two kept ticks.
  const ratTickGap = 12;

  // E.ratio.TICKS (C.5, S1-070): the five ticks of the fixed log2 axis and the factor each one means. The
  // labels are the plain reading of the ratio (1/4x ... 4x); the multiplication sign is written as an
  // escape because only part 04-text may hold non-ASCII characters in a string.
  const ratTicks = Object.freeze([
    Object.freeze({ value: -2, label: "1/4\u00d7", factor: 0.25 }),
    Object.freeze({ value: -1, label: "1/2\u00d7", factor: 0.5 }),
    Object.freeze({ value: 0, label: "1\u00d7", factor: 1 }),
    Object.freeze({ value: 1, label: "2\u00d7", factor: 2 }),
    Object.freeze({ value: 2, label: "4\u00d7", factor: 4 }),
  ]);
  // The order in which ticks earn a place when room is short: the two ends (they say the axis is +-2), then
  // the centre (1x, "even"), then the halves. Indexes into ratTicks.
  const ratTickPriority = Object.freeze([0, 4, 2, 1, 3]);

  // An empty total, named: 0 is a real empty count, an absent one (a column the level never listed) is the
  // baseline's "none", and a negative number is nonsense that still cannot be divided by.
  function ratEmptyPopulation(name, value) {
    const why = value === 0 ? "0" : value === undefined || value === null ? "absent" : "not positive";
    return API.result.make("empty-population", { denominator: name, reason: name + " is " + why });
  }

  // E.ratio.classify (API.md A.3, C.1.7): the generic D2 ladder. Applied strictly in this order, so a
  // reason that comes earlier always wins over arithmetic that comes later:
  //   1. read and coverage status (E.result.precedence): failed > pending > unsupported > hidden > outside
  //   2. structure: "coarsest" -> no-coarser-parent; "open" -> waiting-for-complete-parent (open: true);
  //      "outside" -> unsupported (parent not covered by the block); "unavailable" -> unsupported (only the
  //      live cube can answer). "complete" or absent: carry on.
  //   3. totals [{name, value}, ...]: the first that is zero, negative or absent -> empty-population naming
  //      it; a non-finite one -> invalid-input
  //   4. ordinary [{name, value}, ...]: a denominator that is not positive -> undefined naming it
  //   5. current and reference (non-negative amounts or shares), when both are given:
  //        both 0 -> empty-both; current 0 -> negative-infinite; reference 0 -> no-reference;
  //        else finite log2(current / reference [/ divisor])
  // Returns null when the ladder passes and no current/reference pair was given ("carry on"). Inputs:
  // {read, hidden, outside, structure, reason, totals, ordinary, current, reference, divisor}.
  function ratClassify(input) {
    const pre = API.result.precedence(input);
    if (pre !== null) return pre;
    const structure = input.structure;
    if (structure === "coarsest") return API.result.make("no-coarser-parent");
    if (structure === "open") return API.result.make("waiting-for-complete-parent", { open: true });
    if (structure === "outside") return API.result.make("unsupported", { reason: input.reason || "parent not covered by block" });
    if (structure === "unavailable") return API.result.make("unsupported", { reason: input.reason || "live cube only" });
    if (structure !== undefined && structure !== null && structure !== "complete") throw new RangeError("unknown ratio structure " + JSON.stringify(structure));
    const totals = input.totals;
    if (totals) {
      for (let i = 0; i < totals.length; i++) {
        const x = totals[i].value;
        // Absent (undefined or null) is empty, not invalid: only a number that is not a number is invalid.
        if (x !== undefined && x !== null && !Number.isFinite(x)) return API.result.make("invalid-input", { reason: "non-finite" });
        if (!(x > 0)) return ratEmptyPopulation(totals[i].name, x);
      }
    }
    const ordinary = input.ordinary;
    if (ordinary) {
      for (let i = 0; i < ordinary.length; i++) {
        const x = ordinary[i].value;
        if (!Number.isFinite(x)) return API.result.make("invalid-input", { reason: "non-finite" });
        if (!(x > 0)) return API.result.make("undefined", { denominator: ordinary[i].name });
      }
    }
    const cur = input.current;
    const ref = input.reference;
    if (cur === undefined || ref === undefined) return null;
    if (!Number.isFinite(cur) || !Number.isFinite(ref) || cur < 0 || ref < 0) return API.result.make("invalid-input", { reason: "non-finite" });
    if (cur === 0 && ref === 0) return API.result.make("empty-both");
    if (cur === 0) return API.result.make("negative-infinite");
    if (ref === 0) return API.result.make("no-reference");
    let q = cur / ref;
    if (input.divisor !== undefined) q = q / input.divisor;
    return API.result.finite(Math.log2(q));
  }

  // E.ratio.cascade (API.md C.1.7, DD-38): a cell's (factor 4) or a column's (factor 2) share of its parent,
  // as log2(factor * child / parent): +2 exactly when the cell IS its whole parent, 0 at an even quarter, and
  // +1 for a column that is its whole parent column. `structure` is decided BEFORE the child is looked at, so
  // a child absent from an incomplete parent reads "waiting", not "no value here" as the baseline said:
  //   coarsest -> no-coarser-parent, open -> waiting-for-complete-parent, outside -> unsupported (the block
  //   does not hold the whole parent), complete -> parent volume 0 -> empty-population, child volume 0 or
  //   absent -> negative-infinite (a real, readout-only state: the parent traded and this child did not),
  //   otherwise finite. The unrounded ratio is returned; only its drawing coordinate is ever clipped.
  function ratCascade(input) {
    const factor = input.factor;
    if (typeof factor !== "number" || !(factor > 0) || !Number.isFinite(factor)) throw new RangeError("cascade needs a positive factor (4 for cells, 2 for columns)");
    const child = input.childV;
    // A present but non-finite child is a validation failure; an absent one is a child that did not trade.
    if (typeof child === "number" && !Number.isFinite(child)) return API.result.make("invalid-input", { reason: "non-finite" });
    return ratClassify({
      read: input.read,
      hidden: input.hidden,
      outside: input.outside,
      structure: input.structure,
      totals: [{ name: "parent volume", value: input.parentV }],
      current: child > 0 ? factor * child : 0,
      reference: input.parentV,
    });
  }

  // E.ratio.efficiency (API.md C.1.7, C.14): log2((child.v / child.rows) / (parent.v / parent.rows) / baseline),
  // the USDT per touched row of a column against its parent's, relative to what the model expects
  // (baseline = 2**(ISO_B - 1), E.model.PROVENANCE.baseline; always passed in by the caller, so the result
  // never depends on which parts happen to be loaded). Read status comes first (a failed or pending
  // touched-row read passes through), then structure (coarsest, open, unavailable), then the four counts in
  // the order child volume, child touched rows, parent volume, parent touched rows: a zero of any of them is
  // empty-population naming it, never negative-infinite (v / rows is undefined at 0 / 0). The value is
  // unclamped: beyond +-2 it is finite and only the coordinate is clipped.
  function ratEfficiency(input) {
    let baseline = input.baseline;
    if (typeof baseline !== "number" || !(baseline > 0) || !Number.isFinite(baseline)) throw new TypeError("efficiency needs a positive finite baseline");
    const child = input.child || {};
    const parent = input.parent || {};
    return ratClassify({
      read: input.read,
      hidden: input.hidden,
      outside: input.outside,
      structure: input.structure,
      totals: [
        { name: "child volume", value: child.v },
        { name: "child touched rows", value: child.rows },
        { name: "parent volume", value: parent.v },
        { name: "parent touched rows", value: parent.rows },
      ],
      current: child.v / child.rows,
      reference: parent.v / parent.rows,
      divisor: baseline,
    });
  }

  // E.ratio.coordinate (API.md C.5, S1-070/S1-071): a raw value on the fixed axis [lo, hi] as {t, clip}. Only
  // the DRAWING coordinate is clipped; the raw value is kept by the caller for the readout. A finite value
  // beyond an end is clipped to t 0 or 1 and coded LOW or HIGH (the finite underflow / overflow triangles);
  // exactly an end is t 0 or 1 and coded EXACT_LOW or EXACT_HIGH (an endpoint is a real value, not an
  // overflow: exact +2 is not "outside range"); infinities are clipped like any overflow but callers keep
  // negative-infinite as its own typed case and never ask. A NaN has no coordinate: it throws.
  function ratCoordinate(value, lo, hi) {
    if (value !== value) throw new TypeError("coordinate needs a number, not NaN");
    if (!(lo < hi)) throw new RangeError("coordinate needs lo < hi");
    if (value < lo) return { t: 0, clip: ratClipLow };
    if (value > hi) return { t: 1, clip: ratClipHigh };
    if (value === lo) return { t: 0, clip: ratClipExactLow };
    if (value === hi) return { t: 1, clip: ratClipExactHigh };
    return { t: (value - lo) / (hi - lo), clip: ratClipNone };
  }

  // E.ratio.ratioTicks (API.md C.5): which of the five ticks fit a ratio axis whose full -2..+2 span is
  // `room` px long, with at least 12 px between any two labels. Ends first, then the centre, then the
  // halves (pane heights are 36 to 120 px and the type is 11 px at least); the full set always stays in the
  // legend details. Returned in ascending value order. A room that is not a positive number keeps none.
  function ratRatioTicks(room) {
    const kept = [];
    if (!(room > 0) || !Number.isFinite(room)) return kept;
    const at = (tick) => ((tick.value + 2) / 4) * room;
    for (const i of ratTickPriority) {
      const px = at(ratTicks[i]);
      let fits = true;
      for (const other of kept) if (Math.abs(at(other) - px) < ratTickGap) fits = false;
      if (fits) kept.push(ratTicks[i]);
    }
    return kept.sort((a, b) => a.value - b.value);
  }

  API.ratio = Object.freeze({
    cascade: ratCascade,
    efficiency: ratEfficiency,
    coordinate: ratCoordinate,
    TICKS: ratTicks,
    ratioTicks: ratRatioTicks,
    classify: ratClassify,
  });

  // == §07-relvol ==
  // @part 07-relvol
  // @requires 01-util 03-result
  // @prefix rvl
  // @provides relvol
  // == §07 relvol: Relative volume v2 (API.md C.2, DR-19, DD-24, DD-89, S1-046..050) ==
  // For every price bin: log2 of the bin's share of the RECTANGLE's volume over its share of the PERIOD's
  // volume, where both shares are taken over the same comparison support W (the selection's price range, else
  // the view's). Two distributions over one support, so that a rectangle that trades exactly like its period
  // reads 0 on every row, whatever W is. The baseline compared the rectangle's shares (over W) with the
  // period's shares over ALL its rows, which is why v1 drifted from 0 as soon as W was a part of the range.
  //
  // Pure and allocation-light: flat typed arrays indexed by (bin - first bin), no Map per call, and for an
  // exact period only the rows inside W are visited (binary search on the sorted rows), so a vertical pan
  // costs O(rows in W). The result is a NEW object every call; the caller memoises it on (period rows, query,
  // w0, w1, bm) (DD-24) and keeps it apart from the unrestricted underlay bands that feed POC and value area
  // (S1-050): nothing here mutates or is derived in place from those.

  // Per-bin outcome codes of the flat arrays.
  const rvlFiniteCode = 0;
  const rvlNegInfCode = 1;
  const rvlNoRefCode = 2;
  const rvlEmptyBothCode = 3;
  const rvlAbsentCode = 255;
  // A guard, not a limit anyone reaches: W is a screen or a selection, thousands of base rows at most.
  const rvlBinsMax = 4194304;

  // The typed results with a fixed shape are shared frozen records (`at` is asked once per band per frame);
  // only a finite value allocates.
  const rvlNegInf = Object.freeze({ tag: "negative-infinite", reason: "no current volume" });
  const rvlNoRef = Object.freeze({ tag: "no-reference", reason: "no reference volume" });
  const rvlEmptyBoth = Object.freeze({ tag: "empty-both" });
  const rvlOutside = Object.freeze({ tag: "outside-support", reason: "outside price support" });

  function rvlZeroCounts() {
    return { finite: 0, zero: 0, negativeInfinite: 0, noReference: 0, emptyBoth: 0, underflow: 0, overflow: 0, exactLow: 0, exactHigh: 0 };
  }

  // First index of ascending `rows` (objects with a numeric `r`) whose r >= x.
  function rvlFirstRow(rows, x) {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].r < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // The read and coverage status of the whole result (C.2 step 1): a failed read beats a pending one beats a
  // source that cannot answer ("not recorded" on a recorded page), then replay-hidden. `read` is
  // {meas, res, stale} with meas the rectangle's measurement and res the period's rows, each {state, reason?};
  // meas.state failed and pending count, res.state failed, pending, "unrecorded" (unsupported) and "none"
  // (the period lies after the replay edge: hidden). stale is disclosure only, never a status.
  function rvlStatus(input) {
    const read = input.read || {};
    const meas = read.meas || null;
    const res = read.res || null;
    let picked = null;
    for (const state of ["failed", "pending"])
      for (const r of [meas, res]) if (r && r.state === state && picked === null) picked = r;
    if (picked === null && res && res.state === "unrecorded") picked = { state: "unsupported", reason: "not recorded" };
    const hidden = input.hidden === true || (res !== null && res.state === "none");
    return API.result.precedence({ read: picked, hidden });
  }

  // The support record of a result: W, the band level, which rows the comparison used and which bins count.
  function rvlSupport(w0, w1, bm, own, first, last, bins, used) {
    return Object.freeze({
      w: [w0, w1],
      bm,
      exact: own === 0,
      kind: own === 0 ? "exact-rows" : "coarse-common-bins",
      first: bins > 0 ? first : null,
      last: bins > 0 ? last : null,
      bins,
      used,
    });
  }

  // A result that says the same thing for every bin (a read status, an unsupported period, an empty
  // support). `sup` is the support record when one exists.
  function rvlWhole(typed, w0, w1, bm, own, stale, restriction, sup) {
    return Object.freeze({
      state: "typed",
      typed,
      stale,
      at: () => typed,
      counts: rvlZeroCounts(),
      support: sup || rvlSupport(w0, w1, bm, own, 0, 0, 0, 0),
      restriction,
    });
  }

  // E.relvol.compute (API.md C.2, DR-19). Input:
  //   read    {meas, res, stale}    see rvlStatus
  //   W       [w0, w1]              the comparison support in base rows: the selection's price range, else the
  //                                 view's (for a `recorded` state the inward bounds)
  //   period  {rows, own, exact}    the period's rows [{r, v}] ascending by r, at row level `own`
  //                                 (rowPrice 2**own; 0 = 125 USDT rows)
  //   current {rows, m}             the rectangle's rows [{r, v}] (already only its measured part inside W)
  //                                 at level m <= bm
  //   bm                            the drawn band level, max(renderM, own)
  //   hidden                        replay: nothing after the edge is shown
  // Bin j covers base rows [j*2**bm, (j+1)*2**bm).
  //  - Exact period (own = 0): period rows are restricted to W FIRST, so a partial edge bin holds only its
  //    in-W base rows and is exact on both sides; the support is every bin that overlaps W.
  //  - Coarse period (own > 0, rows of more than 125 USDT): a coarse row cannot be split, so only bins
  //    wholly inside W on BOTH sides count; the others are dropped (restriction.dropped, the number of bins
  //    with data that were left out, including bins wholly outside W) and, if none is left, the whole
  //    result is `unsupported` "no fully covered common bin".
  //  The rows visited are those of W for an exact period, all of them for a coarse one (few, by nature).
  // The result: {state: "ok" | "typed", typed (the whole-result Typed, or null), stale, at(bin) -> Typed,
  // counts, support, restriction}. `at(bin)`: a bin in the support with data -> its value or typed case;
  // in the support with no data at all -> empty-both; outside the support (outside W, or a dropped coarse
  // edge bin) -> outside-support, NEVER a zero-current row (a row that lies outside the comparison is not
  // one the rectangle failed to trade). The union of the two sides is iterated, so a bin only the
  // rectangle traded is `no-reference` and one only the period traded is `negative-infinite`.
  function rvlCompute(input) {
    const W = input.W;
    if (!Array.isArray(W) || !Number.isFinite(W[0]) || !Number.isFinite(W[1])) throw new TypeError("relvol needs a finite comparison support W = [w0, w1]");
    const w0 = W[0];
    const w1 = W[1];
    const period = input.period || { rows: [], own: 0, exact: true };
    const own = period.own || 0;
    const bm = input.bm;
    if (!Number.isInteger(bm) || bm < own) throw new RangeError("relvol needs an integer band level bm >= the period's row level");
    const current = input.current || { rows: [], m: bm };
    const qm = current.m === undefined || current.m === null ? bm : current.m;
    if (!Number.isInteger(qm) || qm < 0 || qm > bm) throw new RangeError("relvol needs the rectangle's row level between 0 and bm");
    const stale = !!(input.read && input.read.stale);
    const status = rvlStatus(input);
    if (status !== null) return rvlWhole(status, w0, w1, bm, own, stale, null);
    if (!(w1 > w0)) return rvlWhole(rvlOutside, w0, w1, bm, own, stale, null);

    const binSize = Math.pow(2, bm);
    const kP = Math.pow(2, bm - own);
    const kC = Math.pow(2, bm - qm);
    const pRows = period.rows || [];
    const cRows = current.rows || [];
    const exactPeriod = own === 0;

    // The support: the bins that count. Exact: those overlapping W (base rows w0 <= r < w1); coarse: those
    // wholly inside W.
    let supFirst;
    let supLast;
    if (exactPeriod) {
      const rMin = Math.ceil(w0);
      const rMax = Math.ceil(w1) - 1;
      supFirst = Math.floor(rMin / binSize);
      supLast = rMax >= rMin ? Math.floor(rMax / binSize) : supFirst - 1;
    } else {
      supFirst = Math.ceil(w0 / binSize);
      supLast = Math.floor(w1 / binSize) - 1;
    }
    const supCount = supLast >= supFirst ? supLast - supFirst + 1 : 0;

    // Which period rows are visited: the rows of W only for an exact period (binary search), else all.
    let pFrom = 0;
    let pTo = pRows.length;
    if (exactPeriod) {
      pFrom = rvlFirstRow(pRows, w0);
      pTo = rvlFirstRow(pRows, w1);
    }
    // The extent of the bins with data, in one pass over what will be summed.
    let minJ = Infinity;
    let maxJ = -Infinity;
    for (let i = pFrom; i < pTo; i++) {
      const x = pRows[i];
      if (!Number.isFinite(x.v)) return rvlWhole(API.result.make("invalid-input", { reason: "non-finite" }), w0, w1, bm, own, stale, null);
      const j = Math.floor(x.r / kP);
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
    for (let i = 0; i < cRows.length; i++) {
      const x = cRows[i];
      if (!Number.isFinite(x.v)) return rvlWhole(API.result.make("invalid-input", { reason: "non-finite" }), w0, w1, bm, own, stale, null);
      const j = Math.floor(x.r / kC);
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
    const n = maxJ >= minJ ? maxJ - minJ + 1 : 0;
    if (n > rvlBinsMax) throw new RangeError("relvol: " + n + " bins is beyond the guard of " + rvlBinsMax);
    const per = new Float64Array(n);
    const cur = new Float64Array(n);
    const seen = new Uint8Array(n);
    for (let i = pFrom; i < pTo; i++) {
      const x = pRows[i];
      const j = Math.floor(x.r / kP) - minJ;
      per[j] += x.v;
      seen[j] = 1;
    }
    for (let i = 0; i < cRows.length; i++) {
      const x = cRows[i];
      const j = Math.floor(x.r / kC) - minJ;
      cur[j] += x.v;
      seen[j] = 1;
    }

    // used = bins with data inside the support; C and P are the sums over them (both sides, the same bins).
    let usedCount = 0;
    let seenCount = 0;
    let C = 0;
    let P = 0;
    for (let j = 0; j < n; j++) {
      if (seen[j] === 0) continue;
      seenCount++;
      const bin = j + minJ;
      if (bin < supFirst || bin > supLast) continue;
      usedCount++;
      C += cur[j];
      P += per[j];
    }
    const restriction = exactPeriod ? null : Object.freeze({ kind: "coarse-common-bins", dropped: seenCount - usedCount });
    if (!exactPeriod && usedCount === 0) return rvlWhole(API.result.make("unsupported", { reason: "no fully covered common bin" }), w0, w1, bm, own, stale, restriction, rvlSupport(w0, w1, bm, own, supFirst, supLast, supCount, 0));
    if (!(C > 0)) return rvlWholeInSupport(API.result.make("empty-population", { denominator: "current total", reason: "current total is 0" }), w0, w1, bm, own, stale, restriction, supFirst, supLast, supCount, usedCount);
    if (!(P > 0)) return rvlWholeInSupport(API.result.make("empty-population", { denominator: "reference total", reason: "reference total is 0" }), w0, w1, bm, own, stale, restriction, supFirst, supLast, supCount, usedCount);

    // Per bin: shares over the same support, then the ladder (C.2 step 6).
    const code = new Uint8Array(n).fill(rvlAbsentCode);
    const val = new Float64Array(n);
    const counts = rvlZeroCounts();
    let bothZero = 0;
    for (let j = 0; j < n; j++) {
      const bin = j + minJ;
      if (seen[j] === 0 || bin < supFirst || bin > supLast) continue;
      const sc = cur[j] / C;
      const sp = per[j] / P;
      if (sc === 0 && sp === 0) {
        code[j] = rvlEmptyBothCode;
        bothZero++;
      } else if (sc === 0) {
        code[j] = rvlNegInfCode;
        counts.negativeInfinite++;
      } else if (sp === 0) {
        code[j] = rvlNoRefCode;
        counts.noReference++;
      } else {
        const v = Math.log2(sc / sp);
        code[j] = rvlFiniteCode;
        val[j] = v;
        counts.finite++;
        if (v === 0) counts.zero++;
        if (v < -2) counts.underflow++;
        else if (v > 2) counts.overflow++;
        else if (v === -2) counts.exactLow++;
        else if (v === 2) counts.exactHigh++;
      }
    }
    // Bins of the support that no row touched are empty on both sides: counted here, not drawn per row (A-28).
    counts.emptyBoth = bothZero + (supCount - usedCount);

    const at = (bin) => {
      if (bin < supFirst || bin > supLast) return rvlOutside;
      const j = bin - minJ;
      if (j < 0 || j >= n || code[j] === rvlAbsentCode) return rvlEmptyBoth;
      const c = code[j];
      if (c === rvlFiniteCode) return { tag: "finite", value: val[j] };
      return c === rvlNegInfCode ? rvlNegInf : c === rvlNoRefCode ? rvlNoRef : rvlEmptyBoth;
    };
    return Object.freeze({
      state: "ok",
      typed: null,
      stale,
      at,
      counts,
      support: rvlSupport(w0, w1, bm, own, supFirst, supLast, supCount, usedCount),
      restriction,
    });
  }

  // An empty total: the same typed answer for every bin IN the support, outside-support beyond it.
  function rvlWholeInSupport(typed, w0, w1, bm, own, stale, restriction, supFirst, supLast, supCount, usedCount) {
    return Object.freeze({
      state: "typed",
      typed,
      stale,
      at: (bin) => (bin < supFirst || bin > supLast ? rvlOutside : typed),
      counts: rvlZeroCounts(),
      support: rvlSupport(w0, w1, bm, own, supFirst, supLast, supCount, usedCount),
      restriction,
    });
  }

  API.relvol = Object.freeze({
    compute: rvlCompute,
  });

  // == §08-scale ==
  // @part 08-scale
  // @requires 01-util 02-hash
  // @prefix scl
  // @provides scale
  // == §08 scale: numerical mappings (descriptors), their fits, evaluation, ids and compatibility (API.md B.5, C.3, C.4, C.5, C.7, C.8) ==
  // A Descriptor is the JSON-safe record of ONE mapping from a measured value to a coordinate t: the value
  // fit (log1p or linear), the 257-knot rank, the fixed shares and ratios, zero-only and the axis window.
  // Everything here is pure. Fits allocate (they run once per settled fit, off the draw path); `plan` and
  // the closures it returns are the per-cell path and allocate nothing (INTEGRATION D.15, DD-44).

  // Clip codes (C.5): a small-integer alphabet so a warning tally can count them without strings.
  // EXACT_* is a value exactly on an endpoint: drawn at the end of the ramp but NOT out of range.
  const sclClip = Object.freeze({ NONE: 0, LOW: 1, HIGH: 2, EXACT_LOW: 3, EXACT_HIGH: 4 });
  const sclNone = 0;
  const sclLow = 1;
  const sclHigh = 2;
  const sclExactLow = 3;
  const sclExactHigh = 4;
  // The eight kinds of B.5. `none` is "No calibration": it has no coordinate and is never persisted.
  const sclKinds = Object.freeze(["value-log1p", "value-linear", "rank-type7-257", "fixed-linear", "fixed-diverging", "zero-only", "none", "axis-linear"]);
  // The only members a descriptor may carry. Anything else in an imported record is refused by `validate`.
  const sclFields = Object.freeze(["v", "id", "kind", "signed", "params", "clip", "algorithm"]);
  // The one memo of the module (DD-44, an exception to DD-02: it is unobservable and needs no reset): a
  // plan per descriptor OBJECT. Descriptors are frozen when made here, so a cached plan cannot go stale.
  const sclPlans = new WeakMap();

  function sclIsNumber(x) {
    return typeof x === "number" && Number.isFinite(x);
  }

  function sclIsObject(x) {
    // The tag test (not a prototype check) also accepts objects made in another realm, such as a test's
    // literals handed to a module evaluated in a vm context.
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function sclDeepFreeze(v) {
    if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      const keys = Object.keys(v);
      for (let i = 0; i < keys.length; i++) sclDeepFreeze(v[keys[i]]);
    }
    return v;
  }

  // The record that is hashed (C.7): {v, kind, signed, params, clip}. It EXCLUDES units, measure, context,
  // cohort, provenance, appearance, theme, the LUT and the `algorithm` and `id` fields (DR-03), so two
  // measures with the same (U, k) share an id and compatibility is decided from the context (C.8), never
  // from the id. `v` is the record's own mapping version, which is the header's VERSION.mapping for every
  // descriptor made here (and for a hand-built record that leaves it out); a record that says another
  // version gets another id, so an id is always a function of the record it names (`validate` then refuses
  // the record itself).
  function sclMappingInput(desc) {
    return { v: desc.v === undefined ? VERSION.mapping : desc.v, kind: desc.kind, signed: desc.signed, params: desc.params, clip: desc.clip };
  }

  // E.scale.canonical (API.md A.3, C.7): the exact JSON text that the id hashes.
  function sclCanonical(desc) {
    return API.hash.canonical(sclMappingInput(desc));
  }

  // E.scale.id (API.md A.3, C.7, DR-03, DR-34): 16 base64url characters of the first 96 bits of
  // SHA-256(canonical mapping record). E.hash.id96 canonicalises INSIDE, so it is given the record and
  // never its text.
  function sclId(desc) {
    return API.hash.id96(sclMappingInput(desc));
  }

  // A finished descriptor: id computed, deep-frozen (the plan cache and every holder of the record rely on
  // it never changing). `algorithm` is provenance only and is not hashed.
  function sclMake(kind, signed, params, algorithm) {
    const desc = { v: VERSION.mapping, id: "", kind, signed, params, clip: kind === "axis-linear" ? "axis@1" : "clamp01@1", algorithm };
    desc.id = sclId(desc);
    return sclDeepFreeze(desc);
  }

  // E.scale.zeroOnly (API.md A.3, C.4): the calibration of a valid cohort whose every measured value is
  // zero (D3: a zero-only calibration, NEVER U = 1). A later nonzero value is out of domain until a fit
  // replaces it (see `apply`, DD-95).
  function sclZeroOnly(signed) {
    return sclMake("zero-only", Boolean(signed), null, "value-fit@1");
  }

  // The values of a cohort: `{values}` as E.cohort makes it, or a bare array/typed array (handy in tests
  // and for callers that only have numbers).
  function sclValuesOf(cohort) {
    // Not `cohort.values !== undefined` alone: every Array has a `values` METHOD. Only a plain object counts.
    if (sclIsObject(cohort) && cohort.values !== undefined) return cohort.values;
    return cohort === null || cohort === undefined ? [] : cohort;
  }

  function sclNoCalibration(reason) {
    return { state: "no-calibration", descriptor: null, reason };
  }

  // E.scale.fitValue (API.md A.3, C.4, DR-09, S1-072..076): the Value mapping of a cohort.
  //   empty (no eligible value)   -> No calibration, "empty cohort" (never U = 1)
  //   only zeros                  -> zero-only (a measured all-zero cohort is a valid calibration)
  //   otherwise                   -> U = the largest magnitude, k = the Type-7 median of the nonzero
  //                                  magnitudes; an all-equal cohort gives U = k (it maps to the maximum)
  // Signed fits pool the magnitudes of BOTH signs into one (U, k) (DR-09): the sign only selects the arm,
  // so neither side is systematically stronger. Unsigned fits take values >= 0 and leave negatives out (E.cohort
  // counts them). Non-finite values are never members (E.cohort counts those too); they are skipped here
  // as well so a stray NaN cannot poison the sort.
  function sclFitValue(cohort, opts = {}) {
    const signed = Boolean(opts && opts.signed);
    const linear = Boolean(opts && opts.linear);
    const values = sclValuesOf(cohort);
    const mags = new Float64Array(values.length);
    let nonzero = 0;
    let eligible = 0;
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (!sclIsNumber(x)) continue;
      if (x < 0 && !signed) continue;
      eligible++;
      if (x !== 0) mags[nonzero++] = x < 0 ? -x : x;
    }
    if (eligible === 0) return sclNoCalibration("empty cohort");
    if (nonzero === 0) return { state: "ok", descriptor: sclZeroOnly(signed) };
    const sorted = mags.subarray(0, nonzero);
    sorted.sort();
    const U = sorted[nonzero - 1];
    // Type-7 median: for an even count the mean of the two middle values; for equal magnitudes it is that
    // magnitude, so an all-equal cohort needs no branch of its own.
    const k = API.util.median7(sorted);
    const descriptor = linear ? sclMake("value-linear", signed, { U }, "value-fit@1") : sclMake("value-log1p", signed, { U, k }, "value-fit@1");
    return { state: "ok", descriptor };
  }

  // E.scale.fitRank (API.md A.3, C.3, DD-09, S1-077..080): the 257-knot Type-7 quantile approximation of
  // the finite POSITIVE values of a cohort (zeros are separately keyed and must not compress the low end;
  // rank is offered only for unsigned unbounded measures). knots[j] is the Type-7 quantile at q = j/256,
  // made non-decreasing after rounding. It is an APPROXIMATION and says so (algorithm "type7-257@1"): it is
  // not an exact empirical midrank between knots. A cohort with no positive value splits as fitValue does
  // (DR-40, D3): measured zeros only is a valid zero-only calibration (a later nonzero value is out of
  // domain until a fit replaces it), and a cohort with no finite value >= 0 at all (empty, or only
  // negatives and non-finite values that E.cohort has excluded and counted) is No calibration.
  function sclFitRank(cohort) {
    const values = sclValuesOf(cohort);
    const buf = new Float64Array(values.length);
    let n = 0;
    let zeros = 0;
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (!sclIsNumber(x)) continue;
      if (x > 0) buf[n++] = x;
      else if (x === 0) zeros++;
    }
    if (n === 0) return zeros > 0 ? { state: "ok", descriptor: sclZeroOnly(false) } : sclNoCalibration("empty cohort");
    const s = buf.subarray(0, n);
    s.sort();
    const knots = [];
    for (let j = 0; j < LIMITS.RANK_KNOTS; j++) {
      // The one quantile routine of the module (DD-10): q = j/256 is exact in binary, so h = (N-1)q is the
      // exact ((N-1)*j)/256 of the specification. The clamp keeps interpolation rounding inside the two
      // sample values it lies between, and the running maximum keeps the table non-decreasing.
      let v = API.util.quantile7(s, j / 256);
      const lo = Math.floor(((n - 1) * j) / 256);
      if (lo < n - 1) {
        if (v < s[lo]) v = s[lo];
        else if (v > s[lo + 1]) v = s[lo + 1];
      }
      if (j > 0 && v < knots[j - 1]) v = knots[j - 1];
      knots.push(v);
    }
    return { state: "ok", descriptor: sclMake("rank-type7-257", false, { knots, q: "j/256" }, "type7-257@1") };
  }

  // The reason a manual share window is refused for a fixed kind, or null when it is fine (DD-66). A window
  // is [lo, hi] as S.scale.window stores it. A Taker-flow window must stay symmetric about 0.5 so its sign
  // arms and its midpoint survive (a "narrowed" asymmetric window would silently move the midpoint).
  function sclWindowProblem(kind, win) {
    if (!Array.isArray(win) || win.length !== 2 || !sclIsNumber(win[0]) || !sclIsNumber(win[1])) return "a window is two finite numbers [lo, hi]";
    const lo = win[0];
    const hi = win[1];
    if (!(lo >= 0 && hi <= 1 && lo < hi)) return "a window must satisfy 0 <= lo < hi <= 1";
    if (kind === "share-diverging") {
      if (Math.abs(lo + hi - 1) > 1e-12) return "a Taker flow window must be symmetric about 0.5 (lo + hi = 1)";
      if (!(lo > 0)) return "a Taker flow window must be narrower than 0..1";
    }
    return null;
  }

  // E.scale.fixed (API.md A.3, B.5, C.5, DD-07, DD-66): the fixed descriptors, shared by every measure that
  // uses them (units are not in the id):
  //   share-diverging  Taker shares, sign arms about 0.5: fixed-diverging {lo:0, hi:1, mid:0.5}
  //   unsigned-share   Dwell, an unsigned 0..100 % share: fixed-linear {lo:0, hi:1}
  //   log2-ratio       Cascade, Efficiency, Relative volume: fixed-diverging {lo:-2, hi:2, mid:0}
  // The optional manual window keeps the measure's KIND. A share-diverging window stays fixed-diverging with
  // mid 0.5 (never fixed-linear: the arms and the midpoint must survive); an unsigned-share window is
  // fixed-linear {lo, hi}. The pair is used as given, so the descriptor carries exactly the decimals the
  // user typed and an address round-trips them. An invalid window THROWS a RangeError whose message is the
  // reason (callers validate first and show it; a bad window is a programming error here, not data).
  function sclFixed(kind, win) {
    const given = win !== undefined && win !== null;
    if (kind === "share-diverging") {
      if (!given) return sclMake("fixed-diverging", true, { lo: 0, hi: 1, mid: 0.5 }, "fixed@1");
      const problem = sclWindowProblem(kind, win);
      if (problem) throw new RangeError(problem);
      return sclMake("fixed-diverging", true, { lo: win[0], hi: win[1], mid: 0.5 }, "fixed@1");
    }
    if (kind === "unsigned-share") {
      if (!given) return sclMake("fixed-linear", false, { lo: 0, hi: 1 }, "fixed@1");
      const problem = sclWindowProblem(kind, win);
      if (problem) throw new RangeError(problem);
      return sclMake("fixed-linear", false, { lo: win[0], hi: win[1] }, "fixed@1");
    }
    if (kind === "log2-ratio") {
      if (given) throw new RangeError("the log2 ratio has a fixed -2..2 domain and no manual window");
      return sclMake("fixed-diverging", true, { lo: -2, hi: 2, mid: 0 }, "fixed@1");
    }
    throw new RangeError("unknown fixed kind: " + String(kind));
  }

  // E.scale.manual (API.md A.3, C.9, A-17): a mapping the user typed. Value kinds need finite positive U
  // (and k for log1p, with k <= U as every fit gives); window kinds need lo < hi. Answers a Fit with
  // origin "manual"; a refused input is {state:"no-calibration", descriptor:null, reason}, so a form can
  // show the reason without a try/catch. The mapping id ignores the origin (it hashes the numbers only).
  function sclManual(spec) {
    const refuse = (reason) => ({ state: "no-calibration", descriptor: null, reason, origin: "manual" });
    if (!sclIsObject(spec)) return refuse("a manual domain is an object");
    const kind = spec.kind;
    const signed = Boolean(spec.signed);
    if (kind === "value-log1p" || kind === "value-linear") {
      if (!sclIsNumber(spec.U) || !(spec.U > 0)) return refuse("U must be a finite positive number");
      if (kind === "value-linear") return { state: "ok", descriptor: sclMake(kind, signed, { U: spec.U }, "manual@1"), origin: "manual" };
      if (!sclIsNumber(spec.k) || !(spec.k > 0)) return refuse("k must be a finite positive number");
      if (spec.k > spec.U) return refuse("k must not exceed U");
      if (!Number.isFinite(spec.U / spec.k)) return refuse("U / k is too large");
      return { state: "ok", descriptor: sclMake(kind, signed, { U: spec.U, k: spec.k }, "manual@1"), origin: "manual" };
    }
    if (kind === "fixed-linear" || kind === "fixed-diverging") {
      if (!sclIsNumber(spec.lo) || !sclIsNumber(spec.hi) || !(spec.lo < spec.hi)) return refuse("lo must be below hi (both finite)");
      if (kind === "fixed-linear") {
        if (signed) return refuse("a linear window is unsigned");
        return { state: "ok", descriptor: sclMake(kind, false, { lo: spec.lo, hi: spec.hi }, "manual@1"), origin: "manual" };
      }
      const mid = spec.mid === undefined ? (spec.lo + spec.hi) / 2 : spec.mid;
      if (!sclIsNumber(mid) || !(spec.lo < mid && mid < spec.hi)) return refuse("mid must lie strictly between lo and hi");
      return { state: "ok", descriptor: sclMake(kind, true, { lo: spec.lo, hi: spec.hi, mid }, "manual@1"), origin: "manual" };
    }
    return refuse("a manual domain is value-log1p, value-linear, fixed-linear or fixed-diverging");
  }

  // The params a kind may carry, checked by `validate`: exact key sets, finite numbers, the ordering rules
  // of B.5. Returns {reason, path} for the first failure or null. `path` is relative to the descriptor.
  function sclParamsProblem(kind, p) {
    const has = (names) => {
      if (!sclIsObject(p)) return { reason: "params must be an object", path: "params" };
      const keys = Object.keys(p);
      for (let i = 0; i < keys.length; i++) if (names.indexOf(keys[i]) < 0) return { reason: "unknown parameter", path: "params." + keys[i] };
      for (let i = 0; i < names.length; i++) if (!Object.prototype.hasOwnProperty.call(p, names[i])) return { reason: "missing parameter", path: "params." + names[i] };
      for (let i = 0; i < names.length; i++) {
        if (names[i] === "q" || names[i] === "knots") continue;
        if (!sclIsNumber(p[names[i]])) return { reason: "must be a finite number", path: "params." + names[i] };
      }
      return null;
    };
    let bad;
    switch (kind) {
      case "value-log1p":
        bad = has(["U", "k"]);
        if (bad) return bad;
        if (!(p.k > 0)) return { reason: "k must be positive", path: "params.k" };
        if (!(p.U > 0)) return { reason: "U must be positive", path: "params.U" };
        if (p.k > p.U) return { reason: "k must not exceed U", path: "params.k" };
        if (!Number.isFinite(p.U / p.k)) return { reason: "U / k is too large", path: "params.U" };
        return null;
      case "value-linear":
        bad = has(["U"]);
        if (bad) return bad;
        return p.U > 0 ? null : { reason: "U must be positive", path: "params.U" };
      case "rank-type7-257": {
        bad = has(["knots", "q"]);
        if (bad) return bad;
        if (p.q !== "j/256") return { reason: "q must be j/256", path: "params.q" };
        if (!Array.isArray(p.knots)) return { reason: "knots must be an array", path: "params.knots" };
        if (p.knots.length !== LIMITS.RANK_KNOTS) return { reason: "knots must hold exactly " + LIMITS.RANK_KNOTS + " values", path: "params.knots" };
        for (let i = 0; i < p.knots.length; i++) {
          if (!sclIsNumber(p.knots[i])) return { reason: "a knot must be a finite number", path: "params.knots[" + i + "]" };
          if (i > 0 && p.knots[i] < p.knots[i - 1]) return { reason: "knots must not decrease", path: "params.knots[" + i + "]" };
        }
        return null;
      }
      case "fixed-linear":
      case "axis-linear":
        bad = has(["lo", "hi"]);
        if (bad) return bad;
        return p.lo < p.hi ? null : { reason: "lo must be below hi", path: "params.lo" };
      case "fixed-diverging":
        bad = has(["lo", "hi", "mid"]);
        if (bad) return bad;
        return p.lo < p.mid && p.mid < p.hi ? null : { reason: "lo < mid < hi is required", path: "params.mid" };
      default:
        return p === null ? null : { reason: "this kind has no parameters", path: "params" };
    }
  }

  // E.scale.validate (API.md A.3, D9, S1-164): validation of ONE descriptor, as an import needs it. Returns
  // {ok:true} or {ok:false, reason, path} naming the first failure (path is where, e.g. "params.knots[17]").
  // It checks the version, the kind, the signedness each kind requires, the clip policy, exact parameter
  // sets, finite positive U and k with k <= U, exactly 257 non-decreasing finite rank knots, and that the
  // id, when present, equals the recomputed id. opts.requireId makes a missing id a failure too (an
  // imported record must carry one); a descriptor made here always has one.
  function sclValidate(desc, opts = {}) {
    const bad = (reason, path) => ({ ok: false, reason, path });
    if (!sclIsObject(desc)) return bad("a descriptor must be an object", "$");
    const keys = Object.keys(desc);
    for (let i = 0; i < keys.length; i++) if (sclFields.indexOf(keys[i]) < 0) return bad("unknown field", keys[i]);
    if (desc.v !== VERSION.mapping) return bad("unknown mapping version", "v");
    if (typeof desc.kind !== "string" || sclKinds.indexOf(desc.kind) < 0) return bad("unknown kind", "kind");
    if (typeof desc.signed !== "boolean") return bad("signed must be true or false", "signed");
    if (desc.kind === "rank-type7-257" && desc.signed) return bad("rank is unsigned", "signed");
    if (desc.kind === "fixed-linear" && desc.signed) return bad("a linear window is unsigned", "signed");
    if (desc.kind === "fixed-diverging" && !desc.signed) return bad("a diverging mapping is signed", "signed");
    if (desc.clip !== (desc.kind === "axis-linear" ? "axis@1" : "clamp01@1")) return bad("unknown clip policy for this kind", "clip");
    const problem = sclParamsProblem(desc.kind, desc.params);
    if (problem) return bad(problem.reason, problem.path);
    if (desc.algorithm !== undefined && (typeof desc.algorithm !== "string" || desc.algorithm.length > LIMITS.STRING_MAX)) return bad("algorithm must be a short string", "algorithm");
    if (desc.id === undefined) return opts && opts.requireId ? bad("the id is missing", "id") : { ok: true };
    if (typeof desc.id !== "string" || desc.id !== sclId(desc)) return bad("the id does not match the mapping", "id");
    return { ok: true };
  }

  // E.scale.index (API.md A.3): the LUT index of a coordinate, round(clamp(|t|, 0, 1) * 255), ties up
  // (Math.round). The sign selects the arm elsewhere, so only |t| counts. Written without helpers so the
  // hot path is one call: NaN falls out at 0 rather than at a plausible colour.
  function sclIndex(t) {
    const a = t < 0 ? -t : t;
    return a >= 1 ? 255 : a > 0 ? Math.round(a * 255) : 0;
  }

  // ---- evaluators (E.scale.plan): each writes out.t, out.clip and out.state and returns out ----------
  // Contract of every evaluator: x is a finite measured value (typed non-values never reach a mapping); a
  // NaN answers t = NaN so a caller bug is visible instead of coloured. out.state is reset on every call
  // (null, or "out-of-domain" / "no-calibration"), so a reused `out` never carries a stale state.

  // Value, log1p arm (C.4): t = log1p(|x|/k) / log1p(U/k). The denominator is computed ONCE per plan and
  // DIVIDED by (never multiplied by its reciprocal), so t(U) is exactly 1: the same expression divided by
  // itself. Overflow is decided in VALUE space (|x| > U), not on t, so a rounding of log1p can never
  // produce a false overflow; the drawing coordinate is clipped to 1, the raw value stays with the caller.
  function sclLogEvaluator(signed, U, k) {
    const denom = Math.log1p(U / k);
    return function (x, out) {
      const a = x < 0 ? -x : x;
      out.state = null;
      if (a === 0) {
        out.t = 0;
        out.clip = sclNone;
        return out;
      }
      let t = Math.log1p(a / k) / denom;
      if (a > U) {
        out.clip = sclHigh;
        t = 1;
      } else {
        out.clip = a === U ? sclExactHigh : sclNone;
        if (t > 1) t = 1;
      }
      out.t = signed && x < 0 ? -t : t;
      return out;
    };
  }

  // Value, linear alternative (D3): t = |x| / U, the same overflow rule.
  function sclLinearEvaluator(signed, U) {
    return function (x, out) {
      const a = x < 0 ? -x : x;
      out.state = null;
      if (a === 0) {
        out.t = 0;
        out.clip = sclNone;
        return out;
      }
      let t = a / U;
      if (a > U) {
        out.clip = sclHigh;
        t = 1;
      } else {
        out.clip = a === U ? sclExactHigh : sclNone;
        if (t > 1) t = 1;
      }
      out.t = signed && x < 0 ? -t : t;
      return out;
    };
  }

  // Rank (C.3): two bisections over the 257 knots per value. An exact repeated value maps to the midpoint
  // of its group's first and last q; a value between distinct knots interpolates from the lower group's
  // last q to the upper group's first q; outside the support it maps to 0 or 1 WITH an indication (LOW or
  // HIGH). An all-equal cohort (every knot the same) maps its value to 0.5 through the same first rule
  // (first q 0, last q 256) and everything else to an end with an indication.
  // A measured ZERO is not below the support: the knots are of the positive values only (zeros are
  // separately keyed, DD-09), so a zero maps to 0 WITHOUT an indication, exactly as under Value. Otherwise
  // every sparse view would count its empty cells as "out of range" and raise Scale range exceeded.
  function sclRankEvaluator(knots) {
    const lowerBound = API.util.lowerBound;
    const upperBound = API.util.upperBound;
    const lo = knots[0];
    const hi = knots[knots.length - 1];
    return function (x, out) {
      out.state = null;
      if (x === 0) {
        out.t = 0;
        out.clip = sclNone;
        return out;
      }
      if (x < lo) {
        out.t = 0;
        out.clip = sclLow;
        return out;
      }
      if (x > hi) {
        out.t = 1;
        out.clip = sclHigh;
        return out;
      }
      const i1 = lowerBound(knots, x);
      const i2 = upperBound(knots, x);
      out.clip = sclNone;
      if (i1 < i2) {
        out.t = (i1 + (i2 - 1)) / 512;
      } else {
        // knots[i1-1] < x < knots[i1]: the two groups' facing indices are i1-1 and i1 (one q apart).
        const a = knots[i1 - 1];
        out.t = (i1 - 1 + (x - a) / (knots[i1] - a)) / 256;
      }
      return out;
    };
  }

  // A fixed unsigned window (C.5), also the coordinate along an axis window (kind axis-linear, where t is
  // the position between lo and hi, whatever the axis's sign). Below lo and above hi the coordinate is the
  // end and the mark is counted (LOW/HIGH); exactly on an endpoint it is EXACT_*, drawn at the end and not
  // counted as out of range.
  function sclWindowEvaluator(lo, hi) {
    const span = hi - lo;
    return function (x, out) {
      out.state = null;
      if (x < lo) {
        out.t = 0;
        out.clip = sclLow;
      } else if (x > hi) {
        out.t = 1;
        out.clip = sclHigh;
      } else if (x === lo) {
        out.t = 0;
        out.clip = sclExactLow;
      } else if (x === hi) {
        out.t = 1;
        out.clip = sclExactHigh;
      } else {
        out.t = (x - lo) / span;
        out.clip = sclNone;
      }
      return out;
    };
  }

  // A fixed diverging window (C.5): t in [-1, 1], the arm chosen by the side of `mid`, each arm scaled by
  // its own half-width so a manual window keeps its midpoint. The midpoint is exactly 0 (never -0).
  function sclDivergingEvaluator(lo, hi, mid) {
    const upper = hi - mid;
    const lower = mid - lo;
    return function (x, out) {
      out.state = null;
      if (x < lo) {
        out.t = -1;
        out.clip = sclLow;
      } else if (x > hi) {
        out.t = 1;
        out.clip = sclHigh;
      } else if (x === lo) {
        out.t = -1;
        out.clip = sclExactLow;
      } else if (x === hi) {
        out.t = 1;
        out.clip = sclExactHigh;
      } else {
        out.t = x >= mid ? (x - mid) / upper : (x - mid) / lower;
        out.clip = sclNone;
      }
      return out;
    };
  }

  // Zero-only (C.4, DD-95): a measured zero is fine; any other value is out of domain until a fit
  // replaces this calibration. It is clipped (HIGH, on its own side for a signed mapping), flagged with
  // state "out-of-domain" and therefore COUNTED by the warning tally, never silently coloured.
  function sclZeroEvaluator(signed) {
    return function (x, out) {
      if (x === 0) {
        out.t = 0;
        out.clip = sclNone;
        out.state = null;
      } else {
        out.t = signed && x < 0 ? -1 : 1;
        out.clip = sclHigh;
        out.state = "out-of-domain";
      }
      return out;
    };
  }

  function sclNoneEvaluator(x, out) {
    out.t = 0;
    out.clip = sclNone;
    out.state = "no-calibration";
    return out;
  }

  function sclBuildPlan(desc) {
    const p = desc.params;
    let evaluate;
    switch (desc.kind) {
      case "value-log1p":
        evaluate = sclLogEvaluator(desc.signed, p.U, p.k);
        break;
      case "value-linear":
        evaluate = sclLinearEvaluator(desc.signed, p.U);
        break;
      case "rank-type7-257":
        if (!Array.isArray(p.knots) || p.knots.length !== LIMITS.RANK_KNOTS) throw new TypeError("plan: a rank descriptor needs " + LIMITS.RANK_KNOTS + " knots");
        evaluate = sclRankEvaluator(p.knots);
        break;
      case "fixed-linear":
      case "axis-linear":
        evaluate = sclWindowEvaluator(p.lo, p.hi);
        break;
      case "fixed-diverging":
        evaluate = sclDivergingEvaluator(p.lo, p.hi, p.mid);
        break;
      case "zero-only":
        evaluate = sclZeroEvaluator(desc.signed);
        break;
      case "none":
        evaluate = sclNoneEvaluator;
        break;
      default:
        throw new TypeError("plan: unknown descriptor kind " + String(desc.kind));
    }
    return Object.freeze({ signed: desc.signed, kind: desc.kind, apply: evaluate, index: sclIndex });
  }

  // E.scale.plan (API.md A.3, DD-44): the per-descriptor precomputed evaluator {signed, kind, apply(x, out),
  // index}. It captures 1/log1p(U/k), U, the rank arrays and the window once; a Frame holds the plan and
  // `encode` does no per-cell setup. Cached per descriptor OBJECT. It trusts the descriptor (`validate`
  // is the import gate) but refuses one it cannot evaluate.
  function sclPlan(desc) {
    if (desc === null || typeof desc !== "object") throw new TypeError("plan needs a descriptor object");
    let plan = sclPlans.get(desc);
    if (plan === undefined) {
      plan = sclBuildPlan(desc);
      sclPlans.set(desc, plan);
    }
    return plan;
  }

  // E.scale.apply (API.md A.3, C.4, C.5): the coordinate of one value. Writes out.t (0..1 unsigned, -1..1
  // signed), out.clip (CLIP) and out.state (null | "out-of-domain" | "no-calibration") and returns `out`.
  function sclApply(desc, x, out) {
    return sclPlan(desc).apply(x, out);
  }

  // E.scale.sameWithin (API.md A.3, C.10, DD-19): are two descriptors the same mapping within tolerance?
  // Auto uses it to KEEP its active descriptor when a refit differs only by last-bit jitter (a new id would
  // raise a spurious "Scale changed"). `a` is the active one. Same id, or same kind/signedness/clip and
  // every parameter (U, k, lo, hi, mid, or every rank knot) within THRESHOLDS.TOL_REL of a's own value.
  function sclSameWithin(a, b) {
    if (a === b) return true;
    if (!sclIsObject(a) || !sclIsObject(b)) return false;
    if (typeof a.id === "string" && a.id === b.id) return true;
    if (a.kind !== b.kind || a.signed !== b.signed || a.clip !== b.clip) return false;
    const pa = a.params;
    const pb = b.params;
    if (pa === null || pb === null) return pa === pb;
    if (!sclIsObject(pa) || !sclIsObject(pb)) return false;
    const near = (x, y) => sclIsNumber(x) && sclIsNumber(y) && Math.abs(x - y) <= THRESHOLDS.TOL_REL * Math.abs(x);
    const keys = Object.keys(pa);
    if (keys.length !== Object.keys(pb).length) return false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "knots") {
        if (!Array.isArray(pa.knots) || !Array.isArray(pb.knots) || pa.knots.length !== pb.knots.length) return false;
        for (let j = 0; j < pa.knots.length; j++) if (!near(pa.knots[j], pb.knots[j])) return false;
      } else if (key === "q") {
        if (pa.q !== pb.q) return false;
      } else if (!near(pa[key], pb[key])) {
        return false;
      }
    }
    return true;
  }

  // The context inside x: a Ctx itself, or the `ctx` of a Calibration; null for a bare descriptor.
  function sclCtxOf(x) {
    if (!sclIsObject(x)) return null;
    if (sclIsObject(x.ctx)) return x.ctx;
    return x.consumer !== undefined ? x : null;
  }

  function sclVersionOf(ctx) {
    const at = ctx && typeof ctx.formula === "string" ? ctx.formula.lastIndexOf("@") : -1;
    return at < 0 ? null : ctx.formula.slice(at + 1);
  }

  // E.scale.compat (API.md A.3, C.8, DR-07, S1-101..106): may a held (Comparison-lock) mapping serve this
  // other measure? Two contexts (or Calibrations, or bare descriptors) are compatible when their
  // compatibility classes are equal (E.context.compatClass: formula family, transform kind, signedness,
  // rank algorithm) and the formula versions agree. {ok:true}, or {ok:false, reason} with one of:
  // "amount vs intensity", "different formula family", "signed vs unsigned", "different transform",
  // "different rank algorithm", "different formula version". A bare descriptor carries no family or
  // version, so those two checks are skipped for it. Cells Amount and Rows Amount share a class: reuse is
  // allowed only through an explicit lock, which is the caller's rule, not this predicate's (S1-105).
  function sclCompat(a, b) {
    if (!API.context) throw new Error("E.scale.compat needs E.context (part 10-context)");
    const ka = API.context.compatClass(a).split("|");
    const kb = API.context.compatClass(b).split("|");
    const ca = sclCtxOf(a);
    const cb = sclCtxOf(b);
    if (ka[0] !== "-" && kb[0] !== "-" && ka[0] !== kb[0]) {
      const pair = ca && cb && ca.measure === cb.measure && ((ca.basis === "amount" && cb.basis === "intensity") || (ca.basis === "intensity" && cb.basis === "amount"));
      return { ok: false, reason: pair ? "amount vs intensity" : "different formula family" };
    }
    if (ka[2] !== kb[2]) return { ok: false, reason: "signed vs unsigned" };
    if (ka[1] !== kb[1]) return { ok: false, reason: "different transform" };
    if (ka[3] !== kb[3]) return { ok: false, reason: "different rank algorithm" };
    if (ca && cb && sclVersionOf(ca) !== sclVersionOf(cb)) return { ok: false, reason: "different formula version" };
    return { ok: true };
  }

  API.scale = Object.freeze({
    fitValue: sclFitValue,
    fitRank: sclFitRank,
    fixed: sclFixed,
    manual: sclManual,
    zeroOnly: sclZeroOnly,
    canonical: sclCanonical,
    id: sclId,
    validate: sclValidate,
    plan: sclPlan,
    apply: sclApply,
    CLIP: sclClip,
    index: sclIndex,
    sameWithin: sclSameWithin,
    compat: sclCompat,
  });

  // == §09-cohort ==
  // @part 09-cohort
  // @requires 03-result 05-measure
  // @prefix coh
  // @provides cohort
  // == §09 cohort: which observations a calibration is fitted on (API.md B.6, C.4.3, DD-12, DD-73, DD-88) ==
  // A cohort is the list of finite values a fit sees, plus the ledger of what was left out and why. It is
  // extracted from the CURRENT frame inputs at fire time (the page hands over what it draws, never a
  // captured copy, DD-88), off the draw path, once per settled fit: O(observations), no sort here (the fit
  // sorts). Pure and stateless: nothing is cached and the inputs are never mutated.
  //
  // What makes a cell a member (S1-081, D4): it is fully covered, at the EFFECTIVE level, by the declared
  // rectangle, by the cutoff and by the data edge, it is measured (not a placeholder the page stands in for
  // an unread cell), and its measure has a finite value. Everything else is counted, never silently
  // dropped, in one of seven buckets: partial, open, unread, nonFinite, negative, stale, placeholder.
  // Measured zeros ARE members (they are counted in `zeros` and decide the zero-only case of a fit, S1-074);
  // a placeholder can never create one (S1-075).
  //
  // A cohort that cannot be taken yet is not a smaller cohort, it is `{ok: false, reason}`: a failed,
  // pending, unsupported, stale or updating read, or a tier that is still loading, must never fit (a partial
  // arrival, a terminal failure or an initial placeholder would otherwise calibrate on a fragment, S1-115).
  // Programmer errors (a missing array, an unknown mode, no level) throw, exactly as the measure kernels do
  // (DR-39e); data problems are typed results.
  //
  // `columns` returns COUNTS ONLY and never a fit (DD-12, DD-73): an axis is autoscaled over every displayed
  // value (C.12), so the counts only tell the axis record how many of them were complete.

  // Tag indexes of E.result.TAGS (part 03), captured at load time so a cell's value is classified by a
  // small integer, never by a string compare per cell.
  const cohTag = API.result.TAG;
  const cohFinite = cohTag["finite"];
  const cohInvalid = cohTag["invalid-input"];
  const cohPending = cohTag["pending"];
  const cohFailed = cohTag["failed"];
  const cohHidden = cohTag["hidden"];
  const cohUnsupported = cohTag["unsupported"];
  // The read states that may calibrate (data-lifecycle 4.1: meas.state in exact, recorded, cube).
  const cohReadyStates = Object.freeze(["exact", "recorded", "cube"]);
  // Why a cohort is refused, most severe first. The order decides which reason is reported when several
  // reads disagree: a failed read is the one the viewer must be told about.
  const cohRefusals = Object.freeze(["failed", "unsupported", "pending", "stale", "updating", "loading"]);
  const cohCalibratedOn = Object.freeze(["view", "selection", "period", "lens"]);

  function cohNumber(x, fallback) {
    return typeof x === "number" && !Number.isNaN(x) ? x : fallback;
  }

  function cohNewExcluded() {
    return { partial: 0, open: 0, unread: 0, nonFinite: 0, negative: 0, stale: 0, placeholder: 0 };
  }

  // The refusal of ONE read record {state, updating?, stale?, loading?}, or null when it may calibrate. A
  // read that has not said it is exact, recorded or cube has not answered: pending.
  function cohReadRefusal(read) {
    if (read === null || read === undefined) return null;
    const state = read.state;
    if (state === "failed") return "failed";
    if (state === "unsupported") return "unsupported";
    if (cohReadyStates.indexOf(state) < 0) return "pending";
    if (read.stale) return "stale";
    if (read.updating) return "updating";
    if (read.loading) return "loading";
    return null;
  }

  // The most severe refusal among the reads a consumer needs (one record or an array of them) and the
  // page-wide `loading` flag (any tier still loading, the predicate the UI already uses for its hatching).
  function cohRefusal(read, loading) {
    let worst = loading ? cohRefusals.indexOf("loading") : -1;
    let found = worst >= 0;
    const reads = Array.isArray(read) ? read : [read];
    for (let i = 0; i < reads.length; i++) {
      const why = cohReadRefusal(reads[i]);
      if (why === null) continue;
      const rank = cohRefusals.indexOf(why);
      if (!found || rank < worst) worst = rank;
      found = true;
    }
    return found ? cohRefusals[worst] : null;
  }

  function cohStep(input, key, letter) {
    if (input[key] !== undefined) return input[key];
    if (input.level) return Math.pow(2, input.level[letter]);
    throw new TypeError("a cohort needs level {n, m} (or the steps ts and ps)");
  }

  function cohRect(b) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every((x) => typeof x === "number" && !Number.isNaN(x))) throw new TypeError("a cohort needs the measured rectangle b = [t0, t1, r0, r1]");
    return b;
  }

  function cohFiniteAll(list) {
    return list.every(Number.isFinite);
  }

  // The level of a record: the given {n, m}, or the powers of two the steps are, or null (an unusual step
  // has no level to name).
  function cohLevel(input, ts, ps) {
    if (input.level) return { n: input.level.n, m: input.level.m };
    const n = Math.log2(ts);
    const m = Math.log2(ps);
    return Number.isInteger(n) && Number.isInteger(m) ? { n, m } : null;
  }

  function cohQuality(input) {
    if (typeof input.quality === "string") return input.quality;
    const reads = Array.isArray(input.read) ? input.read : [input.read];
    for (let i = 0; i < reads.length; i++) if (reads[i] && typeof reads[i].state === "string") return reads[i].state;
    return null;
  }

  // What the cohort was taken on (A-13c): the declared rectangle AT INIT, so a later selection never
  // refits Explore; the lens and the Rows period name themselves.
  function cohCalibratedOnOf(input, fallback) {
    if (cohCalibratedOn.indexOf(input.calibratedOn) >= 0) return input.calibratedOn;
    return input.selection ? "selection" : fallback;
  }

  // The bucket of a non-finite kernel result. A typed non-value is never a member: a read that has not
  // answered is `unread`, an invalid number is `nonFinite`, and a cell that has nothing to measure (Size
  // without trades, Flow without volume, a Cascade cell without a comparable parent) is a `placeholder`,
  // so none of them can manufacture a zero cohort.
  function cohBucketOf(tag) {
    if (tag === cohInvalid) return "nonFinite";
    if (tag === cohPending || tag === cohFailed || tag === cohHidden || tag === cohUnsupported) return "unread";
    return "placeholder";
  }

  // The cells cohort (C.4.3), shared by cells, motionCells and the lens. Returns the Cohort record or
  // {ok: false, reason}.
  function cohCollect(kind, input) {
    if (input === null || typeof input !== "object") throw new TypeError("E.cohort needs an input object");
    if (!Array.isArray(input.cells)) throw new TypeError("E.cohort needs the cells array");
    const mode = input.mode;
    const spec = API.measure.MODES[mode];
    if (!spec) throw new TypeError("unknown measure mode: " + String(mode));
    const b = cohRect(input.b);
    const ts = cohStep(input, "ts", "n");
    const ps = cohStep(input, "ps", "m");
    const refusal = cohRefusal(input.read, input.loading);
    if (refusal !== null) return { ok: false, reason: refusal };
    // The geometry (occupancy) has no value to fit.
    if (spec.kind === "occupancy") return { ok: false, reason: "unsupported" };
    const geom = input.geom || LATTICE;
    const cut = cohNumber(input.cut, Infinity);
    const end = cohNumber(input.end, Infinity);
    const CUT = cohNumber(input.CUT, Infinity);
    const replay = Boolean(input.replay);
    const measured = typeof input.measured === "function" ? input.measured : null;
    // The data edge a whole cell must not cross: the cutoff, the motion end and, live, the open column (in
    // replay the live edge is a choice, not a limit, so CUT does not apply).
    const edge = Math.min(cut, end, replay ? Infinity : CUT);
    // One kernel and one exposure scratch for the whole pass (the frame's own pattern, DD-85). `measured`
    // and `read` stay out of the kernel: they are decided here, before any value is computed.
    const k = {
      mode,
      basis: input.basis,
      pathBasis: input.pathBasis,
      z: null,
      bounds: b,
      cut,
      end,
      CUT,
      replay,
      geom,
      ts,
      ps,
      level: input.level,
      read: null,
      measured: undefined,
      cascade: input.cascade,
    };
    const out = { tag: 0, value: NaN, signed: false, short: false, reason: null, denominator: null };
    const scratch = {};
    const cells = input.cells;
    const buf = new Float64Array(cells.length);
    const excluded = cohNewExcluded();
    let n = 0;
    let zeros = 0;
    let t0 = Infinity;
    let t1 = -Infinity;
    let r0 = Infinity;
    let r1 = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const z = cells[i];
      // A placeholder (an unread base cell, a motion cell at or after the motion end) is not a member and
      // cannot create a zero cohort. The motion end is also tested here: a cell that starts at or after it
      // was never read, whether or not the page supplied `measured`.
      if ((measured !== null && measured(z) === false) || z.c * ts >= end) {
        excluded.unread++;
        continue;
      }
      if ((z.c + 1) * ts > edge) {
        excluded.open++;
        continue;
      }
      const ex = API.measure.exposure(z, b, cut, end, ts, ps, geom, scratch);
      if (ex.timeFraction < 1 || ex.priceFraction < 1) {
        excluded.partial++;
        continue;
      }
      k.z = z;
      API.measure.cellValue(k, out);
      if (out.tag !== cohFinite) {
        excluded[cohBucketOf(out.tag)]++;
        continue;
      }
      // An unsigned measure takes no negative value (they are counted, not clamped).
      if (!out.signed && out.value < 0) {
        excluded.negative++;
        continue;
      }
      buf[n++] = out.value;
      if (out.value === 0) zeros++;
      if (z.c * ts < t0) t0 = z.c * ts;
      if ((z.c + 1) * ts > t1) t1 = (z.c + 1) * ts;
      if (z.r * ps < r0) r0 = z.r * ps;
      if ((z.r + 1) * ps > r1) r1 = (z.r + 1) * ps;
    }
    return {
      kind,
      values: buf.slice(0, n),
      n,
      zeros,
      nonzero: n - zeros,
      excluded,
      calibratedOn: cohCalibratedOnOf(input, "view"),
      bounds: cohFiniteAll(b) ? b.slice() : null,
      level: cohLevel(input, ts, ps),
      quality: cohQuality(input),
      // The latest edge any member observed (<= the cutoff by construction), and the rectangle the members
      // span in base units: time columns and price rows.
      obsEndBase: n > 0 ? t1 : null,
      support: n > 0 ? { timeBase: [t0, t1], priceRows: [r0, r1] } : { timeBase: null, priceRows: null },
    };
  }

  // E.cohort.cells (API.md C.4.3, S1-081): the fully covered, measured cells of `input.cells` (the drawn
  // cells at the effective level) inside the declared rectangle `b`.
  //   input = { cells, mode, basis, pathBasis, b: [t0,t1,r0,r1], cut, end, CUT, replay, level: {n, m}
  //             (or ts, ps), geom, measured(z), cascade(z, out), read, loading, selection, quality,
  //             calibratedOn, kind }
  // `read` is one read record {state, updating?, stale?, loading?} or an array of them (every read the
  // consumer needs); `selection` says the rectangle is a selection; `kind: "lens"` and `calibratedOn:
  // "lens"` name the lens cohort (the same extraction over the lens rectangle). `end` is Infinity for the
  // volume measures and the motion end for Path and Dwell; `cut` the effective cutoff, `CUT` the live edge.
  function cohCells(input) {
    const kind = input && input.kind === "lens" ? "lens" : "cells";
    return cohCollect(kind, input);
  }

  // E.cohort.motionCells (API.md C.4.3): the same over the motion summary's cells (mv.shown.cells),
  // movement-only cells (ct = 0 with path or dwell) included when they are measured. A base cell of the
  // displayed block that has no motion entry is not in this array; if the page keeps it there,
  // `measured(z)` says false and it is counted `unread`.
  function cohMotionCells(input) {
    return cohCollect("motion", input);
  }

  // E.cohort.rows (API.md C.4.3, S1-083, DD-74): ALL measured rows of the declared period at the effective
  // row size `m`, including rows that are off screen (a peak row off screen still sets U).
  //   input = { rows: [{r, v, bv, w}], measure: "volume" | "delta" | "time", m, res: {state, span?, end?,
  //             stale?}, stale, span: [a, b], cut }
  // Each measure is read only from the result that carries it: the caller passes the rows of the VOLUME
  // result for volume and delta and those of the DWELL result for time (a dwell result's bands have v = bv =
  // 0, so volume read from them would be a false all-zero cohort, rows-underlay gotcha 5). A missing field
  // is a non-number and is counted `nonFinite`, never read as zero. `span` is the period's span as the
  // page has it NOW: a result that ends elsewhere is the previous period's and is refused as stale (a fit
  // made from it would calibrate the new period on the old one, data-lifecycle 1.10 #4). Relative volume has
  // a fixed domain and no cohort.
  function cohRows(input) {
    if (input === null || typeof input !== "object") throw new TypeError("E.cohort needs an input object");
    if (!Array.isArray(input.rows)) throw new TypeError("E.cohort.rows needs the rows array");
    const measure = input.measure;
    const spec = API.measure.ROWS[measure];
    if (!spec) throw new TypeError("unknown Rows measure: " + String(measure));
    if (!Number.isInteger(input.m) || input.m < 0) throw new TypeError("E.cohort.rows needs the effective row size m (a non-negative integer)");
    // Relative volume is a fixed domain: there is no cohort, whatever the reads say.
    if (spec.kind !== "unbounded") return { ok: false, reason: "unsupported" };
    const res = input.res || null;
    if (res !== null && res.state === "failed") return { ok: false, reason: "failed" };
    const periodSpan = Array.isArray(input.span) ? input.span : null;
    const resSpan = res !== null && Array.isArray(res.span) ? res.span : null;
    if (input.stale || (res !== null && res.stale) || (periodSpan !== null && resSpan !== null && resSpan[1] !== periodSpan[1])) return { ok: false, reason: "stale" };
    if (res === null || res.state !== "ready") return { ok: false, reason: "pending" };
    const cut = cohNumber(input.cut, Infinity);
    const rows = input.rows;
    const buf = new Float64Array(rows.length);
    const excluded = cohNewExcluded();
    let n = 0;
    let zeros = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const x = rows[i];
      const value = measure === "volume" ? x.v : measure === "delta" ? 2 * x.bv - x.v : x.w;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        excluded.nonFinite++;
        continue;
      }
      if (!spec.signed && value < 0) {
        excluded.negative++;
        continue;
      }
      buf[n++] = value;
      if (value === 0) zeros++;
      if (x.r < lo) lo = x.r;
      if (x.r > hi) hi = x.r;
    }
    // Where the result observed to: the period's end (Time at price: the last complete base column the
    // dwell covers), never beyond the cutoff.
    const edge = measure === "time" && res.end !== undefined ? res.end : resSpan !== null ? resSpan[1] : periodSpan !== null ? periodSpan[1] : null;
    const obsEndBase = typeof edge === "number" && Number.isFinite(edge) ? Math.min(edge, cut) : null;
    const from = resSpan !== null ? resSpan[0] : periodSpan !== null ? periodSpan[0] : null;
    const step = Math.pow(2, input.m);
    return {
      kind: "rows",
      values: buf.slice(0, n),
      n,
      zeros,
      nonzero: n - zeros,
      excluded,
      calibratedOn: "period",
      bounds: null,
      level: null,
      quality: typeof input.quality === "string" ? input.quality : null,
      obsEndBase,
      support: {
        timeBase: obsEndBase !== null && typeof from === "number" && Number.isFinite(from) ? [from, obsEndBase] : null,
        priceRows: n > 0 && Number.isFinite(lo) ? [lo * step, (hi + 1) * step] : null,
      },
    };
  }

  // E.cohort.columns (API.md C.4.3, DD-12, DD-73): COUNTS ONLY over the displayed columns of a pane measure,
  // {n, complete, partial, open, zeros}. `open` is a column that runs past the cutoff, the data end or (live)
  // the open column; `partial` one that sticks out of the measured time range; `complete` the rest. `zeros`
  // counts the displayed columns whose measure is a finite zero. It never returns values and it is never a
  // fit: the axis scans the displayed values itself and only reports these counts in its provenance.
  //   input = { columns: [{c, ...column summary}], key: a E.measure.columnValue key, b, cut, end, CUT,
  //             replay, level: {n} (or ts), ctx | ctxFor(col) }
  function cohColumns(input) {
    if (input === null || typeof input !== "object") throw new TypeError("E.cohort needs an input object");
    if (!Array.isArray(input.columns)) throw new TypeError("E.cohort.columns needs the columns array");
    if (typeof input.key !== "string") throw new TypeError("E.cohort.columns needs the column measure key");
    const b = cohRect(input.b);
    const ts = cohStep(input, "ts", "n");
    const cut = cohNumber(input.cut, Infinity);
    const end = cohNumber(input.end, Infinity);
    const CUT = cohNumber(input.CUT, Infinity);
    const edge = Math.min(cut, end, input.replay ? Infinity : CUT);
    const ctxFor = typeof input.ctxFor === "function" ? input.ctxFor : null;
    const out = { tag: 0, value: NaN, reason: null, denominator: null };
    const cols = input.columns;
    let partial = 0;
    let open = 0;
    let zeros = 0;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if ((col.c + 1) * ts > edge) open++;
      else if (col.c * ts < b[0] || (col.c + 1) * ts > b[1]) partial++;
      API.measure.columnValue(input.key, col, ctxFor !== null ? ctxFor(col) : input.ctx, out);
      if (out.tag === cohFinite && out.value === 0) zeros++;
    }
    return { n: cols.length, complete: cols.length - partial - open, partial, open, zeros };
  }

  API.cohort = Object.freeze({
    cells: cohCells,
    motionCells: cohMotionCells,
    rows: cohRows,
    columns: cohColumns,
  });

  // == §10-context ==
  // @part 10-context
  // @requires 01-util
  // @prefix ctx
  // @provides context
  // == §10 context: the identity of a calibration context, its key string, period identities and the Comparison-lock class (API.md B.7, C.8) ==
  // A context key says WHICH calibration a mapping belongs to: the measure and its basis and unit, the
  // transform, the measurement quality, the workspace and, for Cells, the EFFECTIVE level (n, m), for Rows the
  // period identity and the effective row size. It is NOT a mapping id (the id hashes the numbers of the
  // mapping, C.7) and no key equals an id. Pure: nothing here reads a clock or the page.

  // The catalogue of API.md B.3 as this part needs it: the formula id, the compatibility family, the
  // canonical unit and whether the measure is signed, per (measure, basis). It repeats E.measure.FORMULAS on
  // purpose (part 05 is not a dependency of this part, so contexts can be built and tested without it);
  // U24 compares the two tables whenever both parts are loaded, so a change of one without the other fails.
  // `fixed` measures have a natural fixed domain and no store; they still get a key (disclosure, diff).
  const ctxCellFormulas = Object.freeze({
    volume: Object.freeze({
      amount: Object.freeze({ formula: "cells.volume.amount@1", family: "amount.usdt", unit: "usdt", signed: false }),
      intensity: Object.freeze({ formula: "cells.volume.intensity@1", family: "intensity.usdt", unit: "usdt-per-min-per-125usdt", signed: false }),
    }),
    trades: Object.freeze({
      amount: Object.freeze({ formula: "cells.trades.amount@1", family: "amount.trades", unit: "trades", signed: false }),
      intensity: Object.freeze({ formula: "cells.trades.intensity@1", family: "intensity.trades", unit: "trades-per-min-per-125usdt", signed: false }),
    }),
    delta: Object.freeze({
      amount: Object.freeze({ formula: "cells.delta.amount@1", family: "delta.usdt", unit: "usdt", signed: true }),
      intensity: Object.freeze({ formula: "cells.delta.intensity@1", family: "intensity.delta", unit: "usdt-per-min-per-125usdt", signed: true }),
    }),
    size: Object.freeze({
      mean: Object.freeze({ formula: "cells.size.mean@1", family: "size.usdt-per-trade", unit: "usdt-per-trade", signed: false }),
    }),
    path: Object.freeze({
      spans: Object.freeze({ formula: "cells.path.spans@1", family: "path.spans", unit: "row-spans", signed: false }),
      usdt: Object.freeze({ formula: "cells.path.usdt@1", family: "path.usdt", unit: "usdt", signed: false }),
      perMinute: Object.freeze({ formula: "cells.path.perminute@1", family: "path.perminute", unit: "row-spans-per-min", signed: false }),
    }),
    dwell: Object.freeze({ share: Object.freeze({ formula: "cells.dwell.share@1", family: "fixed.share", unit: "share", signed: false }) }),
    flow: Object.freeze({ share: Object.freeze({ formula: "cells.flow.share@1", family: "fixed.share", unit: "share", signed: true }) }),
    flowtrades: Object.freeze({ share: Object.freeze({ formula: "cells.flowtrades.share@1", family: "fixed.share", unit: "share", signed: true }) }),
    cascade: Object.freeze({ log2: Object.freeze({ formula: "cells.cascade.log2@1", family: "fixed.log2-ratio", unit: "log2-ratio", signed: true }) }),
  });
  // The Cells measures that have a natural fixed domain, and the ones Rank is offered for (unsigned unbounded
  // measures only, DD-09).
  const ctxCellFixed = Object.freeze(["dwell", "flow", "flowtrades", "cascade"]);
  const ctxCellRank = Object.freeze(["volume", "trades", "size", "path"]);
  // The default basis of a measure when the caller gives none, and the only basis of a measure that has one.
  const ctxCellDefaultBasis = Object.freeze({ volume: "amount", trades: "amount", delta: "amount", size: "mean", path: "spans", dwell: "share", flow: "share", flowtrades: "share", cascade: "log2" });

  const ctxRowFormulas = Object.freeze({
    volume: Object.freeze({ formula: "rows.volume.amount@1", family: "amount.usdt", unit: "usdt", signed: false, basis: "period-amount-per-row" }),
    delta: Object.freeze({ formula: "rows.delta.amount@1", family: "delta.usdt", unit: "usdt", signed: true, basis: "period-amount-per-row" }),
    time: Object.freeze({ formula: "rows.time.seconds@1", family: "time.seconds", unit: "seconds", signed: false, basis: "period-amount-per-row" }),
    relvol: Object.freeze({ formula: "rows.relvol@2", family: "fixed.log2-ratio", unit: "log2-ratio", signed: true, basis: "log2-ratio" }),
  });
  const ctxRowFixed = Object.freeze(["relvol"]);
  const ctxRowRank = Object.freeze(["volume", "time"]);

  // formula name WITHOUT its version -> {family, signed}: what compatClass reads from a context. The version
  // is not part of the class (E.scale.compat compares it separately and names it), so a mapping persisted
  // under an older formula version still has a class and is refused for its version, not for an unknown name.
  const ctxFormulaFacts = ctxIndexFormulas();

  function ctxFormulaName(formula) {
    const at = typeof formula === "string" ? formula.lastIndexOf("@") : -1;
    return at < 0 ? formula : formula.slice(0, at);
  }

  function ctxIndexFormulas() {
    const facts = {};
    const measures = Object.keys(ctxCellFormulas);
    for (let i = 0; i < measures.length; i++) {
      const bases = Object.keys(ctxCellFormulas[measures[i]]);
      for (let j = 0; j < bases.length; j++) {
        const f = ctxCellFormulas[measures[i]][bases[j]];
        facts[ctxFormulaName(f.formula)] = Object.freeze({ family: f.family, signed: f.signed });
      }
    }
    const rows = Object.keys(ctxRowFormulas);
    for (let i = 0; i < rows.length; i++) {
      const f = ctxRowFormulas[rows[i]];
      facts[ctxFormulaName(f.formula)] = Object.freeze({ family: f.family, signed: f.signed });
    }
    return Object.freeze(facts);
  }

  const ctxWorkspaces = Object.freeze(["live", "replay"]);
  // The grammar of a Rows period identity (periodIdentity below writes exactly these) and of a quality.
  const ctxPeriodPattern = /^(roll:[1-9][0-9]*|cal:(wk|mo|yr):[0-9]{4}-[0-9]{2}-[0-9]{2}|day:[0-9]{4}-[0-9]{2}-[0-9]{2}|all:[0-9]{4}-[0-9]{2}-[0-9]{2})$/;
  const ctxRowQualityPattern = /^(exact|approx-start|approx-rows:[1-9][0-9]*)$/;
  // The rolling periods of the page's LINES, in days: the fallback when the environment gives no `days`.
  const ctxRollingDays = Object.freeze({ "1d": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365, "3y": 1095 });
  const ctxDayPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

  // A real calendar date written YYYY-MM-DD (the page's isDay also demands it be the UTC day it names).
  function ctxRealDay(text) {
    if (!ctxDayPattern.test(text)) return false;
    const y = +text.slice(0, 4);
    const mo = +text.slice(5, 7);
    const d = +text.slice(8, 10);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const last = mo === 2 ? (leap ? 29 : 28) : mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31;
    return mo >= 1 && mo <= 12 && d >= 1 && d <= last;
  }

  function ctxIsObject(x) {
    return x !== null && typeof x === "object" && Object.prototype.toString.call(x) === "[object Object]";
  }

  function ctxLevel(x, name) {
    if (!Number.isInteger(x) || x < 0) throw new RangeError("context: " + name + " must be a non-negative integer");
    return x;
  }

  // A text field of a key: never contains the separator, so the key string is injective.
  function ctxText(x, name) {
    if (typeof x !== "string" || x.length === 0 || x.length > LIMITS.STRING_MAX || x.indexOf("|") >= 0) throw new RangeError("context: " + name + " must be a short text without \"|\"");
    return x;
  }

  function ctxWorkspace(spec) {
    const ws = spec.workspace === undefined ? "live" : spec.workspace;
    if (ctxWorkspaces.indexOf(ws) < 0) throw new RangeError("context: workspace must be live or replay");
    return ws;
  }

  // The `transform` field of B.7 (DD-43): "value-log", "value-linear", "rank", or "fixed" for a measure with
  // a natural fixed domain. The caller may pass what E.policy.effective returns ({transform:"value"|"rank",
  // curve:"log"|"linear"}) or the finished names. A curve change is a different context, so a linear fit never
  // overwrites a log fit.
  function ctxTransform(spec, fixed, rankOk, measure) {
    if (fixed) return "fixed";
    const t = spec.transform === undefined ? "value" : spec.transform;
    if (t === "rank") {
      if (!rankOk) throw new RangeError("context: rank is not offered for " + measure);
      return "rank";
    }
    if (t === "value" || t === "value-log" || t === "value-linear") {
      const curve = t === "value-linear" ? "linear" : t === "value-log" ? "log" : spec.curve === undefined ? "log" : spec.curve;
      if (curve !== "log" && curve !== "linear") throw new RangeError("context: curve must be log or linear");
      return "value-" + curve;
    }
    throw new RangeError("context: unknown transform " + String(t));
  }

  // The Cells basis of a measure, from what E.policy.effective gives: Volume, Trades and Delta take
  // `basis` (amount | intensity); Path takes `pathBasis` (spans | usdt | perMinute); every other measure has
  // exactly one basis and ignores what it is given (effective() has already coerced a choice the measure
  // does not offer, and the raw preference must not change the key).
  function ctxCellBasis(spec, measure) {
    if (measure === "path") {
      const pb = spec.pathBasis === undefined ? "spans" : spec.pathBasis;
      if (!Object.prototype.hasOwnProperty.call(ctxCellFormulas.path, pb)) throw new RangeError("context: unknown path basis " + String(pb));
      return pb;
    }
    if (measure === "volume" || measure === "trades" || measure === "delta") {
      const b = spec.basis === undefined ? "amount" : spec.basis;
      if (b !== "amount" && b !== "intensity") throw new RangeError("context: basis must be amount or intensity");
      return b;
    }
    return ctxCellDefaultBasis[measure];
  }

  // E.context.cellsKey (API.md A.3, B.7, DR-06): the Cells context of one displayed level.
  //   spec = {measure (S.mode), basis, pathBasis, transform, curve, n, m, workspace?, instrument?, lens?}
  // n and m are the EFFECTIVE level (renderN, renderM): a requested level that differs while the effective
  // one is equal gives the SAME key, and a coarser-than-requested display keys on the level it shows.
  // Anything else on the spec (theme, token, selection, cutoff, src.id) is ignored: none of it is identity
  // (D4). Quality is `exact` and only `exact`: "approximate" is reserved and is never emitted (DR-08); a
  // spec that asks for another quality throws. `geometry` has no calibration and throws.
  // With spec.lens = {bounds:[b0,b1,b2,b3], n, m} the result is the Local-contrast context of the lens
  // (B.7): {consumer:"lens", base:<the Cells context>, bounds, n, m}. It has its own key and is never stored
  // in the 64-context LRU.
  function ctxCellsKey(spec) {
    if (!ctxIsObject(spec)) throw new TypeError("cellsKey needs a spec object");
    const measure = spec.measure;
    if (typeof measure !== "string" || !Object.prototype.hasOwnProperty.call(ctxCellFormulas, measure)) throw new RangeError("context: no calibration context for measure " + String(measure));
    if (spec.quality !== undefined && spec.quality !== "exact") throw new RangeError("context: Cells quality is exact only");
    const basis = ctxCellBasis(spec, measure);
    const f = ctxCellFormulas[measure][basis];
    const fixed = ctxCellFixed.indexOf(measure) >= 0;
    const ctx = {
      consumer: "cells",
      instrument: spec.instrument === undefined ? "BTC/USDT" : ctxText(spec.instrument, "instrument"),
      measure,
      basis,
      unit: f.unit,
      transform: ctxTransform(spec, fixed, ctxCellRank.indexOf(measure) >= 0, measure),
      formula: f.formula,
      quality: "exact",
      workspace: ctxWorkspace(spec),
      n: ctxLevel(spec.n, "n"),
      m: ctxLevel(spec.m, "m"),
    };
    Object.freeze(ctx);
    if (spec.lens === undefined || spec.lens === null) return ctx;
    const lens = spec.lens;
    if (!ctxIsObject(lens) || !Array.isArray(lens.bounds) || lens.bounds.length !== 4) throw new TypeError("context: a lens needs bounds [b0, b1, b2, b3]");
    for (let i = 0; i < 4; i++) if (typeof lens.bounds[i] !== "number" || !Number.isFinite(lens.bounds[i])) throw new RangeError("context: lens bounds must be finite numbers");
    return Object.freeze({ consumer: "lens", base: ctx, bounds: Object.freeze(lens.bounds.slice()), n: ctxLevel(lens.n, "lens n"), m: ctxLevel(lens.m, "lens m") });
  }

  // E.context.rowsKey (API.md A.3, B.7, DR-08, DR-06): the Rows context of one period at one row size.
  //   spec = {measure (volume | delta | time | relvol), transform, curve, quality, period, rowSize,
  //           workspace?, instrument?}
  // `period` is the identity string of periodIdentity; `rowSize` the effective row size (a level m). There is
  // NO n: Rows do not depend on the column level. Quality is `exact`, `approx-rows:<rowPrice>` (recorded
  // rows coarser than the base row) or `approx-start`; the trimmed start of a coarse period is provenance,
  // not identity. The advancing endpoint of a period is never in the key.
  function ctxRowsKey(spec) {
    if (!ctxIsObject(spec)) throw new TypeError("rowsKey needs a spec object");
    const measure = spec.measure;
    if (typeof measure !== "string" || !Object.prototype.hasOwnProperty.call(ctxRowFormulas, measure)) throw new RangeError("context: no Rows context for measure " + String(measure));
    const f = ctxRowFormulas[measure];
    const quality = spec.quality === undefined ? "exact" : spec.quality;
    if (typeof quality !== "string" || !ctxRowQualityPattern.test(quality)) throw new RangeError("context: unknown Rows quality " + String(quality));
    if (typeof spec.period !== "string" || !ctxPeriodPattern.test(spec.period)) throw new RangeError("context: a Rows period is a periodIdentity string");
    return Object.freeze({
      consumer: "rows",
      instrument: spec.instrument === undefined ? "BTC/USDT" : ctxText(spec.instrument, "instrument"),
      measure,
      basis: f.basis,
      unit: f.unit,
      transform: ctxTransform(spec, ctxRowFixed.indexOf(measure) >= 0, ctxRowRank.indexOf(measure) >= 0, measure),
      formula: f.formula,
      quality,
      workspace: ctxWorkspace(spec),
      period: spec.period,
      rowSize: ctxLevel(spec.rowSize, "rowSize"),
    });
  }

  // E.context.keyString (API.md A.3, B.7): the string whose equality IS context equality.
  //   cells|instrument|measure|basis|unit|transform|formula|quality|workspace|n<n>m<m>
  //   rows |instrument|measure|basis|unit|transform|formula|quality|workspace|<period>|m<rowSize>
  //   lens |<the Cells key string>|b<b0>,<b1>,<b2>,<b3>|n<n>m<m>
  // Every field is free of "|", so two different contexts never share a string. Throws on a malformed
  // context (an import is validated before its keys are used).
  function ctxKeyString(ctx) {
    if (!ctxIsObject(ctx)) throw new TypeError("keyString needs a context object");
    if (ctx.consumer === "lens") {
      if (!ctxIsObject(ctx.base) || ctx.base.consumer !== "cells" || !Array.isArray(ctx.bounds) || ctx.bounds.length !== 4) throw new TypeError("context: a lens context holds a Cells base and four bounds");
      return "lens|" + ctxKeyString(ctx.base) + "|b" + ctx.bounds.join(",") + "|n" + ctxLevel(ctx.n, "lens n") + "m" + ctxLevel(ctx.m, "lens m");
    }
    if (ctx.consumer !== "cells" && ctx.consumer !== "rows") throw new RangeError("context: consumer must be cells or rows");
    const head = [ctx.consumer, ctx.instrument, ctx.measure, ctx.basis, ctx.unit, ctx.transform, ctx.formula, ctx.quality, ctx.workspace];
    for (let i = 0; i < head.length; i++) ctxText(head[i], "field " + i);
    if (ctx.consumer === "cells") return head.join("|") + "|n" + ctxLevel(ctx.n, "n") + "m" + ctxLevel(ctx.m, "m");
    if (typeof ctx.period !== "string" || !ctxPeriodPattern.test(ctx.period)) throw new RangeError("context: a Rows period is a periodIdentity string");
    return head.join("|") + "|" + ctx.period + "|m" + ctxLevel(ctx.rowSize, "rowSize");
  }

  // E.context.equal (API.md A.3, C.8): exact-key equality (keys and counts, never volumes).
  function ctxEqual(a, b) {
    if (!ctxIsObject(a) || !ctxIsObject(b)) return false;
    return ctxKeyString(a) === ctxKeyString(b);
  }

  // E.context.periodIdentity (API.md A.3, B.7, DR-06, D4): what a Rows period IS, so that a period that
  // grows does not become a new context every minute and a rollover does.
  //   rolling  1d 7d 30d 90d 1y 3y -> "roll:<days>"         (the duration; span[0] slides and is not identity)
  //   calendar wk mo yr            -> "cal:<wk|mo|yr>:<UTC date of span[0]>"   (the resolved start)
  //   a chosen day YYYY-MM-DD      -> "day:<that date>"      (its anchor)
  //   all history                  -> "all:<UTC date of T0>" (the history start, 2021-01-01)
  // `span` is [start, end] in base columns as the page's lineSpan gives it; its end is never used.
  // env = {days?(key) -> number, T0?, BASE?}: the page passes its LINES table and PACK.t0/base_seconds; the
  // defaults are the recorded lattice and the page's rolling periods. An unknown key throws.
  function ctxPeriodIdentity(key, span, env) {
    const e = env || {};
    const T0 = e.T0 === undefined ? LATTICE.T0 : e.T0;
    const BASE = e.BASE === undefined ? LATTICE.BASE : e.BASE;
    if (typeof key !== "string") throw new TypeError("periodIdentity needs a period key");
    if (key === "all") return "all:" + API.time.utcDay(T0 * 1000);
    if (key === "wk" || key === "mo" || key === "yr") {
      if (!Array.isArray(span) || typeof span[0] !== "number" || !Number.isFinite(span[0])) throw new TypeError("periodIdentity: a calendar period needs its span");
      return "cal:" + key + ":" + API.time.utcDay(API.time.baseToMs(span[0], T0, BASE));
    }
    if (ctxRealDay(key)) return "day:" + key;
    const days = typeof e.days === "function" ? e.days(key) : ctxRollingDays[key];
    if (typeof days !== "number" || !Number.isFinite(days) || days <= 0 || days !== Math.floor(days)) throw new RangeError("periodIdentity: unknown period " + key);
    return "roll:" + days;
  }

  // The fields a diff compares, in the order `changed` lists them; a lens context is flattened to its Cells
  // base plus its own level and bounds.
  const ctxDiffFields = Object.freeze(["consumer", "instrument", "measure", "basis", "unit", "transform", "formula", "quality", "workspace", "n", "m", "period", "rowSize", "lensN", "lensM", "lensBounds"]);

  function ctxFlat(ctx) {
    if (ctx.consumer === "lens") {
      const flat = Object.assign({}, ctx.base);
      flat.consumer = "lens";
      flat.lensN = ctx.n;
      flat.lensM = ctx.m;
      flat.lensBounds = ctx.bounds.join(",");
      return flat;
    }
    return ctx;
  }

  // E.context.diff (API.md A.3, C.8, A-39): what changed between two contexts and why it is disclosed.
  //   changed  the field names that differ (in ctxDiffFields order)
  //   cause    the causes joined with "/" in this order, each a key of E.text.note.cause.*:
  //            resolution (n, m, lens level or rowSize), period, measure, basis, transform, quality,
  //            workspace; both a level and a period change give "resolution/period". A change of measure
  //            subsumes the basis, unit, formula and transform it brings with it. The caller adds `lock`,
  //            `pin`, `policy`, `fit`. null when nothing has a cause (or either side is missing).
  function ctxDiff(prev, next) {
    if (!ctxIsObject(prev) || !ctxIsObject(next)) return { changed: [], cause: null };
    const a = ctxFlat(prev);
    const b = ctxFlat(next);
    const changed = [];
    for (let i = 0; i < ctxDiffFields.length; i++) {
      const name = ctxDiffFields[i];
      if (a[name] !== b[name]) changed.push(name);
    }
    const has = (name) => changed.indexOf(name) >= 0;
    const measure = has("measure");
    const causes = [];
    if (has("n") || has("m") || has("rowSize") || has("lensN") || has("lensM")) causes.push("resolution");
    if (has("period")) causes.push("period");
    if (measure) causes.push("measure");
    if (!measure && (has("basis") || has("unit") || has("formula"))) causes.push("basis");
    if (!measure && has("transform")) causes.push("transform");
    if (has("quality")) causes.push("quality");
    if (has("workspace")) causes.push("workspace");
    return { changed, cause: causes.length ? causes.join("/") : null };
  }

  // The Ctx inside x: a Ctx (a lens through its Cells base), or the `ctx` of a Calibration; null otherwise.
  function ctxOf(x) {
    if (!ctxIsObject(x)) return null;
    const c = ctxIsObject(x.ctx) ? x.ctx : x.consumer !== undefined ? x : null;
    return c && c.consumer === "lens" ? c.base : c;
  }

  // E.context.compatClass (API.md A.3, C.8, DR-07, DD-65): the Comparison-lock class,
  //   family "|" transformKind "|" ("s" | "u") "|" ("type7-257@1" | "-")
  // with transformKind in log1p | linear | rank | fixed. For a Cells Amount context that is
  // "amount.usdt|log1p|u|-", and Rows Amount gives the same string (both are amount.usdt); the held-mapping
  // key adds the channel (DD-65) so the two are still held separately. A bare Descriptor has no family: its
  // family reads "-" and E.scale.compat then skips the family and version checks.
  function ctxCompatClass(x) {
    const ctx = ctxOf(x);
    if (ctx) {
      const facts = ctxFormulaFacts[ctxFormulaName(ctx.formula)];
      if (!facts) throw new RangeError("compatClass: unknown formula " + String(ctx.formula));
      const kind = ctx.transform === "value-log" ? "log1p" : ctx.transform === "value-linear" ? "linear" : ctx.transform === "rank" ? "rank" : ctx.transform === "fixed" ? "fixed" : null;
      if (kind === null) throw new RangeError("compatClass: unknown transform " + String(ctx.transform));
      // The rank algorithm is the one this build writes unless a Calibration carries a descriptor that names
      // another (a mapping imported from a later version): then the classes differ and the lock says why.
      const alg = x.desc && x.desc.kind === "rank-type7-257" && typeof x.desc.algorithm === "string" ? x.desc.algorithm : "type7-257@1";
      return facts.family + "|" + kind + "|" + (facts.signed ? "s" : "u") + "|" + (kind === "rank" ? alg : "-");
    }
    if (!ctxIsObject(x) || typeof x.kind !== "string") throw new TypeError("compatClass needs a context, a calibration or a descriptor");
    const kind = x.kind === "value-log1p" ? "log1p" : x.kind === "value-linear" ? "linear" : x.kind === "rank-type7-257" ? "rank" : x.kind === "zero-only" || x.kind === "none" ? "none" : "fixed";
    const alg = typeof x.algorithm === "string" ? x.algorithm : "type7-257@1";
    return "-|" + kind + "|" + (x.signed ? "s" : "u") + "|" + (kind === "rank" ? alg : "-");
  }

  API.context = Object.freeze({
    cellsKey: ctxCellsKey,
    rowsKey: ctxRowsKey,
    keyString: ctxKeyString,
    equal: ctxEqual,
    periodIdentity: ctxPeriodIdentity,
    diff: ctxDiff,
    compatClass: ctxCompatClass,
  });

  // == §11-lut ==
  // @part 11-lut
  // @requires 01-util 02-hash 03-result
  // @prefix lut
  // @provides lut
  // == §11 lut: appearances, the 256-entry colour tables, the D11 screens and the colour arithmetic (API.md C.6, A.1) ==
  // Everything a colour on the page comes from. An APPEARANCE is a named set of stops per theme; `build`
  // turns it into one 256-entry table per role (unsigned, positive, negative, rows) plus the single-colour
  // roles, all as 8-bit sRGB, so what the legend shows and what the canvas paints are the same bytes. The
  // Lab arithmetic is written here (DR-02) and follows the d3-color convention exactly (D50 white,
  // Bradford-adapted matrices, `cbrt` with the linear toe), so that d3.lab and d3.interpolateLab can serve
  // as independent test oracles without d3 ever being loaded by the module.
  // The appearance id is the first 8 hex of the SHA-256 of the LUT bytes (DD-42): change one byte of one
  // entry and the id changes, so a shared link can say which palette it was made with.

  // d3-color's Lab constants (API.md C.6, DD-13): D50 reference white and the D65-to-D50 adapted matrices.
  const lutXn = 0.96422;
  const lutYn = 1;
  const lutZn = 0.82521;
  const lutT0 = 4 / 29;
  const lutT1 = 6 / 29;
  const lutT2 = 3 * lutT1 * lutT1;
  const lutT3 = lutT1 * lutT1 * lutT1;
  // The unsigned constant-bar colour is entry 160 (t = 0.627): the first entry whose 0.65-opacity composite
  // reaches the 3:1 boundary rule in the light theme (DD-87; the earlier entry 153 composited to 2.94).
  const lutBarIndex = 160;
  const lutRowsAlpha = 0.16;
  const lutDefault = "slate2";
  const lutEntries = 256;

  // The source constants of the two appearances (API.md Appendix A.1). Nine equally spaced stops per theme,
  // interpolated linearly in Lab. `rows` are the pre-composite stops of the Rows-band role (DD-86): the
  // bands are painted at a fixed 16% alpha, so their raw colours must be much stronger than the unsigned
  // ramp for the COMPOSITE to pass the same screens. `ramp1` has no rows stops of its own (its rows ramp is
  // its unsigned ramp and it makes no band claim): it is the baseline yellow-green-blue ramp, kept only as
  // the named comparison appearance for #48. The role hexes are the baseline buy/sell/neutral/border/muted
  // colours renamed by role (DR-02, DR-20); a unit test asserts they equal the CSS tokens.
  const lutRoleColours = {
    light: { midpoint: "#b9c2bc", positive: "#2d769c", negative: "#b3624b", occupancy: "#768d7e", stateInk: "#5c7263", surface: "#ffffff" },
    dark: { midpoint: "#5f6b64", positive: "#73b8d4", negative: "#d89777", occupancy: "#667f6f", stateInk: "#a1b5a7", surface: "#161f19" },
  };
  const lutAppearances = {
    slate2: {
      name: "slate2",
      version: 2,
      unsigned: {
        light: ["#e2e8ee", "#c9d3dd", "#a8b8c8", "#8299b0", "#5f7a95", "#435b76", "#2c4059", "#1a2b40", "#0e1a2b"],
        dark: ["#26313a", "#364552", "#495d70", "#5f7a90", "#7897af", "#96b2c8", "#b4cadb", "#d3e2ee", "#f1f6fa"],
      },
      rows: {
        light: ["#56636f", "#465868", "#384d63", "#2c4360", "#22395a", "#1a3053", "#13284b", "#0c2042", "#071739"],
        dark: ["#6f8394", "#8397a8", "#98abbc", "#adbfce", "#c0d0dd", "#d0dde8", "#dfe8f0", "#ecf2f7", "#f7fafc"],
      },
      roles: lutRoleColours,
    },
    ramp1: {
      name: "ramp1",
      version: 1,
      unsigned: {
        light: ["#f2f9c4", "#d6efb3", "#a9dcb6", "#73c6bd", "#41b0c3", "#2390bd", "#2a6aac", "#283f94", "#15205e"],
        dark: ["#1b2c33", "#18405a", "#1a5b7d", "#1f7896", "#2c969c", "#4db493", "#86cd83", "#c6e27c", "#f4f1a6"],
      },
      rows: null,
      roles: lutRoleColours,
    },
  };

  function lutFreezeDeep(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) lutFreezeDeep(value[key]);
    }
    return value;
  }
  lutFreezeDeep(lutAppearances);

  // ---- sRGB <-> Lab (API.md C.6; d3-color convention) ----

  function lutToLinear(v) {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  function lutFromLinear(v) {
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  }
  function lutF(t) {
    return t > lutT3 ? Math.cbrt(t) : t / lutT2 + lutT0;
  }
  function lutFInverse(t) {
    return t > lutT1 ? t * t * t : lutT2 * (t - lutT0);
  }

  // E.lut.rgbToLab (API.md A.3): [L, a, b] of an 8-bit sRGB colour. A grey (r === g === b) takes the exact
  // shortcut X = Z = Y that d3-color takes, so a grey has a and b of exactly 0 instead of rounding noise.
  function lutRgbToLab(r, g, b) {
    const lr = lutToLinear(r);
    const lg = lutToLinear(g);
    const lb = lutToLinear(b);
    const y = lutF((0.2225045 * lr + 0.7168786 * lg + 0.0606169 * lb) / lutYn);
    let x;
    let z;
    if (lr === lg && lg === lb) {
      x = y;
      z = y;
    } else {
      x = lutF((0.4360747 * lr + 0.3850649 * lg + 0.1430804 * lb) / lutXn);
      z = lutF((0.0139322 * lr + 0.0971045 * lg + 0.7141733 * lb) / lutZn);
    }
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  // E.lut.labToRgb (API.md A.3): the inverse, as UNCLAMPED floating channels in 0..255 scale. Clamping and
  // rounding belong to the ramp builder, which must know when a channel left the gamut (`clipped`).
  function lutLabToRgb(L, a, b) {
    const y = (L + 16) / 116;
    const x = y + a / 500;
    const z = y - b / 200;
    const X = lutXn * lutFInverse(x);
    const Y = lutYn * lutFInverse(y);
    const Z = lutZn * lutFInverse(z);
    return [
      lutFromLinear(3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z),
      lutFromLinear(-0.9787684 * X + 1.9161415 * Y + 0.033454 * Z),
      lutFromLinear(0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z),
    ];
  }

  // E.lut.deltaE2000 (API.md A.3): CIEDE2000 (Sharma, Wu and Dalal 2005) between two [L, a, b] colours.
  // Written with the paper's own step names so that each line can be checked against it; the cases the
  // paper singles out (a zero chroma, a hue difference across the 0/360 seam) are the branches below.
  function lutDeltaE2000(lab1, lab2) {
    const rad = Math.PI / 180;
    const L1 = lab1[0];
    const a1 = lab1[1];
    const b1 = lab1[2];
    const L2 = lab2[0];
    const a2 = lab2[1];
    const b2 = lab2[2];
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cbar7 = Math.pow((C1 + C2) / 2, 7);
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625)));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) / rad + 360) % 360;
    const h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) / rad + 360) % 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
    const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Cbp7 = Math.pow(Cbp, 7);
    const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
    const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    const Sc = 1 + 0.045 * Cbp;
    const Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    const tl = dLp / Sl;
    const tc = dCp / Sc;
    const th = dHp / Sh;
    return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
  }

  // ---- WCAG contrast and compositing (API.md A.3) ----

  function lutLuminance(rgb) {
    return 0.2126 * lutToLinear(rgb[0]) + 0.7152 * lutToLinear(rgb[1]) + 0.0722 * lutToLinear(rgb[2]);
  }

  // E.lut.contrast: the WCAG 2.x contrast ratio (L1 + 0.05) / (L2 + 0.05), lighter over darker, 1 to 21.
  function lutContrast(fgRgb, bgRgb) {
    const a = lutLuminance(fgRgb);
    const b = lutLuminance(bgRgb);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  // E.lut.over: source-over of fg at `alpha` on an opaque bg, rounded to 8 bit the way a canvas does (one
  // channel value of difference is the tolerance the pixel tests allow, INTEGRATION.md D.5).
  function lutOver(fgRgb, alpha, bgRgb) {
    return [
      Math.round(fgRgb[0] * alpha + bgRgb[0] * (1 - alpha)),
      Math.round(fgRgb[1] * alpha + bgRgb[1] * (1 - alpha)),
      Math.round(fgRgb[2] * alpha + bgRgb[2] * (1 - alpha)),
    ];
  }

  // E.lut.parseColor: what getComputedStyle yields for the tokens: "rgb(r, g, b)" (also the space
  // separated form, and rgba with an alpha of 1) and "#rrggbb" / "#rgb". Anything else (a colour with
  // transparency, a named or functional colour) is null: the caller must not guess a backdrop.
  function lutParseColor(css) {
    if (typeof css !== "string") return null;
    const s = css.trim().toLowerCase();
    let m = /^#([0-9a-f]{6})$/.exec(s);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
    if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
    m = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*([0-9.]+%?)\s*)?\)$/.exec(s);
    if (!m) return null;
    if (m[4] !== undefined && !(m[4] === "1" || m[4] === "1.0" || m[4] === "100%")) return null;
    const rgb = [+m[1], +m[2], +m[3]];
    return rgb.some((v) => v > 255) ? null : rgb;
  }

  // E.lut.themeOf (API.md A.3): the theme a surface colour belongs to, from its Lab lightness (the rule of
  // baseline line 4130).
  function lutThemeOf(surfaceRgb) {
    return lutRgbToLab(surfaceRgb[0], surfaceRgb[1], surfaceRgb[2])[0] < 50 ? "dark" : "light";
  }

  // ---- ramps ----

  function lutHexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function lutRgbToHex(rgb) {
    return "#" + API.hash.hex(Uint8Array.from(rgb));
  }

  // The 256 entries of a piecewise-Lab ramp through `stops` (hex strings, equally spaced). Entry i sits at
  // position i/255 of the whole ramp, so the first entry IS the first stop and the last IS the last. Each
  // channel is clamped to 0..255 and rounded; a channel that had to be clamped by more than half a step
  // counts as a gamut clip, which the screens refuse (a clipped colour is not the colour the Lab path
  // asked for). Returns the raw bytes and the CSS strings; `state.clipped` accumulates the clip count.
  function lutRamp(stops, state) {
    const labs = stops.map((s) => {
      const c = lutHexToRgb(s);
      return lutRgbToLab(c[0], c[1], c[2]);
    });
    const rgb = new Uint8Array(lutEntries * 3);
    const css = new Array(lutEntries);
    for (let i = 0; i < lutEntries; i++) {
      const x = (i / (lutEntries - 1)) * (labs.length - 1);
      const j = Math.min(labs.length - 2, Math.floor(x));
      const f = x - j;
      const p = labs[j];
      const q = labs[j + 1];
      const raw = lutLabToRgb(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f);
      for (let c = 0; c < 3; c++) {
        if (raw[c] < -0.5 || raw[c] > 255.5) state.clipped++;
        rgb[i * 3 + c] = Math.round(Math.max(0, Math.min(255, raw[c])));
      }
      css[i] = "#" + API.hash.hex(rgb.subarray(i * 3, i * 3 + 3));
    }
    Object.freeze(css);
    return { css, rgb };
  }

  function lutSingle(hex) {
    const rgb = lutHexToRgb(hex);
    return { css: lutRgbToHex(rgb), rgb };
  }

  // The appearance a caller named: a name of APPEARANCES, or (for the perturbation tests and for a future
  // custom palette) a definition object of the same shape. Anything else is a caller bug, said loudly.
  function lutResolve(appearance) {
    if (typeof appearance === "string") {
      if (!Object.prototype.hasOwnProperty.call(lutAppearances, appearance)) throw new RangeError("E.lut: unknown appearance " + JSON.stringify(appearance));
      return lutAppearances[appearance];
    }
    if (appearance !== null && typeof appearance === "object" && typeof appearance.name === "string" && appearance.unsigned && appearance.roles) return appearance;
    throw new TypeError("E.lut: an appearance is a name or a definition {name, unsigned, rows, roles}");
  }

  // The tables of one theme of one appearance, before hashing.
  function lutThemeTables(app, theme, state) {
    if (theme !== "light" && theme !== "dark") throw new RangeError("E.lut: theme is \"light\" or \"dark\"");
    const roles = app.roles[theme];
    const unsigned = lutRamp(app.unsigned[theme], state);
    const positive = lutRamp([roles.midpoint, roles.positive], state);
    const negative = lutRamp([roles.midpoint, roles.negative], state);
    // An appearance without rows stops (ramp1) shares its unsigned ramp: the same object, so `screens` can
    // tell that no band claim is made and the clip count is not doubled.
    const rows = app.rows ? lutRamp(app.rows[theme], state) : unsigned;
    return { unsigned, positive, negative, rows, roles };
  }

  // The LUT byte hash (API.md C.6, DD-42, DD-86): for the light then the dark theme the three ramps and the
  // three single colours (4626 bytes, the part whose own hashes the design reproduced independently), then
  // the two rows ramps (1536 bytes). A different Lab arithmetic, rounding or byte order changes it.
  function lutHashOf(app) {
    const state = { clipped: 0 };
    const bytes = new Uint8Array(6162);
    let at = 0;
    const themes = ["light", "dark"];
    const tables = themes.map((t) => lutThemeTables(app, t, state));
    for (let k = 0; k < 2; k++) {
      const t = tables[k];
      for (const ramp of [t.unsigned, t.positive, t.negative]) {
        bytes.set(ramp.rgb, at);
        at += ramp.rgb.length;
      }
      for (const key of ["midpoint", "occupancy", "stateInk"]) {
        bytes.set(lutHexToRgb(t.roles[key]), at);
        at += 3;
      }
    }
    for (let k = 0; k < 2; k++) {
      const rows = tables[k].rows;
      // ramp1's rows ramp is its unsigned ramp: the extension still carries its 768 bytes so the layout is
      // the same for every appearance.
      bytes.set(rows.rgb, at);
      at += rows.rgb.length;
    }
    return API.hash.hex(API.hash.sha256(bytes.subarray(0, at)));
  }

  // E.lut.appearanceId (API.md A.3, DD-42): "slate2-8f7890f7". Theme independent (the hash covers both).
  function lutAppearanceId(appearance) {
    const app = lutResolve(appearance);
    return app.name + "-" + lutHashOf(app).slice(0, 8);
  }

  // E.lut.build (API.md A.3, C.6): the Lut of one appearance in one theme. Holds no cache (DD-02): the page
  // caches by appearance id and theme. `clipped` counts the gamut-clipped channels of THIS theme's tables.
  function lutBuild(appearance, theme) {
    const app = lutResolve(appearance);
    const state = { clipped: 0 };
    const t = lutThemeTables(app, theme, state);
    const hash = lutHashOf(app);
    const midpoint = lutSingle(t.roles.midpoint);
    const occupancy = lutSingle(t.roles.occupancy);
    const stateInk = lutSingle(t.roles.stateInk);
    const bar = { css: t.unsigned.css[lutBarIndex], rgb: Array.from(t.unsigned.rgb.subarray(lutBarIndex * 3, lutBarIndex * 3 + 3)) };
    return Object.freeze({
      id: app.name + "-" + hash.slice(0, 8),
      name: app.name,
      theme,
      unsigned: t.unsigned,
      positive: t.positive,
      negative: t.negative,
      rows: t.rows,
      midpoint,
      occupancy,
      stateInk,
      zeroInk: occupancy,
      bar,
      clipped: state.clipped,
      hash,
    });
  }

  // The ramp a composite is made of: a Lut object (used as is), an appearance name or definition (built in
  // the theme of the surface), or nothing (the default appearance). Passing the Lut avoids a rebuild.
  function lutSource(source, surfaceRgb) {
    if (source !== null && typeof source === "object" && source.unsigned && source.unsigned.rgb && source.hash) return source;
    return lutBuild(source === null || source === undefined ? lutDefault : source, lutThemeOf(surfaceRgb));
  }

  // E.lut.composite (API.md A.3, DD-86): a role's 256 entries composited at `alpha` over the surface, the
  // colours the LEGEND shows for a translucent role (Rows: `composite("rows", ROWS_ALPHA, surface)`; the
  // signed arms for Rows Delta and Relative volume). The canvas paints the RAW colour at globalAlpha, and the
  // pixel test allows one channel value between the two roundings. `source` is optional (a Lut or an
  // appearance); the surface decides the theme.
  function lutComposite(role, alpha, surfaceRgb, source = null) {
    const lut = lutSource(source, surfaceRgb);
    if (role !== "unsigned" && role !== "positive" && role !== "negative" && role !== "rows") throw new RangeError("E.lut.composite: role is unsigned, positive, negative or rows");
    const ramp = lut[role];
    const rgb = new Uint8Array(lutEntries * 3);
    const css = new Array(lutEntries);
    for (let i = 0; i < lutEntries; i++) {
      const c = lutOver([ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]], alpha, surfaceRgb);
      rgb[i * 3] = c[0];
      rgb[i * 3 + 1] = c[1];
      rgb[i * 3 + 2] = c[2];
      css[i] = lutRgbToHex(c);
    }
    return { css, rgb };
  }

  // ---- the D11 screens (API.md C.6) ----

  function lutEntryLabs(ramp) {
    const labs = new Array(lutEntries);
    for (let i = 0; i < lutEntries; i++) labs[i] = lutRgbToLab(ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]);
    return labs;
  }

  // The unsigned-style screen of a ramp of Lab entries against the surface: idx 0 far enough from the
  // surface, adjacent entries close enough to read as a continuum, lightness moving one way (drawdown from
  // the running best, so plateaus are allowed but a reversal is not).
  function lutScreenRamp(labs, surfaceLab) {
    const dir = Math.sign(labs[lutEntries - 1][0] - surfaceLab[0]);
    let run = -Infinity;
    let reversal = 0;
    let maxAdjacent = 0;
    let maxAdjacentAt = 0;
    let finite = true;
    for (let i = 0; i < lutEntries; i++) {
      const v = dir * labs[i][0];
      if (!Number.isFinite(labs[i][0]) || !Number.isFinite(labs[i][1]) || !Number.isFinite(labs[i][2])) finite = false;
      if (v > run) run = v;
      if (run - v > reversal) reversal = run - v;
      if (i > 0) {
        const d = lutDeltaE2000(labs[i - 1], labs[i]);
        if (d > maxAdjacent) {
          maxAdjacent = d;
          maxAdjacentAt = i;
        }
      }
    }
    return { first: lutDeltaE2000(surfaceLab, labs[0]), maxAdjacent, maxAdjacentAt, reversal, finite };
  }

  // Arms: the same, measured as lightness DEPARTURE from the shared midpoint (an arm may cross the
  // midpoint's lightness in either direction, so the direction of the screen is away from the midpoint).
  function lutScreenArm(labs, midLab) {
    let run = -Infinity;
    let reversal = 0;
    let maxAdjacent = 0;
    let finite = true;
    for (let i = 0; i < lutEntries; i++) {
      const dep = Math.abs(labs[i][0] - midLab[0]);
      if (!Number.isFinite(dep)) finite = false;
      if (dep > run) run = dep;
      if (run - dep > reversal) reversal = run - dep;
      if (i > 0) maxAdjacent = Math.max(maxAdjacent, lutDeltaE2000(labs[i - 1], labs[i]));
    }
    return { departure: Math.abs(labs[lutEntries - 1][0] - midLab[0]), maxAdjacent, reversal, finite };
  }

  function lutSameRgb(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  // E.lut.screens (API.md C.6, S1-086): the D11 numbers, computed on the 8-bit OUTPUT colours, and the
  // verdict against the declared limits (first entry >= 5 from the surface, adjacent <= 2, lightness
  // reversal <= 0.2, arms starting AT the midpoint, midpoint >= 5 from the surface, no gamut-clipped
  // channel). The Rows role is screened on its 16% COMPOSITE, which is what the bands show; an appearance
  // whose rows ramp is its unsigned ramp (ramp1) makes no band claim, so its rows numbers are reported
  // (`claimed: false`) but do not decide `ok`. These are declared engineering screens, not perceptual
  // validation (D11, S1-210).
  function lutScreens(lut, surfaceRgb) {
    const surfaceLab = lutRgbToLab(surfaceRgb[0], surfaceRgb[1], surfaceRgb[2]);
    const failures = [];
    const un = lutScreenRamp(lutEntryLabs(lut.unsigned), surfaceLab);
    const unsigned = { ...un, ok: true };
    if (!un.finite) failures.push("unsigned: a non-finite entry");
    if (!(un.first >= 5)) failures.push("unsigned: entry 0 is only " + un.first.toFixed(2) + " from the surface");
    if (!(un.maxAdjacent <= 2)) failures.push("unsigned: adjacent entries " + un.maxAdjacent.toFixed(3) + " apart at " + un.maxAdjacentAt);
    if (!(un.reversal <= 0.2)) failures.push("unsigned: lightness reverses by " + un.reversal.toFixed(3));
    unsigned.ok = un.finite && un.first >= 5 && un.maxAdjacent <= 2 && un.reversal <= 0.2;
    const midRgb = lut.midpoint.rgb;
    const midLab = lutRgbToLab(midRgb[0], midRgb[1], midRgb[2]);
    const arms = {};
    for (const name of ["positive", "negative"]) {
      const ramp = lut[name];
      const labs = lutEntryLabs(ramp);
      const s = lutScreenArm(labs, midLab);
      const startsAtMidpoint = lutSameRgb([ramp.rgb[0], ramp.rgb[1], ramp.rgb[2]], midRgb);
      const ok = s.finite && startsAtMidpoint && s.maxAdjacent <= 2 && s.reversal <= 0.2;
      arms[name] = { ...s, startsAtMidpoint, ok };
      if (!startsAtMidpoint) failures.push(name + ": entry 0 is not the midpoint");
      if (!(s.maxAdjacent <= 2)) failures.push(name + ": adjacent entries " + s.maxAdjacent.toFixed(3) + " apart");
      if (!(s.reversal <= 0.2)) failures.push(name + ": departure from the midpoint reverses by " + s.reversal.toFixed(3));
      if (!s.finite) failures.push(name + ": a non-finite entry");
    }
    const midpointDistance = lutDeltaE2000(surfaceLab, midLab);
    const midpoint = { distance: midpointDistance, ok: midpointDistance >= 5 };
    if (!midpoint.ok) failures.push("midpoint is only " + midpointDistance.toFixed(2) + " from the surface");
    const claimed = lut.rows !== lut.unsigned;
    const composite = lutComposite("rows", lutRowsAlpha, surfaceRgb, lut);
    const rw = lutScreenRamp(lutEntryLabs(composite), surfaceLab);
    const rows = { ...rw, claimed, ok: rw.finite && rw.first >= 5 && rw.maxAdjacent <= 2 && rw.reversal <= 0.2 };
    if (claimed && !rows.ok) failures.push("rows (composite at " + lutRowsAlpha + "): entry 0 " + rw.first.toFixed(2) + ", adjacent " + rw.maxAdjacent.toFixed(3) + ", reversal " + rw.reversal.toFixed(3));
    const clipped = lut.clipped;
    if (clipped !== 0) failures.push(clipped + " gamut-clipped channel(s)");
    return {
      theme: lut.theme,
      surface: [surfaceRgb[0], surfaceRgb[1], surfaceRgb[2]],
      unsigned,
      positive: arms.positive,
      negative: arms.negative,
      midpoint,
      rows,
      clipped,
      failures,
      ok: failures.length === 0,
    };
  }

  API.lut = Object.freeze({
    APPEARANCES: lutAppearances,
    DEFAULT_APPEARANCE: lutDefault,
    build: lutBuild,
    appearanceId: lutAppearanceId,
    ROWS_ALPHA: lutRowsAlpha,
    composite: lutComposite,
    themeOf: lutThemeOf,
    screens: lutScreens,
    deltaE2000: lutDeltaE2000,
    rgbToLab: lutRgbToLab,
    labToRgb: lutLabToRgb,
    contrast: lutContrast,
    over: lutOver,
    parseColor: lutParseColor,
  });

  // == §12-role ==
  // @part 12-role
  // @requires 01-util 03-result 11-lut
  // @prefix rol
  // @provides role
  // == §12 role: the mark-role table and the glyph alphabet (API.md B.9, DR-21, DD-37, DD-72) ==
  // ONE table says what each kind of mark is, in what colour role it is drawn, and how it is painted, so
  // that the plot, the footer keys and the legend swatches call the same `paint` and `tile` and a key
  // cannot drift from its mark. S2 and S3 extend the tables (the reserved rows below), they never
  // reassign an entry. No canvas is created here: the context and, for tiles, a canvas factory are
  // arguments, so Node tests pass a recording fake.

  // Below this many css px in either dimension a pattern or an outline is not resolvable: a flat fill at
  // this alpha of the ink over whatever is underneath (the surface, in the plot) stands in for it, and the
  // readout carries the tag (DR-21: "below a pixel-size threshold a flat neutral fill with the readout is
  // acceptable and documented"). The alpha is roughly the ink coverage of the hairline patterns.
  const rolFlatAlpha = 0.3;
  const rolFlatMinPx = 4;
  // The infinity plate is 10 x 10 css px (B.9); its text is "minus infinity", written with escapes because
  // this part is ASCII (only 04-text may hold a literal non-ASCII string).
  const rolInfinityText = "\u2212\u221e";

  // Roles (B.9, DD-72). `sample(lut, idx, surfaceRgb)` is the colour the LEGEND shows for the role at a
  // table index; the reserved S2/S3 rows have no S1 painter and sample nothing. `label` and
  // `accessibleName` are E.text keys, never English.
  function rolRole(id, cls, geometry, sample, owner) {
    const camel = id.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    return Object.freeze({
      id,
      class: cls,
      geometry,
      appearanceVersion: 2,
      sample,
      label: "role." + camel,
      accessibleName: "role." + camel + "Name",
      owner,
    });
  }
  const rolRoles = Object.freeze({
    "unsigned": rolRole("unsigned", "quantitative-fill", "fill", (lut, idx) => lut.unsigned.css[idx], "S1"),
    "positive": rolRole("positive", "quantitative-fill", "fill", (lut, idx) => lut.positive.css[idx], "S1"),
    "negative": rolRole("negative", "quantitative-fill", "fill", (lut, idx) => lut.negative.css[idx], "S1"),
    "midpoint": rolRole("midpoint", "quantitative-fill", "fill", (lut) => lut.midpoint.css, "S1"),
    "occupancy": rolRole("occupancy", "quantitative-outline", "outline", (lut) => lut.occupancy.css, "S1"),
    "zero-outline": rolRole("zero-outline", "quantitative-outline", "outline", (lut) => lut.zeroInk.css, "S1"),
    "unsigned-bar": rolRole("unsigned-bar", "quantitative-fill", "bar", (lut) => lut.bar.css, "S1"),
    "state-ink": rolRole("state-ink", "state", "glyph", (lut) => lut.stateInk.css, "S1"),
    // The contextual Rows band: it shares the numerical mapping of the Rows channel and differs only in its
    // fixed 16% projection (#46 6.1), so the legend samples the COMPOSITE (DD-86).
    "rows-projection": rolRole("rows-projection", "quantitative-fill", "fill", (lut, idx, surfaceRgb) => API.lut.composite("rows", API.lut.ROWS_ALPHA, surfaceRgb, lut).css[idx], "S1"),
    // Reserved: S1 never paints these; the rows are where S2 and S3 extend the table.
    "family-reference": rolRole("family-reference", "family-reference", "outline", () => null, "S2"),
    "interaction": rolRole("interaction", "interaction", "outline", () => null, "S3"),
    "region-replacement": rolRole("region-replacement", "region-replacement", "pattern", () => null, "S2"),
  });

  // Glyphs (B.9): `tag` lists the typed tags the glyph marks; `ink` names the Lut colour it is drawn in
  // ("stateInk" or "occupancy"), `ground` what a pattern paints under itself ("surface": a pattern draws its
  // own ground, so its contrast is the ink over the surface, independent of the neighbouring cell); `key` is
  // the E.text key of its label; `readout` the readout tag ("tag" = the typed tag itself); `pattern`
  // describes a tiled texture: {lines: "/" | "\\" | "x" | null, dots, period, lineWidth, dotDiameter}.
  function rolGlyph(id, tag, kind, geometry, ink, ground, key, readout, minPx, role, pattern) {
    return Object.freeze({ id, tag: Object.freeze(tag), kind, geometry, ink, ground, key, readout, minPx, s1: true, role, pattern: pattern ? Object.freeze(pattern) : null });
  }
  const rolSlateTags = ["undefined", "empty-population", "no-coarser-parent", "waiting-for-complete-parent", "no-reference", "empty-both"];
  const rolGlyphs = Object.freeze({
    "tick": rolGlyph("tick", ["finite"], "line", "1.5 px baseline tick across the bar slot", "stateInk", null, "key.zero", "zero", 0, "state-ink", null),
    "zero-outline": rolGlyph("zero-outline", ["finite"], "outline", "1 px inset outline, flat fill below 4 px", "occupancy", null, "key.zero", "zero", rolFlatMinPx, "zero-outline", null),
    "diamond": rolGlyph("diamond", ["undefined"], "hollow diamond", "6 px, 1.25 px stroke, at the baseline; drawn only when the column slot is >= 6 px, else counted", "stateInk", null, "key.undefined", "undefined", 0, "state-ink", null),
    "pattern-slate": rolGlyph("pattern-slate", rolSlateTags, "pattern tile", "45-degree hairline, 6 css px period, 1 px lines", "stateInk", "surface", "key.undefined", "tag", rolFlatMinPx, "state-ink", { lines: "/", dots: false, period: 6, lineWidth: 1, dotDiameter: 0 }),
    "pattern-dots": rolGlyph("pattern-dots", ["pending"], "pattern tile", "dots, 5 css px period, 1.25 px diameter", "stateInk", "surface", "key.pending", "pending", rolFlatMinPx, "state-ink", { lines: null, dots: true, period: 5, lineWidth: 0, dotDiameter: 1.25 }),
    "pattern-cross": rolGlyph("pattern-cross", ["failed", "invalid-input"], "pattern tile", "crosshatch, 6 css px period", "stateInk", "surface", "key.failed", "tag", rolFlatMinPx, "state-ink", { lines: "x", dots: false, period: 6, lineWidth: 1, dotDiameter: 0 }),
    "pattern-slash": rolGlyph("pattern-slash", ["unsupported"], "pattern tile", "reverse 45-degree hairline, 6 css px period", "stateInk", "surface", "key.unsupported", "unsupported", rolFlatMinPx, "state-ink", { lines: "\\", dots: false, period: 6, lineWidth: 1, dotDiameter: 0 }),
    "tri-down": rolGlyph("tri-down", ["finite"], "filled triangle", "6 px at the low edge, count in the key", "stateInk", null, "key.below", "clip-low", 0, "state-ink", null),
    "tri-up": rolGlyph("tri-up", ["finite"], "filled triangle", "6 px at the high edge, count in the key", "stateInk", null, "key.above", "clip-high", 0, "state-ink", null),
    // The infinity mark is a plate with text; tiled (period 10) it fills a Cascade cell whose child is absent.
    "infinity": rolGlyph("infinity", ["negative-infinite"], "text glyph", "minus-infinity text in a 10 x 10 plate at the low end", "stateInk", "surface", "key.negInf", "negative-infinite", 0, "state-ink", { lines: null, dots: false, period: 10, lineWidth: 1, dotDiameter: 0 }),
    "outline": rolGlyph("outline", [], "outline", "1 px inset outline", "occupancy", null, "key.outline", "occupied", 0, "occupancy", null),
  });

  // Which glyph marks a typed tag (E.result.TAGS). ONE table; `null` = no mark of its own: `finite` is filled
  // from the mapping (zero has its own glyph), `outside-support` and `hidden` draw nothing and are readout
  // only (B.1). `empty-both` shares the neutral hatch, but rows count it in the key instead of drawing it per
  // row (A-28): that is the caller's rule, not a property of the glyph.
  const rolTagGlyph = Object.freeze({
    "finite": null,
    "negative-infinite": "infinity",
    "no-reference": "pattern-slate",
    "empty-both": "pattern-slate",
    "empty-population": "pattern-slate",
    "undefined": "pattern-slate",
    "no-coarser-parent": "pattern-slate",
    "waiting-for-complete-parent": "pattern-slate",
    "outside-support": null,
    "hidden": null,
    "pending": "pattern-dots",
    "failed": "pattern-cross",
    "unsupported": "pattern-slash",
    "invalid-input": "pattern-cross",
  });

  // E.role.glyphFor (API.md A.3, C.16): the glyph id that marks a non-value tag, given the tag's index in
  // E.result.TAGS (as the encoder carries it in `out.tag`); a tag name is accepted too. Allocation-free.
  function rolGlyphFor(tagIndex) {
    const tag = typeof tagIndex === "string" ? tagIndex : API.result.TAGS[tagIndex];
    if (tag === undefined || !Object.prototype.hasOwnProperty.call(rolTagGlyph, tag)) throw new RangeError("E.role.glyphFor: unknown tag " + String(tagIndex));
    return rolTagGlyph[tag];
  }

  // Resolve what a caller calls a tile: a glyph id ("pattern-dots"), the short name ("dots") or a typed tag
  // ("pending"), so `patternFor("pending")` and `patternFor(ENC.pattern)` both work.
  function rolTileGlyph(kind) {
    let g = rolGlyphs[kind];
    if (g === undefined) g = rolGlyphs["pattern-" + kind];
    if (g === undefined && Object.prototype.hasOwnProperty.call(rolTagGlyph, kind) && rolTagGlyph[kind] !== null) g = rolGlyphs[rolTagGlyph[kind]];
    if (g === undefined || g.pattern === null) throw new RangeError("E.role.tile: " + String(kind) + " is not a pattern glyph");
    return g;
  }

  // ---- painting ----

  // The strokes of a hairline or dot texture over the box (ox, oy, w, h), in css px, as ONE path so a probe
  // sees one beginPath ... stroke()/fill() sequence per glyph. Lines run past the box by `e` so a clip (or a
  // tile edge) shows no end caps, and the lines of a tile line up across the tile edge: a 45-degree family
  // x + y = k * P (or x - y = c) with the box a multiple of P wide is periodic in both directions.
  function rolTexturePath(ctx, p, ox, oy, w, h) {
    const P = p.period;
    const e = 2;
    ctx.beginPath();
    if (p.dots) {
      const r = p.dotDiameter / 2;
      for (let cy = P / 2; cy < h + P; cy += P)
        for (let cx = P / 2; cx < w + P; cx += P) {
          if (cx - r > w || cy - r > h) continue;
          ctx.moveTo(ox + cx + r, oy + cy);
          ctx.arc(ox + cx, oy + cy, r, 0, 2 * Math.PI);
        }
      return;
    }
    if (p.lines === "/" || p.lines === "x") {
      for (let k = 0; k * P <= w + h + P; k++) {
        ctx.moveTo(ox + k * P + e, oy - e);
        ctx.lineTo(ox + k * P - h - e, oy + h + e);
      }
    }
    if (p.lines === "\\" || p.lines === "x") {
      for (let c = -Math.ceil(h / P) * P; c <= w + P; c += P) {
        ctx.moveTo(ox + c - e, oy - e);
        ctx.lineTo(ox + c + h + e, oy + h + e);
      }
    }
  }

  function rolPaintTexture(ctx, g, ox, oy, w, h, ink, ground) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w, h);
    ctx.clip();
    if (ground) {
      ctx.fillStyle = ground;
      ctx.fillRect(ox, oy, w, h);
    }
    rolTexturePath(ctx, g.pattern, ox, oy, w, h);
    if (g.pattern.dots) {
      ctx.fillStyle = ink;
      ctx.fill();
    } else {
      ctx.strokeStyle = ink;
      ctx.lineWidth = g.pattern.lineWidth;
      ctx.stroke();
    }
    ctx.restore();
  }

  // The infinity plate: a ground square, a hairline border and the text, at (ox, oy) with side `s` (10 css px
  // at scale 1, B.9).
  function rolPaintPlate(ctx, ox, oy, s, ink, ground, font) {
    ctx.save();
    if (ground) {
      ctx.fillStyle = ground;
      ctx.fillRect(ox, oy, s, s);
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, s - 1, s - 1);
    ctx.fillStyle = ink;
    ctx.font = font || "600 " + Math.max(6, Math.round(s * 0.8)) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(rolInfinityText, ox + s / 2, oy + s / 2 + 0.5);
    ctx.restore();
  }

  // E.role.paint (API.md A.3, DD-37): one glyph, centred on (x, y), `size` css px across (`opts.width` /
  // `opts.height` override the two sides of a box-like glyph: a pattern, an outline, the length of a tick).
  // `ink` is a CSS colour; `opts.ground` (a CSS colour) is painted under a pattern or the infinity plate
  // (a tile always has one, a swatch on a coloured panel wants it, a mark drawn on the surface does not).
  // Below the glyph's `minPx` a flat fill stands in for a texture or an outline (DR-21). Each glyph is one
  // beginPath ... stroke()/fill() sequence, so the test probe can classify it (TESTPLAN.md 3.3).
  function rolPaint(ctx, glyphId, x, y, size, ink, opts) {
    const g = rolGlyphs[glyphId];
    if (g === undefined) throw new RangeError("E.role.paint: unknown glyph " + String(glyphId));
    const o = opts || {};
    const w = o.width === undefined ? size : o.width;
    const h = o.height === undefined ? size : o.height;
    const ox = x - w / 2;
    const oy = y - h / 2;
    if (g.minPx > 0 && Math.min(w, h) < g.minPx) {
      ctx.save();
      ctx.globalAlpha = rolFlatAlpha;
      ctx.fillStyle = ink;
      ctx.fillRect(ox, oy, w, h);
      ctx.restore();
      return;
    }
    if (g.pattern !== null && g.id !== "infinity") {
      rolPaintTexture(ctx, g, ox, oy, w, h, ink, o.ground);
      return;
    }
    if (g.id === "infinity") {
      rolPaintPlate(ctx, x - size / 2, y - size / 2, size, ink, o.ground, o.font);
      return;
    }
    ctx.save();
    if (g.id === "zero-outline" || g.id === "outline") {
      // A 1 px line is centred on its path: inset by half a pixel so the outline lies wholly inside the cell.
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);
    } else if (g.id === "tick") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.lineTo(ox + w, y);
      ctx.stroke();
    } else if (g.id === "diamond") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x, y - size / 2);
      ctx.lineTo(x + size / 2, y);
      ctx.lineTo(x, y + size / 2);
      ctx.lineTo(x - size / 2, y);
      ctx.closePath();
      ctx.stroke();
    } else {
      // tri-down points down (the value fell below the axis), tri-up points up.
      const down = g.id === "tri-down" ? 1 : -1;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(x - size / 2, y - (down * size) / 2);
      ctx.lineTo(x + size / 2, y - (down * size) / 2);
      ctx.lineTo(x, y + (down * size) / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // E.role.tile (API.md A.3, DD-37): one pattern tile as a canvas from `makeCanvas(width, height)`, DPR
  // compensated: its side is round(period * dpr) device pixels, drawn with the css-px geometry scaled to fit,
  // so the page only sets `pattern.setTransform(scale(1/dpr))`. The tile carries its own ground (`ground`,
  // normally the surface), which is why a pattern's contrast is ink over surface whatever lies next to it.
  function rolTile(kind, opts) {
    const g = rolTileGlyph(kind);
    const dpr = opts.dpr > 0 ? opts.dpr : 1;
    const P = g.pattern.period;
    const px = Math.max(1, Math.round(P * dpr));
    const canvas = opts.makeCanvas(px, px);
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(px / P, px / P);
    if (g.id === "infinity") rolPaintPlate(ctx, 0, 0, P, opts.ink, opts.ground, opts.font);
    else rolPaintTexture(ctx, g, 0, 0, P, P, opts.ink, opts.ground);
    ctx.restore();
    return canvas;
  }

  // ---- keys ----

  // The legend and footer keys (B.11): id, glyph, E.text key, and which typed tags count toward it. Ids are
  // the typed tags (not every tag has a key: `finite` is a fill and `hidden` is replay, both unkeyed) plus
  // the synthetic ones the scale adds: `zero`, `clip-low`, `clip-high`, `no-calibration`, `occupied`.
  // `outside-support` has a key (a count of what lies outside the comparison support) but no swatch.
  function rolKey(glyph, key) {
    return Object.freeze({ glyph, key });
  }
  const rolKeys = Object.freeze({
    "zero": rolKey("zero-outline", "key.zero"),
    "undefined": rolKey("pattern-slate", "key.undefined"),
    "empty-population": rolKey("pattern-slate", "key.undefined"),
    "no-coarser-parent": rolKey("pattern-slate", "key.undefined"),
    "waiting-for-complete-parent": rolKey("pattern-slate", "key.open"),
    "no-reference": rolKey("pattern-slate", "key.noRef"),
    "empty-both": rolKey("pattern-slate", "key.emptyBoth"),
    "negative-infinite": rolKey("infinity", "key.negInf"),
    "clip-low": rolKey("tri-down", "key.below"),
    "clip-high": rolKey("tri-up", "key.above"),
    "pending": rolKey("pattern-dots", "key.pending"),
    "failed": rolKey("pattern-cross", "key.failed"),
    "unsupported": rolKey("pattern-slash", "key.unsupported"),
    "invalid-input": rolKey("pattern-cross", "key.invalid"),
    "outside-support": rolKey(null, "key.outside"),
    "occupied": rolKey("outline", "key.outline"),
    "no-calibration": rolKey("outline", "key.noCalibration"),
  });
  const rolUnkeyed = Object.freeze(["finite", "hidden"]);

  // The label of a key: the English text when part 04 is present and has the key, else the key itself
  // (Node tests of this part load without part 04).
  function rolLabel(path) {
    let v = API.text;
    for (const part of path.split(".")) {
      if (v === undefined || v === null) return path;
      v = v[part];
    }
    return typeof v === "string" ? v : path;
  }

  // E.role.keyEntries (API.md A.3): the key records for `tags` (ids as above), each with its count from
  // `counts` (an object keyed by id, or an array parallel to `tags`; missing = 0), in the order given. The
  // consumer keeps the entries with count > 0; ids with no key (`finite`, `hidden`) are left out, an unknown
  // id is a caller bug and throws.
  function rolKeyEntries(tags, counts) {
    const out = [];
    for (let i = 0; i < tags.length; i++) {
      const id = tags[i];
      if (rolUnkeyed.indexOf(id) >= 0) continue;
      if (!Object.prototype.hasOwnProperty.call(rolKeys, id)) throw new RangeError("E.role.keyEntries: unknown key id " + String(id));
      const k = rolKeys[id];
      let n = Array.isArray(counts) ? counts[i] : counts === null || counts === undefined ? 0 : counts[id];
      if (!(n > 0)) n = 0;
      out.push({
        id,
        glyph: k.glyph,
        role: k.glyph === null ? null : rolGlyphs[k.glyph].role,
        key: k.key,
        label: rolLabel(k.key),
        count: n,
      });
    }
    return out;
  }

  // E.role.occlusion(candidates, plot, opts) (PRD-0002 S2, the occlusion budget): persistent reference strokes, their backings and their label plates
  // may cover at most `budget` (20%) of the measured heatmap rectangle `plot` {x, y, w, h}, the overlaps counted once. The cover is held on a bounded
  // occupancy grid of `cell` css px squares (2), built from the marks' screen rectangles, so a frame never scans history or pixels. A candidate is
  // {id, hot, rank, rects: [[x0, y0, x1, y1], ...]} (the rectangles its marks cover, backing and plate included). The focused ones (`hot`) come first,
  // then by ascending `rank` (lower is kept longer), ties in the order given; a candidate that would take the cover past the budget is OFF unless it is
  // focused: the focused mark is never thinned or widened, and when it alone needs more than the budget the answer says so (`focusOver`).
  // -> {off: Set of ids, shown, eligible, used (grid cells), limit, cells, focusOver}
  function rolOcclusion(candidates, plot, opts) {
    const budget = opts && opts.budget !== undefined ? opts.budget : 0.2;
    const size = opts && opts.cell !== undefined ? opts.cell : 2;
    const off = new Set();
    const out = { off, shown: 0, eligible: 0, used: 0, limit: 0, cells: 0, focusOver: false };
    if (!(plot.w > 0) || !(plot.h > 0)) return out;
    const cols = Math.ceil(plot.w / size);
    const rows = Math.ceil(plot.h / size);
    const grid = new Uint8Array(cols * rows);
    out.cells = cols * rows;
    out.limit = Math.floor(cols * rows * budget);
    // A candidate's rectangles are claimed together: a cell already taken, or already claimed by an earlier rectangle of the same candidate, costs
    // nothing (overlaps once, inside a mark and between marks); the claim stands if the mark is kept and is given back if it is not.
    const claimed = [];
    const claim = (x0, y0, x1, y1) => {
      const c0 = Math.max(0, Math.floor((x0 - plot.x) / size));
      const c1 = Math.min(cols - 1, Math.floor((x1 - plot.x) / size));
      const r0 = Math.max(0, Math.floor((y0 - plot.y) / size));
      const r1 = Math.min(rows - 1, Math.floor((y1 - plot.y) / size));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const k = r * cols + c;
          if (grid[k] === 0) {
            grid[k] = 2;
            claimed.push(k);
          }
        }
    };
    const order = candidates.slice().sort((a, b) => Number(b.hot) - Number(a.hot) || a.rank - b.rank);
    for (const m of order) {
      claimed.length = 0;
      for (const r of m.rects) claim(r[0], r[1], r[2], r[3]);
      const cost = claimed.length;
      out.eligible++;
      const refuse = !m.hot && out.used + cost > out.limit;
      if (m.hot && out.used + cost > out.limit) out.focusOver = true;
      for (let i = 0; i < claimed.length; i++) grid[claimed[i]] = refuse ? 0 : 1;
      if (refuse) {
        off.add(m.id);
        continue;
      }
      out.used += cost;
      out.shown++;
    }
    return out;
  }

  // E.role.unionSpans (PRD-0002 S2, event strip): the intervals of one event kind merged for drawing where they overlap or touch, each
  // span keeping the events that make it up (in order of their start) so an inspection still reads every constituent. The marks of a lane are
  // the union, never overlapping translucent marks, so nothing darker means more events. `events` are {t0, t1, ...}; input order is free.
  function rolUnionSpans(events) {
    const sorted = events.slice().sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1),
      spans = [];
    for (const e of sorted) {
      const last = spans.length ? spans[spans.length - 1] : null;
      if (last !== null && e.t0 <= last.t1) {
        if (e.t1 > last.t1) last.t1 = e.t1;
        last.events.push(e);
      } else spans.push({ t0: e.t0, t1: e.t1, events: [e] });
    }
    return spans;
  }

  API.role = Object.freeze({
    ROLES: rolRoles,
    GLYPHS: rolGlyphs,
    paint: rolPaint,
    tile: rolTile,
    glyphFor: rolGlyphFor,
    keyEntries: rolKeyEntries,
    occlusion: rolOcclusion,
    unionSpans: rolUnionSpans,
  });

  // == §13-store ==
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

  // == §14-policy ==
  // @part 14-policy
  // @requires 04-text 05-measure 08-scale 10-context 13-store
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
  //   {type:"manual", channel, kind?, U, k}   (a manual domain for the channel's current context: (U, k) for a log
  //        context, U alone for a linear one; `kind` "value-log1p" | "value-linear" must agree with it. Holds ONE
  //        channel and ONE class and does not engage the lock)
  //   {type:"clearManual", channel, classKey?}
  //   {type:"hold", channel, record}     (the page, after an explicit Fit under the lock: the new mapping replaces
  //                                       the held one and the lock stays on)
  // env = {mode, rows, live, label, rowsLabel, active:{cells, rows}, axes:[{id, domain, through?}], contexts:{cells,
  // rows}, cutMs}; only what an action names is required. `effects` are data the page executes:
  //   {type:"invalidate", channel:"cells"|"rows"|"lens"|"all"}   redraw and re-resolve
  //   {type:"request-fit", channel, kind:"fit"|"auto", locked?}  ask the lifecycle for a fit
  //   {type:"hold", channel, classKey, from:"active"}   the lock took the channel's active mapping into `held`
  //                                                      (already in the returned scale: informational)
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
          effects.push({ type: "hold", channel: channels[i], classKey: polClassOf(rec), from: "active" });
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
        // The mapping follows the context it is for: a log context takes (U, k), a linear one U alone; a Rank or
        // fixed context has no manual U, k. A `kind` that says otherwise is refused, not reinterpreted.
        const want = ctx.transform === "value-log" ? "value-log1p" : ctx.transform === "value-linear" ? "value-linear" : null;
        const kind = action.kind === undefined ? want : action.kind;
        if (want === null || kind !== want) return polReject(cur, "manual", API.text.reject.manual);
        const signed = API.context.compatClass(ctx).split("|")[2] === "s";
        const fit = API.scale.manual({ kind, signed, U: action.U, k: action.k });
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
        count++;
        continue;
      }
      const letter = chanRaw === "c" || chanRaw === "cells" ? "c" : chanRaw === "r" || chanRaw === "rows" ? "r" : chanRaw === "l" || chanRaw === "lens" ? "l" : null;
      if (letter === null) {
        drop(chanRaw, "unknown channel");
        continue;
      }
      // A colour channel is Explore, Auto or an explicit comparison; the lens carries Local contrast.
      if (letter === "l" ? policy !== "local" : policy !== "explore" && policy !== "auto" && policy !== "comparison") {
        drop(chanRaw, "a " + (letter === "l" ? "lens" : "colour") + " record cannot have the policy " + policy);
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
      count++;
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

  // == §15-lifecycle ==
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

  // The config part of a memo key: a finished string, or the fields of the object joined in a fixed order.
  function lifConfigKey(config) {
    if (typeof config === "string") return config;
    if (!lifIsObject(config)) throw new TypeError("memoKey: config is a string or {mode, basis, pathBasis, transform, policy, lock, window}");
    const w = Array.isArray(config.window) ? config.window[0] + "~" + config.window[1] : "";
    return [config.mode, config.basis, config.pathBasis, config.transform, config.policy, config.lock ? "1" : "0", w].join(",");
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

  // == §16-axis ==
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
    "profile.shared.absolute": axsEntry("profile.shared.absolute", "profile", "unsigned", "auto", null, "usdt", null),
    "profile.shared.share": axsEntry("profile.shared.share", "profile", "unsigned", "auto", null, "share", null),
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

    // freeze(id, {workspace?, domain?, through?, generation?, token?}) -> record | null: make an Auto axis
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
    // next eligible `frame()` refits it. `freeze` made its slot with no signature and no last update, so the
    // next frame re-evaluates at once and no cap applies (the refit is immediate once the settle time has
    // passed). Null when the axis was not frozen.
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

  // E.axis.profile (PRD-0002 S2 section 3): how the adjacent profile tracks are compared. The CURRENT track is the view's (or the
  // selection's) Volume with its taker-buy subset; the REFERENCE track is the chosen Rows measure over its period. Rows are the page's
  // price rows: row r of exponent m spans the base rows [r 2^m, (r + 1) 2^m), each list sorted by r.
  //   independent  each track on an axis of its own (the default): this function has nothing to add.
  //   absolute     one domain for both, the same pixels per unit. Needs the SAME measure and basis (Volume against Volume) and an exact
  //                common partition: the finer side is coarsened by exact summation onto the coarser exponent, a coarse row is never split.
  //   share        each row's share of the total of the same window W (the bins wholly inside the view and inside the reference's
  //                support), both denominators reported. Needs two nonnegative distributions (Volume, Time at price); a signed Delta and a
  //                ratio are not distributions. A zero total is "undefined", never a share of 0.
  // A mode that is not offered is reported with its reason and the plan falls back to independent; the choice itself is the caller's
  // to keep.
  function axsBinsOf(rows, m, lo, hi, out) {
    // The rows of a list at exponent `m` that overlap the base-row range [lo, hi), by binary search on the sorted list.
    const size = Math.pow(2, m),
      first = Math.floor(lo / size),
      last = Math.ceil(hi / size) - 1;
    let a = 0,
      b = rows.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (rows[mid].r < first) a = mid + 1;
      else b = mid;
    }
    for (let i = a; i < rows.length && rows[i].r <= last; i++) out.push(rows[i]);
    return out;
  }

  // The rows coarsened by exact summation from exponent `from` onto the exponent `to` (to >= from): one bin per covering row of the
  // coarser partition, the amounts `read` names summed in the order of the rows. Both names are carried: the total and the subset.
  function axsCoarsen(rows, from, to, totalOf, subsetOf) {
    const k = Math.pow(2, to - from),
      out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = Math.floor(rows[i].r / k),
        at = out.length ? out[out.length - 1] : null;
      if (at !== null && at.r === r) {
        at.v += totalOf(rows[i]);
        at.bv += subsetOf(rows[i]);
      } else out.push({ r, v: totalOf(rows[i]), bv: subsetOf(rows[i]) });
    }
    return out;
  }

  const axsProfileTotal = { volume: (x) => x.v, time: (x) => x.w || 0 };

  function axsProfileOffers(cur, ref) {
    const why = (code) => ({ ok: false, reason: code });
    let absolute, share;
    if (!cur || cur.ready === false) absolute = share = why("current-not-ready");
    else if (!ref) absolute = share = why("no-reference");
    else if (ref.ready === false) absolute = share = why("reference-not-ready");
    else if (!Number.isInteger(ref.m) || !Number.isInteger(cur.m)) absolute = share = why("not-aligned");
    else {
      absolute = ref.kind === "volume" ? { ok: true, reason: null } : why("unlike-measure");
      share = ref.kind === "volume" || ref.kind === "time" ? { ok: true, reason: null } : why(ref.kind === "delta" ? "signed" : "unlike-measure");
    }
    return { independent: { ok: true, reason: null }, absolute, share };
  }

  // E.axis.profile(input) -> the plan of the two tracks: input {mode, cur: {rows, m, ready}, ref: {kind, rows, m, ready} | null, view: {lo, hi}}.
  function axsProfile(input) {
    if (!axsIsObject(input)) throw new TypeError("axis profile needs an input object");
    const asked = input.mode === "absolute" || input.mode === "share" ? input.mode : "independent",
      cur = input.cur ?? null,
      ref = input.ref ?? null,
      view = input.view;
    if (!axsIsObject(view) || !axsFiniteNumber(view.lo) || !axsFiniteNumber(view.hi) || !(view.hi > view.lo)) throw new RangeError("axis profile needs a view range lo < hi (base rows)");
    const offers = axsProfileOffers(cur, ref),
      plan = { asked, mode: "independent", offers, m: null, state: "independent", reason: null, cur: null, ref: null, window: null, denominators: null, summary: null };
    if (asked === "independent") return plan;
    if (!offers[asked].ok) {
      plan.reason = offers[asked].reason;
      return plan;
    }
    const m = Math.max(cur.m, ref.m),
      size = Math.pow(2, m),
      total = axsProfileTotal[ref.kind],
      overlapping = (rows, from, read, buy) => axsCoarsen(axsBinsOf(rows, from, view.lo, view.hi, []), from, m, read, buy),
      curBins = overlapping(cur.rows, cur.m, axsProfileTotal.volume, (x) => x.bv || 0),
      refBins = overlapping(ref.rows, ref.m, total, () => 0);
    plan.mode = asked;
    plan.m = m;
    plan.state = "ok";
    if (asked === "absolute") {
      plan.cur = curBins.map((x) => ({ r: x.r, v: x.v, bv: x.bv, t: x.v, tb: x.bv }));
      plan.ref = refBins.map((x) => ({ r: x.r, v: x.v, bv: 0, t: x.v, tb: 0 }));
    } else {
      // W: the bins wholly inside the view (every one has support on the current side, a row without trades being a known zero) and inside
      // the reference's support, its first to its last row, in the partition's rows.
      const refFirst = ref.rows.length ? Math.floor(ref.rows[0].r / Math.pow(2, m - ref.m)) : Infinity,
        refLast = ref.rows.length ? Math.floor(ref.rows[ref.rows.length - 1].r / Math.pow(2, m - ref.m)) : -Infinity,
        first = Math.max(Math.ceil(view.lo / size), refFirst),
        last = Math.min(Math.floor(view.hi / size) - 1, refLast);
      if (!(last >= first)) {
        plan.state = "none";
        plan.reason = "no-window";
        plan.summary = { count: 0, max: -Infinity, min: Infinity };
        return plan;
      }
      const inside = (x) => x.r >= first && x.r <= last,
        curW = curBins.filter(inside),
        refW = refBins.filter(inside);
      let dc = 0,
        dr = 0;
      for (const x of curW) dc += x.v;
      for (const x of refW) dr += x.v;
      plan.window = { first, last, bins: last - first + 1 };
      plan.denominators = { cur: dc, ref: dr };
      if (!(dc > 0) || !(dr > 0)) {
        plan.state = "undefined";
        plan.reason = "zero-total";
        plan.summary = { count: 0, max: -Infinity, min: Infinity };
        return plan;
      }
      plan.cur = curW.map((x) => ({ r: x.r, v: x.v, bv: x.bv, t: x.v / dc, tb: x.bv / dc }));
      plan.ref = refW.map((x) => ({ r: x.r, v: x.v, bv: 0, t: x.v / dr, tb: 0 }));
    }
    let count = 0,
      max = -Infinity,
      min = Infinity;
    for (const side of [plan.cur, plan.ref])
      for (const x of side) {
        count++;
        if (x.t > max) max = x.t;
        if (x.t < min) min = x.t;
      }
    plan.summary = { count, max, min };
    return plan;
  }

  API.axis = Object.freeze({
    CATALOGUE: axsCatalogue,
    domain: axsDomain,
    registry: axsRegistry,
    coordinate: axsCoordinate,
    ticks: axsTicks,
    profile: axsProfile,
  });

  // == §17-warn ==
  // @part 17-warn
  // @requires 08-scale
  // @prefix wrn
  // @provides warn
  // == §17 warn: the screen-area accumulator and the two warnings (API.md C.11, DR-11, S1-120) ==
  // "Scale range exceeded" and "Low discrimination" are facts about the marks the viewer is looking at, so
  // they are counted over the DRAWN marks of a settled pass, never over a cohort and never inside the paint
  // loop of a steady frame. A Tally is the small mutable accumulator the consumer hooks feed (one `add` or
  // `addBox` per drawn mark) and `evaluate` turns into a WarnReport. Everything is a pure function of the
  // marks fed: a warning never recolours, never refits and never changes a mapping (DD-94: it only offers
  // actions).
  //
  // What counts (DR-11, DD-11):
  //   occupied mark   a drawn mark with a defined value (partial and open marks are drawn, so they count; only
  //                   the calibration cohort leaves them out). Non-values and known-empty cells are not counted
  //                   at all, and the lens reports its own tally. Negative infinity IS an occupied mark and an
  //                   out-of-range one (DR-11 lists it in the numerator), so `addNegInf` counts it in both.
  //   outside         finite clipping (LOW, HIGH), a rank outside its support (the same codes) and negative
  //                   infinity. An exact endpoint (EXACT_LOW, EXACT_HIGH) is on the scale, not outside it.
  //   screen area     the CSS-px area of a mark's box clipped to the plot rectangle AND the measurement
  //                   rectangle; a box with nothing left after clipping is not a drawn mark and is skipped.
  //   lowest/highest  a NONZERO mark whose LUT index is in the lowest 13 or the highest 13 of 256 entries
  //                   (5.08% per end); zero is keyed separately and never counts.
  // The thresholds are strict ("more than"): exactly 10% of the marks, 25% of the area or 90% of the nonzero
  // marks is not a warning. Ratios are divisions (not products) so that 1/10 compares equal to the constant
  // 0.1: both are the double nearest one tenth.

  const wrnClip = API.scale.CLIP;
  const wrnLow = wrnClip.LOW;
  const wrnHigh = wrnClip.HIGH;
  const wrnExactLow = wrnClip.EXACT_LOW;
  const wrnExactHigh = wrnClip.EXACT_HIGH;

  // E.warn.bandOf (API.md A.3, C.11): which end of the LUT an index is in, "low" for the lowest 13 entries
  // (0..12), "high" for the highest 13 (243..255), else null. Only a whole index 0..255 has a band: -1 (the
  // encoder's "no index") and NaN are null, not "low".
  function wrnBandOf(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx > 255) return null;
    if (idx <= THRESHOLDS.LUT_LOW_MAX) return "low";
    if (idx >= THRESHOLDS.LUT_HIGH_MIN) return "high";
    return null;
  }

  // One mark with a defined value. Returns 1 when the mark is outside the scale (so addBox can add its area
  // to the outside area), else 0. `nonzero` decides whether the LUT band counters see it; a mark with no
  // coordinate (idx < 0, for example an occupancy-only draw) still counts as a mark and as outside when its
  // clip says so.
  function wrnCount(t, idx, clip, defined, nonzero) {
    if (!defined) return 0;
    t.marks++;
    if (nonzero) {
      t.nonzero++;
      if (idx >= 0 && idx <= THRESHOLDS.LUT_LOW_MAX) t.lowBand++;
      else if (idx >= THRESHOLDS.LUT_HIGH_MIN && idx <= 255) t.highBand++;
    }
    if (clip === wrnLow) {
      t.low++;
      t.outside++;
      return 1;
    }
    if (clip === wrnHigh) {
      t.high++;
      t.outside++;
      return 1;
    }
    if (clip === wrnExactLow) t.exactLow++;
    else if (clip === wrnExactHigh) t.exactHigh++;
    return 0;
  }

  // The part of a box that is on screen. `clip` is one rectangle {x0, y0, x1, y1}, or the pair the hooks
  // receive, {plot, meas}: the mark is then clipped to both (their intersection; `meas` may be null when
  // there is no measurement rectangle). Returns the clipped area, 0 when nothing is left.
  function wrnVisibleArea(x0, y0, x1, y1, clip) {
    let cx0 = clip.x0;
    let cy0 = clip.y0;
    let cx1 = clip.x1;
    let cy1 = clip.y1;
    if (clip.plot !== undefined) {
      const p = clip.plot;
      cx0 = p.x0;
      cy0 = p.y0;
      cx1 = p.x1;
      cy1 = p.y1;
      const m = clip.meas;
      if (m !== null && m !== undefined) {
        if (m.x0 > cx0) cx0 = m.x0;
        if (m.y0 > cy0) cy0 = m.y0;
        if (m.x1 < cx1) cx1 = m.x1;
        if (m.y1 < cy1) cy1 = m.y1;
      }
    }
    const w = (x1 < cx1 ? x1 : cx1) - (x0 > cx0 ? x0 : cx0);
    const h = (y1 < cy1 ? y1 : cy1) - (y0 > cy0 ? y0 : cy0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // E.warn.tally (API.md A.3, C.11, DD-02): a fresh accumulator. All counters are plain numbers on the
  // returned object (read them, never write them); the methods are closures over that one object, so a
  // hot loop calls them without allocating. `reset()` zeroes it for the next pass.
  //   add(idx, clip, defined, nonzero)                         a mark with no box (a pane bar)
  //   addBox(x0, y0, x1, y1, clipRect, idx, clip, defined, nonzero)   a mark with a CSS-px box (a cell, a band)
  //   addNegInf() / addBoxNegInf(x0, y0, x1, y1, clip)         a negative-infinite mark (occupied AND outside)
  //   addNoRef()                                               a no-reference mark: counted for its key only
  // `idx` is the LUT index the encoder gave the mark, `clip` its E.scale.CLIP code, `defined` whether the
  // value is a real one, `nonzero` whether it is not zero.
  function wrnTally() {
    const t = {
      marks: 0,
      outside: 0,
      low: 0,
      high: 0,
      exactLow: 0,
      exactHigh: 0,
      negInf: 0,
      noRef: 0,
      nonzero: 0,
      lowBand: 0,
      highBand: 0,
      area: 0,
      areaOutside: 0,
      add: null,
      addBox: null,
      addNegInf: null,
      addBoxNegInf: null,
      addNoRef: null,
      reset: null,
    };
    t.add = function (idx, clip, defined, nonzero) {
      wrnCount(t, idx, clip, defined, nonzero);
    };
    t.addBox = function (x0, y0, x1, y1, clipRect, idx, clip, defined, nonzero) {
      if (!defined) return;
      const a = wrnVisibleArea(x0, y0, x1, y1, clipRect);
      if (a === 0) return;
      t.area += a;
      if (wrnCount(t, idx, clip, defined, nonzero) === 1) t.areaOutside += a;
    };
    t.addNegInf = function () {
      t.marks++;
      t.outside++;
      t.negInf++;
    };
    t.addBoxNegInf = function (x0, y0, x1, y1, clipRect) {
      const a = wrnVisibleArea(x0, y0, x1, y1, clipRect);
      if (a === 0) return;
      t.area += a;
      t.areaOutside += a;
      t.marks++;
      t.outside++;
      t.negInf++;
    };
    t.addNoRef = function () {
      t.noRef++;
    };
    t.reset = function () {
      t.marks = t.outside = t.low = t.high = t.exactLow = t.exactHigh = 0;
      t.negInf = t.noRef = t.nonzero = t.lowBand = t.highBand = 0;
      t.area = t.areaOutside = 0;
    };
    return t;
  }

  // A share that is 0 (not NaN) when its denominator is 0, so a report of an empty pass is all zeros.
  function wrnShare(part, whole) {
    return whole > 0 ? part / whole : 0;
  }

  // E.warn.evaluate (API.md A.3, C.11, DR-11): the WarnReport of a tally.
  //   cfg = {meaningful?, marks?, area?, lowDisc?}   `meaningful` (default true) is false for a channel with a
  //   natural fixed domain (Taker share, Dwell, Cascade, Efficiency, Relative volume, RSI): it still reports
  //   its clip counts but never "Scale range exceeded" or "Low discrimination" (A-14); the three optional
  //   numbers override the thresholds (defaults THRESHOLDS.WARN_MARKS, WARN_AREA, LOW_DISC), for tests.
  //   -> { meaningful,
  //        rangeExceeded          boolean: marks > 10% OR area > 25% outside (strict),
  //        lowDiscrimination      "low" | "high" | null: more than 90% of the nonzero marks in that end's band,
  //                               each end tested on its own (a 50/50 split across both ends does not warn),
  //        shares                 {marks, area, low, high}: outside/marks, areaOutside/area, lowBand/nonzero,
  //                               highBand/nonzero (the actual numbers the legend shows),
  //        counts                 every counter of the tally (the clip counts the key glyphs show),
  //        warnings               [{id:"range-exceeded", shares:{marks, area}}, {id:"low-discrimination",
  //                               end, share}] in that order, ids as INTEGRATION D.18 names them }
  function wrnEvaluate(t, cfg) {
    const c = cfg !== null && typeof cfg === "object" ? cfg : {};
    const meaningful = c.meaningful === undefined ? true : Boolean(c.meaningful);
    const limitMarks = typeof c.marks === "number" ? c.marks : THRESHOLDS.WARN_MARKS;
    const limitArea = typeof c.area === "number" ? c.area : THRESHOLDS.WARN_AREA;
    const limitDisc = typeof c.lowDisc === "number" ? c.lowDisc : THRESHOLDS.LOW_DISC;
    const shares = {
      marks: wrnShare(t.outside, t.marks),
      area: wrnShare(t.areaOutside, t.area),
      low: wrnShare(t.lowBand, t.nonzero),
      high: wrnShare(t.highBand, t.nonzero),
    };
    const rangeExceeded = meaningful && t.marks > 0 && (shares.marks > limitMarks || shares.area > limitArea);
    let lowDiscrimination = null;
    if (meaningful && t.nonzero > 0) lowDiscrimination = shares.low > limitDisc ? "low" : shares.high > limitDisc ? "high" : null;
    const warnings = [];
    if (rangeExceeded) warnings.push({ id: "range-exceeded", shares: { marks: shares.marks, area: shares.area } });
    if (lowDiscrimination !== null) warnings.push({ id: "low-discrimination", end: lowDiscrimination, share: lowDiscrimination === "low" ? shares.low : shares.high });
    return {
      meaningful,
      rangeExceeded,
      lowDiscrimination,
      shares,
      counts: {
        marks: t.marks,
        outside: t.outside,
        low: t.low,
        high: t.high,
        exactLow: t.exactLow,
        exactHigh: t.exactHigh,
        negInf: t.negInf,
        noRef: t.noRef,
        nonzero: t.nonzero,
        lowBand: t.lowBand,
        highBand: t.highBand,
        area: t.area,
        areaOutside: t.areaOutside,
      },
      warnings,
    };
  }

  API.warn = Object.freeze({
    tally: wrnTally,
    evaluate: wrnEvaluate,
    bandOf: wrnBandOf,
  });

  // == §18-model ==
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

  // == §19-readout ==
  // @part 19-readout
  // @requires 01-util 03-result 05-measure 06-ratio 08-scale 10-context 11-lut 12-role 18-model
  // @prefix rdo
  // @provides readout
  // == §19 readout: one frame behind the encoder, the tooltip, the table and the legend marker (API.md B.10, C.16, DD-17, DD-85) ==
  // A Frame is built ONCE per draw for one channel (Cells, Rows, a pane). It holds everything a mark needs:
  // the kernel of the physical measurement, the plan of the numerical mapping, the colour tables. Two
  // functions hang off it and run the SAME three calls (E.measure.cellValue -> the plan -> the LUT):
  //   encode(z, out)    allocation-free; writes an integer role, a table index, a clip code and the CSS
  //                     colour of ONE mark into the caller's scratch `out`;
  //   readout(z, extra) allocating; runs the same encode into a private scratch and builds the Readout of
  //                     B.10, for the cells somebody inspects.
  // The numbers of the canvas, the tooltip, the table row and the legend marker can therefore not differ:
  // there is one computation, not four that agree (S1-008, S1-019, DR-22). This part reads no clock, no
  // page and no palette: the Lut and the resolved mapping are arguments. It never formats a number for
  // display (a formatter is a legend argument, S1-011): readouts hold canonical numbers only.
  //
  // The scratch `out` is ANY object: encode assigns every field it promises on every call, so a stale
  // value cannot leak from the previous mark. Fields: tag (index in E.result.TAGS; 0 = a value), value (NaN
  // unless tag 0), signed, short, reason, denominator (from E.measure.cellValue), role (ROLE code), idx
  // (table index, -1 when the colour is not a table entry), clip (E.scale.CLIP), t (the scale coordinate:
  // 0..1 unsigned, -1..1 signed), pattern (a glyph id or null), css (the colour, null for a pattern or no
  // fill). `geometry` mode has no measurement: its tag is 0 and its value NaN, and role OCCUPANCY says it.

  // Frozen small-integer codes (C.16). ROWS is the raw Rows-band role of DD-86 (the canvas paints it at the
  // fixed Rows alpha); Delta and Relative-volume bands use POSITIVE, NEGATIVE and MIDPOINT.
  const rdoRole = Object.freeze({ NONE: 0, UNSIGNED: 1, POSITIVE: 2, NEGATIVE: 3, MIDPOINT: 4, PATTERN: 5, OCCUPANCY: 6, ZERO: 7, ROWS: 8 });
  const rdoRoleNone = 0;
  const rdoRoleUnsigned = 1;
  const rdoRolePositive = 2;
  const rdoRoleNegative = 3;
  const rdoRoleMidpoint = 4;
  const rdoRolePattern = 5;
  const rdoRoleOccupancy = 6;
  const rdoRoleZero = 7;
  const rdoRoleRows = 8;
  // The LUT role names a readout states (the `role` of its coordinate): never RGB, which is derivable.
  const rdoRoleNames = Object.freeze(["none", "unsigned", "positive", "negative", "midpoint", "pattern", "occupancy", "zero", "rows"]);
  const rdoClipNames = Object.freeze(["none", "low", "high", "exact-low", "exact-high"]);
  // cellKey(c, r) of explorer.js (line 559): the numeric key of a cell; carried so the tooltip, the table
  // row and the marker can be matched without parsing.
  const rdoCellStride = 2097152;
  // Lut.bar is unsigned entry 160 (DD-87): a constant bar's readout states the entry it is drawn with.
  const rdoBarIndex = 160;
  // The glyph that marks each tag of E.result.TAGS, by tag index (E.role.glyphFor once, at load: the
  // per-cell path is one array read). `null` = no mark of its own (finite, outside-support, hidden).
  const rdoTag = API.result.TAG;
  const rdoFinite = rdoTag["finite"];
  const rdoUndefined = rdoTag["undefined"];
  const rdoInvalid = rdoTag["invalid-input"];
  const rdoPending = rdoTag["pending"];
  const rdoFailed = rdoTag["failed"];
  const rdoUnsupported = rdoTag["unsupported"];
  const rdoGlyphByTag = API.result.TAGS.map((tag) => API.role.glyphFor(tag));
  const rdoProbeCell = Object.freeze({ c: 0, r: 0, v: 0, bv: 0, ct: 0, bt: 0, p: 0, w: 0 });

  // ---- small helpers (allocating paths only) ----------------------------------------------------------

  function rdoNum(x) {
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  }

  function rdoText(x) {
    return typeof x === "string" ? x : null;
  }

  // A programmer error is loud (DD-91: the page wraps frame construction in its fault guard).
  function rdoRequire(ok, message) {
    if (!ok) throw new TypeError("E.readout: " + message);
  }

  function rdoIsDescriptor(m) {
    return m !== null && typeof m === "object" && typeof m.kind === "string" && typeof m.signed === "boolean" && m.clip !== undefined;
  }

  // The mapping a frame draws with, from what the caller has: a bare Descriptor (a fixed mapping: Flow,
  // Dwell, Cascade, Relative volume), a Resolved record of E.policy.resolve (`{state, record, policy,
  // external, reason}`, or `{state, desc, ...}`), or nothing (No calibration). `state` is "ok",
  // "no-calibration", "updating" or "pending": a frame draws values only for a mapping it has a
  // descriptor for and whose state is neither no-calibration nor pending (C.16); "updating" keeps the
  // retained mapping drawing and only the legend says so (DR-06).
  function rdoMapping(m) {
    if (m === null || m === undefined) return { state: "no-calibration", desc: null, policy: null, origin: null, external: false, record: null, reason: "uninitialized" };
    if (rdoIsDescriptor(m)) return { state: "ok", desc: m.kind === "none" ? null : m, policy: "fixed", origin: "fixed", external: false, record: null, reason: null };
    const record = m.record !== undefined && m.record !== null ? m.record : null;
    let desc = m.desc !== undefined ? m.desc : record !== null ? record.desc : null;
    if (desc === undefined || desc === null || desc.kind === "none") desc = null;
    const policy = m.policy !== undefined && m.policy !== null ? m.policy : record !== null && record.policy !== undefined ? record.policy : null;
    const origin = m.origin !== undefined && m.origin !== null ? m.origin : record !== null && record.origin !== undefined ? record.origin : null;
    return { state: typeof m.state === "string" ? m.state : "ok", desc, policy, origin, external: m.external === true, record, reason: typeof m.reason === "string" ? m.reason : null };
  }

  // May this mapping colour marks at all?
  function rdoDrawable(map) {
    return map.desc !== null && map.state !== "no-calibration" && map.state !== "pending";
  }

  // A descriptor whose signedness disagrees with the measure is a wiring error: a signed measure needs
  // its two arms, an unsigned one must never paint an arm.
  function rdoCheckSigned(map, signed, what) {
    if (map.desc !== null && map.desc.signed !== signed) throw new RangeError("E.readout: a " + (map.desc.signed ? "signed" : "unsigned") + " mapping cannot colour " + what + ", a " + (signed ? "signed" : "unsigned") + " measure");
  }

  // The transform id a context and the DOM state speak (D.18 data-transform), from the descriptor: the
  // kinds map to value-log, value-linear, rank or fixed; a zero-only calibration has no curve of its own,
  // so it reads as the default Value curve unless the caller says otherwise (`spec.transformId`).
  function rdoTransformOf(desc, override) {
    if (typeof override === "string") return override;
    if (desc === null) return null;
    switch (desc.kind) {
      case "value-log1p":
        return "value-log";
      case "value-linear":
        return "value-linear";
      case "rank-type7-257":
        return "rank";
      case "fixed-linear":
      case "fixed-diverging":
        return "fixed";
      case "axis-linear":
        return "axis";
      default:
        return "value-log";
    }
  }

  function rdoFingerprint(mappingId, state, lut) {
    return [mappingId, state, lut.id, lut.theme].join("|");
  }

  // The coordinate function a legend uses to place its ticks and to check its marker: the frame's OWN plan,
  // so a tick sits exactly where the encoder would put the value (S1-019). null without a mapping.
  function rdoApplier(plan) {
    if (plan === null) return null;
    const sc = { t: 0, clip: 0, state: null };
    return (value, out) => {
      plan.apply(value, sc);
      out.t = sc.t;
      out.clip = sc.clip;
      return out;
    };
  }

  function rdoContextKey(spec, map) {
    if (spec.ctx !== undefined && spec.ctx !== null) return API.context.keyString(spec.ctx);
    if (typeof spec.contextKey === "string") return spec.contextKey;
    return map.record !== null && typeof map.record.key === "string" ? map.record.key : null;
  }

  // ---- the observation, scale, state blocks of a readout (B.10) -------------------------------------------

  // B.2 as a readout carries it. `read` (from `extra`, because meas.state feeds readouts and legends but
  // never a mark's fill, DD-84) wins over the frame's own observation. Everything a caller did not give is
  // null, never undefined: a readout is JSON-safe.
  function rdoObservation(obs, readOverride, level) {
    const o = obs !== undefined && obs !== null ? obs : {};
    let read = readOverride !== undefined && readOverride !== null ? readOverride : o.read;
    let updating = o.updating === true;
    if (read !== null && typeof read === "object") {
      if (read.updating === true) updating = true;
      read = read.state;
    }
    return {
      source: rdoText(o.source),
      instrument: rdoText(o.instrument),
      read: rdoText(read),
      updating,
      cutoffMs: rdoNum(o.cutoffMs),
      liveCutoffMs: rdoNum(o.liveCutoffMs),
      canonicalThroughMs: rdoNum(o.canonicalThroughMs),
      token: rdoText(o.token),
      generation: rdoNum(o.generation),
      replay: o.replay === true,
      coverage: typeof o.coverage === "string" ? o.coverage : "range",
      revision: o.revision !== undefined && o.revision !== null ? o.revision : null,
      provenance: Array.isArray(o.provenance) ? o.provenance.slice() : [],
      level: level === null ? null : { n: level.n, m: level.m },
    };
  }

  // The mapping summary of a readout: the id and kind of the descriptor, the policy and origin, the context
  // key, the state, the observation end of the calibration and whether it is an external override.
  function rdoScaleBlock(map, contextKey, warnings) {
    const record = map.record;
    return {
      id: map.desc !== null ? map.desc.id : null,
      kind: map.desc !== null ? map.desc.kind : "none",
      policy: map.policy,
      origin: map.origin,
      contextKey,
      state: map.state,
      obsEndMs: record !== null ? rdoNum(record.obsEndMs) : null,
      external: map.external,
      warnings: Array.isArray(warnings) ? warnings.slice() : [],
    };
  }

  // D7's independent dimensions, kept apart: occupancy, numerical validity, read state, finality,
  // calibration and interaction (support and level are their own fields).
  function rdoStateBlock(typed, observation, finality, calibration, extra) {
    return {
      occupancy: extra !== null && typeof extra.occupancy === "string" ? extra.occupancy : "occupied",
      validity: typed === null ? "none" : typed.tag === "finite" ? "defined" : typed.tag,
      read: observation.read,
      finality,
      calibration,
      interaction: extra !== null && typeof extra.interaction === "string" ? extra.interaction : null,
    };
  }

  function rdoCoordinate(scratch) {
    if (scratch.tag !== rdoFinite || scratch.role === rdoRoleNone || scratch.role === rdoRolePattern || scratch.role === rdoRoleOccupancy) return null;
    return { t: scratch.t, idx: scratch.idx, role: rdoRoleNames[scratch.role], clip: rdoClipNames[scratch.clip] };
  }

  function rdoNewScratch() {
    return { tag: 0, value: NaN, signed: false, short: false, reason: null, denominator: null, role: 0, idx: -1, clip: 0, t: 0, pattern: null, css: null };
  }

  // ---- Cells --------------------------------------------------------------------------------------------

  // The measure identity of a cells frame (formula, basis, unit) through the public E.measure record, asked
  // with an all-zero cell once per frame and only when somebody needs it (readout, legend): the catalogue
  // stays in part 05 and is never repeated here.
  function rdoCellsMeta(kernel) {
    const probe = Object.assign({}, kernel, { z: rdoProbeCell, read: null, replay: false, measured: null, cascade: null, exposure: null, bounds: null });
    const m = API.measure.cellMeasurement(probe);
    return { formula: m.formula, measure: m.measure, basis: m.basis, unit: m.unit };
  }

  function rdoStepOf(level, letter) {
    return Math.pow(2, level[letter]);
  }

  // The support of a cell in base units: its time and price extent clipped to the measured rectangle, the
  // cutoff and (for a motion measure) the motion end. A cell entirely outside keeps an empty extent.
  function rdoCellSupport(z, b, cut, end, ts, ps, state) {
    const t0 = Math.max(z.c * ts, b[0]);
    const t1 = Math.max(t0, Math.min((z.c + 1) * ts, b[1], cut, end));
    const p0 = Math.max(z.r * ps, b[2]);
    const p1 = Math.max(p0, Math.min((z.r + 1) * ps, b[3]));
    return { time: [t0, t1], price: [p0, p1], portion: state.portion, open: state.open, partial: state.partial };
  }

  function rdoExposureRecord(ex) {
    if (ex === null) return null;
    return {
      seconds: rdoNum(ex.seconds),
      width: rdoNum(ex.width),
      timeFraction: rdoNum(ex.timeFraction),
      priceFraction: rdoNum(ex.priceFraction),
      nominalSeconds: rdoNum(ex.nominalSeconds),
      nominalWidth: rdoNum(ex.nominalWidth),
      short: ex.short === true,
      uses: { t: ex.uses.t === true, w: ex.uses.w === true },
      coverage: ex.coverage,
      coveredTo: ex.coveredTo,
    };
  }

  // E.readout.cellsFrame (API.md C.16). `spec` = { mode, basis, pathBasis, level:{n,m}, bounds, cut, cutMs,
  // end, geom:{BASE,PR}, CUT, replay, mapping, lut, read, measured, cascade, observation, model, ctx |
  // contextKey, transformId, t0 }. `mapping` is a Resolved record of E.policy.resolve or, for a fixed
  // measure, its bare Descriptor. `read` is null unless the DISPLAYED block itself cannot answer for the
  // cell (DD-84): a pan into an unmeasured rectangle must not turn every loaded cell into a pattern.
  function rdoCellsFrame(spec) {
    rdoRequire(spec !== null && typeof spec === "object", "cellsFrame needs a spec object");
    const mode = spec.mode;
    const info = Object.prototype.hasOwnProperty.call(API.measure.MODES, mode) ? API.measure.MODES[mode] : undefined;
    if (info === undefined) throw new RangeError("E.readout.cellsFrame: unknown mode " + JSON.stringify(mode));
    const level = spec.level;
    rdoRequire(level !== null && typeof level === "object" && Number.isFinite(level.n) && Number.isFinite(level.m), "cellsFrame needs the effective level {n, m}");
    const lut = spec.lut;
    rdoRequire(lut !== null && typeof lut === "object" && lut.unsigned !== undefined && lut.occupancy !== undefined, "cellsFrame needs a Lut (E.lut.build)");
    const geometry = mode === "geometry";
    // Geometry has no mapping to wait for: without one it is simply ok (it is an outline, never "No
    // calibration").
    const map = geometry && (spec.mapping === null || spec.mapping === undefined) ? rdoMapping({ state: "ok", desc: null, policy: "fixed" }) : rdoMapping(spec.mapping);
    if (!geometry) rdoCheckSigned(map, info.signed, mode);
    const drawable = !geometry && rdoDrawable(map);
    const plan = drawable ? API.scale.plan(map.desc) : null;
    const signed = plan !== null && plan.signed;
    const index = API.scale.index;
    // ONE mutable kernel per frame (DD-85): encode re-points z and bounds, never builds a spec literal.
    const kernel = {
      mode,
      basis: spec.basis,
      pathBasis: spec.pathBasis,
      geom: spec.geom,
      cut: spec.cut,
      end: spec.end,
      CUT: spec.CUT,
      replay: spec.replay === true,
      level,
      read: spec.read !== undefined ? spec.read : null,
      measured: typeof spec.measured === "function" ? spec.measured : null,
      cascade: typeof spec.cascade === "function" ? spec.cascade : null,
      z: null,
      bounds: spec.bounds !== undefined ? spec.bounds : null,
      exposure: null,
    };
    const defaultBounds = kernel.bounds;
    const sc = { t: 0, clip: 0, state: null };
    const scratch = rdoNewScratch();
    const cellValue = API.measure.cellValue;
    const glyphs = rdoGlyphByTag;
    const occupancyCss = lut.occupancy.css;
    const midpointCss = lut.midpoint.css;
    const unsignedCss = lut.unsigned.css;
    const positiveCss = lut.positive.css;
    const negativeCss = lut.negative.css;
    const mappingId = map.desc !== null ? map.desc.id : "";
    const fingerprint = rdoFingerprint(mappingId, map.state, lut);
    let meta = null;

    // The steady-frame path: no allocation, no formatting, one LUT read. Comments stay above the function:
    // the hot-path test scans its source.
    function encode(z, out, bounds) {
      out.css = null;
      out.pattern = null;
      out.role = rdoRoleNone;
      out.idx = -1;
      out.clip = 0;
      out.t = 0;
      if (geometry) {
        out.tag = rdoFinite;
        out.value = NaN;
        out.signed = false;
        out.short = false;
        out.reason = null;
        out.denominator = null;
        out.role = rdoRoleOccupancy;
        out.css = occupancyCss;
        return out;
      }
      kernel.z = z;
      kernel.bounds = bounds === undefined ? defaultBounds : bounds;
      cellValue(kernel, out);
      if (out.tag !== rdoFinite) {
        const g = glyphs[out.tag];
        if (g !== null) {
          out.role = rdoRolePattern;
          out.pattern = g;
        }
        return out;
      }
      if (plan === null) {
        out.role = rdoRoleOccupancy;
        out.css = occupancyCss;
        return out;
      }
      plan.apply(out.value, sc);
      const t = sc.t;
      out.t = t;
      out.clip = sc.clip;
      if (signed) {
        if (t > 0) {
          out.role = rdoRolePositive;
          out.idx = index(t);
          out.css = positiveCss[out.idx];
        } else if (t < 0) {
          out.role = rdoRoleNegative;
          out.idx = index(t);
          out.css = negativeCss[out.idx];
        } else {
          out.role = rdoRoleMidpoint;
          out.idx = 0;
          out.css = midpointCss;
        }
      } else if (out.value === 0) {
        out.role = rdoRoleZero;
        out.css = occupancyCss;
      } else {
        out.role = rdoRoleUnsigned;
        out.idx = index(t);
        out.css = unsignedCss[out.idx];
      }
      return out;
    }

    // The Readout of B.10 for one inspected cell: the SAME encode into a private scratch, plus the
    // allocating record of the measurement (E.measure.cellMeasurement), the cell's state and support.
    // `extra` = { read (the meas.state that feeds readouts, never a fill), interaction, occupancy,
    // warnings, t0 }.
    function readout(z, extra) {
      const ex = extra !== undefined && extra !== null ? extra : null;
      const b = spec.bounds !== undefined && spec.bounds !== null ? spec.bounds : [-Infinity, Infinity, -Infinity, Infinity];
      const ts = rdoStepOf(level, "n");
      const ps = rdoStepOf(level, "m");
      const cutBase = spec.cut === undefined ? Infinity : spec.cut;
      const observation = rdoObservation(spec.observation, ex !== null ? ex.read : undefined, level);
      const key = z.c * rdoCellStride + z.r;
      const warnings = ex !== null ? ex.warnings : undefined;
      const scale = rdoScaleBlock(map, rdoContextKey(spec, map), warnings);
      const motion = mode === "path" || mode === "dwell";
      const cs = API.measure.cellState(z, b, cutBase, spec.CUT === undefined ? Infinity : spec.CUT, spec.replay === true, ts, ps);
      const support = rdoCellSupport(z, b, cutBase, motion && spec.end !== undefined ? spec.end : Infinity, ts, ps, cs);
      const geom = spec.geom !== undefined ? spec.geom : LATTICE;
      const T0 = spec.t0 !== undefined ? spec.t0 : LATTICE.T0;
      const startMs = API.time.baseToMs(z.c * ts, T0, geom.BASE);
      const endMs = Math.max(startMs, API.time.baseToMs(Math.min((z.c + 1) * ts, cutBase), T0, geom.BASE));
      const finality = cs.open ? "open" : cs.partial ? "partial" : "complete";
      const when = rdoEvInterval(startMs, endMs, finality);
      const base = { v: VERSION.readout, key, consumer: "cells", level: { n: level.n, m: level.m }, observation };
      if (geometry) {
        return Object.assign(base, {
          measure: { formula: null, measure: mode, basis: null, unit: null },
          observed: null,
          supplied: null,
          coordinate: null,
          typed: null,
          scale,
          support,
          exposure: null,
          state: rdoStateBlock(null, observation, finality, map.state, ex),
          when,
          model: spec.model !== undefined ? spec.model : null,
          level2: null,
        });
      }
      const probe = Object.assign({}, kernel, { z, bounds: b, exposure: null, read: ex !== null && ex.read !== undefined ? ex.read : kernel.read });
      const m = API.measure.cellMeasurement(probe);
      encode(z, scratch);
      const typed = m.result;
      const coordinate = typed.tag === "finite" ? rdoCoordinate(scratch) : null;
      return Object.assign(base, {
        measure: { formula: m.formula, measure: m.measure, basis: m.basis, unit: m.unit },
        observed: m.numerator === null ? null : { value: m.numerator, unit: m.numeratorUnit },
        supplied: typed.tag === "finite" ? { value: typed.value, unit: m.unit } : null,
        coordinate,
        typed,
        scale,
        support,
        exposure: m.exposure,
        state: rdoStateBlock(typed, observation, finality, map.state, ex),
        when,
        model: spec.model !== undefined ? spec.model : null,
        level2: null,
      });
    }

    // What E.legend.build needs, and nothing else: the descriptor, the Lut, the role of the bar, the level,
    // the measure identity. Allocates, so it is asked only when the legend's id key changed (DD-90).
    function legendInput() {
      if (meta === null) meta = rdoCellsMeta(kernel);
      let barRole = "unsigned";
      if (geometry) barRole = "outline";
      else if (map.desc === null) barRole = "outline";
      else if (map.desc.kind === "fixed-linear" || map.desc.kind === "fixed-diverging") barRole = "fixed";
      else if (map.desc.signed) barRole = "signed";
      return {
        channel: "cells",
        kind: "cells",
        mode,
        measure: meta.measure,
        formula: meta.formula,
        basis: meta.basis,
        unit: meta.unit,
        transform: rdoTransformOf(map.desc, spec.transformId),
        desc: map.desc,
        mappingId,
        state: map.state,
        policy: map.policy,
        origin: map.origin,
        external: map.external,
        reason: map.reason,
        calibration: map.record,
        lut,
        barRole,
        level: { n: level.n, m: level.m },
        contextKey: rdoContextKey(spec, map),
        observation: spec.observation !== undefined ? spec.observation : null,
        model: spec.model !== undefined ? spec.model : null,
        composite: null,
        apply: rdoApplier(plan),
      };
    }

    return Object.freeze({
      kind: "cells",
      mode,
      level: Object.freeze({ n: level.n, m: level.m }),
      bounds: defaultBounds,
      mappingId,
      mappingState: map.state,
      encode,
      readout,
      fingerprint: () => fingerprint,
      legendInput,
    });
  }

  // ---- Rows ---------------------------------------------------------------------------------------------

  function rdoSetTyped(out, tag, reason, denominator) {
    out.tag = tag;
    out.value = NaN;
    out.reason = reason;
    out.denominator = denominator;
    return out;
  }

  // The value of one band (C.16): volume `v`, delta `2*bv - v`, time `w`, Relative volume from the typed
  // per-bin result. A number that is not finite is a validation failure, never a fill.
  function rdoRowValue(kind, band, relvol, out) {
    let x;
    if (kind === "volume") x = band.v;
    else if (kind === "delta") x = 2 * band.bv - band.v;
    else if (kind === "time") x = band.w;
    else {
      if (relvol === null) return rdoSetTyped(out, rdoPending, "reading", null);
      const typed = relvol.at(band.r);
      if (typed.tag === "finite") {
        out.tag = rdoFinite;
        out.value = typed.value;
        out.reason = null;
        out.denominator = null;
        return out;
      }
      return rdoSetTyped(out, rdoTag[typed.tag], typeof typed.reason === "string" ? typed.reason : null, typeof typed.denominator === "string" ? typed.denominator : null);
    }
    if (Number.isFinite(x)) {
      out.tag = rdoFinite;
      out.value = x;
      out.reason = null;
      out.denominator = null;
      return out;
    }
    return rdoSetTyped(out, rdoInvalid, "non-finite", null);
  }

  // The read status of a Rows channel (precedence, DD-05): failed, pending and unsupported reads beat any
  // arithmetic. Relative volume carries its own status inside `relvol.at`.
  function rdoRowRead(read, out) {
    if (read === null || read === undefined) return false;
    const state = read.state;
    if (state === "failed") {
      rdoSetTyped(out, rdoFailed, typeof read.reason === "string" ? read.reason : "read failed", null);
      return true;
    }
    if (state === "pending") {
      rdoSetTyped(out, rdoPending, typeof read.reason === "string" ? read.reason : "reading", null);
      return true;
    }
    if (state === "unsupported") {
      rdoSetTyped(out, rdoUnsupported, typeof read.reason === "string" ? read.reason : "not supported", null);
      return true;
    }
    return false;
  }

  // E.readout.rowsFrame (API.md C.16). `spec` = { kind: "volume"|"delta"|"time"|"relvol", rowSize (the level
  // m of the effective bands), mapping, lut, relvol (an E.relvol result, for kind relvol), read, surface
  // (the surface RGB the legend composites over), composite (an optional precomputed E.lut.composite, or
  // {positive, negative} for the signed kinds), info (a JSON-safe description of the period: the period
  // identity, effective row size, quality, endpoint, stale; copied into the readout unchanged),
  // observation, model, ctx | contextKey }. The CANVAS paints the raw role colour at the fixed Rows alpha
  // (DD-86); the composite exists for the legend's samples only.
  function rdoRowsFrame(spec) {
    rdoRequire(spec !== null && typeof spec === "object", "rowsFrame needs a spec object");
    const kind = spec.kind;
    const info = Object.prototype.hasOwnProperty.call(API.measure.ROWS, kind) ? API.measure.ROWS[kind] : undefined;
    if (info === undefined) throw new RangeError("E.readout.rowsFrame: unknown kind " + JSON.stringify(kind));
    const lut = spec.lut;
    rdoRequire(lut !== null && typeof lut === "object" && lut.rows !== undefined, "rowsFrame needs a Lut (E.lut.build)");
    const map = rdoMapping(spec.mapping);
    rdoCheckSigned(map, info.signed, "rows " + kind);
    const drawable = rdoDrawable(map);
    const plan = drawable ? API.scale.plan(map.desc) : null;
    const signed = plan !== null && plan.signed;
    const index = API.scale.index;
    const relvol = spec.relvol !== undefined && spec.relvol !== null ? spec.relvol : null;
    const read = spec.read !== undefined ? spec.read : null;
    const sc = { t: 0, clip: 0, state: null };
    const scratch = rdoNewScratch();
    const glyphs = rdoGlyphByTag;
    const occupancyCss = lut.occupancy.css;
    const midpointCss = lut.midpoint.css;
    const rowsCss = lut.rows.css;
    const positiveCss = lut.positive.css;
    const negativeCss = lut.negative.css;
    const mappingId = map.desc !== null ? map.desc.id : "";
    const fingerprint = rdoFingerprint(mappingId, map.state, lut);
    const rowSize = spec.rowSize;

    // One band: the same order as a cell (read status, value, pattern for a non-value, then the mapping).
    // Volume and Time at price use the raw `rows` role; Delta and Relative volume use the arms.
    function encode(band, out) {
      out.css = null;
      out.pattern = null;
      out.role = rdoRoleNone;
      out.idx = -1;
      out.clip = 0;
      out.t = 0;
      out.signed = signed;
      out.short = false;
      if (!rdoRowRead(read, out)) rdoRowValue(kind, band, relvol, out);
      if (out.tag !== rdoFinite) {
        const g = glyphs[out.tag];
        if (g !== null) {
          out.role = rdoRolePattern;
          out.pattern = g;
        }
        return out;
      }
      if (plan === null) {
        out.role = rdoRoleOccupancy;
        out.css = occupancyCss;
        return out;
      }
      plan.apply(out.value, sc);
      const t = sc.t;
      out.t = t;
      out.clip = sc.clip;
      if (signed) {
        if (t > 0) {
          out.role = rdoRolePositive;
          out.idx = index(t);
          out.css = positiveCss[out.idx];
        } else if (t < 0) {
          out.role = rdoRoleNegative;
          out.idx = index(t);
          out.css = negativeCss[out.idx];
        } else {
          out.role = rdoRoleMidpoint;
          out.idx = 0;
          out.css = midpointCss;
        }
      } else if (out.value === 0) {
        out.role = rdoRoleZero;
        out.css = occupancyCss;
      } else {
        out.role = rdoRoleRows;
        out.idx = index(t);
        out.css = rowsCss[out.idx];
      }
      return out;
    }

    const formula = info.formula;
    const formulaRecord = API.measure.FORMULAS[formula];

    function readout(band, extra) {
      const ex = extra !== undefined && extra !== null ? extra : null;
      const observation = rdoObservation(spec.observation, ex !== null ? ex.read : undefined, null);
      const stepRows = Math.pow(2, rowSize);
      const scratchOut = encode(band, scratch);
      // A read status handed to the readout (meas.state) outranks the arithmetic there, exactly as in the
      // kernel; the mark itself keeps the frame's own read (DD-84).
      const readScratch = rdoNewScratch();
      const typed = ex !== null && rdoRowRead(ex.read, readScratch) ? rdoScratchTyped(readScratch) : rdoScratchTyped(scratchOut);
      const observedValue = kind === "volume" ? band.v : kind === "delta" ? 2 * band.bv - band.v : kind === "time" ? band.w : null;
      const observedUnit = kind === "time" ? "seconds" : "usdt";
      const observed = observedValue !== null && Number.isFinite(observedValue) ? { value: observedValue, unit: observedUnit } : null;
      return {
        v: VERSION.readout,
        key: "row:" + band.r,
        consumer: "rows",
        level: { n: null, m: rowSize },
        observation,
        measure: { formula, measure: kind, basis: formulaRecord.basisKind, unit: formulaRecord.unit },
        observed,
        supplied: typed.tag === "finite" ? { value: typed.value, unit: formulaRecord.unit } : null,
        coordinate: typed.tag === "finite" ? rdoCoordinate(scratchOut) : null,
        typed,
        scale: rdoScaleBlock(map, rdoContextKey(spec, map), ex !== null ? ex.warnings : undefined),
        support: { time: null, price: [band.r * stepRows, (band.r + 1) * stepRows], portion: false, open: false, partial: false },
        exposure: null,
        state: rdoStateBlock(typed, observation, "complete", map.state, ex),
        when: rdoEvSummary(spec.info, observation),
        model: spec.model !== undefined ? spec.model : null,
        rows: spec.info !== undefined && spec.info !== null ? spec.info : null,
        level2: null,
      };
    }

    function legendInput() {
      // The bar role enum of B.11: a Rows band is always the named rows-projection role (DD-72); whether its
      // ramp has one arm or two is the descriptor's signedness, which the legend reads from `desc`.
      const barRole = map.desc === null ? "outline" : "rows-projection";
      return {
        channel: "rows",
        kind: "rows",
        mode: kind,
        measure: kind,
        formula,
        basis: formulaRecord.basisKind,
        unit: formulaRecord.unit,
        transform: rdoTransformOf(map.desc, spec.transformId),
        desc: map.desc,
        mappingId,
        state: map.state,
        policy: map.policy,
        origin: map.origin,
        external: map.external,
        reason: map.reason,
        calibration: map.record,
        lut,
        barRole,
        level: { n: null, m: rowSize },
        contextKey: rdoContextKey(spec, map),
        observation: spec.observation !== undefined ? spec.observation : null,
        model: spec.model !== undefined ? spec.model : null,
        composite: rdoRowsComposite(spec, lut, map.desc, info),
        info: spec.info !== undefined ? spec.info : null,
        apply: rdoApplier(plan),
      };
    }

    return Object.freeze({
      kind: "rows",
      mode: kind,
      level: Object.freeze({ n: null, m: rowSize }),
      bounds: null,
      mappingId,
      mappingState: map.state,
      encode,
      readout,
      fingerprint: () => fingerprint,
      legendInput,
    });
  }

  // The Typed record of a finished scratch (for a readout; allocates).
  function rdoTypedFields(o) {
    const fields = {};
    if (o.tag === rdoFinite) fields.value = o.value;
    else {
      if (typeof o.reason === "string") fields.reason = o.reason;
      if (typeof o.denominator === "string") fields.denominator = o.denominator;
      if (API.result.TAGS[o.tag] === "waiting-for-complete-parent") fields.open = true;
    }
    return fields;
  }

  function rdoScratchTyped(o) {
    return API.result.make(API.result.TAGS[o.tag], rdoTypedFields(o));
  }

  // What the legend shows for a Rows mapping: the composite of the raw role over the surface at the fixed
  // Rows alpha (DD-86), the colours the bands actually have. `spec.composite` wins (a caller that already
  // computed it); else it is made from `spec.surface`; with neither, the legend samples the raw roles and
  // says nothing about a projection. Volume and Time use the rows role, Delta and Relative volume the arms.
  function rdoRowsComposite(spec, lut, desc, info) {
    if (spec.composite !== undefined && spec.composite !== null) return spec.composite;
    if (!Array.isArray(spec.surface) || desc === null) return null;
    const alpha = API.lut.ROWS_ALPHA;
    if (desc.signed) {
      return {
        positive: API.lut.composite("positive", alpha, spec.surface, lut),
        negative: API.lut.composite("negative", alpha, spec.surface, lut),
        midpoint: API.lut.over(lut.midpoint.rgb, alpha, spec.surface),
      };
    }
    return API.lut.composite("rows", alpha, spec.surface, lut);
  }

  // ---- Panes --------------------------------------------------------------------------------------------

  // The coordinate descriptor of an axis record (B.12): an axis-linear window over its domain. Its `t` is the
  // position between lo and hi, and the plan's clip codes are those of any fixed window (C.5), so a bar's
  // length and its clipping are computed by the same evaluator as a colour coordinate.
  function rdoAxisPlan(axis) {
    if (axis === null || axis === undefined || axis.typed !== "finite" || !Array.isArray(axis.domain) || axis.domain.length !== 2) return null;
    if (!(Number.isFinite(axis.domain[0]) && Number.isFinite(axis.domain[1]) && axis.domain[0] < axis.domain[1])) return null;
    const desc = { v: VERSION.mapping, id: typeof axis.mappingId === "string" ? axis.mappingId : "", kind: "axis-linear", signed: axis.sign !== "unsigned", params: { lo: axis.domain[0], hi: axis.domain[1] }, clip: "axis@1", algorithm: "axis@1" };
    return API.scale.plan(desc);
  }

  // DR-39: E.ratio.efficiency REQUIRES an explicit baseline and has no fallback that depends on load order.
  // A column context whose ratio input carries none gets the recorded model's own
  // (E.model.PROVENANCE.baseline = 2 ** (ISO_B - 1)), in a copy: the caller's object is never changed. Only
  // the Efficiency pane takes this path, and its ratio kernel allocates a small Typed anyway (part 06).
  function rdoEfficiencyCtx(ctx, baseline) {
    if (ctx === null || ctx === undefined || ctx.ratio === undefined || ctx.ratio === null || ctx.ratio.baseline !== undefined) return ctx;
    return { read: ctx.read, hidden: ctx.hidden, ratio: Object.assign({ baseline }, ctx.ratio) };
  }

  // E.readout.paneFrame (API.md C.16). `spec` = { key (volume, trades, delta, takertrades, size,
  // choppiness, perpath, cascade, efficiency), axis (an AxisRecord of E.axis: id, sign, typed, domain,
  // policy, mappingId, unit, hold, clipped, provenance, guides), lut, ctx (the default {read, hidden,
  // ratio} of E.measure.columnValue), observation, model }. encode(col, out, ctx): the third argument is
  // the column's own context (the ratio columns need their structure per column). `out.t` is the bar
  // length as a fraction of the axis (0..1 unsigned, -1..1 signed and ratio), `out.clip` a counted clip.
  // The fill: the constant bar colour (Lut.bar) for an unsigned axis, the arm colours for a signed or
  // ratio axis; a zero is a tick, an undefined column a diamond on the baseline, other non-values the
  // pattern of their tag (B.9).
  function rdoPaneFrame(spec) {
    rdoRequire(spec !== null && typeof spec === "object", "paneFrame needs a spec object");
    const key = spec.key !== undefined ? spec.key : spec.measure;
    rdoRequire(typeof key === "string", "paneFrame needs the column measure key");
    const lut = spec.lut;
    rdoRequire(lut !== null && typeof lut === "object" && lut.unsigned !== undefined && lut.bar !== undefined, "paneFrame needs a Lut (E.lut.build)");
    const axis = spec.axis !== undefined ? spec.axis : null;
    const plan = rdoAxisPlan(axis);
    const axisSigned = axis !== null && axis.sign !== "unsigned";
    const zeroOnly = axis !== null && axis.typed === "zero-only";
    const sc = { t: 0, clip: 0, state: null };
    const scratch = rdoNewScratch();
    const columnValue = API.measure.columnValue;
    const glyphs = rdoGlyphByTag;
    const bar = lut.bar.css;
    const positiveTop = lut.positive.css[255];
    const negativeTop = lut.negative.css[255];
    const stateInk = lut.stateInk.css;
    const defaultCtx = spec.ctx !== undefined ? spec.ctx : null;
    const efficiency = key === "efficiency";
    const baseline = efficiency ? API.model.PROVENANCE.baseline : 0;
    const axisId = axis !== null ? axis.id : null;
    const mappingId = axis !== null && typeof axis.mappingId === "string" ? axis.mappingId : "";
    const axisState = axis !== null ? axis.typed : "none";
    const fingerprint = rdoFingerprint(mappingId, axisState, lut);

    // One column. The bar's coordinate is the position in the axis window; a signed or ratio axis maps it
    // to -1..1 about its midpoint so the sign picks the arm.
    function encode(col, out, ctx) {
      out.css = null;
      out.pattern = null;
      out.role = rdoRoleNone;
      out.idx = -1;
      out.clip = 0;
      out.t = 0;
      const c = ctx === undefined ? defaultCtx : ctx;
      columnValue(key, col, efficiency ? rdoEfficiencyCtx(c, baseline) : c, out);
      if (out.tag !== rdoFinite) {
        const g = out.tag === rdoUndefined ? "diamond" : glyphs[out.tag];
        if (g !== null) {
          out.role = rdoRolePattern;
          out.pattern = g;
        }
        return out;
      }
      const x = out.value;
      if (x === 0) {
        out.role = rdoRoleZero;
        out.pattern = "tick";
        out.css = stateInk;
        return out;
      }
      let t;
      if (plan !== null) {
        plan.apply(x, sc);
        out.clip = sc.clip;
        t = axisSigned ? 2 * sc.t - 1 : sc.t;
      } else if (zeroOnly) {
        // Out of domain on the side the value lies, exactly as E.axis.coordinate places it (a negative one is
        // LOW at the low end of a signed axis; an unsigned axis has no low side to draw, so it sits at 0).
        out.clip = x < 0 ? 1 : 2;
        t = x < 0 ? (axisSigned ? -1 : 0) : 1;
      } else return out;
      out.t = t;
      if (!axisSigned) {
        out.role = rdoRoleUnsigned;
        out.idx = rdoBarIndex;
        out.css = bar;
      } else if (x > 0) {
        out.role = rdoRolePositive;
        out.idx = 255;
        out.css = positiveTop;
      } else {
        out.role = rdoRoleNegative;
        out.idx = 255;
        out.css = negativeTop;
      }
      return out;
    }

    const formula = "columns." + key + "@1";
    const formulaRecord = Object.prototype.hasOwnProperty.call(API.measure.FORMULAS, formula) ? API.measure.FORMULAS[formula] : null;

    function readout(col, extra) {
      const ex = extra !== undefined && extra !== null ? extra : null;
      const observation = rdoObservation(spec.observation, ex !== null ? ex.read : undefined, null);
      const ctx = ex !== null && ex.ctx !== undefined ? ex.ctx : defaultCtx;
      encode(col, scratch, ctx === null ? undefined : ctx);
      const typed = rdoScratchTyped(scratch);
      const unit = formulaRecord !== null ? formulaRecord.unit : axis !== null ? axis.unit : null;
      const finite = typed.tag === "finite";
      const scale = {
        id: mappingId === "" ? null : mappingId,
        kind: "axis-linear",
        policy: axis !== null ? axis.policy : null,
        origin: "axis",
        contextKey: axisId,
        state: axisState,
        obsEndMs: axis !== null && axis.provenance !== undefined && axis.provenance !== null ? rdoNum(axis.provenance.through) : null,
        external: false,
        warnings: ex !== null && Array.isArray(ex.warnings) ? ex.warnings.slice() : [],
      };
      return {
        v: VERSION.readout,
        key: "col:" + (col.c !== undefined ? col.c : ex !== null && ex.index !== undefined ? ex.index : "?"),
        consumer: "pane",
        level: null,
        observation,
        measure: { formula: formulaRecord !== null ? formula : null, measure: key, basis: formulaRecord !== null ? formulaRecord.basisKind : null, unit },
        observed: finite ? { value: typed.value, unit } : null,
        supplied: finite ? { value: typed.value, unit } : null,
        coordinate: finite && scratch.role !== rdoRoleNone ? { t: scratch.t, idx: scratch.idx, role: rdoRoleNames[scratch.role], clip: rdoClipNames[scratch.clip] } : null,
        typed,
        scale,
        axis: axis === null ? null : { id: axis.id, policy: axis.policy, sign: axis.sign, typed: axis.typed, domain: Array.isArray(axis.domain) ? axis.domain.slice() : null, unit: axis.unit, hold: axis.hold !== undefined ? axis.hold : null },
        support: null,
        exposure: null,
        state: rdoStateBlock(typed, observation, "complete", axisState, ex),
        when: ex !== null && Array.isArray(ex.interval) ? rdoEvInterval(ex.interval[0], ex.interval[1], ex.interval[2]) : rdoEvInterval(null, null, "unknown"),
        model: spec.model !== undefined ? spec.model : null,
        level2: null,
      };
    }

    function legendInput() {
      return {
        channel: "pane",
        kind: "pane",
        mode: key,
        measure: key,
        formula: formulaRecord !== null ? formula : null,
        basis: formulaRecord !== null ? formulaRecord.basisKind : null,
        unit: formulaRecord !== null ? formulaRecord.unit : axis !== null ? axis.unit : null,
        transform: "axis",
        desc: null,
        mappingId,
        state: axisState === "none" ? "no-calibration" : axisState === "zero-only" ? "zero-only" : "ok",
        policy: axis !== null ? axis.policy : null,
        origin: "axis",
        external: false,
        reason: null,
        calibration: null,
        lut,
        barRole: axis === null || axis.typed === "none" ? "outline" : axisSigned ? "signed" : "unsigned",
        level: null,
        contextKey: axisId,
        observation: spec.observation !== undefined ? spec.observation : null,
        model: spec.model !== undefined ? spec.model : null,
        composite: null,
        axis,
        apply: (value, out) => {
          if (plan === null) {
            // A zero-only axis: the same place and clip as the frame's encoder gives a value (see encode);
            // no data at all places nothing.
            const away = zeroOnly && value !== 0;
            out.t = away ? (value < 0 ? (axisSigned ? -1 : 0) : 1) : 0;
            out.clip = away ? (value < 0 ? 1 : 2) : 0;
            return out;
          }
          plan.apply(value, sc);
          out.t = axisSigned ? 2 * sc.t - 1 : sc.t;
          out.clip = sc.clip;
          return out;
        },
      };
    }

    return Object.freeze({
      kind: "pane",
      mode: key,
      level: null,
      bounds: null,
      mappingId,
      mappingState: axisState,
      encode,
      readout,
      fingerprint: () => fingerprint,
      legendInput,
    });
  }

  // == the event and known-at table (PRD-0002 #47 section 6) ==
  // One row for each annotation the chart draws from source bars or from the calendar: where the event sits on the time axis, from when it is known,
  // and how to read it. Known-at is STRUCTURAL: the end of the source bar that completes the condition (or the calendar, reopen, anchor or cutoff
  // instant the row names), never the moment a read arrived. A bar still forming at the data edge (live: the latest one so far; replay: the bar at
  // the edge, up to it) can satisfy a condition only as a CANDIDATE: the record says so, has no known-at and reads "so far" until the bar completes.
  // The formulas are the page's and are not touched here: these functions only place the instants its calculations found. Times are numbers in one
  // unit of the caller's choosing (the page: base columns; a readout: milliseconds); they are ordered and compared, never converted.
  const rdoEvRows = [
    ["swing", "Confirmed swing", "The extreme's supported bar or time", "The end of the bar that confirmed the reversal; the lead-in to it is retrospective"],
    ["equalSwings", "Equal swing pair", "The two extremes", "The later swing's confirmation"],
    ["rsiDivergence", "RSI divergence", "The compared swings' locations", "The later swing's confirmation; the RSI extrema were known earlier and do not date it"],
    ["cross", "Moving-average or MACD crossing", "The crossing bar's end", "That complete bar's end; a crossing seen on a bar still forming is a candidate, labelled so far, not confirmed"],
    ["squeeze", "Bollinger squeeze", "The interval of the qualifying bars", "Each bar's available close, final at the bar's completion; a fill drawn from the preceding point is keyed as retrospective interpolation"],
    ["cmeGap", "CME spot gap", "The reopen and the spot prices at the boundaries", "The gap at the reopen, given the available closes; its fill no earlier than the end of the source bar that establishes the crossing"],
    ["period", "Period POC and value area", "The stated period's span", "A retrospective summary as of its measurement cutoff, not known when the period started"],
    ["untested", "Untested level", "The original POC's period", "A status as of the current or replay edge; a later test cannot rewrite an earlier replay status"],
    ["continuation", "Historical continuation range", "The anchor and the horizon", "An empirical sample summary available at the anchor under the existing sample rules, not a forecast later observed"],
    ["clock", "Clock", "The scheduled calendar time", "A calendar definition, not a measured trade event"],
  ];
  const rdoEvTable = Object.freeze(rdoEvRows.map(([kind, name, location, knownAt]) => Object.freeze({ kind, name, location, knownAt })));
  const rdoEvByKind = Object.freeze(Object.fromEntries(rdoEvTable.map((r) => [r.kind, r])));
  // The source a record was computed from: its granularity in words, the bar that completes the condition and whether it had completed at the edge.
  function rdoEvSource(granularity, bar, edge) {
    return Object.freeze({
      granularity: granularity === undefined ? null : granularity,
      barStart: bar === null ? null : bar[0],
      barEnd: bar === null ? null : bar[1],
      through: edge,
      complete: bar === null ? true : bar[1] <= edge,
    });
  }
  // A record: the row's name, the instants, the known-at (null while a candidate or for a calendar definition) and the flags a readout shows.
  // `final`: nothing later can change it; `candidate`: it exists only on a bar still forming; `retrospective`: what is drawn reaches back before it
  // was known; `measured`: false for the clock, which is a definition and not an event of the trades.
  function rdoEvRecord(kind, fields) {
    const base = { v: 1, kind, name: rdoEvByKind[kind].name, retrospective: false, measured: true };
    return Object.freeze(Object.assign(base, fields));
  }
  // A swing: {extreme: [start, end] of its supported bar, confirm: [start, end] of the bar that reversed from it, edge, granularity}. The bar that
  // reversed is the one that confirms it; while that bar is still forming at the edge the swing is a candidate. null before that bar began.
  function rdoEvSwing(o) {
    const c = o.confirm;
    if (!(o.edge > c[0])) return null;
    const complete = c[1] <= o.edge;
    return rdoEvRecord("swing", {
      eventStart: o.extreme[0],
      eventEnd: o.extreme[1],
      knownAt: complete ? c[1] : null,
      final: complete,
      candidate: !complete,
      retrospective: true,
      leadIn: Object.freeze([o.extreme[0], complete ? c[1] : o.edge]),
      label: complete ? "confirmed" : "so far",
      reason: complete
        ? "Confirmed at the end of the bar that reversed from it; the line from the extreme to there is retrospective"
        : "The reversal is seen on a bar still forming: a candidate, not confirmed until that bar ends",
      source: rdoEvSource(o.granularity, c, o.edge),
    });
  }
  // Two swings (their records) and what compares them: known at the LATER swing's confirmation, a candidate while either is one.
  function rdoEvLater(kind, a, b, words) {
    const later = b.eventStart >= a.eventStart ? b : a;
    const known = a.knownAt !== null && b.knownAt !== null;
    return rdoEvRecord(kind, {
      eventStart: Math.min(a.eventStart, b.eventStart),
      eventEnd: Math.max(a.eventEnd, b.eventEnd),
      knownAt: known ? later.knownAt : null,
      final: known,
      candidate: !known,
      label: known ? "confirmed" : "so far",
      reason: known ? words.known : words.candidate,
      source: later.source,
    });
  }
  // Two equal swings of one kind (records of rdoEvSwing).
  function rdoEvEqual(a, b) {
    return rdoEvLater("equalSwings", a, b, {
      known: "Known at the later swing's confirmation",
      candidate: "The later swing is a candidate on a bar still forming: the pair is not confirmed",
    });
  }
  // An RSI divergence between two swings (records of rdoEvSwing).
  function rdoEvDivergence(a, b) {
    return rdoEvLater("rsiDivergence", a, b, {
      known: "Known at the later swing's confirmation, not when the RSI's extrema occurred",
      candidate: "The later swing is a candidate on a bar still forming: the divergence is not confirmed",
    });
  }
  // A crossing of two averages: {bar: [start, end], edge, granularity}. Drawn at the bar's end (at the edge while the bar is forming).
  function rdoEvCross(o) {
    const b = o.bar;
    if (!(o.edge > b[0])) return null;
    const complete = b[1] <= o.edge;
    const at = complete ? b[1] : o.edge;
    return rdoEvRecord("cross", {
      eventStart: at,
      eventEnd: at,
      knownAt: complete ? b[1] : null,
      final: complete,
      candidate: !complete,
      label: complete ? "confirmed" : "so far",
      reason: complete ? "Known at the end of the bar on which the averages crossed" : "Seen on a bar still forming: so far, not confirmed until that bar ends",
      source: rdoEvSource(o.granularity, b, o.edge),
    });
  }
  // A squeeze: {bars: [[start, end], ...] the qualifying bars in order, after: the first bar after the run or null, edge, granularity, fillFrom:
  // where a fill drawn from the preceding point would begin, or undefined}. Each bar qualifies at its own close; the run is final once a complete
  // bar after it does not qualify. A fill that began before the first qualifying bar is retrospective interpolation and is keyed as such.
  function rdoEvSqueeze(o) {
    const bars = o.bars;
    if (bars.length === 0 || !(o.edge > bars[0][0])) return null;
    const last = bars[bars.length - 1];
    let knownAt = null;
    for (const b of bars) if (b[1] <= o.edge && (knownAt === null || b[1] > knownAt)) knownAt = b[1];
    const complete = last[1] <= o.edge;
    const closed = complete && o.after !== undefined && o.after !== null && o.after[1] <= o.edge;
    const interpolated = o.fillFrom !== undefined && o.fillFrom !== null && o.fillFrom < bars[0][0];
    return rdoEvRecord("squeeze", {
      eventStart: bars[0][0],
      eventEnd: Math.min(last[1], o.edge),
      knownAt,
      final: closed,
      candidate: !complete,
      retrospective: interpolated,
      geometry: interpolated ? "retrospective interpolation" : "qualifying bars",
      label: closed ? "final" : "so far",
      reason: closed
        ? "Each bar qualified at its own close; a later complete bar did not, so the run is final"
        : complete
          ? "Each bar qualified at its own close; the run may still continue"
          : "The last bar is still forming: its qualification is so far, not final",
      source: rdoEvSource(o.granularity, last, o.edge),
    });
  }
  // A CME spot gap: {close, reopen, reopenBar: [start, end] of the bar whose close is the spot at the reopen, fill: [start, end] of the bar that first
  // traded back through the Friday close or null, edge, granularity}. -> null before the reopen's close is in; else the gap, known at the reopen,
  // with its `fill`: null while not traded back, else known no earlier than the end of the crossing bar (a candidate while that bar is forming).
  function rdoEvGap(o) {
    const known = Math.max(o.reopen, o.reopenBar[1]);
    if (!(o.edge >= known)) return null;
    let fill = null;
    if (o.fill !== undefined && o.fill !== null && o.edge > o.fill[0]) {
      const complete = o.fill[1] <= o.edge;
      fill = Object.freeze({
        knownAt: complete ? o.fill[1] : null,
        final: complete,
        candidate: !complete,
        label: complete ? "filled" : "so far",
        reason: complete
          ? "Traded back through the Friday close: known at the end of the bar that did"
          : "The crossing is seen on a bar still forming: so far, not a fill until that bar ends",
        source: rdoEvSource(o.granularity, o.fill, o.edge),
      });
    }
    return rdoEvRecord("cmeGap", {
      eventStart: o.close,
      eventEnd: o.reopen,
      knownAt: known,
      final: true,
      candidate: false,
      label: fill === null ? "open" : fill.label,
      reason: "Known at the reopen, from the closes available then",
      fill,
      source: rdoEvSource(o.granularity, o.reopenBar, o.edge),
    });
  }
  // A period's POC or value area: {span: [start, end], cutoff}. A retrospective summary as of the cutoff it was measured at: final once the period
  // has ended by then, so far while it is still open. null before the period began.
  function rdoEvPeriod(o) {
    if (!(o.cutoff > o.span[0])) return null;
    const final = o.span[1] <= o.cutoff;
    return rdoEvRecord("period", {
      eventStart: o.span[0],
      eventEnd: o.span[1],
      knownAt: o.cutoff,
      final,
      candidate: false,
      retrospective: true,
      label: final ? "retrospective" : "so far",
      reason: final ? "A summary of the whole period, as of the cutoff it was measured at" : "The period is still open: a summary so far, as of the cutoff",
      source: rdoEvSource(o.granularity, null, o.cutoff),
    });
  }
  // An untested level: {origin: [start, end] of the POC's period, asOf}. A status as of the edge it is asked at, never rewritten by a later test
  // when the edge is earlier. null while the origin period has not ended by then.
  function rdoEvUntested(o) {
    if (!(o.asOf >= o.origin[1])) return null;
    return rdoEvRecord("untested", {
      eventStart: o.origin[0],
      eventEnd: o.origin[1],
      knownAt: o.asOf,
      final: false,
      candidate: false,
      label: "as of",
      reason: "Untested as of this edge; a later test changes the status from then on, not at this edge",
      source: rdoEvSource(o.granularity, null, o.asOf),
    });
  }
  // A historical continuation range: {anchor, horizon, samples, minSample (30), edge}. Known at the anchor, from the sample as it stood there; below
  // the sample floor its percentages and boxes are withheld (`withheld`). null before the anchor.
  function rdoEvContinuation(o) {
    if (!(o.edge >= o.anchor)) return null;
    const floor = o.minSample === undefined ? 30 : o.minSample;
    return rdoEvRecord("continuation", {
      eventStart: o.anchor,
      eventEnd: o.anchor + o.horizon,
      knownAt: o.anchor,
      final: true,
      candidate: false,
      label: "at anchor",
      samples: o.samples,
      withheld: o.samples < floor,
      reason: o.samples < floor ? `Fewer than ${floor} cases: its percentages and boxes are withheld` : "An empirical sample summary as it stood at the anchor, not a forecast",
      source: rdoEvSource(o.granularity, null, o.edge),
    });
  }
  // The clock: {scheduled}. A calendar definition: no known-at, not a measured event.
  function rdoEvClock(o) {
    return rdoEvRecord("clock", {
      eventStart: o.scheduled,
      eventEnd: o.scheduled,
      knownAt: null,
      final: true,
      candidate: false,
      measured: false,
      label: "calendar",
      reason: "A calendar definition, not a measured trade event",
      source: rdoEvSource("calendar", null, o.scheduled),
    });
  }
  // The `when` block of a readout for an interval of the measured grid (a cell, a column): the interval's instants and, when it is complete, the end of
  // it as its structural known-at; an open or cut interval has none yet.
  function rdoEvInterval(startMs, endMs, finality) {
    const done = finality === "complete";
    return {
      eventStartMs: startMs,
      eventEndMs: endMs,
      knownAtMs: done ? endMs : null,
      knownAtReason: done
        ? "the end of the interval it measures"
        : finality === "open"
          ? "the interval is still open: known at its end"
          : finality === "partial"
            ? "the interval is cut by the data's edge: known at its end once complete"
            : "the interval is not stated",
    };
  }
  // The `when` block of a Rows band: the period it summarises (from its start to what it was read to, as `info` says in base columns) and, as its
  // known-at, the measurement cutoff the summary is as of: a retrospective summary, not known when the period started. Without `info` it has none.
  function rdoEvSummary(info, observation) {
    const none = { eventStartMs: null, eventEndMs: null, knownAtMs: null, knownAtReason: "the period the rows summarise is not stated" };
    if (info === undefined || info === null || !Number.isFinite(info.fromBase) || !Number.isFinite(info.throughBase)) return none;
    const startMs = API.time.baseToMs(info.fromBase, LATTICE.T0, LATTICE.BASE);
    const endMs = API.time.baseToMs(info.throughBase, LATTICE.T0, LATTICE.BASE);
    const cutoff = observation !== undefined && observation !== null && Number.isFinite(observation.cutoffMs) ? observation.cutoffMs : null;
    return {
      eventStartMs: startMs,
      eventEndMs: endMs,
      knownAtMs: cutoff !== null && cutoff > startMs ? cutoff : null,
      knownAtReason: "a summary of the period as of the cutoff it was measured at, not known when the period started",
    };
  }
  // E.readout.events: the table, the records of each annotation and the readout's `when` for a measured interval.
  const rdoEvents = Object.freeze({
    TABLE: rdoEvTable,
    swing: rdoEvSwing,
    equalSwings: rdoEvEqual,
    rsiDivergence: rdoEvDivergence,
    cross: rdoEvCross,
    squeeze: rdoEvSqueeze,
    cmeGap: rdoEvGap,
    period: rdoEvPeriod,
    untested: rdoEvUntested,
    continuation: rdoEvContinuation,
    clock: rdoEvClock,
    interval: rdoEvInterval,
    summary: rdoEvSummary,
  });

  API.readout = Object.freeze({
    ROLE: rdoRole,
    cellsFrame: rdoCellsFrame,
    rowsFrame: rdoRowsFrame,
    paneFrame: rdoPaneFrame,
    events: rdoEvents,
  });

  // == §20-legend ==
  // @part 20-legend
  // @requires 01-util 03-result 04-text 06-ratio 08-scale 11-lut 12-role 19-readout
  // @prefix leg
  // @provides legend
  // == §20 legend: the generated legend model, its bar pixels and its marker (API.md B.11, S1-019, S1-160, DD-45, DD-90, DD-94) ==
  // A Legend is DERIVED from the frame that paints the marks: it never restates a scale. The frame's
  // `legendInput()` hands over the descriptor, the Lut, the role of the bar and the measure identity; this
  // part turns them into samples (the actual Lut read through the actual coordinate), ticks (at the true
  // transform positions, found with the frame's own plan), keys with counts, warnings with their actions,
  // a details list and the strings. So the colour a legend shows for a value is, by construction, the
  // colour the canvas draws for it (S1-019), and a tick can never sit where the encoder would not.
  //
  // Pure and JSON-safe: same input gives a byte-equal model. Numbers that are displayed are formatted by an
  // INJECTED `fmt(value, unit) -> string` (S1-011): the canonical number travels beside its text
  // (`details[i].canonical`, `ticks[i].value`), and swapping the formatter changes strings only. Strings
  // come from E.text; the few words D.11 does not list (a detail's label, "U" and "k") are the local
  // literals of `legLabels`, marked TEXT(S1), requested for 04-text in the report.
  //
  // Positions. A bar is drawn left to right over its COORDINATE: an unsigned scale runs t = 0..1 and a
  // signed one t = -1..1 with its midpoint in the middle (`p` = the position along the bar, 0..1). A bar is
  // not a function of the value axis: a value scale bends where the values sit (that is what the ticks
  // show), the colours along the bar are the Lut by index of t.

  const legSamples = 33;
  // The default formatter: deterministic, locale-free, plain. The page passes its own (compact, k/M).
  function legDefaultFmt(value, unit) {
    if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
    if (unit === "share") return String(Number((value * 100).toPrecision(4))) + "%";
    return String(Number(value.toPrecision(4)));
  }

  // The words D.11 has no key for: labels of the details list and the two symbols of a Value calibration.
  // TEXT(S1): the owner of 04-text is asked to move them there (the report lists them); English and ASCII.
  const legLabels = Object.freeze({
    measure: "Measure",
    unit: "Unit",
    mappingId: "Mapping",
    appearanceId: "Appearance",
    context: "Context",
    support: "Support",
    U: "U",
    k: "k",
    domain: "Domain",
    knotsCount: "Knots",
    cohortCount: "Cohort",
    excludedCount: "Excluded",
    calibratedOn: "Calibrated on",
    fitOrigin: "Origin",
    fitThrough: "Fitted through",
    clipExactEndpoint: "At the endpoint",
    shareMarks: "Marks outside the scale",
    shareArea: "Area outside the scale",
    warnings: "Warnings",
    obsSource: "Source",
    obsCutoff: "Cutoff",
    obsCanonical: "Canonical through",
    obsToken: "Token",
    observationNote: "Observation",
    scaleChangeCause: "Changed by",
    scaleChangeFrom: "Was",
    scaleChangeTo: "Now",
    revisionStatus: "Revision",
    modelStatus: "Model",
    modelIsoA: "ISO A",
    modelIsoB: "ISO B",
    modelBaseline: "Baseline",
    modelFitRange: "Fitted levels",
    modelHistoryStart: "History start",
    modelExtraction: "Extraction",
    modelFitTimestamp: "Fit time",
    modelUpperBound: "Eligibility upper bound",
    knots: "knots",
  });

  // ---- text ---------------------------------------------------------------------------------------------

  function legT() {
    return API.text;
  }

  function legFill(template, params) {
    return legT().fill(template, params);
  }

  // The text of a measure basis id (E.measure.FORMULAS basisKind, or the basis a cell measurement names:
  // Path says spans, usdt or perMinute) and of a unit id, by E.text. An id with no
  // string of its own reads as itself: a wrong wording is visible, a missing legend is not.
  function legBasisText(basis) {
    const t = legT();
    switch (basis) {
      case "amount":
      case "period-amount-per-row":
        return t.basis.amount;
      case "intensity":
        return t.basis.intensity;
      case "mean":
        return t.basis.mean;
      case "row-spans":
      case "spans":
        return t.basis.spans;
      case "usdt-moved":
      case "usdt":
        return t.basis.usdt;
      case "row-spans-per-min":
      case "perMinute":
        return t.basis.perMinute;
      case "share":
        return t.unit.share;
      case "log2-ratio":
      case "log2":
        return t.unit.log2;
      default:
        return typeof basis === "string" ? basis : "";
    }
  }

  function legUnitText(unit) {
    const t = legT().unit;
    switch (unit) {
      case "usdt":
        return t.usdt;
      case "trades":
        return t.trades;
      case "usdt-per-trade":
        return t.usdtPerTrade;
      case "row-spans":
        return t.rowSpans;
      case "row-spans-per-min":
        return t.rowSpansPerMinute;
      case "share":
        return t.share;
      case "log2-ratio":
        return t.log2;
      case "seconds":
        return t.seconds;
      case "usdt-per-min-per-125usdt":
        return t.usdt + " " + t.intensity;
      case "trades-per-min-per-125usdt":
        return t.trades + " " + t.intensity;
      default:
        return typeof unit === "string" ? unit : "";
    }
  }

  function legTransformText(transform) {
    const t = legT().transform;
    switch (transform) {
      case "value-log":
        return t.valueLog;
      case "value-linear":
        return t.valueLinear;
      case "rank":
        return t.rank;
      case "fixed":
        return t.fixed;
      case "axis":
        return t.value;
      default:
        return "";
    }
  }

  function legPolicyText(input) {
    const t = legT().policy;
    if (input.channel === "pane") {
      if (input.policy === "auto") return t.axisAuto;
      if (input.policy === "frozen") return t.axisFrozen;
      if (input.policy === "fixed") return t.fixed;
      return "";
    }
    if (input.origin === "manual") return t.manual;
    switch (input.policy) {
      case "explore":
        return t.explore;
      case "comparison":
        return t.comparison;
      case "auto":
        return t.auto;
      case "local":
        return t.local;
      case "fixed":
        return t.fixed;
      default:
        return "";
    }
  }

  function legCapital(s) {
    return typeof s === "string" && s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function legShow(fmt, value, unit) {
    return String(fmt(value, unit));
  }

  // ---- bar: ramps, samples, ticks -------------------------------------------------------------------------

  function legHex(rgb) {
    return "#" + API.hash.hex(Uint8Array.from(rgb));
  }

  function legCopy(list) {
    return Array.prototype.slice.call(list);
  }

  // The colours along the bar as the model carries them (JSON-safe strings): what `samples` reads and what
  // `barPixels` blits. Four shapes: `unsigned` (one ramp), `signed` (two arms and their midpoint), `flat`
  // (one colour: the outline and a constant column bar) and `flat-signed` (the two arm colours of a signed
  // column bar). A Rows band is the COMPOSITE of its raw role over the surface at the fixed Rows alpha
  // (DD-86), which is what the legend shows; without a composite it shows the raw roles.
  function legRamps(input) {
    const lut = input.lut;
    const desc = input.desc;
    if (input.barRole === "outline" || (input.channel !== "pane" && desc === null)) return { kind: "flat", css: lut.occupancy.css };
    if (input.channel === "pane") {
      if (input.barRole === "signed") return { kind: "flat-signed", negative: lut.negative.css[255], positive: lut.positive.css[255], midpoint: lut.midpoint.css };
      return { kind: "flat", css: lut.bar.css };
    }
    if (input.barRole === "rows-projection") {
      const c = input.composite;
      if (desc.signed) {
        return {
          kind: "signed",
          negative: legCopy(c !== null && c.negative ? c.negative.css : lut.negative.css),
          positive: legCopy(c !== null && c.positive ? c.positive.css : lut.positive.css),
          midpoint: c !== null && c.midpoint ? legHex(c.midpoint) : lut.midpoint.css,
        };
      }
      return { kind: "unsigned", unsigned: legCopy(c !== null && c.css ? c.css : lut.rows.css) };
    }
    if (desc.signed) return { kind: "signed", negative: legCopy(lut.negative.css), positive: legCopy(lut.positive.css), midpoint: lut.midpoint.css };
    return { kind: "unsigned", unsigned: legCopy(lut.unsigned.css) };
  }

  // The colour at coordinate t: the Lut entry by index, the arm by sign.
  function legColourAt(ramps, t) {
    const i = API.scale.index(t);
    if (ramps.kind === "unsigned") return ramps.unsigned[i];
    if (ramps.kind === "signed") return t < 0 ? ramps.negative[i] : t > 0 ? ramps.positive[i] : ramps.midpoint;
    if (ramps.kind === "flat-signed") return t < 0 ? ramps.negative : t > 0 ? ramps.positive : ramps.midpoint;
    return ramps.css;
  }

  function legIsSigned(ramps) {
    return ramps.kind === "signed" || ramps.kind === "flat-signed";
  }

  function legSamples33(ramps) {
    const signed = legIsSigned(ramps);
    const out = [];
    for (let i = 0; i < legSamples; i++) {
      const p = i / (legSamples - 1);
      const t = signed ? 2 * p - 1 : p;
      out.push({ t, css: legColourAt(ramps, t) });
    }
    return out;
  }

  // One tick: the value, its coordinate (by the frame's own mapping, so it is where the encoder puts the
  // value), the position along the bar, its text and what it marks.
  function legTick(input, scratch, fmt, value, kind, label, extra) {
    input.apply(value, scratch);
    const signed = input.signedBar;
    const tick = { t: scratch.t, p: signed ? (scratch.t + 1) / 2 : scratch.t, value, label: label !== null ? label : legShow(fmt, value, input.unit), kind };
    if (extra !== undefined) Object.assign(tick, extra);
    return tick;
  }

  // The ticks of a bar, by kind of mapping (S1-019, S1-070): Value at 0, k and U (and their negatives);
  // a linear Value at 0, U/2, U; Rank at the knots of quarters; a fixed share at its ends and middle; the
  // log2 ratio at 1/4x .. 4x; a pane axis at its ends, its middle or its guides. A zero-only calibration has
  // only its zero.
  function legTicks(input, fmt) {
    const desc = input.desc;
    const scratch = { t: 0, clip: 0 };
    const ticks = [];
    if (input.barRole === "outline" || typeof input.apply !== "function") return ticks;
    if (input.channel === "pane") return legAxisTicks(input, fmt, scratch);
    const tick = (value, kind, label, extra) => ticks.push(legTick(input, scratch, fmt, value, kind, label, extra));
    const p = desc.params;
    switch (desc.kind) {
      case "value-log1p":
        if (desc.signed) {
          tick(-p.U, "end", null);
          if (p.k < p.U) tick(-p.k, "k", null);
          tick(0, "end", null);
          if (p.k < p.U) tick(p.k, "k", null);
          tick(p.U, "end", null);
        } else {
          tick(0, "end", null);
          if (p.k < p.U) tick(p.k, "k", null);
          tick(p.U, "end", null);
        }
        break;
      case "value-linear":
        if (desc.signed) {
          tick(-p.U, "end", null);
          tick(-p.U / 2, "mid", null);
          tick(0, "end", null);
          tick(p.U / 2, "mid", null);
          tick(p.U, "end", null);
        } else {
          tick(0, "end", null);
          tick(p.U / 2, "mid", null);
          tick(p.U, "end", null);
        }
        break;
      case "rank-type7-257": {
        // The rank axis is placed at its knots: a tick at each quarter of the cohort, carrying the knot's
        // value (the quantile) and its q, never a position invented for a value.
        for (const j of [0, 64, 128, 192, 256]) tick(p.knots[j], j === 0 || j === 256 ? "end" : "knot", null, { q: j / 256 });
        break;
      }
      case "fixed-linear":
        tick(p.lo, "end", null);
        tick((p.lo + p.hi) / 2, "mid", null);
        tick(p.hi, "end", null);
        break;
      case "fixed-diverging":
        if (input.unit === "log2-ratio") {
          for (const r of API.ratio.TICKS) tick(r.value, r.value === 0 ? "mid" : "end", r.label);
        } else {
          tick(p.lo, "end", null);
          tick(p.mid, "mid", null);
          tick(p.hi, "end", null);
        }
        break;
      case "zero-only":
        tick(0, "end", null);
        break;
      default:
        break;
    }
    return ticks;
  }

  // The ticks of a column axis (B.12): the domain's ends (and zero for a symmetric axis), the guides of an
  // oscillator (RSI 30 and 70), the five ratio ticks for a ratio axis.
  function legAxisTicks(input, fmt, scratch) {
    const axis = input.axis;
    const ticks = [];
    if (axis === null || axis.typed === "none") return ticks;
    const tick = (value, kind, label) => ticks.push(legTick(input, scratch, fmt, value, kind, label));
    if (axis.typed === "zero-only" || !Array.isArray(axis.domain)) {
      tick(0, "end", null);
      return ticks;
    }
    const lo = axis.domain[0];
    const hi = axis.domain[1];
    if (axis.sign === "ratio") {
      for (const r of API.ratio.TICKS) if (r.value >= lo && r.value <= hi) tick(r.value, r.value === 0 ? "mid" : "end", r.label);
      return ticks;
    }
    tick(lo, "end", null);
    if (axis.sign === "signed-symmetric") tick(0, "mid", null);
    const guides = Array.isArray(axis.guides) ? axis.guides : [];
    for (const g of guides) if (g > lo && g < hi) tick(g, "guide", null);
    tick(hi, "end", null);
    return ticks;
  }

  // ---- keys ---------------------------------------------------------------------------------------------

  // The keys a channel can show, in display order (ids of E.role.keyEntries). `undefined` stands for the
  // three tags that share the "Not defined" swatch and text (undefined, empty-population, no-coarser-parent):
  // their counts are added, so one key says one thing once.
  const legKeyIds = Object.freeze({
    unsigned: ["zero", "undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high", "no-calibration"],
    signed: ["undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high", "no-calibration"],
    share: ["undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    dwell: ["zero", "undefined", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    cascade: ["undefined", "waiting-for-complete-parent", "negative-infinite", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    relvol: ["negative-infinite", "no-reference", "empty-both", "outside-support", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
    geometry: ["occupied"],
    pane: ["zero-tick", "undefined", "negative-infinite", "pending", "failed", "unsupported", "invalid-input", "clip-low", "clip-high"],
  });
  const legNotDefined = Object.freeze(["undefined", "empty-population", "no-coarser-parent"]);

  function legKeyGroup(input) {
    if (input.channel === "pane") return "pane";
    if (input.channel === "rows") return input.mode === "relvol" ? "relvol" : input.desc !== null && input.desc.signed ? "signed" : "unsigned";
    if (input.mode === "geometry") return "geometry";
    if (input.mode === "cascade") return "cascade";
    if (input.mode === "dwell") return "dwell";
    if (input.mode === "flow" || input.mode === "flowtrades") return "share";
    if (input.mode === "delta") return "signed";
    return "unsigned";
  }

  function legCount(counts, id) {
    const n = counts[id];
    return typeof n === "number" && n > 0 ? n : 0;
  }

  // The keys of a legend with their counts. `counts` is keyed by key id (the caller's settled pass counts
  // the marks of each role). An id with no swatch of its own in E.role (the pane's zero tick) is built here.
  function legKeys(input, counts) {
    const ids = legKeyIds[legKeyGroup(input)];
    const summed = {};
    for (const id of ids) {
      if (id === "undefined") {
        let n = 0;
        for (const alias of legNotDefined) n += legCount(counts, alias);
        summed[id] = n;
      } else summed[id] = legCount(counts, id);
    }
    const keys = [];
    for (const id of ids) {
      if (id === "zero-tick") {
        keys.push({ id: "zero-tick", glyph: "tick", role: "state-ink", key: "key.zeroTick", label: legT().key.zeroTick, count: summed[id] });
        continue;
      }
      const entry = API.role.keyEntries([id], summed)[0];
      const k = { id: entry.id, glyph: entry.glyph, role: entry.role, key: entry.key, label: entry.label, count: entry.count };
      if (input.channel === "pane" && id === "undefined") k.glyph = "diamond";
      keys.push(k);
    }
    return keys;
  }

  // ---- state, warnings, strings ----------------------------------------------------------------------------

  function legState(input, opts) {
    if (opts.failed === true) return "failed";
    if (input.channel === "pane") {
      if (input.state === "no-calibration") return "no-calibration";
      if (opts.paused) return "paused";
      if (opts.updating === true) return "updating";
      if (input.state === "zero-only") return "zero-only";
      return input.policy === "fixed" ? "fixed" : "ok";
    }
    if (input.state === "no-calibration") return "no-calibration";
    if (input.state === "pending") return "pending";
    if (input.state === "updating" || opts.updating === true) return "updating";
    if (input.barRole === "outline") return "outline";
    if (input.desc !== null && input.desc.kind === "zero-only") return "zero-only";
    if (opts.paused) return "paused";
    return input.policy === "fixed" ? "fixed" : "ok";
  }

  function legPct(fmt, x) {
    return legShow(fmt, typeof x === "number" && Number.isFinite(x) ? x : 0, "share");
  }

  // The warnings of a legend (INTEGRATION D.18 ids). The actions are the ones DD-94 names: a main-chart
  // warning offers Fit, Auto color and "Open lens" (which changes no state); a lens warning offers Fit, Auto
  // color and Local contrast. Channel states that are warnings too (no calibration, updating, paused,
  // zero-only, an external override) carry their own text and the action that resolves them.
  function legWarnings(input, warn, fmt, opts, state) {
    const t = legT();
    const out = [];
    const lens = opts.channel === "lens";
    const actions = input.channel === "pane" ? [] : lens ? ["fit", "auto", "local"] : ["fit", "auto", "open-lens"];
    const shares = warn !== null && warn !== undefined && warn.shares ? warn.shares : null;
    if (state === "no-calibration") out.push({ id: "no-calibration", text: t.state.noCalibration, shares: null, actions: input.channel === "pane" ? [] : ["fit"] });
    if (state === "updating") out.push({ id: "updating", text: t.state.updating, shares: null, actions: [] });
    if (state === "zero-only") out.push({ id: "zero-only", text: t.state.zeroOnly, shares: null, actions: ["fit"] });
    if (opts.paused) out.push({ id: "paused", text: opts.paused === "lock" ? t.state.autoPausedLock : t.state.autoPaused, shares: null, actions: [] });
    if (input.external === true) {
      out.push({ id: "external-override", text: t.state.external, shares: null, actions: [] });
      if (opts.afterEdge === true) out.push({ id: "override-after-edge", text: t.state.externalAfterEdge, shares: null, actions: [] });
    }
    if (warn !== null && warn !== undefined && warn.rangeExceeded === true) {
      out.push({
        id: "range-exceeded",
        text: t.warn.rangeExceeded,
        detail: legFill(t.warn.rangeDetail, { marks: legPct(fmt, shares !== null ? shares.marks : 0), area: legPct(fmt, shares !== null ? shares.area : 0) }),
        shares: { marks: shares !== null && typeof shares.marks === "number" ? shares.marks : 0, area: shares !== null && typeof shares.area === "number" ? shares.area : 0 },
        actions: actions.slice(),
      });
    }
    if (warn !== null && warn !== undefined && (warn.lowDiscrimination === "low" || warn.lowDiscrimination === "high")) {
      const low = warn.lowDiscrimination === "low";
      const share = shares !== null ? (low ? shares.low : shares.high) : 0;
      out.push({
        id: "low-discrimination",
        text: t.warn.lowDisc,
        detail: legFill(low ? t.warn.lowDiscLow : t.warn.lowDiscHigh, { share: legPct(fmt, share) }),
        shares: { marks: shares !== null && typeof shares.marks === "number" ? shares.marks : 0, area: shares !== null && typeof shares.area === "number" ? shares.area : 0 },
        actions: actions.slice(),
      });
    }
    if (opts.shortExposure !== undefined && opts.shortExposure !== null && opts.shortExposure !== false) {
      const s = opts.shortExposure;
      const detail = s !== true && typeof s === "object" && s.t !== undefined && s.w !== undefined ? legFill(t.exposure.detail, { t: legPct(fmt, s.t), w: legPct(fmt, s.w) }) : null;
      out.push({ id: "short-exposure", text: t.exposure.short, detail, shares: null, actions: [] });
    }
    return out;
  }

  function legCalibrationText(input, fmt) {
    const t = legT();
    const desc = input.desc;
    if (input.channel === "pane") return "";
    if (input.state === "no-calibration" || desc === null) return input.barRole === "outline" && input.state !== "no-calibration" ? "" : t.state.noCalibration;
    const p = desc.params;
    const unit = input.unit;
    switch (desc.kind) {
      case "value-log1p":
        return legLabels.U + " " + legShow(fmt, p.U, unit) + " \u00b7 " + legLabels.k + " " + legShow(fmt, p.k, unit);
      case "value-linear":
        return legLabels.U + " " + legShow(fmt, p.U, unit);
      case "rank-type7-257":
        return t.transform.rank + " (" + p.knots.length + " " + legLabels.knots + ")";
      case "fixed-linear":
      case "fixed-diverging":
        return legShow(fmt, p.lo, unit) + " \u2013 " + legShow(fmt, p.hi, unit);
      case "zero-only":
        return t.state.zeroOnly;
      default:
        return "";
    }
  }

  // The clipping statement: what lies outside the scale, in the words of the keys (no new strings).
  function legClippingText(counts) {
    const t = legT().key;
    const parts = [];
    if (legCount(counts, "clip-low") > 0) parts.push(t.below + ": " + legCount(counts, "clip-low"));
    if (legCount(counts, "clip-high") > 0) parts.push(t.above + ": " + legCount(counts, "clip-high"));
    if (legCount(counts, "negative-infinite") > 0) parts.push(t.negInf + ": " + legCount(counts, "negative-infinite"));
    if (legCount(counts, "no-reference") > 0) parts.push(t.noRef + ": " + legCount(counts, "no-reference"));
    return parts.join(" \u00b7 ");
  }

  function legSupportText(input) {
    const rec = input.calibration;
    if (rec === null || rec === undefined || !rec.cohort) return "";
    const c = rec.cohort;
    const ex = c.excluded ? c.excluded : null;
    let excluded = 0;
    if (ex !== null) for (const key of Object.keys(ex)) if (typeof ex[key] === "number") excluded += ex[key];
    return legFill(legT().note.calibratedOn, { support: typeof c.calibratedOn === "string" ? c.calibratedOn : "", n: typeof c.n === "number" ? c.n : 0, excluded });
  }

  // The "top" of the scale as the chip shows it (the U of a Value scale, the range of a fixed one).
  function legTopText(input, fmt, ticks) {
    const desc = input.desc;
    if (input.channel === "pane") {
      const axis = input.axis;
      if (axis === null || axis.typed === "none") return legT().axis.none;
      if (axis.typed === "zero-only" || !Array.isArray(axis.domain)) return legT().axis.zero;
      const hi = legShow(fmt, axis.domain[1], input.unit);
      return axis.sign === "signed-symmetric" ? "\u00b1" + hi : hi;
    }
    if (desc === null) return "";
    const p = desc.params;
    switch (desc.kind) {
      case "value-log1p":
      case "value-linear":
        return legShow(fmt, p.U, input.unit);
      case "fixed-linear":
        return legShow(fmt, p.lo, input.unit) + "\u2013" + legShow(fmt, p.hi, input.unit);
      case "fixed-diverging":
        return input.unit === "log2-ratio" ? ticks.length > 0 ? ticks[0].label + "\u2013" + ticks[ticks.length - 1].label : "" : legShow(fmt, p.lo, input.unit) + "\u2013" + legShow(fmt, p.hi, input.unit);
      case "zero-only":
        return legShow(fmt, 0, input.unit);
      default:
        return "";
    }
  }

  // ---- details (D.18 fields) ------------------------------------------------------------------------------

  function legDetails(input, summary, warnings, counts, warn, opts, fmt) {
    const t = legT();
    const out = [];
    const add = (field, label, value, canonical) => out.push({ field, label, value: typeof value === "string" ? value : String(value), canonical: canonical === undefined ? null : canonical });
    const desc = input.desc;
    const rec = input.calibration;
    const cohort = rec !== null && rec !== undefined && rec.cohort ? rec.cohort : null;
    add("measure", legLabels.measure, summary.measure, input.measure);
    add("basis", t.ui.basis, summary.basis, input.basis);
    add("unit", legLabels.unit, summary.unit, input.unit);
    add("transform", t.ui.transform, summary.transform, input.transform);
    add("policy", t.ui.policy, summary.policy, input.policy);
    add("mappingId", legLabels.mappingId, desc !== null ? desc.id + " \u00b7 " + desc.kind : "", desc !== null ? desc.id : null);
    add("appearanceId", legLabels.appearanceId, input.lut.id, input.lut.id);
    if (typeof input.contextKey === "string") add("context", legLabels.context, input.contextKey, input.contextKey);
    if (summary.support !== "") add("support", legLabels.support, summary.support, cohort !== null && typeof cohort.calibratedOn === "string" ? cohort.calibratedOn : null);
    if (desc !== null && desc.params !== null) {
      const p = desc.params;
      if (typeof p.U === "number") add("U", legLabels.U, legShow(fmt, p.U, input.unit), p.U);
      if (typeof p.k === "number") add("k", legLabels.k, legShow(fmt, p.k, input.unit), p.k);
      if (Array.isArray(p.knots)) add("knotsCount", legLabels.knotsCount, String(p.knots.length), p.knots.length);
      if (typeof p.lo === "number" && typeof p.hi === "number") add("domain", legLabels.domain, legShow(fmt, p.lo, input.unit) + " \u2013 " + legShow(fmt, p.hi, input.unit), [p.lo, p.hi]);
    }
    if (input.channel === "pane" && input.axis !== null && Array.isArray(input.axis.domain)) {
      const d = input.axis.domain;
      add("domain", legLabels.domain, legShow(fmt, d[0], input.unit) + " \u2013 " + legShow(fmt, d[1], input.unit), d.slice());
    }
    if (cohort !== null) {
      if (typeof cohort.n === "number") add("cohortCount", legLabels.cohortCount, String(cohort.n), cohort.n);
      if (cohort.excluded) {
        let excluded = 0;
        for (const key of Object.keys(cohort.excluded)) if (typeof cohort.excluded[key] === "number") excluded += cohort.excluded[key];
        add("excludedCount", legLabels.excludedCount, String(excluded), excluded);
      }
      if (typeof cohort.calibratedOn === "string") add("calibratedOn", legLabels.calibratedOn, cohort.calibratedOn, cohort.calibratedOn);
    }
    if (input.origin !== null && input.origin !== undefined) add("fitOrigin", legLabels.fitOrigin, input.origin, input.origin);
    if (rec !== null && rec !== undefined && typeof rec.obsEndMs === "number") add("fitThrough", legLabels.fitThrough, String(rec.obsEndMs), rec.obsEndMs);
    add("clipLowFinite", t.key.below, String(legCount(counts, "clip-low")), legCount(counts, "clip-low"));
    add("clipHighFinite", t.key.above, String(legCount(counts, "clip-high")), legCount(counts, "clip-high"));
    add("clipNegInf", t.key.negInf, String(legCount(counts, "negative-infinite")), legCount(counts, "negative-infinite"));
    add("clipNoRef", t.key.noRef, String(legCount(counts, "no-reference")), legCount(counts, "no-reference"));
    const exact = legCount(counts, "exact-low") + legCount(counts, "exact-high");
    add("clipExactEndpoint", legLabels.clipExactEndpoint, String(exact), exact);
    const shares = warn !== null && warn !== undefined && warn.shares ? warn.shares : null;
    if (shares !== null) {
      add("shareMarks", legLabels.shareMarks, legPct(fmt, shares.marks), typeof shares.marks === "number" ? shares.marks : null);
      add("shareArea", legLabels.shareArea, legPct(fmt, shares.area), typeof shares.area === "number" ? shares.area : null);
    }
    const ids = [];
    for (const w of warnings) ids.push(w.id);
    add("warnings", legLabels.warnings, ids.join(", "), ids);
    const obs = input.observation;
    if (obs !== null && obs !== undefined) {
      if (typeof obs.source === "string") add("obsSource", legLabels.obsSource, obs.source, obs.source);
      if (typeof obs.cutoffMs === "number") add("obsCutoff", legLabels.obsCutoff, String(obs.cutoffMs), obs.cutoffMs);
      if (typeof obs.canonicalThroughMs === "number") add("obsCanonical", legLabels.obsCanonical, String(obs.canonicalThroughMs), obs.canonicalThroughMs);
      if (typeof obs.token === "string") add("obsToken", legLabels.obsToken, obs.token, obs.token);
      const provenance = Array.isArray(obs.provenance) ? obs.provenance.slice() : [];
      const note = obs.replay === true ? t.vintage : provenance.join(", ");
      if (note !== "") add("observationNote", legLabels.observationNote, note, provenance);
      const rev = obs.revision;
      if (rev !== undefined && rev !== null) {
        if (rev.kind === "provisional-replaced") add("revisionStatus", legLabels.revisionStatus, legFill(t.revision.replaced, { t: String(rev.throughMs) }), "provisional-replaced");
        else add("revisionStatus", legLabels.revisionStatus, t.revision.unknown, "unknown");
      } else if (opts.revisionStatus === "none") add("revisionStatus", legLabels.revisionStatus, "", "none");
    }
    if (opts.note !== undefined && opts.note !== null) {
      const causes = Array.isArray(opts.note.causes) ? opts.note.causes.slice() : [];
      add("scaleChangeCause", legLabels.scaleChangeCause, causes.map((c) => (typeof t.note.cause[c] === "string" ? t.note.cause[c] : c)).join(", "), causes);
      if (opts.note.from !== undefined) add("scaleChangeFrom", legLabels.scaleChangeFrom, typeof opts.note.from === "string" ? opts.note.from : "", opts.note.from);
      if (opts.note.to !== undefined) add("scaleChangeTo", legLabels.scaleChangeTo, typeof opts.note.to === "string" ? opts.note.to : "", opts.note.to);
    }
    if (input.external === true) add("override", t.state.external, t.state.external, "external");
    if (opts.evicted === true) add("evicted", t.note.evicted, t.note.evicted, true);
    const model = input.model;
    if (model !== null && model !== undefined && model.provenance) {
      const pv = model.provenance;
      add("modelStatus", legLabels.modelStatus, model.status === "eligible-by-bound" ? t.model.eligibleByBound : model.labels.length > 0 ? model.labels[0] : model.status, model.status);
      add("modelApplicability", t.model.applicability, t.model.applicability, pv.applicability);
      add("modelIsoA", legLabels.modelIsoA, String(pv.ISO_A), pv.ISO_A);
      add("modelIsoB", legLabels.modelIsoB, String(pv.ISO_B), pv.ISO_B);
      add("modelBaseline", legLabels.modelBaseline, legShow(fmt, pv.baseline, "log2-ratio"), pv.baseline);
      add("modelFitRange", legLabels.modelFitRange, pv.fit.nMin + " \u2013 " + pv.fit.nMax, [pv.fit.nMin, pv.fit.nMax]);
      add("modelHistoryStart", legLabels.modelHistoryStart, pv.fit.historyStart, pv.fit.historyStart);
      add("modelExtraction", legLabels.modelExtraction, pv.fit.extraction, pv.fit.extraction);
      add("modelFitTimestamp", legLabels.modelFitTimestamp, t.model.exactUnknown, pv.estimatedAt);
      add("modelUpperBound", legLabels.modelUpperBound, pv.eligibilityUpperBound, pv.eligibilityUpperBound);
    }
    return out;
  }

  // ---- E.legend.build -------------------------------------------------------------------------------------

  // E.legend.build (API.md B.11): the Legend of a frame. `frame` is a Frame (or the object its
  // `legendInput()` returns); `warn` is the WarnReport of E.warn.evaluate for this channel (or null);
  // `fmt(value, unit) -> string` formats numbers for display (absent: a plain deterministic default);
  // `opts` = { channel ("cells"|"rows"|"lens"|"pane", default: the frame's), counts (marks per key id,
  // counted in the settled pass), measureLabel, note ({causes, from, to}: a scale change), paused (false |
  // "lock" | "play"), updating, failed, afterEdge, shortExposure (true | {t, w}), evicted, revisionStatus }.
  function legBuild(frame, warn, fmt, opts) {
    const o = opts !== undefined && opts !== null ? opts : {};
    const f = typeof fmt === "function" ? fmt : legDefaultFmt;
    // A copy: build adds two derived fields to it and never changes the caller's object.
    const input = Object.assign({}, typeof frame.legendInput === "function" ? frame.legendInput() : frame);
    const w = warn !== undefined ? warn : null;
    const counts = o.counts !== undefined && o.counts !== null ? o.counts : {};
    const t = legT();
    const channel = typeof o.channel === "string" ? o.channel : input.channel;
    input.signedBar = input.barRole === "outline" ? false : input.channel === "pane" ? input.barRole === "signed" : input.desc !== null && input.desc.signed === true;
    if (typeof input.apply !== "function" && input.desc !== null) input.apply = (value, out) => API.scale.apply(input.desc, value, out);
    const ramps = legRamps(input);
    const state = legState(input, o);
    const ticks = legTicks(input, f);
    const keys = legKeys(input, counts);
    const warnings = legWarnings(input, w, f, Object.assign({}, o, { channel }), state);
    const stateToken = state === "no-calibration" ? t.state.noCalibration : state === "updating" ? t.state.updating : "";
    const summary = {
      measure: typeof o.measureLabel === "string" ? o.measureLabel : legCapital(input.measure),
      basis: legBasisText(input.basis),
      unit: legUnitText(input.unit),
      transform: legTransformText(input.transform),
      policy: legPolicyText(input),
      support: legSupportText(input),
      calibration: legCalibrationText(input, f),
      clipping: legClippingText(counts),
      scaleId: input.desc !== null ? input.desc.id : input.mappingId,
      appearance: input.lut.id,
      top: legTopText(input, f, ticks),
    };
    const noteTexts = [];
    if (o.note !== undefined && o.note !== null) {
      const causes = Array.isArray(o.note.causes) ? o.note.causes : [];
      const words = [];
      for (const c of causes) words.push(typeof t.note.cause[c] === "string" ? t.note.cause[c] : c);
      noteTexts.push(legFill(t.note.scaleChanged, { causes: words.join(", ") }));
    }
    const legend = {
      v: VERSION.legend,
      channel,
      summary,
      bar: {
        role: input.barRole,
        ramps,
        samples: legSamples33(ramps),
        ticks,
        midpoint: legIsSigned(ramps) ? 0.5 : null,
        edges: {
          low: { glyph: "tri-down", count: legCount(counts, "clip-low") },
          high: { glyph: "tri-up", count: legCount(counts, "clip-high") },
        },
      },
      keys,
      marker: null,
      warnings,
      notes: noteTexts,
      details: [],
      state,
      level: input.level === null || input.level === undefined ? null : { n: input.level.n, m: input.level.m },
      stateToken,
    };
    legend.details = legDetails(input, summary, warnings, counts, w, o, f);
    return legend;
  }

  // ---- E.legend.chip --------------------------------------------------------------------------------------

  // E.legend.chip (API.md B.11, INTEGRATION D.7): {text, state, label}. `text` is short: the top of the
  // scale, the transform and the policy ("26.8 M . Value (log) . Explore") plus AT MOST ONE state token by
  // priority: No calibration > Updating > Scale range exceeded > Low discrimination > Scale changed. A pane
  // chip reads from its axis record ("Auto axis . +-1.92 B"; No data, Updating, Auto paused). `label` is
  // the full sentence for the accessible name.
  function legChip(legend) {
    const t = legT();
    const s = legend.summary;
    const sep = " \u00b7 ";
    const ids = [];
    for (const w of legend.warnings) ids.push(w.id);
    let token = "";
    if (legend.state === "no-calibration") token = t.state.noCalibration;
    else if (legend.state === "updating") token = t.state.updating;
    else if (ids.indexOf("range-exceeded") >= 0) token = t.warn.rangeExceeded;
    else if (ids.indexOf("low-discrimination") >= 0) token = t.warn.lowDisc;
    else if (legend.notes.length > 0) token = legend.notes[0];
    let text;
    if (legend.channel === "pane") {
      if (legend.state === "no-calibration") text = t.axis.none;
      else if (legend.state === "paused") text = t.axis.paused;
      else if (legend.state === "updating") text = t.axis.updating;
      else text = [s.policy, s.top].filter((x) => x !== "").join(sep);
    } else {
      const parts = [s.top, s.transform, s.policy].filter((x) => x !== "");
      if (token !== "") parts.push(token);
      text = parts.join(sep);
    }
    const label = [t.ui.scale + ": " + s.measure, s.basis, s.unit, s.transform, s.policy, s.calibration, s.support, s.clipping, token].filter((x) => x !== "" && x !== undefined).join(", ");
    return { text, state: legend.state, label };
  }

  // E.legend.details (API.md B.11): the details list of a legend, `[{field, label, value, canonical}]`:
  // `field` is the D.18 data-field, `value` the formatted text, `canonical` the exact JSON-safe value.
  function legDetailsOf(legend) {
    return legend.details.slice();
  }

  // ---- E.legend.marker ------------------------------------------------------------------------------------

  // E.legend.marker (API.md B.11, C.16): where a readout's value sits on the bar, {t, clip, p}, or null when
  // it sits nowhere: no coordinate (a non-value, an occupancy-only mark), a bar that is an outline, a record
  // of another mapping or of another level than the legend describes (a table at a different level must not
  // draw a marker on this legend, DR-22). `t` is the record's own coordinate, so the marker equals the tick
  // the same value would get.
  function legMarker(legend, readout) {
    if (readout === null || readout === undefined || readout.coordinate === null || readout.coordinate === undefined) return null;
    if (legend.bar.role === "outline") return null;
    const r = readout.scale;
    if (r && typeof r.id === "string" && legend.summary.scaleId !== "" && r.id !== legend.summary.scaleId) return null;
    if (legend.level !== null && readout.level !== null && readout.level !== undefined) {
      if (readout.level.n !== legend.level.n || readout.level.m !== legend.level.m) return null;
    }
    const t = readout.coordinate.t;
    if (typeof t !== "number" || !Number.isFinite(t)) return null;
    return { t, clip: readout.coordinate.clip, p: legIsSigned(legend.bar.ramps) ? (t + 1) / 2 : t };
  }

  // ---- E.legend.barPixels ---------------------------------------------------------------------------------

  function legChannel(css, at) {
    return parseInt(css.slice(1 + at * 2, 3 + at * 2), 16);
  }

  // E.legend.barPixels (API.md B.11, DD-45): ONE row of `widthPx` RGBA pixels, the Lut read through the
  // coordinate exactly (no gradient, no interpolation): pixel x sits at p = x / (widthPx - 1), so the first
  // pixel is the low end and the last the high end. The page blits the row with putImageData. Pure Node, no
  // canvas: a test compares every pixel with the Lut's own bytes.
  function legBarPixels(legend, widthPx) {
    if (typeof widthPx !== "number" || !Number.isFinite(widthPx) || widthPx < 0) throw new RangeError("E.legend.barPixels: widthPx must be a non-negative number");
    const w = Math.floor(widthPx);
    const out = new Uint8ClampedArray(w * 4);
    const ramps = legend.bar.ramps;
    const signed = legIsSigned(ramps);
    for (let x = 0; x < w; x++) {
      const p = w > 1 ? x / (w - 1) : 0.5;
      const css = legColourAt(ramps, signed ? 2 * p - 1 : p);
      out[x * 4] = legChannel(css, 0);
      out[x * 4 + 1] = legChannel(css, 1);
      out[x * 4 + 2] = legChannel(css, 2);
      out[x * 4 + 3] = 255;
    }
    return out;
  }

  // ---- E.legend.keyOf -------------------------------------------------------------------------------------

  function legKeyPart(x) {
    if (x === null || x === undefined) return "";
    if (typeof x === "object") {
      if (x.n !== undefined || x.m !== undefined) return "n" + String(x.n) + "m" + String(x.m);
      if (x.t !== undefined) return String(x.t) + "," + String(x.clip);
      return JSON.stringify(x);
    }
    return String(x);
  }

  // E.legend.keyOf (API.md B.11, DD-90): the DOM-write guard. It is computed from ids ONLY, before any
  // Legend model exists, so a steady frame builds no model: explorer.js calls `build` only when this key
  // changed. Each field is length-prefixed, so no two different field lists can give the same key, and the
  // key changes if and only if one of the listed fields changes.
  function legKeyOf(f) {
    const names = ["mappingId", "appearanceId", "themeEpoch", "policy", "state", "warnStamp", "marker", "level"];
    let key = "";
    for (let i = 0; i < names.length; i++) {
      const part = legKeyPart(f[names[i]]);
      key += (i > 0 ? "|" : "") + part.length + ":" + part;
    }
    return key;
  }

  API.legend = Object.freeze({
    build: legBuild,
    chip: legChip,
    details: legDetailsOf,
    marker: legMarker,
    barPixels: legBarPixels,
    keyOf: legKeyOf,
  });

  // == §21-notice ==
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

  // == §22-codec ==
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
      check: (raw, env) => ({ lines: env.normalizeLines(Array.isArray(raw.lines) ? raw.lines : []) }),
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
    // The profile tracks (PRD-0002 S2): how the two are compared (independent is the default and is not written), and whether the tracks
    // are shown on a chart too narrow for them (the disclosure; closed is the default). Top-level fields of the view, not scale preferences.
    {
      id: "profileCmp",
      param: "pc",
      fields: ["profileCmp"],
      legacy: false,
      defaults: { profileCmp: "independent" },
      read: (text) => ({ profileCmp: text === undefined ? "independent" : text === "a" ? "absolute" : text === "s" ? "share" : "?" + text }),
      check: (raw) => ({ profileCmp: raw.profileCmp === "absolute" || raw.profileCmp === "share" ? raw.profileCmp : "independent" }),
      write: (view) => (view.profileCmp === "absolute" ? "a" : view.profileCmp === "share" ? "s" : null),
    },
    {
      id: "profileOpen",
      param: "po",
      fields: ["profileOpen"],
      legacy: false,
      defaults: { profileOpen: false },
      read: (text) => ({ profileOpen: text === undefined ? false : text === "1" ? true : "?" + text }),
      check: (raw) => ({ profileOpen: raw.profileOpen === true }),
      write: (view) => (view.profileOpen === true ? "1" : null),
    },
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
    return cdcWindowKeyDefault(q.get("w")) !== "" || ((q.get("t") || "") !== "" && (q.get("p") || "") !== "");
  }

  // classify(x) (B.15): what kind of thing is this text or stored payload?
  //   address text   vis absent + names a place -> legacy; vis=2 + a place -> v2; vis present but not 2
  //                  -> reject (reason names the version seen); no place -> bare
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
    if (q.has("vis")) {
      if (q.get("vis") !== "2") return { kind: "reject", version: q.get("vis"), reason: "the address names visual version \"" + q.get("vis") + "\"; this page reads 2" };
      return cdcHasPlace(q) ? { kind: "v2", version: 2 } : { kind: "bare", version: 2 };
    }
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

  // The text of a rank body, per descriptor OBJECT: a descriptor is immutable, its 257 knots are 2742
  // characters, and viewHash() runs several times per action, so the encoding is made once. This is the one
  // memo of the module and, like E.scale's plan cache, it is unobservable (a WeakMap keyed by the object).
  const cdcRankText = new WeakMap();

  function cdcRankBody(desc) {
    let text = cdcRankText.get(desc);
    if (text === undefined) {
      text = "q" + API.hash.f64ToB64(desc.params.knots);
      cdcRankText.set(desc, text);
    }
    return text;
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
        return idsOnly ? "q~" + desc.id : cdcRankBody(desc);
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
  // linear) or as Rank, so the settings written in the same address decide. That is a gap in the grammar of B.15 (a record would need one more letter to say it), kept as it is until the design owner rules.
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
      if (Number(parts[2]) > e.M_MAX) return { reason: "the row size is beyond this page's levels" };
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
    if (Number(parts[2]) > e.N_MAX || Number(parts[3]) > e.M_MAX) return { reason: "the level is beyond this page's levels" };
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
    if (record.channel.charAt(0) === "a") return "-";
    const ctx = record.ctx;
    if (!cdcIsObject(ctx)) return null;
    // The lens is written as the Cells context AT THE LENS LEVEL: its members are the base's, its n and m its own.
    const cells = ctx.consumer === "lens" ? ctx.base : ctx;
    if (!cdcIsObject(cells)) return null;
    const ws = cells.workspace === "live" ? "l" : cells.workspace === "replay" ? "r" : null;
    if (ws === null) return null;
    if (record.channel === "r") {
      const quality = cdcQualityToText(cells.quality);
      if (cells.consumer !== "rows" || quality === null || !cdcIsInt(cells.rowSize) || typeof cells.period !== "string") return null;
      return cells.measure + "." + cells.period.replace(/:/g, "-") + "." + cells.rowSize + "." + quality + "." + ws;
    }
    if (cells.consumer !== "cells") return null;
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
      const mismatch = desc ? cdcConsistency(desc, ctx) : null;
      if (mismatch) return { reason: mismatch };
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
    // The writer emits only [A-Za-z0-9_.:,;~!@-] inside a value (B.15): no "%", "+", "=" or "&", so an address
    // never needs escaping and never splits wrongly. A value outside that set is a caller's bug: refuse it here,
    // where it is made, instead of writing an address that reads back as something else.
    const add = (out, k, v) => {
      if (!/^[A-Za-z0-9_.:,;~!@-]*$/.test(v)) throw new TypeError("formatAddress: the value of " + k + " is not address-safe");
      out.push(k + "=" + v);
    };
    const head = [];
    if (state.window) add(head, "w", state.window);
    else {
      add(head, "t", cdcStamp(state.tA, e) + "~" + cdcStamp(state.tB, e));
      add(head, "p", cdcUsd(state.pA, e) + "~" + cdcUsd(state.pB, e));
    }
    if (state.auto === false) {
      if (cdcIsInt(state.n) && cdcIsInt(state.m) && state.n >= 0 && state.m >= 0) add(head, "r", state.n + "," + state.m);
      else dropped.push({ key: "r", reason: "a locked level needs integer n and m" });
    }
    add(head, "vis", String(VERSION.visual));
    add(head, "ap", state.appearance);
    // The settings of the table, with the three navigation keys that sit among them written in place.
    const body = [];
    for (const entry of cdcVisualKeys) {
      const value = entry.write(state, helpers);
      if (value !== null && value !== undefined) add(body, entry.param, value);
      if (entry.id === "lines") {
        // A selection or an anchor that is not finite cannot be written; the view stands and the drop is listed.
        if (Array.isArray(state.selection) && state.selection.length === 4) {
          const s = state.selection;
          if (s.every(cdcIsFinite)) add(body, "sel", cdcStamp(s[0], e) + "~" + cdcStamp(s[1], e) + "," + cdcUsd(s[2], e) + "~" + cdcUsd(s[3], e));
          else dropped.push({ key: "sel", reason: "the selection is not four finite numbers" });
        }
        if (state.anchor !== null && state.anchor !== undefined) {
          if (cdcIsFinite(state.anchor)) add(body, "at", cdcStamp(state.anchor, e));
          else dropped.push({ key: "at", reason: "the anchor is not a finite number" });
        }
        if (state.replay === true && cdcIsFinite(state.anchor)) add(body, "replay", "1");
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
    view: ["mode", "pane", "poc", "area", "untested", "rows", "period", "level", "lines", "tab", "replay", "anchor", "horizon", "evidenceKind", "barrier", "follow", "auto", "window", "viewport", "selection", "scale", "profileCmp", "profileOpen"],
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
    if (kind === "bare" || Object.keys(parsed).length === 0) throw reject("structure", "the code is empty");
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

  // The cohort of a portable record is provenance shown in the details: its tags come from enumerations and
  // its counts are integers. Returns a reason or null.
  function cdcCohortProblem(c) {
    if (c === null || c === undefined) return null;
    if (!cdcIsObject(c) || !cdcIsInt(c.n) || c.n < 0) return "the cohort needs a count n";
    for (const name of ["zeros", "nonzero"]) if (c[name] !== undefined && (!cdcIsInt(c[name]) || c[name] < 0)) return "cohort." + name + " is a count";
    if (c.kind !== undefined && ["cells", "motion", "rows", "columns", "lens"].indexOf(c.kind) < 0) return "unknown cohort kind";
    if (c.calibratedOn !== undefined && ["view", "selection", "period", "lens"].indexOf(c.calibratedOn) < 0) return "unknown cohort support";
    if (c.quality !== undefined && !/^(exact|approx-start|approx-rows:[1-9]\d*)$/.test(c.quality)) return "unknown cohort quality";
    if (c.excluded !== undefined) {
      if (cdcIsObject(c.excluded)) {
        for (const name of Object.keys(c.excluded)) if (!cdcIsInt(c.excluded[name]) || c.excluded[name] < 0) return "cohort.excluded." + name + " is a count";
      } else if (!cdcIsInt(c.excluded) || c.excluded < 0) return "cohort.excluded is a count";
    }
    if (c.level !== undefined && c.level !== null && (!cdcIsObject(c.level) || !cdcIsInt(c.level.n) || !cdcIsInt(c.level.m))) return "cohort.level is {n, m}";
    if (c.bounds !== undefined && c.bounds !== null && (!Array.isArray(c.bounds) || c.bounds.length !== 4 || !c.bounds.every(cdcIsFinite))) return "cohort.bounds is four numbers";
    if (c.obsEndBase !== undefined && !cdcIsFinite(c.obsEndBase)) return "cohort.obsEndBase is a number";
    if (c.support !== undefined && c.support !== null) {
      const pair = (x) => Array.isArray(x) && x.length === 2 && x.every(cdcIsFinite);
      if (!cdcIsObject(c.support) || (c.support.timeBase !== undefined && !pair(c.support.timeBase)) || (c.support.priceRows !== undefined && !pair(c.support.priceRows))) return "cohort.support is two base ranges";
    }
    return null;
  }

  // A descriptor and the context it is for must agree: the kind is one the context's transform can be mapped
  // with, and its signedness is the measure's (the class string of E.context says which). Returns a reason or null.
  function cdcConsistency(desc, ctx) {
    const cells = ctx.consumer === "lens" ? ctx.base : ctx;
    if (cdcTransformKinds[cells.transform].indexOf(desc.kind) < 0) return "the descriptor kind does not match the context transform";
    let klass;
    try {
      klass = API.context.compatClass({ ctx: cells, desc });
    } catch (error) {
      return "the context is not valid: " + error.message;
    }
    return (klass.split("|")[2] === "s") !== desc.signed ? "the descriptor signedness does not match the measure" : null;
  }

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
    const mismatch = cdcConsistency(r.desc, r.ctx);
    if (mismatch) return { reason: mismatch };
    const c = r.cohort;
    const cohortProblem = cdcCohortProblem(c);
    if (cohortProblem) return { reason: cohortProblem };
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
    if (view.profileCmp !== undefined && view.profileCmp !== "independent" && view.profileCmp !== "absolute" && view.profileCmp !== "share") return fail("view.profileCmp is independent, absolute or share");
    if (view.profileOpen !== undefined && typeof view.profileOpen !== "boolean") return fail("view.profileOpen is true or false");
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
        profileCmp: view.profileCmp === undefined ? "independent" : view.profileCmp,
        profileOpen: view.profileOpen === true,
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

  // == §23-indicators ==
  // @part 23-indicators
  // @requires
  // @prefix ind
  // @provides indicators
  // == §23 indicators: moving averages, Bollinger, RSI, MACD, crosses, squeezes, divergences (API.md A.3) ==
  // Moved out of explorer.js (baseline 8c82ca1 lines 6179-6337) so that Node tests import the real code
  // (DR-28). The arithmetic, the loops and the comments are the baseline's; only the top-level names
  // carry this part's prefix (the assembler's rule 2.2.2), and the baseline's one `const A = 500, B = 0.1,
  // C = 182;` chain is three statements (DR-36, a semantic no-op). Behaviour is pinned by
  // tests/fixtures/indicators-baseline/, recorded from the UNMODIFIED baseline functions.
  // Moving averages, Bollinger bands and the oscillators (live), each on the
  // closes of its own timeframe, by the standard definitions. SMA(n) is the
  // mean of the last n closes. EMA(n) has α = 2 ÷ (n + 1) and is seeded with
  // the SMA of its first n closes. RSI(14) smooths gains and losses as the
  // ATR does, by Wilder's rule. Bollinger (20, 2σ) is the SMA(20) ± 2
  // population standard deviations of the last 20 closes, and its bandwidth
  // their spread over the middle. MACD is EMA(12) − EMA(26), its signal the
  // EMA(9) of it and its histogram their difference. Each has a value from
  // its first full window on (NaN before), drawn at the end of its bar, whose
  // close it takes in.
  function indSmaOf(values, n) {
    const out = new Float64Array(values.length).fill(NaN);
    for (let i = n - 1; i < values.length; i++) {
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) s += values[k];
      out[i] = s / n;
    }
    return out;
  }
  // E.indicators.emaOf (API.md A.3): the exponential moving average of n values, seeded with the SMA of its first n (from `from`); NaN before.
  function indEmaOf(values, n, from = 0) {
    const out = new Float64Array(values.length).fill(NaN),
      a = 2 / (n + 1);
    if (values.length - from < n) return out;
    let e = 0;
    for (let k = from; k < from + n; k++) e += values[k];
    e /= n;
    out[from + n - 1] = e;
    for (let i = from + n; i < values.length; i++) out[i] = e = a * values[i] + (1 - a) * e;
    return out;
  }
  // E.indicators.rsiOf (API.md A.3): Wilder's RSI(n) of the closes, 0..100, NaN before the first full window.
  function indRsiOf(closes, n = 14) {
    const out = new Float64Array(closes.length).fill(NaN);
    if (closes.length <= n) return out;
    let up = 0,
      down = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) up += d;
      else down -= d;
    }
    up /= n;
    down /= n;
    const value = () => (down === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / down));
    out[n] = value();
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      up = ((n - 1) * up + (d > 0 ? d : 0)) / n;
      down = ((n - 1) * down + (d < 0 ? -d : 0)) / n;
      out[i] = value();
    }
    return out;
  }
  // E.indicators.bollingerOf (API.md A.3): {mid, upper, lower, width} of the SMA(n) plus and minus k population standard deviations.
  function indBollingerOf(closes, n = 20, k = 2) {
    const len = closes.length,
      nan = () => new Float64Array(len).fill(NaN),
      mid = nan(),
      upper = nan(),
      lower = nan(),
      width = nan();
    for (let i = n - 1; i < len; i++) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += closes[j];
      const m = s / n;
      let q = 0;
      for (let j = i - n + 1; j <= i; j++) q += (closes[j] - m) * (closes[j] - m);
      const sd = Math.sqrt(q / n);
      mid[i] = m;
      upper[i] = m + k * sd;
      lower[i] = m - k * sd;
      width[i] = (upper[i] - lower[i]) / m;
    }
    return { mid, upper, lower, width };
  }
  // E.indicators.macdOf (API.md A.3): {macd, signal, hist} of EMA(12) - EMA(26), its EMA(9) and their difference.
  function indMacdOf(closes) {
    const fast = indEmaOf(closes, 12),
      slow = indEmaOf(closes, 26),
      macd = new Float64Array(closes.length).fill(NaN),
      hist = new Float64Array(closes.length).fill(NaN);
    for (let i = 25; i < closes.length; i++) macd[i] = fast[i] - slow[i];
    const signal = indEmaOf(macd, 9, 25);
    for (let i = 0; i < closes.length; i++) hist[i] = macd[i] - signal[i];
    return { macd, signal, hist };
  }
  // Where one series crosses another: where their difference changes sign
  // between bars where both have a value. A touch that turns back is none.
  function indCrossesOf(a, b) {
    const out = [];
    let was = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      if (!(d > 0 || d < 0)) continue;
      const s = d > 0 ? 1 : -1;
      if (was && s !== was) out.push({ i, up: s > 0 });
      was = s;
    }
    return out;
  }
  // A 4-hour squeeze: bandwidth below its 10th percentile over the last 500
  // bars, this one included, the percentile 0.9 of the way from the 50th
  // lowest to the 51st (the order statistics' linear rule, at 0.1 × 499). A
  // daily squeeze: bandwidth at its lowest of the trailing 182 days, this one
  // included.
  const indSqueezeBars = 500;
  const indSqueezeRank = 0.1;
  const indSqueezeDays = 182;
  // E.indicators.squeezeBelow (API.md A.3): 1 where the bandwidth is below its p-th percentile of the last `size` bars (the 4-hour squeeze above).
  function indSqueezeBelow(width, size = indSqueezeBars, p = indSqueezeRank) {
    const out = new Uint8Array(width.length),
      win = [],
      at = (v) => {
        let lo = 0,
          hi = win.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (win[mid] < v) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      },
      pos = p * (size - 1),
      k = Math.floor(pos),
      f = pos - k;
    for (let i = 0; i < width.length; i++) {
      const v = width[i];
      if (!Number.isFinite(v)) continue;
      win.splice(at(v), 0, v);
      if (win.length > size) win.splice(at(width[i - size]), 1);
      if (win.length === size && v < win[k] + f * (win[k + 1] - win[k])) out[i] = 1;
    }
    return out;
  }
  // E.indicators.squeezeLowest (API.md A.3): 1 where the bandwidth is at its lowest of the trailing `size` bars (the daily squeeze above).
  function indSqueezeLowest(width, size = indSqueezeDays) {
    const out = new Uint8Array(width.length);
    for (let i = size - 1; i < width.length; i++) {
      if (!Number.isFinite(width[i - size + 1])) continue;
      let low = Infinity;
      for (let k = i - size + 1; k <= i; k++) if (width[k] < low) low = width[k];
      if (width[i] <= low) out[i] = 1;
    }
    return out;
  }
  // RSI divergences between consecutive swings of a kind on the RSI's own
  // timeframe: bearish where price made a higher high and the RSI a lower
  // one, bullish where price made a lower low and the RSI a higher one, each
  // at the swings' bars and known once the later swing is confirmed.
  function indDivergencesOf(swings, rsi) {
    const out = [],
      last = {};
    for (const s of swings) {
      const was = last[s.kind];
      last[s.kind] = s;
      if (!was) continue;
      const r0 = rsi[was.i],
        r1 = rsi[s.i];
      if (!Number.isFinite(r0) || !Number.isFinite(r1)) continue;
      if (s.kind === "high" ? s.price > was.price && r1 < r0 : s.price < was.price && r1 > r0)
        out.push({ bearish: s.kind === "high", a: was, b: s, r0, r1 });
    }
    return out;
  }

  API.indicators = Object.freeze({
    smaOf: indSmaOf,
    emaOf: indEmaOf,
    rsiOf: indRsiOf,
    bollingerOf: indBollingerOf,
    macdOf: indMacdOf,
    crossesOf: indCrossesOf,
    squeezeBelow: indSqueezeBelow,
    squeezeLowest: indSqueezeLowest,
    divergencesOf: indDivergencesOf,
  });

  // == §99-footer ==
  // @part 99-footer
  // @requires
  // @prefix ftr
  // @provides
  // == §99 footer: the frozen export ==
  return Object.freeze(API);

});
