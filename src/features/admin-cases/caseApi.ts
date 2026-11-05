import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

// Backend CaseController와 CaseDto(View, Page, Source, Activity, Activities) 조회 계약의 응답 모델이다.
// 합성 데모 모델(caseModel)과 섞지 않으며, 서버에 없는 담당자 이름, 우선순위 점수, 요약, 전체 건수를 만들지 않는다.
// 목록은 createdAt 내림차순, 활동 이력은 occurredAt 오름차순으로 서버가 정렬하며 화면에서 다시 정렬하지 않는다.
// caseVersion은 Case가 변경될 때마다 오르는 서버 버전, evidenceRevision은 EvidenceSnapshot과 승인 요청이 참조하는 증거 구성 번호로 서로 다른 값이다.

export const casePageSize = 20
export const caseActivityPageSize = 20

export const caseStatuses = ['OPEN', 'TRIAGED', 'IN_REVIEW', 'NEEDS_EVIDENCE', 'READY_FOR_APPROVAL', 'APPROVED_FOR_REPORT', 'DISMISSED', 'CLOSED'] as const
export type CaseStatus = (typeof caseStatuses)[number]
export const caseTypes = ['GRAPH_CLUSTER', 'FAN_REPORT', 'COMBINED'] as const
export type CaseType = (typeof caseTypes)[number]

// CaseDto의 시각은 OffsetDateTime(UTC 오프셋 포함)으로 직렬화된다.
const offsetDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const codePattern = /^[A-Z][A-Z0-9_]{0,63}$/

export const offsetDateTime = z.string().refine((value) => offsetDateTimePattern.test(value) && !Number.isNaN(Date.parse(value)))
export const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
export const version = z.number().int().nonnegative()
// 활동 유형과 역할은 서버 문자열이다. 코드 형식이 아닌 값은 내부 메시지일 수 있으므로 계약 위반으로 처리한다.
const code = z.string().regex(codePattern)

export const caseViewSchema = z.object({
  caseId: uuid,
  eventId: uuid,
  type: z.enum(caseTypes),
  status: z.enum(caseStatuses),
  caseVersion: version,
  evidenceRevision: version,
  createdByMembershipId: uuid,
  assigneeMembershipId: uuid.nullable(),
  relatedCaseId: uuid.nullable(),
  relationReason: z.string().nullable(),
  classification: z.string().nullable(),
  currentReportVersionId: uuid.nullable(),
  createdAt: offsetDateTime,
  updatedAt: offsetDateTime,
}).refine((item) => (item.relatedCaseId === null) === (item.relationReason === null))
  .refine((item) => Date.parse(item.createdAt) <= Date.parse(item.updatedAt))

export const casePageSchema = z.object({
  items: z.array(caseViewSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

// 출처 응답은 한 레코드에 모든 유형의 필드를 담는다. 유형별로 채워져야 할 필드와 비어 있어야 할 필드를 함께 검사한다.
const sourceBase = {
  sourceReferenceId: uuid,
  analysisRequestId: z.string().min(1).nullable(),
  clusterId: z.string().min(1).nullable(),
  storedMemberCount: z.number().int().nonnegative().nullable(),
  analysisAlgorithm: z.string().nullable(),
  analysisAlgorithmVersion: z.string().nullable(),
  analysisCompletedAt: offsetDateTime.nullable(),
  // Track 1 군집 목록과 같은 0~1 조사 우선순위 신호다. 불법 확률이 아니다.
  riskScore: z.number().min(0).max(1).nullable(),
  fanReportId: uuid.nullable(),
  evidenceId: uuid.nullable(),
  linkedAt: offsetDateTime,
}

const clusterFieldsEmpty = (item: { analysisRequestId: unknown; clusterId: unknown; storedMemberCount: unknown; analysisAlgorithm: unknown; analysisAlgorithmVersion: unknown; analysisCompletedAt: unknown; riskScore: unknown }) =>
  item.analysisRequestId === null && item.clusterId === null && item.storedMemberCount === null && item.analysisAlgorithm === null
  && item.analysisAlgorithmVersion === null && item.analysisCompletedAt === null && item.riskScore === null

const clusterSourceSchema = z.object({ ...sourceBase, sourceType: z.literal('STORED_CLUSTER_EVIDENCE') })
  .refine((item) => item.analysisRequestId !== null && item.clusterId !== null && item.storedMemberCount !== null && item.fanReportId === null && item.evidenceId === null)
const reportSourceSchema = z.object({ ...sourceBase, sourceType: z.literal('FAN_REPORT') })
  .refine((item) => item.fanReportId !== null && item.evidenceId === null && clusterFieldsEmpty(item))
const assetSourceSchema = z.object({ ...sourceBase, sourceType: z.literal('EVIDENCE_ASSET') })
  .refine((item) => item.fanReportId !== null && item.evidenceId !== null && clusterFieldsEmpty(item))

// Track 2 후보 실행 출처다. 연결 시점의 실행 상태와 사유를 그대로 보존한 값이며 부정 거래 확정이나 승인 근거가 아니다.
// candidateApplicability는 조회 시점에 서버가 다시 계산한 값이다. candidateId는 불투명한 내부 참조이며 예매번호나 HMAC 값이 아니다.
const candidateSourceSchema = z.object({
  ...sourceBase,
  sourceType: z.literal('LISTING_CANDIDATE_MATCH'),
  candidateRunId: uuid.nullable(),
  candidateStatus: z.string().min(1).nullable(),
  candidateReason: z.string().min(1).nullable(),
  candidateCount: z.number().int().nonnegative().nullable(),
  candidateId: uuid.nullable(),
  candidateApplicability: z.string().min(1).nullable(),
}).refine((item) => item.fanReportId !== null && item.evidenceId !== null && item.candidateRunId !== null && clusterFieldsEmpty(item))

export const caseSourceListSchema = z.array(z.union([clusterSourceSchema, reportSourceSchema, assetSourceSchema, candidateSourceSchema]))

const activitySchema = z.object({
  activityId: uuid,
  eventType: code,
  actorMembershipId: uuid,
  actorRole: code,
  reason: z.string(),
  fromStatus: z.enum(caseStatuses).nullable(),
  toStatus: z.enum(caseStatuses).nullable(),
  versionBefore: version.nullable(),
  versionAfter: version,
  evidenceRevision: version,
  sourceReferenceId: uuid.nullable(),
  previousAssigneeMembershipId: uuid.nullable(),
  newAssigneeMembershipId: uuid.nullable(),
  occurredAt: offsetDateTime,
})

export const caseActivityPageSchema = z.object({
  items: z.array(activitySchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export type CaseView = z.infer<typeof caseViewSchema>
export type CaseSource = z.infer<typeof caseSourceListSchema>[number]
export type CaseActivity = z.infer<typeof activitySchema>

export function caseListPath(eventId: string, page: number, status: CaseStatus | null) {
  const params: Record<string, string | number> = { eventId, page, pageSize: casePageSize }
  if (status) params.status = status
  return adminApiPath('/api/v1/cases', params)
}

export function caseDetailPath(caseId: string) {
  return `/api/v1/cases/${caseId}`
}

export function caseSourcesPath(caseId: string) {
  return `/api/v1/cases/${caseId}/sources`
}

export function caseActivitiesPath(caseId: string, page: number) {
  return adminApiPath(`/api/v1/cases/${caseId}/activities`, { page, pageSize: caseActivityPageSize })
}

export function caseListRoute(eventId: string) {
  return `/app/cases?${new URLSearchParams({ eventId })}`
}

/** 상세 주소에 공연을 함께 남겨 목록으로 돌아갈 때와 응답 공연 확인에 사용한다. */
export function caseDetailRoute(caseId: string, eventId: string) {
  return `/app/cases/${caseId}?${new URLSearchParams({ eventId })}`
}

/** 주소의 Case ID가 UUID일 때만 소문자로 반환한다. 형식이 다르면 API를 호출하지 않는다. */
export function readCaseId(value: string | undefined) {
  return value !== undefined && isUuid(value) ? value.toLowerCase() : null
}

/** 서버가 지원하는 상태 값만 필터로 사용한다. 알 수 없는 값은 필터 없이 조회한다. */
export function readCaseStatusParam(value: string | null): CaseStatus | null {
  return caseStatuses.find((status) => status === value) ?? null
}

export const caseTypeLabels: Record<CaseType, string> = { GRAPH_CLUSTER: '연관 예매', FAN_REPORT: '팬 제보', COMBINED: '복합 검토' }

// 서버 활동 유형의 표시 문구다. 목록에 없는 유형은 코드를 그대로 보여 주며 임의 의미를 붙이지 않는다.
export const activityTypeLabels: Record<string, string> = {
  CASE_OPENED: 'Case 생성',
  FOLLOW_UP_CASE_OPENED: '후속 Case 생성',
  CASE_SOURCE_LINKED: '출처 연결',
  CASE_TRIAGED: '분류 완료 처리',
  CASE_REVIEW_STARTED: '검토 시작',
  CASE_EVIDENCE_REQUESTED: '추가 자료 필요 처리',
  CASE_REVIEW_RESUMED: '검토 재개',
  CASE_DISMISSED: '종결 검토 처리',
  CASE_ASSIGNEE_CHANGED: '담당자 변경',
  EVIDENCE_BYTES_CHECKED: '증거 바이트 확인',
  EVIDENCE_PRESERVATION_VERIFIED: '증거 보존 확인',
  EVIDENCE_SNAPSHOT_CAPTURED: 'EvidenceSnapshot 생성',
  REPORT_DRAFT_CREATED: '보고서 초안 생성',
  APPROVAL_REQUESTED: '승인 요청',
  APPROVAL_DECIDED: '승인 결정 기록',
  APPROVAL_WITHDRAWN: '승인 요청 철회',
  APPROVAL_INVALIDATED: '승인 요청 무효화',
  REVIEW_RECEIPT_ISSUED: '검토 확인 발급',
  REVIEW_RECEIPT_EXPIRED: '검토 확인 만료',
  REVIEW_RECEIPT_REVOKED: '검토 확인 취소',
}

export const actorRoleLabels: Record<string, string> = {
  TENANT_ADMIN: '고객사 관리자', ANALYST: '분석 담당', REVIEWER: '검토 담당', APPROVER: '승인 담당', SYSTEM: '시스템',
}
