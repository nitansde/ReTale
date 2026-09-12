// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceAISettingsModal } from '@/components/workspace/WorkspaceAISettingsModal'
import { createDefaultAISettings } from '@/lib/ai-settings'
import type { AISettings, AIScenarioKey } from '@/lib/types'

vi.mock('@/components/workspace/LocalEmbeddingWizard', () => ({
  LocalEmbeddingWizard: () => null,
}))

const EMPTY_LOADING: Record<AIScenarioKey, boolean> = {
  rewrite: false,
  knowledgeExtraction: false,
  embeddings: false,
}

const EMPTY_ERRORS: Record<AIScenarioKey, string> = {
  rewrite: '',
  knowledgeExtraction: '',
  embeddings: '',
}

describe('WorkspaceAISettingsModal', () => {
  it('keeps focus in place when embedding switches to automatic model selection', () => {
    function Harness() {
      const [settings, setSettings] = React.useState<AISettings>(() => {
        const defaults = createDefaultAISettings()
        return {
          ...defaults,
          embeddings: {
            ...defaults.embeddings,
            ollama: {
              ...defaults.embeddings.ollama,
              model: 'qwen3-embedding:4b',
            },
          },
        }
      })

      return (
        <WorkspaceAISettingsModal
          open
          onClose={() => undefined}
          onSave={() => undefined}
          scenarioStatusLabels={[]}
          resolvedAISettings={settings}
          ollamaModelsByScenario={{
            rewrite: [],
            knowledgeExtraction: [],
            embeddings: [{ id: 'qwen3-embedding:4b', label: 'qwen3-embedding:4b' }],
          }}
          ollamaModelsLoading={EMPTY_LOADING}
          ollamaModelsError={EMPTY_ERRORS}
          openAICompatibleModelsByScenario={{ rewrite: [], knowledgeExtraction: [], embeddings: [] }}
          openAICompatibleModelsLoading={EMPTY_LOADING}
          updateScenarioProvider={() => undefined}
          updateScenarioOpenAIField={() => undefined}
          updateScenarioOllamaField={(scenario, field, value) => {
            if (scenario !== 'embeddings' || field !== 'model') return
            setSettings((current) => ({
              ...current,
              embeddings: {
                ...current.embeddings,
                ollama: { ...current.embeddings.ollama, model: value },
              },
            }))
          }}
          updateKnowledgeExtractionParallelism={() => undefined}
          updateEmbeddingBatchSize={() => undefined}
          applyLocalEmbeddingSettings={() => undefined}
          loadOpenAICompatibleModels={() => undefined}
          loadOllamaModels={() => undefined}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 模型' }))
    const embeddingScenario = screen.getByTestId('ai-settings-scenario-embeddings')
    const modelSelect = within(embeddingScenario).getByRole('combobox')
    modelSelect.focus()

    fireEvent.change(modelSelect, { target: { value: '' } })

    expect(modelSelect).toHaveValue('')
    expect(modelSelect).toHaveFocus()
  })
})
