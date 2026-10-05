"use strict";
const { test, expect } = require("./fixtures.js");
const D = require("./drawings-support.js");
const paneRecorder = require("./pane-canvas.js");
test.use({ reducedMotion: "reduce" });
const PREFIX = "market-state-cube-explorer:";
const TAG = "TL_LABEL_";

// Observe native canvas commands, preserving every original call. Text position
// and rotation come from Canvas's transform, independently of app label helpers.
async function observeText(page) {
  await paneRecorder.addRecorder(page);
  await page.addInitScript(() => {
    let frame = [], clip = null, path = [], stack = [];
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
    Object.defineProperty(HTMLCanvasElement.prototype, "width", {
      configurable: true, enumerable: width.enumerable, get() { return width.get.call(this); },
      set(value) { if (this.id === "ol-canvas") { frame = []; clip = null; path = []; stack = []; } width.set.call(this, value); },
    });
    const p = CanvasRenderingContext2D.prototype;
    const xy = (ctx, x, y) => { const m = ctx.getTransform(), d = devicePixelRatio; return [(m.a * x + m.c * y + m.e) / d, (m.b * x + m.d * y + m.f) / d]; };
    const wrap = (name, inspect) => { const original = p[name]; p[name] = function (...args) { if (this.canvas.id === "ol-canvas") inspect.call(this, args); return original.apply(this, args); }; };
    wrap("beginPath", () => { path = []; });
    for (const name of ["moveTo", "lineTo"]) wrap(name, function ([x, y]) { path.push(xy(this, x, y)); });
    wrap("rect", function ([x, y, w, h]) { path.push(xy(this, x, y), xy(this, x + w, y), xy(this, x + w, y + h), xy(this, x, y + h)); });
    wrap("save", () => { stack.push(clip && [...clip]); });
    wrap("restore", () => { clip = stack.pop() || null; });
    wrap("clip", () => {
      if (!path.length) return;
      const box = [Math.min(...path.map((p) => p[0])), Math.min(...path.map((p) => p[1])), Math.max(...path.map((p) => p[0])), Math.max(...path.map((p) => p[1]))];
      clip = clip ? [Math.max(clip[0], box[0]), Math.max(clip[1], box[1]), Math.min(clip[2], box[2]), Math.min(clip[3], box[3])] : box;
    });
    wrap("fillText", function ([text, x, y]) {
      const m = this.getTransform(), metric = this.measureText(String(text));
      frame.push({ text: String(text), at: xy(this, x, y), matrix: [m.a, m.b, m.c, m.d, m.e, m.f], angle: Math.atan2(m.b, m.a), fill: this.fillStyle, alpha: this.globalAlpha, font: this.font, align: this.textAlign, baseline: this.textBaseline, width: metric.width, left: metric.actualBoundingBoxLeft, right: metric.actualBoundingBoxRight, local: [x, y], ascent: metric.actualBoundingBoxAscent, descent: metric.actualBoundingBoxDescent, clip: clip && [...clip] });
    });
    Object.defineProperty(window, "__labelCanvas", { value: { frame: () => JSON.parse(JSON.stringify(frame)) } });
  });
}
const allTexts = (page) => page.evaluate(() => window.__labelCanvas.frame());
const texts = async (page) => (await allTexts(page)).filter((t) => t.text.startsWith(TAG));
const committed = (page) => page.evaluate((prefix) => JSON.parse(sessionStorage.getItem(prefix + "drawings:v1:session")).collection.objects, PREFIX);
const object = async (page, id) => (await committed(page)).find((object) => object.id === id);
const revision = (page) => page.locator("#ol-canvas").getAttribute("data-drawing-revision").then(Number);
async function setLabel(page, id, label, color) {
  await D.edit(page, id); await page.locator("#ol-drawing-label").fill(label);
  if (color) await page.locator("#ol-drawing-color").fill(color);
  await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
}
async function copied(page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  // The OS clipboard is shared by parallel workers. Observe this page's native
  // write while still performing it, rather than reading another tab's export.
  await page.evaluate(() => {
    if (!window.__labelCopyObserver) {
      const originalText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => { window.__labelCopied = String(text); return originalText(text); };
      const originalItems = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = (items) => {
        for (const item of items) if (item.types.includes("text/plain"))
          item.getType("text/plain").then((blob) => blob.text()).then((text) => { window.__labelCopied = text; });
        return originalItems(items);
      };
      window.__labelCopyObserver = true;
    }
    window.__labelCopied = "";
  });
  await D.persistence.openQuery(page); await page.locator("#ol-copy-view").click();
  await expect.poll(() => page.evaluate(() => window.__labelCopied)).toMatch(/^origo-cube:3j?\./);
  return page.evaluate(() => window.__labelCopied);
}
async function snapshot(page, testInfo, name) {
  const path = testInfo.outputPath(name + ".png"); await page.screenshot({ path }); await testInfo.attach(name, { path, contentType: "image/png" });
}
async function productShot(page, name) {
  const fs = require("node:fs"), path = require("node:path"), dir = path.resolve(__dirname, "../../reports/trend-line-labels");
  fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, name + ".png") });
}

test("label is optional; preview, Cancel and two-stage Undo preserve committed name and geometry", async ({ page, fakeFor }) => {
  await observeText(page); const fake = await fakeFor("mini"); await D.open(page, fake);
  const { id } = await D.drawing(page), original = await object(page, id), before = await revision(page);
  expect(original).not.toHaveProperty("label"); await D.edit(page, id);
  await expect(page.locator("#ol-drawing-label")).toHaveValue("");
  await page.locator("#ol-drawing-name").fill(TAG + "inventory_only"); await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
  await expect.poll(() => texts(page)).toEqual([]);
  const named = await object(page, id), namedRevision = await revision(page);
  await D.edit(page, id); await page.locator("#ol-drawing-label").fill(TAG + "preview");
  await expect.poll(async () => (await texts(page)).some((t) => t.text === TAG + "preview" && t.alpha < 1)).toBe(true);
  expect(await object(page, id)).toEqual(named); expect(await revision(page)).toBe(namedRevision);
  await page.locator("#ol-drawing-cancel").click(); await D.closeManager(page); await expect.poll(() => texts(page)).toEqual([]);
  await setLabel(page, id, TAG + "committed"); expect(await object(page, id)).toMatchObject({ ...named, label: TAG + "committed" });
  await D.edit(page, id); await page.locator("#ol-drawing-label").fill(TAG + "dirty"); await page.locator("#ol-drawing-editor-undo").click();
  await expect(page.locator("#ol-drawing-editor")).toBeHidden(); expect((await object(page, id)).label).toBe(TAG + "committed");
  await D.command(page, "undo"); expect(await object(page, id)).toEqual(named);
  await D.command(page, "redo"); expect((await object(page, id)).label).toBe(TAG + "committed");
  await D.closeManager(page); await setLabel(page, id, "   "); await expect.poll(() => texts(page)).toEqual([]);
  expect((await object(page, id)).label || "").toBe("");
  expect((await object(page, id)).a).toEqual(original.a); expect((await object(page, id)).b).toEqual(original.b);
  expect(await revision(page)).toBeGreaterThan(before);
});

test("label literal text survives duplicate, hide, delete and Undo without becoming markup", async ({ page, fakeFor }) => {
  await observeText(page); const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page);
  const label = TAG + '<img src=x onerror="alert(1)"> & ↑ €'; await setLabel(page, id, label, "#dfb967");
  await expect.poll(async () => (await texts(page)).some((t) => t.text === label && t.fill === "#dfb967")).toBe(true);
  expect(await page.locator('[data-drawing-row] img').count()).toBe(0);
  await D.action(page, id, "duplicate"); const duplicate = await D.active(page);
  expect((await object(page, duplicate)).label).toBe(label); expect((await object(page, duplicate)).color).toBe("#dfb967");
  await D.action(page, id, "visible"); await D.action(page, duplicate, "visible"); await D.closeManager(page); await expect.poll(() => texts(page)).toEqual([]);
  await D.action(page, duplicate, "visible"); await D.closeManager(page); await expect.poll(async () => (await texts(page)).length).toBeGreaterThan(0);
  await D.action(page, duplicate, "delete"); await D.closeManager(page); await expect.poll(() => texts(page)).toEqual([]);
  await D.command(page, "undo"); expect((await object(page, duplicate)).label).toBe(label);
});

test("label reload, complete code and named View restore the exact optional text with no local lookup", async ({ page, freshContext, fakeFor }) => {
  await observeText(page); const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page);
  const label = TAG + "UTC breakout ↑"; await setLabel(page, id, label, "#a87823");
  const code = await copied(page), value = D.decodeCode(code);
  expect(value.visualVersion).toBe(3); expect(value.drawings.schemaVersion).toBe(1); expect(value.drawings.objects[0]).toMatchObject({ id, label, color: "#a87823" });
  await page.reload(); await D.ready(page); expect((await object(page, id)).label).toBe(label);
  const context = await freshContext(), restored = await context.newPage(); await observeText(restored); await D.open(restored, fake);
  await D.persistence.importCode(restored, code); await expect.poll(() => D.count(restored)).toBe(1);
  expect((await object(restored, id)).label).toBe(label); await expect.poll(async () => (await texts(restored)).some((t) => t.text === label)).toBe(true);
  await D.persistence.openViews(page); await page.locator("#ol-view-name").fill("Label complete snapshot"); await page.locator("#ol-view-form button[type=submit]").click();
  await expect.poll(async () => (await D.persistence.namedEntries(page)).find((entry) => entry.name === "Label complete snapshot")?.payload?.drawings?.objects[0]?.label).toBe(label);
  await page.keyboard.press("Escape"); await setLabel(page, id, TAG + "changed");
  await D.persistence.openViews(page); await page.locator("#ol-saved .ol-entry").filter({ hasText: "Label complete snapshot" }).click();
  await expect(page.locator("#ol-drawing-replace")).toBeVisible(); await page.locator('[data-drawing-replace="replace"]').click();
  await expect.poll(async () => (await object(page, id)).label).toBe(label);
});

for (const colorScheme of ["light", "dark"]) test.describe(`label geometry ${colorScheme}`, () => {
  test.use({ colorScheme });
  test("plain label stays above, parallel and upright for horizontal, rising, falling and reversed anchors", async ({ page, fakeFor }, testInfo) => {
    await observeText(page); const pane = paneRecorder.forPage(page), fake = await fakeFor("mini"); await D.open(page, fake);
    const { id } = await D.drawing(page);
    for (const [name, a, b, color] of [["horizontal", [.25, .5], [.75, .5], "#ff0000"], ["rising", [.25, .75], [.75, .25], "#00ff00"], ["falling", [.25, .25], [.75, .75], "#0000ff"], ["reversed", [.75, .25], [.25, .75], "#a87823"], ["vertical", [.5, .25], [.5, .75], "#dfb967"]]) {
      await D.edit(page, id); await page.locator("#ol-drawing-label").fill(TAG + name); await page.locator("#ol-drawing-color").fill(color);
      for (const [key, pair] of [["a", a], ["b", b]]) { const value = D.expected(...pair); await page.locator(`#ol-drawing-${key}-time`).fill(new Date(value.timeMs).toISOString()); await page.locator(`#ol-drawing-${key}-price`).fill((value.priceCents / 100).toFixed(2)); }
      await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
      await expect.poll(async () => (await texts(page)).filter((t) => t.text === TAG + name).length).toBe(1);
      const text = (await texts(page)).find((t) => t.text === TAG + name), frame = await pane.last();
      const core = frame.strokes.find((stroke) => stroke.stroke === color && stroke.width === 1.5 && stroke.path.length === 2);
      expect(core).toBeTruthy(); const [A, B] = core.path, dx = B[0] - A[0], dy = B[1] - A[1], length = Math.hypot(dx, dy);
      expect(text.angle).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-9); expect(text.angle).toBeLessThan(Math.PI / 2);
      expect(Math.abs(Math.cos(text.angle) * dy - Math.sin(text.angle) * dx) / length, "text baseline is parallel to source ink").toBeLessThan(1e-6);
      expect(text.fill).toBe(color); expect(text.alpha).toBe(1);
      expect(text.font).toMatch(/^11px /); expect(text.font).toContain("sans-serif");
      const midpoint = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], gap = Math.sin(text.angle) * (text.at[0] - midpoint[0]) - Math.cos(text.angle) * (text.at[1] - midpoint[1]);
      expect(gap - text.descent, "ink bottom sits six CSS pixels above the line").toBeCloseTo(6, 3); expect(text.width).toBeLessThanOrEqual(length - 16);
      expect(text.clip).toBeTruthy(); const [x, y, w, h] = await page.locator("#ol-canvas").getAttribute("data-layout").then((s) => s.split(",").map(Number));
      expect(text.clip).toEqual([x, y, x + w, y + h]);
      const [ma, mb, mc, md] = text.matrix, d = Math.hypot(ma, mb);
      for (const tx of [-text.left - .5, text.right + .5]) for (const ty of [-text.ascent - .5, text.descent + .5]) {
        const corner = [text.at[0] + (ma * tx + mc * ty) / d, text.at[1] + (mb * tx + md * ty) / d];
        expect(corner[0]).toBeGreaterThanOrEqual(x + .99); expect(corner[0]).toBeLessThanOrEqual(x + w - .99);
        expect(corner[1]).toBeGreaterThanOrEqual(y + .99); expect(corner[1]).toBeLessThanOrEqual(y + h - .99);
      }
      await snapshot(page, testInfo, `labels-${colorScheme}-${name}`);
    }
    await setLabel(page, id, TAG + "lens", "#a87823");
    await snapshot(page, testInfo, `labels-${colorScheme}-slopes`);
    await page.locator("#ol-canvas").focus(); await page.keyboard.press("k"); await expect(page.locator("#ol-candle-legend")).toHaveAttribute("data-state", "ready");
    await expect.poll(async () => (await texts(page)).some((t) => t.text === TAG + "lens")).toBe(true);
    await page.keyboard.press("l"); const p = await D.plot(page), middle = D.point(p, .5, .5); await page.mouse.move(middle.x, middle.y);
    await expect(page.locator("#ol-lensbar")).toBeVisible(); await expect.poll(async () => (await texts(page)).some((t) => t.text === TAG + "lens")).toBe(true);
    const lensLabels = (await texts(page)).filter((t) => t.text === TAG + "lens");
    expect(lensLabels.length, "label also paints through a held Lens intersection").toBeGreaterThanOrEqual(2);
    for (const label of lensLabels) { expect(label.matrix).toEqual(lensLabels[0].matrix); expect(label.at).toEqual(lensLabels[0].at); }
    await snapshot(page, testInfo, `labels-${colorScheme}-lens`);
    await page.keyboard.press("l"); await D.edit(page, id); await page.locator("#ol-drawing-label").fill("Breakout retest");
    for (const [key, pair] of [["a", [.25, .75]], ["b", [.75, .25]]]) { const value = D.expected(...pair); await page.locator(`#ol-drawing-${key}-time`).fill(new Date(value.timeMs).toISOString()); await page.locator(`#ol-drawing-${key}-price`).fill((value.priceCents / 100).toFixed(2)); }
    await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
    const support = await D.drawing(page, [.125, .85], [.875, .85]); await setLabel(page, support.id, "Support", "#00ff00");
    await productShot(page, `labels-${colorScheme}`);
  });
});


test("invalid optional labels reject the complete code atomically while blank labels remain omitted", async ({ page, fakeFor }) => {
  await observeText(page); const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page);
  await setLabel(page, id, "  " + TAG + "trimmed" + "  "); expect((await object(page, id)).label).toBe(TAG + "trimmed");
  const value = D.decodeCode(await copied(page)), before = await object(page, id), beforeRevision = await revision(page);
  for (const invalid of ["x".repeat(81), "bad\u0000label", "bad\u0085label", "bad\ud800label"]) {
    const bad = structuredClone(value); bad.drawings.objects[0].label = invalid;
    await D.persistence.importCode(page, D.plainCode(bad));
    await expect(page.locator("#ol-copy-status")).toContainText(/not applied|label/i);
    await expect(page.locator("#ol-drawing-replace")).toHaveCount(0);
    expect(await object(page, id)).toEqual(before); expect(await revision(page)).toBe(beforeRevision);
  }
});

for (const [name, suffix] of [["combining marks", "e\u0301".repeat(35)], ["ZWJ emoji", "👩‍👩‍👧‍👦".repeat(10)]]) {
  test(`without Intl.Segmenter, ${name} labels stay intact or omit and recover when the line widens`, async ({ page, fakeFor }) => {
    await page.addInitScript(() => { Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined }); });
    await observeText(page); const fake = await fakeFor("mini"); await D.open(page, fake);
    const { id } = await D.drawing(page, [.125, .5], [.875, .5]), label = TAG + suffix;
    await setLabel(page, id, label);
    await expect.poll(async () => (await texts(page)).map((t) => t.text)).toEqual([label]);
    for (const [a, b, shown] of [[[.45, .5], [.55, .5], false], [[.125, .5], [.875, .5], true]]) {
      await D.edit(page, id);
      await expect(page.locator("#ol-drawing-label")).toHaveValue(label);
      for (const [key, pair] of [["a", a], ["b", b]]) {
        const value = D.expected(...pair);
        await page.locator(`#ol-drawing-${key}-time`).fill(new Date(value.timeMs).toISOString());
        await page.locator(`#ol-drawing-${key}-price`).fill((value.priceCents / 100).toFixed(2));
      }
      await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
      await expect.poll(async () => (await texts(page)).map((t) => t.text)).toEqual(shown ? [label] : []);
      expect((await object(page, id)).label).toBe(label);
    }
  });
}

test.describe("phone label fitting", () => {
  test.use({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, hasTouch: true });
  test("long grapheme labels fit clipped ink without changing storage or overflowing the editor", async ({ page, fakeFor }, testInfo) => {
    await observeText(page); const pane = paneRecorder.forPage(page), fake = await fakeFor("mini"); await page.goto(fake.url + "/" + D.HASH);
    await expect(page.locator("#ol-canvas")).toHaveAttribute("data-layout", /\d/);
    await page.locator("#ol-sheet-toggle").click(); await D.ready(page); await page.locator("#ol-sheet-close").click();
    const { id } = await D.drawing(page, [.125, .5], [.875, .5]);
    await page.locator("#ol-sheet-toggle").click();
    const label = TAG + "e\u0301".repeat(35); expect([...label].length).toBeLessThanOrEqual(80);
    await D.edit(page, id); await page.locator("#ol-drawing-label").fill(label);
    const input = await page.locator("#ol-drawing-label").boundingBox(); expect(input.height).toBeGreaterThanOrEqual(44);
    const editor = await page.locator("#ol-drawing-editor").evaluate((dialog) => ({ width: dialog.clientWidth, scroll: dialog.scrollWidth, viewport: innerWidth, right: dialog.getBoundingClientRect().right }));
    expect(editor.scroll).toBeLessThanOrEqual(editor.width + 1); expect(editor.right).toBeLessThanOrEqual(editor.viewport);
    await snapshot(page, testInfo, "labels-phone-editor"); await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
    expect((await object(page, id)).label).toBe(label); await expect.poll(async () => (await texts(page)).length).toBe(1);
    const text = (await texts(page))[0], row = await D.row(page, id), frame = await pane.last();
    const core = frame.strokes.find((stroke) => stroke.stroke === row.color && stroke.width === 1.5 && stroke.path.length === 2);
    expect(text.text.endsWith("…")).toBe(true); expect(text.text.length).toBeLessThan(label.length);
    expect(text.text.slice(0, -1)).not.toMatch(/e$/); // a combining-mark cluster is never split
    expect(text.width).toBeLessThanOrEqual(Math.hypot(core.path[1][0] - core.path[0][0], core.path[1][1] - core.path[0][1]) - 16);
    const [x, y, w, h] = await page.locator("#ol-canvas").getAttribute("data-layout").then((s) => s.split(",").map(Number));
    expect(text.clip).toEqual([x, y, x + w, y + h]);
    expect(text.at[0] - text.left).toBeGreaterThanOrEqual(x); expect(text.at[0] + text.right).toBeLessThanOrEqual(x + w);
    expect(text.at[1] - text.ascent).toBeGreaterThanOrEqual(y); expect(text.at[1] + text.descent).toBeLessThanOrEqual(y + h);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await snapshot(page, testInfo, "labels-phone-ellipsis");
    if (await page.locator("#ol-lines").isHidden()) await page.locator("#ol-sheet-toggle").click();
    await setLabel(page, id, "Support", "#a87823");
    if (await page.locator("#ol-sheet-close").isVisible()) await page.locator("#ol-sheet-close").click();
    await productShot(page, "labels-phone");
  });
});


test("locked labels follow changed line RGB; tiny and plot-top lines omit unfit text without losing it", async ({ page, fakeFor }, testInfo) => {
  await observeText(page); const fake = await fakeFor("mini"); await D.open(page, fake); const { id } = await D.drawing(page);
  await setLabel(page, id, TAG + "locked"); await D.action(page, id, "lock");
  const anchors = await object(page, id); await D.edit(page, id);
  await expect(page.locator("#ol-drawing-a-time")).toBeDisabled(); await expect(page.locator("#ol-drawing-label")).toBeEnabled();
  await page.locator("#ol-drawing-label").fill(TAG + "locked_edit"); await page.locator("#ol-drawing-color").fill("#ff00ff");
  await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
  await expect.poll(async () => (await texts(page)).some((t) => t.text === TAG + "locked_edit" && t.fill === "#ff00ff")).toBe(true);
  expect((await object(page, id)).a).toEqual(anchors.a); expect((await object(page, id)).b).toEqual(anchors.b);
  await D.action(page, id, "lock");
  for (const [name, a, b] of [["tiny", [.49, .5], [.495, .5]], ["top", [.25, .005], [.75, .005]]]) {
    await D.edit(page, id); await page.locator("#ol-drawing-label").fill(TAG + name);
    for (const [key, pair] of [["a", a], ["b", b]]) { const value = D.expected(...pair); await page.locator(`#ol-drawing-${key}-time`).fill(new Date(value.timeMs).toISOString()); await page.locator(`#ol-drawing-${key}-price`).fill((value.priceCents / 100).toFixed(2)); }
    await page.locator("#ol-drawing-apply").click(); await D.closeManager(page);
    await expect.poll(() => texts(page)).toEqual([]); expect((await object(page, id)).label).toBe(TAG + name);
    await snapshot(page, testInfo, "labels-clipped-" + name);
  }
});

test("the preceding reader rejects a labeled complete code whole rather than dropping its label", async ({ page, fakeFor }) => {
  const fs = require("node:fs"), path = require("node:path"), { materialise } = require("../support/builds.js");
  const preceding = materialise("59d4269", "labels-preceding-reader"), fake = await fakeFor("mini");
  const oldHTML = fs.readFileSync(path.join(preceding.dir, "index.html"), "utf8");
  await page.route("**/labels-old.html*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: oldHTML }));
  await D.open(page, fake); const { id } = await D.drawing(page); await setLabel(page, id, TAG + "safe_old_reader");
  const code = await copied(page); expect(D.decodeCode(code).drawings.objects[0]).toMatchObject({ id, label: TAG + "safe_old_reader" });
  await page.goto(fake.url + "/labels-old.html" + D.HASH); await D.ready(page);
  const before = await D.rows(page), beforeHash = new URL(page.url()).hash;
  const beforeSession = await page.evaluate((prefix) => sessionStorage.getItem(prefix + "drawings:v1:session"), PREFIX);
  // This reader's import UI uses generic words for every structural rejection.
  // Verify the precise public-codec reason before asserting its historical message.
  const rejected = await page.evaluate(async (text) => {
    try {
      await window.explorerEncoding.codec.decodePortable(text, { inflate: async (bytes) =>
        new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()) });
      return null;
    } catch (error) { return { code: error.code, reason: error.reason }; }
  }, code);
  expect(rejected).toEqual({ code: "structure", reason: 'the member "label" is not part of a view code (at drawings.objects[])' });
  await D.persistence.importCode(page, code);
  await expect(page.locator("#ol-copy-status")).toHaveText("That isn't a cube query or a view code. Paste the JSON from Copy query, or a view code (it starts with origo-cube:).");
  expect(await D.rows(page)).toEqual(before); expect(new URL(page.url()).hash).toBe(beforeHash);
  expect(await page.evaluate((prefix) => sessionStorage.getItem(prefix + "drawings:v1:session"), PREFIX)).toBe(beforeSession);
  await D.open(page, fake); expect((await object(page, id)).label).toBe(TAG + "safe_old_reader");
});


test("labels share their line budget and focus restores both ink and text without a default active exemption", async ({ page, fakeFor }, testInfo) => {
  await observeText(page); const pane = paneRecorder.forPage(page), fake = await fakeFor("mini"); await D.open(page, fake);
  const value = D.decodeCode(await copied(page));
  const objects = Array.from({ length: 200 }, (_, ordinal) => {
    const x = .05 + (ordinal % 10) * .077, y = .12 + Math.floor(ordinal / 10) * .039;
    return { id: `00000000-0000-4000-8000-${(ordinal + 1).toString(16).padStart(12, "0")}`, name: "Label budget " + ordinal,
      a: D.expected(x, y), b: D.expected(x + .14, y - .09), color: "#ed" + ordinal.toString(16).padStart(2, "0") + "35", visible: true, locked: false, ordinal };
  });
  value.drawings = { schemaVersion: 1, instrument: "binance:spot:BTCUSDT", visible: true, objects };
  async function restore() {
    await D.persistence.importCode(page, D.plainCode(value));
    if (await page.locator("#ol-drawing-replace").isVisible()) await page.locator('[data-drawing-replace="replace"]').click();
    await expect(page.locator("#ol-copy-status")).toHaveText("View restored"); await expect.poll(() => D.count(page)).toBe(200);
    await page.locator("#ol-drawer-toggle").click(); await D.manager(page); await D.plot(page);
  }
  await restore(); const unlabeled = (await D.rows(page)).filter((row) => row.state === "Shown").length;
  objects.forEach((object, i) => { object.label = TAG + "budget" + i.toString().padStart(3, "0") + " Breakout retest support zone"; });
  await D.closeManager(page); await restore(); expect(await D.active(page)).toBe("");
  const rows = await D.rows(page), shown = rows.filter((row) => row.state === "Shown"), held = rows.filter((row) => row.state === "Held back");
  expect(shown.length).toBeGreaterThan(0); expect(held.length).toBeGreaterThan(0); expect(shown.length).toBeLessThan(unlabeled);
  const frame = await pane.last(), colors = new Set(objects.map((object) => object.color));
  const ink = [...new Set(frame.strokes.filter((stroke) => stroke.width === 1.5 && stroke.path.length === 2 && colors.has(stroke.stroke)).map((stroke) => stroke.stroke))].sort();
  expect(ink).toEqual(shown.map((row) => row.color).sort());
  const labels = await texts(page);
  for (const row of shown) expect(labels.some((text) => text.text.startsWith(TAG + "budget" + objects.find((object) => object.id === row.id).ordinal.toString().padStart(3, "0")))).toBe(true);
  for (const row of held) expect(labels.some((text) => text.fill === row.color)).toBe(false);
  await D.action(page, held[0].id, "focus"); await D.closeManager(page);
  await expect.poll(async () => (await D.row(page, held[0].id)).state).toBe("Shown");
  await expect.poll(async () => (await texts(page)).some((text) => text.fill === held[0].color)).toBe(true);
  const counts = JSON.stringify({ unlabeled, labeled: shown.length, held: held.length });
  await testInfo.attach("label-budget-counts", { body: counts, contentType: "application/json" });
  const fs = require("node:fs"), path = require("node:path"), dir = path.resolve(__dirname, "../../reports/trend-line-labels");
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "budget-counts.json"), counts + "\n");
});
