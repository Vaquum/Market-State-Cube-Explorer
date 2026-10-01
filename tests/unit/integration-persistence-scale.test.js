"use strict";
// Cross-part integration tests, second file (package WX): the seams between E.policy, E.codec, E.store,
// E.lifecycle, E.model and E.measure that live where two packages meet.
//   (c) every E.codec.VISUAL_KEYS entry round-trips policy.persisted -> codec.formatAddress ->
//       codec.parseAddress -> policy.restore, at its default and at every legal non-default value, and the
//       codec's own default lists (modes, panes, Rows choices) agree with the catalogues of E.measure and
//       E.axis (two parts repeat the same names on purpose, so a drift between them is a silent loss);
//   (d) the S.scale flow across store, policy and lifecycle: Explore fit -> revisit -> Comparison lock ->
//       Fit while locked -> unlock, with the controller's wants and the store's records checked at each step;
//       the lock through the address and back; replay eligibility with a model fitted later than the scale,
//       through the portable code (issue #45 comment "P2 - Model provenance": the retrospective label must
//       survive the portable round trip even when the scale is eligible).
//
// Oracles (none is the code under test):
//   - (c) the canonical strings of API.md B.15 written as literals (`bs=i`, `tr=r`, `lk=1`, ...), the page's
//     own lists of the baseline 8c82ca1 (MODES, PANES and the Rows choices, typed in below from
//     src/explorer.js at that commit), and a comparison of every field by value after each leg;
//   - (d) the hand-worked Value fit of [1, 2, 3, 4, 100] (U = 100, the Type-7 median k = 3), the mapping ids
//     as compared by value (two ids are equal exactly when U and k are), the resolve branches of API.md C.9
//     (DR-06: a miss never borrows another context's mapping; DD-22: under the lock nothing is fitted and
//     frozen silently), the cadence rows of API.md A.6 for the controller (an explicit Fit bypasses Play and
//     the cap, is never displaced by an Auto request, and a fit never runs on data nobody checked), the
//     model boundaries of API.md A.5 (2026-09-24T00:00Z is 1790208000000 ms, from Date.UTC in this file),
//     node:zlib for the two ends of the portable code, and node:crypto for the payload seal.
// The module may run in a vm context (ENCODING_PARTS_DIR): records are compared through JSON.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => JSON.parse(JSON.stringify(E.policy.DEFAULTS));
const AP = "slate2-8f7890f7";
const ENV = { T0: 1609459200, BASE: 56.25, PR: 125, CUT: 3214083 };

// ---- (c) the address round trip -------------------------------------------------------------------------

const VIEW_DEFAULTS = {
  window: "24h", tA: NaN, tB: NaN, pA: NaN, pB: NaN, auto: true, n: null, m: null, selection: null, anchor: null, replay: false,
  follow: "refit", mode: "volume", pane: "cells", rows: "off", period: "90d", level: null, poc: true, area: false, untested: false,
  lines: [], tab: "context", evidenceKind: "poc", horizon: 1, barrier: 1, appearance: AP, scales: [], axes: [],
};
const SCALE_FIELDS = ["basis", "pathBasis", "transform", "curve", "rowsTransform", "cells", "rows", "local", "window", "lock"];
const scaleDefaults = () => ({ basis: "amount", pathBasis: "spans", transform: "value", curve: "log", rowsTransform: "value", cells: "explore", rows: "explore", local: false, window: null, lock: false });

// A view whose scale comes from S.scale THROUGH policy.persisted, the way the page writes it.
function viewOf(top, scalePrefs) {
  const s = Object.assign(fresh(), scalePrefs || {});
  return { ...VIEW_DEFAULTS, ...top, scale: { ...scaleDefaults(), ...E.policy.persisted(s) } };
}

// id -> [{view fields, scale prefs, text}]: the default first, then every legal non-default value. `text` is
// the address fragment by the literal grammar of B.15 (null for the default: omitted).
const LEGS = {
  follow: [[{ follow: "refit" }, null, null], [{ follow: "coupled" }, null, "f=coupled"]],
  mode: Object.keys({ volume: 1, flow: 1, delta: 1, cascade: 1, trades: 1, flowtrades: 1, size: 1, path: 1, dwell: 1, geometry: 1 }).map((m) => [{ mode: m }, null, m === "volume" ? null : "mode=" + m]),
  pane: ["cells", "volume", "delta", "trades", "size", "efficiency", "choppiness", "perpath", "rsi1d", "rsi4h", "macd1d"].map((p) => [{ pane: p }, null, p === "cells" ? null : "pane=" + p]),
  rows: ["off", "volume", "delta", "relvol", "time"].map((r) => [{ rows: r }, null, r === "off" ? null : "rows=" + r]),
  period: [[{ period: "90d" }, null, null], [{ period: "1y" }, null, "period=1y"], [{ period: "7d" }, null, "period=7d"], [{ period: "2026-09-01" }, null, "period=2026-09-01"]],
  level: [[{ level: null }, null, null], [{ level: 520.004 }, null, "level=65000.5"]],
  marks: [[{ poc: true, area: false, untested: false }, null, null], [{ poc: false, area: true, untested: false }, null, "marks=area"], [{ poc: true, area: true, untested: true }, null, "marks=poc,area,untested"]],
  lines: [[{ lines: [] }, null, null], [{ lines: ["1d", "7d"] }, null, "lines=1d,7d"]],
  tab: [[{ tab: "context" }, null, null], [{ tab: "evidence" }, null, "tab=continuations"]],
  evidenceKind: [[{ evidenceKind: "poc" }, null, null], [{ evidenceKind: "barrier" }, null, "outcome=barrier"]],
  horizon: [[{ horizon: 1 }, null, null], [{ horizon: 8 }, null, "h=8"]],
  barrier: [[{ barrier: 1 }, null, null], [{ barrier: 4 }, null, "dist=4"]],
  "scale.basis": [[{}, { basis: "amount" }, null], [{}, { basis: "intensity" }, "bs=i"]],
  "scale.pathBasis": [[{ mode: "path" }, { pathBasis: "spans" }, "mode=path"], [{ mode: "path" }, { pathBasis: "usdt" }, "mode=path&pb=u"], [{ mode: "path" }, { pathBasis: "perMinute" }, "mode=path&pb=m"]],
  "scale.transform": [[{}, { transform: "value" }, null], [{}, { transform: "rank" }, "tr=r"]],
  "scale.curve": [[{}, { curve: "log" }, null], [{}, { curve: "linear" }, "cv=l"]],
  "scale.rowsTransform": [[{}, { rowsTransform: "value" }, null], [{}, { rowsTransform: "rank" }, "rt=r"]],
  "scale.cells": [[{}, { cells: "explore" }, null], [{}, { cells: "auto" }, "cp=a"]],
  "scale.rows": [[{}, { rows: "explore" }, null], [{}, { rows: "auto" }, "rp=a"]],
  "scale.local": [[{}, { local: false }, null], [{}, { local: true }, "lc=1"]],
  "scale.window": [
    [{ mode: "flow" }, { window: null }, "mode=flow"],
    [{ mode: "flow" }, { window: [0.25, 0.75] }, "mode=flow&sw=0.25~0.75"],
    [{ mode: "flowtrades" }, { window: [0.4, 0.6] }, "mode=flowtrades&sw=0.4~0.6"],
    [{ mode: "dwell" }, { window: [0.2, 0.6] }, "mode=dwell&sw=0.2~0.6"],
  ],
  "scale.lock": [[{}, { lock: false }, null], [{}, { lock: true }, "lk=1"]],
};

test("(c) LEGS names every VISUAL_KEYS entry, and every scale field of VISUAL_KEYS is a field policy.persisted writes (and the reverse)", () => {
  assert.deepEqual(Object.keys(LEGS).sort(), E.codec.VISUAL_KEYS.map((k) => k.id).sort());
  const fromKeys = E.codec.VISUAL_KEYS.filter((k) => k.id.startsWith("scale.")).map((k) => k.id.slice(6)).sort();
  assert.deepEqual(fromKeys, SCALE_FIELDS.slice().sort());
  // every persisted field at a non-default value: the ten of B.8, and nothing else (runtime fields stay out)
  const all = { basis: "intensity", pathBasis: "usdt", transform: "rank", curve: "linear", rowsTransform: "rank", cells: "auto", rows: "auto", local: true, window: [0.25, 0.75], lock: true, resume: { cells: "auto", rows: "auto" }, held: { x: 1 }, frozen: { y: 2 } };
  assert.deepEqual(Object.keys(E.policy.persisted(Object.assign(fresh(), all))).sort(), SCALE_FIELDS.slice().sort());
  assert.deepEqual(plain(E.policy.persisted(fresh())), {}, "the defaults are omitted (DR-14)");
});

for (const id of Object.keys(LEGS)) {
  test(`(c) ${id}: every value survives persisted -> formatAddress -> parseAddress -> restore, and the address says what B.15 says`, () => {
    for (const [top, prefs, text] of LEGS[id]) {
      const tag = id + " " + JSON.stringify({ top, prefs });
      const view = viewOf(top, prefs);
      const written = E.codec.formatAddress(view, ENV, { budget: true });
      assert.deepEqual(plain(written.dropped), [], tag);
      const expected = "#w=24h&vis=2&ap=" + AP + (text === null ? "" : "&" + text);
      assert.equal(written.hash, expected, tag);
      const parsed = E.codec.parseAddress(written.hash, ENV);
      assert.equal(parsed.kind, "v2", tag);
      assert.deepEqual(plain(parsed.dropped), [], tag);
      for (const field of Object.keys(VIEW_DEFAULTS)) {
        if (["tA", "tB", "pA", "pB", "selection", "anchor", "scales", "axes"].includes(field)) continue;
        assert.deepEqual(plain({ v: parsed.view[field] }), plain({ v: view[field] }), tag + " field " + field);
      }
      assert.deepEqual(plain(parsed.view.scale), plain(view.scale), tag + " scale");
      // and back into policy: the preferences the page gets are the ones it wrote
      if (prefs !== null) {
        const restored = E.policy.restore({ scale: parsed.view.scale });
        assert.deepEqual(plain(restored.dropped), [], tag);
        for (const f of SCALE_FIELDS) assert.deepEqual(plain({ v: restored.scale[f] }), plain({ v: Object.assign(fresh(), prefs)[f] }), tag + " restored " + f);
        assert.deepEqual(plain(E.policy.persisted(restored.scale)), plain(E.policy.persisted(Object.assign(fresh(), prefs))), tag + " persisted again");
        assert.deepEqual(plain(restored.scale.held), {}, "a link carries no held mapping of its own");
        assert.deepEqual(plain(restored.scale.frozen), {});
        // the second write is byte-identical: the round trip is a fixed point
        const again = E.codec.formatAddress({ ...viewOf(top, null), scale: { ...scaleDefaults(), ...E.policy.persisted(restored.scale) } }, ENV, { budget: true });
        assert.equal(again.hash, written.hash, tag + " fixed point");
      }
    }
  });
}

test("(c) all ten scale settings and every legacy key away from their defaults at once: one address, read back field by field", () => {
  const prefs = { basis: "intensity", pathBasis: "usdt", transform: "rank", curve: "linear", rowsTransform: "rank", cells: "auto", rows: "auto", local: true, window: [0.25, 0.75], lock: true };
  const top = { mode: "flow", pane: "rsi4h", rows: "time", period: "1y", level: 520.004, poc: false, area: true, lines: ["1d", "7d"], tab: "evidence", evidenceKind: "barrier", horizon: 8, barrier: 4, follow: "coupled" };
  const view = viewOf(top, prefs);
  const written = E.codec.formatAddress(view, ENV);
  assert.equal(
    written.hash,
    "#w=24h&vis=2&ap=" + AP + "&f=coupled&mode=flow&pane=rsi4h&rows=time&period=1y&level=65000.5&marks=area&lines=1d,7d&tab=continuations&outcome=barrier&h=8&dist=4&bs=i&pb=u&tr=r&cv=l&rt=r&cp=a&rp=a&lc=1&sw=0.25~0.75&lk=1",
  );
  const parsed = E.codec.parseAddress(written.hash, ENV);
  assert.deepEqual(plain(parsed.view.scale), plain(view.scale));
  const restored = E.policy.restore({ scale: parsed.view.scale });
  for (const f of SCALE_FIELDS) assert.deepEqual(plain({ v: restored.scale[f] }), plain({ v: prefs[f] }), f);
  // the lock came back ON, with its runtime state empty: held mappings travel as records, and the colour
  // policies the lock suspended are not in an address (an unlock falls back to Explore, never to a wrong value)
  assert.equal(restored.scale.lock, true);
  assert.deepEqual(plain(restored.scale.resume), { cells: "explore", rows: "explore" });
});

test("(c) a raw window preference travels through a measure that cannot read it and is the effective window again on one that can (DD-82)", () => {
  // `window` is a raw preference of S.scale. Volume has no window, but cycling the measure must not destroy
  // it, so the address keeps it (for every measure it is a valid preference when 0 <= lo < hi <= 1) ...
  const s = Object.assign(fresh(), { window: [0.25, 0.75] });
  const view = viewOf({ mode: "volume" }, s);
  const written = E.codec.formatAddress(view, ENV);
  assert.equal(written.hash, "#w=24h&vis=2&ap=" + AP + "&sw=0.25~0.75");
  assert.deepEqual(plain(written.dropped), []);
  const restored = E.policy.restore({ scale: E.codec.parseAddress(written.hash, ENV).view.scale });
  assert.deepEqual(plain(restored.scale.window), [0.25, 0.75]);
  // ... while the EFFECTIVE view says what the measure can use
  assert.equal(E.policy.effective(restored.scale, "volume").window, null, "Volume has no window");
  assert.deepEqual(plain(E.policy.effective(restored.scale, "flow").window), [0.25, 0.75]);
  assert.deepEqual(plain(E.policy.effective(restored.scale, "dwell").window), [0.25, 0.75]);
  // a Taker flow window must stay symmetric about 0.5: an asymmetric one is refused where it would be used
  const bad = E.codec.formatAddress(viewOf({ mode: "flow" }, { window: [0.2, 0.6] }), ENV);
  assert.equal(bad.hash, "#w=24h&vis=2&ap=" + AP + "&mode=flow");
  assert.deepEqual(bad.dropped.map((d) => d.key), ["sw"]);
});

test("(c) the codec's default lists agree with the catalogues of E.measure and E.axis (the modes, the Rows choices and the pane menu)", () => {
  // the page's own lists at the baseline 8c82ca1 (src/explorer.js: MODES, ROWS choices, PANES)
  for (const mode of Object.keys(E.measure.MODES)) {
    const p = E.codec.parseAddress("#w=24h&vis=2&ap=" + AP + "&mode=" + mode, ENV);
    assert.equal(p.view.mode, mode, `mode ${mode} is in the codec's list`);
    assert.deepEqual(plain(p.dropped), [], mode);
  }
  assert.equal(E.codec.parseAddress("#w=24h&vis=2&ap=" + AP + "&mode=nonsense", ENV).view.mode, "volume", "an unknown mode is the default, not an error");
  for (const rows of ["off", ...Object.keys(E.measure.ROWS)]) {
    const p = E.codec.parseAddress("#w=24h&vis=2&ap=" + AP + "&rows=" + rows, ENV);
    assert.equal(p.view.rows, rows, `rows ${rows} is in the codec's list`);
  }
  for (const pane of ["cells", "volume", "delta", "trades", "size", "efficiency", "choppiness", "perpath", "rsi1d", "rsi4h", "macd1d"]) {
    const p = E.codec.parseAddress("#w=24h&vis=2&ap=" + AP + "&pane=" + pane, ENV);
    assert.equal(p.view.pane, pane);
    if (pane !== "cells") assert.ok(Object.prototype.hasOwnProperty.call(E.axis.CATALOGUE, "pane." + pane), `the pane ${pane} has a registered axis`);
  }
  // the modes of the catalogue are exactly the ten the page has
  assert.deepEqual(Object.keys(E.measure.MODES).sort(), ["cascade", "delta", "dwell", "flow", "flowtrades", "geometry", "path", "size", "trades", "volume"]);
});

// ---- (d) the S.scale flow -------------------------------------------------------------------------------

const RECORDED = 1790251368750; // 2026-09-24T12:02:48.750Z, the recorded page's cutoff
const cellsAt = (n) => E.context.cellsKey({ measure: "volume", n, m: 0, workspace: "live" });
const CLASS = "amount.usdt|log1p|u|-";
function calibration(ctx, desc, obsEndMs, extra) {
  return Object.assign({ v: 1, key: E.context.keyString(ctx), ctx, desc, policy: "explore", origin: "fit", workspace: ctx.workspace, cohort: { kind: "cells", n: 5, zeros: 0, nonzero: 5 }, obsEndMs, cutMs: obsEndMs }, extra || {});
}
const resolveAt = (store, scale, ctx, cutMs) => E.policy.resolve({ channel: "c", ctx, scale, store, workspace: ctx.workspace, cutMs });
const COHERENT = { ok: true, reasons: [] };

test("(d) the S.scale flow: Explore fit, revisit, Comparison lock, Fit while locked, unlock", () => {
  const store = E.store.create();
  const ctl = E.lifecycle.controller();
  const A = cellsAt(4);
  const B = cellsAt(5);
  let scale = fresh();
  let now = 10000;

  // -- 1. Explore: nothing fitted, then the first calibration of the context by the controller's cadence --
  const miss = resolveAt(store, scale, A, RECORDED);
  assert.equal(miss.state, "no-calibration");
  assert.equal(miss.reason, "uninitialized");
  const memo = E.lifecycle.memoKey({ generation: 1, CUT: 3214083.5, bounds: [3213312, 3214080, 512, 528], n: 4, m: 0, config: { mode: "volume", basis: "amount", pathBasis: "spans", transform: "value", policy: "explore", lock: false, window: null }, cohortId: "c1" });
  assert.equal(ctl.request("cells", "init", memo), true);
  assert.equal(ctl.request("cells", "init", memo), false, "the same want twice is one want");
  assert.equal(ctl.hasWants(), true);
  assert.deepEqual(plain(ctl.due("cells", { now, coherent: { ok: false, reasons: ["coverage"] } })), { run: false, waitMs: E.TIMING.RETRY_MS, reason: "read" }, "a fit never runs on data nobody checked");
  const gesture = ctl.due("cells", { now, lastGestureAt: now - 50, coherent: COHERENT });
  assert.deepEqual(plain(gesture), { run: false, waitMs: 150, reason: "gesture" }, "200 ms settle, 50 ms ago");
  now += 200;
  assert.deepEqual(plain(ctl.due("cells", { now, lastGestureAt: now - 200, coherent: COHERENT })), { run: true });
  const fitA = E.scale.fitValue({ values: Float64Array.from([1, 2, 3, 4, 100]) });
  assert.equal(fitA.state, "ok");
  assert.deepEqual(plain(fitA.descriptor.params), { U: 100, k: 3 }, "by hand: the largest magnitude and the Type-7 median");
  const recA = calibration(A, fitA.descriptor, RECORDED);
  const committed = store.commit("live", recA);
  assert.equal(committed.updated, false);
  assert.equal(ctl.ran("cells", "init", now), true);
  assert.equal(ctl.hasWants(), false, "the want is done");
  const r1 = resolveAt(store, scale, A, RECORDED);
  assert.equal(r1.state, "ok");
  assert.equal(r1.policy, "explore");
  assert.equal(r1.origin, "fit");
  assert.equal(r1.id, E.scale.id(fitA.descriptor));
  assert.equal(r1.desc.params.U, 100);

  // -- 2. Revisit: another level is another context and never borrows A's mapping (DR-06); back again, the
  //       retained record is the same mapping with no refit and no pending want --
  const missB = resolveAt(store, scale, B, RECORDED);
  assert.equal(missB.state, "no-calibration");
  assert.equal(missB.reason, "uninitialized");
  const fitB = E.scale.fitValue({ values: Float64Array.from([10, 20, 30, 40, 1000]) });
  assert.deepEqual(plain(fitB.descriptor.params), { U: 1000, k: 30 });
  assert.notEqual(E.scale.id(fitB.descriptor), E.scale.id(fitA.descriptor));
  const recB = calibration(B, fitB.descriptor, RECORDED);
  store.commit("live", recB);
  const r2 = resolveAt(store, scale, B, RECORDED);
  assert.equal(r2.id, E.scale.id(fitB.descriptor));
  const back = resolveAt(store, scale, A, RECORDED);
  assert.equal(back.id, r1.id, "revisiting A returns A's mapping");
  assert.equal(back.record, r1.record, "the very record, not a refit");
  assert.equal(ctl.hasWants(), false, "a revisit asks for nothing");

  // -- 3. Auto, then Comparison lock while looking at B: one action holds B's mapping for the class --
  const auto = E.policy.reduce(scale, { type: "policy", channel: "cells", value: "auto" }, { mode: "volume", live: true });
  assert.equal(auto.rejected, null);
  assert.deepEqual(plain(auto.effects.map((e) => e.type)), ["invalidate", "request-fit"]);
  scale = auto.scale;
  assert.equal(ctl.request("cells", "auto", "k1"), true);
  const axes = [{ id: "pane.volume", domain: [0, 5000], through: RECORDED }];
  const lockEnv = { mode: "volume", rows: "volume", live: true, active: { cells: r2.record }, axes };
  const lock = E.policy.reduce(scale, { type: "lock" }, lockEnv);
  assert.equal(lock.rejected, null);
  scale = lock.scale;
  assert.equal(scale.lock, true);
  assert.deepEqual(plain(scale.resume), { cells: "auto", rows: "explore" }, "the colour policies the lock suspends");
  assert.equal(scale.cells, "explore", "Auto is suspended under the lock");
  assert.deepEqual(Object.keys(scale.held), ["c|" + CLASS]);
  assert.ok(lock.effects.some((e) => e.type === "freeze-axis" && e.id === "pane.volume"));
  assert.equal(ctl.cancel("cells"), true, "the page drops the suspended Auto want");
  // the held mapping serves the class at every level, even where an Explore record exists (S1-102)
  for (const ctx of [A, B]) {
    const r = resolveAt(store, scale, ctx, RECORDED);
    assert.equal(r.policy, "comparison", E.context.keyString(ctx));
    assert.equal(r.id, E.scale.id(fitB.descriptor), "both levels now draw with B's mapping");
    assert.equal(r.external, false);
  }
  // a measure of another class falls back to Explore with its reason, it is not silently fitted or frozen
  const trades = E.context.cellsKey({ measure: "trades", n: 4, m: 0, workspace: "live" });
  const other = resolveAt(store, scale, trades, RECORDED);
  assert.equal(other.state, "no-calibration");
  assert.equal(other.fallback, "not-held");
  assert.equal(other.detail.startsWith(E.text.state.notHeld), true);
  // Auto cannot come back while locked
  const autoLocked = E.policy.reduce(scale, { type: "policy", channel: "cells", value: "auto" }, { mode: "volume", live: true });
  assert.equal(autoLocked.scale, scale);
  assert.equal(autoLocked.rejected.reason, E.text.state.autoPausedLock);

  // -- 4. Fit while locked: an explicit want that bypasses Play and is never displaced; the new mapping
  //       replaces the held one and the lock stays on; the Explore records are not touched --
  const fit = E.policy.reduce(scale, { type: "fit", channel: "cells" }, lockEnv);
  assert.deepEqual(plain(fit.effects[0]), { type: "request-fit", channel: "cells", kind: "fit", locked: true });
  assert.equal(ctl.request("cells", "fit", "k2"), true);
  assert.equal(ctl.request("cells", "auto", "k3"), false, "a background request does not displace an explicit Fit");
  now += 1000;
  assert.deepEqual(plain(ctl.due("cells", { now, playing: true, lastGestureAt: -Infinity, coherent: COHERENT })), { run: true }, "an explicit Fit runs during Play");
  const fitC = E.scale.fitValue({ values: Float64Array.from([5, 50, 500, 5000, 50000]) });
  assert.deepEqual(plain(fitC.descriptor.params), { U: 50000, k: 500 });
  const recC = calibration(B, fitC.descriptor, RECORDED + 60000);
  const hold = E.policy.reduce(scale, { type: "hold", channel: "cells", record: recC }, lockEnv);
  assert.equal(hold.rejected, null);
  scale = hold.scale;
  assert.equal(ctl.ran("cells", "fit", now), true);
  assert.equal(scale.lock, true, "still locked");
  assert.equal(Object.keys(scale.held).length, 1);
  assert.equal(scale.held["c|" + CLASS].desc.params.U, 50000);
  for (const ctx of [A, B]) assert.equal(resolveAt(store, scale, ctx, RECORDED + 60000).id, E.scale.id(fitC.descriptor), "both levels draw with the new held mapping");
  assert.equal(store.latest("live", E.context.keyString(B)).desc.params.U, 1000, "B's Explore record is untouched");
  assert.equal(store.latest("live", E.context.keyString(A)).desc.params.U, 100, "and so is A's");
  // the held mapping round-trips through the store's own JSON (what a saved workspace holds): not stored there
  assert.ok(!JSON.stringify(store.toJSON()).includes(E.scale.id(fitC.descriptor)), "a held mapping lives in S.scale, not in the Explore cache");

  // -- 5. Unlock: the held mapping goes, the suspended policy returns, Explore records draw again --
  const unlock = E.policy.reduce(scale, { type: "unlock" }, lockEnv);
  assert.equal(unlock.rejected, null);
  scale = unlock.scale;
  assert.equal(scale.lock, false);
  assert.equal(scale.cells, "auto", "the policy the lock suspended is back");
  assert.deepEqual(plain(scale.held), {});
  assert.deepEqual(plain(scale.frozen), {});
  assert.equal(scale.resume, null);
  assert.ok(unlock.effects.some((e) => e.type === "unfreeze-axis" && e.id === "pane.volume"));
  const afterA = resolveAt(store, scale, A, RECORDED);
  const afterB = resolveAt(store, scale, B, RECORDED);
  assert.equal(afterA.id, r1.id, "A is drawn with its own Explore mapping again");
  assert.equal(afterB.id, r2.id, "and so is B");
  assert.equal(afterA.policy, "auto", "under the preference that came back");
  // nothing of the lock is left in what is persisted: the same subset as before it was taken
  assert.deepEqual(plain(E.policy.persisted(scale)), { cells: "auto" });
  assert.equal(ctl.hasWants(), false);
});

test("(d) a lock survives an address: the held mapping travels as a record, comes back through restore and resolves the class again", () => {
  const store = E.store.create();
  const B = cellsAt(5);
  const fitC = E.scale.fitValue({ values: Float64Array.from([5, 50, 500, 5000, 50000]) });
  const active = calibration(B, E.scale.fitValue({ values: Float64Array.from([10, 20, 30, 40, 1000]) }).descriptor, RECORDED);
  let scale = E.policy.reduce(fresh(), { type: "lock" }, { mode: "volume", rows: "volume", live: true, active: { cells: active }, axes: [] }).scale;
  scale = E.policy.reduce(scale, { type: "hold", channel: "cells", record: calibration(B, fitC.descriptor, RECORDED) }, {}).scale;
  const held = scale.held["c|" + CLASS];
  // the codec record of the held mapping (API.md B.15: channel, policy letter, external, origin, descriptor, context)
  const rec = { channel: "c", policy: "k", external: false, origin: held.origin, desc: held.desc, ctx: held.ctx, cohort: { n: held.cohort.n, excluded: 0 }, obsEndMs: held.obsEndMs, cutMs: held.cutMs, canonicalThroughMs: null, token: null };
  const view = { ...viewOf({}, scale), scales: [rec] };
  const written = E.codec.formatAddress(view, ENV);
  assert.deepEqual(plain(written.dropped), []);
  assert.ok(written.hash.includes("&lk=1"), written.hash);
  assert.ok(written.hash.includes("&sc=c:k:"), "a comparison record: " + written.hash);
  const parsed = E.codec.parseAddress(written.hash, ENV);
  assert.deepEqual(plain(parsed.dropped), []);
  assert.equal(parsed.scales.length, 1);
  assert.equal(parsed.scales[0].desc.id, E.scale.id(fitC.descriptor), "the id is recomputed on read and equal");
  const restored = E.policy.restore({ scale: parsed.view.scale, records: parsed.scales });
  assert.deepEqual(plain(restored.dropped), []);
  assert.equal(restored.scale.lock, true);
  assert.deepEqual(Object.keys(restored.scale.held), ["c|" + CLASS]);
  assert.deepEqual(restored.commits, [], "a comparison record is held, it does not enter the Explore cache");
  // the restored page draws the class with the mapping it was sent, at another level too
  for (const n of [4, 5, 6]) {
    const r = resolveAt(store, restored.scale, cellsAt(n), RECORDED);
    assert.equal(r.policy, "comparison");
    assert.equal(r.id, E.scale.id(fitC.descriptor), "level " + n);
  }
  // and another class still says "Not held", never a silent fit
  const other = resolveAt(store, restored.scale, E.context.cellsKey({ measure: "delta", n: 4, m: 0, workspace: "live" }), RECORDED);
  assert.equal(other.fallback, "not-held");
});

// ---- (d) replay eligibility beside a model fitted later -------------------------------------------------

const MIDNIGHT = Date.UTC(2026, 8, 24); // 2026-09-24T00:00Z, the first bound of the model's status
const CUT_EARLY = MIDNIGHT - 3600000; // an hour before the model's extraction day

function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
function seal(p) {
  const body = { ...p };
  delete body.id;
  return { ...body, id: crypto.createHash("sha256").update(Buffer.from(canon(body), "utf8")).digest().subarray(0, 12).toString("base64url") };
}
const zlibDeflate = async (u8) => zlib.gzipSync(Buffer.from(u8));
const zlibInflate = async (u8, max) => zlib.gunzipSync(Buffer.from(u8), { maxOutputLength: max });

test("(d) the model status is the cutoff's alone: an eligible replay scale beside a retrospective model, before and after a portable round trip", async () => {
  assert.equal(MIDNIGHT, 1790208000000, "the literal of API.md A.5");
  // a replay scrubbed to an hour before the extraction: the scale was fitted on data before its edge ...
  const store = E.store.create();
  const ctx = E.context.cellsKey({ measure: "volume", n: 4, m: 0, workspace: "replay" });
  const fit = E.scale.fitValue({ values: Float64Array.from([1, 2, 3, 4, 100]) });
  store.commit("replay", calibration(ctx, fit.descriptor, CUT_EARLY - 60000));
  const live = resolveAt(store, fresh(), ctx, CUT_EARLY);
  assert.equal(live.state, "ok", "the scale is eligible at this cutoff");
  // ... while the model of the Efficiency pane was estimated on the extraction of 2026-09-24
  assert.equal(E.model.status(CUT_EARLY), "retrospective");
  const note = E.model.describe("efficiency", CUT_EARLY, 8);
  assert.equal(note.status, "retrospective");
  assert.equal(note.labels[0], E.text.model.retrospective);

  // the payload a page would write: the model block says what the page knew, the scale record is eligible
  const record = { channel: "c", policy: "e", external: false, origin: "fit", desc: fit.descriptor, ctx, cohort: { n: 5, excluded: 0 }, obsEndMs: CUT_EARLY - 60000, cutMs: CUT_EARLY, canonicalThroughMs: null, token: null };
  const model = { ...plain(E.model.PROVENANCE), status: note.status };
  assert.equal(model.ISO_B, 0.486, "by hand: the recorded parameter of the semantics document");
  const payload = plain({
    visualVersion: 2,
    kind: "view",
    query: { t1: 3213000, t2: 3213100, p1: 516, p2: 520, tR: 6, pR: 0 },
    view: {
      mode: "volume", pane: "efficiency", poc: true, area: false, untested: false, rows: "off", period: "90d", level: null, lines: [], tab: "context", replay: true, anchor: 3213200,
      horizon: 1, evidenceKind: "poc", barrier: 1, follow: "refit", auto: true, window: "", viewport: [3213000, 3213100, 512, 528],
      scale: { basis: "amount", pathBasis: "spans", transform: "value", curve: "log", rowsTransform: "value", cells: "explore", rows: "explore", local: false, window: null, lock: false },
    },
    appearance: { id: AP },
    scales: [record],
    axes: [],
    models: [model],
    observation: { source: "SYNTHETIC fixture - not market data", instrument: "BTC/USDT", cutoffMs: CUT_EARLY, canonicalThroughMs: null, token: null, note: E.text.vintage },
  });
  const code = await E.codec.encodePortable(payload, { deflate: zlibDeflate });
  assert.match(code, /^origo-cube:2\./);

  // a FRESH page: it decodes, validates and restores; nothing of its own state is involved
  const decoded = await E.codec.decodePortable(code, { inflate: zlibInflate });
  const valid = E.codec.validatePortable(decoded.payload, { CUT: 3214083 });
  assert.equal(valid.ok, true, JSON.stringify(valid.reasons));
  const imported = valid.value;
  assert.equal(imported.observation.cutoffMs, CUT_EARLY);
  assert.equal(imported.models[0].ISO_B, 0.486, "the record of the payload travels intact");
  const restored = E.policy.restore({ scale: imported.view.scale, records: imported.scales, replay: true });
  assert.deepEqual(plain(restored.dropped), []);
  assert.equal(restored.commits.length, 1);
  const store2 = E.store.create();
  for (const c of restored.commits) store2.commit(c.workspace, c.record);
  // the scale is still eligible on the importing page ...
  const again = resolveAt(store2, restored.scale, ctx, imported.observation.cutoffMs);
  assert.equal(again.state, "ok");
  assert.equal(again.id, E.scale.id(fit.descriptor));
  // ... and the model is still disclosed as retrospective: the status is recomputed from the cutoff, and
  // the eligible scale did not make it eligible
  const after = E.model.describe("efficiency", imported.observation.cutoffMs, 8);
  assert.equal(after.status, "retrospective");
  assert.equal(after.labels[0], E.text.model.retrospective);
  // the same label reaches the legend of the Efficiency pane (inspection): the details list says it in words
  const axis = E.axis.registry().frame("pane.efficiency", { cutMs: imported.observation.cutoffMs, now: 0, eligible: true, held: {}, sig: "s" });
  const frame = E.readout.paneFrame({ key: "efficiency", axis, lut: E.lut.build("slate2", "light"), model: after });
  const legend = E.legend.build(frame, null, null, {});
  const status = legend.details.find((d) => d.field === "modelStatus");
  assert.ok(status, "the legend discloses the model");
  assert.equal(status.canonical, "retrospective");
  assert.equal(status.value, E.text.model.retrospective);
  assert.equal(frame.readout({ v: 1 }, { ctx: { ratio: { structure: "complete", child: { v: 4000, rows: 8 }, parent: { v: 9000, rows: 12 } } } }).model.status, "retrospective", "and the readout of a column carries it");
  // the payload's own status text is never trusted: a code that says "eligible-by-bound" for this cutoff
  // changes nothing about what the importing page computes
  const lying = seal({ ...payload, models: [{ ...model, status: "eligible-by-bound" }] });
  const lied = E.codec.validatePortable(lying, { CUT: 3214083 });
  assert.equal(lied.ok, true, JSON.stringify(lied.reasons));
  assert.equal(E.model.status(lied.value.observation.cutoffMs), "retrospective", "recomputed from the cutoff, not read from the payload");
});

test("(d) the model status follows the effective cutoff through every boundary while the scale stays eligible (status and eligibility are separate rules)", () => {
  const store = E.store.create();
  const ctx = E.context.cellsKey({ measure: "volume", n: 4, m: 0, workspace: "replay" });
  store.commit("replay", calibration(ctx, E.scale.fitValue({ values: Float64Array.from([1, 2, 3, 4, 100]) }).descriptor, MIDNIGHT - 7200000));
  const cases = [
    [MIDNIGHT - 3600000, "retrospective"],
    [MIDNIGHT - 1, "retrospective"],
    [MIDNIGHT, "timing-unverified"],
    [RECORDED, "timing-unverified"],
    [MIDNIGHT + 86400000 - 1, "timing-unverified"],
    [MIDNIGHT + 86400000, "eligible-by-bound"],
  ];
  for (const [cut, status] of cases) {
    assert.equal(resolveAt(store, fresh(), ctx, cut).state, "ok", "the scale is eligible at " + cut);
    assert.equal(E.model.status(cut), status, "model at " + cut);
    assert.equal(E.model.describe("efficiency", cut, 8).labels.length, status === "eligible-by-bound" ? 0 : 1);
  }
  // and before the scale's own observations it is the scale that is ineligible, the model status unchanged
  assert.equal(resolveAt(store, fresh(), ctx, MIDNIGHT - 7200001).state, "no-calibration");
  assert.equal(E.model.status(MIDNIGHT - 7200001), "retrospective");
});
