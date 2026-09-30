"use strict";
// tests/reference/bars.js (H3): OHLC bars from a trade list, in exact arithmetic.
//
// One bar per level-n column (2^n base columns of 56.25 s) that holds at least one trade, over base columns [b0, b1), in time
// order. Open is the FIRST trade of the column and close the LAST BY TRADE ID (the position in the list), not by timestamp:
// two trades with the same millisecond keep the order they were printed in. High and low are the extreme trade prices,
// volume is USDT (price * qty / 1e10), takerBuyVolume the USDT of taker-buy trades, baseVolume the BTC (qty / 1e8) and
// trades the sum of the trade counts. Sums are exact BigInt rationals rounded once to a double.
const R = require("./rational.js");
const { normalize, NOTIONAL_DEN } = require("./cells.js");

// bars(trades, {n, b0, b1}) -> [{col, open, high, low, close, volume, takerBuyVolume, baseVolume, trades}]
function bars(trades, { n, b0, b1 }) {
  const step = 1n << BigInt(n);
  const acc = new Map();
  for (const x of normalize(trades)) {
    if (x.col < BigInt(b0) || x.col >= BigInt(b1)) continue;
    const col = x.col / step;
    let bar = acc.get(col);
    if (!bar) {
      acc.set(col, (bar = { col, open: x.price, high: x.price, low: x.price, close: x.price, volume: 0n, takerBuyVolume: 0n, baseQty: 0n, trades: 0n }));
    }
    if (x.price > bar.high) bar.high = x.price;
    if (x.price < bar.low) bar.low = x.price;
    bar.close = x.price; // the list is in id order, so the last one seen is the last printed
    bar.volume += x.notional;
    if (x.buy) bar.takerBuyVolume += x.notional;
    bar.baseQty += x.qty;
    bar.trades += x.count;
  }
  return [...acc.values()]
    .sort((a, b) => (a.col < b.col ? -1 : a.col > b.col ? 1 : 0))
    .map((x) => ({
      col: Number(x.col),
      open: R.ratioToDouble(x.open, 100n), high: R.ratioToDouble(x.high, 100n), low: R.ratioToDouble(x.low, 100n), close: R.ratioToDouble(x.close, 100n),
      volume: R.ratioToDouble(x.volume, NOTIONAL_DEN), takerBuyVolume: R.ratioToDouble(x.takerBuyVolume, NOTIONAL_DEN),
      baseVolume: R.ratioToDouble(x.baseQty, 100000000n), trades: Number(x.trades),
    }));
}

module.exports = { bars };
