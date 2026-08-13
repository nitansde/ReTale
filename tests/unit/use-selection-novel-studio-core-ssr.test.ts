import { describe, expect, it } from 'vitest'
import {
  isReferenceMatchMediaAvailable,
  resolveReferenceResourcesVisible,
} from '@/components/workspace/use-selection-novel-studio-core'

describe('useSelectionNovelStudioCore SSR capabilities', () => {
  it('computes reference resource visibility without a window global', () => {
    expect(typeof window).toBe('undefined')

    const matchMediaAvailable = isReferenceMatchMediaAvailable()

    expect(matchMediaAvailable).toBe(false)
    expect(resolveReferenceResourcesVisible(false, matchMediaAvailable, false)).toBe(true)
  })
})
