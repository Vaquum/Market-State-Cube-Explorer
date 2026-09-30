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
