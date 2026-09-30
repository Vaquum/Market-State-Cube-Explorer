"use strict";
// U55 (PRD-0002 S2, #47 section 6): E.readout.events, the event and known-at table and the records of each annotation, replayed one edge at a time.
//
// Oracles (none is the code under test):
//   1. The PRD's table typed out here: the ten annotations, where each sits, what its known-at is.
//   2. A replay model written in the test: for every annotation the bars that exist at an edge are the bars that have BEGUN by it (a bar that has begun
//      and not ended is forming), and the structural known-at of an annotation is the first edge at which its completing bar is complete. A record
//      asked for at every edge from before the first bar to long after the last must (a) not exist before its bar began, (b) be a candidate without a
//      known-at while the bar forms, (c) carry exactly the bar's end as known-at from that edge on, and (d) say the same thing at every later edge
//      (nothing rewrites it, nothing known later leaks backward).
//   3. Hand-worked numbers for the readout's `when` (the lattice's base column is 56.25 s from 1609459200 s).
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

const EV = E.readout.events;
const plain = (x) => JSON.parse(JSON.stringify(x));
const EDGES = Array.from({ length: 301 }, (_, i) => i);

// ---- the table ---------------------------------------------------------------------------------------------------------

test("the table has the PRD's ten annotations, in its order, each with where it is and from when it is known", () => {
  const PRD = ["Confirmed swing", "Equal swing pair", "RSI divergence", "Moving-average or MACD crossing", "Bollinger squeeze", "CME spot gap", "Period POC and value area", "Untested level", "Historical continuation range", "Clock"];
  assert.deepEqual(EV.TABLE.map((r) => r.name), PRD);
  assert.deepEqual(EV.TABLE.map((r) => r.kind), ["swing", "equalSwings", "rsiDivergence", "cross", "squeeze", "cmeGap", "period", "untested", "continuation", "clock"]);
  for (const r of EV.TABLE) {
    assert.ok(r.location.length > 8, `${r.kind} says where it is`);
    assert.ok(r.knownAt.length > 8, `${r.kind} says from when it is known`);
  }
  assert.ok(Object.isFrozen(EV.TABLE) && EV.TABLE.every(Object.isFrozen), "the table is frozen");
  // the words of the rows that carry a rule beyond "at the bar's end"
  const by = Object.fromEntries(EV.TABLE.map((r) => [r.kind, r]));
  assert.match(by.swing.knownAt, /confirmed the reversal/);
  assert.match(by.swing.knownAt, /retrospective/);
  assert.match(by.cross.knownAt, /candidate/);
  assert.match(by.cross.knownAt, /so far/);
  assert.match(by.squeeze.knownAt, /retrospective interpolation/);
  assert.match(by.cmeGap.knownAt, /no earlier than the end of the source bar/);
  assert.match(by.period.knownAt, /not known when the period started/);
  assert.match(by.untested.knownAt, /cannot rewrite/);
  assert.match(by.continuation.knownAt, /not a forecast/);
  assert.match(by.clock.knownAt, /not a measured trade event/);
});

// ---- a replay harness ---------------------------------------------------------------------------------------------------

// `at(edge)` builds the record of an annotation as the page would at that data edge. For every edge the harness checks the four properties of the
// oracle above for a record whose completing bar is [begin, end], and returns the records by edge for the caller's own checks.
function replay(at, begin, end, extra = () => {}) {
  const records = EDGES.map((edge) => [edge, at(edge)]);
  for (const [edge, r] of records) {
    if (edge <= begin) {
      assert.equal(r, null, `edge ${edge}: the completing bar has not begun, so there is nothing to show`);
      continue;
    }
    assert.ok(r !== null, `edge ${edge}: the record exists once the bar has begun`);
    if (edge < end) {
      assert.equal(r.knownAt, null, `edge ${edge}: the bar is forming, so there is no known-at`);
      assert.equal(r.candidate, true, `edge ${edge}: a candidate`);
      assert.equal(r.final, false, `edge ${edge}: not final`);
      assert.equal(r.label, "so far", `edge ${edge}: labelled so far`);
      assert.equal(r.source.complete, false);
      assert.equal(r.source.through, edge);
    } else {
      assert.equal(r.knownAt, end, `edge ${edge}: known at the end of the bar, however late it is asked`);
      assert.equal(r.candidate, false, `edge ${edge}: no longer a candidate`);
      assert.equal(r.final, true, `edge ${edge}: final`);
      assert.notEqual(r.label, "so far");
      assert.equal(r.source.complete, true);
    }
    assert.ok(Object.isFrozen(r));
    E.result.assertJsonSafe(plain(r));
    extra(edge, r);
  }
  // nothing rewrites it: every record at and after the end is the same apart from the edge it was asked at
  const settled = records.filter(([edge]) => edge >= end).map(([, r]) => ({ ...r, source: { ...r.source, through: 0 }, leadIn: undefined, eventEnd: undefined }));
  for (const r of settled) assert.deepEqual(r, settled[0]);
  return Object.fromEntries(records);
}

// ---- swing -------------------------------------------------------------------------------------------------------------

const swingAt = (extreme, confirm) => (edge) => EV.swing({ extreme, confirm, edge, granularity: "4-hour bars" });

test("a swing is known at the end of the bar that reversed from it, and is a candidate while that bar forms", () => {
  const extreme = [60, 70],
    confirm = [100, 110];
  const out = replay(swingAt(extreme, confirm), 100, 110, (edge, r) => {
    assert.deepEqual([r.eventStart, r.eventEnd], extreme, "its location is the extreme's supported bar");
    assert.equal(r.retrospective, true, "the lead-in is retrospective");
    assert.equal(r.kind, "swing");
    assert.equal(r.name, "Confirmed swing");
    assert.equal(r.source.granularity, "4-hour bars");
    assert.deepEqual([r.source.barStart, r.source.barEnd], confirm);
  });
  assert.deepEqual(plain(out[105].leadIn), [60, 105], "a candidate's lead-in runs to the edge");
  assert.deepEqual(plain(out[110].leadIn), [60, 110], "a confirmed swing's runs to the confirmation");
  assert.match(out[105].reason, /candidate, not confirmed/);
  assert.match(out[110].reason, /Confirmed at the end of the bar that reversed/);
});

test("two swings in a pair, and a divergence between them, are known at the LATER swing's confirmation and never earlier", () => {
  const first = [[20, 30], [50, 60]],
    second = [[120, 130], [160, 170]];
  const pair = (make) => (edge) => {
    const a = EV.swing({ extreme: first[0], confirm: first[1], edge, granularity: "1-day bars" }),
      b = EV.swing({ extreme: second[0], confirm: second[1], edge, granularity: "1-day bars" });
    return b === null ? null : make(a, b);
  };
  for (const [key, fn] of [["equalSwings", EV.equalSwings], ["rsiDivergence", EV.rsiDivergence]]) {
    const out = replay(pair(fn), 160, 170, (edge, r) => {
      assert.equal(r.kind, key);
      assert.deepEqual([r.eventStart, r.eventEnd], [20, 130], `${key}: from the first extreme to the second`);
    });
    // while the later swing's own confirming bar forms there is a candidate, although the first swing was known since 60
    assert.equal(out[165].knownAt, null, `${key}: the first swing's confirmation does not date the pair`);
    assert.equal(out[150], null, `${key}: nothing to compare before the later swing's confirming bar began`);
    assert.equal(out[170].knownAt, 170);
  }
  assert.match(EV.rsiDivergence({ ...EV.swing({ extreme: [1, 2], confirm: [3, 4], edge: 10 }) }, EV.swing({ extreme: [5, 6], confirm: [7, 8], edge: 10 })).reason, /not when the RSI's extrema occurred/);
});

// ---- crossing ----------------------------------------------------------------------------------------------------------

test("a crossing is known at its complete bar's end; on a forming bar it is a candidate labelled so far, drawn at the edge", () => {
  const out = replay((edge) => EV.cross({ bar: [200, 240], edge, granularity: "1-day bars" }), 200, 240, (edge, r) => {
    assert.equal(r.eventStart, r.eventEnd);
    assert.equal(r.eventEnd, Math.min(240, edge), "drawn where it is: at the bar's end, or at the edge while the bar forms");
  });
  assert.match(out[210].reason, /so far, not confirmed/);
});

// ---- squeeze -----------------------------------------------------------------------------------------------------------

test("a squeeze run: each bar qualifies at its close, the run is final only once a later complete bar does not qualify, a fill from the preceding point is keyed", () => {
  const BARS = [[100, 110], [110, 120], [120, 130]],
    AFTER = [130, 140];
  const at = (edge) => {
    // the bars of the run that have begun at this edge, and the bar after it if it has
    const have = BARS.filter((b) => b[0] < edge);
    return EV.squeeze({ bars: have, after: AFTER[0] < edge ? AFTER : null, edge, granularity: "4-hour bars", fillFrom: 90 });
  };
  const out = Object.fromEntries(EDGES.map((e) => [e, at(e)]));
  assert.equal(out[100], null, "before the first qualifying bar began");
  assert.equal(out[105].knownAt, null, "the first bar forms: a candidate");
  assert.equal(out[105].candidate, true);
  assert.equal(out[110].knownAt, 110, "known at the first bar's own close");
  assert.equal(out[110].candidate, false);
  assert.equal(out[110].final, false, "the run may still continue");
  assert.equal(out[115].knownAt, 110, "the second bar forms: the run is known up to the first's close");
  assert.equal(out[115].candidate, true);
  assert.equal(out[120].knownAt, 120);
  assert.equal(out[130].knownAt, 130);
  assert.equal(out[130].final, false, "no bar after the run is complete at 130");
  assert.equal(out[135].final, false, "the bar after it forms: not final");
  assert.equal(out[140].final, true, "a later complete bar that does not qualify ends the run");
  assert.equal(out[140].label, "final");
  assert.deepEqual([out[300].eventStart, out[300].eventEnd, out[300].knownAt], [100, 130, 130]);
  // a fill drawn from the preceding point (90) is retrospective interpolation, and the bars' own interval is not
  assert.equal(out[140].retrospective, true);
  assert.equal(out[140].geometry, "retrospective interpolation");
  const plainRun = EV.squeeze({ bars: BARS, after: AFTER, edge: 300, granularity: "4-hour bars" });
  assert.equal(plainRun.retrospective, false);
  assert.equal(plainRun.geometry, "qualifying bars");
  // knownAt never decreases as the edge moves and never precedes the bar it names
  let last = -Infinity;
  for (const e of EDGES) {
    const r = out[e];
    if (r === null || r.knownAt === null) continue;
    assert.ok(r.knownAt >= last && r.knownAt <= e, `edge ${e}: known-at ${r.knownAt} is in the past and does not go back`);
    last = r.knownAt;
  }
});

// ---- CME gap -----------------------------------------------------------------------------------------------------------

test("a CME gap is known at the reopen; its fill no earlier than the end of the bar that crossed, a candidate while that bar forms", () => {
  const reopenBar = [90, 100],
    fillBar = [130, 140];
  const at = (edge) => EV.cmeGap({ close: 50, reopen: 100, reopenBar, fill: fillBar[0] < edge ? fillBar : null, edge, granularity: "1-hour bars" });
  const out = Object.fromEntries(EDGES.map((e) => [e, at(e)]));
  for (const e of EDGES) {
    const r = out[e];
    if (e < 100) {
      assert.equal(r, null, `edge ${e}: the reopen's close is not in yet`);
      continue;
    }
    assert.equal(r.knownAt, 100, `edge ${e}: the gap is known at the reopen`);
    assert.deepEqual([r.eventStart, r.eventEnd], [50, 100]);
    assert.equal(r.final, true);
    if (e <= 130) assert.equal(r.fill, null, `edge ${e}: nothing has traded back through the Friday close: no fill`);
    else if (e < 140) {
      assert.equal(r.fill.knownAt, null, `edge ${e}: the crossing bar forms: no fill yet`);
      assert.equal(r.fill.candidate, true);
      assert.equal(r.fill.label, "so far");
      assert.equal(r.label, "so far");
    } else {
      assert.equal(r.fill.knownAt, 140, `edge ${e}: the fill is known at the end of the crossing bar, not before`);
      assert.equal(r.fill.final, true);
      assert.equal(r.label, "filled");
    }
  }
  assert.equal(out[100].label, "open");
  assert.match(out[135].fill.reason, /still forming/);
});

// ---- period, untested, continuation, clock -----------------------------------------------------------------------------

test("a period's POC and value area are a retrospective summary as of the cutoff, not known when the period started", () => {
  assert.equal(EV.period({ span: [100, 200], cutoff: 100 }), null, "a cutoff at the period's start has nothing to summarise");
  const open = EV.period({ span: [100, 200], cutoff: 150 }),
    done = EV.period({ span: [100, 200], cutoff: 400 });
  assert.equal(open.knownAt, 150);
  assert.equal(open.final, false);
  assert.equal(open.label, "so far");
  assert.equal(done.knownAt, 400, "known as of the cutoff, not at 100 when the period started");
  assert.equal(done.final, true);
  assert.equal(done.retrospective, true);
  assert.deepEqual([done.eventStart, done.eventEnd], [100, 200]);
  assert.equal(done.label, "retrospective");
});

test("an untested level is a status as of the edge it is asked at: earlier edges keep their own answers", () => {
  assert.equal(EV.untested({ origin: [0, 100], asOf: 99 }), null, "the origin period has not ended");
  const early = EV.untested({ origin: [0, 100], asOf: 120 }),
    late = EV.untested({ origin: [0, 100], asOf: 500 });
  assert.equal(early.knownAt, 120);
  assert.equal(late.knownAt, 500);
  assert.equal(early.label, "as of");
  assert.equal(early.final, false);
  assert.deepEqual(plain(early), plain(EV.untested({ origin: [0, 100], asOf: 120 })), "asking again at the earlier edge gives the same record after a later one was made");
  assert.deepEqual([early.eventStart, early.eventEnd], [0, 100]);
});

test("a continuation range is known at its anchor and withholds its percentages below 30 cases", () => {
  assert.equal(EV.continuation({ anchor: 1000, horizon: 500, samples: 100, edge: 999 }), null, "before the anchor");
  const few = EV.continuation({ anchor: 1000, horizon: 500, samples: 29, edge: 1000 }),
    enough = EV.continuation({ anchor: 1000, horizon: 500, samples: 30, edge: 5000 }),
    custom = EV.continuation({ anchor: 1000, horizon: 500, samples: 12, minSample: 10, edge: 1000 });
  assert.equal(few.withheld, true);
  assert.match(few.reason, /Fewer than 30 cases/);
  assert.equal(enough.withheld, false);
  assert.equal(custom.withheld, false);
  for (const r of [few, enough]) {
    assert.equal(r.knownAt, 1000);
    assert.deepEqual([r.eventStart, r.eventEnd], [1000, 1500]);
    assert.equal(r.label, "at anchor");
  }
});

test("the clock is a calendar definition: no known-at, not measured", () => {
  const r = EV.clock({ scheduled: 4242 });
  assert.equal(r.knownAt, null);
  assert.equal(r.measured, false);
  assert.equal(r.label, "calendar");
  assert.deepEqual([r.eventStart, r.eventEnd], [4242, 4242]);
  assert.match(r.reason, /not a measured trade event/);
  for (const other of [EV.swing({ extreme: [1, 2], confirm: [3, 4], edge: 9 }), EV.cross({ bar: [3, 4], edge: 9 })]) assert.equal(other.measured, true);
});

// ---- the readout's when ------------------------------------------------------------------------------------------------

test("a measured interval's when: the end is the known-at once it is complete, nothing while it is open or cut", () => {
  assert.deepEqual(plain(EV.interval(1000, 2000, "complete")), { eventStartMs: 1000, eventEndMs: 2000, knownAtMs: 2000, knownAtReason: "the end of the interval it measures" });
  const open = EV.interval(1000, 2000, "open"),
    partial = EV.interval(1000, 2000, "partial"),
    none = EV.interval(null, null, "unknown");
  assert.equal(open.knownAtMs, null);
  assert.match(open.knownAtReason, /still open/);
  assert.equal(partial.knownAtMs, null);
  assert.match(partial.knownAtReason, /cut by the data's edge/);
  assert.deepEqual([none.eventStartMs, none.eventEndMs, none.knownAtMs], [null, null, null]);
  assert.match(none.knownAtReason, /not stated/);
});

test("a Rows band's when: the period it summarises, known as of the cutoff it was measured at", () => {
  const ms = (base) => Math.round((1609459200 + base * 56.25) * 1000);
  const w = EV.summary({ fromBase: 1000, throughBase: 2000 }, { cutoffMs: ms(2500) });
  assert.equal(w.eventStartMs, ms(1000));
  assert.equal(w.eventEndMs, ms(2000));
  assert.equal(w.knownAtMs, ms(2500), "as of the cutoff, not at the period's start");
  assert.match(w.knownAtReason, /not known when the period started/);
  assert.equal(EV.summary({ fromBase: 1000, throughBase: 2000 }, { cutoffMs: ms(900) }).knownAtMs, null, "a cutoff before the period began has no summary");
  assert.equal(EV.summary(null, { cutoffMs: ms(2500) }).eventStartMs, null);
  assert.equal(EV.summary({ fromBase: NaN, throughBase: 5 }, null).knownAtMs, null);
});
