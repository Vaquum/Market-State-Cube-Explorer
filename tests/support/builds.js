"use strict";
// tests/support/builds.js (H2): materialise an OLD build of the page from git, for the tests that compare against it
// (rollback, history and shortcut parity B22, read-priority parity B21, the S0 pixel parity spec and the benchmark, DD-T06).
//
//   const { materialise } = require("./builds.js");
//   const { dir, indexSha256, vendorSha256 } = materialise("8c82ca1", "baseline");   // reports/builds/baseline-8c82ca1/
//
// The directory holds index.html, vendor/d3.min.js and vendor/D3-LICENSE exactly as committed at that SHA (never a rebuild), so it
// can be passed to startFake({pageRoot}). reports/ is gitignored. A SHA the clone does not have is refused with the fetch hint; CI
// checks out with fetch-depth: 0.
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FILES = ["index.html", "vendor/d3.min.js", "vendor/D3-LICENSE"];

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// materialise(sha, label, {repoRoot, outRoot}) -> {dir, sha, indexSha256, vendorSha256}. sha may be abbreviated; the directory carries its
// first seven characters. Re-running for the same sha and label rewrites the same directory with the same bytes.
function materialise(sha, label, { repoRoot = REPO_ROOT, outRoot = path.join(repoRoot, "reports", "builds") } = {}) {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) throw new RangeError(`materialise: ${JSON.stringify(sha)} is not a commit id`);
  if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new RangeError(`materialise: label ${JSON.stringify(label)} must be a plain file name`);
  const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  let full;
  try {
    full = git("rev-parse", "--verify", "--quiet", `${sha}^{commit}`).toString("utf8").trim();
  } catch {
    throw new Error(`commit ${sha} is not in this clone; fetch it with: git fetch --no-tags --depth=1 origin ${sha}`);
  }
  const dir = path.join(outRoot, `${label}-${full.slice(0, 7)}`);
  for (const rel of FILES) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git("show", `${full}:${rel}`));
  }
  return {
    dir, sha: full,
    indexSha256: sha256(fs.readFileSync(path.join(dir, "index.html"))),
    vendorSha256: sha256(fs.readFileSync(path.join(dir, "vendor", "d3.min.js"))),
  };
}

module.exports = { materialise, FILES };
