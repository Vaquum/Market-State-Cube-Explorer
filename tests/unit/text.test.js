"use strict";
// E.text (part 04): the string table of INTEGRATION.md D.11 and the two substitution functions
// (API.md A.3, DD-32, DD-91). The guard WORKPLAN.md 3.6 asks for: every key of D.11 exists, every
// {name} placeholder is documented, fill() never throws and fillStrict() does.
//
// Oracle (none is the code under test): D11 below is the "Key | Text" table of INTEGRATION.md D.11,
// extracted from the document by a script that parses its markdown rows (keys and texts as written, the
// " / " lists expanded to one entry per key), never from part 04. Three rows needed a reading, each
// noted at its entry: `basis.spans` is "Path / price span" (a ratio; the row has four " / " segments for
// three keys), and `typed.empty-population`/`typed.undefined` and `migrate.trades`/`migrate.size` are
// rows with one text for two keys, so both keys hold it. DR-31 voids the named-view cap, so D.11's
// `notice.namedViewsLimit` is NOT in the table and the test asserts it does not exist. PLACEHOLDERS is
// the documentation of every {name} (the same list as the comment block of part 04), written by hand;
// substitution expectations are computed with split/join, not with the module's pattern.
// DR-41 adds 26 keys that INTEGRATION.md D.11 does not list (and amends it in spirit): `key.zeroTick`,
// `key.open` and the 24 `role.*` strings (a label and an accessible name for each of the 12 role ids). They
// are in D11 below with the English of part 04 (the lead's ruling names the keys, not the words), and
// ROLE_IDS is the independent list of the twelve role ids of API.md B.9 that the role keys must cover.
// DR-41 also makes fill STATELESS: the last fill tests assert that it never reports through `console` and
// that a missing name is simply visible.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects and errors are of another realm,
// so errors are matched by name and structures compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const E = require("../support/enc");
const { assemble } = require("../support/assemble-encoding.js");

const D11 = {
  "policy.explore": "Explore",
  "policy.comparison": "Comparison lock",
  "policy.auto": "Auto color",
  "policy.local": "Local contrast",
  "policy.fixed": "Fixed scale",
  "policy.manual": "Manual domain",
  "policy.axisAuto": "Auto axis",
  "policy.axisFrozen": "Frozen",
  "axis.none": "No data",
  "axis.zero": "0",
  "axis.updating": "Updating",
  "axis.paused": "Auto paused",
  "axis.waiting": "Waiting for data",
  "axis.frozenBy": "Frozen by Comparison lock",
  "axis.clipped": "{n} of {total} bars extend beyond the held domain",
  "state.noCalibration": "No calibration",
  "state.updating": "Updating",
  "state.pending": "Reading",
  "state.external": "External comparison override",
  "state.externalAfterEdge": "External comparison override: uses observations after the replay edge",
  "state.autoPausedLock": "Auto paused: comparison lock",
  "state.autoPaused": "Auto paused",
  "state.restored": "Restored, not refitted",
  "state.notHeld": "Not held by Comparison lock",
  "state.localPending": "Local contrast pending",
  "state.zeroOnly": "Zero-only calibration: later nonzero values are out of domain until fitted",
  "state.manualRoute": "Set a manual domain or choose Fit",
  "note.scaleChanged": "Scale changed: {causes}",
  "note.cause.resolution": "resolution",
  "note.cause.period": "period",
  "note.cause.measure": "measure",
  "note.cause.basis": "basis",
  "note.cause.transform": "transform",
  "note.cause.quality": "quality",
  "note.cause.lock": "lock",
  "note.cause.pin": "pin",
  "note.cause.policy": "policy",
  "note.cause.fit": "fit",
  "note.cause.workspace": "workspace",
  "note.evicted": "Scale re-initialised after eviction (this browser keeps the 64 most recent contexts)",
  "note.calibratedOn": "Calibrated on the {support} ({n} observations, {excluded} excluded)",
  "warn.rangeExceeded": "Scale range exceeded",
  "warn.lowDisc": "Low discrimination",
  "warn.rangeDetail": "{marks} of occupied marks and {area} of occupied screen area are outside the scale",
  "warn.lowDiscLow": "{share} of nonzero marks use the lowest 5% of the scale",
  "warn.lowDiscHigh": "{share} of nonzero marks use the highest 5% of the scale",
  "warn.action.fit": "Fit",
  "warn.action.auto": "Auto color",
  "warn.action.local": "Local contrast",
  "warn.action.openLens": "Open lens",
  "note.windowNotApplied": "Window not applied to this measure",
  "reject.windowSymmetric": "The window must be symmetric about 50% for taker shares",
  "reject.windowRange": "The window must satisfy 0 <= low < high <= 1",
  "reject.curveRank": "Linear is offered only for Value",
  "reject.manual": "A manual domain needs finite positive U and k with k <= U",
  "label.coverage": "Coverage",
  "label.unattributed": "Unattributed",
  "exposure.short": "Short exposure",
  "exposure.detail": "{t} of the time span, {w} of the price span",
  "model.retrospective": "Retrospective model: estimated on later data than this cutoff (external reference)",
  "model.timingUnverified": "Model timing unverified: estimated on 2026-09-24 data",
  "model.eligibleByBound": "Model estimated before this cutoff by the conservative bound 2026-09-25 00:00 UTC (exact time unknown)",
  "model.extrapolated": "Model extrapolated beyond fitted levels",
  "model.exactUnknown": "Exact fit time and method version are unknown",
  "model.applicability": "Range-derived model applied to touched rows; not proven neutral at every level",
  "model.diagonalUse": "The diagonal chooser uses the same fitted model (ISO_A -1.06, n = 6 to 13)",
  "vintage": "Replay on currently available history; original vintages not guaranteed",
  "revision.replaced": "Provisional minutes up to {t} were replaced by the archived day",
  "revision.unknown": "Data was refreshed; revision status unknown",
  "dwell.coverage": "Covered to the end of the data; interior gaps are unobservable",
  "dwell.residual": "Unattributed covered time: {seconds}",
  "dwell.notMeasurable": "Not measurable: rectangle rows only",
  "rank.approx": "Relative rank: 257-knot Type-7 quantile approximation, not an exact empirical midrank",
  "lock.incompatible.family": "different formula family",
  "lock.incompatible.basis": "amount and intensity are different bases",
  "lock.incompatible.signed": "signed and unsigned measures differ",
  "lock.incompatible.transform": "different transform",
  "lock.incompatible.rankAlgo": "different rank algorithm",
  "lock.incompatible.version": "different formula version",
  "key.zero": "Zero (occupied)",
  "key.undefined": "Not defined",
  "key.noRef": "No reference volume",
  "key.negInf": "No current volume (−∞)",
  "key.below": "Below range",
  "key.above": "Above range",
  "key.pending": "Reading",
  "key.failed": "Failed",
  "key.unsupported": "Unsupported",
  "key.invalid": "Invalid input",
  "key.outline": "Occupied",
  "key.noCalibration": "No calibration",
  "key.emptyBoth": "Empty in both",
  "key.outside": "Outside comparison support",
  "key.zeroTick": "Zero",
  "key.open": "Open",
  "role.unsigned": "Magnitude",
  "role.unsignedName": "Magnitude fill, from the lowest to the highest value of the scale",
  "role.positive": "Positive",
  "role.positiveName": "Positive arm, from the midpoint toward the largest positive value",
  "role.negative": "Negative",
  "role.negativeName": "Negative arm, from the midpoint toward the largest negative value",
  "role.midpoint": "Midpoint",
  "role.midpointName": "Midpoint: zero, or an even split between the two sides",
  "role.occupancy": "Occupied",
  "role.occupancyName": "Occupancy outline: the cell has data and no magnitude is shown",
  "role.zeroOutline": "Zero",
  "role.zeroOutlineName": "Zero outline: the cell was measured and is exactly zero",
  "role.unsignedBar": "Bar",
  "role.unsignedBarName": "Constant bar fill for an unsigned column or profile length",
  "role.stateInk": "State",
  "role.stateInkName": "State ink of the patterns and glyphs that mark a value that is not a number",
  "role.rowsProjection": "Rows band",
  "role.rowsProjectionName": "Contextual price-row band at a fixed low opacity",
  "role.familyReference": "Family reference",
  "role.familyReferenceName": "Reserved for family reference marks",
  "role.interaction": "Interaction",
  "role.interactionName": "Reserved for hover and selection marks",
  "role.regionReplacement": "Region replacement",
  "role.regionReplacementName": "Reserved for marks of a replaced region",
  "typed.finite": "{value}",
  "typed.negative-infinite": "No current volume in the rectangle; the period traded here (−∞ on the log scale)",
  "typed.no-reference": "No reference volume: the period did not trade here",
  "typed.empty-both": "Neither traded here",
  "typed.empty-population": "Undefined: {denominator} is 0",
  "typed.undefined": "Undefined: {denominator} is 0",
  "typed.no-coarser-parent": "Undefined: no coarser parent",
  "typed.waiting-for-complete-parent": "Waiting for the complete parent (open)",
  "typed.outside-support": "Outside comparison support",
  "typed.hidden": "Hidden in replay",
  "typed.pending": "Reading: {reason}",
  "typed.failed": "Read failed: {reason}",
  "typed.unsupported": "Not supported here: {reason}",
  "typed.invalid-input": "Invalid input: {reason}",
  "basis.amount": "Amount",
  "basis.intensity": "Intensity",
  "basis.mean": "Mean",
  "basis.spans": "Path / price span",
  "basis.usdt": "USDT moved",
  "basis.perMinute": "Row spans per minute",
  "unit.usdt": "USDT",
  "unit.trades": "trades",
  "unit.usdtPerTrade": "USDT per trade",
  "unit.rowSpans": "row spans",
  "unit.rowSpansPerMinute": "row spans per minute",
  "unit.share": "share",
  "unit.log2": "log2 ratio",
  "unit.seconds": "seconds",
  "unit.intensity": "per minute per 125-USDT price band",
  "transform.value": "Value",
  "transform.valueLog": "Value (log)",
  "transform.valueLinear": "Value (linear)",
  "transform.rank": "Relative rank",
  "transform.fixed": "Fixed scale",
  "address.level.exact": "Address: exact",
  "address.level.ids": "Address: scale IDs only, not exact",
  "address.level.settings": "Settings-only URL, not exact calibration",
  "address.level.refused": "The address is too long to write; copy the full view code",
  "notice.legacy": "Opened a view saved before visual version 2. Its settings were kept; colours and scales now use version 2.",
  "notice.legacyDetail": "{setting}: was {old}; now {new}",
  "notice.legacyUnsaved": "Colours from the old version cannot be recovered.",
  "notice.versionDefault": "This version measures and colours differently (visual version 2). The default view is shown.",
  "notice.addressDegraded": "The address was shortened: {level}. Copy the full view code to keep the exact scales.",
  "notice.storageFailed": "This browser could not save the view. The explorer keeps working; changes will not persist.",
  "notice.historyFailed": "This browser could not update the history entry. The view is unchanged.",
  "notice.importRejected": "The view code was not applied: {reason}",
  "notice.importPartial": "The view code was applied without its scale: {reason}",
  "notice.scaleDropped": "The scale in this link could not be used; a fresh Explore scale is in use",
  "notice.scaleContextDiffers": "The scale in this link was fitted at n={n}, m={m}; this window shows n={n2}, m={m2}, so a fresh scale is in use",
  "notice.appearanceMismatch": "This link was made with appearance {ap}; this page uses {current}. Mapping ids still match.",
  "notice.clipboard": "The clipboard was not available. The text is selected for copying.",
  "notice.limit": "The view has more than {max} active scales. Release one before adding another.",
  "notice.codeNotStored": "The full view code was not stored with this view; copy it separately to keep the exact scales.",
  "notice.scaleFault": "The scale display hit an error and was turned off for this session; the chart shows occupancy only. Reload the page.",
  "notice.moduleMissing": "The explorer's measurement module did not load. Reload the page.",
  "ui.scale": "Scale",
  "ui.basis": "Basis",
  "ui.transform": "Transform",
  "ui.policy": "Scale policy",
  "ui.fit": "Fit scale",
  "ui.lock": "Comparison lock",
  "ui.unlock": "Release comparison lock",
  "ui.local": "Local contrast",
  "ui.manual": "Manual domain",
  "ui.clearManual": "Clear manual domain",
  "ui.details": "Scale details",
  "ui.dismiss": "Dismiss",
  "ui.copyCode": "Copy view code",
  "ui.apply": "Apply",
  "ui.notOffered": "Not offered for {measure}",
  "ui.appearance": "Appearance {id} (provisional, not human-validated)",
  "ui.summaryTitle": "View summary",
  "ui.summaryIntro": "What a screenshot of this view should say about its colours and lengths. It describes the view as drawn now: it is not an export and not a snapshot of the data.",
  "ui.summaryCopy": "Copy summary",
  "ui.summaryView": "View",
  "ui.summaryAxes": "Axes",
  "ui.summaryProfile": "Profile tracks",
  "ui.summaryVintage": "Original vintage",
  "ui.summaryLimit": "The numbers are the cube's as available now and can differ from the data as it stood when first seen: original vintages are not recorded. No hosted export and no immutable data snapshot is offered; the view code reopens this view and reads the cube again.",
  "migrate.volume": "was the full-cell rate ranked over the drawn block; now observed Amount on a Value scale, Explore per resolution context",
  "migrate.trades": "same as Volume; Trade size is Value with a cell of no trades undefined",
  "migrate.size": "same as Volume; Trade size is Value with a cell of no trades undefined",
  "migrate.flow": "was full at 25% and 75%, paler where less traded; now linear 0-100% with 50% at the midpoint and no activity multiplier",
  "migrate.delta": "was log1p of the absolute Delta over the block's 99.5th percentile with zero drawn as the surface; now signed Value on one pooled (U, k) with zero at the midpoint colour",
  "migrate.cascade": "was paler by activity; now the same log2 formula without an activity term",
  "migrate.path": "was path over cell height times full-cell-time extrapolation, ranked; now path over the measured price span in row spans, Value, Explore",
  "migrate.dwell": "was ranked share of column time; now a linear 0-100% share of covered column time",
  "migrate.geometry": "was a green outline at low opacity; now a neutral occupancy outline",
  "migrate.rows": "was the square root of the share of the peak among rows in view; now Value over all measured rows of the period, Explore",
  "migrate.relvol": "Historical rows=relvol now selects rows.relvol@3: row volume versus mean traded row. The original formula of an unversioned token is unknown; no earlier meaning is reconstructed",
  "migrate.pane": "was scaled to the bars in view at every draw; now a registered Auto axis",
  "migrate.efficiency": "was compared with \"0.70 expected\"; now with the recorded model reference and its provenance",
};

// What each {name} stands for, and the strings that use it, by hand. The set of names must equal the set
// found in E.text (nothing undocumented, nothing documented and unused).
const PLACEHOLDERS = {
  n: "a count: bars beyond the held domain; the row-count level of a link",
  total: "the number of bars",
  m: "the row level of a link's context",
  n2: "the level the current window shows",
  m2: "the row level the current window shows",
  causes: "the cause words of a scale change, joined by the caller",
  support: "what a calibration was fitted on",
  excluded: "observations left out of a calibration",
  marks: "share of occupied marks outside the scale",
  area: "share of occupied screen area outside the scale",
  share: "share of nonzero marks in a low-discrimination band",
  t: "share of the time span (short exposure)",
  w: "share of the price span (short exposure)",
  seconds: "a formatted duration",
  value: "a formatted measured value",
  denominator: "the quantity that is 0",
  reason: "why a typed result has no value, or why an import was refused",
  setting: "one legacy setting",
  old: "its old meaning",
  new: "its new meaning",
  level: "the address-degrade level text",
  ap: "the appearance id of a link",
  current: "the appearance id of this page",
  id: "the appearance id",
  max: "a limit",
  measure: "the name of a measure",
};
// The placeholders of each string that has any, by hand from the D.11 rows (a second look at PLACEHOLDERS).
const USES = {
  "axis.clipped": ["n", "total"],
  "note.scaleChanged": ["causes"],
  "note.calibratedOn": ["support", "n", "excluded"],
  "warn.rangeDetail": ["marks", "area"],
  "warn.lowDiscLow": ["share"],
  "warn.lowDiscHigh": ["share"],
  "exposure.detail": ["t", "w"],
  "dwell.residual": ["seconds"],
  "typed.finite": ["value"],
  "typed.empty-population": ["denominator"],
  "typed.undefined": ["denominator"],
  "typed.pending": ["reason"],
  "typed.failed": ["reason"],
  "typed.unsupported": ["reason"],
  "typed.invalid-input": ["reason"],
  "revision.replaced": ["t"],
  "notice.legacyDetail": ["setting", "old", "new"],
  "notice.addressDegraded": ["level"],
  "notice.importRejected": ["reason"],
  "notice.importPartial": ["reason"],
  "notice.scaleContextDiffers": ["n", "m", "n2", "m2"],
  "notice.appearanceMismatch": ["ap", "current"],
  "notice.limit": ["max"],
  "ui.notOffered": ["measure"],
  "ui.appearance": ["id"],
};

// ---- helpers ------------------------------------------------------------------------------------------

// Every string leaf of E.text as {"a.b.c": text}; the two functions are skipped.
function flatten(node, prefix, out) {
  for (const key of Object.keys(node)) {
    const value = node[key];
    const at = prefix ? prefix + "." + key : key;
    if (typeof value === "function") continue;
    if (typeof value === "string") out[at] = value;
    else if (typeof value === "object" && value !== null) flatten(value, at, out);
    else out[at] = value;
  }
  return out;
}
const flat = flatten(E.text, "", {});
// The {names} of a string, found by a scan that shares nothing with the module.
function namesOf(text) {
  const names = [];
  let from = 0;
  for (;;) {
    const open = text.indexOf("{", from);
    if (open < 0) break;
    const close = text.indexOf("}", open);
    if (close < 0) break;
    names.push(text.slice(open + 1, close));
    from = close + 1;
  }
  return names;
}
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;

// The module loaded with a `console` the test owns (a bare vm context has none, so the warning of fill
// could not be observed through the shared loader). From the parts when ENCODING_PARTS_DIR is set (only
// the header, part 04 and the footer are needed), else from src/encoding.js.
function loadWithConsole(fake) {
  let source;
  const dir = process.env.ENCODING_PARTS_DIR;
  if (dir) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "text-parts-"));
    try {
      for (const f of ["00-header.js", "04-text.js", "99-footer.js"]) fs.copyFileSync(path.join(path.resolve(dir), f), path.join(tmp, f));
      source = assemble({ dir: tmp }).source;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else source = fs.readFileSync(path.resolve(__dirname, "../../src/encoding.js"), "utf8");
  const context = vm.createContext({ module: { exports: {} }, console: fake });
  vm.runInContext(source, context, { filename: "encoding.js" });
  return context.module.exports;
}

// ---- the table ------------------------------------------------------------------------------------------

test("every key of D.11 exists in E.text with the exact English, and E.text has no other key", () => {
  for (const [key, text] of Object.entries(D11)) assert.equal(flat[key], text, key);
  assert.deepEqual(Object.keys(flat).sort(), Object.keys(D11).sort(), "the key sets are the same (no flat alias, no stray key)");
  assert.equal(Object.keys(D11).length, 211, "D.11 lists 178 keys; DR-31 voids one, DR-41 adds 26 (24 role strings, key.zeroTick, key.open) and PRD-0002 S3 adds 8 (the view summary)");
});

test("the keys are the nested names of D.11: groups, no flat aliases, functions beside the groups", () => {
  assert.equal(E.text.exposure.short, "Short exposure");
  assert.equal(E.text.dwell.coverage, "Covered to the end of the data; interior gaps are unobservable");
  assert.equal(E.text.rank.approx, "Relative rank: 257-knot Type-7 quantile approximation, not an exact empirical midrank");
  assert.equal(E.text.model.extrapolated, "Model extrapolated beyond fitted levels");
  assert.equal(E.text.state.autoPausedLock, "Auto paused: comparison lock");
  assert.equal(E.text.note.cause.resolution, "resolution");
  assert.equal(E.text.lock.incompatible.rankAlgo, "different rank algorithm");
  assert.equal(E.text.address.level.refused, "The address is too long to write; copy the full view code");
  assert.equal(E.text.vintage, "Replay on currently available history; original vintages not guaranteed");
  assert.equal(E.text.shortExposure, undefined);
  assert.equal(E.text.typed.finite, "{value}");
  assert.equal(typeof E.text.fill, "function");
  assert.equal(typeof E.text.fillStrict, "function");
  assert.deepEqual(Object.keys(E.text).filter((k) => typeof E.text[k] === "function").sort(), ["fill", "fillStrict"]);
});

test("DR-31: there is no named-view limit string", () => {
  assert.equal(E.text.notice.namedViewsLimit, undefined);
  assert.ok(!Object.values(flat).some((text) => /named views/.test(text)), "no string speaks of a named-view cap");
});

// The twelve role ids of API.md B.9, by hand (the independent list the role strings must cover).
const ROLE_IDS = ["unsigned", "positive", "negative", "midpoint", "occupancy", "zero-outline", "unsigned-bar", "state-ink", "rows-projection",
  "family-reference", "interaction", "region-replacement"];
const camel = (id) => id.split("-").map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");

test("DR-41: every role id has a label and an accessible name, and the two signed-zero keys exist", () => {
  assert.equal(ROLE_IDS.length, 12);
  assert.deepEqual(Object.keys(E.text.role).sort(), ROLE_IDS.flatMap((id) => [camel(id), camel(id) + "Name"]).sort(), "24 keys: role.<camelId> and role.<camelId>Name");
  for (const id of ROLE_IDS) {
    const label = E.text.role[camel(id)];
    const name = E.text.role[camel(id) + "Name"];
    assert.equal(typeof label, "string", id);
    assert.equal(typeof name, "string", id);
    assert.notEqual(label, name, id + ": the accessible name says more than the label");
    assert.ok(name.length > label.length, id);
  }
  // When the role table (part 12) is present its `label` and `accessibleName` are exactly these keys.
  if (E.role !== undefined) {
    for (const r of Object.values(E.role.ROLES)) {
      const at = (key) => key.split(".").reduce((node, part) => (node === undefined ? node : node[part]), E.text);
      assert.equal(typeof at(r.label), "string", r.label);
      assert.equal(typeof at(r.accessibleName), "string", r.accessibleName);
    }
    // ...and the key row of a parent that runs past the data reads "Open" (DR-41).
    const [k] = Array.from(E.role.keyEntries(["waiting-for-complete-parent"], { "waiting-for-complete-parent": 1 }));
    assert.equal(k.key, "key.open");
    assert.equal(k.label, "Open");
  }
  assert.equal(E.text.key.zeroTick, "Zero");
  assert.equal(E.text.key.open, "Open");
  assert.notEqual(E.text.key.zeroTick, E.text.key.zero, "the signed-zero tick is not the unsigned zero outline");
});

test("E.text.typed has one entry per B.1 tag, named exactly as the tag (DR-35)", () => {
  const tags = ["finite", "negative-infinite", "no-reference", "empty-both", "empty-population", "undefined", "no-coarser-parent",
    "waiting-for-complete-parent", "outside-support", "hidden", "pending", "failed", "unsupported", "invalid-input"];
  assert.deepEqual(Object.keys(E.text.typed).sort(), [...tags].sort());
});

test("E.text is frozen all the way down", () => {
  assert.ok(Object.isFrozen(E.text));
  const walk = (node, at) => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "object" && value !== null) {
        assert.ok(Object.isFrozen(value), at + key + " is frozen");
        walk(value, at + key + ".");
      }
    }
  };
  walk(E.text, "");
  assert.throws(() => {
    "use strict";
    E.text.policy.explore = "Other";
  }, isError("TypeError"));
  assert.equal(E.text.policy.explore, "Explore");
});

test("non-ASCII appears only as the typographic minus and the infinity sign; no control or stray characters", () => {
  const allowed = new Set(["−", "∞", "×", "·", "→", "≈", "₂"]);
  const seen = new Set();
  for (const [key, text] of Object.entries(flat)) {
    assert.equal(typeof text, "string", key);
    for (const ch of text) {
      if (ch.charCodeAt(0) > 126) {
        assert.ok(allowed.has(ch), key + " holds U+" + ch.charCodeAt(0).toString(16));
        seen.add(ch);
      }
      assert.ok(ch.charCodeAt(0) >= 32, key + " holds a control character");
    }
    assert.equal(text, text.trim(), key + " has no edge whitespace");
    assert.ok(text.length > 0, key + " is not empty");
  }
  assert.deepEqual([...seen].sort(), ["−", "∞"], "the minus and the infinity sign of the D.11 strings");
});

// ---- placeholders ---------------------------------------------------------------------------------------

test("every {name} placeholder is documented, every documented name is used, and each string uses the names D.11 lists", () => {
  const used = new Set();
  const byKey = {};
  for (const [key, text] of Object.entries(flat)) {
    const names = namesOf(text);
    assert.ok(!/[{}]/.test(names.reduce((rest, n) => rest.split("{" + n + "}").join(""), text)), key + " has a stray brace");
    for (const n of names) used.add(n);
    if (names.length) byKey[key] = [...new Set(names)].sort();
  }
  for (const n of used) assert.ok(Object.prototype.hasOwnProperty.call(PLACEHOLDERS, n), "{" + n + "} is documented");
  for (const n of Object.keys(PLACEHOLDERS)) assert.ok(used.has(n), "{" + n + "} is documented but no string uses it");
  const want = {};
  for (const [key, names] of Object.entries(USES)) want[key] = [...names].sort();
  assert.deepEqual(byKey, want);
});

test("every name is an identifier the substitution can see", () => {
  for (const n of Object.keys(PLACEHOLDERS)) assert.match(n, /^[A-Za-z_][A-Za-z0-9_]*$/);
});

// ---- fill: never throws --------------------------------------------------------------------------------

test("fill substitutes each {name} from params: a value used twice, values that look like templates or replacement patterns", () => {
  const { fill } = E.text;
  assert.equal(fill("{a} of {b}", { a: 3, b: "ten" }), "3 of ten");
  assert.equal(fill("{a}{a}", { a: "x" }), "xx");
  assert.equal(fill("no placeholder", { a: 1 }), "no placeholder");
  assert.equal(fill("{a}", { a: "{b}", b: "no" }), "{b}", "one pass: a value is never expanded again");
  assert.equal(fill("[{a}]", { a: "$& $1 $$" }), "[$& $1 $$]", "a dollar sign in a value means nothing");
  assert.equal(fill("{a}", { a: 0 }), "0", "zero is a value");
  assert.equal(fill("{a}", { a: false }), "false");
  assert.equal(fill("{a}", { a: "" }), "", "an empty string is a value");
  assert.equal(fill("{a}", { a: NaN }), "NaN");
  assert.equal(fill("{{a}}", { a: "X" }), "{X}");
  assert.equal(fill("{ a } {1a} {}", { a: "X", "1a": "Y" }), "{ a } {1a} {}", "only {identifier} is a placeholder");
  assert.equal(fill("{n2} {m2}", { n2: 7, m2: 9 }), "7 9");
});

test("fill: a missing name keeps its {name} visible; an extra name is ignored; nothing inherited counts", () => {
  const { fill } = E.text;
  assert.equal(fill("{a} and {b}", { a: 1 }), "1 and {b}");
  assert.equal(fill("{a}", undefined), "{a}");
  assert.equal(fill("{a}", null), "{a}");
  assert.equal(fill("{a}", { a: undefined }), "{a}", "an undefined value is missing");
  assert.equal(fill("{a}", { a: null }), "{a}", "a null value is missing");
  assert.equal(fill("{constructor} {toString}", {}), "{constructor} {toString}", "inherited properties are not parameters");
  assert.equal(fill("x", { a: 1, unused: 2 }), "x", "an extra name is ignored");
  assert.equal(fill("{a}", { a: 1, unused: 2 }), "1");
});

test("fill never throws, whatever it is given", () => {
  const { fill } = E.text;
  const hostile = new Proxy({}, { has() { throw new Error("has"); }, get() { throw new Error("get"); }, getOwnPropertyDescriptor() { throw new Error("gopd"); } });
  const bomb = { get a() { throw new Error("getter"); } };
  const templates = [undefined, null, 0, 5, true, {}, [], () => "x", Symbol("s"), "", "{a}", "{a", "a}", "{", "}", "{{}}", "−{a}∞"];
  const params = [undefined, null, 0, "text", true, [], {}, { a: 1 }, { a: Symbol("v") }, { a: Object.create(null) }, hostile, bomb, () => 1, Object.create(null)];
  for (const t of templates) {
    for (const p of params) {
      let out;
      assert.doesNotThrow(() => {
        out = fill(t, p);
      }, "fill(" + String(typeof t) + ", " + String(typeof p) + ")");
      assert.equal(typeof out, "string");
    }
  }
  assert.equal(fill(undefined, {}), "", "a template that is not a string answers an empty string");
  assert.equal(fill("{a} b", bomb), "{a} b", "a value that cannot be read leaves the template as it was");
  assert.equal(fill("{a} b", { a: Object.create(null) }), "{a} b", "a value that cannot become text leaves the template as it was");
});

test("fill of every string of D.11 with all its names given leaves no brace and equals the split/join oracle", () => {
  const { fill } = E.text;
  for (const [key, text] of Object.entries(D11)) {
    const names = [...new Set(namesOf(text))];
    const params = {};
    let expected = text;
    for (const n of names) {
      params[n] = "<" + n + ">";
      expected = expected.split("{" + n + "}").join("<" + n + ">");
    }
    assert.equal(fill(text, params), expected, key);
    assert.ok(!/[{}]/.test(expected.split("<").join("")), key);
  }
});

test("DR-41: fill is stateless: it never reports through console, a missing name is only visible, two loads and repeated calls agree", () => {
  const calls = [];
  const M = loadWithConsole({ warn: (...args) => calls.push(args.join(" ")), log: (...args) => calls.push(args.join(" ")), error: (...args) => calls.push(args.join(" ")) });
  assert.equal(M.text.fill("{a} {b}", { a: 1 }), "1 {b}");
  assert.equal(M.text.fill("{a} {b}", { a: 1 }), "1 {b}", "the second call is the same as the first: no once-only state");
  assert.equal(M.text.fill("{b} again", {}), "{b} again");
  for (let i = 0; i < 200; i++) assert.equal(M.text.fill("{k" + i + "}", {}), "{k" + i + "}");
  assert.deepEqual(calls, [], "fill never reports anything: the literal {name} is the report");
  // A second load does not differ by what the first one has already been asked.
  const other = loadWithConsole({ warn: (...args) => calls.push(args.join(" ")) });
  assert.equal(other.text.fill("{a} {b}", { a: 1 }), "1 {b}");
  assert.deepEqual(calls, []);
  // No console at all, or a console without warn, is no different from a console that is listening.
  assert.equal(loadWithConsole(undefined).text.fill("{a}", {}), "{a}");
  assert.equal(loadWithConsole({}).text.fill("{a}", {}), "{a}");
  // The module holds no Set: the part's source has no module-level collection (the old warn-once memory).
  // Only while the parts exist (they are deleted by the assembly commit; the behaviour above stays).
  if (!process.env.ENCODING_PARTS_DIR) return;
  const part = fs.readFileSync(path.join(path.resolve(process.env.ENCODING_PARTS_DIR), "04-text.js"), "utf8");
  assert.ok(!/\bnew Set\b/.test(part) && !/console/.test(part.replace(/\/\/[^\n]*/g, "")), "part 04 holds no Set and never touches console");
});

// ---- fillStrict: throws --------------------------------------------------------------------------------

test("fillStrict substitutes like fill when every name is given, and ignores extra names", () => {
  const { fillStrict } = E.text;
  assert.equal(fillStrict("{a} of {b}", { a: 3, b: "ten" }), "3 of ten");
  assert.equal(fillStrict("plain", {}), "plain");
  assert.equal(fillStrict("plain", undefined), "plain");
  assert.equal(fillStrict("{a}", { a: 0, extra: 1 }), "0");
  assert.equal(fillStrict("{a}", { a: "{b}" }), "{b}", "a value that looks like a template is not a missing name");
  assert.equal(fillStrict("{a}", { a: "" }), "");
});

test("fillStrict throws a RangeError naming every missing {name}, and a TypeError for a template that is not a string", () => {
  const { fillStrict } = E.text;
  assert.throws(() => fillStrict("{a} {b}", { a: 1 }), (e) => isError("RangeError")(e) && /\{b\}/.test(e.message) && !/\{a\}/.test(e.message.split(" in ")[0]));
  assert.throws(() => fillStrict("{a} {b}", {}), (e) => isError("RangeError")(e) && /\{a\}, \{b\}/.test(e.message));
  assert.throws(() => fillStrict("{a}"), isError("RangeError"));
  assert.throws(() => fillStrict("{a}", null), isError("RangeError"));
  assert.throws(() => fillStrict("{a}", { a: undefined }), isError("RangeError"));
  assert.throws(() => fillStrict("{a}", { a: null }), isError("RangeError"));
  for (const bad of [undefined, null, 5, {}, []]) assert.throws(() => fillStrict(bad, {}), isError("TypeError"), String(bad));
});

test("fillStrict of every string of D.11 with exactly its documented names succeeds, and with one name missing throws", () => {
  const { fillStrict } = E.text;
  for (const [key, text] of Object.entries(D11)) {
    const names = [...new Set(namesOf(text))];
    const params = {};
    for (const n of names) params[n] = "<" + n + ">";
    assert.doesNotThrow(() => fillStrict(text, params), key);
    for (const n of names) {
      const short = { ...params };
      delete short[n];
      assert.throws(() => fillStrict(text, short), isError("RangeError"), key + " without " + n);
    }
  }
});
