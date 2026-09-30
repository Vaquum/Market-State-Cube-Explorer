#!/usr/bin/env python3
"""Cross-check the committed wire vectors against the REAL tools/cube_bridge.py (numpy job, TESTPLAN 4.6, DD-T10).

The Node fake cube duplicates about five hundred lines of the bridge. This script is the drift alarm: it imports the bridge
(safe without pyarrow: market_state_reader imports pyarrow lazily and the bridge imports numpy inside its functions), builds
the same cells as numpy arrays, and compares what the bridge produces with tests/fixtures/wire/vectors.json and
tests/fixtures/wire/tails-vectors.json, which tests/reference/wire_golden.py wrote from an independent standard-library
implementation:

    msc2 (MSC2, MSC3, delta tails)   decompressed payload bytes
    mscb                             decompressed payload bytes
    columns + the MSCC header        the history payload (Explorer.history builds the header inline, replicated here)
    block                            col0, col1, start, end, layout, encoding
    edge                             the ISO strings
    tails                            delta or pack, `from`, the new block's col0 and col1, and the tail payload of every tier

    python3 tests/reference/bridge_crosscheck.py --require-numpy    CI: a missing numpy is a failure
    python3 tests/reference/bridge_crosscheck.py                    locally without numpy: prints a skip and exits 0

Any change to the bridge's protocol behaviour must update the fake, the vectors and the plan in the same PR (drift rule).
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WIRE = ROOT / "tests" / "fixtures" / "wire"


def num(value):
    return float("nan") if value == "NaN" else value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--require-numpy", action="store_true", help="fail instead of skipping when numpy is missing")
    arguments = parser.parse_args()
    try:
        import numpy as np
    except ImportError:
        if arguments.require_numpy:
            print("numpy is required (pip install numpy==2.4.6, the Dockerfile pin) and is not installed", file=sys.stderr)
            return 1
        print("skip: numpy is not installed; this cross-check runs in the CI job `bridge`")
        return 0
    sys.path.insert(0, str(ROOT / "tools"))
    import cube_bridge as bridge

    vectors = json.loads((WIRE / "vectors.json").read_text(encoding="utf-8"))
    tails = json.loads((WIRE / "tails-vectors.json").read_text(encoding="utf-8"))
    failures: list[str] = []
    checks = 0

    def check(ok: bool, what: str) -> None:
        nonlocal checks
        checks += 1
        if not ok:
            failures.append(what)

    def payload_of(text: str) -> bytes:
        return gzip.decompress(base64.b64decode(text))

    def arrays(cells: dict, keys: tuple[str, ...], first: int = 0) -> dict:
        kinds = {"col": "<u4", "row": "<u4", "poc": "<u4"}
        return {key: np.array([num(v) for v in cells[key]], dtype=kinds.get(key, "<f8")) for key in keys}

    for case in vectors["payloads"]:
        name, magic = case["name"], case["magic"]
        cells = case["cells"]
        if magic in ("MSC2", "MSC3"):
            motion = magic == "MSC3"
            keys = bridge.MOTION_FIELDS if motion else bridge.FIELDS
            got = payload_of(bridge.msc2(case["n"], case["m"], case["col0"], case["col1"], arrays(cells, keys), case["first"], motion))
            check(got.hex() == case["payloadHex"], f"msc2 {name}: payload differs from the vector")
        elif magic == "MSCB":
            keys = tuple(key for key, _ in bridge.BAR_FIELDS) + ("col",)
            got = payload_of(bridge.mscb(case["n"], case["col0"], case["col1"], arrays(cells, keys)))
            check(got.hex() == case["payloadHex"], f"mscb {name}: payload differs from the vector")
        elif magic == "MSCC":
            source = arrays(case["columnsSource"], ("vol", "tbvol", "col", "row"))
            cols = bridge.columns(source)
            expected = arrays(cells, ("col", "poc", "vol", "tbvol"))
            expected["vol"] = expected["vol"].astype("<f4")
            expected["tbvol"] = expected["tbvol"].astype("<f4")
            for key in ("col", "poc", "vol", "tbvol"):
                check(np.array_equal(cols[key], expected[key]), f"columns {name}: {key} differs ({cols[key]} vs {expected[key]})")
            # Explorer.history writes this header and these arrays inline; replicated because it is not a function.
            header = struct.pack("<4sBBHIII12x", b"MSCC", case["n"], case["m"], 0, case["col0"], case["col1"], len(cols["col"]))
            body = header + b"".join(cols[key].tobytes() for key in ("col", "poc", "vol", "tbvol"))
            check(body.hex() == case["payloadHex"], f"mscc {name}: payload differs from the vector")

    for case in vectors["blocks"]:
        empty = {key: np.zeros(0, "<u4" if key in ("col", "row") else "<f8") for key in bridge.FIELDS}
        meta = bridge.block(case["n"], case["m"], case["b0"], case["b1"], empty)
        for key in ("col0", "col1", "start", "end"):
            check(meta[key] == case[key], f"block {case['n']},{case['m']},{case['b0']}: {key} {meta[key]} != {case[key]}")
        check(meta["layout"] == "MSC2" and meta["encoding"] == "gzip+base64" and meta["count"] == 0, "block: layout, encoding, count")

    for case in vectors["isos"]:
        check(bridge.edge(case["base"]) == case["iso"], f"edge({case['base']}) = {bridge.edge(case['base'])} != {case['iso']}")

    tier_levels = {t["id"]: (t["n"], t["m"]) for t in tails["tiers"]}

    def held(pack: dict) -> dict:
        tiers = {}
        for tier, data in pack["tiers"].items():
            rows = data["cells"]
            n, m = tier_levels[tier]
            tiers[tier] = {
                "block": {"n": n, "m": m, "b0": 0.0, "b1": data["b1"], "col0": data.get("col0", 0), "col1": data.get("col1", 0), "count": len(rows), "encoding": "gzip+base64", "layout": "MSC2"},
                "cells": {
                    "vol": np.array([r[2] for r in rows], "<f8"), "tbvol": np.array([r[3] for r in rows], "<f8"), "cnt": np.array([r[4] for r in rows], "<f8"),
                    "tbcnt": np.array([r[5] for r in rows], "<f8"), "col": np.array([r[0] for r in rows], "<u4"), "row": np.array([r[1] for r in rows], "<u4"),
                },
            }
        return {"pins": pack["pins"], "tiers": tiers}

    for case in tails["cases"]:
        result = bridge.tails(held(case["old"]), held(case["new"]))
        name = case["name"]
        if case["expect"]["kind"] == "pack":
            check(result is None, f"tails {name}: expected a whole pack, the bridge returned a delta")
            continue
        check(result is not None, f"tails {name}: expected a delta, the bridge returned a whole pack")
        if result is None:
            continue
        for tier, want in case["expect"]["tiers"].items():
            block = result[tier]
            check(block["from"] == want["from"], f"tails {name} {tier}: from {block['from']} != {want['from']}")
            check(block["col0"] == want["col0"] and block["col1"] == want["col1"], f"tails {name} {tier}: header columns")
            check(payload_of(block["gzip_base64"]).hex() == want["payloadHex"], f"tails {name} {tier}: tail payload differs")

    if failures:
        print(f"{len(failures)} of {checks} cross-checks failed:", file=sys.stderr)
        for line in failures:
            print(f"  {line}", file=sys.stderr)
        return 1
    print(f"ok: {checks} cross-checks of tools/cube_bridge.py against the wire vectors (numpy {np.__version__})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
