"""Native rally discovery and bounded views of retained canonical Arrow files."""
from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from datetime import UTC, datetime

from market_state_reader import MarketStateError, open_file, rallies

META = b"origo.market_state_rallies"
MAX_EVENTS = 5000
MAX_MEMBERS = 25000
MAX_REPLY = 8 * 1024 * 1024
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
FIELDS = ("volume", "taker_buy_volume", "trade_count", "taker_buy_trade_count")


def stamp(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamps must be ISO strings with a UTC offset")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamps need a UTC offset")
    return parsed.astimezone(UTC)


def micros(value: datetime) -> int:
    delta = value - EPOCH
    return (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds


def wire(row: dict) -> dict:
    out = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.isoformat(timespec="microseconds").replace("+00:00", "Z")
            out[key + "_us"] = micros(value)
        elif key.endswith("trade_id") and value is not None:
            out[key] = str(value)
        else:
            out[key] = value
    return out


def bounded(body: dict) -> dict:
    if len(json.dumps(body, separators=(",", ":"), allow_nan=False).encode()) > MAX_REPLY:
        raise MarketStateError(413, {"error": "rally_view_too_large", "detail": "Choose a shorter analysis window."})
    return body


def pin_digest(held: dict) -> str:
    cutoff = stamp(held["state"]["data_cutoff"]).isoformat(timespec="microseconds")
    return hashlib.sha256(json.dumps([cutoff, sorted(held["pins"].items())], separators=(",", ":")).encode()).hexdigest()


def keys(body: dict, expected: set[str]) -> None:
    if not isinstance(body, dict) or set(body) != expected:
        raise ValueError("unexpected or missing request fields")


def number(value: object, name: str, low: float, high: float, integer: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if not low <= value <= high or (integer and int(value) != value):
        raise ValueError(f"{name} must be {'an integer ' if integer else ''}between {low} and {high}")
    return value


class RallyStore:
    def __init__(self, explorer, url: str, slots: tuple) -> None:
        self.explorer, self.url, self.slots = explorer, url, slots
        self.results: dict[str, dict] = {}
        self.lock = threading.Lock()

    def discover(self, body: dict) -> dict:
        keys(body, {"pack", "definition", "analysis"})
        held = self.explorer.holding(body["pack"])
        definition, analysis = body["definition"], body["analysis"]
        if not isinstance(definition, dict):
            raise ValueError("definition must be an object")
        mode, scale = definition.get("mode"), definition.get("scale")
        if mode not in ("first_hit", "controlled_advance", "swing") or scale not in ("bps", "atr"):
            raise ValueError("invalid rally mode or scale")
        wanted = {"mode", "scale", "target"} | ({"reversal"} if mode == "swing" else {"anchor_minutes"})
        if mode == "controlled_advance":
            wanted.add("pullback")
        keys(definition, wanted)
        for key in wanted - {"mode", "scale"}:
            number(definition[key], key, 1 if key == "anchor_minutes" else 0.000000001,
                   1440 if key == "anchor_minutes" else 100 if scale == "atr" else 10000,
                   key == "anchor_minutes")
        keys(analysis, {"start", "end"})
        start, end = stamp(analysis["start"]), stamp(analysis["end"])
        if start >= end or end > stamp(held["state"]["data_cutoff"]):
            raise ValueError("analysis must end after its start and no later than this pack's data cutoff")
        hours = 44.25 if scale == "atr" else 48
        if (end - start).total_seconds() > hours * 3600:
            raise ValueError(f"analysis exceeds {hours:g} hours including ATR warmup")
        acquired = []
        deadline = time.monotonic() + 20
        try:
            for slot in self.slots:
                if not slot.acquire(timeout=max(0, deadline - time.monotonic())):
                    raise MarketStateError(503, {"error": "rally_busy", "detail": "Existing cube reads are still running; retry discovery."})
                acquired.append(slot)
            result = rallies({"definition": definition, "analysis": analysis,
                              "expected_state": {"data_cutoff": held["state"]["data_cutoff"],
                                                 "pack_pin_digest": pin_digest(held)}}, url=self.url)
            reader = open_file(result.rallies, url=self.url)
            metadata = json.loads(reader.schema.metadata[META])
            if metadata["schema_version"] != 1 or metadata["result_id"] != result.result_id:
                raise RuntimeError("Unsupported or mismatched rally result metadata")
            events = []
            for index in range(reader.num_record_batches):
                batch = reader.get_batch(index)
                if len(events) + batch.num_rows > MAX_EVENTS:
                    raise MarketStateError(413, {"error": "too_many_rallies", "detail": "Choose a shorter window or a larger anchor cadence."})
                events.extend(wire(row) for row in batch.to_pylist())
            events.sort(key=lambda row: (row["start_at_us"], row["rally_id"]))
            item = {"result": result, "metadata": metadata, "events": events, "lock": threading.Lock(), "member_id": None, "members": []}
            self.check(item, held)
            answer = bounded({"result_id": result.result_id, "metadata": metadata, "events": events})
            with self.lock:
                self.results[result.result_id] = item
                while len(self.results) > 4:
                    del self.results[next(iter(self.results))]
            return answer
        finally:
            for slot in reversed(acquired):
                slot.release()

    def check(self, item: dict, held: dict) -> None:
        for key, revision, build in item["metadata"]["relevant_pins"]:
            if held["pins"].get(key) != [revision, build]:
                raise MarketStateError(409, {"error": "rally_source_changed", "detail": "Rally source revisions differ from the displayed pack. Refresh discovery."})

    def view(self, body: dict) -> dict:
        keys(body, {"pack", "result_id", "rally_id", "n", "m", "known_at", "deadline_minutes"})
        held = self.explorer.holding(body["pack"])
        with self.lock:
            item = self.results.get(body["result_id"])
        if item is None:
            raise MarketStateError(410, {"error": "rally_result_expired", "detail": "Refresh discovery; this result is no longer retained."})
        self.check(item, held)
        n, m = int(number(body["n"], "n", 0, 24, True)), int(number(body["m"], "m", 0, 12, True))
        edge = stamp(body["known_at"])
        ceiling = stamp(item["metadata"]["observation_ceiling"])
        if edge > stamp(held["state"]["data_cutoff"]):
            raise ValueError("known_at is after the displayed pack cutoff")
        deadline = body["deadline_minutes"]
        swing = item["metadata"]["normalized_definition"]["mode"] == "swing"
        if deadline is not None:
            number(deadline, "deadline_minutes", 0.000000001, 240)
            if swing:
                raise ValueError("swing completion uses reversal, not a deadline")
        visible = [row for row in item["events"] if row["confirmed_at_us"] < micros(min(edge, ceiling))
                   and (deadline is None or row["duration_seconds"] < deadline * 60)]
        selected = next((row for row in visible if row["rally_id"] == body["rally_id"]), None)
        cells, profile = [], []
        # Reading through the supported reader renews the group's canonical-file lifetime.
        with item["lock"]:
            reader = open_file(item["result"].rally_cells, url=self.url)
            meta = json.loads(reader.schema.metadata[META])
            if meta != item["metadata"]:
                raise RuntimeError("Rally membership metadata differs from its events")
            if selected is not None:
                if item["member_id"] != selected["rally_id"]:
                    import pyarrow.compute as pc
                    members = []
                    for index in range(reader.num_record_batches):
                        batch = reader.get_batch(index)
                        batch = batch.filter(pc.equal(batch.column("rally_id"), selected["rally_id"]))
                        if len(members) + batch.num_rows > MAX_MEMBERS:
                            raise MarketStateError(413, {"error": "rally_members_too_large", "detail": "Choose a shorter analysis window."})
                        members.extend(batch.to_pylist())
                    item["member_id"], item["members"] = selected["rally_id"], members
                grouped, rows = {}, {}
                for member in item["members"]:
                    c, r = member["base_time_index"] // 2**n, member["base_price_index"] // 2**m
                    group = grouped.setdefault((c, r), {"c": c, "r": r, **{key: [] for key in FIELDS}, "partial_base_cells": 0})
                    profile_row = rows.setdefault(member["base_price_index"], {"r": member["base_price_index"], **{key: [] for key in FIELDS}})
                    for key in FIELDS:
                        group[key].append(member[key])
                        profile_row[key].append(member[key])
                    group["partial_base_cells"] += int(member["partial"])
                for groups, target in ((grouped, cells), (rows, profile)):
                    for group in groups.values():
                        target.append({**group, **{key: math.fsum(group[key]) if "volume" in key else sum(group[key]) for key in FIELDS}})
                cells.sort(key=lambda row: (row["c"], row["r"]))
                profile.sort(key=lambda row: row["r"])
        return bounded({"result_id": body["result_id"], "pack": body["pack"], "n": n, "m": m,
                        "visible_ids": [row["rally_id"] for row in visible], "selected": selected,
                        "cells": cells, "profile": profile,
                        "diagnostics": item["metadata"]["diagnostic_counts"] if edge >= ceiling else None})
