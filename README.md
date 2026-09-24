# Market State Cube Explorer

A visualization overlay for independent dyadic time and price grids, using a recorded Binance BTCUSDT spot-trade snapshot.

## Run locally

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open [localhost:8080](http://localhost:8080). The app ships with its snapshot and D3; it makes no external requests and requires no backend, account, or JavaScript build tool. View preferences persist in browser local storage.

## Explore

- **Auto level** chooses resolutions from cell size in pixels. Lock a level, couple both zoom axes, refit price when time changes, or use **Diagonal zoom**, which scales price by the square root of the time factor and keeps the price level on the measured diagonal.
- **Lens** shows finer recorded cells inside a region while preserving the surrounding view, one to four levels finer (Shift+L). Hold Alt or hold on touch to inspect temporarily; Enter or **Pin lens** makes the lens rectangle and resolution the view.
- **Resolution plane** maps every level of the lattice, marks the diagonal, and colours each level by readiness and pixel size. Breadcrumbs restore earlier exploration states and survive reloads.
- **Volume, taker flow, density, delta and geometry** share one grid. Profiles include total/buy POCs and a composite 70% value area.
- **Continuations** compare matching historical states with unconditional outcomes over all price rows, whatever band is on screen. Inspect individual cases, opposing outcomes and POC-barrier crossings; replay hides future trades and steps with , and . keys.
- **Select**, **Table**, and **Cube query** expose measures and the six-parameter query. Copy queries or portable `origo-cube:` view codes and restore them in the same app.

The Controls disclosure lists mouse, keyboard and touch gestures. Click or focus the chart before using keyboard shortcuts.

## Recorded data

The snapshot cutoff is **2026-09-24 12:02:48.750 UTC**. This is a recorded prototype, not a live feed.

| Loaded history | Finest time resolution | Finest price resolution |
| --- | --- | --- |
| Last seven days | 56.25 seconds | 125 USDT |
| Last 30 completed days | 15 minutes | 125 USDT |
| History from 2021-01-01 UTC | 64 hours | 1,000 USDT |

Source blocks overlap; historical cases are deduplicated. Finer historical detail is explicitly unavailable where it was not included in the snapshot. Requested query bounds/resolutions and rendered coverage can therefore differ; the UI reports both. Zero-trade, unfinished and unavailable cells have distinct states.

Empirical continuation shares are descriptive, not calibrated forecasts. Samples overlap. Matching percentages and cones are withheld below 30 cases. Barriers measure **first column-end POC crossings**, not trade-level first-touch events. See [data and semantics](docs/data-and-semantics.md).

## Develop

```sh
python3 tools/build.py
python3 tools/build.py --check
node --check src/explorer.js
node --check src/state.js
```

Edit `src/`, then rebuild the committed `index.html`. The build uses Python's standard library and is deterministic; no installed Codex or Claude runtime is needed.

- `src/view.html`, `src/explorer.css`, `src/explorer.js`: interface, rendering and interactions.
- `src/state.js`: browser-local view persistence.
- `src/document.html`: standalone page shell.
- `data/snapshot.json`: real recorded measures, compressed in three embedded blocks.
- `vendor/`: pinned D3 7.9.0 and its license.
- `tools/build.py`: assembles the portable page.

This repository contains the visualization overlay. Server ingestion, live updates, corrections and Arrow delivery are separate work.
