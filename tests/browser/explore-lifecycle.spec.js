"use strict";
// explore-lifecycle.spec.js (S, B05): the usefulness gate of Explore on the live path (TESTPLAN 3.4, DR-06, D4).
//
// Requirement ids covered (API.md Appendix E): S1-101 and S1-102 (one calibration context per effective resolution), S1-107
// (Explore initialises once per context and then freezes), S1-108 (a change of context is disclosed with the previous and the
// current id and its cause), S1-118 (the 64-context cache and the disclosure of an eviction), S1-121 (the usefulness gate run
// as a scenario), DD-20/DD-21 (the lifecycle).
//
// What it does: a fresh browser context, the `standard` fake, 24h -> 7d -> 30d -> 1y -> all and back again with the real
// window keys. Every context is identified by the chip's data-context (the page's own key string), so the test never predicts
// an id, it checks relations: a new context calibrates once (data-fit-seq moves by exactly one), a context that was visited
// keeps its id when it is visited again and nothing is fitted (data-fit-seq does not move), each context change is disclosed
// with the previous and the current id and a cause of `resolution` or `period`, a maximum-fit cohort clips nothing on the high
// side, and the actions that stay inside a context (a pan, a wheel step that keeps the level, a selection added and
// cleared, a live advance that slides the window) change neither the id nor the counter.
//
// Oracle: relations between observed values (equality, inequality, increments of one). The one recomputation is the mapping id
// of the displayed descriptor with the module's own E.scale.id, a consistency check and stated as such (TESTPLAN 3.1). No value
// is taken from the code under test's internals.
//
// The eviction test needs the browser-local cache of package P (`scales:v1`): it pre-fills that cache with 64 synthetic
// contexts through an init script, in the shape E.store.toJSON gives (`{visualVersion: 2, contexts: [...]}`, which is what the
// design says the cache holds), so it fails with its own message, not by accident, when the page does not read the cache.
//
// Not covered: the recorded page (B02), replay (B13), Auto (B08), persistence beyond this cache (B14).
const { test, expect } = require("./fixtures.js");
const E = require("../support/enc.js");
const { calm, gotoWindow, identity, field } = require("./scale-helpers.js");

const ORDER = ["24h", "7d", "30d", "1y", "all"];

// The contexts the page has ever shown a mapping for, and the ids each had, from the probe's frame log: every draw frame carries
// the chip's attributes as they were written in that very draw (D.18 "Frame invariants"), so this sees transient contexts too.
// A window key can pass through a context for a moment before the row level settles (the price range is refitted when the data
// arrives), and a context that held for the settle time is calibrated like any other; counting by frames keeps the test exact
// whatever the timing.
async function calibratedContexts(probe) {
  const out = new Map();
  for (const frame of await probe.frames()) {
    const chip = frame.attrs && frame.attrs.cells;
    if (!chip || !chip.mappingId) continue;
    if (!out.has(chip.context)) out.set(chip.context, new Set());
    out.get(chip.context).add(chip.mappingId);
  }
  return out;
}

test("a new context calibrates once, a visited one is restored, every change is disclosed", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=24h`);
  await page.locator("#ol-reference-toggle").click();
  await page.locator("#ol-reference-topic").selectOption("scales");
  let data = await calm(ctx);
  expect(data.mappingId, "the first context is calibrated").not.toBe("");
  let previous = data;

  // Every window, forward and back: the invariants of the whole log hold after each one.
  for (const name of [...ORDER.slice(1), ...[...ORDER].reverse().slice(1)]) {
    data = await gotoWindow(ctx, name);
    const known = await calibratedContexts(probe);
    // One commit per context that was ever calibrated: a revisit fits nothing, a new context exactly once.
    expect(Number(data.fitSeq), `${name}: data-fit-seq is the number of contexts calibrated so far`).toBe(known.size);
    // Explore freezes: no context ever showed two different mappings.
    for (const [context, ids] of known) expect(ids.size, `${name}: ${context} kept one mapping`).toBe(1);
    expect(known.get(data.context), `${name}: the displayed mapping is the context's`).toEqual(new Set([data.mappingId]));
    if (data.context === previous.context) continue;
    // A change of context is disclosed with the previous and the current id and a cause of level or period. The previous id is
    // the last SETTLED one: the one the page showed before, or a transient context it passed through.
    const details = await surface.details("cells");
    expect(field(details, "scaleChangeTo"), `${name}: the disclosure names the current id`).toBe(data.mappingId);
    const from = field(details, "scaleChangeFrom");
    expect(from, `${name}: and a previous one that differs from it`).not.toBe(data.mappingId);
    expect([...known.values()].some((ids) => ids.has(from)), `${name}: the previous id is one the page showed`).toBe(true);
    expect(field(details, "scaleChangeCause"), `${name}: the cause is the level or the period`).toMatch(/resolution|period/);
    // Explore is fitted on the fully measured cells of the view: the maximum is the top of the scale, so nothing is above it.
    expect(Number(field(details, "clipHighFinite")), `${name}: a maximum-fit cohort clips nothing above`).toBe(0);
    previous = data;
  }
  const known = await calibratedContexts(probe);
  expect(known.size, "five windows open several contexts").toBeGreaterThan(2);
});

// DR-54: the recorded page (a snapshot, no cube: nothing is ever read) calibrates exactly like the live one. It once waited for a
// view read that could never come, so it stayed at "No calibration" for good. The fake serves the committed page unmodified and
// fails any /cube request it gets, so a page that asked the cube for anything fails the test at teardown as well.
test("the recorded page calibrates like the live one: once per context, restored on a revisit", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("recorded");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=24h`);
  const first = await calm(ctx);
  expect(first.state, "the snapshot is calibrated").toBe("ready");
  expect(first.mappingId).not.toBe("");
  expect(first.fitSeq, "by one fit").toBe("1");
  expect(first.workspace).toBe("live");
  const wide = await gotoWindow(ctx, "30d");
  expect(wide.context, "another window is another context").not.toBe(first.context);
  expect(wide.mappingId, "with a calibration of its own").not.toBe("");
  expect(wide.fitSeq).toBe("2");
  const back = await gotoWindow(ctx, "24h");
  expect(back.context).toBe(first.context);
  expect(back.mappingId, "a revisit restores the mapping").toBe(first.mappingId);
  expect(back.fitSeq, "and fits nothing").toBe("2");
  expect(fake.log().filter((entry) => entry.path.startsWith("/cube/")), "the page asked the cube for nothing").toEqual([]);
});

// The identity of the displayed descriptor is the mapping id of its numbers (a consistency check, TESTPLAN 3.1).
test("the mapping id is the id of the displayed numbers", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  await page.goto(`${fake.url}/#w=24h&r=4,0`);
  const data = await calm({ page, fake, probe, surface });
  const details = await surface.details("cells");
  const U = Number(field(details, "U"));
  const k = Number(field(details, "k"));
  const id = await page.evaluate(([u, kk]) => window.explorerEncoding.scale.id({ v: 1, kind: "value-log1p", signed: false, params: { U: u, k: kk }, clip: "clamp01@1" }), [U, k]);
  expect(data.mappingId).toBe(id);
});

// What stays inside a context changes neither the mapping nor the counter (S1-107: freeze).
test("same-context actions never change the mapping or the counter", async ({ page, fakeFor, probe, surface }) => {
  const fake = await fakeFor("standard");
  const ctx = { page, fake, probe, surface };
  await page.goto(`${fake.url}/#w=24h`);
  const base = identity(await calm(ctx));
  const box = await page.locator("#ol-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const same = async (what) => {
    expect(identity(await calm(ctx)), `${what}: the context, the mapping and the counter are unchanged`).toEqual(base);
  };

  // a pan
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 80, cy, { steps: 6 });
  await page.mouse.up();
  await same("a pan");

  // a wheel step small enough to keep the level
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -10);
  await same("a wheel step that keeps the level");

  // a selection added, then cleared
  await page.keyboard.press("s");
  await page.mouse.move(cx - 120, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 60, { steps: 6 });
  await page.mouse.up();
  await same("a selection added");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await same("the selection cleared");

  // a live advance: new minutes arrive by delta and the 24h window slides with them
  const before = await page.locator("#ol-cutoff").textContent();
  fake.advance({ minutes: 3 });
  await expect.poll(async () => page.locator("#ol-cutoff").textContent(), { timeout: 15000, message: "the page follows the cube's new cutoff" }).not.toBe(before);
  await same("a live advance (delta)");
});

// S1-118: the browser-local cache keeps 64 contexts; a context it let go is initialised again and says so.
test("an evicted context is initialised again and says so", async ({ page, fakeFor, probe, surface, browser }) => {
  const fake = await fakeFor("standard");
  // The 7d context of this viewport, found on a first, throw-away visit (its key string is what the cache is keyed by).
  const scout = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 })).newPage();
  await scout.goto(`${fake.url}/#w=7d`);
  await scout.locator("#ol-reference-toggle").click();
  await scout.locator("#ol-reference-topic").selectOption("scales");
  await fake.idle({ quietMs: 1500, timeoutMs: 30000 });
  const first = await scout.evaluate(() => document.getElementById("ol-legend").dataset.context);
  await scout.context().close();
  expect(first, "the scout page calibrated the 7d context").toMatch(/^cells\|/);
  const [, instrument, measure, basis, unit, transform, formula, quality, workspace, level] = first.split("|");
  const [n, m] = level.slice(1).split("m").map(Number);
  const record = (context) => {
    const d = E.scale.fitValue([1, 2, 3, 4], {}).descriptor;
    return { v: 1, key: E.context.keyString(context), ctx: context, desc: d, policy: "explore", origin: "fit", workspace: "live", cohort: { kind: "cells", n: 4, zeros: 0, nonzero: 4 }, obsEndMs: 1790000000000, cutMs: 1790000000000, fittedAtMs: 1790000000100, algorithm: d.algorithm, seq: 1 };
  };
  const store = E.store.create();
  // The oldest entry is the 7d context, then 63 others of measures this test never visits.
  store.commit("live", record({ consumer: "cells", instrument, measure, basis, unit, transform, formula, quality, workspace, n, m }), () => []);
  let made = 1;
  for (const measureName of ["trades", "size"])
    for (let level = 0; level < 16 && made < 64; level++)
      for (let row = 0; row < 4 && made < 64; row++) {
        store.commit("live", record(E.context.cellsKey({ measure: measureName, basis: "amount", n: level, m: row, workspace: "live", instrument })), () => []);
        made++;
      }
  expect(made).toBe(64);
  // the page's storage keys carry the prefix of state.js
  await page.addInitScript((json) => {
    try {
      localStorage.setItem("market-state-cube-explorer:scales:v1", json);
    } catch (error) {
      /* a document with no storage (about:blank) has nothing to seed */
    }
  }, JSON.stringify(store.toJSON("live")));

  // The page starts at 24h, a context the cache does not hold. Its calibration is the 65th context: the least recently used one
  // (the 7d context, which this tab has not used, and which an entry merged from storage is older than anything the tab used) goes.
  await page.goto(`${fake.url}/#w=24h`);
  await page.locator("#ol-reference-toggle").click();
  await page.locator("#ol-reference-topic").selectOption("scales");
  const ctx = { page, fake, probe, surface };
  let data = await calm(ctx);
  expect(data.fitSeq, "the 24h context was calibrated").toBe("1");
  // The 7d context is found no more: it is initialised again and the details say so.
  data = await gotoWindow(ctx, "7d");
  expect(data.mappingId, "the cache's 7d mapping (a stand-in) is gone, not shown").not.toBe(E.scale.fitValue([1, 2, 3, 4], {}).descriptor.id);
  expect(Number(data.fitSeq), "the evicted context is calibrated again").toBe(2);
  expect(field(await surface.details("cells"), "evicted")).toBe("true");
});
