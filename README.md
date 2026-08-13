# retale

A self-hosted single-user AI novel rewrite workspace built with Next.js.

## Stack

- Next.js + React + Tailwind CSS
- TipTap editor
- Zustand client store
- SQLite with direct SQL persistence
- Local HanLP Python bootstrap for knowledge graph rebuilds
- OpenAI-compatible `/chat/completions` integration

## What it does

This app now behaves like a local-first rewrite product with a real backend layer:

- Rich rewrite workflow with chapter / paragraph / selection scopes
- Single-result rewrite generation with apply / insert / branch / continue actions
- Branch chapters represented in the chapter tree
- Rewrite control surface with modes, tones, presets, prompt editing, and constraints
- Reference panels for outlines, characters, worldbuilding, and trajectory logs
- Workspace persistence stored in SQLite through direct SQL server modules
- HanLP-assisted knowledge graph rebuilds with tiered characters, alias synchronization, candidate promotion, and persistent cache state
- JSON export / import for workspace state
- In-app OpenAI-compatible API settings modal
- Real rewrite requests through `/api/rewrite` when configured
- Structured rewrite provider errors with in-app setup guidance when AI config is missing or the provider request fails

## Environment

ReTale requires Node.js `>=22.15.0`. Detached knowledge workers use synchronous `node:module` loader hooks to transpile the repository TypeScript graph before importing it; older Node releases do not provide the required `registerHooks` API.

CI runs `npm run audit:production` immediately after `npm ci` and fails on high-severity vulnerabilities in production dependencies. Run the same gate locally after dependency changes.

Copy the example file:

```bash
cp .env.example .env
```

Variables:

```bash
DATABASE_URL="file:./dev.db"
OPENAI_COMPATIBLE_BASE_URL="https://api.openai.com/v1"
OPENAI_COMPATIBLE_API_KEY=""
OPENAI_COMPATIBLE_MODEL="gpt-4.1-mini"
HANLP_PYTHON_BIN=""
HANLP_BOOTSTRAP_SCRIPT_PATH=""
HANLP_BOOTSTRAP_PARALLELISM="1"
HANLP_BOOTSTRAP_BATCH_SIZE="256"
HANLP_BOOTSTRAP_TIMEOUT_MS="600000"
RETALE_TASK_STALE_TIMEOUT_MS="1800000"
RETALE_TASK_MAX_RETRIES="1"
RETALE_DATA_DIR="data"
RETALE_TRUSTED_ORIGINS=""
LLM_DEBUG_LOG="0"
LLM_DEBUG_LOG_DIR=".sisyphus/llm-debug"
```

You can also update the AI settings from the app UI.

Set `LLM_DEBUG_LOG="1"` during local development to write raw server-side LLM prompt/response JSON files into feature-specific folders under `LLM_DEBUG_LOG_DIR`.

### Knowledge graph runtime

Knowledge graph rebuilds use the server-side `hanlp_bootstrap.py` script before LLM extraction. `npm install` runs `scripts/setup-hanlp-runtime.mjs`, which creates a pinned HanLP virtualenv outside the project root, writes `HANLP_PYTHON_BIN` and `HANLP_BOOTSTRAP_SCRIPT_PATH` to `.env.local`, and avoids Next/Turbopack tracing Python virtualenv symlinks during builds. Run `npm run setup:hanlp` to recreate and smoke-test that runtime. Set `RETALE_SKIP_HANLP_SETUP=1` only when intentionally skipping local knowledge-graph rebuild support. `HANLP_BOOTSTRAP_SCRIPT_PATH` can point at an alternate bootstrap script; when unset, the app uses the repository script. `HANLP_BOOTSTRAP_PARALLELISM` defaults to `1` so rebuilds do not spawn multiple heavyweight HanLP model processes; raise it only after validating local memory. `HANLP_BOOTSTRAP_BATCH_SIZE` defaults to `256` and controls how many sentence/line segments the bootstrap script sends to HanLP per model call. `HANLP_BOOTSTRAP_TIMEOUT_MS` controls the per-chapter HanLP subprocess timeout and defaults to `600000`.

The rebuild API returns quickly with a queued/running job status. The server continues the rebuild in the background and the workspace polls job state instead of blocking the whole site while HanLP is running.

Background task watchdogs use `RETALE_TASK_STALE_TIMEOUT_MS` to decide when a queued/running knowledge or recoverable rewrite job has stopped making progress, and `RETALE_TASK_MAX_RETRIES` to cap automatic retry attempts. When a job is retried, ReTale writes a new in-payload attempt token so stale old workers cannot overwrite the newer retry or a terminal watchdog failure. Detached worker startup failures are fenced by the scheduled attempt token before they can mark a queued job failed. Knowledge-view reads also reschedule queued watchdog retries, so users do not need to press rebuild again after a stale worker is reconciled.

## First-time setup

```bash
npm install
npm run dev
```

Open http://localhost:14500. To use `http://<tailscale-ip-or-hostname>:14500` from another Tailscale device on a trusted tailnet, add that exact canonical origin to the comma-separated `RETALE_TRUSTED_ORIGINS` value. The default daily developer command is `npm run dev` (same as `npm run dev:prod`) and it always binds `0.0.0.0:14500`, always forces `DATABASE_URL=file:./dev.db`, and uses Next's development output so it stays separate from production builds and the isolated test server.

## Server modes

Use these scripts when you need both servers available at the same time:

```bash
npm run dev:prod
npm run dev:test
```

- `npm run dev` / `npm run dev:prod`
  - URL: `http://0.0.0.0:14500`
  - Legacy-source env: root `dev.db` via `DATABASE_URL=file:./dev.db`
  - Migrated runtime storage: `RETALE_DATA_DIR` (default `data/`)
  - Next development output: `.next/dev`
- `npm run dev:test` / `npm run server:test`
  - URL: `http://127.0.0.1:3000`
  - Legacy-source env: `.sisyphus/runtime/test-server/dev-test.db`
  - Migrated runtime storage: `.sisyphus/runtime/test-server/data/`
  - Next dist dir: `.sisyphus/runtime/test-server/next-dist`

The test wrapper overrides inherited `DATABASE_URL`, `RETALE_DATA_DIR`, and `RETALE_NEXT_DIST_DIR` with paths inside a marker-owned test root. The daily wrapper continues to force its production `DATABASE_URL` and default Next dist directory. The public scripts are fixed-mode wrappers: `--hostname/-H` and `--port/-p` are rejected instead of changing the target server profile. If port `14500` or `3000` is already occupied, the wrapper exits with a clear error instead of killing unknown processes. Internal marker-owned test path overrides remain reserved for the Playwright web-server helper.

## Production lifecycle

```bash
npm run server:prod
```

`npm run server:prod` runs a real `next build` and only then launches `next start`. Production `start` and `server:prod` bind to `127.0.0.1:3000` by default. Unlike the fixed developer wrappers, they do not force a database or data path: set production environment values deliberately before starting. The runtime storage default remains `data/`; the repository-root `dev.db` is only a legacy compatibility environment value and is not read by the migrated runtime.

Only expose this unauthenticated single-user application on a trusted network. To bind all interfaces intentionally, set `RETALE_PRODUCTION_HOST=0.0.0.0`, or pass an explicit trusted-network hostname with `npm run start -- --hostname <trusted-address>`. Keep the default loopback binding for local use and automated verification.

For separate build and launch stages, use:

```bash
npm run build
npm run check:next-build-safety
npm run start
```

`npm run build` selects `tsconfig.build.json` through `RETALE_NEXT_TSCONFIG_PATH` so Next's production type check covers application and server sources without test or evidence inputs. `npm run start` launches an existing `.next` production build without rebuilding it. `npm run check:next-build-safety` scans that build's initial `/workspace` and `/library` JavaScript sizes, output-file traces, and required runtime assets, then writes hidden evidence to `.sisyphus/evidence/next-build-safety/next-build-safety.json`.

Run `npm run verify:production-freshness` to exercise an isolated real `next build` / `next start` lifecycle through the installed Next CLI. The harness uses marker-owned database, data, and Next dist paths under `.sisyphus/runtime/production-smoke-runs/`, so its build neither replaces `.next` nor scans or mutates production `data/` or root `dev.db`. It starts on `127.0.0.1:3000`, checks `/library`, `/workspace`, and `/task`, then inserts an active task after the build and verifies `/task` reflects it without rebuilding. Port `3000` must be free; the harness refuses to kill an unknown listener and stops its own server on success, failure, or termination.

## Per-novel storage

Runtime data lives under `RETALE_DATA_DIR` (default: `data/`) with this layout:

- `data/control.db`
- `data/novels/<safeNovelId>/novel.db`
- `data/novels/<safeNovelId>/lancedb/`

The app reads and writes only this migrated per-novel layout at runtime. The old repository-root `dev.db` is no longer a runtime database source.

Per-novel `lancedb/` directories are part of the runtime layout, so LanceDB-backed knowledge retrieval artifacts are stored and rebuilt per novel instead of through a single global `.lancedb/` directory.

## Persistence

- Migrated runtime storage: `data/control.db` plus `data/novels/<safeNovelId>/novel.db`
- Per-novel LanceDB storage: `data/novels/<safeNovelId>/lancedb/`
- Old monolithic `dev.db`: no longer used at runtime
- `GET /api/workspace` restores workspace state and its current revision. An idle workspace mount reads state without issuing a write.
- Ordinary chapter edits use revision-aware `PATCH /api/workspace` requests with `Idempotency-Key`, `X-Retale-Base-Revision`, and `X-Retale-Revision-Novel-Id` identifying the revision owner.
- Structural workspace changes use revision-aware `POST /api/workspace` requests with the same complete three-header contract. Legacy POST requests without revision authority remain accepted with JSON Content-Type only.
- Workspace import completes synchronously and makes the imported workspace ready at revision 1.
- A stale revision conflict preserves local edits instead of replacing them with server state.
- PATCH falls back to revision-aware POST only when the server reports PATCH as unsupported with HTTP 405 or 501.
- Workspace API requests with an Origin header are accepted only from built-in local loopback origins or exact canonical origins configured through `RETALE_TRUSTED_ORIGINS`.
- AI settings are saved through `POST /api/settings/ai`

## Notes

- No auth, collaboration, or cloud sync: intentionally single-user.
- Runtime storage is the per-novel `data/` layout; the old monolithic `dev.db` is not read by the app.
- OpenAI-compatible rewrite calls expect a server implementing `POST /chat/completions`.
- If AI config is missing or the upstream request fails, `/api/rewrite` returns a structured provider error so you can configure or fix the selected OpenAI-compatible or Ollama settings.
- Import currently assumes valid exported JSON.
- Preset compatibility scope, provider mappings, preserved-only behavior, provenance notes, and MVP limitations live in `docs/preset-compatibility.md`.
- Knowledge graph design, rebuild ordering, and runtime technology notes live in `docs/knowledge-graph-design.md`.
