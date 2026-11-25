import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
const instant = z.string().datetime({ offset: true })
const bounded = z.string().min(1).max(160)
const safeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger)
const opaque = z.string().regex(/^[a-f0-9]{24}$/)
const candidateId = z.string().regex(/^multi-[a-f0-9]{64}$/)

export const multiEventRunSchema = z.object({
  id: uuid,
  status: z.enum(['PENDING', 'RUNNING', 'RETRYABLE', 'FAILED', 'BLOCKED', 'COMPLETED']),
  failureCode: z.string().max(64).nullable(),
  ledgerVersionSetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  scoreVersion: z.literal('score-v2-exp2-multi-event-recurrence'),
  projectionVersion: z.literal('projection-v2.2-exp2-ipwindow-softhub'),
  algorithmVersion: z.string().max(256).nullable(),
  analysisAsOf: instant,
  analysisStartAt: instant,
  analysisEndAt: instant,
  createdAt: instant,
  updatedAt: instant,
  completedAt: instant.nullable(),
}).superRefine((run, context) => {
  if (run.status === 'COMPLETED' && run.completedAt === null) context.addIssue({ code: 'custom', message: '완료된 다공연 작업에는 완료 시각이 필요합니다.' })
  if (run.status !== 'COMPLETED' && run.completedAt !== null) context.addIssue({ code: 'custom', message: '완료 전 작업에는 완료 시각이 없어야 합니다.' })
})
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), page: safeInteger, pageSize: z.number().int().min(1).max(100), hasNext: z.boolean() })
export const multiEventRunListSchema = page(multiEventRunSchema)
export const multiEventScopeSchema = z.object({ eventId: uuid, performanceId: uuid, ledgerVersionId: uuid, eventReference: bounded, sourceBatchId: bounded })
export const multiEventScopeListSchema = z.array(multiEventScopeSchema)
export const multiEventScopePageSchema = page(multiEventScopeSchema)
export const multiEventCandidateSchema = z.object({
  candidateId,
  priorityBand: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  investigationScore: z.number().finite().min(0).max(1),
  baselineMaxScore: z.number().finite().min(0).max(1).nullable(),
  distinctAccountCount: safeInteger.min(2),
  distinctEventCount: safeInteger.min(1),
  distinctPerformanceCount: safeInteger.min(2),
  verifiedRelationshipCount: safeInteger.min(1),
  scoreBreakdown: z.string().max(4096),
  availableSignals: z.string().max(4096),
  excludedSignals: z.string().max(4096),
  unavailableSignals: z.string().max(4096),
  normalSharingPossibilities: z.string().max(4096),
})
export const multiEventCandidatePageSchema = page(multiEventCandidateSchema)
export const multiEventMemberPageSchema = page(z.object({ memberId: opaque }))
export const multiEventRelationshipPageSchema = page(z.object({
  relationshipId: uuid, signalType: bounded, accountCount: safeInteger.min(2), sourceScopeCount: safeInteger.min(1),
  memberIds: z.array(opaque).max(20), membersTruncated: z.boolean(), sourceScopes: z.array(multiEventScopeSchema).max(500),
}))
export type MultiEventRelationship = z.infer<typeof multiEventRelationshipPageSchema>['items'][number]
export const multiEventAcceptedSchema = z.object({ runId: uuid, existing: z.boolean(), status: z.enum(['PENDING', 'RUNNING', 'RETRYABLE', 'FAILED', 'BLOCKED', 'COMPLETED']) })

export type MultiEventRun = z.infer<typeof multiEventRunSchema>
export type MultiEventRunPage = z.infer<typeof multiEventRunListSchema>
export type MultiEventCandidate = z.infer<typeof multiEventCandidateSchema>
export type MultiEventScope = z.infer<typeof multiEventScopeSchema>

const root = '/api/v1/admin/multi-event-investigations'
function valid(value: string) { return isUuid(value) ? value.toLowerCase() : null }
export function multiEventRunsPath(eventId: string, pageNumber = 0) { const event = valid(eventId); return event === null || pageNumber < 0 || !Number.isSafeInteger(pageNumber) ? null : adminApiPath(`${root}/events/${event}`, { page: pageNumber, pageSize: 20 }) }
export function multiEventRetryPath(eventId: string, runId: string) { const path = multiEventRunPath(eventId, runId); return path === null ? null : `${path}/retry` }
export function multiEventAvailablePerformancesPath(eventId: string, pageNumber = 0) { const event = valid(eventId); return event === null || pageNumber < 0 || !Number.isSafeInteger(pageNumber) ? null : adminApiPath(`${root}/events/${event}/performances`, { page: pageNumber, pageSize: 100 }) }
export function multiEventRunPath(eventId: string, runId: string) { const event = valid(eventId); const run = valid(runId); return event === null || run === null ? null : `${root}/events/${event}/${run}` }
export function multiEventCandidatesPath(eventId: string, runId: string, pageNumber: number) { const path = multiEventRunPath(eventId, runId); return path === null || pageNumber < 0 || !Number.isSafeInteger(pageNumber) ? null : adminApiPath(`${path}/candidates`, { page: pageNumber, pageSize: 20 }) }
export function multiEventMembersPath(eventId: string, runId: string, id: string, pageNumber: number) { const path = multiEventRunPath(eventId, runId); return path === null || !candidateId.safeParse(id).success || pageNumber < 0 || !Number.isSafeInteger(pageNumber) ? null : adminApiPath(`${path}/candidates/${id}/members`, { page: pageNumber, pageSize: 100 }) }
export function multiEventRelationshipsPath(eventId: string, runId: string, id: string, pageNumber: number) { const path = multiEventRunPath(eventId, runId); return path === null || !candidateId.safeParse(id).success || pageNumber < 0 || !Number.isSafeInteger(pageNumber) ? null : adminApiPath(`${path}/candidates/${id}/relationships`, { page: pageNumber, pageSize: 20 }) }
export function multiEventSourcesPath(eventId: string, runId: string) { const path = multiEventRunPath(eventId, runId); return path === null ? null : `${path}/sources` }

export function safeDetail(value: string): Record<string, unknown> | null {
  try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null } catch { return null }
}
