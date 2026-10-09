/* Observed native rallies. Detection belongs to Origo; this controller retains its result. */
(function (scope) {
  "use strict";
  const PAGE = 25;
  function visible(events, edgeUs, deadline, swing) {
    return events.filter(e => e.confirmed_at_us < edgeUs && (swing || deadline === null || e.duration_seconds < deadline * 60));
  }
  function iso(us) {
    const whole = Math.floor(us / 1000000), fraction = us - whole * 1000000;
    return new Date(whole * 1000).toISOString().slice(0, 19) + "." + String(fraction).padStart(6, "0") + "Z";
  }
  function definitionText(d) {
    const unit = d.scale === "atr" ? "ATR14-SMA" : "bps";
    const name = {first_hit: "First passage", controlled_advance: "Controlled advance", swing: "Swing"}[d.mode];
    const parts = [name, `target ${d.target} ${unit}`];
    if (d.mode === "swing") parts.push(`confirming reversal ${d.reversal} ${unit}`);
    else parts.push(`anchors every ${d.anchor_minutes} min`);
    if (d.mode === "controlled_advance") parts.push(`max pullback ${d.pullback} ${unit}`);
    return parts.join(" · ");
  }
  function create({root, context, changed, inspect}) {
    const el = id => root.querySelector("#ol-rally-" + id);
    const fmt = (n, digits = 2) => Number(n).toLocaleString("en-US", {maximumFractionDigits:digits});
    const time = us => iso(us).slice(0, 19).replace("T", " ");
    let result = null, projection = null, selectedId = null, busy = false, page = 0;
    let key = null, inFlight = null, presentationKey = null, stale = false, initialized = false, epoch = 0, errorMessage = "";
    let deadlineMinutes = 240;
    const deadline = () => deadlineMinutes;
    const swing = () => result?.metadata.normalized_definition.mode === "swing";
    const known = () => Math.min(context().edgeUs, result ? Date.parse(result.metadata.observation_ceiling) * 1000 : Infinity);
    const shown = () => result && !stale ? visible(result.events, known(), deadline(), swing()) : [];
    function status(words) { el("status").textContent = words; }
    function controls() {
      const mode = el("mode").value, atr = el("scale").value === "atr";
      el("cadence-label").hidden = mode === "swing";
      el("pullback-label").hidden = mode !== "controlled_advance";
      el("reversal-label").hidden = mode !== "swing";
      el("deadline-label").hidden = (result ? swing() : mode === "swing");
      el("scale-note").textContent = atr ? "ATR14-SMA · native UTC 15m bars; frozen at anchor or trough. Chart context uses Wilder ATR(14)." : "Thresholds in basis points of the frozen reference price.";
      for (const name of ["target", "pullback", "reversal"]) el(name).max = atr ? 100 : name === "reversal" ? 9999.999 : 10000;
      el("discover").disabled = busy || !context().live;
      el("discover").textContent = busy ? "Discovering…" : result ? "Refresh discovery" : "Discover";
      el("window").disabled = busy;
      for (const node of el("form").querySelectorAll("input, select")) node.disabled = busy;
      for (const [name, active] of [["cadence", mode !== "swing"], ["pullback", mode === "controlled_advance"], ["reversal", mode === "swing"]]) {
        el(name).disabled = busy || !active; el(name).required = active;
      }
    }
    function useWindow() {
      const c = context(), end = Math.min(c.viewEndUs, c.edgeUs), start = Math.max(c.viewStartUs, end - 24 * 3600e6);
      el("start").value = iso(start).slice(0, 19);
      el("end").value = iso(end).slice(0, 19);
    }
    function row(label, value) {
      const node = document.createElement("div"); node.className = "ol-row";
      const name = document.createElement("span"), text = document.createElement("span");
      name.textContent = label; text.textContent = value; node.append(name, text); return node;
    }
    function renderInspector() {
      const box = el("inspector"); box.replaceChildren(); box.hidden = !selectedId;
      if (!selectedId) return;
      const title = document.createElement("div"); title.className = "ol-section-heading"; title.textContent = "Selected rally · native members"; box.append(title);
      const event = current()?.selected;
      if (!event) {
        box.append(row("State", stale ? "Source changed · refresh discovery" : errorMessage || (inFlight ? "Reading membership…" : "Hidden by replay or time-to-target filter")));
        return;
      }
      const {normalized_definition: d, analysis} = result.metadata;
      box.append(row("Retained definition", definitionText(d)), row("Analysis · UTC", `${analysis.start} → ${analysis.end}`),
        row("Reference", `${fmt(event.reference_price)} USDT`), row("Return", `${fmt(event.return_bps)} bps`),
        row("Duration", `${fmt(event.duration_seconds)} s`), row("Max drawdown", `${fmt(event.max_drawdown)} USDT`),
        row("USDT volume", fmt(event.volume)), row("Trades", fmt(event.trade_count, 0)),
        row("Buyer-initiated USDT", fmt(event.taker_buy_volume)),
        row("Normalized delta", event.volume ? `${fmt(100 * (2 * event.taker_buy_volume - event.volume) / event.volume)}%` : "Unavailable"),
        row("Start · UTC", time(event.start_at_us)), row("End · UTC", time(event.end_at_us)), row("Confirmed · UTC", time(event.confirmed_at_us)));
      const p = projection.profile, total = p.reduce((sum, r) => sum + r.volume, 0);
      const poc = p.reduce((best, r) => !best || r.volume > best.volume ? r : best, null);
      if (poc) box.append(row("Member POC centre", `${fmt((poc.r + .5) * 125)} USDT · 125 USDT bins`));
      const profile = document.createElement("div"); profile.className = "ol-rally-profile"; profile.setAttribute("aria-label", "Native member volume profile");
      for (const r of p) {
        const entry = row(`${fmt(r.r * 125)}–${fmt((r.r + 1) * 125)}`, `${fmt(r.volume)} USDT`);
        entry.style.setProperty("--rally-share", `${total ? r.volume / total * 100 : 0}%`); profile.append(entry);
      }
      box.append(profile, row("Native IDs", `${event.start_trade_id} → ${event.end_trade_id}`));
      const note = document.createElement("p"); note.className = "ol-muted";
      note.textContent = "Outlines mark cells containing members; other trades may share them. Profile and totals use members only. Event path, dwell and indicators are unavailable. Surrounding auction context remains in the regular inspector.";
      box.append(note);
      box.dataset.rallyId = event.rally_id;
    }
    function render() {
      controls();
      const definition = el("definition"); definition.hidden = !result;
      definition.textContent = result ? `Retained discovery · ${definitionText(result.metadata.normalized_definition)}. Analysis · UTC: ${result.metadata.analysis.start} → ${result.metadata.analysis.end}. Retained until Refresh discovery; form edits apply only to the next discovery.` : "";
      const events = shown(), pages = Math.max(1, Math.ceil(events.length / PAGE)); page = Math.min(page, pages - 1);
      const body = el("rows"); body.replaceChildren();
      for (const e of events.slice(page * PAGE, (page + 1) * PAGE)) {
        const tr = document.createElement("tr"), td = document.createElement("td"), button = document.createElement("button");
        button.type = "button"; button.className = "ol-action ol-s cursor-interaction";
        button.textContent = time(e.start_at_us); button.setAttribute("aria-pressed", String(e.rally_id === selectedId));
        button.title = e.rally_id; button.dataset.rallyId = e.rally_id;
        button.onclick = () => select(e.rally_id); td.append(button); tr.append(td);
        for (const value of [time(e.confirmed_at_us), fmt(e.return_bps) + " bps", fmt(e.duration_seconds) + " s", fmt(e.volume), fmt(e.trade_count, 0)]) {
          const cell = document.createElement("td"); cell.textContent = value; tr.append(cell);
        }
        body.append(tr);
      }
      el("page").textContent = `${events.length} confirmed · ${page + 1}/${pages}`;
      el("previous").disabled = page === 0; el("next").disabled = page + 1 >= pages;
      if (!context().live) status("Discovery requires the live Origo cube. The recorded page has no native rally endpoint.");
      else if (result && !busy && !errorMessage) {
        const c = context(), ceiling = Date.parse(result.metadata.observation_ceiling) * 1000;
        const prefix = stale ? "Source changed · refresh discovery." : `${events.length} confirmed rallies visible. Overlapping events remain separate.`;
        const counts = result.metadata.diagnostic_counts;
        const diagnostics = c.edgeUs >= ceiling ? ` ${counts.right_censored_count} unfinished · ${counts.left_censored_count} left-censored · ${counts.unknown_context_count} unknown context.` : " Ceiling diagnostics hidden during earlier replay.";
        status(prefix + diagnostics + (c.pack !== result.pack ? " New pack available; Refresh discovery to scan again." : ""));
      }
      renderInspector();
    }
    async function post(path, body) {
      const controller = new AbortController(), timeout = path.endsWith("/view") ? 30000 : 330000;
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(path + "?proto=2", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), cache:"no-store", signal:controller.signal});
        const reply = await response.json();
        if (!response.ok) { const error = new Error(reply.detail ? (typeof reply.detail === "string" ? reply.detail : JSON.stringify(reply.detail)) : reply.error); error.status = response.status; throw error; }
        return reply;
      } catch (error) {
        if (controller.signal.aborted) throw new Error(path.endsWith("/view") ? "Membership view timed out; select the rally again to retry." : "Request timed out. Discovery may still finish at the service; retry when the cube becomes available.");
        throw error;
      } finally { clearTimeout(timer); }
    }
    async function discover(event) {
      event.preventDefault(); if (busy) return;
      const c = context(), definition = {mode:el("mode").value, scale:el("scale").value, target:Number(el("target").value)};
      if (definition.mode === "swing") definition.reversal = Number(el("reversal").value);
      else definition.anchor_minutes = Number(el("cadence").value);
      if (definition.mode === "controlled_advance") definition.pullback = Number(el("pullback").value);
      const analysis = {start:el("start").value + "Z", end:el("end").value + "Z"};
      busy = true; epoch++; projection = null; selectedId = null; result = null; key = null; stale = false; errorMessage = ""; changed(); render(); status("Discovering native trades once; cube reads pause until the result returns.");
      try { result = {...await post("/cube/rallies", {pack:c.pack, definition, analysis}), pack:c.pack}; page = 0; }
      catch (error) { errorMessage = `${error.status ?? "Network"}: ${error.message}`; status(errorMessage); }
      finally { busy = false; render(); sync(); changed(); }
    }
    function select(id) { selectedId = id; projection = null; key = null; errorMessage = ""; inspect(); sync(); render(); changed(); }
    function sync() {
      const c = context(); if (!c.ready) return;
      if (!initialized) { useWindow(); initialized = true; controls(); render(); }
      if (!result || busy || stale) return;
      const presentation = [c.edgeUs, deadline(), selectedId, c.pack, c.n, c.m].join("|");
      if (presentationKey !== presentation) { presentationKey = presentation; render(); }
      // Replay and deadlines filter canonical events locally. Only pack, grid or selection needs a new projection.
      const signature = [result.result_id, c.pack, c.n, c.m, selectedId].join("|");
      if (key === signature || inFlight) return;
      key = signature; projection = null;
      const generation = epoch, capturedResult = result, flight = {signature}; inFlight = flight; render();
      post("/cube/rallies/view", {pack:c.pack, result_id:result.result_id, rally_id:selectedId, n:c.n, m:c.m,
        known_at:result.metadata.observation_ceiling, deadline_minutes:null})
        .then(answer => { if (epoch !== generation || result !== capturedResult) return; projection = answer; errorMessage = ""; })
        .catch(error => {
          const now = context();
          if (epoch !== generation || [result?.result_id, now.pack, now.n, now.m, selectedId].join("|") !== signature) return;
          stale = error.status === 409 || error.status === 410; errorMessage = `${error.status ?? "Network"}: ${error.message}`; status(errorMessage);
        })
        .finally(() => { if (inFlight === flight) inFlight = null; sync(); render(); changed(); });
    }
    function current() { const c = context(); return projection && !stale && projection.pack === c.pack && projection.n === c.n && projection.m === c.m && selectedId === projection.selected?.rally_id && shown().some(e => e.rally_id === projection.selected?.rally_id) ? projection : null; }
    function paint(ctx, G, colors) {
      const view = current(); if (!view?.selected) return;
      ctx.save(); ctx.beginPath(); ctx.rect(G.x, G.y, G.w, G.h); ctx.clip();
      const ts = 2 ** view.n, ps = 2 ** view.m;
      for (const cell of view.cells) {
        const x = G.X(cell.c * ts), y = G.Y((cell.r + 1) * ps), w = G.X((cell.c + 1) * ts) - x, h = G.Y(cell.r * ps) - y;
        if (x + w < G.x || x > G.x + G.w || y + h < G.y || y > G.y + G.h) continue;
        ctx.strokeStyle = colors.surface; ctx.lineWidth = 3; ctx.strokeRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
        ctx.strokeStyle = colors.state; ctx.lineWidth = 1; ctx.strokeRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
      }
      ctx.restore();
    }
    el("form").addEventListener("submit", discover);
    el("window").onclick = useWindow;
    el("clear").onclick = () => { selectedId = null; projection = null; key = null; sync(); render(); changed(); };
    for (const name of ["mode", "scale"]) el(name).addEventListener("change", controls);
    el("scale").addEventListener("change", () => { const atr = el("scale").value === "atr"; el("target").value = atr ? 1 : 30; el("pullback").value = el("reversal").value = atr ? .5 : 10; });
    el("deadline").addEventListener("change", () => { if (!el("deadline").checkValidity()) { el("deadline").reportValidity(); return; } deadlineMinutes = el("deadline").value === "" ? null : Number(el("deadline").value); page = 0; sync(); render(); changed(); });
    el("previous").onclick = () => { page--; render(); }; el("next").onclick = () => { page++; render(); };
    return {sync, paint, get busy(){return busy;}, get events(){return projection && !stale && projection.pack === context().pack ? shown().filter(e => projection.visible_ids.includes(e.rally_id)) : [];}, get selectedId(){return selectedId;}, get enabled(){return !!result && !stale;}};
  }
  scope.explorerRallies = {create, visible, iso, definitionText};
  if (typeof module !== "undefined") module.exports = scope.explorerRallies;
})(typeof window === "undefined" ? globalThis : window);
