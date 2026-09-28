# Market State Cube Explorer

A visualization overlay for independent dyadic time and price grids, using a recorded Binance BTCUSDT spot-trade snapshot.

## Run locally

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open [localhost:8080](http://localhost:8080). The app ships with its snapshot and D3; it makes no external requests and requires no backend, account, or JavaScript build tool. The view lives in the page's address; the workspace, the last view and named views persist in browser local storage.

## Explore

The explorer fills the window. One bar across the top names the market and its state on the left, and holds the controls on the right; the chart takes the rest, the inspector sits on the right and the drawer under the chart. The controls are icons in groups by task: the view (time window, resolution, price axis), POC lines, the pointer tools, replay, history and help. Rest the pointer on one for a second, or hold it on a touch screen, and a label names it with its key and says what it does; once one label has shown, the next shows at once. On a phone the window stays in the bar and the rest opens in a sheet, named.

- **Time window** chooses what the chart spans: 15 or 30 minutes, 1, 4, 12 or 24 hours, 7 or 30 days, a year, this year, last year or all history. Each ends at the latest data, except last year, which is the whole calendar year before this one. The number keys 1 to 9 choose them in order and 0 all history; W opens the list. A view no window names shows its span there instead.
- **Resolution** is the button showing the current cell size, such as `15 min × 125`. A padlock shows whether auto level is on (A); in auto, the level follows the cell size on screen. The button opens the **resolution plane**, which maps every level of the lattice, marks the diagonal, and colours each level by readiness and pixel size. Arrow keys move through the plane, and Enter chooses a level.
- **Price axis** sets how the price range follows a time zoom; its icon shows the mode:
  - **Free** leaves it alone.
  - **Refit** fits it to the visible trades.
  - **Coupled** zooms it by the same factor.
  - **Diagonal** zooms it by the square root of the time factor and keeps the price level on the measured diagonal (D).

  The wheel zooms the axis it's over. On the price labels it zooms the price range alone, around the price under the pointer; on the time labels, time. On the chart it zooms time, and the price range with Shift. What a wheel gesture zooms is fixed at its first tick, by where it starts and whether Shift is held then, until it pauses. Dragging the price labels scales the price range around the price where the drag began: up zooms in, down zooms out. Zooming the price range by hand (the wheel or a drag on the price axis, or Shift with the wheel, = - or a double-click) leaves Refit for Free, so the next refit doesn't undo it.

  Its list also fits the price range once (F).
- **POC lines** (P) draw, for each period chosen, a line at the price where it traded the most: the centre of the 125 USDT row with the most USDT volume, the cube's POC at its finest rows. The periods are 1 day, this week, 7 days, this month, 30 days, 90 days, this year, 1 year and 3 years, each up to the latest data, and any days chosen by date, each from that UTC day's start to the latest data. Each line is solid across its period, with a tick where the period starts, and dashed on to the right edge, where a tag in its colour names it and gives its price; a line above or below the view keeps its tag at that edge, with an arrow. Hovering a line or its tag gives its period, its row, and the row's share of the period's volume. The bar's button shows a dot in each line's colour, and its list shows each line's price. In replay the periods end at the replay's edge, so no line uses trades after it.
- **Pan, Select and Lens** are the pointer tools (V, S, L), and each stays chosen until another is. With Pan, a drag moves the view and a click anchors a column. With Select, each drag measures a new rectangle and a click clears it. Esc clears the selection, and a second Esc goes back to Pan.
  - **Lens** shows finer cells inside a region while preserving the surrounding view, one to four levels finer (Shift+L); on the live cube they are read from the cube, anywhere in the history. Its depth and **Pin** sit on the chart while it is the tool. Hold Alt, or hold on touch, to inspect temporarily. Enter or **Pin** makes the lens rectangle and resolution the view.
- **Reading the chart:** gridlines and ticks sit on cell edges at every level. The crosshair reads the price and time on the axes. The tooltip gives a cell's span and all four measures (volume, trades, taker-buy volume and taker-buy trades) with its trade size, exact while Shift is held, and over the price profile a row's. Each column's amount for the encoding runs in a pane under the prices.
- **Encodings** (M; the list beside the chart's legend) colour one grid by any of the cube's measures: **volume**, **taker flow** (the taker-buy share of the USDT) and **delta** (taker-buy minus taker-sell USDT); **trades**, **taker trades** (the taker-buy share of the trades) and **trade size** (USDT per trade); and **geometry**, the occupied cells. Amounts shade by rank on one ramp, pale to deep (dark to bright in the dark theme) through yellow, green and blue, so each step of the ramp holds as many cells as any other; an edge cell or the open column counts at its full-cell rate, so it compares with whole cells. The taker shares diverge from an even share to buy and sell, paler where less traded. Profiles include total and buy POCs and a composite 70% value area; **Column POCs** (Shift+P) draws each column's POC.
- **Continuations** compare matching historical states with unconditional outcomes over all price rows, whatever band is on screen. Each outcome opens its cases in the drawer, including opposing outcomes and POC-barrier crossings. **Replay** hides the trades after an anchor and nothing else. Its transport on the chart steps the anchor (`,` and `.`), plays it at ½× to 4× (Space) and returns to now (End).
- **The drawer** holds three tabs:
  - **Cells:** the measures of every occupied cell, sortable and linked to the chart on hover.
  - **Cases:** the historical cases, each date a jump into replay.
  - **Query:** the six-parameter query. Copy queries or portable `origo-cube:` view codes, and restore them in the same app.
- **The address holds the view**: its window or rectangle, the level when it is locked, the encoding, overlays, POC lines and replay. Copy it to share or bookmark a view; each tab keeps its own. A window is relative and opens on the latest data (last year on the year before the latest data's); any other view opens where it was.
- **History:** every move is an entry in the browser's history, so Back and Forward (the browser's, ⌘[ and ⌘] or Alt+← and Alt+→, or the bar's arrows) walk it, and steps of one kind in quick succession count as one. Back returns to a place and leaves the encoding and overlays as they are. The history list names each entry's range and level, and survives a reload.
- **Views** (H) keeps named views in this browser for every tab: name the current view and save it (Shift+S). A view saved while it shows the latest data opens on the latest data, with the same span and the price range fitted again; any other opens where it was.
- **Layout:** the inspector and the drawer resize and collapse, and the page remembers how you left them.

Keys work anywhere on the page except in text fields, and every control's tooltip names its key; `?` lists them all. On a phone the chart comes first and the controls open in a sheet.

## Live cube data

On the Origo host the explorer runs beside the market state cube ([PRD-0022](https://github.com/Vaquum/Origo/issues/462)) and reads it live. The cube's query service answers with paths to Arrow files on its own volume, so `tools/cube_bridge.py` runs where that volume is mounted: it asks the service for cells, reads the files through the cube's supported reader (`tools/market_state_reader.py`, a pinned copy from Origo 3.28.0) and serves `index.html` with a live pack in place of the recorded snapshot, behind HTTP Basic Auth.

The live pack holds the same three tiers as the snapshot: the last seven days at base resolution, 30 completed days at 15 minutes, and the whole history at 64 hours × 1,000 USDT. They are read up to the cube's own data cutoff, so the latest trades are in them: the base column that holds the cutoff is the **open** one, drawn and counted as unfinished. The partitions the tiers share are checked to carry the same revision and build id (the pack is read again if the cube changed underneath), and the pack token digests every pin it read. A partition's generation is not compared: attaching a new component to a build, as the cube's history upgrade does, moves it without changing any cell. It is rebuilt at most once a minute. Where the cube's archived days end, the chart marks where **provisional** minutes begin, which the day's archive may still revise; the top bar's state says the same.

Every number is the cube's answer for the rectangle it describes. The selection, or the view when there is none, is rounded to base edges as the cube rounds them, and its four totals, both POCs and its cells come from the loaded cells when they tile it exactly (the last seven days, for any rectangle), and otherwise from the cube itself: `GET /cube/query?n&m&b0&b1&r0&r1&pack`. Until the cube answers, the inspector says it is measuring and shows no number. The open column always comes from the page's own pack, so a cube that has moved on since never mixes into an answer. The same route reads a tile when no loaded block can draw the view at its level (at most 4,096 columns; a wider view is drawn with coarser columns), the lens's finer cells, and each POC line; `GET /cube/columns?n&m&pack` reads the history the continuations compare, each column's POC and volumes for up to the last 100,000 columns at the drawn level. Reads go one at a time, most needed first. A read is refused unless every partition it read is one the page's pack read, at the same revision; the page then takes the cube's new data first and asks again, rather than mixing two cube states. Nothing is substituted when a read fails, and the page says why.

An open page stays live. Just after each pack can be rebuilt, it asks `GET /cube/pack?since=<its pack token>` and puts the answer in place: nothing when it holds the current pack; the columns each tier gained when its pack is a prefix of the current one, every partition it read unchanged and every column it keeps identical; otherwise, after a revision or a backfill, the whole pack. A view that shows the cutoff follows it as data arrives, and a window keeps its length; any other view stays where it is, and **Latest** (End) brings it back. The top bar reads **LIVE** with how long ago the data last advanced, and says plainly when the cube has no new data or the server stops answering. The tab's title carries the latest POC. A page open across a deploy offers to reload.

The committed `index.html` keeps the recorded snapshot, so the page also works from a plain static server and reads **RECORDED** there.

## Recorded data

The snapshot cutoff is **2026-09-24 12:02:48.750 UTC**. This is a recorded prototype, not a live feed.

| Loaded history | Finest time resolution | Finest price resolution |
| --- | --- | --- |
| Last seven days | 56.25 seconds | 125 USDT |
| Last 30 completed days | 15 minutes | 125 USDT |
| History from 2021-01-01 UTC | 64 hours | 1,000 USDT |

Source blocks overlap; historical cases are deduplicated. Finer historical detail is unavailable where the snapshot doesn't hold it: there, a rectangle's numbers count only the snapshot's whole cells inside it, marked **Ready part**, and POC lines use the finest rows that cover their period, marked ≈. The live cube measures both exactly. Zero-trade, unfinished and unavailable cells have distinct states.

Empirical continuation shares are descriptive, not calibrated forecasts. Samples overlap. Matching percentages and boxes are withheld below 30 cases. Barriers measure **first column-end POC crossings**, not trade-level first-touch events. See [data and semantics](docs/data-and-semantics.md).

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
