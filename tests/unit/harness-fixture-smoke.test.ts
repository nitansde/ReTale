import { describe, expect, it } from 'vitest'
import { writeEvidenceFile } from '@/tests/helpers/evidence'
import { storyBranchFixtureIds } from '@/tests/helpers/fixture-ids'

describe('story branch deterministic fixture ids', () => {
  it('exposes the planned ids and chapter anchors', () => {
    expect(storyBranchFixtureIds).toEqual({
      sourceChapterNo: 10,
      targetChapterNo: 100,
      whatIfNodeId: 'if_fixture_001',
      futureJumpNodeId: 'jump_fixture_001',
      outlineEventId: 'outline_event_100',
      outlineChapterAnchorId: 'outline_chapter_100_primary',
    })

    writeEvidenceFile(
      'unit-fixture-ids.txt',
      JSON.stringify(storyBranchFixtureIds, null, 2)
    )
  })
})
