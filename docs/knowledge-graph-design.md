# Knowledge Graph Design and Technology Stack

ChatBook's knowledge graph rebuild is a local-first pipeline for turning novel chapters into authoritative character, alias, candidate, and retrieval context data. The implementation extends the existing `KnowledgeJob` rebuild flow instead of adding a parallel graph subsystem.

## Goals

- Keep rebuilds automatic: no manual alias review, no candidate promotion gate, and no spoiler lifecycle.
- Use HanLP before LLM extraction to provide deterministic Chinese segmentation, named-entity signals, chapter coverage, and cacheable bootstrap data.
- Preserve deterministic writes even when chapter extraction requests run in parallel.
- Keep the site responsive while rebuild work continues in the background.

## Data Model

The authoritative state is stored in SQLite through direct server-side SQL modules. The main persisted concepts are:

- `KnowledgeJob`: rebuild lifecycle, progress, phase status, and user-visible error state.
- `KnowledgeEntity`: canonical graph entities with character tier metadata for formal characters.
- `EntityAliasMapping` and `EntityAlias`: branch-scoped alias mapping plus compatibility aliases for graph and retrieval consumers.
- Alias conflict logs: deterministic audit trail when an alias is already mapped to a different canonical target.
- HanLP cache and entity rows: per-chapter bootstrap results keyed by novel, branch, chapter, text hash, script hash, model/config hash, and output schema version.
- Character candidates and candidate chapter rows: unknown character observations with distinct-chapter counting and idempotent promotion state.

Character tiers are intentionally narrow: protagonist, important supporting character, arc supporting character, candidate, and ignored. Temporary characters are not added to the formal graph.

## Rebuild Pipeline

1. Start or reuse a `KnowledgeJob` for the selected novel/branch.
2. Run HanLP bootstrap per chapter through the local Python script, reusing persisted cache rows when every cache key segment matches.
3. Initialize character tiers and bootstrap entities from HanLP aggregate signals.
4. Run one LLM extraction request per chapter for known character updates, unknown observations, and minimal alias discoveries.
5. Collect all chapter extraction results before authoritative writes.
6. Apply aliases first in deterministic order: chapter number, alias array order, then stable alias/target tie-breakers.
7. Canonicalize names, merge alias hits, and record alias conflicts without overwriting the first deterministic mapping.
8. Write unknown observations to candidates, update distinct chapter counts, and promote candidates when `chapter_count >= 10`.
9. Request one promotion summary only for each newly promoted candidate.
10. Rebuild tier-aware projection and retrieval context from the authoritative state.

No LLM call runs inside a SQLite write transaction, and the pipeline avoids a single long whole-novel write transaction.

## Non-Blocking Rebuild UX

The knowledge-view rebuild API starts the job and returns queued/running status immediately. Next.js `after()` schedules the background worker after the response, so the browser can keep using the app while HanLP and LLM phases run. The workspace store treats `queued` and `running` as valid action outcomes and polls `knowledgeRebuildStatus` for progress.

The HanLP subprocess runner uses async `child_process.spawn`, not synchronous child-process APIs, so Python execution does not block Node's event loop.

## Runtime Configuration

HanLP runs only on the server. Configure these environment variables when running rebuilds locally or in production:

```bash
HANLP_PYTHON_BIN="/absolute/path/to/python"
HANLP_BOOTSTRAP_SCRIPT_PATH="/optional/absolute/path/to/hanlp_bootstrap.py"
HANLP_BOOTSTRAP_TIMEOUT_MS="600000"
```

Keep Python virtual environments outside the project root. This avoids Next/Turbopack file tracing Python virtualenv symlinks during `next build`.

## Technology Stack

- Next.js route handlers for API entry points and `after()` background scheduling.
- React, Tailwind CSS, and Zustand for workspace state, graph controls, and rebuild polling.
- TypeScript server modules for typed contracts, deterministic sync, cache validation, and projection assembly.
- SQLite for local authoritative persistence and job/cache state.
- Python plus HanLP for local Chinese NLP bootstrap extraction.
- OpenAI-compatible `/chat/completions` for chapter extraction and promotion summaries.
- Vitest API/unit suites and Playwright UI smoke tests for regression coverage.
