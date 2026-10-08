/* P7-S3: seasonal-state@1 / block-bootstrap@2. Pure inputs, no transport or DOM.
 * Bounded setTimeout(0) batches are visible to the existing read/draw probe.
 * Thresholds are fixed at the study anchor; intervals are approximate and pointwise.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MODEL = "seasonal-state@1", BOOTSTRAP = "block-bootstrap@2", MAX_H = 8;
  const REASONS = ["Missing coverage", "Observed empty POC population", "Missing POC", "No contiguous predecessor POC", "Ineligible seasonal support", "Unavailable fitted threshold"];
  const finite = (value) => ({ tag: "finite", value });
  const unavailable = (reason, tag = "unsupported") => ({ tag, reason });
  function quantile(values, p) {
    if (!values.length) return null;
    const at = (values.length - 1) * p, i = Math.floor(at), j = Math.ceil(at);
    return values[i] + (values[j] - values[i]) * (at - i);
  }
  function fnv(text) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash || 1;
  }
  function random(seed) {
    let value = seed >>> 0 || 1;
    return () => { value ^= value << 13; value >>>= 0; value ^= value >>> 17; value >>>= 0; value ^= value << 5; return value >>>= 0; };
  }
  const bucket = (value, pair) => value < pair[0] ? 0 : value < pair[1] ? 1 : 2;
  const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
  function summary(cases, field) {
    const values = cases.map((c) => c.delta).sort((a, b) => a - b);
    let overlapping = 0;
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i], before = cases[i - 1], after = cases[i + 1];
      if (before && before.end + 1 > c.c || after && c.end + 1 > after.c) overlapping++;
    }
    return { n: cases.length, up: cases.filter((c) => c[field] > 0).length, flat: cases.filter((c) => c[field] === 0).length, down: cases.filter((c) => c[field] < 0).length,
      q: values.length ? [.1, .25, .5, .75, .9].map((p) => quantile(values, p)) : [], overlapping };
  }
  function canonicalKey(input, result, kind, horizon) {
    const p = input.provenance, cutoff = (result.a + 1) * 2 ** result.n;
    // Actual current cutoffs are kept in provenance; seed cutoffs stop at dependencies.
    const clip = (value) => value === null || value === undefined ? null : Math.min(value, cutoff);
    return [MODEL, BOOTSTRAP, kind, p.instrument, result.n, result.m, [input.b0, input.b1, p.priceLow, p.priceHigh], cutoff, cutoff,
      [clip(p.sourceCutoff), clip(p.canonicalCutoff), clip(p.replayEdge), cutoff], p.sourceDigest,
      result.thresholds.share, result.thresholds.seasonal, result.state, result.barrier, horizon, MAX_H, result.blockLength,
      "prior-positive-volume", "prior-seasonal-eligible", p.precisionID];
  }
  async function bootstrap(input, result, kind, horizon, control = {}) {
    const alive = () => !control.cancelled?.();
    const field = kind === "poc-barrier" ? "first" : "direction", sample = summary(result.matched[horizon], field), base = summary(result.cases[horizon], field);
    const length = result.blockLength, step = 2 ** result.n, start = input.b0 / step, stop = (result.a + 1), first = Math.floor(start / length), last = Math.ceil(stop / length);
    const blocks = Array.from({ length: Math.max(0, last - first) }, (_, i) => ({ id: first + i, sample: [0, 0, 0, 0], base: [0, 0, 0, 0], full: (first + i) * length >= start && (first + i + 1) * length <= stop }));
    for (let i = 0; i < result.cases[horizon].length; i++) {
      if (i % 1024 === 0) { await yieldTask(); if (!alive()) return null; }
      const c = result.cases[horizon][i], block = blocks[Math.floor(c.c / length) - first], category = c[field] + 1;
      block.base[category]++; block.base[3]++;
      if (c.matched) { block.sample[category]++; block.sample[3]++; }
    }
    const fullMatched = blocks.filter((b) => b.full && b.sample[3] > 0).length;
    const key = canonicalKey(input, result, kind, horizon), seed = fnv(JSON.stringify(key) + BOOTSTRAP), rng = random(seed);
    const draws = Object.fromEntries(["down", "flat", "up"].map((k) => [k, { conditional: [], baseline: [], difference: [] }]));
    // A floor failure remains explicit; do not spend 2000 draws on a known unusable study.
    if (result.state && fullMatched >= 20 && blocks.length) {
      for (let r = 0; r < 2000; r++) {
        if (r % 16 === 0) { await yieldTask(); if (!alive()) return null; }
        const s = [0, 0, 0, 0], b = [0, 0, 0, 0];
        for (let j = 0; j < blocks.length; j++) {
          const chosen = blocks[Math.floor(rng() / 4294967296 * blocks.length)];
          for (let k = 0; k < 4; k++) { s[k] += chosen.sample[k]; b[k] += chosen.base[k]; }
        }
        for (const [i, name] of ["down", "flat", "up"].entries()) {
          if (s[3]) draws[name].conditional.push(100 * s[i] / s[3]);
          if (b[3]) draws[name].baseline.push(100 * b[i] / b[3]);
          if (s[3] && b[3]) draws[name].difference.push(100 * (s[i] / s[3] - b[i] / b[3]));
        }
      }
    }
    const intervals = {};
    for (const name of ["down", "flat", "up"]) {
      intervals[name] = {};
      for (const component of ["conditional", "baseline", "difference"]) {
        const values = draws[name][component].sort((a, b) => a - b), pair = values.length ? [quantile(values, .025), quantile(values, .975)] : null;
        const floor = component === "baseline" ? base.n >= 30 : component === "conditional" ? sample.n >= 30 : sample.n >= 30 && base.n >= 30;
        const reason = !result.state ? "Anchor seasonal support unavailable" : !floor ? "Fewer than 30 eligible cases" : fullMatched < 20 ? "Fewer than 20 full matched blocks" : values.length < 1800 ? "Fewer than 1800 valid resamples" : pair[0] === pair[1] ? "Degenerate resampling interval" : null;
        intervals[name][component] = { result: reason ? unavailable(reason, reason === "Degenerate resampling interval" ? "undefined" : "unsupported") : finite(pair), validDraws: values.length };
      }
    }
    return { version: BOOTSTRAP, key, seed, fullMatched, calendarBlocks: blocks.length, blockLength: length, resamples: 2000, intervals,
      qualification: "Approximate pointwise 95% intervals; fixed anchor thresholds. Longer dependence and nonstationarity may invalidate coverage." };
  }
  async function compute(input, control = {}) {
    const alive = () => !control.cancelled?.(), step = 2 ** input.n;
    if (!Number.isInteger(input.a) || input.b1 <= input.b0 || (input.b1 - input.b0) / step > 100000) throw new RangeError("Invalid bounded evidence support");
    const by = new Map(input.cols.map((c) => [c.c, c])), rows = [], shares = [], seasonalValues = [];
    const stop = input.a + 1, first = Math.ceil(input.b0 / step);
    for (let c = first; c < stop; c++) {
      if ((c - first) % 512 === 0) { await yieldTask(); if (!alive()) return null; }
      const col = by.get(c), previous = by.get(c - 1), row = { c, source: col?.source ?? null, time: [c * step, (c + 1) * step], volume: col?.v ?? null, buyShare: col?.v > 0 ? col.bv / col.v : null, poc: col?.poc ?? null, state: null, matched: false, reason: null, outcomes: {} };
      row.seasonal = input.seasonal({ numerator: col?.v ?? null, start: c * step, end: (c + 1) * step, cutoff: stop * step });
      row.reason = !col || col.covered === false ? REASONS[0] : col.v === 0 ? REASONS[1] : !Number.isFinite(col.poc) ? REASONS[2] : !previous || previous.covered === false || !(previous.v > 0) || !Number.isFinite(previous.poc) ? REASONS[3] : row.seasonal.result.tag !== "finite" ? REASONS[4] : null;
      row.result = row.reason ? unavailable(row.reason, row.reason === REASONS[1] ? "empty-population" : "unsupported") : finite(row.seasonal.result.value);
      if (c < input.a && col?.v > 0 && Number.isFinite(row.buyShare)) shares.push(row.buyShare);
      if (c < input.a && row.seasonal.result.tag === "finite") seasonalValues.push(row.seasonal.result.value);
      rows.push(row);
    }
    shares.sort((a, b) => a - b); seasonalValues.sort((a, b) => a - b);
    const st = [quantile(shares, 1 / 3), quantile(shares, 2 / 3)], vt = [quantile(seasonalValues, 1 / 3), quantile(seasonalValues, 2 / 3)], fitted = st.every(Number.isFinite) && vt.every(Number.isFinite);
    for (const row of rows) {
      if (!row.reason && !fitted) { row.reason = REASONS[5]; row.result = unavailable(row.reason); }
      if (!row.reason) row.state = [Math.sign(row.poc - by.get(row.c - 1).poc) + 1, bucket(row.buyShare, st), bucket(row.seasonal.result.value, vt)];
    }
    const anchor = rows.find((r) => r.c === input.a), state = anchor?.state ?? null;
    const cases = Array.from({ length: 9 }, () => []), matched = Array.from({ length: 9 }, () => []);
    for (let i = 0; i < rows.length; i++) {
      if (i % 512 === 0) { await yieldTask(); if (!alive()) return null; }
      const row = rows[i];
      row.matched = Boolean(state && row.state && row.state.every((v, j) => v === state[j]));
      if (!row.state) continue;
      let firstCross = 0, firstAt = null, min = 0, max = 0, gap = false;
      for (let h = 1; h <= MAX_H; h++) {
        const future = by.get(row.c + h), unfinished = row.c + h > input.a;
        if (!future || future.covered === false || !(future.v > 0) || !Number.isFinite(future.poc)) gap = true;
        const reason = unfinished ? "Unfinished horizon" : gap ? "Missing horizon coverage" : null;
        row.outcomes[h] = { reason, result: reason ? unavailable(reason, unfinished ? "pending" : "unsupported") : finite(future.poc - row.poc), knownThrough: (row.c + h + 1) * step };
        if (reason) continue;
        const delta = future.poc - row.poc;
        min = Math.min(min, delta); max = Math.max(max, delta);
        if (!firstCross && Math.abs(delta) >= input.barrier) { firstCross = Math.sign(delta); firstAt = h; }
        const c = { c: row.c, end: row.c + h, poc: row.poc, finalPoc: future.poc, delta, direction: Math.sign(delta), first: firstCross, firstAt, min, max, state: row.state, source: row.source, buyShare: row.buyShare, volume: row.volume, seasonal: row.seasonal, matched: row.matched, knownThrough: (row.c + h + 1) * step };
        cases[h].push(c); if (row.matched) matched[h].push(c);
      }
    }
    const blockLength = Math.ceil((6 * 10752 + 9 * step) / step);
    const out = { version: MODEL, a: input.a, n: input.n, m: input.m, barrier: input.barrier, from: first, poc: anchor?.poc ?? null, anchor, state,
      thresholds: { share: st, seasonal: vt }, cases, matched, match: matched.map((c) => summary(c, "direction")), all: cases.map((c) => summary(c, "direction")),
      barrierMatch: matched.map((c) => summary(c, "first")), barrierAll: cases.map((c) => summary(c, "first")), ledger: rows, blockLength, provenance: input.provenance,
      anchorReason: state ? null : anchor?.reason === REASONS[3] ? REASONS[3] : "Anchor seasonal support unavailable", fitReason: fitted ? null : REASONS[5] };
    out.uncertainty = await bootstrap(input, out, input.kind, input.horizon, control);
    return alive() ? out : null;
  }
  return Object.freeze({ MODEL, BOOTSTRAP, REASONS: Object.freeze(REASONS), quantile, fnv, random, summary, canonicalKey, bootstrap, compute });
});
