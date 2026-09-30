"use strict";
// tests/support/profiles.js (H2): the synthetic trade streams the fake cube can serve (TESTPLAN 4.4).
//
// Every profile is SYNTHETIC: the pack's `source` says so (DR-25, DD-T09), no profile is market
// history, and nothing here is ever an expected value for another test: the derived statistics
// (trade count, cell counts, the hash of the decoded recent block) are only pinned in
// tests/fixtures/profiles/pins.json so that a change of the generator is noticed (self-pin).
//
// Walk profiles (mini, standard, deep, bench): a log random walk from 25,000 USDT with per-trade sd
// 2e-4, quantities from a seeded lognormal, taker-buy probability 0.5 drifting slowly, and on a
// seeded fraction of trades a `count` burst so compact-count formatting has something to format.
// Gaps between trades are exponential; a sparse stretch (mean gap 20 min) leads into a dense
// tail (mean gap 15 s), which is how a week of base columns fills while history stays cheap.
// `uniform` is closed-form (one trade every 1.25 s, DD-T11); `skew` has a flat price band and a
// 200-fold jump in quantity half way.
const fs = require("node:fs");
const path = require("node:path");
const { mulberry32, normal, subSeed } = require("./rng.js");
const { TradeStore } = require("./trades.js");
const { T0, BASE_MS, DAY } = require("./wire.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EPOCH_MS = T0 * 1000;
const DAY_MS = DAY * BASE_MS;
const MINUTE_MS = 60000;

const DEFAULT_SEED = 20260924;
const DEFAULT_CUTOFF = "2026-09-24T12:02:00.000000Z";
const START_PRICE = 25000; // USDT

// Parameters of the generated profiles. `days` counts back from the cutoff; `startIso` fixes the start instead.
const PROFILES = {
  mini: { kind: "walk", days: 2, sparseGapMs: null, denseDays: 2, denseGapMs: 15000 },
  standard: { kind: "walk", days: 420, sparseGapMs: 1200000, denseDays: 45, denseGapMs: 15000 },
  deep: { kind: "walk", startIso: "2021-01-01T00:00:00Z", sparseGapMs: 1200000, denseDays: 45, denseGapMs: 15000 },
  // bench: the standard profile; the seed and cutoff of the D12 fake-live cases come from
  // tools/benchmark/navigation.v1.json and are passed as options.
  bench: { kind: "walk", days: 420, sparseGapMs: 1200000, denseDays: 45, denseGapMs: 15000 },
  uniform: { kind: "uniform", days: 2 },
  skew: { kind: "skew", days: 6 },
};

const msOfIso = (iso) => Date.parse(iso) - EPOCH_MS;

// A seeded walker: the price path, the taker-buy drift and the burst draws of one stream. It draws a fixed number of
// randoms per trade in a fixed order, so equal seeds give equal streams.
class Walker {
  constructor(seed, { logp = Math.log(START_PRICE), pbuy = 0.5 } = {}) {
    this.rng = mulberry32(seed);
    this.logp = logp;
    this.center = Math.log(START_PRICE);
    this.pbuy = pbuy;
  }

  // run(from, to, gapMs, {revert, qty}): trades with times in (from, to] as objects, the qty multiplier `qty(t)`.
  run(from, to, gapMs, { revert = 0, qty = () => 1 } = {}) {
    const out = [];
    const next = this.rng;
    let t = from;
    for (;;) {
      t += Math.max(1, Math.round(-gapMs * Math.log(1 - next())));
      if (t > to) break;
      this.logp += -revert * (this.logp - this.center) + 2e-4 * normal(next);
      this.pbuy = Math.min(0.65, Math.max(0.35, this.pbuy + 0.01 * normal(next)));
      const btc = Math.exp(Math.log(0.02) + 1.2 * normal(next)) * qty(t);
      const buy = next() < this.pbuy;
      const burst = next() < 0.05 ? 1 + Math.floor(next() * 400) : 1;
      out.push({
        t, price: Math.max(1, Math.round(Math.exp(this.logp) * 100)), qty: Math.max(1, Math.round(btc * 1e8)), buy, count: burst,
      });
    }
    return out;
  }
}

// The uniform grid of DD-T11: trade k (k = t / 1250 ms) sits in base row 200 + (k mod 5) at the row's centre price, a constant
// 0.004 BTC, alternating taker side. A base column is 45 grid steps, so every full base cell holds exactly 9 trades.
function uniformTrades(fromMs, toMs) {
  const out = [];
  for (let k = Math.floor(fromMs / 1250) + 1; k * 1250 <= toMs; k++) {
    out.push({ t: k * 1250, price: (200 + (k % 5)) * 12500 + 6250, qty: 400000, buy: k % 2 === 0, count: 1 });
  }
  return out;
}

const labelOf = (name, seed) => `SYNTHETIC fixture ${name} seed ${seed} - not market data`;

// Generated stores are memoised per process (DD-T08): the template is never handed out, only clones of it.
const memo = new Map();

function generate(name, spec, seed, cutoffMs) {
  const store = new TradeStore();
  if (spec.kind === "uniform") {
    const from = Math.floor((cutoffMs - spec.days * DAY_MS) / BASE_MS) * BASE_MS; // column aligned, so no column is short
    store.append(uniformTrades(from - 1, cutoffMs));
    return store;
  }
  const dense = cutoffMs - spec.denseDays * DAY_MS;
  const start = spec.startIso ? msOfIso(spec.startIso) : cutoffMs - spec.days * DAY_MS;
  const walker = new Walker(seed);
  if (spec.kind === "skew") {
    const half = cutoffMs - (spec.days / 2) * DAY_MS;
    store.append(walker.run(start, cutoffMs, 15000, { revert: 0.02, qty: (t) => (t > half ? 200 : 1) }));
    return store;
  }
  if (spec.sparseGapMs && dense > start) store.append(walker.run(start, dense, spec.sparseGapMs));
  store.append(walker.run(Math.max(start, dense), cutoffMs, spec.denseGapMs));
  return store;
}

// The trades an advance() adds after `fromMs` up to `toMs`, continuing the stream of the store: a fresh seeded walker per
// advance (seeded by the profile seed and the time it starts at), starting from the last price.
function extension(name, spec, seed) {
  if (spec.kind === "uniform") return (store, fromMs, toMs) => store.append(uniformTrades(fromMs, toMs));
  return (store, fromMs, toMs) => {
    const last = store.length ? store.price[store.length - 1] / 100 : START_PRICE;
    const walker = new Walker(subSeed(seed, `advance:${fromMs}`), { logp: Math.log(last) });
    if (spec.kind === "skew") walker.center = Math.log(last);
    store.append(walker.run(fromMs, toMs, spec.kind === "skew" ? 15000 : spec.denseGapMs, spec.kind === "skew" ? { revert: 0.02, qty: () => 200 } : {}));
  };
}

// The archive boundary the pack reports: by default the start of the cutoff's UTC day (what the recorded page's model note
// assumes for 2026-09-24), null when the caller wants no provisional edge at all.
function defaultCanonical(cutoffMs) {
  return Math.floor(cutoffMs / DAY_MS) * DAY_MS;
}

// A fixture file of hand-authored trades: tests/fixtures/trades/<name>.json
//   { "trades": [{t_ms, price, qty, takerBuy, count?}], "gaps": [[t0, t1]], "cutoffIso": "...", "canonicalThroughIso": "..."|null }
function loadFixture(name) {
  const file = path.join(REPO_ROOT, "tests", "fixtures", "trades", `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`micro:${name}: ${path.relative(REPO_ROOT, file)} does not exist (hand-authored micro-sequences belong to package H3)`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// resolveProfile(profile, {seed, cutoff, canonicalThrough}) -> {name, seed, label, cutoffMs, canonicalThroughMs, store, extend}
// `profile` is a name of the table, "micro:<name>", or {trades, cutoffIso, canonicalThroughIso?, gaps?, name?}. The returned store is the
// caller's own (a clone of the memoised template).
function resolveProfile(profile, options = {}) {
  let name, spec, seed, cutoffMs, canonicalThroughMs, store, extend, gaps = [];
  const cutoffOf = (iso) => {
    const ms = msOfIso(iso);
    if (!Number.isFinite(ms)) throw new RangeError(`cutoff ${iso} is not a time`);
    return ms - (((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS); // the cube's cutoff is a minute edge: snap down
  };
  if (typeof profile === "string" && PROFILES[profile]) {
    name = profile;
    spec = PROFILES[name];
    seed = options.seed ?? DEFAULT_SEED;
    cutoffMs = cutoffOf(options.cutoff ?? DEFAULT_CUTOFF);
    const key = `${name}|${seed}|${cutoffMs}`;
    if (!memo.has(key)) memo.set(key, generate(name, spec, seed, cutoffMs));
    store = memo.get(key).clone();
    extend = extension(name, spec, seed);
  } else {
    let fixture;
    if (typeof profile === "string" && profile.startsWith("micro:")) {
      name = profile;
      fixture = loadFixture(profile.slice("micro:".length));
    } else if (profile && typeof profile === "object") {
      name = profile.name ?? "custom";
      fixture = profile;
    } else {
      throw new RangeError(`unknown profile ${JSON.stringify(profile)}: use ${Object.keys(PROFILES).join(", ")}, micro:<name> or {trades, cutoffIso}`);
    }
    seed = options.seed ?? fixture.seed ?? 0;
    if (!fixture.cutoffIso) throw new RangeError(`profile ${name} has no cutoffIso`);
    cutoffMs = cutoffOf(options.cutoff ?? fixture.cutoffIso);
    store = TradeStore.fromList(fixture.trades);
    gaps = fixture.gaps ?? [];
    store.setGaps(gaps);
    const last = store.length ? store.t[store.length - 1] : -1;
    if (last > cutoffMs) throw new RangeError(`profile ${name}: a trade at ${last} ms is after the cutoff ${cutoffMs} ms`);
    extend = () => {}; // hand-authored streams grow only through advance({trades})
    if (fixture.canonicalThroughIso !== undefined && options.canonicalThrough === undefined) options = { ...options, canonicalThrough: fixture.canonicalThroughIso };
  }
  const canonical = options.canonicalThrough;
  if (canonical === undefined) canonicalThroughMs = defaultCanonical(cutoffMs);
  else if (canonical === null) canonicalThroughMs = null;
  else canonicalThroughMs = Math.min(cutoffOf(canonical), cutoffMs);
  return { name, seed, label: labelOf(name, seed), cutoffMs, canonicalThroughMs, store, extend };
}

module.exports = {
  PROFILES, DEFAULT_SEED, DEFAULT_CUTOFF, START_PRICE, EPOCH_MS, DAY_MS, MINUTE_MS, REPO_ROOT,
  resolveProfile, labelOf, msOfIso, uniformTrades, Walker,
};
