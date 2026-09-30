// tools/benchmark/schedule.mjs (H9): which trial runs when, derived from the committed seed and nothing else.
//
// A PAIR is two trials of one case, arm A then arm B or B then A (each a new browser process). A schedule is the flat list of
// {phase, pair, case, first, vs} entries the orchestrator runs in order. D12 fixes the orders: A/A pairs alternate strictly (pair i
// runs A first when i is even), A/B pairs are randomised in BALANCED order (half and half, so a drift of the machine over the run hits
// both builds equally), drawn from the seed. The cases inside a pair index are also shuffled (seeded), so a slow minute does not
// always land on the same case. Everything is a pure function of (seed, label, counts): two calls give equal lists (U39).
import { mulberry32, shuffle, subSeed } from "./stats.mjs";

// abOrders({pairs, seed, label}): the first-arm choice of each pair, "AB" or "BA", balanced: floor(pairs / 2) of each, and for an odd
// count the extra one goes to the side the seed picks. The order of the list is a seeded shuffle.
export function abOrders({ pairs, seed, label }) {
  if (!Number.isInteger(pairs) || pairs < 1) throw new RangeError(`abOrders: pairs ${pairs} must be a positive integer`);
  const next = mulberry32(subSeed(seed, `orders|${label}`));
  const half = Math.floor(pairs / 2);
  const extra = pairs % 2 ? [next() < 0.5 ? "AB" : "BA"] : [];
  const list = [...Array(half).fill("AB"), ...Array(half).fill("BA"), ...extra];
  return shuffle(next, list);
}

// aaOrders(pairs): strict alternation, AB BA AB BA ...; no randomness, so the A/A noise floor cannot depend on a lucky shuffle.
export function aaOrders(pairs) {
  if (!Number.isInteger(pairs) || pairs < 1) throw new RangeError(`aaOrders: pairs ${pairs} must be a positive integer`);
  return Array.from({ length: pairs }, (_, i) => (i % 2 === 0 ? "AB" : "BA"));
}

// schedule({phase, vs, pairs, caseIds, seed, orders}): entries {phase, vs, pair, case, first} with pair 0..pairs-1, `first` the arm that
// runs first ("A" or "B"), grouped by pair and with the cases of each pair in a seeded order.
export function schedule({ phase, vs = null, pairs, caseIds, seed, orders }) {
  if (orders.length !== pairs) throw new RangeError(`schedule: ${orders.length} orders for ${pairs} pairs`);
  const out = [];
  for (let pair = 0; pair < pairs; pair++) {
    const next = mulberry32(subSeed(seed, `cases|${phase}|${vs}|${pair}`));
    for (const caseId of shuffle(next, caseIds)) out.push({ phase, vs, pair, case: caseId, first: orders[pair][0] });
  }
  return out;
}

export const aaSchedule = ({ pairs, caseIds, seed }) => schedule({ phase: "aa", pairs, caseIds, seed, orders: aaOrders(pairs) });

export const abSchedule = ({ phase, vs, pairs, caseIds, seed }) =>
  schedule({ phase, vs, pairs, caseIds, seed, orders: abOrders({ pairs, seed, label: `${phase}|${vs}` }) });
