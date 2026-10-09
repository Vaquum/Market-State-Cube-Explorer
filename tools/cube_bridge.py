#!/usr/bin/env python3
"""Serve the explorer on the Origo host from the live market state cube (PRD-0022).

The cube's query service answers with paths to Arrow files on its own volume, so this server
runs beside that volume. It asks the service for tiles, reads the files through the cube's
supported reader (``market_state_reader.py``, a pinned copy, which renews each file's 24-hour
clock) and hands the page MSC2 blocks.

Routes:

- ``/``: ``index.html`` with a live pack in place of the recorded snapshot. The pack holds three
  tiers read up to the cube's data cutoff, so the latest trades are in it: the base column
  that holds the cutoff is the open one, still gaining trades. The partitions the tiers share
  must carry the same revision, and the pack's token digests every pin it read and the cutoff.
  It is rebuilt at most once a minute.
- ``/cube/pack?since``: what a page holding pack ``since`` needs to hold the current one:
  nothing, the columns each tier gained when its pack is a prefix of the current one, or else
  the whole pack; with the current pack's age, how long the cube has had no new data, and
  when to ask again. An open page asks for this on its own, so the data advances without a
  reload.
- ``/cube/query?n&m&b0&b1[&r0&r1]&pack``: the cube's answer for one rectangle, exactly: its
  cells at level (n, m), at most 4,096 columns wide, and its summary (the four totals, both
  POCs, the partial edges). Times are base columns and prices base rows (125 USDT) from
  2021-01-01; without ``r0`` and ``r1`` the prices are automatic. Answered for the page
  holding pack ``pack`` only when every partition read is one that pack read, at the same
  revision. The open base column comes from the pack itself, so a cube that has moved on
  since the pack was read never mixes into the answer.
- ``/cube/tile?n&m&b0&b1&pack``: the same without price bounds or summary.
- ``/cube/columns?n&m&pack``: each column's POC, volume and taker-buy volume at level (n, m),
  for up to the last 100,000 complete columns: the history the continuations compare.
- ``/cube/touched?n&b0&b1&pack``: each column's USDT and the 125 USDT rows its trades touched,
  at level n and at level n + 1, over base columns [b0, b1) on whole parent columns: from a
  ``/cube/query`` at m = 0, counts and sums only. Efficiency, the pane's measure, reads them
  only while it shows, where no loaded tier at 125 USDT rows holds a parent whole.
- ``/cube/motion?tier&pack[&from]``: one tier of pack ``pack`` again, with how the price moved
  inside each cell (MSC3), up to the pack's last complete base column: the whole tier, or with
  ``from`` (a base edge) its columns from the one holding that edge on, for a page that holds
  the rest. A page asks for it only while it shows path or dwell.
- ``/cube/tile`` and ``/cube/query`` with ``motion=1``: the same rectangle's cells in MSC3, up to
  the pack's last complete base column, and for ``/cube/query`` its path and dwell totals.
  Every answer with motion names where its measures end (``end``, a base position, and
  ``through``): the open column is measured once it completes, and while the cube is still
  measuring its history the measures end where the cube's do.
- ``/cube/bars?n&b0&b1&pack``: bars at dyadic grid timeframes n = 0..20 over base positions [b0, b1),
  b0 on a bar's edge; b1 may be fractional for an exact replay cutoff: each
  column's open, high, low and close, its USDT, taker-buy USDT and BTC volume, and its trades
  (MSCB), from the cube's measures at rows that hold every price, so each column is one cell.
  Like motion, they end at the pack's last complete base column or where the cube's measures
  end, and say where (``end``, ``through``). Kept per pack and span.
- ``/vendor/<file>``: the vendored scripts, flat file names only.

Every ``/cube/`` route takes ``proto=2``, the page's protocol. A page loaded before it names
none and can't read MSC2 blocks, so it is answered 409 with words telling its reader to reload.

The server checks no credentials: it listens on 127.0.0.1 only, and the host's Caddy passes a
request for cube.vaquum.fi on only after the Vaquum portal login (Vaquum/Portal).
``MARKET_STATE_URL`` names the cube service (default ``http://127.0.0.1:8486``).

MSC2 (little-endian): 32-byte header ``magic n m pad col0 col1 count 12x`` then columnar
arrays volume f64, taker-buy volume f64, trades f64, taker-buy trades f64, column u32, row u32,
cells sorted by (column, row). Columns and rows are absolute indices at the block's own level
(n, m), anchored at 2021-01-01T00:00:00Z. Trade counts travel as f64, exact below 2**53.
MSCC: the same header, then column u32, POC row u32, volume f32, taker-buy volume f32.
MSC3: MSC2 with four more f64 arrays after the trade counts: path length (USDT), dwell (seconds),
high and low (the cell's highest and lowest trade price; NaN in a cell without trades). It holds
the cells the price moved through or held in without trading as well: trades 0.
MSCB: the same header (m the bars' price level, 20), then f64 arrays open, high, low, close,
volume, taker-buy volume, BTC volume and trades, then column u32: one bar per column with
trades, in time order. A column without trades has no bar.

Reads with motion ask the cube for path length, dwell, high and low (PRD-0023), and bars for
open, high, low, close and base volume. They take the cube service's second query slot, so a
tile never waits behind one.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import math
import os
import re
import struct
import sys
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from market_state_reader import MarketStateError, query, read_table  # noqa: E402
from rally_bridge import RallyStore  # noqa: E402

T0 = 1609459200
BASE_SECONDS = 56.25
BASE_PRICE = 125
DAY = 1536  # base columns per day
PACK_MAX_AGE_SECONDS = 60
PACKS_HELD = 16
FIELDS = ("vol", "tbvol", "cnt", "tbcnt", "col", "row")  # MSC2 order
MOTION_FIELDS = ("vol", "tbvol", "cnt", "tbcnt", "path", "dwell", "high", "low", "col", "row")  # MSC3 order
MOTION_MEASURES = ("path_length", "dwell", "high", "low")
MOTION_HELD = 8
TOUCHES_HELD = 32
# Bars: dyadic timeframes n = 0..20, read at rows of
# 125 × 2**20 USDT, one row holding every price, so each column is one cell.
BAR_LEVELS = tuple(range(21))
BAR_PRICE_EXPONENT = 20
BAR_MEASURES = ("base_volume", "high", "low", "open", "close")
BAR_FIELDS = (
    ("open", "open"), ("high", "high"), ("low", "low"), ("close", "close"), ("vol", "volume"),
    ("tbvol", "taker_buy_volume"), ("btc", "base_volume"), ("cnt", "trade_count"),
)  # MSCB order, before the column
BARS_HELD = 64
# How far two reads of the same cells' volume may differ: the last bits of a float sum.
VOLUME_ROUNDING = 1e-12
MAX_COLUMNS = 4096
MAX_CELLS = 1_000_000
HISTORY_COLUMNS = 100_000
MAX_TIME_EXPONENT = 24
MAX_PRICE_EXPONENT = 12
# The page's protocol: MSC2 blocks, the open column and /cube/query. A page that
# names no protocol was loaded before it and can't read these blocks: it is
# told to reload, in words its status line shows as they are.
PROTOCOL = "2"
OUTDATED = "the explorer was updated; reload the page to see the latest data"
# The service runs two queries at once: this server takes one at a time for tiles, rectangles
# and packs, and one for motion, which only a page showing it asks for. So a tile never waits
# behind a motion read. It waits out a busy service this long before it gives up.
BUSY_WAIT_SECONDS = 20.0
CUBE_SLOT = threading.Lock()
MOTION_SLOT = threading.Lock()
CUBE_URL = os.environ.get("MARKET_STATE_URL", "http://127.0.0.1:8486")
SOURCE = "Binance BTCUSDT spot · Origo market state cube"
VENDOR_TYPES = {".js": "application/javascript", ".css": "text/css", ".txt": "text/plain", ".md": "text/markdown"}
TIERS = (
    {"id": "overview", "n": 12, "m": 3},
    {"id": "recent", "n": 0, "m": 0, "days": 7},
    {"id": "reference", "n": 4, "m": 0, "days": 30, "complete": True},
)
NOTES = [
    "Every block is read live from the market state cube through its supported reader.",
    "Recent has the last seven days at base resolution, up to the cube's data cutoff.",
    "Reference has 30 days of completed 15-minute columns. Filter each candidate outcome to end before the replay anchor.",
    "Overview is contextual: 64 hours × 1000 USDT over the whole history.",
    "Any rectangle, finer detail and the continuations' history are read from the cube on demand.",
]


def edge(base_index: float) -> str:
    return datetime.fromtimestamp(T0 + base_index * BASE_SECONDS, UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def base_units(stamp: str) -> float:
    return (datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() - T0) / BASE_SECONDS


# ---------------------------------------------------------------- reading the cube


class CubeChanged(Exception):
    """A read found a partition at a different revision than the pack the page holds."""


def cube_query(
    t1: str, t2: str | None, p1: int | None, p2: int | None, tR: float, pR: int,
    measures: tuple[str, ...] | None = None,
) -> tuple[dict, Any, dict]:
    """One cube query and its two files, read through the supported reader.

    Queries go one at a time in each slot, those with measures in the second; a busy service
    is asked again for up to BUSY_WAIT_SECONDS.
    """
    deadline = time.monotonic() + BUSY_WAIT_SECONDS
    while True:
        try:
            with MOTION_SLOT if measures else CUBE_SLOT:
                result = query(t1=t1, t2=t2, p1=p1, p2=p2, tR=tR, pR=pR, measures=measures, url=CUBE_URL)
            break
        except MarketStateError as error:
            if error.status != 503 or time.monotonic() >= deadline:
                raise
        time.sleep(1.0)
    cells = read_table(result.cells, url=CUBE_URL)
    summary = read_table(result.summary, url=CUBE_URL).to_pylist()[0]
    return dict(result.response), cells, summary


def arrays(table: Any, motion: bool = False) -> dict:
    """A cells table as columnar arrays in MSC2 order, or MSC3 with motion, sorted by (column, row)."""
    import numpy as np

    col = table.column("time_index").to_numpy().astype(np.uint64)
    row = table.column("price_index").to_numpy().astype(np.uint64)
    cnt = table.column("trade_count").to_numpy().astype(np.uint64)
    tbcnt = table.column("taker_buy_trade_count").to_numpy().astype(np.uint64)
    if col.size and (int(col.max()) >= 2**32 or int(row.max()) >= 2**32):
        raise RuntimeError("A cell index is beyond 32 bits.")
    if cnt.size and int(cnt.max()) >= 2**53:
        raise RuntimeError("A cell's trade count is beyond 2**53.")
    order = np.lexsort((row, col))
    out = {
        "vol": table.column("volume").to_numpy()[order].astype("<f8"),
        "tbvol": table.column("taker_buy_volume").to_numpy()[order].astype("<f8"),
        "cnt": cnt[order].astype("<f8"),
        "tbcnt": tbcnt[order].astype("<f8"),
        "col": col[order].astype("<u4"),
        "row": row[order].astype("<u4"),
    }
    if motion:
        # A cell without trades has no highest or lowest trade: NaN travels for the cube's null.
        for key, name in (("path", "path_length"), ("dwell", "dwell"), ("high", "high"), ("low", "low")):
            out[key] = table.column(name).to_numpy(zero_copy_only=False)[order].astype("<f8")
    return out


def read(
    n: int, m: int, b0: int, b1: int | None, r0: int | None = None, r1: int | None = None, motion: bool = False,
) -> tuple[dict, dict, dict, dict]:
    """The cube's level-(n, m) cells over base columns [b0, b1), and base rows [r0, r1) when
    given: its response, its cells, its summary and the pins it read. Without ``b1`` the
    time runs to the cube's data cutoff; without rows the prices are automatic. With motion
    the cells carry path length, dwell, high and low too, and include those without trades."""
    response, table, summary = cube_query(
        t1=edge(b0),
        t2=None if b1 is None else edge(b1),
        p1=None if r0 is None else r0 * BASE_PRICE,
        p2=None if r1 is None else r1 * BASE_PRICE,
        tR=BASE_SECONDS * 2**n,
        pR=BASE_PRICE * 2**m,
        measures=MOTION_MEASURES if motion else None,
    )
    meta = json.loads(table.schema.metadata[b"origo.market_state"])
    grid = meta["grid"]
    if (grid["time_exponent"], grid["price_exponent"]) != (n, m):
        raise RuntimeError(f"Cube answered level {grid} for requested ({n}, {m}).")
    cells = arrays(table, motion)
    if len(cells["col"]) > MAX_CELLS:
        raise ValueError(f"{len(cells['col'])} cells is more than {MAX_CELLS}; ask for coarser cells")
    # A pin is [partition_key, generation, revision, build_id]. Only its revision and build id
    # identify the data read: attaching a component to a build moves its generation and
    # changes no cell.
    return response, cells, summary, {pin[0]: list(pin[2:]) for pin in meta["pins"]}


def bar_read(n: int, b0: int, b1: float) -> tuple[dict, dict, dict]:
    """The cube's bars at level n over base columns [b0, b1): each column with trades as one
    cell of rows that hold every price, with its open, high, low, close and BTC volume. With
    the cube's response and the pins it read."""
    import numpy as np

    response, table, _ = cube_query(
        t1=edge(b0), t2=edge(b1), p1=None, p2=None, tR=BASE_SECONDS * 2**n,
        pR=BASE_PRICE * 2**BAR_PRICE_EXPONENT, measures=BAR_MEASURES,
    )
    meta = json.loads(table.schema.metadata[b"origo.market_state"])
    grid = meta["grid"]
    if (grid["time_exponent"], grid["price_exponent"]) != (n, BAR_PRICE_EXPONENT):
        raise RuntimeError(f"Cube answered level {grid} for requested bars at n = {n}.")
    col = table.column("time_index").to_numpy().astype(np.uint64)
    order = np.argsort(col, kind="stable")
    col = col[order]
    # One row holds every price below 131 M USDT: a column with two cells has a price above it.
    if col.size and (bool(np.any(col[1:] == col[:-1])) or int(col[-1]) >= 2**32):
        raise RuntimeError("A bar's column holds prices in more than one row, or is beyond 32 bits.")
    bars = {key: table.column(name).to_numpy(zero_copy_only=False)[order].astype("<f8") for key, name in BAR_FIELDS}
    bars["col"] = col.astype("<u4")
    return response, bars, {pin[0]: list(pin[2:]) for pin in meta["pins"]}


def mscb(n: int, col0: int, col1: int, bars: dict) -> str:
    """Bars as one MSCB payload, gzipped and base64-encoded."""
    header = struct.pack("<4sBBHIII12x", b"MSCB", n, BAR_PRICE_EXPONENT, 0, col0, col1, len(bars["col"]))
    payload = header + b"".join(bars[key].tobytes() for key, _ in BAR_FIELDS) + bars["col"].tobytes()
    return base64.b64encode(gzip.compress(payload, compresslevel=6)).decode()


def no_cells() -> dict:
    """No cells, as MSC3's arrays."""
    import numpy as np

    return {key: np.zeros(0, "<u4" if key in ("col", "row") else "<f8") for key in MOTION_FIELDS}


def no_bars() -> dict:
    """No bars, as MSCB's arrays."""
    import numpy as np

    return {**{key: np.zeros(0, "<f8") for key, _ in BAR_FIELDS}, "col": np.zeros(0, "<u4")}


def msc2(n: int, m: int, col0: int, col1: int, cells: dict, first: int = 0, motion: bool = False) -> str:
    """The cells from index ``first`` on as one MSC2 payload, or MSC3 with motion, gzipped and
    base64-encoded."""
    magic, fields = (b"MSC3", MOTION_FIELDS) if motion else (b"MSC2", FIELDS)
    header = struct.pack("<4sBBHIII12x", magic, n, m, 0, col0, col1, len(cells["col"]) - first)
    payload = header + b"".join(cells[key][first:].tobytes() for key in fields)
    return base64.b64encode(gzip.compress(payload, compresslevel=6)).decode()


def block(n: int, m: int, b0: float, b1: float, cells: dict, motion: bool = False) -> dict:
    """A level-(n, m) block over base time [b0, b1): its columns, its cells and their range."""
    col0, col1 = int(b0 // 2**n), int(-(-b1 // 2**n))
    return {
        "n": n, "m": m, "b0": b0, "b1": b1, "start": edge(b0), "end": edge(b1),
        "count": len(cells["col"]), "col0": col0, "col1": col1, "encoding": "gzip+base64",
        "layout": "MSC3" if motion else "MSC2", "gzip_base64": msc2(n, m, col0, col1, cells, motion=motion),
    }


def totals(cells: dict) -> dict:
    """The four totals over the cells, volumes summed exactly as the cube sums them."""
    import numpy as np

    return {
        "volume": math.fsum(cells["vol"]), "taker_buy_volume": math.fsum(cells["tbvol"]),
        "trade_count": int(cells["cnt"].astype(np.uint64).sum()),
        "taker_buy_trade_count": int(cells["tbcnt"].astype(np.uint64).sum()),
    }


def point_of_control(cells: dict, field: str, m: int) -> float | None:
    """The centre of the price row with the most volume, from exact row sums; the lower row
    wins a tie and there is none without volume, as the cube defines it."""
    import numpy as np

    if not len(cells["row"]):
        return None
    order = np.argsort(cells["row"], kind="stable")
    rows = cells["row"][order]
    starts = np.flatnonzero(np.r_[True, rows[1:] != rows[:-1]])
    values = np.split(cells[field][order], starts[1:])
    sums = [math.fsum(v) for v in values]
    best = max(sums)
    if best <= 0:
        return None
    return (float(rows[starts[sums.index(best)]]) + 0.5) * BASE_PRICE * 2**m


def merge(cells: dict, extra: dict, n: int, m: int) -> dict:
    """The cells with base cells ``extra`` added into their level-(n, m) cells."""
    import numpy as np

    if not len(extra["col"]):
        return cells
    grown = {key: np.concatenate([cells[key], extra[key] if key in ("vol", "tbvol", "cnt", "tbcnt") else (extra[key] >> (n if key == "col" else m)).astype("<u4")]) for key in FIELDS}
    key = (grown["col"].astype(np.uint64) << np.uint64(32)) | grown["row"].astype(np.uint64)
    order = np.argsort(key, kind="stable")
    key = key[order]
    starts = np.flatnonzero(np.r_[True, key[1:] != key[:-1]])
    out = {"col": grown["col"][order][starts], "row": grown["row"][order][starts]}
    for field in ("vol", "tbvol", "cnt", "tbcnt"):
        parts = np.split(grown[field][order], starts[1:])
        out[field] = np.array([math.fsum(p) if len(p) > 1 else p[0] for p in parts], dtype="<f8")
    return {k: out[k] for k in FIELDS}


def rows_touched(col: Any, row: Any, vol: Any) -> dict:
    """Each column's USDT and how many rows its trades touched, from cells at 125 USDT rows:
    the rows its cells hold. Given parent columns (``col >> 1``), the rows across both a
    parent's columns, each counted once."""
    import numpy as np

    if not len(col):
        return {"col": [], "rows": [], "volume": []}
    key = (col.astype(np.uint64) << np.uint64(32)) | row.astype(np.uint64)
    order = np.argsort(key, kind="stable")
    key, col, vol = key[order], col[order], vol[order]
    distinct = np.r_[True, key[1:] != key[:-1]]
    starts = np.flatnonzero(np.r_[True, col[1:] != col[:-1]])
    return {
        "col": col[starts].tolist(),
        "rows": np.add.reduceat(distinct.astype(np.int64), starts).tolist(),
        "volume": [math.fsum(part) for part in np.split(vol, starts[1:])],
    }


def columns(cells: dict) -> dict:
    """Each column of the cells: its volume, taker-buy volume and POC row (the lower row on a
    tie), as columnar arrays."""
    import numpy as np

    if not len(cells["col"]):
        return {"col": np.zeros(0, "<u4"), "poc": np.zeros(0, "<u4"), "vol": np.zeros(0, "<f4"), "tbvol": np.zeros(0, "<f4")}
    col = cells["col"]
    starts = np.flatnonzero(np.r_[True, col[1:] != col[:-1]])
    lengths = np.diff(np.r_[starts, len(col)])
    best = np.maximum.reduceat(cells["vol"], starts)
    top = cells["vol"] == np.repeat(best, lengths)
    index = np.arange(len(col))
    first = np.minimum.reduceat(np.where(top, index, len(col)), starts)
    return {
        "col": col[starts].astype("<u4"),
        "poc": cells["row"][first].astype("<u4"),
        "vol": np.add.reduceat(cells["vol"], starts).astype("<f4"),
        "tbvol": np.add.reduceat(cells["tbvol"], starts).astype("<f4"),
    }


def pack() -> tuple[dict, dict, dict]:
    """The three tiers as one consistent pack, every pin the pack read, and each tier's cells.

    The overview reads the whole history up to the cube's data cutoff and so fixes it; every
    later tier is bounded to that cutoff, and every partition it reads must be one the overview
    read, at the same revision and build id, or the cube changed under the pack and
    it is read again.
    """
    for _attempt in range(3):
        response, overview, summary, pinned = read(12, 3, 0, None)
        state = response
        cutoff = base_units(state["data_cutoff"])
        top = math.ceil(cutoff)
        blocks = {"overview": block(12, 3, 0.0, cutoff, overview)}
        cells = {"overview": overview}
        blocks["overview"]["totals"] = summary_totals(summary)
        conflict = None
        for tier in TIERS[1:]:
            step = 2 ** tier["n"]
            b1 = math.floor(cutoff) // step * step if tier.get("complete") else top
            b0 = max(0, (b1 - tier["days"] * DAY) // step * step)
            _, tier_cells, tier_summary, pins = read(tier["n"], tier["m"], b0, b1)
            # A provisional minute replaced by an archive day appears as a new key.
            conflict = conflict or next((key for key, identity in pins.items() if pinned.get(key) != identity), None)
            blocks[tier["id"]] = block(tier["n"], tier["m"], float(b0), min(float(b1), cutoff), tier_cells)
            blocks[tier["id"]]["totals"] = summary_totals(tier_summary)
            cells[tier["id"]] = tier_cells
        if conflict is None:
            break
    else:
        raise RuntimeError(f"The cube changed while the pack was read (partition {conflict}); try again.")
    # The cutoff is digested too: a pack whose data advanced always carries a new token.
    digest = hashlib.sha256(json.dumps([state["data_cutoff"], sorted(pinned.items())], separators=(",", ":")).encode()).hexdigest()
    return {
        "source": SOURCE, "t0": T0, "base_seconds": BASE_SECONDS, "base_price": BASE_PRICE,
        "cutoff": state["data_cutoff"], "cutoffBase": cutoff, "data_cutoff": state["data_cutoff"],
        "canonical_through": state["canonical_through"], "state_token": digest,
        "partitions": len(pinned), "snapshot": False, "live": True, "notes": NOTES, "blocks": blocks,
    }, pinned, cells


def summary_totals(summary: dict) -> dict:
    return {
        "volume": summary["volume"], "buyVolume": summary["taker_buy_volume"],
        "trades": summary["trade_count"], "buyTrades": summary["taker_buy_trade_count"],
    }


def tails(old: dict, new: dict) -> dict | None:
    """The new pack's tiers as what a page holding the old pack lacks, or None when it can't be.

    The old pack must be a prefix of the new: every partition it read is unchanged, and the
    columns the page keeps, from the new tier's first column up to the one holding the old
    tier's end edge, hold the same cells in both: the same trade counts, and the same volumes
    to within VOLUME_ROUNDING. The cube sums a cell's volume in whatever order its read runs,
    so two reads of unchanged data can differ in the last bits; new trades always change the
    counts. A backfill or a revision fails one of the two, and the page then takes the whole
    pack. Each tier travels as its cells from that column on, which the page puts in place of
    its own from the same column; the old open column is among them.
    """
    import numpy as np

    if any(new["pins"].get(key) != identity for key, identity in old["pins"].items()):
        return None
    blocks = {}
    for tier in TIERS:
        before, after = old["tiers"][tier["id"]], new["tiers"][tier["id"]]
        meta = after["block"]
        first = int(before["block"]["b1"] // 2 ** tier["n"])
        kept = [np.searchsorted(side["cells"]["col"], [meta["col0"], first]) for side in (before, after)]
        was, now = (
            {key: side["cells"][key][k[0]:k[1]] for key in FIELDS}
            for side, k in ((before, kept[0]), (after, kept[1]))
        )
        if not (
            all(np.array_equal(was[key], now[key]) for key in ("col", "row", "cnt", "tbcnt"))
            and all(np.allclose(was[key], now[key], rtol=VOLUME_ROUNDING, atol=0.0) for key in ("vol", "tbvol"))
        ):
            return None
        tail = msc2(tier["n"], tier["m"], meta["col0"], meta["col1"], after["cells"], int(kept[1][1]))
        blocks[tier["id"]] = {**meta, "from": first, "gzip_base64": tail}
    return blocks


# ---------------------------------------------------------------- serving the page


class Explorer:
    def __init__(self, page: Path) -> None:
        self.page = page
        self.lock = threading.Lock()  # guards the fields below; never held while the cube is read
        self.building = threading.Lock()  # one pack build at a time
        self.pack: dict | None = None
        self.stale = False  # a read found the current pack behind the cube: rebuild it now
        self.held: dict[str, dict] = {}  # pack token -> the pins that pack read, its tiers, its cutoff
        self.motions: dict[tuple, dict] = {}  # (token, tier, first column's base edge) -> motion answer
        self.touches: dict[tuple, dict] = {}  # (token, n, b0, b1) -> rows touched
        self.bar_answers: dict[tuple, dict] = {}  # (token, n, b0, b1) -> bars
        self.motion_building = threading.Lock()  # one motion tier read at a time; others then share it
        self.packed_at = 0.0
        # When the cube's data cutoff last moved, on this server's clock. The first pack
        # starts it at the cutoff itself: a cube that stalled before the server started is
        # already quiet, rather than fresh.
        self.data_cutoff: str | None = None
        self.advanced_at = 0.0
        # The page this server serves: an open page from an earlier deploy learns that it is
        # older than the server it asks, and offers a reload.
        self.version = hashlib.sha256(page.read_bytes()).hexdigest()[:12]
        self.rallies = RallyStore(self, CUBE_URL, (CUBE_SLOT, MOTION_SLOT))

    def current_pack(self) -> tuple[dict, float]:
        """The current pack and its age in seconds; rebuilt once it is older than a minute, or
        at once when a read found the cube had moved past it.

        Reads for pages are answered while a pack is built: the build holds only its own lock.
        """
        with self.building:
            with self.lock:
                fresh = time.monotonic() - self.packed_at <= PACK_MAX_AGE_SECONDS
                if self.pack is not None and fresh and not self.stale:
                    return self.pack, time.monotonic() - self.packed_at
            started = time.monotonic()
            built, pinned, cells = pack()
            tiers = {
                key: {"block": {k: v for k, v in meta.items() if k != "gzip_base64"}, "cells": cells[key]}
                for key, meta in built["blocks"].items()
            }
            with self.lock:
                self.pack = built
                self.stale = False
                if built["data_cutoff"] != self.data_cutoff:
                    cutoff = datetime.fromisoformat(built["data_cutoff"].replace("Z", "+00:00")).timestamp()
                    self.advanced_at = time.time() if self.data_cutoff else cutoff
                    self.data_cutoff = built["data_cutoff"]
                # A token built again moves to the end, so the oldest held pack is always first.
                self.held.pop(built["state_token"], None)
                self.held[built["state_token"]] = {
                    "pins": pinned, "tiers": tiers, "cutoff": built["cutoffBase"],
                    # The pack's state, without its payloads: sixteen packs stay small.
                    "state": {key: built[key] for key in ("cutoff", "data_cutoff", "canonical_through", "state_token")},
                }
                while len(self.held) > PACKS_HELD:
                    del self.held[next(iter(self.held))]
                self.packed_at = time.monotonic()
            count = sum(b["count"] for b in built["blocks"].values())
            print(f"pack built in {self.packed_at - started:.1f} s, cutoff {built['cutoff']}, {count} cells", flush=True)
            return built, 0.0

    def timing(self, age: float) -> dict:
        """The pack's age, how long the cube has had no new data, when a page should next
        ask (just after the pack can be rebuilt), and the page this server serves."""
        with self.lock:
            quiet = max(0.0, time.time() - self.advanced_at)
        return {
            "age": round(age, 1), "quiet": round(quiet, 1),
            "next": round(max(1.0, PACK_MAX_AGE_SECONDS - age + 1), 1), "page": self.version,
        }

    def update(self, since: str) -> dict:
        """What a page holding pack ``since`` needs to hold the current pack."""
        current, age = self.current_pack()
        token = current["state_token"]
        if since == token:
            return {"status": "current", "state_token": token, **self.timing(age)}
        with self.lock:
            old, new = self.held.get(since), self.held.get(token)
        blocks = tails(old, new) if old and new else None
        if blocks is None:
            return {"status": "pack", "pack": current, **self.timing(age)}
        fields = ("cutoff", "cutoffBase", "data_cutoff", "canonical_through", "state_token", "partitions")
        return {"status": "delta", **{key: current[key] for key in fields}, "blocks": blocks, **self.timing(age)}

    def holding(self, token: str) -> dict:
        with self.lock:
            held = self.held.get(token)
        if held is None:
            raise CubeChanged("the page's pack is no longer held by the server")
        return held

    def check(self, pins: dict, held: dict, token: str) -> None:
        """Every partition read must be one the page's pack read, at the same identity."""
        changed = [key for key, identity in pins.items() if held["pins"].get(key) != identity]
        if changed:
            with self.lock:
                # The newest pack is behind the cube: the page's next ask gets a new one.
                if self.pack is not None and self.pack["state_token"] == token:
                    self.stale = True
            raise CubeChanged(f"{len(changed)} partition(s) differ from the page's pack, first {changed[0]}")

    def rectangle_cells(self, spec: dict, token: str) -> tuple[dict, dict, dict | None, dict | None, bool, tuple | None]:
        """One rectangle's level-(n, m) cells for the page holding pack ``token``: read from the
        cube up to the last complete base column before the pack's cutoff, and the open column,
        when the rectangle reaches it, from the pack's own, so they are the state the page holds
        even after the cube has moved on. With the pack held, the cube's response and summary
        of the part it read, whether the rectangle reaches the open column, and the open
        column's rows."""
        n, m, b0, b1, r0, r1 = (spec[key] for key in ("n", "m", "b0", "b1", "r0", "r1"))
        held = self.holding(token)
        cutoff = held["cutoff"]
        closed, top = math.floor(cutoff), math.ceil(cutoff)
        if b1 > top:
            raise ValueError("b1 is after the pack's cutoff")
        stop = min(b1, closed)
        cells, summary, response = None, None, None
        if b0 < stop:
            response, cells, summary, pins = read(n, m, b0, stop, r0, r1)
            self.check(pins, held, token)
        opened = b1 > closed and top > closed
        extent = None
        if opened or summary is None:
            if cells is None:
                cells = {key: held["tiers"]["recent"]["cells"][key][:0] for key in FIELDS}
            extra = {key: value[:0] for key, value in cells.items()}
            if opened:
                recent = held["tiers"]["recent"]["cells"]
                keep = recent["col"] == closed
                if r0 is not None:
                    keep &= (recent["row"] >= r0) & (recent["row"] < r1)
                extra = {key: recent[key][keep] for key in FIELDS}
                if len(extra["row"]):
                    extent = (int(extra["row"].min()), int(extra["row"].max()) + 1)
            cells = merge(cells, extra, n, m)
        return cells, held, response, summary, opened, extent

    def measure(self, spec: dict, token: str) -> dict:
        """The cube's cells and summary for one rectangle, for the page holding pack ``token``
        (rectangle_cells)."""
        n, m, b0, b1, r0, r1 = (spec[key] for key in ("n", "m", "b0", "b1", "r0", "r1"))
        cells, held, response, summary, opened, extent = self.rectangle_cells(spec, token)
        cutoff = held["cutoff"]
        top = math.ceil(cutoff)
        if not opened and summary is not None:
            answer = cube_summary(summary, response, n, m)
        else:
            answer = merged_summary(cells, n, m, b0, top if opened else b1, r0, r1, summary, extent, cutoff)
        end = min(float(top if opened else b1), cutoff)
        state = held["state"]
        answer.update(
            data_cutoff=state["data_cutoff"], canonical_through=state["canonical_through"],
            state_token=state["state_token"],
        )
        return {"cutoff": state["cutoff"], "block": block(n, m, float(b0), end, cells), "summary": answer}

    def touched(self, n: int, b0: int, b1: int, token: str) -> dict:
        """Each column's USDT and the 125 USDT rows its trades touched, at level n and one level
        up, over base columns [b0, b1), for the page holding pack ``token``: from the cube's cells
        at (n, 0), the rows of a column its cells, and a parent's the rows across both its
        columns. Kept per pack and span, as a page asks each chunk once."""
        key = (token, n, b0, b1)
        with self.lock:
            hit = self.touches.get(key)
        if hit is not None:
            return hit
        cells, held, *_ = self.rectangle_cells({"n": n, "m": 0, "b0": b0, "b1": b1, "r0": None, "r1": None}, token)
        answer = {
            "n": n, "b0": b0, "b1": b1, "cutoff": held["state"]["cutoff"],
            "columns": rows_touched(cells["col"], cells["row"], cells["vol"]),
            "parents": rows_touched(cells["col"] >> 1, cells["row"], cells["vol"]),
        }
        with self.lock:
            self.touches[key] = answer
            while len(self.touches) > TOUCHES_HELD:
                del self.touches[next(iter(self.touches))]
        return answer

    def history(self, n: int, m: int, token: str) -> dict:
        """Each complete column's POC row, volume and taker-buy volume at level (n, m), for up
        to the last HISTORY_COLUMNS columns before the pack's cutoff."""
        held = self.holding(token)
        step = 2**n
        end = math.floor(held["cutoff"]) // step * step
        start = max(0, end - HISTORY_COLUMNS * step)
        cols = columns({key: held["tiers"]["recent"]["cells"][key][:0] for key in FIELDS})
        if start < end:
            _, cells, _, pins = read(n, m, start, end)
            self.check(pins, held, token)
            cols = columns(cells)
        header = struct.pack("<4sBBHIII12x", b"MSCC", n, m, 0, start // step, end // step, len(cols["col"]))
        payload = header + b"".join(cols[key].tobytes() for key in ("col", "poc", "vol", "tbvol"))
        return {
            "cutoff": held["state"]["cutoff"],
            "columns": {
                "n": n, "m": m, "b0": start, "b1": end, "count": len(cols["col"]), "layout": "MSCC",
                "gzip_base64": base64.b64encode(gzip.compress(payload, compresslevel=6)).decode(),
            },
        }

    def motion_read(
        self, n: int, m: int, b0: int, b1: int, held: dict, token: str, r0: int | None = None, r1: int | None = None,
    ) -> tuple[dict, dict | None, dict | None, float]:
        """Level-(n, m) cells with path, dwell, high and low over base columns [b0, b1), checked
        against the page's pack: the cells, the cube's response and summary, and where the
        measures end: ``b1``, or earlier where the cube's coverage of them ends."""
        empty = no_cells()
        if b0 >= b1:
            return empty, None, None, float(b0)
        try:
            response, cells, summary, pins = read(n, m, b0, b1, r0, r1, motion=True)
        except MarketStateError as error:
            # The cube hasn't measured this time yet: nothing, measured up to where it has.
            if error.status == 409 and error.body.get("error") == "outside_coverage":
                return empty, None, None, min(float(b0), base_units(str(error.body["data_cutoff"])))
            raise
        self.check(pins, held, token)
        return cells, response, summary, min(float(b1), base_units(response["data_cutoff"]))

    def bars(self, n: int, b0: int, b1: float, token: str) -> dict:
        """Bars at level n over base columns [b0, b1) for the page holding pack ``token``, up to
        the pack's last complete base column, or where the cube's measures end: ``end``, a base
        position. The bar holding it is partial when it isn't a bar's edge. Kept per pack and
        span; the page asks again from its latest bar as the pack moves on."""
        key = (token, n, b0, b1)
        with self.lock:
            hit = self.bar_answers.get(key)
        if hit is not None:
            return hit
        held = self.holding(token)
        cutoff = held["cutoff"]
        if b1 > math.ceil(cutoff):
            raise ValueError("b1 is after the pack's cutoff")
        stop = min(b1, math.floor(cutoff))
        bars, end = no_bars(), float(b0)
        if b0 < stop:
            try:
                response, bars, pins = bar_read(n, b0, stop)
            except MarketStateError as error:
                # The cube hasn't measured this time yet: no bars, measured up to where it has.
                if not (error.status == 409 and error.body.get("error") == "outside_coverage"):
                    raise
                end = min(float(b0), base_units(str(error.body["data_cutoff"])))
            else:
                self.check(pins, held, token)
                end = min(float(stop), base_units(response["data_cutoff"]))
        step = 2**n
        col0, col1 = b0 // step, max(b0 // step, -(-math.ceil(end) // step))
        answer = {
            "n": n, "b0": b0, "b1": b1, "end": end, "through": edge(end), "state_token": token,
            "cutoff": held["state"]["cutoff"], "canonical_through": held["state"]["canonical_through"],
            "bars": {
                "n": n, "col0": col0, "col1": col1, "count": len(bars["col"]), "layout": "MSCB",
                "encoding": "gzip+base64", "gzip_base64": mscb(n, col0, col1, bars),
            },
        }
        with self.lock:
            self.bar_answers[key] = answer
            while len(self.bar_answers) > BARS_HELD:
                del self.bar_answers[next(iter(self.bar_answers))]
        return answer

    def motion(self, tier_id: str, token: str, start: int | None) -> dict:
        """One tier of the page's pack with path, dwell, high and low (MSC3), up to the pack's
        last complete base column: the whole tier, or its columns from the one holding base
        edge ``start`` on, which the page puts in place of its own from that column.

        A page holding a tier's motion read under an earlier pack in the same line of packs
        (each a prefix of the next) keeps the columns before ``start``: they read the same
        partitions at the same revision and build.
        """
        tier = next((t for t in TIERS if t["id"] == tier_id), None)
        if tier is None:
            raise ValueError("tier must be overview, recent or reference")
        held = self.holding(token)
        n, m, step = tier["n"], tier["m"], 2 ** tier["n"]
        meta = held["tiers"][tier_id]["block"]
        closed = math.floor(held["cutoff"])
        stop = closed // step * step if tier.get("complete") else closed
        first = int(meta["b0"]) if start is None else max(int(meta["b0"]), start // step * step)
        key = (token, tier_id, first)
        with self.motion_building:
            with self.lock:
                hit = self.motions.get(key)
            if hit is not None:
                return hit
            cells, _, _, end = self.motion_read(n, m, first, stop, held, token)
            motion_block = block(n, m, float(first), max(float(first), end), cells, motion=True)
            # Where the pack's archived days end: a page reads again what it read after it once
            # the day's archive replaces those minutes, which the cube may measure differently.
            # From the tier's first column it is the whole tier, whether asked for whole or from an
            # edge before it: one cache key, one answer.
            answer = {
                "tier": tier_id, "col0": meta["col0"], "from": first // step, "whole": first == int(meta["b0"]),
                "end": end, "through": edge(end), "state_token": token,
                "canonical_through": held["state"]["canonical_through"], "block": motion_block,
            }
            with self.lock:
                self.motions[key] = answer
                while len(self.motions) > MOTION_HELD:
                    del self.motions[next(iter(self.motions))]
        print(f"motion {tier_id} from {first} for {token[:8]}: {motion_block['count']} cells", flush=True)
        return answer

    def motion_measure(self, spec: dict, token: str, summarized: bool) -> dict:
        """One rectangle's cells with path, dwell, high and low (MSC3), up to the last complete
        base column before the pack's cutoff, and with ``summarized`` the cube's summary of them."""
        n, m, b0, b1, r0, r1 = (spec[key] for key in ("n", "m", "b0", "b1", "r0", "r1"))
        held = self.holding(token)
        cutoff = held["cutoff"]
        if b1 > math.ceil(cutoff):
            raise ValueError("b1 is after the pack's cutoff")
        cells, response, summary, end = self.motion_read(n, m, b0, min(b1, math.floor(cutoff)), held, token, r0, r1)
        answer = {
            "cutoff": held["state"]["cutoff"], "end": end, "through": edge(end),
            "canonical_through": held["state"]["canonical_through"],
            "block": block(n, m, float(b0), max(float(b0), end), cells, motion=True),
        }
        if summarized:
            answer["summary"] = (
                {**cube_summary(summary, response, n, m), "path_length": summary["path_length"], "dwell": summary["dwell"]}
                if summary is not None
                else {"path_length": 0.0, "dwell": 0.0, "cell_count": 0, "source": "cube"}
            )
        return answer

    def html(self) -> bytes:
        text = self.page.read_text(encoding="utf-8")
        current, age = self.current_pack()
        # The pack with its timing, which names this page's version: the page compares it
        # with the version later answers name, and offers a reload when they differ.
        data = json.dumps({**current, **self.timing(age)}, separators=(",", ":")).replace("<", "\\u003c")
        replaced, hits = re.subn(
            r'(<script type="application/json" id="origo-lens-data">).*?(</script>)',
            lambda match: match.group(1) + data + match.group(2), text, count=1, flags=re.S,
        )
        if hits != 1:
            raise RuntimeError("index.html has no origo-lens-data block; run tools/build.py first.")
        return replaced.encode()

    def vendor_file(self, path: str) -> Path | None:
        """A file under vendor/ named by a flat file name; anything else is not served."""
        name = path.removeprefix("/vendor/")
        if path == name or Path(name).name != name or name.startswith("."):
            return None
        asset = self.page.parent / "vendor" / name
        return asset if asset.is_file() else None


def iso_or_none(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    return str(value)


def cube_summary(summary: dict, response: dict, n: int, m: int) -> dict:
    """The cube's own summary of a rectangle, as the page reads it."""
    effective = response.get("effective", {})
    return {
        "t1": iso_or_none(summary.get("t1") or effective.get("t1")),
        "t2": iso_or_none(summary.get("t2") or effective.get("t2")),
        "p1": summary.get("p1", effective.get("p1")), "p2": summary.get("p2", effective.get("p2")),
        "tR": BASE_SECONDS * 2**n, "pR": BASE_PRICE * 2**m,
        "first_column_partial": bool(summary.get("first_column_partial", False)),
        "last_column_partial": bool(summary.get("last_column_partial", False)),
        "first_row_partial": bool(summary.get("first_row_partial", False)),
        "last_row_partial": bool(summary.get("last_row_partial", False)),
        "last_column_unfinished": bool(summary.get("last_column_unfinished", False)),
        "volume": summary["volume"], "trade_count": int(summary["trade_count"]),
        "taker_buy_volume": summary["taker_buy_volume"], "taker_buy_trade_count": int(summary["taker_buy_trade_count"]),
        "poc": summary.get("poc"), "taker_buy_poc": summary.get("taker_buy_poc"),
        "cell_count": int(summary.get("cell_count", 0)), "source": "cube",
    }


def merged_summary(
    cells: dict, n: int, m: int, b0: int, b1: int, r0: int | None, r1: int | None,
    summary: dict | None, extent: tuple[int, int] | None, cutoff: float,
) -> dict:
    """The summary of a rectangle whose open column came from the pack, computed the way the
    cube computes its own: exact sums over the cells, and POCs from exact row sums."""
    if r0 is not None:
        p1, p2 = float(r0 * BASE_PRICE), float(r1 * BASE_PRICE)
    else:
        # Automatic prices: the cube's extent over the closed part, grown by the open column's.
        low = None if summary is None or summary.get("p1") is None else summary["p1"] / BASE_PRICE
        high = None if summary is None or summary.get("p2") is None else summary["p2"] / BASE_PRICE
        if extent:
            low = extent[0] if low is None else min(low, extent[0])
            high = extent[1] if high is None else max(high, extent[1])
        p1 = None if low is None else float(low * BASE_PRICE)
        p2 = None if high is None else float(high * BASE_PRICE)
    step_p = BASE_PRICE * 2**m
    return {
        "t1": edge(b0), "t2": edge(b1), "p1": p1, "p2": p2, "tR": BASE_SECONDS * 2**n, "pR": float(step_p),
        "first_column_partial": b0 % 2**n != 0,
        "last_column_partial": b1 % 2**n != 0,
        "first_row_partial": p1 is not None and p1 % step_p != 0,
        "last_row_partial": p2 is not None and p2 % step_p != 0,
        "last_column_unfinished": b1 > cutoff,
        **totals(cells),
        "poc": point_of_control(cells, "vol", m), "taker_buy_poc": point_of_control(cells, "tbvol", m),
        "cell_count": len(cells["col"]), "source": "cube+pack",
    }


class Handler(BaseHTTPRequestHandler):
    explorer: Explorer

    def do_POST(self) -> None:
        url = urlsplit(self.path)
        if url.path not in ("/cube/rallies", "/cube/rallies/view"):
            self.json({"error": "not_found"}, 404)
            return
        try:
            if parse_qs(url.query).get("proto") != [PROTOCOL]:
                self.json({"error": OUTDATED, "reload": True}, 409)
                return
            origin = self.headers.get("Origin")
            if origin and origin not in ("https://cube.vaquum.fi", "http://" + self.headers.get("Host", "")):
                self.json({"error": "invalid_origin"}, 403)
                return
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                raise ValueError("Content-Type must be application/json")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536:
                self.json({"error": "request_too_large"}, 413)
                return
            def unique(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError("duplicate JSON field")
                    result[key] = value
                return result
            def invalid_constant(value):
                raise ValueError(f"nonfinite JSON number: {value}")
            body = json.loads(self.rfile.read(length), object_pairs_hook=unique, parse_constant=invalid_constant)
            operation = self.explorer.rallies.view if url.path.endswith("/view") else self.explorer.rallies.discover
            self.json(operation(body))
        except (ValueError, TypeError, KeyError) as error:
            self.json({"error": "invalid_rally_request", "detail": str(error)}, 400)
        except CubeChanged as error:
            self.json({"error": "cube_changed", "detail": str(error)}, 409)
        except FileNotFoundError:
            self.json({"error": "rally_result_expired", "detail": "Canonical files expired; refresh discovery."}, 410)
        except MarketStateError as error:
            self.json(dict(error.body), error.status)
        except Exception as error:
            self.json({"error": "rally_bridge_failed", "detail": f"{type(error).__name__}: {error}"}, 502)

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if url.path == "/healthz":
            self.reply(200, "text/plain", b"ok")
            return
        try:
            args = parse_qs(url.query)
            if url.path.startswith("/cube/") and args.get("proto", [""])[0] != PROTOCOL:
                self.json({"error": OUTDATED, "reload": True}, 409)
                return
            if url.path in ("/", "/index.html"):
                self.reply(200, "text/html; charset=utf-8", self.explorer.html())
            elif url.path == "/cube/pack":
                since = args.get("since", [""])[0]
                self.json(self.explorer.update(since))
            elif url.path in ("/cube/tile", "/cube/query"):
                spec = rectangle(args, prices=url.path == "/cube/query")
                token = args.get("pack", [""])[0]
                if args.get("motion", [""])[0] == "1":
                    self.json(self.explorer.motion_measure(spec, token, summarized=url.path == "/cube/query"))
                    return
                answer = self.explorer.measure(spec, token)
                if url.path == "/cube/tile":
                    answer.pop("summary")
                self.json(answer)
            elif url.path == "/cube/motion":
                start = integer(args, "from") if "from" in args else None
                if start is not None and start < 0:
                    raise ValueError("from must be a base edge")
                self.json(self.explorer.motion(args.get("tier", [""])[0], args.get("pack", [""])[0], start))
            elif url.path == "/cube/columns":
                n, m = level(args)
                self.json(self.explorer.history(n, m, args.get("pack", [""])[0]))
            elif url.path == "/cube/bars":
                n, b0 = integer(args, "n"), integer(args, "b0")
                try:
                    b1 = float(args.get("b1", [""])[0])
                except (ValueError, TypeError):
                    raise ValueError("b1 must be a finite base position") from None
                if not math.isfinite(b1):
                    raise ValueError("b1 must be a finite base position")
                if n not in BAR_LEVELS:
                    raise ValueError("n must be 0..20: dyadic grid bars")
                step = 2**n
                if not (0 <= b0 < b1 and b0 % step == 0):
                    raise ValueError("b0 must be a bar's edge and b1 after it")
                if math.ceil(b1 / step) - b0 // step > MAX_COLUMNS:
                    raise ValueError(f"more than {MAX_COLUMNS} bars")
                self.json(self.explorer.bars(n, b0, b1, args.get("pack", [""])[0]))
            elif url.path == "/cube/touched":
                n, b0, b1 = integer(args, "n"), integer(args, "b0"), integer(args, "b1")
                if not 0 <= n < MAX_TIME_EXPONENT:
                    raise ValueError(f"n must be 0..{MAX_TIME_EXPONENT - 1}")
                span = 2 ** (n + 1)
                if not (0 <= b0 < b1 and b0 % span == 0 and b1 % span == 0):
                    raise ValueError("b0 and b1 must be the edges of whole parent columns, b0 < b1")
                if (b1 - b0) // 2**n > MAX_COLUMNS:
                    raise ValueError(f"more than {MAX_COLUMNS} columns")
                self.json(self.explorer.touched(n, b0, b1, args.get("pack", [""])[0]))
            elif (asset := self.explorer.vendor_file(url.path)) is not None:
                self.reply(200, VENDOR_TYPES.get(asset.suffix, "application/octet-stream"), asset.read_bytes())
            else:
                self.reply(404, "text/plain", b"not found")
        except ValueError as error:
            self.json({"error": str(error)}, 400)
        except CubeChanged as error:
            self.json({"error": "cube_changed", "detail": str(error)}, 409)
        except MarketStateError as error:  # the cube's own refusal, in its own words
            self.json({"error": error.body.get("error", "cube_error"), "detail": str(error)}, 503 if error.status == 503 else 502)
        except Exception as error:  # the page shows the message; nothing is substituted for the data
            self.json({"error": f"{type(error).__name__}: {error}"}, 502)

    do_HEAD = do_GET

    def json(self, body: dict, status: int = 200) -> None:
        self.reply(status, "application/json", json.dumps(body, separators=(",", ":")).encode())

    def reply(self, status: int, kind: str, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("%s %s\n" % (self.address_string(), format % args))


def integer(args: dict, key: str) -> int:
    try:
        value = float(args[key][0])
    except (KeyError, IndexError, ValueError):
        raise ValueError(f"{key} must be an integer") from None
    if not value.is_integer():
        raise ValueError(f"{key} must be an integer")
    return int(value)


def level(args: dict) -> tuple[int, int]:
    n, m = integer(args, "n"), integer(args, "m")
    if not (0 <= n <= MAX_TIME_EXPONENT and 0 <= m <= MAX_PRICE_EXPONENT):
        raise ValueError(f"n must be 0..{MAX_TIME_EXPONENT} and m 0..{MAX_PRICE_EXPONENT}")
    return n, m


def rectangle(args: dict, prices: bool) -> dict:
    """A rectangle in base columns and rows, checked: at most MAX_COLUMNS columns wide."""
    n, m = level(args)
    b0, b1 = integer(args, "b0"), integer(args, "b1")
    if not 0 <= b0 < b1:
        raise ValueError("b0 and b1 must be base edges with b0 < b1")
    if -(-b1 // 2**n) - b0 // 2**n > MAX_COLUMNS:
        raise ValueError(f"more than {MAX_COLUMNS} columns")
    r0 = r1 = None
    if prices and ("r0" in args or "r1" in args):
        r0, r1 = integer(args, "r0"), integer(args, "r1")
        if not 0 <= r0 < r1 <= 2**32:
            raise ValueError("r0 and r1 must be base rows with r0 < r1")
    return {"n": n, "m": m, "b0": b0, "b1": b1, "r0": r0, "r1": r1}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the explorer on live market state cube data.")
    parser.add_argument("--page", type=Path, default=Path(__file__).resolve().parents[1] / "index.html")
    parser.add_argument("--port", type=int, default=8487)
    arguments = parser.parse_args(argv)
    Handler.explorer = Explorer(arguments.page)
    # Loopback only, and not configurable: the server checks no credentials, so the portal-gated
    # Caddy on this host must be the only way to it.
    with ThreadingHTTPServer(("127.0.0.1", arguments.port), Handler) as httpd:
        print(f"explorer on http://127.0.0.1:{arguments.port} · cube at {CUBE_URL}", flush=True)
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
