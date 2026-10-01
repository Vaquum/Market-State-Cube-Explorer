"use strict";
// U61 (PRD-0002 S3, #48 section 4, states without hue): every declared state of a value remains obtainable when hue is removed. A state is a mark of a form (a
// pattern, an outline, a tick, a plate with text) drawn in the neutral state ink, or it is readout-only and has its own words, so removing every hue, in the
// pinned colour-vision simulations or in grayscale, removes nothing. Measure-specific overlaps (several undefined cases sharing one hatch) are allowed and are
// told apart by their words; missing versus zero is not allowed to overlap.
// Oracles (none is the code under test): the declared overlaps below, written out by hand from API.md B.9 (the table of tags and glyphs), the pinned simulations of
// tests/reference/cvd.js, the WCAG contrast of tests/reference/contrast.js and the tokens PARSED from src/explorer.css.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const cvd = require("../reference/cvd.js");
const ref = require("../reference/contrast.js");

const ROOT = path.resolve(__dirname, "../..");
const TOKENS = ref.tokensFromCss(fs.readFileSync(path.join(ROOT, "src/explorer.css"), "utf8"));
const THEMES = ["light", "dark"];
// The words of a state as a reader gets them, with the same parameters for every tag so that two tags with the same words are the same state to the reader.
const words = (tag) => E.result.describe({ tag, value: 1, reason: "why", denominator: "the denominator" }).short;
// What a mark is without its colour: its kind and its geometry.
function form(glyphId) {
  if (glyphId === null) return null;
  const g = E.role.GLYPHS[glyphId];
  return JSON.stringify({ kind: g.kind, lines: g.pattern ? g.pattern.lines : null, dots: g.pattern ? g.pattern.dots : null, period: g.pattern ? g.pattern.period : null, geometry: g.pattern ? null : g.geometry });
}
const tags = Array.from(E.result.TAGS);

test("a state drawn as a mark is drawn in a neutral ink, never in a market hue", () => {
  for (const tag of tags) {
    const id = E.role.glyphFor(tag);
    if (id === null) continue;
    assert.ok(["stateInk", "occupancy"].includes(E.role.GLYPHS[id].ink), `${tag}: ${id} is drawn in ${E.role.GLYPHS[id].ink}`);
  }
});

test("the marks that several tags share are the declared overlaps and no others, and the tags that share one have different words", () => {
  const byForm = new Map();
  for (const tag of tags) {
    const f = form(E.role.glyphFor(tag));
    if (f === null) continue;
    byForm.set(f, [...(byForm.get(f) ?? []), tag]);
  }
  const shared = [...byForm.values()].filter((g) => g.length > 1).map((g) => g.slice().sort());
  const declared = [
    // a value that is undefined, for each of the reasons the ratio can be: one hatch, and the words say which
    ["empty-both", "empty-population", "no-coarser-parent", "no-reference", "undefined", "waiting-for-complete-parent"],
    // a read or an input that did not succeed
    ["failed", "invalid-input"],
  ];
  assert.deepEqual(shared.sort((a, b) => a[0].localeCompare(b[0])), declared.map((g) => g.slice().sort()).sort((a, b) => a[0].localeCompare(b[0])));
  // within a group the reader's words separate the cases (two tags with the same words are one case to the reader: empty-population and undefined)
  for (const group of declared) {
    const classes = new Set(group.map(words));
    assert.ok(classes.size >= (group.includes("undefined") ? 5 : 2), `${group}: ${[...classes].join(" | ")}`);
  }
  // the marks that are not shared are each their own form
  const unshared = [...byForm.entries()].filter(([, g]) => g.length === 1).map(([f]) => f);
  assert.equal(new Set(unshared).size, unshared.length);
});

test("missing is never zero: the marks of an unknown, pending, failed or unsupported value are patterns, the zero is an outline or a tick, and their forms differ", () => {
  const zero = ["zero-outline", "tick"].map((id) => form(id));
  const missing = ["undefined", "no-reference", "empty-both", "pending", "failed", "unsupported", "waiting-for-complete-parent", "negative-infinite"].map((t) => [t, E.role.glyphFor(t)]);
  for (const [tag, id] of missing) {
    assert.ok(id !== null, `${tag} has a mark of its own`);
    assert.ok(!zero.includes(form(id)), `${tag} is drawn like a zero`);
  }
  for (const [tag, id] of missing.filter(([t]) => t !== "negative-infinite")) assert.equal(E.role.GLYPHS[id].kind, "pattern tile", `${tag} is a pattern`);
  for (const id of ["zero-outline", "tick"]) assert.notEqual(E.role.GLYPHS[id].kind, "pattern tile", `${id}: a zero is not a pattern`);
  // and the zero's own role is a state of its own in the table
  assert.deepEqual(E.role.GLYPHS["zero-outline"].tag.slice(), ["finite"]);
  assert.equal(E.role.GLYPHS["zero-outline"].readout, "zero");
});

test("a state with no mark of its own is a readout state with words of its own (outside comparison support, hidden in replay, a plain value)", () => {
  const readoutOnly = tags.filter((t) => E.role.glyphFor(t) === null);
  assert.deepEqual(readoutOnly.slice().sort(), ["finite", "hidden", "outside-support"]);
  const seen = new Set();
  for (const tag of tags) {
    const w = words(tag);
    assert.ok(w.length > 0, tag);
    if (readoutOnly.includes(tag) && tag !== "finite") assert.ok(!tags.filter((t) => t !== tag && E.role.glyphFor(t) !== null).some((t) => words(t) === w), `${tag}: its words are another state's`);
    seen.add(w);
  }
  assert.ok(words("outside-support") !== words("hidden"));
});

for (const theme of THEMES)
  test(`${theme}: the state ink keeps its 3:1 over the surface under grayscale and every colour-vision simulation, so no state mark vanishes with hue`, () => {
    const ink = TOKENS["--ol-state"][theme],
      surface = TOKENS["--ol-surface"][theme],
      occupancy = TOKENS["--ol-occupancy"][theme];
    for (const c of cvd.CONDITIONS) {
      assert.ok(ref.contrast(cvd.under(ink, c), cvd.under(surface, c)) >= 3, `${theme} ${c.id}: the state ink over the surface`);
      assert.ok(ref.contrast(cvd.under(occupancy, c), cvd.under(surface, c)) >= 3, `${theme} ${c.id}: the occupancy ink over the surface`);
    }
  });

test("the empirical distinctions the references make carry no hue: matching and all states are a square and a ring, the four patterns are four dash arrays, and each family has a name", () => {
  const compare = E.role.referenceFamily("compare");
  assert.deepEqual({ ...compare.glyph }, { matching: "square", all: "circle" });
  const dash = Object.values(E.role.REFERENCE.PATTERN).map((p) => JSON.stringify(Array.from(p)));
  assert.equal(new Set(dash).size, dash.length - (dash.includes("[]") ? 0 : 0), "four patterns that differ");
  assert.equal(dash.length, 4);
  assert.equal(new Set(Object.values(E.role.REFERENCE.PATTERN_NAMES)).size, 4, "and have four names");
  for (const f of E.role.REFERENCE.FAMILIES) assert.ok(f.name.length > 2 && f.identification.length > 0, `${f.id} has a name and an identification`);
  // two families that share a neutral hue (the clock and the historical comparison) are told apart by name and glyph
  const neutral = E.role.REFERENCE.FAMILIES.filter((f) => f.hue === "neutral");
  assert.ok(neutral.length >= 2);
  for (let i = 0; i < neutral.length; i++) for (let j = i + 1; j < neutral.length; j++) assert.notEqual(neutral[i].name, neutral[j].name);
});
