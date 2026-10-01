"use strict";
// U01 repo.test.js (H1): hygiene of the repository itself, with no dependency on src/encoding.js.
// Oracle: the text of the committed files, parsed line by line (no YAML or JSON5 parser exists here by
// design), node:crypto for the d3 hash, and, for tests/support/rng.js, an independent BigInt
// implementation of mulberry32 written from the published algorithm with explicit 32-bit masks.
// It asserts what the deploy, the image and the test tooling rely on:
//   - package.json is dev tooling only (private, no dependencies, no "type", one exact devDependency)
//   - the lockfile holds exactly that dependency's three packages, all at one version
//   - vendor/d3.min.js is the pinned file
//   - the Dockerfile copies exactly the files the bridge and the page need
//   - the output directories are ignored
//   - every fixture directory says where its data came from
//   - the unit directory holds test files only, and at least one
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

// Lines of a text file with blanks and comments removed.
const rules = (rel) => read(rel).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

// Every file under a directory, as repository-relative paths with forward slashes.
function walk(rel) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

const D3_SHA256 = "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539";

describe("package.json", () => {
  const pkg = readJson("package.json");

  it("is private development tooling with no runtime dependencies", () => {
    assert.equal(pkg.private, true);
    assert.equal("dependencies" in pkg, false, "the explorer has no production dependency");
    assert.equal("type" in pkg, false, "no \"type\": CommonJS resolution of vendor/d3.min.js and src/encoding.js depends on it");
  });

  it("requires Node 22 or newer", () => {
    assert.match(pkg.engines.node, /^>=22(\.\d+){0,2}$/);
  });

  it("has exactly one devDependency, pinned to an exact version", () => {
    const names = Object.keys(pkg.devDependencies);
    assert.deepEqual(names, ["@playwright/test"]);
    assert.match(pkg.devDependencies["@playwright/test"], /^\d+\.\d+\.\d+$/, "no range, no tag");
  });

  it("names the test entry points the workflows and the README use", () => {
    assert.match(pkg.scripts.test, /^node --test /);
    assert.match(pkg.scripts.test, /"tests\/unit\/\*\*\/\*\.test\.js"/, "the glob is quoted: a directory argument fails on Node 22");
    assert.ok(pkg.scripts["test:browser"], "test:browser");
    assert.ok(pkg.scripts["build:tmp"], "build:tmp");
  });
});

describe("package-lock.json", () => {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");

  it("holds the root and the three Playwright packages, all at the pinned version", () => {
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(Object.keys(lock.packages).sort(), [
      "",
      "node_modules/@playwright/test",
      "node_modules/playwright",
      "node_modules/playwright-core",
    ]);
    const pinned = pkg.devDependencies["@playwright/test"];
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (name === "") continue;
      assert.equal(entry.version, pinned, name);
      assert.match(entry.integrity, /^sha512-/, `${name} has an integrity hash`);
      assert.ok(entry.resolved.startsWith("https://registry.npmjs.org/"), `${name} resolves from the npm registry`);
    }
  });

  it("agrees with package.json about the root", () => {
    const root = lock.packages[""];
    assert.deepEqual(root.devDependencies, pkg.devDependencies);
    assert.equal("dependencies" in root, false);
  });
});

describe("vendored d3", () => {
  it("is the pinned file", () => {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "vendor/d3.min.js"))).digest("hex");
    assert.equal(hash, D3_SHA256);
  });
});

describe("image contents", () => {
  // Dockerfile: every source of a COPY line (all arguments but the last, which is the destination).
  const copied = read("Dockerfile")
    .split("\n")
    .filter((l) => /^COPY\s/.test(l))
    .flatMap((l) => l.trim().split(/\s+/).slice(1, -1))
    .sort();

  it("the Dockerfile copies exactly the files the bridge and the page need", () => {
    assert.deepEqual(copied, ["index.html", "tools/cube_bridge.py", "tools/market_state_reader.py", "vendor/"]);
  });
});

describe(".gitignore", () => {
  it("ignores every test and benchmark output directory, dependencies and secrets", () => {
    const lines = new Set(rules(".gitignore"));
    for (const entry of ["test-results/", "playwright-report/", "blob-report/", "reports/", ".playwright-mcp/", "node_modules/", ".env"]) {
      assert.ok(lines.has(entry), entry);
    }
  });
});

describe("fixtures", () => {
  const KINDS = ["recorded", "synthetic", "grammar-derived", "published", "hand-computed"];
  const SOURCES = ["hand-computed", "reference-calculator", "python-stdlib", "baseline-8c82ca1", "published-table", "self-pin"];
  const FIXTURES = "tests/fixtures";
  const files = fs.existsSync(path.join(ROOT, FIXTURES)) ? walk(FIXTURES) : [];
  const provenance = files.filter((f) => f.endsWith("/provenance.json"));

  // A directory that holds fixtures: each top-level one, and each regressions/<id>/ on its own.
  const top = fs.existsSync(path.join(ROOT, FIXTURES))
    ? fs.readdirSync(path.join(ROOT, FIXTURES), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  const owners = top.flatMap((name) =>
    name === "regressions"
      ? fs.readdirSync(path.join(ROOT, FIXTURES, name), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${FIXTURES}/${name}/${e.name}`)
      : [`${FIXTURES}/${name}`]
  );

  it("every fixture directory carries a provenance.json", () => {
    for (const dir of owners) assert.ok(provenance.includes(`${dir}/provenance.json`), `${dir}/provenance.json is missing`);
  });

  it("every provenance.json is valid and none names the generator as its expectation source", () => {
    for (const file of provenance) {
      const p = readJson(file);
      assert.deepEqual(Object.keys(p).sort(), ["expectationSource", "extractedOn", "generator", "kind", "notes", "seed", "source"], file);
      assert.ok(KINDS.includes(p.kind), `${file}: kind ${p.kind}`);
      assert.notEqual(p.expectationSource, "generator", `${file}: a generator cannot be its own oracle`);
      assert.ok(SOURCES.includes(p.expectationSource), `${file}: expectationSource ${p.expectationSource}`);
      assert.ok(p.generator === null || (typeof p.generator === "string" && p.generator.length > 0), `${file}: generator`);
      assert.ok(p.seed === null || Number.isInteger(p.seed), `${file}: seed`);
      assert.ok(typeof p.source === "string" && p.source.trim().length > 0, `${file}: source`);
      assert.ok(p.extractedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(p.extractedOn), `${file}: extractedOn`);
      assert.equal(typeof p.notes, "string", `${file}: notes`);
    }
  });

  it("self-pin is used only for the generated profiles' determinism pins", () => {
    for (const file of provenance) {
      if (readJson(file).expectationSource === "self-pin") assert.ok(file.startsWith(`${FIXTURES}/profiles/`), file);
    }
  });

  it("all fixtures together stay under 5 MiB", () => {
    const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(ROOT, f)).size, 0);
    assert.ok(bytes <= 5 * 1024 * 1024, `${bytes} bytes`);
  });
});

describe("tests/unit", () => {
  it("holds test files only, and at least one", () => {
    const files = walk("tests/unit");
    assert.ok(files.length >= 1);
    for (const f of files) assert.ok(f.endsWith(".test.js"), `${f}: only *.test.js files run under the quoted glob`);
  });
});

describe("tests/support/rng.js", () => {
  const rng = require("../support/rng.js");

  // Independent oracle: mulberry32 on BigInt with explicit masks (no Math.imul, no >>> tricks).
  function oracle(seed) {
    const M = 0xffffffffn;
    const mul = (x, y) => (x * y) & M;
    let a = BigInt(seed) & M;
    return () => {
      a = (a + 0x6d2b79f5n) & M;
      let t = a;
      t = mul(t ^ (t >> 15n), t | 1n);
      t = (t ^ ((t + mul(t ^ (t >> 7n), t | 61n)) & M)) & M;
      return Number((t ^ (t >> 14n)) & M) / 4294967296;
    };
  }

  it("mulberry32 matches the independent implementation for 1,000 draws", () => {
    for (const seed of [0, 1, 42, 20260930, 0xffffffff]) {
      const a = rng.mulberry32(seed);
      const b = oracle(seed);
      for (let i = 0; i < 1000; i++) assert.equal(a(), b(), `seed ${seed} draw ${i}`);
    }
  });

  it("draws lie in [0, 1) and the same seed gives the same stream", () => {
    const a = rng.mulberry32(7);
    const b = rng.mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      assert.ok(x >= 0 && x < 1);
      assert.equal(x, b());
    }
    assert.notEqual(rng.mulberry32(7)(), rng.mulberry32(8)());
    assert.equal(rng.mulberry32(1.9)(), rng.mulberry32(1)(), "the seed is an unsigned 32-bit integer");
    assert.equal(rng.mulberry32(2 ** 32 + 1)(), rng.mulberry32(1)());
  });

  it("int covers both ends and never leaves them", () => {
    const next = rng.mulberry32(3);
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(rng.int(next, -2, 2));
    assert.deepEqual([...seen].sort((x, y) => x - y), [-2, -1, 0, 1, 2]);
    assert.throws(() => rng.int(next, 3, 2), RangeError);
    assert.throws(() => rng.int(next, 0.5, 2), RangeError);
  });

  it("shuffle returns a permutation and leaves its input alone; pick stays inside the list", () => {
    const next = rng.mulberry32(11);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(next, input);
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual([...out].sort((x, y) => x - y), input);
    for (let i = 0; i < 50; i++) assert.ok(input.includes(rng.pick(next, input)));
    assert.throws(() => rng.pick(next, []), RangeError);
  });

  it("normal has the requested mean and spread within sampling error", () => {
    const next = rng.mulberry32(5);
    const n = 20000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const x = rng.normal(next, 10, 2);
      sum += x;
      sq += x * x;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sq / n - mean * mean);
    assert.ok(Math.abs(mean - 10) < 0.1, `mean ${mean}`);
    assert.ok(Math.abs(sd - 2) < 0.1, `sd ${sd}`);
  });

  it("subSeed is stable, 32-bit, and differs by label and by parent seed", () => {
    const a = rng.subSeed(1, "trades");
    assert.equal(a, rng.subSeed(1, "trades"));
    assert.ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff);
    assert.notEqual(a, rng.subSeed(1, "jitter"));
    assert.notEqual(a, rng.subSeed(2, "trades"));
  });
});
