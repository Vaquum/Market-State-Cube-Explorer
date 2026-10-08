# Parent completion matrix (PRD-0002, #45)

What each normative decision of the parent (D1 to D12) asks for, which slice owned it, where it is implemented, what shows it, and what is **not** shown. It was written for the pull requests of the three slices (#46, #47, #48) and is read with `docs/visual-contract.md` (every consumer, its role and its test) and `docs/testing.md` (what the tests are and are not evidence of). Specification readiness is not implementation, deployment or validation readiness, and an item that needs a person, a designated machine or the production host is **OUTSTANDING** here and nowhere marked passed. All three slices are on `main` and were deployed by the deploy workflow, each after its checks on the same commit: S1 (#51, `a979b67`), S2 (#52, then #54 after #52 was merged into the S1 branch by mistake, `2c3d225`) and S3 (#53, `659a0ba`). That is a release with the items marked OUTSTANDING below still outstanding: **no operator's scoped acceptance of them is recorded in those pull requests**, and nothing in this file turns an outstanding item into a passed one.

| Status words | Meaning |
|---|---|
| Implemented and tested | in the repository, with named tests that pass on the fake cube, the reference calculator and the real page |
| Implemented, evidence limited | built and tested as far as the repository can, with the limit stated in the row |
| OUTSTANDING | needs the operator: participants, the designated machine, the production host |

| Decision | Owner | Where it is implemented | What shows it | Status |
|---|---|---|---|---|
| **D1** Measurement, scale, role and readout records | #46 | `src/encoding.js`: `E.measure`, `E.result`, `E.scale`, `E.context`, `E.readout`, `E.role`; every consumer in `docs/visual-contract.md` | unit tests of each part (U-series) and `readout-agreement.spec.js` (B03): tooltip, table row, legend marker and pixel agree for every measure | Implemented and tested |
| **D2** Bases, matched support, typed results, Relative volume v2 | #46 | `E.ratio`, `E.measure`, the typed-result table | `relative-volume.test.js`, `ratio-cases.test.js`, `relative-volume.spec.js` (B11), `nonvalues*.spec.js` (B16) | Implemented and tested |
| **D3** Transfer functions and executable legends | #46 | `E.scale`, `E.lut`, `E.legend`: the legend is built from the frame that paints | `scale-*.test.js`, `legend.test.js`, `scale-canvas.spec.js`, `cells-edge.spec.js` (B04) | Implemented and tested |
| **D4** Scale contexts, axes, lifecycle, equivalence | #46 | `E.context`, `E.store`, `E.policy`, `E.axes`; the settle schedule of `src/explorer.js` | `explore-lifecycle.spec.js` (B05), `preset-context.spec.js` (B06), `comparison-lock.spec.js` (B07), `auto-policy.spec.js` (B08), `warnings.spec.js` (B09), `replay.spec.js` (B13) | Implemented and tested |
| **D5** Independent model and observation provenance | #46 | `E.model`, the observation record, the replay statements | `provenance.test.js`, `model-provenance.spec.js` (B19), the vintage sentence in the View summary (B53) | Implemented and tested |
| **D6** Composition, Rows, profiles, the lens | #47 | the stroke roles, the Rows strip, the profile tracks, the transient lens; the 20% occlusion budget | `stroke-roles`, `composition`, `rows-strip`, `profile-tracks`, `overlay-pixels`, `movement-cores`, `two-tone-pixels`, `strip-widths` specs (B25 to B28, B35 to B37, B39), `lens-pin.spec.js` (B12) | Implemented and tested |
| **D7** States, resolution grid, failure ownership, #29 | #47 | the keyed state marks, the resolution plane, the loading line | `resolution-plane`, `state-table`, `cvd-plane`, `failure-relevance`, `state-readouts` specs (B29 to B32, B38) | Implemented and tested |
| **D8** Reference identity and inspection | #48 | `E.role.REFERENCE`, the tags and plates, Focus, the inventory, the Inspect tool (E), the touch chooser, 44 px targets, dynamic reduced motion | `reference-language`, `comparison-marks`, `focus-inventory`, `text-contrast`, `inspect`, `inspect-lens`, `inspect-touch`, `help-motion`, `keyboard-matrix` specs (B40 to B49); `reference-regression.spec.js` (B45) shows no line, value or formula changed | Implemented and tested |
| **D9** Persistence, migration, capture | #46, #48 | the codec, the address and the view code; the carried-context notice; the View summary | `persistence-fresh` and `persistence-limits-faults` specs (B14, B15), `persistence-final.spec.js` (B52: approximate Rows, replay and override, changed history, temporary states), `view-summary.spec.js` (B53); the summary is not an export and there is no hosted export or immutable snapshot | Implemented and tested |
| **D10** Committed harness, fixtures, cumulative gates, check-before-deploy | #46 (every slice extends) | `tests/`, `.github/workflows/check.yml` and `deploy.yml`, the fake cube, the reference calculator | `workflows.test.js`, `repo.test.js`, `independence.test.js`; the full unit and browser suites on every slice | Implemented, evidence limited: that a failing check cannot reach the deploy job **on GitHub** is not shown by the repository (OUTSTANDING) |
| **D11** Perceptual and accessibility acceptance | #48 | the palette record, the screens, the colour matrix, the sign mark, states without hue, the operator protocol and its scorer | `lut.test.js`, `palette-record.test.js`, `color-matrix.test.js`, `states-without-hue.test.js`, `sign-marks` (U59, B50), `operator-protocol.test.js`, `operator-cases.spec.js` (B51); the screens are a model and a formula, not a person | Implemented, evidence limited: **OUTSTANDING** are the sessions of the 24-case protocol, its gate, the candidate and current palette comparison, more participants including colour-vision differences, and human validation of the palette |
| **D12** Performance, merge, production | #46 (every slice runs it) | `tools/benchmark`, `npm run benchmark` | reports under `reports/benchmark/` on a laptop, each with its A/A floors and its environment named; the S2 run was environment-inconclusive and its mean-draw verdict was blocking for six of eight core cases (the original's steady mean draw 1.3 to 2.2 ms, S2's 2.0 to 2.6 ms, every budget met); S3's first run stopped after its A/A phase (floors above the gate's 0.2 ms) and a forced run at the final head was stopped before its confirmation phase finished, so S3 has no cumulative report of its own | Implemented, evidence limited: **OUTSTANDING** are the designated-machine runs (preceding main and the original baseline, core and heavy combinations), the exact-build gate matrix, the rollback rehearsal on the host and production-host verification |

## Parent done-when

| Item | Status |
|---|---|
| #46 to #48 implemented with applicable evidence | the three slices are implemented and tested as above; the evidence marked OUTSTANDING is not attached, so this item is not done |
| Every visual consumer has its role and linked regressions in `docs/visual-contract.md`, and no undocumented legacy path remains | done: 188 rows, none left `todo`; the lint allowlist is empty; the retired tokens, tiers and static legend text are gone |
| Numerical mapping, visible and inspected records, composition and restored views agree | shown by B03, B44, B14, B52 and B53 on the fake cube |
| R1 to R34 reflected in implementation and tests | each of the 34 is mapped to its tests below (the section "Review items R1 to R34"); disposition at the specification level is not code verification, and a test is named only where it exists |
| Final operator, accessibility, replay and model, persistence and performance evidence and authorised production evidence | OUTSTANDING items above; a release with any of them outstanding needs the operator's scoped acceptance in the pull request (none is recorded: the three slices are released all the same), and neither #48 nor #45 closes on such a release |
| Contributor guidance for new visual features | `docs/visual-contract.md` section 11 |

## Review items R1 to R34

The review of the first edition of the parent (disposition comment on #45, 2026-09-30) numbered 34 items. Each is listed with the decision and the slice that owned it, the tests that hold it, and a status in the words of the table above. A file named here exists, and a test file that does not exist fails `completion-matrix.test.js`.

| Item | Owner | What shows it | Status |
|---|---|---|---|
| **R1** Relative volume v2 on a common price support W | D2, #46 | `relative-volume.test.js`, `ratio-cases.test.js`, `relative-volume.spec.js` (B11), `rows-strip.spec.js` (B28) | Implemented and tested |
| **R2** complete JSON-safe cases for shares, empty totals, no reference, unavailable reads | D2, #46/#47 | `ratio-cases.test.js`, `result.test.js`, `nonvalues.spec.js` (B16), `state-table.spec.js` (B30) | Implemented and tested |
| **R3** explicit plus and minus 2 display and clipping, model fit range and extrapolation label | D3/D5, #46 | `scale-value.test.js`, `clipping.test.js`, `provenance.test.js`, `model-provenance.spec.js` (B19), `warnings.spec.js` (B09) | Implemented and tested |
| **R4** Path units and bases, exposure, Short exposure cue | D2, #46 | `measure-bases.test.js`, `exposure.test.js`, `motion-measures.spec.js` (B17) | Implemented and tested |
| **R5** viewport edges as partial measurements | D2/D6, #46/#47 | `motion-measures.spec.js` (B17), `state-table.spec.js` (B30), `state-readouts.spec.js` (B38) | Implemented and tested |
| **R6** covered wall-clock denominator, linear 0 to 100% default at every level | D2/D3, #46/#48 | `fixed-transfer.test.js`, `measure-bases.test.js`, `warnings.spec.js` (B09), `operator-cases.spec.js` (B51: taker shares near 50% at n=4 and n=12) | Implemented and tested |
| **R7** Rows scale identity: consumer, measure, basis, period, row size, quality | D4, #46/#47 | `contexts.test.js`, `rows.spec.js` (B10), `explore-lifecycle.spec.js` (B05) | Implemented and tested |
| **R8** per-resolution Explore against explicit Comparison lock, shared and local lens | D4, #46 | `comparison-lock.test.js`, `explore-lifecycle.spec.js` (B05), `preset-context.spec.js` (B06), `comparison-lock.spec.js` (B07), `warnings.spec.js` (B09), `lens-pin.spec.js` (B12) | Implemented and tested |
| **R9** every channel and axis registered; MACD, Signal and histogram on one axis | D4/D6, #46/#47 | `axes.test.js`, `axes.spec.js` (B18), `profile-tracks.spec.js` (B25) | Implemented and tested |
| **R10** replay eligibility by the active cutoff, separate stores, scrub and rollover | D4, #46 | `replay.test.js`, `replay.spec.js` (B13) | Implemented and tested |
| **R11** 200 ms settle, 500 ms Auto cap, equivalence by propagated tolerance | D4, #46 | `lifecycle.test.js`, `equivalence.test.js`, `auto-policy.spec.js` (B08) | Implemented and tested |
| **R12** vis=2, address and code limits, import validation, notices | D9, #46 | `persistence-address.test.js`, `persistence-code.test.js`, `persistence-storage.test.js`, `legacy-migration.test.js`, `persistence-fresh.spec.js` (B14), `persistence-limits-faults.spec.js` (B15) | Implemented and tested |
| **R13** observation, model and scale provenance kept apart; the original-vintage limit | D5, #46/#47/#48 | `provenance.test.js`, `model-provenance.spec.js` (B19), `events-known-at.spec.js` (B33), `view-summary.spec.js` (B53) | Implemented and tested |
| **R14** the consumer, file, role, owner and test matrix | D1/D10, #46/#48 | `visual-contract.test.js`, `role-lint.test.js`, `docs-text.test.js` | Implemented and tested |
| **R15** the Inspect tool (E), an absolute cursor, the key table, Escape priority | D8, #48 | `inspect.spec.js` (B44), `inspect-review.spec.js` (B55), `help-motion.spec.js` (B48), `keyboard-matrix.spec.js` (B49), `focus-order.spec.js` (B54) | Implemented and tested |
| **R16** 44 px for coarse-pointer controls, side-effect-free Inspect taps, dynamic reduced motion | #48 | `inspect-touch.spec.js` (B47), `help-motion.spec.js` (B48), `controls-a11y.spec.js` (B23) | Implemented and tested |
| **R17** one readout record for the encoder, tooltip, table and legend marker | D1, #46/#48 | `readout.test.js`, `readout-agreement.spec.js` (B03), `view-summary.test.js` | Implemented and tested |
| **R18** protected movement-stroke pixels, the stroke table, the 4.5 px backing and the 20% budget | D6, #47 | `occlusion-budget.test.js`, `stroke-roles.spec.js` (B26), `composition.spec.js` (B27), `overlay-pixels.spec.js` (B35), `movement-cores.spec.js` (B36) | Implemented and tested |
| **R19** independent Auto axes at first, a fixed Rows strip, shared axes with a common pixels per unit | D6, #47 | `profile-tracks.test.js`, `profile-tracks.spec.js` (B25), `rows-strip.spec.js` (B28) | Implemented and tested |
| **R20** the transient lens holds Cells and no Rows; the strip stays; Pin promotes | D6, #46/#47/#48 | `lens-pin.spec.js` (B12), `strip-widths.spec.js` (B39), `inspect-lens.spec.js` (B46) | Implemented and tested |
| **R21** zero Delta is not no trades; the measure-by-state table; undefined columns have glyphs | D2/D7, #46/#47 | `measure-bases.test.js`, `state-table.spec.js` (B30), `state-readouts.spec.js` (B38) | Implemented and tested |
| **R22** the resolution plane as an orthogonal state grid, 6 and 32 px thresholds | D7, #47 | `plane-glyphs.test.js`, `resolution-plane.spec.js` (B29), `cvd-plane.spec.js` (B31) | Implemented and tested |
| **R23** two-tone boundaries over every quantitative, empty and state backdrop | D6/D11, #47 | `two-tone.test.js`, `two-tone-pixels.spec.js` (B37) | Implemented and tested |
| **R24** the co-occurrence matrix, severities 0.5 and 1.0, grayscale, L* and adjacent-step screens, operator tasks | D11, #48 | `color-matrix.test.js`, `lut.test.js`, `states-without-hue.test.js`, `operator-protocol.test.js` | Implemented, evidence limited: **OUTSTANDING** are the sessions of the 24-case protocol and human validation of the palette |
| **R25** every text-on-cells path audited, opaque plates, plates counted as occlusion | D11, #48 | `text-contrast.spec.js` (B43), `contrast.test.js`, `occlusion-budget.test.js` | Implemented and tested |
| **R26** the audit extended to data-bearing boundaries and every text background, without a 3:1 rule on gradient steps | D11, #48 | `text-contrast.spec.js` (B43), `contrast.test.js`, `reference-roles.test.js` | Implemented and tested |
| **R27** low-end and continuity screens, redundant sign routes, no sign encoded by lightness | D11, #46/#48 | `lut.test.js`, `sign-marks.test.js`, `sign-marks.spec.js` (B50) | Implemented and tested |
| **R28** the neutral historical-comparison role, the Level's annotation, uniform swing size, expiry badges | D8, #48 | `reference-roles.test.js`, `reference-language.spec.js` (B40), `comparison-marks.spec.js` (B41) | Implemented and tested |
| **R29** a cumulative applicability table instead of impossible early gates | D10, all slices | `completion-matrix.test.js`, `workflows.test.js`, and each slice's gate matrix in its pull request | Implemented and tested |
| **R30** the committed harness, fixtures, fault API, reference calculator and benchmark | D10, #46 | `repo.test.js`, `fake-routes.test.js`, `reference.test.js`, `fake-vs-reference.test.js`, `recovery-faults.spec.js` (B20), `benchmark-stats.test.js` | Implemented and tested |
| **R31** A/A noise, paired screening and confirmation, separate core and new-enabled budgets | D12, all slices | `benchmark-stats.test.js`, `benchmark-config.test.js` | Implemented, evidence limited: **OUTSTANDING** are the designated-machine runs, and the laptop runs are not a pass (see D12) |
| **R32** check-before-deploy on the exact commit, interim release boundaries, rollback, real-host evidence | D12, #46/#48 | `workflows.test.js`, `.github/workflows/check.yml` and `deploy.yml` | Implemented, evidence limited: **OUTSTANDING** are the proof on GitHub that a failing check stops the deploy, the rollback rehearsal and production-host verification |
| **R33** #29: failure relevance, deterministic races, reassertion on return | D7, #47 | `failure-relevance.spec.js` (B32) | Implemented and tested |
| **R34** supersession of Time-at-price and the signed-role terms; #36 stays closed | D1, #46 | the superseded-by pointers on #30 and #36 (issue text, not code) | Done on the issues |

## Historical issues

PRD-0001 #30 stays the financial and cube-definition authority except where PRD-0002 expressly changes how a measurement is communicated; #36 is closed and stays closed. Each keeps its text, with a superseded-by pointer to #45.

## Cell comparison extension (PRD-0006, #70 / P6-S1 #71)

This is one complete implementation slice. The original parent's outstanding operator and production evidence above is unchanged. Candidate acceptance and measured comparison performance belong to the implementation PR on its tested commit; the following links identify checks, not an unrecorded acceptance or deployment.

| Contract | Implementation | Evidence |
|---|---|---|
| D1 capture/copy and D6 snapshot support | `src/explorer.js` capture adapter/menu/Inspect/table routes; `src/comparison.js` typed records and copy | `cell-comparison.test.js`; `cell-comparison.spec.js`, `comparison-session.spec.js`, `comparison-capture.spec.js` |
| D2 readable Focus/Cards/Matrix, pages and expansion | `src/comparison-ui.js`, registered comparison type tokens, guarded panel presentation | `cell-comparison.spec.js`, `comparison-session.spec.js`, `comparison-capture.spec.js` |
| D3-D5 closed metrics, shared basis/reference/ranks and frozen loaded POC | `src/comparison.js`, Lines-derived POC picker | `cell-comparison.test.js`; `cell-comparison.spec.js`, `comparison-session.spec.js`, `comparison-capture.spec.js`, `comparison-poc-loading.spec.js` (startup source replacement and expanded reload; no picker reads or hidden chart work) |
| D6 tab-only collection and storage recovery | `src/state.js` comparison record; coalesced capture/presentation persistence | `comparison-storage.test.js`; `cell-comparison.spec.js`, `comparison-session.spec.js`, `comparison-capture.spec.js` |
| D7 actual additions and integration gates | this matrix, visual consumer and generated color inventories, README/help, complete browser/unit/golden/build checks | `comparison-benchmark.test.js`; candidate-only DOM diagnostics under navigation.v4, with outcomes recorded in the implementation PR; no extra slice or new operator campaign |

## PRD-0007 — core card overhaul, P7-S1 (#84)

| Original requirement | Implementation | Evidence | Status |
|---|---|---|---|
| D1 compact hierarchy, profiles and causal histories | Shared core card renderer; Measures companions; native Rows/profile support; nine core Columns; retained cell/candle geometry | B66, B28, cell-native-inspector and inspector-presentation specs | Implemented; verification and delivery: [PR #87](https://github.com/Vaquum/Market-State-Cube-Explorer/pull/87) |
| D2 canonical observation/support and D3 composition/context | `card-observation@1`, existing canonical helpers, daily ATR, six-offset seasonal index, real MSCC precision, zero/gap/cutoff disclosures | U98, B66, readout-agreement and comparison-capture specs | Implemented; verification and delivery: [PR #87](https://github.com/Vaquum/Market-State-Cube-Explorer/pull/87) |
| D5 causal availability/model exception and bounded reads | Per-point prior ATR, fixed support, complete parent, retrospective touched-row model; Inspect/expansion demand and cancellation | B66, model-provenance and read-priority specs | Implemented; verification and delivery: [PR #87](https://github.com/Vaquum/Market-State-Cube-Explorer/pull/87) |
| Labels and construction across shared consumers | Row concentration/profile-share/touched-row names; historical-token disclosure; profile bins, ties, area and independent axes | relative-volume, legacy-migration, text, rows-strip and capture specs; System reference | Implemented; verification and delivery: [PR #87](https://github.com/Vaquum/Market-State-Cube-Explorer/pull/87) |
| Existing cube only | Explorer client helpers and existing delivered routes; no Origo, bridge, reader or wire change | Source diff; protocol oracles | Design constraint retained; real-host/designated-machine evidence not claimed |
| P7-S2/P7-S3 acceptance | Covered by the following slice sections | Issues #85/#86 | Tracked separately below |


## PRD-0007 — reference card overhaul, P7-S2 (#85)

| Requirement | Implementation | Evidence | Status |
|---|---|---|---|
| D4 reference location/construction, causal ATR and indicator context | S1 core renderer extended with reference tracks, native shared plots, profiles and explicit unavailable context | U99, U55, B67 plus existing B33/B34/B55 | Implemented; verification and delivery: [PR #88](https://github.com/Vaquum/Market-State-Cube-Explorer/pull/88) |
| D5 occurrence/confirmation, authored limits and strip access | Event-table extension, prior-cycle completed-input recognition, nearest Clock occurrence, individually selectable existing squeeze records | U99, U55, B67, events-known-at and Inspect/touch regression inventory | Implemented; verification and delivery: [PR #88](https://github.com/Vaquum/Market-State-Cube-Explorer/pull/88) |
| Existing-data and geometry constraints | Existing detectors, routes, controls and three event lanes retained; exactly matched profile approximation or unavailable | reference-regression, focus-inventory, keyboard-matrix, text-contrast and benchmark protocol | Verification and delivery: [PR #88](https://github.com/Vaquum/Market-State-Cube-Explorer/pull/88); no performance/host certification claimed |


## PRD-0007 — historical evidence and frozen comparison, P7-S3 (#86)

| Requirement and inventory family | Implementation | Acceptance evidence | Status |
|---|---|---|---|
| Historical state; Next POC; POC barriers; About evidence | `seasonal-state@1` fixed-anchor seasonal terciles, complete native outcomes, all-start ledger; `block-bootstrap@2` shared calendar draws and independent component floors | U100 literal seed/Type-7, eligibility, weekly coverage, cancellation and 29/30, 19/20, 1799/1800 floors; B68 long qualifying and short withheld sources, Cases controls, horizon cancellation and rewind | Implemented; verification recorded on PR #89 |
| Focused capture; collection cards; Matrix; details and copy | One selected existing metric, four compact figures, own frozen captured histories and prior ATR, independently gated signed POC context; unchanged nine-metric ranks | U95 normalized sign/boundaries/causal timing and history denominators; B63 committed-frame capture/replay; comparison-session selected-metric/history parity | Implemented; verification recorded on PR #89 |
| Browser capture storage | Read-only v1 restore; v2-first validation and verified retirement; atomic context/whole-record limits | U96 mixed legacy/new restoration and quota/rejected-v2/readback faults; 4/5 histories, 12/13 slots, exact 16 KiB and 4 MiB UTF-8 boundaries | Implemented; verification recorded on PR #89 |
| Cells and Candles tables | Canonical fields, common labels, prior-ATR units, original support/completeness | Existing readout-agreement, candles and cell-native-inspector browser oracles | Implemented; verification recorded on PR #89 |
| Historical cases | Same completed outcome/filter predicates, Non-modal POC outcomes, raw seasonal/state/fit and completion context, paged full ledger | U100 outcome/barrier equality and contiguous horizons; B68 filter/sort/page and independent cohort partitions | Implemented; verification recorded on PR #89 |
| View summary and measurement/query details | Requested/actual/shown bounds and n/m, cutoffs, replay, measured-through, evidence method/digest and frozen context scope | Existing selection/view, recorded, replay and Query consumers; source-vintage limitation stays explicit | Implemented; verification recorded on PR #89 |
| Exactly three slices / 28 inventory rows / existing cube | S1 ten rows, S2 thirteen rows, S3 five rows; no Origo, server, bridge, reader, wire, detector or navigation changes | Original PRD-0007 revision-4 inventory; source diff; existing independent protocol oracles | Scope retained; no real-host or designated-machine certificate claimed |
| Performance and delivery | Existing v4 runner extends candidate-only comparison diagnostics with qualifying/withheld statistical sources; existing budgets retained | Candidate diagnostics and full CI results are recorded against the implementation PR head | Diagnostic protocol retained; synthetic timings cannot certify production |
