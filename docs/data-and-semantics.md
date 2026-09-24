# Data and semantics

## Cube coordinates

Time starts at 2021-01-01 00:00:00 UTC. The base cell is 56.25 seconds × 125 USDT. Time and price exponents are independent nonnegative integers. Time edges are anchored to the history start; price edges are multiples of the price resolution. Intervals include the lower edge and exclude the upper edge.

The copyable query has six parameters: `t1`, `t2`, `p1`, `p2`, `tR`, `pR`. Requested bounds snap to base-cell edges with exact midpoints rounding upward. Selecting a rectangle preserves those requested bounds as resolution changes. If available source blocks cannot represent them, the UI identifies the coarser resolution and the portion that can be computed exactly; it does not invent finer cells.

## Measures

Each occupied cell carries USDT volume, trade count, taker-buy USDT volume and taker-buy count. Taker buys mean `is_buyer_maker = 0`. A POC is the center of the price row with the greatest summed volume; ties choose the lower row. The buy POC uses taker-buy volume. Rows without qualifying volume have no POC.

Signed taker volume is `2 × buy_volume − volume`. Density is volume divided by observed seconds and selected price width, including partial-cell exposure. The contiguous 70% value area expands from the POC into adjacent rows, choosing the larger adjacent volume and the lower row on ties.

Counts in this snapshot are exact within JavaScript's safe integer range. The full-history trade count is 6,173,120,060. Volumes use Float64 arithmetic and retain normal floating-point summation differences.

## Snapshot provenance and format

`data/snapshot.json` contains real recorded Binance BTCUSDT spot measures exported by the earlier Dyad prototype, not simulated trades. Its metadata records each block's coverage, exponents, source tile names and totals. All blocks share the snapshot's cutoff.

Each `gzip_base64` block decodes to MSC1:

- 32-byte header: magic `MSC1`, time exponent at byte 4, price exponent at byte 5, start/end column indices at bytes 8/12, record count at byte 16; integers are little-endian.
- Columnar arrays: Float64 volume, Float64 buy volume, UInt32 time column, UInt32 price row, UInt32 count, UInt32 buy count.

The seven-day block contains base cells. The 30-day archive and full-history overview contain coarser source cells. The application aggregates representable larger grids locally. Browser `DecompressionStream` support is required.

## Historical evidence

For each displayed grid and price window, the engine uses every loaded source that can represent it. The finest complete source owns overlapping columns. A state combines POC direction, buy-share third and volume third. Thresholds use columns before the anchor; candidate outcomes end no later than the anchor. Missing contiguous POCs interrupt a case.

Unconditional and conditional distributions use the same qualifying history. Cases, price bounds, source provenance and sample sizes are visible. Matching samples below 30 retain counts but suppress percentages and cones. These descriptive distributions are not probability calibration, independent trials, or validation of a trading strategy.

POC barriers are first crossings by column-end POCs over the selected horizon. Intracell trade ordering and true trade-price barrier first-touch cannot be recovered from this aggregated snapshot.

## Portable views

The JSON query can be copied and reapplied. An `origo-cube:` code also preserves selected visual settings and replay context. It is a portable import code, not a hosted URL or browser permalink. State is saved only in the local browser; no telemetry or external storage is used.
