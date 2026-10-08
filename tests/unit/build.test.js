"use strict";
// U02 (TESTPLAN.md 2.1): tools/build.py and src/document.html, the page that inlines the encoding module.
//
// Oracle: the Python build itself and the bytes it writes, judged by hand-written expectations: the page
// must hold each source text verbatim (compared as bytes, so a non-ASCII character that the build altered
// would show), in the order state < encoding < app, and every guard must fire on a source written for it.
// The one place the module text is compared with a second copy is the vm check, where the inline copy in
// the built page and require() of the file must agree (keys, a mapping id, a LUT hash).
//
// Every build here runs on a TEMPORARY COPY of the repository tree (tools/build.py, src/, the snapshot),
// because build.py reads its own location as the repository root: nothing here can write the tracked
// index.html, and a source can be broken on purpose. Until gate A0 there is no src/encoding.js; the copy
// then gets a small stand-in module (with the non-ASCII characters 04-text will hold), so the wiring is
// proved now and the same file proves the real module the moment it exists. The committed-page half
// (index.html equals a fresh build) runs only with CONVERGENCE=1 (DD-T29): a worktree edits src/ and must
// not commit the generated file.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const REAL_ENCODING = path.join(ROOT, "src/encoding.js");
const HAS_ENCODING = fs.existsSync(REAL_ENCODING);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "u02-"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const STUB = [
  "/* Stand-in for src/encoding.js until it is assembled (gate A0); the build test writes it into a copy. */",
  "(function (root, factory) {",
  '  "use strict";',
  "  const api = factory();",
  '  if (typeof module === "object" && module.exports) module.exports = api;',
  "  else root.explorerEncoding = api;",
  '})(typeof globalThis !== "undefined" ? globalThis : this, function () {',
  '  "use strict";',
  "  // The characters 04-text holds: − × · → ≈ ₂2",
  "  function stubGlyphs() {",
  '    return "− × · → ≈ ₂2";',
  "  }",
  "  return Object.freeze({ glyphs: stubGlyphs });",
  "});",
  "",
].join("\n");

let counter = 0;
// A copy of the tree the build reads. `edit(name, fn)` rewrites one source of the copy.
function tree() {
  const dir = path.join(scratch, `t${counter++}`);
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data"));
  fs.copyFileSync(path.join(ROOT, "tools/build.py"), path.join(dir, "tools/build.py"));
  fs.cpSync(path.join(ROOT, "src"), path.join(dir, "src"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "data/snapshot.json"), path.join(dir, "data/snapshot.json"));
  if (!HAS_ENCODING) fs.writeFileSync(path.join(dir, "src/encoding.js"), STUB);
  return {
    dir,
    file: (name) => path.join(dir, name),
    read: (name) => fs.readFileSync(path.join(dir, name), "utf8"),
    edit(name, fn) {
      fs.writeFileSync(path.join(dir, name), fn(fs.readFileSync(path.join(dir, name), "utf8")));
    },
  };
}
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" };
delete ENV.CONVERGENCE;
const py = (args, options = {}) => spawnSync("python3", args, { encoding: "utf8", env: ENV, maxBuffer: 1 << 28, ...options });
const build = (t, ...args) => py([path.join(t.dir, "tools/build.py"), ...args], { cwd: t.dir });
const pyIn = (t, code) => py(["-c", `import sys; sys.path.insert(0, "tools"); import build\n${code}`], { cwd: t.dir });

// The page's script elements, in order: [{attrs, body}].
function scripts(page) {
  return [...page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1].trim(), body: m[2] }));
}

// ---------------------------------------------------------------------------------------------------
test("the build twice is byte-identical, and build() equals what the command line writes", () => {
  const t = tree();
  const one = build(t, "--out", t.file("out/a.html"));
  assert.equal(one.status, 0, one.stderr);
  const two = build(t, "--out", t.file("out/b.html"));
  assert.equal(two.status, 0, two.stderr);
  const a = fs.readFileSync(t.file("out/a.html"));
  assert.ok(a.equals(fs.readFileSync(t.file("out/b.html"))), "two builds differ");
  const viaPython = pyIn(t, "sys.stdout.write(build.build())");
  assert.equal(viaPython.status, 0, viaPython.stderr);
  assert.ok(Buffer.from(viaPython.stdout, "utf8").equals(a), "build() and --out disagree");
});

test("with CONVERGENCE=1 the committed index.html is exactly a fresh build (DD-T29)", (t) => {
  if (process.env.CONVERGENCE !== "1") return t.skip("only with CONVERGENCE=1: a worktree does not commit index.html");
  const run = py(["-c", "import sys; sys.path.insert(0, 'tools'); import build; sys.stdout.write(build.build())"], { cwd: ROOT });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(Buffer.from(run.stdout, "utf8").equals(fs.readFileSync(path.join(ROOT, "index.html"))), "index.html is stale; run python3 tools/build.py");
});

// ---------------------------------------------------------------------------------------------------
// The page: what is in it and in which order.
test("the page holds state, encoding and app script text verbatim, in that order, after d3 and the data block", () => {
  const t = tree();
  assert.equal(build(t, "--out", t.file("out/index.html")).status, 0);
  const bytes = fs.readFileSync(t.file("out/index.html"));
  const page = bytes.toString("utf8");
  const els = scripts(page);
  assert.deepEqual(els.map((e) => e.attrs), ['src="vendor/d3.min.js"', 'type="application/json" id="origo-lens-data"', "", "", "", "", "", "", ""]);
  const [d3, data, state, encoding, evidence, comparison, dashboard, reference, app] = els;
  assert.equal(d3.body, "");
  assert.equal(state.body, t.read("src/state.js"));
  assert.equal(encoding.body, t.read("src/encoding.js"));
  assert.equal(evidence.body, t.read("src/evidence.js"));
  assert.equal(comparison.body, t.read("src/comparison.js"));
  assert.equal(dashboard.body, t.read("src/comparison-ui.js"));
  assert.equal(reference.body, t.read("src/reference.js"));
  assert.equal(app.body, t.read("src/explorer.js"));
  assert.ok(JSON.parse(data.body).recent || Object.keys(JSON.parse(data.body)).length > 0, "the data block is the snapshot as JSON");
  // Bytes, not just characters: the UTF-8 of the file is the UTF-8 in the page (the module holds - x . -> ~ and a subscript).
  const wrapped = Buffer.concat([Buffer.from("<script>"), fs.readFileSync(t.file("src/encoding.js")), Buffer.from("</script>")]);
  assert.equal(bytes.indexOf(wrapped) > 0, true, "<script> + src/encoding.js bytes + </script> is not in the page");
  assert.equal(bytes.indexOf(wrapped), bytes.lastIndexOf(wrapped), "and it is there once");
  const at = (s) => page.indexOf(s);
  assert.ok(at('src="vendor/d3.min.js"') < at('id="origo-lens-data"') && at('id="origo-lens-data"') < at("<script>" + state.body) &&
    at("<script>" + state.body) < at("<script>" + encoding.body) && at("<script>" + encoding.body) < at("<script>" + app.body));
  if (!HAS_ENCODING) assert.ok(page.includes("− × · → ≈ ₂2"), "the non-ASCII stand-in text survived the build");
});

test("src/document.html names each marker exactly once, and the encoding line sits between the state and app lines", () => {
  const doc = fs.readFileSync(path.join(ROOT, "src/document.html"), "utf8");
  const markers = ["__EXPLORER_STYLE__", "__EXPLORER_VIEW__", "__EXPLORER_DATA__", "__EXPLORER_STATE__", "__EXPLORER_ENCODING__", "__EXPLORER_EVIDENCE__", "__EXPLORER_COMPARISON__", "__EXPLORER_COMPARISONUI__", "__EXPLORER_REFERENCE__", "__EXPLORER_SCRIPT__"];
  for (const m of markers) assert.equal(doc.split(m).length - 1, 1, `${m} must occur exactly once`);
  assert.deepEqual(doc.match(/__EXPLORER_[A-Z]+__/g), markers, "the six markers, in page order, and no other");
  const lines = doc.split("\n");
  const at = (m) => lines.findIndex((l) => l.includes(m));
  assert.equal(lines[at("__EXPLORER_ENCODING__")], "    <script>__EXPLORER_ENCODING__</script>");
  assert.equal(at("__EXPLORER_ENCODING__"), at("__EXPLORER_STATE__") + 1, "directly after the state line");
  assert.equal(at("__EXPLORER_SCRIPT__"), at("__EXPLORER_ENCODING__") + 5, "comparison and reference scripts precede the app line");
});

// ---------------------------------------------------------------------------------------------------
// check_names(label, script) and check_inline(label, script).
const names = (t, script) => pyIn(t, `build.check_names("src/x.js", ${JSON.stringify(script)})`);
const inline = (t, script) => pyIn(t, `build.check_inline("src/x.js", ${JSON.stringify(script)})`);

test("check_names exits on a duplicate two-space function and names the label and the function", () => {
  const t = tree();
  const dup = names(t, "  function a() {}\n  function b() {}\n  function a() {}\n");
  assert.equal(dup.status, 1);
  assert.equal(dup.stderr.trim(), "src/x.js declares a more than once; the last replaces the others.");
  assert.match(names(t, "  async function go() {}\n  function go() {}\n").stderr, /src\/x\.js declares go more than once/);
  assert.match(names(t, "  function b() {}\n  function a() {}\n  function b() {}\n  function a() {}\n").stderr, /declares a, b more than once/);
  assert.equal(names(t, "  function a() {}\n  function b() {}\n").status, 0, "distinct names pass");
  assert.equal(names(t, "  function a() {}\n    function a() {}\n").status, 0, "a nested (four-space) function is another scope");
  assert.equal(names(t, "").status, 0);
});

test("check_inline exits on </script and <!-- in any case, and says which script", () => {
  const t = tree();
  for (const bad of ["a </script> b", "// </SCRIPT>", "x = '</Script'", "a <!-- b", "/* <!-- */"]) {
    const run = inline(t, bad);
    assert.equal(run.status, 1, `${bad} must fail`);
    assert.match(run.stderr, /^src\/x\.js contains <\/script or <!--/);
  }
  for (const fine of ["a < b", "if (a <!b) {}", "<div>", "// </div>", "x = '<script'", "a <! b"]) assert.equal(inline(t, fine).status, 0, `${fine} must pass`);
});

test("the build applies both guards to state.js, encoding.js and explorer.js, naming the file, and writes nothing", () => {
  for (const file of ["src/state.js", "src/encoding.js", "src/evidence.js", "src/comparison.js", "src/comparison-ui.js", "src/reference.js", "src/explorer.js"]) {
    for (const [what, text, message] of [
      ["a </script", "\n// </script>\n", /contains <\/script or <!--/],
      ["a <!--", "\nconst x = '<!--';\n", /contains <\/script or <!--/],
      ["a duplicate function", "\n  function dupOne() {}\n  function dupOne() {}\n", /declares dupOne more than once/],
    ]) {
      const t = tree();
      t.edit(file, (s) => s + text);
      const out = t.file("out/index.html");
      const run = build(t, "--out", out);
      assert.equal(run.status, 1, `${file} with ${what}`);
      assert.ok(run.stderr.includes(file), `${file} with ${what}: the message must name the file\n${run.stderr}`);
      assert.match(run.stderr, message);
      assert.ok(!fs.existsSync(out), "a failed build writes no page");
    }
  }
});

test("a marker inside any source fails loudly instead of being replaced, and is named with its file", () => {
  for (const [file, marker] of [
    ["src/explorer.js", "__EXPLORER_SCRIPT__"], ["src/state.js", "__EXPLORER_SCRIPT__"], ["src/encoding.js", "__EXPLORER_SCRIPT__"],
    ["src/explorer.js", "__EXPLORER_STATE__"], ["src/encoding.js", "__EXPLORER_ENCODING__"], ["src/explorer.css", "__EXPLORER_VIEW__"],
    ["src/view.html", "__EXPLORER_DATA__"], ["src/evidence.js", "__EXPLORER_EVIDENCE__"],
  ]) {
    const t = tree();
    t.edit(file, (s) => s + (file.endsWith(".js") ? `\n// ${marker}\n` : file.endsWith(".css") ? `\n/* ${marker} */\n` : `\n<!-- ${marker} -->\n`));
    const run = build(t, "--out", t.file("out/index.html"));
    assert.notEqual(run.status, 0, `${marker} in ${file} must fail`);
    assert.ok(run.stderr.includes(file) && run.stderr.includes(marker), `${file} / ${marker}\n${run.stderr}`);
    assert.ok(!fs.existsSync(t.file("out/index.html")));
  }
});

test("the template must hold every marker exactly once and no marker the build does not fill", () => {
  const cases = [
    ["a marker twice", (s) => s.replace("<title>", "__EXPLORER_ENCODING__<title>"), /Expected exactly one __EXPLORER_ENCODING__ placeholder/],
    ["a marker missing", (s) => s.replace("    <script>__EXPLORER_ENCODING__</script>\n", ""), /Expected exactly one __EXPLORER_ENCODING__ placeholder/],
    ["the state marker missing", (s) => s.replace("__EXPLORER_STATE__", ""), /Expected exactly one __EXPLORER_STATE__ placeholder/],
    ["an unknown marker", (s) => s.replace("<title>", "__EXPLORER_TYPO__<title>"), /names __EXPLORER_TYPO__, which the build does not fill/],
  ];
  for (const [name, edit, message] of cases) {
    const t = tree();
    t.edit("src/document.html", edit);
    const run = build(t, "--out", t.file("out/index.html"));
    assert.notEqual(run.status, 0, name);
    assert.match(run.stderr, message, name);
  }
});

test("a missing source is one clear message, not a traceback", () => {
  const t = tree();
  fs.rmSync(t.file("src/encoding.js"));
  const run = build(t, "--out", t.file("out/index.html"));
  assert.equal(run.status, 1);
  assert.equal(run.stderr.trim(), "src/encoding.js is missing; the page cannot be built without it.");
});

test("the recorded snapshot cannot end the data block: every < in it is escaped", () => {
  const t = tree();
  assert.equal(build(t, "--out", t.file("out/index.html")).status, 0);
  const data = scripts(t.read("out/index.html")).find((e) => e.attrs.includes("origo-lens-data")).body;
  assert.ok(!data.includes("<"), "no raw < inside the JSON block");
});

// ---------------------------------------------------------------------------------------------------
// --out and --check.
test("--out writes the page there, creates the parent directories, and leaves index.html alone", () => {
  const t = tree();
  const run = build(t, "--out", t.file("reports/page/deep/index.html"));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Built index\.html \([\d,]+ bytes\)\.\n$/);
  assert.ok(fs.statSync(t.file("reports/page/deep/index.html")).size > 1e6);
  assert.ok(!fs.existsSync(t.file("index.html")), "the tracked page is not touched");
  // A relative path is relative to where the command runs (the repository root for `npm run build:tmp`).
  const rel = py([path.join(t.dir, "tools/build.py"), "--out", "elsewhere/x/page.html"], { cwd: t.dir });
  assert.equal(rel.status, 0, rel.stderr);
  assert.ok(fs.existsSync(t.file("elsewhere/x/page.html")));
  assert.ok(!fs.existsSync(t.file("index.html")));
});

test("--check keeps its meaning: it compares the page on disk with a fresh build and never writes", () => {
  const t = tree();
  const stale = build(t, "--check");
  assert.equal(stale.status, 1);
  assert.equal(stale.stderr.trim(), "index.html is stale; run python3 tools/build.py");
  assert.ok(!fs.existsSync(t.file("index.html")), "--check writes nothing");
  assert.equal(build(t).status, 0, "the plain build writes index.html (in the copy)");
  const same = build(t, "--check");
  assert.equal(same.status, 0);
  assert.equal(same.stdout.trim(), "index.html matches the source and snapshot.");
  t.edit("src/explorer.js", (s) => s + "\n// changed\n");
  assert.equal(build(t, "--check").status, 1, "a changed source makes the page stale");
  // With --out the page compared is that one.
  assert.equal(build(t, "--out", t.file("o/page.html")).status, 0);
  assert.equal(build(t, "--check", "--out", t.file("o/page.html")).status, 0);
  fs.appendFileSync(t.file("o/page.html"), " ");
  const drift = build(t, "--check", "--out", t.file("o/page.html"));
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /page\.html is stale/);
});

// ---------------------------------------------------------------------------------------------------
// The bridge rewrites the data block of index.html with a regex; the module must not confuse it.
test("the bridge's data-block regex matches once in the page and never in the module", () => {
  const bridge = fs.readFileSync(path.join(ROOT, "tools/cube_bridge.py"), "utf8");
  const literal = bridge.match(/r'(\(<script type="application\/json" id="origo-lens-data">\)\.\*\?\(<\/script>\))'/);
  assert.ok(literal, "tools/cube_bridge.py no longer holds the expected regex; update this test with it");
  const re = new RegExp(literal[1].replace(/\//g, "\\/"), "gs");
  const t = tree();
  assert.equal(build(t, "--out", t.file("out/index.html")).status, 0);
  assert.equal(t.read("out/index.html").match(re).length, 1, "the built page");
  assert.equal(fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(re).length, 1, "the committed page");
  assert.equal(t.read("src/encoding.js").match(re), null, "the module text");
});

// ---------------------------------------------------------------------------------------------------
// The inline copy is the module: needs the real file, so it waits for gate A0.
test("the module inlined in the built page and require() of src/encoding.js are the same module", { todo: HAS_ENCODING ? false : "src/encoding.js is not assembled yet (gate A0)" }, () => {
  if (!HAS_ENCODING) return;
  const t = tree();
  assert.equal(build(t, "--out", t.file("out/index.html")).status, 0);
  const inlineText = scripts(t.read("out/index.html"))[3].body;
  const page = vm.createContext({});
  page.window = page;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "vendor/d3.min.js"), "utf8"), page, { filename: "vendor/d3.min.js" });
  vm.runInContext(inlineText, page, { filename: "inline-encoding.js" });
  const inlined = page.explorerEncoding;
  const required = require(REAL_ENCODING);
  assert.ok(inlined && typeof inlined === "object", "the inline script defines window.explorerEncoding");
  assert.equal(JSON.stringify(Object.keys(inlined).sort()), JSON.stringify(Object.keys(required).sort()));
  assert.equal(inlined.scale.id(inlined.scale.fixed("log2-ratio")), required.scale.id(required.scale.fixed("log2-ratio")));
  for (const theme of ["light", "dark"]) {
    for (const name of ["slate2", "ramp1"]) assert.equal(inlined.lut.build(name, theme).hash, required.lut.build(name, theme).hash, `${name} ${theme}`);
  }
});
