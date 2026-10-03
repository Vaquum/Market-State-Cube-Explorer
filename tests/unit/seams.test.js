"use strict";
// U10 (TESTPLAN.md 2.2): the seams of src/encoding.js: what the module exports and how it loads, before
// any part's own tests look inside it.
//
// Oracle: the list of exports below, transcribed by hand from API.md A.1 and A.3 (a name, and how many
// arguments it takes: the fewest it needs and the most it documents), the 30 keys of A.1, and the values
// A.3 states for the constants. Nothing is derived from the module under test. `Function.length` counts
// parameters up to the first default, so each function is checked against a [fewest, most] range, not one
// number: `baseToMs(base, T0 = ..., BASE = ...)` is [1, 3].
//
// When it runs. The module does not exist until gate A0 assembles src/encoding.js, so until then the
// checks are TODO with the reason, and they turn on by themselves the moment src/encoding.js is there.
// With ENCODING_PARTS_DIR set they run against the module assembled in memory, but only once all 25
// parts are present and ENCODING_ONLY is not set (a partial module would list everything missing, which
// tells its authors nothing). The checker itself is proved now against hand-made modules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { assemble, strip } = require("../support/assemble-encoding.js");

const ROOT = path.resolve(__dirname, "../..");
const FILE = path.join(ROOT, "src/encoding.js");

// A.1: the 30 keys of the frozen export.
const KEYS = ["VERSION", "LIMITS", "TIMING", "THRESHOLDS", "LATTICE", "text", "result", "time", "util", "hash", "measure", "ratio", "relvol",
  "scale", "cohort", "lut", "role", "context", "store", "policy", "lifecycle", "axis", "warn", "model", "readout", "legend", "notice", "codec", "indicators", "candles"];

// A.3: F(fewest, most) is a function; the strings name what a non-function member is; V(x) is a literal.
const F = (min, max = min) => ({ min, max });
const V = (value) => ({ value });
const SPEC = {
  candles: { LIMITS: "object", record: F(3), project: F(4, 5), paint: F(6, 7), span: F(4, 5), Cache: F(0) },
  text: { fill: F(1, 2), fillStrict: F(1, 2) },
  result: { TAGS: "array", TAG: "object", make: F(1, 2), finite: F(1), isValue: F(1), precedence: F(1), assertJsonSafe: F(1), describe: F(1, 2) },
  time: { baseToMs: F(1, 3), msToBase: F(1, 3), utcDay: F(1) },
  util: { clamp: F(3), quantile7: F(2), median7: F(1), lowerBound: F(2), upperBound: F(2) },
  hash: { sha256: F(1), canonical: F(1), id96: F(1), b64urlEncode: F(1), b64urlDecode: F(1), hex: F(1, 2), utf8: F(1), fromUtf8: F(1), f64ToB64: F(1), b64ToF64: F(2) },
  measure: {
    FORMULAS: "object", MODES: "object", ROWS: "object", close: "object", exposure: F(7, 8), usesOf: F(2), isShort: F(2), cellValue: F(2),
    cellMeasurement: F(1), columnValue: F(3, 4), dwellCheck: F(2), dwellResidual: F(2), cellState: F(7),
  },
  ratio: { cascade: F(1), efficiency: F(1), coordinate: F(3), TICKS: "array", ratioTicks: F(1), classify: F(1) },
  relvol: { compute: F(1) },
  scale: {
    fitValue: F(1, 2), fitRank: F(1), fixed: F(1, 2), manual: F(1), zeroOnly: F(1), canonical: F(1), id: F(1), validate: F(1, 2), plan: F(1),
    apply: F(3), CLIP: "object", index: F(1), sameWithin: F(2), compat: F(2),
  },
  cohort: { cells: F(1), motionCells: F(1), rows: F(1), columns: F(1) },
  lut: {
    APPEARANCES: "object", DEFAULT_APPEARANCE: V("slate2"), build: F(2), appearanceId: F(1), ROWS_ALPHA: V(0.16), composite: F(3), themeOf: F(1),
    screens: F(2), deltaE2000: F(2), rgbToLab: F(3), labToRgb: F(3), contrast: F(2), over: F(3), parseColor: F(1),
  },
  role: { ROLES: "object", GLYPHS: "object", paint: F(6, 7), tile: F(2), glyphFor: F(1), keyEntries: F(2), occlusion: F(2, 3), unionSpans: F(1), REFERENCE: "object", referenceFamily: F(1), REASONS: "array", inventory: F(1), SIGN: "object", signShape: F(1), signCoverage: F(1), signInk: F(3) },
  context: { cellsKey: F(1), rowsKey: F(1), keyString: F(1), equal: F(2), periodIdentity: F(3), diff: F(2), compatClass: F(1) },
  store: { create: F(0, 1) },
  policy: { DEFAULTS: "object", effective: F(2, 3), sanitize: F(1), reduce: F(3), resolve: F(1), offers: F(4, 5), persisted: F(1), restore: F(1) },
  lifecycle: { coherent: F(1), memoKey: F(1), controller: F(0, 1), settled: F(1) },
  axis: { CATALOGUE: "object", domain: F(2), registry: F(0, 1), coordinate: F(2, 3), ticks: F(2), profile: F(1) },
  warn: { tally: F(0), evaluate: F(1, 2), bandOf: F(1) },
  model: { PROVENANCE: "object", status: F(1), fit: F(2), describe: F(3) },
  readout: { ROLE: "object", cellsFrame: F(1), rowsFrame: F(1), paneFrame: F(1), events: "object" },
  legend: { build: F(4), chip: F(1), details: F(1), marker: F(2), barPixels: F(2), keyOf: F(1) },
  notice: { create: F(1) },
  codec: {
    VISUAL_KEYS: "array", formatAddress: F(2, 3), parseAddress: F(2), checkView: F(2), classify: F(1), encodePortable: F(1, 2), decodePortable: F(1, 2),
    validatePortable: F(2), migrateLegacy: F(1), digest: F(1), descriptorCount: F(1),
  },
  // The baseline signatures of explorer.js 6189-6337, moved without change (smaOf(values, n), emaOf(values, n, from = 0), ...).
  indicators: {
    smaOf: F(2), emaOf: F(2, 3), rsiOf: F(1, 2), bollingerOf: F(1, 3), macdOf: F(1), crossesOf: F(2), squeezeBelow: F(1, 3), squeezeLowest: F(1, 2), divergencesOf: F(2),
  },
};
// The constants of A.3 with the values it states. LIMITS.NAMED_VIEWS_MAX is left out: DR-31 voids the cap.
const CONSTANTS = {
  VERSION: { schema: 1, visual: 2, mapping: 1, appearance: 2, readout: 1, legend: 1, codec: 1 },
  LIMITS: { ADDRESS_MAX: 8192, RANK_KNOTS: 257, PAYLOAD_MAX_BYTES: 1048576, DESCRIPTORS_MAX: 16, CONTEXTS_MAX: 64, RECORDS_PER_CONTEXT: 8, HISTORY_MAX: 50,
    STRING_MAX: 256, DEPTH_MAX: 8, TOMBSTONES_MAX: 64, HELD_MAX: 8, AXES_MAX: 21, MODELS_MAX: 4 },
  TIMING: { SETTLE_MS: 200, AUTO_MS: 500, RETRY_MS: 200, PERSIST_DEBOUNCE_MS: 400, NOTICE_COALESCE_MS: 5000 },
  THRESHOLDS: { SHORT_EXPOSURE: 0.1, WARN_MARKS: 0.1, WARN_AREA: 0.25, LOW_DISC: 0.9, LUT_LOW_MAX: 12, LUT_HIGH_MIN: 243, TOL_REL: 1e-12, TOL_USDT: 1e-12, TOL_SECONDS: 1e-9, TOL_PATH: 1e-9 },
  LATTICE: { BASE: 56.25, PR: 125, T0: 1609459200 },
};
const READOUT_ROLE = { NONE: 0, UNSIGNED: 1, POSITIVE: 2, NEGATIVE: 3, MIDPOINT: 4, PATTERN: 5, OCCUPANCY: 6, ZERO: 7, ROWS: 8 };

// One message listing everything wrong, so a missing module is one failure, not forty stack traces.
function checkExports(E) {
  const problems = [];
  const keys = Object.keys(E).sort();
  const want = [...KEYS].sort();
  for (const k of want) if (!keys.includes(k)) problems.push(`E.${k} is missing`);
  for (const k of keys) if (!want.includes(k)) problems.push(`E.${k} is not one of the 30 keys of API.md A.1`);
  if (!Object.isFrozen(E)) problems.push("the export object is not frozen");
  for (const [ns, members] of Object.entries(SPEC)) {
    const space = E[ns];
    if (space === undefined || space === null || typeof space !== "object") { if (!problems.includes(`E.${ns} is missing`)) problems.push(`E.${ns} is not an object`); continue; }
    if (!Object.isFrozen(space)) problems.push(`E.${ns} is not frozen`);
    for (const [name, kind] of Object.entries(members)) {
      const at = `E.${ns}.${name}`;
      const value = space[name];
      if (value === undefined) { problems.push(`${at} is missing`); continue; }
      if (kind.min !== undefined) {
        if (typeof value !== "function") problems.push(`${at} is not a function`);
        else if (value.length < kind.min || value.length > kind.max) problems.push(`${at} takes ${value.length} arguments; the documented range is ${kind.min === kind.max ? kind.min : `${kind.min} to ${kind.max}`}`);
      } else if (kind.value !== undefined) {
        if (value !== kind.value) problems.push(`${at} is ${JSON.stringify(value)}; API.md says ${JSON.stringify(kind.value)}`);
      } else if (kind === "array") {
        if (!Array.isArray(value)) problems.push(`${at} is not an array`);
      } else if (typeof value !== "object" || value === null || Array.isArray(value)) problems.push(`${at} is not an object`);
    }
  }
  for (const [name, expected] of Object.entries(CONSTANTS)) {
    const got = E[name];
    if (!got) continue;
    for (const [k, v] of Object.entries(expected)) if (got[k] !== v) problems.push(`E.${name}.${k} is ${JSON.stringify(got[k])}; API.md A.3 says ${JSON.stringify(v)}`);
  }
  if (E.readout && E.readout.ROLE) for (const [k, v] of Object.entries(READOUT_ROLE)) if (E.readout.ROLE[k] !== v) problems.push(`E.readout.ROLE.${k} is ${JSON.stringify(E.readout.ROLE[k])}; API.md says ${v}`);
  if (E.result && Array.isArray(E.result.TAGS) && E.result.TAGS.length !== 14) problems.push(`E.result.TAGS has ${E.result.TAGS.length} tags; API.md B.1 has 14`);
  return problems;
}

// A module that has exactly what SPEC lists, with functions of the smallest documented arity.
function handMade({ omit = null, frozen = true } = {}) {
  const E = {};
  for (const [name, expected] of Object.entries(CONSTANTS)) E[name] = Object.freeze({ ...expected });
  for (const [ns, members] of Object.entries(SPEC)) {
    const space = {};
    for (const [name, kind] of Object.entries(members)) {
      if (kind.min !== undefined) { const f = () => {}; Object.defineProperty(f, "length", { value: kind.min }); space[name] = f; }
      else if (kind.value !== undefined) space[name] = kind.value;
      else space[name] = kind === "array" ? [] : {};
    }
    E[ns] = frozen ? Object.freeze(space) : space;
  }
  E.result = Object.freeze({ ...E.result, TAGS: Array.from({ length: 14 }, (_, i) => `t${i}`) });
  E.readout = Object.freeze({ ...E.readout, ROLE: Object.freeze({ ...READOUT_ROLE }) });
  if (omit) { const [ns, name] = omit.split("."); const copy = { ...E[ns] }; delete copy[name]; E[ns] = Object.freeze(copy); }
  return frozen ? Object.freeze(E) : E;
}

test("the checker: a module with every documented export passes, and each kind of gap is named", () => {
  assert.deepEqual(checkExports(handMade()), []);
  assert.deepEqual(checkExports(handMade({ omit: "scale.plan" })), ["E.scale.plan is missing"]);
  assert.deepEqual(checkExports(handMade({ frozen: false })).slice(0, 2), ["the export object is not frozen", "E.candles is not frozen"]);
  const wrongArity = handMade();
  const zero = () => {};
  const bad = Object.freeze({ ...wrongArity, util: Object.freeze({ ...wrongArity.util, clamp: zero }) });
  assert.deepEqual(checkExports(bad), ["E.util.clamp takes 0 arguments; the documented range is 3"]);
  const extra = Object.freeze({ ...wrongArity, axisOf: {} });
  assert.deepEqual(checkExports(extra), ["E.axisOf is not one of the 30 keys of API.md A.1"]);
  const { indicators, ...without } = wrongArity;
  assert.match(checkExports(Object.freeze(without)).join("\n"), /E\.indicators is missing/);
  const notFn = Object.freeze({ ...wrongArity, hash: Object.freeze({ ...wrongArity.hash, sha256: 3 }) });
  assert.deepEqual(checkExports(notFn), ["E.hash.sha256 is not a function"]);
  const wrongConstant = Object.freeze({ ...wrongArity, TIMING: Object.freeze({ ...CONSTANTS.TIMING, AUTO_MS: 501 }) });
  assert.deepEqual(checkExports(wrongConstant), ["E.TIMING.AUTO_MS is 501; API.md A.3 says 500"]);
  assert.equal(Object.keys(SPEC).length + 5, 30, "the 25 namespaces of SPEC and the 5 constants are the 30 keys");
  assert.deepEqual([...Object.keys(SPEC), ...Object.keys(CONSTANTS)].sort(), [...KEYS].sort());
});

// ---------------------------------------------------------------------------------------------------
// Which module do the real checks look at, if any?
function target() {
  const dir = process.env.ENCODING_PARTS_DIR;
  if (dir) {
    if (process.env.ENCODING_ONLY) return { why: "ENCODING_ONLY loads only part of the module" };
    const have = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => f.slice(0, 2)) : []);
    const missing = ["00", ...Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, "0")), "99"].filter((n) => !have.has(n));
    if (missing.length) return { why: `parts ${missing.join(" ")} are not in ${dir} yet` };
    return { kind: "parts", source: () => assemble({ dir: path.resolve(dir) }).source };
  }
  if (!fs.existsSync(FILE)) return { why: "src/encoding.js is not assembled yet (gate A0)" };
  return { kind: "file", source: () => fs.readFileSync(FILE, "utf8") };
}
const TARGET = target();
const real = (name, fn) => test(name, { todo: TARGET.kind ? false : TARGET.why }, (t) => (TARGET.kind ? fn(t) : undefined));
const enc = () => require("../support/enc.js");

// The module source run the two ways the app runs it, each in a fresh context.
function loadCommonJs(source) {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(source, context, { filename: "encoding.js" });
  return { context, exports: context.module.exports };
}
function loadPage(source, extra = {}) {
  const context = vm.createContext({ ...extra });
  vm.runInContext(source, context, { filename: "encoding.js" });
  return { context, exports: context.explorerEncoding };
}
// What two loads must share: the shape, the constants' values and every function's text.
function signature(E) {
  return JSON.stringify(Object.entries(E).map(([k, v]) => [k, typeof v === "object" && v !== null
    ? Object.entries(v).map(([n, m]) => [n, typeof m === "function" ? String(m) : JSON.stringify(m)]) : String(v)]));
}

real("every export of API.md A.3 exists with the documented arity, the export is exactly the 30 keys and frozen", () => {
  assert.deepEqual(checkExports(enc()), []);
});

real("it loads with require in a bare vm context: no window, no document, no d3", () => {
  const { context, exports } = loadCommonJs(TARGET.source());
  assert.deepEqual(Object.keys(context), ["module"], "loading defined nothing on the context but the module the test gave it");
  assert.deepEqual(Object.keys(exports).sort(), [...KEYS].sort());
  assert.deepEqual(checkExports(exports), []);
});

real("it loads page-style, with or without window.d3, and defines only window.explorerEncoding", () => {
  const bare = loadPage(TARGET.source());
  assert.deepEqual(Object.keys(bare.context), ["explorerEncoding"]);
  const withD3 = { d3: { max: () => 0 } };
  const page = loadPage(TARGET.source(), { window: withD3 });
  assert.deepEqual(Object.keys(page.context).sort(), ["explorerEncoding", "window"]);
  assert.deepEqual(Object.keys(page.exports).sort(), [...KEYS].sort());
  assert.equal(signature(page.exports), signature(bare.exports));
});

real("loading has no side effects: two fresh loads give equal exports and touch nothing else", () => {
  const source = TARGET.source();
  const a = loadPage(source);
  const b = loadPage(source);
  assert.notEqual(a.exports, b.exports, "each load builds its own module");
  assert.equal(signature(a.exports), signature(b.exports));
  assert.equal(signature(loadCommonJs(source).exports), signature(a.exports));
  assert.deepEqual(Object.keys(a.context), ["explorerEncoding"]);
});

real("the module text never reads storage, the clock or a random source, and cannot break out of an inline script", () => {
  const source = TARGET.source();
  const code = strip(source, false);
  for (const [name, re] of [["localStorage", /\blocalStorage\b/], ["Date.now", /\bDate\.now\b/], ["Math.random", /\bMath\.random\b/]])
    assert.ok(!re.test(code), `${name} appears in the module's code`);
  assert.ok(!/<\/script/i.test(source), "the module text holds </script");
  assert.ok(!/<!--/.test(source), "the module text holds <!--");
  assert.ok(!/__EXPLORER_/.test(source), "the module text holds a build marker");
});

// ---------------------------------------------------------------------------------------------------
// Drift that the arity check above cannot see (package WX, the Wave-1 exit scan): a member the module exports
// that API.md A.3 does not list (a helper that leaked into the frozen surface), and an exported function whose
// definition carries no comment of its own (every public function documents what it promises, in the code
// where the next reader is looking, at the density of its neighbours).

// extraMembers(E) -> [message]: a namespace member that is not in SPEC. E.text is a table of strings plus fill
// and fillStrict, so it is checked by its functions only.
function extraMembers(E) {
  const problems = [];
  for (const [ns, members] of Object.entries(SPEC)) {
    const space = E[ns];
    if (space === undefined || space === null || typeof space !== "object") continue;
    const listed = new Set(Object.keys(members));
    for (const name of Object.keys(space)) {
      if (ns === "text" && typeof space[name] !== "function") continue;
      if (!listed.has(name)) problems.push(`E.${ns}.${name} is exported but API.md A.3 does not list it`);
    }
  }
  return problems;
}

// undocumented(source, E) -> [message]: for each `API.<ns> = Object.freeze({ ... })` block of the module text, every
// member that is a function (by its runtime type) must have its named definition preceded directly by a comment
// line. A member written `name: (args) => helper(...)` is documented by `helper`'s comment.
function undocumented(source, E) {
  const lines = source.split("\n");
  const problems = [];
  const open = /^ {2}API\.(\w+) = Object\.freeze\(\{\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = open.exec(lines[i]);
    if (!m) continue;
    const ns = m[1];
    for (let j = i + 1; j < lines.length && !/^ {2}\}\);/.test(lines[j]); j++) {
      const member = /^ {4}(?:(\w+): )?(?:\([^)]*\) => )?(\w+)(?:\(.*)?,?$/.exec(lines[j].replace(/,\s*$/, ""));
      if (!member) continue;
      const name = member[1] || member[2];
      const ident = member[2];
      if (!E[ns] || typeof E[ns][name] !== "function") continue;
      const def = new RegExp(`^\\s*(?:async )?function ${ident}\\(`);
      const at = lines.findIndex((l) => def.test(l));
      if (at < 0) problems.push(`E.${ns}.${name}: the definition of ${ident} was not found`);
      else if (!/^\s*(\/\/|\*\/)/.test(lines[at - 1])) problems.push(`E.${ns}.${name}: ${ident} (line ${at + 1}) has no comment directly above it`);
    }
  }
  return problems;
}

test("the drift checkers: a leaked helper and a bare function are named, a documented module passes", () => {
  const good = handMade();
  assert.deepEqual(extraMembers(good), []);
  const leaked = Object.freeze({ ...good, util: Object.freeze({ ...good.util, helper: () => {} }) });
  assert.deepEqual(extraMembers(leaked), ["E.util.helper is exported but API.md A.3 does not list it"]);
  const src = ["  // documents f", "  function f() {}", "", "  function g() {}", "  API.demo = Object.freeze({", "    f,", "    g,", "    h: (x) => f(x),", "    K: 3,", "  });"].join("\n");
  const E = { demo: { f() {}, g() {}, h() {}, K: 3 } };
  assert.deepEqual(undocumented(src, E), ["E.demo.g: g (line 4) has no comment directly above it"]);
  assert.deepEqual(undocumented(src.replace("  function g", "  // documents g\n  function g"), E), []);
});

real("no namespace exports a member that API.md A.3 does not list", () => {
  assert.deepEqual(extraMembers(enc()), []);
});

real("every exported function of the module has a comment directly above its definition", () => {
  assert.deepEqual(undocumented(TARGET.source(), enc()), []);
});
