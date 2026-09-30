"use strict";
// tests/reference/swings.js (PRD-0002 S2, #47 section 6): the ATR zigzag swings of a list of bars, written from the page's DOCUMENTED RULE and not from its code.
//
// The rule (README, "Structure"): an ATR is Wilder's smoothing of the true range over 14 bars, from the list's first (none before the 14th bar). The
// zigzag follows the running extreme since the last swing; once a bar reverses from it by more than 3 x the ATR as of the bar BEFORE, the extreme is a
// swing, timestamped at its bar and confirmed at the bar that reversed. A bar that makes a new extreme does not also confirm a reversal from it. Before
// the first swing the first reversal from either extreme sets the direction, the high's on a tie. The walk starts at the first bar whose previous bar has
// an ATR.
//
// swings(bars) -> [{kind: "high" | "low", i, price, ci}] (i: the extreme's bar, ci: the confirming bar, both indexes into `bars`). A bar is
// {high, low, close}; the last may be a bar still forming (the caller passes it as it stands).
const REACH = 3;

// Wilder's ATR by bar: the true range is high - low for the first bar, else the largest of high - low and the distances of the high and the low from
// the previous close; the first ATR is the plain mean of the first `length` true ranges, then atr = ((length - 1) * atr + tr) / length.
function atr(bars, length = 14) {
  const out = new Array(bars.length).fill(NaN);
  let sum = 0,
    value = NaN;
  bars.forEach((x, i) => {
    const tr = i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - bars[i - 1].close), Math.abs(x.low - bars[i - 1].close));
    if (i < length) {
      sum += tr;
      if (i === length - 1) value = sum / length;
    } else value = ((length - 1) * value + tr) / length;
    out[i] = value;
  });
  return out;
}

function swings(bars) {
  const a = atr(bars),
    out = [];
  let i0 = 1;
  while (i0 < bars.length && !(a[i0 - 1] > 0)) i0++;
  if (i0 >= bars.length) return out;
  let direction = 0, // 1: following a high, -1: following a low, 0: not yet known
    high = bars[i0].high,
    highAt = i0,
    low = bars[i0].low,
    lowAt = i0;
  const confirmHigh = (i) => {
    out.push({ kind: "high", i: highAt, price: high, ci: i });
    direction = -1;
    low = bars[i].low;
    lowAt = i;
  };
  const confirmLow = (i) => {
    out.push({ kind: "low", i: lowAt, price: low, ci: i });
    direction = 1;
    high = bars[i].high;
    highAt = i;
  };
  for (let i = i0 + 1; i < bars.length; i++) {
    const bar = bars[i],
      reach = REACH * a[i - 1];
    if (direction === 1) {
      if (bar.high > high) {
        high = bar.high;
        highAt = i;
      } else if (high - bar.low > reach) confirmHigh(i);
    } else if (direction === -1) {
      if (bar.low < low) {
        low = bar.low;
        lowAt = i;
      } else if (bar.high - low > reach) confirmLow(i);
    } else {
      const newHigh = bar.high > high,
        newLow = bar.low < low;
      if (newHigh) {
        high = bar.high;
        highAt = i;
      }
      if (newLow) {
        low = bar.low;
        lowAt = i;
      }
      if (!newHigh && high - bar.low > reach) confirmHigh(i);
      else if (!newLow && bar.high - low > reach) confirmLow(i);
    }
  }
  return out;
}

module.exports = { atr, swings, REACH };
