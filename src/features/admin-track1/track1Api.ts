import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

// Backend track1-admin-evidence-read-v1 계약이다. 응답은 저장된 증거만 담는 STORED_EVIDENCE_ONLY이며
// 계정 식별자, 예매참조, 그래프 간선, 결제/주소/기기/IP 신호 원문이나 HMAC 값은 제공하지 않으며 구성원은 auditId로만 식별한다.
// members[].ledgerSeat(track1-ledger-seat-read-v1)은 회차와 sourceVersion을 함께 보낸 조회에서만 채워지고 그 외에는 null이다.
// 상세의 relationship(capstone-demo-integration-v1)은 저장된 기기와 IP 신호의 공유 요약 수치만 담는다. 이전 서버 응답에는 없을 수 있다.

export const track1PageSize = 20
export const track1Sorts = ['priority-desc', 'priority-asc', 'recent'] as const
export type Track1Sort = (typeof track1Sorts)[number]

const eventSchema = z.object({
  id: z.string().refine(isUuid).transform((value) => value.toLowerCase()),
  externalEventId: z.string(),
  name: z.string().min(1),
})

// riskScore와 분석 메타데이터가 비어 있으면 0이나 임의 값으로 채우지 않고 "값 없음"으로 표시한다.
const summarySchema = z.object({
  analysisRequestId: z.string().min(1),
  clusterId: z.string().min(1),
  riskScore: z.number().min(0).max(1).nullable(),
  analysisAlgorithm: z.string().nullable(),
  analysisAlgorithmVersion: z.string().nullable(),
  analyzedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))).nullable(),
  storedMemberCount: z.number().int().nonnegative(),
})

export const ledgerSeatStatuses = ['FOUND', 'NOT_IN_LEDGER', 'LEDGER_UNAVAILABLE'] as const
export type LedgerSeatStatus = (typeof ledgerSeatStatuses)[number]

const ledgerSeatPart = z.string().max(128).nullable().optional()

/** 원장 좌석 상태와 값이다. Case 수렴 응답은 여기에 auditId가 더해진다. */
export const ledgerSeatSchema = z.object({
  status: z.enum(ledgerSeatStatuses),
  zone: ledgerSeatPart,
  row: ledgerSeatPart,
  seat: ledgerSeatPart,
})

export type LedgerSeat = z.infer<typeof ledgerSeatSchema>

const memberSchema = z.object({
  auditId: z.number().int(),
  ledgerSeat: ledgerSeatSchema.nullable().optional(),
})

export const ledgerSeatStatusLabels: Record<LedgerSeatStatus, string> = {
  FOUND: '원장 좌석 확인 (FOUND)',
  NOT_IN_LEDGER: '원장에 없음 (NOT_IN_LEDGER)',
  LEDGER_UNAVAILABLE: '원장 확인 불가 (LEDGER_UNAVAILABLE)',
}

export function ledgerSeatTone(status: LedgerSeatStatus) {
  if (status === 'FOUND') return 'info' as const
  return status === 'NOT_IN_LEDGER' ? 'neutral' as const : 'warning' as const
}

/** FOUND일 때만 서버가 준 좌석 값을 표시한다. 비어 있는 값을 다른 값으로 채우지 않는다. */
export function formatLedgerSeat(seat: LedgerSeat) {
  if (seat.status !== 'FOUND') return '좌석 정보 없음'
  return `구역 ${seat.zone ?? '기록 없음'}, 열 ${seat.row ?? '기록 없음'}, 좌석 ${seat.seat ?? '기록 없음'}`
}

const coverageSchema = z.literal('STORED_EVIDENCE_ONLY')

export const track1ClusterPageSchema = z.object({
  event: eventSchema,
  items: z.array(summarySchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  totalItems: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  coverage: coverageSchema,
})

export const sharedSignalTypes = ['DEVICE_ID_HASH', 'IP_HASH'] as const
export type SharedSignalType = (typeof sharedSignalTypes)[number]

// sharedMemberCount는 같은 저장 신호값을 가진 구성원 수(2 이상), verifiedConnectionCount는 신호별 비순서 구성원 쌍의 합이다.
// 전체 verifiedConnectionCount는 신호별 합계라 같은 두 예매가 여러 신호를 공유하면 중복으로 셀 수 있다.
const relationshipSchema = z.object({
  sharedSignals: z.array(z.object({
    type: z.enum(sharedSignalTypes),
    sharedMemberCount: z.number().int().min(2),
    verifiedConnectionCount: z.number().int().min(1),
  })).max(sharedSignalTypes.length),
  verifiedConnectionCount: z.number().int().nonnegative(),
  unavailableSignalTypes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).max(20),
  investigationPrioritySource: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  normalSharingNotice: z.string().min(1).max(500),
  memberCoverage: z.literal('STORED_CLUSTER_MEMBERS_ONLY'),
}).refine((value) => new Set(value.sharedSignals.map((signal) => signal.type)).size === value.sharedSignals.length)
  .refine((value) => value.sharedSignals.reduce((sum, signal) => sum + signal.verifiedConnectionCount, 0) === value.verifiedConnectionCount)

export const track1ClusterDetailSchema = z.object({
  event: eventSchema,
  cluster: summarySchema,
  members: z.array(memberSchema),
  relationship: relationshipSchema.optional(),
  coverage: coverageSchema,
})

export type Track1ClusterSummary = z.infer<typeof summarySchema>
export type Track1Relationship = z.infer<typeof relationshipSchema>
export type Track1ClusterPage = z.infer<typeof track1ClusterPageSchema>
export type Track1ClusterDetail = z.infer<typeof track1ClusterDetailSchema>
export type Track1ClusterKey = { eventId: string; analysisRequestId: string; clusterId: string }

export function track1ClusterListPath(eventId: string, page: number, sort: Track1Sort) {
  return adminApiPath('/api/v1/admin/track1/clusters', { eventId, page, pageSize: track1PageSize, sort })
}

export type LedgerSeatQuery = { performanceId: string; sourceVersion: string }

/** ledger를 주면 회차와 sourceVersion을 항상 함께 보낸다. 하나만 보내면 서버가 400으로 거부한다. */
export function track1ClusterDetailPath(key: Track1ClusterKey, ledger?: LedgerSeatQuery) {
  return adminApiPath('/api/v1/admin/track1/clusters/detail', { eventId: key.eventId, analysisRequestId: key.analysisRequestId, clusterId: key.clusterId, ...ledger })
}

/** 관리자 화면의 상세 주소. 슬래시가 포함될 수 있는 분석 ID를 경로가 아닌 쿼리로 전달한다. */
export function track1DetailRoute(key: Track1ClusterKey) {
  return `/app/analysis/findings/detail?${new URLSearchParams({ eventId: key.eventId, analysisRequestId: key.analysisRequestId, clusterId: key.clusterId })}`
}

export function track1ListRoute(eventId: string) {
  return `/app/analysis/findings?${new URLSearchParams({ eventId })}`
}

/** 상세 주소의 세 식별자를 검증한다. 하나라도 없거나 형식이 맞지 않으면 API를 호출하지 않는다. */
export function readTrack1ClusterKey(params: URLSearchParams): Track1ClusterKey | null {
  const eventId = params.get('eventId')?.trim() ?? ''
  const analysisRequestId = params.get('analysisRequestId') ?? ''
  const clusterId = params.get('clusterId') ?? ''
  if (!isUuid(eventId) || analysisRequestId.trim() === '' || clusterId.trim() === '') return null
  return { eventId: eventId.toLowerCase(), analysisRequestId, clusterId }
}

export function readTrack1Page(value: string | null) {
  return value !== null && /^(0|[1-9][0-9]{0,6})$/.test(value) ? Number(value) : 0
}

export function readTrack1Sort(value: string | null): Track1Sort {
  return track1Sorts.find((sort) => sort === value) ?? 'priority-desc'
}

/** Risk Score는 0~1 사이 조사 우선순위 신호다. 백분율이나 확률로 바꾸지 않는다. */
export function formatRiskScore(value: number | null) {
  return value === null ? '값 없음' : value.toFixed(2)
}

export function formatAnalyzedAt(value: string | null) {
  if (value === null) return '기록 없음'
  return `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function formatAlgorithm(summary: Track1ClusterSummary) {
  const parts = [summary.analysisAlgorithm, summary.analysisAlgorithmVersion].filter((part): part is string => !!part)
  return parts.length === 0 ? '기록 없음' : parts.join(' ')
}
