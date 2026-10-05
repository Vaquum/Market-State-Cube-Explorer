"use strict";
// model-provenance.spec.js (X): B19, how the page labels the empirical model behind Efficiency and the diagonal chooser
// (TESTPLAN 3.4; API B.13 and C.14; DR-13, DR-42; INTEGRATION D.6 and D.18).
//
// Requirements covered: S1-145 to S1-151 (the model's provenance is one record, it says what is NOT known, its status follows the
// EFFECTIVE cutoff in every mode, and a level outside the fitted ones is labelled "extrapolated" while the equality with the model is
// still drawn), and A-20 (the status is computed from the effective cutoff in all modes, live and replay).
//
// What is asserted, and where it is read. The pane's label is canvas text, so it is read off the canvas (pane-canvas.js records every
// fillText); the diagonal chooser's line is the `#ol-plane-status` text and its help the price-axis menu's; the chip's details
// (`modelStatus`, `modelIsoA`, ..., D.18) are package U's DOM and are separate tests that name the missing element when it is not there.
//
// Oracles (none is the code under test): the dates and numbers are the ones DR-13 records, written out here by hand (the extraction of
// 2026-09-24, the conservative bound 2026-09-25T00:00Z, ISO_A -1.06, ISO_B 0.486, baseline 2 ** (0.486 - 1), fitted levels 6 to 13, history
// start 2021-01-01); the status boundaries are hand-written dates; the Efficiency values of `micro:mixed` come from the exact-rational
// reference calculator (tests/reference), each column's USDT over the rows it touched and its parent's.
const { test: base, expect, probeTools } = require("./fixtures.js");
const paneCanvas = require("./pane-canvas.js");
const S = require("./persistence-support.js");
const { observe } = require("./observe.js");
const ref = require("../reference/index.js");
const { resolveProfile, EPOCH_MS } = require("../support/profiles.js");

const test = base.extend({
  pane: async ({ page }, use) => {
    await paneCanvas.addRecorder(page);
    await use(paneCanvas.forPage(page));
  },
});

// The words of the model strings, from the module's table: the test asks E.text for WORDING only, never for a status or a number.
const words = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.explorerEncoding.text.model)));

async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 400, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

// The pane's label line as drawn (the left-aligned text at the pane's top left), and the plane status line.
async function paneLabel(pane) {
  const frame = await pane.last();
  const label = frame.texts.filter((t) => t.align === "left" && t.text.startsWith("Efficiency"));
  expect(label.length, "the Efficiency pane drew its label").toBe(1);
  return label[0].text;
}
const planeStatus = (page) => page.evaluate(() => document.getElementById("ol-plane-status").textContent);

test.describe("B19: the status follows the effective cutoff, in every mode", () => {
  test("recorded page: timing unverified at every window", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("recorded");
    const model = await (async () => {
      await page.goto(`${fake.url}/#w=24h&pane=efficiency`);
      return words(page);
    })();
    for (const window of ["24h", "30d", "1y"]) {
      await page.goto(`${fake.url}/#w=${window}&pane=efficiency`);
      await page.locator("#ol-loading").waitFor({ state: "hidden" });
      await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
      const label = await paneLabel(pane);
      expect(label, `${window}: the recorded cutoff is 2026-09-24T12:02Z`).toContain(model.timingUnverified);
      expect(label).not.toContain(model.retrospective);
      expect(label).not.toContain(model.eligibleByBound);
    }
  });

  // A live cutoff is the cube's; the model's status follows it exactly: the day of the extraction (2026-09-24) is timing unverified (the fit
  // time is unknown), from the conservative upper bound (2026-09-25T00:00Z) it can only have been fitted before the cutoff. The boundary is
  // exact: the minute before it is not eligible, the minute itself is.
  for (const [cutoff, status] of [
    [null, "timingUnverified"],
    ["2026-09-24T23:59:00Z", "timingUnverified"],
    ["2026-09-25T00:00:00Z", "eligibleByBound"],
    ["2026-09-25T06:00:00Z", "eligibleByBound"],
  ]) {
    test(`live fixture, cutoff ${cutoff ?? "2026-09-24T12:02Z (the default)"}: ${status === "eligibleByBound" ? "eligible by the bound" : "timing unverified"}`, async ({ page, fakeFor, probe, pane }) => {
      const fake = await fakeFor("mini", cutoff ? { cutoff } : {});
      await page.goto(`${fake.url}/#w=24h&pane=efficiency`);
      const model = await words(page);
      await atRest(page, fake, probe);
      const label = await paneLabel(pane);
      expect(label).toContain(model[status]);
      for (const other of ["timingUnverified", "eligibleByBound", "retrospective"].filter((k) => k !== status)) expect(label, `not ${other}`).not.toContain(model[other]);
    });
  }

  test("replay to 2026-09-20: retrospective (the model was estimated on later data)", async ({ page, fakeFor, probe, pane }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/#w=7d&pane=efficiency&replay=1&at=2026-09-20T00:00Z`);
    const model = await words(page);
    await atRest(page, fake, probe);
    const label = await paneLabel(pane);
    expect(label).toContain(model.retrospective);
    expect(label).not.toContain(model.timingUnverified);
    expect(await planeStatus(page), "the diagonal chooser says the same").toContain(model.retrospective);
  });
});

test.describe("B19: a level outside the fitted ones is labelled, and the equality is still drawn", () => {
  // DR-13: Efficiency compares a column (level n) with its parent (level n + 1), so it is within the fit only when BOTH are in 6..13; the
  // diagonal chooser reads the model at n alone. So Efficiency is extrapolated at n = 5 (n < 6), 13 and 14 (n + 1 > 13), and within at 6
  // and 12. The windows are the ones whose display source is the level asked for (a coarser tier would display a coarser level).
  const LEVELS = [
    { n: 5, m: 0, w: "7d", efficiency: "extrapolated", diagonal: "extrapolated" },
    { n: 6, m: 0, w: "7d", efficiency: "within", diagonal: "within" },
    { n: 12, m: 3, w: "all", efficiency: "within", diagonal: "within" },
    { n: 13, m: 3, w: "1y", efficiency: "extrapolated", diagonal: "within" },
    { n: 14, m: 3, w: "all", efficiency: "extrapolated", diagonal: "extrapolated" },
  ];
  for (const level of LEVELS) {
    test(`n = ${level.n}: Efficiency is ${level.efficiency}, the diagonal chooser ${level.diagonal}`, async ({ page, fakeFor, probe, pane }) => {
      const fake = await fakeFor("standard");
      await page.goto(`${fake.url}/#w=${level.w}&r=${level.n},${level.m}&pane=efficiency`);
      const model = await words(page);
      await atRest(page, fake, probe);
      const label = await paneLabel(pane);
      const plane = await planeStatus(page);
      expect(plane, "the level asked for is the level shown").toContain(`Requested n ${level.n}`);
      expect(plane).not.toContain("displayed n");
      expect(label.includes(model.extrapolated), `pane label at n = ${level.n}: ${label}`).toBe(level.efficiency === "extrapolated");
      expect(plane.includes(model.extrapolated), `plane status at n = ${level.n}: ${plane}`).toBe(level.diagonal === "extrapolated");
      // Extrapolated or not, the equality with the model is drawn: the pane still has bars against its fixed axis.
      const frame = await pane.last();
      const colours = await pane.colours();
      const area = paneCanvas.paneRect(frame, colours.surface);
      const bars = paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.85 }).length + paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.85 }).length;
      expect(bars, "Efficiency is still drawn at this level").toBeGreaterThan(0);
    });
  }
});

test.describe("B19: the diagonal chooser's help mentions the model", () => {
  test("the price-axis menu says it uses the same fitted model, and the plane status names its status", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/#w=24h`);
    const model = await words(page);
    await atRest(page, fake, probe);
    const help = await page.evaluate(() => [...document.querySelectorAll("#ol-follow-menu [role^=menuitem]")].map((e) => e.textContent.trim()).find((t) => t.startsWith("Diagonal")) || "");
    expect(help).toContain(model.diagonalUse);
    expect(await planeStatus(page)).toContain(model.timingUnverified);
  });
});

// ---- the value is against the recorded baseline ------------------------------------------------------------------------------------

const BASE_MS = 56250;
const tradeList = (store) =>
  Array.from(store.t, (t, i) => ({ t_ms: t, price: store.price[i], qty: store.qty[i], takerBuy: Boolean(store.buy[i]), count: store.count[i] }));

test.describe("B19: Efficiency is measured against 2 ** (ISO_B - 1)", () => {
  test("micro:mixed: each column's value is log2 of its USDT per touched row over its parent's and the recorded baseline", async ({ page, fakeFor, probe, pane, surface }) => {
    const fake = await fakeFor("micro:mixed");
    await page.goto(`${fake.url}/#t=2021-01-01T00:00Z~2021-01-01T00:05Z&p=24500~25500&r=0,0&pane=efficiency`);
    await atRest(page, fake, probe);

    // The reference, by hand from the trades: the USDT of a column and the base rows its trades touched, for columns 0 to 3 and their
    // parents (pairs of columns), the baseline 2 ** (0.486 - 1) written out.
    const trades = tradeList(resolveProfile("micro:mixed").store);
    const cells = (n) => ref.cells(trades, { n, m: 0, b0: 0, b1: 6 });
    const level = (n) => {
      const by = new Map();
      for (const z of cells(n)) {
        const c = by.get(z.c) ?? { v: 0, rows: 0 };
        c.v += z.v;
        c.rows += 1;
        by.set(z.c, c);
      }
      return by;
    };
    const own = level(0);
    const parents = level(1);
    const baseline = 2 ** (0.486 - 1);
    const expected = (c) => {
      const child = own.get(c);
      const parent = parents.get(Math.floor(c / 2));
      return Math.log2(child.v / child.rows / (parent.v / parent.rows) / baseline);
    };

    const frame = await pane.last();
    const colours = await pane.colours();
    const area = paneCanvas.paneRect(frame, colours.surface);
    const zero = area.y + area.h / 2;
    const room = area.h / 2 - 4;
    // Columns 0 to 3 have a whole parent (columns 4 and 5 are the open parent's: hatched, no bar). Each bar is its value over 2 of the
    // room, pointing up where it is positive and down where it is negative.
    const arms = [
      ...paneCanvas.barsOf(frame, area, { fill: colours.positive, alpha: 0.85 }),
      ...paneCanvas.barsOf(frame, area, { fill: colours.negative, alpha: 0.85 }),
    ].sort((a, b) => a.x - b.x);
    expect(arms.length).toBe(4);
    [0, 1, 2, 3].forEach((c, i) => {
      const value = expected(c);
      expect(Math.abs(value), "within the +-2 of the axis").toBeLessThan(2);
      expect(arms[i].h, `column ${c}`).toBeCloseTo((Math.abs(value) / 2) * room, 7);
      if (value >= 0) expect(arms[i].y + arms[i].h).toBeCloseTo(zero, 9);
      else expect(arms[i].y).toBeCloseTo(zero, 9);
    });
  });
});

// ---- what the chip's details show (package U's DOM) ---------------------------------------------------------------------------------

test.describe("B19: the model's provenance in the chip details (needs package U)", () => {
  // The details popover is package U's DOM (D.18). On a page without it the test is fixme with the reason; under CONVERGENCE=1 (K runs the
  // merged page) the same absence is a failure naming the element (observe.js), so nothing is skipped silently.
  async function needDetails(page, surface) {
    const absent = await surface.missing(["axis"]);
    if ((await page.locator("#ol-axis-pop").count()) === 0) absent.push("popovers.axis (#ol-axis-pop)");
    test.fixme(absent.length > 0 && process.env.CONVERGENCE !== "1", `needs package U: ${absent.join(", ")} is not in this page`);
  }

  test("ISO_A, ISO_B, the baseline, the fitted levels, the history start, the extraction, the unknown fit time and the conservative bound", async ({ page, fakeFor, probe, surface }) => {
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/#w=24h&pane=efficiency`);
    await atRest(page, fake, probe);
    await needDetails(page, surface);
    const model = await words(page);
    const { fields } = await surface.details("axis");
    expect(fields.modelStatus.value, "timing unverified at the recorded cutoff").toBe("timing-unverified");
    expect(fields.modelIsoA.value).toBe("-1.06");
    expect(fields.modelIsoB.value).toBe("0.486");
    expect(Number(fields.modelBaseline.value)).toBeCloseTo(2 ** (0.486 - 1), 15);
    expect(JSON.parse(fields.modelFitRange.value)).toEqual([6, 13]);
    expect(fields.modelHistoryStart.value).toBe("2021-01-01T00:00:00Z");
    expect(fields.modelExtraction.value).toBe("2026-09-24");
    // What is not known stays unknown: the fit timestamp has no value and says so, and the bound is a bound.
    expect(fields.modelFitTimestamp.text).toBe(model.exactUnknown);
    expect(fields.modelFitTimestamp.value).toBeFalsy();
    expect(fields.modelUpperBound.value).toBe("2026-09-25T00:00:00Z");
    expect(fields.modelApplicability.text).toBe(model.applicability);
  });

  // The portable view code round trip (P) and a fresh context: the status is recomputed from the payload's cutoff, never stored as eligible.
  // Replay to 2026-09-20 (the model was estimated on later data), copy the view code, paste it into a context with no storage: the pane, the
  // plane status and the chip's details all still say `retrospective`.
  test("a portable code opened in a fresh context keeps the status (replay to 2026-09-20: retrospective)", async ({ page, context, fakeFor, probe, pane, freshContext }) => {
    const fake = await fakeFor("standard");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fake.url });
    await page.goto(`${fake.url}/#w=7d&pane=efficiency&replay=1&at=2026-09-20T00:00Z`);
    await atRest(page, fake, probe);
    const model = await words(page);
    expect(await paneLabel(pane), "the status before the copy").toContain(model.retrospective);

    await S.openQuery(page);
    await page.locator("#ol-copy-view").click();
    await expect.poll(() => S.clipboardText(page)).toMatch(/^origo-cube:3\./);
    const code = await S.clipboardText(page);

    const other = await freshContext();
    expect((await other.storageState()).origins, "a context with no storage").toEqual([]);
    const tab = await other.newPage();
    await paneCanvas.addRecorder(tab);
    await tab.goto(`${fake.url}/`);
    await tab.locator("#ol-canvas").waitFor();
    await S.importCode(tab, code);
    await expect(tab.locator("#ol-copy-status")).toHaveText("View restored");
    await tab.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 400, timeoutMs: 20000 });
    await probeTools.forPage(tab).waitForQuiet({ quietMs: 400, timeout: 20000 });

    const label = await paneLabel(paneCanvas.forPage(tab));
    expect(label, "the pane of the restored view").toContain(model.retrospective);
    expect(label).not.toContain(model.timingUnverified);
    expect(label).not.toContain(model.eligibleByBound);
    expect(await planeStatus(tab), "the diagonal chooser of the restored view").toContain(model.retrospective);
    const { fields } = await observe(tab).details("axis");
    expect(fields.modelStatus.value, "the chip's details").toBe("retrospective");
  });
});
