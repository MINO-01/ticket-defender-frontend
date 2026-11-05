import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// Issue #37 보완: 공연 단위 검증 회차 관리 화면(/app/verified-performances)을 Mock 인증 어댑터와 fetch로 검증한다.
// 팬 제보 상세 GET은 ANALYST, REVIEWER만 허용되므로 TENANT_ADMIN은 이 화면에서 기존 접근 가능 공연 선택(AdminEventGate)으로 회차를 관리한다.
// 역할은 서버가 판단하므로 화면은 역할을 추정하지 않고 서버 403, 404를 따른다. 실제 역할별 결과는 격리 E2E로 확인한다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const EVENT_B = '33333333-3333-4333-8333-333333333334'
const EVENT_OUTSIDE = '33333333-3333-4333-8333-333333333339'
const PERF_1 = '99999999-9999-4999-8999-999999999991'
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'
const perfsUrl = (eventId = EVENT_A) => `/api/v1/admin/events/${eventId}/verified-performances`
const route = (eventId?: string) => `/app/verified-performances${eventId ? `?eventId=${eventId}` : ''}`

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

function renderApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={createMockAdapter()} /><LocationProbe /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function problem(status: number, code: string) {
  return new Response(JSON.stringify({ status, code, detail: '내부 정보 secret-detail' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

const events = { items: [{ id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }, { id: EVENT_B, externalEventId: 'synthetic-b', name: '합성 공연 B' }], page: 0, pageSize: 100, totalItems: 2, hasNext: false }

function performance(overrides: Record<string, unknown> = {}) {
  return { performanceId: PERF_1, eventId: EVENT_A, performanceRef: 'SYN-PERF-1', status: 'ACTIVE', revision: 1, sourceVersion: 'syn-v1', verifiedAt: '2026-11-04T01:00:00', withdrawnAt: null, ...overrides }
}

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }
type Handler = (call: Call, count: number) => Response | Promise<Response> | undefined

function stubFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const merged: Record<string, Handler> = { [`GET ${EVENTS_PATH}`]: () => json(200, events), [`GET ${perfsUrl()}`]: () => json(200, [performance()]), ...routes }
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const key = `${call.method} ${call.url}`
    counts[key] = (counts[key] ?? 0) + 1
    const response = await merged[key]?.(call, counts[key])
    if (!response) throw new Error(`예상하지 못한 요청: ${key}`)
    return response
  }))
  return calls
}

const sent = (calls: Call[], method: string, url: string) => calls.filter((call) => call.method === method && call.url === url)
const noFanReportRequests = (calls: Call[]) => calls.every((call) => !call.url.startsWith('/api/v1/admin/fan-reports'))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('공연 단위 검증 회차 관리 화면', () => {
  it('관리 메뉴에서 열고, 공연을 고르기 전에는 회차를 조회하지 않으며 고르면 그 공연의 회차만 조회한다', async () => {
    const calls = stubFetch({})
    renderApp('/app/overview')
    fireEvent.click(await screen.findByRole('link', { name: '검증 회차 관리' }))
    expect(await screen.findByRole('heading', { name: '검증 회차 관리' })).toBeInTheDocument()
    expect(await screen.findByText('공연을 선택해 주세요', { selector: 'h2' })).toBeInTheDocument()
    expect(calls.some((call) => call.url.includes('/verified-performances'))).toBe(false)
    fireEvent.change(screen.getByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_A } })
    const region = await screen.findByRole('region', { name: '검증 회차' })
    expect(await within(region).findByText('SYN-PERF-1')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe(route(EVENT_A))
    expect(sent(calls, 'GET', perfsUrl())).toHaveLength(1)
    // 팬 제보 상세나 회차 연결은 이 화면에서 조회하지 않는다. 팬 제보 상세 권한을 우회하지 않는다.
    expect(noFanReportRequests(calls)).toBe(true)
  })

  it('등록, 수정, 철회를 제보 상세와 같은 계약으로 보내고 결과 뒤 목록을 다시 조회한다', async () => {
    const calls = stubFetch({
      [`POST ${perfsUrl()}`]: () => json(201, performance({ performanceId: '99999999-9999-4999-8999-999999999992', performanceRef: 'SYN-NEW' })),
      [`PATCH ${perfsUrl()}/${PERF_1}`]: () => json(200, performance({ revision: 2, sourceVersion: 'syn-v2' })),
      [`POST ${perfsUrl()}/${PERF_1}/withdrawals`]: () => json(200, performance({ status: 'WITHDRAWN', revision: 2, withdrawnAt: '2026-11-05T00:00:00' })),
    })
    renderApp(route(EVENT_A))
    const region = await screen.findByRole('region', { name: '검증 회차' })
    await within(region).findByText('SYN-PERF-1')
    const form = within(region).getByRole('region', { name: '검증 회차 등록' })
    fireEvent.change(within(form).getByRole('textbox', { name: /회차 식별자/ }), { target: { value: 'SYN-NEW' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /검증 근거/ }), { target: { value: '합성 회차표 확인' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /출처 버전/ }), { target: { value: 'syn-v1' } })
    fireEvent.click(within(form).getByRole('button', { name: '검증 회차 등록' }))
    expect(await within(form).findByText('검증 회차를 등록했습니다.')).toBeInTheDocument()

    const item = within(region).getByRole('article', { name: '검증 회차 SYN-PERF-1' })
    fireEvent.click(within(item).getByRole('button', { name: '검증 근거 수정' }))
    const revise = within(item).getByRole('region', { name: '검증 근거 수정' })
    fireEvent.change(within(revise).getByRole('textbox', { name: /새 검증 근거/ }), { target: { value: '합성 재확인' } })
    fireEvent.change(within(revise).getByRole('textbox', { name: /출처 버전/ }), { target: { value: 'syn-v2' } })
    fireEvent.click(within(revise).getByRole('button', { name: '수정 요청' }))
    expect(await within(revise).findByText('검증 근거를 수정했습니다.')).toBeInTheDocument()
    fireEvent.click(within(revise).getByRole('button', { name: '닫기' }))

    fireEvent.click(within(item).getByRole('button', { name: '회차 철회' }))
    const withdraw = within(item).getByRole('region', { name: '회차 철회' })
    fireEvent.change(within(withdraw).getByRole('textbox', { name: /철회 사유/ }), { target: { value: '합성 철회 사유' } })
    fireEvent.click(within(withdraw).getByRole('button', { name: '철회 요청' }))
    expect(await within(withdraw).findByText('검증 회차를 철회했습니다.')).toBeInTheDocument()

    expect(sent(calls, 'POST', perfsUrl())[0].body).toEqual({ performanceRef: 'SYN-NEW', verificationBasis: '합성 회차표 확인', sourceVersion: 'syn-v1' })
    expect(sent(calls, 'PATCH', `${perfsUrl()}/${PERF_1}`)[0].body).toEqual({ verificationBasis: '합성 재확인', sourceVersion: 'syn-v2', expectedRevision: 1 })
    expect(sent(calls, 'POST', `${perfsUrl()}/${PERF_1}/withdrawals`)[0].body).toEqual({ reason: '합성 철회 사유', expectedRevision: 1 })
    for (const call of calls.filter((item) => item.method !== 'GET')) expect(call.headers['Idempotency-Key']).toBeUndefined()
    await waitFor(() => expect(sent(calls, 'GET', perfsUrl()).length).toBeGreaterThanOrEqual(4))
    expect(noFanReportRequests(calls)).toBe(true)
  })

  it('ANALYST처럼 회차 관리 역할이 없으면 서버 403을 역할 안내로 표시하고 등록 영역을 열지 않는다', async () => {
    stubFetch({ [`GET ${perfsUrl()}`]: () => problem(403, 'FORBIDDEN') })
    renderApp(route(EVENT_A))
    const region = await screen.findByRole('region', { name: '검증 회차' })
    expect(await within(region).findByText('이 영역에 필요한 역할이 없습니다')).toBeInTheDocument()
    expect(within(region).getByText(/REVIEWER.*TENANT_ADMIN/)).toBeInTheDocument()
    expect(within(region).queryByRole('region', { name: '검증 회차 등록' })).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('secret-detail')
  })

  it('서버가 공연을 범위 밖 404로 숨기면 회차를 표시하지 않는다', async () => {
    stubFetch({ [`GET ${perfsUrl(EVENT_B)}`]: () => new Response(null, { status: 404 }) })
    renderApp(route(EVENT_B))
    const region = await screen.findByRole('region', { name: '검증 회차' })
    expect(await within(region).findByText('공연을 찾을 수 없거나 접근 범위 밖입니다')).toBeInTheDocument()
    expect(within(region).queryByText('SYN-PERF-1')).not.toBeInTheDocument()
  })

  it('접근 가능 공연 목록에 없는 주소의 공연은 회차 API를 호출하지 않는다', async () => {
    const calls = stubFetch({})
    renderApp(route(EVENT_OUTSIDE))
    expect(await screen.findByText('선택한 공연에 접근할 수 없습니다')).toBeInTheDocument()
    expect(calls.some((call) => call.url.includes('/verified-performances'))).toBe(false)
  })

  it('다른 공연의 회차가 섞인 응답은 표시하지 않는다', async () => {
    stubFetch({ [`GET ${perfsUrl()}`]: () => json(200, [performance({ eventId: EVENT_B })]) })
    renderApp(route(EVENT_A))
    const region = await screen.findByRole('region', { name: '검증 회차' })
    expect(await within(region).findByText('서버 응답 형식이 계약과 다릅니다')).toBeInTheDocument()
  })

  it('팬 제보 목록에서 같은 공연의 회차 관리 화면으로 이동할 수 있다', async () => {
    stubFetch({ [`GET /api/v1/admin/fan-reports?eventId=${EVENT_A}&page=0&pageSize=20`]: () => json(200, { event: events.items[0], items: [], page: 0, pageSize: 20, totalItems: 0, hasNext: false }) })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    const link = await screen.findByRole('link', { name: '이 공연의 검증 회차 관리' })
    expect(link).toHaveAttribute('href', route(EVENT_A))
  })
})
