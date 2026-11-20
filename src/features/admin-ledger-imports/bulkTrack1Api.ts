import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

// BL-07은 기존 analysis-runs(BL-06)와 별도의 대용량 결과 조회 계약이다.
// 숫자는 Java long이라도 JavaScript 안전 정수 범위를 넘으면 표시하지 않는다.
const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
const instant = z.string().datetime({ offset: true })
const safeNonnegativeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger)
const safePositiveInteger = z.number().int().positive().refine(Number.isSafeInteger)
const boundedText = z.string().min(1).max(160)
const opaqueIdentifier = z.string().regex(/^[a-f0-9]{24}$/)

export const bulkJobStatuses = ['PREPARING', 'REGISTERING', 'QUEUED', 'RUNNING', 'COLLECTING', 'RETRYABLE', 'FAILED', 'BLOCKED', 'COMPLETED'] as const
export const dataJobStatuses = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'INPUT_REJECTED', 'CANCELLED', 'INTERRUPTED'] as const
export const evaluationStatuses = ['EVALUATED', 'POLICY_NOT_CONFIRMED', 'QUANTITY_DATA_INCOMPLETE', 'POLICY_TIME_NOT_APPLICABLE'] as const

const clusterId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/).refine((value) => value !== '.' && value !== '..')
const collectionStatus = z.enum(['PENDING', 'COLLECTING', 'COMPLETED', 'NOT_APPLICABLE'])

export const bulkJobSchema = z.object({
  jobId: uuid,
  ledgerVersionId: uuid,
  dataJobId: uuid.nullable(),
  status: z.enum(bulkJobStatuses),
  dataStatus: z.enum(dataJobStatuses).nullable(),
  failureCode: boundedText.nullable(),
  algorithmVersion: boundedText.nullable(),
  sharedSignalObservationsStatus: z.literal('COMPLETED').nullable(),
  purchaseLimitEvaluationsStatus: z.literal('COMPLETED').nullable(),
  createdAt: instant,
  updatedAt: instant,
  completedAt: instant.nullable(),
  policyVerificationStatus: z.enum(['CONFIRMED', 'POLICY_NOT_CONFIRMED']).nullable(),
  quantityDataStatus: z.enum(['COMPLETE', 'INCOMPLETE']).nullable(),
  dataCompletenessReason: z.string().min(1).max(128).nullable(),
  policyId: uuid.nullable(),
  policyRevision: safePositiveInteger.nullable(),
  policyVersion: z.string().min(1).max(128).nullable(),
}).superRefine((job, context) => {
  if (job.status === 'COMPLETED' && job.completedAt === null) context.addIssue({ code: 'custom', message: '완료 Job에는 completedAt이 필요합니다.' })
  if (job.status !== 'COMPLETED' && job.completedAt !== null) context.addIssue({ code: 'custom', message: '완료 전 Job에는 completedAt이 없어야 합니다.' })
  if (job.policyVerificationStatus === 'CONFIRMED' && (job.policyId === null || job.policyRevision === null || job.policyVersion === null)) context.addIssue({ code: 'custom', message: '확인된 정책 메타데이터가 불완전합니다.' })
  if (job.policyVerificationStatus === 'POLICY_NOT_CONFIRMED' && (job.policyId !== null || job.policyRevision !== null || job.policyVersion !== null)) context.addIssue({ code: 'custom', message: '미확정 정책에 정책 식별자를 결합할 수 없습니다.' })
})

export const bulkJobListSchema = z.array(bulkJobSchema)

const clusterSchema = z.object({
  clusterId,
  riskScore: z.number().finite().min(0).max(1),
  memberCount: safeNonnegativeInteger,
  paymentSharedSignalCount: safeNonnegativeInteger,
  addressSharedSignalCount: safeNonnegativeInteger,
  deviceSharedSignalCount: safeNonnegativeInteger,
  ipSharedSignalCount: safeNonnegativeInteger,
})

const pageShape = <T extends z.ZodType>(item: T) => z.object({
  job: bulkJobSchema,
  items: z.array(item),
  page: safeNonnegativeInteger,
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export const bulkClusterPageSchema = pageShape(clusterSchema)
export const bulkClusterMembersPageSchema = z.object({
  clusterId,
  items: z.array(z.object({ memberId: opaqueIdentifier })),
  page: safeNonnegativeInteger,
  pageSize: z.number().int().min(1).max(500),
  hasNext: z.boolean(),
})

export const bulkSharedSignalPageSchema = pageShape(z.object({
  observationId: z.string().min(1).max(128),
  signalType: z.enum(['IP', 'ADDRESS']),
  distinctAccountCount: safeNonnegativeInteger,
  scopeAccountCount: safeNonnegativeInteger,
  distinctReservationCount: safeNonnegativeInteger,
  totalTicketQuantity: safeNonnegativeInteger.nullable(),
  ticketQuantityStatus: z.enum(['VERIFIED', 'UNAVAILABLE']),
  paymentSharedAccountCount: safeNonnegativeInteger,
  deviceSharedAccountCount: safeNonnegativeInteger,
  ipNetworkType: z.string().min(1).max(32),
  purchaseWindowSeconds: safeNonnegativeInteger.nullable(),
  excludedFromLouvain: z.boolean(),
}).superRefine((value, context) => {
  if (value.ticketQuantityStatus === 'VERIFIED' && value.totalTicketQuantity === null) context.addIssue({ code: 'custom', message: '확인된 수량이 없습니다.' })
  if (value.ticketQuantityStatus === 'UNAVAILABLE' && value.totalTicketQuantity !== null) context.addIssue({ code: 'custom', message: '확인 불가 수량을 표시할 수 없습니다.' })
}))

export const bulkEvaluationPageSchema = pageShape(z.object({
  performanceId: uuid,
  status: z.enum(evaluationStatuses),
  policyVersion: z.string().min(1).max(128).nullable(),
  accountLimitFindingCount: safeNonnegativeInteger,
  findingsCollectionStatus: collectionStatus,
}).superRefine((value, context) => {
  if (value.status === 'EVALUATED' && value.policyVersion === null) context.addIssue({ code: 'custom', message: '평가 완료에는 정책 버전이 필요합니다.' })
  if (value.status !== 'EVALUATED' && value.findingsCollectionStatus !== 'NOT_APPLICABLE') context.addIssue({ code: 'custom', message: '평가 불가 결과의 finding 수집 상태가 올바르지 않습니다.' })
}))

export const bulkFindingPageSchema = pageShape(z.object({
  accountId: opaqueIdentifier,
  effectiveTicketQuantity: safePositiveInteger,
  maxTicketsPerAccount: safePositiveInteger,
  policyVersion: z.string().min(1).max(128),
  reservationQuantities: z.array(z.object({ reservationId: opaqueIdentifier, effectiveTicketQuantity: safePositiveInteger })),
}))

export type BulkJob = z.infer<typeof bulkJobSchema>
export type BulkCluster = z.infer<typeof clusterSchema>
export type BulkSharedSignal = z.infer<typeof bulkSharedSignalPageSchema>['items'][number]
export type BulkEvaluation = z.infer<typeof bulkEvaluationPageSchema>['items'][number]
export type BulkFinding = z.infer<typeof bulkFindingPageSchema>['items'][number]

export const bulkResultsPageSize = 20

function scopePath(eventId: string, performanceId: string) {
  if (!isUuid(eventId) || !isUuid(performanceId)) return null
  return `/api/v1/admin/events/${eventId.toLowerCase()}/ledger-track1/performances/${performanceId.toLowerCase()}`
}

function pagePath(path: string | null, page: number, pageSize: number) {
  if (path === null || !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return null
  return adminApiPath(path, { page, pageSize })
}

export function bulkAnalysisJobsPath(eventId: string, performanceId: string) {
  const root = scopePath(eventId, performanceId)
  return root === null ? null : `${root}/bulk-analysis-jobs`
}

function bulkJobRoot(eventId: string, performanceId: string, jobId: string) {
  const root = scopePath(eventId, performanceId)
  if (root === null || !isUuid(jobId)) return null
  return `${root}/bulk-analysis-jobs/${jobId.toLowerCase()}`
}

export function bulkClustersPath(eventId: string, performanceId: string, jobId: string, page: number) {
  return pagePath(bulkJobRoot(eventId, performanceId, jobId)?.concat('/clusters') ?? null, page, bulkResultsPageSize)
}

/** clusterId는 퍼센트 인코딩으로 우회하지 않는다. 안전한 단일 path segment가 아니면 상세 요청을 만들지 않는다. */
export function bulkClusterMembersPath(eventId: string, performanceId: string, jobId: string, value: string, page: number) {
  const validCluster = clusterId.safeParse(value).success
  const root = bulkJobRoot(eventId, performanceId, jobId)
  return validCluster && root !== null ? pagePath(`${root}/clusters/${value}/members`, page, 100) : null
}

export function bulkSharedSignalsPath(eventId: string, performanceId: string, jobId: string, page: number) {
  return pagePath(bulkJobRoot(eventId, performanceId, jobId)?.concat('/shared-signal-observations') ?? null, page, bulkResultsPageSize)
}

export function bulkEvaluationsPath(eventId: string, performanceId: string, jobId: string, page: number) {
  return pagePath(bulkJobRoot(eventId, performanceId, jobId)?.concat('/purchase-limit-evaluations') ?? null, page, bulkResultsPageSize)
}

export function bulkFindingsPath(eventId: string, performanceId: string, jobId: string, page: number) {
  return pagePath(bulkJobRoot(eventId, performanceId, jobId)?.concat('/purchase-limit-findings') ?? null, page, bulkResultsPageSize)
}

export function pageFor(previous: number, hasNext: boolean, direction: 'previous' | 'next') {
  return direction === 'previous' ? Math.max(previous - 1, 0) : hasNext ? previous + 1 : previous
}

export function isBulkPageForJob(page: { job: BulkJob }, job: BulkJob) {
  return page.job.jobId === job.jobId && page.job.ledgerVersionId === job.ledgerVersionId && page.job.dataJobId === job.dataJobId
}
