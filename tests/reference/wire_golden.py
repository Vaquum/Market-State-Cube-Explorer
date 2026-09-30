#!/usr/bin/env python3
"""Golden vectors for the bridge's wire format and its tails() rule (H2, TESTPLAN 4.6).

Standard library only. It re-implements, from the layout table in tools/cube_bridge.py's docstring and
from its msc2, mscb, block, history and tails functions, the byte layout of MSC2, MSC3, MSCB and MSCC and
the decision between a delta and a whole pack, and writes them as JSON that the Node tests
(tests/unit/wire.test.js, tests/unit/tails.test.js) read:

    tests/fixtures/wire/vectors.json        payloads (decompressed, hex), block meta, ISO strings, columns
    tests/fixtures/wire/tails-vectors.json  old and new packs with the hand-stated outcome and the expected tail payloads

    python3 tests/reference/wire_golden.py --write    write both files
    python3 tests/reference/wire_golden.py --check    regenerate in memory and compare bytes (exit 1 on a difference)

Only DECOMPRESSED payloads are stored: gzip bytes depend on the zlib version and (for Python) on the current
time, so they are not comparable. NaN is the string "NaN" in the JSON. Both files are written with sorted keys
and fixed indentation, so a --check that differs is a real change.

What the expectations are: the layouts follow the docstring of tools/cube_bridge.py; every tails case carries
the outcome (`delta` or `pack`) written by hand next to the data, and this script also runs its own
plain-Python version of the rule over every case and refuses to write when the two disagree. The numpy job
`bridge_crosscheck.py --require-numpy` compares the vectors with the real tools/cube_bridge.py.
This file imports nothing from tools/ or tests/support/.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "wire"

T0 = 1609459200
BASE_SECONDS = 56.25
VOLUME_ROUNDING = 1e-12
NAN = float("nan")
HEADER = "<4sBBHIII12x"  # magic n m pad col0 col1 count, 12 zero bytes: 32 bytes

MSC2 = [("vol", "d"), ("tbvol", "d"), ("cnt", "d"), ("tbcnt", "d"), ("col", "I"), ("row", "I")]
MSC3 = [("vol", "d"), ("tbvol", "d"), ("cnt", "d"), ("tbcnt", "d"), ("path", "d"), ("dwell", "d"), ("high", "d"), ("low", "d"), ("col", "I"), ("row", "I")]
MSCB = [("open", "d"), ("high", "d"), ("low", "d"), ("close", "d"), ("vol", "d"), ("tbvol", "d"), ("btc", "d"), ("cnt", "d"), ("col", "I")]
MSCC = [("col", "I"), ("poc", "I"), ("vol", "f"), ("tbvol", "f")]
TIERS = (("overview", 12, 3), ("recent", 0, 0), ("reference", 4, 0))


def edge(base: float) -> str:
    return datetime.fromtimestamp(T0 + base * BASE_SECONDS, UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def payload(magic: str, n: int, m: int, col0: int, col1: int, layout: list, cells: dict, first: int = 0) -> bytes:
    """The uncompressed payload of `cells` from index `first` on."""
    count = len(cells["col"]) - first
    out = struct.pack(HEADER, magic.encode(), n, m, 0, col0, col1, count)
    for key, code in layout:
        out += struct.pack(f"<{count}{code}", *cells[key][first:])
    assert len(out) == 32 + sum(struct.calcsize(code) * count for _, code in layout)
    return out


def js(value):
    """A JSON-safe copy: NaN travels as the string "NaN"."""
    if isinstance(value, float) and math.isnan(value):
        return "NaN"
    if isinstance(value, dict):
        return {key: js(v) for key, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [js(v) for v in value]
    return value


def f32(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", x))[0]


# ---------------------------------------------------------------- wire vectors


def wire_vectors() -> dict:
    msc2_cells = {
        "col": [200000, 200000, 200001, 200003, 200003], "row": [608, 609, 608, 700, 701],
        "vol": [1234.5, 0.1, 3.5, 26800000.25, 1e-9], "tbvol": [600.25, 0.05, 1.5, 13400000.125, 5e-10],
        "cnt": [12.0, 1.0, 2.0, 18297.0, 4503599627370496.0], "tbcnt": [5.0, 0.0, 1.0, 9000.0, 2.0],
    }
    msc3_cells = {
        "col": [10, 11, 12], "row": [5, 5, 6],
        "vol": [10.0, 0.0, 0.0], "tbvol": [4.0, 0.0, 0.0], "cnt": [3.0, 0.0, 0.0], "tbcnt": [1.0, 0.0, 0.0],
        "path": [12.5, 3.75, 0.0], "dwell": [40.25, 56.25, 12.5], "high": [25012.5, NAN, NAN], "low": [24990.0, NAN, NAN],
    }
    mscb_bars = {
        "col": [6277, 6278], "open": [25000.0, 25010.5], "high": [25100.0, 25020.0], "low": [24950.5, 24990.25], "close": [25010.5, 25001.0],
        "vol": [1.5e8, 2.25e8], "tbvol": [7.5e7, 1.0e8], "btc": [6000.125, 8999.5], "cnt": [123456.0, 98765.0],
    }
    mscc_cells = {
        "col": [200000, 200000, 200000, 200001, 200001, 200003], "row": [608, 609, 610, 608, 609, 700],
        "vol": [5.0, 5.0, 0.1, 0.1, 0.2, 16777217.0], "tbvol": [1.0, 2.0, 0.1, 0.1, 0.2, 0.3],
    }
    # A column's POC is its row of most volume, the LOWER row on a tie; its volumes are summed in f64 and stored as f32.
    columns = {"col": [], "poc": [], "vol": [], "tbvol": []}
    i = 0
    while i < len(mscc_cells["col"]):
        c = mscc_cells["col"][i]
        j = i
        while j < len(mscc_cells["col"]) and mscc_cells["col"][j] == c:
            j += 1
        best = max(range(i, j), key=lambda k: (mscc_cells["vol"][k], -k))
        columns["col"].append(c)
        columns["poc"].append(mscc_cells["row"][best])
        columns["vol"].append(f32(sum(mscc_cells["vol"][i:j])))
        columns["tbvol"].append(f32(sum(mscc_cells["tbvol"][i:j])))
        i = j

    def case(name, magic, n, m, col0, col1, layout, cells, first=0, note=""):
        raw = payload(magic, n, m, col0, col1, layout, cells, first)
        return {
            "name": name, "note": note, "magic": magic, "n": n, "m": m, "col0": col0, "col1": col1, "first": first,
            "count": len(cells["col"]) - first, "cells": js(cells), "payloadHex": raw.hex(),
        }

    payloads = [
        case("msc2-plain", "MSC2", 4, 0, 200000, 200004, MSC2, msc2_cells, note="two columns of two cells, one of one, counts up to 2**52, tiny volumes"),
        case("msc2-tail", "MSC2", 4, 0, 200000, 200004, MSC2, msc2_cells, first=3, note="a delta tail: the last two cells; the header count is the tail's"),
        case("msc2-empty", "MSC2", 0, 0, 0, 0, MSC2, {k: [] for k, _ in MSC2}, note="no cells"),
        case("msc2-u32-limits", "MSC2", 24, 12, 4294967290, 4294967295, MSC2, {
            "col": [4294967294], "row": [4294967295], "vol": [1.0], "tbvol": [0.5], "cnt": [1.0], "tbcnt": [1.0]}, note="the largest unsigned 32-bit column and row"),
        case("msc3-nan", "MSC3", 0, 0, 10, 13, MSC3, msc3_cells, note="a traded cell, a movement-only cell (NaN high and low) and a dwell-only cell"),
        case("mscb-two-bars", "MSCB", 9, 20, 6277, 6279, MSCB, mscb_bars, note="header m is 20; one bar per column with trades"),
        case("mscc-columns", "MSCC", 4, 0, 200000, 200004, MSCC, columns, note="f32 volumes; columns derived from `columnsSource`"),
    ]
    payloads[-1]["columnsSource"] = js(mscc_cells)

    blocks = []
    for n, m, b0, b1 in ((0, 0, 3203331.0, 3214083.0), (4, 0, 3168000.0, 3214080.0), (12, 3, 0.0, 3214082.1333333333), (12, 3, 4096.0, 8192.0), (9, 0, 3.5, 1000.25)):
        blocks.append({
            "n": n, "m": m, "b0": b0, "b1": b1, "col0": int(b0 // 2**n), "col1": int(-(-b1 // 2**n)), "start": edge(b0), "end": edge(b1),
        })

    isos = [{"base": b, "iso": edge(b)} for b in (0.0, 1.0, 3203331.0, 3214080.0, 3214083.0, 3214082.1333333333, 1536.5)]
    return {"schema": 1, "header": "<4sBBHIII12x", "payloads": payloads, "blocks": blocks, "isos": isos}


# ---------------------------------------------------------------- tails vectors


def cells_of(rows: list) -> dict:
    """Rows [col, row, vol, tbvol, cnt, tbcnt] as MSC2 columnar cells."""
    return {"col": [r[0] for r in rows], "row": [r[1] for r in rows], "vol": [r[2] for r in rows], "tbvol": [r[3] for r in rows],
            "cnt": [r[4] for r in rows], "tbcnt": [r[5] for r in rows]}


def py_tails(old: dict, new: dict):
    """The bridge's rule in plain Python: None (a whole pack) or the tail cells per tier."""
    if any(new["pins"].get(key) != identity for key, identity in old["pins"].items()):
        return None
    out = {}
    for tier, n, _m in TIERS:
        before, after = old["tiers"][tier], new["tiers"][tier]
        first = int(before["b1"] // 2**n)
        col0 = after["col0"]

        def kept(rows):
            return [r for r in rows if col0 <= r[0] < first]

        was, now = kept(before["cells"]), kept(after["cells"])
        if len(was) != len(now):
            return None
        for a, b in zip(was, now):
            if a[0] != b[0] or a[1] != b[1] or a[4] != b[4] or a[5] != b[5]:
                return None
            for k in (2, 3):
                if not abs(a[k] - b[k]) <= 0.0 + VOLUME_ROUNDING * abs(b[k]):
                    return None
        out[tier] = {"from": first, "tail": [r for r in after["cells"] if r[0] >= first]}
    return out


def scenario() -> tuple[dict, dict]:
    """A coherent old pack and the pack a few minutes later: same closed history, the open column grew, new columns."""
    old = {
        "pins": {"day:2026-09-22": [0, 1], "prov:2026-09-24": [0, 0]},
        "tiers": {
            "overview": {"b1": 8200.5, "cells": [[0, 10, 100.0, 40.0, 10.0, 4.0], [1, 10, 200.0, 80.0, 20.0, 8.0], [2, 11, 50.0, 20.0, 5.0, 2.0]]},
            "recent": {"b1": 1002.4, "cells": [[1000, 200, 10.5, 5.25, 3.0, 1.0], [1000, 201, 4.0, 1.0, 2.0, 1.0], [1001, 200, 7.25, 0.0, 1.0, 0.0], [1002, 201, 3.0, 3.0, 1.0, 1.0]]},
            "reference": {"b1": 992.0, "cells": [[60, 200, 30.0, 12.0, 8.0, 3.0], [61, 201, 22.5, 10.0, 6.0, 2.0]]},
        },
    }
    new = {
        "pins": {"day:2026-09-22": [0, 1], "prov:2026-09-24": [0, 0]},
        "tiers": {
            "overview": {"b1": 8260.0, "col0": 0, "col1": 3, "cells": [[0, 10, 100.0, 40.0, 10.0, 4.0], [1, 10, 200.0, 80.0, 20.0, 8.0], [2, 11, 80.0, 30.0, 9.0, 4.0], [2, 12, 5.0, 0.0, 1.0, 0.0]]},
            "recent": {"b1": 1004.7, "col0": 1000, "col1": 1005, "cells": [
                [1000, 200, 10.5, 5.25, 3.0, 1.0], [1000, 201, 4.0, 1.0, 2.0, 1.0], [1001, 200, 7.25, 0.0, 1.0, 0.0],
                [1002, 200, 2.0, 1.0, 1.0, 1.0], [1002, 201, 3.5, 3.5, 2.0, 2.0], [1003, 201, 6.0, 2.0, 4.0, 1.0], [1004, 200, 1.25, 0.0, 1.0, 0.0]]},
            "reference": {"b1": 1008.0, "col0": 60, "col1": 63, "cells": [[60, 200, 30.0, 12.0, 8.0, 3.0], [61, 201, 22.5, 10.0, 6.0, 2.0], [62, 200, 40.0, 20.0, 9.0, 5.0]]},
        },
    }
    return old, new


def copy(value):
    return json.loads(json.dumps(value))


def tails_case(name, note, expect, mutate=None, old=None, new=None):
    o, n = scenario()
    if old:
        old(o)
    if new:
        new(n)
    o, n = copy(o), copy(n)
    rule = py_tails(o, n)
    kind = "pack" if rule is None else "delta"
    if kind != expect:
        raise SystemExit(f"tails case {name}: stated {expect} but the plain-Python rule says {kind}")
    result = {"kind": expect}
    if rule is not None:
        tiers = {}
        for tier, nn, mm in TIERS:
            tail = rule[tier]["tail"]
            block = n["tiers"][tier]
            raw = payload("MSC2", nn, mm, block["col0"], block["col1"], MSC2, cells_of(tail))
            tiers[tier] = {"from": rule[tier]["from"], "col0": block["col0"], "col1": block["col1"], "count": len(tail), "payloadHex": raw.hex()}
        result["tiers"] = tiers
    return {"name": name, "note": note, "old": o, "new": n, "expect": result}


def tails_vectors() -> dict:
    ulp = 2.0**-42  # the spacing of doubles at 1024
    cases = []

    def add(*args, **kwargs):
        cases.append(tails_case(*args, **kwargs))

    add("delta-open-column-grew", "the closed history is equal, the open column and new columns differ: a delta, each tier from the column holding the old end edge", "delta")

    def set_cell(tier, index, k, value):
        def apply(pack):
            pack["tiers"][tier]["cells"][index][k] = value
        return apply

    both = lambda tier, idx, k, was, now: dict(old=set_cell(tier, idx, k, was), new=set_cell(tier, idx, k, now))  # noqa: E731
    # Tolerance: |was - now| <= 1e-12 * |now|, atol 0. At 1024 the tolerance is 4503.6 ulps.
    add("delta-volume-4503-ulps", "one kept volume moved by 4503 ulps of 1024: inside 1e-12 relative", "delta", **both("recent", 0, 2, 1024.0, 1024.0 + 4503 * ulp))
    add("pack-volume-4504-ulps", "4504 ulps: just outside 1e-12 relative", "pack", **both("recent", 0, 2, 1024.0, 1024.0 + 4504 * ulp))
    add("delta-takerbuy-4503-ulps", "the same on the taker-buy volume", "delta", **both("overview", 0, 3, 1024.0, 1024.0 + 4503 * ulp))
    add("pack-takerbuy-4504-ulps", "the same on the taker-buy volume", "pack", **both("overview", 0, 3, 1024.0, 1024.0 + 4504 * ulp))
    add("pack-tolerance-is-relative-to-now", "was 1.0 vs now 1.0 + 2e-12 relative to now: outside", "pack", **both("recent", 0, 2, 1.0, 1.0 + 2e-12))
    add("pack-now-zero-needs-exact-zero", "was 1e-300, now 0.0: atol is 0, so any difference at a zero `now` breaks the prefix", "pack", **both("recent", 1, 3, 1e-300, 0.0))
    add("delta-both-zero", "zero in both is equal", "delta", **both("recent", 1, 3, 0.0, 0.0))
    add("pack-trade-count-changed", "one kept trade count differs by 1", "pack", **both("recent", 0, 4, 3.0, 4.0))
    add("pack-taker-buy-count-changed", "one kept taker-buy count differs by 1", "pack", **both("reference", 0, 5, 3.0, 4.0))
    add("pack-row-changed", "one kept cell sits in another row", "pack", **both("recent", 1, 1, 201, 202))
    add("pack-column-changed", "one kept cell sits in another column", "pack", **both("overview", 1, 0, 1, 0))
    add("pack-cell-added-in-kept-region", "the new pack has one more cell in the kept columns", "pack", new=lambda p: p["tiers"]["recent"]["cells"].insert(2, [1001, 199, 1.0, 0.0, 1.0, 0.0]))
    add("pack-cell-missing-in-kept-region", "the new pack lost one cell of the kept columns", "pack", new=lambda p: p["tiers"]["recent"]["cells"].pop(1))
    add("pack-one-tier-differs", "overview and recent are equal, reference differs in the kept region: the whole pack, for every tier", "pack", **both("reference", 1, 2, 22.5, 22.6))

    def pin_changed(pack):
        pack["pins"]["day:2026-09-22"] = [1, 1]

    add("pack-pin-changed", "an old partition was revised", "pack", new=pin_changed)
    add("pack-pin-missing-in-new", "the provisional day became an archive day: its old key is gone", "pack",
        new=lambda p: (p["pins"].pop("prov:2026-09-24"), p["pins"].update({"day:2026-09-24": [0, 1]})))
    add("delta-pin-added-in-new", "a partition the old pack did not read is new: nothing old changed", "delta", new=lambda p: p["pins"].update({"prov:2026-09-25": [0, 0]}))

    def integer_cutoff(pack):
        pack["tiers"]["recent"]["b1"] = 1002.0

    add("delta-old-cutoff-integer", "no open column in the old pack: the tail starts at the first column after its end", "delta", old=integer_cutoff,
        new=lambda p: p["tiers"]["recent"].update(cells=p["tiers"]["recent"]["cells"][:3] + [[1002, 200, 2.0, 1.0, 1.0, 1.0], [1003, 201, 6.0, 2.0, 4.0, 1.0]]))

    def nothing_new(pack):
        pack["tiers"]["recent"]["cells"] = pack["tiers"]["recent"]["cells"][:3]
        pack["tiers"]["recent"]["b1"] = 1002.0
        pack["tiers"]["recent"]["col1"] = 1002

    add("delta-empty-tail", "the cube did not move on and the old end edge was a column edge: nothing to send for recent", "delta",
        old=lambda p: (integer_cutoff(p), p["tiers"]["recent"].update(cells=p["tiers"]["recent"]["cells"][:3])), new=nothing_new)
    return {"schema": 1, "tiers": [{"id": t, "n": n, "m": m} for t, n, m in TIERS], "cases": cases}


# ---------------------------------------------------------------- output


def render(value: dict) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def outputs() -> dict:
    return {OUT / "vectors.json": render(wire_vectors()), OUT / "tails-vectors.json": render(tails_vectors())}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="write the vector files")
    mode.add_argument("--check", action="store_true", help="compare the vector files with a fresh generation")
    arguments = parser.parse_args()
    wanted = outputs()
    if arguments.write:
        OUT.mkdir(parents=True, exist_ok=True)
        for file, text in wanted.items():
            file.write_text(text, encoding="utf-8")
            print(f"wrote {file.relative_to(ROOT)} ({len(text)} bytes)")
        return 0
    bad = 0
    for file, text in wanted.items():
        current = file.read_text(encoding="utf-8") if file.is_file() else None
        if current != text:
            bad += 1
            print(f"{file.relative_to(ROOT)} differs from a fresh generation; run --write and review the diff", file=sys.stderr)
        else:
            print(f"{file.relative_to(ROOT)} ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
