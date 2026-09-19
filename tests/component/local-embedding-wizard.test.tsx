// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalEmbeddingWizard } from '@/components/workspace/LocalEmbeddingWizard'
import { I18nProvider } from '@/lib/i18n/provider'
import type { LocalEmbeddingRuntimeStatus } from '@/lib/local-embedding'

const baseStatus: LocalEmbeddingRuntimeStatus = {
  ok: true,
  supported: true,
  installed: false,
  configured: false,
  running: false,
  phase: 'not-installed',
  selectedModelId: null,
  backend: 'metal',
  acceleratorLabel: 'Apple Metal',
  platformLabel: 'macOS · ARM64',
  runtimeVersion: 'b10705',
  runtimeDownloadBytes: 11_042_155,
  progress: null,
  error: null,
  models: [{
    id: 'qwen3-embedding-4b-q4_k_m',
    label: 'Qwen3 Embedding 4B · Q4_K_M',
    description: 'Qwen',
    family: 'Qwen3 Embedding 4B',
    profile: 'balanced',
    quantization: 'Q4_K_M',
    license: 'Apache 2.0',
    downloadBytes: 2_496_703_776,
    dimension: 2560,
    contextSize: 2048,
    pooling: 'last',
    normalization: 'l2',
    memoryMinBytes: 3_500_000_000,
    memoryMaxBytes: 6_500_000_000,
    diskEstimateBytes: 2_800_000_000,
    recommended: true,
  }],
  connection: {
    baseUrl: 'http://127.0.0.1:11435/v1',
    apiKey: 'retale-local',
    model: null,
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LocalEmbeddingWizard', () => {
  it('explains the no-RAG tradeoff and requires explicit confirmation before installation', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return Response.json({ ...baseStatus, phase: 'downloading-runtime' }, { status: 202 })
      }
      return Response.json(baseStatus)
    }))

    render(
      <I18nProvider initialLocale="zh" localeCookiePresent>
        <LocalEmbeddingWizard onConfigured={vi.fn()} />
      </I18nProvider>,
    )

    expect(screen.getByText(/写作无法完美贴近原著/)).toBeInTheDocument()
    const openButton = screen.getByRole('button', { name: '安装本地 RAG' })
    await waitFor(() => expect(openButton).toBeEnabled())
    expect(screen.getByText('即将安装的模型')).toBeVisible()
    expect(screen.getByText('qwen3-embedding-4b-q4_k_m', { exact: true })).toBeVisible()
    fireEvent.click(openButton)
    expect(screen.getByText(/只是一套 Embedding 服务/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('combobox')).toHaveValue('qwen3-embedding-4b-q4_k_m')
    expect(screen.getByText(/2.5 GB/)).toBeInTheDocument()
    expect(screen.getByText(/2560 dim/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    const installButton = screen.getByRole('button', { name: '确认并开始安装' })
    expect(installButton).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(installButton).toBeEnabled()
    fireEvent.click(installButton)

    await waitFor(() => expect(requests).toEqual([{
      action: 'install',
      modelId: 'qwen3-embedding-4b-q4_k_m',
    }]))
  })

  it('applies installed settings only while the installation entry is selected', async () => {
    const connection = { ...baseStatus.connection, model: 'qwen3-embedding-4b-q4_k_m' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...baseStatus, installed: true, configured: true, phase: 'stopped', connection,
    })))
    const onConfigured = vi.fn()
    const { rerender } = render(<LocalEmbeddingWizard active={false} onConfigured={onConfigured} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '管理本地 RAG' })).toBeEnabled())
    expect(screen.getByText('已安装的模型')).toBeVisible()
    expect(screen.getByText(connection.model, { exact: true })).toBeVisible()
    expect(onConfigured).not.toHaveBeenCalled()
    rerender(<LocalEmbeddingWizard active onConfigured={onConfigured} />)
    await waitFor(() => expect(onConfigured).toHaveBeenCalledWith(connection))
    expect(onConfigured).toHaveBeenCalledTimes(1)
    rerender(<LocalEmbeddingWizard active={false} onConfigured={onConfigured} />)
    expect(onConfigured).toHaveBeenCalledTimes(1)
    rerender(<LocalEmbeddingWizard active onConfigured={onConfigured} />)
    await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(2))
  })

  it('requires a risk acknowledgement and a second confirmation for custom GGUF models', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return Response.json({ ...baseStatus, phase: 'downloading-runtime' }, { status: 202 })
      }
      return Response.json(baseStatus)
    }))

    render(
      <I18nProvider initialLocale="zh" localeCookiePresent>
        <LocalEmbeddingWizard onConfigured={vi.fn()} />
      </I18nProvider>,
    )

    const openButton = await screen.findByRole('button', { name: '安装本地 RAG' })
    await waitFor(() => expect(openButton).toBeEnabled())
    fireEvent.click(openButton)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__custom-hugging-face-gguf__' } })

    expect(screen.getByText(/不校验 SHA-256/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Qwen/Qwen3-Embedding-4B-GGUF'), {
      target: { value: 'Qwen/Qwen3-Embedding-4B-GGUF' },
    })
    fireEvent.change(screen.getByPlaceholderText('Qwen3-Embedding-4B-Q4_K_M.gguf'), {
      target: { value: 'Qwen3-Embedding-4B-Q4_K_M.gguf' },
    })
    const riskCheckbox = screen.getByRole('checkbox')
    fireEvent.click(riskCheckbox)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    const installButton = screen.getByRole('button', { name: '确认并开始安装' })
    expect(installButton).toBeDisabled()
    expect(screen.getByText(/再次确认/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(installButton)

    await waitFor(() => expect(requests).toEqual([{
      action: 'install-custom',
      repository: 'Qwen/Qwen3-Embedding-4B-GGUF',
      fileName: 'Qwen3-Embedding-4B-Q4_K_M.gguf',
      riskAccepted: true,
      installConfirmed: true,
    }]))
  })
})
