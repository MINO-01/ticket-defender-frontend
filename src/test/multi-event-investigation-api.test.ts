import { describe, expect, it } from 'vitest'
import {
  multiEventAvailablePerformancesPath, multiEventCandidatesPath, multiEventMembersPath,
  multiEventAcceptedSchema, multiEventRelationshipsPath, multiEventRunListSchema, multiEventRetryPath, safeDetail,
} from '../features/admin-multi-event/multiEventInvestigationApi'

const eventId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'

describe('multi-event investigation API contract', () => {
  it('uses only validated UUID scope paths and bounded pages', () => {
    expect(multiEventAvailablePerformancesPath(eventId)).toBe(`/api/v1/admin/multi-event-investigations/events/${eventId}/performances?page=0&pageSize=100`)
    expect(multiEventCandidatesPath(eventId, runId, 0)).toContain('page=0&pageSize=20')
    expect(multiEventRetryPath(eventId, runId)).toBe(`/api/v1/admin/multi-event-investigations/events/${eventId}/${runId}/retry`)
    expect(multiEventMembersPath(eventId, runId, '../candidate', 0)).toBeNull()
    expect(multiEventMembersPath(eventId, runId, `multi-${'a'.repeat(64)}`, -1)).toBeNull()
    expect(multiEventRelationshipsPath(eventId, runId, `multi-${'a'.repeat(64)}`, Number.MAX_SAFE_INTEGER + 1)).toBeNull()
  })

  it('does not accept an incomplete completed run response', () => {
    expect(multiEventRunListSchema.safeParse([{ id: runId, status: 'COMPLETED', failureCode: null, ledgerVersionSetDigest: 'a'.repeat(64), scoreVersion: 'score-v2-exp2-multi-event-recurrence', projectionVersion: 'projection-v2.2-exp2-ipwindow-softhub', algorithmVersion: null, analysisAsOf: '2026-01-01T00:00:00Z', analysisStartAt: '2025-12-01T00:00:00Z', analysisEndAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', completedAt: null }]).success).toBe(false)
  })

  it('accepts the asynchronous Data processing state in run and idempotent acceptance responses', () => {
    const run = {
      id: runId, status: 'DATA_PENDING', failureCode: null, ledgerVersionSetDigest: 'a'.repeat(64),
      scoreVersion: 'score-v2-exp2-multi-event-recurrence', projectionVersion: 'projection-v2.2-exp2-ipwindow-softhub',
      algorithmVersion: null, analysisAsOf: '2026-01-01T00:00:00Z',
      analysisStartAt: '2025-12-01T00:00:00Z', analysisEndAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', completedAt: null,
    }
    expect(multiEventRunListSchema.safeParse({ items: [run], page: 0, pageSize: 20, hasNext: false }).success).toBe(true)
    expect(multiEventAcceptedSchema.parse({ runId, existing: true, status: 'DATA_PENDING' }).status).toBe('DATA_PENDING')
  })

  it('accepts the multi-performance score version, keeps retired runs readable and rejects unknown versions', () => {
    const run = (scoreVersion: string) => ({
      id: runId, status: 'DATA_PENDING', failureCode: null, ledgerVersionSetDigest: 'a'.repeat(64),
      scoreVersion, projectionVersion: 'projection-v2.2-exp2-ipwindow-softhub', algorithmVersion: null,
      analysisAsOf: '2026-01-01T00:00:00Z', analysisStartAt: '2025-12-01T00:00:00Z', analysisEndAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', completedAt: null,
    })
    const parse = (scoreVersion: string) => multiEventRunListSchema.safeParse({ items: [run(scoreVersion)], page: 0, pageSize: 20, hasNext: false }).success
    expect(parse('score-v2-exp2-multi-performance-recurrence')).toBe(true)
    expect(parse('score-v2-exp2-multi-event-recurrence')).toBe(true)
    expect(parse('score-v2-exp2-unknown')).toBe(false)
  })

  it('only exposes object-shaped score details', () => {
    expect(safeDetail('{"L":0.8,"R":0.5}')).toEqual({ L: 0.8, R: 0.5 })
    expect(safeDetail('["unexpected"]')).toBeNull()
  })
})
