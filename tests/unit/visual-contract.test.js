"use strict";
// U36 visual-contract.test.js (H11): docs/visual-contract.md parses, is complete against the sources, and
// its bookkeeping is consistent.
//
// Oracles (independent of the code under test):
//   - the pinned baseline commit 8c82ca1, read with `git show` when it is reachable: the per-function list
//     of `colors.<key>` reads and the code-site counts of tests/fixtures/lint/consumer-baseline.json are
//     re-derived from it and compared (the counts of the consumer map were checked the same way);
//   - the sources themselves (src/explorer.js, src/explorer.css, src/view.html): the inventory-completeness
//     ratchet scans them mechanically as maps/consumer-inventory.md 2.2 did;
//   - the vocabulary of the file's own section 2 and its test index (section 9).
// It asserts, in EVERY worktree (the completeness half, TESTPLAN DD-T29):
//   - every inventory table has the eight D1 columns after the row id; ids are unique and well formed
//     (C- D- F- R- T- N-); status is keep|todo-S1|todo-S2|todo-S3|done, owner is #46|#47|#48;
//   - a row exists for every top-level function that reads `colors.<key>` (in the sources now and at the
//     baseline), every CSS custom property and --ol-* token, every footer key and legend id of view.html;
//     row counts never fall below the baseline; every row owned by #46 names an existing test id;
//   - the consumers S1 creates are pre-registered (N-01..N-08 and one row per new function that will read
//     colors.*, so no Wave-2 package edits the file); the decision list names DR-01 (flow x activity
//     removed, deferred, not shipped); the contributor-checklist headings and the glossary exist.
// With CONVERGENCE=1 only (K, after the merges): no row is left `todo-S1`, the roll-up equals the tables,
// the pre-registered functions exist in explorer.js and every test file of the index exists. The content
// of the checklist and the glossary belongs to package D and is checked as soon as its placeholder is gone.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));
const CONVERGENCE = process.env.CONVERGENCE === "1";
const DOC = "docs/visual-contract.md";
const FIXTURES = "tests/fixtures/lint";


// <shared-scanner>
// Kept byte-identical in tests/unit/visual-contract.test.js (which asserts it): both tests must scan
// explorer.js the same way. Nothing outside the block is shared, so each file stays self-contained.
// Comment blanking keeps every other character and every newline, so line numbers survive. Token rules
// run on the blanked text (a comment paints nothing); the prose rule runs on the original, because
// wrapped comments and strings are exactly where "buy colour" words live.
function stripJsComments(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);
  // One frame per open "${" of a template literal; the top level is the first frame.
  const frames = [{ depth: 0 }];
  let i = 0, prev = "", word = "";
  const scanTemplate = () => {
    // i is just after the opening backtick or after the closing brace of a substitution
    for (; i < n; i++) {
      if (src[i] === "\\") { i++; continue; }
      if (src[i] === "`") { i++; prev = "`"; return; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; frames.push({ depth: 0 }); prev = "{"; return; }
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { let e = src.indexOf("\n", i); if (e < 0) e = n; blank(i, e); i = e; continue; }
    if (c === "/" && d === "*") { let e = src.indexOf("*/", i + 2); e = e < 0 ? n : e + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      i = j + 1; prev = c; word = ""; continue;
    }
    if (c === "`") { i++; scanTemplate(); word = ""; continue; }
    const top = frames[frames.length - 1];
    if (c === "{") { top.depth++; prev = c; i++; word = ""; continue; }
    if (c === "}") {
      if (top.depth === 0 && frames.length > 1) { frames.pop(); i++; scanTemplate(); word = ""; continue; }
      top.depth--; prev = c; i++; word = ""; continue;
    }
    if (c === "/") {
      // a slash after an expression is a division, otherwise it opens a regular expression literal
      if (/[)\]\w$"'`]/.test(prev) && !KEYWORDS.has(word)) { prev = c; i++; word = ""; continue; }
      let j = i + 1, cls = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "/" && !cls) break;
        j++;
      }
      i = j + 1; prev = ")"; word = ""; continue;
    }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      word = src.slice(i, j); prev = src[j - 1]; i = j; continue;
    }
    if (!/\s/.test(c)) { prev = c; word = ""; }
    i++;
  }
  return out.join("");
}
const JS_DECL = /^ {2}(?:async )?function\s+(\w+)|^ {2}(?:const|let|var)\s+(\w+)/;
const declName = (m) => (m ? m[1] || m[2] : null);

// Name of the enclosing top-level declaration of every line of a JS file (the async closure keeps
// them at two spaces of indent, which is also what tools/build.py check_names relies on).
function jsScopes(original, code) {
  const lines = code.split("\n"), orig = original.split("\n");
  const scope = new Array(lines.length);
  let current = "(top level)";
  for (let i = 0; i < lines.length; i++) {
    const own = declName(JS_DECL.exec(lines[i]));
    if (own) current = own;
    scope[i] = current;
    if (lines[i].trim() === "" && /^ {2}\S/.test(orig[i])) {
      // a comment block at declaration level belongs to the declaration that follows it
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const next = j < lines.length ? declName(JS_DECL.exec(lines[j])) : null;
      if (next) scope[i] = next;
    }
  }
  return scope;
}
// </shared-scanner>

// ---------------------------------------------------------------------------------------------------
// Parsing docs/visual-contract.md
// ---------------------------------------------------------------------------------------------------
const splitRow = (line) => line.replace(/^\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

// Tables (contiguous runs of "|" lines) with the heading they sit under, and every heading with its body.
function parseDoc(text) {
  const lines = text.split("\n");
  const tables = [], headings = [];
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6}) (.*)$/.exec(lines[i]);
    if (h) { heading = h[2]; headings.push({ level: h[1].length, title: h[2], line: i }); continue; }
    if (!lines[i].startsWith("|")) continue;
    const start = i;
    while (i < lines.length && lines[i].startsWith("|")) i++;
    const block = lines.slice(start, i);
    i--;
    if (block.length < 2) continue;
    tables.push({ heading, line: start + 1, header: splitRow(block[0]), rows: block.slice(2).map((l) => ({ cells: splitRow(l), text: l })) });
  }
  headings.forEach((h, k) => {
    const next = headings.slice(k + 1).find((n) => n.level <= h.level);
    h.body = lines.slice(h.line + 1, next ? next.line : lines.length).join("\n");
  });
  return { lines, tables, headings };
}

const COLUMNS = ["ID", "Consumer", "File / function / CSS rule", "Current", "Target role", "Measurement / channel", "Owner", "Tests", "Status"];
const STATUSES = ["keep", "todo-S1", "todo-S2", "todo-S3", "done"];
const OWNERS = ["#46", "#47", "#48", "#62"];
const ROW_ID = /^([CDFRTN])-(\d\d)([a-z]?)$/;
const TEST_ID = /\b(?:U\d\d[a-z]?|B\d\d)\b/g;

const doc = parseDoc(read(DOC));
const inventory = doc.tables.filter((t) => t.header[1] === "Consumer");
const rows = inventory.flatMap((t) => t.rows.map((r) => ({ id: r.cells[0], cells: r.cells, text: r.text, table: t })));
const rowById = new Map(rows.map((r) => [r.id, r]));
const rowText = rows.map((r) => r.text).join("\n");
const owners = (r) => r.cells[6].split(/\s*,\s*/).filter(Boolean);
const tableWith = (pred) => doc.tables.find(pred);
const testIndex = tableWith((t) => t.header[0] === "ID" && t.header[1] === "File" && t.header[3] === "Owner package");
const testIds = new Set(testIndex.rows.map((r) => r.cells[0]));

// Whole-word mention of an identifier, a token or an id anywhere in the rows.
const named = (name) => new RegExp(`(?<![\\w$-])${name.replace(/[.#$*]/g, "\\$&")}(?![\\w$-])`).test(rowText);

// Structural rules over the text of a contract, as a pure function so that it can be tried on synthetic
// documents (negative fixtures) as well as on the real one. Each problem names the rule it breaks.
function structureProblems(text, knownTestIds) {
  const d = parseDoc(text);
  const problems = [];
  const add = (rule, message) => problems.push({ rule, message });
  const seen = new Set();
  for (const t of d.tables.filter((x) => x.header[1] === "Consumer")) {
    if (JSON.stringify(t.header) !== JSON.stringify(COLUMNS)) add("columns", `table under "${t.heading}" (line ${t.line}) has columns ${t.header.join(" | ")}`);
    if (new Set(t.rows.map((r) => r.cells[0][0])).size > 1) add("prefix", `table under "${t.heading}" mixes prefixes`);
    for (const { cells: c } of t.rows) {
      const id = c[0];
      if (c.length !== COLUMNS.length) { add("cells", `${id} has ${c.length} cells (an unescaped | in a cell?)`); continue; }
      c.forEach((x, i) => { if (x === "") add("cells", `${id}: empty ${COLUMNS[i]}`); });
      if (!ROW_ID.test(id)) add("id", `malformed id ${id}`);
      if (seen.has(id)) add("id", `duplicate id ${id}`);
      seen.add(id);
      if (!STATUSES.includes(c[8])) add("vocabulary", `${id}: status "${c[8]}"`);
      const own = c[6].split(/\s*,\s*/).filter(Boolean);
      if (!own.length) add("vocabulary", `${id}: no owner`);
      for (const o of own) if (!OWNERS.includes(o)) add("vocabulary", `${id}: owner "${o}"`);
      if (new Set(own).size !== own.length) add("vocabulary", `${id}: owners repeat`);
      const slice = { "todo-S1": "#46", "todo-S2": "#47", "todo-S3": "#48" }[c[8]];
      if (slice && !own.includes(slice)) add("owner-status", `${id}: ${c[8]} but owners ${c[6]}`);
      const ids = c[7].replace(/S[23]:[^,;]*/g, "").match(TEST_ID) || [];
      for (const x of ids) if (!knownTestIds.has(x)) add("tests", `${id}: test ${x} is not in the test index`);
      if (own.includes("#46") && !ids.length) add("tests", `${id} is owned by #46 and names no test id ("${c[7]}")`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Scanning the sources (the completeness ratchet)
// ---------------------------------------------------------------------------------------------------
// Functions (and top-level consts) that read colors.<key>, with the keys read.
function colorReads(src) {
  const code = stripJsComments(src), scopes = jsScopes(src, code);
  const byFn = {};
  code.split("\n").forEach((line, i) => {
    const re = /(?<![\w$.])colors\.(\w+)/g;
    let m;
    while ((m = re.exec(line))) {
      byFn[scopes[i]] = byFn[scopes[i]] || {};
      byFn[scopes[i]][m[1]] = (byFn[scopes[i]][m[1]] || 0) + 1;
    }
  });
  return byFn;
}
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

// Ids of view.html that are footer keys or legends (the baseline ones and the ones INTEGRATION.md D.7 adds).
const CONTRACT_ID = /^ol-(?:key-[a-z-]+|data-coarse|ray-count|keys-scale|axis-(?:chip|pop)|lens-(?:status|local)|notice(?:-[a-z]+)?|[a-z-]*(?:legend|ramp)[a-z-]*)$/;

const PREREGISTERED_FUNCTIONS = ["paintGlyph", "patternFor", "motionPattern", "lutFor", "themeChanged", "scaleFrame", "scaleFault", "legendWrite", "legendPop", "legendMarker", "axisChipWrite", "bandPaint", "rowsScaleFrame", "lensScaleFrame"];
const NEW_TOKENS = ["--ol-positive", "--ol-negative", "--ol-midpoint", "--ol-occupancy", "--ol-state", "--ol-legacy-buy", "--ol-legacy-sell"];

// ---------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------
describe("docs/visual-contract.md: structure of the inventory", () => {
  const problems = structureProblems(read(DOC), testIds);
  const only = (rule) => problems.filter((p) => p.rule === rule).map((p) => p.message);

  it("has inventory tables for every prefix, each with the eight D1 columns after the id", () => {
    assert.ok(inventory.length >= 8, "tokens, three canvas tables, DOM, footer keys, readouts, new consumers");
    assert.deepEqual(only("columns"), []);
    assert.deepEqual([...new Set(rows.map((r) => r.id[0]))].sort(), ["C", "D", "F", "N", "R", "T"]);
    assert.deepEqual(COLUMNS.slice(1), ["Consumer", "File / function / CSS rule", "Current", "Target role", "Measurement / channel", "Owner", "Tests", "Status"], "the eight columns of parent D1");
  });

  it("has well-formed cells: nine per row, none empty", () => {
    assert.deepEqual(only("cells"), []);
  });

  it("has unique, well-formed ids in the table of their prefix", () => {
    assert.deepEqual(only("id"), []);
    assert.deepEqual(only("prefix"), []);
  });

  it("uses only the vocabulary: status keep|todo-S1|todo-S2|todo-S3|done, owner #46|#47|#48", () => {
    assert.deepEqual(only("vocabulary"), []);
  });

  it("gives every todo row an owner among the slices that still have work", () => {
    assert.deepEqual(only("owner-status"), []);
  });

  it("names an existing test id in every row owned by #46, and only existing ids anywhere", () => {
    assert.deepEqual(only("tests"), []);
  });

  it("keeps every row count at or above the baseline's", () => {
    const min = readJson(`${FIXTURES}/consumer-baseline.json`).minRows;
    for (const [prefix, n] of Object.entries(min)) assert.ok(rows.filter((r) => r.id[0] === prefix).length >= n, `${prefix}- rows: fewer than the baseline ${n}`);
  });
});

describe("the structure rules on synthetic documents (negative fixtures)", () => {
  const ids = new Set(["U01", "B01"]);
  const HEADER = `| ${COLUMNS.join(" | ")} |\n|${COLUMNS.map(() => "---").join("|")}|`;
  const row = (over = {}) => {
    const c = { id: "C-01", consumer: "x", file: "f", current: "c", target: "t", channel: "CELL", owner: "#46", tests: "U01", status: "todo-S1", ...over };
    return `| ${[c.id, c.consumer, c.file, c.current, c.target, c.channel, c.owner, c.tests, c.status].join(" | ")} |`;
  };
  const doc = (...rs) => `# d\n\n${HEADER}\n${rs.join("\n")}\n`;
  const rules = (text) => [...new Set(structureProblems(text, ids).map((p) => p.rule))];

  it("accepts a well-formed table", () => {
    assert.deepEqual(structureProblems(doc(row(), row({ id: "C-02", owner: "#46, #47", tests: "U01, B01, S2: pixel" })), ids), []);
    assert.deepEqual(structureProblems(doc(row({ id: "T-01", owner: "#48", status: "keep", tests: "-" })), ids), []);
  });

  it("rejects a table without the eight D1 columns", () => {
    assert.deepEqual(rules(doc(row()).replace("File / function / CSS rule", "Location")), ["columns"]);
    assert.deepEqual(rules(doc(row()).replace(" | Tests | Status |", " | Status |").replace(" | U01 | todo-S1 |", " | todo-S1 |")), ["columns", "cells"]);
  });

  it("rejects a duplicate or malformed id and a table that mixes prefixes", () => {
    assert.deepEqual(rules(doc(row(), row())), ["id"]);
    assert.deepEqual(rules(doc(row({ id: "C-1" }))), ["id"]);
    assert.deepEqual(rules(doc(row({ id: "X-01" }))), ["id"]);
    assert.deepEqual(rules(doc(row(), row({ id: "D-01" }))), ["prefix"]);
  });

  it("rejects a status or owner outside the vocabulary, and a todo row without its slice", () => {
    assert.deepEqual(rules(doc(row({ status: "todo-S9" }))), ["vocabulary"]);
    assert.deepEqual(rules(doc(row({ status: "wip" }))), ["vocabulary"]);
    assert.deepEqual(rules(doc(row({ owner: "S1" }))), ["vocabulary", "owner-status"]);
    assert.deepEqual(rules(doc(row({ owner: "#46, #46" }))), ["vocabulary"]);
    assert.deepEqual(rules(doc(row({ owner: "#47", status: "todo-S1" }))), ["owner-status"]);
  });

  it("rejects an empty cell and a stray pipe", () => {
    assert.deepEqual(rules(doc(row({ current: "" }))), ["cells"]);
    assert.deepEqual(rules(doc(row({ current: "a | b" }))), ["cells"]);
    assert.deepEqual(structureProblems(doc(row({ current: "a \\| b" })), ids), [], "an escaped pipe is text");
  });

  it("requires an existing test id in a row owned by #46, and rejects an unknown one anywhere", () => {
    assert.deepEqual(rules(doc(row({ tests: "-" }))), ["tests"]);
    assert.deepEqual(rules(doc(row({ tests: "S2: pixel" }))), ["tests"]);
    assert.deepEqual(rules(doc(row({ tests: "U99" }))), ["tests"]);
    assert.deepEqual(rules(doc(row({ id: "C-06", owner: "#47", status: "todo-S2", tests: "-" }))), []);
    assert.deepEqual(rules(doc(row({ id: "C-06", owner: "#47", status: "todo-S2", tests: "B99" }))), ["tests"]);
  });
});

describe("docs/visual-contract.md: inventory-completeness ratchet", () => {
  it("has a row for every function that reads colors.<key> in src/explorer.js", () => {
    const missing = Object.keys(colorReads(read("src/explorer.js"))).filter((fn) => fn !== "(top level)" && !named(fn));
    assert.deepEqual(missing, [], "add a row (or name the function in one) in docs/visual-contract.md");
  });

  it("has a row for every function that read colors.<key> at the baseline", () => {
    const baseline = readJson(`${FIXTURES}/consumer-baseline.json`).colorsReads.byFunction;
    const missing = Object.keys(baseline).filter((fn) => !named(fn));
    assert.deepEqual(missing, [], "a row of the inventory may change status but never disappear");
  });

  it("has a row for every CSS custom property and every --ol-* token used anywhere in src/", () => {
    const tokens = new Set();
    const collect = (text) => { for (const m of text.matchAll(/(?<![\w-])--[a-z0-9]+(?:-[a-z0-9]+)*(?![\w${-])/g)) tokens.add(m[0]); };
    collect(stripCss(read("src/explorer.css")));
    for (const f of ["src/explorer.js", "src/view.html"]) for (const m of read(f).matchAll(/(?<![\w-])--ol-[a-z0-9]+(?:-[a-z0-9]+)*(?![\w${-])/g)) tokens.add(m[0]);
    const missing = [...tokens].filter((t) => !named(t));
    assert.deepEqual(missing, []);
    assert.ok(tokens.size >= 40, "the scan found the token block");
  });

  it("has a row for every footer key and legend id of src/view.html", () => {
    const ids = [...read("src/view.html").matchAll(/\bid="(ol-[a-z0-9-]+)"/g)].map((m) => m[1]).filter((id) => CONTRACT_ID.test(id));
    const missing = ids.filter((id) => !named(id));
    assert.deepEqual(missing, []);
    for (const id of ["ol-key-zero", "ol-key-plain", "ol-data-coarse", "ol-ray-count", "ol-ramp", "ol-rows-ramp"]) assert.ok(ids.includes(id) || !fs.readFileSync(path.join(ROOT, "src/view.html"), "utf8").includes(`id="${id}"`), id);
  });

  it("pre-registers every id the design adds to view.html (INTEGRATION.md D.7) and every new token", () => {
    for (const id of ["ol-legend", "ol-legend-marker", "ol-legend-marker-text", "ol-legend-pop", "ol-rows-legend-pop", "ol-axis-chip", "ol-axis-pop", "ol-keys-scale", "ol-notice", "ol-notice-text", "ol-notice-more", "ol-notice-dismiss", "ol-lens-status", "ol-lens-local"]) {
      assert.ok(CONTRACT_ID.test(id), `${id} is a contract id`);
      assert.ok(named(id), `${id} has no row yet`);
    }
    for (const t of NEW_TOKENS) assert.ok(named(t), `${t} has no row yet`);
  });

  it("pre-registers the consumers S1 creates: N-01..N-08 and a todo-S1 row for every new function that reads colors.*", () => {
    for (let n = 1; n <= 8; n++) assert.ok(rowById.has(`N-0${n}`), `N-0${n}`);
    for (const fn of PREREGISTERED_FUNCTIONS) {
      const row = [...rowById.values()].find((r) => r.id[0] === "N" && r.cells[2].includes(`\`${fn}()\``) && /\(new/.test(r.cells[2]));
      assert.ok(row, `no N- row registers \`${fn}()\``);
      assert.ok(owners(row).includes("#46"), `${row.id}: owner`);
      assert.ok(["todo-S1", "done"].includes(row.cells[8]), `${row.id}: status ${row.cells[8]}`);
    }
  });

  it("keeps the consumer-baseline fixture consistent with itself", () => {
    const b = readJson(`${FIXTURES}/consumer-baseline.json`).colorsReads;
    const keys = {};
    for (const reads of Object.values(b.byFunction)) for (const [k, n] of Object.entries(reads)) keys[k] = (keys[k] || 0) + n;
    assert.deepEqual(keys, b.byKey);
    assert.equal(Object.values(b.byKey).reduce((a, n) => a + n, 0), b.total);
    assert.equal(b.total, 142);
    assert.equal(b.lines, 131);
  });

  it("re-derives the consumer baseline from git and finds it unchanged", { skip: reachable("8c82ca1") ? false : "commit 8c82ca1 is not reachable (shallow clone)" }, () => {
    const base = readJson(`${FIXTURES}/consumer-baseline.json`);
    const show = (f) => execFileSync("git", ["show", `8c82ca1:${f}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
    const js = show("src/explorer.js");
    assert.deepEqual(colorReads(js), base.colorsReads.byFunction);
    const code = stripJsComments(js), css = stripCss(show("src/explorer.css"));
    const n = (re, s = code) => (s.match(re) || []).length;
    assert.deepEqual(
      {
        "ctx.fillStyle =": n(/ctx\.fillStyle\s*=[^=]/g), "ctx.strokeStyle =": n(/ctx\.strokeStyle\s*=[^=]/g), "ctx.globalAlpha": n(/ctx\.globalAlpha\s*\*?=[^=]/g),
        "setLineDash non-empty": n(/setLineDash\(\[[^\]]/g), "fillRect(": n(/fillRect\(/g), "strokeRect(": n(/strokeRect\(/g), "line(": n(/(?<![\w.])line\(/g),
        "markLine(": n(/markLine\(/g), "hatchRect(": n(/hatchRect\(/g), "text(": n(/(?<![\w.])text\(/g), "chartLabel(": n(/chartLabel\(/g),
        ".style.background": n(/\.style\.background/g), "style.setProperty": n(/style\.setProperty/g), "var(--ol- in js": n(/var\(--ol-/g),
        "var(--ol- in css": n(/var\(--ol-/g, css), "custom properties in css": n(/(?<![\w-])--[a-z0-9-]+\s*:/g, css),
      },
      base.codeSites,
    );
  });
});

describe("docs/visual-contract.md: decision list, register, test index", () => {
  const decisions = tableWith((t) => t.header[0] === "ID" && t.header[1] === "Decision" && t.header[2] === "Contract rows");
  const register = tableWith((t) => t.header[0] === "ID" && t.header[1] === "Decision" && t.header[2] === "Where");

  const sequence = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);

  it("lists DR-01 to DR-38 (and any later ruling) in order, each naming rows that exist", () => {
    const ids = decisions.rows.map((r) => r.cells[0]);
    assert.ok(ids.length >= 38, "DR-01 to DR-38 are the rulings of DECISIONS.md at the freeze");
    assert.deepEqual(ids, sequence("DR", ids.length));
    for (const r of decisions.rows)
      for (const id of r.cells[2].split(/\s*,\s*/).filter((x) => x !== "-")) assert.ok(rowById.has(id), `${r.cells[0]} names ${id}, which is not a row`);
  });

  it("records DR-01: flow x activity removed, deferred, not shipped", () => {
    const dr01 = decisions.rows[0].cells[1];
    assert.match(dr01, /activity/i);
    assert.match(dr01, /REMOVED/);
    assert.match(dr01, /deferred/i);
    assert.match(dr01, /not shipped/i);
    assert.match(dr01, /multiplier/i);
  });

  it("carries the DD register DD-01 to DD-99 (and any later decision) in order", () => {
    const ids = register.rows.map((r) => r.cells[0]);
    assert.ok(ids.length >= 99, "DD-01 to DD-99 are the decisions of API.md Appendix D at the freeze");
    assert.deepEqual(ids, sequence("DD", ids.length));
    for (const r of register.rows) assert.ok(r.cells[1].length > 10 && r.cells[2], r.cells[0]);
  });

  it("has a test index with unique, well-formed ids and existing paths for the two tests of this package", () => {
    const seen = new Set();
    for (const r of testIndex.rows) {
      const [id, file, covers, owner] = r.cells;
      assert.match(id, /^(?:U\d\d[a-z]?|B\d\d)$/, id);
      assert.ok(!seen.has(id), `duplicate ${id}`);
      seen.add(id);
      assert.match(file, /^`tests\/(?:unit\/[\w-]+\.test|browser\/[\w-]+\.spec)\.js`$/, id);
      assert.ok(covers && owner, id);
    }
    for (const id of ["U35", "U36", "U37", "B16", "B23"]) assert.ok(seen.has(id), id);
    for (const f of ["tests/unit/role-lint.test.js", "tests/unit/visual-contract.test.js"]) assert.ok(testIndex.rows.some((r) => r.cells[1] === `\`${f}\``) && fs.existsSync(path.join(ROOT, f)), f);
  });

  it("renders the role baseline table exactly as role-baseline.json holds it", () => {
    const t = tableWith((x) => x.header[0] === "File" && x.header[1] === "Pattern" && x.header[2] === "Baseline hits");
    const shown = {};
    for (const r of t.rows) {
      const file = r.cells[0].replace(/`/g, ""), pattern = r.cells[1].replace(/`/g, "");
      (shown[file] = shown[file] || {})[pattern] = Number(r.cells[2]);
    }
    assert.deepEqual(shown, readJson(`${FIXTURES}/role-baseline.json`).counts);
  });
});

describe("docs/visual-contract.md: package D's sections", () => {
  const section = (re) => doc.headings.find((h) => re.test(h.title));
  const checklist = section(/contributor checklist/i);
  const glossary = section(/^\d*\.?\s*glossary/i);
  const PLACEHOLDER = "PACKAGE-D-PLACEHOLDER";

  it("has the contributor checklist with one heading per concern", () => {
    assert.ok(checklist, "no 'Contributor checklist' heading");
    const inside = doc.headings.filter((h) => h.level > checklist.level && h.line > checklist.line && h.line < checklist.line + checklist.body.split("\n").length + 1);
    const titles = inside.map((h) => h.title);
    for (const [name, re] of [["measurement, support, model and scale", /measurement/i], ["channel and policy", /channel/i], ["role, state and geometry", /role/i], ["generated legend", /legend/i], ["persistence", /persistence/i], ["tests", /^(?:\d+\.\d+\s+)?tests?\b/i]])
      assert.ok(titles.some((t) => re.test(t)), `no checklist heading for ${name} (found: ${titles.join(" | ")})`);
  });

  it("has the glossary", () => {
    assert.ok(glossary, "no 'Glossary' heading");
  });

  it("names both activities and each reference in the glossary once package D has written it (A-11, A-46, R-17)", { skip: glossary && glossary.body.includes(PLACEHOLDER) && !CONVERGENCE ? "package D's placeholder is still there (Wave 2)" : false }, () => {
    assert.ok(!glossary.body.includes(PLACEHOLDER) && !checklist.body.includes(PLACEHOLDER), "package D must replace both placeholders");
    const g = glossary.body;
    assert.match(g, /activity/i);
    assert.match(g, /multiplier|paleness/i, "the removed hidden activity multiplier of DR-01");
    assert.match(g, /Columns/, "the Columns pane painter");
    for (const re of [/family/i, /reference profile/i, /model reference/i, /S1 reference/i]) assert.match(g, re, `reference: ${re}`);
    assert.match(g, /Auto resolution level/i);
    assert.match(g, /Auto color/i);
    assert.match(g, /Comparison lock/i);
    assert.match(g, /padlock/i);
    const c = checklist.body;
    assert.ok(c.split("\n").filter((l) => l.trim() && !l.startsWith("#")).length >= 6, "the checklist has content under its headings");
  });
});

describe("docs/visual-contract.md: convergence (CONVERGENCE=1 only)", { skip: CONVERGENCE ? false : "committed-equality half: runs with CONVERGENCE=1 (TESTPLAN DD-T29)" }, () => {
  it("leaves no row todo-S1: S1's work is done, or the row moved to the next slice's todo", () => {
    assert.deepEqual(rows.filter((r) => r.cells[8] === "todo-S1").map((r) => r.id), []);
  });

  it("shows a roll-up equal to the rows", () => {
    const t = tableWith((x) => x.header[0] === "Prefix" && x.header[1] === "Rows");
    const stat = ["keep", "todo-S1", "todo-S2", "todo-S3", "done"];
    assert.deepEqual(t.header.slice(2), stat);
    const total = { all: 0 };
    for (const r of t.rows) {
      const prefix = r.cells[0];
      const mine = prefix === "all" ? rows : rows.filter((x) => x.id[0] === prefix);
      assert.deepEqual(r.cells.slice(1).map(Number), [mine.length, ...stat.map((s) => mine.filter((x) => x.cells[8] === s).length)], `roll-up of ${prefix}`);
      total.all += prefix === "all" ? 0 : 1;
    }
    assert.equal(total.all, 6);
  });

  it("has every pre-registered function in explorer.js and every test file of the index", () => {
    const src = read("src/explorer.js");
    for (const fn of PREREGISTERED_FUNCTIONS) assert.ok(new RegExp(`^ {2}(?:async )?function ${fn}\\(`, "m").test(src), `function ${fn} was pre-registered and never written (or renamed: amend the row)`);
    for (const r of testIndex.rows) assert.ok(fs.existsSync(path.join(ROOT, r.cells[1].replace(/`/g, ""))), `${r.cells[0]}: ${r.cells[1]} does not exist`);
  });
});

// The scanner block must not drift from role-lint.test.js in ANY worktree: two scanners would disagree
// about which function a colours read belongs to.
describe("shared scanner", () => {
  it("is identical to the one of tests/unit/role-lint.test.js", () => {
    const block = (s) => s.slice(s.indexOf("// <shared-scanner>"), s.indexOf("// </shared-scanner>"));
    const mine = block(read("tests/unit/visual-contract.test.js")), theirs = block(read("tests/unit/role-lint.test.js"));
    assert.ok(mine.length > 1000, "the block was found");
    assert.equal(mine, theirs);
  });
});

function reachable(rev) {
  try {
    execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
