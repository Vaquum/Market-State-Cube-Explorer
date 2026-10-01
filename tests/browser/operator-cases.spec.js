"use strict";
// B51 operator-cases.spec.js (PRD-0002 S3, #48 section 4, the operator protocol): the predetermined answers of the committed 24-case protocol are what the PAGE says.
//
// The protocol (tests/fixtures/palette/operator-protocol.json, docs/operator-protocol.md) gives each task an address on a named fixture and a predetermined answer.
// The unit test (U63) recomputes every data-derived answer from the reference calculator; this spec opens each case's address on the real page and reads what Inspect
// says about the cells the task names (the readout the operator is told to read), and the two scale cases on the page's own mapping ids. A case whose answer the page
// does not support fails here, before an operator is asked to answer it.
// Oracles (none is the code under test): the protocol's own words, which the reference calculator derived (U63), and the page's readout as the user reads it.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");
const H = require("./scale-helpers.js");
const fs = require("node:fs");
const path = require("node:path");

const PROTOCOL = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../fixtures/palette/operator-protocol.json"), "utf8"));
const BASE_S = 56.25,
  ROW_USDT = 125;
const EPOCH = Date.parse("2021-01-01T00:00:00Z");

// Where the pointer goes to be over a cell of the case's level: the middle of the part of the cell that is inside the view.
function point(hash, layout, box, [n, m], [c, r]) {
  const t = /[#&]t=([^~&]+)~([^&]+)/.exec(hash),
    p = /[&]p=([\d.]+)~([\d.]+)/.exec(hash),
    t0 = (Date.parse(t[1].replace(/Z$/, ":00Z").replace(/(\d\d:\d\d):00:00Z/, "$1:00Z")) - EPOCH) / 1000,
    t1 = (Date.parse(t[2].replace(/(T\d\d:\d\d)Z$/, "$1:00Z")) - EPOCH) / 1000,
    p0 = Number(p[1]),
    p1 = Number(p[2]),
    colW = 2 ** n * BASE_S,
    rowH = 2 ** m * ROW_USDT,
    a0 = Math.max(t0, c * colW),
    a1 = Math.min(t1, (c + 1) * colW),
    lo = Math.max(p0, r * rowH),
    hi = Math.min(p1, (r + 1) * rowH);
  return [box.x + layout[0] + ((((a0 + a1) / 2 - t0) / (t1 - t0)) * layout[2]), box.y + layout[1] + (((p1 - (lo + hi) / 2) / (p1 - p0)) * layout[3])];
}

const dataCases = PROTOCOL.cases.filter((c) => c.page?.checks);
for (const theme of ["light", "dark"])
  test.describe(`B51 the protocol's data cases, read from the page (${theme})`, () => {
    for (const c of dataCases.filter((x) => x.theme === theme))
      test(`${c.id}: ${c.title}`, async ({ page, probe, fakeFor }) => {
        const fake = await fakeFor(c.fixture);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.setViewportSize({ width: 1500, height: 950 });
        await page.goto(`${fake.url}/${c.address}`);
        await S.atRest(page, fake, probe);
        await probe.waitForQuiet({ quietMs: 600, timeout: 30000 });
        const level = /[&#]r=(\d+),(\d+)/.exec(c.address).slice(1, 3).map(Number),
          layout = (await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout)).split(",").map(Number),
          box = await page.locator("#ol-canvas").boundingBox();
        for (const check of c.page.checks) {
          const [x, y] = point(c.address, layout, box, level, check.cell);
          // the first reading is E over the cell; the next ones are clicks in Inspect, which move the cursor and change nothing else
          if (!(await page.locator("#ol-inspect").isVisible())) {
            await page.mouse.move(x, y);
            await page.waitForTimeout(300);
            await page.keyboard.press("e");
          } else await page.mouse.click(x, y);
          await expect(page.locator("#ol-inspect")).toBeVisible();
          await page.waitForTimeout(300);
          const readout = (await page.locator("#ol-inspect-readout").innerText()).replace(/\n/g, " | ");
          for (const words of check.contains) expect(readout, `${c.id}, cell ${check.cell}: the readout says "${words}"`).toContain(words);
        }
        await page.keyboard.press("Escape");
      });
  });

test.describe("B51 the protocol's scale cases, read from the page's own mappings", () => {
  test("OP-05: the window changes from 24 hours to all history: the calibration is not the same", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    const ctx = { page, fake, probe, surface };
    await page.goto(`${fake.url}/${PROTOCOL.cases.find((c) => c.id === "OP-05").address}`);
    const day = await H.calm(ctx);
    expect(day.policy).toBe("explore");
    const all = await H.gotoWindow(ctx, "all");
    expect(all.policy, "still Explore: nobody locked anything").toBe("explore");
    expect(all.mappingId, "a different window is another context and another mapping: the colours of the two views are not comparable").not.toBe(day.mappingId);
  });

  test("OP-24: the measure changes from Volume to Delta: the mapping is another one", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    const ctx = { page, fake, probe, surface };
    const address = PROTOCOL.cases.find((c) => c.id === "OP-24").address;
    await page.goto(`${fake.url}/${address}&mode=volume`);
    const volume = await H.calm(ctx);
    await page.goto(`${fake.url}/${address}&mode=delta`);
    const delta = await H.calm(ctx);
    expect(delta.mappingId, "a signed measure has its own mapping").not.toBe(volume.mappingId);
    expect(delta.signed ?? delta.transform, "and it is read from its midpoint").toBeTruthy();
  });
});
