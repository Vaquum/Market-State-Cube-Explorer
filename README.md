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

## Live cube data

`tools/cube_bridge.py` plugs the explorer into the Origo market state cube ([PRD-0022](https://github.com/Vaquum/Origo/issues/462)). The cube's query service runs on the production host and answers with paths to Arrow files on its own volume, so the bridge has two roles:

- **`fetch`** runs beside that volume, inside the `market-state` container. It asks the service for tiles, reads the Arrow files through the cube's supported reader (which renews their 24-hour clock) and prints them as MSC1 blocks in the snapshot's own JSON shape.
- **`serve`** runs anywhere on the standard library. It serves `index.html` with a live pack in place of the recorded snapshot and answers `GET /cube/tile?n&m&b0&b1` for finer tiles. It reaches the volume through a command prefix and sends itself on stdin, or calls `fetch` in-process when the reader is importable.

```sh
python3 tools/cube_bridge.py serve --port 8080 \
  --remote "ssh 37.27.112.167 docker exec -i tdw-control-plane-market-state-1"
```

The live pack holds the same three tiers as the snapshot, cut at the cube's data cutoff: the last seven days at base resolution, 30 completed days at 15 minutes, and the whole history at 64 hours × 1,000 USDT. It is rebuilt at most once a minute. When the requested level has no covering block, the page asks for one tile of the visible window, at most 4,096 columns wide, and the header reads **LIVE MARKET** with the cutoff minute. Every value comes from the cube; nothing is substituted when a request fails, and the status line says why.

The committed `index.html` keeps the recorded snapshot, so the page also works from any static host, including the deployed Worker, and reads **RECORDED MARKET** there.

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
node --check worker.js
python3 -m py_compile tools/cube_bridge.py
npx wrangler@4 deploy --dry-run --outdir /tmp/dry-run
```

Edit `src/`, then rebuild the committed `index.html`. The build uses Python's standard library and is deterministic; no installed Codex or Claude runtime is needed.

- `src/view.html`, `src/explorer.css`, `src/explorer.js`: interface, rendering and interactions.
- `src/state.js`: browser-local view persistence.
- `src/document.html`: standalone page shell.
- `data/snapshot.json`: real recorded measures, compressed in three embedded blocks.
- `vendor/`: pinned D3 7.9.0 and its license.
- `tools/build.py`: assembles the portable page.
- `tools/cube_bridge.py`: live data from the market state cube.

## Deploy

[cube.vaquum.fi](https://cube.vaquum.fi) is a Cloudflare Worker that serves the committed `index.html` as a static asset behind HTTP Basic Auth. `wrangler.toml` is the deploy contract: the Worker name (`market-state-cube-explorer`, the Worker connected to this repository in the dashboard), the custom domain and its DNS record come from it, and `.assetsignore` uploads nothing but `index.html`. `worker.js` runs before every request: plain HTTP is redirected to HTTPS, a request without matching credentials gets a `401` challenge, and without the two secrets below the Worker admits nobody. There is no workers.dev or preview URL.

Cloudflare's Git integration deploys every push to `main`. One-time setup in the dashboard:

1. **Workers & Pages → Create → Git-connected Worker**, connect `Vaquum/Market-State-Cube-Explorer`, root directory `/`, no build command, deploy command `npx wrangler deploy`.
2. After the first deploy, open the Worker's **Settings → Variables and Secrets** and add the secrets `AUTH_USER` and `AUTH_PASS`. Until both exist every request answers `401`.

The same secrets can be set from a logged-in shell with `npx wrangler@4 secret put AUTH_USER` and `npx wrangler@4 secret put AUTH_PASS`.

Local check, with a git-ignored `.dev.vars` holding test values for `AUTH_USER` and `AUTH_PASS`:

```sh
npx wrangler@4 dev --local-protocol https
```

The local proxy rewrites the HTTPS redirect back to the dev protocol; in production it points at `https://cube.vaquum.fi`.

This repository contains the visualization overlay. Server ingestion, live updates, corrections and Arrow delivery are separate work.
