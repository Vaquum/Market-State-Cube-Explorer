"use strict";
// tests/browser/pane-canvas.js (X): reads the Columns pane and the oscillators off the CANVAS, for the specs B16c, B18 and B19.
//
// A DOM audit cannot see the canvas (WORKPLAN 4.1 rule 8), and the probe (probe.js) counts operations per draw frame but keeps no
// geometry. The pane's claims are geometric: the tallest bar reaches the top of the axis exactly (so the axis maximum is the data's
// maximum and no rounded number), every other bar is its value over that maximum, the MACD extreme touches the edge of ONE axis,
// the two RSI guides sit where 30 and 70 sit on a 0 to 100 axis. So this recorder is a second init script that keeps, for the last
// few draw frames of the main canvas, every fillRect, stroke and fill (with its path, dash and width), strokeRect, fillText and
// createPattern, with the fill, stroke and alpha in force. A draw frame starts where the probe says it does (the `width` setter of
// #ol-canvas, DD-T28). It wraps the same prototypes as the probe and only observes: nothing it does changes a pixel.
//
// Oracle: there is nothing computed here. The numbers a spec compares the recording with come from the exact-rational reference
// calculator (tests/reference), the hand-computed indicator series (tests/fixtures/indicators) and the rules written out in the spec.
// tests/browser/probe-selfcheck.spec.js is the model for checking an observation helper against a known drawing; this one is checked
// by the specs that use it, each of which asserts a count or a position it derives independently before it trusts a geometry.

// The page-side installation (Playwright serialises it; it may refer to nothing outside).
function install(canvasId) {
  if (window.__pane) return;
  const KEEP = 4;
  const frames = [];
  let cur = null;
  let path = [];
  // where each subpath of the path begins and whether it is closed: a stroke's footprint is its subpaths' segments, not the line through every point
  let subs = [];
  // the clip in force (the box of the rectangles clipped to, intersected) and the saved ones: an operation paints only inside it
  let clip = null;
  let clipStack = [];
  const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
  Object.defineProperty(HTMLCanvasElement.prototype, "width", {
    configurable: true,
    enumerable: d.enumerable,
    get() {
      return d.get.call(this);
    },
    set(v) {
      if (this.id === canvasId) {
        cur = { rects: [], strokeRects: [], strokes: [], fills: [], texts: [], arcs: [], roundRects: [], patterns: 0, seq: 0 };
        clip = null;
        clipStack = [];
        frames.push(cur);
        if (frames.length > KEEP) frames.shift();
      }
      d.set.call(this, v);
    },
  });
  const proto = CanvasRenderingContext2D.prototype;
  const style = (value) => (typeof value === "string" ? value : "pattern");
  const wrap = (name, record) => {
    const original = proto[name];
    proto[name] = function (...args) {
      if (cur && this.canvas && this.canvas.id === canvasId) record.call(this, args);
      return original.apply(this, args);
    };
  };
  wrap("beginPath", () => {
    path = [];
    subs = [];
  });
  wrap("moveTo", ([x, y]) => {
    subs.push([path.length, 0]);
    path.push([x, y]);
  });
  wrap("lineTo", ([x, y]) => {
    if (!subs.length) subs.push([path.length, 0]);
    path.push([x, y]);
  });
  wrap("save", () => {
    clipStack.push(clip);
  });
  wrap("restore", () => {
    clip = clipStack.length ? clipStack.pop() : null;
  });
  wrap("clip", () => {
    if (!path.length) return;
    const xs = path.map((p) => p[0]),
      ys = path.map((p) => p[1]),
      box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    clip = clip ? [Math.max(clip[0], box[0]), Math.max(clip[1], box[1]), Math.min(clip[2], box[2]), Math.min(clip[3], box[3])] : box;
  });
  const inClip = () => (clip ? clip.slice() : null);
  wrap("closePath", () => {
    if (subs.length) subs[subs.length - 1][1] = 1;
  });
  // a rectangle path is its four corners, so a two-tone boundary drawn with ctx.rect can be located
  wrap("rect", ([x, y, w, h]) => {
    subs.push([path.length, 1]);
    path.push([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
  });
  wrap("fillRect", function ([x, y, w, h]) {
    cur.rects.push({ x, y, w, h, fill: style(this.fillStyle), alpha: this.globalAlpha, clip: inClip(), seq: cur.seq++ });
  });
  wrap("strokeRect", function ([x, y, w, h]) {
    cur.strokeRects.push({ x, y, w, h, stroke: style(this.strokeStyle), width: this.lineWidth, alpha: this.globalAlpha, clip: inClip(), seq: cur.seq++ });
  });
  wrap("stroke", function () {
    cur.strokes.push({ stroke: style(this.strokeStyle), width: this.lineWidth, dash: this.getLineDash(), alpha: this.globalAlpha, path: path.slice(), subs: subs.map((x) => x.slice()), clip: inClip(), seq: cur.seq++ });
  });
  wrap("fill", function () {
    cur.fills.push({ fill: style(this.fillStyle), alpha: this.globalAlpha, path: path.slice(), subs: subs.map((x) => x.slice()), clip: inClip(), seq: cur.seq++ });
  });
  wrap("fillText", function ([text, x, y]) {
    cur.texts.push({ text: String(text), x, y, fill: style(this.fillStyle), align: this.textAlign, width: this.measureText(String(text)).width, clip: inClip(), seq: cur.seq++ });
  });
  // a circle (a cross's marker, a divergence's dot) and a rounded rectangle (a tag's plate) are kept apart from the paths: their fills and strokes
  // are not one of the straight-line shapes the specs count
  wrap("arc", function ([x, y, r]) {
    cur.arcs.push({ x, y, r, clip: inClip(), seq: cur.seq++ });
  });
  wrap("roundRect", function ([x, y, w, h]) {
    cur.roundRects.push({ x, y, w, h, clip: inClip(), seq: cur.seq++ });
  });
  wrap("createPattern", () => {
    cur.patterns++;
  });
  Object.defineProperty(window, "__pane", {
    value: Object.freeze({
      frames: () => JSON.parse(JSON.stringify(frames)),
      draws: () => frames.length,
    }),
    configurable: false,
    enumerable: false,
  });
}

const { SURFACE } = require("./observe.js");

// addRecorder(page or context): the init script of the page (or of every page of the context), before it navigates.
async function addRecorder(target) {
  await target.addInitScript(install, SURFACE.canvas.id);
}

// The colours a spec needs as the canvas reports them (`fillStyle` reads back as "#rrggbb" for an opaque colour): the page's surface
// token and the pinned Lut's bar, positive and negative entries, the very values explorer.js paints with.
async function coloursOf(page) {
  return page.evaluate(() => {
    const scratch = document.createElement("canvas").getContext("2d");
    const hex = (css) => {
      scratch.fillStyle = "#000000";
      scratch.fillStyle = css;
      return scratch.fillStyle;
    };
    const root = document.getElementById("origo-lens");
    const probe = document.createElement("span");
    root.append(probe);
    const token = (name) => {
      probe.style.color = `var(--ol-${name})`;
      return hex(getComputedStyle(probe).color);
    };
    const out = { surface: token("surface"), bg: token("bg"), ink: token("ink"), muted: token("muted"), state: token("state"), line: token("line"), poc: token("poc") };
    // the reference families' hues (E.role.REFERENCE): price levels, averages and Bollinger, VWAP, clock, historical comparison
    for (const [key, name] of [["level", "line-level"], ["average", "line-average"], ["vwap", "line-vwap"], ["clock", "line-clock"], ["compare", "line-compare"]]) out[key] = token(name);
    probe.remove();
    const theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const lut = window.explorerEncoding.lut.build(window.explorerEncoding.lut.DEFAULT_APPEARANCE, theme);
    out.bar = hex(lut.bar.css);
    out.positive = hex(lut.positive.css[255]);
    out.negative = hex(lut.negative.css[255]);
    return out;
  });
}

// forPage(page): the calls a spec makes. `last()` is the most recent complete draw frame; call it once the page is at rest
// (probe.waitForQuiet), because a frame that is still being drawn has only some of its operations.
function forPage(page) {
  return {
    frames: () => page.evaluate(() => window.__pane.frames()),
    last: async () => {
      const frames = await page.evaluate(() => window.__pane.frames());
      if (!frames.length) throw new Error("the recorder saw no draw frame of #ol-canvas: is it installed in this context (addRecorder)?");
      return frames[frames.length - 1];
    },
    colours: () => coloursOf(page),
  };
}

// The pane's rectangle in a recorded frame: the background fill `fillRect(G.x, top, G.w, h)` in the surface colour that is lowest on
// the canvas and wide (the plot's own background is higher, the label plate is a few pixels wide and alpha .85).
function paneRect(frame, surface) {
  const candidates = frame.rects.filter((r) => r.fill === surface && r.alpha === 1 && r.w >= 300 && r.h >= 30 && r.h <= 140);
  if (!candidates.length) throw new Error("no pane background (a wide surface-coloured fillRect of 30 to 140 px) in the recorded frame");
  const pane = candidates.reduce((a, b) => (b.y > a.y ? b : a));
  return { x: pane.x, y: pane.y, w: pane.w, h: pane.h, bottom: pane.y + pane.h };
}

// The bars of a pane that draws them as fillRects: those of the given fill and alpha standing on the pane's baseline (an unsigned
// axis) or crossing its centre line (a signed one), left to right.
function barsOf(frame, pane, { fill, alpha }) {
  return frame.rects
    .filter((r) => r.fill === fill && Math.abs(r.alpha - alpha) < 1e-9 && r.y >= pane.y - 1e-6 && r.y + r.h <= pane.bottom + 1e-6 && r.h > 0)
    .sort((a, b) => a.x - b.x);
}

// The text labels the recorded frame drew, in drawing order.
const textsOf = (frame) => frame.texts.map((t) => t.text);

// The glyphs of the role table as the recorded paths show them (E.role.paint draws each as one path): hollow diamonds are stroked
// closed four-vertex paths, triangles filled three-vertex paths (the apex up for "above range", down for "below range"), zero ticks
// stroked horizontal segments, all in the ink given. Returns the centre of each, in drawing order.
// `area` (the pane's rectangle) keeps a tick to the pane: the open column's cap on the plot is the same 1.5 px stroke in the state ink.
function glyphsOf(frame, ink, { size = 6, area = null } = {}) {
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  const out = { diamond: [], triUp: [], triDown: [], tick: [] };
  for (const s of frame.strokes) {
    if (s.stroke !== ink) continue;
    const p = s.path;
    if (s.width === 1.25 && p.length === 4) {
      const xs = p.map((v) => v[0]);
      const ys = p.map((v) => v[1]);
      if (close(Math.max(...xs) - Math.min(...xs), size) && close(Math.max(...ys) - Math.min(...ys), size)) out.diamond.push([(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2]);
    } else if (s.width === 1.5 && p.length === 2 && close(p[0][1], p[1][1]) && (area === null || (p[0][1] >= area.y && p[0][1] <= area.y + area.h))) out.tick.push([(p[0][0] + p[1][0]) / 2, p[0][1], p[1][0] - p[0][0]]);
  }
  for (const f of frame.fills) {
    if (f.fill !== ink || f.path.length !== 3) continue;
    const [a, b, c] = f.path;
    if (close(a[1], b[1]) && close(Math.abs(b[0] - a[0]), size)) (c[1] < a[1] ? out.triUp : out.triDown).push([c[0], (a[1] + c[1]) / 2]);
  }
  return out;
}

module.exports = { install, addRecorder, forPage, coloursOf, paneRect, barsOf, textsOf, glyphsOf };
