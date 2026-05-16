"use client"

import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { X } from 'lucide-react'
import { PresetCompatPresetEditor } from '@/components/workspace/PresetCompatPresetEditor'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import type { PresetCompatSessionWorkspaceSelection } from '@/lib/types'
import { useNovelStore } from '@/store/novel-store'
import { cn } from '@/lib/utils'

type PresetCompatLibraryModalProps = {
  activeSurfaceId?: PresetCompatSurfaceId | null
  activeSelection?: PresetCompatSessionWorkspaceSelection | null
  open: boolean
  onClose: () => void
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
  const updatePresetCompatEmbeddedRegex = useNovelStore((state) => state.updatePresetCompatEmbeddedRegex)
  const updatePresetCompatStandaloneRegex = useNovelStore((state) => state.updatePresetCompatStandaloneRegex)
  const exportPresetCompatPreset = useNovelStore((state) => state.exportPresetCompatPreset)
  const exportPresetCompatStandaloneRegexBundle = useNovelStore((state) => state.exportPresetCompatStandaloneRegexBundle)

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)

  const presets = useMemo(
    () => Object.values(presetCompatLibrary.presets).slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [presetCompatLibrary.presets]
  )
  const selectedPreset = selectedPresetId ? presetCompatLibrary.presets[selectedPresetId] ?? null : presets[0] ?? null

  useEffect(() => {
    if (!open) return
    if (selectedPresetId && presetCompatLibrary.presets[selectedPresetId]) return
    setSelectedPresetId(presets[0]?.id ?? null)
  }, [open, presetCompatLibrary.presets, presets, selectedPresetId])

  async function importFile(event: ChangeEvent<HTMLInputElement>, kind: 'preset' | 'regex') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setActionError('')
    setStatusMessage('')

    try {
      const jsonText = await readUploadedFileText(file)
      const result = kind === 'preset'
        ? await importPresetCompatPreset({ jsonText, nameHint: sanitizeFileStem(file.name) })
        : await importPresetCompatRegexBundle({ jsonText, nameHint: sanitizeFileStem(file.name) })

      if (kind === 'preset' && result.importedIds[0]) setSelectedPresetId(result.importedIds[0])

      const importedLabel = result.importedIds.length
        ? `已导入 ${result.importedIds.length} 个${kind === 'preset' ? '预设' : '正则包条目'}。`
        : `没有导入任何${kind === 'preset' ? '预设' : '正则'}条目。`
      const warningLabel = result.warnings.length ? ` 警告：${result.warnings.join(' ')}` : ''
      setStatusMessage(`${importedLabel}${warningLabel}`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `导入${kind === 'preset' ? '预设' : '正则'}失败`)
    }
  }

  async function handleSave() {
    setSaving(true)
    setActionError('')
    setStatusMessage('')
    try {
      await savePresetCompatLibrary()
      setStatusMessage('预设兼容库已保存。')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '保存预设兼容库失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePreset() {
    if (!selectedPreset) return

    const presetId = selectedPreset.id
    const presetName = selectedPreset.name
    const nextPresetId = presets.find((preset) => preset.id !== presetId)?.id ?? null
    setActionError('')
    setStatusMessage('')
    setSaving(true)

    try {
      deletePresetCompatPreset(presetId)
      setSelectedPresetId(nextPresetId)
      await savePresetCompatLibrary()
      setStatusMessage(`已删除预设“${presetName}”，并已保存。`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '删除预设后保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleExportPreset() {
    if (!selectedPreset) return
    const jsonText = exportPresetCompatPreset(selectedPreset.id)
    if (!jsonText) {
      setActionError('导出预设失败：当前选中的预设已不存在。')
      return
    }
    setActionError('')
    setStatusMessage(`已导出 ${selectedPreset.name}。`)
    downloadTextFile(`${sanitizeFileStem(selectedPreset.name)}.json`, jsonText)
  }

  function handleExportRegexBundle() {
    const jsonText = exportPresetCompatStandaloneRegexBundle()
    setActionError('')
    setStatusMessage('已导出独立正则包。')
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
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">预设兼容</p>
            <h3 className="mt-1 text-xl font-semibold text-zinc-100">全局预设兼容库</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">导入预设 JSON，按创作界面绑定预设，编辑提示词规则与正则，再导出兼容 ST 的载荷，同时不混入工作区本地状态。</p>
          </div>
          <button onClick={onClose} className="rounded-2xl border border-white/10 p-2 text-zinc-300 hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">导入</p>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">预设 JSON</span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    data-testid="preset-compat-preset-import-input"
                    onChange={(event) => void importFile(event, 'preset')}
                    className="block w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-300 file:mr-4 file:rounded-xl file:border-0 file:bg-violet-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-300">独立正则 JSON</span>
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
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Library state</p>
                  <p className="mt-2 text-sm text-zinc-300">版本 {presetCompatLibrary.revision} · {presets.length} 个预设 · {Object.keys(presetCompatLibrary.standaloneRegexes).length} 条独立正则</p>
                </div>
                <span className={cn(
                  'rounded-full border px-3 py-1 text-[11px]',
                  presetCompatLibraryLoading || saving
                    ? 'border-violet-400/20 bg-violet-500/10 text-violet-100'
                    : 'border-white/10 bg-black/20 text-zinc-300'
                )}>
                  {presetCompatLibraryLoading || saving ? '处理中' : '就绪'}
                </span>
              </div>

              {statusMessage ? <p className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{statusMessage}</p> : null}
              {actionError || presetCompatLibraryError ? <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{actionError || presetCompatLibraryError}</p> : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || presetCompatLibraryLoading}
                  className="rounded-2xl bg-violet-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-60"
                >
                  {saving ? '保存中…' : '保存兼容库'}
                </button>
                <button
                  type="button"
                  onClick={handleExportRegexBundle}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-100 transition hover:bg-white/[0.08]"
                >
                  导出正则包
                </button>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">预设列表</p>
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
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-400">{preset.promptRules.length} 条规则</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">{preset.embeddedRegexes.length} 条内嵌正则 · {preset.attachedStandaloneRegexIds.length} 条已附加独立正则</p>
                  </button>
                )) : (
                  <div className="rounded-[20px] border border-white/8 bg-[#0b0d12] p-4 text-sm text-zinc-400">导入一个预设文件后，这里才会显示全局兼容库内容。</div>
                )}
              </div>
            </div>
          </div>

          <div>
            {selectedPreset ? (
              <PresetCompatPresetEditor
                activeSurfaceId={activeSurfaceId}
                activeSelection={activeSelection}
                preset={selectedPreset}
                library={presetCompatLibrary}
                onBindSurface={bindPresetCompatPresetToSurface}
                onUpdatePromptRule={(promptRuleId, updates) => updatePresetCompatPromptRule(selectedPreset.id, promptRuleId, updates)}
                onUpdateEmbeddedRegex={(regexId, updates) => updatePresetCompatEmbeddedRegex(selectedPreset.id, regexId, updates)}
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
              <div className="rounded-[24px] border border-white/8 bg-black/20 p-8 text-sm leading-7 text-zinc-400">
                先导入一个预设，这里才会显示界面绑定、提示词规则编辑、正则开关、独立正则附加与导出操作。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
