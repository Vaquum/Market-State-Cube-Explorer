"use strict";
// tests/browser/observe.js (H7a): the observation surface of the page, as a helper for the specs.
//
// INTEGRATION.md D.18 is the one list of what a browser test may read (DD-T25): the chips and their data-*
// attributes, the details fields of the chip popovers, the readouts (tooltip, Cells-table rows, legend marker),
// the generated keys, the notices, the copy status, the canvas pixels at DPR 1 and the real preset keys. This
// file is the ONLY place in tests/browser that names a selector, and the one piece of the probe that needs
// two selectors (the main canvas id and the chip attribute) takes them from SURFACE below.
//
//   const { observe } = require("./observe.js");
//   const surface = observe(page);                 // or the `surface` fixture of fixtures.js
//   const chip = await surface.chip("cells");      // { id, text, data: { state, mappingId, fitSeq, ... } }
//
// THIS IS A SKELETON (WORKPLAN 3.9, H7a): the page of Wave 1 has none of the D.18 markup yet, and the feature
// packages add it in Wave 2. A D.18 element that does not exist makes the helper that needs it throw a
// MissingSurfaceElement whose message names the element and its selector, so the spec that needs it fails
// there and says why. Nothing here skips silently, and nothing is invented: where D.18 does not say enough
// (how a cell key becomes a canvas point) the helper says so and takes the geometry from the caller.
//
// Oracle: there is nothing to compute here. The helpers only read the page; probe-selfcheck.spec.js checks
// them against a synthetic page whose markup and pixels are written out literally in that file.

// What D.18 names. `probe` is what probe.js needs from the page (the draw frame is defined on the main canvas,
// DD-T28, and the frame log snapshots every chip, D.18 "Chips").
const SURFACE = Object.freeze({
  canvas: Object.freeze({ id: "ol-canvas", selector: "#ol-canvas" }),
  chips: Object.freeze({ cells: "#ol-legend", rows: "#ol-rows-legend", axis: "#ol-axis-chip", lens: "#ol-lens-status" }),
  // The lens has no popover of its own: its shares are in the Cells popover's lens block (D.18, DD-98).
  popovers: Object.freeze({ cells: "#ol-legend-pop", rows: "#ol-rows-legend-pop", axis: "#ol-axis-pop" }),
  tip: "#ol-tip",
  marker: "#ol-legend-marker",
  cellRows: "tr[data-cell-key]",
  keysContainer: "#ol-keys-scale",
  notice: "#ol-notice",
  copyStatus: "#ol-copy-status",
  probe: Object.freeze({ chip: "[data-channel]" }),
});

// The window keys of the page (WINDOW_KEYS at 8c82ca1, src/explorer.js: index = the digit that chooses it).
const PRESET_KEYS = Object.freeze({ 0: "all", 1: "15m", 2: "30m", 3: "1h", 4: "4h", 5: "12h", 6: "24h", 7: "7d", 8: "30d", 9: "1y" });

class MissingSurfaceElement extends Error {
  constructor(what, selector) {
    super(`INTEGRATION.md D.18 element not found: ${what} (${selector})`);
    this.name = "MissingSurfaceElement";
    this.element = what;
    this.selector = selector;
  }
}

// observe(page, {locate, timeout}) -> the helpers for one page.
//   locate(key) -> {x, y}: how a cell key ("<n>:<m>:<c>:<r>") becomes a point in canvas CSS pixels. D.18 does not define
//     it (it is page geometry, not observation), so a spec that addresses cells by key supplies it from the reference
//     calculator and the address grammar (TESTPLAN 3.1, geometry rule). Without it a key is refused, never guessed.
//   timeout: how long an element may take to appear before it counts as missing (ms).
function observe(page, { locate = null, timeout = 3000 } = {}) {
  const at = (selector) => page.locator(selector).first();

  // The element must be attached soon; otherwise the spec fails naming it (and only a timeout becomes that error).
  async function need(selector, what, state = "attached") {
    const locator = at(selector);
    try {
      await locator.waitFor({ state, timeout });
    } catch (error) {
      if (error && error.name === "TimeoutError") throw new MissingSurfaceElement(state === "visible" ? `${what} (visible)` : what, selector);
      throw error;
    }
    return locator;
  }

  const chipSelector = (channel) => {
    if (!Object.hasOwn(SURFACE.chips, channel)) throw new RangeError(`unknown channel ${JSON.stringify(channel)}; D.18 names ${Object.keys(SURFACE.chips).join(", ")}`);
    return SURFACE.chips[channel];
  };

  // Every [data-field] below a root: name -> {value, text} for the details (data-value) and {canonical, text} for readouts
  // (data-canonical). The same name twice (a lens block beside the main block) is kept as name#2, never merged.
  const FIELDS = (root) => root.evaluate((el) => {
    const out = {};
    for (const field of el.querySelectorAll("[data-field]")) {
      let name = field.dataset.field;
      for (let i = 2; Object.hasOwn(out, name); i++) name = `${field.dataset.field}#${i}`;
      out[name] = { value: field.dataset.value ?? null, canonical: field.dataset.canonical ?? null, text: field.textContent.trim() };
    }
    return out;
  });

  // D.18 "Chips": the dataset of one chip as written by the draw that painted (camelCase keys: mappingId, fitSeq, ...).
  async function chip(channel) {
    const locator = await need(chipSelector(channel), `chip ${channel}`);
    return locator.evaluate((el) => ({ id: el.id, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), label: el.getAttribute("aria-label"), text: el.textContent.trim(), data: { ...el.dataset } }));
  }

  // The popover of a chip opened the way a keyboard user opens it: focus the chip, Enter; Escape closes it and returns
  // focus to the chip (D.18 "Details"). close() checks that focus really came back, because that is part of the contract.
  async function openLegendDetails(channel) {
    if (channel === "lens") throw new RangeError("the lens has no popover of its own: its shares are in the Cells popover (D.18, DD-98); use openLegendDetails(\"cells\")");
    const selector = chipSelector(channel);
    const popoverSelector = SURFACE.popovers[channel];
    const guide = page.locator("#ol-reference"), topic = channel === "axis" ? "columns" : "scales";
    const openedGuide = !(await guide.isVisible());
    if (openedGuide) await page.locator("#ol-reference-toggle").click();
    if (await page.locator("#ol-reference-topic").inputValue() !== topic) await page.locator("#ol-reference-topic").selectOption(topic);
    const trigger = await need(selector, `chip ${channel}`);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const popover = await need(popoverSelector, `details popover of the ${channel} chip`, "visible");
    return {
      popover,
      async close() {
        await page.keyboard.press("Escape");
        await popover.waitFor({ state: "hidden", timeout });
        const back = await trigger.evaluate((el) => el === document.activeElement);
        if (!back) throw new Error(`Escape closed the ${channel} popover (${popoverSelector}) but focus did not return to the chip (${selector})`);
        if (openedGuide) await page.locator("#ol-reference-close").click();
      },
    };
  }

  // D.18 "Details": every [data-field] of the chip's popover plus its warnings and generated keys. A popover that is not
  // open is opened with the keyboard and closed again (keepOpen leaves it open and returns close()).
  async function details(channel, { keepOpen = false } = {}) {
    if (channel === "lens") throw new RangeError("the lens has no popover of its own: read details(\"cells\") for the lens block (D.18, DD-98)");
    chipSelector(channel);
    const popoverSelector = SURFACE.popovers[channel];
    const visible = await at(popoverSelector).isVisible().catch(() => false);
    const opened = visible ? null : await openLegendDetails(channel);
    const popover = opened ? opened.popover : at(popoverSelector);
    const read = {
      channel,
      fields: await FIELDS(popover),
      warnings: await popover.evaluate((el) => [...el.querySelectorAll("[data-warning]")].map((w) => ({ warning: w.dataset.warning, shareMarks: w.dataset.shareMarks ?? null, shareArea: w.dataset.shareArea ?? null }))),
      keys: await popover.evaluate((el) => [...el.querySelectorAll("[data-key]")].map((k) => ({ key: k.dataset.key, role: k.dataset.role ?? null, count: k.dataset.count === undefined ? null : Number(k.dataset.count), text: k.textContent.trim() }))),
    };
    if (opened && !keepOpen) await opened.close();
    if (opened && keepOpen) read.close = opened.close;
    return read;
  }

  // D.18 "Readouts": the tooltip. data-readout is "<n>:<m>:<c>:<r>" (cells), "pane:<axis id>:<col>" or "row:<r>".
  async function tip() {
    const locator = await need(`${SURFACE.tip}[data-readout]`, "tooltip with data-readout");
    const head = await locator.evaluate((el) => ({ readout: el.dataset.readout, visible: !el.hidden, text: el.textContent.trim() }));
    return { ...head, fields: await FIELDS(locator) };
  }

  // The Cells-table row of a key, or the tooltip when it shows that key: both are built from the same Readout (D.18).
  async function readout(key) {
    const shown = await at(`${SURFACE.tip}[data-readout]`).getAttribute("data-readout").catch(() => null);
    if (shown === key) return { key, source: "tooltip", ...(await tip()) };
    const row = await need(`${SURFACE.cellRows}[data-cell-key=${JSON.stringify(key)}]`, `Cells-table row or tooltip for readout ${key}`);
    const level = await row.getAttribute("data-level");
    return { key, source: "table", level, fields: await FIELDS(row) };
  }

  // D.18 "Readouts": #ol-legend-marker[data-coordinate][data-readout].
  async function legendMarker() {
    const locator = await need(`${SURFACE.marker}[data-coordinate][data-readout]`, "legend marker with data-coordinate and data-readout");
    return locator.evaluate((el) => ({ coordinate: el.dataset.coordinate, readout: el.dataset.readout, visible: !el.hidden }));
  }

  // D.18 "Details": generated keys [data-key][data-role][data-count] inside #ol-keys-scale.
  async function keys() {
    const container = await need(SURFACE.keysContainer, "generated keys container");
    return container.evaluate((el) => [...el.querySelectorAll("[data-key]")].map((k) => ({ key: k.dataset.key, role: k.dataset.role ?? null, count: k.dataset.count === undefined ? null : Number(k.dataset.count), text: k.textContent.trim() })));
  }

  // D.18 "Notices and status": #ol-notice [data-notice][data-code][data-count].
  async function notices() {
    const container = await need(SURFACE.notice, "notice banner");
    return container.evaluate((el) => [...el.querySelectorAll("[data-notice]")].map((n) => ({ notice: n.dataset.notice, code: n.dataset.code ?? null, count: n.dataset.count === undefined ? null : Number(n.dataset.count), text: n.textContent.trim() })));
  }

  // D.18 "Details": [data-warning] elements with data-share-marks and data-share-area. They live in the popovers, so the
  // call needs the Cells chip to exist (a page without the D.18 chips fails here by name instead of reporting "no warnings").
  async function warnings() {
    await need(chipSelector("cells"), "chip cells");
    return page.evaluate(() => [...document.querySelectorAll("[data-warning]")].map((w) => ({ warning: w.dataset.warning, shareMarks: w.dataset.shareMarks ?? null, shareArea: w.dataset.shareArea ?? null })));
  }

  // D.18 "Notices and status": #ol-copy-status[data-address-level] is exact|ids|settings|refused.
  async function copyStatus() {
    const locator = await need(SURFACE.copyStatus, "copy status");
    return locator.evaluate((el) => ({ level: el.dataset.addressLevel ?? null, text: el.textContent.trim() }));
  }

  // The real window keys (TESTPLAN 3.1): 6 = 24h, 7 = 7d, 8 = 30d, 9 = 1y, 0 = all. A text field must not have focus or the
  // page's own handler ignores the key, so one that has is blurred first.
  async function pressPreset(key) {
    const digit = String(key);
    if (!Object.hasOwn(PRESET_KEYS, digit)) throw new RangeError(`${JSON.stringify(key)} is not a window key; the digits are ${Object.entries(PRESET_KEYS).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) active.blur();
    });
    await page.keyboard.press(digit);
    return PRESET_KEYS[digit];
  }

  // A point in canvas CSS pixels, from {x, y} or from a cell key through the caller's locate().
  async function point(target) {
    if (typeof target === "string") {
      if (!locate) throw new Error(`cell key ${JSON.stringify(target)}: INTEGRATION.md D.18 does not say where a cell is on the canvas; pass {x, y} or give observe() a locate(key) built from the reference calculator`);
      return locate(target);
    }
    if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) return { x: target.x, y: target.y };
    throw new TypeError(`expected a cell key or {x, y}, got ${JSON.stringify(target)}`);
  }

  async function hoverCell(target) {
    const canvas = await need(SURFACE.canvas.selector, "main canvas");
    const { x, y } = await point(target);
    await canvas.hover({ position: { x, y } });
    return { x, y };
  }

  // One pixel of #ol-canvas at DPR 1 ([r, g, b, a]). Refused at any other DPR: the pixel assertions compare with the pinned
  // LUT entries and a scaled canvas would sample between cells (TESTPLAN 3.1).
  async function pixelAt(target) {
    const canvas = await need(SURFACE.canvas.selector, "main canvas");
    const { x, y } = await point(target);
    return canvas.evaluate((el, p) => {
      if (window.devicePixelRatio !== 1) throw new Error(`pixelAt needs DPR 1, the page has ${window.devicePixelRatio}`);
      return [...el.getContext("2d").getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data];
    }, { x, y });
  }

  // Which of the named D.18 elements are absent right now (for a spec that wants one message for all of them).
  async function missing(names) {
    const absent = [];
    for (const name of names) {
      const selector = Object.hasOwn(SURFACE.chips, name) ? SURFACE.chips[name] : SURFACE[name];
      if (typeof selector !== "string") throw new RangeError(`unknown D.18 element ${JSON.stringify(name)}`);
      if (await page.locator(selector).count() === 0) absent.push(`${name} (${selector})`);
    }
    return absent;
  }

  return { chip, details, openLegendDetails, tip, readout, legendMarker, keys, notices, warnings, copyStatus, pressPreset, hoverCell, pixelAt, missing };
}

module.exports = { observe, SURFACE, PRESET_KEYS, MissingSurfaceElement };
