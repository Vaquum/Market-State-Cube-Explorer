"use strict";
// U35 role-lint.test.js (H11): the role-aware lint of DR-20 and its two-sided allowlist ratchet.
//
// Oracles (none of them is the code under test's own output):
//   - tests/fixtures/lint/cases.json: a truth table written by hand from the token namespaces of the
//     consumer map (maps/consumer-inventory.md 2.8): what is a taker-buy DATA name and must pass, what is
//     a retired rendering ROLE and must be flagged, and which function or selector a hit belongs to;
//   - tests/fixtures/lint/role-baseline.json: the ceiling, recorded once from the sources of the pinned
//     baseline commit and re-derived below from `git show` whenever that commit is reachable;
//   - docs/visual-contract.md: every allowed hit must belong to rows of that file that name an owner.
// It asserts, over the real sources (src/*.js|css|html, README.md, docs/*.md; never index.html, vendor/,
// data/, tests/fixtures/ or docs/visual-contract.md itself, which must name the retired tokens):
//   - the lint classifies by token namespace and never by the substring buy or sell (truth table);
//   - every hit is allowlisted, no allowlisted count exceeds the immutable ceiling, every allowlisted hit
//     maps to a contract row with an owner (in EVERY worktree: the ceiling half);
//   - the allowlist count EQUALS the actual count, so a removed hit forces a lower count (only with
//     CONVERGENCE=1, TESTPLAN DD-T14 and DD-T29: nine parallel packages cannot all lower the allowlist).
// ROLE_LINT_REPORT=1 prints every hit with its scope, which is how K lowers the allowlist.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));
const CONVERGENCE = process.env.CONVERGENCE === "1";

// ---------------------------------------------------------------------------------------------------
// The lint engine. Everything here is pure: text in, hits out. Classification is by the colour-token
// NAMESPACE (`colors.<key>`, `--ol-<name>`, `var(--ol-<name>)`, "<role> colour" prose), never by the
// substring buy or sell, so the taker-buy DATA names (bv, bt, bpoc, buyShare, taker_buy_volume, ids and
// labels such as #ol-buypoc-value and "Buy USDT") can never be hit (DR-20).
// ---------------------------------------------------------------------------------------------------

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

const blankMatches = (re) => (src) => src.replace(re, (m) => m.replace(/[^\n]/g, " "));
const stripCssComments = blankMatches(/\/\*[\s\S]*?\*\//g);
const stripHtmlComments = blankMatches(/<!--[\s\S]*?-->/g);

// Rule spans of a stylesheet: the selector text and the offsets of its braces, innermost first.
function cssSpans(code) {
  const stack = [], spans = [];
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "{") { stack.push({ sel: code.slice(start, i).trim().replace(/\s+/g, " "), open: i }); start = i + 1; }
    else if (c === "}") { const r = stack.pop(); if (r) spans.push({ sel: r.sel, from: r.open, to: i }); start = i + 1; }
    else if (c === ";") start = i + 1;
  }
  return spans;
}

function lineOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

// Retired rendering roles, flagged wherever they appear (each is a row of docs/visual-contract.md).
const RETIRED_COLOR_KEYS = ["buy", "sell", "neutral", "time", "volume", "evidence", "tiers"];
const RETIRED_TOKENS = ["buy", "sell", "neutral", "time", "volume", "evidence"];
// Overloaded tokens: legitimate as a reference or as chrome, flagged only where a readiness state is
// painted with them. The scope is the enclosing function (JS) or the selector (CSS).
const STATE_SCOPES = {
  "colors.poc@state": { js: ["paintCoverage", "paintUnfinished", "activity"] },
  "colors.line@state": { js: ["cellColour", "paintMotion", "lensMotion", "paintCoverage"] },
  "--ol-poc@state": { css: /\.ol-res-coarse|\.ol-plane|\.ol-data-key/ },
  "--ol-line@state": { css: /\.ol-plane|\.ol-data-key/ },
};
const PATTERNS = [
  ...RETIRED_COLOR_KEYS.map((k) => `colors.${k}`),
  ...RETIRED_TOKENS.map((t) => `--ol-${t}`),
  "--ol-tier-*",
  "PERIOD_TIERS",
  "colors-key",
  "prose:buy-sell-colour",
  ...Object.keys(STATE_SCOPES),
];

// "buy colour", "sell colour", "buy and sell colours", "buy/sell colour", across a wrapped comment.
const GAP = String.raw`(?:\s|//|\*)+`;
const PROSE = new RegExp(String.raw`(?<![\w-])(?:buy|sell)(?:${GAP}(?:and|or)${GAP}(?:buy|sell)|/(?:buy|sell))?${GAP}colou?rs?(?![\w-])`, "gi");
const COLORS_ACCESS = new RegExp(String.raw`(?<![\w$.])colors(?:\s*\.\s*(\w+)|\s*\[\s*["'](\w+)["']\s*\])`, "g");
const OL_TOKEN = /(?<![\w-])--ol-[a-z0-9-]*/g;

function lintText(kind, text) {
  const code = kind === "js" ? stripJsComments(text) : kind === "css" ? stripCssComments(text) : kind === "html" ? stripHtmlComments(text) : text;
  const line = lineOf(text);
  const scopes = kind === "js" ? jsScopes(text, code) : null;
  const spans = kind === "css" ? cssSpans(code) : null;
  const hits = [];
  const add = (pattern, offset, scope) => hits.push({ pattern, line: line(offset), scope });
  const scopeAt = (offset) => {
    if (kind === "js") return scopes[line(offset) - 1];
    if (kind === "css") {
      const span = spans.find((s) => s.from < offset && offset < s.to);
      return span ? span.sel : "(top level)";
    }
    return "(text)";
  };
  let m;

  COLORS_ACCESS.lastIndex = 0;
  while ((m = COLORS_ACCESS.exec(code))) {
    const key = m[1] || m[2], scope = scopeAt(m.index);
    if (RETIRED_COLOR_KEYS.includes(key)) add(`colors.${key}`, m.index, scope);
    const state = STATE_SCOPES[`colors.${key}@state`];
    if (state && state.js && kind === "js" && state.js.includes(scope)) add(`colors.${key}@state`, m.index, scope);
  }

  OL_TOKEN.lastIndex = 0;
  while ((m = OL_TOKEN.exec(code))) {
    const raw = m[0], name = raw.replace(/-+$/, "");
    const after = code.slice(m.index + raw.length).match(/^\s*(:|\$\{)?/)[1];
    let scope = scopeAt(m.index);
    if (kind === "css" && after === ":") scope = name; // a definition: the token is its own scope
    const bare = name.slice("--ol-".length);
    if (RETIRED_TOKENS.includes(bare) && after !== "${") add(`--ol-${bare}`, m.index, scope);
    else if (raw.startsWith("--ol-tier-")) add("--ol-tier-*", m.index, scope);
    const state = STATE_SCOPES[`${name}@state`];
    if (state && state.css && kind === "css" && after !== ":" && state.css.test(scope)) add(`${name}@state`, m.index, scope);
  }

  const tiers = /(?<![\w$])PERIOD_TIERS(?![\w$])/g;
  while ((m = tiers.exec(code))) add("PERIOD_TIERS", m.index, scopeAt(m.index));

  if (kind === "js") {
    // the probe's key list in getColors: the retired keys are quoted strings there, not property reads
    const keys = /(["'])(buy|sell|neutral|time)\1/g;
    while ((m = keys.exec(code))) if (scopeAt(m.index) === "getColors") add("colors-key", m.index, "getColors");
  }

  PROSE.lastIndex = 0;
  while ((m = PROSE.exec(text))) add("prose:buy-sell-colour", m.index, kind === "js" ? scopeAt(m.index) : "(text)");
  return hits;
}

const kindOf = (rel) => ({ ".js": "js", ".css": "css", ".html": "html", ".md": "md" })[rel.slice(rel.lastIndexOf("."))] || null;

// ---------------------------------------------------------------------------------------------------
// Sources and the contract's rows
// ---------------------------------------------------------------------------------------------------
const FIXTURES = "tests/fixtures/lint";
const OWNERS = ["#46", "#47", "#48"];

// The files the lint reads: source and docs, never the generated page, vendored code, data, fixtures or
// the contract itself.
function scannedFiles() {
  const list = [];
  for (const name of fs.readdirSync(path.join(ROOT, "src")).sort()) if (kindOf(name)) list.push(`src/${name}`);
  list.push("README.md");
  if (fs.existsSync(path.join(ROOT, "docs")))
    for (const name of fs.readdirSync(path.join(ROOT, "docs")).sort())
      if (name.endsWith(".md") && name !== "visual-contract.md") list.push(`docs/${name}`);
  return list.filter((f) => kindOf(f) && fs.existsSync(path.join(ROOT, f)));
}

const splitRow = (line) => line.replace(/^\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

// Rows of the inventory tables: id -> { cells, text, owners }.
function contractRows() {
  const rows = new Map();
  for (const line of read("docs/visual-contract.md").split("\n")) {
    const m = /^\| ([CDFRTN]-\d\d[a-z]?) \|/.exec(line);
    if (!m) continue;
    const cells = splitRow(line);
    rows.set(m[1], { cells, text: line, owners: cells[6].split(/\s*,\s*/).filter(Boolean) });
  }
  return rows;
}

// Names a row must carry to claim a hit: the function or const for JS, the classes or ids of the
// selector (or the token itself for a definition) for CSS, the file's own name for prose files.
function scopeNames(file, hit) {
  const kind = kindOf(file);
  if (kind === "js") return hit.scope === "(top level)" ? [] : [hit.scope];
  if (kind === "css") {
    if (hit.scope.startsWith("--ol-")) return [hit.scope];
    return hit.scope.match(/[.#][A-Za-z][\w-]*/g) || [];
  }
  return [path.basename(file)];
}
// A class or id may follow its element (`i.ol-res-coarse`); a bare name may not be part of a longer one.
const mentions = (text, name) =>
  new RegExp(`${/^[.#]/.test(name) ? "" : "(?<![\\w$-])"}${name.replace(/[.#$*]/g, "\\$&")}(?![\\w$-])`).test(text);

function scan() {
  const hits = [];
  for (const file of scannedFiles()) for (const h of lintText(kindOf(file), read(file))) hits.push({ ...h, file });
  return hits;
}
const tally = (hits) => {
  const counts = new Map();
  for (const h of hits) counts.set(`${h.file}\u0000${h.pattern}`, (counts.get(`${h.file}\u0000${h.pattern}`) || 0) + 1);
  return counts;
};

// ---------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------
describe("the lint classifies by token namespace (truth table)", () => {
  const cases = readJson(`${FIXTURES}/cases.json`);

  for (const c of cases.allowed)
    it(`allows: ${c.name}`, () => {
      assert.deepEqual(lintText(c.kind, c.text).map((h) => h.pattern), []);
    });

  for (const c of cases.flagged)
    it(`flags: ${c.name}`, () => {
      assert.deepEqual(lintText(c.kind, c.text).map((h) => h.pattern).sort(), [...c.expect].sort());
    });

  for (const c of cases.scopes)
    it(`scopes: ${c.name}`, () => {
      assert.deepEqual(lintText(c.kind, c.text).map(({ pattern, line, scope }) => ({ pattern, line, scope })), c.hits);
    });

  for (const c of cases.lexer)
    it(`lexer: ${c.name}`, () => {
      assert.equal(stripJsComments(c.input), c.output);
    });

  it("never flags a taker-buy DATA name, whatever the file kind", () => {
    const names = ["bv", "bt", "bpoc", "buyShare", "taker_buy_volume", "buyVolume", "buyTrades", "buyvol", "buytrades", "ol-buypoc-value", "ol-buyvol", "ol-key-bpoc", "Buy USDT", "Buy share", "Taker-buy USDT", "Buy point of control"];
    for (const kind of ["js", "css", "html", "md"])
      for (const n of names) assert.deepEqual(lintText(kind, `x ${n} y`), [], `${kind}: ${n}`);
  });

  it("the truth table exercises every pattern of the engine", () => {
    const seen = new Set();
    for (const c of cases.flagged) for (const p of c.expect) seen.add(p);
    assert.deepEqual(PATTERNS.filter((p) => !seen.has(p)), []);
  });
});

describe("the ratchet over the real sources", () => {
  const baseline = readJson(`${FIXTURES}/role-baseline.json`);
  const allowlist = readJson(`${FIXTURES}/role-allowlist.json`);
  const rows = contractRows();
  const hits = scan();
  const counts = tally(hits);
  const key = (file, pattern) => `${file}\u0000${pattern}`;
  const ceiling = (file, pattern) => (baseline.counts[file] && baseline.counts[file][pattern]) || 0;
  const allowed = (file, pattern) => (allowlist.entries.find((e) => e.file === file && e.pattern === pattern) || { count: 0 }).count;

  if (process.env.ROLE_LINT_REPORT === "1")
    it("report", () => {
      for (const h of hits) console.log(`${h.file}:${h.line}  ${h.pattern}  [${h.scope}]`);
    });

  it("scans the sources and only the sources", () => {
    const files = scannedFiles();
    for (const f of ["src/explorer.js", "src/explorer.css", "src/view.html", "README.md", "docs/data-and-semantics.md"]) assert.ok(files.includes(f), f);
    for (const f of files) {
      assert.notEqual(f, "index.html");
      assert.ok(!/^(vendor|data|tests)\//.test(f), f);
      assert.notEqual(f, "docs/visual-contract.md", "the contract must name the retired tokens, so it is not linted");
    }
  });

  it("has no hit outside the allowlist", () => {
    const over = [];
    for (const [k, n] of counts) {
      const [file, pattern] = k.split("\u0000");
      if (n > allowed(file, pattern)) over.push(`${file} ${pattern}: ${n} hits, ${allowed(file, pattern)} allowed`);
    }
    assert.deepEqual(over, [], "a retired rendering role is back, or a new file uses one; use the role tokens (positive, negative, midpoint, occupancy, state) or register the consumer in docs/visual-contract.md");
  });

  it("never allows more than the immutable baseline ceiling", () => {
    const bad = allowlist.entries.filter((e) => e.count > ceiling(e.file, e.pattern)).map((e) => `${e.file} ${e.pattern}: allows ${e.count}, ceiling ${ceiling(e.file, e.pattern)}`);
    assert.deepEqual(bad, []);
  });

  it("keeps the allowlist well formed: known patterns, no duplicates, positive counts", () => {
    const seen = new Set();
    for (const e of allowlist.entries) {
      assert.ok(PATTERNS.includes(e.pattern), `unknown pattern ${e.pattern}`);
      assert.ok(Number.isInteger(e.count) && e.count > 0, `${e.file} ${e.pattern}: count ${e.count} (delete an entry that reached zero)`);
      assert.ok(!seen.has(key(e.file, e.pattern)), `duplicate entry ${e.file} ${e.pattern}`);
      seen.add(key(e.file, e.pattern));
    }
    for (const [file, pats] of Object.entries(baseline.counts)) for (const p of Object.keys(pats)) assert.ok(PATTERNS.includes(p), `baseline names unknown pattern ${p} for ${file}`);
  });

  it("maps every allowlisted hit to rows of docs/visual-contract.md that name an owner", () => {
    for (const e of allowlist.entries) {
      const where = `${e.file} ${e.pattern}`;
      assert.ok(Array.isArray(e.rows) && e.rows.length > 0, `${where}: no rows`);
      assert.ok(OWNERS.includes(e.owner), `${where}: owner ${e.owner}`);
      const owners = new Set();
      for (const id of e.rows) {
        const row = rows.get(id);
        assert.ok(row, `${where}: row ${id} is not in the contract`);
        row.owners.forEach((o) => owners.add(o));
      }
      assert.ok(owners.has(e.owner), `${where}: owner ${e.owner} owns none of ${e.rows.join(", ")}`);
    }
  });

  it("names every hit's function, selector or file in a row of its allowlist entry", () => {
    const missing = [];
    for (const h of hits) {
      const e = allowlist.entries.find((x) => x.file === h.file && x.pattern === h.pattern);
      if (!e) continue; // reported by "has no hit outside the allowlist"
      const names = scopeNames(h.file, h);
      if (!names.length) continue;
      const text = e.rows.map((id) => (rows.get(id) || { text: "" }).text).join("\n");
      if (!names.some((n) => mentions(text, n))) missing.push(`${h.file}:${h.line} ${h.pattern} in ${h.scope}: none of rows ${e.rows.join(", ")} names ${names.join(" or ")}`);
    }
    assert.deepEqual(missing, []);
  });

  it("equals the actual count for every allowlisted pattern (CONVERGENCE=1: a removed hit forces a lower count)", { skip: CONVERGENCE ? false : "committed-equality half: runs with CONVERGENCE=1 (TESTPLAN DD-T29)" }, () => {
    const stale = [];
    for (const e of allowlist.entries) {
      const n = counts.get(key(e.file, e.pattern)) || 0;
      if (n !== e.count) stale.push(`${e.file} ${e.pattern}: allowlist ${e.count}, actual ${n}`);
    }
    assert.deepEqual(stale, [], "lower the count in tests/fixtures/lint/role-allowlist.json (delete the entry at zero) and update docs/visual-contract.md");
  });

  it("re-derives the baseline ceiling from git and finds it unchanged", { skip: reachable("8c82ca1") ? false : "commit 8c82ca1 is not reachable (shallow clone)" }, () => {
    const derived = {};
    for (const file of baseline.scanned) {
      const text = execFileSync("git", ["show", `${baseline.commit}:${file}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
      for (const h of lintText(kindOf(file), text)) {
        derived[file] = derived[file] || {};
        derived[file][h.pattern] = (derived[file][h.pattern] || 0) + 1;
      }
    }
    const sorted = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)));
    assert.deepEqual(sorted(derived), sorted(baseline.counts), "role-baseline.json is immutable: if the engine's patterns changed on purpose, re-record it in the same commit and say why");
    assert.equal(baseline.commit, "8c82ca1f03d80d3f35ff1ab6326902f4286f7b92");
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
