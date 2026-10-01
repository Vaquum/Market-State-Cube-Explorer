"use strict";
// U52 (PRD-0002 S2, #47 event strip): E.role.unionSpans merges the intervals of one event kind for drawing and keeps every constituent.
// Oracle (not the code under test): connectivity worked out by brute force, two events are in one span when a chain of pairwise overlaps (or touches)
// joins them, and a span runs from the smallest start to the largest end of its chain.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../support/enc");

function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// Brute force: union-find over pairwise overlap (touching counts).
function components(events) {
  const parent = events.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < events.length; i++)
    for (let j = i + 1; j < events.length; j++) if (events[i].t0 <= events[j].t1 && events[j].t0 <= events[i].t1) parent[find(i)] = find(j);
  const groups = new Map();
  events.forEach((e, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(e);
  });
  return [...groups.values()].map((g) => ({ t0: Math.min(...g.map((e) => e.t0)), t1: Math.max(...g.map((e) => e.t1)), n: g.length })).sort((a, b) => a.t0 - b.t0);
}

test("overlapping and touching events are one span; apart they are two", () => {
  const spans = E.role.unionSpans([{ t0: 10, t1: 20 }, { t0: 15, t1: 30 }, { t0: 30, t1: 35 }, { t0: 50, t1: 60 }]);
  assert.deepEqual(spans.map((s) => [s.t0, s.t1, s.events.length]), [[10, 35, 3], [50, 60, 1]]);
});

test("every constituent is kept, in order of start, whatever order they came in", () => {
  const events = [{ t0: 15, t1: 30, id: "b" }, { t0: 10, t1: 20, id: "a" }, { t0: 18, t1: 19, id: "c" }];
  const [span] = E.role.unionSpans(events);
  assert.deepEqual(span.events.map((e) => e.id), ["a", "b", "c"]);
  assert.equal(events[0].id, "b", "the input is not reordered");
});

test("an event inside another adds nothing to the span's extent", () => {
  const [span] = E.role.unionSpans([{ t0: 0, t1: 100 }, { t0: 10, t1: 20 }]);
  assert.deepEqual([span.t0, span.t1, span.events.length], [0, 100, 2]);
});

test("no events, no spans", () => assert.deepEqual(E.role.unionSpans([]), []));

test("against brute-force connectivity over 300 random sets", () => {
  const rand = lcg(5);
  for (let trial = 0; trial < 300; trial++) {
    const events = Array.from({ length: Math.floor(rand() * 14), }, () => {
      const t0 = Math.floor(rand() * 200);
      return { t0, t1: t0 + Math.floor(rand() * 30) };
    });
    const got = E.role.unionSpans(events).map((s) => ({ t0: s.t0, t1: s.t1, n: s.events.length }));
    assert.deepEqual(got, components(events), JSON.stringify(events));
  }
});
