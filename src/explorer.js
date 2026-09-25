(async () => {
  "use strict";
  const root = document.getElementById("origo-lens"),
    el = (id) => root.querySelector("#ol-" + id),
    qsa = (s) => root.querySelectorAll(s),
    PACK = JSON.parse(document.getElementById("origo-lens-data").textContent);
  const BASE = PACK.base_seconds,
    PR = PACK.base_price,
    T0 = PACK.t0,
    CUT = (Date.parse(PACK.cutoff) / 1000 - T0) / BASE;
  // Diagonal through the resolution lattice: least-squares fit of
  // log2(median column price range / 125) against n over the full history,
  // n = 6..13, measured on the 2026-09-24 extraction (exponent 0.49).
  const ISO_A = -1.06,
    ISO_B = 0.486,
    N_MAX = 20,
    M_MAX = 9,
    TILE_COLUMNS = 4096;
  const diagonalM = (n) => clamp(Math.round(ISO_A + ISO_B * n), 0, M_MAX);
  const canvas = el("canvas"),
    ctx = canvas.getContext("2d"),
    reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const design = { grid: 0.32, gap: 1 },
    S = {
      dataset: "recent",
      window: "1",
      n: 4,
      m: 0,
      mode: "volume",
      poc: true,
      area: false,
      untested: false,
      tab: "context",
      select: false,
      selection: null,
      replay: false,
      anchor: null,
      horizon: 1,
      tA: 0,
      tB: 0,
      pA: 0,
      pB: 0,
      auto: true,
      coupled: false,
      refit: true,
      lens: false,
      table: false,
      diagonal: false,
      lensDepth: 2,
      evidenceKind: "poc",
      barrier: 1,
      caseFilter: "all",
      casePage: 0,
    };
  let sources = {},
    G = {},
    colors = {},
    hover = null,
    drag = null,
    transition = null,
    last = null,
    raf = 0,
    ready = false;
  const groups = new Map(),
    evidenceCache = new Map();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    stepT = () => 2 ** renderN(),
    stepP = () => 2 ** renderM();
  const dur = (s) =>
    s < 60
      ? `${s} s`
      : s < 3600
        ? `${+(s / 60).toFixed(3)} min`
        : s < 86400
          ? `${+(s / 3600).toFixed(2)} h`
          : `${+(s / 86400).toFixed(2)} d`;
  const compact = (x) =>
    x >= 1e12
      ? (x / 1e12).toFixed(2) + " T"
      : x >= 1e9
        ? (x / 1e9).toFixed(2) + " B"
        : x >= 1e6
          ? (x / 1e6).toFixed(2) + " M"
          : x >= 1e3
            ? (x / 1e3).toFixed(1) + " k"
            : x.toFixed(0);
  const integer = (x) => Math.round(x).toLocaleString("en-US"),
    price = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 2 }),
    date = (b) => new Date((T0 + b * BASE) * 1000),
    dateShort = (b) =>
      date(b).toLocaleString("en-GB", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    iso = (b) => date(b).toISOString(),
    stamp = (b) => {
      const s = iso(b);
      return s.slice(0, 10) + " " + s.slice(11, s.endsWith(".000Z") ? 19 : 23);
    },
    usdt = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  async function unpack(block, id) {
    const bytes = Uint8Array.from(atob(block.gzip_base64), (c) =>
      c.charCodeAt(0),
    );
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer(),
      v = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "MSC1")
      throw Error("Invalid recorded tile");
    const n = v.getUint8(4),
      m = v.getUint8(5),
      count = v.getUint32(16, true);
    let o = 32;
    const vol = new Float64Array(buf, o, count);
    o += 8 * count;
    const bv = new Float64Array(buf, o, count);
    o += 8 * count;
    const cs = new Uint32Array(buf, o, count);
    o += 4 * count;
    const rs = new Uint32Array(buf, o, count);
    o += 4 * count;
    const ct = new Uint32Array(buf, o, count);
    o += 4 * count;
    const bt = new Uint32Array(buf, o, count);
    const cells = Array.from({ length: count }, (_, i) => ({
      c: cs[i],
      r: rs[i],
      v: vol[i],
      bv: bv[i],
      ct: ct[i],
      bt: bt[i],
    }));
    return {
      id,
      n,
      m,
      cells,
      b0: block.b0,
      b1: block.b1,
      col0: v.getUint32(8, true),
      col1: v.getUint32(12, true),
    };
  }
  function aggregate(src, n, m, bounds = null) {
    const key = src.id + "|" + n + "|" + m;
    if (!bounds && groups.has(key)) return groups.get(key);
    const ts = 2 ** src.n,
      ps = 2 ** src.m,
      dt = 2 ** (n - src.n),
      dp = 2 ** (m - src.m),
      map = new Map();
    for (const z of src.cells) {
      const t = z.c * ts,
        p = z.r * ps;
      if (
        bounds &&
        (t < bounds[0] ||
          Math.min(t + ts, CUT) > bounds[1] ||
          p < bounds[2] ||
          p + ps > bounds[3])
      )
        continue;
      const c = Math.floor(z.c / dt),
        r = Math.floor(z.r / dp),
        k = c + "," + r;
      let a = map.get(k);
      if (!a) {
        a = { c, r, v: 0, bv: 0, ct: 0, bt: 0 };
        map.set(k, a);
      }
      a.v += z.v;
      a.bv += z.bv;
      a.ct += z.ct;
      a.bt += z.bt;
    }
    const cells = [...map.values()].sort((a, b) => a.c - b.c || a.r - b.r),
      cols = [],
      rows = new Map();
    let col = null,
      v = 0,
      bv = 0,
      ct = 0,
      bt = 0;
    for (const z of cells) {
      v += z.v;
      bv += z.bv;
      ct += z.ct;
      bt += z.bt;
      let row = rows.get(z.r);
      if (!row) {
        row = { r: z.r, v: 0, bv: 0, ct: 0, bt: 0 };
        rows.set(z.r, row);
      }
      for (const f of ["v", "bv", "ct", "bt"]) row[f] += z[f];
      if (!col || col.c !== z.c) {
        col = {
          c: z.c,
          v: 0,
          bv: 0,
          ct: 0,
          bt: 0,
          poc: null,
          best: 0,
          rows: [],
        };
        cols.push(col);
      }
      for (const f of ["v", "bv", "ct", "bt"]) col[f] += z[f];
      if (z.v > col.best) {
        col.poc = z.r;
        col.best = z.v;
      }
      col.rows.push(z);
    }
    for (const c of cols) {
      let pos = c.rows.findIndex((z) => z.r === c.poc),
        a = pos,
        b = pos,
        acc = c.best;
      if (pos >= 0) {
        while (acc < c.v * 0.7 && (a > 0 || b < c.rows.length - 1)) {
          const down = a > 0 ? c.rows[a - 1].v : -1,
            up = b < c.rows.length - 1 ? c.rows[b + 1].v : -1;
          if (down >= up) {
            a--;
            acc += down;
          } else {
            b++;
            acc += up;
          }
        }
        c.va0 = c.rows[a].r;
        c.va1 = c.rows[b].r + 1;
      }
    }
    let poc = null,
      bpoc = null,
      max = 0,
      bmax = 0;
    const rowList = [...rows.values()].sort((a, b) => a.r - b.r);
    for (const row of rowList) {
      if (row.v > max) {
        poc = row.r;
        max = row.v;
      }
      if (row.bv > bmax) {
        bpoc = row.r;
        bmax = row.bv;
      }
    }
    const logs = cells
        .filter((z) => z.v > 0)
        .map((z) => Math.log(z.v))
        .sort((a, b) => a - b),
      out = {
        cells,
        cols,
        rows: rowList,
        map,
        poc,
        bpoc,
        v,
        bv,
        ct,
        bt,
        lo: d3.quantileSorted(logs, 0.02) || 0,
        hi: d3.quantileSorted(logs, 0.995) || 1,
      };
    if (!bounds) groups.set(key, out);
    return out;
  }
  function activeCutoff() {
    return S.replay && S.anchor !== null
      ? Math.min(CUT, Math.floor(S.anchor / stepT()) * stepT())
      : CUT;
  }
  function getColors() {
    const probe = document.createElement("span");
    root.append(probe);
    for (const key of [
      "bg",
      "surface",
      "panel",
      "ink",
      "muted",
      "line",
      "volume",
      "buy",
      "sell",
      "poc",
      "evidence",
    ]) {
      probe.style.color = `var(--ol-${key})`;
      colors[key] = getComputedStyle(probe).color;
    }
    probe.remove();
  }
  function requestDraw() {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
  }
  function geometry() {
    const rect = canvas.getBoundingClientRect(),
      width = rect.width,
      height = rect.height,
      dpr = devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const profile = width > 470 ? 79 : 52;
    G = {
      width,
      height,
      x: 61,
      y: 12,
      w: width - 61 - profile - 12,
      h: height - 90,
      profile,
    };
    G.X = d3
      .scaleLinear()
      .domain([S.tA, S.tB])
      .range([G.x, G.x + G.w]);
    G.Y = d3
      .scaleLinear()
      .domain([S.pA, S.pB])
      .range([G.y + G.h, G.y]);
  }
  function text(s, x, y, color = colors.muted, align = "left", size = 11) {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.font = `${size}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    ctx.fillText(s, x, y);
  }
  function line(x1, y1, x2, y2, color, width = 1, alpha = 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function grid() {
    const ts = stepT(),
      ps = stepP();
    let dt = ts,
      dp = ps;
    while ((dt / (S.tB - S.tA)) * G.w < 8) dt *= 2;
    while ((dp / (S.pB - S.pA)) * G.h < 8) dp *= 2;
    for (let t = Math.ceil(S.tA / dt) * dt; t <= S.tB; t += dt)
      line(G.X(t), G.y, G.X(t), G.y + G.h, colors.line, 0.6, design.grid);
    for (let p = Math.ceil(S.pA / dp) * dp; p <= S.pB; p += dp)
      line(G.x, G.Y(p), G.x + G.w, G.Y(p), colors.line, 0.6, design.grid);
  }
  function axes() {
    ctx.globalAlpha = 1;
    const pt = d3.ticks(
      S.pA * PR,
      S.pB * PR,
      Math.max(3, Math.floor(G.h / 56)),
    );
    for (const p of pt)
      text(price(p), G.x - 8, G.Y(p / PR), colors.muted, "right");
    const count = G.width < 400 ? 3 : G.width < 650 ? 4 : 5;
    const times = d3
      .scaleUtc()
      .domain([date(S.tA), date(S.tB)])
      .ticks(count);
    for (let i = 0; i < times.length; i++) {
      const d = times[i],
        b = (+d / 1000 - T0) / BASE,
        x = G.X(b);
      if (x < G.x + 7 || x > G.x + G.w - 7) continue;
      const span = (S.tB - S.tA) * BASE,
        fmt =
          span > 120 * 86400
            ? d3.utcFormat("%b %Y")
            : span > 2 * 86400
              ? d3.utcFormat("%d %b")
              : d3.utcFormat("%H:%M");
      text(fmt(d), x, G.y + G.h + 15, colors.muted, "center");
    }
    line(G.x, G.y + G.h, G.x + G.w, G.y + G.h, colors.line);
    text("TIME · UTC", G.x + G.w / 2, G.height - 7, colors.muted, "center", 10);
  }
  function draw() {
    if (!ready) return;
    geometry();
    const src = displaySource(),
      cut = activeCutoff(),
      full = aggregate(
        src,
        renderN(),
        renderM(),
        S.replay ? [src.col0 * 2 ** src.n, cut, 0, Infinity] : null,
      ),
      b = bounds(),
      query = aggregate(src, renderN(), renderM(), b),
      ts = stepT(),
      ps = stepP(),
      u = transition
        ? clamp((performance.now() - transition.start) / 170, 0, 1)
        : 1;
    prepareMeasures(full, query, b);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, G.width, G.height);
    ctx.fillStyle = colors.surface;
    ctx.fillRect(G.x, G.y, G.w, G.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(G.x, G.y, G.w, G.h);
    ctx.clip();
    paintCoverage(b);
    grid();
    if (S.selection) {
      ctx.globalAlpha = 0.25;
      for (const z of full.cells) fillCell(z, full, u);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    const x1 = G.X(b[0]),
      x2 = G.X(b[1]),
      y1 = G.Y(b[3]),
      y2 = G.Y(b[2]);
    ctx.beginPath();
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    ctx.clip();
    for (const z of query.cells) fillCell(z, full, u);
    ctx.restore();
    markings(query, cut);
    paintUnfinished(query);
    if (S.tab === "evidence") {
      const ev = calcEvidence();
      drawCone(ev);
      evidenceUI(ev);
    }
    if (S.selection) {
      ctx.strokeStyle = colors.volume;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        G.X(b[0]),
        G.Y(b[3]),
        G.X(b[1]) - G.X(b[0]),
        G.Y(b[2]) - G.Y(b[3]),
      );
    }
    const xc = G.X(cut);
    if (xc >= G.x && xc <= G.x + G.w) {
      line(xc, G.y, xc, G.y + G.h, colors.muted, 1, 0.7);
      if (xc < G.x + G.w - 50)
        text(
          S.replay ? "REPLAY" : "CUTOFF",
          xc + 6,
          G.y + 10,
          colors.muted,
          "left",
          9,
        );
    }
    if (S.anchor !== null && !S.replay) {
      const x = G.X(Math.floor(S.anchor / ts) * ts);
      ctx.setLineDash([3, 4]);
      line(x, G.y, x, G.y + G.h, colors.evidence, 1, 0.65);
      ctx.setLineDash([]);
    }
    if (hover && hover.t < cut) {
      line(G.X(hover.t), G.y, G.X(hover.t), G.y + G.h, colors.muted, 1, 0.35);
      line(G.x, G.Y(hover.p), G.x + G.w, G.Y(hover.p), colors.muted, 1, 0.2);
      const z = query.map.get(
        Math.floor(hover.t / ts) + "," + Math.floor(hover.p / ps),
      );
      if (z) {
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          G.X(z.c * ts),
          G.Y((z.r + 1) * ps),
          G.X((z.c + 1) * ts) - G.X(z.c * ts),
          G.Y(z.r * ps) - G.Y((z.r + 1) * ps),
        );
      }
    }
    drawResolutionLens();
    ctx.restore();
    axes();
    profile(query, b);
    activity(query, cut);
    querySummary(query, b);
    el("legend-text").textContent = legendText(full);
    el("ramp").style.background = legendRamp();
    const marks = marksReadout(b);
    el("ray-count").textContent = S.untested
      ? marks.rayCount + " untested levels"
      : "";
    el("va-value").textContent =
      marks.vaLow === null
        ? "—"
        : price(marks.vaLow) + "–" + price(marks.vaHigh);
    last = { full, query, b, cut };
    if (transition) {
      if (u >= 1) transition = null;
      else requestDraw();
    }
  }
  function at(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      t: G.X.invert(e.clientX - r.left),
      p: G.Y.invert(e.clientY - r.top),
    };
  }
  function inPlot(p) {
    return p.x >= G.x && p.x <= G.x + G.w && p.y >= G.y && p.y <= G.y + G.h;
  }
  const loadState = {
    recent: "loading",
    reference: "loading",
    overview: "loading",
  };
  let referenceView = null,
    tablePage = 0,
    tableKey = "",
    copyFallbackActive = false;
  function renderN() {
    return Math.max(S.n, sources[S.dataset]?.n || 0);
  }
  function renderM() {
    return Math.max(S.m, sources[S.dataset]?.m || 0);
  }
  function displaySource() {
    return S.dataset === "reference" && referenceView
      ? referenceView
      : sources[S.dataset];
  }
  function rebuildReference() {
    if (!sources.reference || !sources.recent) return;
    const r = sources.reference,
      z = sources.recent,
      tail = aggregate(z, r.n, r.m).cells.filter((c) => c.c >= r.col1);
    referenceView = {
      ...r,
      id: "reference-with-tail",
      cells: r.cells.concat(tail),
      b1: z.b1,
      col1: Math.ceil(z.b1 / 2 ** r.n),
    };
    groups.clear();
    evidenceCache.clear();
  }
  function chooseSource() {
    const target = S.selection || [S.tA, S.tB],
      start = Math.max(0, target[0]),
      end = Math.min(CUT, target[1]);
    let candidates = Object.values(sources).filter(
      (s) => s.b0 <= start && s.b1 >= end - 2 ** s.n,
    );
    candidates.sort((a, b) => a.n - b.n || a.m - b.m);
    if (candidates.length) S.dataset = candidates[0].id;
    else if (!sources[S.dataset]) S.dataset = Object.keys(sources)[0];
    return sources[S.dataset];
  }
  function limits() {
    S.n = clamp(Math.round(S.n), 0, N_MAX);
    S.m = clamp(Math.round(S.m), 0, M_MAX);
    S.horizon = [1, 2, 4, 8].includes(S.horizon) ? S.horizon : 1;
  }
  function requestedBounds() {
    const b = S.selection || [S.tA, Math.min(S.tB, activeCutoff()), S.pA, S.pB];
    const r = [
      Math.max(0, Math.floor(b[0] + 0.5)),
      Math.min(activeCutoff(), Math.floor(b[1] + 0.5)),
      Math.max(0, Math.floor(b[2] + 0.5)),
      Math.max(0, Math.floor(b[3] + 0.5)),
    ];
    r[1] = Math.max(r[0], r[1]);
    r[3] = Math.max(r[2], r[3]);
    return r;
  }
  function bounds() {
    const src = displaySource(),
      r = requestedBounds(),
      ts = 2 ** src.n,
      ps = 2 ** src.m,
      end = Math.min(src.b1, activeCutoff());
    let a = Math.max(src.b0, Math.ceil(r[0] / ts) * ts),
      b = r[1] >= end ? end : Math.floor(r[1] / ts) * ts;
    a = Math.min(a, end);
    b = Math.max(a, Math.min(end, b));
    const p = Math.ceil(r[2] / ps) * ps,
      q = Math.max(p, Math.floor(r[3] / ps) * ps);
    return [a, b, p, q];
  }
  function fit() {
    const src = displaySource();
    if (!src) return;
    const ts = 2 ** src.n,
      ps = 2 ** src.m;
    let low = Infinity,
      high = -Infinity;
    for (const c of src.cells) {
      if (c.c * ts >= Math.min(S.tB, activeCutoff()) || (c.c + 1) * ts <= S.tA)
        continue;
      low = Math.min(low, c.r * ps);
      high = Math.max(high, (c.r + 1) * ps);
    }
    if (!Number.isFinite(low)) return;
    const pad = Math.max(2 * ps, Math.ceil(((high - low) * 0.1) / ps) * ps);
    S.pA = Math.max(0, low - pad);
    S.pB = high + pad;
  }
  function setWindow(w) {
    S.window = w;
    S.selection = null;
    S.anchor = null;
    S.replay = false;
    S.tA = w === "all" ? 0 : Math.max(0, CUT - (Number(w) * 86400) / BASE);
    S.tB = CUT + (CUT - S.tA) * 0.105;
    chooseSource();
    S.n = w === "all" ? 14 : w === "7" ? 6 : 4;
    S.m = w === "all" ? 3 : 0;
    fit();
    limits();
    if (S.auto && G.w) autoLevel();
    hover = null;
    el("tip").hidden = true;
  }
  function cubeQuery() {
    const b = requestedBounds();
    return {
      t1: iso(b[0]),
      t2: iso(b[1]),
      p1: b[2] * PR,
      p2: b[3] * PR,
      tR: BASE * 2 ** S.n,
      pR: PR * 2 ** S.m,
    };
  }
  function save() {
    if (!window.explorerState) return;
    try {
      window.explorerState.save({
        version: 4,
        ...S,
        crumbs: nav.crumbs,
        crumbIndex: nav.crumbIndex,
      });
    } catch (error) {
      el("copy-status").textContent =
        "View retained here; persistence unavailable.";
    }
  }
  function restore(x) {
    if (!x || x.version !== 4) return false;
    for (const k of [
      "n",
      "m",
      "tA",
      "tB",
      "pA",
      "pB",
      "horizon",
      "barrier",
      "lensDepth",
    ])
      if (Number.isFinite(x[k])) S[k] = x[k];
    for (const k of [
      "poc",
      "area",
      "untested",
      "replay",
      "select",
      "auto",
      "coupled",
      "diagonal",
      "refit",
      "lens",
      "table",
    ])
      if (typeof x[k] === "boolean") S[k] = x[k];
    if (Array.isArray(x.crumbs)) {
      nav.crumbs = x.crumbs
        .filter(
          (c) =>
            c &&
            typeof c.label === "string" &&
            c.state &&
            ["tA", "tB", "pA", "pB", "n", "m"].every((k) =>
              Number.isFinite(c.state[k]),
            ),
        )
        .slice(-8)
        .map((c) => ({ ...c, key: navSnapshotKey(c.state) }));
      nav.crumbIndex = clamp(
        Number.isInteger(x.crumbIndex) ? x.crumbIndex : nav.crumbs.length - 1,
        -1,
        nav.crumbs.length - 1,
      );
      renderCrumbs();
    }
    if (["volume", "flow", "geometry", "density", "delta"].includes(x.mode))
      S.mode = x.mode;
    if (["context", "evidence"].includes(x.tab)) S.tab = x.tab;
    if (["poc", "barrier"].includes(x.evidenceKind))
      S.evidenceKind = x.evidenceKind;
    S.window = x.window || "";
    S.anchor = Number.isFinite(x.anchor) ? x.anchor : null;
    S.selection =
      Array.isArray(x.selection) &&
      x.selection.length === 4 &&
      x.selection.every(Number.isFinite)
        ? x.selection
        : null;
    limits();
    chooseSource();
    return true;
  }
  function queryUI(b) {
    const q = cubeQuery();
    if (!copyFallbackActive)
      el("query-text").value = JSON.stringify(q, null, 2);
    el("query-mini").textContent = ` · ${dur(q.tR)} × ${price(q.pR)} USDT`;
    const changed =
      b.some((x, i) => x !== requestedBounds()[i]) ||
      renderN() !== S.n ||
      renderM() !== S.m;
    el("query-ready").textContent = changed
      ? `Rendered coverage: ${iso(b[0])} → ${iso(b[1])}; ${price(b[2] * PR)}–${price(b[3] * PR)} USDT; ${dur(BASE * stepT())} × ${price(PR * stepP())} USDT. Finer bounds remain unavailable in this snapshot.`
      : "The rendered rectangle matches these six parameters.";
  }
  async function copyText(textToCopy, label) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      copyFallbackActive = false;
      el("copy-status").textContent = label + " copied";
    } catch (error) {
      copyFallbackActive = true;
      el("query-text").value = textToCopy;
      el("query-panel").open = true;
      el("query-text").focus();
      el("query-text").select();
      el("copy-status").textContent = "Selected for copy · ⌘C / Ctrl+C";
    }
  }
  function applyImportedView() {
    try {
      let raw = el("import-text").value.trim();
      if (raw.startsWith("origo-cube:"))
        raw = decodeURIComponent(raw.slice(11));
      const obj = JSON.parse(raw),
        q = obj.query || obj;
      const n = Math.log2(Number(q.tR) / BASE),
        m = Math.log2(Number(q.pR) / PR),
        a = (Date.parse(q.t1) / 1000 - T0) / BASE,
        b = (Date.parse(q.t2) / 1000 - T0) / BASE,
        p = Number(q.p1) / PR,
        r = Number(q.p2) / PR;
      if (
        ![a, b, p, r, n, m].every(Number.isFinite) ||
        !Number.isInteger(n) ||
        !Number.isInteger(m) ||
        n < 0 ||
        m < 0 ||
        b <= a ||
        r <= p ||
        a < 0 ||
        b > CUT ||
        p < 0
      )
        throw Error(
          "Use ordered bounds inside this snapshot and dyadic resolutions.",
        );
      S.auto = false;
      S.n = n;
      S.m = m;
      if (S.diagonal && m !== diagonalM(n)) S.diagonal = false;
      S.selection = [
        Math.floor(a + 0.5),
        Math.floor(b + 0.5),
        Math.floor(p + 0.5),
        Math.floor(r + 0.5),
      ];
      [S.tA, S.tB, S.pA, S.pB] = S.selection;
      S.window = "";
      S.replay = false;
      S.anchor = null;
      if (obj.view) {
        const v = obj.view;
        if (["volume", "flow", "geometry", "delta", "density"].includes(v.mode))
          S.mode = v.mode;
        for (const k of ["poc", "area", "untested", "replay"])
          if (typeof v[k] === "boolean") S[k] = v[k];
        if (["context", "evidence"].includes(v.tab)) S.tab = v.tab;
        if (["poc", "barrier"].includes(v.evidenceKind))
          S.evidenceKind = v.evidenceKind;
        if ([1, 2, 4, 8].includes(v.horizon)) S.horizon = v.horizon;
        if ([1, 2, 4].includes(v.barrier)) S.barrier = v.barrier;
        if (Number.isFinite(v.anchor) && v.anchor > 0 && v.anchor <= CUT)
          S.anchor = v.anchor;
        const z = v.viewport;
        if (
          Array.isArray(z) &&
          z.length === 4 &&
          z.every(Number.isFinite) &&
          z[0] >= 0 &&
          z[1] > z[0] &&
          z[2] >= 0 &&
          z[3] > z[2]
        )
          [S.tA, S.tB, S.pA, S.pB] = z;
      }
      chooseSource();
      limits();
      recordCrumb("Restored query");
      update();
      save();
      el("copy-status").textContent = "View restored";
      el("import").hidden = true;
    } catch (error) {
      el("copy-status").textContent = error.message;
    }
  }
  function hatchRect(x, y, w, h, color, spacing = 10, alpha = 0.22) {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let k = -h; k < w; k += spacing)
      line(x + k, y + h, x + k + h, y, color, 1, alpha);
    ctx.restore();
  }
  function paintCoverage(b) {
    const src = displaySource(),
      cut = activeCutoff(),
      x0 = clamp(G.X(src.b0), G.x, G.x + G.w),
      xc = clamp(G.X(Math.min(src.b1, cut)), G.x, G.x + G.w);
    hatchRect(G.x, G.y, x0 - G.x, G.h, colors.line, 11, 0.6);
    hatchRect(xc, G.y, G.x + G.w - xc, G.h, colors.line, 11, 0.45);
    if (x0 - G.x > 75)
      text(
        Object.values(loadState).includes("loading")
          ? "LOADING HISTORY"
          : "UNAVAILABLE",
        G.x + 8,
        G.y + 16,
        colors.muted,
        "left",
        10,
      );
    if (G.x + G.w - xc > 70)
      text(
        S.replay ? "FUTURE HIDDEN" : "UNAVAILABLE",
        xc + 8,
        G.y + G.h - 12,
        colors.muted,
        "left",
        9,
      );
    const r = requestedBounds();
    if (b[0] > r[0])
      hatchRect(
        Math.max(G.x, G.X(r[0])),
        G.y,
        G.X(b[0]) - Math.max(G.x, G.X(r[0])),
        G.h,
        colors.poc,
        5,
        0.35,
      );
    if (b[1] < r[1])
      hatchRect(
        G.X(b[1]),
        G.y,
        Math.min(G.x + G.w, G.X(r[1])) - G.X(b[1]),
        G.h,
        colors.poc,
        5,
        0.35,
      );
    if (b[2] > r[2])
      hatchRect(
        G.X(b[0]),
        G.Y(b[2]),
        G.X(b[1]) - G.X(b[0]),
        G.Y(r[2]) - G.Y(b[2]),
        colors.poc,
        5,
        0.35,
      );
    if (b[3] < r[3])
      hatchRect(
        G.X(b[0]),
        G.Y(r[3]),
        G.X(b[1]) - G.X(b[0]),
        G.Y(b[3]) - G.Y(r[3]),
        colors.poc,
        5,
        0.35,
      );
  }
  function paintUnfinished(query) {
    const cut = activeCutoff(),
      ts = stepT(),
      c = Math.floor(cut / ts);
    if (!S.replay && cut % ts !== 0) {
      const xa = Math.max(G.x, G.X(c * ts)),
        xb = Math.min(G.x + G.w, G.X(cut));
      hatchRect(xa, G.y, xb - xa, G.h, colors.poc, 7, 0.25);
      if (xb > G.x && xa < G.x + G.w) {
        line(xa, G.y, xb, G.y, colors.poc, 3, 0.8);
        text(
          "OPEN",
          clamp(xa + 3, G.x + 4, G.x + G.w - 32),
          G.y + 29,
          colors.poc,
          "left",
          9,
        );
      }
    }
    if (renderN() > S.n || renderM() > S.m) {
      for (const z of query.cells) {
        const x = G.X(z.c * ts),
          y = G.Y((z.r + 1) * stepP()),
          w = G.X((z.c + 1) * ts) - x,
          h = G.Y(z.r * stepP()) - y;
        if (w > 6 && h > 6)
          line(x + 1, y + 6, x + 6, y + 1, colors.poc, 1, 0.65);
      }
    }
  }
  function querySummary(query, b) {
    const requested = requestedBounds(),
      partialCoverage = b.some((x, i) => x !== requested[i]);
    el("focus-title").textContent = partialCoverage
      ? "Ready portion"
      : S.selection
        ? "Selected rectangle"
        : "Visible rectangle";
    el("bounds").textContent =
      `${stamp(b[0])} → ${stamp(b[1])} UTC · ${price(b[2] * PR)}–${price(b[3] * PR)} USDT`;
    for (const [id, v, exact] of [
      ["vol", query.v, usdt(query.v) + " USDT"],
      ["count", query.ct, integer(query.ct) + " trades"],
      ["buyvol", query.bv, usdt(query.bv) + " USDT"],
      ["buycount", query.bt, integer(query.bt) + " trades"],
    ]) {
      el(id).textContent = compact(v);
      el(id).setAttribute("aria-label", exact);
      el(id).title = exact;
    }
    el("poc-value").textContent =
      query.poc === null ? "—" : price((query.poc + 0.5) * stepP() * PR);
    el("buypoc-value").textContent =
      query.bpoc === null ? "—" : price((query.bpoc + 0.5) * stepP() * PR);
    el("share").textContent = query.v
      ? ((100 * query.bv) / query.v).toFixed(1) + "%"
      : "—";
    el("delta-value").textContent =
      (2 * query.bv - query.v >= 0 ? "+" : "−") +
      compact(Math.abs(2 * query.bv - query.v)) +
      " USDT";
    el("cells").textContent = integer(query.cells.length);
    let partials = 0,
      unfinished = 0;
    for (const c of query.cells) {
      if (
        c.c * stepT() < b[0] ||
        (c.c + 1) * stepT() > b[1] ||
        c.r * stepP() < b[2] ||
        (c.r + 1) * stepP() > b[3]
      )
        partials++;
      if (!S.replay && c.c * stepT() < CUT && (c.c + 1) * stepT() > CUT)
        unfinished++;
    }
    el("partials").textContent = integer(partials);
    const rows = Math.max(
        0,
        Math.ceil(b[3] / stepP()) - Math.floor(b[2] / stepP()),
      ),
      total =
        b[1] <= b[0] || b[3] <= b[2]
          ? 0
          : Math.max(
              0,
              Math.ceil(b[1] / stepT()) - Math.floor(b[0] / stepT()),
            ) * rows,
      openRows =
        total > 0 && !S.replay && CUT % stepT() !== 0 && b[1] === CUT
          ? rows
          : 0,
      zero = Math.max(0, total - query.cells.length - openRows + unfinished);
    el("open-count").textContent = integer(openRows);
    el("zero-count").textContent = integer(zero);
    el("data-zero").textContent = `${integer(zero)} completed zero-trade`;
    el("data-open").textContent = `${integer(openRows)} unfinished`;
    el("data-coarse").hidden = !(renderN() > S.n || renderM() > S.m);
    el("resolution-state").textContent =
      renderN() > S.n || renderM() > S.m
        ? `Requested ${dur(BASE * 2 ** S.n)} × ${price(PR * 2 ** S.m)} · rendered ${dur(BASE * stepT())} × ${price(PR * stepP())} USDT`
        : `${((G.w * stepT()) / (S.tB - S.tA)).toFixed(1)} × ${((G.h * stepP()) / (S.pB - S.pA)).toFixed(1)} px per cell · n ${renderN()} / m ${renderM()}`;
    queryUI(b);
    renderTable(query, b);
  }
  function renderTable(query, b) {
    if (!S.table) return;
    const key = [S.n, S.m, b.join(","), S.mode].join("|");
    if (key !== tableKey) {
      tablePage = 0;
      tableKey = key;
    }
    const cells = query.cells.slice().sort((a, b) => b.c - a.c || a.r - b.r),
      pages = Math.max(1, Math.ceil(cells.length / 10));
    tablePage = clamp(tablePage, 0, pages - 1);
    const frag = document.createDocumentFragment();
    for (const c of cells.slice(tablePage * 10, tablePage * 10 + 10)) {
      const tr = document.createElement("tr"),
        open = !S.replay && (c.c + 1) * stepT() > CUT,
        portion =
          c.c * stepT() < b[0] ||
          (c.c + 1) * stepT() > b[1] ||
          c.r * stepP() < b[2] ||
          (c.r + 1) * stepP() > b[3];
      const values = [
        stamp(Math.max(c.c * stepT(), b[0])) +
          " → " +
          stamp(Math.min((c.c + 1) * stepT(), b[1])),
        price(Math.max(c.r * stepP(), b[2]) * PR) +
          "–" +
          price(Math.min((c.r + 1) * stepP(), b[3]) * PR),
        usdt(c.v),
        integer(c.ct),
        usdt(c.bv),
        integer(c.bt),
        [open ? "unfinished" : "complete", portion ? "portion" : ""]
          .filter(Boolean)
          .join(" · "),
      ];
      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      frag.append(tr);
    }
    el("table-body").replaceChildren(frag);
    el("table-caption").textContent =
      `${integer(cells.length)} occupied cells · newest first · zero cells omitted`;
    el("table-page").textContent = `${tablePage + 1} / ${pages}`;
    el("table-back").disabled = tablePage === 0;
    el("table-next").disabled = tablePage === pages - 1;
  }
  function tooltip(p) {
    hover = p;
    const tip = el("tip");
    if (!last || !inPlot(p)) {
      tip.hidden = true;
      requestDraw();
      return;
    }
    const c = Math.floor(p.t / stepT()),
      r = Math.floor(p.p / stepP()),
      z = last.query.map.get(c + "," + r),
      src = displaySource(),
      inside =
        p.t >= last.b[0] &&
        p.t < last.b[1] &&
        p.p >= last.b[2] &&
        p.p < last.b[3],
      unavailable =
        p.t < src.b0 || p.t >= Math.min(src.b1, last.cut) || !inside;
    const open = !S.replay && c * stepT() < CUT && (c + 1) * stepT() > CUT;
    let rows = [
      `${stamp(c * stepT())} UTC`,
      `${price(r * stepP() * PR)}–${price((r + 1) * stepP() * PR)} USDT`,
    ];
    if (unavailable)
      rows.push(
        S.replay && p.t >= last.cut
          ? "Future hidden in replay"
          : S.selection
            ? "Outside selected coverage"
            : "Unavailable at requested bounds",
      );
    else if (!z)
      rows.push(
        open ? "Unfinished · no accepted trades" : "Zero trades · covered cell",
      );
    else
      rows.push(
        `${usdt(z.v)} USDT · ${integer(z.ct)} trades`,
        `Buy ${usdt(z.bv)} USDT · ${integer(z.bt)} trades`,
        `Δ ${usdt(2 * z.bv - z.v)} USDT · ${((z.bv / z.v) * 100).toFixed(1)}% buy`,
        open ? "Unfinished cell" : "Completed source coverage",
      );
    if (renderN() > S.n || renderM() > S.m) rows.push("Coarser than requested");
    tip.replaceChildren(
      ...rows.map((t) => {
        const d = document.createElement("div");
        d.textContent = t;
        return d;
      }),
    );
    tip.hidden = false;
    const field = root.querySelector(".ol-field"),
      fr = field.getBoundingClientRect(),
      cr = canvas.getBoundingClientRect(),
      tw = tip.offsetWidth;
    tip.style.left = clamp(p.x + 17, 4, fr.width - tw - 5) + "px";
    tip.style.top =
      clamp(
        p.y + cr.top - fr.top - tip.offsetHeight - 12,
        30,
        fr.height - tip.offsetHeight - 5,
      ) + "px";
    requestDraw();
  }
  function update() {
    if (!ready) return;
    limits();
    chooseSource();
    if (S.auto) autoLevel();
    el("n").textContent = "n " + S.n;
    el("m").textContent = "m " + S.m;
    el("tr").textContent = dur(BASE * 2 ** S.n);
    el("pr").textContent = price(PR * 2 ** S.m) + " USDT";
    el("tminus").disabled = S.n === 0;
    el("tplus").disabled = S.n === N_MAX;
    el("pminus").disabled = S.m === 0;
    el("pplus").disabled = S.m === M_MAX;
    qsa("[data-window]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.window === S.window)),
    );
    qsa("[data-mode]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)),
    );
    for (const f of ["poc", "area", "untested"]) el(f).checked = S[f];
    el("select").setAttribute("aria-pressed", String(S.select));
    el("clear").hidden = !S.selection;
    for (const t of ["context", "evidence"]) {
      el(t + "-tab").setAttribute("aria-pressed", String(S.tab === t));
      el(t).hidden = S.tab !== t;
    }
    el("replay").setAttribute("aria-pressed", String(S.replay));
    el("back").hidden = el("next").hidden = el("replay-at").hidden = !S.replay;
    el("replay-at").textContent = S.replay ? dateShort(activeCutoff()) : "";
    el("horizon").value = S.horizon;
    el("scope").textContent =
      `${Object.keys(sources).length}/${Object.keys(PACK.blocks).length} ${PACK.live ? "live cube" : "recorded"} blocks ready · ${dateShort(displaySource().b0)} onward`;
    el("cutoff").textContent = "Cutoff " + iso(CUT);
    el("table").setAttribute("aria-pressed", String(S.table));
    el("table-section").hidden = !S.table;
    updateNavigation();
    requestDraw();
    requestTile();
  }
  function bindRoot() {
    el("query-text").addEventListener("blur", () => {
      copyFallbackActive = false;
    });
    el("copy-query").addEventListener("click", () =>
      copyText(JSON.stringify(cubeQuery(), null, 2), "Query"),
    );
    el("copy-view").addEventListener("click", () =>
      copyText(
        "origo-cube:" +
          encodeURIComponent(
            JSON.stringify({
              query: cubeQuery(),
              view: {
                mode: S.mode,
                poc: S.poc,
                area: S.area,
                untested: S.untested,
                tab: S.tab,
                replay: S.replay,
                anchor: S.anchor,
                horizon: S.horizon,
                evidenceKind: S.evidenceKind,
                barrier: S.barrier,
                viewport: [S.tA, S.tB, S.pA, S.pB],
              },
            }),
          ),
        "View code",
      ),
    );
    el("import-toggle").addEventListener("click", () => {
      el("import").hidden = !el("import").hidden;
    });
    el("import-apply").addEventListener("click", applyImportedView);
    el("table").addEventListener("click", () => {
      S.table = !S.table;
      update();
      save();
    });
    for (const [id, d] of [
      ["table-back", -1],
      ["table-next", 1],
    ])
      el(id).addEventListener("click", () => {
        tablePage += d;
        requestDraw();
      });
  }

  let markState = {
    metrics: new WeakMap(),
    densityLo: 0,
    densityHi: 1,
    deltaMax: 1,
    va: null,
    rays: [],
  };
  function signedCompact(value) {
    return (value < 0 ? "−" : value > 0 ? "+" : "") + compact(Math.abs(value));
  }
  function densityNumber(value) {
    return value === 0
      ? "0"
      : Math.abs(value) < 0.01
        ? value.toExponential(1)
        : value < 10
          ? value.toFixed(2)
          : compact(value);
  }
  function cellExposure(z, b, ts = stepT(), ps = stepP()) {
    const seconds =
      Math.max(
        0,
        Math.min((z.c + 1) * ts, b[1], activeCutoff()) -
          Math.max(z.c * ts, b[0]),
      ) * BASE;
    const width =
      Math.max(0, Math.min((z.r + 1) * ps, b[3]) - Math.max(z.r * ps, b[2])) *
      PR;
    return { seconds, width, area: seconds * width };
  }
  function contiguousArea(rows, poc, total) {
    if (poc === null || !(total > 0) || !rows.length) return null;
    const values = new Map(rows.map((r) => [r.r, r.v])),
      minimum = rows[0].r,
      maximum = rows[rows.length - 1].r;
    let low = poc,
      high = poc,
      volume = values.get(poc) || 0;
    while (volume < total * 0.7 && (low > minimum || high < maximum)) {
      const down = low > minimum ? values.get(low - 1) || 0 : -1,
        up = high < maximum ? values.get(high + 1) || 0 : -1;
      if (down >= up) {
        low--;
        volume += down;
      } else {
        high++;
        volume += up;
      }
    }
    return { r0: low, r1: high + 1, volume, share: volume / total };
  }
  function prepareMeasures(full, query, b) {
    const src = displaySource(),
      ts = stepT(),
      ps = stepP(),
      sourceBounds = [src.b0, Math.min(src.b1, activeCutoff()), 0, Infinity];
    const metrics = new WeakMap(),
      densities = [],
      deltas = [];
    for (const z of full.cells) {
      const exposure = cellExposure(z, sourceBounds, ts, ps),
        density = exposure.area > 0 ? z.v / exposure.area : 0,
        delta = 2 * z.bv - z.v;
      metrics.set(z, { ...exposure, density, delta });
      if (density > 0) densities.push(Math.log(density));
      if (delta !== 0) deltas.push(Math.abs(delta));
    }
    for (const z of query.cells) {
      const exposure = cellExposure(z, b, ts, ps);
      metrics.set(z, {
        ...exposure,
        density: exposure.area > 0 ? z.v / exposure.area : 0,
        delta: 2 * z.bv - z.v,
      });
    }
    densities.sort((a, b) => a - b);
    deltas.sort((a, b) => a - b);
    markState = {
      metrics,
      densityLo: d3.quantileSorted(densities, 0.02) ?? 0,
      densityHi: d3.quantileSorted(densities, 0.995) ?? 1,
      deltaMax: d3.quantileSorted(deltas, 0.995) || 1,
      va: contiguousArea(query.rows, query.poc, query.v),
      rays: [],
    };
    return markState;
  }
  function legendText(full) {
    if (S.mode === "geometry") return "Occupied cells";
    if (S.mode === "flow") return "Buy share 0% · 50% · 100%";
    if (S.mode === "delta")
      return `Δ ${signedCompact(-markState.deltaMax)} · 0 · ${signedCompact(markState.deltaMax)} USDT`;
    if (S.mode === "density")
      return `${densityNumber(Math.exp(markState.densityLo))}–${densityNumber(Math.exp(markState.densityHi))} USDT/(s·USDT) · log`;
    return `${compact(Math.exp(full.lo))}–${compact(Math.exp(full.hi))} USDT · log`;
  }
  function legendRamp() {
    return S.mode === "flow" || S.mode === "delta"
      ? "linear-gradient(to right,var(--ol-sell),var(--ol-line),var(--ol-buy))"
      : S.mode === "geometry"
        ? "var(--ol-line)"
        : "linear-gradient(to right,var(--ol-panel),var(--ol-volume))";
  }
  function marksReadout(b) {
    const va = markState.va,
      ps = stepP();
    return {
      rayCount: markState.rays.length,
      vaLow: va ? Math.max(va.r0 * ps, b[2]) * PR : null,
      vaHigh: va ? Math.min(va.r1 * ps, b[3]) * PR : null,
    };
  }
  function fillCell(z, full, u) {
    const ts = stepT(),
      ps = stepP(),
      cut = activeCutoff();
    if (z.c * ts >= cut) return;
    let xa = G.X(z.c * ts),
      xb = G.X(Math.min((z.c + 1) * ts, cut)),
      ya = G.Y((z.r + 1) * ps),
      yb = G.Y(z.r * ps);
    if (transition && u < 1) {
      const ot = 2 ** transition.n,
        op = 2 ** transition.m,
        oa = Math.floor((z.c * ts) / ot) * ot,
        ob = Math.floor((z.r * ps) / op) * op;
      xa = G.X(oa) + (xa - G.X(oa)) * u;
      xb = G.X(oa + ot) + (xb - G.X(oa + ot)) * u;
      ya = G.Y(ob + op) + (ya - G.Y(ob + op)) * u;
      yb = G.Y(ob) + (yb - G.Y(ob)) * u;
    }
    if (xb < G.x || xa > G.x + G.w || yb < G.y || ya > G.y + G.h) return;
    const measure = markState.metrics.get(z),
      share = z.v ? z.bv / z.v : 0.5;
    let level = clamp(
        (Math.log(z.v) - full.lo) / Math.max(0.1, full.hi - full.lo),
        0,
        1,
      ),
      hue = colors.volume;
    if (S.mode === "density") {
      const density = measure.density;
      level =
        density > 0
          ? clamp(
              (Math.log(density) - markState.densityLo) /
                Math.max(0.1, markState.densityHi - markState.densityLo),
              0,
              1,
            )
          : 0;
    }
    if (S.mode === "flow") {
      hue = d3.interpolateRgb(
        colors.line,
        share >= 0.5 ? colors.buy : colors.sell,
      )(Math.abs(share - 0.5) * 2);
      level = 0.7;
    }
    if (S.mode === "delta") {
      const delta = 2 * z.bv - z.v;
      hue = delta >= 0 ? colors.buy : colors.sell;
      level = clamp(
        Math.log1p(Math.abs(delta)) / Math.log1p(markState.deltaMax),
        0,
        1,
      );
    }
    if (S.mode === "geometry") {
      const alpha = ctx.globalAlpha;
      ctx.strokeStyle = colors.volume;
      ctx.globalAlpha = alpha * 0.4;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        xa + 0.5,
        ya + 0.5,
        Math.max(0.1, xb - xa - 1),
        Math.max(0.1, yb - ya - 1),
      );
      ctx.globalAlpha = alpha;
    } else {
      ctx.fillStyle = d3.interpolateRgb(
        colors.surface,
        hue,
      )(S.mode === "delta" ? level : 0.2 + 0.8 * level);
      const gap = xb - xa > 4 && yb - ya > 4 ? design.gap : 0;
      ctx.fillRect(
        xa + gap / 2,
        ya + gap / 2,
        Math.max(0.1, xb - xa - gap),
        Math.max(0.1, yb - ya - gap),
      );
    }
  }
  function markLine(x1, y1, x2, y2, color, width = 1, alpha = 1) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
  function profile(query, b) {
    if (!G.profile) return;
    const max = d3.max(query.rows, (z) => z.v) || 1,
      px = G.x + G.w + 9,
      pw = G.profile - 29,
      ps = stepP(),
      va = markState.va,
      labels = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, G.y, G.profile - 8, G.h);
    ctx.clip();
    if (S.area && va) {
      const ya = G.Y(Math.min(va.r1 * ps, b[3])),
        yb = G.Y(Math.max(va.r0 * ps, b[2]));
      ctx.fillStyle = colors.volume;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(px, ya, pw, yb - ya);
      ctx.globalAlpha = 1;
    }
    for (const row of query.rows) {
      const ya = G.Y(Math.min((row.r + 1) * ps, b[3])),
        yb = G.Y(Math.max(row.r * ps, b[2]));
      if (yb <= ya) continue;
      ctx.fillStyle = S.poc && row.r === query.poc ? colors.poc : colors.muted;
      ctx.globalAlpha = S.poc && row.r === query.poc ? 0.75 : 0.32;
      ctx.fillRect(px, ya, (pw * row.v) / max, Math.max(0.1, yb - ya - 0.7));
      ctx.fillStyle = colors.buy;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(
        px,
        ya,
        (pw * row.bv) / max,
        Math.max(0.7, Math.min(2, (yb - ya) * 0.3)),
      );
    }
    ctx.globalAlpha = 1;
    if (S.area && va) {
      const high = G.Y(Math.min(va.r1 * ps, b[3])),
        low = G.Y(Math.max(va.r0 * ps, b[2]));
      markLine(px + pw + 2, high, px + pw + 2, low, colors.muted, 1, 0.6);
      markLine(px, high, px + pw + 3, high, colors.muted, 1, 0.6);
      markLine(px, low, px + pw + 3, low, colors.muted, 1, 0.6);
      labels.push(
        { symbol: "H", y: high, color: colors.muted },
        { symbol: "L", y: low, color: colors.muted },
      );
    }
    if (S.poc) {
      for (const [row, symbol, color] of [
        [query.poc, "P", colors.poc],
        [query.bpoc, "B", colors.buy],
      ]) {
        if (row === null) continue;
        const y = G.Y((row + 0.5) * ps);
        markLine(px, y, px + pw + 3, y, color, 1.5, 0.95);
        labels.push({ symbol, y, color });
      }
    }
    const visible = labels
      .filter((x) => x.y >= G.y && x.y <= G.y + G.h)
      .sort((a, b) => a.y - b.y);
    for (let i = 0; i < visible.length; i++)
      visible[i].ly = Math.max(
        G.y + 7,
        visible[i].y,
        i ? visible[i - 1].ly + 13 : G.y + 7,
      );
    if (visible.length && visible.at(-1).ly > G.y + G.h - 7) {
      visible.at(-1).ly = G.y + G.h - 7;
      for (let i = visible.length - 2; i >= 0; i--)
        visible[i].ly = Math.min(visible[i].ly, visible[i + 1].ly - 13);
    }
    for (const label of visible) {
      markLine(
        px + pw + 3,
        label.y,
        px + pw + 7,
        label.ly,
        label.color,
        1,
        0.7,
      );
      text(label.symbol, px + pw + 9, label.ly, colors.ink, "left", 11);
    }
    ctx.restore();
    text(
      S.selection ? "SELECTED" : "PROFILE",
      px,
      G.y - 5,
      colors.muted,
      "left",
      9,
    );
  }
  function markings(full, cut) {
    const ts = stepT(),
      ps = stepP(),
      b = bounds(),
      visibleEnd = Math.min(S.tB, cut, b[1]);
    const cols = full.cols.filter(
      (c) => (c.c + 1) * ts > S.tA && c.c * ts < visibleEnd,
    );
    ctx.save();
    if (S.area) {
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      for (const c of cols) {
        const va = contiguousArea(c.rows, c.poc, c.v);
        if (!va) continue;
        const xa = G.X(Math.max(c.c * ts, b[0])),
          xb = G.X(Math.min((c.c + 1) * ts, visibleEnd)),
          ya = G.Y(Math.min(va.r1 * ps, b[3])),
          yb = G.Y(Math.max(va.r0 * ps, b[2]));
        if (xb > xa && yb > ya)
          ctx.strokeRect(
            xa + 0.5,
            ya + 0.5,
            Math.max(0.1, xb - xa - 1),
            Math.max(0.1, yb - ya - 1),
          );
      }
      ctx.globalAlpha = 1;
    }
    const seen = new Set(),
      rays = [];
    for (let j = full.cols.length - 1; j >= 0; j--) {
      const c = full.cols[j];
      if (c.c * ts >= visibleEnd) continue;
      const completed = c.c * ts >= b[0] && (c.c + 1) * ts <= visibleEnd;
      if (completed && c.poc !== null && !seen.has(c.poc) && c.c * ts >= S.tA) {
        const y = G.Y((c.poc + 0.5) * ps);
        if (y >= G.y && y <= G.y + G.h)
          rays.push({
            c: c.c,
            r: c.poc,
            price: (c.poc + 0.5) * ps * PR,
            from: (c.c + 1) * ts,
            to: visibleEnd,
          });
      }
      for (const row of c.rows) seen.add(row.r);
    }
    markState.rays = rays;
    if (S.untested) {
      ctx.setLineDash([]);
      for (const ray of rays) {
        const y = G.Y((ray.r + 0.5) * ps),
          x = G.X(ray.from);
        markLine(x, y, G.X(ray.to), y, colors.poc, 1, 0.36);
        ctx.fillStyle = colors.poc;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(x - 1, y - 1, 2, 2);
        ctx.globalAlpha = 1;
      }
    }
    if (S.poc) {
      ctx.beginPath();
      let prev = null;
      for (const c of cols) {
        if (c.poc === null) continue;
        const a = Math.max(c.c * ts, b[0]),
          z = Math.min((c.c + 1) * ts, visibleEnd);
        if (z <= a) continue;
        const x = G.X((a + z) / 2),
          y = G.Y((c.poc + 0.5) * ps);
        if (prev === null || c.c !== prev + 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        prev = c.c;
      }
      ctx.strokeStyle = colors.poc;
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }
    ctx.restore();
  }
  function activity(full, cut) {
    const ts = stepT(),
      b = bounds(),
      cols = full.cols.filter(
        (c) => (c.c + 1) * ts > S.tA && c.c * ts < S.tB && c.c * ts < cut,
      ),
      signed = S.mode === "delta" || S.mode === "flow";
    const value = (c) => (signed ? 2 * c.bv - c.v : c.v),
      max = d3.max(cols, (c) => Math.abs(value(c))) || 1,
      top = G.y + G.h + 32,
      h = 25,
      zero = signed ? top + h / 2 : top + h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(G.x, top, G.w, h);
    ctx.clip();
    if (signed) markLine(G.x, zero, G.x + G.w, zero, colors.line, 1, 0.9);
    for (const c of cols) {
      const xa = G.X(Math.max(c.c * ts, b[0])),
        xb = G.X(Math.min((c.c + 1) * ts, cut, b[1]));
      if (xb <= xa) continue;
      const v = value(c),
        bh = (Math.abs(v) / max) * (signed ? h / 2 : h),
        y = signed ? (v >= 0 ? zero - bh : zero) : zero - bh;
      ctx.fillStyle = signed
        ? v >= 0
          ? colors.buy
          : colors.sell
        : colors.volume;
      ctx.globalAlpha = 0.65;
      ctx.fillRect(xa, y, Math.max(0.1, xb - xa - 0.7), bh);
    }
    ctx.restore();
    text(
      signed ? "Δ USDT" : "USDT",
      G.x - 8,
      top + 4,
      colors.muted,
      "right",
      10,
    );
    text(
      (signed ? "±" : "") + compact(max),
      G.x - 8,
      top + 18,
      colors.muted,
      "right",
      10,
    );
  }

  function evidenceColumns(n, m, end) {
    const ts = 2 ** n,
      owners = new Map(),
      byColumn = new Map(),
      used = new Map();
    const candidates = Object.values(sources)
      .filter((src) => src.n <= n && src.m <= m)
      .sort((a, b) => a.n - b.n || a.m - b.m);
    for (const src of candidates) {
      const meta = PACK.blocks[src.id],
        start = meta?.b0 ?? src.col0 * 2 ** src.n,
        stop = Math.min(end, meta?.b1 ?? src.col1 * 2 ** src.n);
      const c0 = Math.ceil(start / ts),
        c1 = Math.floor(stop / ts);
      if (c1 <= c0) continue;
      const owned = new Set();
      for (let c = c0; c < c1; c++)
        if (!owners.has(c)) {
          owners.set(c, src.id);
          owned.add(c);
        }
      if (!owned.size) continue;
      const grouped = aggregate(src, n, m, [c0 * ts, c1 * ts, 0, Infinity]);
      let accepted = 0;
      for (const col of grouped.cols)
        if (owned.has(col.c) && col.v > 0 && col.poc !== null) {
          byColumn.set(col.c, { ...col, source: src.id });
          accepted++;
        }
      if (accepted)
        used.set(src.id, { id: src.id, n: src.n, m: src.m, columns: accepted });
    }
    return {
      cols: [...byColumn.values()].sort((a, b) => a.c - b.c),
      sources: [...used.values()],
      covered: owners.size,
    };
  }
  function evidenceSummary(cases, field) {
    const values = cases.map((c) => c.delta).sort((a, b) => a - b),
      count = cases.length;
    return {
      n: count,
      up: cases.filter((c) => c[field] > 0).length,
      flat: cases.filter((c) => c[field] === 0).length,
      down: cases.filter((c) => c[field] < 0).length,
      q: count
        ? [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => d3.quantileSorted(values, p))
        : [],
    };
  }
  function calcEvidence() {
    const b = bounds(),
      n = renderN(),
      m = renderM(),
      ts = stepT(),
      end = Math.min(CUT, S.anchor === null ? b[1] : S.anchor),
      a = Math.floor(end / ts) - 1,
      barrier = S.barrier || 1;
    const loaded = Object.values(sources)
        .map((src) => src.id + ":" + src.cells.length)
        .sort()
        .join(","),
      key = ["v4", n, m, a, barrier, loaded].join("|");
    if (evidenceCache.has(key)) return evidenceCache.get(key);
    const history = evidenceColumns(n, m, (a + 1) * ts),
      cols = history.cols,
      ai = cols.findIndex((c) => c.c === a);
    const shared = {
      a,
      from: cols[0]?.c,
      sources: history.sources,
      covered: history.covered,
    };
    if (ai < 1)
      return {
        ...shared,
        error:
          ai < 0
            ? "No completed POC at this anchor."
            : "Not enough earlier columns in loaded history.",
      };
    const prior = cols.slice(0, ai),
      shares = prior.map((c) => c.bv / c.v).sort((a, b) => a - b),
      vols = prior.map((c) => c.v).sort((a, b) => a - b),
      st = [d3.quantileSorted(shares, 1 / 3), d3.quantileSorted(shares, 2 / 3)],
      vt = [d3.quantileSorted(vols, 1 / 3), d3.quantileSorted(vols, 2 / 3)];
    function stateAt(i) {
      if (i < 1 || cols[i - 1].c + 1 !== cols[i].c) return null;
      const c = cols[i],
        share = c.bv / c.v;
      return [
        Math.sign(c.poc - cols[i - 1].poc) + 1,
        share < st[0] ? 0 : share < st[1] ? 1 : 2,
        c.v < vt[0] ? 0 : c.v < vt[1] ? 1 : 2,
      ];
    }
    const state = stateAt(ai);
    if (!state)
      return {
        ...shared,
        error: "The anchor has no preceding POC in a contiguous column.",
      };
    const cases = Array.from({ length: 9 }, () => []),
      matched = Array.from({ length: 9 }, () => []);
    for (let i = 1; i < ai; i++) {
      const s = stateAt(i);
      if (!s) continue;
      const matches = s.every((x, j) => x === state[j]);
      let first = 0,
        firstAt = null,
        min = 0,
        max = 0;
      for (let h = 1; h <= 8; h++) {
        if (i + h > ai || cols[i + h].c !== cols[i].c + h) break;
        const delta = cols[i + h].poc - cols[i].poc;
        min = Math.min(min, delta);
        max = Math.max(max, delta);
        if (!first && Math.abs(delta) >= barrier) {
          first = Math.sign(delta);
          firstAt = h;
        }
        const c = {
          c: cols[i].c,
          end: cols[i + h].c,
          poc: cols[i].poc,
          finalPoc: cols[i + h].poc,
          delta,
          direction: Math.sign(delta),
          first,
          firstAt,
          min,
          max,
          state: s,
          source: cols[i].source,
          buyShare: cols[i].bv / cols[i].v,
          volume: cols[i].v,
          matched: matches,
        };
        cases[h].push(c);
        if (matches) matched[h].push(c);
      }
    }
    const out = {
      ...shared,
      poc: cols[ai].poc,
      state,
      thresholds: { share: st, volume: vt },
      cases,
      matched,
      match: matched.map((c) => evidenceSummary(c, "direction")),
      all: cases.map((c) => evidenceSummary(c, "direction")),
      barrierMatch: matched.map((c) => evidenceSummary(c, "first")),
      barrierAll: cases.map((c) => evidenceSummary(c, "first")),
      lastColumn: a,
    };
    if (evidenceCache.size >= 6)
      evidenceCache.delete(evidenceCache.keys().next().value);
    evidenceCache.set(key, out);
    return out;
  }
  function evidenceTotals(e) {
    const barriers = S.evidenceKind === "barrier";
    return {
      sample: e.error ? null : (barriers ? e.barrierMatch : e.match)[S.horizon],
      base: e.error ? null : (barriers ? e.barrierAll : e.all)[S.horizon],
      field: barriers ? "first" : "direction",
    };
  }
  function evidenceUI(e) {
    const { sample, base } = evidenceTotals(e),
      supported = sample && sample.n >= 30,
      barriers = S.evidenceKind === "barrier";
    el("anchor-time").textContent = e.error
      ? ""
      : `${dateShort((e.a + 1) * stepT())} UTC · ${dur(BASE * stepT() * S.horizon)} ahead`;
    el("state").textContent =
      e.error ||
      [
        ["Falling POC", "Flat POC", "Rising POC"][e.state[0]],
        [
          "lower buy-share third",
          "middle buy-share third",
          "upper buy-share third",
        ][e.state[1]],
        ["lower volume third", "middle volume third", "upper volume third"][
          e.state[2]
        ],
      ].join(" · ");
    el("barrier-control").hidden = !barriers;
    el("barrier").value = S.barrier || 1;
    qsa("[data-evidence-kind]").forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.evidenceKind === (S.evidenceKind || "poc")),
      ),
    );
    const labels = barriers
      ? {
          up: "Upper POC first",
          flat: "Neither POC barrier",
          down: "Lower POC first",
        }
      : { up: "Higher POC", flat: "Same price row", down: "Lower POC" };
    for (const kind of ["up", "flat", "down"]) {
      const p = supported ? sample[kind] / sample.n : 0,
        bp = base?.n ? base[kind] / base.n : 0;
      el("label-" + kind).textContent = labels[kind];
      el("prob-" + kind).textContent = supported
        ? Math.round(p * 100) + "%"
        : sample
          ? sample[kind] + " cases"
          : "—";
      el("bar-" + kind).style.width = p * 100 + "%";
      el("base-" + kind).style.width =
        (base && base.n >= 30 ? bp * 100 : 0) + "%";
      el("base-prob-" + kind).textContent = base
        ? `All states ${base.n >= 30 ? Math.round(bp * 100) + "%" : base[kind] + " cases"}`
        : "All states —";
      root
        .querySelector('[data-case-direction="' + kind + '"]')
        .setAttribute(
          "aria-label",
          labels[kind] +
            (sample
              ? " · " + sample[kind] + " of " + sample.n + " matching cases"
              : "") +
            " · inspect evidence",
        );
    }
    el("case-n").textContent = sample ? integer(sample.n) : "—";
    el("case-all").textContent = base ? integer(base.n) : "—";
    const sourceNames = {
      recent: "7-day base",
      reference: "30-day archive",
      overview: "full-history overview",
    };
    el("evidence-provenance").textContent = e.sources?.length
      ? `${e.sources.map((s) => sourceNames[s.id] || s.id).join(" + ")} · deduplicated · all price rows, independent of the visible window`
      : "No loaded history represents this grid.";
    el("evidence-note").textContent = e.error
      ? "Choose a completed column containing trades."
      : (supported
          ? "Empirical shares; overlapping cases, not calibrated odds."
          : "Below 30 matches: percentages and matching cone withheld.") +
        (barriers
          ? " Barriers use the first column-end POC crossing; trade first-touch is not observable here."
          : " Both cones show historical POC movement.") +
        " Every outcome ends by the anchor.";
    evidenceCases(e);
  }
  function evidenceCases(e) {
    const list = el("case-list"),
      { sample, field } = evidenceTotals(e);
    el("case-filter").value = S.caseFilter || "all";
    if (e.error) {
      list.replaceChildren();
      el("case-definition").textContent = e.error;
      el("case-page").textContent = "0 cases";
      el("case-prev").disabled = el("case-next").disabled = true;
      return;
    }
    const h = S.horizon,
      filter = S.caseFilter || "all",
      modal = sample
        ? ["down", "flat", "up"]
            .map((k) => ({ k, n: sample[k] }))
            .sort((a, b) => b.n - a.n)[0].k
        : "flat",
      modalSign = { up: 1, flat: 0, down: -1 }[modal];
    let rows = filter === "reference" ? e.cases[h] : e.matched[h];
    if (["up", "flat", "down"].includes(filter))
      rows = rows.filter(
        (c) => c[field] === { up: 1, flat: 0, down: -1 }[filter],
      );
    if (filter === "failure") rows = rows.filter((c) => c[field] !== modalSign);
    rows = rows.slice().reverse();
    const pageSize = 5,
      pages = Math.max(1, Math.ceil(rows.length / pageSize));
    S.casePage = clamp(S.casePage || 0, 0, pages - 1);
    el("case-definition").textContent =
      filter === "failure"
        ? `Cases opposing the matching sample’s most common outcome (${modal}). This is a retrospective comparison.`
        : "Open a date to inspect its recorded starting state in replay. Excursions use column-end POCs.";
    const fragment = document.createDocumentFragment();
    for (const c of rows.slice(
      S.casePage * pageSize,
      (S.casePage + 1) * pageSize,
    )) {
      const row = document.createElement("div");
      row.className = "ol-case-row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cursor-interaction";
      button.dataset.caseAnchor = String((c.c + 1) * stepT());
      button.textContent = dateShort((c.c + 1) * stepT()) + " UTC";
      row.append(button);
      const result = document.createElement("div");
      result.className = "ol-case-result";
      const outcome = document.createElement("span"),
        amount = document.createElement("span");
      outcome.textContent =
        S.evidenceKind === "barrier"
          ? (c.first > 0
              ? "Upper first"
              : c.first < 0
                ? "Lower first"
                : "Neither") + (c.firstAt ? " · " + c.firstAt + " cols" : "")
          : c.delta > 0
            ? "Higher"
            : c.delta < 0
              ? "Lower"
              : "Same row";
      amount.textContent =
        (c.delta > 0 ? "+" : "") + price(c.delta * stepP() * PR) + " USDT";
      result.append(outcome, amount);
      row.append(result);
      const range = document.createElement("div");
      range.className = "ol-muted";
      range.textContent = `POC ${price((c.poc + 0.5) * stepP() * PR)} → ${price((c.finalPoc + 0.5) * stepP() * PR)} · ${Math.round(c.buyShare * 100)}% buy`;
      row.append(range);
      const adverse = document.createElement("div");
      adverse.className = "ol-muted";
      adverse.textContent = `Excursion ${c.min > 0 ? "+" : ""}${price(c.min * stepP() * PR)} / +${price(c.max * stepP() * PR)} USDT`;
      row.append(adverse);
      fragment.append(row);
    }
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "ol-evidence-note";
      empty.textContent = "No qualifying cases in this loaded history.";
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
    el("case-page").textContent = rows.length
      ? `${S.casePage + 1} / ${pages} · ${integer(rows.length)}`
      : "0 cases";
    el("case-prev").disabled = S.casePage === 0;
    el("case-next").disabled = S.casePage + 1 >= pages;
  }
  function drawCone(e) {
    if (e.error) return;
    const ts = stepT(),
      ps = stepP(),
      x0 = G.X((e.a + 1) * ts),
      y0 = G.Y((e.poc + 0.5) * ps);
    if (x0 < G.x || x0 > G.x + G.w) return;
    ctx.save();
    function band(summaries, color, opacity) {
      for (const [low, high, alpha] of [
        [0, 4, opacity],
        [1, 3, opacity * 1.65],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        let hh = 0;
        for (let h = 1; h <= 8; h++) {
          if (summaries[h].n < 30) break;
          hh = h;
          ctx.lineTo(
            G.X((e.a + 1 + h) * ts),
            G.Y((e.poc + summaries[h].q[high] + 0.5) * ps),
          );
        }
        for (let h = hh; h >= 1; h--)
          ctx.lineTo(
            G.X((e.a + 1 + h) * ts),
            G.Y((e.poc + summaries[h].q[low] + 0.5) * ps),
          );
        ctx.closePath();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let h = 1; h <= 8; h++) {
        if (summaries[h].n < 30) break;
        ctx.lineTo(
          G.X((e.a + 1 + h) * ts),
          G.Y((e.poc + summaries[h].q[2] + 0.5) * ps),
        );
      }
      ctx.stroke();
    }
    band(e.all, colors.muted, 0.1);
    band(e.match, colors.evidence, 0.15);
    ctx.globalAlpha = 1;
    if (S.evidenceKind === "barrier") {
      const distance = S.barrier || 1,
        x1 = G.X((e.a + 1 + S.horizon) * ts);
      ctx.setLineDash([4, 3]);
      for (const sign of [-1, 1]) {
        const y = G.Y((e.poc + 0.5 + sign * distance) * ps);
        line(x0, y, x1, y, colors.evidence, 1, 0.7);
      }
      ctx.setLineDash([]);
    }
    ctx.fillStyle = colors.evidence;
    ctx.beginPath();
    ctx.arc(x0, y0, 3, 0, 7);
    ctx.fill();
    ctx.restore();
  }
  function bindEvidence() {
    el("evidence").addEventListener("click", (event) => {
      const kind = event.target.closest("[data-evidence-kind]");
      if (kind) {
        S.evidenceKind = kind.dataset.evidenceKind;
        S.casePage = 0;
        update();
        save();
        return;
      }
      const direction = event.target.closest("[data-case-direction]");
      if (direction) {
        S.caseFilter = direction.dataset.caseDirection;
        S.casePage = 0;
        el("cases").open = true;
        evidenceUI(calcEvidence());
        save();
        return;
      }
      const anchor = event.target.closest("[data-case-anchor]");
      if (anchor) {
        const base = Number(anchor.dataset.caseAnchor),
          ts = stepT(),
          span = Math.max(24 * ts, S.tB - S.tA),
          b = bounds();
        S.n = renderN();
        S.m = renderM();
        S.auto = false;
        S.anchor = base;
        S.replay = true;
        S.tA = base - span * 0.72;
        S.tB = S.tA + span;
        S.pA = b[2];
        S.pB = b[3];
        S.selection = null;
        S.window = "";
        S.tab = "evidence";
        hover = null;
        el("tip").hidden = true;
        chooseSource();
        limits();
        confine();
        update();
        recordCrumb("Historical case");
        save();
      }
    });
    el("barrier").addEventListener("change", () => {
      S.barrier = Number(el("barrier").value);
      S.casePage = 0;
      update();
      save();
    });
    el("case-filter").addEventListener("change", () => {
      S.caseFilter = el("case-filter").value;
      S.casePage = 0;
      evidenceUI(calcEvidence());
      save();
    });
    for (const [id, step] of [
      ["case-prev", -1],
      ["case-next", 1],
    ])
      el(id).addEventListener("click", () => {
        S.casePage = (S.casePage || 0) + step;
        evidenceUI(calcEvidence());
      });
  }

  const nav = {
    pointers: new Map(),
    pinch: null,
    last: null,
    alt: false,
    hold: false,
    holdTimer: 0,
    wheelTimer: 0,
    crumbs: [],
    crumbIndex: -1,
    planeKey: "",
    planeStatus: "",
    planeHover: false,
    planeButtons: null,
    bound: false,
  };
  function stepAnchor(delta) {
    S.anchor = clamp(
      (S.anchor || activeCutoff()) + delta * stepT(),
      stepT(),
      Math.floor(CUT / stepT()) * stepT(),
    );
    S.tab = "evidence";
    hover = null;
    el("tip").hidden = true;
    update();
    save();
  }
  function pixelLevel(level, span, pixels, max) {
    let n = clamp(Math.round(level), 0, max),
      size = (2 ** n * pixels) / span;
    while (size < 8 && n < max) {
      n++;
      size *= 2;
    }
    while (size > 18 && n > 0) {
      n--;
      size /= 2;
    }
    return n;
  }
  function navGeometry() {
    const r = canvas.getBoundingClientRect();
    return {
      w: Math.max(1, r.width - 61 - (r.width > 470 ? 79 : 52) - 12),
      h: Math.max(1, r.height - 90),
    };
  }
  function autoLevel() {
    if (!S.auto || !(S.tB > S.tA) || !(S.pB > S.pA)) return false;
    const g = navGeometry(),
      n = pixelLevel(S.n, S.tB - S.tA, g.w, N_MAX),
      m = S.diagonal ? diagonalM(n) : pixelLevel(S.m, S.pB - S.pA, g.h, M_MAX),
      changed = n !== S.n || m !== S.m;
    if (changed) {
      transition = reduce
        ? null
        : { n: renderN(), m: renderM(), start: performance.now() };
      S.n = n;
      S.m = m;
    }
    return changed;
  }
  function sourceRange(src) {
    return [
      src.b0 ?? src.col0 * 2 ** src.n,
      src.b1 ?? Math.min(CUT, src.col1 * 2 ** src.n),
    ];
  }
  function resolutionReadiness(n, m) {
    const b = requestedBounds(),
      a = Math.min(b[0], CUT),
      end = Math.min(b[1], CUT),
      shown = displaySource();
    if (shown) {
      const [start, stop] = sourceRange(shown);
      if (shown.n <= n && shown.m <= m && start <= a && stop >= end)
        return { status: "ready", source: shown.id };
    }
    const ids = Object.keys(PACK.blocks).sort(
      (a, b) =>
        PACK.blocks[a].n - PACK.blocks[b].n || PACK.blocks[a].m - PACK.blocks[b].m,
    );
    for (const id of ids) {
      const raw = PACK.blocks[id],
        range = raw ? [raw.b0, raw.b1] : null;
      if (
        !raw ||
        !range ||
        range[0] > a ||
        range[1] < end ||
        raw.n > n ||
        raw.m > m
      )
        continue;
      if (loadState[id] === "ready" && sources[id])
        return { status: "ready", source: id };
      if (loadState[id] === "loading") return { status: "loading", source: id };
    }
    return { status: "unavailable", source: shown?.id || S.dataset };
  }
  const tiles = { pending: null, timer: 0, skip: null, stale: false };
  function tileSpec(n, m) {
    const step = 2 ** n,
      r = requestedBounds(),
      b0 = Math.floor(Math.min(r[0], CUT) / step) * step,
      b1 = Math.min(Math.ceil(Math.min(r[1], CUT) / step) * step, CUT);
    if (b1 <= b0 || (b1 - b0) / step > TILE_COLUMNS) return null;
    return { id: `tile:${n}:${m}:${b0}:${b1}`, n, m, b0, b1 };
  }
  function requestTile() {
    if (!PACK.live || !ready) return;
    clearTimeout(tiles.timer);
    tiles.timer = setTimeout(fetchTile, 250);
  }
  async function fetchTile() {
    if (
      tiles.pending ||
      tiles.stale ||
      resolutionReadiness(S.n, S.m).status !== "unavailable"
    )
      return;
    const t = tileSpec(S.n, S.m);
    if (!t) return;
    // A failure skips only the re-check it triggers itself; the next navigation,
    // level change or import asks the cube again.
    if (t.id === tiles.skip) {
      tiles.skip = null;
      return;
    }
    tiles.pending = t.id;
    PACK.blocks[t.id] = { n: t.n, m: t.m, b0: t.b0, b1: t.b1 };
    loadState[t.id] = "loading";
    el("loading").hidden = false;
    el("loading").textContent =
      `Fetching ${dur(BASE * 2 ** t.n)} by ${price(PR * 2 ** t.m)} USDT cells from the cube`;
    update();
    try {
      const response = await fetch(
          `/cube/tile?n=${t.n}&m=${t.m}&b0=${t.b0}&b1=${t.b1}`,
        ),
        body = await response.json();
      if (body.error === "cube_changed") {
        // The cube holds another revision of history than this page; nothing is mixed.
        tiles.stale = true;
        throw Error("the cube changed since this page loaded; reload to continue");
      }
      if (!response.ok) throw Error(body.error || response.statusText);
      PACK.blocks[t.id] = body.block;
      sources[t.id] = await unpack(body.block, t.id);
      loadState[t.id] = "ready";
      el("loading").hidden = true;
    } catch (error) {
      delete PACK.blocks[t.id];
      delete loadState[t.id];
      tiles.skip = t.id;
      el("loading").textContent = `Cube tile unavailable: ${error.message}`;
      el("loading").setAttribute("role", "alert");
    }
    tiles.pending = null;
    chooseSource();
    evidenceCache.clear();
    update();
  }
  function buildPlane() {
    const frag = document.createDocumentFragment(),
      label = (textContent) => {
        const span = document.createElement("span");
        span.textContent = textContent;
        return span;
      };
    nav.planeButtons = [];
    for (let m = M_MAX; m >= 0; m--) {
      frag.append(label(String(m)));
      for (let n = 0; n <= N_MAX; n++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cursor-interaction";
        b.dataset.n = n;
        b.dataset.m = m;
        const show = () => {
          nav.planeHover = true;
          el("plane-status").textContent = b.title;
        };
        b.addEventListener("mouseenter", show);
        b.addEventListener("focus", show);
        b.addEventListener("click", () => changeResolution(n, m));
        nav.planeButtons.push(b);
        frag.append(b);
      }
    }
    frag.append(label("n"));
    for (let n = 0; n <= N_MAX; n++)
      frag.append(label(n % 4 === 0 ? String(n) : ""));
    el("plane").replaceChildren(frag);
  }
  function refreshPlane() {
    const g = navGeometry(),
      key = [
        S.n,
        S.m,
        S.diagonal,
        Math.round(g.w),
        Math.round(g.h),
        S.tA,
        S.tB,
        S.pA,
        S.pB,
        S.selection?.join(","),
        Object.values(loadState).join(","),
      ].join("|");
    if (key === nav.planeKey) return;
    nav.planeKey = key;
    if (!nav.planeButtons) buildPlane();
    for (const b of nav.planeButtons) {
      const n = Number(b.dataset.n),
        m = Number(b.dataset.m),
        px = (2 ** n * g.w) / (S.tB - S.tA),
        py = (2 ** m * g.h) / (S.pB - S.pA),
        r = resolutionReadiness(n, m),
        onPath = m === diagonalM(n),
        kind =
          r.status === "loading"
            ? "loading"
            : r.status !== "ready"
              ? "unavailable"
              : px < 6 || py < 6
                ? "small"
                : px > 32 || py > 32
                  ? "large"
                  : "ready",
        text = `n ${n} · m ${m} · ${dur(BASE * 2 ** n)} by ${price(PR * 2 ** m)} USDT · ${px.toFixed(1)} by ${py.toFixed(1)} px · ${r.status === "loading" ? "loading" : r.status === "unavailable" ? "detail unavailable; coarser cells shown" : kind === "small" ? "ready, too small" : kind === "large" ? "ready, too large" : "ready, usable"}${onPath ? " · on the diagonal" : ""}`,
        className =
          "cursor-interaction ol-plane-" + kind + (onPath ? " ol-plane-path" : "");
      if (b.className !== className) b.className = className;
      const pressed = String(S.n === n && S.m === m);
      if (b.getAttribute("aria-pressed") !== pressed)
        b.setAttribute("aria-pressed", pressed);
      if (b.title !== text) {
        b.title = text;
        b.setAttribute("aria-label", text);
      }
    }
  }
  function changeResolution(n, m, timeOnly = false) {
    n = clamp(Math.round(n), 0, N_MAX);
    m = clamp(Math.round(m), 0, M_MAX);
    if (S.diagonal) {
      if (timeOnly) m = diagonalM(n);
      else if ((n !== S.n || m !== S.m) && m !== diagonalM(n))
        S.diagonal = false;
    }
    transition = reduce
      ? null
      : { n: renderN(), m: renderM(), start: performance.now() };
    S.auto = false;
    S.n = n;
    S.m = m;
    limits();
    hover = null;
    el("tip").hidden = true;
    update();
    recordCrumb("Level");
    save();
  }
  function confine() {
    const span = clamp(S.tB - S.tA, 2, CUT * 1.2);
    S.tB = S.tA + span;
    if (S.tA < 0) {
      S.tA = 0;
      S.tB = span;
    }
    if (S.tA > CUT - 1) {
      S.tA = CUT - 1;
      S.tB = S.tA + span;
    }
    const pspan = clamp(S.pB - S.pA, 1, 400000 / PR);
    S.pB = S.pA + pspan;
    if (S.pA < 0) {
      S.pB -= S.pA;
      S.pA = 0;
    }
    chooseSource();
    limits();
  }
  function navSnapshot() {
    return {
      tA: S.tA,
      tB: S.tB,
      pA: S.pA,
      pB: S.pB,
      n: S.n,
      m: S.m,
      auto: S.auto,
      coupled: S.coupled,
      diagonal: S.diagonal,
      refit: S.refit,
      window: S.window,
      selection: S.selection?.slice() || null,
      anchor: S.anchor,
      replay: S.replay,
    };
  }
  function navSnapshotKey(s) {
    return [
      s.tA,
      s.tB,
      s.pA,
      s.pB,
      s.n,
      s.m,
      s.auto,
      s.selection?.join(","),
      s.anchor,
      s.replay,
    ].join("|");
  }
  function renderCrumbs() {
    const frag = document.createDocumentFragment();
    nav.crumbs.forEach((c, i) => {
      if (i) {
        const s = document.createElement("span");
        s.textContent = "›";
        s.setAttribute("aria-hidden", "true");
        frag.append(s);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cursor-interaction";
      b.textContent =
        c.label === "Level"
          ? dur(BASE * 2 ** c.state.n) + " / " + price(PR * 2 ** c.state.m)
          : c.label === "Zoom"
            ? "Zoom " + dur((c.state.tB - c.state.tA) * BASE)
            : c.label;
      b.setAttribute("aria-current", i === nav.crumbIndex ? "step" : "false");
      b.title = `${dateShort(c.state.tA)} UTC · ${dur((c.state.tB - c.state.tA) * BASE)} · ${dur(BASE * 2 ** c.state.n)} × ${price(PR * 2 ** c.state.m)} USDT`;
      b.addEventListener("click", () => {
        Object.assign(S, c.state, {
          selection: c.state.selection?.slice() || null,
        });
        nav.crumbIndex = i;
        confine();
        hover = null;
        el("tip").hidden = true;
        update();
        renderCrumbs();
        save();
      });
      frag.append(b);
    });
    el("breadcrumbs").replaceChildren(frag);
  }
  function recordCrumb(label) {
    if (!ready) return;
    const state = navSnapshot(),
      key = navSnapshotKey(state);
    if (nav.crumbs[nav.crumbIndex]?.key === key) return;
    nav.crumbs = nav.crumbs.slice(0, nav.crumbIndex + 1);
    nav.crumbs.push({ label: label || "View", state, key });
    if (nav.crumbs.length > 8) nav.crumbs.shift();
    nav.crumbIndex = nav.crumbs.length - 1;
    renderCrumbs();
  }
  function updateNavigation() {
    for (const field of ["auto", "coupled", "diagonal", "refit", "lens"])
      el(field).setAttribute("aria-pressed", String(S[field]));
    el("lens-depth").value = String(clamp(Math.round(S.lensDepth) || 2, 1, 4));
    el("lens-pin").hidden = !S.lens;
    el("auto").textContent = S.auto ? "Auto level" : "Level locked";
    const g = navGeometry(),
      px = (stepT() * g.w) / (S.tB - S.tA),
      py = (stepP() * g.h) / (S.pB - S.pA),
      fmt = (x) => (x < 1 ? x.toFixed(1) : Math.round(x));
    el("pixel-state").textContent = `${fmt(px)} × ${fmt(py)} px / cell`;
    nav.planeStatus = `Requested n ${S.n} · m ${S.m}${renderN() !== S.n || renderM() !== S.m ? ` · displayed n ${renderN()} · m ${renderM()}` : ""} · diagonal m = round(${ISO_A} + ${ISO_B} n)`;
    if (!nav.planeHover) el("plane-status").textContent = nav.planeStatus;
    el("gesture").textContent = S.lens
      ? "Move to inspect · Enter: pin the lens view · Shift+L: depth · L releases"
      : S.select
        ? "Drag a rectangle · base-cell edges"
        : S.coupled
          ? "Wheel / pinch: time + price · Alt: lens"
          : S.diagonal
            ? "Wheel / pinch: time ×k, price ×√k · Alt: lens"
            : "Wheel / pinch: time · Shift-wheel: price · Alt: lens";
    refreshPlane();
  }
  function settleNavigation(label, refit = false) {
    confine();
    if (refit && S.refit && !S.coupled && !S.diagonal) fit();
    autoLevel();
    hover = null;
    el("tip").hidden = true;
    update();
    if (label) {
      recordCrumb(label);
      save();
    }
  }
  function zoomNavigation(k, p, priceOnly = false) {
    const tspan = S.tB - S.tA,
      pspan = S.pB - S.pA;
    if (!priceOnly || S.coupled) {
      const span = clamp(tspan * k, 2, CUT * 1.2),
        u = (p.t - S.tA) / tspan;
      S.tA = p.t - u * span;
      S.tB = S.tA + span;
    }
    const priceFactor =
      priceOnly || S.coupled ? k : S.diagonal ? Math.sqrt(k) : null;
    if (priceFactor !== null) {
      const span = clamp(pspan * priceFactor, 1, 400000 / PR),
        u = (p.p - S.pA) / pspan;
      S.pA = p.p - u * span;
      S.pB = S.pA + span;
    }
    S.window = "";
    settleNavigation(null, !priceOnly);
    return p;
  }
  function lensFrame() {
    if (!G.w) return null;
    const p =
        nav.last && inPlot(nav.last)
          ? nav.last
          : {
              x: G.x + G.w / 2,
              y: G.y + G.h / 2,
              t: (S.tA + S.tB) / 2,
              p: (S.pA + S.pB) / 2,
            },
      w = Math.min(230, G.w - 8),
      h = Math.min(170, G.h - 8),
      x = clamp(p.x - w / 2, G.x + 4, G.x + G.w - w - 4),
      y = clamp(p.y - h / 2, G.y + 4, G.y + G.h - h - 4),
      ta = G.X.invert(x),
      tbRaw = G.X.invert(x + w),
      tb = Math.min(tbRaw, activeCutoff()),
      pa = G.Y.invert(y + h),
      pb = G.Y.invert(y),
      depth = clamp(Math.round(S.lensDepth) || 2, 1, 4),
      candidates = Object.values(sources)
        .filter((s) => {
          const [a, b] = sourceRange(s);
          return a <= p.t && b > p.t;
        })
        .sort((a, b) => a.n - b.n || a.m - b.m),
      src = candidates[0] || null,
      n = src ? Math.max(src.n, renderN() - depth) : renderN(),
      m = src ? Math.max(src.m, renderM() - depth) : renderM();
    return { p, w, h, x, y, ta, tb, tbRaw, pa, pb, depth, src, n, m };
  }
  function pinLens() {
    const f = lensFrame();
    if (!f || !f.src) return false;
    transition = reduce
      ? null
      : { n: renderN(), m: renderM(), start: performance.now() };
    S.tA = f.ta;
    S.tB = f.tbRaw;
    S.pA = Math.max(0, f.pa);
    S.pB = f.pb;
    const changed = f.n !== S.n || f.m !== S.m;
    S.n = f.n;
    S.m = f.m;
    if (S.diagonal && changed && f.m !== diagonalM(f.n)) S.diagonal = false;
    S.auto = false;
    S.lens = false;
    S.window = "";
    nav.alt = false;
    nav.hold = false;
    confine();
    hover = null;
    el("tip").hidden = true;
    update();
    recordCrumb("Pinned lens");
    save();
    return true;
  }
  function drawResolutionLens() {
    if (!(S.lens || nav.alt || nav.hold)) return;
    const f = lensFrame();
    if (!f) return;
    const { w, h, x, y, ta, tb, pa, pb, depth, src, n, m } = f;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = colors.surface;
    ctx.fillRect(x, y, w, h);
    let label = "Detail unavailable",
      sub = "No finer recorded cells in this region",
      localLegend = "";
    if (src) {
      const ts = 2 ** n,
        ps = 2 ** m,
        [start, end] = sourceRange(src),
        fine = n < renderN() || m < renderM();
      {
        const a = Math.max(start, Math.floor(ta / 2 ** src.n) * 2 ** src.n),
          b = Math.min(
            end,
            activeCutoff(),
            Math.ceil(tb / 2 ** src.n) * 2 ** src.n,
          ),
          lensBounds = [
            a,
            b,
            Math.max(0, Math.floor(pa / 2 ** src.m) * 2 ** src.m),
            Math.ceil(pb / 2 ** src.m) * 2 ** src.m,
          ],
          q = aggregate(src, n, m, lensBounds),
          metrics = new Map(),
          densities = [],
          deltas = [];
        for (const z of q.cells) {
          const exposure = cellExposure(z, lensBounds, ts, ps),
            density = exposure.area > 0 ? z.v / exposure.area : 0,
            delta = 2 * z.bv - z.v;
          metrics.set(z, { density, delta });
          if (density > 0) densities.push(Math.log(density));
          if (delta !== 0) deltas.push(Math.abs(delta));
        }
        densities.sort((a, b) => a - b);
        deltas.sort((a, b) => a - b);
        const densityLo = d3.quantileSorted(densities, 0.02) ?? 0,
          densityHi = d3.quantileSorted(densities, 0.995) ?? 1,
          deltaMax = d3.quantileSorted(deltas, 0.995) || 1;
        localLegend =
          S.mode === "density"
            ? `${densityNumber(Math.exp(densityLo))}–${densityNumber(Math.exp(densityHi))} USDT/(s·USDT) · log`
            : S.mode === "delta"
              ? `Δ −${compact(deltaMax)} · 0 · +${compact(deltaMax)} USDT`
              : S.mode === "flow"
                ? "Buy share 0% · 50% · 100%"
                : S.mode === "geometry"
                  ? "Occupied cells"
                  : `${compact(Math.exp(q.lo))}–${compact(Math.exp(q.hi))} USDT · log`;
        for (const z of q.cells) {
          const xa = G.X(z.c * ts),
            xb = G.X(Math.min((z.c + 1) * ts, b)),
            ya = G.Y((z.r + 1) * ps),
            yb = G.Y(z.r * ps),
            share = z.v ? z.bv / z.v : 0.5,
            measure = metrics.get(z);
          let lv = clamp(
              (Math.log(z.v) - q.lo) / Math.max(0.1, q.hi - q.lo),
              0,
              1,
            ),
            hue = colors.volume;
          if (S.mode === "density")
            lv =
              measure.density > 0
                ? clamp(
                    (Math.log(measure.density) - densityLo) /
                      Math.max(0.1, densityHi - densityLo),
                    0,
                    1,
                  )
                : 0;
          if (S.mode === "flow") {
            hue = d3.interpolateRgb(
              colors.line,
              share >= 0.5 ? colors.buy : colors.sell,
            )(Math.abs(share - 0.5) * 2);
            lv = 0.7;
          }
          if (S.mode === "delta") {
            hue = measure.delta >= 0 ? colors.buy : colors.sell;
            lv = clamp(
              Math.log1p(Math.abs(measure.delta)) / Math.log1p(deltaMax),
              0,
              1,
            );
          }
          ctx.fillStyle = d3.interpolateRgb(
            colors.surface,
            hue,
          )(S.mode === "delta" ? lv : 0.2 + 0.8 * lv);
          if (S.mode === "geometry") {
            ctx.strokeStyle = colors.volume;
            ctx.globalAlpha = 0.65;
            ctx.strokeRect(
              xa + 0.5,
              ya + 0.5,
              Math.max(0.4, xb - xa - 1),
              Math.max(0.4, yb - ya - 1),
            );
            ctx.globalAlpha = 1;
          } else
            ctx.fillRect(
              xa + 0.3,
              ya + 0.3,
              Math.max(0.5, xb - xa - 0.6),
              Math.max(0.5, yb - ya - 0.6),
            );
        }
        if (S.poc) {
          ctx.beginPath();
          let prev = null;
          for (const c of q.cols) {
            if (c.poc === null) continue;
            const cx = G.X((c.c + 0.5) * ts),
              cy = G.Y((c.poc + 0.5) * ps);
            if (prev !== c.c - 1) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
            prev = c.c;
          }
          ctx.strokeStyle = colors.poc;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        label = `${fine ? `Lens −${depth}` : "Finest recorded"} · ${dur(BASE * ts)} × ${price(PR * ps)} USDT`;
        sub = fine
          ? "Finer cells · surroundings unchanged · Enter pins"
          : src.n === 0 && src.m === 0
            ? "Base cells · no finer level exists"
            : "Finer detail unavailable in this region";
        if (ta < start || tb > end) {
          label += " · partial";
          sub = "Finer coverage ends inside lens";
        }
      }
    }
    if (localLegend) {
      ctx.fillStyle = colors.surface;
      ctx.globalAlpha = 0.94;
      ctx.fillRect(x, y + h - 22, w, 22);
      ctx.globalAlpha = 1;
      text(localLegend, x + 7, y + h - 11, colors.muted, "left", 11);
    }
    ctx.fillStyle = colors.surface;
    ctx.globalAlpha = 0.94;
    ctx.fillRect(x, y, w, 40);
    ctx.globalAlpha = 1;
    text(label, x + 7, y + 12, colors.ink, "left", 11);
    text(sub, x + 7, y + 28, colors.muted, "left", 10);
    ctx.restore();
    ctx.strokeStyle = colors.volume;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  function bindNavigation() {
    if (nav.bound) return;
    nav.bound = true;
    el("auto").addEventListener("click", () => {
      S.auto = !S.auto;
      autoLevel();
      update();
      recordCrumb(S.auto ? "Auto" : "Locked");
      save();
    });
    el("coupled").addEventListener("click", () => {
      S.coupled = !S.coupled;
      if (S.coupled) {
        S.refit = false;
        S.diagonal = false;
      }
      update();
      save();
    });
    el("diagonal").addEventListener("click", () => {
      S.diagonal = !S.diagonal;
      if (S.diagonal) {
        S.refit = false;
        S.coupled = false;
        if (S.auto) autoLevel();
        else if (S.m !== diagonalM(S.n)) {
          transition = reduce
            ? null
            : { n: renderN(), m: renderM(), start: performance.now() };
          S.m = diagonalM(S.n);
        }
      }
      update();
      recordCrumb(S.diagonal ? "Diagonal" : "Free axes");
      save();
    });
    el("refit").addEventListener("click", () => {
      S.refit = !S.refit;
      if (S.refit) {
        S.coupled = false;
        S.diagonal = false;
        fit();
        autoLevel();
      }
      update();
      recordCrumb("Refit");
      save();
    });
    el("lens").addEventListener("click", () => {
      S.lens = !S.lens;
      if (S.lens) el("tip").hidden = true;
      update();
      save();
    });
    el("lens-depth").addEventListener("change", () => {
      S.lensDepth = clamp(Number(el("lens-depth").value) || 2, 1, 4);
      requestDraw();
      save();
    });
    el("lens-pin").addEventListener("click", () => {
      pinLens();
    });
    const leavePlane = () => {
      nav.planeHover = false;
      el("plane-status").textContent = nav.planeStatus || "";
    };
    el("plane").addEventListener("mouseleave", leavePlane);
    el("plane").addEventListener("focusout", (e) => {
      if (!el("plane").contains(e.relatedTarget)) leavePlane();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (!ready) return;
      const p = at(e);
      if (!inPlot(p)) return;
      canvas.setPointerCapture(e.pointerId);
      nav.pointers.set(e.pointerId, p);
      nav.last = p;
      nav.alt = e.altKey;
      el("tip").hidden = true;
      if (nav.pointers.size === 2) {
        clearTimeout(nav.holdTimer);
        nav.hold = false;
        const [a, b] = [...nav.pointers.values()],
          mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        nav.pinch = {
          view: [S.tA, S.tB, S.pA, S.pB],
          distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          t: G.X.invert(mid.x),
          p: G.Y.invert(mid.y),
        };
        drag = null;
        return;
      }
      drag = {
        start: p,
        view: [S.tA, S.tB, S.pA, S.pB],
        moved: false,
        lens: S.lens || e.altKey,
      };
      if (e.pointerType === "touch")
        nav.holdTimer = setTimeout(() => {
          if (drag && !drag.moved) {
            nav.hold = true;
            drag.lens = true;
            requestDraw();
          }
        }, 400);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!ready) return;
      const p = at(e);
      nav.last = p;
      nav.alt = e.altKey;
      if (nav.pointers.has(e.pointerId)) nav.pointers.set(e.pointerId, p);
      if (nav.pinch && nav.pointers.size >= 2) {
        const [a, b] = [...nav.pointers.values()],
          mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          ratio =
            nav.pinch.distance / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          [ta, tb, pa, pb] = nav.pinch.view,
          tspan = clamp((tb - ta) * ratio, 2, CUT * 1.2);
        S.tA = nav.pinch.t - ((mid.x - G.x) / G.w) * tspan;
        S.tB = S.tA + tspan;
        if (S.coupled || S.diagonal) {
          const factor = S.coupled ? ratio : Math.sqrt(ratio),
            pspan = clamp((pb - pa) * factor, 1, 400000 / PR);
          S.pA = nav.pinch.p - ((G.y + G.h - mid.y) / G.h) * pspan;
          S.pB = S.pA + pspan;
        }
        S.window = "";
        settleNavigation(null, true);
        return;
      }
      if (S.lens || nav.alt || nav.hold || drag?.lens) {
        el("tip").hidden = true;
        hover = null;
        requestDraw();
        return;
      }
      if (!drag) {
        tooltip(p);
        return;
      }
      const dx = p.x - drag.start.x,
        dy = p.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        clearTimeout(nav.holdTimer);
      }
      if (!drag.moved) return;
      if (S.select) {
        const snap = (x) => Math.floor(x + 0.5),
          ta = clamp(snap(p.t), 0, activeCutoff()),
          pa = Math.max(0, snap(p.p)),
          t0 = clamp(snap(drag.start.t), 0, activeCutoff()),
          p0 = Math.max(0, snap(drag.start.p));
        S.selection = [
          Math.min(ta, t0),
          Math.max(ta, t0),
          Math.min(pa, p0),
          Math.max(pa, p0),
        ];
        S.tab = "context";
        hover = null;
        requestDraw();
      } else {
        const [a, b, c, d] = drag.view;
        S.tA = a - (dx / G.w) * (b - a);
        S.tB = b - (dx / G.w) * (b - a);
        S.pA = c + (dy / G.h) * (d - c);
        S.pB = d + (dy / G.h) * (d - c);
        S.window = "";
        settleNavigation(null, false);
      }
    });
    const finish = (e) => {
      clearTimeout(nav.holdTimer);
      nav.pointers.delete(e.pointerId);
      if (nav.pinch) {
        if (nav.pointers.size < 2) {
          nav.pinch = null;
          drag = null;
          nav.hold = false;
          settleNavigation("Pinch", true);
        }
        return;
      }
      if (!drag) {
        nav.hold = false;
        return;
      }
      const p = at(e),
        held = drag.lens || nav.hold;
      if (!held && !drag.moved && inPlot(p) && p.t < activeCutoff()) {
        S.anchor = (Math.floor(p.t / stepT()) + 1) * stepT();
        S.tab = "evidence";
      }
      const label = held
        ? null
        : drag.moved
          ? S.select
            ? "Selection"
            : "Pan"
          : "Anchor";
      drag = null;
      nav.hold = false;
      if (
        S.selection &&
        (S.selection[0] === S.selection[1] || S.selection[2] === S.selection[3])
      )
        S.selection = null;
      settleNavigation(label, false);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", (e) => {
      clearTimeout(nav.holdTimer);
      nav.pointers.delete(e.pointerId);
      nav.pinch = null;
      nav.hold = false;
      drag = null;
      requestDraw();
    });
    canvas.addEventListener("pointerleave", () => {
      if (!drag && !nav.pinch) {
        hover = null;
        nav.last = null;
        nav.alt = false;
        el("tip").hidden = true;
        requestDraw();
      }
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!ready) return;
        const p = at(e);
        if (!inPlot(p)) return;
        e.preventDefault();
        zoomNavigation(
          Math.exp(clamp(e.deltaY, -120, 120) * 0.003),
          p,
          e.shiftKey,
        );
        clearTimeout(nav.wheelTimer);
        nav.wheelTimer = setTimeout(() => {
          recordCrumb("Zoom");
          save();
        }, 220);
      },
      { passive: false },
    );
    canvas.addEventListener("dblclick", (e) => {
      if (!ready) return;
      const p = at(e);
      if (!inPlot(p)) return;
      zoomNavigation(0.5, p, e.shiftKey);
      if (!S.replay) S.anchor = null;
      recordCrumb("Drill");
      save();
    });
    root.addEventListener("keydown", (e) => {
      if (
        !ready ||
        /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      const k = e.key.toLowerCase(),
        centre = { t: (S.tA + S.tB) / 2, p: (S.pA + S.pB) / 2 };
      if (e.key === "Alt") {
        nav.alt = true;
        el("tip").hidden = true;
        requestDraw();
        return;
      }
      if (k === "a") {
        e.preventDefault();
        el("auto").click();
        return;
      }
      if (k === "l" && e.shiftKey) {
        e.preventDefault();
        S.lensDepth = (clamp(Math.round(S.lensDepth) || 2, 1, 4) % 4) + 1;
        update();
        save();
        return;
      }
      if (k === "l") {
        e.preventDefault();
        el("lens").click();
        return;
      }
      if (k === "d") {
        e.preventDefault();
        el("diagonal").click();
        return;
      }
      if (k === "enter" && e.target === canvas && (S.lens || nav.alt || nav.hold)) {
        e.preventDefault();
        pinLens();
        return;
      }
      if (k === "," || k === ".") {
        e.preventDefault();
        stepAnchor(k === "," ? -1 : 1);
        return;
      }
      if (k === "f") {
        e.preventDefault();
        fit();
        autoLevel();
        update();
        recordCrumb("Fit");
        save();
        return;
      }
      if (["[", "]", "{", "}"].includes(k)) {
        e.preventDefault();
        const d = k === "[" || k === "{" ? -1 : 1;
        changeResolution(
          S.n + (e.shiftKey ? 0 : d),
          S.m + (e.shiftKey ? d : 0),
          !e.shiftKey,
        );
        return;
      }
      if (["+", "=", "-", "_"].includes(k)) {
        e.preventDefault();
        zoomNavigation(
          k === "-" || k === "_" ? 1.4 : 1 / 1.4,
          centre,
          e.shiftKey,
        );
        recordCrumb("Zoom");
        save();
        return;
      }
      if (k === "escape") {
        e.preventDefault();
        S.lens = false;
        nav.hold = false;
        nav.alt = false;
        S.selection = null;
        update();
        save();
        return;
      }
      if (k.startsWith("arrow")) {
        e.preventDefault();
        const dt = (S.tB - S.tA) * 0.15,
          dp = (S.pB - S.pA) * 0.15;
        if (k === "arrowleft") {
          S.tA -= dt;
          S.tB -= dt;
        }
        if (k === "arrowright") {
          S.tA += dt;
          S.tB += dt;
        }
        if (k === "arrowup") {
          S.pA += dp;
          S.pB += dp;
        }
        if (k === "arrowdown") {
          S.pA -= dp;
          S.pB -= dp;
        }
        S.window = "";
        settleNavigation("Pan", false);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Alt") {
        nav.alt = false;
        requestDraw();
      }
    });
    window.addEventListener("blur", () => {
      nav.alt = false;
      nav.hold = false;
      drag = null;
      nav.pinch = null;
      nav.pointers.clear();
      clearTimeout(nav.holdTimer);
      requestDraw();
    });
  }

  qsa("[data-window]").forEach((b) =>
    b.addEventListener("click", () => {
      setWindow(b.dataset.window);
      recordCrumb(b.textContent.trim());
      update();
      save();
    }),
  );
  qsa("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      S.mode = b.dataset.mode;
      update();
      save();
    }),
  );
  for (const [id, dn, dm] of [
    ["tminus", -1, 0],
    ["tplus", 1, 0],
    ["pminus", 0, -1],
    ["pplus", 0, 1],
  ])
    el(id).addEventListener("click", () =>
      changeResolution(S.n + dn, S.m + dm, dm === 0),
    );
  for (const f of ["poc", "area", "untested"])
    el(f).addEventListener("change", () => {
      S[f] = el(f).checked;
      update();
      save();
    });
  el("select").addEventListener("click", () => {
    S.select = !S.select;
    if (S.select) {
      S.tab = "context";
      S.lens = false;
    }
    update();
    save();
  });
  el("clear").addEventListener("click", () => {
    S.selection = null;
    recordCrumb("Selection cleared");
    update();
    save();
  });
  el("fit").addEventListener("click", () => {
    fit();
    if (S.auto) autoLevel();
    recordCrumb("Fit price");
    update();
    save();
  });
  for (const tab of ["context", "evidence"])
    el(tab + "-tab").addEventListener("click", () => {
      S.tab = tab;
      update();
      save();
    });
  el("horizon").addEventListener("change", () => {
    S.horizon = Number(el("horizon").value);
    S.casePage = 0;
    update();
    save();
  });
  el("replay").addEventListener("click", () => {
    S.replay = !S.replay;
    S.selection = null;
    if (S.replay && S.anchor === null)
      S.anchor =
        Math.floor((S.tA + (Math.min(S.tB, CUT) - S.tA) * 0.65) / stepT()) *
        stepT();
    S.tab = S.replay ? "evidence" : S.tab;
    fit();
    hover = null;
    el("tip").hidden = true;
    recordCrumb(S.replay ? "Replay" : "Cutoff");
    update();
    save();
  });
  for (const [id, delta] of [
    ["back", -1],
    ["next", 1],
  ])
    el(id).addEventListener("click", () => stepAnchor(delta));
  bindRoot();
  bindEvidence();
  bindNavigation();
  try {
    qsa("button,input,select").forEach((control) => (control.disabled = true));
    el("market").textContent = PACK.live ? "LIVE MARKET" : "RECORDED MARKET";
    el("snapshot").textContent = PACK.live
      ? stamp(CUT).slice(0, 16) + " UTC"
      : date(CUT).toLocaleDateString("en-GB", {
          timeZone: "UTC",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }) + " · UTC";
    getColors();
    sources.recent = await unpack(PACK.blocks.recent, "recent");
    loadState.recent = "ready";
    ready = true;
    geometry();
    setWindow("1");
    restore(window.explorerState?.saved);
    transition = null;
    qsa("button,input,select").forEach((control) => (control.disabled = false));
    recordCrumb(
      S.window === "all"
        ? "All history"
        : S.window === "1"
          ? "24 hours"
          : S.window === "7"
            ? "7 days"
            : "Restored",
    );
    update();
    new ResizeObserver(() => {
      if (ready) {
        geometry();
        if (S.auto) autoLevel();
        update();
      }
    }).observe(canvas);
    matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change",
      () => {
        getColors();
        requestDraw();
      },
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    for (const id of ["overview", "reference"]) {
      el("loading").textContent =
        `Recent base cells ready · loading ${id === "overview" ? "full history" : "reference history"}${PACK.live ? " from the cube" : ""}`;
      try {
        sources[id] = await unpack(PACK.blocks[id], id);
        loadState[id] = "ready";
        rebuildReference();
        chooseSource();
        limits();
        evidenceCache.clear();
        update();
      } catch (error) {
        loadState[id] = "unavailable";
        el("loading").textContent = `${id} unavailable: ${error.message}`;
        el("loading").setAttribute("role", "alert");
      }
      await new Promise(requestAnimationFrame);
    }
    if (Object.values(loadState).every((x) => x === "ready"))
      el("loading").hidden = true;
  } catch (error) {
    el("loading").textContent =
      (PACK.live ? "Cube data unavailable: " : "Recorded data unavailable: ") +
      error.message;
    el("loading").setAttribute("role", "alert");
  }
})();
