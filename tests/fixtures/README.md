# Test fixtures

Every top-level directory here holds one kind of fixture and carries its own `provenance.json`. A fixture without a stated origin is not evidence, so the unit test `tests/unit/repo.test.js` refuses one. Directories under `regressions/` each carry their own `provenance.json` instead of `regressions/` itself.

## `provenance.json`

```json
{
  "kind": "synthetic",
  "expectationSource": "hand-computed",
  "generator": "tests/support/trades.js",
  "seed": 20260930,
  "source": "what the data is and how it was made, in words",
  "extractedOn": "2026-09-30",
  "notes": "how the expected values were derived"
}
```

| Field | Values |
|---|---|
| `kind` | `recorded`, `synthetic`, `grammar-derived`, `published`, `hand-computed` |
| `expectationSource` | where the EXPECTED values come from: `hand-computed`, `reference-calculator`, `python-stdlib`, `baseline-8c82ca1`, `published-table` (and `self-pin`, see below) |
| `generator` | path of the script that wrote the file, or `null` |
| `seed` | the seed of a seeded generator (`tests/support/rng.js`), or `null` |
| `source` | non-empty text |
| `extractedOn` | `YYYY-MM-DD` when the file was recorded or generated, or `null` |
| `notes` | text; for hand-computed values, the derivation |

## Rules

- **Independent expectations.** An expected value never comes from the code under test or from the fake cube's own store. `expectationSource: "generator"` is refused. The single exception is `self-pin`, allowed only under `tests/fixtures/profiles/`: it pins that a generated profile is stable and is never used as an expected value elsewhere.
- **Synthetic data says so.** A synthetic trade stream is labelled `kind: "synthetic"` and is never described as market history. Recorded data says where and when it was recorded.
- **Deterministic generation.** Generators take a seed and use `tests/support/rng.js` (mulberry32), never `Math.random()`.
- **Size.** All fixtures together stay under 5 MiB. Large data is generated from a seed instead of committed.
- **Regressions.** A reproducible failure found later goes to `regressions/<id>/` with its own `provenance.json`, the smallest input that shows it, and the expected result derived independently.
