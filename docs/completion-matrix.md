# Parent completion matrix (PRD-0002, #45)

What each normative decision of the parent (D1 to D12) asks for, which slice owned it, where it is implemented, what shows it, and what is **not** shown. It is written for the pull requests of the three slices (#46, #47, #48) and read with `docs/visual-contract.md` (every consumer, its role and its test) and `docs/testing.md` (what the tests are and are not evidence of). Specification readiness is not implementation, deployment or validation readiness, and an item that needs a person, a designated machine or the production host is **OUTSTANDING** here and nowhere marked passed. Nothing has been merged or deployed.

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
| **D12** Performance, merge, production | #46 (every slice runs it) | `tools/benchmark`, `npm run benchmark` | reports under `reports/benchmark/` on a laptop, each with its A/A floors and its environment named; the S2 run was environment-inconclusive and its mean-draw verdict was blocking for six of eight core cases | Implemented, evidence limited: **OUTSTANDING** are the designated-machine runs (preceding main and the original baseline, core and heavy combinations), the exact-build gate matrix, the rollback rehearsal on the host and production-host verification |

## Parent done-when

| Item | Status |
|---|---|
| #46 to #48 implemented with applicable evidence | the three slices are implemented and tested as above; the evidence marked OUTSTANDING is not attached, so this item is not done |
| Every visual consumer has its role and linked regressions in `docs/visual-contract.md`, and no undocumented legacy path remains | done: 176 rows, none left `todo`; the lint allowlist is empty; the retired tokens, tiers and static legend text are gone |
| Numerical mapping, visible and inspected records, composition and restored views agree | shown by B03, B44, B14, B52 and B53 on the fake cube |
| R1 to R34 reflected in implementation and tests | the decisions are in the issues' boxes, each ticked only with its evidence; disposition at the specification level is not code verification |
| Final operator, accessibility, replay and model, persistence and performance evidence and authorised production evidence | OUTSTANDING items above; a release with any of them outstanding needs the operator's scoped acceptance in the pull request, and neither #48 nor #45 closes on such a release |
| Contributor guidance for new visual features | `docs/visual-contract.md` section 11 |

## Historical issues

PRD-0001 #30 stays the financial and cube-definition authority except where PRD-0002 expressly changes how a measurement is communicated; #36 is closed and stays closed. Each keeps its text, with a superseded-by pointer to #45.
