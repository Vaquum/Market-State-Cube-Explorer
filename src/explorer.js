(async () => {
  "use strict";
  const root = document.getElementById("origo-lens"),
    el = (id) => root.querySelector("#ol-" + id),
    qsa = (s) => root.querySelectorAll(s),
    PACK = JSON.parse(document.getElementById("origo-lens-data").textContent);
  const BASE = PACK.base_seconds,
    PR = PACK.base_price,
    T0 = PACK.t0,
    INSTRUMENT = "BTC/USDT";
  // On the live host the cutoff advances in place as new data arrives.
  let CUT = (Date.parse(PACK.cutoff) / 1000 - T0) / BASE;
  // Diagonal through the resolution lattice: least-squares fit of
  // log2(median column price range / 125) against n over the full history,
  // n = 6..13, measured on the 2026-09-24 extraction (exponent 0.49).
  const ISO_A = -1.06,
    ISO_B = 0.486,
    N_MAX = 20,
    M_MAX = 9,
    TILE_COLUMNS = 4096;
  const diagonalM = (n) => clamp(Math.round(ISO_A + ISO_B * n), 0, M_MAX);
  // Sortable columns of the drawer's cells and cases tables.
  const CELL_SORTS = [
      "time",
      "price",
      "volume",
      "trades",
      "buyvol",
      "buytrades",
      "state",
    ],
    CASE_SORTS = ["date", "outcome", "change", "poc", "excursion", "buy"];
  const canvas = el("canvas"),
    ctx = canvas.getContext("2d"),
    reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The canvas's share of the design tokens: its type sizes, and the plot's
  // margins. The gutter is the page's; the widest price label ("120,000")
  // fills the label column, so it starts on the same edge as every band.
  const TYPE = { s: 11, m: 12, l: 14, xl: 20 },
    GUTTER = 12,
    PRICE_LABELS = 43,
    PLOT_LEFT = GUTTER + PRICE_LABELS + 8,
    PLOT_TOP = 12,
    PANE_GAP = 8,
    AXIS = 24,
    profileWidth = (width) => (width > 470 ? 79 : 52);
  // The chart's panes: prices on top, activity under them sharing the time
  // axis, about 15% of the height, and the time labels along the bottom.
  function layout(width, height) {
    const profile = profileWidth(width),
      free = Math.max(1, height - PLOT_TOP - AXIS),
      ah = clamp(Math.round(free * 0.15), 36, 120),
      h = Math.max(1, free - ah - PANE_GAP);
    return {
      x: PLOT_LEFT,
      y: PLOT_TOP,
      w: Math.max(1, width - PLOT_LEFT - profile - GUTTER),
      h,
      ay: PLOT_TOP + h + PANE_GAP,
      ah,
      axis: height - AXIS / 2,
      profile,
    };
  }
  const design = { gap: 1 },
    S = {
      dataset: "recent",
      window: "24h",
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
      diagonal: false,
      lensDepth: 2,
      evidenceKind: "poc",
      barrier: 1,
      caseFilter: "all",
      casePage: 0,
      // Workspace layout: the inspector and the drawer under the chart.
      sideOpen: true,
      sideWidth: 312,
      drawer: "cells",
      drawerOpen: false,
      drawerHeight: 260,
      cellSort: "time",
      cellDir: -1,
      caseSort: "date",
      caseDir: -1,
    };
  let sources = {},
    G = {},
    colors = {},
    hover = null,
    tableHover = null,
    coverageGap = false,
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
  // Formats: the one place for how durations, numbers and times read.
  //
  // Durations use their two largest whole units: "1 min 52.5 s", "21 d 8 h";
  // past a year, years to one decimal.
  const DAY = 86400,
    YEAR = 365.25 * DAY;
  const dur = (s) => {
    if (s >= YEAR) return `${+(s / YEAR).toFixed(1)} y`;
    if (s < 60) return `${+s.toFixed(2)} s`;
    const [big, small, bigUnit, smallUnit] =
      s < 3600 ? [60, 1, "min", "s"] : s < DAY ? [3600, 60, "h", "min"] : [DAY, 3600, "d", "h"];
    let whole = Math.floor(s / big),
      rest = +((s - whole * big) / small).toFixed(smallUnit === "s" ? 2 : 0);
    if (rest * small >= big) {
      whole++;
      rest = 0;
    }
    return `${whole} ${bigUnit}` + (rest ? ` ${rest} ${smallUnit}` : "");
  };
  // Compact numbers carry three significant digits: "96.0 k", "32.0 M", "1.92 B".
  const compact = (x) => {
    const sign = x < 0 ? "−" : "",
      a = Math.abs(x);
    // Below a thousand, unless rounding to three digits reaches it.
    if (a < 1000 && +a.toPrecision(3) < 1000)
      return sign + (Number.isInteger(a) ? String(a) : String(+a.toPrecision(3)));
    if (a < 1000) return sign + "1.00 k";
    let i = Math.min(4, Math.floor(Math.log10(a) / 3));
    if (+(a / 1000 ** i).toPrecision(3) >= 1000 && i < 4) i++;
    return sign + (a / 1000 ** i).toPrecision(3) + " " + " kMBT"[i];
  };
  // A signed value with a true minus sign: "+125", "−125".
  const signed = (x, f) => (x > 0 ? "+" : x < 0 ? "−" : "") + f(Math.abs(x));
  const integer = (x) => Math.round(x).toLocaleString("en-US"),
    price = (x) => x.toLocaleString("en-US", { maximumFractionDigits: 2 }),
    usdt = (x) =>
      x.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    // To the nearest millisecond, so a time read back from the address is the same time.
    date = (b) => new Date(Math.round((T0 + b * BASE) * 1000)),
    // ISO is for the query and view codes only.
    iso = (b) => date(b).toISOString();
  // Times read one way everywhere, matching the axis: "24 Sep 12:02", with the
  // year only when it differs from the cutoff's and seconds only when set.
  let CUT_YEAR = date(CUT).getUTCFullYear();
  const dayMonth = d3.utcFormat("%-d %b"),
    clock = (d) =>
      d3.utcFormat(
        d.getUTCMilliseconds()
          ? "%H:%M:%S.%L"
          : d.getUTCSeconds()
            ? "%H:%M:%S"
            : "%H:%M",
      )(d),
    dayOf = (d, year = d.getUTCFullYear() !== CUT_YEAR) =>
      dayMonth(d) + (year ? " " + d.getUTCFullYear() : ""),
    // "24 Sep 2026"
    day = (b) => dayOf(date(b), true),
    // "24 Sep 12:02:48.750"
    when = (b) => {
      const d = date(b);
      return `${dayOf(d)} ${clock(d)}`;
    },
    // A range names its day once: ["21 Sep 14:00–16:00"], or across days
    // ["23 Sep 12:02 →", "24 Sep 12:02"], as parts that wrap between them.
    rangeParts = (a, b) => {
      const x = date(a),
        y = date(b);
      return dayOf(x) === dayOf(y)
        ? [`${dayOf(x)} ${clock(x)}–${clock(y)}`]
        : [`${dayOf(x)} ${clock(x)} →`, `${dayOf(y)} ${clock(y)}`];
    },
    range = (a, b) => rangeParts(a, b).join(" ");
  // A span in its largest unit, to a tenth below ten: "45 s", "6.7 min",
  // "12 h", "3.5 d", "1.2 y".
  const spanText = (s) => {
    const [v, unit] =
      s < 60
        ? [s, "s"]
        : s < 3600
          ? [s / 60, "min"]
          : s < DAY
            ? [s / 3600, "h"]
            : s < 365 * DAY
              ? [s / DAY, "d"]
              : [s / (365 * DAY), "y"];
    return `${+v.toFixed(v < 10 ? 1 : 0)} ${unit}`;
  };
  // Elapsed time for the live state, in its largest unit: "8 s", "6 min", "2 h".
  const elapsed = (ms) => {
      const s = Math.max(0, Math.round(ms / 1000));
      return s < 60
        ? `${s} s`
        : s < 3600
          ? `${Math.floor(s / 60)} min`
          : `${Math.floor(s / 3600)} h`;
    },
    ago = (ms) => (ms < 5000 ? "just now" : `${elapsed(ms)} ago`);
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
      "accent",
      "neutral",
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
    G = { width, height, ...layout(width, height) };
    G.X = d3
      .scaleLinear()
      .domain([S.tA, S.tB])
      .range([G.x, G.x + G.w]);
    G.Y = d3
      .scaleLinear()
      .domain([S.pA, S.pB])
      .range([G.y + G.h, G.y]);
  }
  const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  function text(s, x, y, color = colors.muted, align = "left", size = TYPE.s) {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.font = `${size}px ${FONT}`;
    ctx.fillText(s, x, y);
  }
  // Chart labels: one style, 11px and sentence case, placed so none covers
  // another. A label tries its own line, then the next ones down and up; with
  // no room left it is left out. The rects taken reset with every frame.
  let labelsTaken = [];
  function chartLabel(s, x, y, color = colors.muted, align = "left") {
    ctx.font = `${TYPE.s}px ${FONT}`;
    const w = ctx.measureText(s).width,
      left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
    for (const dy of [0, 15, -15, 30]) {
      const r = [left - 3, y + dy - 8, left + w + 3, y + dy + 8];
      if (labelsTaken.some((q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]))
        continue;
      labelsTaken.push(r);
      text(s, x, y + dy, color, align);
      return true;
    }
    return false;
  }
  // The crosshair's readouts, as ink chips: the price at the pointer in the
  // price labels' column, the time under the panes. A chip's box is known
  // before it is drawn, so the axes can leave out the labels it would cover.
  function chipBox(s, x, y, align = "center") {
    ctx.font = `${TYPE.s}px ${FONT}`;
    const w = Math.ceil(ctx.measureText(s).width) + 8,
      left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    return [left, y - 8, left + w, y + 8];
  }
  function chip(s, [left, top, right, bottom]) {
    ctx.fillStyle = colors.ink;
    ctx.beginPath();
    ctx.roundRect(left, top, right - left, bottom - top, 2);
    ctx.fill();
    text(s, (left + right) / 2, (top + bottom) / 2, colors.bg, "center");
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
  // Ticks sit on the lattice, so every gridline is a cell edge: prices at
  // multiples of the price step, times at column edges. The round ticks d3
  // picks are kept when they are edges; otherwise the step doubles from one
  // cell until the labels have room.
  function priceTicks() {
    const step = stepP() * PR,
      want = Math.max(3, Math.floor(G.h / 56)),
      round = d3.ticks(S.pA * PR, S.pB * PR, want);
    if (round.length && round.every((p) => Number.isInteger(p / step)))
      return round;
    let t = step;
    while (((S.pB - S.pA) * PR) / t > want) t *= 2;
    return d3.range(Math.ceil((S.pA * PR) / t) * t, S.pB * PR, t);
  }
  function timeTicks() {
    const step = stepT(),
      want = G.width < 400 ? 3 : G.width < 650 ? 4 : 5,
      base = (d) => (+d / 1000 - T0) / BASE,
      round = d3
        .scaleUtc()
        .domain([date(S.tA), date(S.tB)])
        .ticks(want)
        .map(base);
    if (round.length > 1 && round.every((b) => Math.abs(b / step - Math.round(b / step)) < 1e-6))
      return round;
    let t = step;
    while ((S.tB - S.tA) / t > want) t *= 2;
    return d3.range(Math.ceil(S.tA / t) * t, S.tB, t);
  }
  // Labels follow the tick step, so two adjacent labels never repeat: a day
  // names its date, and a tick off midnight its time too.
  function timeFormat(ticks) {
    const dayMs = DAY * 1000,
      ms = ticks.map((b) => +date(b)),
      step = ms.length > 1 ? ms[1] - ms[0] : (S.tB - S.tA) * BASE * 1000,
      midnight = ms.every((x) => x % dayMs === 0);
    if (step < dayMs) {
      const time = d3.utcFormat(step < 60e3 ? "%H:%M:%S" : "%H:%M");
      return (d) => (+d % dayMs === 0 ? dayMonth(d) : time(d));
    }
    if (step >= 28 * dayMs)
      return midnight
        ? d3.utcFormat(step < 365 * dayMs ? "%b %Y" : "%Y")
        : (d) => dayOf(d, true);
    return midnight ? dayMonth : (d) => `${dayMonth(d)} ${d3.utcFormat("%H:%M")(d)}`;
  }
  // Gridlines at the ticks only, on whole pixels: prices across the price
  // pane, times down whichever pane is drawing (y0 to y1).
  function timeGrid(y0, y1) {
    for (const t of timeTicks()) {
      if (t > CUT) continue;
      const x = Math.round(G.X(t)) + 0.5;
      line(x, y0, x, y1, colors.line, 1, 0.7);
    }
  }
  function grid() {
    for (const p of priceTicks()) {
      const y = Math.round(G.Y(p / PR)) + 0.5;
      line(G.x, y, G.x + G.w, y, colors.line, 1, 0.7);
    }
    timeGrid(G.y, G.y + G.h);
  }
  function axes(ro) {
    ctx.globalAlpha = 1;
    ctx.font = `${TYPE.s}px ${FONT}`;
    // A tick label a crosshair readout covers, or nearly touches, is left out
    // rather than shown in part.
    const covered = (box, l, t, r, b) =>
      box && l < box[2] + 3 && box[0] - 3 < r && t < box[3] + 3 && box[1] - 3 < b;
    // Tick labels keep clear of the pane's edges, where the unit and the
    // activity pane's scale sit.
    for (const p of priceTicks()) {
      const y = G.Y(p / PR),
        s = price(p),
        left = G.x - 8 - ctx.measureText(s).width;
      if (
        y >= G.y + 10 &&
        y <= G.y + G.h - 4 &&
        !covered(ro?.price?.box, left, y - 7, G.x - 8, y + 7)
      )
        text(s, G.x - 8, y, colors.muted, "right");
    }
    text("USDT", G.x - 8, G.y - 5, colors.muted, "right");
    const ticks = timeTicks(),
      fmt = timeFormat(ticks);
    let previous = null;
    for (const b of ticks) {
      const x = G.X(b),
        label = fmt(date(b)),
        half = ctx.measureText(label).width / 2;
      // Nothing is labelled after the cutoff: that time has no trades yet.
      if (b > CUT || x < G.x + 7 || x > G.x + G.w - 7 || label === previous)
        continue;
      if (covered(ro?.time.box, x - half, G.axis - 7, x + half, G.axis + 7))
        continue;
      text(label, x, G.axis, colors.muted, "center");
      previous = label;
    }
    text("UTC", G.x - 8, G.axis, colors.muted, "right");
    line(G.x, G.y + G.h, G.x + G.w, G.y + G.h, colors.line);
    line(G.x, G.ay + G.ah, G.x + G.w, G.ay + G.ah, colors.line);
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
    labelsTaken = [];
    // Latest sits over the plot's top right when it shows, and the replay
    // transport on the replay line: labels keep clear of both.
    if (!el("latest").hidden) {
      const right = G.x + G.w - 8;
      labelsTaken.push([right - el("latest").offsetWidth, 16, right, 16 + el("latest").offsetHeight]);
    }
    // The lens's controls sit at the plot's top left while it is the tool.
    let lensRight = 0;
    if (S.lens) {
      const bar = el("lensbar");
      bar.style.left = G.x + 4 + "px";
      lensRight = G.x + 4 + bar.offsetWidth;
      labelsTaken.push([G.x + 4, 16, lensRight, 20 + bar.offsetHeight]);
    }
    if (S.replay) {
      // The transport stays inside the plot: where one row is too wide for it
      // (a phone's touch targets), it wraps onto a second. It keeps clear of
      // the lens's controls, beside them or else under them.
      const bar = el("transport");
      bar.style.maxWidth = Math.max(0, G.w - 8) + "px";
      const w = bar.offsetWidth,
        beside = lensRight ? lensRight + 8 : G.x + 4,
        room = beside <= G.x + G.w - w - 4,
        top = room ? 20 : 26 + el("lensbar").offsetHeight,
        left = clamp(G.X(cut) - w / 2, room ? beside : G.x + 4, G.x + G.w - w - 4);
      bar.style.left = left + "px";
      bar.style.top = top + "px";
      labelsTaken.push([left, top - 4, left + w, top + bar.offsetHeight]);
    }
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
      const ev = settledEvidence();
      // Busy until a result for this view is up: the panel may still show the last one.
      el("evidence").setAttribute("aria-busy", String(!ev || ev !== evidence.ready));
      if (ev) {
        drawCone(ev);
        evidenceUI(ev);
      }
    } else if (S.drawerOpen && S.drawer === "cases") {
      const ev = settledEvidence();
      if (ev) evidenceCases(ev);
    }
    if (S.selection) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        G.X(b[0]),
        G.Y(b[3]),
        G.X(b[1]) - G.X(b[0]),
        G.Y(b[2]) - G.Y(b[3]),
      );
      // While a selection is dragged the rectangle under the pointer shows
      // too, dashed; the solid outline is the cells it takes in.
      if (S.select && drag?.moved && !drag.lens) {
        const [ta, tb, pa, pb] = S.selection;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(G.X(ta), G.Y(pb), G.X(tb) - G.X(ta), G.Y(pa) - G.Y(pb));
        ctx.setLineDash([]);
      }
    }
    const xc = G.X(cut);
    if (xc >= G.x && xc <= G.x + G.w) {
      line(xc, G.y, xc, G.y + G.h, colors.muted, 1, 0.7);
      if (xc < G.x + G.w - 50)
        chartLabel(S.replay ? "Replay" : "Cutoff", xc + 6, G.y + 12);
    }
    if (
      S.anchor !== null &&
      !S.replay &&
      (S.tab === "evidence" || (S.drawerOpen && S.drawer === "cases"))
    ) {
      const x = G.X(Math.floor(S.anchor / ts) * ts);
      ctx.setLineDash([3, 4]);
      line(x, G.y, x, G.y + G.h, colors.evidence, 1, 0.65);
      ctx.setLineDash([]);
    }
    // The crosshair's price line and the cell under the pointer; its time line
    // runs through both panes (see crosshair).
    if (hover && inPlot(hover) && hover.t < cut) {
      const y = Math.round(hover.y) + 0.5;
      line(G.x, y, G.x + G.w, y, colors.muted, 1, 0.6);
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
    // The cell of the table row under the pointer, outlined on the chart.
    if (tableHover) {
      const { c, r } = tableHover;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        G.X(c * ts) - 1,
        G.Y((r + 1) * ps) - 1,
        G.X((c + 1) * ts) - G.X(c * ts) + 2,
        G.Y(r * ps) - G.Y((r + 1) * ps) + 2,
      );
    }
    // The profile row under the pointer, as a band across the prices.
    if (hover?.row != null && onProfile(hover)) {
      const ya = G.Y((hover.row + 1) * ps),
        yb = G.Y(hover.row * ps);
      ctx.fillStyle = colors.ink;
      ctx.globalAlpha = 0.06;
      ctx.fillRect(G.x, ya, G.w, yb - ya);
      ctx.globalAlpha = 1;
    }
    drawResolutionLens();
    ctx.restore();
    const ro = readouts(cut);
    axes(ro);
    profile(query, b);
    activity(query, cut);
    crosshair(ro);
    querySummary(query, b);
    el("legend-text").textContent = legendText(full);
    el("legend-text").title = LEGEND_TITLES[S.mode];
    el("ramp").style.background = legendRamp();
    const marks = marksReadout(b);
    el("ray-count").textContent = marks.rayCount + " untested levels";
    el("ray-count").hidden = !S.untested;
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
  // The crosshair's readouts where the pointer is on either pane, each rounded
  // to what a pixel can tell apart, with the box its chip takes.
  function readouts(cut) {
    if (!hover || hover.t >= cut || !(inPlot(hover) || inActivity(hover)))
      return null;
    let price = null;
    if (inPlot(hover)) {
      // The price goes to the finest round step (1, 2 or 5 × 10ⁿ USDT) no
      // smaller than a pixel.
      const perPx = ((S.pB - S.pA) * PR) / G.h,
        power = 10 ** Math.floor(Math.log10(perPx)),
        step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= perPx),
        digits = clamp(-Math.floor(Math.log10(step)), 0, 2),
        s = (Math.round((hover.p * PR) / step) * step).toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
      price = {
        s,
        box: chipBox(s, G.x - 3, clamp(hover.y, G.y + 8, G.y + G.h - 8), "right"),
      };
    }
    // The time goes to the finest round step no shorter than a pixel: seconds,
    // minutes and hours in steps of 1, 5, 15 and 30 (hours 1, 3, 6 and 12),
    // then a day, a week (Monday to Sunday), a month and a year. A time rounds
    // to the nearest step; a day or longer is the one the pointer is in.
    const secondsPerPx = ((S.tB - S.tA) * BASE) / G.w,
      at = date(hover.t),
      unit = [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 10800, 21600, 43200].find(
        (u) => u >= secondsPerPx,
      ),
      d = unit && new Date(Math.round(+at / (unit * 1000)) * unit * 1000),
      monday = d3.utcMonday.floor(at),
      sunday = d3.utcDay.offset(monday, 6),
      label = unit
        ? `${dayOf(d)} ${d3.utcFormat(unit < 60 ? "%H:%M:%S" : "%H:%M")(d)}`
        : secondsPerPx <= DAY
          ? dayOf(at, true)
          : secondsPerPx <= 7 * DAY
            ? (monday.getUTCMonth() === sunday.getUTCMonth()
                ? `${monday.getUTCDate()}–`
                : `${dayMonth(monday)} – `) + dayOf(sunday, true)
            : d3.utcFormat(secondsPerPx <= 31 * DAY ? "%b %Y" : "%Y")(at);
    ctx.font = `${TYPE.s}px ${FONT}`;
    const half = Math.ceil(ctx.measureText(label).width) / 2 + 4;
    return {
      price,
      time: {
        s: label,
        box: chipBox(label, clamp(hover.x, G.x + half, G.x + G.w - half), G.axis),
      },
    };
  }
  // The crosshair's time line runs through both panes wherever the pointer is
  // on either, so a bar lines up with its column of cells, and its readouts
  // sit on the axes.
  function crosshair(ro) {
    if (!ro) return;
    const x = Math.round(hover.x) + 0.5;
    line(x, G.y, x, G.y + G.h, colors.muted, 1, 0.6);
    line(x, G.ay, x, G.ay + G.ah, colors.muted, 1, 0.6);
    if (ro.price) chip(ro.price.s, ro.price.box);
    chip(ro.time.s, ro.time.box);
  }
  // Each tool's cursor over the prices: grab to pan, grabbing while dragging, a
  // crosshair to select, zoom for the lens (held Alt and a touch hold too).
  function setCursor(p = nav.last) {
    const cursor = !p || !inPlot(p)
      ? ""
      : S.lens || nav.alt || nav.hold || drag?.lens
        ? "zoom-in"
        : S.select
          ? "crosshair"
          : drag
            ? "grabbing"
            : "grab";
    if (canvas.dataset.cursor !== cursor) canvas.dataset.cursor = cursor;
  }
  function inActivity(p) {
    return p.x >= G.x && p.x <= G.x + G.w && p.y >= G.ay && p.y <= G.ay + G.ah;
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
  // A window ends at the cutoff, with a tenth of its length to spare after it;
  // this year starts on its first day, and last year is the whole calendar
  // year before the cutoff's.
  function windowRange(key) {
    const yearStart = (y) => Math.max(0, (Date.UTC(y, 0, 1) / 1000 - T0) / BASE);
    if (key === "lastyear") {
      S.tA = yearStart(CUT_YEAR - 1);
      S.tB = Math.max(S.tA + 1, yearStart(CUT_YEAR));
      return;
    }
    S.tA =
      key === "all"
        ? 0
        : key === "ytd"
          ? yearStart(CUT_YEAR)
          : Math.max(0, CUT - windowOf(key).span);
    S.tB = Math.max(S.tA + 1, CUT + (CUT - S.tA) * 0.105);
  }
  function setWindow(key) {
    const w = windowOf(key);
    S.window = key;
    S.selection = null;
    S.anchor = null;
    S.replay = false;
    windowRange(key);
    chooseSource();
    // The window's own level, for about a hundred columns; auto level then
    // fits it to the screen.
    S.n = w.n;
    S.m = w.m;
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
  // This browser keeps the workspace and the last view for every tab: the
  // panels, the drawer, the tables' sorts and the lens depth. The view itself
  // lives in the address, so each tab keeps its own.
  const PREFS = [
    "sideOpen",
    "sideWidth",
    "drawer",
    "drawerOpen",
    "drawerHeight",
    "cellSort",
    "cellDir",
    "caseSort",
    "caseDir",
    "lensDepth",
  ];
  function save() {
    if (!ready) return;
    syncURL();
    saveHistory();
    if (!window.explorerState) return;
    try {
      window.explorerState.save({
        version: 5,
        prefs: Object.fromEntries(PREFS.map((k) => [k, S[k]])),
        view: viewHash(),
      });
    } catch (error) {
      el("copy-status").textContent =
        "This tab keeps the view; this browser's storage is unavailable.";
    }
  }
  function restorePrefs(x) {
    for (const k of ["sideOpen", "drawerOpen"])
      if (typeof x[k] === "boolean") S[k] = x[k];
    // A view saved before the drawer kept its table open as `table`.
    if (x.table === true && typeof x.drawerOpen !== "boolean") {
      S.drawerOpen = true;
      S.drawer = "cells";
    }
    if (Number.isFinite(x.sideWidth)) S.sideWidth = clamp(x.sideWidth, 260, 560);
    if (Number.isFinite(x.drawerHeight))
      S.drawerHeight = clamp(x.drawerHeight, 120, 900);
    if (["cells", "cases", "query"].includes(x.drawer)) S.drawer = x.drawer;
    if (CELL_SORTS.includes(x.cellSort)) S.cellSort = x.cellSort;
    if (CASE_SORTS.includes(x.caseSort)) S.caseSort = x.caseSort;
    if (x.cellDir === 1 || x.cellDir === -1) S.cellDir = x.cellDir;
    if (x.caseDir === 1 || x.caseDir === -1) S.caseDir = x.caseDir;
    if (Number.isFinite(x.lensDepth))
      S.lensDepth = clamp(Math.round(x.lensDepth), 1, 4);
  }
  // The workspace and last view this browser saved; version 4 kept both in one
  // object with the view as raw state.
  function restore(x) {
    if (!x || (x.version !== 4 && x.version !== 5)) return false;
    restorePrefs(x.version === 5 ? x.prefs || {} : x);
    const view =
      x.version === 5
        ? typeof x.view === "string"
          ? readView(x.view)
          : null
        : checkView({
            window: x.window,
            tA: x.tA,
            tB: x.tB,
            pA: x.pA,
            pB: x.pB,
            auto: x.auto !== false,
            n: x.n,
            m: x.m,
            follow: x.diagonal
              ? "diagonal"
              : x.coupled
                ? "coupled"
                : x.refit === false
                  ? "free"
                  : "refit",
            mode: x.mode,
            poc: x.poc !== false,
            area: x.area === true,
            untested: x.untested === true,
            selection: x.selection,
            anchor: x.anchor,
            replay: x.replay === true,
            tab: x.tab,
            evidenceKind: x.evidenceKind,
            horizon: x.horizon,
            barrier: x.barrier,
          });
    if (view) applyView(view);
    return Boolean(view);
  }

  // A view in the address: the window or the rectangle, the level when it is
  // locked, and each display setting that differs from its default. Times are
  // UTC and prices USDT. A window is relative: it opens on the latest data
  // wherever the cutoff has moved; a rectangle opens where it was.
  // The time windows, in order: each one's key in the address, its name on
  // the bar and in the list, how lists name it, its length and its level.
  const HOUR = 3600 / BASE,
    DAYS = DAY / BASE,
    WINDOWS = [
      { key: "15m", short: "15m", name: "15 minutes", label: "Last 15 minutes", span: HOUR / 4, n: 0, m: 0 },
      { key: "30m", short: "30m", name: "30 minutes", label: "Last 30 minutes", span: HOUR / 2, n: 0, m: 0 },
      { key: "1h", short: "1h", name: "1 hour", label: "Last hour", span: HOUR, n: 0, m: 0 },
      { key: "4h", short: "4h", name: "4 hours", label: "Last 4 hours", span: 4 * HOUR, n: 1, m: 0 },
      { key: "12h", short: "12h", name: "12 hours", label: "Last 12 hours", span: 12 * HOUR, n: 3, m: 0 },
      { key: "24h", short: "24h", name: "24 hours", label: "Last 24 hours", span: DAYS, n: 4, m: 0 },
      { key: "7d", short: "7d", name: "7 days", label: "Last 7 days", span: 7 * DAYS, n: 6, m: 0 },
      { key: "30d", short: "30d", name: "30 days", label: "Last 30 days", span: 30 * DAYS, n: 8, m: 1 },
      { key: "1y", short: "1y", name: "1 year", label: "Last 12 months", span: 365 * DAYS, n: 12, m: 3 },
      { key: "ytd", name: "This year", n: 12, m: 3 },
      { key: "lastyear", name: "Last year", n: 12, m: 3 },
      { key: "all", short: "All", name: "All history", label: "All history", n: 14, m: 3 },
    ],
    // The number keys choose the windows in order, and 0 all history.
    WINDOW_KEYS = ["all", "15m", "30m", "1h", "4h", "12h", "24h", "7d", "30d", "1y"],
    windowOf = (key) => WINDOWS.find((w) => w.key === key),
    // Views and history stored before these windows name 24 hours and 7 days
    // "1" and "7".
    windowKey = (key) =>
      key === "1" ? "24h" : key === "7" ? "7d" : windowOf(key) ? key : "",
    // The bar names the calendar windows by their year, and lists too.
    windowShort = (key) =>
      key === "ytd"
        ? String(CUT_YEAR)
        : key === "lastyear"
          ? String(CUT_YEAR - 1)
          : windowOf(key).short,
    windowLabel = (key) =>
      key === "ytd"
        ? `${CUT_YEAR} so far`
        : key === "lastyear"
          ? String(CUT_YEAR - 1)
          : windowOf(key).label,
    FOLLOWS = ["free", "refit", "coupled", "diagonal"],
    // How the price range follows a time zoom: each mode's name, what it does
    // and its key, for the bar's price axis menu.
    FOLLOW_INFO = {
      free: { name: "Free", desc: "Zooming time leaves the price range alone" },
      refit: {
        name: "Refit",
        desc: "Zooming time refits the price range to the visible trades",
      },
      coupled: { name: "Coupled", desc: "Zooming time zooms price by the same factor" },
      diagonal: {
        name: "Diagonal",
        desc: "Zooming time by k zooms price by √k, and the price level follows the measured diagonal",
        keys: "D",
      },
    },
    // Icons the page builds, 16 units square, drawn with the icon stroke.
    ICONS = {
      check: '<path d="m3.5 8.5 3 3 6-7"/>',
      free:
        '<path d="M3.5 2.5v11"/><path d="M6.5 8h7M6.5 8l1.8-1.8M6.5 8l1.8 1.8M13.5 8l-1.8-1.8M13.5 8l-1.8 1.8"/>',
      refit:
        '<path d="M5.5 3h-2v10h2M10.5 3h2v10h-2"/><path d="M8 5v6M8 5 6.6 6.4M8 5l1.4 1.4M8 11l-1.4-1.4M8 11l1.4-1.4"/>',
      coupled:
        '<rect x="3" y="3" width="10" height="10" rx="1"/><path d="M6 10l4-4M10 6H7.5M10 6v2.5"/>',
      diagonal: '<path d="M3 13h3v-3h3V7h3V4"/>',
      fit: '<path d="M3 5.5V3h2.5M10.5 3H13v2.5M13 10.5V13h-2.5M5.5 13H3v-2.5"/>',
    },
    MODES = ["volume", "flow", "delta", "geometry"],
    MODE_NAMES = {
      volume: "Volume",
      flow: "Taker flow",
      delta: "Delta",
      geometry: "Geometry",
    };
  function svgIcon(name, className = "ol-icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[name];
    return svg;
  }
  // "2026-09-24T10:00Z", with seconds and milliseconds only when set.
  const stamp = (b) =>
      date(b).toISOString().replace(".000Z", "Z").replace(/:00Z$/, "Z"),
    usd = (p) => String(+(p * PR).toFixed(2));
  function viewParams() {
    const out = [],
      add = (k, v) => out.push(k + "=" + v);
    if (S.window) add("w", S.window);
    else {
      add("t", stamp(S.tA) + "~" + stamp(S.tB));
      add("p", usd(S.pA) + "~" + usd(S.pB));
    }
    if (!S.auto) add("r", S.n + "," + S.m);
    if (followMode() !== "refit") add("f", followMode());
    if (S.mode !== "volume") add("mode", S.mode);
    const marks = ["poc", "area", "untested"].filter((k) => S[k]).join(",");
    if (marks !== "poc") add("marks", marks || "none");
    if (S.selection) {
      const [a, b, p, q] = S.selection;
      add("sel", `${stamp(a)}~${stamp(b)},${usd(p)}~${usd(q)}`);
    }
    if (S.anchor !== null) add("at", stamp(S.anchor));
    if (S.replay) add("replay", "1");
    if (S.tab === "evidence") add("tab", "continuations");
    if (S.evidenceKind === "barrier") add("outcome", "barrier");
    if (S.horizon !== 1) add("h", S.horizon);
    if (S.barrier !== 1) add("dist", S.barrier);
    return out.join("&");
  }
  const viewHash = () => "#" + viewParams();
  // A view from an address, or null when it names no window or rectangle.
  // Anything unreadable falls back to its default rather than being guessed.
  function readView(hash) {
    const q = new Map();
    for (const part of String(hash).replace(/^#/, "").split("&")) {
      const i = part.indexOf("=");
      try {
        if (i > 0) q.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1)));
      } catch {
        // A malformed escape leaves its parameter out.
      }
    }
    const time = (s) => (Date.parse(s) / 1000 - T0) / BASE,
      rows = (s) => (s === "" ? NaN : Number(s) / PR),
      pair = (s, f) => {
        const x = String(s ?? "").split("~").map(f);
        return x.length === 2 ? x : [NaN, NaN];
      },
      marks = String(q.get("marks") ?? "poc").split(","),
      level = /^(\d+),(\d+)$/.exec(q.get("r") || ""),
      [selT, selP = ""] = String(q.get("sel") ?? "").split(",");
    return checkView({
      window: windowKey(q.get("w")),
      ...Object.fromEntries(
        [...pair(q.get("t"), time), ...pair(q.get("p"), rows)].map((v, i) => [
          ["tA", "tB", "pA", "pB"][i],
          v,
        ]),
      ),
      auto: !level,
      n: level ? Number(level[1]) : NaN,
      m: level ? Number(level[2]) : NaN,
      follow: q.get("f") || "refit",
      mode: q.get("mode") || "volume",
      poc: marks.includes("poc"),
      area: marks.includes("area"),
      untested: marks.includes("untested"),
      selection: q.has("sel")
        ? [...pair(selT, time), ...pair(selP, rows)].map(Math.round)
        : null,
      anchor: q.has("at") ? Math.round(time(q.get("at"))) : null,
      replay: q.get("replay") === "1",
      tab: q.get("tab") === "continuations" ? "evidence" : "context",
      evidenceKind: q.get("outcome") === "barrier" ? "barrier" : "poc",
      horizon: Number(q.get("h") || 1),
      barrier: Number(q.get("dist") || 1),
    });
  }
  // A view whose every part can be shown here, or null without a window or a
  // rectangle. Parts that can't be are dropped: a replay after this page's
  // cutoff, a selection outside its history.
  function checkView(v) {
    const ok = (...x) => x.every(Number.isFinite),
      w = windowKey(v.window);
    if (
      !w &&
      !(
        ok(v.tA, v.tB, v.pA, v.pB) &&
        v.tB > v.tA &&
        v.pB > v.pA &&
        v.tA < CUT &&
        v.pA >= 0
      )
    )
      return null;
    const sel = Array.isArray(v.selection) ? v.selection : [],
      anchor =
        Number.isFinite(v.anchor) && v.anchor > 0 && v.anchor <= CUT
          ? v.anchor
          : null,
      locked = v.auto === false && ok(v.n, v.m);
    return {
      window: w,
      tA: v.tA,
      tB: v.tB,
      pA: v.pA,
      pB: v.pB,
      auto: !locked,
      n: locked ? clamp(Math.round(v.n), 0, N_MAX) : null,
      m: locked ? clamp(Math.round(v.m), 0, M_MAX) : null,
      follow: FOLLOWS.includes(v.follow) ? v.follow : "refit",
      mode: MODES.includes(v.mode) ? v.mode : "volume",
      poc: v.poc !== false,
      area: v.area === true,
      untested: v.untested === true,
      selection:
        sel.length === 4 &&
        ok(...sel) &&
        sel[0] >= 0 &&
        sel[1] > sel[0] &&
        sel[0] < CUT &&
        sel[2] >= 0 &&
        sel[3] > sel[2]
          ? [sel[0], Math.min(sel[1], Math.floor(CUT)), sel[2], sel[3]]
          : null,
      anchor,
      replay: v.replay === true && anchor !== null,
      tab: v.tab === "evidence" ? "evidence" : "context",
      evidenceKind: v.evidenceKind === "barrier" ? "barrier" : "poc",
      horizon: [1, 2, 4, 8].includes(v.horizon) ? v.horizon : 1,
      barrier: [1, 2, 4].includes(v.barrier) ? v.barrier : 1,
    };
  }
  // Put a checked view in place.
  function applyView(v) {
    if (v.window) setWindow(v.window);
    else {
      [S.tA, S.tB, S.pA, S.pB] = [v.tA, v.tB, v.pA, v.pB];
      S.window = "";
    }
    S.auto = v.auto;
    if (!v.auto) {
      S.n = v.n;
      S.m = v.m;
    }
    S.refit = v.follow === "refit";
    S.coupled = v.follow === "coupled";
    S.diagonal = v.follow === "diagonal";
    for (const k of [
      "mode",
      "poc",
      "area",
      "untested",
      "selection",
      "anchor",
      "replay",
      "tab",
      "evidenceKind",
      "horizon",
      "barrier",
    ])
      S[k] = v[k];
    hover = null;
    el("tip").hidden = true;
    confine();
    if (S.auto) autoLevel();
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
      ? `Rendered coverage: ${range(b[0], b[1])} UTC; ${price(b[2] * PR)}–${price(b[3] * PR)} USDT; ${dur(BASE * stepT())} × ${price(PR * stepP())} USDT. Finer bounds remain unavailable in this snapshot.`
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
      S.drawer = "query";
      S.drawerOpen = true;
      applyPanels();
      el("query-text").focus();
      el("query-text").select();
      el("copy-status").textContent = "Selected for copy · ⌘C / Ctrl+C";
    }
  }
  // Pasted text as a query or view-code object; null when it is neither, so
  // the parser's own error never reaches the status line.
  function readImport(text) {
    try {
      const obj = JSON.parse(
        text.startsWith("origo-cube:")
          ? decodeURIComponent(text.slice(11))
          : text,
      );
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }
  function applyImportedView() {
    const obj = readImport(el("import-text").value.trim());
    if (!obj) {
      el("copy-status").textContent =
        "That isn't a cube query or a view code. Paste the JSON from Copy query, or a view code (it starts with origo-cube:).";
      return;
    }
    try {
      const q = obj.query || obj;
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
        const v = obj.view,
          // Density folded into Volume: a code that asks for it opens as Volume.
          mode = v.mode === "density" ? "volume" : v.mode;
        if (MODES.includes(mode)) S.mode = mode;
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
      recordView("Restored query");
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
      xe = clamp(G.X(Math.min(src.b1, cut)), G.x, G.x + G.w),
      xc = clamp(G.X(cut), G.x, G.x + G.w);
    hatchRect(G.x, G.y, x0 - G.x, G.h, colors.line, 11, 0.6);
    // Recorded time the source does not cover.
    hatchRect(xe, G.y, xc - xe, G.h, colors.line, 11, 0.45);
    // After the cutoff: hidden in replay, otherwise the future, left plain.
    if (S.replay)
      hatchRect(xc, G.y, G.x + G.w - xc, G.h, colors.line, 11, 0.45);
    else {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(xc, G.y, G.x + G.w - xc, G.h);
    }
    if (x0 - G.x > 100)
      chartLabel(
        Object.values(loadState).includes("loading")
          ? "Loading history"
          : "Unavailable",
        G.x + 8,
        G.y + 12,
      );
    if (xc - xe > 80) chartLabel("Unavailable", xe + 8, G.y + G.h - 12);
    if (S.replay && G.x + G.w - xc > 90)
      chartLabel("Future hidden", xc + 8, G.y + G.h - 12);
    const r = requestedBounds();
    // The status bar keys "Unavailable / hidden" only while such a region shows.
    coverageGap =
      x0 - G.x > 1 ||
      xc - xe > 1 ||
      (S.replay && G.x + G.w - xc > 1) ||
      b.some((x, i) => x !== r[i]);
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
        chartLabel("Open", clamp(xa + 3, G.x + 4, G.x + G.w - 36), G.y + 28, colors.poc);
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
      ? "Ready part"
      : S.selection
        ? "Selection"
        : "In view";
    el("focus-title").title = partialCoverage
      ? "Only this part of the requested rectangle is recorded at this level"
      : "";
    // Each date and the price range stay whole; lines break only between them.
    const times = rangeParts(b[0], b[1]);
    times[times.length - 1] += " UTC";
    el("bounds").replaceChildren(
      ...[...times, `· ${price(b[2] * PR)}–${price(b[3] * PR)} USDT`].flatMap(
        (part, i) => {
          const span = document.createElement("span");
          span.textContent = part;
          return i ? [" ", span] : [span];
        },
      ),
    );
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
      signed(2 * query.bv - query.v, compact) + " USDT";
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
    // The key names each state; its count lives with the cell counts.
    el("key-zero").hidden = zero === 0;
    el("key-open").hidden = openRows === 0;
    el("key-unavailable").hidden = !coverageGap;
    el("data-coarse").hidden = !(renderN() > S.n || renderM() > S.m);
    queryUI(b);
    renderCells(query, b);
  }
  // The drawer's cells table: sortable, a hundred rows a page, and linked to
  // the chart both ways through the cell under the pointer. It is rebuilt a
  // moment after the view settles, so panning never waits on it.
  const CELLS_PAGE = 100;
  let cellRows = new Map(),
    hoverRow = null,
    cellsTimer = 0;
  function cellState(c, b) {
    const open = !S.replay && (c.c + 1) * stepT() > CUT,
      portion =
        c.c * stepT() < b[0] ||
        (c.c + 1) * stepT() > b[1] ||
        c.r * stepP() < b[2] ||
        (c.r + 1) * stepP() > b[3];
    return [open ? "unfinished" : "complete", portion ? "portion" : ""]
      .filter(Boolean)
      .join(" · ");
  }
  function renderCells(query, b) {
    if (!(S.drawerOpen && S.drawer === "cells")) return;
    clearTimeout(cellsTimer);
    cellsTimer = setTimeout(() => buildCells(query, b), 80);
  }
  function buildCells(query, b) {
    const key = [S.n, S.m, b.join(","), S.cellSort, S.cellDir].join("|");
    if (key !== tableKey) {
      tablePage = 0;
      tableKey = key;
    }
    const value = {
        time: (c) => c.c,
        price: (c) => c.r,
        volume: (c) => c.v,
        trades: (c) => c.ct,
        buyvol: (c) => c.bv,
        buytrades: (c) => c.bt,
        state: (c) => cellState(c, b),
      }[S.cellSort],
      cells = query.cells
        .slice()
        .sort(
          (x, y) =>
            (value(x) < value(y) ? -1 : value(x) > value(y) ? 1 : 0) *
              S.cellDir ||
            y.c - x.c ||
            x.r - y.r,
        ),
      pages = Math.max(1, Math.ceil(cells.length / CELLS_PAGE));
    tablePage = clamp(tablePage, 0, pages - 1);
    const frag = document.createDocumentFragment();
    cellRows = new Map();
    for (const c of cells.slice(
      tablePage * CELLS_PAGE,
      (tablePage + 1) * CELLS_PAGE,
    )) {
      const tr = document.createElement("tr");
      tr.dataset.c = c.c;
      tr.dataset.r = c.r;
      const values = [
        range(
          Math.max(c.c * stepT(), b[0]),
          Math.min((c.c + 1) * stepT(), b[1]),
        ),
        price(Math.max(c.r * stepP(), b[2]) * PR) +
          "–" +
          price(Math.min((c.r + 1) * stepP(), b[3]) * PR),
        usdt(c.v),
        integer(c.ct),
        usdt(c.bv),
        integer(c.bt),
        cellState(c, b),
      ];
      for (const v of values) {
        const td = document.createElement("td");
        td.textContent = v;
        tr.append(td);
      }
      cellRows.set(c.c + "," + c.r, tr);
      frag.append(tr);
    }
    el("table-body").replaceChildren(frag);
    hoverRow = null;
    el("table-caption").textContent =
      `${integer(cells.length)} occupied cells in view · zero cells omitted`;
    el("table-page").textContent = `${tablePage + 1} / ${pages}`;
    el("table-back").disabled = tablePage === 0;
    el("table-next").disabled = tablePage === pages - 1;
    for (const button of qsa("[data-sort]")) {
      const th = button.parentElement;
      if (button.dataset.sort === S.cellSort)
        th.setAttribute("aria-sort", S.cellDir > 0 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    }
  }
  // Outline the table row of the cell under the chart pointer.
  function syncRowHover(key) {
    const tr = key ? cellRows.get(key) || null : null;
    if (tr === hoverRow) return;
    hoverRow?.classList.remove("is-hover");
    tr?.classList.add("is-hover");
    hoverRow = tr;
  }
  // The tooltip: a header naming the cell's time span and price row, then a
  // label and value for each measure. Numbers are compact; Shift shows them
  // exact. Over the price profile it reads out the row under the pointer.
  function tipRows(tip, head, sub, rows, note) {
    const part = (tag, className, textContent) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      node.textContent = textContent;
      return node;
    };
    const list = part("dl", "ol-tip-rows", "");
    for (const [label, value] of rows) list.append(part("dt", "", label), part("dd", "", value));
    tip.replaceChildren(
      part("div", "ol-tip-head", head),
      ...(sub ? [part("div", "ol-tip-sub", sub)] : []),
      ...(rows.length ? [list] : []),
      ...(note ? [part("div", "ol-tip-note", note)] : []),
    );
  }
  function onProfile(p) {
    const px = G.x + G.w + 9;
    return p.x >= px && p.x <= px + G.profile - 8 && p.y >= G.y && p.y <= G.y + G.h;
  }
  function tooltip(p) {
    hover = p;
    const tip = el("tip"),
      exact = nav.shift,
      money = (x) => (exact ? usdt(x) : compact(x)) + " USDT",
      count = (x) => (exact ? integer(x) : compact(x)),
      share = (x) => (x * 100).toFixed(exact ? 2 : 1) + "%",
      note = exact ? "" : "Hold Shift for exact values",
      ps = stepP(),
      priceRow = (r) => `${price(r * ps * PR)}–${price((r + 1) * ps * PR)} USDT`;
    if (last && onProfile(p)) {
      const r = Math.floor(p.p / ps),
        row = last.query.rows.find((x) => x.r === r);
      hover.row = row ? r : null;
      // A profile row is no one cell: the Cells drawer shows none as hovered.
      syncRowHover(null);
      if (!row) tipRows(tip, priceRow(r), "", [], "No trades at this price in view");
      else
        tipRows(
          tip,
          priceRow(r),
          [r === last.query.poc ? "Point of control" : "", r === last.query.bpoc ? "Buy point of control" : ""]
            .filter(Boolean)
            .join(" · "),
          [
            ["Volume", money(row.v)],
            ["Of the profile", share(row.v / last.query.v)],
            ["Trades", count(row.ct)],
            ["Taker buys", `${money(row.bv)} · ${share(row.bv / row.v)}`],
          ],
          note,
        );
    } else if (!last || !inPlot(p)) {
      tip.hidden = true;
      syncRowHover(null);
      requestDraw();
      return;
    } else {
      const ts = stepT(),
        c = Math.floor(p.t / ts),
        r = Math.floor(p.p / ps),
        z = last.query.map.get(c + "," + r),
        src = displaySource(),
        inside =
          p.t >= last.b[0] && p.t < last.b[1] && p.p >= last.b[2] && p.p < last.b[3],
        unavailable = p.t < src.b0 || p.t >= Math.min(src.b1, last.cut) || !inside,
        open = !S.replay && c * ts < CUT && (c + 1) * ts > CUT,
        head = `${range(c * ts, (c + 1) * ts)} UTC · ${dur(ts * BASE)}`,
        coarse = renderN() > S.n || renderM() > S.m ? ["Detail", "coarser than requested"] : null;
      if (unavailable)
        tipRows(tip, head, priceRow(r), [], S.replay && p.t >= last.cut
          ? "Hidden in replay"
          : p.t >= CUT
            ? "After the data cutoff"
            : S.selection
              ? "Outside the selection"
              : "Not recorded at this level");
      else if (!z)
        tipRows(tip, head, priceRow(r), coarse ? [coarse] : [], open ? "Still open: no trades yet" : "No trades in this cell");
      else
        tipRows(
          tip,
          head,
          priceRow(r),
          [
            ["Volume", money(z.v)],
            ["Trades", count(z.ct)],
            ["Taker buys", `${money(z.bv)} · ${share(z.bv / z.v)}`],
            ["Buy − sell", signed(2 * z.bv - z.v, money)],
            ["Column", open ? "Still open" : "Complete"],
            ...(coarse ? [coarse] : []),
          ],
          note,
        );
      syncRowHover(z ? c + "," + r : null);
    }
    tip.hidden = false;
    // Beside the pointer, right of it where it fits, and inside the panes, so it
    // never covers the cell under the pointer or the axis readouts.
    const tw = tip.offsetWidth,
      th = tip.offsetHeight,
      right = p.x + 16,
      left = right + tw <= G.x + G.w - 4 || onProfile(p) ? right : p.x - 16 - tw;
    tip.style.left = clamp(onProfile(p) ? p.x - 16 - tw : left, 4, G.width - tw - 4) + "px";
    tip.style.top = clamp(p.y - th / 2, G.y + 4, G.y + G.h - th - 4) + "px";
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
    // The window: its name on the bar, or the span in view when no preset
    // names it, and its check in the list.
    el("window-text").textContent = S.window
      ? windowShort(S.window)
      : spanText((S.tB - S.tA) * BASE);
    el("window").dataset.custom = String(!S.window);
    el("window").setAttribute(
      "aria-label",
      S.window
        ? `Time window: ${windowOf(S.window).name}` +
            (S.window === "ytd" || S.window === "lastyear"
              ? `, ${windowShort(S.window)}`
              : "")
        : `Time window: none; ${spanText((S.tB - S.tA) * BASE)} in view`,
    );
    qsa("#ol-window-menu [data-window]").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.window === S.window)),
    );
    qsa("[data-mode]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)),
    );
    for (const f of ["poc", "area", "untested"]) el(f).checked = S[f];
    el("key-poc").hidden = el("key-bpoc").hidden = !S.poc;
    el("key-area").hidden = !S.area;
    const coarse = renderN() > S.n || renderM() > S.m;
    // The level on the bar leaves the unit to the popover: "15 min × 125".
    el("res-text").textContent = `${dur(BASE * 2 ** S.n)} × ${price(PR * 2 ** S.m)}`;
    el("res").dataset.auto = String(S.auto);
    el("res").dataset.coarse = String(coarse);
    el("res").setAttribute(
      "aria-label",
      `Resolution: ${dur(BASE * 2 ** S.n)} × ${price(PR * 2 ** S.m)} USDT${S.auto ? ", auto" : ", locked"}`,
    );
    el("res").dataset.hint =
      (S.auto ? "Auto level; A locks it" : "Locked; A for auto level") +
      (coarse
        ? `. Showing ${dur(BASE * stepT())} × ${price(PR * stepP())} USDT, the finest recorded here`
        : "") +
      ". [ ] time cells, { } price cells";
    // The price axis: its mode's icon on the bar, its check in the list.
    const follow = followMode();
    qsa("#ol-follow-menu [data-follow]").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.follow === follow)),
    );
    if (el("follow").dataset.mode !== follow) {
      el("follow").dataset.mode = follow;
      el("follow-icon").innerHTML = ICONS[follow];
      el("follow").setAttribute("aria-label", `Price axis: ${FOLLOW_INFO[follow].name}`);
      el("follow-label").textContent = `Price axis: ${FOLLOW_INFO[follow].name}`;
      el("follow").dataset.hint = FOLLOW_INFO[follow].desc;
      el("follow").dataset.keys = FOLLOW_INFO[follow].keys || "";
    }
    qsa("[data-tool]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool())),
    );
    el("lensbar").hidden = !S.lens;
    setCursor();
    el("clear").hidden = !S.selection;
    for (const t of ["context", "evidence"]) {
      el(t + "-tab").setAttribute("aria-pressed", String(S.tab === t));
      el(t).hidden = S.tab !== t;
    }
    el("replay").setAttribute("aria-pressed", String(S.replay));
    el("transport").hidden = !S.replay;
    el("replay-at").textContent = S.replay ? when(activeCutoff()) : "";
    el("horizon").value = S.horizon;
    el("scope").textContent =
      `${Object.keys(sources).length}/${Object.keys(PACK.blocks).length} ${PACK.live ? "live cube" : "recorded"} blocks ready · ${when(displaySource().b0)} onward`;
    el("cutoff").textContent = `Cutoff ${when(CUT)} UTC`;
    // A recorded page names its day; a live one says how fresh it is instead.
    el("snapshot").textContent = PACK.live ? "" : day(CUT);
    // Latest appears when the cutoff is out of view, beside the price profile.
    el("latest").hidden = S.replay || (S.tA < CUT && S.tB >= CUT);
    el("latest").style.right =
      GUTTER + profileWidth(canvas.clientWidth) + 8 + "px";
    applyPanels();
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
    for (const [id, d] of [
      ["table-back", -1],
      ["table-next", 1],
    ])
      el(id).addEventListener("click", () => {
        tablePage += d;
        if (last) buildCells(last.query, last.b);
      });
    for (const button of qsa("[data-sort]"))
      button.addEventListener("click", () => {
        const key = button.dataset.sort;
        if (S.cellSort === key) S.cellDir = -S.cellDir;
        else {
          S.cellSort = key;
          S.cellDir = key === "state" ? 1 : -1;
        }
        if (last) buildCells(last.query, last.b);
        save();
      });
    // A table row and its cell on the chart light up together.
    el("table-body").addEventListener("pointerover", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      tableHover = { c: Number(tr.dataset.c), r: Number(tr.dataset.r) };
      requestDraw();
    });
    el("table-body").addEventListener("pointerleave", () => {
      tableHover = null;
      requestDraw();
    });
    bindPanels();
    bindTopBar();
  }

  function followMode() {
    return S.diagonal
      ? "diagonal"
      : S.coupled
        ? "coupled"
        : S.refit
          ? "refit"
          : "free";
  }
  function tool() {
    return S.lens ? "lens" : S.select ? "select" : "pan";
  }
  // How the price range follows a time zoom: one of four, never two at once.
  function setFollow(mode) {
    const was = followMode();
    if (mode === was) return;
    S.refit = mode === "refit";
    S.coupled = mode === "coupled";
    S.diagonal = mode === "diagonal";
    if (mode === "refit") {
      fit();
      autoLevel();
    }
    if (mode === "diagonal") {
      if (S.auto) autoLevel();
      else if (S.m !== diagonalM(S.n)) {
        transition = reduce
          ? null
          : { n: renderN(), m: renderM(), start: performance.now() };
        S.m = diagonalM(S.n);
      }
    }
    update();
    recordView(
      { free: "Free axes", refit: "Refit", coupled: "Coupled", diagonal: "Diagonal" }[
        mode
      ],
    );
    save();
  }
  // A tool stays chosen until another is: Select for as many rectangles as
  // wanted, the lens until it is left.
  function setTool(next) {
    S.select = next === "select";
    S.lens = next === "lens";
    if (S.lens) el("tip").hidden = true;
    update();
    save();
  }
  // The largest inspector and drawer this window leaves room for: the chart
  // keeps at least 480px of width, and its column keeps the chart header,
  // 220px of plot, the drawer's tab bar and the status bar, however they wrap.
  const sideMax = () => clamp(innerWidth - 520, 260, 560),
    drawerMax = () => {
      const part = (s) => root.querySelector(s).offsetHeight,
        used =
          part(".ol-chart-head") +
          part(".ol-drawer-bar") +
          part(".ol-status") +
          part("#ol-loading") +
          8;
      return Math.max(120, part(".ol-chart") - used - 220);
    };
  // Inspector and drawer: open state and sizes, from S, within the window.
  function applyPanels() {
    const main = el("main"),
      drawer = el("drawer"),
      side = el("side-toggle"),
      sideLabel = S.sideOpen ? "Collapse the inspector" : "Expand the inspector";
    const sideWidth = clamp(S.sideWidth, 260, sideMax()),
      drawerHeight = clamp(S.drawerHeight, 120, drawerMax());
    main.dataset.side = S.sideOpen ? "open" : "closed";
    main.style.setProperty("--side-w", sideWidth + "px");
    // Focusable separators state their size and its range to assistive tech.
    for (const [grip, now, min, max] of [
      [el("side-grip"), sideWidth, 260, sideMax()],
      [el("drawer-grip"), drawerHeight, 120, drawerMax()],
    ]) {
      grip.setAttribute("aria-valuenow", String(Math.round(now)));
      grip.setAttribute("aria-valuemin", String(min));
      grip.setAttribute("aria-valuemax", String(Math.round(max)));
    }
    side.setAttribute("aria-expanded", String(S.sideOpen));
    side.setAttribute("aria-label", sideLabel);
    side.title = sideLabel + " (I)";
    drawer.dataset.open = String(S.drawerOpen);
    drawer.style.setProperty("--drawer-h", drawerHeight + "px");
    // A closed or switched drawer leaves no row outlined on the chart.
    if (!(S.drawerOpen && S.drawer === "cells")) tableHover = null;
    for (const tab of qsa("[data-drawer]")) {
      const on = tab.dataset.drawer === S.drawer;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      el("panel-" + tab.dataset.drawer).hidden = !on;
    }
    el("drawer-toggle").setAttribute("aria-expanded", String(S.drawerOpen));
    el("drawer-toggle").setAttribute(
      "aria-label",
      S.drawerOpen ? "Close the drawer" : "Open the drawer",
    );
    el("drawer-toggle").title =
      (S.drawerOpen ? "Close the drawer" : "Open the drawer") + " (T)";
  }
  function openDrawer(tab, open = true) {
    S.drawer = tab;
    S.drawerOpen = open;
    update();
    save();
  }
  // Drag, or arrow keys on a focused grip, resize the inspector and the drawer.
  function bindGrip(grip, begin, onMove, onKey) {
    grip.addEventListener("pointerdown", (e) => {
      grip.setPointerCapture(e.pointerId);
      grip.dataset.active = "true";
      const start = { x: e.clientX, y: e.clientY };
      const move = (ev) => onMove(ev.clientX - start.x, ev.clientY - start.y);
      const end = () => {
        grip.dataset.active = "false";
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", end);
        grip.removeEventListener("pointercancel", end);
        save();
      };
      begin();
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    });
    grip.addEventListener("keydown", (e) => {
      if (onKey(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        applyPanels();
        save();
      }
    });
  }
  function bindPanels() {
    let width0 = 0,
      height0 = 0;
    bindGrip(
      el("side-grip"),
      () => (width0 = clamp(S.sideWidth, 260, sideMax())),
      (dx) => {
        S.sideWidth = clamp(width0 - dx, 260, sideMax());
        applyPanels();
      },
      (key) => {
        if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
        S.sideWidth = clamp(
          S.sideWidth + (key === "ArrowLeft" ? 16 : -16),
          260,
          sideMax(),
        );
        return true;
      },
    );
    bindGrip(
      el("drawer-grip"),
      () => (height0 = clamp(S.drawerHeight, 120, drawerMax())),
      (dx, dy) => {
        S.drawerHeight = clamp(height0 - dy, 120, drawerMax());
        applyPanels();
      },
      (key) => {
        if (key !== "ArrowUp" && key !== "ArrowDown") return false;
        S.drawerHeight = clamp(
          S.drawerHeight + (key === "ArrowUp" ? 24 : -24),
          120,
          drawerMax(),
        );
        return true;
      },
    );
    el("side-toggle").addEventListener("click", () => {
      S.sideOpen = !S.sideOpen;
      applyPanels();
      save();
    });
    el("drawer-toggle").addEventListener("click", () =>
      openDrawer(S.drawer, !S.drawerOpen),
    );
    const tabs = [...qsa("[data-drawer]")];
    for (const tab of tabs) {
      // A tab opens its panel; the open tab, clicked again, closes the drawer.
      tab.addEventListener("click", () =>
        openDrawer(
          tab.dataset.drawer,
          !(S.drawerOpen && S.drawer === tab.dataset.drawer),
        ),
      );
      tab.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        const next =
          tabs[
            (tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length
          ];
        openDrawer(next.dataset.drawer, S.drawerOpen);
        next.focus();
      });
    }
    el("open-cases").addEventListener("click", () => openDrawer("cases"));
  }

  // Popovers: one open at a time; outside clicks and Escape close them.
  const pop = { open: null };
  function closePop(restoreFocus = false) {
    if (!pop.open) return false;
    const { button, panel } = pop.open;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    pop.open = null;
    if (restoreFocus) button.focus();
    return true;
  }
  function bindPop(buttonId, panelId, onOpen) {
    const button = el(buttonId),
      panel = el(panelId);
    button.addEventListener("click", () => {
      if (pop.open?.panel === panel) {
        closePop();
        return;
      }
      closePop();
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      pop.open = { button, panel };
      if (onOpen) onOpen();
    });
  }
  function setSheet(open) {
    root.dataset.sheet = open ? "open" : "closed";
    el("sheet-toggle").setAttribute("aria-expanded", String(open));
    if (!open) closePop();
  }
  // Menus: a button's list of choices. The arrows move through them, Home and
  // End jump to the ends, Tab leaves, Escape closes back to the button, and a
  // choice closes the list.
  const menuItems = (menu) => [...menu.querySelectorAll('[role^="menuitem"]')];
  function focusMenuItem(menu, i) {
    const items = menuItems(menu);
    items[((i % items.length) + items.length) % items.length]?.focus();
  }
  function checkedItem(menu) {
    return Math.max(
      0,
      menuItems(menu).findIndex((b) => b.getAttribute("aria-checked") === "true"),
    );
  }
  function bindMenu(buttonId, menuId, build) {
    const button = el(buttonId),
      menu = el(menuId);
    build();
    bindPop(buttonId, menuId, () => {
      hideHint();
      build();
      focusMenuItem(menu, checkedItem(menu));
    });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (menu.hidden) button.click();
      focusMenuItem(menu, e.key === "ArrowUp" ? -1 : checkedItem(menu));
    });
    menu.addEventListener("keydown", (e) => {
      const i = menuItems(menu).indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        focusMenuItem(menu, i + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        focusMenuItem(menu, e.key === "Home" ? 0 : -1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePop(true);
      } else if (e.key === "Tab") closePop();
    });
  }
  function openMenu(buttonId) {
    const button = el(buttonId),
      menu = el(button.getAttribute("aria-controls").slice(3));
    if (menu.hidden) button.click();
    else focusMenuItem(menu, checkedItem(menu));
  }
  function menuItem(role, children, onChoose) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ol-item cursor-interaction";
    b.setAttribute("role", role);
    b.append(...children);
    b.addEventListener("click", () => {
      closePop(true);
      onChoose();
    });
    return b;
  }
  // A key shown beside a name; the name's element states it to assistive
  // technology (aria-keyshortcuts).
  function keyCap(text) {
    const kbd = document.createElement("kbd");
    kbd.textContent = text;
    kbd.setAttribute("aria-hidden", "true");
    return kbd;
  }
  // The windows, by length: minutes and hours, days, then years, each with
  // its number key; the calendar years show which year they are.
  function buildWindowMenu() {
    const parts = [];
    for (const [cap, keys] of [
      ["Minutes and hours", ["15m", "30m", "1h", "4h", "12h", "24h"]],
      ["Days", ["7d", "30d"]],
      ["Years", ["1y", "ytd", "lastyear", "all"]],
    ]) {
      const head = document.createElement("div");
      head.className = "ol-menu-cap";
      head.setAttribute("aria-hidden", "true");
      head.textContent = cap;
      parts.push(head);
      for (const key of keys) {
        const children = [svgIcon("check", "ol-icon ol-check"), windowOf(key).name],
          digit = WINDOW_KEYS.indexOf(key);
        if (key === "ytd" || key === "lastyear") {
          const note = document.createElement("span");
          note.className = "ol-item-note";
          note.textContent = windowShort(key);
          children.push(note);
        }
        if (digit >= 0) children.push(keyCap(String(digit)));
        const b = menuItem("menuitemradio", children, () => chooseWindow(key));
        if (digit >= 0) b.setAttribute("aria-keyshortcuts", String(digit));
        b.dataset.window = key;
        b.setAttribute("aria-checked", String(key === S.window));
        parts.push(b);
      }
    }
    el("window-menu").replaceChildren(...parts);
  }
  // The price axis: how its range follows a time zoom, each mode with what it
  // does, and a fit of the range once.
  function buildFollowMenu() {
    const follow = followMode(),
      parts = FOLLOWS.map((mode) => {
        const info = FOLLOW_INFO[mode],
          text = document.createElement("span"),
          desc = document.createElement("span");
        text.className = "ol-item-text";
        desc.className = "ol-item-desc";
        desc.textContent = info.desc;
        text.append(info.name, desc);
        const b = menuItem(
          "menuitemradio",
          [svgIcon(mode), text, ...(info.keys ? [keyCap(info.keys)] : [])],
          () => setFollow(mode),
        );
        if (info.keys) b.setAttribute("aria-keyshortcuts", info.keys);
        b.dataset.follow = mode;
        b.setAttribute("aria-checked", String(mode === follow));
        return b;
      }),
      rule = document.createElement("div"),
      text = document.createElement("span"),
      desc = document.createElement("span");
    rule.className = "ol-menu-rule";
    rule.setAttribute("role", "separator");
    text.className = "ol-item-text";
    desc.className = "ol-item-desc";
    desc.textContent = "Once, to the trades in view";
    text.append("Fit the price range", desc);
    const fitItem = menuItem("menuitem", [svgIcon("fit"), text, keyCap("F")], () =>
      fitPrice("Fit price"),
    );
    fitItem.setAttribute("aria-keyshortcuts", "F");
    parts.push(rule, fitItem);
    el("follow-menu").replaceChildren(...parts);
  }

  // Labels: a control's name and key, and what it does, a second after the
  // pointer rests on it, a finger holds it or the keyboard reaches it; once
  // one has shown, the next shows at once. A hold that shows a label doesn't
  // press the control too.
  const HINT_DELAY = 1000,
    hint = { timer: 0, target: null, hiddenAt: -Infinity, held: null, box: null, touch: false };
  function hideHint() {
    clearTimeout(hint.timer);
    if (hint.target) hint.hiddenAt = performance.now();
    if (hint.box) hint.box.hidden = true;
    hint.target = null;
  }
  function showHint(target) {
    if (
      !target.isConnected ||
      target.closest("[hidden]") ||
      target.getAttribute("aria-expanded") === "true"
    )
      return;
    if (!hint.box) {
      hint.box = document.createElement("div");
      hint.box.className = "ol-hint";
      hint.box.setAttribute("role", "tooltip");
      root.append(hint.box);
    }
    const box = hint.box,
      head = document.createElement("div"),
      parts = [head],
      keys = target.dataset.keys,
      desc = target.dataset.hint;
    head.className = "ol-hint-head";
    head.append(target.getAttribute("aria-label") || target.textContent.trim());
    if (keys) head.append(keyCap(keys));
    if (desc) {
      const line = document.createElement("div");
      line.className = "ol-hint-desc";
      line.textContent = desc;
      parts.push(line);
    }
    box.replaceChildren(...parts);
    box.hidden = false;
    // Under the control, or over it when there is no room below.
    const r = target.getBoundingClientRect(),
      w = box.offsetWidth,
      h = box.offsetHeight,
      below = r.bottom + 6;
    box.style.left = clamp(r.left + r.width / 2 - w / 2, 4, innerWidth - w - 4) + "px";
    box.style.top = (below + h > innerHeight - 4 ? r.top - 6 - h : below) + "px";
    hint.target = target;
  }
  function armHint(target) {
    clearTimeout(hint.timer);
    // A button whose list or popover is open needs no label over it.
    if (target.getAttribute("aria-expanded") === "true") return;
    if (hint.target || performance.now() - hint.hiddenAt < 600) showHint(target);
    else hint.timer = setTimeout(() => showHint(target), HINT_DELAY);
  }
  // What a label says under a control's name, and its key when it doesn't
  // state one itself, is also the control's description for assistive
  // technology: a hidden text it points to, kept as the label changes.
  const descs = document.createElement("div");
  let descCount = 0;
  function describe(node) {
    const keys = node.hasAttribute("aria-keyshortcuts") ? "" : node.dataset.keys,
      text = [node.dataset.hint, keys && `Key: ${keys}`].filter(Boolean).join(". ");
    let span = document.getElementById(node.getAttribute("aria-describedby") || "");
    if (!span) {
      if (!text) return;
      span = document.createElement("span");
      span.id = `ol-desc-${++descCount}`;
      descs.append(span);
      node.setAttribute("aria-describedby", span.id);
    }
    if (span.textContent !== text) span.textContent = text;
  }
  function bindHints() {
    descs.hidden = true;
    root.append(descs);
    for (const node of qsa("[data-hint]")) describe(node);
    new MutationObserver((records) => {
      for (const r of records) if (r.target.matches?.("[data-hint]")) describe(r.target);
    }).observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-hint", "data-keys", "aria-keyshortcuts"],
    });
    const hinted = (node) => (node instanceof Element ? node.closest("[data-hint]") : null);
    root.addEventListener("pointerover", (e) => {
      const t = hinted(e.target);
      if (e.pointerType !== "touch" && t && t !== hint.target && !t.contains(e.relatedTarget))
        armHint(t);
    });
    // A finger's label stays a moment after it lifts (see below), though
    // lifting counts as leaving.
    root.addEventListener("pointerout", (e) => {
      const t = hinted(e.target);
      if (e.pointerType !== "touch" && t && !t.contains(e.relatedTarget)) hideHint();
    });
    // A finger held on a control shows its label, and the press that ends the
    // hold is dropped.
    root.addEventListener(
      "pointerdown",
      (e) => {
        hideHint();
        hint.held = null;
        hint.touch = e.pointerType === "touch";
        const t = hinted(e.target);
        if (t && hint.touch)
          hint.timer = setTimeout(() => {
            showHint(t);
            hint.held = t;
          }, HINT_DELAY);
      },
      true,
    );
    for (const type of ["pointerup", "pointercancel"])
      root.addEventListener(
        type,
        () => {
          clearTimeout(hint.timer);
          if (hint.held) hint.timer = setTimeout(hideHint, 1500);
        },
        true,
      );
    root.addEventListener(
      "click",
      (e) => {
        const held = hint.held;
        hint.held = null;
        if (held && held.contains(e.target)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    // A touch hold on a control shows its label, not the phone's menu.
    root.addEventListener("contextmenu", (e) => {
      if (hint.touch && hinted(e.target)) e.preventDefault();
    });
    root.addEventListener("focusin", (e) => {
      const t = hinted(e.target);
      if (t && t.matches(":focus-visible")) armHint(t);
    });
    root.addEventListener("focusout", (e) => {
      if (!hint.target?.contains(e.relatedTarget)) hideHint();
    });
    addEventListener("scroll", hideHint, true);
    addEventListener("resize", hideHint);
    addEventListener("blur", hideHint);
    // Any key but a modifier alone puts the label away.
    document.addEventListener(
      "keydown",
      (e) => {
        if (!["Shift", "Alt", "Control", "Meta"].includes(e.key)) hideHint();
      },
      true,
    );
  }
  function bindTopBar() {
    bindHints();
    bindMenu("window", "window-menu", buildWindowMenu);
    bindMenu("follow", "follow-menu", buildFollowMenu);
    bindPop("res", "res-pop", () => {
      nav.planeKey = "";
      refreshPlane();
    });
    bindPop("hist", "hist-pop", () => {
      loadViews();
      renderHistory();
      renderViews();
      viewsStatus("");
      el("view-name").value =
        viewPlace() + (S.mode === "volume" ? "" : " · " + MODE_NAMES[S.mode]);
    });
    bindPop("evidence-info", "evidence-more");
    document.addEventListener("pointerdown", (e) => {
      if (
        !pop.open ||
        pop.open.panel.contains(e.target) ||
        pop.open.button.contains(e.target) ||
        // In the phone sheet a popover is part of the sheet's flow: closing it on
        // pointerdown would shrink the sheet and move the control being tapped.
        (root.dataset.sheet === "open" && el("controls").contains(e.target))
      )
        return;
      closePop();
    });
    el("sheet-toggle").addEventListener("click", () =>
      setSheet(root.dataset.sheet !== "open"),
    );
    el("sheet-close").addEventListener("click", () => setSheet(false));
    for (const button of qsa("[data-tool]"))
      button.addEventListener("click", () => setTool(button.dataset.tool));
    el("hist-back").addEventListener("click", () => history.back());
    el("hist-fwd").addEventListener("click", () => history.forward());
    el("view-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveView(el("view-name").value);
    });
    // Text fields keep their keys, so the name field closes its popover itself.
    el("view-name").addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closePop(true);
    });
    el("copy-link").addEventListener("click", copyLink);
    el("help").addEventListener("click", openKeys);
    el("keys-close").addEventListener("click", () => el("keys").close());
    // The dialog's own box is its backdrop; its content sits in a child.
    el("keys").addEventListener("click", (e) => {
      if (e.target === el("keys")) el("keys").close();
    });
    // Views saved in another tab appear here too.
    addEventListener("storage", (e) => {
      if (e.key !== window.explorerState?.viewsKey) return;
      loadViews();
      renderViews();
    });
  }
  function openKeys() {
    closePop();
    if (!el("keys").open) el("keys").showModal();
  }
  async function copyLink() {
    const url = new URL(location.href);
    url.username = url.password = "";
    try {
      await navigator.clipboard.writeText(url.href);
      viewsStatus("Link copied.");
    } catch {
      viewsStatus("Copy the address from the browser's address bar.");
    }
  }

  let markState = {
    metrics: new WeakMap(),
    deltaMax: 1,
    va: null,
    rays: [],
  };
  function signedCompact(value) {
    return (value < 0 ? "−" : value > 0 ? "+" : "") + compact(Math.abs(value));
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
      deltas = [];
    for (const z of full.cells) {
      const delta = 2 * z.bv - z.v;
      metrics.set(z, { ...cellExposure(z, sourceBounds, ts, ps), delta });
      if (delta !== 0) deltas.push(Math.abs(delta));
    }
    for (const z of query.cells)
      metrics.set(z, { ...cellExposure(z, b, ts, ps), delta: 2 * z.bv - z.v });
    deltas.sort((a, b) => a - b);
    markState = {
      metrics,
      deltaMax: d3.quantileSorted(deltas, 0.995) || 1,
      va: contiguousArea(query.rows, query.poc, query.v),
      rays: [],
    };
    return markState;
  }
  function legendText(full) {
    if (S.mode === "geometry") return "Occupied cells";
    if (S.mode === "flow") return "Buy share 25% · 50% · 75%";
    if (S.mode === "delta")
      return `Δ ${signedCompact(-markState.deltaMax)} · 0 · ${signedCompact(markState.deltaMax)} USDT`;
    return `${compact(Math.exp(full.lo))}–${compact(Math.exp(full.hi))} USDT · log`;
  }
  // The legend's precise meaning, one hover away.
  const LEGEND_TITLES = {
    volume:
      "USDT traded per cell, on a log scale. An edge cell or the open column is shaded at its full-cell rate.",
    flow: "The share of each cell's volume bought by takers: buy colour above half, sell colour below, full at 75% and 25%. Paler cells traded less.",
    delta: "Taker-buy minus taker-sell volume per cell, in USDT",
    geometry: "The grid's occupied cells",
  };
  function legendRamp() {
    return S.mode === "flow"
      ? "linear-gradient(to right,var(--ol-sell),var(--ol-neutral),var(--ol-buy))"
      : S.mode === "delta"
        ? "linear-gradient(to right,var(--ol-sell),var(--ol-line),var(--ol-buy))"
        : S.mode === "geometry"
          ? "var(--ol-line)"
          : "linear-gradient(to right,var(--ol-panel),var(--ol-volume))";
  }
  // A cell's colour. Volume shades each cell at its full-cell rate, so an edge
  // portion or the open column compares with whole cells. Taker flow diverges
  // from a neutral midpoint to buy and sell, full at 75% and 25%, paler where
  // less traded. Delta shades signed taker volume.
  function cellColour(z, lo, hi, deltaMax, full) {
    const level = clamp(
      (Math.log(full) - lo) / Math.max(0.1, hi - lo),
      0,
      1,
    );
    if (S.mode === "flow") {
      const t = clamp(((z.v ? z.bv / z.v : 0.5) - 0.5) / 0.25, -1, 1),
        hue = d3.interpolateRgb(colors.neutral, t >= 0 ? colors.buy : colors.sell)(Math.abs(t));
      return d3.interpolateRgb(colors.surface, hue)(0.3 + 0.7 * level);
    }
    if (S.mode === "delta") {
      const delta = 2 * z.bv - z.v;
      return d3.interpolateRgb(
        colors.surface,
        delta >= 0 ? colors.buy : colors.sell,
      )(clamp(Math.log1p(Math.abs(delta)) / Math.log1p(deltaMax), 0, 1));
    }
    return d3.interpolateRgb(colors.surface, colors.volume)(0.2 + 0.8 * level);
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
      area = ts * BASE * ps * PR;
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
      ctx.fillStyle = cellColour(
        z,
        full.lo,
        full.hi,
        markState.deltaMax,
        measure?.area > 0 ? (z.v * area) / measure.area : z.v,
      );
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
    if (hover?.row != null && onProfile(hover)) {
      const ya = G.Y((hover.row + 1) * ps),
        yb = G.Y(hover.row * ps);
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, ya + 0.5, pw + 2, Math.max(1, yb - ya - 1));
    }
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
    // A line of room between labels, as on the chart.
    for (let i = 0; i < visible.length; i++)
      visible[i].ly = Math.max(
        G.y + 7,
        visible[i].y,
        i ? visible[i - 1].ly + 15 : G.y + 7,
      );
    if (visible.length && visible.at(-1).ly > G.y + G.h - 7) {
      visible.at(-1).ly = G.y + G.h - 7;
      for (let i = visible.length - 2; i >= 0; i--)
        visible[i].ly = Math.min(visible[i].ly, visible[i + 1].ly - 15);
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
    text(S.selection ? "Selected" : "Profile", px, G.y - 5, colors.muted, "left");
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
  // Activity: each column's volume, or its signed taker volume in the flow and
  // delta encodings, in a pane under the prices that shares their time axis.
  function activity(full, cut) {
    const ts = stepT(),
      b = bounds(),
      cols = full.cols.filter(
        (c) => (c.c + 1) * ts > S.tA && c.c * ts < S.tB && c.c * ts < cut,
      ),
      signed = S.mode === "delta" || S.mode === "flow",
      value = (c) => (signed ? 2 * c.bv - c.v : c.v),
      max = d3.max(cols, (c) => Math.abs(value(c))) || 1,
      top = G.ay,
      h = G.ah,
      zero = signed ? top + h / 2 : top + h,
      room = (signed ? h / 2 : h) - 4;
    ctx.fillStyle = colors.surface;
    ctx.fillRect(G.x, top, G.w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(G.x, top, G.w, h);
    ctx.clip();
    // After the cutoff, as above: hidden in replay, otherwise plain.
    const xc = clamp(G.X(cut), G.x, G.x + G.w);
    if (S.replay) hatchRect(xc, top, G.x + G.w - xc, h, colors.line, 11, 0.45);
    else {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(xc, top, G.x + G.w - xc, h);
    }
    timeGrid(top, top + h);
    if (signed) markLine(G.x, zero, G.x + G.w, zero, colors.line, 1, 0.9);
    for (const c of cols) {
      const xa = G.X(Math.max(c.c * ts, b[0])),
        xb = G.X(Math.min((c.c + 1) * ts, cut, b[1]));
      if (xb <= xa) continue;
      const v = value(c),
        bh = (Math.abs(v) / max) * room,
        y = signed ? (v >= 0 ? zero - bh : zero) : zero - bh;
      ctx.fillStyle = signed ? (v >= 0 ? colors.buy : colors.sell) : colors.volume;
      ctx.globalAlpha = 0.65;
      ctx.fillRect(xa, y, Math.max(0.1, xb - xa - (xb - xa > 3 ? 1 : 0)), bh);
    }
    ctx.restore();
    // The scale in the price labels' column: the largest value, then the unit.
    if (!cols.length) return;
    text((signed ? "±" : "") + compact(max), G.x - 8, top + 7, colors.muted, "right");
    if (h >= 34) text("USDT", G.x - 8, top + 21, colors.muted, "right");
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
  // The anchor column: the chosen anchor, or the last complete column in view.
  function evidenceAnchor() {
    const end = Math.min(CUT, S.anchor === null ? bounds()[1] : S.anchor);
    return Math.floor(end / stepT()) - 1;
  }
  function evidenceKey() {
    const loaded = Object.values(sources)
      .map((src) => src.id + ":" + src.cells.length)
      .sort()
      .join(",");
    return ["v4", renderN(), renderM(), evidenceAnchor(), S.barrier || 1, loaded].join("|");
  }
  // Continuations wait for the view to settle: a level change mid-gesture would
  // otherwise recompute them inside the frame. Meanwhile the last result at the
  // same level stays up, marked as updating.
  let gestureAt = 0;
  const evidence = { ready: null, last: null, timer: 0 },
    gesturing = () =>
      drag !== null || nav.pinch !== null || performance.now() - gestureAt < 200;
  function settledEvidence() {
    const key = evidenceKey();
    if (evidenceCache.has(key) || !gesturing()) {
      evidence.ready = evidence.last = calcEvidence();
      return evidence.ready;
    }
    evidence.ready = null;
    clearTimeout(evidence.timer);
    evidence.timer = setTimeout(requestDraw, 220);
    const e = evidence.last;
    return e && e.n === renderN() && e.m === renderM() && e.barrier === (S.barrier || 1)
      ? e
      : null;
  }
  function calcEvidence() {
    const n = renderN(),
      m = renderM(),
      ts = stepT(),
      a = evidenceAnchor(),
      barrier = S.barrier || 1,
      key = evidenceKey();
    if (evidenceCache.has(key)) return evidenceCache.get(key);
    const history = evidenceColumns(n, m, (a + 1) * ts),
      cols = history.cols,
      ai = cols.findIndex((c) => c.c === a);
    const shared = {
      a,
      n,
      m,
      barrier,
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
      : `${when((e.a + 1) * stepT())} UTC · ${dur(BASE * stepT() * S.horizon)} ahead`;
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
    // One row per outcome: matching share, all-states share, their difference
    // in points, and the two as paired bars on the same 0–100% scale.
    for (const kind of ["up", "flat", "down"]) {
      const baseOk = Boolean(base && base.n >= 30),
        p = supported ? sample[kind] / sample.n : 0,
        bp = baseOk ? base[kind] / base.n : 0,
        diff = Math.round(p * 100) - Math.round(bp * 100);
      el("label-" + kind).textContent = labels[kind];
      el("prob-" + kind).textContent = supported
        ? Math.round(p * 100) + "%"
        : sample
          ? sample[kind] + " cases"
          : "—";
      el("base-prob-" + kind).textContent = base
        ? baseOk
          ? Math.round(bp * 100) + "%"
          : base[kind] + " cases"
        : "—";
      el("diff-" + kind).textContent =
        supported && baseOk
          ? (diff > 0 ? "+" : diff < 0 ? "−" : "±") + Math.abs(diff)
          : "—";
      el("bar-" + kind).style.width = p * 100 + "%";
      el("base-" + kind).style.width = bp * 100 + "%";
      root
        .querySelector('[data-case-direction="' + kind + '"]')
        .setAttribute(
          "aria-label",
          labels[kind] +
            (sample
              ? " · " + sample[kind] + " of " + sample.n + " matching cases"
              : "") +
            (supported && baseOk
              ? ` · ${Math.round(p * 100)}% against ${Math.round(bp * 100)}% in all states`
              : "") +
            " · inspect these cases",
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
          : "Below 30 matches: percentages and matching boxes withheld.") +
        (barriers
          ? " Barriers use the first column-end POC crossing; trade first-touch is not observable here."
          : " The boxes show where the POC moved in history.") +
        " Every outcome ends by the anchor.";
    el("evidence-brief").textContent = e.error
      ? "Choose a completed column containing trades."
      : supported
        ? "Empirical shares, not calibrated odds."
        : "Below 30 matches: percentages withheld.";
    evidenceCases(e);
  }
  // The drawer's cases table: sortable, fifty to a page, each date a jump
  // into replay. Rebuilt only when the evidence or the table's own state moves.
  const CASES_PAGE = 50;
  let casesKey = "",
    casesEvidence = null;
  function evidenceCases(e) {
    if (!(S.drawerOpen && S.drawer === "cases")) return;
    const key = [
      S.caseFilter,
      S.casePage,
      S.caseSort,
      S.caseDir,
      S.horizon,
      S.evidenceKind,
      stepT(),
      stepP(),
    ].join("|");
    if (e === casesEvidence && key === casesKey) return;
    casesEvidence = e;
    casesKey = key;
    const list = el("case-list"),
      { sample, field } = evidenceTotals(e);
    el("case-filter").value = S.caseFilter || "all";
    for (const button of qsa("[data-case-sort]")) {
      const th = button.parentElement;
      if (button.dataset.caseSort === S.caseSort)
        th.setAttribute("aria-sort", S.caseDir > 0 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    }
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
    const barrier = S.evidenceKind === "barrier",
      value = {
        date: (c) => c.c,
        outcome: (c) => (barrier ? c.first : c.direction),
        change: (c) => c.delta,
        poc: (c) => c.poc,
        excursion: (c) => c.max - c.min,
        buy: (c) => c.buyShare,
      }[S.caseSort];
    rows = rows
      .slice()
      .sort(
        (x, y) =>
          (value(x) < value(y) ? -1 : value(x) > value(y) ? 1 : 0) *
            S.caseDir || y.c - x.c,
      );
    const pages = Math.max(1, Math.ceil(rows.length / CASES_PAGE));
    S.casePage = clamp(S.casePage || 0, 0, pages - 1);
    el("case-definition").textContent =
      filter === "failure"
        ? `Cases opposing the matching sample’s most common outcome (${modal}). This is a retrospective comparison.`
        : "Open a date to replay its recorded starting state. Excursions use column-end POCs.";
    const fragment = document.createDocumentFragment(),
      cell = (tr, content) => {
        const td = document.createElement("td");
        td.append(content);
        tr.append(td);
      };
    for (const c of rows.slice(
      S.casePage * CASES_PAGE,
      (S.casePage + 1) * CASES_PAGE,
    )) {
      const tr = document.createElement("tr"),
        button = document.createElement("button");
      button.type = "button";
      button.className = "cursor-interaction";
      button.dataset.caseAnchor = String((c.c + 1) * stepT());
      button.textContent = when((c.c + 1) * stepT());
      button.title = "Replay this case";
      cell(tr, button);
      cell(
        tr,
        barrier
          ? (c.first > 0
              ? "Upper first"
              : c.first < 0
                ? "Lower first"
                : "Neither") +
              (c.firstAt
                ? ` · ${c.firstAt} ${c.firstAt === 1 ? "column" : "columns"}`
                : "")
          : c.delta > 0
            ? "Higher"
            : c.delta < 0
              ? "Lower"
              : "Same row",
      );
      cell(tr, signed(c.delta * stepP() * PR, price));
      cell(
        tr,
        `${price((c.poc + 0.5) * stepP() * PR)} → ${price((c.finalPoc + 0.5) * stepP() * PR)}`,
      );
      cell(
        tr,
        `${signed(c.min * stepP() * PR, price)} / ${signed(c.max * stepP() * PR, price)}`,
      );
      cell(tr, Math.round(c.buyShare * 100) + "%");
      fragment.append(tr);
    }
    if (!rows.length) {
      const tr = document.createElement("tr"),
        td = document.createElement("td");
      td.colSpan = 6;
      td.className = "ol-muted";
      td.textContent = "No qualifying cases in this loaded history.";
      tr.append(td);
      fragment.append(tr);
    }
    list.replaceChildren(fragment);
    el("case-page").textContent = rows.length
      ? `${S.casePage + 1} / ${pages} · ${integer(rows.length)}`
      : "0 cases";
    el("case-prev").disabled = S.casePage === 0;
    el("case-next").disabled = S.casePage + 1 >= pages;
  }
  // Continuations on the chart: for each column ahead, a box over the rows
  // where the POC landed, the middle 80% of outcomes light and the middle 50%
  // darker, with the median row marked. All states are outlined across the
  // column and matching states fill its middle, so the two read side by side.
  // Boxes cover whole rows, so an outcome that stayed in its row still shows.
  function drawCone(e) {
    if (e.error) return;
    const ts = stepT(),
      ps = stepP(),
      x0 = G.X((e.a + 1) * ts),
      y0 = G.Y((e.poc + 0.5) * ps);
    if (x0 < G.x || x0 > G.x + G.w) return;
    const rows = (q, low, high) => [
        G.Y((e.poc + Math.ceil(q[high]) + 1) * ps),
        G.Y((e.poc + Math.floor(q[low])) * ps),
      ],
      ends = {};
    ctx.save();
    for (const [key, summaries, color, inset] of [
      ["all", e.all, colors.muted, 0],
      ["match", e.match, colors.evidence, 0.25],
    ]) {
      for (let h = 1; h <= 8 && summaries[h].n >= 30; h++) {
        const q = summaries[h].q,
          xa = G.X((e.a + h) * ts),
          xb = G.X((e.a + h + 1) * ts),
          w = xb - xa,
          left = xa + w * inset + 0.5,
          width = Math.max(1, w * (1 - 2 * inset) - 1),
          [outerTop, outerBottom] = rows(q, 0, 4),
          [innerTop, innerBottom] = rows(q, 1, 3),
          median = G.Y((e.poc + Math.round(q[2]) + 0.5) * ps),
          chosen = h === S.horizon;
        if (key === "all") {
          ctx.strokeStyle = color;
          ctx.lineWidth = chosen ? 1.5 : 1;
          ctx.globalAlpha = chosen ? 0.9 : 0.55;
          ctx.strokeRect(left, outerTop + 0.5, width, outerBottom - outerTop - 1);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.14;
          ctx.fillRect(left, innerTop, width, innerBottom - innerTop);
        } else {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.22;
          ctx.fillRect(left, outerTop, width, outerBottom - outerTop);
          ctx.globalAlpha = 0.45;
          ctx.fillRect(left, innerTop, width, innerBottom - innerTop);
        }
        ctx.globalAlpha = 1;
        line(left, median, left + width, median, color, chosen ? 2.5 : 2, 0.9);
        ends[key] = { x: xb, y: median };
      }
    }
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
    // Each set named beside its last box, at its median.
    if (ends.match) chartLabel("Matching", ends.match.x + 6, ends.match.y, colors.evidence);
    if (ends.all) chartLabel("All states", ends.all.x + 6, ends.all.y);
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
      // An outcome row opens its cases in the drawer.
      const direction = event.target.closest("[data-case-direction]");
      if (direction) {
        S.caseFilter = direction.dataset.caseDirection;
        S.casePage = 0;
        openDrawer("cases");
      }
    });
    el("case-list").addEventListener("click", (event) => {
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
        recordView("Historical case");
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
      evidenceCases(calcEvidence());
      save();
    });
    for (const [id, step] of [
      ["case-prev", -1],
      ["case-next", 1],
    ])
      el(id).addEventListener("click", () => {
        S.casePage = (S.casePage || 0) + step;
        evidenceCases(calcEvidence());
      });
    for (const button of qsa("[data-case-sort]"))
      button.addEventListener("click", () => {
        const key = button.dataset.caseSort;
        if (S.caseSort === key) S.caseDir = -S.caseDir;
        else {
          S.caseSort = key;
          S.caseDir = -1;
        }
        S.casePage = 0;
        evidenceCases(calcEvidence());
        save();
      });
  }

  const nav = {
    pointers: new Map(),
    pinch: null,
    last: null,
    alt: false,
    shift: false,
    hold: false,
    holdTimer: 0,
    zoomTimer: 0,
    zoomTime: false,
    // The zoom keys held: a key zoom lasts until the last of them comes up.
    zoomKeys: new Set(),
    zoomLabel: "Zoom",
    // The keys whose presses the chart took, while they are held.
    pressed: new Set(),
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
    // Outside replay the anchor is the continuations': they come into view.
    if (!S.replay) S.tab = "evidence";
    hover = null;
    el("tip").hidden = true;
    update();
    recordView("Anchor");
    save();
  }
  // Playing a replay steps its anchor a column at a time at the chosen speed,
  // moving the view on when the line nears its right edge, and stops at the
  // latest column or when replay ends.
  const player = { timer: 0 };
  function setPlaying(on) {
    clearInterval(player.timer);
    player.timer = on ? setInterval(playStep, 1000 / Number(el("speed").value)) : 0;
    el("play").setAttribute("aria-pressed", String(on));
    el("play").setAttribute("aria-label", on ? "Pause" : "Play");
  }
  function playStep() {
    const end = Math.floor(CUT / stepT()) * stepT();
    if (!S.replay || S.anchor === null || S.anchor >= end) return setPlaying(false);
    if (G.X(S.anchor + stepT()) > G.x + G.w * 0.85) {
      const d = (S.tB - S.tA) / 2;
      S.tA += d;
      S.tB += d;
      S.window = "";
      confine();
    }
    stepAnchor(1);
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
    return layout(r.width, r.height);
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
  const tiles = { pending: null, timer: 0, quiet: false, stale: false };
  function tileSpec(n, m) {
    const step = 2 ** n,
      r = requestedBounds(),
      b0 = Math.floor(Math.min(r[0], CUT) / step) * step,
      b1 = Math.min(Math.ceil(Math.min(r[1], CUT) / step) * step, CUT);
    if (b1 <= b0 || (b1 - b0) / step > TILE_COLUMNS) return null;
    return { id: `tile:${n}:${m}:${b0}:${b1}`, n, m, b0, b1 };
  }
  function requestTile() {
    if (!PACK.live || !ready || tiles.quiet) return;
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
    tiles.pending = t.id;
    const generation = live.generation;
    PACK.blocks[t.id] = { n: t.n, m: t.m, b0: t.b0, b1: t.b1 };
    loadState[t.id] = "loading";
    el("loading").hidden = false;
    el("loading").textContent =
      `Fetching ${dur(BASE * 2 ** t.n)} by ${price(PR * 2 ** t.m)} USDT cells from the cube`;
    update();
    try {
      // Resolved against the page but without any credentials the page's own URL
      // may carry; the browser attaches the session's Basic credentials itself.
      const target = new URL(
        `/cube/tile?n=${t.n}&m=${t.m}&b0=${t.b0}&b1=${t.b1}&pack=${encodeURIComponent(PACK.state_token)}`,
        location.href,
      );
      target.username = "";
      target.password = "";
      // A tile that hangs would hold every later one back: it fails instead.
      const response = await fetch(target, { signal: AbortSignal.timeout(120000) }),
        body = await response.json();
      if (body.error === "cube_changed") {
        // The cube holds another revision of history than this page. Nothing is
        // mixed: the page takes the new data first, then asks for the tile again.
        tiles.stale = true;
        throw Error("the cube changed; taking its new data first");
      }
      if (!response.ok) throw Error(body.error || response.statusText);
      const tile = await unpack(body.block, t.id);
      // Read for a pack the page has replaced since, even while it decoded: dropped,
      // and asked for again. Nothing awaits between this check and the tile's use.
      if (generation !== live.generation) {
        delete PACK.blocks[t.id];
        delete loadState[t.id];
        tiles.pending = null;
        el("loading").hidden = true;
        update();
        return;
      }
      PACK.blocks[t.id] = body.block;
      sources[t.id] = tile;
      loadState[t.id] = "ready";
      el("loading").hidden = true;
    } catch (error) {
      delete PACK.blocks[t.id];
      delete loadState[t.id];
      el("loading").textContent = `Cube tile unavailable: ${
        error.name === "TimeoutError" ? "the server didn't answer within two minutes" : error.message
      }`;
      el("loading").setAttribute("role", "alert");
    }
    tiles.pending = null;
    if (tiles.stale && PACK.live) pollLive();
    chooseSource();
    evidenceCache.clear();
    // After a failure the view that failed is not asked for again by itself: any
    // timer armed meanwhile is dropped and this refresh schedules nothing. A view
    // that moved on while the tile was pending is fetched by this refresh.
    const same = !sources[t.id] && tileSpec(S.n, S.m)?.id === t.id;
    if (same) clearTimeout(tiles.timer);
    tiles.quiet = same;
    update();
    tiles.quiet = false;
  }
  // The plane status is a live region, so it is written only when its text
  // changes; a rewrite with the same words would be announced again.
  function setPlaneStatus(value) {
    const node = el("plane-status");
    if (node.textContent !== value) node.textContent = value;
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
          setPlaneStatus(b.title);
        };
        b.addEventListener("mouseenter", show);
        b.addEventListener("focus", show);
        b.addEventListener("click", () => changeResolution(n, m));
        b.tabIndex = -1;
        nav.planeButtons.push(b);
        frag.append(b);
      }
    }
    frag.append(label("n"));
    for (let n = 0; n <= N_MAX; n++)
      frag.append(label(n % 4 === 0 ? String(n) : ""));
    el("plane").replaceChildren(frag);
  }
  // The plane is one tab stop: arrow keys move through it, Enter chooses.
  function planeButton(n, m) {
    return nav.planeButtons[(M_MAX - m) * (N_MAX + 1) + n];
  }
  function focusPlaneCell(n, m) {
    const target = planeButton(n, m);
    for (const b of nav.planeButtons) b.tabIndex = b === target ? 0 : -1;
    target.focus();
  }
  function planeKeys(e) {
    const b = e.target.closest("button");
    if (!b || !nav.planeButtons) return;
    let n = Number(b.dataset.n),
      m = Number(b.dataset.m);
    if (e.key === "ArrowLeft") n--;
    else if (e.key === "ArrowRight") n++;
    else if (e.key === "ArrowUp") m++;
    else if (e.key === "ArrowDown") m--;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = N_MAX;
    else return;
    e.preventDefault();
    e.stopPropagation();
    focusPlaneCell(clamp(n, 0, N_MAX), clamp(m, 0, M_MAX));
  }
  // Cell size for the plane's hover text: whole pixels, or words at the extremes,
  // per axis when the two disagree (a sliver can be taller than the view).
  function cellPixels(px, py, g) {
    const wide =
        px >= g.w
          ? "wider than the view"
          : px < 1
            ? "under 1 px wide"
            : `${Math.round(px)} px wide`,
      tall =
        py >= g.h
          ? "taller than the view"
          : py < 1
            ? "under 1 px tall"
            : `${Math.round(py)} px tall`;
    if (px >= 1 && px < g.w && py >= 1 && py < g.h)
      return `${Math.round(px)} by ${Math.round(py)} px`;
    if (px >= g.w && py >= g.h) return "cells larger than the view";
    if (px < 1 && py < 1) return "cells under 1 px";
    return `cells ${wide}, ${tall}`;
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
        CUT,
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
        text = `n ${n} · m ${m} · ${dur(BASE * 2 ** n)} by ${price(PR * 2 ** m)} USDT · ${cellPixels(px, py, g)} · ${r.status === "loading" ? "loading" : r.status === "unavailable" ? "detail unavailable; coarser cells shown" : kind === "small" ? "ready, too small" : kind === "large" ? "ready, too large" : "ready, usable"}${onPath ? " · on the diagonal" : ""}`,
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
    // The tab stop is the current level, unless focus is already in the plane.
    const focused = el("plane").contains(document.activeElement)
      ? document.activeElement
      : planeButton(S.n, S.m);
    for (const b of nav.planeButtons) b.tabIndex = b === focused ? 0 : -1;
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
    recordView("Level");
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
  // History: every navigation is an entry in the browser's history, so Back and
  // Forward walk it, from the browser, the keyboard or the bar. This tab keeps a
  // summary of each entry for the list: its range, its level and what made it.
  // Browsers keep 50 entries a tab; the list keeps the same, so each maps to one.
  const HISTORY_KEPT = 50,
    // Steps of one kind in quick succession are one entry, so Back undoes a gesture.
    MERGED = new Set(["Zoom", "Pan", "Level", "Anchor", "Pinch"]),
    MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    KEYS = { back: MAC ? "⌘[" : "Alt+←", forward: MAC ? "⌘]" : "Alt+→" };
  const hist = { entries: [], index: -1, at: 0 };
  const newId = () => Math.random().toString(36).slice(2, 10);
  function summary() {
    return {
      hash: viewHash(),
      tA: S.tA,
      tB: S.tB,
      cut: CUT,
      n: S.n,
      m: S.m,
      window: S.window,
      replay: S.replay,
    };
  }
  function replaceURL(entry) {
    try {
      history.replaceState({ explorer: entry.id }, "", entry.hash);
    } catch {
      // Browsers limit how often a page may rewrite its address; the view stands.
    }
  }
  // An entry is a place. A change that moves nothing (the encoding, the
  // overlays, the inspector's tab) rewrites the current entry instead.
  function recordView(label) {
    if (!ready) return;
    const current = hist.entries[hist.index],
      now = Date.now();
    if (current && place(current.hash) === place(viewHash())) {
      syncURL(true);
      return;
    }
    // Only the newest entry takes a merge: after Back, a step starts a new branch.
    if (
      current?.label === label &&
      MERGED.has(label) &&
      now - hist.at < 2500 &&
      hist.index === hist.entries.length - 1
    ) {
      Object.assign(current, summary());
      replaceURL(current);
    } else {
      hist.entries = hist.entries.slice(0, hist.index + 1);
      const entry = { id: newId(), label, ...summary() };
      hist.entries.push(entry);
      if (hist.entries.length > HISTORY_KEPT) hist.entries.shift();
      hist.index = hist.entries.length - 1;
      try {
        history.pushState({ explorer: entry.id }, "", entry.hash);
      } catch {
        // As above.
      }
    }
    hist.at = now;
    renderHistory();
  }
  // Where a view is, as opposed to how it is shown: its window or rectangle,
  // level, selection and replay.
  const place = (hash) =>
    hash
      .replace(/^#/, "")
      .split("&")
      .filter((x) => /^(w|t|p|r|sel|at|replay)=/.test(x))
      .join("&");
  // The address follows the view. A move nothing recorded becomes an entry of
  // its own; any other change, such as the encoding, rewrites the current one,
  // and so does a live view following the cutoff (rewrite).
  function syncURL(rewrite = false) {
    const current = hist.entries[hist.index];
    if (!current) return;
    if (!rewrite && place(current.hash) !== place(viewHash())) {
      recordView("View");
      return;
    }
    if (current.hash === viewHash() && location.hash === current.hash) return;
    Object.assign(current, summary());
    replaceURL(current);
    renderHistory();
  }
  function saveHistory() {
    try {
      window.explorerState?.saveHistory({
        entries: hist.entries,
        index: hist.index,
      });
    } catch {
      // The tab's list lasts until it closes; only a reload forgets it.
    }
  }
  // The tab's list survives a reload, when the address is still one of its
  // entries; a new tab, or a link, starts a list of its own.
  function startHistory(label) {
    let kept = null;
    try {
      kept = window.explorerState?.history();
    } catch {
      // No list to continue.
    }
    const entries = Array.isArray(kept?.entries)
        ? kept.entries.filter(
            (x) =>
              x &&
              typeof x.id === "string" &&
              typeof x.label === "string" &&
              typeof x.hash === "string" &&
              [x.tA, x.tB, x.cut, x.n, x.m].every(Number.isFinite),
          )
        : [],
      i = entries.findIndex((x) => x.id === history.state?.explorer);
    if (i >= 0) {
      hist.entries = entries;
      hist.index = i;
      Object.assign(entries[i], summary());
    } else {
      hist.entries = [{ id: newId(), label, ...summary() }];
      hist.index = 0;
    }
    replaceURL(hist.entries[hist.index]);
    renderHistory();
    saveHistory();
  }
  // Text for the history and saved-view rows. (Named apart from line(), the
  // canvas's own: two functions of one name here, the later replaces the other.)
  function rowText(text, className) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }
  const levelText = (n, m) => `${dur(BASE * 2 ** n)} × ${price(PR * 2 ** m)} USDT`,
    // Lists name a range to the minute: "15 Sep 04:21 → 22 Sep 21:59".
    minute = (b) => (Math.round((b * BASE) / 60) * 60) / BASE,
    listRange = (a, b) => range(minute(a), minute(b));
  function entryPlace(x) {
    return windowKey(x.window)
      ? windowLabel(windowKey(x.window))
      : listRange(x.tA, Math.min(x.tB, x.cut));
  }
  // Back, Forward and the list: each entry names its range and level.
  function renderHistory() {
    const back = hist.entries[hist.index - 1],
      forward = hist.entries[hist.index + 1];
    el("hist-back").disabled = !back;
    el("hist-fwd").disabled = !forward;
    el("hist-back").dataset.hint = back ? `To ${entryPlace(back)}` : "";
    el("hist-back").dataset.keys = KEYS.back;
    el("hist-fwd").dataset.hint = forward ? `To ${entryPlace(forward)}` : "";
    el("hist-fwd").dataset.keys = KEYS.forward;
    if (el("hist-pop").hidden) return;
    const frag = document.createDocumentFragment();
    for (let i = hist.entries.length - 1; i >= 0; i--) {
      const x = hist.entries[i],
        b = document.createElement("button");
      b.type = "button";
      b.className = "ol-entry cursor-interaction";
      b.setAttribute("aria-current", i === hist.index ? "step" : "false");
      b.append(
        rowText(entryPlace(x), "ol-entry-main"),
        rowText(
          `${levelText(x.n, x.m)}${x.replay ? " · replay" : ""} · ${x.label}`,
          "ol-entry-sub",
        ),
      );
      b.addEventListener("click", () => {
        closePop();
        if (i !== hist.index) history.go(i - hist.index);
      });
      frag.append(b);
    }
    el("breadcrumbs").replaceChildren(frag);
  }
  // Back and Forward return to a place and leave how it is shown alone; an
  // address edited by hand is taken whole.
  addEventListener("popstate", (e) => {
    if (!ready) return;
    const view = readView(location.hash);
    if (!view) return;
    transition = reduce
      ? null
      : { n: renderN(), m: renderM(), start: performance.now() };
    const i = hist.entries.findIndex((x) => x.id === e.state?.explorer);
    applyView(
      i < 0
        ? view
        : {
            ...view,
            follow: followMode(),
            mode: S.mode,
            poc: S.poc,
            area: S.area,
            untested: S.untested,
            tab: S.tab,
            evidenceKind: S.evidenceKind,
            horizon: S.horizon,
            barrier: S.barrier,
          },
    );
    // The step after Back or Forward is new, whatever its kind.
    hist.at = 0;
    if (i >= 0) hist.index = i;
    else if (e.state?.explorer) {
      // An entry this list no longer holds: where it sits among the browser's is
      // unknown, so the list starts again from it rather than guess.
      hist.entries = [{ id: e.state.explorer, label: "View", ...summary() }];
      hist.index = 0;
    } else {
      // An address edited by hand: a new entry after the current one.
      hist.entries = hist.entries.slice(0, hist.index + 1);
      hist.entries.push({ id: newId(), label: "Link", ...summary() });
      hist.index = hist.entries.length - 1;
    }
    update();
    syncURL(true);
    save();
  });

  // Named views, kept by this browser for every tab. A view saved while it
  // shows the cutoff is live: it opens on the latest data with the same span
  // and fits the price range again, as the price has moved since.
  const views = { list: [], undo: null };
  function loadViews() {
    let list = null;
    try {
      list = window.explorerState?.views();
    } catch {
      // No saved views to show.
    }
    views.list = Array.isArray(list)
      ? list.filter(
          (x) =>
            x &&
            typeof x.name === "string" &&
            typeof x.hash === "string" &&
            [x.span, x.lead, x.tA, x.tB, x.cut, x.n, x.m].every(Number.isFinite),
        )
      : [];
  }
  function storeViews() {
    try {
      window.explorerState.saveViews(views.list);
      return true;
    } catch {
      viewsStatus("This browser's storage is unavailable, so views can't be saved.");
      return false;
    }
  }
  const atCutoff = () => !S.replay && S.tA < CUT && S.tB >= CUT;
  function viewPlace() {
    return S.window
      ? windowLabel(S.window)
      : atCutoff()
        ? `Last ${dur((CUT - S.tA) * BASE)}`
        : listRange(S.tA, Math.min(S.tB, CUT));
  }
  // Every change starts from the list as stored, so two tabs saving at once
  // both keep their views.
  function saveView(name) {
    name = name.trim().slice(0, 80);
    if (!name) {
      viewsStatus("Name the view to save it.");
      return;
    }
    loadViews();
    const view = {
        name,
        live: !S.window && atCutoff(),
        span: S.tB - S.tA,
        lead: S.tB - CUT,
        auto: S.auto,
        mode: S.mode,
        ...summary(),
      },
      i = views.list.findIndex((x) => x.name === name);
    if (i >= 0) views.list[i] = view;
    else views.list.push(view);
    views.undo = null;
    if (storeViews())
      viewsStatus(i >= 0 ? `Updated “${name}”.` : `Saved “${name}”.`);
    renderViews();
  }
  function openView(x) {
    const view = readView(x.hash);
    if (!view) return;
    if (x.live && !view.window) {
      view.tB = CUT + x.lead;
      view.tA = view.tB - x.span;
    }
    transition = reduce
      ? null
      : { n: renderN(), m: renderM(), start: performance.now() };
    applyView(view);
    if (x.live) {
      fit();
      if (S.auto) autoLevel();
    }
    update();
    recordView(x.name);
    save();
  }
  function deleteView(name) {
    loadViews();
    const i = views.list.findIndex((x) => x.name === name);
    if (i < 0) return renderViews();
    const [gone] = views.list.splice(i, 1);
    if (!storeViews()) {
      views.list.splice(i, 0, gone);
      return;
    }
    views.undo = { view: gone, index: i };
    viewsStatus(`Deleted “${gone.name}”.`, true);
    renderViews();
  }
  function undoDelete() {
    const { view, index } = views.undo || {};
    if (!view) return;
    loadViews();
    // A view saved under the same name since then stays.
    if (!views.list.some((x) => x.name === view.name))
      views.list.splice(Math.min(index, views.list.length), 0, view);
    views.undo = null;
    if (storeViews()) viewsStatus(`Restored “${view.name}”.`);
    renderViews();
  }
  function viewsStatus(text, undo = false) {
    const node = el("views-status");
    node.replaceChildren(text);
    if (undo) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ol-action ol-s cursor-interaction";
      b.textContent = "Undo";
      b.addEventListener("click", undoDelete);
      node.append(" ", b);
    }
  }
  function viewDetail(x) {
    return [
      windowKey(x.window)
        ? windowLabel(windowKey(x.window))
        : x.live
          ? `Last ${dur((x.span - x.lead) * BASE)}`
          : listRange(x.tA, Math.min(x.tB, x.cut)),
      x.auto ? "auto level" : levelText(x.n, x.m),
      // A view saved in a retired encoding (Density) opens as Volume and
      // names none.
      ...(x.mode !== "volume" && MODE_NAMES[x.mode] ? [MODE_NAMES[x.mode]] : []),
    ].join(" · ");
  }
  function renderViews() {
    if (el("hist-pop").hidden) return;
    const frag = document.createDocumentFragment();
    views.list.forEach((x, i) => {
      const row = document.createElement("div"),
        open = document.createElement("button"),
        remove = document.createElement("button");
      row.className = "ol-saved-row";
      open.type = remove.type = "button";
      open.className = "ol-entry cursor-interaction";
      open.title = x.window || x.live
        ? "Opens on the latest data"
        : "Opens where it was saved";
      open.append(rowText(x.name, "ol-entry-main"), rowText(viewDetail(x), "ol-entry-sub"));
      open.addEventListener("click", () => {
        closePop();
        openView(x);
      });
      remove.className = "ol-icon-button ol-s cursor-interaction";
      remove.setAttribute("aria-label", `Delete “${x.name}”`);
      remove.title = "Delete this view";
      remove.innerHTML =
        '<svg class="ol-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>';
      remove.addEventListener("click", () => deleteView(x.name));
      row.append(open, remove);
      frag.append(row);
    });
    if (!views.list.length)
      frag.append(
        rowText(
          "No saved views yet. A view saved while it shows the latest data opens on the latest data.",
          "ol-muted ol-empty",
        ),
      );
    el("saved").replaceChildren(frag);
  }
  // Open the views popover; to save, with the name field ready to type.
  function openViews(naming = false) {
    if (el("hist-pop").hidden) el("hist").click();
    if (naming) {
      el("view-name").focus();
      el("view-name").select();
    }
  }
  function updateNavigation() {
    el("auto").setAttribute("aria-pressed", String(S.auto));
    el("lens-depth").value = String(clamp(Math.round(S.lensDepth) || 2, 1, 4));
    const g = navGeometry(),
      px = (stepT() * g.w) / (S.tB - S.tA),
      py = (stepP() * g.h) / (S.pB - S.pA),
      fmt = (x) => (x < 1 ? x.toFixed(1) : Math.round(x));
    // The one pixels-per-cell readout, in the status bar.
    el("pixel-state").textContent = `${fmt(px)} × ${fmt(py)} px per cell`;
    nav.planeStatus = `Requested n ${S.n} · m ${S.m}${renderN() !== S.n || renderM() !== S.m ? ` · displayed n ${renderN()} · m ${renderM()}` : ""} · diagonal m = round(${ISO_A} + ${ISO_B} n)`;
    if (!nav.planeHover) setPlaneStatus(nav.planeStatus);
    el("gesture").textContent = S.lens
      ? "Move to inspect · Enter: pin the lens view · Shift+L: depth · V: pan"
      : S.select
        ? "Drag a rectangle to measure it · click to clear it · Esc: back to pan"
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
      recordView(label);
      save();
    }
  }
  // A zoom leaves the price range alone: refit mode fits it once, when the
  // zoom gesture ends (see endZoom).
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
    settleNavigation(null, false);
    return p;
  }
  function refitAfterGesture() {
    if (!S.refit || S.coupled || S.diagonal) return;
    fit();
    if (S.auto) autoLevel();
    update();
  }
  // A zoom gesture runs while any zoom input does: a held zoom key, a pinch
  // or the wheel's ticks. It ends 220 ms after the last of them (a wheel tick,
  // a key's release, a pinch's lift, a double-click), so inputs that follow
  // one another closely make one gesture; a held key's first repeat can come
  // later than that, so a key zooms on until it comes up. Then the price range
  // refits once, if time was zoomed, and the zoom is recorded under the name
  // of its last input.
  function zoomStep(timeZoomed) {
    nav.zoomTime = nav.zoomTime || timeZoomed;
    clearTimeout(nav.zoomTimer);
  }
  function endZoom(timeZoomed, label = "Zoom") {
    zoomStep(timeZoomed);
    nav.zoomLabel = label;
    if (nav.zoomKeys.size || nav.pinch) return;
    nav.zoomTimer = setTimeout(() => {
      if (nav.zoomTime) refitAfterGesture();
      nav.zoomTime = false;
      recordView(nav.zoomLabel);
      save();
    }, 220);
  }
  // Room for the lens caption tab: up to three 15px lines. The lens leaves twice
  // this free, so the tab fits above or below it wherever the lens goes.
  const LENS_CAPTION = 8 + 3 * 15;
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
      h = Math.min(170, G.h - 8 - 2 * LENS_CAPTION),
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
    recordView("Pinned lens");
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
          area = ts * BASE * ps * PR,
          deltas = q.cells
            .map((z) => Math.abs(2 * z.bv - z.v))
            .filter(Boolean)
            .sort((x, y) => x - y),
          deltaMax = d3.quantileSorted(deltas, 0.995) || 1;
        localLegend =
          S.mode === "delta"
            ? `Δ −${compact(deltaMax)} · 0 · +${compact(deltaMax)} USDT`
            : S.mode === "flow"
              ? "Buy share 25% · 50% · 75%"
              : S.mode === "geometry"
                ? "Occupied cells"
                : `${compact(Math.exp(q.lo))}–${compact(Math.exp(q.hi))} USDT · log`;
        for (const z of q.cells) {
          const xa = G.X(z.c * ts),
            xb = G.X(Math.min((z.c + 1) * ts, b)),
            ya = G.Y((z.r + 1) * ps),
            yb = G.Y(z.r * ps),
            exposure = cellExposure(z, lensBounds, ts, ps);
          ctx.fillStyle = cellColour(
            z,
            q.lo,
            q.hi,
            deltaMax,
            exposure.area > 0 ? (z.v * area) / exposure.area : z.v,
          );
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
    ctx.restore();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    lensCaption(x, y, h, [
      [label, colors.ink],
      [sub, colors.muted],
      ...(localLegend ? [[localLegend, colors.muted]] : []),
    ]);
  }
  // The caption sits on a tab outside the lens, so the lens shows only data:
  // above it when there is room, otherwise below. The tab is sized to its text.
  function lensCaption(x, y, lensHeight, lines) {
    ctx.font = `${TYPE.s}px ${FONT}`;
    const room = G.w - 8,
      fitted = lines.map(([s, color]) => [fitText(s, room - 14), color]),
      w = Math.min(
        room,
        Math.ceil(Math.max(...fitted.map(([s]) => ctx.measureText(s).width))) +
          14,
      ),
      h = 8 + 15 * fitted.length,
      left = clamp(x, G.x + 4, G.x + G.w - w - 4),
      top = y - h >= G.y + 4 ? y - h : y + lensHeight - 1;
    ctx.fillStyle = colors.surface;
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h);
    fitted.forEach(([s, color], i) =>
      text(s, left + 7, top + 11.5 + 15 * i, color, "left", 11),
    );
  }
  function fitText(s, max) {
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(s + "…").width > max)
      s = s.slice(0, -1);
    return s + "…";
  }
  function bindNavigation() {
    if (nav.bound) return;
    nav.bound = true;
    el("auto").addEventListener("click", toggleAuto);
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
      setPlaneStatus(nav.planeStatus || "");
    };
    el("plane").addEventListener("mouseleave", leavePlane);
    el("plane").addEventListener("focusout", (e) => {
      if (!el("plane").contains(e.relatedTarget)) leavePlane();
    });
    el("plane").addEventListener("keydown", planeKeys);
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
        // A pinch joins the zoom gesture: an end the wheel or a key had set
        // waits for the fingers.
        zoomStep(true);
        drag = null;
        return;
      }
      drag = {
        start: p,
        view: [S.tA, S.tB, S.pA, S.pB],
        moved: false,
        lens: S.lens || e.altKey,
      };
      setCursor(p);
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
      setCursor(p);
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
        // The price range refits once, when a finger lifts (see finish).
        settleNavigation(null, false);
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
          settleNavigation(null, false);
          endZoom(true, "Pinch");
        }
        return;
      }
      if (!drag) {
        nav.hold = false;
        return;
      }
      const p = at(e),
        held = drag.lens || nav.hold,
        click = !held && !drag.moved,
        // A click with Select clears the selection; with Pan it anchors the
        // column clicked, for the continuations.
        cleared = click && S.select && S.selection !== null;
      if (click && S.select) S.selection = null;
      else if (click && inPlot(p) && p.t < activeCutoff()) {
        S.anchor = (Math.floor(p.t / stepT()) + 1) * stepT();
        S.tab = "evidence";
      }
      const label = held
        ? null
        : drag.moved
          ? S.select
            ? "Selection"
            : "Pan"
          : S.select
            ? cleared
              ? "Selection cleared"
              : null
            : "Anchor";
      drag = null;
      nav.hold = false;
      setCursor(p);
      if (
        S.selection &&
        (S.selection[0] === S.selection[1] || S.selection[2] === S.selection[3])
      )
        S.selection = null;
      settleNavigation(label, false);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", (e) => {
      // A cancelled pinch has already moved the view: it ends as a lifted one.
      if (nav.pinch) return finish(e);
      clearTimeout(nav.holdTimer);
      nav.pointers.delete(e.pointerId);
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
        syncRowHover(null);
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
        gestureAt = performance.now();
        zoomNavigation(
          Math.exp(clamp(e.deltaY, -120, 120) * 0.003),
          p,
          e.shiftKey,
        );
        endZoom(!e.shiftKey);
      },
      { passive: false },
    );
    canvas.addEventListener("dblclick", (e) => {
      if (!ready) return;
      const p = at(e);
      if (!inPlot(p)) return;
      zoomNavigation(0.5, p, e.shiftKey);
      if (!S.replay) S.anchor = null;
      // A drill is a zoom gesture of one step.
      endZoom(!e.shiftKey, "Drill");
    });
    // Keys work anywhere on the page except in text fields and lists, which
    // keep their own; the browser keeps its shortcuts, and Alt with an arrow is
    // its Back and Forward. Every key is listed under ? (see the key list).
    // The characters with keys of their own, which a digit key never stands in for.
    const OWN_KEYS = ["?", "[", "]", "{", "}", "+", "=", "-", "_", ",", ".", " "];
    const TEXT_FIELDS =
      'input:not([type="checkbox"]):not([type="radio"]), select, textarea, [contenteditable]:not([contenteditable="false"])';
    document.addEventListener("keydown", (e) => {
      const target = e.target instanceof Element ? e.target : null,
        // The level keys go by the character typed, [ ] for time cells and
        // { } for price cells, which some layouts type with AltGr or Option.
        bracket = { "[": [-1, 0], "]": [1, 0], "{": [0, -1], "}": [0, 1] }[e.key],
        typed = Boolean(bracket) && (e.altKey || e.getModifierState?.("AltGraph")),
        id = e.code || e.key,
        step =
          Boolean(bracket) ||
          e.key.startsWith("Arrow") ||
          ["+", "=", "-", "_", ",", "."].includes(e.key);
      // A held key repeats only steps: the arrows, zoom, levels and the anchor.
      // Any other key the chart took acts once a press, whatever is pressed or
      // focused while it is held: a held toggle doesn't flicker, a held Space
      // doesn't stall a replay, and a held Shift+S doesn't type into the name
      // field it opened.
      if (e.repeat && !step && nav.pressed.has(id)) {
        e.preventDefault();
        return;
      }
      if (
        !ready ||
        e.defaultPrevented ||
        e.isComposing ||
        e.metaKey ||
        (e.ctrlKey && !typed) ||
        target?.closest(TEXT_FIELDS)
      )
        return;
      if (e.key === "Alt") {
        nav.alt = true;
        el("tip").hidden = true;
        setCursor();
        requestDraw();
        return;
      }
      // Shift, held, shows the tooltip's values exact.
      if (e.key === "Shift") {
        if (!nav.shift && hover && !el("tip").hidden) {
          nav.shift = true;
          tooltip(hover);
        }
        nav.shift = true;
        return;
      }
      if (e.altKey && !typed) return;
      // The key list is a modal dialog: it handles Escape, and ? closes it.
      if (el("keys").open) {
        if (e.key === "?") {
          e.preventDefault();
          nav.pressed.add(id);
          el("keys").close();
        }
        return;
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key,
        shift = e.shiftKey,
        // The digit typed, or on layouts that type another character there (AZERTY)
        // the digit key, unless that character is a key of its own: AZERTY types
        // - and _ there, Czech + (zoom). A keypad with NumLock off types End and
        // the arrows instead.
        digit = /^[0-9]$/.test(e.key)
          ? e.key
          : !shift && /^Digit[0-9]$/.test(e.code) && !OWN_KEYS.includes(e.key)
            ? e.code.slice(-1)
            : null,
        centre = { t: (S.tA + S.tB) / 2, p: (S.pA + S.pB) / 2 };
      // A held key repeats like a gesture: the continuations wait for it to end.
      if (e.repeat) gestureAt = performance.now();
      if (e.key === "?") openKeys();
      else if (digit) chooseWindow(WINDOW_KEYS[digit]);
      else if (bracket)
        changeResolution(S.n + bracket[0], S.m + bracket[1], !bracket[1]);
      else if (["+", "=", "-", "_"].includes(k)) {
        zoomNavigation(k === "-" || k === "_" ? 1.4 : 1 / 1.4, centre, shift);
        // Held, zoom keys zoom on until the last of them comes up (see the
        // keyup below).
        zoomStep(!shift);
        nav.zoomKeys.add(id);
      } else if (k.startsWith("Arrow")) {
        const dt = (S.tB - S.tA) * 0.15,
          dp = (S.pB - S.pA) * 0.15,
          [x, y] = {
            ArrowLeft: [-dt, 0],
            ArrowRight: [dt, 0],
            ArrowUp: [0, dp],
            ArrowDown: [0, -dp],
          }[k] || [0, 0];
        S.tA += x;
        S.tB += x;
        S.pA += y;
        S.pB += y;
        S.window = "";
        settleNavigation("Pan", false);
      } else if (k === "End") jumpLatest();
      else if (k === "Escape") escapeKey();
      else if (k === "Enter") {
        // Enter on a control presses it; anywhere else it pins the lens.
        if (
          !(S.lens || nav.alt || nav.hold) ||
          (target !== canvas && target?.closest("button, a, summary, [tabindex]"))
        )
          return;
        pinLens();
      } else if (k === "a") toggleAuto();
      else if (k === "l" && shift) {
        S.lensDepth = (clamp(Math.round(S.lensDepth) || 2, 1, 4) % 4) + 1;
        update();
        save();
      } else if (k === "l") setTool(S.lens ? "pan" : "lens");
      else if (k === "s" && shift) openViews(true);
      else if (k === "s") setTool(S.select ? "pan" : "select");
      else if (k === "v") setTool("pan");
      else if (k === "d") setFollow(S.diagonal ? "free" : "diagonal");
      else if (k === "f") fitPrice("Fit price");
      else if (k === "," || k === ".") stepAnchor(k === "," ? -1 : 1);
      else if (k === "m") {
        const i = MODES.indexOf(S.mode) + (shift ? -1 : 1);
        setMode(MODES[(i + MODES.length) % MODES.length]);
      } else if (k === "p") {
        S.poc = !S.poc;
        update();
        save();
      } else if (k === "r") toggleReplay();
      // Space plays and pauses a replay, where no control takes it.
      else if (
        k === " " &&
        S.replay &&
        !target?.closest("button, a, summary, [role=tab], [role=separator]")
      )
        setPlaying(!player.timer);
      else if (k === "c") {
        S.tab = S.tab === "evidence" ? "context" : "evidence";
        S.sideOpen = true;
        update();
        save();
      } else if (k === "i") {
        S.sideOpen = !S.sideOpen;
        applyPanels();
        save();
      } else if (k === "t") openDrawer(S.drawer, !S.drawerOpen);
      else if (k === "h") el("hist").click();
      else if (k === "w") openMenu("window");
      else return;
      e.preventDefault();
      nav.pressed.add(id);
    });
    window.addEventListener("keyup", (e) => {
      if (e.key === "Alt") {
        nav.alt = false;
        setCursor();
        requestDraw();
      }
      if (e.key === "Shift" && nav.shift) {
        nav.shift = false;
        if (hover && !el("tip").hidden) tooltip(hover);
      }
      const id = e.code || e.key;
      nav.pressed.delete(id);
      if (nav.zoomKeys.delete(id) && !nav.zoomKeys.size) endZoom(false);
    });
    window.addEventListener("blur", () => {
      // Losing focus lets go of every key and pointer, and ends a zoom gesture
      // under the name of the input it cut short.
      const label = nav.pinch ? "Pinch" : nav.zoomKeys.size ? "Zoom" : "";
      nav.zoomKeys.clear();
      nav.pinch = null;
      if (label) endZoom(false, label);
      nav.pressed.clear();
      nav.alt = false;
      nav.shift = false;
      nav.hold = false;
      drag = null;
      nav.pointers.clear();
      clearTimeout(nav.holdTimer);
      requestDraw();
    });
  }

  // Commands shared by the controls and their keys.
  function chooseWindow(w) {
    if (pop.open?.panel === el("window-menu")) closePop(true);
    setWindow(w);
    recordView("Window");
    update();
    save();
  }
  function setMode(mode) {
    S.mode = mode;
    update();
    save();
  }
  function toggleAuto() {
    S.auto = !S.auto;
    autoLevel();
    update();
    recordView(S.auto ? "Auto" : "Locked");
    save();
  }
  function fitPrice(label) {
    fit();
    if (S.auto) autoLevel();
    recordView(label);
    update();
    save();
  }
  // Replay only hides the trades after its anchor: the price range, the
  // selection and the inspector stay as they were.
  function toggleReplay() {
    S.replay = !S.replay;
    if (!S.replay) setPlaying(false);
    if (S.replay && S.anchor === null)
      S.anchor =
        Math.floor((S.tA + (Math.min(S.tB, CUT) - S.tA) * 0.65) / stepT()) *
        stepT();
    hover = null;
    el("tip").hidden = true;
    recordView(S.replay ? "Replay" : "Cutoff");
    update();
    save();
  }
  // The same span, moved to end at the cutoff with a tenth of it to spare, as a
  // window does; replay ends, since the latest data is what was asked for.
  function jumpLatest() {
    setPlaying(false);
    const span = S.tB - S.tA;
    S.tB = CUT + span * (0.105 / 1.105);
    S.tA = S.tB - span;
    S.replay = false;
    S.window = "";
    settleNavigation("Latest", true);
  }
  // Escape closes what is open first, then clears the selection, then goes
  // back to Pan from Select or the lens.
  function escapeKey() {
    if (closePop(true)) return;
    if (root.dataset.sheet === "open") {
      setSheet(false);
      el("sheet-toggle").focus();
      return;
    }
    nav.hold = false;
    nav.alt = false;
    if (S.selection) {
      S.selection = null;
      update();
      recordView("Selection cleared");
      save();
    } else if (S.select || S.lens) setTool("pan");
    else update();
  }
  qsa("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)),
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
  el("clear").addEventListener("click", () => {
    S.selection = null;
    recordView("Selection cleared");
    update();
    save();
  });
  el("latest").addEventListener("click", jumpLatest);
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
  el("replay").addEventListener("click", toggleReplay);
  for (const [id, delta] of [
    ["back", -1],
    ["next", 1],
  ])
    el(id).addEventListener("click", () => stepAnchor(delta));
  el("play").addEventListener("click", () => setPlaying(!player.timer));
  el("speed").addEventListener("change", () => {
    if (player.timer) setPlaying(true);
  });
  el("replay-now").addEventListener("click", jumpLatest);

  // The tab's title carries the market: the latest POC and the instrument, and
  // the snapshot's day, or that live updates have stopped.
  function title() {
    const src = sources.recent;
    let poc = null;
    if (src?.cells.length) {
      const last = src.cells.at(-1).c;
      let best = -1;
      // Ties choose the lower row, as every POC does.
      for (let i = src.cells.length - 1; i >= 0 && src.cells[i].c === last; i--)
        if (src.cells[i].v >= best) {
          best = src.cells[i].v;
          poc = src.cells[i].r;
        }
    }
    document.title = [
      poc === null
        ? INSTRUMENT
        : `${price((poc + 0.5) * PR * 2 ** src.m)} ${INSTRUMENT}`,
      !PACK.live ? day(CUT) : live.state === "live" ? "" : "not updating",
      "Cube Explorer",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  // Live data. The page asks the bridge what changed since its pack, when the
  // bridge says a newer one can be ready, and puts it in place: the columns
  // each tier gained, or the whole pack when the cube's history changed. A view
  // showing the cutoff follows it; any other view stays where it is.
  const TIERS = ["overview", "recent", "reference"];
  const live = {
    state: "live", // live, stale (the cube has no new data) or stopped (no answer)
    timer: 0,
    busy: false,
    failures: 0,
    error: "",
    ok: Date.now(), // the bridge's last answer
    // When the cube's data last advanced, as the bridge saw it: a cube that stalled
    // before the page opened is stale from the start.
    updated: Date.now() - (Number(PACK.quiet ?? PACK.age) || 0) * 1000,
    generation: 0, // counts whole packs; a tile asked for before one is dropped
    notice: false, // the loading line is saying that updates stopped
  };
  // A request that hangs counts as a failure, so the page retries and can say so.
  const LIVE_TIMEOUT = 60000;
  // An answer is used only when it is one of the three the bridge sends, whole.
  function checkUpdate(body) {
    const pack = body?.status === "pack" ? body.pack : body,
      whole = (x) =>
        x &&
        typeof x.cutoff === "string" &&
        Number.isFinite(Date.parse(x.cutoff)) &&
        typeof x.state_token === "string" &&
        TIERS.every((id) => typeof x.blocks?.[id]?.gzip_base64 === "string");
    if (body?.status === "current" && typeof body.state_token === "string") return;
    if (body?.status === "pack" && whole(pack)) return;
    if (
      body?.status === "delta" &&
      whole(body) &&
      TIERS.every((id) => Number.isFinite(body.blocks[id].from))
    )
      return;
    throw Error("the server's answer couldn't be read");
  }
  function scheduleLive(seconds) {
    clearTimeout(live.timer);
    // A hidden tab asks at most once a minute; showing it again asks at once.
    const wait = document.hidden ? Math.max(60, seconds) : seconds;
    live.timer = setTimeout(pollLive, clamp(wait, 3, 300) * 1000);
  }
  async function pollLive() {
    if (live.busy) return;
    live.busy = true;
    clearTimeout(live.timer);
    let next;
    try {
      // A tier that never loaded can't take a delta: then the whole pack.
      const since = TIERS.every((id) => sources[id]) ? PACK.state_token : "",
        target = new URL(
          `/cube/pack?since=${encodeURIComponent(since)}`,
          location.href,
        );
      target.username = "";
      target.password = "";
      const response = await fetch(target, {
          cache: "no-store",
          signal: AbortSignal.timeout(LIVE_TIMEOUT),
        }),
        body = await response.json().catch(() => null);
      if (!response.ok)
        throw Error(body?.error || `the server answered ${response.status}`);
      checkUpdate(body);
      if (body.status === "delta") await applyLive(body, false);
      else if (body.status === "pack") await applyLive(body.pack, true);
      if (Number.isFinite(body.quiet)) live.updated = Date.now() - body.quiet * 1000;
      live.failures = 0;
      live.error = "";
      live.ok = Date.now();
      next = Number(body.next) || 20;
    } catch (error) {
      live.failures++;
      // The server's own words end a sentence the page continues.
      live.error = (
        error.name === "TimeoutError"
          ? "the server didn't answer within a minute"
          : error instanceof TypeError
            ? "the server can't be reached"
            : error.message
      ).replace(/\.+$/, "");
      next = Math.min(120, 15 * 2 ** (live.failures - 1));
    }
    live.busy = false;
    renderLive();
    scheduleLive(next);
  }
  async function applyLive(body, whole) {
    const was = CUT,
      parts = {};
    // Everything is decoded before anything changes: no frame sees half a pack.
    for (const id of TIERS)
      if (body.blocks?.[id]) parts[id] = await unpack(body.blocks[id], id);
    if (whole) {
      for (const id of Object.keys(sources))
        if (!TIERS.includes(id)) {
          delete sources[id];
          delete loadState[id];
          delete PACK.blocks[id];
        }
      live.generation++;
      tiles.stale = false;
    }
    for (const [id, part] of Object.entries(parts)) {
      const src = sources[id],
        meta = { ...body.blocks[id] };
      if (whole || !src) sources[id] = part;
      else {
        // The page keeps its columns before `from` that are still in the tier.
        src.cells = src.cells
          .filter((c) => c.c >= part.col0 && c.c < meta.from)
          .concat(part.cells);
        Object.assign(src, {
          b0: part.b0,
          b1: part.b1,
          col0: part.col0,
          col1: part.col1,
        });
      }
      loadState[id] = "ready";
      delete meta.gzip_base64;
      PACK.blocks[id] = meta;
    }
    for (const key of [
      "cutoff",
      "cutoffBase",
      "data_cutoff",
      "canonical_through",
      "state_token",
      "partitions",
    ])
      if (key in body) PACK[key] = body[key];
    CUT = (Date.parse(PACK.cutoff) / 1000 - T0) / BASE;
    CUT_YEAR = date(CUT).getUTCFullYear();
    groups.clear();
    evidenceCache.clear();
    rebuildReference();
    followCutoff(was);
    chooseSource();
    limits();
    update();
    title();
  }
  // A view that showed the old cutoff moves with it, keeping its span; a window
  // keeps its length. Not during a gesture, and never in replay.
  function followCutoff(was) {
    if (CUT === was || S.replay || !(S.tA < was && S.tB >= was) || gesturing())
      return;
    if (S.window) windowRange(S.window);
    else {
      S.tA += CUT - was;
      S.tB += CUT - was;
    }
    if (S.window || (S.refit && !S.coupled && !S.diagonal)) fit();
    confine();
    if (S.auto) autoLevel();
    hover = null;
    el("tip").hidden = true;
    syncURL(true);
    save();
  }
  // The state pill: how fresh the data is, and plainly when updates stop.
  function renderLive() {
    if (!PACK.live) return;
    const now = Date.now(),
      quiet = now - live.updated,
      state =
        live.failures && now - live.ok > 45000
          ? "stopped"
          : quiet > 300000
            ? "stale"
            : "live",
      pill = el("state-pill");
    el("fresh").textContent =
      state === "stopped"
        ? "updates stopped"
        : state === "stale"
          ? `no new data for ${elapsed(quiet)}`
          : `updated ${ago(quiet)}`;
    pill.dataset.state = state;
    pill.title =
      state === "stopped"
        ? `No answer from the server for ${elapsed(now - live.ok)}: ${live.error}. The page keeps asking.`
        : `Data through ${when(CUT)} UTC. The page asks for new data about once a minute` +
          (state === "stale" ? "; the cube has had none since." : ".");
    if (state === live.state) return;
    live.state = state;
    title();
    // The loading line says it once, where assistive technology hears it.
    const note = el("loading");
    if (state === "stopped") {
      note.textContent = `Live updates stopped: ${live.error}. The page keeps asking.`;
      note.hidden = false;
      live.notice = true;
    } else if (live.notice) {
      note.hidden = true;
      live.notice = false;
    }
  }
  function startLive() {
    if (!PACK.live) return;
    renderLive();
    setInterval(() => {
      if (!document.hidden) renderLive();
    }, 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      renderLive();
      if (!live.busy && Date.now() - live.ok > 15000) pollLive();
    });
    scheduleLive(Number(PACK.next) || 20);
  }

  bindRoot();
  bindEvidence();
  bindNavigation();
  try {
    qsa("button,input,select").forEach((control) => (control.disabled = true));
    el("market").textContent = PACK.live ? "LIVE" : "RECORDED";
    el("fresh").hidden = !PACK.live;
    for (const kbd of qsa("[data-key]")) kbd.textContent = KEYS[kbd.dataset.key];
    getColors();
    sources.recent = await unpack(PACK.blocks.recent, "recent");
    // Decoded blocks keep their metadata only: a tab open all day holds no payloads.
    delete PACK.blocks.recent.gzip_base64;
    loadState.recent = "ready";
    ready = true;
    geometry();
    setWindow("24h");
    // The address names the view; without one the page opens on the view this
    // browser showed last. The workspace is this browser's either way.
    const linked = readView(location.hash),
      restored = restore(window.explorerState?.saved);
    if (linked) applyView(linked);
    transition = null;
    qsa("button,input,select").forEach((control) => (control.disabled = false));
    startHistory(linked ? "Link" : restored ? "Restored" : "Opened");
    update();
    title();
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
        `Loading ${id === "overview" ? "the full history" : "the 30-day archive"}${PACK.live ? " from the cube" : ""}…`;
      try {
        sources[id] = await unpack(PACK.blocks[id], id);
        delete PACK.blocks[id].gzip_base64;
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
    startLive();
  } catch (error) {
    el("loading").textContent =
      (PACK.live ? "Cube data unavailable: " : "Recorded data unavailable: ") +
      error.message;
    el("loading").setAttribute("role", "alert");
  }
})();
