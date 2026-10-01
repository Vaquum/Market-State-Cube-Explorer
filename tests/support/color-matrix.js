"use strict";
// tests/support/color-matrix.js: the colour co-occurrence matrix of PRD-0002 S3 (#48 section 4), generated, not written.
//
//   node tests/support/color-matrix.js --write    writes docs/color-matrix.md
//   node tests/support/color-matrix.js --check    exits 1 if docs/color-matrix.md is not what the tokens and the LUT give now
//
// What it does: takes the inventory of what meets on the chart (tests/fixtures/palette/co-occurrence.json: the carriers, the contexts they share, the PRD's named
// pairs), resolves every carrier to an 8-bit sRGB colour in each theme from the tokens PARSED from src/explorer.css and from the pinned LUT, and for every pair that
// shares a context measures CIEDE2000 between the two under normal vision, grayscale and the pinned protan, deutan and tritan simulations at severities 0.5 and 1.0
// (tests/reference/cvd.js). The D11 categorical-pair screen is then applied, as the PRD words it: a pair that is 8 or more apart under every condition is separated;
// a pair that is not must be told apart by something other than hue, and the screen says by what:
//   separated  >= 8 under every condition (the screen is not a proof that 8 is enough for everyone, and labels are kept above it too)
//   form       the two carriers are different kinds of thing (an area, a stroke, an outline on its own ground, a control): a line has an opaque casing over a fill and a
//              pattern has its own ground, so neither depends on the neighbour's hue
//   redundant  the same kind of thing, each with an on-scene label, glyph, pattern, sign mark or place of its own and a route to its exact identity (tests named)
//   FAIL       none of those: nothing but hue tells them apart
// It is a screen with declared limits (D11): a model of colour vision and a distance formula, not a person.
const fs = require("node:fs");
const path = require("node:path");
const E = require("./enc");
const ref = require("../reference/contrast.js");
const col = require("../reference/color.js");
const cvd = require("../reference/cvd.js");

const ROOT = path.resolve(__dirname, "../..");
const FILES = {
  inventory: path.join(ROOT, "tests/fixtures/palette/co-occurrence.json"),
  css: path.join(ROOT, "src/explorer.css"),
  doc: path.join(ROOT, "docs/color-matrix.md"),
};
const THEMES = ["light", "dark"];
// Forms that identify a carrier without hue and are on the scene (not only in a legend or a table); a place is on the scene when it is the Rows strip's, the
// profile track's or a plane tile's own.
const ON_SCENE = new Set(["label", "glyph", "pattern", "sign", "position"]);

const readInventory = () => JSON.parse(fs.readFileSync(FILES.inventory, "utf8"));
const readTokens = () => ref.tokensFromCss(fs.readFileSync(FILES.css, "utf8"));

// The 8-bit colour of one carrier in one theme.
function colourOf(carrier, theme, tokens) {
  const s = carrier.source;
  if (s.token) {
    const t = tokens[s.token];
    if (!t) throw new Error(`co-occurrence: ${carrier.id} names ${s.token}, which the stylesheet does not define as a colour`);
    return t[theme].slice();
  }
  const lut = E.lut.build(E.lut.DEFAULT_APPEARANCE, theme);
  const at = (ramp, i) => [ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]];
  if (s.lut === "midpoint" || s.lut === "bar") return Array.from(lut[s.lut].rgb);
  if (s.lut === "rows") return at(E.lut.composite("rows", E.lut.ROWS_ALPHA, tokens["--ol-surface"][theme], lut), s.idx);
  if (lut[s.lut] && s.idx !== undefined) return at(lut[s.lut], s.idx);
  throw new Error(`co-occurrence: ${carrier.id} has a source this module cannot resolve: ${JSON.stringify(s)}`);
}

// The unique pairs of an inventory (a < b by carrier order), with every context each belongs to.
function pairsOf(inv) {
  const order = new Map(inv.carriers.map((c, i) => [c.id, i]));
  const found = new Map();
  const add = (a, b, context) => {
    if (a === b) return;
    const [x, y] = order.get(a) < order.get(b) ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    if (!found.has(key)) found.set(key, { a: x, b: y, contexts: [] });
    const p = found.get(key);
    if (!p.contexts.includes(context.id)) p.contexts.push(context.id);
  };
  for (const ctx of inv.contexts) {
    if (ctx.pairs === "all") for (let i = 0; i < ctx.members.length; i++) for (let j = i + 1; j < ctx.members.length; j++) add(ctx.members[i], ctx.members[j], ctx);
    else for (const a of ctx.between[0]) for (const b of ctx.between[1]) add(a, b, ctx);
  }
  return [...found.values()].sort((p, q) => order.get(p.a) - order.get(q.a) || order.get(p.b) - order.get(q.b));
}

// The screen of one pair in one theme.
function screenPair(inv, carriers, pair, theme, tokens) {
  const A = carriers.get(pair.a),
    B = carriers.get(pair.b),
    rgbA = colourOf(A, theme, tokens),
    rgbB = colourOf(B, theme, tokens),
    labOf = (rgb) => E.lut.rgbToLab(rgb[0], rgb[1], rgb[2]),
    byCondition = {};
  let min = Infinity,
    at = "";
  for (const c of cvd.CONDITIONS) {
    const d = col.deltaE2000(labOf(cvd.under(rgbA, c)), labOf(cvd.under(rgbB, c)));
    byCondition[c.id] = d;
    if (d < min) {
      min = d;
      at = c.id;
    }
  }
  let status;
  if (min >= inv.threshold) status = "separated";
  else if (A.kind !== B.kind) status = "form";
  else if (A.forms.some((f) => ON_SCENE.has(f)) && B.forms.some((f) => ON_SCENE.has(f)) && A.identity && B.identity && A.tests.length && B.tests.length) status = "redundant";
  else status = "FAIL";
  return { theme, normal: byCondition.normal, min, at, status, byCondition, rgbA, rgbB };
}

// The whole matrix.
function build() {
  const inv = readInventory(),
    tokens = readTokens(),
    carriers = new Map(inv.carriers.map((c) => [c.id, c])),
    pairs = pairsOf(inv).map((p) => ({ ...p, themes: Object.fromEntries(THEMES.map((t) => [t, screenPair(inv, carriers, p, t, tokens)])) }));
  return { inv, carriers, pairs };
}

const f1 = (x) => x.toFixed(1);
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const nameOf = (m, id) => m.carriers.get(id).name;

// docs/color-matrix.md: every number in it comes from build().
function render(m) {
  const { inv } = m;
  const out = [];
  const w = (s = "") => out.push(s);
  w("# Colour co-occurrence matrix");
  w();
  w("<!-- Generated by `node tests/support/color-matrix.js --write` from tests/fixtures/palette/co-occurrence.json, the tokens of src/explorer.css and the pinned LUT. Do not edit it: tests/unit/color-matrix.test.js compares it with what the generator gives now. -->");
  w();
  w("PRD-0002 S3 (#48 section 4). This is the screen of every pair of visual carriers that meets on the chart: the unsigned and signed fills, the Rows band, the seven reference families, the marks (focus, state, Geometry, movement), the profile track and the resolution plane. Each pair is measured with CIEDE2000 between the two colours as they are on the page (8-bit sRGB, tokens parsed from the stylesheet, entries of the pinned LUT) under normal vision, grayscale, and the pinned protan, deutan and tritan simulations at severities 0.5 and 1.0, in both themes.");
  w();
  w("It is a **screen with declared limits** (D11), not a proof: a model of colour vision (Machado, Oliveira and Fernandes, 2009, the matrices of `tests/fixtures/cvd/simulations.json`) and a distance formula, not people. A pair that is 8 or more apart under every condition is *separated*, which does not prove that 8 is enough for everyone, so the labels are kept above the threshold too. A pair that is not must be told apart by something other than hue: **form** (the two are different kinds of thing: a line has an opaque casing over a fill, a pattern has its own ground), **redundant** (the same kind of thing, each with an on-scene label, glyph, pattern or sign mark of its own and a route to its exact identity, named with the tests that reach it), and otherwise the screen says **FAIL**. Grayscale is the condition that most pairs fail by hue alone, by design: the signed arms are not forced to unequal lightness to separate them in grayscale (D11), they carry the sign mark where the cell is 12 css px or more and the signed readout, the table and Inspect where it is not.");
  w();
  w("Testing it: `tests/unit/color-matrix.test.js` (U60) fails when this file is not what the generator gives, when a role code of `docs/visual-contract.md` has no carrier here, when a carrier claims a form its live table does not have, and when any pair is **FAIL**. Human validation of the palette is the operator's (`docs/operator-protocol.md`) and is not claimed by anything in this file.");
  w();
  w("## Conditions");
  w();
  w("| Id | Condition |");
  w("|---|---|");
  for (const c of cvd.CONDITIONS) w(`| ${c.id} | ${c.label} |`);
  w();
  w("## Carriers");
  w();
  w("| Id | Carrier | Kind | Light | Dark | On-scene and other forms | Exact identity reached by |");
  w("|---|---|---|---|---|---|---|");
  const tokens = readTokens();
  for (const c of inv.carriers) w(`| ${c.id} | ${c.name} | ${c.kind} | ${hex(colourOf(c, "light", tokens))} | ${hex(colourOf(c, "dark", tokens))} | ${c.forms.join(", ")} | ${c.identity} (${c.tests.join(", ")}) |`);
  w();
  w("## Contexts");
  w();
  w("| Id | Where they meet | Pairs |");
  w("|---|---|---|");
  for (const ctx of inv.contexts) w(`| ${ctx.id} | ${ctx.name} | ${m.pairs.filter((p) => p.contexts.includes(ctx.id)).length} |`);
  w();
  w("## Summary");
  w();
  w(`${m.pairs.length} pairs, each in two themes.`);
  w();
  w("| Theme | Pairs | Separated (>= 8 under every condition) | Form | Redundant | FAIL |");
  w("|---|---|---|---|---|---|");
  for (const t of THEMES) {
    const n = (s) => m.pairs.filter((p) => p.themes[t].status === s).length;
    w(`| ${t} | ${m.pairs.length} | ${n("separated")} | ${n("form")} | ${n("redundant")} | ${n("FAIL")} |`);
  }
  w();
  w("## The PRD's named pairs");
  w();
  w("| Pair | Light: normal / least (condition) | Dark: normal / least (condition) | Status light, dark |");
  w("|---|---|---|---|");
  for (const call of inv.callouts)
    for (const [a, b] of call.pairs) {
      const p = m.pairs.find((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a));
      const L = p.themes.light,
        D = p.themes.dark;
      w(`| ${call.name}: ${nameOf(m, p.a)} and ${nameOf(m, p.b)} | ${f1(L.normal)} / ${f1(L.min)} (${L.at}) | ${f1(D.normal)} / ${f1(D.min)} (${D.at}) | ${L.status}, ${D.status} |`);
    }
  w();
  w("## Every pair");
  w();
  w("Each cell is the least CIEDE2000 over the eight conditions, with the condition that gives it; *normal* is the distance under normal vision.");
  w();
  w("| Pair | Meets in | Light: normal | Light: least (condition) | Light | Dark: normal | Dark: least (condition) | Dark |");
  w("|---|---|---|---|---|---|---|---|");
  for (const p of m.pairs) {
    const L = p.themes.light,
      D = p.themes.dark;
    w(`| ${p.a} and ${p.b} | ${p.contexts.join(", ")} | ${f1(L.normal)} | ${f1(L.min)} (${L.at}) | ${L.status} | ${f1(D.normal)} | ${f1(D.min)} (${D.at}) | ${D.status} |`);
  }
  w();
  return out.join("\n");
}

module.exports = { FILES, THEMES, ON_SCENE, build, render, pairsOf, colourOf, screenPair, readInventory, readTokens };

if (require.main === module) {
  const text = render(build());
  if (process.argv.includes("--write")) {
    fs.writeFileSync(FILES.doc, text);
    console.log(`wrote ${path.relative(ROOT, FILES.doc)}`);
  } else if (process.argv.includes("--check")) {
    const same = fs.existsSync(FILES.doc) && fs.readFileSync(FILES.doc, "utf8") === text;
    console.log(same ? "docs/color-matrix.md is what the tokens and the LUT give" : "docs/color-matrix.md is stale: node tests/support/color-matrix.js --write");
    process.exit(same ? 0 : 1);
  } else process.stdout.write(text);
}
