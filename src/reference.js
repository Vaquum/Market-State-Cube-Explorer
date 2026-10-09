(() => {
  "use strict";
  // One reference structure throughout: purpose, interpretation, action. Targets identify real UI
  // or regions of the current canvas; reading never turns features on or changes a saved view.
  const topics = [
    { id: "grid", group: "Read the market", title: "Time × price grid",
      purpose: "Locate trading activity in time and price. Each cell covers one time interval and one price band.",
      read: "Time runs left to right; price increases upward. Colour describes the selected Cells measure. A blank cell can mean no activity; marked cells can mean unavailable data.",
      use: "Start with Volume, then inspect a cell to read its amount and coverage. Change the time window or resolution to move between detail and context.",
      targets: [{ label: "Show grid", region: "cells" }, { label: "Show measure control", selector: "#ol-mode" }] },
    { id: "window", group: "Read the market", title: "Time window & price axis",
      purpose: "Choose the history to examine and how price follows time navigation.",
      read: "The window presets set the time span. Free axes lets you navigate independently; Refit fits price to the visible activity; Coupled zooms both axes; Diagonal follows the fitted resolution relationship.",
      use: "Choose a time preset; drag to pan and scroll to zoom. Shift changes price alone. End returns to the latest data; F fits the price range.",
      targets: [{ label: "Show time window", selector: "#ol-window" }, { label: "Show price-axis control", selector: "#ol-follow" }] },
    { id: "resolution", group: "Read the market", title: "Resolution",
      purpose: "Choose the time interval and price width aggregated into each cell.",
      read: "Larger cells sum more activity. Time and price sizes are independent. Auto chooses levels from screen size; a locked level stays chosen. A coarser fallback means the requested detail is unavailable.",
      use: "Open Resolution and use the time and price steppers or the lattice. Ready, pending and unavailable describe data availability; small, usable and large describe cell size on screen.",
      targets: [{ label: "Show resolution", selector: "#ol-res" }] },
    { id: "measures", group: "Read the market", title: "Cells: trading measures",
      purpose: "Choose what each cell measures; its tooltip and inspector report the same quantity.",
      read: "Volume is traded USDT; Trades is the count; Trade size is USDT per reported trade. Taker flow is the taker-buy share of volume; Taker trades is the taker-buy share of trades. Delta is taker-buy minus taker-sell USDT: the aggressive side, not net buying or participant intent. Cascade measures concentration within the cell's four-child parent: 0 means an even quarter, +2 means the whole parent; it does not identify liquidations. Geometry shows occupancy.",
      use: "Choose Cells. Use Amount for observed totals or Intensity for amounts per covered time and price. Read shares around 50%, Delta around zero, and Cascade around an even split.",
      targets: [{ label: "Show Cells menu", selector: "#ol-mode" }, { label: "Show grid", region: "cells" }] },
    { id: "candles", group: "Read the market", title: "Candles",
      purpose: "Read each time interval's exact open, high, low and close instead of colouring price cells.",
      read: "The body spans open to close; the wick reaches low and high. Up candles are hollow, down candles are filled, and unchanged candles are neutral. Prices do not snap to the grid's price rows. Coverage and unfinished intervals still matter.",
      use: "Choose Candles in Cells or press K to toggle back to the previous encoding. Use Lens for finer candles, and hover, Inspect or the Cells table for exact prices. Candles requires the live cube; recorded data reports unavailability.",
      targets: [{ label: "Show Cells menu", selector: "#ol-mode" }, { label: "Show price chart", region: "cells" }] },
    { id: "movement", group: "Read the market", title: "Cells: movement measures",
      purpose: "See where price travelled or stayed, including cells with movement and no trades.",
      read: "Path measures distance travelled in cell row spans; the record also gives USDT moved and spans per minute. Dwell is the cell's share of its column's covered time. Movement-only cells have an inset stroke; insufficient screen space is counted as detail unresolved.",
      use: "On the live cube, choose Path or Dwell in Cells. Inspect for exact movement and coverage. These measures are unavailable in the recorded snapshot.",
      targets: [{ label: "Show Cells menu", selector: "#ol-mode" }] },
    { id: "scales", group: "Read the market", title: "Colour scales & comparison",
      purpose: "Establish what a shade means before comparing cells or rows.",
      read: "Value maps amounts onto a log or linear scale. Relative rank maps their position in the fitted distribution. Explore holds a fitted scale for each resolution or Rows context. Auto color refits after settled changes; Comparison lock holds colour mappings and axes across contexts. A scale change can give the same shade a new meaning.",
      use: "Expand Cell colour scale or Rows colour scale below for ticks, fitted data and controls. Fit recalibrates once. Use Comparison lock when comparing across resolutions or periods; check out-of-range and low-discrimination notices. Local contrast applies only to the lens.",
      targets: [{ label: "Show cells", region: "cells" }, { label: "Show row strip", region: "rows" }] },
    { id: "rows", group: "Read the market", title: "Rows & reference period",
      purpose: "Place the view or selection against a longer history at each price level.",
      read: "Rows has its own period. Its narrow strip shows full-strength values; its faint backdrop extends behind the grid. Volume and Delta are period totals; Time at price is period dwell. Row volume versus mean traded row compares a row's period volume with the mean of all traded rows in that period: 0 is average, +1 is double, −1 is half. Untraded rows have no concentration band. The strip retains the period’s native row width; the drawn profile may use coarser bins. Profile-share log₂ ratio separately compares overlapping clipped bins on common support; Shared row share uses wholly-in-view bins. Each profile has its own amount axis unless a supported shared axis is selected.",
      use: "Turn Rows on, choose a measure and set its period. All history is the available reference history. Fixed periods ignore navigation and selections; Visible range follows the chart's time window. A selection changes Profile-share log₂ ratio, while background values retain their period basis.",
      targets: [{ label: "Show Rows control", selector: "#ol-rows" }, { label: "Show row strip", region: "rows" }] },
    { id: "profiles", group: "Read the market", title: "Profile tracks",
      purpose: "Compare how activity is distributed across price levels.",
      read: "The current track is view or selection volume, with taker-buy volume inset; the reference track uses the Rows measure and period. Independent axes scales each separately. Shared absolute makes equal lengths equal amounts. Shared row share makes each row a percentage of its own track's total over the common price window: 20% versus 10% is twice the concentration.",
      use: "Expand Profile comparison below to choose a comparison. Shared absolute requires Volume on both tracks; row share requires nonnegative distributions. Read the printed domains and totals. Narrow charts fold the tracks; use Show the tracks on the chart to reveal them.",
      targets: [{ label: "Show profile tracks", region: "profiles" }] },
    { id: "columns", group: "Read the market", title: "Columns & indicators",
      purpose: "Read time-based summaries below the price grid.",
      read: "Same as cells follows the Cells measure. Alternatives include Volume, Delta, Trades and Trade size. Volume per touched row versus expected compares volume per touched price row against its parent and a fitted model; Choppiness is path over range; Volume per path is USDT per distance moved. Inspect shows the selected canonical value and three companions, with twelve intervals at a fixed price band. Seasonal activity is all-price quote volume versus six preceding weekly offsets, requiring four exactly covered matches; missing weeks are gaps, not zero. MSCC history is Float32. Price response is all-price close minus open, paired only on matching temporal support; displacement uses the prior completed UTC day’s Wilder ATR(14), with raw USDT retained. Missing ATR remains unavailable. RSI uses 14 daily or 4-hour closes; MACD uses daily EMA(12) minus EMA(26), signal EMA(9) and their histogram.",
      use: "Choose Columns independently of Cells. Read its labelled axis; expand Column and profile axes below for domains, policies and provenance. Inspect the Columns surface for values. Check the model's cutoff status before interpreting Volume per touched row versus expected, and use the indicator guides and event marks for context.",
      targets: [{ label: "Show Columns menu", selector: "#ol-pane" }, { label: "Show column pane", region: "columns" }] },
    { id: "states", group: "Read the market", title: "Data states & coverage",
      purpose: "Distinguish a measured value from zero, incomplete coverage or unavailable data.",
      read: "The footer keys identify pending, failed, unsupported, undefined and out-of-range marks. Open columns are unfinished; provisional minutes may be replaced by archived data. Edge portions have their own amounts and exposure. Short exposure means less than 10% of nominal time or price coverage.",
      use: "Read the footer and inspect marked cells for their reason. Use the data-through and canonical-through times to judge freshness. Wait for pending data; use the displayed error and retry action when a read fails.",
      targets: [{ label: "Show state key", selector: ".ol-status" }, { label: "Show data status", selector: "#ol-state-pill" }] },
    { id: "selection", group: "Work with the view", title: "Select a region",
      purpose: "Measure a time-and-price rectangle within the chart.",
      read: "The right context pane and current volume profile describe the selection while it exists. Partial edge cells contribute their observed portion. Rows keeps its independent reference period.",
      use: "Choose Select and drag a rectangle. Inspect cells for detail; use Clear or Escape to return the summaries to the whole view. Selection alone does not anchor an evidence query.",
      targets: [{ label: "Show Select tool", selector: "#ol-select" }, { label: "Show selection", region: "selection" }] },
    { id: "inspect", group: "Work with the view", title: "Inspect & context",
      purpose: "Read exact records for cells, rows, columns, references and lens cells.",
      read: "The inspector reports the selected record's measurements and coverage. The context pane summarizes the view or selection. The inspection cursor remains at its time and price through navigation.",
      use: "Choose Inspect or press E. Click a feature, select a surface, or use the steppers and arrows. Enter opens details; Escape closes details, then Inspect. Outside the view, Home returns to a visible item.",
      targets: [{ label: "Show Inspect tool", selector: "#ol-inspect-tool" }, { label: "Show inspector", selector: "#ol-inspect" }] },
    { id: "lens", group: "Work with the view", title: "Lens & pin",
      purpose: "Examine finer cells inside a region while keeping the wider context visible.",
      read: "The lens uses the active cell colour scale unless Local contrast is enabled. Finer data is read separately; it becomes the main view only when pinned.",
      use: "Choose Lens, or hold Alt for a temporary peek. Shift+L changes depth from one to four finer levels. Enter or Pin adopts the lens rectangle and resolution; check any resulting scale-change notice.",
      targets: [{ label: "Show Lens tool", selector: "#ol-lens" }] },
    { id: "references", group: "Work with the view", title: "Reference lines & events",
      purpose: "Locate profile, session, structural, average, VWAP and calendar landmarks.",
      read: "POC is the highest-volume row; Buy POC uses taker buys; a value area reaches at least 70% of volume in whole rows. These depend on the measured period and row width. Session and structure marks locate ranges, equal highs/lows, gaps and swings. Averages and VWAP trace price summaries. Clock schedules are vertical marks; squeezes and the spot weekend proxy occupy event lanes. A reference locates a hypothesis; it does not establish support, resistance or future direction.",
      use: "Open Lines to choose families, periods and dates. Click a reference to focus it; Show all restores the rest. Inspect References reads each enabled item by name. X places or clears your own horizontal price level.",
      targets: [{ label: "Show Lines menu", selector: "#ol-lines" }, { label: "Show event lanes", region: "events" }] },
    { id: "drawings", group: "Work with the view", title: "Trend drawings",
      purpose: "Add and retain your own geometric price references.",
      read: "A drawing is your annotation. Its two anchors are UTC time and USDT price, so it remains tied to the market coordinates when the view changes.",
      use: "Choose the trend tool and place two anchors. Select a drawing to edit its coordinates, name, colour and label, or use its available lock, copy and delete actions. Undo restores drawing changes.",
      targets: [{ label: "Show drawing tool", selector: "#ol-trend" }] },
    { id: "evidence", group: "Evaluate & retain", title: "Continuations & matching cases",
      purpose: "Compare historical outcomes after market states resembling an anchored column.",
      read: "Continuations separates matching cases from all seasonally eligible cases and shows their outcome rates and differences. Outcomes measure POC movement, not trade returns. Horizon determines how far ahead outcomes are read; barrier settings apply to POC-barrier outcomes. Historical rates and pointwise intervals do not calibrate forecast odds or establish a trading edge after costs.",
      use: "Open Continuations or press C, then click a completed column with Pan to anchor it. Choose outcome and horizon, read the matching-case count and explanation, and open Cases to inspect examples. A selected rectangle and a continuation anchor serve different purposes.",
      targets: [{ label: "Show Continuations tab", selector: "#ol-evidence-tab" }, { label: "Show Cases panel", selector: "#ol-tab-cases" }] },
    { id: "rallies", group: "Evaluate & retain", title: "Rallies: observed upward moves",
      purpose: "Discover upward price moves in native trades using an explicit operational definition.",
      read: "First passage ends at the target; Controlled advance also limits pullback; Swing confirms after a reversal from a qualifying high. Thresholds use basis points or frozen ATR14-SMA on native UTC 15-minute bars. Confirmation describes an observed event, not future gains. Binance spot data cannot establish short covering or derivatives leadership.",
      use: "Open Rallies, choose the definition and UTC analysis window, then Discover on the live cube. Select a confirmed event for member-only totals and profile. Grid, replay and time-to-target filters reuse the discovery; Refresh discovery applies changed definition or window settings. Cell outlines can include other trades alongside members.",
      targets: [{ label: "Show Rallies panel", selector: "#ol-tab-rallies" }] },
    { id: "replay", group: "Evaluate & retain", title: "Replay & model timing",
      purpose: "Explore history with an explicit effective data cutoff.",
      read: "The replay edge limits measurements and reference periods. Scales fitted after that cutoff are invalidated, unless a deliberate comparison lock is disclosed as an external override. Replay uses currently available history; original data vintages are not guaranteed. Volume per touched row versus expected model timing has its own disclosure.",
      use: "Open Replay, set its edge, then step or play columns. Check data and model provenance before interpreting results. Exit Replay to restore the live workspace and its scales.",
      targets: [{ label: "Show Replay control", selector: "#ol-replay" }] },
    { id: "tables", group: "Evaluate & retain", title: "Rallies, Cells, Cases & Query drawer",
      purpose: "Inspect the underlying records and the exact configuration behind the chart.",
      read: "Rallies lists confirmed native events; Cells lists measured cells; Cases lists continuation examples; Query summarizes bounds, measures, scales, axes and provenance. Sorting changes table order, not the measurements.",
      use: "Choose a bottom-panel icon to open it; choose it again to close. T toggles the current bottom panel. Move through Cells with arrows and Enter to inspect a record. Use Query when you need a precise account of how a view was produced.",
      targets: [{ label: "Show panel toggles", selector: ".ol-drawer-bar" }] },
    { id: "compare", group: "Evaluate & retain", title: "Compare captured cells",
      purpose: "Keep cell records together for direct comparison.",
      read: "A capture retains its measurement, bounds, coverage, source and original scale. The Compare workspace lets you read captures together; their context and completeness remain part of the comparison.",
      use: "Open a cell's context menu to capture it, then use the Compare panel to inspect the collection and its available views. Read units and observed coverage before comparing magnitudes.",
      targets: [{ label: "Show Compare panel", selector: "#ol-tab-compare" }] },
    { id: "views", group: "Evaluate & retain", title: "History, saved views & sharing",
      purpose: "Return to a configuration or share how the chart was interpreted.",
      read: "History records this tab's navigation; saved views retain chosen settings. Links and portable view codes include active colour scales and frozen axes. A settings-only URL does not preserve exact calibration; a scale descriptor does not freeze the underlying market data.",
      use: "Open Views to save, restore or copy a link or view code. Use Back and Forward for tab history. Keep the portable code when the URL is too large to carry exact scales. Reset canvas restores the default chart, with confirmation when drawings or comparison captures exist.",
      targets: [{ label: "Show Views", selector: "#ol-hist" }, { label: "Show reset control", selector: "#ol-reset-canvas" }] },
  ];

  function create({ root, region, beforeOpen, beforeChange, closeTransient, openKeys, hasTransient }) {
    const el = id => root.querySelector(`#ol-reference-${id}`), pane = root.querySelector("#ol-reference"), main = root.querySelector("#ol-main"), select = el("topic");
    let current = topics[0], active = null, scheduled = 0, lastShape = "", returnFocus = null;
    const node = (tag, text, cls) => {
      const value = document.createElement(tag);
      if (text) value.textContent = text;
      if (cls) value.className = cls;
      return value;
    };
    let group;
    for (const topic of topics) {
      if (!group || group.label !== topic.group) { group = document.createElement("optgroup"); group.label = topic.group; select.append(group); }
      const option = node("option", topic.title); option.value = topic.id; group.append(option);
    }
    const ns = "http://www.w3.org/2000/svg", overlay = document.createElementNS(ns, "svg"), shade = document.createElementNS(ns, "path"), frame = document.createElementNS(ns, "rect");
    overlay.id = "ol-reference-spotlight";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";
    shade.setAttribute("fill-rule", "evenodd");
    shade.setAttribute("class", "ol-reference-shade");
    frame.setAttribute("class", "ol-reference-frame"); frame.setAttribute("rx", "5");
    overlay.append(shade, frame); root.append(overlay);
    shade.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); clearSpotlight(); });

    function bounds(target) {
      if (target.region) return region(target.region);
      const element = root.querySelector(target.selector);
      if (!element || element.closest("[hidden], [inert]") || !element.getClientRects().length) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    }
    function refresh() {
      if (pane.hidden) return;
      el("prev").disabled = topics.indexOf(current) === 0;
      el("next").disabled = topics.indexOf(current) === topics.length - 1;
      if (active) schedule();
    }
    function clearSpotlight() {
      active = null; lastShape = ""; overlay.style.display = "none";
      for (const button of pane.querySelectorAll("[data-reference-target]")) button.setAttribute("aria-pressed", "false");
      el("status").textContent = "";
    }
    function hole(rect) { return `M${rect.left},${rect.top}h${rect.width}v${rect.height}h${-rect.width}Z`; }
    function paint() {
      scheduled = 0;
      if (!active || pane.hidden) return;
      const raw = bounds(active), doc = pane.getBoundingClientRect();
      if (!raw) { overlay.style.display = "none"; el("status").textContent = "This part is not visible in the current view. Use its control to enable or reveal it."; return; }
      let left = Math.max(0, raw.left - 4), top = Math.max(0, raw.top - 4), right = Math.min(innerWidth, raw.right + 4), bottom = Math.min(innerHeight, raw.bottom + 4);
      // Clip the target to the visible workspace and leave the docked reference unobscured.
      if (left < doc.right && right > doc.left && top < doc.bottom && bottom > doc.top) {
        if (doc.width >= innerWidth - 16) bottom = Math.min(bottom, doc.top);
        else left = Math.max(left, doc.right);
      }
      if (right <= left || bottom <= top) { overlay.style.display = "none"; el("status").textContent = "This part is outside the visible area. Scroll it into view to highlight it."; return; }
      const rect = { left, top, width: right - left, height: bottom - top }, path = `M0,0H${innerWidth}V${innerHeight}H0Z${hole(doc)}${hole(rect)}`;
      if (path !== lastShape) {
        lastShape = path; overlay.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`); shade.setAttribute("d", path);
        for (const [key, value] of Object.entries({ x: left, y: top, width: rect.width, height: rect.height })) frame.setAttribute(key, value);
      }
      overlay.style.display = "block";
      el("status").textContent = `Highlighted: ${active.label.replace(/^Show /, "")}. Press Escape or click the dimmed area to stop.`;
    }
    function schedule() { if (!scheduled) scheduled = requestAnimationFrame(paint); }
    function render(id) {
      beforeChange();
      current = topics.find(topic => topic.id === id) || topics[0];
      select.value = current.id; clearSpotlight();
      const index = topics.indexOf(current), article = node("article");
      article.dataset.topic = current.id;
      article.append(node("p", current.group, "ol-reference-group"), node("h3", current.title));
      const list = node("dl");
      for (const [title, key] of [["Purpose", "purpose"], ["Read", "read"], ["Use", "use"]]) list.append(node("dt", title), node("dd", current[key]));
      article.append(list);
      const actions = node("div", "", "ol-reference-targets");
      for (const [i, target] of current.targets.entries()) {
        const button = node("button", target.label, "ol-action cursor-interaction"); button.type = "button"; button.dataset.referenceTarget = i; button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          if (active === target) { clearSpotlight(); return; }
          clearSpotlight(); active = target; button.setAttribute("aria-pressed", "true"); schedule();
        });
        actions.append(button);
      }
      el("targets").replaceChildren(...actions.children);
      el("article").replaceChildren(article);
      for (const section of pane.querySelectorAll("[data-reference-settings]")) section.hidden = section.dataset.referenceSettings !== current.id;
      el("position").textContent = `${index + 1} / ${topics.length}`;
      el("prev").disabled = index === 0; el("next").disabled = index === topics.length - 1;
      el("body").scrollTop = 0;
    }
    function open(id, origin = document.activeElement) {
      if (pane.hidden) returnFocus = origin;
      beforeOpen(); pane.hidden = false; main.dataset.reference = "open"; el("toggle").setAttribute("aria-expanded", "true"); el("toggle").setAttribute("aria-pressed", "true");
      if (id) render(id); else refresh();
      select.focus({ preventScroll: true });
    }
    function close() {
      beforeChange();
      clearSpotlight(); pane.hidden = true; delete main.dataset.reference; el("toggle").setAttribute("aria-expanded", "false"); el("toggle").setAttribute("aria-pressed", "false");
      const destination = returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest("[hidden]") ? returnFocus : el("toggle");
      destination.focus({ preventScroll: true });
    }
    el("toggle").addEventListener("click", () => pane.hidden ? open(null, el("toggle")) : close());
    el("close").addEventListener("click", close);
    el("shortcuts").addEventListener("click", () => { clearSpotlight(); openKeys(); });
    select.addEventListener("change", () => render(select.value));
    el("prev").addEventListener("click", () => { render(topics[topics.indexOf(current) - 1]?.id); if (el("prev").disabled) select.focus(); });
    el("next").addEventListener("click", () => { render(topics[topics.indexOf(current) + 1]?.id); if (el("next").disabled) select.focus(); });
    pane.addEventListener("keydown", event => {
      if (event.key === "Escape" && closeTransient()) event.preventDefault();
      event.stopPropagation();
    });
    document.addEventListener("keydown", event => {
      if (pane.hidden || event.key !== "Escape" || hasTransient()) return;
      // A spotlight owns Escape globally; the docked pane only owns keys from its contents.
      if (!active && !pane.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (active) clearSpotlight(); else close();
    }, true);
    root.addEventListener("click", event => {
      if (active && !pane.contains(event.target)) clearSpotlight();
    });
    addEventListener("resize", refresh); addEventListener("scroll", refresh, true);
    new ResizeObserver(refresh).observe(root);
    render(current.id);
    return { open, refresh, clearSpotlight };
  }
  window.explorerReference = Object.freeze({ create });
})();
