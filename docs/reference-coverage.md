# System reference coverage — #176

Audited from `origin/main` at `49fe10262e2d2c4a0d454a33cc8d5e2d5857c5da` and the accompanying repair. The current issue body supersedes the pre-#178 reviews. Tooltip coverage and the universal PR checkbox/CI gate are separate concerns.

## Counting and completion rule

A **control** changes configuration, navigates, performs an action or reveals information. A **read** is a displayed measurement, state, provenance field or meaningful chart mark. One semantic producer is one inventory unit; repeated rows, dates, captures, references, table cells and ticks do not multiply coverage. Distinct measures, bases, states, actions and support/timing conventions are listed as variants below.

Covered means an existing System reference topic explains purpose, interpretation and use; search by the UI name reaches that topic; its Show action locates the applicable control/region or explains why it is absent. Global System reference search is the common UI → explanation route. Canvas readings additionally use Inspect’s named surfaces and detailed records. A tooltip, accessible name or native title by itself does not establish reference coverage. This work keeps those mechanisms separate.

## Static reconciliation

`src/view.html` contains **211 control declarations**: 1 a, 156 button, 31 input, 4 summary, 14 select, 1 canvas, 2 div, 2 textarea. This includes the conditional Find features template and hidden dialogs; it is a source count, not a count of simultaneously visible controls or semantic kinds. Each declaration is reconciled below. Anonymous controls are identified by their existing parent/role/data attribute and repeated selectors retain their instance count. Read-only textareas are copy/restore surfaces. Footers, summaries and other noninteractive reads are reconciled in the producer inventory.

Every row uses System reference search by its stable UI name (aliases in `src/reference.js`; omit instance values such as the current year, price, date or lattice coordinates); Show points to the topic’s control/region. Settings belong inside their article. No action is rebound to open documentation.

| Topic | Declarations | Static source selectors (all under `src/view.html`) |
|---|---:|---|
| `metadata` | 2 | `#ol-version`, `#ol-reload` |
| `window` | 3 | `#ol-window`, `#ol-follow`, `#ol-latest` |
| `mobile` | 2 | `#ol-sheet-toggle`, `#ol-sheet-close` |
| `resolution` | 6 | `#ol-res`, `#ol-auto`, `#ol-tminus`, `#ol-tplus`, `#ol-pminus`, `#ol-pplus` |
| `references` | 3 | `#ol-lines`, `#ol-lines-showall`, `#ol-lines-clear` |
| `poc-value` | 5 | `#ol-poc`, `#ol-area`, `#ol-family-profile-head`, `#ol-lines-date`, `#ol-lines-add button` |
| `untested-rules` | 1 | `#ol-untested` |
| `session-levels` | 1 | `#ol-family-session-head` |
| `structure-rules` | 1 | `#ol-family-structure-head` |
| `retracements` | 2 | `#ol-lines-fdate`, `#ol-lines-fadd button` |
| `average-rules` | 1 | `#ol-family-average-head` |
| `vwap-rules` | 3 | `#ol-family-vwap-head`, `#ol-lines-vdate`, `#ol-lines-vadd button` |
| `clock-rules` | 1 | `#ol-family-clock-head` |
| `navigation` | 7 | `#ol-pan`, `#ol-reset-canvas`, `#ol-drawer-grip`, `#ol-side-grip`, `#ol-side-toggle`, `#ol-reset-cancel`, `#ol-reset-apply` |
| `selection` | 2 | `#ol-select`, `#ol-clear` |
| `drawings` | 1 | `#ol-trend` |
| `lens` | 1 | `#ol-lens` |
| `inspect` | 18 | `#ol-inspect-tool`, `#ol-inspect-open-detail`, `#ol-inspect-exit`, `[data-surface="cells"]`, `[data-surface="rows"]`, `[data-surface="background"]`, `[data-surface="columns"]`, `[data-surface="strip"]`, `[data-surface="references"]`, `[data-surface="lens"]`, `#ol-inspect-strip-view`, `#ol-inspect button` ×4, `#ol-inspect-reference-search`, `#ol-inspect-reference`, `#ol-inspect-detail-close` |
| `replay` | 8 | `#ol-replay`, `#ol-back`, `#ol-play`, `#ol-next`, `#ol-speed`, `#ol-replay-edge`, `#ol-replay-jump button`, `#ol-replay-now` |
| `views` | 7 | `#ol-hist-back`, `#ol-hist-fwd`, `#ol-hist`, `#ol-copy-link`, `#ol-view-name`, `#ol-view-form button`, `#ol-tab-history summary` |
| `system` | 10 | `#ol-help`, `#ol-reference-close`, `#ol-reference-back`, `#ol-reference-search`, `#ol-reference-topic`, `#ol-reference-prev`, `#ol-reference-next`, `#ol-reference-shortcuts`, `#ol-reference-toggle`, `#ol-keys-close` |
| `scales` | 5 | `#ol-legend`, `#ol-rows-legend`, `#ol-notice-more`, `#ol-notice-dismiss`, `#ol-cell-key` |
| `profiles` | 2 | `#ol-profile-chip`, `#ol-profile-settings` |
| `columns` | 3 | `#ol-axis-chip`, `#ol-pane`, `#ol-axis-settings` |
| `measures` | 1 | `#ol-mode` |
| `rows` | 2 | `#ol-background`, `#ol-rows` |
| `strip` | 1 | `#ol-strip` |
| `reference-visibility` | 1 | `#ol-focus-chip` |
| `coordinates` | 1 | `#ol-bounds-settings` |
| `states` | 3 | `#ol-key-guide`, `#ol-status-prev`, `#ol-status-next` |
| `grid` | 1 | `#ol-canvas` |
| `lens-rules` | 4 | `#ol-lens-depth`, `#ol-lens-local`, `#ol-lens-inspect`, `#ol-lens-pin` |
| `drawing-rules` | 18 | `#ol-drawing-edit`, `#ol-drawing-more`, `#ol-drawing-editor-close`, `#ol-drawing-name`, `#ol-drawing-label`, `#ol-drawing-color`, `#ol-drawing-color-picker`, `#ol-drawing-a-time`, `#ol-drawing-a-price`, `#ol-drawing-b-time`, `#ol-drawing-b-price`, `#ol-drawing-editor-undo`, `#ol-drawing-editor-delete`, `#ol-drawing-cancel`, `#ol-drawing-apply`, `#ol-drawing-chooser-close`, `#ol-drawing-confirm-cancel`, `#ol-drawing-confirm-delete` |
| `rallies` | 1 | `#ol-tab-rallies` |
| `features` | 12 | `#ol-tab-features`, `#ol-features-bar`, `#ol-features-mode`, `#ol-features-lead`, `#ol-features-against`, `#ol-features-pool`, `#ol-features-add`, `#ol-features-find`, `#ol-features-cancel`, `#ol-features-copy`, `#ol-features-unpreview`, `#ol-features-clear-windows` |
| `tables` | 13 | `#ol-tab-cells`, `#ol-table-back`, `#ol-table-next`, `[data-sort="time"]`, `[data-sort="price"]`, `[data-sort="volume"]`, `[data-sort="trades"]`, `[data-sort="buyvol"]`, `[data-sort="buytrades"]`, `[data-sort="path"]`, `[data-sort="dwell"]`, `[data-sort="measure"]`, `[data-sort="state"]` |
| `case-records` | 11 | `#ol-tab-cases`, `#ol-case-filter`, `#ol-case-prev`, `#ol-case-next`, `#ol-cases-ledger summary`, `[data-case-sort="date"]`, `[data-case-sort="outcome"]`, `[data-case-sort="change"]`, `[data-case-sort="poc"]`, `[data-case-sort="excursion"]`, `[data-case-sort="buy"]` |
| `query` | 18 | `#ol-tab-query`, `#ol-bounds-start`, `#ol-bounds-end`, `#ol-bounds-low`, `#ol-bounds-high`, `#ol-bounds-form button`, `#ol-query-text`, `#ol-copy-query`, `#ol-copy-view`, `#ol-import-toggle`, `#ol-copy-selection`, `#ol-copy-comparison`, `#ol-share-investigation`, `#ol-refresh-investigation`, `#ol-previous-investigation`, `#ol-import-text`, `#ol-import-apply`, `#ol-copy-summary` |
| `compare` | 1 | `#ol-tab-compare` |
| `rally-rules` | 15 | `#ol-rally-mode`, `#ol-rally-scale`, `#ol-rally-target`, `#ol-rally-pullback`, `#ol-rally-reversal`, `#ol-rally-cadence`, `#ol-rally-start`, `#ol-rally-end`, `#ol-rally-window`, `#ol-rally-discover`, `#ol-rally-cancel`, `#ol-rally-deadline`, `#ol-rally-clear`, `#ol-rally-previous`, `#ol-rally-next` |
| `context-reading` | 2 | `#ol-context-tab`, `#ol-context summary` |
| `evidence` | 11 | `#ol-evidence-tab`, `[data-evidence-kind="poc"]`, `[data-evidence-kind="barrier"]`, `#ol-horizon`, `#ol-barrier`, `#ol-evidence button` ×3, `#ol-evidence-info`, `#ol-evidence-ledger summary`, `#ol-open-cases` |

## Generated controls and readouts

The following **36 producer groups** reconcile generated UI and noninteractive reads. Producer names are source anchors, not instance IDs. Every group has reference content and a search route; shared quantities use the named denominator topics rather than duplicating definitions for each table/capture. The static table above and these groups overlap deliberately: they are different source reconciliations and must not be summed into a coverage percentage.

| # | Producer / source | Meaningful variants and reference destination |
|---|---|---|
| 1 | `explorer.js`: `buildWindowMenu`, `WINDOWS`, `windowOf` | All 16 presets; rolling minutes/hours/days/365 days versus This year/Last year/All history; generated Since date, Apply, invalid date. `window` explains UTC boundaries, following data, auto versus locked resolution, selection/anchor/replay effects. Show Since opens its existing menu without applying it. |
| 2 | `buildFollowMenu`, `FOLLOW_INFO` | Free axes, Refit, Coupled, Diagonal and Fit once; `window`, `navigation`. |
| 3 | Resolution rendering and `ol-res-pop` | Auto, independent time/price steppers, lattice levels; readiness versus screen-size glyphs, coarse fallback; `resolution`, `states`, `coordinates`. |
| 4 | `buildFlowMenu`, `modeDatasetItems`, `scaleSteps` | Volume, Trades, Trade size, Taker flow, Taker trades, Delta, Cascade, Path, Dwell, Geometry, Candles; Basis/Transform/Scale/Options steps, selected and live-only choices; `measures`, `movement`, `cascade`, `candles`, `exposure`, `transforms`, `scales`. |
| 5 | `buildFlowMenu`, `paneDatasetItems`, `paneTimeframes` | Same as cells, Volume, Trades, Trade size, Delta, model, Choppiness, Volume per path, RSI daily/4h, MACD; `columns`, `indicator-rules`. Axes now has a Show target in its own article. |
| 6 | `rowSelectorPeriodChoices`, `flowSteps`, `rowSelectorSpecs` | Independent Rows and Background instances; Off/Volume/Delta/Time at price/Relative volume/Profile-share; Visible range, rolling/calendar periods and Since; `rows`, `row-comparisons`, `profiles`. |
| 7 | `stripForceChoices`, `flowSteps` | Off/Forces and All/Macro/Positioning/News/Social; `strip`; absent service and missing components remain explicit. |
| 8 | `legendPop`, `uiPopSkeleton`, `uiPopActions`, `uiPopForm`, `uiScaleSection` | Cells versus Background colour; basis/transform/policy; Fit/Auto color/lock/local contrast; U/k/share-window validation, Apply/Clear manual domain; ticks, cohort, mapping, fit/support/clipping/exclusion fields and notices; `scales`, `transforms`, `exposure`, `states`. |
| 9 | `axisPop`, `uiAxisText` | Column/current-profile/reference-profile axes; Auto axis/Fixed scale/Frozen, mapping/domain/unit/fitted-through/hold/clipping; Comparison lock; `columns`, `profiles`, `scales`. Axes does not offer a manual-axis form. |
| 10 | `profilePop`, `profileSummary` | Independent/shared absolute/shared row share, current/reference axes and totals, Window W, source/period, folded/unsupported/zero-total states; `profiles`, `row-comparisons`. |
| 11 | `lineRow`, `LINE_KEYS`, period/date builders | Volume profile fixed periods and UTC-date instances, POC/VA, daily/developing POC, untested daily/weekly POCs, date removal and exact line values; `references`, `poc-value`, `untested-rules`. |
| 12 | `TOGGLES`, `lineRow`: Session and Structure | Daily/weekly/monthly open, previous-day HLC, ATH, prior-cycle high, daily/4h confirmed/candidate swings and EQH/EQL; `session-levels`, `structure-rules`. |
| 13 | `TOGGLES`, retracement date builders | 30/90 sessions, daily/4h swing, Since date, Classic levels and Extensions; anchors/order/depth/known-at; `retracements`. |
| 14 | `TOGGLES`: averages and bands | 21 EMA, 50/100/200 SMA, golden/death cross, 200-week SMA, support band, 3.75m/15m/1h/4h EMA pairs, 15m/1h/4h/daily Bollinger and different squeeze rules; `average-rules`, `untested-rules`. |
| 15 | `TOGGLES`, VWAP date builders | Visible range, UTC/Asia/Europe/US sessions, daily swing high/low, chosen UTC day, dispersion and approximation; `vwap-rules`, `references`. |
| 16 | `TOGGLES`: Clock | Day/week/month, assumed funding, US equity open, spot weekend proxy, weekly/monthly/quarterly expiry; timing, timezone and source assumptions; `clock-rules`. |
| 17 | `lineFocusButton`, `familyStatus`, `linesStatus`, Level row | Single/family focus, Show all, clear, enable/held-back counts, status reasons, user Level placement/removal; `references`, `reference-visibility`, `states`. |
| 18 | `renderHistory`, `renderViews` | Navigation breadcrumbs, previous/next, named view save/open/delete/link and storage statuses; `views`, `retention`. Repeated names do not change operation semantics. |
| 19 | `drawingRow`, `drawingBuildActions`, `drawingUIButton`, context menus | Create/edit/name/label/colour/visibility/lock/duplicate/copy/delete/undo/redo; collection versus item; `drawings`, `drawing-rules`. |
| 20 | `drawingChooser`, `drawingRecoveryChooser`, editor and confirmation | Overlap choice, exact A/B UTC/price preview, Apply/Cancel/Undo, delete-all confirmation, timestamp/workspace/name recovery and expiration; `drawing-rules`, `retention`. |
| 21 | `renderCells`, Cells table actions | Filtered cell rows, active-measure state, raw totals/companions, sorting and pagination, Inspect, Copy/Add and full filtered CSV; `tables`, `measures`, `movement`, `exposure`, `states`, `compare`. |
| 22 | `buildCandleTable`, `candleTip` | Exact OHLC, net/range, time bounds, so-far/exclusive replay/recorded unavailability, sorting/export; `candles`, `tables`, `replay-objects`. |
| 23 | `evidence.js`, case/ledger rendering in `explorer.js` | Anchor/state, raw buy/seasonal buckets, fit time, matching/baseline counts, horizon/barriers, up/flat/down and pp differences, boxes/intervals/withholding; `evidence`, `matching`, `outcomes`, `intervals`. |
| 24 | Cases table/eligibility ledgers | Matching/all/non-modal/direction filters, completed versus excluded/unfinished candidates, date/outcome/change/POC/excursions/share, pagination, sort/open/export; `case-records`, `matching`, `outcomes`. |
| 25 | `rallies.js`: `controls`, `render`, `renderInspector` | Three definitions and bps/ATR scale; target/pullback/reversal/cadence/window/deadline; discover/refresh/stop/select/clear/page; rows and member reference/return/duration/drawdown/normalized-delta/times/POC/native IDs; `rallies`, `rally-rules`. |
| 26 | `features.js`: `controls`, `renderWindows` | Bars, inside/lead and lead count, all/view comparison, pool, add/remove/clear windows, find/stop/invalidated inputs; `features`. Conditional Mill template is explicitly included. |
| 27 | `features.js`: `renderResult`, `tip`, `paintPane` | Candidate/AUC/90% interval/direction/adjusted p/rule; TPR/FPR/precision/events hit; screened/skipped/timing/correlation; preview/end, bucket/value/factory, marked/rule lanes, manifest/clipboard fallback; `features`, `feature-rules`. |
| 28 | `comparison-ui.js`: toolbar, `render` | Metric/basis/reference/sort/direction/POC; Cards/Matrix/Expand/paging; copy/add/update/remove/clear/undo/import/export/retry/discard/selectable-text fallback; `compare`, `comparison-math`. |
| 29 | `metricBlock`, `mark`, `historyMark`, `renderMatrix` | Nine comparison metrics; unit/basis/denominator, difference/percent/pp, competition rank/eligible count, comparison domain/reference marker, per-history own scale; `comparison-math`, `capture-content`, `history-reading`. |
| 30 | `contextDetails`, `renderFocus`, capture stamps | Nominal/observed bounds, support/known-through/source/formula, original reading, nonnegative POC gap versus signed POC distance/captured ATR and reference timing, legacy/frame context, frozen/uncaptured/hidden history slots; `capture-content`, `replay-objects`. |
| 31 | `summarySections`, `summaryRender`, agent/query rendering | Bounds, six-parameter query, levels, measures, colour/axes, provenance, copy/restore/share, current-source refresh and previous capture, errors; `query`, `retention`, `metadata`. |
| 32 | `querySummary`, context and profile rendering | View versus selection totals, buy/total/count/share/Delta, path/dwell/completed boundary, POC/VA, cell-count diagnostics; `context-reading`, `selection`, `poc-value`, `exposure`. |
| 33 | `renderLive`, header/footer/status and notice rendering | Market/source/snapshot/data-through/canonical/freshness/build, scope/cutoff/pixel size; state keys, signs, fallback/unresolved counts; family/stroke keys and legend scroll; `metadata`, `states`, `state-glossary`, `reference-visibility`. |
| 34 | `reference.js`: `render`, colour-key/settings callbacks | Topic/search/sequence/Show/return/close/shortcuts, matrices and current-view colour/mark keys; `system`, `mobile`, topic-specific settings. Article tables and target labels now participate in search. |
| 35 | `coreCardPresentation`, `tipRows`, `readoutRows`, `renderInspectDetail` | Primary and companion values; raw details, formula/unit/support/source/timing/state, level action and measurement histories; `inspect`, `measures`, `exposure`, `history-reading`, `references`, `state-glossary`. See canvas routes below. |
| 36 | `stripCard`, `stripForcesCard`, `stripSourceCard`, `stripEventCard`, `stripAheadCard` | Force components/attention/input counts, hindsight/freshness/field cutoff, track-record samples/down share/quantiles, event schedule/date precision/weight/reaction/surprise/release history, ahead horizon/options/skew/OI/risk-neutral ranges; `strip`, `inspect`, `state-glossary`. Full records use Inspect Strip. |

## Canvas routes

These **8 reading families** have no per-mark DOM control. The reference’s Show region/control and Inspect route replace a fictional per-pixel link. Hover, keyboard Inspect and touch Inspect read the same canonical records; meaningful variants are listed separately above.

| Family / producer | Interpretation and route |
|---|---|
| Cells and axes (`cellPresentation`, grid painters) | Selected measure/basis/scale, exact time/price bounds, coverage, open/provisional/non-values, crosshair; Inspect Cells → Open details → `grid`, `measures`, `movement`, `exposure`, `states`. |
| Candles (`candleTip`) | OHLC/time/partial/exclusive support; Inspect Cells → `candles`, `tables`. |
| Current and Rows profiles / Background (`coreRowsPresentation`, `rowSection`) | Current versus reference distribution, share/relative denominators, POC/VA, independent length/colour axes; Inspect Rows/Background → `rows`, `profiles`, `row-comparisons`, `poc-value`. |
| Columns and oscillators (`corePanePresentation`, `oscillatorTip`) | Native aggregate/indicator/model quantities and companions; Inspect Columns → `columns`, `indicator-rules`. |
| References/events (`referenceCard`, family presentations) | Family/name/timeframe, anchor/known-at/confirmation/visibility/coverage and held-back marks; Inspect References/search → `references` and each family’s rule topic. |
| Lens (`inspectLensTip`) | Finer record/support/depth/contrast; Inspect Lens → `lens-rules`, `history-reading`; Pin adopts the view only on explicit action. |
| Strip and feature lanes (strip cards, `features.tip`) | Force/source/event/ahead records and temporary Mill preview; Inspect Strip or Columns respectively → `strip`, `features`, `feature-rules`. |
| Selection, continuation/rally outlines and drawings | Selection changes aggregate support; continuation marks describe historical POC outcomes; rally outlines include member-containing cells; drawings are authored geometry. Inspect/detail routes above plus `selection`, `evidence`, `rallies`, `drawing-rules`; outlines do not imply exclusive cell membership or predictive evidence. |

## Evidence and limits

A local fake-backed runtime walk also checked generated menus, Query/Compare and scale/axis/profile details. It found and repaired vocabulary gaps in preset names, flow actions, comparison controls, scale diagnostics and model-provenance fields. Source reconciliation includes recorded/live/Mill restrictions; desktop/phone arrangements; hidden/empty/loading/error/disabled/filtered/replay states; measure/basis changes; selection/lens/folded profiles; drawer/dialog/menu producers and repeated records. New article vocabulary is indexed centrally. Existing topics supply shared concepts; new tables explain field-level semantics, and six articles fill source/context/layout/query/feature-rule/reference gaps.

`tests/unit/reference-discovery.test.js` uses literal UI terms and independently specified denominators/workflow limits. `tests/browser/reference-discovery.spec.js` verifies search/table content, no-match recovery, generated Since reveal on desktop/phone, Query reveal, axes/profile targets, and absent/present Mill tabs without discovery. Existing reference, time-window, tooltips and controls-a11y suites guard neighboring behavior. CI still runs the full suite; no universal checkbox or new all-control CI gate is introduced.

Real Origo/Mill/field-data services, assistive-technology hardware, and every product-state combination are **not runtime-certified by this audit**. Conditional service rules and unexercised combinations are reconciled in source; browser evidence uses the pinned fake and recorded Mill-response route. This inventory certifies reference mapping/content, not service correctness, market semantics beyond the stated contracts, or a human usability study.
