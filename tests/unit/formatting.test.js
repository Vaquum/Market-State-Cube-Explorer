"use strict";
// U41 (T-formatting): canonical numbers are independent of presentation formatting (S1-011, D1: "Displayed
// strings, locale and compact formatting never change a canonical value"). Swapping the formatter (compact
// k / M, exact digits, a locale formatter, Shift-exact) changes TEXT only: the mapping id, the LUT index,
// the readout's canonical fields, the legend's ticks, samples and canonical detail values stay identical.
//
// Oracles (none is the code under test):
//   1. The model of a legend built with the compact formatter is the reference; the same legend built with
//      each other formatter must have the SAME set of leaf paths, the SAME number, boolean and null leaves,
//      and may differ only in string leaves that belong to the text fields (`label`, `text`, `value`,
//      `detail`, `top`, `calibration`, `clipping`, `support`, `basis`, ..., listed below). The check is
//      structural and does not look at what the strings say.
//   2. A spy formatter records every (value, unit) it is asked to format: each value must be a canonical
//      number of the descriptor or a tick (0, k, U, -k, -U, ...), never a rounded or scaled one.
//   3. The design's mapping id for the vector descriptor, 3s_XdONgi8CSqyOl (API.md B.5), and shortest
//      round-trip decimals from `String(x)`/`Number(text)` (the language's own definition).
//   4. The Intl / Number.prototype.toLocaleString monkeypatch: the test replaces the locale machinery of ITS
//      realm while the pipeline runs. When the module is evaluated in a vm context (ENCODING_PARTS_DIR) it has
//      its own built-ins and the patch cannot reach it, so there the assertion is the weaker "no dependence on
//      the formatter argument"; on the assembled file (the normal `npm test`) both halves are real.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const plain = (x) => JSON.parse(JSON.stringify(x));

const GEOM = { BASE: 56.25, PR: 125 };
const U = 26791234.56;
const K = 48211.3;
const LOGU = E.scale.manual({ kind: "value-log1p", signed: false, U, k: K }).descriptor;
const LOGS = E.scale.manual({ kind: "value-log1p", signed: true, U: 1204551.25, k: 8830.5 }).descriptor;
const LUT = E.lut.build("slate2", "light");

const frame = (mode, desc, extra = {}) =>
  E.readout.cellsFrame(
    Object.assign(
      {
        mode,
        basis: mode === "flow" || mode === "dwell" ? "share" : mode === "cascade" ? "log2" : "amount",
        level: { n: 4, m: 1 },
        bounds: [3200, 3264, 400, 416],
        cut: 3264,
        end: 3300,
        geom: GEOM,
        CUT: 3300,
        mapping: mode === "flow" || mode === "dwell" || mode === "cascade" ? desc : { state: "ok", desc, policy: "explore", origin: "fit" },
        lut: LUT,
      },
      extra,
    ),
  );

// ---- the formatters ----------------------------------------------------------------------------------------------

const compact = (v, unit) => {
  if (unit === "share") return String(Number((v * 100).toFixed(1))) + "%";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + " M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + " k";
  return String(Number(v.toPrecision(3)));
};
const exact = (v) => String(v);
const german = (v, unit) => (unit === "share" ? new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 2 }).format(v) : new Intl.NumberFormat("de-DE", { maximumSignificantDigits: 9 }).format(v));
const locale = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });
const silly = () => "#";
const FORMATTERS = { compact, exact, german, locale, silly };

// Leaves of a model by path. A JSON-safe model has only strings, numbers, booleans, null, arrays and objects.
function leaves(node, path, out) {
  if (Array.isArray(node)) node.forEach((x, i) => leaves(x, path + "[" + i + "]", out));
  else if (node !== null && typeof node === "object") for (const k of Object.keys(node)) leaves(node[k], path ? path + "." + k : k, out);
  else out.set(path, node);
  return out;
}

// The string fields a formatter may legitimately change: what is displayed, never what is canonical. The
// `value` of a DETAIL is displayed text (its `canonical` is the number); `value` of a TICK is the number
// itself and must not change, so the set is by full path pattern.
const TEXT_PATH = [
  /\.label$/,
  /^summary\.(top|calibration|clipping|support|basis|unit|transform|policy|measure)$/,
  /^details\[\d+\]\.(value|label)$/,
  /^warnings\[\d+\]\.detail$/,
];

function assertTextOnly(reference, other, name) {
  const a = leaves(plain(reference), "", new Map());
  const b = leaves(plain(other), "", new Map());
  assert.deepEqual([...b.keys()], [...a.keys()], `${name}: the same leaf paths`);
  let changedText = 0;
  for (const [path, value] of a) {
    const v = b.get(path);
    if (Object.is(v, value)) continue;
    assert.ok(TEXT_PATH.some((re) => re.test(path)), `${name}: ${path} changed (${JSON.stringify(value)} -> ${JSON.stringify(v)}) and is not a text field`);
    assert.equal(typeof value, "string", `${name}: ${path} is text`);
    changedText++;
  }
  return changedText;
}

// ---- the tests ---------------------------------------------------------------------------------------------------------

test("T-formatting: swapping the formatter changes the legend's TEXT only: ticks, samples, positions and canonical values are identical", () => {
  const z = { c: 201, r: 203, v: K, bv: 10, ct: 2, bt: 1 };
  const inputs = [
    ["volume", () => frame("volume", LOGU), { counts: { "clip-high": 4 } }],
    ["delta", () => frame("delta", LOGS), {}],
    ["flow", () => frame("flow", E.scale.fixed("share-diverging")), {}],
    ["dwell", () => frame("dwell", E.scale.fixed("unsigned-share")), {}],
    ["cascade", () => frame("cascade", E.scale.fixed("log2-ratio")), {}],
  ];
  for (const [name, make, opts] of inputs) {
    const f = make();
    const reference = E.legend.build(f, { rangeExceeded: true, lowDiscrimination: null, shares: { marks: 0.1234567, area: 0.3, low: 0, high: 0 } }, compact, opts);
    let differing = 0;
    for (const [fname, fmt] of Object.entries(FORMATTERS)) {
      const other = E.legend.build(f, { rangeExceeded: true, lowDiscrimination: null, shares: { marks: 0.1234567, area: 0.3, low: 0, high: 0 } }, fmt, opts);
      differing += assertTextOnly(reference, other, `${name}/${fname}`);
      // The canonical values of the details are the same numbers whatever the text says.
      assert.deepEqual(plain(other.details.map((d) => d.canonical)), plain(reference.details.map((d) => d.canonical)), `${name}/${fname} canonical`);
      assert.deepEqual(plain(other.bar.ticks.map((t) => [t.t, t.p, t.value, t.kind])), plain(reference.bar.ticks.map((t) => [t.t, t.p, t.value, t.kind])));
      assert.deepEqual(plain(other.bar.samples), plain(reference.bar.samples));
      // The same stamp for the DOM guard: a formatter is not one of its fields.
      assert.equal(E.legend.keyOf({ mappingId: other.summary.scaleId, appearanceId: other.summary.appearance, state: other.state }), E.legend.keyOf({ mappingId: reference.summary.scaleId, appearanceId: reference.summary.appearance, state: reference.state }));
    }
    assert.ok(differing > 0, `${name}: the formatters really did change some text`);
    // And the frame it came from is untouched: one readout before and after every build.
    assert.equal(JSON.stringify(f.readout(z)), JSON.stringify(make().readout(z)));
  }
});

test("T-formatting: the mapping id, the LUT index and the readout's canonical fields are identical whichever formatter the page uses", () => {
  const f = frame("volume", LOGU);
  const z = { c: 201, r: 203, v: 123456.789, bv: 1, ct: 3, bt: 1 };
  const before = f.readout(z);
  const out = {};
  f.encode(z, out);
  const snap = { idx: out.idx, css: out.css, t: out.t, id: f.mappingId };
  for (const fmt of Object.values(FORMATTERS)) {
    E.legend.build(f, null, fmt, {});
    const after = f.readout(z);
    assert.equal(JSON.stringify(after), JSON.stringify(before), "the record does not depend on any formatter");
    f.encode(z, out);
    assert.deepEqual({ idx: out.idx, css: out.css, t: out.t, id: f.mappingId }, snap);
  }
  assert.equal(snap.id, "3s_XdONgi8CSqyOl", "the design's mapping id");
  assert.equal(E.scale.id(LOGU), snap.id);
  assert.equal(before.scale.id, snap.id);
  assert.equal(before.coordinate.idx, snap.idx);
  assert.equal(before.observed.value, 123456.789, "Shift-exact, compact or localised: the observed amount is one number");
});

test("T-formatting: the formatter is only ever asked about canonical numbers (0, the ticks, the calibration), never a rounded or scaled value", () => {
  const asked = [];
  const spy = (v, unit) => {
    asked.push([v, unit]);
    return String(v);
  };
  E.legend.build(frame("volume", LOGU), { rangeExceeded: true, lowDiscrimination: "low", shares: { marks: 0.3, area: 0.4, low: 0.95, high: 0 } }, spy, { counts: { "clip-high": 2 } });
  assert.ok(asked.length > 4, "it was used");
  const canonical = new Set([0, K, U, 0.3, 0.4, 0.95]);
  for (const [v, unit] of asked) {
    assert.equal(typeof v, "number");
    assert.ok(Number.isFinite(v), "only finite numbers are formatted");
    assert.ok(canonical.has(v), `formatted ${v} (${unit}) is not a canonical value of this scale`);
    assert.equal(typeof unit, "string");
  }
  // The units it is given are the catalogue's unit ids and the word "share" for fractions.
  assert.ok(asked.some(([v, unit]) => v === U && unit === "usdt"));
  assert.ok(asked.some(([v, unit]) => v === 0.3 && unit === "share"));
  // A formatter that answers a number or an object is turned into text; nothing throws on it.
  const odd = E.legend.build(frame("volume", LOGU), null, (v) => v * 2, {});
  assert.equal(odd.bar.ticks[2].label, String(U * 2));
  assert.equal(odd.bar.ticks[2].value, U, "and the tick's value is still the canonical U");
});

test("T-formatting: changing the locale machinery of the realm changes no canonical result", () => {
  const z = { c: 201, r: 203, v: 987654.321, bv: 3, ct: 4, bt: 1 };
  const f = frame("volume", LOGU);
  const ref = { readout: JSON.stringify(f.readout(z)), ticks: JSON.stringify(E.legend.build(f, null, exact, {}).bar.ticks), id: E.scale.id(LOGU), canonical: E.scale.canonical(LOGU) };
  // `Intl.NumberFormat.prototype.format` is an accessor: keep its descriptor and put it back.
  const formatDescriptor = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format");
  const saved = { toLocaleString: Number.prototype.toLocaleString, NumberFormat: Intl.NumberFormat };
  try {
    Number.prototype.toLocaleString = function () {
      return "1.234,5";
    };
    Object.defineProperty(Intl.NumberFormat.prototype, "format", { configurable: true, get: () => () => "1.234,5" });
    const patched = frame("volume", E.scale.manual({ kind: "value-log1p", signed: false, U, k: K }).descriptor);
    assert.equal(JSON.stringify(patched.readout(z)), ref.readout);
    assert.equal(JSON.stringify(E.legend.build(patched, null, exact, {}).bar.ticks), ref.ticks, "ticks do not use the locale");
    assert.equal(E.scale.id(LOGU), ref.id);
    assert.equal(E.scale.canonical(LOGU), ref.canonical);
    // A formatter built on the (patched) locale changes the text, which is exactly where it is allowed to.
    const viaLocale = E.legend.build(patched, null, (v) => v.toLocaleString(), {});
    assert.equal(typeof viaLocale.bar.ticks[2].label, "string");
    assert.equal(viaLocale.bar.ticks[2].value, U);
  } finally {
    Number.prototype.toLocaleString = saved.toLocaleString;
    Object.defineProperty(Intl.NumberFormat.prototype, "format", formatDescriptor);
  }
  assert.equal(Intl.NumberFormat, saved.NumberFormat);
});

test("T-formatting: persisted constants are shortest round-trip decimals in the canonical text, exactly as the language prints them", () => {
  const cases = [
    { U: 26791234.56, k: 48211.3 },
    { U: 1234567.891011, k: 0.1 + 0.2 },
    { U: 1 / 3, k: 1 / 7 },
    { U: 123456789.12345679, k: 1e-3 },
  ];
  for (const { U: u, k } of cases) {
    const desc = E.scale.manual({ kind: "value-log1p", signed: false, U: u, k }).descriptor;
    const text = E.scale.canonical(desc);
    assert.ok(text.includes('"U":' + String(u)), `U ${u} in ${text}`);
    assert.ok(text.includes('"k":' + String(k)), `k ${k} in ${text}`);
    const parsed = JSON.parse(text);
    assert.equal(parsed.params.U, u, "round-trips bit for bit");
    assert.equal(parsed.params.k, k);
    assert.equal(Number(String(u)), u);
    // The text carries no locale separators, no thousands grouping and no percent signs.
    assert.ok(!/\d,\d|%|\s/.test(text), "no thousands grouping, percent sign or whitespace: " + text);
  }
  // A fitted descriptor's own numbers: the canonical text of a rank carries its knots as round-trip decimals.
  const rank = E.scale.fitRank([0.1 + 0.2, 1 / 3, 2 / 3, 1.1, 7.123456789012345]).descriptor;
  const parsed = JSON.parse(E.scale.canonical(rank));
  assert.deepEqual(plain(parsed.params.knots), plain(rank.params.knots));
  for (const knot of rank.params.knots) assert.ok(E.scale.canonical(rank).includes(String(knot)), `knot ${knot}`);
});

test("T-formatting: no encoder function takes a formatter argument; only the legend and the typed-result description do", () => {
  const paramsOf = (fn) => {
    const m = /^[^(]*\(([^)]*)\)/.exec(fn.toString());
    return m === null ? [] : m[1].split(",").map((s) => s.trim().replace(/=.*$/, "").trim()).filter(Boolean);
  };
  const f = frame("volume", LOGU);
  for (const [name, fn] of [["cells encode", f.encode], ["cells readout", f.readout], ["E.measure.cellValue", E.measure.cellValue], ["E.scale.apply", E.scale.apply], ["E.scale.index", E.scale.index], ["E.scale.plan", E.scale.plan]]) {
    assert.ok(!paramsOf(fn).some((p) => /fmt|format|locale|intl/i.test(p)), `${name}(${paramsOf(fn).join(", ")})`);
  }
  assert.equal(E.readout.cellsFrame.length, 1);
  assert.equal(E.readout.rowsFrame.length, 1);
  assert.equal(E.readout.paneFrame.length, 1);
  assert.ok(f.encode.length <= 3);
  // Every public function of the module that has a formatter parameter: the two documented ones.
  const takers = [];
  for (const ns of Object.keys(E)) {
    const obj = E[ns];
    if (obj === null || typeof obj !== "object") continue;
    for (const fn of Object.keys(obj)) if (typeof obj[fn] === "function" && paramsOf(obj[fn]).some((p) => /^fmt$|format/i.test(p))) takers.push(ns + "." + fn);
  }
  assert.deepEqual(takers.sort(), ["legend.build", "result.describe"]);
  // The frame functions' source never mentions a formatter or the locale (comments and strings aside is not needed: they do not).
  for (const fn of [f.encode, f.readout, E.readout.cellsFrame]) assert.ok(!/toLocale|Intl\.|\bfmt\b/.test(fn.toString()), "no formatter in the frame code");
});

test("T-formatting: E.result.describe formats a finite value through the caller's formatter and leaves the number alone", () => {
  const typed = { tag: "finite", value: 1234567.891 };
  const a = E.result.describe(typed, compact);
  const b = E.result.describe(typed, exact);
  assert.equal(a.short, "1.2 M");
  assert.equal(b.short, "1234567.891");
  assert.equal(typed.value, 1234567.891);
  assert.notEqual(a.short, b.short);
  // Non-values do not involve the formatter at all.
  const nv = { tag: "undefined", denominator: "trades", reason: "no trades" };
  assert.equal(E.result.describe(nv, compact).short, E.result.describe(nv, silly).short);
});
