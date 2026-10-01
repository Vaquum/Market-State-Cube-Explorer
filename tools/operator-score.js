#!/usr/bin/env node
"use strict";
// tools/operator-score.js: scores the operator's sessions against the committed 24-case protocol of D11 (PRD-0002 S3, #48 section 4).
//
//   node tools/operator-score.js responses.json            prints the report (markdown); exit 0 if the gate is met, 1 if not, 2 if there is nothing to score
//   node tools/operator-score.js --order <participant#>    prints the balanced palette-comparison order for the n-th participant (0, 1, 2 ...)
//
// What it holds the evidence to (docs/operator-protocol.md):
//   * only HUMAN sessions count: a session needs `"human": true`, and one whose `source` is a model, a simulation or a script is refused, not scored;
//   * the first attempt of a case is the result: errors and times are recorded as they were before any fix, and a rerun after a change is listed apart, with the change
//     that prompted it, and never replaces the first;
//   * the gate (D11), after the documented onboarding: every participant answers every critical case (zero versus unknown, scale comparison, future information) correctly
//     the first time, and answers at least 90% of the cases correctly overall; the pooled figures are reported beside the per-participant ones;
//   * the palettes: the candidate (slate2) is compared with the current (ramp1) on the same ordering tasks, each shown in both; the candidate must not ADD errors (a task a
//     participant gets wrong with the candidate and right with the current one); it does not establish superiority for a population;
//   * the sample is reported as it is: how many people, their declared colour vision, their devices, and the limit that follows. An empty sample is reported OUTSTANDING, never passed.
// The scorer computes; it never fills a gap: a case a participant did not answer is wrong, and a missing required case is reported.
const fs = require("node:fs");
const path = require("node:path");

const PROTOCOL_PATH = path.resolve(__dirname, "../tests/fixtures/palette/operator-protocol.json");
const loadProtocol = () => JSON.parse(fs.readFileSync(PROTOCOL_PATH, "utf8"));
const NOT_HUMAN = /^(model|simulation|simulated|script|bot|llm|synthetic)/i;

// The balanced order of the palette trials for the n-th participant (0-based): every task is shown in both palettes; the palette that goes first alternates with the
// participant and the task, and the tasks rotate by participant, so that over eight participants each task is in each serial position once and over two participants each
// task is seen first with each palette once. Returns [{ task, palette: "candidate"|"current", position }] for the 16 trials, the pair of one task kept apart by the others.
function balancedOrder(index, tasks, palettes = ["candidate", "current"]) {
  const n = tasks.length;
  const rotated = tasks.map((_, k) => tasks[(k + index) % n]);
  const first = [],
    second = [];
  rotated.forEach((task, k) => {
    // which palette goes first for this task alternates with the participant (and, for a given participant, with the task's own place in the list)
    const flip = (index + tasks.indexOf(task)) % 2 === 1;
    first.push({ task, palette: palettes[flip ? 1 : 0] });
    second.push({ task, palette: palettes[flip ? 0 : 1] });
  });
  return [...first, ...second].map((t, position) => ({ ...t, position }));
}

// The score of a set of sessions. `responses` is { sessions: [...] }; see docs/operator-protocol.md for the shape.
function score(protocol, responses) {
  const cases = protocol.cases,
    byId = new Map(cases.map((c) => [c.id, c])),
    critical = cases.filter((c) => c.critical),
    refused = [],
    participants = [];
  for (const s of responses.sessions ?? []) {
    if (s.human !== true || NOT_HUMAN.test(String(s.source ?? ""))) {
      refused.push({ participant: s.participant ?? "(unnamed)", reason: s.human !== true ? 'not marked "human": true' : `source "${s.source}" is not a person` });
      continue;
    }
    const first = new Map(),
      reruns = [];
    for (const a of s.answers ?? []) {
      if (!byId.has(a.case)) throw new RangeError(`session ${s.participant}: unknown case ${a.case}`);
      if ((a.attempt ?? 1) === 1) {
        if (first.has(a.case)) throw new RangeError(`session ${s.participant}: two first attempts for ${a.case}`);
        first.set(a.case, a);
      } else reruns.push(a);
    }
    const rows = cases.map((c) => {
      const a = first.get(c.id);
      return { case: c.id, critical: c.critical, answered: Boolean(a), correct: Boolean(a) && a.answer === c.answer, answer: a?.answer ?? null, ms: a?.ms ?? null };
    });
    const right = rows.filter((r) => r.correct).length,
      critRows = rows.filter((r) => r.critical),
      critRight = critRows.filter((r) => r.correct).length;
    participants.push({
      participant: s.participant,
      colourVision: s.colourVision ?? "undeclared",
      device: s.device ?? "undeclared",
      onboarded: s.onboarded === true,
      cases: rows.length,
      correct: right,
      overall: right / rows.length,
      criticalCases: critRows.length,
      criticalCorrect: critRight,
      errors: rows.filter((r) => !r.correct).map((r) => ({ case: r.case, critical: r.critical, answered: r.answered, answer: r.answer, ms: r.ms })),
      unanswered: rows.filter((r) => !r.answered).map((r) => r.case),
      reruns: reruns.map((a) => ({ case: a.case, attempt: a.attempt, answer: a.answer, correct: a.answer === byId.get(a.case).answer, change: a.change ?? null, ms: a.ms ?? null })),
      pass: s.onboarded === true && critRight === critRows.length && right / rows.length >= protocol.gate.overall,
      palette: palette(protocol, s),
    });
  }
  const pooledRight = participants.reduce((n, p) => n + p.correct, 0),
    pooledCases = participants.reduce((n, p) => n + p.cases, 0),
    addedErrors = participants.reduce((n, p) => n + p.palette.addedErrors, 0),
    removedErrors = participants.reduce((n, p) => n + p.palette.removedErrors, 0),
    paletteTrials = participants.reduce((n, p) => n + p.palette.tasks, 0);
  const sample = { participants: participants.length, colourVision: tally(participants.map((p) => p.colourVision)), devices: tally(participants.map((p) => p.device)), refused };
  const gate = {
    required: { critical: protocol.gate.critical, overall: protocol.gate.overall, minimumCases: protocol.gate.minimumCases, cases: cases.length, criticalCases: critical.length },
    met: participants.length > 0 && participants.every((p) => p.pass) && pooledRight / Math.max(1, pooledCases) >= protocol.gate.overall && cases.length >= protocol.gate.minimumCases,
    pooledOverall: pooledCases ? pooledRight / pooledCases : null,
  };
  // the palette comparison is evidence only when EVERY participant completed EVERY paired task (a task is paired when both palettes were answered): one pair among
  // fourteen missing is not a comparison, and a participant who answered the cases but not the trials has not taken part in it
  const required = protocol.palette.tasks.length,
    incomplete = participants.filter((p) => p.palette.tasks < required).map((p) => ({ participant: p.participant, paired: p.palette.tasks, required }));
  const palettes = { participants: participants.filter((p) => p.palette.tasks > 0).length, trials: paletteTrials, required, incomplete, addedErrors, removedErrors, met: participants.length > 0 && incomplete.length === 0 && addedErrors === 0 };
  return { protocol: { cases: cases.length, critical: critical.length, version: protocol.version }, sample, participants, gate, palettes, outstanding: participants.length === 0 };
}

// The comparison of the two palettes for one session: for each task, the answers under the candidate and under the current palette (the first attempt of each).
function palette(protocol, session) {
  const tasks = protocol.palette.tasks,
    byId = new Map(tasks.map((t) => [t.id, t])),
    got = new Map();
  for (const a of session.palette ?? []) {
    if (!byId.has(a.task)) throw new RangeError(`session ${session.participant}: unknown palette task ${a.task}`);
    if (!["candidate", "current"].includes(a.palette)) throw new RangeError(`session ${session.participant}: palette must be candidate or current`);
    // the first attempt is the result, in whatever order the file lists them; a rerun (attempt 2 or more) never replaces it
    if ((a.attempt ?? 1) !== 1) continue;
    const key = `${a.task}|${a.palette}`;
    if (got.has(key)) throw new RangeError(`session ${session.participant}: two first attempts for ${key}`);
    got.set(key, a);
  }
  let added = 0,
    removed = 0,
    complete = 0,
    candidateErrors = 0,
    currentErrors = 0;
  for (const t of tasks) {
    const c = got.get(`${t.id}|candidate`),
      u = got.get(`${t.id}|current`);
    if (!c || !u) continue;
    complete++;
    const cRight = c.answer === t.expect,
      uRight = u.answer === t.expect;
    if (!cRight) candidateErrors++;
    if (!uRight) currentErrors++;
    if (!cRight && uRight) added++;
    if (cRight && !uRight) removed++;
  }
  return { tasks: complete, candidateErrors, currentErrors, addedErrors: added, removedErrors: removed };
}

function tally(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

const pct = (x) => (x === null ? "n/a" : `${(100 * x).toFixed(1)}%`);

// The report, in markdown, in the words the evidence is entitled to.
function report(result) {
  const out = [];
  const w = (s = "") => out.push(s);
  w("# Operator task results");
  w();
  if (result.outstanding) {
    w("**OUTSTANDING.** No human session was scored. This is not a pass: the 24-case operator protocol has not been run with participants, and nothing here may be read as evidence that the palette, the Inspect tool or the sign marks were understood by anyone.");
    for (const r of result.sample.refused) w(`- refused: ${r.participant}: ${r.reason}`);
    return out.join("\n");
  }
  w(`${result.sample.participants} participant(s). Declared colour vision: ${JSON.stringify(result.sample.colourVision)}. Devices: ${JSON.stringify(result.sample.devices)}.`);
  for (const r of result.sample.refused) w(`- refused, not scored: ${r.participant}: ${r.reason}`);
  w();
  w(`## Gate (D11): ${result.gate.met ? "met" : "NOT met"}`);
  w();
  w(`Required: every critical case (${result.gate.required.criticalCases}) right the first time, at least ${pct(result.gate.required.overall)} of ${result.gate.required.cases} cases right overall, for every participant after the documented onboarding. Pooled overall: ${pct(result.gate.pooledOverall)}.`);
  w();
  w("| Participant | Colour vision | Onboarded | Critical right | Overall | Gate |");
  w("|---|---|---|---|---|---|");
  for (const p of result.participants) w(`| ${p.participant} | ${p.colourVision} | ${p.onboarded ? "yes" : "NO"} | ${p.criticalCorrect} of ${p.criticalCases} | ${p.correct} of ${p.cases} (${pct(p.overall)}) | ${p.pass ? "pass" : "FAIL"} |`);
  w();
  w("## First-attempt errors (recorded as they were, before any fix)");
  w();
  const errs = result.participants.flatMap((p) => p.errors.map((e) => ({ participant: p.participant, ...e })));
  if (!errs.length) w("None.");
  else {
    w("| Participant | Case | Critical | Answer given | Time (ms) |");
    w("|---|---|---|---|---|");
    for (const e of errs) w(`| ${e.participant} | ${e.case} | ${e.critical ?? ""} | ${e.answered ? e.answer : "(not answered)"} | ${e.ms ?? ""} |`);
  }
  const reruns = result.participants.flatMap((p) => p.reruns.map((r) => ({ participant: p.participant, ...r })));
  if (reruns.length) {
    w();
    w("## Reruns after a change (listed apart; the first attempts above stand)");
    w();
    w("| Participant | Case | Attempt | Correct | The change that prompted it |");
    w("|---|---|---|---|---|");
    for (const r of reruns) w(`| ${r.participant} | ${r.case} | ${r.attempt} | ${r.correct ? "yes" : "no"} | ${r.change ?? "(not recorded)"} |`);
  }
  w();
  w(`## Candidate and current unsigned palettes: ${result.palettes.met ? "the candidate added no error" : result.palettes.incomplete.length ? "INCOMPLETE" : result.palettes.trials ? "the candidate ADDED errors" : "not run"}`);
  w();
  for (const i of result.palettes.incomplete) w(`- incomplete: ${i.participant} answered ${i.paired} of ${i.required} paired tasks, so the comparison is not met`);
  w(`${result.palettes.participants} participant(s), ${result.palettes.trials} paired tasks: the candidate was wrong where the current palette was right ${result.palettes.addedErrors} time(s), and right where it was wrong ${result.palettes.removedErrors} time(s). This is a test on this task set with these people; it does not establish that either palette is better for a population.`);
  w();
  w("## Limits");
  w();
  w("The sample is the one above: nothing more is claimed for people whose colour vision, devices or tasks it does not include. Simulations of colour vision and answers produced by a model are not participation and were refused where marked.");
  return out.join("\n");
}

module.exports = { loadProtocol, score, palette, balancedOrder, report };

if (require.main === module) {
  const args = process.argv.slice(2);
  const protocol = loadProtocol();
  if (args[0] === "--order") {
    const index = Number(args[1]);
    if (!Number.isInteger(index) || index < 0) {
      console.error("usage: operator-score.js --order <participant number from 0>");
      process.exit(2);
    }
    console.log(JSON.stringify(balancedOrder(index, protocol.palette.tasks.map((t) => t.id)), null, 2));
  } else if (args[0]) {
    const result = score(protocol, JSON.parse(fs.readFileSync(args[0], "utf8")));
    console.log(report(result));
    process.exit(result.outstanding ? 2 : result.gate.met && result.palettes.met ? 0 : 1);
  } else {
    console.error("usage: operator-score.js <responses.json> | --order <n>");
    process.exit(2);
  }
}
