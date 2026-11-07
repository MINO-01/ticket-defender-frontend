import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { track2PipelineDefault, withoutPipelineReads } from './track2PipelineDefaults'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// Mock 인증 어댑터와 fetch로 관리자 Track 2 팬 제보 조회 API 연동 계약을 검증한다.
// 응답 형식은 Backend main a1eb50c의 AdminFanReportDto와 ListingContextAnalysisDto 직렬화 형식을 따른다.
// 실제 Keycloak과 Spring HTTP 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const EVENT_B = '44444444-4444-4444-8444-444444444444'
const REPORT_1 = '55555555-5555-4555-8555-555555555551'
const REPORT_2 = '55555555-5555-4555-8555-555555555552'
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661'
const EVIDENCE_2 = '66666666-6666-4666-8666-666666666662'
const EVIDENCE_OTHER = '66666666-6666-4666-8666-666666666669'
const SHA = 'a'.repeat(64)
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'

function createMockAdapter(token: string | null = SYNTHETIC_TOKEN) {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => token === null ? null : { value: token, expiresAt: Date.now() + 600_000 }),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function TestNavigator() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(`/app/fan-reports/${REPORT_2}`)}>테스트 제보 2로 이동</button>
}

function renderApp(path: string, adapter = createMockAdapter()) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={adapter} /><LocationProbe /><TestNavigator /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Backend ProblemDetail 형식(title, status, instance, code, requestId)이다. 계약에 없는 detail에 내부 정보가 섞여 와도 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ title: 'Problem', status, instance: '/api/v1/admin/fan-reports', code, requestId: '00000000-0000-4000-8000-000000000000', detail: '내부 고객사 정보 SQLSTATE' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

const eventA = { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }
const eventB = { id: EVENT_B, externalEventId: 'synthetic-b', name: '합성 공연 B' }
const eventPage = (items = [eventA, eventB]) => ({ items, page: 0, pageSize: 100, totalItems: items.length, hasNext: false })

function summary(overrides: Record<string, unknown> = {}) {
  return { fanReportId: REPORT_1, reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED', receivedAt: '2026-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z', evidenceCount: 2, storedEvidenceCount: 1, ...overrides }
}

function reportPage(event = eventA, items = [summary()], extra: Record<string, unknown> = {}) {
  return { event, items, page: 0, pageSize: 20, totalItems: items.length, hasNext: false, ...extra }
}

function listPath(eventId: string, page = 0, intakeStatus?: string) {
  return `/api/v1/admin/fan-reports?eventId=${eventId}&page=${page}&pageSize=20${intakeStatus ? `&intakeStatus=${intakeStatus}` : ''}`
}

const storedEvidence = { evidenceId: EVIDENCE_1, mediaType: 'image/png', byteSize: 20480, storageStatus: 'STORED', originalStored: true, sha256: SHA, createdAt: '2026-11-01T09:30:00Z' }
const failedEvidence = { evidenceId: EVIDENCE_2, mediaType: 'image/jpeg', byteSize: 512, storageStatus: 'FAILED', originalStored: false, sha256: null, createdAt: '2026-11-01T09:30:00Z' }

function detail(overrides: Record<string, unknown> = {}) {
  return {
    fanReportId: REPORT_1, event: eventA, reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED',
    receivedAt: '2026-11-01T09:30:00Z', retentionUntil: '2027-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z',
    seatArea: 'R석 2구역', description: '<img src=x onerror=alert(1)> 합성 설명\n둘째 줄', listingUrl: 'https://listing.invalid/item/1',
    platform: '합성 마켓', seller: '합성판매자', askingPrice: 250000, evidence: [storedEvidence, failedEvidence], ...overrides,
  }
}

const detailPath = (id = REPORT_1) => `/api/v1/admin/fan-reports/${id}`
const historyPath = (evidenceId = EVIDENCE_1, page = 0, reportId = REPORT_1) => `/api/v1/admin/fan-reports/${reportId}/evidence/${evidenceId}/listing-analyses?page=${page}&pageSize=20`

const found = (value: unknown, quote: string) => ({ state: 'FOUND', value, evidenceQuote: quote, unknownReason: null, candidates: [] })
const unknown = (reason: string) => ({ state: 'UNKNOWN', value: null, evidenceQuote: null, unknownReason: reason, candidates: [] })
const ambiguous = (quote: string, candidates: string[]) => ({ state: 'AMBIGUOUS', value: null, evidenceQuote: quote, unknownReason: null, candidates })

const fields = {
  eventName: found('합성 콘서트 관찰명', '합성 콘서트 관찰명 양도'),
  performanceAt: unknown('ABSENT'),
  platformDisplayName: found('합성 마켓 표시', '합성 마켓 표시'),
  askingPrice: found({ raw: '250,000원', amount: '250000' }, '가격 250,000원'),
  currency: found('KRW', '원'),
  saleText: found('양도합니다', '양도합니다'),
  zone: ambiguous('R석 2? 3?', ['2구역', '3구역']),
  row: unknown('UNREADABLE'),
  seat: unknown('NOT_CONFIRMED'),
}

// ListingContextAnalysisDto의 analyzedAt, createdAt, completedAt은 LocalDateTime이라 오프셋 없이 직렬화된다.
function analysis(overrides: Record<string, unknown> = {}) {
  return {
    analysisId: '77777777-7777-4777-8777-777777777771', fanReportId: REPORT_1, evidenceId: EVIDENCE_1, requestId: '88888888-8888-4888-8888-888888888881',
    executionStatus: 'SUCCEEDED', analysisStatus: 'PARTIAL', errorCode: null, analyzerHttpStatus: null, analyzerErrorCode: null,
    input: { expectedSha256: SHA, verifiedSha256: SHA, expectedByteSize: 20480, verifiedByteSize: 20480, mediaType: 'image/png' },
    modelName: 'synthetic-vlm', modelVersion: '2026-10', analyzedAt: '2026-11-01T10:00:00', reviewRequired: true, fields,
    candidateMatch: { status: 'NOT_LINKED', reason: 'PERFORMANCE_REF_UNVERIFIED' }, createdAt: '2026-11-01T09:59:58', completedAt: '2026-11-01T10:00:01', ...overrides,
  }
}

function failedAnalysis(overrides: Record<string, unknown> = {}) {
  return analysis({
    analysisId: '77777777-7777-4777-8777-777777777772', executionStatus: 'ANALYZER_FAILED', analysisStatus: 'FAILED', errorCode: 'ANALYZER_MODEL_FAILED',
    analyzerHttpStatus: 502, analyzerErrorCode: 'MODEL_FAILED', modelName: null, modelVersion: null, analyzedAt: null, reviewRequired: null, fields: null,
    candidateMatch: { status: 'NOT_LINKED', reason: 'ANALYSIS_NOT_SUCCEEDED' }, createdAt: '2026-11-01T09:00:00', completedAt: '2026-11-01T09:00:05', ...overrides,
  })
}

const analysisPage = (items: unknown[] = [], extra: Record<string, unknown> = {}) => ({ items, page: 0, pageSize: 20, hasNext: false, ...extra })

type Route = (url: string) => Response | Promise<Response> | undefined
function stubFetch(route: Route) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const response = await route(url) ?? track2PipelineDefault(url)
    if (!response) throw new Error(`예상하지 못한 요청: ${url}`)
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// 회차 영역의 기본 조회(Issue #37)는 각 테스트의 요청 순서 검증 대상이 아니어서 뺀다.
const requestedUrls = (fetchMock: ReturnType<typeof stubFetch>) => withoutPipelineReads(fetchMock.mock.calls.map(([url]) => String(url)))

/** 기본 상세 응답과 증거별 분석 이력을 돌려주는 라우터다. */
function detailRoute(history: Record<string, unknown> = { [historyPath()]: analysisPage([analysis()]), [historyPath(EVIDENCE_2)]: analysisPage() }, body = detail()): Route {
  return (url) => {
    if (url === detailPath()) return json(200, body)
    if (url in history) return json(200, history[url])
    return undefined
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Track 2 팬 제보 목록 실제 API', () => {
  it('인증된 관리자는 선택한 공연의 서버 목록만 Bearer 토큰으로 조회하고 데모 데이터를 섞지 않는다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, reportPage(eventA, [summary(), summary({ fanReportId: REPORT_2, reportType: 'FAKE_TICKET', intakeStatus: 'STORAGE_FAILED', evidenceCount: 1, storedEvidenceCount: 0 })], { totalItems: 2 }))
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: `${REPORT_1} 상세 보기` })).toBeInTheDocument()
    expect(within(table).getByText('고액 재판매 정황')).toBeInTheDocument()
    expect(within(table).getByText('접수 완료')).toBeInTheDocument()
    expect(within(table).getByText('접수 실패 (증거 저장 실패)')).toBeInTheDocument()
    expect(within(table).getByText('1 / 2개')).toBeInTheDocument()
    expect(within(table).getByText('0 / 1개')).toBeInTheDocument()
    expect(within(table).getAllByText('2026-11-01 09:30 UTC')).toHaveLength(2)
    expect(within(table).getAllByText('검증된 회차 아님')).toHaveLength(2)
    expect(within(table).getByRole('link', { name: `${REPORT_1} 상세 보기` })).toHaveAttribute('href', `/app/fan-reports/${REPORT_1}`)
    expect(screen.getByText('제보 수 (전체 접수 상태)').closest('section')).toHaveTextContent('2건')
    // 서버가 제공하지 않는 통계, 검색, 분석 상태와 예매 대조 필터를 표시하지 않는다.
    expect(screen.queryByText('추출 완료')).not.toBeInTheDocument()
    expect(screen.queryByText('일치 후보')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '검색' })).not.toBeInTheDocument()
    expect(screen.queryByText(/DEMO-|합성 데모 데이터/)).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, listPath(EVENT_A)])
    for (const [url, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
      expect(String(url)).not.toMatch(/tenant|role/i)
    }
  })

  it('인증 전에는 공연, 제보, 분석 이력 API를 호출하지 않는다', async () => {
    const fetchMock = stubFetch(() => undefined)
    renderApp(`/app/fan-reports/${REPORT_1}`, createMockAdapter(null))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('공연을 고르기 전에는 제보 목록을 조회하지 않고, 접근 목록에 없는 공연은 조회하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage([eventB])) : undefined)
    const view = renderApp('/app/fan-reports')
    expect(await screen.findByRole('heading', { name: '공연을 선택해 주세요' })).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
    view.unmount()
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('선택한 공연에 접근할 수 없습니다')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, EVENTS_PATH])
  })

  it('공연을 바꾸면 이전 목록을 지우고 늦게 도착한 이전 공연 응답을 표시하지 않는다', async () => {
    const lateA = deferred()
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return lateA.promise
      if (url === listPath(EVENT_B)) return json(200, reportPage(eventB, [summary({ fanReportId: REPORT_2 })]))
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}&page=0`)
    expect(await screen.findByRole('status', { name: '팬 제보 목록을 불러오는 중' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_B } })
    expect(await screen.findByRole('link', { name: `${REPORT_2} 상세 보기` })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`/app/fan-reports?eventId=${EVENT_B}`)
    lateA.resolve(json(200, reportPage(eventA, [summary()])))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('link', { name: `${REPORT_1} 상세 보기` })).not.toBeInTheDocument()
    expect(screen.getByText('합성 공연 B 제보 목록')).toBeInTheDocument()
  })

  it('새로고침하면 주소의 공연, 페이지, 접수 상태로 같은 서버 페이지를 다시 조회하고 이동과 필터는 주소에 남긴다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A, 1, 'RECEIVED')) return json(200, reportPage(eventA, [summary({ fanReportId: REPORT_2 })], { page: 1, totalItems: 41, hasNext: true }))
      if (url === listPath(EVENT_A, 2, 'RECEIVED')) return json(200, reportPage(eventA, [summary()], { page: 2, totalItems: 41, hasNext: false }))
      if (url === listPath(EVENT_A, 0, 'STORAGE_FAILED')) return json(200, reportPage(eventA, [], { totalItems: 0 }))
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}&page=1&intakeStatus=RECEIVED`)
    expect(await screen.findByRole('link', { name: `${REPORT_2} 상세 보기` })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '접수 상태' })).toHaveValue('RECEIVED')
    expect(screen.getByText('2 / 3 페이지')).toBeInTheDocument()
    expect(screen.getByText('전체 41건 중 21~21번째')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('3 / 3 페이지')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
    expect(screen.getByTestId('location')).toHaveTextContent(`eventId=${EVENT_A}&page=2&intakeStatus=RECEIVED`)

    fireEvent.change(screen.getByRole('combobox', { name: '접수 상태' }), { target: { value: 'STORAGE_FAILED' } })
    expect(await screen.findByRole('heading', { name: '조건에 맞는 제보가 없습니다' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('page=0&intakeStatus=STORAGE_FAILED')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, listPath(EVENT_A, 1, 'RECEIVED'), listPath(EVENT_A, 2, 'RECEIVED'), listPath(EVENT_A, 0, 'STORAGE_FAILED')])
  })

  it('알 수 없는 접수 상태 값은 서버에 전달하지 않는다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, reportPage())
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}&intakeStatus=MATCH_CANDIDATE`)
    expect(await screen.findByRole('link', { name: `${REPORT_1} 상세 보기` })).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, listPath(EVENT_A)])
  })

  it('제보가 0건이면 오류가 아닌 빈 상태를, 조회 실패는 빈 목록이 아닌 오류를 표시하고 다시 시도로 복구한다', async () => {
    let calls = 0
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, reportPage(eventA, [], { totalItems: 0 }))
      if (url === listPath(EVENT_B)) { calls += 1; return calls === 1 ? problem(503, 'DEPENDENCY_UNAVAILABLE') : json(200, reportPage(eventB, [summary({ fanReportId: REPORT_2 })])) }
      return undefined
    })
    const view = renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    expect(await screen.findByRole('heading', { name: '조건에 맞는 제보가 없습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    view.unmount()

    renderApp(`/app/fan-reports?eventId=${EVENT_B}`)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('서버가 일시적으로 응답할 수 없습니다')
    expect(alert).toHaveTextContent('빈 결과로 간주하지 않습니다')
    expect(screen.queryByRole('heading', { name: '조건에 맞는 제보가 없습니다' })).not.toBeInTheDocument()
    expect(screen.queryByText(/내부 고객사 정보|SQLSTATE/)).not.toBeInTheDocument()
    fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('link', { name: `${REPORT_2} 상세 보기` })).toBeInTheDocument()
  })

  it.each([
    ['403', () => new Response(null, { status: 403 }), '이 화면에 필요한 역할이 없습니다'],
    ['404', () => problem(404, 'RESOURCE_NOT_FOUND'), '공연을 찾을 수 없거나 접근 범위 밖입니다'],
    ['409', () => problem(409, 'TENANT_SELECTION_REQUIRED'), '여러 고객사 소속 계정은 아직 지원하지 않습니다'],
    ['네트워크 장애', () => { throw new TypeError('Failed to fetch') }, '서버에 연결하지 못했습니다'],
  ])('목록 %s 응답은 데이터나 빈 목록 대신 오류로 표시한다', async (_label, respond, message) => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return respond()
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/DEMO-|내부 고객사 정보/)).not.toBeInTheDocument()
  })

  it('공연 목록의 다중 고객사 409는 제보 목록을 호출하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? problem(409, 'TENANT_SELECTION_REQUIRED') : undefined)
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('여러 고객사 소속 계정은 아직 지원하지 않습니다')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
  })

  it('401 응답은 세션을 정리하고 재로그인 화면으로 전환한다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return new Response(null, { status: 401 })
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(SYNTHETIC_TOKEN)
    expect(screen.getByTestId('location')).not.toHaveTextContent(SYNTHETIC_TOKEN)
  })

  it.each([
    ['다른 공연의 응답', reportPage(eventB)],
    ['요청과 다른 페이지', reportPage(eventA, [summary()], { page: 3 })],
    ['계약에 없는 접수 상태', reportPage(eventA, [summary({ intakeStatus: 'MATCH_CANDIDATE' })])],
    ['저장 증거 수가 접수 수보다 큰 항목', reportPage(eventA, [summary({ evidenceCount: 1, storedEvidenceCount: 2 })])],
    ['UUID가 아닌 제보 ID', reportPage(eventA, [summary({ fanReportId: 'DEMO-REP-008' })])],
  ])('%s은 계약 위반으로 표시하지 않는다', async (_label, body) => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, body)
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('필터와 다른 접수 상태의 항목이 섞인 응답은 표시하지 않는다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A, 0, 'RECEIVED')) return json(200, reportPage(eventA, [summary({ intakeStatus: 'STORAGE_FAILED' })]))
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}&intakeStatus=RECEIVED`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
  })
})

describe('Track 2 팬 제보 상세 실제 API', () => {
  it('직접 주소로 상세를 조회하고 팬 입력값은 링크나 HTML이 아닌 일반 텍스트로 표시한다', async () => {
    const fetchMock = stubFetch(detailRoute())
    const { container } = renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('heading', { name: '팬 제보 상세' })).toBeInTheDocument()
    expect(screen.getByText('합성 공연 A')).toBeInTheDocument()
    expect(screen.getByText('고액 재판매 정황')).toBeInTheDocument()
    expect(screen.getByText('접수 완료')).toBeInTheDocument()
    expect(screen.getByText('R석 2구역')).toBeInTheDocument()
    expect(screen.getByText('합성판매자')).toBeInTheDocument()
    expect(screen.getByText('250,000')).toBeInTheDocument()
    expect(screen.getByText('https://listing.invalid/item/1')).toBeInTheDocument()
    expect(container.querySelector('a[href*="listing.invalid"], iframe, img')).toBeNull()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> 합성 설명/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← 제보 목록' })).toHaveAttribute('href', `/app/fan-reports?eventId=${EVENT_A}`)
    await screen.findByText('분석 시점 미연결 (검증된 회차 정보가 없습니다)')
    // 상세 직접 주소는 상세와 상세 응답의 증거 ID로만 조회한다.
    expect(requestedUrls(fetchMock)).toEqual([detailPath(), historyPath()])
  })

  it('상단 조사 진행 요약은 상세 응답만으로 확인한 사실과 미확인 내용을 나누고 접수번호를 만들지 않는다', async () => {
    stubFetch(detailRoute())
    const view = renderApp(`/app/fan-reports/${REPORT_1}`)
    const guide = await screen.findByRole('region', { name: '조사 진행 요약' })
    expect(within(guide).getByRole('region', { name: '확인한 사실' })).toHaveTextContent('접수 상태: 접수 완료')
    expect(within(guide).getByRole('region', { name: '아직 확인되지 않은 내용' })).toHaveTextContent('판매자 표시는 확인된 신원이 아니며')
    expect(within(guide).getByRole('region', { name: '다음 작업' })).toHaveTextContent('이미지 정보 추출')
    expect(within(screen.getByRole('navigation', { name: '팬 제보 조사 단계' })).getAllByRole('link')).toHaveLength(5)
    // 관리자 API가 접수번호를 주지 않으면 번호를 만들지 않고 제보 ID 앞부분과 미제공 안내를 보여 준다.
    expect(screen.getByText('관리자 API가 접수번호를 아직 제공하지 않아 제보 ID 앞부분으로 표시합니다')).toBeInTheDocument()
    expect(screen.getByText(`제보 ${REPORT_1.slice(0, 8)}`)).toBeInTheDocument()
    view.unmount()

    stubFetch(detailRoute(undefined, detail({ receiptNumber: 'TD-SYN-0001' })))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByText('TD-SYN-0001')).toBeInTheDocument()
    expect(screen.queryByText('관리자 API가 접수번호를 아직 제공하지 않아 제보 ID 앞부분으로 표시합니다')).not.toBeInTheDocument()
  })

  it('URL의 제보 ID가 UUID가 아니면 API를 호출하지 않고, 데모 제보 주소도 실제 화면에서 열지 않는다', async () => {
    const fetchMock = stubFetch(() => undefined)
    const view = renderApp('/app/fan-reports/DEMO-REP-008')
    expect(await screen.findByRole('alert')).toHaveTextContent('제보 주소가 올바르지 않습니다')
    expect(screen.queryByText(/합성 데모|DEMO-RSV|합성 티켓 예시/)).not.toBeInTheDocument()
    view.unmount()
    renderApp('/app/fan-reports/55555555-5555-4555-8555-55555555555')
    expect(await screen.findByRole('alert')).toHaveTextContent('제보 주소가 올바르지 않습니다')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['다른 고객사나 권한 없는 공연의 404', () => problem(404, 'RESOURCE_NOT_FOUND'), '제보를 찾을 수 없거나 접근 범위 밖입니다'],
    ['다중 고객사 409', () => problem(409, 'TENANT_SELECTION_REQUIRED'), '여러 고객사 소속 계정은 아직 지원하지 않습니다'],
    ['403', () => problem(403, 'FORBIDDEN'), '이 화면에 필요한 역할이 없습니다'],
    ['503', () => problem(503, 'DEPENDENCY_UNAVAILABLE'), '서버가 일시적으로 응답할 수 없습니다'],
    ['네트워크 장애', () => { throw new TypeError('Failed to fetch') }, '서버에 연결하지 못했습니다'],
    ['다른 제보의 응답', () => json(200, detail({ fanReportId: REPORT_2 })), '서버 응답 형식이 계약과 다릅니다'],
  ])('상세 %s은 제보 정보와 분석 이력을 표시하지 않는다', async (_label, respond, message) => {
    const fetchMock = stubFetch((url) => url === detailPath() ? respond() : undefined)
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('합성판매자')).not.toBeInTheDocument()
    expect(screen.queryByText(/내부 고객사 정보|SQLSTATE/)).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([detailPath()])
  })

  it('상세 오류 이후 다시 시도하면 같은 제보를 다시 조회해 복구한다', async () => {
    let calls = 0
    const base = detailRoute()
    stubFetch((url) => {
      if (url === detailPath()) { calls += 1; if (calls === 1) return problem(503, 'DEPENDENCY_UNAVAILABLE') }
      return base(url)
    })
    renderApp(`/app/fan-reports/${REPORT_1}`)
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('합성판매자')).toBeInTheDocument()
  })

  it('원본 저장이 확인되지 않은 증거는 SHA-256 없이 정상 원본이 아님을 표시하고 미리보기를 만들지 않는다', async () => {
    stubFetch(detailRoute())
    renderApp(`/app/fan-reports/${REPORT_1}`)
    const meta = await screen.findByRole('region', { name: '선택한 증거 정보' })
    expect(within(meta).getByText('확인됨')).toBeInTheDocument()
    expect(within(meta).getByText(SHA)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '원본 이미지 미리보기' })).getByRole('button', { name: '원본 미리보기' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '증거 2 선택' }))
    const failed = screen.getByRole('region', { name: '선택한 증거 정보' })
    expect(within(failed).getByText('저장 실패')).toBeInTheDocument()
    expect(within(failed).getByText('정상 원본으로 확인되지 않음')).toBeInTheDocument()
    expect(within(failed).getByText('없음 (원본 저장이 확인되지 않음)')).toBeInTheDocument()
    expect(within(failed).queryByText(SHA)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '원본 이미지 미리보기' })).getByRole('button', { name: '원본 미리보기' })).toBeDisabled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(await screen.findByText('원본 저장이 확인되지 않은 증거이며 분석 기록이 없습니다.')).toBeInTheDocument()
  })

  it.each([
    ['원본 저장 확인인데 SHA-256이 없는 증거', { ...storedEvidence, sha256: null }],
    ['원본 저장 미확인인데 SHA-256이 있는 증거', { ...failedEvidence, sha256: SHA }],
    ['저장 실패인데 원본 저장 확인으로 온 증거', { ...failedEvidence, originalStored: true, sha256: SHA }],
  ])('%s은 계약 위반으로 상세 전체를 표시하지 않는다', async (_label, evidence) => {
    stubFetch((url) => url === detailPath() ? json(200, detail({ evidence: [evidence] })) : undefined)
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    expect(screen.queryByText('합성판매자')).not.toBeInTheDocument()
  })

  it('증거가 없는 제보는 분석 이력을 조회하지 않고 빈 증거 상태를 표시한다', async () => {
    const fetchMock = stubFetch((url) => url === detailPath() ? json(200, detail({ evidence: [] })) : undefined)
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('heading', { name: '접수된 증거가 없습니다' })).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([detailPath()])
  })

  it('범위 밖 기능은 비활성화하고 분석 실행은 클릭 전 요청하지 않으며 데모 대조 결과를 만들지 않는다', async () => {
    const fetchMock = stubFetch(detailRoute())
    renderApp(`/app/fan-reports/${REPORT_1}`)
    // 예매 후보 대조는 Issue #37에서 분석별 명시적 실행으로 연결했다. 수동 교정은 계속 막는다.
    expect(await screen.findByRole('button', { name: '관찰값 수동 교정' })).toBeDisabled()
    // Case 생성은 사유를 입력해 명시적으로 누를 때만 요청한다.
    expect(screen.getByRole('region', { name: 'Case 생성' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '이미지 분석 실행' })).getByRole('button', { name: '이미지 분석 실행' })).toBeEnabled()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect(screen.queryByText(/일치 후보|예매 후보 미발견|DEMO-RSV|합성 예매 후보/)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '분석관 수정 초안' })).not.toBeInTheDocument()
  })

  it('제보를 바꾸면 이전 제보의 늦은 응답을 표시하지 않는다', async () => {
    const late = deferred()
    stubFetch((url) => {
      if (url === detailPath()) return late.promise
      if (url === detailPath(REPORT_2)) return json(200, detail({ fanReportId: REPORT_2, seller: '두번째 판매자', evidence: [] }))
      return undefined
    })
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('status', { name: '제보 상세를 불러오는 중' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '테스트 제보 2로 이동' }))
    expect(await screen.findByText('두번째 판매자')).toBeInTheDocument()
    late.resolve(json(200, detail()))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('합성판매자')).not.toBeInTheDocument()
    expect(screen.getByText('두번째 판매자')).toBeInTheDocument()
  })
})

describe('Track 2 증거별 분석 이력 실제 API', () => {
  it('분석 이력이 없으면 실패와 구분된 빈 상태를 표시한다', async () => {
    stubFetch(detailRoute({ [historyPath()]: analysisPage() }))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('heading', { name: '아직 분석 이력이 없습니다' })).toBeInTheDocument()
    expect(screen.getByText(/분석 실패 기록과는 다른 상태입니다/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('실행 상태와 결과 상태를 따로 표시하고 FOUND, UNKNOWN, AMBIGUOUS 관찰값과 NOT_LINKED를 구분한다', async () => {
    stubFetch(detailRoute())
    renderApp(`/app/fan-reports/${REPORT_1}`)
    const attempt = await screen.findByRole('article', { name: '분석 시도 2026-11-01 09:59 UTC' })
    expect(within(attempt).getByText('실행 완료')).toBeInTheDocument()
    expect(within(attempt).getByText('일부만 관찰')).toBeInTheDocument()
    expect(within(attempt).getByText('synthetic-vlm (버전 2026-10)')).toBeInTheDocument()
    // LocalDateTime 분석 시각은 계약대로 UTC로 표시하고 브라우저 시간대로 바꾸지 않는다.
    expect(within(attempt).getByText('2026-11-01 10:00 UTC')).toBeInTheDocument()
    expect(within(attempt).getByText('접수 원본과 SHA-256 일치')).toBeInTheDocument()
    expect(within(attempt).getByText('분석 시점 미연결 (검증된 회차 정보가 없습니다)')).toBeInTheDocument()

    const eventName = within(attempt).getByRole('region', { name: '공연명 관찰' })
    expect(within(eventName).getByText('관찰 후보')).toBeInTheDocument()
    expect(within(eventName).getByText('합성 콘서트 관찰명')).toBeInTheDocument()
    expect(within(eventName).getByText('합성 콘서트 관찰명 양도')).toBeInTheDocument()
    const price = within(attempt).getByRole('region', { name: '판매 가격 관찰' })
    expect(within(price).getByText('250,000원 (금액 250000)')).toBeInTheDocument()
    const performance = within(attempt).getByRole('region', { name: '공연 일시 관찰' })
    expect(within(performance).getByText('확인 안 됨')).toBeInTheDocument()
    expect(within(performance).getByText('이미지에 표시 없음')).toBeInTheDocument()
    expect(within(performance).queryByText('관찰값')).not.toBeInTheDocument()
    expect(within(within(attempt).getByRole('region', { name: '열 관찰' })).getByText('읽기 어려움')).toBeInTheDocument()
    const zone = within(attempt).getByRole('region', { name: '구역 관찰' })
    expect(within(zone).getByText('해석 불명확')).toBeInTheDocument()
    expect(within(zone).getByText('해석 후보 (하나로 정하지 않음)')).toBeInTheDocument()
    expect(within(zone).getByText('2구역')).toBeInTheDocument()
    expect(within(zone).getByText('3구역')).toBeInTheDocument()
    expect(within(zone).queryByText('관찰값')).not.toBeInTheDocument()
    expect(within(attempt).getByText(/사실 확인, 예매 일치, 부정 거래 판정이 아닙니다/)).toBeInTheDocument()
    expect(screen.queryByText(/MATCH_CANDIDATE|일치 후보/)).not.toBeInTheDocument()
  })

  it.each([
    ['COMPLETED', analysis({ analysisStatus: 'COMPLETED' }), '실행 완료', '관찰 완료'],
    ['UNVERIFIABLE', analysis({ analysisStatus: 'UNVERIFIABLE', fields: { ...fields, eventName: unknown('UNREADABLE'), platformDisplayName: unknown('ABSENT'), askingPrice: unknown('ABSENT'), currency: unknown('ABSENT'), saleText: unknown('ABSENT') } }), '실행 완료', '확인 불가'],
    ['FAILED', failedAnalysis(), '분석 서버 실패', '분석 실패'],
    ['IN_PROGRESS', analysis({ executionStatus: 'IN_PROGRESS', analysisStatus: null, fields: null, candidateMatch: null, modelName: null, modelVersion: null, analyzedAt: null, reviewRequired: null, completedAt: null }), '실행 중', '결과 없음'],
  ])('%s 시도의 실행 상태와 결과 상태를 구분한다', async (_label, item, execution, outcome) => {
    stubFetch(detailRoute({ [historyPath()]: analysisPage([item]) }))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    const attempt = await screen.findByRole('article')
    expect(within(attempt).getByText(execution)).toBeInTheDocument()
    expect(within(attempt).getByText(outcome)).toBeInTheDocument()
  })

  it('실패 이력은 정상 빈 추출이 아닌 실패로 표시하고 분류 코드만 노출한다', async () => {
    stubFetch(detailRoute({ [historyPath()]: analysisPage([analysis(), failedAnalysis({ analyzerErrorCode: 'java.sql.SQLException: tenant secret' })]) }))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    const attempts = await screen.findAllByRole('article')
    expect(attempts).toHaveLength(2)
    const failed = attempts[1]
    expect(within(failed).getByRole('alert')).toHaveTextContent('정상적인 빈 추출 결과가 아닙니다')
    expect(within(failed).getByText(/ANALYZER_MODEL_FAILED/)).toHaveTextContent('ANALYZER_MODEL_FAILED, 분석 서버 형식을 확인할 수 없는 코드 (HTTP 502)')
    expect(within(failed).getByText('분석 시점 미연결 (분석이 성공하지 않았습니다)')).toBeInTheDocument()
    expect(within(failed).queryByRole('region', { name: '공연명 관찰' })).not.toBeInTheDocument()
    expect(screen.queryByText(/SQLException|tenant secret/)).not.toBeInTheDocument()
  })

  it.each([
    ['다른 증거의 이력', analysisPage([analysis({ evidenceId: EVIDENCE_OTHER })])],
    ['다른 제보의 이력', analysisPage([analysis({ fanReportId: REPORT_2 })])],
    ['요청과 다른 페이지', analysisPage([analysis()], { page: 1 })],
    ['실패인데 관찰 필드가 있는 이력', analysisPage([failedAnalysis({ fields })])],
    ['성공인데 관찰 필드가 없는 이력', analysisPage([analysis({ fields: null })])],
    ['성공인데 결과 상태가 FAILED인 이력', analysisPage([analysis({ analysisStatus: 'FAILED' })])],
    ['9개 필드 중 일부가 없는 이력', analysisPage([analysis({ fields: { ...fields, seat: undefined } })])],
    ['UNKNOWN인데 값이 있는 필드', analysisPage([analysis({ fields: { ...fields, row: { ...unknown('UNREADABLE'), value: '12열' } } })])],
    ['AMBIGUOUS인데 값을 하나로 정한 필드', analysisPage([analysis({ fields: { ...fields, zone: { ...ambiguous('R석', ['2구역', '3구역']), value: '2구역' } } })])],
    ['가격이 문자열로 온 필드', analysisPage([analysis({ fields: { ...fields, askingPrice: found('250000', '250000') } })])],
    ['MATCH_CANDIDATE 예매 대조', analysisPage([analysis({ candidateMatch: { status: 'MATCH_CANDIDATE', reason: 'PERFORMANCE_REF_UNVERIFIED' } })])],
  ])('%s은 계약 위반으로 표시하지 않는다', async (_label, body) => {
    stubFetch(detailRoute({ [historyPath()]: body }))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    // 상세 정보는 그대로 두고 이력만 차단한다.
    expect(screen.getByText('합성판매자')).toBeInTheDocument()
  })

  it.each([
    ['404', () => problem(404, 'RESOURCE_NOT_FOUND'), '증거를 찾을 수 없거나 접근 범위 밖입니다'],
    ['409', () => problem(409, 'TENANT_SELECTION_REQUIRED'), '여러 고객사 소속 계정은 아직 지원하지 않습니다'],
    ['503', () => problem(503, 'DEPENDENCY_UNAVAILABLE'), '서버가 일시적으로 응답할 수 없습니다'],
  ])('분석 이력 %s는 빈 이력 대신 오류로 표시한다', async (_label, respond, message) => {
    const base = detailRoute()
    stubFetch((url) => url === historyPath() ? respond() : base(url))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('heading', { name: '아직 분석 이력이 없습니다' })).not.toBeInTheDocument()
  })

  it('분석 이력은 서버 페이지 단위로 이동한다', async () => {
    const fetchMock = stubFetch(detailRoute({
      [historyPath()]: analysisPage([analysis()], { hasNext: true }),
      [historyPath(EVIDENCE_1, 1)]: analysisPage([failedAnalysis()], { page: 1 }),
    }))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    fireEvent.click(await screen.findByRole('button', { name: '다음 이력' }))
    expect(await screen.findByText('분석 서버 실패')).toBeInTheDocument()
    expect(screen.getByText('2 페이지')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음 이력' })).toBeDisabled()
    expect(requestedUrls(fetchMock)).toEqual([detailPath(), historyPath(), historyPath(EVIDENCE_1, 1)])
  })

  it('증거를 바꾸면 이전 증거의 늦은 이력을 표시하지 않는다', async () => {
    const late = deferred()
    const base = detailRoute()
    stubFetch((url) => url === historyPath() ? late.promise : base(url))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    expect(await screen.findByRole('status', { name: '이미지 정보 추출 이력을 불러오는 중' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '증거 2 선택' }))
    expect(await screen.findByText('원본 저장이 확인되지 않은 증거이며 분석 기록이 없습니다.')).toBeInTheDocument()
    late.resolve(json(200, analysisPage([analysis()])))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})

describe('Track 2 데모 데이터 분리', () => {
  it('실제 API 실패 시에도 합성 데모 제보와 대조 결과로 대체하지 않는다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return problem(500, 'INTERNAL_ERROR')
      return undefined
    })
    renderApp(`/app/fan-reports?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류로 조회하지 못했습니다')
    await waitFor(() => expect(screen.queryByText(/DEMO-|합성 데모 데이터|2026 Autumn Live/)).not.toBeInTheDocument())
  })
})
