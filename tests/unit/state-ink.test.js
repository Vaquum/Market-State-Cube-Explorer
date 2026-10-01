"use strict";
// U57 (PRD-0002 S2, #47 section 4): no state mark and no state key is drawn in a market hue. Gold (the profile's POC role), the Volume green (retired), the
// Evidence violet and the legacy buy and sell hues are for what they name; the loading line, the coarse-corner tick, the open-parent hatch, the unavailable
// hatch, the keys in the footer and the toolbar's resolution mark use the neutral inks.
// Oracle (not the code under test): the PRD's list of the uses to remove, and the names of the tokens as src/explorer.css defines them.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const JS = fs.readFileSync(path.join(ROOT, "src/explorer.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "src/explorer.css"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "src/view.html"), "utf8");

const MARKET = ["--ol-poc", "--ol-volume", "--ol-evidence", "--ol-accent", "--ol-buy", "--ol-sell"];
const NEUTRAL = new Set(["surface", "ink", "line", "state", "occupancy", "muted", "bg", "panel"]);

// The painters of the stroke-role table, by role: each is a method `name(c, ...) {` of the `STROKE` object.
function roles() {
  const a = JS.indexOf("  const STROKE = {"),
    b = JS.indexOf("  const STROKE_KEYS");
  const parts = JS.slice(a, b).split(/\n    (\w+)\(c, /).slice(1);
  const out = new Map();
  for (let i = 0; i < parts.length; i += 2) out.set(parts[i], parts[i + 1]);
  return out;
}

test("the stroke-role table: the state roles draw in the neutral inks, and only the profile's POC roles are gold", () => {
  const table = roles();
  assert.deepEqual([...table.keys()], ["empty", "open", "partial", "provisional", "moved", "detail", "selection", "hover", "inspect", "unavailable", "poc", "bpoc", "pending"]);
  for (const [name, body] of table) {
    const used = [...body.matchAll(/colors\.(\w+)/g)].map((m) => m[1]);
    if (name === "poc" || name === "bpoc") {
      assert.ok(used.includes("poc"), `${name} is the gold profile role`);
      continue;
    }
    for (const token of used) assert.ok(NEUTRAL.has(token), `${name} draws with colors.${token}, which is not a neutral ink`);
  }
});

test("the rules of the loading line, the footer keys, the data keys, the resolution plane and the coarse mark name no market hue", () => {
  const rules = [...CSS.matchAll(/(#origo-lens [^{}]*(?:\.ol-loading|\.ol-data-key|\.ol-keys-scale|\.ol-key\b|\.ol-res-coarse|\.ol-plane|\.ol-res)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 15, `the rules were found (${rules.length})`);
  for (const [, selector, body] of rules) for (const token of MARKET) assert.ok(!body.includes(`var(${token}`), `${selector.trim()} uses ${token}`);
});

test("the retired Volume green is gone from the stylesheet, the markup and the page's code", () => {
  for (const [name, text] of [["css", CSS], ["html", HTML], ["js", JS]]) assert.ok(!/--ol-volume\b/.test(text), `${name} still names --ol-volume`);
});

test("the evidence violet is used by the evidence's own marks and rules only", () => {
  const uses = [...JS.matchAll(/colors\.evidence/g)].length;
  assert.ok(uses >= 3 && uses <= 8, `${uses} uses of colors.evidence`);
  for (const line of JS.split("\n").filter((l) => l.includes("colors.evidence"))) assert.ok(!/loading|coarse|unavailable|pending|provisional/.test(line), line.trim());
});
