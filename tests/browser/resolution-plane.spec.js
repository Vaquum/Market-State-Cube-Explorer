"use strict";
// B29 resolution-plane.spec.js (PRD-0002 S2, #47 section 5): the resolution plane as an orthogonal state grid.
//
// What is asserted:
//   1. every one of the 210 tiles states its size as two facts, width and height, each small under 6 px, large over 32 px, else usable, from the
//      view's own numbers (2^n times the heatmap's width over the span in columns, 2^m times its height over the span in rows); the old five-kind
//      class is only the summary, small before large, and the tile's name gives BOTH classes beside its readiness and its row and column;
//   2. availability is its own fact: ready is an up-set of levels (finer never reads ready where coarser does not), the level shown is ready and the
//      ones finer than it are not, a held tile read makes tiles pending and then ready, a refused one leaves the requested level unavailable;
//   3. the glyphs are separate and neutral: dots for pending, a slash for unavailable, a plain tile for ready, and on top of them a dot, a hollow
//      square or corner brackets for the size, a corner badge for the diagonal, an outer frame for the current level and a two-tone ring for the
//      focus; none replaces another (selected-and-unavailable, diagonal-and-small and focused-pending are each checked), and no tile uses the gold,
//      the Volume green or the Evidence violet;
//   4. the key is tiles carrying the same attributes the plane's tiles carry, the toolbar's coarser-than-asked mark is the stroke-role table's tick
//      and not a gold dot, and the steppers are a named group of 44 px targets beside the dense chooser.
// Oracles (none is the code under test): the PRD's thresholds (6 and 32 px) and the view's span written out from the address, the heatmap's size
// from the page's data-layout, the fake's held and refused tile reads, the tokens of the page read back as computed colours, and the computed styles
// of the real elements and their pseudo-elements.
const { test, expect } = require("./fixtures.js");
const S = require("./rows-support.js");

const COLS = [S.END_COL - 2000, S.END_COL];
const ROWS = [190, 214];
const VIEW = `${S.address({ cols: COLS, rows: ROWS, rowsKind: "volume", period: "7d", extra: "&vis=2" }).replace("&rows=volume&period=7d", "")}`;

const layoutOf = (page) => page.locator("#ol-canvas").evaluate((el) => el.dataset.layout.split(",").map(Number));
const classOf = (px) => (px < 6 ? "small" : px > 32 ? "large" : "usable");

async function openPlane(page) {
  await page.locator("#ol-res").click();
  await expect(page.locator("#ol-res-pop")).toBeVisible();
  await expect(page.locator("#ol-plane button").first()).toBeVisible();
  // the page refreshes the plane while it is visible: wait for a tile to carry its facts
  await expect(page.locator('#ol-plane button[data-avail]').first()).toBeVisible();
}
const tiles = (page) =>
  page.locator("#ol-plane button").evaluateAll((list) =>
    list.map((b) => ({ n: Number(b.dataset.n), m: Number(b.dataset.m), avail: b.dataset.avail, w: b.dataset.w, h: b.dataset.h, size: b.dataset.size, path: b.dataset.path, cls: b.className, name: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed") })),
  );
async function levels(page) {
  const text = await page.locator("#ol-plane-status").evaluate((el) => el.textContent);
  const match = /Requested n (\d+) · m (\d+)(?: · displayed n (\d+) · m (\d+))?/.exec(text);
  if (!match) throw new Error(`no levels in ${JSON.stringify(text)}`);
  return { requested: [Number(match[1]), Number(match[2])], displayed: match[3] === undefined ? [Number(match[1]), Number(match[2])] : [Number(match[3]), Number(match[4])] };
}
// The market hues the plane must not use, as computed colours: the gold and the Evidence violet are tokens; the Volume green is gone from the
// page, so its baseline values (#39845d in the light scheme, #80cca1 in the dark) are named here.
function marketColours(page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    document.getElementById("origo-lens").append(probe);
    const out = {};
    for (const name of ["poc", "evidence"]) {
      probe.style.color = `var(--ol-${name})`;
      out[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    out.volume = matchMedia("(prefers-color-scheme: dark)").matches ? "rgb(128, 204, 161)" : "rgb(57, 132, 93)";
    return out;
  });
}
const styleOf = (handle, pseudo) =>
  handle.evaluate(
    (b, p) => {
      const s = getComputedStyle(b, p || null);
      return { image: s.backgroundImage, colour: s.backgroundColor, shadow: s.boxShadow, transform: s.transform, width: s.width, height: s.height, border: s.borderTopColor };
    },
    pseudo,
  );

test.describe("B29 the plane's size classes", () => {
  test("every tile's width and height class is the one its pixels have; the summary class is small before large; the name says both", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${VIEW}`);
    await S.atRest(page, fake, probe);
    const [, , w, h] = await layoutOf(page);
    await openPlane(page);
    const list = await tiles(page);
    expect(list.length, "21 by 10 tiles").toBe(22 * 10 - 10);
    let mixed = 0;
    for (const t of list) {
      const px = (2 ** t.n * w) / (COLS[1] - COLS[0]),
        py = (2 ** t.m * h) / (ROWS[1] - ROWS[0]);
      expect(t.w, `n ${t.n} m ${t.m}: width ${px.toFixed(1)} px`).toBe(classOf(px));
      expect(t.h, `n ${t.n} m ${t.m}: height ${py.toFixed(1)} px`).toBe(classOf(py));
      const summary = t.w === "small" || t.h === "small" ? "small" : t.w === "large" || t.h === "large" ? "large" : "usable";
      expect(t.size, `n ${t.n} m ${t.m}: the glyph's class is the summary`).toBe(summary);
      if ((t.w === "small" && t.h === "large") || (t.w === "large" && t.h === "small")) mixed++;
      expect(t.name, `n ${t.n} m ${t.m}: the name has both classes`).toContain(`width ${t.w}, height ${t.h}`);
      expect(t.name, `n ${t.n} m ${t.m}: and the level`).toContain(`n ${t.n} · m ${t.m}`);
      expect(t.name, `n ${t.n} m ${t.m}: and its readiness`).toMatch(/ready|detail unavailable|loading/);
    }
    expect(mixed, "the plane has tiles that are small one way and large the other, and their names say so").toBeGreaterThan(0);
  });
});

test.describe("B29 availability", () => {
  test("a view of a whole drawn level: every level is ready, and ready is an up-set", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${VIEW}`);
    await S.atRest(page, fake, probe);
    await openPlane(page);
    const list = await tiles(page),
      at = (n, m) => list.find((t) => t.n === n && t.m === m);
    for (const t of list) {
      expect(["pending", "unavailable", "ready"], `n ${t.n} m ${t.m}`).toContain(t.avail);
      if (t.avail === "ready") {
        const right = at(t.n + 1, t.m),
          up = at(t.n, t.m + 1);
        if (right) expect(right.avail, `coarser in time than ready n ${t.n} m ${t.m}`).toBe("ready");
        if (up) expect(up.avail, `coarser in price than ready n ${t.n} m ${t.m}`).toBe("ready");
      }
    }
    const { displayed } = await levels(page);
    expect(at(...displayed).avail, "the level shown is ready").toBe("ready");
  });

  test("a view only a coarse tier covers: ready is exactly the levels as coarse as the tier, the rest unavailable", async ({ page, probe, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const fake = await fakeFor("standard");
    // the view's own tile read is refused, so the overview tier is what is drawn
    fake.on({ route: /^\/cube\/tile/ }).fail({ status: 500 });
    await page.goto(`${fake.url}/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2`);
    await page.waitForFunction(() => {
      const line = document.getElementById("ol-loading");
      return line.hidden || line.getAttribute("role") === "alert";
    });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    await openPlane(page);
    const { displayed } = await levels(page),
      list = await tiles(page);
    expect(displayed[0], "a coarse level is drawn").toBeGreaterThan(6);
    for (const t of list) expect(t.avail, `n ${t.n} m ${t.m}`).toBe(t.n >= displayed[0] && t.m >= displayed[1] ? "ready" : "unavailable");
  });

  test("a tile read held open makes tiles pending, and they are ready once it lands", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    await page.goto(`${fake.url}/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2`);
    await gate.arrived();
    await openPlane(page);
    await expect.poll(async () => (await tiles(page)).filter((t) => t.avail === "pending").length, { message: "tiles of the read under way are pending" }).toBeGreaterThan(0);
    gate.open();
    await S.atRest(page, fake, probe);
    await expect.poll(async () => (await tiles(page)).filter((t) => t.avail === "pending").length, { timeout: 15000 }).toBe(0);
  });
});

test.describe("B29 the glyphs are separate, neutral, and together", () => {
  test("no tile and no key uses the gold, the Volume green or the Evidence violet", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${VIEW}`);
    await S.atRest(page, fake, probe);
    await openPlane(page);
    const market = Object.values(await marketColours(page));
    const all = await page.locator("#ol-plane button, .ol-plane-key i").evaluateAll((list) => {
      const out = new Set();
      for (const b of list)
        for (const pseudo of [null, "::before", "::after"]) {
          const s = getComputedStyle(b, pseudo);
          out.add([s.backgroundImage, s.backgroundColor, s.boxShadow, s.borderTopColor].join(" | "));
        }
      return [...out];
    });
    for (const style of all) for (const c of market) expect(style.includes(c), `${style} uses ${c}`).toBe(false);
  });

  test("selected and unavailable: the frame and the slash are both there", async ({ page, probe, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const fake = await fakeFor("standard");
    // the view's own tile read is refused: the level asked for stays unavailable and a coarser one is drawn
    fake.on({ route: /^\/cube\/tile/ }).fail({ status: 500 });
    await page.goto(`${fake.url}/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2`);
    await page.waitForFunction(() => {
      const line = document.getElementById("ol-loading");
      return line.hidden || line.getAttribute("role") === "alert";
    });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    await openPlane(page);
    const pressed = page.locator('#ol-plane button[aria-pressed="true"]');
    await expect(pressed).toHaveAttribute("data-avail", "unavailable");
    const s = await styleOf(pressed);
    expect(s.image, "the slash of an unavailable tile").toContain("linear-gradient");
    expect(s.shadow, "the frame of the current level").not.toBe("none");
    expect(s.transform, "the current level is not scaled up over its neighbours").toBe("none");
    const glyph = await styleOf(pressed, "::after");
    expect(glyph.width, "and its size glyph is still drawn").not.toBe("auto");
  });

  test("diagonal and small: the corner badge and the dot are both drawn", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${VIEW}`);
    await S.atRest(page, fake, probe);
    await openPlane(page);
    const tile = page.locator('#ol-plane button[data-path="true"][data-size="small"]').first();
    await expect(tile, "the diagonal has a small tile").toBeVisible();
    const badge = await styleOf(tile, "::before"),
      dot = await styleOf(tile, "::after");
    expect(badge.image, "the diagonal's badge").toContain("linear-gradient");
    expect(dot.width, "the small dot is 3 px").toBe("3px");
    expect(dot.colour, "in the ink").not.toBe("rgba(0, 0, 0, 0)");
  });

  test("focused and pending: the two-tone ring and the dots are both drawn", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    const gate = fake.on({ route: /^\/cube\/tile/ }).gate();
    await page.goto(`${fake.url}/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2`);
    await gate.arrived();
    await openPlane(page);
    await expect.poll(async () => (await tiles(page)).filter((t) => t.avail === "pending").length).toBeGreaterThan(0);
    const pending = (await tiles(page)).find((t) => t.avail === "pending"),
      tile = page.locator(`#ol-plane button[data-n="${pending.n}"][data-m="${pending.m}"]`);
    // keyboard focus: the plane is one tab stop at the current level; arrows move within it
    await page.locator('#ol-plane button[tabindex="0"]').focus();
    for (let i = 0; i < 12 && !(await tile.evaluate((b) => document.activeElement === b)); i++) {
      const at = await page.evaluate(() => ({ n: Number(document.activeElement.dataset.n), m: Number(document.activeElement.dataset.m) }));
      await page.keyboard.press(at.n < pending.n ? "ArrowRight" : at.n > pending.n ? "ArrowLeft" : at.m < pending.m ? "ArrowUp" : "ArrowDown");
    }
    await expect(tile).toBeFocused();
    const s = await styleOf(tile);
    expect((s.shadow.match(/rgb/g) || []).length, "a ring of three bands: surface, ink, surface").toBeGreaterThanOrEqual(3);
    expect(s.image, "and the tile is still the dots of a pending one").toContain("radial-gradient");
    gate.open();
  });

  test("the key is tiles of the same attributes, and the toolbar's coarse mark is the table's tick", async ({ page, probe, fakeFor, allowConsole }) => {
    allowConsole(/Failed to load resource/);
    const fake = await fakeFor("standard");
    // a coarser level than asked is drawn (the view's own tile is refused), so the toolbar shows its mark
    fake.on({ route: /^\/cube\/tile/ }).fail({ status: 500 });
    await page.goto(`${fake.url}/#t=2026-05-28T00:00Z~2026-09-24T00:00Z&p=22000~27000&vis=2`);
    await page.waitForFunction(() => {
      const line = document.getElementById("ol-loading");
      return line.hidden || line.getAttribute("role") === "alert";
    });
    await fake.idle({ quietMs: 600, timeoutMs: 30000 });
    await probe.waitForQuiet({ quietMs: 400, timeout: 30000 });
    await openPlane(page);
    const keys = await page.locator(".ol-plane-key span").evaluateAll((list) => list.map((s) => ({ key: s.dataset.planeKey, text: s.textContent, attrs: { ...s.querySelector("i").dataset } })));
    expect(keys.map((k) => k.key)).toEqual(["avail:pending", "avail:unavailable", "avail:ready", "size:small", "size:usable", "size:large", "path:true", "current:true"]);
    for (const k of keys) expect(k.text.length, k.key).toBeGreaterThan(3);
    // each sample has the attribute of its row, so the plane's own CSS paints it
    for (const k of keys) expect(Object.entries(k.attrs).length).toBe(1);
    // the toolbar mark shows while the level drawn is coarser than asked for, and is a painted swatch of the table, not a gold dot
    await expect(page.locator("#ol-res[data-coarse='true'] .ol-res-coarse canvas")).toBeVisible();
    const gold = (await marketColours(page)).poc;
    const dot = await page.locator("#ol-res .ol-res-coarse").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(dot, "no gold behind it").not.toBe(gold);
  });

  test("the steppers are a named group of 44 px targets", async ({ page, probe, fakeFor }) => {
    const fake = await fakeFor("standard");
    await page.goto(`${fake.url}/${VIEW}`);
    await S.atRest(page, fake, probe);
    await page.locator("#ol-res").click();
    const group = page.locator('#ol-res-pop .ol-steppers[role="group"]');
    await expect(group).toBeVisible();
    for (const id of ["tminus", "tplus", "pminus", "pplus"]) {
      const box = await page.locator(`#ol-${id}`).boundingBox();
      expect(box.width, id).toBeGreaterThanOrEqual(44);
      expect(box.height, id).toBeGreaterThanOrEqual(44);
      expect(await page.locator(`#ol-${id}`).getAttribute("aria-label"), id).toMatch(/cells/);
    }
  });
});
