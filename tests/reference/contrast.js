"use strict";
// tests/reference/contrast.js: WCAG 2.x contrast for the unit tests, independent of src/encoding.js.
// Written from the definition (relative luminance of linearised sRGB, ratio of luminances plus 0.05),
// with the linearisation done through a 256-entry table so it shares no arithmetic with the module.
// It is validated in contrast.test.js on the published anchors (black on white 21:1, and the two
// examples of the WCAG 2 documentation: #767676 on white 4.54:1, #949494 on white 3.03:1).

const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

const luminance = ([r, g, b]) => 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Source-over of `fg` at opacity `alpha` on an opaque backdrop, rounded to 8 bits as a canvas does.
const over = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// The colour tokens of the first rule of src/explorer.css (the custom-property block), resolved for both
// themes: { "--ol-surface": { light: [r,g,b], dark: [r,g,b] }, ... }. Understands `light-dark(a, b)`, a
// plain hex colour (both themes) and `var(--other)`; anything else (sizes, numbers, rgba with alpha) is
// skipped, not guessed. Parsed from the text, so a test reads what the page will read.
function tokensFromCss(css) {
  const end = css.indexOf("\n}\n");
  const block = end < 0 ? css : css.slice(0, end);
  const raw = {};
  for (const m of block.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) raw[m[1]] = m[2].trim();
  const hex = (h) => {
    const t = h.slice(1);
    const full = t.length === 3 ? t.replace(/./g, (c) => c + c) : t;
    return full.length === 6 ? [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) : null;
  };
  const resolve = (name, depth) => {
    const v = raw[name];
    if (v === undefined || depth > 8) return null;
    let m = /^light-dark\(\s*(#[0-9a-fA-F]{3,6})\s*,\s*(#[0-9a-fA-F]{3,6})\s*\)$/.exec(v);
    if (m) return hex(m[1]) && hex(m[2]) ? { light: hex(m[1]), dark: hex(m[2]) } : null;
    m = /^(#[0-9a-fA-F]{3,6})$/.exec(v);
    if (m) return hex(m[1]) ? { light: hex(m[1]), dark: hex(m[1]) } : null;
    m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
    return m ? resolve(m[1], depth + 1) : null;
  };
  const out = {};
  for (const name of Object.keys(raw)) {
    const r = resolve(name, 0);
    if (r) out[name] = r;
  }
  return out;
}

module.exports = { contrast, luminance, over, hexToRgb, tokensFromCss };
