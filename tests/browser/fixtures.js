"use strict";
// tests/browser/fixtures.js (H7a): the test object every browser spec imports (TESTPLAN 3.1).
//
//   const { test, expect } = require("./fixtures.js");
//   test("...", async ({ page, fakeFor, surface, probe }) => {
//     const fake = await fakeFor("mini");                 // a fake cube serving the page under test, port 0
//     await page.goto(`${fake.url}/#w=24h`);
//     await fake.idle();
//     expect((await surface.chip("cells")).data.state).toBe("ready");
//   });
//
// What the fixtures guarantee, so that no spec has to remember it:
//   * `page` carries the probe (probe.js) as an init script and FAILS the test on any console.error, pageerror or unhandled
//     rejection, unless the test registered the exact expected fault with allowConsole(pattern). The one message every
//     injected non-2xx response logs ("Failed to load resource") is only accepted together with a registered fake fault
//     rule, because without a rule it would hide a real 404.
//   * `fakeFor(profile, opts)` starts a fake cube (TESTPLAN 4.2) on port 0 serving the page under test, closes it after the
//     test and calls assertNoUnexpected() on it at teardown. fakeFor("recorded") serves the page unmodified with no cube.
//   * generated trade stores are memoised per worker (DD-T08): tests/support/profiles.js holds the memo, and the
//     worker-scoped `profiles` fixture only names it (warm a profile once per worker with profiles.warm("standard")).
//   * freshContext() is an empty browser context (no storage, service workers blocked, the same viewport and scheme as the
//     config), openLink(url) opens an address in one, baselinePage() is the ORIGINAL build 8c82ca1 (materialised by
//     global-setup, DD-T06) behind its own fake.
//
// The page under test is the working-tree build or the committed page, chosen by global-setup (DD-T24). When it could not be
// built, fakeFor throws that error, which names the cause; nothing here falls back to another page.
const { test: base, expect } = require("@playwright/test");
const fs = require("node:fs");
const { startFake } = require("../support/cube-fake.js");
const { resolveProfile } = require("../support/profiles.js");
const { ENV } = require("./global-setup.js");
const { observe, MissingSurfaceElement, SURFACE } = require("./observe.js");
const probeModule = require("./probe.js");

// What the console guard treats as one expected fault: the text every failed fetch leaves behind.
const FAILED_LOAD = "Failed to load resource";

// A collector of console errors for every page of the contexts it is attached to.
function makeGuard() {
  const seen = [];
  const allowed = [];
  const guard = {
    faultRules: 0,
    seen,
    // allowConsole(/pattern/): this exact console error is expected by the test.
    allowConsole(pattern) {
      if (!(pattern instanceof RegExp)) throw new TypeError("allowConsole takes a RegExp naming the one expected fault");
      allowed.push(pattern);
    },
    attach(context) {
      context.on("console", (message) => {
        if (message.type() === "error") seen.push({ text: message.text(), where: message.location().url });
      });
      context.on("weberror", (webError) => {
        const error = webError.error();
        seen.push({ text: `uncaught: ${error.stack || error.message}`, where: "page" });
      });
    },
    // The console errors nobody allowed, and the allowances that are not legitimate.
    problems() {
      const out = [];
      let usedFailedLoad = false;
      for (const item of seen) {
        const pattern = allowed.find((re) => re.test(item.text));
        if (!pattern) out.push(`console error: ${item.text} (${item.where})`);
        else if (item.text.includes(FAILED_LOAD)) usedFailedLoad = true;
      }
      if (usedFailedLoad && guard.faultRules === 0) out.push(`allowConsole accepted "${FAILED_LOAD}" but the test registered no fake fault rule (fake.on(...)): an unexplained failed request is a real defect`);
      return out;
    },
  };
  return guard;
}

// Every page of a context, checked at teardown for unhandled rejections the probe saw (they also reach the console, this is
// the second witness). A page that is already closed is skipped.
async function rejectionsOf(pages) {
  const out = [];
  for (const page of pages) {
    if (page.isClosed()) continue;
    const list = await page.evaluate(() => (window.__probe ? window.__probe.rejections() : [])).catch(() => []);
    for (const text of list) out.push(`unhandled rejection: ${text}`);
  }
  return out;
}

const test = base.extend({
  // A worker-scoped handle on the profile memo (DD-T08).
  profiles: [async ({}, use) => {
    await use({ warm: (name, options) => resolveProfile(name, options) });
  }, { scope: "worker" }],

  // Where the pages under test live, from global-setup.
  pageRoots: [async ({}, use) => {
    await use({
      candidate: process.env[ENV.pageRoot] || null,
      candidateError: process.env[ENV.pageRootError] || null,
      baseline: process.env[ENV.baselineRoot] || null,
      baselineError: process.env[ENV.baselineError] || null,
    });
  }, { scope: "worker" }],

  consoleGuard: async ({}, use) => {
    const guard = makeGuard();
    await use(guard);
    const problems = guard.problems();
    if (problems.length) throw new Error(`the page reported errors the test did not expect:\n  ${problems.join("\n  ")}`);
  },

  allowConsole: async ({ consoleGuard }, use) => {
    await use(consoleGuard.allowConsole);
  },

  // The default page: probe installed, console guarded. (The built-in context fixture owns the context.)
  // (It names `fakeFor` so that the page is torn down BEFORE the fakes: see fakeFor.)
  page: async ({ context, consoleGuard, fakeFor: _fakes }, use) => {
    consoleGuard.attach(context);
    await probeModule.addProbe(context);
    const page = await context.newPage();
    await use(page);
    const rejected = await rejectionsOf(context.pages());
    if (rejected.length) throw new Error(`the page reported errors the test did not expect:\n  ${rejected.join("\n  ")}`);
  },

  // The observation helpers and the probe calls of the default page.
  surface: async ({ page }, use) => {
    await use(observe(page));
  },
  probe: async ({ page }, use) => {
    await use(probeModule.forPage(page));
  },

  fakeFor: async ({ pageRoots, consoleGuard, context }, use) => {
    const fakes = [];
    async function fakeFor(profile, opts = {}) {
      const options = { port: 0, host: "127.0.0.1", ...opts };
      if (profile === "recorded") options.mode = "recorded";
      else options.profile = profile;
      if (!options.pageRoot) {
        if (!pageRoots.candidate) throw new Error(`the page under test is not available: ${pageRoots.candidateError || "global-setup did not run"}`);
        options.pageRoot = pageRoots.candidate;
      }
      const fake = await startFake(options);
      fakes.push(fake);
      // A registered fault rule is what legitimises the "Failed to load resource" console line (makeGuard).
      const on = fake.on.bind(fake);
      fake.on = (spec) => {
        consoleGuard.faultRules++;
        return on(spec);
      };
      return fake;
    }
    await use(fakeFor);
    // The live poll of a page that is still open would reach a closed port a moment after the fake closes, and the console guard
    // would call that a defect of the page: a page that outlives its test is closed before its cube goes (S, stage 2b). The page
    // fixture names this one, so its own checks (unhandled rejections) have already run.
    await Promise.all(context.pages().map((open) => (open.isClosed() ? null : open.close().catch(() => {}))));
    const problems = [];
    for (const fake of fakes) {
      try {
        fake.assertNoUnexpected();
      } catch (error) {
        problems.push(error.message);
      }
    }
    await Promise.all(fakes.map((fake) => fake.close().catch((error) => problems.push(`closing the fake: ${error.message}`))));
    if (problems.length) throw new Error(`the fake cube saw requests the test did not expect:\n${problems.join("\n")}`);
  },

  // An empty context with the config's viewport and scheme (a context made with browser.newContext() does not inherit the
  // `use` block). {probe: false} leaves the probe out (B24 needs a page without it).
  freshContext: async ({ browser, consoleGuard, viewport, deviceScaleFactor, colorScheme, reducedMotion, serviceWorkers }, use) => {
    const contexts = [];
    async function freshContext({ probe = true, ...options } = {}) {
      const context = await browser.newContext({ viewport, deviceScaleFactor, colorScheme, reducedMotion, serviceWorkers, ...options });
      contexts.push(context);
      consoleGuard.attach(context);
      if (probe) await probeModule.addProbe(context);
      return context;
    }
    await use(freshContext);
    const rejected = await rejectionsOf(contexts.flatMap((context) => context.pages()));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    if (rejected.length) throw new Error(`the page reported errors the test did not expect:\n  ${rejected.join("\n  ")}`);
  },

  // openLink(url): the address in a NEW context with no storage (what a person who was sent a link sees). Returns the page.
  openLink: async ({ freshContext }, use) => {
    await use(async (url, options = {}) => {
      const context = await freshContext(options);
      const page = await context.newPage();
      await page.goto(url);
      return page;
    });
  },

  // baselinePage({mode, profile, probe, contextOptions, initScripts}): the original build behind its own fake. "recorded"
  // (default) serves the file unmodified with no cube; "live" injects a pack from `profile` like the bridge does.
  // initScripts: [{fn, arg}] are added to the context BEFORE the page navigates (a spec's own independent counters).
  baselinePage: async ({ pageRoots, freshContext, fakeFor }, use, testInfo) => {
    await use(async ({ mode = "recorded", profile = "mini", probe = true, contextOptions = {}, initScripts = [], url = "/" } = {}) => {
      if (!pageRoots.baseline) {
        const reason = pageRoots.baselineError || "the baseline build was not materialised";
        if (process.env.CI) throw new Error(reason);
        testInfo.skip(true, reason);
      }
      const fake = mode === "recorded" ? await fakeFor("recorded", { pageRoot: pageRoots.baseline }) : await fakeFor(profile, { pageRoot: pageRoots.baseline });
      const context = await freshContext({ probe, ...contextOptions });
      for (const { fn, arg } of initScripts) await context.addInitScript(fn, arg);
      const page = await context.newPage();
      await page.goto(`${fake.url}${url}`);
      return { page, fake, context, probe: probeModule.forPage(page), surface: observe(page) };
    });
  },
});

// The environment record global-setup wrote (browser version, page root, baseline hashes), for a spec that wants to attach it.
function environment() {
  const file = process.env[ENV.environment];
  return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

module.exports = { test, expect, environment, observe, MissingSurfaceElement, SURFACE, probeTools: probeModule };
