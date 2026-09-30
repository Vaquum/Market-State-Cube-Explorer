"use strict";
// tests/reference/index.js (H3): the independent reference calculator (TESTPLAN 4.5), one entry point.
//
// Exact-rational / BigInt answers to the questions the fake cube's store answers in floating point, so the two can be
// compared (tests/unit/fake-vs-reference.test.js) and the hand-computed micro-sequences checked (reference.test.js). Nothing
// under tests/reference/ may import src/, tests/support/ or vendor/ (tests/unit/independence.test.js).
//
//   cells(trades, {n, m, b0, b1, r0, r1})               level-(n, m) cell sums of a rectangle
//   motion(trades, {n, m, b0, b1, r0, r1, end, gaps})   cells with path, dwell, high and low
//   bars(trades, {n, b0, b1})                           OHLC bars by level-n column
//   summary(trades, rect) / periodRows(trades, {b0, b1, m}) / exposure(cell, rect, cutMs, n, m)
//   typeSeven(sorted, p) / median7 / knots257 / rankApply
//   snapshot: decodeMsc1 / loadSnapshot / aggregate / cutoffBase (data/snapshot.json, layout MSC1)
//   rational: q, add, sub, mul, div, cmp, floor, fromDouble, toDouble, ratioToDouble, parse
const rational = require("./rational.js");
const { cells, summary, periodRows, exposure, normalize } = require("./cells.js");
const { motion } = require("./motion.js");
const { bars } = require("./bars.js");
const { typeSeven, typeSevenExact, median7, knots257, rankApply } = require("./typeseven.js");
const snapshot = require("./snapshot.js");

module.exports = { cells, summary, periodRows, exposure, motion, bars, typeSeven, typeSevenExact, median7, knots257, rankApply, normalize, rational, snapshot };
