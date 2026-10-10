"use strict";
// B45 reference-regression.spec.js (PRD-0002 S3, #48 section 1): the reference language changes how a line is drawn and named, and nothing it measures.
//
// The original build (8c82ca1) and this one open the same address on the same fake cube with every line choice the original has on, and
//   1. retain the original lines and families, with the two explicitly added visible-range choices;
//   2. give each line the same value in its row: every price, period and count the original shows, the new build shows (the only difference allowed is the
//      finality words S2 added to a swing's row, which are removed before the comparison and named when they appear);
//   3. keep the same bar timeframes and anchors (the rows name them), the same POC rows, value areas, opens, highs, lows and closes, averages, bands, VWAPs and
//      clock kinds: those are the rows' numbers.
// Oracles: the original build itself, served from git behind its own fake (a control, not a copy of the code under test).
const { test, expect } = require("./fixtures.js");

// Every key of the original's Lines menu that the standard live profile can draw, as an address.
const LINES = [
  "1d", "wk", "7d", "mo", "30d", "90d", "yr", "1y", "3y",
  "va", "dpoc", "udpoc", "uwpoc",
  "dopen", "pdhlc", "wopen", "mopen",
  "ath", "pch", "swing1d", "swing4h", "fib30", "fib90", "fibswing",
  "ema21", "sma50", "sma100", "sma200", "gdcross", "sma200w", "bmsb", "ema3m", "ema15m", "ema1h", "ema4h", "bb15m", "bb1h", "bb4h", "bb1d",
  "svwap", "avwaph", "avwapl",
  "cday", "cweek", "cmonth", "funding", "usopen", "cme", "deribit",
].join(",");

// The rows of the Lines menu: key, family and value text, from the page's own DOM.
async function rows(page, fake, probe) {
  await probe.waitForReady({ timeout: 120000 });
  await page.locator("#ol-lines").click();
  const out = await page.evaluate(() => {
    const map = {};
    for (const row of document.querySelectorAll("#ol-lines-pop [data-line-value]")) {
      const key = row.dataset.lineValue,
        family = row.closest("[data-family]")?.dataset.family ?? row.closest(".ol-family-body")?.id ?? "";
      map[key] = { family, value: row.textContent.trim() };
    }
    return map;
  });
  return out;
}
// The finality words S2 added to a swing's row are not a value.
const bare = (v) => v.replace(/\s*·\s*(so far|candidate)[^·]*$/i, "").replace(/\s+so far$/i, "");

test.describe("B45 the lines are the same lines with the same values", () => {
  test("the original's Lines menu and this one offer the same keys in the same families, and give each the same value", async ({ page, probe, fakeFor, baselinePage }) => {
    test.setTimeout(240000);
    const old = await baselinePage({ mode: "live", profile: "standard", contextOptions: { reducedMotion: "reduce" }, url: `/#w=7d&lines=${LINES}` });
    const before = await rows(old.page, old.fake, old.probe);
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/#w=7d&vis=2&lines=${LINES}`);
    const after = await rows(page, fake, probe);
    expect(Object.keys(before).length, "the original has its rows").toBeGreaterThan(40);
    const read = Object.values(before).filter((r) => /\d/.test(r.value)).length;
    console.log(`B45: ${Object.keys(before).length} rows, ${read} with a number in the original`);
    expect(read, "most rows carry a number, so the comparison is of numbers and not of blanks").toBeGreaterThan(25);
    // Rows added since: the visible-range POC and VWAP, the last 4-hour swing's retracements and the two rows of retracement levels (#108).
    const added = ["visible", "vvwap", "fibswing4h", "fibclassic", "fibext"];
    expect(Object.keys(after).sort(), "original keys plus the rows added since").toEqual([...Object.keys(before), ...added].sort());
    expect(after.visible).toEqual({ family: "profile", value: "" });
    expect(after.vvwap).toEqual({ family: "vwap", value: "" });
    for (const key of ["fibswing4h", "fibclassic", "fibext"]) expect(after[key]).toEqual({ family: "structure", value: "" });
    const different = [];
    for (const key of Object.keys(before)) {
      if (before[key].family !== after[key].family) different.push(`${key}: family ${before[key].family} became ${after[key].family}`);
      if (bare(before[key].value) !== bare(after[key].value)) different.push(`${key}: "${before[key].value}" became "${after[key].value}"`);
    }
    expect(different, different.join("\n")).toEqual([]);
  });
});
