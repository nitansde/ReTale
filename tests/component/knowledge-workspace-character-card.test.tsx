// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceCharacterReferenceCard } from '@/components/workspace/selection-novel-studio'
import type { Character } from '@/lib/types'

describe('WorkspaceCharacterReferenceCard', () => {
  it('renders canonical content fields, shows tier badges, and expands long cards for full body/evidence text', () => {
    const character: Character = {
      id: 'char-tier-0',
      novelId: 'novel-1',
      name: '林砚',
      role: '主角',
      goal: '查清真相',
      trait: '冷静',
      note: '他总会先把屋里的每一处出口和每个人的站位都记住，再决定自己要把话落在什么地方。',
      aliases: ['阿砚'],
      importanceTier: 'protagonist',
      classificationKey: 'tier0',
      classificationLabel: 'Tier 0',
      profile: {
        identity: { content: '被卷入旧案的书生' },
        capability: { content: '洞察布局' },
        personality: { content: '越危险越冷静' },
        body: {
          content: '肩背清直，站在人群里也像一柄收鞘的刀。',
          evidence: '第六章写他“站在廊下不动，肩线却像绷紧的弓弦，谁都不敢先开口”。',
        },
        speakingStyle: { content: '每句话都压得很稳' },
      },
    }

    render(
      <div className="bg-black">
        <WorkspaceCharacterReferenceCard
          char={character}
          knowledgePanelReadOnly
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </div>
    )

    expect(screen.getAllByText('被卷入旧案的书生').length).toBeGreaterThan(0)
    expect(screen.getAllByText('洞察布局').length).toBeGreaterThan(0)
    expect(screen.getByText('越危险越冷静')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-character-tier-tier0')).toHaveTextContent('Tier 0')

    const expandButton = screen.getByRole('button', { name: '展开详情' })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('肩背清直，站在人群里也像一柄收鞘的刀。')).not.toBeInTheDocument()

    fireEvent.click(expandButton)

    expect(screen.getByRole('button', { name: '收起详情' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('体态')).toBeInTheDocument()
    expect(screen.getByText('肩背清直，站在人群里也像一柄收鞘的刀。')).toBeInTheDocument()
    expect(screen.getByText(/第六章写他/)).toBeInTheDocument()
    expect(screen.getByText(/他总会先把屋里的每一处出口/)).toBeInTheDocument()
  })

  it('renders body facets from content-only profiles even when no expansion is needed', () => {
    const character: Character = {
      id: 'char-tier-1',
      novelId: 'novel-1',
      name: '苏九',
      role: '重要配角',
      goal: '护住城中暗线',
      trait: '果决',
      note: '擅长先手。',
      aliases: ['九姑娘'],
      importanceTier: 'important',
      classificationKey: 'tier1',
      classificationLabel: 'Tier 1',
      profile: {
        identity: { content: '暗线联络人' },
        body: { content: '身形利落，像随时准备转身离场' },
      },
    }

    render(
      <WorkspaceCharacterReferenceCard
        char={character}
        knowledgePanelReadOnly
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getAllByText('暗线联络人').length).toBeGreaterThan(0)
    expect(screen.getByText('体态')).toBeInTheDocument()
    expect(screen.getByText('身形利落，像随时准备转身离场')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展开详情' })).not.toBeInTheDocument()
  })
})
