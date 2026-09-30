  // @part 00-header
  // @requires
  // @prefix hdr
  // @provides VERSION LIMITS TIMING THRESHOLDS LATTICE
  // == §00 header: versions, limits and the shared constants ==
  // The only names every later part may use directly (all other cross-part calls go through
  // API.<namespace>.<function>, resolved at call time, so a part never depends on another part's
  // private names): API, VERSION, LIMITS, TIMING, THRESHOLDS, LATTICE.
  const API = {};
  // Every version a persisted or hashed record can carry. `visual` is the DR-14 visualVersion; `mapping`
  // is hashed into every mapping id (bumping it changes every id); `appearance` is the palette version.
  const VERSION = Object.freeze({
    schema: 1,
    visual: 2,
    mapping: 1,
    appearance: 2,
    readout: 1,
    legend: 1,
    codec: 1,
  });
  // Application budgets, enforced on read AND write (D9, DR-14). They are budgets of this application,
  // not browser limits.
  const LIMITS = Object.freeze({
    ADDRESS_MAX: 8192,
    RANK_KNOTS: 257,
    PAYLOAD_MAX_BYTES: 1048576,
    DESCRIPTORS_MAX: 16,
    CONTEXTS_MAX: 64,
    RECORDS_PER_CONTEXT: 8,
    HISTORY_MAX: 50,
    NAMED_VIEWS_MAX: 200,
    STRING_MAX: 256,
    DEPTH_MAX: 8,
    TOMBSTONES_MAX: 64,
    HELD_MAX: 8,
    AXES_MAX: 19,
    MODELS_MAX: 4,
  });
  // Milliseconds. SETTLE_MS and AUTO_MS are D4's 200 ms and 500 ms; RETRY_MS is the safety-net poll a
  // pending calibration request uses while its reads are incoherent (DD-46).
  const TIMING = Object.freeze({
    SETTLE_MS: 200,
    AUTO_MS: 500,
    RETRY_MS: 200,
    PERSIST_DEBOUNCE_MS: 400,
    NOTICE_COALESCE_MS: 5000,
  });
  // Numeric thresholds of D2, D4 and D11. Comparison tolerances, never input rounding.
  const THRESHOLDS = Object.freeze({
    SHORT_EXPOSURE: 0.1,
    WARN_MARKS: 0.1,
    WARN_AREA: 0.25,
    LOW_DISC: 0.9,
    LUT_LOW_MAX: 12,
    LUT_HIGH_MIN: 243,
    TOL_REL: 1e-12,
    TOL_USDT: 1e-12,
    TOL_SECONDS: 1e-9,
    TOL_PATH: 1e-9,
  });
  // The recorded lattice of this cube: base column seconds, base row USDT, and the history origin
  // (2021-01-01T00:00:00Z in epoch seconds). The page passes PACK.base_seconds / base_price / t0.
  const LATTICE = Object.freeze({ BASE: 56.25, PR: 125, T0: 1609459200 });
  API.VERSION = VERSION;
  API.LIMITS = LIMITS;
  API.TIMING = TIMING;
  API.THRESHOLDS = THRESHOLDS;
  API.LATTICE = LATTICE;
