"use strict";
// U56 (PRD-0002 S2, #47 section 1 and the acceptance list): the mask helper of the pixel specs, on synthetic frames.
// Oracle (not the code under test): footprints worked out by hand (a 100 px stroke 2 px wide covers 200 px, two boxes that overlap by a quarter cover 1.75
// boxes) and the geometry the PRD allows, written out: a stroke and its backing at most 4.5 px, a plate a line of text, a cap a bar.
const test = require("node:test");
const assert = require("node:assert/strict");
const masks = require("../browser/masks.js");

const frame = (over = {}) => ({ rects: [], strokeRects: [], strokes: [], fills: [], texts: [], arcs: [], roundRects: [], ...over });

test("a stroke's footprint is its subpaths' segments: two segments of a batched stroke are not joined, a closed rectangle path is", () => {
  const ops = masks.opsOf(
    frame({
      strokes: [
        { stroke: "#000", width: 2, dash: [], alpha: 1, seq: 0, path: [[0, 0], [10, 0], [50, 50], [60, 50]], subs: [[0, 0], [2, 0]] },
        { stroke: "#000", width: 1, dash: [], alpha: 1, seq: 1, path: [[0, 0], [10, 0], [10, 10], [0, 10]], subs: [[0, 1]] },
      ],
    }),
  );
  assert.equal(ops[0].segs.length, 2, "two segments, none between the end of the first and the start of the second");
  assert.ok(!masks.covers(ops[0], 30, 25, 0), "the line that would join them is not drawn");
  assert.ok(masks.covers(ops[0], 5, 0.9, 0));
  assert.equal(ops[1].segs.length, 4, "a closed path has its closing segment");
  assert.ok(masks.covers(ops[1], 0, 5, 0), "the closing edge");
});

test("a text's box follows its alignment and measured width; a marker is a disc; a plate is its box", () => {
  const ops = masks.opsOf(
    frame({
      texts: [
        { text: "left", x: 100, y: 50, align: "left", width: 40, fill: "#000", seq: 0 },
        { text: "right", x: 100, y: 50, align: "right", width: 40, fill: "#000", seq: 1 },
        { text: "mid", x: 100, y: 50, align: "center", width: 40, fill: "#000", seq: 2 },
      ],
      arcs: [{ x: 10, y: 10, r: 4.5, seq: 3 }],
      roundRects: [{ x: 5, y: 5, w: 60, h: 16, seq: 4 }],
    }),
  );
  assert.deepEqual([ops[0].box[0], ops[0].box[2]], [100, 140]);
  assert.deepEqual([ops[1].box[0], ops[1].box[2]], [60, 100]);
  assert.deepEqual([ops[2].box[0], ops[2].box[2]], [80, 120]);
  assert.ok(masks.covers(ops[3], 10, 14, 0), "inside the disc (radius 4.5 plus the stroke)");
  assert.ok(!masks.covers(ops[3], 10, 18, 0));
  assert.deepEqual(ops[4].box, [5, 5, 65, 21]);
});

test("added is a multiset difference: a mark both frames draw is not an addition, a second copy is", () => {
  const rect = (x, seq) => ({ x, y: 0, w: 10, h: 10, fill: "#111111", alpha: 1, seq });
  const base = masks.opsOf(frame({ rects: [rect(0, 0), rect(20, 1)] }));
  const over = masks.opsOf(frame({ rects: [rect(0, 0), rect(20, 1), rect(20, 2), rect(40, 3)] }));
  const extra = masks.added(base, over);
  assert.deepEqual(extra.map((o) => o.box[0]), [20, 40]);
  assert.deepEqual(masks.drawnAfter(over, 1).map((o) => o.box[0]), [20, 40]);
});

test("the union area counts an overlap once and a stroke at its width", () => {
  const plot = { x: 0, y: 0, w: 200, h: 100 };
  const boxes = masks.opsOf(frame({ rects: [{ x: 0, y: 0, w: 40, h: 40, fill: "#000", alpha: 1, seq: 0 }, { x: 20, y: 0, w: 40, h: 40, fill: "#000", alpha: 1, seq: 1 }] }));
  assert.equal(masks.unionArea(boxes, plot), 60 * 40, "two 40 x 40 boxes overlapping by half are 60 x 40 pixels");
  const line = masks.opsOf(frame({ strokes: [{ stroke: "#000", width: 2, dash: [], alpha: 1, seq: 0, path: [[10, 50.5], [110, 50.5]], subs: [[0, 0]] }] }));
  const area = masks.unionArea(line, plot);
  assert.ok(area >= 300 && area <= 312, `a 100 px line of 2 px centred on a pixel row touches that row and the half of the two beside it: about 300 px, a few more at the rounded ends (${area})`);
  const inside = masks.unionArea(masks.opsOf(frame({ rects: [{ x: 150, y: 0, w: 100, h: 10, fill: "#000", alpha: 1, seq: 0 }] })), plot);
  assert.equal(inside, 50 * 10, "only what lies in the plot is counted: columns 150 to 199, rows 0 to 9");
});

test("an oversized halo does not pass by being declared a mask: the limits name it", () => {
  const stroke = (width, seq = 0) => ({ stroke: "#000", width, dash: [], alpha: 1, seq, path: [[0, 5], [100, 5]], subs: [[0, 0]] });
  assert.deepEqual(masks.validate(masks.opsOf(frame({ strokes: [stroke(4.5)] }))), [], "a reference with its backing, 4.5 px, passes");
  const wide = masks.validate(masks.opsOf(frame({ strokes: [stroke(9)] })));
  assert.equal(wide.length, 1);
  assert.match(wide[0], /9 px stroke is wider than the 4.5 px backing/);
  const area = masks.validate(masks.opsOf(frame({ rects: [{ x: 0, y: 0, w: 300, h: 300, fill: "#000", alpha: 0.2, seq: 0 }] })));
  assert.match(area[0], /fill is an area/);
  assert.deepEqual(masks.validate(masks.opsOf(frame({ rects: [{ x: 0, y: 0, w: 300, h: 1.5, fill: "#000", alpha: 1, seq: 0 }] }))), [], "a 1.5 px cap across the plot is a bar");
  assert.deepEqual(masks.validate(masks.opsOf(frame({ roundRects: [{ x: 0, y: 0, w: 120, h: 16, seq: 0 }] }))), [], "a tag's plate passes");
  assert.match(masks.validate(masks.opsOf(frame({ roundRects: [{ x: 0, y: 0, w: 400, h: 16, seq: 0 }] })))[0], /plate is larger/);
  assert.match(masks.validate(masks.opsOf(frame({ texts: [{ text: "x", x: 0, y: 10, align: "left", width: 500, fill: "#000", seq: 0 }] })))[0], /longer than a label/);
  // a temporary surface's own marks are judged by its region: inside it they are not reported, outside it they are
  const inRegion = masks.opsOf(frame({ rects: [{ x: 10, y: 10, w: 100, h: 100, fill: "#000", alpha: 1, seq: 0 }] }));
  assert.deepEqual(masks.validate(inRegion, { allow: [[0, 0, 200, 200]] }), []);
  assert.equal(masks.validate(inRegion, { allow: [[300, 300, 400, 400]] }).length, 1);
});
