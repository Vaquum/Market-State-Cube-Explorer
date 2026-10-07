"use strict";
// B01 boot.spec.js (package H7b): the built page boots in recorded and in live mode, says which build it is, and carries no production test hook.
// PRD-0002 S1 (#46): S1-003 (no production debug endpoint), S1-012/S1-192 (nothing is fetched because of the theme), DD-T04, DD-T24, DD-T29, DD-T09,
// TESTPLAN 3.4 B01 and the fault-knob table 4.3 ("stale / stopped pill", "version banner").
//
// What it asserts, on the page the harness serves (the temporary build of the working tree; the committed index.html under CONVERGENCE=1):
//   * the page bytes: the recorded fake serves the page unmodified, so what the browser receives is the file at the page root byte for byte;
//     under CONVERGENCE=1 that file is the committed index.html and it is tracked by git; the inline encoding script IS src/encoding.js;
//   * the module: `explorerEncoding` has exactly the 31 production keys, including the pure drawings API, and the pinned `slate2` LUT hash is the same in Chromium as in
//     hand-pinned text (the hash covers both themes, so the "light" and "dark" LUTs of one appearance have ONE hash);
//   * no production hook: in a page loaded WITHOUT the probe the own properties of `window` that a blank page lacks are exactly `d3`,
//     `explorerState` and `explorerEncoding` (DOM ids are named properties, not own properties); the shipped sources name no test global; no
//     request goes to a control route (`/__fake/`);
//   * recorded mode: RECORDED, loading line hidden, ZERO `/cube/*` requests even while windows and encodings are changed;
//   * live mode on `mini`: LIVE and `data-state="live"`, loading line hidden, every request path in the allow-list, the observation source
//     names the SYNTHETIC fixture, the browser is Chromium 153, and the console is clean (the fixtures enforce it);
//   * the state pill: a cube that has had no data for 400 s is "stale"; a bridge that stops answering is "stopped" after 45 s (a page clock
//     installed BEFORE the page loads, see below) and the loading line says so; a server that now serves another page makes the reload banner appear.
//
// Oracles (none is the code under test): the bytes of the file on disk and of the file in git (node:fs, git show), the explicit 31 key names and the LUT
// hash copied from API.md A.1 and pinned by U18, the `data-state` and texts of the page's own pill as the DOM reports them, and the fake's
// request log (a server-side record of what the page asked for).
//
// Clock note (S's finding): a page clock installed on an idle page restarts performance.now() near 0 and every stamp the page took earlier lies in
// the future, so the stopped-pill test installs `page.clock` BEFORE navigation.
//
// What this does NOT prove: a production host (the portal login, the bridge itself), browsers other than Chromium 153, real network timing.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test, expect, environment } = require("./fixtures.js");

const ROOT = path.resolve(__dirname, "..", "..");

// The 31 keys of the reviewed frozen export, typed out here. The module's own list is never read back.
const KEYS_31 = ["LATTICE", "LIMITS", "THRESHOLDS", "TIMING", "VERSION", "axis", "candles", "codec", "cohort", "context", "drawings", "hash", "indicators", "legend", "lifecycle", "lut", "measure", "model", "notice", "policy", "ratio", "readout", "relvol", "result", "role", "scale", "store", "text", "time", "util", "warn"];
// The pinned hash of the slate2 LUT bytes (API.md A.1, U18) and the id that follows from it.
const SLATE2 = { hash: "8f7890f7e400724c7191f42f31b9d2e9e0bf060ca619b003915fb6fbb418b672", id: "slate2-8f7890f7" };
// The request paths a page of this build may issue (TESTPLAN B01): the page, its vendored script, and the seven cube routes.
const ALLOWED_PATH = /^(\/|\/vendor\/[A-Za-z0-9._-]+|\/cube\/(pack|tile|query|motion|columns|touched|bars))$/;

async function atRest(page, fake, probe) {
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 600, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

// The bytes of the page as a browser would receive them from a fake in recorded mode (which serves the file unmodified).
async function servedBytes(fake) {
  const response = await fetch(`${fake.url}/`);
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

test.describe("B01 the page under test", () => {
  test("the served bytes are the file at the page root; under CONVERGENCE=1 that is the committed index.html", async ({ fakeFor, pageRoots }) => {
    const fake = await fakeFor("recorded");
    const served = await servedBytes(fake);
    const atRoot = fs.readFileSync(path.join(pageRoots.candidate, "index.html"));
    expect(served.equals(atRoot), "the recorded fake serves the page unmodified").toBe(true);
    const env = environment();
    if (process.env.CONVERGENCE === "1") {
      expect(env.convergence).toBe(true);
      expect(path.resolve(pageRoots.candidate)).toBe(ROOT);
      const committed = execFileSync("git", ["-C", ROOT, "show", "HEAD:index.html"], { maxBuffer: 64 * 1024 * 1024 });
      expect(served.equals(committed), "CONVERGENCE=1 serves the committed index.html").toBe(true);
    } else {
      // Outside convergence the page is a build of THIS working tree and never the tracked file (parallel worktrees would conflict on it).
      expect(env.convergence).toBe(false);
      expect(path.resolve(pageRoots.candidate)).not.toBe(ROOT);
    }
  });

  test("the inline encoding script is src/encoding.js, and the module has exactly the 31 production keys, including the pure drawings API", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/`);
    await atRest(page, fake, probe);
    const source = fs.readFileSync(path.join(ROOT, "src", "encoding.js"), "utf8");
    const inline = await page.evaluate(() => [...document.scripts].filter((s) => !s.src && s.textContent.includes("explorerEncoding")).map((s) => s.textContent));
    // The app script mentions the name too: the encoding is the script whose text contains the whole file.
    expect(inline.filter((text) => text.includes(source.trim())).length, "one inline script carries src/encoding.js verbatim").toBe(1);
    const keys = await page.evaluate(() => Object.keys(window.explorerEncoding).sort());
    expect(keys).toEqual(KEYS_31);
    expect(await page.evaluate(() => Object.isFrozen(window.explorerEncoding))).toBe(true);
  });

  test("the slate2 LUT hash in Chromium equals the pinned text and the module in Node (the hash covers both themes)", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("recorded");
    await page.goto(`${fake.url}/`);
    await atRest(page, fake, probe);
    const inPage = await page.evaluate(() => {
      const E = window.explorerEncoding;
      return ["light", "dark"].map((theme) => ({ theme, hash: E.lut.build("slate2", theme).hash, id: E.lut.build("slate2", theme).id }));
    });
    for (const { hash, id } of inPage) {
      expect(hash).toBe(SLATE2.hash);
      expect(id).toBe(SLATE2.id);
    }
    // Node: the same file loaded as a module (tests/support/enc.js is the one loader of the unit tests).
    const inNode = require("../support/enc.js").lut.build("slate2", "light").hash;
    expect(inNode).toBe(SLATE2.hash);
    // The page's default appearance is the one the address and the chips name.
    expect(await page.evaluate(() => window.explorerEncoding.lut.appearanceId(window.explorerEncoding.lut.DEFAULT_APPEARANCE))).toBe(SLATE2.id);
  });
});

test.describe("B01 no production test hook (DD-T04, S1-003)", () => {
  test("a page loaded without the probe has exactly the six production globals and no test global", async ({ freshContext, fakeFor }) => {
    const fake = await fakeFor("mini");
    const context = await freshContext({ probe: false });
    const page = await context.newPage();
    await page.goto(`${fake.url}/`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    const seen = await page.evaluate(() => {
      // A blank document of the same browser is the reference: whatever else window owns is added by the page.
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const blank = new Set(Object.getOwnPropertyNames(frame.contentWindow));
      frame.remove();
      return {
        added: Object.getOwnPropertyNames(window).filter((name) => !blank.has(name)).sort(),
        probe: typeof window.__probe,
        fake: typeof window.__fake,
        test: Object.getOwnPropertyNames(window).filter((name) => /^__|test|hook|debug|probe/i.test(name) && !blank.has(name)),
      };
    });
    expect(seen.added).toEqual(["d3", "explorerComparison", "explorerComparisonUI", "explorerEncoding", "explorerReference", "explorerState"]);
    expect(seen.probe).toBe("undefined");
    expect(seen.fake).toBe("undefined");
    expect(seen.test).toEqual([]);
    // The existing globals expose the reviewed production APIs, including protected drawing/named-view persistence.
    // The comparison arithmetic and presentation modules are explicit production APIs, never test controls.
    expect(await page.evaluate(() => Object.keys(window.explorerComparison).sort())).toEqual(["METRICS", "analyze", "captureText", "identity", "sort", "value"]);
    expect(await page.evaluate(() => Object.keys(window.explorerComparisonUI).sort())).toEqual(["PAGE_SIZE", "create"]);
    expect(await page.evaluate(() => Object.keys(window.explorerReference).sort())).toEqual(["create"]);
    expect(await page.evaluate(() => Object.keys(window.explorerState).sort())).toEqual(["backup", "comparison", "drawings", "history", "namedViews", "namedViewsStatus", "notice", "read", "save", "saveHistory", "saveNamedViews", "saveNotice", "saveScales", "saveViews", "saved", "scales", "views", "viewsKey"]);
  });

  test("the shipped sources name no test global and no control route", async ({ pageRoots }) => {
    const html = fs.readFileSync(path.join(pageRoots.candidate, "index.html"), "utf8");
    for (const word of ["__probe", "__fake", "__cellsRecorder", "__test", "__debug"]) expect(html.includes(word), `the page contains ${word}`).toBe(false);
    // The raw sources too, so a hook cannot hide in a file the page does not inline.
    for (const file of ["src/explorer.js", "src/encoding.js", "src/state.js", "src/comparison.js", "src/comparison-ui.js", "src/reference.js", "src/view.html", "src/document.html"]) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const word of ["__probe", "__fake", "__cellsRecorder"]) expect(text.includes(word), `${file} contains ${word}`).toBe(false);
    }
  });
});

test.describe("B01 recorded mode", () => {
  test("RECORDED, loaded, and not one /cube/* request while windows and encodings change", async ({ page, fakeFor, surface, probe }) => {
    const fake = await fakeFor("recorded");
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto(`${fake.url}/`);
    await atRest(page, fake, probe);
    await expect(page.locator("#ol-market")).toHaveText("RECORDED");
    await expect(page.locator("#ol-loading")).toBeHidden();
    // The state pill of a recorded page is not a live state: there is no live pill text to read, and no poll.
    expect((await surface.chip("cells")).data.state).toBe("ready");
    // Change window and encoding with the real keys: the recorded page has every tier in it and reads nothing.
    for (const key of ["7", "8", "9", "0", "6", "m", "m", "b", "u", "]", "["]) {
      await page.keyboard.press(key);
      await probe.waitForQuiet({ quietMs: 250, timeout: 10000 });
    }
    // Longer than the live page's poll delay (3 s), so a poll that should not exist would show.
    await page.waitForTimeout(3500);
    expect(requests.filter((p) => p.startsWith("/cube/")), "no cube request from a recorded page").toEqual([]);
    expect(fake.log().filter((entry) => entry.path.startsWith("/cube/"))).toEqual([]);
    expect(requests.every((p) => ALLOWED_PATH.test(p)), `requests: ${requests.join(", ")}`).toBe(true);
    expect(requests).toEqual(["/", "/vendor/d3.min.js"]);
  });
});

test.describe("B01 live mode on the mini profile", () => {
  test("LIVE, loaded, every request in the allow-list, the source says SYNTHETIC, Chromium 153", async ({ page, fakeFor, surface, probe, browser }) => {
    const fake = await fakeFor("mini");
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto(`${fake.url}/#w=24h`);
    await atRest(page, fake, probe);
    await expect(page.locator("#ol-market")).toHaveText("LIVE");
    await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "live");
    await expect(page.locator("#ol-loading")).toBeHidden();
    // Exercise the read kinds the page has: other windows (tiles), a measure that needs the motion read, the lines and columns panes.
    for (const key of ["7", "8", "6"]) {
      await page.keyboard.press(key);
      await fake.idle({ quietMs: 400, timeoutMs: 20000 });
    }
    await page.keyboard.press("p");
    await fake.idle({ quietMs: 400, timeoutMs: 20000 });
    for (const press of ["m", "m", "m", "m", "m", "m", "m", "m"]) {
      await page.keyboard.press(press);
      await fake.idle({ quietMs: 300, timeoutMs: 20000 });
    }
    await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
    const seen = new Set(fake.log().map((entry) => entry.path));
    for (const requested of requests) expect(ALLOWED_PATH.test(requested), `${requested} is not in the allow-list`).toBe(true);
    for (const entry of fake.log()) expect(ALLOWED_PATH.test(entry.path), `${entry.path} is not in the allow-list`).toBe(true);
    expect(requests.some((p) => p.startsWith("/__fake")), "the page never asks for a control route").toBe(false);
    expect([...seen].some((p) => p.startsWith("/cube/")), "a live page does read the cube").toBe(true);
    // The observation source travels in the Cells details (D.18 obsSource).
    const details = await surface.details("cells");
    expect(details.fields.obsSource.value).toContain("SYNTHETIC fixture mini");
    expect(browser.version().split(".")[0]).toBe("153");
  });

  test("a cube with no data for 400 s is stale", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini", { quiet: 400 });
    await page.goto(`${fake.url}/#w=24h`);
    await atRest(page, fake, probe);
    await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "stale");
    await expect(page.locator("#ol-fresh")).toContainText("no new data for");
  });

  test("a bridge that stops answering is stopped after 45 s, and the loading line says so", async ({ page, fakeFor, allowConsole }) => {
    // The clock goes in BEFORE the page loads (S's finding, see the header): the page's own stamps then come from the same clock.
    await page.clock.install({ time: new Date("2026-09-24T12:00:00Z") });
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/#w=24h`);
    await page.locator("#ol-loading").waitFor({ state: "hidden" });
    await fake.idle({ quietMs: 500, timeoutMs: 20000 });
    await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "live");
    // From here every poll fails with a server error.
    allowConsole(/Failed to load resource/);
    fake.on({ route: "/cube/pack" }).fail({ status: 503, body: { error: "the cube is down" } });
    await page.clock.runFor(3500);
    await expect.poll(() => fake.log().filter((entry) => entry.path === "/cube/pack" && entry.status === 503).length, { timeout: 10000 }).toBeGreaterThan(0);
    // 50 s later by the page's own clock the bridge has been silent for more than 45 s.
    await page.clock.fastForward(50000);
    await expect(page.locator("#ol-state-pill")).toHaveAttribute("data-state", "stopped");
    await expect(page.locator("#ol-fresh")).toHaveText("updates stopped");
    await expect(page.locator("#ol-loading")).toBeVisible();
    await expect(page.locator("#ol-loading")).toContainText("Live updates stopped");
    await expect(page.locator("#ol-loading")).toContainText("the cube is down");
  });

  test("a server that serves another page version makes the reload banner appear", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await page.goto(`${fake.url}/#w=24h`);
    await atRest(page, fake, probe);
    await expect(page.locator("#ol-update")).toBeHidden();
    fake.setPageVersion("fake-page-2");
    await expect(page.locator("#ol-update")).toBeVisible({ timeout: 15000 });
  });
});
