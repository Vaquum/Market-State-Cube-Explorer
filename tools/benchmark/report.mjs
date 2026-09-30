// tools/benchmark/report.mjs (H9): assembles, words and writes the benchmark report (`navigation-report.v1`: JSON plus summary.md).
//
// The JSON holds every sample (draws, frame intervals, input-to-paint per run) so that a reader can re-run the analysis with
// stats.mjs; summary.md is for people. The STATEMENT is generated from the verdict and uses only the D12 vocabulary: it names the
// environment, says whether it was designated, never calls a missing signal "equal" and never calls an inconclusive interval "zero
// overhead". A report is validated against schema.mjs before anything is written (a run that cannot describe itself produces no file).
import fs from "node:fs";
import path from "node:path";
import { NOT_DESIGNATED, REPORT_KIND, SCHEMA_VERSION, validateReport } from "./schema.mjs";

// The limits of the evidence, carried in every report (TESTPLAN.md 5.6). Worded here once so that no report can omit them.
export const LIMITS = Object.freeze([
  "B-L1: input-to-paint ends at the end of the page's draw callback; it excludes the compositor and the present latency of the display.",
  "B-L2: the browser coarsens timers; the measured timer resolution is recorded and is the lowest value an A/A floor can take.",
  "B-L3: a laptop or a shared runner is not the designated machine. A run on one is non-designated-environment evidence and cannot satisfy the operator's designated-machine requirement (O-01).",
  "B-L4: with 20 confirmation pairs a 99 % family-wise interval is wide; 'inconclusive' is a likely outcome and is reported as such, needing an explanation or the operator's decision (O-02).",
  "B-L5: headless shell and full Chrome differ; the mode is recorded and the operator's designated mode should match it.",
  "B-L6: the canvas bitmap is reallocated on every draw (geometry() assigns canvas.width) in both builds, so it sits inside every draw sample; the A/A floor may often exceed 0.2 ms on a laptop and 'environment-inconclusive' is a likely outcome.",
  "The fake cube serves synthetic trades; fake-live timing excludes network and server latency, the recorded cases measure only the page, and each build's fake keeps its server-side caches warm across the trials it serves.",
]);

const fixed = (x, digits = 3) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(digits));

const cellName = (c) => `${c.case}/${c.metric}`;

// statement(report): the generated text. Everything it says is read from the report, never from a constant, except the vocabulary.
export function statement(report) {
  const e = report.environment;
  const a = report.analysis;
  const parts = [];
  parts.push(
    `Measured on ${e.cpuModel} (${e.cores} cores, ${e.memoryGb} GB), ${e.os}, ${e.browser.name} ${e.browser.version} (${e.browser.mode}), viewport ${e.viewport.width}x${e.viewport.height}, DPR ${e.dpr}, reduced motion ${e.reducedMotion}.`,
  );
  parts.push(e.designated ? `Environment named by the operator as designated: ${e.designated}.` : NOT_DESIGNATED);
  if (report.smoke) {
    parts.push("SMOKE RUN: the tool ran end to end on a reduced protocol to show that it works and that its report validates. No number in this report is evidence, and no D12 verdict is given.");
    return parts.join(" ");
  }
  if (!a.environment.gate.ok) {
    const bad = a.environment.gate.offending.map((o) => `${o.case} ${fixed(o.floorMs)} ms`).join(", ");
    parts.push(`The environment is inconclusive: the A/A mean-draw noise floor exceeds ${a.environment.gate.limitMs} ms in ${bad}.`);
    parts.push(a.comparisons.length ? "The A/B phases were run only because --force-inconclusive was given; their results are exploratory and do not change this verdict." : "The A/B phases were not run.");
    return parts.join(" ");
  }
  const coincide = a.comparisons.find((c) => c.coincidesWith);
  if (coincide) parts.push(`Preceding main and the original build are the same commit in this slice, so the comparison against preceding main is the comparison against the original build.`);
  for (const cmp of a.comparisons) {
    const label = cmp.coincidesWith ? `${cmp.vs} (same as ${cmp.coincidesWith})` : cmp.vs;
    if (cmp.confirmation === null) {
      parts.push(`Against ${label}: no regression detected at this resolution by the ${cmp.screening.cells[0]?.pairs ?? 0}-pair screening; this is not a proof of equality.`);
    } else {
      const bad = cmp.confirmation.intervals.filter((i) => i.verdict === "blocking").map(cellName);
      const span = cmp.confirmation.intervals.filter((i) => i.verdict === "inconclusive").map(cellName);
      if (cmp.verdict === "blocking") parts.push(`Against ${label}: blocking repeatable regression; the lower bound of the ${fixed(a.level * 100, 4)} % family-wise interval is above the A/A floor for ${bad.join(", ")}.`);
      else if (cmp.verdict === "inconclusive") parts.push(`Against ${label}: inconclusive; the interval spans the A/A floor for ${span.join(", ")}, which needs an explanation or an operator decision and is not a claim of zero overhead.`);
      else parts.push(`Against ${label}: no regression detected at this resolution; every one of the ${cmp.confirmation.intervals.length} intervals of the ${cmp.confirmation.intervals[0]?.pairs ?? 0}-pair confirmation lies at or below its A/A floor; this is not a proof of equality.`);
    }
    const over = cmp.budgets.filter((b) => b.checks.some((k) => k.status === "exceeds-where-baseline-meets")).map((b) => b.case);
    if (over.length) parts.push(`Budgets exceeded where the original build meets them (${label}): ${over.join(", ")}.`);
  }
  return parts.join(" ");
}

// buildReport(parts) -> report: the fixed key order of the report. `analysis` comes from stats.analyse; the statement is generated.
export function buildReport({ createdAtUtc, label, smoke, config, environment, roles, builds, data, protocol, budgets, phases, samples, analysis, forcedInconclusive, warnings }) {
  const report = {
    schemaVersion: SCHEMA_VERSION,
    kind: REPORT_KIND,
    createdAtUtc,
    label,
    smoke,
    config,
    environment: { ...environment, nonDesignatedNotice: NOT_DESIGNATED },
    roles,
    builds,
    data,
    protocol,
    budgets,
    phases,
    samples,
    analysis,
    verdict: analysis.verdict,
    forcedInconclusive,
    warnings,
    limits: [...LIMITS],
    statement: "",
  };
  report.statement = statement(report);
  return report;
}

// ---- summary.md ----

const table = (head, rows) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

export function renderSummary(report) {
  const a = report.analysis;
  const lines = [];
  lines.push(`# Navigation benchmark: ${report.label}`, "");
  lines.push(`Verdict: **${report.verdict}**${report.smoke ? " (smoke run, not evidence)" : ""}`, "");
  lines.push(report.statement, "");
  lines.push("## Environment", "");
  const e = report.environment;
  lines.push(
    table(["what", "value"], [
      ["created (UTC)", report.createdAtUtc],
      ["machine", `${e.cpuModel}, ${e.cores} cores, ${e.memoryGb} GB, ${e.os}`],
      ["browser", `${e.browser.name} ${e.browser.version}, ${e.browser.mode}`],
      ["viewport / DPR", `${e.viewport.width}x${e.viewport.height} / ${e.dpr}, reduced motion ${e.reducedMotion}`],
      ["timer resolution", `${fixed(e.timerResolutionMs, 4)} ms`],
      ["designated", e.designated ?? "no"],
      ["CPU throttle", e.cpuThrottle === null ? "none" : `${e.cpuThrottle}x`],
      ["CI", String(e.ci)],
      ["data", `${report.data.profile}, seed ${report.data.seed}, cutoff ${report.data.cutoff}, pack ${report.data.packToken.slice(0, 16)}`],
      ["config", `${report.config.path} sha256 ${report.config.sha256.slice(0, 16)}, seed ${report.config.seed}`],
    ]),
    "",
  );
  lines.push("## Builds", "");
  lines.push(table(["label", "commit", "index.html sha256", "vendor/d3.min.js sha256"], report.builds.map((b) => [b.label, b.sha.slice(0, 12), b.indexSha256.slice(0, 16), b.vendorSha256.slice(0, 16)])), "");
  lines.push(`Roles: original ${report.roles.original.slice(0, 7)}, preceding ${report.roles.preceding.slice(0, 7)}, candidate ${report.roles.candidate.slice(0, 7)}.`, "");

  lines.push("## A/A noise floors (ms)", "");
  lines.push(
    table(
      ["case", "mean draw", "mean frame interval"],
      Object.entries(a.floors).map(([id, f]) => [id, fixed(f.meanDrawMs, 4), fixed(f.meanFrameIntervalMs, 4)]),
    ),
    "",
    `Environment gate: ${a.environment.gate.ok ? "ok" : `inconclusive (limit ${a.environment.gate.limitMs} ms)`}.`,
    "",
  );

  for (const cmp of a.comparisons) {
    lines.push(`## Against ${cmp.vs}${cmp.coincidesWith ? ` (the same build as ${cmp.coincidesWith})` : ""}: ${cmp.verdict}`, "");
    lines.push(`Screening: ${cmp.screening.signal ? "a median exceeded its floor, confirmation run" : "no median exceeded its floor"}.`, "");
    if (cmp.confirmation) {
      lines.push(
        table(
          ["case / metric", "mean diff", "lower", "upper", "floor", "verdict"],
          cmp.confirmation.intervals.map((i) => [cellName(i), fixed(i.meanDifference, 4), fixed(i.lower, 4), fixed(i.upper, 4), fixed(i.floor, 4), i.verdict]),
        ),
        "",
        `${cmp.confirmation.intervals[0]?.pairs ?? 0} pairs, ${cmp.confirmation.intervals[0]?.resamples ?? 0} resamples, two-sided level ${fixed(cmp.confirmation.level, 6)} (family ${cmp.confirmation.familySize}, tails ${cmp.confirmation.tail}).`,
        "",
      );
    }
    lines.push("### Budgets (pooled over the steady runs of this comparison)", "");
    const rows = [];
    for (const b of [...cmp.budgets, ...cmp.heavy.map((h) => h.budgets)]) {
      for (const k of b.checks) rows.push([b.case, k.budget, fixed(k.candidate, 3), fixed(k.original, 3), String(k.limit), k.status]);
    }
    lines.push(table(["case", "budget", "candidate", "original", "limit", "status"], rows), "");
    if (cmp.heavy.length) {
      lines.push("### Heavy combinations (report only: incremental cost, candidate minus original)", "");
      lines.push(
        table(
          ["case", "pairs", "mean draw diff (ms)", "mean frame-interval diff (ms)"],
          cmp.heavy.map((h) => [h.case, String(h.differences.meanDrawMs.pairs), fixed(h.differences.meanDrawMs.mean, 4), fixed(h.differences.meanFrameIntervalMs.mean, 4)]),
        ),
        "",
      );
    }
    lines.push("### Cold runs (reported apart; never part of the steady comparison)", "");
    lines.push(
      table(
        ["case", "original runs", "original mean draw", "candidate runs", "candidate mean draw"],
        cmp.cold.map((c) => [c.case, String(c.original.runs), fixed(c.original.meanDrawMs, 3), String(c.candidate.runs), fixed(c.candidate.meanDrawMs, 3)]),
      ),
      "",
    );
  }

  lines.push("## Assumptions", "", ...a.assumptions.map((x) => `- ${x}`), "");
  lines.push("## Limits", "", ...report.limits.map((x) => `- ${x}`), "");
  if (report.warnings.length) lines.push("## Warnings", "", ...report.warnings.map((x) => `- ${x}`), "");
  return `${lines.join("\n")}\n`;
}

// writeReport(report, {outDir, stamp}) -> {json, markdown}: validates, then writes <outDir>/<stamp>-<label>.json and .md.
export function writeReport(report, { outDir, stamp }) {
  const errors = validateReport(report);
  if (errors.length) throw new Error(`the report does not validate against schema.mjs:\n  ${errors.slice(0, 20).join("\n  ")}`);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${stamp}-${report.label}`);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(`${base}.md`, renderSummary(report));
  return { json: `${base}.json`, markdown: `${base}.md` };
}
