import { NextResponse } from 'next/server'
import {
  normalizePresetCompatPresetImport,
  normalizePresetCompatStandaloneRegexImport,
} from '@/lib/preset-compat/normalize'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import {
  loadStoredPresetCompatLibrary,
  saveStoredPresetCompatLibrary,
} from '@/lib/server/preset-compat-library'

type ConflictPolicy = 'copy' | 'replace'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeConflictPolicy(value: unknown): ConflictPolicy | null {
  if (value === undefined) {
    return 'copy'
  }
  return value === 'copy' || value === 'replace' ? value : null
}

function normalizeNameHint(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function extractStandaloneRegexEntries(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!isRecord(payload)) {
    return null
  }
  if (Array.isArray(payload.regex_scripts)) {
    return payload.regex_scripts
  }
  if (isRecord(payload.RegexBinding) && Array.isArray(payload.RegexBinding.regexes)) {
    return payload.RegexBinding.regexes
  }
  if (isRecord(payload.SPreset) && isRecord(payload.SPreset.RegexBinding) && Array.isArray(payload.SPreset.RegexBinding.regexes)) {
    return payload.SPreset.RegexBinding.regexes
  }
  return null
}

function resolvePresetReplacementId(payload: unknown, library: PresetCompatLibrary) {
  if (!isRecord(payload)) {
    return null
  }
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  return id && library.presets[id] ? id : null
}

function resolveRegexReplacementIds(payload: unknown, library: PresetCompatLibrary) {
  const entries = extractStandaloneRegexEntries(payload)
  if (!entries) {
    return null
  }

  const replacementIds: string[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) {
      return null
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id || !library.standaloneRegexes[id]) {
      return null
    }
    replacementIds.push(id)
  }

  return replacementIds
}

function getPresetExistingNames(library: PresetCompatLibrary, replacementId: string | null) {
  return Object.values(library.presets)
    .filter((preset) => preset.id !== replacementId)
    .map((preset) => preset.name)
}

function getStandaloneRegexExistingNames(library: PresetCompatLibrary, replacementIds: string[] | null) {
  const replacementIdSet = new Set(replacementIds ?? [])
  return Object.values(library.standaloneRegexes)
    .filter((regexRecord) => !replacementIdSet.has(regexRecord.id))
    .map((regexRecord) => regexRecord.name)
}

function assignNonDestructiveRegexIds(
  regexes: PresetCompatLibrary['standaloneRegexes'][string][],
  existingRegexes: PresetCompatLibrary['standaloneRegexes']
) {
  const usedIds = new Set(Object.keys(existingRegexes))

  return regexes.map((regexRecord) => {
    let nextId = regexRecord.id.trim()
    while (!nextId || usedIds.has(nextId)) {
      nextId = crypto.randomUUID()
    }
    usedIds.add(nextId)

    return nextId === regexRecord.id
      ? regexRecord
      : {
          ...regexRecord,
          id: nextId,
        }
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!isRecord(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_json_body' }, { status: 400 })
    }

    const kind = body.kind
    if (kind !== 'preset' && kind !== 'regex') {
      return NextResponse.json({ ok: false, error: 'invalid_import_kind' }, { status: 400 })
    }

    if (typeof body.jsonText !== 'string') {
      return NextResponse.json({ ok: false, error: 'invalid_json_text' }, { status: 400 })
    }

    const conflictPolicy = normalizeConflictPolicy(body.conflictPolicy)
    if (conflictPolicy === null) {
      return NextResponse.json({ ok: false, error: 'invalid_conflict_policy' }, { status: 400 })
    }

    let parsedPayload: unknown
    try {
      parsedPayload = JSON.parse(body.jsonText)
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json_text' }, { status: 400 })
    }

    const current = loadStoredPresetCompatLibrary()
    const now = new Date().toISOString()

    if (kind === 'preset') {
      if (!isRecord(parsedPayload)) {
        return NextResponse.json({ ok: false, error: 'invalid_preset_payload' }, { status: 400 })
      }

      const replacementId = conflictPolicy === 'replace'
        ? resolvePresetReplacementId(parsedPayload, current)
        : null
      if (conflictPolicy === 'replace' && !replacementId) {
        return NextResponse.json({ ok: false, error: 'replace_requires_resolvable_id' }, { status: 400 })
      }

      const existingPreset = replacementId ? current.presets[replacementId] : null
      const normalized = normalizePresetCompatPresetImport(parsedPayload, {
        nameHint: normalizeNameHint(body.nameHint),
        existingNames: getPresetExistingNames(current, replacementId),
        now,
        idFactory: replacementId ? () => replacementId : undefined,
      })

      const preset = replacementId && existingPreset
        ? {
            ...normalized.preset,
            id: replacementId,
            createdAt: existingPreset.createdAt,
            updatedAt: now,
          }
        : normalized.preset

      const nextLibrary: PresetCompatLibrary = {
        ...current,
        presets: {
          ...current.presets,
          [preset.id]: preset,
        },
        lastImportedAt: now,
      }

      const library = await saveStoredPresetCompatLibrary(nextLibrary)
      return NextResponse.json({
        ok: true,
        library,
        importedIds: [preset.id],
        warnings: normalized.warnings,
      })
    }

    const regexEntries = extractStandaloneRegexEntries(parsedPayload)
    if (!regexEntries) {
      return NextResponse.json({ ok: false, error: 'invalid_regex_payload' }, { status: 400 })
    }

    const replacementIds = conflictPolicy === 'replace'
      ? resolveRegexReplacementIds(parsedPayload, current)
      : null
    if (conflictPolicy === 'replace' && !replacementIds) {
      return NextResponse.json({ ok: false, error: 'replace_requires_resolvable_id' }, { status: 400 })
    }

    const normalized = normalizePresetCompatStandaloneRegexImport(parsedPayload, {
      existingNames: getStandaloneRegexExistingNames(current, replacementIds),
      conflictPolicy: conflictPolicy === 'copy' ? 'copy' : undefined,
    })
    const normalizedRegexes = conflictPolicy === 'copy'
      ? assignNonDestructiveRegexIds(normalized.regexes, current.standaloneRegexes)
      : normalized.regexes

    const standaloneRegexes = { ...current.standaloneRegexes }
    for (const regexRecord of normalizedRegexes) {
      standaloneRegexes[regexRecord.id] = regexRecord
    }

    const nextLibrary: PresetCompatLibrary = {
      ...current,
      standaloneRegexes,
      lastImportedAt: now,
    }

    const library = await saveStoredPresetCompatLibrary(nextLibrary)
    return NextResponse.json({
      ok: true,
      library,
      importedIds: normalizedRegexes.map((regexRecord) => regexRecord.id),
      warnings: normalized.warnings,
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'failed_to_import_preset_compat_payload' }, { status: 500 })
  }
}
