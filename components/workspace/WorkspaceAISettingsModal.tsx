"use client"

import { useState } from 'react'
import {
  AI_SCENARIO_META,
  getAIScenarioMeta,
  type OllamaModelOption,
  type OpenAICompatibleModelOption,
} from '@/components/workspace/selection-novel-studio-helpers'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { AIProvider, AISettings, AIScenarioKey } from '@/lib/types'

type WorkspaceAISettingsModalProps = {
  open: boolean
  onClose: () => void
  onSave: () => Promise<void> | void
  scenarioStatusLabels: string[]
  resolvedAISettings: AISettings
  ollamaModelsByScenario: Record<AIScenarioKey, OllamaModelOption[]>
  ollamaModelsLoading: Record<AIScenarioKey, boolean>
  ollamaModelsError: Record<AIScenarioKey, string>
  openAICompatibleModelsByScenario: Record<AIScenarioKey, OpenAICompatibleModelOption[]>
  openAICompatibleModelsLoading: Record<AIScenarioKey, boolean>
  updateScenarioProvider: (scenario: AIScenarioKey, provider: AIProvider) => void
  updateScenarioOpenAIField: (scenario: AIScenarioKey, field: 'baseUrl' | 'apiKey' | 'model', value: string) => void
  updateScenarioOllamaField: (scenario: AIScenarioKey, field: 'baseUrl' | 'model', value: string) => void
  updateKnowledgeExtractionParallelism: (provider: AIProvider, value: string) => void
  updateEmbeddingBatchSize: (value: string) => void
  loadOpenAICompatibleModels: (scenario: AIScenarioKey, baseUrl?: string, apiKey?: string) => void
  loadOllamaModels: (scenario: AIScenarioKey, baseUrl?: string) => void
}

export function WorkspaceAISettingsModal(props: WorkspaceAISettingsModalProps) {
  const { locale, t } = useI18n()
  const metaByScenario = getAIScenarioMeta(locale)
  const [saving, setSaving] = useState(false)

  if (!props.open) return null

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await props.onSave()
    } catch {
      // The workspace owns the user-facing error notice and keeps this dialog open.
    } finally {
      setSaving(false)
    }
  }

  const renderOpenAICompatibleFields = (scenario: AIScenarioKey) => {
    const scenarioSettings = props.resolvedAISettings[scenario]
    const knowledgeExtractionSettings = scenario === 'knowledgeExtraction' ? props.resolvedAISettings.knowledgeExtraction : null
    const currentModels = props.openAICompatibleModelsByScenario[scenario]
    const loading = props.openAICompatibleModelsLoading[scenario]
    const selectedModel = currentModels.some((model) => model.id === scenarioSettings.openAICompatible.model)
      ? scenarioSettings.openAICompatible.model
      : ''

    return (
      <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">OpenAI-compatible API</p>
            <p className="mt-1 text-sm text-zinc-300">{t('aiSettings.scenarioConfigDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              props.loadOpenAICompatibleModels(
                scenario,
                scenarioSettings.openAICompatible.baseUrl,
                scenarioSettings.openAICompatible.apiKey
              )
            }}
            className="shrink-0 rounded-2xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06]"
          >
              {loading ? t('aiSettings.refreshing') : t('aiSettings.refreshModels')}
            </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Base URL</span>
            <input
              value={scenarioSettings.openAICompatible.baseUrl}
              onChange={(event) => props.updateScenarioOpenAIField(scenario, 'baseUrl', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder="https://api.openai.com/v1"
            />
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {t('aiSettings.baseUrlHint')}
            </p>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">API Key</span>
            <input
              value={scenarioSettings.openAICompatible.apiKey}
              onChange={(event) => props.updateScenarioOpenAIField(scenario, 'apiKey', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder={scenarioSettings.openAICompatible.apiKeyMasked || 'sk-...'}
            />
            {scenarioSettings.openAICompatible.apiKeyConfigured && !scenarioSettings.openAICompatible.apiKey ? (
              <p className="mt-2 text-xs leading-5 text-zinc-500">{t('aiSettings.apiKeyHint')}</p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Model</span>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs leading-5 text-zinc-500">
                {loading
                  ? t('aiSettings.loadingModels')
                  : currentModels.length > 0
                    ? t('aiSettings.modelsFound', { count: currentModels.length })
                    : t('aiSettings.modelsManual')}
              </p>
            </div>
            <select
              value={selectedModel}
              onChange={(event) => props.updateScenarioOpenAIField(scenario, 'model', event.target.value)}
              disabled={loading || currentModels.length === 0}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {loading
                  ? t('aiSettings.loadingModels')
                  : currentModels.length > 0
                    ? t('aiSettings.selectDiscoveredModel')
                    : t('aiSettings.noDiscoveredModels')}
              </option>
              {currentModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{t('aiSettings.applyModelHint')}</p>
            <input
              value={scenarioSettings.openAICompatible.model}
              onChange={(event) => props.updateScenarioOpenAIField(scenario, 'model', event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder={metaByScenario[scenario].openAIPlaceholder}
            />
          </label>

          {!loading && scenarioSettings.openAICompatible.baseUrl.trim() && currentModels.length === 0 ? (
            <p className="text-sm text-zinc-500">{t('aiSettings.noOpenAIModels')}</p>
          ) : null}

          {scenario === 'knowledgeExtraction' ? (
            <label className="block">
              <span className="mb-2 block text-sm text-zinc-300">{t('aiSettings.parallelism')}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={knowledgeExtractionSettings?.openAICompatible.parallelism ?? 5}
                onChange={(event) => props.updateKnowledgeExtractionParallelism('openai-compatible', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              />
              <p className="mt-2 text-xs leading-5 text-zinc-500">{t('aiSettings.openAiParallelismHint')}</p>
            </label>
          ) : null}
        </div>
      </div>
    )
  }

  const renderOllamaFields = (scenario: AIScenarioKey) => {
    const scenarioSettings = props.resolvedAISettings[scenario]
    const knowledgeExtractionSettings = scenario === 'knowledgeExtraction' ? props.resolvedAISettings.knowledgeExtraction : null
    const currentModels = props.ollamaModelsByScenario[scenario]
    const loading = props.ollamaModelsLoading[scenario]
    const error = props.ollamaModelsError[scenario]
    const purpose = metaByScenario[scenario].ollamaPurpose

    return (
      <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('aiSettings.ollamaEyebrow')}</p>
            <p className="mt-1 text-sm text-zinc-300">
              {purpose === 'embedding'
                ? t('aiSettings.ollamaEmbeddingPurpose')
                : t('aiSettings.ollamaTextPurpose')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              props.loadOllamaModels(scenario, scenarioSettings.ollama.baseUrl)
            }}
            className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/[0.06]"
          >
            {loading ? t('aiSettings.refreshing') : t('aiSettings.refreshLocalModels')}
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Ollama Base URL</span>
            <input
              value={scenarioSettings.ollama.baseUrl}
              onChange={(event) => props.updateScenarioOllamaField(scenario, 'baseUrl', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder="http://127.0.0.1:11434"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">Model</span>
            <select
              value={scenarioSettings.ollama.model}
              onChange={(event) => props.updateScenarioOllamaField(scenario, 'model', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
            >
              <option value="">
                {purpose === 'embedding' ? t('aiSettings.autoSelectEmbedding') : t('aiSettings.autoSelectText')}
              </option>
              {currentModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <input
              value={scenarioSettings.ollama.model}
              onChange={(event) => props.updateScenarioOllamaField(scenario, 'model', event.target.value)}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder={metaByScenario[scenario].ollamaPlaceholder}
            />
          </label>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!error && !loading && currentModels.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {purpose === 'embedding'
                ? t('aiSettings.noLocalEmbedding')
                : t('aiSettings.noLocalText')}
            </p>
          ) : null}

          {scenario === 'knowledgeExtraction' ? (
            <label className="block">
              <span className="mb-2 block text-sm text-zinc-300">{t('aiSettings.parallelism')}</span>
              <input
                type="number"
                min={1}
                max={20}
                value={knowledgeExtractionSettings?.ollama.parallelism ?? 1}
                onChange={(event) => props.updateKnowledgeExtractionParallelism('ollama', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
              />
              <p className="mt-2 text-xs leading-5 text-zinc-500">{t('aiSettings.ollamaParallelismHint')}</p>
            </label>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <DialogSurface
      open={props.open}
      onClose={props.onClose}
      closeLabel={t('common.close')}
      closeDisabled={saving}
      busy={saving}
      title={t('aiSettings.title')}
      description={t('aiSettings.description')}
      className="max-w-2xl"
    >
        <div className="space-y-6">
          {(Object.keys(AI_SCENARIO_META) as AIScenarioKey[]).map((scenario) => {
            const meta = metaByScenario[scenario]
            const scenarioSettings = props.resolvedAISettings[scenario]
            const scenarioStatus = props.scenarioStatusLabels.find((label) => label.startsWith(meta.shortLabel)) ?? ''

            return (
              <div key={scenario} className="rounded-[24px] border border-white/10 bg-[#0b0d12] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-2xl">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{meta.eyebrow}</p>
                    <h4 className="mt-2 text-sm font-medium text-zinc-100">{meta.title}</h4>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{meta.description}</p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                    {scenarioStatus}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {([
                    ['openai-compatible', 'OpenAI-compatible API'],
                    ['ollama', 'Ollama'],
                  ] as Array<[AIProvider, string]>).map(([provider, label]) => {
                    const active = scenarioSettings.provider === provider
                    return (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => props.updateScenarioProvider(scenario, provider)}
                        className={cn(
                          'rounded-full border px-3 py-2 text-xs transition',
                          active
                            ? 'border-violet-300/30 bg-violet-500/15 text-violet-100'
                            : 'border-white/10 bg-black/20 text-zinc-300 hover:bg-white/[0.06]'
                        )}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

                {scenarioSettings.provider === 'openai-compatible'
                  ? renderOpenAICompatibleFields(scenario)
                  : renderOllamaFields(scenario)}

                {scenario === 'embeddings' ? (
                  <div className="mt-4 rounded-[22px] border border-white/8 bg-black/20 p-4">
                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-300">{t('aiSettings.embeddingBatchSize')}</span>
                      <input
                        type="number"
                        min={1}
                        max={128}
                        value={props.resolvedAISettings.embeddings.embeddingBatchSize}
                        onChange={(event) => props.updateEmbeddingBatchSize(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-[#0b0d12] px-4 py-3 text-sm text-zinc-100 outline-none"
                      />
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{t('aiSettings.embeddingBatchHint')}</p>
                    </label>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="hidden text-sm text-zinc-500 sm:block">{t('aiSettings.currentStatus')} {props.scenarioStatusLabels.join(' / ')}</p>
          <div className="flex gap-2">
            <button onClick={props.onClose} disabled={saving} className="min-h-11 rounded-2xl border border-white/10 px-4 text-sm text-zinc-300 hover:bg-white/[0.06] disabled:opacity-50">{t('workspace.shell.cancel')}</button>
            <button onClick={() => void handleSave()} disabled={saving} className="min-h-11 rounded-2xl bg-violet-500 px-4 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-60">{saving ? t('aiSettings.saving') : t('aiSettings.saveSettings')}</button>
          </div>
        </div>
    </DialogSurface>
  )
}
