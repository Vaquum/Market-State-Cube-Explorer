"use strict";
// The readiness barrier is held against independently controlled browser work. Loading is deliberately hidden and an
// earlier settled frame already exists, so neither loading-hidden nor a quiet canvas can incorrectly satisfy these cases.
const { test, expect, probeTools } = require("./fixtures.js");

const SYNTHETIC = `<!doctype html><meta charset="utf-8">
<canvas id="ol-canvas" width="100" height="50"></canvas>
<button id="ol-legend" data-channel="cells" data-state="ready" data-updating="false" data-fit-seq="0"></button>
<div id="ol-loading" hidden></div>
<script>
window.paint = () => requestAnimationFrame(() => {
  const canvas = document.getElementById("ol-canvas");
  canvas.width = 100;
  canvas.getContext("2d").fillRect(0, 0, 100, 50);
});
paint();
</script>`;

async function open(page, probe) {
  await page.setContent(SYNTHETIC);
  await probe.waitForReady();
}

const stillHeld = (probe, why) => expect(probe.waitForReady({ timeout: 150 }), why).rejects.toThrow(/view did not become ready/);

test("readiness holds for a required read, calibration, and its corresponding final draw", async ({ page, probe }) => {
  let held;
  await page.route("http://readiness.test/cube/query", (route) => { held = route; });
  await open(page, probe);
  await page.evaluate(() => {
    window.readDone = fetch("http://readiness.test/cube/query").then((r) => r.clone().json()).then(() => {
      const chip = document.getElementById("ol-legend");
      chip.dataset.state = "updating";
      chip.dataset.updating = "true";
      paint();
    });
  });
  await expect.poll(() => Boolean(held)).toBe(true);
  expect((await probe.readiness()).async).toContain("fetch /cube/query");
  await stillHeld(probe, "an earlier frame and hidden loading cannot hide the required read");
  await held.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
  await page.evaluate(() => window.readDone);
  await probe.waitForDrawFrames(2);
  expect((await probe.readiness()).unsettled).toEqual(["cells"]);
  await stillHeld(probe, "a decoded read still needs its calibration");
  await page.evaluate(() => {
    const chip = document.getElementById("ol-legend");
    chip.dataset.state = "ready";
    chip.dataset.updating = "false";
    chip.dataset.fitSeq = "1";
  });
  expect((await probe.readiness()).painted).toBe(false);
  await stillHeld(probe, "settled attributes still need the corresponding painted frame");
  await page.evaluate(() => paint());
  await probe.waitForReady();
  expect((await probe.frames()).at(-1).attrs.cells.fitSeq).toBe("1");
});

test("readiness holds while a startup body is decoding and requires a draw after it completes", async ({ page, probe }) => {
  await open(page, probe);
  await page.evaluate(() => {
    const stream = new ReadableStream({ start(controller) { window.finishDecode = () => controller.close(); } });
    window.decodeDone = new Response(stream).arrayBuffer();
  });
  expect((await probe.readiness()).async).toContain("arrayBuffer stream");
  await stillHeld(probe, "startup decompression can outlive network activity");
  await page.evaluate(() => { finishDecode(); return decodeDone; });
  expect((await probe.readiness()).async).toEqual([]);
  expect((await probe.readiness()).painted).toBe(false);
  await stillHeld(probe, "decoded data cannot be accepted against the preceding frame");
  await page.evaluate(() => paint());
  await probe.waitForReady();
});

test("readiness holds for short scheduled work, ignores the future poll, and tracks cancellation", async ({ page, probe }) => {
  await open(page, probe);
  await page.evaluate(() => {
    window.futurePoll = setTimeout(() => {}, 3000);
    window.shortWork = setTimeout(() => { document.getElementById("ol-legend").dataset.fitSeq = "2"; paint(); }, 500);
    const cancelledFrame = requestAnimationFrame(() => { throw Error("cancelled frame ran"); });
    cancelAnimationFrame(cancelledFrame);
    const cancelledTimer = setTimeout(() => { throw Error("cancelled timer ran"); }, 20);
    clearTimeout(cancelledTimer);
  });
  const pending = await probe.readiness();
  expect(pending.timers).toEqual([{ name: "anonymous", delay: 500 }]);
  expect(pending.rafs).toBe(0);
  await stillHeld(probe, "a delayed calibration has not yet begun");
  await probe.waitForReady();
  expect((await probe.frames()).at(-1).attrs.cells.fitSeq).toBe("2");
  await page.evaluate(() => clearTimeout(futurePoll));
});

test("a stuck required body and a calibration that never settles produce useful timeout diagnostics", async ({ page, probe }) => {
  await open(page, probe);
  await page.evaluate(() => {
    const stream = new ReadableStream({ start(controller) { window.end = () => controller.close(); } });
    window.decodeDone = new Response(stream).arrayBuffer();
  });
  await expect(probe.waitForReady({ timeout: 150 })).rejects.toThrow(/arrayBuffer stream/);
  await page.evaluate(() => { end(); return decodeDone; });
  await page.evaluate(() => {
    const chip = document.getElementById("ol-legend");
    chip.dataset.updating = "true";
    paint();
  });
  await expect(probe.waitForReady({ timeout: 150 })).rejects.toThrow(/"unsettled":\["cells"\]/);
});

test("a handled decode failure releases the barrier and an unchanged live poll needs no extra draw", async ({ page, probe }) => {
  await open(page, probe);
  await page.evaluate(() => {
    const broken = new ReadableStream({ start(controller) { controller.error(Error("controlled decode failure")); } });
    window.decodeDone = new Response(broken).arrayBuffer().catch(() => paint());
  });
  await page.evaluate(() => window.decodeDone);
  await probe.waitForReady();
  const before = (await probe.stats()).drawFrames;
  await page.route("http://readiness.test/cube/pack", (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"status":"unchanged"}',
  }));
  await page.evaluate(async () => { await (await fetch("http://readiness.test/cube/pack")).json(); });
  await probe.waitForReady();
  expect((await probe.stats()).drawFrames, "an unchanged poll owes no redraw").toBe(before);
});


test("equal performance timestamps cannot make an earlier frame satisfy a later decode", async ({ freshContext }) => {
  const page = await (await freshContext({ probe: false })).newPage();
  await page.setContent(SYNTHETIC);
  await page.evaluate(() => Object.defineProperty(performance, "now", { configurable: true, value: () => 123 }));
  await page.evaluate(probeTools.install, { canvas: { id: "ol-canvas" }, chip: "[data-channel]" });
  const probe = probeTools.forPage(page);
  await page.evaluate(() => paint());
  await probe.waitForReady();
  await page.evaluate(async () => { await new Response(new Uint8Array([1])).arrayBuffer(); });
  expect((await probe.frames()).at(-1).t).toBe(123);
  expect((await probe.readiness()).painted, "the decode finished after this frame, despite equal timestamps").toBe(false);
  await stillHeld(probe, "completion order must be strict even when the browser clock is coarse");
  await page.evaluate(() => paint());
  await probe.waitForReady();
  expect((await probe.frames()).at(-1).t).toBe(123);
});
