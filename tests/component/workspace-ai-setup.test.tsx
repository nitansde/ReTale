// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRewriteGuide } from '@/components/workspace/WorkspaceRewriteGuide'
import { WorkspaceAISetupPrompt } from '@/components/workspace/WorkspaceAISetupPrompt'
import { WorkspaceAISettingsModal } from '@/components/workspace/WorkspaceAISettingsModal'
import { createDefaultAISettings, isAIScenarioConfigured, sanitizeAISettingsForClient } from '@/lib/ai-settings'

vi.mock('@/components/workspace/LocalEmbeddingWizard', () => ({ LocalEmbeddingWizard: () => null }))
afterEach(cleanup)

describe('AI model setup guidance', () => {
  it('recognizes saved masked credentials without requiring the secret in the browser', () => {
    const settings = createDefaultAISettings()
    expect(isAIScenarioConfigured(settings.rewrite)).toBe(false)
    settings.rewrite.openAICompatible.apiKey = 'test-only-key'
    const clientSettings = sanitizeAISettingsForClient(settings)
    expect(clientSettings.rewrite.openAICompatible.apiKey).toBe('')
    expect(isAIScenarioConfigured(clientSettings.rewrite)).toBe(true)
    clientSettings.rewrite.openAICompatible.model = ' '
    expect(isAIScenarioConfigured(clientSettings.rewrite)).toBe(false)
  })

  it('uses the active provider and accepts a configured Ollama model without an API key', () => {
    const settings = createDefaultAISettings()
    settings.rewrite.ollama = { baseUrl: 'http://localhost:11434', model: 'local-model', configured: true }
    expect(isAIScenarioConfigured(settings.rewrite)).toBe(false)
    settings.rewrite.provider = 'ollama'
    expect(isAIScenarioConfigured(settings.rewrite)).toBe(true)
    settings.rewrite.ollama.configured = false
    expect(isAIScenarioConfigured(settings.rewrite)).toBe(false)
  })

  it('routes an unconfigured rewrite click to settings instead of the text-selection tutorial', () => {
    const onOpenSettings = vi.fn()
    render(<WorkspaceRewriteGuide modelConfigured={false} provider="openai-compatible" onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('button', { name: '魔改' }))
    const dialog = screen.getByRole('dialog', { name: '先配置 AI 模型' })
    expect(within(dialog).getByText(/请先填写 API Key/)).toBeVisible()
    expect(within(dialog).queryByText('选区示意')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '去设置' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gives local model instructions when Ollama is selected', () => {
    render(<WorkspaceRewriteGuide modelConfigured={false} provider="ollama" onOpenSettings={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '魔改' }))
    expect(screen.getByText(/确认 Ollama 服务地址/)).toBeVisible()
    expect(screen.queryByText(/请先填写 API Key/)).not.toBeInTheDocument()
  })

  it('restores selection instructions after configuration becomes available', () => {
    const onOpenSettings = vi.fn()
    const { rerender } = render(<WorkspaceRewriteGuide modelConfigured={false} provider="openai-compatible" onOpenSettings={onOpenSettings} />)
    rerender(<WorkspaceRewriteGuide modelConfigured provider="openai-compatible" onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('button', { name: '魔改' }))
    expect(screen.getByRole('dialog', { name: '从一段文字开始魔改' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '去选一段' }))
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  it('lets an unconfigured selection open settings or be cleared', () => {
    const onOpenSettings = vi.fn()
    const onClearSelection = vi.fn()
    render(<WorkspaceAISetupPrompt onOpenSettings={onOpenSettings} onClearSelection={onClearSelection} />)
    expect(screen.getByRole('status')).toHaveTextContent('先配置 AI 模型')
    fireEvent.click(screen.getByRole('button', { name: '去设置' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    expect(onClearSelection).toHaveBeenCalledOnce()
  })

  it('opens model configuration directly with the rewrite API key field reachable', () => {
    render(<WorkspaceAISettingsModal
      open initialSection="models" onClose={vi.fn()} onSave={vi.fn()}
      scenarioStatusLabels={[]} resolvedAISettings={createDefaultAISettings()}
      ollamaModelsByScenario={{ rewrite: [], knowledgeExtraction: [], embeddings: [] }}
      ollamaModelsLoading={{ rewrite: false, knowledgeExtraction: false, embeddings: false }}
      ollamaModelsError={{ rewrite: '', knowledgeExtraction: '', embeddings: '' }}
      openAICompatibleModelsByScenario={{ rewrite: [], knowledgeExtraction: [], embeddings: [] }}
      openAICompatibleModelsLoading={{ rewrite: false, knowledgeExtraction: false, embeddings: false }}
      updateScenarioProvider={vi.fn()} updateScenarioOpenAIField={vi.fn()} updateScenarioOllamaField={vi.fn()}
      updateKnowledgeExtractionParallelism={vi.fn()} updateEmbeddingBatchSize={vi.fn()} applyLocalEmbeddingSettings={vi.fn()}
      loadOpenAICompatibleModels={vi.fn()} loadOllamaModels={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: 'AI 模型' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByTestId('ai-settings-scenario-rewrite')).getByLabelText('API Key')).toBeVisible()
    expect(screen.getByRole('button', { name: '保存设置' })).toBeVisible()
  })
})
