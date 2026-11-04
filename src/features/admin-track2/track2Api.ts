import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

// Backend admin-fan-report-read-v1과 track2-listing-analysis-v1 계약의 조회 응답 모델이다.
// 합성 데모 모델(track2Model)과 섞지 않으며, 서버에 없는 검토 상태, 추출 ID, 대조 ID, 예매 ID를 만들지 않는다.
// 접수 상태(intakeStatus), 분석 실행 상태(executionStatus), 분석 결과 상태(analysisStatus), 필드 관찰 상태(state),
// 예매 후보 대조 연결 상태(candidateMatch)는 서로 다른 값이며 하나의 성공 또는 실패 값으로 합치지 않는다.

export const fanReportPageSize = 20
export const listingAnalysisPageSize = 20

export const intakeStatuses = ['PENDING_STORAGE', 'RECEIVED', 'STORAGE_FAILED', 'ANALYSIS_PENDING', 'ANALYSIS_FAILED', 'UNVERIFIABLE'] as const
export type IntakeStatus = (typeof intakeStatuses)[number]
const reportTypes = ['PREMIUM_RESALE', 'AUTOMATION_OFFER', 'FAKE_TICKET', 'OTHER'] as const
const storageStatuses = ['PENDING', 'STORED', 'FAILED'] as const
const executionStatuses = ['IN_PROGRESS', 'SUCCEEDED', 'INPUT_REJECTED', 'STORAGE_FAILED', 'ANALYZER_FAILED', 'ABANDONED'] as const
const analysisStatuses = ['COMPLETED', 'PARTIAL', 'UNVERIFIABLE', 'FAILED'] as const
const fieldStates = ['FOUND', 'UNKNOWN', 'AMBIGUOUS'] as const
const unknownReasons = ['ABSENT', 'UNREADABLE', 'NOT_CONFIRMED'] as const
const candidateMatchReasons = ['PERFORMANCE_REF_UNVERIFIED', 'SEAT_NOT_FOUND', 'MATCH_SCORE_UNAVAILABLE', 'ANALYSIS_NOT_SUCCEEDED'] as const
export const listingFieldNames = ['eventName', 'performanceAt', 'platformDisplayName', 'askingPrice', 'currency', 'saleText', 'zone', 'row', 'seat'] as const
export type ListingFieldName = (typeof listingFieldNames)[number]

const sha256Pattern = /^[0-9a-f]{64}$/
// 접수 API는 OffsetDateTime(오프셋 포함), 분석 이력 API는 LocalDateTime(오프셋 없음, 계약상 UTC)으로 직렬화한다.
const offsetDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
const utcDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/

function toInstant(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
}

const offsetDateTime = z.string().refine((value) => offsetDateTimePattern.test(value) && !Number.isNaN(Date.parse(value)))
const utcDateTime = z.string().refine((value) => utcDateTimePattern.test(value) && !Number.isNaN(Date.parse(toInstant(value))))
const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())

const eventSchema = z.object({ id: uuid, externalEventId: z.string(), name: z.string().min(1) })

const summarySchema = z.object({
  fanReportId: uuid,
  reportType: z.enum(reportTypes),
  intakeStatus: z.enum(intakeStatuses),
  receivedAt: offsetDateTime,
  submittedPerformanceAt: offsetDateTime,
  evidenceCount: z.number().int().nonnegative(),
  storedEvidenceCount: z.number().int().nonnegative(),
}).refine((item) => item.storedEvidenceCount <= item.evidenceCount)

export const fanReportPageSchema = z.object({
  event: eventSchema,
  items: z.array(summarySchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  totalItems: z.number().int().nonnegative(),
  hasNext: z.boolean(),
})

// originalStored가 true일 때만 저장 완료와 SHA-256이 함께 있어야 한다. 그 외 조합은 정상 원본으로 볼 수 없으므로 계약 위반으로 처리한다.
const evidenceSchema = z.object({
  evidenceId: uuid,
  mediaType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  storageStatus: z.enum(storageStatuses),
  originalStored: z.boolean(),
  sha256: z.string().regex(sha256Pattern).nullable(),
  createdAt: offsetDateTime,
}).refine((item) => item.originalStored
  ? item.storageStatus === 'STORED' && item.sha256 !== null
  : item.sha256 === null)

export const fanReportDetailSchema = z.object({
  fanReportId: uuid,
  event: eventSchema,
  reportType: z.enum(reportTypes),
  intakeStatus: z.enum(intakeStatuses),
  receivedAt: offsetDateTime,
  retentionUntil: offsetDateTime,
  submittedPerformanceAt: offsetDateTime,
  seatArea: z.string().nullable(),
  description: z.string(),
  listingUrl: z.string().nullable(),
  platform: z.string().nullable(),
  seller: z.string().nullable(),
  askingPrice: z.number().nonnegative().nullable(),
  evidence: z.array(evidenceSchema),
}).refine((detail) => new Set(detail.evidence.map((item) => item.evidenceId)).size === detail.evidence.length)

const priceSchema = z.object({
  raw: z.string().max(64),
  amount: z.string().regex(/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/),
})

const fieldSchema = z.object({
  state: z.enum(fieldStates),
  value: z.union([z.string().max(256), priceSchema]).nullable(),
  evidenceQuote: z.string().max(512).nullable(),
  unknownReason: z.enum(unknownReasons).nullable(),
  candidates: z.array(z.string().max(128)).max(3),
})

// FOUND일 때만 관찰값이 있다. askingPrice는 Price 객체, 나머지 필드는 문자열이다. UNKNOWN과 AMBIGUOUS에 값이 있으면 계약 위반이다.
function isValidField(name: ListingFieldName, field: z.infer<typeof fieldSchema>) {
  if (field.state !== 'FOUND') return field.value === null
  if (field.value === null) return false
  return name === 'askingPrice' ? typeof field.value === 'object' : typeof field.value === 'string'
}

const fieldsSchema = z.object(Object.fromEntries(listingFieldNames.map((name) => [name, fieldSchema])) as Record<ListingFieldName, typeof fieldSchema>)
  .refine((fields) => listingFieldNames.every((name) => isValidField(name, fields[name])))

const inputSchema = z.object({
  expectedSha256: z.string().regex(sha256Pattern),
  verifiedSha256: z.string().regex(sha256Pattern).nullable(),
  expectedByteSize: z.number().int().min(1),
  verifiedByteSize: z.number().int().nonnegative().nullable(),
  mediaType: z.string(),
})

const candidateMatchSchema = z.object({ status: z.literal('NOT_LINKED'), reason: z.enum(candidateMatchReasons) }).nullable()

// 실행 상태와 결과 상태의 조합을 계약대로 확인한다.
// SUCCEEDED는 COMPLETED, PARTIAL, UNVERIFIABLE 중 하나와 9개 필드를 가진다. IN_PROGRESS는 결과가 없다.
// 그 외 종료 상태는 항상 FAILED이고 fields가 null이다. 실패 이력을 정상 빈 추출로 바꾸지 않기 위해서다.
export const listingAnalysisSchema = z.object({
  analysisId: uuid,
  fanReportId: uuid,
  evidenceId: uuid,
  requestId: uuid,
  executionStatus: z.enum(executionStatuses),
  analysisStatus: z.enum(analysisStatuses).nullable(),
  errorCode: z.string().nullable(),
  analyzerHttpStatus: z.number().int().nullable(),
  analyzerErrorCode: z.string().nullable(),
  input: inputSchema,
  modelName: z.string().max(128).nullable(),
  modelVersion: z.string().max(128).nullable(),
  analyzedAt: utcDateTime.nullable(),
  reviewRequired: z.boolean().nullable(),
  fields: fieldsSchema.nullable(),
  candidateMatch: candidateMatchSchema,
  createdAt: utcDateTime,
  completedAt: utcDateTime.nullable(),
}).refine((item) => {
  if (item.executionStatus === 'SUCCEEDED') return item.analysisStatus !== null && item.analysisStatus !== 'FAILED' && item.fields !== null
  if (item.executionStatus === 'IN_PROGRESS') return item.analysisStatus === null && item.fields === null
  return item.analysisStatus === 'FAILED' && item.fields === null
})

export const listingAnalysisPageSchema = z.object({
  items: z.array(listingAnalysisSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export type FanReportSummary = z.infer<typeof summarySchema>
export type FanReportPage = z.infer<typeof fanReportPageSchema>
export type FanReportDetail = z.infer<typeof fanReportDetailSchema>
export type FanReportEvidence = FanReportDetail['evidence'][number]
export type ListingAnalysis = z.infer<typeof listingAnalysisSchema>
export type ListingField = z.infer<typeof fieldSchema>

export function fanReportListPath(eventId: string, page: number, intakeStatus: IntakeStatus | null) {
  const params: Record<string, string | number> = { eventId, page, pageSize: fanReportPageSize }
  if (intakeStatus) params.intakeStatus = intakeStatus
  return adminApiPath('/api/v1/admin/fan-reports', params)
}

export function fanReportDetailPath(fanReportId: string) {
  return `/api/v1/admin/fan-reports/${fanReportId}`
}

export function listingAnalysesPath(fanReportId: string, evidenceId: string, page: number) {
  return adminApiPath(`/api/v1/admin/fan-reports/${fanReportId}/evidence/${evidenceId}/listing-analyses`, { page, pageSize: listingAnalysisPageSize })
}

/** 분석 실행 POST 경로. 이력 조회와 같은 자원이며 쿼리와 요청 본문 없이 제보와 증거 ID만 쓴다. */
export function listingAnalysisRunPath(fanReportId: string, evidenceId: string) {
  return `/api/v1/admin/fan-reports/${fanReportId}/evidence/${evidenceId}/listing-analyses`
}

/** 관리자 증거 원본 이미지 경로. 저장소 주소, 객체 키, 사전 서명 URL이 아닌 Backend 프록시 API만 사용한다. */
export function evidenceContentPath(fanReportId: string, evidenceId: string) {
  return `/api/v1/admin/fan-reports/${fanReportId}/evidence/${evidenceId}/content`
}

export function fanReportListRoute(eventId: string) {
  return `/app/fan-reports?${new URLSearchParams({ eventId })}`
}

export function fanReportDetailRoute(fanReportId: string) {
  return `/app/fan-reports/${fanReportId}`
}

/** 주소의 제보 ID가 UUID일 때만 소문자로 반환한다. 형식이 다르면 API를 호출하지 않는다. */
export function readFanReportId(value: string | undefined) {
  return value !== undefined && isUuid(value) ? value.toLowerCase() : null
}

export function readPageParam(value: string | null) {
  return value !== null && /^(0|[1-9][0-9]{0,6})$/.test(value) ? Number(value) : 0
}

/** 서버가 지원하는 접수 상태 값만 필터로 사용한다. 알 수 없는 값은 필터 없이 조회한다. */
export function readIntakeStatusParam(value: string | null): IntakeStatus | null {
  return intakeStatuses.find((status) => status === value) ?? null
}

export function formatUtc(value: string) {
  return `${new Date(toInstant(value)).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`
}

const problemCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/

/** 서버 분류 코드만 표시한다. 코드 형식이 아닌 문자열은 내부 메시지일 수 있으므로 화면에 쓰지 않는다. */
export function formatCode(value: string | null) {
  if (value === null) return '기록 없음'
  return problemCodePattern.test(value) ? value : '형식을 확인할 수 없는 코드'
}

export const intakeStatusLabels: Record<IntakeStatus, string> = {
  PENDING_STORAGE: '증거 저장 확인 중',
  RECEIVED: '접수됨',
  STORAGE_FAILED: '증거 저장 실패',
  ANALYSIS_PENDING: '분석 대기',
  ANALYSIS_FAILED: '분석 실패 기록',
  UNVERIFIABLE: '확인 불가 기록',
}

/** 접수 상태 표시 색. 저장 실패 계열만 위험 색을 쓰며 어떤 값도 부정 거래 판정을 뜻하지 않는다. */
export function intakeTone(status: IntakeStatus) {
  if (status === 'RECEIVED') return 'info' as const
  if (status === 'STORAGE_FAILED' || status === 'ANALYSIS_FAILED') return 'critical' as const
  return 'warning' as const
}

export const storageStatusLabels:Record<FanReportEvidence['storageStatus'], string> = {
  PENDING: '저장 확인 중', STORED: '저장 완료', FAILED: '저장 실패',
}

export const executionStatusLabels: Record<ListingAnalysis['executionStatus'], string> = {
  IN_PROGRESS: '실행 중',
  SUCCEEDED: '실행 완료',
  INPUT_REJECTED: '입력 검증 실패',
  STORAGE_FAILED: '원본 읽기 실패',
  ANALYZER_FAILED: '분석 서버 실패',
  ABANDONED: '시간 초과로 종료',
}

export const analysisStatusLabels: Record<NonNullable<ListingAnalysis['analysisStatus']>, string> = {
  COMPLETED: '관찰 완료', PARTIAL: '일부만 관찰', UNVERIFIABLE: '확인 불가', FAILED: '분석 실패',
}

export const fieldStateLabels: Record<ListingField['state'], string> = {
  FOUND: '관찰 후보', UNKNOWN: '확인 안 됨', AMBIGUOUS: '해석 불명확',
}

export const unknownReasonLabels: Record<NonNullable<ListingField['unknownReason']>, string> = {
  ABSENT: '이미지에 표시 없음', UNREADABLE: '읽기 어려움', NOT_CONFIRMED: '확인되지 않음',
}

export const candidateMatchReasonLabels: Record<(typeof candidateMatchReasons)[number], string> = {
  PERFORMANCE_REF_UNVERIFIED: '검증된 회차 정보가 없습니다',
  SEAT_NOT_FOUND: '좌석 정보가 관찰되지 않았습니다',
  MATCH_SCORE_UNAVAILABLE: '분석 결과가 일치 신뢰도를 제공하지 않습니다',
  ANALYSIS_NOT_SUCCEEDED: '분석이 성공하지 않았습니다',
}

export const listingFieldLabels: Record<ListingFieldName, string> = {
  eventName: '공연명',
  performanceAt: '공연 일시',
  platformDisplayName: '판매 플랫폼 표시',
  askingPrice: '판매 가격',
  currency: '통화',
  saleText: '판매 문구',
  zone: '구역',
  row: '열',
  seat: '좌석',
}
