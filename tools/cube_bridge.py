#!/usr/bin/env python3
"""Bridge between the explorer and the market state cube (Origo PRD-0022).

The cube's query service answers with paths to Arrow files on its own volume, so the page
cannot read it directly. This file has two roles:

``fetch`` runs where the volume is mounted (the ``market-state`` container) and needs only
pyarrow, numpy and ``origo.query.market_state_reader``, the supported cube reader. It takes
one JSON spec of tiles, asks the service for each, reads the Arrow files through the reader
(which renews their 24-hour clock) and prints a pack: the same JSON shape as
``data/snapshot.json``, with each tile as a gzip+base64 MSC1 block.

``serve`` runs anywhere with the standard library. It serves ``index.html`` with the live
pack in place of the recorded snapshot, and answers ``/cube/tile`` for finer tiles the page
asks for. The pack's cutoff is the last complete base column before the cube's data cutoff,
fixed once per pack, and every tier and tile is bounded to it. It obtains packs by running ``fetch`` through a command prefix such as
``ssh HOST docker exec -i tdw-control-plane-market-state-1``, sending this file on stdin, or
in-process when the reader is importable.

MSC1 (little-endian): 32-byte header ``magic n m pad col0 col1 count 12x`` then columnar
arrays volume f64, taker-buy volume f64, column u32, row u32, trades u32, taker-buy trades
u32, cells sorted by (column, row). Columns and rows are absolute indices at the tile's own
level (n, m), anchored at 2021-01-01T00:00:00Z.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import re
import shlex
import struct
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

T0 = 1609459200
BASE_SECONDS = 56.25
BASE_PRICE = 125
DAY = 1536  # base columns per day
PACK_MAX_AGE_SECONDS = 60
MAX_TILE_COLUMNS = 4096
SOURCE = "Binance BTCUSDT spot · Origo market state cube"
VENDOR_TYPES = {".js": "application/javascript", ".css": "text/css", ".txt": "text/plain", ".md": "text/markdown"}
TIERS = (
    {"id": "overview", "n": 12, "m": 3},
    {"id": "recent", "n": 0, "m": 0, "days": 7},
    {"id": "reference", "n": 4, "m": 0, "days": 30, "complete": True},
)
NOTES = [
    "Every block is read live from the market state cube through its supported reader.",
    "Recent has the last seven days at base resolution up to the last complete base column before the cube's data cutoff.",
    "Reference has 30 days of completed 15-minute columns. Filter each candidate outcome to end before the replay anchor.",
    "Overview is contextual: 64 hours × 1000 USDT over the whole history.",
    "Finer detail for any window is fetched from the cube on demand.",
]


def edge(base_index: float) -> str:
    return datetime.fromtimestamp(T0 + base_index * BASE_SECONDS, UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def base_units(stamp: str) -> float:
    return (datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() - T0) / BASE_SECONDS


# ---------------------------------------------------------------- fetch (runs beside the volume)


def fetch(spec: dict) -> dict:
    import numpy as np
    from origo.query.market_state_reader import query, read_table

    def tile(n: int, m: int, b0: float, b1: float) -> tuple[dict, dict]:
        result = query(t1=edge(b0), t2=edge(b1), tR=BASE_SECONDS * 2**n, pR=BASE_PRICE * 2**m)
        cells = read_table(result.cells)
        grid = json.loads(cells.schema.metadata[b"origo.market_state"])["grid"]
        if (grid["time_exponent"], grid["price_exponent"]) != (n, m):
            raise RuntimeError(f"Cube answered level {grid} for requested ({n}, {m}).")
        col = cells.column("time_index").to_numpy().astype(np.uint64)
        row = cells.column("price_index").to_numpy().astype(np.uint64)
        order = np.lexsort((row, col))
        columns = {
            "vol": cells.column("volume").to_numpy()[order].astype("<f8"),
            "tbvol": cells.column("taker_buy_volume").to_numpy()[order].astype("<f8"),
            "col": col[order].astype("<u4"),
            "row": row[order].astype("<u4"),
            "cnt": cells.column("trade_count").to_numpy()[order].astype("<u4"),
            "tbcnt": cells.column("taker_buy_trade_count").to_numpy()[order].astype("<u4"),
        }
        response = dict(result.response)
        cutoff = base_units(response["data_cutoff"])
        start = base_units(response["effective"]["t1"])
        stop = min(base_units(response["effective"]["t2"]), cutoff)
        col0, col1 = int(start // 2**n), int(-(-stop // 2**n))
        count = len(col)
        header = struct.pack("<4sBBHIII12x", b"MSC1", n, m, 0, col0, col1, count)
        payload = header + b"".join(columns[key].tobytes() for key in ("vol", "tbvol", "col", "row", "cnt", "tbcnt"))
        summary = read_table(result.summary).to_pylist()[0]
        block = {
            "n": n, "m": m, "b0": start, "b1": stop, "start": edge(start), "end": edge(stop),
            "count": count, "col0": col0, "col1": col1, "encoding": "gzip+base64", "layout": "MSC1",
            "gzip_base64": base64.b64encode(gzip.compress(payload, compresslevel=6)).decode(),
            "totals": {
                "volume": summary["volume"], "buyVolume": summary["taker_buy_volume"],
                "trades": summary["trade_count"], "buyTrades": summary["taker_buy_trade_count"],
            },
            "result_id": response["result_id"],
            "data_cutoff": response["data_cutoff"],
            "state_token": response["state_token"],
        }
        return block, response

    if "tile" in spec:
        t = spec["tile"]
        block, response = tile(int(t["n"]), int(t["m"]), float(t["b0"]), float(t["b1"]))
        return {"cutoff": response["data_cutoff"], "block": block}
    # One empty query fixes the cutoff; every tier is then bounded to the same base edge, so
    # the pack cannot mix cube states even though the cube advances between the queries.
    state = dict(query(t1=edge(0), t2=edge(0.001)).response)
    cutoff = int(base_units(state["data_cutoff"]))
    blocks = {}
    for tier in TIERS:
        step = 2 ** tier["n"]
        b1 = (cutoff // step) * step if tier.get("complete") else cutoff
        b0 = 0 if "days" not in tier else (b1 - tier["days"] * DAY) // step * step
        blocks[tier["id"]], _ = tile(tier["n"], tier["m"], b0, b1)
    return {
        "source": SOURCE, "t0": T0, "base_seconds": BASE_SECONDS, "base_price": BASE_PRICE,
        "cutoff": edge(cutoff), "cutoffBase": cutoff, "data_cutoff": state["data_cutoff"],
        "canonical_through": state["canonical_through"], "state_token": state["state_token"],
        "snapshot": False, "live": True, "notes": NOTES, "blocks": blocks,
    }


# ---------------------------------------------------------------- serve (runs anywhere)


class Bridge:
    def __init__(self, page: Path, remote: str | None) -> None:
        self.page, self.remote = page, remote
        self.lock = threading.Lock()
        self.pack: dict | None = None
        self.packed_at = 0.0

    def run(self, spec: dict) -> dict:
        if self.remote is None:
            return fetch(spec)
        prefix = shlex.split(self.remote)
        # ssh hands the command to a remote shell, which splits it again; a local prefix does not.
        argument = shlex.quote(json.dumps(spec)) if Path(prefix[0]).name == "ssh" else json.dumps(spec)
        command = [*prefix, "python", "-", "fetch", argument]
        done = subprocess.run(command, input=Path(__file__).read_bytes(), capture_output=True, timeout=600)
        if done.returncode != 0:
            raise RuntimeError(done.stderr.decode(errors="replace").strip().splitlines()[-1] if done.stderr else f"fetch exited {done.returncode}")
        return json.loads(done.stdout)

    def current_pack(self) -> dict:
        with self.lock:
            if self.pack is None or time.monotonic() - self.packed_at > PACK_MAX_AGE_SECONDS:
                started = time.monotonic()
                self.pack = self.run({"pack": True})
                self.packed_at = time.monotonic()
                cells = sum(b["count"] for b in self.pack["blocks"].values())
                print(f"pack built in {self.packed_at - started:.1f} s, cutoff {self.pack['cutoff']}, {cells} cells", flush=True)
            return self.pack

    def html(self) -> bytes:
        text = self.page.read_text(encoding="utf-8")
        data = json.dumps(self.current_pack(), separators=(",", ":")).replace("<", "\\u003c")
        replaced, hits = re.subn(
            r'(<script type="application/json" id="origo-lens-data">).*?(</script>)',
            lambda match: match.group(1) + data + match.group(2), text, count=1, flags=re.S,
        )
        if hits != 1:
            raise RuntimeError("index.html has no origo-lens-data block; run tools/build.py first.")
        return replaced.encode()


class Handler(BaseHTTPRequestHandler):
    bridge: Bridge

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        try:
            if url.path in ("/", "/index.html"):
                self.reply(200, "text/html; charset=utf-8", self.bridge.html())
            elif url.path == "/cube/tile":
                self.reply(200, "application/json", json.dumps(self.tile(parse_qs(url.query))).encode())
            elif (asset := self.vendor_file(url.path)) is not None:
                self.reply(200, VENDOR_TYPES.get(asset.suffix, "application/octet-stream"), asset.read_bytes())
            else:
                self.reply(404, "text/plain", b"not found")
        except ValueError as error:
            self.reply(400, "application/json", json.dumps({"error": str(error)}).encode())
        except Exception as error:  # the page reports the message; nothing is substituted for the data
            self.reply(502, "application/json", json.dumps({"error": f"{type(error).__name__}: {error}"}).encode())

    def vendor_file(self, path: str) -> Path | None:
        """A file under vendor/ named by a flat file name; anything else is not served."""
        name = path.removeprefix("/vendor/")
        if path == name or Path(name).name != name or name.startswith("."):
            return None
        asset = self.bridge.page.parent / "vendor" / name
        return asset if asset.is_file() else None

    def tile(self, args: dict) -> dict:
        n, m, b0, b1 = (float(args[key][0]) for key in ("n", "m", "b0", "b1"))
        if not (n.is_integer() and m.is_integer() and 0 <= n <= 20 and 0 <= m <= 9):
            raise ValueError("n must be 0..20 and m 0..9")
        if not (b0.is_integer() and b1.is_integer() and 0 <= b0 < b1):
            raise ValueError("b0 and b1 must be base edges with b0 < b1")
        if (b1 - b0) / 2 ** int(n) > MAX_TILE_COLUMNS:
            raise ValueError(f"tile wider than {MAX_TILE_COLUMNS} columns")
        return self.bridge.run({"tile": {"n": int(n), "m": int(m), "b0": b0, "b1": b1}})

    def reply(self, status: int, kind: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("%s %s\n" % (self.address_string(), format % args))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    fetcher = commands.add_parser("fetch", help="print a pack or one tile as JSON (needs the cube reader)")
    fetcher.add_argument("spec", help='{"pack": true} or {"tile": {"n", "m", "b0", "b1"}}')
    server = commands.add_parser("serve", help="serve the explorer on live cube data")
    server.add_argument("--page", type=Path, default=Path(__file__).resolve().parents[1] / "index.html")
    server.add_argument("--remote", help='command prefix that reaches the cube volume, e.g. "ssh HOST docker exec -i tdw-control-plane-market-state-1"')
    server.add_argument("--bind", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8080)
    arguments = parser.parse_args(argv)
    if arguments.command == "fetch":
        json.dump(fetch(json.loads(arguments.spec)), sys.stdout, separators=(",", ":"))
        return 0
    Handler.bridge = Bridge(arguments.page, arguments.remote)
    with ThreadingHTTPServer((arguments.bind, arguments.port), Handler) as httpd:
        print(f"explorer on http://{arguments.bind}:{arguments.port} · cube via {arguments.remote or 'in-process reader'}", flush=True)
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
