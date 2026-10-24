(() => {
  "use strict";
  // One reference structure throughout: purpose, interpretation, action. Targets identify real UI
  // or regions of the current canvas; reading never turns features on or changes a saved view.
  const topics = [
    { id: "grid", group: "Read the market", title: "Time × price grid",
      terms: ["Time × price", "crosshair", "time labels", "price labels", "Time by price grid with real traded volume, point of control and linked volume profile"],
      purpose: "Locate trading activity in time and price. Each cell covers one time interval and one price band.",
      read: "Time runs left to right; price increases upward. Colour describes the selected Cells measure. A blank cell can mean no activity; marked cells can mean unavailable data.",
      use: "Start with Volume, then inspect a cell to read its amount and coverage. Change the time window or resolution to move between detail and context.",
      targets: [{"label":"Show grid","region":"cells"},{"label":"Show measure control","selector":"#ol-mode"}], colour: "cells" },
    { id: "window", group: "Read the market", title: "Time window & price axis",
      terms: ["15m", "30m", "1h", "4h", "12h", "24h", "7d", "30d", "45d", "90d", "180d", "270d", "1y", "All", "Last hour", "Last 12 months", "This year", "Last year", "Since (UTC)", "Time window", "Price axis", "Free axes", "Refit", "Coupled", "Diagonal", "Latest", "Fit the price range", "15 minutes", "30 minutes", "1 hour", "4 hours", "12 hours", "24 hours", "7 days", "30 days", "45 days", "90 days", "180 days", "270 days", "1 year", "All history"],
      purpose: "Choose the history to examine and how price follows time navigation.",
      read: "Minutes and hours (15 minutes, 30 minutes, 1 hour, 4 hours, 12 hours, 24 hours) and Days (7, 30, 45, 90, 180, 270 days) are rolling spans ending at the data edge. 1 year is 365 days. This year begins 1 January UTC of the cutoff year; Last year is the previous complete UTC calendar year. All history begins at the cube epoch. Since (UTC) starts at the chosen day’s UTC midnight. Every window except Last year follows new data; the chart can leave space beyond its measured end.",
      use: "Choose Time window to select a preset or Apply since date. Since accepts days from 1 January 2021 strictly before the data edge; an invalid date keeps the current view. Choosing a window seeds resolution when Auto is on, preserves locked levels, clears selection and the continuation anchor, leaves Replay and fits price. Rows and Background with Visible range follow the new time window. Price axis offers Free axes, Refit, Coupled and Diagonal; F fits price once. Use Bounds for an exact rectangle.",
      targets: [{"label":"Show time window","selector":"#ol-window"},{"label":"Show Since (UTC)","selector":"#ol-window-since","open":"#ol-window"},{"label":"Show price-axis control","selector":"#ol-follow"}], colour: "none" },
    { id: "resolution", group: "Read the market", title: "Resolution",
      terms: ["Resolution", "Time cell duration", "Price row width", "Auto resolution", "Time cell −", "Time cell +", "Price row −", "Price row +", "Lattice", "Auto level", "Coarser price cells", "Coarser time cells", "Finer price cells", "Finer time cells"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Time − / +; Price − / +","Halve or double the time-cell duration or price-row width. A locked level stays selected; Auto adapts to screen size."],["Lattice; Ready / Pending / Unavailable","Choose the time and price level together. Availability describes whether data can be supplied, separately from the small / usable / large size glyph."],["Cell size; coarser than requested","The rendered level may fall back to available coarser data. Inspect its actual bounds; nominal request and rendered support can differ."]]},
      purpose: "Choose the time interval and price width aggregated into each cell.",
      read: "Larger cells sum more activity. Time and price sizes are independent. Auto chooses levels from screen size; a locked level stays chosen. A coarser fallback means the requested detail is unavailable.",
      use: "Open Resolution and use the time and price steppers or the lattice. Ready, pending and unavailable describe data availability; small, usable and large describe cell size on screen.",
      targets: [{"label":"Show resolution","selector":"#ol-res"}], colour: "resolution" },
    { id: "measures", group: "Read the market", title: "Cells: trading measures",
      terms: ["Cells", "Volume", "Trades", "Trade size", "Taker flow", "Taker trades", "Delta", "Cascade", "Geometry", "Buyer-initiated count share", "Seller / buyer mean", "Cells: Volume", "Continue", "Done", "Step 1: Measure", "Step 2: Transform", "Step 3: Basis", "Step 4: Scale", "Step 5: Options", "Delta · taker-buy minus taker-sell USDT", "Mean reported trade"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Trade size; Taker flow; Taker trades","Trade size = USDT / trades. Taker flow = taker-buy USDT / total USDT; Taker trades = taker-buy count / total count. A missing or zero denominator is undefined."],["Geometry","Shows occupied time × price cells rather than the magnitude of a trading measure."],["Buyer-initiated mean; Seller-initiated mean; Seller / buyer mean","Side-specific USDT / side-specific trade count; the ratio divides seller mean by buyer mean. Empty denominators remain unavailable."],["Net taker imbalance; Share of all-price volume (same time)","Imbalance is (buy − sell) / total USDT. Column share is this price band’s USDT / all-price USDT on the same time support."],["Measure / Transform / Basis / Scale / Options steps; Continue →; Done","Step buttons revisit available settings. Continue advances the menu without changing the current choice; Done finishes. Choosing an option advances to the next offered step; right-click chooses and finishes immediately. Rows/Background add Period and RSI adds Timeframe when applicable."]]},
      purpose: "Choose what each cell measures; its tooltip and inspector report the same quantity.",
      read: "Volume is traded USDT; Trades is the count; Trade size is USDT per reported trade. Taker flow is the taker-buy share of volume; Taker trades is the taker-buy share of trades. Delta is taker-buy minus taker-sell USDT: the aggressive side, not net buying or participant intent. Cascade measures concentration within the cell's four-child parent: 0 means an even quarter, +2 means the whole parent; it does not identify liquidations. Geometry shows occupancy.",
      use: "Choose a Cells measure, then its supported basis. Amount uses observed totals; Intensity uses covered time and price. Shares centre on 50%, Delta on zero, Cascade on an even split. Colour opens the actual fitted key.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show grid","region":"cells"}], colour: "cells" },
    { id: "candles", group: "Read the market", title: "Candles",
      purpose: "Read each time interval's exact open, high, low and close instead of colouring price cells.",
      read: "The body spans open to close; the wick reaches low and high. Up candles are hollow, down candles are filled, and unchanged candles are neutral. Prices do not snap to the grid's price rows. Coverage and unfinished intervals still matter.",
      use: "Choose Candles in Cells or press K to toggle back to the previous encoding. Use Lens for finer candles, and hover, Inspect or the Cells table for exact prices. Candles requires the live cube; recorded data reports unavailability.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show price chart","region":"cells"}], colour: "candles" },
    { id: "movement", group: "Read the market", title: "Cells: movement measures",
      purpose: "See where price travelled or stayed, including cells with movement and no trades.",
      read: "Path measures distance travelled in cell row spans; the record also gives USDT moved and spans per minute. Dwell is the cell's share of its column's covered time. Movement-only cells have an inset stroke; insufficient screen space is counted as detail unresolved.",
      use: "On the live cube, choose Path or Dwell in Cells. Inspect for exact movement and coverage. These measures are unavailable in the recorded snapshot.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"}], colour: "cells" },
    { id: "scales", group: "Read the market", title: "Colour scales & comparison",
      terms: ["Colour", "Color", "Cell colour key", "Cell colour scale", "Background colour scale", "Auto color", "Fit scale", "Comparison lock", "Manual range", "Scale policy", "Explore", "U", "k", "Mapping", "Cohort", "Background scale", "Details", "Dismiss", "Scale", "Show fitted colour scale"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Cell colour scale; Background colour scale","Open the corresponding scale for units, ticks, mapping identity, cohort, support, fit time, exclusions and warnings. Background is independent of Rows profile lengths."],["Fit scale; Auto color; Explore; Comparison lock","Fit once, refit after settled changes, hold each context’s fit, or hold a mapping across compatible contexts. A locked mapping may be a later-fit override in Replay."],["Linear; Log; Relative rank; Amount; Intensity","Choose transform and supported measurement basis. U is the upper magnitude; k controls log curvature. Shares retain their fixed midpoint."],["Manual range; Apply; reset / automatic domain","Enter finite bounds in the displayed units; signed/share domains obey their shown symmetry rules. Apply validates before changing the domain. Restore automatic fitting to leave a manual domain."],["Ticks; clipping; low discrimination; More; Dismiss","Ticks label the current mapping. Saturation preserves raw values. More reveals a notice’s evidence; Dismiss hides that notice, not its underlying condition."],["Calibrated on; Origin; Knots; At the endpoint","Calibrated on names the fitting population, count and exclusions. Origin states how the mapping was made/restored. Knots are the quantile approximation points for Relative rank. At the endpoint counts values exactly at either mapping endpoint, separately from clipping."],["Below range; Above range; Marks outside the scale; Area outside the scale","Below/Above count finite observations beyond a held domain. Marks outside the scale is their fraction of marks; Area outside the scale weights their drawn area. These diagnostics qualify saturated colours while exact raw readings remain available."],["No current volume (−∞); No reference volume; Empty-both","For Profile-share, a zero current numerator against positive period volume is −∞; absent reference and both-empty supports remain separate denominator states."],["Changed by; Was; Now","A scale-change notice names the operation that changed the mapping and its previous/current descriptions. It does not describe a change in market activity."]]},
      purpose: "Establish what a shade means before comparing cells or rows.",
      read: "Value preserves amounts on a linear or log1p scale; Relative rank approximates position in fitted observations. Explore holds a fit per context; Auto color refits after settled changes. Fit calibrates once. Comparison lock holds colour and axes across compatible contexts; Local contrast belongs to the lens. Later replay cutoffs can invalidate a fit.",
      use: "Expand Cell colour scale or Background colour scale below for ticks, fitted data and controls. Fit recalibrates once. Use Comparison lock when comparing across resolutions or periods; check out-of-range and low-discrimination notices. Local contrast applies only to the lens.",
      targets: [{"label":"Show cells","region":"cells"},{"label":"Show row strip","region":"rows"}], colour: "cells" },
    { id: "rows", group: "Read the market", title: "Rows & Background",
      terms: ["Rows", "Background", "Off", "Relative volume", "Profile-share", "Time at price", "Visible range", "This week", "This month", "Since (UTC)", "Background: Off · 90 days", "Rows: Off · Visible range", "Row volume versus mean traded row"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Off; Volume; Delta; Time at price; Relative volume; Profile-share","Off hides that channel. Volume and Delta are totals; Time at price is dwell. Relative volume compares with mean traded-row volume; Profile-share compares current and reference shares over common support."],["Visible range; 1 day; This week; 7 days; This month; 30 days; 90 days; This year; 1 year; 3 years; Since (UTC)","Fixed day spans roll from the effective edge; calendar periods begin at UTC boundaries (Monday for weeks); Since begins at UTC midnight. Visible range follows chart time. Source coverage and approximation remain disclosed."]]},
      purpose: "Choose the second profile and price-row background independently.",
      read: "Rows controls the second vertical profile and defaults to Off · Visible range. Background controls the native-row strip and faint backdrop and defaults to Off · 90 days. Both selectors offer the same measures, periods and source restrictions, with independent selections. Volume and Delta are period totals; Time at price is covered dwell. Relative volume is log₂(row period volume / mean traded-row volume): 0 is average, +1 double, −1 half. Background colours and profile lengths have separate scales.",
      use: "Choose Measure and Period inside Rows or Background; each closed selector names both. Visible range follows the chart's time window, ignoring selection and price crop. Fixed periods ignore navigation and selection. Both end at the data or replay edge. Use Background colour scale for colours and Profiles for length axes and comparison.",
      targets: [{"label":"Show Rows control","selector":"#ol-rows"},{"label":"Show Background control","selector":"#ol-background"},{"label":"Show Background strip","region":"rows"}], colour: "rows" },
    { id: "profiles", group: "Read the market", title: "Profile tracks",
      terms: ["Profiles", "Profile comparison", "Independent axes", "Shared absolute", "Shared row share", "Current axis", "Reference axis", "Window W", "Profile tracks", "Buy subset", "Independent axes · Auto"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Profiles; Current / Reference axis; Window W; totals; domains","Profiles opens the comparison controls. Window W names the common price support; totals and domains qualify every equal-length comparison."],["Independent axes; Shared absolute; Shared row share","Independent lengths are not directly comparable. Shared absolute needs Volume on both; row share needs nonnegative distributions and positive totals. Folded tracks can be revealed through Profiles."],["Current track; Reference track; Buy subset; Point of control; Price rows; Total over W, current; Total over W, reference; Result","Current track names view or selection; Reference track names the Rows measure and period. Buy subset is the inset of current taker-buy volume. Point of control uses the volume profile. Shared modes coarsen to common price rows; both totals over W are denominators. Result states why an otherwise selected comparison cannot be drawn."]]},
      purpose: "Compare how activity is distributed across price levels.",
      read: "The current track is view or selection volume, with taker-buy volume inset; the reference track uses the Rows measure and period. Independent axes scales each separately. Shared absolute makes equal lengths equal amounts. Shared row share makes each row a percentage of its own track's total over the common price window: 20% versus 10% is twice the concentration.",
      use: "Use Profiles or expand Profile comparison below. Shared absolute needs Volume on both tracks; row share needs nonnegative distributions. Read Window W, both totals and domains. Narrow charts fold the tracks; use Profiles to reveal them.",
      targets: [{"label":"Show profile settings","selector":"#ol-profile-chip"},{"label":"Show profile tracks","region":"profiles"}], colour: "profiles" },
    { id: "columns", group: "Read the market", title: "Columns & indicators",
      terms: ["Columns", "Axes", "Same as cells", "Choppiness", "Volume per path", "Volume per touched row versus expected", "Hold", "Manual", "Axis", "Columns: Same as cells"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Volume; Trades; Trade size; Delta","Each column sums all its price rows for totals; Trade size divides its USDT by its trade count. Delta is buy minus sell USDT."],["Choppiness; Volume per path","Choppiness divides travel by the column’s high–low range. Volume per path divides USDT volume by USDT travel. Zero or absent denominators have separate non-values."],["Volume per touched row versus expected","Read the observed USDT per touched 125-USDT row, parent ratio and model expectation together. Model training and known-through disclosures determine what was available at Replay."],["Axes; Auto axis; Frozen; Fixed scale; Hold","Open Axes for column/profile domains, units, policy, fitted-through, hold reasons and clipping. Auto axis follows eligible data; Comparison lock freezes axes; fixed scales have declared domains. Hold reports why an axis is held. These length axes are separate from colour scales."],["Model applies to; ISO A; ISO B; Baseline","The range-derived model sets the diagonal as m = round(ISO A + ISO B × n) and the touched-row expected ratio as 2^(ISO B − 1). ISO A = −1.06 and ISO B = 0.486; Baseline is approximately 0.70. Applicability describes the measured population; these are empirical reference parameters."],["Fitted levels; History start; Extraction; Fit time; Eligibility upper bound","The fit used levels n = 6…13 and history from 2021-01-01, extracted 2026-09-24. Exact Fit time, precision, method version and latest training observation are unknown. Before extraction the model is retrospective; during that UTC day timing is unverified; from 2026-09-25 00:00 UTC it is eligible by a conservative upper bound, not a known training timestamp. Outside the fitted range (including the parent for the touched-row ratio), interpretation is extrapolation."]]},
      purpose: "Read time-based summaries below the price grid.",
      read: "Columns has its own measure and axis. Same as cells selects a companion: totals for additive measures, net taker volume/count for shares, Choppiness for Path, Volume per path for Dwell, Volume for Geometry/Candles. RSI and MACD use native closes. The model compares touched-row volume against its parent and fitted expectation; timing and fitted levels qualify it.",
      use: "Choose Columns independently of Cells; use Axes for its domain and provenance. Inspect reads the canonical value and companions. Read the series key for indicators and the model's timing before interpreting its ratio.",
      targets: [{"label":"Show Columns menu","selector":"#ol-pane"},{"label":"Show axes settings","selector":"#ol-axis-chip"},{"label":"Show column pane","region":"columns"}], colour: "columns" },
    { id: "strip", group: "Read the market", title: "Strip & forces",
      terms: ["Strip: Off"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Net lean; Macro; Positioning; News; Social; Attention; Known inputs; Known forces; Known attention inputs","Net lean sums the selected forces; each force’s inputs are fixed descriptive scores. Attention sets brightness. Coverage counts available inputs/forces, not statistical confidence. Partial, Detail unavailable, Retrospective, After field cutoff and After effective edge qualify support."],["Track record · next 24 h; Nearby; All moments; p5; p50; p95","The track record compares BTC’s next-24h percent changes for similar earlier force moments with all eligible moments. p5/p50/p95 are historical quantiles; the down share is an observed frequency. At least 30 similar moments are required, and overlapping samples do not establish forecast odds."],["Schedule; Precision; Importance; Date certainty; Date changed; Calendar weight; Known at","Events retain the schedule known at the edge. Precision distinguishes an instant from a date/range; it is not classification precision. Importance and date certainty weight calendar light; Date changed reports schedule movement."],["Measured move; Reaction window; Surprise; Ordinary spread; Window status","Measured move is BTC percent change over the event’s completed reaction window. Surprise is −log₂ of its two-sided tail probability under the declared Student-t/DVOL yardstick, in bits. Ordinary spread is that window’s volatility scale; Open/Unmeasured withholds unfinished or absent reactions."],["Measured releases; Required releases; Past release moves; p5 price; p95 price","Past-release quantiles need 30 earlier measured releases of the series. Price equivalents apply historical percent moves to the latest known close. These are descriptive event-series comparisons."],["Ahead; Important events; Horizon; DVOL; Options · risk-neutral; Price p5; Price p95","Ahead lists lit events in the next 90 days. DVOL supplies the annualized options volatility level. Price bounds use close × exp(±1.645 × DVOL × √years), with DVOL as a fraction; they describe risk-neutral whole-horizon ranges, not event-specific forecasts."],["Options · ATM volatility; Today; 1–7 d; 7–30 d; 30–90 d; 90 d+; Put skew; Put/call OI","Maturity buckets report at-the-money implied volatility. Put skew subtracts 7–30 day call IV (1.02–1.10 strike/spot) from put IV (0.90–0.98); Put/call OI is put open interest divided by call open interest. Observed at states the options observation time."],["Current sources; Source status; Observed through; Checked at; Archive begins; Error code; Provider response; Retry after; Retrospective","Source cards disclose each feed’s availability, observation/check/archive timestamps and provider error/retry details. Retrospective history was first collected after its nominal time; later schedule changes do not rewrite an earlier replay. Inspect Strip exposes the complete records when hover stays compact."]]},
      purpose: "See what moves BTC from outside this market: where the forces lean, how much attention it gets, and the events ahead.",
      read: "Strip shows a band under the prices. Forces sums Macro (the dollar, yields and credit), Positioning (funding, futures basis, options skew and stablecoin supply), News (the tone of coverage) and Social (bullish against bearish words); one force can be shown alone, with only its own events. Blue leans up and orange down, stronger the further from zero; a dim band means little attention. A hatch means not known: across the band, no force; along its foot, attention. Light builds toward an event as strongly as the calendar says it matters, and breaks at its time; a date without an hour holds it through the day. A seam marks where its window closed, as strong as its surprise. A dashed line marks where retrospective values end. The box beside the profile holds the next 90 days. Every value is drawn as the edge knew it, the replay's too. The figures are descriptive, not forecasts, and no agent or learned model reads text.",
      use: "Choose Forces in Strip, then all forces or one. Hover the band for the forces as arrows, their parts, and their track record: how BTC moved over the next 24 hours after earlier moments when the forces leaned alike, against all moments, shown from 30 such moments. Hover an event for when it is, how sure its date is, and the move it made; hover the box beside the profile for what lies ahead. Hover the band's name for each source's freshness. The data comes from field-data-api through the bridge, and the band says when it is not served.",
      targets: [{"label":"Show Strip control","selector":"#ol-strip"}], colour: "none" },
    { id: "states", group: "Read the market", title: "Data states & coverage",
      terms: ["Key", "Zero trades", "Detail unresolved", "Short exposure", "Coarser than requested", "Out of range", "Open column", "Canonical through", "Provisional", "Scroll legend left", "Scroll legend right"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Zero trades; movement stroke; sign marks; detail unresolved","Covered zero-trade cells differ from movement without trades. The inset movement stroke identifies Path/Dwell without trades. Plus, minus and ring indicate signed values in resolvable cells; unmarked/detail-unresolved counts mean screen detail is omitted, not that the measured values are missing."],["P · total POC; B · buy POC; VAH and VAL; Price levels; Supported; Held; Lead-in","POC and value-area endpoints identify profile landmarks. Family colour and line pattern identify reference kind and temporal status. See Reference visibility for held-back marks; Scroll legend left/right reveals overflow keys."]]},
      purpose: "Distinguish a measured value from zero, incomplete coverage or unavailable data.",
      read: "The footer keys identify pending, failed, unsupported, undefined and out-of-range marks. Open columns are unfinished; provisional minutes may be replaced by archived data. Edge portions have their own amounts and exposure. Short exposure means less than 10% of nominal time or price coverage.",
      use: "Read the footer and inspect marked cells for their reason. Use the data-through and canonical-through times to judge freshness. Wait for pending data; use the displayed error and retry action when a read fails.",
      targets: [{"label":"Show state key","selector":".ol-status"},{"label":"Show data status","selector":"#ol-state-pill"}], colour: "states" },
    { id: "coordinates", group: "Read the market", title: "Grid precision",
      terms: ["Bounds"],
      purpose: "Reconcile exact bounds with the cube's cells.",
      read: "The base cell is 56.25 seconds × 125 USDT, aligned to 1 Jan 2021 00:00 UTC and price zero. Level n multiplies time by 2ⁿ; m multiplies price by 2ᵐ. Bounds include the lower edge and exclude the upper; requested bounds align to base cells. Midpoints snap upward; a latest-data rectangle closes its open base interval. Live cropped amounts use measured support; a recorded untiled rectangle counts whole snapshot cells inside it.",
      use: "Use Bounds for UTC times and prices. Read requested and measured bounds in Query; a coarser answer does not change the requested rectangle.",
      targets: [{"label":"Show Bounds","selector":"#ol-bounds-settings"},{"label":"Show Query","selector":"#ol-tab-query"},{"label":"Show resolution","selector":"#ol-res"}], colour: "cells" },
    { id: "exposure", group: "Read the market", title: "Amounts & exposure",
      purpose: "Compare quantities on the same measured support.",
      read: "Amount is an observed total. Intensity divides by covered minutes and price width, reported per 125 USDT; trades use the same exposure. Volume, Trades and Delta offer Amount/Intensity; means and shares keep their own denominators. Dwell uses covered column seconds; Cascade uses parent volume. Path spans divide by row width; spans per minute also divide by covered time. Less than 10% nominal time or width is short exposure for a normalized measure.",
      use: "Inspect nominal and observed bounds before comparing. A small rate denominator can amplify a value; it does not increase evidence.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show Inspect","selector":"#ol-inspect-tool"}], colour: "cells" },
    { id: "transforms", group: "Read the market", title: "Value & relative rank",
      terms: ["Transform", "Linear", "Logarithmic", "Log1p", "Relative rank", "Scale range exceeded", "Low discrimination"],
      purpose: "Choose what differences in shade preserve.",
      read: "Linear Value scales to U. Log Value uses log(1 + |x|/k) / log(1 + U/k), retaining sign; k sets curvature. Relative rank approximates position among fitted observations using quantile knots; it is not an exact ordering. Shares and concentration ratios have their own fixed midpoint. Invalid or uncovered observations are excluded and counted. Values beyond a held domain saturate at an endpoint; the raw value remains. Scale range exceeded means over 10% of marks or 25% of area outside the domain. Low discrimination means over 90% of nonzero marks in one end 5% band; neither warning recolours the data.",
      use: "Read the ticks, U, k, support and clipping in the colour scale. A rank shade compares positions, not equal differences in amount.",
      targets: [{"label":"Show colour key","selector":"#ol-cell-key"},{"label":"Show cells","region":"cells"}], colour: "cells" },
    { id: "row-comparisons", group: "Read the market", title: "Row comparison denominators",
      terms: ["Row volume versus mean traded row"],
      purpose: "Keep the three row comparisons distinct.",
      read: "Row concentration is log₂(row period volume / mean traded-row volume): twice the mean is +1. Profile-share is log₂(current share / reference share) over overlapping clipped bins. Shared row share reports each track's percentage over wholly-in-view common bins. For Profile-share, zero current against positive reference is −∞; a positive current against zero reference has no reference; empty-both is separate. Shared axes coarsen by exact summation, never split a coarse row; zero totals are undefined. Signed Delta cannot use a shared share axis.",
      use: "Read Window W and both totals in Profiles. Concentration: 100 against a mean of 50 is +1. Profile-share: 20% against 10% is +1. Shared row share: 20/100 against 40/400 draws 20% against 10%. Selection changes the current distribution; period concentration stays fixed.",
      targets: [{"label":"Show Rows","selector":"#ol-rows"},{"label":"Show Profiles","selector":"#ol-profile-settings"},{"label":"Show profile tracks","region":"profiles"}], colour: "rows" },
    { id: "poc-value", group: "Read the market", title: "POC & value area",
      terms: ["POC centre", "Buy POC centre", "Composite 70%", "Column POCs", "70% area", "Value area high and low", "Daily POC and value area", "Developing daily POC", "Volume profile", "A day in UTC: its POC line runs from that day to the latest data", "Add day"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Daily POC and value area; Developing daily POC","Daily landmarks describe each UTC day; developing POC traces cumulative session volume at 15-minute samples plus the live so-far value. Later session trades can move it."],["Volume profile periods; Since a day; Value area high and low","Each period’s highest-volume row supplies POC; enabling Value area high and low adds its 70% boundaries. Since-a-day sources begin at UTC midnight; the source and row width qualify precision."]]},
      purpose: "Read the profile's reported price landmarks.",
      read: "POC is the centre of its highest-volume row; equal maxima choose the lower row. Buy POC uses taker-buy volume and is unavailable without it. Value area starts at POC and grows contiguously toward the larger neighbouring volume, lower on a tie, until whole rows hold at least 70%. Row width and measured period affect each landmark.",
      use: "Distinguish Column POCs, the current profile and period references. In Lines, use Column overlays for Column POCs and 70% area, or choose period landmarks; inspect their support.",
      targets: [{"label":"Show POC overlay","selector":"#ol-poc"},{"label":"Show 70% area","selector":"#ol-area"},{"label":"Show Lines","selector":"#ol-lines"}], colour: "references" },
    { id: "cascade", group: "Read the market", title: "Cascade & its parent",
      purpose: "Read concentration without treating it as a liquidation detector.",
      read: "Cascade is log₂(4 × child volume / parent volume). The parent has twice the time span and price width: four children. An even quarter is 0; all of the parent is +2. It uses whole-cell totals when the view crops a cell. Its column companion uses a two-child time parent. Zero, missing or unfinished parents have separate states; the coarsest levels have no parent.",
      use: "Inspect the child and parent support. Use the state key for −∞, no reference and open-parent marks.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show cells","region":"cells"},{"label":"Show state key","selector":"#ol-key-guide"}], colour: "cells" },
    { id: "motion-support", group: "Read the market", title: "Path & dwell support",
      purpose: "Account for movement independently of reported trades.",
      read: "Path attributes travel to the later trade's interval and to the crossed rows, retaining USDT travel and row spans. Dwell attributes covered time at price; its share uses covered column time and is not renormalized over the visible rows. Movement can exist without trades. For a 250-USDT move across two 125-USDT rows, path contributions sum to two spans. Dwell sums to covered seconds; unobserved native time is not filled. Open intervals, missing reads and marks too small to resolve are distinct states.",
      use: "Inspect raw travel, dwell seconds and coverage. Use Lens for unresolved detail; the recorded snapshot does not supply movement.",
      targets: [{"label":"Show Cells menu","selector":"#ol-mode"},{"label":"Show Lens","selector":"#ol-lens"},{"label":"Show Cells table","selector":"#ol-tab-cells"}], colour: "cells" },
    { id: "session-levels", group: "Read the market", title: "Session levels",
      terms: ["Session levels price levels", "Daily open", "Weekly open", "Monthly open", "Previous day’s high, low and close", "PDH", "PDL", "PDC", "Location"],
      purpose: "Locate UTC session boundaries and prior-session prices.",
      read: "Day, week and month opens use the first supported bar of the period. Prior-day high, low and close are final only after that UTC day ends; the current period remains so far. Weeks start Monday. Location uses the latest completed loaded 8-hour close, with its timestamp and prior completed-day ATR.",
      use: "Choose Session in Lines. Inspect the exact period, coverage and known-at; absence of an opening input is unavailable.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "references" },
    { id: "structure-rules", group: "Read the market", title: "Structure & swings",
      terms: ["Structure price levels", "All-time high", "Prior cycle high", "4h swings", "1D swings", "Equal highs", "Equal lows", "EQH", "EQL"],
      purpose: "Distinguish a price extreme from its later confirmation.",
      read: "Daily and 4h swings follow an ATR zigzag: reversal must exceed 3 × the preceding bar's Wilder ATR(14). The extreme's time and the confirming bar's end differ. A forming reversal is a candidate. Consecutive same-frame highs or lows within 125 USDT are equal. The prior cycle high precedes the last deep low below half the prior peak before the all-time high. ATH is the highest recorded trade.",
      use: "Inspect occurrence, confirmation and traded-through state. Replay reveals a swing only when the confirming inputs are available.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "references" },
    { id: "retracements", group: "Read the market", title: "Retracements",
      terms: ["Retracements · 30 days", "Retracements · 90 days", "Retracements · last daily swing", "Retracements · last 4h swing", "Classic levels", "Extensions", "A day in UTC: its retracements measure the move between the highest and lowest trade from that day's 00:00 to the latest data", "Add day"],
      purpose: "Read fractions of a declared price impulse.",
      read: "Levels use later − f × (later − earlier): 38.2%, 50% and 61.8%. Classic adds 0%, 23.6%, 78.6% and 100%; Extensions adds 127.2% and 161.8% past the earlier extreme. Sources are rolling 30/90 sessions, since a chosen UTC day, or the latest daily/4h swing pair. Same-8h-bar extremes use its close/open direction to order them.",
      use: "Enable a source before its optional levels; up to twelve dates can be retained. Inspect the anchors, direction, known-at and unclamped depth.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "references" },
    { id: "average-rules", group: "Read the market", title: "Moving averages & bands",
      terms: ["Moving averages", "Golden and death crosses", "Bull market support band", "21 EMA", "50 SMA", "100 SMA", "200 SMA", "200-week SMA", "12 and 28 EMA · 3.75m", "9 and 21 EMA · 15m", "50 and 200 EMA · 1h", "50 and 200 EMA · 4h", "Bollinger · 15m", "Bollinger · 1h", "Bollinger · 4h", "Bollinger · 1D"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["21 EMA; 50 SMA; 100 SMA; 200 SMA; Golden and death crosses","Daily closes supply these windows. A golden/death cross is the 50-day SMA crossing above/below the 200-day SMA."],["200-week SMA; Bull market support band","Weekly closes supply the 200-bar mean and the 20 SMA / 21 EMA pair. The name does not validate a market regime."],["12 and 28 EMA · 3.75m; 9 and 21 EMA · 15m; 50 and 200 EMA · 1h / 4h","Each pair uses the named native timeframe and period lengths. The 3.75-minute bars stand in for the 5-minute 9/21 construction."],["Bollinger · 15m / 1h / 4h / 1D","Each timeframe has its own 20-bar mean and ±2 population standard deviations; squeeze rules differ between 4h and daily bars."]]},
      purpose: "Read close-based summaries on their native bars.",
      read: "SMA is the mean of its window; EMA uses 2/(period + 1), seeded with the first window's mean. Bollinger is SMA(20) ± 2 population standard deviations. The weekly support band is SMA(20)/EMA(21), a construction rather than a regime claim. Intraday pairs use their named bars; 3.75-minute bars are the labelled proxy for the 5-minute 9/21 construction. Warm-up and unsupported bars produce gaps.",
      use: "Choose Moving averages in Lines. Inspect the timeframe, first usable window and so-far status; a line's colour does not identify its timeframe.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "averages" },
    { id: "vwap-rules", group: "Read the market", title: "VWAP & dispersion",
      terms: ["Visible range VWAP", "Session VWAP", "Asia session VWAP", "Europe session VWAP", "US session VWAP", "From the last daily swing high", "From the last daily swing low", "Dispersion", "Add day", "A day in UTC: its VWAP runs from that day's 00:00 to the latest data", "VWAP"],
      purpose: "Read a quote-weighted price approximation on declared support.",
      read: "VWAP is quote volume / BTC volume. Session, visible-range and since-a-day sources use existing profile bins; dispersion uses quote volume at bin centres and is labelled approximate. Swing anchoring starts at the extreme's 8h bar and can include earlier trades within that bar. The recorded source does not supply dispersion.",
      use: "Choose VWAP in Lines and inspect anchor, bin width, measured-through and approximation. A chosen date is UTC; an unsupported input stays unavailable.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "vwap" },
    { id: "clock-rules", group: "Read the market", title: "Clock & calendar assumptions",
      terms: ["Day start", "Week open", "Month open", "Funding schedule", "US equity open", "Binance spot weekend proxy", "Deribit expiry", "Clock"],
      purpose: "Separate scheduled landmarks from measured events.",
      read: "UTC boundaries are calendar marks. Funding assumes 00:00/08:00/16:00 UTC, not measured rates. US opens are weekdays 09:30 New York without a holiday model; expiry markers are Fridays 08:00 UTC, naming the last monthly and quarterly Friday. The Binance spot weekend proxy uses Friday 16:00 and Sunday 17:00 Chicago spots, with signed change relative to Friday. That historical convention is not a current CME closure model after 29 May 2026; stale spots are unavailable. Fill is the first hourly range reaching Friday spot, confirmed only at that bar's completed end.",
      use: "Choose Clock in Lines. Inspect the nearest event, ties earlier, and its elapsed/until time, actual source and confirmation.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show price chart","region":"cells"}], colour: "clock" },
    { id: "untested-rules", group: "Read the market", title: "Untested levels & event lanes",
      terms: ["Untested in view", "Untested daily POCs", "Untested weekly POCs", "Squeeze", "Compression"],
      purpose: "Read each revisit or compression rule on its own horizon.",
      read: "Untested in view uses the loaded columns' row-width revisit rule. Daily/weekly untested POCs scan 30 completed days/26 weeks: later 8h ranges meeting POC ±125 USDT count as a test; only levels within five daily ATRs show. A 4h squeeze is Bollinger width below its trailing 500-bar tenth percentile; daily compression uses its separate 182-day minimum.",
      use: "Inspect an individual event through References, including merged lanes. No revisit is a historical observation, not a claim that price must return.",
      targets: [{"label":"Show Untested in view","selector":"#ol-untested"},{"label":"Show Lines","selector":"#ol-lines"},{"label":"Show event lanes","region":"events"}], colour: "references" },
    { id: "indicator-rules", group: "Read the market", title: "RSI & MACD series",
      terms: ["RSI 14", "MACD · 1D"],
      purpose: "Keep native indicator bars distinct from cube columns.",
      read: "RSI uses Wilder(14) on completed daily or 4h closes, with 30/70 guides. Divergence states price higher/RSI lower or the reverse and requires confirmed swings. Daily MACD is EMA(12) − EMA(26); its signal is EMA(9), histogram MACD − signal. Cross triangles point above/below the signal. Warm-up gaps and forming values remain labelled.",
      use: "Use Columns and read its series key. Inspect native close time, slopes and confirmation; repeated cube columns do not create new indicator bars.",
      targets: [{"label":"Show Columns","selector":"#ol-pane"},{"label":"Show indicator pane","region":"columns"}], colour: "indicators" },
    { id: "state-glossary", group: "Read the market", title: "Non-values & recovery",
      matrix: {headers:["State","Meaning","Action"],rows:[["Zero","Measured no activity; zero Delta can still contain trades","Read the measure"],["Reading / Pending","Read has not answered; no current value","Wait for the read"],["Preparing","Calculation has not concluded; count unknown","Wait for the result"],["Not measured","Its workflow has not run","Run the named workflow"],["Failed","Read error; no substituted zero","Read the error; retry"],["Invalid input","Input is outside its valid measurement range","Inspect the stated reason; correct the input/source"],["Hidden in replay","Support is beyond the effective edge","Move the edge or leave Replay"],["Unsupported","Capability absent in this source","Use an available measure / live source"],["Unavailable / outside support","No eligible covered input","Read support; choose covered bounds"],["Open column / parent","Unfinished support; derived value may wait","Read the measured-through edge"],["Provisional","Measured minutes may be revised by archive","Read canonical-through"],["Undefined / empty population / empty-both","Required denominator or population absent","Inspect numerator and denominator"],["No reference / no coarser parent","Required comparison input absent","Choose an eligible reference / level"],["−∞","Zero numerator against positive denominator","Read the ratio; do not treat as missing"],["No calibration","Raw value may exist; shade has no fit","Fit an eligible scale"],["Clipped / precision / edge portion","Value retains its stated support or precision limit","Inspect exact value and bounds; Lens for detail"]]},
      purpose: "Keep an unknown value distinct from a measured zero.",
      read: "Reading/Pending awaits data; Preparing awaits calculation. Not measured requires its explicit workflow. Failed names a read error; Unsupported lacks the capability; Unavailable lacks eligible support. Undefined is not a finite ratio. −∞ is a zero numerator against positive support; no reference and empty-both have separate denominator states. Open parents can withhold derived values. Out-of-range and precision marks qualify a value rather than replace it.",
      use: "Inspect the stated reason. Retry a failed read, enable the required input, or use Lens for unresolved detail; do not replace a gap with zero.",
      targets: [{"label":"Show state key","selector":"#ol-key-guide"},{"label":"Show data status","selector":"#ol-state-pill"},{"label":"Show Inspect","selector":"#ol-inspect-tool"}], colour: "states" },
    { id: "metadata", group: "Read the market", title: "Source, freshness & build",
      terms: ["BTC / USDT", "Binance spot", "Live cube", "Recorded snapshot", "Data through", "Updated", "Cube version", "Unknown", "Reload", "Source / pack", "Source cutoff", "Canonical cutoff", "Token"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Token; Revision; Observation","Token identifies the source/pack revision. Revision may report replacement of provisional data or unknown revision status. Observation records support/source notes; none of these identifiers reconstructs an unavailable historical vintage."]]},
      purpose: "Identify the market, data boundary and running page before interpreting a value.",
      read: "BTC / USDT names the asset and quote currency; Binance spot names the venue. Live cube and recorded snapshot have different capabilities. Data through is the latest available source observation, independent of the selected time window and Replay. Canonical through separates archived history from provisional minutes. Updated age reports source freshness, not the age of an inspected historical record. The live status pill reports connection/read state. Cube version links to the running commit’s PR; Unknown means build metadata is absent.",
      use: "Read market, snapshot, freshness and status together. Reload retries loading the page. A failed or stale read keeps its reason; it is never a zero. Query exposes effective scope/cutoff and source provenance. Use the build link when reporting a reproducible issue.",
      targets: [{"label":"Show source status","selector":"#ol-data-through"},{"label":"Show Query","selector":"#ol-tab-query"}],
      colour: "states" },
    { id: "selection", group: "Work with the view", title: "Select a region",
      terms: ["Clear selection", "Select"],
      purpose: "Measure a time-and-price rectangle within the chart.",
      read: "The right context pane and current volume profile describe the selection while it exists. Partial edge cells contribute their observed portion. Rows and Background each keep their independent period; Visible range follows the chart time window rather than the selection.",
      use: "Choose Select and drag a rectangle. Inspect cells for detail; use Clear or Escape to return the summaries to the whole view. Selection alone does not anchor an evidence query.",
      targets: [{"label":"Show Select tool","selector":"#ol-select"},{"label":"Show selection","region":"selection"}], colour: "selection" },
    { id: "inspect", group: "Work with the view", title: "Inspect & context",
      terms: ["Inspect", "Open details", "Measurement details", "Background", "References", "Outside the view", "Previous feature", "Next feature", "Higher row", "Lower row", "Back", "Cells", "Close inspector", "Columns", "Find a reference", "Lens", "Next higher price row", "Next lower price row", "Next time cell", "Previous time cell", "Reference", "Rows", "Strip", "Strip measurements"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Cells; Rows; Background; Columns; Strip; References; Lens","Choose the surface independently of the chart tool. Strip measurements selects forces, sources, events or ahead records. References includes enabled items even when drawing budgets hold them back."],["Steppers; Home; End; Open details; Back; Close inspector","Move the inspection cursor within visible support; an irrelevant direction does nothing. Home/End selects the first/last visible item. Open details or Enter reveals the record, Back closes detail, Close inspector leaves Inspect. Outside the view is a cursor location, not missing market data."]]},
      purpose: "Read exact records for cells, rows, columns, references and lens cells.",
      read: "The inspector reports exact records for Cells, Rows, Background, Columns, Strip, References and Lens. Context summarizes the view or selection; inspection alone does not change that measurement. Measurement details disclose raw quantities, nominal/observed support, coverage, state, source, formula and units. Shift reveals exact figures. The inspection cursor remains at its time and price through navigation.",
      use: "Choose Inspect or E, then a surface and feature. Arrows/steppers move the cursor; search finds references. Open details or Enter opens the record; Escape closes detail, then Inspect. Home brings an outside cursor back.",
      targets: [{"label":"Show Inspect tool","selector":"#ol-inspect-tool"},{"label":"Show inspector","selector":"#ol-inspect"}], colour: "histories" },
    { id: "lens", group: "Work with the view", title: "Lens & pin",
      terms: ["Lens"],
      purpose: "Examine finer cells inside a region while keeping the wider context visible.",
      read: "The lens uses the active cell colour scale unless Local contrast is enabled. Finer data is read separately; it becomes the main view only when pinned.",
      use: "Choose Lens, or hold Alt for a temporary peek. Shift+L changes depth from one to four finer levels. Enter or Pin adopts the lens rectangle and resolution; check any resulting scale-change notice.",
      targets: [{"label":"Show Lens tool","selector":"#ol-lens"}], colour: "cells" },
    { id: "references", group: "Work with the view", title: "Reference lines & events",
      terms: ["Lines", "Show all", "Focus this line", "Focus family", "Clear lines", "Add day", "Level line", "Remove Level", "Clear references and Level"],
      purpose: "Locate profile, session, structural, average, VWAP and calendar landmarks.",
      read: "POC is the highest-volume row; Buy POC uses taker buys; a value area reaches at least 70% of volume in whole rows. These depend on the measured period and row width. Session and structure marks locate ranges, equal highs/lows, gaps, swings and retracements. Averages and VWAP trace price summaries. Session VWAP resets at 00:00 UTC; Asia uses 00–08, Europe 08–16 and US 13–21 UTC daily. Regional windows overlap and use fixed hours; each stops accumulating at close. Clock schedules are vertical marks; squeezes and the spot weekend proxy occupy event lanes. A reference locates a hypothesis; it does not establish support, resistance or future direction.",
      use: "Open Lines to expand Volume profile, Session levels, Structure, Moving averages, VWAP or Clock. Enable each desired line or period; Add day adds a UTC-date source and its remove action drops it. Focus brings one line or family forward; Show all restores the visibility budget. Clear turns references off, including the Level line. Inspect References includes held-back items. X places a Level line at the row centre or clears the existing line; it persists as a price through zooms.",
      targets: [{"label":"Show Lines menu","selector":"#ol-lines"},{"label":"Show event lanes","region":"events"}], colour: "references" },
    { id: "drawings", group: "Work with the view", title: "Trend drawings",
      terms: ["Trend line", "Your drawings"],
      purpose: "Add and retain your own geometric price references.",
      read: "A drawing is your annotation. Its two anchors are UTC time and USDT price, so it remains tied to the market coordinates when the view changes.",
      use: "Choose the trend tool and place two anchors. Select a drawing to edit its coordinates, name, colour and label, or use its available lock, copy and delete actions. Undo restores drawing changes.",
      targets: [{"label":"Show drawing tool","selector":"#ol-trend"}], colour: "drawings" },
    { id: "reference-visibility", group: "Work with the view", title: "Reference visibility",
      terms: ["Focus"],
      purpose: "Understand why an enabled reference may not be drawn.",
      read: "Colour names the family; stroke pattern and the record distinguish confirmed, candidate, forming and retrospective marks. Timeframe is in the name. Off-screen references and label budgets can hold marks back. Focus temporarily brings one reference or family forward; Show all restores the normal budget. Eligibility and known-at remain separate from visibility.",
      use: "Use Lines focus actions or open an Inspect reference detail. The reference chooser includes held-back items; search by name and read its status.",
      targets: [{"label":"Show Lines","selector":"#ol-lines"},{"label":"Show Inspect","selector":"#ol-inspect-tool"}], colour: "references" },
    { id: "history-reading", group: "Work with the view", title: "Inspector histories",
      terms: ["Measurement profile", "Buyer-initiated mean", "Seller-initiated mean", "Net taker imbalance", "Share of all-price volume (same time)", "Seasonal activity (all-price USDT)", "Price response", "History not captured", "Share of interval volume", "Mean reported trade"],
      purpose: "Read historical companions on their declared support.",
      read: "The compact record keeps its selected value and three companions; twelve intervals use a fixed price band. Each miniature has its own vertical scale, so equal heights do not mean equal amounts. Gaps mean unavailable support, not zero. Price response is all-price close − open and pairs with activity only on equal time support; each interval uses its own prior completed-day ATR. Seasonal history has 32-bit input precision.",
      use: "Open details for units, supports and exact values. Search References, use its steppers, and capture a cell only after its desired histories are available.",
      targets: [{"label":"Show Inspect","selector":"#ol-inspect-tool"},{"label":"Show details","selector":"#ol-inspect-open-detail"}], colour: "histories" },
    { id: "lens-rules", group: "Work with the view", title: "Lens support & pinning",
      terms: ["Lens", "Pin", "Local contrast", "Depth", "Alt", "Inspect the lens", "Lens depth", "Pin lens"],
      purpose: "Keep finer inspection separate from adopting a new view.",
      read: "Depth lowers time and price levels by up to one to four steps, stopping at base levels. Finer support is read separately and may be pending or unavailable. Inspect can hold the lens frame. Local contrast has its own colour fit; otherwise the main mapping applies. Pin adopts the rectangle and resolution and can trigger a disclosed scale change.",
      use: "At n=4, m=2, depth 1 reads n=3, m=1; depth 4 stops price at m=0. Use Alt for a peek, Inspect to hold, then Pin or Enter to adopt bounds/levels and record navigation. Read coverage and any calibration change.",
      targets: [{"label":"Show Lens","selector":"#ol-lens"},{"label":"Show Lens controls","selector":"#ol-lensbar"}], colour: "cells" },
    { id: "drawing-rules", group: "Work with the view", title: "Drawing operations & recovery",
      terms: ["Trend", "Drawings", "Show drawings", "New drawing", "Edit", "More", "Name", "Label", "Colour", "Color", "A time", "B time", "A price", "B price", "Apply", "Cancel", "Lock", "Unlock", "Delete all", "Undo", "Redo", "Duplicate", "Copy drawing", "Recover drawings", "Cancel drawing choice", "Cancel editing", "Choose drawing color", "Color · #RRGGBB", "Delete line", "Label · optional", "Price · USDT", "Time · UTC", "Undo drawing"],
      purpose: "Retain an annotation without confusing it with data.",
      read: "G places A then B by clicks or a drag. Move the line or an endpoint; coordinates stay UTC/USDT and authored A→B order is retained. Name identifies it; Label is the caption, with a custom Name used when Label is blank. Colour is your RGB choice; the caption shares it at the first usable anchor. Lock prevents movement; per-line and collection visibility are separate from deletion. Undo/Redo covers the drawing collection, not navigation.",
      use: "Use Edit or the context menu for coordinates/Delete; More for Undo/Redo, copies and recovery. Reload keeps the tab snapshot; recovery revisions can expire on later saves. Recover by timestamp/workspace/name; complete codes keep drawings permanently. Replay annotations may reflect later knowledge; authorship time is unrecorded.",
      targets: [{"label":"Show drawing tool","selector":"#ol-trend"},{"label":"Show Lines","selector":"#ol-lines"}], colour: "drawings" },
    { id: "mobile", group: "Work with the view", title: "Phone controls & highlights",
      terms: ["Controls", "Close controls", "Back to reference"],
      purpose: "Reach the same view and records on a narrow screen.",
      read: "Controls contains the chart menus. The reference remains a left pane beside a horizontally scrollable workspace; the inspector and drawer have their own position. Show reveals a hidden control sheet or scrolls to an existing target. It does not enable a measure, create a selection or start discovery. Back to reference returns to the article.",
      use: "Use Close reference for the full chart, or Show then Back to reference. Inspect has Open details; table, profile and collection actions use labelled buttons.",
      targets: [{"label":"Show Controls","selector":"#ol-sheet-toggle"},{"label":"Show chart","selector":"#ol-canvas"}], colour: "none" },
    { id: "context-reading", group: "Work with the view", title: "Context totals & cell counts",
      terms: ["Context", "USDT volume", "Buyer-initiated USDT", "Buyer-initiated trades", "Buyer-initiated share", "Cell counts", "Occupied cells", "Edge cells", "Zero-trade cells", "Moved through", "Unfinished cells", "Path and dwell to", "Measures", "Delta · taker-buy minus taker-sell USDT", "Mean reported trade"],
      purpose: "Interpret the right pane’s totals and diagnostics on the same measured rectangle.",
      read: "USDT volume and Trades sum reported trades; Buyer-initiated USDT and Buyer-initiated trades count taker buys. Buyer-initiated share divides buy USDT by total USDT; Delta is buy minus sell USDT. POC centre, Buy POC centre and Composite 70% use the declared profile. Path · USDT is attributed travel; Dwell is covered time and can exist in zero-trade cells. Path and dwell to states their completed measurement boundary. Bounds identify the view or selection, not the active Inspect cell.",
      use: "Open Context to read the view, or Select a region to replace these summaries. Expand Cell counts: Occupied cells traded; Edge cells intersect rectangle boundaries; Zero-trade cells are covered closed cells without trades; Moved through counts those with movement; Unfinished cells intersect the open column. Missing coverage remains unknown. Inspect Measurement details for exact support and units.",
      targets: [{"label":"Show Context control","selector":"#ol-context-tab"},{"label":"Show selection tool","selector":"#ol-select"}],
      colour: "cells" },
    { id: "navigation", group: "Work with the view", title: "Navigation, layout & reset",
      terms: ["Pan", "Theme", "Fullscreen", "Collapse context", "Resize bottom panel", "Drawer grip", "Clear selection", "Reset canvas", "Cancel", "Collapse the inspector", "Reset", "Resize the drawer", "Resize the inspector"],
      purpose: "Move through the market and arrange the workspace without changing measurement definitions.",
      read: "Pan drags time/price. Wheel zooms; Shift-wheel changes price over the chart while time labels still zoom time. Free axes separates them, Refit fits visible activity, Coupled zooms both and Diagonal follows the resolution relationship. Context / Continuations chooses the right pane; its collapse control folds it. Drawer tabs toggle bottom panels and the grip resizes their height. Theme changes appearance; Fullscreen changes available screen area.",
      use: "Use Home/End and the keyboard shortcuts as shown in the key guide, F to fit price, Controls on a phone, and Back/Forward for tab history. Clear removes the selection. Reset canvas opens confirmation: Cancel keeps the workspace; Reset returns to defaults and clears drawings, references, selection, Replay and captures. Export retained work first; drawing and comparison undo are separate.",
      targets: [{"label":"Show chart","selector":"#ol-canvas"},{"label":"Show reset control","selector":"#ol-reset-canvas"}],
      colour: "none" },
    { id: "evidence", group: "Evaluate & retain", title: "Continuations & matching cases",
      terms: ["About this evidence", "Candidate eligibility and outcome ledger", "Continuations", "Inspect cases", "Inspect higher POC cases", "Inspect lower POC cases", "Inspect unchanged POC cases", "Next POC", "POC barriers"],
      purpose: "Compare historical outcomes after market states resembling an anchored column.",
      read: "Continuations separates matching cases from all seasonally eligible cases and shows their outcome rates and differences. Outcomes measure POC movement, not trade returns. Horizon determines how far ahead outcomes are read; barrier settings apply to POC-barrier outcomes. Historical rates and pointwise intervals do not calibrate forecast odds or establish a trading edge after costs.",
      use: "Open Continuations or press C, then click a completed column with Pan to anchor it. Choose outcome and horizon, read the matching-case count and explanation, and open Cases to inspect examples. A selected rectangle and a continuation anchor serve different purposes.",
      targets: [{"label":"Show Continuations tab","selector":"#ol-evidence-tab"},{"label":"Show Cases panel","selector":"#ol-tab-cases"}], colour: "evidence" },
    { id: "rallies", group: "Evaluate & retain", title: "Rallies: observed upward moves",
      terms: ["Rallies"],
      purpose: "Discover upward price moves in native trades using an explicit operational definition.",
      read: "First passage ends at the target; Controlled advance also limits pullback; Swing confirms after a reversal from a qualifying high. Thresholds use basis points or frozen ATR14-SMA on native UTC 15-minute bars. Confirmation describes an observed event, not future gains. Binance spot data cannot establish short covering or derivatives leadership.",
      use: "Open Rallies, choose the definition and UTC analysis window, then Discover on the live cube. Select a confirmed event for member-only totals and profile. Grid, replay and time-to-target filters reuse the discovery; Refresh discovery applies changed definition or window settings. Cell outlines can include other trades alongside members.",
      targets: [{"label":"Show Rallies panel","selector":"#ol-tab-rallies"}], colour: "rallies" },
    { id: "features", group: "Evaluate & retain", title: "Find features: what describes marked windows",
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Bars; Mark; Bars before","Bars chooses native Mill bar duration. Mark labels bars inside windows or the selected number of bars before each window. Chart price bounds do not select feature prices."],["Compare against; Pool","Compare marked bars with All of Mill’s data or Visible time, clipped to available bars and the chart cutoff. Pool selects factories and parameter settings; ranked, screened and skipped counts disclose available inputs."],["Add selection; Remove; Clear windows; Find features; Find again","Mark the selected time interval, remove one or all windows, then explicitly run the search. Editing windows invalidates its answer. A pending search holds its input; Stop waiting cancels the client wait and Mill may finish."],["Leader; End preview; Copy rule as Limen manifest","Select a candidate to show its series in Columns and rule hits in Strip. End preview restores Columns. Copy keeps the rule as experiment YAML; a failed clipboard provides selectable text. Nothing here is saved."],["Summary; Moves with it","Summary reports marked/unmarked bars, window count, screened/pool columns, bar size, pool-through and calculation time. Moves with it lists ranked features with absolute correlation above 0.9; similarity is not independent evidence."],["Preview · Value; Bars per point; Factory; Bars; Rule hits; Marked","Value is the selected feature’s Mill series, known when its bucket’s last bar closes. Bars per point gives bucket aggregation; Factory names its source construction and Bars names Mill’s timeframe. Marked locates your windows; Rule hits locates in-sample threshold passes. These lanes do not measure the cube’s cells."]]},
      terms: ["Add selection", "Bars", "Bars before", "Clear windows", "Compare against", "Copy rule as Limen manifest", "End preview", "Find features", "Mark", "Pool", "Stop waiting"],
      purpose: "Ask Mill which of its features separate the windows you mark from the rest, and whether that beats chance. Offered where the page is served with Mill.",
      read: "AUC is the chance that a marked bar’s value ranks above an unmarked one: 0.5 separates nothing; direction says higher or lower inside or before windows. Beyond chance means adjusted p ≤ 0.05 against the best column of the whole pool under time-shifted windows. A 90% interval needs at least 30 windows. One window describes and cannot test. Rules are thresholds fitted in sample. Mill computes on its own bars, through the chart’s cutoff; this is not out-of-sample validation.",
      use: "Select a rectangle and Add selection for each window, choose the bars, what to mark and what to compare against, then Find features. Select a leader to preview it in the Columns pane, its rule's hits as a strip lane; End preview restores the pane. Copy rule as Limen manifest gives a Furnace experiment. Nothing is saved.",
      targets: [{"label":"Show Find features panel","selector":"#ol-tab-features"}], colour: "none" },
    { id: "replay", group: "Evaluate & retain", title: "Replay & model timing",
      terms: ["Replay", "Edge · UTC", "Jump", "Speed", "Columns per second", "Play", "Pause", "Back", "Next", "Now", "End replay", "Next column", "Previous column", "Replay speed"],
      purpose: "Explore history with an explicit effective data cutoff.",
      read: "The replay edge limits measurements and reference periods. Scales fitted after that cutoff are invalidated, unless a deliberate comparison lock is disclosed as an external override. Replay uses currently available history; original data vintages are not guaranteed. Volume per touched row versus expected model timing has its own disclosure.",
      use: "Open Replay and enter an edge, select a column, or step/play. The effective Cells edge aligns to a completed grid column; Candles retains the exact exclusive timestamp. Read source/model timing; exit Replay to restore its workspace and scales.",
      targets: [{"label":"Show Replay control","selector":"#ol-replay"}], colour: "states" },
    { id: "tables", group: "Evaluate & retain", title: "Rallies, Cells, Cases & Query drawer",
      terms: ["Cells table", "Candles table", "Export CSV", "Sort", "Time UTC", "Price USDT", "Open", "High", "Low", "Close", "Net move", "High–low", "Previous", "Next", "Accumulated travel · USDT", "Buyer-initiated USDT", "Buyer-initiated trades", "Cells", "Cells measure", "Dwell · seconds", "Price · USDT", "State", "Time · UTC", "Trades", "USDT volume", "Export rallies CSV", "Export cells CSV", "Export cases CSV", "Export candles CSV"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Time · UTC; Price · USDT; USDT volume; Trades; Buyer-initiated USDT; Buyer-initiated trades","Time and price identify the record’s bounds; totals count reported trades on measured support. The buyer quantities count taker buys. Cells measure uses the active encoding and basis; State qualifies whether it is measured."],["Accumulated travel · USDT; Dwell · seconds; OHLC; Net move; High–low","Travel sums attributed price movement; dwell sums covered time. Candles supplies exact traded Open/High/Low/Close; Net move = close − open; High–low = high − low. These require live capabilities and can be pending or unavailable."],["Sort headers; Previous; Next; Export CSV; Copy; Add to comparison","Choose a header again to reverse sorting. Paging changes visible rows. CSV keeps the full filtered result. Enter opens a cell in Inspect; Copy/Add use that cell’s current record. A sort action does not change its numeric meaning."]]},
      purpose: "Inspect the underlying records and the exact configuration behind the chart.",
      read: "Rallies lists confirmed native events; Cells lists measured cells; Cases lists continuation examples; Query summarizes bounds, measures, scales, axes and provenance. Sorting changes table order, not the measurements.",
      use: "Choose a bottom-panel icon; choose again to close. T toggles the current panel. Cells arrows/Enter inspect records; Export CSV retains the full filtered result. Query provides bounds, codes and provenance.",
      targets: [{"label":"Show panel toggles","selector":".ol-drawer-bar"}], colour: "none" },
    { id: "compare", group: "Evaluate & retain", title: "Compare captured cells",
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Expand; Collapse; Cards; Matrix; Previous; Next","Expand uses the workspace; Cards and Matrix change presentation. Paging changes displayed captures; analysis still uses the entire eligible collection."],["Focus; Copy; Add to comparison; Update capture; Remove; Clear; Undo","Focus reads a frozen capture. Copy provides text. Add retains current values; Update deliberately replaces a matching record. Remove/Clear change the collection; Undo restores its last change."],["Export collection; Import collection; Retry save; Discard stored record","JSON export/import retains frozen captures. Retry save retries browser storage; Discard stored record removes the rejected stored copy while preserving working cells. Clipboard failure offers selectable text and Close returns to the collection."]]},
      terms: ["Compare"],
      purpose: "Keep cell records together for direct comparison.",
      read: "A capture retains its measurement, bounds, coverage, source and original scale. The Compare workspace lets you read captures together; their context and completeness remain part of the comparison.",
      use: "Capture through a cell's context menu, Inspect details or Cells. Use Compare for Cards/Matrix, metrics and references. Export collection keeps its frozen records; Import restores them. Undo restores the last collection change.",
      targets: [{"label":"Show Compare panel","selector":"#ol-tab-compare"}], colour: "compare" },
    { id: "views", group: "Evaluate & retain", title: "History, saved views & sharing",
      terms: ["Views", "Save view", "View name", "Copy link", "Delete saved view", "Back", "Forward", "History", "Reset", "Name for this view", "Save", "This tab's history", "Views and history"],
      purpose: "Return to a configuration or share how the chart was interpreted.",
      read: "History records this tab's navigation; saved views retain chosen settings. Links and portable view codes include active colour scales and frozen axes. A settings-only URL does not preserve exact calibration; a scale descriptor does not freeze the underlying market data.",
      use: "Open Views for names and links; open Query to copy a portable view code. Back/Forward use tab history. Keep a code when a URL cannot carry exact scales. Reset confirms before clearing drawings or captures; their undo routes are separate.",
      targets: [{"label":"Show Views","selector":"#ol-hist"},{"label":"Show reset control","selector":"#ol-reset-canvas"}], colour: "none" },
    { id: "matching", group: "Evaluate & retain", title: "Matching states & eligibility",
      terms: ["Historical state", "Matching states", "All seasonally eligible states", "Seasonal activity", "Fit anchor"],
      purpose: "Identify the population behind a continuation estimate.",
      read: "The state combines contiguous prior-POC direction, taker-buy share tertile and seasonal volume tertile. Thresholds fit before the anchor. Seasonal activity compares all-price volume with six prior weekly offsets and needs four exactly covered matches. All seasonally eligible states is the baseline; matching states is the conditioned subset. Forward windows can overlap, so case count is not independent sample size.",
      use: "Anchor a completed column. Read its raw state, fit anchor and eligible/matching counts before examining rates.",
      targets: [{"label":"Show Continuations","selector":"#ol-evidence-tab"},{"label":"Show Cases","selector":"#ol-tab-cases"}], colour: "evidence" },
    { id: "outcomes", group: "Evaluate & retain", title: "POC outcomes & barriers",
      terms: ["Next POC", "POC barriers", "Horizon", "Upper barrier", "Lower barrier", "Excursions"],
      purpose: "Know when an outcome becomes observable.",
      read: "Next POC compares POC after 1, 2, 4 or 8 columns; unchanged means the same row. Barrier outcomes use the first qualifying column-end POC crossing, not a native-trade touch. Upper/lower settings are in row units; excursions are minimum and maximum relative POC movement. Each interval's ATR context comes from its prior completed UTC day.",
      use: "Choose outcome and horizon in Continuations. Inspect Cases for starting/final POC, first crossing and support; an unfinished future is withheld.",
      targets: [{"label":"Show Continuations","selector":"#ol-evidence-tab"},{"label":"Show Cases","selector":"#ol-tab-cases"}], colour: "evidence" },
    { id: "intervals", group: "Evaluate & retain", title: "Distributions & estimation intervals",
      terms: ["Up", "Flat", "Down", "Matching", "Baseline", "Difference", "50%", "80%", "95%", "About evidence"],
      purpose: "Distinguish observed outcomes from uncertainty in a rate.",
      read: "The central 50%/80% boxes describe historical POC outcomes. Pointwise 95% intervals describe rate estimates from 2,000 block-bootstrap resamples. A rate needs 30 eligible cases; intervals also need 20 matched full blocks and 1,800 valid resamples. Missing support or degenerate draws can withhold an interval while valid descriptive results remain.",
      use: "Read the method and the displayed withholding reason. Neither the boxes nor rate intervals are calibrated forecast odds or an after-cost trading edge.",
      targets: [{"label":"Show Continuations","selector":"#ol-evidence-tab"},{"label":"Show continuation marks","region":"cells"}], colour: "evidence" },
    { id: "case-records", group: "Evaluate & retain", title: "Cases & exclusions",
      terms: ["Cases", "Population", "Filter", "Excluded", "Eligibility ledger", "First crossing", "Non-modal", "Previous", "Next", "Export CSV", "Buy share", "Change · USDT", "Date · UTC", "Every candidate: eligibility and outcome ledger", "Excursion · USDT", "Outcome", "POC"],
      purpose: "Trace membership rather than reading only a rate.",
      read: "Cases distinguishes matching states from all seasonally eligible states, completed directions and non-modal outcomes. The eligibility ledger retains excluded or unfinished candidates and their reasons. Raw buy share, seasonal ratio, state buckets and fit time explain matching; POC excursions use column ends. Pagination counts the filtered population.",
      use: "Choose a population/filter, sort, then open a case to replay its state. Export the full filtered table; missing outcomes are not failures of a trading strategy.",
      targets: [{"label":"Show Cases","selector":"#ol-tab-cases"},{"label":"Show Continuations","selector":"#ol-evidence-tab"}], colour: "evidence" },
    { id: "rally-rules", group: "Evaluate & retain", title: "Rally boundaries & membership",
      terms: ["Mode", "Scale", "Basis points", "ATR", "Target", "Max pullback", "Confirming reversal", "Anchor every · minutes", "Analysis start · UTC", "Analysis end · UTC", "Time to target · minutes, exclusive", "Refresh discovery", "Stop waiting", "Clear rally", "Discover", "Next", "Previous", "Use visible time · max 24h"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Target; Max pullback; Confirming reversal; Scale","Target is the minimum upward move. Controlled advance caps pullback; Swing uses confirming reversal. Scale chooses bps of the frozen reference price or frozen native ATR14-SMA multiples."],["Anchor every · minutes; Analysis start / end · UTC","Cadence spaces epoch-aligned starting anchors in the anchored modes. The analysis interval is half-open UTC; the form states valid ranges and the 48h budget."],["Time to target · minutes, exclusive; Start; Confirmed; Return; Duration","The local filter retains duration strictly below its ceiling; Swing duration ends at reversal. Start and Confirmed are native event times; Return is the move from reference in bps; Duration is elapsed time."],["USDT volume; Trades; member profile; Previous; Next; Clear rally","Rows select native event members and their totals and volume profile. Pagination changes visible results. Clear rally removes selection/outlines while keeping discovery. Empty, unfinished and unknown-context results do not mean measured zero."],["Retained definition; Analysis · UTC; Reference; End · UTC","These are the definition, analysis window and frozen reference price used by the retained discovery. End marks the last member boundary; confirmation can occur later and is tested separately in Replay."],["Max drawdown; Normalized delta; Member POC centre; Native IDs","Max drawdown is the event’s reported USDT drawdown. Normalized delta = (2 × taker-buy USDT − volume) / volume. Member POC uses 125-USDT bins. Native IDs identify membership boundaries; surrounding trades are excluded from totals. Details / Collapse reveals or folds the member record. Event path, dwell and indicators are unavailable."]]},
      purpose: "Keep event discovery, filtering and members separate.",
      read: "First passage starts at epoch-aligned cadence anchors and ends at the first target trade. A bps threshold is frozen reference price × bps/10,000; ATR thresholds multiply frozen ATR. Controlled advance also caps pullback. Swing establishes its trough by an initial reversal, qualifies the rise, then confirms on reversal from the high; the confirming trade is outside membership. Anchored modes require completion strictly before 240 minutes. The 48h budget includes 3h45 ATR warm-up; Use visible time chooses at most 24h. ATR14-SMA is frozen at anchor/trough, distinct from chart Wilder ATR.",
      use: "Unfinished lacks confirmation at the ceiling; left-censored starts before supported analysis; unknown context lacks its threshold inputs. Events can overlap: each retains its identity, member totals count only its native members, and outlined cells can also contain unrelated trades. Replay requires confirmation strictly before its edge. Source revisions invalidate discovery; Refresh scans again. Stop waiting aborts the client wait, not service computation.",
      targets: [{"label":"Show Rallies","selector":"#ol-tab-rallies"},{"label":"Show rally outlines","region":"cells"}], colour: "rallies" },
    { id: "replay-objects", group: "Evaluate & retain", title: "Replay & retained objects",
      purpose: "Read each object's time eligibility honestly.",
      read: "Replay filters measurements and references by support and known-at, using current history rather than guaranteed original vintages. Captured metrics also need support-end and known-through before the edge; their values stay frozen. Rallies are filtered by confirmation. Drawings remain authored annotations. A held comparison mapping can be an explicit later-fit override.",
      use: "Enter an exact UTC edge or select a column, then check the effective edge: Cells aligns to grid columns, Candles preserves exact time. Exit Replay restores its saved workspace; collection export is independent.",
      targets: [{"label":"Show Replay","selector":"#ol-replay"},{"label":"Show Query","selector":"#ol-tab-query"},{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "states" },
    { id: "comparison-math", group: "Evaluate & retain", title: "Comparison basis & references",
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Metric; Compare; Against; Sort; Ascending; Descending; POC","Metric chooses the primary quantity. Compare chooses Auto/Amount/Intensity. Against chooses set median or a pinned capture. Sort/direction order the display. POC chooses a loaded period landmark for the distance from each captured price band."],["Volume; Trades; Mean trade size; Buyer-initiated share; Buyer-initiated count share; Delta; Path / price span; Dwell share; POC distance","Activity uses totals or supported intensity, means and shares keep their denominators, Path uses row spans, Dwell uses covered-time share, POC distance is the nonnegative gap in USDT between the nominal captured price band and the selected POC; zero means Contains or Touches. Above / Below reports the band’s relation separately. Signed POC distance divided by captured prior daily ATR is a separate context reading."],["Difference; percent; Rank; Only comparable cell; comparable count","Absolute difference is value minus reference; relative percent is shown for Volume, Trades and Mean trade size only, dividing by a positive reference. Rank uses the eligible set for that metric. A single comparable cell has no meaningful comparative rank; withheld values keep their reasons."]]},
      terms: ["Selected comparison metric", "Comparison reference", "Sort captured cells", "Sort ascending; switch to descending", "Sort descending; switch to ascending", "Loaded period POC"],
      purpose: "Compare collected cells using eligible observations.",
      read: "Auto uses Amount for equal observed time × price exposure and Intensity when exposures differ. Means/shares keep their own units. The reference is the eligible set median or a pinned cell. Magnitude ranks use collected comparable cells, ties sharing rank; POC distance ranks nearest first and requires an eligible POC at the edge. Share differences are percentage points; 60% − 50% is +10 pp. Ranks are competition ranks: two tied firsts are followed by third. Zero or missing references can withhold relative differences.",
      use: "Choose metric, basis, reference and POC in Compare. Read units, geometry and eligible counts; colour/length in the dashboard is its comparison scale, not the original chart shade.",
      targets: [{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "compare" },
    { id: "capture-content", group: "Evaluate & retain", title: "Frozen capture content",
      terms: ["Frozen history", "History not captured", "Capture stamp", "Source vintage", "Known through", "Support end", "Update capture"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Original captured reading; Frozen context origin","The original quantity retains its formula and basis. Captured chart frame and Legacy structural record name different context formats, not different market observations."],["Signed POC distance / captured prior daily ATR; POC reference timing","Divide the signed USDT distance by the captured prior completed-day ATR. Reference timing labels whether that POC was known at the applicable edge; unknown or later references keep their limitation. Frozen history points use their own scale and retain slot-specific unavailable reasons."]]},
      purpose: "Know what a capture preserves and what it lacks.",
      read: "A capture freezes source, nominal/observed bounds, measured-through, scale and available compact histories. It does not fetch missing context or update with live data. The selected compact history and companions are retained; other metrics can say History not captured. Legacy structural context and a captured chart frame differ. POC timing and each history slot have their own replay eligibility.",
      use: "Open cell details before capture when you need its histories. Use Update capture deliberately; export/import the collection to keep it beyond this tab.",
      targets: [{"label":"Show Inspect","selector":"#ol-inspect-tool"},{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "compare" },
    { id: "retention", group: "Evaluate & retain", title: "What survives & what travels",
      purpose: "Choose the right retention route for each object.",
      matrix: {headers:["Retains","Link","Code","Named","History","Reload"],rows:[["Bounds / measures / levels / references","Yes","Yes","Yes","Yes","Yes"],["Active colour / axes","Size limit","Yes","Yes","Yes","Yes"],["Drawings","No","Current v3","Yes","No","This tab"],["Captured cells","No","No","No","No","This tab"],["Rally discovery","No","No","No","No","No"],["Market snapshot","No","No","No","No","Current source"]]},
      read: "The address keeps this tab's view; browser preferences keep panel layout and the last view. History is tab navigation; named views are browser-local settings. Links carry settings and, within the size limit, calibration; a settings-only fallback loses exact scales. Current portable codes retain active scales, axes and drawings; links omit drawings. Named views retain settings and drawings; older codes can omit them. Comparison records stay in this tab and use their own JSON export. Drawing recovery is browser-local, bounded and may expire; the tab snapshot restores on reload. Rallies are memory-only discoveries and are lost on reload. Comparison reloads in this tab; duplicated tabs then diverge.",
      use: "Use Views for names/links and Query for codes. Export drawings or comparison collections before clearing. Undo restores the last collection change; a scale descriptor never freezes market data.",
      targets: [{"label":"Show Views","selector":"#ol-hist"},{"label":"Show Query","selector":"#ol-tab-query"},{"label":"Show Compare","selector":"#ol-tab-compare"}], colour: "none" },

    { id: "query", group: "Evaluate & retain", title: "Query, bounds & agent exchange",
      terms: ["Query", "Apply bounds", "Copy query", "Copy view code", "Restore view", "Apply view", "Copy summary", "Copy selection", "Copy comparison", "Share investigation", "Refresh current source", "Restore previous capture", "Six parameters", "View summary", "Effective measurement scope", "Frozen comparison provenance", "Copyable cube query", "End · UTC", "High · USDT", "Low · USDT", "Start · UTC"],
      matrix: {"headers":["Control / read","Interpretation and use"],"rows":[["Source / pack; Source cutoff; Canonical cutoff; Requested bounds; Actual measured bounds; Shown level","Pack identifies source and revision. Source cutoff is the available data edge; Canonical cutoff separates archived and provisional data. Requested bounds are the intended rectangle; Actual measured bounds and Shown level disclose the delivered support and rendering fallback."],["Historical evidence study; Frozen comparison","Historical evidence study names continuation method/uncertainty versions, source digest, fit anchor and reconstruction. Frozen comparison names the captured set, chosen metric/basis and retained source/measured-through boundaries; refreshing market data does not silently update those captures."]]},
      purpose: "Recover the exact requested geometry and exchange a reproducible analysis.",
      read: "Start / End · UTC and Low / High · USDT set the requested rectangle. The six-parameter query gives UTC time bounds, USDT price bounds and time/price levels aligned to base cells; Cell size shows their duration and width. Effective measurement scope and frozen comparison provenance qualify what was actually measured. View summary describes settings, scales, axes, source and retained objects; it does not freeze market history.",
      use: "Apply bounds validates increasing time and price intervals before navigation. Copy query retains six parameters; Copy view code includes settings/calibration. Restore view accepts query JSON, an origo-cube: view code, or a cube-analysis: investigation as JSON, a text packet, a code or a same-host link. Apply view validates required content before replacement and preserves existing drawings through recovery. Copy summary, Copy selection and Copy comparison supply text for a human or agent. Share investigation copies a link containing the analysis or a durable live-host reference when it is too large. Refresh current source requires an opened captured investigation and a live source; it refreshes captured values and keeps Restore previous capture for rollback. Read validation/copy/share status; failed clipboard actions provide selectable text.",
      targets: [{"label":"Show bounds form","selector":"#ol-bounds-form","open":"#ol-tab-query"},{"label":"Show Query","selector":"#ol-tab-query"}],
      colour: "none" },
    { id: "feature-rules", group: "Evaluate & retain", title: "Feature rules & diagnostics",
      purpose: "Read an in-sample rule without confusing its classification metrics with numeric precision.",
      read: "Rule gives a fitted threshold. It flags (TPR) is the fraction of marked bars passing it; of the others (FPR) is the fraction of unmarked bars passing it. Precision is the fraction of flagged bars that were marked; it depends on marked-bar prevalence. Hits / events hit is the fraction of windows the rule reaches. AUC and its 90% interval describe ranking, while adjusted p compares against the shifted-window pool maximum. Withheld intervals, no rule and missing inputs remain explicit; they are not zero evidence.",
      use: "Use Find features, select a leader and inspect its rule and Moves with it diagnostics. Copy rule as Limen manifest starts a Furnace experiment; it needs enough days for Mill’s split. Test independently before treating any fitted rule as transferable. End preview restores Columns. This reference is readable even when Mill is unavailable; its Show action reports that the conditional panel is absent.",
      targets: [{"label":"Show Find features panel","selector":"#ol-tab-features"}],
      colour: "none" },
    { id: "system", group: "Evaluate & retain", title: "Using the System reference",
      terms: ["System reference", "Search reference", "Topic", "Previous", "Next", "Keyboard shortcuts", "Close reference", "Show", "Back to reference", "Close", "Reference topic"],
      purpose: "Find the purpose, interpretation and use of a control or displayed value.",
      read: "Search reference matches UI names, topic text, tables and Show labels. Topic chooses an article; Previous and Next step through search matches. Purpose explains why, Read explains the quantity or behavior, and Use gives the action. Colour and mark keys use the current view. A 500 ms tooltip is a short explanation; the System reference supplies context.",
      use: "Open System reference from the drawer bar, search the visible control name or readout label, and choose its topic. Show reveals an existing control, menu or panel and highlights it; unavailable regions explain what is missing. It does not choose a measure, create a selection or run discovery. Escape clears a highlight; Close reference restores focus. On a phone, Back to reference returns from a revealed target. Keyboard shortcuts opens the key guide.",
      targets: [{"label":"Show reference entry","selector":"#ol-reference-toggle"}],
      colour: "none" },
  ];

  const normalize = value => String(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}∞]+/gu, " ").trim();
  const searchText = new Map(topics.map(topic => [topic.id, normalize([
    topic.title, topic.purpose, topic.read, topic.use, ...(topic.terms || []),
    ...(topic.matrix?.headers || []), ...(topic.matrix?.rows.flat() || []),
    ...topic.targets.map(target => target.label),
  ].join(" "))]));
  function search(query) {
    const term = normalize(query);
    return topics.filter(topic => !term || searchText.get(topic.id).includes(term));
  }

  function create({ root, region, beforeOpen, beforeChange, closeTransient, openKeys, hasTransient, reveal, colourKey }) {
    const el = id => root.querySelector(`#ol-reference-${id}`), pane = root.querySelector("#ol-reference"), main = root.querySelector("#ol-main"), select = el("topic");
    let current = topics[0], active = null, scheduled = 0, lastShape = "", returnFocus = null;
    const node = (tag, text, cls) => {
      const value = document.createElement(tag);
      if (text) value.textContent = text;
      if (cls) value.className = cls;
      return value;
    };
    let group;
    for (const topic of topics) {
      if (!group || group.label !== topic.group) { group = document.createElement("optgroup"); group.label = topic.group; select.append(group); }
      const option = node("option", topic.title); option.value = topic.id; option.dataset.help = topic.purpose; group.append(option);
    }
    const ns = "http://www.w3.org/2000/svg", overlay = document.createElementNS(ns, "svg"), shade = document.createElementNS(ns, "path"), frame = document.createElementNS(ns, "rect");
    overlay.id = "ol-reference-spotlight";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";
    shade.setAttribute("fill-rule", "evenodd");
    shade.setAttribute("class", "ol-reference-shade");
    frame.setAttribute("class", "ol-reference-frame"); frame.setAttribute("rx", "5");
    overlay.append(shade, frame); root.append(overlay);
    shade.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); clearSpotlight(); });
    const back = el("back"); root.append(back);
    const matches = () => search(el("search").value);

    function bounds(target) {
      if (target.region) return region(target.region);
      const element = root.querySelector(target.selector);
      if (!element || element.closest("[hidden], [inert]") || !element.getClientRects().length) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, inReference: Boolean(element.closest("#ol-reference")), overReference: element.closest("#ol-controls") && root.dataset.sheet === "open" } : null;
    }
    function refresh(currentFrame = false) {
      if (pane.hidden) return;
      if (innerWidth > 760) delete main.dataset.referenceReveal;
      const list = matches(), at = list.indexOf(current);
      el("prev").disabled = at <= 0;
      el("next").disabled = at < 0 || at >= list.length - 1;
      colourKey?.(el("colours"), current);
      back.hidden = innerWidth > 760 || (!active && !main.dataset.referenceReveal && main.scrollLeft < 40);
      if (active) {
        if (currentFrame) { if (scheduled) cancelAnimationFrame(scheduled); paint(); }
        else schedule();
      }
    }
    function clearSpotlight(restore = true) {
      const returning = restore && Boolean(main.dataset.referenceReveal);
      if (restore) delete main.dataset.referenceReveal;
      active = null; lastShape = ""; overlay.style.display = "none";
      for (const button of pane.querySelectorAll("[data-reference-target]")) button.setAttribute("aria-pressed", "false");
      el("status").textContent = "";
      if (returning && !pane.hidden) select.focus({preventScroll:true});
    }
    function hole(rect) { return `M${rect.left},${rect.top}h${rect.width}v${rect.height}h${-rect.width}Z`; }
    function paint() {
      scheduled = 0;
      if (!active || pane.hidden) return;
      const raw = bounds(active), doc = main.dataset.referenceReveal ? {left:-1,top:-1,right:-1,bottom:-1,width:0,height:0} : pane.getBoundingClientRect();
      if (!raw) {
        overlay.style.display = "none";
        const reasons = { rows: "Background is off. Use Background to enable the strip.", selection: "No selection. Choose Select and drag a rectangle.", events: "No event lanes. Enable an event family in Lines.", columns: "The column pane is unavailable in this view.", profiles: "Profile tracks are folded. Use Profiles to reveal them." };
        el("status").textContent = reasons[active.region] || "This part is not visible. Open its panel or control, then Show again."; return;
      }
      let left = Math.max(0, raw.left - 4), top = Math.max(0, raw.top - 4), right = Math.min(innerWidth, raw.right + 4), bottom = Math.min(innerHeight, raw.bottom + 4);
      // Clip the target to the visible workspace and leave the docked reference unobscured.
      if (!raw.overReference && !raw.inReference && left < doc.right && right > doc.left && top < doc.bottom && bottom > doc.top) {
        if (doc.width >= innerWidth - 16) bottom = Math.min(bottom, doc.top);
        else left = Math.max(left, doc.right);
      }
      if (right <= left || bottom <= top) { overlay.style.display = "none"; el("status").textContent = "This part is outside the visible area. Scroll it into view to highlight it."; return; }
      const rect = { left, top, width: right - left, height: bottom - top }, path = `M0,0H${innerWidth}V${innerHeight}H0Z${hole(doc)}${raw.inReference ? "" : hole(rect)}`;
      if (path !== lastShape) {
        lastShape = path; overlay.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`); shade.setAttribute("d", path);
        for (const [key, value] of Object.entries({ x: left, y: top, width: rect.width, height: rect.height })) frame.setAttribute(key, value);
      }
      overlay.style.display = "block";
      el("status").textContent = `Highlighted: ${active.label.replace(/^Show /, "")}. Press Escape or click the dimmed area to stop.`;
    }
    function schedule() { if (!scheduled) scheduled = requestAnimationFrame(paint); }
    function render(id) {
      beforeChange();
      current = topics.find(topic => topic.id === id) || topics[0];
      select.value = current.id; clearSpotlight();
      const available = matches(), index = available.indexOf(current), article = node("article");
      article.dataset.topic = current.id;
      article.append(node("p", current.group, "ol-reference-group"), node("h3", current.title));
      const list = node("dl");
      for (const [title, key] of [["Purpose", "purpose"], ["Read", "read"], ["Use", "use"]]) {
        const value=node("dd",current[key]);
        if(key==="read" && current.matrix){const wrap=node("div","","ol-reference-matrix"),table=node("table"),head=node("thead"),tr=node("tr"),body=node("tbody");for(const label of current.matrix.headers){const th=node("th",label);th.scope="col";tr.append(th);}head.append(tr);table.append(head);for(const cells of current.matrix.rows){const row=node("tr");cells.forEach((text,i)=>{const cell=node(i?"td":"th",text);if(!i)cell.scope="row";row.append(cell);});body.append(row);}table.append(body);wrap.append(table);value.append(wrap);}
        list.append(node("dt",title),value);
      }
      article.append(list);
      const actions = node("div", "", "ol-reference-targets");
      for (const [i, target] of current.targets.entries()) {
        const button = node("button", target.label, "ol-action cursor-interaction"); button.type = "button"; button.dataset.referenceTarget = i; button.dataset.flowKey = target.selector || target.region; button.setAttribute("aria-pressed", "false");
        button.onclick = event => {
          if (active === target) { clearSpotlight(); return; }
          clearSpotlight(); reveal?.(target); active = target;
          if (innerWidth <= 760 && !root.querySelector(target.selector || "#ol-canvas")?.closest("#ol-reference") && bounds(target)) { main.dataset.referenceReveal = "true"; window.explorerMotion.scrollAxis(main, 0, "x"); }
          event.currentTarget.setAttribute("aria-pressed", "true"); back.hidden = innerWidth > 760;
          const setting = target.selector && pane.querySelector(target.selector);
          if (setting) {
            // Status text changes the body's height; scroll after it has its final space.
            paint(); window.explorerMotion.scrollToActor(setting, "nearest");
          }
          schedule();
        };
        actions.append(button);
      }
      window.explorerMotion.replaceChildren(el("targets"), ...actions.children);
      article.dataset.flowKey = current.id;
      window.explorerMotion.replaceChildren(el("article"), article);
      const settings = current.settings || current.id;
      for (const section of pane.querySelectorAll("[data-reference-settings]")) section.hidden = section.dataset.referenceSettings !== settings;
      el("colours").replaceChildren(); delete el("colours").dataset.key; colourKey?.(el("colours"), current);
      el("position").textContent = `${Math.max(0,index + 1)} / ${available.length}${el("search").value ? " matches" : ""}`;
      el("prev").disabled = index === 0; el("next").disabled = index === topics.length - 1;
      window.explorerMotion.scrollAxis(el("body"), 0);
      refresh();
    }
    function open(id, origin = document.activeElement) {
      const finishGrid = window.explorerMotion.captureGrid(main);
      if (pane.hidden) returnFocus = origin;
      beforeOpen(); pane.hidden = false; main.dataset.reference = "open"; el("toggle").setAttribute("aria-expanded", "true"); el("toggle").setAttribute("aria-pressed", "true");
      if (id) { el("search").value = ""; for (const option of select.options) option.hidden = false; render(id); } else refresh();
      select.focus({ preventScroll: true });
      finishGrid();
    }
    function close() {
      const finishGrid = window.explorerMotion.captureGrid(main);
      beforeChange();
      clearSpotlight(); pane.hidden = true; delete main.dataset.reference; el("toggle").setAttribute("aria-expanded", "false"); el("toggle").setAttribute("aria-pressed", "false");
      back.hidden = true; window.explorerMotion.scrollAxis(main, 0, "x");
      const destination = returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest("[hidden]") ? returnFocus : el("toggle");
      destination.focus({ preventScroll: true });
      finishGrid();
    }
    el("toggle").addEventListener("click", () => pane.hidden ? open(null, el("toggle")) : close());
    el("close").addEventListener("click", close);
    el("shortcuts").addEventListener("click", () => { clearSpotlight(); openKeys(); });
    select.addEventListener("change", () => render(select.value));
    el("prev").addEventListener("click", () => { const list = matches(); render(list[list.indexOf(current) - 1]?.id); if (el("prev").disabled) select.focus(); });
    el("next").addEventListener("click", () => { const list = matches(); render(list[list.indexOf(current) + 1]?.id); if (el("next").disabled) select.focus(); });
    el("search").addEventListener("input", () => {
      const list = matches(), ids = new Set(list.map(topic => topic.id));
      for (const option of select.options) option.hidden = !ids.has(option.value);
      if (list.length) render(ids.has(current.id) ? current.id : list[0].id);
      else { clearSpotlight(); el("position").textContent = "0 / 0 matches"; el("status").textContent = "No matching topics. Clear the search to see all topics."; refresh(); }
    });
    back.addEventListener("click", () => { clearSpotlight(); beforeChange(); window.explorerMotion.scrollAxis(main, 0, "x"); back.hidden = true; select.focus({ preventScroll: true }); });
    pane.addEventListener("keydown", event => {
      if (event.key === "Escape" && closeTransient()) event.preventDefault();
      event.stopPropagation();
    });
    document.addEventListener("keydown", event => {
      if (pane.hidden || event.key !== "Escape" || hasTransient()) return;
      // A spotlight owns Escape globally; the docked pane only owns keys from its contents.
      if (!active && !pane.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (active) clearSpotlight(); else close();
    }, true);
    root.addEventListener("click", event => {
      if (active && !pane.contains(event.target)) clearSpotlight(false);
    });
    addEventListener("resize", refresh); addEventListener("scroll", refresh, true);
    new ResizeObserver(refresh).observe(root);
    render(current.id);
    return { open, refresh, clearSpotlight };
  }
  if (typeof module === "object" && module.exports) module.exports = Object.freeze({ search });
  else window.explorerReference = Object.freeze({ create });
})();
