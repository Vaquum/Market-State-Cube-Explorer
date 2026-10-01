"use strict";
// U59 (PRD-0002 S3, #48 section 4, the sign mark): E.role.SIGN, the table of the plus, the minus and the ring a signed cell carries where it is big enough.
// Oracles (none is the code under test): tests/reference/contrast.js (a WCAG contrast written from the definition), the tokens PARSED from src/explorer.css,
// and the arithmetic of the PRD written out here (a mark covers at most a fifth of the smallest cell that carries it; a mark is a graphic object, 3:1 over its
// fill; the arms are the LUT's own entries).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const ref = require("../reference/contrast.js");

const ROOT = path.resolve(__dirname, "../..");
const TOKENS = ref.tokensFromCss(fs.readFileSync(path.join(ROOT, "src/explorer.css"), "utf8"));
const THEMES = ["light", "dark"];
const entry = (ramp, i) => [ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]];
const css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

test("the three signed roles have a shape each and nothing else has one", () => {
  assert.deepEqual({ ...E.role.SIGN.SHAPES }, { positive: "plus", negative: "minus", midpoint: "zero" });
  assert.equal(E.role.signShape("positive"), "plus");
  assert.equal(E.role.signShape("negative"), "minus");
  assert.equal(E.role.signShape("midpoint"), "zero");
  for (const role of ["unsigned", "occupancy", "zero", "pattern", "rows", "none", "", "toString", "constructor"]) assert.equal(E.role.signShape(role), null, role);
  assert.ok(Object.isFrozen(E.role.SIGN) && Object.isFrozen(E.role.SIGN.SHAPES));
});

test("the table's numbers: 12 css px across each way, 6 px bars of 2 px, a ring of radius 2 and 2 px", () => {
  assert.equal(E.role.SIGN.MIN_PX, 12);
  assert.equal(E.role.SIGN.RAISE_PX, 16);
  assert.equal(E.role.SIGN.SIZE, 6);
  assert.equal(E.role.SIGN.STROKE, 2);
  assert.equal(E.role.SIGN.RING_RADIUS, 2);
});

test("a mark covers what its strokes cover, counted once, and at most a fifth of the smallest cell that carries it", () => {
  const cover = (shape) => E.role.signCoverage(shape);
  // two bars of 6 x 2 that cross in a 2 x 2 square, one bar, an annulus between radius 1 and 3
  assert.equal(cover("plus"), 2 * 6 * 2 - 2 * 2);
  assert.equal(cover("minus"), 6 * 2);
  assert.ok(Math.abs(cover("zero") - Math.PI * (3 * 3 - 1 * 1)) < 1e-9);
  const smallest = E.role.SIGN.MIN_PX * E.role.SIGN.MIN_PX;
  for (const shape of ["plus", "minus", "zero"]) assert.ok(cover(shape) / smallest <= 0.2, `${shape} covers ${((100 * cover(shape)) / smallest).toFixed(1)}% of a 12 x 12 cell`);
  assert.throws(() => cover("cross"), RangeError);
  // a mark never reaches the edge of the smallest cell: its span is inside it with a margin
  assert.ok(E.role.SIGN.SIZE + E.role.SIGN.STROKE < E.role.SIGN.MIN_PX);
});

for (const theme of THEMES)
  test(`${theme}: the mark's ink is 3:1 or better over every entry of both signed arms and over the midpoint`, () => {
    const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, theme);
    const ink = TOKENS["--ol-ink"][theme];
    const surface = TOKENS["--ol-surface"][theme];
    let worst = Infinity;
    for (const arm of ["positive", "negative"])
      for (let i = 0; i < 256; i++) {
        const fill = entry(lut[arm], i);
        const which = E.role.signInk(css(fill), css(ink), css(surface));
        const chosen = which === "ink" ? ink : surface;
        const other = which === "ink" ? surface : ink;
        const ratio = ref.contrast(chosen, fill);
        assert.ok(ratio >= 3, `${arm} ${i}: ${which} is only ${ratio.toFixed(2)}:1`);
        assert.ok(ratio >= ref.contrast(other, fill) - 1e-9, `${arm} ${i}: the other colour contrasts more`);
        worst = Math.min(worst, ratio);
      }
    const mid = Array.from(lut.midpoint.rgb);
    const which = E.role.signInk(css(mid), css(ink), css(surface));
    assert.ok(ref.contrast(which === "ink" ? ink : surface, mid) >= 3, "the midpoint's mark");
    assert.ok(worst >= 3, `the worst case over both arms is ${worst.toFixed(2)}:1`);
  });

test("the rule picks the colour that contrasts more, ties to ink, accepts triples and refuses what is not a colour", () => {
  assert.equal(E.role.signInk("rgb(255, 255, 255)", "rgb(0, 0, 0)", "rgb(255, 255, 255)"), "ink");
  assert.equal(E.role.signInk("rgb(0, 0, 0)", "rgb(0, 0, 0)", "rgb(255, 255, 255)"), "surface");
  assert.equal(E.role.signInk([10, 10, 10], [0, 0, 0], [255, 255, 255]), "surface");
  assert.equal(E.role.signInk("#808080", "#808080", "#808080"), "ink", "a tie goes to ink");
  assert.throws(() => E.role.signInk("transparent", "rgb(0, 0, 0)", "rgb(255, 255, 255)"), RangeError);
});

test("the painter and the key read the table: no literal 12, 6 or 2 of the mark lives in the page", () => {
  const js = fs.readFileSync(path.join(ROOT, "src/explorer.js"), "utf8");
  const a = js.indexOf("    sign(c, x, y, w, h, ink, shape = \"plus\") {");
  assert.ok(a > 0, "the painter is in the stroke table");
  const painter = js.slice(a, js.indexOf("    // The taker-buy part of a profile row", a));
  for (const name of ["SIZE", "STROKE", "RING_RADIUS", "RAISE_PX"]) assert.ok(painter.includes(`S.${name}`), `the painter reads SIGN.${name}`);
  const mark = js.slice(js.indexOf("  function signMark("), js.indexOf("  function markLine("));
  assert.ok(mark.includes("E.role.SIGN.MIN_PX"), "the threshold is the table's");
  assert.ok(!/\b12\b/.test(painter + mark), "no literal 12");
});
