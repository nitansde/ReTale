import { getMessage, type Locale, type TranslationKey } from '@/lib/i18n/messages'

const ERROR_MESSAGE_KEYS: Record<string, TranslationKey> = {
  preset_not_found: 'errors.preset_not_found',
  standalone_regex_not_found: 'errors.standalone_regex_not_found',
  builtin_system_prompt_not_found: 'errors.builtin_system_prompt_not_found',
  load_failed: 'errors.load_failed',
  revision_mismatch: 'errors.revision_mismatch',
  invalid_import_kind: 'errors.invalid_import_kind',
  'Failed to load preset compat library': 'errors.failedLoadPresetCompatLibrary',
  'Failed to save preset compat library': 'errors.failedSavePresetCompatLibrary',
  'Refusing to overwrite a recoverable workspace with an empty payload': 'errors.refuseOverwriteWorkspace',
  'Workspace restore timed out': 'errors.workspaceRestoreTimedOut',
  'Failed to restore workspace': 'errors.failedRestoreWorkspace',
  'Workspace endpoint returned invalid JSON': 'errors.workspaceInvalidJson',
  'Failed to load AI settings': 'errors.failedLoadAISettings',
  'Failed to save AI settings': 'errors.failedSaveAISettings',
  'Continue block load failed': 'errors.continueBlockLoadFailed',
  'Roleplay session load failed': 'errors.roleplaySessionLoadFailed',
  'Roleplay message append failed': 'errors.roleplayMessageAppendFailed',
  'Roleplay variant creation failed': 'errors.roleplayVariantCreationFailed',
  'Roleplay streaming request failed': 'errors.roleplayStreamingRequestFailed',
  'Roleplay streaming response body is empty': 'errors.roleplayStreamingResponseEmpty',
  'What-if session load failed': 'errors.whatIfSessionLoadFailed',
  'Future jump run load failed': 'errors.futureJumpRunLoadFailed',
  'Future jump revise failed': 'errors.futureJumpReviseFailed',
}

function trimMessage(message: string) {
  return message.trim()
}

export function toUserFacingError(message: string, locale: Locale = 'zh') {
  const normalizedMessage = trimMessage(message)
  const key = ERROR_MESSAGE_KEYS[normalizedMessage]
  return key ? getMessage(locale, key) : normalizedMessage
}

export function toUserFacingPresetCompatError(message: string, locale: Locale = 'zh') {
  return toUserFacingError(message, locale)
}

export function toUserFacingWorkspaceError(message: string, locale: Locale = 'zh') {
  return toUserFacingError(message, locale)
}
