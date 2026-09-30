"use strict";
// tests/reference/color.js: an independent CIEDE2000 for the unit tests (TESTPLAN.md DD-T16). d3 has no
// colour difference, so this is the one place the formula is written outside src/encoding.js. It is
// deliberately built differently from the module's: the whole computation runs in radians, the
// chroma-dependent factors are gathered first and the hue terms after, and the special cases of the paper
// (zero chroma, the hue seam) are handled by the arithmetic of angles instead of by branches on degrees.
// It imports nothing from src/ or tests/support. It is validated in lut.test.js against the 34 published
// pairs of Sharma, Wu and Dalal (2005) held in tests/fixtures/color/sharma2005.json, and by identity,
// symmetry and a d3.lab round trip.

const TWO_PI = 2 * Math.PI;
const POW25_7 = Math.pow(25, 7);

// Hue angle of (a, b) in [0, 2*pi); an exact zero for a colour with no chroma, as the paper defines.
function hueOf(b, ap) {
  if (b === 0 && ap === 0) return 0;
  const h = Math.atan2(b, ap);
  return h < 0 ? h + TWO_PI : h;
}

// deltaE2000([L1, a1, b1], [L2, a2, b2]) with the parametric factors kL = kC = kH = 1.
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  // Step 1: a is rescaled by G, which depends on the mean of the two ORIGINAL chromas.
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const meanC7 = Math.pow(meanC, 7);
  const G = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + POW25_7)));
  const ap1 = a1 * (1 + G);
  const ap2 = a2 * (1 + G);
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp1 = hueOf(b1, ap1);
  const hp2 = hueOf(b2, ap2);
  // Step 2: the differences. The hue difference is the shortest way round the circle; it is zero when
  // either colour has no chroma.
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 !== 0 && Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > Math.PI) dh -= TWO_PI;
    else if (dh < -Math.PI) dh += TWO_PI;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2);
  // Step 3: the means. The mean hue is the mean on the circle: when the two hues are more than half a
  // turn apart, the short arc's midpoint is the plain mean shifted by a half turn.
  const meanL = (L1 + L2) / 2;
  const meanCp = (Cp1 + Cp2) / 2;
  let meanH;
  if (Cp1 === 0 || Cp2 === 0) meanH = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= Math.PI) meanH = (hp1 + hp2) / 2;
  else meanH = (hp1 + hp2 + (hp1 + hp2 < TWO_PI ? TWO_PI : -TWO_PI)) / 2;
  const d2r = Math.PI / 180;
  const T =
    1 -
    0.17 * Math.cos(meanH - 30 * d2r) +
    0.24 * Math.cos(2 * meanH) +
    0.32 * Math.cos(3 * meanH + 6 * d2r) -
    0.2 * Math.cos(4 * meanH - 63 * d2r);
  const meanHDeg = meanH / d2r;
  const dTheta = 30 * d2r * Math.exp(-(((meanHDeg - 275) / 25) ** 2));
  const meanCp7 = Math.pow(meanCp, 7);
  const RC = 2 * Math.sqrt(meanCp7 / (meanCp7 + POW25_7));
  const RT = -Math.sin(2 * dTheta) * RC;
  const SL = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const SC = 1 + 0.045 * meanCp;
  const SH = 1 + 0.015 * meanCp * T;
  const x = dL / SL;
  const y = dC / SC;
  const z = dH / SH;
  return Math.sqrt(x * x + y * y + z * z + RT * y * z);
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

module.exports = { deltaE2000, hexToRgb };
