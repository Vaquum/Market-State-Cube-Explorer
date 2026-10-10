"use strict";
// inspect-references-data.spec.js (#112, #114): Inspect's References follow the data their lines are built from.
//
// A line built on bars (Structure's retracements) or on a cube read (a period's POC) has no references until its data arrives. Inspect entered
// while that read is held finds no reference on, so the References tab is disabled; once the read is let through, the tab is enabled and lists
// the line's references, with no pan or zoom between (the address's time and price ranges are the same before and after). The rallies' events
// come from reads of their own (a discovery, then a membership view), outside the cube's and motion's read slots, and follow them the same way;
// a rally reference has no line of its own, so its detail brings none forward.
//
// Oracles: the RAMP trades of retracements.spec.js, whose last 30 sessions rise from 11,750 to 14,760, so Retracements · 30 days names the
// three levels 30D 38.2%, 30D 50.0% and 30D 61.8%; the standard profile's 90-day line, a period POC whose rows the page asks the cube for
// (the loaded cells do not tile 90 days at 125 USDT rows), with one reference, named by its tag 90D; and the fake's recorded canonical rally
// discovery (tests/fixtures/rallies/canonical.json), four rallies starting 27 Jun 2026 at 11:39, 11:41, 11:42 and 11:43 UTC, all visible.
const { test, expect } = require("./fixtures.js");

const DAY = 86400000, HOUR = 3600000;
const CUTOFF = "2021-02-17T12:00:00Z", CUT_MS = Date.parse(CUTOFF) - Date.parse("2021-01-01T00:00:00Z");
// Day d has three 8-hour parts, each a trade 50 under and one 50 over 10000 + 100d + 10·part (RAMP of retracements.spec.js).
const RAMP = Array.from({ length: 48 }, (_, d) => [0, 1, 2].flatMap((part) => [-50, 50].map((offset, k) => ({ t_ms: d * DAY + part * 8 * HOUR + (k + 1) * 60000, price: (10000 + d * 100 + part * 10 + offset) * 100, qty: 100000000, takerBuy: k === 1 })))).flat().filter((x) => x.t_ms <= CUT_MS);

test.use({ reducedMotion: "reduce" });

const camera = (page) => page.evaluate(() => {
  const p = new URLSearchParams(location.hash.slice(1));
  return { t: p.get("t"), p: p.get("p") };
});

// With the view at rest, hold the reads `rule` matches, turn the line on from the Lines menu and enter Inspect (E) from the open menu, which
// closes it, while the read is held; then let the held reads through. Returns the reference chooser's options, on the References surface.
async function lateReferences(page, fake, probe, { hash, family, line, rule }) {
  await page.goto(`${fake.url}/${hash}`);
  await probe.waitForReady();
  await fake.idle();
  const gate = fake.on(rule).gate();
  await page.locator("#ol-lines").click();
  const head = page.locator(`#ol-family-${family}-head`);
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await page.locator(`[data-line="${line}"]`).check();
  await gate.arrived();
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeVisible();
  await expect(page.locator("#ol-lines-pop"), "entering Inspect closed the menu").toBeHidden();
  const tab = page.locator('[data-surface="references"]');
  await expect(tab, "no reference is on while the line's data is held").toBeDisabled();
  const view = await camera(page);
  // a window (w=) would leave both out of the address and blind this guard, so each case gives its ranges
  expect(view.t && view.p, "the address holds the time and price ranges").toBeTruthy();
  gate.open();
  await expect(tab, "the line's references are on once its data arrives").toBeEnabled();
  expect(await camera(page), "no pan or zoom between").toEqual(view);
  await tab.click();
  return page.locator("#ol-inspect-reference option");
}

test("Retracements · 30 days entered while its 8-hour bars are read: References is enabled once they arrive and lists the three levels", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor({ trades: RAMP, cutoffIso: CUTOFF });
  const options = await lateReferences(page, fake, probe, { hash: "#t=2021-02-17T08:00Z~2021-02-17T12:00Z&r=8,0&vis=2&p=9000~15500", family: "structure", line: "fib30", rule: { route: "/cube/bars" } });
  await expect.poll(async () => (await options.allTextContents()).sort()).toEqual(["30D 38.2%", "30D 50.0%", "30D 61.8%"]);
  await expect(page.locator("#ol-inspect-position")).toHaveText(/^30D (38\.2|50\.0|61\.8)% · 1 of 3$/);
});

test("a 90-day POC entered while the cube reads its rows: References is enabled once they arrive and lists it", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("standard");
  const options = await lateReferences(page, fake, probe, { hash: "#t=2026-09-23T12:00Z~2026-09-24T12:00Z&p=22000~24500&vis=2", family: "profile", line: "90d", rule: { route: "/cube/query", when: (q) => !("r0" in q) } });
  await expect(options).toHaveText(["90D"]);
  await expect(page.locator("#ol-inspect-position")).toHaveText("90D · 1 of 1");
});

// The mini profile's rally view (rallies.spec.js), and a discovery over it from the Rallies tab: its four rows are the discovery's answer.
const RALLY_VIEW = "#t=2026-06-27T11:39:00Z~2026-06-27T11:55:00Z&p=60000~60625&r=0,0";
async function discoverRallies(page) {
  await page.locator("#ol-tab-rallies").click();
  await page.locator("#ol-rally-start").fill("2026-06-27T11:39");
  await page.locator("#ol-rally-end").fill("2026-06-27T11:55");
  await page.locator("#ol-rally-discover").click();
  await expect(page.locator("#ol-rally-rows tr")).toHaveCount(4);
}
const rallyMinutes = async (options) => (await options.allTextContents()).map((x) => /^Rallies · 27 Jun 11:(\d\d):/.exec(x)?.[1] ?? x);

test("rallies discovered while Inspect is open: References lists their events once the membership view arrives", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  await page.goto(`${fake.url}/${RALLY_VIEW}`);
  await probe.waitForReady();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeVisible();
  const tab = page.locator('[data-surface="references"]');
  await expect(tab, "no reference is on before the discovery").toBeDisabled();
  await fake.idle();
  const gate = fake.on({ route: "/cube/rallies/view" }).gate();
  await discoverRallies(page);
  await gate.arrived();
  await expect(page.locator("#ol-inspect"), "still in Inspect").toBeVisible();
  await expect(tab, "the rallies have no events until their membership view arrives").toBeDisabled();
  // the reads the discovery held back have landed: only the rallies' own answer is left to change the list
  await probe.waitForQuiet({ quietMs: 500, timeout: 30000 });
  const view = await camera(page);
  expect(view.t && view.p, "the address holds the time and price ranges").toBeTruthy();
  gate.open();
  await expect(tab, "the rallies' events are references once it arrives").toBeEnabled();
  expect(await camera(page), "no pan or zoom between").toEqual(view);
  await tab.click();
  await expect.poll(() => rallyMinutes(page.locator("#ol-inspect-reference option"))).toEqual(["39", "41", "42", "43"]);
});

test("a rally reference's detail brings no line forward: a rally is not keyed as Bollinger · 1D", async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor("mini");
  // Bollinger · 1D is on, so a focus keyed bb1d would be valid and would stay: the Lines button drops only a focus whose line is off
  await page.goto(`${fake.url}/${RALLY_VIEW}&lines=bb1d`);
  await probe.waitForReady();
  await discoverRallies(page);
  // the membership view has arrived, so the list Inspect reads holds the rallies
  await fake.idle();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("e");
  // the bands come first in the list, so the rally is chosen by its name, from the Cells surface: the chooser reads the reference chosen, while
  // the References tab would first read the first band, whose readout throws here (a separate fault: a band with no points falls through
  // averageTip to the VWAP curves' readout)
  const chooser = page.locator("#ol-inspect-reference"),
    rally = async () => (await chooser.locator("option").allTextContents()).find((x) => x.startsWith("Rallies · 27 Jun 11:39"));
  await expect.poll(rally, { message: "the 11:39 rally is a reference" }).toBeTruthy();
  await chooser.selectOption({ label: await rally() });
  await expect(page.locator("#ol-inspect-position")).toHaveText(/^Rallies · 27 Jun 11:39:\S+ · \d+ of \d+$/);
  await expect(page.locator("#ol-inspect-readout")).toContainText("Confirmed rallies");
  const chip = page.locator("#ol-focus-chip");
  await expect(chip).toBeHidden();
  await page.locator("#ol-inspect").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#ol-inspect-detail")).toBeVisible();
  expect(await chip.isHidden(), `no focus is taken: ${await chip.textContent()}`).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-inspect-detail")).toBeHidden();
});
