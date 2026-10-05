"use strict";
// Independent committed counts/budgets, exact UTF-8 length and a manually driven DOM frame clock.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto"), os = require("node:os");
const { execFileSync } = require("node:child_process");
const { materialise } = require("../support/builds.js");
const root = path.resolve(__dirname, "../.."), load = (name) => import(path.join(root, "tools/benchmark", name));
const config = (version) => JSON.parse(fs.readFileSync(path.join(root, `tools/benchmark/navigation.v${version}.json`), "utf8"));
test("v4 preserves all pinned v3 navigation inputs and adds declared DOM comparison diagnostics", async () => {
  const before = config(3), after = config(4), { validateConfig } = await load("schema.mjs");
  for (const [key, value] of Object.entries(before)) if (!["schemaVersion", "note"].includes(key)) assert.deepEqual(after[key], value, key);
  assert.deepEqual(validateConfig(after), []);
  assert.deepEqual(after.comparison.counts, [0, 32, 128]);
  assert.deepEqual(after.comparison.actions, ["focus", "sort", "matrix", "expand"]);
  assert.deepEqual(after.comparison.budgets, { p95ActionToVisibleMs: 50, maxMountedEntries: 24 });
  const invalid = JSON.parse(JSON.stringify(after)); invalid.comparison.budgets.maxMountedEntries = 32;
  assert.ok(validateConfig(invalid).some((reason) => reason.includes("24-entry")));
  invalid.comparison.nearLimitBytes = 4194304;
  assert.ok(validateConfig(invalid).some((reason) => reason.includes("4 MiB")));
});
test("CLI smoke keeps legacy baseline defaults but comparison configs select HEAD", async () => {
  const { parseArgs, candidateReference } = await import(path.join(root, "tools/benchmark_navigation.mjs"));
  const baseline = "59d42696d3708f93bf46e6c1691a64eabb2d5fd5";
  for (const version of [1, 2, 3, 4]) {
    const args = parseArgs(["--config", `tools/benchmark/navigation.v${version}.json`, "--smoke"]);
    assert.equal(candidateReference(args, config(version), baseline), version === 4 ? "HEAD" : baseline);
    assert.equal(candidateReference({ ...args, smoke: false }, config(version), baseline), "HEAD");
    for (const candidate of [baseline, "HEAD", "working"]) assert.equal(candidateReference({ ...args, candidate }, config(version), baseline), candidate);
  }
});
test("default v4 smoke resolves to the exact committed HEAD page with the Compare surface", async () => {
  const { parseArgs, candidateReference, requireComparisonSurface } = await import(path.join(root, "tools/benchmark_navigation.mjs"));
  const args = parseArgs(["--config", "tools/benchmark/navigation.v4.json", "--smoke"]);
  const ref = candidateReference(args, config(4), "59d42696d3708f93bf46e6c1691a64eabb2d5fd5");
  const git = (...argv) => execFileSync("git", ["-C", root, ...argv], { maxBuffer: 64 * 1024 * 1024 });
  const sha = git("rev-parse", "--verify", `${ref}^{commit}`).toString("utf8").trim();
  assert.equal(sha, git("rev-parse", "HEAD").toString("utf8").trim());
  const build = materialise(sha, "unit-comparison-smoke-head");
  assert.equal(build.indexSha256, crypto.createHash("sha256").update(git("show", `${sha}:index.html`)).digest("hex"));
  assert.doesNotThrow(() => requireComparisonSurface(build));
});
test("an explicit pre-Compare candidate rejects the DOM phase without browser dependencies or fetched history", async () => {
  const { parseArgs, candidateReference } = await import(path.join(root, "tools/benchmark_navigation.mjs"));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "comparison-cli-"));
  try {
    // A real independent commit keeps this CLI regression usable in the dependency-free, shallow CI Node job.
    for (const rel of ["tools/benchmark", "tests/support"]) fs.cpSync(path.join(root, rel), path.join(fixture, rel), { recursive: true });
    fs.copyFileSync(path.join(root, "tools/benchmark_navigation.mjs"), path.join(fixture, "tools/benchmark_navigation.mjs"));
    fs.mkdirSync(path.join(fixture, "vendor"));
    fs.writeFileSync(path.join(fixture, "index.html"), "<!doctype html><title>Before Compare</title>\n");
    for (const file of ["d3.min.js", "D3-LICENSE"]) fs.writeFileSync(path.join(fixture, "vendor", file), "fixture\n");
    const git = (...argv) => execFileSync("git", ["-C", fixture, ...argv], { encoding: "utf8", stdio: "pipe" });
    git("init", "--quiet"); git("add", "index.html", "vendor");
    git("-c", "user.name=CLI fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Before Compare");
    const old = git("rev-parse", "HEAD").trim(), configPath = path.join(fixture, "tools/benchmark/navigation.v4.json");
    const args = parseArgs(["--config", configPath, "--comparison-only", "--candidate", old]);
    assert.equal(candidateReference(args, config(4), old), old);
    assert.equal(fs.existsSync(path.join(fixture, "node_modules")), false);
    for (const phase of ["--comparison-only", "--smoke"]) assert.throws(() => execFileSync(process.execPath, [path.join(fixture, "tools/benchmark_navigation.mjs"), "--config", configPath, phase, "--baseline", old, "--candidate", old], { encoding: "utf8", timeout: 5000, stdio: "pipe" }), (error) => error.status === 1 && error.stderr.includes(`Comparison diagnostics unsupported for candidate ${old}: required Compare surface missing`) && /no DOM samples were measured/.test(error.stderr));
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
test("benchmark captures are independent typed facts with exact near-cap bytes in off-page detail", async () => {
  const { comparisonFixture } = await load("comparison.mjs");
  for (const count of [0, 32, 128]) {
    const record = comparisonFixture(count); assert.equal(record.captures.length, count);
    assert.equal(new Set(record.captures.map((capture) => capture.id)).size, count);
    if (count) {
      assert.equal(record.captures[0].metrics["volume.amount"].value, 1);
      assert.equal(record.captures.at(-1).metrics["volume.amount"].value, count);
      assert.equal(record.captures.at(-1).metrics["volume.intensity"].value, count * 60 / 56.25);
    }
  }
  const target = config(4).comparison.nearLimitBytes, record = comparisonFixture(128, target);
  assert.equal(Buffer.byteLength(JSON.stringify(record), "utf8"), target);
  assert.equal(record.captures[0].detail.length, 1);
  assert.equal(record.captures.at(-1).detail.length, 2);
  assert.ok(target < 4 * 1024 * 1024 && target >= 4 * 1024 * 1024 - 8192);
});
test("comparison input completes on its DOM render plus two frames without a canvas draw", () => {
  const listeners = {}, queue = [], clock = { now: 0 }, data = { stats: "3", writes: "1", bytes: "100", renders: "2" };
  class Canvas {}
  for (const property of ["width", "height"]) Object.defineProperty(Canvas.prototype, property, { configurable: true, get() { return 0; }, set() {} });
  const window = { requestAnimationFrame(fn) { queue.push(fn); }, addEventListener(type, fn) { (listeners[type] ??= []).push(fn); } };
  const document = { getElementById() { return { dataset: data }; }, querySelectorAll() { return { length: 24 }; }, querySelector() { return { textContent: "Rank 128 of 128" }; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "tools/benchmark/instrument.js"), "utf8"), { window, document, performance: { now: () => clock.now }, HTMLCanvasElement: Canvas });
  const fire = (type, event = {}) => { for (const listener of listeners[type] || []) listener(event); }, flush = (at) => { clock.now = at; for (const callback of queue.splice(0)) callback(at); };
  window.__bench.begin(); window.__bench.armComparison();
  fire("click", { timeStamp: 10, target: { closest() { return {}; } } });
  data.stats = "3"; data.writes = "2"; data.bytes = "500"; data.renders = "4";
  fire("comparison-render"); flush(20);
  assert.equal(window.__bench.comparisonResult(), null);
  flush(40);
  assert.deepEqual(JSON.parse(JSON.stringify(window.__bench.comparisonResult())), { actionToVisibleMs: 30, stats: 0, writes: 1, bytes: 400, renders: 2, mounted: 24, cohort: "Rank 128 of 128" });
  assert.deepEqual(Array.from(window.__bench.end().draws), []);
});
test("diagnostic summary reports observed p95 and counter arrays without a precision verdict", async () => {
  const { comparisonSummary } = await load("comparison.mjs");
  const summary = comparisonSummary([10, 20, 80].map((actionToVisibleMs) => ({ case: "comparison-128", action: "focus", actionToVisibleMs, mounted: 24, stats: 0, writes: 1, bytes: 128 })), { p95ActionToVisibleMs: 50, maxMountedEntries: 24 });
  assert.equal(summary[0].p95ActionToVisibleMs, 80); assert.equal(summary[0].meetsDeclaredBudget, false);
  assert.deepEqual(summary[0].stats, [0, 0, 0]); assert.deepEqual(summary[0].writes, [1, 1, 1]);
});
