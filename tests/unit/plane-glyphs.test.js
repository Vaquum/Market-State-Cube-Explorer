"use strict";
// U54 (PRD-0002 S2, #47 section 5): the resolution plane's glyphs pass 3:1 on the tiles they are drawn on, in both themes, and the plane's CSS uses
// no market hue.
// Oracles (none is the code under test): tests/reference/contrast.js (WCAG 2.x contrast from its definition), the tokens PARSED from src/explorer.css
// in both themes, and the pairs written out from the plane's rules: the ink of a size glyph, a corner badge, a frame and a ring is --ol-ink; the dots
// and the slash are --ol-state; the tiles they sit on are the surface (pending, unavailable) and, for ready, 22% of the state ink over the surface.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ref = require("../reference/contrast.js");

const ROOT = path.resolve(__dirname, "../..");
const CSS = fs.readFileSync(path.join(ROOT, "src/explorer.css"), "utf8");
const TOKENS = ref.tokensFromCss(CSS);

// A ready tile is 22% of the state ink over the surface (color-mix in sRGB: a straight interpolation of the channels).
const mixed = (theme) => {
  const a = TOKENS["--ol-state"][theme],
    b = TOKENS["--ol-surface"][theme];
  return [0, 1, 2].map((i) => Math.round(0.22 * a[i] + 0.78 * b[i]));
};
const PAIRS = [
  ["the size glyph (ink) on a ready tile", "--ol-ink", "ready"],
  ["the size glyph (ink) on a pending tile", "--ol-ink", "--ol-surface"],
  ["the size glyph (ink) on an unavailable tile", "--ol-ink", "--ol-surface"],
  ["the dots of a pending tile (state ink) on the surface", "--ol-state", "--ol-surface"],
  ["the slash of an unavailable tile (state ink) on the surface", "--ol-state", "--ol-surface"],
  ["the current level's frame (ink) on the surface around it", "--ol-ink", "--ol-surface"],
  ["the focus ring's core (ink) against its surface casing", "--ol-ink", "--ol-surface"],
];

for (const theme of ["light", "dark"])
  test(`${theme}: each glyph of the plane reaches 3:1 on its tile`, () => {
    for (const [what, fg, bg] of PAIRS) {
      const ratio = ref.contrast(TOKENS[fg][theme], bg === "ready" ? mixed(theme) : TOKENS[bg][theme]);
      assert.ok(ratio >= 3, `${what}: ${ratio.toFixed(2)}:1`);
    }
  });

test("the plane's rules use the ink and the state ink and no market hue (gold, Volume green, Evidence violet)", () => {
  const rules = [...CSS.matchAll(/(#origo-lens \.ol-plane[^{]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 10, "the plane has its rules (" + rules.length + ")");
  for (const [, selector, body] of rules) for (const banned of ["--ol-poc", "--ol-volume", "--ol-evidence", "--ol-accent"]) assert.ok(!body.includes(banned), `${selector.trim()} uses ${banned}`);
});

test("the toolbar's coarser-than-asked mark uses no gold", () => {
  const rule = /#origo-lens \.ol-res-coarse \{[^}]*\}/.exec(CSS)[0];
  assert.ok(!rule.includes("--ol-poc"), rule);
});

test("every fact the plane's tiles carry has its rule: availability, size, the diagonal, the current level and the focus", () => {
  for (const needle of ['[data-avail="ready"]', '[data-avail="pending"]', '[data-avail="unavailable"]', '[data-size="small"]::after', '[data-size="usable"]::after', '[data-size="large"]::after', '[data-path="true"]::before', 'aria-pressed="true"', ":focus-visible"])
    assert.ok(CSS.includes(needle), needle);
});
