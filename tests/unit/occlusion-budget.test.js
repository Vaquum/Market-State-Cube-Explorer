"use strict";
// U53 (PRD-0002 S2, #47 "cumulative 20% union-area occlusion budget"): E.role.occlusion.
// Oracle (not the code under test): the union area of a set of rectangles on the 2 px grid, worked out with a Set of "column,row" strings built by
// an independent loop over each rectangle's grid cells (not the planner's typed-array walk), and the greedy rule of the PRD replayed in a few lines
// over it: focused marks first, then by rank, a mark that would take the union past 20% of the plot is off unless it is focused.
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

const PLOT = { x: 63, y: 12, w: 400, h: 150 };
const CELL = 2;

// The grid cells a rectangle covers inside the plot, as a list of "c,r" keys.
function cellsOf(rect, plot = PLOT) {
  const cols = Math.ceil(plot.w / CELL),
    rows = Math.ceil(plot.h / CELL),
    keys = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const left = plot.x + c * CELL,
        top = plot.y + r * CELL;
      // the cell [left, left + CELL) x [top, top + CELL) is covered when the rectangle reaches into it: the planner's own convention is that a
      // rectangle covers every cell from the one holding its first edge to the one holding its last edge
      const inC = Math.floor((rect[0] - plot.x) / CELL) <= c && c <= Math.floor((rect[2] - plot.x) / CELL),
        inR = Math.floor((rect[1] - plot.y) / CELL) <= r && r <= Math.floor((rect[3] - plot.y) / CELL);
      if (inC && inR && left < plot.x + plot.w && top < plot.y + plot.h) keys.push(c + "," + r);
    }
  return keys;
}

// The greedy rule replayed over sets.
function replay(candidates, plot = PLOT, budget = 0.2) {
  const cols = Math.ceil(plot.w / CELL),
    rows = Math.ceil(plot.h / CELL),
    limit = Math.floor(cols * rows * budget),
    taken = new Set(),
    off = new Set();
  let focusOver = false,
    shown = 0;
  const order = candidates.map((m, i) => [m, i]).sort(([a, i], [b, j]) => Number(b.hot) - Number(a.hot) || a.rank - b.rank || i - j);
  for (const [m] of order) {
    const mine = new Set(m.rects.flatMap((r) => cellsOf(r, plot)));
    let cost = 0;
    for (const k of mine) if (!taken.has(k)) cost++;
    if (!m.hot && taken.size + cost > limit) {
      off.add(m.id);
      continue;
    }
    if (m.hot && taken.size + cost > limit) focusOver = true;
    for (const k of mine) taken.add(k);
    shown++;
  }
  return { off, focusOver, shown, used: taken.size, limit };
}

function randomCandidates(rand, n) {
  return Array.from({ length: n }, (_, i) => {
    const rects = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
      const x0 = PLOT.x - 10 + rand() * (PLOT.w + 20),
        y0 = PLOT.y - 10 + rand() * (PLOT.h + 20);
      return [x0, y0, x0 + rand() * 250, y0 + 1 + rand() * 30];
    });
    return { id: "m" + i, hot: rand() < 0.1, rank: 1 + Math.floor(rand() * 5), rects };
  });
}

test("the planner agrees with the set-based replay of the rule on 400 random scenes", () => {
  const rand = lcg(31);
  let suppressed = 0;
  for (let trial = 0; trial < 400; trial++) {
    const candidates = randomCandidates(rand, 1 + Math.floor(rand() * 12)),
      got = E.role.occlusion(candidates, PLOT, { budget: 0.2, cell: 2 }),
      want = replay(candidates);
    assert.deepEqual([...got.off].sort(), [...want.off].sort(), "the marks that are off");
    assert.equal(got.shown, want.shown);
    assert.equal(got.eligible, candidates.length);
    assert.equal(got.used, want.used, "the union area in grid cells, overlaps once");
    assert.equal(got.limit, want.limit);
    assert.equal(got.focusOver, want.focusOver);
    if (got.off.size) suppressed++;
  }
  assert.ok(suppressed > 50, "the scenes exercised suppression (" + suppressed + ")");
});

test("without a focused mark the union never passes 20% of the heatmap", () => {
  const rand = lcg(77);
  for (let trial = 0; trial < 200; trial++) {
    const candidates = randomCandidates(rand, 1 + Math.floor(rand() * 15)).map((m) => ({ ...m, hot: false })),
      got = E.role.occlusion(candidates, PLOT),
      cells = Math.ceil(PLOT.w / 2) * Math.ceil(PLOT.h / 2);
    assert.ok(got.used <= 0.2 * cells + 1e-9, `used ${got.used} of ${cells}`);
    assert.equal(got.focusOver, false);
  }
});

test("overlaps are counted once: a hundred marks on the same rectangle cost what one does", () => {
  const rect = [100, 40, 300, 44],
    one = E.role.occlusion([{ id: "a", hot: false, rank: 1, rects: [rect] }], PLOT),
    many = E.role.occlusion(Array.from({ length: 100 }, (_, i) => ({ id: "m" + i, hot: false, rank: 1, rects: [rect] })), PLOT);
  assert.equal(many.used, one.used);
  assert.equal(many.off.size, 0, "they all fit, being one cover");
});

test("lower priority goes first: of two that do not fit together, the one of lower rank number stays", () => {
  // each covers 12% of the plot: only one fits under 20%
  const tall = (x) => [x, PLOT.y, x + 0.12 * PLOT.w, PLOT.y + PLOT.h],
    got = E.role.occlusion([{ id: "low", hot: false, rank: 4, rects: [tall(100)] }, { id: "high", hot: false, rank: 1, rects: [tall(250)] }], PLOT);
  assert.deepEqual([...got.off], ["low"]);
  assert.equal(got.shown, 1);
});

test("the focused mark is never thinned; when it alone needs more than the budget that is said, not hidden by a wider casing", () => {
  const huge = [PLOT.x, PLOT.y, PLOT.x + PLOT.w, PLOT.y + PLOT.h],
    got = E.role.occlusion([{ id: "focus", hot: true, rank: 9, rects: [huge] }, { id: "other", hot: false, rank: 1, rects: [[100, 40, 120, 44]] }], PLOT);
  assert.equal(got.off.has("focus"), false, "the focused mark stays");
  assert.equal(got.focusOver, true, "and the excess is reported");
  assert.equal(got.off.has("other"), true, "what cannot fit beside it is off");
});

test("rectangles outside the plot cost nothing; an empty plot plans nothing", () => {
  assert.equal(E.role.occlusion([{ id: "x", hot: false, rank: 1, rects: [[-500, -500, -400, -300]] }], PLOT).used, 0);
  const none = E.role.occlusion([{ id: "x", hot: false, rank: 1, rects: [[0, 0, 10, 10]] }], { x: 0, y: 0, w: 0, h: 0 });
  assert.equal(none.eligible, 0);
});

test("the plan does not scan history: its work is the rectangles' cells and it allocates one grid", () => {
  const big = Array.from({ length: 2000 }, (_, i) => ({ id: "m" + i, hot: false, rank: 1 + (i % 5), rects: [[100 + (i % 50), 20 + (i % 100), 160 + (i % 50), 22 + (i % 100)]] })),
    started = process.hrtime.bigint();
  E.role.occlusion(big, PLOT);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 200, "2000 marks plan in " + ms.toFixed(1) + " ms");
});
