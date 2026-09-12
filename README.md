# retale

A self-hosted single-user AI novel rewrite app built with Next.js.

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
- Novel and chapter persistence stored in SQLite through direct SQL server modules
- HanLP-assisted knowledge graph rebuilds with tiered characters, alias synchronization, candidate promotion, and persistent cache state
- JSON export / import for workspace state
- In-app OpenAI-compatible API settings modal
- Real rewrite requests through `/api/rewrite` when configured
- Structured rewrite provider errors with in-app setup guidance when AI config is missing or the provider request fails

## Environment

ReTale requires Node.js `>=22.15.0`. Development knowledge workers and the text-repair CLI use synchronous `node:module` loader hooks; older Node releases do not provide the required `registerHooks` API. Production workers load the compiled application graph from `.retale-worker/`, built automatically by `npm run build` (or separately by `npm run build:worker`). With `NODE_ENV=production`, a missing bundle is recorded as a startup failure for the matching queued attempt; the worker does not fall back to source compilation. Development always loads current sources. Deployment traces include the worker bundle, source map, diagnostics, and native LanceDB dependencies; the production worker needs neither local TypeScript sources nor the TypeScript compiler.

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
LLM_DEBUG_LOG="0"
LLM_DEBUG_LOG_DIR=".sisyphus/llm-debug"
```

You can also update the AI settings from the app UI.

Set `LLM_DEBUG_LOG="1"` during local development to write raw server-side LLM prompt/response JSON files into feature-specific folders under `LLM_DEBUG_LOG_DIR`.

### Knowledge graph runtime

Knowledge graph rebuilds use the server-side `hanlp_bootstrap.py` script before LLM extraction. `npm install` runs `scripts/setup-hanlp-runtime.mjs`, which creates a pinned HanLP virtualenv outside the project root, writes `HANLP_PYTHON_BIN` and `HANLP_BOOTSTRAP_SCRIPT_PATH` to `.env.local`, and avoids Next/Turbopack tracing Python virtualenv symlinks during builds. The daily `npm run dev:prod` startup also verifies this managed runtime and rebuilds it with the currently available Python when the interpreter link is stale, required packages are missing, or `.env.local` still points to a legacy environment. Run `npm run setup:hanlp` to recreate and smoke-test the runtime manually. Set `RETALE_SKIP_HANLP_SETUP=1` only when intentionally skipping local knowledge-graph rebuild support. `HANLP_BOOTSTRAP_SCRIPT_PATH` can point at an alternate bootstrap script; when unset, the app uses the repository script. `HANLP_BOOTSTRAP_PARALLELISM` defaults to `1` so rebuilds do not spawn multiple heavyweight HanLP model processes; raise it only after validating local memory. `HANLP_BOOTSTRAP_BATCH_SIZE` defaults to `256` and controls how many sentence/line segments the bootstrap script sends to HanLP per model call. `HANLP_BOOTSTRAP_TIMEOUT_MS` controls the per-chapter HanLP subprocess timeout and defaults to `600000`.

The rebuild API returns quickly with a queued/running job status. The server continues the rebuild in the background and the workspace polls job state instead of blocking the whole site while HanLP is running.

Background task watchdogs use `RETALE_TASK_STALE_TIMEOUT_MS` to decide when a queued/running knowledge or recoverable rewrite job has stopped making progress, and `RETALE_TASK_MAX_RETRIES` to cap automatic retry attempts. When a job is retried, ReTale writes a new in-payload attempt token so stale old workers cannot overwrite the newer retry or a terminal watchdog failure. Detached worker startup failures are fenced by the scheduled attempt token before they can mark a queued job failed. Knowledge-view reads also reschedule queued watchdog retries, so users do not need to press rebuild again after a stale worker is reconciled.

Detached knowledge workers retain stderr and fatal exception diagnostics in `worker-logs/` beside the novel's `novel.db`. Each log is capped at 512 KiB; rotation retains at most 20 recent log files per novel (10 MiB), including logs from exited workers. Files use owner-only permissions and survive server restarts. Stderr also remains visible in the launching server's logs, including failures before the worker logger starts. Recording diagnostics does not change attempt ownership or overwrite running/completed jobs.

SQLite transaction wrappers serialize callers and retry `BEGIN IMMEDIATE` asynchronously within the connection's configured busy timeout. This keeps lock acquisition from blocking request timers; statements themselves, schema initialization, and writes outside these wrappers still use synchronous SQLite. Concurrent code using the singleton helpers must use `withTransaction`; unrelated synchronous singleton statements are rejected while another caller owns a transaction.

## First-time setup

```bash
npm install
npm run dev
```

Open http://localhost:14500. Browser API access is same-origin by default. The default daily developer command is `npm run dev` (same as `npm run dev:prod`) and it always binds `0.0.0.0:14500`, always forces `DATABASE_URL=file:./dev.db`, and uses Next's development output so it stays separate from production builds and the isolated test server.

For a separate trusted frontend or a reverse proxy whose public origin differs from the origin seen by Next, set `RETALE_ALLOWED_API_ORIGINS` to comma-separated exact origins, for example `https://retale.example,http://localhost:4000`. Include a non-default port when used; paths, trailing slashes, credentials, and wildcards are rejected. Only configured origins receive CORS headers. Origin-less CLI clients remain supported; these browser checks do not add authentication.

JSON API requests require `Content-Type: application/json`. Default request bodies are capped at 1 MiB; generation/context/session text requests allow 8 MiB, and preset-library requests allow 16 MiB. Workspace snapshots retain their 16 MiB cap, chapter patches their 4 MiB cap, and uploads their existing file/body limits. Limits count received bytes even without a trustworthy `Content-Length`; rejected media types and oversized bodies return 415 and 413 respectively.

Workspace recovery backups keep at most 20 snapshots and 200 MiB of UTF-8 payload per workspace. Set `RETALE_BACKUP_MAX_COUNT` and `RETALE_BACKUP_MAX_BYTES` to change those limits. The newest backup is always kept, even if it alone exceeds the byte budget. Pruning happens within the existing workspace save/checkpoint transaction.

Embedding-cache retention runs after successful raw-text precomputation. It protects the current model, the model used by that precomputation, and identities referenced by queued, running, or paused rebuilds. Legacy job snapshots without an exact identity protect matching model variants; incomplete snapshots protect the affected branch. Failed/aborted jobs are terminal and do not pin caches. Inactive identities survive at least 7 days for model switching, then are eligible when the cache exceeds 1 GiB per novel or they have gone unused for 30 days. Configure positive integer values with `RETALE_EMBEDDING_CACHE_MAX_BYTES`, `RETALE_EMBEDDING_CACHE_MAX_AGE_DAYS`, and `RETALE_EMBEDDING_CACHE_GRACE_DAYS`. Protected/recent scopes can exceed the budget. Cleanup deletes up to 500 rows per eligible scope and 2,000 rows per completed precomputation, rechecking job protection and last use inside each transaction.

Use `npm run storage:preview -- --database data/novels/<novel-id>/novel.db` for a read-only report of backup retention, embedding scopes, reusable database pages, and derived-text/count mismatches. No schema initialization, cleanup, repair, or compaction runs. Cache models are all protected in the preview unless you supply the active exact identity with `--protect-model 'provider=cache-model-identity'` (repeatable); job protection still applies. The CLI reads `.env*` configuration and never prints novel text or API credentials. Both previews and retention use SQLite byte counts without loading full backup payloads into JavaScript. Logical deletion makes pages reusable; it does not promise a smaller database file. Compaction is a separate maintenance operation.

For persisted text affected by the former HTML-entity decoder, run `npm run storage:repair-text -- --database PATH --novel-id ID`. This is a read-only preview: it reports the current workspace revision, exact entity-related repairs, skipped count differences, and blockers without printing manuscript text. Applying requires `--apply --expected-revision N`, using the previewed revision. The database must match the configured `RETALE_DATA_DIR` novel store and have a ready registry entry. Finish or abort queued/running/paused jobs and finish or recover claimed workspace syncs first. Changes unrelated to entity decoding must be synchronized through the normal workspace workflow before repair.

Text repair leaves chapter HTML intact, re-derives affected knowledge text, refreshes line/span offsets, and marks dependent generated knowledge and retrieval stale. It corrects counts for those chapters and counts exactly explained by the old decoder, leaving other count differences alone. Count corrections use the existing workspace mutation contract, including a new revision, recovery snapshot, backup retention, and sync claim. A single SQLite transaction commits the workspace and knowledge changes together; a failed repair can be retried. Retrieval tables are derived filesystem data and may have been removed even if SQLite rolls back, so they may need rebuilding after a failed attempt. Repair does not call a model: rebuild the novel's knowledge and retrieval from the workspace afterward. The CLI holds a write lock while repairing, so run it when the novel is idle.

Embedding-cache storage uses only validated little-endian float32 BLOBs (four bytes per dimension). The application rejects an unmigrated JSON schema with migration instructions. It has no JSON fallback, empty-array placeholder writes, or old-writer trigger. A corrupt binary vector becomes a cache miss and is regenerated normally.

To upgrade existing data, stop the server and all workers, finish or abort active/resumable jobs, and keep a verified database backup. Run retention first to avoid converting obsolete vectors:

```bash
npm run storage:preview -- --database PATH --protect-model 'provider=exact-cache-model-identity'
npm run storage:apply-retention -- --database PATH --protect-model 'provider=exact-cache-model-identity' --apply
npm run storage:migrate-vectors -- --database PATH --novel-id ID
npm run storage:migrate-vectors -- --database PATH --novel-id ID --apply --retire-json --limit 250
```

Repeat conversion using the returned `nextRowId` as `--after-rowid` until `scanned` is zero, for every novel in that database. Each batch verifies the stored bytes and float32-rounded values before retiring JSON. Invalid or conflicting rows are reported and retained. Then run `storage:migrate-vectors` with `--apply --finalize`: it verifies every retained BLOB and atomically replaces the cache table, removing the JSON column and compatibility trigger. Finalization refuses unconverted or corrupt rows. Keep old application processes stopped; restoring old application code also requires restoring the database backup.

Run `npm run storage:migrate-progress -- --database PATH` to preview recognized old progress messages, then add `--apply` to convert job progress and stored step labels/details to stable keys. Prompts and custom diagnostics are preserved. Runtime progress parsing accepts stable keys only; historical decoding is confined to these explicit offline tools.

After vector finalization, run the text-repair preview/apply commands above when needed. Finish with `storage:apply-retention -- --database PATH --protect-model 'provider=exact-cache-model-identity' --apply --compact`. Compaction writes and verifies a smaller SQLite file before replacing the original; allow temporary space for that file and leave the server stopped until it completes. Backups remain separate from application retention. Restart only after verifying database integrity and the maintenance reports.

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

`npm run build` uses webpack by default for reliable production builds, selects `tsconfig.build.json` so Next's production type check covers application and server sources without test or evidence inputs, then records a deterministic fingerprint of tracked and untracked production inputs inside the selected Next dist directory. An intentional Turbopack trial remains available with `npm run build -- --turbopack`. `npm run start` launches that existing build only when its fingerprint still matches the current source; it refuses missing or stale provenance and asks you to rebuild. `npm run check:next-build-safety` scans that build's initial `/workspace` and `/library` JavaScript sizes, output-file traces, and required runtime assets, then writes hidden evidence to `.sisyphus/evidence/next-build-safety/next-build-safety.json`.

Run `npm run verify:production-freshness` to exercise an isolated real `next build` / `next start` lifecycle through the installed Next CLI. The harness uses marker-owned database, data, and Next dist paths under `.sisyphus/runtime/production-smoke-runs/`, so its build neither replaces `.next` nor scans or mutates production `data/` or root `dev.db`. It starts on `127.0.0.1:3000`, checks `/library`, `/workspace`, and `/task`, then inserts an active task after the build and verifies `/task` reflects it without rebuilding. Port `3000` must be free; the harness refuses to kill an unknown listener and stops its own server on success, failure, or termination.

## Per-novel storage

Runtime data lives under `RETALE_DATA_DIR` (default: `data/`) with this layout:

- `data/control.db`
- `data/novels/<safeNovelId>/novel.db`
- `data/novels/<safeNovelId>/lancedb/`

The app reads and writes only this migrated per-novel layout at runtime. The old repository-root `dev.db` is no longer a runtime database source.

SQLite schema version **4** is the only runtime format. Fresh files receive the complete control or novel schema and explicit version/kind markers. Opening an existing file validates its version, kind, and required tables, indexes, and triggers; startup never upgrades an older file. Server code must enter `runWithNovelDatabaseAccess(novelId, callback)` or receive an explicit `DatabaseAccess`. Calling database helpers outside a scope fails; neither `DATABASE_URL` nor `globalThis.sqlite` supplies a shared fallback.

The current library uses schema v4. The one-time schema migration tool has been deleted. Existing files must already use the current schema; restore a verified compatible backup or use the application version matching an older database. The separate vector/progress maintenance tools do not upgrade an older library to schema v4.

Per-novel `lancedb/` directories are part of the runtime layout, so LanceDB-backed knowledge retrieval artifacts are stored and rebuilt per novel instead of through a single global `.lancedb/` directory.

## Data model and browser session

The primary content hierarchy is `Novel → Chapter[]`. There is no `Volume` resource or volume compatibility path.

Workspace-like UI state belongs to the browser rather than the server. The active novel, each novel's last-opened chapter, the active editor/helper tabs, and focus mode are stored in `localStorage` under `retale.workspace-session.v1`. Server responses cannot override that browser session.

The browser-facing persistence API is resource-oriented:

- `GET /api/novels` lists compact novel summaries without a server-side active-novel field.
- `GET /api/novels/:novelId` loads one novel aggregate and its chapters/reference data.
- `POST /api/novels/:novelId` saves structural changes for that novel.
- `DELETE /api/novels/:novelId` permanently deletes that novel.
- `PATCH /api/chapters/:chapterId` saves an ordinary chapter edit.

There is no server workspace endpoint. Browser clients use only the novel and chapter resource APIs.

## Persistence

- Migrated runtime storage: `data/control.db` plus `data/novels/<safeNovelId>/novel.db`
- Per-novel LanceDB storage: `data/novels/<safeNovelId>/lancedb/`
- Old monolithic `dev.db`: no longer used at runtime
- `GET /api/novels/:novelId` restores one novel and its current content revision. An idle editor mount reads state without issuing a write.
- Ordinary chapter edits use revision-aware `PATCH /api/chapters/:chapterId` requests with `Idempotency-Key`, `X-Retale-Base-Revision`, and `X-Retale-Revision-Novel-Id` identifying the revision owner.
- Structural novel changes use revision-aware `POST /api/novels/:novelId` requests with the same complete three-header contract.
- Novel import completes synchronously and makes the imported novel ready at revision 1.
- A stale revision conflict preserves local edits instead of replacing them with server state.
- PATCH falls back to revision-aware POST only when the server reports PATCH as unsupported with HTTP 405 or 501.
- Browser API requests use same-origin checks; additional cross-origin access is opt-in.
- AI settings are saved through `POST /api/settings/ai`

## Notes

- No auth, collaboration, or cloud sync: intentionally single-user.
- Runtime storage is the per-novel `data/` layout; the old monolithic `dev.db` is not read by the app.
- OpenAI-compatible rewrite calls accept HTTP or HTTPS base URLs and expect a server implementing `POST /chat/completions`. Use HTTP only on a trusted network because API keys and prompts are otherwise sent without transport encryption.
- If AI config is missing or the upstream request fails, `/api/rewrite` returns a structured provider error so you can configure or fix the selected OpenAI-compatible or Ollama settings.
- Import currently assumes valid exported JSON.
- Preset compatibility scope, provider mappings, preserved-only behavior, provenance notes, and MVP limitations live in `docs/preset-compatibility.md`.
- Knowledge graph design, rebuild ordering, and runtime technology notes live in `docs/knowledge-graph-design.md`.

### Test isolation and concurrency

`npm run test:unit` and `npm run test:api` run at most two test files concurrently. Each file receives its own marked database, source database, data directory, temporary directory, and evidence directory before application modules load. Set `RETALE_TEST_WORKERS=1` for a serial run, or an integer up to 8 when evaluating another limit. Tests within a file keep their existing ordering. Each suite retains its own JSON report under the printed run root; the historical `.sisyphus/evidence/task-1-test-harness/` path contains the latest report. Run tests through these wrappers so the ownership checks and isolation environment are present.
