"use strict";
// U60 (PRD-0002 S3, #48 section 4): the colour co-occurrence matrix and the screens behind it.
// Oracles (none is the code under test): the simulation matrices of tests/fixtures/cvd/simulations.json (transcribed from Machado, Oliveira and Fernandes 2009) held to
// the properties the model has (a grey stays a grey, severity 0.5 lies between the identity and severity 1.0), the independent CIEDE2000 of tests/reference/color.js
// (validated against the published Sharma pairs in lut.test.js), the tokens PARSED from src/explorer.css, the role tables of src/encoding.js and the inventory rows of
// docs/visual-contract.md. The inventory (tests/fixtures/palette/co-occurrence.json) is hand-authored; this file refuses it when it has gone stale.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const cvd = require("../reference/cvd.js");
const ref = require("../reference/contrast.js");
const matrix = require("../support/color-matrix.js");

const ROOT = path.resolve(__dirname, "../..");
const CONTRACT = fs.readFileSync(path.join(ROOT, "docs/visual-contract.md"), "utf8");
const M = matrix.build();
const INV = M.inv;

// ---- the simulation ----

test("the six pinned matrices: every row sums to 1, so a grey stays the same grey", () => {
  for (const [type, bySeverity] of Object.entries(cvd.MATRICES))
    for (const [severity, m] of Object.entries(bySeverity)) {
      assert.equal(m.length, 3);
      for (const row of m) {
        assert.equal(row.length, 3);
        assert.ok(Math.abs(row[0] + row[1] + row[2] - 1) < 5e-6, `${type} ${severity}: a row sums to ${row[0] + row[1] + row[2]}`);
      }
    }
});

test("severity 0.5 lies between the identity and severity 1.0, element by element, to the slack of the paper's own small terms (a typo in either is refused)", () => {
  // the paper's table is not monotone in its smallest elements (the third row's first column is -0.003882 at 1.0 and -0.007494 at 0.5; the tritan's first row's
  // second column is -0.076749 at 1.0 and +0.027029 at 0.5), so 0.05 of slack; and the 0.5 matrix is near the halfway matrix to within a quarter in every element
  for (const [type, s] of Object.entries(cvd.MATRICES))
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const lo = Math.min(cvd.IDENTITY[r][c], s[1][r][c]) - 0.05,
          hi = Math.max(cvd.IDENTITY[r][c], s[1][r][c]) + 0.05;
        assert.ok(Math.abs(s[0.5][r][c] - (cvd.IDENTITY[r][c] + s[1][r][c]) / 2) <= 0.25, `${type}[${r}][${c}] is not near the halfway matrix`);
        assert.ok(s[0.5][r][c] >= lo && s[0.5][r][c] <= hi, `${type}[${r}][${c}]: ${s[0.5][r][c]} is not between ${cvd.IDENTITY[r][c]} and ${s[1][r][c]}`);
      }
});

test("every condition leaves a grey as it is (to a level), and grayscale keeps the colour's luminance", () => {
  for (let v = 0; v < 256; v += 15) for (const c of cvd.CONDITIONS) cvd.under([v, v, v], c).forEach((x) => assert.ok(Math.abs(x - v) <= 1, `${c.id}: grey ${v} became ${x}`));
  for (const rgb of [[200, 40, 40], [30, 120, 200], [40, 160, 70], [230, 200, 20], [90, 60, 140]]) {
    const g = cvd.gray(rgb);
    assert.equal(new Set(g).size, 1, "all three channels equal");
    const y = (v) => ref.luminance(v);
    // one 8-bit step of grey is about 0.4% of luminance at the dark end and 0.5% at the light end
    assert.ok(Math.abs(y(g) - y(rgb)) <= 0.004 + 0.01 * y(rgb), `luminance of ${rgb} is ${y(rgb)}, the grey's is ${y(g)}`);
  }
});

test("the simulations move colours the way the model says: red and green converge under protan and deutan, blue and yellow under tritan", () => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const red = [200, 40, 40],
    green = [40, 160, 70],
    blue = [30, 90, 200],
    yellow = [230, 200, 20];
  for (const c of cvd.CONDITIONS.filter((x) => x.type === "protan" || x.type === "deutan"))
    assert.ok(dist(cvd.under(red, c), cvd.under(green, c)) < dist(red, green), `${c.id}: red and green are closer than they were`);
  for (const c of cvd.CONDITIONS.filter((x) => x.type === "tritan")) assert.ok(dist(cvd.under(blue, c), cvd.under(yellow, c)) < dist(blue, yellow), `${c.id}: blue and yellow are closer than they were`);
});

test("the conditions are the eight of the PRD: normal, grayscale, and protan, deutan and tritan at 0.5 and 1.0; an unknown one is refused", () => {
  assert.deepEqual(cvd.CONDITIONS.map((c) => c.id), ["normal", "gray", "protan-0.5", "protan-1", "deutan-0.5", "deutan-1", "tritan-0.5", "tritan-1"]);
  assert.deepEqual(cvd.under([12, 99, 201], "normal"), [12, 99, 201]);
  assert.throws(() => cvd.under([1, 2, 3], "protan-0.7"), RangeError);
  assert.throws(() => cvd.simulate([1, 2, 3], "protan", 0.7), RangeError);
});

// ---- the inventory is complete and true of the live tables ----

// The role codes the contract's Target role column uses: the closed set the roleCodes map is held to.
function contractCodes() {
  const found = new Set();
  const refNames = [["Profile", "REF:Profile"], ["Price levels", "REF:Price levels"], ["Averages", "REF:Averages"], ["VWAP", "REF:VWAP"], ["Clock", "REF:Clock"], ["User Level", "REF:User Level"], ["Historical comparison", "REF:Historical comparison"]];
  for (const line of CONTRACT.split("\n")) {
    if (!/^\| [A-Z]-\d+[a-z]? \|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split(" | ").map((c) => c.trim());
    if (cells.length !== 9) continue;
    const target = cells[4];
    for (const m of target.matchAll(/`?REF:([A-Za-z ]+)/g)) {
      const hit = refNames.find(([n]) => m[1].trim().startsWith(n));
      assert.ok(hit, `${cells[0]}: the reference role "${m[1].trim()}" has no carrier in the inventory`);
      found.add(hit[1]);
    }
    for (const m of target.matchAll(/`?\b(STATE|CHR|IX|UM|OCC|RP)\b/g)) found.add(m[1]);
    if (target.includes("+/-/mid")) found.add("+/-/mid");
  }
  return found;
}

test("every target-role code of the consumer inventory has its carriers here, and every code here is still in the inventory", () => {
  const codes = Object.keys(INV.roleCodes).filter((k) => k !== "note");
  const found = contractCodes();
  for (const code of found) assert.ok(codes.includes(code), `the contract uses ${code} and the matrix has no entry for it`);
  for (const code of codes) assert.ok(found.has(code), `the matrix names ${code}, which no row of the contract uses`);
  for (const code of codes) for (const id of INV.roleCodes[code]) assert.ok(M.carriers.has(id), `${code} names ${id}, which is not a carrier`);
});

test("every carrier resolves to a colour in both themes, belongs to a context, and names tests that exist", () => {
  const tokens = matrix.readTokens();
  const index = new Set([...CONTRACT.matchAll(/^\| ([UB]\d+) \| `tests\//gm)].map((m) => m[1]));
  const used = new Set(INV.contexts.flatMap((c) => c.members));
  for (const c of INV.carriers) {
    for (const theme of matrix.THEMES) matrix.colourOf(c, theme, tokens).forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${c.id}: ${v}`));
    assert.ok(used.has(c.id), `${c.id} is in no context`);
    assert.ok(c.identity && c.tests.length > 0, `${c.id} names no route to its exact identity`);
    for (const t of c.tests) assert.ok(index.has(t), `${c.id} names ${t}, which is not in the contract's test index`);
    for (const f of c.forms) assert.ok(Object.hasOwn(INV.forms, f), `${c.id}: unknown form ${f}`);
    assert.ok(Object.hasOwn(INV.kinds, c.kind), `${c.id}: unknown kind ${c.kind}`);
  }
  for (const ctx of INV.contexts) for (const id of ctx.members) assert.ok(M.carriers.has(id), `${ctx.id} names ${id}`);
  assert.equal(new Set(INV.carriers.map((c) => c.id)).size, INV.carriers.length, "carrier ids are unique");
});

test("every reference family of the role table is a carrier, and each carrier's forms are what its family really has", () => {
  const byFamily = new Map(INV.carriers.filter((c) => c.family).map((c) => [c.family, c]));
  for (const fam of E.role.REFERENCE.FAMILIES) {
    const c = byFamily.get(fam.id);
    assert.ok(c, `family ${fam.id} has no carrier`);
    const token = matrix.readTokens()[fam.token];
    assert.deepEqual(c.source, { token: fam.token }, `${fam.id}: the carrier reads the family's token`);
    assert.ok(token, `${fam.token} is a colour of the stylesheet`);
    assert.ok(c.forms.includes("label") && fam.identification.length > 0, `${fam.id}: its label and identification`);
    assert.ok(c.forms.includes("pattern"), `${fam.id}: the three support patterns and the Level's own exist`);
    assert.equal(c.forms.includes("glyph"), fam.glyph !== null, `${fam.id}: an endpoint glyph exactly where the table has one`);
  }
  assert.equal(byFamily.size, E.role.REFERENCE.FAMILIES.length);
});

test("the signed roles carry the sign mark, and the state ink carries the patterns of the glyph table", () => {
  const signed = INV.carriers.filter((c) => c.signRole);
  assert.deepEqual(signed.map((c) => c.signRole).sort(), Object.keys(E.role.SIGN.SHAPES).sort(), "one carrier for each signed role");
  for (const c of signed) assert.ok(c.forms.includes("sign") && E.role.signShape(c.signRole) !== null, c.id);
  for (const c of INV.carriers) if (c.forms.includes("sign")) assert.ok(c.signRole, `${c.id} claims a sign mark without a signed role`);
  const state = M.carriers.get("mark.state");
  for (const id of state.stateRoles) {
    assert.ok(Object.hasOwn(E.role.GLYPHS, id), `${id} is a glyph of the role table`);
    assert.equal(E.role.GLYPHS[id].ink, "stateInk", `${id} is drawn in the state ink`);
  }
  // every glyph the role table draws in the state ink and that stands for a state is listed
  const listed = new Set(state.stateRoles);
  for (const [id, g] of Object.entries(E.role.GLYPHS)) if (g.ink === "stateInk" && g.role === "state-ink" && g.pattern) assert.ok(listed.has(id), `${id} is a state pattern the inventory does not list`);
});

test("a line carries its label whatever its distance from its neighbours: every stroke carrier has the label form", () => {
  for (const c of INV.carriers.filter((x) => x.kind === "stroke")) assert.ok(c.forms.includes("label"), `${c.id}: labels are retained even where hue would separate`);
});

test("the PRD's named pairs are all in the matrix", () => {
  const names = INV.callouts.map((c) => c.name);
  for (const want of ["scalar fills versus references", "historical comparison versus positive and negative", "gold and clay", "olive and rust", "olive and clay", "focus, state, Geometry and movement", "menus and tags", "profiles", "the resolution plane"])
    assert.ok(names.includes(want), `no named pair: ${want}`);
  for (const call of INV.callouts) for (const [a, b] of call.pairs) assert.ok(M.pairs.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a)), `${call.name}: ${a} and ${b} are not a pair of any context`);
  // gold, clay, olive and rust are what the tokens say they are
  const tok = matrix.readTokens();
  assert.ok(M.carriers.get("ref.profile").source.token === "--ol-line-poc" && tok["--ol-poc"], "gold");
  assert.ok(M.carriers.get("fill.negative").signRole === "negative", "clay is the negative arm");
});

// ---- the screen ----

test("the screen: no pair of any context is told apart by hue alone, in either theme", () => {
  const failing = [];
  for (const p of M.pairs) for (const theme of matrix.THEMES) if (p.themes[theme].status === "FAIL") failing.push(`${p.a} and ${p.b} (${theme}): ${p.themes[theme].min.toFixed(1)} under ${p.themes[theme].at}`);
  assert.deepEqual(failing, []);
  for (const p of M.pairs) for (const theme of matrix.THEMES) {
    const s = p.themes[theme];
    assert.ok(["separated", "form", "redundant"].includes(s.status));
    assert.equal(Object.keys(s.byCondition).length, 8, "all eight conditions measured");
    assert.ok(s.min <= s.normal + 1e-9 || s.at === "normal", "the least is at most normal vision's");
    assert.ok(Number.isFinite(s.min) && s.min >= 0);
    // separated means 8 or more under EVERY condition
    if (s.status === "separated") for (const d of Object.values(s.byCondition)) assert.ok(d >= INV.threshold, `${p.a} and ${p.b}`);
    else assert.ok(s.min < INV.threshold, `${p.a} and ${p.b}: only the pairs under 8 need another carrier`);
  }
});

test("the screen bites: two lines of one kind with no label, glyph, pattern or place of their own fail where hue is what they have", () => {
  const stripped = JSON.parse(JSON.stringify(INV));
  for (const c of stripped.carriers) if (c.id === "ref.average" || c.id === "ref.vwap") c.forms = ["legend", "number"];
  const carriers = new Map(stripped.carriers.map((c) => [c.id, c]));
  const tokens = matrix.readTokens();
  const s = matrix.screenPair(stripped, carriers, { a: "ref.average", b: "ref.vwap" }, "dark", tokens);
  assert.equal(s.status, "FAIL", `dark: ${s.min.toFixed(1)} under ${s.at}`);
  // and with the forms back it passes, and a pair that was never close stays separated whatever its forms
  assert.equal(matrix.screenPair(INV, M.carriers, { a: "ref.average", b: "ref.vwap" }, "dark", tokens).status, "redundant");
  assert.equal(matrix.screenPair(stripped, carriers, { a: "ref.profile", b: "mark.occupancy" }, "light", tokens).status === "FAIL", false);
});

test("the signed arms are not forced apart in grayscale: positive and negative are under 8 there in both themes, and the sign mark is what tells them apart", () => {
  const p = M.pairs.find((x) => x.a === "fill.positive" && x.b === "fill.negative");
  for (const theme of matrix.THEMES) {
    assert.ok(p.themes[theme].byCondition.gray < INV.threshold, `${theme}: ${p.themes[theme].byCondition.gray}`);
    assert.ok(p.themes[theme].normal >= INV.threshold, `${theme}: the arms are far apart in normal vision`);
    assert.equal(p.themes[theme].status, "redundant");
  }
});

test("docs/color-matrix.md is what the tokens, the LUT and the inventory give now", () => {
  const doc = fs.readFileSync(matrix.FILES.doc, "utf8");
  assert.equal(doc, matrix.render(M), "regenerate it: node tests/support/color-matrix.js --write");
});
