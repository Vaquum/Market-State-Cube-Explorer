"use strict";
// inspect-references-data.spec.js (#112): Inspect's References follow the data their lines are built from.
//
// A line built on bars (Structure's retracements) or on a cube read (a period's POC) has no references until its data arrives. Inspect entered
// while that read is held finds no reference on, so the References tab is disabled; once the read is let through, the tab is enabled and lists
// the line's references, with no pan or zoom between (the address's time and price ranges are the same before and after).
//
// Oracles: the RAMP trades of retracements.spec.js, whose last 30 sessions rise from 11,750 to 14,760, so Retracements · 30 days names the
// three levels 30D 38.2%, 30D 50.0% and 30D 61.8%; and the standard profile's 90-day line, a period POC whose rows the page asks the cube for
// (the loaded cells do not tile 90 days at 125 USDT rows), with one reference, named by its tag 90D.
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

// With the view at rest, hold the reads `rule` matches, turn the line on from the Lines menu, close it and enter Inspect (E) while the read is
// held; then let the held reads through. Returns the reference chooser's options, on the References surface.
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
  // the open menu would cover Inspect's surface tabs
  await page.keyboard.press("Escape");
  await expect(page.locator("#ol-lines-pop")).toBeHidden();
  await page.locator("#ol-canvas").focus();
  await page.keyboard.press("e");
  await expect(page.locator("#ol-inspect")).toBeVisible();
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
