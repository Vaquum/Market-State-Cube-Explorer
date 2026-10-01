"use strict";
// tests/browser/cells-support.js (package C): what the Cells and motion specs (nonvalues-cells, motion-measures) share.
//
// It is support, not a spec: no test lives here. Three things:
//
//   1. A CANVAS RECORDER, installed with addInitScript before the page loads. The page clears by assigning canvas.width and never
//      calls clearRect, so a draw starts at that assignment (the same definition the probe uses, DD-T28). The recorder keeps, for
//      every draw of #ol-canvas, the plot rectangle (the first ctx.rect of the frame, which is the clip the page sets to the plot)
//      and every fillRect and strokeRect with the style in force when it was called: the colour as the canvas reports it
//      ("#rrggbb", lower case), or "pattern:<hash>" for a pattern (the hash is of the tile's pixels, taken when the pattern was
//      created, so the kind of a pattern is told by what it draws and not by what the page calls it). It counts what the
//      page PAINTED, which the DOM and the readouts cannot see (TESTPLAN 3.3).
//   2. The expected colour of an entry of the pinned Lut and the hash of a pattern tile, asked of the module the page itself
//      carries (window.explorerEncoding), with the page's own surface and ink colours as computed CSS. The module is the oracle
//      for WHICH entry a coordinate is; the coordinate itself comes from the hand-computed fixtures or the reference calculator.
//   3. The box a cell must have on the canvas, from the plot rectangle the recorder saw and the rectangle of the address.
//
// Oracles: the recorder observes; nothing in this file computes a value that the code under test computes.
const { T0, BASE_MS } = require("../support/wire.js");

const PRICE_ROW = 125; // USDT in one base row (PACK.base_price)

// The page-side installation (Playwright serialises it). Self-contained: it names nothing of the test runner.
function installRecorder(canvasId) {
  if (window.__cellsRecorder) return;
  const frames = [];
  let current = null;
  const patterns = new WeakMap();
  const tileHash = (image) => {
    // FNV-1a over the tile's pixels: enough to tell the four pattern kinds apart and to recognise one again.
    const data = image.getContext("2d").getImageData(0, 0, image.width, image.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${image.width}x${image.height}:${h.toString(16)}`;
  };
  const styleOf = (style) => {
    if (typeof style === "string") return style.toLowerCase();
    return patterns.has(style) ? `pattern:${patterns.get(style)}` : "other";
  };
  const isMain = (ctx) => ctx.canvas && ctx.canvas.id === canvasId;
  for (const dim of ["width", "height"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dim);
    Object.defineProperty(HTMLCanvasElement.prototype, dim, {
      configurable: true,
      enumerable: d.enumerable,
      get() {
        return d.get.call(this);
      },
      set(v) {
        // A draw starts when the page assigns the WIDTH of its canvas (the height follows it in the same call).
        if (dim === "width" && this.id === canvasId) {
          current = { plot: null, ops: [] };
          frames.push(current);
          if (frames.length > 40) frames.shift();
        }
        d.set.call(this, v);
      },
    });
  }
  const C = CanvasRenderingContext2D.prototype;
  const wrap = (name, after) => {
    const original = C[name];
    C[name] = function (...args) {
      if (current && isMain(this)) after(this, args);
      return original.apply(this, args);
    };
  };
  wrap("rect", (ctx, a) => {
    if (current.plot === null) current.plot = [a[0], a[1], a[2], a[3]];
  });
  wrap("fillRect", (ctx, a) =>
    current.ops.push({ op: "fillRect", x: a[0], y: a[1], w: a[2], h: a[3], style: styleOf(ctx.fillStyle), alpha: ctx.globalAlpha }),
  );
  wrap("strokeRect", (ctx, a) =>
    current.ops.push({ op: "strokeRect", x: a[0], y: a[1], w: a[2], h: a[3], style: styleOf(ctx.strokeStyle), alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth }),
  );
  const createPattern = C.createPattern;
  C.createPattern = function (image, repetition) {
    const pattern = createPattern.call(this, image, repetition);
    if (pattern && image && image.getContext) patterns.set(pattern, tileHash(image));
    return pattern;
  };
  window.__cellsRecorder = { frames: () => frames.slice(), last: () => frames[frames.length - 1] || null };
}

// addRecorder(context): before any page of the context navigates.
async function addRecorder(context, canvasId = "ol-canvas") {
  await context.addInitScript(installRecorder, canvasId);
}

// The last complete draw: {plot: [x, y, w, h], ops}.
function lastDraw(page) {
  return page.evaluate(() => window.__cellsRecorder.last());
}

// The page at rest on an address: loaded, every read answered, and no draw frame for a moment.
async function openView(page, fake, probe, address) {
  await page.goto(`${fake.url}/${address}`);
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 600, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

// The Lut the page has (the module's own pinned table, asked of the page in the theme and appearance it draws with) and the
// colours it sits on, as CSS strings. `tile(kind)` is the hash of the tile the page must use for a pattern kind.
async function pageColours(page, theme = "light") {
  return page.evaluate((themeName) => {
    const E = window.explorerEncoding;
    const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, themeName);
    // The tokens live on the page's root element, so the probe sits inside it, as getColors() does.
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const css = (token) => {
      probe.style.color = `var(--ol-${token})`;
      const rgb = getComputedStyle(probe).color.match(/\d+/g).map(Number);
      return `#${rgb.slice(0, 3).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    };
    const colours = { surface: css("surface"), state: css("state"), occupancy: css("occupancy") };
    probe.remove();
    const hash = (image) => {
      const data = image.getContext("2d").getImageData(0, 0, image.width, image.height).data;
      let h = 0x811c9dc5;
      for (let i = 0; i < data.length; i++) {
        h ^= data[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return `${image.width}x${image.height}:${h.toString(16)}`;
    };
    const tiles = {};
    for (const kind of ["pattern-slate", "pattern-dots", "pattern-cross", "pattern-slash"]) {
      const tile = E.role.tile(kind, {
        dpr: window.devicePixelRatio || 1,
        ink: colours.state,
        ground: colours.surface,
        font: "11px sans-serif",
        makeCanvas: (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }),
      });
      tiles[kind] = `pattern:${hash(tile)}`;
    }
    return {
      ...colours,
      lutId: lut.id,
      midpoint: lut.midpoint.css.toLowerCase(),
      lutOccupancy: lut.occupancy.css.toLowerCase(),
      unsigned: lut.unsigned.css.map((c) => c.toLowerCase()),
      positive: lut.positive.css.map((c) => c.toLowerCase()),
      negative: lut.negative.css.map((c) => c.toLowerCase()),
      tiles,
    };
  }, theme);
}

// An address stamp (YYYY-MM-DDTHH:MMZ) in base columns; a price in USDT in base rows.
const baseOfStamp = (stamp) => (Date.parse(stamp) - T0 * 1000) / BASE_MS;
const rowOfPrice = (usdt) => usdt / PRICE_ROW;

// The rectangle of an address as {tA, tB, pA, pB} in base units.
function rectOf({ from, to, low, high }) {
  return { tA: baseOfStamp(from), tB: baseOfStamp(to), pA: rowOfPrice(low), pB: rowOfPrice(high) };
}

// Where cell (c, r) of level (n, m) lies on the canvas for a drawn plot and the view rectangle: the cell's whole box, without the
// 1 px gap a fill leaves, in css px at DPR 1. A cell is cut by the cutoff, which the caller passes in base units (`cut`).
function boxOf(plot, rect, n, m, c, r, cut = Infinity) {
  const [px, py, pw, ph] = plot;
  const ts = 2 ** n;
  const ps = 2 ** m;
  const X = (t) => px + ((t - rect.tA) / (rect.tB - rect.tA)) * pw;
  const Y = (p) => py + ph - ((p - rect.pA) / (rect.pB - rect.pA)) * ph;
  return { x0: X(c * ts), x1: X(Math.min((c + 1) * ts, cut)), y0: Y((r + 1) * ps), y1: Y(r * ps) };
}

// The drawn ops that paint a cell box: the fillRect or strokeRect whose rectangle lies within `tol` px of the cell's box on every
// side. A fill is inset by half the 1 px gap, an outline by half a pixel (one pixel for a movement-only mark), so 1.6 px covers all
// three; a cell is painted once, so the list has one element.
function opsOfBox(draw, box, tol = 1.6) {
  const near = (a, b) => Math.abs(a - b) <= tol;
  return draw.ops.filter((op) => near(op.x, box.x0) && near(op.y, box.y0) && near(op.x + op.w, box.x1) && near(op.y + op.h, box.y1));
}

// The movement-only mark of the stroke-role table (PRD-0002 S2): a neutral interior, then up to 3.5 px of surface backing and a core of up to
// 1.5 px in the value's colour, both inset from the cell and on the one rectangle. A thin stroke is antialiased, so the core is found by its
// style and width rather than by a pixel. Where the cell is at least 8 px each way the widths are the table's own, 1.5 and 3.5.
function expectMovementMark(expect, draw, box, style, surface, what) {
  const loose = opsOfBox(draw, box, 2.4),
    fills = loose.filter((o) => o.op === "fillRect"),
    strokes = loose.filter((o) => o.op === "strokeRect"),
    side = Math.min(box.x1 - box.x0, box.y1 - box.y0);
  expect(fills, `${what}: one neutral interior`).toHaveLength(1);
  expect(fills[0].style, `${what}: the interior is the surface`).toBe(surface);
  expect(strokes, `${what}: a casing and a core`).toHaveLength(2);
  const [casing, core] = strokes;
  expect(casing.style, `${what}: the backing is the surface colour`).toBe(surface);
  expect(core.style, `${what}: the core is the colour of the pinned Lut`).toBe(style);
  expect([casing.x, casing.y, casing.w, casing.h], `${what}: on one rectangle`).toEqual([core.x, core.y, core.w, core.h]);
  expect(core.lineWidth, `${what}: a core of at most 1.5 px`).toBeLessThanOrEqual(1.5);
  expect(core.lineWidth, `${what}: and at least 1 px`).toBeGreaterThanOrEqual(1);
  expect(casing.lineWidth, `${what}: backing of at most 3.5 px`).toBeLessThanOrEqual(3.5);
  expect(casing.lineWidth, `${what}: wider than the core`).toBeGreaterThan(core.lineWidth);
  expect(core.x - box.x0 - 0.5, `${what}: inset by half the backing`).toBeCloseTo(casing.lineWidth / 2, 1);
  if (side >= 8) {
    expect(core.lineWidth, `${what}: the table's 1.5 px core`).toBe(1.5);
    expect(casing.lineWidth, `${what}: the table's 3.5 px backing`).toBe(3.5);
  }
  expect(core.alpha, `${what}: at alpha 1`).toBe(1);
}

module.exports = { addRecorder, lastDraw, openView, pageColours, baseOfStamp, rowOfPrice, rectOf, boxOf, opsOfBox, expectMovementMark, PRICE_ROW };
