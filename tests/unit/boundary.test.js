"use strict";
// U46: the page keeps no second copy of what the measurement module owns (PRD-0002 S1: one record for the encoder, the tooltip, the
// table and the legend; no hidden activity multiplier; the financial formulas exist once). Oracle: a scan of the shipped source for the
// identifiers the integration retired; none of them may be declared or called, and the page must not reach the module by destructuring
// or decide a colour per cell with a colour-space conversion.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "..", "src", "explorer.js"), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

describe("src/explorer.js after the measurement work", () => {
  const retired = [
    "amount", "amountScale", "rank", "buildRamp", "legendText", "legendRamp", "tradedLevel", "divergingColour", "cellColour", "bandTone",
    "underlayPeak", "relativeVolume", "underlayLegend", "motionAmount", "motionScale", "motionLegend", "levelMetrics", "cellExposure", "signedCompact",
    "smaOf", "emaOf", "rsiOf", "bollingerOf", "macdOf", "crossesOf", "squeezeBelow", "squeezeLowest", "divergencesOf",
  ];
  for (const name of retired)
    it(`declares no ${name}()`, () => assert.ok(!new RegExp(`^  (async )?function ${name}\\(`, "m").test(code), name));

  for (const name of ["RAMP", "rampColours", "ramp", "AMOUNT_UNITS", "LEGEND_TITLES", "motionUnit", "relMemo", "SQUEEZE_BARS", "SQUEEZE_RANK", "SQUEEZE_DAYS"])
    it(`declares no ${name}`, () => assert.ok(!new RegExp(`^  (const|let) ${name}\\b`, "m").test(code), name));

  it("has no hook registry and no leftover legacy marker", () => {
    assert.ok(!/scaleHooks/.test(code));
    assert.ok(!/LEGACY\(S1\)/.test(source));
  });
  it("does not destructure the module", () => assert.ok(!/(const|let) \{[^}]*\} = E\b/.test(code)));
  it("decides no colour per cell with a colour-space conversion, and computes no taker delta of a cell itself", () => {
    assert.ok(!/d3\.interpolate(Rgb|Lab|Hcl)/.test(code));
    assert.ok(!/2 \* z\.bv - z\.v/.test(code));
  });
});
