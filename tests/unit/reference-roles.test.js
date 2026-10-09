"use strict";
// U58 (PRD-0002 S3 section 1, T-lut): the reference language, E.role.REFERENCE.
// Oracles (none is the code under test): the PRD's role table written out by hand below (seven roles, their hue names and what identifies
// a mark besides its hue), the three patterns the PRD gives in brackets ([5,4] held, [1,3] lead-in, [8,3,2,3] the user's own Level), the
// stroke numbers of #47 (1.5 px, one pixel more when focused, one pixel of backing each side, at most 4.5 px in all), the CSS tokens PARSED
// from src/explorer.css, and tests/reference/contrast.js (a WCAG 2.x contrast written from the definition and checked on published anchors
// in U19).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const ref = require("../reference/contrast.js");

const ROOT = path.resolve(__dirname, "../..");
const CSS = fs.readFileSync(path.join(ROOT, "src/explorer.css"), "utf8");
const TOKENS = ref.tokensFromCss(CSS);
const THEMES = ["light", "dark"];

// The PRD's table (section 1 of #48): role, hue, and what else tells a mark of the role apart.
const PRD = [
  { id: "profile", role: "Volume-profile references", hue: "gold", identification: ["POC", "Buy POC", "VAH", "VAL", "period", "endpoint glyph"] },
  { id: "level", role: "Price levels", hue: "violet", identification: ["Session or Structure subgroup", "exact kind", "timeframe"] },
  { id: "average", role: "Averages and Bollinger", hue: "olive", identification: ["indicator period", "bar timeframe", "Upper, Middle or Lower"] },
  { id: "vwap", role: "VWAP", hue: "rust", identification: ["Session or the exact anchor"] },
  { id: "clock", role: "Clock", hue: "neutral", identification: ["calendar-event label", "vertical geometry", "keyed event pattern"] },
  { id: "user", role: "User Level", hue: "ink", identification: ["Level label", "endpoint diamond", "long dash-dot"] },
  { id: "compare", role: "Historical comparison", hue: "neutral", identification: ["Matching states or All eligible", "square or circle median marker", "labelled interval track"] },
];

test("the table has the seven roles of the PRD, each with its hue and its redundant identification", () => {
  const R = E.role.REFERENCE;
  assert.deepEqual(
    R.FAMILIES.map((f) => ({ id: f.id, role: f.role, hue: f.hue, identification: [...f.identification] })),
    PRD,
  );
  assert.ok(Object.isFrozen(R) && Object.isFrozen(R.FAMILIES) && R.FAMILIES.every((f) => Object.isFrozen(f) && Object.isFrozen(f.identification)));
});

test("Session levels and Structure are two menu groups of ONE family, one hue", () => {
  const level = E.role.referenceFamily("level");
  assert.deepEqual([...level.groups], ["Session levels", "Structure"]);
  assert.equal(E.role.REFERENCE.FAMILIES.filter((f) => f.token === level.token).length, 1, "no second family shares the Price levels token");
});

test("the patterns and strokes are the PRD's numbers", () => {
  const { PATTERN, STROKE } = E.role.REFERENCE;
  assert.deepEqual([...PATTERN.support], [], "solid: observed or derived support");
  assert.deepEqual([...PATTERN.held], [5, 4], "dashed [5,4]: the held extension");
  assert.deepEqual([...PATTERN.lead], [1, 3], "dotted [1,3]: the retrospective lead-in to a confirmation");
  assert.deepEqual([...PATTERN.user], [8, 3, 2, 3], "the user's Level: the one long dash-dot");
  assert.equal(new Set(["support", "held", "lead", "user"].map((k) => JSON.stringify(PATTERN[k]))).size, 4, "four distinct patterns");
  assert.equal(STROKE.ordinary, 1.5);
  assert.equal(STROKE.focusExtra, 1);
  assert.equal(STROKE.backing, 1);
  assert.equal(STROKE.max, 4.5);
  assert.ok(STROKE.ordinary + STROKE.focusExtra + 2 * STROKE.backing <= STROKE.max, "a focused stroke with its backing is within the 4.5 px budget");
});

test("every family names a token that exists, and a reference token clears 3:1 against the surface in both themes", () => {
  for (const f of E.role.REFERENCE.FAMILIES) {
    assert.ok(TOKENS[f.token], `${f.id}: ${f.token} is a token of src/explorer.css`);
    for (const theme of THEMES) {
      const c = ref.contrast(TOKENS[f.token][theme], TOKENS["--ol-surface"][theme]);
      assert.ok(c >= 3, `${f.id} (${f.token}) on the surface, ${theme}: ${c.toFixed(2)}:1 is below 3:1`);
    }
  }
});

test("there are no timeframe tiers and no evidence hue left in the stylesheet", () => {
  assert.equal(/--ol-tier-/.test(CSS), false, "the tier tokens are retired");
  assert.equal(/--ol-evidence\b/.test(CSS), false, "the violet that competed with the price levels is retired");
  assert.deepEqual(TOKENS["--ol-line-compare"], TOKENS["--ol-muted"], "Historical comparison is the neutral muted ink, not a hue");
});

test("an unknown family is refused", () => {
  assert.throws(() => E.role.referenceFamily("tier"), RangeError);
  assert.equal(E.role.referenceFamily("clock").hue, "neutral");
});

// ---- the inventory (section 2): shown over eligible, with a reason for every reference that is not shown ----
test("the inventory counts every enabled reference once, with the reason it is not shown", () => {
  assert.deepEqual(
    E.role.REASONS.map((r) => r.id),
    ["shown", "occlusion", "density", "offscreen", "warmup", "missing", "unsupported", "none"],
    "the PRD's reasons: density and occlusion apart, off-screen, warm-up, missing, unsupported and no event",
  );
  const inv = E.role.inventory([
    { id: "7d", reason: "shown" },
    { id: "30d", reason: "occlusion" },
    { id: "90d", reason: "offscreen" },
    { id: "ema21", reason: "warmup" },
    { id: "sma200", reason: "warmup" },
    { id: "swing4h", reason: "none" },
    { id: "dopen", reason: "density" },
    { id: "bb15m", reason: "unsupported" },
    { id: "svwap", reason: "missing" },
    { id: "clock|funding", reason: "shown" },
  ]);
  assert.equal(inv.eligible, 10, "a suppressed reference stays in the count");
  assert.equal(inv.shown, 2);
  assert.deepEqual(inv.reasons, { shown: 2, occlusion: 1, density: 1, offscreen: 1, warmup: 2, missing: 1, unsupported: 1, none: 1 });
  assert.deepEqual(inv.byReason.warmup, ["ema21", "sma200"]);
  assert.equal(Object.values(inv.reasons).reduce((a, b) => a + b, 0), inv.eligible, "every entry has exactly one reason");
});

test("the inventory refuses a word that is not a reason and a reference counted twice", () => {
  assert.throws(() => E.role.inventory([{ id: "a", reason: "hidden" }]), RangeError);
  assert.throws(() => E.role.inventory([{ id: "a", reason: "shown" }, { id: "a", reason: "none" }]), RangeError);
  assert.deepEqual(E.role.inventory([]), { eligible: 0, shown: 0, reasons: { shown: 0, occlusion: 0, density: 0, offscreen: 0, warmup: 0, missing: 0, unsupported: 0, none: 0 }, byReason: { shown: [], occlusion: [], density: [], offscreen: [], warmup: [], missing: [], unsupported: [], none: [] } });
});
