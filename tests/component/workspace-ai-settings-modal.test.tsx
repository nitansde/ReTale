// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function renderModelSettings() {
  const loadModels = vi.fn()
  const updateModel = vi.fn()
  const updateProvider = vi.fn()
  function Harness() {
    const [settings, setSettings] = React.useState(createDefaultAISettings)
    return <WorkspaceAISettingsModal
    open onClose={vi.fn()} onSave={vi.fn()} scenarioStatusLabels={[]}
    resolvedAISettings={settings}
    ollamaModelsByScenario={{ rewrite: [], knowledgeExtraction: [], embeddings: [] }}
    ollamaModelsLoading={EMPTY_LOADING} ollamaModelsError={EMPTY_ERRORS}
    openAICompatibleModelsByScenario={{ rewrite: [{ id: 'deepseek-chat', label: 'DeepSeek' }], knowledgeExtraction: [], embeddings: [] }}
    openAICompatibleModelsLoading={EMPTY_LOADING}
    updateScenarioProvider={(scenario, provider) => {
      updateProvider(scenario, provider)
      setSettings((current) => ({ ...current, [scenario]: { ...current[scenario], provider } }))
    }} updateScenarioOpenAIField={updateModel} updateScenarioOllamaField={vi.fn()}
    updateKnowledgeExtractionParallelism={vi.fn()} updateEmbeddingBatchSize={vi.fn()} applyLocalEmbeddingSettings={vi.fn()}
    loadOpenAICompatibleModels={loadModels} loadOllamaModels={vi.fn()}
    />
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'AI 模型' }))
  return { loadModels, updateModel, updateProvider }
}

afterEach(cleanup)

describe('WorkspaceAISettingsModal', () => {
  it('starts with a compact overview and opens only the chosen model', () => {
    renderModelSettings()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.getAllByText('必选')).toHaveLength(2)
    expect(screen.getByText('可选')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '知识库构建 AI 模型' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('region', { name: '知识库构建 AI 模型' })).toBeVisible()
    expect(screen.getByText('对模型能力要求不高，优先选便宜的小模型（如 gpt-oss-120b 或本地模型）。')).toBeVisible()
    expect(screen.getByRole('spinbutton')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '写作 AI 模型' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '知识库构建 AI 模型' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers local installation alongside connections without changing the provider merely by opening it', () => {
    const { updateProvider } = renderModelSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Embedding 模型' }))
    const connections = screen.getByRole('group', { name: '连接方式' })
    expect(within(connections).getByRole('button', { name: '模型API' })).toBeVisible()
    expect(within(connections).getByRole('button', { name: '本地模型' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(connections).getByRole('button', { name: '本地一键安装' }))
    expect(screen.getByText(/建议运行 ReTale 的设备具备至少 16GB/)).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument()
    expect(updateProvider).not.toHaveBeenCalled()
    expect(within(connections).getByRole('button', { name: '本地模型' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(within(connections).getByRole('button', { name: '本地模型' }))
    expect(updateProvider).toHaveBeenCalledWith('embeddings', 'ollama')
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeVisible()
    expect(screen.getByText(/建议运行 ReTale 的设备具备至少 16GB/)).not.toBeVisible()
  })

  it('uses one editable model field and refreshes suggestions for its connection', () => {
    const { loadModels, updateModel } = renderModelSettings()
    fireEvent.click(screen.getByRole('button', { name: '写作 AI 模型' }))
    const modelInput = screen.getByRole('combobox', { name: 'Model' })
    fireEvent.change(modelInput, { target: { value: 'deepseek-chat' } })
    expect(updateModel).toHaveBeenCalledWith('rewrite', 'model', 'deepseek-chat')
    fireEvent.click(screen.getByRole('button', { name: '刷新模型' }))
    expect(loadModels).toHaveBeenCalledWith('rewrite', 'https://api.openai.com/v1', '')
    expect(document.getElementById(modelInput.getAttribute('list')!)).toHaveTextContent('DeepSeek')
  })

  it('shows API compatibility guidance only for the embedding API connection', () => {
    renderModelSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Embedding 模型' }))
    expect(screen.getByText(/本地推荐 qwen3-embedding-4b-q4_k_m/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '模型API' }))
    expect(screen.getByText(/支持 OpenAI 兼容的 Embeddings API/)).toBeVisible()
    expect(screen.queryByText(/本地推荐 qwen3-embedding-4b-q4_k_m/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('text-embedding-3-small')
    fireEvent.click(screen.getByRole('button', { name: '本地一键安装' }))
    expect(screen.getByText(/本地推荐 qwen3-embedding-4b-q4_k_m/)).toBeVisible()
    expect(screen.queryByText(/支持 OpenAI 兼容的 Embeddings API/)).not.toBeInTheDocument()
  })

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
    fireEvent.click(screen.getByRole('button', { name: 'Embedding 模型' }))
    const embeddingScenario = screen.getByTestId('ai-settings-scenario-embeddings')
    const modelSelect = within(embeddingScenario).getByRole('combobox')
    modelSelect.focus()

    fireEvent.change(modelSelect, { target: { value: '' } })

    expect(modelSelect).toHaveValue('')
    expect(modelSelect).toHaveFocus()
    fireEvent.change(modelSelect, { target: { value: 'custom-embedding' } })
    fireEvent.click(screen.getByRole('button', { name: '写作 AI 模型' }))
    expect(modelSelect).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Embedding 模型' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Embedding 模型' }))
    expect(modelSelect).toHaveValue('custom-embedding')
  })
})
