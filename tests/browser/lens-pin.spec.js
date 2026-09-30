"use strict";
// lens-pin.spec.js (L; B12 and B12b of TESTPLAN 3.4): the transient lens, its scale, its tiles and Pin.
//
// What this file asserts, in two groups:
//
//   A. Tiles and the display source (DD-26 as amended by DD-96). They need nothing but the chart and the fake cube, so they run on
//      every build:
//        * in a coarse-fallback view (`#w=1y` on `standard`: only the overview tier covers it), opening, moving and closing the lens
//          without Pin leaves the canvas byte for byte as it was, although the lens read a finer tile from the cube (the fake's
//          request log shows it), and issues no read but the tile (no measure, Rows or motion read);
//        * the CONTROL: the original build 8c82ca1 draws the chart differently after the same steps, because its lens tile became the
//          block the chart is drawn from (maps/lens-resolution.md G3), so the scenario can tell the two behaviours apart;
//        * B12b: once the requested level is made equal to the lens tile's, the chart adopts the tile already loaded, with no further
//          read and no other input;
//        * Pin promotes the lens's region and level: the tile becomes the block shown and the requested level is the lens's.
//
//   B. The lens's scale and the disclosures (D.18 chips, which the spine (S) and the DOM package (U) write). They are the
//      assertions of B12 about ids: the lens shares the Cells mapping (same id, caption names Shared), Local contrast has its own
//      id that repeats at the same lens bounds and never enters the persisted 64-context cache, opening and moving the lens leaves
//      the Cells and Rows ids, `data-fit-seq` and the Rows period alone and issues no Rows read, and Pin discloses
//      "Scale changed: pin/resolution" with the old and new ids of the channels that changed. A D.18 element the page does not have
//      yet makes the test say so and skip with that reason (a skipped test is listed by the runner); with CONVERGENCE=1 (K, CI) it
//      FAILS instead, so the assertions can never be skipped at the end.
//
// Oracles: the fake cube's request log and the pixels of #ol-canvas at device pixel ratio 1 (neither is computed by the code under
// test); the ORIGINAL build 8c82ca1 for the control; window.explorerEncoding only to recompute a mapping id from the descriptor the
// page states (a consistency check, named as one, never the source of an expected value).
//
// Not covered here: what a person sees in the lens (colours are checked against the pinned LUT by the scratch-instrumented runs in the
// package report, not by a committed test, because the lens rectangle is page geometry the address does not fix), keyboard and
// touch parity of the lens (#48), and any browser but Chromium.
const { test, expect, probeTools } = require("./fixtures.js");

// The coarse-fallback fixture (TESTPLAN 3.4 B12): a 119-day view on `standard`, which only the overview tier (12, 3) covers, asked
// for at level (11, 0), with Rows on. The cube's own read of the view's tile is refused (an injected failure), so the chart stays a
// coarse fallback at rest; the lens then reads a finer tile (10, 1), which is exactly the tile that, on the original build, became the
// block the chart was drawn from (maps/lens-resolution.md G3). The address fixes the rectangle, the level follows from the plot.
const COARSE_VIEW = "/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&rows=volume";
// The level the view asks for (the address and the plot decide it: the test reads it and checks it), whose tile the fake refuses.
const VIEW_TILE_N = 11;
const refuseViewTile = (fake) => fake.on({ route: /^\/cube\/tile/, when: (query) => Number(query.n) === VIEW_TILE_N }).fail({ status: 500 });
const CONVERGENCE = Boolean(process.env.CONVERGENCE);

// Loaded, every read answered and no draw for a moment: the page is at rest. A refused tile leaves the page's alert up for good (it
// says which read failed), so "loaded" is a hidden progress line or that alert.
async function atRest(page, fake, probe) {
  await page.waitForFunction(() => {
    const line = document.getElementById("ol-loading");
    return line.hidden || line.getAttribute("role") === "alert";
  });
  await fake.idle({ quietMs: 600, timeoutMs: 30000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
}

// SHA-256 of every byte of the main canvas, and how many distinct colours it holds (capped): a blank canvas cannot pass as unchanged.
async function pixelsOf(page) {
  return page.evaluate(async () => {
    const canvas = document.getElementById("ol-canvas");
    const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    const seen = new Set();
    for (let i = 0; i < data.length && seen.size < 64; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return { hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""), colours: seen.size, dpr: window.devicePixelRatio };
  });
}

// The level asked for and the level drawn, from the resolution plane's status line (written on every update): "Requested n 11 · m 2"
// and, only when the drawn level is coarser, " · displayed n 12 · m 3".
async function levels(page) {
  const text = await page.locator("#ol-plane-status").evaluate((el) => el.textContent);
  const match = /Requested n (\d+) · m (\d+)(?: · displayed n (\d+) · m (\d+))?/.exec(text);
  if (!match) throw new Error(`the plane status line has no levels: ${JSON.stringify(text)}`);
  const requested = { n: Number(match[1]), m: Number(match[2]) };
  const displayed = match[3] === undefined ? requested : { n: Number(match[3]), m: Number(match[4]) };
  return { requested, displayed, coarse: match[3] !== undefined };
}

// The resolution plane as the page draws it: the readiness kind of every (n, m) cell ("unavailable", "loading", "small", "large",
// "ready"), read with the popover open (the page refreshes the plane only while it is visible) and closed again.
async function planeKinds(page) {
  await page.locator("#ol-res").click();
  await page.locator("#ol-res-pop").waitFor({ state: "visible" });
  const kinds = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("#ol-plane button")].map((b) => [`${b.dataset.n}:${b.dataset.m}`, /ol-plane-(unavailable|loading|small|large|ready)/.exec(b.className)?.[1] ?? b.className])),
  );
  await page.keyboard.press("Escape");
  await page.locator("#ol-res-pop").waitFor({ state: "hidden" });
  return kinds;
}

// The lens at rest in the middle of the plot: the tool (L), the pointer over the plot and three positions, so that a moving lens is
// part of it, then the page at rest again (the lens's tile read, if any, has answered).
async function openLens(page, fake, probe, { moves = [[0.5, 0.45], [0.44, 0.5], [0.56, 0.4]], tile = false } = {}) {
  const box = await page.locator("#ol-canvas").boundingBox();
  await page.mouse.move(box.x + box.width * moves[0][0], box.y + box.height * moves[0][1]);
  await page.keyboard.press("l");
  for (const [fx, fy] of moves) await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  // The page asks the cube for the lens's tile 200 ms after the last pointer move (the read debounce), so "idle" is not yet true:
  // wait for the request itself, then for the answer.
  if (tile) await expect.poll(() => tileReads(fake).length, { timeout: 15000, message: "the lens asked the cube for its tile" }).toBeGreaterThan(0);
  await atRest(page, fake, probe);
}

// The lens closed without Pin (Escape returns to the pan tool) and the pointer off the canvas, so that neither a crosshair nor the
// lens is in the picture.
async function closeLens(page, fake, probe) {
  await page.keyboard.press("Escape");
  await page.mouse.move(2, 2);
  await atRest(page, fake, probe);
}

const tileReads = (fake) => fake.log().filter((entry) => entry.path === "/cube/tile");

// The reads the lens may cause: the tile and the pack poll. Anything else is a read the chart or Rows would answer to.
const otherReads = (entries) => entries.filter((entry) => entry.path !== "/cube/tile" && entry.path !== "/cube/pack");

// The D.18 chip surface the assertions of group B read: a missing element skips the test and says which (CONVERGENCE=1 fails it).
async function needSurface(surface, names) {
  const absent = await surface.missing(names);
  if (!absent.length) return;
  const reason = `INTEGRATION.md D.18 element(s) not on this page yet (packages S and U write them): ${absent.join(", ")}`;
  if (CONVERGENCE) throw new Error(reason);
  test.skip(true, reason);
}

// One chip's attributes, the parts B12 compares.
const idsOf = async (surface, channel) => {
  const chip = await surface.chip(channel);
  return { mappingId: chip.data.mappingId ?? "", fitSeq: chip.data.fitSeq ?? "", context: chip.data.context ?? "", policy: chip.data.policy ?? "", state: chip.data.state ?? "", rowSize: chip.data.rowSize ?? "", effectiveN: chip.data.effectiveN ?? "", effectiveM: chip.data.effectiveM ?? "", text: chip.text };
};

test.describe("B12b the lens tile never becomes the display source before Pin", () => {
  test("a peek in a coarse-fallback view leaves the canvas as it was and reads only the tile", async ({ fakeFor, freshContext, allowConsole }) => {
    const fake = await fakeFor("standard");
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    const context = await freshContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const probe = probeTools.forPage(page);
    await page.goto(`${fake.url}${COARSE_VIEW}`);
    await atRest(page, fake, probe);

    const start = await levels(page);
    expect(start.coarse, "the view is a coarse fallback: the level drawn is coarser than the level asked for").toBe(true);
    expect(start.requested.n, "the level the fixture refuses the tile of is the level asked for").toBe(VIEW_TILE_N);
    const before = await pixelsOf(page);
    expect(before.dpr).toBe(1);
    expect(before.colours, "the canvas is not blank").toBeGreaterThan(4);

    fake.clearLog();
    await openLens(page, fake, probe, { tile: true });
    expect(tileReads(fake).length, "the lens asked the cube for a finer tile").toBeGreaterThan(0);
    expect(otherReads(fake.log()).map((e) => e.path), "opening and moving the lens issues no measure, Rows or motion read").toEqual([]);
    await closeLens(page, fake, probe);

    expect(await levels(page), "the level drawn is unchanged").toEqual(start);
    const after = await pixelsOf(page);
    expect(after.hash, "the chart is drawn exactly as before the peek").toBe(before.hash);
    expect(otherReads(fake.log()).map((e) => e.path), "and the peek caused no other read").toEqual([]);
  });

  test("control: the original build's chart changes after the same peek (its lens tile became the display source)", async ({ baselinePage, allowConsole }) => {
    // The fault rule must exist before the page asks, so the page is opened on a harmless route first and sent to the view here.
    const { page, fake } = await baselinePage({ mode: "live", profile: "standard", contextOptions: { reducedMotion: "reduce" }, url: "/healthz" });
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    const probe = probeTools.forPage(page);
    await page.goto(`${fake.url}${COARSE_VIEW}`);
    await atRest(page, fake, probe);
    const start = await levels(page);
    const before = await pixelsOf(page);
    expect(start.coarse, "the same scenario is a coarse fallback on the original build").toBe(true);
    await openLens(page, fake, probe, { tile: true });
    await closeLens(page, fake, probe);
    const after = await pixelsOf(page);
    const end = await levels(page);
    const changed = after.hash !== before.hash || end.displayed.n !== start.displayed.n || end.displayed.m !== start.displayed.m;
    expect(changed, "without the lens flag the peek changes what the chart is drawn from: the scenario has teeth").toBe(true);
  });

  test("the resolution plane does not move for a tile only the lens read", async ({ fakeFor, freshContext, allowConsole }) => {
    const fake = await fakeFor("standard");
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    const context = await freshContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const probe = probeTools.forPage(page);
    await page.goto(`${fake.url}${COARSE_VIEW}`);
    await atRest(page, fake, probe);
    const start = await levels(page);
    const before = await planeKinds(page);
    expect(Object.keys(before).length, "the plane is the 21 x 10 lattice").toBe(210);
    // The lens tile is `depth` (2) levels finer than the level drawn: its cell is not one the plane may call ready.
    const lensLevel = `${start.displayed.n - 2}:${start.displayed.m - 2}`;
    expect(before[lensLevel], "before the peek nothing can show the lens's level").toBe("unavailable");

    await openLens(page, fake, probe, { tile: true });
    await closeLens(page, fake, probe);
    expect(tileReads(fake).filter((entry) => Number(entry.query.n) !== VIEW_TILE_N).length, "the lens read its tile").toBeGreaterThan(0);
    expect(await planeKinds(page), "the plane is as it was: a lens tile is not a block that can show a level").toEqual(before);
  });

  test("B12b: a tile the lens read is adopted, with no further read, once the view asks for it", async ({ fakeFor, freshContext, allowConsole }) => {
    const fake = await fakeFor("standard");
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    const context = await freshContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const probe = probeTools.forPage(page);
    await page.goto(`${fake.url}${COARSE_VIEW}`);
    await atRest(page, fake, probe);
    const start = await levels(page);
    expect(start.coarse).toBe(true);

    await openLens(page, fake, probe, { tile: true });
    await closeLens(page, fake, probe);
    const tiles = tileReads(fake).filter((entry) => Number(entry.query.n) !== VIEW_TILE_N);
    expect(tiles.length, "the lens read its tile").toBeGreaterThan(0);
    // The lens tile is `depth` (2) levels finer than the level drawn, in time and in price.
    const target = { n: start.displayed.n - 2, m: start.displayed.m - 2 };
    expect(tiles[tiles.length - 1].query, "the tile is at the lens level").toMatchObject({ n: String(target.n), m: String(target.m) });
    expect((await levels(page)).coarse, "closing the lens without Pin changed nothing: still the coarse fallback").toBe(true);

    // Ask for exactly the tile's level with the level keys: [ ] step time, { } step price. Both keys go before the page's 200 ms read
    // debounce runs, so the only level it ever asks a tile for is the final one.
    const now = await levels(page);
    const keys = [];
    for (let i = 0; i < Math.abs(target.n - now.requested.n); i++) keys.push(target.n < now.requested.n ? "[" : "]");
    for (let i = 0; i < Math.abs(target.m - now.requested.m); i++) keys.push(target.m < now.requested.m ? "{" : "}");
    const tilesBefore = tileReads(fake).length;
    for (const key of keys) await page.keyboard.press(key);
    await page.waitForTimeout(600);
    await atRest(page, fake, probe);
    const adopted = await levels(page);
    expect(adopted.requested, "the keys asked for the tile's level").toEqual(target);
    expect(adopted.displayed, "the chart now shows the tile's level, which no other input asked for").toEqual(target);
    expect(tileReads(fake).length, "and it was not read again").toBe(tilesBefore);
  });

  test("Pin promotes the lens's region and level: the tile becomes the block shown", async ({ fakeFor, freshContext, allowConsole }) => {
    const fake = await fakeFor("standard");
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    const context = await freshContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    const probe = probeTools.forPage(page);
    await page.goto(`${fake.url}${COARSE_VIEW}`);
    await atRest(page, fake, probe);
    const start = await levels(page);
    expect(start.coarse).toBe(true);

    await openLens(page, fake, probe, { tile: true });
    const tilesBefore = tileReads(fake).length;
    await page.keyboard.press("Enter");
    await atRest(page, fake, probe);
    const pinned = await levels(page);
    expect(pinned.requested, "the requested level is the lens's").toEqual({ n: start.displayed.n - 2, m: start.displayed.m - 2 });
    expect(pinned.displayed, "and the tile the lens read is what is drawn").toEqual(pinned.requested);
    expect(tileReads(fake).length, "the pinned view used the loaded tile").toBe(tilesBefore);
  });
});

test.describe("B12 the lens's scale, Local contrast and Pin (D.18 chips)", () => {
  test("the lens shares the Cells mapping: one id, and the caption names Shared", async ({ fakeFor, page, surface, probe }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=7d`);
    await atRest(page, fake, probe);
    await needSurface(surface, ["cells", "lens"]);
    await openLens(page, fake, probe);
    const cells = await idsOf(surface, "cells");
    const lens = await idsOf(surface, "lens");
    expect(cells.mappingId, "the Cells channel has a mapping").not.toBe("");
    expect(lens.mappingId, "the lens draws with the Cells mapping: the same id").toBe(cells.mappingId);
    expect(lens.text, "the caption names whose scale it is").toMatch(/shared/i);
    expect(lens.policy).not.toBe("local");
  });

  test("Local contrast is explicit: its own id, the same at the same lens bounds, never in the persisted 64 contexts", async ({ fakeFor, page, surface, probe }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=7d`);
    await atRest(page, fake, probe);
    await needSurface(surface, ["cells", "lens"]);
    await openLens(page, fake, probe);
    const shared = await idsOf(surface, "lens");

    // The toggle of the lens bar (#ol-lens-local, package U) is a checkbox.
    const toggle = page.locator("#ol-lens-local");
    await toggle.check();
    await atRest(page, fake, probe);
    await expect.poll(async () => (await idsOf(surface, "lens")).policy, { timeout: 10000 }).toBe("local");
    const local = await idsOf(surface, "lens");
    expect(local.mappingId, "a descriptor of its own").not.toBe("");
    expect(local.mappingId, "a different id from the shared mapping").not.toBe(shared.mappingId);
    expect((await idsOf(surface, "cells")).mappingId, "the Cells channel did not move").toBe(shared.mappingId);

    // Off and on again at the same lens bounds (the pointer has not moved): the same descriptor, the same id.
    await toggle.uncheck();
    await atRest(page, fake, probe);
    await expect.poll(async () => (await idsOf(surface, "lens")).policy, { timeout: 10000 }).not.toBe("local");
    await toggle.check();
    await atRest(page, fake, probe);
    await expect.poll(async () => (await idsOf(surface, "lens")).policy, { timeout: 10000 }).toBe("local");
    expect((await idsOf(surface, "lens")).mappingId, "repeatable at the same bounds").toBe(local.mappingId);

    // The Local descriptor is ephemeral: no context of the browser-local cache (scales:v1) is a lens context.
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes("scales")).map((key) => localStorage.getItem(key)));
    for (const value of stored) expect(value, "the persisted workspace holds no lens context").not.toContain("lens|");
  });

  test("opening and moving the lens leaves the Cells and Rows ids, data-fit-seq and the Rows period unchanged and reads no Rows", async ({ fakeFor, page, surface, probe, allowConsole }) => {
    const fake = await fakeFor("standard");
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    await page.goto(`${fake.url}${COARSE_VIEW}`);
    await atRest(page, fake, probe);
    await needSurface(surface, ["cells", "rows", "lens"]);
    const before = { cells: await idsOf(surface, "cells"), rows: await idsOf(surface, "rows") };
    expect(before.cells.mappingId).not.toBe("");

    fake.clearLog();
    await openLens(page, fake, probe, { moves: [[0.5, 0.45], [0.3, 0.5], [0.7, 0.4], [0.45, 0.6]], tile: true });
    expect(tileReads(fake).length, "the lens tile request is in the fake's log").toBeGreaterThan(0);
    expect(otherReads(fake.log()).map((e) => e.path), "no Rows (or measure) read").toEqual([]);

    const after = { cells: await idsOf(surface, "cells"), rows: await idsOf(surface, "rows") };
    for (const channel of ["cells", "rows"]) {
      expect(after[channel].mappingId, `${channel} mapping id`).toBe(before[channel].mappingId);
      expect(after[channel].fitSeq, `${channel} data-fit-seq`).toBe(before[channel].fitSeq);
      expect(after[channel].context, `${channel} context (Rows: period and effective row size)`).toBe(before[channel].context);
    }
    expect(after.cells.effectiveN, "effective level").toBe(before.cells.effectiveN);
    expect(after.cells.effectiveM).toBe(before.cells.effectiveM);
    expect(after.rows.rowSize, "Rows effective row size").toBe(before.rows.rowSize);
    // A peek leaves the state of the chip alone too (B12b, DD-96: the lens tile cannot flip the measurement).
    expect(after.cells.state).toBe(before.cells.state);
    await closeLens(page, fake, probe);
    const closed = { cells: await idsOf(surface, "cells"), rows: await idsOf(surface, "rows") };
    expect(closed.cells.mappingId).toBe(before.cells.mappingId);
    expect(closed.rows.mappingId).toBe(before.rows.mappingId);
  });

  test("B12b: a peek changes neither the chip state nor the fit of an Auto color mapping (the lens tile cannot flip the measurement)", async ({ fakeFor, page, surface, probe, allowConsole }) => {
    const fake = await fakeFor("standard");
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    // The view's rectangle lies on the lens tile's grid (16 h columns, 250 USDT rows), so a tile that could count as a block that tiles
    // it would turn the measurement from the cube's answer into "exact" and so change the memo key an Auto refit is keyed on (DD-96).
    const aligned = `/#t=2026-05-27T16:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2&cp=a`;
    await page.goto(`${fake.url}${aligned}`);
    await atRest(page, fake, probe);
    await needSurface(surface, ["cells"]);
    await expect.poll(async () => (await idsOf(surface, "cells")).mappingId, { timeout: 15000, message: "Auto color has its mapping" }).not.toBe("");
    const before = await idsOf(surface, "cells");
    expect(before.policy, "the address chose Auto color").toBe("auto");
    await openLens(page, fake, probe, { tile: true });
    await page.waitForTimeout(800);
    await closeLens(page, fake, probe);
    await page.waitForTimeout(800);
    const after = await idsOf(surface, "cells");
    expect(after.state, "data-state").toBe(before.state);
    expect(after.fitSeq, "no Auto refit: data-fit-seq").toBe(before.fitSeq);
    expect(after.mappingId).toBe(before.mappingId);
  });

  test("Pin discloses 'Scale changed: pin/resolution' with the old and new ids of Cells and Rows", async ({ fakeFor, page, surface, probe, allowConsole }) => {
    const fake = await fakeFor("standard");
    refuseViewTile(fake);
    allowConsole(/Failed to load resource/);
    await page.goto(`${fake.url}${COARSE_VIEW}`);
    await atRest(page, fake, probe);
    await needSurface(surface, ["cells", "rows"]);
    const before = { cells: await idsOf(surface, "cells"), rows: await idsOf(surface, "rows") };
    await openLens(page, fake, probe, { tile: true });
    await page.keyboard.press("Enter");
    await atRest(page, fake, probe);
    // The disclosure is written by the settled draw; the popover fields carry the cause and the ids (D.18 "Details").
    await expect.poll(async () => (await idsOf(surface, "cells")).mappingId, { timeout: 15000, message: "the pinned level has its own mapping" }).not.toBe("");
    const after = { cells: await idsOf(surface, "cells"), rows: await idsOf(surface, "rows") };
    const details = await surface.details("cells");
    const cause = details.fields.scaleChangeCause;
    expect(cause, "the Cells details disclose a scale change").toBeTruthy();
    expect(cause.canonical ?? cause.value ?? "", "caused by the pin").toMatch(/pin/);
    expect(cause.text.toLowerCase()).toMatch(/pin/);
    expect(cause.text.toLowerCase()).toMatch(/resolution/);
    expect(details.fields.scaleChangeFrom.text, "the old mapping id").toContain(before.cells.mappingId);
    expect(details.fields.scaleChangeTo.text, "the new mapping id").toContain(after.cells.mappingId);
    // Rows: the setting and the period are the person's and stay; the effective row size moves with the level, so the context (and
    // with it the disclosure) may change. The period label is the same either way.
    const parts = (context) => context.split("|");
    expect(parts(after.rows.context)[2], "the Rows measure is as it was").toBe(parts(before.rows.context)[2]);
    expect(parts(after.rows.context)[9], "the Rows period identity is as it was").toBe(parts(before.rows.context)[9]);
    if (after.rows.mappingId !== before.rows.mappingId) {
      const rows = await surface.details("rows");
      expect(rows.fields.scaleChangeCause.text.toLowerCase(), "Rows disclose the change too").toMatch(/pin/);
      expect(rows.fields.scaleChangeFrom.text).toContain(before.rows.mappingId);
      expect(rows.fields.scaleChangeTo.text).toContain(after.rows.mappingId);
    }
  });
});
