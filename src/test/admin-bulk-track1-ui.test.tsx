import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminAuthProvider } from '../features/admin-auth/AdminAuthProvider'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { RequireAdminAuth } from '../features/admin-auth/RequireAdminAuth'
import { BulkTrack1Results } from '../features/admin-ledger-imports/BulkTrack1Results'

const eventId = '11111111-1111-4111-8111-111111111111'
const otherEventId = '99999999-9999-4999-8999-999999999999'
const performanceId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const otherJobId = '77777777-7777-4777-8777-777777777777'
const adapter = (): AdminAuthAdapter => ({ availability: { status: 'ready' }, initialize: vi.fn(async () => ({ value: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ', expiresAt: Date.now() + 600000 })), signIn: vi.fn(async () => undefined), signOut: vi.fn(async () => undefined) })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const job = (id = jobId, status = 'COMPLETED') => ({ jobId: id, ledgerVersionId: '44444444-4444-4444-8444-444444444444', dataJobId: '55555555-5555-4555-8555-555555555555', status, dataStatus: status === 'COMPLETED' ? 'COMPLETED' : 'FAILED', failureCode: status === 'COMPLETED' ? null : 'DATA_UNAVAILABLE', algorithmVersion: 'louvain-v1', sharedSignalObservationsStatus: status === 'COMPLETED' ? 'COMPLETED' : null, purchaseLimitEvaluationsStatus: status === 'COMPLETED' ? 'COMPLETED' : null, createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:01:00Z', completedAt: status === 'COMPLETED' ? '2026-11-17T00:02:00Z' : null, policyVerificationStatus: 'CONFIRMED', quantityDataStatus: 'COMPLETE', dataCompletenessReason: null, policyId: '66666666-6666-4666-8666-666666666666', policyRevision: 1, policyVersion: 'policy-v1' })
const page = (items: unknown[], current = job()) => ({ job: current, items, page: 0, pageSize: 20, hasNext: false })

function panel(event = eventId) { return <MemoryRouter><AdminAuthProvider adapter={adapter()}><RequireAdminAuth><BulkTrack1Results eventId={event} performanceId={performanceId} /></RequireAdminAuth></AdminAuthProvider></MemoryRouter> }
function renderPanel(event = eventId) { return render(panel(event)) }

function successMock(current = job()) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.endsWith('/bulk-analysis-jobs')) return json([current])
    if (url.includes('/clusters/cluster-01/members?')) return json({ clusterId: 'cluster-01', items: [{ memberId: 'a'.repeat(24) }], page: 0, pageSize: 100, hasNext: false })
    if (url.includes('/clusters?')) return json(page([{ clusterId: 'cluster-01', riskScore: 0.7, memberCount: 2, paymentSharedSignalCount: 1, addressSharedSignalCount: 1, deviceSharedSignalCount: 1, ipSharedSignalCount: 1 }], current))
    if (url.includes('/shared-signal-observations?')) return json(page([{ observationId: 'obs-1', signalType: 'IP', distinctAccountCount: 2, scopeAccountCount: 3, distinctReservationCount: 2, totalTicketQuantity: null, ticketQuantityStatus: 'UNAVAILABLE', paymentSharedAccountCount: 1, deviceSharedAccountCount: 1, ipNetworkType: 'PUBLIC', purchaseWindowSeconds: 30, excludedFromLouvain: true }], current))
    if (url.includes('/purchase-limit-evaluations?')) return json(page([{ performanceId, status: 'EVALUATED', policyVersion: 'policy-v1', accountLimitFindingCount: 0, findingsCollectionStatus: 'COMPLETED' }], current))
    if (url.includes('/purchase-limit-findings?')) return json(page([], current))
    return new Response(null, { status: 404 })
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('BL-07 대용량 Track 1 관리자 결과 UI', () => {
  it('선택한 Job의 군집, 구성원, IP 관찰, 정상 평가 0건을 실제 API 경로에서 표시한다', async () => {
    const fetchMock = successMock(); vi.stubGlobal('fetch', fetchMock)
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: '상세 열기' }))
    expect(await screen.findByText('Louvain 군집')).toBeInTheDocument()
    expect(screen.getByText('확인 불가 (UNAVAILABLE)')).toBeInTheDocument()
    expect(screen.getByText('정상 평가가 완료되었고 한도 초과 후보는 0건입니다.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '조회' }))
    expect(await screen.findByText('군집 구성원 (opaque ID)')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/events/${eventId}/ledger-track1/performances/${performanceId}/bulk-analysis-jobs/${jobId}/clusters?`), expect.any(Object))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/clusters/cluster-01/members?page=0&pageSize=100'), expect.any(Object))
  })

  it('정책 미확정과 수량 자료 불완전은 정상 0건과 구분한다', async () => {
    const current = job()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/bulk-analysis-jobs')) return json([current])
      if (url.includes('/clusters?') || url.includes('/shared-signal-observations?') || url.includes('/purchase-limit-findings?')) return json(page([], current))
      if (url.includes('/purchase-limit-evaluations?')) return json(page([{ performanceId, status: 'POLICY_NOT_CONFIRMED', policyVersion: null, accountLimitFindingCount: 0, findingsCollectionStatus: 'NOT_APPLICABLE' }], current))
      return new Response(null, { status: 404 })
    }))
    renderPanel(); fireEvent.click(await screen.findByRole('button', { name: '상세 열기' }))
    expect(await screen.findByText('정책 미확정 (POLICY_NOT_CONFIRMED)')).toBeInTheDocument()
    expect(screen.queryByText('정상 평가가 완료되었고 한도 초과 후보는 0건입니다.')).not.toBeInTheDocument()
  })

  it('FAILED Job의 빈 목록을 정상 0건으로 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', successMock(job(otherJobId, 'FAILED')))
    const view = renderPanel(); fireEvent.click(await screen.findByRole('button', { name: '상세 열기' }))
    expect(await screen.findByText(/실패함 \(FAILED\)/)).toBeInTheDocument()
    expect(screen.queryByText('완료된 Job에 저장된 군집이 없습니다.')).not.toBeInTheDocument()
    view.unmount()
  })

  it.each([
    [401, '관리자 세션이 종료되었습니다'],
    [403, '이 화면에 필요한 역할이 없습니다'],
    [404, '대용량 분석 Job을 찾을 수 없거나 접근 범위 밖입니다'],
  ])('Job 목록의 HTTP %i 오류를 빈 목록으로 바꾸지 않는다', async (status, title) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })))
    renderPanel(); expect(await screen.findByText(title)).toBeInTheDocument()
  })

  it('Job 목록 네트워크 오류를 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    renderPanel(); expect(await screen.findByText('서버에 연결하지 못했습니다')).toBeInTheDocument()
  })

  it('공연 또는 Job 범위가 바뀌면 이전 Job 상세를 유지하지 않는다', async () => {
    const fetchMock = successMock(); vi.stubGlobal('fetch', fetchMock)
    const view = renderPanel(); fireEvent.click(await screen.findByRole('button', { name: '상세 열기' }))
    expect(await screen.findByText('선택한 BL-07 Job')).toBeInTheDocument()
    view.rerender(panel(otherEventId))
    expect(screen.queryByText('선택한 BL-07 Job')).not.toBeInTheDocument()
  })
})
