# Preset compatibility

## Scope

ChatBook ships a neutral `preset-compat` subsystem for importing, storing, editing, exporting, previewing, and selectively applying preset data. It is a compatibility layer, not a claim of full upstream runtime parity.

## Opted-in runtime surfaces

The current runtime applies preset data only on these opted-in creative surfaces:

- `rewrite`
- `expand`
- `roleplay`
- `polish`
- `continue`
- `future_jump_rewrite`

These surfaces stay fail-closed and do not receive imported preset prompt rules, regex transforms, sampler overrides, or reset fragments:

- `future_jump_bridge`
- `what_if_delta_extraction`
- `knowledge_extraction`
- `embeddings`

The preset-reset scope is intentionally narrow:

- no account reset
- no settings reset
- no snapshot reset
- no full-user reset
- no full chat history persistence

`presetCompatSessionState` stores only tiny scoped phase and reset metadata. It does not persist transcripts, message trees, or a SillyTavern-style chat engine.

## Clean-room provenance and attribution

This subsystem is a clean-room compatibility implementation under ChatBook's neutral internal `preset-compat` naming. It does not copy upstream runtime code into the shipped implementation.

The team researched the upstream preset shape, example data, and license material from the vendored reference mirror in `external/SillyTavern/` and the fixture in `external/resets_example.json`. That reference mirror is clearly marked as upstream research material, and its package metadata and README both identify it as `AGPL-3.0`.

Research attribution for the upstream source:

- Upstream project: `external/SillyTavern/`
- Repository URL from upstream metadata: <https://github.com/SillyTavern/SillyTavern.git>
- Upstream license recorded in both `external/SillyTavern/package.json` and `external/SillyTavern/README.md`: `AGPL-3.0`

## Canonical runtime path

The implementation is split into a few stable layers.

- `lib/preset-compat/normalize.ts` imports preset JSON into structured storage buckets such as `runtimeSampler`, `promptTemplate`, `transport`, `preservedFields`, `promptRules`, `promptOrderLists`, `embeddedRegexes`, and `passthrough`.
- `lib/preset-compat/surface-contract.ts` owns ChatBook's built-in system prompts for opted-in creative surfaces. These prompts are ChatBook library state, not imported preset data.
- `lib/preset-compat/resolve-runtime.ts` resolves the active preset for a surface, filters prompt rules, computes `fieldStatuses`, and records `providerControlIntents`.
- `lib/preset-compat/prompt-assembly.ts` is the canonical prompt rendering layer. Routes and services feed it runtime data, they do not replace it.
- `lib/preset-compat/runtime-integration.ts` adds creative-route metadata such as `contextWindow` and `streamPolicy`.
- `components/workspace/PresetCompatPresetEditor.tsx` previews the same runtime contract in the UI.

The prompt assembly stage order is fixed:

1. `builtin_system_prompt`
2. `base_prompt`
3. `template_fragments`
4. `imported_prompt_rules`
5. `metadata_insertions`
6. `regex_processing`

`builtin_system_prompt` is the editable ChatBook-owned system prompt for the active creative surface. It is stored on the ChatBook preset compatibility library, defaults to enabled, can be disabled per surface, and is intentionally excluded from imported preset export payloads.

`user_input` regex processing still happens after prompt assembly. `assistant_output` regex processing still happens after model output.

## Structured runtime and UI metadata contract

Every creative runtime surface can expose these structured metadata channels:

- `fieldStatuses`, per-field or per-fragment applied, degraded, preserved, or unsupported state with reason codes
- `providerControlIntents`, request-path or route-path intents such as `temperature`, `max_tokens`, `contextWindow.maxContextTokens`, and `stream.enabled`
- `contextWindow`, route-level context trimming metadata for `/api/rewrite`
- `streamPolicy`, route-level stream precedence metadata

`fieldStatuses` and `providerControlIntents` remain available to route metadata, debug payloads, and tests. The preset editor focuses on bindings, generation settings, prompt content, import/export actions, and scoped reset controls instead of surfacing compatibility diagnostics inline. Reset controls are scoped to the active creative context only, they do not reset the whole library or account.

## Provider capability matrix

The provider request mapping is intentionally narrow and hard-coded.

### `openai-compatible`

Applied request fields:

| Preset field | Outgoing request field |
| --- | --- |
| `temperature` | `temperature` |
| `top_p` | `top_p` |
| `frequency_penalty` | `frequency_penalty` |
| `presence_penalty` | `presence_penalty` |
| `openai_max_tokens` | `max_tokens` |

Route-effect intents:

- `openai_max_context` -> `contextWindow.maxContextTokens`
- `stream_openai` -> `stream.enabled`
- `n` -> `candidateCount`, currently route-degraded

`seed` stays degraded and preserved-only for `openai-compatible`. It is imported, exported, status-reported, and warned, but it is not written into the outgoing OpenAI-compatible request body.

`max_context_unlocked` stays preserved-only for ChatBook runtime. It is imported, stored, exported, and status-reported for metadata consumers, but it does not emit route metadata or alter context-window trimming.

Preserved-only or degraded-without-request-mapping warnings today include fields such as `top_k`, `top_a`, `min_p`, `repetition_penalty`, `send_if_empty`, `assistant_prefill`, `assistant_impersonation`, `continue_prefill`, `continue_postfix`, `use_sysprompt`, `function_calling`, `show_thoughts`, `reasoning_effort`, `verbosity`, and image-request metadata.

The same current `openai-compatible` preserved or degraded contract also covers route and template fields such as `openai_max_context`, `max_context_unlocked`, `names_behavior`, `bias_preset_selected`, `wi_format`, `scenario_format`, `personality_format`, `group_nudge_prompt`, `stream_openai`, and `seed`. SillyTavern-only reset prompt fields such as `impersonation_prompt`, `new_chat_prompt`, `new_group_chat_prompt`, `new_example_chat_prompt`, and `continue_nudge_prompt` are imported and exported, but ChatBook ignores them at runtime.

### `ollama`

Applied request fields:

| Preset field | Outgoing request field |
| --- | --- |
| `temperature` | `options.temperature` |
| `top_p` | `options.top_p` |
| `top_k` | `options.top_k` |
| `min_p` | `options.min_p` |
| `repetition_penalty` | `options.repeat_penalty` |
| `openai_max_tokens` | `options.num_predict` |
| `seed` | `options.seed` |

Route-effect intents:

- `openai_max_context` -> `contextWindow.maxContextTokens`
- `stream_openai` -> `stream.enabled`
- `n` -> `candidateCount`, currently route-degraded

Preserved-only or degraded-without-request-mapping warnings today include fields such as `presence_penalty`, `frequency_penalty`, `top_a`, `assistant_prefill`, `assistant_impersonation`, `continue_prefill`, `continue_postfix`, `use_sysprompt`, `function_calling`, `show_thoughts`, `reasoning_effort`, and `verbosity`.

The same current `ollama` preserved or degraded contract also covers route and template fields such as `openai_max_context`, `max_context_unlocked`, `names_behavior`, `send_if_empty`, `bias_preset_selected`, `wi_format`, `scenario_format`, `personality_format`, `group_nudge_prompt`, and `stream_openai`. SillyTavern-only reset prompt fields such as `impersonation_prompt`, `new_chat_prompt`, `new_group_chat_prompt`, `new_example_chat_prompt`, and `continue_nudge_prompt` are imported and exported, but ChatBook ignores them at runtime.

## Route behavior

### `/api/rewrite`

`/api/rewrite` is the most complete creative integration.

- It resolves preset runtime through `applyPresetCompatCreativeRuntime()` and `resolveCreativeRoutePresetCompatMetadata()`.
- It supports context-window trimming when `openai_max_context` is present.
- It supports the stream precedence rule `explicit request override > imported preset value > provider default`.
- It returns structured preset metadata in JSON responses and in the base64 `X-ChatBook-Preset-Compat` header for streaming responses.

### `future_jump_rewrite`

`future_jump_rewrite` uses the same creative runtime and prompt assembly contract for prompt rules, supported ChatBook template fragments, and regex handling. SillyTavern-only reset prompt fields remain ignored there too.

It stays honest about route controls it cannot safely enforce:

- `openai_max_context` degrades to `ROUTE_UNSUPPORTED`
- `stream_openai` degrades to `ROUTE_UNSUPPORTED`

### Analytical fail-closed routes

`future_jump_bridge`, `what_if_delta_extraction`, `knowledge_extraction`, and `embeddings` remain fail-closed. Imported creative preset fragments are not applied there, even when a surface binding exists.

## Prompt-rule subset

Prompt rules apply a deliberately narrow ChatBook compatibility subset.

- `prompt_order.character_id:100001` is the current active order and enabled-state bucket.
- If the `100001` bucket is absent, import falls back to natural `prompts[]` order and each prompt's own `enabled` value.
- `system_prompt:true` makes imported system-rule content replace the route-provided base prompt for creative routes. It does not replace the earlier ChatBook-owned `builtin_system_prompt` stage; disable the built-in rule for that surface if the imported preset should be the first system content.
- `system_prompt:false` injects imported rule content at the top of the user prompt before native ChatBook context.
- supported runtime roles are `system` and `user`, but ChatBook uses `system_prompt` as the runtime channel switch for imported rules.
- `forbid_overrides` locks ChatBook content editing for that imported rule; it does not block same-slot runtime prompt rules.
- `injectionPosition`, `injectionDepth`, `injectionOrder`, `injectionTrigger`, and `marker` are preserved for export only and have no ChatBook runtime effect.
- allowlisted `condition` values are evaluated without `eval`.
- unsupported roles degrade with explicit warnings instead of being silently dropped.

## Regex subset

The regex runtime is still a bounded subset.

Supported behavior:

- execution phases: `user_input` and `assistant_output`
- ordering: attached standalone regexes first, embedded preset regexes second
- source formats: raw pattern strings and `/pattern/flags` literals
- replacement tokens: `{{match}}`, `$0`, numbered captures, and named captures
- runtime gates: `promptOnly`, `markdownOnly`, `minDepth`, `maxDepth`, and `runOnEdit`
- hard limits: at most `100` active rules and input length at most `200000` characters

Preserved or degraded behavior:

- placements outside `user_input` and `assistant_output`, including `slash_command`, `world_info`, `reasoning`, and `md_display`
- `substituteRegex` modes other than `0`
- edit-hook semantics beyond the current bounded runtime

## Preserved-only fields and passthrough behavior

`preset-compat` preserves more than it executes so imported payloads can still round-trip safely.

- root passthrough lives in `preset.passthrough.root`
- extension passthrough lives in `preset.passthrough.extensions`
- unknown prompt-entry fields live in `preset.passthrough.unknownPromptFields`
- legacy flat prompt aliases are tracked in `preset.passthrough.legacyFlatPrompts`
- `extensions.SPreset`, `extensions.MacroNest`, `extensions.ToolBindings`, and `extensions.tavern_helper` are preserved for export
- image-related fields with `image_` or `inline_image_` prefixes are preserved for export
- macro-bearing prompt content stays in `promptRules[].content` and is exported back unchanged

This is why the UI and warnings use the term `preserved-only`.

## Macro capability contract

Macro compatibility is now described by the dedicated contract in `lib/preset-compat/macro-types.ts` instead of the old blanket `MACRO_TODO` placeholder.

- macro names are matched case-insensitively
- aliases may exist and resolve to a canonical macro name in contract metadata
- the contract distinguishes `supported-runtime`, `context-partial`, `preserve-storage-only`, and `unsupported-runtime`
- raw macro text is preserved in stored and exported preset payloads
- supported and context-partial macros expand at runtime on opted-in creative surfaces
- editor preview, `/api/rewrite`, `future_jump_rewrite`, and regex replacement-time flows use that runtime path
- analytical surfaces stay fail-closed, and unsupported macros or macros with missing context resolve to `""` with structured diagnostics instead of mutating stored preset payloads

Current v1 contract examples:

- `setvar`, `getvar`, and `trim` are part of the supported runtime subset and can expand during creative preset execution while their raw source text still round-trips through storage and export
- `user`, `bot`, and `char` / `charIfNotGroup` are `context-partial` because they depend on runtime naming context. `{{user}}` resolves to the current roleplay/named-transcript user when provided, then to the inferred protagonist/main-viewpoint character from the built knowledge context when available, and finally to `主人公` without a diagnostic when no name is available. `bot` and `char` still require runtime naming context and otherwise resolve to `""` with diagnostics.
- comment-style macros stay `preserve-storage-only` in stored and exported preset JSON, while runtime-only unsupported or unavailable macros never mutate the saved prompt content
- UI/runtime and STscript-only macros such as `input`, `outlet`, `banned`, `summary`, `hasExtension`, `lastGenerationType`, `var`, `pipe`, and `timesIndex` are explicitly `unsupported-runtime`

Stable macro diagnostic codes for later parser/runtime tasks are:

- `UNKNOWN_MACRO`
- `UNSUPPORTED_MACRO`
- `MISSING_CONTEXT_VALUE`
- `MALFORMED_MACRO`
- `INVALID_ARGUMENTS`
- `UNSUPPORTED_RUNTIME_SURFACE`
- `REGEX_MACRO_UNSUPPORTED_MODE`
- `MACRO_CONTEXT_WARNING`

## Detailed field mapping

The field-by-field implementation table lives in [`docs/preset-compatibility-field-mapping.md`](./preset-compatibility-field-mapping.md). That file records actual storage paths, normalization and export behavior, runtime effect, UI effect, degradation reasons, and test references.

## Limitations

This compatibility layer should be read as an explicit subset.

- It does not claim full upstream preset, prompt-rule, regex, or chat-engine parity.
- It does not implement account/settings/snapshot/full-user reset flows.
- It does not persist full chat history for reset behavior.
- Analytical and retrieval paths stay fail-closed even if a binding exists.
- Provider support is limited to the exact request fields and route intents described above.

## Stream buffering behavior

Streaming keeps the normal pass-through path unless an active `assistant_output` regex needs post-processing.

- If no active output regex is present, the provider stream is returned directly.
- If an active output regex is present, ChatBook buffers the full text stream, runs the `assistant_output` regex subset once on the complete text, then re-emits the transformed text as a new stream.

That buffering rule exists so cross-chunk replacements still work correctly.
