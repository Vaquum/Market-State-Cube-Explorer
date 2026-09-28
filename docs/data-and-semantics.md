# Data and semantics

## Cube coordinates

Time starts at 2021-01-01 00:00:00 UTC. The base cell is 56.25 seconds × 125 USDT. Time and price exponents are independent nonnegative integers. Time edges are anchored to the history start; price edges are multiples of the price resolution. Intervals include the lower edge and exclude the upper edge.

The copyable query has six parameters: `t1`, `t2`, `p1`, `p2`, `tR`, `pR`. Requested bounds snap to base-cell edges with exact midpoints rounding upward, and the end of a rectangle that reaches the latest data is the edge that closes the open base column. Selecting a rectangle preserves those bounds as resolution changes. On the live cube the numbers are the cube's answer for exactly these bounds, edge cells included: summed from loaded cells when they tile the rectangle, and otherwise read from the cube. The time level can be coarser than `tR` when the rectangle spans more than 4,096 columns; totals and POCs don't depend on it. In the recorded snapshot, where no block tiles a rectangle, the numbers cover the snapshot's whole cells inside it, and the UI names that part; it does not invent finer cells.

## Measures

Each occupied cell carries USDT volume, trade count, taker-buy USDT volume and taker-buy count. Taker buys mean `is_buyer_maker = 0`. A POC is the center of the price row with the greatest summed volume; ties choose the lower row. The buy POC uses taker-buy volume. Rows without qualifying volume have no POC.

Signed taker volume is `2 × buy_volume − volume`. The encodings read every measure: volume, trades and trade size (volume per trade) shade by rank on one ramp, so each step of the ramp holds as many of the drawn cells as any other and the colour separates cells wherever they crowd; taker flow and taker trades diverge from an even taker-buy share of the USDT or of the trades; delta shades signed taker volume. Volume and trades shade at each cell's full-cell rate: its amount divided by the seconds and price width it covers, times a whole cell's, so an edge portion or the open column compares with whole cells. Values shown are always the cell's own. The contiguous 70% value area expands from the POC into adjacent rows, choosing the larger adjacent volume and the lower row on ties.

A POC line is the POC of one period at the cube's finest rows, 125 USDT: the rolling periods end at the edge that closes the data (1 day, 7, 30 and 90 days, 1 and 3 years of 365 days), the calendar ones start on this UTC week's Monday, month or year, and a chosen day starts its period at that UTC day's start. In replay each ends at the replay's edge instead. Live, a line is summed from loaded base cells where they cover its period and read from the cube otherwise; a period with a fixed start (a chosen day, this week, month or year) that begins before those cells is read from the cube up to their first UTC midnight, once a day, and summed from them after it, which gives the same POC; in the recorded snapshot a period its base cells don't cover uses the finest rows that do, and is marked approximate.

Counts in this snapshot are exact within JavaScript's safe integer range. The full-history trade count is 6,173,120,060. Volumes use Float64 arithmetic and retain normal floating-point summation differences.

## Snapshot provenance and format

`data/snapshot.json` contains real recorded Binance BTCUSDT spot measures exported by the earlier Dyad prototype, not simulated trades. Its metadata records each block's coverage, exponents, source tile names and totals. All blocks share the snapshot's cutoff.

Each `gzip_base64` block decodes to MSC1:

- 32-byte header: magic `MSC1`, time exponent at byte 4, price exponent at byte 5, start/end column indices at bytes 8/12, record count at byte 16; integers are little-endian.
- Columnar arrays: Float64 volume, Float64 buy volume, UInt32 time column, UInt32 price row, UInt32 count, UInt32 buy count.

The seven-day block contains base cells. The 30-day archive and full-history overview contain coarser source cells. The application aggregates representable larger grids locally. Browser `DecompressionStream` support is required.

## Historical evidence

For each displayed grid, the engine uses the loaded tiers that can represent it and, live, the cube's history of that level (each column's POC and volumes, up to the last 100,000 columns), over all price rows: the visible price window never conditions the historical population, so the same anchor gives the same base rates whichever band is on screen. The finest source owns overlapping columns. Tiles read for the view are never part of it, so where the view has been doesn't change the result. A state combines POC direction, buy-share third and volume third. Thresholds use columns before the anchor; candidate outcomes end no later than the anchor. Missing contiguous POCs interrupt a case.

Unconditional and conditional distributions use the same qualifying history. Cases, price bounds, source provenance and sample sizes are visible. Matching samples below 30 retain counts but suppress percentages and the matching boxes on the chart. These descriptive distributions are not probability calibration, independent trials, or validation of a trading strategy.

POC barriers are first crossings by column-end POCs over the selected horizon. Intracell trade ordering and true trade-price barrier first-touch cannot be recovered from this aggregated snapshot.

## The diagonal through the resolution lattice

Measured over the full history from 2021-01-01 (n = 6..13 on the 2026-09-24 extraction), the median price range of a column grows with its duration as `log2(range / 125) = -1.06 + 0.486 n`, an exponent of 0.49, close to a square-root law. The diagonal is the lattice path `m = round(-1.06 + 0.486 n)`, along which one column is about one row tall. Diagonal zoom scales the time window by a factor and the price window by its square root, and the auto level keeps the price exponent on that path. The plane marks the path so a deliberate step off it is visible.

The lattice the explorer can reach is `n = 0..20` (56.25 seconds to about 683 days per column) and `m = 0..9` (125 to 64,000 USDT per row); the plane shows all of it, and every stepper and clamp shares the same limits. In diagonal mode a time-only step (the bracket keys, the time steppers) keeps `m` on the path; an explicit level (a plane click, a price step, a pinned lens, an imported query) that changes the level to one off the path releases diagonal mode, and a step that clamps back to the current level changes nothing.

## Portable views

The page's address holds the view: `w` for a window (`15m`, `30m`, `1h`, `4h`, `12h`, `24h`, `7d`, `30d`, `1y`, `ytd`, `lastyear`, `all`), or `t` and `p` for a rectangle as UTC times and USDT prices; `r` for the level when it is locked; then each setting that differs from its default (`f`, `mode`, `marks`, `lines`, `sel`, `at`, `replay`, `tab`, `outcome`, `h`, `dist`). `mode` is one of `volume`, `flow`, `delta`, `trades`, `flowtrades`, `size` and `geometry`; `lines` lists the POC lines, `1d`, `wk`, `7d`, `mo`, `30d`, `90d`, `yr`, `1y`, `3y` and days as `YYYY-MM-DD`. A window is relative to the cutoff; a rectangle is absolute. Unreadable parts fall back to their defaults, and a replay or selection outside the page's history is dropped.

The JSON query can be copied and reapplied, and an `origo-cube:` code also preserves selected visual settings and replay context; both are still accepted. Named views and the workspace are saved only in the local browser, and each tab's history only in that tab; no telemetry or external storage is used.

## Live cube blocks

Served by `tools/cube_bridge.py` on the Origo host, every block is a cube query at one level: `time_index` and `price_index` are the block's column and row, `volume`, `trade_count`, `taker_buy_volume` and `taker_buy_trade_count` its four measures, travelling as MSC2 (counts as 64-bit floats, exact below 2⁵³). The pack's tiers are read up to the cube's `data_cutoff` (the end of contiguous coverage, a minute edge), fixed once per pack, so the base column that holds it is open: it has the latest trades and gains more. The pack carries the cube's `data_cutoff` and `canonical_through` as well; cells after `canonical_through` come from provisional minutes that the day's archive later replaces, and the chart marks where they begin.

A rectangle's numbers are the cube's own: `/cube/query` reads the rectangle from the cube up to the last complete base column before the pack's cutoff and adds the open column from the pack's own base cells, then sums totals and POCs as the cube does (exact sums; the lower row wins a tie; a truncated winning row keeps its full row's centre). The same route serves tiles, the lens's finer cells and POC lines; `/cube/columns` serves the continuations' history. Each read is refused unless every partition it read is one the page's pack read, at the same revision and build id (a new generation of the same build, from a component attached to it, changes no cell); the page then takes the cube's new pack in place and asks again, rather than mixing two cube states. An open page asks for new packs on its own: it receives the columns each tier gained when every partition its pack read is unchanged and every column it keeps holds the same cells, and otherwise the whole pack. A read that fails leaves its numbers unmeasured, or its level unavailable, rather than silently coarser.
