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

const WORKSPACE_OPERATION_MESSAGE_KEYS = {
  'workspace-restore': 'errors.failedRestoreWorkspace',
  'story-timeline-load': 'workspace.storyTimeline.loadFailed',
  'chapter-graph-load': 'workspace.chapterGraph.loadFailed',
  'context-preview': 'workspace.action.contextPreviewFailed',
  'graph-assembly': 'workspace.action.graphAssemblyFailed',
  'graph-relation-update': 'workspace.action.graphRelationUpdateFailed',
  'ollama-model-load': 'workspace.action.loadLocalOllamaModelsFailed',
  'roleplay-session-create': 'workspace.actionError.createRoleplaySessionFailed',
  'roleplay-session-load': 'errors.roleplaySessionLoadFailed',
  'roleplay-send': 'errors.roleplayMessageAppendFailed',
  'roleplay-regenerate': 'errors.roleplayVariantCreationFailed',
  'roleplay-stream': 'errors.roleplayStreamingRequestFailed',
  'timeline-node-delete': 'workspace.actionError.deleteTimelineNodeFailed',
  'knowledge-rebuild': 'workspace.action.knowledgeFailed',
  'retrieval-index-rebuild': 'workspace.action.retrievalStartFailed',
  'knowledge-pause': 'workspace.action.pauseKnowledgeFailed',
  'knowledge-abort': 'workspace.action.abortKnowledgeFailed',
  'knowledge-graph-delete': 'workspace.action.deleteKnowledgeGraphFailed',
  'hanlp-cache-delete': 'workspace.action.deleteHanlpCacheFailed',
  'extraction-cache-delete': 'workspace.action.deleteExtractionCacheFailed',
  'embedding-cache-delete': 'workspace.action.deleteEmbeddingCacheFailed',
  'rewrite-create': 'workspace.actionError.createRecoverableRewriteJobFailed',
  'rewrite-abort': 'workspace.actionError.abortGenerationFailed',
  'rewrite-restore': 'workspace.action.restoreRecoverableRewriteJobFailed',
  'rewrite-refresh': 'workspace.action.refreshRecoverableRewriteJobFailed',
  'rewrite-job-failed': 'workspace.action.rewriteFailed',
  'continue-block-load': 'errors.continueBlockLoadFailed',
  'continue-block-save': 'workspace.actionError.saveContinueBlockFailed',
  'what-if-session-load': 'errors.whatIfSessionLoadFailed',
  'what-if-create': 'workspace.actionError.createWhatIfFailed',
  'future-map-load': 'errors.futureMapLoadFailed',
  'future-jump-create': 'errors.futureJumpCreateFailed',
  'future-jump-load': 'errors.futureJumpRunLoadFailed',
  'future-jump-revise': 'errors.futureJumpReviseFailed',
} satisfies Record<string, TranslationKey>

export type WorkspaceErrorOperation = keyof typeof WORKSPACE_OPERATION_MESSAGE_KEYS

function trimMessage(message: string) {
  return message.trim()
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return trimMessage(error.message)
  }

  return typeof error === 'string' ? trimMessage(error) : ''
}

export function toUserFacingError(message: string, locale: Locale = 'zh') {
  const normalizedMessage = trimMessage(message)
  const key = ERROR_MESSAGE_KEYS[normalizedMessage]
  return key ? getMessage(locale, key) : normalizedMessage
}

const PRESET_COMPAT_OPERATION_MESSAGE_KEYS = {
  load: 'errors.failedLoadPresetCompatLibrary',
  save: 'errors.failedSavePresetCompatLibrary',
  'import-preset': 'preset.importPresetFailed',
  'import-regex': 'preset.importRegexFailed',
  'delete-save': 'preset.deleteAfterSaveFailed',
  'export-preset': 'preset.exportMissingSelected',
} satisfies Record<string, TranslationKey>

export type PresetCompatErrorOperation = keyof typeof PRESET_COMPAT_OPERATION_MESSAGE_KEYS

export function toUserFacingPresetCompatError(
  operation: PresetCompatErrorOperation,
  error: unknown,
  locale: Locale = 'zh'
) {
  const key = ERROR_MESSAGE_KEYS[extractErrorMessage(error)] ?? PRESET_COMPAT_OPERATION_MESSAGE_KEYS[operation]
  return getMessage(locale, key)
}

export function resolveWorkspaceUserFacingError(
  operation: WorkspaceErrorOperation,
  error: unknown,
  locale: Locale = 'zh'
) {
  const key = ERROR_MESSAGE_KEYS[extractErrorMessage(error)] ?? WORKSPACE_OPERATION_MESSAGE_KEYS[operation]
  return getMessage(locale, key)
}

export function toUserFacingWorkspaceError(error: unknown, locale: Locale = 'zh') {
  return resolveWorkspaceUserFacingError('workspace-restore', error, locale)
}
