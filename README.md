# Market State Cube Explorer

A visualization overlay for independent dyadic time and price grids, using a recorded Binance BTCUSDT spot-trade snapshot.

## Run locally

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open [localhost:8080](http://localhost:8080). The app ships with its snapshot and D3; it makes no external requests and requires no backend, account, or JavaScript build tool. The view lives in the page's address; the workspace, the last view and named views persist in browser local storage.

## Explore

The explorer fills the window. One bar across the top holds the controls, the chart takes the rest, the inspector sits on the right and the drawer under the chart.

- **Resolution** is the button showing the current cell size, such as `15 min × 125 USDT`. A padlock shows whether auto level is on (A); in auto, the level follows the cell size on screen. The button opens the **resolution plane**, which maps every level of the lattice, marks the diagonal, and colours each level by readiness and pixel size. Arrow keys move through the plane, and Enter chooses a level.
- **Price** sets how the price range follows a time zoom:
  - **Free** leaves it alone.
  - **Refit** fits it to the visible trades.
  - **Coupled** zooms it by the same factor.
  - **Diagonal** zooms it by the square root of the time factor and keeps the price level on the measured diagonal (D).

  **Fit now** fits the price range once (F).
- **Pan, Select and Lens** are the pointer tools (V, S, L). A finished selection hands the pointer back to Pan.
  - **Lens** shows finer recorded cells inside a region while preserving the surrounding view, one to four levels finer (Shift+L). Hold Alt, or hold on touch, to inspect temporarily. Enter or **Pin lens** makes the lens rectangle and resolution the view.
- **Volume, taker flow, density, delta and geometry** share one grid. Profiles include total and buy POCs and a composite 70% value area.
- **Continuations** compare matching historical states with unconditional outcomes over all price rows, whatever band is on screen. Each outcome opens its cases in the drawer, including opposing outcomes and POC-barrier crossings. **Replay** hides future trades and steps with the , and . keys.
- **The drawer** holds three tabs:
  - **Cells:** the measures of every occupied cell, sortable and linked to the chart on hover.
  - **Cases:** the historical cases, each date a jump into replay.
  - **Query:** the six-parameter query. Copy queries or portable `origo-cube:` view codes, and restore them in the same app.
- **The address holds the view**: its window or rectangle, the level when it is locked, the encoding, overlays and replay. Copy it to share or bookmark a view; each tab keeps its own. A window (24h, 7d, All) is relative and opens on the latest data; any other view opens where it was.
- **History:** every move is an entry in the browser's history, so Back and Forward (the browser's, ⌘[ and ⌘] or Alt+← and Alt+→, or the bar's arrows) walk it, and steps of one kind in quick succession count as one. Back returns to a place and leaves the encoding and overlays as they are. The history list names each entry's range and level, and survives a reload.
- **Views** (H) keeps named views in this browser for every tab: name the current view and save it (Shift+S). A view saved while it shows the latest data opens on the latest data, with the same span and the price range fitted again; any other opens where it was.
- **Layout:** the inspector and the drawer resize and collapse, and the page remembers how you left them.

Keys work anywhere on the page except in text fields, and every control's tooltip names its key; `?` lists them all. On a phone the chart comes first and the controls open in a sheet.

## Live cube data

On the Origo host the explorer runs beside the market state cube ([PRD-0022](https://github.com/Vaquum/Origo/issues/462)) and reads it live. The cube's query service answers with paths to Arrow files on its own volume, so `tools/cube_bridge.py` runs where that volume is mounted: it asks the service for tiles, reads the files through the cube's supported reader (`tools/market_state_reader.py`, a pinned copy from Origo 3.27.0) and serves `index.html` with a live pack in place of the recorded snapshot, behind HTTP Basic Auth.

The live pack holds the same three tiers as the snapshot: the last seven days at base resolution, 30 completed days at 15 minutes, and the whole history at 64 hours × 1,000 USDT. Its cutoff is the last complete base column before the cube's data cutoff, fixed once per pack; every tier is bounded to it, the partitions the tiers share are checked to carry the same generation, revision and build id (the pack is read again once if the cube changed underneath), and the pack token digests every pin it read. It is rebuilt at most once a minute. When the requested level has no covering block, the page asks `GET /cube/tile?n&m&b0&b1&pack` for one tile of the visible window, at most 4,096 columns wide; a tile is refused unless every partition it read is one the page's pack read, at the same revision, and the page then takes the cube's new data first and asks again, rather than mixing two cube states. Every value comes from the cube; nothing is substituted when a request fails, and the status line says why.

An open page stays live. Just after each pack can be rebuilt, it asks `GET /cube/pack?since=<its pack token>` and puts the answer in place: nothing when it holds the current pack; the columns each tier gained when its pack is a prefix of the current one, every partition it read unchanged and every column it keeps identical; otherwise, after a revision or a backfill, the whole pack. A view that shows the cutoff follows it as data arrives, and a window keeps its length; any other view stays where it is, and **Latest** (End) brings it back. The top bar reads **LIVE** with how long ago the data last advanced, and says plainly when the cube has no new data or the server stops answering. The tab's title carries the latest POC.

The committed `index.html` keeps the recorded snapshot, so the page also works from a plain static server and reads **RECORDED** there.

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
python3 -m py_compile tools/cube_bridge.py tools/market_state_reader.py
```

Edit `src/`, then rebuild the committed `index.html`. The build uses Python's standard library and is deterministic; no installed Codex or Claude runtime is needed.

- `src/view.html`, `src/explorer.css`, `src/explorer.js`: interface, rendering and interactions.
- `src/state.js`: browser storage: the workspace, the last view and named views for every tab, and each tab's history.
- `src/document.html`: standalone page shell.
- `data/snapshot.json`: real recorded measures, compressed in three embedded blocks.
- `vendor/`: pinned D3 7.9.0 and its license.
- `tools/build.py`: assembles the portable page.
- `tools/cube_bridge.py`: the server that reads the market state cube live; `tools/market_state_reader.py` is the cube's pinned reader.

## Deploy

The explorer runs on the Origo host, `37.27.112.167`, as the Compose project `cube-explorer` in `/opt/cube-explorer`:

- `explorer` builds the `Dockerfile` (Python 3.12, pyarrow, numpy), mounts the cube's result volume `tdw-control-plane_market-state` read-only at `/opt/origo/market-state`, uses the host network so the cube service is `127.0.0.1:8486`, and serves the page on `127.0.0.1:8487` only, as a non-root user on a read-only filesystem. Credentials come from `/opt/cube-explorer/.env` (`EXPLORER_AUTH_USER`, `EXPLORER_AUTH_PASS`); without them the server refuses to start.
- TLS is terminated by the host's shared Caddy ingress on port 443, deployed from [Vaquum/Loop](https://github.com/Vaquum/Loop) (`/opt/loop-api/Caddyfile`), whose `cube.vaquum.fi` site block proxies to `127.0.0.1:8487` with a Let's Encrypt certificate. The credentials therefore only ever travel over TLS. `cube.vaquum.fi` is a DNS-only A record for the host.

Every push to `main` deploys through `.github/workflows/deploy.yml`: it syncs the checkout to the host with rsync, writes `.env` from the repository secrets, runs `docker compose up -d --build`, and checks over SSH that the explorer answers 200 with the credentials and 401 without. It needs the secrets `DEPLOY_SSH_KEY`, `EXPLORER_AUTH_USER` and `EXPLORER_AUTH_PASS` and the variables `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_DIR` and `DEPLOY_KNOWN_HOSTS`.

Local check of the server, which needs the cube volume and service and therefore runs on the host:

```sh
EXPLORER_AUTH_USER=admin EXPLORER_AUTH_PASS=… python3 tools/cube_bridge.py --port 8487
```
