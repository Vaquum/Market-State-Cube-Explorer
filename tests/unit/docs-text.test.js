"use strict";
// U37: drift guards for the documents that describe how measures are scaled and stored (PRD-0002 S1, box "Update README/semantics/visual
// contract"). Oracle: none of this is computed; the expected phrases are the wording of the S1 specification and of the behaviour that
// the browser specs show, written out, and the stale phrases are what the README and semantics said before the measurement work.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readme = read("README.md");
const semantics = read("docs/data-and-semantics.md");

describe("stale statements are gone", () => {
  const stale = [
    "paler where less traded",
    "full-cell rate",
    "scaled to the period's peak among the rows in view",
    "−2 where the period traded and the view didn't",
    "shade by rank on one ramp",
    "Amounts shade by rank",
  ];
  for (const [name, text] of [["README.md", readme], ["docs/data-and-semantics.md", semantics]])
    for (const phrase of stale) it(`${name} no longer says "${phrase}"`, () => assert.ok(!text.includes(phrase), phrase));
});

describe("the README says how to develop and deploy", () => {
  it("Develop lists the test, browser, benchmark and browser-install commands", () => {
    const develop = readme.slice(readme.indexOf("## Develop"), readme.indexOf("## Deploy"));
    for (const command of ["npm test", "npm run test:browser", "npm run benchmark", "npx playwright install chromium"]) assert.ok(develop.includes(command), command);
  });
  it("Deploy says deploy waits for the checks of the exact commit", () => {
    const deploy = readme.slice(readme.indexOf("## Deploy"));
    assert.match(deploy, /checks of `\.github\/workflows\/check\.yml`/);
    assert.match(deploy, /exact commit/);
  });
  it("Explore names Amount, Intensity, Value, Relative rank and the scale policies", () => {
    for (const word of ["**Amount**", "**Intensity**", "**Value**", "**Relative rank**", "**Explore**", "**Comparison lock**", "**Auto color**", "**Local contrast**", "**Scale range exceeded**", "**Low discrimination**"])
      assert.ok(readme.includes(word), word);
  });
});

describe("the semantics document states what S1 promises", () => {
  const required = [
    [/Replay on currently available history; original vintages not guaranteed/, "observation provenance is not a vintage"],
    [/retrospective/, "model status: retrospective"],
    [/timing unverified/, "model status: timing unverified"],
    [/eligible by the conservative bound/, "model status: eligible by the bound"],
    [/`vis=2`/, "the address version"],
    [/8,192-character address/, "address limit"],
    [/257 rank knots/, "rank knot limit"],
    [/1 MiB decoded portable payload/, "payload limit"],
    [/16 active scales/, "descriptor limit"],
    [/settings-only URL, not exact calibration/, "the degraded address says what it is"],
    [/only for the measures it contains/, "tests use the snapshot only for what it holds"],
    [/not an immutable market-data snapshot/, "a descriptor is not a data snapshot"],
    [/Inactive Explore-cache history does not travel/, "the cache does not travel"],
    [/Export or preserve your settings before the storage migration/, "preserve settings before the migration"],
    [/old code does not understand v2 calibrations/, "rollback honesty"],
    [/negative-infinite/, "typed result: negative infinity"],
    [/no-reference/, "typed result: no reference"],
    [/outside comparison support/, "Relative volume outside W"],
    [/zero Delta does not mean no trades/, "balanced Delta"],
  ];
  for (const [re, why] of required) it(why, () => assert.match(semantics, re));
});
