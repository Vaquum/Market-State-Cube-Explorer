"use strict";
// controls-a11y.spec.js (U; TESTPLAN B23, with the popover-action cases of B09c): keyboard reach, names, contrast and
// size of the controls that S1 adds: the legend chips and their popovers, the Scale section of the Cells and Rows
// menus, the axis chip, the notice banner, the lens's Local contrast toggle and the generated keys.
//
// What it asserts (TESTPLAN B23 and INTEGRATION D.7, D.18):
//   * the legend chip is reached with Tab, opened with Enter and with Space, closed with Escape, and Escape returns the
//     focus to the chip; the same from INSIDE the manual-domain number inputs (FA-22: text fields keep their keys, so the
//     popover has to handle Escape itself);
//   * every item of the Scale section of the Cells menu is reached with the arrow keys, a choice closes the menu and
//     returns the focus, a disabled item says why in words (aria-describedby), and no item has a shortcut of its own
//     (DR-05);
//   * Fit, Auto color, Comparison lock and Local contrast are native buttons (or a native checkbox) with names; no new
//     element carries its information in a title attribute alone;
//   * the notice banner is a status element that is dismissed with a native button and returns the focus; no live region
//     changes during ten wheel steps;
//   * computed contrast of every new text and boundary in both themes (4.5:1 text, 3:1 boundary) against the backdrop the
//     element really sits on (the parent chain of computed backgrounds composited), font-size >= 11px and tabular
//     numerals on the numeric text, no new control under 24 css px, no horizontal overflow at 375x812 and 600x800 and a
//     popover that stays inside the viewport;
//   * the D.18 elements exist; the two legend bars are the pixels of the Lut (chip and popover, both themes, flipped under an
//     open popover without a reload) and the key swatches are the role table's glyphs in the occupancy and state inks;
//     the banner takes its height from the drawer's limit;
//   * the manual-domain and share-window forms reject a bad input with its reason beside the field (B09c).
//
// Oracles: the WCAG 2.x contrast of tests/reference/contrast.js (written from the definition, validated on the published
// anchors in contrast.test.js); the module's own Lut for the bar pixels (its bytes are pinned by lut.test.js); the window sizes and the 24 px / 11 px floors of the PRD; the English of the two
// rejection texts is copied from INTEGRATION.md D.11 (never read back from the module); the colours the page computes are
// read with getComputedStyle, so this checks what is painted.
//
// The page is the merged one: the spine resolves the mappings, the consumers' marks hooks feed the warnings, so the
// chips show what the page really has (no stand-in for a missing spine any more).
const { test, expect, probeTools } = require("./fixtures.js");
const reference = require("../reference/contrast.js");

// A fault in the module's frame builder: the page turns the scale display off and says so in the notice banner (a
// dependable way to a notice with the page in its normal state; the notice queue itself is unit-tested).
function FAULT() {
  let real = null;
  Object.defineProperty(window, "explorerEncoding", {
    configurable: true,
    get: () => real,
    set: (v) => {
      real = { ...v, readout: { ...v.readout, cellsFrame: () => { throw new Error("injected fault for the notice banner"); } } };
    },
  });
}

const VIEW = "#w=24h&mode=volume&rows=volume";

// The two rejection texts, copied from INTEGRATION.md D.11.
const REJECT_MANUAL = "A manual domain needs finite positive U and k with k <= U";
const REJECT_SYMMETRIC = "The window must be symmetric about 50% for taker shares";

// Open the page on a fake `mini` cube and wait until it is at rest.
async function load(page, fake, probe, hash, script = null) {
  if (script) await page.context().addInitScript(script);
  await page.goto(`${fake.url}/${hash}`);
  await page.locator("#ol-loading").waitFor({ state: "hidden" });
  await fake.idle({ quietMs: 600, timeoutMs: 20000 });
  await probe.waitForQuiet({ quietMs: 400, timeout: 20000 });
}

// What a text element looks like to the eye: its colour composited over the backdrop it really sits on (the chain of
// computed backgrounds up to the first opaque one), its border colour, its size and its numerals. Runs in the page.
function COLLECT({ selectors, boundaries, ring = false }) {
  const parse = (css) => {
    let m = css.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = css.match(/color\(srgb ([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[ /]+/).filter(Boolean).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    return [0, 0, 0, 0];
  };
  const backdrop = (node) => {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] === 1) break;
    }
    let base = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) {
      const [r, g, b, a] = layers[i];
      base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
    }
    return base.map(Math.round);
  };
  const over = (c, bg) => [0, 1, 2].map((i) => Math.round(c[i] * c[3] + bg[i] * (1 - c[3])));
  const visible = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
  const own = (node) => [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim() !== "");
  const label = (node) => `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}${node.className && typeof node.className === "string" ? "." + node.className.trim().split(/\s+/).join(".") : ""}`;
  const texts = [];
  const edges = [];
  for (const selector of selectors) {
    for (const root of document.querySelectorAll(selector)) {
      for (const node of [root, ...root.querySelectorAll("*")]) {
        if (!visible(node) || node.closest(".ol-sr") || node.disabled) continue;
        const style = getComputedStyle(node);
        if (own(node)) {
          const bg = backdrop(node);
          texts.push({
            selector, node: label(node), text: node.textContent.trim().slice(0, 40), bg,
            fg: over(parse(style.color), bg), size: parseFloat(style.fontSize),
            tabular: style.fontVariantNumeric.includes("tabular-nums"), num: node.classList.contains("ol-num"),
          });
        }
      }
    }
  }
  for (const selector of boundaries) {
    for (const node of document.querySelectorAll(selector)) {
      if (!visible(node) || node.disabled) continue;
      const style = getComputedStyle(node);
      // a boundary is seen against what lies OUTSIDE it: the backdrop of its parent
      const bg = backdrop(node.parentElement);
      edges.push({ selector, node: label(node), edge: over(parse(style.borderTopColor), bg), bg, width: parseFloat(style.borderTopWidth) });
    }
  }
  let focus = null;
  if (ring) {
    const node = document.activeElement;
    const style = getComputedStyle(node);
    const bg = backdrop(node.parentElement);
    focus = { id: node.id, colour: over(parse(style.outlineColor), bg), width: parseFloat(style.outlineWidth), bg };
  }
  return { texts, edges, ring: focus };
}

// Every text and every boundary of the given selectors, checked against the floors. `seen` collects what was checked, so
// the test can say it looked at something.
function checkContrast(found, where, problems, seen) {
  for (const t of found.texts) {
    seen.push(`${where} text ${t.node} "${t.text}"`);
    const ratio = reference.contrast(t.fg, t.bg);
    if (ratio < 4.5) problems.push(`${where}: ${t.node} "${t.text}" has contrast ${ratio.toFixed(2)}:1 (< 4.5)`);
    if (t.size < 11) problems.push(`${where}: ${t.node} "${t.text}" is ${t.size}px (< 11px)`);
    if (t.num && !t.tabular) problems.push(`${where}: ${t.node} "${t.text}" is numeric text without tabular numerals`);
  }
  for (const e of found.edges) {
    seen.push(`${where} edge ${e.node}`);
    const ratio = reference.contrast(e.edge, e.bg);
    if (e.width >= 1 && ratio < 3) problems.push(`${where}: the border of ${e.node} has contrast ${ratio.toFixed(2)}:1 (< 3)`);
  }
}

// The floors a control must meet: a box of at least 24 css px in height (a checkbox counts by its label, the target a
// person hits). Returns the names of the ones that do not.
function smallControls(root) {
  return root.evaluate((container) => {
    const bad = [];
    for (const node of container.querySelectorAll("button, input:not([type=checkbox]), select, label:has(input[type=checkbox])")) {
      if (node.getClientRects().length === 0) continue;
      const box = node.getBoundingClientRect();
      if (box.height < 23.5) bad.push(`${node.tagName.toLowerCase()}#${node.id || ""}.${node.className} is ${box.height.toFixed(1)}px high`);
    }
    return bad;
  });
}

test.describe("B23 controls of the scale display: keys, names, contrast, size", () => {
  test("the D.18 elements exist and the chips carry their observation attributes", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    const report = await page.evaluate(() => {
      const have = (selector) => Boolean(document.querySelector(selector));
      return {
        chips: Object.fromEntries(["#ol-legend", "#ol-rows-legend", "#ol-axis-chip", "#ol-lens-status"].map((s) => [s, have(s)])),
        pops: Object.fromEntries(["#ol-legend-pop", "#ol-rows-legend-pop", "#ol-axis-pop"].map((s) => [s, document.querySelector(s)?.getAttribute("role")])),
        notice: ["#ol-notice", "#ol-notice-text", "#ol-notice-more", "#ol-notice-dismiss"].map(have),
        noticeRole: document.querySelector("#ol-notice")?.getAttribute("role"),
        other: ["#ol-legend-marker", "#ol-legend-marker-text", "#ol-lens-local", "#ol-keys-scale", "#ol-ramp", "#ol-rows-ramp"].map(have),
        lensStatus: { role: document.querySelector("#ol-lens-status")?.getAttribute("role"), channel: document.querySelector("#ol-lens-status")?.dataset.channel },
        data: { ...document.querySelector("#ol-legend").dataset },
        tags: { chip: document.querySelector("#ol-legend").tagName, ramp: document.querySelector("#ol-ramp").tagName, rowsChip: document.querySelector("#ol-rows-legend").tagName },
        aria: { haspopup: document.querySelector("#ol-legend").getAttribute("aria-haspopup"), controls: document.querySelector("#ol-legend").getAttribute("aria-controls"), live: document.querySelector("#ol-legend").closest("[aria-live]") === null },
      };
    });
    expect(Object.values(report.chips), "the four chips").toEqual([true, true, true, true]);
    expect(report.pops).toEqual({ "#ol-legend-pop": "dialog", "#ol-rows-legend-pop": "dialog", "#ol-axis-pop": "dialog" });
    expect(report.notice).toEqual([true, true, true, true]);
    expect(report.noticeRole).toBe("status");
    expect(report.other, "marker, marker text, lens toggle, keys container, both bars").toEqual([true, true, true, true, true, true]);
    expect(report.lensStatus).toEqual({ role: "status", channel: "lens" });
    expect(report.tags).toEqual({ chip: "BUTTON", ramp: "CANVAS", rowsChip: "BUTTON" });
    expect(report.aria).toEqual({ haspopup: "dialog", controls: "ol-legend-pop", live: true });
    // Written by the draw that painted: the channel, a state, the appearance id, the workspace and the effective level.
    expect(report.data.channel).toBe("cells");
    expect(["ready", "no-calibration", "updating"]).toContain(report.data.state);
    expect(report.data.appearance).toMatch(/^slate2-[0-9a-f]{8}$/);
    expect(report.data.workspace).toBe("live");
    expect(report.data.effectiveN).toMatch(/^\d+$/);
    expect(report.data.effectiveM).toMatch(/^\d+$/);
  });

  test("the legend chip is reached with Tab, opened with Enter and Space, closed with Escape, and Escape returns the focus", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    await page.focus("#ol-untested");
    let reached = false;
    for (let i = 0; i < 8 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.id === "ol-legend");
    }
    expect(reached, "Tab from the last overlay checkbox reaches the legend chip within a few presses").toBe(true);
    for (const key of ["Enter", "Space"]) {
      await page.keyboard.press(key);
      await expect(page.locator("#ol-legend-pop")).toBeVisible();
      await expect(page.locator("#ol-legend")).toHaveAttribute("aria-expanded", "true");
      expect(await page.evaluate(() => document.querySelector("#ol-legend-pop").contains(document.activeElement)), `${key} puts the focus inside the dialog`).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator("#ol-legend-pop")).toBeHidden();
      expect(await page.evaluate(() => document.activeElement?.id), `Escape after ${key} returns the focus to the chip`).toBe("ol-legend");
      await expect(page.locator("#ol-legend")).toHaveAttribute("aria-expanded", "false");
    }
    // A second press on the chip closes the popover (bindPop's toggle), and the rows chip behaves the same.
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-legend-pop")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.focus("#ol-rows-legend");
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-rows-legend-pop")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("ol-rows-legend");
  });

  test("Escape inside the manual-domain number inputs closes the popover and returns the focus (FA-22)", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    // A Value scale takes U and k: Escape from each of the two fields.
    for (const name of ["U", "k"]) {
      await page.focus("#ol-legend");
      await page.keyboard.press("Enter");
      await expect(page.locator("#ol-legend-pop")).toBeVisible();
      const input = page.locator(`#ol-legend-pop form[data-part="manual"] input[name="${name}"]`);
      await input.focus();
      await page.keyboard.type("5");
      expect(await input.inputValue(), "the field takes its own keys").toBe("5");
      await page.keyboard.press("Escape");
      await expect(page.locator("#ol-legend-pop")).toBeHidden();
      expect(await page.evaluate(() => document.activeElement?.id), `Escape inside ${name} returns the focus to the chip`).toBe("ol-legend");
    }
  });

  test("the Scale section of the Cells menu: reached with the arrows, named, no shortcuts, a choice closes the menu and is remembered", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    await page.focus("#ol-mode");
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-mode-menu")).toBeVisible();
    // Walk every item with ArrowDown and record what the focused item is called.
    const names = [];
    const count = await page.locator('#ol-mode-menu [role^="menuitem"]').count();
    for (let i = 0; i < count; i++) {
      names.push(await page.evaluate(() => {
        const item = document.activeElement;
        const named = item.getAttribute("aria-labelledby");
        return { name: named ? document.getElementById(named).textContent.trim() : item.textContent.trim(), role: item.getAttribute("role"), scale: item.dataset.scaleItem ?? null, keys: item.getAttribute("aria-keyshortcuts") };
      }));
      await page.keyboard.press("ArrowDown");
    }
    const scale = names.filter((n) => n.scale);
    expect(scale.map((n) => n.name), "the Scale section, in order").toEqual(["Amount", "Intensity", "Value (log)", "Value (linear)", "Relative rank", "Explore", "Auto color", "Comparison lock", "Local contrast (lens)", "Fit scale"]);
    expect(scale.map((n) => n.role)).toEqual(["menuitemradio", "menuitemradio", "menuitemradio", "menuitemradio", "menuitemradio", "menuitemradio", "menuitemradio", "menuitemcheckbox", "menuitemcheckbox", "menuitem"]);
    expect(scale.filter((n) => n.keys), "no item of the Scale section has a shortcut of its own (DR-05)").toEqual([]);
    expect(await page.locator("#ol-mode-menu [data-scale-item] kbd").count()).toBe(0);
    // Choose Relative rank with the keyboard.
    await page.focus('#ol-mode-menu [data-scale-item="transform:rank"]');
    const before = await page.locator("#ol-legend").getAttribute("data-context");
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-mode-menu")).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id), "a choice returns the focus to the menu's button").toBe("ol-mode");
    await expect.poll(() => page.locator("#ol-legend").getAttribute("data-context")).not.toBe(before);
    expect(await page.locator("#ol-legend").getAttribute("data-context")).toContain("rank");
    // Reopened, it is the checked one and Value (log) is not.
    await page.keyboard.press("Enter");
    await expect(page.locator('#ol-mode-menu [data-scale-item="transform:rank"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('#ol-mode-menu [data-scale-item="transform:log"]')).toHaveAttribute("aria-checked", "false");
    // Linear is offered only for Value: with Relative rank on it is disabled and says so.
    const linear = page.locator('#ol-mode-menu [data-scale-item="transform:linear"]');
    await expect(linear).toHaveAttribute("aria-disabled", "true");
    const why = await linear.evaluate((item) => document.getElementById(item.getAttribute("aria-describedby")).textContent.trim());
    expect(why).toBe("Linear is offered only for Value");
    // And back to Value (log).
    await page.focus('#ol-mode-menu [data-scale-item="transform:log"]');
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator("#ol-legend").getAttribute("data-context")).toBe(before);
    await page.focus("#ol-mode");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.locator("#ol-mode-menu")).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id), "Escape returns the focus to the button").toBe("ol-mode");
  });

  test("a measure that offers no scale choice shows disabled items that say why, and the Rows menu has its own section", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, "#w=24h&mode=flow&rows=delta");
    await page.focus("#ol-mode");
    await page.keyboard.press("Enter");
    const fit = page.locator('#ol-mode-menu [data-scale-item="fit"]');
    await expect(fit).toHaveAttribute("aria-disabled", "true");
    expect(await fit.evaluate((item) => document.getElementById(item.getAttribute("aria-describedby")).textContent.trim())).toBe("Not offered for Taker flow");
    // Taker flow has a fixed domain: no Transform group at all (the two Values are for unbounded measures).
    expect(await page.locator('#ol-mode-menu [data-scale-item^="transform"]').count()).toBe(0);
    await page.keyboard.press("Escape");
    await page.focus("#ol-rows");
    await page.keyboard.press("Enter");
    const names = await page.locator('#ol-rows-menu [data-scale-item]').evaluateAll((items) => items.map((item) => item.dataset.scaleItem));
    // Rows Delta: Values only (no Relative rank for a signed measure), the policies, the lock and Fit; no Local contrast.
    expect(names).toEqual(["transform:log", "transform:linear", "policy:explore", "policy:auto", "lock", "fit"]);
    await page.keyboard.press("Escape");
  });

  test("Fit, Auto color, Comparison lock and Local contrast are native controls with names; nothing is named by a title alone", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    await page.keyboard.press("l");
    await expect(page.locator("#ol-lensbar")).toBeVisible();
    await page.focus("#ol-legend");
    await page.keyboard.press("Enter");
    const report = await page.evaluate(() => {
      const named = (node) => {
        const ids = node.getAttribute("aria-labelledby");
        return (node.getAttribute("aria-label") || (ids ? ids.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "") || (node.labels && node.labels[0] ? node.labels[0].textContent : "") || node.textContent || "").trim();
      };
      const buttons = Object.fromEntries(["fit", "auto", "lock", "local"].map((name) => {
        const node = document.querySelector(`#ol-legend-pop [data-action="${name}"]`);
        return [name, node ? { tag: node.tagName, type: node.type, name: named(node), pressed: node.getAttribute("aria-pressed") } : null];
      }));
      const containers = ["#ol-legend", "#ol-legend-pop", "#ol-rows-legend", "#ol-rows-legend-pop", "#ol-axis-chip", "#ol-axis-pop", "#ol-notice", "#ol-lens-local-label", "#ol-lens-status", "#ol-keys-scale"];
      const titled = [];
      const unnamed = [];
      for (const selector of containers) {
        for (const root of document.querySelectorAll(selector)) {
          for (const node of [root, ...root.querySelectorAll("*")]) {
            if (node.hasAttribute("title")) titled.push(`${selector} ${node.tagName}`);
            if (node.matches("button, input, select") && named(node) === "") unnamed.push(`${selector} ${node.tagName}#${node.id}`);
          }
        }
      }
      const local = document.querySelector("#ol-lens-local");
      return { buttons, titled, unnamed, local: { tag: local.tagName, type: local.type, name: named(local) } };
    });
    expect(report.buttons.fit).toEqual({ tag: "BUTTON", type: "button", name: "Fit scale", pressed: null });
    expect(report.buttons.auto).toEqual({ tag: "BUTTON", type: "button", name: "Auto color", pressed: "false" });
    expect(report.buttons.lock).toEqual({ tag: "BUTTON", type: "button", name: "Comparison lock", pressed: "false" });
    expect(report.buttons.local, "Local contrast is offered in the popover while the lens is the tool").toEqual({ tag: "BUTTON", type: "button", name: "Local contrast", pressed: "false" });
    expect(report.local).toEqual({ tag: "INPUT", type: "checkbox", name: "Local contrast" });
    expect(report.titled, "no new element uses a title attribute").toEqual([]);
    expect(report.unnamed, "every new control has a name").toEqual([]);
    // Pressing a toggle changes its state: Auto color on, then the same button off (the preference is kept in S.scale).
    const auto = page.locator('#ol-legend-pop [data-action="auto"]');
    await auto.click();
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await auto.click();
    await expect(auto).toHaveAttribute("aria-pressed", "false");
    // The popover's Local contrast and the lens bar's toggle are one preference.
    const local = page.locator('#ol-legend-pop [data-action="local"]');
    await local.click();
    await expect(local).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ol-lens-local")).toBeChecked();
    await expect(page.locator("#ol-lens-status")).toContainText("Local contrast");
    await page.locator("#ol-lens-local").uncheck();
    await page.focus("#ol-legend");
    await page.keyboard.press("Enter");
    await expect(page.locator('#ol-legend-pop [data-action="local"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#ol-lens-status")).toContainText("Shared scale");
  });

  test("Open lens, the action of a main-chart warning, only moves the focus to the lens tool (DD-94)", async ({ page, fakeFor, probe }) => {
    // No warning renders in this page until the marks hooks of C, R and X exist (the settled pass has nothing to count), so
    // the action is exercised through a button with the warning's own markup: what the popover's click handler does with
    // a `warn-open-lens` action is what is tested here, and the markup a real warning carries is checked in legend.test.js.
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    await page.focus("#ol-legend");
    await page.keyboard.press("Enter");
    const before = await page.locator("#ol-legend").getAttribute("data-context");
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "warn-open-lens";
      button.dataset.channel = "cells";
      button.textContent = "Open lens";
      document.querySelector("#ol-legend-pop").append(button);
    });
    await page.locator('#ol-legend-pop [data-action="warn-open-lens"]').click();
    await expect(page.locator("#ol-legend-pop")).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id), "the focus is on the lens tool").toBe("ol-lens");
    expect(await page.locator("#ol-legend").getAttribute("data-context"), "no preference changed").toBe(before);
    expect(await page.locator("#ol-lensbar").isVisible(), "opening the lens is the person's act, not the button's").toBe(false);
  });

  test("the notice banner is a status element, dismissed with a native button that returns the focus", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, "#w=24h&mode=volume", FAULT);
    const banner = page.locator("#ol-notice");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "status");
    expect(await banner.evaluate((node) => node.closest("[aria-live]") === null && !node.hasAttribute("aria-live")), "a status role and no extra aria-live").toBe(true);
    const item = page.locator("#ol-notice [data-notice][data-code]");
    await expect(item).toHaveAttribute("data-code", "scale-fault");
    await expect(item).toHaveAttribute("data-count", "1");
    await expect(banner).toContainText("The scale display hit an error and was turned off for this session; the chart shows occupancy only. Reload the page.");
    // The chip no longer claims a scale it is not showing.
    await expect(page.locator("#ol-legend")).toHaveAttribute("data-state", "failed");
    // The banner takes height from the chart, so the drawer's limit (the grip's aria-valuemax) is that much smaller while it
    // shows, and the page says so as soon as the banner goes.
    const grip = page.locator("#ol-drawer-grip");
    const bannerHeight = (await banner.boundingBox()).height;
    const limitWith = Number(await grip.getAttribute("aria-valuemax"));
    // Details opens the lines; Dismiss hides the banner and puts the focus back on the chart.
    const more = page.locator("#ol-notice-more");
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#ol-note-details li")).toContainText("injected fault for the notice banner");
    // The address has no visual version, so the persistence package also posts its one-time notice: the queue shows one
    // notice at a time, the next one appears when this one is dismissed, and the banner is gone when the queue is empty.
    const queued = Number((await page.locator("#ol-notice-text .ol-notice-queued").count()) > 0);
    for (let i = 0; i <= queued && (await banner.isVisible()); i++) {
      await page.locator("#ol-notice-dismiss").focus();
      await page.keyboard.press("Enter");
    }
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.id), "the focus returns to the chart").toBe("ol-canvas");
    const limitWithout = Number(await grip.getAttribute("aria-valuemax"));
    expect(limitWithout - limitWith, "the drawer's limit grows by the banner's height (the banner with its lines open was taller)").toBeGreaterThanOrEqual(Math.floor(bannerHeight) - 2);
  });

  test("no live region changes during ten wheel steps", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    await page.evaluate(() => {
      const live = '[aria-live], [role="status"], [role="alert"], [role="log"]';
      window.__liveMutations = [];
      new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target.nodeType === 3 ? record.target.parentElement : record.target;
          const region = target?.closest(live);
          // a region that is not rendered (a closed popover's status line) is not announced
          if (region && region.getClientRects().length > 0) window.__liveMutations.push(`${region.id || region.tagName}: ${record.type} ${record.attributeName ?? ""}`);
        }
      }).observe(document.getElementById("origo-lens"), { subtree: true, childList: true, characterData: true, attributes: true });
    });
    const box = await page.locator("#ol-canvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, i < 5 ? -120 : 120);
      await page.waitForTimeout(90);
    }
    await probe.waitForQuiet({ quietMs: 500, timeout: 20000 });
    await fake.idle({ quietMs: 600, timeoutMs: 20000 });
    await probe.waitForQuiet({ quietMs: 500, timeout: 20000 });
    expect(await page.evaluate(() => window.__liveMutations), "no rendered status, alert, log or aria-live node was touched").toEqual([]);
    // The page really did something: the legend was written (the chip has its text), so the silence is not an idle page.
    expect(await page.locator("#ol-legend-text").textContent()).not.toBe("");
  });

  test("the legend bars and the key swatches are what the canvas says they are, and a theme flip repaints them in place", async ({ page, fakeFor, probe }) => {
    // Pixels, not attributes: the two bars are canvases blitted from E.legend.barPixels and the swatches are the role table's
    // glyphs, so a DOM audit cannot see them. The oracle is the module's own Lut, whose bytes U18 pins (slate2, both themes),
    // and the page's own computed colour of the occupancy token.
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    await page.focus("#ol-legend");
    await page.keyboard.press("Enter");
    await expect(page.locator("#ol-legend-pop")).toBeVisible();
    const read = () =>
      page.evaluate(() => {
        const E = window.explorerEncoding;
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        const lut = E.lut.build("slate2", dark ? "dark" : "light");
        const pixel = (canvas, x, y) => [...canvas.getContext("2d").getImageData(x, y, 1, 1).data];
        const ends = (canvas) => ({ first: pixel(canvas, 0, Math.floor(canvas.height / 2)), last: pixel(canvas, canvas.width - 1, Math.floor(canvas.height / 2)), w: canvas.width });
        const probeToken = document.createElement("span");
        probeToken.style.color = "var(--ol-occupancy)";
        document.querySelector("#origo-lens").append(probeToken);
        const occupancy = getComputedStyle(probeToken).color.match(/\d+/g).map(Number);
        probeToken.remove();
        const swatch = (key) => document.querySelector(`#ol-legend-pop [data-key="${key}"] canvas`);
        const zero = swatch("zero");
        const dots = swatch("pending");
        const ground = pixel(dots, 0, 0);
        let marked = 0;
        const data = dots.getContext("2d").getImageData(0, 0, dots.width, dots.height).data;
        for (let i = 0; i < data.length; i += 4) if (data[i] !== ground[0] || data[i + 1] !== ground[1] || data[i + 2] !== ground[2]) marked++;
        return {
          chip: ends(document.querySelector("#ol-ramp")),
          pop: ends(document.querySelector("#ol-legend-pop .ol-legend-canvas")),
          lowEnd: [...lut.unsigned.rgb.slice(0, 3), 255],
          highEnd: [...lut.unsigned.rgb.slice(765, 768), 255],
          zeroEdge: pixel(zero, 0, 5).slice(0, 3),
          zeroGlyph: E.role.GLYPHS["zero-outline"].ink,
          occupancy,
          dotsMarked: marked,
          appearance: document.querySelector("#ol-legend").dataset.appearance,
        };
      });
    const light = await read();
    expect(light.chip.w, "the chip bar is 64 css px at device ratio 1").toBe(64);
    expect(light.pop.w, "the popover bar is 240 css px").toBe(240);
    for (const bar of ["chip", "pop"]) {
      expect(light[bar].first, `${bar} bar, low end = Lut entry 0`).toEqual(light.lowEnd);
      expect(light[bar].last, `${bar} bar, high end = Lut entry 255`).toEqual(light.highEnd);
    }
    expect(light.zeroGlyph).toBe("occupancy");
    expect(light.zeroEdge, "the Zero (occupied) swatch is outlined in the occupancy ink").toEqual(light.occupancy);
    expect(light.dotsMarked, "the Reading swatch is dots").toBeGreaterThan(0);
    // Flip the theme under the open popover: the bars, the swatches and the popover follow without a reload.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(async () => (await read()).chip.first.join(), { message: "the chip bar repaints in the dark Lut" }).not.toBe(light.chip.first.join());
    const dark = await read();
    for (const bar of ["chip", "pop"]) {
      expect(dark[bar].first, `${bar} bar, dark low end`).toEqual(dark.lowEnd);
      expect(dark[bar].last, `${bar} bar, dark high end`).toEqual(dark.highEnd);
    }
    expect(dark.lowEnd, "the dark Lut is not the light one").not.toEqual(light.lowEnd);
    expect(dark.zeroEdge).toEqual(dark.occupancy);
    expect(dark.appearance, "the appearance id does not depend on the theme").toBe(light.appearance);
  });

  for (const scheme of ["light", "dark"]) {
    test(`contrast, size and numerals of every new element in the ${scheme} theme`, async ({ fakeFor, freshContext }) => {
      const fake = await fakeFor("mini");
      const context = await freshContext({ colorScheme: scheme });
      const page = await context.newPage();
      const probe = probeTools.forPage(page);
      await load(page, fake, probe, VIEW);
      const problems = [];
      const seen = [];
      const floors = { selectors: ["#ol-legend", "#ol-rows-legend"], boundaries: ["#ol-legend", "#ol-rows-legend"] };
      checkContrast(await page.evaluate(COLLECT, floors), `${scheme} chips`, problems, seen);
      // The focus ring of a chip reached with the keyboard: its outline colour against what it sits on.
      await page.focus("#ol-untested");
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(COLLECT, { selectors: [], boundaries: [], ring: true });
      expect(ring.ring.id).toBe("ol-legend");
      expect(ring.ring.width, "a visible focus ring").toBeGreaterThanOrEqual(2);
      expect(reference.contrast(ring.ring.colour, ring.ring.bg), "the focus ring against its backdrop").toBeGreaterThanOrEqual(3);
      // Popovers: the Cells chip's, then the Rows chip's.
      for (const [chip, pop] of [["#ol-legend", "#ol-legend-pop"], ["#ol-rows-legend", "#ol-rows-legend-pop"]]) {
        await page.focus(chip);
        await page.keyboard.press("Enter");
        await expect(page.locator(pop)).toBeVisible();
        checkContrast(await page.evaluate(COLLECT, { selectors: [pop], boundaries: [`${pop} .ol-action`, `${pop} .ol-legend-field input`, `${pop} .ol-legend-warning`, pop] }), `${scheme} ${pop}`, problems, seen);
        expect(await smallControls(page.locator(pop)), `${pop}: controls under 24 css px`).toEqual([]);
        await page.keyboard.press("Escape");
      }
      // The Cells menu's Scale section, open, with an item under the keyboard's focus.
      await page.focus("#ol-mode");
      await page.keyboard.press("Enter");
      checkContrast(await page.evaluate(COLLECT, { selectors: ['#ol-mode-menu [data-scale-item]', '#ol-mode-menu .ol-menu-cap'], boundaries: [] }), `${scheme} Scale section`, problems, seen);
      expect(await smallControls(page.locator("#ol-mode-menu")), "Scale items under 24 css px").toEqual([]);
      await page.keyboard.press("Escape");
      // The lens bar's toggle.
      await page.keyboard.press("l");
      await expect(page.locator("#ol-lensbar")).toBeVisible();
      checkContrast(await page.evaluate(COLLECT, { selectors: ["#ol-lens-local-label"], boundaries: [] }), `${scheme} lens toggle`, problems, seen);
      expect(await smallControls(page.locator("#ol-lensbar")), "lens bar controls under 24 css px").toEqual([]);
      expect(seen.length, "the check looked at something").toBeGreaterThan(40);
      expect(problems).toEqual([]);
    });

    test(`the notice banner's contrast and size in the ${scheme} theme`, async ({ fakeFor, freshContext }) => {
      const fake = await fakeFor("mini");
      const context = await freshContext({ colorScheme: scheme });
      const page = await context.newPage();
      await load(page, fake, probeTools.forPage(page), "#w=24h&mode=volume", FAULT);
      await expect(page.locator("#ol-notice")).toBeVisible();
      await page.locator("#ol-notice-more").click();
      const problems = [];
      const seen = [];
      checkContrast(await page.evaluate(COLLECT, { selectors: ["#ol-notice"], boundaries: ["#ol-notice-more", "#ol-notice-dismiss"] }), `${scheme} notice`, problems, seen);
      expect(await smallControls(page.locator("#ol-notice")), "banner buttons under 24 css px").toEqual([]);
      expect(seen.length).toBeGreaterThan(3);
      expect(problems).toEqual([]);
      });
  }

  for (const [width, height] of [[375, 812], [600, 800]]) {
    test(`no horizontal overflow at ${width}x${height}, and the popover stays inside the viewport`, async ({ fakeFor, freshContext }) => {
      const fake = await fakeFor("mini");
      const context = await freshContext({ viewport: { width, height } });
      const page = await context.newPage();
      await load(page, fake, probeTools.forPage(page), VIEW);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(await overflow(), "the closed chips").toBeLessThanOrEqual(0);
      for (const [chip, pop] of [["#ol-legend", "#ol-legend-pop"], ["#ol-rows-legend", "#ol-rows-legend-pop"]]) {
        await page.focus(chip);
        await page.keyboard.press("Enter");
        await expect(page.locator(pop)).toBeVisible();
        expect(await overflow(), `${pop} open`).toBeLessThanOrEqual(0);
        const box = await page.locator(pop).boundingBox();
        expect(box.x, `${pop} left edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${pop} right edge`).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
      }
      await page.focus("#ol-mode");
      await page.keyboard.press("Enter");
      expect(await overflow(), "the Cells menu with its Scale section open").toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
    });

    test(`the notice banner fits at ${width}x${height}`, async ({ fakeFor, freshContext }) => {
      const fake = await fakeFor("mini");
      const context = await freshContext({ viewport: { width, height } });
      const page = await context.newPage();
      await load(page, fake, probeTools.forPage(page), "#w=24h&mode=volume", FAULT);
      await expect(page.locator("#ol-notice")).toBeVisible();
      await page.locator("#ol-notice-more").click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      const box = await page.locator("#ol-notice").boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      });
  }

  test("B09c, the manual domain: a bad pair is refused beside the field with the module's reason", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, VIEW);
    await page.focus("#ol-legend");
    await page.keyboard.press("Enter");
    const form = page.locator('#ol-legend-pop form[data-part="manual"]');
    // k above U is refused with the module's text; the field is marked invalid and described by the message.
    await form.locator('input[name="U"]').fill("10");
    await form.locator('input[name="k"]').fill("20");
    await form.getByRole("button", { name: "Apply" }).click();
    const error = form.locator('[data-part="error"]');
    await expect(error).toBeVisible();
    await expect(error).toHaveText(REJECT_MANUAL);
    const invalid = await page.evaluate(() => {
      const input = document.querySelector('#ol-legend-pop input[aria-invalid="true"]');
      return { name: input?.name, describedBy: input?.getAttribute("aria-describedby"), focused: document.activeElement === input };
    });
    expect(invalid.name).toBe("k");
    expect(invalid.describedBy).toBe("ol-cells-form-error");
    expect(invalid.focused, "the focus goes to the field that is wrong").toBe(true);
    // A valid pair clears the message. (That it then creates a held manual mapping is the spine's runtime and its spec.)
    await form.locator('input[name="k"]').fill("5");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(error).toBeHidden();
  });

  test("B09c, the share window: an asymmetric Taker flow window is refused with the window's reason, a symmetric one is not", async ({ page, fakeFor, probe }) => {
    const fake = await fakeFor("mini");
    await load(page, fake, probe, "#w=24h&mode=flow");
    await page.focus("#ol-legend");
    await page.keyboard.press("Enter");
    const form = page.locator('#ol-legend-pop form[data-part="manual"]');
    await expect(form.locator('input[name="lo"]')).toBeVisible();
    await form.locator('input[name="lo"]').fill("0.3");
    await form.locator('input[name="hi"]').fill("0.6");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(form.locator('[data-part="error"]')).toHaveText(REJECT_SYMMETRIC);
    await form.locator('input[name="lo"]').fill("0.45");
    await form.locator('input[name="hi"]').fill("0.55");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(form.locator('[data-part="error"]')).toBeHidden();
    // The address half (sw=0.45~0.55) belongs to the persistence package: it is checked once the address writer knows the
    // visual version, and the annotation says when it was not run.
    const addressKnowsScale = await page.evaluate(() => location.hash.includes("vis=2"));
    test.info().annotations.push({ type: "address", description: addressKnowsScale ? "address written by P: checked" : "address half not run: the address writer of P is not merged at this base" });
    if (addressKnowsScale) expect(await page.evaluate(() => location.hash)).toContain("sw=0.45~0.55");
  });
});
