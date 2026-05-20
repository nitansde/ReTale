import { describe, expect, it } from 'vitest'
import {
  ARC_CHARACTER_TOTAL_COUNT_THRESHOLD,
  IMPORTANT_CHARACTER_COVERAGE_THRESHOLD,
  classifyHanlpBootstrapCharacters,
  deriveConfiguredProtagonistName,
  isGenericTemporaryCharacterName,
} from '@/lib/server/character-tier'
import {
  CHARACTER_IMPORTANCE_TIERS,
  characterImportanceTierSchema,
  type CharacterImportanceTier,
} from '@/lib/server/hanlp-contracts'

describe('character tier contracts', () => {
  it('keeps the allowed character tier constants stable', () => {
    const tiers: CharacterImportanceTier[] = [
      'protagonist',
      'important',
      'arc',
      'candidate',
      'ignored',
    ]

    expect(CHARACTER_IMPORTANCE_TIERS).toEqual(tiers)
  })

  it('accepts only the declared character tier values', () => {
    expect(characterImportanceTierSchema.parse('protagonist')).toBe('protagonist')
    expect(characterImportanceTierSchema.parse('ignored')).toBe('ignored')
    expect(() => characterImportanceTierSchema.parse('minor')).toThrow()
  })

  it('classifies important characters by chapter coverage rather than raw mentions', () => {
    const decisions = classifyHanlpBootstrapCharacters({
      totalChapters: 100,
      people: [
        { name: '主角甲', totalCount: 120, chapterCount: 40, score: 0.99 },
        { name: '角色甲', totalCount: 20, chapterCount: 10, score: 0.8 },
        { name: '角色乙', totalCount: 100, chapterCount: 9, score: 0.95 },
      ],
    })

    expect(IMPORTANT_CHARACTER_COVERAGE_THRESHOLD).toBe(0.1)
    expect(decisions.find((item) => item.normalizedName === '角色甲')).toMatchObject({ tier: 'important', reason: 'coverage_threshold' })
    expect(decisions.find((item) => item.normalizedName === '角色乙')).toMatchObject({ tier: 'arc', reason: 'arc_threshold' })
  })

  it('requires total count above ten for arc characters below important coverage', () => {
    const decisions = classifyHanlpBootstrapCharacters({
      totalChapters: 50,
      people: [
        { name: '主角乙', totalCount: 100, chapterCount: 20, score: 0.99 },
        { name: '角色丙', totalCount: ARC_CHARACTER_TOTAL_COUNT_THRESHOLD, chapterCount: 4, score: 0.6 },
        { name: '角色丁', totalCount: ARC_CHARACTER_TOTAL_COUNT_THRESHOLD + 1, chapterCount: 4, score: 0.6 },
      ],
    })

    expect(decisions.find((item) => item.normalizedName === '角色丙')).toMatchObject({ tier: 'ignored', reason: 'below_threshold' })
    expect(decisions.find((item) => item.normalizedName === '角色丁')).toMatchObject({ tier: 'arc', reason: 'arc_threshold' })
  })

  it('prefers a configured protagonist over the highest HanLP-ranked person when present', () => {
    const decisions = classifyHanlpBootstrapCharacters({
      totalChapters: 20,
      configuredProtagonistName: '小满',
      people: [
        { name: '阿离', totalCount: 40, chapterCount: 12, score: 0.95 },
        { name: '小满', totalCount: 6, chapterCount: 4, score: 0.4 },
      ],
    })

    expect(decisions.find((item) => item.normalizedName === '小满')).toMatchObject({ tier: 'protagonist', reason: 'configured_protagonist' })
    expect(decisions.find((item) => item.normalizedName === '阿离')).toMatchObject({ tier: 'important' })
  })

  it('ignores generic temporary roles and derives protagonist from local character roles', () => {
    expect(isGenericTemporaryCharacterName('守卫')).toBe(true)
    expect(isGenericTemporaryCharacterName('阿离')).toBe(false)
    expect(deriveConfiguredProtagonistName({
      localCharacters: [
        { id: 'c1', novelId: 'n1', name: '阿离', role: '配角', goal: '', trait: '', note: '' },
        { id: 'c2', novelId: 'n1', name: '小满', role: '主角', goal: '', trait: '', note: '' },
      ],
    })).toBe('小满')

    const decisions = classifyHanlpBootstrapCharacters({
      totalChapters: 10,
      people: [
        { name: '守卫', totalCount: 50, chapterCount: 10, score: 0.9 },
        { name: '阿离', totalCount: 8, chapterCount: 3, score: 0.7 },
      ],
    })

    expect(decisions.find((item) => item.normalizedName === '守卫')).toMatchObject({ tier: 'ignored', reason: 'generic_stoplist' })
    expect(decisions.find((item) => item.normalizedName === '阿离')).toMatchObject({ tier: 'protagonist' })
  })
})
