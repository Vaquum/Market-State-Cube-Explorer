#!/usr/bin/env python3
"""Serve the explorer on the Origo host from the live market state cube (PRD-0022).

The cube's query service answers with paths to Arrow files on its own volume, so this server
runs beside that volume. It asks the service for tiles, reads the files through the cube's
supported reader (``market_state_reader.py``, a pinned copy, which renews each file's 24-hour
clock) and hands the page MSC1 blocks in the shape of ``data/snapshot.json``.

Routes, all behind HTTP Basic Auth except ``/healthz``:

- ``/``: ``index.html`` with a live pack in place of the recorded snapshot. The pack holds the
  three snapshot tiers cut at the last complete base column before the cube's data cutoff,
  fixed once per pack; the partitions its tiers share must carry the same revision, and its
  token digests every pin it read. It is rebuilt at most once a minute.
- ``/vendor/<file>``: the vendored scripts, flat file names only.
- ``/cube/tile?n&m&b0&b1&pack``: one finer tile, at most 4,096 columns, for the page holding
  pack ``pack``; refused unless every partition it read is one that pack read, at the same
  revision.

Credentials come from ``EXPLORER_AUTH_USER`` and ``EXPLORER_AUTH_PASS``; the server refuses to
start without them. ``MARKET_STATE_URL`` names the cube service (default ``http://127.0.0.1:8486``).

MSC1 (little-endian): 32-byte header ``magic n m pad col0 col1 count 12x`` then columnar
arrays volume f64, taker-buy volume f64, column u32, row u32, trades u32, taker-buy trades
u32, cells sorted by (column, row). Columns and rows are absolute indices at the tile's own
level (n, m), anchored at 2021-01-01T00:00:00Z.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import struct
import sys
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from market_state_reader import query, read_table  # noqa: E402

T0 = 1609459200
BASE_SECONDS = 56.25
BASE_PRICE = 125
DAY = 1536  # base columns per day
PACK_MAX_AGE_SECONDS = 60
PACKS_HELD = 16
MAX_TILE_COLUMNS = 4096
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
    "Recent has the last seven days at base resolution up to the last complete base column before the cube's data cutoff.",
    "Reference has 30 days of completed 15-minute columns. Filter each candidate outcome to end before the replay anchor.",
    "Overview is contextual: 64 hours × 1000 USDT over the whole history.",
    "Finer detail for any window is fetched from the cube on demand.",
]


def edge(base_index: float) -> str:
    return datetime.fromtimestamp(T0 + base_index * BASE_SECONDS, UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def base_units(stamp: str) -> float:
    return (datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() - T0) / BASE_SECONDS


# ---------------------------------------------------------------- reading the cube


def tile(n: int, m: int, b0: float, b1: float) -> tuple[dict, dict, dict]:
    """One level-(n, m) block over base columns [b0, b1): the block, the response, its pins."""
    import numpy as np

    result = query(t1=edge(b0), t2=edge(b1), tR=BASE_SECONDS * 2**n, pR=BASE_PRICE * 2**m, url=CUBE_URL)
    cells = read_table(result.cells, url=CUBE_URL)
    meta = json.loads(cells.schema.metadata[b"origo.market_state"])
    grid = meta["grid"]
    if (grid["time_exponent"], grid["price_exponent"]) != (n, m):
        raise RuntimeError(f"Cube answered level {grid} for requested ({n}, {m}).")
    pins = {pin[0]: list(pin[1:]) for pin in meta["pins"]}
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
    summary = read_table(result.summary, url=CUBE_URL).to_pylist()[0]
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
    return block, response, pins


def pack() -> tuple[dict, dict]:
    """The three tiers as one consistent pack, plus every pin the pack read.

    One empty query fixes the cutoff and every tier is bounded to that base edge; every
    partition a later tier reads must then be one the overview read, at the same generation,
    revision and build id, or the cube changed under the pack and it is read again once.
    """
    for _attempt in range(2):
        state = dict(query(t1=edge(0), t2=edge(0.001), url=CUBE_URL).response)
        cutoff = int(base_units(state["data_cutoff"]))
        blocks: dict[str, dict] = {}
        pinned: dict[str, list] = {}
        conflict = None
        for tier in TIERS:
            step = 2 ** tier["n"]
            b1 = (cutoff // step) * step if tier.get("complete") else cutoff
            b0 = 0 if "days" not in tier else (b1 - tier["days"] * DAY) // step * step
            blocks[tier["id"]], _, pins = tile(tier["n"], tier["m"], b0, b1)
            if not pinned:
                pinned = pins  # the overview comes first and reads every partition up to the cutoff
            else:
                # Every partition a later tier read must be one the overview read, at the same
                # revision; a provisional minute replaced by an archive day appears as a new key.
                conflict = conflict or next((key for key, identity in pins.items() if pinned.get(key) != identity), None)
        if conflict is None:
            break
    else:
        raise RuntimeError(f"The cube changed while the pack was read (partition {conflict}); try again.")
    digest = hashlib.sha256(json.dumps(sorted(pinned.items()), separators=(",", ":")).encode()).hexdigest()
    return {
        "source": SOURCE, "t0": T0, "base_seconds": BASE_SECONDS, "base_price": BASE_PRICE,
        "cutoff": edge(cutoff), "cutoffBase": cutoff, "data_cutoff": state["data_cutoff"],
        "canonical_through": state["canonical_through"], "state_token": digest,
        "partitions": len(pinned), "snapshot": False, "live": True, "notes": NOTES, "blocks": blocks,
    }, pinned


# ---------------------------------------------------------------- serving the page


class CubeChanged(Exception):
    """A tile read a partition at a different revision than the pack the page holds."""


class Explorer:
    def __init__(self, page: Path, user: str, password: str) -> None:
        self.page = page
        self.expected = f"{user}:{password}".encode()
        self.lock = threading.Lock()
        self.pack: dict | None = None
        self.pins: dict[str, dict[str, list]] = {}  # pack token -> the pins that pack read
        self.packed_at = 0.0

    def allows(self, header: str | None) -> bool:
        match = CREDENTIALS.match(header or "")
        if not match or len(match.group(1)) % 4:
            return False
        return hmac.compare_digest(base64.b64decode(match.group(1)), self.expected)

    def current_pack(self) -> dict:
        with self.lock:
            if self.pack is None or time.monotonic() - self.packed_at > PACK_MAX_AGE_SECONDS:
                started = time.monotonic()
                self.pack, pinned = pack()
                self.pins[self.pack["state_token"]] = pinned
                while len(self.pins) > PACKS_HELD:
                    del self.pins[next(iter(self.pins))]
                self.packed_at = time.monotonic()
                cells = sum(b["count"] for b in self.pack["blocks"].values())
                print(f"pack built in {self.packed_at - started:.1f} s, cutoff {self.pack['cutoff']}, {cells} cells", flush=True)
            return self.pack

    def tile(self, spec: dict, token: str) -> dict:
        """One tile for the page holding pack ``token``.

        Every partition the tile read must be one that pack read, at the same generation,
        revision and build id; a pack this server no longer holds is refused the same way.
        """
        with self.lock:
            held = self.pins.get(token)
        if held is None:
            raise CubeChanged("the page's pack is no longer held by the server")
        block, response, pins = tile(spec["n"], spec["m"], spec["b0"], spec["b1"])
        changed = [key for key, identity in pins.items() if held.get(key) != identity]
        if changed:
            raise CubeChanged(f"{len(changed)} partition(s) differ from the page's pack, first {changed[0]}")
        return {"cutoff": response["data_cutoff"], "block": block}

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

    def vendor_file(self, path: str) -> Path | None:
        """A file under vendor/ named by a flat file name; anything else is not served."""
        name = path.removeprefix("/vendor/")
        if path == name or Path(name).name != name or name.startswith("."):
            return None
        asset = self.page.parent / "vendor" / name
        return asset if asset.is_file() else None


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
            if url.path in ("/", "/index.html"):
                self.reply(200, "text/html; charset=utf-8", self.explorer.html())
            elif url.path == "/cube/tile":
                self.reply(200, "application/json", json.dumps(self.tile(parse_qs(url.query))).encode())
            elif (asset := self.explorer.vendor_file(url.path)) is not None:
                self.reply(200, VENDOR_TYPES.get(asset.suffix, "application/octet-stream"), asset.read_bytes())
            else:
                self.reply(404, "text/plain", b"not found")
        except ValueError as error:
            self.reply(400, "application/json", json.dumps({"error": str(error)}).encode())
        except CubeChanged as error:
            self.reply(409, "application/json", json.dumps({"error": "cube_changed", "detail": str(error)}).encode())
        except Exception as error:  # the page shows the message; nothing is substituted for the data
            self.reply(502, "application/json", json.dumps({"error": f"{type(error).__name__}: {error}"}).encode())

    do_HEAD = do_GET

    def tile(self, args: dict) -> dict:
        n, m, b0, b1 = (float(args[key][0]) for key in ("n", "m", "b0", "b1"))
        token = args.get("pack", [""])[0]
        if not (n.is_integer() and m.is_integer() and 0 <= n <= 20 and 0 <= m <= 9):
            raise ValueError("n must be 0..20 and m 0..9")
        if not (b0.is_integer() and b1.is_integer() and 0 <= b0 < b1):
            raise ValueError("b0 and b1 must be base edges with b0 < b1")
        if (b1 - b0) / 2 ** int(n) > MAX_TILE_COLUMNS:
            raise ValueError(f"tile wider than {MAX_TILE_COLUMNS} columns")
        return self.explorer.tile({"n": int(n), "m": int(m), "b0": b0, "b1": b1}, token)

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
