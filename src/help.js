/* Descriptive help is resolved only for the hovered/focused target. No data reads,
   market calculations, target registration or per-value listeners live here. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerHelp = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const controls = 'button,input:not([type="hidden"]),select,textarea,a,summary,[role="button"],[role="slider"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="tab"],[role="separator"][tabindex],tr[tabindex]';
  const values = 'output,td,dd,.ol-metric>strong,.ol-row>span:last-child,.ol-num,.ol-num>span,.ol-comparison-value,.ol-comparison-difference,.ol-comparison-rank,.ol-comparison-band,.ol-comparison-history-note,.ol-comparison-capture-stamp>span,.ol-comparison-frozen-history li[data-canonical],[data-field]:not(data),.ol-pair,.ol-venue,#ol-market,#ol-snapshot,#ol-fresh,#ol-data-through,#ol-version-unknown,#ol-prob-up,#ol-prob-flat,#ol-prob-down,#ol-base-prob-up,#ol-base-prob-flat,#ol-base-prob-down,#ol-diff-up,#ol-diff-flat,#ol-diff-down,#ol-anchor-time,#ol-pixel-state,#ol-scope,#ol-cutoff,#ol-drawing-toolbar-name,#ol-drawing-toolbar-status,#ol-inspect-position,#ol-query-mini';
  const selector = `${controls},${values},[data-hint],[title]`;
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const glossary = new Map();
  function terms(names, text) { for (const name of names.split("|")) glossary.set(normalize(name), text); }
  terms("volume|usdt volume|vol|volume amount", "Total USDT value of reported trades in this measured time and price region.");
  terms("trades|count|trade count|trades amount", "Number of reported trades in this region; trades are not orders or participants.");
  terms("buyer initiated usdt|buyvol|buy usdt|taker buys", "USDT value of trades initiated by buyers taking an existing sell offer.");
  terms("buyer initiated trades|buycount|buy trades", "Number of trades initiated by buyers taking an existing sell offer.");
  terms("buyer initiated share|buy share|flow", "Buyer-initiated USDT divided by all traded USDT in the same measured region.");
  terms("buyer initiated count share|flowtrades", "Buyer-initiated trade count divided by all reported trades in the same region.");
  terms("delta|delta value|delta amount", "Buyer-initiated minus seller-initiated USDT; positive means more buyer-initiated volume.");
  terms("mean trade size|size", "Traded USDT divided by reported trade count in the same region.");
  terms("path|path usdt|path length", "Price travel attributed to this region, in USDT; it can occur without a trade inside the region.");
  terms("path price span|path spans", "Attributed price travel divided by the price-row width, measured in row spans.");
  terms("dwell|dwell share", "Covered time spent at these prices; the share uses covered column time, not only visible rows.");
  terms("poc|poc centre|poc value|member poc centre", "Centre of the highest-volume price row in this profile; equal maxima choose the lower row.");
  terms("buy poc centre|buypoc value", "Centre of the highest buyer-initiated-volume price row in this profile.");
  terms("composite 70|va value|value area", "Contiguous price rows grown from the POC until they hold at least 70% of profile volume.");
  terms("occupied cells|cells", "Time-by-price cells with reported trades in the measured region.");
  terms("edge cells|partials", "Cells only partly inside the measured rectangle; boundary portions need exact measurement.");
  terms("zero trade cells|zero count", "Covered closed cells without reported trades; open and unread cells are excluded.");
  terms("moved through|moved", "Zero-trade cells reached by price travel or dwell, using matching measured support.");
  terms("unfinished cells|open count", "Intersecting cells in the current open time column; their values can still change.");
  terms("return|return bps", "Price change from the rally's reference price, expressed in basis points; 100 basis points is 1%.");
  terms("duration", "Elapsed time between the event's start and confirmation.");
  terms("start utc|start|analysis start|t0", "Beginning of the measured interval in UTC; time intervals include their start.");
  terms("end utc|end|analysis end|t1", "End of the measured interval in UTC; half-open intervals exclude this boundary.");
  terms("confirmed utc|confirmed|known at|known through", "When this observation is available without using information after that time.");
  terms("open usdt|open", "First supported traded price in the interval, in USDT.");
  terms("high usdt|high", "Highest supported traded price in the interval, in USDT.");
  terms("low usdt|low", "Lowest supported traded price in the interval, in USDT.");
  terms("close usdt|close", "Last supported traded price in the interval, in USDT.");
  terms("net move usdt|net move|change", "Closing price minus opening price over this interval, in USDT.");
  terms("high low usdt|high low", "Highest minus lowest supported traded price over this interval, in USDT.");
  terms("daily atr|atr", "Daily average true range: a historical price-range yardstick, not a forecast.");
  terms("auc", "How well this feature ranks marked bars above other bars; 0.5 is chance-level separation.");
  terms("90 interval", "The estimated 90% interval for the feature's separation score.");
  terms("chance", "Comparison with the same marked windows shifted in time; it does not establish out-of-sample performance.");
  terms("direction", "The direction of the observed change or fitted feature relationship.");
  terms("rank", "This value's position among comparable captured cells, using the selected comparison basis.");
  terms("difference", "Difference from the chosen comparison reference; share differences are percentage points.");
  terms("poc distance", "Nonnegative distance from the captured price band to the selected POC, in USDT; zero means it contains or touches the POC.");
  terms("rsi|rsi 14", "Wilder's 14-bar relative strength index, with 70 and 30 guides; it describes past closes.");
  terms("macd", "Difference between fast and slow exponential moving averages, with its signal and histogram.");
  terms("cascade", "Log2 of four times child volume divided by parent volume; zero is an even quarter share.");
  terms("coverage", "How much requested support has actually been measured; unavailable support is not zero.");
  terms("state|status|completeness", "Whether the requested observation is measured, pending, unavailable or still provisional.");
  terms("intensity", "Amount normalized to one minute and a 125-USDT price band, using measured exposure.");
  terms("price|price usdt|price band", "Price in USDT; a price band states the lower and upper limits of the measured row.");
  terms("time|time utc|interval utc", "The observation's UTC time or half-open time interval.");
  terms("support|observed support|measured through", "The time and price support actually measured; it can be smaller than the nominal cell.");
  terms("source|source version|source vintage", "The data source or revision used for this observation; replay does not restore an original historical vintage.");
  terms("formula", "The formula and version defining this quantity; comparison requires compatible definitions and units.");
  terms("unit", "The measurement unit of this value; compare quantities only on compatible bases.");
  terms("current axis|reference axis|domain", "The numeric range used to draw this track; independent tracks can use different ranges.");
  terms("window w", "Wholly-in-view price rows shared by the two profiles for this comparison.");
  terms("native ids", "Identifiers of the native trades defining the selected rally's membership.");
  terms("accumulated travel", "Sum of attributed price travel within the cell, in USDT; travel can exist without a trade in that cell.");
  terms("u", "Upper magnitude of the fitted colour domain; larger values are clipped to its outer colour.");
  terms("k", "Scale of the logarithmic curve; smaller values give more colour detail to small amounts.");
  terms("mapping", "Identity of the fitted colour mapping; equal values need the same mapping for equal colours.");
  terms("cohort", "Population of eligible observations used to fit this scale or estimate.");
  terms("transform", "How measured values are mapped to colour: logarithmic, linear or relative rank.");
  terms("scale policy", "When the colour domain is fitted, held or restored as the view changes.");
  terms("basis", "Whether this quantity is an amount, an exposure-normalized intensity, or a declared share or ratio.");
  terms("warnings", "Limits affecting interpretation, such as clipping or weak colour separation.");
  terms("fit time|fitted through", "When the mapping was fitted and the latest observation included in its calibration.");
  terms("cutoff|source cutoff|replay edge", "The last time available to this observation; later values are excluded.");
  terms("context|context key", "Time, price, measure and source settings that identify the measured region or calibration.");
  terms("revision|token", "Source revision identifying the data used for this read; revisions can replace provisional observations.");
  terms("excluded", "Observations omitted because their support or measurement state is not eligible for this calculation.");
  terms("appearance", "The colour palette applied after the measured value has been mapped to a scale position.");
  terms("rule", "The fitted feature condition selecting these bars; it is an in-sample observation, not a forecast.");
  terms("buyer initiated mean|buySize", "Buyer-initiated USDT divided by buyer-initiated reported trade count, in USDT per trade.");
  terms("seller initiated mean|sellSize", "Seller-initiated USDT divided by seller-initiated reported trade count, in USDT per trade.");
  terms("mean reported trade", "All traded USDT divided by all reported trades in this region.");
  terms("seller buyer mean|sizeRatio", "Seller-initiated mean trade size divided by buyer-initiated mean trade size.");
  terms("net taker imbalance|imbalance", "Buyer-initiated minus seller-initiated USDT, divided by total traded USDT in this region.");
  terms("share of all price volume same time|columnShare", "This price band's traded USDT divided by all-price traded USDT over the same measured time.");
  terms("seasonal activity all price usdt|seasonal", "All-price traded USDT relative to eligible earlier comparison windows with matching seasonal timing.");
  const valueLabels = { "window-text": "Time window", "res-text": "Cell size", tr: "Time cell duration", pr: "Price row width", "legend-text": "Cell colour scale", "rows-legend-text": "Background colour scale", "rows-text": "Rows measure and period", "background-text": "Background measure and period", "profile-chip-text": "Profile comparison", "axis-chip-text": "Column and profile axes", "data-through": "Data through" };
  const fields = {
    "window-text": "Time span currently covered by the chart; calendar windows follow their UTC dates.",
    "res-text": "Duration of one time column and width of one price row; Auto chooses the level from screen cell size.",
    "legend-text": "Cell measure, basis, transform and fitted colour domain; equal values need the same mapping for equal colours.",
    "rows-legend-text": "Background measure, period and fitted colour domain used behind the cells and in the native colour strip.",
    "rows-text": "The second vertical profile's measure and period; selections affect the first profile while Visible range follows chart time.",
    "background-text": "The backdrop and native colour strip's measure and period, independent of the second vertical profile.",
    "profile-chip-text": "The current and reference profiles, their comparison mode and numeric drawing domains.",
    "axis-chip-text": "Numeric axes and domains used to draw the Columns pane and profile tracks.",
    "hist-back": "Return to the previous view in this tab's navigation history.",
    "hist-fwd": "Return to the next view in this tab's navigation history.",
    "sheet-toggle": "Open the chart controls in the phone layout.", "sheet-close": "Close the phone controls and return to the chart.",
    "tminus": "Halve the duration of each time cell.", "tplus": "Double the duration of each time cell.",
    "pminus": "Halve the width of each price row.", "pplus": "Double the width of each price row.",
    "help": "Open the keyboard shortcuts and navigation reference.", "keys-close": "Close the keyboard shortcuts and return to the chart.",
    "back": "Move the replay boundary or active continuation anchor one column earlier.",
    "next": "Move the replay boundary or active continuation anchor one column later.",
    "play": "Start or pause replay at the selected number of columns per second.",
    "table-next": "Show the next page of measured cells.", "case-next": "Show the next page of historical cases.",
    "rally-mode": "Choose the operational definition used to discover observed upward price moves.",
    "rally-scale": "Express rally thresholds in basis points or multiples of native ATR14-SMA.",
    "rally-target": "Minimum upward move from the frozen reference price, in the selected scale.",
    "rally-pullback": "Largest permitted pullback during a controlled advance, in the selected scale.",
    "rally-reversal": "Downward reversal needed to confirm a swing rally, in the selected scale.",
    "rally-cadence": "Spacing in minutes between starting anchors for passage and controlled-advance discovery.",
    "rally-start": "UTC start of the rally discovery window; changing it affects the next discovery.",
    "rally-end": "UTC end of the rally discovery window; changing it affects the next discovery.",
    "rally-window": "Use the visible time range for discovery, capped at 24 hours.",
    "rally-discover": "Ask the native rally service to discover events using the current form settings.",
    "rally-deadline": "Show rallies that reached their target in strictly less than this many minutes; reuse the retained discovery.",
    "rally-clear": "Clear the selected rally and its member outlines without deleting the retained discovery.",
    "features-bar": "Time span of each Mill bar used to evaluate marked windows.",
    "features-mode": "Mark bars inside each selected window, or bars preceding the windows.",
    "features-lead": "Number of bars before each marked window to label as preceding it.",
    "features-against": "Choose the background bars against which marked bars are compared.",
    "features-pool": "Choose which feature factories and parameter settings Mill evaluates.",
    "features-add": "Add the current chart selection as a marked window for feature analysis.",
    "features-find": "Rank Mill features by their separation of marked bars and compare with time-shifted windows.",
    "features-copy": "Copy the selected feature's fitted rule as a Limen manifest.",
    "features-unpreview": "End the feature preview and restore the regular Columns measure.",
    "features-clear-windows": "Remove all marked feature windows from this session.",
    "reference-search": "Filter reference topics by UI names, article text, tables and Show labels.",
    "reference-topic": "Choose the System reference topic to read in the left panel.",
    "reference-back": "Return to the reference panel after locating a control or chart region.",
    "reference-prev": "Read the previous matching System reference topic.",
    "reference-next": "Read the next matching System reference topic.",
    "inspect-open-detail": "Open the detailed record of the item under the inspection cursor.",
    "inspect-detail-close": "Return from the detailed record to the inspection cursor.",
    "inspect-reference-search": "Filter the available chart references by name.",
    "inspect-reference": "Choose the reference whose values the inspector reports.",
    "drawing-name": "Name this drawing for its list entry and chart label when no separate label is supplied.",
    "drawing-label": "Optional text displayed above the line; an empty label uses the drawing's name.",
    "drawing-color": "Line and label colour, written as a six-digit hexadecimal RGB colour.",
    "drawing-color-picker": "Choose the drawing's line and label colour visually.",
    "drawing-a-time": "UTC time of the first endpoint; editing it previews the line until Apply.",
    "drawing-b-time": "UTC time of the second endpoint; editing it previews the line until Apply.",
    "drawing-a-price": "Price in USDT of the first endpoint; editing it previews the line until Apply.",
    "drawing-b-price": "Price in USDT of the second endpoint; editing it previews the line until Apply.",
    "drawing-apply": "Save the drawing's name, label, colour and endpoints together.",
    "drawing-cancel": "Discard unapplied drawing edits and close the editor.",
    "drawing-edit": "Edit the active drawing's name, label, colour and exact endpoints.",
    "drawing-more": "Open actions for creating, selecting, saving and managing drawings.",
    "bounds-start": "Set the chart's earliest visible UTC time.",
    "bounds-end": "Set the chart's latest visible UTC time.",
    "bounds-low": "Set the chart's lowest visible price in USDT.",
    "bounds-high": "Set the chart's highest visible price in USDT.",
    "replay-edge": "Set the replay cutoff in UTC; observations after this time remain hidden.",
    "query-text": "The six time, price and resolution parameters sent to the cube.",
    "query-mini": "The current time-cell duration and price-row width.",
    "copy-selection": "Copy the selected region's values and provenance as a portable capture.",
    "copy-comparison": "Copy captured comparison cells and their frozen context.",
    "share-investigation": "Create a shareable investigation containing the current view and retained captures.",
    "refresh-investigation": "Refresh captured values against the current source; retain the previous capture for restoration.",
    "previous-investigation": "Restore the captured values retained before the last source refresh.",
    "data-through": "Latest available source data, independent of the selected window and replay cutoff.",
    "market": "Whether the chart uses the live cube or its embedded recorded snapshot.",
    "snapshot": "Time of the embedded recorded snapshot used by this page.",
    "fresh": "Freshness of the latest available source observation.",
    "version-unknown": "This page has no published commit metadata to identify its build.",
    "pixel-state": "The current resolution's cell size and whether those cells can be resolved on screen.",
    "scope": "Market, venue and source scope of the displayed observations.",
    "cutoff": "Latest data boundary available to the current view or replay.",
    "prob-up": "Share of matching historical cases whose later POC is in a higher price row.",
    "prob-flat": "Share of matching historical cases whose later POC stays in the same price row.",
    "prob-down": "Share of matching historical cases whose later POC is in a lower price row.",
    "base-prob-up": "Higher-POC outcome share among all seasonally eligible historical states.",
    "base-prob-flat": "Same-row POC outcome share among all seasonally eligible historical states.",
    "base-prob-down": "Lower-POC outcome share among all seasonally eligible historical states.",
    "case-n": "Number of matching historical cases eligible for this continuation estimate.",
    "case-all": "Number of all seasonally eligible historical cases used for comparison.",
    "tr": "Duration of one time column at the selected resolution.",
    "pr": "Width of one price row at the selected resolution, in USDT.",
    "replay-at": "Current replay boundary; values after this time are excluded.",
    "poc-value": glossary.get("poc centre"), "buypoc-value": glossary.get("buy poc centre"),
    "share": glossary.get("buyer initiated share"), "va-value": glossary.get("value area"),
    "delta-value": glossary.get("delta"), "vol": glossary.get("volume"),
    "count": glossary.get("trades"), "buyvol": glossary.get("buyvol"), "buycount": glossary.get("buycount"),
  };
  const actions = {
    expand: "Use more of the workspace for captured-cell comparisons.", clear: "Remove all cells from this comparison collection; Undo can restore it.",
    undo: "Restore the collection before its last change.", export: "Download the collection and its frozen capture metadata as JSON.",
    import: "Load captured cells from a previously exported JSON collection.", reference: "Choose the captured cell or set median used as the comparison reference.",
    selectedMetric: "Choose the primary quantity displayed and ranked across captured cells.", basis: "Compare raw amounts or values normalized to common time and price exposure.",
    sort: "Choose the order of captured cells; comparisons still use the entire collection.", direction: "Reverse the current ordering of captured cells.",
    poc: "Choose a loaded period POC as the price reference for captured cells.", view: "Switch the captured-cell collection between cards and a table of measures.",
    focus: "Read this captured cell's full values and frozen context.", copy: "Copy this cell's measured values and provenance as text.",
    add: "Capture this cell's current measured values and context for comparison.", update: "Replace the matching capture with this cell's current measured values.",
    remove: "Remove this captured cell from the collection.", retry: "Try saving the current collection to this browser again.",
    discard: "Discard the rejected stored record while retaining current working cells.", page: "Show the adjacent page of captured cells; comparisons still use the whole set.",
    "close-copy": "Close the copyable cell text and return to the comparison.",
  };
  function isValue(node) { return !node.matches(controls) && node.matches(values); }
  function target(node, root) {
    if (!node?.closest || node.closest('.ol-hint,.ol-tip,.ol-sr,#ol-reference-article dd,#ol-keys dd')) return null;
    const found = node.closest(selector);
    return found && root.contains(found) && !found.matches('canvas,option,input[type="file"][hidden]') ? found : null;
  }
  function textLabel(node) {
    if (!node) return "";
    return clean(Array.from(node.childNodes).map(child => child.nodeType === 3 ? child.textContent : child.matches?.('input,select,textarea,svg,kbd') ? "" : child.textContent).join(" "));
  }
  function valueName(node) {
    if (valueLabels[node.id.replace(/^ol-/, "")]) return valueLabels[node.id.replace(/^ol-/, "")];
    const metric = node.closest('.ol-comparison-metric'), row = node.closest('.ol-row'), cell = node.closest('td'), dt = node.previousElementSibling;
    return clean(metric?.querySelector('.ol-comparison-label')?.textContent || row?.firstElementChild?.textContent || node.closest('.ol-metric')?.querySelector('label')?.textContent || node.closest('.ol-line-row,label')?.querySelector('.ol-line-name')?.textContent || (node.matches('.ol-family-count,.ol-lines-count') ? 'Enabled lines' : '') || (node.closest('.ol-legend-ticks') ? 'Colour scale value' : '') || (dt?.matches('dt') ? dt.textContent : "") || cell?.closest('table')?.querySelector('thead tr')?.children[cell.cellIndex]?.textContent || node.dataset.field || node.id.replace(/^ol-/, "").replace(/-/g, " ") || "Measured value");
  }
  function name(node) {
    if (node.dataset.helpLabel) return node.dataset.helpLabel;
    if (isValue(node)) return valueName(node);
    const labelled = node.getAttribute('aria-labelledby');
    return clean(node.dataset.hintLabel || node.getAttribute('aria-label') || (labelled && labelled.split(/\s+/).map(id => node.ownerDocument.getElementById(id)?.textContent || "").join(" ")) || textLabel(node.labels?.[0]) || textLabel(node) || node.name || node.id.replace(/^ol-/, "").replace(/-/g, " "));
  }
  function meaning(label, key = "") {
    const field = normalize(key), title = normalize(label);
    if (glossary.has(title)) return glossary.get(title);
    if (glossary.has(field)) return glossary.get(field);
    if (/^diff (up|flat|down)$/.test(field)) return "Matching-case outcome share minus the seasonally eligible baseline, in percentage points.";
    for (const [term, text] of glossary) if (term.length > 5 && (` ${title} `).includes(` ${term} `)) return text;
    return "";
  }
  function describe(node, savedTitle = "") {
    const label = name(node), id = node.id.replace(/^ol-/, ""), read = isValue(node), data = node.dataset;
    const described = clean((node.getAttribute('aria-describedby') || "").split(/\s+/).filter(key => key && key !== 'ol-help-tooltip').map(key => node.ownerDocument.getElementById(key)?.textContent || "").join(" ")).replace(/(?:^|\. )Key:.*$/, "");
    const legacy = clean(node.getAttribute('title') || savedTitle || node.closest('[title]')?.getAttribute('title'));
    let text = clean(data.help || (!read && data.hint) || fields[id]);
    if (!text && read && node.matches(".ol-comparison-history-note")) text = "Frozen comparison history is unavailable for this capture; the reason shown is a data state, not a zero measurement.";
    if (!text && read) {
      const key = data.field || node.closest('[data-metric]')?.dataset.metric || id;
      text = node.matches('.ol-comparison-difference') ? glossary.get('difference') : node.matches('.ol-comparison-rank') ? glossary.get('rank') : meaning(label, key);
      if (!text && node.closest('.ol-legend-ticks')) text = "Numeric value mapped to this position on the current colour scale, in its selected measurement basis.";
      if (!text && node.matches('.ol-comparison-band')) text = "Lower and upper price limits of the captured cell's nominal price row, in USDT.";
      if (!text && node.matches('.ol-pair')) text = "Traded asset and quote currency: bitcoin priced in USDT.";
      if (!text && node.matches('.ol-venue')) text = "The exchange and market type supplying these trades.";
      if (!text && node.matches('.ol-family-count,.ol-lines-count')) text = "Number of enabled lines in this group; enabled lines can be held back by visibility limits.";
      if (!text && legacy.length > 20 && /[a-z]{3}/i.test(legacy)) text = legacy;
      if (!text) text = `${label} for the current ${node.closest('#ol-comparisonWorkspace') ? 'captured cell' : node.closest('#ol-summary-body') ? 'view and source' : 'measured observation'}.`;
    }
    if (!text && data.comparisonControl) text = actions[data.comparisonControl];
    if (!text && (data.comparisonAction || data.cellComparisonAction)) text = actions[data.comparisonAction || data.cellComparisonAction];
    if (!text && data.surface) text = `Move the inspection cursor through ${label.toLowerCase()} and read their measured values.`;
    if (!text && data.referenceTarget !== undefined) text = `Locate ${label.replace(/^Show /i, '')} in the current workspace.`;
    if (!text && data.sort) text = `Order the Cells table by ${label.toLowerCase()}; choose again to reverse the order.`;
    if (!text && data.caseSort) text = `Order historical cases by ${label.toLowerCase()}; choose again to reverse the order.`;
    if (!text && data.window) text = `Show ${label.replace(/\s*\d$/, '')} of trading history, ending at the latest available data unless a calendar year is selected.`;
    if (!text && data.rallyId) text = "Select this observed rally and inspect its native member trades and volume profile.";
    if (!text && data.drawingAction) text = `${label} for ${data.drawingId ? 'this drawing' : 'the drawing collection'}; changes can be undone in drawing context.`;
    if (!text) text = clean(node.querySelector('.ol-item-desc')?.textContent) || described || (legacy.length >= 12 ? legacy : "");
    if (!text && node.matches('input') && meaning(label, node.name)) text = meaning(label, node.name);
    if (!text && node.matches('input')) text = `Set ${label.toLowerCase()}${node.type === 'checkbox' || node.type === 'radio' ? ' for the current view' : ''}.`;
    if (!text && node.matches('select')) text = `Choose ${label.toLowerCase()} for the current view.`;
    if (!text && node.matches('summary')) text = `Expand or collapse ${label.toLowerCase()}.`;
    if (!text && node.matches('tr')) text = "Move to this record; Enter opens its detailed values and available actions.";
    if (!text && node.matches('a')) text = `Open ${label || 'the linked reference'} in a separate browser tab.`;
    if (!text && /^(close|cancel|back)/i.test(label)) text = /cancel/i.test(label) ? "Close without applying pending changes." : "Return to the previous panel or close this view.";
    if (!text && /^(previous|next)/i.test(label)) text = `Show the ${label.toLowerCase()} page of records without changing the current query.`;
    if (!text && /^(clear|remove|delete)/i.test(label)) text = `${label} from the current view or collection.`;
    if (!text && /^(apply|save)/i.test(label)) text = `Apply the current form settings to ${node.closest('[data-drawing-ui]') ? 'this drawing' : 'the current view'}.`;
    if (!text && /stop waiting/i.test(label)) text = "Stop waiting for this request; retain the previously completed results.";
    if (!text) text = node.getAttribute('aria-expanded') !== null ? `Open or close ${label.toLowerCase()}.` : `Choose ${label.toLowerCase()} for the current view.`;
    const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true';
    if (disabled && described && !text.includes(described)) text += ` ${described}`;
    else if (disabled) text += " Unavailable in the current state.";
    return { label, text, keys: data.keys || "", read, exact: read ? clean(node.textContent) : "" };
  }
  // A single temporary choice popup makes native select options hoverable. The
  // original select remains authoritative; programmatic/keyboard changes work.
  function choices({ root, beforeOpen, hide }) {
    let source = null, panel = null, expanded = null, controlled = null;
    function close(focus = false) {
      if (!source) return;
      const owner = source; source = null;
      panel.hidden = true;
      for (const [key, value] of [['aria-expanded', expanded], ['aria-controls', controlled]]) value === null ? owner.removeAttribute(key) : owner.setAttribute(key, value);
      if (focus && owner.isConnected) owner.focus({ preventScroll: true });
      hide();
    }
    function open(select) {
      if (select.disabled || select.multiple || select.size > 1) return;
      if (source === select) return close(true);
      close(); beforeOpen(select); hide();
      source = select; expanded = select.getAttribute('aria-expanded'); controlled = select.getAttribute('aria-controls');
      if (!panel) {
        panel = root.ownerDocument.createElement('div'); panel.id = 'ol-help-choices'; panel.className = 'ol-pop ol-help-choices';
        panel.setAttribute('role', 'listbox'); panel.dataset.temporary = 'popover'; root.append(panel);
      }
      panel.setAttribute('aria-label', name(select));
      panel.replaceChildren(...Array.from(select.options).filter(option => !option.hidden && !option.closest('optgroup')?.hidden).map(option => {
        const button = root.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'ol-item cursor-interaction'; button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(option.selected)); button.disabled = option.disabled || Boolean(option.closest('optgroup')?.disabled); button.tabIndex = -1;
        button.textContent = option.label; button.dataset.helpLabel = option.label;
        const rallyChoices = {
          first_hit: "Find the first passage to the upward target from each starting anchor.",
          controlled_advance: "Find upward targets reached without exceeding the permitted pullback.",
          swing: "Find upward swings from a trough, confirmed by the specified downward reversal.",
          bps: "Express the price move in basis points of its frozen reference price; 100 basis points is 1%.",
          atr: "Express the move in multiples of native ATR14-SMA on UTC 15-minute bars, frozen at the anchor or trough.",
        };
        button.dataset.help = option.dataset.help || (select.id.startsWith('ol-rally-') && rallyChoices[option.value]) || `${describe(select).text} Choice: ${option.label}.`; button.dataset.helpChoice = option.value;
        return button;
      }));
      select.setAttribute('aria-expanded', 'true'); select.setAttribute('aria-controls', panel.id);
      panel.hidden = false;
      const rect = select.getBoundingClientRect();
      panel.style.width = Math.min(Math.max(rect.width, 220), innerWidth - 16) + 'px';
      panel.style.left = Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8)) + 'px';
      panel.style.top = Math.max(8, rect.bottom + panel.offsetHeight + 8 > innerHeight ? rect.top - panel.offsetHeight - 4 : rect.bottom + 4) + 'px';
      (panel.querySelector('[aria-selected="true"]:not(:disabled)') || panel.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
      panel.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }
    function bind() {
      root.addEventListener('pointerdown', event => {
        const select = event.target.closest?.('select');
        if (select && !select.disabled && !select.multiple && select.size <= 1 && event.button === 0) event.preventDefault();
      }, true);
      root.addEventListener('click', event => {
        const select = event.target.closest?.('select'), choice = event.target.closest?.('[data-help-choice]');
        if (select && !select.disabled && !select.multiple && select.size <= 1) { event.preventDefault(); open(select); }
        else if (choice && source && !choice.disabled) {
          const owner = source, option = Array.from(owner.options).find(item => item.value === choice.dataset.helpChoice);
          // Read lists can be replaced while open. Match the displayed identity,
          // never an old index, and refuse vanished or newly unavailable choices.
          event.stopPropagation();
          if (!owner.isConnected || owner.disabled || !option || option.disabled || option.hidden || option.closest('optgroup')?.disabled || option.closest('optgroup')?.hidden) return close(true);
          const changed = owner.selectedIndex !== option.index; owner.selectedIndex = option.index; close(true);
          if (changed) { owner.dispatchEvent(new Event('input', { bubbles: true })); owner.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      }, true);
      root.addEventListener('change', event => { if (source === event.target) close(); });
      root.addEventListener('keydown', event => {
        if (source && panel.contains(event.target)) {
          event.stopPropagation();
          const buttons = Array.from(panel.querySelectorAll('button:not(:disabled)')), at = buttons.indexOf(root.ownerDocument.activeElement);
          if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); close(true); }
          else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          } else if (event.key.length === 1 && event.key !== ' ') {
            const next = buttons.slice(at + 1).concat(buttons.slice(0, at + 1)).find(button => button.textContent.toLowerCase().startsWith(event.key.toLowerCase())); next?.focus();
          }
        } else if (event.target.matches?.('select') && (['Enter', ' ', 'F4'].includes(event.key) || event.altKey && event.key === 'ArrowDown')) { event.preventDefault(); event.stopPropagation(); open(event.target); }
      });
      root.ownerDocument.addEventListener('pointerdown', event => { if (source && !source.contains(event.target) && !panel.contains(event.target)) close(); }, true);
      for (const event of ['resize', 'blur']) globalThis.addEventListener(event, () => close());
      globalThis.addEventListener('scroll', event => { if (source && !panel.contains(event.target)) close(); }, true);
    }
    return { bind, close };
  }
  return Object.freeze({ controls, values, selector, target, name, meaning, describe, choices });
});
