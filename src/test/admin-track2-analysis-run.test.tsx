import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// Mock 인증 어댑터와 fetch로 관리자 Track 2 이미지 분석 실행 POST 연동 계약을 검증한다.
// 응답 형식과 오류 코드는 Backend main 15cf228의 track2-listing-analysis-v1.yaml과 ListingContextAnalysisService를 따른다.
// 실제 Spring, FastAPI HTTP 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const REPORT_1 = '55555555-5555-4555-8555-555555555551'
const REPORT_OTHER = '55555555-5555-4555-8555-555555555559'
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661'
const EVIDENCE_2 = '66666666-6666-4666-8666-666666666662'
const EVIDENCE_3 = '66666666-6666-4666-8666-666666666663'
const EVIDENCE_OTHER = '66666666-6666-4666-8666-666666666669'
const SHA = 'a'.repeat(64)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function createMockAdapter() {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function renderApp() {
  return render(<MemoryRouter initialEntries={[`/app/fan-reports/${REPORT_1}`]}><App adminAuthAdapter={createMockAdapter()} /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// 계약에 없는 detail에 내부 정보가 섞여 와도 화면에 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ title: 'Problem', status, code, detail: '내부 객체 키 tenant-a/raw/secret.png SQLSTATE' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

function deferred() {
  let resolve!: (response: Response) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const storedPng = { evidenceId: EVIDENCE_1, mediaType: 'image/png', byteSize: 20480, storageStatus: 'STORED', originalStored: true, sha256: SHA, createdAt: '2026-11-01T09:30:00Z' }
const failedJpeg = { evidenceId: EVIDENCE_2, mediaType: 'image/jpeg', byteSize: 512, storageStatus: 'FAILED', originalStored: false, sha256: null, createdAt: '2026-11-01T09:30:00Z' }
const storedJpeg = { evidenceId: EVIDENCE_3, mediaType: 'image/jpeg', byteSize: 4096, storageStatus: 'STORED', originalStored: true, sha256: SHA, createdAt: '2026-11-01T09:30:00Z' }

function detail(evidence: unknown[] = [storedPng, failedJpeg, storedJpeg]) {
  return {
    fanReportId: REPORT_1, event: { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }, reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED',
    receivedAt: '2026-11-01T09:30:00Z', retentionUntil: '2027-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z',
    seatArea: null, description: '합성 설명', listingUrl: null, platform: null, seller: '합성판매자', askingPrice: null, evidence,
  }
}

const detailPath = `/api/v1/admin/fan-reports/${REPORT_1}`
const runPath = (evidenceId = EVIDENCE_1) => `/api/v1/admin/fan-reports/${REPORT_1}/evidence/${evidenceId}/listing-analyses`
const historyPath = (evidenceId = EVIDENCE_1) => `${runPath(evidenceId)}?page=0&pageSize=20`
const contentPath = (evidenceId = EVIDENCE_1) => `/api/v1/admin/fan-reports/${REPORT_1}/evidence/${evidenceId}/content`

const found = (value: unknown) => ({ state: 'FOUND', value, evidenceQuote: null, unknownReason: null, candidates: [] })
const unknown = { state: 'UNKNOWN', value: null, evidenceQuote: null, unknownReason: 'ABSENT', candidates: [] }
const fields = {
  eventName: found('합성 관찰 공연명'), performanceAt: unknown, platformDisplayName: unknown, askingPrice: found({ raw: '250,000원', amount: '250000' }),
  currency: unknown, saleText: unknown, zone: unknown, row: unknown, seat: unknown,
}

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    analysisId: '77777777-7777-4777-8777-777777777771', fanReportId: REPORT_1, evidenceId: EVIDENCE_1, requestId: '88888888-8888-4888-8888-888888888881',
    executionStatus: 'SUCCEEDED', analysisStatus: 'PARTIAL', errorCode: null, analyzerHttpStatus: null, analyzerErrorCode: null,
    input: { expectedSha256: SHA, verifiedSha256: SHA, expectedByteSize: 20480, verifiedByteSize: 20480, mediaType: 'image/png' },
    modelName: 'synthetic-fake-provider', modelVersion: 'test-v1', analyzedAt: '2026-11-03T10:00:00', reviewRequired: true, fields,
    candidateMatch: { status: 'NOT_LINKED', reason: 'PERFORMANCE_REF_UNVERIFIED' }, createdAt: '2026-11-03T09:59:58', completedAt: '2026-11-03T10:00:01', ...overrides,
  }
}

function failedAnalysis(overrides: Record<string, unknown> = {}) {
  return analysis({
    analysisId: '77777777-7777-4777-8777-777777777772', executionStatus: 'ANALYZER_FAILED', analysisStatus: 'FAILED', errorCode: 'ANALYZER_MODEL_FAILED',
    analyzerHttpStatus: 502, analyzerErrorCode: 'MODEL_FAILED', modelName: null, modelVersion: null, analyzedAt: null, reviewRequired: null, fields: null,
    candidateMatch: { status: 'NOT_LINKED', reason: 'ANALYSIS_NOT_SUCCEEDED' }, ...overrides,
  })
}

const historyPage = (items: unknown[] = []) => ({ items, page: 0, pageSize: 20, hasNext: false })

type Call = { url: string; init: RequestInit | undefined }
type Route = (url: string, init: RequestInit | undefined, calls: Call[]) => Response | Promise<Response> | undefined

/** 상세 응답과 빈 이력을 기본으로 두고, POST와 추가 경로만 테스트별로 정한다. */
function stubFetch(route: Route, detailBody: unknown = detail()) {
  const calls: Call[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    const custom = await route(url, init, calls)
    if (custom) return custom
    if (url === detailPath) return json(200, detailBody)
    if (url.includes('/listing-analyses?')) return json(200, historyPage())
    throw new Error(`예상하지 못한 요청: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const posts = (calls: Call[]) => calls.filter((call) => call.init?.method === 'POST')
const historyGets = (calls: Call[], evidenceId = EVIDENCE_1) => calls.filter((call) => call.url === historyPath(evidenceId))
const keyOf = (call: Call) => (call.init?.headers as Record<string, string>)['Idempotency-Key']
const runRegion = () => screen.getByRole('region', { name: '이미지 분석 실행' })

/** POST 경로이면 응답 목록을 순서대로 돌려준다. */
function postSequence(...responses: (() => Response | Promise<Response>)[]): Route {
  let index = 0
  return (url, init) => {
    if (init?.method !== 'POST') return undefined
    const next = responses[Math.min(index, responses.length - 1)]
    index += 1
    if (!url.startsWith('/api/v1/admin/fan-reports/')) return undefined
    return next()
  }
}

async function openDetail() {
  renderApp()
  await screen.findByText('합성판매자')
  await screen.findByRole('heading', { name: '아직 분석 이력이 없습니다' })
}

async function clickRun(name = '이미지 분석 실행') {
  fireEvent.click(within(runRegion()).getByRole('button', { name }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Track 2 이미지 분석 실행 요청 계약', () => {
  it('클릭 전에는 POST하지 않고, 클릭하면 선택한 제보와 증거로 UUID v4 키를 담아 본문 없이 1회 요청한다', async () => {
    const calls = stubFetch(postSequence(() => json(201, analysis())))
    await openDetail()
    expect(within(runRegion()).getByRole('button', { name: '이미지 분석 실행' })).toBeEnabled()
    expect(posts(calls)).toHaveLength(0)

    await clickRun()
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    const [post] = posts(calls)
    expect(post.url).toBe(runPath())
    expect(post.init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
    expect(post.init?.body).toBeUndefined()
    const headers = post.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`)
    expect(headers['Content-Type']).toBeUndefined()
    expect(keyOf(post)).toMatch(UUID_V4)
    expect(post.url).not.toContain(keyOf(post))
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
  })

  it('다른 증거를 선택하면 그 증거로만 요청한다', async () => {
    const calls = stubFetch(postSequence(() => json(201, analysis({ evidenceId: EVIDENCE_3, input: { ...analysis().input, mediaType: 'image/jpeg' } }))))
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: '증거 3 선택' }))
    await clickRun()
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0].url).toBe(runPath(EVIDENCE_3))
  })

  it('중복 클릭은 한 번만 요청하고 응답을 기다리는 동안 실행 버튼을 막는다', async () => {
    const pending = deferred()
    const calls = stubFetch(postSequence(() => pending.promise))
    await openDetail()
    const button = within(runRegion()).getByRole('button', { name: '이미지 분석 실행' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(within(runRegion()).getByRole('button', { name: /분석 요청 중/ })).toBeDisabled()
    expect(within(runRegion()).getByRole('status')).toHaveTextContent('서버 응답을 기다리는 중')
    pending.resolve(json(201, analysis()))
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    expect(posts(calls)).toHaveLength(1)
  })

  it.each([
    ['원본 저장이 확인되지 않은 증거', [storedPng, failedJpeg], '증거 2 선택', '원본 저장이 확인되지 않아 분석할 수 없습니다'],
    ['5 MiB를 넘는 증거', [storedPng, { ...storedJpeg, byteSize: 5 * 1024 * 1024 + 1 }], '증거 2 선택', '원본 접수 실패가 아닙니다'],
    ['JPEG, PNG가 아닌 증거', [storedPng, { ...storedJpeg, mediaType: 'image/webp' }], '증거 2 선택', '원본 접수 실패가 아닙니다'],
  ])('%s은 실행 버튼을 막고 POST하지 않는다', async (_label, evidence, select, reason) => {
    const calls = stubFetch(() => undefined, detail(evidence))
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: select }))
    expect(within(runRegion()).getByRole('button', { name: '이미지 분석 실행' })).toBeDisabled()
    expect(runRegion()).toHaveTextContent(reason)
    fireEvent.click(within(runRegion()).getByRole('button', { name: '이미지 분석 실행' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(posts(calls)).toHaveLength(0)
  })
})

describe('Track 2 이미지 분석 결과 상태', () => {
  it.each([
    ['COMPLETED', '관찰 완료'],
    ['PARTIAL', '일부만 관찰'],
    ['UNVERIFIABLE', '확인 불가'],
  ])('201 %s 결과를 구분해 표시하고 기존 이력을 다시 조회한다', async (status, label) => {
    const result = analysis({ analysisStatus: status })
    let historyItems: unknown[] = []
    const calls = stubFetch((url, init) => {
      if (init?.method === 'POST') { historyItems = [result]; return json(201, result) }
      if (url === historyPath()) return json(200, historyPage(historyItems))
      return undefined
    })
    await openDetail()
    expect(historyGets(calls)).toHaveLength(1)
    await clickRun()
    const region = runRegion()
    expect(await within(region).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    expect(region).toHaveTextContent(label)
    expect(region).toHaveTextContent('사람의 확인이 필요한 관찰 후보')
    await waitFor(() => expect(historyGets(calls)).toHaveLength(2))
    expect(await screen.findByRole('article', { name: /분석 시도/ })).toBeInTheDocument()
    // 결과 화면은 예매 대조를 연결하지 않는다.
    expect(screen.queryByText(/MATCH_CANDIDATE|일치 후보 발견|부정 거래 확정/)).not.toBeInTheDocument()
  })

  it('확정된 분석 실패는 정상 빈 결과로 바꾸지 않고 실패 이력을 다시 조회하며 새 키로만 다시 실행한다', async () => {
    let historyItems: unknown[] = []
    const calls = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        if (posts(calls).length === 1) { historyItems = [failedAnalysis()]; return problem(502, 'ANALYZER_MODEL_FAILED') }
        historyItems = [analysis(), ...historyItems]
        return json(201, analysis())
      }
      if (url === historyPath()) return json(200, historyPage(historyItems))
      return undefined
    })
    await openDetail()
    await clickRun()
    const alert = await within(runRegion()).findByRole('alert')
    expect(alert).toHaveTextContent('모델이 관찰 결과를 만들지 못했습니다')
    expect(alert).toHaveTextContent('분석 실패 이력으로 기록되었습니다')
    expect(alert).not.toHaveTextContent('SQLSTATE')
    expect(alert).not.toHaveTextContent('secret.png')
    expect(within(runRegion()).queryByRole('button', { name: '같은 요청 재확인' })).not.toBeInTheDocument()
    expect(await screen.findByText('이 시도는 관찰값이 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '아직 분석 이력이 없습니다' })).not.toBeInTheDocument()

    await clickRun('새 분석 실행')
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    const [first, second] = posts(calls)
    expect(keyOf(second)).toMatch(UUID_V4)
    expect(keyOf(second)).not.toBe(keyOf(first))
  })

  it.each([
    ['다른 제보의 분석 결과', { fanReportId: REPORT_OTHER }],
    ['다른 증거의 분석 결과', { evidenceId: EVIDENCE_OTHER }],
    ['실행 중 상태가 201로 온 결과', { executionStatus: 'IN_PROGRESS', analysisStatus: null, fields: null, reviewRequired: null }],
    ['사람 확인 표시가 없는 결과', { reviewRequired: false }],
    ['계약에 없는 예매 대조 상태', { candidateMatch: { status: 'MATCH_CANDIDATE', reason: 'SEAT_NOT_FOUND' } }],
  ])('%s는 성공으로 표시하지 않고 결과 불확실로 같은 키를 유지한다', async (_label, overrides) => {
    const calls = stubFetch(postSequence(() => json(201, analysis(overrides)), () => json(201, analysis())))
    await openDetail()
    await clickRun()
    const alert = await within(runRegion()).findByRole('alert')
    expect(alert).toHaveTextContent('분석 결과를 확인하지 못했습니다')
    expect(within(runRegion()).queryByText('분석 요청이 끝났습니다')).not.toBeInTheDocument()
    fireEvent.click(within(runRegion()).getByRole('button', { name: '같은 요청 재확인' }))
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    const [first, second] = posts(calls)
    expect(keyOf(second)).toBe(keyOf(first))
  })

  it('201이 아닌 성공 상태는 계약 위반으로 결과 불확실 처리한다', async () => {
    stubFetch(postSequence(() => json(200, analysis())))
    await openDetail()
    await clickRun()
    expect(await within(runRegion()).findByRole('alert')).toHaveTextContent('분석 결과를 확인하지 못했습니다')
  })
})

describe('Track 2 이미지 분석 멱등성과 응답 유실', () => {
  it('네트워크 오류는 결과 불확실로 같은 키를 보존하고 최신 이력을 이 시도의 결과로 단정하지 않는다', async () => {
    let historyItems: unknown[] = []
    const calls = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        if (posts(calls).length === 1) { historyItems = [analysis()]; throw new TypeError('connection reset') }
        return json(201, analysis())
      }
      if (url === historyPath()) return json(200, historyPage(historyItems))
      return undefined
    })
    await openDetail()
    await clickRun()
    const alert = await within(runRegion()).findByRole('alert')
    expect(alert).toHaveTextContent('분석 결과를 확인하지 못했습니다')
    expect(alert).toHaveTextContent('서버에서 분석이 실행되었을 수 있습니다')
    // 결과가 불확실하면 새 키로 새 분석을 만드는 버튼을 제공하지 않는다.
    expect(within(runRegion()).queryByRole('button', { name: '새 분석 실행' })).not.toBeInTheDocument()

    fireEvent.click(within(runRegion()).getByRole('button', { name: '분석 이력 다시 조회' }))
    expect(await screen.findByRole('article', { name: /분석 시도/ })).toBeInTheDocument()
    expect(posts(calls)).toHaveLength(1)
    expect(within(runRegion()).getByRole('alert')).toHaveTextContent('분석 결과를 확인하지 못했습니다')

    fireEvent.click(within(runRegion()).getByRole('button', { name: '같은 요청 재확인' }))
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    const [first, second] = posts(calls)
    expect(keyOf(second)).toBe(keyOf(first))
    expect(second.url).toBe(first.url)

    await clickRun('새 분석 실행')
    await waitFor(() => expect(posts(calls)).toHaveLength(3))
    expect(keyOf(posts(calls)[2])).not.toBe(keyOf(first))
  })

  it('409 ANALYSIS_IN_PROGRESS는 진행 중으로 표시하고 같은 키로만 재확인한다', async () => {
    const calls = stubFetch(postSequence(() => problem(409, 'ANALYSIS_IN_PROGRESS'), () => json(201, analysis())))
    await openDetail()
    await clickRun()
    const status = await within(runRegion()).findByText('분석이 아직 진행 중입니다')
    expect(status).toBeInTheDocument()
    expect(within(runRegion()).queryByRole('button', { name: '새 분석 실행' })).not.toBeInTheDocument()
    fireEvent.click(within(runRegion()).getByRole('button', { name: '같은 요청 재확인' }))
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    const [first, second] = posts(calls)
    expect(keyOf(second)).toBe(keyOf(first))
  })

  it('409 ANALYSIS_ABANDONED는 종료된 시도로 표시하고 새 분석은 새 키를 쓴다', async () => {
    const calls = stubFetch(postSequence(() => problem(409, 'ANALYSIS_ABANDONED'), () => json(201, analysis())))
    await openDetail()
    await clickRun()
    expect(await within(runRegion()).findByRole('alert')).toHaveTextContent('이전 분석 시도가 시간 초과로 종료되었습니다')
    expect(within(runRegion()).queryByRole('button', { name: '같은 요청 재확인' })).not.toBeInTheDocument()
    await clickRun('새 분석 실행')
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    const [first, second] = posts(calls)
    expect(keyOf(second)).not.toBe(keyOf(first))
  })

  it('증거를 바꾸면 이전 증거의 늦은 응답을 현재 증거에 표시하지 않고 원래 증거에만 남긴다', async () => {
    const pending = deferred()
    const calls = stubFetch(postSequence(() => pending.promise))
    await openDetail()
    await clickRun()
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '증거 3 선택' }))
    await screen.findByRole('heading', { name: '아직 분석 이력이 없습니다' })
    expect(within(runRegion()).getByRole('button', { name: '이미지 분석 실행' })).toBeEnabled()
    await act(async () => { pending.resolve(json(201, analysis())) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(within(runRegion()).queryByText('분석 요청이 끝났습니다')).not.toBeInTheDocument()
    expect(historyGets(calls, EVIDENCE_3)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '증거 1 선택' }))
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
  })

  it('응답 대기 중 로그아웃하면 요청을 정리하고 분석 상태를 남기지 않는다', async () => {
    const pending = deferred()
    const calls = stubFetch(postSequence(() => pending.promise))
    await openDetail()
    await clickRun()
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    expect(posts(calls)[0].init?.signal?.aborted).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(posts(calls)[0].init?.signal?.aborted).toBe(true)
    await act(async () => { pending.resolve(json(201, analysis())) })
    expect(screen.queryByText(/분석 요청이 끝났습니다|분석 결과를 확인하지 못했습니다/)).not.toBeInTheDocument()
  })

  it('POST 401은 세션을 정리하고 분석 결과를 표시하지 않는다', async () => {
    stubFetch(postSequence(() => new Response(null, { status: 401 })))
    await openDetail()
    await clickRun()
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '이미지 분석 실행' })).not.toBeInTheDocument()
  })
})

describe('Track 2 이미지 분석 오류 구분', () => {
  it.each([
    [400, 'INVALID_IDEMPOTENCY_KEY', '요청 키를 서버가 거부했습니다', 'final'],
    [400, 'INVALID_REQUEST', '분석 요청 값이 올바르지 않습니다', 'final'],
    [403, 'FORBIDDEN', '분석 실행에 필요한 역할이 없습니다', 'final'],
    [404, 'RESOURCE_NOT_FOUND', '증거를 찾을 수 없거나 접근 범위 밖입니다', 'final'],
    [409, 'TENANT_SELECTION_REQUIRED', '여러 고객사 소속 계정은 아직 지원하지 않습니다', 'final'],
    [422, 'RETENTION_EXPIRED', '보존 기한이 지나 분석하지 않았습니다', 'final'],
    [422, 'HASH_MISMATCH', '원본 무결성 확인에 실패해 분석하지 않았습니다', 'final'],
    [422, 'ANALYSIS_INPUT_TOO_LARGE', '원본 접수 실패가 아닙니다', 'final'],
    [422, 'UNSUPPORTED_IMAGE_TYPE', '분석이 지원하지 않는 이미지 형식입니다', 'final'],
    [502, 'ANALYZER_AUTH_FAILED', '분석 서버 내부 인증에 실패했습니다', 'final'],
    [502, 'ANALYZER_RESPONSE_INVALID', '분석 서버 응답이 계약과 달라 거부했습니다', 'final'],
    [502, 'ANALYZER_IDENTITY_MISMATCH', '분석 응답이 요청한 증거와 일치하지 않아 거부했습니다', 'final'],
    [503, 'ANALYZER_DISABLED', '이미지 분석 기능이 비활성 상태입니다', 'final'],
    [503, 'STORAGE_UNAVAILABLE', '원본 저장소에 연결하지 못했습니다', 'final'],
    [503, 'ANALYZER_UNAVAILABLE', '분석 서버에 연결하지 못했습니다', 'final'],
    [504, 'ANALYZER_TIMEOUT', '분석 서버 응답 대기 시간이 초과되었습니다', 'final'],
    [504, 'ANALYZER_MODEL_TIMEOUT', '모델 처리 시간이 초과되었습니다', 'final'],
    [503, 'DEPENDENCY_UNAVAILABLE', '분석 결과를 확인하지 못했습니다', 'uncertain'],
    [500, 'INTERNAL_ERROR', '분석 결과를 확인하지 못했습니다', 'uncertain'],
    [502, 'UNKNOWN', '분석 결과를 확인하지 못했습니다', 'uncertain'],
    [504, 'UNKNOWN', '분석 결과를 확인하지 못했습니다', 'uncertain'],
  ] as const)('%i %s 응답은 고정 문구로 구분한다', async (status, code, title, kind) => {
    stubFetch(postSequence(() => code === 'UNKNOWN' ? new Response('<html>proxy</html>', { status }) : problem(status, code)))
    await openDetail()
    await clickRun()
    const alert = await within(runRegion()).findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).not.toHaveTextContent('SQLSTATE')
    expect(alert).not.toHaveTextContent('secret.png')
    expect(alert).not.toHaveTextContent('proxy')
    if (kind === 'uncertain') {
      expect(within(runRegion()).getByRole('button', { name: '같은 요청 재확인' })).toBeEnabled()
      expect(within(runRegion()).queryByRole('button', { name: '새 분석 실행' })).not.toBeInTheDocument()
    } else {
      expect(within(runRegion()).queryByRole('button', { name: '같은 요청 재확인' })).not.toBeInTheDocument()
      expect(within(runRegion()).getByRole('button', { name: '새 분석 실행' })).toBeEnabled()
    }
  })

  it('403과 404 문구는 다른 고객사 자원의 존재 여부를 알려주지 않는다', async () => {
    for (const status of [403, 404]) {
      stubFetch(postSequence(() => problem(status, status === 403 ? 'FORBIDDEN' : 'RESOURCE_NOT_FOUND')))
      const view = renderApp()
      await screen.findByText('합성판매자')
      await clickRun()
      const alert = await within(runRegion()).findByRole('alert')
      expect(alert).not.toHaveTextContent(/다른 고객사의|존재합니다/)
      view.unmount()
      vi.unstubAllGlobals()
    }
  })
})

describe('Track 2 이미지 분석 실행 회귀', () => {
  it('분석 실행은 원본 이미지를 요청하지 않고 미리보기 버튼과 증거 선택을 유지한다', async () => {
    const calls = stubFetch(postSequence(() => json(201, analysis())))
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: '증거 3 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '증거 1 선택' }))
    await clickRun()
    expect(await within(runRegion()).findByText('분석 요청이 끝났습니다')).toBeInTheDocument()
    expect(calls.some((call) => call.url === contentPath())).toBe(false)
    expect(screen.getByRole('button', { name: '증거 1 선택' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('region', { name: '원본 이미지 미리보기' })).getByRole('button', { name: '원본 미리보기' })).toBeEnabled()
  })

  it('예매 후보 대조, 수동 교정, Case 생성은 계속 비활성화한다', async () => {
    stubFetch(postSequence(() => json(201, analysis())))
    await openDetail()
    await clickRun()
    await within(runRegion()).findByText('분석 요청이 끝났습니다')
    for (const name of ['예매 후보 대조', '관찰값 수동 교정', 'Case 생성']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('요청 키를 브라우저 저장소에 남기지 않는다', async () => {
    const calls = stubFetch(postSequence(() => { throw new TypeError('offline') }))
    await openDetail()
    await clickRun()
    await within(runRegion()).findByRole('alert')
    const key = keyOf(posts(calls)[0])
    const stored = [...Object.values({ ...localStorage }), ...Object.values({ ...sessionStorage })].join('\n')
    expect(stored).not.toContain(key)
    expect(runRegion()).not.toHaveTextContent(key)
  })
})
