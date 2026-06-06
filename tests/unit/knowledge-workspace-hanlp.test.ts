import { describe, expect, it } from 'vitest'
import {
  buildCharacterProfileSections,
  characterCardNeedsExpansion,
  groupWorldEntriesForWorkspaceRail,
  getCharacterFacetContent,
  getCharacterClassificationBadgeLabel,
  filterWorkspaceVisibleCharacters,
  resolveCacheDeleteState,
  resolveRetrievalTaskControlsState,
  hasCharacterProfile,
  isWorkspaceCharacterVisible,
  normalizeKnowledgeRebuildChapterRangeInput,
  resolveHanlpCacheDeleteState,
  resolveKnowledgeRebuildFailureMessage,
  sortCharactersForWorkspaceRail,
} from '@/components/workspace/selection-novel-studio'
import { resolveWorkspaceRefTab } from '@/components/workspace/use-workspace-pane-state'
import type { Character, WorldEntry } from '@/lib/types'

describe('knowledge workspace HanLP helpers', () => {
  it('maps projected character tiers to visible workspace labels', () => {
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'tier0', classificationLabel: 'Tier 0', importanceTier: 'protagonist' })).toBe('Tier 0')
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'tier1', classificationLabel: 'Tier 1', importanceTier: 'important' })).toBe('Tier 1')
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'tier2', classificationLabel: 'Tier 2', importanceTier: 'arc' })).toBe('Tier 2')
    expect(getCharacterClassificationBadgeLabel({ classificationKey: 'candidate', classificationLabel: null, importanceTier: 'candidate' })).toBe('Candidate')
  })

  it('sorts workspace rail characters by importance tier first and then by name', () => {
    const characters: Character[] = [
      {
        id: 'unknown-b',
        novelId: 'novel-1',
        name: '赵乙',
        role: '未知',
        goal: '',
        trait: '',
        note: '',
        aliases: [],
        importanceTier: null,
      },
      {
        id: 'candidate-a',
        novelId: 'novel-1',
        name: '白川',
        role: '候选',
        goal: '',
        trait: '',
        note: '',
        aliases: [],
        importanceTier: 'candidate',
      },
      {
        id: 'tier1-b',
        novelId: 'novel-1',
        name: '苏九',
        role: '重要配角',
        goal: '',
        trait: '',
        note: '',
        aliases: [],
        importanceTier: 'important',
      },
      {
        id: 'ignored-a',
        novelId: 'novel-1',
        name: '阿木',
        role: '忽略',
        goal: '',
        trait: '',
        note: '',
        aliases: [],
        importanceTier: 'ignored',
      },
      {
        id: 'tier0-a',
        novelId: 'novel-1',
        name: '林砚',
        role: '主角',
        goal: '',
        trait: '',
        note: '',
        aliases: [],
        importanceTier: 'protagonist',
      },
      {
        id: 'tier1-a',
        novelId: 'novel-1',
        name: '白棠',
        role: '重要配角',
        goal: '',
        trait: '',
        note: '',
        aliases: [],
        importanceTier: 'important',
      },
      {
        id: 'tier2-a',
        novelId: 'novel-1',
        name: '灰袍老人',
        role: '篇章配角',
        goal: '',
        trait: '',
        note: '',
        aliases: [],
        importanceTier: 'arc',
      },
    ]

    expect(sortCharactersForWorkspaceRail(characters).map((character) => character.name)).toEqual([
      '林砚',
      '白棠',
      '苏九',
      '灰袍老人',
      '白川',
      '阿木',
      '赵乙',
    ])
  })

  it('groups world entries into organizations, locations, and remaining worldbuilding types', () => {
    const entries: WorldEntry[] = [
      { id: 'org-1', novelId: 'novel-1', title: '夜巡司', type: 'organization', content: '城中密探组织' },
      { id: 'loc-1', novelId: 'novel-1', title: '白塔街', type: 'location', content: '主城要道' },
      { id: 'scene-1', novelId: 'novel-1', title: '祭坛幻境', type: 'scene', content: '只在关键章开启' },
      { id: 'rule-1', novelId: 'novel-1', title: '血契法则', type: 'rule', content: '代价不能逆转' },
    ]

    expect(groupWorldEntriesForWorkspaceRail(entries)).toEqual({
      organizations: [entries[0]],
      locations: [entries[1]],
      worldbuilding: [entries[2], entries[3]],
    })
  })

  it('falls back removed or unknown workspace knowledge tabs to characters', () => {
    expect(resolveWorkspaceRefTab('characters')).toBe('characters')
    expect(resolveWorkspaceRefTab('organizations')).toBe('organizations')
    expect(resolveWorkspaceRefTab('relations')).toBe('characters')
    expect(resolveWorkspaceRefTab('world')).toBe('characters')
    expect(resolveWorkspaceRefTab('unknown-tab')).toBe('characters')
    expect(resolveWorkspaceRefTab(null)).toBe('characters')
  })

  it('prefers canonical facet content and includes the body profile field in rendered sections', () => {
    expect(getCharacterFacetContent({ content: '  以瘦劲见长  ', summary: '旧摘要' })).toBe('以瘦劲见长')
    expect(getCharacterFacetContent({ summary: '  旧摘要仍可回退  ' })).toBe('旧摘要仍可回退')

    const profile = {
      identity: { content: '旧案里的落魄书生' },
      capability: { summary: '擅长拆局' },
      body: { content: '肩背挺拔，步伐极稳', evidence: '第三章提到“肩线绷直如弦”。' },
    }

    expect(hasCharacterProfile(profile)).toBe(true)

    expect(buildCharacterProfileSections(profile)).toEqual([
      {
        key: 'identity',
        label: '身份 / 背景',
        summary: '旧案里的落魄书生',
        note: '',
        evidence: '',
      },
      {
        key: 'capability',
        label: '能力 / 战力',
        summary: '擅长拆局',
        note: '',
        evidence: '',
      },
      {
        key: 'body',
        label: '体态',
        summary: '肩背挺拔，步伐极稳',
        note: '',
        evidence: '第三章提到“肩线绷直如弦”。',
      },
    ])
  })

  it('marks long character cards as expandable without requiring every profile to expand', () => {
    expect(characterCardNeedsExpansion({
      profileSections: buildCharacterProfileSections({
        identity: { content: '冷面捕快' },
        capability: { content: '刀法精准' },
        personality: { content: '寡言审慎' },
      }),
      note: '',
    })).toBe(false)

    expect(characterCardNeedsExpansion({
      profileSections: buildCharacterProfileSections({
        identity: { content: '冷面捕快' },
        capability: { content: '刀法精准' },
        personality: { content: '寡言审慎' },
        speakingStyle: { content: '每句话都像缓慢落刀一样压住场面' },
      }),
      note: '他把每一次亮相都压得极低，却总能在关键处突然发力，把整场对话带向他预设的方向。',
    })).toBe(true)
  })

  it('hides pure placeholder workspace characters even when they have classification badges', () => {
    const placeholderCharacter: Character = {
      id: 'placeholder-1',
      novelId: 'novel-1',
      name: '路人甲',
      role: '主要人物',
      goal: '待补充',
      trait: '待补充',
      note: '   ',
      aliases: [],
      importanceTier: 'important',
      classificationKey: 'tier1',
      classificationLabel: 'Tier 1',
    }

    expect(isWorkspaceCharacterVisible(placeholderCharacter)).toBe(false)
    expect(filterWorkspaceVisibleCharacters([placeholderCharacter])).toEqual([])
  })

  it('keeps workspace characters visible when any real role, alias, profile, goal, trait, or note exists', () => {
    const withRealNote: Character = {
      id: 'note-1',
      novelId: 'novel-1',
      name: '沈砚',
      role: '角色',
      goal: '待补充',
      trait: '待补充',
      note: '他在第七章留下关键线索。',
      aliases: [],
      importanceTier: 'candidate',
    }
    const withAliasOnly: Character = {
      id: 'alias-1',
      novelId: 'novel-1',
      name: '无名商贩',
      role: '角色',
      goal: '待补充',
      trait: '待补充',
      note: '',
      aliases: ['黑市向导'],
      importanceTier: 'ignored',
    }
    const withProfileOnly: Character = {
      id: 'profile-1',
      novelId: 'novel-1',
      name: '谢临',
      role: '角色',
      goal: '待补充',
      trait: '待补充',
      note: '',
      aliases: [],
      profile: {
        identity: { content: '失踪案里的前任仵作' },
      },
      importanceTier: 'important',
    }
    const withRealRoleOnly: Character = {
      id: 'role-1',
      novelId: 'novel-1',
      name: '周既明',
      role: '密探首领',
      goal: '待补充',
      trait: '待补充',
      note: '',
      aliases: [],
      importanceTier: null,
    }
    const withRealGoalOnly: Character = {
      id: 'goal-1',
      novelId: 'novel-1',
      name: '孟青',
      role: '角色',
      goal: '查清失踪案真相',
      trait: '待补充',
      note: '',
      aliases: [],
      importanceTier: null,
    }
    const withRealTraitOnly: Character = {
      id: 'trait-1',
      novelId: 'novel-1',
      name: '温岚',
      role: '主要人物',
      goal: '待补充',
      trait: '极度谨慎',
      note: '',
      aliases: [],
      importanceTier: null,
    }

    expect(isWorkspaceCharacterVisible(withRealNote)).toBe(true)
    expect(isWorkspaceCharacterVisible(withAliasOnly)).toBe(true)
    expect(isWorkspaceCharacterVisible(withProfileOnly)).toBe(true)
    expect(isWorkspaceCharacterVisible(withRealRoleOnly)).toBe(true)
    expect(isWorkspaceCharacterVisible(withRealGoalOnly)).toBe(true)
    expect(isWorkspaceCharacterVisible(withRealTraitOnly)).toBe(true)
    expect(filterWorkspaceVisibleCharacters([
      withRealNote,
      withAliasOnly,
      withProfileOnly,
      withRealRoleOnly,
      withRealGoalOnly,
      withRealTraitOnly,
    ])).toEqual([
      withRealNote,
      withAliasOnly,
      withProfileOnly,
      withRealRoleOnly,
      withRealGoalOnly,
      withRealTraitOnly,
    ])
  })

  it('does not treat profile note-only facets as real role-card profile content', () => {
    const profileNoteOnly: Character = {
      id: 'profile-note-only',
      novelId: 'novel-1',
      name: '旁观者',
      role: '角色',
      goal: '待补充',
      trait: '待补充',
      note: '待补充',
      aliases: [],
      profile: {
        identity: { note: '只有补充说明，没有正文画像。', evidence: '第六章提到过一次。' },
      },
      importanceTier: 'candidate',
    }

    expect(hasCharacterProfile(profileNoteOnly.profile)).toBe(false)
    expect(isWorkspaceCharacterVisible(profileNoteOnly)).toBe(false)
  })

  it('blocks HanLP cache deletion while a rebuild is queued, running, or paused', () => {
    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'queued' },
      knowledgeActionLoading: null,
    })).toMatchObject({
      disabled: true,
      helperText: expect.stringContaining('需先终止或完成当前重建后才能删除缓存'),
    })

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'running' },
      knowledgeActionLoading: null,
    }).disabled).toBe(true)

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'paused' },
      knowledgeActionLoading: null,
    }).disabled).toBe(true)

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
    })).toMatchObject({
      disabled: false,
      helperText: expect.stringContaining('不会影响正文或原文 Embedding 缓存'),
    })

    expect(resolveHanlpCacheDeleteState({
      knowledgeRebuildStatus: { status: 'failed' },
      knowledgeActionLoading: null,
    }).disabled).toBe(false)
  })

  it('uses the same active-rebuild guard for all manual cache deletion controls', () => {
    expect(resolveCacheDeleteState({
      knowledgeRebuildStatus: { status: 'running' },
      knowledgeActionLoading: null,
      idleHelperText: 'idle helper',
    })).toMatchObject({
      disabled: true,
      helperText: expect.stringContaining('需先终止或完成当前重建后才能删除缓存'),
    })

    expect(resolveCacheDeleteState({
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: 'delete-embedding-cache',
      idleHelperText: 'idle helper',
    })).toMatchObject({
      disabled: true,
      helperText: 'idle helper',
    })

    expect(resolveCacheDeleteState({
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      idleHelperText: 'idle helper',
    })).toMatchObject({
      disabled: false,
      helperText: 'idle helper',
    })
  })

  it('normalizes knowledge rebuild chapter range controls', () => {
    expect(normalizeKnowledgeRebuildChapterRangeInput({
      mode: 'all',
      firstChapterCount: '3',
      startChapter: '2',
      endChapter: '4',
      maxChapterCount: 10,
    })).toBeUndefined()

    expect(normalizeKnowledgeRebuildChapterRangeInput({
      mode: 'first',
      firstChapterCount: '20',
      startChapter: '',
      endChapter: '',
      maxChapterCount: 11,
    })).toEqual({ startChapter: 1, endChapter: 11 })

    expect(normalizeKnowledgeRebuildChapterRangeInput({
      mode: 'custom',
      firstChapterCount: '',
      startChapter: '8',
      endChapter: '3',
      maxChapterCount: 11,
    })).toEqual({ startChapter: 3, endChapter: 8 })
  })

  it('returns a clear fallback message for failed rebuild status', () => {
    expect(resolveKnowledgeRebuildFailureMessage({
      status: 'failed',
      errorMessage: 'HanLP bootstrap crashed on chapter 1',
    })).toBe('HanLP bootstrap crashed on chapter 1')

    expect(resolveKnowledgeRebuildFailureMessage({
      status: 'failed',
      errorMessage: '   ',
    })).toBe('知识视图重建失败，请重新发起重建。')

    expect(resolveKnowledgeRebuildFailureMessage({
      status: 'running',
      errorMessage: 'ignored',
    })).toBeNull()
  })

  it('switches LanceDB inline controls based on retrieval task status', () => {
    expect(resolveRetrievalTaskControlsState({
      retrievalTask: null,
      retrievalIndexOverview: { status: 'missing' },
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    })).toMatchObject({
      disabled: false,
      actions: ['start'],
      helperText: null,
    })

    expect(resolveRetrievalTaskControlsState({
      retrievalTask: null,
      retrievalIndexOverview: { status: 'partial' },
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    }).actions).toEqual(['refresh'])

    expect(resolveRetrievalTaskControlsState({
      retrievalTask: { status: 'running' },
      retrievalIndexOverview: { status: 'partial' },
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    }).actions).toEqual(['pause', 'abort'])

    expect(resolveRetrievalTaskControlsState({
      retrievalTask: { status: 'paused' },
      retrievalIndexOverview: { status: 'partial' },
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    }).actions).toEqual(['continue', 'abort'])

    expect(resolveRetrievalTaskControlsState({
      retrievalTask: { status: 'failed' },
      retrievalIndexOverview: { status: 'partial' },
      knowledgeRebuildStatus: null,
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    }).actions).toEqual(['retry'])
  })

  it('disables LanceDB inline controls while the main extract rebuild is busy', () => {
    expect(resolveRetrievalTaskControlsState({
      retrievalTask: null,
      retrievalIndexOverview: { status: 'missing' },
      knowledgeRebuildStatus: { status: 'running', jobType: 'extract_chapter_knowledge' },
      knowledgeActionLoading: null,
      knowledgeRebuilding: false,
    })).toMatchObject({
      disabled: true,
      actions: ['start'],
      helperText: expect.stringContaining('主知识重建进行中'),
    })
  })
})
