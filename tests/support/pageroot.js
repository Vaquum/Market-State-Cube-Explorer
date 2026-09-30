"use strict";
// tests/support/pageroot.js (H2): which page the browser tests and the fake cube serve (TESTPLAN DD-T24, WORKPLAN 3.9).
//
// resolvePageRoot() returns a directory that holds index.html and vendor/ (what startFake({pageRoot}) serves):
//   1. EXPLORER_PAGE_ROOT, when set: a directory chosen by the caller (`npm run build:tmp` writes reports/page/).
//   2. CONVERGENCE=1: the repository root, i.e. the COMMITTED index.html. This is what CI certifies, and what the merger
//      and the convergence package run; the committed-page check `python3 tools/build.py --check` belongs to their setup.
//   3. otherwise: a temporary build of the working tree (`python3 tools/build.py --out <dir>/index.html` plus vendor/),
//      so parallel worktrees never have to commit the generated 1.3 MB file. The build is made once per process and its
//      directory is removed when the process exits.
// A build that fails (for instance because src/encoding.js does not exist yet) throws with the builder's own message.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The directory must hold index.html and vendor/d3.min.js, or a test would fail later with a 404 nobody can place.
function checked(dir, how) {
  for (const rel of ["index.html", path.join("vendor", "d3.min.js")]) {
    if (!fs.existsSync(path.join(dir, rel))) throw new Error(`${how}: ${path.join(dir, rel)} does not exist`);
  }
  return dir;
}

// buildPageRoot(dir): build the working tree into dir (created if needed) and return it. Never writes the committed index.html.
function buildPageRoot(dir, { repoRoot = REPO_ROOT } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    execFileSync("python3", [path.join(repoRoot, "tools", "build.py"), "--out", path.join(dir, "index.html")], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`building the working tree failed: ${String(error.stderr || error.message).trim()}`);
  }
  fs.cpSync(path.join(repoRoot, "vendor"), path.join(dir, "vendor"), { recursive: true });
  return checked(dir, "build");
}

let built = null; // the temporary build of this process

function resolvePageRoot({ env = process.env, repoRoot = REPO_ROOT } = {}) {
  if (env.EXPLORER_PAGE_ROOT) {
    // Relative to where the command ran (npm scripts run at the root), then to the repository root.
    const given = path.resolve(env.EXPLORER_PAGE_ROOT);
    const dir = fs.existsSync(given) ? given : path.resolve(repoRoot, env.EXPLORER_PAGE_ROOT);
    return checked(dir, "EXPLORER_PAGE_ROOT");
  }
  if (env.CONVERGENCE === "1") return checked(repoRoot, "CONVERGENCE=1 (the committed page)");
  if (!built) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explorer-page-"));
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
    built = buildPageRoot(dir, { repoRoot });
  }
  return built;
}

module.exports = { resolvePageRoot, buildPageRoot, REPO_ROOT };
