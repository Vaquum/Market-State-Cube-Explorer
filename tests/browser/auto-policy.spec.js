"use strict";
// auto-policy.spec.js (S, B08): the timing of Auto colour and of the Auto axis (TESTPLAN 3.4, DR-16, DR-17, DD-21, DD-64, DD-81).
//
// Requirement ids covered: S1-115..117 (when a calibration may run: coherent data, 200 ms after the last gesture, at most every
// 500 ms for Auto), S1-112 (an Auto axis holds through a gesture and refits after it), S1-121 (Play pauses Auto), DD-64 and DD-81
// (an axis cannot wake itself, so the spine's timer does: no further input is needed).
//
// How time is controlled: the page's clock is installed BEFORE the page loads, so that performance.now() is one continuous
// fake time from the first script (installed later it restarts near 0, and every stamp the page took before, the last gesture
// and the last Auto update, would lie in the future), flows by itself while the page loads and settles, and is then PAUSED
// (DD-T31). From there every timer, animation frame and performance.now() of the page is advanced by hand with runFor, in steps
// of 50 ms, and after each step the test waits for the fake cube to be quiet, because a read the page started answers in real
// time. A moment is therefore a number of milliseconds of page time since the last input, read with performance.now() in the
// page, never a wall-clock guess.
//
// Oracle: the page's own counters as relations (data-fit-seq moves, the chip says updating or paused) measured against page time;
// the thresholds 200 ms and 500 ms are the document's (D4), written here as constants of the requirement, not read from the module.
//
// Not covered: the exactness of the axis domain (B18), persistence of Auto (B14), a real timer of a real browser (the page clock
// replaces it, so a browser that throttles timers differently is not exercised).
const { test, expect } = require("./fixtures.js");
const { calm } = require("./scale-helpers.js");

const SETTLE_MS = 200;
const AUTO_MS = 500;
const STEP_MS = 50;

// Advance the page's clock by `ms` in STEP_MS steps. Returns the chip dataset after each step, with the page time of the step.
async function advance({ page, fake, surface }, ms, { stop = () => false } = {}) {
  const out = [];
  for (let spent = 0; spent < ms; spent += STEP_MS) {
    await page.clock.runFor(STEP_MS);
    await fake.idle({ quietMs: 30 });
    const now = await page.evaluate(() => performance.now());
    const data = (await surface.chip("cells")).data;
    out.push({ now, data });
    if (stop(data)) break;
  }
  return out;
}

// Open a calibrated page, choose Auto colour, and hand the clock over to the test.
async function startAuto(ctx, hash = "#w=7d") {
  const { page, fake, probe, surface } = ctx;
  await page.clock.install({ time: Date.now() });
  await page.goto(`${ctx.fake.url}/${hash}`);
  await calm(ctx);
  const button = async () => {
    const opened = await surface.openLegendDetails("cells");
    await opened.popover.getByRole("button", { name: /^Auto color/ }).focus();
    await page.keyboard.press("Enter");
    await opened.close().catch(() => {});
  };
  await button();
  const data = await calm(ctx);
  expect(data.policy, "Auto colour is on").toBe("auto");
  await probe.waitForQuiet({ quietMs: 600 });
  await page.clock.pauseAt(Date.now() + 200);
  return data;
}

// One small wheel step over the chart: a gesture that changes the view inside its context.
async function wheel(page, dy = -8) {
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, dy);
}

test("Auto colour: nothing commits inside a gesture or before the settle time", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  const start = await startAuto(ctx);
  const commits = [];
  let lastInput = 0;

  // A run of wheel steps 40 ms apart: a gesture. The chip says updating, the calibration does not move.
  for (let i = 0; i < 5; i++) {
    await wheel(page, i % 2 ? 8 : -8);
    lastInput = await page.evaluate(() => performance.now());
    const rows = await advance(ctx, 40);
    for (const { now, data } of rows) if (Number(data.fitSeq) !== Number(start.fitSeq)) commits.push(now);
    expect(rows.at(-1).data.updating, "during the gesture the chip says updating").toBe("true");
  }
  expect(commits, "no calibration inside the gesture").toEqual([]);

  // Then no input at all: the commit comes at least the settle time after the last input (the wheel also holds until its price
  // refit has landed, so later), and the chip stops saying updating with it.
  const rows = await advance(ctx, 3000, { stop: (d) => Number(d.fitSeq) !== Number(start.fitSeq) });
  const landed = rows.at(-1);
  expect(Number(landed.data.fitSeq), "the settled view is calibrated").toBe(Number(start.fitSeq) + 1);
  expect(landed.now - lastInput, "not before the settle time").toBeGreaterThanOrEqual(SETTLE_MS - STEP_MS);
  expect(landed.data.updating).toBe("false");
});

// The cap is per channel: a second data-driven update is at least AUTO_MS after the first, a first one after idle is not delayed by it.
// Window keys are navigation inside one context that holds nothing (no gesture), so only the cap and the read can delay the update.
test("Auto colour: updates are at least 500 ms apart, and the first one after idle waits for nothing", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  // 1h, 30m and 15m are windows of one context on this viewport (B06).
  const start = await startAuto(ctx, "#w=1h");
  const landing = async (key, from) => {
    await page.keyboard.press(key);
    const at = await page.evaluate(() => performance.now());
    const rows = await advance(ctx, 3000, { stop: (d) => Number(d.fitSeq) > from });
    const last = rows.at(-1);
    expect(Number(last.data.fitSeq), `window key ${key} was followed by an update`).toBeGreaterThan(from);
    return { at, landed: last.now, seq: Number(last.data.fitSeq) };
  };
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  // idle since the page settled: the update is only as late as the debounced read (200 ms) and the settle time allow
  const first = await landing("2", Number(start.fitSeq));
  expect(first.landed - first.at, "after idle nothing but the read and the settle time is waited for").toBeLessThan(AUTO_MS);
  // the very next navigation: its update must not come earlier than the cap allows
  const second = await landing("1", first.seq);
  expect(second.landed - first.landed, "two updates are at least the cap apart").toBeGreaterThanOrEqual(AUTO_MS - STEP_MS);
});

test("Explore never refits from same-pack navigation, Auto does", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  // Explore first: a page with the default policy.
  await page.goto(`${fake.url}/#w=7d`);
  const explore = await calm(ctx);
  expect(explore.policy).toBe("explore");
  await wheel(page, -8);
  await wheel(page, 8);
  const after = await calm(ctx);
  expect(Number(after.fitSeq), "Explore did not refit").toBe(Number(explore.fitSeq));
  // Then Auto on the same page.
  const opened = await surface.openLegendDetails("cells");
  await opened.popover.getByRole("button", { name: /^Auto color/ }).focus();
  await page.keyboard.press("Enter");
  await opened.close().catch(() => {});
  const auto = await calm(ctx);
  await wheel(page, -8);
  const moved = await calm(ctx);
  expect(auto.policy).toBe("auto");
  expect(Number(moved.fitSeq), "Auto refitted for the moved view").toBeGreaterThan(Number(auto.fitSeq));
});

test("Play pauses Auto colour; the pause or a scrub lets one settled update through", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await startAuto(ctx, "#w=24h&replay=1&at=2026-09-24T06:00Z");
  const base = (await surface.chip("cells")).data;
  expect(base.workspace).toBe("replay");
  // Space plays where no control takes it: the popover button that had focus would swallow it.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Space");
  // Five seconds of page time of Play: the chip says paused and nothing is committed.
  const rows = await advance(ctx, 5000);
  expect(rows.every(({ data }) => data.fitSeq === base.fitSeq), "no Auto commit while Play runs").toBe(true);
  expect(rows.at(-1).data.state, "the chip says Auto paused").toBe("paused");
  // Pause: one settled update, at least the settle time later.
  await page.keyboard.press("Space");
  const at = await page.evaluate(() => performance.now());
  const after = await advance(ctx, 2500, { stop: (d) => d.fitSeq !== base.fitSeq });
  const landed = after.at(-1);
  expect(Number(landed.data.fitSeq), "one update after the pause").toBe(Number(base.fitSeq) + 1);
  expect(landed.now - at, "not before the settle time").toBeGreaterThanOrEqual(SETTLE_MS - STEP_MS);
  expect(landed.data.state).not.toBe("paused");
});

// DD-64, DD-81: after the last wheel step and with no further input, the clock alone moves the Auto axis from updating to its
// new exact domain, because a draw cannot wake itself.
test("the Columns axis leaves updating with no further input", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.clock.install({ time: Date.now() });
  await page.goto(`${fake.url}/#w=7d`);
  await calm(ctx);
  const before = (await surface.chip("axis")).data;
  await probe.waitForQuiet({ quietMs: 600 });
  await page.clock.pauseAt(Date.now() + 200);
  for (let i = 0; i < 6; i++) {
    await wheel(page, 240);
    await advance(ctx, 40);
  }
  const held = (await surface.chip("axis")).data;
  expect(["updating", "paused"], "the axis holds during the gesture").toContain(held.axisState);
  // No input from here on: advance in steps until the chip says auto again, at most two seconds of page time.
  const rows = [];
  for (let spent = 0; spent < 2000; spent += STEP_MS) {
    await page.clock.runFor(STEP_MS);
    await fake.idle({ quietMs: 30 });
    const data = (await surface.chip("axis")).data;
    rows.push(data);
    if (data.axisState === "auto") break;
  }
  expect(rows.at(-1).axisState, "the axis left updating by itself").toBe("auto");
  expect(rows.at(-1).domain, "with the domain of the view it now shows").not.toBe("");
  expect(before.axisState).toBe("auto");
});
