"use strict";
// U42 workflows.test.js (H10): line-level guards on the two workflows, in the repository's own words.
// Oracle: the literal text of .github/workflows/*.yml read line by line (no YAML parser exists here by design,
// TESTPLAN DD-T13), checked against three independent facts that nothing in this file computes from the
// workflows: package.json (the npm scripts they call), the Dockerfile (the numpy pin and the file list of the
// image) and the file system (every repository path they name). Every rule is also shown to bite: a table of
// mutated copies of the real text, each of which must be refused with a message that names the rule.
//
// What this file does NOT prove: that GitHub honours the wiring. A failing check skipping the deploy, a newer
// pending run replacing an older one, `[skip ci]`, the called workflow's github context and any branch
// protection are GitHub's behaviour; they are proved only by the throwaway-repository run of docs/testing.md
// and TESTPLAN 6.6, which nobody has executed from this repository.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// ---- a line-level reader for the subset of YAML these two files use (block style, two-space indent) ----

const indentOf = (line) => line.length - line.trimStart().length;
// Whole-line comments are dropped so that a comment which explains a rule ("never cancel-in-progress") is not
// mistaken for the thing it forbids. A trailing comment never occurs in these files.
const code = (text) => text.split("\n").filter((line) => !/^\s*#/.test(line));

// The lines nested under lines[i], blanks included, up to the first line that is not deeper.
function under(lines, i) {
  const base = indentOf(lines[i]);
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() && indentOf(lines[j]) <= base) break;
    out.push(lines[j]);
  }
  return out;
}

// The body of a top-level key, or null.
function section(lines, key) {
  const i = lines.findIndex((line) => indentOf(line) === 0 && line.startsWith(`${key}:`));
  return i < 0 ? null : under(lines, i);
}

// {id: lines} for the children of `jobs:`.
function jobsOf(lines) {
  const body = section(lines, "jobs") ?? [];
  const jobs = {};
  body.forEach((line, i) => {
    const m = /^ {2}([\w-]+):\s*$/.exec(line);
    if (m) jobs[m[1]] = under(body, i);
  });
  return jobs;
}

// A job's steps, each as its own array of lines (the list sits at six spaces in both files).
function stepsOf(jobLines) {
  const i = jobLines.findIndex((line) => line === "    steps:");
  if (i < 0) return [];
  const steps = [];
  for (const line of under(jobLines, i)) {
    if (/^ {6}- /.test(line)) steps.push([line]);
    else if (steps.length) steps[steps.length - 1].push(line);
  }
  return steps;
}

// A step's first line starts with "- ", which is not part of the key it carries.
const has = (lines, exact) => lines.some((line) => line.trim().replace(/^- /, "") === exact);
const hasMatch = (lines, re) => lines.some((line) => re.test(line));
const stepText = (step) => step.join("\n");
// The step's lines with the list dash blanked, so that a key on the dash line sits at the same indent as the others.
const keysOf = (step) => step.map((line, i) => (i === 0 ? line.replace("- ", "  ") : line));
const conditionOf = (step) => keysOf(step).find((line) => /^ {8}if:/.test(line));

// The facts the rules compare against, read from the real repository.
function realFacts() {
  const dockerfile = read("Dockerfile");
  const copy = [...dockerfile.matchAll(/^COPY (.+)$/gm)].map((m) => m[1].trim().split(/\s+/));
  const image = [];
  for (const args of copy) {
    const dest = args.pop();
    for (const src of args) {
      if (src.endsWith("/")) {
        const walk = (rel) => fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })
          .flatMap((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : [`${rel}/${e.name}`]));
        image.push(...walk(src.slice(0, -1)).map((f) => path.posix.join("/app", f)));
      } else image.push(path.posix.join("/app", dest.endsWith("/") ? path.posix.join(dest, path.basename(src)) : dest));
    }
  }
  return {
    scripts: new Set(Object.keys(JSON.parse(read("package.json")).scripts)),
    numpy: /numpy==([\d.]+)/.exec(dockerfile)[1],
    image: image.sort(),
    exists,
  };
}

// Problems common to both files: the commands they run must exist, and nothing may undo the allowlist.
function commonProblems(label, lines, facts) {
  const problems = [];
  const text = lines.join("\n");
  for (const m of text.matchAll(/npm run ([\w:-]+)/g)) {
    if (!facts.scripts.has(m[1])) problems.push(`${label}: \`npm run ${m[1]}\` is not a script of package.json`);
  }
  for (const m of text.matchAll(/(?:^|[\s'"])((?:tools|tests|src|\.github)\/[\w./-]+\.(?:py|js|mjs|filter|yml))/g)) {
    if (!facts.exists(m[1])) problems.push(`${label}: ${m[1]} is named here and does not exist`);
  }
  if (/--delete-excluded/.test(text)) problems.push(`${label}: --delete-excluded would delete the host's .env`);
  if (/\bcontinue-on-error\b/.test(text)) problems.push(`${label}: continue-on-error lets a red step pass`);
  if (/pull_request_target/.test(text)) problems.push(`${label}: pull_request_target runs with secrets on a pull request`);
  for (const m of text.matchAll(/uses:\s*(\S+)/g)) {
    if (!m[1].startsWith("./") && !/@v?\d/.test(m[1])) problems.push(`${label}: ${m[1]} is not pinned to a version`);
  }
  return problems;
}

// ---- check.yml ----

const JOBS = ["static", "unit", "browser", "bridge"];

function checkProblems(text, facts) {
  const lines = code(text);
  const problems = commonProblems("check.yml", lines, facts);
  const add = (message) => problems.push(`check.yml: ${message}`);

  // Top level: a caller-owned concurrency group would deadlock or cancel the deploy that calls this file.
  const topKeys = lines.filter((line) => line.trim() && indentOf(line) === 0).map((line) => line.split(":")[0]);
  assert.ok(topKeys.length, "check.yml has content");
  if (topKeys.join(",") !== "name,on,permissions,jobs") add(`top-level keys are ${topKeys.join(",")}, expected name,on,permissions,jobs (no concurrency here)`);
  if (/^\s*concurrency:/m.test(lines.join("\n"))) add("concurrency is forbidden (a group derived from the caller's deadlocks or cancels the caller)");
  if (!has(section(lines, "permissions") ?? [], "contents: read")) add("permissions must be contents: read");
  if ((section(lines, "permissions") ?? []).filter((l) => l.trim()).length !== 1) add("permissions holds more than contents: read");
  if (/secrets\.|vars\.DEPLOY/.test(lines.join("\n"))) add("a check runs on pull requests and must not touch deploy secrets or variables");

  // Triggers and the sha output that deploy.yml compares with GITHUB_SHA.
  const on = section(lines, "on") ?? [];
  for (const trigger of ["push:", "pull_request:", "workflow_call:"]) if (!has(on, trigger)) add(`on: is missing ${trigger.slice(0, -1)}`);
  if (!has(on, "sha:") || !has(on, "value: ${{ jobs.static.outputs.sha }}")) add("workflow_call must output sha from jobs.static.outputs.sha");

  const jobs = jobsOf(lines);
  if (Object.keys(jobs).sort().join(",") !== [...JOBS].sort().join(",")) add(`jobs are ${Object.keys(jobs).join(",")}, expected ${JOBS.join(",")}`);
  for (const [id, job] of Object.entries(jobs)) {
    const own = job.filter((line) => indentOf(line) === 4 || indentOf(line) === 2);
    if (!has(own, "runs-on: ubuntu-24.04")) add(`job ${id}: runs-on must be ubuntu-24.04 (the runner image moves under ubuntu-latest)`);
    // A hung job would hold the deploy-main group, so every job has a bound.
    const timeout = own.map((line) => /^ {4}timeout-minutes: (\d+)$/.exec(line)).find(Boolean);
    if (!timeout || Number(timeout[1]) < 1 || Number(timeout[1]) > 30) add(`job ${id}: timeout-minutes must be 1 to 30`);
    // A skipped job must not be able to count as a pass, so no job is conditional.
    if (own.some((line) => /^ {4}if:/.test(line))) add(`job ${id}: a job-level if lets the job be skipped`);

    const steps = stepsOf(job);
    const checkouts = steps.filter((step) => /uses: actions\/checkout@/.test(stepText(step)));
    if (checkouts.length !== 1 || !/actions\/checkout@/.test(steps[0]?.[0] ?? "")) add(`job ${id}: the first step must be the only checkout`);
    for (const step of checkouts) {
      if (!has(step, "ref: ${{ github.sha }}")) add(`job ${id}: checkout must name ref: \${{ github.sha }}`);
      if (!has(step, "persist-credentials: false")) add(`job ${id}: checkout must not persist credentials`);
    }
    const proof = id === "static" ? steps.find((step) => has(step, "id: commit")) : steps[1];
    if (!proof || !stepText(proof).includes('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"')) add(`job ${id}: the checkout is not followed by the proof that HEAD is GITHUB_SHA`);
    for (const step of steps) {
      const ifLine = conditionOf(step);
      if (ifLine && ifLine.trim() !== "if: ${{ !cancelled() }}") add(`job ${id}: only upload steps may carry a condition, and only !cancelled() (${ifLine.trim()})`);
      if (ifLine && !/upload-artifact@/.test(stepText(step))) add(`job ${id}: a step that is not an upload carries a condition`);
    }
  }

  // static: the sha output, the build check that gates deploy, the syntax loop, the goldens, the image, the payload.
  const staticJob = jobs.static ?? [];
  const staticSteps = stepsOf(staticJob);
  if (!has(staticJob, "sha: ${{ steps.commit.outputs.sha }}")) add("static must publish outputs.sha from the commit step");
  if (!staticSteps.some((step) => stepText(step).includes('echo "sha=$GITHUB_SHA" >> "$GITHUB_OUTPUT"'))) add("the commit step must write sha=$GITHUB_SHA to GITHUB_OUTPUT");
  const plain = (needle) => staticSteps.some((step) => stepText(step).includes(needle) && !conditionOf(step));
  if (!plain("- run: python3 tools/build.py --check")) add("static must run python3 tools/build.py --check unconditionally (it is the deploy gate)");
  const loop = staticSteps.map(stepText).find((s) => s.includes("xargs -r -n1 node --check")) ?? "";
  if (!loop) add("static must syntax-check the JavaScript with a node --check loop");
  if (loop && !loop.includes("grep -v '^tests/fixtures/'")) add("the node --check loop must exclude tests/fixtures/");
  if (loop && exists("tools/encoding-parts") && !loop.includes("grep -v '^tools/encoding-parts/'")) add("the node --check loop must exclude tools/encoding-parts/ while the parts exist");
  if (!plain("python3 -m py_compile tools/cube_bridge.py tools/market_state_reader.py tools/build.py")) add("static must py_compile the three Python tools");
  if (!plain("npm run golden:check")) add("static must run npm run golden:check");
  if (/golden:write/.test(text)) add("a check must never run golden:write (a mismatch is a failure, not something to regenerate)");
  if (!plain("docker compose config -q")) add("static must validate docker-compose.yml");
  const image = staticSteps.map(stepText).find((s) => s.includes("docker build -t cube-explorer:check .")) ?? "";
  if (!image) add("static must build the image");
  const listed = /printf '%s\\n' (.+?) \| diff -u/.exec(image);
  if (image && (!listed || listed[1].split(" ").sort().join("\n") !== facts.image.join("\n"))) add(`the image file list is ${listed ? listed[1] : "missing"}, the Dockerfile copies ${facts.image.join(" ")}`);
  const payload = staticSteps.map(stepText).find((s) => s.includes("--filter='merge .github/deploy.filter'")) ?? "";
  if (!payload || !/\$1 > 4096/.test(payload)) add("static must size the deploy payload with the deploy filter and a 4096 KiB budget");

  // unit: a glob that matches no file passes, so the suite must be shown to be non-empty.
  const unit = (jobs.unit ?? []).join("\n");
  if (!unit.includes("test \"$(git ls-files 'tests/unit/*.test.js' | wc -l)\" -gt 0")) add("unit must fail when no unit test file exists");
  if (!unit.includes("run: npm run test:ci")) add("unit must run npm run test:ci");
  if (!unit.includes("actions/setup-python@") || !unit.includes("node-version: '22'")) add("unit needs python3 (the build test) and Node 22");

  // browser: history for the baseline builds, the lockfile's browser, the committed page, no timing gate.
  const browser = jobs.browser ?? [];
  const bt = browser.join("\n");
  if (!/^ {10}fetch-depth: 0$/m.test(bt)) add("browser must check out with fetch-depth: 0 (the original page is built from git history)");
  const ci = bt.indexOf("npm ci --ignore-scripts --no-audit --no-fund");
  const pw = bt.indexOf("npx playwright install --with-deps --only-shell chromium");
  const run = bt.indexOf("npm run test:browser");
  if (!(ci >= 0 && pw > ci && run > pw)) add("browser must run npm ci, then playwright install, then npm run test:browser, in that order");
  if (/playwright(@latest| install[^\n]*@latest)/.test(bt)) add("the browser must come from the lockfile, never @latest");
  const testStep = stepsOf(browser).find((step) => stepText(step).includes("npm run test:browser"));
  if (!testStep || !has(testStep, "CONVERGENCE: '1'")) add("npm run test:browser must run with CONVERGENCE: '1' (it serves the committed index.html)");
  if (!bt.includes("run: npm run benchmark:smoke")) add("browser must run benchmark:smoke (tool and report only)");
  if (/npm run benchmark(\s|$)/.test(bt)) add("the full benchmark is an operator procedure and must not run in CI");

  // bridge: the functions the image runs, with the image's numpy.
  const bridge = (jobs.bridge ?? []).join("\n");
  if (!bridge.includes(`pip install --no-cache-dir numpy==${facts.numpy}`)) add(`bridge must install numpy==${facts.numpy}, the Dockerfile pin`);
  if (!bridge.includes("python3 tests/reference/bridge_crosscheck.py --require-numpy")) add("bridge must run bridge_crosscheck.py with --require-numpy (a missing numpy would skip it)");
  return problems;
}

// ---- deploy.yml ----

function deployProblems(text, facts) {
  const lines = code(text);
  const problems = commonProblems("deploy.yml", lines, facts);
  const add = (message) => problems.push(`deploy.yml: ${message}`);
  const all = lines.join("\n");

  const topKeys = lines.filter((line) => line.trim() && indentOf(line) === 0).map((line) => line.split(":")[0]);
  if (topKeys.join(",") !== "name,on,concurrency,permissions,jobs") add(`top-level keys are ${topKeys.join(",")}, expected name,on,concurrency,permissions,jobs`);

  // One trigger and no way to start a deploy by hand: there is no bypass path (DR-23).
  const on = (section(lines, "on") ?? []).map((l) => l.trim()).filter(Boolean);
  if (on.join("|") !== "push:|branches: [main]") add(`on: is ${on.join(" ")}, expected only push on main`);
  for (const word of ["workflow_dispatch", "workflow_run", "repository_dispatch", "schedule", "inputs:"]) {
    if (all.includes(word)) add(`${word} is a way to deploy without the checks`);
  }

  // Serialised at workflow level and never cancelled: a cancelled rsync or compose leaves the host half updated.
  const conc = (section(lines, "concurrency") ?? []).map((l) => l.trim()).filter(Boolean);
  if (conc.join("|") !== "group: deploy-main") add(`concurrency is ${conc.join(" ")}, expected only group: deploy-main at workflow level`);
  if (/cancel-in-progress/.test(all)) add("cancel-in-progress must not appear");
  const perms = (section(lines, "permissions") ?? []).map((l) => l.trim()).filter(Boolean);
  if (perms.join("|") !== "contents: read") add(`permissions are ${perms.join(" ")}, expected only contents: read`);

  // The gate: a called workflow, a dependency and an explicit success condition with nothing that overrides it.
  const jobs = jobsOf(lines);
  if (Object.keys(jobs).join(",") !== "check,deploy") add(`jobs are ${Object.keys(jobs).join(",")}, expected check,deploy`);
  const checkJob = (jobs.check ?? []).map((l) => l.trim()).filter(Boolean);
  if (checkJob.filter((l) => l.startsWith("uses:")).join("") !== "uses: ./.github/workflows/check.yml") add("job check must be uses: ./.github/workflows/check.yml (the same commit, not a lookup by branch)");
  if (checkJob.some((l) => /^(if|with|secrets|needs):/.test(l))) add("job check takes no condition, input, secret or dependency");
  const deploy = jobs.deploy ?? [];
  if (!has(deploy.filter((l) => indentOf(l) === 4), "needs: check")) add("job deploy must have needs: check");
  const jobIfs = deploy.filter((l) => /^ {4}if:/.test(l)).map((l) => l.trim());
  if (jobIfs.join("|") !== "if: ${{ needs.check.result == 'success' }}") add(`job deploy's condition is ${jobIfs.join(" ") || "missing"}, expected if: \${{ needs.check.result == 'success' }}`);
  if (/\b(always|cancelled|failure)\(\)/.test(all)) add("always(), cancelled() and failure() would let deploy run after a failed or cancelled check");
  if (/^ {4}if:/m.test((jobs.check ?? []).join("\n"))) add("job check must not be conditional");

  // The attestation: the job is about to send GITHUB_SHA, and the checks must have reported exactly that.
  const steps = stepsOf(deploy);
  const at = steps.findIndex((step) => stepText(step).includes('test "$CHECKED" = "$GITHUB_SHA"'));
  if (!steps[0] || !/uses: actions\/checkout@/.test(stepText(steps[0])) || !has(steps[0], "ref: ${{ github.sha }}") || !has(steps[0], "persist-credentials: false")) add("the first deploy step must be checkout of ref: ${{ github.sha }} without persisted credentials");
  if (at < 0) add("the attestation step (test \"$CHECKED\" = \"$GITHUB_SHA\") is missing");
  else {
    const step = steps[at];
    if (!has(step, "CHECKED: ${{ needs.check.outputs.sha }}")) add("the attestation must read CHECKED from needs.check.outputs.sha");
    if (!stepText(step).includes('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"')) add("the attestation must also prove that HEAD is GITHUB_SHA");
    if (at !== 1) add(`the attestation is step ${at + 1}, it must directly follow the checkout`);
    // Nothing that uses a secret or talks to the host may come first.
    steps.slice(0, Math.max(at, 0)).forEach((before, i) => {
      if (/secrets\.|\bssh\b|\brsync\b|ssh-agent|DEPLOY_SSH_KEY/.test(stepText(before)) && i > 0) add(`step ${i + 1} touches a secret or the host before the attestation`);
    });
  }
  const hostSteps = steps.filter((step) => /\brsync\b|\bssh "/.test(stepText(step)));
  if (!hostSteps.length) add("no step talks to the host");

  const sync = steps.map(stepText).find((s) => /\brsync -/.test(s)) ?? "";
  if (!sync.includes("--filter='merge .github/deploy.filter'")) add("the sync must use --filter='merge .github/deploy.filter' (the allowlist)");
  if (!/rsync -az --delete --prune-empty-dirs /.test(sync)) add("the sync must be rsync -az --delete --prune-empty-dirs");
  if (/--exclude|--include|--delete-excluded/.test(sync)) add("the allowlist file is the only rule the sync may use");
  return problems;
}

// ---- the tests ----

const checkText = read(".github/workflows/check.yml");
const deployText = read(".github/workflows/deploy.yml");
const facts = realFacts();

describe("check.yml", () => {
  it("satisfies every guard", () => {
    assert.deepEqual(checkProblems(checkText, facts), []);
  });

  it("names its four jobs, in the order the plan gives them", () => {
    assert.deepEqual(Object.keys(jobsOf(code(checkText))), JOBS);
  });
});

describe("deploy.yml", () => {
  it("satisfies every guard", () => {
    assert.deepEqual(deployProblems(deployText, facts), []);
  });

  it("still runs the host-facing commands the gate was added in front of", () => {
    // The gate changes how deploy starts, not what it does on the host. These are the commands that
    // matter most in the steps it left alone (a spot check, not a byte comparison with the old text).
    const steps = stepsOf(jobsOf(code(deployText)).deploy).map(stepText);
    const named = (title) => steps.find((s) => s.includes(`- name: ${title}`));
    assert.ok(named("Write credentials and start").includes("docker compose up -d --build --remove-orphans && docker compose ps"));
    assert.ok(named("Check the deployed explorer").includes('test "$(probe "" || printf 000)" = "401"'));
    assert.ok(named("Check the deployed explorer").includes('test "$code" = "200"'));
    assert.ok(named("Pin the host key").includes("chmod 600 ~/.ssh/known_hosts"));
    assert.ok(named("Validate deploy configuration").includes('test -n "$DEPLOY_KNOWN_HOSTS"'));
  });
});

describe("the two files together", () => {
  it("call each other the way the gate needs", () => {
    // deploy.yml calls ./.github/workflows/check.yml; check.yml must be callable and report the sha deploy compares.
    assert.ok(exists(".github/workflows/check.yml"));
    assert.ok(exists(".github/deploy.filter"), "the filter that deploy.yml and check.yml both name");
    assert.match(deployText, /needs\.check\.outputs\.sha/);
    assert.match(checkText, /value: \$\{\{ jobs\.static\.outputs\.sha \}\}/);
  });

  it("call only npm scripts that exist and repository files that exist", () => {
    const scripts = [...(checkText + deployText).matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 4, "the workflows run npm scripts");
    for (const name of new Set(scripts)) assert.ok(facts.scripts.has(name), name);
  });

  it("agree with the Dockerfile on the numpy pin and on the image contents", () => {
    assert.match(checkText, new RegExp(`numpy==${facts.numpy.replaceAll(".", "\\.")}`));
    for (const file of facts.image) assert.ok(checkText.includes(file), `${file} is in the image file list of check.yml`);
  });
});

describe("the guards bite: a mutated copy of the real text is refused", () => {
  // [what is changed, from, to, the words the refusal must contain]. `from` must occur in the real text, so a
  // rewrite of the workflows cannot leave a mutation quietly doing nothing.
  const once = (text, from, to) => {
    assert.ok(text.includes(from), `the mutation target ${JSON.stringify(from)} is not in the text`);
    return text.replace(from, to);
  };
  const refused = (problems, words) => assert.ok(problems.some((p) => p.includes(words)), `no problem mentions ${JSON.stringify(words)}; got ${JSON.stringify(problems)}`);

  const checkMutations = [
    ["workflow_call trigger removed", "  workflow_call:\n", "", "workflow_call"],
    ["sha output removed", "        value: ${{ jobs.static.outputs.sha }}\n", "", "output sha"],
    ["a runner that moves", "    runs-on: ubuntu-24.04\n    timeout-minutes: 10\n    steps:", "    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:", "ubuntu-24.04"],
    ["a job without a bound", "    timeout-minutes: 15\n", "", "timeout-minutes"],
    ["a job with an unreasonable bound", "    timeout-minutes: 25\n", "    timeout-minutes: 360\n", "timeout-minutes"],
    ["concurrency added", "permissions:\n  contents: read\njobs:", "concurrency:\n  group: check\npermissions:\n  contents: read\njobs:", "concurrency"],
    ["checkout without the commit", "  unit:\n    name: Node tests\n    runs-on: ubuntu-24.04\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.sha }}\n", "  unit:\n    name: Node tests\n    runs-on: ubuntu-24.04\n    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@v4\n        with:\n", "ref: ${{ github.sha }}"],
    ["credentials persisted", "          persist-credentials: false\n      - id: commit", "      - id: commit", "persist credentials"],
    ["the HEAD proof removed from a job", "      - run: test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\"\n      # python3 is needed by the build test", "      # python3 is needed by the build test", "GITHUB_SHA"],
    ["a job renamed", "  bridge:\n", "  bridges:\n", "jobs are"],
    ["a failing step allowed", "    timeout-minutes: 10\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n      - run: test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\"\n      # python3", "    timeout-minutes: 10\n    continue-on-error: true\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n      - run: test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\"\n      # python3", "continue-on-error"],
    ["the build check made conditional", "      - run: python3 tools/build.py --check\n", "      - if: ${{ github.event_name == 'push' }}\n        run: python3 tools/build.py --check\n", "only upload steps"],
    ["fixtures no longer excluded from the syntax loop", " | grep -v '^tests/fixtures/'", "", "tests/fixtures/"],
    ["goldens regenerated to pass", "      - run: npm run golden:check\n", "      - run: npm run golden:write\n", "golden"],
    ["image list out of step with the Dockerfile", "/app/vendor/D3-LICENSE ", "", "image file list"],
    ["payload budget dropped", "exit ($1 > 4096)", "exit 0", "payload"],
    ["unit guard removed", "      - run: test \"$(git ls-files 'tests/unit/*.test.js' | wc -l)\" -gt 0\n", "", "no unit test file"],
    ["an npm script that does not exist", "npm run test:ci", "npm run test:everything", "is not a script"],
    ["shallow browser checkout", "          fetch-depth: 0\n", "", "fetch-depth"],
    ["the browser from @latest", "npx playwright install --with-deps --only-shell chromium", "npx playwright@latest install --with-deps --only-shell chromium", "playwright"],
    ["the development page instead of the committed one", "          CONVERGENCE: '1'", "          CONVERGENCE: '0'", "CONVERGENCE"],
    ["the benchmark as a gate", "      - run: npm run benchmark:smoke\n", "      - run: npm run benchmark\n", "benchmark"],
    ["a different numpy", "numpy==2.4.6", "numpy==2.4.5", "numpy=="],
    ["the numpy check allowed to skip", " --require-numpy", "", "--require-numpy"],
    ["a deploy secret in a check", "      - run: npm run golden:check\n", "      - run: echo ${{ secrets.DEPLOY_SSH_KEY }}\n", "secrets"],
  ];
  for (const [what, from, to, words] of checkMutations) {
    it(`check.yml: ${what}`, () => refused(checkProblems(once(checkText, from, to), facts), words));
  }

  const deployMutations = [
    ["the dependency removed", "    needs: check\n", "", "needs: check"],
    ["the condition removed", "    if: ${{ needs.check.result == 'success' }}\n", "", "condition"],
    ["the condition weakened", "    if: ${{ needs.check.result == 'success' }}", "    if: ${{ always() }}", "always()"],
    ["the condition overridden", "    if: ${{ needs.check.result == 'success' }}", "    if: ${{ needs.check.result == 'success' || !cancelled() }}", "cancelled()"],
    ["a skipped check accepted", "needs.check.result == 'success'", "needs.check.result != 'failure'", "condition"],
    ["a different workflow called", "uses: ./.github/workflows/check.yml", "uses: ./.github/workflows/other.yml", "check.yml"],
    ["the called workflow given a secret", "    uses: ./.github/workflows/check.yml\n", "    uses: ./.github/workflows/check.yml\n    secrets: inherit\n", "takes no"],
    ["a manual trigger", "on:\n  push:\n    branches: [main]\n", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n", "workflow_dispatch"],
    ["another branch", "branches: [main]", "branches: [main, next]", "only push on main"],
    ["a triggered-by-other-workflow path", "  push:\n    branches: [main]\n", "  push:\n    branches: [main]\n  workflow_run:\n    workflows: [Other]\n", "workflow_run"],
    ["cancel-in-progress", "  group: deploy-main\n", "  group: deploy-main\n  cancel-in-progress: true\n", "cancel-in-progress"],
    ["another concurrency group", "group: deploy-main", "group: deploy", "concurrency"],
    ["the concurrency moved to the job", "concurrency:\n  group: deploy-main\npermissions:", "permissions:", "top-level keys"],
    ["write permission", "  contents: read\njobs:", "  contents: write\njobs:", "permissions"],
    ["the attestation comparison removed", "          test \"$CHECKED\" = \"$GITHUB_SHA\"\n", "", "attestation"],
    ["the attestation reading another value", "CHECKED: ${{ needs.check.outputs.sha }}", "CHECKED: ${{ github.sha }}", "needs.check.outputs.sha"],
    ["the attestation after the host is touched", "      - name: The checks ran on this commit\n", "      - run: rsync -a ./ host:/srv/\n      - name: The checks ran on this commit\n", "attestation"],
    ["checkout without the commit", "          ref: ${{ github.sha }}\n", "", "checkout"],
    ["the filter replaced by excludes", "--filter='merge .github/deploy.filter'", "--exclude .git --exclude .env", "allowlist"],
    ["the excluded files deleted", "rsync -az --delete --prune-empty-dirs", "rsync -az --delete --delete-excluded --prune-empty-dirs", "--delete-excluded"],
    ["a failure tolerated", "        run: rsync -az", "        continue-on-error: true\n        run: rsync -az", "continue-on-error"],
    ["an unpinned action", "webfactory/ssh-agent@v0.9.0", "webfactory/ssh-agent@master", "pinned"],
    ["a job added beside the gate", "  deploy:\n    name:", "  hotfix:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n  deploy:\n    name:", "jobs are"],
    ["an npm script that does not exist", "docker compose up -d", "npm run ship && docker compose up -d", "is not a script"],
  ];
  for (const [what, from, to, words] of deployMutations) {
    it(`deploy.yml: ${what}`, () => refused(deployProblems(once(deployText, from, to), facts), words));
  }
});

describe("the reader", () => {
  it("ignores a comment that names what it forbids", () => {
    assert.deepEqual(code("a: 1\n  # cancel-in-progress is never set\nb: 2"), ["a: 1", "b: 2"]);
  });

  it("finds job and step boundaries by indentation", () => {
    const lines = code("jobs:\n  a:\n    steps:\n      - run: x\n        if: y\n      - run: z\n  b:\n    runs-on: r\nother: 1");
    const jobs = jobsOf(lines);
    assert.deepEqual(Object.keys(jobs), ["a", "b"]);
    assert.deepEqual(stepsOf(jobs.a).map((s) => s.length), [2, 1]);
    assert.deepEqual(section(lines, "other"), []);
  });
});
