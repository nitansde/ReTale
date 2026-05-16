# Preset compatibility

## Scope

ChatBook ships a neutral `preset-compat` subsystem for importing, storing, editing, exporting, and selectively applying preset data. It is a compatibility layer, not a claim of full upstream feature parity.

The current runtime applies preset data only on these opted-in creative surfaces:

- `rewrite`
- `expand`
- `roleplay`
- `polish`
- `continue`
- `future_jump_rewrite`

These surfaces stay fail-closed and do not receive imported preset prompt rules, regex transforms, or sampler overrides:

- `future_jump_bridge`
- `what_if_delta_extraction`
- `knowledge_extraction`
- `embeddings`

## Clean-room provenance and attribution

This subsystem is a clean-room compatibility implementation under ChatBook's neutral internal `preset-compat` naming. It does not copy upstream runtime code into the shipped implementation.

The team researched the upstream preset shape, example data, and license material from the vendored reference mirror in `external/SillyTavern/` and the fixture in `external/resets_example.json`. That reference mirror is clearly marked as upstream research material, and its package metadata and README both identify it as `AGPL-3.0`.

Research attribution for the upstream source:

- Upstream project: `external/SillyTavern/`
- Repository URL from upstream metadata: <https://github.com/SillyTavern/SillyTavern.git>
- Upstream license recorded in both `external/SillyTavern/package.json` and `external/SillyTavern/README.md`: `AGPL-3.0`

## Opted-in runtime surfaces

When a preset is bound to an opted-in creative surface, ChatBook resolves the active preset at request time and applies the supported subset only.

- Provider sampler fields are mapped through `lib/preset-compat/capability-matrix.ts`.
- Imported `system` prompt rules are appended to the system prompt under `## Imported Preset System Rules`.
- Imported `user` prompt rules are prepended to the outgoing user prompt under `## Imported Preset User Rules`.
- Input-side regex rules run only on the final outgoing user prompt.
- Output-side regex rules run only on generated assistant text.

## Provider capability matrix

The provider matrix is intentionally narrow and hard-coded.

### `openai-compatible`

Applied request fields:

| Preset field | Outgoing request field |
| --- | --- |
| `temperature` | `temperature` |
| `top_p` | `top_p` |
| `frequency_penalty` | `frequency_penalty` |
| `presence_penalty` | `presence_penalty` |
| `openai_max_tokens` | `max_tokens` |

Preserved-only fields for `openai-compatible`:

`top_k`, `top_a`, `min_p`, `repetition_penalty`, `openai_max_context`, `max_context_unlocked`, `names_behavior`, `send_if_empty`, `impersonation_prompt`, `new_chat_prompt`, `new_group_chat_prompt`, `new_example_chat_prompt`, `continue_nudge_prompt`, `bias_preset_selected`, `wi_format`, `scenario_format`, `personality_format`, `group_nudge_prompt`, `stream_openai`, `function_calling`, `show_thoughts`, `reasoning_effort`, `seed`

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

Preserved-only fields for `ollama`:

`presence_penalty`, `frequency_penalty`, `top_a`, `openai_max_context`, `max_context_unlocked`, `names_behavior`, `send_if_empty`, `impersonation_prompt`, `new_chat_prompt`, `new_group_chat_prompt`, `new_example_chat_prompt`, `continue_nudge_prompt`, `bias_preset_selected`, `wi_format`, `scenario_format`, `personality_format`, `group_nudge_prompt`, `stream_openai`, `function_calling`, `show_thoughts`, `reasoning_effort`

## Prompt-rule subset

The MVP prompt-rule runtime is intentionally smaller than the preserved import/export shape.

Supported prompt-rule behavior:

- Only rules present in the active surface order list are considered.
- Only enabled rules are considered.
- Only non-empty rules are applied.
- Only `system` and `user` roles are applied.
- Rules are sorted by `injectionOrder`, with original array order as the fallback when two rules tie or omit that value.

Preserved-only prompt metadata:

- `injectionPosition`
- `injectionDepth`
- `injectionTrigger`
- `forbidOverrides`

Current runtime skips, but preserves for export, these prompt-rule cases:

- marker prompts
- unsupported roles such as `assistant`
- active rules with empty content

## Regex subset

The regex runtime is also an MVP subset.

Supported regex behavior:

- execution phases: `user_input` and `assistant_output`
- ordered execution: attached standalone regexes first, embedded preset regexes second
- regex source formats: raw pattern strings and `/pattern/flags` literals
- raw-pattern flag handling: `g` is added automatically when missing
- replacement tokens: `{{match}}`, `$0`, numbered captures such as `$1`, and named captures such as `$<name>`
- trim filtering on substituted capture values through `trimStrings`
- runtime gates: `promptOnly`, `markdownOnly`, `minDepth`, `maxDepth`, and `runOnEdit`
- hard limits: at most `100` active rules and input length at most `200000` characters

Preserved, but not executed, regex behavior:

- placements outside `user_input` and `assistant_output`, including `slash_command`, `world_info`, `reasoning`, and `md_display`
- `substituteRegex` modes other than `0`

## Preserved-only fields and passthrough behavior

`preset-compat` preserves more than it executes so imported payloads can still round-trip safely.

- Provider-specific preserved-only sampler fields stay in export data and generate warnings when present.
- Fields whose names start with `image_` or `inline_image_` are preserved for export, not applied at runtime.
- `extensions.SPreset` is preserved for export, not applied at runtime.
- Unknown prompt metadata and other passthrough records stay attached to the normalized preset data.

This is why the UI and warnings use the term `preserved-only`.

## Limitations

This compatibility layer should be read as an explicit subset.

- It does not claim full upstream preset, prompt-rule, or regex runtime parity.
- Analytical and retrieval paths stay fail-closed even if a binding exists.
- Prompt-rule metadata is preserved more broadly than it is executed.
- Regex placement support is narrower than the preserved import/export shape.
- Provider support is limited to the exact fields listed in the matrix above.

## Stream buffering behavior

Streaming keeps the normal pass-through path unless an active `assistant_output` regex needs post-processing.

- If no active output regex is present, the provider stream is returned directly.
- If an active output regex is present, ChatBook buffers the full text stream, runs the `assistant_output` regex subset once on the complete text, then re-emits the transformed text as a new stream.

That buffering rule exists so cross-chunk replacements still work correctly.
