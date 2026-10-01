"use strict";
// U62 (PRD-0002 S3, #48 section 4, the palette record): section 13 of docs/visual-contract.md records the shipped palette (version, interpolation, output space, gamut
// handling, LUT hash, the screens' numbers) and this test reads it back against E.lut so that the record cannot drift from the code. A palette change is a new
// appearance: the id and the hash in the record are the module's, and a link made with another id is met with the mismatch notice, not with a claim of the same colours.
// Oracles (none is the code under test): the text of the record as committed, the pinned hashes of lut.test.js written out here again, the independent CIEDE2000 of
// tests/reference/color.js for the numbers of the measured table, and the notice text of INTEGRATION.md D.11 (also pinned in text.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nodeCrypto = require("node:crypto");
const E = require("../support/enc");
const col = require("../reference/color.js");

const ROOT = path.resolve(__dirname, "../..");
const CONTRACT = fs.readFileSync(path.join(ROOT, "docs/visual-contract.md"), "utf8");
const START = CONTRACT.indexOf("## 13. Palette record (appearance version 2)");
const RECORD = START < 0 ? "" : CONTRACT.slice(START);
const SURFACE = { light: [255, 255, 255], dark: [22, 31, 25] };
const PIN = {
  slate2: { id: "slate2-8f7890f7", hash: "8f7890f7e400724c7191f42f31b9d2e9e0bf060ca619b003915fb6fbb418b672", version: 2 },
  ramp1: { id: "ramp1-a53783c5", hash: "a53783c520ba0d228804ae64e898e110256e73d6b705268e2b58bf0cbb550289", version: 1 },
};
const f = (x, n = 2) => x.toFixed(n);
const property = (name) => {
  const m = new RegExp(`^\\| ${name} \\| (.*) \\|$`, "m").exec(RECORD);
  assert.ok(m, `the record has a row "${name}"`);
  return m[1];
};

test("the record exists, is section 13, and names what the PRD asks it to: version, interpolation, output space, gamut handling and the LUT hash", () => {
  assert.ok(START > 0, "section 13 is in the contract");
  for (const name of ["Appearance", "Appearance id", "LUT hash", "Comparison appearance", "Stops", "Interpolation", "Output space", "Gamut handling", "Rows band", "Constant bar", "Screens \\(D11\\), after output conversion"]) property(name);
  assert.match(property("Interpolation"), /linear in CIE Lab/);
  assert.match(property("Output space"), /8-bit sRGB/);
  assert.match(property("Gamut handling"), /clipped/);
  assert.match(RECORD, /A palette change is a new appearance, not an edit/);
});

test("the appearance, its id, its version and its hash in the record are the module's, and the hash is the SHA-256 of the bytes it says", () => {
  for (const [name, pin] of Object.entries(PIN)) {
    assert.equal(E.lut.appearanceId(name), pin.id);
    assert.equal(E.lut.APPEARANCES[name].version, pin.version);
    for (const theme of ["light", "dark"]) assert.equal(E.lut.build(name, theme).hash, pin.hash);
  }
  assert.ok(property("Appearance").includes(`\`slate2\`, appearance version ${PIN.slate2.version}`));
  assert.ok(property("Appearance id").includes(`\`${PIN.slate2.id}\``));
  assert.ok(property("LUT hash").includes(`\`${PIN.slate2.hash}\``));
  assert.ok(property("LUT hash").includes("6162 bytes"));
  assert.ok(property("Comparison appearance").includes(`\`${PIN.ramp1.id}\``) && property("Comparison appearance").includes(PIN.ramp1.hash) && property("Comparison appearance").includes(`appearance version ${PIN.ramp1.version}`));
  // the layout the record describes: 2 themes x (3 ramps x 256 entries x 3 bytes + 3 single colours x 3 bytes) + 2 rows ramps x 256 x 3 = 6162
  assert.equal(2 * (3 * 256 * 3 + 3 * 3) + 2 * 256 * 3, 6162);
  const lut = { light: E.lut.build("slate2", "light"), dark: E.lut.build("slate2", "dark") };
  const bytes = Buffer.concat([
    ...["light", "dark"].flatMap((t) => [lut[t].unsigned.rgb, lut[t].positive.rgb, lut[t].negative.rgb, lut[t].midpoint.rgb, lut[t].occupancy.rgb, lut[t].stateInk.rgb].map((a) => Buffer.from(Array.from(a)))),
    ...["light", "dark"].map((t) => Buffer.from(Array.from(lut[t].rows.rgb))),
  ]);
  assert.equal(bytes.length, 6162);
  assert.equal(nodeCrypto.createHash("sha256").update(bytes).digest("hex"), PIN.slate2.hash, "the record's byte layout is the hash's");
});

test("the constants the record states are the module's: the Rows alpha, the constant bar's entry, the arms' end colours, nine stops, no clipped channel", () => {
  assert.ok(property("Rows band").includes("16%") && E.lut.ROWS_ALPHA === 0.16);
  const lut = E.lut.build("slate2", "light");
  assert.ok(property("Constant bar").includes("entry 160"));
  assert.deepEqual(Array.from(lut.bar.rgb), [lut.unsigned.rgb[160 * 3], lut.unsigned.rgb[160 * 3 + 1], lut.unsigned.rgb[160 * 3 + 2]], "the bar is unsigned entry 160");
  for (const [name, app] of Object.entries(E.lut.APPEARANCES)) for (const theme of ["light", "dark"]) assert.equal(app.unsigned[theme].length, 9, `${name} ${theme}: nine stops`);
  assert.ok(property("Stops").includes("nine equally spaced stops"));
  const hexOf = (rgb) => `#${Array.from(rgb).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  for (const [theme, positive, negative] of [["light", "#2d769c", "#b3624b"], ["dark", "#73b8d4", "#d89777"]]) {
    const l = E.lut.build("slate2", theme);
    assert.equal(hexOf(l.positive.rgb.slice(255 * 3, 255 * 3 + 3)), positive);
    assert.equal(hexOf(l.negative.rgb.slice(255 * 3, 255 * 3 + 3)), negative);
    assert.ok(property("Stops").includes(positive), `the record names ${positive}`);
    assert.ok(property("Stops").includes(negative), `the record names ${negative}`);
    assert.equal(l.clipped, 0);
  }
  for (const name of Object.keys(PIN)) for (const theme of ["light", "dark"]) assert.equal(E.lut.build(name, theme).clipped, 0, `${name} ${theme}: no clipped channel`);
});

test("the measured table is what the screens give on the shipped tables, row by row, and the first entry is checked with the independent CIEDE2000", () => {
  for (const name of Object.keys(PIN))
    for (const theme of ["light", "dark"]) {
      const lut = E.lut.build(name, theme),
        s = E.lut.screens(lut, SURFACE[theme]);
      const arm = (a) => `${f(a.departure, 1)} / ${f(a.maxAdjacent, 3)} / ${f(a.reversal, 3)}`;
      const rows = s.rows.claimed ? `${f(s.rows.first)} / ${f(s.rows.maxAdjacent, 3)} / ${f(s.rows.reversal, 3)}` : "no claim";
      const row = `| ${name} | ${theme} | ${f(s.unsigned.first)} | ${f(s.unsigned.maxAdjacent, 3)} | ${f(s.unsigned.reversal, 3)} | ${arm(s.positive)} | ${arm(s.negative)} | ${f(s.midpoint.distance)} | ${rows} | ${lut.clipped} |`;
      assert.ok(RECORD.includes(row), `the record has no row ${row}`);
      assert.equal(s.ok, true, `${name} ${theme} passes its screens`);
      // the first entry against the surface, with the independent formula
      const lab = (rgb) => E.lut.rgbToLab(rgb[0], rgb[1], rgb[2]);
      const first = col.deltaE2000(lab(SURFACE[theme]), lab([lut.unsigned.rgb[0], lut.unsigned.rgb[1], lut.unsigned.rgb[2]]));
      assert.ok(Math.abs(first - s.unsigned.first) < 1e-6 && first >= 5, `${name} ${theme}: ${first}`);
    }
});

test("an appearance this page cannot build is met with the notice that makes no claim of the same colours", () => {
  assert.equal(E.text.notice.appearanceMismatch, "This link was made with appearance {ap}; this page uses {current}. Mapping ids still match.");
  assert.ok(RECORD.includes("This link was made with appearance A; this page uses B. Mapping ids still match."));
  assert.ok(RECORD.includes("the running appearance stays"));
});
