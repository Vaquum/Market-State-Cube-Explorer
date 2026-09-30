"use strict";
// U24 (T-context): E.context (cellsKey, rowsKey, keyString, equal, periodIdentity, diff, compatClass) and
// E.scale.compat of src/encoding.js, loaded through tests/support/enc.js.
// Oracles (none is the code under test): the two key strings of API.md B.7 (written out by hand); the
// class strings of API.md C.8 and DD-65 ("amount.usdt|log1p|u|-"); the reason list of C.8; JavaScript's own
// Date.UTC for every calendar fact (the rollover instants of TESTPLAN U24: 2026-09-28T00:00Z = base 3219456,
// 2026-10-01T00:00Z = 3224064, 2027-01-01T00:00Z = 3365376 are re-derived here from the lattice
// T0 = 1609459200, BASE = 56.25 rather than trusted); hand-worked tables of which spec field changes which
// key field.
// Where it does not run: the 64-context LRU with active and Comparison-locked protection, the eviction
// tombstones and live/replay isolation are E.store (part 13, U24b, package W1-E); the cross-check against
// E.measure.FORMULAS below runs only when part 05 is loaded.
// The module may be evaluated in a vm context (ENCODING_PARTS_DIR): records are compared through JSON and
// errors by name.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));
const named = (name) => (e) => typeof e === "object" && e !== null && e.name === name;
const T0 = 1609459200;
const BASE = 56.25;
// The base-column position of a UTC instant, from the lattice.
const baseOf = (iso) => (Date.parse(iso) / 1000 - T0) / BASE;

const cells = (over = {}) => E.context.cellsKey({ measure: "volume", basis: "amount", transform: "value", workspace: "live", n: 4, m: 0, ...over });
const rows = (over = {}) => E.context.rowsKey({ measure: "volume", transform: "value", quality: "exact", period: "roll:90", rowSize: 3, workspace: "live", ...over });
const key = (ctx) => E.context.keyString(ctx);

test("the two key examples of API.md B.7, character for character, and the Ctx records behind them", () => {
  const c = E.context.cellsKey({ instrument: "BTC/USDT", measure: "volume", basis: "amount", transform: "value", workspace: "live", n: 4, m: 0 });
  assert.deepEqual(plain(c), {
    consumer: "cells", instrument: "BTC/USDT", measure: "volume", basis: "amount", unit: "usdt", transform: "value-log",
    formula: "cells.volume.amount@1", quality: "exact", workspace: "live", n: 4, m: 0,
  });
  assert.equal(key(c), "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n4m0");
  const r = E.context.rowsKey({ instrument: "BTC/USDT", measure: "volume", transform: "value", quality: "approx-rows:8", workspace: "live", period: "roll:90", rowSize: 3 });
  assert.deepEqual(plain(r), {
    consumer: "rows", instrument: "BTC/USDT", measure: "volume", basis: "period-amount-per-row", unit: "usdt", transform: "value-log",
    formula: "rows.volume.amount@1", quality: "approx-rows:8", workspace: "live", period: "roll:90", rowSize: 3,
  });
  assert.equal(key(r), "rows|BTC/USDT|volume|period-amount-per-row|usdt|value-log|rows.volume.amount@1|approx-rows:8|live|roll:90|m3");
  assert.ok(Object.isFrozen(c) && Object.isFrozen(r));
  // The defaults: BTC/USDT, live, exact.
  assert.equal(key(E.context.cellsKey({ measure: "volume", n: 4, m: 0 })), key(c));
});

test("Cells equality: the EFFECTIVE level, never the requested one; theme, token, selection, cutoff and src.id are not identity", () => {
  const base = cells();
  // A requested level that differs while the effective level is equal: the same key.
  assert.ok(E.context.equal(base, cells({ requestedN: 6, requestedM: 2 })));
  assert.ok(E.context.equal(base, E.context.cellsKey({ measure: "volume", basis: "amount", transform: "value", n: 4, m: 0, theme: "dark", token: "f3a1", selection: [1, 2, 3, 4], cutoff: 3214083, cut: 3214083, src: { id: "tile-9" }, generation: 12 })));
  // Coarser-than-requested: the display keys on the level it shows.
  assert.ok(!E.context.equal(base, cells({ n: 5 })));
  assert.ok(!E.context.equal(base, cells({ n: 3 })));
  assert.ok(!E.context.equal(base, cells({ m: 1 })));
  assert.equal(key(cells({ n: 12, m: 3 })), "cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n12m3");
  // Every identity field separates keys.
  const others = [
    cells({ measure: "trades" }), cells({ measure: "delta" }), cells({ measure: "size" }), cells({ measure: "path" }),
    cells({ basis: "intensity" }), cells({ transform: "rank" }), cells({ transform: "value", curve: "linear" }), cells({ workspace: "replay" }),
    cells({ instrument: "ETH/USDT" }), cells({ n: 5 }), cells({ m: 1 }),
  ];
  const seen = new Set([key(base)]);
  for (const o of others) {
    assert.ok(!E.context.equal(base, o), key(o));
    seen.add(key(o));
  }
  assert.equal(seen.size, others.length + 1, "all eleven keys are distinct");
  assert.ok(E.context.equal(base, base));
  assert.ok(E.context.equal(cells(), cells()));
  assert.ok(!E.context.equal(base, null));
  assert.ok(!E.context.equal(null, null));
});

test("bases and transforms: which spec fields make which key fields (effective values, DD-43, DD-82)", () => {
  // Volume, Trades and Delta take `basis`; Path takes `pathBasis`; the others have one basis and ignore both.
  assert.equal(cells({ measure: "volume", basis: "intensity" }).unit, "usdt-per-min-per-125usdt");
  assert.equal(cells({ measure: "trades", basis: "intensity" }).unit, "trades-per-min-per-125usdt");
  assert.equal(cells({ measure: "trades" }).unit, "trades");
  assert.equal(cells({ measure: "delta", basis: "intensity" }).formula, "cells.delta.intensity@1");
  assert.equal(cells({ measure: "size", basis: "intensity" }).basis, "mean", "Size has no Intensity: effective() coerced it, the raw preference must not change the key");
  assert.equal(cells({ measure: "size" }).formula, "cells.size.mean@1");
  assert.equal(cells({ measure: "path", basis: "intensity" }).basis, "spans", "Path reads pathBasis, not basis");
  assert.deepEqual(["spans", "usdt", "perMinute"].map((pathBasis) => cells({ measure: "path", pathBasis }).formula), ["cells.path.spans@1", "cells.path.usdt@1", "cells.path.perminute@1"]);
  assert.deepEqual(["spans", "usdt", "perMinute"].map((pathBasis) => cells({ measure: "path", pathBasis }).unit), ["row-spans", "usdt", "row-spans-per-min"]);
  assert.equal(cells({ measure: "dwell" }).formula, "cells.dwell.share@1");
  assert.equal(cells({ measure: "flow" }).formula, "cells.flow.share@1");
  assert.equal(cells({ measure: "flowtrades" }).formula, "cells.flowtrades.share@1");
  assert.equal(cells({ measure: "cascade" }).formula, "cells.cascade.log2@1");
  // Fixed measures: transform "fixed" whatever was passed; unbounded: value-log / value-linear / rank.
  for (const measure of ["dwell", "flow", "flowtrades", "cascade"]) {
    assert.equal(cells({ measure, transform: "rank" }).transform, "fixed", measure);
    assert.equal(cells({ measure, transform: "value", curve: "linear" }).transform, "fixed", measure);
  }
  assert.equal(cells({ transform: "value" }).transform, "value-log");
  assert.equal(cells({ transform: "value", curve: "log" }).transform, "value-log");
  assert.equal(cells({ transform: "value", curve: "linear" }).transform, "value-linear");
  assert.equal(cells({ transform: "value-linear" }).transform, "value-linear");
  assert.equal(cells({ transform: "value-log" }).transform, "value-log");
  assert.equal(cells({ transform: undefined }).transform, "value-log");
  assert.equal(cells({ transform: "rank", curve: "linear" }).transform, "rank", "the curve belongs to Value only");
  // A linear fit never overwrites a log fit: different keys.
  assert.notEqual(key(cells({ curve: "linear" })), key(cells()));
  // Rank on a signed measure is a caller bug (effective() coerces it): refused, not keyed.
  assert.throws(() => cells({ measure: "delta", transform: "rank" }), named("RangeError"));
});

test("Cells quality is `exact` and only `exact`: asking for another quality throws, and no spec ever yields `approximate`", () => {
  assert.equal(cells().quality, "exact");
  assert.throws(() => cells({ quality: "approximate" }), named("RangeError"));
  assert.throws(() => cells({ quality: "approx-start" }), named("RangeError"));
  assert.equal(cells({ quality: "exact" }).quality, "exact");
  const measures = ["volume", "trades", "delta", "size", "path", "dwell", "flow", "flowtrades", "cascade"];
  let count = 0;
  for (const measure of measures)
    for (const transform of ["value", "rank", "value-linear"])
      for (const workspace of ["live", "replay"]) {
        let ctx;
        try {
          ctx = cells({ measure, transform, workspace });
        } catch (e) {
          assert.equal(e.name, "RangeError", "only a rank request on a signed measure may be refused");
          assert.ok(measure === "delta" && transform === "rank");
          continue;
        }
        count++;
        assert.equal(ctx.quality, "exact");
        assert.ok(!key(ctx).includes("approx"));
      }
  assert.ok(count > 40);
  assert.throws(() => cells({ measure: "geometry" }), (e) => named("RangeError")(e) && /no calibration context/.test(e.message), "the outline mode has no mapping");
});

test("Rows key: measure, transform, quality, period identity and effective row size; NO n; the advancing endpoint is not in it", () => {
  const r = rows();
  assert.ok(!("n" in r) && !("m" in r));
  assert.ok(E.context.equal(r, rows({ n: 9, m: 4, span: [1, 2], end: 123456, CUT: 3214083, res: { end: 1 }, token: "t" })));
  assert.ok(!E.context.equal(r, rows({ rowSize: 4 })));
  assert.ok(!E.context.equal(r, rows({ period: "roll:30" })));
  assert.ok(!E.context.equal(r, rows({ quality: "approx-start" })));
  assert.ok(!E.context.equal(r, rows({ quality: "approx-rows:8" })));
  assert.ok(!E.context.equal(r, rows({ measure: "delta" })));
  assert.ok(!E.context.equal(r, rows({ measure: "time" })));
  assert.ok(!E.context.equal(r, rows({ transform: "rank" })));
  assert.ok(!E.context.equal(r, rows({ workspace: "replay" })));
  // The measures of E.measure.ROWS.
  assert.equal(rows({ measure: "delta" }).formula, "rows.delta.amount@1");
  assert.equal(rows({ measure: "time" }).formula, "rows.time.seconds@1");
  assert.equal(rows({ measure: "time" }).unit, "seconds");
  assert.equal(rows({ measure: "time", transform: "rank" }).transform, "rank");
  assert.equal(rows({ measure: "volume", transform: "rank" }).transform, "rank");
  assert.throws(() => rows({ measure: "delta", transform: "rank" }), named("RangeError"), "Rank is offered for Volume and Time at price only (DD-73)");
  // Relative volume follows the fixed rule (its own log2 domain), never the unbounded Rows rule.
  const rv = rows({ measure: "relvol", transform: "rank" });
  assert.equal(rv.transform, "fixed");
  assert.equal(rv.formula, "rows.relvol@2");
  assert.equal(rv.basis, "log2-ratio");
  // Quality grammar (DR-08): exact | approx-rows:<rowPrice> | approx-start.
  for (const q of ["exact", "approx-start", "approx-rows:2", "approx-rows:8", "approx-rows:1024"]) assert.equal(rows({ quality: q }).quality, q);
  for (const q of ["approximate", "approx-rows", "approx-rows:0", "approx-rows:-2", "approx-rows:1.5", "", 5, null]) assert.throws(() => rows({ quality: q }), named("RangeError"), String(q));
  assert.equal(rows({ quality: undefined }).quality, "exact");
  // Period grammar: exactly what periodIdentity writes.
  for (const p of ["roll:1", "roll:365", "cal:wk:2026-09-28", "cal:mo:2026-09-01", "cal:yr:2026-01-01", "day:2024-03-03", "all:2021-01-01"]) assert.equal(rows({ period: p }).period, p);
  for (const p of ["90d", "roll:", "roll:0", "cal:qtr:2026-01-01", "cal:mo:2026-9-1", "all", undefined, 90]) assert.throws(() => rows({ period: p }), named("RangeError"), String(p));
  assert.throws(() => rows({ measure: "geometry" }), named("RangeError"));
});

test("periodIdentity: rolling = duration, calendar = resolved start, since-day = anchor, all history = history start", () => {
  const id = E.context.periodIdentity;
  // Rolling identities are their duration in days; span[0] slides and is never identity.
  const rolling = { "1d": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365, "3y": 1095 };
  for (const [k, days] of Object.entries(rolling)) {
    assert.equal(id(k, [1000, 2000], {}), "roll:" + days, k);
    assert.equal(id(k, [9999, 20000], undefined), "roll:" + days, "a slid start is the same period");
    assert.equal(id(k, null, {}), "roll:" + days);
  }
  // The page's own table through env.days wins.
  assert.equal(id("30d", [0, 1], { days: () => 31 }), "roll:31");
  assert.throws(() => id("30d", [0, 1], { days: () => undefined }), named("RangeError"));
  assert.throws(() => id("30d", [0, 1], { days: () => 1.5 }), named("RangeError"));
  assert.throws(() => id("13d", [0, 1], {}), named("RangeError"));
  assert.throws(() => id("", [0, 1], {}), named("RangeError"));
  assert.throws(() => id(7, [0, 1], {}), named("TypeError"));
  // All history: the UTC date of T0 whatever the span.
  assert.equal(id("all", [0, 5], {}), "all:2021-01-01");
  assert.equal(id("all", [77, 3000000], {}), "all:2021-01-01");
  assert.equal(id("all", null, {}), "all:2021-01-01");
  assert.equal(id("all", null, { T0: Date.UTC(2022, 5, 7) / 1000 }), "all:2022-06-07");
  // A day chosen by date: its anchor.
  assert.equal(id("2024-03-03", [123, 456], {}), "day:2024-03-03");
  assert.equal(id("2024-02-29", null, {}), "day:2024-02-29", "a leap day");
  for (const bad of ["2023-02-29", "2024-13-01", "2024-00-10", "2024-04-31", "2024-4-3"]) assert.throws(() => id(bad, null, {}), named("RangeError"), bad);
});

test("calendar periods at the exact rollover edges: the identity flips at the resolved start and not before, and a growing period keeps it", () => {
  const id = E.context.periodIdentity;
  // The documented instants, re-derived from the lattice (these are the oracle's own numbers).
  const week = baseOf("2026-09-28T00:00:00Z");
  const month = baseOf("2026-10-01T00:00:00Z");
  const year = baseOf("2027-01-01T00:00:00Z");
  assert.equal(week, 3219456);
  assert.equal(month, 3224064);
  assert.equal(year, 3365376);
  assert.equal(new Date(Date.UTC(2026, 8, 28)).getUTCDay(), 1, "2026-09-28 is a Monday");
  // The resolved start is the span's first column: one column before the edge is the previous day's date.
  assert.equal(id("wk", [week, week + 1536 * 3], {}), "cal:wk:2026-09-28");
  assert.equal(id("wk", [week - 1, week + 5], {}), "cal:wk:2026-09-27");
  assert.equal(id("mo", [month, month + 100], {}), "cal:mo:2026-10-01");
  assert.equal(id("mo", [month - 1, month + 100], {}), "cal:mo:2026-09-30");
  assert.equal(id("yr", [year, year + 100], {}), "cal:yr:2027-01-01");
  assert.equal(id("yr", [year - 1, year + 100], {}), "cal:yr:2026-12-31");
  // The last column of the old week and the first of the new one are two different periods; every column
  // in between belongs to one and the same period: values change, the context does not (D4).
  const oldWeek = baseOf("2026-09-21T00:00:00Z");
  assert.equal(oldWeek, week - 7 * 1536);
  assert.notEqual(id("wk", [oldWeek, week], {}), id("wk", [week, week + 1], {}));
  for (const end of [week + 1, week + 100, week + 5 * 1536, week + 7 * 1536 - 1]) assert.equal(id("wk", [week, end], {}), "cal:wk:2026-09-28", "end " + end);
  // Each identity is what the calendar says, for many starts (Date.UTC oracle).
  for (const iso of ["2021-01-01", "2024-02-29", "2024-03-01", "2025-12-31", "2026-02-01", "2027-06-15"]) {
    const start = baseOf(iso + "T00:00:00Z");
    assert.equal(id("mo", [start, start + 1], {}), "cal:mo:" + iso);
  }
  // env.T0 / env.BASE override the recorded lattice.
  assert.equal(id("mo", [10, 20], { T0: Date.UTC(2030, 0, 1) / 1000, BASE: 86400 }), "cal:mo:2030-01-11");
  assert.throws(() => id("wk", null, {}), named("TypeError"));
  assert.throws(() => id("mo", [NaN, 5], {}), named("TypeError"));
});

test("a key is not a mapping id, and Cells and Rows never share a mapping though both are USDT amounts", () => {
  const ctxs = [cells(), cells({ measure: "trades" }), cells({ measure: "delta", n: 8, m: 1 }), rows(), rows({ measure: "time" }), rows({ measure: "delta", period: "cal:mo:2026-09-01" })];
  const ids = [
    E.scale.zeroOnly(false).id, E.scale.zeroOnly(true).id, E.scale.fixed("share-diverging").id, E.scale.fixed("log2-ratio").id, E.scale.fixed("unsigned-share").id,
    E.scale.manual({ kind: "value-log1p", U: 1000, k: 12.5 }).descriptor.id,
  ];
  for (const c of ctxs)
    for (const id of ids) {
      assert.notEqual(key(c), id);
      assert.equal(id.length, 16);
      assert.ok(key(c).length > 40 && key(c).includes("|"), "a key is a long, structured string; an id is 16 base64url characters");
    }
  // Cells Amount and Rows Amount: the same unit, the same class, but different contexts (different keys),
  // so they never share a fitted mapping implicitly; sharing exists only through an explicit lock (S1-105).
  const c = cells();
  const r = rows();
  assert.equal(c.unit, r.unit);
  assert.equal(E.context.compatClass(c), E.context.compatClass(r));
  assert.ok(!E.context.equal(c, r));
  assert.notEqual(key(c), key(r));
  assert.ok(E.scale.compat(c, r).ok, "compatible: a lock may hold one mapping for both, on its own key per channel");
});

test("keyString is injective (no field may contain the separator) and validates what it is given", () => {
  assert.throws(() => cells({ instrument: "BTC|USDT" }), named("RangeError"));
  assert.throws(() => cells({ instrument: "" }), named("RangeError"));
  assert.throws(() => cells({ instrument: "x".repeat(257) }), named("RangeError"));
  assert.throws(() => cells({ workspace: "both" }), named("RangeError"));
  for (const bad of [-1, 1.5, "4", NaN, undefined, null]) {
    assert.throws(() => cells({ n: bad }), named("RangeError"), "n = " + String(bad));
    assert.throws(() => cells({ m: bad }), named("RangeError"), "m = " + String(bad));
    assert.throws(() => rows({ rowSize: bad }), named("RangeError"), "rowSize = " + String(bad));
  }
  assert.throws(() => E.context.cellsKey(null), named("TypeError"));
  assert.throws(() => E.context.cellsKey({}), named("RangeError"));
  assert.throws(() => E.context.rowsKey("x"), named("TypeError"));
  assert.throws(() => E.context.keyString(null), named("TypeError"));
  assert.throws(() => E.context.keyString({ consumer: "tile" }), named("RangeError"));
  assert.throws(() => E.context.keyString({ ...plain(cells()), unit: "us|dt" }), named("RangeError"));
  assert.throws(() => E.context.keyString({ ...plain(cells()), n: -1 }), named("RangeError"));
  assert.throws(() => E.context.keyString({ ...plain(rows()), period: "90d" }), named("RangeError"));
  // Keys of every combination are pairwise distinct.
  const all = new Set();
  let total = 0;
  for (const measure of ["volume", "trades", "delta", "size", "path", "dwell", "flow", "flowtrades", "cascade"])
    for (const n of [0, 4, 12])
      for (const m of [0, 3])
        for (const workspace of ["live", "replay"])
          for (const curve of ["log", "linear"]) {
            const k = key(cells({ measure, n, m, workspace, curve }));
            total++;
            all.add(k);
          }
  // Fixed measures ignore the curve, so their log/linear pairs coincide: 4 fixed measures x 12 pairs.
  assert.equal(total - all.size, 4 * 12);
});

test("diff: the changed fields and the cause, in the order and wording of C.8", () => {
  const d = E.context.diff;
  const base = cells();
  assert.deepEqual(plain(d(base, cells())), { changed: [], cause: null });
  assert.deepEqual(plain(d(base, cells({ n: 5 }))), { changed: ["n"], cause: "resolution" });
  assert.deepEqual(plain(d(base, cells({ m: 1 }))), { changed: ["m"], cause: "resolution" });
  assert.deepEqual(plain(d(base, cells({ n: 5, m: 2 }))), { changed: ["n", "m"], cause: "resolution" });
  assert.deepEqual(plain(d(rows(), rows({ rowSize: 4 }))), { changed: ["rowSize"], cause: "resolution" });
  assert.deepEqual(plain(d(rows(), rows({ period: "cal:mo:2026-10-01" }))), { changed: ["period"], cause: "period" });
  assert.deepEqual(plain(d(rows(), rows({ rowSize: 4, period: "roll:30" }))), { changed: ["period", "rowSize"], cause: "resolution/period" }, "both");
  assert.deepEqual(plain(d(base, cells({ basis: "intensity" }))), { changed: ["basis", "unit", "formula"], cause: "basis" });
  assert.deepEqual(plain(d(base, cells({ transform: "rank" }))), { changed: ["transform"], cause: "transform" });
  assert.deepEqual(plain(d(base, cells({ curve: "linear" }))), { changed: ["transform"], cause: "transform" });
  assert.deepEqual(plain(d(rows(), rows({ quality: "approx-start" }))), { changed: ["quality"], cause: "quality" });
  assert.deepEqual(plain(d(base, cells({ workspace: "replay" }))), { changed: ["workspace"], cause: "workspace" });
  assert.deepEqual(plain(d(base, cells({ instrument: "ETH/USDT" }))), { changed: ["instrument"], cause: null }, "no cause the UI names");
  // A change of measure subsumes the basis, unit, formula and transform it brings along.
  assert.deepEqual(plain(d(base, cells({ measure: "flow" }))), { changed: ["measure", "basis", "unit", "transform", "formula"], cause: "measure" });
  assert.deepEqual(plain(d(base, cells({ measure: "trades" }))), { changed: ["measure", "unit", "formula"], cause: "measure" });
  assert.deepEqual(plain(d(base, cells({ measure: "trades", n: 6 }))), { changed: ["measure", "unit", "formula", "n"], cause: "resolution/measure" });
  // Cells versus Rows: only what is comparable has a cause.
  assert.equal(plain(d(cells(), rows())).changed[0], "consumer");
  // No previous context: nothing to disclose.
  assert.deepEqual(plain(d(null, base)), { changed: [], cause: null });
  assert.deepEqual(plain(d(base, undefined)), { changed: [], cause: null });
  // Pin promotes region and level: the Cells level and the Rows size change together.
  assert.equal(d(cells({ n: 4 }), cells({ n: 6, m: 1 })).cause, "resolution");
});

test("compatClass: family | transformKind | s/u | rank algorithm (C.8, DD-65)", () => {
  const cc = E.context.compatClass;
  assert.equal(cc(cells()), "amount.usdt|log1p|u|-", "the class DD-65 quotes");
  assert.equal(cc(rows()), "amount.usdt|log1p|u|-", "Rows Amount has the same class: the held key adds the channel");
  assert.equal(cc(cells({ curve: "linear" })), "amount.usdt|linear|u|-");
  assert.equal(cc(cells({ transform: "rank" })), "amount.usdt|rank|u|type7-257@1");
  assert.equal(cc(cells({ measure: "trades" })), "amount.trades|log1p|u|-");
  assert.equal(cc(cells({ measure: "delta" })), "delta.usdt|log1p|s|-");
  assert.equal(cc(cells({ basis: "intensity" })), "intensity.usdt|log1p|u|-");
  assert.equal(cc(cells({ measure: "trades", basis: "intensity" })), "intensity.trades|log1p|u|-");
  assert.equal(cc(cells({ measure: "delta", basis: "intensity" })), "intensity.delta|log1p|s|-");
  assert.equal(cc(cells({ measure: "size" })), "size.usdt-per-trade|log1p|u|-");
  assert.equal(cc(cells({ measure: "path" })), "path.spans|log1p|u|-");
  assert.equal(cc(cells({ measure: "path", pathBasis: "usdt" })), "path.usdt|log1p|u|-");
  assert.equal(cc(cells({ measure: "path", pathBasis: "perMinute" })), "path.perminute|log1p|u|-");
  assert.equal(cc(cells({ measure: "dwell" })), "fixed.share|fixed|u|-");
  assert.equal(cc(cells({ measure: "flow" })), "fixed.share|fixed|s|-");
  assert.equal(cc(cells({ measure: "flowtrades" })), "fixed.share|fixed|s|-");
  assert.equal(cc(cells({ measure: "cascade" })), "fixed.log2-ratio|fixed|s|-");
  assert.equal(cc(rows({ measure: "delta" })), "delta.usdt|log1p|s|-");
  assert.equal(cc(rows({ measure: "time" })), "time.seconds|log1p|u|-");
  assert.equal(cc(rows({ measure: "time", transform: "rank" })), "time.seconds|rank|u|type7-257@1");
  assert.equal(cc(rows({ measure: "relvol" })), "fixed.log2-ratio|fixed|s|-");
  // The level, the period, the workspace and the quality are not in the class: a lock holds across them.
  assert.equal(cc(cells({ n: 12, m: 3, workspace: "replay" })), cc(cells()));
  assert.equal(cc(rows({ period: "all:2021-01-01", rowSize: 0, quality: "approx-start" })), cc(rows()));
  // A Calibration is read through its ctx; a lens through its Cells base.
  assert.equal(cc({ ctx: cells(), desc: E.scale.zeroOnly(false) }), cc(cells()));
  assert.equal(cc(E.context.cellsKey({ measure: "volume", n: 4, m: 0, lens: { bounds: [1, 2, 3, 4], n: 6, m: 1 } })), cc(cells()));
  // A bare descriptor has no family: "-".
  assert.equal(cc(E.scale.manual({ kind: "value-log1p", U: 10, k: 2 }).descriptor), "-|log1p|u|-");
  assert.equal(cc(E.scale.manual({ kind: "value-log1p", signed: true, U: 10, k: 2 }).descriptor), "-|log1p|s|-");
  assert.equal(cc(E.scale.manual({ kind: "value-linear", U: 10 }).descriptor), "-|linear|u|-");
  assert.equal(cc(E.scale.fitRank([1, 2, 3]).descriptor), "-|rank|u|type7-257@1");
  assert.equal(cc(E.scale.fixed("share-diverging")), "-|fixed|s|-");
  assert.equal(cc(E.scale.zeroOnly(false)), "-|none|u|-");
  assert.throws(() => cc(null), named("TypeError"));
  assert.throws(() => cc({}), named("TypeError"));
  assert.throws(() => cc({ ...plain(cells()), formula: "cells.nothing.here@1" }), named("RangeError"));
  assert.throws(() => cc({ ...plain(cells()), transform: "sqrt" }), named("RangeError"));
});

test("compat: the same class and version is ok; each difference names its reason in the order of C.8", () => {
  const compat = E.scale.compat;
  assert.deepEqual(plain(compat(cells(), cells({ n: 12, m: 3 }))), { ok: true }, "across levels");
  assert.deepEqual(plain(compat(cells(), cells({ workspace: "replay" }))), { ok: true });
  assert.deepEqual(plain(compat(cells(), rows())), { ok: true }, "across consumers (a lock reuses explicitly)");
  assert.deepEqual(plain(compat(rows(), rows({ period: "cal:mo:2026-10-01", rowSize: 5 }))), { ok: true }, "across periods");
  assert.deepEqual(plain(compat(cells({ measure: "flow" }), cells({ measure: "flowtrades" }))), { ok: true }, "the two share measures are one class");
  const no = (a, b, reason) => assert.deepEqual(plain(compat(a, b)), { ok: false, reason }, reason);
  no(cells(), cells({ basis: "intensity" }), "amount vs intensity");
  no(cells({ measure: "trades" }), cells({ measure: "trades", basis: "intensity" }), "amount vs intensity");
  no(cells({ measure: "delta" }), cells({ measure: "delta", basis: "intensity" }), "amount vs intensity");
  no(cells(), cells({ measure: "trades" }), "different formula family");
  no(cells(), cells({ measure: "delta" }), "different formula family");
  no(cells(), cells({ measure: "path" }), "different formula family");
  no(cells({ measure: "path" }), cells({ measure: "path", pathBasis: "usdt" }), "different formula family");
  no(cells({ measure: "volume", basis: "amount" }), cells({ measure: "trades", basis: "intensity" }), "different formula family");
  no(cells(), rows({ measure: "time" }), "different formula family");
  no(cells({ measure: "dwell" }), cells({ measure: "flow" }), "signed vs unsigned");
  no(cells(), cells({ curve: "linear" }), "different transform");
  no(cells(), cells({ transform: "rank" }), "different transform");
  no(cells({ measure: "dwell" }), cells({ measure: "size" }), "different formula family");
  // A later formula version of the same family: same class, different version.
  const later = { ...plain(cells()), formula: "cells.volume.amount@2" };
  no(cells(), later, "different formula version");
  assert.deepEqual(plain(compat(later, later)), { ok: true });
  // A rank descriptor from another rank algorithm (imported from a later build).
  const a = { ctx: cells({ transform: "rank" }), desc: { ...plain(E.scale.fitRank([1, 2, 3]).descriptor) } };
  const b = { ctx: cells({ transform: "rank" }), desc: { ...plain(E.scale.fitRank([1, 2, 3]).descriptor), algorithm: "type7-513@1" } };
  assert.deepEqual(plain(compat(a, a)), { ok: true });
  no(a, b, "different rank algorithm");
  // Bare descriptors carry no family and no version: only signedness, transform and rank algorithm count.
  const log = E.scale.manual({ kind: "value-log1p", U: 10, k: 2 }).descriptor;
  const logSigned = E.scale.manual({ kind: "value-log1p", signed: true, U: 10, k: 2 }).descriptor;
  const lin = E.scale.manual({ kind: "value-linear", U: 10 }).descriptor;
  const rank = E.scale.fitRank([1, 2, 3]).descriptor;
  assert.deepEqual(plain(compat(log, E.scale.manual({ kind: "value-log1p", U: 99, k: 3 }).descriptor)), { ok: true });
  no(log, logSigned, "signed vs unsigned");
  no(log, lin, "different transform");
  no(log, rank, "different transform");
  assert.deepEqual(plain(compat(log, cells())), { ok: true }, "a bare descriptor against a context: the family is skipped");
  assert.throws(() => compat(null, cells()), named("TypeError"));
});

test("the Local-contrast lens context: its own key, outside the Cells key space, levels and bounds in the key", () => {
  const lens = E.context.cellsKey({ measure: "volume", basis: "amount", transform: "value", n: 4, m: 0, lens: { bounds: [3213312, 3214083, 656, 688], n: 6, m: 1 } });
  assert.equal(lens.consumer, "lens");
  assert.equal(lens.base.consumer, "cells");
  assert.equal(key(lens), "lens|cells|BTC/USDT|volume|amount|usdt|value-log|cells.volume.amount@1|exact|live|n4m0|b3213312,3214083,656,688|n6m1");
  assert.notEqual(key(lens), key(cells()));
  assert.ok(E.context.equal(lens, lens));
  const moved = E.context.cellsKey({ measure: "volume", n: 4, m: 0, lens: { bounds: [3213312, 3214083, 656, 689], n: 6, m: 1 } });
  assert.ok(!E.context.equal(lens, moved), "another lens region is another Local-contrast context");
  assert.deepEqual(plain(E.context.diff(lens, moved)), { changed: ["lensBounds"], cause: null });
  const finer = E.context.cellsKey({ measure: "volume", n: 4, m: 0, lens: { bounds: [3213312, 3214083, 656, 688], n: 7, m: 1 } });
  assert.deepEqual(plain(E.context.diff(lens, finer)), { changed: ["lensN"], cause: "resolution" });
  assert.throws(() => E.context.cellsKey({ measure: "volume", n: 4, m: 0, lens: { bounds: [1, 2, 3], n: 1, m: 1 } }), named("TypeError"));
  assert.throws(() => E.context.cellsKey({ measure: "volume", n: 4, m: 0, lens: { bounds: [1, 2, 3, NaN], n: 1, m: 1 } }), named("RangeError"));
  assert.throws(() => E.context.cellsKey({ measure: "volume", n: 4, m: 0, lens: { bounds: [1, 2, 3, 4], n: -1, m: 1 } }), named("RangeError"));
  assert.ok(Object.isFrozen(lens) && Object.isFrozen(lens.bounds));
});

// The catalogue this part repeats (API.md B.3) must agree with E.measure.FORMULAS once part 05 exists.
test("the formula table agrees with E.measure.FORMULAS (formula id, family, unit, signedness), when part 05 is loaded", { todo: E.measure ? false : "part 05-measure (package W1-B) is not in this build" }, () => {
  if (!E.measure) return;
  const F = E.measure.FORMULAS;
  // B.3 lists a family only for the unbounded formulas ("(fixed)" for the natural-domain ones), and the
  // signedness of a fixed one as prose; so compare what is a plain fact: the id, the unit, the family where
  // there is one and a boolean signedness where the catalogue states one.
  const check = (ctx, signed) => {
    const rec = F[ctx.formula];
    assert.ok(rec, "E.measure.FORMULAS has " + ctx.formula);
    assert.equal(rec.unit, ctx.unit, ctx.formula + " unit");
    if (typeof rec.family === "string" && !rec.family.startsWith("(")) assert.equal(E.context.compatClass(ctx).split("|")[0], rec.family, ctx.formula + " family");
    if (typeof rec.signed === "boolean" && signed !== undefined) assert.equal(rec.signed, signed, ctx.formula + " signedness");
  };
  for (const measure of ["volume", "trades", "delta"]) for (const basis of ["amount", "intensity"]) check(cells({ measure, basis }), measure === "delta");
  check(cells({ measure: "size" }), false);
  for (const pathBasis of ["spans", "usdt", "perMinute"]) check(cells({ measure: "path", pathBasis }), false);
  for (const measure of ["dwell", "flow", "flowtrades", "cascade"]) check(cells({ measure }));
  for (const measure of ["volume", "delta", "time", "relvol"]) check(rows({ measure }), measure === "delta" ? true : measure === "relvol" ? undefined : false);
});
