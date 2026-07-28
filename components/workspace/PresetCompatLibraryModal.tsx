"use client"

import { useMemo, useState, type ChangeEvent } from 'react'
import { X } from 'lucide-react'
import { PresetCompatPresetEditor } from '@/components/workspace/PresetCompatPresetEditor'
import { PRESET_COMPAT_EDITABLE_SURFACE_META } from '@/lib/preset-compat/surface-contract'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  type PresetCompatCreativeSurfaceId,
  type PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import { useI18n } from '@/lib/i18n/provider'
import type { PresetCompatSessionWorkspaceSelection } from '@/lib/types'
import {
  toUserFacingPresetCompatError,
  type PresetCompatErrorOperation,
} from '@/lib/workspace-user-facing-errors'
import { useNovelStore } from '@/store/novel-store'
import { cn } from '@/lib/utils'

type PresetCompatLibraryModalProps = {
  activeSurfaceId?: PresetCompatSurfaceId | null
  activeSelection?: PresetCompatSessionWorkspaceSelection | null
  open: boolean
  onClose: () => void
}

const BUILTIN_SURFACE_LABELS: Record<PresetCompatCreativeSurfaceId, string> = {
  rewrite: PRESET_COMPAT_EDITABLE_SURFACE_META.rewrite.label,
  future_jump: PRESET_COMPAT_EDITABLE_SURFACE_META.future_jump.label,
  roleplay: PRESET_COMPAT_EDITABLE_SURFACE_META.roleplay.label,
}

function sanitizeFileStem(name: string) {
  return name.replace(/\.[^.]+$/, '').trim() || 'preset-compat-export'
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

async function readUploadedFileText(file: File) {
  if (typeof file.text === 'function') {
    return file.text()
  }
  return new Response(file).text()
}

export function PresetCompatLibraryModal({ activeSurfaceId = null, activeSelection = null, open, onClose }: PresetCompatLibraryModalProps) {
  const { t, locale } = useI18n()
  const presetCompatLibrary = useNovelStore((state) => state.presetCompatLibrary)
  const presetCompatLibraryLoading = useNovelStore((state) => state.presetCompatLibraryLoading)
  const presetCompatLibraryError = useNovelStore((state) => state.presetCompatLibraryError)
  const savePresetCompatLibrary = useNovelStore((state) => state.savePresetCompatLibrary)
  const importPresetCompatPreset = useNovelStore((state) => state.importPresetCompatPreset)
  const importPresetCompatRegexBundle = useNovelStore((state) => state.importPresetCompatRegexBundle)
  const bindPresetCompatPresetToSurface = useNovelStore((state) => state.bindPresetCompatPresetToSurface)
  const deletePresetCompatPreset = useNovelStore((state) => state.deletePresetCompatPreset)
  const attachPresetCompatStandaloneRegex = useNovelStore((state) => state.attachPresetCompatStandaloneRegex)
  const detachPresetCompatStandaloneRegex = useNovelStore((state) => state.detachPresetCompatStandaloneRegex)
  const updatePresetCompatPromptRule = useNovelStore((state) => state.updatePresetCompatPromptRule)
  const updatePresetCompatBuiltinSystemPrompt = useNovelStore((state) => state.updatePresetCompatBuiltinSystemPrompt)
  const updatePresetCompatEmbeddedRegex = useNovelStore((state) => state.updatePresetCompatEmbeddedRegex)
  const updatePresetCompatRuntimeSampler = useNovelStore((state) => state.updatePresetCompatRuntimeSampler)
  const updatePresetCompatTransport = useNovelStore((state) => state.updatePresetCompatTransport)
  const updatePresetCompatStandaloneRegex = useNovelStore((state) => state.updatePresetCompatStandaloneRegex)
  const exportPresetCompatPreset = useNovelStore((state) => state.exportPresetCompatPreset)
  const exportPresetCompatStandaloneRegexBundle = useNovelStore((state) => state.exportPresetCompatStandaloneRegexBundle)

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [actionError, setActionError] = useState<{
    operation: PresetCompatErrorOperation
    error: unknown
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const resolvedErrorMessage = useMemo(() => {
    if (actionError) {
      return toUserFacingPresetCompatError(actionError.operation, actionError.error, locale)
    }
    return presetCompatLibraryError
      ? toUserFacingPresetCompatError('load', presetCompatLibraryError, locale)
      : ''
  }, [actionError, locale, presetCompatLibraryError])

  const presets = useMemo(
    () => Object.values(presetCompatLibrary.presets).slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [presetCompatLibrary.presets]
  )
  const selectedPreset = selectedPresetId && presetCompatLibrary.presets[selectedPresetId]
    ? presetCompatLibrary.presets[selectedPresetId]
    : presets[0] ?? null
  const resolvedActiveSurfaceId = activeSurfaceId && PRESET_COMPAT_CREATIVE_SURFACE_IDS.includes(activeSurfaceId as PresetCompatCreativeSurfaceId)
    ? activeSurfaceId as PresetCompatCreativeSurfaceId
    : null

  async function importFile(event: ChangeEvent<HTMLInputElement>, kind: 'preset' | 'regex') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setActionError(null)
    setStatusMessage('')

    try {
      const jsonText = await readUploadedFileText(file)
      const result = kind === 'preset'
        ? await importPresetCompatPreset({ jsonText, nameHint: sanitizeFileStem(file.name) })
        : await importPresetCompatRegexBundle({ jsonText, nameHint: sanitizeFileStem(file.name) })

      if (kind === 'preset' && result.importedIds[0]) setSelectedPresetId(result.importedIds[0])

      const importedLabel = result.importedIds.length
        ? t(kind === 'preset' ? 'preset.importedPresets' : 'preset.importedRegexEntries', { count: result.importedIds.length })
        : t(kind === 'preset' ? 'preset.importedNonePresets' : 'preset.importedNoneRegex')
      setStatusMessage(importedLabel)
    } catch (error) {
      setActionError({
        operation: kind === 'preset' ? 'import-preset' : 'import-regex',
        error,
      })
    }
  }

  async function handleSave() {
    setSaving(true)
    setActionError(null)
    setStatusMessage('')
    try {
      await savePresetCompatLibrary()
      setStatusMessage(t('preset.saved'))
    } catch (error) {
      setActionError({ operation: 'save', error })
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePreset() {
    if (!selectedPreset) return

    const presetId = selectedPreset.id
    const presetName = selectedPreset.name
    const nextPresetId = presets.find((preset) => preset.id !== presetId)?.id ?? null
    setActionError(null)
    setStatusMessage('')
    setSaving(true)

    try {
      deletePresetCompatPreset(presetId)
      setSelectedPresetId(nextPresetId)
      await savePresetCompatLibrary()
      setStatusMessage(t('preset.deletedAndSaved', { name: presetName }))
    } catch (error) {
      setActionError({ operation: 'delete-save', error })
    } finally {
      setSaving(false)
    }
  }

  function handleExportPreset() {
    if (!selectedPreset) return
    const jsonText = exportPresetCompatPreset(selectedPreset.id)
    if (!jsonText) {
      setActionError({ operation: 'export-preset', error: null })
      return
    }
    setActionError(null)
    setStatusMessage(t('preset.exportedPreset', { name: selectedPreset.name }))
    downloadTextFile(`${sanitizeFileStem(selectedPreset.name)}.json`, jsonText)
  }

  function handleExportRegexBundle() {
    const jsonText = exportPresetCompatStandaloneRegexBundle()
    setActionError(null)
    setStatusMessage(t('preset.exportedRegexBundle'))
    downloadTextFile('preset-compat-standalone-regexes.json', jsonText)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[65] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute inset-x-0 top-[6vh] mx-auto max-h-[88vh] w-full max-w-7xl overflow-y-auto rounded-[32px] border border-white/10 bg-[#0d1017] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.5)]"
        data-testid="preset-compat-library-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{t('preset.eyebrow')}</p>
            <h3 className="mt-1 text-xl font-semibold text-zinc-100">{t('preset.title')}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t('preset.description')}</p>
          </div>
          <button onClick={onClose} className="rounded-2xl border border-white/10 p-2 text-zinc-300 hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.import')}</p>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">{t('preset.presetJson')}</span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    data-testid="preset-compat-preset-import-input"
                    onChange={(event) => void importFile(event, 'preset')}
                    className="block w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-300 file:mr-4 file:rounded-xl file:border-0 file:bg-violet-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">{t('preset.regexJson')}</span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    data-testid="preset-compat-regex-import-input"
                    onChange={(event) => void importFile(event, 'regex')}
                    className="block w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-300 file:mr-4 file:rounded-xl file:border-0 file:bg-sky-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.libraryState')}</p>
                  <p className="mt-2 text-sm text-zinc-300">{t('preset.librarySummary', { revision: presetCompatLibrary.revision, presets: presets.length, regexes: Object.keys(presetCompatLibrary.standaloneRegexes).length })}</p>
                </div>
                <span className={cn(
                  'rounded-full border px-3 py-1 text-[11px]',
                  presetCompatLibraryLoading || saving
                    ? 'border-violet-400/20 bg-violet-500/10 text-violet-100'
                    : 'border-white/10 bg-black/20 text-zinc-300'
                )}>
                  {presetCompatLibraryLoading || saving ? t('preset.processing') : t('preset.ready')}
                </span>
              </div>

              {statusMessage ? <p className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{statusMessage}</p> : null}
              {resolvedErrorMessage ? <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{resolvedErrorMessage}</p> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || presetCompatLibraryLoading}
                  className="rounded-2xl bg-violet-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-60"
                >
                  {saving ? t('preset.saving') : t('preset.save')}
                </button>
                <button
                  type="button"
                  onClick={handleExportRegexBundle}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/[0.08]"
                >
                  {t('preset.exportRegexBundle')}
                </button>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.list')}</p>
              <div className="mt-4 space-y-2">
                {presets.length ? presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPresetId(preset.id)}
                    className={cn(
                      'w-full rounded-[20px] border px-4 py-3 text-left transition',
                      selectedPreset?.id === preset.id
                        ? 'border-violet-400/30 bg-violet-500/12'
                        : 'border-white/8 bg-[#0b0d12] hover:bg-white/[0.06]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-zinc-100">{preset.name}</p>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{t('preset.ruleCount', { count: preset.promptRules.length })}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">{t('preset.regexSummary', { embedded: preset.embeddedRegexes.length, attached: preset.attachedStandaloneRegexIds.length })}</p>
                  </button>
                )) : (
                  <div className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4 text-sm text-zinc-400">{t('preset.empty')}</div>
                )}
              </div>
            </div>
          </div>

          <div>
            {selectedPreset ? (
              <PresetCompatPresetEditor
                key={`${selectedPreset.id}:${resolvedActiveSurfaceId ?? 'none'}`}
                activeSurfaceId={resolvedActiveSurfaceId}
                activeSelection={activeSelection}
                preset={selectedPreset}
                library={presetCompatLibrary}
                onBindSurface={bindPresetCompatPresetToSurface}
                onUpdateBuiltinSystemPrompt={updatePresetCompatBuiltinSystemPrompt}
                onUpdatePromptRule={(promptRuleId, updates) => updatePresetCompatPromptRule(selectedPreset.id, promptRuleId, updates)}
                onUpdateEmbeddedRegex={(regexId, updates) => updatePresetCompatEmbeddedRegex(selectedPreset.id, regexId, updates)}
                onUpdateRuntimeSampler={(updates) => updatePresetCompatRuntimeSampler(selectedPreset.id, updates)}
                onUpdateTransport={(updates) => updatePresetCompatTransport(selectedPreset.id, updates)}
                onUpdateStandaloneRegex={updatePresetCompatStandaloneRegex}
                onToggleStandaloneRegexAttachment={(regexId) => {
                  if (selectedPreset.attachedStandaloneRegexIds.includes(regexId)) {
                    detachPresetCompatStandaloneRegex(selectedPreset.id, regexId)
                    return
                  }
                  attachPresetCompatStandaloneRegex(selectedPreset.id, regexId)
                }}
                onDeletePreset={handleDeletePreset}
                onExportPreset={handleExportPreset}
              />
            ) : (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-violet-400/16 bg-violet-500/8 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200/80">{t('preset.builtin.systemPrompt')}</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        {t('preset.builtin.description')}
                      </p>
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-[11px] text-violet-100">
                      Applied first
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {PRESET_COMPAT_CREATIVE_SURFACE_IDS.map((surfaceId) => {
                      const rule = presetCompatLibrary.builtinSystemPrompts[surfaceId]
                      const surfaceMeta = PRESET_COMPAT_EDITABLE_SURFACE_META[surfaceId]
                      return (
                        <div key={surfaceId} className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-zinc-100">{BUILTIN_SURFACE_LABELS[surfaceId]}</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">{t('preset.builtin.ownedNoExport')}</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">{surfaceMeta.builtinPromptSummary}</p>
                            </div>
                            <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-300">
                              <input
                                type="checkbox"
                                data-testid={`preset-compat-builtin-system-toggle-${surfaceId}`}
                                checked={rule.enabled}
                                onChange={(event) => updatePresetCompatBuiltinSystemPrompt(surfaceId, { enabled: event.target.checked })}
                                className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                              />
                              {t('preset.enabled')}
                            </label>
                          </div>
                          <label className="mt-3 block">
                            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">System prompt</span>
                            <textarea
                              data-testid={`preset-compat-builtin-system-content-${surfaceId}`}
                              value={rule.content}
                              onChange={(event) => updatePresetCompatBuiltinSystemPrompt(surfaceId, { content: event.target.value })}
                              className="h-40 w-full rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none"
                            />
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-black/20 p-8 text-sm leading-7 text-zinc-400">
                  {t('preset.importFirstDescription')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
