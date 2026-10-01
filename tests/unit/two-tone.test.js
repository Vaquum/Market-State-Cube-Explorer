"use strict";
// U50 (PRD-0002 S2, #47 box "Validate two-tone boundaries against every actual fill/empty/state sample"): the selection, hover and lens
// boundaries are a wide casing in the surface colour under a narrow core in ink, so against ANY backdrop at least one of the two has a
// 3:1 contrast (max(CR(ink, bg), CR(casing, bg)) >= 3, parent D11).
// Oracles (none is the code under test): tests/reference/contrast.js (WCAG 2.x contrast from its definition), the ink and surface tokens PARSED
// from src/explorer.css in both themes, and every backdrop a boundary can lie on: each of the 256 entries of the unsigned, positive, negative
// and Rows ramps of the pinned appearance, the signed midpoint, the occupancy and state inks, and the empty surface and panel.
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

// The backdrops of one theme, each with a name for the failure message.
function backdrops(theme) {
  const lut = E.lut.build("slate2", theme),
    out = [];
  for (const role of ["unsigned", "positive", "negative", "rows"]) {
    const ramp = lut[role];
    if (!ramp || !ramp.rgb) continue;
    for (let i = 0; i < 256; i++) out.push([`${role}[${i}]`, entry(ramp, i)]);
  }
  for (const name of ["--ol-surface", "--ol-panel", "--ol-midpoint", "--ol-occupancy", "--ol-state"]) out.push([name, TOKENS[name][theme]]);
  return out;
}

for (const theme of THEMES)
  test(`${theme}: a selection boundary (ink core, surface casing) reaches 3:1 over every fill, empty and state backdrop`, () => {
    const ink = TOKENS["--ol-ink"][theme],
      casing = TOKENS["--ol-surface"][theme],
      bad = [];
    let worst = Infinity;
    for (const [name, bg] of backdrops(theme)) {
      const best = Math.max(ref.contrast(ink, bg), ref.contrast(casing, bg));
      worst = Math.min(worst, best);
      if (best < 3) bad.push(`${name}: ${best.toFixed(2)}`);
    }
    assert.deepEqual(bad, [], `the weakest backdrop still has ${worst.toFixed(2)}:1 through its better component`);
    assert.ok(backdrops(theme).length > 1000, "every ramp entry was checked");
  });

test("the check bites: a casing the colour of the core leaves mid-lightness fills under 3:1", () => {
  for (const theme of THEMES) {
    const ink = TOKENS["--ol-ink"][theme];
    const below = backdrops(theme).filter(([, bg]) => ref.contrast(ink, bg) < 3);
    assert.ok(below.length > 0, "some backdrop is under 3:1 against the core alone, so the casing carries it");
  }
});
