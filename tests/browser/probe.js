"use strict";
// tests/browser/probe.js (H7a): the test-only probe of TESTPLAN.md 3.3. Never shipped: it is injected into the page with
// addInitScript by fixtures.js and exposes ONE test-only global, `__probe`, so that the production globals stay exactly the
// three of DD-T04 and B01 can assert it.
//
// What it wraps, and why (DD-T28, D.19):
//   * window.requestAnimationFrame: every page callback is timed. A callback is a DRAW FRAME when, during it, the `width`
//     or `height` setter of HTMLCanvasElement.prototype ran on the main canvas. The page clears by assigning canvas.width
//     inside geometry() and never calls clearRect, so a clearRect test would mark no draw at all (measured on the
//     baseline: a wheel-driven redraw sequence was 13 draws, clearRect 0, width assignments 13, fillRect 732). The
//     setter wrapper only sets a flag, so its cost is the same in every build.
//   * CanvasRenderingContext2D.prototype (clearRect fillRect strokeRect fill stroke fillText strokeText createPattern
//     setLineDash beginPath moveTo lineTo closePath rect arc): counts per draw frame, the styles in force at each paint
//     op, and a classification of every path that is filled or stroked (glyph heuristic below).
//   * a MutationObserver on the chip attributes (D.18 "Chips"), with timestamps.
//
// Per draw frame the log holds {seq, t, dur, ops, styles, glyphs, unclassified, widthSets, heightSets, other, attrs}:
//   ops        counts on the main canvas: clearRect fillRect strokeRect fill stroke fillText strokeText pattern (= createPattern)
//              setLineDash beginPath moveTo lineTo closePath rect arc, and fillRectFull (a fillRect that covers the whole
//              backing store from 0,0: the secondary cross-check of DD-T28, `fillRect(0, 0, G.width, G.height)`)
//   styles     one entry per distinct {op, fillStyle, strokeStyle, lineWidth, dash, alpha} with its count; a pattern or
//              gradient is the string "pattern"/"gradient"
//   glyphs     counts per glyph name (diamond, triangleUp, triangleDown, cross, dot, tick) for paths filled or stroked on the
//              main canvas; `unclassified` counts the other paths
//   other      the same ops and glyph counts for every OTHER canvas (legend bars, swatches, pattern tiles); they never mix
//              into the main counts
//   attrs      the dataset of every [data-channel] element at the end of the frame, keyed by channel (a second element of the
//              same channel is channel#2): the attributes are written in the same draw that paints (D.18), so this is the
//              per-frame invariant's input
// Callbacks that are not draw frames are listed too (callbacks()), with how many main-canvas ops they issued, so a test can
// show that a callback which drew through clearRect is NOT counted as a draw.
//
// GLYPH CLASSIFICATION IS A HEURISTIC, documented as one (3.3): it looks only at the path (vertex count, closed or open,
// the bounding box and where the vertices sit on it), never at pixels, and it is invariant to translation and uniform
// scale, not to rotation. The shapes are those of E.role.paint (tools/encoding-parts/12-role.js):
//   tick          one open, horizontal segment
//   diamond       four vertices, closed, each on the midpoint of a side of the bounding box, box aspect within 10% of 1
//   triangleDown  three vertices, closed, two on the top edge of the box, one at the bottom (canvas y grows downward)
//   triangleUp    three vertices, closed, two on the bottom edge, one at the top
//   cross         two open segments that intersect at both midpoints (an x or a plus), box aspect within 10% of 1
//   dot           one arc of a full turn and nothing else
// A glyph assertion is always paired with the authoritative data-count of the generated key and the reference count
// (TESTPLAN 3.3); the heuristic alone certifies nothing. Names map to the role table as: diamond=diamond,
// triangleDown=tri-down, triangleUp=tri-up, tick=tick, cross and dot are the shapes inside pattern-cross and pattern-dots
// (GLYPH_ROLE below).
//
// Clocks: Playwright's page.clock replaces requestAnimationFrame. The wrapper is therefore installed as an ACCESSOR on
// window, so that a later assignment of a fake rAF is wrapped too and the frame log keeps working under a fake clock. All
// times in the log are real (performance.now captured here, before any fake clock), never the fake ones.
//
// Node side (this module): install() is the function that runs in the page (self-contained: Playwright serialises it), and
// forPage(page) gives the calls a spec makes. OffscreenCanvas contexts are not wrapped (the page draws on DOM canvases).

// The role-table glyph each probe name stands for (TESTPLAN 3.3 "compared with the encoding glyph table").
const GLYPH_ROLE = Object.freeze({ diamond: "diamond", triangleDown: "tri-down", triangleUp: "tri-up", tick: "tick", cross: "pattern-cross", dot: "pattern-dots" });

// The page-side installation. Everything it needs comes through `surface` ({canvas: {id}, chip}) or is defined inside.
function install(surface) {
  if (window.__probe) return;
  const CANVAS_ID = surface.canvas.id;
  const CHIP = surface.chip;
  const CAP = 20000;
  const STYLE_CAP = 512;
  const now = performance.now.bind(performance);
  const GLYPHS = ["diamond", "triangleUp", "triangleDown", "cross", "dot", "tick"];
  const OPS = ["clearRect", "fillRect", "strokeRect", "fill", "stroke", "fillText", "strokeText", "createPattern", "setLineDash", "beginPath", "moveTo", "lineTo", "closePath", "rect", "arc"];
  const FILL_OPS = new Set(["fill", "fillRect", "fillText"]);
  const STROKE_OPS = new Set(["stroke", "strokeRect", "strokeText"]);

  const zeroOps = () => {
    const o = { fillRectFull: 0 };
    for (const name of OPS) o[name === "createPattern" ? "pattern" : name] = 0;
    return o;
  };
  const zeroGlyphs = () => {
    const g = {};
    for (const name of GLYPHS) g[name] = 0;
    return g;
  };
  // One measurement bucket: the frame being run, or everything that happens outside a page callback.
  const bucket = () => ({ ops: zeroOps(), other: zeroOps(), glyphs: zeroGlyphs(), otherGlyphs: zeroGlyphs(), unclassified: 0, otherUnclassified: 0, styles: new Map(), stylesOverflow: 0, widthSets: 0, heightSets: 0 });

  const state = { seq: 0, cbSeq: 0, frames: [], callbacks: [], mutations: [], dropped: { frames: 0, callbacks: 0, mutations: 0 }, widthSets: 0, heightSets: 0, rejections: [], outside: bucket() };
  let cur = null; // the callback being run: {b: bucket, drew: bool}

  const push = (list, item, which) => {
    if (list.length >= CAP) {
      list.shift();
      state.dropped[which]++;
    }
    list.push(item);
  };

  // ---- the canvas size setters (DD-T28) ----
  for (const dim of ["width", "height"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dim);
    Object.defineProperty(HTMLCanvasElement.prototype, dim, {
      configurable: true,
      enumerable: d.enumerable,
      get() {
        return d.get.call(this);
      },
      set(v) {
        if (this.id === CANVAS_ID) {
          state[dim + "Sets"]++;
          if (cur) {
            cur.drew = true;
            cur.b[dim + "Sets"]++;
          } else state.outside[dim + "Sets"]++;
        }
        d.set.call(this, v);
      },
    });
  }

  // ---- path classification ----
  // A path is a list of subpaths {pts: [[x, y]], closed}, plus arcs [sweep]; `dirty` = a path command since the last
  // fill or stroke, so a fill() followed by a stroke() of the same path counts once.
  const paths = new WeakMap();
  const pathOf = (ctx) => {
    let p = paths.get(ctx);
    if (!p) paths.set(ctx, (p = { subs: [], arcs: [], rects: 0, dirty: false }));
    return p;
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  function classify(p) {
    const segs = p.subs.filter((s) => s.pts.length >= 2);
    if (p.arcs.length === 1 && segs.length === 0 && p.rects === 0) return p.arcs[0] >= 2 * Math.PI - 1e-6 ? "dot" : null;
    if (p.arcs.length > 0 || p.rects > 0) return null;
    if (segs.length === 1) {
      const s = segs[0];
      const pts = s.pts.slice();
      // A closed path repeats its first vertex only through closePath, never through a final lineTo; tolerate both.
      if (pts.length > 1 && near(pts[0][0], pts[pts.length - 1][0], 1e-9) && near(pts[0][1], pts[pts.length - 1][1], 1e-9) && pts.length > 2) pts.pop();
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const w = x1 - x0, h = y1 - y0;
      if (pts.length === 2 && !s.closed) return h <= 1e-9 && w > 0 ? "tick" : null;
      const tol = 1e-6 * Math.max(w, h, 1);
      if (pts.length === 3 && s.closed) {
        const top = pts.filter((q) => near(q[1], y0, tol)).length, bottom = pts.filter((q) => near(q[1], y1, tol)).length;
        if (w <= tol || h <= tol) return null;
        if (top === 2 && bottom === 1) return "triangleDown";
        if (bottom === 2 && top === 1) return "triangleUp";
        return null;
      }
      if (pts.length === 4 && s.closed) {
        if (w <= tol || h <= tol || Math.abs(w / h - 1) > 0.1) return null;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        // Every vertex on the midpoint of one side of the box, each side used once (a square has its vertices on corners).
        const sides = pts.map((q) => (near(q[0], cx, tol) && near(q[1], y0, tol) ? "top" : near(q[0], cx, tol) && near(q[1], y1, tol) ? "bottom" : near(q[1], cy, tol) && near(q[0], x0, tol) ? "left" : near(q[1], cy, tol) && near(q[0], x1, tol) ? "right" : null));
        return new Set(sides).size === 4 && !sides.includes(null) ? "diamond" : null;
      }
      return null;
    }
    if (segs.length === 2 && segs.every((s) => s.pts.length === 2 && !s.closed)) {
      const pts = segs[0].pts.concat(segs[1].pts);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      if (w <= 0 || h <= 0 || Math.abs(w / h - 1) > 0.1) return null;
      const mid = (s) => [(s.pts[0][0] + s.pts[1][0]) / 2, (s.pts[0][1] + s.pts[1][1]) / 2];
      const a = mid(segs[0]), b = mid(segs[1]);
      const tol = 1e-6 * Math.max(w, h);
      return near(a[0], b[0], tol) && near(a[1], b[1], tol) ? "cross" : null;
    }
    return null;
  }

  function paintedPath(ctx, b, main, args) {
    const p = pathOf(ctx);
    if (args.length > 0 && typeof args[0] === "object" && args[0] !== null) {
      // fill(path2d) / stroke(path2d): the geometry lives in the Path2D object, which the probe cannot read.
      if (main) b.unclassified++;
      else b.otherUnclassified++;
      return;
    }
    if (!p.dirty) return;
    p.dirty = false;
    if (p.subs.length === 0 && p.arcs.length === 0 && p.rects === 0) return;
    const glyph = classify(p);
    if (glyph) (main ? b.glyphs : b.otherGlyphs)[glyph]++;
    else if (main) b.unclassified++;
    else b.otherUnclassified++;
  }

  const styleText = (v) => (typeof v === "string" ? v : Object.prototype.toString.call(v) === "[object CanvasPattern]" ? "pattern" : "gradient");

  function styleOf(ctx, b, op) {
    const fill = FILL_OPS.has(op), stroke = STROKE_OPS.has(op);
    if (!fill && !stroke) return;
    const s = { op, fillStyle: fill ? styleText(ctx.fillStyle) : null, strokeStyle: stroke ? styleText(ctx.strokeStyle) : null, lineWidth: stroke ? ctx.lineWidth : null, dash: stroke ? ctx.getLineDash().join(",") : null, alpha: ctx.globalAlpha };
    const key = `${s.op}|${s.fillStyle}|${s.strokeStyle}|${s.lineWidth}|${s.dash}|${s.alpha}`;
    const hit = b.styles.get(key);
    if (hit) hit.count++;
    else if (b.styles.size < STYLE_CAP) b.styles.set(key, { ...s, count: 1 });
    else b.stylesOverflow++;
  }

  // ---- the 2D context ----
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of OPS) {
    const original = proto[name];
    const key = name === "createPattern" ? "pattern" : name;
    proto[name] = function () {
      const result = original.apply(this, arguments);
      const canvas = this.canvas;
      const main = !!canvas && canvas.id === CANVAS_ID;
      const b = cur ? cur.b : state.outside;
      (main ? b.ops : b.other)[key]++;
      if (main && cur) cur.mainOps++;
      if (name === "fillRect" && main && arguments[0] === 0 && arguments[1] === 0 && arguments[2] >= canvas.width && arguments[3] >= canvas.height) b.ops.fillRectFull++;
      if (name === "beginPath") {
        const p = pathOf(this);
        p.subs = [];
        p.arcs = [];
        p.rects = 0;
        p.dirty = false;
      } else if (name === "moveTo") {
        const p = pathOf(this);
        p.subs.push({ pts: [[arguments[0], arguments[1]]], closed: false });
        p.dirty = true;
      } else if (name === "lineTo") {
        const p = pathOf(this);
        if (p.subs.length === 0) p.subs.push({ pts: [], closed: false });
        p.subs[p.subs.length - 1].pts.push([arguments[0], arguments[1]]);
        p.dirty = true;
      } else if (name === "closePath") {
        const p = pathOf(this);
        if (p.subs.length > 0) p.subs[p.subs.length - 1].closed = true;
        p.dirty = true;
      } else if (name === "rect") {
        const p = pathOf(this);
        p.rects++;
        p.dirty = true;
      } else if (name === "arc") {
        const p = pathOf(this);
        p.arcs.push(Math.abs(arguments[4] - arguments[3]));
        p.dirty = true;
      } else if (name === "fill" || name === "stroke") {
        paintedPath(this, b, main, arguments);
        if (main) styleOf(this, b, name);
      } else if (FILL_OPS.has(name) || STROKE_OPS.has(name)) {
        if (main) styleOf(this, b, name);
      }
      return result;
    };
    Object.defineProperty(proto[name], "name", { value: name });
  }

  // ---- the attribute snapshot (D.18 "Chips") ----
  function snapshot() {
    const out = {};
    for (const el of document.querySelectorAll(CHIP)) {
      let channel = el.dataset.channel;
      for (let i = 2; Object.hasOwn(out, channel); i++) channel = `${el.dataset.channel}#${i}`;
      out[channel] = { id: el.id, ...el.dataset };
    }
    return out;
  }

  // ---- requestAnimationFrame, as an accessor (see the header: page.clock) ----
  let underlying = window.requestAnimationFrame;
  function wrapped(callback) {
    if (typeof callback !== "function") return underlying.call(window, callback);
    return underlying.call(window, function probed(timestamp) {
      const callbackSeq = ++state.cbSeq;
      const mine = { b: bucket(), drew: false, mainOps: 0 };
      const t0 = now();
      cur = mine;
      try {
        return callback.call(this, timestamp);
      } finally {
        const dur = now() - t0;
        cur = null;
        push(state.callbacks, { seq: callbackSeq, t: t0, dur, draw: mine.drew, mainOps: mine.mainOps }, "callbacks");
        if (mine.drew) {
          const b = mine.b;
          push(state.frames, {
            seq: ++state.seq, callbackSeq, t: t0, dur, ops: b.ops, styles: [...b.styles.values()], stylesOverflow: b.stylesOverflow, glyphs: b.glyphs, unclassified: b.unclassified,
            widthSets: b.widthSets, heightSets: b.heightSets, other: { ops: b.other, glyphs: b.otherGlyphs, unclassified: b.otherUnclassified }, attrs: snapshot(),
          }, "frames");
        }
      }
    });
  }
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, enumerable: true, get: () => wrapped, set: (fn) => { underlying = fn; } });

  // ---- the chip mutation log ----
  // Records are delivered after the callback that made them returns, so frameSeq (the last committed draw frame) is the
  // frame that wrote them whenever that callback was a draw; cbSeq says which callback was the latest.
  new MutationObserver((records) => {
    const t = now();
    for (const r of records) {
      const target = r.target;
      if (r.type !== "attributes" || !r.attributeName.startsWith("data-") || !target.matches || !target.matches(CHIP)) continue;
      push(state.mutations, { t, channel: target.dataset.channel, name: r.attributeName, old: r.oldValue, value: target.getAttribute(r.attributeName), frameSeq: state.seq, cbSeq: state.cbSeq }, "mutations");
    }
  }).observe(document, { attributes: true, attributeOldValue: true, subtree: true });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    state.rejections.push(String((reason && reason.stack) || reason));
  });

  const api = {
    version: 1,
    reset() {
      state.seq = 0;
      state.cbSeq = 0;
      state.frames.length = 0;
      state.callbacks.length = 0;
      state.mutations.length = 0;
      state.widthSets = 0;
      state.heightSets = 0;
      state.dropped = { frames: 0, callbacks: 0, mutations: 0 };
      state.outside = bucket();
    },
    frames: () => state.frames.slice(),
    callbacks: () => state.callbacks.slice(),
    mutations: () => state.mutations.slice(),
    rejections: () => state.rejections.slice(),
    stats: () => ({ drawFrames: state.frames.length, callbacks: state.callbacks.length, widthSets: state.widthSets, heightSets: state.heightSets, dropped: { ...state.dropped }, outside: { ops: { ...state.outside.ops }, other: { ...state.outside.other }, widthSets: state.outside.widthSets, heightSets: state.outside.heightSets } }),
  };
  Object.defineProperty(window, "__probe", { value: Object.freeze(api), configurable: false, enumerable: false });
}

const { SURFACE } = require("./observe.js");

// addProbe(context): the init script of every page of the context (before any page of it navigates).
async function addProbe(context) {
  await context.addInitScript(install, { canvas: { id: SURFACE.canvas.id }, chip: SURFACE.probe.chip });
}

// forPage(page): the calls a spec makes. Waiting is done from Node with expect.poll, never with a timer in the page, so it
// keeps working when the page runs under page.clock.
function forPage(page) {
  const { expect } = require("@playwright/test");
  const call = (name) => page.evaluate((n) => window.__probe[n](), name);
  const api = {
    reset: () => call("reset"),
    frames: () => call("frames"),
    callbacks: () => call("callbacks"),
    mutations: () => call("mutations"),
    rejections: () => call("rejections"),
    stats: () => call("stats"),
    present: () => page.evaluate(() => typeof window.__probe !== "undefined"),
    // Resolves when at least `count` draw frames were logged (since the last reset).
    async waitForDrawFrames(count, { timeout = 10000 } = {}) {
      await expect.poll(async () => (await api.stats()).drawFrames, { timeout, message: `waiting for ${count} draw frames` }).toBeGreaterThanOrEqual(count);
    },
    // Resolves when no draw frame was logged for quietMs, measured from Node; returns the settled draw-frame count.
    async waitForQuiet({ quietMs = 250, timeout = 10000 } = {}) {
      const deadline = Date.now() + timeout;
      let last = (await api.stats()).drawFrames, since = Date.now();
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const n = (await api.stats()).drawFrames;
        if (n !== last) {
          last = n;
          since = Date.now();
        } else if (Date.now() - since >= quietMs) return n;
        if (Date.now() > deadline) throw new Error(`draw frames did not stop within ${timeout} ms (${n} so far)`);
      }
    },
  };
  return api;
}

module.exports = { install, addProbe, forPage, GLYPH_ROLE };
