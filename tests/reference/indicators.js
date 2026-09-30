"use strict";
// tests/reference/indicators.js (PRD-0002 S2, #47 section 6): the moving averages, MACD, Bollinger width, crossings and squeezes of a list of closes,
// written from the definitions in docs/data-and-semantics.md and not from the page's code.
//
//   SMA(n): the mean of the last n closes, from the n-th bar.
//   EMA(n): alpha = 2 / (n + 1), seeded with the SMA of its first n closes; then alpha x the close + (1 - alpha) x the EMA before.
//   MACD: EMA(12) - EMA(26) from the 26th bar; its signal the EMA(9) of MACD seeded with the mean of its first nine values.
//   A cross: where the difference of two series changes sign between bars where both have a value; a difference of exactly 0 carries the sign before it.
//   Bollinger (20, 2 sigma): SMA(20) +- 2 population standard deviations of the last 20 closes; the bandwidth is (upper - lower) / middle.
//   A 4-hour squeeze: the bandwidth below its 10th percentile over the last 500 bars, this one included, the percentile taken 0.9 of the way from the
//   50th lowest of them to the 51st (0.1 x 499 = 49.9 between order statistics numbered from 0).
const NaNs = (n) => new Array(n).fill(NaN);

function sma(closes, n) {
  const out = NaNs(closes.length);
  for (let i = n - 1; i < closes.length; i++) {
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += closes[k];
    out[i] = sum / n;
  }
  return out;
}

// `first`: the index of the series' first value (values before it are not numbers).
function ema(values, n, first = 0) {
  const out = NaNs(values.length),
    alpha = 2 / (n + 1),
    seedAt = first + n - 1;
  if (values.length <= seedAt) return out;
  let sum = 0;
  for (let k = first; k <= seedAt; k++) sum += values[k];
  out[seedAt] = sum / n;
  for (let i = seedAt + 1; i < values.length; i++) out[i] = alpha * values[i] + (1 - alpha) * out[i - 1];
  return out;
}

function macd(closes) {
  const fast = ema(closes, 12),
    slow = ema(closes, 26),
    line = NaNs(closes.length);
  for (let i = 25; i < closes.length; i++) line[i] = fast[i] - slow[i];
  return { macd: line, signal: ema(line, 9, 25) };
}

function crosses(a, b) {
  const out = [];
  let was = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    if (!(d > 0 || d < 0)) continue;
    const sign = d > 0 ? 1 : -1;
    if (was !== 0 && sign !== was) out.push({ i, up: sign > 0 });
    was = sign;
  }
  return out;
}

function bandwidth(closes, n = 20, k = 2) {
  const out = NaNs(closes.length);
  for (let i = n - 1; i < closes.length; i++) {
    const w = closes.slice(i - n + 1, i + 1),
      mean = w.reduce((a, b) => a + b, 0) / n,
      sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    out[i] = (2 * k * sd) / mean;
  }
  return out;
}

function squeezeBelow(width, size = 500, rank = 0.1) {
  const out = new Array(width.length).fill(0);
  for (let i = 0; i < width.length; i++) {
    if (!Number.isFinite(width[i])) continue;
    const window = [];
    for (let k = Math.max(0, i - size + 1); k <= i; k++) if (Number.isFinite(width[k])) window.push(width[k]);
    if (window.length < size) continue;
    window.sort((x, y) => x - y);
    const at = rank * (size - 1),
      low = Math.floor(at),
      threshold = window[low] + (at - low) * (window[low + 1] - window[low]);
    if (width[i] < threshold) out[i] = 1;
  }
  return out;
}

// The runs of consecutive flagged bars as [first, last].
function runs(flags) {
  const out = [];
  flags.forEach((f, i) => {
    if (!f) return;
    if (out.length && out[out.length - 1][1] === i - 1) out[out.length - 1][1] = i;
    else out.push([i, i]);
  });
  return out;
}

module.exports = { sma, ema, macd, crosses, bandwidth, squeezeBelow, runs };
