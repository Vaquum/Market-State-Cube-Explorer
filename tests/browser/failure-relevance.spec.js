"use strict";
// B32 failure-relevance.spec.js (PRD-0002 S2, #47 section 7, issue #29): the loading line says which read the active view could not make, and only
// the state decides that: never the order in which startup and a failed read happen to finish.
//
// Deterministic by construction, no timing luck: a test-side init script records every change of #ol-loading (its text, its role and whether it is
// hidden) and can HOLD requestAnimationFrame, which parks the startup loop exactly where the race was (after the reference tier is ready and before
// its final check; or before the first tier), while the fake's gate decides when the tile read fails. The scenarios of the issue are then replayed
// in their worst order on the ORIGINAL build (the control: it loses the alert, so the scenario has teeth) and on this one (it keeps it).
//   1 race A, the documented one: the failure lands between the last tier and the loop's check; the alert stays
//   2 race B, the second path: the failure lands before the first tier and the tier's caption is written over it; the alert stays
//   3 A fails, B (another tile) is read, back to A: the alert is hidden on B and is there at once on A again, from what is noted (nothing is asked again)
//   4 two active consumers (the view's tile and the lens's) fail: both are said; closing the lens leaves the view's; reopening it says the lens's again
//   5 a pack replaced after a failure: the failure stays up through the retry and goes only when the needed tile arrives; a retry that fails is a
//     failure again and never shows a loading caption in its place
//   6 the recorded page, which has no cube, still hides its line once the three blocks are in
// Oracles (none is the code under test): the recorded changes of the line itself, the fake's request log, and the original build as a control.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");

// The 119-day view whose tile (level 11) no loaded block can draw: the page must read it.
const A = "#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2";
// Another view that needs a tile of its own (a 62-day one, at another level)
const B = "#t=2026-07-22T00:00Z~2026-09-23T00:00Z&p=22000~27000&vis=2";

// In the page, before anything runs: record #ol-loading, and let the test hold requestAnimationFrame.
function install({ holdAtStart, wrap = true }) {
  const log = [];
  window.__loadingLog = log;
  const raf = { held: Boolean(holdAtStart), queue: [], real: window.requestAnimationFrame.bind(window) };
  window.__raf = raf;
  // (a page that also carries the test probe must not be wrapped twice: the probe wraps requestAnimationFrame too)
  if (wrap) {
    window.requestAnimationFrame = (cb) => {
      if (raf.held) {
        raf.queue.push(cb);
        return 0;
      }
      return raf.real(cb);
    };
    window.__release = () => {
      raf.held = false;
      for (const cb of raf.queue.splice(0)) raf.real(cb);
    };
  }
  const note = () => {
    const node = document.getElementById("ol-loading");
    if (!node) return;
    const entry = { hidden: node.hidden, role: node.getAttribute("role"), text: node.textContent.trim() };
    const last = log[log.length - 1];
    if (!last || last.hidden !== entry.hidden || last.role !== entry.role || last.text !== entry.text) log.push(entry);
    // the first tier's caption parks the loop at the moment the second tier's begins: hold before its next frame
    if (!raf.held && /30-day archive/.test(entry.text) && window.__holdAtReference) raf.held = true;
  };
  new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "role"] });
  document.addEventListener("DOMContentLoaded", note);
}
const logOf = (page) => page.evaluate(() => window.__loadingLog.slice());
const line = (page) => page.evaluate(() => ({ hidden: document.getElementById("ol-loading").hidden, role: document.getElementById("ol-loading").getAttribute("role"), text: document.getElementById("ol-loading").textContent.trim() }));
const tileRequests = (fake, n) => fake.log().filter((e) => e.path === "/cube/tile" && Number(e.query.n) === n);

async function open({ freshContext, fakeFor }, options = {}) {
  const fake = await fakeFor(options.profile ?? "standard");
  // no probe in these pages: it wraps requestAnimationFrame and so does the hold
  const context = await freshContext({ reducedMotion: "reduce", probe: false });
  await context.addInitScript(install, { holdAtStart: Boolean(options.holdAtStart) });
  if (options.holdAtReference) await context.addInitScript(() => (window.__holdAtReference = true));
  const page = await context.newPage();
  return { fake, context, page };
}

// Run race A or B on the page of a build, and report what the line was at the end and everything it was on the way.
async function race({ page, fake, hold }) {
  const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
  await page.goto(`${fake.url}/${A}`);
  // (polled on a timer: the default polls on requestAnimationFrame, which this very test parks, and a parked poll never answers)
  if (hold === "reference") await page.waitForFunction(() => window.__raf.held && window.__raf.queue.length > 0, null, { polling: 25 });
  await gate.arrived();
  gate.fail(503);
  // the failure is written (or derived) while the loop is parked
  await expect.poll(async () => (await line(page)).text, { message: "the failure is on the line while the startup loop waits" }).toContain("unavailable");
  await page.evaluate(() => window.__release());
  await fake.idle({ quietMs: 600, timeoutMs: 20000 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
  return { end: await line(page), log: await logOf(page) };
}

test.describe("B32 the documented race and its second path", () => {
  test("control: the original build loses the alert when the failure lands between the last tier and the loop's check", async ({ baselinePage, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const { page, fake } = await baselinePage({
      mode: "live",
      profile: "standard",
      probe: false,
      contextOptions: { reducedMotion: "reduce" },
      url: "/healthz",
      initScripts: [{ fn: install, arg: { holdAtStart: false } }, { fn: () => (window.__holdAtReference = true), arg: null }],
    });
    // the init scripts above ran for the healthz page too; a fresh navigation reruns them for the view
    const out = await race({ page, fake, hold: "reference" });
    expect(out.end.hidden, "the original build's loop hid the line that held the alert").toBe(true);
  });

  test("race A: a failure that lands between the last tier and the loop's check stays on the line", async ({ freshContext, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const { page, fake } = await open({ freshContext, fakeFor }, { holdAtReference: true });
    const out = await race({ page, fake, hold: "reference" });
    expect(out.end.hidden, "the alert is still there after the loop ended").toBe(false);
    expect(out.end.role).toBe("alert");
    expect(out.end.text).toMatch(/^Cube tile unavailable: /);
    // and it was never replaced by a caption or hidden on the way once it had been written
    const at = out.log.findIndex((e) => /unavailable/.test(e.text) && e.role === "alert" && !e.hidden);
    expect(at, "the alert was written").toBeGreaterThanOrEqual(0);
    for (const e of out.log.slice(at)) {
      expect(e.hidden, "never hidden after the alert").toBe(false);
      expect(e.text, "never a caption in its place").toMatch(/unavailable/);
      expect(e.role).toBe("alert");
    }
  });

  test("control for race B: the original build writes its startup caption over the alert and then hides it", async ({ baselinePage, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const { page, fake } = await baselinePage({
      mode: "live",
      profile: "standard",
      probe: false,
      contextOptions: { reducedMotion: "reduce" },
      url: "/healthz",
      initScripts: [{ fn: install, arg: { holdAtStart: true } }],
    });
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    await page.goto(`${fake.url}/${A}`);
    await gate.arrived();
    gate.fail(503);
    await expect.poll(async () => (await line(page)).text).toContain("unavailable");
    await page.evaluate(() => window.__release());
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
    const end = await line(page);
    const log = await logOf(page);
    expect(end.hidden || !/unavailable/.test(end.text), "the original build's alert did not survive its own startup loop").toBe(true);
    expect(log.some((e) => e.role === "alert" && /Loading/.test(e.text)), "it showed a loading caption under role=alert").toBe(true);
  });

  test("race B: a tile that fails before the first tier has its caption written does not lose the alert to the captions", async ({ freshContext, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const { page, fake } = await open({ freshContext, fakeFor }, { holdAtStart: true });
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    await page.goto(`${fake.url}/${A}`);
    await gate.arrived();
    gate.fail(503);
    await expect.poll(async () => (await line(page)).text).toContain("unavailable");
    await page.evaluate(() => window.__release());
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
    const end = await line(page),
      log = await logOf(page);
    expect(end.hidden).toBe(false);
    expect(end.role).toBe("alert");
    expect(end.text).toMatch(/^Cube tile unavailable: /);
    const at = log.findIndex((e) => /unavailable/.test(e.text) && e.role === "alert" && !e.hidden);
    for (const e of log.slice(at)) expect(e.text, "no startup caption over the alert").toMatch(/unavailable/);
  });
});

test.describe("B32 relevance follows the view", () => {
  test("A fails, B is read, back to A: the alert is hidden on B and is on A again at once, with nothing asked again", async ({ freshContext, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const { page, fake } = await open({ freshContext, fakeFor });
    // only the level-11 tile (the 119-day view's) fails
    fake.on({ route: /^\/cube\/tile/, when: (q) => Number(q.n) === 11 }).fail({ status: 503 });
    await page.goto(`${fake.url}/${A}`);
    await expect(page.locator("#ol-loading")).toHaveText(/^Cube tile unavailable: /, { timeout: 15000 });
    const asked = tileRequests(fake, 11).length;
    expect(asked, "asked once").toBe(1);
    // B: another view, whose tile answers
    await page.evaluate((hash) => (location.hash = hash), B);
    await expect(page.locator("#ol-loading"), "B's tile is read and the alert of A is not B's").toBeHidden({ timeout: 15000 });
    // back to A: the alert is there at once, from what is noted
    await page.evaluate((hash) => (location.hash = hash), A);
    await expect(page.locator("#ol-loading")).toHaveText(/^Cube tile unavailable: /, { timeout: 2000 });
    await expect(page.locator("#ol-loading")).toHaveAttribute("role", "alert");
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    expect(tileRequests(fake, 11).length, "the failed tile was not asked for again").toBe(asked);
  });

  test("two consumers fail: both are said; closing the lens leaves the view's; reopening it says the lens's again from what is noted", async ({ freshContext, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const { page, fake } = await open({ freshContext, fakeFor });
    // every tile fails: the view's (level 11) and the lens's (finer)
    fake.on({ route: /^\/cube\/tile/ }).fail({ status: 503 });
    await page.goto(`${fake.url}/${A}`);
    await expect(page.locator("#ol-loading")).toHaveText(/^Cube tile unavailable: /, { timeout: 15000 });
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    const box = await page.locator("#ol-canvas").boundingBox(),
      layout = await page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
    await page.locator("#ol-lens").click();
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
    await expect(page.locator("#ol-loading")).toContainText("Lens tile unavailable", { timeout: 15000 });
    await expect(page.locator("#ol-loading")).toContainText("Cube tile unavailable");
    const lensAsked = fake.log().filter((e) => e.path === "/cube/tile").length;
    // closing the lens (another tool): only the view's consumer is active
    await page.locator("#ol-pan").click();
    await expect(page.locator("#ol-loading")).not.toContainText("Lens tile unavailable");
    await expect(page.locator("#ol-loading")).toContainText("Cube tile unavailable");
    // reopening it: the lens's failure is said again at once, nothing is asked again
    await page.locator("#ol-lens").click();
    await page.mouse.move(box.x + layout[0] + layout[2] * 0.5, box.y + layout[1] + layout[3] * 0.5);
    await expect(page.locator("#ol-loading")).toContainText("Lens tile unavailable", { timeout: 2000 });
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    expect(fake.log().filter((e) => e.path === "/cube/tile").length, "no tile was asked for again").toBe(lensAsked);
  });

  test("a pack replaced after a failure: the failure stays up through the retry and goes when the tile arrives; a failed retry stays a failure", async ({ freshContext, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const { page, fake } = await open({ freshContext, fakeFor });
    const rule = fake.on({ route: /^\/cube\/tile/ }).fail({ status: 503 });
    await page.goto(`${fake.url}/${A}`);
    await expect(page.locator("#ol-loading")).toHaveText(/^Cube tile unavailable: /, { timeout: 15000 });
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    await page.evaluate(() => (window.__loadingLog.length = 0));
    // new data arrives while the tile still fails: the page asks again, the retry fails, and the line is never anything else
    fake.advance({ minutes: 30 });
    await expect.poll(() => fake.log().filter((e) => e.path === "/cube/tile").length, { timeout: 20000, message: "the page asks again after the pack is replaced" }).toBeGreaterThan(1);
    await fake.idle({ quietMs: 800, timeoutMs: 20000 });
    let log = await logOf(page);
    for (const e of log) {
      expect(e.hidden, "the failure stays up through the retry").toBe(false);
      expect(e.text, "and is never a loading caption").toMatch(/unavailable/);
    }
    expect((await line(page)).text, "a retry that fails is a failure").toMatch(/^Cube tile unavailable: /);
    // now the cube answers: new data again, the retry succeeds and only then does the line go
    rule.remove();
    await page.evaluate(() => (window.__loadingLog.length = 0));
    fake.advance({ minutes: 30 });
    await expect(page.locator("#ol-loading")).toBeHidden({ timeout: 20000 });
    log = await logOf(page);
    const shown = log.filter((e) => !e.hidden);
    for (const e of shown) expect(e.role === "alert" ? /unavailable/.test(e.text) : true, `while a failure is noted the alert is not replaced by "${e.text}"`).toBe(true);
    expect(log[log.length - 1].hidden, "it ends hidden: the needed tile arrived").toBe(true);
  });
});

test.describe("B32 the recorded page", () => {
  test("a page with no cube hides its loading line once the three blocks are in, and it stays hidden", async ({ page, probe, fakeFor }) => {
    await page.addInitScript(install, { holdAtStart: false, wrap: false });
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/#w=24h&vis=2`);
    await S.atRest(page, fake, probe);
    await expect(page.locator("#ol-loading")).toBeHidden();
    const log = await logOf(page);
    expect(log.some((e) => e.role === "alert"), "no alert was ever shown").toBe(false);
    expect(log[log.length - 1].hidden).toBe(true);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));
    await expect(page.locator("#ol-loading")).toBeHidden();
  });
});
