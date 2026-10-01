"use strict";
// U19 (T-lut, contrast): the contrast of the real tokens and of the LUT colours the code draws.
// Oracles (none is the code under test): tests/reference/contrast.js, a WCAG 2.x contrast written from the
// definition with its own linearisation table and validated below on published anchors (black on white
// 21:1; #767676 on white 4.54:1 and #949494 on white 3.03:1, the examples of the WCAG 2 documentation);
// the colour tokens PARSED from src/explorer.css (both themes, light-dark()); the numbers hand-computed in
// API.md B.9 and Appendix A.1 (--ol-border 3.57/3.88, --ol-muted 5.20/7.78, the bar 3.10/4.04 composited
// and 7.10/7.65 solid, the retired entry 153 at 2.94, --ol-line 1.32/1.76, --ol-midpoint 1.83/3.03); and
// fixtures/contrast/new-controls.json (hand-authored thresholds: 4.5 for small text, 3 for an essential
// boundary, from WCAG 2.x and D11).
// What is checked, and over what, is exactly what the code draws (API.md B.9, FA-13): a state or occupancy
// mark over the EMPTY surface, a pattern tile on its own surface ground, the unsigned bar at the opacity it
// is painted with. Outlines coloured from the LUT lie on the measurement gradient, which D11 exempts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const ref = require("../reference/contrast.js");

const ROOT = path.resolve(__dirname, "../..");
const TOKENS = ref.tokensFromCss(fs.readFileSync(path.join(ROOT, "src/explorer.css"), "utf8"));
const CONTROLS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/contrast/new-controls.json"), "utf8")).rows;
const THEMES = ["light", "dark"];
const r2 = (x) => Math.round(x * 100) / 100;
const entry = (ramp, i) => [ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]];

// One row of new-controls.json on one theme: the ratio of its foreground over its backdrop, the foreground
// composited at `alpha` first when the mark is painted translucent.
function ratio(row, theme) {
  const bg = TOKENS[row.bg][theme];
  let fg;
  if (row.fg === "lut.bar") fg = Array.from(E.lut.build(E.lut.DEFAULT_APPEARANCE, theme).bar.rgb);
  else fg = TOKENS[row.fg][theme];
  if (row.alpha !== undefined) fg = ref.over(fg, row.alpha, bg);
  return ref.contrast(fg, bg);
}

// ---- the reference itself ----

test("the reference contrast reproduces the published anchors", () => {
  const hex = ref.hexToRgb;
  assert.equal(ref.contrast([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(ref.contrast([255, 255, 255], [255, 255, 255]), 1);
  assert.equal(r2(ref.contrast(hex("#767676"), [255, 255, 255])), 4.54);
  assert.equal(r2(ref.contrast(hex("#949494"), [255, 255, 255])), 3.03);
  assert.equal(ref.contrast(hex("#123456"), hex("#abcdef")), ref.contrast(hex("#abcdef"), hex("#123456")), "symmetric");
});

test("E.lut.contrast and E.lut.over equal the reference on 3,000 seeded colours and opacities", () => {
  let a = 7;
  const next = () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
  for (let n = 0; n < 3000; n++) {
    const f = [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)];
    const b = [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)];
    const alpha = next();
    assert.ok(Math.abs(E.lut.contrast(f, b) - ref.contrast(f, b)) < 1e-12);
    assert.deepEqual(Array.from(E.lut.over(f, alpha, b)), ref.over(f, alpha, b));
  }
  assert.equal(E.lut.contrast([0, 0, 0], [255, 255, 255]), 21);
});

test("the CSS token parser resolves light-dark(), var() and 3-digit hex from the real file", () => {
  assert.deepEqual(TOKENS["--ol-surface"], { light: [255, 255, 255], dark: [22, 31, 25] }, "#fff shorthand and light-dark()");
  assert.deepEqual(TOKENS["--ol-occupancy"], TOKENS["--ol-border"], "var() resolves");
  assert.deepEqual(TOKENS["--ol-state"], TOKENS["--ol-muted"]);
  assert.equal(TOKENS["--sp-1"], undefined, "a size is not a colour");
  assert.ok(Object.keys(TOKENS).length >= 22, "the colour tokens (the Volume green, the evidence violet and the interim legacy names are retired)");
});

// ---- the tokens the non-value marks are made of ----

test("--ol-border (occupancy) and --ol-muted (stateInk) over the empty surface, the values of API.md B.9", () => {
  const want = { "--ol-border": [3.57, 3.88], "--ol-muted": [5.2, 7.78] };
  for (const [name, [light, dark]] of Object.entries(want)) {
    assert.equal(r2(ref.contrast(TOKENS[name].light, TOKENS["--ol-surface"].light)), light, name + " light");
    assert.equal(r2(ref.contrast(TOKENS[name].dark, TOKENS["--ol-surface"].dark)), dark, name + " dark");
    for (const theme of THEMES) assert.ok(ref.contrast(TOKENS[name][theme], TOKENS["--ol-surface"][theme]) >= 3, name + " meets the 3:1 boundary rule");
  }
  for (const name of ["--ol-occupancy", "--ol-state"])
    for (const theme of THEMES) assert.ok(ref.contrast(TOKENS[name][theme], TOKENS["--ol-surface"][theme]) >= 3, name);
  // stateInk is also read as small text (legend detail lines) on the surface and the panel.
  for (const theme of THEMES) for (const bg of ["--ol-surface", "--ol-panel"]) assert.ok(ref.contrast(TOKENS["--ol-state"][theme], TOKENS[bg][theme]) >= 4.5, `${bg} ${theme}`);
});

test("--ol-line and --ol-midpoint FAIL 3:1 on the surface and so must not colour a non-value mark", () => {
  const want = { "--ol-line": [1.32, 1.76], "--ol-midpoint": [1.83, 3.03] };
  for (const [name, [light, dark]] of Object.entries(want)) {
    assert.equal(r2(ref.contrast(TOKENS[name].light, TOKENS["--ol-surface"].light)), light, name + " light");
    assert.equal(r2(ref.contrast(TOKENS[name].dark, TOKENS["--ol-surface"].dark)), dark, name + " dark");
  }
  // Light theme: both fail outright. Dark theme: --ol-line fails; --ol-midpoint reaches 3.03 there but fails in light, so the role is unusable as a whole.
  assert.ok(ref.contrast(TOKENS["--ol-line"].light, TOKENS["--ol-surface"].light) < 3);
  assert.ok(ref.contrast(TOKENS["--ol-line"].dark, TOKENS["--ol-surface"].dark) < 3);
  assert.ok(ref.contrast(TOKENS["--ol-midpoint"].light, TOKENS["--ol-surface"].light) < 3);
  // The midpoint is a FILL colour (the retired neutral token's hexes), not an ink.
});

test("the glyph table never inks a mark with --ol-line or the midpoint", () => {
  for (const g of Object.values(E.role.GLYPHS)) assert.ok(g.ink === "stateInk" || g.ink === "occupancy", `${g.id} inks with ${g.ink}`);
});

test("a state or occupancy ink over a LUT entry is NOT what is checked: --ol-border falls to about 1:1 over entries of the ramp", () => {
  // The earlier claim that the inks "pass over the LUT" was false (FA-13). The checked backdrop is the empty
  // surface; over the ramp itself the contrast collapses, which is why LUT-coloured outlines are exempt.
  for (const theme of THEMES) {
    const lut = E.lut.build("slate2", theme);
    let lowest = Infinity;
    for (let i = 0; i < 256; i++) lowest = Math.min(lowest, ref.contrast(TOKENS["--ol-border"][theme], entry(lut.unsigned, i)));
    assert.ok(lowest < 1.5, `${theme}: lowest contrast of --ol-border over the ramp ${lowest}`);
  }
});

// ---- the unsigned constant bar ----

test("Lut.bar (unsigned index 160) composited at the painted opacity 0.65: 3.10 light and 4.04 dark; solid 7.10 and 7.65", () => {
  const want = { light: [3.1, 7.1], dark: [4.04, 7.65] };
  for (const theme of THEMES) {
    const lut = E.lut.build("slate2", theme);
    const surface = TOKENS["--ol-surface"][theme];
    const bar = Array.from(lut.bar.rgb);
    assert.equal(r2(ref.contrast(ref.over(bar, 0.65, surface), surface)), want[theme][0], theme + " composited");
    assert.equal(r2(ref.contrast(bar, surface)), want[theme][1], theme + " solid");
    assert.ok(ref.contrast(ref.over(bar, 0.65, surface), surface) >= 3, "the composite meets 3:1, which is the value that counts");
  }
});

test("the retired bar entry 153 composited at 0.65 FAILS 3:1 in the light theme (2.94), so nobody reverts to it", () => {
  const surface = TOKENS["--ol-surface"].light;
  const lut = E.lut.build("slate2", "light");
  const old = ref.over(entry(lut.unsigned, 153), 0.65, surface);
  assert.equal(r2(ref.contrast(old, surface)), 2.94);
  assert.ok(ref.contrast(old, surface) < 3);
  // And 160 is the FIRST entry that passes when composited (the reason it was chosen).
  let first = -1;
  for (let i = 0; i < 256 && first < 0; i++) if (ref.contrast(ref.over(entry(lut.unsigned, i), 0.65, surface), surface) >= 3) first = i;
  assert.ok(first > 153 && first <= 160, "first passing entry " + first);
  assert.ok(ref.contrast(ref.over(entry(lut.unsigned, first - 1), 0.65, surface), surface) < 3, "the entry before it fails");
});

// ---- every S1 control row ----

const CONSUMERS = ["N-01", "N-02", "N-03", "N-04", "N-05", "N-06", "N-07", "N-08"];

test("new-controls.json: rows are well formed and every S1 consumer N-01..N-08 has a contrast row or an exempt reason", () => {
  for (const row of CONTROLS) {
    assert.match(row.consumerId, /^N-0[1-8]$/);
    assert.equal(typeof row.note, "string");
    if (row.exempt !== undefined) {
      assert.ok(typeof row.exempt === "string" && row.exempt.length > 0);
      assert.equal(row.fg, undefined);
    } else {
      assert.ok(TOKENS[row.bg], "backdrop token " + row.bg);
      assert.ok(row.fg === "lut.bar" || TOKENS[row.fg], "foreground token " + row.fg);
      assert.ok(row.min === 4.5 || row.min === 3, "thresholds are the WCAG 4.5 (small text) and 3 (boundary)");
      assert.ok(row.theme === "both" || THEMES.includes(row.theme));
    }
  }
  for (const id of CONSUMERS) assert.ok(CONTROLS.some((r) => r.consumerId === id), id + " has a row");
});

test("new-controls.json: every row meets its threshold on the real tokens, in both themes", () => {
  let checked = 0;
  for (const row of CONTROLS) {
    if (row.exempt !== undefined) continue;
    for (const theme of THEMES) {
      if (row.theme !== "both" && row.theme !== theme) continue;
      const v = ratio(row, theme);
      assert.ok(v >= row.min, `${row.consumerId} ${row.fg} on ${row.bg} (${theme}): ${v.toFixed(2)} < ${row.min}: ${row.note}`);
      checked++;
    }
  }
  assert.ok(checked >= 40, "checked " + checked + " pairs");
});

test("the row checker bites: a pair that fails is reported as failing", () => {
  assert.ok(ratio({ fg: "--ol-line", bg: "--ol-surface" }, "light") < 3);
  assert.ok(ratio({ fg: "--ol-midpoint", bg: "--ol-surface" }, "light") < 3);
  assert.ok(ratio({ fg: "--ol-muted", bg: "--ol-surface" }, "light") >= 4.5);
  // The bar row checks the composite: at solid it would be 7.10, at 0.35 it would fail.
  assert.ok(ratio({ fg: "lut.bar", bg: "--ol-surface", alpha: 0.35 }, "light") < 3);
});

test("exempt rows name the D11 exemption they rely on", () => {
  for (const row of CONTROLS.filter((r) => r.exempt !== undefined)) assert.ok(/measurement gradient|no user interface/.test(row.exempt), row.consumerId + ": " + row.exempt);
});

// The completeness check against the contract document turns on when that document exists (H11 writes it).
const contract = path.join(ROOT, "docs/visual-contract.md");
test("every N- row of docs/visual-contract.md has a contrast row or an exempt reason", (t) => {
  if (!fs.existsSync(contract)) {
    t.todo("docs/visual-contract.md does not exist yet (H11); the N-01..N-08 list is the one of maps/consumer-inventory.md 2.8 B");
    return;
  }
  const ids = new Set(Array.from(fs.readFileSync(contract, "utf8").matchAll(/\bN-\d\d\b/g), (m) => m[0]));
  // N-01..N-08 are the new controls and texts (maps/consumer-inventory.md 2.8 B); the later N- rows are the
  // helpers that paint them and inherit those pairs, so only the controls need a contrast row.
  for (const id of ids) if (/^N-0[1-8]$/.test(id)) assert.ok(CONTROLS.some((r) => r.consumerId === id), id + " has no contrast row");
});
