"use strict";
// U63 (PRD-0002 S3, #48 section 4, the operator protocol): the committed 24-case protocol is complete, its predetermined answers are right, and its scorer holds the evidence
// to what the gate says. What this test cannot do is run the sessions: those are the operator's and OUTSTANDING.
// Oracles (none is the code under test): the hand-computed trade fixtures (tests/fixtures/trades) and the exact-rational reference calculator (tests/reference) for every
// data-derived answer; the role tables and the page's source text for the answers that read them; the PRD's coverage list written out here again; and the scorer's own
// arithmetic redone on synthetic sessions that are labelled as such and exist only in this file.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../support/enc");
const reference = require("../reference/index.js");
const scorer = require("../../tools/operator-score.js");

const ROOT = path.resolve(__dirname, "../..");
const PROTOCOL = scorer.loadProtocol();
const CONTRACT = fs.readFileSync(path.join(ROOT, "docs/visual-contract.md"), "utf8");
const DOC = fs.readFileSync(path.join(ROOT, "docs/operator-protocol.md"), "utf8");
const EPOCH = Date.parse("2021-01-01T00:00:00Z");
const BASE_MS = 56250;
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/trades", `${name}.json`), "utf8"));
const testIndex = new Set([...CONTRACT.matchAll(/^\| ([UB]\d+) \| `tests\//gm)].map((m) => m[1]));

// ---- the protocol is complete ----

test("there are at least 24 cases, with unique ids, three choices each and exactly one right answer", () => {
  assert.ok(PROTOCOL.cases.length >= PROTOCOL.gate.minimumCases && PROTOCOL.gate.minimumCases === 24);
  assert.equal(new Set(PROTOCOL.cases.map((c) => c.id)).size, PROTOCOL.cases.length);
  PROTOCOL.cases.forEach((c, i) => assert.equal(c.id, `OP-${String(i + 1).padStart(2, "0")}`));
  for (const c of PROTOCOL.cases) {
    assert.equal(c.choices.length, 3, c.id);
    assert.equal(new Set(c.choices).size, 3, `${c.id}: three different choices`);
    assert.equal(c.choices.filter((x) => x === c.answer).length, 1, `${c.id}: the answer is exactly one of the choices`);
    assert.ok(c.prompt.length > 30 && c.title.length > 5, c.id);
    assert.ok(["light", "dark"].includes(c.theme) && ["mouse", "keyboard", "touch"].includes(c.input), c.id);
    assert.ok(Object.hasOwn(PROTOCOL.fixtures, c.fixture), `${c.id}: fixture ${c.fixture} is served by a command the protocol gives`);
    assert.ok(c.address.startsWith("#") && /[&#]vis=2\b/.test(c.address) && /[&]ap=(slate2-8f7890f7|ramp1-a53783c5)\b/.test(c.address), `${c.id}: an address that names the appearance`);
    assert.ok(c.provenBy.length > 0 && c.provenBy.every((t) => testIndex.has(t)), `${c.id}: it names tests that exist (${c.provenBy})`);
  }
});

test("the cases cover what D11 lists: both themes, raw and intensity, zero and unknown, calibrations, context, overflow, flow, the lens, models, events, references, dense signs, touch and keyboard", () => {
  const tags = new Set(PROTOCOL.cases.flatMap((c) => c.categories));
  for (const want of PROTOCOL.required.filter((t) => t !== "both-themes")) assert.ok(tags.has(want), `no case covers ${want}`);
  assert.deepEqual([...new Set(PROTOCOL.cases.map((c) => c.theme))].sort(), ["dark", "light"]);
  for (const input of ["mouse", "keyboard", "touch"]) assert.ok(PROTOCOL.cases.some((c) => c.input === input), input);
  // both of the PRD's near-50% levels, and the scale change from 24 hours to all history, are named cases
  const near4 = PROTOCOL.cases.find((c) => c.categories.includes("near-50-n4")),
    near12 = PROTOCOL.cases.find((c) => c.categories.includes("near-50-n12"));
  assert.ok(/[&]r=4,/.test(near4.address) && /[&]r=12,/.test(near12.address), "taker shares near 50% at n=4 and at n=12");
  assert.ok(PROTOCOL.cases.some((c) => /#w=24h/.test(c.address) && /all history/.test(c.prompt)), "the 24h to all-history scale change");
});

test("the critical cases are the three groups of D11, each with enough cases that 100% is not one lucky answer", () => {
  const groups = {};
  for (const c of PROTOCOL.cases.filter((x) => x.critical)) groups[c.critical] = (groups[c.critical] ?? 0) + 1;
  assert.deepEqual(Object.keys(groups).sort(), [...PROTOCOL.gate.criticalGroups].sort());
  assert.ok(groups["zero-unknown"] >= 4 && groups["scale-comparison"] >= 2 && groups["future-information"] >= 3, JSON.stringify(groups));
});

test("the right answer is not always in the same place, and the longest choice is not always the right one", () => {
  const at = [0, 0, 0];
  let longest = 0;
  for (const c of PROTOCOL.cases) {
    at[c.choices.indexOf(c.answer)]++;
    if (c.answer.length === Math.max(...c.choices.map((x) => x.length))) longest++;
  }
  for (const n of at) assert.ok(n >= 5, `positions of the right answer: ${at}`);
  assert.ok(longest <= PROTOCOL.cases.length * 0.5, `the right answer is the longest choice in ${longest} of ${PROTOCOL.cases.length}`);
});

// ---- the data-derived answers are recomputed ----

// The level's cells of a fixture, from the reference calculator, keyed "c,r".
function cellsOf(name, [n, m]) {
  const f = fixture(name),
    cutMs = Date.parse(f.cutoffIso) - EPOCH,
    out = new Map();
  for (const c of reference.cells(f.trades, { n, m, b0: 0, b1: Math.ceil(cutMs / BASE_MS) + 2, r0: 150, r1: 260 })) out.set(`${c.c},${c.r}`, c);
  return { cells: out, cutMs };
}
const num = (x) => Number(x);
// Each kind of derivation: what the reference says, and a test that the case's answer is the one that says it.
const KINDS = {
  cell(c) {
    const { cells } = cellsOf(c.derive.fixture, c.derive.level);
    assert.equal(cells.has(c.derive.cell.join(",")), false, `${c.id}: the cell traded nothing`);
    assert.equal(c.derive.expect, "no-trade");
    assert.match(c.answer, /No trade happened there/);
  },
  "open-column"(c) {
    const { cutMs } = cellsOf(c.derive.fixture, [0, 0]),
      col = c.derive.cell[0];
    assert.ok(col * BASE_MS < cutMs && cutMs < (col + 1) * BASE_MS, `${c.id}: the cutoff falls inside column ${col}`);
    assert.match(c.answer, /still open|open \(unfinished\)/i);
  },
  balanced(c) {
    const cell = cellsOf(c.derive.fixture, [0, 0]).cells.get(c.derive.cell.join(","));
    assert.ok(cell && num(cell.ct) > 0, `${c.id}: it traded`);
    assert.equal(2 * num(cell.bv) - num(cell.v), 0, `${c.id}: buy volume minus sell volume is zero`);
    assert.match(c.answer, /buyers matched sellers exactly/);
  },
  "undefined-share"(c) {
    const { cells } = cellsOf(c.derive.fixture, [0, 0]);
    assert.equal(cells.has(c.derive.cell.join(",")), false, `${c.id}: no trades, so no share`);
    assert.match(c.answer, /no share/);
  },
  share(c) {
    const cell = cellsOf(c.derive.fixture, c.derive.level).cells.get(c.derive.cell.join(","));
    assert.ok(cell, `${c.id}: the cell exists at level ${c.derive.level}`);
    const share = num(cell.bv) / num(cell.v);
    assert.ok(Math.abs(share - 0.5) < 0.08, `${c.id}: ${(100 * share).toFixed(1)}% is near an even share`);
    const word = share > 0.5 ? "above" : share < 0.5 ? "below" : "even";
    assert.equal(c.derive.expect, word);
    assert.match(c.answer, new RegExp(word === "even" ? "Exactly even" : `^${word[0].toUpperCase()}${word.slice(1)} an even share`));
  },
  compare(c) {
    const { cells } = cellsOf(c.derive.fixture, c.derive.level),
      a = cells.get(c.derive.a.join(",")),
      b = cells.get(c.derive.b.join(",")),
      key = { trades: "ct", volume: "v" }[c.derive.measure];
    const va = num(a[key]),
      vb = num(b[key]);
    assert.equal(c.derive.expect, va > vb ? "a" : va < vb ? "b" : "same");
    // the volumes are the other way round: that is the point of the case
    assert.ok(c.derive.measure !== "trades" || num(a.v) < num(b.v), `${c.id}: more trades but less volume`);
    assert.match(c.answer, c.derive.expect === "a" ? /^The 25,125 row cell/ : /^The 25,000 row cell/);
  },
  "intensity-compare"(c) {
    const f = (side) => {
      const [n, m] = side.level,
        cell = cellsOf(c.derive.fixture, side.level).cells.get(side.cell.join(","));
      return { v: num(cell.v), intensity: num(cell.v) / ((2 ** n * 56.25) / 60) / 2 ** m };
    };
    const a = f(c.derive.a),
      b = f(c.derive.b);
    assert.ok(b.v > a.v, `${c.id}: the coarse cell has more volume`);
    assert.equal(c.derive.expect, a.intensity > b.intensity ? "a" : "b");
    assert.ok(a.intensity > 3 * b.intensity, `${c.id}: and far less intensity (${a.intensity.toFixed(1)} against ${b.intensity.toFixed(1)} per minute per band)`);
    assert.match(c.answer, /fine one/);
    assert.equal(E.text.unit.intensity, "per minute per 125-USDT price band", "the page's own unit for Intensity");
  },
  "day-incomplete"(c) {
    const end = Date.parse(`${c.derive.dayIso}T00:00:00Z`) + 24 * 3600000;
    assert.ok(Date.parse(c.derive.replayIso) < end, `${c.id}: the replay edge is inside the day`);
    assert.match(c.answer, /not over/);
  },
  "event-after-edge"(c) {
    assert.ok(Date.parse(c.derive.eventIso) > Date.parse(c.derive.replayIso), `${c.id}: the event is after the replay edge`);
    assert.ok(textAt(c.derive.text.path).includes(c.derive.text.contains), "the page's word for it");
    assert.match(c.answer, /Hidden in replay/);
  },
  text(c) {
    assert.ok(textAt(c.derive.path).includes(c.derive.contains), `${c.id}: the page says "${c.derive.contains}" at text.${c.derive.path}`);
  },
  source(c) {
    assert.equal(c.derive.file, "src/view.html", "a source phrase is read from the page's markup; the module's words are read from E.text");
    const text = fs.readFileSync(path.join(ROOT, c.derive.file), "utf8");
    assert.ok(text.includes(c.derive.contains), `${c.id}: ${c.derive.file} says "${c.derive.contains}"`);
  },
  table(c) {
    for (const [pathText, expected] of c.derive.checks) assert.deepEqual(JSON.parse(JSON.stringify(evalPath(pathText))), expected, `${c.id}: ${pathText}`);
  },
  rule(c) {
    assert.ok(c.derive.statement.length > 40 && c.provenBy.length > 0, `${c.id}: a stated rule with the tests that prove it`);
  },
  page(c) {
    assert.ok(c.provenBy.includes("B51") && c.page, `${c.id}: it is read from the page by B51`);
  },
};
// A string of the page's own text table, by its dotted path.
const textAt = (dotted) => dotted.split(".").reduce((o, k) => o[k], E.text);
// A tiny evaluator for the role-table paths the protocol cites: names, ('call' arguments) and [indexes].
function evalPath(text) {
  let value = E;
  for (const token of text.match(/[A-Za-z_]+(?:\('[^']*'\))?(?:\[\d+\])?/g)) {
    const m = /^([A-Za-z_]+)(?:\('([^']*)'\))?(?:\[(\d+)\])?$/.exec(token);
    value = m[2] !== undefined ? value[m[1]](m[2]) : value[m[1]];
    if (m[3] !== undefined) value = value[Number(m[3])];
  }
  return value;
}

test("every case's answer is what the reference calculator, the role tables or the page's source say", () => {
  for (const c of PROTOCOL.cases) {
    assert.ok(Object.hasOwn(KINDS, c.derive.kind), `${c.id}: unknown derivation ${c.derive.kind}`);
    KINDS[c.derive.kind](c);
  }
  assert.ok(PROTOCOL.cases.filter((c) => ["cell", "open-column", "balanced", "undefined-share", "share", "compare", "intensity-compare"].includes(c.derive.kind)).length >= 8, "most of the data cases are recomputed from the reference");
});

test("the cases that read the page are the ones B51 reads, and each has its expectation", () => {
  for (const c of PROTOCOL.cases.filter((x) => x.page)) {
    assert.ok(c.provenBy.includes("B51"), c.id);
    assert.ok(c.page.checks?.length > 0 || c.page.scale, `${c.id}: a page expectation`);
    for (const check of c.page.checks ?? []) assert.ok(check.contains.length > 0 && Array.isArray(check.cell), c.id);
  }
});

test("the palette tasks are ordering tasks whose answers the reference gives, with a close pair among them", () => {
  const { cells } = cellsOf("mixed", PROTOCOL.palette.level);
  assert.equal(PROTOCOL.palette.tasks.length, 8);
  let close = 0;
  for (const t of PROTOCOL.palette.tasks) {
    const a = num(cells.get(t.a.join(",")).v),
      b = num(cells.get(t.b.join(",")).v);
    assert.equal(t.expect, a > b ? "a" : "b", `${t.id}: ${a} against ${b}`);
    if (Math.max(a, b) / Math.min(a, b) < 1.1) close++;
  }
  assert.ok(close >= 2, "a close pair is where two palettes differ, so the tasks include some");
  assert.deepEqual([PROTOCOL.palette.candidate, PROTOCOL.palette.current], [E.lut.appearanceId("slate2"), E.lut.appearanceId("ramp1")]);
  // the cells of the tasks are in complete columns (the open column's sums are still moving)
  for (const t of PROTOCOL.palette.tasks) for (const cell of [t.a, t.b]) assert.ok(cell[0] <= 4, `${t.id}: column ${cell[0]} is closed at the cutoff`);
});

test("docs/operator-protocol.md is written from this protocol: every case, its answer and its address are in it, and the outstanding items are named as such", () => {
  for (const c of PROTOCOL.cases) for (const part of [c.id, c.title, c.answer, c.address]) assert.ok(DOC.includes(part), `the page lacks ${c.id}'s ${part.slice(0, 40)}`);
  for (const t of PROTOCOL.palette.tasks) assert.ok(DOC.includes(t.id));
  assert.ok(/OUTSTANDING/.test(DOC) && /have not been run/.test(DOC));
  assert.ok(DOC.includes("22 of 24") && DOC.includes("100%"));
  for (const cmd of Object.values(PROTOCOL.fixtures)) assert.ok(DOC.includes(cmd), "the command to serve each fixture");
  assert.ok(!/\bpassed\b/i.test(DOC.replace(/never relabelled passed|not passed/gi, "")), "nothing here says passed");
});

// ---- the scorer ----

// SYNTHETIC sessions: they exist only to test the arithmetic, never as results.
const answersOf = (wrong = []) => PROTOCOL.cases.map((c) => ({ case: c.id, answer: wrong.includes(c.id) ? c.choices.find((x) => x !== c.answer) : c.answer, ms: 10000, attempt: 1 }));
const paletteOf = (candidateWrong = [], currentWrong = []) =>
  PROTOCOL.palette.tasks.flatMap((t) => [
    { task: t.id, palette: "candidate", answer: candidateWrong.includes(t.id) ? (t.expect === "a" ? "b" : "a") : t.expect, ms: 4000 },
    { task: t.id, palette: "current", answer: currentWrong.includes(t.id) ? (t.expect === "a" ? "b" : "a") : t.expect, ms: 4000 },
  ]);
const session = (id, o = {}) => ({ participant: id, human: true, onboarded: true, colourVision: "typical", device: "laptop", answers: answersOf(o.wrong), palette: paletteOf(o.cw, o.uw), ...o.extra });
const critical = PROTOCOL.cases.filter((c) => c.critical).map((c) => c.id);
const plain = PROTOCOL.cases.filter((c) => !c.critical).map((c) => c.id);

test("the scorer: a perfect session passes, and the gate is met only when every participant passes", () => {
  const r = scorer.score(PROTOCOL, { sessions: [session("T1"), session("T2")] });
  assert.equal(r.gate.met, true);
  assert.equal(r.participants.every((p) => p.pass && p.criticalCorrect === p.criticalCases), true);
  assert.equal(r.palettes.met, true);
  assert.equal(scorer.score(PROTOCOL, { sessions: [session("T1"), session("T2", { wrong: [critical[0]] })] }).gate.met, false, "one participant missing one critical case sinks the gate");
});

test("the scorer: 90% overall means 22 of 24, a critical error fails whatever the rest, and a case not answered is wrong", () => {
  assert.equal(scorer.score(PROTOCOL, { sessions: [session("T1", { wrong: plain.slice(0, 2) })] }).gate.met, true, "two errors: 22 of 24");
  assert.equal(scorer.score(PROTOCOL, { sessions: [session("T1", { wrong: plain.slice(0, 3) })] }).gate.met, false, "three errors: 21 of 24");
  assert.equal(scorer.score(PROTOCOL, { sessions: [session("T1", { wrong: [critical[1]] })] }).participants[0].pass, false);
  const missing = session("T1");
  missing.answers = missing.answers.filter((a) => a.case !== plain[0]);
  const r = scorer.score(PROTOCOL, { sessions: [missing] });
  assert.deepEqual(r.participants[0].unanswered, [plain[0]]);
  assert.equal(r.participants[0].correct, PROTOCOL.cases.length - 1);
});

test("the scorer: no onboarding, no pass; a model or a script is refused, not scored; and no session at all is OUTSTANDING, never a pass", () => {
  const unboarded = scorer.score(PROTOCOL, { sessions: [session("T1", { extra: { onboarded: false } })] });
  assert.equal(unboarded.participants[0].pass, false);
  const r = scorer.score(PROTOCOL, { sessions: [session("T1"), session("M1", { extra: { source: "model" } }), session("S1", { extra: { human: false } })] });
  assert.equal(r.sample.participants, 1);
  assert.deepEqual(r.sample.refused.map((x) => x.participant), ["M1", "S1"]);
  const none = scorer.score(PROTOCOL, { sessions: [] });
  assert.equal(none.outstanding, true);
  assert.equal(none.gate.met, false);
  const text = scorer.report(none);
  assert.match(text, /OUTSTANDING/);
  assert.ok(!/\b(passed|met)\b/i.test(text.replace(/not a pass/gi, "")), "an empty sample says nothing passed");
  assert.match(scorer.report(scorer.score(PROTOCOL, { sessions: [session("M1", { extra: { source: "simulation" } })] })), /OUTSTANDING/);
});

test("the scorer: the first attempt is the result; a rerun is listed apart with its change and never replaces it", () => {
  const s = session("T1", { wrong: [plain[0]] });
  s.answers.push({ case: plain[0], answer: PROTOCOL.cases.find((c) => c.id === plain[0]).answer, ms: 8000, attempt: 2, change: "the prompt was reworded" });
  const r = scorer.score(PROTOCOL, { sessions: [s] });
  assert.equal(r.participants[0].errors.length, 1, "the first error stands");
  assert.deepEqual(r.participants[0].errors[0].case, plain[0]);
  assert.equal(r.participants[0].reruns.length, 1);
  assert.equal(r.participants[0].reruns[0].correct, true);
  assert.equal(r.participants[0].reruns[0].change, "the prompt was reworded");
  assert.match(scorer.report(r), /Reruns after a change/);
  const twice = session("T2");
  twice.answers.push({ ...twice.answers[0], attempt: 1 });
  assert.throws(() => scorer.score(PROTOCOL, { sessions: [twice] }), /two first attempts/);
  assert.throws(() => scorer.score(PROTOCOL, { sessions: [{ ...session("T3"), answers: [{ case: "OP-99", answer: "x", attempt: 1 }] }] }), /unknown case/);
});

test("the scorer: the candidate palette must add no error; an error it removes does not buy one it adds", () => {
  const ids = PROTOCOL.palette.tasks.map((t) => t.id);
  const better = scorer.score(PROTOCOL, { sessions: [session("T1", { uw: [ids[0]] })] });
  assert.equal(better.palettes.met, true);
  assert.equal(better.palettes.removedErrors, 1);
  const worse = scorer.score(PROTOCOL, { sessions: [session("T1", { cw: [ids[2]] }), session("T2", { uw: [ids[0], ids[1]] })] });
  assert.equal(worse.palettes.addedErrors, 1);
  assert.equal(worse.palettes.removedErrors, 2);
  assert.equal(worse.palettes.met, false, "one added error is one too many, however many it removed elsewhere");
  assert.equal(scorer.score(PROTOCOL, { sessions: [{ ...session("T1"), palette: [] }] }).palettes.met, false, "no palette trials is not a pass");
  assert.throws(() => scorer.palette(PROTOCOL, { participant: "T", palette: [{ task: "PT-01", palette: "third", answer: "a" }] }), /candidate or current/);
});

test("the palette comparison needs every paired task of every participant, and the first attempt wins whatever the order of the file (PR #53 review)", () => {
  const ids = PROTOCOL.palette.tasks.map((t) => t.id);
  // correct case answers and two palette responses: one pair of eight is not a comparison
  const two = session("T1");
  two.palette = two.palette.filter((a) => a.task === ids[0]);
  const r = scorer.score(PROTOCOL, { sessions: [two] });
  assert.equal(r.palettes.met, false, "one pair among eight");
  assert.deepEqual(r.palettes.incomplete, [{ participant: "T1", paired: 1, required: 8 }]);
  assert.match(scorer.report(r), /incomplete: T1 answered 1 of 8 paired tasks/);
  // a participant who did the cases and not the trials
  const none = session("T2");
  none.palette = [];
  assert.equal(scorer.score(PROTOCOL, { sessions: [session("T1"), none] }).palettes.met, false);
  // a correct rerun listed BEFORE the incorrect first attempt does not erase the error
  const t = PROTOCOL.palette.tasks[0],
    wrong = t.expect === "a" ? "b" : "a",
    s = session("T3");
  s.palette = s.palette.filter((a) => !(a.task === t.id && a.palette === "candidate"));
  s.palette.unshift({ task: t.id, palette: "candidate", answer: t.expect, ms: 3000, attempt: 2, change: "the task was reworded" });
  s.palette.push({ task: t.id, palette: "candidate", answer: wrong, ms: 4000, attempt: 1 });
  const out = scorer.score(PROTOCOL, { sessions: [s] });
  assert.equal(out.participants[0].palette.candidateErrors, 1, "the first attempt was wrong");
  assert.equal(out.participants[0].palette.addedErrors, 1);
  assert.equal(out.palettes.met, false);
  // two first attempts for one trial is a malformed file
  const twice = session("T4");
  twice.palette.push({ ...twice.palette[0] });
  assert.throws(() => scorer.score(PROTOCOL, { sessions: [twice] }), /two first attempts/);
});

test("the balanced palette order: every task twice in both palettes, each serial position once over eight participants, each palette first equally often", () => {
  const ids = PROTOCOL.palette.tasks.map((t) => t.id);
  const orders = Array.from({ length: 8 }, (_, i) => scorer.balancedOrder(i, ids));
  for (const o of orders) {
    assert.equal(o.length, 16);
    for (const id of ids) assert.deepEqual(o.filter((t) => t.task === id).map((t) => t.palette).sort(), ["candidate", "current"], `${id}: once in each palette`);
    assert.deepEqual(o.map((t) => t.position), Array.from({ length: 16 }, (_, k) => k));
    const firstOf = (id) => o.find((t) => t.task === id).position,
      secondOf = (id) => o.findLast((t) => t.task === id).position;
    for (const id of ids) assert.ok(firstOf(id) < 8 && secondOf(id) >= 8, `${id}: the two showings are in the two halves`);
  }
  // over eight participants each task takes each place of the first half once
  for (const id of ids) assert.deepEqual(orders.map((o) => o.find((t) => t.task === id).position).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  // and over any two participants each task is seen first with each palette
  for (let i = 0; i < 8; i += 2) for (const id of ids) assert.deepEqual([orders[i], orders[i + 1]].map((o) => o.find((t) => t.task === id).palette).sort(), ["candidate", "current"]);
  const firstPalettes = orders.flatMap((o) => o.slice(0, 8)).filter((t) => t.palette === "candidate").length;
  assert.equal(firstPalettes, 32, "half of the first showings are the candidate");
});
