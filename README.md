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
LLM_DEBUG_LOG="0"
LLM_DEBUG_LOG_DIR=".sisyphus/llm-debug"
```

You can also update the AI settings from the app UI.

Set `LLM_DEBUG_LOG="1"` during local development to write raw server-side LLM prompt/response JSON files into feature-specific folders under `LLM_DEBUG_LOG_DIR`.

### Knowledge graph runtime

Knowledge graph rebuilds use the server-side `hanlp_bootstrap.py` script before LLM extraction. `npm install` runs `scripts/setup-hanlp-runtime.mjs`, which creates a pinned HanLP virtualenv outside the project root, writes `HANLP_PYTHON_BIN` and `HANLP_BOOTSTRAP_SCRIPT_PATH` to `.env.local`, and avoids Next/Turbopack tracing Python virtualenv symlinks during builds. Run `npm run setup:hanlp` to recreate and smoke-test that runtime. Set `RETALE_SKIP_HANLP_SETUP=1` only when intentionally skipping local knowledge-graph rebuild support. `HANLP_BOOTSTRAP_SCRIPT_PATH` can point at an alternate bootstrap script; when unset, the app uses the repository script. `HANLP_BOOTSTRAP_PARALLELISM` defaults to `1` so rebuilds do not spawn multiple heavyweight HanLP model processes; raise it only after validating local memory. `HANLP_BOOTSTRAP_BATCH_SIZE` defaults to `256` and controls how many sentence/line segments the bootstrap script sends to HanLP per model call. `HANLP_BOOTSTRAP_TIMEOUT_MS` controls the per-chapter HanLP subprocess timeout and defaults to `600000`.

The rebuild API returns quickly with a queued/running job status. The server continues the rebuild in the background and the workspace polls job state instead of blocking the whole site while HanLP is running.

Background task watchdogs use `RETALE_TASK_STALE_TIMEOUT_MS` to decide when a queued/running knowledge or recoverable rewrite job has stopped making progress, and `RETALE_TASK_MAX_RETRIES` to cap automatic retry attempts. When a job is retried, ReTale writes a new in-payload attempt token so stale old workers cannot overwrite the newer retry or a terminal watchdog failure. Knowledge-view reads also reschedule queued watchdog retries, so users do not need to press rebuild again after a stale worker is reconciled.

## First-time setup

```bash
npm install
npm run dev
```

Open http://localhost:14500, or use `http://<tailscale-ip-or-hostname>:14500` from another Tailscale device on a trusted tailnet. The default daily server command is `npm run dev` (same as `npm run dev:prod`) and it always binds `0.0.0.0:14500`, always forces `DATABASE_URL=file:./dev.db`, and always uses the default Next dist directory `.next` so it stays separate from the isolated test server.

## Server modes

Use these scripts when you need both servers available at the same time:

```bash
npm run dev:prod
npm run dev:test
```

- `npm run dev` / `npm run dev:prod` / `npm run server:prod`
  - URL: `http://0.0.0.0:14500`
  - Database: root `dev.db` via `DATABASE_URL=file:./dev.db`
  - Next dist dir: default `.next`
- `npm run dev:test` / `npm run server:test`
  - URL: `http://127.0.0.1:3000`
  - Database: `.sisyphus/runtime/test-server/dev-test.db`
  - Next dist dir: `.sisyphus/runtime/next-test-server`

Both wrappers override inherited `DATABASE_URL` and `RETALE_NEXT_DIST_DIR`, so a shell that was previously pointed at a test database cannot accidentally redirect the daily server, and vice versa. The public scripts are fixed-mode wrappers: `--hostname/-H` and `--port/-p` are rejected instead of changing the target server profile. If port `14500` or `3000` is already occupied, the wrapper exits with a clear error instead of killing unknown processes. Internal `.sisyphus` test DB/dist overrides remain reserved for the Playwright web-server helper.

## Production check

```bash
npm run build
npm run start
```

## Persistence

- SQLite database: `dev.db` in the project root
- Workspace state is saved through `POST /api/workspace`
- AI settings are saved through `POST /api/settings/ai`

## Notes

- No auth, collaboration, or cloud sync: intentionally single-user.
- The current persistence layer stores the full workspace state JSON in SQLite for simplicity.
- OpenAI-compatible rewrite calls expect a server implementing `POST /chat/completions`.
- If AI config is missing or the upstream request fails, `/api/rewrite` returns a structured provider error so you can configure or fix the selected OpenAI-compatible or Ollama settings.
- Import currently assumes valid exported JSON.
- Preset compatibility scope, provider mappings, preserved-only behavior, provenance notes, and MVP limitations live in `docs/preset-compatibility.md`.
- Knowledge graph design, rebuild ordering, and runtime technology notes live in `docs/knowledge-graph-design.md`.
