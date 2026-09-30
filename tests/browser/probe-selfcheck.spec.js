"use strict";
// B24 probe-selfcheck.spec.js (H7a): the probe and the observation helpers are checked before any other spec relies on them
// (TESTPLAN 3.3, 3.4 B24, DD-T28). Covers: S1-003 (no production debug endpoint: the probe is test-only and absent without its
// init script), D10 (the frame log is the evidence of "before every paint" invariants), D12 (the draw-frame definition the
// benchmark shares).
//
// Oracles, none of them the code under test:
//   * a synthetic page whose drawing script is written out literally below, so every expected count is a number counted by
//     hand from that script (there is no cube, and no page code is involved);
//   * a synthetic page with the D.18 markup written out literally, and one pixel painted with a literal colour;
//   * the ORIGINAL build 8c82ca1 (git show 8c82ca1:index.html, recorded snapshot, no cube): the real page, with an
//     independent counter of canvas.width assignments installed in this file (a second implementation of the one fact the
//     probe's frame definition rests on), and the documented baseline facts of DD-T28 (the page never calls clearRect).
// What this does NOT prove: that the heuristic glyph classifier recognises every glyph the final page draws (B16 pairs each
// glyph assertion with the generated key's data-count), and nothing about the candidate page, which no spec here loads.
const { test, expect, MissingSurfaceElement, observe, probeTools } = require("./fixtures.js");

// ---- the synthetic page of the probe (no D.18 markup beyond two chips and the main canvas) ----
// scene A paints a known set on #ol-canvas; the numbers it must produce are in EXPECT_A.
const SYNTHETIC = `<!doctype html><meta charset="utf-8"><title>probe synthetic</title>
<canvas id="ol-canvas" width="400" height="300"></canvas>
<canvas id="ol-ramp" width="64" height="8"></canvas>
<button id="ol-legend" data-channel="cells" data-state="no-calibration" data-fit-seq="0">cells</button>
<button id="ol-rows-legend" data-channel="rows" data-state="ready" data-fit-seq="0">rows</button>
<div id="unrelated" data-foo="1"></div>
<script>
const canvas = document.getElementById("ol-canvas"), other = document.getElementById("ol-ramp");
const cells = document.getElementById("ol-legend"), rows = document.getElementById("ol-rows-legend");
// The shapes of E.role.paint (tools/encoding-parts/12-role.js), one beginPath ... stroke()/fill() each.
const diamond = (c, x, y, s) => { c.beginPath(); c.moveTo(x, y - s / 2); c.lineTo(x + s / 2, y); c.lineTo(x, y + s / 2); c.lineTo(x - s / 2, y); c.closePath(); };
const triDown = (c, x, y, s) => { c.beginPath(); c.moveTo(x - s / 2, y - s / 2); c.lineTo(x + s / 2, y - s / 2); c.lineTo(x, y + s / 2); c.closePath(); };
const triUp = (c, x, y, s) => { c.beginPath(); c.moveTo(x - s / 2, y + s / 2); c.lineTo(x + s / 2, y + s / 2); c.lineTo(x, y - s / 2); c.closePath(); };
window.heartbeat = () => requestAnimationFrame(() => {
  // A callback that cleared through clearRect and resized ANOTHER canvas: not a draw frame (the page never calls clearRect).
  canvas.getContext("2d").clearRect(0, 0, 400, 300);
  other.width = 64;
});
window.sceneA = () => requestAnimationFrame(() => {
  canvas.width = 400; canvas.height = 300;                      // the page clears by assigning the size (geometry(), 743-744)
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, 1, 1);                                        // 1 clearRect
  c.fillStyle = "#ffffff"; c.fillRect(0, 0, 400, 300);            // 1 fillRect covering the surface
  c.lineWidth = 1; c.strokeStyle = "#00aa00";
  c.strokeRect(1, 1, 10, 10); c.strokeRect(20, 1, 10, 10);        // 2 strokeRect, green, 1 px
  c.lineWidth = 2; c.strokeStyle = "#0000ff"; c.setLineDash([4, 2]);
  c.strokeRect(40, 1, 10, 10); c.strokeRect(60, 1, 10, 10);       // 2 strokeRect, blue, 2 px, dashed
  c.setLineDash([]); c.lineWidth = 1; c.strokeStyle = "#333333"; c.fillStyle = "#cc3300";
  const pattern = c.createPattern(other, "repeat");               // 1 pattern
  c.fillStyle = pattern; c.fillRect(10, 20, 20, 20);              // 1 fillRect with the pattern
  c.fillStyle = "#cc3300";
  diamond(c, 100, 50, 6); c.stroke();                             // diamond 1
  diamond(c, 120, 50, 6); c.stroke();                             // diamond 2
  diamond(c, 140, 50, 6); c.fill(); c.stroke();                   // diamond 3: filled AND stroked, one path: counts once
  triDown(c, 100, 80, 6); c.fill();                               // triangleDown 1
  triUp(c, 120, 80, 6); c.fill();                                 // triangleUp 1
  triUp(c, 140, 80, 6); c.fill();                                 // triangleUp 2
  c.beginPath(); c.moveTo(100, 110); c.lineTo(106, 110); c.stroke();                                              // tick 1
  c.beginPath(); c.moveTo(120, 107); c.lineTo(126, 113); c.moveTo(126, 107); c.lineTo(120, 113); c.stroke();      // cross 1
  c.beginPath(); c.arc(100, 140, 3, 0, 2 * Math.PI); c.fill();                                                    // dot 1
  c.beginPath(); c.arc(120, 140, 3, 0, 2 * Math.PI); c.fill();                                                    // dot 2
  // Shapes that are NOT glyphs (6 paths): a pentagon, a square (vertices on corners, not side midpoints), a 2:1 rhombus,
  // an open triangle (no closePath), a half circle, a rect() path.
  c.beginPath(); c.moveTo(200, 50); c.lineTo(206, 54); c.lineTo(204, 60); c.lineTo(196, 60); c.lineTo(194, 54); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(220, 50); c.lineTo(226, 50); c.lineTo(226, 56); c.lineTo(220, 56); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(240, 50); c.lineTo(246, 53); c.lineTo(240, 56); c.lineTo(234, 53); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(260, 50); c.lineTo(266, 50); c.lineTo(263, 56); c.fill();
  c.beginPath(); c.arc(280, 53, 3, 0, Math.PI); c.stroke();
  c.beginPath(); c.rect(300, 50, 6, 6); c.fill();
  c.fillStyle = "#222222"; c.font = "11px sans-serif";
  c.fillText("a", 10, 200); c.fillText("b", 30, 200); c.fillText("c", 50, 200);   // 3 fillText
  other.width = 64;                                               // another canvas: its size is not a draw
  const o = other.getContext("2d");
  o.fillRect(0, 0, 64, 8); o.fillRect(0, 0, 4, 4);                // 2 fillRect on the other canvas
  diamond(o, 20, 4, 6); o.stroke();                               // 1 diamond on the other canvas
  cells.dataset.state = "ready"; cells.dataset.fitSeq = "1";
  document.getElementById("unrelated").dataset.foo = "2";         // not a chip: never logged
});
window.sceneB = () => requestAnimationFrame(() => {
  canvas.height = 300;                                            // the HEIGHT setter alone makes a draw frame too
  const c = canvas.getContext("2d");
  c.fillStyle = "#111111"; c.font = "11px sans-serif"; c.fillText("z", 5, 5);
  c.strokeStyle = "#444444"; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(10, 100); c.lineTo(20, 100); c.stroke();
  cells.dataset.state = "updating"; cells.dataset.fitSeq = "2"; rows.dataset.fitSeq = "7";
});
</script>`;

// What scene A draws, counted by hand from the script above.
const EXPECT_A = {
  ops: { clearRect: 1, fillRect: 2, fillRectFull: 1, strokeRect: 4, pattern: 1, setLineDash: 2, fillText: 3, fill: 8, stroke: 9, strokeText: 0 },
  // diamond 3 (one is filled and stroked), triangleUp 2, triangleDown 1, cross 1, dot 2, tick 1
  glyphs: { diamond: 3, triangleUp: 2, triangleDown: 1, cross: 1, dot: 2, tick: 1 },
  unclassified: 6,
  other: { fillRect: 2, diamond: 1 },
};

test.describe("B24 probe, synthetic page", () => {
  test("the frame log counts the known set, per draw frame, with attributes snapshotted at each frame end", async ({ page, probe }) => {
    await page.setContent(SYNTHETIC);
    expect(await probe.present()).toBe(true);

    // callback 1: not a draw (clearRect and another canvas's size do not make one)
    await page.evaluate(() => window.heartbeat());
    await expect.poll(async () => (await probe.stats()).callbacks).toBe(1);
    // a width assignment OUTSIDE any page callback is counted as such and must not leak into the next callback
    await page.evaluate(() => { document.getElementById("ol-canvas").width = 400; });
    await page.evaluate(() => window.heartbeat());
    await expect.poll(async () => (await probe.stats()).callbacks).toBe(2);
    expect((await probe.stats()).drawFrames).toBe(0);

    await page.evaluate(() => window.sceneA());
    await probe.waitForDrawFrames(1);
    await page.evaluate(() => window.sceneB());
    await probe.waitForDrawFrames(2);

    const stats = await probe.stats();
    const callbacks = await probe.callbacks();
    const [a, b] = await probe.frames();
    expect(callbacks.map((c) => c.draw)).toEqual([false, false, true, true]);
    expect(callbacks[0].mainOps).toBe(1);                      // it called clearRect on the main canvas and is still no draw
    expect(stats.outside.widthSets).toBe(1);
    expect(stats.widthSets).toBe(2);                            // the outside one and scene A's; scene B set only the height
    expect(stats.heightSets).toBe(2);
    expect(stats.dropped).toEqual({ frames: 0, callbacks: 0, mutations: 0 });

    // frame A: exactly the known set
    for (const [op, count] of Object.entries(EXPECT_A.ops)) expect(a.ops[op], `frame A ops.${op}`).toBe(count);
    expect(a.glyphs).toEqual(EXPECT_A.glyphs);
    expect(a.unclassified).toBe(EXPECT_A.unclassified);
    expect(a.widthSets).toBe(1);
    expect(a.heightSets).toBe(1);
    expect(a.other.ops.fillRect).toBe(EXPECT_A.other.fillRect);
    expect(a.other.glyphs.diamond).toBe(EXPECT_A.other.diamond);
    expect(a.ops.fillRect + a.ops.strokeRect).toBe(6);          // the other canvas's two fillRects are not in the main count
    // the styles in force: 4 strokeRect in two groups, the pattern fill, the plain fills
    const style = (op, pick) => a.styles.filter((s) => s.op === op && Object.entries(pick).every(([k, v]) => s[k] === v));
    expect(style("strokeRect", { strokeStyle: "#00aa00", lineWidth: 1, dash: "" }).map((s) => s.count)).toEqual([2]);
    expect(style("strokeRect", { strokeStyle: "#0000ff", lineWidth: 2, dash: "4,2" }).map((s) => s.count)).toEqual([2]);
    expect(style("fillRect", { fillStyle: "pattern" }).map((s) => s.count)).toEqual([1]);
    expect(style("fillRect", { fillStyle: "#ffffff" }).map((s) => s.count)).toEqual([1]);
    expect(style("fillText", { fillStyle: "#222222" }).map((s) => s.count)).toEqual([3]);

    // frame B: its own counts, nothing carried over from A (the boundaries are per draw)
    expect(b.ops.fillText).toBe(1);
    expect(b.ops.stroke).toBe(1);
    expect(b.ops.fillRect).toBe(0);
    expect(b.glyphs).toEqual({ diamond: 0, triangleUp: 0, triangleDown: 0, cross: 0, dot: 0, tick: 1 });
    expect(b.unclassified).toBe(0);
    expect(b.widthSets).toBe(0);
    expect(b.heightSets).toBe(1);
    expect(b.styles.find((s) => s.op === "stroke")).toMatchObject({ strokeStyle: "#444444", lineWidth: 1.5, dash: "" });
    expect([a.seq, b.seq]).toEqual([1, 2]);

    // attributes were snapshotted at the end of each draw frame, from the chips only
    expect(a.attrs).toEqual({ cells: { id: "ol-legend", channel: "cells", state: "ready", fitSeq: "1" }, rows: { id: "ol-rows-legend", channel: "rows", state: "ready", fitSeq: "0" } });
    expect(b.attrs).toEqual({ cells: { id: "ol-legend", channel: "cells", state: "updating", fitSeq: "2" }, rows: { id: "ol-rows-legend", channel: "rows", state: "ready", fitSeq: "7" } });

    // the mutation log: chip attributes only, old and new value, the frame that wrote them
    const mutations = (await probe.mutations()).map(({ channel, name, old, value, frameSeq }) => ({ channel, name, old, value, frameSeq }));
    expect(mutations).toEqual([
      { channel: "cells", name: "data-state", old: "no-calibration", value: "ready", frameSeq: 1 },
      { channel: "cells", name: "data-fit-seq", old: "0", value: "1", frameSeq: 1 },
      { channel: "cells", name: "data-state", old: "ready", value: "updating", frameSeq: 2 },
      { channel: "cells", name: "data-fit-seq", old: "1", value: "2", frameSeq: 2 },
      { channel: "rows", name: "data-fit-seq", old: "0", value: "7", frameSeq: 2 },
    ]);

    // reset starts a new window
    await probe.reset();
    expect(await probe.stats()).toMatchObject({ drawFrames: 0, callbacks: 0, widthSets: 0, heightSets: 0 });
    expect(await probe.frames()).toEqual([]);
  });

  test("the probe is absent, and the native setters untouched, in a page loaded without the init script", async ({ freshContext }) => {
    const plain = await (await freshContext({ probe: false })).newPage();
    await plain.setContent(SYNTHETIC);
    const without = await plain.evaluate(() => ({
      probe: typeof window.__probe,
      setter: Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width").set.toString(),
      raf: Object.getOwnPropertyDescriptor(window, "requestAnimationFrame").get === undefined,
      drawRect: CanvasRenderingContext2D.prototype.fillRect.toString(),
    }));
    expect(without.probe).toBe("undefined");
    expect(without.setter).toContain("[native code]");
    expect(without.drawRect).toContain("[native code]");
    expect(without.raf).toBe(true);                             // a plain data property, not the probe's accessor

    const probed = await (await freshContext()).newPage();
    await probed.setContent(SYNTHETIC);
    const withProbe = await probed.evaluate(() => ({ probe: typeof window.__probe, setter: Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width").set.toString(), enumerable: Object.keys(window).includes("__probe") }));
    expect(withProbe.probe).toBe("object");
    expect(withProbe.setter).not.toContain("[native code]");
    expect(withProbe.enumerable).toBe(false);                   // non-enumerable: it does not show among the page's own globals
  });

  test("the frame log keeps working when the page runs under page.clock", async ({ page, probe }) => {
    // page.clock replaces requestAnimationFrame after the probe wrapped it; the timing specs (B08, B13, B18) need the log then.
    await page.clock.install();
    await page.setContent(SYNTHETIC);
    await page.evaluate(() => window.sceneA());
    await page.clock.runFor(100);
    await probe.waitForDrawFrames(1);
    const [frame] = await probe.frames();
    expect(frame.glyphs).toEqual(EXPECT_A.glyphs);
    expect(frame.ops.fillRect).toBe(EXPECT_A.ops.fillRect);
    // its times are real ones, not the fake clock's
    expect(Number.isFinite(frame.dur) && frame.dur >= 0).toBe(true);
  });
});

// ---- the observation helpers (observe.js), against a synthetic page that has the D.18 markup ----
const OBSERVE_PAGE = `<!doctype html><meta charset="utf-8"><title>D.18 synthetic</title>
<canvas id="ol-canvas" width="100" height="50" tabindex="0"></canvas>
<button id="ol-legend" data-channel="cells" data-state="ready" data-policy="explore" data-mapping-id="0123456789abcdef" data-fit-seq="3" aria-label="Volume, Explore">26.8 M</button>
<div id="ol-legend-pop" role="dialog" hidden>
  <dd data-field="mappingId" data-value="0123456789abcdef">0123 4567</dd>
  <dd data-field="U" data-value="26800000">26.8 M</dd>
  <dd data-field="U" data-value="1">lens block</dd>
  <span data-warning="range-exceeded" data-share-marks="12" data-share-area="0.5">Scale range exceeded</span>
  <span data-key="zero" data-role="zero-outline" data-count="4">Zero</span>
</div>
<span id="ol-lens-status" data-channel="lens" data-state="pending" role="status"></span>
<div id="ol-notice" role="status"><p data-notice data-code="scale-changed" data-count="2">Scale changed</p></div>
<span id="ol-copy-status" role="status" data-address-level="exact">Copied</span>
<div id="ol-tip" data-readout="12:3:40:7"><span data-field="volume" data-canonical="1234.5">1.2 k</span></div>
<table><tr data-cell-key="12:3:41:7" data-level="12:3"><td data-field="volume" data-canonical="77">77</td><td data-field="trades" data-canonical="empty-population">not defined</td></tr></table>
<div id="ol-keys-scale"><span data-key="clip-high" data-role="tri-up" data-count="37">37</span><span data-key="zero" data-role="zero-outline" data-count="0">0</span></div>
<div id="ol-legend-marker" data-coordinate="0.25" data-readout="12:3:40:7"></div>
<script>
window.log = { keys: [], moves: [] };
const pop = document.getElementById("ol-legend-pop"), chip = document.getElementById("ol-legend"), canvas = document.getElementById("ol-canvas");
canvas.getContext("2d").fillStyle = "rgb(10, 20, 30)"; canvas.getContext("2d").fillRect(10, 10, 20, 20);
chip.addEventListener("keydown", (e) => { if (e.key === "Enter") pop.hidden = false; });
document.addEventListener("keydown", (e) => { window.log.keys.push(e.key); if (e.key === "Escape" && !pop.hidden) { pop.hidden = true; chip.focus(); } });
canvas.addEventListener("mousemove", (e) => { const r = canvas.getBoundingClientRect(); window.log.moves.push([e.clientX - r.left, e.clientY - r.top]); });
</script>`;

test.describe("B24 observation helpers", () => {
  test("every helper reads its D.18 element", async ({ page }) => {
    await page.setContent(OBSERVE_PAGE);
    const surface = observe(page);

    const cells = await surface.chip("cells");
    expect(cells).toMatchObject({ id: "ol-legend", tag: "button", label: "Volume, Explore", text: "26.8 M" });
    expect(cells.data).toEqual({ channel: "cells", state: "ready", policy: "explore", mappingId: "0123456789abcdef", fitSeq: "3" });
    expect((await surface.chip("lens")).data.state).toBe("pending");

    expect(await surface.notices()).toEqual([{ notice: "", code: "scale-changed", count: 2, text: "Scale changed" }]);
    expect(await surface.copyStatus()).toEqual({ level: "exact", text: "Copied" });
    expect(await surface.keys()).toEqual([{ key: "clip-high", role: "tri-up", count: 37, text: "37" }, { key: "zero", role: "zero-outline", count: 0, text: "0" }]);
    expect(await surface.legendMarker()).toEqual({ coordinate: "0.25", readout: "12:3:40:7", visible: true });
    expect(await surface.warnings()).toEqual([{ warning: "range-exceeded", shareMarks: "12", shareArea: "0.5" }]);

    // the tooltip when it shows the key, the table row otherwise
    expect(await surface.readout("12:3:40:7")).toMatchObject({ source: "tooltip", readout: "12:3:40:7", fields: { volume: { canonical: "1234.5", text: "1.2 k" } } });
    expect(await surface.readout("12:3:41:7")).toEqual({ key: "12:3:41:7", source: "table", level: "12:3", fields: { volume: { value: null, canonical: "77", text: "77" }, trades: { value: null, canonical: "empty-population", text: "not defined" } } });
    await expect(surface.readout("9:9:9:9")).rejects.toThrow(MissingSurfaceElement);
  });

  test("details open with the keyboard, read the fields and return focus on Escape", async ({ page }) => {
    await page.setContent(OBSERVE_PAGE);
    const surface = observe(page);
    const read = await surface.details("cells");
    expect(read.fields.mappingId).toEqual({ value: "0123456789abcdef", canonical: null, text: "0123 4567" });
    expect(read.fields.U.value).toBe("26800000");
    expect(read.fields["U#2"].value).toBe("1");                 // a repeated name is kept, not merged
    expect(read.warnings).toEqual([{ warning: "range-exceeded", shareMarks: "12", shareArea: "0.5" }]);
    expect(read.keys).toEqual([{ key: "zero", role: "zero-outline", count: 4, text: "Zero" }]);
    await expect(page.locator("#ol-legend-pop")).toBeHidden();  // closed again
    expect(await page.evaluate(() => document.activeElement.id)).toBe("ol-legend");
    expect(await page.evaluate(() => window.log.keys)).toEqual(["Enter", "Escape"]);
    await expect(surface.details("lens")).rejects.toThrow(/no popover of its own/);
    await expect(surface.details("nope")).rejects.toThrow(/unknown channel/);
  });

  test("preset keys, cell points and pixels", async ({ page, freshContext }) => {
    await page.setContent(OBSERVE_PAGE);
    const surface = observe(page, { locate: async (key) => (key === "12:3:40:7" ? { x: 15, y: 15 } : Promise.reject(new Error(`no ${key}`))) });
    expect(await surface.pressPreset(7)).toBe("7d");
    expect(await surface.pressPreset("0")).toBe("all");
    expect(await page.evaluate(() => window.log.keys)).toEqual(["7", "0"]);
    await expect(surface.pressPreset("a")).rejects.toThrow(RangeError);

    await surface.hoverCell("12:3:40:7");
    await surface.hoverCell({ x: 40, y: 25 });
    const moves = await page.evaluate(() => window.log.moves);
    expect(moves[moves.length - 2]).toEqual([15, 15]);
    expect(moves[moves.length - 1]).toEqual([40, 25]);
    expect(await surface.pixelAt({ x: 15, y: 15 })).toEqual([10, 20, 30, 255]);   // the colour painted by the synthetic page
    expect(await surface.pixelAt("12:3:40:7")).toEqual([10, 20, 30, 255]);
    expect(await surface.pixelAt({ x: 60, y: 40 })).toEqual([0, 0, 0, 0]);
    await expect(observe(page).pixelAt("12:3:40:7")).rejects.toThrow(/does not say where a cell is/);

    // any DPR other than 1 is refused
    const scaled = await (await freshContext({ deviceScaleFactor: 2 })).newPage();
    await scaled.setContent(OBSERVE_PAGE);
    await expect(observe(scaled).pixelAt({ x: 15, y: 15 })).rejects.toThrow(/needs DPR 1/);
  });

  test("an element D.18 names that the page lacks fails the spec naming it", async ({ page }) => {
    await page.setContent(SYNTHETIC);                           // no D.18 markup but two chips and the canvas
    const surface = observe(page, { timeout: 300 });
    await expect(surface.notices()).rejects.toThrow("D.18 element not found: notice banner (#ol-notice)");
    await expect(surface.chip("axis")).rejects.toThrow("D.18 element not found: chip axis (#ol-axis-chip)");
    await expect(surface.copyStatus()).rejects.toThrow(/copy status \(#ol-copy-status\)/);
    await expect(surface.keys()).rejects.toThrow(/#ol-keys-scale/);
    await expect(surface.details("cells")).rejects.toThrow(/details popover of the cells chip \(visible\) \(#ol-legend-pop\)/);
    expect(await surface.missing(["cells", "axis", "notice", "copyStatus"])).toEqual(["axis (#ol-axis-chip)", "notice (#ol-notice)", "copyStatus (#ol-copy-status)"]);
    const error = await surface.notices().catch((e) => e);
    expect(error).toBeInstanceOf(MissingSurfaceElement);
    expect(error.selector).toBe("#ol-notice");
  });
});

// ---- the baseline page (the second half of B24, FA-01): the probe against the real thing ----
// 8c82ca1 draws by assigning canvas.width in geometry() and never calls clearRect; a probe that only validated itself on a
// synthetic page could be wrong about that page (DD-T28). The page is the recorded snapshot served unmodified: no cube.
const COUNT_WIDTH_SETS = () => {
  // An independent second count of the one fact the draw frame rests on: how often the main canvas's size was assigned. It is
  // installed after the probe, so it sits on top of the probe's wrapper and sees every assignment the page makes.
  window.__indep = { width: 0, height: 0 };
  for (const dim of ["width", "height"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dim);
    Object.defineProperty(HTMLCanvasElement.prototype, dim, { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); }, set(v) { if (this.id === "ol-canvas") window.__indep[dim]++; d.set.call(this, v); } });
  }
};

test.describe("B24 baseline 8c82ca1", () => {
  test("the probe counts draw frames, stroke, fillText, fillRect and canvas size assignments on the original page", async ({ baselinePage }) => {
    // reduced motion: one draw per update, no 170 ms transition frames that would make the count timing dependent (DD-T33)
    const { page, fake, probe, surface } = await baselinePage({ mode: "recorded", contextOptions: { reducedMotion: "reduce" }, initScripts: [{ fn: COUNT_WIDTH_SETS }] });
    await probe.waitForDrawFrames(1);
    await probe.waitForQuiet();
    await probe.reset();
    await page.evaluate(() => { window.__indep.width = 0; window.__indep.height = 0; });

    // five wheel events, each one awaited until a frame has been drawn for it (several wheel events inside one animation frame
    // are one draw by design, so "one draw per event" is asked of events that are not coalesced)
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const WHEELS = 5;
    for (let i = 0; i < WHEELS; i++) {
      const before = (await probe.stats()).drawFrames;
      await page.mouse.wheel(0, i % 2 === 0 ? -240 : 240);
      await probe.waitForDrawFrames(before + 1);
    }
    const settled = await probe.waitForQuiet();
    const frames = await probe.frames();
    const stats = await probe.stats();
    const independent = await page.evaluate(() => ({ ...window.__indep }));

    expect(frames.length).toBe(settled);
    expect(frames.length).toBeGreaterThanOrEqual(WHEELS);        // at least one draw frame per event
    // the frame definition: one size assignment per draw frame, as counted by the probe AND by the independent counter
    expect(stats.widthSets).toBe(frames.length);
    expect(independent.width).toBe(frames.length);
    expect(independent.height).toBe(frames.length);
    expect(frames.every((f) => f.widthSets === 1 && f.heightSets === 1)).toBe(true);
    // what a draw is made of on this page: the probe sees strokes, texts and fills, and never a clearRect
    const sum = (key) => frames.reduce((n, f) => n + f.ops[key], 0);
    expect(sum("stroke")).toBeGreaterThan(0);
    expect(sum("fillText")).toBeGreaterThan(0);
    expect(sum("fillRect")).toBeGreaterThan(0);
    expect(sum("clearRect")).toBe(0);
    expect(frames.every((f) => f.ops.fillRectFull >= 1)).toBe(true);   // the secondary cross-check: each draw fills the whole surface
    // the log is well formed: frames in order, each with a duration and the (chip-less) attribute snapshot of this page
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
    expect(frames.every((f) => f.dur >= 0 && f.t > 0)).toBe(true);
    expect(frames.every((f) => Object.keys(f.attrs).length === 0)).toBe(true);
    // nothing was drawn outside a page callback, and the page asked for nothing from a cube
    expect(stats.outside.widthSets).toBe(0);
    expect(stats.outside.ops.fillRect + stats.outside.ops.stroke).toBe(0);
    expect(fake.log().filter((e) => e.path.startsWith("/cube/"))).toEqual([]);
    // and the observation helpers say what is missing on this page instead of guessing
    expect(await surface.missing(["cells", "notice"])).toEqual(["cells (#ol-legend)", "notice (#ol-notice)"]);
  });
});
