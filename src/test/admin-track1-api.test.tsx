import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { adminApiPath, isAllowedAdminApiPath } from '../api/adminApiClient'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// Mock 인증 어댑터와 fetch로 관리자 공연 선택과 Track 1 실제 API 연동 계약을 검증한다.
// 실제 Keycloak과 Spring HTTP 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const EVENT_B = '44444444-4444-4444-8444-444444444444'
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'

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
  return new Response(JSON.stringify({ status, code, requestId: '00000000-0000-4000-8000-000000000000', detail: '내부 고객사 정보' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

// Backend main 7c772ac의 ProblemDetail 형식(title, status, instance, code, requestId)이다.
// 계약에는 detail이 없지만 내부 정보가 섞여 와도 화면에 노출하지 않는지 확인하려고 넣는다.
function problemDetail(status: number, title: string, code: string, instance: string) {
  return new Response(JSON.stringify({ title, status, instance, code, requestId: '00000000-0000-4000-8000-000000000001', detail: '내부 고객사 정보' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

// Track 1 API는 CaseErrorHandler 범위 밖이라 DB 장애 시 Spring 기본 500 본문을 반환한다(Backend main 7c772ac 기준).
function springDefault500(path: string) {
  return new Response(JSON.stringify({ timestamp: '2026-11-01T23:50:03.313Z', status: 500, error: 'Internal Server Error', path }), { status: 500, headers: { 'Content-Type': 'application/json' } })
}

const eventA = { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }
const eventB = { id: EVENT_B, externalEventId: 'synthetic-b', name: '합성 공연 B' }
function eventPage(items = [eventA, eventB], extra: Partial<{ page: number; hasNext: boolean; totalItems: number }> = {}) {
  return { items, page: 0, pageSize: 100, totalItems: items.length, hasNext: false, ...extra }
}

function summary(overrides: Record<string, unknown> = {}) {
  return { analysisRequestId: 'run-1', clusterId: 'cluster-1', riskScore: 0.82, analysisAlgorithm: 'LOUVAIN', analysisAlgorithmVersion: '1.0.0', analyzedAt: '2026-10-08T10:15:30Z', storedMemberCount: 2, ...overrides }
}

function clusterPage(event = eventA, items = [summary()], extra: Record<string, unknown> = {}) {
  return { event, items, page: 0, pageSize: 20, totalItems: items.length, hasNext: false, coverage: 'STORED_EVIDENCE_ONLY', ...extra }
}

function clusterListPath(eventId: string, page = 0, sort = 'priority-desc') {
  return `/api/v1/admin/track1/clusters?eventId=${eventId}&page=${page}&pageSize=20&sort=${sort}`
}

type Route = (url: string) => Response | Promise<Response> | undefined
function stubFetch(route: Route) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const response = await route(url)
    if (!response) throw new Error(`예상하지 못한 요청: ${url}`)
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestedUrls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.map(([url]) => String(url))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('관리자 API 경로 생성', () => {
  it('슬래시와 특수문자가 있는 식별자를 쿼리로 인코딩하고 경로 검사를 통과한다', () => {
    const path = adminApiPath('/api/v1/admin/track1/clusters/detail', { eventId: EVENT_A, analysisRequestId: "run/1 (재)'*!", clusterId: 'a&b=c' })
    expect(path).toBe(`/api/v1/admin/track1/clusters/detail?eventId=${EVENT_A}&analysisRequestId=run%2F1%20%28%EC%9E%AC%29%27%2A%21&clusterId=a%26b%3Dc`)
    expect(isAllowedAdminApiPath(path)).toBe(true)
  })
})

describe('관리자 공연 선택', () => {
  it('인증 세션에서는 합성 데모 데이터를 표시하지 않고 접근 가능한 공연 목록을 조회한다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage()) : undefined)
    renderApp('/app/analysis/findings')
    const select = await screen.findByRole('combobox', { name: '조회할 공연' })
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['공연을 선택해 주세요', '합성 공연 A', '합성 공연 B'])
    expect(screen.getByRole('heading', { name: '공연을 선택해 주세요' })).toBeInTheDocument()
    expect(screen.queryByText(/DEMO-/)).not.toBeInTheDocument()
    expect(screen.queryByText(/합성 데모 데이터/)).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
    const init = fetchMock.mock.calls[0][1]
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
  })

  it('접근 가능한 공연이 없으면 장애가 아닌 정상 빈 목록으로 안내하고 Track 1을 호출하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage([])) : undefined)
    renderApp('/app/analysis/findings')
    expect(await screen.findByRole('heading', { name: '접근 가능한 공연이 없습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
  })

  it('409 TENANT_SELECTION_REQUIRED는 다중 고객사 미지원으로 차단하고 서버 상세 메시지를 노출하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? problem(409, 'TENANT_SELECTION_REQUIRED') : undefined)
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('여러 고객사 소속 계정은 아직 지원하지 않습니다')
    expect(screen.queryByText(/내부 고객사 정보/)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '조회할 공연' })).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
  })

  it.each([
    [503, '서버가 일시적으로 응답할 수 없습니다'],
    [500, '서버 오류로 조회하지 못했습니다'],
    [403, '이 화면에 필요한 역할이 없습니다'],
  ])('공연 목록 %i 응답은 빈 목록으로 대체하지 않는다', async (status, message) => {
    stubFetch((url) => url === EVENTS_PATH ? (status === 403 ? new Response(null, { status }) : problem(status, status === 503 ? 'DEPENDENCY_UNAVAILABLE' : 'INTERNAL_ERROR')) : undefined)
    renderApp('/app/analysis/findings')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('heading', { name: '접근 가능한 공연이 없습니다' })).not.toBeInTheDocument()
  })

  it('공연 목록 503 이후 다시 시도하면 같은 요청으로 복구하고 장애 중에는 Track 1을 호출하지 않는다', async () => {
    let calls = 0
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) { calls += 1; return calls === 1 ? problemDetail(503, 'Service Unavailable', 'DEPENDENCY_UNAVAILABLE', '/api/v1/admin/events') : json(200, eventPage()) }
      if (url === clusterListPath(EVENT_A)) return json(200, clusterPage())
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('서버가 일시적으로 응답할 수 없습니다')
    expect(screen.queryByText(/내부 고객사 정보/)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '조회할 공연' })).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])

    fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('link', { name: 'cluster-1 상세 보기' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`/app/analysis/findings?eventId=${EVENT_A}`)
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, EVENTS_PATH, clusterListPath(EVENT_A)])
  })

  it('공연 목록 응답 계약이 다르면 오류로 처리한다', async () => {
    stubFetch((url) => url === EVENTS_PATH ? json(200, { items: [{ id: 'not-a-uuid', name: '합성' }], page: 0, pageSize: 100, totalItems: 1, hasNext: false }) : undefined)
    renderApp('/app/analysis/findings')
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
  })

  it('URL의 공연이 접근 가능 목록에 없으면 Track 1을 호출하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage([eventB])) : undefined)
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('선택한 공연에 접근할 수 없습니다')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
  })

  it('UUID가 아닌 공연 값은 추가 페이지를 조회하지 않고 접근 불가로 표시한다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage([eventA], { hasNext: true, totalItems: 2 })) : undefined)
    renderApp('/app/analysis/findings?eventId=abc')
    expect(await screen.findByRole('alert')).toHaveTextContent('선택한 공연에 접근할 수 없습니다')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
  })

  it('URL의 공연이 다음 서버 페이지에 있으면 이어서 조회해 접근 가능 여부를 확인한다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage([eventB], { hasNext: true, totalItems: 2 }))
      if (url === '/api/v1/admin/events?page=1&pageSize=100') return json(200, eventPage([eventA], { page: 1, totalItems: 2 }))
      if (url === clusterListPath(EVENT_A)) return json(200, clusterPage())
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    expect(await screen.findByRole('link', { name: 'cluster-1 상세 보기' })).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, '/api/v1/admin/events?page=1&pageSize=100', clusterListPath(EVENT_A)])
  })

  it('공연 더 불러오기는 다음 서버 페이지를 이어 붙인다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage([eventA], { hasNext: true, totalItems: 2 }))
      if (url === '/api/v1/admin/events?page=1&pageSize=100') return json(200, eventPage([eventB], { page: 1, totalItems: 2 }))
      return undefined
    })
    renderApp('/app/analysis/findings')
    fireEvent.click(await screen.findByRole('button', { name: '공연 더 불러오기' }))
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: '조회할 공연' })).getAllByRole('option')).toHaveLength(3))
    expect(screen.queryByRole('button', { name: '공연 더 불러오기' })).not.toBeInTheDocument()
  })
})

describe('Track 1 군집 목록 실제 API', () => {
  it('선택한 공연의 서버 페이지를 조회하고 Risk Score를 조사 우선순위로 표시한다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) return json(200, clusterPage(eventA, [summary(), summary({ analysisRequestId: 'run/2', clusterId: 'cluster 2', riskScore: null, analyzedAt: null, storedMemberCount: 1 })], { totalItems: 45, hasNext: true }))
      if (url === clusterListPath(EVENT_A, 1)) return json(200, clusterPage(eventA, [summary({ clusterId: 'cluster-21' })], { page: 1, totalItems: 45, hasNext: true }))
      return undefined
    })
    renderApp('/app/analysis/findings')
    fireEvent.change(await screen.findByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_A } })
    const table = await screen.findByRole('table', { name: 'Track 1 저장 증거 군집 목록' })
    expect(within(table).getByText('0.82')).toBeInTheDocument()
    expect(within(table).getByText('값 없음')).toBeInTheDocument()
    expect(within(table).queryByText('0.00')).not.toBeInTheDocument()
    expect(screen.getByText('45건')).toBeInTheDocument()
    expect(screen.getByText('1 / 3 페이지')).toBeInTheDocument()
    expect(screen.getByText(/부정 거래 확률이 아닙니다/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '검색' })).not.toBeInTheDocument()
    const detail = screen.getByRole('link', { name: 'cluster 2 상세 보기' })
    const href = new URL(detail.getAttribute('href')!, 'https://frontend.invalid')
    expect(href.pathname).toBe('/app/analysis/findings/detail')
    expect(Object.fromEntries(href.searchParams)).toEqual({ eventId: EVENT_A, analysisRequestId: 'run/2', clusterId: 'cluster 2' })

    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByRole('link', { name: 'cluster-21 상세 보기' })).toBeInTheDocument()
    expect(screen.getByText('2 / 3 페이지')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`/app/analysis/findings?eventId=${EVENT_A}&page=1`)
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, clusterListPath(EVENT_A), clusterListPath(EVENT_A, 1)])
  })

  it('정렬 변경은 서버 정렬 값으로 첫 페이지를 다시 조회한다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url.startsWith('/api/v1/admin/track1/clusters?')) return json(200, clusterPage())
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}&page=0`)
    await screen.findByRole('link', { name: 'cluster-1 상세 보기' })
    fireEvent.change(screen.getByRole('combobox', { name: '정렬' }), { target: { value: 'recent' } })
    await waitFor(() => expect(requestedUrls(fetchMock)).toContain(clusterListPath(EVENT_A, 0, 'recent')))
  })

  it('공연을 바꾸면 이전 공연의 늦은 응답을 표시하지 않는다', async () => {
    let releaseA: (response: Response) => void = () => {}
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) return new Promise<Response>((resolve) => { releaseA = resolve })
      if (url === clusterListPath(EVENT_B)) return json(200, clusterPage(eventB, [summary({ clusterId: 'cluster-b' })]))
      return undefined
    })
    renderApp('/app/analysis/findings')
    const select = await screen.findByRole('combobox', { name: '조회할 공연' })
    fireEvent.change(select, { target: { value: EVENT_A } })
    await waitFor(() => expect(screen.getByRole('status', { name: '군집 목록을 불러오는 중' })).toBeInTheDocument())
    fireEvent.change(select, { target: { value: EVENT_B } })
    expect(await screen.findByRole('link', { name: 'cluster-b 상세 보기' })).toBeInTheDocument()
    releaseA(json(200, clusterPage(eventA, [summary({ clusterId: 'cluster-a-late' })])))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('cluster-a-late')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'cluster-b 상세 보기' })).toBeInTheDocument()
  })

  it('이전 공연의 조회 오류는 다른 공연으로 바꾸면 남지 않고 새 공연 데이터만 표시한다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) return springDefault500('/api/v1/admin/track1/clusters')
      if (url === clusterListPath(EVENT_B)) return json(200, clusterPage(eventB, [summary({ clusterId: 'cluster-b' })]))
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}&page=0`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류로 조회하지 못했습니다')
    fireEvent.change(screen.getByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_B } })
    expect(await screen.findByRole('link', { name: 'cluster-b 상세 보기' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('cluster-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`/app/analysis/findings?eventId=${EVENT_B}`)
  })

  it('새로고침하면 주소의 page와 sort로 같은 서버 페이지를 다시 조회한다', async () => {
    const page1 = clusterPage(eventA, [summary({ clusterId: 'cluster-asc-21' })], { page: 1, totalItems: 45, hasNext: true })
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A, 0, 'priority-asc')) return json(200, clusterPage(eventA, [summary({ clusterId: 'cluster-asc-1' })], { totalItems: 45, hasNext: true }))
      if (url === clusterListPath(EVENT_A, 1, 'priority-asc')) return json(200, page1)
      return undefined
    })
    const first = renderApp(`/app/analysis/findings?eventId=${EVENT_A}&sort=priority-asc`)
    fireEvent.click(await screen.findByRole('button', { name: '다음' }))
    expect(await screen.findByRole('link', { name: 'cluster-asc-21 상세 보기' })).toBeInTheDocument()
    const restored = screen.getByTestId('location').textContent!
    expect(new URLSearchParams(restored.split('?')[1]).get('sort')).toBe('priority-asc')
    first.unmount()
    fetchMock.mockClear()

    // 새로고침은 화면 상태 없이 주소만으로 다시 시작한다.
    renderApp(restored)
    expect(await screen.findByRole('link', { name: 'cluster-asc-21 상세 보기' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '정렬' })).toHaveValue('priority-asc')
    expect(screen.getByText('2 / 3 페이지')).toBeInTheDocument()
    expect(screen.queryByText('cluster-asc-1')).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, clusterListPath(EVENT_A, 1, 'priority-asc')])
  })

  it('저장된 군집이 0건이면 장애와 구분된 빈 상태를 표시한다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) return json(200, clusterPage(eventA, []))
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    expect(await screen.findByRole('heading', { name: '저장된 군집이 없습니다' })).toBeInTheDocument()
    expect(screen.getByText(/분석 실행 여부나 분석 실패 여부를 뜻하지 않습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['400', () => problem(400, 'INVALID_REQUEST'), '요청 값이 올바르지 않습니다'],
    ['403', () => new Response(null, { status: 403 }), '이 화면에 필요한 역할이 없습니다'],
    ['404', () => new Response(null, { status: 404 }), '공연을 찾을 수 없거나 접근 범위 밖입니다'],
    ['409', () => problem(409, 'TENANT_SELECTION_REQUIRED'), '여러 고객사 소속 계정은 아직 지원하지 않습니다'],
    ['500', () => new Response(JSON.stringify({ status: 500, error: 'Internal Server Error' }), { status: 500 }), '서버 오류로 조회하지 못했습니다'],
    ['503', () => problem(503, 'DEPENDENCY_UNAVAILABLE'), '서버가 일시적으로 응답할 수 없습니다'],
    ['network', () => Promise.reject(new TypeError('Failed to fetch')), '서버에 연결하지 못했습니다'],
    ['계약 불일치', () => json(200, { ...clusterPage(), coverage: 'FULL_GRAPH' }), '서버 응답 형식이 계약과 다릅니다'],
    ['다른 공연 응답', () => json(200, clusterPage(eventB)), '서버 응답 형식이 계약과 다릅니다'],
    ['필수 필드 누락', () => json(200, { ...clusterPage(), items: [{ clusterId: 'cluster-1' }] }), '서버 응답 형식이 계약과 다릅니다'],
  ])('군집 목록 %s 응답을 구분하고 빈 목록이나 데모 데이터로 대체하지 않는다', async (_label, respond, message) => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) return respond()
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('heading', { name: '저장된 군집이 없습니다' })).not.toBeInTheDocument()
    expect(screen.queryByText(/DEMO-/)).not.toBeInTheDocument()
    expect(screen.queryByText(/내부 고객사 정보/)).not.toBeInTheDocument()
  })

  it('401 응답은 세션을 정리하고 재로그인 화면으로 전환한다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) return new Response(null, { status: 401 })
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 로그인' })).toBeInTheDocument()
  })

  it('다시 시도하면 같은 조건으로 다시 조회한다', async () => {
    let calls = 0
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) { calls += 1; return calls === 1 ? problem(503, 'DEPENDENCY_UNAVAILABLE') : json(200, clusterPage()) }
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('link', { name: 'cluster-1 상세 보기' })).toBeInTheDocument()
  })
})

describe('Track 1 군집 상세 실제 API', () => {
  const detailRoute = `/app/analysis/findings/detail?eventId=${EVENT_A}&analysisRequestId=run%2F1&clusterId=cluster-1`
  const detailApi = `/api/v1/admin/track1/clusters/detail?eventId=${EVENT_A}&analysisRequestId=run%2F1&clusterId=cluster-1`
  const detailBody = {
    event: eventA,
    cluster: summary({ analysisRequestId: 'run/1', storedMemberCount: 2 }),
    members: [{ auditId: 123, accountId: 'account-1', reservationNo: 'reservation-1' }, { auditId: 124, accountId: 'account-2', reservationNo: 'reservation-2' }],
    coverage: 'STORED_EVIDENCE_ONLY',
  }

  it('직접 URL의 세 식별자로 상세를 조회하고 저장된 구성원과 분석 정보만 표시한다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage()) : url === detailApi ? json(200, detailBody) : undefined)
    renderApp(detailRoute)
    expect(await screen.findByRole('heading', { name: '군집 cluster-1' })).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, detailApi])
    const members = screen.getByRole('table', { name: '저장된 군집 구성원' })
    expect(within(members).getAllByRole('row')).toHaveLength(3)
    expect(within(members).getByText('account-2')).toBeInTheDocument()
    expect(within(members).getByText('reservation-1')).toBeInTheDocument()
    expect(screen.getByText('run/1')).toBeInTheDocument()
    expect(screen.getByText('LOUVAIN 1.0.0')).toBeInTheDocument()
    expect(screen.getByText('합성 공연 A')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '연결 관계 그래프를 표시할 수 없습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /관계 그래프/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '연결 신호 필터' })).not.toBeInTheDocument()
    expect(screen.queryByText(/DEMO-/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Case 생성' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '← 군집 목록' })).toHaveAttribute('href', `/app/analysis/findings?eventId=${EVENT_A}`)
  })

  it('목록에서 상세로 이동할 때 식별자를 유지한다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === clusterListPath(EVENT_A)) return json(200, clusterPage(eventA, [summary({ analysisRequestId: 'run/1' })]))
      if (url === detailApi) return json(200, detailBody)
      return undefined
    })
    renderApp(`/app/analysis/findings?eventId=${EVENT_A}`)
    fireEvent.click(await screen.findByRole('link', { name: 'cluster-1 상세 보기' }))
    expect(await screen.findByRole('heading', { name: '군집 cluster-1' })).toBeInTheDocument()
    expect(requestedUrls(fetchMock).at(-1)).toBe(detailApi)
  })

  // Backend #58(main 7c772ac)부터 Track 1 API도 다중 고객사 계정을 409로 막는다. Frontend는 그와 별도로 상세 직접 주소에서도 공연 접근 검증을 먼저 거친다.
  it('다중 고객사 계정(공연 목록 409)은 상세 직접 주소에서도 Track 1을 호출하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? problem(409, 'TENANT_SELECTION_REQUIRED') : url === detailApi ? json(200, detailBody) : undefined)
    renderApp(detailRoute)
    expect(await screen.findByRole('alert')).toHaveTextContent('여러 고객사 소속 계정은 아직 지원하지 않습니다')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
    expect(screen.queryByText('account-1')).not.toBeInTheDocument()
  })

  it('접근 가능 공연 목록에 없는 공연의 상세 주소는 Track 1을 호출하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage([eventB])) : url === detailApi ? json(200, detailBody) : undefined)
    renderApp(detailRoute)
    expect(await screen.findByRole('alert')).toHaveTextContent('선택한 공연에 접근할 수 없습니다')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
  })

  it.each([
    ['eventId 누락', '/app/analysis/findings/detail?analysisRequestId=run-1&clusterId=cluster-1'],
    ['UUID가 아닌 eventId', '/app/analysis/findings/detail?eventId=abc&analysisRequestId=run-1&clusterId=cluster-1'],
    ['clusterId 누락', `/app/analysis/findings/detail?eventId=${EVENT_A}&analysisRequestId=run-1`],
    ['데모 상세 경로', '/app/analysis/findings/DEMO-CL-001'],
  ])('%s 주소는 API를 호출하지 않고 오류를 표시한다', async (_label, path) => {
    const fetchMock = stubFetch(() => undefined)
    renderApp(path)
    expect(await screen.findByRole('alert')).toHaveTextContent('군집 주소가 올바르지 않습니다')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/DEMO-ACC/)).not.toBeInTheDocument()
  })

  it.each([
    ['404', () => new Response(null, { status: 404 }), '군집을 찾을 수 없거나 접근 범위 밖입니다'],
    ['403', () => new Response(null, { status: 403 }), '이 화면에 필요한 역할이 없습니다'],
    ['500', () => problem(500, 'INTERNAL_ERROR'), '서버 오류로 조회하지 못했습니다'],
    ['network', () => Promise.reject(new TypeError('Failed to fetch')), '서버에 연결하지 못했습니다'],
    ['다른 군집 응답', () => json(200, { ...detailBody, cluster: summary({ analysisRequestId: 'run/1', clusterId: 'cluster-9' }) }), '서버 응답 형식이 계약과 다릅니다'],
    ['구성원 형식 오류', () => json(200, { ...detailBody, members: [{ auditId: '123', accountId: 'account-1' }] }), '서버 응답 형식이 계약과 다릅니다'],
  ])('상세 %s 응답을 구분해 표시한다', async (_label, respond, message) => {
    stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage()) : url === detailApi ? respond() : undefined)
    renderApp(detailRoute)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('table', { name: '저장된 군집 구성원' })).not.toBeInTheDocument()
  })

  // 공연 목록 확인을 통과한 뒤 상세 API가 막히는 경우다. 409는 Backend 7c772ac의 실제 응답 형식이다.
  // Track 1의 실제 DB 장애 응답은 Spring 기본 500이며, 503은 현재 Track 1 계약이 아니라 방어적으로만 확인한다.
  it.each([
    ['409 TENANT_SELECTION_REQUIRED', () => problemDetail(409, 'Conflict', 'TENANT_SELECTION_REQUIRED', '/api/v1/admin/track1/clusters/detail'), '여러 고객사 소속 계정은 아직 지원하지 않습니다'],
    ['DB 장애(실제 계약 500)', () => springDefault500('/api/v1/admin/track1/clusters/detail'), '서버 오류로 조회하지 못했습니다'],
    ['503(현재 Track 1 계약 아님)', () => problemDetail(503, 'Service Unavailable', 'DEPENDENCY_UNAVAILABLE', '/api/v1/admin/track1/clusters/detail'), '서버가 일시적으로 응답할 수 없습니다'],
  ])('공연 확인 이후 상세 %s 응답은 구성원을 표시하지 않고 내부 정보를 노출하지 않는다', async (_label, respond, message) => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage()) : url === detailApi ? respond() : undefined)
    renderApp(detailRoute)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, detailApi])
    expect(screen.queryByRole('table', { name: '저장된 군집 구성원' })).not.toBeInTheDocument()
    expect(screen.queryByText(/내부 고객사 정보|Internal Server Error|DEPENDENCY_UNAVAILABLE|TENANT_SELECTION_REQUIRED/)).not.toBeInTheDocument()
    expect(screen.queryByText('account-1')).not.toBeInTheDocument()
  })

  it('상세 조회 오류 이후 다시 시도하면 같은 식별자로 다시 조회해 복구한다', async () => {
    let calls = 0
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === detailApi) { calls += 1; return calls === 1 ? springDefault500('/api/v1/admin/track1/clusters/detail') : json(200, detailBody) }
      return undefined
    })
    renderApp(detailRoute)
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '군집 cluster-1' })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: '저장된 군집 구성원' })).getAllByRole('row')).toHaveLength(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, detailApi, detailApi])
  })

  it('상세 주소의 공연 확인이 503이면 상세를 호출하지 않고, 다시 시도해 공연이 확인된 뒤에만 상세를 조회한다', async () => {
    let calls = 0
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) { calls += 1; return calls === 1 ? problemDetail(503, 'Service Unavailable', 'DEPENDENCY_UNAVAILABLE', '/api/v1/admin/events') : json(200, eventPage()) }
      if (url === detailApi) return json(200, detailBody)
      return undefined
    })
    renderApp(detailRoute)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('서버가 일시적으로 응답할 수 없습니다')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
    fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '군집 cluster-1' })).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, EVENTS_PATH, detailApi])
  })
})
