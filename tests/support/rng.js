"use strict";
// tests/support/rng.js (H1): the one seeded generator every test and the fake cube use.
// Tests never call Math.random(): a failure has to be replayable from its seed alone, and two
// runs with the same seed have to build byte-identical data.
// mulberry32 is small, has a 2^32 period and is written out here rather than imported, so the fake
// cube and the unit tests share one definition without a dependency. tools/benchmark/stats.mjs is an
// ES module with its own copy; U38 checks that both give the same first 1,000 draws for a fixed seed.

// mulberry32(seed) -> next(): a function returning the next float in [0, 1). The seed is coerced to
// an unsigned 32-bit integer, so 1, 1.9 and 2**32 + 1 are the same stream.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// int(next, lo, hi): an integer in [lo, hi], both ends included.
function int(next, lo, hi) {
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new RangeError(`int(${lo}, ${hi}): need integers with lo <= hi`);
  return lo + Math.floor(next() * (hi - lo + 1));
}

// pick(next, list): one element of a non-empty array.
function pick(next, list) {
  if (!list.length) throw new RangeError("pick: empty list");
  return list[Math.floor(next() * list.length)];
}

// shuffle(next, list): a new array holding the same elements in a seeded random order (Fisher-Yates,
// so every permutation is equally likely). The input is not modified.
function shuffle(next, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const held = out[i];
    out[i] = out[j];
    out[j] = held;
  }
  return out;
}

// normal(next, mean, sd): a normal draw by the Box-Muller transform. 1 - next() is in (0, 1], so the
// logarithm never sees zero.
function normal(next, mean = 0, sd = 1) {
  const u = 1 - next();
  const v = next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// subSeed(seed, label): a 32-bit seed derived from a parent seed and a text label (FNV-1a over the
// label, mixed with the seed), so one seed in a config yields independent streams for the trades, the
// jitter and the schedule without the streams sharing a prefix.
function subSeed(seed, label) {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

module.exports = { mulberry32, int, pick, shuffle, normal, subSeed };
