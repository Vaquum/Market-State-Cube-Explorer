"use strict";
// Explicit local feedback selection. CI always runs the full browser inventory.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");

function selectedSpecs(args, root = ROOT) {
  return [...new Set(args.map((arg) => {
    const relative = path.relative(root, path.resolve(root, arg)).split(path.sep).join("/");
    if (!/^tests\/browser\/[a-z0-9-]+\.spec\.js$/.test(relative) || !fs.existsSync(path.join(root, relative))) {
      throw new Error(`Expected an existing tests/browser/<name>.spec.js, got ${JSON.stringify(arg)}`);
    }
    return relative;
  }))];
}

function run(args, { root = ROOT, spawn = spawnSync } = {}) {
  const specs = selectedSpecs(args, root);
  if (!fs.readdirSync(path.join(root, "tests", "unit")).some((file) => file.endsWith(".test.js"))) throw new Error("Unit suite is empty");
  console.log(specs.length ? `Local feedback: all unit tests + ${specs.join(", ")}. Full CI remains required.` : "Local feedback: all unit tests + the full browser suite.");
  const commands = [
    ["--test", "--test-reporter=spec", "tests/unit/**/*.test.js"],
    [path.join(root, "node_modules", "@playwright", "test", "cli.js"), "test", "--config", "tests/browser/playwright.config.js", ...specs],
  ];
  for (const command of commands) {
    const result = spawn(process.execPath, command, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (require.main === module) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { selectedSpecs, run };
