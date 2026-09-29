(async () => {
  "use strict";
  const root = document.getElementById("origo-lens"),
    el = (id) => root.querySelector("#ol-" + id),
    qsa = (s) => root.querySelectorAll(s),
    PACK = JSON.parse(document.getElementById("origo-lens-data").textContent);
  const BASE = PACK.base_seconds,
    PR = PACK.base_price,
    T0 = PACK.t0,
    INSTRUMENT = "BTC/USDT",
    // What this page reads from the server: MSC2 blocks and the open column.
    // The server tells a page that names no protocol, one from before it, to
    // reload rather than send it blocks it can't read.
    PROTOCOL = 2;
  // On the live host the cutoff advances in place as new data arrives. It is
  // the cube's data cutoff, a minute edge, so the base column that holds it is
  // open: it has the latest trades and still gains more.
  let CUT = (Date.parse(PACK.cutoff) / 1000 - T0) / BASE;
  // Where the cube's archived days end; after it, provisional minutes that the
  // day's archive later replaces. The recorded snapshot has no such edge.
  const canonOf = (pack) =>
    pack.canonical_through ? (Date.parse(pack.canonical_through) / 1000 - T0) / BASE : null;
  let CANON = canonOf(PACK);
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
      "path",
      "dwell",
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
      // The pane under the prices: Same as cells, or a measure of its own.
      pane: "cells",
      poc: true,
      area: false,
      untested: false,
      // The row underlay behind the cells (Rows, U), over a period of its own.
      rows: "off",
      period: "90d",
      // The level line (X): one price, in base rows, or none.
      level: null,
      // POC lines: the periods and days chosen, in list order.
      lines: [],
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
  // Prices and USDT amounts each keep one formatter: toLocaleString with
  // options builds a new one every call, and labels format prices every frame.
  const priceFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }),
    usdtFormat = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const integer = (x) => Math.round(x).toLocaleString("en-US"),
    price = (x) => priceFormat.format(x),
    usdt = (x) => usdtFormat.format(x),
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
  async function inflate(block) {
    const bytes = Uint8Array.from(atob(block.gzip_base64), (c) =>
      c.charCodeAt(0),
    );
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  // A block of cells: MSC1 in the recorded snapshot (counts as 32 bits), MSC2
  // from the live cube (counts as 64-bit floats, exact to 2⁵³), and MSC3, MSC2
  // with how the price moved inside each cell: its path length (USDT), its
  // dwell (seconds), and its highest and lowest trade (NaN without trades).
  async function unpack(block, id) {
    const buf = await inflate(block),
      v = new DataView(buf),
      magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    if (magic !== "MSC1" && magic !== "MSC2" && magic !== "MSC3")
      throw Error("Invalid block of cells");
    const n = v.getUint8(4),
      m = v.getUint8(5),
      count = v.getUint32(16, true),
      wide = magic !== "MSC1",
      moving = magic === "MSC3";
    let o = 32;
    const take = (Type) => {
      const a = new Type(buf, o, count);
      o += Type.BYTES_PER_ELEMENT * count;
      return a;
    };
    const vol = take(Float64Array),
      bv = take(Float64Array);
    let cs, rs, ct, bt, path, dwell, high, low;
    if (wide) {
      ct = take(Float64Array);
      bt = take(Float64Array);
      if (moving) {
        path = take(Float64Array);
        dwell = take(Float64Array);
        high = take(Float64Array);
        low = take(Float64Array);
      }
      cs = take(Uint32Array);
      rs = take(Uint32Array);
    } else {
      cs = take(Uint32Array);
      rs = take(Uint32Array);
      ct = take(Uint32Array);
      bt = take(Uint32Array);
    }
    const cells = moving
      ? Array.from({ length: count }, (_, i) => ({
          c: cs[i],
          r: rs[i],
          v: vol[i],
          bv: bv[i],
          ct: ct[i],
          bt: bt[i],
          p: path[i],
          w: dwell[i],
          hi: high[i],
          lo: low[i],
        }))
      : Array.from({ length: count }, (_, i) => ({
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
  // A block's cells summed into level-(n, m) cells, within bounds or all of
  // them. A level's are kept until the blocks change (groups). The latest few
  // bounded sums are kept too, each with the block and cells it summed: the
  // rectangle is summed every frame, but moves only with the view or the
  // selection. They are keyed by the level, the bounds and the cutoff, all
  // else a sum reads.
  //
  // A new one sums only the columns it can take cells from, found by
  // bisection where the cells run in column order, as the snapshot's and the
  // cube's do. Where the level is summed and the bounds' prices lie on its
  // rows, the cells of its columns wholly inside the bounds are the level's
  // own, the same cells summed in the same order: only the part columns at
  // either end are summed from the block.
  const bounded = new Map(),
    ordered = new WeakMap(),
    summedFrom = new WeakMap();
  function aggregate(src, n, m, bounds = null) {
    const key = src.id + "|" + n + "|" + m;
    if (!bounds && groups.has(key)) return groups.get(key);
    const held = bounds && [key, ...bounds, CUT].join("|"),
      hit = held && bounded.get(held);
    if (hit && hit.src === src && hit.cells === src.cells) {
      bounded.delete(held);
      bounded.set(held, hit);
      return hit.out;
    }
    const cells = src.cells,
      map = new Map();
    if (!bounds || !inColumnOrder(cells)) sumCells(map, src, n, m, bounds, 0, cells.length);
    else {
      const ts = 2 ** src.n,
        tn = 2 ** n,
        pm = 2 ** m,
        at = (c) => bisectColumn(cells, c),
        // A cell after the bounds end is left out, unless the cutoff comes first.
        stop = CUT > bounds[1] ? at(Math.ceil(bounds[1] / ts) + 1) : cells.length,
        level = groups.get(key),
        c0 = Math.ceil(bounds[0] / tn),
        // The columns wholly inside run from c0 to c1, or where the cutoff
        // comes first to the level's end: the bounds then leave out no later
        // cell, as they never have (and no block holds one after its cutoff).
        c1 = CUT > bounds[1] ? Math.floor(bounds[1] / tn) : Infinity;
      if (
        level &&
        summedFrom.get(level) === cells &&
        src.n <= n &&
        src.m <= m &&
        c0 < c1 &&
        Math.ceil(bounds[2] / pm) * pm === bounds[2] &&
        Math.floor(bounds[3] / pm) * pm === bounds[3]
      ) {
        const own = level.cells,
          dt = tn / ts,
          last = c1 < Infinity ? bisectColumn(own, c1) : own.length;
        sumCells(map, src, n, m, bounds, at(Math.floor(bounds[0] / ts)), at(c0 * dt));
        for (let j = bisectColumn(own, c0); j < last; j++) {
          const z = own[j];
          if (z.r * pm >= bounds[2] && (z.r + 1) * pm <= bounds[3])
            map.set(cellKey(z.c, z.r), { c: z.c, r: z.r, v: z.v, bv: z.bv, ct: z.ct, bt: z.bt });
        }
        if (c1 < Infinity) sumCells(map, src, n, m, bounds, at(c1 * dt), stop);
      } else sumCells(map, src, n, m, bounds, at(Math.floor(bounds[0] / ts)), stop);
    }
    const out = summarize([...map.values()], n, m);
    if (!bounds) {
      groups.set(key, out);
      summedFrom.set(out, cells);
    } else {
      bounded.set(held, { src, cells, out });
      while (bounded.size > 8) bounded.delete(bounded.keys().next().value);
    }
    return out;
  }
  // A block's cells from i to stop that the bounds hold, added into their
  // level-(n, m) cells in the block's order.
  function sumCells(map, src, n, m, bounds, i, stop) {
    const ts = 2 ** src.n,
      ps = 2 ** src.m,
      dt = 2 ** (n - src.n),
      dp = 2 ** (m - src.m),
      cells = src.cells;
    for (; i < stop; i++) {
      const z = cells[i],
        t = z.c * ts,
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
        k = cellKey(c, r);
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
  }
  // Whether a block's cells run in column order: checked once for each.
  function inColumnOrder(cells) {
    let sorted = ordered.get(cells);
    if (sorted === undefined) {
      sorted = true;
      for (let i = 1; sorted && i < cells.length; i++) sorted = cells[i - 1].c <= cells[i].c;
      ordered.set(cells, sorted);
    }
    return sorted;
  }
  // A sum of floats that carries its rounding error (Neumaier's), so totals
  // and row sums match the exact sums the cube reports.
  function exactSum(values) {
    let sum = 0,
      carry = 0;
    for (const x of values) {
      const t = sum + x;
      carry += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
      sum = t;
    }
    return sum + carry;
  }
  // Level-(n, m) cells as the chart reads them: sorted, by column with each
  // column's POC and 70% area, by row, and the totals and both POCs of them all.
  // A POC is the row with the most volume, the lower row winning a tie.
  function summarize(list, n, m) {
    const cells = list.sort((a, b) => a.c - b.c || a.r - b.r),
      map = new Map(),
      cols = [],
      rows = new Map();
    let col = null;
    for (const z of cells) {
      map.set(z.c + "," + z.r, z);
      let row = rows.get(z.r);
      if (!row) {
        row = { r: z.r, vs: [], bvs: [], ct: 0, bt: 0 };
        rows.set(z.r, row);
      }
      row.vs.push(z.v);
      row.bvs.push(z.bv);
      row.ct += z.ct;
      row.bt += z.bt;
      if (!col || col.c !== z.c) {
        col = { c: z.c, v: 0, bv: 0, ct: 0, bt: 0, poc: null, best: 0, rows: [] };
        cols.push(col);
      }
      col.v += z.v;
      col.bv += z.bv;
      col.ct += z.ct;
      col.bt += z.bt;
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
      bmax = 0,
      ct = 0,
      bt = 0;
    // Each row anew, its sums in place of its values: a moved rectangle is
    // summarized every frame, and objects that lose properties are slower to
    // build and to read.
    const rowList = [...rows.values()]
      .sort((a, b) => a.r - b.r)
      .map((row) => ({ r: row.r, ct: row.ct, bt: row.bt, v: exactSum(row.vs), bv: exactSum(row.bvs) }));
    for (const row of rowList) {
      ct += row.ct;
      bt += row.bt;
      if (row.v > max) {
        poc = row.r;
        max = row.v;
      }
      if (row.bv > bmax) {
        bpoc = row.r;
        bmax = row.bv;
      }
    }
    return {
      n,
      m,
      cells,
      cols,
      rows: rowList,
      map,
      poc,
      bpoc,
      v: exactSum(cells.map((z) => z.v)),
      bv: exactSum(cells.map((z) => z.bv)),
      ct,
      bt,
      scales: {},
    };
  }
  // Path and dwell level by level (live only), summed like volume, each cell
  // keeping its highest and lowest trade. A motion block's cells include those
  // the price moved through or held in without a trade (trades 0). Its data
  // ends where its measures do (b1), so a column across that edge counts. Its
  // cells run in (column, row) order, so a rectangle's are found by bisection,
  // and cells are keyed by number: a pan sums them again every frame.
  const cellKey = (c, r) => c * 2097152 + r;
  function bisectColumn(cells, c) {
    let lo = 0,
      hi = cells.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cells[mid].c < c) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  function motionAggregate(src, n, m, bounds = null) {
    const key = src.id + "|" + n + "|" + m;
    if (!bounds && groups.has(key)) return groups.get(key);
    const map = new Map(),
      list = [];
    accumulate(map, list, src, n, m, bounds);
    const out = motionSummary(list, n, m, map);
    if (!bounds) groups.set(key, out);
    return out;
  }
  // A block's cells inside the bounds, added into their level-(n, m) cells.
  function accumulate(map, list, src, n, m, bounds) {
    const ts = 2 ** src.n,
      ps = 2 ** src.m,
      dt = 2 ** (n - src.n),
      dp = 2 ** (m - src.m),
      cells = src.cells;
    let i = 0,
      stop = cells.length;
    if (bounds) {
      i = bisectColumn(cells, Math.floor(bounds[0] / ts));
      stop = bisectColumn(cells, Math.ceil(bounds[1] / ts) + 1);
    }
    for (; i < stop; i++) {
      const z = cells[i],
        t = z.c * ts,
        p = z.r * ps;
      if (
        bounds &&
        (t < bounds[0] ||
          Math.min(t + ts, src.b1) > bounds[1] ||
          p < bounds[2] ||
          p + ps > bounds[3])
      )
        continue;
      const c = Math.floor(z.c / dt),
        r = Math.floor(z.r / dp),
        k = cellKey(c, r);
      let a = map.get(k);
      if (!a) {
        a = { c, r, v: 0, ct: 0, p: 0, w: 0, hi: -Infinity, lo: Infinity };
        map.set(k, a);
        list.push(a);
      }
      a.v += z.v;
      a.ct += z.ct;
      a.p += z.p;
      a.w += z.w;
      if (z.ct > 0) {
        if (z.hi > a.hi) a.hi = z.hi;
        if (z.lo < a.lo) a.lo = z.lo;
      }
    }
  }
  // Motion cells as the chart reads them: sorted, keyed, by column (its volume,
  // trades, path, dwell and range) and those without a trade. Its rows and
  // totals are summed when first read (motionTotals): a frame that only draws
  // the cells never needs them.
  function motionSummary(list, n, m, map = null) {
    const cells = list.sort((a, b) => a.c - b.c || a.r - b.r),
      cols = [];
    if (!map) {
      map = new Map();
      for (const z of cells) map.set(cellKey(z.c, z.r), z);
    }
    let col = null;
    const moved = [];
    for (const z of cells) {
      if (!col || col.c !== z.c) {
        col = { c: z.c, v: 0, ct: 0, p: 0, w: 0, hi: -Infinity, lo: Infinity };
        cols.push(col);
      }
      col.v += z.v;
      col.ct += z.ct;
      col.p += z.p;
      col.w += z.w;
      if (z.ct > 0) {
        if (z.hi > col.hi) col.hi = z.hi;
        if (z.lo < col.lo) col.lo = z.lo;
      } else moved.push(z);
    }
    return { n, m, cells, cols, map, moved, rows: null, p: null, w: null, scales: {} };
  }
  // A motion summary's rows, path and dwell by price row summed exactly, and
  // its totals; the cube's own totals when it answered for the rectangle.
  function motionTotals(q) {
    if (q.rows) return q;
    // exactSum's compensated sums, kept as they go: a pan works these out every frame.
    const add = (s, x) => {
        const t = s[0] + x;
        s[1] += Math.abs(s[0]) >= Math.abs(x) ? s[0] - t + x : x - t + s[0];
        s[0] = t;
      },
      rows = new Map(),
      p = [0, 0],
      w = [0, 0];
    for (const z of q.cells) {
      let row = rows.get(z.r);
      if (!row) {
        row = { r: z.r, ps: [0, 0], ws: [0, 0] };
        rows.set(z.r, row);
      }
      add(row.ps, z.p);
      add(row.ws, z.w);
      add(p, z.p);
      add(w, z.w);
    }
    q.rows = [...rows.values()]
      .sort((a, b) => a.r - b.r)
      .map((row) => ({ r: row.r, p: row.ps[0] + row.ps[1], w: row.ws[0] + row.ws[1] }));
    if (q.p === null) q.p = p[0] + p[1];
    if (q.w === null) q.w = w[0] + w[1];
    return q;
  }
  function activeCutoff() {
    return S.replay && S.anchor !== null
      ? Math.min(CUT, Math.floor(S.anchor / stepT()) * stepT())
      : CUT;
  }
  // The base edge that closes the data: the end of the open column, which
  // holds the latest trades (the cube's cutoff is a minute edge, not a base
  // one), or the replay's edge.
  const cutEdge = () => Math.ceil(activeCutoff());
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
      "time",
      "accent",
      "neutral",
    ]) {
      probe.style.color = `var(--ol-${key})`;
      colors[key] = getComputedStyle(probe).color;
    }
    // The line families' colours, and each tier's weight and saturation.
    colors.family = {};
    for (const key of ["poc", "level", "average", "vwap", "clock"]) {
      probe.style.color = `var(--ol-line-${key})`;
      colors.family[key] = getComputedStyle(probe).color;
    }
    const tokens = getComputedStyle(root);
    colors.tiers = {};
    for (const tier of ["short", "medium", "long"])
      colors.tiers[tier] = {
        width: parseFloat(tokens.getPropertyValue(`--ol-tier-${tier}-width`)) || 1.5,
        chroma: parseFloat(tokens.getPropertyValue(`--ol-tier-${tier}-chroma`)) || 1,
      };
    probe.remove();
    buildRamp();
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
      // Under Path and Dwell the cells shade by their own motion, over the
      // motion's own level: the block's other amounts over its level go unread.
      moving = Boolean(PACK.live) && movementMode(),
      sum = S.replay ? [src.col0 * 2 ** src.n, cut, 0, Infinity] : null,
      full = moving ? null : aggregate(src, renderN(), renderM(), sum),
      meas = measurement(),
      b = meas.b,
      query = meas.query,
      // What the chart draws in the rectangle: the measure's own cells when they
      // are at the drawn level, or else the display block's cells that overlap it.
      shown =
        meas.shown ||
        (query.n === renderN()
          ? query
          : aggregate(src, renderN(), renderM(), outwardBounds(meas.r))),
      // Path and dwell, while a movement view shows them.
      mv = movementOn() ? motionView(src, cut, meas) : null,
      ts = stepT(),
      ps = stepP(),
      u = transition
        ? clamp((performance.now() - transition.start) / 170, 0, 1)
        : 1;
    prepareMeasures(full, shown, query, b, moving);
    // Cascade's parents: the level one coarser in both time and price.
    if (S.mode === "cascade") levelCascade(full, src, sum);
    // The row underlay, while it shows, scaled to its rows in view.
    const under = underlayFrame(meas);
    if (under?.bands) under.peak = underlayPeak(under);
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
    if (under) paintBands(under);
    if (S.selection) {
      ctx.globalAlpha = 0.25;
      if (moving) paintMotion(null, mv.full, mv, mv.fullBounds || b, u);
      else for (const z of full.cells) fillCell(z, full, u);
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
    if (moving) paintMotion(shown, mv.shown, mv, b, u);
    else for (const z of shown.cells) fillCell(z, full, u);
    ctx.restore();
    markings(shown, cut);
    paintUnfinished(shown);
    drawClock(cut);
    drawLines(cut);
    if (S.tab === "evidence") {
      const ev = settledEvidence();
      // Busy until a result for this view is up: the panel may still show the last one.
      el("evidence").setAttribute("aria-busy", String(!ev || ev !== evidence.ready || Boolean(ev.loading)));
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
    // Where the cube's archived days end: after it, provisional minutes, which
    // the day's archive may still revise. A view that is all provisional says so.
    if (PACK.live && CANON !== null && CANON < cut) {
      const xp = G.X(CANON);
      if (xp > G.x && xp < G.x + G.w) {
        ctx.setLineDash([2, 3]);
        line(xp, G.y, xp, G.y + G.h, colors.muted, 1, 0.8);
        ctx.setLineDash([]);
        if (Math.min(xc, G.x + G.w) - xp > 90) chartLabel("Provisional", xp + 6, G.y + 12);
      } else if (xp <= G.x && xc > G.x + 90) chartLabel("Provisional", G.x + 8, G.y + 12);
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
      const z = shown.map.get(
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
    // The row under the pointer, over the prices or the profile, outlined
    // across the chart, as it is in the profile.
    const hr = pointerRow();
    if (hr !== null) {
      const ya = Math.round(G.Y((hr + 1) * ps)) + 0.5,
        yb = Math.round(G.Y(hr * ps)) - 0.5;
      if (yb - ya >= 2) {
        ctx.strokeStyle = colors.ink;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.strokeRect(G.x + 0.5, ya, G.w - 1, yb - ya);
        ctx.globalAlpha = 1;
      }
    }
    drawResolutionLens();
    ctx.restore();
    const ro = readouts(cut);
    axes(ro);
    profile(query, b, meas.state, under);
    activity(shown, cut, mv, full);
    crosshair(ro);
    querySummary(meas, mv);
    el("legend-text").textContent = legendText(full, mv);
    el("legend-text").title =
      LEGEND_TITLES[S.mode] +
      (moving && !mv.src && motionIssue() ? ` They couldn't be read: ${motionIssue()}.` : "");
    el("ramp").style.background = legendRamp();
    underlayLegend(under);
    const marks = marksReadout(b);
    el("ray-count").textContent = marks.rayCount + " untested levels";
    el("ray-count").hidden = !S.untested;
    el("va-value").textContent =
      marks.vaLow === null || meas.state === "pending" || meas.state === "failed"
        ? "—"
        : price(marks.vaLow) + "–" + price(marks.vaHigh);
    last = { full, query, shown, meas, b, cut, mv, under };
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
  // crosshair to select, zoom for the lens (held Alt and a touch hold too); on
  // the price labels, and while they're dragged, a vertical resize.
  function setCursor(p = nav.last) {
    const cursor =
      drag?.axis || (!drag && p && onPriceAxis(p))
        ? "ns-resize"
        : !p || !inPlot(p)
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
  // The price labels beside the price pane, and the time labels under the
  // chart: the wheel over one zooms that axis.
  function onPriceAxis(p) {
    return p.x < G.x && p.y >= G.y && p.y <= G.y + G.h;
  }
  function onTimeAxis(p) {
    return p.x >= G.x && p.x <= G.x + G.w && p.y > G.ay + G.ah;
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
  // The time the view shows data for: from its start to the latest data, or
  // to the replay's edge.
  function viewRange() {
    return [Math.max(0, S.tA), Math.max(Math.max(0, S.tA), Math.min(S.tB, activeCutoff()))];
  }
  // The level the view is drawn at: the requested one, coarser in time only
  // while the view spans more columns than a tile holds.
  function viewLevel() {
    const [a, b] = viewRange();
    let n = S.n;
    while (n < N_MAX && Math.ceil(b / 2 ** n) - Math.floor(a / 2 ** n) > TILE_COLUMNS)
      n++;
    return [n, S.m];
  }
  // The block the view is drawn from: one that covers the view's time and can
  // show its level, the finest first; failing that, the finest that covers it.
  function chooseSource() {
    const [start, end] = viewRange(),
      [wn, wm] = viewLevel(),
      covering = Object.values(sources).filter(
        (s) => s.b0 <= start && s.b1 >= end - 2 ** s.n,
      ),
      able = covering.filter((s) => s.n <= wn && s.m <= wm),
      pick = (able.length ? able : covering).sort((a, b) => a.n - b.n || a.m - b.m)[0];
    if (pick) S.dataset = pick.id;
    else if (!sources[S.dataset]) S.dataset = Object.keys(sources)[0];
    if (sources[S.dataset]) sources[S.dataset].used = performance.now();
    return sources[S.dataset];
  }
  function limits() {
    S.n = clamp(Math.round(S.n), 0, N_MAX);
    S.m = clamp(Math.round(S.m), 0, M_MAX);
    S.horizon = [1, 2, 4, 8].includes(S.horizon) ? S.horizon : 1;
  }
  // The rectangle measured: the selection, or the view up to the latest data,
  // each bound on the nearest base edge with midpoints up, as the cube rounds
  // them. One that reaches the latest data ends at the edge that closes it,
  // however little of the open column has passed, so the open column and its
  // latest trades are always in it.
  function requestedBounds() {
    const b = S.selection || [S.tA, S.tB, S.pA, S.pB],
      end = cutEdge(),
      edge = (x) => Math.floor(x + 0.5),
      r = [
        clamp(edge(b[0]), 0, end),
        b[1] >= activeCutoff() ? end : clamp(edge(b[1]), 0, end),
        Math.max(0, edge(b[2])),
        Math.max(0, edge(b[3])),
      ];
    r[1] = Math.max(r[0], r[1]);
    r[3] = Math.max(r[2], r[3]);
    return r;
  }
  // The rectangle the numbers describe: the requested one, which the live cube
  // measures exactly; in the recorded snapshot, where no block tiles it, only
  // the whole recorded cells inside it.
  function bounds() {
    const r = requestedBounds();
    return PACK.live || exactSource(r, renderN(), renderM()) ? r : inwardBounds(r);
  }
  // The display block's whole cells inside the rectangle, and those that
  // overlap it.
  function inwardBounds(r) {
    const src = displaySource(),
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
  function outwardBounds(r) {
    const src = displaySource(),
      ts = 2 ** src.n,
      ps = 2 ** src.m;
    return [
      Math.floor(r[0] / ts) * ts,
      // Never past a replay's edge: a cell across it holds trades after it.
      Math.min(Math.ceil(r[1] / ts) * ts, S.replay ? activeCutoff() : Infinity),
      Math.floor(r[2] / ps) * ps,
      Math.ceil(r[3] / ps) * ps,
    ];
  }
  // A loaded block whose cells tile the rectangle: as fine as the level or
  // finer, over the rectangle's whole time, with every edge of the rectangle
  // on its cell edges (its end may instead lie past the block's latest data).
  // Its cells then sum to exactly what the cube answers for the rectangle.
  // The coarsest such block has the fewest cells to sum.
  function exactSource(r, n, m) {
    const end = Math.min(r[1], activeCutoff()),
      blocks = Object.values(sources).concat(referenceView ? [referenceView] : []);
    return (
      blocks
        .filter((s) => {
          const ts = 2 ** s.n,
            ps = 2 ** s.m,
            [start, stop] = sourceRange(s);
          return (
            s.n <= n &&
            s.m <= m &&
            start <= r[0] &&
            stop >= end &&
            r[0] % ts === 0 &&
            (r[1] % ts === 0 || r[1] >= stop) &&
            r[2] % ps === 0 &&
            r[3] % ps === 0
          );
        })
        .sort((a, b) => b.n - a.n || b.m - a.m)[0] || null
    );
  }
  // The rectangle's measures at the drawn level, exactly: summed from loaded
  // cells that tile it, or the cube's own answer (live). Until the cube
  // answers, the cells that overlap it stand in, marked as measuring; the
  // recorded snapshot counts its whole cells inside the rectangle only.
  const measured = new Map();
  function measurement() {
    const r = requestedBounds(),
      n = renderN(),
      m = renderM(),
      empty = r[1] <= r[0] || r[3] <= r[2],
      exact = empty ? displaySource() : exactSource(r, n, m);
    if (exact) return { r, b: r, query: aggregate(exact, n, m, r), state: "exact" };
    if (!PACK.live) {
      const b = inwardBounds(r);
      return { r, b, query: aggregate(displaySource(), n, m, b), state: "recorded" };
    }
    const spec = measureSpec(r, n, m),
      hit = measured.get(spec.key);
    if (hit) return { r, b: r, query: hit.query, summary: hit.summary, state: "cube" };
    // A rectangle at the latest data, which the arriving data moved on by a
    // little, keeps the measures it had a moment ago, exact to that cutoff and
    // with its own bounds, while the cube reads the new minutes: live numbers
    // don't blank once a minute. A window slides and may refit its prices; any
    // other rectangle keeps its prices and only grows.
    const near = (a, b) => Math.abs(a - b) <= 64,
      windowed = S.window && !S.selection;
    const was =
      !S.replay && r[1] >= Math.floor(CUT)
        ? [...measured.values()]
            .reverse()
            .find(
              (x) =>
                x.edge &&
                x.nq === spec.nq &&
                x.m === m &&
                x.r[1] <= r[1] &&
                near(x.r[1], r[1]) &&
                near(x.r[0], r[0]) &&
                (windowed
                  ? x.win === S.window
                  : !x.win && x.r[0] === r[0] && x.r[2] === r[2] && x.r[3] === r[3]),
            )
        : null;
    if (was && !cube.failed.has(spec.key))
      return { r: was.r, b: was.r, query: was.query, summary: was.summary, state: "cube", updating: true, end: was.cut };
    // Until then the chart draws the loaded cells that overlap the rectangle,
    // and the rectangle has no measures: no totals, no profile, no POCs.
    return {
      r,
      b: r,
      query: summarize([], n, m),
      shown: aggregate(displaySource(), n, m, outwardBounds(r)),
      state: cube.failed.has(spec.key) ? "failed" : "pending",
      error: cube.failed.get(spec.key),
    };
  }
  // The cube read for a rectangle: at the drawn level, or coarser in time when
  // the rectangle spans more columns than one read holds (totals and POCs are
  // the same at any column width).
  function measureSpec(r, n, m) {
    let nq = n;
    while (nq < 24 && Math.ceil(r[1] / 2 ** nq) - Math.floor(r[0] / 2 ** nq) > TILE_COLUMNS)
      nq++;
    const key = ["measure", live.generation, nq, m, ...r, r[1] > Math.floor(CUT) ? CUT : ""].join("|"),
      edge = r[1] >= Math.floor(CUT),
      // The data it covers ends here, and the window it was measured for.
      cut = CUT,
      win = S.window && !S.selection ? S.window : null;
    return {
      key,
      nq,
      path: `/cube/query?n=${nq}&m=${m}&b0=${r[0]}&b1=${r[1]}&r0=${r[2]}&r1=${r[3]}`,
      decode: async (body) => ({ block: await unpack(body.block, key), s: body.summary }),
      apply: ({ block, s }) => {
        const q = summarize(block.cells, nq, m),
          row = (p) => (p == null ? null : Math.round(p / (PR * 2 ** m) - 0.5));
        // The cube's own totals and POCs, summed exactly.
        q.v = s.volume;
        q.bv = s.taker_buy_volume;
        q.ct = s.trade_count;
        q.bt = s.taker_buy_trade_count;
        q.poc = row(s.poc);
        q.bpoc = row(s.taker_buy_poc);
        measured.delete(key);
        measured.set(key, { query: q, summary: s, r, nq, m, edge, cut, win });
        while (measured.size > 48) measured.delete(measured.keys().next().value);
      },
    };
  }
  function measureWant() {
    const r = requestedBounds(),
      n = renderN(),
      m = renderM();
    if (r[1] <= r[0] || r[3] <= r[2] || exactSource(r, n, m)) return null;
    const spec = measureSpec(r, n, m);
    return measured.has(spec.key) ? null : spec;
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
      // With a movement view on, the measures it shows.
      ...(movementOn() ? { measures: ["path_length", "dwell"] } : {}),
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
    // The encodings, in the order M steps through them: each one's name, what
    // it shows and the measure it reads. The cube has four measures per cell,
    // and each reaches the chart: volume, trades, and their taker-buy parts;
    // live, also how the price moved inside each cell, its path and dwell.
    MODES = ["volume", "flow", "delta", "cascade", "trades", "flowtrades", "size", "path", "dwell", "geometry"],
    MODE_INFO = {
      volume: { name: "Volume", desc: "USDT traded in each cell" },
      flow: { name: "Taker flow", desc: "Share of each cell's USDT bought by takers" },
      delta: { name: "Delta", desc: "Taker-buy minus taker-sell USDT in each cell" },
      cascade: { name: "Cascade", desc: "How each cell's USDT splits within its parent, one level coarser in time and price" },
      trades: { name: "Trades", desc: "Trades in each cell" },
      flowtrades: { name: "Taker trades", desc: "Share of each cell's trades that were taker buys" },
      size: { name: "Trade size", desc: "Average USDT per trade in each cell" },
      path: { name: "Path", desc: "How far the price travelled in each cell, in row heights" },
      dwell: { name: "Dwell", desc: "Each cell's share of its column's time" },
      geometry: { name: "Geometry", desc: "The grid's occupied cells" },
    },
    MODE_GROUPS = [
      ["USDT", ["volume", "flow", "delta", "cascade"]],
      ["Trades", ["trades", "flowtrades", "size"]],
      ["Movement", ["path", "dwell"]],
      ["Grid", ["geometry"]],
    ],
    MODE_NAMES = Object.fromEntries(MODES.map((k) => [k, MODE_INFO[k].name])),
    // The pane under the prices (the Columns menu, B): one value per column, in
    // the order B steps through them. Same as cells follows the encoding.
    PANES = ["cells", "volume", "delta", "trades", "size", "efficiency", "choppiness", "perpath"],
    PANE_INFO = {
      cells: { name: "Same as cells", desc: "Each column's amount of what the cells show" },
      volume: { name: "Volume", desc: "USDT traded in each column" },
      delta: { name: "Delta", desc: "Taker-buy minus taker-sell USDT in each column" },
      trades: { name: "Trades", desc: "Trades in each column" },
      size: { name: "Trade size", desc: "Average USDT per trade in each column" },
      efficiency: {
        name: "Efficiency",
        desc: "USDT per 125 USDT row each column's trades touched, against its parent column's",
      },
      choppiness: { name: "Choppiness", desc: "How far the price travelled in each column, over its range" },
      perpath: { name: "Volume per path", desc: "USDT traded in each column per USDT the price moved" },
    },
    PANE_GROUPS = [
      ["Follow", ["cells"]],
      ["USDT", ["volume", "delta"]],
      ["Trades", ["trades", "size"]],
      ["Movement", ["efficiency", "choppiness", "perpath"]],
    ];
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
    if (S.pane !== "cells") add("pane", S.pane);
    if (S.rows !== "off") add("rows", S.rows);
    if (S.period !== "90d") add("period", S.period);
    if (S.level !== null) add("level", usd(S.level));
    const marks = ["poc", "area", "untested"].filter((k) => S[k]).join(",");
    if (marks !== "poc") add("marks", marks || "none");
    if (S.lines.length) add("lines", S.lines.join(","));
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
      pane: q.get("pane") || "cells",
      rows: q.get("rows") || "off",
      period: q.get("period") || "90d",
      level: q.has("level") ? rows(q.get("level")) : null,
      poc: marks.includes("poc"),
      area: marks.includes("area"),
      untested: marks.includes("untested"),
      lines: String(q.get("lines") ?? "").split(",").filter(Boolean),
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
      mode: modes().includes(v.mode) ? v.mode : "volume",
      // Choppiness and volume per path need the live cube.
      pane: panes().includes(v.pane) ? v.pane : "cells",
      // Time at price needs the live cube.
      rows: rowsChoices().includes(v.rows) ? v.rows : "off",
      period: validPeriod(v.period) ? v.period : "90d",
      level: Number.isFinite(v.level) && v.level > 0 ? v.level : null,
      poc: v.poc !== false,
      area: v.area === true,
      untested: v.untested === true,
      lines: normalizeLines(v.lines),
      selection:
        sel.length === 4 &&
        ok(...sel) &&
        sel[0] >= 0 &&
        sel[1] > sel[0] &&
        sel[0] < CUT &&
        sel[2] >= 0 &&
        sel[3] > sel[2]
          ? [sel[0], Math.min(sel[1], Math.ceil(CUT)), sel[2], sel[3]]
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
      "pane",
      "rows",
      "period",
      "level",
      "poc",
      "area",
      "untested",
      "lines",
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
  // The Query tab: the six parameters of the rectangle, and what the numbers
  // shown are for them.
  function queryUI(meas) {
    const q = cubeQuery(),
      b = meas.b;
    if (!copyFallbackActive) el("query-text").value = JSON.stringify(q, null, 2);
    el("query-mini").textContent = ` · ${dur(q.tR)} × ${price(q.pR)} USDT`;
    const shown = `${dur(BASE * stepT())} × ${price(PR * stepP())} USDT`,
      level = `${dur(BASE * 2 ** meas.query.n)} columns`;
    el("query-ready").textContent =
      meas.state === "recorded" && b.some((x, i) => x !== meas.r[i])
        ? `The recorded snapshot counts only its whole cells inside these bounds: ${range(b[0], b[1])} UTC; ${price(b[2] * PR)}–${price(b[3] * PR)} USDT; ${shown}. The live cube measures the six parameters exactly.`
        : meas.state === "pending"
          ? "Measuring these six parameters in the cube…"
          : meas.updating
            ? `The cube's answer up to ${when(Math.min(meas.r[1], meas.end))} UTC, updating to the latest data…`
            : meas.state === "failed"
            ? `The cube didn't answer for these six parameters: ${meas.error}.`
            : renderM() !== S.m
              ? `Shown and measured at ${shown}, the finest ${PACK.live ? "loaded so far" : "recorded here"}: the POC is per ${price(PR * stepP())} USDT row until finer cells load.`
              : meas.query.n !== S.n
                ? `The cube's answer to these six parameters, in ${level} (the finest this span shows at once); totals and POCs don't depend on the column width.`
                : "The cube's answer to these six parameters.";
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
        b > Math.ceil(CUT) ||
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
        if (modes().includes(mode)) S.mode = mode;
        if (panes().includes(v.pane)) S.pane = v.pane;
        if (rowsChoices().includes(v.rows)) S.rows = v.rows;
        if (validPeriod(v.period)) S.period = v.period;
        if (v.level === null || (Number.isFinite(v.level) && v.level > 0)) S.level = v.level;
        for (const k of ["poc", "area", "untested", "replay"])
          if (typeof v[k] === "boolean") S[k] = v[k];
        if (Array.isArray(v.lines)) S.lines = normalizeLines(v.lines);
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
  // Under Cascade, the time a cell's parent spans; none at the lattice's
  // coarsest time or price, where there is no parent.
  const parentSpan = () =>
    S.mode === "cascade" && renderN() < N_MAX && renderM() < M_MAX ? 2 * stepT() : 0;
  function paintCoverage(b) {
    const src = displaySource(),
      cut = activeCutoff(),
      // Under Cascade a parent the block holds only part of has no value either.
      span = parentSpan(),
      start = span ? Math.ceil(src.b0 / span) * span : src.b0,
      stop = Math.min(src.b1, cut),
      x0 = clamp(G.X(start), G.x, G.x + G.w),
      xe = clamp(G.X(span && stop < cut ? Math.floor(stop / span) * span : stop), G.x, G.x + G.w),
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
  // The open column, and under Cascade the whole parent column that holds the
  // data's edge: its cells' shares change as trades arrive (in replay, its
  // later half is hidden). Whether it shows, for the status bar's key.
  let unfinishedShown = false;
  function paintUnfinished(query) {
    const cut = activeCutoff(),
      ts = stepT(),
      span = parentSpan() || ts,
      c = Math.floor(cut / span);
    unfinishedShown = false;
    if ((!S.replay || span > ts) && cut % span !== 0) {
      const xa = Math.max(G.x, G.X(c * span)),
        xb = Math.min(G.x + G.w, G.X(cut));
      hatchRect(xa, G.y, xb - xa, G.h, colors.poc, 7, 0.25);
      if (xb > G.x && xa < G.x + G.w) {
        unfinishedShown = span > ts;
        line(xa, G.y, xb, G.y, colors.poc, 3, 0.8);
        if (!S.replay) chartLabel("Open", clamp(xa + 3, G.x + 4, G.x + G.w - 36), G.y + 28, colors.poc);
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
  // The inspector's measures of the rectangle: the four totals, both POCs and
  // the cell counts. While the cube measures a rectangle the loaded cells can't
  // sum exactly, the numbers wait for it: the chart draws the overlapping cells
  // meanwhile, but no number is shown that isn't the rectangle's own.
  function querySummary(meas, mv) {
    const { query, b, state } = meas,
      partialCoverage = state === "recorded" && b.some((x, i) => x !== meas.r[i]),
      measuring = state === "pending" || state === "failed",
      ts = 2 ** query.n,
      ps = 2 ** query.m;
    el("focus-title").textContent = partialCoverage
      ? "Ready part"
      : state === "failed"
        ? "Not measured"
        : measuring
          ? "Measuring…"
          : S.selection
            ? "Selection"
            : "In view";
    el("focus-title").title = partialCoverage
      ? "The recorded snapshot counts only its whole cells inside the rectangle; the live cube measures the rectangle exactly"
      : state === "failed"
        ? `The cube didn't answer: ${meas.error}`
        : measuring
          ? "The cube is measuring the rectangle exactly"
          : "";
    el("context").classList.toggle("ol-measuring", measuring);
    el("context").setAttribute("aria-busy", String(state === "pending"));
    // Each date and the price range stay whole; lines break only between them.
    const times = rangeParts(b[0], Math.min(b[1], Math.max(b[0], meas.end ?? activeCutoff())));
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
      el(id).textContent = measuring ? "—" : compact(v);
      el(id).setAttribute("aria-label", measuring ? "not measured yet" : exact);
      el(id).title = measuring ? "" : exact;
    }
    // Path and dwell, while a movement view shows them: the rectangle's own, up
    // to where they end.
    const rect = mv?.rect,
      reached = Boolean(rect?.query) && rect.end > b[0];
    if (reached) motionTotals(rect.query);
    el("path-metric").hidden = el("dwell-metric").hidden = el("moved-row").hidden = !mv;
    el("motion-to-row").hidden = !(reached && rect.end < Math.min(b[1], activeCutoff()));
    if (mv) {
      const why = !rect.query
        ? rect.state === "failed"
          ? `The cube didn't answer: ${rect.error}`
          : "Reading path and dwell from the cube"
        : b[0] >= Math.floor(CUT)
          ? "Not measured yet: the open column is measured once it completes"
          : "Not measured by the cube yet",
        span = Math.max(0, Math.min(b[1], rect.end) - b[0]) * BASE;
      for (const [id, text, exact] of [
        ["path", reached ? compact(rect.query.p) : "—", reached ? usdt(rect.query.p) + " USDT" : why],
        [
          "dwell",
          reached ? dur(rect.query.w) : "—",
          reached
            ? `${secondsExact(rect.query.w)} · ${(span > 0 ? (100 * rect.query.w) / span : 0).toFixed(1)}% of the time`
            : why,
        ],
      ]) {
        el(id).textContent = text;
        el(id).title = exact;
        el(id).setAttribute("aria-label", exact);
      }
      el("motion-to").textContent = reached ? `${when(rect.end)} UTC` : "—";
      // Moved through: without a trade in the rectangle's own cells either.
      el("moved").textContent = !reached
        ? "—"
        : integer(
            rect.query.n === query.n && rect.query.m === query.m
              ? rect.query.moved.filter((z) => !query.map.has(z.c + "," + z.r)).length
              : rect.query.moved.length,
          );
    }
    const wait = (text) => (measuring ? "—" : text);
    el("poc-value").textContent = wait(
      query.poc === null ? "—" : price((query.poc + 0.5) * ps * PR),
    );
    el("buypoc-value").textContent = wait(
      query.bpoc === null ? "—" : price((query.bpoc + 0.5) * ps * PR),
    );
    el("share").textContent = wait(
      query.v ? ((100 * query.bv) / query.v).toFixed(1) + "%" : "—",
    );
    el("delta-value").textContent = wait(
      signed(2 * query.bv - query.v, compact) + " USDT",
    );
    el("cells").textContent = wait(integer(query.cells.length));
    let partials = 0,
      unfinished = 0;
    for (const c of query.cells) {
      if (
        c.c * ts < b[0] ||
        (c.c + 1) * ts > b[1] ||
        c.r * ps < b[2] ||
        (c.r + 1) * ps > b[3]
      )
        partials++;
      if (!S.replay && c.c * ts < CUT && (c.c + 1) * ts > CUT) unfinished++;
    }
    el("partials").textContent = wait(integer(partials));
    // The open column's cells without a trade yet are open, not zero-trade.
    const rows = Math.max(0, Math.ceil(b[3] / ps) - Math.floor(b[2] / ps)),
      total =
        b[1] <= b[0] || b[3] <= b[2]
          ? 0
          : Math.max(0, Math.ceil(b[1] / ts) - Math.floor(b[0] / ts)) * rows,
      openRows =
        total > 0 && !S.replay && CUT % ts !== 0 && b[1] >= CUT ? rows : 0,
      zero = Math.max(0, total - query.cells.length - openRows + unfinished);
    el("open-count").textContent = wait(integer(openRows));
    el("zero-count").textContent = wait(integer(zero));
    // The key names each state; its count lives with the cell counts.
    el("key-zero").hidden = zero === 0;
    el("key-open").hidden = openRows === 0 && !unfinishedShown;
    el("key-unavailable").hidden = !coverageGap;
    el("data-coarse").hidden = !(renderN() > S.n || renderM() > S.m);
    queryUI(meas);
    renderCells(measuring ? null : query, b, mv);
  }
  // The rectangle's measured cells, or none while the cube measures them.
  const measuredCells = (l) =>
    l.meas.state === "pending" || l.meas.state === "failed" ? null : l.query;
  // The drawer's cells table: sortable, a hundred rows a page, and linked to
  // the chart both ways through the cell under the pointer. It is rebuilt a
  // moment after the view settles, so panning never waits on it.
  const CELLS_PAGE = 100;
  let cellRows = new Map(),
    hoverRow = null,
    cellsTimer = 0;
  function cellState(c, b, ts = stepT(), ps = stepP()) {
    const open = !S.replay && (c.c + 1) * ts > CUT,
      portion =
        c.c * ts < b[0] ||
        (c.c + 1) * ts > b[1] ||
        c.r * ps < b[2] ||
        (c.r + 1) * ps > b[3];
    return [open ? "unfinished" : "complete", portion ? "portion" : ""]
      .filter(Boolean)
      .join(" · ");
  }
  function renderCells(query, b, mv) {
    if (!(S.drawerOpen && S.drawer === "cells")) return;
    clearTimeout(cellsTimer);
    cellsTimer = setTimeout(() => buildCells(query, b, mv), 80);
  }
  function buildCells(query, b, mv) {
    for (const th of qsa(".ol-motion-col")) th.hidden = !mv;
    if (!query) {
      el("table-body").replaceChildren();
      el("table-caption").textContent = "Measuring the rectangle in the cube…";
      el("table-page").textContent = "";
      el("table-back").disabled = el("table-next").disabled = true;
      return;
    }
    // The cells at the measure's own level, which a very wide rectangle reads
    // coarser in time than the view shows.
    const ts = 2 ** query.n,
      ps = 2 ** query.m,
      key = [query.n, query.m, b.join(","), S.cellSort, S.cellDir, Boolean(mv)].join("|"),
      // With a movement view on, each cell's path and dwell, and the cells the
      // price moved through or held in without a trade, at the table's level.
      mq =
        mv?.rect.query && mv.rect.query.n === query.n && mv.rect.query.m === query.m
          ? mv.rect.query
          : null,
      end = mq ? mv.rect.end : -Infinity,
      moves = (c) => (c.p !== undefined ? c : mq?.map.get(cellKey(c.c, c.r)));
    if (key !== tableKey) {
      tablePage = 0;
      tableKey = key;
    }
    const value = {
        time: (c) => c.c,
        price: (c) => c.r,
        volume: (c) => c.v,
        trades: (c) => c.ct,
        buyvol: (c) => c.bv ?? 0,
        buytrades: (c) => c.bt ?? 0,
        path: (c) => moves(c)?.p ?? -1,
        dwell: (c) => moves(c)?.w ?? -1,
        state: (c) => cellState(c, b, ts, ps),
      }[S.cellSort],
      // Cells the price moved through or held in without a trade: without one
      // here either, where a cell's trades can come after path and dwell end.
      movedThrough = mq ? mq.moved.filter((z) => !query.map.has(z.c + "," + z.r)) : [],
      cells = query.cells
        .concat(movedThrough)
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
        range(Math.max(c.c * ts, b[0]), Math.min((c.c + 1) * ts, b[1])),
        price(Math.max(c.r * ps, b[2]) * PR) +
          "–" +
          price(Math.min((c.r + 1) * ps, b[3]) * PR),
        usdt(c.v),
        integer(c.ct),
        usdt(c.bv ?? 0),
        integer(c.bt ?? 0),
        ...(mv
          ? !mq
            ? ["…", "…"]
            : c.c * ts >= end
              ? ["—", "—"]
              : [
                  usdt(moves(c)?.p ?? 0),
                  secondsMilli(moves(c)?.w ?? 0),
                ]
          : []),
        cellState(c, b, ts, ps) + (c.ct === 0 ? " · no trades" : ""),
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
    el("table-caption").textContent = mq
      ? `${integer(query.cells.length)} occupied and ${integer(movedThrough.length)} moved-through cells in view · other zero cells omitted`
      : `${integer(cells.length)} occupied cells in view · zero cells omitted`;
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
      // One note, or a few, each its own line.
      ...[note || []].flat().filter(Boolean).map((text) => part("div", "ol-tip-note", text)),
    );
  }
  // A drawn cell's path and dwell for the tooltip, or why it has none yet.
  function motionRows(c, r, z, money, exact) {
    const mv = last.mv,
      ts = stepT(),
      ps = stepP();
    if (!mv.src)
      return [["Path, dwell", motionIssue() ? `couldn't be read: ${motionIssue()}` : "reading from the cube…"]];
    if (c * ts >= mv.end)
      return [
        [
          "Path, dwell",
          c * ts >= Math.floor(CUT)
            ? "measured once the column completes"
            : motion.busy
              ? "reading from the cube…"
              : "not measured by the cube yet",
        ],
      ];
    const b = last.b,
      secs = Math.max(0, Math.min((c + 1) * ts, b[1], mv.end) - Math.max(c * ts, b[0])) * BASE,
      width = Math.max(0, Math.min((r + 1) * ps, b[3]) - Math.max(r * ps, b[2])) * PR,
      path = z ? z.p : 0,
      dwell = z ? z.w : 0,
      // The column's value in the pane under the prices, while it follows the cells.
      col = movementMode() && S.pane === "cells" ? mv.shown?.cols.find((x) => x.c === c) : null,
      pane =
        !col
          ? []
          : S.mode === "path"
            ? [["Column path ÷ range", col.ct > 0 && col.hi > col.lo ? compact(col.p / (col.hi - col.lo)) : "—"]]
            : [["Column USDT ÷ path", col.p > 0 ? compact(col.v / col.p) : "—"]];
    return [
      ["Path", `${money(path)} · ${compact(width > 0 ? path / width : 0)} row heights`],
      [
        "Dwell",
        `${exact ? secondsExact(dwell) : dur(dwell)} · ${(secs > 0 ? (100 * dwell) / secs : 0).toFixed(exact ? 2 : 1)}% of the column`,
      ],
      ...pane,
      ...((c + 1) * ts > mv.end ? [["Measured to", `${when(mv.end)} UTC`]] : []),
    ];
  }
  // A cell's share of its parent and its Cascade value for the tooltip, or why
  // it has none; at +2, that no other cell in its parent traded. The share is
  // the whole cell's: where the rectangle holds only part of the cell (shown),
  // both whole amounts are given too.
  const ratioText = (v, exact) => signed(v, (x) => x.toFixed(exact ? 3 : 2));
  function cascadeRows(e, share, exact, money, shown) {
    if (e.state === "ok") {
      const part = shown && Math.abs(shown.v - e.w.v) > 1e-9 * e.w.v;
      return {
        rows: [
          ["Of its parent", share(e.share)],
          ["Cascade", ratioText(e.value, exact)],
          ...(part
            ? [
                ["Whole cell", money(e.w.v)],
                ["Parent", money(e.p.v)],
              ]
            : []),
        ],
        note: e.alone
          ? "No other cell in its parent traded: the price never got there. That is movement, not concentration."
          : part
            ? `Part of this cell is outside the ${S.selection ? "selection" : "view"}; its share is the whole cell's.`
            : "",
      };
    }
    const why = {
      coarsest: "no parent at the coarsest level",
      open: S.replay ? "its parent runs past the replay's edge" : "its parent is still open",
      outside: "only part of its parent is loaded",
      none: "no value here",
    };
    return { rows: [["Cascade", why[e.state]]], note: "" };
  }
  // The pane's column under the pointer: its value and what it is made of,
  // or why it has none.
  function paneTip(tip, p, money, count, share, exact, note) {
    const ts = stepT(),
      c = Math.floor(p.t / ts),
      head = `${range(c * ts, (c + 1) * ts)} UTC · ${dur(ts * BASE)}`,
      { key, measure, cols } = paneShown,
      x = cols.find((y) => y.c === c),
      mv = last.mv,
      sub = [measure.label, measure.unit].filter(Boolean).join(" · ");
    if (p.t >= last.cut) return tipRows(tip, head, sub, [], S.replay ? "Hidden in replay" : "After the data cutoff");
    if (!x) {
      const b = last.b,
        why =
          p.t < b[0] || p.t >= b[1]
            ? S.selection
              ? "Outside the selection"
              : PACK.live
                ? "Loading this level from the cube"
                : "Not recorded at this level"
            : measure.motion && !mv?.src
              ? motionIssue()
                ? `Path and dwell couldn't be read: ${motionIssue()}`
                : "Reading path and dwell from the cube…"
              : measure.motion && c * ts >= mv.end
                ? c * ts >= Math.floor(CUT)
                  ? "Path and dwell are measured once the column completes"
                  : "Not measured by the cube yet"
                : "No trades in this column";
      return tipRows(tip, head, sub, [], why);
    }
    if (measure.ratio && x.state !== "ok") {
      const why = {
        coarsest: "No coarser level to compare with",
        open: S.replay ? "Its parent column runs past the replay's edge" : "Its parent column is still open",
        outside: "Only part of its parent column is loaded",
        unavailable: "The recorded snapshot has no 125 USDT rows here",
        pending: "Reading its rows from the cube…",
        failed: `The cube didn't answer: ${x.error}`,
        none: "No trades in this column",
      };
      return tipRows(tip, head, sub, [], why[x.state]);
    }
    // A ratio's entry, or else the column itself and its value.
    const col = x,
      value = measure.ratio ? x.value : measure.value(x),
      rows =
        key === "cascade"
          ? [
              ["Of its parent column", share(x.share)],
              ["Value", ratioText(value, exact)],
              ["Column", money(x.w.v)],
              ["Parent column", money(x.p.v)],
            ]
          : key === "efficiency"
            ? [
                ["Efficiency", ratioText(value, exact)],
                ["USDT per row", money(x.e)],
                ["Rows touched", integer(x.w.rows)],
                ["Parent's USDT per row", money(x.ep)],
                ["Parent's rows", integer(x.p.rows)],
              ]
            : key === "choppiness"
              ? [
                  ["Path ÷ range", compact(value)],
                  ["Path", money(col.p)],
                  ["Range", col.ct > 0 ? money(col.hi - col.lo) : "—"],
                ]
              : key === "perpath"
                ? [
                    ["USDT per USDT moved", compact(value)],
                    ["Volume", money(col.v)],
                    ["Path", money(col.p)],
                  ]
                : key === "delta"
                  ? [
                      ["Buy − sell", signed(value, money)],
                      ["Volume", money(col.v)],
                      ["Taker buys", share(col.bv / col.v)],
                    ]
                  : key === "takertrades"
                    ? [
                        ["Buy − sell trades", signed(value, count)],
                        ["Trades", count(col.ct)],
                        ["Taker-buy trades", share(col.ct ? col.bt / col.ct : 0)],
                      ]
                    : key === "size"
                      ? [
                          ["Trade size", col.ct ? money(value) : "—"],
                          ["Trades", count(col.ct)],
                        ]
                      : key === "trades"
                        ? [
                            ["Trades", count(col.ct)],
                            ["Volume", money(col.v)],
                          ]
                        : [
                            ["Volume", money(col.v)],
                            ["Trades", count(col.ct)],
                          ],
      notes =
        key === "cascade" && x.alone
          ? "The other column in its parent had no trades"
          : key === "efficiency"
            ? "Its USDT per 125 USDT row its trades touched, over its parent column's, against the 0.70 expected"
            : "";
    tipRows(tip, head, sub, rows, [notes, note]);
  }
  // The tooltip's row section: the row's USDT in the rectangle and its share
  // of it (left out over the profile, which gives them already), the
  // underlay's value for the row over its period, and its relative volume.
  function rowSection(r, money, share, exact, withRow = true) {
    const out = [],
      q = last.query,
      where = S.selection ? "selection" : "view";
    if (withRow) {
      const row = q.rows.find((x) => x.r === r),
        measuring = last.meas.state === "pending" || last.meas.state === "failed";
      out.push([
        "Row",
        measuring
          ? "measuring the rectangle…"
          : row
            ? `${money(row.v)} · ${share(q.v > 0 ? row.v / q.v : 0)} of the ${where}`
            : `No trades in the ${where}`,
      ]);
    }
    const u = last.under;
    if (!u) return out;
    const label = `${ROWS_INFO[u.kind].name} · ${periodLabel(u.period)}`,
      { approx, from } = underlayBasis(u.res);
    if (!u.bands) return [...out, [label, underlayWhy(u.res)]];
    if (from) out.push(["Period's rows", from]);
    const band = u.bands.map.get(Math.floor(r / 2 ** (u.bands.m - renderM())));
    if (u.kind === "volume")
      out.push([label, band?.v > 0 ? `${approx}${money(band.v)} · ${share(band.v / u.bands.v)}` : "No trades in the period"]);
    else if (u.kind === "delta")
      out.push([label, band?.v > 0 ? approx + signed(2 * band.bv - band.v, money) : "No trades in the period"]);
    else if (u.kind === "time")
      out.push([
        label,
        band?.w > 0
          ? `${exact ? secondsExact(band.w) : dur(band.w)} · ${share(u.bands.w > 0 ? band.w / u.bands.w : 0)}`
          : "The price wasn't here in the period",
      ]);
    // Relative volume: the underlay's own value under Relative volume.
    const vb = u.volBands;
    if (vb) {
      const e = u.rect && relativeVolume(vb, u.rect).get(Math.floor(r / 2 ** (vb.m - renderM())));
      out.push([
        u.kind === "relvol" ? label : "Relative volume",
        !u.rect
          ? "measuring the rectangle…"
          : !e
            ? "No trades in the period"
            : e.none
              ? `−2 · it traded in the period, not in the ${where}`
              : approx + ratioText(e.value, exact),
      ]);
    }
    return out;
  }
  // On touch, where X can't be pressed, the tooltip's row section places the
  // level line on its row, or clears it.
  function levelButton(r) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ol-action ol-s ol-tip-action cursor-interaction";
    b.dataset.keys = "X";
    b.dataset.hint = "A dashed line at this row's price, kept through zooms; or X over a row";
    b.textContent = S.level === null ? `Level line at ${price((r + 0.5) * stepP() * PR)}` : "Clear the level line";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLevel(S.level === null ? r : null);
    });
    return b;
  }
  // Over the profile: whether the row is the period's POC, or in its 70% area.
  function underlayMarks(r) {
    const vb = last.under?.volBands;
    if (!vb) return "";
    const k = 2 ** (vb.m - renderM()),
      br = Math.floor(r / k);
    return br === vb.poc
      ? "The period's point of control"
      : vb.va && br >= vb.va.r0 && br < vb.va.r1
        ? "In the period's 70% area"
        : "";
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
    // A line or its tag under the pointer names the line; a clock line or a
    // CME gap, its event.
    const onLine = last && lineHits.length && inPlot(p) ? lineAt(p) : null,
      onClock = !onLine && last && clockHits.length && inPlot(p) ? clockAt(p) : null;
    hover.line = onLine?.id || null;
    if (onLine) {
      lineTip(tip, onLine);
      syncRowHover(null);
    } else if (onClock) {
      clockTip(tip, onClock);
      syncRowHover(null);
    } else if (last && onProfile(p)) {
      const r = Math.floor(p.p / ps),
        row = last.query.rows.find((x) => x.r === r),
        waiting = last.meas.state === "pending" || last.meas.state === "failed",
        // The underlay's value for the row and its relative volume, while it shows.
        times = rowSection(r, money, share, exact, false),
        marks = underlayMarks(r);
      // A profile row is no one cell: the Cells drawer shows none as hovered.
      syncRowHover(null);
      if (waiting)
        tipRows(
          tip,
          priceRow(r),
          "",
          [],
          last.meas.state === "failed"
            ? `Not measured: the cube didn't answer (${last.meas.error})`
            : "Measuring the rectangle in the cube…",
        );
      else if (!row) tipRows(tip, priceRow(r), marks, times, "No trades at this price in view");
      else
        tipRows(
          tip,
          priceRow(r),
          [r === last.query.poc ? "Point of control" : "", r === last.query.bpoc ? "Buy point of control" : "", marks]
            .filter(Boolean)
            .join(" · "),
          [
            ["Volume", money(row.v)],
            ["Of the profile", share(row.v / last.query.v)],
            ["Trades", count(row.ct)],
            ["Taker buys", `${money(row.bv)} · ${share(row.bv / row.v)}`],
            ["Taker-buy trades", `${count(row.bt)} · ${share(row.ct ? row.bt / row.ct : 0)}`],
            ...times,
          ],
          note,
        );
    } else if (last && paneShown && inActivity(p)) {
      paneTip(tip, p, money, count, share, exact, note);
      syncRowHover(null);
    } else if (!last || !inPlot(p)) {
      tip.hidden = true;
      syncRowHover(null);
      requestDraw();
      return;
    } else {
      const ts = stepT(),
        c = Math.floor(p.t / ts),
        r = Math.floor(p.p / ps),
        z = last.shown.map.get(c + "," + r),
        src = displaySource(),
        inside =
          p.t >= last.b[0] && p.t < last.b[1] && p.p >= last.b[2] && p.p < last.b[3],
        unavailable = p.t < src.b0 || p.t >= Math.min(src.b1, last.cut) || !inside,
        open = !S.replay && c * ts < CUT && (c + 1) * ts > CUT,
        head = `${range(c * ts, (c + 1) * ts)} UTC · ${dur(ts * BASE)}`,
        coarse = renderN() > S.n || renderM() > S.m ? ["Detail", "coarser than requested"] : null;
      // Cells after the last archived day come from provisional minutes, which
      // the day's archive may still revise.
      const provisional =
        PACK.live && CANON !== null && (c + 1) * ts > CANON
          ? ["Source", "provisional minutes"]
          : null;
      // Path and dwell, while a movement view shows them; Cascade's share.
      const mz = last.mv?.shown?.map.get(cellKey(c, r)),
        moves = last.mv ? motionRows(c, r, mz, money, exact) : [],
        cas =
          S.mode === "cascade" && last.full?.cascade
            ? cascadeRows(cascadeOf(last.full.cascade, c, r), share, exact, money, z)
            : null;
      if (unavailable)
        tipRows(tip, head, priceRow(r), [], S.replay && p.t >= last.cut
          ? "Hidden in replay"
          : p.t >= CUT
            ? "After the data cutoff"
            : S.selection
              ? "Outside the selection"
              : PACK.live
                ? "Loading this level from the cube"
                : "Not recorded at this level");
      else if (!z)
        tipRows(
          tip,
          head,
          priceRow(r),
          [...moves, ...(coarse ? [coarse] : []), ...(provisional ? [provisional] : []), ...rowSection(r, money, share, exact)],
          mz
            ? mz.p > 0
              ? "The price moved through without a trade here"
              : "The price held here without a trade"
            : open
              ? "Still open: no trades yet"
              : "No trades in this cell",
        );
      else
        tipRows(
          tip,
          head,
          priceRow(r),
          [
            ["Volume", money(z.v)],
            ["Trades", count(z.ct)],
            ["Trade size", z.ct ? money(z.v / z.ct) : "—"],
            ["Taker buys", `${money(z.bv)} · ${share(z.bv / z.v)}`],
            ["Taker-buy trades", `${count(z.bt)} · ${share(z.ct ? z.bt / z.ct : 0)}`],
            ["Buy − sell", signed(2 * z.bv - z.v, money)],
            ...(cas ? cas.rows : []),
            ...moves,
            ["Column", open ? "Still open" : "Complete"],
            ...(provisional ? [provisional] : []),
            ...(coarse ? [coarse] : []),
            ...rowSection(r, money, share, exact),
          ],
          [cas?.note, note],
        );
      syncRowHover(z ? c + "," + r : null);
    }
    // After a tap, the row section's control for the level line.
    if (nav.touchTip && !onLine && (inPlot(p) || onProfile(p))) tip.append(levelButton(Math.floor(p.p / ps)));
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
    el("mode-text").textContent = MODE_NAMES[S.mode];
    el("mode").setAttribute("aria-label", `Cells: ${MODE_NAMES[S.mode]}`);
    qsa("#ol-mode-menu [data-mode]").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.mode === S.mode)),
    );
    // The pane's choice, written only when it changes: update() runs on every input.
    if (el("pane").dataset.pane !== S.pane) {
      el("pane").dataset.pane = S.pane;
      el("pane-text").textContent = PANE_INFO[S.pane].name;
      el("pane").setAttribute("aria-label", `Columns: ${PANE_INFO[S.pane].name}`);
      qsa("#ol-pane-menu [data-pane]").forEach((b) =>
        b.setAttribute("aria-checked", String(b.dataset.pane === S.pane)),
      );
    }
    renderRows();
    renderLines();
    for (const f of ["poc", "area", "untested"]) el(f).checked = S[f];
    el("key-poc").hidden = el("key-bpoc").hidden = !S.poc;
    el("key-area").hidden = !S.area;
    // The movement views' keys: outlined cells and cells not measured yet.
    el("key-moved").hidden = el("key-plain").hidden = !(PACK.live && movementMode());
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
    scheduleCube();
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
                pane: S.pane,
                poc: S.poc,
                area: S.area,
                untested: S.untested,
                rows: S.rows,
                period: S.period,
                level: S.level,
                lines: S.lines,
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
        if (last) buildCells(measuredCells(last), last.b, last.mv);
      });
    for (const button of qsa("[data-sort]"))
      button.addEventListener("click", () => {
        const key = button.dataset.sort;
        if (S.cellSort === key) S.cellDir = -S.cellDir;
        else {
          S.cellSort = key;
          S.cellDir = key === "state" ? 1 : -1;
        }
        if (last) buildCells(measuredCells(last), last.b, last.mv);
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
  // On a phone the controls open in a sheet, and the chart header's newer
  // menus with them (Columns, Rows and its period), before POC lines; wider,
  // they sit after Cells in the chart header, the Rows legend after them.
  const PHONE = matchMedia("(max-width: 760px)");
  function placeMenus() {
    const groups = ["pane", "rows", "period"].map((id) => el(id).parentElement),
      sheet = el("controls");
    if (PHONE.matches === (groups[0].parentElement === sheet)) return;
    closePop();
    const before = PHONE.matches ? sheet.querySelector(":scope > .ol-lines-group") : el("rows-legend");
    for (const group of groups) before.parentElement.insertBefore(group, before);
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
      // Each section is a group named by its caption.
      const group = document.createElement("div"),
        head = document.createElement("div");
      group.setAttribute("role", "group");
      head.className = "ol-menu-cap";
      head.id = `ol-window-cap-${parts.length}`;
      head.textContent = cap;
      group.setAttribute("aria-labelledby", head.id);
      group.append(head);
      parts.push(group);
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
        group.append(b);
      }
    }
    el("window-menu").replaceChildren(...parts);
  }
  // A choice's name over what it does, each with an id for the item to name
  // and describe itself by.
  function itemText(id, name, what) {
    const text = document.createElement("span"),
      head = document.createElement("span"),
      desc = document.createElement("span");
    text.className = "ol-item-text";
    head.id = `ol-${id}-name`;
    head.textContent = name;
    desc.id = `ol-${id}-desc`;
    desc.className = "ol-item-desc";
    desc.textContent = what;
    text.append(head, desc);
    return text;
  }
  // The price axis: how its range follows a time zoom, each mode with what it
  // does, and a fit of the range once.
  function buildFollowMenu() {
    const follow = followMode(),
      parts = FOLLOWS.map((mode) => {
        const info = FOLLOW_INFO[mode],
          text = itemText(`follow-${mode}`, info.name, info.desc),
          b = menuItem(
            "menuitemradio",
            [svgIcon(mode), text, ...(info.keys ? [keyCap(info.keys)] : [])],
            () => setFollow(mode),
          );
        // Its name is the mode; what it does is its description.
        b.setAttribute("aria-labelledby", `ol-follow-${mode}-name`);
        b.setAttribute("aria-describedby", `ol-follow-${mode}-desc`);
        if (info.keys) b.setAttribute("aria-keyshortcuts", info.keys);
        b.dataset.follow = mode;
        b.setAttribute("aria-checked", String(mode === follow));
        return b;
      }),
      rule = document.createElement("div"),
      text = itemText("fit", "Fit the price range", "Once, to the trades in view");
    rule.className = "ol-menu-rule";
    rule.setAttribute("role", "separator");
    const fitItem = menuItem("menuitem", [svgIcon("fit"), text, keyCap("F")], () =>
      fitPrice("Fit price"),
    );
    fitItem.setAttribute("aria-labelledby", "ol-fit-name");
    fitItem.setAttribute("aria-describedby", "ol-fit-desc");
    fitItem.setAttribute("aria-keyshortcuts", "F");
    parts.push(rule, fitItem);
    el("follow-menu").replaceChildren(...parts);
  }

  // The encodings, grouped by the measure they read, each with what it shows.
  function buildModeMenu() {
    const parts = [];
    for (const [cap, keys] of MODE_GROUPS) {
      const group = document.createElement("div"),
        head = document.createElement("div");
      group.setAttribute("role", "group");
      head.className = "ol-menu-cap";
      head.id = `ol-mode-cap-${parts.length}`;
      head.textContent = cap;
      group.setAttribute("aria-labelledby", head.id);
      group.append(head);
      for (const key of keys) {
        const info = MODE_INFO[key],
          // Path and dwell need the live cube: the recorded page lists them, off.
          off = !modes().includes(key),
          b = menuItem(
            "menuitemradio",
            [
              svgIcon("check", "ol-icon ol-check"),
              itemText(`mode-${key}`, info.name, off ? "Live cube only" : info.desc),
            ],
            () => setMode(key),
          );
        if (off) b.setAttribute("aria-disabled", "true");
        b.setAttribute("aria-labelledby", `ol-mode-${key}-name`);
        b.setAttribute("aria-describedby", `ol-mode-${key}-desc`);
        b.dataset.mode = key;
        b.setAttribute("aria-checked", String(key === S.mode));
        group.append(b);
      }
      parts.push(group);
    }
    el("mode-menu").replaceChildren(...parts);
  }
  // The pane's measures, grouped as the encodings are, each with what it shows.
  function buildPaneMenu() {
    const parts = [];
    for (const [cap, keys] of PANE_GROUPS) {
      const group = document.createElement("div"),
        head = document.createElement("div");
      group.setAttribute("role", "group");
      head.className = "ol-menu-cap";
      head.id = `ol-pane-cap-${parts.length}`;
      head.textContent = cap;
      group.setAttribute("aria-labelledby", head.id);
      group.append(head);
      for (const key of keys) {
        const info = PANE_INFO[key],
          // Choppiness and volume per path need the live cube: the recorded page lists them, off.
          off = !panes().includes(key),
          b = menuItem(
            "menuitemradio",
            [
              svgIcon("check", "ol-icon ol-check"),
              itemText(`pane-${key}`, info.name, off ? "Live cube only" : info.desc),
            ],
            () => setPane(key),
          );
        if (off) b.setAttribute("aria-disabled", "true");
        b.setAttribute("aria-labelledby", `ol-pane-${key}-name`);
        b.setAttribute("aria-describedby", `ol-pane-${key}-desc`);
        b.dataset.pane = key;
        b.setAttribute("aria-checked", String(key === S.pane));
        group.append(b);
      }
      parts.push(group);
    }
    el("pane-menu").replaceChildren(...parts);
  }
  // The underlay's choices, grouped as the encodings are.
  function buildRowsMenu() {
    const parts = [];
    for (const [cap, keys] of ROWS_GROUPS) {
      const group = document.createElement("div"),
        head = document.createElement("div");
      group.setAttribute("role", "group");
      head.className = "ol-menu-cap";
      head.id = `ol-rows-cap-${parts.length}`;
      head.textContent = cap;
      group.setAttribute("aria-labelledby", head.id);
      group.append(head);
      for (const key of keys) {
        const info = ROWS_INFO[key],
          // Time at price needs the live cube: the recorded page lists it, off.
          off = !rowsChoices().includes(key),
          b = menuItem(
            "menuitemradio",
            [
              svgIcon("check", "ol-icon ol-check"),
              itemText(`rows-${key}`, info.name, off ? "Live cube only" : info.desc),
            ],
            () => setRows(key),
          );
        if (off) b.setAttribute("aria-disabled", "true");
        b.setAttribute("aria-labelledby", `ol-rows-${key}-name`);
        b.setAttribute("aria-describedby", `ol-rows-${key}-desc`);
        b.dataset.rows = key;
        b.setAttribute("aria-checked", String(key === S.rows));
        group.append(b);
      }
      parts.push(group);
    }
    el("rows-menu").replaceChildren(...parts);
  }
  // The Rows menu's button, and its period's, written only when they change:
  // update() runs on every input. The period shows while the underlay does.
  function renderRows() {
    const name = S.rows === "off" ? "Off" : ROWS_INFO[S.rows].name;
    if (el("rows").dataset.rows !== S.rows) {
      el("rows").dataset.rows = S.rows;
      el("rows-text").textContent = name;
      el("rows").setAttribute("aria-label", `Rows: ${name}`);
      qsa("#ol-rows-menu [data-rows]").forEach((b) =>
        b.setAttribute("aria-checked", String(b.dataset.rows === S.rows)),
      );
    }
    const group = el("period").parentElement,
      label = periodLabel(S.period);
    if (group.hidden !== (S.rows === "off")) group.hidden = S.rows === "off";
    if (el("period-text").textContent !== label) {
      el("period-text").textContent = label;
      el("period").setAttribute("aria-label", `Rows' period: ${label}`);
    }
    if (!el("period-pop").hidden) renderPeriods();
  }
  // The period's choices: the POC lines' periods and all history, then the
  // chosen day, if one is.
  function periodRow(key) {
    const row = document.createElement("label"),
      radio = document.createElement("input"),
      name = document.createElement("span");
    row.className = "ol-line-row cursor-interaction";
    radio.type = "radio";
    radio.name = "ol-period";
    radio.dataset.period = key;
    name.className = "ol-line-name";
    row.append(radio, name);
    return row;
  }
  function renderPeriods() {
    const list = el("period-list"),
      keys = [...PERIODS, ...(isDay(S.period) ? [S.period] : [])];
    if (list.dataset.keys !== keys.join(",")) {
      list.dataset.keys = keys.join(",");
      list.replaceChildren(...keys.map(periodRow));
    }
    for (const radio of qsa("#ol-period-list input[data-period]")) {
      const key = radio.dataset.period,
        name = radio.parentElement.querySelector(".ol-line-name"),
        label = periodLabel(key);
      if (radio.checked !== (key === S.period)) radio.checked = key === S.period;
      if (name.textContent !== label) name.textContent = label;
    }
    el("period-date").min = "2021-01-01";
    el("period-date").max = date(Math.max(0, activeCutoff() - 1e-6)).toISOString().slice(0, 10);
  }
  function periodStatus(text) {
    el("period-status").textContent = text;
  }
  function bindPeriods() {
    bindPop("period", "period-pop", () => {
      hideHint();
      periodStatus("");
      renderPeriods();
      root.querySelector("#ol-period-list input:checked")?.focus();
    });
    el("period-list").addEventListener("change", (e) => {
      const key = e.target.dataset?.period;
      if (!key) return;
      setPeriod(key);
      periodStatus(`Rows ${periodPhrase(key)}`);
    });
    el("period-add").addEventListener("submit", (e) => {
      e.preventDefault();
      const key = el("period-date").value;
      if (!isDay(key)) return periodStatus("Choose a day.");
      const start = dayStart(key);
      if (start < 0 || start >= activeCutoff())
        return periodStatus(`Choose a day from 1 Jan 2021 to ${day(Math.max(0, activeCutoff() - 1e-6))}.`);
      setPeriod(key);
      el("period-date").value = "";
      periodStatus(`Rows ${periodPhrase(key)}`);
    });
    el("period-date").addEventListener("input", () => periodStatus(""));
    // Text fields keep their keys, so the date field closes its popover itself.
    el("period-date").addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closePop(true);
    });
  }

  // Labels: a control's name and key, and what it does, a second after the
  // pointer rests on it, a finger holds it or the keyboard reaches it; once
  // one has shown, the next shows at once. A hold that shows a label doesn't
  // press the control too.
  const HINT_DELAY = 1000,
    hint = {
      timer: 0,
      leave: 0,
      target: null,
      hiddenAt: -Infinity,
      held: null,
      box: null,
      touch: false,
    };
  function hideHint() {
    clearTimeout(hint.timer);
    clearTimeout(hint.leave);
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
      // What the label says is each control's description already, so the
      // label itself is for the eye only.
      hint.box = document.createElement("div");
      hint.box.className = "ol-hint";
      hint.box.setAttribute("aria-hidden", "true");
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
    clearTimeout(hint.leave);
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
    // lifting counts as leaving. The pointer may cross onto a label and rest
    // there; the label goes a moment after the pointer leaves both.
    const leaveSoon = () => {
      clearTimeout(hint.leave);
      hint.leave = setTimeout(hideHint, 150);
    };
    root.addEventListener("pointerout", (e) => {
      if (e.pointerType === "touch") return;
      const t = hinted(e.target),
        onBox = hint.box?.contains(e.target);
      if (t && !t.contains(e.relatedTarget) && !hint.box?.contains(e.relatedTarget))
        // A label not shown yet is simply called off.
        hint.target ? leaveSoon() : hideHint();
      else if (onBox && !hint.box.contains(e.relatedTarget) && !hint.target?.contains(e.relatedTarget))
        leaveSoon();
    });
    root.addEventListener("pointerover", (e) => {
      if (hint.box?.contains(e.target) || hint.target?.contains(e.target))
        clearTimeout(hint.leave);
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
    bindMenu("mode", "mode-menu", buildModeMenu);
    bindMenu("pane", "pane-menu", buildPaneMenu);
    bindMenu("rows", "rows-menu", buildRowsMenu);
    bindPeriods();
    bindLines();
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
        viewPlace() +
        (S.mode === "volume" ? "" : " · " + MODE_NAMES[S.mode]) +
        (S.pane === "cells" ? "" : ` · ${PANE_INFO[S.pane].name} columns`) +
        (S.rows === "off" ? "" : ` · ${ROWS_INFO[S.rows].name} rows`);
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
    placeMenus();
    PHONE.addEventListener("change", placeMenus);
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
    level: new WeakMap(),
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
  // The drawn level's metrics: each cell's exposure within its block, up to
  // the cutoff, and the scale delta shades on. They change only with the
  // level, the block or the cutoff, so the level keeps them, as it keeps its
  // sorted amounts.
  function levelMetrics(full) {
    const src = displaySource(),
      end = Math.min(src.b1, activeCutoff()),
      key = src.b0 + "|" + end;
    if (full.metrics?.key === key) return full.metrics;
    const ts = stepT(),
      ps = stepP(),
      whole = ts * BASE * ps * PR,
      sourceBounds = [src.b0, end, 0, Infinity],
      cells = new WeakMap(),
      deltas = [];
    for (const z of full.cells) {
      const delta = 2 * z.bv - z.v;
      cells.set(z, { ...cellExposure(z, sourceBounds, ts, ps), whole, delta });
      if (delta !== 0) deltas.push(Math.abs(delta));
    }
    deltas.sort((a, b) => a - b);
    full.metrics = { key, cells, deltaMax: d3.quantileSorted(deltas, 0.995) || 1 };
    return full.metrics;
  }
  // Only the rectangle's cells are measured every frame: its bounds cut them.
  // Path and dwell shade by their own amounts: under them these go unread, and
  // the level's cells (full) aren't summed.
  function prepareMeasures(full, shown, query, b, moving = false) {
    const level = moving ? null : levelMetrics(full),
      ts = stepT(),
      ps = stepP(),
      whole = ts * BASE * ps * PR,
      metrics = new WeakMap();
    if (!moving)
      for (const z of shown.cells)
        metrics.set(z, { ...cellExposure(z, b, ts, ps), whole, delta: 2 * z.bv - z.v });
    markState = {
      metrics,
      level: level ? level.cells : new WeakMap(),
      deltaMax: level ? level.deltaMax : 1,
      va: contiguousArea(query.rows, query.poc, query.v),
      rays: [],
    };
    return markState;
  }
  // A cell's amount for an encoding: USDT, trades or USDT a trade. Volume and
  // trades grow with the cell, so an edge portion or the open column counts at
  // its full-cell rate and compares with whole cells; the values shown stay
  // the cell's own. The rectangle's and the lens's cells are measured within
  // their own bounds, the level's other cells within its block.
  function amount(z, mode = S.mode) {
    const m = markState.metrics.get(z) || markState.level.get(z),
      rate = m?.area > 0 ? m.whole / m.area : 1;
    if (mode === "trades" || mode === "flowtrades") return z.ct * rate;
    if (mode === "size") return z.ct > 0 ? z.v / z.ct : 0;
    return z.v * rate;
  }
  // Amounts shade by rank among the drawn block's cells: each step of the ramp
  // holds as many cells as any other, so the colour tells cells apart wherever
  // they crowd. Sorted once per block, level and encoding.
  function amountScale(full, mode = S.mode) {
    const key =
      mode === "flowtrades"
        ? "trades"
        : ["flow", "delta", "cascade", "geometry"].includes(mode)
          ? "volume"
          : mode;
    if (!full.scales[key])
      full.scales[key] = Float64Array.from(
        full.cells.map((z) => amount(z, key)).filter((x) => x > 0),
      ).sort();
    return full.scales[key];
  }
  // A value's place in a sorted scale, from 0 to 1; ties share the middle of
  // their run.
  function rank(sorted, x) {
    if (!sorted.length) return 0.5;
    const lo = d3.bisectLeft(sorted, x),
      hi = d3.bisectRight(sorted, x);
    return clamp((lo + hi) / 2 / sorted.length, 0, 1);
  }
  // The ramp amounts shade on: from near the surface to deep in the light
  // theme and to bright in the dark one, through yellow, green and blue, with
  // lightness changing evenly (interpolated in Lab).
  const RAMP = {
    light: ["#f2f9c4", "#d6efb3", "#a9dcb6", "#73c6bd", "#41b0c3", "#2390bd", "#2a6aac", "#283f94", "#15205e"],
    dark: ["#1b2c33", "#18405a", "#1a5b7d", "#1f7896", "#2c969c", "#4db493", "#86cd83", "#c6e27c", "#f4f1a6"],
  };
  // Colours kept with cells, as Cascade's are, are worked out again once the
  // theme changes: this counts the themes the page has drawn in.
  let rampColours = [],
    colourEpoch = 0;
  function buildRamp() {
    const stops = d3.lab(colors.surface).l < 50 ? RAMP.dark : RAMP.light,
      f = d3.piecewise(d3.interpolateLab, stops);
    rampColours = Array.from({ length: 256 }, (_, i) => d3.rgb(f(i / 255)).formatHex());
    colourEpoch++;
  }
  const ramp = (t) => rampColours[Math.round(clamp(t, 0, 1) * 255)];
  const AMOUNT_UNITS = { volume: "USDT", trades: "trades", size: "USDT a trade" };
  function legendText(full, mv) {
    if (mv && movementMode()) {
      if (!mv.src) return motionIssue() ? "Path and dwell unavailable" : "Reading path and dwell…";
      return motionLegend(motionScale(mv.full, mv.fullBounds, mv.end, stepT(), stepP()));
    }
    if (S.mode === "geometry") return "Occupied cells";
    if (S.mode === "flow") return "Taker buys 25% · 50% · 75% of USDT";
    if (S.mode === "flowtrades") return "Taker buys 25% · 50% · 75% of trades";
    if (S.mode === "delta")
      return `Δ ${signedCompact(-markState.deltaMax)} · 0 · ${signedCompact(markState.deltaMax)} USDT`;
    if (S.mode === "cascade")
      return full.cascade?.parent ? "−2 · 0 · +2 vs an even share" : "No coarser level to compare with";
    const sorted = amountScale(full),
      unit = AMOUNT_UNITS[S.mode];
    if (!sorted.length) return unit;
    return `${compact(d3.quantileSorted(sorted, 0.05))} → ${compact(d3.quantileSorted(sorted, 0.95))} ${unit}`;
  }
  // The legend's precise meaning, one hover away.
  const LEGEND_TITLES = {
    volume:
      "USDT traded per cell, shaded by rank: each step of the ramp holds as many of the drawn cells as any other, from the least traded to the most. An edge cell or the open column is shaded at its full-cell rate. The numbers are the 5th and 95th percentiles.",
    trades:
      "Trades per cell, shaded by rank like volume, at the full-cell rate. The numbers are the 5th and 95th percentiles.",
    size: "Average USDT per trade in each cell, shaded by rank. The numbers are the 5th and 95th percentiles.",
    flow: "The share of each cell's volume bought by takers: buy colour above half, sell colour below, full at 75% and 25%. Paler cells traded less.",
    flowtrades:
      "The share of each cell's trades that were taker buys: buy colour above half, sell colour below, full at 75% and 25%. Paler cells had fewer trades.",
    delta: "Taker-buy minus taker-sell volume per cell, in USDT",
    cascade:
      "How each cell's USDT splits within its parent, the cell one level coarser in time and price that it shares with three others: log₂ of 4 × its share of the parent, so 0 is an even quarter, +1 twice that and −1 half. +2 is the whole parent: no other cell in it traded, so the price never got there. Buy colour above 0, where volume concentrated, sell colour below, where it thinned; full at ±2 and paler where less traded. The pane under the prices shows each column's share of its parent column the same way.",
    path: "How far the price travelled in each cell: its path length, the sum of every move between consecutive trades split across the rows it passes, over the row's height, at its full-cell rate and shaded by rank. The numbers are the 5th and 95th percentiles. Outlined cells the price moved through or held in without a trade. The pane under the prices shows each column's path over its range, its highest trade less its lowest: 1 for a straight run, more the more it turned back. Read from the live cube up to the last complete base column.",
    dwell: "Each cell's share of its column's time: how long the price, held from one trade to the next, sat in the cell's rows, shaded by rank. The numbers are the 5th and 95th percentiles. Outlined cells the price moved through or held in without a trade. The pane under the prices shows each column's USDT traded per USDT the price moved, its volume over its path. Read from the live cube up to the last complete base column.",
    geometry: "The grid's occupied cells",
  };
  function legendRamp() {
    if (S.mode === "flow" || S.mode === "flowtrades" || S.mode === "cascade")
      return "linear-gradient(to right,var(--ol-sell),var(--ol-neutral),var(--ol-buy))";
    if (S.mode === "delta")
      return "linear-gradient(to right,var(--ol-sell),var(--ol-line),var(--ol-buy))";
    if (S.mode === "geometry") return "var(--ol-line)";
    return `linear-gradient(to right,${[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map(ramp).join(",")})`;
  }
  // How much a cell traded among the block's cells, from 0 to 1: its amount at
  // its full-cell rate on a log scale between their 2nd and 99.5th percentiles.
  // Diverging colours are paler the less a cell traded.
  function tradedLevel(z, full) {
    const sorted = amountScale(full),
      lo = Math.log(d3.quantileSorted(sorted, 0.02) || 1),
      hi = Math.log(d3.quantileSorted(sorted, 0.995) || Math.E);
    return clamp((Math.log(Math.max(amount(z), 1e-9)) - lo) / Math.max(0.1, hi - lo), 0, 1);
  }
  // From the neutral midpoint at 0 to buy at +1 and sell at −1, toward the
  // surface as the level falls.
  function divergingColour(t, level) {
    const hue = d3.interpolateRgb(colors.neutral, t >= 0 ? colors.buy : colors.sell)(Math.abs(t));
    return d3.interpolateRgb(colors.surface, hue)(0.3 + 0.7 * level);
  }
  // Cascade: how each cell's USDT splits within its parent, the cell one level
  // coarser in both time and price, (n + 1, m + 1), that it shares with three
  // others. Its value is log2(4 × its share): 0 an even quarter, +1 twice that,
  // −1 half, and +2 the whole parent, where no other cell in it traded. Both
  // levels are the block's own whole cells, summed by aggregate(), so the
  // shares within a parent add up to 1. A parent that starts before the
  // block's cells or ends after them has no value; one that runs past the data
  // (the open column, or a replay's edge) is unfinished; and at the lattice's
  // coarsest time or price there is no parent. The context is kept with the
  // level's cells; each cell's value is worked out once, when first drawn.
  function cascadeContext(cells, parent, start, end, cut) {
    return { cells, parent, start, end, cut, n: cells.n, entries: new Map(), cols: null, parents: null };
  }
  // The drawn level's context, from the block it is drawn from: its cells
  // (full) and its parents, summed within the same bounds.
  function levelCascade(full, src, sum) {
    const [start, stop] = sourceRange(src),
      cut = activeCutoff(),
      end = Math.min(stop, cut),
      parent = full.n >= N_MAX || full.m >= M_MAX ? null : aggregate(src, full.n + 1, full.m + 1, sum),
      c = full.cascade;
    if (!(c && c.parent === parent && c.start === start && c.end === end && c.cut === cut))
      full.cascade = cascadeContext(full, parent, start, end, cut);
    return full.cascade;
  }
  function cascadeOf(ctx, c, r) {
    const k = cellKey(c, r);
    let e = ctx.entries.get(k);
    if (!e) {
      e = cascadeEntry(ctx, c, r);
      ctx.entries.set(k, e);
    }
    return e;
  }
  // A cell's share of its parent and its value, or why it has none: no parent
  // at the coarsest level; outside, a parent the block holds only part of;
  // open, one that runs past the data.
  function cascadeEntry(ctx, c, r) {
    if (!ctx.parent) return { state: "coarsest" };
    const w = ctx.cells.map.get(c + "," + r);
    if (!w) return { state: "none" };
    const pc = Math.floor(c / 2),
      span = 2 ** (ctx.n + 1);
    if (pc * span < ctx.start) return { state: "outside", w };
    if ((pc + 1) * span > ctx.end) return { state: ctx.end >= ctx.cut ? "open" : "outside", w };
    const p = ctx.parent.map.get(pc + "," + Math.floor(r / 2));
    if (!(p?.v > 0)) return { state: "none", w };
    const share = w.v / p.v;
    // Alone: no other cell in the parent traded.
    return { state: "ok", w, p, share, value: Math.log2(4 * share), alone: p.ct === w.ct, colour: "", epoch: -1 };
  }
  // A column's share of its parent column, one level up in time, as log2(2 ×
  // its share): the pane's Same as cells under Cascade, on the same scale.
  // Worked out once for the level, as the cells' are.
  function cascadeColumn(ctx, c) {
    if (!ctx.cols) {
      ctx.cols = new Map();
      ctx.parents = ctx.parent ? new Map(ctx.parent.cols.map((x) => [x.c, x])) : null;
    }
    let e = ctx.cols.get(c);
    if (!e) {
      e = cascadeColumnEntry(ctx, c);
      ctx.cols.set(c, e);
    }
    return e;
  }
  function cascadeColumnEntry(ctx, c) {
    if (!ctx.parent) return { c, state: "coarsest" };
    const w = ctx.cells.cols[bisectColumn(ctx.cells.cols, c)],
      pc = Math.floor(c / 2),
      span = 2 ** (ctx.n + 1);
    if (w?.c !== c) return { c, state: "none" };
    if (pc * span < ctx.start) return { c, state: "outside", w };
    if ((pc + 1) * span > ctx.end) return { c, state: ctx.end >= ctx.cut ? "open" : "outside", w };
    const p = ctx.parents.get(pc);
    if (!(p?.v > 0)) return { c, state: "none", w };
    const share = w.v / p.v;
    return { c, state: "ok", w, p, share, value: Math.log2(2 * share), alone: p.ct === w.ct };
  }
  // A cell's colour. Amounts take the ramp by rank. Taker flow, by USDT or by
  // trades, diverges from a neutral midpoint to buy and sell, full at 75% and
  // 25%, paler where less traded; so does Cascade, full at ±2, and a cell it
  // has no value for is drawn plain. Delta shades signed taker volume.
  function cellColour(z, full, deltaMax = markState.deltaMax) {
    if (S.mode === "flow" || S.mode === "flowtrades") {
      const byTrades = S.mode === "flowtrades",
        share = byTrades ? (z.ct ? z.bt / z.ct : 0.5) : z.v ? z.bv / z.v : 0.5;
      return divergingColour(clamp((share - 0.5) / 0.25, -1, 1), tradedLevel(z, full));
    }
    if (S.mode === "cascade") {
      const e = full.cascade && cascadeOf(full.cascade, z.c, z.r);
      if (e?.state !== "ok") return colors.line;
      // Kept with the cell for its level, until the theme changes.
      if (e.epoch !== colourEpoch) {
        e.colour = divergingColour(clamp(e.value / 2, -1, 1), tradedLevel(e.w, full));
        e.epoch = colourEpoch;
      }
      return e.colour;
    }
    if (S.mode === "delta") {
      const delta = 2 * z.bv - z.v;
      return d3.interpolateRgb(
        colors.surface,
        delta >= 0 ? colors.buy : colors.sell,
      )(clamp(Math.log1p(Math.abs(delta)) / Math.log1p(deltaMax), 0, 1));
    }
    return ramp(rank(amountScale(full), amount(z)));
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
      ctx.fillStyle = cellColour(z, full);
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
  function profile(query, b, state, under) {
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
    // The underlay's second profile, behind the view's.
    if (under?.bands) underProfile(under, px, pw);
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
    if (S.level !== null) {
      const y = Math.round(G.Y(S.level)) + 0.5;
      ctx.setLineDash([6, 4]);
      line(px, y, px + pw + 3, y, colors.ink, 1.3, 0.9);
      ctx.setLineDash([]);
    }
    const hr = pointerRow();
    if (hr !== null) {
      const ya = G.Y((hr + 1) * ps),
        yb = G.Y(hr * ps);
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
    // While the cube measures the rectangle, the profile waits for it.
    text(
      state === "pending"
        ? "Measuring…"
        : state === "failed"
          ? "Not measured"
          : S.selection
            ? "Selected"
            : "Profile",
      px,
      G.y - 5,
      colors.muted,
      "left",
    );
  }
  // The price row under the pointer, over the prices or the profile, at the
  // drawn row size: outlined across both.
  function pointerRow() {
    return hover && (inPlot(hover) || onProfile(hover)) ? Math.floor(hover.p / stepP()) : null;
  }
  // The rows of a list sorted by row that lie in the plot at row size ps: the
  // first one's index, and the last row in view.
  function rowsInView(rows, ps) {
    const lo = Math.floor(G.Y.invert(G.y + G.h) / ps),
      hi = Math.floor(G.Y.invert(G.y) / ps);
    let i = 0,
      j = rows.length;
    while (i < j) {
      const h = (i + j) >> 1;
      if (rows[h].r < lo) i = h + 1;
      else j = h;
    }
    return [i, hi];
  }
  // The period's peaks among its rows in view, which the bands and the second
  // profile are scaled to, as the view's profile is to its own rows: its most
  // USDT, most signed USDT and most time in a row.
  function underlayPeak(u) {
    const b = u.bands,
      rows = b.rows;
    let [i, hi] = rowsInView(rows, 2 ** b.m),
      v = 0,
      d = 0,
      w = 0;
    for (; i < rows.length && rows[i].r <= hi; i++) {
      const x = rows[i];
      if (x.v > v) v = x.v;
      if (Math.abs(2 * x.bv - x.v) > d) d = Math.abs(2 * x.bv - x.v);
      if (x.w > w) w = x.w;
    }
    return { v: v || 1, d: d || 1, w: w || 1 };
  }
  // A band's strength, 0 to 1, and its colour: volume in a neutral grey,
  // delta and relative volume in the buy and sell colours (relative volume
  // full at ±2), time at price in its own. Amounts go by the square root of
  // their share of the peak in view, so the thinner rows still show.
  function bandTone(u, x, rel) {
    const k = u.peak;
    if (u.kind === "volume") return [Math.sqrt(x.v / k.v), colors.ink];
    if (u.kind === "time") return [Math.sqrt(x.w / k.w), colors.time];
    const v = u.kind === "delta" ? (2 * x.bv - x.v) / k.d : rel?.get(x.r) ? rel.get(x.r).value / 2 : 0,
      t = u.kind === "delta" ? Math.sqrt(Math.abs(v)) : Math.min(1, Math.abs(v));
    return [t, v >= 0 ? colors.buy : colors.sell];
  }
  // The underlay's bands: one per price row at the drawn row size, across the
  // whole chart behind the cells, so they show where the view has no cells:
  // the heavy levels it never visited. Each at a low alpha.
  function paintBands(u) {
    if (!u.bands) return;
    const b = u.bands,
      ps = 2 ** b.m,
      rel = u.kind === "relvol" && u.rect ? relativeVolume(b, u.rect) : null,
      rows = b.rows,
      top = u.kind === "volume" ? 0.2 : u.kind === "time" ? 0.3 : 0.16;
    if (u.kind === "relvol" && !rel) return;
    let [i, hi] = rowsInView(rows, ps);
    for (; i < rows.length && rows[i].r <= hi; i++) {
      const x = rows[i],
        [t, colour] = bandTone(u, x, rel);
      if (!(t > 0)) continue;
      const ya = G.Y((x.r + 1) * ps);
      ctx.fillStyle = colour;
      ctx.globalAlpha = top * t;
      ctx.fillRect(G.x, ya, G.w, Math.max(0.5, G.Y(x.r * ps) - ya));
    }
    ctx.globalAlpha = 1;
  }
  // The underlay's second profile, behind the view's: each row's value over
  // its period, scaled to the period's own peak. Volume and time at price run
  // from the strip's edge; delta and relative volume diverge from a centre
  // line. The period's POC is a dashed line across the strip, and its 70%
  // value area a bar down the strip's edge.
  function underProfile(u, px, pw) {
    const b = u.bands,
      ps = 2 ** b.m,
      mid = px + pw / 2,
      rel = u.kind === "relvol" && u.rect ? relativeVolume(b, u.rect) : null,
      rows = b.rows,
      diverging = u.kind === "delta" || u.kind === "relvol";
    let [i, hi] = rowsInView(rows, ps);
    for (; i < rows.length && rows[i].r <= hi; i++) {
      const x = rows[i],
        ya = G.Y((x.r + 1) * ps),
        h = Math.max(0.1, G.Y(x.r * ps) - ya - 0.7);
      if (!diverging) {
        const t = Math.min(1, u.kind === "volume" ? x.v / u.peak.v : x.w / u.peak.w);
        if (!(t > 0)) continue;
        ctx.fillStyle = u.kind === "volume" ? colors.ink : colors.time;
        ctx.globalAlpha = u.kind === "volume" ? 0.16 : 0.28;
        ctx.fillRect(px, ya, pw * t, h);
        ctx.globalAlpha = 0.6;
        ctx.fillRect(px + pw * t - 1, ya, 1, h);
        continue;
      }
      const v =
        u.kind === "delta"
          ? (2 * x.bv - x.v) / u.peak.d
          : rel?.get(x.r)
            ? clamp(rel.get(x.r).value / 2, -1, 1)
            : 0;
      if (!v) continue;
      const w = (pw / 2) * Math.abs(v);
      ctx.fillStyle = v >= 0 ? colors.buy : colors.sell;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(v >= 0 ? mid : mid - w, ya, w, h);
    }
    ctx.globalAlpha = 1;
    if (diverging) markLine(mid, G.y, mid, G.y + G.h, colors.line, 1, 0.9);
    const vb = u.volBands;
    if (vb?.va) {
      const vps = 2 ** vb.m,
        ya = G.Y(vb.va.r1 * vps),
        yb = G.Y(vb.va.r0 * vps);
      ctx.fillStyle = colors.ink;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(px, ya, 2, yb - ya);
      ctx.globalAlpha = 1;
    }
    if (vb?.poc != null) {
      const y = G.Y((vb.poc + 0.5) * 2 ** vb.m);
      ctx.setLineDash([3, 2]);
      markLine(px, y, px + pw, y, colors.ink, 1, 0.6);
      ctx.setLineDash([]);
    }
  }
  // How the underlay's rows stand for its period where they aren't its own
  // exactly (the recorded snapshot): from coarser rows, its 1,000 USDT ones,
  // marked ≈; or at 125 USDT from a block's first whole column after the
  // period starts, which is said.
  function underlayBasis(res) {
    if (res.state !== "ready" || res.exact !== false) return { approx: "", from: "" };
    if (res.rowPrice > 1) return { approx: "≈ ", from: `from ${price(PR * res.rowPrice)} USDT rows` };
    const a = Math.ceil(res.span[0] / res.columns) * res.columns;
    return { approx: "", from: a > res.span[0] ? `from ${when(a)} UTC` : "" };
  }
  // Why the underlay has no rows to draw yet.
  function underlayWhy(res) {
    return res.state === "failed"
      ? `couldn't be read: ${res.error}`
      : res.state === "pending"
        ? "reading from the cube…"
        : res.state === "unrecorded"
          ? "not recorded for this period"
          : "no time before the data's edge";
  }
  // The underlay's legend chip, after its menus, which name its choice and
  // period: its ramp and scale, the peak in view, or why it has none yet. Its
  // title names all three. Written only when its words change.
  function underlayLegend(u) {
    const chip = el("rows-legend");
    if (!u) {
      if (!chip.hidden) chip.hidden = true;
      return;
    }
    if (chip.hidden) chip.hidden = false;
    const k = u.peak,
      { approx, from } = underlayBasis(u.res),
      scale = !u.bands
        ? underlayWhy(u.res)
        : u.kind === "volume"
          ? `${approx}0 → ${compact(k.v)} USDT`
          : u.kind === "delta"
            ? `${approx}Δ ${signedCompact(-k.d)} · 0 · ${signedCompact(k.d)} USDT`
            : u.kind === "relvol"
              ? `${approx}−2 · 0 · +2 vs the period`
              : `0 → ${dur(k.w)}`,
      title = `Rows: ${ROWS_INFO[u.kind].name} ${periodPhrase(u.period)}${from ? `, ${from}` : ""}: ${scale}`;
    if (el("rows-legend-text").textContent !== scale) el("rows-legend-text").textContent = scale;
    if (chip.title !== title) chip.title = title;
    const ramp = el("rows-ramp");
    if (ramp.dataset.kind !== u.kind) {
      ramp.dataset.kind = u.kind;
      ramp.style.background =
        u.kind === "volume"
          ? "linear-gradient(to right,var(--ol-surface),color-mix(in srgb,var(--ol-ink) 30%,var(--ol-surface)))"
          : u.kind === "time"
            ? "linear-gradient(to right,var(--ol-surface),color-mix(in srgb,var(--ol-time) 45%,var(--ol-surface)))"
            : "linear-gradient(to right,color-mix(in srgb,var(--ol-sell) 45%,var(--ol-surface)),var(--ol-surface),color-mix(in srgb,var(--ol-buy) 45%,var(--ol-surface)))";
    }
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
      // Haloed, since it runs through the most traded cells, the ramp's far end.
      ctx.strokeStyle = colors.surface;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.poc;
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }
    ctx.restore();
  }
  // POC lines: for each period chosen, a line at the centre of the 125 USDT
  // price row where that period traded the most USDT, the cube's POC at its
  // finest rows (the lower row wins a tie). Periods end at the latest data, or
  // at a replay's edge, so a replay never draws a line with trades after it; a
  // day chosen by date starts a period at that UTC day's start. Each line is
  // solid across its period and dashed on to the right edge, where a tag names
  // it.
  const LINES = [
      { key: "1d", name: "1 day", tag: "1D", days: 1 },
      { key: "wk", name: "This week", tag: "Week" },
      { key: "7d", name: "7 days", tag: "7D", days: 7 },
      { key: "mo", name: "This month" },
      { key: "30d", name: "30 days", tag: "30D", days: 30 },
      { key: "90d", name: "90 days", tag: "90D", days: 90 },
      { key: "yr", name: "This year" },
      { key: "1y", name: "1 year", tag: "1Y", days: 365 },
      { key: "3y", name: "3 years", tag: "3Y", days: 1095 },
    ],
    LINE_KEYS = LINES.map((l) => l.key),
    DAYS_KEPT = 12,
    lineInfo = (key) => LINES.find((l) => l.key === key),
    // A day by its UTC date, a real one, from the history's first day on.
    isDay = (key) => {
      if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key < "2021-01-01")
        return false;
      const t = Date.parse(key + "T00:00:00Z");
      return Number.isFinite(t) && new Date(t).toISOString().startsWith(key);
    },
    dayStart = (key) => (Date.parse(key + "T00:00:00Z") / 1000 - T0) / BASE;
  // Lines (P): families of lines, each a named group in the menu and one
  // colour on the chart. The volume profile holds the POC lines, their value
  // areas, each day's POC and value area and the untested POCs; the session
  // levels the day's, week's and month's opens and the previous day's high,
  // low and close; the clock vertical lines at the times the market
  // coordinates on. A line's timeframe shows in the thickness and saturation
  // of its family's colour, in three tiers: short (a day to a week), medium
  // (a month to a quarter) and long (a year or more); its tag names its exact
  // period. Any number can be on at once, and the address and saved views
  // keep them all.
  const FAMILIES = [
      { id: "profile", name: "Volume profile", colour: "poc" },
      { id: "session", name: "Session levels", colour: "level" },
      { id: "structure", name: "Structure", colour: "level" },
      { id: "vwap", name: "VWAP", colour: "vwap" },
      { id: "clock", name: "Clock", colour: "clock" },
    ],
    TOGGLES = {
      va: { family: "profile", name: "Value area high and low", desc: "The top and bottom of each period's 70% value area" },
      dpoc: { family: "profile", name: "Daily POC and value area", desc: "Each UTC day's, across its day", tier: "short" },
      udpoc: {
        family: "profile",
        name: "Untested daily POCs",
        desc: "The last 30 sessions' POCs that no later trade has come within 125 USDT of, within 5 daily ATRs of the price",
        tier: "short",
        live: true,
      },
      uwpoc: {
        family: "profile",
        name: "Untested weekly POCs",
        desc: "The last 26 weeks' POCs, the same way",
        tier: "short",
        live: true,
      },
      dopen: { family: "session", name: "Daily open", desc: "Each UTC day's first trade, across its day", tier: "short", live: true },
      pdhlc: { family: "session", name: "Previous day's high, low and close", desc: "Across the following day", tier: "short", live: true },
      wopen: { family: "session", name: "Weekly open", desc: "Monday 00:00 UTC, across its week", tier: "short", live: true },
      mopen: { family: "session", name: "Monthly open", desc: "The 1st, 00:00 UTC, across its month", tier: "medium", live: true },
      ath: { family: "structure", name: "All-time high", desc: "The highest trade in the cube's history, from its time on", tier: "long", live: true },
      pch: {
        family: "structure",
        name: "Prior cycle high",
        desc: "The highest price before the last fall of more than half that came before the all-time high",
        tier: "long",
        live: true,
      },
      swing4h: {
        family: "structure",
        name: "4-hour swings",
        desc: "Highs and lows a 3 ATR reversal confirms on the 4-hour bars, until price trades through them; equal ones flagged",
        tier: "short",
        live: true,
      },
      swing1d: { family: "structure", name: "Daily swings", desc: "The same on the daily bars", tier: "short", live: true },
      fib30: {
        family: "structure",
        name: "Retracements · 30 days",
        desc: "0.382, 0.5 and 0.618 of the move between the last 30 sessions' high and low, back from the later",
        tier: "medium",
        live: true,
      },
      fib90: { family: "structure", name: "Retracements · 90 days", desc: "The same over 90 sessions", tier: "medium", live: true },
      fibswing: {
        family: "structure",
        name: "Retracements · last daily swing",
        desc: "The same for the move between the last two daily swings",
        tier: "medium",
        live: true,
      },
      svwap: { family: "vwap", name: "Session VWAP", desc: "USDT ÷ BTC from each 00:00 UTC", tier: "short", live: true },
      avwaph: { family: "vwap", name: "From the last daily swing high", desc: "USDT ÷ BTC from it on", tier: "medium", live: true },
      avwapl: { family: "vwap", name: "From the last daily swing low", desc: "USDT ÷ BTC from it on", tier: "medium", live: true },
      cday: { family: "clock", name: "Day start", desc: "00:00 UTC" },
      cweek: { family: "clock", name: "Week open", desc: "Monday 00:00 UTC" },
      cmonth: { family: "clock", name: "Month open", desc: "The 1st, 00:00 UTC" },
      funding: { family: "clock", name: "Funding", desc: "00:00, 08:00 and 16:00 UTC" },
      usopen: { family: "clock", name: "US equity open", desc: "13:30 UTC in US daylight time, 14:30 otherwise" },
      cme: {
        family: "clock",
        name: "CME close and reopen",
        desc: "Friday 16:00 and Sunday 17:00 Chicago; live, the spot gap between them is shaded until a trade reaches the Friday close",
      },
      deribit: { family: "clock", name: "Deribit expiry", desc: "Fridays 08:00 UTC; heavier on the month's last and at a quarter's end" },
    },
    TOGGLE_KEYS = Object.keys(TOGGLES),
    isPeriod = (k) => LINE_KEYS.includes(k) || isDay(k),
    periodLines = () => S.lines.filter(isPeriod),
    familyOf = (k) => (isPeriod(k) ? "profile" : isVwapDay(k) ? "vwap" : TOGGLES[k]?.family),
    // The recorded snapshot has no exact opens, highs, lows or closes.
    lineAvailable = (k) => isPeriod(k) || (isVwapDay(k) ? Boolean(PACK.live) : Boolean(TOGGLES[k] && (PACK.live || !TOGGLES[k].live))),
    PERIOD_TIERS = {
      "1d": "short",
      wk: "short",
      "7d": "short",
      mo: "medium",
      "30d": "medium",
      "90d": "medium",
      yr: "long",
      "1y": "long",
      "3y": "long",
      all: "long",
    };
  // A line's tier: a period's by its length, a day chosen by how long ago it is.
  function lineTier(key) {
    if (TOGGLES[key]) return TOGGLES[key].tier || "short";
    if (!isDay(key) && !isVwapDay(key)) return PERIOD_TIERS[key];
    const days = (cutEdge() - (isVwapDay(key) ? vwapDayStart(key) : dayStart(key))) / DAYS;
    return days <= 7 ? "short" : days <= 92 ? "medium" : "long";
  }
  // A family's colour at a tier: long lines at full saturation and weight,
  // shorter ones paler and thinner. Kept per theme.
  const styleMemo = new Map();
  function lineStyle(family, tier) {
    const key = family + "|" + tier + "|" + colourEpoch;
    let style = styleMemo.get(key);
    if (!style) {
      const t = colors.tiers[tier] || colors.tiers.long,
        c = d3.lch(colors.family[family]);
      c.c *= t.chroma;
      style = { colour: c.formatHex(), width: t.width };
      styleMemo.set(key, style);
      while (styleMemo.size > 64) styleMemo.delete(styleMemo.keys().next().value);
    }
    return style;
  }
  // A line's name, in lists and its tooltip; its tag, on the chart. The
  // calendar periods are named by what they are now: the month, the year; a
  // day's by the day it runs since.
  function lineName(key) {
    if (key === "all") return "All history";
    if (isVwapDay(key)) return `VWAP from ${day(vwapDayStart(key))}`;
    return isDay(key) ? `Since ${day(dayStart(key))}` : TOGGLES[key]?.name || lineInfo(key).name;
  }
  function lineTag(key) {
    const now = date(Math.max(0, activeCutoff() - 1e-6));
    if (isDay(key)) return `Since ${dayOf(date(dayStart(key)))}`;
    if (key === "mo") return d3.utcFormat("%b")(now);
    if (key === "yr") return String(now.getUTCFullYear());
    return lineInfo(key).tag;
  }
  // The lines kept in order: the periods as listed, the families' toggles,
  // then the POC lines' days and the VWAPs' days, each by date; those this
  // page can't draw are dropped.
  function normalizeLines(list) {
    const keys = new Set(
      (Array.isArray(list) ? list : []).filter(
        (k) => (LINE_KEYS.includes(k) || isDay(k) || isVwapDay(k) || TOGGLE_KEYS.includes(k)) && lineAvailable(k),
      ),
    );
    return [
      ...LINE_KEYS.filter((k) => keys.has(k)),
      ...TOGGLE_KEYS.filter((k) => keys.has(k)),
      ...[...keys].filter(isDay).sort().slice(-DAYS_KEPT),
      ...[...keys].filter(isVwapDay).sort().slice(-DAYS_KEPT),
    ];
  }
  // A line's period in base columns, ending at the edge that closes the data;
  // null when it has no time before that edge.
  function lineSpan(key) {
    const end = cutEdge(),
      now = date(Math.max(0, activeCutoff() - 1e-6)),
      base = (d) => Math.max(0, Math.round((+d / 1000 - T0) / BASE));
    let a;
    if (isDay(key)) a = Math.round(dayStart(key));
    else if (key === "wk") a = base(d3.utcMonday.floor(now));
    else if (key === "mo") a = base(d3.utcMonth.floor(now));
    else if (key === "yr") a = base(d3.utcYear.floor(now));
    else if (key === "all") a = 0;
    else a = Math.max(0, end - lineInfo(key).days * 1536);
    return a < end ? [a, end] : null;
  }
  const lineResults = new Map(),
    lineLatest = new Map(),
    // The cube's rows for the part of a period before its split (lineSplit).
    lineParts = new Map(),
    lineId = (key, span) =>
      ["line", live.generation, key, span[0], span[1], span[1] > Math.floor(CUT) ? CUT : ""].join("|");
  // A POC from row sums: the row with the most volume, the lower row winning a
  // tie, with its volume and the period's. Every row is kept: the underlay
  // draws them all.
  function linePOC(key, span, q, exact, rowPrice, columns = 1) {
    const row = q.poc,
      volume = row === null ? 0 : q.rows.find((x) => x.r === row)?.v || 0;
    return { key, span, state: "ready", exact, row, rowPrice, columns, volume, total: q.v, rows: q.rows };
  }
  // A period from a fixed start (a chosen day, this week, month or year) that
  // begins before the loaded base cells is split at their first UTC midnight.
  // The part before it is read from the cube once and kept until that midnight
  // moves on, once a day; the part after it is summed from the base cells as
  // new data arrives. Row sums add, so the POC is the cube's own.
  function lineSplit(key, span) {
    if (!PACK.live || !sources.recent || !(isDay(key) || ["wk", "mo", "yr", "all"].includes(key)))
      return null;
    const at = Math.ceil(sourceRange(sources.recent)[0] / 1536) * 1536,
      src = at > span[0] && at < span[1] ? exactSource([at, span[1], 0, 2 ** 32], 0, 0) : null;
    return src && { id: ["line-part", live.generation, span[0], at].join("|"), at, src };
  }
  // The base cells' rows from a split to a period's end, shared by every line
  // split there.
  let splitRows = null;
  function lineRecent(split, end) {
    const key = [split.src.id, split.src.cells.length, split.at, end, CUT, live.generation].join("|");
    if (splitRows?.key !== key)
      splitRows = { key, q: aggregate(split.src, 24, 0, [split.at, end, 0, Infinity]) };
    return splitRows.q;
  }
  // A period's two parts as one: their rows summed row by row, and the POC of
  // the sums.
  function joinRows(before, after) {
    const cell = (c) => (x) => ({ c, r: x.r, v: x.v, bv: x.bv, ct: x.ct, bt: x.bt });
    return summarize(before.map(cell(0)).concat(after.rows.map(cell(1))), 24, 0);
  }
  // A line's POC: from loaded cells at 125 USDT rows that tile its period; from
  // the cube and the loaded cells together, split as above; from the cube
  // (live); or, in the recorded snapshot, from its finest cells that cover the
  // period, marked as approximate.
  function lineResult(key) {
    const span = lineSpan(key);
    if (!span) return { key, span: null, state: "none" };
    const id = lineId(key, span);
    if (lineResults.has(id)) return lineResults.get(id);
    const tiled = exactSource([span[0], span[1], 0, 2 ** 32], 24, 0),
      split = tiled ? null : lineSplit(key, span);
    // What the cube is asked for while the line can't be summed here.
    let result = null,
      read = { id, a: span[0], b: span[1] };
    if (tiled) result = linePOC(key, span, aggregate(tiled, tiled.n, 0, [span[0], span[1], 0, Infinity]), true, 1);
    else if (split) {
      const before = lineParts.get(split.id);
      if (before) result = linePOC(key, span, joinRows(before, lineRecent(split, span[1])), true, 1);
      else read = { id: split.id, a: span[0], b: split.at, part: true };
    } else if (!PACK.live) {
      const blocks = Object.values(sources)
        .concat(referenceView ? [referenceView] : [])
        .filter((s) => {
          const [start, stop] = sourceRange(s);
          return start <= span[0] && stop >= Math.min(span[1], activeCutoff());
        })
        .sort((a, b) => a.m - b.m || a.n - b.n);
      const src = blocks[0];
      if (src) {
        const ts = 2 ** src.n,
          end = Math.min(src.b1, activeCutoff()),
          a = Math.ceil(span[0] / ts) * ts,
          b = span[1] >= end ? span[1] : Math.floor(span[1] / ts) * ts,
          covered = Math.max(0, Math.min(b, end) - a),
          wanted = Math.min(span[1], activeCutoff()) - span[0];
        // Cells too coarse to hold most of the period can't say where it traded
        // the most: the snapshot says so, rather than draw another period's POC
        // or call the period empty.
        result =
          covered >= wanted / 2
            ? linePOC(key, span, aggregate(src, src.n, src.m, [a, Math.max(a, b), 0, Infinity]), false, 2 ** src.m, ts)
            : { key, span, state: "unrecorded" };
      } else result = { key, span, state: "unrecorded" };
    }
    if (!result)
      return { key, span, state: cube.failed.has(read.id) ? "failed" : "pending", read, error: cube.failed.get(read.id) };
    lineResults.set(id, result);
    if (result.state === "ready") lineLatest.set(key, result);
    return result;
  }
  // What a line draws: its own result, or while that is read, the latest one
  // that ends no later than the data shown, so no line runs ahead of a replay.
  // A line whose read failed shows nothing but the failure: nothing is being
  // read for it until new data arrives.
  function lineShown(key) {
    const r = lineResult(key);
    if (r.state !== "pending") return r;
    const was = lineLatest.get(key);
    return was && r.span && was.span[1] <= cutEdge() ? { ...was, stale: true } : r;
  }
  // The periods whose rows are read: the lines', and the underlay's while it shows.
  const readPeriods = () => {
    const own = periodLines();
    return S.rows !== "off" && !own.includes(S.period) ? [...own, S.period] : own;
  };
  function linesWant() {
    for (const key of readPeriods()) {
      const r = lineResult(key);
      if (r.state !== "pending") continue;
      const { id, a, b, part } = r.read,
        nq = clamp(Math.ceil(Math.log2(Math.max(1, (b - a) / 16))), 0, 24);
      return {
        key: id,
        path: `/cube/query?n=${nq}&m=0&b0=${a}&b1=${b}`,
        decode: async (body) => ({ block: await unpack(body.block, id), s: body.summary }),
        apply: ({ block, s }) => {
          const q = summarize(block.cells, nq, 0);
          // The part before a split: its rows, kept while the split holds.
          if (part) {
            lineParts.set(id, q.rows.map(({ r, v, bv, ct, bt }) => ({ r, v, bv, ct, bt })));
            while (lineParts.size > 40) lineParts.delete(lineParts.keys().next().value);
            return;
          }
          q.poc = s.poc == null ? null : Math.round(s.poc / PR - 0.5);
          q.v = s.volume;
          const result = linePOC(key, r.span, q, true, 1);
          lineResults.set(id, result);
          lineLatest.set(key, result);
          while (lineResults.size > 200) lineResults.delete(lineResults.keys().next().value);
        },
      };
    }
    return null;
  }
  function setLines(next) {
    S.lines = normalizeLines(next);
    update();
    save();
  }
  // Bars (/cube/bars): at a grid timeframe, each column's open, high, low and
  // close, its USDT, taker-buy USDT and BTC volume and its trades, the cube's
  // own measures (PRD-0023), read in path and dwell's second slot while a line
  // built on them is on (live only). A timeframe's bars are read in chunks of
  // 4,096 aligned to the history's start, the latest first and back to the
  // history's first day, where the daily ATR starts. The chunk holding the
  // latest data is read again from its latest bar as the pack moves on, and
  // from the day's start once the day's archive has replaced its provisional
  // minutes. Bars end at the pack's last complete base column, or earlier
  // where the cube's measures end, and the lines built on them say so; in
  // replay the bar at the edge is read up to the edge, so no bar holds a trade
  // after it.
  const BAR_CHUNK = 4096,
    barChunks = new Map(), // "n|j" -> { n, j, a, z, bars, end, token, canon }
    barEdges = new Map(), // "generation|n|edge" -> { bar, end }
    // The lines built on 8-hour bars: their days, weeks and months.
    EIGHT_HOUR_LINES = ["udpoc", "uwpoc", "dopen", "pdhlc", "wopen", "mopen"];
  let barsVersion = 0;
  async function unpackBars(block) {
    const buf = await inflate(block),
      v = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "MSCB") throw Error("Invalid block of bars");
    const count = v.getUint32(16, true);
    let o = 32;
    const take = (Type) => {
      const a = new Type(buf, o, count);
      o += Type.BYTES_PER_ELEMENT * count;
      return a;
    };
    const [open, high, low, close, vol, bv, btc, ct] = Array.from({ length: 8 }, () => take(Float64Array)),
      cs = take(Uint32Array);
    return Array.from({ length: count }, (_, i) => ({
      c: cs[i],
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      v: vol[i],
      bv: bv[i],
      btc: btc[i],
      ct: ct[i],
    }));
  }
  // The timeframes the lines on read over the whole history: 8-hour bars for
  // the days, weeks and months, the structure built on them and the VWAPs'
  // sums; 4-hour bars for their swings; and hourly ones for the CME gap.
  function barLevels() {
    if (!PACK.live) return [];
    const out = [];
    // Structure's days come from the 8-hour bars, the 4-hour swings' too.
    if ([...EIGHT_HOUR_LINES, ...STRUCTURE_LINES, ...FOUR_HOUR_LINES].some((k) => S.lines.includes(k)) || S.lines.some(isVwapDay))
      out.push(9);
    if (FOUR_HOUR_LINES.some((k) => S.lines.includes(k))) out.push(8);
    if (S.lines.includes("cme")) out.push(6);
    return out;
  }
  function barChunkWant(n, j) {
    const step = 2 ** n,
      a = j * BAR_CHUNK * step,
      z = a + BAR_CHUNK * step,
      top = Math.ceil(CUT),
      id = n + "|" + j,
      have = barChunks.get(id);
    if (a >= top) return null;
    // Provisional minutes the day's archive has replaced since: read again from there.
    const redo = Boolean(have) && CANON !== null && have.canon !== null && CANON > have.canon && have.end > have.canon;
    if (have && !redo && (have.end >= z || have.token === PACK.state_token)) return null;
    const from = have ? Math.max(a, Math.floor((redo ? Math.min(have.end, have.canon) : have.end) / step) * step) : a,
      b1 = Math.min(z, top);
    if (from >= b1) return null;
    return {
      key: ["bars", live.generation, n, j, from, b1, PACK.state_token].join("|"),
      path: `/cube/bars?n=${n}&b0=${from}&b1=${b1}`,
      decode: async (body) => ({ part: await unpackBars(body.bars), body }),
      apply: ({ part, body }) => {
        const held = barChunks.get(id),
          kept = held ? held.bars.filter((x) => x.c * step < from) : [];
        barChunks.set(id, {
          n,
          j,
          a,
          z,
          bars: kept.concat(part),
          end: Math.max(from, body.end),
          token: body.state_token,
          canon: canonOf(body),
        });
        barsVersion++;
      },
    };
  }
  // In replay, the bar holding the edge, up to the edge.
  function barEdgeWant(n) {
    const step = 2 ** n,
      edge = cutEdge();
    if (!S.replay || edge % step === 0) return null;
    const key = [live.generation, n, edge].join("|");
    if (barEdges.has(key)) return null;
    const b0 = Math.floor(edge / step) * step;
    return {
      key: "bar-edge|" + key,
      path: `/cube/bars?n=${n}&b0=${b0}&b1=${edge}`,
      decode: async (body) => ({ part: await unpackBars(body.bars), body }),
      apply: ({ part, body }) => {
        barEdges.set(key, { bar: part[0] || null, end: body.end });
        while (barEdges.size > 16) barEdges.delete(barEdges.keys().next().value);
        barsVersion++;
      },
    };
  }
  // Each timeframe's chunks before the data's edge, the latest first, then in
  // replay the bar at the edge; then the chunks holding the view's days at
  // the timeframe its VWAPs are drawn at.
  function barsWant() {
    const edge = cutEdge();
    for (const n of barLevels()) {
      const span = BAR_CHUNK * 2 ** n;
      for (let j = Math.floor((edge - 1) / span); j >= 0; j--) {
        const want = barChunkWant(n, j);
        if (want && !motion.failed.has(want.key)) return want;
      }
      const tail = barEdgeWant(n);
      if (tail && !motion.failed.has(tail.key)) return tail;
    }
    for (const [n, a, b] of viewBarNeeds()) {
      const span = BAR_CHUNK * 2 ** n;
      for (let j = Math.floor(Math.max(a, b - 1) / span); j >= Math.floor(a / span); j--) {
        const want = barChunkWant(n, j);
        if (want && !motion.failed.has(want.key)) return want;
      }
      const tail = b >= edge ? barEdgeWant(n) : null;
      if (tail && !motion.failed.has(tail.key)) return tail;
    }
    return null;
  }
  // Why a timeframe's bars couldn't be read, when they couldn't.
  function barsIssue(n) {
    for (const [key, message] of motion.failed)
      if ((key.startsWith("bars|") && key.split("|")[2] === String(n)) || key.startsWith(`bar-edge|${live.generation}|${n}|`))
        return message;
    return null;
  }
  // A timeframe's bars up to the data's edge, in time order, once every chunk
  // before the edge is read: complete bars and live the latest one so far, in
  // replay the bar at the edge up to it. With where they end: the pack's last
  // complete base column, the replay's edge, or earlier where the cube's
  // measures end. Kept until a read or the edge changes.
  const seriesMemo = new Map();
  function barSeries(n) {
    const edge = cutEdge(),
      step = 2 ** n,
      span = BAR_CHUNK * step,
      partial = S.replay && edge % step !== 0,
      tail = partial ? barEdges.get([live.generation, n, edge].join("|")) : null,
      key = [live.generation, edge, S.replay, barsVersion].join("|"),
      hit = seriesMemo.get(n);
    if (hit?.key === key) return hit.out;
    const chunks = [];
    for (let j = 0; j * span < edge; j++) chunks.push(barChunks.get(n + "|" + j));
    let out = { state: motion.failed.size && barsIssue(n) ? "failed" : "pending", n, error: barsIssue(n) };
    if (chunks.length && chunks.every(Boolean) && (!partial || tail)) {
      const bars = [];
      let end = S.replay ? edge : chunks[chunks.length - 1].end;
      for (const ch of chunks) {
        for (const x of ch.bars) if (!S.replay || (x.c + 1) * step <= edge) bars.push(x);
        if (ch.end < Math.min(ch.z, edge)) end = Math.min(end, ch.end);
      }
      if (tail) {
        if (tail.bar) bars.push(tail.bar);
        end = Math.min(end, tail.end);
      }
      out = { state: "ready", n, step, bars, end };
    }
    seriesMemo.set(n, { key, out });
    return out;
  }
  // Where a timeframe's measures end, when the cube's end before the data does:
  // the lines built on them end there too.
  function barsShort(series) {
    return series.state === "ready" && series.end < (S.replay ? cutEdge() : Math.floor(CUT)) ? series.end : null;
  }
  // Bars combined: the first's open, the highest high, the lowest low, the
  // last's close and the volumes and trades summed.
  function combineBars(parts) {
    let high = -Infinity,
      low = Infinity,
      ct = 0;
    for (const x of parts) {
      if (x.high > high) high = x.high;
      if (x.low < low) low = x.low;
      ct += x.ct;
    }
    return {
      open: parts[0].open,
      high,
      low,
      close: parts[parts.length - 1].close,
      v: exactSum(parts.map((x) => x.v)),
      bv: exactSum(parts.map((x) => x.bv)),
      btc: exactSum(parts.map((x) => x.btc)),
      ct,
    };
  }
  // A UTC day's week, Monday to Sunday: 2021-01-04 (day 3) starts week 1, and
  // the history's first three days are week 0.
  const weekOf = (d) => Math.floor((d + 4) / 7),
    weekStart = (w) => (7 * w - 4) * DAYS,
    monthOf = (t) => {
      const at = date(t);
      return at.getUTCFullYear() * 12 + at.getUTCMonth();
    },
    monthStart = (k) => (Date.UTC(Math.floor(k / 12), k % 12, 1) / 1000 - T0) / BASE;
  // UTC days from 8-hour bars, three to a day; weeks from their days, Monday
  // to Sunday; months from theirs. Each whole when it ends by the bars' end.
  // Kept with the bars.
  const calendarMemo = new WeakMap();
  function barCalendar(series) {
    let hit = calendarMemo.get(series);
    if (hit) return hit;
    const group = (items, keyOf, start, stop) => {
      const out = [],
        by = new Map();
      for (const x of items) {
        const k = keyOf(x);
        let g = by.get(k);
        if (!g) {
          g = { k, t: start(k), z: stop(k), parts: [] };
          by.set(k, g);
          out.push(g);
        }
        g.parts.push(x);
      }
      for (const g of out) Object.assign(g, combineBars(g.parts), { whole: g.z <= series.end });
      return { list: out, by };
    };
    const days = group(
        series.bars,
        (x) => Math.floor((x.c * series.step) / DAYS),
        (d) => d * DAYS,
        (d) => (d + 1) * DAYS,
      ),
      weeks = group(days.list, (d) => weekOf(d.k), weekStart, (w) => weekStart(w + 1)),
      months = group(days.list, (d) => monthOf(d.t), monthStart, (k) => monthStart(k + 1));
    hit = { days, weeks, months, atr: dailyATR(days.list) };
    calendarMemo.set(series, hit);
    return hit;
  }
  // The daily ATR, from the history's first day: Wilder's smoothing of the
  // true range over 14 days. A day's true range is its high less its low, or
  // further to the previous day's close where that lies outside them; the
  // first ATR is the mean of the first 14, on the 14th day, and each after it
  // (13 × the last + the day's true range) ÷ 14. Whole days only, by day.
  function dailyATR(days, length = 14) {
    const out = new Map();
    let prev = null,
      sum = 0,
      count = 0,
      atr = null;
    for (const day of days) {
      if (!day.whole) break;
      const tr =
        prev === null
          ? day.high - day.low
          : Math.max(day.high - day.low, Math.abs(day.high - prev.close), Math.abs(day.low - prev.close));
      count++;
      if (atr === null) {
        sum += tr;
        if (count === length) atr = sum / length;
      } else atr = ((length - 1) * atr + tr) / length;
      if (atr !== null) out.set(day.k, atr);
      prev = day;
    }
    return out;
  }
  // Each UTC day's volume profile at 125 USDT rows: each row's USDT, the POC
  // (the row with the most, the lower row winning a tie) and the 70% value
  // area, as the view's profile computes them. Summed from loaded cells at 125
  // USDT rows that tile the day (the recent and reference tiers hold the last
  // 30 days), or live read from the cube at 8-hour columns, up to 64 days at a
  // time, and kept: a whole day never changes. A week's is its days' rows summed.
  const DAY_READ = 64,
    dayReads = new Map(), // "generation|d|edge" -> profile
    dayMemo = new Map();
  function profileOf(rows) {
    let poc = null,
      best = 0;
    for (const x of rows)
      if (x.v > best) {
        best = x.v;
        poc = x.r;
      }
    const v = exactSum(rows.map((x) => x.v));
    return { rows, v, poc, va: contiguousArea(rows, poc, v) };
  }
  // Rows summed from cells, or from other rows, in order.
  function rowsOf(items) {
    const rows = new Map();
    for (const z of items) {
      let row = rows.get(z.r);
      if (!row) rows.set(z.r, (row = { r: z.r, vs: [], bvs: [] }));
      row.vs.push(z.v);
      row.bvs.push(z.bv);
    }
    return [...rows.values()].sort((a, b) => a.r - b.r).map((x) => ({ r: x.r, v: exactSum(x.vs), bv: exactSum(x.bvs) }));
  }
  const dayReadKey = (d) => {
    const edge = cutEdge();
    return [live.generation, d, (d + 1) * DAYS > edge ? edge : ""].join("|");
  };
  function dayFailure(d) {
    for (const [key, message] of cube.failed) {
      const [kind, generation, a, b] = key.split("|");
      if (kind === "days" && Number(generation) === live.generation && Number(a) <= d * DAYS && d * DAYS < Number(b))
        return message;
    }
    return null;
  }
  function dayProfile(d) {
    const edge = cutEdge(),
      a = d * DAYS,
      b = Math.min((d + 1) * DAYS, edge);
    if (b <= a || a < 0) return { state: "none", d };
    const src = exactSource([a, b, 0, 2 ** 32], 9, 0);
    if (src && src.m === 0) {
      const key = [src.id, d, b].join("|"),
        hit = dayMemo.get(key);
      if (hit && hit.cells === src.cells) return hit.out;
      const ts = 2 ** src.n,
        map = new Map(),
        stop = CUT > b ? bisectColumn(src.cells, Math.ceil(b / ts) + 1) : src.cells.length;
      sumCells(map, src, 9, 0, [a, b, 0, Infinity], bisectColumn(src.cells, Math.floor(a / ts)), stop);
      const out = { state: "ready", d, exact: true, whole: b === (d + 1) * DAYS, ...profileOf(rowsOf([...map.values()])) };
      dayMemo.delete(key);
      dayMemo.set(key, { cells: src.cells, out });
      while (dayMemo.size > 160) dayMemo.delete(dayMemo.keys().next().value);
      return out;
    }
    const read = dayReads.get(dayReadKey(d));
    if (read) return read;
    if (!PACK.live) return { state: "unrecorded", d };
    const failed = dayFailure(d);
    return failed ? { state: "failed", d, error: failed } : { state: "pending", d };
  }
  // A week's profile, from its days' rows, once all of them are.
  const weekMemo = new Map();
  function weekProfile(w) {
    const d0 = 7 * w - 4,
      days = Array.from({ length: 7 }, (_, i) => dayProfile(d0 + i));
    const waiting = days.find((p) => p.state !== "ready");
    if (waiting) return { state: waiting.state, w, error: waiting.error };
    const hit = weekMemo.get(w);
    if (hit && hit.days.every((p, i) => p === days[i])) return hit.out;
    const out = { state: "ready", w, ...profileOf(rowsOf(days.flatMap((p) => p.rows))) };
    weekMemo.set(w, { days, out });
    while (weekMemo.size > 40) weekMemo.delete(weekMemo.keys().next().value);
    return out;
  }
  // The days whose profiles the lines on need: the view's, for each day's POC
  // and value area while days are far enough apart to draw, then the last 30
  // sessions' and 26 weeks' for the untested lists.
  function dayNeeds() {
    const out = [],
      edge = cutEdge(),
      last = Math.ceil(edge / DAYS);
    if (S.lines.includes("dpoc") && spaced(DAYS))
      for (let d = Math.max(0, Math.floor(S.tA / DAYS)); d < Math.min(last, Math.ceil(S.tB / DAYS)); d++) out.push(d);
    if (!PACK.live) return out;
    const D = Math.floor(untestedNow() / DAYS);
    if (S.lines.includes("udpoc")) for (let d = Math.max(0, D - UNTESTED_DAYS); d < D; d++) out.push(d);
    if (S.lines.includes("uwpoc")) {
      const W = weekOf(D);
      for (let d = Math.max(0, 7 * (W - UNTESTED_WEEKS) - 4); d < 7 * W - 4; d++) out.push(d);
    }
    return out;
  }
  function daysWant() {
    if (!PACK.live) return null;
    const need = dayNeeds(),
      wanted = new Set(need),
      edge = cutEdge();
    for (const d of need) {
      if (dayProfile(d).state !== "pending") continue;
      // A run of days needed and still to read, the day at the edge alone.
      let e = d + 1;
      if (e * DAYS <= edge)
        while (e - d < DAY_READ && (e + 1) * DAYS <= edge && wanted.has(e) && dayProfile(e).state === "pending") e++;
      const a = d * DAYS,
        b = Math.min(e * DAYS, edge),
        key = ["days", live.generation, a, b].join("|");
      if (cube.failed.has(key)) continue;
      return {
        key,
        path: `/cube/tile?n=9&m=0&b0=${a}&b1=${b}`,
        decode: (body) => unpack(body.block, key),
        apply: (block) => {
          const byDay = new Map();
          for (const z of block.cells) {
            const day = Math.floor(z.c / 3);
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day).push(z);
          }
          for (let x = d; x < e; x++)
            dayReads.set(dayReadKey(x), {
              state: "ready",
              d: x,
              exact: true,
              whole: (x + 1) * DAYS <= b,
              ...profileOf(rowsOf(byDay.get(x) || [])),
            });
          while (dayReads.size > 600) dayReads.delete(dayReads.keys().next().value);
        },
      };
    }
    return null;
  }
  // Untested POCs (live): each whole day's POC among the last 30 sessions, and
  // separately each whole week's among the last 26 weeks, that no later trade
  // came within one 125 USDT row of (no later 8-hour bar's low to high meets
  // the POC ± 125 USDT), within 5 daily ATRs of the latest price. Each has its
  // age in sessions or weeks and its distance from the latest price in daily
  // ATRs and USDT. In replay, nothing after the edge is used.
  const UNTESTED_DAYS = 30,
    UNTESTED_WEEKS = 26,
    UNTESTED_REACH = 5;
  // The time the untested lists run to: the bars' end, or the data's edge
  // while the bars are read.
  function untestedNow() {
    const s = PACK.live ? barSeries(9) : null;
    return s?.state === "ready" ? s.end : activeCutoff();
  }
  const untestedLatest = new Map();
  // Once per data change: a frame asks with the same data.
  function untestedList(kind) {
    const series = barSeries(9);
    if (series.state !== "ready") return { state: series.state, error: series.error };
    const now = [series.end, barsVersion, dayReads.size, live.generation, CUT, sourcesKey()].join("|"),
      was = untestedLatest.get(kind);
    if (was?.now === now && was.series === series) return was.out;
    const out = untestedFrom(kind, series);
    untestedLatest.set(kind, { now, series, out });
    return out;
  }
  function untestedFrom(kind, series) {
    const cal = barCalendar(series),
      D = Math.floor(series.end / DAYS),
      W = weekOf(D),
      profiles =
        kind === "day"
          ? Array.from({ length: UNTESTED_DAYS }, (_, i) => dayProfile(D - UNTESTED_DAYS + i)).filter((p) => p.state !== "none")
          : Array.from({ length: UNTESTED_WEEKS }, (_, i) => weekProfile(W - UNTESTED_WEEKS + i)).filter((p) => p.w > 0),
      waiting = profiles.find((p) => p.state !== "ready"),
      last = series.bars[series.bars.length - 1],
      atr = cal.atr.get(D - 1) ?? null,
      items = [];
    if (last && atr !== null)
      for (const p of profiles) {
        if (p.state !== "ready" || p.poc === null) continue;
        const from = kind === "day" ? p.d * DAYS : weekStart(p.w),
          to = kind === "day" ? (p.d + 1) * DAYS : weekStart(p.w + 1),
          at = (p.poc + 0.5) * PR,
          tested = series.bars.some((x) => x.c * series.step >= to && x.low <= at + PR && x.high >= at - PR);
        if (tested || Math.abs(at - last.close) > UNTESTED_REACH * atr) continue;
        items.push({
          kind,
          k: kind === "day" ? p.d : p.w,
          from,
          to,
          row: p.poc,
          price: at,
          age: kind === "day" ? D - p.d : W - p.w,
          usd: at - last.close,
          atrs: (at - last.close) / atr,
        });
      }
    return {
      state: waiting ? (waiting.state === "failed" ? "failed" : "pending") : "ready",
      error: waiting?.error,
      items,
      atr,
      latest: last?.close ?? null,
      end: series.end,
    };
  }
  // The clock: vertical lines at the times the market coordinates on, from
  // the calendar alone. US daylight time runs from the second Sunday in March
  // to the first Sunday in November; Chicago keeps it too, 5 hours behind UTC
  // in it and 6 otherwise, and New York 4 and 5.
  const nthSunday = (y, month, n) => {
      const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
      return 1 + ((7 - first) % 7) + 7 * (n - 1);
    },
    usDaylight = (y, month, day) => {
      const start = Date.UTC(y, 2, nthSunday(y, 2, 2)),
        stop = Date.UTC(y, 10, nthSunday(y, 10, 1)),
        at = Date.UTC(y, month, day);
      return at >= start && at < stop;
    },
    // The last Friday of a month, as its day of the month.
    lastFriday = (y, month) => {
      const days = new Date(Date.UTC(y, month + 1, 0)).getUTCDate(),
        last = new Date(Date.UTC(y, month, days)).getUTCDay();
      return days - ((last - 5 + 7) % 7);
    };
  // Each kind's times from `a` to `b` (base), with what each is. `gap` is the
  // least time between two of a kind, which the spacing rule reads.
  const CLOCK = {
    cday: { gap: DAYS, name: "Day start" },
    cweek: { gap: 7 * DAYS, name: "Week open" },
    cmonth: { gap: 28 * DAYS, name: "Month open" },
    funding: { gap: DAYS / 3, name: "Funding" },
    usopen: { gap: DAYS, name: "US equity open" },
    cme: { gap: (49 * HOUR), name: "CME" },
    deribit: { gap: 7 * DAYS, name: "Deribit expiry" },
  };
  function clockEvents(kind, a, b) {
    const out = [],
      d0 = Math.max(0, Math.floor(a / DAYS) - 1),
      d1 = Math.ceil(b / DAYS) + 1,
      push = (t, what, weight = 1) => {
        if (t >= a && t <= b) out.push({ kind, t, what, weight });
      };
    if (kind === "cmonth") {
      for (let k = monthOf(Math.max(0, a)); monthStart(k) <= b; k++) push(monthStart(k), "Month open");
      return out;
    }
    if (kind === "cweek") {
      for (let w = Math.max(1, weekOf(d0)); weekStart(w) <= b; w++) push(weekStart(w), "Week open");
      return out;
    }
    for (let d = d0; d < d1; d++) {
      const t = d * DAYS,
        at = date(t),
        y = at.getUTCFullYear(),
        month = at.getUTCMonth(),
        dom = at.getUTCDate(),
        wd = at.getUTCDay();
      if (kind === "cday") push(t, "Day start");
      else if (kind === "funding") for (const h of [0, 8, 16]) push(t + h * HOUR, "Funding");
      else if (kind === "usopen") {
        if (wd >= 1 && wd <= 5) push(t + (usDaylight(y, month, dom) ? 13.5 : 14.5) * HOUR, "US equity open");
      } else if (kind === "cme") {
        const summer = usDaylight(y, month, dom);
        if (wd === 5) push(t + (summer ? 21 : 22) * HOUR, "CME close");
        if (wd === 0) push(t + (summer ? 22 : 23) * HOUR, "CME reopen");
      } else if (kind === "deribit" && wd === 5) {
        const monthly = dom === lastFriday(y, month),
          quarterly = monthly && month % 3 === 2;
        push(t + 8 * HOUR, quarterly ? "Quarterly expiry" : monthly ? "Monthly expiry" : "Weekly expiry", quarterly ? 3 : monthly ? 2 : 1);
      }
    }
    return out;
  }
  // The CME gap (live): for each weekend, the spot price at the Friday close
  // and at the Sunday reopen (each the last trade before it, the close of the
  // hour that ends there), shaded from the reopen until a later trade reaches
  // the Friday close, to the end of the hour it does. From hourly bars; kept
  // with them.
  const gapMemo = new WeakMap();
  function cmeGaps(series) {
    let hit = gapMemo.get(series);
    if (hit) return hit;
    const bars = series.bars,
      step = series.step,
      // Block minima and maxima, 64 bars each, to find the first bar after a
      // reopen that reaches a price without walking every bar.
      B = 64,
      lows = [],
      highs = [];
    for (let i = 0; i < bars.length; i += B) {
      let lo = Infinity,
        hi = -Infinity;
      for (let k = i; k < Math.min(bars.length, i + B); k++) {
        lo = Math.min(lo, bars[k].low);
        hi = Math.max(hi, bars[k].high);
      }
      lows.push(lo);
      highs.push(hi);
    }
    const index = (t) => {
        // The first bar starting at or after t.
        let lo = 0,
          hi = bars.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (bars[mid].c * step < t) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      },
      // The spot price at t: the close of the last bar before it.
      spot = (t) => {
        const i = index(t) - 1;
        return i >= 0 ? bars[i] : null;
      },
      reaches = (x, price, up) => (up ? x.low <= price : x.high >= price),
      firstReach = (i, price, up) => {
        while (i < bars.length) {
          if (i % B === 0 && i + B <= bars.length) {
            const b = i / B;
            if (!(up ? lows[b] <= price : highs[b] >= price)) {
              i += B;
              continue;
            }
          }
          if (reaches(bars[i], price, up)) return i;
          i++;
        }
        return -1;
      },
      out = [],
      events = clockEvents("cme", 0, series.end);
    for (let i = 0; i + 1 < events.length; i++) {
      const close = events[i],
        open = events[i + 1];
      if (close.what !== "CME close" || open.what !== "CME reopen" || open.t > series.end) continue;
      const before = spot(close.t),
        after = spot(open.t);
      if (!before || !after || before.c * step + step < close.t - DAYS) continue;
      const fri = before.close,
        sun = after.close;
      if (fri === sun) continue;
      const up = sun > fri,
        j = firstReach(index(open.t), fri, up);
      out.push({
        close: close.t,
        open: open.t,
        fri,
        sun,
        lo: Math.min(fri, sun),
        hi: Math.max(fri, sun),
        filled: j >= 0 ? Math.min((bars[j].c + 1) * step, series.end) : null,
      });
    }
    hit = out;
    gapMemo.set(series, hit);
    return hit;
  }
  // Structure (live), from the 8-hour bars' days and the 4-hour bars, up to
  // the data's edge. The all-time high is the highest trade. The prior cycle
  // high is the highest price before the last deep low, a fall of more than
  // half from the highest price before it, that came before the all-time high.
  // Swings come from the ATR zigzag, on the 4-hour bars with the 4-hour ATR
  // and on the daily bars with the daily ATR (14 bars, Wilder's): it follows
  // the running extreme since the last swing, and once a bar reverses from it
  // by more than 3 × the ATR as of the bar before, the extreme is a swing,
  // timestamped at its bar and confirmed at the bar that reversed. A bar that
  // makes a new extreme doesn't also confirm a reversal from it; before the
  // first swing, the first reversal from either extreme sets the direction,
  // the high's on a tie. Two consecutive swing highs, or lows, of one
  // timeframe within 125 USDT of each other are equal. A retracement
  // measures 0.382, 0.5 and 0.618 of a move back from its later extreme: the
  // move between the highest high and the lowest low of the last 30 or 90
  // sessions, or between the last two daily swings. Computed once per data
  // change; in replay nothing after the edge is read.
  const SWING_REACH = 3,
    RETRACEMENTS = [0.382, 0.5, 0.618],
    // The lines built on 4-hour bars.
    FOUR_HOUR_LINES = ["swing4h"],
    // The lines built on the days of the 8-hour bars, beside the session levels.
    STRUCTURE_LINES = ["ath", "pch", "swing1d", "fib30", "fib90", "fibswing", "svwap", "avwaph", "avwapl"];
  // An ATR by bar: Wilder's smoothing of the true range over 14 bars, from
  // the list's first, as the daily ATR (NaN before the 14th bar).
  function atrSeries(list, length = 14) {
    const out = new Float64Array(list.length).fill(NaN);
    let sum = 0,
      atr = NaN;
    for (let i = 0; i < list.length; i++) {
      const x = list[i],
        p = i ? list[i - 1] : null,
        tr = p ? Math.max(x.high - x.low, Math.abs(x.high - p.close), Math.abs(x.low - p.close)) : x.high - x.low;
      if (i < length) {
        sum += tr;
        if (i === length - 1) atr = sum / length;
      } else atr = ((length - 1) * atr + tr) / length;
      out[i] = atr;
    }
    return out;
  }
  // The ATR zigzag over a list of bars, with the ATR by bar: each swing's
  // kind, its bar (i), its price and the bar that confirmed it (ci).
  function zigzag(list, atr) {
    const swings = [];
    let i0 = 1;
    while (i0 < list.length && !(atr[i0 - 1] > 0)) i0++;
    if (i0 >= list.length) return swings;
    let mode = 0,
      hi = list[i0].high,
      hiI = i0,
      lo = list[i0].low,
      loI = i0;
    const high = (i) => {
        swings.push({ kind: "high", i: hiI, price: hi, ci: i });
        mode = -1;
        lo = list[i].low;
        loI = i;
      },
      low = (i) => {
        swings.push({ kind: "low", i: loI, price: lo, ci: i });
        mode = 1;
        hi = list[i].high;
        hiI = i;
      };
    for (let i = i0 + 1; i < list.length; i++) {
      const x = list[i],
        reach = SWING_REACH * atr[i - 1];
      if (mode === 1) {
        if (x.high > hi) {
          hi = x.high;
          hiI = i;
        } else if (hi - x.low > reach) high(i);
      } else if (mode === -1) {
        if (x.low < lo) {
          lo = x.low;
          loI = i;
        } else if (x.high - lo > reach) low(i);
      } else {
        const newHigh = x.high > hi,
          newLow = x.low < lo;
        if (newHigh) {
          hi = x.high;
          hiI = i;
        }
        if (newLow) {
          lo = x.low;
          loI = i;
        }
        if (!newHigh && hi - x.low > reach) high(i);
        else if (!newLow && x.high - lo > reach) low(i);
      }
    }
    return swings;
  }
  // The first bar from `from` on whose high is above a price (or, below, whose
  // low is under it), by 64-bar blocks of highs and lows; -1 when none is.
  function blockExtremes(list) {
    const B = 64,
      highs = [],
      lows = [];
    for (let i = 0; i < list.length; i += B) {
      let h = -Infinity,
        l = Infinity;
      for (let k = i; k < Math.min(list.length, i + B); k++) {
        h = Math.max(h, list[k].high);
        l = Math.min(l, list[k].low);
      }
      highs.push(h);
      lows.push(l);
    }
    return (from, price, above) => {
      for (let i = from; i < list.length; ) {
        if (i % B === 0 && i + B <= list.length && !(above ? highs[i / B] > price : lows[i / B] < price)) {
          i += B;
          continue;
        }
        if (above ? list[i].high > price : list[i].low < price) return i;
        i++;
      }
      return -1;
    };
  }
  // A list's bars with where each starts and ends: days from the calendar
  // (the 8-hour bar holding each one's high and low), or bars of a timeframe.
  function swingsOf(list, atr, endOf, extremeAt, end) {
    const beyond = blockExtremes(list),
      out = zigzag(list, atr).map((s) => {
        const j = beyond(s.ci + 1, s.price, s.kind === "high");
        return {
          ...s,
          t: extremeAt(list[s.i], s.kind),
          confirmed: Math.min(endOf(list[s.ci]), end),
          broken: j < 0 ? null : Math.min(endOf(list[j]), end),
        };
      });
    // Equal highs and lows: consecutive ones of a kind within one 125 USDT row.
    const last = {};
    for (const s of out) {
      const was = last[s.kind];
      if (was && Math.abs(s.price - was.price) <= PR) s.equal = was;
      last[s.kind] = s;
    }
    return out;
  }
  const structureMemo = new WeakMap();
  function structure(series9, series8) {
    let hit = structureMemo.get(series9);
    if (hit && hit.series8 === series8) return hit.out;
    const cal = barCalendar(series9),
      days = cal.days.list,
      end = series9.end,
      // The 8-hour bar in a day holding its high or low: its start.
      partAt = (day, kind) => {
        const part = day.parts.find((x) => (kind === "high" ? x.high === day.high : x.low === day.low));
        return part.c * series9.step;
      },
      out = { end, days: cal.days };
    // The all-time high, and the prior cycle high before it.
    let ath = null;
    for (const day of days) if (!ath || day.high > ath.high) ath = day;
    if (ath) {
      out.ath = { price: ath.high, t: partAt(ath, "high"), day: ath };
      let peak = null,
        deep = null;
      for (const day of days) {
        if (day === ath) break;
        if (peak && day.low < 0.5 * peak.high) deep = { day, peak };
        if (!peak || day.high > peak.high) peak = day;
      }
      if (deep) out.pch = { price: deep.peak.high, t: partAt(deep.peak, "high"), day: deep.peak, low: deep.day };
    }
    // Daily swings on the days, with the daily ATR, and 4-hour swings on the 4-hour bars.
    out.daily = swingsOf(days, atrSeries(days), (d) => d.z, partAt, end);
    if (series8?.state === "ready") {
      const step = series8.step,
        bars = series8.bars;
      out.fourHour = swingsOf(bars, atrSeries(bars), (x) => (x.c + 1) * step, (x) => x.c * step, series8.end);
    }
    // Retracements: the moves over the last 30 and 90 sessions, and the last daily swing.
    const dNow = Math.floor(Math.max(0, end - 1e-6) / DAYS),
      lookback = (count) => {
        const span = days.filter((d) => d.k > dNow - count && d.k <= dNow);
        if (!span.length) return null;
        let hi = span[0],
          lo = span[0];
        for (const d of span) {
          if (d.high > hi.high) hi = d;
          if (d.low < lo.low) lo = d;
        }
        const tH = partAt(hi, "high"),
          tL = partAt(lo, "low");
        // Both in one 8-hour bar: the bar's own direction orders them.
        const bar = tH === tL ? hi.parts.find((x) => x.c * series9.step === tH) : null,
          upward = bar ? bar.close >= bar.open : tL < tH;
        return upward
          ? { from: { price: lo.low, t: tL }, to: { price: hi.high, t: tH }, days: count }
          : { from: { price: hi.high, t: tH }, to: { price: lo.low, t: tL }, days: count };
      };
    out.fib30 = lookback(30);
    out.fib90 = lookback(90);
    const confirmed = out.daily;
    if (confirmed.length >= 2) {
      const [a, b] = confirmed.slice(-2);
      out.fibswing = { from: { price: a.price, t: a.t }, to: { price: b.price, t: b.t }, swing: b };
    }
    for (const key of ["fib30", "fib90", "fibswing"]) {
      const m = out[key];
      if (m) m.levels = RETRACEMENTS.map((f) => ({ f, price: m.to.price - f * (m.to.price - m.from.price) }));
    }
    structureMemo.set(series9, { series8, out });
    return out;
  }
  // The structure the lines on draw from, with the 4-hour swings while they
  // are on: every caller asks the same way, so it is computed once.
  function structureNow(series9) {
    return structure(series9, S.lines.includes("swing4h") ? barSeries(8) : null);
  }
  // VWAPs (live): Σ USDT ÷ Σ BTC, from the cube's volume and base volume. The
  // session VWAP starts at each 00:00 UTC; an anchored one at the start of
  // the 8-hour bar that holds the last daily swing high or low, or at a chosen
  // day's 00:00 UTC. Each is summed at the bars the view is drawn at, the
  // finest grid timeframe whose bars are at least 2 px wide, over the view's
  // days; the part of an anchored one before the view is summed from 8-hour
  // bars. The sums carry their rounding error, as the cube's are exact.
  const VWAP_LEVELS = [2, 4, 6, 8, 9],
    isVwapDay = (key) => typeof key === "string" && key.startsWith("vwap:") && isDay(key.slice(5)),
    vwapDayStart = (key) => dayStart(key.slice(5));
  function vwapLevel() {
    const perPx = ((S.tB - S.tA) * BASE) / Math.max(1, G.w);
    return VWAP_LEVELS.find((n) => BASE * 2 ** n >= 2 * perPx) ?? 9;
  }
  // The VWAPs on: the session's, and each anchor.
  function vwapAnchors() {
    const out = [];
    if (!PACK.live) return out;
    if (S.lines.includes("avwaph") || S.lines.includes("avwapl")) {
      const s9 = barSeries(9),
        st = s9.state === "ready" ? structureNow(s9) : null;
      for (const [key, kind] of [
        ["avwaph", "high"],
        ["avwapl", "low"],
      ])
        if (S.lines.includes(key)) {
          let s = null;
          for (let i = (st ? st.daily.length : 0) - 1; i >= 0 && !s; i--) if (st.daily[i].kind === kind) s = st.daily[i];
          out.push({ key, id: key, t: s ? s.t : null, swing: s, state: st ? (s ? "ready" : "none") : s9.state, error: s9.error });
        }
    }
    for (const key of S.lines.filter(isVwapDay)) out.push({ key, id: key, t: vwapDayStart(key), state: "ready" });
    return out;
  }
  // Bars of a timeframe with columns from `a` to `b` (base), once every chunk
  // holding them is read: in replay, complete ones before the edge and the bar
  // at the edge up to it.
  const rangeMemo = new Map();
  function barsBetween(n, a, b) {
    const edge = cutEdge(),
      stop = Math.min(b, edge),
      step = 2 ** n,
      span = BAR_CHUNK * step,
      partial = S.replay && edge % step !== 0 && stop === edge,
      tailKey = [live.generation, n, edge].join("|"),
      key = [n, a, stop, live.generation, edge, S.replay, barsVersion].join("|"),
      hit = rangeMemo.get(key);
    if (hit) return hit;
    let out = { state: "ready", bars: [], end: stop };
    if (stop > a) {
      const chunks = [];
      for (let j = Math.floor(a / span); j * span < stop; j++) chunks.push(barChunks.get(n + "|" + j));
      const tail = partial ? barEdges.get(tailKey) : null;
      if (!chunks.every(Boolean) || (partial && !tail))
        out = { state: barsIssue(n) ? "failed" : "pending", error: barsIssue(n), bars: [] };
      else {
        const bars = [];
        let end = S.replay ? stop : Math.min(stop, chunks[chunks.length - 1].end);
        for (const ch of chunks) {
          const list = ch.bars;
          for (let i = bisectColumn(list, Math.ceil(a / step)); i < list.length; i++) {
            const x = list[i],
              t = x.c * step;
            if (t >= stop) break;
            if (!S.replay || t + step <= edge) bars.push(x);
          }
          if (ch.end < Math.min(ch.z, stop)) end = Math.min(end, ch.end);
        }
        if (tail?.bar && tail.bar.c * step >= a) bars.push(tail.bar);
        if (tail) end = Math.min(end, tail.end);
        out = { state: "ready", bars, end };
      }
    }
    rangeMemo.set(key, out);
    while (rangeMemo.size > 24) rangeMemo.delete(rangeMemo.keys().next().value);
    return out;
  }
  // A VWAP from `anchor` over [from, to): its points at the ends of the bars
  // it is drawn at, and its sums; the part before `from` from 8-hour bars.
  // Kept per anchor, timeframe and span, so a pan reuses it.
  const vwapMemo = new Map();
  function vwapCurve(anchor, n, from, to) {
    const key = [anchor, n, from, to, live.generation, cutEdge(), S.replay, barsVersion].join("|"),
      hit = vwapMemo.get(key);
    if (hit) return hit;
    const out = vwapFrom(anchor, n, from, to);
    if (out.state === "ready") {
      vwapMemo.set(key, out);
      while (vwapMemo.size > 48) vwapMemo.delete(vwapMemo.keys().next().value);
    }
    return out;
  }
  function vwapFrom(anchor, n, from, to) {
    const s9 = barSeries(9);
    if (s9.state !== "ready") return { state: s9.state, error: s9.error };
    const start = Math.max(anchor, Math.floor(from / 512) * 512),
      r = barsBetween(n, start, to);
    if (r.state !== "ready") return r;
    let v = 0,
      q = 0,
      cv = 0,
      cq = 0;
    // Neumaier's sums, as exactSum's.
    const add = (x) => {
      let t = v + x.v;
      cv += Math.abs(v) >= Math.abs(x.v) ? v - t + x.v : x.v - t + v;
      v = t;
      t = q + x.btc;
      cq += Math.abs(q) >= Math.abs(x.btc) ? q - t + x.btc : x.btc - t + q;
      q = t;
    };
    const s9step = s9.step,
      first = bisectColumn(s9.bars, Math.ceil(anchor / s9step));
    for (let i = first; i < s9.bars.length && (s9.bars[i].c + 1) * s9step <= start; i++) add(s9.bars[i]);
    const step = 2 ** n,
      points = [];
    for (const x of r.bars) {
      add(x);
      points.push([Math.min((x.c + 1) * step, r.end), (v + cv) / (q + cq), v + cv, q + cq]);
    }
    return { state: "ready", points, end: r.end };
  }
  // The bars the lines on read beyond the whole timeframes: the VWAPs', at the
  // timeframe they are drawn at, over the view's days.
  function viewBarNeeds() {
    if (!PACK.live || !(S.lines.includes("svwap") || vwapAnchors().length)) return [];
    const n = vwapLevel();
    return n === 9 ? [] : [[n, Math.floor(Math.max(0, S.tA) / DAYS) * DAYS, Math.min(Math.ceil(S.tB / DAYS) * DAYS, cutEdge())]];
  }
  // The row underlay (Rows, U): each price row's value over a period of its
  // own, drawn as bands across the chart behind the cells and as a second
  // profile behind the view's. Volume, Delta and Relative volume come from the
  // POC lines' per-period rows, every 125 USDT row of them kept; Time at price
  // from the period's dwell, read with path and dwell (motion=1) in their
  // second slot. Off by default, and read only while it shows.
  const ROWS = ["off", "volume", "delta", "relvol", "time"],
    ROWS_INFO = {
      off: { name: "Off", desc: "No backdrop behind the cells" },
      volume: { name: "Volume", desc: "USDT traded at each price row over the period" },
      delta: { name: "Delta", desc: "Taker-buy minus taker-sell USDT at each price row over the period" },
      relvol: {
        name: "Relative volume",
        desc: "Each row's share of the view's USDT against its share of the period's, log₂",
      },
      time: { name: "Time at price", desc: "How long the price spent in each row over the period" },
    },
    ROWS_GROUPS = [
      ["Off", ["off"]],
      ["USDT", ["volume", "delta", "relvol"]],
      ["Time", ["time"]],
    ],
    // The periods: the POC lines' and all history, or since a chosen day.
    PERIODS = [...LINE_KEYS, "all"],
    // Time at price needs the live cube's dwell.
    rowsChoices = () => (PACK.live ? ROWS : ROWS.filter((k) => k !== "time")),
    validPeriod = (key) => PERIODS.includes(key) || (isDay(key) && dayStart(key) < CUT),
    periodName = (key) => lineName(key),
    // The period in a sentence: "over the last 90 days", "over this month", "since 3 Mar 2024".
    periodPhrase = (key) => {
      if (key === "all") return "over all history";
      if (isDay(key)) return `since ${day(dayStart(key))}`;
      const info = lineInfo(key);
      return !info.days
        ? `over ${info.name.toLowerCase()}`
        : info.days === 1
          ? "over the last day"
          : info.days === 365
            ? "over the last year"
            : `over the last ${info.name}`;
    },
    // The calendar periods name the month or year they are now.
    periodLabel = (key) =>
      key === "mo" || key === "yr" ? `${lineInfo(key).name} · ${lineTag(key)}` : lineName(key);
  // Time at price: the period's dwell by 125 USDT row, the cube's own, kept per
  // period and span. While a new span is read, the last one read for the
  // period that ends no later than the data shown stands in, as a line's does.
  const dwellResults = new Map(),
    dwellLatest = new Map(),
    dwellId = (span) =>
      ["dwell", live.generation, span[0], span[1], span[1] > Math.floor(CUT) ? CUT : ""].join("|");
  function dwellShown(key) {
    const span = lineSpan(key);
    if (!span) return { key, span: null, state: "none" };
    const id = dwellId(span),
      hit = dwellResults.get(id);
    if (hit) return hit;
    if (motion.failed.has(id)) return { key, span, state: "failed", error: motion.failed.get(id) };
    const was = dwellLatest.get(key);
    return was && was.span[1] <= cutEdge() ? { ...was, stale: true } : { key, span, state: "pending" };
  }
  function underlayDwellWant() {
    if (!PACK.live || S.rows !== "time") return null;
    const key = S.period,
      span = lineSpan(key);
    if (!span || dwellResults.has(dwellId(span))) return null;
    const id = dwellId(span),
      [a, b] = span,
      nq = clamp(Math.ceil(Math.log2(Math.max(1, (b - a) / 16))), 0, 24);
    return {
      key: id,
      path: `/cube/query?n=${nq}&m=0&b0=${a}&b1=${b}&motion=1`,
      decode: async (body) => ({ block: await unpack(body.block, id), body }),
      apply: ({ block, body }) => {
        const q = motionTotals(motionSummary(block.cells, nq, 0)),
          result = { key, span, state: "ready", exact: true, rowPrice: 1, rows: q.rows, w: body.summary.dwell, end: body.end };
        dwellResults.set(id, result);
        dwellLatest.set(key, result);
        while (dwellResults.size > 24) dwellResults.delete(dwellResults.keys().next().value);
      },
    };
  }
  // The underlay's rows at the drawn row size, or at their own where the drawn
  // rows are finer (the recorded snapshot's 1,000 USDT rows): each band's USDT,
  // taker-buy USDT and dwell, the peaks each is scaled to, and the period's POC
  // and 70% value area. Kept with the rows, per row size.
  const bandsMemo = new WeakMap();
  function underlayBands(res, m) {
    const own = Math.round(Math.log2(res.rowPrice || 1)),
      bm = Math.max(m, own);
    let byRows = bandsMemo.get(res.rows);
    if (!byRows) bandsMemo.set(res.rows, (byRows = new Map()));
    const hit = byRows.get(bm);
    if (hit) return hit;
    const k = 2 ** (bm - own),
      map = new Map();
    for (const x of res.rows) {
      const r = Math.floor(x.r / k);
      let band = map.get(r);
      if (!band) map.set(r, (band = { r, v: 0, bv: 0, w: 0 }));
      band.v += x.v || 0;
      band.bv += x.bv || 0;
      band.w += x.w || 0;
    }
    const rows = [...map.values()].sort((a, b) => a.r - b.r);
    let v = 0,
      w = 0,
      vmax = 0,
      dmax = 0,
      wmax = 0,
      poc = null;
    for (const x of rows) {
      v += x.v;
      w += x.w;
      if (x.v > vmax) {
        vmax = x.v;
        poc = x.r;
      }
      dmax = Math.max(dmax, Math.abs(2 * x.bv - x.v));
      wmax = Math.max(wmax, x.w);
    }
    const bands = { m: bm, rows, map, v, w, vmax, dmax, wmax, poc, va: contiguousArea(rows, poc, v) };
    byRows.set(bm, bands);
    return bands;
  }
  // Relative volume: log2 of a row's share of the rectangle's USDT (the
  // selection's, or the view's) over its share of the period's, at the bands'
  // row size. A row the period traded but the rectangle didn't is −2; a row the
  // period never traded has none. Kept for the last rectangle.
  const relMemo = new WeakMap();
  function relativeVolume(bands, query) {
    const hit = relMemo.get(bands);
    if (hit?.query === query) return hit.values;
    const k = 2 ** Math.max(0, bands.m - (query.m ?? renderM())),
      rect = new Map(),
      values = new Map();
    for (const x of query.rows) {
      const r = Math.floor(x.r / k);
      rect.set(r, (rect.get(r) || 0) + x.v);
    }
    if (query.v > 0 && bands.v > 0)
      for (const x of bands.rows) {
        if (!(x.v > 0)) continue;
        const shareP = x.v / bands.v,
          shareV = (rect.get(x.r) || 0) / query.v;
        values.set(x.r, shareV > 0 ? { value: Math.log2(shareV / shareP), shareV, shareP } : { value: -2, shareV: 0, shareP, none: true });
      }
    relMemo.set(bands, { query, values });
    return values;
  }
  // What the underlay shows this frame, or null while it is off: its rows (the
  // lines' for the period, or Time at price's dwell), their bands at the drawn
  // row size, and the volume bands its POC, value area and relative volume
  // come from. Relative volume waits for the rectangle's own measures.
  function underlayFrame(meas) {
    if (S.rows === "off") return null;
    const kind = S.rows,
      m = renderM(),
      vol = lineShown(S.period),
      res = kind === "time" ? dwellShown(S.period) : vol,
      volBands = vol.state === "ready" && vol.rows ? underlayBands(vol, m) : null,
      bands = kind === "time" ? (res.state === "ready" && res.rows ? underlayBands(res, m) : null) : volBands,
      rect = meas.state === "pending" || meas.state === "failed" ? null : meas.query;
    return { kind, period: S.period, vol, res, bands, volBands, rect };
  }
  // The horizontal lines on, as drawn this frame: each with its key and its
  // own id, the family and tier it is drawn in, its price (base rows), its
  // span, whether it goes on dashed to the right edge, and its tag. A
  // per-day, per-week or per-month line draws only while its days, weeks or
  // months are at least 6 px apart on screen, all but the one in effect at
  // the data's edge, which goes on to the right edge with its tag.
  const spaced = (gap) => (gap * G.w) / Math.max(1e-9, S.tB - S.tA) >= 6,
    // The loaded blocks, as far as a day's profile reads them.
    sourcesKey = () => Object.values(sources).map((s) => s.id + ":" + s.cells.length).join(",") + "|" + (referenceView?.cells.length ?? ""),
    itemsMemo = new Map();
  function cachedItems(name, key, make) {
    const hit = itemsMemo.get(name);
    if (hit?.key === key) return hit.items;
    const items = make();
    itemsMemo.set(name, { key, items });
    return items;
  }
  function lineItems(cut) {
    const items = [],
      on = new Set(S.lines),
      dNow = Math.floor(Math.max(0, cut - 1e-6) / DAYS),
      tag = (name, value, approx = false) => ({ name, value: (approx ? "≈ " : "") + price(value * PR) });
    for (const key of periodLines()) {
      const r = lineShown(key);
      if (r.state !== "ready" || r.row === null) continue;
      const tier = lineTier(key),
        at = (r.row + 0.5) * r.rowPrice,
        span = [r.span[0], Math.min(r.span[1], cut)];
      items.push({
        key,
        id: key,
        kind: "poc",
        family: "poc",
        tier,
        at,
        from: span[0],
        to: span[1],
        on: true,
        r,
        tag: tag(lineTag(key), at, !r.exact),
      });
      const va = on.has("va") ? periodArea(r) : null;
      if (va)
        for (const [edge, side] of [
          [va.r1 * r.rowPrice, "VAH"],
          [va.r0 * r.rowPrice, "VAL"],
        ])
          items.push({
            key: "va",
            id: `va|${key}|${side}`,
            kind: "va",
            side,
            period: key,
            family: "poc",
            tier,
            at: edge,
            from: span[0],
            to: span[1],
            on: true,
            weight: 0.65,
            r,
            va,
            tag: tag(`${lineTag(key)} ${side}`, edge, !r.exact),
          });
    }
    // The rest changes only with the data and the days in view.
    if (!S.lines.some((k) => DATED_LINES.has(k) || isVwapDay(k))) return items;
    const data = [live.generation, CUT, cut, barsVersion, dayReads.size, sourcesKey()].join("|"),
      d0 = Math.max(0, Math.floor(S.tA / DAYS)),
      d1 = Math.min(dNow, Math.floor(S.tB / DAYS)),
      wide = [DAYS, 7 * DAYS, 28 * DAYS].map(spaced),
      view = [data, d0, d1, wide].join("|");
    if (on.has("dpoc")) items.push(...cachedItems("dpoc", view, () => dayItems(cut, dNow, d0, d1, wide[0], tag)));
    if (on.has("udpoc") || on.has("uwpoc"))
      items.push(...cachedItems("untested", [data, on.has("udpoc"), on.has("uwpoc")].join("|"), () => untestedItems(on)));
    const session = ["dopen", "pdhlc", "wopen", "mopen"].filter((k) => on.has(k));
    if (session.length)
      items.push(...cachedItems("session", [view, session].join("|"), () => sessionItems(cut, dNow, session, wide, tag)));
    if (STRUCTURE_ROWS.some((k) => on.has(k))) {
      const st = structureItems(cut, on, tag);
      items.push(...st);
      items.marks = st.marks;
    }
    if (on.has("svwap") || S.lines.some((k) => k === "avwaph" || k === "avwapl" || isVwapDay(k))) items.curves = vwapCurves(cut);
    return items;
  }
  // The lines drawn from the days of the bars, and structure's rows.
  const STRUCTURE_ROWS = ["ath", "pch", "swing1d", "swing4h", "fib30", "fib90", "fibswing"],
    DATED_LINES = new Set(["dpoc", "udpoc", "uwpoc", ...EIGHT_HOUR_LINES, ...STRUCTURE_LINES, ...FOUR_HOUR_LINES]);
  // A period's 70% value area, kept with its rows.
  const areaMemo = new WeakMap();
  function periodArea(r) {
    if (!areaMemo.has(r.rows)) areaMemo.set(r.rows, contiguousArea(r.rows, r.row, r.total));
    return areaMemo.get(r.rows);
  }
  // Each day's POC and value area in view, while days are far enough apart,
  // and the latest day's, which goes on to the right edge with its tags.
  function dayItems(cut, dNow, d0, d1, wide, tag) {
    const items = [],
      days = [];
    if (wide) for (let d = d0; d <= d1; d++) days.push(d);
    if (!days.includes(dNow)) days.push(dNow);
    for (const d of days) {
      const latest = d === dNow,
        p = dayProfile(d);
      if (p.state !== "ready" || p.poc === null) continue;
      const from = d * DAYS,
        to = Math.min((d + 1) * DAYS, cut);
      items.push({
        key: "dpoc",
        id: `dpoc|${d}`,
        kind: "dpoc",
        side: "POC",
        d,
        p,
        family: "poc",
        tier: "short",
        at: p.poc + 0.5,
        from,
        to,
        on: latest,
        tag: latest ? tag("Day POC", p.poc + 0.5) : null,
      });
      if (p.va)
        for (const [edge, side] of [
          [p.va.r1, "VAH"],
          [p.va.r0, "VAL"],
        ])
          items.push({
            key: "dpoc",
            id: `dpoc|${d}|${side}`,
            kind: "dpoc",
            side,
            d,
            p,
            family: "poc",
            tier: "short",
            at: edge,
            from,
            to,
            on: latest,
            weight: 0.65,
            tag: latest ? tag(`Day ${side}`, edge) : null,
          });
    }
    return items;
  }
  // The untested POCs: each from its day or week, on to the right edge,
  // tagged with its age and distance.
  function untestedItems(on) {
    const items = [];
    for (const [key, kind] of [
      ["udpoc", "day"],
      ["uwpoc", "week"],
    ]) {
      if (!on.has(key)) continue;
      const list = untestedList(kind);
      for (const u of list.items || [])
        items.push({
          key,
          id: `${key}|${u.k}`,
          kind: "untested",
          u,
          list,
          family: "poc",
          tier: "short",
          at: u.price / PR,
          from: u.from,
          to: u.to,
          on: true,
          tag: {
            name: `${kind === "day" ? "uPOC" : "uwPOC"} ${u.age}${kind === "day" ? "d" : "w"}`,
            value: `${price(u.price)} · ${signed(u.atrs, (x) => x.toFixed(1))} ATR · ${signed(u.usd, (x) => price(Math.round(x)))}`,
          },
        });
    }
    return items;
  }
  // The session levels in view: each day's open and its previous day's high,
  // low and close, each week's and month's open, while they are far enough
  // apart, and the latest of each, on to the right edge with its tag.
  function sessionItems(cut, dNow, keys, wide, tag) {
    const series = barSeries(9);
    if (series.state !== "ready") return [];
    const items = [],
      cal = barCalendar(series),
      end = Math.min(cut, series.end),
      // The days, weeks or months in view, or else only the latest.
      inView = (list, apart, now) =>
        apart ? list.filter((g) => g.z > S.tA && g.t < Math.min(S.tB, cut)) : list.filter((g) => g.k === now),
      withLatest = (list, all, now) => (list.some((g) => g.k === now) ? list : list.concat(all.filter((g) => g.k === now)));
    if (keys.includes("dopen") || keys.includes("pdhlc"))
      for (const day of withLatest(inView(cal.days.list, wide[0], dNow), cal.days.list, dNow)) {
        const latest = day.k === dNow;
        if (keys.includes("dopen"))
          items.push({
            key: "dopen",
            id: `dopen|${day.k}`,
            kind: "open",
            g: day,
            span: "day",
            family: "level",
            tier: "short",
            at: day.open / PR,
            from: day.t,
            to: Math.min(day.z, end),
            on: latest,
            tag: latest ? tag("Day open", day.open / PR) : null,
          });
        const prev = cal.days.by.get(day.k - 1);
        if (keys.includes("pdhlc") && prev?.whole)
          for (const [value, side, name] of [
            [prev.high, "high", "PDH"],
            [prev.low, "low", "PDL"],
            [prev.close, "close", "PDC"],
          ])
            items.push({
              key: "pdhlc",
              id: `pdhlc|${day.k}|${side}`,
              kind: "prev",
              side,
              g: day,
              prev,
              family: "level",
              tier: "short",
              at: value / PR,
              from: day.t,
              to: Math.min(day.z, end),
              on: latest,
              weight: side === "close" ? 0.75 : 1,
              tag: latest ? tag(name, value / PR) : null,
            });
      }
    if (keys.includes("wopen")) {
      const now = weekOf(dNow);
      for (const week of withLatest(inView(cal.weeks.list, wide[1], now), cal.weeks.list, now)) {
        const latest = week.k === now;
        items.push({
          key: "wopen",
          id: `wopen|${week.k}`,
          kind: "open",
          g: week,
          span: "week",
          family: "level",
          tier: "short",
          at: week.open / PR,
          from: Math.max(0, week.t),
          to: Math.min(week.z, end),
          on: latest,
          tag: latest ? tag("Week open", week.open / PR) : null,
        });
      }
    }
    if (keys.includes("mopen")) {
      const now = monthOf(Math.max(0, cut - 1e-6));
      for (const month of withLatest(inView(cal.months.list, wide[2], now), cal.months.list, now)) {
        const latest = month.k === now;
        items.push({
          key: "mopen",
          id: `mopen|${month.k}`,
          kind: "open",
          g: month,
          span: "month",
          family: "level",
          tier: "medium",
          at: month.open / PR,
          from: month.t,
          to: Math.min(month.z, end),
          on: latest,
          tag: latest ? tag(`${d3.utcFormat("%b")(date(month.t))} open`, month.open / PR) : null,
        });
      }
    }
    return items;
  }
  // Structure's lines: the all-time and prior cycle highs from their time on;
  // each swing from its extreme, dotted until it is confirmed, then solid
  // until a later bar trades through it, or on to the right edge while none
  // has, tagged while its price is in view; the retracements from their
  // move's later extreme on. While a row's swings in view would be closer
  // than 12 px apart on average, only its unbroken ones draw. Swings mark
  // their extreme, and equal highs and lows are joined.
  function structureItems(cut, on, tag) {
    const s9 = barSeries(9);
    if (s9.state !== "ready") return [];
    const st = structureNow(s9),
      items = [],
      marks = [],
      end = Math.min(cut, st.end);
    for (const [key, x, name] of [
      ["ath", st.ath, "ATH"],
      ["pch", st.pch, "PCH"],
    ])
      if (on.has(key) && x)
        items.push({
          key,
          id: key,
          kind: "peak",
          x,
          family: "level",
          tier: "long",
          at: x.price / PR,
          from: x.t,
          to: end,
          on: true,
          tag: tag(name, x.price / PR),
        });
    for (const [key, list, frame] of [
      ["swing1d", st.daily, "1D"],
      ["swing4h", st.fourHour, "4h"],
    ]) {
      if (!on.has(key) || !list) continue;
      const shown = list.filter((s) => s.confirmed <= end && (s.broken ?? Infinity) > S.tA && s.t < S.tB),
        dense = shown.length > G.w / 12;
      for (const s of shown) {
        if (dense && s.broken !== null) continue;
        const name = `${frame} ${s.kind === "high" ? "high" : "low"}`,
          seen = s.price / PR >= S.pA && s.price / PR <= S.pB;
        items.push({
          key,
          id: `${key}|${s.i}`,
          kind: "swing",
          s,
          frame,
          family: "level",
          tier: "short",
          at: s.price / PR,
          lead: s.t,
          from: s.confirmed,
          to: s.broken ?? end,
          on: s.broken === null,
          tag: s.broken === null && seen ? tag(name, s.price / PR) : null,
        });
        marks.push({ s, key, frame, size: key === "swing1d" ? 5 : 3.5 });
      }
    }
    for (const [key, name] of [
      ["fib30", "30D"],
      ["fib90", "90D"],
      ["fibswing", "Swing"],
    ]) {
      const m = on.has(key) ? st[key] : null;
      if (!m) continue;
      for (const level of m.levels)
        items.push({
          key,
          id: `${key}|${level.f}`,
          kind: "fib",
          m,
          f: level.f,
          name,
          family: "level",
          tier: "medium",
          at: level.price / PR,
          from: m.to.t,
          to: end,
          on: true,
          weight: level.f === 0.5 ? 0.85 : 0.7,
          tag: tag(`${name} ${(level.f * 100).toFixed(1)}%`, level.price / PR),
        });
    }
    items.marks = marks;
    return items;
  }
  // The VWAPs on, as curves over the view: the session VWAP each day in view
  // while days are far enough apart, and else only the last day in view's;
  // each anchored one from its anchor. A curve that reaches the latest data
  // goes on to the right edge at its latest value, tagged.
  // An anchored VWAP's name and tag, kept: they are drawn every frame.
  const anchorMemo = new Map();
  function anchorNames(a) {
    const key = a.key + "|" + a.t;
    let hit = anchorMemo.get(key);
    if (!hit) {
      hit = {
        name: a.key === "avwaph" ? "VWAP from the last daily swing high" : a.key === "avwapl" ? "VWAP from the last daily swing low" : `VWAP from ${day(a.t)}`,
        tag: a.key === "avwaph" ? "aVWAP H" : a.key === "avwapl" ? "aVWAP L" : `aVWAP ${dayOf(date(a.t))}`,
      };
      anchorMemo.set(key, hit);
      while (anchorMemo.size > 32) anchorMemo.delete(anchorMemo.keys().next().value);
    }
    return hit;
  }
  function vwapCurves(cut) {
    const out = [],
      n = vwapLevel(),
      stop = Math.min(S.tB, cut),
      dNow = Math.floor(Math.max(0, cut - 1e-6) / DAYS);
    if (S.lines.includes("svwap")) {
      const d0 = Math.max(0, Math.floor(S.tA / DAYS)),
        d1 = Math.floor(Math.max(0, stop - 1e-6) / DAYS),
        days = [];
      for (let d = spaced(DAYS) ? d0 : d1; d <= d1; d++) days.push(d);
      for (const d of days) {
        const t = d * DAYS,
          r = vwapCurve(t, n, t, Math.min(t + DAYS, cut));
        if (r.state !== "ready" || !r.points.length) continue;
        const latest = d === dNow && stop >= cut;
        out.push({ key: "svwap", id: `svwap|${d}`, name: "Session VWAP", anchor: t, day: d, r, tier: "short", on: latest, tag: latest ? "VWAP" : null });
      }
    }
    // An anchored curve spans the chunks of bars the view is in.
    const span = BAR_CHUNK * 2 ** n,
      from = Math.floor(Math.max(0, S.tA) / span) * span,
      to = Math.min(cut, Math.ceil(S.tB / span) * span);
    for (const a of vwapAnchors()) {
      if (a.state !== "ready" || a.t === null || a.t >= stop) continue;
      const r = vwapCurve(a.t, n, Math.max(a.t, from), to);
      if (r.state !== "ready" || !r.points.length) continue;
      const { name, tag } = anchorNames(a);
      out.push({ key: a.key, id: a.id, name, anchor: a.t, swing: a.swing, r, tier: isVwapDay(a.key) ? lineTier(a.key) : "medium", on: stop >= cut, tag });
    }
    return out;
  }
  // The lines, their tags and the level line. Longer spans are drawn first,
  // so shorter ones lie on top; each line is haloed in the surface colour to
  // stand clear of the cells under it. Lines of one look go in one stroke:
  // a wide view draws a line a day. A swing's lead, from its extreme to its
  // confirmation, is dotted, and its extreme marked; equal highs and lows are
  // joined; the VWAPs are curves, one point to a pixel column.
  let lineHits = [];
  function drawLines(cut) {
    if (lineHits.length) lineHits = [];
    if (!S.lines.length && S.level === null) return;
    const items = lineItems(cut),
      marks = items.marks || [],
      curves = items.curves || [];
    if (!items.length && !curves.length && S.level === null) return;
    const right = G.x + G.w,
      halo = new Map(),
      ticks = [],
      strokes = new Map(),
      stroke = (colour, width, dash, alpha, x1, y, x2) => {
        const k = [colour, width, dash, alpha].join("|");
        let s = strokes.get(k);
        if (!s) strokes.set(k, (s = { colour, width, dash, alpha, segs: [] }));
        s.segs.push(x1, y, x2);
      },
      haloAt = (w, x1, y, x2) => {
        if (!halo.has(w)) halo.set(w, []);
        halo.get(w).push(x1, y, x2);
      };
    items.sort((a, b) => b.to - b.from - (a.to - a.from));
    for (const l of items) {
      const style = lineStyle(l.family, l.tier),
        hot = hover?.line === l.id,
        width = style.width * (l.weight || 1) + (hot ? 1 : 0),
        y = Math.round(G.Y(l.at)) + 0.5,
        xa = clamp(G.X(l.from), G.x - 2, right),
        xb = clamp(G.X(l.to), G.x - 2, right),
        xe = l.on ? right : xb,
        xl = l.lead === undefined ? xa : clamp(G.X(l.lead), G.x - 2, right);
      l.colour = style.colour;
      l.y = y;
      // A line off the plot draws nothing, but its tag, at the edge, still names it.
      lineHits.push({ key: l.key, id: l.id, y, xa: xl, xb: xe, item: l, colour: style.colour });
      if (y < G.y - 4 || y > G.y + G.h + 4 || xe <= G.x) continue;
      // The halo, then the span solid and the rest of the way dashed.
      haloAt(width + 3, xl, y, xe);
      if (xa > xl) stroke(style.colour, Math.max(1, width * 0.8), "1,3", 0.9, xl, y, xa);
      if (xb > xa) stroke(style.colour, width, "", 1, xa, y, xb);
      if (l.on && right > xb) stroke(style.colour, Math.max(1, width * 0.7), "5,4", 0.85, xb, y, right);
      // Where a period starts, when it starts in view.
      if (l.kind === "poc" && G.X(l.from) > G.x + 1 && G.X(l.from) < right - 1) ticks.push([xa, y, style.colour]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(G.x, G.y, G.w, G.h);
    ctx.clip();
    // The VWAPs under the lines: haloed, one point to a pixel column, and on
    // at their latest value to the right edge.
    for (const c of curves) {
      const style = lineStyle("vwap", c.tier),
        hot = hover?.line === c.id,
        xs = [],
        ys = [],
        vals = [];
      let lastX = -Infinity;
      const pts = c.r.points;
      let i0 = 0,
        hi = pts.length;
      while (i0 < hi) {
        const mid = (i0 + hi) >> 1;
        if (pts[mid][0] < S.tA) i0 = mid + 1;
        else hi = mid;
      }
      for (let i = Math.max(0, i0 - 1); i < pts.length; i++) {
        const [t, v] = pts[i],
          x = G.X(t);
        if (x > right + 2) {
          // One point past the edge, so the curve runs to it.
          xs.push(x);
          ys.push(G.Y(v / PR));
          vals.push(v);
          break;
        }
        if (x - lastX < 1 && xs.length) {
          xs[xs.length - 1] = x;
          ys[ys.length - 1] = G.Y(v / PR);
          vals[vals.length - 1] = v;
        } else {
          xs.push(x);
          ys.push(G.Y(v / PR));
          vals.push(v);
        }
        lastX = x;
      }
      if (!xs.length) continue;
      c.colour = style.colour;
      c.at = vals[vals.length - 1] / PR;
      const width = style.width + (hot ? 1 : 0),
        path = () => {
          ctx.beginPath();
          ctx.moveTo(xs[0], ys[0]);
          for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
        };
      ctx.strokeStyle = colors.surface;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = width + 3;
      path();
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = style.colour;
      ctx.lineWidth = width;
      path();
      ctx.stroke();
      if (c.on && xs[xs.length - 1] < right) {
        ctx.setLineDash([5, 4]);
        line(xs[xs.length - 1], ys[ys.length - 1], right, ys[ys.length - 1], style.colour, Math.max(1, width * 0.7), 0.85);
        ctx.setLineDash([]);
      }
      lineHits.push({
        key: c.key,
        id: c.id,
        curve: { xs, ys, vals, points: c.r.points },
        item: c,
        colour: style.colour,
        xa: xs[0],
        xb: c.on ? right : xs[xs.length - 1],
      });
    }
    ctx.strokeStyle = colors.surface;
    ctx.globalAlpha = 0.85;
    for (const [w, segs] of halo) {
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 3) {
        ctx.moveTo(segs[i], segs[i + 1]);
        ctx.lineTo(segs[i + 2], segs[i + 1]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const s of strokes.values()) {
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = s.width;
      ctx.globalAlpha = s.alpha;
      ctx.setLineDash(s.dash ? s.dash.split(",").map(Number) : []);
      ctx.beginPath();
      for (let i = 0; i < s.segs.length; i += 3) {
        ctx.moveTo(s.segs[i], s.segs[i + 1]);
        ctx.lineTo(s.segs[i + 2], s.segs[i + 1]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (const [x, y, colour] of ticks) {
      line(x, y - 5, x, y + 5, colors.surface, 4, 0.85);
      line(x, y - 5, x, y + 5, colour, 2, 1);
    }
    // Swings: a triangle at each extreme, over a high and under a low; equal
    // ones joined, and flagged at the later.
    if (marks.length) {
      const colour = lineStyle("level", "short").colour;
      for (const m of marks) {
        const x = G.X(m.s.t),
          y = G.Y(m.s.price / PR),
          up = m.s.kind === "low",
          k = m.size,
          tip = up ? y + 3 : y - 3;
        if (x < G.x - k || x > right + k) continue;
        if (m.s.equal) {
          const x0 = G.X(m.s.equal.t),
            y0 = G.Y(m.s.equal.price / PR);
          markLine(x0, y0, x, y, colors.surface, 3, 0.85);
          markLine(x0, y0, x, y, colour, 1.2, 1);
          ctx.font = `500 ${TYPE.s}px ${FONT}`;
          chartLabel(m.s.kind === "high" ? "EQH" : "EQL", x + 6, up ? y + 16 : y - 8, colour);
          lineHits.push({ key: m.key, id: `${m.key}|eq|${m.s.i}`, eq: [x0, y0, x, y], item: { kind: "equal", s: m.s, frame: m.frame }, colour });
        }
        ctx.beginPath();
        ctx.moveTo(x, tip);
        ctx.lineTo(x - k, up ? tip + 1.6 * k : tip - 1.6 * k);
        ctx.lineTo(x + k, up ? tip + 1.6 * k : tip - 1.6 * k);
        ctx.closePath();
        ctx.fillStyle = colors.surface;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors.surface;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = colour;
        ctx.fill();
        const base = up ? tip + 1.6 * k : tip - 1.6 * k;
        lineHits.push({
          key: m.key,
          id: `${m.key}|mark|${m.s.i}`,
          mark: [x - k - 2, Math.min(tip, base) - 2, x + k + 2, Math.max(tip, base) + 2],
          item: { kind: "swing", s: m.s, frame: m.frame },
          colour,
        });
      }
    }
    // The level line: dashed across the prices in the neutral text colour, on
    // a halo, unlike the family lines, which are coloured and solid over their span.
    if (S.level !== null) {
      const y = Math.round(G.Y(S.level)) + 0.5;
      ctx.setLineDash([6, 4]);
      line(G.x, y, right, y, colors.surface, 4, 0.8);
      line(G.x, y, right, y, colors.ink, hover?.line === "level" ? 2 : 1.3, 0.9);
      ctx.setLineDash([]);
      lineHits.push({ key: "level", id: "level", y, xa: G.x, xb: right, colour: colors.ink });
    }
    ctx.restore();
    drawLineTags([
      ...items
        .filter((l) => l.tag)
        .map((l) => ({ key: l.id, colour: l.colour, at: l.at, name: l.tag.name, value: l.tag.value })),
      ...curves
        .filter((c) => c.tag && c.colour)
        .map((c) => ({ key: c.id, colour: c.colour, at: c.at, name: c.tag, value: price(c.at * PR) })),
      ...(S.level === null
        ? []
        : [{ key: "level", colour: colors.ink, at: S.level, name: "Level", value: price(S.level * PR) }]),
    ]);
  }
  // Clock lines: vertical, in the clock's neutral colour, each kind with a
  // dash and weight of its own, across the prices, into the future too; each
  // kind draws only while its lines are at least 6 px apart, and the Deribit
  // expiry's monthly and quarterly ones, heavier, while theirs are. Under the
  // horizontal lines. Live, the CME gap is shaded from the reopen until a
  // trade reaches the Friday close.
  const CLOCK_LOOK = {
    cday: { dash: [], width: 1 },
    cweek: { dash: [], width: 1.3 },
    cmonth: { dash: [], width: 1.7 },
    funding: { dash: [1, 3], width: 1 },
    usopen: { dash: [4, 3], width: 1.2 },
    cme: { dash: [7, 2, 1, 2], width: 1.2 },
    deribit: { dash: [2, 2], width: 1 },
  };
  let clockHits = [];
  function drawClock(cut) {
    if (clockHits.length) clockHits = [];
    if (!S.lines.length) return;
    const kinds = S.lines.filter((k) => CLOCK[k]);
    if (!kinds.length) return;
    const colour = lineStyle("clock", "long").colour;
    ctx.save();
    ctx.beginPath();
    ctx.rect(G.x, G.y, G.w, G.h);
    ctx.clip();
    if (kinds.includes("cme") && PACK.live) {
      const s = barSeries(6);
      if (s.state === "ready")
        for (const g of cmeGaps(s)) {
          const x0 = G.X(g.open),
            x1 = G.X(g.filled ?? Math.min(s.end, cut)),
            y0 = G.Y(g.hi / PR),
            y1 = G.Y(g.lo / PR);
          if (x1 < G.x || x0 > G.x + G.w || y1 < G.y || y0 > G.y + G.h) continue;
          ctx.fillStyle = colour;
          ctx.globalAlpha = 0.16;
          ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
          ctx.globalAlpha = 1;
          markLine(x0, y0, x1, y0, colour, 1, 0.7);
          markLine(x0, y1, x1, y1, colour, 1, 0.7);
          clockHits.push({ gap: g, box: [x0, Math.min(y0, y1 - 3), x1, Math.max(y1, y0 + 3)] });
        }
    }
    for (const kind of kinds) {
      const look = CLOCK_LOOK[kind],
        events = spaced(CLOCK[kind].gap)
          ? clockEvents(kind, S.tA, S.tB)
          : kind === "deribit"
            ? clockEvents(kind, S.tA, S.tB).filter((e) => spaced(e.weight === 3 ? 91 * DAYS : 28 * DAYS) && e.weight > 1)
            : [];
      for (const weight of [1, 2, 3]) {
        const drawn = events.filter((e) => (e.weight || 1) === weight);
        if (!drawn.length) continue;
        ctx.strokeStyle = colour;
        ctx.lineWidth = look.width * (weight === 3 ? 2 : weight === 2 ? 1.5 : 1);
        ctx.globalAlpha = 0.6;
        ctx.setLineDash(look.dash);
        ctx.beginPath();
        for (const e of drawn) {
          const x = Math.round(G.X(e.t)) + 0.5;
          ctx.moveTo(x, G.y);
          ctx.lineTo(x, G.y + G.h);
          clockHits.push({ event: e, x });
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // The clock lines under the pointer, all that fall at the nearest one's
  // time (funding at a day's start, an expiry at 08:00), within 3 px; or else
  // the CME gap it is inside.
  function clockAt(p) {
    const near = clockHits.filter((h) => h.event && Math.abs(p.x - h.x) <= 3);
    if (near.length) {
      const t = near.reduce((a, h) => (Math.abs(p.x - h.x) < Math.abs(p.x - a.x) ? h : a)).event.t;
      return { events: near.filter((h) => h.event.t === t).map((h) => h.event) };
    }
    return clockHits.find((h) => h.gap && p.x >= h.box[0] && p.x <= h.box[2] && p.y >= h.box[1] && p.y <= h.box[3]) || null;
  }
  function clockTip(tip, h) {
    if (h.gap) {
      const g = h.gap,
        size = g.hi - g.lo;
      tipRows(
        tip,
        `CME gap · ${price(Math.round(size))} USDT`,
        `${((100 * size) / g.lo).toFixed(2)}% ${g.sun > g.fri ? "up" : "down"} over the weekend`,
        [
          ["Friday close", `${price(g.fri)} USDT · ${when(g.close)} UTC`],
          ["Sunday reopen", `${price(g.sun)} USDT · ${when(g.open)} UTC`],
          ["Traded back", g.filled === null ? "not yet" : `by ${when(g.filled)} UTC`],
        ],
        "The spot price at each: the last trade before it. Shaded until a trade reaches the Friday close",
      );
      return;
    }
    const e = h.events[0];
    tipRows(
      tip,
      h.events.map((x) => x.what).join(" · "),
      `${d3.utcFormat("%a")(date(e.t))} ${when(e.t)} UTC`,
      [],
      h.events.map(clockNote).filter(Boolean),
    );
  }
  function clockNote(e) {
    if (e.kind === "usopen") return "9:30 in New York: 13:30 UTC in US daylight time, 14:30 otherwise";
    if (e.kind === "cme")
      return e.what === "CME close"
        ? "Friday 16:00 in Chicago, where CME's weekend close starts"
        : "Sunday 17:00 in Chicago, when CME reopens for the Monday session";
    if (e.kind === "deribit")
      return e.weight === 3
        ? "Deribit's quarterly expiry: the last Friday of the quarter, 08:00 UTC"
        : e.weight === 2
          ? "Deribit's monthly expiry: the month's last Friday, 08:00 UTC"
          : "Deribit's weekly expiry: Friday, 08:00 UTC";
    if (e.kind === "funding") return "Perpetual funding, every 8 hours from 00:00 UTC";
    return "";
  }
  // Tags at the plot's right edge, one per line, level with it or pushed apart
  // just enough to read, with a leader back to the line; a line above or below
  // the view keeps its tag at that edge, with an arrow. A text's width, and
  // whether a colour takes dark ink, are kept: the tags are drawn every frame.
  const tagWidths = new Map(),
    tagInk = new Map();
  function tagWidth(font, text) {
    const key = font + "|" + text;
    let w = tagWidths.get(key);
    if (w === undefined) {
      if (tagWidths.size > 1024) tagWidths.clear();
      ctx.font = font;
      w = Math.ceil(ctx.measureText(text).width);
      tagWidths.set(key, w);
    }
    return w;
  }
  function drawLineTags(shown) {
    const bold = `500 ${TYPE.s}px ${FONT}`,
      plain = `${TYPE.s}px ${FONT}`;
    ctx.font = bold;
    const right = G.x + G.w - 6,
      pad = 5,
      height = 16,
      transport = el("transport"),
      // Below the Latest button, and the replay's transport when it reaches the
      // right edge, where the tags go.
      top0 = Math.max(
        G.y + 2,
        el("latest").hidden ? 0 : 16 + el("latest").offsetHeight + 4,
        transport.hidden || transport.offsetLeft + transport.offsetWidth < G.x + G.w - 140
          ? 0
          : transport.offsetTop + transport.offsetHeight + 4,
      ),
      tags = shown
        .map((l) => {
          const y = G.Y(l.at),
            off = y < G.y ? -1 : y > G.y + G.h ? 1 : 0,
            name = l.name + (off < 0 ? " ↑" : off > 0 ? " ↓" : ""),
            value = l.value,
            nameW = tagWidth(bold, name) + 2 * pad,
            valueW = tagWidth(plain, value) + 2 * pad;
          return { ...l, y: clamp(y, top0 + height / 2, G.y + G.h - height / 2 - 2), line: y, off, name, value, nameW, valueW };
        })
        .sort((a, b) => a.y - b.y);
    // Apart by a tag's height, top down, then back up from the bottom edge.
    for (let i = 0; i < tags.length; i++)
      tags[i].ty = Math.max(tags[i].y, i ? tags[i - 1].ty + height + 2 : -Infinity);
    for (let i = tags.length - 1; i >= 0; i--)
      tags[i].ty = Math.min(tags[i].ty, i < tags.length - 1 ? tags[i + 1].ty - height - 2 : G.y + G.h - height / 2 - 2);
    // Each tag's line, the first of its id, as a search from the start finds it.
    const hits = new Map();
    for (const h of lineHits) if (!hits.has(h.id)) hits.set(h.id, h);
    if (tags.length) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }
    for (const t of tags) {
      const w = t.nameW + t.valueW,
        x = right - w,
        top = t.ty - height / 2;
      if (Math.abs(t.ty - t.line) > 1 && !t.off) {
        // A leader from the line to its tag.
        line(x - 6, t.line, x, t.ty, t.colour, 1, 0.8);
      }
      ctx.fillStyle = colors.surface;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.roundRect(x, top, w, height, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.colour;
      ctx.beginPath();
      ctx.roundRect(x, top, t.nameW, height, [3, 0, 0, 3]);
      ctx.fill();
      ctx.strokeStyle = t.colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, top + 0.5, w - 1, height - 1, 3);
      ctx.stroke();
      let light = tagInk.get(t.colour);
      if (light === undefined) {
        if (tagInk.size > 256) tagInk.clear();
        tagInk.set(t.colour, (light = d3.lab(t.colour).l > 62));
      }
      ctx.font = bold;
      ctx.fillStyle = light ? "#15191c" : "#fff";
      ctx.fillText(t.name, x + t.nameW / 2, t.ty + 0.5);
      ctx.font = plain;
      ctx.fillStyle = colors.ink;
      ctx.fillText(t.value, x + t.nameW + t.valueW / 2, t.ty + 0.5);
      ctx.globalAlpha = 1;
      labelsTaken.push([x - 3, top - 2, x + w + 3, top + height + 2]);
      const hit = hits.get(t.key);
      if (hit) hit.tag = [x, top, x + w, top + height];
    }
  }
  // The line or tag under the pointer: a tag's box, or within 4 pixels of a
  // line where it is drawn.
  function lineAt(p) {
    const inside = (b) => p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3],
      // A curve's height at the pointer, between its points, or on past its end.
      onCurve = ({ curve: { xs, ys }, xb }) => {
        if (p.x < xs[0] - 2 || p.x > xb) return false;
        let i = 0;
        while (i < xs.length - 1 && xs[i + 1] < p.x) i++;
        const u = i < xs.length - 1 && xs[i + 1] > xs[i] ? clamp((p.x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1) : 0,
          y = i < xs.length - 1 ? ys[i] + u * (ys[i + 1] - ys[i]) : ys[i];
        return Math.abs(p.y - y) <= 4;
      },
      // Within 4 px of the segment joining equal highs or lows.
      nearSegment = ([x0, y0, x1, y1]) => {
        const dx = x1 - x0,
          dy = y1 - y0,
          u = clamp(((p.x - x0) * dx + (p.y - y0) * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
        return Math.hypot(p.x - (x0 + u * dx), p.y - (y0 + u * dy)) <= 4;
      };
    return (
      lineHits.find((h) => h.tag && inside(h.tag)) ||
      lineHits.find((h) => h.mark && inside(h.mark)) ||
      lineHits.find((h) => h.y !== undefined && Math.abs(p.y - h.y) <= 4 && p.x >= h.xa - 2 && p.x <= h.xb) ||
      lineHits.find((h) => h.curve && onCurve(h)) ||
      lineHits.find((h) => h.eq && nearSegment(h.eq)) ||
      null
    );
  }
  const SIDE_NAMES = { VAH: "value area high", VAL: "value area low", POC: "POC" };
  function lineTip(tip, h) {
    if (h.key === "level") {
      tipRows(tip, "Level line", `${price(S.level * PR)} USDT`, [], nav.touchTip ? "" : "X clears it");
      if (nav.touchTip) tip.append(levelButton(Math.floor(S.level / stepP())));
      return;
    }
    const l = h.item,
      usdtAt = (x) => `${price(x * PR)} USDT`;
    if (structureTip(tip, h, l)) return;
    if (l.kind === "poc" || l.kind === "va") {
      const r = l.r,
        approx = r.exact ? "" : "≈ ",
        periodEnd = Math.min(r.span[1], activeCutoff()),
        key = l.kind === "poc" ? l.key : l.period,
        area = l.kind === "va" ? l.va : null;
      tipRows(
        tip,
        l.kind === "poc"
          ? `${lineName(key)} · POC ${approx}${price(l.at * PR)} USDT`
          : `${lineName(key)} · ${SIDE_NAMES[l.side]} ${approx}${price(l.at * PR)} USDT`,
        l.kind === "poc"
          ? `Row ${price(r.row * r.rowPrice * PR)}–${price((r.row + 1) * r.rowPrice * PR)} USDT`
          : `The ${l.side === "VAH" ? "top" : "bottom"} of the period's 70% value area`,
        [
          ["Period", range(r.span[0], periodEnd) + " UTC"],
          ...(area
            ? [
                ["Value area", `${price(area.r0 * r.rowPrice * PR)}–${price(area.r1 * r.rowPrice * PR)} USDT`],
                ["In it", `${compact(area.volume)} USDT · ${(100 * area.share).toFixed(1)}%`],
                ["POC", usdtAt((r.row + 0.5) * r.rowPrice)],
              ]
            : [["In the row", `${compact(r.volume)} USDT · ${r.total ? ((100 * r.volume) / r.total).toFixed(1) : "0"}%`]]),
          ["Period volume", `${compact(r.total)} USDT`],
        ],
        r.stale
          ? "Updating to the latest data…"
          : r.exact
            ? "Per 125 USDT row, the cube's own"
            : r.rowPrice > 1
              ? `Approximate: the recorded snapshot has ${price(r.rowPrice * PR)} USDT rows here`
              : `Approximate: the recorded snapshot starts the period on its ${dur(BASE * r.columns)} columns`,
      );
      return;
    }
    if (l.kind === "dpoc") {
      const p = l.p,
        top = p.rows.find((x) => x.r === p.poc);
      tipRows(
        tip,
        `Daily ${SIDE_NAMES[l.side]} · ${usdtAt(l.at)}`,
        day(l.d * DAYS) + (p.whole ? "" : ", so far"),
        [
          ["Timeframe", "1 day, 00:00–24:00 UTC"],
          ["POC", `${usdtAt(p.poc + 0.5)} · ${compact(top?.v || 0)} USDT`],
          ...(p.va ? [["Value area", `${price(p.va.r0 * PR)}–${price(p.va.r1 * PR)} USDT · ${(100 * p.va.share).toFixed(1)}%`]] : []),
          ["Day volume", `${compact(p.v)} USDT`],
        ],
        "The day's POC and 70% value area, per 125 USDT row",
      );
      return;
    }
    if (l.kind === "untested") {
      const u = l.u,
        daily = u.kind === "day",
        unit = daily ? (u.age === 1 ? "session" : "sessions") : u.age === 1 ? "week" : "weeks";
      tipRows(
        tip,
        `Untested ${daily ? "daily" : "weekly"} POC · ${price(u.price)} USDT`,
        daily ? day(u.from) : `Week of ${day(u.from)}`,
        [
          ["Timeframe", daily ? "1 day" : "1 week, from Monday"],
          ["Age", `${u.age} ${unit}`],
          ["Distance", `${signed(u.atrs, (x) => x.toFixed(2))} daily ATRs · ${signed(u.usd, (x) => price(Math.round(x)))} USDT`],
          ["Latest price", `${price(l.list.latest)} USDT`],
          ["Daily ATR", `${price(Math.round(l.list.atr))} USDT, 14 days, Wilder's`],
        ],
        `No trade since has come within 125 USDT of it${S.replay ? " before the replay's edge" : ""}`,
      );
      return;
    }
    const g = l.g,
      span = l.kind === "prev" ? "day" : l.span,
      names = { day: "Daily", week: "Weekly", month: "Monthly" };
    if (l.kind === "open")
      tipRows(
        tip,
        `${names[span]} open · ${usdtAt(l.at)}`,
        span === "day" ? day(g.t) : span === "week" ? `Week of ${day(g.t)}` : d3.utcFormat("%B %Y")(date(g.t)),
        [
          ["Timeframe", { day: "1 day", week: "1 week, from Monday", month: "1 month" }[span]],
          ["High", `${price(g.high)} USDT`],
          ["Low", `${price(g.low)} USDT`],
          [g.whole ? "Close" : "Latest", `${price(g.close)} USDT`],
        ],
        "Its first trade: the cube's exact open",
      );
    else
      tipRows(
        tip,
        `Previous day's ${l.side} · ${usdtAt(l.at)}`,
        `${day(l.prev.t)}, across ${day(g.t)}`,
        [
          ["Timeframe", "1 day"],
          ["High", `${price(l.prev.high)} USDT`],
          ["Low", `${price(l.prev.low)} USDT`],
          ["Close", `${price(l.prev.close)} USDT`],
        ],
        "Exact, from the cube's own highs, lows and closes",
      );
  }
  // Structure's and the VWAPs' tooltips: the line's name, timeframe and
  // price, and a swing's confirmation. False for any other line.
  function structureTip(tip, h, l) {
    const at = (t) => `${when(t)} UTC`;
    if (l.kind === "peak") {
      const x = l.x,
        ath = l.key === "ath";
      tipRows(
        tip,
        `${ath ? "All-time high" : "Prior cycle high"} · ${price(x.price)} USDT`,
        `Set in the 8 hours from ${at(x.t)}`,
        [
          ["Timeframe", "all history"],
          ...(ath
            ? []
            : [["The deep low after it", `${price(x.low.low)} USDT, ${day(x.low.t)}: ${((100 * x.low.low) / x.price - 100).toFixed(0)}%`]]),
        ],
        ath ? "The highest trade in the cube's history" : "The highest price before the last fall of more than half that came before the all-time high",
      );
      return true;
    }
    if (l.kind === "swing" || l.kind === "equal") {
      const s = l.s,
        daily = l.frame === "1D",
        high = s.kind === "high",
        name = `${daily ? "Daily" : "4-hour"} swing ${high ? "high" : "low"}`;
      tipRows(
        tip,
        l.kind === "equal" ? `Equal ${high ? "highs" : "lows"} · ${price(s.equal.price)} and ${price(s.price)} USDT` : `${name} · ${price(s.price)} USDT`,
        daily ? `On ${day(s.t)}` : `In the 4 hours from ${at(s.t)}`,
        [
          ["Timeframe", daily ? "1 day" : "4 hours"],
          ["Confirmed", `by ${at(s.confirmed)}`],
          ["Traded through", s.broken === null ? "not yet" : `by ${at(s.broken)}`],
          ...(s.equal ? [["Equal to", `${price(s.equal.price)} USDT, ${daily ? day(s.equal.t) : at(s.equal.t)}`]] : []),
        ],
        `Confirmed once price reversed from it by more than ${SWING_REACH} ATRs (14 ${daily ? "days" : "4-hour bars"}, Wilder's)`,
      );
      return true;
    }
    if (l.kind === "fib") {
      const m = l.m,
        what = l.key === "fibswing" ? "the last two daily swings" : `the last ${m.days} sessions' high and low`;
      tipRows(
        tip,
        `${(100 * l.f).toFixed(1)}% retracement · ${price(l.at * PR)} USDT`,
        `Of the move between ${what}`,
        [
          ["Timeframe", l.key === "fibswing" ? "daily swings" : `${m.days} days`],
          ["From", `${price(m.from.price)} USDT, ${at(m.from.t)}`],
          ["To", `${price(m.to.price)} USDT, ${at(m.to.t)}`],
        ],
        "Measured back from the later extreme",
      );
      return true;
    }
    if (h.curve) {
      const c = l,
        t = hover?.t ?? c.r.points[c.r.points.length - 1][0],
        pts = c.r.points;
      let i = 0;
      while (i < pts.length - 1 && pts[i][0] < t) i++;
      const [pt, v, usdt, btc] = pts[i];
      tipRows(
        tip,
        `${c.name} · ${price(Math.round(100 * v) / 100)} USDT`,
        `Up to ${at(pt)}`,
        [
          ["From", c.key === "svwap" ? `${day(c.anchor)} 00:00 UTC` : at(c.anchor)],
          ["Traded", `${compact(usdt)} USDT · ${compact(btc)} BTC`],
          ...(c.swing ? [["The swing", `${price(c.swing.price)} USDT, confirmed by ${at(c.swing.confirmed)}`]] : []),
        ],
        "Σ USDT ÷ Σ BTC, exact from the cube's volume and base volume",
      );
      return true;
    }
    return false;
  }
  // The Lines popover: the families as groups that open and close, each row a
  // toggle with its look and, when on, its value; the days chosen, each
  // removable; a day to add; the level line. The bar's button shows a dot per
  // family on, in its colour.
  // A family is open as it was last left, or else while it has lines on (the
  // volume profile always).
  const FAMILY_OPEN_KEY = "origo-lines-open";
  let familyOpen = null;
  function familiesOpen() {
    if (!familyOpen) {
      familyOpen = {};
      try {
        Object.assign(familyOpen, JSON.parse(localStorage.getItem(FAMILY_OPEN_KEY) || "{}"));
      } catch {
        // Without storage, the defaults.
      }
    }
    const open = {};
    for (const f of FAMILIES)
      open[f.id] = f.id in familyOpen ? familyOpen[f.id] : f.id === "profile" || S.lines.some((k) => familyOf(k) === f.id);
    return open;
  }
  function setFamilyOpen(id, open) {
    familiesOpen();
    familyOpen[id] = open;
    try {
      localStorage.setItem(FAMILY_OPEN_KEY, JSON.stringify(familyOpen));
    } catch {
      // Remembered for this page only.
    }
  }
  function lineValue(key) {
    const r = lineShown(key);
    if (r.state === "ready")
      return r.row === null
        ? "no trades"
        : (r.exact ? "" : "≈ ") + price((r.row + 0.5) * r.rowPrice * PR) + (r.stale ? " …" : "");
    if (r.state === "none") return isDay(key) ? "after the data" : "no trades yet";
    if (r.state === "unrecorded") return "not in this snapshot";
    if (r.state === "failed") return "unavailable";
    return "…";
  }
  // A toggle's value while on: its price now, or how many, or why not yet.
  function toggleValue(key) {
    if (!lineAvailable(key)) return { text: "Live cube only" };
    if (!S.lines.includes(key) || CLOCK[key]) return { text: "" };
    const why = (s) =>
      s.state === "failed"
        ? { text: "unavailable", title: `The cube didn't answer: ${s.error}` }
        : { text: "…" };
    if (key === "va") return { text: periodLines().length ? "" : "with a period" };
    if (key === "udpoc" || key === "uwpoc") {
      const list = untestedList(key === "udpoc" ? "day" : "week");
      if (list.state !== "ready") return list.items ? { text: `${list.items.length} so far…` } : why(list);
      return { text: list.atr === null ? "needs 14 days" : `${list.items.length} within ${UNTESTED_REACH} ATR` };
    }
    if (key === "dpoc") {
      const p = dayProfile(Math.floor(Math.max(0, activeCutoff() - 1e-6) / DAYS));
      return p.state === "ready" ? { text: p.poc === null ? "no trades" : price((p.poc + 0.5) * PR) } : why(p);
    }
    const series = barSeries(9);
    if (series.state !== "ready") return why(series);
    if (STRUCTURE_ROWS.includes(key) || TOGGLES[key]?.family === "vwap") return structureValue(key, series);
    const cal = barCalendar(series),
      last = cal.days.list[cal.days.list.length - 1];
    if (!last) return { text: "no trades" };
    if (key === "dopen") return { text: price(last.open) };
    if (key === "pdhlc") {
      const prev = cal.days.by.get(last.k - 1);
      return { text: prev ? `C ${price(prev.close)}` : "no day before" };
    }
    if (key === "wopen") return { text: price(cal.weeks.list[cal.weeks.list.length - 1].open) };
    return { text: price(cal.months.list[cal.months.list.length - 1].open) };
  }
  // Structure's and the VWAPs' values while on: a level's price, a row's
  // latest swing, a retracement's midpoint, a VWAP's latest.
  function structureValue(key, series) {
    const four = key === "swing4h" ? barSeries(8) : null;
    if (four && four.state !== "ready")
      return four.state === "failed" ? { text: "unavailable", title: `The cube didn't answer: ${four.error}` } : { text: "…" };
    const st = structureNow(series);
    if (key === "ath" || key === "pch") return { text: st[key] ? price(st[key].price) : "none" };
    if (key === "swing1d" || key === "swing4h") {
      const list = key === "swing1d" ? st.daily : st.fourHour,
        s = list?.[list.length - 1];
      return { text: s ? `${s.kind === "high" ? "H" : "L"} ${price(s.price)}` : "none yet" };
    }
    if (key.startsWith("fib")) {
      const m = st[key];
      return { text: m ? `50% ${price(Math.round(m.levels[1].price))}` : "none" };
    }
    return vwapValue(key);
  }
  function vwapValue(key) {
    const edge = cutEdge();
    let anchor;
    if (key === "svwap") anchor = Math.floor(Math.max(0, activeCutoff() - 1e-6) / DAYS) * DAYS;
    else if (isVwapDay(key)) anchor = vwapDayStart(key);
    else {
      const a = vwapAnchors().find((x) => x.key === key);
      if (!a || a.state !== "ready") return { text: a?.state === "none" ? "no swing yet" : "…" };
      anchor = a.t;
    }
    const r = vwapFrom(anchor, 9, anchor, edge);
    return r.state === "ready" && r.points.length ? { text: price(Math.round(100 * r.points[r.points.length - 1][1]) / 100) } : { text: "…" };
  }
  function swatch(key, family, tier) {
    const s = document.createElement("i");
    s.className = "ol-line-swatch" + (CLOCK[key] ? " ol-clock-swatch" : "");
    s.setAttribute("aria-hidden", "true");
    s.dataset.lineSwatch = key;
    s.dataset.family = family;
    if (tier) s.dataset.tier = tier;
    return s;
  }
  function lineRow(key, removable) {
    const row = document.createElement(removable ? "div" : "label"),
      name = document.createElement("span"),
      value = document.createElement("span"),
      toggle = TOGGLES[key];
    row.className = "ol-line-row" + (removable ? "" : " cursor-interaction");
    name.className = "ol-line-name";
    name.textContent = toggle ? toggle.name : lineName(key);
    if (toggle) row.title = toggle.desc;
    value.className = "ol-line-value ol-num";
    value.dataset.lineValue = key;
    const look = swatch(key, FAMILIES.find((f) => f.id === familyOf(key)).colour, toggle ? null : lineTier(key));
    if (removable) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ol-icon-button ol-s cursor-interaction";
      remove.dataset.lineRemove = key;
      remove.setAttribute(
        "aria-label",
        isVwapDay(key) ? `Remove the VWAP from ${day(vwapDayStart(key))}` : `Remove the line since ${day(dayStart(key))}`,
      );
      remove.innerHTML =
        '<svg class="ol-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>';
      row.append(look, name, value, remove);
    } else {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.line = key;
      row.append(box, look, name, value);
    }
    return row;
  }
  // Which families have lines on, in menu order.
  function familiesOn() {
    return FAMILIES.filter((f) => S.lines.some((k) => familyOf(k) === f.id));
  }
  // The bar's button on every update; the popover only while it is open,
  // and in full as it opens.
  function renderLines() {
    renderLinesButton();
    if (el("lines-pop").hidden) return;
    const on = new Set(S.lines),
      days = S.lines.filter(isDay);
    if (!el("lines-list").childElementCount)
      el("lines-list").replaceChildren(...LINE_KEYS.map((key) => lineRow(key, false)));
    for (const list of qsa("[data-toggles]"))
      if (!list.childElementCount)
        list.replaceChildren(...TOGGLE_KEYS.filter((k) => TOGGLES[k].family === list.dataset.toggles).map((key) => lineRow(key, false)));
    const vdays = S.lines.filter(isVwapDay);
    if (el("lines-vdays").dataset.keys !== vdays.join(",")) {
      el("lines-vdays").dataset.keys = vdays.join(",");
      el("lines-vdays").replaceChildren(...vdays.map((key) => lineRow(key, true)));
    }
    if (el("lines-days").dataset.keys !== days.join(",")) {
      el("lines-days").dataset.keys = days.join(",");
      el("lines-days").replaceChildren(...days.map((key) => lineRow(key, true)));
    }
    for (const box of qsa("#ol-lines-pop input[data-line]")) {
      const key = box.dataset.line,
        available = lineAvailable(key);
      if (box.checked !== on.has(key)) box.checked = on.has(key);
      if (box.disabled !== !available) box.disabled = !available;
      if (!TOGGLES[key]) {
        // The names of the calendar periods say which month and year they are.
        const name = box.parentElement.querySelector(".ol-line-name"),
          named = key === "mo" || key === "yr" ? `${lineInfo(key).name} · ${lineTag(key)}` : lineInfo(key).name;
        if (name.textContent !== named) name.textContent = named;
      }
    }
    // Written only when they change: this runs on every input, and a style
    // written would have the next frame lay the page out again.
    for (const s of qsa("[data-line-swatch]")) {
      const key = s.dataset.lineSwatch,
        tier = s.dataset.tier || (isPeriod(key) ? lineTier(key) : TOGGLES[key]?.tier || "short"),
        style = lineStyle(s.dataset.family, CLOCK[key] ? "long" : tier),
        look = `${style.colour}|${Math.max(1, style.width).toFixed(2)}px`;
      if (s.dataset.look === look) continue;
      s.dataset.look = look;
      s.style.setProperty("--line", style.colour);
      s.style.setProperty("--weight", look.split("|")[1]);
    }
    for (const value of qsa("[data-line-value]")) {
      const key = value.dataset.lineValue,
        shown = TOGGLES[key]
          ? toggleValue(key)
          : isVwapDay(key)
            ? vwapValue(key)
          : on.has(key)
            ? (() => {
                const r = lineShown(key);
                return { text: lineValue(key), title: r.state === "failed" ? `The cube didn't answer: ${r.error}` : "" };
              })()
            : { text: "" };
      if (value.textContent !== shown.text) value.textContent = shown.text;
      if (value.title !== (shown.title || "")) value.title = shown.title || "";
    }
    // Each family's head: whether it is open, its dot and how many are on.
    const open = familiesOpen();
    for (const f of FAMILIES) {
      const head = el(`family-${f.id}-head`),
        body = el(`family-${f.id}`),
        count = S.lines.filter((k) => familyOf(k) === f.id).length,
        isOpen = Boolean(open[f.id]);
      if (head.getAttribute("aria-expanded") !== String(isOpen)) head.setAttribute("aria-expanded", String(isOpen));
      if (body.hidden === isOpen) body.hidden = !isOpen;
      const dot = head.querySelector(".ol-family-dot"),
        colour = lineStyle(f.colour, "long").colour;
      if (dot.dataset.colour !== colour) {
        dot.dataset.colour = colour;
        dot.style.background = colour;
      }
      const text = count ? String(count) : "";
      if (head.querySelector(".ol-family-count").textContent !== text) head.querySelector(".ol-family-count").textContent = text;
      const status = root.querySelector(`[data-family-status="${f.id}"]`),
        note = familyStatus(f.id);
      if (status.textContent !== note) status.textContent = note;
    }
    const level = el("lines-level"),
      levelKey = S.level === null ? "" : String(S.level);
    if (level.dataset.level !== levelKey) {
      level.dataset.level = levelKey;
      if (S.level === null) {
        const none = document.createElement("div");
        none.className = "ol-lines-note";
        none.textContent = "None: X over a price row places one.";
        level.replaceChildren(none);
      } else {
        const row = document.createElement("div"),
          look = document.createElement("i"),
          name = document.createElement("span"),
          value = document.createElement("span"),
          remove = document.createElement("button");
        row.className = "ol-line-row";
        look.className = "ol-line-swatch ol-level-swatch";
        look.setAttribute("aria-hidden", "true");
        name.className = "ol-line-name";
        name.textContent = "Level";
        value.className = "ol-line-value ol-num";
        value.textContent = price(S.level * PR);
        remove.type = "button";
        remove.className = "ol-icon-button ol-s cursor-interaction";
        remove.dataset.levelRemove = "1";
        remove.dataset.keys = "X";
        remove.dataset.hint = "";
        remove.setAttribute("aria-label", `Remove the level line at ${price(S.level * PR)}`);
        remove.innerHTML =
          '<svg class="ol-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>';
        row.append(look, name, value, remove);
        level.replaceChildren(row);
      }
    }
    const cleared = !S.lines.length && S.level === null,
      daysHead = days.length ? "Since a day" : "Since a day · none yet",
      last = date(Math.max(0, activeCutoff() - 1e-6)).toISOString().slice(0, 10);
    if (el("lines-clear").disabled !== cleared) el("lines-clear").disabled = cleared;
    if (el("lines-days-head").textContent !== daysHead) el("lines-days-head").textContent = daysHead;
    // The VWAPs from a day need the live cube, as every VWAP does.
    for (const node of [el("lines-vdate"), el("lines-vadd").querySelector("button")])
      if (node.disabled !== !PACK.live) node.disabled = !PACK.live;
    const vHead = vdays.length ? "From a day" : "From a day · none yet";
    if (el("lines-vdays-head").textContent !== vHead) el("lines-vdays-head").textContent = vHead;
    for (const id of ["lines-date", "lines-vdate"]) {
      if (el(id).min !== "2021-01-01") el(id).min = "2021-01-01";
      if (el(id).max !== last) el(id).max = last;
    }
  }
  function renderLinesButton() {
    // The bar's button: a dot for each family on, in its colour.
    const fams = familiesOn(),
      dots = el("lines-dots"),
      want = fams.map((f) => f.id).join(",") + "|" + colourEpoch;
    if (dots.dataset.dots !== want) {
      dots.dataset.dots = want;
      dots.replaceChildren(
        ...fams.map((f) => {
          const dot = document.createElement("i");
          dot.style.background = lineStyle(f.colour, "long").colour;
          return dot;
        }),
      );
    }
    const count = S.lines.length ? String(S.lines.length) : "";
    if (el("lines-count").textContent !== count) el("lines-count").textContent = count;
    const label =
      (fams.length
        ? `Lines: ${fams
            .map((f) => `${f.name} (${S.lines.filter((k) => familyOf(k) === f.id).map((k) => TOGGLES[k]?.name || lineName(k)).join(", ")})`)
            .join("; ")}`
        : "Lines: none") + (S.level === null ? "" : `; level line at ${price(S.level * PR)}`);
    if (el("lines").getAttribute("aria-label") !== label) el("lines").setAttribute("aria-label", label);
  }
  // What a family's lines are waiting on, or where their measures end.
  function familyStatus(id) {
    if (!PACK.live)
      return { session: "Session levels need the live cube.", structure: "Structure needs the live cube.", vwap: "VWAPs need the live cube." }[id] || "";
    const keys = S.lines.filter((k) => familyOf(k) === id);
    if (id === "clock") {
      if (!keys.includes("cme")) return "";
      const s = barSeries(6);
      return s.state === "failed"
        ? `The CME gap's hourly bars couldn't be read: ${s.error}`
        : s.state === "pending"
          ? "Reading hourly bars for the CME gap…"
          : barsShort(s) !== null
            ? `The CME gap ends at ${when(barsShort(s))} UTC, where the cube's measures do.`
            : "";
    }
    if (id === "structure" && keys.includes("swing4h")) {
      const four = barSeries(8);
      if (four.state === "failed") return `The 4-hour bars couldn't be read: ${four.error}`;
      if (four.state === "pending") return "Reading 4-hour bars for the 4-hour swings…";
    }
    if (id === "vwap" && keys.length) {
      const need = viewBarNeeds()[0],
        r = need ? barsBetween(...need) : null;
      if (r?.state === "failed") return `The view's bars couldn't be read: ${r.error}`;
      if (r?.state === "pending") return "Reading the view's bars for the VWAPs…";
    }
    if (!keys.some((k) => EIGHT_HOUR_LINES.includes(k) || STRUCTURE_LINES.includes(k) || isVwapDay(k))) return "";
    const s = barSeries(9);
    return s.state === "failed"
      ? `The 8-hour bars couldn't be read: ${s.error}`
      : s.state === "pending"
        ? "Reading 8-hour bars from the cube…"
        : barsShort(s) !== null
          ? `Measured to ${when(barsShort(s))} UTC: the cube's measures end there.`
          : "";
  }
  function linesStatus(text) {
    el("lines-status").textContent = text;
  }
  function openLines() {
    if (el("lines-pop").hidden) el("lines").click();
    else closePop(true);
  }
  function bindLines() {
    bindPop("lines", "lines-pop", () => {
      hideHint();
      linesStatus("");
      renderLines();
      // Into the list: the first line on in an open family, or else the first
      // family's head.
      (root.querySelector("#ol-lines-pop .ol-family-body:not([hidden]) input:checked") ||
        root.querySelector("#ol-lines-pop .ol-family-body:not([hidden]) input:not(:disabled)") ||
        el("family-profile-head"))?.focus();
    });
    el("lines-pop").addEventListener("change", (e) => {
      const key = e.target.dataset?.line;
      if (!key) return;
      setLines(e.target.checked ? [...S.lines, key] : S.lines.filter((k) => k !== key));
      linesStatus(`${TOGGLES[key]?.name || lineName(key)} ${e.target.checked ? "on" : "off"}`);
    });
    for (const f of FAMILIES)
      el(`family-${f.id}-head`).addEventListener("click", () => {
        setFamilyOpen(f.id, !familiesOpen()[f.id]);
        renderLines();
      });
    el("lines-days").addEventListener("click", (e) => {
      const key = e.target.closest("[data-line-remove]")?.dataset.lineRemove;
      if (!key) return;
      const buttons = [...qsa("[data-line-remove]")],
        at = buttons.findIndex((b) => b.dataset.lineRemove === key);
      setLines(S.lines.filter((k) => k !== key));
      linesStatus(`${lineName(key)} removed`);
      // Focus stays in the list: the next day's button, or else the date.
      const rest = [...qsa("[data-line-remove]")];
      (rest[Math.min(at, rest.length - 1)] || el("lines-date")).focus();
    });
    el("lines-add").addEventListener("submit", (e) => {
      e.preventDefault();
      const key = el("lines-date").value,
        days = S.lines.filter(isDay);
      if (!isDay(key)) return linesStatus("Choose a day to add.");
      const start = dayStart(key);
      if (start < 0 || start >= activeCutoff())
        return linesStatus(`Choose a day from 1 Jan 2021 to ${day(Math.max(0, activeCutoff() - 1e-6))}.`);
      if (S.lines.includes(key)) return linesStatus(`${lineName(key)} is already drawn.`);
      if (days.length >= DAYS_KEPT) return linesStatus(`Up to ${DAYS_KEPT} days; remove one first.`);
      setLines([...S.lines, key]);
      el("lines-date").value = "";
      linesStatus(`${lineName(key)} added`);
    });
    el("lines-vdays").addEventListener("click", (e) => {
      const key = e.target.closest("[data-line-remove]")?.dataset.lineRemove;
      if (!key) return;
      const buttons = [...qsa("#ol-lines-vdays [data-line-remove]")],
        at = buttons.findIndex((b) => b.dataset.lineRemove === key);
      setLines(S.lines.filter((k) => k !== key));
      linesStatus(`${lineName(key)} removed`);
      const rest = [...qsa("#ol-lines-vdays [data-line-remove]")];
      (rest[Math.min(at, rest.length - 1)] || el("lines-vdate")).focus();
    });
    el("lines-vadd").addEventListener("submit", (e) => {
      e.preventDefault();
      const date0 = el("lines-vdate").value,
        key = "vwap:" + date0;
      if (!isVwapDay(key)) return linesStatus("Choose a day to add.");
      const start = vwapDayStart(key);
      if (start < 0 || start >= activeCutoff())
        return linesStatus(`Choose a day from 1 Jan 2021 to ${day(Math.max(0, activeCutoff() - 1e-6))}.`);
      if (S.lines.includes(key)) return linesStatus(`${lineName(key)} is already drawn.`);
      if (S.lines.filter(isVwapDay).length >= DAYS_KEPT) return linesStatus(`Up to ${DAYS_KEPT} days; remove one first.`);
      setLines([...S.lines, key]);
      el("lines-vdate").value = "";
      linesStatus(`${lineName(key)} added`);
    });
    el("lines-vdate").addEventListener("input", () => linesStatus(""));
    el("lines-vdate").addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closePop(true);
    });
    el("lines-date").addEventListener("input", () => linesStatus(""));
    // Text fields keep their keys, so the date field closes its popover itself.
    el("lines-date").addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closePop(true);
    });
    el("lines-level").addEventListener("click", (e) => {
      if (!e.target.closest("[data-level-remove]")) return;
      toggleLevel();
      linesStatus("Level line removed");
      el("lines-date").focus();
    });
    el("lines-clear").addEventListener("click", () => {
      S.level = null;
      setLines([]);
      linesStatus("Every line is off");
      el("family-profile-head").focus();
    });
  }
  // The pane under the prices: one value per column, sharing their time axis.
  // Its measure is the Columns menu's choice (B), or under Same as cells what
  // the cells show: volume, trades or trade size; signed taker volume under
  // Taker flow and Delta, signed taker trades under Taker trades; under Path
  // each column's path over its range (choppiness), under Dwell its USDT per
  // USDT the price moved (volume per path); under Cascade its share of its
  // parent column; under Geometry its volume.
  function paneMeasure() {
    if (S.pane !== "cells") return S.pane;
    return { flow: "delta", flowtrades: "takertrades", path: "choppiness", dwell: "perpath", geometry: "volume" }[S.mode] || S.mode;
  }
  // Each measure's name and unit, and its value from a column of the
  // rectangle's cells, or of their path and dwell (motion), up to where those
  // end. A ratio is log2 of the actual over the expected, from the level's
  // whole columns, on the buy and sell colours and full at ±2.
  const PANE_MEASURES = {
    volume: { label: "Volume", unit: "USDT", value: (c) => c.v },
    delta: { label: "Delta", unit: "USDT", signed: true, value: (c) => 2 * c.bv - c.v },
    takertrades: { label: "Buy − sell trades", unit: "", signed: true, value: (c) => 2 * c.bt - c.ct },
    trades: { label: "Trades", unit: "", value: (c) => c.ct },
    size: { label: "Trade size", unit: "USDT a trade", value: (c) => (c.ct > 0 ? c.v / c.ct : 0) },
    choppiness: {
      label: "Choppiness",
      unit: "path ÷ range",
      motion: true,
      value: (c) => (c.ct > 0 && c.hi > c.lo ? c.p / (c.hi - c.lo) : 0),
    },
    perpath: { label: "Volume per path", unit: "USDT per USDT moved", motion: true, value: (c) => (c.p > 0 ? c.v / c.p : 0) },
    cascade: { label: "Share of parent column", unit: "log₂ vs even", ratio: true },
    efficiency: { label: "Efficiency", unit: "log₂ vs expected", ratio: true },
  };
  // The pane's measure and columns as last drawn, which its tooltip reads.
  let paneShown = null;
  // A ratio's columns in view between `from` and `to`, each with its value, or
  // why it has none. The other measures' columns are the cells' own (activity).
  function ratioColumns(key, full, ts, from, to) {
    const out = [];
    if (key === "cascade") {
      const cx = full?.cascade,
        cols = cx ? full.cols : [];
      for (let i = bisectColumn(cols, Math.floor(from / ts)); i < cols.length && cols[i].c * ts < to; i++)
        out.push(cascadeColumn(cx, cols[i].c));
    } else if (to > from) {
      const ex = efficiencyContext(renderN());
      for (let c = Math.floor(from / ts); c * ts < to; c++) {
        const e = efficiencyOf(ex, c);
        if (e.state !== "none") out.push(e);
      }
    }
    return out;
  }
  function activity(shown, cut, mv, full) {
    const ts = stepT(),
      b = bounds(),
      key = paneMeasure(),
      measure = PANE_MEASURES[key],
      end = measure.motion ? (mv?.src ? mv.end : -Infinity) : Infinity,
      from = Math.max(S.tA, b[0]),
      to = Math.min(S.tB, cut, b[1], end),
      // A column of the cells, or of their path and dwell, with a value; a
      // ratio's, with its value or why it has none.
      cols = measure.ratio
        ? ratioColumns(key, full, ts, from, to)
        : ((measure.motion ? mv?.shown : shown)?.cols || []).filter((c) => (c.c + 1) * ts > from && c.c * ts < to),
      value = measure.ratio ? (x) => x.value : measure.value,
      signed = measure.signed || measure.ratio,
      max = measure.ratio ? 2 : d3.max(cols, (c) => Math.abs(value(c))) || 1,
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
    let bars = 0;
    for (const x of cols) {
      if (measure.ratio && x.state !== "ok") continue;
      const xa = G.X(Math.max(x.c * ts, b[0])),
        xb = G.X(Math.min((x.c + 1) * ts, cut, b[1], end));
      if (xb <= xa) continue;
      bars++;
      const v = measure.ratio ? clamp(x.value, -2, 2) : value(x),
        bh = (Math.abs(v) / max) * room,
        y = signed ? (v >= 0 ? zero - bh : zero) : zero - bh;
      ctx.fillStyle = measure.ratio
        ? divergingColour(v / 2, 1)
        : signed
          ? v >= 0
            ? colors.buy
            : colors.sell
          : colors.volume;
      ctx.globalAlpha = measure.ratio ? 0.85 : 0.65;
      ctx.fillRect(xa, y, Math.max(0.1, xb - xa - (xb - xa > 3 ? 1 : 0)), bh);
    }
    ctx.globalAlpha = 1;
    // A ratio's columns without a value: those whose parent runs past the data
    // are unfinished, like the open column; those it can't be read for are
    // unavailable.
    if (measure.ratio) {
      const span = 2 * ts,
        at = Math.floor(cut / span) * span;
      if (cut % span !== 0 && cols.some((x) => x.state === "open")) {
        const xa = Math.max(G.x, G.X(at));
        hatchRect(xa, top, Math.min(G.x + G.w, G.X(cut)) - xa, h, colors.poc, 7, 0.25);
      }
      let run = null;
      const flush = () => {
        if (run) hatchRect(G.X(run[0]), top, G.X(run[1]) - G.X(run[0]), h, colors.line, 11, 0.6);
        run = null;
      };
      for (const x of cols)
        if (x.state === "outside" || x.state === "unavailable") {
          const a = Math.max(x.c * ts, b[0]),
            z = Math.min((x.c + 1) * ts, cut, b[1]);
          if (run && run[1] === a) run[1] = z;
          else {
            flush();
            run = [a, z];
          }
        }
      flush();
    }
    ctx.restore();
    paneShown = { key, measure, cols };
    // The scale in the price labels' column: the largest value, or a ratio's
    // full strength.
    if (bars || measure.ratio)
      text((signed ? "±" : "") + (measure.ratio ? "2" : compact(max)), G.x - 8, top + 7, colors.muted, "right");
    paneLegend(measure, cols, mv, top);
  }
  // The pane's name and unit at its top left, and what it is still reading or
  // couldn't read. Measured only when its words or the pane's width change.
  let paneLabel = { s: "", width: 0, text: "", w: 0 };
  function paneLegend(measure, cols, mv, top) {
    const has = (state) => measure.ratio && cols.some((x) => x.state === state),
      note = measure.motion
        ? !mv?.src
          ? motionIssue()
            ? `path and dwell couldn't be read: ${motionIssue()}`
            : "reading path and dwell…"
          : ""
        : !measure.ratio
          ? ""
          : has("coarsest")
            ? "no coarser level to compare with"
            : has("failed")
              ? "rows couldn't be read"
              : has("pending")
                ? "reading rows from the cube…"
                : has("unavailable")
                  ? `125 USDT rows are recorded here for the last ${renderN() >= 4 ? 30 : 7} days`
                  : "",
      s = note ? `${measure.label}${measure.unit ? " · " + measure.unit : ""} · ${note}` : measure.unit ? `${measure.label} · ${measure.unit}` : measure.label;
    ctx.font = `${TYPE.s}px ${FONT}`;
    if (paneLabel.s !== s || paneLabel.width !== G.w) {
      const fitted = fitText(s, G.w - 12);
      paneLabel = { s, width: G.w, text: fitted, w: ctx.measureText(fitted).width };
    }
    ctx.fillStyle = colors.surface;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(G.x + 2, top + 1, paneLabel.w + 8, 15);
    ctx.globalAlpha = 1;
    text(paneLabel.text, G.x + 6, top + 8.5, colors.muted, "left");
  }
  // Efficiency: a column's USDT per 125 USDT row its trades touched, against
  // its parent column's one level up in time, as log2 of their ratio over
  // 0.70, the ratio expected: halving a column halves its volume, while its
  // range shrinks only by 2^ISO_B, the diagonal's exponent, and
  // 2^(0.486 − 1) = 0.700. Rows are counted at 125 USDT whatever rows are
  // drawn: at coarse rows a column spans one or two of them, and the measure
  // would collapse to plain volume. The counts come from loaded blocks of 125
  // USDT rows where they hold a column's parent whole (the recent tier's base
  // cells, and from 15 minutes the 30-day archive with the recent tier after
  // it), and live, elsewhere, from the cube (/cube/touched), a chunk of 512
  // columns at a time.
  const EFFICIENCY_EXPECTED = 2 ** (ISO_B - 1),
    TOUCHED_CHUNK = 512,
    touches = new Map(),
    touchedMaps = new WeakMap();
  // A level's columns, each with its USDT and the rows its trades touched.
  function touchedColumns(q) {
    let map = touchedMaps.get(q);
    if (!map) {
      map = new Map(q.cols.map((x) => [x.c, { v: x.v, rows: x.rows.length }]));
      touchedMaps.set(q, map);
    }
    return map;
  }
  // The loaded blocks of 125 USDT rows that can count a level's rows.
  function touchedBlocks(n) {
    return [sources.recent, referenceView || sources.reference].filter((s) => s && s.m === 0 && s.n <= n);
  }
  // What Efficiency reads at level n, gathered once a frame: the data's edge,
  // and the loaded blocks that can count the level's rows, each with its span.
  function efficiencyContext(n) {
    const cut = activeCutoff();
    return {
      n,
      cut,
      blocks: touchedBlocks(n).map((src) => {
        const [start, stop] = sourceRange(src);
        return { src, start, end: Math.min(stop, cut), cols: null, parents: null };
      }),
      chunk: null,
    };
  }
  function efficiencyOf(ex, c) {
    const n = ex.n;
    if (n >= N_MAX) return { c, state: "coarsest" };
    const span = 2 ** (n + 1),
      pc = Math.floor(c / 2),
      a = pc * span,
      z = a + span;
    // A parent that runs past the data is unfinished, as the open column is.
    if (z > ex.cut) return { c, state: "open" };
    for (const h of ex.blocks)
      if (a >= h.start && z <= h.end) {
        if (!h.cols) {
          h.cols = touchedColumns(aggregate(h.src, n, 0));
          h.parents = touchedColumns(aggregate(h.src, n + 1, 0));
        }
        return efficiencyFrom(h.cols, h.parents, c, pc);
      }
    if (!PACK.live) return { c, state: "unavailable" };
    // Columns in view share a chunk or two: each is looked up once a frame.
    const k = Math.floor(a / (TOUCHED_CHUNK * 2 ** n));
    if (ex.chunk?.k !== k) {
      const range = touchedRange(n, k),
        key = range && touchedKey(n, range);
      ex.chunk = { k, key, hit: key && touches.get(key) };
    }
    const { key, hit } = ex.chunk;
    if (hit) return efficiencyFrom(hit.cols, hit.parents, c, pc);
    return key && cube.failed.has(key) ? { c, state: "failed", error: cube.failed.get(key) } : { c, state: "pending" };
  }
  function efficiencyFrom(cols, parents, c, pc) {
    const w = cols.get(c),
      p = parents.get(pc);
    if (!(w?.v > 0 && w.rows > 0 && p?.v > 0 && p.rows > 0)) return { c, state: "none" };
    const e = w.v / w.rows,
      ep = p.v / p.rows;
    return { c, state: "ok", value: Math.log2(e / ep / EFFICIENCY_EXPECTED), e, ep, w, p };
  }
  // Chunk k of level n: its columns up to the last whole parent before the
  // data's edge.
  function touchedRange(n, k) {
    const span = 2 ** (n + 1),
      b0 = k * TOUCHED_CHUNK * 2 ** n,
      b1 = Math.min(b0 + TOUCHED_CHUNK * 2 ** n, Math.floor(CUT / span) * span);
    return b1 > b0 ? [b0, b1] : null;
  }
  const touchedKey = (n, [b0, b1]) => ["touched", live.generation, n, b0, b1].join("|");
  // The cube read for chunk k of level n: each column's rows touched and USDT,
  // and its parents'.
  function touchedSpec(n, k) {
    const range = touchedRange(n, k);
    if (!range) return null;
    const [b0, b1] = range,
      key = touchedKey(n, range);
    return {
      key,
      b0,
      b1,
      path: `/cube/touched?n=${n}&b0=${b0}&b1=${b1}`,
      decode: async (body) => body,
      apply: (body) => {
        const map = (x) => new Map(x.col.map((c, i) => [c, { v: x.volume[i], rows: x.rows[i] }]));
        touches.delete(key);
        touches.set(key, { cols: map(body.columns), parents: map(body.parents) });
        while (touches.size > 24) touches.delete(touches.keys().next().value);
      },
    };
  }
  // What Efficiency needs read next: a chunk holding parents in view that no
  // loaded block holds whole. Only while it shows, and after the view's own
  // reads (see CUBE_KINDS).
  function touchedWant() {
    if (!PACK.live || paneMeasure() !== "efficiency") return null;
    const n = renderN();
    if (n >= N_MAX) return null;
    const span = 2 ** (n + 1),
      size = TOUCHED_CHUNK * 2 ** n,
      cut = activeCutoff(),
      [a, z] = viewRange();
    for (let k = Math.floor(a / size); k * size < Math.min(z, cut); k++) {
      const spec = touchedSpec(n, k);
      if (!spec || touches.has(spec.key) || cube.failed.has(spec.key)) continue;
      const lo = Math.floor(Math.max(a, spec.b0) / span) * span,
        hi = Math.ceil(Math.min(z, spec.b1) / span) * span;
      if (hi <= lo) continue;
      const held = touchedBlocks(n).some((s) => {
        const [start, stop] = sourceRange(s);
        return lo >= start && hi <= Math.min(stop, cut);
      });
      if (!held) return spec;
    }
    return null;
  }

  // The columns the continuations compare, at level (n, m), up to `end`: the
  // loaded tiers that can represent the level, the finest owning each column,
  // and live the cube's history of the level. Tiles fetched for views are not
  // among them, so where the view has been never changes the result.
  function evidenceColumns(n, m, end) {
    const ts = 2 ** n,
      owners = new Map(),
      byColumn = new Map(),
      used = new Map(),
      history = PACK.live ? histories.get(historyKey(n, m)) : null;
    const candidates = TIERS.map((id) => sources[id])
      .filter((src) => src && src.n <= n && src.m <= m)
      .sort((a, b) => a.n - b.n || a.m - b.m);
    // The cube's history owns what the finer tiers don't, before the overview.
    if (history) {
      const at = candidates.findIndex((s) => s.id === "overview");
      candidates.splice(at < 0 ? candidates.length : at, 0, history);
    }
    for (const src of candidates) {
      const meta = src === history ? src : PACK.blocks[src.id],
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
      const grouped =
        src === history
          ? history.cols
          : aggregate(src, n, m, [c0 * ts, c1 * ts, 0, Infinity]).cols;
      let accepted = 0;
      for (const col of grouped)
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
    const loaded = TIERS.map((id) => id + ":" + (sources[id]?.cells.length ?? "-")).join(","),
      history = PACK.live ? histories.get(historyKey(renderN(), renderM())) : null;
    return [
      "v5",
      renderN(),
      renderM(),
      evidenceAnchor(),
      S.barrier || 1,
      loaded,
      history ? `${history.b0}-${history.b1}-${history.cols.length}` : "none",
    ].join("|");
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
    // Live, the level's history comes from the cube; until it has, nothing is
    // compared on a partial history. One that can't be read leaves the loaded
    // tiers, which say so.
    if (PACK.live && !histories.has(historyKey(n, m)) && !cube.failed.has(historyKey(n, m)))
      return { a, n, m, barrier, loading: true, error: "Reading this level's history from the cube…" };
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
      history: "the cube's history",
    };
    el("evidence-provenance").textContent = e.loading
      ? ""
      : e.sources?.length
        ? `${e.sources.map((s) => sourceNames[s.id] || s.id).join(" + ")} · ${integer(e.sources.reduce((sum, s) => sum + s.columns, 0))} columns · all price rows, independent of the visible window` +
          (PACK.live && cube.failed.has(historyKey(e.n, e.m)) ? " · the cube's history couldn't be read" : "")
        : "No loaded history represents this grid.";
    el("evidence-note").textContent = e.loading
      ? ""
      : e.error
      ? "Choose a completed column containing trades."
      : (supported
          ? "Empirical shares; overlapping cases, not calibrated odds."
          : "Below 30 matches: percentages and matching boxes withheld.") +
        (barriers
          ? " Barriers use the first column-end POC crossing; trade first-touch is not observable here."
          : " The boxes show where the POC moved in history.") +
        " Every outcome ends by the anchor.";
    el("evidence-brief").textContent = e.loading
      ? "Reading history…"
      : e.error
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
    // The tooltip a tap on touch opened, which holds the level line's control.
    touchTip: false,
    holdTimer: 0,
    zoomTimer: 0,
    zoomTime: false,
    // The zoom keys held: a key zoom lasts until the last of them comes up.
    zoomKeys: new Set(),
    zoomLabel: "Zoom",
    // What a wheel gesture zooms, and when its last tick came: see the wheel.
    wheel: null,
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
    const [a, end] = viewRange(),
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
  // A tile: level-(n, m) cells over whole columns of the given time, at most
  // TILE_COLUMNS of them, up to the edge that closes the data.
  function tileSpec(n, m, a, b) {
    const step = 2 ** n,
      b0 = Math.floor(Math.min(a, CUT) / step) * step,
      b1 = Math.min(Math.ceil(Math.min(b, CUT) / step) * step, Math.ceil(CUT));
    if (b1 <= b0 || Math.ceil(b1 / step) - b0 / step > TILE_COLUMNS) return null;
    return { id: `tile:${n}:${m}:${b0}:${b1}`, n, m, b0, b1 };
  }
  // Tiles past the newest few, least recently drawn first, are let go; those
  // the view and the lens draw now stay.
  const TILES_KEPT = 8;
  function trimTiles(keep) {
    const tiles = Object.values(sources)
      .filter((s) => s.id.startsWith("tile:") && !keep.includes(s.id))
      .sort((a, b) => (a.used || 0) - (b.used || 0));
    while (tiles.length > TILES_KEPT) {
      const t = tiles.shift();
      delete sources[t.id];
      delete motion.sources[t.id];
      delete loadState[t.id];
      delete PACK.blocks[t.id];
    }
  }
  function tileRead(t, label) {
    return {
      key: ["tile", live.generation, t.id].join("|"),
      path: `/cube/tile?n=${t.n}&m=${t.m}&b0=${t.b0}&b1=${t.b1}`,
      loading: label,
      start: () => {
        PACK.blocks[t.id] = { n: t.n, m: t.m, b0: t.b0, b1: t.b1 };
        loadState[t.id] = "loading";
      },
      drop: () => {
        delete PACK.blocks[t.id];
        delete loadState[t.id];
      },
      decode: async (body) => ({ tile: await unpack(body.block, t.id), body }),
      apply: ({ tile, body }) => {
        const meta = { ...body.block };
        delete meta.gzip_base64;
        PACK.blocks[t.id] = meta;
        tile.used = performance.now();
        sources[t.id] = tile;
        loadState[t.id] = "ready";
        trimTiles([t.id, S.dataset, lensSource]);
      },
    };
  }
  // The view's tile, when no loaded block can show the view at its level.
  function tileWant() {
    const [n, m] = viewLevel();
    if (resolutionReadiness(n, m).status !== "unavailable") return null;
    const [a, b] = viewRange(),
      t = tileSpec(n, m, a, b);
    return t && !loadState[t.id]
      ? tileRead(t, `Fetching ${dur(BASE * 2 ** n)} by ${price(PR * 2 ** m)} USDT cells from the cube`)
      : null;
  }
  // The lens's finer cells, over the view, or around the lens where the view
  // is too wide for one tile.
  let lensSource = null;
  function lensTile() {
    if (!PACK.live || !(S.lens || nav.alt || nav.hold)) return null;
    const f = lensFrame();
    if (!f) return null;
    const n = Math.max(0, renderN() - f.depth),
      m = Math.max(0, renderM() - f.depth);
    if (f.src && f.src.n <= n && f.src.m <= m) return null;
    const step = 2 ** n,
      [a, b] = viewRange();
    let t = tileSpec(n, m, a, b);
    if (!t) {
      const mid = Math.floor(clamp(f.p.t, 0, CUT) / step) * step,
        from = Math.max(0, mid - (TILE_COLUMNS / 2) * step);
      t = tileSpec(n, m, from, from + (TILE_COLUMNS - 1) * step);
    }
    return t;
  }
  function lensWant() {
    const t = lensTile();
    return t && !loadState[t.id] ? tileRead(t, "") : null;
  }
  // The continuations' history at the drawn level: each column's POC, volume
  // and taker-buy volume, for up to the last 100,000 columns.
  const histories = new Map(),
    historyKey = (n, m) => ["history", live.generation, n, m].join("|");
  function historyWant() {
    if (!(S.tab === "evidence" || (S.drawerOpen && S.drawer === "cases"))) return null;
    const n = renderN(),
      m = renderM(),
      key = historyKey(n, m);
    if (histories.has(key)) return null;
    return {
      key,
      path: `/cube/columns?n=${n}&m=${m}`,
      decode: (body) => unpackHistory(body.columns),
      apply: (history) => {
        histories.set(key, history);
        // A level's history can hold 100,000 columns: only the latest few stay.
        while (histories.size > 3) histories.delete(histories.keys().next().value);
        evidenceCache.clear();
      },
    };
  }
  async function unpackHistory(block) {
    const buf = await inflate(block),
      v = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "MSCC")
      throw Error("Invalid column history");
    const count = v.getUint32(16, true),
      cs = new Uint32Array(buf, 32, count),
      pocs = new Uint32Array(buf, 32 + 4 * count, count),
      vol = new Float32Array(buf, 32 + 8 * count, count),
      bv = new Float32Array(buf, 32 + 12 * count, count);
    return {
      id: "history",
      n: v.getUint8(4),
      m: v.getUint8(5),
      b0: block.b0,
      b1: block.b1,
      cols: Array.from({ length: count }, (_, i) => ({
        c: cs[i],
        poc: pocs[i],
        v: vol[i],
        bv: bv[i],
      })),
    };
  }
  // Reads from the cube, for the live page: the rectangle's measures, the
  // view's tile, the lens's tile, the rows Efficiency counts, the POC lines,
  // the days' profiles and the continuations' history. One goes at a time, in that order of need, and
  // each kind asks only for what the page needs now, so a view that moved on
  // is read once it settles. A read for a pack the page has since replaced is
  // dropped. One the cube refuses as changed waits for the page to take the
  // cube's new data; one that fails is not asked again until new data arrives.
  const CUBE_KINDS = ["measure", "tile", "lens", "touched", "lines", "days", "history"],
    cube = { busy: null, stale: false, timer: 0, failed: new Map() };
  function scheduleCube() {
    if (!PACK.live || !ready) return;
    clearTimeout(cube.timer);
    cube.timer = setTimeout(pumpCube, 200);
    scheduleMotion();
  }
  function cubeWant() {
    const wants = {
      measure: measureWant,
      tile: tileWant,
      lens: lensWant,
      touched: touchedWant,
      lines: linesWant,
      days: daysWant,
      history: historyWant,
    };
    for (const kind of CUBE_KINDS) {
      const want = wants[kind]();
      if (want && !cube.failed.has(want.key)) return { kind, ...want };
    }
    return null;
  }
  async function pumpCube() {
    if (!PACK.live || !ready || cube.busy || cube.stale) return;
    const want = cubeWant();
    if (!want) return;
    const generation = live.generation;
    cube.busy = want;
    want.start?.();
    if (want.loading) {
      el("loading").textContent = want.loading;
      el("loading").removeAttribute("role");
      el("loading").hidden = false;
    }
    requestDraw();
    try {
      // Resolved against the page but without any credentials the page's own URL
      // may carry; the browser attaches the session's Basic credentials itself.
      const target = new URL(
        `${want.path}&pack=${encodeURIComponent(PACK.state_token)}&proto=${PROTOCOL}`,
        location.href,
      );
      target.username = "";
      target.password = "";
      // A read that hangs would hold every later one back: it fails instead.
      const response = await fetch(target, {
          cache: "no-store",
          signal: AbortSignal.timeout(120000),
        }),
        body = await response.json().catch(() => null);
      offerReload(body);
      if (body?.error === "cube_changed") {
        // The cube holds another revision of history than this page. Nothing is
        // mixed: the page takes the new data first, then asks again.
        cube.stale = true;
        throw Error("the cube changed; taking its new data first");
      }
      if (!response.ok) throw Error(body?.error || `the server answered ${response.status}`);
      // Decoded first; then, with nothing awaited between the check and the
      // use, an answer for a pack the page replaced meanwhile is dropped and
      // asked for again, so no two cube states ever mix.
      const decoded = await want.decode(body);
      if (generation === live.generation) want.apply(decoded);
      else want.drop?.();
      if (want.loading) el("loading").hidden = true;
    } catch (error) {
      want.drop?.();
      // The server's own words end a sentence the page continues.
      const message = (
        error.name === "TimeoutError"
          ? "the server didn't answer within two minutes"
          : error instanceof TypeError
            ? "the server can't be reached"
            : error.message
      ).replace(/\.+$/, "");
      if (!cube.stale) cube.failed.set(want.key, message);
      if (want.loading || want.kind === "tile") {
        el("loading").textContent = `Cube tile unavailable: ${message}`;
        el("loading").setAttribute("role", "alert");
        el("loading").hidden = false;
      }
    }
    cube.busy = null;
    if (cube.stale) pollLive();
    update();
    pumpCube();
  }
  // Path and dwell (PRD-0023): how the price moved inside each cell, which the
  // Movement encodings and Time at price show. The live page reads them only
  // while a view shows them, in the cube's second query slot and never ahead
  // of the view's own reads, so a view is never held back by them: the tier
  // the view or the lens draws from (whole once, then the columns it gained),
  // the view's or the lens's tile, and the rectangle's when no loaded block
  // tiles it. They end at the pack's last complete base column, a block's
  // `end`: the open column is measured once it completes.
  const MOVEMENT = ["path", "dwell"],
    // The pane's choices that read path and dwell.
    PANE_MOTION = ["choppiness", "perpath"],
    movementMode = () => MOVEMENT.includes(S.mode),
    movementOn = () => Boolean(PACK.live) && (movementMode() || PANE_MOTION.includes(S.pane)),
    // The encodings this page can show: path and dwell need the live cube.
    modes = () => (PACK.live ? MODES : MODES.filter((k) => !MOVEMENT.includes(k))),
    // The pane's choices this page can show: choppiness and volume per path too.
    panes = () => (PACK.live ? PANES : PANES.filter((k) => !PANE_MOTION.includes(k)));
  const motion = {
    sources: {}, // tier or tile id -> its cells with path and dwell
    view: null, // the reference tier with the recent tier's later columns
    measured: new Map(), // rectangle key -> the cube's answer
    busy: null,
    failed: new Map(),
    timer: 0,
    memo: new Map(), // the latest bounded aggregates, which a still view's frames reuse
    epoch: 0, // moves when what was read is let go: an answer asked for before is dropped
  };
  // The motion block of the block a view or the lens draws from.
  function motionOf(src) {
    if (!src) return null;
    return src.id === "reference-with-tail" ? motion.view : motion.sources[src.id] || null;
  }
  function rebuildMotionView() {
    const r = motion.sources.reference,
      z = motion.sources.recent;
    motion.view =
      r && z
        ? {
            ...r,
            id: "motion:reference-with-tail",
            cells: r.cells.concat(motionAggregate(z, r.n, r.m).cells.filter((c) => c.c >= r.col1)),
            b1: z.b1,
            end: z.end,
            col1: Math.ceil(z.b1 / 2 ** r.n),
          }
        : null;
  }
  function boundedMotion(src, n, m, bounds) {
    const key = [src.id, n, m, ...bounds].join("|"),
      hit = motion.memo.get(key);
    if (hit && hit.cells[0] === src.cells) return hit.out;
    const out = motionAggregate(src, n, m, bounds);
    motion.memo.delete(key);
    motion.memo.set(key, { cells: [src.cells], out });
    while (motion.memo.size > 4) motion.memo.delete(motion.memo.keys().next().value);
    return out;
  }
  // The view's path and dwell at the drawn level: over the whole drawn block,
  // which the cells shade against, over the rectangle, and its totals.
  function motionView(src, cut, meas) {
    const msrc = motionOf(src),
      rect = motionMeasurement(meas);
    if (!msrc) return { src: null, full: null, shown: null, rect, end: -Infinity };
    const n = renderN(),
      m = renderM(),
      end = Math.min(msrc.end, cut),
      fullBounds = [msrc.b0, end, 0, Infinity],
      full = S.replay
        ? boundedMotion(msrc, n, m, [msrc.col0 * 2 ** msrc.n, cut, 0, Infinity])
        : motionAggregate(msrc, n, m),
      shown =
        rect.query && rect.query.n === n && rect.query.m === m
          ? rect.query
          : boundedMotion(msrc, n, m, outwardBounds(meas.r));
    return { src: msrc, full, fullBounds, shown, rect, end };
  }
  // The rectangle's path and dwell, exactly: summed from a loaded motion block
  // that tiles it, or the cube's answer, each up to where its measures end.
  function motionMeasurement(meas) {
    const r = meas.r,
      n = renderN(),
      m = renderM();
    if (r[1] <= r[0] || r[3] <= r[2]) return { state: "exact", query: motionSummary([], n, m), end: r[0] };
    const exact = motionExact(r, n, m);
    if (exact) return { state: "exact", query: exactMotion(exact, r, n, m), end: Math.min(r[1], exact.end) };
    const spec = motionSpec(r, n, m),
      hit = motion.measured.get(spec.key);
    if (hit) return { state: "cube", query: hit.query, end: hit.end };
    // A rectangle at the latest data keeps the answer it had a moment ago while
    // the cube reads the new minutes, as the rectangle's other measures do.
    const near = (a, b) => Math.abs(a - b) <= 64,
      windowed = S.window && !S.selection,
      was =
        !S.replay && r[1] >= Math.floor(CUT)
          ? [...motion.measured.values()]
              .reverse()
              .find(
                (x) =>
                  x.edge &&
                  x.nq === spec.nq &&
                  x.m === m &&
                  x.r[1] <= r[1] &&
                  near(x.r[1], r[1]) &&
                  near(x.r[0], r[0]) &&
                  (windowed
                    ? x.win === S.window
                    : !x.win && x.r[0] === r[0] && x.r[2] === r[2] && x.r[3] === r[3]),
              )
          : null;
    if (was && !motion.failed.has(spec.key)) return { state: "cube", query: was.query, end: was.end, updating: true };
    return {
      state: motion.failed.has(spec.key) ? "failed" : "pending",
      error: motion.failed.get(spec.key),
      query: null,
      end: -Infinity,
    };
  }
  // A loaded motion block whose cells tile the rectangle, as exactSource finds
  // one for the other measures: its sums are then the cube's answer. It reaches
  // as far into the rectangle as this pack can be measured, or it is a tier
  // still reading the columns it gained, whose sums end where it does. Of those,
  // the one reaching furthest into the rectangle, then the coarsest: the
  // reference tier ends at its last complete column, and the reference with the
  // recent tier's later columns goes on from there.
  function motionExact(r, n, m) {
    const reach = Math.min(r[1], Math.floor(CUT));
    return (
      Object.values(motion.sources)
        .concat(motion.view ? [motion.view] : [])
        .filter((s) => {
          const ts = 2 ** s.n,
            ps = 2 ** s.m;
          return (
            s.n <= n &&
            s.m <= m &&
            s.b0 <= r[0] &&
            (s.end >= reach || (!s.id.startsWith("motion:tile:") && s.end > r[0])) &&
            r[0] % ts === 0 &&
            (r[1] % ts === 0 || r[1] >= s.end) &&
            r[2] % ps === 0 &&
            r[3] % ps === 0
          );
        })
        .sort((a, b) => Math.min(b.end, r[1]) - Math.min(a.end, r[1]) || b.n - a.n || b.m - a.m)[0] ||
      null
    );
  }
  // The rectangle's sums from the block that tiles it, or, where a coarser block
  // holds whole columns of it, those columns from that block and only the part
  // columns at its ends from the finer: the same cells, far fewer to sum, and a
  // pan sums them every frame.
  function exactMotion(exact, r, n, m) {
    const coarse = Object.values(motion.sources)
        .concat(motion.view ? [motion.view] : [])
        .filter((s) => s.n > exact.n && s.n <= n && s.m <= m && r[2] % 2 ** s.m === 0 && r[3] % 2 ** s.m === 0)
        .map((s) => {
          const tc = 2 ** s.n;
          return { s, a: Math.max(Math.ceil(r[0] / tc), Math.ceil(s.b0 / tc)) * tc, z: Math.floor(Math.min(r[1], s.end, exact.end) / tc) * tc };
        })
        .filter((x) => x.z > x.a)
        .sort((x, y) => y.z - y.a - (x.z - x.a))[0],
      parts = coarse
        ? [
            [exact, [r[0], coarse.a, r[2], r[3]]],
            [coarse.s, [coarse.a, coarse.z, r[2], r[3]]],
            [exact, [coarse.z, r[1], r[2], r[3]]],
          ]
        : [[exact, r]],
      key = parts.map(([s, b]) => [s.id, ...b].join(",")).join("|") + "|" + n + "|" + m,
      hit = motion.memo.get(key);
    if (hit && parts.every(([s], i) => hit.cells[i] === s.cells)) return hit.out;
    const map = new Map(),
      list = [];
    for (const [s, b] of parts) if (b[1] > b[0]) accumulate(map, list, s, n, m, b);
    const out = motionSummary(list, n, m, map);
    motion.memo.delete(key);
    motion.memo.set(key, { cells: parts.map(([s]) => s.cells), out });
    while (motion.memo.size > 4) motion.memo.delete(motion.memo.keys().next().value);
    return out;
  }
  // The cube read for a rectangle's path and dwell, at the level the rectangle's
  // other measures are read at.
  function motionSpec(r, n, m) {
    let nq = n;
    while (nq < 24 && Math.ceil(r[1] / 2 ** nq) - Math.floor(r[0] / 2 ** nq) > TILE_COLUMNS)
      nq++;
    const key = ["motion", live.generation, nq, m, ...r, r[1] > Math.floor(CUT) ? CUT : ""].join("|"),
      edge = r[1] >= Math.floor(CUT),
      win = S.window && !S.selection ? S.window : null;
    return {
      key,
      nq,
      path: `/cube/query?n=${nq}&m=${m}&b0=${r[0]}&b1=${r[1]}&r0=${r[2]}&r1=${r[3]}&motion=1`,
      decode: async (body) => ({ block: await unpack(body.block, key), body }),
      apply: ({ block, body }) => {
        const q = motionSummary(block.cells, nq, m);
        // The cube's own totals, summed exactly.
        q.p = body.summary.path_length;
        q.w = body.summary.dwell;
        motion.measured.delete(key);
        motion.measured.set(key, { query: q, end: body.end, r, nq, m, edge, win });
        while (motion.measured.size > 24) motion.measured.delete(motion.measured.keys().next().value);
      },
    };
  }
  // A tier's path and dwell: whole, or once the page holds them, only the
  // columns from where they end. Columns read under an earlier pack of this
  // page stay (each pack a delta on the last reads its partitions unchanged),
  // except provisional minutes the day's archive has since replaced, which the
  // cube may have measured differently: those are read again.
  function motionTierWant(id) {
    const have = motion.sources[id];
    if (!sources[id] || (have && have.token === PACK.state_token)) return null;
    const from = !have
      ? null
      : Math.max(
          0,
          Math.floor(
            CANON !== null && have.canon !== null && CANON > have.canon
              ? Math.min(have.end, have.canon)
              : have.end,
          ),
        );
    return {
      key: ["motion", live.generation, id, PACK.state_token, from ?? ""].join("|"),
      path: `/cube/motion?tier=${id}` + (from === null ? "" : `&from=${from}`),
      decode: async (body) => ({ part: await unpack(body.block, "motion:" + id), body }),
      apply: ({ part, body }) => {
        const held = motion.sources[id];
        // Only the columns it gained, for a tier this page no longer holds: nothing to add them to.
        if (!held && !body.whole) return;
        const block = held && !body.whole ? held : { ...part, id: "motion:" + id };
        if (block === held)
          block.cells = held.cells
            .filter((c) => c.c >= body.col0 && c.c < body.from)
            .concat(part.cells);
        Object.assign(block, {
          b0: body.col0 * 2 ** part.n,
          col0: body.col0,
          b1: body.end,
          end: body.end,
          col1: Math.ceil(body.end / 2 ** part.n),
          token: body.state_token,
          canon: canonOf(body),
        });
        motion.sources[id] = block;
        forgetMotionLevels();
        rebuildMotionView();
      },
    };
  }
  function motionTileWant(src) {
    if (motion.sources[src.id]) return null;
    return {
      key: ["motion", live.generation, src.id].join("|"),
      path: `/cube/tile?n=${src.n}&m=${src.m}&b0=${src.b0}&b1=${src.b1}&motion=1`,
      decode: async (body) => ({ part: await unpack(body.block, "motion:" + src.id), body }),
      apply: ({ part, body }) => {
        // A tile let go meanwhile has no use for its path and dwell.
        if (!sources[src.id]) return;
        motion.sources[src.id] = { ...part, id: "motion:" + src.id, b0: src.b0, b1: body.end, end: body.end };
      },
    };
  }
  function motionSourceWant(src) {
    if (!src) return null;
    if (src.id === "reference-with-tail")
      return motionTierWant("reference") || motionTierWant("recent");
    if (TIERS.includes(src.id)) return motionTierWant(src.id);
    return src.id.startsWith("tile:") ? motionTileWant(src) : null;
  }
  function motionMeasureWant() {
    const r = requestedBounds(),
      n = renderN(),
      m = renderM();
    if (r[1] <= r[0] || r[3] <= r[2] || motionExact(r, n, m)) return null;
    const spec = motionSpec(r, n, m);
    return motion.measured.has(spec.key) ? null : spec;
  }
  // What the view needs next: the block it is drawn from, the rectangle's
  // totals, then the lens's block; then the underlay's dwell and the lines'
  // bars. Nothing while the view's own measures, tile or lens tile are still
  // to be read.
  function motionWant() {
    const viewing = movementOn();
    if (!(viewing || (PACK.live && S.rows === "time") || barLevels().length) || cube.stale) return null;
    if (["measure", "tile", "lens"].includes(cube.busy?.kind)) return null;
    for (const want of [measureWant(), tileWant(), lensWant()])
      if (want && !cube.failed.has(want.key)) return null;
    const lens = viewing && (S.lens || nav.alt || nav.hold) ? lensFrame()?.src : null;
    return (
      [
        viewing ? motionSourceWant(displaySource()) : null,
        viewing ? motionMeasureWant() : null,
        lens ? motionSourceWant(lens) : null,
        underlayDwellWant(),
        barsWant(),
      ].find((want) => want && !motion.failed.has(want.key)) || null
    );
  }
  // Why the view's path and dwell couldn't be read, when they couldn't.
  function motionIssue() {
    const want = motionSourceWant(displaySource());
    return want ? motion.failed.get(want.key) || null : null;
  }
  // Levels summed from a motion block that changed are summed again.
  function forgetMotionLevels() {
    for (const key of [...groups.keys()]) if (key.startsWith("motion:")) groups.delete(key);
  }
  // After the day's archive replaced provisional minutes, what was read from
  // them is read again: the tiles and rectangles past the old edge are let go,
  // and each tier reads its columns from that edge when next asked.
  function dropMotionAfter(edge) {
    motion.epoch++;
    for (const [id, s] of Object.entries(motion.sources))
      if (id.startsWith("tile:") && s.end > edge) delete motion.sources[id];
    for (const [key, x] of motion.measured) if (x.r[1] > edge) motion.measured.delete(key);
    for (const [key, x] of dwellResults) if (x.span[1] > edge) dwellResults.delete(key);
    for (const [key, x] of dwellLatest) if (x.span[1] > edge) dwellLatest.delete(key);
  }
  function scheduleMotion() {
    if (!PACK.live || !ready) return;
    clearTimeout(motion.timer);
    motion.timer = setTimeout(pumpMotion, 200);
  }
  // One path and dwell read at a time, beside the cube's other reads. An answer
  // for a pack the page replaced meanwhile is dropped, as theirs are.
  async function pumpMotion() {
    if (!PACK.live || !ready || motion.busy) return;
    const want = motionWant();
    if (!want) return;
    const generation = live.generation,
      epoch = motion.epoch;
    motion.busy = want;
    requestDraw();
    try {
      const target = new URL(
        `${want.path}&pack=${encodeURIComponent(PACK.state_token)}&proto=${PROTOCOL}`,
        location.href,
      );
      target.username = "";
      target.password = "";
      const response = await fetch(target, {
          cache: "no-store",
          signal: AbortSignal.timeout(120000),
        }),
        body = await response.json().catch(() => null);
      offerReload(body);
      if (body?.error === "cube_changed") {
        cube.stale = true;
        throw Error("the cube changed; taking its new data first");
      }
      if (!response.ok) throw Error(body?.error || `the server answered ${response.status}`);
      const decoded = await want.decode(body);
      if (generation === live.generation && epoch === motion.epoch) want.apply(decoded);
    } catch (error) {
      const message = (
        error.name === "TimeoutError"
          ? "the server didn't answer within two minutes"
          : error instanceof TypeError
            ? "the server can't be reached"
            : error.message
      ).replace(/\.+$/, "");
      if (!cube.stale) motion.failed.set(want.key, message);
    }
    motion.busy = null;
    if (cube.stale) pollLive();
    requestDraw();
    // The Lines popover says what its bars are waiting on, and the days the
    // bars now reach may need reading in the first slot.
    renderLines();
    pumpCube();
    pumpMotion();
  }
  // A cell's path in row heights, at its full-cell rate as volume counts, or
  // its dwell as a share of its column's time: the column's seconds inside the
  // rectangle and before the measures end, which its cells' dwell sums to.
  function motionAmount(z, b, end, ts, ps, mode = S.mode) {
    const seconds =
      Math.max(0, Math.min((z.c + 1) * ts, b[1], end) - Math.max(z.c * ts, b[0])) * BASE;
    if (!(seconds > 0)) return 0;
    if (mode === "dwell") return z.w / seconds;
    const width = Math.max(0, Math.min((z.r + 1) * ps, b[3]) - Math.max(z.r * ps, b[2])) * PR;
    return width > 0 ? (z.p / width) * ((ts * BASE) / seconds) : 0;
  }
  // Shaded by rank among the block's cells, like the other amounts.
  function motionScale(q, b, end, ts, ps, mode = S.mode) {
    if (!q.scales[mode])
      q.scales[mode] = Float64Array.from(
        q.cells.map((z) => motionAmount(z, b, end, ts, ps, mode)).filter((x) => x > 0),
      ).sort();
    return q.scales[mode];
  }
  // Where a cell of the drawn level falls, mid-transition too; false when it
  // is off the plot. One box, reused, so a frame allocates nothing per cell.
  const BOX = { xa: 0, xb: 0, ya: 0, yb: 0 };
  function cellBox(z, u, ts, ps, cut) {
    if (z.c * ts >= cut) return false;
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
    if (xb < G.x || xa > G.x + G.w || yb < G.y || ya > G.y + G.h) return false;
    BOX.xa = xa;
    BOX.xb = xb;
    BOX.ya = ya;
    BOX.yb = yb;
    return true;
  }
  // A cell with trades is filled; one the price only moved through or held in
  // is outlined in its colour, or filled pale where too small to outline.
  function motionMark(colour, traded, xa, ya, w, h, gap) {
    if (traded) {
      ctx.fillStyle = colour;
      ctx.fillRect(xa + gap / 2, ya + gap / 2, Math.max(0.1, w - gap), Math.max(0.1, h - gap));
    } else if (w > 3 && h > 3) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.strokeRect(xa + 1, ya + 1, w - 2, h - 2);
    } else {
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * 0.45;
      ctx.fillStyle = colour;
      ctx.fillRect(xa, ya, Math.max(0.1, w), Math.max(0.1, h));
      ctx.globalAlpha = alpha;
    }
  }
  // Path and dwell shade the cells the price traded in and outline those it
  // only moved through or held in: with no trade in `base` either, where a
  // cell's trades can come after they end. A cell of `base` after where they
  // end, or any while they are read, is drawn plain.
  function paintMotion(base, q, mv, b, u) {
    const ts = stepT(),
      ps = stepP(),
      cut = activeCutoff(),
      end = mv.src ? mv.end : -Infinity;
    if (q) {
      const sorted = motionScale(mv.full, mv.fullBounds, end, ts, ps);
      for (const z of q.cells) {
        if (!cellBox(z, u, ts, ps, cut)) continue;
        const w = BOX.xb - BOX.xa,
          h = BOX.yb - BOX.ya;
        motionMark(
          ramp(rank(sorted, motionAmount(z, b, end, ts, ps))),
          z.ct > 0 || (base !== null && base.map.has(z.c + "," + z.r)),
          BOX.xa,
          BOX.ya,
          w,
          h,
          w > 4 && h > 4 ? design.gap : 0,
        );
      }
    }
    ctx.fillStyle = colors.line;
    for (const z of base ? base.cells : []) {
      if ((z.c + 1) * ts <= end || (q && q.map.has(cellKey(z.c, z.r))) || !cellBox(z, u, ts, ps, cut))
        continue;
      const w = BOX.xb - BOX.xa,
        h = BOX.yb - BOX.ya,
        gap = w > 4 && h > 4 ? design.gap : 0;
      ctx.fillRect(BOX.xa + gap / 2, BOX.ya + gap / 2, Math.max(0.1, w - gap), Math.max(0.1, h - gap));
    }
  }
  // The legend's quantiles, as each movement encoding reads.
  const motionUnit = (x) =>
    S.mode === "dwell" ? `${+(x * 100).toPrecision(2)}%` : compact(x);
  function motionLegend(sorted) {
    if (!sorted.length) return S.mode === "dwell" ? "Share of column time" : "Row heights";
    const range = `${motionUnit(d3.quantileSorted(sorted, 0.05))} → ${motionUnit(d3.quantileSorted(sorted, 0.95))}`;
    return S.mode === "dwell" ? `${range} of column time` : `${range} row heights`;
  }
  // Seconds to the microsecond, as the cube counts dwell, and to the
  // millisecond in the Cells table. The inspector writes them every frame, so
  // they keep their formatters, as prices do.
  const secondsFormat = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    }),
    millisecondsFormat = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }),
    secondsExact = (x) => secondsFormat.format(x) + " s",
    secondsMilli = (x) => millisecondsFormat.format(x) + " s";
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
            pane: S.pane,
            poc: S.poc,
            area: S.area,
            untested: S.untested,
            rows: S.rows,
            period: S.period,
            level: S.level,
            lines: S.lines,
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
    // The arrows name the entries beside this one, even when its address
    // needed no rewrite (syncURL then leaves them).
    renderHistory();
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
        pane: S.pane,
        rows: S.rows,
        period: S.period,
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
      ...(x.pane && x.pane !== "cells" && PANE_INFO[x.pane] ? [`${PANE_INFO[x.pane].name} columns`] : []),
      ...(x.rows && x.rows !== "off" && ROWS_INFO[x.rows] && validPeriod(x.period)
        ? [`${ROWS_INFO[x.rows].name} rows · ${periodName(x.period)}`]
        : []),
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
    // The one pixels-per-cell readout, in the status bar. It and the gesture
    // line are written only when they change: the same words written again
    // would lay the page out again, in the next frame's draw.
    const pixels = `${fmt(px)} × ${fmt(py)} px per cell`;
    if (el("pixel-state").textContent !== pixels) el("pixel-state").textContent = pixels;
    nav.planeStatus = `Requested n ${S.n} · m ${S.m}${renderN() !== S.n || renderM() !== S.m ? ` · displayed n ${renderN()} · m ${renderM()}` : ""} · diagonal m = round(${ISO_A} + ${ISO_B} n)`;
    if (!nav.planeHover) setPlaneStatus(nav.planeStatus);
    const gesture = S.lens
      ? "Move to inspect · Enter: pin the lens view · Shift+L: depth · V: pan"
      : S.select
        ? "Drag a rectangle to measure it · click to clear it · Esc: back to pan"
        : S.coupled
          ? "Wheel / pinch: time + price · on the price axis: price · Alt: lens"
          : S.diagonal
            ? "Wheel / pinch: time ×k, price ×√k · on the price axis: price · Alt: lens"
            : "Wheel / pinch: time · on the price axis or with Shift: price · Alt: lens";
    if (el("gesture").textContent !== gesture) el("gesture").textContent = gesture;
    // The plane describes its 210 levels only while it shows, and brings them
    // up to date as it opens (see bindTopBar): navigating with it closed
    // rewrites none of them.
    if (!el("res-pop").hidden) refreshPlane();
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
  // zoom gesture ends (see endZoom). With Shift it zooms the price range (and
  // time too when coupled); from the price axis, the price range alone.
  function zoomNavigation(k, p, priceOnly = false, priceAlone = false) {
    const tspan = S.tB - S.tA,
      pspan = S.pB - S.pA;
    if (!priceAlone && (!priceOnly || S.coupled)) {
      const span = clamp(tspan * k, 2, CUT * 1.2),
        u = (p.t - S.tA) / tspan;
      S.tA = p.t - u * span;
      S.tB = S.tA + span;
    }
    const priceFactor =
      priceOnly || priceAlone || S.coupled ? k : S.diagonal ? Math.sqrt(k) : null;
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
  // A price range zoomed by hand leaves Refit, which would fit it again after
  // the next time zoom and as new data arrives: the price axis is then Free,
  // as its control shows, until another mode is chosen.
  function priceByHand() {
    S.refit = false;
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
    lensSource = src?.id || null;
    if (src) src.used = performance.now();
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
          whole = ts * BASE * ps * PR,
          deltas = q.cells
            .map((z) => Math.abs(2 * z.bv - z.v))
            .filter(Boolean)
            .sort((x, y) => x - y),
          deltaMax = d3.quantileSorted(deltas, 0.995) || 1;
        if (movementMode()) localLegend = lensMotion(src, q, n, m, lensBounds, b);
        else {
          // The lens's cells shade against each other, at their full-cell rates.
          for (const z of q.cells)
            markState.metrics.set(z, {
              ...cellExposure(z, lensBounds, ts, ps),
              whole,
              delta: 2 * z.bv - z.v,
            });
          const sorted = amountScale(q);
          if (S.mode === "cascade") q.cascade = lensCascade(src, n, m, lensBounds);
          localLegend =
            S.mode === "delta"
              ? `Δ −${compact(deltaMax)} · 0 · +${compact(deltaMax)} USDT`
              : S.mode === "flow" || S.mode === "flowtrades"
                ? "Taker buys 25% · 50% · 75%"
                : S.mode === "cascade"
                  ? q.cascade.parent
                    ? "−2 · 0 · +2 vs an even share"
                    : "No coarser level to compare with"
                  : S.mode === "geometry"
                    ? "Occupied cells"
                    : sorted.length
                      ? `${compact(d3.quantileSorted(sorted, 0.05))} → ${compact(d3.quantileSorted(sorted, 0.95))} ${AMOUNT_UNITS[S.mode]}`
                      : "";
          for (const z of q.cells) {
            const xa = G.X(z.c * ts),
              xb = G.X(Math.min((z.c + 1) * ts, b)),
              ya = G.Y((z.r + 1) * ps),
              yb = G.Y(z.r * ps);
            ctx.fillStyle = cellColour(z, q, deltaMax);
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
          ctx.strokeStyle = colors.surface;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 3.3;
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = colors.poc;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        // Live, finer cells come from the cube: say so while they are read,
        // and why when they can't be.
        const wanted = fine ? null : lensTile(),
          reading = wanted && loadState[wanted.id] === "loading",
          failed = wanted && cube.failed.has(["tile", live.generation, wanted.id].join("|"));
        label = `${fine ? `Lens −${depth}` : src.n === 0 && src.m === 0 ? "Base cells" : "Finest loaded"} · ${dur(BASE * ts)} × ${price(PR * ps)} USDT`;
        sub = fine
          ? "Finer cells · surroundings unchanged · Enter pins"
          : src.n === 0 && src.m === 0
            ? "Base cells · no finer level exists"
            : failed
              ? "The cube's finer cells couldn't be read"
              : reading || wanted
                ? "Reading finer cells from the cube…"
                : "The recorded snapshot has no finer cells here";
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
  // The lens under Cascade: its finer cells and their parents, summed over the
  // lens widened to whole parents, so each cell it shows has its whole parent.
  function lensCascade(src, n, m, lensBounds) {
    const [start, stop] = sourceRange(src),
      cut = activeCutoff();
    if (n >= N_MAX || m >= M_MAX)
      return cascadeContext({ n, m, map: new Map(), cols: [] }, null, start, Math.min(stop, cut), cut);
    const pt = 2 ** (n + 1),
      pp = 2 ** (m + 1),
      wide = [
        Math.floor(lensBounds[0] / pt) * pt,
        Math.ceil(lensBounds[1] / pt) * pt,
        Math.floor(lensBounds[2] / pp) * pp,
        Math.ceil(lensBounds[3] / pp) * pp,
      ],
      cells = aggregate(src, n, m, wide),
      parent = aggregate(src, n + 1, m + 1, wide),
      c = cells.cascade;
    if (!(c && c.parent === parent && c.start === start && c.end === Math.min(stop, cut) && c.cut === cut))
      cells.cascade = cascadeContext(cells, parent, start, Math.min(stop, cut), cut);
    return cells.cascade;
  }
  // The lens under Path or Dwell: its finer cells' path and dwell, shaded
  // against each other, from the motion of the block it draws from; its
  // legend, or why there is none yet.
  function lensMotion(src, q, n, m, lensBounds, stop) {
    const msrc = motionOf(src),
      ts = 2 ** n,
      ps = 2 ** m,
      end = msrc ? Math.min(msrc.end, activeCutoff()) : -Infinity,
      mq = msrc ? boundedMotion(msrc, n, m, lensBounds) : null,
      sorted = mq ? motionScale(mq, lensBounds, end, ts, ps) : null;
    for (const z of mq ? mq.cells : []) {
      const xa = G.X(z.c * ts),
        xb = G.X(Math.min((z.c + 1) * ts, stop)),
        ya = G.Y((z.r + 1) * ps),
        yb = G.Y(z.r * ps);
      motionMark(
        ramp(rank(sorted, motionAmount(z, lensBounds, end, ts, ps))),
        z.ct > 0 || q.map.has(z.c + "," + z.r),
        xa,
        ya,
        xb - xa,
        yb - ya,
        0.6,
      );
    }
    ctx.fillStyle = colors.line;
    for (const z of q.cells) {
      if ((z.c + 1) * ts <= end || (mq && mq.map.has(cellKey(z.c, z.r)))) continue;
      const xa = G.X(z.c * ts),
        xb = G.X(Math.min((z.c + 1) * ts, stop)),
        ya = G.Y((z.r + 1) * ps),
        yb = G.Y(z.r * ps);
      ctx.fillRect(xa + 0.3, ya + 0.3, Math.max(0.5, xb - xa - 0.6), Math.max(0.5, yb - ya - 0.6));
    }
    if (mq) return motionLegend(sorted);
    const want = motionSourceWant(src);
    return want && motion.failed.has(want.key) ? "Path and dwell unavailable" : "Reading path and dwell…";
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
      const p = at(e),
        axis = onPriceAxis(p);
      if (!inPlot(p) && !axis) return;
      canvas.setPointerCapture(e.pointerId);
      nav.pointers.set(e.pointerId, p);
      nav.last = p;
      nav.alt = e.altKey;
      el("tip").hidden = true;
      nav.touchTip = false;
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
        lens: !axis && (S.lens || e.altKey),
        // A drag on the price labels scales the price range, whatever the tool:
        // around the price where it began, from where the pointer last was.
        axis: axis ? { price: clamp(p.p, S.pA, S.pB), y: p.y } : null,
      };
      setCursor(p);
      if (e.pointerType === "touch" && !axis)
        nav.holdTimer = setTimeout(() => {
          if (drag && !drag.moved) {
            nav.hold = true;
            drag.lens = true;
            requestDraw();
            scheduleCube();
          }
        }, 400);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!ready) return;
      const p = at(e);
      nav.last = p;
      if (e.pointerType !== "touch") nav.touchTip = false;
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
      if (drag?.axis) {
        // Only up and down scale: a drag sideways changes nothing.
        if (Math.abs(p.y - drag.start.y) > 4) drag.moved = true;
        if (!drag.moved || p.y === drag.axis.y) return;
        // Up zooms in and down out, each move by its own step, so the wheel,
        // keys or new data moving the view meanwhile aren't undone.
        priceByHand();
        zoomNavigation(
          Math.exp((p.y - drag.axis.y) * 0.005),
          { t: (S.tA + S.tB) / 2, p: drag.axis.price },
          false,
          true,
        );
        drag.axis.y = p.y;
        return;
      }
      if (S.lens || nav.alt || nav.hold || drag?.lens) {
        el("tip").hidden = true;
        hover = null;
        requestDraw();
        scheduleCube();
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
          ta = clamp(snap(p.t), 0, cutEdge()),
          pa = Math.max(0, snap(p.p)),
          t0 = clamp(snap(drag.start.t), 0, cutEdge()),
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
      // A drag on the price axis ends as a price scale; a click there does nothing.
      if (drag.axis) {
        const scaled = drag.moved;
        drag = null;
        setCursor(at(e));
        settleNavigation(scaled ? "Price scale" : null, false);
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
      // A tap on touch shows the tooltip where it landed: its row section holds
      // the level line's control, as X over a row does with a pointer.
      if (e.pointerType === "touch" && click && inPlot(p)) {
        nav.touchTip = true;
        tooltip(p);
      }
    };
    canvas.addEventListener("pointerup", finish);
    // A tapped tooltip closes at the next touch anywhere but on it.
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!nav.touchTip || el("tip").contains(e.target)) return;
        nav.touchTip = false;
        el("tip").hidden = true;
        requestDraw();
      },
      true,
    );
    canvas.addEventListener("pointercancel", (e) => {
      // A cancelled pinch or price scale has already moved the view: it ends as
      // a lifted one.
      if (nav.pinch || drag?.axis) return finish(e);
      clearTimeout(nav.holdTimer);
      nav.pointers.delete(e.pointerId);
      nav.hold = false;
      drag = null;
      requestDraw();
    });
    canvas.addEventListener("pointerleave", (e) => {
      // A finger lifted leaves the canvas: the tooltip its tap opened stays.
      if (e.pointerType === "touch" && nav.touchTip) return;
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
        const now = performance.now(),
          p = at(e),
          // What a wheel gesture zooms is chosen at its first tick, where it
          // begins and with Shift as it is then, and holds until 220 ms pass
          // without a tick, wherever the pointer drifts and whatever Shift does:
          // over the price axis the price range alone, over the time axis time,
          // over the chart time, or the price range with Shift.
          target =
            (nav.wheel && now - nav.wheel.at < 220 && nav.wheel.target) ||
            (onPriceAxis(p)
              ? "price-axis"
              : onTimeAxis(p)
                ? "time-axis"
                : inPlot(p)
                  ? e.shiftKey
                    ? "chart-price"
                    : "chart-time"
                  : null);
        if (!target) return;
        e.preventDefault();
        // A sideways scroll zooms nothing and changes nothing.
        if (!e.deltaY) return;
        nav.wheel = { target, at: now };
        gestureAt = now;
        const alone = target === "price-axis",
          priceOnly = target === "chart-price",
          // Around the pointer, kept within the view; an axis's own zoom is
          // around the middle of the other axis.
          anchor = {
            t: alone ? (S.tA + S.tB) / 2 : clamp(p.t, S.tA, S.tB),
            p: target === "time-axis" ? (S.pA + S.pB) / 2 : clamp(p.p, S.pA, S.pB),
          };
        if (alone || priceOnly) priceByHand();
        zoomNavigation(Math.exp(clamp(e.deltaY, -120, 120) * 0.003), anchor, priceOnly, alone);
        endZoom(!alone && !priceOnly);
      },
      { passive: false },
    );
    canvas.addEventListener("dblclick", (e) => {
      if (!ready) return;
      const p = at(e);
      if (!inPlot(p)) return;
      if (e.shiftKey) priceByHand();
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
        target?.closest(TEXT_FIELDS) ||
        // A radio group's arrows choose within it (the Rows period's).
        (e.key.startsWith("Arrow") && target?.matches('input[type="radio"]'))
      )
        return;
      if (e.key === "Alt") {
        nav.alt = true;
        el("tip").hidden = true;
        setCursor();
        requestDraw();
        scheduleCube();
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
        if (shift) priceByHand();
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
        const list = modes(),
          i = list.indexOf(S.mode) + (shift ? -1 : 1);
        setMode(list[(i + list.length) % list.length]);
      } else if (k === "b") {
        const list = panes(),
          i = list.indexOf(S.pane) + (shift ? -1 : 1);
        setPane(list[(i + list.length) % list.length]);
      } else if (k === "u") {
        const list = rowsChoices(),
          i = list.indexOf(S.rows) + (shift ? -1 : 1);
        setRows(list[(i + list.length) % list.length]);
      } else if (k === "x") toggleLevel();
      else if (k === "p" && shift) {
        S.poc = !S.poc;
        update();
        save();
      } else if (k === "p") openLines();
      else if (k === "r") toggleReplay();
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
      // or a price scale under the name of the input it cut short.
      const label = nav.pinch ? "Pinch" : nav.zoomKeys.size ? "Zoom" : "",
        scaled = Boolean(drag?.axis && drag.moved);
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
      if (scaled) settleNavigation("Price scale", false);
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
    if (!modes().includes(mode)) return;
    S.mode = mode;
    update();
    save();
  }
  function setPane(pane) {
    if (!panes().includes(pane)) return;
    S.pane = pane;
    update();
    save();
  }
  function setRows(rows) {
    if (!rowsChoices().includes(rows)) return;
    S.rows = rows;
    update();
    save();
  }
  function setPeriod(key) {
    if (!validPeriod(key)) return;
    S.period = key;
    update();
    save();
  }
  // The level line (X): one dashed line on a price row's centre, kept as its
  // price, so it stays put through zooms and resolution changes. With no line,
  // X places it on the row under the pointer (or, with none over the prices,
  // the view's middle row); with one, X clears it wherever the pointer is.
  function toggleLevel(row = null) {
    if (S.level !== null) S.level = null;
    else {
      const ps = stepP(),
        p = nav.last && (inPlot(nav.last) || onProfile(nav.last)) ? nav.last.p : (S.pA + S.pB) / 2;
      S.level = ((row ?? Math.floor(p / ps)) + 0.5) * ps;
    }
    update();
    save();
    if (hover && !el("tip").hidden) tooltip(hover);
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
  el("reload").addEventListener("click", () => location.reload());

  // The tab's title carries the market: the latest POC and the instrument, and
  // the snapshot's day, or that live updates have stopped.
  function title() {
    const src = sources.recent;
    let poc = null;
    if (src?.cells.length) {
      // The last complete base column's: the open one may hold a trade or two.
      const closed = Math.floor(CUT),
        at = src.cells.findLastIndex((z) => z.c < closed),
        last = at >= 0 ? src.cells[at].c : -1;
      let best = -1;
      // Ties choose the lower row, as every POC does.
      for (let i = at; i >= 0 && src.cells[i].c === last; i--)
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
  // A server deployed since this page loaded serves a newer page. Every pack
  // answer names the version of the page its server serves, as the pack this
  // page came with named this one's (PACK.page), and a page too old for the
  // server is answered reload: true. Either way the page says so and leaves the
  // reload to the reader, even when it can't read the rest of the answer.
  function offerReload(body) {
    if (
      body?.reload === true ||
      (typeof body?.page === "string" && typeof PACK.page === "string" && body.page !== PACK.page)
    )
      el("update").hidden = false;
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
          `/cube/pack?since=${encodeURIComponent(since)}&proto=${PROTOCOL}`,
          location.href,
        );
      target.username = "";
      target.password = "";
      const response = await fetch(target, {
          cache: "no-store",
          signal: AbortSignal.timeout(LIVE_TIMEOUT),
        }),
        body = await response.json().catch(() => null);
      offerReload(body);
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
      wasCanon = CANON,
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
      measured.clear();
      motion.sources = {};
      motion.view = null;
      motion.measured.clear();
      histories.clear();
      touches.clear();
      lineResults.clear();
      lineLatest.clear();
      lineParts.clear();
      dwellResults.clear();
      dwellLatest.clear();
      barChunks.clear();
      barEdges.clear();
      dayReads.clear();
      dayMemo.clear();
      weekMemo.clear();
      barsVersion++;
    }
    // New data: reads the cube refused or failed are asked for again.
    cube.stale = false;
    cube.failed.clear();
    motion.failed.clear();
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
    CANON = canonOf(PACK);
    if (!whole && wasCanon !== null && CANON !== wasCanon) dropMotionAfter(wasCanon);
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
        : `Data through ${when(CUT)} UTC` +
          (CANON !== null && CANON < CUT
            ? `; archived days through ${when(CANON)}, provisional minutes after, which the day's archive may revise`
            : "") +
          `. The page asks for new data about once a minute` +
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
        // Lines summed from coarser blocks are summed again from finer ones.
        lineResults.clear();
        lineLatest.clear();
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
