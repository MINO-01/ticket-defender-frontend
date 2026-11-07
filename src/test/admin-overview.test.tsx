import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// Issue #44: 관리자 전체 현황(/app/overview)을 Mock 인증 어댑터와 fetch로 검증한다. 실제 Backend HTTP 연동 결과가 아니다.
// 공연 선택 뒤 기존 조회 API 3개를 첫 페이지 한 번씩만 부르고, 영역별 실패를 0건으로 바꾸지 않는지 확인한다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const EVENT_B = '33333333-3333-4333-8333-333333333334'
const CASE_1 = '55555555-5555-4555-8555-555555555551'
const CASE_2 = '55555555-5555-4555-8555-555555555552'
const MEMBER = '66666666-6666-4666-8666-666666666661'
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'
const FAN_PATH = `/api/v1/admin/fan-reports?eventId=${EVENT_A}&page=0&pageSize=1`
const CLUSTER_PATH = `/api/v1/admin/track1/clusters?eventId=${EVENT_A}&page=0&pageSize=1&sort=recent`
const CASE_PATH = `/api/v1/cases?eventId=${EVENT_A}&page=0&pageSize=5`
const ROUTE = `/app/overview?eventId=${EVENT_A}`

function createMockAdapter() {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderApp(path = ROUTE) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={createMockAdapter()} /><LocationProbe /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function problem(status: number, code: string) {
  return new Response(JSON.stringify({ status, code, detail: '내부 정보 secret-detail' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

const eventA = { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }
const events = { items: [eventA, { id: EVENT_B, externalEventId: 'synthetic-b', name: '합성 공연 B' }], page: 0, pageSize: 100, totalItems: 2, hasNext: false }
const fanSummary = { fanReportId: '44444444-4444-4444-8444-444444444441', reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED', receivedAt: '2026-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z', evidenceCount: 1, storedEvidenceCount: 1 }
const clusterSummary = { analysisRequestId: 'run-1', clusterId: 'cluster-1', riskScore: 0.82, analysisAlgorithm: 'LOUVAIN', analysisAlgorithmVersion: '1.0.0', analyzedAt: '2026-10-08T10:15:30Z', storedMemberCount: 2 }

function fanPage(totalItems: number, overrides: Record<string, unknown> = {}) {
  return { event: eventA, items: totalItems > 0 ? [fanSummary] : [], page: 0, pageSize: 1, totalItems, hasNext: totalItems > 1, ...overrides }
}

function clusterPage(totalItems: number, overrides: Record<string, unknown> = {}) {
  return { event: eventA, items: totalItems > 0 ? [clusterSummary] : [], page: 0, pageSize: 1, totalItems, hasNext: totalItems > 1, coverage: 'STORED_EVIDENCE_ONLY', ...overrides }
}

function caseView(caseId: string, overrides: Record<string, unknown> = {}) {
  return { caseId, eventId: EVENT_A, type: 'FAN_REPORT', status: 'OPEN', caseVersion: 0, evidenceRevision: 0, createdByMembershipId: MEMBER, assigneeMembershipId: null, relatedCaseId: null, relationReason: null, classification: null, currentReportVersionId: null, createdAt: '2026-11-06T01:00:00Z', updatedAt: '2026-11-06T01:00:00Z', ...overrides }
}

function casePage(items: unknown[], hasNext = false) {
  return { items, page: 0, pageSize: 5, hasNext }
}

type Call = { method: string; url: string }
type Handler = (count: number) => Response | Promise<Response>

function stubFetch(routes: Record<string, Handler> = {}) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const merged: Record<string, Handler> = {
    [EVENTS_PATH]: () => json(200, events),
    [FAN_PATH]: () => json(200, fanPage(37)),
    [CLUSTER_PATH]: () => json(200, clusterPage(12)),
    [CASE_PATH]: () => json(200, casePage([caseView(CASE_1, { type: 'COMBINED', status: 'IN_REVIEW' }), caseView(CASE_2)], true)),
    ...routes,
  }
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const call = { method: init?.method ?? 'GET', url: String(input) }
    calls.push(call)
    counts[call.url] = (counts[call.url] ?? 0) + 1
    const handler = call.method === 'GET' ? merged[call.url] : undefined
    if (!handler) throw new Error(`예상하지 못한 요청: ${call.method} ${call.url}`)
    return handler(counts[call.url])
  }))
  return calls
}

const section = (name: string) => screen.findByRole('region', { name })
const urls = (calls: Call[]) => calls.map((call) => call.url)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('관리자 전체 현황', () => {
  it('공연을 고르기 전에는 공연 목록만 조회하고, 고르면 영역별 API를 한 번씩만 조회한다', async () => {
    const calls = stubFetch()
    renderApp('/app/overview')
    expect(await screen.findByText('공연을 선택해 주세요', { selector: 'h2' })).toBeInTheDocument()
    expect(urls(calls)).toEqual([EVENTS_PATH])

    fireEvent.change(screen.getByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_A } })
    const fan = await section('팬 제보 (팬 제보 조사)')
    expect(await within(fan).findByText('37')).toBeInTheDocument()
    expect(within(await section('연결된 예매 그룹 (예매 관계 분석)')).getByText('12')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe(ROUTE)
    // 페이지 순회, 상세 N+1 조회, 자동 재조회를 하지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(urls(calls).sort()).toEqual([CASE_PATH, CLUSTER_PATH, EVENTS_PATH, FAN_PATH].sort())
  })

  it('서버 totalItems와 최근 Case를 표시하고 실제 상세와 목록 화면으로 연결한다', async () => {
    stubFetch()
    renderApp()
    const fan = await section('팬 제보 (팬 제보 조사)')
    expect(await within(fan).findByText('37')).toBeInTheDocument()
    expect(within(fan).getByRole('link', { name: '팬 제보 조사' })).toHaveAttribute('href', `/app/fan-reports?eventId=${EVENT_A}`)
    expect(within(fan).getByRole('link', { name: '검증 회차 관리' })).toHaveAttribute('href', `/app/verified-performances?eventId=${EVENT_A}`)

    const clusters = await section('연결된 예매 그룹 (예매 관계 분석)')
    expect(within(clusters).getByText(/불법 거래 확률이 아닙니다/)).toBeInTheDocument()
    expect(within(clusters).queryByText('0.82')).not.toBeInTheDocument()
    expect(within(clusters).getByRole('link', { name: '예매 관계 분석' })).toHaveAttribute('href', `/app/analysis/findings?eventId=${EVENT_A}`)

    const cases = await section('최근 조사 사건')
    const detail = await within(cases).findByRole('link', { name: `${CASE_1} 상세 보기` })
    expect(detail).toHaveAttribute('href', `/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(within(cases).getByText('복합 검토')).toBeInTheDocument()
    expect(within(cases).getByText('더 많은 조사 사건이 있습니다. 전체 목록은 조사 사건 화면에서 확인해 주세요.')).toBeInTheDocument()
    expect(within(cases).getByText(/전체 건수를 주지 않아 합계와 승인 대기 건수는 표시하지 않습니다/)).toBeInTheDocument()
    expect(within(cases).getByRole('link', { name: '조사 사건 전체 보기' })).toHaveAttribute('href', `/app/cases?eventId=${EVENT_A}`)

    fireEvent.click(detail)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/app/cases/${CASE_1}?eventId=${EVENT_A}`))
  })

  it('서버가 확인한 0건과 빈 Case 목록은 그대로 표시한다', async () => {
    stubFetch({ [FAN_PATH]: () => json(200, fanPage(0)), [CLUSTER_PATH]: () => json(200, clusterPage(0)), [CASE_PATH]: () => json(200, casePage([])) })
    renderApp()
    expect(await within(await section('팬 제보 (팬 제보 조사)')).findByText('0')).toBeInTheDocument()
    expect(await within(await section('연결된 예매 그룹 (예매 관계 분석)')).findByText('0')).toBeInTheDocument()
    expect(await within(await section('최근 조사 사건')).findByText(/현재 계정이 볼 수 있는 조사 사건이 없습니다/)).toBeInTheDocument()
  })

  it('영역별 권한 부족과 장애를 따로 표시하고 0건으로 바꾸지 않는다', async () => {
    stubFetch({
      [FAN_PATH]: () => problem(403, 'FORBIDDEN'),
      [CLUSTER_PATH]: () => problem(503, 'DEPENDENCY_UNAVAILABLE'),
      [CASE_PATH]: () => { throw new TypeError('network') },
    })
    renderApp()
    const fan = await section('팬 제보 (팬 제보 조사)')
    expect(await within(fan).findByText('이 영역에 필요한 역할이 없습니다')).toBeInTheDocument()
    expect(within(fan).getByText(/분석 담당\(ANALYST\) 또는 검토 담당\(REVIEWER\)만/)).toBeInTheDocument()
    const clusters = await section('연결된 예매 그룹 (예매 관계 분석)')
    expect(await within(clusters).findByText('서버가 일시적으로 응답할 수 없습니다')).toBeInTheDocument()
    const cases = await section('최근 조사 사건')
    expect(await within(cases).findByText('서버에 연결하지 못했습니다')).toBeInTheDocument()
    for (const region of [fan, clusters, cases]) {
      expect(within(region).queryByText('0')).not.toBeInTheDocument()
      expect(region).not.toHaveTextContent('secret-detail')
    }
    expect(within(cases).queryByText(/조사 사건이 없습니다/)).not.toBeInTheDocument()
  })

  it('한 영역의 다시 시도는 그 영역만 다시 조회한다', async () => {
    const calls = stubFetch({ [CLUSTER_PATH]: (count) => count === 1 ? problem(503, 'DEPENDENCY_UNAVAILABLE') : json(200, clusterPage(4)) })
    renderApp()
    const clusters = await section('연결된 예매 그룹 (예매 관계 분석)')
    fireEvent.click(await within(clusters).findByRole('button', { name: '다시 시도' }))
    expect(await within(clusters).findByText('4')).toBeInTheDocument()
    expect(calls.filter((call) => call.url === CLUSTER_PATH)).toHaveLength(2)
    expect(calls.filter((call) => call.url === FAN_PATH)).toHaveLength(1)
    expect(calls.filter((call) => call.url === CASE_PATH)).toHaveLength(1)
  })

  it.each([
    ['다른 공연의 팬 제보 응답', { [FAN_PATH]: () => json(200, fanPage(3, { event: { ...eventA, id: EVENT_B } })) }, '팬 제보 (팬 제보 조사)'],
    ['요청과 다른 페이지 크기', { [FAN_PATH]: () => json(200, fanPage(3, { pageSize: 20 })) }, '팬 제보 (팬 제보 조사)'],
    ['건수와 맞지 않는 군집 응답', { [CLUSTER_PATH]: () => json(200, clusterPage(5, { items: [] })) }, '연결된 예매 그룹 (예매 관계 분석)'],
    ['다른 공연의 Case', { [CASE_PATH]: () => json(200, casePage([caseView(CASE_1, { eventId: EVENT_B })])) }, '최근 조사 사건'],
  ])('%s는 계약 위반으로 처리하고 건수나 목록을 표시하지 않는다', async (_label, routes, name) => {
    stubFetch(routes)
    renderApp()
    const region = await section(name)
    expect(await within(region).findByText('서버 응답 형식이 계약과 다릅니다')).toBeInTheDocument()
    expect(within(region).queryByText('3')).not.toBeInTheDocument()
    expect(within(region).queryByText('5')).not.toBeInTheDocument()
    expect(within(region).queryByRole('link', { name: /상세 보기/ })).not.toBeInTheDocument()
  })

  it('범위 밖 404는 범위 안내로 표시한다', async () => {
    stubFetch({ [FAN_PATH]: () => problem(404, 'RESOURCE_NOT_FOUND') })
    renderApp()
    expect(await within(await section('팬 제보 (팬 제보 조사)')).findByText('공연을 찾을 수 없거나 접근 범위 밖입니다')).toBeInTheDocument()
  })

  it('401이면 세션을 정리하고 현황을 표시하지 않는다', async () => {
    stubFetch({ [CASE_PATH]: () => new Response(null, { status: 401 }) })
    renderApp()
    expect(await screen.findByText('관리자 세션이 종료되었습니다')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '최근 조사 사건' })).not.toBeInTheDocument()
  })
})

describe('첫 화면', () => {
  it('실제 연동 상태와 맞는 안내를 표시한다', () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(screen.getByText(/서버가 허용한 공연의 실제 조회 결과만 표시합니다/)).toBeInTheDocument()
    expect(screen.queryByText(/아직 연결되지 않았습니다/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /관리자 화면으로 이동/ })).toHaveAttribute('href', '/app/overview')
  })
})
