# novel-ui

A self-hosted single-user AI novel rewrite workspace built with Next.js.

## Stack

- Next.js + React + Tailwind CSS
- TipTap editor
- Zustand client store
- SQLite with direct SQL persistence
- OpenAI-compatible `/chat/completions` integration

## What it does

This app now behaves like a local-first rewrite product with a real backend layer:

- Rich rewrite workflow with chapter / paragraph / selection scopes
- Multi-candidate rewrite batches with apply / insert / branch / continue actions
- Branch chapters represented in the chapter tree
- Rewrite control surface with modes, tones, presets, prompt editing, and constraints
- Reference panels for outlines, characters, worldbuilding, and trajectory logs
- Workspace persistence stored in SQLite through direct SQL server modules
- JSON export / import for workspace state
- In-app OpenAI-compatible API settings modal
- Real rewrite requests through `/api/rewrite` when configured
- Safe local fallback candidate generation when AI config is missing or fails

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
```

You can also update the AI settings from the app UI.

## First-time setup

```bash
npm install
npm run dev
```

Open http://localhost:3000

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
- If AI config is missing or the upstream request fails, rewrite generation falls back to local simulated candidates.
- Import currently assumes valid exported JSON.
- Preset compatibility scope, provider mappings, preserved-only behavior, provenance notes, and MVP limitations live in `docs/preset-compatibility.md`.
