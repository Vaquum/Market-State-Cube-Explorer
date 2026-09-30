#!/usr/bin/env node
"use strict";
/*
 * Assembler for src/encoding.js (WORKPLAN.md section 2, DD-52).
 *
 *   node assemble-encoding.js --parts <dir> --out <file>          write the assembled module
 *   node assemble-encoding.js --parts <dir> --out <file> --check  fail when <file> differs from the assembly
 *   node assemble-encoding.js --parts <dir> --lint                 only validate the parts
 *
 * As a module:
 *   const { assemble, loadParts } = require("./assemble-encoding.js");
 *   assemble({ dir })                -> { source, parts, problems }   (problems: string[]; empty when valid)
 *   loadParts({ dir, only: ["measure", "scale"] })
 *                                    -> the frozen API of header + the requires-closure of `only` + footer,
 *                                       evaluated in a fresh vm context with no window/document/d3.
 *
 * A part is a file <NN>-<name>.js. Its first lines are directives:
 *   // @part 05-measure          (must equal the file name without .js)
 *   // @requires 01-util 03-result   (parts that must sort EARLIER; may be empty)
 *   // @prefix msr               (every top-level declaration name starts with this prefix)
 *   // @provides measure         (the API namespaces the part registers: API.measure = Object.freeze({...}))
 *   // @allow new Date           (optional, one purity exception per line: the rest of the line is the token)
 * The directives are the first lines of the file and appear nowhere else. The body is code exactly as it
 * appears inside the factory: top-level declarations at two-space indentation. 00-header.js and 99-footer.js
 * are reserved and are the only parts that may skip the prefix.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BANNED = [
  ["</script", /<\/script/i],
  ["<!--", /<!--/],
  ["__EXPLORER_", /__EXPLORER_/],
];
// Code with comments blanked and, unless keepStrings, the CONTENT of string and template literals blanked
// too, so that prose such as "a narrower window" or a comment naming Date.now is not mistaken for a use of
// the global. Newlines survive everywhere, so an offset in the result is on the same line as in the source.
// A lightweight scan, not a parser: a regular expression literal that holds a quote or a slash can confuse
// it, and it then errs by hiding code, never by inventing some.
function strip(text, keepStrings) {
  let out = "", i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "/" && d === "/") { while (i < n && text[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") out += "\n"; i++; }
      i += 2; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let closed = false;
      out += q; i++;
      while (i < n) {
        const ch = text[i];
        if (ch === q) { closed = true; break; }
        if (ch === "\n" && q !== "`") break;
        if (ch === "\\" && i + 1 < n) { if (keepStrings) out += ch; i++; }
        if (keepStrings || text[i] === "\n") out += text[i];
        i++;
      }
      out += q;
      if (closed) i++;
      continue;
    }
    out += c; i++;
  }
  return out;
}
const stripLiterals = (text) => strip(text, false);
// A bare identifier is a use of the global; an object KEY of the same name is not (API B.8 has a public
// field `window`, the manual share window): `{ window: null }` and `scale.window` pass, `window.x`,
// `typeof window`, `window;` and `window,` fail. Property access (`.window`) never matches.
function keyAware(re) {
  const g = new RegExp(re.source, "g");
  return {
    test(code) {
      g.lastIndex = 0;
      let m;
      while ((m = g.exec(code))) {
        const before = code.slice(0, m.index), after = code.slice(m.index + m[0].length);
        if (/[{,]\s*$/.test(before) && /^\s*:/.test(after)) continue;
        return true;
      }
      return false;
    },
  };
}
const IMPURE = [
  ["window", keyAware(/(?<![\w.$"'`])window\b/)],
  ["document", keyAware(/(?<![\w.$"'`])document\b/)],
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["Date.now", /\bDate\.now\b/],
  ["new Date", /\bnew Date\b/],
  ["Math.random", /\bMath\.random\b/],
  ["performance", keyAware(/(?<![\w.$])performance\b/)],
  ["crypto", keyAware(/(?<![\w.$])crypto\b/)],
  ["d3", /(?<![\w.$"'`])d3\b/],
  ["fetch", /(?<![\w.$])fetch\s*\(/],
  ["eval", /(?<![\w.$])eval\s*\(/],
  ["new Function", /\bnew Function\b/],
];
const DECL = /^  (?:(?:async )?function\*? ([A-Za-z_$][\w$]*)\(|(?:const|let|var|class) ([A-Za-z_$][\w$]*)\b)/;
const DESTRUCTURE = /^  (?:const|let|var) [{[]/;
const RESERVED = new Set(["API", "VERSION", "LIMITS", "TIMING", "THRESHOLDS", "LATTICE"]);
// The 29 keys of the frozen export (API.md A.1): a part that names any other API.<namespace> has a typo.
const NAMESPACES = new Set([
  "VERSION", "LIMITS", "TIMING", "THRESHOLDS", "LATTICE", "text", "result", "time", "util", "hash", "measure",
  "ratio", "relvol", "scale", "cohort", "lut", "role", "context", "store", "policy", "lifecycle", "axis", "warn",
  "model", "readout", "legend", "notice", "codec", "indicators",
]);
const HEADER_NAMESPACES = new Set(["VERSION", "LIMITS", "TIMING", "THRESHOLDS", "LATTICE"]);
const DIRECTIVES = ["part", "requires", "prefix", "provides", "allow"];
const NON_ASCII = /[^\x00-\x7f]/;

// The directive block is the first lines of the file (rule 1); the same comment anywhere else is a mistake,
// not a directive, so nothing later in a part can quietly grant a purity exception.
function readDirectives(text) {
  const lines = text.split("\n");
  const found = {};
  const problems = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\/\/ @([A-Za-z]+)(?: (.*))?$/);
    if (!m) break;
    if (!DIRECTIVES.includes(m[1])) problems.push(`line ${i + 1}: unknown directive @${m[1]}`);
    (found[m[1]] = found[m[1]] || []).push((m[2] || "").trim());
  }
  lines.slice(i).forEach((line, j) => {
    const m = line.match(/^\s*\/\/ @([A-Za-z]+)\b/);
    if (m && DIRECTIVES.includes(m[1])) problems.push(`line ${i + j + 1}: @${m[1]} is a directive and belongs in the first lines of the file`);
  });
  for (const key of DIRECTIVES)
    if (key !== "allow" && found[key] && found[key].length > 1) problems.push(`@${key} is given ${found[key].length} times`);
  return { found, problems };
}

function readParts(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d\d-[a-z0-9-]+\.js$/.test(f))
    .sort();
  return files.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
    const { found, problems } = readDirectives(text);
    const one = (key) => (found[key] ? found[key][0] : null);
    const words = (key) => (one(key) || "").split(/\s+/).filter(Boolean);
    return {
      file,
      id: file.replace(/\.js$/, ""),
      number: Number(file.slice(0, 2)),
      name: file.slice(3).replace(/\.js$/, ""),
      text,
      part: one("part"),
      requires: words("requires"),
      prefix: one("prefix"),
      provides: words("provides"),
      // One exception per line, the whole rest of the line: "new Date" is one token, not two.
      allow: found.allow || [],
      present: Object.keys(found),
      directiveProblems: problems,
    };
  });
}

// The text of the top-level declaration that starts at `from` in blanked code: up to the `;` at bracket
// depth 0, or to the next line that starts a new two-space statement.
function declarationEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth <= 0) return i;
    else if (c === "\n" && depth <= 0 && /^ {2}\S/.test(code.slice(i + 1, i + 4))) return i;
  }
  return code.length;
}

function lint(parts) {
  const problems = [];
  const seen = new Map();
  const ids = new Set(parts.map((p) => p.id));
  const byId = new Map(parts.map((p) => [p.id, p]));
  const provided = new Map();
  const prefixes = new Map();
  const numbers = new Map();
  // Pass 1: the top-level names each part declares, so pass 2 can see a part naming another part's helper.
  const declaredBy = new Map();
  for (const p of parts)
    p.text.split("\n").forEach((line) => {
      const m = line.match(DECL);
      if (m && p.id !== "00-header" && p.id !== "99-footer" && !declaredBy.has(m[1] || m[2])) declaredBy.set(m[1] || m[2], p.file);
    });
  for (const p of parts) {
    const where = p.file;
    if (p.part !== p.id) problems.push(`${where}: // @part must equal "${p.id}" (found ${JSON.stringify(p.part)})`);
    for (const message of p.directiveProblems) problems.push(`${where}: ${message}`);
    for (const key of ["requires", "prefix", "provides"])
      if (!p.present.includes(key)) problems.push(`${where}: missing the // @${key} directive (it may be empty, but it is stated)`);
    if (p.prefix === null || !/^[a-z][A-Za-z0-9]*$/.test(p.prefix)) problems.push(`${where}: // @prefix must be lowerCamel`);
    else if (prefixes.has(p.prefix)) problems.push(`${where}: prefix "${p.prefix}" is also the prefix of ${prefixes.get(p.prefix)}`);
    else prefixes.set(p.prefix, where);
    if (numbers.has(p.number)) problems.push(`${where}: shares its number ${String(p.number).padStart(2, "0")} with ${numbers.get(p.number)}`);
    else numbers.set(p.number, where);
    for (const r of p.requires) {
      if (!ids.has(r)) problems.push(`${where}: requires unknown part ${r}`);
      else if (r >= p.id) problems.push(`${where}: requires ${r}, which does not sort earlier`);
    }
    const special = p.id === "00-header" || p.id === "99-footer";
    const lines = p.text.split("\n");
    const code = stripLiterals(p.text);
    lines.forEach((line, i) => {
      const m = line.match(DECL);
      if (m) {
        const name = m[1] || m[2];
        if (!special && !name.startsWith(p.prefix)) problems.push(`${where}:${i + 1}: top-level "${name}" does not start with prefix "${p.prefix}"`);
        if (!special && RESERVED.has(name)) problems.push(`${where}:${i + 1}: "${name}" is a reserved header name`);
        if (seen.has(name)) problems.push(`${where}:${i + 1}: "${name}" is already declared in ${seen.get(name)}`);
        else seen.set(name, where);
      } else if (DESTRUCTURE.test(line)) {
        problems.push(`${where}:${i + 1}: top-level destructuring declares names the prefix rule cannot see; declare each name on its own`);
      } else if (/^ *\t/.test(line)) {
        problems.push(`${where}:${i + 1}: indent with spaces, not tabs`);
      } else if (/^\S/.test(line) && line.trim() !== "") {
        problems.push(`${where}:${i + 1}: top-level code must be indented two spaces (found "${line.slice(0, 40)}")`);
      } else if (/^ (?! )/.test(line) && !/^ \*/.test(line) && line.trim() !== "") {
        problems.push(`${where}:${i + 1}: odd indentation`);
      }
    });
    // Rule 2: one declaration per top-level const or let, so that every name is a checked name. And rule 4's
    // load-time reach: a top-level statement that runs while the module loads may take from API only what
    // loads earlier and is named in @requires (a closure is called later, at call time, and is exempt).
    const reachable = new Set(HEADER_NAMESPACES);
    for (const r of p.requires) for (const ns of (byId.get(r) || { provides: [] }).provides) reachable.add(ns);
    for (const ns of p.provides) reachable.add(ns);
    const starts = /^ {2}(?:const|let) [A-Za-z_$][\w$]*/gm;
    let start;
    while ((start = starts.exec(code))) {
      const statement = code.slice(start.index, declarationEnd(code, start.index));
      const line = code.slice(0, start.index).split("\n").length;
      let depth = 0;
      for (const c of statement) {
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === "," && depth === 0) {
          problems.push(`${where}:${line}: one declaration per top-level const or let (a comma chain hides names from the prefix check)`);
          break;
        }
      }
      if (!/=>|\bfunction\b/.test(statement))
        for (const m of statement.matchAll(/\bAPI\.([A-Za-z_$][\w$]*)/g))
          if (NAMESPACES.has(m[1]) && !reachable.has(m[1]))
            problems.push(`${where}:${line}: takes API.${m[1]} while the module loads, but no part in its @requires provides ${m[1]}`);
    }
    // Rule 4: another part's private helper is never named, and API.<namespace> is one of the 29 keys.
    for (const m of code.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
      const owner = declaredBy.get(m[0]);
      // An object KEY of the same name is not a use (as for the purity rule); shorthand `{ name }` is.
      if (owner && owner !== where && !(/[{,]\s*$/.test(code.slice(0, m.index)) && /^\s*:/.test(code.slice(m.index + m[0].length))))
        problems.push(`${where}:${code.slice(0, m.index).split("\n").length}: names ${m[0]}, which is private to ${owner}`);
    }
    for (const m of code.matchAll(/(?<![\w$.])API\.([A-Za-z_$][\w$]*)/g))
      if (!NAMESPACES.has(m[1])) problems.push(`${where}:${code.slice(0, m.index).split("\n").length}: API.${m[1]} is not one of the 29 exported keys`);
    for (const [label, re] of BANNED) if (re.test(p.text)) problems.push(`${where}: contains the forbidden text ${label}`);
    for (const [label, re] of IMPURE) {
      if (p.allow.includes(label)) continue;
      if (re.test(code)) problems.push(`${where}: uses ${label} (purity rule; add "// @allow ${label}" only with a reason in the part header)`);
    }
    // Rule 6: non-ASCII lives in comments and, in 04-text only, in strings. The build test compares bytes.
    if (NON_ASCII.test(stripLiterals(p.text))) problems.push(`${where}: non-ASCII character in code (only comments, and strings of 04-text, may hold one)`);
    else if (p.id !== "04-text" && NON_ASCII.test(strip(p.text, true))) problems.push(`${where}: non-ASCII character in a string (only 04-text may hold one; write an escape such as \\u2212)`);
    // Rule 3: each namespace is registered once, frozen, and listed in @provides.
    for (const ns of p.provides) {
      if (!NAMESPACES.has(ns)) problems.push(`${where}: @provides ${ns}, which is not one of the 29 exported keys`);
      const registrations = p.text.match(new RegExp(`^  API\\.${ns} = `, "gm")) || [];
      if (p.id !== "00-header" && registrations.length === 0) problems.push(`${where}: @provides ${ns} but no top-level "API.${ns} = " statement`);
      if (registrations.length > 1) problems.push(`${where}: API.${ns} is registered ${registrations.length} times; once`);
      if (p.id !== "00-header" && registrations.length && !new RegExp(`^  API\\.${ns} = Object\\.freeze\\(`, "m").test(p.text))
        problems.push(`${where}: API.${ns} must be registered as Object.freeze({ ... })`);
      if (provided.has(ns)) problems.push(`${where}: namespace ${ns} is also provided by ${provided.get(ns)}`);
      provided.set(ns, where);
    }
    for (const m of p.text.matchAll(/^  API\.([A-Za-z0-9_]+) = /gm))
      if (!p.provides.includes(m[1])) problems.push(`${where}: registers API.${m[1]} without listing it in @provides`);
  }
  if (!ids.has("00-header")) problems.push("missing 00-header.js");
  if (!ids.has("99-footer")) problems.push("missing 99-footer.js");
  return problems;
}

const BANNER = [
  "/* Measurement, scale, readout and persistence definitions shared by the page and the Node tests.",
  "   One factory, no dependencies: no DOM, no network, no d3, no storage, no clock, no randomness.",
  "   Plain script in the page (window.explorerEncoding), require() in Node. Assembled from parts; after the",
  "   first assembly this file is the single source of truth and is edited directly. */",
].join("\n");

function wrap(bodyParts) {
  return [
    BANNER,
    "(function (root, factory) {",
    '  "use strict";',
    "  const api = factory();",
    '  if (typeof module === "object" && module.exports) module.exports = api;',
    "  else root.explorerEncoding = api;",
    '})(typeof globalThis !== "undefined" ? globalThis : this, function () {',
    '  "use strict";',
    ...bodyParts,
    "});",
    "",
  ].join("\n");
}

function body(p) {
  // Directive comments stay: they document ownership and are harmless.
  return `  // == §${p.id} ==\n${p.text}`;
}

function assemble({ dir }) {
  const parts = readParts(dir);
  const problems = lint(parts);
  const ordered = parts.filter((p) => p.id !== "99-footer").concat(parts.filter((p) => p.id === "99-footer"));
  const source = wrap(ordered.map(body));
  // A syntax error is a problem like any other: the CLI reports it and exits 1 instead of a stack trace.
  try {
    new Function(source.replace(/^\/\*[\s\S]*?\*\//, ""));
  } catch (error) {
    problems.push(`the assembled source does not parse: ${error.message}`);
  }
  return { source, parts: parts.map((p) => p.id), problems };
}

function closure(parts, only) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const byName = new Map(parts.map((p) => [p.name, p]));
  const want = new Set(["00-header", "99-footer"]);
  const visit = (id) => {
    const p = byId.get(id) || byName.get(id);
    if (!p) throw new Error(`unknown part ${id}`);
    if (want.has(p.id) && id !== p.id) return;
    want.add(p.id);
    for (const r of p.requires) if (!want.has(r)) visit(r);
  };
  for (const id of only) visit(id);
  return parts.filter((p) => want.has(p.id));
}

function loadParts({ dir, only = null }) {
  const all = readParts(dir);
  const chosen = only ? closure(all, only) : all;
  const ordered = chosen.filter((p) => p.id !== "99-footer").concat(chosen.filter((p) => p.id === "99-footer"));
  const source = wrap(ordered.map(body));
  const context = vm.createContext({});
  const exported = vm.runInContext(`(function(){ const module = { exports: {} }; ${source}\n return module.exports; })()`, context, { filename: "encoding-parts.js" });
  return exported;
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const dir = get("--parts");
  if (!dir) {
    console.error("usage: assemble-encoding.js --parts <dir> [--out <file>] [--check] [--lint]");
    process.exit(2);
  }
  const { source, problems, parts } = assemble({ dir });
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  if (args.includes("--lint")) {
    console.log(`ok: ${parts.length} parts`);
    return;
  }
  const out = get("--out");
  if (!out) {
    process.stdout.write(source);
    return;
  }
  if (args.includes("--check")) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
    if (current !== source) {
      console.error(`${out} differs from the assembly of ${dir}`);
      process.exit(1);
    }
    console.log(`${out} matches the assembly of ${parts.length} parts`);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, source, "utf8");
  console.log(`wrote ${out} (${Buffer.byteLength(source)} bytes, ${parts.length} parts)`);
}

module.exports = { assemble, loadParts, readParts, lint, strip, NAMESPACES };
if (require.main === module) main();
