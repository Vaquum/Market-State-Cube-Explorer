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
 *   // @allow Date.now           (optional: purity exceptions, space separated tokens)
 * The body is code exactly as it appears inside the factory: top-level declarations at two-space
 * indentation. 00-header.js and 99-footer.js are reserved and are the only parts that may skip the prefix.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BANNED = [
  ["</script", /<\/script/i],
  ["<!--", /<!--/],
  ["__EXPLORER_", /__EXPLORER_/],
];
// Code with comments and the CONTENT of string and template literals blanked, so that prose such as
// "a narrower window" or a comment naming Date.now is not mistaken for a use of the global.
function stripLiterals(text) {
  let out = "", i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "/" && d === "/") { while (i < n && text[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += q; i++;
      while (i < n && text[i] !== q) { if (text[i] === "\\") i++; else if (text[i] === "\n" && q !== "`") break; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
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
const DECL = /^  (?:(?:async )?function\*? ([A-Za-z_$][\w$]*)\(|(?:const|let|var) ([A-Za-z_$][\w$]*)\b)/;
const RESERVED = new Set(["API", "VERSION", "LIMITS", "TIMING", "THRESHOLDS", "LATTICE"]);

function readParts(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d\d-[a-z0-9-]+\.js$/.test(f))
    .sort();
  return files.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const directive = (key) => {
      const m = text.match(new RegExp(`^\\s*// @${key}(?: (.*))?$`, "m"));
      return m ? (m[1] || "").trim() : null;
    };
    return {
      file,
      id: file.replace(/\.js$/, ""),
      number: Number(file.slice(0, 2)),
      name: file.slice(3).replace(/\.js$/, ""),
      text: text.replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n",
      part: directive("part"),
      requires: (directive("requires") || "").split(/\s+/).filter(Boolean),
      prefix: directive("prefix"),
      provides: (directive("provides") || "").split(/\s+/).filter(Boolean),
      allow: (directive("allow") || "").split(/\s+/).filter(Boolean),
    };
  });
}

function lint(parts) {
  const problems = [];
  const seen = new Map();
  const ids = new Set(parts.map((p) => p.id));
  const provided = new Map();
  for (const p of parts) {
    const where = p.file;
    if (p.part !== p.id) problems.push(`${where}: // @part must equal "${p.id}" (found ${JSON.stringify(p.part)})`);
    if (p.prefix === null || !/^[a-z][A-Za-z0-9]*$/.test(p.prefix)) problems.push(`${where}: // @prefix must be lowerCamel`);
    for (const r of p.requires) {
      if (!ids.has(r)) problems.push(`${where}: requires unknown part ${r}`);
      else if (r >= p.id) problems.push(`${where}: requires ${r}, which does not sort earlier`);
    }
    const special = p.id === "00-header" || p.id === "99-footer";
    const lines = p.text.split("\n");
    lines.forEach((line, i) => {
      const m = line.match(DECL);
      if (m) {
        const name = m[1] || m[2];
        if (!special && !name.startsWith(p.prefix)) problems.push(`${where}:${i + 1}: top-level "${name}" does not start with prefix "${p.prefix}"`);
        if (!special && RESERVED.has(name)) problems.push(`${where}:${i + 1}: "${name}" is a reserved header name`);
        if (seen.has(name)) problems.push(`${where}:${i + 1}: "${name}" is already declared in ${seen.get(name)}`);
        else seen.set(name, where);
      } else if (/^\S/.test(line) && line.trim() !== "") {
        problems.push(`${where}:${i + 1}: top-level code must be indented two spaces (found "${line.slice(0, 40)}")`);
      } else if (/^ (?! )/.test(line) && !/^ \*/.test(line) && line.trim() !== "") {
        problems.push(`${where}:${i + 1}: odd indentation`);
      }
    });
    for (const [label, re] of BANNED) if (re.test(p.text)) problems.push(`${where}: contains the forbidden text ${label}`);
    for (const [label, re] of IMPURE) {
      if (p.allow.includes(label)) continue;
      const code = stripLiterals(p.text);
      if (re.test(code)) problems.push(`${where}: uses ${label} (purity rule; add "// @allow ${label}" only with a reason in the part header)`);
    }
    for (const ns of p.provides) {
      if (p.id !== "00-header" && !new RegExp(`^  API\\.${ns} = `, "m").test(p.text)) problems.push(`${where}: @provides ${ns} but no top-level "API.${ns} = " statement`);
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
  const check = new Function(source.replace(/^\/\*[\s\S]*?\*\//, ""));
  void check; // throws on a syntax error
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
  fs.writeFileSync(out, source, "utf8");
  console.log(`wrote ${out} (${Buffer.byteLength(source)} bytes, ${parts.length} parts)`);
}

module.exports = { assemble, loadParts, readParts, lint };
if (require.main === module) main();
