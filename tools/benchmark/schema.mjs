// tools/benchmark/schema.mjs (H9): validators for the benchmark configuration and the report, hand-written (no dependency).
//
// Each validator returns a list of error strings naming the path of the offending value, empty when the input is valid; nothing
// throws on bad input, so the caller can print every problem at once. The configuration is checked before a run starts (a run on a
// malformed configuration must not produce evidence) and the report before it is written (the smoke run exists to prove this).

export const CONFIG_KIND = "navigation-benchmark-config";
export const REPORT_KIND = "navigation-benchmark";
export const SCHEMA_VERSION = 1;
export const BROWSER_MODES = ["chromium-new-headless", "headless-shell"];
export const CASE_MODES = ["recorded", "fake-live"];
export const PHASES = ["aa", "screening", "confirmation", "heavy"];
export const VERDICT_NAMES = ["blocking", "no-regression-detected-at-this-resolution", "inconclusive", "environment-inconclusive", "smoke"];
export const NOT_DESIGNATED = "Not a designated environment; not a precision certificate.";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
const isIso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(v) && Number.isFinite(Date.parse(v));
const isSha = (v) => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);
const isSha256 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

// A tiny checker: ok(path, condition, message) records an error when the condition is false.
function checker() {
  const errors = [];
  const ok = (path, condition, message) => {
    if (!condition) errors.push(`${path}: ${message}`);
    return Boolean(condition);
  };
  const object = (path, value) => ok(path, isObject(value), "must be an object");
  const array = (path, value) => ok(path, Array.isArray(value), "must be an array");
  const int = (path, value, min = -Infinity) => ok(path, isInt(value) && value >= min, `must be an integer >= ${min}`);
  const num = (path, value, min = -Infinity) => ok(path, isNum(value) && value >= min, `must be a finite number >= ${min}`);
  const str = (path, value) => ok(path, isStr(value), "must be a non-empty string");
  const numbers = (path, value) => array(path, value) && ok(path, value.every(isNum), "must hold finite numbers only");
  return { errors, ok, object, array, int, num, str, numbers };
}

const caseList = (c, path, list, { heavy }) => {
  if (!c.array(path, list)) return;
  const seen = new Set();
  list.forEach((item, i) => {
    const at = `${path}[${i}]`;
    if (!c.object(at, item)) return;
    c.str(`${at}.id`, item.id);
    c.ok(`${at}.id`, !seen.has(item.id), `duplicate case id ${item.id}`);
    seen.add(item.id);
    c.ok(`${at}.mode`, CASE_MODES.includes(item.mode), `must be one of ${CASE_MODES.join(", ")}`);
    c.ok(`${at}.view`, typeof item.view === "string" && /^#[^\s]+$/.test(item.view), "must be an address hash such as #w=24h");
    if (heavy && item.preGesture !== undefined) {
      c.object(`${at}.preGesture`, item.preGesture);
      c.ok(`${at}.preGesture.keys`, Array.isArray(item.preGesture?.keys) && item.preGesture.keys.every(isStr), "must be a list of key names");
      c.ok(`${at}.preGesture.moveTo`, item.preGesture?.moveTo === "canvas-center", "must be canvas-center");
    }
  });
};

// validateConfig(config) -> string[]
export function validateConfig(config) {
  const c = checker();
  if (!c.object("config", config)) return c.errors;
  c.ok("config.schemaVersion", [1, 2, 3].includes(config.schemaVersion), "must be 1, 2 or 3");
  c.ok("config.kind", config.kind === CONFIG_KIND, `must be ${CONFIG_KIND}`);
  if (config.schemaVersion >= 2) {
    c.ok("config.budgetCondition", config.budgetCondition === "baseline-meets-budget", "must preserve the baseline budget condition");
    c.ok("config.candleCache", JSON.stringify(config.candleCache) === JSON.stringify({ranges:64,records:65536,bytes:16777216,recordBytes:192}), "must pin all candle cache caps");
    caseList(c, "config.candleCases", config.candleCases, { heavy: true });
    c.ok("config.realHost.requiredLevels", JSON.stringify(config.realHost?.requiredLevels) === JSON.stringify(Array.from({length:21},(_,n)=>n)), "must verify n0..20");
  }
  c.int("config.seed", config.seed, 0);

  if (c.object("config.data", config.data)) {
    c.str("config.data.profile", config.data.profile);
    c.int("config.data.seed", config.data.seed, 0);
    c.ok("config.data.cutoff", isIso(config.data.cutoff), "must be an ISO UTC time");
  }
  if (c.object("config.viewport", config.viewport)) {
    c.int("config.viewport.width", config.viewport.width, 1);
    c.int("config.viewport.height", config.viewport.height, 1);
  }
  c.num("config.dpr", config.dpr, 0.5);

  if (c.object("config.browser", config.browser)) {
    c.ok("config.browser.mode", BROWSER_MODES.includes(config.browser.mode), `must be one of ${BROWSER_MODES.join(", ")}`);
    c.int("config.browser.expectMajor", config.browser.expectMajor, 1);
    c.ok("config.browser.reducedMotion", ["reduce", "no-preference"].includes(config.browser.reducedMotion), "must be reduce or no-preference");
  }
  if (c.object("config.trial", config.trial)) {
    for (const k of ["loadTimeoutMs", "idleQuietMs", "idleTimeoutMs", "pauseMs"]) c.int(`config.trial.${k}`, config.trial[k], 1);
  }

  if (c.object("config.gesture", config.gesture)) {
    const g = config.gesture;
    if (c.object("config.gesture.wheel", g.wheel)) {
      c.int("config.gesture.wheel.in", g.wheel.in, 0);
      c.int("config.gesture.wheel.out", g.wheel.out, 0);
      c.num("config.gesture.wheel.intervalMs", g.wheel.intervalMs, 1);
      c.num("config.gesture.wheel.deltaY", g.wheel.deltaY, 1);
      c.ok("config.gesture.wheel.at", g.wheel.at === "canvas-center", "must be canvas-center");
    }
    if (c.array("config.gesture.drags", g.drags)) {
      g.drags.forEach((d, i) => {
        c.ok(`config.gesture.drags[${i}]`, isObject(d) && isNum(d.dx) && isNum(d.dy) && (d.dx !== 0 || d.dy !== 0), "must be {dx, dy}, not both zero");
      });
    }
    c.int("config.gesture.dragSteps", g.dragSteps, 1);
    c.num("config.gesture.dragStepMs", g.dragStepMs, 1);
  }

  const coreCount = Array.isArray(config.core) ? config.core.length : 0;
  if (c.object("config.protocol", config.protocol)) {
    const p = config.protocol;
    for (const k of ["aaPairs", "screeningPairs", "confirmationPairs", "heavyPairs", "bootstrapResamples"]) c.int(`config.protocol.${k}`, p[k], 1);
    c.ok("config.protocol.alpha", isNum(p.alpha) && p.alpha > 0 && p.alpha < 1, "must be in (0, 1)");
    // The family is the core cases times the two compared metrics (mean draw, mean frame interval); a mismatch would silently change
    // the Bonferroni level the verdict claims.
    c.ok("config.protocol.familySize", p.familySize === coreCount * 2, `must equal core cases x 2 metrics = ${coreCount * 2}`);
    c.ok("config.protocol.floorPercentile", isNum(p.floorPercentile) && p.floorPercentile > 0 && p.floorPercentile <= 1, "must be in (0, 1]");
    c.ok("config.protocol.floorMinMs", isStr(p.floorMinMs), "must say where the minimum comes from");
    c.num("config.protocol.environmentInconclusiveMeanDrawMs", p.environmentInconclusiveMeanDrawMs, Number.MIN_VALUE);
  }
  if (c.object("config.budgets", config.budgets)) {
    for (const k of ["p95DrawMs", "p95FrameMs", "gestureIntervalOver33_3MsMaxShare", "p95InputToPaintMs", "drawOverMs", "frameOverMs"]) c.num(`config.budgets.${k}`, config.budgets[k], Number.MIN_VALUE);
  }

  caseList(c, "config.core", config.core, { heavy: false });
  caseList(c, "config.heavy", config.heavy, { heavy: true });

  if (config.smoke !== undefined && c.object("config.smoke", config.smoke)) {
    const s = config.smoke;
    for (const k of ["aaPairs", "screeningPairs", "confirmationPairs", "heavyPairs", "bootstrapResamples"]) c.int(`config.smoke.${k}`, s[k], 1);
    const coreIds = new Set((config.core ?? []).map((x) => x?.id));
    const heavyIds = new Set((config.heavy ?? []).map((x) => x?.id));
    c.ok("config.smoke.coreIds", Array.isArray(s.coreIds) && s.coreIds.length > 0 && s.coreIds.every((id) => coreIds.has(id)), "must list ids of config.core");
    c.ok("config.smoke.heavyIds", Array.isArray(s.heavyIds) && s.heavyIds.every((id) => heavyIds.has(id)), "must list ids of config.heavy");
    if (s.gesture !== undefined && c.object("config.smoke.gesture", s.gesture)) {
      c.int("config.smoke.gesture.wheelIn", s.gesture.wheelIn, 0);
      c.int("config.smoke.gesture.wheelOut", s.gesture.wheelOut, 0);
      c.int("config.smoke.gesture.drags", s.gesture.drags, 0);
    }
  }
  return c.errors;
}

const SAMPLE_ARMS = ["A", "B"];

function sample(c, at, s, caseIds) {
  if (!c.object(at, s)) return;
  c.ok(`${at}.phase`, PHASES.includes(s.phase), `must be one of ${PHASES.join(", ")}`);
  c.ok(`${at}.vs`, s.vs === null || ["original", "preceding"].includes(s.vs), "must be null, original or preceding");
  c.ok(`${at}.vs`, (s.phase === "aa") === (s.vs === null), "is null exactly in the A/A phase");
  c.int(`${at}.pair`, s.pair, 0);
  c.ok(`${at}.order`, s.order === 1 || s.order === 2, "must be 1 or 2 (position within the pair)");
  c.ok(`${at}.arm`, SAMPLE_ARMS.includes(s.arm), "must be A or B");
  c.str(`${at}.build`, s.build);
  c.ok(`${at}.case`, caseIds.has(s.case), "must be a case id of the protocol");
  c.ok(`${at}.run`, s.run === "cold" || s.run === "steady", "must be cold or steady");
  c.numbers(`${at}.draws`, s.draws);
  c.numbers(`${at}.frameIntervals`, s.frameIntervals);
  c.numbers(`${at}.inputToPaint`, s.inputToPaint);
  c.int(`${at}.unpainted`, s.unpainted, 0);
  if (c.object(`${at}.reads`, s.reads)) c.ok(`${at}.reads`, Object.values(s.reads).every((n) => isInt(n) && n >= 0), "must map routes to counts");
  c.ok(`${at}.fits`, s.fits === null || (isInt(s.fits) && s.fits >= 0), "must be null (baseline) or a count");
  c.int(`${at}.errors`, s.errors, 0);
  c.int(`${at}.unexpected`, s.unexpected, 0);
}

function analysis(c, a, protocolCases) {
  if (!c.object("report.analysis", a)) return;
  c.int("report.analysis.familySize", a.familySize, 1);
  c.num("report.analysis.tailProbability", a.tailProbability, Number.MIN_VALUE);
  c.num("report.analysis.level", a.level, 0);
  if (c.object("report.analysis.floors", a.floors)) {
    for (const id of protocolCases.core) {
      const f = a.floors[id];
      c.ok(`report.analysis.floors.${id}`, isObject(f) && isNum(f.meanDrawMs) && isNum(f.meanFrameIntervalMs), "must hold meanDrawMs and meanFrameIntervalMs");
    }
  }
  if (c.object("report.analysis.environment", a.environment)) {
    const e = a.environment;
    c.ok("report.analysis.environment.gate", isObject(e.gate) && typeof e.gate.ok === "boolean" && isNum(e.gate.limitMs) && Array.isArray(e.gate.offending), "must be {ok, limitMs, offending}");
    c.ok("report.analysis.environment.forced", typeof e.forced === "boolean", "must be a boolean");
    c.num("report.analysis.environment.timerResolutionMs", e.timerResolutionMs, Number.MIN_VALUE);
  }
  if (c.array("report.analysis.comparisons", a.comparisons)) {
    a.comparisons.forEach((cmp, i) => {
      const at = `report.analysis.comparisons[${i}]`;
      if (!c.object(at, cmp)) return;
      c.ok(`${at}.vs`, ["original", "preceding"].includes(cmp.vs), "must be original or preceding");
      c.ok(`${at}.verdict`, VERDICT_NAMES.includes(cmp.verdict) && cmp.verdict !== "environment-inconclusive" && cmp.verdict !== "smoke", "must be an A/B verdict");
      c.ok(`${at}.screening`, isObject(cmp.screening) && Array.isArray(cmp.screening.cells) && typeof cmp.screening.signal === "boolean", "must be {cells, signal}");
      if (cmp.confirmation !== null) {
        if (c.object(`${at}.confirmation`, cmp.confirmation)) {
          c.ok(`${at}.confirmation.intervals`, Array.isArray(cmp.confirmation.intervals) && cmp.confirmation.intervals.every((x) => isObject(x) && isNum(x.lower) && isNum(x.upper) && isNum(x.floor) && VERDICT_NAMES.includes(x.verdict)), "must list {lower, upper, floor, verdict}");
        }
      }
      c.array(`${at}.budgets`, cmp.budgets);
      c.array(`${at}.heavy`, cmp.heavy);
      c.array(`${at}.cold`, cmp.cold);
    });
  }
  c.array("report.analysis.assumptions", a.assumptions);
  c.ok("report.analysis.verdict", VERDICT_NAMES.includes(a.verdict), `must be one of ${VERDICT_NAMES.join(", ")}`);
  c.ok("report.analysis.abVerdict", a.abVerdict === null || VERDICT_NAMES.includes(a.abVerdict), "must be null or a verdict");
}

// validateReport(report) -> string[]
export function validateReport(report) {
  const c = checker();
  if (!c.object("report", report)) return c.errors;
  c.ok("report.schemaVersion", report.schemaVersion === SCHEMA_VERSION, `must be ${SCHEMA_VERSION}`);
  c.ok("report.kind", report.kind === REPORT_KIND, `must be ${REPORT_KIND}`);
  c.ok("report.createdAtUtc", isIso(report.createdAtUtc), "must be an ISO UTC time");
  c.str("report.label", report.label);
  c.ok("report.smoke", typeof report.smoke === "boolean", "must be a boolean");

  if (c.object("report.config", report.config)) {
    c.str("report.config.path", report.config.path);
    c.ok("report.config.sha256", isSha256(report.config.sha256), "must be a sha-256 hex digest");
    c.int("report.config.seed", report.config.seed, 0);
  }

  if (c.object("report.environment", report.environment)) {
    const e = report.environment;
    for (const k of ["os", "cpuModel", "node", "playwright", "nonDesignatedNotice"]) c.str(`report.environment.${k}`, e[k]);
    c.int("report.environment.cores", e.cores, 1);
    c.num("report.environment.memoryGb", e.memoryGb, 0);
    if (c.object("report.environment.browser", e.browser)) {
      c.str("report.environment.browser.name", e.browser.name);
      c.str("report.environment.browser.version", e.browser.version);
      c.int("report.environment.browser.major", e.browser.major, 1);
      c.ok("report.environment.browser.mode", BROWSER_MODES.includes(e.browser.mode), `must be one of ${BROWSER_MODES.join(", ")}`);
      c.ok("report.environment.browser.args", Array.isArray(e.browser.args) && e.browser.args.every((a) => typeof a === "string"), "must be a list of strings");
    }
    c.num("report.environment.dpr", e.dpr, 0.5);
    if (c.object("report.environment.viewport", e.viewport)) {
      c.int("report.environment.viewport.width", e.viewport.width, 1);
      c.int("report.environment.viewport.height", e.viewport.height, 1);
    }
    c.ok("report.environment.reducedMotion", ["reduce", "no-preference"].includes(e.reducedMotion), "must be reduce or no-preference");
    c.num("report.environment.timerResolutionMs", e.timerResolutionMs, Number.MIN_VALUE);
    c.ok("report.environment.ci", typeof e.ci === "boolean", "must be a boolean");
    c.ok("report.environment.designated", e.designated === null || isStr(e.designated), "must be null or the operator's name for the machine");
    c.ok("report.environment.cpuThrottle", e.cpuThrottle === null || (isNum(e.cpuThrottle) && e.cpuThrottle >= 1), "must be null or a rate >= 1");
    c.ok("report.environment.nonDesignatedNotice", e.nonDesignatedNotice === NOT_DESIGNATED, "must be the fixed notice");
  }

  if (c.object("report.roles", report.roles)) for (const k of ["original", "preceding", "candidate"]) c.ok(`report.roles.${k}`, isSha(report.roles[k]), "must be a 40-character commit id");
  if (c.array("report.builds", report.builds)) {
    c.ok("report.builds", report.builds.length >= 1, "must list at least one build");
    report.builds.forEach((b, i) => {
      const at = `report.builds[${i}]`;
      if (!c.object(at, b)) return;
      c.str(`${at}.label`, b.label);
      c.ok(`${at}.sha`, isSha(b.sha), "must be a 40-character commit id");
      c.ok(`${at}.indexSha256`, isSha256(b.indexSha256), "must be a sha-256 hex digest");
      c.ok(`${at}.vendorSha256`, isSha256(b.vendorSha256), "must be a sha-256 hex digest");
      c.ok(`${at}.protocol`, b.protocol === 2, "must be the bridge protocol number 2");
    });
  }
  if (c.object("report.data", report.data)) {
    c.str("report.data.profile", report.data.profile);
    c.int("report.data.seed", report.data.seed, 0);
    c.str("report.data.packToken", report.data.packToken);
    c.ok("report.data.cutoff", isIso(report.data.cutoff), "must be an ISO UTC time");
  }

  const cases = { core: [], heavy: [] };
  if (c.object("report.protocol", report.protocol)) {
    const p = report.protocol;
    for (const k of ["aaPairs", "screeningPairs", "confirmationPairs", "heavyPairs", "bootstrapResamples", "familySize"]) c.int(`report.protocol.${k}`, p[k], 1);
    c.ok("report.protocol.alpha", isNum(p.alpha) && p.alpha > 0 && p.alpha < 1, "must be in (0, 1)");
    c.ok("report.protocol.coreIds", Array.isArray(p.coreIds) && p.coreIds.length > 0 && p.coreIds.every(isStr), "must list the core case ids");
    c.ok("report.protocol.heavyIds", Array.isArray(p.heavyIds) && p.heavyIds.every(isStr), "must list the heavy case ids");
    if (Array.isArray(p.coreIds)) cases.core = p.coreIds;
    if (Array.isArray(p.heavyIds)) cases.heavy = p.heavyIds;
    c.ok("report.protocol.familySize", p.familySize === cases.core.length * 2, "must equal core cases x 2 metrics");
  }
  c.object("report.budgets", report.budgets);

  if (c.object("report.phases", report.phases)) {
    for (const phase of PHASES) {
      const at = `report.phases.${phase}`;
      if (!c.object(at, report.phases[phase])) continue;
      c.ok(`${at}.ran`, typeof report.phases[phase].ran === "boolean", "must be a boolean");
      c.int(`${at}.pairs`, report.phases[phase].pairs, 0);
    }
  }

  const caseIds = new Set([...cases.core, ...cases.heavy]);
  if (c.array("report.samples", report.samples)) {
    report.samples.forEach((s, i) => sample(c, `report.samples[${i}]`, s, caseIds));
  }
  analysis(c, report.analysis, cases);

  c.ok("report.verdict", VERDICT_NAMES.includes(report.verdict), `must be one of ${VERDICT_NAMES.join(", ")}`);
  c.ok("report.verdict", report.analysis?.verdict === report.verdict, "must equal analysis.verdict");
  c.ok("report.verdict", (report.verdict === "smoke") === (report.smoke === true), "is smoke exactly for a smoke run");
  c.ok("report.forcedInconclusive", typeof report.forcedInconclusive === "boolean", "must be a boolean");
  c.str("report.statement", report.statement);
  c.ok("report.limits", Array.isArray(report.limits) && report.limits.length > 0 && report.limits.every(isStr), "must list the limits of this evidence");
  c.ok("report.warnings", Array.isArray(report.warnings) && report.warnings.every(isStr), "must be a list of strings");
  return c.errors;
}
