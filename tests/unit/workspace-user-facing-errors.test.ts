import { describe, expect, it } from 'vitest'
import { getMessage, type Locale, type TranslationKey } from '@/lib/i18n/messages'
import {
  resolveWorkspaceUserFacingError,
  toUserFacingPresetCompatError,
  toUserFacingWorkspaceError,
  type WorkspaceErrorOperation,
} from '@/lib/workspace-user-facing-errors'

const locales: Locale[] = ['zh', 'en']

const approvedMappings = [
  ['preset_not_found', 'errors.preset_not_found'],
  ['standalone_regex_not_found', 'errors.standalone_regex_not_found'],
  ['builtin_system_prompt_not_found', 'errors.builtin_system_prompt_not_found'],
  ['load_failed', 'errors.load_failed'],
  ['revision_mismatch', 'errors.revision_mismatch'],
  ['invalid_import_kind', 'errors.invalid_import_kind'],
  ['Failed to load preset compat library', 'errors.failedLoadPresetCompatLibrary'],
  ['Failed to save preset compat library', 'errors.failedSavePresetCompatLibrary'],
  ['Refusing to overwrite a recoverable workspace with an empty payload', 'errors.refuseOverwriteWorkspace'],
  ['Workspace restore timed out', 'errors.workspaceRestoreTimedOut'],
  ['Failed to restore workspace', 'errors.failedRestoreWorkspace'],
  ['Workspace endpoint returned invalid JSON', 'errors.workspaceInvalidJson'],
  ['Failed to load AI settings', 'errors.failedLoadAISettings'],
  ['Failed to save AI settings', 'errors.failedSaveAISettings'],
  ['Continue block load failed', 'errors.continueBlockLoadFailed'],
  ['Roleplay session load failed', 'errors.roleplaySessionLoadFailed'],
  ['Roleplay message append failed', 'errors.roleplayMessageAppendFailed'],
  ['Roleplay variant creation failed', 'errors.roleplayVariantCreationFailed'],
  ['Roleplay streaming request failed', 'errors.roleplayStreamingRequestFailed'],
  ['Roleplay streaming response body is empty', 'errors.roleplayStreamingResponseEmpty'],
  ['What-if session load failed', 'errors.whatIfSessionLoadFailed'],
  ['Future jump run load failed', 'errors.futureJumpRunLoadFailed'],
  ['Future jump revise failed', 'errors.futureJumpReviseFailed'],
] satisfies ReadonlyArray<readonly [string, TranslationKey]>

const unknownDiagnostics: unknown[] = [
  new Error('DatabaseError: no such table\n    at loadWorkspace (/srv/app/workspace.ts:42:9)'),
  'SELECT * FROM workspaces WHERE path = "/Users/example/private.db"',
  '/Users/example/secret/workspace.json',
  '<html><body>502 Bad Gateway</body></html>',
  '{"error":"provider rejected the request","apiKey":"secret"}',
  'Temporary upstream failure',
  '',
  '   ',
  { error: 'nested raw diagnostic' },
  503,
  null,
  undefined,
]

describe('workspace user-facing errors', () => {
  it.each(locales)('uses the operation fallback for unknown diagnostics in %s', (locale) => {
    const operation: WorkspaceErrorOperation = 'chapter-graph-load'
    const fallback = getMessage(locale, 'workspace.chapterGraph.loadFailed')

    for (const diagnostic of unknownDiagnostics) {
      expect(resolveWorkspaceUserFacingError(operation, diagnostic, locale)).toBe(fallback)
    }
  })

  it.each(locales)('preserves approved exact mappings for Error and string values in %s', (locale) => {
    const expected = getMessage(locale, 'errors.workspaceRestoreTimedOut')

    expect(resolveWorkspaceUserFacingError('chapter-graph-load', new Error(' Workspace restore timed out '), locale)).toBe(expected)
    expect(resolveWorkspaceUserFacingError('chapter-graph-load', ' Workspace restore timed out ', locale)).toBe(expected)
  })

  it.each(locales)('preserves every approved exact-message mapping in %s', (locale) => {
    for (const [message, key] of approvedMappings) {
      expect(resolveWorkspaceUserFacingError('workspace-restore', message, locale)).toBe(getMessage(locale, key))
    }
  })

  it.each(locales)('sanitizes unknown values through the legacy workspace helper in %s', (locale) => {
    expect(toUserFacingWorkspaceError(new Error('private stack trace'), locale)).toBe(
      getMessage(locale, 'errors.failedRestoreWorkspace')
    )
  })

  it.each(locales)('uses operation-specific preset compatibility fallbacks for unknown diagnostics in %s', (locale) => {
    expect(toUserFacingPresetCompatError('load', 'preset provider detail', locale)).toBe(
      getMessage(locale, 'errors.failedLoadPresetCompatLibrary')
    )
    expect(toUserFacingPresetCompatError('save', new Error('/private/preset-library.json'), locale)).toBe(
      getMessage(locale, 'errors.failedSavePresetCompatLibrary')
    )
    expect(toUserFacingPresetCompatError('import-preset', { error: 'raw diagnostic' }, locale)).toBe(
      getMessage(locale, 'preset.importPresetFailed')
    )
    expect(toUserFacingPresetCompatError('import-regex', 503, locale)).toBe(
      getMessage(locale, 'preset.importRegexFailed')
    )
    expect(toUserFacingPresetCompatError('delete-save', null, locale)).toBe(
      getMessage(locale, 'preset.deleteAfterSaveFailed')
    )
  })
  
  it.each(locales)('preserves approved exact preset compatibility mappings in %s', (locale) => {
    expect(toUserFacingPresetCompatError('save', 'revision_mismatch', locale)).toBe(
      getMessage(locale, 'errors.revision_mismatch')
    )
    expect(toUserFacingPresetCompatError('import-preset', 'invalid_import_kind', locale)).toBe(
      getMessage(locale, 'errors.invalid_import_kind')
    )
  })
})
