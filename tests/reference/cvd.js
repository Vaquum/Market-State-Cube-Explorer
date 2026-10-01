"use strict";
// tests/reference/cvd.js: colour-vision-deficiency and grayscale simulation for the unit tests, independent of src/encoding.js.
//
// The simulation is the one of Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation of Color Vision Deficiency",
// IEEE TVCG 15(6): a 3 x 3 matrix applied to LINEAR sRGB, one matrix for each type and severity. The six matrices of the two severities the PRD tests
// (0.5 and 1.0) are the ones of tests/fixtures/cvd/simulations.json, transcribed from the paper (the same file the composed browser fixtures of
// cvd-plane.spec.js read, so there is one copy), and color-matrix.test.js refuses a typo in them without consulting the code under test.
// These are simulations of a model, not people: they screen a palette, they never replace the operator's tests with participants whose colour vision differs.
//
//   protan   the L cone missing (1.0) or weak (0.5)      deutan   the M cone               tritan   the S cone
//   gray     the colour's luminance written back as a grey: what a printed or achromatic view shows
//
// Everything works on 8-bit sRGB triples and returns 8-bit sRGB triples, clamped and rounded as a display would.
const fs = require("node:fs");
const path = require("node:path");

const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../fixtures/cvd/simulations.json"), "utf8"));
const MATRICES = Object.freeze({
  protan: Object.freeze({ 0.5: FIXTURE.protanomaly05, 1: FIXTURE.protanopia }),
  deutan: Object.freeze({ 0.5: FIXTURE.deuteranomaly05, 1: FIXTURE.deuteranopia }),
  tritan: Object.freeze({ 0.5: FIXTURE.tritanomaly05, 1: FIXTURE.tritanopia }),
});
const IDENTITY = Object.freeze([
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]);

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const fromLinear = (c) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(255 * Math.min(1, Math.max(0, v)));
};

// The colour as a person with the given deficiency sees it: [r, g, b] -> [r, g, b].
function simulate(rgb, type, severity) {
  const matrix = MATRICES[type]?.[severity];
  if (!matrix) throw new RangeError(`cvd.simulate: no pinned matrix for ${type} at ${severity}`);
  const lin = rgb.map(toLinear);
  return matrix.map((row) => fromLinear(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
}

// The luminance of a colour as the grey of the same lightness: [r, g, b] -> [g, g, g] (the weights of ITU-R BT.709 on linear sRGB, the same Y as WCAG).
function gray(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const v = fromLinear(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return [v, v, v];
}

// Every condition a palette is screened under: normal vision, grayscale, and the three types at the two severities.
const CONDITIONS = Object.freeze([
  Object.freeze({ id: "normal", label: "normal vision" }),
  Object.freeze({ id: "gray", label: "grayscale" }),
  ...["protan", "deutan", "tritan"].flatMap((type) => [0.5, 1].map((severity) => Object.freeze({ id: `${type}-${severity}`, label: `${type} ${severity}`, type, severity }))),
]);

// The colour as seen under a condition (an entry of CONDITIONS or its id).
function under(rgb, condition) {
  const c = typeof condition === "string" ? CONDITIONS.find((x) => x.id === condition) : condition;
  if (!c) throw new RangeError(`cvd.under: unknown condition ${String(condition)}`);
  if (c.id === "normal") return rgb.slice();
  if (c.id === "gray") return gray(rgb);
  return simulate(rgb, c.type, c.severity);
}

module.exports = { MATRICES, IDENTITY, CONDITIONS, simulate, gray, under };
