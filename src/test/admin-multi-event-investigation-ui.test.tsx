import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminAuthProvider } from '../features/admin-auth/AdminAuthProvider'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { RequireAdminAuth } from '../features/admin-auth/RequireAdminAuth'
import { MultiEventInvestigationRoute } from '../features/admin-multi-event/MultiEventInvestigationPage'

const eventA = '11111111-1111-4111-8111-111111111111'
const eventB = '99999999-9999-4999-8999-999999999999'
const runId = '22222222-2222-4222-8222-222222222222'
const performanceA = '33333333-3333-4333-8333-333333333333'
const performanceB = '44444444-4444-4444-8444-444444444444'
const versionA = '55555555-5555-4555-8555-555555555555'
const versionB = '66666666-6666-4666-8666-666666666666'
const candidateId = `multi-${'a'.repeat(64)}`
const memberA = 'a'.repeat(24)
const memberB = 'b'.repeat(24)
const relationshipA = '77777777-7777-4777-8777-777777777777'
const relationshipB = '88888888-8888-4888-8888-888888888888'
// 형식 검사 전용 더미 compact JWS이며 실제 인증 제공자나 Backend에서 사용할 수 없다.
const token = 'e30.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const adapter = (): AdminAuthAdapter => ({
  availability: { status: 'ready' },
  initialize: vi.fn(async () => ({ value: token, expiresAt: Date.now() + 600_000 })),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const page = (items: unknown[], current: number, pageSize: number, hasNext: boolean) => ({ items, page: current, pageSize, hasNext })
const scopeA = { eventId: eventA, performanceId: performanceA, ledgerVersionId: versionA, eventReference: 'EXT-A', sourceBatchId: 'batch-a' }
const scopeB = { eventId: eventB, performanceId: performanceB, ledgerVersionId: versionB, eventReference: 'EXT-B', sourceBatchId: 'batch-b' }

function renderPage() {
  return render(<MemoryRouter><AdminAuthProvider adapter={adapter()}><RequireAdminAuth><MultiEventInvestigationRoute /></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
}

afterEach(() => vi.unstubAllGlobals())

describe('다공연 조사 화면', () => {
  it('후보 구성원과 반복 관계의 다음 페이지를 실제 API에서 조회한다', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), window.location.origin)
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`)
      if (url.pathname === '/api/v1/admin/events') return json({
        items: [{ id: eventA, externalEventId: 'ext-a', name: '공연 A' }, { id: eventB, externalEventId: 'ext-b', name: '공연 B' }],
        page: 0, pageSize: 100, totalItems: 2, hasNext: false,
      })
      if (url.pathname.endsWith('/performances')) {
        const scope = url.pathname.includes(eventA) ? scopeA : scopeB
        return json(page([{ eventId: scope.eventId, performanceId: scope.performanceId, ledgerVersionId: scope.ledgerVersionId, eventReference: scope.eventReference, sourceBatchId: scope.sourceBatchId }], 0, 100, false))
      }
      if (url.pathname === '/api/v1/admin/multi-event-investigations' && init?.method === 'POST') {
        return json({ runId, existing: false, status: 'PENDING' }, 202)
      }
      if (url.pathname === `/api/v1/admin/multi-event-investigations/events/${eventA}`) return json(page([{
        id: runId, status: 'COMPLETED', failureCode: null, ledgerVersionSetDigest: 'c'.repeat(64),
        scoreVersion: 'score-v2-exp2-multi-event-recurrence', projectionVersion: 'projection-v2.2-exp2-ipwindow-softhub',
        algorithmVersion: 'gds-2.6.6', analysisAsOf: '2026-11-25T00:00:00Z',
        analysisStartAt: '2026-11-01T00:00:00Z', analysisEndAt: '2026-11-24T00:00:00Z',
        createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:01:00Z', completedAt: '2026-11-25T00:01:00Z',
      }], 0, 20, false))
      if (url.pathname.endsWith(`/${runId}/sources`)) return json([scopeA, scopeB])
      if (url.pathname.endsWith(`/${runId}/candidates`)) return json(page([{
        candidateId, priorityBand: 'MEDIUM', investigationScore: 0.2267, baselineMaxScore: null,
        distinctAccountCount: 2, distinctEventCount: 2, distinctPerformanceCount: 2, verifiedRelationshipCount: 2,
        scoreBreakdown: '{"L":0.8,"G":0.68,"B":0.4167,"Q":0.5,"R":0.3333,"score":0.2267,"quantityStatus":"NEUTRAL_NO_POLICY","quantityReason":"POLICY_SNAPSHOT_UNAVAILABLE"}',
        availableSignals: 'refund_account_hash', excludedSignals: '', unavailableSignals: 'address_hash,device_id_hash,phone_hash',
        normalSharingPossibilities: 'NORMAL_SHARED_POSSIBLE',
      }], 0, 20, false))
      if (url.pathname.endsWith(`/candidates/${candidateId}/members`)) {
        const current = Number(url.searchParams.get('page') ?? 0)
        return json(page([{ memberId: current === 0 ? memberA : memberB }], current, 100, current === 0))
      }
      if (url.pathname.endsWith(`/candidates/${candidateId}/relationships`)) {
        const current = Number(url.searchParams.get('page') ?? 0)
        return json(page([{
          relationshipId: current === 0 ? relationshipA : relationshipB, signalType: 'refund_account_hash',
          accountCount: 2, sourceScopeCount: 2, memberIds: [memberA, memberB], membersTruncated: false,
          sourceScopes: [scopeA, scopeB],
        }], current, 20, current === 0))
      }
      return new Response(null, { status: 404 })
    }))

    renderPage()
    fireEvent.click(await screen.findByLabelText('공연 A'))
    fireEvent.click(screen.getByLabelText('공연 B'))
    fireEvent.click(screen.getByRole('button', { name: '고정 원장으로 다공연 분석 요청' }))
    fireEvent.click(await screen.findByRole('button', { name: '열기' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '열기' })).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: '열기' })[1])

    const membersTable = await screen.findByRole('table', { name: '불투명 구성원' })
    expect(within(membersTable).getByText(memberA)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '구성원 다음' }))
    await waitFor(() => expect(calls).toContain(`GET /api/v1/admin/multi-event-investigations/events/${eventA}/${runId}/candidates/${candidateId}/members?page=1&pageSize=100`))
    const nextMembersTable = screen.getByRole('table', { name: '불투명 구성원' })
    expect(within(nextMembersTable).getByText(memberB)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '관계 다음' }))

    await waitFor(() => expect(calls).toContain(`GET /api/v1/admin/multi-event-investigations/events/${eventA}/${runId}/candidates/${candidateId}/relationships?page=1&pageSize=20`))
    expect(calls).toContain(`GET /api/v1/admin/multi-event-investigations/events/${eventA}/${runId}/candidates/${candidateId}/members?page=1&pageSize=100`)
    expect(calls.some((call) => call.includes(relationshipB))).toBe(false)
  })
})
