# Visual contract

The consumer inventory of PRD-0002 slice S1 (#46), parent D1: every place where a colour, a mark or a number that stands for a measurement is produced or read, what role it plays today, what role it must play, who changes it, which test guards it and how far the migration has got. It also holds the decision list (DR-01 to DR-38), the design-decision register (DD-01 to DD-99), the test index and the migration status per slice. The mapping owner is `src/encoding.js` once it exists (the roles, LUTs, legends and readouts live there; this file names the consumers that must call it).

Baseline: `main` at `8c82ca1`. Every line number in a row is that commit's; the function name, CSS selector or element id is the durable anchor. Rows that do not exist at the baseline (the consumers S1 creates) are registered up front with status `todo-S1`, so no package of Wave 2 edits this file to add its own row. Two packages edit it later, in disjoint sections and never in parallel: package D (the docs package) writes the contributor checklist and the glossary of sections 11 and 12, and K (the convergence package) changes the statuses and the roll-up at convergence.

## 1. How this file is checked

Two Node unit tests read this file. `tests/unit/visual-contract.test.js` (U36) parses it: every inventory table has the eight D1 columns, ids are unique and statuses and owners are drawn from the vocabulary of section 2; a completeness ratchet requires a row for every top-level function that reads `colors.<key>`, for every CSS custom property and `--ol-*` token, and for every footer key and legend id of `src/view.html`; row counts never fall below the baseline; every row owned by #46 names an existing test id of section 9; the decision list names DR-01; the contributor checklist and the glossary exist. `tests/unit/role-lint.test.js` (U35) scans the sources for retired rendering roles (section 4). The committed-equality halves (statuses, final counts, allowlist equality) run only with `CONVERGENCE=1` (TESTPLAN DD-T29), because parallel packages cannot all edit this file or the allowlist; every worktree runs the ceiling and completeness halves.

Run both with `node --test tests/unit/role-lint.test.js tests/unit/visual-contract.test.js` (add `CONVERGENCE=1` for the equality halves). `ROLE_LINT_REPORT=1` prints every remaining hit with its function or selector, which is how K lowers the allowlist. A Wave-2 package that needs a top-level function that reads `colors.*` under a name that is not pre-registered in section 3.6 raises an amendment request instead of editing this file; a hit or a function the tests cannot map to a row fails in that package's worktree, by name.

## 2. Vocabulary

**Row ids.** `T-` design token, `C-` canvas consumer, `D-` DOM consumer, `F-` footer key, `R-` readout, number or prose consumer, `N-` new in S1 (does not exist at the baseline). A letter suffix splits one baseline consumer (C-09a to C-09d). Ids stay stable once shipped.

**Target roles** (parent D3, D6, D8). `Q-fill` quantitative fill (opaque); `Q-line` quantitative outline; `UM` unsigned magnitude (ordered low-chroma); `+`, `-`, `mid` positive, negative and midpoint; `OCC` occupancy (a known trade occupancy, no magnitude); `REF:<family>` family reference (Profile gold, Price levels violet, Averages olive, VWAP rust, Clock neutral, User Level ink, Historical comparison neutral); `STATE` neutral keyed state (pending, failed, unsupported, undefined, open, partial, provisional, coverage); `IX` interaction (selection, hover, table-hover, focus, inspect, lens frame); `RP` temporary region replacement (lens, tooltip, popover, replay and lens control surfaces); `CHR` structural chrome (grid, axes, text, plates, control backgrounds; not a measurement); `DATA-NAME` legitimate taker-buy naming (kept).

**Channels** (parent D4). `CELL` unbounded Cells colour (Explore, per resolution context); `ROW` unbounded Rows colour (Explore, per row and period context); `FIXED` fixed domain (shares, log2 ratios, RSI); `AXIS` ordinary Columns lengths and MACD (Auto axis); `PROF` current and reference profile length (independent Auto axis); `LENS` lens colour (the shared active Cells mapping unless Local contrast); `NAV` main price and time axes; `-` none.

**Owner** is the list of slices with work on the row, as issue numbers: #46 (S1), #47 (S2), #48 (S3). A row that no slice changes carries #48, whose audit of composed contrast, focus and text verifies that it still meets the target. Per-slice detail is written in the Target cell as `[slices: ...]` where it is not just one slice.

**Status** is the first slice with outstanding work: `todo-S1`, `todo-S2`, `todo-S3`; `keep` means legitimate with no change planned; `done` means all planned work is complete. When K finishes the S1 part of a row that still has S2 or S3 work, the status becomes the next slice's `todo`; a row is `done` only when nothing is left. `todo-S2` and `todo-S3` rows are consumers that must keep working in S1 and that S1 must not repaint.

**Tests** are ids of the test index (section 9). A prefix `S2:` or `S3:` names a test to be authored in that slice. Every row owned by #46 names at least one existing id.

## 3. Consumer inventory

Every table below has the same columns, the eight of parent D1 after the row id: consumer, file/function/CSS rule, current token or behaviour, target role, measurement/channel, owner, tests, status.

### 3.1 Design tokens (T-)

Contrast is WCAG contrast of the hex against `--ol-surface` (`#fff` / `#161f19`), light / dark, not composited. T-27 to T-33 are the new tokens of DD-30 and DD-61, added next to the old ones in Wave 1.

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| T-01 | Design token `--ol-bg` (4) | src/explorer.css (line in the Consumer cell); CSS uses 5; JS/HTML: `colors.bg` (chip text 796, page fill 973, future fill 2134, 6806, 8791); document.html body literal | #f7f9f7 / #101713; contrast against the surface -; page/unobserved region | CHR; keep [slices: S2 (unchanged in S1)] | - | #47 | - | keep |
| T-02 | Design token `--ol-surface` (5) | src/explorer.css (line in the Consumer cell); CSS uses 18; JS/HTML: `colors.surface` x21 (see 2.2); strings 4662-4665; theme detector 4130 | #fff / #161f19; contrast against the surface -; plot bg, casing, plates, delta zero | CHR + casing role for two-tone (S2) [slices: S2 (unchanged in S1)] | - | #47 | - | keep |
| T-03 | Design token `--ol-panel` (6) | src/explorer.css (line in the Consumer cell); CSS uses 9; JS/HTML: probed in `getColors` (key list 696-711, `panel` at 699) but `colors.panel` unused | #eff4f0 / #1b2720; contrast against the surface 1.11 / 1.09; segs, kbd, `.ol-track`, `.ol-data-key` base, ramp start (dead JS probe) | CHR [slices: -] | - | #48 | - | keep |
| T-04 | Design token `--ol-ink` (7) | src/explorer.css (line in the Consumer cell); CSS uses 27; JS/HTML: `colors.ink` x18 | #20392b / #e0eee4; contrast against the surface 12.49 / 14.08; text, IX outlines, Level, RSI/MACD line, Rows volume band | CHR/IX/REF:User Level (S3) | - | #48 | - | keep |
| T-05 | Design token `--ol-muted` (8) | src/explorer.css (line in the Consumer cell); CSS uses 53; JS/HTML: `colors.muted` x26 | #5c7263 / #a1b5a7; contrast against the surface 5.20 / 7.78; secondary text, guides, subset bars | CHR; state strokes (candidate for S1 non-value patterns) [slices: S1 (new marks only)] | - | #46 | U19 | keep |
| T-06 | Design token `--ol-line` (9) | src/explorer.css (line in the Consumer cell); CSS uses 31; JS/HTML: `colors.line` x17; strings 4175 | #d8e3db / #334a3c; contrast against the surface 1.32 / 1.76; hairline, hatch, Cascade non-value, unmeasured fill | CHR only; STATE uses must move to a state token (fails 3:1) [slices: S1 (new state marks), S2 (legacy)] | - | #46, #47 | U19, U35 | done |
| T-07 | Design token `--ol-volume` (11) | src/explorer.css (line in the Consumer cell); CSS uses 3 (CSS 862, 867, 1073); JS/HTML: `colors.volume` x4 | #39845d / #80cca1; contrast against the surface 4.53 / 8.90; green "Volume"; Geometry outline, VA fill, column bars, plane ready/small, default ramp | retire as a hue: UM for column bars, OCC for Geometry [slices: S1 (Geometry, column bars, `.ol-ramp` default), S2 (plane, VA fill)] | - | #46, #47 | U35, U18 | done |
| T-08 | Design token `--ol-buy` (12) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.buy` x10; `var(--ol-buy)` 4173, 4175, 4665 | #2d769c / #73b8d4; contrast against the surface 5.02 / 7.66; blue "buy"; delta, flow, cascade, bands, bars, MACD, RSI, buy subset, B line | `+` role (`--ol-positive`); hex unchanged initially (PRD supersession) [slices: S1 (rename + scalar routes), S2 (buy subset), S3 (Buy POC, RSI/MACD markers)] | - | #46, #47, #48 | U35, U18 | todo-S3 |
| T-09 | Design token `--ol-sell` (13) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.sell` x8; strings 4173, 4175, 4665 | #b3624b / #d89777; contrast against the surface 4.41 / 6.92; clay "sell" | `-` role (`--ol-negative`) [slices: S1 (+ S3 for RSI/MACD)] | - | #46, #48 | U35, U18 | todo-S3 |
| T-10 | Design token `--ol-poc` (14) | src/explorer.css (line in the Consumer cell); CSS uses 5 (CSS 23, 434, 872, 1471, 1484); JS/HTML: `colors.poc` x15 | #a87823 / #dfb967; contrast against the surface 3.91 / 9.06; gold: Profile reference AND status colour | REF:Profile gold only; status uses removed [slices: S2 (state uses), S3 (reference language)] | - | #47, #48 | - | todo-S3 |
| T-11 | Design token `--ol-evidence` (15) | src/explorer.css (line in the Consumer cell); CSS uses 3 (CSS 888, 1659, 1690); JS/HTML: `colors.evidence` x5 | #7664a9 / #b4a1df; contrast against the surface 5.04 / 7.32; violet: continuation matching, anchor, tracks, plane loading | retire where it competes with signed identity; Historical comparison neutral [slices: S2 (plane loading, cone tint), S3] | - | #47, #48 | - | todo-S3 |
| T-12 | Design token `--ol-time` (17) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.time` x2; string 4664 | #8f4f86 / #d59bcc; contrast against the surface 5.78 / 7.55; mauve Time-at-price magnitude | retire; UM common language [slices: S1 (bandTone, underProfile, `underlayLegend`)] | - | #46 | U35 | done |
| T-13 | Design token `--ol-neutral` (19) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.neutral` x1 (4191); string 4173 | #b9c2bc / #5f6b64; contrast against the surface 1.83 / 3.03; taker-flow/cascade midpoint | `mid` role (`--ol-midpoint`); avoid the word neutral (PRD uses it for keyed states and Clock/Historical) | - | #46 | U35 | done |
| T-14 | Design token `--ol-line-poc` (23) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.family.poc` via probe 716-719, `lineStyle` 4960 | = `--ol-poc`; contrast against the surface 3.91 / 9.06; POC/profile family colour | REF:Profile gold | - | #48 | - | keep |
| T-15 | Design token `--ol-line-level` (24) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.family.level` | #9471f5 / #bb6bd9; contrast against the surface 3.54 / 5.00; Session + Structure family | REF:Price levels violet | - | #48 | - | keep |
| T-16 | Design token `--ol-line-average` (25) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.family.average`; also MACD signal line 6875 | #6c661f / #8a9650; contrast against the surface 5.90 / 5.27; Averages family | REF:Averages olive | - | #48 | - | keep |
| T-17 | Design token `--ol-line-vwap` (26) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.family.vwap` | #7c3514 / #e2621a; contrast against the surface 8.84 / 4.82; VWAP family | REF:VWAP rust | - | #48 | - | keep |
| T-18 | Design token `--ol-line-clock` (27) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: `colors.family.clock` | #8c948f / #7d8a82; contrast against the surface 3.11 / 4.69; Clock family (neutral grey) | REF:Clock neutral | - | #48 | - | keep |
| T-19 | Design tokens `--ol-tier-short-width`, `--ol-tier-short-chroma`, `--ol-tier-medium-width`, `--ol-tier-medium-chroma`, `--ol-tier-long-width`, `--ol-tier-long-chroma` (28-33) | src/explorer.css (line in the Consumer cell); CSS uses 0; JS/HTML: read by `getPropertyValue` 725-726, `lineStyle` 4959-4962; `colors.tiers` read by `getColors` 722-727 and `lineStyle` 4959-4962; `PERIOD_TIERS` 4933-4944 (inside `FAMILIES`), `lineTier` 4946; `TOGGLES[k].tier` | 1.25/0.7, 1.75/0.85, 2.5/1; contrast against the surface -; timeframe tiers: weight and chroma | retired by parent D8 (no timeframe tiers) | - | #48 | - | todo-S3 |
| T-20 | Design token `--ol-accent` (35) | src/explorer.css (line in the Consumer cell); CSS uses 7; JS/HTML: `colors.accent` x3 (1018, 11378, 11463) | = `--ol-ink`; contrast against the surface 12.49 / 14.08; focus ring, selection, lens frame, pressed toggle border | IX (two-tone in S2) [slices: S2 (unchanged in S1)] | - | #47 | - | keep |
| T-21 | Design token `--ol-border` (36) | src/explorer.css (line in the Consumer cell); CSS uses 8; JS/HTML: - | #768d7e / #667f6f; contrast against the surface 3.57 / 3.88; control borders, kbd | CHR; clears 3:1 against the surface in both themes (3.57 / 3.88) [slices: -] | - | #48 | - | keep |
| T-22 | Design token `--ol-hover` (37) | src/explorer.css (line in the Consumer cell); CSS uses 5; JS/HTML: - | #dde6e0 / #2a3a30; contrast against the surface -; button/row hover | IX/CHR [slices: -] | - | #48 | - | keep |
| T-23 | Design token `--ol-raised` (38) | src/explorer.css (line in the Consumer cell); CSS uses 1; JS/HTML: - | #fff / #3a4e41; contrast against the surface -; selected segment | CHR [slices: -] | - | #48 | - | keep |
| T-24 | Design token `--ol-on` (39) | src/explorer.css (line in the Consumer cell); CSS uses 2; JS/HTML: - | #d6e0d9 / #2e4035; contrast against the surface -; toggle on, chosen menu item | CHR [slices: -] | - | #48 | - | keep |
| T-25 | Design token `--ol-shadow` (40), `--ol-scrim` (41) | src/explorer.css (line in the Consumer cell); CSS uses 8, 1; JS/HTML: - | rgba; contrast against the surface -; shadows, dialog backdrop | CHR [slices: -] | - | #48 | - | keep |
| T-26 | Non-colour custom properties `--fs-s`, `--fs-m`, `--fs-l`, `--fs-xl`, `--sp-1`, `--sp-2`, `--sp-3`, `--sp-4`, `--sp-5`, `--sp-6`, `--gutter`, `--r-s`, `--r-m`, `--r-l`, `--h-s`, `--h-m`, `--h-l` (43-61), `--side-w`, `--drawer-h` (64-65), and the JS-set `--line`, `--weight` | src/explorer.css 43-65; JS `setProperty` 3195, 3209 (`--side-w`, `--drawer-h`) and 8443-8444 (`--line`, `--weight` per swatch); `TYPE` mirror 52 | -; contrast against the surface -; layout/type | not visual-role consumers; list for completeness [slices: -] | - | #48 | - | keep |
| T-27 | Design token `--ol-positive` (new in S1) | src/explorer.css custom-property block (W1-D adds it next to the old tokens); JS `colors.<key>` through `getColors`; encoding.js LUT constants (CSS equality test) | Does not exist at baseline; value `#2d769c` / `#73b8d4` | `+` role. Renames `--ol-buy` (hex unchanged); every scalar-routed consumer migrates; it never appears in an unsigned context. | CELL, ROW, FIXED, AXIS | #46 | U18, U19, U35 | done |
| T-28 | Design token `--ol-negative` (new in S1) | src/explorer.css custom-property block (W1-D adds it next to the old tokens); JS `colors.<key>` through `getColors`; encoding.js LUT constants (CSS equality test) | Does not exist at baseline; value `#b3624b` / `#d89777` | `-` role. Renames `--ol-sell` (hex unchanged); same migration as `--ol-positive`. | CELL, ROW, FIXED, AXIS | #46 | U18, U19, U35 | done |
| T-29 | Design token `--ol-midpoint` (new in S1) | src/explorer.css custom-property block (W1-D adds it next to the old tokens); JS `colors.<key>` through `getColors`; encoding.js LUT constants (CSS equality test) | Does not exist at baseline; value `#b9c2bc` / `#5f6b64` | `mid` role. Renames `--ol-neutral`; the signed zero is drawn as a midpoint fill, distinct from the surface (DD-16). | CELL, ROW, FIXED | #46 | U18, U19, U35 | done |
| T-30 | Design token `--ol-occupancy` (new in S1) | src/explorer.css custom-property block (W1-D adds it next to the old tokens); JS `colors.<key>` through `getColors`; encoding.js LUT constants (CSS equality test) | Does not exist at baseline; value `var(--ol-border)` | `OCC` role. Known trade occupancy without magnitude (Geometry outline, unsigned zero); clears 3:1 on the surface in both themes. | - | #46 | U18, U19 | done |
| T-31 | Design token `--ol-state` (new in S1) | src/explorer.css custom-property block (W1-D adds it next to the old tokens); JS `colors.<key>` through `getColors`; encoding.js LUT constants (CSS equality test) | Does not exist at baseline; value `var(--ol-muted)` | `STATE` ink. Ink of every keyed non-value mark and pattern; replaces `--ol-line` and `--ol-neutral` for that job (they fail 3:1). | - | #46 | U18, U19, B16 | done |
| T-32 | Design token `--ol-legacy-buy` (new in S1) | src/explorer.css custom-property block (W1-D adds it next to the old tokens); JS `colors.<key>` through `getColors`; encoding.js LUT constants (CSS equality test) | Does not exist at baseline; value `#2d769c` / `#73b8d4` | Interim name. For the pending unsigned and reference consumers only (profile taker-buy subset bar, Buy POC line and label, RSI divergence markers) so that `positive` never appears in an unsigned context; each use is a row with an owner in #47 or #48 and the token is removed with the last one. | - | #46, #47, #48 | U35, U19 | todo-S3 |
| T-33 | Design token `--ol-legacy-sell` (new in S1) | src/explorer.css custom-property block (W1-D adds it next to the old tokens); JS `colors.<key>` through `getColors`; encoding.js LUT constants (CSS equality test) | Does not exist at baseline; value `#b3624b` / `#d89777` | Interim name. As `--ol-legacy-buy`, for the sell-side of the same pending consumers. | - | #46, #47, #48 | U35, U19 | todo-S3 |
| T-34 | The `colors` object and its probe | src/explorer.js: `getColors` 693-730 (probe key list 696-711 with `colors.panel` read but never used; family probe 716-719; tier probe 722-727; ends in `buildRamp`), `colourEpoch` 4127-4133, theme listener 12455-12461 | 14 keys `bg, surface, panel, ink, muted, line, volume, buy, sell, poc, evidence, time, accent, neutral`, then `colors.family`, `colors.tiers`, then the ramp; every value is an opaque `rgb()` string; the theme flip refreshes only `colors`, the LUT and the canvas | Key list without `buy, sell, neutral, time`, with `positive, negative, midpoint, occupancy, state, legacyBuy, legacySell`; the final `buildRamp()` becomes `themeChanged()`; new tokens with alpha never go through `colors.*` | - | #46, #48 | U35, U18, B04 | todo-S3 |

### 3.2 Canvas consumers (C-)

The `draw()` order at the baseline is: 973 background, 981 coverage, 982 grid, 983 bands, 984-989 selection fade, 998-999 cells, 1001 markings, 1002 unfinished, 1003 clock, 1004 lines, 1005-1016 continuations, 1017-1035 selection outline, 1036-1062 cutoff, provisional and anchor, 1063-1107 hover, 1108 lens, then axes 1111, profile 1112, activity 1113, crosshair 1114 and the legend writes 1116-1121. `colors.<key>` reaches the canvas at 142 sites on 131 lines; the LUT `ramp()`, `lineStyle().colour`, `divergingColour()` and the literals `#15191c` / `#fff` reach it without a `colors` key.

#### 3.2.1 Cells

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| C-01 | Volume, Trades, Trade size fill | `fillCell` 4311, `cellColour` 4300, `amount` 4087, `amountScale` 4097, `rank` 4112, `RAMP`/`buildRamp`/`ramp` 4121-4135 | 256-entry yellow-green-blue Lab LUT by mid-rank over all positive full-cell-rate amounts of the whole block level | UM `Q-fill`: Amount + Value (log1p, U=max, k=median) by default; Intensity and Relative rank explicit | CELL, Explore per (n,m) | #46 | U15, U16, U43, U24, U26, U27, U18, U19, U20, U21, U23, B03, B05 | done |
| C-02 | Taker flow (USDT), Taker trades fill | `cellColour` 4278-4282, `tradedLevel` 4182, `divergingColour` 4190 | share window +/-25 points about 50 % saturates at 25/75; activity paleness blends 30 %-100 % toward surface; v=0 or ct=0 -> share 0.5 | `+/-/mid Q-fill`, linear 0-100 % with 50 % midpoint, no activity multiplier (or explicit bivariate opt-in) | FIXED | #46 | U15, U16, U43, U12, U13, U14 (empty-population), U20, B03 | done |
| C-03 | Delta fill | `cellColour` 4293-4299, `levelMetrics` 4041-4060 | `surface -> buy\|sell` by `log1p\|Δ\|/log1p(q99.5)`; zero = surface; `\|\| 1` fallback | `+/-/mid Q-fill`; Value transform, U = max finite, k = median nonzero, zero at midpoint; all-zero -> zero-only calibration | CELL | #46 | U15, U16, U43, U12, U13, U14 (buy=100/sell=100/volume=200), U20, B03 | done |
| C-04 | Cascade fill | `cellColour` 4283-4292, `cascadeEntry` 4231, `levelCascade` 4209 | `log2(4*share)`, `divergingColour(v/2, activity)`; non-ok states flat `colors.line`; entry colour cached per epoch | `+/-/mid Q-fill` on fixed log2 -2...+2 with ticks 1/4x..4x; typed non-values (`coarsest`->no-coarser-parent, `open`->waiting-for-complete-parent, `outside`, `none`) drawn with S1's basic keyed patterned mark [slices: S1 (mapping, typed states, basic mark); S2 (complete state geometry)] | FIXED | #46, #47 | U15, U16, U43, U12, U13, U14, B16, U20 | done |
| C-05 | Geometry outline | `fillCell` 4331-4342; lens 11317-11326 | `colors.volume` 1 px inset outline, alpha x0.4 in main, 0.65 in lens; legend says `var(--ol-line)` (4176) | `OCC` neutral outline, no magnitude scale; legend generated from the mark [slices: S1 (role + colour + legend), S2 (stroke geometry table)] | - | #46, #47 | U20, B16, B23 | done |
| C-06 | Cell gap and minimum size | `fillCell` 4345-4351 (`design.gap` 78), `motionMark` 10419, lens 11328-11333 | 1 px surface gap when both sides > 4 px; 0.1 px minimum; lens inset 0.3 | composition (surface gap is a region key, not data) [slices: S2 (unchanged in S1)] | - | #47 | S2: pixel | todo-S2 |
| C-07 | Selection fade | `draw` 984-989 | every `full.cells` cell drawn at alpha 0.25 under a selection, rectangle at 1.0 | removed by parent D6 (no fade); two-tone boundary instead [slices: S2 (unchanged in S1; S1 mapping changes flow through it)] | - | #47 | S2: fill-core equality | done |
| C-08a | Movement (Path, Dwell) traded-cell fill | `paintMotion` 10436-10467, `motionMark` 10416-10419, `motionAmount` 10372, `motionScale` 10381 | LUT by rank of `path/width x (full-cell time / covered time)` (Path) or `dwell/covered seconds` (Dwell) over all positive cells of `mv.full`; `q.scales[mode]` | `UM Q-fill`; Path = path/price-span (row spans), alt USDT moved and rows/min; Dwell = covered wall-clock; Explore per context; measured movement-only marks join the cohort [slices: S1 (amounts, scale, cohort), S2 (mark geometry)] | CELL | #46, #47 | U15, U16, U43, U12, U13, U14, U24, U26, U27, B17 | done |
| C-08b | Movement-only (no trade) mark | `motionMark` 10420-10423 | 1 px stroke inset 1 in the ramp colour when w,h > 3 | `Q-line` 1.5 px value core + <=3.5 px surface backing (S2 table) [slices: S2 (unchanged in S1)] | CELL | #47 | S2: stroke-core equality | done |
| C-08c | Movement mark too small to outline | `motionMark` 10424-10429 | 0.45-alpha fill in the ramp colour (a paler quantitative value) | keyed "detail unresolved" occupancy, not a paler fill [slices: S2 (unchanged in S1)] | - | #47 | S2 | done |
| C-08d | Movement "not measured yet" cell | `paintMotion` 10458-10466; `lensMotion` 11434-11441 | flat `colors.line` fill | `STATE` neutral keyed (pending/unsupported), visible against surface [slices: S1 (basic keyed mark for read states), S2 (complete)] | - | #46, #47 | B16 | done |

#### 3.2.2 Rows underlay, profile and Columns pane

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| C-09a | Rows Volume band | `bandTone` 4526, `paintBands` 4535, `underlayPeak` 4505 | `colors.ink`, alpha `0.2*sqrt(v/peakInView)`, full-width rows behind cells | `UM` contextual projection (S2: fixed 16 % precomposed blend); colour scale from all measured rows of the period [slices: S1 (scale/calibration), S2 (composition, strip)] | ROW, Explore per (period, row size, quality) | #46, #47 | U15, U16, U43, U24, U26, U27, U20, B10 | done |
| C-09b | Rows Delta band | `bandTone` 4528-4530 | `buy\|sell`, alpha `0.16*sqrt(\|Δ\|/peakInView)` | `+/-/mid`; symmetric U [slices: S1, S2] | ROW | #46, #47 | U15, U16, U43, U20, B10 | done |
| C-09c | Rows Relative volume band | `bandTone` 4528-4530, `relativeVolume` 7093, `paintBands` 4542 | `value/2` clipped to 1 -> alpha 0.16*t; `none` rows = -2 (full sell); populations differ (rectangle vs period) | `+/-/mid` on fixed log2 -2...+2; Relative volume v2 on common W; typed negative-infinite / no-reference / outside-W (outside W is not a zero-current row) [slices: S1 (v2 semantics, typed cases), S2 (draw only within W)] | FIXED | #46, #47 | U12, U13, U14 (identity=0 on several W), U15, U16, U43, B11 | done |
| C-09d | Rows Time-at-price band | `bandTone` 4527, `paintBands` 4541 (top 0.3) | `colors.time` mauve, alpha `0.3*sqrt(w/peak)` | `UM` (common unsigned language; mauve retired) [slices: S1 (token, scale), S2 (composition)] | ROW | #46, #47 | U15, U16, U43, U20, B10 | done |
| C-10 | Rows second profile | `paintReferenceTrack`, `referenceAxis` (was `underProfile` 4560-4612) | volume: `ink` alpha 0.16 + 1 px edge alpha 0.6; time: `colors.time` alpha 0.28; delta/relvol: `buy\|sell` alpha 0.35 from a centre line (`colors.line`, 4595); value-area bar `ink` alpha 0.4 2 px; POC dashed `[3,2]` ink 0.6 | length on an Independent Auto axis, labelled; adjacent track (S2); gold volume-derived POC/VA (S3) [slices: S1 (axis registry replaces `underlayPeak`), S2 (tracks), S3 (gold)] | PROF | #46, #47, #48 | U28, B18, B10 | todo-S3 |
| C-11a | Current profile bars | `paintCurrentTrack` (was `profile` 4365-4402, max at 4367) | total: `muted` alpha 0.32; POC row `colors.poc` alpha 0.75; length `v/max`, `max = d3.max(rows.v) \|\| 1` per draw | neutral length on Auto axis; gold POC [slices: S1 (axis), S2 (tracks)] | PROF | #46, #47 | U28, B18 | done |
| C-11b | Taker-buy subset bar | `paintCurrentTrack` (was `profile` 4394-4401) | `colors.buy` alpha 0.85, 0.7-2 px tall (a DATA-NAME rendered with a retired ROLE token) | neutral labelled inset on the current axis (unsigned; not positive blue) | PROF | #47 | U35 (allow only while listed), S2: profile | done |
| C-11c | Profile value-area fill | `paintCurrentTrack` (was `profile` 4377-4384) | `colors.volume` alpha 0.08 | REF:Profile (volume-derived), no market hue as fill [slices: S2/S3] | - | #47, #48 | - | done |
| C-11d | P / B POC lines, H/L value area, Level, pointer row, heading | `paintCurrentTrack`, `paintReferenceTrack`, `gutterLabels`, `pocGlyph`, `profile` (was `profile` 4404-4481) | P `colors.poc`, B `colors.buy` 1.5 px alpha 0.95 with leader and ink letter; H/L `muted` lines; Level dashed `[6,4]` ink 1.3; pointer-row ink 1 px; heading `muted` | REF:Profile gold for P and B (labels/endpoint glyphs distinguish), REF:User Level ink, IX [slices: S2 (profile tracks: gold POC and Buy POC glyphs), S3 (reference language, Level); unchanged in S1, blocks retiring `colors.buy`] | - | #46, #47, #48 | U35 | todo-S3 |
| C-12a | Column bars, unsigned | `activity` 8776-8814 | `colors.volume` alpha 0.65 for Volume, Trades, Trade size, Choppiness, Volume per path; `max = d3.max(\|value\|) \|\| 1` per draw over columns in view | `UM` constant neutral fill + length; labelled Auto axis over settled displayed data; undefined denominators -> typed non-value, not 0 | AXIS | #46 | U28, B18, U12, U13, U14, B16 | done |
| C-12b | Column bars, signed | `activity` 8808-8811 | `buy\|sell` alpha 0.65 about `zero` line (`colors.line` 8795) | `+/-/mid` sign/side with labelled symmetric axis | AXIS | #46 | U28, B18, U15, U16, U43 | done |
| C-12c | Column bars, ratios (Cascade column share, Efficiency) | `activity` 8803-8807, `ratioColumns` 8744, `cascadeColumnEntry` 4260, `efficiencyFrom` 8959 | value clamped +/-2, `divergingColour(v/2, 1)` alpha 0.85; non-ok columns: no bar | `+/-/mid` on fixed log2 with 1/4x..4x ticks; clipping counted (finite under/overflow triangle, negative-infinity marker); Efficiency may exceed +/-2; column Cascade +1 does not acquire +2 colour; model provenance | FIXED | #46 | U15, U16, U43, U12, U13, U14, U20, B19, B16 | done |
| C-12d | Column non-value / state hatches | `activity` 8820-8842, 8789-8791 | open parent: `colors.poc` 7 px alpha 0.25; outside/unavailable: `colors.line` 11 px alpha 0.6; replay-hidden `colors.line` 0.45; future `colors.bg` | `STATE`; S1 adds patterned non-value marks, hollow diamond baseline for undefined, zero baseline tick [slices: S1 (basic keyed marks), S2 (gold removed, full state table)] | - | #46, #47 | B16, B23 | done |
| C-12e | Pane label plate and scale text | `paneLegend` 8855-8887, `activity` 8848-8850 | plate `surface` alpha 0.85, text `muted`; scale `±compact(max)` or `±2` in the price-label column | `CHR` text generated from the axis registry ("Auto axis", domain, unit) [slices: S1 (text source), S3 (contrast audit)] | AXIS/FIXED | #46, #48 | U28, B18, U20 | todo-S3 |
| C-13a | RSI | `drawOscillator` 6890-6913 | line `ink` 1.5; guides 70/30 `line` dashed `[3,3]`; y = fixed 0-100; divergences `sell` (bearish)/`buy` (bullish) 2 px alpha 0.95 + 2.5 px dots | `FIXED` linear 0-100 with 30/70 guides; divergences neutral shape + relationship text (S3) [slices: S1 (axis registered fixed, token rename), S3 (markers)] | FIXED | #46, #48 | U28, B18 | todo-S3 |
| C-13b | MACD | `drawOscillator` 6852-6889 | hist `buy\|sell` alpha 0.45; signal `lineStyle("average","long")` 1.25; line `ink` 1.5; crosses r=3 dots `buy\|sell` with surface ring; `max` per draw `\|\| 1` | symmetric shared axis for MACD/Signal/histogram (Auto axis, frozen during gestures); positive/negative = MACD minus Signal with redundant sign [slices: S1 (axis, token), S3 (sign redundancy, cross labels)] | AXIS | #46, #48 | U28, B18 | todo-S3 |
| C-13c | Oscillator frame, hidden/future regions | `drawOscillator` 6797-6809 | surface fill; replay `hatchRect(line,11,.45)`; future `bg` fill; `timeGrid` | STATE/CHR [slices: S2 (unchanged in S1)] | - | #47 | - | done |

#### 3.2.3 Coverage, state, references, interaction, lens and text

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| C-14 | Page and plot background | `draw` 973-976 | `colors.bg`, `colors.surface` | CHR / surface key [slices: S2 (unchanged in S1)] | - | #47 | - | keep |
| C-15 | Grid, axes, axis text | `grid` 863, `timeGrid` 856, `axes` 870-909 | `colors.line` alpha 0.7 gridlines, baselines; `colors.muted` 11 px labels | CHR [slices: (unchanged in S1)] | NAV | #48 | - | keep |
| C-16a | Unavailable / hidden coverage hatches | `paintCoverage` 2117-2147, `hatchRect` 2103 | `colors.line` 11 px stripes alpha 0.6 / 0.45; future region `colors.bg`; labels `chartLabel` muted; feeds `coverageGap` 2150 | `STATE` [slices: S2 (unchanged in S1)] | - | #47 | S2 | done |
| C-16b | Measured-vs-requested bounds hatch | `paintCoverage` 2155-2194 | `colors.poc` 5 px alpha 0.35 on edges where measured bounds `b` differ from requested `r` | `STATE` partial measurement (not gold); S1 changes what is measured at viewport/selection edges, leaves the cue [slices: S2 (unchanged in S1)] | - | #47 | S2 | done |
| C-17 | Open column / coarse-corner marks | `paintUnfinished` 2200-2226 | `colors.poc`: hatch 7 px alpha 0.25, 3 px top cap alpha 0.8, "Open" label; 1 px corner ticks alpha 0.65 for coarser-than-requested cells > 6 px | `STATE` open cap / coarse mark [slices: S2 (unchanged in S1)] | - | #47 | S2 | done |
| C-18 | Cutoff and provisional boundary | `draw` 1036-1052 | `colors.muted` 1 px alpha 0.7 (cutoff), `[2,3]` alpha 0.8 (canonical boundary), `chartLabel` | `STATE` neutral line [slices: S2 (unchanged in S1)] | - | #47 | S2 | done |
| C-19 | Selection outline | `draw` 1017-1035 | `colors.accent` 1.5 px solid; 1 px `[4,3]` dashed while dragging | `IX` two-tone core + casing, corner ticks [slices: S2 (unchanged in S1)] | - | #47 | S2 | done |
| C-20 | Hover, table-hover, pointer row, crosshair | `draw` 1063-1107, `crosshair` 1191-1198, `chip` 791 | crosshair `colors.muted` alpha 0.6; hovered cell `ink` 1 px; table-hover cell `ink` 2 px (1083-1093); pointer row `ink` alpha 0.4; chips `ink` plate with `bg` text | `IX` (S2 stroke table); S1 owns only the readout numbers they show (2.5) [slices: S1 (readout seam, R-), S2 (geometry)] | - | #46, #47 | U21, U23, B03 | done |
| C-21 | Column POC polyline, untested rays, column value-area boxes | `markings` 4668-4755 | polyline: surface halo 3.5 px alpha 0.7 + `colors.poc` 1.7; rays `poc` alpha 0.36 + 2x2 dot 0.7; value-area boxes `muted` alpha 0.5 1 px; writes `markState.rays` (4717) | REF:Profile gold (all), value area gold-volume-derived [slices: S3 (unchanged in S1)] | - | #48 | S3 | todo-S3 |
| C-22a | Horizontal reference lines (period POC, VA, day POC, untested, session, structure, fibonacci) | `drawLines` 7599-7644, `lineStyle` 4955, `lineItems` 7145 | family colour from `lineStyle(family, tier)` = `lch(c *= tier.chroma)`, width `tier.width x weight`; halo `surface` alpha 0.85 (width+3); solid over span, `"1,3"` lead-in, `"5,4"` held extension; tick 4/2 px at period start | `REF:<family>`, stable 1.5 px, no timeframe tiers, D8 temporal patterns [slices: S3 (unchanged in S1)] | - | #48 | S3 | todo-S3 |
| C-22b | Curves (VWAP, MAs, Bollinger) | `drawLines` 7653-7692, `averageItems` 6532, `vwapCurves` 7517 | same styling; Bollinger mid dashed `[4,3]` (6587) | `REF:VWAP rust`, `REF:Averages olive`; Middle solid + label | - | #48 | S3 | todo-S3 |
| C-22c | Support-band and squeeze fills | `drawFill` 6604-6633; items 6564, 6593 | `lineStyle("average", tier).colour` alpha 0.16 (support band), 0.24 (squeeze) over measured cells | removed as area tints; boundary curves + event strip (parent D6) [slices: S2 (unchanged in S1)] | - | #47 | S2 | done |
| C-22d | Swing triangles, EQH/EQL, golden/death crosses, period ticks | `drawLines` 7719-7782, `structureItems` 7416 (size 5 vs 3.5 at 7467) | `lineStyle("level","short")` etc.; sizes by timeframe; crosses filled/ringed `lineStyle("average", tier)` | `REF:Price levels`, uniform glyph size; factual cross labels | - | #48 | S3 | todo-S3 |
| C-22e | User Level line | `drawLines` 7783-7792, `profile` 4404-4409 | dashed `[6,4]` `colors.ink` 1.3 (2 hot) on surface halo; tag `Level` | `REF:User Level ink` `[8,3,2,3]` + diamond endpoint | - | #48 | S3 | todo-S3 |
| C-22f | Line tags | `drawLineTags` 7947-8026, `tagInk` 8010 | plate `surface` alpha 0.92; name cell = family colour with ink `#15191c` or `#fff` chosen by `d3.lab(colour).l > 62`; value cell `colors.ink` | `CHR` plate with actual-contrast text | - | #48 | S3 | todo-S3 |
| C-23 | Clock lines and CME gap | `drawClock` 7822-7877, `CLOCK_LOOK` 7812 | `lineStyle("clock","long").colour`, alpha 0.6, per-kind dash `[]/[1,3]/[4,3]/[7,2,1,2]/[2,2]`, widths 1-1.7 and Deribit weight x1/1.5/2; CME gap fill alpha 0.16 + edges | `REF:Clock neutral`, stable width; gap tint removed (S2) [slices: S2 (gap tint), S3 (rest)] | - | #47, #48 | S2/S3 | todo-S3 |
| C-24 | Continuation cone and anchor line | `drawCone` 9493-9558, `draw` 1053-1062 | All: `muted` outline alpha 0.55/0.9 + inner fill 0.14; Matching: `evidence` fills 0.22/0.45; medians 2-2.5 px; barrier lines `[4,3]`; origin dot; anchor line `[3,4]` alpha 0.65 | `REF:Historical comparison neutral`; area tints removed (S2); square/circle median markers, labelled tracks (S3) [slices: S2 (tints), S3 (role)] | - | #47, #48 | S2/S3 | todo-S3 |
| C-25 | Transient lens | `drawResolutionLens` 11247-11386, `lensMotion` 11412, `lensCascade` 11389, `lensCaption` 11449 | opaque `surface`; cells via `cellColour(z, q, deltaMax)` with lens-local rank scale and lens-local `deltaMax`; movement lens-local; POC line `poc` 1.5; frame and caption frame `accent` 1.5; caption legend strings hard-coded 11297-11310 | `RP`; lens colour = shared active Cells mapping unless explicit Local contrast with its own descriptor and legend; frame two-tone (S2) [slices: S1 (mapping, legend, Local contrast), S2 (frame/plate), S3 (finer-record readout)] | LENS | #46, #47, #48 | U24, U26, U27, U20, U21, U23, B12 | todo-S3 |
| C-26 | Canvas text and plates (all) | `text` 757, `chartLabel` 768 (users: 1040, 1050, 1051, 2138-2147, 2213, 7740, 7780, 9557, 9558), `chip` 791, `drawLineTags` 7947, `paneLegend` 8855, `lensCaption` 11449, profile letters 4465, axes 870 | default `colors.muted` 11 px; labels in family or evidence colour directly on data | `CHR` with opaque plates where needed [slices: S3 (audit); S1 only for legend/axis text it generates] | - | #46, #48 | U19, U20, S3: contrast | todo-S3 |
| C-27 | Legend / axis text written by draw | `draw` 1116-1121 (`legendText` 4137, `LEGEND_TITLES` 4155, `legendRamp` 4171, `underlayLegend` 4636, `motionLegend` 10471) | see D-01, D-02 | generated from role/mapping records | - | #46 | U20, B23 | done |

Notes: C-06 to C-08 share the `design.gap` and minimum-size code that S2 owns. C-01 to C-04 and C-08a all end in one `fillRect` (4344-4351 and 10419), so one mapping seam covers them. C-11b and C-11d are DATA-NAME features drawn with retired ROLE tokens: the lint keys on the token (`colors.buy`), never on the variable `bv` or `bpoc`.

### 3.3 DOM consumers (D-): legends, keys, dots, resolution state and evidence tracks

The recorded runtime census (light and dark, 1500x950, popovers open) found exactly these DOM consumers of a market-hue token: `i#ol-ramp`, `i.ol-match-key`, `i.ol-plane-loading`, the three evidence bars, `i.ol-family-dot`, `i.ol-line-swatch`, the toolbar dots, `i.ol-res-coarse`, the plane kinds, `i.ol-data-key.unfinished` and `.coarse`, and `i#ol-rows-ramp`.

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| D-01 | Cells legend chip (ramp + text + title) | view.html 867-870 (`i#ol-ramp.ol-ramp`, `#ol-legend-text`, static text "USDT per cell · log"); CSS `.ol-legend` 1060-1068, `.ol-ramp` 1069-1075 (50x5 px, default gradient `panel -> volume`); JS `draw` 1116-1120, `legendText` 4137, `LEGEND_TITLES` 4155-4170, `legendRamp` 4171; new ids (INTEGRATION.md D.7): `#ol-legend`, `#ol-legend-marker`, `#ol-legend-marker-text`, `#ol-legend-pop` | text = p5 -> p95 of the rank array, or "Taker buys 25% · 50% · 75%", `Δ ±deltaMax`, "−2 · 0 · +2 vs an even share", "Occupied cells", `motionLegend`; ramp = 9 samples of the LUT for amounts, `sell -> neutral -> buy` for flow/cascade, `sell -> line -> buy` for delta (the delta mark's midpoint is the surface, not `--ol-line`), `var(--ol-line)` for geometry; detail only in `title` (mouse-only); ramp rewritten every draw (theme-safe) | generated executable legend: actual transform, clipping, geometry, ticks (1/4x..4x, 0-100 %, Δ zero), policy/calibration/clipping in the visible summary, detail reachable without a mouse; hover/table marker on the key | CELL/FIXED/LENS | #46 | U20, U21, U23, B16, B23, B04, B03 | done |
| D-02 | Rows legend chip | view.html 853-856 (`#ol-rows-legend`, `i#ol-rows-ramp`, `#ol-rows-legend-text`); CSS 1077-1082 (36 px); JS `underlayLegend` 4636-4667; new id: `#ol-rows-legend-pop` | text "0 -> compact(peak) USDT" / "Δ ±peak" / "−2 · 0 · +2 vs the period" / "0 -> dur(peak)" from the in-view peak `underlayPeak`; ramp written once per `data-kind` with `color-mix` of `ink`, `time`, `sell/buy` at 45 % over surface (4658-4666); default CSS gradient is `panel -> volume` while Rows is off | generated from the Rows mapping record: period identity, W where applicable, quality, row size, clipping; must sample the contextual blend actually painted (see risk 5.1) | ROW/FIXED | #46 | U20, B04, B10 | done |
| D-03 | Footer key strip (10 items, F-01..F-10 below) | view.html 1260-1292; CSS `.ol-status` 1414-1428, `.ol-status-keys` 1435-1445, `.ol-data-key*` 1457-1492; JS visibility 1123-1124, 2356-2359, 2989-2992 | hand-authored chips and text; 6 chips painted with `--ol-line`, `--ol-poc`, `--ol-muted`, `--ol-panel` | keys generated from the same role table as the chart/plane (parent D7); S1 adds generated keys only for its new non-value marks [slices: S1 (new keys), S2 (existing chips)] | STATE | #46, #47 | B16, B23 | done |
| D-04 | Toolbar Lines dots | view.html 249 (`#ol-lines-dots`), 250 (`#ol-lines-count`); CSS 559-580, hidden below container 1150 px (444-451); JS `renderLinesButton` 8531-8555 | one 8 px dot per family on, `style.background = lineStyle(f.colour,"long").colour`; rewritten only when `fams\|colourEpoch` changes; stale after a theme flip until `update()` (verified) | `REF:<family>` dots; grouping counts must not imply two same-coloured dots are different quantities [slices: S3 (unchanged in S1; S1 must fix nothing here but the contract lists the stale-on-flip behaviour)] | - | #48 | B04 (S1 covers new writers) | todo-S3 |
| D-05 | Family heads' dots | view.html 281, 340, 366, 392, 449, 492 (`i.ol-family-dot`); CSS 642-647; JS `renderLines` 8470-8475; `familyStatus` 8557-8601 writes the muted status line under each family (`.ol-family-status` CSS 663-670, no hue) | 8 px dot, inline background from `lineStyle(f.colour,"long")`, `dataset.colour` guard; written only while the popover is open | `REF:<family>`; Session and Structure share one family colour but are two menu subgroups | - | #48 | S3 | todo-S3 |
| D-06 | Line row swatches | view.html none (built by JS); CSS `.ol-line-swatch` 617-623 (14 px x `--weight`, background `--line`), `.ol-clock-swatch` 625-629, `.ol-level-swatch` 672-677 (dashed ink); JS `swatch` 8352, `lineRow` 8361, `renderLines` 8436-8445 (guard `dataset.look = colour\|width`), level row 8492-8513 | swatch shows the tier's colour and weight | `REF:<family>`, stable 1.5 px, D8 patterns, Level swatch = long dash-dot | - | #48 | S3 | todo-S3 |
| D-07 | Toolbar resolution indicator | view.html 78-104 (lock icons, `#ol-res-text`, `i.ol-res-coarse`); CSS 422-438; JS `update` 2993-3007 (`data-coarse`) | 7 px `--ol-poc` gold dot when the displayed level is coarser than requested | `STATE` neutral glyph, not gold [slices: S2 (unchanged in S1)] | - | #47 | B29, B31 | done |
| D-08 | Resolution plane (210 buttons) | view.html 189-195; CSS `.ol-plane` 840-913; JS `buildPlane` 10495, `planeButton` 10529, `focusPlaneCell` 10532, `planeKeys` 10537, `cellPixels` 10555, `refreshPlane` 10574-10627, `resolutionReadiness` 9740, `setPlaneStatus` 10491 | kind by first match: loading -> `--ol-evidence` a0.5; else not-ready -> hatch `line/surface` a0.8; else `px<6 \|\| py<6` small -> `--ol-volume` a0.3; `px>32 \|\| py>32` large -> `--ol-poc` a0.6; else ready -> `--ol-volume` a0.85; diagonal = ink border; current = ink fill scale 1.35 (overrides kind); hover/focus outline accent 2 px; runs only while the popover is open | orthogonal neutral state grid: availability x size x diagonal x current x focus (S2) [slices: S2 (unchanged in S1)] | - | #47 | B29, B31, U54 | done |
| D-09 | Plane key | view.html 196-203 (6 hand-written `<i>`); CSS 914-936 | swatches duplicate the button rules (`.ol-plane-key i.ol-plane-*`), no current/focus swatch | generated from the same table as the buttons | - | #47 | B29, B31 | done |
| D-10 | Evidence outcome tracks | view.html 1461-1513 (`.ol-track`, `#ol-bar-up\|flat\|down`, `#ol-base-*`); CSS 1648-1671; JS `evidenceUI` 9246-9351 (width % at 9303-9304) | matching = `--ol-evidence` 5 px bar; all-states = `--ol-muted` 3 px bar alpha 0.6; scale 0-100 % | `REF:Historical comparison neutral` with Matching/All labels, square/circle median markers [slices: S3 (unchanged in S1)] | FIXED | #48 | S3 | todo-S3 |
| D-11 | Evidence legend | view.html 1514-1518 (`i.ol-match-key`, `i.ol-all-key`); CSS 1672-1694 (`.ol-match-key` has no rule of its own: it inherits `.ol-evidence-legend i` -> `--ol-evidence`) | violet "Matching states", grey "All states", text about 80/50 % boxes | as D-10 | - | #48 | S3 | todo-S3 |
| D-12 | Menus: Cells, Columns, Rows, Period, Window, Price axis | view.html 37-43 (window), 224-230 (price axis), 731-797 (Cells, Columns, Rows), 820-851 (period); CSS `.ol-menu` 476-557; JS `buildModeMenu` 3530, `buildPaneMenu` 3565, `buildRowsMenu` 3600, `menuItem` 3422, `itemText` 3482, tables `MODE_INFO` 1721, `PANE_INFO` 1743, `ROWS_INFO` 6970 | text + check icon; chosen item background `--ol-on`; descriptions carry no hue; `data-hint` view.html 720 says "What the cells' colour shows" | `CHR`; copy must follow Amount/Intensity/policy naming [slices: S1 (copy for renamed measures and policy controls), S3 (help)] | - | #46, #48 | B16, B23 | todo-S3 |
| D-13 | Connection state pill | view.html 9-13; CSS 315-357; JS `renderLive` 12367-12407 (`data-state`) | ink border and ink text when not `live` | `STATE` neutral (not a measurement) [slices: -] | - | #48 | - | keep |
| D-14 | Control chrome (buttons, toggles, segments, selects, checkboxes, inputs, focus rings, grips) | CSS 92-280, 1366-1412 | `--ol-hover`, `--ol-on`, `--ol-raised`, `--ol-border`, `--ol-accent` (focus 2 px); 24/28/32 px heights, 44 px on coarse pointers (1922-1951) | `CHR`/`IX` [slices: S1 for any NEW control it adds (contrast + target size gates apply now); otherwise unchanged] | - | #46 | U18, U19 (new controls) | keep |
| D-15 | Tooltip container | view.html 879; CSS 1111-1147 | surface plate, ink text, `--ol-line` border | `RP` [slices: -] | - | #48 | - | keep |
| D-16 | Inspector (metrics, rows, cell counts, continuation state) | view.html 1303-1564; CSS 1495-1716; JS `querySummary` 2231-2362 | numbers in ink/muted; `.ol-measuring` dims stand-ins to opacity 0.45 (733-735); `#ol-evidence[aria-busy]` dims to 0.5 (1605-1607) | `CHR`; numbers come from the readout record (2.5) [slices: S1 (numbers), S3 (audit)] | - | #46, #48 | U21, U23, B03 | todo-S3 |
| D-17 | Drawer tables | view.html 1077-1128 (cells), 1167-1203 (cases); CSS 1270-1331; JS `buildCells` 2389, `evidenceCases` 9358 | hover row `--ol-hover`; state text column; no colour swatches | `IX` row link; fields from readout record [slices: S1 (numbers), S3 (roving access)] | - | #46, #48 | U21, U23, B03 | todo-S3 |
| D-18 | Replay transport, lens bar, Latest | view.html 880-986; CSS 1148-1201 | surface plates with `--ol-line` border and shadow | `RP` control surfaces (excluded from invariance pixels, S2) | - | #47 | - | keep |
| D-19 | Hint bubble, key caps, shortcuts dialog | CSS 749-774, 524-541, 1791-1803, 1718-1789; JS `keyCap` 3436, `showHint` 3743 (calls `keyCap` 3765) | `kbd` panel/border tokens; hint plate `ink` with `bg` text | `CHR` [slices: S3 (help update)] | - | #48 | - | keep |
| D-20 | Loading and update banners | view.html 698-706; CSS 1022-1034 | `--ol-panel` strip, muted/ink text | `STATE`/`CHR` [slices: -] | - | #48 | - | keep |
| D-21 | Icons | `svgIcon` 1766, `ICONS` 1705-1715 (used by `menuItem` builders 3462-3619 and `#ol-follow-icon` 3015); static SVG in view.html; CSS `.ol-icon` 92-101 | `stroke: currentColor`, no hue, no fill | `CHR` [slices: -] | - | #48 | - | keep |

### 3.4 Footer keys (F-)

The footer key strip is hand-authored at the baseline (F-01 to F-10); S1 adds generated keys only for its new non-value marks (N-05, `#ol-keys-scale`) and S2 converts the existing chips. Other status-bar text carries no hue.

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| F-01 | Footer key `#ol-key-zero` "Zero trades" | src/view.html 1261-1282; CSS chip rule: `.zero` transparent + 1 px `--ol-line` border (1464-1467); shown when `zero !== 0` (2356); hand-authored at baseline | Canvas mark it stands for: none: zero-trade cells are simply not drawn, so the chip matches no mark | `STATE`: known no-trade (per measure) with keyed mark [slices: S2 (unchanged in S1)] | STATE | #47 | S2: keys generated from the role table | done |
| F-02 | Footer key `#ol-key-open` "Unfinished" | src/view.html 1261-1282; CSS chip rule: `.unfinished` gold 45 deg hatch (1468-1474); shown when `openRows>0 \|\| unfinishedShown` (2357); hand-authored at baseline | Canvas mark it stands for: `paintUnfinished` gold hatch + top cap (2205-2215); pane open-parent hatch (8825) | `STATE` open cap, not gold | STATE | #47 | S2: keys generated from the role table | done |
| F-03 | Footer key `#ol-key-unavailable` "Unavailable / hidden" | src/view.html 1261-1282; CSS chip rule: `.unavailable` -45 deg `--ol-line` hatch (1475-1481); shown when `coverageGap` (2358; also true for the gold measured-vs-requested hatch); hand-authored at baseline | Canvas mark it stands for: `paintCoverage` line hatches (2127-2132) and gold partial-bounds hatch (2155-2194) | `STATE` | STATE | #47 | S2: keys generated from the role table | done |
| F-04 | Footer key `#ol-data-coarse` "Coarser than requested" (id breaks the `ol-key-*` pattern) | src/view.html 1261-1282; CSS chip rule: `.coarse` panel + 3 px `--ol-poc` left border (1482-1485); shown when `renderN()>S.n \|\| renderM()>S.m` (2359); hand-authored at baseline | Canvas mark it stands for: gold corner ticks (2216-2225) | `STATE` | STATE | #47 | S2: keys generated from the role table | done |
| F-05 | Footer key `#ol-key-moved` "Moved through, no trade" | src/view.html 1261-1282; CSS chip rule: `.moved` transparent + 1.5 px `--ol-muted` border (1486-1489); shown when `PACK.live && movementMode()` (2992); hand-authored at baseline | Canvas mark it stands for: ramp-coloured 1 px outline (10420-10423): chip colour differs from mark colour | `Q-line` key from the S2 stroke table | STATE | #47 | S2: keys generated from the role table | done |
| F-06 | Footer key `#ol-key-plain` "Not measured yet" | src/view.html 1261-1282; CSS chip rule: `.plain` `--ol-line` fill (1490-1492); shown when as F-05; hand-authored at baseline | Canvas mark it stands for: flat `colors.line` fill (10458, 11434): matches | `STATE` [slices: S1 (basic keyed mark), S2] | STATE | #46, #47 | B16, B23 | done |
| F-07 | Footer key `#ol-key-poc` "P · total POC" | src/view.html 1261-1282; CSS chip rule: none (text only); shown when `S.poc` (2989); hand-authored at baseline | Canvas mark it stands for: P line in `colors.poc`, letter ink | `REF:Profile gold` [slices: S2/S3] | - | #47, #48 | S2: keys generated from the role table | done |
| F-08 | Footer key `#ol-key-bpoc` "B · buy POC" (DATA-NAME label) | src/view.html 1261-1282; CSS chip rule: none; shown when `S.poc`; hand-authored at baseline | Canvas mark it stands for: B line in `colors.buy` (4432) | `REF:Profile gold`, label/glyph distinguishes Buy POC [slices: S2/S3] | - | #47, #48 | S2: keys generated from the role table | done |
| F-09 | Footer key `#ol-key-area` "H/L · composite 70%" | src/view.html 1261-1282; CSS chip rule: none; shown when `S.area` (2990); hand-authored at baseline | Canvas mark it stands for: muted H/L lines (4421-4426) | `REF:Profile` volume-derived | - | #48 | S3: keys generated from the role table | todo-S3 |
| F-10 | Footer key `#ol-ray-count` "<n> untested levels" | src/view.html 1261-1282; CSS chip rule: none; shown when `S.untested` (1124); hand-authored at baseline | Canvas mark it stands for: untested rays (4718-4729); `n` comes from `markState.rays`, written by `markings()` | `REF:Profile gold` | - | #48 | S3: keys generated from the role table | todo-S3 |
| F-11 | Footer key `#ol-key-detail` with its text `#ol-key-detail-text` "Detail unresolved: n of m moved-through cells" | src/view.html; written by `strokeKeysCommit` from the count of the last draw; new in S2 | Canvas mark it stands for: the neutral occupancy mark of a movement cell whose side is 3 px or less | `OCC` neutral, swatch from `STROKE.detail` | STATE | #47 | B26 | done |
| F-12 | Footer key `#ol-key-provisional` "Provisional edge" | src/view.html; shown while the archive boundary is on the plot; new in S2 | Canvas mark: the 1 px [2,3] neutral line | `STATE` neutral, swatch from `STROKE.provisional` | STATE | #47 | B26 | done |
| F-13 | Footer key `#ol-key-selection` "Selection" | src/view.html; shown while a selection is drawn; new in S2 | Canvas mark: the two-tone frame with corner ticks | `IX` ink core, surface casing, swatch from `STROKE.selection` | STATE | #47 | B26 | done |
| F-14 | Footer key `#ol-key-hover` "Linked cell" | src/view.html; shown while a cell is linked by the pointer or a table row; new in S2 | Canvas mark: the inset two-tone boundary | `IX` ink core, surface casing, swatch from `STROKE.hover` | STATE | #47 | B26 | done |
| F-15 | Footer key `#ol-key-inspect` "Inspect focus" | src/view.html; hidden, shown by #48's Inspect cursor; new in S2 | Canvas mark: none yet; the bracket painter is `STROKE.inspect` (2 px ink core in 4 px of surface, corner brackets) so #48 draws it without a new painter | `IX` ink core, surface casing | STATE | #47, #48 | B26 | done |

### 3.5 Readout, number and prose consumers (R-)

At the baseline none of R-01 to R-12 reads the encoder's inputs: each re-derives its number. The seam of S1 makes encoder input, scale coordinate, tooltip, table, inspector and legend marker come from one readout record. R-13 to R-15 are the prose consumers that must move with the code.

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| R-01 | Cell tooltip | `tooltip` 2857-2925 (`z` = `last.shown.map.get(c,r)`), `cascadeRows` 2567, `motionRows` 2522, `rowSection` 2708 | Derives today: Volume `z.v`, Trades `z.ct`, size `z.v/z.ct`, Taker buys `z.bv/z.v`, Taker-buy trades `z.bt/z.ct`, `Buy − sell = 2*z.bv - z.v`; Cascade `e.share`, `e.value`; motion recomputes covered `secs` and price `width` (2540-2541) | The one readout record of the frame (E.readout): shows RAW `z.v`, never the rate-normalised `amount()` the colour used; no scale coordinate, no calibration, no clipping | - | #46 | U21, U23, B03 | done |
| R-02 | Empty/unavailable cell tooltip | `tooltip` 2881-2904 | Derives today: state strings ("Still open: no trades yet", "No trades in this cell", "Loading this level from the cube", ...) | The one readout record of the frame (E.readout): typed non-value states are prose here | - | #46 | U21, U23, B03 | done |
| R-03 | Profile-row tooltip | `tooltip` 2811-2847 | Derives today: row `v`, `v/last.query.v`, trades, `bv`, `bv/v`, `bt/ct`, underlay row values | The one readout record of the frame (E.readout): same | - | #46 | U21, U23, B03 | done |
| R-04 | Pane (column) tooltip | `paneTip` 2598-2704, `oscillatorTip` 6924-6962 | Derives today: per-key formulas duplicated from `PANE_MEASURES` 8721-8739; undefined choppiness/volume-per-path prints `compact(0)` here (2661, 2666), "—" in `motionRows` (2550-2551), "—" for trade size (2685), and draws a 0-length bar | The one readout record of the frame (E.readout): bars and two tooltips disagree on what undefined looks like | - | #46 | U21, U23, B03 | done |
| R-05 | Rows row section | `rowSection` 2708-2757, `underlayMarks` 2775 | Derives today: period row value/share, `relativeVolume` `ratioText(e.value)`; `none` -> "−2 · it traded in the period, not in the ${where}" (2753) | The one readout record of the frame (E.readout): must become v2 typed cases (outside-W, negative-infinite) | - | #46 | U21, U23, B03 | done |
| R-06 | Reference tooltips | `lineTip` 8057, `structureTip` 8169, `averageTip` 6652, `clockTip` 7889 | Derives today: reference prices, dates | The one readout record of the frame (E.readout): S3 | - | #48 | S3: readout parity | todo-S3 |
| R-07 | Inspector | `querySummary` 2231-2362 | Derives today: totals, share `bv/v` (2324), signed taker volume (2328), dwell % of rectangle time (2299), path, partial/zero/open counts (2331-2354) | The one readout record of the frame (E.readout): S1 aggregate-inputs-first rule applies to any share shown | - | #46 | U21, U23, B03 | done |
| R-08 | Cells table | `buildCells` 2389-2492, `cellState` 2373, caption 2480-2482 | Derives today: raw `usdt(c.v)`, `c.ct`, `c.bv`, `c.bt`, path/dwell, state text; occupied + moved-through cells only ("zero cells omitted") | The one readout record of the frame (E.readout): no encoded-value/scale-coordinate/calibration columns; sparse by design (parent: sparse table need not list every empty cell) | - | #46 | U21, U23, B03 | done |
| R-09 | Cases table | `evidenceCases` 9358-9487 | Derives today: outcome, change, POC, excursion, `buyShare` | The one readout record of the frame (E.readout): S3 | - | #48 | S3: readout parity | todo-S3 |
| R-10 | Hover/table-hover linkage | `hover` (131), `tableHover` (132; set 3112, cleared 3116, 3211), `syncRowHover` 2494, draw 1065-1093 | Derives today: key `c,r` only | The one readout record of the frame (E.readout): S1 owns pointer/table-hover consumers; S3 owns keyboard/touch/lens parity | - | #46, #48 | U21, B03 | todo-S3 |
| R-11 | Lens | 11589-11595 | Derives today: tooltip hidden, `hover = null` while the lens is active | The one readout record of the frame (E.readout): no lens readout at baseline (S3) | - | #48 | S3: readout parity | todo-S3 |
| R-12 | Legend numbers | `legendText` 4137, `underlayLegend` 4636, `motionLegend` 10471, lens strings 11297-11310, pane scale text 8848-8850, oscillator scale 6889/6918 | Derives today: percentiles, per-draw maxima, hard-coded "25% · 50% · 75%", "−2 · 0 · +2" | The one readout record of the frame (E.readout): replaced by generated legends (D-01, D-02) | - | #46 | U20, U21 | done |
| R-13 | README.md prose that names colour roles or how a measure is shaded | README.md lines 18, 28-32, 38, 39, 41, 45-47 (baseline); the lint scans it as `README.md` | 'buy colour', 'sell colour', 'buy and sell colours', 'paler where less traded', 'full-cell rate', neutral grey Rows; family hues named | Reworded by role (positive, negative, midpoint) for the S1-owned measures; S2 and S3 sentences (RSI divergence colours, profile Buy POC, evidence, timeframe tiers) stay until their slice and are counted by the lint allowlist | - | #46, #47, #48 | U35, U37 | todo-S2 |
| R-14 | docs/data-and-semantics.md prose that names colour roles or how a measure is shaded | docs/data-and-semantics.md lines 13, 15, 17, 19, 49 (baseline); the lint scans it as `data-and-semantics.md` | 'shade by rank on one ramp', 'full-cell rate', 'buy colour above 0 ... sell colour below ... paler where less traded', pane ratios on the buy and sell colours | Rewritten with the four new headings of INTEGRATION.md D.13 (measurement bases and typed results; scales, policies and calibration; provenance; persistence) | - | #46, #47, #48 | U35, U37 | todo-S2 |
| R-15 | In-code prose that names colour roles: legend titles, help tables and comments | src/explorer.js: `LEGEND_TITLES` 4155-4170, comments of `bandTone`, `drawOscillator`, `PANE_MEASURES`, `divergingColour`, `cellColour`; `MODE_INFO` 1721, `PANE_INFO` 1743, `ROWS_INFO` 6970 | 'buy colour above half, sell colour below', 'Paler cells traded less', 'buy and sell colours', 'bearish in the sell colour and bullish in the buy colour' | Generated legend text (`E.text`) replaces the legend strings; comments and help strings follow the role names; RSI divergence wording stays with S3 | - | #46, #48 | U35, U20 | todo-S3 |

### 3.6 Consumers S1 creates (N-)

N-01 to N-08 come from the S1 checklist. N-09 to N-22 pre-register, with status `todo-S1`, one row for every new function that INTEGRATION.md D.2, D.4, D.5, D.7 and D.16 name and that will read `colors.*`; the completeness ratchet of U36 finds them by the function name in the second column.

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| N-01 | Policy control and status: Explore, Comparison lock, Auto color, Auto axis, Local contrast; Fit action | chart header near the Cells/Columns/Rows menus (view.html 707-871); new ids: `#ol-lens-local`, `#ol-lens-status` | Does not exist at baseline | `CHR`/`IX` | CELL, ROW, AXIS | #46 | U26b, B06, B07, B23 | done |
| N-02 | Scale notices: "Scale changed: resolution/period" (old/new ids), "Scale range exceeded", "Low discrimination", "No calibration", "Updating"/"Auto paused", "Short exposure", "Model extrapolated beyond fitted levels", replay provenance strings | legend chip and inspector | Does not exist at baseline | `STATE` text, no market hue | CELL, ROW, LENS | #46 | U26b, U27, B09, B13 | done |
| N-03 | Legend hover/table marker locating the value on the key | D-01 key (currently 50x5 px, too small for ticks); new ids: `#ol-legend-marker`, `#ol-legend-marker-text` | Does not exist at baseline | `IX` | CELL | #46 | U21, B03 | done |
| N-04 | Basic keyed non-value marks: neutral patterned mark, hollow diamond at an undefined column baseline, triangle for finite underflow, distinct negative-infinity marker, zero baseline tick | `cellColour` Cascade branch 4285, `activity` 8797-8843; drawn by `paintGlyph`, `patternFor` (N-09, N-10) | Does not exist at baseline | `STATE` | CELL, AXIS, ROW | #46 | U40, B16 | done |
| N-05 | Footer/legend keys for N-04, generated | D-03; new id: `#ol-keys-scale` | Does not exist at baseline | `STATE` | - | #46 | U20, B16 | done |
| N-06 | Efficiency/diagonal model provenance labels | tooltip, legend, inspector; constants ISO_A/ISO_B 27-28, `EFFICIENCY_EXPECTED` 8899, `diagonalM` 32 | Does not exist at baseline | text | FIXED | #46 | U30, B19 | done |
| N-07 | Import/URL-budget/storage-failure notices | views popover (view.html 631-675), `copy-status`; new ids: `#ol-notice`, `#ol-notice-text`, `#ol-notice-more`, `#ol-notice-dismiss` | Does not exist at baseline | text | - | #46 | U31, U32, U33, U48, B15 | done |
| N-08 | `docs/visual-contract.md` and the L-ROLE lint plus inventory-completeness ratchet | docs/, tests/unit; `tests/unit/role-lint.test.js`, `tests/unit/visual-contract.test.js`, `tests/fixtures/lint/` | Does not exist at baseline | - | - | #46 | U35, U36 | done |
| N-09 | Canvas glyph painter: hollow diamond, triangles, negative-infinity plate and zero tick, one `E.role.paint` call per mark | src/explorer.js: `paintGlyph()` (new, INTEGRATION.md D.2; package S); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `STATE` ink (`colors.state`), `OCC` for the zero outline; one glyph table shared with the keys | - | #46 | U40, B16 | done |
| N-10 | Cached `CanvasPattern` for the neutral patterned non-value marks (slate, dots, cross, slash), DPR-compensated | src/explorer.js: `patternFor()` (new, INTEGRATION.md D.2; package S); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `STATE` ink on the surface (`colors.state`, `colors.surface`); cache key kind, colour epoch and DPR | - | #46 | U40, B16 | done |
| N-11 | LUT cache over `E.lut.build(appearance, theme)`, keyed appearance id and theme | src/explorer.js: `lutFor()` (new, INTEGRATION.md D.2; package S); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | Appearance and theme select the LUT; the mapping id never changes with either | CELL, ROW, LENS | #46 | U18, B04 | done |
| N-12 | Theme-change hook at the end of `getColors`: `colourEpoch` increments, the theme is read from `colors.surface`, pattern and legend caches are cleared | src/explorer.js: `themeChanged()` (new, INTEGRATION.md D.2 and D.12; package S); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | Theme flip regenerates every colour writer without a refetch or an unrelated `update()` | - | #46 | B04 | done |
| N-13 | The per-draw resolution of every enabled colour channel into the frame `sc` (`cells`, `cellsFull`, `rows`, `lens`) | src/explorer.js: `scaleFrame()` (new, INTEGRATION.md D.2; package S); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | Consumers encode through `sc`; roles, LUT and surface colour come from one frame | CELL, ROW, LENS | #46 | U21, U23, B03 | done |
| N-14 | Fail-soft boundary: posts one notice and returns `INERT_SC`, whose `encode` writes the `occupancy` role with `colors.occupancy` | src/explorer.js: `scaleFault()` (new, INTEGRATION.md D.2; package S); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `OCC` outline only; readouts and legends return null; the page stays usable (DD-91) | - | #46 | B01, U46 | done |
| N-15 | Writes the Cells, Rows and lens legend chips, bar canvases and generated keys from the legend model | src/explorer.js: `legendWrite()` (new, INTEGRATION.md D.2 and D.7; package U); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | Legend generated from the mapping record; keys painted by `E.role.paint` in `colors.state` and `colors.occupancy` | CELL, ROW, LENS | #46 | U20, B04, B23 | done |
| N-16 | Legend detail popover (bar, ticks, details list, warnings, actions, key swatches) | src/explorer.js: `legendPop()` (new, INTEGRATION.md D.2 and D.7; package U); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | Keyboard-reachable detail generated from the same record; swatches painted by the shared glyph function | CELL, ROW, LENS | #46 | U20, B23 | done |
| N-17 | Hover and table-row marker on the legend key (`#ol-legend-marker`, `#ol-legend-marker-text`) | src/explorer.js: `legendMarker()` (new, INTEGRATION.md D.2, D.7 and D.16; package U); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `IX` marker at the true scale coordinate of the readout | CELL | #46 | U21, B03 | done |
| N-18 | Axis policy chip and popover (`#ol-axis-chip`, `#ol-axis-pop`): Auto axis, Frozen, No data, Updating | src/explorer.js: `axisChipWrite()` (new, INTEGRATION.md D.2 and D.7; package U); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `CHR`/`IX` text from the axis registry record | AXIS, PROF | #46 | U28, B18, B23 | done |
| N-19 | Rows band painter: the Rows mapping's role colour at the fixed `ROWS_ALPHA`, and the typed non-value ticks | src/explorer.js: `bandPaint()` (new, INTEGRATION.md D.5; package R); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `UM` rows role, `+/-/mid` arms, `STATE` ink for negative-infinite and no-reference ticks | ROW | #46 | U18, B10, B16 | done |
| N-20 | Rows frame registered as the `rowsFrame` hook: Explore over all measured rows of the period, fixed log2 for Relative volume | src/explorer.js: `rowsScaleFrame()` (new, INTEGRATION.md D.5 and D.16; package R); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `ROW`/`FIXED` frame, theme-safe LUT | ROW, FIXED | #46 | U17, B10, B11 | done |
| N-21 | Lens frame: Shared (the active Cells mapping) or Local contrast (its own descriptor) | src/explorer.js: `lensScaleFrame()` (new, INTEGRATION.md D.4; package L); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `LENS`, read only: it never creates or touches a store entry | LENS | #46 | U24b, B12 | done |
| N-22 | Pattern fill of movement cells the motion read has not covered (`pending`) or failed | src/explorer.js: `motionPattern()` (new, INTEGRATION.md D.4; package C); uses `colors.*` | Does not exist at baseline (pre-registered so that no Wave-2 package edits this file) | `STATE` neutral keyed marks through `patternFor`; `motionMark` keeps its signature | CELL | #46 | B16, B17 | done |

### 3.7 Wave 2 additions (new helpers that read `colors.*` and are not pre-registered above)

A Wave-2 package that adds a NEW top-level helper reading `colors.*` under a name that is not one of the pre-registered N-09..N-22 rows adds ONE row for it in its own subsection below and nowhere else in this file (DR-44). Use only the ID range of your subsection (two digits, no collisions between packages). Status `todo-S1` until package K sets it.

#### 3.7.S Package S (the spine): IDs N-30 to N-39

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|

#### 3.7.C Package C (cells): IDs N-40 to N-49

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|

#### 3.7.R Package R (rows): IDs N-50 to N-59

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|

#### 3.7.X Package X (columns and model): IDs N-60 to N-69

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|

#### 3.7.L Package L (lens and tiles): IDs N-70 to N-79

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| N-70 | Lens mark painter: one lens cell from what the lens frame's encoder left in the scratch mark: a fill from the mapping's table, a pattern for a typed non-value, an outline for an occupied cell with no magnitude (Geometry, No calibration, an unsigned zero), a flat low-alpha fill below 4 css px | src/explorer.js: `lensMark()` (new, INTEGRATION.md D.4; package L, added under DR-44); uses `colors.*` | Does not exist at baseline (the lens painted `cellColour`, a `colors.volume` Geometry outline and a flat `colors.line` fill inline) | `Q-fill` through the frame (`UM` and `+/-/mid` arms), `STATE` neutral keyed patterns, `OCC` outline in the occupancy ink | LENS | #46 | B12 | done |

#### 3.7.T Package T (readout consumers): IDs N-80 to N-89

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|

#### 3.7.U Package U (DOM): IDs N-90 to N-99

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|

#### 3.7.P Package P (persistence): IDs N-23 to N-29

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|

### 3.8 Slice S2 additions (#47)

| ID | Consumer | File / function / CSS rule | Current | Target role | Measurement / channel | Owner | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| N-30 | Two-tone boundary painter: a surface casing under an ink core for the selection frame, its corner ticks and the lens frame | src/explorer.js: `twoTone()`, `selectionFrame()` (new in S2) | Selection: `colors.accent` 1.5 px plus a 0.25 fade of everything outside; lens frame: `colors.accent` 1.5 px | `IX` interaction (ink core, surface casing) | - | #47 | U50, B26 | done |
| N-31 | Event strip: one lane per enabled event kind (4h squeeze, 1D squeeze, CME gap), opaque marks in the state ink, the lane name in the price column | src/explorer.js: `paintEvents()`, `eventLanes()`; src/encoding.js `E.role.unionSpans` (new in S2) | The squeezes and the CME gap were translucent areas over the cells (`drawFill` alpha 0.24, `drawClock` alpha 0.16) | `STATE` ink, fixed role | EVENT | #47 | U52, B27 | done |
| N-32 | Rows strip: the row values at full strength in a fixed 12 px column right of the heatmap, one block per effective row; the Rows legend popover has a bar for it beside the backdrop's | src/explorer.js: `paintRowsStrip()`, `legendPop()` (Rows bar) (new in S2) | Rows only drew a 16% projection over the cells and a second profile | the Rows mapping's unsigned or signed arms (`UM`, `+/-`) at alpha 1 | ROW | #47 | B28 | done |
| N-33 | Endpoint glyphs and gutter letters of a profile track: a filled triangle for the POC, a hollow diamond for the Buy POC, both gold, each with its letter a line of room apart | src/explorer.js: `pocGlyph()`, `gutterLabels()` (new in S2) | P and B letters on leader lines at the strip's edge, B in `colors.legacyBuy` | `REF:Profile` gold, the shape and the letter distinguish the two | PROF | #47 | B25, B26 | done |
| N-34 | The current track: the view's or selection's Volume with the taker-buy subset as a neutral ink inset, POC and Buy POC lines, the 70% area as a neutral fill | src/explorer.js: `paintCurrentTrack()` (new in S2) | One overpainted strip; the subset was a thin bar in `colors.legacyBuy` | neutral length on an Independent or shared axis | PROF | #47 | B25, U51 | done |
| N-35 | The reference track and the domains printed under the tracks | src/explorer.js: `paintReferenceTrack()`, `paintProfileDomains()` (new in S2) | The reference was painted behind the current bars at alpha 0.16 to 0.35, its axis not shown | the Rows measure over its period on its own or the shared axis; the domain as text under each track | PROF | #47 | B25, U51 | done |
| N-36 | The stroke-role table: one painter for each of empty, open, partial, provisional, moved through, detail unresolved, selection, linked, unavailable, pending and the two POCs; the plot and the footer keys paint from it | src/explorer.js: `twoToneOn()`, `STROKE`, `STROKE_KEYS`, `strokeSwatch()`, `strokeKeysCommit()` (new in S2) | The footer keys were hand-made CSS chips (gold hatch, gold border) that did not match the marks | `STATE` ink, `OCC`, `IX` ink and surface, gold for the POCs | STATE | #47 | B26 | done |

## 4. The retired-role ratchet

`tests/unit/role-lint.test.js` (U35) flags retired rendering roles and never the substring buy or sell. It classifies by colour-token namespace: `colors.<key>`, `--ol-<name>` (including `var(--ol-<name>)` and `--ol-tier-${tier}-width`) and the prose "<role> colour". Taker-buy DATA names (`bv`, `bt`, `bpoc`, `buyShare`, `taker_buy_volume`, sort keys, ids such as `#ol-buypoc-value`, labels such as "Buy USDT") live in no colour namespace and can never be hit. The prefix hazard `--ol-line` versus `--ol-line-*` is handled by matching whole token names.

| Pattern | What it catches | Contract rows |
|---|---|---|
| `colors.buy`, `colors.sell`, `colors.neutral`, `colors.time` and `--ol-buy`, `--ol-sell`, `--ol-neutral`, `--ol-time` | the retired signed and Time-at-price roles (renamed positive, negative, midpoint; mauve retired) | T-08, T-09, T-12, T-13, T-34 |
| `colors.volume`, `--ol-volume` | the green market hue (Geometry, column bars, value-area fill, plane kinds) | T-07, C-05, C-11c, C-12a |
| `colors.evidence`, `--ol-evidence` | the violet that competes with signed identity | T-11, C-24, D-10, D-11 |
| `--ol-tier-*`, `colors.tiers`, `PERIOD_TIERS` | timeframe tiers (not the data tiers `sources.recent`, `reference`, `overview`) | T-19, C-22a |
| `colors-key` | a retired key in the probe list of `getColors` | T-34 |
| `prose:buy-sell-colour` | "buy colour", "sell colour", "buy and sell colours", also across a wrapped comment | R-13, R-14, R-15 |
| `colors.poc@state`, `--ol-poc@state` | the Profile gold used for readiness state (coverage, open, coarse, plane Too large, footer chips) | T-10, C-16b, C-17, C-12d, D-07, D-08, F-02, F-04 |
| `colors.line@state`, `--ol-line@state` | the hairline used as a non-value mark (fails 3:1) | T-06, C-04, C-08d, C-16a, D-08, F-01, F-03, F-06 |

Token rules read the code with comments blanked (a comment paints nothing); the prose rule reads the text as written. A scoped rule (`@state`) fires only inside the named functions (`paintCoverage`, `paintUnfinished`, `activity`, `cellColour`, `paintMotion`, `lensMotion`) or selectors (`.ol-res-coarse`, `.ol-plane`, `.ol-data-key`).

**The two-sided ratchet** (TESTPLAN DD-T14). `tests/fixtures/lint/role-baseline.json` is the immutable ceiling, recorded from the baseline sources. `tests/fixtures/lint/role-allowlist.json` lists, per (file, pattern), the count still allowed, the contract rows the hits belong to and the slice that removes the last one. In every worktree: no hit outside the allowlist, no allowlisted count above the ceiling, every hit's function or selector named in a row of its entry. With `CONVERGENCE=1` the allowlist count must EQUAL the actual count, so a removed hit forces a lower count and K deletes an entry that reached zero.

Baseline hits (rendered from `role-baseline.json`; the file wins):

| File | Pattern | Baseline hits |
|---|---|---|
| `src/explorer.js` | `--ol-buy` | 3 |
| `src/explorer.js` | `--ol-neutral` | 1 |
| `src/explorer.js` | `--ol-sell` | 3 |
| `src/explorer.js` | `--ol-tier-*` | 2 |
| `src/explorer.js` | `--ol-time` | 1 |
| `src/explorer.js` | `colors-key` | 4 |
| `src/explorer.js` | `colors.buy` | 10 |
| `src/explorer.js` | `colors.evidence` | 5 |
| `src/explorer.js` | `colors.line@state` | 6 |
| `src/explorer.js` | `colors.neutral` | 1 |
| `src/explorer.js` | `colors.poc@state` | 9 |
| `src/explorer.js` | `colors.sell` | 8 |
| `src/explorer.js` | `colors.tiers` | 4 |
| `src/explorer.js` | `colors.time` | 2 |
| `src/explorer.js` | `colors.volume` | 4 |
| `src/explorer.js` | `PERIOD_TIERS` | 2 |
| `src/explorer.js` | `prose:buy-sell-colour` | 10 |
| `src/explorer.css` | `--ol-buy` | 1 |
| `src/explorer.css` | `--ol-evidence` | 4 |
| `src/explorer.css` | `--ol-line@state` | 6 |
| `src/explorer.css` | `--ol-neutral` | 1 |
| `src/explorer.css` | `--ol-poc@state` | 4 |
| `src/explorer.css` | `--ol-sell` | 1 |
| `src/explorer.css` | `--ol-tier-*` | 6 |
| `src/explorer.css` | `--ol-time` | 1 |
| `src/explorer.css` | `--ol-volume` | 4 |
| `README.md` | `prose:buy-sell-colour` | 4 |
| `docs/data-and-semantics.md` | `prose:buy-sell-colour` | 3 |

## 5. Baseline facts the contract relies on

### 5.1 Code-site counts at `8c82ca1` (`src/explorer.js` unless stated)

Verified by scanning `git show 8c82ca1:src/explorer.js` with comments blanked; they agree with the consumer map except where a row says otherwise. The completeness ratchet works on the per-function list of `colors.<key>` reads recorded in `tests/fixtures/lint/consumer-baseline.json`.

| Site | Baseline count |
|---|---|
| `colors.<key>` reads | 142 on 131 lines (accent 3, bg 5, buy 10, evidence 5, family 3, ink 18, line 17, muted 26, neutral 1, poc 15, sell 8, surface 21, tiers 4, time 2, volume 4) |
| `ctx.fillStyle =` | 42 |
| `ctx.strokeStyle =` | 28 |
| `ctx.globalAlpha =` and `*=` | 63 |
| non-empty `setLineDash([` | 9 |
| `fillRect(`, `strokeRect(` | 31, 13 |
| `line(`, `markLine(`, `hatchRect(` | 24 (25 by grep, which also matches a comment at 10798), 16, 13 |
| `text(`, `chartLabel(` | 14, 12 |
| `.style.background` writes | 4 (1120, 4660, 8474, 8541) |
| `style.setProperty` | 4 (3195, 3209, 8443, 8444) |
| `var(--ol-` in JS, in CSS | 20, 186 |
| custom properties defined in `src/explorer.css` | 50, of which 31 distinct `--ol-*` |

### 5.2 Overloaded tokens (one token, several unrelated roles)

| Token | Roles it plays at baseline |
|---|---|
| `colors.poc` / `--ol-poc` (gold) | Profile reference (P line, POC polyline, lens POC, untested rays, profile POC row); coverage-partial hatch (2156-2194); open/unfinished hatch and cap and "Open" label (2209-2213); coarse-corner ticks (2223); pane open-parent hatch (8825); toolbar resolution "coarse" dot (CSS 429-438); plane "Too large" kind (CSS 870-874); footer `.unfinished` and `.coarse` chips (CSS 1468-1485) |
| `colors.volume` / `--ol-volume` (green) | Geometry outline (4333, lens 11318); profile value-area fill (4380); unsigned column bars (8812); plane "Ready" and "Too small" kinds (CSS 860-869); default ramp gradient (CSS 1073) |
| `colors.evidence` / `--ol-evidence` (violet) | Anchor line (1060), continuation cone Matching, barrier lines, origin dot, "Matching" label (9508-9557); plane "Loading" kind (CSS 886-890); evidence tracks and legend (CSS 1655-1661, 1685-1691) |
| `colors.line` / `--ol-line` (hairline) | Gridlines and axis baselines; hatch stripes (unavailable/hidden); Cascade non-value cell fill (4285); motion "not measured yet" fill (10458, 11434); zero baselines; RSI guides; profile centre line; footer `.plain` chip and `.zero` border; plane base and unavailable kinds |
| `colors.muted` (grey text) | All secondary text; crosshair/cutoff/provisional lines; total-profile bars; column value-area boxes; value-area H/L; All-states cone outline; `.moved` chip border |
| `colors.ink` / `--ol-ink` == `--ol-accent` | Text; interaction outlines (hover, table-hover, pointer row, focus rings); level line; profile P/B letters; RSI and MACD lines; Rows volume band and second-profile fill; chip plate; user Level identity; plane diagonal/current |
| `colors.surface` | Plot background, casing/halo for lines and triangles, lens interior, plates, delta-zero cell colour, ramp-theme detector |
| `--ol-line-*` vs `--ol-line` | Name collision: five reference-family tokens share the prefix of the hairline token; a prefix regex over `--ol-line` matches both |
| word "tier" | Two meanings: data tiers (`sources.recent\|reference\|overview`, motion tiers) and line timeframe tiers (`short\|medium\|long`, `--ol-tier-*`, `TOGGLES[k].tier`, `PERIOD_TIERS` 4933, `lineTier` 4946) |

### 5.3 Taker-buy data names the lint must allow

| Class | Occurrences (baseline) |
|---|---|
| Cell/row/column fields | `bv`, `bt` (66 and 40 whole-word occurrences in `src/explorer.js` at the baseline), `bpoc` (514, 533, 545, 1472, 2322, 2835, 4432, DOM id at 2989), `buyShare` (9212, 9410, 9469), `q.bv/q.bt` from `taker_buy_volume`/`taker_buy_trade_count` (1467-1472), bars `bv` (5183, 5192); block cells `bv` (302, 314, 9895) |
| Sort keys and ids | `CELL_SORTS` `buyvol`, `buytrades` (39-40, 2420-2421), `CASE_SORTS` `buy` (45, 9410), `data-sort="buyvol"\|"buytrades"`, `data-case-sort="buy"`, `#ol-buyvol`, `#ol-buycount`, `#ol-buypoc-value`, `#ol-key-bpoc` |
| Visible labels naming the measure | "Buy USDT", "Buy trades", "Buy share" (view.html 1101-1107, 1196-1197), "B · buy POC" (1280), "Taker-buy USDT/trades" (1361, 1364), "Buy POC centre" (1378), "Buy share · volume" (1387), tooltip "Taker buys", "Taker-buy trades", "Buy − sell", "Buy − sell trades", "Buy point of control" (2673-2681, 2835, 2842-2843, 2914-2916), "lower/middle/upper buy-share third" (9258-9260), `MODE_INFO`/`PANE_INFO`/`ROWS_INFO` "Taker-buy minus taker-sell USDT" (1724, 1746, 6973), legend "Taker buys 25% · 50% · 75%" (4143-4144, 11301) |
| Server/wire | tools/cube_bridge.py `taker_buy_volume`, `taker_buy_trade_count`, `taker_buy_poc`, `tbvol`, `tbcnt`, `buyVolume`, `buyTrades` (lines 29, 46, 59, 62, 67, 117, 203, 211, 323, 325, 386, 450-451, 679, 871-872, 903); `buyVolume`/`buyTrades` are not read by src/; docs/data-and-semantics.md `buy_volume` (13) |

### 5.4 Bridge cases: a data feature drawn with a retired role token

| Case | Location | Why it matters |
|---|---|---|
| taker-buy subset bar in `colors.buy` | `paintCurrentTrack` (was `profile` 4394-4401) | resolved in S2: a neutral inset in the ink on the current axis |
| Buy POC line/label in `colors.buy` | `paintCurrentTrack`; F-08 | the canvas mark is gold in S2 (dashed line, hollow diamond glyph, letter B); the footer key F-08 follows with the generated keys of section 4 |
| `S.mode === "flow"` naming ("Taker flow") drawn positive/negative | `cellColour` 4278 | fine: the name is data, the colours become `+/-/mid` |
| README/help prose describing a data measure in role words | README.md, docs/data-and-semantics.md, help strings (R-13, R-14, R-15) | reword by role, keep data names |

Each has an owner in the inventory (C-11b, C-11d, F-08, C-02) and stays in the allowlist until it moves; none is exempted by name.

### 5.5 Known baseline behaviour the contract records

- After an OS colour-scheme flip the toolbar Lines dots (D-04) keep the old scheme's colours until an unrelated `update()`; `.ol-family-dot` and `.ol-line-swatch` are written only while their popover is open. S3 owns them; every new colour writer of S1 is refreshed by `themeChanged()` (N-12) and covered by B04.
- Reduced motion is read once at load (line 48) and only nulls the 170 ms level-change morph; new legends and notices are static.
- The recorded page has no motion, OHLC, bars, moving averages, VWAP, Time-at-price or oscillators: C-08, the motion measures of C-12, C-13 and the live-only families of D-06 are exercised only through the fake cube.
- The image carries only `index.html`, `vendor/` and the two bridge Python files (the Dockerfile `COPY` set, mirrored by the `.dockerignore` allowlist); this file and the tests never ship, and the lint reads sources, not the built `index.html`.

## 6. CSS rules that paint with a market hue or a keyed neutral state (baseline `src/explorer.css`)

A rule using `--ol-poc`, `--ol-volume`, `--ol-evidence` (and, through JS, `--ol-buy`, `--ol-sell`, `--ol-neutral`, `--ol-time`) is a market-hue consumer; a rule using `--ol-line`, `--ol-panel`, `--ol-muted` or `--ol-ink` as a swatch is a keyed-neutral or interaction consumer. No CSS rule uses `--ol-buy`, `--ol-sell`, `--ol-neutral` or `--ol-time`: those four reach the screen only through JS.

| Lines | Selector | Declaration | Token | Consumer |
|---|---|---|---|---|
| 23 | `#origo-lens` (custom property) | `--ol-line-poc: var(--ol-poc)` | poc | T-14 |
| 429-438 | `.ol-res-coarse`, `.ol-res[data-coarse="true"] .ol-res-coarse` | 7 px circle, `background` | poc | D-07 |
| 560-580 | `.ol-lines-dots`, `.ol-lines-dots i` | 8 px dots, `box-shadow: 0 0 0 1px var(--ol-surface)`; `background` written by JS | family colours | D-04 |
| 617-629 | `.ol-line-swatch`, `.ol-clock-swatch` | `background: var(--line, var(--ol-muted))`, height `var(--weight)` | JS-set family colour | D-06 |
| 642-647 | `.ol-family-dot` | 8 px circle; `background` written by JS | family colours | D-05 |
| 672-677 | `.ol-level-swatch` | `border-top: 1.5px dashed var(--ol-ink)` | ink | D-06 |
| 733-735 | `.ol-side-context.ol-measuring ...` | `opacity: 0.45` on stand-in numbers | - | D-16 |
| 847-859 | `.ol-plane button` | base `background: var(--ol-line)`, `opacity: 0.55` | line | D-08 |
| 860-864 | `.ol-plane button.ol-plane-ready`, `.ol-plane-key i.ol-plane-ready` | `background`, `opacity: 0.85` | volume | D-08, D-09 |
| 865-869 | `...ol-plane-small` (button and key) | `background`, `opacity: 0.3` | volume | D-08, D-09 |
| 870-874 | `...ol-plane-large` (button and key) | `background`, `opacity: 0.6` | poc | D-08, D-09 |
| 875-885 | `...ol-plane-unavailable` (button and key) | `repeating-linear-gradient(135deg, line 2px, surface 2px 4px)`, `opacity: 0.8` | line, surface | D-08, D-09 |
| 886-890 | `...ol-plane-loading` (button and key) | `background`, `opacity: 0.5` | evidence | D-08, D-09 |
| 891-907 | `.ol-plane button.ol-plane-path`, `[aria-pressed="true"]`, `:hover`, `:focus-visible` | ink border (diagonal); ink fill + scale 1.35 (current); accent outline 2 px | ink, accent | D-08 |
| 926-936 | `.ol-plane-key i`, `.ol-plane-key .ol-plane-path` | base `background: var(--ol-panel)`; diagonal = ink border | panel, ink | D-09 |
| 1069-1075 | `.ol-ramp` | default `linear-gradient(panel -> volume)`, 50x5 px; overwritten inline by JS after the first draw | panel, volume | D-01 |
| 1077-1082 | `.ol-rows-legend .ol-ramp` | 36 px width; same default gradient until `underlayLegend` sets one | panel, volume | D-02 |
| 1457-1463 | `.ol-data-key` | 11 px chip `background: var(--ol-panel)` | panel | F-01..F-06 |
| 1464-1467 | `.ol-data-key.zero` | transparent, `border: 1px solid var(--ol-line)` | line | F-01 |
| 1468-1474 | `.ol-data-key.unfinished` | `repeating-linear-gradient(45deg, poc 0 1px, transparent 1px 4px)` | poc | F-02 |
| 1475-1481 | `.ol-data-key.unavailable` | `repeating-linear-gradient(-45deg, line 0 1px, transparent 1px 4px)` | line | F-03 |
| 1482-1485 | `.ol-data-key.coarse` | panel fill + `border-left: 3px solid var(--ol-poc)` | panel, poc | F-04 |
| 1486-1489 | `.ol-data-key.moved` | transparent, `border: 1.5px solid var(--ol-muted)` | muted | F-05 |
| 1490-1492 | `.ol-data-key.plain` | `background: var(--ol-line)` | line | F-06 |
| 1648-1654 | `.ol-track` | 5 px track `background: var(--ol-panel)` | panel | D-10 |
| 1655-1661 | `.ol-track span` | fill `background: var(--ol-evidence)`, width set by JS (9303-9304) | evidence | D-10 |
| 1662-1671 | `.ol-probability .ol-base-track`, `... span` | 3 px, fill `var(--ol-muted)`, `opacity: 0.6` | muted | D-10 |
| 1685-1694 | `.ol-evidence-legend i`, `.ol-evidence-legend .ol-all-key` | key bars: evidence (Matching, no dedicated `.ol-match-key` rule) and muted (All) | evidence, muted | D-11 |
| 1605-1607 | `#ol-evidence[aria-busy="true"] > :not(.ol-section-heading)` | `opacity: 0.5` while a result for the previous view is up | - | D-16 |
| 351-357 | `.ol-state-pill:not([data-state="live"])` | ink border, ink weight-500 text | ink | D-13 |

## 7. Decision list (DECISIONS.md, binding)

Where a decision says a consumer changes, the last column names the rows. DR-01 is the decision that removes the hidden activity paleness.

| ID | Decision | Contract rows |
|---|---|---|
| DR-01 | Flow x activity: REMOVED. The hidden activity multiplier (`tradedLevel`, `divergingColour`'s level argument) is deleted; denominators and activity (volume, trades, exposure) stay in readouts. A bivariate colour-by-activity encoding is deferred, not shipped; Cascade never has a second variable. | C-02, C-04, R-13, R-14, R-15 |
| DR-02 | Palette: a low-chroma neutral-slate unsigned magnitude LUT as a NEW appearance id (appearance version 2, `slate2`), provisional, no human validation claimed. Signed roles are positive, negative and midpoint (baseline hexes unchanged). The baseline yellow-green-blue RAMP stays as a named comparison appearance (`ramp1`). 256 entries per (appearance, theme, role); idx 0 is the lowest nonzero entry with dE2000 >= 5 from the surface; adjacent dE2000 <= 2; L* monotone away from the surface; low-discrimination bands idx <= 12 and idx >= 243. | T-27, T-28, T-29, N-11, C-01 |
| DR-03 | Mapping ID: 96-bit truncated SHA-256 over canonical JSON of schema version, kind, signed, parameters and clip policy. It excludes units, measure, context, cohort, provenance, appearance, theme and LUT. | N-11 |
| DR-04 | Names: `auto`, `locked`, `tier` and `neutral` are not reused for the new vocabulary. Policies are `explore`, `comparison` (label Comparison lock), `auto` (Auto color, Auto axis) and `local` (Local contrast); state lives under `S.scale`. | N-01, T-13 |
| DR-05 | Controls: no new global keyboard shortcuts. Basis, transform and scale policy are chosen in a Scale section of the Cells (and Rows) menu plus a generated, keyboard-reachable legend detail popover. Intensity and Rank are not new `S.mode` values. | N-01, D-12, D-01 |
| DR-06 | Explore cohort: initialised once after coherent, settled data from fully measured cells in the declared view or selection; then frozen; contexts are keyed on the EFFECTIVE level; during a level change resolve by lookup only. | C-01, N-13 |
| DR-07 | Comparison lock is ONE action: it holds each enabled colour mapping (per compatibility class) and freezes each registered Auto axis; Fit while locked replaces the mapping and stays locked; explicit locks are exempt from replay future-fit invalidation but labelled as an external comparison override. | N-01, N-02 |
| DR-08 | Quality class: Cells are single-valued `exact`; Rows are `exact`, `approx-rows` or `approx-start`; provisional data after the canonical cutoff is provenance, not a quality class. | C-09a |
| DR-09 | Signed Value uses one pooled (U, k) over both signs; empty cohort gives No calibration (never U = 1); all-zero gives a zero-only calibration; all-equal nonzero maps to the maximum; rank all-equal gives 0.5. | C-03, C-09b |
| DR-10 | Short exposure follows the fractions t/(BASE*2^n) and w/(PR*2^m), strictly below 10 percent on either; it labels Intensity, Path and Dwell; it is a usability cue, never confidence. | R-01, N-02 |
| DR-11 | Screen-area share: computed in a settled pass from cell boxes (not the paint hot path); the numerator is out-of-range marks; non-values and the lens are excluded; the lens reports its own shares. | N-02, C-25 |
| DR-12 | Path is path over width in row spans (the old full-cell-time extrapolation is removed); Dwell is a linear 0-100 percent share of covered column seconds; zero or unknown exposure is a typed non-value; negative or excessive dwell is an `invalid-input` result, never clamped; interior gaps are disclosed as unobservable. | C-08a, C-12a |
| DR-13 | One MODEL_PROVENANCE record; a three-state status on the effective UTC cutoff in all modes (retrospective, timing-unverified, eligible-by-bound); Efficiency reads 'within fit' only when n and n+1 are both in 6-13. | N-06, C-12c |
| DR-14 | Persistence keeps the storage keys and adds `visualVersion: 2`; addresses always carry `vis=2` and `ap=<appearance id>`; one shared VISUAL_KEYS table; limits 8192 characters, 257 knots, 1 MiB decoded, 16 descriptors, enforced on read and write; a deterministic degrade ladder; portable codes are self-contained gzip+base64url JSON; failures are visible notices. | N-07 |
| DR-15 | The transient lens SHARES the active Cells mapping; Local contrast is an explicit separate descriptor outside the 64-context LRU; lens tiles never become the main display source before Pin; Pin discloses 'Scale changed: resolution/period'. | C-25, N-21 |
| DR-16 | Replay: a record is eligible iff its observation end is at or before the paint-time cutoff at the current level; otherwise the newest eligible prior record, the retained pending mapping (same context only) or No calibration; live and replay stores are separate; forward Play freezes Auto. | N-02 |
| DR-17 | Generation and settling: `acceptedState()`, a separate `calibrationSettled()` (`gesturing()` is not broadened), single-flight fits off the read pumps, Auto at most once per 500 ms after a 200 ms settle, no new read kind. | N-13 |
| DR-18 | Axes: a string-keyed axis registry with typed domains replacing every `\|\| 1`; MACD, signal and histogram share ONE symmetric axis; Rows colour is period-wide Explore and the reference-profile length is a separately registered Auto axis. | C-10, C-11a, C-12a, C-13b, N-18 |
| DR-19 | Relative volume v2: W is the selection's (else the view's) price support; restricted sums; coarse recorded rows count only fully covered common bins; outside W is outside-support, never a zero-current row. | C-09c |
| DR-20 | Roles, tokens, lint: `--ol-buy`, `--ol-sell`, `--ol-neutral` become `--ol-positive`, `--ol-negative`, `--ol-midpoint` (hex unchanged); pending unsigned or reference uses get interim `--ol-legacy-*` names; the lint is token-namespace based, allows taker-buy DATA names and keeps an allowlist keyed (file, pattern, count) that only shrinks; `--ol-line` and `--ol-neutral` fail 3:1 and never colour non-value marks. | T-08, T-09, T-13, T-27, T-28, T-29, T-32, T-33, N-08 |
| DR-21 | Non-value presentation (S1 basic set): neutral patterned marks, hollow diamond for an undefined column baseline, triangle for finite under/overflow, a distinct negative-infinity marker, the zero baseline tick and zero Delta at the midpoint, all generated from one glyph and role table that S2 extends. | N-04, N-05, N-09, N-10 |
| DR-22 | One readout record per draw feeds the encoder, tooltip, legend marker and drawer table (DD-17 satisfies it at frame level); the drawer table level mismatch is fixed inside the migration. | R-01, R-08, R-10 |
| DR-23 | Deploy gate: `deploy.yml` calls `check.yml` through `workflow_call`, needs it, compares the SHA it reports, keeps `concurrency: deploy-main`; no emergency bypass; GitHub-side runtime semantics are not certified from the repository. | - |
| DR-24 | Harness: root `package.json` (private, no type, Node 22, exact `@playwright/test` 1.63.0 as the only devDependency), quoted unit glob, browser tests through Playwright, reports to gitignored `reports/`, allowlist `.dockerignore` and deploy filter. | - |
| DR-25 | Fake cube: a zero-dependency Node http server that fakes the bridge's HTTP boundary exactly, with a seeded synthetic trade store, fault injection and an independent BigInt reference calculator; `pack.source` carries a SYNTHETIC label. | - |
| DR-26 | Benchmarks: committed configuration, seed, schema and pure statistics; the D12 procedure implemented as code and run on THIS machine as non-designated-environment evidence; timing never gates CI. | - |
| DR-27 | Docs: this file (the full consumer inventory, decision list and test inventory) is checked by a Node unit test (completeness ratchet plus role lint); README and `docs/data-and-semantics.md` are updated; THIRD_PARTY_NOTICES records the d3 hash. | N-08, R-13, R-14 |
| DR-28 | Module shape: `src/encoding.js` is ONE dual-environment file inlined by `build.py` through the `__EXPLORER_ENCODING__` marker; `explorer.js` imports through one namespace object `E`; the indicator maths moves into it unchanged. | N-08 |
| DR-29 | Ratifies FROZEN.md items 1-4 and 7: DD-17 satisfies DR-22 at frame level; DD-64 (axis domains scanned in `registry.frame()`), DD-70 (Short exposure literally), DD-86 and DD-87 (the `rows` LUT role, `Lut.bar` at index 160, hashes `slate2-8f7890f7` and `ramp1-a53783c5`) stand; the operator-level recommendations of TESTPLAN Appendix C are accepted. | T-27, N-11 |
| DR-30 | Process: parts-in-repo, the H7a and H7b split, package D and the fixed Wave-2 merge order are approved; the merger regenerates and commits `index.html` after each merge; the PR keeps its commits. | - |
| DR-31 | The named-view cap (DD-68) is VOID: S1 adds no cap; storage quota and write failures are made visible instead of limiting the number of named views. Import limits stay exactly those of D9. | N-07 |
| DR-32 | Worktrees live under the session scratchpad, never in the main worktree; commits end with the attribution line; nobody pushes. | - |
| DR-33 | `LIMITS.NAMED_VIEWS_MAX` was removed from the header part (DR-31); no part, test or seams list may reference it. | - |
| DR-34 | E.hash contract as implemented: `id96` canonicalises inside; `b64ToF64` returns null on bad text; `b64urlDecode` is strict; `E.result.make` throws on a missing required field; `quantile7` of an empty array returns NaN. | - |
| DR-35 | E.text obligations: one entry per typed tag named exactly as the tag; `E.text.fill` is a function; `E.result.describe` calls both lazily. | - |
| DR-36 | Assembler: the extra structural rules of WORKPLAN 2.2 (directives first, one declaration per statement, no tabs, ASCII outside comments and text, the 29 API keys); part 23 splits the squeeze constants. | - |
| DR-37 | Fixtures: `tests/fixtures/indicators/` belongs to H3, the recorded baseline outputs go to `tests/fixtures/indicators-baseline/`; every top-level fixture directory carries a valid `provenance.json`. | - |
| DR-38 | The integration branch carries the harness of round 0 (package.json and lockfile, `.nvmrc`, ignore and deploy filters, `THIRD_PARTY_NOTICES.md`, `tests/support/{rng,enc,assemble-encoding}.js`, `tools/build.py` with `--out`, parts 01-03); base worktrees on tag `s1-r0` or later. | - |

## 8. Design-decision register (API.md Appendix D)

One line per decision; the reasons are in the section named in the last column of API.md. A row marked SUPERSEDED is kept so that references stay readable. TESTPLAN.md keeps its own DD-T sequence.

| ID | Decision | Where |
|---|---|---|
| DD-01 | `factory()` takes no dependencies; d3 is only a test oracle | A.1 |
| DD-02 | no module-level mutable state; stateful helpers are factories with injected clocks | A.1 |
| DD-03 | one frozen sub-namespaced export; `explorer.js` never destructures | A.1 |
| DD-04 | typed alphabet = D2's 12 cases + `undefined` + `invalid-input` (14 tags); zero is `finite 0` | B.1 |
| DD-05 | read/coverage precedence order failed > pending > unsupported > hidden > outside > structure > math | B.1, C.1.2 |
| DD-06 | formula ids start at `@1`; `rows.relvol@2` | B.3 |
| DD-07 | fixed mappings are descriptors (`fixed-linear`, `fixed-diverging`) with shared ids | B.5 |
| DD-08 | `S.scale` field names avoid `auto/locked/tier/neutral` | B.8 |
| DD-09 | rank cohort = finite positives; rank only for unsigned unbounded measures | C.3 |
| DD-10 | one Type-7 routine for `k` and the rank knots | C.4 |
| DD-11 | warning denominators (defined-value marks, clipped areas, settled pass) | C.11 |
| DD-12 | axes include every displayed column; complete/partial counted as provenance | C.4.3 |
| DD-13 | Lab in the d3-color convention (D50), own implementation, d3 as oracle | C.6 |
| DD-14 | two appearances: `slate2` (default, provisional) and `ramp1` (comparison) | C.6 |
| DD-15 | signed arms = two-stop Lab ramps from the CSS-token hex constants; CSS equality test | C.6 |
| DD-16 | zero separately keyed: signed zero = midpoint fill; unsigned zero = occupancy outline | D.4 |
| DD-17 | one kernel, two outputs: allocation-free `encode`, on-demand `readout` from the per-draw frame | D.3 |
| DD-18 | Comparison lock holds each active colour mapping per compat class; manual domain holds only its class; only active descriptors persist (amended by DD-65: keyed `channel\|class`) | C.9 |
| DD-19 | Auto keeps the active descriptor when a refit is equal within tolerance | C.10 |
| DD-20 | eligibility in integer ms; `obsEnd = min(observed edge, cut at fit)`; explicit locks exempt and flagged | C.9 |
| DD-21 | controller: per-channel 500 ms cap, leading-edge immediate; state passed in, not stored | C.10 |
| DD-22 | under lock, a class/axis with no held descriptor falls back to Explore/Auto with the label "not held by Comparison lock" (evaluated per channel, DD-65) | C.9 |
| DD-23 | axis ids use dots; `nav.*` are read-only and never persisted | B.12 |
| DD-24 | Relative volume memo key `[res.rows id, query id, w0, w1, bm]` | C.2 |
| DD-25 | table/tooltip level fix: level-carrying keys, `tableHover` carries `{c,r,n,m}` | D.3 |
| DD-26 | lens tiles are flagged and never become the display source before Pin (amended by DD-96: a pure predicate, no promotion side effect) | D.4 |
| DD-27 | `VISUAL_KEYS` replaces the ten parallel lists; address grammar and `checkView` move into `codec` behind an `env` | C.13 |
| DD-28 | portable code `origo-cube:2.` (gzip) with an uncompressed `origo-cube:2j.` fallback; `inflate`/`deflate` injected | C.13 |
| DD-29 | limits enforced on write and read; the 8192 counts the full URL (the named-view cap of DD-68 is void, DR-31: no cap on named views) | C.13 |
| DD-30 | token renames (`--ol-positive/negative/midpoint`), interim `--ol-legacy-buy/sell`, aliases `--ol-occupancy/--ol-state`, `--ol-time` removed | D.11 |
| DD-31 | Scale section = `menuitemradio` groups in the Cells/Rows menus; manual domain and actions in the legend popover | D.7 |
| DD-32 | every S1 string in `E.text` | D.11 |
| DD-33 | SUPERSEDED by DD-70 (Short exposure follows DR-10 literally: strict <10% on either fraction, for any measure with an exposure denominator) | C.1.3 |
| DD-34 | quality classes: Cells `exact`; Rows `exact \| approx-rows:<rowPrice> \| approx-start` | B.7 |
| DD-35 | model status uses the effective cutoff in all modes | C.14 |
| DD-36 | tolerance helpers `E.measure.close` with propagated Delta/log-ratio bounds | C.1.1 |
| DD-37 | glyph and pattern painting via injected ctx/canvas; plot, keys and legend use the same functions | B.9 |
| DD-38 | Cascade structure is decided before the child lookup | C.1.7 |
| DD-39 | SUPERSEDED by DD-42 (appearance id from source constants) | C.6 |
| DD-40 | the first fit of an axis with no record is immediate even during a gesture | C.12 |
| DD-41 | Local contrast pending: previous local descriptor (Updating) else the shared mapping labelled "Local contrast pending" | D.4 |
| DD-42 | appearance id = name + first 8 hex of the two-theme LUT byte hash (`slate2-75cc0784`, `ramp1-90c3f71e` in the first design; `slate2-8f7890f7`, `ramp1-a53783c5` after DD-86); reverses DD-39 to follow DR-02 literally | C.6 |
| DD-43 | `S.scale.curve` (`log`/`linear`) exposes D3's linear alternative for both colour channels; address key `cv` (made reachable by DD-71) | B.8 |
| DD-44 | `E.scale.plan(desc)`: per-descriptor precomputed evaluator, memoised in a `WeakMap` keyed by the descriptor object (the one permitted module-level memo, an exception to DD-02 because it is unobservable and needs no reset); frames hold the plan | A.3, C.16 |
| DD-45 | the legend bar is a canvas blit of `E.legend.barPixels` (exact LUT through the transform), not a CSS gradient | B.11 |
| DD-46 | a pending calibration request polls every `RETRY_MS` (200 ms) while its reads are incoherent, besides waking on data events (bounded by DD-79: visible tab and an outstanding view read only) | C.10 |
| DD-47 | `Observation.revision` names a provisional replacement or "revision status unknown"; set only by `applyLive` | B.2 |
| DD-48 | `tooltip(p, {redraw = true})`; `refreshTip()` at the end of `draw()` re-derives the readout without scheduling a frame (amended by DD-93: stamp stored on every path, guarded against a null or hidden tip, marker cleared with the tip) | INTEGRATION D.3 |
| DD-49 | one popover per chip (`ol-legend-pop`, `ol-rows-legend-pop`, `ol-axis-pop`) filled by one builder, because `bindPop` toggles on a second click of the same panel | INTEGRATION D.7 |
| DD-50 | Wave 2 packages join through an optional-hook registry `scaleHooks` so any merge order stays runnable; direct calls replace it at convergence | INTEGRATION D.16 |
| DD-51 | shared legacy code (`amount`, `ramp`, `legendText`, `tradedLevel`, tokens `--ol-buy` ...) is deleted only by the convergence package | WORKPLAN 4 |
| DD-52 | `encoding.js` is authored as numbered parts, prefix-checked and assembled by a script; after assembly the file is the source of truth (parts live in the repository, DD-75) | A.2, WORKPLAN 2 |
| DD-53 | the observation surface for browser tests (chip `data-*` attributes, readout attributes, notice codes) is authoritative in INTEGRATION D.18; `notice.version` is the DOM guard | INTEGRATION D.18 |
| DD-54 | the model record is `E.model.PROVENANCE` only; DR-13's `MODEL_PROVENANCE` is its concept name | B.13 |
| DD-55 | `TIMING` (ms cadences) and `THRESHOLDS` (numeric screens and tolerances) are separate constants; `LATTICE` holds the recorded lattice defaults | A.3 |
| DD-56 | address keys `bs pb tr cv rt cp rp lc sw lk`; `pb` values `s` (default), `u`, `m`; `tr`, `rt` value `r`; `cv` value `l` | B.15 |
| DD-57 | SUPERSEDED by DD-87 (`Lut.bar` = unsigned entry 160; entry 153 composited to 2.94:1 at the painted opacity) | B.9 |
| DD-58 | `E.util` is public (`clamp`, `quantile7`, `median7`, `lowerBound`, `upperBound`) so that tests and every part share one Type-7 routine | A.3 |
| DD-59 | cross-part calls go only through `API.<ns>.<fn>` (call-time) and the header constants; a part never names another part's private helpers | A.2 |
| DD-60 | Wave 2: a consumer function receives the per-frame object `sc` as its LAST parameter; existing parameters keep their positions and dead ones are removed at convergence | INTEGRATION D.16 |
| DD-61 | the new CSS tokens (`--ol-positive`, `--ol-negative`, `--ol-midpoint`, `--ol-occupancy`, `--ol-state`, `--ol-legacy-buy`, `--ol-legacy-sell`) are added in Wave 1 next to the old ones; the old ones are removed at convergence | INTEGRATION D.11 |
| DD-62 | `state.js` grows additively in Wave 1 (`read(key)` statuses, `scales`, `notice`, `backup`); the existing properties keep their shape until the persistence package migrates callers | INTEGRATION D.9 |
| DD-63 | Wave 2 packages do not edit `src/encoding.js`; a missing string or helper is requested from the encoding owner (WORKPLAN 7); a local literal marked `TEXT(S1)` is allowed until then | WORKPLAN 4 |
| DD-64 | (AM-02) axis domains are computed inside `registry.frame()` at draw time (an O(displayed values) scan with no sort; DR-17's ban is on cohort fits); `registry.nextWake` and `hasPending` let the spine timer wake the refit after a gesture, Play pause or the 500 ms cap | C.12 |
| DD-65 | (AM-03) `S.scale.held` is keyed `channel\|classKey`; a Cells hold or manual domain never reaches Rows; the lock holds each channel's own active mapping and the legend shows original support | C.8, C.9 |
| DD-66 | (AM-09) a narrowed share window keeps its kind: Taker flow = symmetric half-width -> `fixed-diverging{0.5-h, 0.5+h, 0.5}`; Dwell = `fixed-linear{lo, hi}`; asymmetric input is rejected | C.5, B.5 |
| DD-67 | (AM-11, A-16) an "authorized fit" passed `coherent`, `settled`, replay eligibility, quality class and policy; never a partial arrival, placeholder, failed read or one forbidden by the lock | C.10 |
| DD-68 | (AM-20) no `snapshot:v1` key; `backup(key)` is tested; VOID (DR-31): there is no named-view cap and no `NAMED_VIEWS_MAX`; a failed write is a visible notice and the running state stays usable; a named view stores a portable `code` only at ladder level 1 or worse and only when the code is <= 64 KiB | INTEGRATION D.9 |
| DD-69 | (AM-21) axis policy travels implicitly in addresses (absent = Auto, `lk=1` + `a.<id>` records = Frozen) and explicitly in portable codes; `applyVisual` applies `ap` and posts `appearanceMismatch` | B.15, C.13 |
| DD-70 | (AM-05) Short exposure follows DR-10 literally: strict < 0.10 on EITHER fraction, for any measure with an exposure denominator (`usesOf` only decides applicability) | C.1.3 |
| DD-71 | (AM-04) `curve` is reachable: reducer action `{type:"curve"}`, `offers().curve`, and three Transform items (Value (log), Value (linear), Relative rank) in the Scale section | C.9, INTEGRATION D.7 |
| DD-72 | (AM-13) the Mark-role record and the `ROLES` table (S1 roles, reserved S2/S3 rows) including the named `rows-projection` role | B.9 |
| DD-73 | (AM-14) `E.measure.ROWS` catalogue; `E.policy.offers(channel, subject, scale, live)`; `E.cohort.columns` returns counts only | A.3, C.4.3 |
| DD-74 | (AM-22) `resolve` has no "retained" branch (it could never fire); "Updating" is set by `scaleFrame` from a pending `ctl` want; at a Rows rollover the new key shows No calibration | C.9, C.10 |
| DD-75 | (AM-24) the encoding parts are authored in the repository at `tools/encoding-parts/NN-name.js`, committed on the `wp/` branches, assembled at A0 and deleted by the A0 commit | A.2, WORKPLAN 2 |
| DD-76 | (AM-01) three consumer hooks (`cellsMarks`, `rowsMarks`, `paneMarks`) feed the warning tally; `scaleTick`'s warnings pass runs them; the lens tallies inside `drawResolutionLens` | C.11, INTEGRATION D.16 |
| DD-77 | (AM-06) the committed-equality half of U02, U35 and U36 runs only with `CONVERGENCE=1`; every worktree runs the determinism and ceiling halves; H11 pre-registers rows for new functions | TESTPLAN U02, U35, U36 |
| DD-78 | (AM-07) H7 is split (H7a Wave 1, H7b Wave 2); B09 and B13 belong to S; B16 is split B16a/b/c; B02 belongs to K | WORKPLAN 4.2 |
| DD-79 | (FA-04) `viewReadPending()`: a FAILED read is not outstanding; the retry poll is bounded to a visible tab with a view read outstanding | C.10, INTEGRATION D.2 |
| DD-80 | (FA-05) `coherent` has no `loadState` term; `coverage.ok := s0 <= a && s1 >= e` from `viewRange()` and `sourceRange(displaySource())` | C.10 |
| DD-81 | (FA-06) `scaleArm()` is O(1) and allocation-free; `noteGesture()` always arms; `heldCount()`; `ctl.hasWants()`; `pointercancel` and `blur` call `noteGesture()` | C.10 |
| DD-82 | (FA-07) `S.scale` keeps RAW preferences; `E.policy.effective(scale, mode)` is what consumers read; `sanitize` is for imports only; `M` cycling never destroys Intensity or Rank | A.3, B.8 |
| DD-83 | (FA-08) `axisFrame(id, spec)` is a spine function (S0, inert body first) used by X and R; `axisOf` does not exist | INTEGRATION D.2 |
| DD-84 | (FA-09) the Cells frame's `read` is `null` unless the DISPLAYED block cannot answer; `meas.state` never makes a cell fill a pattern | C.16 |
| DD-85 | (FA-10) one kernel object and one `plan` per frame; `cellValue(kernel, out)` | C.16, A.3 |
| DD-86 | (FA-11) a `rows` LUT role (raw stops whose 16% composite passes the screens), painted at `globalAlpha = ROWS_ALPHA`; hashes `8f7890f7...` (slate2) and `a53783c5...` (ramp1); ids `slate2-8f7890f7`, `ramp1-a53783c5` | C.6, Appendix A.1 |
| DD-87 | (FA-12) `Lut.bar` = unsigned entry 160; contrast is asserted on the composite at the painted opacity | B.9 |
| DD-88 | (FA-14) `viewParts()` extracts the derived view data of `draw()` (S0, pixel-neutral) for `draw` and every cohort and marks hook | INTEGRATION D.1, D.16 |
| DD-89 | (FA-15) Relative volume v2 runs in the draw path behind its memo (O(rows in W)), not on the settled tick; ids via `objId` | C.2, INTEGRATION D.5 |
| DD-90 | (FA-18) `E.legend.keyOf(...)` computed from ids before the model is built | A.3, B.11 |
| DD-91 | (FA-23) production paths are non-throwing (`E.text.fill`; `fillStrict` for tests); the S1 additions of `draw()` sit in one try/catch (`scaleFault`, `INERT_SC`); a missing module fails the startup with a visible message | INTEGRATION D.1 |
| DD-92 | (FA-28) `cutMs`, `fittedAtMs` and `token16` stay out of `sc` records so `viewHash()` does not change on every live advance | B.15 |
| DD-93 | (FA-02) see DD-48: `tooltip` stores `scaleRt.tipStamp` on EVERY path, `refreshTip` runs only for a non-null `hover` and a visible tip, the legend marker follows the tip and the table row and is cleared whatever hid them | INTEGRATION D.1, D.8 |
| DD-94 | (AM-19) Local contrast is a `menuitemcheckbox` in the Cells Scale section (DR-05) and in the lens bar, both bound to `S.scale.local`; a main-chart warning offers Fit, Auto color and "Open lens" | C.11, INTEGRATION D.7 |
| DD-95 | (AM-15) zero-only calibration is observable: `apply` sets `clip = HIGH`, `data-state="zero-only"`, a `zero-only` warning, the out-of-domain key | C.4 |
| DD-96 | (FA-03) `lensOnly(s, want)` is a pure predicate used by `chooseSource`, `exactSource` and `resolutionReadiness`; `tileWant` is unchanged; the lens tile never flips `meas.state` | INTEGRATION D.4 |
| DD-97 | (FA-26, AM-06) after each merge the merger regenerates and commits `index.html` on the integration branch (packages never commit it), so `build.py --check` stays unconditional in CI; the S0 parity spec runs with `reducedMotion: "reduce"` | WORKPLAN 4.1, 5 |
| DD-98 | (FA-17, FA-19, FA-20) DOM writes: `#ol-lens-status` mirrors only the stable part of the lens caption; there is no `data-frame` attribute in production; the axis chip's position is refreshed on every draw from `G` | INTEGRATION D.7, D.18 |
| DD-99 | (FA-24) the assembler's purity lint is identifier-aware and ignores comments and string contents, so the public field `window` (manual share window) passes | WORKPLAN 2.2 |

## 9. Test index

Unit tests run with `npm test`; browser specs with `npm run test:browser`. `U46` and the browser specs are written in Wave 2, so their files do not exist while Wave 1 is being merged; with `CONVERGENCE=1` U36 requires every listed file to exist.

| ID | File | Covers | Owner package |
|---|---|---|---|
| U01 | `tests/unit/repo.test.js` | package.json, lockfile, d3 hash, Docker and deploy allowlists, fixture provenance | H1 |
| U02 | `tests/unit/build.test.js` | build determinism, page equals committed index.html (CONVERGENCE=1 only), script order, check_names, check_inline, marker count | W1-X |
| U03 | `tests/unit/wire.test.js` | MSC2/MSC3/MSCB/MSCC round trip and golden payloads | H2 |
| U04 | `tests/unit/tails.test.js` | the bridge tails() delta-or-whole rule | H2 |
| U05 | `tests/unit/fake-routes.test.js` | the fake cube's routes, proto check and error bodies | H2 |
| U06 | `tests/unit/reference.test.js` | the exact-rational reference calculator against hand-computed trades | H3 |
| U07 | `tests/unit/fake-vs-reference.test.js` | fake cells, motion and bars equal the reference within D4 tolerances | H3 |
| U08 | `tests/unit/snapshot.test.js` | independent decoder over data/snapshot.json; the snapshot only tests the measures it contains | H3 |
| U09 | `tests/unit/independence.test.js` | reference code imports nothing from src/ or tests/support | H3 |
| U10 | `tests/unit/seams.test.js` | every export of API.md A.3 exists; the 29 namespace keys; d3-free load | W1-X |
| U11 | `tests/unit/hash.test.js` | SHA-256 against node:crypto, canonical JSON, 96-bit ids | W1-A |
| U12 | `tests/unit/measure-bases.test.js` | Amount, Delta, Intensity, Path, Dwell bases and their typed results | W1-B |
| U13 | `tests/unit/exposure.test.js` | exposure for whole, cut and open cells; Short exposure boundaries | W1-B |
| U14 | `tests/unit/ratio-cases.test.js` | the D2 typed table in precedence order (Cascade, Efficiency, ratios) | W1-B |
| U14b | `tests/unit/relative-volume.test.js` | Relative volume v2 on a common support W; identity gives 0 | W1-B |
| U15 | `tests/unit/scale-value.test.js` | Value transform log1p(abs(x)/k)/log1p(U/k), the fit and its clipping | W1-C |
| U16 | `tests/unit/scale-rank.test.js` | 257-knot Type-7 rank against three oracles | W1-C |
| U17 | `tests/unit/cohorts.test.js` | which cells, columns, rows and movement marks join a cohort | W1-C |
| U18 | `tests/unit/lut.test.js` | LUT screens (gamut, adjacent dE2000, L* monotone, idx 0 vs surface), appearance ids and hashes | W1-D |
| U19 | `tests/unit/contrast.test.js` | WCAG contrast of the real tokens and of every S1-introduced text and control pair | W1-D |
| U20 | `tests/unit/legend.test.js` | the generated legend model equals the encoder at every ticked coordinate | W1-F |
| U21 | `tests/unit/readout.test.js` | one readout record per cell: encoder, tooltip, table and legend marker agree | W1-F |
| U22 | `tests/unit/clipping.test.js` | finite and infinite endpoints, clip counts, screen-area share | W1-E |
| U23 | `tests/unit/equivalence.test.js` | last-bit source equivalence and propagated tolerances | W1-F |
| U24 | `tests/unit/contexts.test.js` | context keys on the effective level; what a key excludes | W1-C |
| U24b | `tests/unit/store.test.js` | calibration store: LRU 64, protection, eligibility, live/replay isolation | W1-E |
| U25 | `tests/unit/lifecycle.test.js` | coherence, the 200 ms settle, the 500 ms Auto cadence | W1-E |
| U26 | `tests/unit/comparison-lock.test.js` | one-action Comparison lock, compatibility classes, Fit while locked | W1-E |
| U26b | `tests/unit/policy.test.js` | policy reducers, resolve branches, offers(), effective versus sanitize | W1-E |
| U27 | `tests/unit/replay.test.js` | replay eligibility obsEnd <= cut, backward scrub, forward Play | W1-E |
| U28 | `tests/unit/axes.test.js` | axis registry catalogue, typed domains, freeze, wake times | W1-E |
| U29 | `tests/unit/indicators.test.js` | indicator functions moved with no behaviour change | W1-A |
| U30 | `tests/unit/provenance.test.js` | MODEL_PROVENANCE and the three-state status boundaries | W1-A |
| U31 | `tests/unit/persistence-address.test.js` | VISUAL_KEYS, address grammar, vis=2 and ap ids, legacy keys | W1-G |
| U32 | `tests/unit/persistence-code.test.js` | portable code round trip, size limits, bounded inflate, rejection reasons | W1-G |
| U33 | `tests/unit/persistence-storage.test.js` | storage read statuses, quota and access failures, foreign entries kept | W1-G |
| U34 | `tests/unit/legacy-migration.test.js` | every legacy setting migrates by the persistence table | W1-G |
| U35 | `tests/unit/role-lint.test.js` | role-aware lint over the sources and the two-sided allowlist ratchet | H11 |
| U36 | `tests/unit/visual-contract.test.js` | this file: columns, ids, statuses, completeness ratchet, decision list, test index | H11 |
| U37 | `tests/unit/docs-text.test.js` | README and docs drift guards and required statements | D |
| U38 | `tests/unit/benchmark-stats.test.js` | benchmark statistics with a seeded PRNG | H9 |
| U39 | `tests/unit/benchmark-config.test.js` | the versioned benchmark configuration against its schema | H9 |
| U40 | `tests/unit/nonvalue-glyphs.test.js` | the role and glyph table, one source for plot, keys and legend | W1-D |
| U41 | `tests/unit/formatting.test.js` | canonical numbers do not depend on presentation formatting | W1-F |
| U42 | `tests/unit/workflows.test.js` | workflow line guards for the deploy gate | H10 |
| U43 | `tests/unit/fixed-transfer.test.js` | fixed transfer functions: taker shares linear 0-100 percent, no activity term | W1-C |
| U44 | `tests/unit/result.test.js` | typed results: tags, precedence, JSON safety | W1-A |
| U45 | `tests/unit/util-time.test.js` | time and utility helpers | W1-A |
| U46 | `tests/unit/boundary.test.js` | explorer.js contains no retired identifier and every hook is called directly | K |
| U47 | `tests/unit/assemble.test.js` | assembler lint rules, ordering and requires-closure loading | W1-X |
| U48 | `tests/unit/notice.test.js` | notice coalescing, once-per-digest, dismissal | W1-F |
| U49 | `tests/unit/hot-path.test.js` | no allocation, sort or d3 call in the steady-frame encoder | W1-F |
| U50 | `tests/unit/two-tone.test.js` | a two-tone boundary has a 3:1 component over every fill, empty and state backdrop | #47 |
| U51 | `tests/unit/profile-tracks.test.js` | the shared partition, windows and shares of the profile tracks against exact rational sums | #47 |
| U52 | `tests/unit/event-spans.test.js` | the merge of one event kind's intervals for the event strip, against brute-force connectivity | #47 |
| U53 | `tests/unit/occlusion-budget.test.js` | the 20% union-area occlusion budget: overlaps once, priority, the focused mark, against a set-based replay | #47 |
| U54 | `tests/unit/plane-glyphs.test.js` | the plane's glyphs reach 3:1 on their tiles in both themes and use no market hue | #47 |
| B01 | `tests/browser/boot.spec.js` | boot in recorded and live mode, the 29 module keys, production globals | H7b |
| B02 | `tests/browser/recorded-snapshot.spec.js` | real recorded blocks through the page | K |
| B03 | `tests/browser/readout-agreement.spec.js` | tooltip, table row, legend marker and pixel agree for every measure | T |
| B04 | `tests/browser/cells-edge.spec.js` | a theme flip at run time recolours the marks from the other LUT with no refit and no request (formatting invariance is U41) | S1 |
| B05 | `tests/browser/explore-lifecycle.spec.js` | one Explore mapping per effective context across zoom levels | S |
| B06 | `tests/browser/preset-context.spec.js` | presets, Fit and Auto keep or change the context | S |
| B07 | `tests/browser/comparison-lock.spec.js` | Comparison lock across levels, Rows and unlock | S |
| B08 | `tests/browser/auto-policy.spec.js` | Auto color and Auto axis timing, gesture and Play freeze | S |
| B09 | `tests/browser/warnings.spec.js` | Scale range exceeded and Low discrimination with actual shares | S |
| B10 | `tests/browser/rows.spec.js` | Rows period, quality, row size and the period-wide mapping | R |
| B11 | `tests/browser/relative-volume.spec.js` | Relative volume v2 in the page | R |
| B12 | `tests/browser/lens-pin.spec.js` | transient lens, shared and Local contrast, Pin | L |
| B13 | `tests/browser/replay.spec.js` | replay eligibility, scrub, Play, override, rollover | S |
| B14 | `tests/browser/persistence-fresh.spec.js` | fresh-browser round trips and migration | P |
| B15 | `tests/browser/persistence-limits-faults.spec.js` | malformed, oversized, unknown and unavailable storage cases | P |
| B16 | `tests/browser/nonvalues.spec.js` | basic keyed non-value presentation (B16a Cells, B16b Rows, B16c Columns) | C, R, X |
| B17 | `tests/browser/motion-measures.spec.js` | Path, Dwell, Intensity and viewport portions | C |
| B18 | `tests/browser/axes.spec.js` | Auto axis, MACD/RSI/ratio axes, freeze and persistence | X |
| B19 | `tests/browser/model-provenance.spec.js` | Efficiency and diagonal model labels and status | X |
| B20 | `tests/browser/recovery-faults.spec.js` | coherence and recovery through the fake's fault knobs | S |
| B21 | `tests/browser/read-priority.spec.js` | request-order parity with the original build | S |
| B22 | `tests/browser/persistence-fresh.spec.js` | the original build opens a vis=2 address and reads what this build stored (rollback) | S1 |
| B23 | `tests/browser/controls-a11y.spec.js` | keyboard reach, names and computed contrast of S1-introduced UI | U |
| B24 | `tests/browser/probe-selfcheck.spec.js` | the probe and the observation helpers themselves | H7a |
| B25 | `tests/browser/profile-tracks.spec.js` | the adjacent profile tracks: geometry, independent and shared axes, disclosure, persistence | S2 |
| B26 | `tests/browser/stroke-roles.spec.js` | the stroke-role table: marks on the plot, their footer keys, counts, geometry and colours | S2 |
| B27 | `tests/browser/composition.spec.js` | the event strip lanes, reference stroke widths, the occlusion notice and the transient lens region | S2 |
| B28 | `tests/browser/rows-strip.spec.js` | the Rows strip, its blocks and legend bar, the 16% projection behind the cells, and Relative volume inside W | S2 |
| B29 | `tests/browser/resolution-plane.spec.js` | the resolution plane as an orthogonal state grid: size classes, availability, separate neutral glyphs, key, steppers | S2 |
| B30 | `tests/browser/state-table.spec.js` | the measure-by-state table: each row named with its test, and the rows that had none (waiting parent, open cap, provisional, coarser, replay-hidden) | S2 |
| B31 | `tests/browser/cvd-plane.spec.js` | the plane and the toolbar's coarse mark in composed fixtures under the published colour-vision simulations and grayscale (`tests/fixtures/cvd/simulations.json`) | S2 |

## 10. Migration status per slice

Rendered from the Status column at S1's convergence: `done` is S1's own work shipped, `todo-S2` and `todo-S3` are what the next slices still owe a row (`CONVERGENCE=1` checks that this table equals the count of the tables above).

| Prefix | Rows | keep | todo-S1 | todo-S2 | todo-S3 | done |
|---|---|---|---|---|---|---|
| T | 34 | 17 | 0 | 0 | 8 | 9 |
| C | 48 | 2 | 0 | 1 | 15 | 30 |
| D | 21 | 7 | 0 | 0 | 8 | 6 |
| F | 15 | 0 | 0 | 0 | 2 | 13 |
| R | 15 | 0 | 0 | 2 | 5 | 8 |
| N | 30 | 0 | 0 | 0 | 0 | 30 |
| all | 163 | 26 | 0 | 3 | 38 | 96 |

## 11. Contributor checklist

A new visual feature states each of the following before it merges, in its PR and in this file.

### 11.1 Measurement, support, model and scale

- Which measurement is encoded: its formula and version, basis and canonical unit, numerator and denominator, the exposure it divides by, and what it is when the exposure is zero or unknown (a non-value, never 0).
- The support the number describes (time and price, at the effective resolution), whether it is partial or open, and whether an empirical model stands behind it (its provenance and status belong in the measurement, not in a legend footnote).
- The scale: fixed (shares, log₂ ratios, RSI) or fitted (Value, Relative rank), its transform and parameters, its identity (mapping id), and what happens with no calibration, a zero-only cohort and an all-equal cohort.

### 11.2 Channel and policy

- The channel (Cells, Rows, lens, a pane or profile axis), its context (effective n and m for Cells; period identity, row size and quality, and never n, for Rows), and which policies it offers: Explore, Comparison lock, Auto color or Auto axis, Local contrast, Fit.
- How it behaves in a gesture, during Play and in replay (frozen, paused, invalidated when fitted after the edge), and that its fit runs on the settled schedule and never in a paint or a read.

### 11.3 Role, state and geometry

- The role of every mark (quantitative fill or outline, positive or negative arm, midpoint, occupancy, state, reference, interaction) from the role table, never a market hue chosen locally; the retired rendering roles (buy, sell, neutral, time as colours) must not come back.
- The glyph or pattern for each state the measurement can be in (zero, undefined, no reference, negative-infinite, finite under or overflow, pending, failed, unsupported, open, outside support) and that a number is never drawn for a missing value.
- Contrast: text at least 4.5:1, essential boundaries at least 3:1 against the actual backdrop.

### 11.4 Generated legend

- The legend is generated from the same transform, clipping and geometry the encoder uses (samples and ticks at their true positions), names measure, basis, unit, transform, policy, support and clipping, and offers the same detail without a pointer. The value marker comes from the readout record.
- The footer keys come from the role table, with counts.

### 11.5 Persistence

- Each new setting is part of the version-2 schema, survives a portable code and an address (within 8,192 characters, degrading as documented), is validated on import, and has a default that may be omitted. A legacy payload without it reads as the default.
- Nothing is stored that cannot be read back, nothing is executed from a payload, and a failed write is shown.

### 11.6 Tests

- Unit tests with independent expected values (hand vectors, exact-rational arithmetic, `d3`, `node:crypto`), the typed-result cases, and adversarial cases (zero, tied, all-equal, both sides of a clipping or lookup boundary).
- A browser test that reads the canvas (probe counts and pixels), the legend, the tooltip and the table as one record, in both themes; a round trip through a fresh browser; and, for anything that can fail, a failure test on the fake cube.
- This file: one row per new consumer, with its role, channel and test, and the README and `docs/data-and-semantics.md` updated with the behaviour.

## 12. Glossary

- **activity** has two meanings here. In `src/explorer.js` it names the painter of the **Columns** pane (`activity()`), which stays. Separately, the hidden *activity multiplier* (the paleness that made taker-flow and cascade cells paler where less traded) is removed (DR-01): denominators and exposure appear in readouts, never in a colour.
- **reference** names four different things. A *family reference* is a role of a Lines family (POC gold, session violet, VWAP rust and so on). The *reference profile* is the second, adjacent profile of a Rows period beside the view's current profile. The *model reference* is the declared expectation an Efficiency value is measured against, 2^(ISO_B − 1). The *S1 reference token* is the colour token kept as a reference for a pending later slice (for example `--ol-legacy-buy`).
- **Auto resolution level** (the padlock beside the resolution button, key A) follows the cell size on screen. **Auto color** is a scale policy that refits a colour mapping after each settled change. They are unrelated; **Auto axis** is the same idea for a length axis.
- **Comparison lock** is the scale policy that holds the mappings and Auto axes across resolutions and periods. The **padlock** is the resolution button's indicator of the locked level (Auto resolution level off). They are unrelated.
- **Explore**, **Fit**, **Local contrast**: see section 11.2; **appearance** is the palette version (`slate2` here), separate from a **mapping id**.
