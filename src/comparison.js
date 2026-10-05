/* Owned cell-capture comparison: arithmetic and presentation records only.
 * Source measurements are supplied by the explorer; this module never reads
 * the cube, the chart, storage or a clock. PRD-0006 D3-D6. */
(() => {
  "use strict";
  const metric = (key, label, group, kind, formula, unit, variants = null) => Object.freeze({
    key, label, group, kind, formula, unit,
    ...(variants ? { basis: true, formulas: Object.freeze({ amount: formula, intensity: variants[0] }), units: Object.freeze({ amount: unit, intensity: variants[1] }) } : {}),
  });
  const METRICS = Object.freeze([
    metric("volume", "Volume", "Activity", "nonnegative", "cells.volume.amount@1", "usdt", ["cells.volume.intensity@1", "usdt-per-min-per-125usdt"]),
    metric("trades", "Trades", "Activity", "nonnegative", "cells.trades.amount@1", "trades", ["cells.trades.intensity@1", "trades-per-min-per-125usdt"]),
    metric("size", "Mean trade size", "Activity", "nonnegative", "cells.size.mean@1", "usdt-per-trade"),
    metric("flow", "Taker-buy volume share", "Flow", "share", "cells.flow.share@1", "share"),
    metric("flowtrades", "Taker-buy trade share", "Flow", "share", "cells.flowtrades.share@1", "share"),
    metric("delta", "Net taker volume", "Flow", "signed", "cells.delta.amount@1", "usdt", ["cells.delta.intensity@1", "usdt-per-min-per-125usdt"]),
    metric("path", "Path / price span", "Movement", "nonnegative", "cells.path.spans@1", "row-spans"),
    metric("dwell", "Dwell share", "Movement", "share", "cells.dwell.share@1", "share"),
    metric("poc", "POC distance", "Price context", "distance", "comparison.poc-distance@1", "usdt"),
  ]);
  const byKey = Object.fromEntries(METRICS.map((m) => [m.key, m]));
  const finite = Number.isFinite;
  const unavailable = (tag, reason, meta = {}) => ({ tag, reason, ...meta });
  const metadata = (record) => ({ formula: record?.formula, unit: record?.unit, supportEnd: record?.supportEnd, knownThrough: record?.knownThrough });
  const visible = (record, edge) => edge == null || (finite(edge) && finite(record?.supportEnd) && finite(record?.knownThrough) && record.supportEnd <= edge && record.knownThrough <= edge);
  // Suppressed records expose no value, numerator, denominator or other source
  // payload. Structural timestamps describe support, never establish it.
  function safeRecord(record, edge) {
    if (!record) return unavailable("pending", "Not measured");
    const meta = metadata(record);
    if (!visible(record, edge)) return unavailable("hidden", "Unavailable in replay", meta);
    if (record.tag !== "finite") return unavailable(record.tag || "undefined", record.reason || String(record.tag || "Not measured"), { ...meta, ...(typeof record.denominator === "string" ? { denominator: record.denominator } : {}) });
    if (!finite(record.value)) return unavailable("failed", "Invalid measurement", meta);
    return { ...meta, tag: "finite", value: record.value, ...(record.shortExposure ? { shortExposure: true } : {}) };
  }
  function identity(capture) {
    const { instrument, level, origin, c, r, nominal } = capture || {};
    if (typeof instrument !== "string" || !instrument || !level || !nominal || !finite(origin) ||
      !Number.isInteger(level.n) || !Number.isInteger(level.m) || level.n < 0 || level.m < 0 ||
      !Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 ||
      ![nominal.t0, nominal.t1, nominal.low, nominal.high].every(finite) || nominal.t1 <= nominal.t0 || nominal.high <= nominal.low)
      throw new TypeError("Invalid cell identity");
    return JSON.stringify([instrument, level.n, level.m, origin, c, r, nominal.t0, nominal.t1, nominal.low, nominal.high]);
  }
  function selection(key, basis) {
    const pieces = key.split("."), descriptor = byKey[pieces[0]], chosen = pieces[1] || (basis === "intensity" ? "intensity" : "amount");
    if (!descriptor) return null;
    return { descriptor, chosen, storedKey: descriptor.basis ? descriptor.key + "." + chosen : descriptor.key,
      formula: descriptor.basis ? descriptor.formulas[chosen] : descriptor.formula,
      unit: descriptor.basis ? descriptor.units[chosen] : descriptor.unit };
  }
  function value(capture, key, basis = "amount", edge = null) {
    const spec = selection(key, basis);
    if (!spec) return unavailable("unsupported", "Unknown comparison metric");
    if (spec.descriptor.key === "poc") return unavailable("undefined", "Choose a POC", { formula: spec.formula, unit: spec.unit });
    const record = safeRecord(capture?.metrics?.[spec.storedKey], edge);
    if (record.tag === "finite" && (record.formula !== spec.formula || record.unit !== spec.unit))
      return unavailable("incompatible", "Incompatible measurement", { formula: spec.formula, unit: spec.unit });
    return { ...record, formula: record.formula || spec.formula, unit: record.unit || spec.unit };
  }
  function pocValue(capture, poc, edge) {
    const meta = { formula: byKey.poc.formula, unit: "usdt", supportEnd: poc?.supportEnd, knownThrough: poc?.knownThrough };
    if (!poc || !finite(poc.price)) return unavailable("undefined", "Choose a POC", meta);
    if (!visible(poc, edge)) return unavailable("hidden", "Unavailable in replay", meta);
    const low = capture?.nominal?.low, high = capture?.nominal?.high;
    if (!finite(low) || !finite(high) || high <= low) return unavailable("failed", "Invalid price band", meta);
    const distance = Math.max(low - poc.price, poc.price - high, 0);
    if (!finite(distance)) return unavailable("undefined", "Distance unavailable", meta);
    return { ...meta, tag: "finite", value: distance, relation: low <= poc.price && poc.price < high ? "Contains" : poc.price === high ? "Touches" : low > poc.price ? "Above" : "Below" };
  }
  function midpoint(a, b) {
    if (a === b) return a;
    return Math.sign(a) === Math.sign(b) ? a + (b - a) / 2 : (a + b) / 2;
  }
  function median(values) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), half = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[half] : midpoint(ordered[half - 1], ordered[half]);
  }
  function exposureArea(capture) {
    const seconds = capture?.observed?.seconds, width = capture?.observed?.width;
    const area = seconds * width;
    return finite(seconds) && seconds > 0 && finite(width) && width > 0 && finite(area) ? area : null;
  }
  function chooseBasis(captures, requested, edge) {
    const eligible = captures.filter((capture) => ["volume", "trades", "delta"].some((key) => value(capture, key, "amount", edge).tag === "finite"));
    const areas = eligible.map(exposureArea);
    const geometryDiffers = areas.length > 1 && (areas.some((area) => area === null) || areas.some((area) => area !== areas[0]));
    return { basis: requested === "intensity" ? "intensity" : requested === "amount" ? "amount" : geometryDiffers ? "intensity" : "amount", geometryDiffers };
  }
  function domainOf(descriptor, values) {
    if (values.length < 2) return null;
    if (descriptor.kind === "share") return [0, 1];
    if (descriptor.kind === "signed") {
      const bound = values.reduce((best, x) => Math.max(best, Math.abs(x)), 0);
      return [-bound, bound];
    }
    return [0, values.reduce((best, x) => Math.max(best, x), 0)];
  }
  function analyze(captures, options = {}) {
    const items = Array.isArray(captures) ? captures : [], edge = options.edge ?? null;
    const resolved = chooseBasis(items, options.basis || "auto", edge), metrics = {};
    for (const descriptor of METRICS) {
      const records = items.map((capture) => ({ capture, record: descriptor.key === "poc" ? pocValue(capture, options.poc, edge) : value(capture, descriptor.key, resolved.basis, edge) }));
      const eligible = records.filter(({ record }) => record.tag === "finite"), values = eligible.map(({ record }) => record.value), count = values.length;
      const pinned = options.reference == null ? null : records.find(({ capture }) => capture.id === options.reference);
      const reference = options.reference == null ? median(values) : pinned?.record.tag === "finite" ? pinned.record.value : null;
      const domain = domainOf(descriptor, values), entries = {}, ranks = new Map(), allEqual = count > 1 && values.every((x) => x === values[0]);
      const ranked = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0) * (descriptor.kind === "distance" ? 1 : -1));
      for (let i = 0; i < ranked.length; i++) if (!ranks.has(ranked[i])) ranks.set(ranked[i], i + 1);
      for (const { capture, record } of records) {
        const valid = record.tag === "finite", singleton = valid && count === 1;
        const rawDifference = valid && reference !== null && !singleton ? record.value - reference : null;
        const difference = rawDifference === null ? null : descriptor.kind === "share" ? rawDifference * 100 : rawDifference;
        const percent = rawDifference !== null && ["volume", "trades", "size"].includes(descriptor.key) && reference > 0 ? rawDifference / reference * 100 : null;
        entries[capture.id] = {
          value: valid ? record.value : null, tag: record.tag, reason: valid ? reference === null ? "Reference unavailable" : singleton ? "Only comparable cell" : null : record.reason,
          formula: record.formula, unit: record.unit,
          difference: finite(difference) ? difference : null, percent: finite(percent) ? percent : null,
          rank: valid && !singleton ? ranks.get(record.value) : null,
          count, domain: valid ? domain : null, allEqual, reference,
          ...(rawDifference !== null && !finite(difference) ? { differenceReason: "Difference unavailable" } : {}),
          ...(percent !== null && !finite(percent) ? { percentReason: "Percentage unavailable" } : {}),
          ...(record.relation ? { relation: record.relation } : {}),
        };
      }
      metrics[descriptor.key] = entries;
    }
    // Fixed intensity is a named sort even when the active comparison basis
    // is Amount. Cache its gated values with the statistics, so resorting never
    // consults current capture/source data or reruns cohort arithmetic.
    metrics["volume.intensity"] = resolved.basis === "intensity" ? metrics.volume : Object.fromEntries(items.map((capture) => {
      const record = value(capture, "volume.intensity", "intensity", edge);
      return [capture.id, { tag: record.tag, value: record.tag === "finite" ? record.value : null, reason: record.reason || null }];
    }));
    return { ...resolved, ordered: sort(items, options.sort, metrics), metrics };
  }
  function sort(captures, requested = {}, metrics = {}) {
    const items = Array.isArray(captures) ? captures : [];
    const rawKey = requested?.key || "time", key = rawKey === "added" ? "order" : rawKey === "intensity" || rawKey === "volumeIntensity" ? "volume.intensity" : rawKey;
    const direction = requested?.direction;
    const factor = direction === "asc" || direction === 1 ? 1 : direction === "desc" || direction === -1 ? -1 : key === "time" || key === "order" || key === "poc" ? 1 : -1;
    const indexed = items.map((capture, index) => {
      const entry = metrics[key]?.[capture.id];
      const number = key === "order" ? index : key === "time" ? capture.nominal?.t0 : entry?.tag === "finite" ? entry.value : null;
      return { capture, index, number: finite(number) ? number : null };
    });
    indexed.sort((a, b) => a.number === null || b.number === null ? a.number === b.number ? a.index - b.index : a.number === null ? 1 : -1 : (a.number < b.number ? -1 : a.number > b.number ? 1 : 0) * factor || a.index - b.index);
    return indexed.map((item) => item.capture);
  }
  const iso = (x) => finite(x) && !Number.isNaN(new Date(x).getTime()) ? new Date(x).toISOString() : "Unknown";
  const numberText = (x) => String(x);
  const rangeText = (bounds) => bounds ? `${iso(bounds.t0)}–${iso(bounds.t1)} UTC; ${numberText(bounds.low)}–${numberText(bounds.high)} USDT` : "Unknown";
  function captureText(capture, { edge = null, poc = null } = {}) {
    const lines = [String(capture.instrument), `Cell: ${rangeText(capture.nominal)}`, `Level: ${capture.level?.n},${capture.level?.m}`, `Observed: ${rangeText(capture.observed)}`];
    const row = (label, record) => lines.push(`${label}: ${record.tag === "finite" ? numberText(record.value) + (record.unit ? " " + record.unit : "") : record.reason || record.tag}`);
    for (const descriptor of METRICS) {
      if (descriptor.key === "poc") row(descriptor.label, pocValue(capture, poc, edge));
      else {
        row(descriptor.label, value(capture, descriptor.key, "amount", edge));
        if (descriptor.basis) row(descriptor.label + " intensity", value(capture, descriptor.key, "intensity", edge));
      }
    }
    for (const detail of capture.detail || []) {
      if (!visible(detail, edge)) { lines.push(`${detail.label}: Unavailable in replay`); continue; }
      const payload = detail.tag && detail.tag !== "finite" ? detail.reason || detail.tag : detail.value == null ? detail.reason || "Not measured" : String(detail.value) + (detail.unit ? " " + detail.unit : "");
      lines.push(`${detail.label}: ${payload}`);
    }
    if (capture.completeness) lines.push(`Completeness: ${typeof capture.completeness === "string" ? capture.completeness : capture.completeness.label || capture.completeness.state || "Unknown"}`);
    if (capture.shortExposure) lines.push("Exposure: Short exposure");
    if (capture.originalScale) lines.push(`Original chart scale: ${capture.originalScale}; not a comparison scale`);
    if (capture.when) lines.push(`Structural whole-cell known at: ${finite(capture.when.knownAtMs) ? iso(capture.when.knownAtMs) : capture.when.knownAtReason || "Unknown"}`);
    const source = capture.source;
    const sourceText = source && typeof source === "object" ? Object.entries(source).filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean").map(([k, v]) => `${k}=${v}`).join("; ") : source;
    lines.push(`Source: ${sourceText || "Unknown"}`, `Captured at: ${iso(capture.capturedAt)}`, `Measured through: ${iso(capture.measuredThrough)}`);
    if (poc) lines.push(`POC reference: ${visible(poc, edge) ? `${poc.label || poc.period || "POC"}; ${finite(poc.price) ? numberText(poc.price) + " USDT" : "Unavailable"}; measured through ${iso(poc.knownThrough)}` : "Unavailable in replay"}`);
    return lines.join("\n");
  }
  const api = Object.freeze({ METRICS, identity, value, analyze, sort, captureText });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.explorerComparison = api;
})();
