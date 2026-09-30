  // @part 06-ratio
  // @requires 01-util 03-result
  // @prefix rat
  // @provides ratio
  // == §06 ratio: Cascade, Efficiency and the fixed log-ratio coordinate (API.md C.1.7, C.5) ==
  // A ratio measure has more ways not to have a value than any other, and D2 names every one. All three
  // ratio families (Cascade, Efficiency, Relative volume) walk the same ladder, so it is written once
  // (classify) and the two kernels here only say what their inputs mean. Nothing here draws or colours:
  // a finite value is a number on a log2 scale, its coordinate on the fixed -2..+2 axis is `coordinate`.

  // The clip codes of API.md C.5, the same small integers E.scale.CLIP names (part 08 is not required here,
  // so they are repeated as literals; U22 and the scale tests pin both tables to the spec).
  const ratClipNone = 0;
  const ratClipLow = 1;
  const ratClipHigh = 2;
  const ratClipExactLow = 3;
  const ratClipExactHigh = 4;
  // The tick spacing a label needs (C.5): 12 px between two kept ticks.
  const ratTickGap = 12;

  // E.ratio.TICKS (C.5, S1-070): the five ticks of the fixed log2 axis and the factor each one means. The
  // labels are the plain reading of the ratio (1/4x ... 4x); the multiplication sign is written as an
  // escape because only part 04-text may hold non-ASCII characters in a string.
  const ratTicks = Object.freeze([
    Object.freeze({ value: -2, label: "1/4\u00d7", factor: 0.25 }),
    Object.freeze({ value: -1, label: "1/2\u00d7", factor: 0.5 }),
    Object.freeze({ value: 0, label: "1\u00d7", factor: 1 }),
    Object.freeze({ value: 1, label: "2\u00d7", factor: 2 }),
    Object.freeze({ value: 2, label: "4\u00d7", factor: 4 }),
  ]);
  // The order in which ticks earn a place when room is short: the two ends (they say the axis is +-2), then
  // the centre (1x, "even"), then the halves. Indexes into ratTicks.
  const ratTickPriority = Object.freeze([0, 4, 2, 1, 3]);

  function ratEmptyPopulation(name, value) {
    return API.result.make("empty-population", { denominator: name, reason: name + " is " + (value === 0 ? "0" : "not positive") });
  }

  // E.ratio.classify (API.md A.3, C.1.7): the generic D2 ladder. Applied strictly in this order, so a
  // reason that comes earlier always wins over arithmetic that comes later:
  //   1. read and coverage status (E.result.precedence): failed > pending > unsupported > hidden > outside
  //   2. structure: "coarsest" -> no-coarser-parent; "open" -> waiting-for-complete-parent (open: true);
  //      "outside" -> unsupported (parent not covered by the block); "unavailable" -> unsupported (only the
  //      live cube can answer). "complete" or absent: carry on.
  //   3. totals [{name, value}, ...]: the first that is not positive -> empty-population naming it; a
  //      non-finite one -> invalid-input
  //   4. ordinary [{name, value}, ...]: a denominator that is not positive -> undefined naming it
  //   5. current and reference (non-negative amounts or shares), when both are given:
  //        both 0 -> empty-both; current 0 -> negative-infinite; reference 0 -> no-reference;
  //        else finite log2(current / reference [/ divisor])
  // Returns null when the ladder passes and no current/reference pair was given ("carry on"). Inputs:
  // {read, hidden, outside, structure, reason, totals, ordinary, current, reference, divisor}.
  function ratClassify(input) {
    const pre = API.result.precedence(input);
    if (pre !== null) return pre;
    const structure = input.structure;
    if (structure === "coarsest") return API.result.make("no-coarser-parent");
    if (structure === "open") return API.result.make("waiting-for-complete-parent", { open: true });
    if (structure === "outside") return API.result.make("unsupported", { reason: input.reason || "parent not covered by block" });
    if (structure === "unavailable") return API.result.make("unsupported", { reason: input.reason || "live cube only" });
    if (structure !== undefined && structure !== null && structure !== "complete") throw new RangeError("unknown ratio structure " + JSON.stringify(structure));
    const totals = input.totals;
    if (totals) {
      for (let i = 0; i < totals.length; i++) {
        const x = totals[i].value;
        if (!Number.isFinite(x)) return API.result.make("invalid-input", { reason: "non-finite" });
        if (!(x > 0)) return ratEmptyPopulation(totals[i].name, x);
      }
    }
    const ordinary = input.ordinary;
    if (ordinary) {
      for (let i = 0; i < ordinary.length; i++) {
        const x = ordinary[i].value;
        if (!Number.isFinite(x)) return API.result.make("invalid-input", { reason: "non-finite" });
        if (!(x > 0)) return API.result.make("undefined", { denominator: ordinary[i].name });
      }
    }
    const cur = input.current;
    const ref = input.reference;
    if (cur === undefined || ref === undefined) return null;
    if (!Number.isFinite(cur) || !Number.isFinite(ref) || cur < 0 || ref < 0) return API.result.make("invalid-input", { reason: "non-finite" });
    if (cur === 0 && ref === 0) return API.result.make("empty-both");
    if (cur === 0) return API.result.make("negative-infinite");
    if (ref === 0) return API.result.make("no-reference");
    let q = cur / ref;
    if (input.divisor !== undefined) q = q / input.divisor;
    return API.result.finite(Math.log2(q));
  }

  // E.ratio.cascade (API.md C.1.7, DD-38): a cell's (factor 4) or a column's (factor 2) share of its parent,
  // as log2(factor * child / parent): +2 exactly when the cell IS its whole parent, 0 at an even quarter, and
  // +1 for a column that is its whole parent column. `structure` is decided BEFORE the child is looked at, so
  // a child absent from an incomplete parent reads "waiting", not "no value here" as the baseline said:
  //   coarsest -> no-coarser-parent, open -> waiting-for-complete-parent, outside -> unsupported (the block
  //   does not hold the whole parent), complete -> parent volume 0 -> empty-population, child volume 0 or
  //   absent -> negative-infinite (a real, readout-only state: the parent traded and this child did not),
  //   otherwise finite. The unrounded ratio is returned; only its drawing coordinate is ever clipped.
  function ratCascade(input) {
    const factor = input.factor;
    if (typeof factor !== "number" || !(factor > 0) || !Number.isFinite(factor)) throw new RangeError("cascade needs a positive factor (4 for cells, 2 for columns)");
    const child = input.childV;
    // A present but non-finite child is a validation failure; an absent one is a child that did not trade.
    if (typeof child === "number" && !Number.isFinite(child)) return API.result.make("invalid-input", { reason: "non-finite" });
    return ratClassify({
      read: input.read,
      hidden: input.hidden,
      outside: input.outside,
      structure: input.structure,
      totals: [{ name: "parent volume", value: input.parentV }],
      current: child > 0 ? factor * child : 0,
      reference: input.parentV,
    });
  }

  // E.ratio.efficiency (API.md C.1.7, C.14): log2((child.v / child.rows) / (parent.v / parent.rows) / baseline),
  // the USDT per touched row of a column against its parent's, relative to what the model expects
  // (baseline = 2**(ISO_B - 1), E.model.PROVENANCE.baseline; passed in by the caller so this part does not
  // depend on part 18, with that record as the fallback). Read status comes first (a failed or pending
  // touched-row read passes through), then structure (coarsest, open, unavailable), then the four counts in
  // the order child volume, child touched rows, parent volume, parent touched rows: a zero of any of them is
  // empty-population naming it, never negative-infinite (v / rows is undefined at 0 / 0). The value is
  // unclamped: beyond +-2 it is finite and only the coordinate is clipped.
  function ratEfficiency(input) {
    let baseline = input.baseline;
    if (baseline === undefined && API.model && API.model.PROVENANCE) baseline = API.model.PROVENANCE.baseline;
    if (typeof baseline !== "number" || !(baseline > 0) || !Number.isFinite(baseline)) throw new TypeError("efficiency needs a positive finite baseline");
    const child = input.child || {};
    const parent = input.parent || {};
    return ratClassify({
      read: input.read,
      hidden: input.hidden,
      outside: input.outside,
      structure: input.structure,
      totals: [
        { name: "child volume", value: child.v },
        { name: "child touched rows", value: child.rows },
        { name: "parent volume", value: parent.v },
        { name: "parent touched rows", value: parent.rows },
      ],
      current: child.v / child.rows,
      reference: parent.v / parent.rows,
      divisor: baseline,
    });
  }

  // E.ratio.coordinate (API.md C.5, S1-070/S1-071): a raw value on the fixed axis [lo, hi] as {t, clip}. Only
  // the DRAWING coordinate is clipped; the raw value is kept by the caller for the readout. A finite value
  // beyond an end is clipped to t 0 or 1 and coded LOW or HIGH (the finite underflow / overflow triangles);
  // exactly an end is t 0 or 1 and coded EXACT_LOW or EXACT_HIGH (an endpoint is a real value, not an
  // overflow: exact +2 is not "outside range"); infinities are clipped like any overflow but callers keep
  // negative-infinite as its own typed case and never ask. A NaN has no coordinate: it throws.
  function ratCoordinate(value, lo, hi) {
    if (value !== value) throw new TypeError("coordinate needs a number, not NaN");
    if (!(lo < hi)) throw new RangeError("coordinate needs lo < hi");
    if (value < lo) return { t: 0, clip: ratClipLow };
    if (value > hi) return { t: 1, clip: ratClipHigh };
    if (value === lo) return { t: 0, clip: ratClipExactLow };
    if (value === hi) return { t: 1, clip: ratClipExactHigh };
    return { t: (value - lo) / (hi - lo), clip: ratClipNone };
  }

  // E.ratio.ratioTicks (API.md C.5): which of the five ticks fit a ratio axis whose full -2..+2 span is
  // `room` px long, with at least 12 px between any two labels. Ends first, then the centre, then the
  // halves (pane heights are 36 to 120 px and the type is 11 px at least); the full set always stays in the
  // legend details. Returned in ascending value order. A room that is not a positive number keeps none.
  function ratRatioTicks(room) {
    const kept = [];
    if (!(room > 0) || !Number.isFinite(room)) return kept;
    const at = (tick) => ((tick.value + 2) / 4) * room;
    for (const i of ratTickPriority) {
      const px = at(ratTicks[i]);
      let fits = true;
      for (const other of kept) if (Math.abs(at(other) - px) < ratTickGap) fits = false;
      if (fits) kept.push(ratTicks[i]);
    }
    return kept.sort((a, b) => a.value - b.value);
  }

  API.ratio = Object.freeze({
    cascade: ratCascade,
    efficiency: ratEfficiency,
    coordinate: ratCoordinate,
    TICKS: ratTicks,
    ratioTicks: ratRatioTicks,
    classify: ratClassify,
  });
