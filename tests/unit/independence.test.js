"use strict";
// U09 independence.test.js (H3): the oracles stay independent of the code they judge.
//
// The rule (TESTPLAN 2.1 U09, DD-T02, DR-25): an expectation is never computed by the code under test or by the fake cube's store.
// Mechanically that means
//   1. no JavaScript file under tests/reference/ imports src/, tests/support/ or vendor/ (only node: built-ins and its own siblings);
//   2. no Python golden imports tools/ (only bridge_crosscheck.py, whose job is to compare with tools/cube_bridge.py, may);
//   3. tests/support/enc.js is the only test file that loads src/encoding.js or the encoding parts, plus the named files that
//      must see the module as a file (U02 the build, U47 the assembler, U10 the module's shape in a bare vm context);
//   4. the calculators are deterministic (no Math.random, no Date.now).
// Oracle of this file: a textual scan (comments removed) of the repository's test files, with the scanner itself shown to catch
// hand-written violations and to ignore hand-written look-alikes (the "scanner" describe block).
// Known exceptions are listed below WITH a reason, and a ratchet makes each one disappear from the list the day it stops being true.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

// ---- the scanner ----

// stripComments(js): the source without // and /* */ comments. String literals are kept and scanned as code, which errs on the side of
// flagging (a require(...) written inside a string is reported, never missed).
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      out += "\n".repeat((source.slice(i, end < 0 ? source.length : end).match(/\n/g) || []).length);
      i = end < 0 ? source.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// specifiersOf(js) -> {static: [spec], dynamic: n}: module specifiers of require("x"), import ... from "x", import("x"); `dynamic` counts
// require/import calls whose argument is not a string literal (which a text scan cannot resolve).
function specifiersOf(source) {
  const text = stripComments(source);
  const found = [];
  let dynamic = 0;
  for (const m of text.matchAll(/\brequire\s*\(\s*(["'`])([^"'`]*)\1\s*\)/g)) found.push(m[2]);
  for (const m of text.matchAll(/^\s*import\s+(?:[^"';]*?\s+from\s+)?(["'])([^"']+)\1/gm)) found.push(m[2]);
  for (const m of text.matchAll(/\bimport\s*\(\s*(["'`])([^"'`]*)\1\s*\)/g)) found.push(m[2]);
  for (const m of text.matchAll(/\b(?:require|import)\s*\(\s*(?!["'`])/g)) if (!/\bfunction\s+require\b/.test(text.slice(Math.max(0, m.index - 10), m.index))) dynamic++;
  return { static: found, dynamic };
}

// readsOf(js) -> the source text of every readFileSync( ... ) argument list, for modules read as text rather than required.
function readsOf(source) {
  const text = stripComments(source);
  const out = [];
  for (const m of text.matchAll(/\breadFileSync\s*\(([^;]*?)\)\s*[;,)]/g)) out.push(m[1]);
  return out;
}

// violationsInReference(file, source, exceptions) -> [message]: rule 1 and rule 4 for one calculator file.
function violationsInReference(file, source, exceptions = {}) {
  const out = [];
  const { static: specs, dynamic } = specifiersOf(source);
  if (dynamic) out.push(`${file}: ${dynamic} require/import call(s) with a computed argument cannot be checked`);
  for (const spec of specs) {
    if (spec.startsWith("node:")) continue;
    if (!spec.startsWith(".")) {
      out.push(`${file}: imports ${JSON.stringify(spec)}: a reference file may use only node: built-ins and its own siblings`);
      continue;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if (!target.startsWith("tests/reference/") && !(exceptions[file] ?? []).includes(spec)) out.push(`${file}: imports ${spec} (${target}) outside tests/reference/`);
  }
  if (/\bMath\.random\s*\(|\bDate\.now\s*\(/.test(stripComments(source))) out.push(`${file}: uses Math.random or Date.now (a reference is deterministic)`);
  return out;
}

// pythonViolations(file, source) -> [message]: rule 2 for one golden script.
const TOOL_MODULES = () => fs.readdirSync(path.join(ROOT, "tools")).filter((f) => f.endsWith(".py")).map((f) => f.slice(0, -3));
function pythonViolations(file, source, toolModules = TOOL_MODULES()) {
  const out = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/#.*$/, "");
    const at = `${file}:${i + 1}`;
    const im = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))/.exec(code);
    if (im) {
      const mods = im[1] ? [im[1]] : im[2].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]);
      for (const mod of mods) {
        const root = mod.split(".")[0];
        if (root === "tools" || toolModules.includes(root)) out.push(`${at}: imports ${mod} from tools/`);
      }
    }
    if (/sys\.path\.(?:insert|append)\s*\(/.test(code) && /tools|src|support/.test(code)) out.push(`${at}: extends sys.path with the repository's code`);
  });
  return out;
}

// moduleAccess(file, source) -> [how]: rule 3: the ways one test file reaches src/encoding.js or the parts.
function moduleAccess(file, source) {
  const out = [];
  const { static: specs } = specifiersOf(source);
  for (const spec of specs) {
    if (/(^|\/)src\/encoding(\.js)?$/.test(spec) || /(^|\/)assemble-encoding(\.js)?$/.test(spec) || /encoding-parts/.test(spec)) out.push(`requires ${spec}`);
  }
  for (const arg of readsOf(source)) if (/encoding\.js|encoding-parts/.test(arg)) out.push(`reads ${arg.replace(/\s+/g, " ").trim().slice(0, 60)}`);
  return out;
}

// ---- the files ----

function walk(dir, keep) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "fixtures"].includes(entry.name)) continue;
      out.push(...walk(full, keep));
    } else if (keep(entry.name)) out.push(full);
  }
  return out.sort();
}
const isJs = (name) => /\.(?:js|mjs|cjs)$/.test(name);
const referenceJs = walk(path.join(ROOT, "tests", "reference"), isJs);
const referencePy = walk(path.join(ROOT, "tests", "reference"), (n) => n.endsWith(".py"));
const testJs = walk(path.join(ROOT, "tests"), isJs);

// Reference files that legitimately import something outside tests/reference/, and exactly what.
const REFERENCE_EXCEPTIONS = {
  // Records the baseline's outputs from `git show`; it needs the seeded generator only to build its INPUT series (never an expectation).
  "tests/reference/record_baseline.mjs": ["../support/rng.js"],
};

// Test files that may load src/encoding.js or the parts, and why.
const MODULE_ALLOWED = {
  "tests/support/enc.js": "the loader every unit test goes through (DD-T23)",
  "tests/support/assemble-encoding.js": "the assembler and in-memory loader itself",
  "tests/unit/build.test.js": "U02: the module inlined in the built page against the file",
  "tests/unit/assemble.test.js": "U47: the assembler's own tests",
  "tests/unit/seams.test.js": "U10: the module's shape, including a load in a bare vm context that enc.js cannot give",
};
// Test files that reach the module another way at the time of writing, owned by other packages. Each is an amendment request in the
// H3 report (go through tests/support/enc.js, or be named above); the ratchet below removes a line the day it stops being true.
const MODULE_KNOWN_EXCEPTIONS = {
  "tests/unit/result.test.js": "builds a variant module from a temporary copy of the parts (a stub part 04-text) through assemble-encoding.js (W1-A)",
  "tests/unit/provenance.test.js": "builds a module with a stub text part through assemble-encoding.js (W1-A)",
  "tests/unit/text.test.js": "reads src/encoding.js as text to scan the string table (W1-F)",
  "tests/browser/boot.spec.js": "compares the page's inline script byte for byte with the source file on disk (B01)",
};

describe("rule 1: the JavaScript reference files import nothing of the repository", () => {
  it("there are reference files to check, including the calculator of this package", () => {
    const names = referenceJs.map(rel);
    for (const need of ["tests/reference/rational.js", "tests/reference/cells.js", "tests/reference/motion.js", "tests/reference/bars.js", "tests/reference/typeseven.js", "tests/reference/snapshot.js", "tests/reference/index.js"]) {
      assert.ok(names.includes(need), need);
    }
  });

  it("only node: built-ins and siblings inside tests/reference/ (named exceptions aside); deterministic", () => {
    const violations = referenceJs.flatMap((file) => violationsInReference(rel(file), fs.readFileSync(file, "utf8"), REFERENCE_EXCEPTIONS));
    assert.deepEqual(violations, []);
  });

  it("every named exception is still needed (the ratchet: a line that stops being true must go)", () => {
    for (const [file, specs] of Object.entries(REFERENCE_EXCEPTIONS)) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      const actual = violationsInReference(file, source, {});
      for (const spec of specs) assert.ok(actual.some((m) => m.includes(spec)), `${file} no longer imports ${spec}: remove the exception`);
    }
  });
});

describe("rule 2: no Python golden imports tools/ except bridge_crosscheck.py", () => {
  it("the goldens exist", () => {
    const names = referencePy.map(rel);
    for (const need of ["tests/reference/golden.py", "tests/reference/wire_golden.py", "tests/reference/bridge_crosscheck.py"]) assert.ok(names.includes(need), need);
  });

  it("golden.py, wire_golden.py and every other script are free of tools/ imports and sys.path tricks", () => {
    const violations = referencePy
      .filter((f) => path.basename(f) !== "bridge_crosscheck.py")
      .flatMap((file) => pythonViolations(rel(file), fs.readFileSync(file, "utf8")));
    assert.deepEqual(violations, []);
  });

  it("bridge_crosscheck.py is the exception and really is one (otherwise the exception is dead text)", () => {
    const file = referencePy.find((f) => path.basename(f) === "bridge_crosscheck.py");
    assert.ok(pythonViolations(rel(file), fs.readFileSync(file, "utf8")).length > 0);
  });
});

describe("rule 3: tests/support/enc.js is the door to src/encoding.js", () => {
  const access = Object.fromEntries(testJs.map((f) => [rel(f), moduleAccess(rel(f), fs.readFileSync(f, "utf8"))]).filter(([, how]) => how.length));

  it("only the named files reach the module or the parts directly", () => {
    const stray = Object.keys(access).filter((f) => !(f in MODULE_ALLOWED) && !(f in MODULE_KNOWN_EXCEPTIONS) && f !== "tests/unit/independence.test.js");
    assert.deepEqual(stray.map((f) => `${f}: ${access[f].join("; ")}`), []);
  });

  it("the known exceptions still hold, each with its reason (remove a line when the file stops reaching the module)", () => {
    for (const [file, why] of Object.entries(MODULE_KNOWN_EXCEPTIONS)) {
      assert.ok(file in access, `${file} no longer reaches the module directly (${why}): remove it from MODULE_KNOWN_EXCEPTIONS`);
    }
  });

  it("the allowed files exist, and the loader really is one of them (the allowance is not dead text)", () => {
    for (const file of Object.keys(MODULE_ALLOWED)) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
    assert.ok(access["tests/support/enc.js"]?.length >= 1, "enc.js loads the parts through assemble-encoding.js");
  });

  it("the reference calculator and its tests do not use the module or the fake", () => {
    for (const file of ["tests/unit/reference.test.js", "tests/unit/snapshot.test.js"]) {
      const specs = specifiersOf(fs.readFileSync(path.join(ROOT, file), "utf8")).static;
      for (const spec of specs) assert.ok(spec.startsWith("node:") || /^\.\.\/reference\//.test(spec), `${file} imports ${spec}`);
    }
  });
});

describe("the scanner catches what it should and ignores look-alikes", () => {
  it("JavaScript: a require of src/, tests/support/ or vendor/ is a violation; built-ins and siblings and comments are not", () => {
    const bad = `const a = require("../../src/encoding.js");\nconst b = require('../support/rng.js');\nconst d3 = require("../../vendor/d3.min.js");\nimport x from "../unit/y.js";\nconst c = await import("../support/cube-fake.js");`;
    assert.equal(violationsInReference("tests/reference/x.js", bad).length, 5);
    const good = `// require("../../src/encoding.js") in a comment\n/* import x from "../support/x.js" */\nconst fs = require("node:fs");\nconst r = require("./rational.js");\nconst s = 4;`;
    assert.deepEqual(violationsInReference("tests/reference/x.js", good), []);
  });

  it("JavaScript: a bare package, a computed require and Math.random are violations", () => {
    assert.equal(violationsInReference("tests/reference/x.js", `const d = require("left-pad");`).length, 1);
    assert.equal(violationsInReference("tests/reference/x.js", `const n = "../x"; require(n);`).length, 1);
    assert.equal(violationsInReference("tests/reference/x.js", `const r = Math.random();`).length, 1);
    assert.deepEqual(violationsInReference("tests/reference/x.js", `// Math.random() is forbidden\nconst r = 4;`), []);
  });

  it("JavaScript: an exception names exactly the specifier it allows", () => {
    const source = `const { mulberry32 } = require("../support/rng.js");`;
    assert.deepEqual(violationsInReference("tests/reference/r.mjs", source, { "tests/reference/r.mjs": ["../support/rng.js"] }), []);
    assert.equal(violationsInReference("tests/reference/r.mjs", source, { "tests/reference/r.mjs": ["../support/other.js"] }).length, 1);
    assert.equal(violationsInReference("tests/reference/r.mjs", source, {}).length, 1);
  });

  it("Python: imports of tools/ modules and sys.path extensions are violations; the standard library and comments are not", () => {
    const tools = ["cube_bridge", "market_state_reader", "build"];
    assert.equal(pythonViolations("g.py", "import cube_bridge\nfrom market_state_reader import x\nfrom tools import build\nimport json, build as b", tools).length, 4);
    assert.equal(pythonViolations("g.py", 'import sys\nsys.path.insert(0, str(ROOT / "tools"))', tools).length, 1);
    assert.deepEqual(pythonViolations("g.py", "# import cube_bridge\nimport json\nfrom fractions import Fraction\nfrom decimal import Decimal, getcontext", tools), []);
  });

  it("module access: requires of src/encoding.js and the assembler, and reads of the module as text, are found; unrelated reads are not", () => {
    assert.equal(moduleAccess("t.js", `const E = require("../../src/encoding.js");`).length, 1);
    assert.equal(moduleAccess("t.js", `const { loadParts } = require("../support/assemble-encoding.js");`).length, 1);
    assert.equal(moduleAccess("t.js", `const s = fs.readFileSync(path.resolve(__dirname, "../../src/encoding.js"), "utf8");`).length, 1);
    assert.deepEqual(moduleAccess("t.js", `const E = require("../support/enc");\nconst j = fs.readFileSync("x.json");\n// require("../../src/encoding.js")`), []);
  });
});
