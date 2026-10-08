// Hand-built typed snapshots for candidate-only comparison diagnostics. No application calculator
// creates the expected values. The near-cap payload stays in an off-page scalar diagnostic.
export const COMPARISON_KEY = "market-state-cube-explorer:comparison:v2:BTC/USDT";
export function comparisonFixture(count, targetBytes = 0) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Invalid capture count");
  const start = Date.parse("2026-09-23T12:00:00Z"), seconds = 56.25, width = 125;
  const captures = Array.from({ length: count }, (_, i) => {
    const end = start + (i + 1) * seconds * 1000, amount = i + 1;
    const metric = (value, formula, unit) => ({ tag: "finite", value, formula, unit, supportEnd: end, knownThrough: end, numerator: value, denominator: null });
    return {
      contextOrigin: "legacy-structural", context: {supports:{},histories:[],originatingObservation:null}, originatingObservation:null,
      id: "bench-cell-" + i, instrument: "BTC/USDT", level: { n: 0, m: 0 }, origin: start / 1000, c: i, r: 561 + i,
      nominal: { t0: end - seconds * 1000, t1: end, low: 70125 + i * width, high: 70250 + i * width },
      observed: { t0: end - seconds * 1000, t1: end, low: 70125 + i * width, high: 70250 + i * width, seconds, width },
      capturedAt: end, measuredThrough: end, source: "Independent benchmark sequence", completeness: "Complete",
      metrics: {
        "volume.amount": metric(amount, "cells.volume.amount@1", "usdt"),
        "volume.intensity": metric(amount * 60 / seconds, "cells.volume.intensity@1", "usdt-per-min-per-125usdt"),
        "trades.amount": metric(amount, "cells.trades.amount@1", "trades"),
        "trades.intensity": metric(amount * 60 / seconds, "cells.trades.intensity@1", "trades-per-min-per-125usdt"),
        size: metric(1, "cells.size.mean@1", "usdt-per-trade"), flow: metric(.75, "cells.flow.share@1", "share"),
        flowtrades: metric(.5, "cells.flowtrades.share@1", "share"),
        "delta.amount": metric(amount - 50, "cells.delta.amount@1", "usdt"),
        "delta.intensity": metric((amount - 50) * 60 / seconds, "cells.delta.intensity@1", "usdt-per-min-per-125usdt"),
        path: metric(.25, "cells.path.spans@1", "row-spans"), dwell: metric(.5, "cells.dwell.share@1", "share"),
      }, detail: [{ label: "Taker buys", value: amount * .75, unit: "usdt", tag: "finite", supportEnd: end, knownThrough: end }],
    };
  });
  const record = { comparisonVersion: 2, selectedMetric: "volume", instrument: "BTC/USDT", captures, focus: count ? captures[0].id : null, reference: null,
    basis: "auto", sort: { key: "time", direction: "asc" }, view: "grid", page: 0, poc: null, expanded: false, restoreLayout: null };
  if (targetBytes) {
    if (!count) throw new RangeError("A near-cap record needs a capture");
    const last = captures.at(-1), detail = { label: "Recorded diagnostic payload", value: "", supportEnd: last.nominal.t1, knownThrough: last.nominal.t1 };
    last.detail.push(detail);
    const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (targetBytes < bytes) throw new RangeError("Target is smaller than the capture record");
    detail.value = "x".repeat(targetBytes - bytes);
  }
  return record;
}
export function comparisonSummary(samples, budgets) {
  const keys = [...new Set(samples.map((x) => x.case + ":" + x.action))];
  return keys.map((key) => {
    const group = samples.filter((x) => x.case + ":" + x.action === key), ordered = group.map((x) => x.actionToVisibleMs).sort((a, b) => a - b);
    const p95 = ordered[Math.max(0, Math.ceil(ordered.length * .95) - 1)];
    return { case: group[0].case, action: group[0].action, samples: group.length, p95ActionToVisibleMs: p95,
      maxMounted: Math.max(...group.map((x) => x.mounted)), stats: group.map((x) => x.stats), writes: group.map((x) => x.writes),
      bytes: group.map((x) => x.bytes), meetsDeclaredBudget: p95 <= budgets.p95ActionToVisibleMs && group.every((x) => x.mounted <= budgets.maxMountedEntries) };
  });
}
