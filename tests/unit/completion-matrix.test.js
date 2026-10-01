"use strict";
// U65 (PRD-0002 S3, #48 section 5): the parent completion matrix covers every decision of the parent, names what is outstanding as outstanding, never marks an operator item
// passed, points at tests that exist, and states the row count of the visual contract as it is.
// Oracles (none is the code under test): the parent's list D1 to D12 (written out here), the test index and the roll-up of docs/visual-contract.md, and the files of the repository.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const MATRIX = fs.readFileSync(path.join(ROOT, "docs/completion-matrix.md"), "utf8");
const CONTRACT = fs.readFileSync(path.join(ROOT, "docs/visual-contract.md"), "utf8");

test("every decision D1 to D12 has a row with an owner, a place, evidence and a status", () => {
  const rows = MATRIX.split("\n").filter((l) => /^\| \*\*D\d+\*\*/.test(l));
  assert.equal(rows.length, 12);
  rows.forEach((row, i) => {
    assert.ok(row.startsWith(`| **D${i + 1}**`), row.slice(0, 30));
    const cells = row.trim().replace(/^\||\|$/g, "").split(" | ");
    assert.equal(cells.length, 5, `D${i + 1}: decision, owner, where, evidence, status`);
    for (const c of cells) assert.ok(c.trim().length > 2, `D${i + 1}: a cell is empty`);
    assert.match(cells[4], /^(Implemented and tested|Implemented, evidence limited)/, `D${i + 1}: a status in the vocabulary`);
  });
});

test("what needs a person, a designated machine or the host is OUTSTANDING and the matrix never says it passed", () => {
  for (const item of ["sessions of the 24-case protocol", "designated-machine runs", "rollback rehearsal", "human validation of the palette", "production-host verification", "on GitHub"]) assert.ok(MATRIX.includes(item), item);
  assert.ok((MATRIX.match(/OUTSTANDING/g) ?? []).length >= 6);
  assert.ok(!/\b(all|the) (operator|human|production) [a-z ]*passed\b/i.test(MATRIX));
  // a row whose status is "Implemented and tested" names no outstanding item
  for (const row of MATRIX.split("\n").filter((l) => /^\| \*\*D\d+\*\*.*\| Implemented and tested \|$/.test(l))) assert.ok(!/OUTSTANDING/.test(row), row.slice(0, 40));
  assert.match(MATRIX, /Nothing has been merged or deployed/);
});

test("the tests the matrix names as files exist, and the contract's row count is the one it states", () => {
  for (const m of MATRIX.matchAll(/`([a-z0-9-]+\.(?:test|spec)\.js)`/g)) {
    const found = ["tests/unit", "tests/browser"].some((d) => fs.existsSync(path.join(ROOT, d, m[1])));
    assert.ok(found, `${m[1]} is a test file`);
  }
  const total = /^\| all \| (\d+) \|/m.exec(CONTRACT)[1];
  assert.ok(MATRIX.includes(`${total} rows, none left \`todo\``), `the matrix says ${total} rows`);
  assert.match(CONTRACT, /\| all \| \d+ \| \d+ \| 0 \| 0 \| 0 \| \d+ \|/, "no row is left todo in any slice");
});
