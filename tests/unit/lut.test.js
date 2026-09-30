"use strict";
// U18 (T-lut): E.lut of src/encoding.js, loaded through tests/support/enc.js.
// Oracles (none is the code under test):
//   - d3.lab and d3.piecewise(d3.interpolateLab) from vendor/d3.min.js for every Lab conversion and every
//     256-entry ramp (the module writes its own Lab arithmetic; d3 is only ever an oracle here);
//   - tests/reference/color.js, an independent CIEDE2000 built differently from the module's, itself
//     validated below on the 34 published Sharma, Wu and Dalal (2005) pairs of fixtures/color/sharma2005.json
//     (transcribed from memory and flagged in that directory's provenance.json);
//   - node:crypto SHA-256 over LUT bytes laid out by THIS file from the public Lut fields, compared with the
//     hashes hand-pinned from API.md Appendix A.1 (they are literals here, never read back from the module);
//   - the hand-published measurements of API.md A.1 (screens, bar entry, sampled entries) and the WCAG
//     anchor arithmetic in tests/reference/contrast.js;
//   - the real surface tokens parsed from src/explorer.css.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): its arrays and typed arrays are of
// another realm, so they are compared through Array.from / Buffer, never with deepStrictEqual on the object.
const test = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const d3 = require("../../vendor/d3.min.js");
const ref = require("../reference/color.js");
const refContrast = require("../reference/contrast.js");
const { mulberry32 } = require("../support/rng.js");

const ROOT = path.resolve(__dirname, "../..");
const TOKENS = refContrast.tokensFromCss(fs.readFileSync(path.join(ROOT, "src/explorer.css"), "utf8"));
const SURFACE = { light: TOKENS["--ol-surface"].light, dark: TOKENS["--ol-surface"].dark };
const THEMES = ["light", "dark"];
const NAMES = ["slate2", "ramp1"];

// Pinned by the design owner and reproduced independently (API.md A.1, DD-86, DR-29). The first 4626 bytes
// are the three ramps and three single colours of both themes; the rest are the two rows ramps.
const PIN = {
  slate2: { hash: "8f7890f7e400724c7191f42f31b9d2e9e0bf060ca619b003915fb6fbb418b672", id: "slate2-8f7890f7", head: "75cc078445e35360a696140843a8a12648200c173d18050f4624ba582a8959eb" },
  ramp1: { hash: "a53783c520ba0d228804ae64e898e110256e73d6b705268e2b58bf0cbb550289", id: "ramp1-a53783c5", head: "90c3f71e138ee07a8df0e29eec7aa6cfdd1d29cd55d0c911a39a5232caa7edb2" },
};

const toBuf = (ramp) => Buffer.from(Array.from(ramp.rgb));
const sha = (buf) => nodeCrypto.createHash("sha256").update(buf).digest("hex");
const labOf = (rgb) => {
  const c = d3.lab(d3.rgb(rgb[0], rgb[1], rgb[2]));
  return [c.l, c.a, c.b];
};
const entry = (ramp, i) => [ramp.rgb[i * 3], ramp.rgb[i * 3 + 1], ramp.rgb[i * 3 + 2]];
const hexOf = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

// The LUT byte layout of API.md C.6, written out here from the public fields: for each theme the three
// ramps, then midpoint, occupancy, stateInk; then for each theme the rows ramp.
function layoutBytes(name) {
  const light = E.lut.build(name, "light");
  const dark = E.lut.build(name, "dark");
  const head = [];
  for (const lut of [light, dark]) {
    for (const r of [lut.unsigned, lut.positive, lut.negative]) head.push(toBuf(r));
    for (const c of [lut.midpoint, lut.occupancy, lut.stateInk]) head.push(Buffer.from(Array.from(c.rgb)));
  }
  const headBuf = Buffer.concat(head);
  return { head: headBuf, all: Buffer.concat([headBuf, toBuf(light.rows), toBuf(dark.rows)]) };
}

// ---- pinned bytes ----

for (const name of NAMES) {
  test(`${name}: the LUT bytes hash to the pinned value, the first 4626 bytes to the pinned bisection value, the id follows`, () => {
    const { head, all } = layoutBytes(name);
    assert.equal(head.length, 4626);
    assert.equal(all.length, 6162);
    assert.equal(sha(head), PIN[name].head, "the ramps and single roles alone (bisection aid)");
    assert.equal(sha(all), PIN[name].hash, "all 6162 bytes");
    for (const theme of THEMES) {
      const lut = E.lut.build(name, theme);
      assert.equal(lut.hash, PIN[name].hash);
      assert.equal(lut.id, PIN[name].id);
    }
    assert.equal(E.lut.appearanceId(name), PIN[name].id);
  });
}

test("the appearance names, default and rows alpha", () => {
  assert.deepEqual(Object.keys(E.lut.APPEARANCES).sort(), ["ramp1", "slate2"]);
  assert.equal(E.lut.DEFAULT_APPEARANCE, "slate2");
  assert.equal(E.lut.ROWS_ALPHA, 0.16);
  assert.ok(Object.isFrozen(E.lut.APPEARANCES) && Object.isFrozen(E.lut.APPEARANCES.slate2) && Object.isFrozen(E.lut.APPEARANCES.slate2.unsigned.light));
  assert.equal(E.lut.APPEARANCES.slate2.version, 2, "the new palette is appearance version 2");
});

test("the appearance id changes if and only if a LUT byte changes (one stop, one role constant, and a no-op)", () => {
  const base = JSON.parse(JSON.stringify(E.lut.APPEARANCES.slate2));
  const same = JSON.parse(JSON.stringify(base));
  assert.equal(E.lut.appearanceId(same), PIN.slate2.id, "a deep copy is the same appearance");
  const seen = new Set([PIN.slate2.id]);
  const perturb = (edit) => {
    const app = JSON.parse(JSON.stringify(base));
    edit(app);
    return app;
  };
  const variants = [
    perturb((a) => (a.unsigned.light[4] = "#5f7a96")), // one channel value of one stop
    perturb((a) => (a.unsigned.dark[0] = "#26313b")),
    perturb((a) => (a.rows.light[8] = "#071738")),
    perturb((a) => (a.roles.light.positive = "#2d769d")),
    perturb((a) => (a.roles.dark.stateInk = "#a1b5a8")),
    perturb((a) => (a.roles.light.occupancy = "#768d7f")),
  ];
  for (const v of variants) {
    const id = E.lut.appearanceId(v);
    assert.match(id, /^slate2-[0-9a-f]{8}$/);
    assert.ok(!seen.has(id), "each perturbation changes the id: " + id);
    seen.add(id);
    assert.equal(E.lut.build(v, "light").id, id, "build and appearanceId agree");
    assert.notEqual(E.lut.build(v, "light").hash, PIN.slate2.hash);
  }
  // The surface colour is not a LUT byte: changing it does not change the appearance.
  assert.equal(E.lut.appearanceId(perturb((a) => (a.roles.light.surface = "#fefefe"))), PIN.slate2.id);
  // The name is in the id but not in the hash.
  const renamed = perturb((a) => (a.name = "other"));
  assert.equal(E.lut.appearanceId(renamed), "other-" + PIN.slate2.hash.slice(0, 8));
});

test("build rejects an unknown appearance and an unknown theme", () => {
  assert.throws(() => E.lut.build("nope", "light"), /unknown appearance/);
  assert.throws(() => E.lut.build("slate2", "sepia"), /theme/);
  assert.throws(() => E.lut.build(42, "light"), /appearance/);
});

// ---- structure of every table ----

for (const name of NAMES)
  for (const theme of THEMES) {
    test(`${name} ${theme}: 256 finite integer 8-bit entries per ramp, css matches bytes, zero gamut clips, frozen record`, () => {
      const lut = E.lut.build(name, theme);
      assert.equal(lut.name, name);
      assert.equal(lut.theme, theme);
      assert.equal(lut.clipped, 0);
      assert.ok(Object.isFrozen(lut));
      for (const role of ["unsigned", "positive", "negative", "rows"]) {
        const ramp = lut[role];
        assert.equal(ramp.rgb.length, 768, role);
        assert.equal(ramp.css.length, 256, role);
        for (let i = 0; i < 256; i++) {
          const c = entry(ramp, i);
          for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${role}[${i}]`);
          assert.equal(ramp.css[i], hexOf(c), `${role}[${i}] css`);
        }
      }
      for (const role of ["midpoint", "occupancy", "stateInk", "zeroInk", "bar"]) {
        assert.match(lut[role].css, /^#[0-9a-f]{6}$/, role);
        assert.equal(lut[role].css, hexOf(Array.from(lut[role].rgb)), role);
      }
      assert.equal(lut.zeroInk.css, lut.occupancy.css, "zeroInk is the occupancy colour");
    });
  }

test("the single roles are the token hexes (CSS parsed from src/explorer.css), in both themes", () => {
  for (const theme of THEMES) {
    const lut = E.lut.build("slate2", theme);
    const tok = (n) => hexOf(TOKENS[n][theme]);
    assert.equal(lut.midpoint.css, tok("--ol-midpoint"), "midpoint = --ol-midpoint");
    assert.equal(lut.occupancy.css, tok("--ol-occupancy"), "occupancy = --ol-occupancy = --ol-border");
    assert.equal(lut.stateInk.css, tok("--ol-state"), "stateInk = --ol-state = --ol-muted");
    assert.equal(lut.positive.css[255], tok("--ol-positive"), "the positive arm ends at --ol-positive");
    assert.equal(lut.negative.css[255], tok("--ol-negative"), "the negative arm ends at --ol-negative");
    // The roles carry the hexes of the retired buy, sell and neutral tokens (DR-20: renamed by role, hex unchanged); the
    // interim legacy names carry them too, until their consumers move.
    const retired = { light: ["#2d769c", "#b3624b", "#b9c2bc"], dark: ["#73b8d4", "#d89777", "#5f6b64"] }[theme];
    assert.equal(tok("--ol-positive"), retired[0]);
    assert.equal(tok("--ol-negative"), retired[1]);
    assert.equal(tok("--ol-midpoint"), retired[2]);
    assert.equal(tok("--ol-legacy-buy"), tok("--ol-positive"));
    assert.equal(tok("--ol-legacy-sell"), tok("--ol-negative"));
    assert.equal(tok("--ol-occupancy"), tok("--ol-border"));
    assert.equal(tok("--ol-state"), tok("--ol-muted"));
    assert.equal(hexOf(SURFACE[theme]), theme === "light" ? "#ffffff" : "#161f19");
  }
});

test("sampled entries of API.md A.1 and the constant bar entry (unsigned index 160)", () => {
  const idx = [0, 12, 64, 128, 192, 243, 255];
  const light = E.lut.build("slate2", "light");
  const dark = E.lut.build("slate2", "dark");
  assert.deepEqual(idx.map((i) => light.unsigned.css[i]), ["#e2e8ee", "#d9e0e8", "#a8b8c8", "#5f7a95", "#2c3f58", "#122033", "#0e1a2b"]);
  assert.deepEqual(idx.map((i) => dark.unsigned.css[i]), ["#26313a", "#2c3843", "#495d70", "#7897af", "#b5cbdb", "#e6eef5", "#f1f6fa"]);
  assert.equal(light.unsigned.css.slice(0, 13).join(" "), "#e2e8ee #e1e7ed #e0e7ed #e0e6ec #dfe5ec #dee5eb #dde4eb #dce3ea #dce3ea #dbe2e9 #dae1e9 #d9e1e8 #d9e0e8");
  assert.equal(light.bar.css, "#435a75");
  assert.equal(dark.bar.css, "#97b2c8");
  assert.equal(light.bar.css, light.unsigned.css[160]);
  assert.equal(dark.bar.css, dark.unsigned.css[160]);
  // The worked coordinate examples of A.1: t 0.5 is entry 128 (round(0.5 * 255) = 128), t 0.017513 entry 4.
  assert.equal(Math.round(0.5 * 255), 128);
  assert.equal(light.unsigned.css[Math.round(0.017513 * 255)], "#dfe5ec");
  assert.equal(light.unsigned.css[40], "#c1ccd8");
  assert.equal(light.positive.css[128], "#7a9bac");
});

// ---- Lab: d3 as the independent oracle ----

test("rgbToLab agrees with d3.lab to 1e-4 on 20,000 seeded colours, and on every grey", () => {
  const next = mulberry32(18);
  let worst = 0;
  for (let n = 0; n < 20000; n++) {
    const c = [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)];
    const mine = E.lut.rgbToLab(c[0], c[1], c[2]);
    const theirs = labOf(c);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(mine[k] - theirs[k]));
  }
  assert.ok(worst < 1e-4, "worst difference " + worst);
  for (let g = 0; g < 256; g++) {
    const mine = E.lut.rgbToLab(g, g, g);
    assert.equal(mine[1], 0, "a grey has a exactly 0");
    assert.equal(mine[2], 0, "a grey has b exactly 0");
    assert.ok(Math.abs(mine[0] - labOf([g, g, g])[0]) < 1e-9);
  }
});

test("rgbToLab of the published sRGB primaries (D50, Bradford) within the fixture's tolerance", () => {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/color/known-lab.json"), "utf8"));
  for (const p of fx.points) {
    const got = E.lut.rgbToLab(...p.rgb);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(got[k] - p.lab[k]) <= fx.tolerance, `${p.rgb} component ${k}: ${got[k]} vs ${p.lab[k]}`);
  }
});

test("labToRgb inverts rgbToLab to a fraction of a channel value and does not clamp", () => {
  const next = mulberry32(19);
  let worst = 0;
  for (let n = 0; n < 5000; n++) {
    const c = [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256)];
    const back = E.lut.labToRgb(...E.lut.rgbToLab(...c));
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(back[k] - c[k]));
  }
  assert.ok(worst < 1e-3, "round trip worst " + worst);
  const out = E.lut.labToRgb(60, 120, 100); // far outside sRGB
  assert.ok(out.some((v) => v > 255 || v < 0), "an out-of-gamut Lab is reported as such, not clamped");
});

for (const name of NAMES)
  for (const theme of THEMES) {
    test(`${name} ${theme}: every ramp is d3.piecewise(d3.interpolateLab) of its stops to within one channel value`, () => {
      const app = E.lut.APPEARANCES[name];
      const roles = app.roles[theme];
      const lut = E.lut.build(name, theme);
      const cases = [
        ["unsigned", Array.from(app.unsigned[theme])],
        ["positive", [roles.midpoint, roles.positive]],
        ["negative", [roles.midpoint, roles.negative]],
        ["rows", Array.from((app.rows || app.unsigned)[theme])],
      ];
      for (const [role, stops] of cases) {
        const f = d3.piecewise(d3.interpolateLab, stops);
        let worst = 0;
        for (let i = 0; i < 256; i++) {
          const c = d3.rgb(f(i / 255));
          const mine = entry(lut[role], i);
          worst = Math.max(worst, Math.abs(mine[0] - c.r), Math.abs(mine[1] - c.g), Math.abs(mine[2] - c.b));
        }
        assert.ok(worst <= 1, `${role}: worst channel difference ${worst}`);
      }
      assert.equal(lut.rows === lut.unsigned, name === "ramp1", "ramp1's rows ramp is its unsigned ramp; slate2 has its own");
    });
  }

// ---- CIEDE2000 ----

const SHARMA = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/color/sharma2005.json"), "utf8")).pairs;

test("the reference CIEDE2000 reproduces the 34 published Sharma pairs to 4 decimals", () => {
  assert.equal(SHARMA.length, 34);
  for (const p of SHARMA) assert.ok(Math.abs(ref.deltaE2000(p.lab1, p.lab2) - p.expected) < 5e-5, `pair ${p.pair}: ${ref.deltaE2000(p.lab1, p.lab2)} vs ${p.expected}`);
});

test("E.lut.deltaE2000 reproduces the 34 published Sharma pairs to 4 decimals", () => {
  for (const p of SHARMA) assert.ok(Math.abs(E.lut.deltaE2000(p.lab1, p.lab2) - p.expected) < 5e-5, `pair ${p.pair}: ${E.lut.deltaE2000(p.lab1, p.lab2)} vs ${p.expected}`);
});

test("deltaE2000: identity is 0, symmetric, and equal to the reference on 5,000 seeded pairs (hue seam and zero chroma included)", () => {
  const next = mulberry32(2000);
  for (let n = 0; n < 5000; n++) {
    const lab = () => [next() * 100, (next() - 0.5) * 200, (next() - 0.5) * 200];
    const a = lab();
    // Every fifth colour has no chroma: the branch the paper singles out.
    const b = n % 5 === 0 ? [next() * 100, 0, 0] : lab();
    assert.equal(E.lut.deltaE2000(a, a), 0);
    const d = E.lut.deltaE2000(a, b);
    assert.ok(Math.abs(d - E.lut.deltaE2000(b, a)) < 1e-9, "symmetry");
    assert.ok(Math.abs(d - ref.deltaE2000(a, b)) < 1e-9, `reference: ${d} vs ${ref.deltaE2000(a, b)}`);
  }
});

// ---- the D11 screens ----

// API.md A.1 measurements (8-bit output, both themes), to the precision the document prints.
const MEASURED = {
  slate2: {
    light: { first: 6.22, adj: 0.878, rev: 0, pos: [31.2, 0.715], neg: [26.7, 1.093, 0.079], mid: 15.26, rows: [5.42, 0.795, 0] },
    dark: { first: 11.18, adj: 0.873, rev: 0, pos: [27.0, 0.73], neg: [24.4, 0.865, 0], mid: 25.01, rows: [5.67, 0.853, 0] },
  },
  ramp1: { light: { first: 17.22, adj: 0.927, rev: 0 }, dark: { first: 9.25, adj: 1.013, rev: 0 } },
};

for (const name of NAMES)
  for (const theme of THEMES) {
    test(`${name} ${theme}: the D11 screens pass on the 8-bit output and match the measured numbers of API.md A.1`, () => {
      const lut = E.lut.build(name, theme);
      const s = E.lut.screens(lut, SURFACE[theme]);
      assert.deepEqual(Array.from(s.failures), []);
      assert.equal(s.ok, true);
      const m = MEASURED[name][theme];
      // The thresholds themselves, recomputed here with the independent oracles.
      const surfaceLab = labOf(SURFACE[theme]);
      const labs = Array.from({ length: 256 }, (_, i) => labOf(entry(lut.unsigned, i)));
      const first = ref.deltaE2000(surfaceLab, labs[0]);
      let adj = 0;
      for (let i = 1; i < 256; i++) adj = Math.max(adj, ref.deltaE2000(labs[i - 1], labs[i]));
      const dir = Math.sign(labs[255][0] - surfaceLab[0]);
      let run = -Infinity;
      let reversal = 0;
      for (const l of labs) {
        run = Math.max(run, dir * l[0]);
        reversal = Math.max(reversal, run - dir * l[0]);
      }
      assert.ok(first >= 5, "idx 0 is the lowest NONZERO entry and is at least dE2000 5 from the surface: " + first);
      assert.ok(adj <= 2, "adjacent entries: " + adj);
      assert.ok(reversal <= 0.2, "no lightness reversal: " + reversal);
      assert.ok(Math.abs(first - m.first) < 0.01, `first ${first} vs ${m.first}`);
      assert.ok(Math.abs(adj - m.adj) < 0.001, `adjacent ${adj} vs ${m.adj}`);
      assert.ok(Math.abs(reversal - m.rev) < 0.001);
      assert.ok(Math.abs(s.unsigned.first - first) < 1e-6 && Math.abs(s.unsigned.maxAdjacent - adj) < 1e-6 && Math.abs(s.unsigned.reversal - reversal) < 1e-9, "the module reports what the oracle computes");
      if (name === "slate2") {
        assert.ok(Math.abs(s.positive.departure - m.pos[0]) < 0.05 && Math.abs(s.positive.maxAdjacent - m.pos[1]) < 0.001, "positive arm");
        assert.ok(Math.abs(s.negative.departure - m.neg[0]) < 0.05 && Math.abs(s.negative.maxAdjacent - m.neg[1]) < 0.001 && Math.abs(s.negative.reversal - m.neg[2]) < 0.001, "negative arm");
        assert.ok(s.negative.reversal < 0.2 && s.positive.reversal <= 0.2);
        assert.ok(Math.abs(s.midpoint.distance - m.mid) < 0.01, "midpoint distance " + s.midpoint.distance);
        assert.equal(s.rows.claimed, true);
        assert.ok(Math.abs(s.rows.first - m.rows[0]) < 0.01 && Math.abs(s.rows.maxAdjacent - m.rows[1]) < 0.001 && s.rows.reversal <= 0.001, `rows composite ${JSON.stringify(s.rows)}`);
      } else {
        assert.equal(s.rows.claimed, false, "ramp1 makes no band claim");
      }
    });
  }

test("the arms start AT the midpoint and neither departs backwards; the midpoint is never the surface", () => {
  for (const theme of THEMES) {
    const lut = E.lut.build("slate2", theme);
    const mid = Array.from(lut.midpoint.rgb);
    assert.deepEqual(entry(lut.positive, 0), mid, "positive[0] == midpoint");
    assert.deepEqual(entry(lut.negative, 0), mid, "negative[0] == midpoint");
    assert.ok(ref.deltaE2000(labOf(mid), labOf(SURFACE[theme])) >= 5, "zero Delta never vanishes into the empty surface");
    const midL = labOf(mid)[0];
    for (const arm of [lut.positive, lut.negative]) {
      let run = 0;
      for (let i = 0; i < 256; i++) {
        const dep = Math.abs(labOf(entry(arm, i))[0] - midL);
        run = Math.max(run, dep);
        assert.ok(run - dep <= 0.2, `departure reverses at ${i}`);
      }
    }
  }
});

test("the rows role is screened on its 16% composite over the real surface, not on its raw colours", () => {
  for (const theme of THEMES) {
    const lut = E.lut.build("slate2", theme);
    const comp = E.lut.composite("rows", E.lut.ROWS_ALPHA, SURFACE[theme]);
    assert.equal(comp.css.length, 256);
    const surfaceLab = labOf(SURFACE[theme]);
    const cl = Array.from({ length: 256 }, (_, i) => labOf(entry(comp, i)));
    assert.ok(ref.deltaE2000(surfaceLab, cl[0]) >= 5, "composite idx 0");
    assert.ok(ref.deltaE2000(surfaceLab, cl[12]) >= 5, "composite idx 12 (the low-discrimination edge)");
    let adj = 0;
    for (let i = 1; i < 256; i++) adj = Math.max(adj, ref.deltaE2000(cl[i - 1], cl[i]));
    assert.ok(adj <= 2);
    // Independent composite: source-over at 0.16, rounded as a canvas does.
    for (const i of [0, 1, 12, 100, 128, 200, 255]) assert.deepEqual(entry(comp, i), refContrast.over(entry(lut.rows, i), 0.16, SURFACE[theme]), `entry ${i}`);
    // The retired design (compositing the unsigned ramp) fails the screen, which is why `rows` exists (DD-86).
    const naive = refContrast.over(entry(lut.unsigned, 0), 0.16, SURFACE[theme]);
    assert.ok(ref.deltaE2000(surfaceLab, labOf(naive)) < 5, "the unsigned ramp composited at 0.16 would be within dE 5 of the surface at idx 0");
  }
});

test("composite: roles, sources and refusals", () => {
  const s = SURFACE.light;
  const lut = E.lut.build("slate2", "light");
  // Given a Lut it is used as is; given a name or nothing the theme comes from the surface.
  assert.deepEqual(Array.from(E.lut.composite("positive", 0.5, s, lut).rgb), Array.from(E.lut.composite("positive", 0.5, s).rgb));
  assert.deepEqual(Array.from(E.lut.composite("negative", 0.5, s, "slate2").rgb), Array.from(E.lut.composite("negative", 0.5, s).rgb));
  const dark = E.lut.composite("rows", 0.16, SURFACE.dark);
  assert.notDeepEqual(Array.from(dark.rgb), Array.from(E.lut.composite("rows", 0.16, s).rgb), "the surface selects the theme");
  assert.deepEqual(entry(E.lut.composite("unsigned", 1, s), 77), entry(lut.unsigned, 77), "alpha 1 is the raw ramp");
  assert.deepEqual(entry(E.lut.composite("unsigned", 0, s), 77), [255, 255, 255], "alpha 0 is the surface");
  assert.throws(() => E.lut.composite("midpoint", 0.16, s), /role/);
});

test("mutation: a reversed entry, a gamut-clipped table and a too-close first entry each fail the validator", () => {
  const surface = SURFACE.light;
  const clone = (ramp) => ({ css: ramp.css.slice(), rgb: Uint8Array.from(Array.from(ramp.rgb)) });
  const lut = E.lut.build("slate2", "light");
  const base = { ...lut, unsigned: clone(lut.unsigned), positive: clone(lut.positive), negative: clone(lut.negative), rows: clone(lut.rows) };
  assert.equal(E.lut.screens(base, surface).ok, true, "the unmutated copy passes");

  const swap = (ramp, i, j) => {
    for (let c = 0; c < 3; c++) {
      const t = ramp.rgb[i * 3 + c];
      ramp.rgb[i * 3 + c] = ramp.rgb[j * 3 + c];
      ramp.rgb[j * 3 + c] = t;
    }
  };
  const reversed = { ...base, unsigned: clone(lut.unsigned) };
  swap(reversed.unsigned, 100, 110);
  const r = E.lut.screens(reversed, surface);
  assert.equal(r.ok, false);
  assert.ok(r.unsigned.reversal > 0.2, "reversal " + r.unsigned.reversal);
  assert.ok(r.failures.some((f) => /reverses/.test(f)));

  const jump = { ...base, unsigned: clone(lut.unsigned) };
  for (let c = 0; c < 3; c++) jump.unsigned.rgb[100 * 3 + c] = 0; // one black entry: a jump, and a reversal
  assert.equal(E.lut.screens(jump, surface).ok, false);

  const clipped = { ...base, clipped: 1 };
  const c = E.lut.screens(clipped, surface);
  assert.equal(c.ok, false);
  assert.ok(c.failures.some((f) => /clipped/.test(f)));

  const close = { ...base, unsigned: clone(lut.unsigned) };
  for (let k = 0; k < 3; k++) close.unsigned.rgb[k] = 255; // entry 0 is the surface itself
  const cl = E.lut.screens(close, surface);
  assert.equal(cl.ok, false);
  assert.ok(cl.unsigned.first < 5);

  const armOff = { ...base, positive: clone(lut.positive) };
  armOff.positive.rgb[0] = 0;
  assert.equal(E.lut.screens(armOff, surface).positive.startsAtMidpoint, false);
  assert.equal(E.lut.screens(armOff, surface).ok, false);

  const badMid = { ...base, midpoint: { css: "#ffffff", rgb: [255, 255, 255] } };
  assert.equal(E.lut.screens(badMid, surface).midpoint.ok, false, "a midpoint equal to the surface is refused");
});

// ---- bands, themeOf, colour parsing ----

test("low-discrimination bands: idx <= 12 and idx >= 243, as t thresholds", () => {
  assert.equal(E.THRESHOLDS.LUT_LOW_MAX, 12);
  assert.equal(E.THRESHOLDS.LUT_HIGH_MIN, 243);
  // idx = round(clamp(t,0,1) * 255): idx <= 12 iff t * 255 < 12.5, idx >= 243 iff t * 255 >= 242.5 (A.1: 0.04902, 0.95098).
  assert.ok(Math.abs(12.5 / 255 - 0.04902) < 1e-5);
  assert.ok(Math.abs(242.5 / 255 - 0.95098) < 1e-5);
});

test("themeOf: dark iff Lab lightness < 50, checked on every grey against d3.lab, and on the real surfaces", () => {
  for (let g = 0; g < 256; g++) assert.equal(E.lut.themeOf([g, g, g]), labOf([g, g, g])[0] < 50 ? "dark" : "light", "grey " + g);
  assert.equal(E.lut.themeOf(SURFACE.light), "light");
  assert.equal(E.lut.themeOf(SURFACE.dark), "dark");
  assert.equal(E.lut.themeOf(TOKENS["--ol-panel"].dark), "dark");
  assert.equal(E.lut.themeOf(TOKENS["--ol-panel"].light), "light");
});

test("parseColor: what getComputedStyle yields, hex, and a refusal for what it cannot know", () => {
  const p = (s) => {
    const v = E.lut.parseColor(s);
    return v === null ? null : Array.from(v);
  };
  assert.deepEqual(p("rgb(22, 31, 25)"), [22, 31, 25]);
  assert.deepEqual(p("rgb(22 31 25)"), [22, 31, 25]);
  assert.deepEqual(p("rgba(22, 31, 25, 1)"), [22, 31, 25]);
  assert.deepEqual(p("#161f19"), [22, 31, 25]);
  assert.deepEqual(p("#FFF"), [255, 255, 255]);
  assert.deepEqual(p("  #E2E8EE "), [226, 232, 238]);
  assert.equal(p("rgba(22, 31, 25, 0.5)"), null, "a translucent colour has no single backdrop");
  assert.equal(p("rgb(300, 0, 0)"), null);
  assert.equal(p("red"), null);
  assert.equal(p("light-dark(#fff, #000)"), null);
  assert.equal(p(""), null);
  assert.equal(p(undefined), null);
});

test("build is deterministic and holds no shared state: two builds are equal and mutating one cannot reach the next", () => {
  const a = E.lut.build("slate2", "dark");
  a.unsigned.rgb[0] = 0;
  assert.throws(() => {
    a.unsigned.css[0] = "#000000";
  }, TypeError, "the css array is frozen");
  const b = E.lut.build("slate2", "dark");
  assert.equal(b.unsigned.rgb[0], 0x26, "a second build is not affected by a mutation of the first");
  assert.equal(b.hash, PIN.slate2.hash);
});
