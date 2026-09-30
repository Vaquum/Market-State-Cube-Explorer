"use strict";
// U26b (T-policy): E.policy (part 14), the scale preferences: DEFAULTS, `effective` versus `sanitize`, `offers`,
// the reducers (basis, transform, curve, policy, local, window, manual, fit), `resolve` and the persisted subset
// (API.md B.8, C.9, DR-04, DR-05, DR-09, DD-65, DD-66, DD-71, DD-73, DD-74, DD-82). The Comparison-lock reducer and
// its compatibility fallbacks are in comparison-lock.test.js; replay eligibility in replay.test.js.
//
// Oracles (none is the code under test): the capability table of API.md B.3 (which measure offers Intensity,
// Rank, a window) read row by row; the DD-82 scenario as a sequence (Volume with Intensity and Rank -> Flow ->
// back must give Intensity and Rank again without any stored change); the window vectors of DD-66 and C.5 (a
// Taker window is symmetric about 0.5, so 0.45..0.55 and 0.4..0.6 pass, 0.45..0.6 and 0.6..0.4 do not; Dwell
// takes any 0 <= lo < hi <= 1); the mapping id of API.md A.2 (value-log1p {26791234.56, 48211.3} is
// 3s_XdONgi8CSqyOl); the context key strings of API.md B.7; and the resolve branches of C.9 as a table. The English
// strings are the literals of INTEGRATION.md D.11.
// The module may run in a vm context (ENCODING_PARTS_DIR): its objects are of another realm, so structures
// are compared through JSON, and the input scale is checked for mutation by comparing its JSON before and after.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const isError = (name) => (e) => typeof e === "object" && e !== null && e.name === name;
const fresh = () => JSON.parse(JSON.stringify(E.policy.DEFAULTS));
const withPrefs = (over) => Object.assign(fresh(), over);

// ---- DEFAULTS -------------------------------------------------------------------------------------------

test("DEFAULTS is the S.scale of a fresh page, deep-frozen, and structuredClone-able", () => {
  assert.deepEqual(plain(E.policy.DEFAULTS), {
    basis: "amount",
    pathBasis: "spans",
    transform: "value",
    curve: "log",
    rowsTransform: "value",
    cells: "explore",
    rows: "explore",
    local: false,
    window: null,
    lock: false,
    resume: null,
    held: {},
    frozen: {},
  });
  assert.ok(Object.isFrozen(E.policy.DEFAULTS));
  assert.ok(Object.isFrozen(E.policy.DEFAULTS.held));
  assert.ok(Object.isFrozen(E.policy.DEFAULTS.frozen));
  const clone = structuredClone(E.policy.DEFAULTS);
  assert.ok(!Object.isFrozen(clone));
  clone.basis = "intensity";
  assert.equal(E.policy.DEFAULTS.basis, "amount");
  assert.deepEqual(Object.keys(E.policy).sort(), ["DEFAULTS", "effective", "offers", "persisted", "reduce", "resolve", "restore", "sanitize"]);
  assert.ok(Object.isFrozen(E.policy));
});

test("the new vocabulary avoids the retired names: no auto, locked, tier or neutral field (DR-04)", () => {
  const keys = Object.keys(E.policy.DEFAULTS);
  for (const banned of ["auto", "locked", "tier", "neutral", "refit"]) assert.equal(keys.indexOf(banned), -1, banned);
  assert.ok(keys.indexOf("lock") >= 0 && keys.indexOf("cells") >= 0 && keys.indexOf("local") >= 0);
});

// ---- effective ------------------------------------------------------------------------------------------

test("effective (DD-82): what the raw preferences MEAN for each measure, and nothing is written back", () => {
  const raw = withPrefs({ basis: "intensity", transform: "rank", curve: "linear", pathBasis: "usdt" });
  const before = JSON.stringify(raw);
  const eff = (mode) => plain(E.policy.effective(raw, mode));
  // Volume, Trades: Intensity and Rank apply; the linear curve applies only while Rank is NOT in effect
  assert.deepEqual(eff("volume"), { basis: "intensity", pathBasis: "spans", transform: "rank", curve: "log", window: null });
  assert.deepEqual(eff("trades"), { basis: "intensity", pathBasis: "spans", transform: "rank", curve: "log", window: null });
  // Delta: Intensity applies, Rank reads as Value, so the linear curve shows
  assert.deepEqual(eff("delta"), { basis: "intensity", pathBasis: "spans", transform: "value", curve: "linear", window: null });
  // Size has one basis (mean): Intensity reads as Amount; Rank applies
  assert.deepEqual(eff("size"), { basis: "amount", pathBasis: "spans", transform: "rank", curve: "log", window: null });
  // Path: its own basis; Intensity reads as Amount
  assert.deepEqual(eff("path"), { basis: "amount", pathBasis: "usdt", transform: "rank", curve: "log", window: null });
  // fixed measures and Geometry: no Intensity, no Rank, no curve
  for (const mode of ["flow", "flowtrades", "dwell", "cascade", "geometry"]) assert.deepEqual(eff(mode), { basis: "amount", pathBasis: "spans", transform: "value", curve: "log", window: null }, mode);
  assert.equal(JSON.stringify(raw), before, "effective() never writes back");
});

test("cycling M from Volume (Intensity, Rank) through Flow and back restores Intensity and Rank: nothing was stored (DD-82)", () => {
  let scale = withPrefs({ basis: "intensity", transform: "rank" });
  const log = [];
  for (const mode of ["volume", "flow", "delta", "cascade", "volume"]) {
    const e = plain(E.policy.effective(scale, mode));
    log.push(mode + ":" + e.basis + "/" + e.transform);
  }
  assert.deepEqual(log, ["volume:intensity/rank", "flow:amount/value", "delta:intensity/value", "cascade:amount/value", "volume:intensity/rank"]);
  assert.equal(scale.basis, "intensity");
  assert.equal(scale.transform, "rank");
  // the address keeps the raw preferences
  assert.deepEqual(plain(E.policy.persisted(scale)), { basis: "intensity", transform: "rank" });
});

test("effective: the curve applies to unbounded measures only, and to the Rows channel through its own transform", () => {
  const lin = withPrefs({ curve: "linear" });
  assert.equal(E.policy.effective(lin, "volume").curve, "linear");
  assert.equal(E.policy.effective(lin, "flow").curve, "log");
  assert.equal(E.policy.effective(lin, "volume", "rows").curve, "linear");
  assert.equal(E.policy.effective(lin, "relvol", "rows").curve, "log");
  const ranked = withPrefs({ curve: "linear", rowsTransform: "rank" });
  assert.equal(E.policy.effective(ranked, "volume", "rows").transform, "rank");
  assert.equal(E.policy.effective(ranked, "volume", "rows").curve, "log");
  assert.equal(E.policy.effective(ranked, "delta", "rows").transform, "value", "Rows Delta has no Rank");
  assert.equal(E.policy.effective(ranked, "delta", "rows").curve, "linear");
  assert.equal(E.policy.effective(ranked, "time", "rows").transform, "rank");
  assert.equal(E.policy.effective(ranked, "relvol", "rows").transform, "value");
  assert.deepEqual(plain(E.policy.effective(ranked, "volume", "rows")), { basis: "amount", pathBasis: "spans", transform: "rank", curve: "log", window: null });
});

test("effective: a manual window is read only where it is valid for the measure (DD-66)", () => {
  const w = (lo, hi) => withPrefs({ window: [lo, hi] });
  assert.deepEqual(plain(E.policy.effective(w(0.45, 0.55), "flow").window), [0.45, 0.55]);
  assert.deepEqual(plain(E.policy.effective(w(0.45, 0.55), "flowtrades").window), [0.45, 0.55]);
  assert.deepEqual(plain(E.policy.effective(w(0.4, 0.6), "flow").window), [0.4, 0.6]);
  assert.equal(E.policy.effective(w(0.45, 0.6), "flow").window, null, "asymmetric about 0.5 is not a Taker window");
  assert.equal(E.policy.effective(w(0.6, 0.4), "flow").window, null);
  assert.equal(E.policy.effective(w(0, 1), "flow").window, null, "the natural window is no narrowing");
  assert.deepEqual(plain(E.policy.effective(w(0.2, 0.7), "dwell").window), [0.2, 0.7]);
  assert.equal(E.policy.effective(w(0.7, 0.2), "dwell").window, null);
  for (const mode of ["volume", "trades", "delta", "size", "path", "cascade", "geometry"]) assert.equal(E.policy.effective(w(0.45, 0.55), mode).window, null, mode);
  assert.equal(E.policy.effective(withPrefs({ window: "0.45~0.55" }), "flow").window, null, "a window that is not a pair is ignored");
});

test("effective: unknown measures throw, a missing scale reads as the defaults", () => {
  assert.throws(() => E.policy.effective(fresh(), "nonsense"), isError("RangeError"));
  assert.throws(() => E.policy.effective(fresh(), "nonsense", "rows"), isError("RangeError"));
  assert.throws(() => E.policy.effective("x", "volume"), isError("TypeError"));
  assert.deepEqual(plain(E.policy.effective(undefined, "volume")), { basis: "amount", pathBasis: "spans", transform: "value", curve: "log", window: null });
  assert.deepEqual(plain(E.policy.effective(E.policy.DEFAULTS, "volume")), plain(E.policy.effective(fresh(), "volume")));
});

test("effective coerces values that are not legal at all to the defaults without throwing", () => {
  const bad = withPrefs({ basis: "bogus", pathBasis: 7, transform: null, curve: {} });
  assert.deepEqual(plain(E.policy.effective(bad, "path")), { basis: "amount", pathBasis: "spans", transform: "value", curve: "log", window: null });
});

// ---- sanitize (imports only) -----------------------------------------------------------------------------

test("sanitize is for IMPORTS: it resets what is legal for NO measure and keeps what is legal for some (Rank on Delta stays)", () => {
  const s = plain(
    E.policy.sanitize({
      basis: "bogus",
      pathBasis: "perMinute",
      transform: "rank",
      curve: "cubic",
      rowsTransform: 3,
      cells: "locked",
      rows: "auto",
      local: "yes",
      window: [0.6, 0.4],
      lock: 1,
      resume: { cells: "auto", rows: "auto" },
      held: { "c|x": 1 },
      frozen: { a: 1 },
      extra: "dropped",
    })
  );
  assert.deepEqual(s, {
    basis: "amount",
    pathBasis: "perMinute",
    transform: "rank",
    curve: "log",
    rowsTransform: "value",
    cells: "explore",
    rows: "auto",
    local: false,
    window: null,
    lock: false,
    resume: null,
    held: {},
    frozen: {},
  });
  assert.deepEqual(plain(E.policy.sanitize(null)), plain(E.policy.DEFAULTS));
  assert.deepEqual(plain(E.policy.sanitize({ window: [0.3, 0.9] }).window), [0.3, 0.9], "any 0 <= lo < hi <= 1 pair survives; the measure decides later");
  assert.equal(E.policy.sanitize({ window: [0, 2] }).window, null);
  assert.equal(E.policy.sanitize({ window: [0.5, 0.5] }).window, null);
  assert.deepEqual(plain(E.policy.sanitize({ lock: true, resume: { cells: "auto", rows: "x" } })).resume, { cells: "auto", rows: "explore" });
  assert.deepEqual(plain(E.policy.sanitize({ lock: true })).resume, { cells: "explore", rows: "explore" });
  const input = { basis: "intensity" };
  E.policy.sanitize(input);
  assert.deepEqual(input, { basis: "intensity" });
});

// ---- offers ---------------------------------------------------------------------------------------------

test("offers (cells): the capability table of B.3, row by row", () => {
  const o = (mode, scale, live) => plain(E.policy.offers("cells", mode, scale || fresh(), live === undefined ? true : live));
  const pick = (x) => ({ basis: x.basis, pathBasis: x.pathBasis, transform: x.transform, curve: x.curve, policy: x.policy, fit: x.fit, local: x.local });
  const unbounded = (basis, pathBasis, transform) => ({ basis, pathBasis, transform, curve: ["log", "linear"], policy: ["explore", "auto"], fit: true, local: true });
  assert.deepEqual(pick(o("volume")), unbounded(["amount", "intensity"], [], ["value", "rank"]));
  assert.deepEqual(pick(o("trades")), unbounded(["amount", "intensity"], [], ["value", "rank"]));
  assert.deepEqual(pick(o("delta")), unbounded(["amount", "intensity"], [], ["value"]), "Delta has no Rank");
  assert.deepEqual(pick(o("size")), unbounded([], [], ["value", "rank"]));
  assert.deepEqual(pick(o("path")), unbounded([], ["spans", "usdt", "perMinute"], ["value", "rank"]));
  for (const mode of ["flow", "flowtrades", "dwell", "cascade", "geometry"]) {
    assert.deepEqual(pick(o(mode)), { basis: [], pathBasis: [], transform: [], curve: [], policy: [], fit: false, local: false }, mode);
  }
});

test("offers: the curve is withheld while Rank is in effect; Auto is withheld under the lock; the lock can always be released", () => {
  const ranked = plain(E.policy.offers("cells", "volume", withPrefs({ transform: "rank" }), true));
  assert.deepEqual(ranked.curve, []);
  assert.equal(ranked.reasons["curve.linear"], "Linear is offered only for Value");
  // Rank raw on a measure that has none: the effective transform is Value, so the curve IS offered (DD-82)
  assert.deepEqual(plain(E.policy.offers("cells", "delta", withPrefs({ transform: "rank" }), true)).curve, ["log", "linear"]);
  const locked = plain(E.policy.offers("cells", "volume", withPrefs({ lock: true, resume: { cells: "explore", rows: "explore" } }), true));
  assert.deepEqual(locked.policy, ["explore"]);
  assert.equal(locked.reasons["policy.auto"], "Auto paused: comparison lock");
  const flowLocked = plain(E.policy.offers("cells", "flow", withPrefs({ lock: true }), true));
  assert.equal(flowLocked.lock, true, "the lock offers itself as a release even where this measure has nothing to hold");
  assert.equal(plain(E.policy.offers("cells", "flow", fresh(), true)).lock, false);
  assert.equal(plain(E.policy.offers("cells", "volume", fresh(), true)).lock, true);
});

test("offers (rows): Rank for Volume and Time at price only, never for Delta or Relative volume (DD-73); Local contrast is a Cells control", () => {
  const o = (key) => plain(E.policy.offers("rows", key, fresh(), true));
  assert.deepEqual(o("volume").transform, ["value", "rank"]);
  assert.deepEqual(o("time").transform, ["value", "rank"]);
  assert.deepEqual(o("delta").transform, ["value"]);
  assert.deepEqual(o("relvol").transform, [], "Relative volume is fixed: no transform and no rank");
  assert.deepEqual(o("relvol").policy, []);
  assert.equal(o("relvol").fit, false);
  assert.deepEqual(o("volume").policy, ["explore", "auto"]);
  assert.equal(o("volume").local, false);
  assert.deepEqual(o("volume").basis, []);
  assert.deepEqual(o("volume").pathBasis, []);
  assert.deepEqual(o("volume").curve, ["log", "linear"]);
  assert.deepEqual(plain(E.policy.offers("rows", "volume", withPrefs({ rowsTransform: "rank" }), true)).curve, []);
  assert.deepEqual(plain(E.policy.offers("rows", "delta", withPrefs({ rowsTransform: "rank" }), true)).curve, ["log", "linear"], "Rank reads as Value on Delta");
});

test("offers: on the recorded page (live false) Path, Dwell and Rows time at price are not available and say why", () => {
  for (const [channel, key] of [["cells", "path"], ["cells", "dwell"], ["rows", "time"]]) {
    const o = plain(E.policy.offers(channel, key, fresh(), false));
    assert.equal(o.available, false, key);
    assert.deepEqual([o.basis, o.pathBasis, o.transform, o.curve, o.policy], [[], [], [], [], []]);
    assert.equal(o.fit, false);
    assert.equal(o.reasons.measure, "Not supported here: live cube only");
  }
  assert.equal(plain(E.policy.offers("cells", "volume", fresh(), false)).available, true);
  assert.equal(plain(E.policy.offers("rows", "volume", fresh(), false)).available, true);
  assert.equal(plain(E.policy.offers("cells", "path", fresh(), true)).available, true);
  assert.equal(plain(E.policy.offers("cells", "path", fresh(), undefined)).available, true, "unknown liveness is not 'recorded'");
});

test("offers: the accessible 'why disabled' text names the measure (the caller's label, or the key capitalised)", () => {
  const o = plain(E.policy.offers("cells", "delta", fresh(), true));
  assert.equal(o.reasons["transform.rank"], "Not offered for Delta");
  assert.equal(o.reasons["pathBasis.usdt"], "Not offered for Delta");
  assert.equal(plain(E.policy.offers("cells", "flowtrades", fresh(), true, "Taker trades")).reasons["basis.intensity"], "Not offered for Taker trades");
  const flow = plain(E.policy.offers("cells", "flow", fresh(), true));
  for (const k of ["basis.intensity", "transform.value", "transform.rank", "policy.auto", "fit", "local", "lock"]) assert.equal(flow.reasons[k], "Not offered for Flow", k);
  assert.equal(plain(E.policy.offers("cells", "volume", fresh(), true)).reasons["transform.rank"], undefined, "an offered item has no reason");
});

test("offers: unknown channel or subject throws", () => {
  assert.throws(() => E.policy.offers("lens", "volume", fresh(), true), isError("RangeError"));
  assert.throws(() => E.policy.offers("cells", "relvol", fresh(), true), isError("RangeError"));
  assert.throws(() => E.policy.offers("rows", "flow", fresh(), true), isError("RangeError"));
});

// ---- reduce: preferences ---------------------------------------------------------------------------------

const red = (scale, action, env) => E.policy.reduce(scale, action, env);
const E_VOL = { mode: "volume", rows: "volume", live: true };

test("reduce basis / pathBasis: sets an offered value; rejects one the CURRENT measure does not offer and changes nothing", () => {
  const scale = fresh();
  const ok = red(scale, { type: "basis", value: "intensity" }, E_VOL);
  assert.equal(ok.scale.basis, "intensity");
  assert.equal(ok.rejected, null);
  assert.deepEqual(plain(ok.effects), [{ type: "invalidate", channel: "cells" }]);
  assert.notEqual(ok.scale, scale, "a new object");
  assert.equal(scale.basis, "amount", "the input is never mutated");
  const no = red(scale, { type: "basis", value: "intensity" }, { mode: "flow" });
  assert.equal(no.scale, scale, "rejected: the same object, nothing changed");
  assert.deepEqual(plain(no.rejected), { item: "basis.intensity", reason: "Not offered for Flow" });
  assert.deepEqual(plain(no.effects), []);
  assert.equal(red(scale, { type: "basis", value: "amount" }, E_VOL).scale, scale, "already the raw value: a no-op");
  assert.equal(red(scale, { type: "basis", value: "bogus" }, E_VOL).rejected.item, "basis.bogus");
  const p = red(scale, { type: "pathBasis", value: "perMinute" }, { mode: "path", live: true });
  assert.equal(p.scale.pathBasis, "perMinute");
  assert.equal(red(scale, { type: "pathBasis", value: "perMinute" }, { mode: "volume" }).rejected.item, "pathBasis.perMinute");
  assert.equal(red(scale, { type: "pathBasis", value: "perMinute" }, { mode: "path", live: false }).rejected.item, "pathBasis.perMinute", "Path needs the live cube");
});

test("reduce transform / rowsTransform: Rank is rejected where the CURRENT measure has none, and nothing else is rewritten (DD-82)", () => {
  const scale = withPrefs({ basis: "intensity", curve: "linear", local: true });
  const before = JSON.stringify(scale);
  const no = red(scale, { type: "transform", value: "rank" }, { mode: "delta" });
  assert.equal(no.scale, scale);
  assert.equal(no.rejected.item, "transform.rank");
  assert.equal(no.rejected.reason, "Not offered for Delta");
  const yes = red(scale, { type: "transform", value: "rank" }, { mode: "volume" });
  assert.equal(yes.scale.transform, "rank");
  // no other field was touched by the action
  assert.deepEqual(plain(yes.scale), Object.assign(JSON.parse(before), { transform: "rank" }));
  assert.equal(JSON.stringify(scale), before);
  // Value is always offered for an unbounded measure; not for a fixed one
  assert.equal(red(withPrefs({ transform: "rank" }), { type: "transform", value: "value" }, { mode: "delta" }).scale.transform, "value");
  assert.equal(red(scale, { type: "transform", value: "value" }, { mode: "flow" }).rejected.item, "transform.value");
  // Rows
  assert.equal(red(scale, { type: "rowsTransform", value: "rank" }, { rows: "volume" }).scale.rowsTransform, "rank");
  assert.equal(red(scale, { type: "rowsTransform", value: "rank" }, { rows: "time" }).scale.rowsTransform, "rank");
  assert.equal(red(scale, { type: "rowsTransform", value: "rank" }, { rows: "delta" }).rejected.item, "transform.rank");
  assert.equal(red(scale, { type: "rowsTransform", value: "rank" }, { rows: "relvol" }).rejected.item, "transform.rank");
  assert.deepEqual(plain(red(scale, { type: "rowsTransform", value: "rank" }, { rows: "volume" }).effects), [{ type: "invalidate", channel: "rows" }]);
});

test("reduce curve (DD-71): rejected for a fixed measure or while Rank is in effect; accepted when either channel offers it", () => {
  const scale = fresh();
  const ok = red(scale, { type: "curve", value: "linear" }, E_VOL);
  assert.equal(ok.scale.curve, "linear");
  assert.deepEqual(plain(ok.effects), [{ type: "invalidate", channel: "all" }]);
  const fixed = red(scale, { type: "curve", value: "linear" }, { mode: "flow" });
  assert.equal(fixed.scale, scale);
  assert.equal(fixed.rejected.reason, "Linear is offered only for Value");
  const ranked = withPrefs({ transform: "rank", rowsTransform: "rank" });
  assert.equal(red(ranked, { type: "curve", value: "linear" }, E_VOL).rejected.item, "curve.linear", "Rank is in effect on both channels");
  // Cells is on Rank but Rows is on Value: the curve is offered there, and it is one field for both channels
  assert.equal(red(withPrefs({ transform: "rank" }), { type: "curve", value: "linear" }, E_VOL).scale.curve, "linear");
  assert.equal(red(scale, { type: "curve", value: "cubic" }, E_VOL).rejected.item, "curve.cubic");
  assert.equal(red(withPrefs({ curve: "linear" }), { type: "curve", value: "linear" }, E_VOL).scale.curve, "linear");
  assert.throws(() => red(scale, { type: "curve", value: "log" }, {}), isError("TypeError"), "the page must say which measures are current");
});

test("reduce policy: Explore and Auto per channel; Auto requests a fit; Auto is refused for a fixed measure", () => {
  const scale = fresh();
  const a = red(scale, { type: "policy", channel: "cells", value: "auto" }, E_VOL);
  assert.equal(a.scale.cells, "auto");
  assert.equal(a.scale.rows, "explore");
  assert.deepEqual(plain(a.effects), [{ type: "invalidate", channel: "cells" }, { type: "request-fit", channel: "cells", kind: "auto" }]);
  const r = red(scale, { type: "policy", channel: "rows", value: "auto" }, E_VOL);
  assert.equal(r.scale.rows, "auto");
  assert.equal(r.scale.cells, "explore");
  const back = red(a.scale, { type: "policy", channel: "cells", value: "explore" }, E_VOL);
  assert.equal(back.scale.cells, "explore");
  assert.deepEqual(plain(back.effects), [{ type: "invalidate", channel: "cells" }], "going back to Explore needs no fit");
  assert.equal(red(scale, { type: "policy", channel: "cells", value: "auto" }, { mode: "flow" }).rejected.item, "policy.auto");
  assert.equal(red(scale, { type: "policy", channel: "cells", value: "explore" }, E_VOL).scale, scale);
  assert.equal(red(scale, { type: "policy", channel: "rows", value: "auto" }, { rows: "relvol" }).rejected.item, "policy.auto");
  assert.throws(() => red(scale, { type: "policy", channel: "lens", value: "auto" }, E_VOL), isError("RangeError"));
  assert.equal(red(scale, { type: "policy", channel: "c", value: "auto" }, E_VOL).scale.cells, "auto", "c and r are accepted for cells and rows");
});

test("reduce local: Local contrast is for unbounded Cells measures; turning it OFF is always allowed", () => {
  const scale = fresh();
  const on = red(scale, { type: "local", value: true }, E_VOL);
  assert.equal(on.scale.local, true);
  assert.deepEqual(plain(on.effects), [{ type: "invalidate", channel: "lens" }]);
  const no = red(scale, { type: "local", value: true }, { mode: "flow" });
  assert.equal(no.scale, scale);
  assert.equal(no.rejected.item, "local");
  assert.equal(red(on.scale, { type: "local", value: false }, { mode: "flow" }).scale.local, false);
  assert.equal(red(scale, { type: "local", value: false }, E_VOL).scale, scale);
  assert.throws(() => red(scale, { type: "local", value: "yes" }, E_VOL), isError("TypeError"));
});

test("reduce window (DD-66): a Taker window is symmetric about 0.5, a Dwell window any 0 <= lo < hi <= 1; null clears; other measures refuse", () => {
  const scale = fresh();
  const w = (value, mode) => red(scale, { type: "window", value }, { mode });
  assert.deepEqual(plain(w([0.45, 0.55], "flow").scale.window), [0.45, 0.55]);
  assert.deepEqual(plain(w([0.4, 0.6], "flowtrades").scale.window), [0.4, 0.6]);
  assert.match(w([0.45, 0.6], "flow").rejected.reason, /symmetric about 50%/);
  assert.equal(w([0.45, 0.6], "flow").scale, scale);
  assert.match(w([0.6, 0.4], "flow").rejected.reason, /0 <= low < high <= 1/);
  assert.match(w([-0.1, 0.9], "dwell").rejected.reason, /0 <= low < high <= 1/);
  assert.match(w([0.2, 1.2], "dwell").rejected.reason, /0 <= low < high <= 1/);
  assert.deepEqual(plain(w([0.2, 0.7], "dwell").scale.window), [0.2, 0.7]);
  assert.deepEqual(plain(w([0, 1], "dwell").scale.window), [0, 1]);
  assert.equal(w([0.45, 0.55], "volume").rejected.reason, "Window not applied to this measure");
  assert.equal(w([0.45, 0.55], "delta").rejected.item, "window");
  assert.equal(w(["a", "b"], "flow").rejected.item, "window");
  const set = w([0.45, 0.55], "flow").scale;
  assert.deepEqual(plain(red(set, { type: "window", value: null }, { mode: "volume" }).scale.window), null, "clearing works on any measure");
  assert.equal(red(scale, { type: "window", value: null }, { mode: "volume" }).scale, scale, "already null: a no-op");
  assert.deepEqual(plain(w([0.45, 0.55], "flow").effects), [{ type: "invalidate", channel: "cells" }]);
  // the stored window is a copy: changing the action's array later does not change the scale
  const arr = [0.45, 0.55];
  const s2 = red(scale, { type: "window", value: arr }, { mode: "flow" }).scale;
  arr[0] = 0.1;
  assert.deepEqual(plain(s2.window), [0.45, 0.55]);
  assert.throws(() => red(scale, { type: "window", value: [0.4, 0.6] }, {}), isError("TypeError"));
});

test("reduce fit: an explicit Fit is an effect, offered only for unbounded measures, and it clears a manual domain of that channel", () => {
  const scale = fresh();
  const f = red(scale, { type: "fit", channel: "cells" }, E_VOL);
  assert.deepEqual(plain(f.effects), [{ type: "request-fit", channel: "cells", kind: "fit", locked: false }, { type: "invalidate", channel: "cells" }]);
  assert.equal(f.scale, scale, "Fit changes no preference");
  assert.equal(red(scale, { type: "fit", channel: "cells" }, { mode: "flow" }).rejected.item, "fit");
  assert.equal(red(scale, { type: "fit", channel: "rows" }, { rows: "relvol" }).rejected.item, "fit");
  const manual = withPrefs({ held: { "c|amount.usdt|log1p|u|-": { origin: "manual" }, "r|amount.usdt|log1p|u|-": { origin: "manual" }, "c|delta.usdt|log1p|s|-": { origin: "fit" } } });
  const cleared = red(manual, { type: "fit", channel: "cells" }, E_VOL);
  assert.deepEqual(Object.keys(plain(cleared.scale.held)).sort(), ["c|delta.usdt|log1p|s|-", "r|amount.usdt|log1p|u|-"].sort(), "only the Cells manual domain went");
  assert.equal(Object.keys(manual.held).length, 3, "the input is not mutated");
  assert.equal(red(withPrefs({ lock: true, resume: { cells: "explore", rows: "explore" } }), { type: "fit", channel: "cells" }, E_VOL).effects[0].locked, true);
});

// ---- reduce: manual domain -------------------------------------------------------------------------------

const cellsCtx = E.context.cellsKey({ measure: "volume", n: 4, m: 0 });
const rowsCtx = E.context.rowsKey({ measure: "volume", period: "roll:90", rowSize: 3 });
const MANUAL_ENV = { mode: "volume", rows: "volume", live: true, contexts: { cells: cellsCtx, rows: rowsCtx }, cutMs: 1790251368750 };

test("reduce manual: a manual domain holds ONE channel and ONE class, does not engage the lock, and is a real mapping (API.md A.2 id)", () => {
  const scale = fresh();
  const out = red(scale, { type: "manual", channel: "cells", kind: "value-log1p", U: 26791234.56, k: 48211.3 }, MANUAL_ENV);
  assert.equal(out.rejected, null);
  assert.equal(out.scale.lock, false);
  assert.deepEqual(Object.keys(plain(out.scale.held)), ["c|amount.usdt|log1p|u|-"]);
  const held = plain(out.scale.held["c|amount.usdt|log1p|u|-"]);
  assert.equal(held.desc.id, "3s_XdONgi8CSqyOl");
  assert.deepEqual(held.desc.params, { U: 26791234.56, k: 48211.3 });
  assert.equal(held.origin, "manual");
  assert.equal(held.policy, "comparison");
  assert.equal(held.key, "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n4m0");
  assert.equal(held.workspace, "live");
  assert.equal(held.obsEndMs, 1790251368750);
  assert.deepEqual(plain(out.effects), [{ type: "invalidate", channel: "cells" }]);
  // Rows is a different channel: nothing is held for it
  const linearRows = E.context.rowsKey({ measure: "volume", period: "roll:90", rowSize: 3, transform: "value", curve: "linear" });
  const rowsOut = red(scale, { type: "manual", channel: "rows", kind: "value-linear", U: 5e6 }, Object.assign({}, MANUAL_ENV, { contexts: { cells: cellsCtx, rows: linearRows } }));
  assert.deepEqual(Object.keys(plain(rowsOut.scale.held)), ["r|amount.usdt|linear|u|-"]);
  assert.equal(plain(rowsOut.scale.held["r|amount.usdt|linear|u|-"]).desc.kind, "value-linear");
});

test("reduce manual: invalid input is refused with the reason and changes nothing", () => {
  const scale = fresh();
  const bad = (action, env) => red(scale, Object.assign({ type: "manual", channel: "cells", kind: "value-log1p" }, action), env || MANUAL_ENV);
  for (const a of [{ U: 100, k: 200 }, { U: -1, k: 1 }, { U: 100, k: 0 }, { U: NaN, k: 1 }, { U: 100 }, { U: Infinity, k: 1 }]) {
    const r = bad(a);
    assert.equal(r.scale, scale, JSON.stringify(a));
    assert.equal(r.rejected.reason, "A manual domain needs finite positive U and k with k <= U", JSON.stringify(a));
  }
  assert.equal(bad({ kind: "fixed-linear", U: 1, k: 1 }).rejected.item, "manual");
  assert.equal(bad({ kind: "value-linear", U: 100 }).rejected.item, "manual", "a log context takes (U, k), not a linear U");
  assert.equal(bad({ kind: undefined, U: 100, k: 10 }).scale.held["c|amount.usdt|log1p|u|-"].desc.kind, "value-log1p", "without a kind the context decides");
  const rank = E.context.cellsKey({ measure: "volume", n: 4, m: 0, transform: "rank" });
  assert.equal(bad({ U: 100, k: 10 }, { mode: "volume", contexts: { cells: rank }, live: true }).rejected.item, "manual", "a Rank context has no manual U, k");
  assert.equal(bad({ U: 100, k: 10 }, { mode: "flow", contexts: MANUAL_ENV.contexts }).rejected.item, "manual", "a fixed measure has no manual U, k");
  assert.equal(bad({ U: 100, k: 10 }, { mode: "volume" }).rejected.reason, "No calibration", "the page must supply the channel's context");
});

test("reduce manual for a signed measure makes a signed descriptor; clearManual removes the manual domain of that channel only", () => {
  const deltaCtx = E.context.cellsKey({ measure: "delta", n: 8, m: 1 });
  const env = { mode: "delta", rows: "volume", live: true, contexts: { cells: deltaCtx, rows: rowsCtx }, cutMs: 5 };
  const a = red(fresh(), { type: "manual", channel: "cells", kind: "value-log1p", U: 1204551.25, k: 8830.5 }, env);
  const held = plain(a.scale.held["c|delta.usdt|log1p|s|-"]);
  assert.equal(held.desc.signed, true);
  assert.equal(held.desc.id, "ot_D8yL_NiaSousm", "the signed id of API.md A.2");
  const both = red(a.scale, { type: "manual", channel: "rows", kind: "value-log1p", U: 100, k: 10 }, env);
  assert.equal(Object.keys(plain(both.scale.held)).length, 2);
  const cleared = red(both.scale, { type: "clearManual", channel: "cells" }, env);
  assert.deepEqual(Object.keys(plain(cleared.scale.held)), ["r|amount.usdt|log1p|u|-"]);
  assert.deepEqual(plain(cleared.effects), [{ type: "invalidate", channel: "cells" }]);
  assert.equal(red(cleared.scale, { type: "clearManual", channel: "cells" }, env).scale, cleared.scale, "nothing to clear: a no-op");
  const classOnly = red(both.scale, { type: "clearManual", channel: "rows", classKey: "amount.usdt|log1p|u|-" }, env);
  assert.deepEqual(Object.keys(plain(classOnly.scale.held)), ["c|delta.usdt|log1p|s|-"]);
  assert.equal(red(both.scale, { type: "clearManual", channel: "rows", classKey: "nothing" }, env).scale, both.scale);
});

test("reduce: an unknown action is a programming error; the action must be an object with a type", () => {
  assert.throws(() => red(fresh(), { type: "explode" }, E_VOL), isError("TypeError"));
  assert.throws(() => red(fresh(), null, E_VOL), isError("TypeError"));
  assert.throws(() => red(fresh(), { value: 1 }, E_VOL), isError("TypeError"));
  assert.throws(() => red(fresh(), { type: "basis", value: "amount" }), isError("TypeError"), "basis needs env.mode");
  assert.throws(() => red(fresh(), { type: "rowsTransform", value: "rank" }, { mode: "volume" }), isError("TypeError"), "rowsTransform needs env.rows");
  assert.equal(red(undefined, { type: "basis", value: "intensity" }, E_VOL).scale.basis, "intensity", "a page with no scale yet starts from the defaults");
});

test("every change returns a new scale, never the frozen DEFAULTS mutated", () => {
  const out = red(E.policy.DEFAULTS, { type: "basis", value: "intensity" }, E_VOL);
  assert.equal(out.scale.basis, "intensity");
  assert.equal(E.policy.DEFAULTS.basis, "amount");
  assert.ok(!Object.isFrozen(out.scale));
});

// ---- persisted ------------------------------------------------------------------------------------------

test("persisted: the RAW preferences that differ from the defaults, nothing else (omitted = default under vis=2)", () => {
  assert.deepEqual(plain(E.policy.persisted(fresh())), {});
  assert.deepEqual(plain(E.policy.persisted(E.policy.DEFAULTS)), {});
  assert.deepEqual(
    plain(E.policy.persisted(withPrefs({ basis: "intensity", pathBasis: "perMinute", transform: "rank", curve: "linear", rowsTransform: "rank", cells: "auto", rows: "auto", local: true, window: [0.45, 0.55], lock: true, resume: { cells: "auto", rows: "explore" }, held: { x: 1 }, frozen: { y: 2 } }))),
    { basis: "intensity", pathBasis: "perMinute", transform: "rank", curve: "linear", rowsTransform: "rank", cells: "auto", rows: "auto", local: true, window: [0.45, 0.55], lock: true },
    "runtime fields (resume, held, frozen) are not preferences"
  );
  assert.deepEqual(plain(E.policy.persisted(withPrefs({ curve: "linear" }))), { curve: "linear" });
  E.result.assertJsonSafe(E.policy.persisted(withPrefs({ window: [0.1, 0.2], local: true })));
});

test("persisted then restore is the identity on the preferences", () => {
  const scale = withPrefs({ basis: "intensity", transform: "rank", curve: "linear", cells: "auto", window: [0.45, 0.55], local: true });
  const back = E.policy.restore({ scale: E.policy.persisted(scale) }).scale;
  for (const k of ["basis", "pathBasis", "transform", "curve", "rowsTransform", "cells", "rows", "local", "window", "lock"]) assert.deepEqual(plain(back[k]), plain(scale[k]), k);
});

// ---- resolve --------------------------------------------------------------------------------------------

function calOf(ctx, obsEndMs, over) {
  const fit = E.scale.manual({ kind: "value-log1p", signed: false, U: 1000, k: 10 });
  return Object.assign({ v: 1, key: E.context.keyString(ctx), ctx, desc: fit.descriptor, policy: "explore", origin: "fit", workspace: "live", cohort: { kind: "cells", n: 3, zeros: 0, nonzero: 3 }, obsEndMs, cutMs: obsEndMs }, over || {});
}

function resolve(over) {
  return E.policy.resolve(Object.assign({ channel: "c", ctx: cellsCtx, scale: fresh(), store: E.store.create(), workspace: "live", cutMs: 2000 }, over));
}

test("resolve: Geometry is an outline with nothing to map, a fixed measure its natural descriptor, neither touches the store", () => {
  const store = E.store.create();
  const occ = resolve({ kind: "occupancy", store, ctx: undefined });
  assert.equal(occ.state, "ok");
  assert.equal(occ.desc, null);
  assert.equal(occ.policy, "fixed");
  const fixed = E.scale.fixed("share-diverging");
  const f = resolve({ kind: "fixed", fixed, store, ctx: undefined });
  assert.equal(f.state, "ok");
  assert.equal(f.desc, fixed);
  assert.equal(f.id, "bladfrSuC76_siSl", "the fixed Taker share id of API.md A.2");
  assert.equal(f.policy, "fixed");
  assert.equal(f.origin, "fixed");
  assert.throws(() => resolve({ kind: "fixed", store }), isError("TypeError"));
  assert.ok(Object.isFrozen(f));
});

test("resolve: a miss is No calibration and NEVER borrows another context's mapping (DR-06)", () => {
  const store = E.store.create();
  store.commit("live", calOf(E.context.cellsKey({ measure: "volume", n: 5, m: 0 }), 1000));
  store.commit("live", calOf(E.context.cellsKey({ measure: "trades", n: 4, m: 0 }), 1000));
  const r = resolve({ store });
  assert.equal(r.state, "no-calibration");
  assert.equal(r.desc, null);
  assert.equal(r.record, null);
  assert.equal(r.id, null);
  assert.equal(r.reason, "uninitialized");
  assert.equal(r.key, "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n4m0");
  assert.equal(r.external, false);
  assert.equal(r.fallback, null);
});

test("resolve: no carry-over across levels: the mapping of level n=4 is not used at n=5 until that context is initialised", () => {
  const store = E.store.create();
  const c4 = E.context.cellsKey({ measure: "volume", n: 4, m: 0 });
  const c5 = E.context.cellsKey({ measure: "volume", n: 5, m: 0 });
  store.commit("live", calOf(c4, 1000));
  assert.equal(resolve({ store, ctx: c4 }).state, "ok");
  assert.equal(resolve({ store, ctx: c5 }).state, "no-calibration");
  store.commit("live", calOf(c5, 1500, { desc: E.scale.manual({ kind: "value-log1p", signed: false, U: 77, k: 7 }).descriptor }));
  const at5 = resolve({ store, ctx: c5 });
  assert.equal(at5.state, "ok");
  assert.equal(at5.desc.params.U, 77);
  assert.equal(resolve({ store, ctx: c4 }).desc.params.U, 1000, "revisit restores the level's own mapping");
});

test("resolve: a store hit is Explore or Auto by the channel's preference; the record, id and eligibility ride along", () => {
  const store = E.store.create();
  const rec = calOf(cellsCtx, 1000);
  store.commit("live", rec);
  const explore = resolve({ store });
  assert.equal(explore.state, "ok");
  assert.equal(explore.policy, "explore");
  assert.equal(explore.id, rec.desc.id);
  assert.equal(explore.origin, "fit");
  assert.equal(explore.obsEndMs, 1000);
  assert.equal(explore.channel, "c");
  assert.equal(explore.workspace, "live");
  assert.equal(explore.external, false);
  assert.equal(explore.ineligibleNewer, false);
  assert.equal(resolve({ store, scale: withPrefs({ cells: "auto" }) }).policy, "auto");
  assert.equal(resolve({ store, scale: withPrefs({ rows: "auto" }) }).policy, "explore", "the Rows preference does not reach Cells");
  const rowsKeyCtx = rowsCtx;
  store.commit("live", calOf(rowsKeyCtx, 1000));
  assert.equal(resolve({ store, channel: "r", ctx: rowsKeyCtx, scale: withPrefs({ rows: "auto" }) }).policy, "auto");
  assert.equal(resolve({ store, channel: "r", ctx: rowsKeyCtx, scale: withPrefs({ cells: "auto" }) }).policy, "explore");
});

test("resolve: a record fitted after the cutoff is ineligible: the newest eligible one is used, else 'replay' (no 'retained' branch, DD-74)", () => {
  const store = E.store.create();
  store.commit("live", calOf(cellsCtx, 3000, { desc: E.scale.manual({ kind: "value-log1p", signed: false, U: 3000, k: 30 }).descriptor }));
  const none = resolve({ store, cutMs: 2000 });
  assert.equal(none.state, "no-calibration");
  assert.equal(none.reason, "replay", "a record exists but the cutoff makes it ineligible");
  store.commit("live", calOf(cellsCtx, 1000));
  const prior = resolve({ store, cutMs: 2000 });
  assert.equal(prior.state, "ok");
  assert.equal(prior.obsEndMs, 1000);
  assert.equal(prior.ineligibleNewer, true);
  // the only states a Resolved can have
  for (const r of [none, prior, resolve({ kind: "occupancy", store, ctx: undefined })]) assert.ok(["ok", "no-calibration"].indexOf(r.state) >= 0);
  assert.equal(plain(none).retained, undefined);
  assert.equal(resolve({ store: E.store.create(), cutMs: 2000 }).reason, "uninitialized");
});

test("resolve: live and replay workspaces are read separately", () => {
  const store = E.store.create();
  store.commit("live", calOf(cellsCtx, 1000));
  assert.equal(resolve({ store, workspace: "live" }).state, "ok");
  assert.equal(resolve({ store, workspace: "replay" }).state, "no-calibration");
  assert.throws(() => resolve({ store, workspace: "both" }), isError("RangeError"));
});

test("resolve: input errors throw (channel, context, store)", () => {
  assert.throws(() => resolve({ channel: "x" }), isError("RangeError"));
  assert.throws(() => resolve({ ctx: undefined }), isError("TypeError"));
  assert.throws(() => resolve({ store: null }), isError("TypeError"));
  assert.throws(() => E.policy.resolve(null), isError("TypeError"));
  assert.equal(resolve({ scale: undefined }).state, "no-calibration", "no scale yet reads as the defaults");
});

test("resolve: Cells and Rows share the class amount.usdt but are different channels: a manual domain held for Cells does not reach Rows (DD-65)", () => {
  const store = E.store.create();
  const manualCells = Object.assign(calOf(cellsCtx, 5, { policy: "comparison", origin: "manual", desc: E.scale.manual({ kind: "value-log1p", signed: false, U: 26791234.56, k: 48211.3 }).descriptor }));
  const scale = withPrefs({ held: { "c|amount.usdt|log1p|u|-": manualCells } });
  store.commit("live", calOf(rowsCtx, 1000));
  const cells = resolve({ store, scale });
  assert.equal(cells.desc.id, "3s_XdONgi8CSqyOl");
  assert.equal(cells.policy, "comparison");
  assert.equal(cells.origin, "manual");
  const rows = resolve({ store, scale, channel: "r", ctx: rowsCtx });
  assert.equal(rows.desc.id, calOf(rowsCtx, 1000).desc.id, "the Rows mapping is unchanged");
  assert.equal(rows.policy, "explore");
});

// ---- restore --------------------------------------------------------------------------------------------

function rec(chan, policy, ctx, over) {
  const fit = E.scale.manual({ kind: "value-log1p", signed: false, U: 26791234.56, k: 48211.3 });
  return Object.assign({ chan, policy, origin: "fit", desc: fit.descriptor, ctx, cohort: { kind: "cells", n: 10, zeros: 0, nonzero: 10 }, obsEndMs: 1790251368750, cutMs: 1790251368750, token: "f3a1" }, over || {});
}

test("restore turns validated records into store commits, held mappings, frozen axes and the lens record (C.13)", () => {
  const axisDesc = { v: 1, kind: "axis-linear", signed: false, params: { lo: 0, hi: 1920000000 }, clip: "axis@1" };
  axisDesc.id = E.scale.id(axisDesc);
  assert.equal(axisDesc.id, "fAie68jq2OF1287z");
  const out = E.policy.restore({
    scale: { basis: "intensity", lock: true },
    records: [
      rec("c", "e", cellsCtx),
      rec("c", "auto", E.context.cellsKey({ measure: "volume", n: 5, m: 0 })),
      rec("r", "k", rowsCtx),
      rec("l", "l", cellsCtx),
      { chan: "a.pane.volume", policy: "x", origin: "restored", desc: axisDesc, through: 1790251368750 },
    ],
    axes: [{ id: "pane.delta", domain: [-5, 5], policy: "frozen", through: 7 }],
  });
  assert.deepEqual(plain(out.dropped), []);
  assert.equal(out.scale.basis, "intensity");
  assert.equal(out.scale.lock, true);
  assert.deepEqual(plain(out.scale.resume), { cells: "explore", rows: "explore" });
  // implicit records become store commits, origin restored ("restored, not refitted")
  assert.deepEqual(plain(out.commits.map((c) => [c.workspace, c.record.policy, c.record.origin, c.record.key])), [
    ["live", "explore", "restored", "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n4m0"],
    ["live", "auto", "restored", "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n5m0"],
  ]);
  assert.equal(out.commits[0].record.obsEndMs, 1790251368750);
  assert.equal(out.commits[0].record.token, "f3a1");
  assert.equal(out.commits[0].record.desc.id, "3s_XdONgi8CSqyOl");
  // an explicit comparison record is held under channel|class
  assert.deepEqual(Object.keys(plain(out.scale.held)), ["r|amount.usdt|log1p|u|-"]);
  assert.equal(out.scale.held["r|amount.usdt|log1p|u|-"].policy, "comparison");
  // the lens's Local contrast record, and the frozen axes (an `a.` record and an `axes` entry)
  assert.equal(out.lens.policy, "local");
  assert.deepEqual(plain(out.scale.frozen), { "pane.volume": { lo: 0, hi: 1920000000 }, "pane.delta": { lo: -5, hi: 5 } });
  assert.deepEqual(plain(out.frozen), [
    { id: "pane.volume", domain: [0, 1920000000], through: 1790251368750 },
    { id: "pane.delta", domain: [-5, 5], through: 7 },
  ]);
  // a restored record can be committed and then resolved at once (the round trip to a working page)
  const store = E.store.create();
  for (const c of out.commits) store.commit(c.workspace, c.record);
  const r = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: out.scale, store, workspace: "live", cutMs: 1790251368750 });
  assert.equal(r.fallback, "not-held", "the lock is on and the class is not held: 'Not held' (A-23), never a silent unlock");
  assert.equal(r.policy, "explore");
  assert.equal(r.state, "ok", "the fallback is Explore, which draws the restored record of the context");
  const free = E.policy.resolve({ channel: "c", ctx: cellsCtx, scale: Object.assign({}, out.scale, { lock: false }), store, workspace: "live", cutMs: 1790251368750 });
  assert.equal(free.state, "ok");
  assert.equal(free.origin, "restored");
});

test("restore keeps a manual or external origin on a held record", () => {
  const out = E.policy.restore({ records: [rec("c", "k", cellsCtx, { origin: "manual" }), rec("r", "k", rowsCtx, { origin: "external" })] });
  assert.equal(out.scale.held["c|amount.usdt|log1p|u|-"].origin, "manual");
  assert.equal(out.scale.held["r|amount.usdt|log1p|u|-"].origin, "external");
  // a manual record is held even under another policy letter: it is an explicit domain by definition
  const m = E.policy.restore({ records: [rec("c", "e", cellsCtx, { origin: "manual" })] });
  assert.deepEqual(Object.keys(plain(m.scale.held)), ["c|amount.usdt|log1p|u|-"]);
});

test("restore names what it cannot place: bad descriptors, unknown channels and policies, replay records on a page with no replay, and the 17th scale", () => {
  const replayCtx = E.context.cellsKey({ measure: "volume", n: 4, m: 0, workspace: "replay" });
  const tampered = rec("c", "e", cellsCtx);
  tampered.desc = Object.assign({}, tampered.desc, { params: { U: 9, k: 3 } });
  const good = rec("c", "e", cellsCtx);
  const input = {
    records: [
      tampered,
      rec("z", "e", cellsCtx),
      rec("c", "zzz", cellsCtx),
      rec("c", "l", cellsCtx),
      rec("l", "e", cellsCtx),
      rec("r", "e", undefined),
      rec("c", "e", replayCtx),
      { chan: "a.pane.volume", policy: "x", origin: "restored", desc: good.desc },
      null,
      { desc: good.desc },
      good,
    ],
  };
  const out = E.policy.restore(input);
  const why = plain(out.dropped).map((d) => d.chan + ": " + d.reason);
  assert.deepEqual(why, [
    "c: descriptor: the id does not match the mapping",
    "z: unknown channel",
    "c: unknown policy",
    "c: a colour record cannot have the policy local",
    "l: a lens record cannot have the policy explore",
    "r: a record needs its context and obsEndMs",
    "c: a replay record on a page with no replay",
    "a.pane.volume: an axis record carries an axis domain",
    "#8: a record needs a channel",
    "#9: a record needs a channel",
  ]);
  assert.equal(out.commits.length, 1, "the one good record was placed");
  // with a replay to restore into, a replay-workspace record is committed to the replay store
  const withReplay = E.policy.restore({ replay: true, records: [rec("c", "e", replayCtx)] });
  assert.deepEqual(plain(withReplay.commits.map((c) => c.workspace)), ["replay"]);
  assert.deepEqual(plain(withReplay.dropped), []);
  // the 16-descriptor limit counts what was PLACED: 16 fit, the 17th is named
  const many = [];
  for (let i = 0; i < 17; i++) many.push(rec("c", "e", E.context.cellsKey({ measure: "volume", n: i, m: 0 })));
  const lim = E.policy.restore({ records: [rec("c", "zzz", cellsCtx)].concat(many) });
  assert.equal(lim.commits.length, 16);
  assert.deepEqual(plain(lim.dropped.map((d) => d.reason)), ["unknown policy", "more than 16 active scales"]);
  assert.equal(E.LIMITS.DESCRIPTORS_MAX, 16);
});

test("restore sanitises the preferences it is given and starts from the defaults; an empty input is the default scale", () => {
  assert.deepEqual(plain(E.policy.restore({}).scale), plain(E.policy.DEFAULTS));
  assert.deepEqual(plain(E.policy.restore(null).scale), plain(E.policy.DEFAULTS));
  assert.deepEqual(plain(E.policy.restore({ scale: { basis: "bogus", window: [0.3, 0.9] } }).scale.window), [0.3, 0.9]);
  assert.equal(E.policy.restore({ scale: { basis: "bogus" } }).scale.basis, "amount");
  const bad = E.policy.restore({ axes: [{ id: "pane.volume", domain: [5, 1] }, { domain: [0, 1] }, null] });
  assert.equal(bad.dropped.length, 3);
  assert.deepEqual(plain(bad.scale.frozen), {});
});
