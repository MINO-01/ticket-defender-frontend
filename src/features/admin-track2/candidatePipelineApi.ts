import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import type { OperationMessages, WorkflowMessage } from '../admin-cases/caseWorkflowApi'
import { isUuid } from '../fan-report/intakeConfig'
import { utcDateTime } from './track2Api'

// Backend track2-candidate-pipeline-v1(검증 회차, 제보 회차 연결, 후보 대조 실행) 계약이다.
// 기준은 Backend main 391e285의 CandidatePipelineDto, VerifiedPerformanceController, PerformanceLinkController, ListingCandidateMatchController다.
// 역할: 회차 목록과 쓰기, 회차 연결과 이력은 REVIEWER, TENANT_ADMIN만, 후보 실행과 이력은 ANALYST, REVIEWER만 허용된다. 화면은 역할을 추정하지 않고 서버 403을 따른다.
// 회차 쓰기(등록 POST, 수정 PATCH, 철회 POST)에는 Idempotency-Key가 없다. 회차 연결과 후보 실행에만 키가 있다.
// 시각은 오프셋 없는 LocalDateTime이며 서버가 UTC로 만든다. 기존 utcDateTime 스키마로 UTC로만 해석한다.
// 후보 결과는 사람이 조사할 후보이며 부정 거래 확정, Case 생성, 제재가 아니다. 예매번호 원문, 계정, HMAC 값은 API가 돌려주지 않고 화면도 다루지 않는다.

export const candidateRunPageSize = 20

const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)
const boundedText = (max: number) => z.string().min(1).max(max)

export const performanceStatuses = ['ACTIVE', 'WITHDRAWN'] as const
export const linkStatuses = ['ACTIVE', 'REPLACED', 'WITHDRAWN'] as const
export const candidateStatuses = ['IN_PROGRESS', 'MATCH_CANDIDATE', 'NO_MATCH', 'AMBIGUOUS', 'UNVERIFIABLE', 'LOOKUP_FAILED', 'ANALYSIS_FAILED'] as const
export const candidateReasons = [
  'LOOKUP_STARTED', 'MATCHED_SINGLE_CANDIDATE', 'NO_CANDIDATE_FOUND', 'MULTIPLE_CANDIDATES', 'ANALYSIS_NOT_SUCCEEDED', 'PERFORMANCE_LINK_UNVERIFIED',
  'PERFORMANCE_WITHDRAWN', 'PERFORMANCE_REVISION_CHANGED', 'RESERVATION_SOURCE_INCOMPLETE', 'RESERVATION_SOURCE_UNAVAILABLE', 'SEAT_OBSERVATION_UNAVAILABLE',
  'SEAT_OBSERVATION_AMBIGUOUS', 'ANALYSIS_OR_EVIDENCE_CHANGED', 'RESERVATION_LOOKUP_FAILED',
] as const
export const applicabilities = [
  'CURRENT', 'PERFORMANCE_LINK_REPLACED_OR_WITHDRAWN', 'PERFORMANCE_WITHDRAWN', 'PERFORMANCE_REVISION_CHANGED', 'RESERVATION_SOURCE_SUPERSEDED',
  'ANALYSIS_OR_EVIDENCE_CHANGED', 'NOT_APPLICABLE',
] as const

export type CandidateStatus = (typeof candidateStatuses)[number]
export type CandidateReason = (typeof candidateReasons)[number]
export type Applicability = (typeof applicabilities)[number]

export const performanceSchema = z.object({
  performanceId: uuid,
  eventId: uuid,
  performanceRef: boundedText(128),
  status: z.enum(performanceStatuses),
  revision: z.number().int().min(1),
  sourceVersion: boundedText(128),
  verifiedAt: utcDateTime,
  withdrawnAt: utcDateTime.nullable(),
})

export const performanceListSchema = z.array(performanceSchema).max(1000)

export const performanceLinkSchema = z.object({
  linkId: uuid,
  fanReportId: uuid,
  performanceId: uuid,
  performanceRef: boundedText(128),
  performanceRevision: z.number().int().min(1),
  linkRevision: z.number().int().min(1),
  status: z.enum(linkStatuses),
  createdAt: utcDateTime,
  endedAt: utcDateTime.nullable(),
})

export const performanceLinkHistorySchema = z.object({ items: z.array(performanceLinkSchema).max(1000) })

export const candidateRunSchema = z.object({
  runId: uuid,
  analysisId: uuid,
  fanReportId: uuid,
  evidenceId: uuid,
  status: z.enum(candidateStatuses),
  reason: z.enum(candidateReasons),
  candidateCount: z.number().int().nonnegative().nullable(),
  candidateId: uuid.nullable(),
  performanceLinkId: uuid.nullable(),
  performanceLinkRevision: z.number().int().nullable(),
  verifiedPerformanceId: uuid.nullable(),
  verifiedPerformanceRevision: z.number().int().nullable(),
  reservationBatchId: uuid.nullable(),
  reservationSourceVersion: z.string().max(128).nullable(),
  evidenceSha256: sha256Hex.nullable(),
  analysisResponseSha256: sha256Hex.nullable(),
  analysisRowVersion: z.number().int().nullable(),
  applicability: z.enum(applicabilities),
  createdAt: utcDateTime,
  completedAt: utcDateTime.nullable(),
})

export const candidateRunPageSchema = z.object({
  items: z.array(candidateRunSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export type VerifiedPerformance = z.infer<typeof performanceSchema>
export type PerformanceLink = z.infer<typeof performanceLinkSchema>
export type CandidateRun = z.infer<typeof candidateRunSchema>

export function performancesPath(eventId: string) {
  return `/api/v1/admin/events/${eventId}/verified-performances`
}

export function performancePath(eventId: string, performanceId: string) {
  return `/api/v1/admin/events/${eventId}/verified-performances/${performanceId}`
}

export function performanceWithdrawPath(eventId: string, performanceId: string) {
  return `/api/v1/admin/events/${eventId}/verified-performances/${performanceId}/withdrawals`
}

export function performanceLinkPath(fanReportId: string) {
  return `/api/v1/admin/fan-reports/${fanReportId}/performance-link`
}

export function performanceLinkWithdrawPath(fanReportId: string) {
  return `/api/v1/admin/fan-reports/${fanReportId}/performance-link/withdrawals`
}

/** 후보 실행 POST 경로. 이력 조회와 같은 자원이며 요청 본문 없이 서버가 돌려준 제보, 증거, 분석 ID만 쓴다. */
export function candidateMatchesPath(fanReportId: string, evidenceId: string, analysisId: string) {
  return `/api/v1/admin/fan-reports/${fanReportId}/evidence/${evidenceId}/listing-analyses/${analysisId}/candidate-matches`
}

export function candidateHistoryPath(fanReportId: string, evidenceId: string, analysisId: string, page: number) {
  return adminApiPath(candidateMatchesPath(fanReportId, evidenceId, analysisId), { page, pageSize: candidateRunPageSize })
}

// ---------- 요청 본문 ----------

type Built<T> = { ok: true; body: T } | { ok: false; errors: Record<string, string> }

/** 서버 bounded 규칙과 같다. 앞뒤 공백을 뺀 값이 비어 있지 않고 max자 이하여야 한다. */
function bounded(value: string, max: number) {
  const trimmed = value.trim()
  if (trimmed.length === 0) return { value: trimmed, error: '내용을 입력해 주세요.' }
  if (trimmed.length > max) return { value: trimmed, error: `${max}자 이하로 입력해 주세요.` }
  return { value: trimmed, error: null }
}

function collect<T>(fields: Record<string, { value: string; error: string | null }>, body: () => T): Built<T> {
  const errors = Object.fromEntries(Object.entries(fields).filter(([, field]) => field.error !== null).map(([name, field]) => [name, field.error as string]))
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, body: body() }
}

export type CreatePerformanceBody = { performanceRef: string; verificationBasis: string; sourceVersion: string }
export type RevisePerformanceBody = { verificationBasis: string; sourceVersion: string; expectedRevision: number }
export type WithdrawPerformanceBody = { reason: string; expectedRevision: number }
export type LinkBody = { performanceId: string; expectedLinkRevision: number; reason: string }
export type WithdrawLinkBody = { expectedLinkRevision: number; reason: string }

export function buildCreatePerformance(input: CreatePerformanceBody): Built<CreatePerformanceBody> {
  const fields = { performanceRef: bounded(input.performanceRef, 128), verificationBasis: bounded(input.verificationBasis, 512), sourceVersion: bounded(input.sourceVersion, 128) }
  return collect(fields, () => ({ performanceRef: fields.performanceRef.value, verificationBasis: fields.verificationBasis.value, sourceVersion: fields.sourceVersion.value }))
}

/** 수정은 화면에 표시된 revision을 expectedRevision으로 보낸다. 검증 근거는 조회 응답에 없으므로 다시 입력해야 한다. */
export function buildRevisePerformance(performance: VerifiedPerformance, input: { verificationBasis: string; sourceVersion: string }): Built<RevisePerformanceBody> {
  const fields = { verificationBasis: bounded(input.verificationBasis, 512), sourceVersion: bounded(input.sourceVersion, 128) }
  return collect(fields, () => ({ verificationBasis: fields.verificationBasis.value, sourceVersion: fields.sourceVersion.value, expectedRevision: performance.revision }))
}

export function buildWithdrawPerformance(performance: VerifiedPerformance, reason: string): Built<WithdrawPerformanceBody> {
  const fields = { reason: bounded(reason, 512) }
  return collect(fields, () => ({ reason: fields.reason.value, expectedRevision: performance.revision }))
}

/** 현재 활성 연결의 linkRevision을 expectedLinkRevision으로 보낸다. 활성 연결이 없으면 0이다. */
export function buildLink(active: PerformanceLink | null, performanceId: string, reason: string): Built<LinkBody> {
  const fields = { performanceId: { value: performanceId, error: isUuid(performanceId) ? null : '연결할 검증 회차를 선택해 주세요.' }, reason: bounded(reason, 512) }
  return collect(fields, () => ({ performanceId: performanceId.toLowerCase(), expectedLinkRevision: active?.linkRevision ?? 0, reason: fields.reason.value }))
}

export function buildWithdrawLink(active: PerformanceLink, reason: string): Built<WithdrawLinkBody> {
  const fields = { reason: bounded(reason, 512) }
  return collect(fields, () => ({ expectedLinkRevision: active.linkRevision, reason: fields.reason.value }))
}

export function activeLink(items: PerformanceLink[]) {
  return items.find((item) => item.status === 'ACTIVE') ?? null
}

// ---------- 표시 문구 ----------

export const performanceStatusLabels: Record<VerifiedPerformance['status'], string> = { ACTIVE: '검증됨 (ACTIVE)', WITHDRAWN: '철회됨 (WITHDRAWN)' }
export const linkStatusLabels: Record<PerformanceLink['status'], string> = { ACTIVE: '현재 연결 (ACTIVE)', REPLACED: '교체됨 (REPLACED)', WITHDRAWN: '철회됨 (WITHDRAWN)' }

export const candidateStatusLabels: Record<CandidateStatus, string> = {
  IN_PROGRESS: '대조 진행 중 (IN_PROGRESS)',
  MATCH_CANDIDATE: '단일 조사 후보 (MATCH_CANDIDATE)',
  NO_MATCH: '후보 없음 (NO_MATCH)',
  AMBIGUOUS: '복수 후보, 하나로 정하지 않음 (AMBIGUOUS)',
  UNVERIFIABLE: '대조 불가 (UNVERIFIABLE)',
  LOOKUP_FAILED: '조회 실패 (LOOKUP_FAILED)',
  ANALYSIS_FAILED: '분석 결과 사용 불가 (ANALYSIS_FAILED)',
}

export const candidateReasonLabels: Record<CandidateReason, string> = {
  LOOKUP_STARTED: '조회를 시작했고 아직 끝나지 않았습니다',
  MATCHED_SINGLE_CANDIDATE: '관찰한 구역, 열, 좌석과 같은 예매 후보가 하나 있습니다',
  NO_CANDIDATE_FOUND: '완전한 예매 스냅샷을 조회했지만 같은 좌석 후보가 없습니다',
  MULTIPLE_CANDIDATES: '같은 좌석 후보가 둘 이상이라 하나로 정하지 않았습니다',
  ANALYSIS_NOT_SUCCEEDED: '이미지 분석이 성공하지 않아 대조하지 않았습니다',
  PERFORMANCE_LINK_UNVERIFIED: '제보에 사람이 확인한 회차 연결이 없습니다',
  PERFORMANCE_WITHDRAWN: '연결된 검증 회차가 철회되었습니다',
  PERFORMANCE_REVISION_CHANGED: '연결 이후 검증 회차의 revision이 바뀌었습니다',
  RESERVATION_SOURCE_INCOMPLETE: '예매 출처가 완전한 스냅샷이 아닙니다',
  RESERVATION_SOURCE_UNAVAILABLE: '이 회차의 예매 출처가 없습니다',
  SEAT_OBSERVATION_UNAVAILABLE: '구역, 열, 좌석 관찰값이 모두 확인되지 않았습니다',
  SEAT_OBSERVATION_AMBIGUOUS: '좌석 관찰값이 하나로 해석되지 않습니다',
  ANALYSIS_OR_EVIDENCE_CHANGED: '분석 결과나 증거 원본이 실행 이후 바뀌었습니다',
  RESERVATION_LOOKUP_FAILED: '예매 후보 조회가 실패했습니다',
}

export const applicabilityLabels: Record<Applicability, string> = {
  CURRENT: '현재 기준에 적용됨 (CURRENT)',
  PERFORMANCE_LINK_REPLACED_OR_WITHDRAWN: '회차 연결이 교체 또는 철회됨',
  PERFORMANCE_WITHDRAWN: '검증 회차가 철회됨',
  PERFORMANCE_REVISION_CHANGED: '검증 회차 revision이 바뀜',
  RESERVATION_SOURCE_SUPERSEDED: '예매 출처가 새 스냅샷으로 교체됨',
  ANALYSIS_OR_EVIDENCE_CHANGED: '분석 또는 증거가 바뀜',
  NOT_APPLICABLE: '적용 대상 아님 (NOT_APPLICABLE)',
}

export function candidateTone(status: CandidateStatus) {
  if (status === 'MATCH_CANDIDATE') return 'info' as const
  if (status === 'NO_MATCH' || status === 'IN_PROGRESS') return 'neutral' as const
  if (status === 'LOOKUP_FAILED' || status === 'ANALYSIS_FAILED') return 'critical' as const
  return 'warning' as const
}

const notApplied = '요청이 반영되지 않았습니다.'
const scopeHidden = '존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다.'
const manageOnly = (action: string): WorkflowMessage => ({ title: `${action}에 필요한 역할이 없습니다`, description: `검증 회차와 회차 연결은 검토 담당(REVIEWER) 또는 고객사 관리자(TENANT_ADMIN)만 다룰 수 있어 서버가 거부했습니다. ${notApplied}` })

const performanceCodes: Record<string, WorkflowMessage> = {
  PERFORMANCE_REF_CONFLICT: { title: '같은 회차 식별자가 이미 있습니다', description: `이 공연에 같은 performanceRef의 검증 회차가 있습니다. 목록을 다시 불러왔으니 기존 회차를 확인해 주세요. ${notApplied}` },
  PERFORMANCE_REVISION_CONFLICT: { title: '다른 변경이 먼저 반영되었습니다', description: `화면의 revision이 서버와 다릅니다. 목록을 다시 불러왔으니 최신 revision을 확인한 뒤 다시 요청해 주세요. ${notApplied}` },
  PERFORMANCE_WITHDRAWN: { title: '이미 철회된 검증 회차입니다', description: `철회된 회차는 수정, 철회, 연결할 수 없습니다. ${notApplied}` },
}

export const performanceWriteMessages: OperationMessages = {
  forbidden: manageOnly('검증 회차 변경'),
  notFound: { title: '공연이나 검증 회차를 찾을 수 없거나 접근 범위 밖입니다', description: `${scopeHidden} ${notApplied}` },
  codes: performanceCodes,
}

/** 회차 쓰기는 멱등성 키가 없어 같은 요청 재확인을 제공하지 않는다. 서버 목록의 현재 상태로 이 요청의 성공을 확정하지 않는다. */
export const performanceUncertain: WorkflowMessage = {
  title: '회차 변경 결과를 확인하지 못했습니다',
  description: '이 요청은 서버에서 처리되었을 수도 있습니다. 회차 쓰기 API에는 요청 키가 없어 같은 요청 재확인을 할 수 없습니다. 서버 목록을 다시 불러왔지만 현재 목록 상태만으로 이 요청의 성공 여부를 확정하지 않습니다. 목록을 확인한 뒤 필요할 때만 새 요청을 보내 주세요.',
}

const linkCodes: Record<string, WorkflowMessage> = {
  PERFORMANCE_LINK_REVISION_CONFLICT: { title: '회차 연결이 먼저 변경되었습니다', description: `화면이 알던 연결 revision과 서버가 다릅니다. 연결 이력을 다시 불러왔습니다. 이전에 보낸 요청이 반영되었는지는 이 응답으로 추정하지 않으니 이력을 확인해 주세요. ${notApplied}` },
  PERFORMANCE_LINK_ALREADY_CURRENT: { title: '이미 같은 회차와 revision으로 연결되어 있습니다', description: `새 연결을 만들지 않았습니다. 연결 이력을 다시 불러왔습니다.` },
  PERFORMANCE_WITHDRAWN: { title: '철회된 검증 회차는 연결할 수 없습니다', description: `현재 검증된(ACTIVE) 회차만 연결할 수 있습니다. ${notApplied}` },
}

const linkConcurrent: WorkflowMessage = {
  title: '같은 제보의 회차 연결이 동시에 변경되고 있습니다',
  description: '다른 변경이 끝난 뒤 같은 요청 재확인을 눌러 주세요. 같은 요청 키와 같은 내용을 다시 보내며, 이미 기록된 요청이면 서버가 그 결과를 돌려줍니다.',
}

export const linkMessages: OperationMessages = {
  forbidden: manageOnly('회차 연결'),
  notFound: { title: '제보나 검증 회차를 찾을 수 없거나 접근 범위 밖입니다', description: `${scopeHidden} ${notApplied}` },
  codes: linkCodes,
  uncertainCodes: { PERFORMANCE_LINK_CONCURRENT_UPDATE: linkConcurrent },
}

export const withdrawLinkMessages: OperationMessages = {
  forbidden: manageOnly('회차 연결 철회'),
  notFound: { title: '제보를 찾을 수 없거나 접근 범위 밖입니다', description: `${scopeHidden} ${notApplied}` },
  codes: linkCodes,
  uncertainCodes: { PERFORMANCE_LINK_CONCURRENT_UPDATE: linkConcurrent },
}
