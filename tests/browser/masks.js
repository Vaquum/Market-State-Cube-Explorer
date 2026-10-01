"use strict";
// tests/browser/masks.js (PRD-0002 S2, #47 section 1 and the acceptance list): masks made of what the page ACTUALLY painted.
//
// It is support, not a spec. A pixel-invariance test says "these pixels are the same with and without an overlay, except where the overlay itself paints".
// A mask that is declared rather than measured would let anything pass, so every mask here is built from the operations a frame recorded
// (tests/browser/pane-canvas.js): the segments of a stroke at its line width, the box of a plate or a text, the disc of a marker, and the named region of a
// temporary surface. Each entry is then CHECKED against the geometry the PRD allows (a reference stroke and its casing at most 4.5 px, a label plate a
// line of text, a cap a bar), so an oversized halo does not pass by being called a mask: it is reported as a problem.
//
//   opsOf(frame)            -> [{id, kind, seq, key, ...footprint}] in drawing order (kind: stroke, ring, rect, text, plate, disc, shape)
//   added(base, over)       -> the operations of `over` that `base` does not have (a multiset difference by what each draws)
//   drawnAfter(ops, seq)    -> the operations drawn after a given one
//   covers(op, x, y, m)     -> whether an operation's footprint, widened by m px for antialiasing, holds the point
//   unionArea(ops, plot)    -> the pixels of the plot rectangle {x, y, w, h} that the union of the footprints touches, overlaps counted once
//   validate(ops, limits)   -> problems: the entries that are larger than the geometry allows
// Oracles: the recorded operations, and the limits written out below from the PRD (backing 4.5, plates, bars); nothing here reads a pixel.
const LIMITS = Object.freeze({
  // a reference or boundary stroke with its backing, in CSS px (PRD §1: total backing at most 4.5)
  stroke: 4.5,
  // a text is one line of the chart's type: about 16 px tall, as the page reserves for a label
  textHeight: 20,
  textWidth: 240,
  // a label plate (a tag or a text's reserved box)
  plateHeight: 20,
  plateWidth: 256,
  // a cap or a hairline drawn as a bar: at most this thick
  bar: 2,
  // a marker (a cross, a divergence's dot, a swing's triangle)
  marker: 12,
});

const round = (v) => Math.round(v * 1000) / 1000;
const keyOf = (o) => JSON.stringify(o);

function segmentsOf(path, subs) {
  const out = [];
  const starts = subs && subs.length ? subs : [[0, 0]];
  starts.forEach(([from, closed], i) => {
    const to = i + 1 < starts.length ? starts[i + 1][0] : path.length;
    const pts = path.slice(from, to);
    for (let k = 0; k + 1 < pts.length; k++) out.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]]);
    if (closed && pts.length > 2) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]]);
  });
  return out;
}

function opsOf(frame) {
  const ops = [];
  for (const r of frame.rects) ops.push({ kind: "rect", clip: r.clip ?? null, seq: r.seq, key: keyOf(["rect", r.x, r.y, r.w, r.h, r.fill, r.alpha]), box: [r.x, r.y, r.x + r.w, r.y + r.h], fill: r.fill, alpha: r.alpha });
  for (const r of frame.strokeRects) {
    const segs = segmentsOf([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], [[0, 1]]);
    ops.push({ kind: "ring", clip: r.clip ?? null, seq: r.seq, key: keyOf(["ring", r.x, r.y, r.w, r.h, r.stroke, r.width, r.alpha]), segs, half: r.width / 2, width: r.width });
  }
  for (const k of frame.strokes) {
    const segs = segmentsOf(k.path, k.subs);
    if (!segs.length) continue;
    ops.push({ kind: "stroke", clip: k.clip ?? null, seq: k.seq, key: keyOf(["stroke", k.stroke, k.width, k.dash, k.alpha, k.path]), segs, half: k.width / 2, width: k.width });
  }
  for (const f of frame.fills) {
    if (!f.path.length) continue;
    const xs = f.path.map((p) => p[0]),
      ys = f.path.map((p) => p[1]);
    ops.push({ kind: "shape", clip: f.clip ?? null, seq: f.seq, key: keyOf(["fill", f.fill, f.alpha, f.path]), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], fill: f.fill });
  }
  for (const t of frame.texts) {
    const w = t.width ?? t.text.length * 6;
    const left = t.align === "right" ? t.x - w : t.align === "center" ? t.x - w / 2 : t.x;
    ops.push({ kind: "text", clip: t.clip ?? null, seq: t.seq, key: keyOf(["text", t.text, t.x, t.y, t.align, t.fill]), box: [left, t.y - 8, left + w, t.y + 8], text: t.text });
  }
  for (const a of frame.arcs ?? []) ops.push({ kind: "disc", clip: a.clip ?? null, seq: a.seq, key: keyOf(["arc", a.x, a.y, a.r]), cx: a.x, cy: a.y, r: a.r + 1.25 });
  for (const r of frame.roundRects ?? []) ops.push({ kind: "plate", clip: r.clip ?? null, seq: r.seq, key: keyOf(["plate", r.x, r.y, r.w, r.h]), box: [r.x, r.y, r.x + r.w, r.y + r.h] });
  ops.sort((a, b) => a.seq - b.seq);
  ops.forEach((o, i) => (o.id = i));
  return ops;
}

// The operations `over` has beyond `base`: each key of `base` is used up once, so a mark both frames draw is not an addition.
function added(base, over) {
  const left = new Map();
  for (const o of base) left.set(o.key, (left.get(o.key) ?? 0) + 1);
  const out = [];
  for (const o of over) {
    const n = left.get(o.key) ?? 0;
    if (n > 0) left.set(o.key, n - 1);
    else out.push(o);
  }
  return out;
}

const drawnAfter = (ops, seq) => ops.filter((o) => o.seq > seq);

const distance = (px, py, [x0, y0, x1, y1]) => {
  const dx = x1 - x0,
    dy = y1 - y0,
    t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
};

// Whether an operation's footprint, widened by `margin` px, holds the point (x, y); `strict` leaves out the very edge (a pixel whose square only touches).
function covers(op, x, y, margin = 1, strict = false) {
  const le = (a, b) => (strict ? a < b : a <= b);
  // an operation paints only inside the clip it was drawn under
  if (op.clip && (!le(op.clip[0] - margin, x) || !le(x, op.clip[2] + margin) || !le(op.clip[1] - margin, y) || !le(y, op.clip[3] + margin))) return false;
  if (op.segs) return op.segs.some((s) => le(distance(x, y, s), op.half + margin));
  if (op.box) return le(op.box[0] - margin, x) && le(x, op.box[2] + margin) && le(op.box[1] - margin, y) && le(y, op.box[3] + margin);
  if (op.kind === "disc") return le(Math.hypot(x - op.cx, y - op.cy), op.r + margin);
  return false;
}

// The area of the union of the footprints inside the plot {x, y, w, h}, by 1 px cells whose centres are tested (so an overlap is counted once).
function unionArea(ops, plot) {
  const w = Math.ceil(plot.w),
    h = Math.ceil(plot.h),
    grid = new Uint8Array(w * h);
  for (const op of ops) {
    let x0, y0, x1, y1;
    if (op.segs) {
      const xs = op.segs.flatMap((s) => [s[0], s[2]]),
        ys = op.segs.flatMap((s) => [s[1], s[3]]);
      [x0, y0, x1, y1] = [Math.min(...xs) - op.half, Math.min(...ys) - op.half, Math.max(...xs) + op.half, Math.max(...ys) + op.half];
    } else if (op.box) [x0, y0, x1, y1] = op.box;
    else [x0, y0, x1, y1] = [op.cx - op.r, op.cy - op.r, op.cx + op.r, op.cy + op.r];
    const a = Math.max(0, Math.floor(x0 - plot.x)),
      b = Math.min(w - 1, Math.ceil(x1 - plot.x)),
      c = Math.max(0, Math.floor(y0 - plot.y)),
      d = Math.min(h - 1, Math.ceil(y1 - plot.y));
    // a pixel counts as covered when the footprint reaches into its square: its centre closer than half a pixel to the footprint
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) if (covers(op, plot.x + i + 0.5, plot.y + j + 0.5, 0.5, true)) grid[j * w + i] = 1;
  }
  let n = 0;
  for (let i = 0; i < grid.length; i++) n += grid[i];
  return n;
}

// The entries that are larger than the geometry the PRD allows: a stroke with its backing wider than 4.5 px, a bar thicker than a cap, a plate or a text
// bigger than a line of text, a marker bigger than a glyph, or any other area. `allow` lists regions (boxes) that are named temporary surfaces: an entry
// inside one is the surface's own and is judged by that region, not by this table.
function validate(ops, { allow = [], limits = LIMITS } = {}) {
  const problems = [];
  const inside = (o, box) => {
    const b = o.box ?? (o.segs ? [Math.min(...o.segs.flatMap((s) => [s[0], s[2]])), Math.min(...o.segs.flatMap((s) => [s[1], s[3]])), Math.max(...o.segs.flatMap((s) => [s[0], s[2]])), Math.max(...o.segs.flatMap((s) => [s[1], s[3]]))] : [o.cx, o.cy, o.cx, o.cy]);
    return b[0] >= box[0] - 2 && b[1] >= box[1] - 2 && b[2] <= box[2] + 2 && b[3] <= box[3] + 2;
  };
  for (const o of ops) {
    if (allow.some((box) => inside(o, box))) continue;
    const at = `${o.kind} #${o.id}`;
    if (o.segs && o.width > limits.stroke) problems.push(`${at}: a ${o.width} px stroke is wider than the ${limits.stroke} px backing allowed`);
    else if (o.kind === "rect") {
      const w = o.box[2] - o.box[0],
        h = o.box[3] - o.box[1];
      const bar = Math.min(w, h) <= limits.bar,
        plate = w <= limits.plateWidth && h <= limits.plateHeight;
      if (!bar && !plate) problems.push(`${at}: a ${round(w)} x ${round(h)} px fill is an area, neither a bar of at most ${limits.bar} px nor a plate`);
    } else if (o.kind === "plate") {
      const w = o.box[2] - o.box[0],
        h = o.box[3] - o.box[1];
      if (w > limits.plateWidth || h > limits.plateHeight) problems.push(`${at}: a ${round(w)} x ${round(h)} px plate is larger than a label's`);
    } else if (o.kind === "text") {
      const w = o.box[2] - o.box[0];
      if (w > limits.textWidth) problems.push(`${at}: a text ${round(w)} px wide is longer than a label`);
    } else if (o.kind === "shape") {
      const w = o.box[2] - o.box[0],
        h = o.box[3] - o.box[1];
      if (Math.max(w, h) > limits.plateWidth || Math.min(w, h) > limits.marker) problems.push(`${at}: a ${round(w)} x ${round(h)} px shape is larger than a marker`);
    } else if (o.kind === "disc" && o.r > limits.marker) problems.push(`${at}: a disc of radius ${round(o.r)} is larger than a marker`);
  }
  return problems;
}

module.exports = { LIMITS, opsOf, added, drawnAfter, covers, unionArea, validate };
