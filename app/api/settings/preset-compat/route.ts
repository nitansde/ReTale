import { NextResponse } from 'next/server'
import type { PresetCompatLibrary } from '@/lib/preset-compat/types'
import {
  PRESET_COMPAT_LIBRARY_V1_KEY,
  loadProtectedPresetCompatLibraryResetSnapshot,
  loadStoredPresetCompatLibrary,
  saveStoredPresetCompatLibrary,
  validateProtectedPresetCompatLibraryResetSnapshot,
} from '@/lib/server/preset-compat-library'

export {
  PRESET_COMPAT_LIBRARY_V1_KEY,
  loadProtectedPresetCompatLibraryResetSnapshot,
  validateProtectedPresetCompatLibraryResetSnapshot,
} from '@/lib/server/preset-compat-library'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeExpectedRevision(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

export async function GET() {
  return NextResponse.json(loadStoredPresetCompatLibrary())
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!isRecord(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_json_body' }, { status: 400 })
    }

    const expectedRevision = normalizeExpectedRevision(body.expectedRevision)
    if (expectedRevision === null) {
      return NextResponse.json({ ok: false, error: 'invalid_expected_revision' }, { status: 400 })
    }

    if (!('library' in body)) {
      return NextResponse.json({ ok: false, error: 'invalid_library' }, { status: 400 })
    }

    const current = loadStoredPresetCompatLibrary()
    if (current.revision !== expectedRevision) {
      return NextResponse.json(
        {
          ok: false,
          error: 'revision_mismatch',
          library: current,
        },
        { status: 409 }
      )
    }

    const submittedLibrary = body.library as PresetCompatLibrary
    const library = await saveStoredPresetCompatLibrary({
      ...submittedLibrary,
      revision: current.revision,
    })
    return NextResponse.json({ ok: true, library })
  } catch {
    return NextResponse.json({ ok: false, error: 'failed_to_save_preset_compat_library' }, { status: 500 })
  }
}
