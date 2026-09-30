"use strict";
// U40 (T-role): E.role of src/encoding.js, the ONE mark-role and glyph table (API.md B.9, DR-21, DD-37, DD-72).
// Oracles (none is the code under test): the tables of API.md B.9 and the string list of INTEGRATION.md D.11,
// transcribed below by hand as literals; hand-computed vertex coordinates for every glyph (a recording fake
// canvas context reports what was drawn, and the assertions are literal numbers); an analytic description of
// each hairline family (x + y = k P, x - y = c P) that the recorded segments are rasterised against, so the
// tiles are proved periodic without using the module's own arithmetic; tile sizes worked out by hand
// (round(period * dpr)); and E.lut.composite only for the ONE relation the table promises (the rows-projection
// sample IS the composite, DD-72), checked against tests/reference/contrast.js `over`.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): arrays are of another realm, so they are
// compared through Array.from.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const refContrast = require("../reference/contrast.js");

const SURFACE = { light: [255, 255, 255], dark: [22, 31, 25] };

// ---- a recording canvas context ----

// Records every call as [name, ...args] and every property assignment as ["=name", value]; `state` follows
// save()/restore() so an assertion can ask which style was in force at the moment of a stroke or a fill.
function recorder() {
  const ops = [];
  const stack = [];
  let state = { fillStyle: null, strokeStyle: null, lineWidth: 1, globalAlpha: 1, font: null, textAlign: null, textBaseline: null };
  const target = {};
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k === "ops") return ops;
      if (k in state) return state[k];
      return (...args) => {
        ops.push({ name: k, args, state: { ...state } });
        if (k === "save") stack.push({ ...state });
        else if (k === "restore") state = stack.pop();
        return undefined;
      };
    },
    set(t, k, v) {
      state[k] = v;
      ops.push({ name: "=" + k, args: [v], state: { ...state } });
      return true;
    },
  });
  return ctx;
}
const names = (ctx) => ctx.ops.filter((o) => !o.name.startsWith("=")).map((o) => o.name);
const count = (ctx, name) => names(ctx).filter((n) => n === name).length;
const balanced = (ctx) => count(ctx, "save") === count(ctx, "restore");

// The paths a context drew: every beginPath ... stroke()/fill() run as {verts, closed, painted, style}.
function pathsOf(ctx) {
  const out = [];
  let cur = null;
  for (const o of ctx.ops) {
    if (o.name === "beginPath") cur = { verts: [], arcs: [], closed: false, moves: 0 };
    else if (cur && (o.name === "moveTo" || o.name === "lineTo")) {
      cur.verts.push([o.args[0], o.args[1]]);
      if (o.name === "moveTo") cur.moves++;
    } else if (cur && o.name === "arc") cur.arcs.push({ x: o.args[0], y: o.args[1], r: o.args[2] });
    else if (cur && o.name === "rect") cur.rect = o.args;
    else if (cur && o.name === "closePath") cur.closed = true;
    else if (cur && (o.name === "stroke" || o.name === "fill")) {
      out.push({ ...cur, painted: o.name, style: o.state });
      cur = null;
    } else if (cur && o.name === "clip") cur.clipped = true;
  }
  return out;
}

// ---- the tables, by hand ----

// API.md B.9 Mark-role record: S1 populates these; the rest are reserved for S2 and S3.
const S1_ROLES = ["unsigned", "positive", "negative", "midpoint", "occupancy", "zero-outline", "unsigned-bar", "state-ink", "rows-projection"];
const RESERVED = { "family-reference": "S2", "interaction": "S3", "region-replacement": "S2" };
const CLASSES = ["quantitative-fill", "quantitative-outline", "family-reference", "state", "interaction", "region-replacement"];
const GEOMETRIES = ["fill", "outline", "bar", "glyph", "pattern", "plate"];

// API.md B.9 glyph table: id -> [tags, kind, ink, key, readout, role]. `tag` lists what the glyph marks.
const GLYPH_TABLE = {
  "tick": [["finite"], "line", "stateInk", "key.zero", "zero", "state-ink"],
  "zero-outline": [["finite"], "outline", "occupancy", "key.zero", "zero", "zero-outline"],
  "diamond": [["undefined"], "hollow diamond", "stateInk", "key.undefined", "undefined", "state-ink"],
  "pattern-slate": [["undefined", "empty-population", "no-coarser-parent", "waiting-for-complete-parent", "no-reference", "empty-both"], "pattern tile", "stateInk", "key.undefined", "tag", "state-ink"],
  "pattern-dots": [["pending"], "pattern tile", "stateInk", "key.pending", "pending", "state-ink"],
  "pattern-cross": [["failed", "invalid-input"], "pattern tile", "stateInk", "key.failed", "tag", "state-ink"],
  "pattern-slash": [["unsupported"], "pattern tile", "stateInk", "key.unsupported", "unsupported", "state-ink"],
  "tri-down": [["finite"], "filled triangle", "stateInk", "key.below", "clip-low", "state-ink"],
  "tri-up": [["finite"], "filled triangle", "stateInk", "key.above", "clip-high", "state-ink"],
  "infinity": [["negative-infinite"], "text glyph", "stateInk", "key.negInf", "negative-infinite", "state-ink"],
  "outline": [[], "outline", "occupancy", "key.outline", "occupied", "occupancy"],
};

// The 14 tags of API.md B.1 in E.result.TAGS order, and the glyph that marks each (null = no mark of its own).
const TAG_GLYPH = [
  ["finite", null],
  ["negative-infinite", "infinity"],
  ["no-reference", "pattern-slate"],
  ["empty-both", "pattern-slate"],
  ["empty-population", "pattern-slate"],
  ["undefined", "pattern-slate"],
  ["no-coarser-parent", "pattern-slate"],
  ["waiting-for-complete-parent", "pattern-slate"],
  ["outside-support", null],
  ["hidden", null],
  ["pending", "pattern-dots"],
  ["failed", "pattern-cross"],
  ["unsupported", "pattern-slash"],
  ["invalid-input", "pattern-cross"],
];

// INTEGRATION.md D.11 `key.*` keys, and the glyph each key id is drawn with.
const KEY_TABLE = {
  "zero": ["zero-outline", "key.zero"],
  "undefined": ["pattern-slate", "key.undefined"],
  "empty-population": ["pattern-slate", "key.undefined"],
  "no-coarser-parent": ["pattern-slate", "key.undefined"],
  "waiting-for-complete-parent": ["pattern-slate", "key.undefined"],
  "no-reference": ["pattern-slate", "key.noRef"],
  "empty-both": ["pattern-slate", "key.emptyBoth"],
  "negative-infinite": ["infinity", "key.negInf"],
  "clip-low": ["tri-down", "key.below"],
  "clip-high": ["tri-up", "key.above"],
  "pending": ["pattern-dots", "key.pending"],
  "failed": ["pattern-cross", "key.failed"],
  "unsupported": ["pattern-slash", "key.unsupported"],
  "invalid-input": ["pattern-cross", "key.invalid"],
  "outside-support": [null, "key.outside"],
  "occupied": ["outline", "key.outline"],
  "no-calibration": ["outline", "key.noCalibration"],
};

// ---- ROLES ----

test("ROLES: one frozen record per role, every field of API.md B.9 present and well formed", () => {
  const ids = Object.keys(E.role.ROLES).sort();
  assert.deepEqual(ids, [...S1_ROLES, ...Object.keys(RESERVED)].sort());
  assert.ok(Object.isFrozen(E.role.ROLES));
  for (const id of ids) {
    const r = E.role.ROLES[id];
    assert.ok(Object.isFrozen(r), id + " is frozen");
    assert.equal(r.id, id);
    assert.ok(CLASSES.includes(r.class), `${id}: class ${r.class}`);
    assert.ok(GEOMETRIES.includes(r.geometry), `${id}: geometry ${r.geometry}`);
    assert.equal(r.appearanceVersion, 2);
    assert.equal(typeof r.sample, "function");
    for (const f of ["label", "accessibleName"]) assert.match(r[f], /^[a-z]+(\.[A-Za-z]+)+$/, `${id}.${f} is an E.text key`);
    assert.notEqual(r.label, r.accessibleName);
    assert.ok(["S1", "S2", "S3"].includes(r.owner));
  }
  // Classes and geometry as B.9 states them.
  const R = E.role.ROLES;
  for (const id of ["unsigned", "positive", "negative", "midpoint", "unsigned-bar", "rows-projection"]) assert.equal(R[id].class, "quantitative-fill", id);
  for (const id of ["occupancy", "zero-outline"]) assert.equal(R[id].class, "quantitative-outline", id);
  assert.equal(R["state-ink"].class, "state");
  assert.equal(R["unsigned-bar"].geometry, "bar");
});

test("ROLES: S1 owns its nine, the reserved rows belong to S2 and S3 and paint nothing", () => {
  for (const id of S1_ROLES) assert.equal(E.role.ROLES[id].owner, "S1", id);
  for (const [id, owner] of Object.entries(RESERVED)) {
    assert.equal(E.role.ROLES[id].owner, owner, id);
    assert.equal(E.role.ROLES[id].sample({}, 0, SURFACE.light), null, id + " has no S1 sample");
    // No glyph paints a reserved role, and paint refuses the role's name as a glyph.
    assert.ok(!Object.values(E.role.GLYPHS).some((g) => g.role === id), id + " is painted by no glyph");
    assert.throws(() => E.role.paint(recorder(), id, 0, 0, 6, "#000"), /unknown glyph/);
  }
});

test("ROLES.sample: what the legend shows for each role, from the Lut it is given", () => {
  for (const theme of ["light", "dark"]) {
    const lut = E.lut.build("slate2", theme);
    const R = E.role.ROLES;
    const s = SURFACE[theme];
    for (const i of [0, 60, 128, 255]) {
      assert.equal(R.unsigned.sample(lut, i, s), lut.unsigned.css[i]);
      assert.equal(R.positive.sample(lut, i, s), lut.positive.css[i]);
      assert.equal(R.negative.sample(lut, i, s), lut.negative.css[i]);
    }
    assert.equal(R.midpoint.sample(lut, 5, s), lut.midpoint.css, "zero Delta is drawn at the signed midpoint, not the surface");
    assert.notEqual(R.midpoint.sample(lut, 5, s), "#" + s.map((v) => v.toString(16).padStart(2, "0")).join(""), "and it is not the surface colour");
    assert.equal(R.occupancy.sample(lut, 0, s), lut.occupancy.css);
    assert.equal(R["zero-outline"].sample(lut, 0, s), lut.zeroInk.css);
    assert.equal(R["unsigned-bar"].sample(lut, 0, s), lut.bar.css);
    assert.equal(R["state-ink"].sample(lut, 0, s), lut.stateInk.css);
    // The rows projection is the 16% COMPOSITE (DD-72, DD-86), not the raw role colour.
    for (const i of [0, 12, 128, 255]) {
      const want = "#" + refContrast.over([lut.rows.rgb[i * 3], lut.rows.rgb[i * 3 + 1], lut.rows.rgb[i * 3 + 2]], 0.16, s).map((v) => v.toString(16).padStart(2, "0")).join("");
      assert.equal(R["rows-projection"].sample(lut, i, s), want, `rows-projection ${theme} ${i}`);
      assert.equal(R["rows-projection"].sample(lut, i, s), E.lut.composite("rows", 0.16, s).css[i]);
      assert.notEqual(R["rows-projection"].sample(lut, i, s), lut.rows.css[i], "not the raw colour");
    }
  }
});

// ---- GLYPHS ----

test("GLYPHS: the alphabet of B.9, keyed by id, each entry naming an existing role", () => {
  assert.ok(!Array.isArray(E.role.GLYPHS) && Object.isFrozen(E.role.GLYPHS));
  assert.deepEqual(Object.keys(E.role.GLYPHS).sort(), Object.keys(GLYPH_TABLE).sort());
  for (const [id, [tags, kind, ink, key, readout, role]] of Object.entries(GLYPH_TABLE)) {
    const g = E.role.GLYPHS[id];
    assert.ok(Object.isFrozen(g), id);
    assert.equal(g.id, id);
    assert.deepEqual(Array.from(g.tag), tags, id + " tags");
    assert.equal(g.kind, kind);
    assert.equal(g.ink, ink);
    assert.equal(g.key, key);
    assert.equal(g.readout, readout);
    assert.equal(g.role, role);
    assert.ok(E.role.ROLES[g.role], `${id} names an existing role`);
    assert.equal(g.s1, true);
    assert.equal(typeof g.minPx, "number");
    assert.equal(typeof g.geometry, "string");
    assert.equal(g.ground, g.pattern !== null ? "surface" : null, id + ": a pattern draws its own surface ground");
  }
  // Ink is one of the two tokens that pass 3:1 on the surface; never --ol-line or --ol-neutral (DR-20).
  for (const g of Object.values(E.role.GLYPHS)) assert.ok(g.ink === "stateInk" || g.ink === "occupancy");
  // The pixel threshold: textures and the zero outline give way to a flat fill below 4 css px.
  for (const id of ["pattern-slate", "pattern-dots", "pattern-cross", "pattern-slash", "zero-outline"]) assert.equal(E.role.GLYPHS[id].minPx, 4, id);
  assert.deepEqual(
    Object.fromEntries(["pattern-slate", "pattern-dots", "pattern-cross", "pattern-slash", "infinity"].map((id) => [id, E.role.GLYPHS[id].pattern.period])),
    { "pattern-slate": 6, "pattern-dots": 5, "pattern-cross": 6, "pattern-slash": 6, "infinity": 10 },
    "periods of B.9: 6, 5, 6, 6 css px, and the 10 px infinity plate"
  );
});

test("glyphFor: every typed tag maps to exactly one glyph (or to none), by index and by name", () => {
  assert.deepEqual(Array.from(E.result.TAGS), TAG_GLYPH.map((p) => p[0]), "the tag order the table is written against");
  TAG_GLYPH.forEach(([tag, glyph], index) => {
    assert.equal(E.role.glyphFor(index), glyph, `index ${index} (${tag})`);
    assert.equal(E.role.glyphFor(E.result.TAG[tag]), glyph, `E.result.TAG.${tag}`);
    assert.equal(E.role.glyphFor(tag), glyph, `name ${tag}`);
    if (glyph !== null) {
      assert.ok(E.role.GLYPHS[glyph], glyph + " exists");
      assert.ok(Array.from(E.role.GLYPHS[glyph].tag).includes(tag), `${glyph} lists ${tag} among the tags it marks`);
      assert.ok(E.role.ROLES[E.role.GLYPHS[glyph].role], "and has a role");
    }
  });
  // Both directions: a pattern glyph lists exactly the tags that map to it.
  for (const id of ["pattern-slate", "pattern-dots", "pattern-cross", "pattern-slash", "infinity"]) {
    const mapped = TAG_GLYPH.filter((p) => p[1] === id).map((p) => p[0]).sort();
    assert.deepEqual(Array.from(E.role.GLYPHS[id].tag).sort(), mapped, id);
  }
  assert.throws(() => E.role.glyphFor(99), /unknown tag/);
  assert.throws(() => E.role.glyphFor("nonsense"), /unknown tag/);
  assert.throws(() => E.role.glyphFor(-1), /unknown tag/);
});

test("the single table: pending is dots, failed a cross, unsupported a slash, the rest neutral hatching, negative infinity its own mark", () => {
  const G = (t) => E.role.glyphFor(t);
  assert.equal(G("pending"), "pattern-dots");
  assert.equal(G("failed"), "pattern-cross");
  assert.equal(G("invalid-input"), "pattern-cross", "invalid input shares the cross; its key is separate (B.1)");
  assert.equal(G("unsupported"), "pattern-slash");
  for (const t of ["undefined", "no-reference", "empty-both", "empty-population", "no-coarser-parent", "waiting-for-complete-parent"]) assert.equal(G(t), "pattern-slate", t);
  assert.equal(G("negative-infinite"), "infinity");
  for (const t of ["finite", "outside-support", "hidden"]) assert.equal(G(t), null, t + " draws no pattern");
  // The other glyphs of the alphabet have their own callers: the hollow diamond (an undefined column
  // baseline), the edge triangles (finite under and overflow), the zero tick and the zero outline.
  assert.equal(E.role.GLYPHS.diamond.readout, "undefined");
  assert.equal(E.role.GLYPHS["tri-down"].readout, "clip-low");
  assert.equal(E.role.GLYPHS["tri-up"].readout, "clip-high");
  assert.equal(E.role.GLYPHS.tick.readout, "zero");
});

// ---- paint: one glyph, one path ----

test("paint tick: an open 2-vertex line 1.5 px wide across the slot, centred on the baseline", () => {
  const ctx = recorder();
  E.role.paint(ctx, "tick", 50, 20, 12, "#123456");
  const [p] = pathsOf(ctx);
  assert.equal(pathsOf(ctx).length, 1);
  assert.deepEqual(p.verts, [[44, 20], [56, 20]]);
  assert.equal(p.closed, false);
  assert.equal(p.painted, "stroke");
  assert.equal(p.style.lineWidth, 1.5);
  assert.equal(p.style.strokeStyle, "#123456");
  assert.ok(balanced(ctx));
  const wide = recorder();
  E.role.paint(wide, "tick", 50, 20, 12, "#123456", { width: 20 });
  assert.deepEqual(pathsOf(wide)[0].verts, [[40, 20], [60, 20]], "opts.width is the slot width");
});

test("paint diamond: a hollow closed 4-vertex path, 6 px, 1.25 px stroke", () => {
  const ctx = recorder();
  E.role.paint(ctx, "diamond", 50, 20, 6, "#abcdef");
  const [p] = pathsOf(ctx);
  assert.deepEqual(p.verts, [[50, 17], [53, 20], [50, 23], [47, 20]]);
  assert.equal(p.closed, true);
  assert.equal(p.painted, "stroke", "hollow: stroked, not filled");
  assert.equal(p.style.lineWidth, 1.25);
  assert.equal(p.style.strokeStyle, "#abcdef");
  assert.equal(count(ctx, "fill"), 0);
  assert.ok(balanced(ctx));
});

test("paint tri-down and tri-up: a filled closed triangle, the apex pointing the way the value left the axis", () => {
  const down = recorder();
  E.role.paint(down, "tri-down", 10, 10, 6, "#111");
  const [d] = pathsOf(down);
  assert.deepEqual(d.verts, [[7, 7], [13, 7], [10, 13]], "underflow: base on top, apex down");
  assert.equal(d.closed, true);
  assert.equal(d.painted, "fill");
  assert.equal(d.style.fillStyle, "#111");
  const up = recorder();
  E.role.paint(up, "tri-up", 10, 10, 6, "#111");
  assert.deepEqual(pathsOf(up)[0].verts, [[7, 13], [13, 13], [10, 7]], "overflow: base below, apex up");
  assert.equal(count(down, "stroke") + count(up, "stroke"), 0);
});

test("paint zero-outline and outline: a 1 px outline inset by half a pixel, the size of the box", () => {
  for (const id of ["zero-outline", "outline"]) {
    const ctx = recorder();
    E.role.paint(ctx, id, 10, 10, 8, "#777");
    const [s] = ctx.ops.filter((o) => o.name === "strokeRect");
    assert.deepEqual(s.args, [6.5, 6.5, 7, 7], id);
    assert.equal(s.state.lineWidth, 1, "an explicit 1 px line width (a stale width would leak from the last draw)");
    assert.equal(s.state.strokeStyle, "#777");
    assert.ok(balanced(ctx));
    const cell = recorder();
    E.role.paint(cell, id, 20, 10, 8, "#777", { width: 10, height: 6 });
    assert.deepEqual(cell.ops.filter((o) => o.name === "strokeRect")[0].args, [15.5, 7.5, 9, 5], id + " in a 10 x 6 cell");
  }
});

test("paint infinity: a plate with a hairline border and the minus-infinity text, centred", () => {
  const ctx = recorder();
  E.role.paint(ctx, "infinity", 20, 20, 10, "#345", { ground: "#fff" });
  const ops = ctx.ops.filter((o) => !o.name.startsWith("="));
  const fill = ops.find((o) => o.name === "fillRect");
  assert.deepEqual(fill.args, [15, 15, 10, 10]);
  assert.equal(fill.state.fillStyle, "#fff");
  assert.deepEqual(ops.find((o) => o.name === "strokeRect").args, [15.5, 15.5, 9, 9]);
  const text = ops.find((o) => o.name === "fillText");
  assert.equal(text.args[0], "−∞", "U+2212 minus sign, U+221E infinity");
  assert.deepEqual(text.args.slice(1), [20, 20.5]);
  assert.equal(text.state.fillStyle, "#345");
  assert.equal(text.state.textAlign, "center");
  assert.ok(balanced(ctx));
  const noGround = recorder();
  E.role.paint(noGround, "infinity", 20, 20, 10, "#345");
  assert.equal(count(noGround, "fillRect"), 0, "no ground unless asked");
});

test("paint patterns: one clipped path, one stroke (lines) or one fill (dots), the ink as given, the ground only when asked", () => {
  for (const id of ["pattern-slate", "pattern-cross", "pattern-slash"]) {
    const ctx = recorder();
    E.role.paint(ctx, id, 30, 30, 12, "#8a8", { ground: "#fff" });
    assert.equal(count(ctx, "stroke"), 1, id + ": one stroke, so a probe sees one path");
    assert.equal(count(ctx, "fill"), 0);
    assert.equal(count(ctx, "clip"), 1, "clipped to its box");
    const stroke = ctx.ops.find((o) => o.name === "stroke");
    assert.equal(stroke.state.strokeStyle, "#8a8");
    assert.equal(stroke.state.lineWidth, 1, "1 px hairlines");
    const clip = ctx.ops.find((o) => o.name === "rect");
    assert.deepEqual(clip.args, [24, 24, 12, 12]);
    assert.deepEqual(ctx.ops.find((o) => o.name === "fillRect").args, [24, 24, 12, 12]);
    assert.ok(balanced(ctx));
    const bare = recorder();
    E.role.paint(bare, id, 30, 30, 12, "#8a8");
    assert.equal(count(bare, "fillRect"), 0, id + ": no ground unless asked");
  }
  const dots = recorder();
  E.role.paint(dots, "pattern-dots", 10, 10, 10, "#8a8");
  assert.equal(count(dots, "fill"), 1);
  assert.equal(count(dots, "stroke"), 0);
  // A 10 x 10 box at 5 px period: dots at 2.5 and 7.5 in each direction, 1.25 px across.
  const arcs = pathsOf(dots)[0].arcs;
  assert.equal(arcs.length, 4);
  assert.deepEqual(arcs.map((a) => [a.x - 5, a.y - 5]).sort(), [[2.5, 2.5], [2.5, 7.5], [7.5, 2.5], [7.5, 7.5]].sort());
  for (const a of arcs) assert.equal(a.r, 0.625);
});

test("below 4 css px a texture or the zero outline is a flat fill at 30% of the ink, and the readout carries the tag", () => {
  for (const id of ["pattern-slate", "pattern-dots", "pattern-cross", "pattern-slash", "zero-outline"]) {
    const flat = recorder();
    E.role.paint(flat, id, 10, 10, 3, "#8a8");
    assert.equal(count(flat, "stroke") + count(flat, "strokeRect") + count(flat, "fill"), 0, id + ": no texture");
    const [f] = flat.ops.filter((o) => o.name === "fillRect");
    assert.deepEqual(f.args, [8.5, 8.5, 3, 3]);
    assert.equal(f.state.globalAlpha, 0.3);
    assert.equal(f.state.fillStyle, "#8a8");
    assert.ok(balanced(flat), "globalAlpha is restored");
    // Either dimension counts: a 3 px high, 50 px wide slice is flat too.
    const thin = recorder();
    E.role.paint(thin, id, 10, 10, 50, "#8a8", { height: 3 });
    assert.equal(count(thin, "stroke") + count(thin, "strokeRect"), 0, id + " thin");
    // At exactly 4 px the texture is drawn.
    const four = recorder();
    E.role.paint(four, id, 10, 10, 4, "#8a8");
    assert.ok(count(four, "stroke") + count(four, "strokeRect") + count(four, "fill") >= 1, id + " at 4 px");
  }
  // The marks that are counted, not shrunk, are unaffected by size.
  const tiny = recorder();
  E.role.paint(tiny, "diamond", 5, 5, 2, "#000");
  assert.equal(count(tiny, "stroke"), 1);
});

test("paint refuses an unknown glyph", () => {
  assert.throws(() => E.role.paint(recorder(), "star", 0, 0, 6, "#000"), /unknown glyph/);
});

// ---- textures are periodic hairline families (analytic oracle) ----

// Distance from (u, v) to the nearest recorded segment.
function distToSegments(verts, moves, u, v) {
  let best = Infinity;
  for (let i = 0; i + 1 < verts.length; i += 2) {
    const [ax, ay] = verts[i];
    const [bx, by] = verts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(u - (ax + t * dx), v - (ay + t * dy)));
  }
  return best;
}
// The analytic family: "/" is x + y = k P, "\" is x - y = c P, "x" is both; a pixel is inked when within half a line of a member.
function analyticInk(kind, P, u, v, lw) {
  const near = (s) => {
    const r = ((s % P) + P) % P;
    return Math.min(r, P - r) / Math.SQRT2 <= lw / 2;
  };
  if (kind === "/") return near(u + v);
  if (kind === "\\") return near(u - v);
  return near(u + v) || near(u - v);
}

for (const [id, kind] of [["pattern-slate", "/"], ["pattern-slash", "\\"], ["pattern-cross", "x"]]) {
  test(`${id}: the recorded segments of a tile are the analytic hairline family "${kind}" with period 6, and repeat at the tile edge`, () => {
    const P = 6;
    const ctx = recorder();
    E.role.paint(ctx, id, P / 2, P / 2, P, "#000", { width: P, height: P });
    const [p] = pathsOf(ctx);
    assert.equal(p.verts.length % 2, 0, "moveTo/lineTo pairs");
    // Sample a fine grid over the tile and one period beyond it in each direction (the tile edge matters).
    let checked = 0;
    for (let iu = 0; iu <= 24; iu++)
      for (let iv = 0; iv <= 24; iv++) {
        const u = (iu / 24) * P;
        const v = (iv / 24) * P;
        const drawn = distToSegments(p.verts, p.moves, u, v) <= 0.5 - 1e-9;
        const expected = analyticInk(kind, P, u, v, 1);
        // Points that lie within a hair of the stroke boundary are ambiguous by construction; skip them.
        const margin = Math.abs(distToSegments(p.verts, p.moves, u, v) - 0.5);
        if (margin < 1e-6) continue;
        assert.equal(drawn, expected, `${id} at (${u.toFixed(2)}, ${v.toFixed(2)})`);
        checked++;
      }
    assert.ok(checked > 500);
    // Periodicity across the tile edge, from the analytic family (a seamless tile is one that agrees with itself shifted by P).
    for (let i = 0; i <= 12; i++) {
      const w = (i / 12) * P;
      assert.equal(analyticInk(kind, P, 0, w, 1), analyticInk(kind, P, P, w, 1), "left edge equals right edge");
      assert.equal(analyticInk(kind, P, w, 0, 1), analyticInk(kind, P, w, P, 1), "top edge equals bottom edge");
    }
  });
}

// ---- tile: DPR compensated ----

function tileOf(kind, dpr, extra) {
  const made = [];
  const ctx = recorder();
  const canvas = { width: 0, height: 0, getContext: (type) => (type === "2d" ? ctx : null) };
  const out = E.role.tile(kind, { dpr, ink: "#456", ground: "#fefefe", makeCanvas: (w, h) => (made.push([w, h]), extra && extra.stale ? { width: 1, height: 1, getContext: canvas.getContext } : canvas), font: undefined });
  return { made, ctx, canvas, out };
}

test("tile: the side is round(period * dpr) device pixels, and the geometry is scaled to fit (DPR compensated)", () => {
  // hand-worked: period 6 -> 6, 9, 12, 15, 18, 5 ; period 5 -> 5, 8, 10, 13, 15, 4 (Math.round, half up)
  const dprs = [1, 1.5, 2, 2.5, 3, 0.75];
  const sizes = { "pattern-slate": [6, 9, 12, 15, 18, 5], "pattern-cross": [6, 9, 12, 15, 18, 5], "pattern-slash": [6, 9, 12, 15, 18, 5], "pattern-dots": [5, 8, 10, 13, 15, 4], "infinity": [10, 15, 20, 25, 30, 8] };
  for (const [kind, want] of Object.entries(sizes))
    dprs.forEach((dpr, i) => {
      const { made, canvas, out, ctx } = tileOf(kind, dpr);
      assert.deepEqual(made, [[want[i], want[i]]], `${kind} at dpr ${dpr}`);
      assert.equal(out, canvas, "the canvas the factory made is returned");
      const period = kind === "pattern-dots" ? 5 : kind === "infinity" ? 10 : 6;
      const scale = ctx.ops.find((o) => o.name === "scale");
      assert.ok(Math.abs(scale.args[0] - want[i] / period) < 1e-12 && scale.args[0] === scale.args[1], `${kind} dpr ${dpr}: scale ${scale.args}`);
      assert.ok(balanced(ctx));
    });
});

test("tile: the tile carries its own ground and ink, and takes the size even when the factory did not set it", () => {
  const { ctx, out: canvas } = tileOf("pattern-slate", 2, { stale: true });
  const fills = ctx.ops.filter((o) => o.name === "fillRect");
  assert.deepEqual(fills[0].args, [0, 0, 6, 6], "the ground covers the tile, in css px under the scale");
  assert.equal(fills[0].state.fillStyle, "#fefefe");
  const stroke = ctx.ops.find((o) => o.name === "stroke");
  assert.equal(stroke.state.strokeStyle, "#456");
  assert.equal(stroke.state.lineWidth, 1);
  assert.equal(canvas.width, 12, "asked of a canvas of the wrong size, the tile sets it");
  assert.equal(canvas.height, 12);
});

test("tile: kinds by glyph id, short name or typed tag; a glyph that is not a texture is refused; a bad dpr is 1", () => {
  const side = (kind, dpr = 1) => tileOf(kind, dpr).made[0][0];
  assert.equal(side("pattern-dots"), 5);
  assert.equal(side("dots"), 5);
  assert.equal(side("pending"), 5, "the typed tag the lens passes: patternFor(\"pending\")");
  assert.equal(side("failed"), 6);
  assert.equal(side("unsupported"), 6);
  assert.equal(side("undefined"), 6);
  assert.equal(side("negative-infinite"), 10, "the infinity mark tiles as a 10 px plate");
  for (const bad of ["tick", "diamond", "tri-up", "zero-outline", "outline", "finite", "hidden", "outside-support", "nonsense"])
    assert.throws(() => tileOf(bad, 1), /not a pattern glyph/, bad);
  assert.equal(side("pattern-slate", 0), 6, "dpr 0 is treated as 1");
  assert.equal(side("pattern-slate", NaN), 6);
  assert.equal(side("pattern-slate", -2), 6);
  const inf = tileOf("infinity", 1);
  const text = inf.ctx.ops.find((o) => o.name === "fillText");
  assert.equal(text.args[0], "−∞");
});

// ---- keys ----

test("keyEntries: the id, glyph, role, text key and count of each requested key, in the order asked", () => {
  const ids = Object.keys(KEY_TABLE);
  const counts = {};
  ids.forEach((id, i) => (counts[id] = i));
  const out = Array.from(E.role.keyEntries(ids, counts));
  assert.deepEqual(out.map((k) => k.id), ids);
  out.forEach((k, i) => {
    const [glyph, key] = KEY_TABLE[k.id];
    assert.equal(k.glyph, glyph, k.id);
    assert.equal(k.key, key, k.id);
    assert.equal(k.count, i, k.id);
    assert.equal(k.role, glyph === null ? null : E.role.GLYPHS[glyph].role, k.id);
    assert.equal(typeof k.label, "string");
  });
  // The parallel-array form, missing counts, and counts that are not counts.
  const arr = Array.from(E.role.keyEntries(["zero", "pending", "failed"], [3, 0, 7]));
  assert.deepEqual(arr.map((k) => k.count), [3, 0, 7]);
  assert.deepEqual(Array.from(E.role.keyEntries(["zero", "pending"], { zero: 2 })).map((k) => k.count), [2, 0]);
  assert.deepEqual(Array.from(E.role.keyEntries(["zero"], null)).map((k) => k.count), [0]);
  assert.deepEqual(Array.from(E.role.keyEntries(["zero", "pending", "failed"], { zero: -4, pending: NaN, failed: "x" })).map((k) => k.count), [0, 0, 0]);
  assert.deepEqual(Array.from(E.role.keyEntries([], {})), []);
});

test("keyEntries: `finite` and `hidden` have no key, an unknown id is a caller bug, and every typed tag is either keyed or one of those two", () => {
  assert.deepEqual(Array.from(E.role.keyEntries(["finite", "hidden"], {})), []);
  assert.throws(() => E.role.keyEntries(["bogus"], {}), /unknown key id/);
  for (const tag of E.result.TAGS) {
    if (tag === "finite" || tag === "hidden") continue;
    assert.ok(Array.from(E.role.keyEntries([tag], {})).length === 1, tag + " has a key");
  }
  // Every key that has a swatch is drawn with a glyph of the alphabet.
  for (const [id, [glyph]] of Object.entries(KEY_TABLE)) assert.ok(glyph === null || E.role.GLYPHS[glyph], id);
});

// ---- the strings the table names ----

function textAt(path) {
  let v = E.text;
  for (const part of path.split(".")) {
    if (v === undefined || v === null) return undefined;
    v = v[part];
  }
  return v;
}

test("every E.text key the table names resolves to a string, once part 04 is present", (t) => {
  if (E.text === undefined) {
    t.todo("part 04-text is not loaded (W1-F); the keys are listed for it in the report (amendment request: role.* keys)");
    return;
  }
  const wanted = new Set();
  for (const r of Object.values(E.role.ROLES)) {
    wanted.add(r.label);
    wanted.add(r.accessibleName);
  }
  for (const g of Object.values(E.role.GLYPHS)) wanted.add(g.key);
  for (const [, key] of Object.values(KEY_TABLE)) wanted.add(key);
  const missing = [...wanted].filter((k) => typeof textAt(k) !== "string");
  // The role.* keys are not in INTEGRATION.md D.11 (amendment request in the W1-D report); until W1-F adds
  // them this is reported as a todo, not a failure. Every key that IS in D.11 must resolve.
  const d11 = missing.filter((k) => !k.startsWith("role."));
  assert.deepEqual(d11, [], "keys of D.11 that do not resolve");
  if (missing.length) t.todo("missing E.text keys: " + missing.join(", "));
});

test("keyEntries labels come from E.text when present and fall back to the key when not", () => {
  const [k] = Array.from(E.role.keyEntries(["zero"], { zero: 1 }));
  if (E.text === undefined) assert.equal(k.label, "key.zero", "part 04 absent: the key is the label");
  else assert.equal(k.label, typeof textAt("key.zero") === "string" ? textAt("key.zero") : "key.zero");
});
