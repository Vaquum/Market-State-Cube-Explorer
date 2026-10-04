"use strict";
// tests/support/cube-fake.js (H2): a zero-dependency Node http server that fakes the BRIDGE's HTTP boundary
// (tools/cube_bridge.py), for the browser tests, the benchmark and manual work. Test-only: never copied into the image or
// the deploy payload.
//
//   const { startFake } = require("./cube-fake.js");
//   const fake = await startFake({ profile: "mini" });      // fake.url, fake.advance(...), fake.on(...).fail(...), fake.log()
//   node tests/support/cube-fake.js --profile standard --port 8790      // CLI, with the /__fake/* control API
//
// What is faked, and what is not: everything the page can see of the bridge (routes, query validation, error bodies, packs and
// deltas, held packs, pins and 409 cube_changed, the open column from the pack's own snapshot, motion and bars ending at the last
// closed column) follows bridge-model.js, which follows tools/cube_bridge.py function by function. The data behind it is a seeded
// SYNTHETIC trade store (pack.source says so); TESTPLAN 4.7 lists what this cannot validate (Origo, latency, real magnitudes).
//
// Determinism: no Date.now() and no Math.random() in anything the page can read; age, quiet and next come from injected values,
// the token is a hash of (cutoff, pins, salt). Only the request log carries elapsed real time (ms) and it is never compared.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const model = require("./bridge-model.js");
const wire = require("./wire.js");
const { resolveProfile, msOfIso, MINUTE_MS, REPO_ROOT } = require("./profiles.js");

const { ValueError, CubeChanged, MarketStateError, PROTOCOL, OUTDATED, BAR_LEVELS, MAX_COLUMNS, MAX_TIME_EXPONENT, queryArgs, integer, level, rectangle } = model;

const VENDOR = new Map([["d3.min.js", "application/javascript"], ["D3-LICENSE", "application/octet-stream"]]);

const floorMinute = (ms) => ms - (((ms % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The slot a request would take in the bridge: reads with measures (motion, bars) hold the motion slot, the other reads the cube slot, the
// poll neither. The page keeps one read per slot in flight, so two overlapping in one slot is a page bug (or a test gate left open).
function slotOf(pathname, args) {
  if (pathname === "/cube/pack") return "poll";
  if (pathname === "/cube/motion" || pathname === "/cube/bars") return "motion";
  if ((pathname === "/cube/tile" || pathname === "/cube/query") && args.motion?.[0] === "1") return "motion";
  if (pathname.startsWith("/cube/")) return "cube";
  return "page";
}

// A gate holds the requests a rule matches until the test releases them: the deterministic replacement for sleeps (the page's 200 ms
// debounce and the in-flight order cannot be raced reliably with delays).
class Gate {
  constructor() {
    this.count = 0; // requests that have arrived at the gate, ever
    this.queue = []; // resolvers of the requests being held, oldest first
    this.waiters = []; // {need, resolve} for arrived()
  }

  get held() {
    return this.queue.length;
  }

  // arrived(n = 1): resolves once n requests have reached the gate (in total, held or released).
  arrived(need = 1) {
    if (this.count >= need) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ need, resolve }));
  }

  hold() {
    this.count++;
    const decision = new Promise((resolve) => this.queue.push(resolve));
    this.waiters = this.waiters.filter((w) => (this.count >= w.need ? (w.resolve(), false) : true));
    return decision;
  }

  // release(k): let the k oldest held requests through (all of them when k is omitted); later arrivals are held again.
  release(k = this.queue.length) {
    for (const resolve of this.queue.splice(0, k)) resolve({ go: true });
  }

  // fail(status, body): answer the held requests with a failure instead of the data.
  fail(status = 500, body = { error: "injected failure" }, k = this.queue.length) {
    for (const resolve of this.queue.splice(0, k)) resolve({ go: false, status, body });
  }

  // open(): release everything held and stop holding.
  open() {
    this.disarmed = true;
    this.release();
  }
}

// A fault rule: which requests (route pattern, optional query predicate, skip the first `after`, at most `times`) and what happens to them.
class Rule {
  constructor(fake, { route, when = null, times = Infinity, after = 0 }) {
    this.fake = fake;
    this.route = route;
    this.when = when;
    this.times = times;
    this.after = after;
    this.kind = null; // set by one of the terminal methods below; a rule without one does nothing
    this.seen = 0; // matching requests so far
    this.hits = 0; // requests the rule acted on
  }

  matches(pathname, query) {
    if (this.kind === null) return false;
    if (this.route instanceof RegExp ? !this.route.test(pathname) : this.route !== pathname) return false;
    if (this.when && !this.when(query)) return false;
    this.seen++;
    if (this.seen <= this.after || this.hits >= this.times) return false;
    this.hits++;
    return true;
  }

  delay(ms) { this.kind = "delay"; this.ms = ms; return this; }
  fail({ status = 500, body = { error: "injected failure" } } = {}) { this.kind = "fail"; this.status = status; this.body = body; return this; }
  hang() { this.kind = "hang"; return this; }
  drop() { this.kind = "drop"; return this; }
  empty() { this.kind = "empty"; return this; }
  // malformed("magic" | "gzip" | "base64" | "json" | "short"): the answer, corrupted the way the page has a reaction to (see corrupt below).
  malformed(how) {
    if (!["magic", "gzip", "base64", "json", "short"].includes(how)) throw new RangeError(`malformed(${how}): use magic, gzip, base64, json or short`);
    this.kind = "malformed";
    this.how = how;
    return this;
  }
  gate() { this.kind = "gate"; this.gateObject = new Gate(); return this.gateObject; }
  remove() { this.fake.rules = this.fake.rules.filter((r) => r !== this); }
}

// ---- answers corrupted or emptied on purpose ----

const PAYLOAD_KEY = "gzip_base64";

// Apply fn(field owner) to every object in a JSON value that carries a gzip_base64 payload.
function eachPayload(value, fn) {
  if (Array.isArray(value)) value.forEach((v) => eachPayload(v, fn));
  else if (value && typeof value === "object") {
    if (typeof value[PAYLOAD_KEY] === "string") fn(value);
    for (const key of Object.keys(value)) eachPayload(value[key], fn);
  }
}

// malformed(): magic -> "XXXX" header, gzip -> stream cut in half (the page reports a TypeError, "the server can't be reached"), base64 -> characters
// atob rejects (InvalidCharacterError), short -> a payload whose header promises more records than it holds, json -> a body that is not JSON.
function corrupt(body, how) {
  if (how === "json") return Buffer.from(JSON.stringify(body).slice(0, Math.max(1, Math.floor(JSON.stringify(body).length / 2))));
  const clone = JSON.parse(JSON.stringify(body));
  eachPayload(clone, (owner) => {
    const text = owner[PAYLOAD_KEY];
    if (how === "base64") owner[PAYLOAD_KEY] = "!!!" + text.slice(3);
    else if (how === "gzip") owner[PAYLOAD_KEY] = Buffer.from(Buffer.from(text, "base64").subarray(0, Math.max(10, Math.floor(text.length * 0.375)))).toString("base64");
    else {
      const payload = wire.gunzipBase64(text);
      if (how === "magic") payload.write("XXXX", 0, "latin1");
      owner[PAYLOAD_KEY] = wire.gzipBase64(how === "short" ? payload.subarray(0, Math.max(wire.HEADER, Math.floor(payload.length / 2))) : payload);
    }
  });
  return Buffer.from(JSON.stringify(clone));
}

// empty(): a valid answer with no cells: a block, bars or columns of count 0 (touched: empty arrays), the rest of the body unchanged.
// A /cube/query answer also carries the cube's summary of the rectangle (its totals and its cell count): an empty rectangle
// has none of those either, so a page that reads the summary as well as the block finds no data in either (DR-56, B20).
function emptied(body) {
  const clone = JSON.parse(JSON.stringify(body));
  if (clone.summary && typeof clone.summary === "object") {
    const s = clone.summary;
    for (const name of ["volume", "trade_count", "taker_buy_volume", "taker_buy_trade_count", "cell_count"]) if (name in s) s[name] = 0;
    for (const name of ["poc", "taker_buy_poc"]) if (name in s) s[name] = null;
  }
  const cut = (owner) => {
    const { n, m, col0, col1, layout } = owner;
    if (layout === "MSC2" || layout === "MSC3") owner[PAYLOAD_KEY] = wire.msc2(n, m, col0, col1, layout === "MSC3" ? { vol: [], tbvol: [], cnt: [], tbcnt: [], path: [], dwell: [], high: [], low: [], col: [], row: [] } : { vol: [], tbvol: [], cnt: [], tbcnt: [], col: [], row: [] }, 0, layout === "MSC3");
    else if (layout === "MSCB") owner[PAYLOAD_KEY] = wire.mscb(n, col0, col1, { open: [], high: [], low: [], close: [], vol: [], tbvol: [], btc: [], cnt: [], col: [] });
    else if (layout === "MSCC") owner[PAYLOAD_KEY] = wire.mscc(n, m, col0 ?? owner.b0 / 2 ** n, col1 ?? owner.b1 / 2 ** n, { col: [], poc: [], vol: [], tbvol: [] });
    else return;
    owner.count = 0;
  };
  if (clone.block) cut(clone.block);
  if (clone.bars) cut(clone.bars);
  if (clone.columns && clone.columns.layout) {
    const c = clone.columns;
    c.col0 = c.b0 / 2 ** c.n;
    c.col1 = c.b1 / 2 ** c.n;
    cut(c);
  } else if (clone.columns) {
    clone.columns = { col: [], rows: [], volume: [] };
    clone.parents = { col: [], rows: [], volume: [] };
  }
  return Buffer.from(JSON.stringify(clone));
}

// ---- the fake ----

class FakeCube {
  constructor(opts) {
    this.opts = { mode: "live", profile: "mini", port: 0, host: "127.0.0.1", control: false, quiet: 2, next: 3, pageVersion: "fake-page-1", packsHeld: 16, maxCells: model.MAX_CELLS, ...opts };
    if (!["live", "recorded"].includes(this.opts.mode)) throw new RangeError(`mode ${this.opts.mode}: use live or recorded`);
    this.pageRoot = path.resolve(this.opts.pageRoot ?? REPO_ROOT);
    this.entries = [];
    this.rules = [];
    this.sockets = new Set();
    this.seq = 0;
    this.inFlight = 0;
    this.slotBusy = { cube: 0, motion: 0 };
    this.lastActivity = performance.now();
    this.started = performance.now();
    this.closed = false;
    this.boot();
  }

  // (Re)build the model from the options: the cube over a fresh store, and the bridge over the cube.
  boot() {
    if (this.opts.mode === "recorded") {
      this.profile = null;
      this.cube = null;
      this.bridge = null;
      return;
    }
    this.profile = resolveProfile(this.opts.profile, { seed: this.opts.seed, cutoff: this.opts.cutoff, canonicalThrough: this.opts.canonicalThrough });
    this.cube = new model.Cube({
      store: this.profile.store, cutoffMs: this.profile.cutoffMs, canonicalThroughMs: this.profile.canonicalThroughMs, extend: this.profile.extend, maxCells: this.opts.maxCells,
    });
    this.bridge = new model.Bridge(this.cube, { label: this.profile.label, packsHeld: this.opts.packsHeld, quiet: this.opts.quiet, next: this.opts.next, pageVersion: this.opts.pageVersion });
  }

  // ---- HTTP ----

  async listen() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        // A bug in the fake itself: say so loudly instead of hanging the page.
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(`fake cube bug: ${error && error.stack}`);
        } else res.destroy();
        process.stderr.write(`fake cube bug: ${error && error.stack}\n`);
      });
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.opts.port, this.opts.host, resolve);
    });
    this.port = this.server.address().port;
    this.url = `http://${this.opts.host}:${this.port}`;
  }

  async handle(req, res) {
    const url = new URL(req.url, "http://fake");
    const pathname = url.pathname;
    if (this.opts.control && pathname.startsWith("/__fake/")) return this.controlRoute(req, res, pathname, url);
    const args = queryArgs(url.search);
    const query = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v[0]]));
    const slot = slotOf(pathname, args);
    const entry = {
      seq: ++this.seq, t: Math.round(performance.now() - this.started), method: req.method, path: pathname,
      query: Object.fromEntries(Object.entries(query).filter(([k]) => k !== "proto" && k !== "pack")),
      packToken: query.pack ?? null, status: null, inFlightAtStart: this.inFlight, slot, ms: null, bytes: 0, answer: null, note: null, unexpected: null,
    };
    this.entries.push(entry);
    this.inFlight++;
    if (slot === "cube" || slot === "motion") {
      if (this.slotBusy[slot] > 0) entry.unexpected = `overlapping ${slot} reads`;
      this.slotBusy[slot]++;
    }
    const began = performance.now();
    this.lastActivity = began;
    res.on("close", () => {
      entry.ms = Math.round((performance.now() - began) * 10) / 10;
      this.inFlight--;
      if (slot === "cube" || slot === "motion") this.slotBusy[slot]--;
      this.lastActivity = performance.now();
    });

    const send = (status, kind, body, headers = {}) => {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      entry.status = status;
      entry.bytes = bytes.length;
      res.writeHead(status, { "Content-Type": kind, "Content-Length": bytes.length, "Cache-Control": "no-store", ...headers });
      res.end(req.method === "HEAD" ? undefined : bytes);
    };
    const sendJson = (body, status = 200) => {
      if (body && typeof body === "object" && typeof body.status === "string" && pathname === "/cube/pack") entry.answer = body.status;
      send(status, "application/json", JSON.stringify(body));
    };

    // Faults come first: they stand for the network and the server misbehaving, before any routing.
    const rule = this.rules.find((r) => r.matches(pathname, query));
    let transform = null;
    if (rule) {
      entry.note = `fault:${rule.kind}`;
      if (rule.kind === "delay") await sleep(rule.ms);
      else if (rule.kind === "fail") return sendJson(rule.body, rule.status);
      else if (rule.kind === "hang") return new Promise(() => {}); // never answered; the socket closing ends it
      else if (rule.kind === "drop") return void req.socket.destroy();
      else if (rule.kind === "gate") {
        if (!rule.gateObject.disarmed) {
          const decision = await rule.gateObject.hold();
          if (!decision.go) return sendJson(decision.body, decision.status);
        }
      } else if (rule.kind === "empty") transform = emptied;
      else if (rule.kind === "malformed") transform = (body) => corrupt(body, rule.how);
    }
    if (this.closed) return;

    const answered = this.answer(req, pathname, args, entry);
    if (answered.json !== undefined) {
      if (transform && answered.status === 200) {
        entry.answer = answered.json.status ?? null;
        return send(200, "application/json", transform(answered.json));
      }
      return sendJson(answered.json, answered.status);
    }
    send(answered.status, answered.kind, answered.body, answered.headers);
  }

  // The bridge's Handler.do_GET: order is healthz, parse, proto check for /cube/*, route; errors map to 400 / 409 / 502.
  answer(req, pathname, args, entry) {
    const text = (status, body, headers) => ({ status, kind: "text/plain", body, headers });
    const json = (body, status = 200) => ({ status, json: body });
    if (pathname === "/healthz") return text(200, "ok");
    try {
      if (pathname.startsWith("/cube/") && this.opts.mode === "recorded") {
        entry.unexpected = `${pathname} requested from a recorded page`;
        return text(404, "not found");
      }
      if (pathname.startsWith("/cube/") && (args.proto?.[0] ?? "") !== PROTOCOL) {
        entry.unexpected = `protocol mismatch (proto=${args.proto?.[0] ?? "missing"})`;
        return json({ error: OUTDATED, reload: true }, 409);
      }
      if (pathname === "/" || pathname === "/index.html") return { status: 200, kind: "text/html; charset=utf-8", body: this.html() };
      if (pathname === "/favicon.ico") return { status: 204, kind: "image/x-icon", body: Buffer.alloc(0) };
      const bridge = this.bridge;
      const token = args.pack?.[0] ?? "";
      if (pathname === "/cube/pack") return json(bridge.update(args.since?.[0] ?? ""));
      if (pathname === "/cube/tile" || pathname === "/cube/query") {
        const spec = rectangle(args, pathname === "/cube/query");
        if (args.motion?.[0] === "1") return json(bridge.motionMeasure(spec, token, pathname === "/cube/query"));
        const body = bridge.measure(spec, token);
        if (pathname === "/cube/tile") delete body.summary;
        return json(body);
      }
      if (pathname === "/cube/motion") {
        const start = "from" in args ? integer(args, "from") : null;
        if (start !== null && start < 0) throw new ValueError("from must be a base edge");
        return json(bridge.motion(args.tier?.[0] ?? "", token, start));
      }
      if (pathname === "/cube/columns") {
        const [n, m] = level(args);
        return json(bridge.history(n, m, token));
      }
      if (pathname === "/cube/bars") {
        const n = integer(args, "n"), b0 = integer(args, "b0"), b1 = Number(args.b1?.[0]);
        if (!Number.isFinite(b1)) throw new ValueError("b1 must be a finite base position");
        if (!BAR_LEVELS.includes(n)) throw new ValueError("n must be 0..20: dyadic grid bars");
        const step = 2 ** n;
        if (!(b0 >= 0 && b0 < b1 && b0 % step === 0)) throw new ValueError("b0 must be a bar's edge and b1 after it");
        if (Math.ceil(b1 / step) - Math.floor(b0 / step) > MAX_COLUMNS) throw new ValueError(`more than ${MAX_COLUMNS} bars`);
        return json(bridge.bars(n, b0, b1, token));
      }
      if (pathname === "/cube/touched") {
        const n = integer(args, "n"), b0 = integer(args, "b0"), b1 = integer(args, "b1");
        if (!(n >= 0 && n < MAX_TIME_EXPONENT)) throw new ValueError(`n must be 0..${MAX_TIME_EXPONENT - 1}`);
        const span = 2 ** (n + 1);
        if (!(b0 >= 0 && b0 < b1 && b0 % span === 0 && b1 % span === 0)) throw new ValueError("b0 and b1 must be the edges of whole parent columns, b0 < b1");
        if (Math.floor((b1 - b0) / 2 ** n) > MAX_COLUMNS) throw new ValueError(`more than ${MAX_COLUMNS} columns`);
        return json(bridge.touched(n, b0, b1, token));
      }
      if (pathname.startsWith("/vendor/")) {
        const name = pathname.slice("/vendor/".length);
        if (VENDOR.has(name)) {
          const file = path.join(this.pageRoot, "vendor", name);
          if (fs.existsSync(file)) return { status: 200, kind: VENDOR.get(name), body: fs.readFileSync(file) };
        }
      }
      entry.unexpected = `404 ${pathname}`;
      return text(404, "not found");
    } catch (error) {
      if (error instanceof ValueError) return json({ error: error.message }, 400);
      if (error instanceof CubeChanged) return json({ error: "cube_changed", detail: error.message }, 409);
      if (error instanceof MarketStateError) return json({ error: error.body.error ?? "cube_error", detail: error.message }, error.status === 503 ? 503 : 502);
      entry.unexpected = `unanswerable: ${error.name}: ${error.message}`;
      return json({ error: `${error.name}: ${error.message}` }, 502);
    }
  }

  // / and /index.html: the page. Live mode injects the pack the way the bridge does; recorded mode serves the file unmodified.
  html() {
    const text = fs.readFileSync(path.join(this.pageRoot, "index.html"), "utf8");
    if (this.opts.mode === "recorded") return text;
    const [pack, age] = this.bridge.currentPack();
    return model.injectPack(text, { ...pack, ...this.bridge.timing(age) });
  }

  // ---- data controls ----

  need() {
    if (!this.bridge) throw new Error("this fake serves a recorded page: it has no cube to control");
    return this.bridge;
  }

  // advance({minutes} | {toIso}, trades?): the cutoff moves to a later minute edge; the profile's stream (or `trades`, for hand-authored
  // fixtures) fills the new minutes, the open column gains trades, the token changes and the next poll gets a delta.
  advance({ minutes, toIso, trades } = {}) {
    const bridge = this.need();
    const from = this.cube.cutoffMs;
    const to = toIso !== undefined ? floorMinute(msOfIso(toIso)) : floorMinute(from + Math.round((minutes ?? 1) * MINUTE_MS));
    this.cube.advance(to, trades ?? null);
    bridge.clock += (to - from) / 1000;
    bridge.stale = true;
    return this;
  }

  // setCanonicalThrough(iso | null): the archive boundary moves (null: no provisional edge). Days that become canonical change partition, so
  // the next poll answers with a whole pack and the page takes its dropMotionAfter path.
  setCanonicalThrough(iso) {
    const bridge = this.need();
    this.cube.setCanonical(iso === null ? null : floorMinute(msOfIso(iso)));
    bridge.stale = true;
    return this;
  }

  // revise({day | col, factor, count}): a real revision of one UTC day (quantities and counts change, its pin moves): reads under the old
  // token that touch the day get 409 cube_changed, the next poll a whole pack.
  revise(spec) {
    const bridge = this.need();
    this.cube.revise(spec);
    bridge.stale = true;
    return this;
  }

  // rebuild(): a new token over the same content: the next poll answers with a delta of unchanged data (no generation bump in the page).
  rebuild() {
    const bridge = this.need();
    bridge.salt++;
    bridge.stale = true;
    return this;
  }

  holdPacks(n) {
    const bridge = this.need();
    bridge.packsHeld = n;
    bridge.trim();
    return this;
  }

  expirePack(token) {
    this.need().held.delete(token);
    return this;
  }

  setQuiet(seconds) { this.need().quiet = seconds; return this; }
  setNext(seconds) { this.need().nextSeconds = seconds; return this; }
  setPageVersion(text) { this.need().pageVersion = text; return this; }
  setMaxCells(n) { this.need(); this.cube.maxCells = n; return this; }

  // motionThrough(baseEdge | iso | null): how far the cube has measured motion and bars. Answers end there (end < b1), a read wholly beyond
  // it gets an empty block with `end` at the coverage. The bridge's caches are dropped: they hold answers of the earlier coverage.
  motionThrough(edge) {
    const bridge = this.need();
    this.cube.coverage = edge === null ? null : typeof edge === "string" ? wire.baseUnits(edge) : edge;
    bridge.motions.clear();
    bridge.barAnswers.clear();
    return this;
  }

  // jitter(seed | null): equivalent sums in another order (last bits differ, counts do not) under a new token, so tails() has to decide.
  jitter(seed) {
    const bridge = this.need();
    this.cube.store.setJitter(seed);
    bridge.salt++;
    bridge.stale = true;
    return this;
  }

  // overrideBars(n, bars): an explicit OHLC series for level n, [{col, open, high, low, close, volume, takerBuyVolume, baseVolume, trades}],
  // still synthetic. It replaces the bars computed from trades for that level.
  overrideBars(n, list) {
    const bridge = this.need();
    const sorted = [...list].sort((a, b) => a.col - b.col);
    const pick = (key) => Float64Array.from(sorted, (b) => b[key]);
    this.cube.barOverrides.set(n, {
      open: pick("open"), high: pick("high"), low: pick("low"), close: pick("close"), vol: pick("volume"), tbvol: pick("takerBuyVolume"),
      btc: pick("baseVolume"), cnt: pick("trades"), col: Uint32Array.from(sorted, (b) => b.col),
    });
    bridge.barAnswers.clear();
    return this;
  }

  // corrupt({dwell, path, volume} | null): the first cell of every motion block carries these values (validation-failure inputs: negative
  // dwell, dwell beyond the covered time, negative volume) instead of the computed ones.
  corrupt(values) {
    const bridge = this.need();
    this.cube.corruption = values;
    bridge.motions.clear();
    return this;
  }

  // ---- faults ----

  on(spec) {
    const rule = new Rule(this, spec);
    this.rules.push(rule);
    return rule;
  }

  clearFaults() {
    for (const rule of this.rules) if (rule.gateObject) rule.gateObject.open();
    this.rules = [];
  }

  // ---- observation ----

  log() { return this.entries.map((e) => ({ ...e, query: { ...e.query } })); }
  clearLog() { this.entries = []; }

  // idle({quietMs = 300, timeoutMs = 10000}): resolves when no request is in flight and none has started or ended for quietMs (the page
  // exposes no idle flag).
  async idle({ quietMs = 300, timeoutMs = 10000 } = {}) {
    const limit = performance.now() + timeoutMs;
    for (;;) {
      if (this.inFlight === 0 && performance.now() - this.lastActivity >= quietMs) return;
      if (performance.now() > limit) throw new Error(`fake cube not idle after ${timeoutMs} ms (${this.inFlight} in flight)`);
      await sleep(Math.min(25, quietMs));
    }
  }

  // assertNoUnexpected(): throws listing every request the fake could not treat as normal: a 404, a protocol mismatch, an unanswerable request,
  // two overlapping reads in one slot, any /cube/* request in recorded mode.
  assertNoUnexpected() {
    const bad = this.entries.filter((e) => e.unexpected);
    if (bad.length) throw new Error(`unexpected requests:\n${bad.map((e) => `  #${e.seq} ${e.method} ${e.path} -> ${e.status}: ${e.unexpected}`).join("\n")}`);
  }

  info() {
    if (this.opts.mode === "recorded") return { mode: "recorded", pageRoot: this.pageRoot };
    const [pack] = this.bridge.currentPack();
    const tiers = Object.fromEntries(Object.entries(pack.blocks).map(([id, b]) => [id, { n: b.n, m: b.m, b0: b.b0, b1: b.b1, count: b.count, col0: b.col0, col1: b.col1 }]));
    const held = this.bridge.packTiers.recent.cells;
    let low = Infinity, high = -Infinity;
    for (const row of held.row) {
      if (row < low) low = row;
      if (row > high) high = row;
    }
    return {
      mode: "live", profile: this.profile.name, seed: this.profile.seed, cutoff: pack.cutoff, cutoffBase: pack.cutoffBase, tiers,
      priceBand: held.row.length ? { rows: [low, high + 1], usdt: [low * wire.BASE_PRICE, (high + 1) * wire.BASE_PRICE] } : null,
      source: pack.source, packToken: pack.state_token,
    };
  }

  // The bridge's current pack (for tests that read what the page would inject).
  currentPack() {
    return this.need().currentPack()[0];
  }

  // reset(): back to the state startFake() built (same options), with no faults and an empty log; the port stays.
  reset() {
    this.clearFaults();
    this.entries = [];
    this.seq = 0;
    this.boot();
    return this;
  }

  async close() {
    this.closed = true;
    this.clearFaults();
    await new Promise((resolve) => {
      this.server.close(resolve);
      this.server.closeAllConnections();
    });
  }

  // ---- the control API (CLI only; the page never requests /__fake/*) ----

  async controlRoute(req, res, pathname, url) {
    const reply = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store" });
      res.end(text);
    };
    try {
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      }
      const name = pathname.slice("/__fake/".length);
      if (req.method === "GET" && name === "info") return reply(200, this.info());
      if (req.method === "GET" && name === "log") return reply(200, this.log());
      if (req.method !== "POST") return reply(404, { error: `no control route ${name}` });
      if (name === "advance") this.advance(body);
      else if (name === "rebuild") this.rebuild();
      else if (name === "revise") this.revise(body);
      else if (name === "hold") this.holdPacks(body.n);
      else if (name === "reset") this.reset();
      else if (name === "clear-faults") this.clearFaults();
      else if (name === "fault") {
        // {route: "regex source", query: {key: value}, times, after, action: "delay"|"fail"|"hang"|"drop"|"empty"|"malformed", ms, status, body, how}
        const when = body.query ? (q) => Object.entries(body.query).every(([k, v]) => String(q[k]) === String(v)) : null;
        const rule = this.on({ route: new RegExp(body.route), when, times: body.times, after: body.after });
        if (body.action === "delay") rule.delay(body.ms);
        else if (body.action === "fail") rule.fail({ status: body.status, body: body.body });
        else if (body.action === "malformed") rule.malformed(body.how);
        else if (["hang", "drop", "empty"].includes(body.action)) rule[body.action]();
        else throw new RangeError(`fault action ${body.action}`);
      } else return reply(404, { error: `no control route ${name}` });
      return reply(200, { ok: true });
    } catch (error) {
      return reply(400, { error: `${error.name}: ${error.message}` });
    }
  }
}

// startFake(opts) -> Promise<Fake>. See TESTPLAN 4.2 for the options; the returned object is the FakeCube itself (url, port, close(), and the
// controls above).
async function startFake(opts = {}) {
  const fake = new FakeCube(opts);
  await fake.listen();
  return fake;
}

// ---- CLI ----

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new RangeError(`unexpected argument ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[++i];
    if (value === undefined) throw new RangeError(`${arg} needs a value`);
    out[key] = value;
  }
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const opts = { control: true, profile: args.profile ?? "standard", port: Number(args.port ?? 8790) };
  if (args.host) opts.host = args.host;
  if (args.pageRoot) opts.pageRoot = args.pageRoot;
  if (args.seed) opts.seed = Number(args.seed);
  if (args.cutoff) opts.cutoff = args.cutoff;
  if (args.mode) opts.mode = args.mode;
  const fake = await startFake(opts);
  const info = fake.info();
  process.stdout.write(`fake cube on ${fake.url}  ${info.mode === "live" ? `profile ${info.profile} seed ${info.seed}, cutoff ${info.cutoff}` : "recorded page"}\n${info.source ?? ""}\ncontrol: ${fake.url}/__fake/info\n`);
  const stop = () => fake.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { startFake, FakeCube, Gate, Rule, slotOf };
