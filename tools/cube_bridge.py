#!/usr/bin/env python3
"""Serve the explorer on the Origo host from the live market state cube (PRD-0022).

The cube's query service answers with paths to Arrow files on its own volume, so this server
runs beside that volume. It asks the service for tiles, reads the files through the cube's
supported reader (``market_state_reader.py``, a pinned copy, which renews each file's 24-hour
clock) and hands the page MSC2 blocks.

Routes, all behind HTTP Basic Auth except ``/healthz``:

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
- ``/cube/tile?n&m&b0&b1&pack``: the same without price bounds or summary, for pages that
  predate ``/cube/query``.
- ``/cube/columns?n&m&pack``: each column's POC, volume and taker-buy volume at level (n, m),
  for up to the last 100,000 complete columns: the history the continuations compare.
- ``/vendor/<file>``: the vendored scripts, flat file names only.

Credentials come from ``EXPLORER_AUTH_USER`` and ``EXPLORER_AUTH_PASS``; the server refuses to
start without them. ``MARKET_STATE_URL`` names the cube service (default ``http://127.0.0.1:8486``).

MSC2 (little-endian): 32-byte header ``magic n m pad col0 col1 count 12x`` then columnar
arrays volume f64, taker-buy volume f64, trades f64, taker-buy trades f64, column u32, row u32,
cells sorted by (column, row). Columns and rows are absolute indices at the block's own level
(n, m), anchored at 2021-01-01T00:00:00Z. Trade counts travel as f64, exact below 2**53.
MSCC: the same header, then column u32, POC row u32, volume f32, taker-buy volume f32.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import hmac
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

T0 = 1609459200
BASE_SECONDS = 56.25
BASE_PRICE = 125
DAY = 1536  # base columns per day
PACK_MAX_AGE_SECONDS = 60
PACKS_HELD = 16
FIELDS = ("vol", "tbvol", "cnt", "tbcnt", "col", "row")  # MSC2 order
MAX_COLUMNS = 4096
MAX_CELLS = 1_000_000
HISTORY_COLUMNS = 100_000
MAX_TIME_EXPONENT = 24
MAX_PRICE_EXPONENT = 12
# The service runs two queries at once for every consumer: this server takes one at a time,
# and waits out a busy service this long before it gives up.
BUSY_WAIT_SECONDS = 20.0
CUBE_SLOT = threading.Lock()
CUBE_URL = os.environ.get("MARKET_STATE_URL", "http://127.0.0.1:8486")
SOURCE = "Binance BTCUSDT spot · Origo market state cube"
CHALLENGE = 'Basic realm="Market State Cube", charset="UTF-8"'
CREDENTIALS = re.compile(r"^basic +([A-Za-z0-9+/]+={0,2})$", re.IGNORECASE)
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


def cube_query(t1: str, t2: str | None, p1: int | None, p2: int | None, tR: float, pR: int) -> tuple[dict, Any, dict]:
    """One cube query and its two files, read through the supported reader.

    Queries go one at a time; a busy service is asked again for up to BUSY_WAIT_SECONDS.
    """
    deadline = time.monotonic() + BUSY_WAIT_SECONDS
    while True:
        try:
            with CUBE_SLOT:
                result = query(t1=t1, t2=t2, p1=p1, p2=p2, tR=tR, pR=pR, url=CUBE_URL)
            break
        except MarketStateError as error:
            if error.status != 503 or time.monotonic() >= deadline:
                raise
        time.sleep(1.0)
    cells = read_table(result.cells, url=CUBE_URL)
    summary = read_table(result.summary, url=CUBE_URL).to_pylist()[0]
    return dict(result.response), cells, summary


def arrays(table: Any) -> dict:
    """A cells table as columnar arrays in MSC2 order, sorted by (column, row)."""
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
    return {
        "vol": table.column("volume").to_numpy()[order].astype("<f8"),
        "tbvol": table.column("taker_buy_volume").to_numpy()[order].astype("<f8"),
        "cnt": cnt[order].astype("<f8"),
        "tbcnt": tbcnt[order].astype("<f8"),
        "col": col[order].astype("<u4"),
        "row": row[order].astype("<u4"),
    }


def read(n: int, m: int, b0: int, b1: int | None, r0: int | None = None, r1: int | None = None) -> tuple[dict, dict, dict, dict]:
    """The cube's level-(n, m) cells over base columns [b0, b1), and base rows [r0, r1) when
    given: its response, its cells, its summary and the pins it read. Without ``b1`` the
    time runs to the cube's data cutoff; without rows the prices are automatic."""
    response, table, summary = cube_query(
        t1=edge(b0),
        t2=None if b1 is None else edge(b1),
        p1=None if r0 is None else r0 * BASE_PRICE,
        p2=None if r1 is None else r1 * BASE_PRICE,
        tR=BASE_SECONDS * 2**n,
        pR=BASE_PRICE * 2**m,
    )
    meta = json.loads(table.schema.metadata[b"origo.market_state"])
    grid = meta["grid"]
    if (grid["time_exponent"], grid["price_exponent"]) != (n, m):
        raise RuntimeError(f"Cube answered level {grid} for requested ({n}, {m}).")
    cells = arrays(table)
    if len(cells["col"]) > MAX_CELLS:
        raise ValueError(f"{len(cells['col'])} cells is more than {MAX_CELLS}; ask for coarser cells")
    return response, cells, summary, {pin[0]: list(pin[1:]) for pin in meta["pins"]}


def msc2(n: int, m: int, col0: int, col1: int, cells: dict, first: int = 0) -> str:
    """The cells from index ``first`` on as one MSC2 payload, gzipped and base64-encoded."""
    header = struct.pack("<4sBBHIII12x", b"MSC2", n, m, 0, col0, col1, len(cells["col"]) - first)
    payload = header + b"".join(cells[key][first:].tobytes() for key in FIELDS)
    return base64.b64encode(gzip.compress(payload, compresslevel=6)).decode()


def block(n: int, m: int, b0: float, b1: float, cells: dict) -> dict:
    """A level-(n, m) block over base time [b0, b1): its columns, its cells and their range."""
    col0, col1 = int(b0 // 2**n), int(-(-b1 // 2**n))
    return {
        "n": n, "m": m, "b0": b0, "b1": b1, "start": edge(b0), "end": edge(b1),
        "count": len(cells["col"]), "col0": col0, "col1": col1, "encoding": "gzip+base64", "layout": "MSC2",
        "gzip_base64": msc2(n, m, col0, col1, cells),
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
    read, at the same generation, revision and build id, or the cube changed under the pack and
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
    tier's end edge, hold the same cells in both. A backfill or a revision fails one of the
    two, and the page then takes the whole pack. Each tier travels as its cells from that
    column on, which the page puts in place of its own from the same column; the old open
    column is among them.
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
        if not all(
            np.array_equal(before["cells"][key][kept[0][0]:kept[0][1]], after["cells"][key][kept[1][0]:kept[1][1]])
            for key in FIELDS
        ):
            return None
        tail = msc2(tier["n"], tier["m"], meta["col0"], meta["col1"], after["cells"], int(kept[1][1]))
        blocks[tier["id"]] = {**meta, "from": first, "gzip_base64": tail}
    return blocks


# ---------------------------------------------------------------- serving the page


class Explorer:
    def __init__(self, page: Path, user: str, password: str) -> None:
        self.page = page
        self.expected = f"{user}:{password}".encode()
        self.lock = threading.Lock()  # guards the fields below; never held while the cube is read
        self.building = threading.Lock()  # one pack build at a time
        self.pack: dict | None = None
        self.stale = False  # a read found the current pack behind the cube: rebuild it now
        self.held: dict[str, dict] = {}  # pack token -> the pins that pack read, its tiers, its cutoff
        self.packed_at = 0.0
        # When the cube's data cutoff last moved, on this server's clock. The first pack
        # starts it at the cutoff itself: a cube that stalled before the server started is
        # already quiet, rather than fresh.
        self.data_cutoff: str | None = None
        self.advanced_at = 0.0
        # The page this server serves: an open page from an earlier deploy learns that it is
        # older than the server it asks, and offers a reload.
        self.version = hashlib.sha256(page.read_bytes()).hexdigest()[:12]

    def allows(self, header: str | None) -> bool:
        match = CREDENTIALS.match(header or "")
        if not match or len(match.group(1)) % 4:
            return False
        return hmac.compare_digest(base64.b64decode(match.group(1)), self.expected)

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
                self.held[built["state_token"]] = {"pins": pinned, "tiers": tiers, "cutoff": built["cutoffBase"], "pack": built}
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

    def measure(self, spec: dict, token: str) -> dict:
        """The cube's cells and summary for one rectangle, for the page holding pack ``token``.

        The rectangle is read from the cube up to the last complete base column before the
        pack's cutoff; the open column, when the rectangle reaches it, is the pack's own, so
        the answer is the state the page holds even after the cube has moved on.
        """
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
        if not opened and summary is not None:
            answer = cube_summary(summary, response, n, m)
        else:
            if cells is None:
                cells = {key: held["tiers"]["recent"]["cells"][key][:0] for key in FIELDS}
            extra = {key: value[:0] for key, value in cells.items()}
            extent = None
            if opened:
                recent = held["tiers"]["recent"]["cells"]
                keep = recent["col"] == closed
                if r0 is not None:
                    keep &= (recent["row"] >= r0) & (recent["row"] < r1)
                extra = {key: recent[key][keep] for key in FIELDS}
                if len(extra["row"]):
                    extent = (int(extra["row"].min()), int(extra["row"].max()) + 1)
            cells = merge(cells, extra, n, m)
            answer = merged_summary(cells, n, m, b0, top if opened else b1, r0, r1, summary, extent, cutoff)
        end = min(float(top if opened else b1), cutoff)
        pack_state = held["pack"]
        answer.update(
            data_cutoff=pack_state["data_cutoff"], canonical_through=pack_state["canonical_through"],
            state_token=pack_state["state_token"],
        )
        return {"cutoff": pack_state["cutoff"], "block": block(n, m, float(b0), end, cells), "summary": answer}

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
            "cutoff": held["pack"]["cutoff"],
            "columns": {
                "n": n, "m": m, "b0": start, "b1": end, "count": len(cols["col"]), "layout": "MSCC",
                "gzip_base64": base64.b64encode(gzip.compress(payload, compresslevel=6)).decode(),
            },
        }

    def html(self) -> bytes:
        text = self.page.read_text(encoding="utf-8")
        current, age = self.current_pack()
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

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if url.path == "/healthz":
            self.reply(200, "text/plain", b"ok")
            return
        if not self.explorer.allows(self.headers.get("Authorization")):
            self.reply(401, "text/plain", b"Authentication required.", {"WWW-Authenticate": CHALLENGE})
            return
        try:
            args = parse_qs(url.query)
            if url.path in ("/", "/index.html"):
                self.reply(200, "text/html; charset=utf-8", self.explorer.html())
            elif url.path == "/cube/pack":
                since = args.get("since", [""])[0]
                self.json(self.explorer.update(since))
            elif url.path in ("/cube/tile", "/cube/query"):
                spec = rectangle(args, prices=url.path == "/cube/query")
                answer = self.explorer.measure(spec, args.get("pack", [""])[0])
                if url.path == "/cube/tile":
                    answer.pop("summary")
                self.json(answer)
            elif url.path == "/cube/columns":
                n, m = level(args)
                self.json(self.explorer.history(n, m, args.get("pack", [""])[0]))
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
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8487)
    arguments = parser.parse_args(argv)
    user, password = os.environ.get("EXPLORER_AUTH_USER"), os.environ.get("EXPLORER_AUTH_PASS")
    if not user or not password:
        raise SystemExit("EXPLORER_AUTH_USER and EXPLORER_AUTH_PASS are required.")
    Handler.explorer = Explorer(arguments.page, user, password)
    with ThreadingHTTPServer((arguments.bind, arguments.port), Handler) as httpd:
        print(f"explorer on http://{arguments.bind}:{arguments.port} · cube at {CUBE_URL}", flush=True)
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
