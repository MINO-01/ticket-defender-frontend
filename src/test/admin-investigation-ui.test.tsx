import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminAuthProvider } from '../features/admin-auth/AdminAuthProvider'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { RequireAdminAuth } from '../features/admin-auth/RequireAdminAuth'
import { InvestigationWizardRoute } from '../features/admin-investigation/InvestigationWizardPage'

const eventA = '11111111-1111-4111-8111-111111111111'
const eventB = '99999999-9999-4999-8999-999999999999'
const runId = '22222222-2222-4222-8222-222222222222'
const performanceA = '33333333-3333-4333-8333-333333333333'
const performanceB = '44444444-4444-4444-8444-444444444444'
const targetId = '55555555-5555-4555-8555-555555555555'
const candidateId = `multi-${'a'.repeat(64)}`
const token = 'e30.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const adapter = (): AdminAuthAdapter => ({
  availability: { status: 'ready' },
  initialize: vi.fn(async () => ({ value: token, expiresAt: Date.now() + 600_000 })),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
})
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const run = {
  id: runId, status: 'COMPLETED', failureCode: null, ledgerVersionSetDigest: 'c'.repeat(64),
  scoreVersion: 'score-v2-exp2-multi-performance-recurrence', projectionVersion: 'projection-v2.2-exp2-ipwindow-softhub',
  algorithmVersion: 'synthetic-test', analysisAsOf: '2026-11-25T00:00:00Z',
  analysisStartAt: '2026-11-01T00:00:00Z', analysisEndAt: '2026-11-24T00:00:00Z',
  createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:01:00Z', completedAt: '2026-11-25T00:01:00Z',
}
const candidate = {
  candidateId, priorityBand: 'MEDIUM', investigationScore: 0.22, baselineMaxScore: null,
  distinctAccountCount: 2, distinctEventCount: 2, distinctPerformanceCount: 2, verifiedRelationshipCount: 1,
  scoreBreakdown: '{}', availableSignals: 'refund_account_hash', excludedSignals: '', unavailableSignals: '', normalSharingPossibilities: 'NORMAL_SHARED_POSSIBLE',
  reasons: [{ code: 'SHARED_PHONE', count: 2, performances: [performanceA, performanceB], strengthRank: 2 }],
}
const targetItem = {
  targetId, accountReference: 'SYNTHETIC-ACCOUNT-REAL', reservationReference: 'SYNTHETIC-RESERVATION-REAL',
  ticketReference: 'SYNTHETIC-TICKET-REAL', performanceId: performanceA, purchasedAt: '2026-11-20T03:45:00Z',
  ticketStatus: 'ACTIVE', seatZone: 'A', seatRow: '1', seatNumber: '2', reasons: ['SHARED_PHONE'], reservedAt: null,
}

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('관리자 조사 5단계 화면', () => {
  it('예약 시각만 표시하고 실제 참조번호는 사유 열람 후 현재 단계에서만 보여 준다', async () => {
    const calls: Array<{ path: string; method: string; headers: HeadersInit | undefined; body: BodyInit | null | undefined }> = []
    let targetListRequests = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), window.location.origin)
      calls.push({ path: `${url.pathname}${url.search}`, method: init?.method ?? 'GET', headers: init?.headers, body: init?.body })
      if (url.pathname === '/api/v1/admin/events') return json({ items: [
        { id: eventA, externalEventId: 'ext-a', name: '공연 A' }, { id: eventB, externalEventId: 'ext-b', name: '공연 B' },
      ], page: 0, pageSize: 100, totalItems: 2, hasNext: false })
      if (url.pathname.endsWith('/performances')) {
        const eventId = url.pathname.includes(eventA) ? eventA : eventB
        const performanceId = eventId === eventA ? performanceA : performanceB
        return json({ items: [{ eventId, performanceId, eventReference: `EXT-${eventId === eventA ? 'A' : 'B'}`, sourceBatchId: 'synthetic-batch', ledgerVersionId: targetId }], page: 0, pageSize: 100, hasNext: false })
      }
      if (url.pathname === '/api/v1/admin/multi-event-investigations' && init?.method === 'POST') return json({ runId, existing: false, status: 'PENDING' }, 202)
      if (url.pathname === `/api/v1/admin/multi-event-investigations/events/${eventA}/${runId}`) return json(run)
      if (url.pathname === `/api/v1/admin/multi-event-investigations/events/${eventA}/${runId}/candidate-families`) return json({ items: [{ familyId: candidateId, familyScore: 0.22, candidates: [candidate] }], page: 0, pageSize: 20, hasNext: false })
      if (url.pathname.endsWith(`/candidates/${candidateId}/targets`)) {
        targetListRequests += 1
        if (targetListRequests > 1) return json({ code: 'ROLE_MISSING' }, 403)
        return json({ items: [{ ...targetItem, accountReference: '가림-계정', reservationReference: '가림-예매', ticketReference: '가림-티켓' }], page: 0, pageSize: 50, total: 1, hasNext: false }, 200, { 'Cache-Control': 'no-store' })
      }
      if (url.pathname.endsWith(`/candidates/${candidateId}/targets/reveal`) && init?.method === 'POST') return json({ items: [targetItem], page: 0, pageSize: 50, total: 1, hasNext: false }, 200, { 'Cache-Control': 'no-store' })
      return new Response(null, { status: 404 })
    }))

    const view = render(<MemoryRouter initialEntries={['/app/investigate/2']}><AdminAuthProvider adapter={adapter()}><RequireAdminAuth><Routes><Route path="/app/investigate/:step" element={<InvestigationWizardRoute />} /></Routes></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
    fireEvent.click(await screen.findByLabelText('공연 A'))
    fireEvent.click(screen.getByLabelText('공연 B'))
    await waitFor(() => expect(screen.getByRole('button', { name: '조사 분석 실행' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '조사 분석 실행' }))
    await screen.findByText('조사 분석 요청 접수: PENDING')
    fireEvent.click(screen.getByRole('button', { name: /의심 묶음 찾기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '이 후보 검토' }))
    fireEvent.click(screen.getByRole('button', { name: /의심 묶음 검토/ }))

    view.unmount()
    render(<MemoryRouter initialEntries={['/app/investigate/4']}><AdminAuthProvider adapter={adapter()}><RequireAdminAuth><Routes><Route path="/app/investigate/:step" element={<InvestigationWizardRoute />} /></Routes></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
    expect(await screen.findByLabelText('조사 사유')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('조사 사유'), { target: { value: '합성 자료 검토' } })
    fireEvent.click(screen.getByRole('button', { name: '마스킹된 대상 불러오기' }))
    expect(await screen.findByText('가림-예매')).toBeInTheDocument()
    expect(screen.queryByText('SYNTHETIC-RESERVATION-REAL')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '실제 참조번호 보기' }))

    const table = await screen.findByRole('table', { name: '조사 대상 계정과 구성원별 근거' })
    expect(within(table).getByText('SYNTHETIC-RESERVATION-REAL')).toBeInTheDocument()
    expect(within(table).getByText('SYNTHETIC-ACCOUNT-REAL')).toBeInTheDocument()
    expect(within(table).getByText('미제공')).toBeInTheDocument()
    expect(within(table).queryByText('2026-11-20T03:45:00Z')).not.toBeInTheDocument()
    expect(window.location.href).not.toContain('SYNTHETIC-RESERVATION-REAL')
    expect(localStorage.length).toBe(0)
    const savedWorkflow = sessionStorage.getItem('td.admin-investigation.v1')
    expect(savedWorkflow).not.toBeNull()
    expect(savedWorkflow).not.toContain('SYNTHETIC-ACCOUNT-REAL')
    expect(savedWorkflow).not.toContain('SYNTHETIC-RESERVATION-REAL')
    expect(savedWorkflow).not.toContain('SYNTHETIC-TICKET-REAL')

    const revealRequest = calls.find((call) => call.path.includes(`/candidates/${candidateId}/targets/reveal`))
    expect(revealRequest?.method).toBe('POST')
    expect(revealRequest?.body).toBe(JSON.stringify({ reason: '합성 자료 검토' }))
    fireEvent.click(screen.getByRole('button', { name: /의심 묶음 찾기/ }))
    expect(screen.queryByText('SYNTHETIC-RESERVATION-REAL')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /의심 묶음 검토/ }))
    fireEvent.change(screen.getByLabelText('조사 사유'), { target: { value: '합성 권한 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '마스킹된 대상 불러오기' }))
    expect(await screen.findByText('이 계정에는 조사 대상 권한이 없어 열람과 내보내기가 비활성화되었습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '실제 참조번호 보기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '조사 대상 CSV 내려받기' })).toBeDisabled()
  })

  it('사건 결과에서 기존 사건, 승인 요청, 보고서 화면으로 이동할 수 있다', async () => {
    sessionStorage.setItem('td.admin-investigation.v1', JSON.stringify({
      version: 1, importId: null, publishedScopes: [], runContext: { eventId: eventA, runId },
      selection: { familyPage: 0, familyId: candidateId, candidateId }, scopeDraft: null,
    }))
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === `/api/v1/admin/multi-event-investigations/events/${eventA}/${runId}`) return json(run)
      if (url.pathname.endsWith('/candidate-families')) return json({ items: [{ familyId: candidateId, familyScore: 0.22, candidates: [candidate] }], page: 0, pageSize: 20, hasNext: false })
      return new Response(null, { status: 404 })
    }))
    render(<MemoryRouter initialEntries={['/app/investigate/5']}><AdminAuthProvider adapter={adapter()}><RequireAdminAuth><Routes><Route path="/app/investigate/:step" element={<InvestigationWizardRoute />} /></Routes></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '조사 결과 요약' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '사건 목록 열기' })).toHaveAttribute('href', `/app/cases?eventId=${eventA}`)
    expect(screen.getByRole('link', { name: '승인 요청 화면 열기' })).toHaveAttribute('href', '/app/approvals')
    expect(screen.getByRole('link', { name: '보고서 센터 열기' })).toHaveAttribute('href', '/app/report-center')
  })
})
