"use strict";
// U64 (PRD-0002 S3, #48 section 5, the capture-ready summary): the summary of the Query tab is built from the records the popovers read, says everything the PRD lists, uses the
// module's own words, and leaves the page only when the person copies it. The page itself is read by tests/browser/view-summary.spec.js (B53); this file holds the source to
// its contract.
// Oracles (none is the code under test): the PRD's list of what the summary carries, written out here; the text pins of text.test.js (the strings); the source of the page,
// read as text, for what the summary's code may and may not touch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");

const ROOT = path.resolve(__dirname, "../..");
const JS = fs.readFileSync(path.join(ROOT, "src/explorer.js"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "src/view.html"), "utf8");
const a = JS.indexOf("  // ---- The view summary (PRD-0002 S3, section 5) ----");
const b = JS.indexOf("  // ---- the profile chip (PRD-0002 S2) ----");
const CODE = JS.slice(a, b);

test("the summary's code is one block of the page, between its own heading and the profile chip's", () => {
  assert.ok(a > 0 && b > a, "the block exists");
  for (const name of ["summarySections", "summaryText", "summaryRender", "summaryRefresh", "summaryRow"]) assert.ok(CODE.includes(`function ${name}(`), name);
});

test("it produces every item the PRD lists: measures and bases and units, transforms, axis domains, policy, cohort, cutoff and ids, support, clipping, cutoffs, model, appearance and the vintage", () => {
  // the view's own rows
  for (const field of ["place", "level", "cellsMeasure", "columnsMeasure", "rowsMeasure", "dataCutoff", "canonicalThrough", "replay", "source", "model", "appearance", "vintage", "limit"]) assert.ok(CODE.includes(`"${field}"`), `the summary has a ${field} row`);
  // each colour channel and the axes and the profile tracks
  for (const channel of ['"cells"', '"rows"', '"lens"', '"pane"']) assert.ok(CODE.includes(channel), channel);
  assert.ok(CODE.includes("E.legend.details(legend)"), "a channel's rows are the legend's own details (measure, basis, unit, transform, policy, mapping id, context, support, domain, cohort, fit cutoff, clipping, cutoffs, model)");
  assert.ok(CODE.includes("uiRowsInfo(scaleUi.rowsInfo)"), "the Rows say what they are: period, row size, quality, support and what was dropped");
  assert.ok(CODE.includes("scaleUi.axisRecords"), "the axes' policies and domains");
  assert.ok(CODE.includes("profileUi"), "the profile tracks");
  // (the fields the legend gives, and that each reaches the page, are read by B53 on a real view)
});

test("its words are E.text's, and the markup says the same introduction", () => {
  for (const key of ["summaryTitle", "summaryIntro", "summaryCopy", "summaryView", "summaryAxes", "summaryProfile", "summaryVintage", "summaryLimit"]) assert.equal(typeof E.text.ui[key], "string", key);
  assert.ok(HTML.includes(E.text.ui.summaryIntro), "the intro in the markup is the E.text one");
  assert.ok(HTML.includes(`>${E.text.ui.summaryTitle}</h3`) && HTML.includes(E.text.ui.summaryCopy), "title and button");
  for (const key of ["summaryView", "summaryAxes", "summaryProfile", "summaryVintage"]) assert.ok(CODE.includes(`E.text.ui.${key}`), key);
  assert.ok(CODE.includes("E.text.vintage") && CODE.includes("E.text.ui.summaryLimit"), "the vintage sentence and the limits sentence");
  assert.match(E.text.ui.summaryLimit, /original vintages are not recorded/);
  assert.match(E.text.ui.summaryLimit, /No hosted export and no immutable data snapshot/);
});

test("it is not an export: it never reads the canvas, never fetches, never stores, never downloads, and the only thing that carries it away is the copy button", () => {
  for (const banned of ["getImageData", "toDataURL", "toBlob", "fetch(", "localStorage", "sessionStorage", "sendBeacon", "XMLHttpRequest", "createObjectURL", "download", "saveScales", "persistNow"]) assert.ok(!CODE.includes(banned), `the summary's code has no ${banned}`);
  assert.ok(JS.includes('el("copy-summary").addEventListener("click", () => copyText(summaryText, "Summary"));'), "the copy button copies the text of the summary");
  assert.ok(HTML.includes('id="ol-copy-summary"') && HTML.includes('id="ol-summary-body"'), "the markup");
});

test("it is rebuilt only while the Query tab is open, once per burst, and from the places that change what it says", () => {
  assert.ok(CODE.includes('S.drawerOpen && S.drawer === "query"'), "only the open Query tab pays for it");
  assert.ok(CODE.includes("clearTimeout(summaryRt.timer)"), "a burst of changes is one rebuild");
  const refreshes = [...JS.matchAll(/summaryRefresh\(\);/g)].length;
  assert.ok(refreshes >= 3, `update(), a legend's commit and the axis commit ask for it (${refreshes})`);
});
