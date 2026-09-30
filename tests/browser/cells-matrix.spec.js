"use strict";
// cells-matrix.spec.js (package C, stage 2b): every Cells encoding x basis x transform on the canvas, in both themes.
//
// What it asserts. For each combination the page is opened on a hand-computed fixture (micro:mixed, every cell's values are in the
// fixture's own `expected`), the drawn marks are recorded (cells-support.js: every fillRect and strokeRect with the style in force
// and the plot rectangle), and each cell's mark is compared with the entry of the pinned Lut that the combination implies:
//   - the kind of mark (a fill, an outline in the colour of its value, an outline in the occupancy ink, a pattern tile),
//   - the exact colour (the pinned Lut entry at the expected index, light or dark),
//   - the pixel at the corners of the cell's box (getImageData at DPR 1: what is on the canvas, not what was asked of it).
// The expected ENTRY is written out here from the hand values and the rules of API.md C.3 to C.5: the Value fit (maximum U, Type-7
// median k of the cohort), t = log1p(a / k) / log1p(U / k) or a / U, the rank knots, the fixed windows; idx = round(255 |t|).
//
// Oracles (none is the code under test's output for the same question):
//   - tests/fixtures/trades/mixed.json (hand-computed cells and motion, the `notes` derive them) and, for the larger cases,
//     tests/reference (exact-rational cells, Type-7 knots and rank) over the trades the fake serves;
//   - the Lut of window.explorerEncoding in the page, which U18 pins by hash, read only for "which colour is entry i of role r";
//   - the canvas recorder and getImageData.
// Every test runs with reducedMotion "reduce" (no morph frame can be the one captured).
//
// Not covered: the legend bar pixels and chips (U, B23), the tooltip (T, B03).
const { test, expect, observe, probeTools } = require("./fixtures.js");
const { addRecorder, lastDraw, openView, pageColours, rectOf, boxOf, opsOfBox } = require("./cells-support.js");
const reference = require("../reference/index.js");
const fs = require("node:fs");
const path = require("node:path");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "trades", `${name}.json`), "utf8"));

const MIXED = fixture("mixed");
const VIEW = { from: "2021-01-01T00:00Z", to: "2021-01-01T00:06Z", low: 24750, high: 25500 };
const RECT = rectOf(VIEW);
const CUT = MIXED.expected.rect.cutMs / 56250; // the cutoff in base columns: 5.333
const COLUMN_SECONDS = 56.25;
const ROW_USDT = 125;
const APPEARANCE = "slate2-8f7890f7"; // the pinned default appearance (API.md A.1)

// ---- the hand rules of the encoding (API.md C.1.4, C.3, C.4, C.5), written out ----------------------------------------------

const round255 = (t) => Math.round(Math.min(1, Math.abs(t)) * 255);

// What a cell is exposed to: seconds of its column inside the rectangle and before the cutoff, USDT of its rows inside the rectangle.
function exposure(z, n, m) {
  const ts = 2 ** n;
  const ps = 2 ** m;
  const seconds = Math.max(0, Math.min((z.c + 1) * ts, RECT.tB, CUT) - Math.max(z.c * ts, RECT.tA)) * COLUMN_SECONDS;
  const width = Math.max(0, Math.min((z.r + 1) * ps, RECT.pB) - Math.max(z.r * ps, RECT.pA)) * ROW_USDT;
  return { seconds, width };
}

// The measure of a volume cell for a mode and basis (a number), from its sums.
function amountOf(mode, basis, z, n, m) {
  const x = mode === "trades" ? z.ct : mode === "delta" ? 2 * z.bv - z.v : mode === "size" ? z.v / z.ct : z.v;
  if (basis !== "intensity") return x;
  const { seconds, width } = exposure(z, n, m);
  return (x * 60 * ROW_USDT) / (seconds * width);
}

// The mapping an Explore fit makes over a cohort of values and what it gives a value: {role, idx} (idx null for a zero).
function explore(cohort, { signed, transform, curve }) {
  const magnitudes = cohort.map(Math.abs).filter((x) => x !== 0);
  if (transform === "rank") {
    const knots = reference.knots257(magnitudes);
    return (x) => {
      if (x === 0) return { role: "zero", idx: null };
      return { role: "unsigned", idx: round255(reference.rankApply(knots, x).t) };
    };
  }
  const U = Math.max(...magnitudes);
  const k = magnitudes.every((x) => x === magnitudes[0]) ? U : reference.median7(magnitudes);
  return (x) => {
    const a = Math.abs(x);
    if (a === 0) return signed ? { role: "midpoint", idx: null } : { role: "zero", idx: null };
    const t = curve === "linear" ? a / U : Math.log1p(a / k) / Math.log1p(U / k);
    const role = signed ? (x > 0 ? "positive" : "negative") : "unsigned";
    return { role, idx: round255(t) };
  };
}

// A fixed signed mapping: a value over a window about a midpoint (Taker share 0..1 about 0.5, Cascade -2..+2 about 0).
function fixedSigned(x, { lo, hi, mid }) {
  if (x === mid) return { role: "midpoint", idx: null };
  const t = x > mid ? (Math.min(x, hi) - mid) / (hi - mid) : (mid - Math.max(x, lo)) / (mid - lo);
  return { role: x > mid ? "positive" : "negative", idx: round255(t) };
}

// ---- what to expect on the canvas ---------------------------------------------------------------------------------------------

// A mark is {c, r, kind, style}: kind "fill" (a fillRect), "outline" (a strokeRect) or "pattern" (a fillRect of a tile), style a
// role and entry turned into the colour of the page's own Lut, or the name of the tile.
function styleOf(colours, { role, idx }) {
  if (role === "zero") return colours.lutOccupancy;
  if (role === "midpoint") return colours.midpoint;
  return colours[role][idx];
}

// The mark of one cell with a value. A zero of an unsigned measure is the occupancy outline; every other role is a fill.
function valueMark(z, result, colours) {
  return { c: z.c, r: z.r, kind: result.role === "zero" ? "outline" : "fill", style: styleOf(colours, result) };
}

// The marks of a volume mode at level (0, 0) over the mixed fixture: every cell of the rectangle, the open column's too.
function volumeMarks(combo, colours) {
  const cells = MIXED.expected.cells["0:0"];
  const signed = combo.mode === "delta";
  const complete = (z) => z.c + 1 <= CUT;
  const values = cells.map((z) => amountOf(combo.mode, combo.basis, z, 0, 0));
  const cohort = cells.map((z, i) => (complete(z) ? values[i] : null)).filter((x) => x !== null);
  const map = explore(cohort, { signed, transform: combo.transform, curve: combo.curve });
  return cells.map((z, i) => valueMark(z, map(values[i]), colours));
}

// Taker flow by USDT or by trades: a fixed signed scale about one half; no fit.
function flowMarks(combo, colours) {
  return MIXED.expected.cells["0:0"].map((z) => {
    const share = combo.mode === "flowtrades" ? z.bt / z.ct : z.bv / z.v;
    return valueMark(z, fixedSigned(share, { lo: 0, hi: 1, mid: 0.5 }), colours);
  });
}

// Cascade at level (1, 1): the share of a cell in its parent, log2(4 x share), on the fixed -2..+2 scale; a parent that runs past the
// cutoff is not complete, and its children are the neutral pattern (waiting for it).
function cascadeMarks(colours) {
  const cells = reference.cells(MIXED.trades, { n: 1, m: 1, b0: 0, b1: 7 });
  const parents = reference.cells(MIXED.trades, { n: 2, m: 2, b0: 0, b1: 7 });
  return cells.map((z) => {
    const pc = Math.floor(z.c / 2);
    if ((pc + 1) * 4 > CUT) return { c: z.c, r: z.r, kind: "pattern", style: colours.tiles["pattern-slate"] };
    const parent = parents.find((p) => p.c === pc && p.r === Math.floor(z.r / 2));
    return valueMark(z, fixedSigned(Math.log2((4 * z.v) / parent.v), { lo: -2, hi: 2, mid: 0 }), colours);
  });
}

// Path and Dwell at level (0, 0): the motion cells of the read (columns 0..4: it ends at base 5); the two traded cells of the open
// column are not read yet. A traded cell is a fill, a cell the price only crossed or held in an outline in its colour, a zero an
// outline in the occupancy ink.
function motionMarks(combo, colours) {
  const cells = MIXED.expected.motion["0:0"];
  const valueOf = (z) => {
    const { seconds, width } = exposure(z, 0, 0);
    if (combo.mode === "dwell") return z.w / seconds;
    return combo.pathBasis === "usdt" ? z.p : combo.pathBasis === "perMinute" ? (60 * z.p) / (width * seconds) : z.p / width;
  };
  const values = cells.map(valueOf);
  const map = combo.mode === "dwell" ? null : explore(values, { signed: false, transform: combo.transform, curve: combo.curve });
  const marks = cells.map((z, i) => {
    const result = combo.mode === "dwell" ? (values[i] === 0 ? { role: "zero", idx: null } : { role: "unsigned", idx: round255(values[i]) }) : map(values[i]);
    const mark = valueMark(z, result, colours);
    // a cell the price only crossed or held in is an outline even when it has a value
    if (z.ct === 0) mark.kind = "outline";
    return mark;
  });
  for (const z of MIXED.expected.cells["0:0"].filter((x) => x.c >= 5)) marks.push({ c: z.c, r: z.r, kind: "pattern", style: colours.tiles["pattern-dots"] });
  return marks;
}

// ---- the combinations ----------------------------------------------------------------------------------------------------------

const AMOUNT = { basis: "amount", pathBasis: "spans", transform: "value", curve: "log" };
const combos = [];
const add = (name, mode, over = {}) => combos.push({ name, mode, ...AMOUNT, ...over });
for (const mode of ["volume", "trades"])
  for (const basis of ["amount", "intensity"])
    for (const transform of ["value", "rank"]) add(`${mode} ${basis} ${transform}`, mode, { basis, transform });
add("volume amount value (linear)", "volume", { curve: "linear" });
add("size mean value", "size");
add("size mean rank", "size", { transform: "rank" });
for (const basis of ["amount", "intensity"]) add(`delta ${basis} value`, "delta", { basis });
add("flow", "flow");
add("flowtrades", "flowtrades");
add("cascade", "cascade", { level: [1, 1] });
add("geometry", "geometry");
for (const pathBasis of ["spans", "usdt", "perMinute"])
  for (const transform of ["value", "rank"]) add(`path ${pathBasis} ${transform}`, "path", { pathBasis, transform });
add("dwell", "dwell");

const addressOf = (combo) => {
  const [n, m] = combo.level || [0, 0];
  const extra = [
    combo.basis === "intensity" ? "&bs=i" : "",
    combo.pathBasis === "usdt" ? "&pb=u" : combo.pathBasis === "perMinute" ? "&pb=m" : "",
    combo.transform === "rank" ? "&tr=r" : "",
    combo.curve === "linear" ? "&cv=l" : "",
  ].join("");
  // vis=2 and ap= make it an address of this version: a plain (legacy) address restores the view only and ignores the settings.
  return `#t=${VIEW.from}~${VIEW.to}&p=${VIEW.low}~${VIEW.high}&r=${n},${m}&mode=${combo.mode}&vis=2&ap=${APPEARANCE}${extra}`;
};

const marksOf = (combo, colours) => {
  if (combo.mode === "flow" || combo.mode === "flowtrades") return flowMarks(combo, colours);
  if (combo.mode === "cascade") return cascadeMarks(colours);
  if (combo.mode === "path" || combo.mode === "dwell") return motionMarks(combo, colours);
  return volumeMarks(combo, colours);
};

// ---- the page ------------------------------------------------------------------------------------------------------------------

async function open({ freshContext, fakeFor }, profile, hash, options = {}) {
  const fake = await fakeFor(profile);
  const context = await freshContext({ reducedMotion: "reduce", ...options });
  await addRecorder(context);
  const page = await context.newPage();
  const probe = probeTools.forPage(page);
  await openView(page, fake, probe, hash);
  // The mapping lands after the settle: wait until the chip says no calibration is pending, then for the draw that paints it.
  const surface = observe(page);
  await expect.poll(async () => (await surface.chip("cells")).data.updating, { timeout: 10000 }).toBe("false");
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
  return { fake, page, probe, surface, context };
}

const hex = (px) => `#${px.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const pixelsAt = (page, points) =>
  page.evaluate(
    (list) => {
      const c = document.getElementById("ol-canvas").getContext("2d");
      return list.map(([x, y]) => [...c.getImageData(Math.round(x), Math.round(y), 1, 1).data]);
    },
    points,
  ).then((rows) => rows.map(hex));

// The four inner corners of a box, three pixels in: a fill is opaque and any one of them can be crossed by a price line or a grid
// line, so a mark is on the canvas when at least one of the four shows its colour (and the canvas is asked for exactly that pixel).
const corners = (box) => [
  [box.x0 + 3, box.y0 + 3],
  [box.x1 - 3, box.y0 + 3],
  [box.x0 + 3, box.y1 - 3],
  [box.x1 - 3, box.y1 - 3],
];

// Every mark of the expectation is on the canvas once, as its kind, in its colour, and (for a fill) the pixel shows it.
async function expectCanvas(page, draw, marks, colours, { n, m }, label) {
  const plotRect = draw.plot;
  for (const mark of marks) {
    const box = boxOf(plotRect, RECT, n, m, mark.c, mark.r, CUT);
    const ops = opsOfBox(draw, box);
    const what = `${label}: cell ${mark.c}:${mark.r}`;
    expect(ops, `${what} is painted once`).toHaveLength(1);
    expect(ops[0].op, `${what}: a ${mark.kind}`).toBe(mark.kind === "outline" ? "strokeRect" : "fillRect");
    expect(ops[0].style, `${what}: the colour of the pinned Lut`).toBe(mark.style);
    if (mark.kind === "outline") {
      expect(ops[0].lineWidth, `${what}: one pixel wide, set explicitly`).toBe(1);
      expect(ops[0].alpha, `${what}: at alpha 1`).toBe(1);
    }
    if (mark.kind === "fill") {
      const seen = await pixelsAt(page, corners(box));
      expect(seen, `${what}: the canvas shows ${mark.style} at one of the four inner corners`).toContain(mark.style);
    } else if (mark.kind === "outline" && box.x1 - box.x0 > 10 && box.y1 - box.y0 > 10) {
      const seen = await pixelsAt(page, corners(box));
      expect(seen, `${what}: the inside of an outline is the empty surface`).toContain(colours.surface);
    }
  }
}

for (const theme of ["light", "dark"]) {
  test.describe(`cells matrix on micro:mixed, ${theme} theme`, () => {
    for (const combo of combos) {
      test(combo.name, async ({ freshContext, fakeFor }) => {
        const { page, surface, context } = await open({ freshContext, fakeFor }, "micro:mixed", addressOf(combo), { colorScheme: theme });
        // The page polls the fake for a newer pack; the context is closed before the fake is, so a poll in flight at teardown is not
        // reported as a failed load.
        const colours = await pageColours(page, theme);
        const draw = await lastDraw(page);
        const level = combo.level || [0, 0];
        // The page really drew this combination: the chip names the basis and the transform it resolved.
        const chip = (await surface.chip("cells")).data;
        if (combo.mode !== "geometry") expect(["ready", "fixed"], `the chip is calibrated (${chip.state})`).toContain(chip.state);
        if (["volume", "trades", "size"].includes(combo.mode) && combo.transform === "rank") expect(chip.transform).toBe("rank");
        if (combo.mode === "volume" || combo.mode === "trades") expect(chip.basis).toBe(combo.basis);
        // The surface under the plot is the page's own, in this theme.
        if (theme === "light") expect(colours.surface, "the light surface").toBe("#ffffff");
        else expect(Number.parseInt(colours.surface.slice(1, 3), 16), "the dark surface is dark").toBeLessThan(0x40);
        if (combo.mode === "geometry") {
          const cells = MIXED.expected.cells["0:0"];
          const [px, py, pw, ph] = draw.plot;
          const outlines = draw.ops.filter((op) => op.op === "strokeRect" && op.style === colours.lutOccupancy && op.x >= px && op.y >= py && op.x + op.w <= px + pw + 1 && op.y + op.h <= py + ph + 1);
          expect(outlines, "one occupancy outline per occupied cell").toHaveLength(cells.length);
          for (const op of outlines) {
            expect(op.lineWidth).toBe(1);
            expect(op.alpha).toBe(1);
          }
        } else await expectCanvas(page, draw, marksOf(combo, colours), colours, { n: level[0], m: level[1] }, combo.name);
        await context.close();
      });
    }
  });
}
