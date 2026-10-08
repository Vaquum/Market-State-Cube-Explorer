/* The captured-cell dashboard owns presentation and local focus only. Capture, comparison math,
   clipboard access, replay eligibility and session mutations belong to its caller. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerComparisonUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PAGE_SIZE = 24;
  const fallbackMetrics = [
    { key: "volume", label: "Volume", group: "Activity", unit: "USDT" },
    { key: "trades", label: "Trades", group: "Activity", unit: "trades" },
    { key: "size", label: "Mean trade size", group: "Activity", unit: "USDT/trade" },
    { key: "flow", label: "Taker-buy volume share", group: "Flow", unit: "share", share: true },
    { key: "flowtrades", label: "Taker-buy trade share", group: "Flow", unit: "share", share: true },
    { key: "delta", label: "Net taker volume", group: "Flow", unit: "USDT", signed: true },
    { key: "path", label: "Path / price span", group: "Movement", unit: "row spans" },
    { key: "dwell", label: "Dwell share", group: "Movement", unit: "share", share: true },
    { key: "poc", label: "POC distance", group: "Price context", unit: "USDT" },
  ];
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const replayVisible = (record, edge) => edge == null || (finite(edge) && finite(record?.supportEnd) && finite(record?.knownThrough) && record.supportEnd <= edge && record.knownThrough <= edge);
  const number = (value, maximumFractionDigits = 2) => finite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits })
    : "—";
  const signed = (value, digits = 2) => (value > 0 ? "+" : value < 0 ? "−" : "") + number(Math.abs(value), digits);
  function utc(value, exact = false) {
    if (!finite(value)) return "Unknown";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Unknown";
    return exact ? date.toISOString() : date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  }
  function timeRange(capture, compact = false) {
    const { t0, t1 } = capture.nominal || {};
    if (!finite(t0) || !finite(t1)) return "Time unavailable";
    const start = utc(t0, true), end = utc(t1, true);
    if (start === "Unknown" || end === "Unknown") return "Time unavailable";
    if (compact && start.slice(0, 10) === end.slice(0, 10))
      return `${start.slice(5, 10)} ${start.slice(11, 19)}–${end.slice(11, 19)} UTC`;
    return `${utc(t0)}–${utc(t1)}`;
  }
  function band(capture) {
    return `${number(capture.nominal?.low, 8)}–${number(capture.nominal?.high, 8)} USDT`;
  }
  const unitText = (unit) => ({ usdt: "USDT", "usdt-per-trade": "USDT/trade", "usdt-per-min-per-125usdt": "USDT/min per 125 USDT", "trades-per-min-per-125usdt": "trades/min per 125 USDT", "row-spans": "row spans" })[unit] || unit;
  function valueText(metric, value) {
    if (!finite(value)) return "—";
    if (metric.share || metric.unit === "share" || metric.unit === "fraction") return number(value * 100) + "%";
    return (metric.signed ? signed(value) : number(value, metric.key === "trades" && metric.unit === "trades" ? 0 : 2)) + (metric.unit ? " " + unitText(metric.unit) : "");
  }
  function deltaText(metric, entry) {
    if (!finite(entry.difference)) return entry.differenceReason || "Reference unavailable";
    const difference = metric.share || metric.unit === "share" || metric.unit === "fraction"
      ? signed(entry.difference) + " pp"
      : signed(entry.difference) + (metric.unit ? " " + unitText(metric.unit) : "");
    return difference + (finite(entry.percent) ? ` (${signed(entry.percent)}%)` : "");
  }
  function safeDetail(detail, edge) {
    if (!replayVisible(detail, edge))
      return { label: detail.label, value: "Unavailable in replay" };
    if (detail.tag && detail.tag !== "finite") return { label: detail.label, value: detail.reason || detail.tag };
    if (detail.value == null) return { label: detail.label, value: detail.reason || "Not measured" };
    return detail;
  }
  function create({ root, dispatch }) {
    if (!root || typeof dispatch !== "function") throw new TypeError("A comparison root and dispatch function are required");
    const document = root.ownerDocument;
    let state = null, options = {}, currentAnalysis = null, copyText = null;
    root.innerHTML = `
      <div class="ol-comparison-toolbar">
        <div class="ol-comparison-heading"><strong>Cell comparison</strong><span class="ol-comparison-summary"></span>
          <button type="button" class="ol-action cursor-interaction" data-comparison-action="expand" data-focus-key="expand">Expand</button>
          <button type="button" class="ol-action cursor-interaction" data-comparison-action="clear" data-focus-key="clear">Clear</button>
        </div>
        <div class="ol-comparison-controls">
          <label>Metric <select data-comparison-control="selectedMetric" data-focus-key="selectedMetric" aria-label="Selected comparison metric"></select></label>
          <label>Compare <select data-comparison-control="basis" data-focus-key="basis" aria-label="Comparison basis"><option value="auto">Auto</option><option value="amount">Amount</option><option value="intensity">Intensity</option></select></label>
          <label>Against <select data-comparison-control="reference" data-focus-key="reference" aria-label="Comparison reference"></select></label>
          <label>Sort <select data-comparison-control="sort" data-focus-key="sort" aria-label="Sort captured cells"></select></label>
          <button type="button" class="ol-action cursor-interaction" data-comparison-action="direction" data-focus-key="direction"></button>
          <label>POC <select data-comparison-control="poc" data-focus-key="poc" aria-label="Loaded period POC"></select></label>
          <div class="ol-seg" role="group" aria-label="Collection view"><button type="button" class="cursor-interaction" data-comparison-action="view" data-value="grid" data-focus-key="grid" aria-pressed="true">Cards</button><button type="button" class="cursor-interaction" data-comparison-action="view" data-value="matrix" data-focus-key="matrix" aria-pressed="false">Matrix</button></div>
        </div>
        <div class="ol-comparison-notice"><span class="ol-comparison-basis-note"></span><span class="ol-comparison-poc-note"></span></div>
        <div class="ol-comparison-storage"><span data-comparison-status role="status" aria-live="polite"></span><button type="button" class="ol-action cursor-interaction" data-comparison-action="retry" data-focus-key="retry" hidden>Retry save</button><button type="button" class="ol-action cursor-interaction" data-comparison-action="discard" data-focus-key="discard" hidden>Discard stored record</button></div>
      </div>
      <div class="ol-comparison-empty" hidden><h2>No captured cells</h2><p>Right-click a cell and choose Add to comparison. Copy and Add are also available in cell Inspect detail and the Cells table.</p><p>Kept in this tab.</p></div>
      <div class="ol-comparison-panes"><section class="ol-comparison-focus" aria-label="Focused cell"></section><section class="ol-comparison-collection" aria-label="Captured cells"><div class="ol-comparison-page"><span data-comparison-position></span><button type="button" class="ol-action cursor-interaction" data-comparison-action="page" data-value="previous" data-focus-key="previous">Previous</button><button type="button" class="ol-action cursor-interaction" data-comparison-action="page" data-value="next" data-focus-key="next">Next</button></div><div class="ol-comparison-entries"></div></section></div>
      <section class="ol-comparison-copy" role="dialog" aria-labelledby="ol-comparison-copy-title" hidden><div><strong id="ol-comparison-copy-title">Copy cell text</strong><button type="button" class="ol-action cursor-interaction" data-comparison-action="close-copy" data-focus-key="close-copy">Close</button></div><p>Clipboard access failed. Select and copy this text.</p><textarea readonly aria-label="Copyable captured cell text" data-focus-key="copy-text"></textarea></section>`;
    const q = (selector) => root.querySelector(selector);
    const setOptions = (control, entries, value) => {
      const select = q(`[data-comparison-control="${control}"]`), markup = entries.map((entry) => `<option value="${escape(entry.value)}"${entry.disabled ? ' disabled=""' : ""}>${escape(entry.label)}</option>`).join("");
      if (select.innerHTML !== markup) select.innerHTML = markup;
      select.value = value ?? "";
    };
    function metrics(analysis) {
      return Array.isArray(options.metrics) ? options.metrics : globalThis.explorerComparison?.METRICS || fallbackMetrics;
    }
    function metricEntry(analysis, metric, capture) {
      // The pure module owns all eligibility and derived numbers. An absent result is a non-value.
      const entry = analysis?.metrics?.[metric.key]?.[capture.id];
      return entry && finite(entry.value) ? entry : { ...(entry || {}), value: null, reason: entry?.reason || "Unavailable" };
    }
    function mark(metric, entry) {
      if (!finite(entry.value) || !(entry.count > 1)) return "";
      const scale = entry.domain ? { min: entry.domain[0], max: entry.domain[1], allEqual: entry.allEqual } : null;
      if (!scale || !finite(scale.min) || !finite(scale.max) || !(scale.max > scale.min) || scale.allEqual) return "";
      // Signed domains may span -MAX_VALUE..MAX_VALUE, whose subtraction overflows.
      const position = (value) => Math.max(0, Math.min(100, metric.signed
        ? (0.5 + value / scale.max / 2) * 100
        : (value - scale.min) / (scale.max - scale.min) * 100));
      const zero = position(metric.signed ? 0 : scale.min), point = position(entry.value), reference = entry.reference;
      const roleValue = metric.share ? entry.value - 0.5 : entry.value;
      const role = metric.signed || metric.share ? (roleValue > 0 ? "positive" : roleValue < 0 ? "negative" : "midpoint") : "neutral";
      return `<span class="ol-comparison-track" aria-hidden="true"><i class="ol-comparison-fill" data-role="${role}" style="left:${Math.min(zero, point)}%;width:${Math.abs(point - zero)}%"></i>${metric.signed ? `<i class="ol-comparison-zero" style="left:${zero}%"></i>` : ""}${finite(reference) ? `<i class="ol-comparison-reference" style="left:${position(reference)}%"></i>` : ""}</span>`;
    }
    function metricBlock(metric, capture, compact, analysis) {
      const entry = metricEntry(analysis, metric, capture), available = finite(entry.value);
      metric = { ...metric, unit: entry.unit || metric.unit, share: metric.share || metric.kind === "share", signed: metric.signed || metric.kind === "signed" };
      const rank = entry.count === 1 ? "Only comparable cell" : entry.count > 1 && finite(entry.rank) ? `Rank ${entry.rank} of ${entry.count}` : `${entry.count || 0} comparable`;
      return `<div class="ol-comparison-metric${metric.key === (state.selectedMetric || "volume") ? " ol-comparison-primary" : ""}" data-metric="${escape(metric.key)}" data-state="${escape(entry.tag || "undefined")}"${available ? ` data-canonical="${escape(entry.value)}"${entry.formula ? ` data-formula="${escape(entry.formula)}"` : ""}` : ""}>
        <span class="ol-comparison-label">${escape(metric.label)}</span><strong class="ol-comparison-value">${escape(available ? valueText(metric, entry.value) : entry.reason)}</strong>
        ${available ? `${entry.count === 1 ? "" : `<span class="ol-comparison-difference">${escape(deltaText(metric, entry))}</span>`}<span class="ol-comparison-rank">${escape(rank)}</span>${mark(metric, entry)}` : ""}${available && entry.relation ? `<span class="ol-comparison-rank">${escape(entry.relation)}</span>` : ""}${historyMark(capture, metric)}
      </div>`;
    }
    function historyMark(capture, metric) {
      const history = options.context?.frozenHistory(capture, metric.key, options.edge);
      if (!history) return "";
      const values = history.slots.map((slot) => slot.result.tag === "finite" ? slot.result.value : null), observed = values.filter(finite);
      if (!observed.length) return `<span class="ol-comparison-history-note">${escape(history.reason || "Captured history unavailable")}</span>`;
      const low = Math.min(...observed), high = Math.max(...observed), y = (value) => high === low ? 20 : 36 - 32 * (value - low) / (high - low);
      const points = values.map((value, i) => value === null ? "" : `<circle cx="${4 + i * 10}" cy="${y(value)}" r="2"/>`).join("");
      const label = `${metric.label} frozen history; own scale ${number(low,8)}–${number(high,8)} ${unitText(history.unit)}; ` + history.slots.map((slot) => slot.result.tag === "finite" ? number(slot.result.value,8) : slot.result.reason || slot.result.tag).join(", ");
      return `<svg class="ol-comparison-history" viewBox="0 0 120 40" width="120" height="40" role="img" aria-label="${escape(label)}" fill="currentColor">${points}</svg>`;
    }
    function compactMetrics(analysis) {
      const compact = [state.selectedMetric || "volume", "volume", "trades", "flow", "delta"];
      return [...new Set(compact)].slice(0,4).map((key) => metrics(analysis).find((metric) => metric.key === key)).filter(Boolean);
    }
    function orderedMetrics(analysis) {
      const all = metrics(analysis), selected = state.selectedMetric || "volume";
      return [...all.filter((metric) => metric.key === selected), ...all.filter((metric) => metric.key !== selected)];
    }
    function contextDetails(capture) {
      const api = options.context; if (!api) return "";
      const original = api.originating(capture, options.edge), normalized = api.normalizedPoc(capture, state.poc, options.edge);
      const originText = original.tag === "finite" ? `${number(original.value, 8)} ${unitText(original.unit)} · ${original.formula} · ${original.basis}` : original.reason;
      const pocText = normalized.tag === "finite" ? `${signed(normalized.value, 6)} daily ATR · ${normalized.relation} · ${normalized.causal}` : normalized.reason;
      const histories = orderedMetrics(currentAnalysis).map((metric) => {
        const history = api.frozenHistory(capture, metric.key, options.edge);
        const values = history.slots.map((slot) => slot.result.tag === "finite" ? slot.result.value : null), finiteValues = values.filter(finite), lo = Math.min(...finiteValues), hi = Math.max(...finiteValues);
        const lines = values.map((value, i) => value === null ? "" : `<circle cx="${4 + i * 10}" cy="${hi === lo ? 20 : 36 - 32 * (value-lo)/(hi-lo)}" r="2"/>`).join("");
        return `<div class="ol-comparison-frozen-history" data-history="${escape(metric.key)}"><strong>${escape(metric.label)} · frozen</strong>${finiteValues.length ? `<svg viewBox="0 0 120 40" width="120" height="40" role="img" aria-label="${escape(metric.label)} captured history; own scale" fill="currentColor">${lines}</svg>` : ""}<span>${escape(history.reason || `${history.formula} · ${history.unit}`)}</span><ol>${history.slots.map((slot) => `<li data-canonical="${slot.result.tag === "finite" ? escape(slot.result.value) : escape(slot.result.tag)}">${escape(slot.result.tag === "finite" ? number(slot.result.value, 8) + " " + unitText(history.unit) : slot.result.reason || slot.result.tag)}</li>`).join("")}</ol></div>`;
      }).join("");
      return `<div><dt>Original captured reading</dt><dd>${escape(originText)}</dd></div><div><dt>Signed POC distance / captured prior daily ATR</dt><dd>${escape(pocText)}</dd></div><div><dt>POC reference timing</dt><dd>${escape(normalized.tag === "hidden" ? normalized.reason : normalized.causal || "Causal timing unknown")}</dd></div><div><dt>Frozen context origin</dt><dd>${escape(capture.contextOrigin || "legacy-structural")}</dd></div></dl>${histories}<dl>`;
    }
    function captureName(capture) { return `${timeRange(capture, true)} · ${band(capture)}`; }
    function renderFocus(capture, analysis) {
      if (!capture) return "";
      const reference = state.reference === capture.id;
      const observed = capture.observed || {}, captureSource = typeof capture.source === "string" ? capture.source : capture.source?.label || capture.source?.kind || "Unknown source";
      const sourceLabel = captureSource.split(" · ").slice(0, 2).join(" · ");
      const completeness = typeof capture.completeness === "string" ? capture.completeness : capture.completeness?.label || capture.completeness?.state || "";
      const metadata = [
        { label: "Captured at", value: utc(capture.capturedAt, true) },
        { label: "Measured through", value: utc(capture.measuredThrough, true) },
        { label: "Source", value: captureSource },
        { label: "Completeness", value: completeness || "Unknown" },
        { label: "Original level", value: `n ${capture.level?.n ?? "Unknown"}, m ${capture.level?.m ?? "Unknown"}` },
        { label: "Structural whole-cell known at", value: finite(capture.when?.knownAtMs) ? utc(capture.when.knownAtMs, true) : capture.when?.knownAtReason || "Unknown" },
        { label: "Original chart scale", value: capture.originalScale || "Unknown" },
        { label: "Nominal time · half-open", value: `[${utc(capture.nominal?.t0, true)}, ${utc(capture.nominal?.t1, true)})` },
        { label: "Nominal band · half-open", value: `[${number(capture.nominal?.low, 8)}, ${number(capture.nominal?.high, 8)}) USDT` },
        { label: "Observed time", value: `${utc(observed.t0, true)}–${utc(observed.t1, true)}` },
        { label: "Observed band", value: finite(observed.low) && finite(observed.high) ? `[${number(observed.low, 8)}, ${number(observed.high, 8)}) USDT` : (finite(observed.width) ? `${number(observed.width, 8)} USDT wide` : "Unknown") },
        { label: "Observed exposure", value: `${number(observed.seconds, 8)} seconds × ${number(observed.width, 8)} USDT` },
        ...(Array.isArray(capture.detail) ? capture.detail.map((detail) => safeDetail(detail, options.edge)) : []),
      ];
      const compact = compactMetrics(analysis), selected = new Set(compact.map((metric) => metric.key));
      const blocks = compact.map((metric) => metricBlock(metric, capture, false, analysis)).join("");
      const remaining = orderedMetrics(analysis).filter((metric) => !selected.has(metric.key)).map((metric) => metricBlock(metric,capture,false,analysis)).join("");
      return `<div class="ol-comparison-focus-head"><span class="ol-comparison-eyebrow">Focused cell${reference ? " · Reference" : ""}</span><h2>${escape(timeRange(capture, true))}</h2><p class="ol-comparison-band">${escape(band(capture))}</p>${completeness ? `<p class="ol-comparison-completeness">${escape(completeness)}${capture.shortExposure ? " · Short exposure" : ""}</p>` : ""}<div class="ol-comparison-capture-stamp"><span>Captured ${escape(utc(capture.capturedAt))}</span><span>Measured through ${escape(utc(capture.measuredThrough))}</span><span>${escape(sourceLabel)}</span></div><div class="ol-comparison-focus-actions"><button type="button" class="ol-action cursor-interaction" data-comparison-action="reference" data-id="${escape(reference ? "" : capture.id)}" data-focus-key="pin">${reference ? "Use set median" : "Use as reference"}</button><button type="button" class="ol-action cursor-interaction" data-comparison-action="copy" data-id="${escape(capture.id)}" data-focus-key="copy">Copy cell</button><button type="button" class="ol-action cursor-interaction" data-comparison-action="remove" data-id="${escape(capture.id)}" data-focus-key="remove-focus">Remove</button></div></div><div class="ol-comparison-metrics">${blocks}</div><details class="ol-comparison-other"><summary>Other comparison measures</summary><div class="ol-comparison-metrics">${remaining}</div></details><details class="ol-comparison-details" ><summary data-focus-key="details">Capture details</summary><dl>${contextDetails(capture)}${metadata.map((detail) => `<div><dt>${escape(detail.label)}</dt><dd>${escape(typeof detail.value === "number" ? number(detail.value, 8) : detail.value ?? "Unavailable")}${detail.unit ? " " + escape(unitText(detail.unit)) : ""}${detail.tag ? ` <span>${escape(detail.tag)}</span>` : ""}</dd></div>`).join("")}</dl><p>Original chart scale; not a comparison scale.</p></details>`;
    }
    function renderCards(captures, analysis) {
      const cardMetrics = compactMetrics(analysis);
      return `<div class="ol-comparison-grid">${captures.map((capture) => `<article class="ol-comparison-card" data-capture-id="${escape(capture.id)}" data-focused="${capture.id === state.focus}" data-reference="${capture.id === state.reference}"><div class="ol-comparison-card-head"><button type="button" class="ol-comparison-card-focus cursor-interaction" data-comparison-action="focus" data-id="${escape(capture.id)}" data-focus-key="cell:${escape(capture.id)}"${capture.id === state.focus ? ' aria-current="true"' : ""}><span>${escape(timeRange(capture, true))}</span><strong>${escape(band(capture))}</strong>${capture.id === state.reference ? '<span class="ol-comparison-reference-label">Reference</span>' : ""}</button><button type="button" class="ol-action cursor-interaction" data-comparison-action="remove" data-id="${escape(capture.id)}" data-focus-key="remove:${escape(capture.id)}" aria-label="Remove ${escape(captureName(capture))}">Remove</button></div><div class="ol-comparison-card-metrics">${cardMetrics.map((metric) => metricBlock(metric, capture, true, analysis)).join("")}</div></article>`).join("")}</div>`;
    }
    function renderMatrix(captures, analysis) {
      return `<div class="ol-comparison-matrix-scroll"><table class="ol-comparison-matrix"><caption class="ol-sr">Captured cells with comparison metrics; focus, reference and sorting match Cards.</caption><thead><tr><th scope="col">Cell · UTC / USDT</th>${orderedMetrics(analysis).map((metric) => `<th scope="col">${escape(metric.label)}</th>`).join("")}<th scope="col">Actions</th></tr></thead><tbody>${captures.map((capture) => `<tr data-capture-id="${escape(capture.id)}" data-focused="${capture.id === state.focus}" data-reference="${capture.id === state.reference}"><th scope="row"><button type="button" class="ol-comparison-matrix-focus cursor-interaction" data-comparison-action="focus" data-id="${escape(capture.id)}" data-focus-key="cell:${escape(capture.id)}"${capture.id === state.focus ? ' aria-current="true"' : ""}><span>${escape(timeRange(capture, true))}</span><strong>${escape(band(capture))}</strong>${capture.id === state.reference ? '<span class="ol-comparison-reference-label">Reference</span>' : ""}</button></th>${orderedMetrics(analysis).map((metric) => `<td>${metricBlock(metric, capture, true, analysis)}</td>`).join("")}<td><button type="button" class="ol-action cursor-interaction" data-comparison-action="remove" data-id="${escape(capture.id)}" data-focus-key="remove:${escape(capture.id)}" aria-label="Remove ${escape(captureName(capture))}">Remove</button></td></tr>`).join("")}</tbody></table></div>`;
    }
    function render(model, analysis, nextOptions = {}) {
      if (copyText !== null && options.edge !== nextOptions.edge) clearCopyFallback();
      state = model;
      currentAnalysis = analysis;
      options = nextOptions;
      const focusedKey = root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      const focusPane = q(".ol-comparison-focus"), collectionPane = q(".ol-comparison-collection"), scroll = [focusPane.scrollTop, collectionPane.scrollTop];
      const detailsOpen = !!q(".ol-comparison-details")?.open;
      const captures = model.captures || [], byId = new Map(captures.map((capture) => [capture.id, capture]));
      const ordered = (analysis?.ordered || captures).map((entry) => typeof entry === "string" ? byId.get(entry) : entry).filter(Boolean);
      const selected = byId.get(model.focus) || ordered[0];
      const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE)), page = Math.max(0, Math.min(pages - 1, model.page || 0)), entries = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      root.dataset.view = model.view || "grid";
      root.dataset.singleton = String(captures.length === 1);
      root.dataset.empty = String(!captures.length);
      q(".ol-comparison-summary").textContent = `${captures.length} ${captures.length === 1 ? "cell" : "cells"} · Kept in this tab`;
      q('[data-comparison-action="expand"]').textContent = model.expanded ? "Restore chart" : "Expand";
      q('[data-comparison-action="expand"]').setAttribute("aria-expanded", String(!!model.expanded));
      q('[data-comparison-action="clear"]').disabled = !captures.length;
      q('[data-comparison-control="basis"]').value = model.basis || "auto";
      setOptions("selectedMetric", metrics(analysis).map((metric) => ({ value: metric.key, label: metric.label })), model.selectedMetric || "volume");
      setOptions("reference", [{ value: "", label: "Set median" }, ...captures.map((capture) => ({ value: capture.id, label: captureName(capture) }))], model.reference);
      const usedBasis = analysis?.basis || "amount", unit = usedBasis === "intensity" ? " · intensity" : " · amount";
      setOptions("sort", [{ value: "time", label: "Market time" }, { value: "added", label: "Collection order" }, { value: "volume", label: "Volume" + unit }, { value: "trades", label: "Trades" + unit }, { value: "delta", label: "Net taker volume" + unit }, { value: "intensity", label: "Volume intensity" }, { value: "size", label: "Mean trade size · USDT/trade" }, { value: "flow", label: "Taker-buy volume share · %" }, { value: "poc", label: "POC distance · USDT" }], model.sort?.key || "time");
      const direction = model.sort?.direction || (model.sort?.key === "time" || model.sort?.key === "added" || model.sort?.key === "poc" ? "asc" : "desc");
      q('[data-comparison-action="direction"]').textContent = direction === "asc" ? "Ascending ↑" : "Descending ↓";
      q('[data-comparison-action="direction"]').setAttribute("aria-label", `Sort ${direction === "asc" ? "ascending; switch to descending" : "descending; switch to ascending"}`);
      const hiddenPoc = model.poc && !replayVisible(model.poc, options.edge),
        loadedPocs = (options.pocOptions || []).filter((poc) => replayVisible(poc, options.edge) && (!hiddenPoc || poc.id !== model.poc.id));
      const pocs = [{ value: "", label: "Choose a POC" }, ...loadedPocs.map((poc) => ({ value: poc.id, label: poc.label }))];
      // The snapshot stays owned by the model; its id can embed a price, so even option values must be gated.
      if (hiddenPoc) pocs.push({ value: "unavailable-in-replay", label: "Unavailable in replay", disabled: true });
      else if (model.poc && !pocs.some((poc) => poc.value === model.poc.id)) pocs.push({ value: model.poc.id, label: model.poc.label || "Captured POC reference" });
      setOptions("poc", pocs, hiddenPoc ? "unavailable-in-replay" : model.poc?.id);
      q(".ol-comparison-basis-note").textContent = `${model.basis === "auto" || !model.basis ? "Auto → " : ""}${usedBasis === "intensity" ? "Intensity" : "Amount"}${analysis?.geometryDiffers ? " · Geometry differs" : ""}`;
      q(".ol-comparison-poc-note").textContent = hiddenPoc ? "Unavailable in replay" : !loadedPocs.length && !model.poc ? "Enable a POC in Lines first" : model.poc?.label || "";
      const status = options.status || "";
      q('[data-comparison-status]').textContent = options.unsaved && !status.startsWith("Unsaved comparison")
        ? `Unsaved comparison${status ? " · " + status : ""}` : status;
      q('[data-comparison-action="retry"]').hidden = !options.unsaved || !!options.storageRejected;
      q('[data-comparison-action="discard"]').hidden = !options.storageRejected;
      for (const button of root.querySelectorAll('[data-comparison-action="view"]')) button.setAttribute("aria-pressed", String(button.dataset.value === (model.view || "grid")));
      q(".ol-comparison-empty").hidden = !!captures.length;
      q(".ol-comparison-panes").hidden = !captures.length;
      focusPane.innerHTML = renderFocus(selected, analysis);
      q(".ol-comparison-entries").innerHTML = model.view === "matrix" ? renderMatrix(entries, analysis) : renderCards(entries, analysis);
      q(".ol-comparison-collection").hidden = captures.length === 1 && model.view !== "matrix";
      q('[data-comparison-position]').textContent = ordered.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, ordered.length)} of ${ordered.length} · Page ${page + 1} of ${pages}` : "0 cells";
      q('[data-value="previous"]').disabled = page === 0;
      q('[data-value="next"]').disabled = page === pages - 1;
      if (detailsOpen && q(".ol-comparison-details")) q(".ol-comparison-details").open = true;
      focusPane.scrollTop = scroll[0]; collectionPane.scrollTop = scroll[1];
      const active = focusedKey && Array.from(root.querySelectorAll("[data-focus-key]")).find((element) => element.dataset.focusKey === focusedKey && !element.disabled && !element.closest("[hidden]"));
      if (active && active !== document.activeElement) active.focus({ preventScroll: true });
      else if (focusedKey && !active) q('[data-comparison-action="expand"]').focus({ preventScroll: true });
    }
    function onClick(event) {
      const control = event.target.closest("[data-comparison-action]");
      if (!control || !root.contains(control) || control.disabled) return;
      const type = control.dataset.comparisonAction;
      if (type === "close-copy") { clearCopyFallback(); return; }
      if (type === "direction") dispatch({ type: "sort", key: state.sort?.key || "time", direction: state.sort?.direction === "desc" ? "asc" : "desc" });
      else if (type === "page") dispatch({ type, value: Math.max(0, (state.page || 0) + (control.dataset.value === "previous" ? -1 : 1)) });
      else if (type === "reference") dispatch({ type, id: control.dataset.id || null });
      else if (type === "view") dispatch({ type, value: control.dataset.value });
      else dispatch({ type, ...(control.dataset.id ? { id: control.dataset.id } : {}) });
    }
    function onChange(event) {
      const type = event.target.dataset.comparisonControl;
      if (type === "sort") dispatch({ type, key: event.target.value, direction: ["time", "added", "poc"].includes(event.target.value) ? "asc" : "desc" });
      else if (type === "reference" || type === "poc") dispatch({ type, id: event.target.value || null });
      else if (type) dispatch({ type, value: event.target.value });
    }
    function showCopyFallback(text) {
      copyText = String(text);
      const panel = q(".ol-comparison-copy"), textarea = panel.querySelector("textarea");
      panel.hidden = false;
      for (const surface of root.querySelectorAll(".ol-comparison-toolbar, .ol-comparison-panes, .ol-comparison-empty")) surface.inert = true;
      textarea.value = copyText;
      textarea.focus(); textarea.select();
    }
    function clearCopyFallback() {
      const panel = q(".ol-comparison-copy"), open = !panel.hidden;
      panel.hidden = true;
      panel.querySelector("textarea").value = "";
      copyText = null;
      for (const surface of root.querySelectorAll(".ol-comparison-toolbar, .ol-comparison-panes, .ol-comparison-empty")) surface.inert = false;
      if (open) (q('[data-comparison-action="copy"]') || q('[data-comparison-action="expand"]')).focus({ preventScroll: true });
      return open;
    }
    function focusControl(action = "expand") {
      const control = q(`[data-comparison-action="${action}"]`);
      if (control && !control.disabled) control.focus({ preventScroll: true });
      else root.focus({ preventScroll: true });
    }
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    return { render, showCopyFallback, clearCopyFallback, focusControl, destroy() { root.removeEventListener("click", onClick); root.removeEventListener("change", onChange); } };
  }
  return Object.freeze({ create, PAGE_SIZE });
});
