import { describe, expect, it } from 'vitest'
import {
  bulkClusterMembersPath, bulkClusterPageSchema, bulkEvaluationPageSchema, bulkFindingPageSchema, bulkJobListSchema, bulkSharedSignalPageSchema,
} from '../features/admin-ledger-imports/bulkTrack1Api'

const eventId = '11111111-1111-4111-8111-111111111111'
const performanceId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const ledgerVersionId = '44444444-4444-4444-8444-444444444444'
const dataJobId = '55555555-5555-4555-8555-555555555555'
const baseJob = () => ({ jobId, ledgerVersionId, dataJobId, status: 'COMPLETED', dataStatus: 'COMPLETED', failureCode: null, algorithmVersion: 'louvain-v1', sharedSignalObservationsStatus: 'COMPLETED', purchaseLimitEvaluationsStatus: 'COMPLETED', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:01:00Z', completedAt: '2026-11-17T00:02:00Z', policyVerificationStatus: 'CONFIRMED', quantityDataStatus: 'COMPLETE', dataCompletenessReason: null, policyId: '66666666-6666-4666-8666-666666666666', policyRevision: 1, policyVersion: 'policy-v1' })
const page = <T>(items: T[]) => ({ job: baseJob(), items, page: 0, pageSize: 20, hasNext: false })

describe('BL-07 대용량 Track 1 관리자 조회 계약', () => {
  it('Job 목록은 페이지 객체가 아닌 배열로만 파싱한다', () => {
    expect(bulkJobListSchema.safeParse([baseJob()]).success).toBe(true)
    expect(bulkJobListSchema.safeParse({ items: [baseJob()] }).success).toBe(false)
  })

  it('군집과 보조 결과는 Job 범위 페이지 형식으로 파싱한다', () => {
    expect(bulkClusterPageSchema.safeParse(page([{ clusterId: 'cluster-01', riskScore: 0.4, memberCount: 2, paymentSharedSignalCount: 0, addressSharedSignalCount: 1, deviceSharedSignalCount: 1, ipSharedSignalCount: 0 }])).success).toBe(true)
    expect(bulkSharedSignalPageSchema.safeParse(page([{ observationId: 'obs-1', signalType: 'IP', distinctAccountCount: 2, scopeAccountCount: 2, distinctReservationCount: 2, totalTicketQuantity: 3, ticketQuantityStatus: 'VERIFIED', paymentSharedAccountCount: 0, deviceSharedAccountCount: 1, ipNetworkType: 'PUBLIC', purchaseWindowSeconds: 60, excludedFromLouvain: false }])).success).toBe(true)
    expect(bulkEvaluationPageSchema.safeParse(page([{ performanceId, status: 'EVALUATED', policyVersion: 'policy-v1', accountLimitFindingCount: 0, findingsCollectionStatus: 'COMPLETED' }])).success).toBe(true)
  })

  it('잘못된 UUID, 음수 수량, 안전하지 않은 long, 비정상 Risk Score를 거부한다', () => {
    expect(bulkJobListSchema.safeParse([{ ...baseJob(), jobId: 'not-a-uuid' }]).success).toBe(false)
    expect(bulkClusterPageSchema.safeParse(page([{ clusterId: 'cluster-01', riskScore: 1.01, memberCount: 2, paymentSharedSignalCount: 0, addressSharedSignalCount: 0, deviceSharedSignalCount: 0, ipSharedSignalCount: 0 }])).success).toBe(false)
    expect(bulkSharedSignalPageSchema.safeParse(page([{ observationId: 'obs-1', signalType: 'ADDRESS', distinctAccountCount: 2, scopeAccountCount: 2, distinctReservationCount: 1, totalTicketQuantity: -1, ticketQuantityStatus: 'VERIFIED', paymentSharedAccountCount: 0, deviceSharedAccountCount: 0, ipNetworkType: 'UNKNOWN', purchaseWindowSeconds: 0, excludedFromLouvain: false }])).success).toBe(false)
    expect(bulkFindingPageSchema.safeParse(page([{ accountId: 'a'.repeat(24), effectiveTicketQuantity: Number.MAX_SAFE_INTEGER + 1, maxTicketsPerAccount: 2, policyVersion: 'policy-v1', reservationQuantities: [] }])).success).toBe(false)
  })

  it('정상 평가 0건과 평가 불가 상태 및 nullable policyVersion을 구분한다', () => {
    expect(bulkEvaluationPageSchema.safeParse(page([{ performanceId, status: 'EVALUATED', policyVersion: 'policy-v1', accountLimitFindingCount: 0, findingsCollectionStatus: 'COMPLETED' }])).success).toBe(true)
    expect(bulkEvaluationPageSchema.safeParse(page([{ performanceId, status: 'POLICY_NOT_CONFIRMED', policyVersion: null, accountLimitFindingCount: 0, findingsCollectionStatus: 'NOT_APPLICABLE' }])).success).toBe(true)
    expect(bulkEvaluationPageSchema.safeParse(page([{ performanceId, status: 'POLICY_NOT_CONFIRMED', policyVersion: null, accountLimitFindingCount: 0, findingsCollectionStatus: 'COMPLETED' }])).success).toBe(false)
  })

  it('opaque account/reservation ID만 받고 원본 HMAC 형식은 허용하지 않는다', () => {
    const finding = { accountId: 'a'.repeat(24), effectiveTicketQuantity: 3, maxTicketsPerAccount: 2, policyVersion: 'policy-v1', reservationQuantities: [{ reservationId: 'b'.repeat(24), effectiveTicketQuantity: 3 }] }
    expect(bulkFindingPageSchema.safeParse(page([finding])).success).toBe(true)
    expect(bulkFindingPageSchema.safeParse(page([{ ...finding, accountId: 'a'.repeat(64) }])).success).toBe(false)
  })

  it('안전하지 않은 clusterId는 인코딩하지 않고 상세 API 경로를 만들지 않는다', () => {
    expect(bulkClusterMembersPath(eventId, performanceId, jobId, 'cluster/../escape', 0)).toBeNull()
    expect(bulkClusterMembersPath(eventId, performanceId, jobId, 'cluster-01', 0)).toContain('/clusters/cluster-01/members?page=0&pageSize=100')
  })
})
