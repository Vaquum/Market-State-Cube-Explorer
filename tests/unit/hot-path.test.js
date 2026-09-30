"use strict";
// U49 (DD-T32, D12, S1-192): the per-cell path of a steady frame allocates nothing and does no per-cell setup.
// It guards "no per-cell allocation, no sorts, no d3.interpolate* in a steady frame" with two halves:
//   (1) a SOURCE guard: Function.prototype.toString() of E.scale.index, the closures E.scale.plan returns
//       (one per descriptor kind), E.measure.cellValue and `encode` of a real cells, rows and pane frame,
//       with comments and string contents blanked, must not contain `new `, `.map(`, `.filter(`, `.slice(`,
//       `.sort(`, spread, `Object.assign`, `Array.from`, `d3.`, or `Math.log(` (the one logarithm a cell may
//       take is `Math.log1p`). The scan is a guard, not a proof: array and object literals are covered by
//       the behavioural half only.
//   (2) a BEHAVIOURAL guard: `encode(z, out)` returns the caller's `out`, and 1e6 calls grow
//       `process.memoryUsage().heapUsed` by less than 1 MB after a forced GC. A per-cell object of even 32
//       bytes would add about 32 MB, so the threshold is two orders of magnitude above the noise. The GC is
//       reached through `--expose-gc` when it is on, else through v8.setFlagsFromString; when neither works
//       the behavioural half is skipped with the reason stated.
// Oracle: the forbidden-token list of TESTPLAN.md DD-T32, independent of the code under test; the heap
// counter of the runtime.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");
const { mulberry32 } = require("../support/rng");

const GEOM = { BASE: 56.25, PR: 125 };
const LUT = E.lut.build("slate2", "light");
const U = 26791234.56;
const K = 48211.3;

// ---- a source scanner that reads code only ------------------------------------------------------------------------

function codeOf(fn) {
  const src = fn.toString();
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const FORBIDDEN = [
  [/\bnew\s/, "new "],
  [/\.map\(/, ".map("],
  [/\.filter\(/, ".filter("],
  [/\.slice\(/, ".slice("],
  [/\.sort\(/, ".sort("],
  [/\.\.\./, "spread"],
  [/Object\.assign/, "Object.assign"],
  [/Array\.from/, "Array.from"],
  [/\bd3\./, "d3."],
  [/Math\.log\(/, "Math.log("],
];

function scan(name, fn) {
  const code = codeOf(fn);
  assert.ok(code.length > 20, name + ": the source was read (" + code.length + " characters)");
  for (const [re, label] of FORBIDDEN) assert.ok(!re.test(code), `${name} contains ${label}: ${(re.exec(code) || [""]).index === undefined ? "" : code.slice(Math.max(0, re.exec(code).index - 40), re.exec(code).index + 40)}`);
}

// ---- real frames and descriptors --------------------------------------------------------------------------------------------

const LOGU = E.scale.manual({ kind: "value-log1p", signed: false, U, k: K }).descriptor;
const LOGS = E.scale.manual({ kind: "value-log1p", signed: true, U: 1204551.25, k: 8830.5 }).descriptor;
const LINU = E.scale.manual({ kind: "value-linear", signed: false, U }).descriptor;
const RANK = E.scale.fitRank(Array.from({ length: 500 }, (_, i) => 1 + i * 137.3)).descriptor;
const DESCRIPTORS = {
  "value-log1p": LOGU,
  "value-log1p signed": LOGS,
  "value-linear": LINU,
  "rank-type7-257": RANK,
  "fixed-linear": E.scale.fixed("unsigned-share"),
  "fixed-diverging": E.scale.fixed("share-diverging"),
  "zero-only": E.scale.zeroOnly(false),
};

function cellsFrame(mode, desc, extra = {}) {
  const fixed = mode === "flow" || mode === "dwell" || mode === "cascade";
  return E.readout.cellsFrame(
    Object.assign(
      {
        mode,
        basis: mode === "intensity" ? "intensity" : mode === "cascade" ? "log2" : fixed ? "share" : "amount",
        level: { n: 4, m: 1 },
        bounds: [3200, 3264, 400, 416],
        cut: 3250,
        end: 3300,
        geom: GEOM,
        CUT: 3258,
        mapping: fixed ? desc : { state: "ok", desc, policy: "explore" },
        lut: LUT,
      },
      extra,
    ),
  );
}

const PANE_AXIS = { id: "pane.volume", sign: "unsigned", typed: "finite", domain: [0, 1e6], mappingId: "x" };

// ---- (1) the source guard ----------------------------------------------------------------------------------------------------------

test("U49: the source of E.scale.index and of every closure E.scale.plan returns has no allocation, sort or per-cell setup", () => {
  scan("E.scale.index", E.scale.index);
  for (const [name, desc] of Object.entries(DESCRIPTORS)) {
    const plan = E.scale.plan(desc);
    scan("plan(" + name + ").apply", plan.apply);
    scan("plan(" + name + ").index", plan.index);
  }
  scan("plan(none).apply", E.scale.plan({ v: 1, id: "", kind: "none", signed: false, params: null, clip: "clamp01@1" }).apply);
});

test("U49: the source of E.measure.cellValue and of encode of a real cells, rows and pane frame is clean", () => {
  scan("E.measure.cellValue", E.measure.cellValue);
  for (const mode of ["volume", "intensity", "delta", "size", "flow", "dwell", "path", "cascade", "geometry"]) {
    const desc = mode === "delta" ? LOGS : mode === "flow" ? DESCRIPTORS["fixed-diverging"] : mode === "dwell" ? DESCRIPTORS["fixed-linear"] : mode === "cascade" ? E.scale.fixed("log2-ratio") : LOGU;
    const frame = mode === "geometry" ? E.readout.cellsFrame({ mode, level: { n: 4, m: 1 }, geom: GEOM, mapping: null, lut: LUT }) : cellsFrame(mode === "intensity" ? "volume" : mode, desc, mode === "intensity" ? { basis: "intensity" } : {});
    scan("cells encode (" + mode + ")", frame.encode);
  }
  scan("rows encode", E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc: LOGU }, lut: LUT }).encode);
  scan("pane encode", E.readout.paneFrame({ key: "volume", axis: PANE_AXIS, lut: LUT }).encode);
  // The steady path never reaches the allocating ones: no readout, no legend, no E.text inside encode.
  const code = codeOf(cellsFrame("volume", LOGU).encode);
  assert.ok(!/readout\(|legendInput|build\(|\.text\b|keyEntries/.test(code), "encode builds no record");
});

test("U49: the scan itself catches what it claims to catch (the guard is not vacuous)", () => {
  const bad = [
    function (x) { return new Float64Array(x); },
    function (x) { return [x].map((y) => y); },
    function (x) { return x.filter(Boolean); },
    function (x) { return x.slice(1); },
    function (x) { return x.sort(); },
    function (x) { return [...x]; },
    function (x) { return Object.assign({}, x); },
    function (x) { return Array.from(x); },
    function (x) { return d3.interpolateRgb(x, x); },
    function (x) { return Math.log(x); },
  ];
  for (const fn of bad) assert.throws(() => scan("bad", fn), /contains/, fn.toString());
  // Comments and strings are not code.
  scan("commented", function (x) {
    // new Array(x).map(y => y) and Math.log(x)
    const s = "new .map( .sort( Math.log(";
    return x + s.length;
  });
  // Math.log1p is the allowed logarithm.
  scan("log1p", function (x) { return Math.log1p(x); });
});

// ---- (2) the behavioural guard ------------------------------------------------------------------------------------------------------

function forceGc() {
  let gc = typeof globalThis.gc === "function" ? globalThis.gc : null;
  if (gc === null) {
    try {
      require("node:v8").setFlagsFromString("--expose-gc");
      gc = require("node:vm").runInNewContext("gc");
    } catch (error) {
      gc = null;
    }
  }
  return gc;
}

test("U49: encode returns the caller's out object for cells, rows and pane frames", () => {
  const out = {};
  assert.equal(cellsFrame("volume", LOGU).encode({ c: 201, r: 203, v: 1000 }, out), out);
  assert.equal(cellsFrame("volume", LOGU).encode({ c: 201, r: 203, v: NaN }, out), out);
  assert.equal(E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc: LOGU }, lut: LUT }).encode({ r: 1, v: 5 }, out), out);
  assert.equal(E.readout.paneFrame({ key: "volume", axis: PANE_AXIS, lut: LUT }).encode({ v: 5 }, out), out);
  assert.equal(E.scale.plan(LOGU).apply(1000, out), out, "a plan writes into the caller's object too");
});

test("U49: 1e6 encode calls over every mode grow the heap by less than 1 MB after a forced GC", (t) => {
  const gc = forceGc();
  if (gc === null) {
    t.skip("a forced GC is not available (neither --expose-gc nor v8.setFlagsFromString worked): the source guard above is the only half that ran");
    return;
  }
  const next = mulberry32(49);
  const pool = Array.from({ length: 2048 }, (_, i) => {
    const v = Math.pow(10, next() * 7);
    return { c: 200 + (i % 4), r: 200 + ((i >> 2) % 8), v, bv: v * next(), ct: 1 + Math.floor(next() * 400), bt: 1, p: next() * 30, w: next() * 100 };
  });
  pool.push({ c: 201, r: 203, v: 0, bv: 0, ct: 0, bt: 0, p: 0, w: 0 }, { c: 201, r: 203, v: NaN }, { c: 204, r: 203, v: 5, bv: 1, ct: 1, bt: 0, p: 1, w: 0 });
  const frames = [
    cellsFrame("volume", LOGU),
    cellsFrame("volume", LINU),
    cellsFrame("volume", RANK),
    cellsFrame("delta", LOGS),
    cellsFrame("volume", LOGU, { basis: "intensity" }),
    cellsFrame("size", LOGU),
    cellsFrame("flow", DESCRIPTORS["fixed-diverging"]),
    cellsFrame("dwell", DESCRIPTORS["fixed-linear"]),
    cellsFrame("path", LOGU, { pathBasis: "perMinute" }),
    cellsFrame("volume", E.scale.zeroOnly(false)),
    E.readout.rowsFrame({ kind: "volume", rowSize: 3, mapping: { state: "ok", desc: LOGU }, lut: LUT }),
    E.readout.paneFrame({ key: "volume", axis: PANE_AXIS, lut: LUT }),
  ];
  const out = { tag: 0, value: 0, signed: false, short: false, reason: null, denominator: null, role: 0, idx: -1, clip: 0, t: 0, pattern: null, css: null };
  const run = (calls) => {
    for (let i = 0; i < calls; i++) frames[i % frames.length].encode(pool[i % pool.length], out);
  };
  run(60000); // warm up: the lazily created exposure object of each kernel, the optimiser
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  run(1000000);
  gc();
  gc();
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(grown < 1024 * 1024, `the heap grew by ${grown} bytes over 1e6 encode calls`);
  // The plans alone, through a reused scratch: the same.
  const plan = E.scale.plan(LOGU);
  const sc = { t: 0, clip: 0, state: null };
  for (let i = 0; i < 50000; i++) plan.apply(pool[i % pool.length].v, sc);
  gc();
  const before2 = process.memoryUsage().heapUsed;
  let x = 0;
  for (let i = 0; i < 1000000; i++) {
    plan.apply(pool[i % pool.length].v, sc);
    x += E.scale.index(sc.t);
  }
  gc();
  const grown2 = process.memoryUsage().heapUsed - before2;
  assert.ok(x > 0);
  assert.ok(grown2 < 1024 * 1024, `the heap grew by ${grown2} bytes over 1e6 plan.apply calls`);
});

test("U49: building a legend or a readout DOES allocate (the allocating paths are kept out of the steady frame)", (t) => {
  const gc = forceGc();
  if (gc === null) {
    t.skip("a forced GC is not available");
    return;
  }
  // The control of the experiment: the same heap counter sees an allocating path, so a pass above is not a blind meter.
  const frame = cellsFrame("volume", LOGU);
  gc();
  const before = process.memoryUsage().heapUsed;
  const keep = [];
  for (let i = 0; i < 2000; i++) keep.push(frame.readout({ c: 201, r: 203, v: 1000 + i, bv: 1, ct: 1, bt: 0 }));
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(keep.length === 2000);
  assert.ok(grown > 1024 * 1024, `2000 retained readouts grew the heap by only ${grown} bytes: the meter would miss an allocation`);
});
