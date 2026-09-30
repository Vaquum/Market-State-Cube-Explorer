"use strict";
// U47 (TESTPLAN.md 2.6, DD-T27): the assembler of src/encoding.js, tests/support/assemble-encoding.js.
//
// Oracle: hand-written fixtures. Every part below is a few lines written for the case it proves, so what
// the assembler must say is known before it runs: a clean set of parts passes, and for each rule of
// WORKPLAN.md 2.2 there is a fixture that breaks exactly that rule (and only it) and a fixture that
// stays just inside it (a comma inside brackets, a key called `window`, a comment that names Date.now).
// Nothing here computes an expectation with the assembler; the assembled toy module is judged by what
// its own two functions return.
//
// Rule 7 of 2.2 (a one-line comment that names its API.md section on every public function) is a
// review rule: the assembler cannot tell a useful comment from a useless one, so no lint claims it.
//
// The test files of parts (tests/unit/*.test.js) do not depend on this one; this one does not need
// tools/encoding-parts: it builds its own fixtures in a temporary directory, so it keeps running after
// gate A0 has deleted the parts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { assemble, loadParts, readParts, lint, strip } = require("../support/assemble-encoding.js");

const ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(ROOT, "tests/support/assemble-encoding.js");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "u47-"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function dirOf(files) {
  const dir = path.join(scratch, `d${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

// A part as its author writes it: the four directives, then a body at two spaces.
function part(id, { requires = "", prefix, provides = "", allow = [], body }) {
  return [
    `  // @part ${id}`,
    `  // @requires ${requires}`.trimEnd(),
    `  // @prefix ${prefix}`,
    `  // @provides ${provides}`.trimEnd(),
    ...allow.map((a) => `  // @allow ${a}`),
    body,
    "",
  ].join("\n");
}
const HEADER = [
  "  // @part 00-header",
  "  // @requires",
  "  // @prefix hdr",
  "  // @provides VERSION LIMITS TIMING THRESHOLDS LATTICE",
  "  const API = {};",
  "  const VERSION = Object.freeze({ schema: 1 });",
  "  const LIMITS = Object.freeze({ MAX: 8 });",
  "  const TIMING = Object.freeze({ SETTLE_MS: 200 });",
  "  const THRESHOLDS = Object.freeze({ TOL: 1e-12 });",
  "  const LATTICE = Object.freeze({ BASE: 56.25 });",
  "  API.VERSION = VERSION;",
  "  API.LIMITS = LIMITS;",
  "  API.TIMING = TIMING;",
  "  API.THRESHOLDS = THRESHOLDS;",
  "  API.LATTICE = LATTICE;",
  "",
].join("\n");
const FOOTER = ["  // @part 99-footer", "  // @requires", "  // @prefix ftr", "  // @provides", "  return Object.freeze(API);", ""].join("\n");
const UTIL = part("01-util", {
  prefix: "util",
  provides: "util",
  body: [
    "  // Clamp x into lo..hi (a toy of API.md A.3 E.util.clamp).",
    "  function utilClamp(x, lo, hi) {",
    "    return Math.min(hi, Math.max(lo, x));",
    "  }",
    "  API.util = Object.freeze({ clamp: utilClamp });",
  ].join("\n"),
});
const HASH = part("02-hash", {
  requires: "01-util",
  prefix: "hash",
  provides: "hash",
  body: [
    "  // Captured at load time: 01-util is in @requires, so it loaded earlier.",
    "  const hashClamp = API.util.clamp;",
    "  // A toy digest that reads the header constant and clamps through the captured function.",
    "  function hashToy(x) {",
    "    return hashClamp(x, 0, LIMITS.MAX) + API.util.clamp(-1, 0, 1);",
    "  }",
    "  API.hash = Object.freeze({ toy: hashToy });",
  ].join("\n"),
});
const BASE = { "00-header.js": HEADER, "01-util.js": UTIL, "02-hash.js": HASH, "99-footer.js": FOOTER };
const problemsOf = (files) => assemble({ dir: dirOf({ ...BASE, ...files }) }).problems;
const has = (problems, re) => problems.some((p) => re.test(p));

// ---------------------------------------------------------------------------------------------------
test("a clean set of parts has no problems and assembles to a working module", () => {
  const dir = dirOf(BASE);
  const { problems, parts } = assemble({ dir });
  assert.deepEqual(problems, []);
  assert.deepEqual(parts, ["00-header", "01-util", "02-hash", "99-footer"]);
  const E = loadParts({ dir });
  assert.equal(E.hash.toy(50), 8 + 0, "50 clamps to LIMITS.MAX = 8, and the second term clamps -1 to 0");
  assert.equal(E.util.clamp(-3, 0, 5), 0);
  assert.ok(Object.isFrozen(E) && Object.isFrozen(E.util));
  assert.deepEqual(Object.keys(E).sort(), ["LATTICE", "LIMITS", "THRESHOLDS", "TIMING", "VERSION", "hash", "util"]);
});

test("the real header and footer, when the parts directory still exists, lint clean", (t) => {
  const dir = path.join(ROOT, "tools/encoding-parts");
  if (!fs.existsSync(dir)) return t.skip("tools/encoding-parts is deleted by the A0 commit");
  assert.deepEqual(lint(readParts(dir)), []);
});

test("files that are not NN-name.js are ignored (design residue, notes, one-digit numbers, capitals)", () => {
  const junk = { "p0.md": "text", "5-x.js": "not a part", "05-Upper.js": "not a part", "README.md": "", "notes.txt": "" };
  assert.deepEqual(problemsOf(junk), []);
});

// ---------------------------------------------------------------------------------------------------
// Output shape: banner, UMD wrapper, header, parts in number order, footer, closing; deterministic.
test("the assembly is banner + wrapper + header + parts in number order + footer + closing, LF, one trailing newline", () => {
  const dir = dirOf({ ...BASE, "05-a.js": part("05-a", { prefix: "aaa", provides: "ratio", body: "  API.ratio = Object.freeze({});" }) });
  const { source } = assemble({ dir });
  assert.ok(source.startsWith("/* "), "the banner comes first");
  assert.ok(!source.includes("\r"), "LF only");
  assert.ok(source.endsWith("});\n") && !source.endsWith("\n\n"), "closing wrapper then exactly one newline");
  const at = (needle) => source.indexOf(needle);
  assert.ok(at("(function (root, factory) {") > 0 && at('root.explorerEncoding = api;') > 0);
  assert.ok(at("// == §00-header ==") < at("// == §01-util ==") && at("// == §01-util ==") < at("// == §02-hash ==") &&
    at("// == §02-hash ==") < at("// == §05-a ==") && at("// == §05-a ==") < at("// == §99-footer =="));
  assert.ok(at("return Object.freeze(API);") > at("// == §99-footer =="), "the footer is last");
  assert.equal(source.split("\n").filter((l) => /^\S/.test(l) && !/^(\/\*|   |\}\)|\(function)/.test(l)).length, 0, "wrapper lines only at column 0");
});

test("assembly is deterministic: twice, and with CRLF or trailing blanks in the parts, is byte-identical", () => {
  const a = assemble({ dir: dirOf(BASE) }).source;
  assert.equal(assemble({ dir: dirOf(BASE) }).source, a);
  const messy = {};
  for (const [name, text] of Object.entries(BASE)) messy[name] = text.replace(/\n/g, "\r\n") + "\r\n\r\n  \n";
  assert.equal(assemble({ dir: dirOf(messy) }).source, a);
});

test("parts sort by their two-digit number whatever the order they were written in", () => {
  const files = {};
  for (const name of ["99-footer.js", "02-hash.js", "01-util.js", "00-header.js"]) files[name] = BASE[name];
  assert.deepEqual(assemble({ dir: dirOf(files) }).parts, ["00-header", "01-util", "02-hash", "99-footer"]);
});

// ---------------------------------------------------------------------------------------------------
// Loading: requires-closure, fresh vm context, no ambient globals.
test("loadParts with `only` loads the requires-closure (by name or by id) and nothing else", () => {
  const dir = dirOf({
    ...BASE,
    "03-c.js": part("03-c", { requires: "01-util", prefix: "cee", provides: "result", body: "  API.result = Object.freeze({ one: () => 1 });" }),
  });
  assert.deepEqual(Object.keys(loadParts({ dir, only: ["hash"] })).sort(), ["LATTICE", "LIMITS", "THRESHOLDS", "TIMING", "VERSION", "hash", "util"]);
  assert.deepEqual(Object.keys(loadParts({ dir, only: ["02-hash"] })).sort(), Object.keys(loadParts({ dir, only: ["hash"] })).sort());
  assert.deepEqual(Object.keys(loadParts({ dir, only: ["util"] })).sort(), ["LATTICE", "LIMITS", "THRESHOLDS", "TIMING", "VERSION", "util"]);
  assert.deepEqual(Object.keys(loadParts({ dir, only: ["c"] })).sort(), ["LATTICE", "LIMITS", "THRESHOLDS", "TIMING", "VERSION", "result", "util"]);
  assert.throws(() => loadParts({ dir, only: ["nosuch"] }), /unknown part nosuch/);
});

test("loadParts evaluates in a fresh context: no window, document or d3, and two loads share nothing", () => {
  const probe = part("03-probe", {
    prefix: "prb",
    provides: "warn",
    allow: ["window", "document", "d3"],
    body: [
      "  // The lint's exceptions exist so this fixture can look; a real part never does (rule 5).",
      "  function prbLook() {",
      "    return [typeof window, typeof document, typeof d3, typeof module, typeof require];",
      "  }",
      "  const prbBox = { n: 0 };",
      "  API.warn = Object.freeze({ look: prbLook, box: prbBox });",
    ].join("\n"),
  });
  const dir = dirOf({ ...BASE, "03-probe.js": probe });
  const a = loadParts({ dir });
  const b = loadParts({ dir });
  assert.deepEqual(Array.from(a.warn.look()), ["undefined", "undefined", "undefined", "object", "undefined"], "`module` is the wrapper's own; nothing else is ambient");
  a.warn.box.n = 5;
  assert.equal(b.warn.box.n, 0);
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------------------------------
// The CLI.
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("CLI --lint prints ok and exits 0 on a clean set, prints every problem and exits 1 otherwise", () => {
  const ok = cli("--parts", dirOf(BASE), "--lint");
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^ok: 4 parts/);
  const bad = cli("--parts", dirOf({ ...BASE, "01-util.js": UTIL.replace("function utilClamp", "function clamp") }), "--lint");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /01-util\.js:\d+: top-level "clamp" does not start with prefix "util"/);
  assert.equal(cli().status, 2, "no --parts is a usage error");
});

test("CLI --out writes the assembly (creating parent directories) and --check compares against it", () => {
  const dir = dirOf(BASE);
  const out = path.join(scratch, "deep", "er", "encoding.js");
  const wrote = cli("--parts", dir, "--out", out);
  assert.equal(wrote.status, 0);
  assert.equal(fs.readFileSync(out, "utf8"), assemble({ dir }).source);
  const same = cli("--parts", dir, "--out", out, "--check");
  assert.equal(same.status, 0);
  assert.match(same.stdout, /matches the assembly of 4 parts/);
  fs.appendFileSync(out, "// drift\n");
  const drift = cli("--parts", dir, "--out", out, "--check");
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /differs from the assembly/);
  const missing = cli("--parts", dir, "--out", path.join(scratch, "absent.js"), "--check");
  assert.equal(missing.status, 1);
  const stdout = cli("--parts", dir);
  assert.equal(stdout.status, 0);
  assert.equal(stdout.stdout, assemble({ dir }).source, "without --out the module goes to stdout");
});

test("--out refuses to write when a part has a problem, and a syntax error is a reported problem, not a stack", () => {
  const broken = { ...BASE, "01-util.js": UTIL.replace("return Math.min(hi, Math.max(lo, x));", "return Math.min(hi, Math.max(lo, x);") };
  const { problems } = assemble({ dir: dirOf(broken) });
  assert.ok(has(problems, /does not parse/), problems.join("\n"));
  const out = path.join(scratch, "never.js");
  const run = cli("--parts", dirOf(broken), "--out", out);
  assert.equal(run.status, 1);
  assert.ok(!fs.existsSync(out));
  assert.doesNotMatch(run.stderr, /at .*\.js:\d+/, "no stack trace");
});

// ---------------------------------------------------------------------------------------------------
// Negative fixtures, one per rule of WORKPLAN.md 2.2. Each case changes one part and names the message
// that must appear; `only` asserts that message is the whole story where the fixture is meant to be
// exact. The positive twin sits beside the rules where a near miss could be confused with a violation.
const NEG = [];
const neg = (rule, name, files, expected, { exact = true } = {}) => NEG.push({ rule, name, files, expected, exact });
const clean = (rule, name, files) => NEG.push({ rule, name, files, expected: null });
const util = (body, extra = {}) => part("01-util", { prefix: "util", provides: "util", body, ...extra });
const REG = "  API.util = Object.freeze({ clamp: utilClamp });";
const CLAMP = "  function utilClamp(x, lo, hi) {\n    return x;\n  }";
const withBody = (extra, tail = "") => util(`${CLAMP}\n${extra}\n${REG}${tail}`);

// Rule 1: directives.
neg("1", "@part must equal the file name", { "01-util.js": UTIL.replace("@part 01-util", "@part 01-utils") }, /01-util\.js: \/\/ @part must equal "01-util" \(found "01-utils"\)/);
neg("1", "a file that does not begin with its directives has no @part", { "01-util.js": "  // hello\n" + UTIL }, /@part must equal "01-util" \(found null\)/, { exact: false });
neg("1", "@requires naming a part that does not exist", { "02-hash.js": HASH.replace("@requires 01-util", "@requires 01-util 07-ghost") }, /02-hash\.js: requires unknown part 07-ghost/);
neg("1", "@requires naming a part that sorts later", { "01-util.js": UTIL.replace("@requires", "@requires 02-hash") }, /01-util\.js: requires 02-hash, which does not sort earlier/);
neg("1", "@requires naming itself", { "02-hash.js": HASH.replace("@requires 01-util", "@requires 01-util 02-hash") }, /02-hash\.js: requires 02-hash, which does not sort earlier/);
neg("1", "@prefix must be lowerCamel: capital", { "01-util.js": UTIL.replace("@prefix util", "@prefix Util") }, /01-util\.js: \/\/ @prefix must be lowerCamel/, { exact: false });
neg("1", "@prefix must be lowerCamel: underscore", { "01-util.js": UTIL.replace("@prefix util", "@prefix u_til") }, /@prefix must be lowerCamel/, { exact: false });
neg("1", "@prefix must be lowerCamel: absent", { "01-util.js": UTIL.replace("  // @prefix util\n", "") }, /@prefix must be lowerCamel/, { exact: false });
neg("1", "two parts may not share a prefix", { "02-hash.js": HASH.replace("@prefix hash", "@prefix util").replace(/hash(Clamp|Toy)/g, "util$1") }, /02-hash\.js: prefix "util" is also the prefix of 01-util\.js/, { exact: false });
neg("1", "the directive lines are required even when empty (@requires)", { "01-util.js": UTIL.replace("  // @requires\n", "") }, /01-util\.js: missing the \/\/ @requires directive/);
neg("1", "@provides must name one of the 29 exported keys", { "01-util.js": UTIL.replace("@provides util", "@provides bogus").replace("API.util =", "API.bogus =") }, /@provides bogus, which is not one of the 29 exported keys/, { exact: false });
neg("1", "an unknown directive in the first lines", { "01-util.js": UTIL.replace("  // @requires\n", "  // @requires\n  // @provide util\n") }, /01-util\.js: line \d+: unknown directive @provide/);
neg("1", "a directive given twice", { "01-util.js": UTIL.replace("  // @requires\n", "  // @requires\n  // @requires\n") }, /@requires is given 2 times/);
neg("1", "a directive lower in the file (an @allow after code) is a mistake, not an exception", { "01-util.js": withBody("  // @allow Date.now\n  const utilStamp = () => Date.now();") }, /01-util\.js: line \d+: @allow is a directive and belongs in the first lines/, { exact: false });
neg("1", "two parts with the same number", { "02-other.js": part("02-other", { prefix: "oth", body: "  const othX = 1;" }) }, /02-other\.js: shares its number 02 with 02-hash\.js/);
neg("1", "the header is required", { "00-header.js": null }, /missing 00-header\.js/, { exact: false });
neg("1", "the footer is required", { "99-footer.js": null }, /missing 99-footer\.js/);
clean("1", "the directive block may hold several @allow lines, each a whole token", { "01-util.js": util(`${CLAMP}\n  const utilNow = () => new Date(0);\n  const utilRnd = () => Math.random();\n${REG}`, { allow: ["new Date", "Math.random"] }) });

// Rule 2: layout and names.
neg("2", "a comment at column 0", { "01-util.js": withBody("// flush left") }, /01-util\.js:\d+: top-level code must be indented two spaces \(found "\/\/ flush left"\)/);
neg("2", "code at column 0", { "01-util.js": withBody("const utilX = 1;") }, /top-level code must be indented two spaces \(found "const utilX = 1;"\)/, { exact: false });
neg("2", "one space of indentation", { "01-util.js": withBody(" const utilX = 1;") }, /01-util\.js:\d+: odd indentation/);
neg("2", "a tab in the indentation", { "01-util.js": withBody("\tconst utilX = 1;") }, /01-util\.js:\d+: indent with spaces, not tabs/);
neg("2", "a top-level function without the prefix", { "01-util.js": withBody("  function helper() {\n    return 1;\n  }") }, /top-level "helper" does not start with prefix "util"/);
neg("2", "a top-level const without the prefix", { "01-util.js": withBody("  const table = 1;") }, /top-level "table" does not start with prefix "util"/);
neg("2", "a top-level let without the prefix", { "01-util.js": withBody("  let counter = 0;") }, /top-level "counter" does not start with prefix "util"/);
neg("2", "an async function without the prefix", { "01-util.js": withBody("  async function later() {\n    return 1;\n  }") }, /top-level "later" does not start with prefix "util"/);
neg("2", "a top-level class without the prefix", { "01-util.js": withBody("  class Box {\n  }") }, /top-level "Box" does not start with prefix "util"/);
neg("2", "a reserved header name, even with the prefix rule met by luck", { "01-util.js": withBody("  const VERSION = 1;") }, /"VERSION" is a reserved header name/, { exact: false });
neg("2", "a name already declared in another part", { "02-hash.js": HASH.replace("@prefix hash", "@prefix util").replace(/hash(Clamp|Toy)/g, "util$1").replace("@requires 01-util", "@requires 01-util") }, /"utilClamp" is already declared in 01-util\.js|"utilToy"/, { exact: false });
neg("2", "a comma chain of consts (only the first name would be checked)", { "01-util.js": withBody("  const utilA = 1,\n    utilB = 2;") }, /01-util\.js:\d+: one declaration per top-level const or let/);
neg("2", "a comma chain of lets on one line", { "01-util.js": withBody("  let utilA = 1, other = 2;") }, /one declaration per top-level const or let/);
neg("2", "a comma chain after a bracketed initializer", { "01-util.js": withBody("  const utilA = [1, 2], hidden = 3;") }, /one declaration per top-level const or let/);
neg("2", "destructuring at top level (its names are invisible to the prefix check)", { "01-util.js": withBody("  const { a, b } = { a: 1, b: 2 };") }, /top-level destructuring declares names the prefix rule cannot see/);
neg("2", "array destructuring at top level", { "01-util.js": withBody("  const [a] = [1];") }, /top-level destructuring/);
clean("2", "commas inside brackets, calls, arrows, strings and templates are not a chain", {
  "01-util.js": withBody([
    "  const utilList = [1, 2, 3];",
    "  const utilObj = { a: 1, b: 2 };",
    "  const utilSum = (a, b) => a + b;",
    "  const utilText = \"a, b\";",
    "  const utilTpl = `x, ${1}, y`;",
    "  const utilCall = Math.max(1, 2);",
    "  const utilMulti = [",
    "    1,",
    "    2,",
    "  ];",
  ].join("\n")),
});
clean("2", "nested helpers may declare any name at four spaces or more", { "01-util.js": withBody("  function utilOuter() {\n    const table = 1, other = 2;\n    let counter = 0;\n    function helper() {}\n    return table + other + counter;\n  }") });
clean("2", "blank lines, and lines inside a multi-line comment, are not layout errors", { "01-util.js": withBody("\n  /* a block\n     comment */\n\n") });

// Rule 3: registration.
neg("3", "a provided namespace that is never registered", { "01-util.js": UTIL.replace(REG, "") }, /@provides util but no top-level "API\.util = " statement/);
neg("3", "a namespace registered twice", { "01-util.js": UTIL + "  API.util = Object.freeze({});\n" }, /API\.util is registered 2 times; once/);
neg("3", "a namespace registered without being listed", { "01-util.js": UTIL + "  API.warn = Object.freeze({});\n" }, /registers API\.warn without listing it in @provides/);
neg("3", "a namespace registered without Object.freeze", { "01-util.js": UTIL.replace("Object.freeze({ clamp: utilClamp })", "{ clamp: utilClamp }") }, /API\.util must be registered as Object\.freeze\(\{ \.\.\. \}\)/);
neg("3", "a namespace provided by two parts", { "02-hash.js": HASH.replace("@provides hash", "@provides util").replace("API.hash =", "API.util =") }, /namespace util is also provided by 01-util\.js/);
clean("3", "a registration spread over several lines is one registration", { "01-util.js": UTIL.replace(REG, "  API.util = Object.freeze({\n    clamp: utilClamp,\n  });") });

// Rule 4: cross-part calls.
neg("4", "naming another part's private helper", { "02-hash.js": HASH.replace("API.util.clamp(-1, 0, 1)", "utilClamp(-1, 0, 1)") }, /02-hash\.js:\d+: names utilClamp, which is private to 01-util\.js/);
neg("4", "a load-time capture from a part not in @requires", { "02-hash.js": HASH.replace("@requires 01-util", "@requires") }, /02-hash\.js:\d+: takes API\.util while the module loads, but no part in its @requires provides util/);
neg("4", "a load-time capture of a namespace no earlier part provides", { "02-hash.js": HASH.replace("const hashClamp = API.util.clamp;", "const hashClamp = API.scale.apply;") }, /takes API\.scale while the module loads/);
neg("4", "API.<name> that is not one of the 29 keys", { "02-hash.js": HASH.replace("API.util.clamp(-1, 0, 1)", "API.utils.clamp(-1, 0, 1)") }, /API\.utils is not one of the 29 exported keys/);
clean("4", "a call-time reference to any namespace, from inside a function, needs no @requires", { "02-hash.js": HASH.replace("@requires 01-util", "@requires").replace("const hashClamp = API.util.clamp;", "const hashClamp = (x, lo, hi) => API.util.clamp(x, lo, hi);") });
clean("4", "header constants are usable anywhere, at load time too", { "02-hash.js": HASH.replace("const hashClamp = API.util.clamp;", "const hashClamp = API.util.clamp;\n  const hashMax = LIMITS.MAX + API.LIMITS.MAX;") });
clean("4", "a property that happens to share a helper's name is not naming the helper", { "02-hash.js": HASH.replace("API.util.clamp(-1, 0, 1)", "API.util.clamp(-1, 0, 1) + ({ utilClamp: 0 }).utilClamp") });

// Rule 5: purity, and the text that cannot be inlined.
const IMPURE_USES = [
  ["window", "window.location", "typeof window", "window;", "window,", "[window]"],
  ["document", "document.title", "typeof document", "document;"],
  ["localStorage", "localStorage.getItem(\"a\")", "typeof localStorage"],
  ["sessionStorage", "sessionStorage.length", "typeof sessionStorage"],
  ["Date.now", "Date.now()", "const f = Date.now;"],
  ["new Date", "new Date(0)", "new Date()"],
  ["Math.random", "Math.random()", "const r = Math.random;"],
  ["performance", "performance.now()", "typeof performance"],
  ["crypto", "crypto.getRandomValues(a)", "typeof crypto"],
  ["d3", "d3.scaleLinear()", "typeof d3"],
  ["fetch", "fetch(\"/x\")", "await fetch (\"/x\")"],
  ["eval", "eval(\"1\")", "eval (\"1\")"],
  ["new Function", "new Function(\"return 1\")"],
];
for (const [label, ...uses] of IMPURE_USES)
  for (const use of uses)
    neg("5", `${label} is refused: \`${use}\``, { "01-util.js": withBody(`  function utilImpure() {\n    return ${use.startsWith("const") || use.startsWith("await") ? "1" : use};\n  }${use.startsWith("const") ? `\n  ${use}` : ""}${use.startsWith("await") ? `\n  async function utilLater() {\n    ${use};\n  }` : ""}`) }, new RegExp(`01-util\\.js: uses ${label.replace(".", "\\.")} \\(purity rule`), { exact: false });
clean("5", "an object KEY called window (the public field of API.md B.8), scale.window and a trailing key pass", {
  "01-util.js": withBody("  const utilKey = { window: null, other: 1 };\n  const utilRead = (scale) => scale.window;\n  const utilMulti = {\n    performance: 1,\n    crypto: 2,\n    document: 3,\n  };"),
});
clean("5", "prose in comments and strings never counts: `a narrower window`, Date.now, \"new Date\", template text", {
  "01-util.js": withBody("  // The window narrows; nothing here calls Date.now or Math.random, and fetch(url) is prose.\n  /* document.title, localStorage, eval(x) */\n  const utilProse = \"a narrower window, new Date(), crypto.subtle, d3.max\";\n  const utilTpl = `document ${1} window`;"),
});
clean("5", "an @allow for exactly the token used excuses it (01-util's new Date for time.utcDay)", { "01-util.js": withBody("  const utilDay = (ms) => new Date(ms).toISOString();", "").replace("  // @provides util", "  // @provides util\n  // @allow new Date") });
neg("5", "an @allow for one token excuses no other", { "01-util.js": withBody("  const utilDay = (ms) => new Date(ms).toISOString();\n  const utilNow = () => Date.now();").replace("  // @provides util", "  // @provides util\n  // @allow new Date") }, /uses Date\.now \(purity rule/);
for (const [name, text] of [["</script", "a </script closer"], ["</script", "a </SCRIPT closer, in capitals"], ["<!--", "an html <!-- opener"], ["__EXPLORER_", "the marker __EXPLORER_SCRIPT__"]]) {
  neg("5", `${name} is forbidden in a comment`, { "01-util.js": withBody(`  // ${text}`) }, new RegExp(`01-util\\.js: contains the forbidden text ${name.replace(/[<!/-]/g, (c) => `\\${c}`)}`));
  neg("5", `${name} is forbidden in a string`, { "01-util.js": withBody(`  const utilS = "${text}";`) }, new RegExp(`contains the forbidden text ${name.replace(/[<!/-]/g, (c) => `\\${c}`)}`));
}

// Rule 6: non-ASCII.
neg("6", "non-ASCII in code (an identifier)", { "01-util.js": withBody("  const utilÄ = 1;") }, /01-util\.js: non-ASCII character in code/, { exact: false });
neg("6", "non-ASCII in a string of a part other than 04-text", { "01-util.js": withBody("  const utilMinus = \"−\";") }, /01-util\.js: non-ASCII character in a string \(only 04-text may hold one/);
clean("6", "non-ASCII in a comment is fine anywhere", { "01-util.js": withBody("  // − × · → ≈ ₂2 are fine here") });
clean("6", "non-ASCII in the strings of 04-text is fine", { "04-text.js": part("04-text", { prefix: "txt", provides: "text", body: "  const txtMinus = \"− × · → ≈ ₂2\";\n  API.text = Object.freeze({ minus: txtMinus });" }) });
neg("6", "non-ASCII in the CODE of 04-text", { "04-text.js": part("04-text", { prefix: "txt", provides: "text", body: "  const txtÄ = 1;\n  API.text = Object.freeze({});" }) }, /04-text\.js: non-ASCII character in code/, { exact: false });

for (const c of NEG) {
  test(`rule ${c.rule}: ${c.name}`, () => {
    const files = { ...BASE, ...c.files };
    for (const [k, v] of Object.entries(files)) if (v === null) delete files[k];
    const { problems } = assemble({ dir: dirOf(files) });
    if (c.expected === null) return assert.deepEqual(problems, [], "a near miss, not a violation");
    assert.ok(has(problems, c.expected), `expected ${c.expected}; got:\n${problems.join("\n") || "(no problems)"}`);
    if (c.exact) assert.equal(problems.length, 1, `expected only that problem; got:\n${problems.join("\n")}`);
  });
}

// ---------------------------------------------------------------------------------------------------
// The blanking scan the purity rule stands on.
test("strip blanks comments and string contents, keeps quotes and every newline, and can keep strings", () => {
  const src = "a // c1 window\nb /* c2\nwindow */ c\n\"s window\" 'x\\'y' `t\n${window}\n` d";
  const code = strip(src, false);
  assert.equal(code.split("\n").length, src.split("\n").length, "line numbers survive");
  assert.ok(!/window|c1|c2|s |x|y|t/.test(code.replace(/\b(a|b|c|d)\b/g, "")), `left: ${JSON.stringify(code)}`);
  assert.ok(/^a \nb \n c\n"" '' `\n\n` d$/.test(code), JSON.stringify(code));
  const kept = strip("x = \"a\\\"b\" // gone\n", true);
  assert.equal(kept, "x = \"a\\\"b\" \n");
});

test("strip survives an unterminated string by ending it at the newline", () => {
  const code = strip("a = 'oops\nwindow.x\n", false);
  assert.ok(/window\.x/.test(code), "the next line is code again and is still scanned");
});
