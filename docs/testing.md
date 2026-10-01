# Testing

How the explorer is tested, what the tests can and cannot show, and how a push to `main` becomes a deploy. The explorer itself runs and builds without npm; everything here is development tooling and is never copied into the image: the Dockerfile copies `index.html`, `vendor/` and the two bridge Python files, and `tests/unit/repo.test.js` pins that list.

## What the tests are evidence of

The tests check the page against a **fake** of the bridge's HTTP boundary, filled with **synthetic** trades, and against independent calculations of what the page should show. That is evidence about the front end: its arithmetic, its mappings, its state handling, its reads and their order, its reactions to faults. It is not evidence about the real cube service. The fake cannot validate Origo's own rules for path, dwell, highs and lows or gaps, real latency and load, real block sizes and counts, the host, TLS or the proxy, and the last bits of real float sums. The fake's own store is only as right as our reading of `docs/data-and-semantics.md`; the hand-computed and reference fixtures encode the same reading, so an error in that reading is invisible to every test.

Three kinds of claim stay outside the repository's tests and are never stated as done by them: designated-machine performance, real-host behaviour and rollback on the host, and human judgement of the palette. They need the operator.

## Commands

Node 22 or newer and `python3` on the path (the build test calls `tools/build.py`). Local Node 23 gives the same results; only Node 22 features are used.

| What | Command | Notes |
|---|---|---|
| install the dev tools | `npm ci --ignore-scripts --no-audit --no-fund` | once; Playwright is the only dev dependency and is pinned exactly |
| unit tests | `npm test` | `node --test` over the quoted glob `"tests/unit/**/*.test.js"`; never pass the directory, which fails on Node 22, and a glob that matches nothing exits 0, so CI also checks that test files exist |
| one unit file | `node --test tests/unit/workflows.test.js` | |
| a page of the working tree | `npm run build:tmp` | writes `reports/page/`; never touches the committed `index.html` |
| browser tests | `npx playwright install chromium` (once), then `npm run test:browser` | against `reports/page/` built just before; `-- <spec-name>` picks specs |
| browser tests on the committed page | `CONVERGENCE=1 npm run test:browser` | what CI runs; serves the committed `index.html` |
| goldens | `npm run golden:check`; `npm run golden:write` | see below |
| the fake by hand | `npm run fake` | port 8790, profile `standard`; open the URL it prints |
| benchmark | `npm run benchmark`; `npm run benchmark:smoke` | see below |
| the committed page is what the sources build | `python3 tools/build.py --check` | the deploy gate |
| syntax of every JavaScript file | the `node --check` loop in the `static` job of `.github/workflows/check.yml` | |

Never run `python3 tools/build.py` without `--out` while working on a branch: it rewrites the tracked `index.html`, which only the merger regenerates. Reports, builds and screenshots go to `reports/`, `test-results/`, `playwright-report/` or `.playwright-mcp/`, all ignored; none of them is committed.

Which page the browser tests serve is decided in one place, `tests/support/pageroot.js`: `EXPLORER_PAGE_ROOT` if set, else with `CONVERGENCE=1` the repository root, else a temporary build of the working tree.

## Fixtures and provenance

Every top-level directory of `tests/fixtures/` holds one kind of fixture and carries a `provenance.json`; `tests/unit/repo.test.js` refuses a directory without one. The schema and the field values are in `tests/fixtures/README.md`. The rules that matter:

- **Expected values never come from the code under test.** `expectationSource` is one of `hand-computed`, `reference-calculator`, `python-stdlib`, `baseline-8c82ca1` (output of the unmodified original code, recorded once) or `published-table`. `generator`, meaning the fake's own store, is refused. The single exception is `self-pin`, allowed only under `tests/fixtures/profiles/`, which records that a generated profile is stable and is never an expected value elsewhere.
- **Synthetic data says so.** Synthetic streams are `kind: "synthetic"`, the fake labels every pack it serves `SYNTHETIC fixture <profile> seed <n> - not market data`, and nothing here is described as market history. Recorded data says where and when it was recorded. Legacy addresses and stored payloads are `grammar-derived` from the documented formats; none was captured from users.
- **Seeds, not blobs.** Generators take a seed and use `tests/support/rng.js`, never `Math.random()`. Fixtures stay under 5 MiB in total; large data is generated.
- **Every test file names its oracle** in its header comment: a hand vector, exact rational arithmetic, `d3`, `node:crypto`, `zlib`, a recorded baseline or a published table. A test that computes its expectation with the code it tests is a defect.

Micro trade sequences (`tests/fixtures/trades/<name>.json`) are `{trades: [{t_ms, price, qty, takerBuy, count?}], gaps: [[t0_ms, t1_ms]], cutoffIso, canonicalThroughIso?, seed?, expected?}`. Times are milliseconds since 2021-01-01T00:00:00Z, prices are integers in 1e-2 USDT and quantities integers in 1e-8 BTC, in time order and none after the cutoff. The `notes` of the provenance carry the derivation of each expected value, written by hand from the trades; the reference calculator then confirms it, and only after that do the fake and browser tests use it.

## The fake cube and the reference calculator

`tests/support/cube-fake.js` is a zero-dependency Node server that stands where the page sees the bridge (`tools/cube_bridge.py`), not where the bridge sees Origo. It reproduces the routes and their validation, the error shapes, packs, deltas and whole packs, held packs and their tokens, per-day pins and `409 cube_changed`, and the open column taken from the pack's own snapshot; `tests/support/bridge-model.js` is its pure model, unit-tested without HTTP. It serves the committed page or a build you point it at (`tests/support/builds.js` materialises any earlier commit, such as the original `8c82ca1`, from git into `reports/builds/`).

- **Profiles** (`tests/support/profiles.js`): `mini`, `standard`, `deep`, `bench` (seeded random walks), `uniform` (one trade every 1.25 s, closed-form expectations) and `skew`, plus `micro:<name>` for a fixture of the format above. The same profile and seed always give the same data.
- **Control.** From a test, `startFake({profile})` returns the server; `advance`, `revise`, `holdPacks`, `expirePack`, `rebuild`, `corrupt` and friends change its state, and `on({route})` adds a fault: `delay`, `fail`, `hang`, `drop`, `empty`, `malformed` or `gate`, the last holding requests until the test releases them, which is how races are tested without sleeps. From the command line the same controls are at `/__fake/*`. Every request is logged and unexpected ones are flagged.
- **Time.** Nothing the page can read depends on the real clock. Timer-driven behaviour (the 200 ms settle, the 500 ms cap, Play) is tested with `page.clock` in the browser and with explicit `now` arguments in Node.

`tests/reference/` holds the independent calculator (exact arithmetic on integer trades, importing nothing from `src/`, `tests/support/` or `vendor/`), the colour and contrast references, the recorders that extract baseline outputs, and the Python generators. The fake and the calculator are checked against each other, not trusted on their own.

What the fake and the reference cannot validate is listed under the first section. One more limit is worth knowing: the page's two-minute and one-minute read timeouts are browser-internal timers that the test clock is not expected to advance, so the messages they produce are not tested.

### Composed output and known-at replay

Two kinds of browser spec read what the page painted rather than what it computed.

- **Composed pixels.** `tests/browser/pane-canvas.js` records every canvas operation of a frame (rectangles, strokes with their paths and dash, fills, texts, arcs, and the clip each was drawn under); `tests/browser/masks.js` turns those operations into masks and checks each against the geometry the visual contract allows (a reference stroke and its backing at most 4.5 px, a label plate one line of text, a cap or hairline at most 2 px thick, a marker no larger than a glyph). A test that says "these pixels are the same with and without an overlay" can be excused only where a recorded, validated mark covers them; a halo larger than the contract does not pass by being called a mask, it is reported. Skia samples a path stroke four times per pixel vertically but takes exact area coverage for `strokeRect`, so the coverage arithmetic in `movement-cores.spec.js` and `two-tone-pixels.spec.js` uses each rule where it applies and states its tolerance (4 and 2 of 255) in the spec. A selection repaints inside itself, clipped to its rectangle, so a cut cell shows only its own partial amount there.
- **Known-at replay.** `tests/reference/swings.js` and `tests/reference/indicators.js` derive the confirmed swings, the SMA and EMA, MACD and its crossings, the Bollinger width and the 4-hour squeeze from the definitions in `docs/data-and-semantics.md`, importing nothing from `src/`. `events-known-at.spec.js` replays the page before, at and after the bar that completes each event and compares what is drawn and read with those references. Two details matter when writing one: the replay's edge is floored to the rendered level's time step, so such a test pins the level with `r=` and keeps the view inside the fine recent seven days; and `S.atRest` can pass before startup has finished, so a test waits for the cube's reads it needs, not for rest.

### Goldens and the drift rule

`tests/reference/golden.py` (scale and indicator vectors) and `tests/reference/wire_golden.py` (wire layouts and the delta or whole-pack rule) use only the Python standard library and write sorted, fixed-indent JSON. Wire payloads are compared **decompressed**, because gzip bytes change with the zlib version and the clock. `npm run golden:check` regenerates in memory and compares bytes; CI runs it and never writes a golden to make itself pass. `npm run golden:write` is for a deliberate change, reviewed like any other.

About five hundred lines of the bridge's protocol behaviour are duplicated in the fake, and no check in CI compares them with the real `tools/cube_bridge.py`. **Drift rule:** any change to `tools/cube_bridge.py` protocol behaviour updates the fake, the vectors and the test plan in the same pull request, by hand. The protocol number stays 2 until a change says otherwise; the browser tests and the benchmark report both check it.

## Adding a regression fixture

A failure found later is committed as a fixture with a test, not kept as a CI artifact.

1. Reduce it to the smallest input that shows it: a micro trade sequence, a legacy payload, a wire vector, a saved address.
2. Put it in `tests/fixtures/regressions/<id>/` with its own `provenance.json` (`regressions/` itself needs none). Choose a true `expectationSource`; the expected result is derived independently, by hand or by the reference calculator, never by running the code that failed.
3. Add the test, in `tests/unit/` or as a browser spec, that reads the directory and fails without the fix. Its header names the oracle and the issue.
4. Commit the fixture, the test and the fix together.

## Benchmark

The navigation benchmark implements the method of the performance requirement as code: alternating A/A pairs to measure the noise floor of this machine, randomised A/B screening, a fixed confirmation run across the whole core, and a bootstrap interval per case and metric at a 99% family-wise level. The configuration (`tools/benchmark/navigation.v1.json`: case matrix, protocol, seed, budgets) is committed before any candidate result, and the pure statistics are unit-tested with a seeded generator.

- `npm run benchmark` is an operator procedure on a dedicated machine, about half an hour to an hour and a half. `--designated <name>` records which machine it was; without it the report says it is not a designated environment and not a precision certificate. The browser mode (full Chrome or the headless shell) is recorded and should match between runs that are compared.
- Builds under comparison come from git (`--baseline`, `--preceding`, `--candidate`), never rebuilt, against the same fake, profile and seed. The tool refuses a dirty tree unless told otherwise, and refuses A/B when the A/A floor shows the environment is too noisy (`environment-inconclusive`).
- The verdicts use one vocabulary: `blocking`, `no regression detected at this resolution` and `inconclusive`. "Inconclusive" is a likely outcome at twenty pairs and is reported as such; it needs an explanation or the operator, never the words "no overhead".
- Reports are JSON plus a `summary.md` under `reports/benchmark/` (ignored) and are attached to the pull request. They are specific to their environment and go stale.
- CI does not run the benchmark, full or smoke. Timing never gates a deploy.

## CI and the deploy gate

### The checks

`.github/workflows/check.yml` has three jobs on `ubuntu-24.04`, each with a time bound, each checking out `${{ github.sha }}` and proving `HEAD` equals `GITHUB_SHA`:

| Job | What it runs |
|---|---|
| `static` | `python3 tools/build.py --check`; `node --check` over the tracked JavaScript; `py_compile` of the Python tools; `npm run golden:check`; `docker compose config` |
| `unit` | fails on an empty suite, then `npm run test:ci` (spec output and a JUnit report in `reports/`, uploaded) |
| `browser` | full-history checkout, `npm ci`, the headless shell of the pinned Playwright, `npm run test:browser` with `CONVERGENCE=1` (the committed page), reports uploaded |

It runs on every push and pull request, and through `workflow_call` from the deploy workflow. It has no `concurrency` of its own: a group derived from the caller's would deadlock or cancel the caller. Pull-request runs are the evidence before a merge and do not gate anything. A push to `main` therefore gets two check runs, a standalone one and the one inside the Deploy run; that is accepted so that every commit on `main` keeps a visible check even when its deploy run is replaced by a newer one.

### The gate

`.github/workflows/deploy.yml` runs on a push to `main` and nothing else. Its first job, `check`, is `uses: ./.github/workflows/check.yml`, which resolves to the same commit as the caller, so the checks and the deploy are one run for one `github.sha`. The `deploy` job has `needs: check` and an explicit `if: ${{ needs.check.result == 'success' }}`; there is no `always()` or `!cancelled()`, so a failed, skipped or cancelled check leaves the deploy skipped and production on the previous commit. Before anything touches the host, the deploy job checks out `github.sha`, proves `HEAD` equals it, and compares `needs.check.outputs.sha`, the commit the checks report having tested, with `GITHUB_SHA`; the commit goes into the step summary. The sync that follows is the one the deploy already had, with `--exclude .git --exclude .env` and never `--delete-excluded`, which would delete the host's `.env`; the gate changes when the deploy starts, not what it sends.

- **Serialised, never cancelled.** The concurrency group `deploy-main` is at workflow level without `cancel-in-progress`: cancelling rsync or compose half way would leave the host half updated. A newer push waits behind the running deploy; at most one run waits, and a newer waiting run replaces an older waiting one, so the last commit pushed is deployed next. The consequence is that the checks of a newer push queue behind a running deploy, about half a minute longer.
- **No bypass.** There is no manual trigger, no `workflow_run`, no input and no condition that skips the checks. Whether an emergency path should exist is the operator's decision; the design has none. Branch protection is not assumed and none is relied on.
- **Re-running** a Deploy run keeps its commit and executes the whole gate again; re-running an old run deploys that old commit, which is the natural last-known-good route and needs the checks to pass again.
- **A commit message with `[skip ci]`** skips both the check and the deploy; that merge is not deployed.

### Failure modes

The gate makes everything it depends on a production dependency: a flaky browser test, the Playwright download and the runner image can each block a deploy, including the deploy of a revert. Mitigations are `retries: 0` with `failOnFlakyTests` and `forbidOnly` in CI so flakiness is visible instead of masked, a time bound on every job (a hung job would hold the `deploy-main` group), no timing gate, and a deterministic fake. Recovery is to fix forward, to push a revert commit, or to re-run the last good Deploy run. The first run after the gate exists is itself gated: if a job cannot start on the runner, nothing deploys until that is fixed.

### What the repository does not certify

**GitHub-side runtime semantics of this gate are not certified by the repository.** `tests/unit/workflows.test.js` reads the two workflow files line by line and compares them with `package.json` and the file system, and it is shown to fail on mutated copies of the real text. That proves the files say what the design says. It does not prove that GitHub behaves as they assume: that a failed check skips the deploy, that a newer waiting run replaces an older one, that `[skip ci]` skips both, that the called workflow sees the caller's `github` context, that path filters do not apply to a called workflow, or the state of any branch protection or ruleset. None of this was executed from the repository, and `actionlint` checks syntax and expressions, not these semantics.

To try the negative path (the operator or a reviewer, never against the real deploy job), in a throwaway private repository copy both workflows and set dummy `DEPLOY_*` variables. Add a deliberately failing unit test on a branch whose push trigger is temporarily `push: branches: [main]`, push it, and look for: `check` red, `deploy` skipped, no rsync step executed. Then fix the test and look for `deploy` reaching the dummy configuration check. Keep the two run links. Until that is done the statement for a pull request is: "Workflow dependency implemented; admin settings and negative path not verified."

Run `actionlint .github/workflows/*.yml` (or the `rhysd/actionlint` image) after any change to a workflow. With shellcheck installed it reports a few notes in the two host-facing steps of `deploy.yml` that predate the gate and were left untouched on purpose (the client-side expansion in the `ssh` commands is intended, and the retry counter is unused); everything else should be clean.

## Words in these documents

The prose lint in `tests/unit/role-lint.test.js` reads `docs/*.md` along with the sources. Name colour roles positive, negative and midpoint, as the rest of the repository does; the taker-buy data names (`bv`, `bt`, the buy share and so on) stay as they are.
