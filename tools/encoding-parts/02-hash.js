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
