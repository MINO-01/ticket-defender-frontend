import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

// Backend track1-admin-evidence-read-v1 계약이다. 응답은 저장된 증거만 담는 STORED_EVIDENCE_ONLY이며
// 좌석, 공유 신호, 신호별 연결 관계, 그래프 간선, 결제/주소/기기/IP 토큰은 제공하지 않는다.

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

const memberSchema = z.object({
  auditId: z.number().int(),
  accountId: z.string().nullable(),
  reservationNo: z.string().nullable(),
})

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

export const track1ClusterDetailSchema = z.object({
  event: eventSchema,
  cluster: summarySchema,
  members: z.array(memberSchema),
  coverage: coverageSchema,
})

export type Track1ClusterSummary = z.infer<typeof summarySchema>
export type Track1ClusterPage = z.infer<typeof track1ClusterPageSchema>
export type Track1ClusterDetail = z.infer<typeof track1ClusterDetailSchema>
export type Track1ClusterKey = { eventId: string; analysisRequestId: string; clusterId: string }

export function track1ClusterListPath(eventId: string, page: number, sort: Track1Sort) {
  return adminApiPath('/api/v1/admin/track1/clusters', { eventId, page, pageSize: track1PageSize, sort })
}

export function track1ClusterDetailPath(key: Track1ClusterKey) {
  return adminApiPath('/api/v1/admin/track1/clusters/detail', { eventId: key.eventId, analysisRequestId: key.analysisRequestId, clusterId: key.clusterId })
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
