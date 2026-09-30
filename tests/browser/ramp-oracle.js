"use strict";
// tests/browser/ramp-oracle.js (H7b): the colours the page must paint with, worked out WITHOUT the page's own LUT code.
//
// What a canvas assertion of B04 and B22 compares a pixel or a fill style with. The stops are typed in here from the published appearance
// table (API.md A.1, pinned by the hash in U18) and the 256-entry ramp between them is d3.piecewise(d3.interpolateLab) from the vendored d3,
// which is how tests/unit/lut.test.js checks the module too (to within one channel value). So the page's LUT code (src/encoding.js) is judged
// by an independent interpolator and by literals, never by itself.
//
//   const { ramp, match, nearest, PUBLISHED } = require("./ramp-oracle.js");
//   ramp("slate2", "dark")[128]          // [r, g, b] of index 128 in the dark unsigned ramp
//   match("slate2", "light", [r, g, b])  // index within one channel value of the pixel, or -1
//
// Only the unsigned ramps are here: Cells Volume and the legend bar of the default appearance are unsigned, which is what B04 draws.
const d3 = require("../../vendor/d3.min.js");

// The nine stops of each unsigned ramp, light then dark (API.md A.1 "Slate stops", "ramp1").
const STOPS = Object.freeze({
  slate2: Object.freeze({
    light: ["#e2e8ee", "#c9d3dd", "#a8b8c8", "#8299b0", "#5f7a95", "#435b76", "#2c4059", "#1a2b40", "#0e1a2b"],
    dark: ["#26313a", "#364552", "#495d70", "#5f7a90", "#7897af", "#96b2c8", "#b4cadb", "#d3e2ee", "#f1f6fa"],
  }),
  ramp1: Object.freeze({
    light: ["#f2f9c4", "#d6efb3", "#a9dcb6", "#73c6bd", "#41b0c3", "#2390bd", "#2a6aac", "#283f94", "#15205e"],
    dark: ["#1b2c33", "#18405a", "#1a5b7d", "#1f7896", "#2c969c", "#4db493", "#86cd83", "#c6e27c", "#f4f1a6"],
  }),
});

// Entries of the slate2 unsigned ramp that the same table publishes as literals ("Sampled entries"), which the interpolation must agree with
// EXACTLY (they are what the colour of a pixel is, not a tolerance).
const PUBLISHED = Object.freeze({
  slate2: Object.freeze({
    indices: Object.freeze([0, 12, 64, 128, 192, 243, 255]),
    light: Object.freeze(["#e2e8ee", "#d9e0e8", "#a8b8c8", "#5f7a95", "#2c3f58", "#122033", "#0e1a2b"]),
    dark: Object.freeze(["#26313a", "#2c3843", "#495d70", "#7897af", "#b5cbdb", "#e6eef5", "#f1f6fa"]),
  }),
});

const cache = new Map();

// ramp(name, theme) -> 256 entries of [r, g, b] (integers).
function ramp(name, theme) {
  const key = `${name}|${theme}`;
  if (!cache.has(key)) {
    if (!STOPS[name]?.[theme]) throw new RangeError(`no stops for ${name} ${theme}`);
    const f = d3.piecewise(d3.interpolateLab, STOPS[name][theme]);
    const out = [];
    for (let i = 0; i < 256; i++) {
      const c = d3.rgb(f(i / 255));
      out.push([Math.round(c.r), Math.round(c.g), Math.round(c.b)]);
    }
    cache.set(key, out);
  }
  return cache.get(key);
}

const hexOf = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const rgbOf = (css) => {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) throw new RangeError(`not a #rrggbb colour: ${css}`);
  return [0, 2, 4].map((at) => parseInt(m[1].slice(at, at + 2), 16));
};

const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

// nearest(name, theme, rgb) -> {index, distance}: the entry with the smallest largest-channel difference (the first of equals).
function nearest(name, theme, rgb) {
  const entries = ramp(name, theme);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < entries.length; i++) {
    const d = distance(entries[i], rgb);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return { index: best, distance: bestDistance };
}

// match(name, theme, rgb, tolerance = 1) -> the index of the nearest entry when it is within `tolerance` channel values, else -1.
function match(name, theme, rgb, tolerance = 1) {
  const n = nearest(name, theme, rgb);
  return n.distance <= tolerance ? n.index : -1;
}

module.exports = { STOPS, PUBLISHED, ramp, nearest, match, hexOf, rgbOf, distance };
