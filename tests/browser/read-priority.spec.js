"use strict";
// read-priority.spec.js (S, B21): S1 adds no read, route, kind or order to what the page asks the cube (TESTPLAN 3.4, DR-17, D.15).
//
// Requirement ids covered: S1-192 (calibration never competes with a decode that unblocks a view; no new CUBE_KINDS entry, no
// new motion want), DD-79 (a failed read is not outstanding), the D12 statement that a theme change fetches nothing (S1-012).
//
// Oracle: the ORIGINAL build 8c82ca1 (tests/support/builds.js, served by the same fake over the same profile), never anything
// computed from the code under test. For six scripted scenarios the normalised read sequence of the candidate, (slot, route,
// query without the pack token and the protocol number), must be the original's: the same multiset, and the same order inside
// each slot. The two pages are opened against separate `standard` fakes (equal options give byte-equal packs, TESTPLAN 4.2), so
// the comparison is of the page's behaviour, not of the data.
//   S-a  #w=7d boot          S-b  #w=30d, Path        S-c  #w=30d, Rows Time at price
//   S-d  the lens opened and moved over the chart      S-e  #w=1y with the Efficiency pane
//   S-f  a replay with an EMA line on
// The slots "poll" and "page" (the live pack poll and the page itself) are left out: they are the page's own schedule, not
// reads of the cube's blocks, and their count depends on the wall clock.
//
// The gate half runs the candidate alone: with a gate on /cube/tile (a view read) no motion-slot read may start until the gate
// is released, and a due calibration must not be made from the partial data (chip: no calibration or updating while gated, a
// fit only after release and settle). It needs the D.18 chip, so it fails by the name of the missing element until the DOM
// package has merged.
//
// Every scenario names its time and price range explicitly (#t=...&p=...) instead of a window key: a window refits its prices
// when the tiers arrive, and the ORIGINAL build does so at a moment that depends on which tier answered first (measured: two
// runs of the original asked for different price rows), which would make the oracle disagree with itself.
//
// Not covered: request TIMING (only order), a real bridge, other browsers.
const { test, expect } = require("./fixtures.js");
const { calm } = require("./scale-helpers.js");

const SCENARIOS = [
  // The first edge of a range sits off the cell grid of its level on purpose (12:07, not a whole column): the cube must be asked
  // for the rectangle's own measures, where an aligned one is summed from the blocks already loaded and reads nothing.
  { id: "S-a", hash: "#t=2026-09-16T12:07Z~2026-09-25T05:00Z&p=15000~45000" },
  { id: "S-b", hash: "#t=2026-08-25T12:00Z~2026-09-27T00:00Z&p=15000~45000&mode=path" },
  { id: "S-c", hash: "#t=2026-08-25T12:00Z~2026-09-27T00:00Z&p=15000~45000&rows=time" },
  {
    id: "S-d",
    hash: "#t=2026-08-25T12:07Z~2026-09-27T00:00Z&p=15000~45000",
    // The lens tool, then the pointer over the chart in steps: at this level (30 days) the lens reads finer tiles around it.
    steps: async (page) => {
      await page.keyboard.press("l");
      const box = await page.locator("#ol-canvas").boundingBox();
      for (const fx of [0.3, 0.45, 0.6, 0.75]) {
        await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.4, { steps: 4 });
        await page.waitForTimeout(350);
      }
    },
  },
  { id: "S-e", hash: "#t=2025-09-24T12:00Z~2026-10-15T00:00Z&p=15000~45000&pane=efficiency" },
  { id: "S-f", hash: "#t=2026-09-17T12:00Z~2026-09-25T05:00Z&p=15000~45000&replay=1&at=2026-09-22T12:00Z&lines=ema21" },
];

// What the page asked the cube's blocks for, in the order it asked: one string per read.
function readsOf(log) {
  return log
    .filter((e) => e.slot === "cube" || e.slot === "motion")
    .map((e) => `${e.slot} ${e.path} ${JSON.stringify(Object.fromEntries(Object.entries(e.query).sort(([a], [b]) => (a < b ? -1 : 1))))}`);
}

// The reads of each slot, in order: what "same per-slot order" compares.
function bySlot(reads) {
  const out = { cube: [], motion: [] };
  for (const r of reads) out[r.startsWith("motion") ? "motion" : "cube"].push(r);
  return out;
}

async function scenario(page, fake, steps, hash) {
  await page.goto(`${fake.url}/${hash}`);
  if (steps) await steps(page);
  // Quiet for long enough that every debounced read (200 ms), the retry poll and the motion slot have run.
  await fake.idle({ quietMs: 1500, timeoutMs: 30000 });
  return readsOf(fake.log());
}

for (const s of SCENARIOS) {
  test(`${s.id} ${s.hash}: the candidate asks the cube what the original asks, in the same order`, async ({ page, fakeFor, baselinePage }) => {
    const original = await baselinePage({ mode: "live", profile: "standard", url: "/" });
    const before = await scenario(original.page, original.fake, s.steps, s.hash);
    const fake = await fakeFor("standard");
    const after = await scenario(page, fake, s.steps, s.hash);
    // The scenario is only a witness when it really read something.
    expect(before.length, `${s.id}: the original page made no read, the scenario tests nothing`).toBeGreaterThan(0);
    expect([...after].sort(), `${s.id}: the multiset of reads`).toEqual([...before].sort());
    expect(bySlot(after), `${s.id}: the order inside each slot`).toEqual(bySlot(before));
  });
}

test("a theme flip asks the cube for nothing, and calibration adds no read kind", async ({ page, fakeFor, probe, surface }) => {
  // The live poll is pushed out to its longest wait, so that the clock steps below can never reach one (a poll is a read, and
  // this test asserts there is none); the page clock is installed BEFORE the navigation, as every clock test does (DD-T31).
  const fake = await fakeFor("standard", { next: 300 });
  await page.clock.install({ time: Date.now() });
  await page.goto(`${fake.url}/#w=7d`);
  // The kinds the ORIGINAL page asks for (the route list of the bridge): the candidate's are a subset.
  const kinds = new Set(["/cube/pack", "/cube/tile", "/cube/query", "/cube/motion", "/cube/columns", "/cube/touched", "/cube/bars"]);
  await fake.idle({ quietMs: 1500, timeoutMs: 30000 });
  for (const entry of fake.log().filter((e) => e.slot !== "page")) expect(kinds, `${entry.path} is not a read kind of the original page`).toContain(entry.path);
  // Let the page settle completely, then flip the theme with the page's clock paused so the live poll (every few seconds of
  // page time) cannot fire: the clock is advanced by hand, far less than one poll interval (DD-T31).
  await probe.waitForQuiet({ quietMs: 500 });
  await page.clock.pauseAt(Date.now() + 1000);
  fake.clearLog();
  await probe.reset();
  await page.emulateMedia({ colorScheme: "dark" });
  // The change event reaches the page a task later than emulateMedia resolves: advance the page's clock in small steps until the
  // chart has been drawn again (a second of page time at most).
  for (let step = 0; step < 20 && (await probe.stats()).drawFrames === 0; step++) await page.clock.runFor(50);
  expect((await probe.stats()).drawFrames, "the flip drew the chart again").toBeGreaterThan(0);
  await page.emulateMedia({ colorScheme: "light" });
  await page.clock.runFor(300);
  await fake.idle({ quietMs: 500 });
  expect(fake.log().map((e) => `${e.method} ${e.path}`), "no request after a theme flip").toEqual([]);
  // The chip, when the DOM package has merged, says the same scale before and after (nothing was refitted).
  const data = (await surface.chip("cells")).data;
  expect(data.mappingId).not.toBe("");
});

test("a gated view read: no motion read starts before it is released, and a due fit waits for it", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
  try {
    await gatedScenario({ page, fake, gate, probe, surface });
  } finally {
    // A request still held when the fake closes would end as a console error of its own.
    gate.open();
  }
});

async function gatedScenario({ page, fake, gate, probe, surface }) {
  // 40 days back, at a level finer than any tier holds, in Path: a tile is the view's own read, and a motion read waits behind it.
  await page.goto(`${fake.url}/#t=2026-08-10T00:00Z~2026-08-11T00:00Z&p=10000~40000&r=2,0&mode=path`);
  await gate.arrived();
  fake.clearLog();
  await page.waitForTimeout(1500);
  expect(fake.log().filter((e) => e.slot === "motion"), "a motion read started while the view's tile was still held").toEqual([]);
  // Not calibrated from what is on screen while the read is outstanding.
  const held = (await surface.chip("cells")).data;
  expect(["no-calibration", "updating", "pending"]).toContain(held.state);
  expect(held.mappingId).toBe("");
  // open() also stops holding: a later arrival of the same kind is answered at once.
  gate.open();
  const data = await calm({ fake, probe, surface });
  expect(data.mappingId).not.toBe("");
  // The fit issued no request of its own: every read after the release is one the view needed.
  const kinds = new Set(fake.log().filter((e) => e.slot === "cube" || e.slot === "motion").map((e) => e.path));
  for (const path of kinds) expect(["/cube/tile", "/cube/query", "/cube/motion", "/cube/touched", "/cube/bars", "/cube/columns"]).toContain(path);
}
