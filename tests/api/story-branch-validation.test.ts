import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  futureJumpRunCreateSchema,
  futureJumpReviseSchema,
  timelineSelectionSchema,
  whatIfDeltaCreateSchema,
  whatIfSessionCreateSchema,
} from '@/lib/server/story-branch-contracts'

const EVIDENCE_DIR = process.env.TASK_EVIDENCE_DIR!

describe('story branch validation contracts', () => {
  it('rejects malformed what-if and future-jump payloads', () => {
    expect(() => whatIfSessionCreateSchema.parse({})).toThrow()
    expect(() =>
      whatIfDeltaCreateSchema.parse({
        id: 'delta-001',
        sessionId: 'session-001',
        deltaType: 'relationship_change',
        key: '',
        description: 'broken',
      })
    ).toThrow()

    expect(() =>
      futureJumpRunCreateSchema.parse({
        id: 'run-001',
        sessionId: 'session-001',
        baseBranchId: 'novel:main',
        parentTimelineNodeId: null,
        targetOutlineNodeId: 'outline-001',
        targetOutlineChapterId: '',
        sourceChapterNo: 10,
        targetChapterNo: 100,
        userDirection: '',
        bridgeSummary: 'bridge',
        generatedTargetText: 'text',
        status: 'generated',
      })
    ).toThrow()

    expect(() =>
      futureJumpReviseSchema.parse({
        runId: 'run-001',
        revisionKind: 'bad-kind',
        userFeedback: 'feedback',
        bridgeSummary: 'bridge',
        generatedTargetText: 'text',
      })
    ).toThrow()

    expect(() =>
      timelineSelectionSchema.parse({
        kind: 'continue_block',
        nodeId: 'node-continue-001',
        continueBlockId: 'continue-block-001',
        anchorChapterNo: 10,
      })
    ).not.toThrow()

    expect(() =>
      timelineSelectionSchema.parse({
        kind: 'future_jump',
        nodeId: 'node-001',
        runId: 'run-001',
        sourceChapterNo: 100,
        targetChapterNo: 10,
      })
    ).not.toThrow()

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'validation-report.txt'), 'Malformed payload checks passed.')
  })
})
