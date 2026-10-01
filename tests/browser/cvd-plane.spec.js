"use strict";
// B31 cvd-plane.spec.js (PRD-0002 S2, #47 section 5, last box): the resolution plane and the toolbar's resolution indicator in COMPOSED fixtures, under
// the colour-vision simulations and in grayscale.
//
// What is asserted: the tiles of the plane are composed on the real page (the popover open over the toolbar, the plane's states made by a held and a
// refused tile read), a screenshot of each tile of every availability-by-size combination is simulated through the published matrices of
// tests/fixtures/cvd/simulations.json (and plain grayscale), and then every two tiles that differ in availability or in size still DIFFER in the
// simulated image, at least as a count of pixels that changed by a visible amount, while two tiles of one combination are the same. The glyphs are
// achromatic marks (dots, a slash, a dot, a square, brackets), so nothing rests on a hue; this is the test that says so on the pixels.
// The toolbar's coarser-than-asked mark is held to the same: present and distinct from the empty slot in every simulation.
// Oracles (none is the code under test): the published matrices, the page's own pixels (screenshots of real tiles), and a difference threshold written
// out (24 of 255 per channel, at least 6 pixels of the inside of a 13 px tile).
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");
const SIM = require("../fixtures/cvd/simulations.json");

const SIMULATIONS = ["protanopia", "deuteranopia", "tritanopia", "grayscale"];
const VIEW = "#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2";
const DIFFERENCE = 24,
  PIXELS = 6;

// A screenshot of a locator as an array of [r, g, b] (DPR 1), decoded in the page.
async function pixelsOf(page, locator) {
  const png = await locator.screenshot();
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" })),
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
      out = [];
    for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]]);
    return { w: bitmap.width, h: bitmap.height, pixels: out };
  }, png.toString("base64"));
}
const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const fromLinear = (c) => {
  const x = Math.min(1, Math.max(0, c));
  return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
};
// The simulation of one pixel: the matrix on linear sRGB
function simulate(name, [r, g, b]) {
  const lin = [toLinear(r), toLinear(g), toLinear(b)],
    m = SIM[name];
  return m.map((row) => fromLinear(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
}
// How many pixels differ by more than DIFFERENCE in some channel, for two equally sized images under a simulation, over the tile's inside (the
// frame of the current level and the ring of a focused tile reach over the neighbours' borders).
function changed(a, b, name) {
  if (a.w !== b.w || a.h !== b.h) return Infinity;
  let n = 0;
  for (let y = 1; y < a.h - 1; y++)
    for (let x = 1; x < a.w - 1; x++) {
      const p = simulate(name, a.pixels[y * a.w + x]),
        q = simulate(name, b.pixels[y * b.w + x]);
      if (Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])) > DIFFERENCE) n++;
    }
  return n;
}
// The plane's tiles sit on fractional columns of a popover, so two tiles of one state would differ in where their antialiasing falls. The fixture
// puts the popover at a whole pixel and the tiles on a grid of whole pixels (12 px, 2 px apart), the rules that paint a tile untouched.
async function wholePixels(page) {
  await page.addStyleTag({
    content: "#ol-res-pop{left:20px !important;top:60px !important;right:auto !important} #ol-plane{grid-template-columns:12px repeat(21,12px) !important;gap:2px !important;width:max-content !important}",
  });
}

// Every two combinations on the plane in this state are distinct under every simulation, and two tiles of one combination are the same.
async function checkCombinations(page, { needAvailability, needSizes }) {
  const groups = await page.locator("#ol-plane button").evaluateAll((list) => {
    const out = {};
    for (const b of list) {
      // the diagonal and the current level are other marks of their own: only plain tiles are compared
      if (b.dataset.path === "true" || b.getAttribute("aria-pressed") === "true") continue;
      (out[`${b.dataset.avail}/${b.dataset.size}`] ??= []).push([Number(b.dataset.n), Number(b.dataset.m)]);
    }
    return out;
  });
  const keys = Object.keys(groups).sort();
  for (const a of needAvailability) expect(keys.some((k) => k.startsWith(a + "/")), `${a} is on the plane (${keys.join(", ")})`).toBe(true);
  for (const z of needSizes) expect(keys.some((k) => k.endsWith("/" + z)), `${z} is on the plane (${keys.join(", ")})`).toBe(true);
  const tileAt = ([n, m]) => page.locator(`#ol-plane button[data-n="${n}"][data-m="${m}"]`);
  const images = {};
  // the pointer away, so no hover frame is on any tile
  await page.mouse.move(2, 2);
  for (const key of keys) images[key] = await pixelsOf(page, tileAt(groups[key][0]));
  for (const name of SIMULATIONS)
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) expect(changed(images[keys[i]], images[keys[j]], name), `${name}: ${keys[i]} against ${keys[j]}`).toBeGreaterThanOrEqual(PIXELS);
  for (const key of keys) {
    if (groups[key].length < 2) continue;
    const other = await pixelsOf(page, tileAt(groups[key][groups[key].length - 1]));
    for (const name of SIMULATIONS) expect(changed(images[key], other, name), `${name}: two tiles of ${key}`).toBeLessThan(PIXELS);
  }
  return keys;
}

test.describe("B31 the plane under colour-vision simulations and in grayscale", () => {
  test("a plane with a read under way: pending, unavailable and ready tiles stay distinct from one another in every simulation", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${VIEW}`);
    await gate.arrived();
    await page.locator("#ol-res").click();
    await expect(page.locator("#ol-plane button[data-avail]").first()).toBeVisible();
    await wholePixels(page);
    await expect.poll(async () => page.locator('#ol-plane button[data-avail="pending"]').count()).toBeGreaterThan(0);
    const keys = await checkCombinations(page, { needAvailability: ["pending", "unavailable", "ready"], needSizes: ["small", "usable", "large"] });
    expect(keys.length).toBeGreaterThanOrEqual(4);
    gate.open();
  });

  test("a plane of ready levels: small, usable and large tiles stay distinct in every simulation", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${S.address({ cols: [S.END_COL - 2000, S.END_COL], rows: [190, 214], rowsKind: "volume", period: "7d", extra: "&vis=2" }).replace("&rows=volume&period=7d", "")}`);
    await S.atRest(page, fake, probe);
    await page.locator("#ol-res").click();
    await expect(page.locator("#ol-plane button[data-avail]").first()).toBeVisible();
    await wholePixels(page);
    const keys = await checkCombinations(page, { needAvailability: ["ready"], needSizes: ["small", "usable", "large"] });
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  test("the toolbar's coarser-than-asked mark is distinct from an empty slot in every simulation", async ({ page, probe, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const fake = await fakeFor("standard");
    fake.on({ route: /^\/cube\/tile/ }).fail({ status: 500 });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`${fake.url}/${VIEW}`);
    await page.waitForFunction(() => {
      const line = document.getElementById("ol-loading");
      return line.hidden || line.getAttribute("role") === "alert";
    });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    const mark = page.locator("#ol-res .ol-res-coarse");
    await expect(mark).toBeVisible();
    const withMark = await pixelsOf(page, mark);
    // the same slot in an empty state: the footer's "Zero trades" swatch is the empty cell of the table (surface and hairline)
    const empty = await pixelsOf(page, page.locator('#ol-key-zero [data-stroke-role="empty"]'));
    for (const name of SIMULATIONS) expect(changed(withMark, empty, name), `${name}: the mark against an empty cell`).toBeGreaterThanOrEqual(PIXELS);
  });
});
