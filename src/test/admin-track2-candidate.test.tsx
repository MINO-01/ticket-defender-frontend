import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import {
  applicabilities, applicabilityLabels, candidateReasonLabels, candidateReasons, candidateRunSchema, candidateStatuses, candidateStatusLabels, performanceSchema,
} from '../features/admin-track2/candidatePipelineApi'
import { formatUtc } from '../features/admin-track2/track2Api'

// Issue #37 검증 회차, 제보 회차 연결, 예매 후보 대조 실행과 이력을 Mock 인증 어댑터와 fetch로 검증한다.
// 요청과 응답 형식은 Backend main 391e285의 track2-candidate-pipeline-v1.yaml, CandidatePipelineDto와 각 Controller, Service를 따른다.
// 실제 Spring, MySQL 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터이며 예매번호 원문, HMAC 값은 쓰지 않는다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const EVENT_OTHER = '33333333-3333-4333-8333-333333333339'
const REPORT_1 = '55555555-5555-4555-8555-555555555551'
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661'
const ANALYSIS_1 = '77777777-7777-4777-8777-777777777771'
const ANALYSIS_FAILED = '77777777-7777-4777-8777-777777777772'
const PERF_1 = '99999999-9999-4999-8999-999999999991'
const PERF_2 = '99999999-9999-4999-8999-999999999992'
const PERF_WITHDRAWN = '99999999-9999-4999-8999-999999999993'
const LINK_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const RUN_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const CANDIDATE_1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const BATCH_1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const SHA = 'a'.repeat(64)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SECRET = 'SYN-RAW-RESERVATION-0001'

function createMockAdapter() {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// 계약에 없는 detail에 내부 정보가 섞여 와도 화면에 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ status, code, detail: `내부 예매번호 ${SECRET} hmac=ffff` }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

const found = (value: string) => ({ state: 'FOUND', value, evidenceQuote: null, unknownReason: null, candidates: [] })
const unknown = { state: 'UNKNOWN', value: null, evidenceQuote: null, unknownReason: 'ABSENT', candidates: [] }
const fields = {
  eventName: found('합성 관찰 공연명'), performanceAt: found('2026-12-01 19:00'), platformDisplayName: unknown, askingPrice: unknown,
  currency: unknown, saleText: unknown, zone: found('A'), row: found('3'), seat: found('12'),
}

const detail = {
  fanReportId: REPORT_1, event: { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }, reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED',
  receivedAt: '2026-11-01T09:30:00Z', retentionUntil: '2027-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z',
  seatArea: null, description: '합성 설명', listingUrl: null, platform: null, seller: '합성판매자', askingPrice: null,
  evidence: [{ evidenceId: EVIDENCE_1, mediaType: 'image/png', byteSize: 20480, storageStatus: 'STORED', originalStored: true, sha256: SHA, createdAt: '2026-11-01T09:30:00Z' }],
}

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    analysisId: ANALYSIS_1, fanReportId: REPORT_1, evidenceId: EVIDENCE_1, requestId: '88888888-8888-4888-8888-888888888881',
    executionStatus: 'SUCCEEDED', analysisStatus: 'COMPLETED', errorCode: null, analyzerHttpStatus: null, analyzerErrorCode: null,
    input: { expectedSha256: SHA, verifiedSha256: SHA, expectedByteSize: 20480, verifiedByteSize: 20480, mediaType: 'image/png' },
    modelName: 'synthetic-fake-provider', modelVersion: 'test-v1', analyzedAt: '2026-11-03T10:00:00', reviewRequired: true, fields,
    candidateMatch: { status: 'NOT_LINKED', reason: 'PERFORMANCE_REF_UNVERIFIED' }, createdAt: '2026-11-03T09:59:58', completedAt: '2026-11-03T10:00:01', ...overrides,
  }
}

const failedAnalysis = analysis({
  analysisId: ANALYSIS_FAILED, executionStatus: 'ANALYZER_FAILED', analysisStatus: 'FAILED', errorCode: 'ANALYZER_MODEL_FAILED', analyzerHttpStatus: 502,
  analyzerErrorCode: 'MODEL_FAILED', modelName: null, modelVersion: null, analyzedAt: null, reviewRequired: null, fields: null,
  candidateMatch: { status: 'NOT_LINKED', reason: 'ANALYSIS_NOT_SUCCEEDED' }, createdAt: '2026-11-03T09:00:00',
})

function performance(overrides: Record<string, unknown> = {}) {
  return { performanceId: PERF_1, eventId: EVENT_A, performanceRef: 'SYN-PERF-20261201-19', status: 'ACTIVE', revision: 1, sourceVersion: 'syn-v1', verifiedAt: '2026-11-04T01:00:00', withdrawnAt: null, ...overrides }
}

const perf2 = performance({ performanceId: PERF_2, performanceRef: 'SYN-PERF-20261202-19', revision: 3, sourceVersion: 'syn-v3' })
const perfWithdrawn = performance({ performanceId: PERF_WITHDRAWN, performanceRef: 'SYN-PERF-OLD', status: 'WITHDRAWN', revision: 2, withdrawnAt: '2026-11-04T02:00:00' })

function link(overrides: Record<string, unknown> = {}) {
  return { linkId: LINK_1, fanReportId: REPORT_1, performanceId: PERF_1, performanceRef: 'SYN-PERF-20261201-19', performanceRevision: 1, linkRevision: 2, status: 'ACTIVE', createdAt: '2026-11-04T03:00:00', endedAt: null, ...overrides }
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_1, analysisId: ANALYSIS_1, fanReportId: REPORT_1, evidenceId: EVIDENCE_1, status: 'MATCH_CANDIDATE', reason: 'MATCHED_SINGLE_CANDIDATE',
    candidateCount: 1, candidateId: CANDIDATE_1, performanceLinkId: LINK_1, performanceLinkRevision: 2, verifiedPerformanceId: PERF_1, verifiedPerformanceRevision: 1,
    reservationBatchId: BATCH_1, reservationSourceVersion: 'syn-snapshot-1', evidenceSha256: SHA, analysisResponseSha256: 'b'.repeat(64), analysisRowVersion: 3,
    applicability: 'CURRENT', createdAt: '2026-11-05T01:00:00', completedAt: '2026-11-05T01:00:01', ...overrides,
  }
}

const page = (items: unknown[] = [], extra: Record<string, unknown> = {}) => ({ items, page: 0, pageSize: 20, hasNext: false, ...extra })
const detailUrl = `/api/v1/admin/fan-reports/${REPORT_1}`
const analysesUrl = `${detailUrl}/evidence/${EVIDENCE_1}/listing-analyses?page=0&pageSize=20`
const perfsUrl = `/api/v1/admin/events/${EVENT_A}/verified-performances`
const linkUrl = `${detailUrl}/performance-link`
const candidateUrl = (analysisId = ANALYSIS_1) => `${detailUrl}/evidence/${EVIDENCE_1}/listing-analyses/${analysisId}/candidate-matches`
const candidateHistoryUrl = (pageNumber = 0, analysisId = ANALYSIS_1) => `${candidateUrl(analysisId)}?page=${pageNumber}&pageSize=20`

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }
type Handler = (call: Call, count: number) => Response | Promise<Response> | undefined

function stubFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const base: Record<string, Handler> = {
    [`GET ${detailUrl}`]: () => json(200, detail),
    [`GET ${analysesUrl}`]: () => json(200, page([analysis(), failedAnalysis])),
    [`GET ${perfsUrl}`]: () => json(200, [performance(), perf2, perfWithdrawn]),
    [`GET ${linkUrl}`]: () => json(200, { items: [] }),
    [`GET ${candidateHistoryUrl()}`]: () => json(200, page()),
  }
  const merged = { ...base, ...routes }
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

function renderApp() {
  return render(<MemoryRouter initialEntries={[`/app/fan-reports/${REPORT_1}`]}><App adminAuthAdapter={createMockAdapter()} /></MemoryRouter>)
}

async function performanceRegion() {
  const region = await screen.findByRole('region', { name: '검증 회차' })
  await within(region).findByRole('list', { name: '검증 회차 목록' })
  return region
}

async function linkRegion() {
  const region = await screen.findByRole('region', { name: '제보 회차 연결' })
  await within(region).findByRole('region', { name: '회차 연결 이력' })
  return region
}

/** 실행 완료 분석의 후보 대조 영역이다. 분석 이력 순서상 첫 번째 시도다. */
async function candidateRegion() {
  const attempt = await screen.findByRole('article', { name: `분석 시도 ${formatUtc('2026-11-03T09:59:58')}` })
  return within(attempt).getByRole('region', { name: '예매 후보 대조' })
}

function expectNoSecret() {
  expect(document.body.innerHTML).not.toContain(SECRET)
  expect(document.body.innerHTML).not.toContain('hmac=')
  expect([...Object.values({ ...localStorage }), ...Object.values({ ...sessionStorage })].join('')).toBe('')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('계약 스키마와 시간', () => {
  it('오프셋 없는 LocalDateTime을 UTC로만 해석하고 계약 밖 상태와 적용 여부는 받지 않는다', () => {
    expect(candidateRunSchema.safeParse(run()).success).toBe(true)
    expect(formatUtc('2026-11-05T01:00:00')).toBe('2026-11-05 01:00 UTC')
    expect(formatUtc('2026-11-05T01:00:00.123456')).toBe('2026-11-05 01:00 UTC')
    expect(candidateRunSchema.safeParse(run({ status: 'FOUND' })).success).toBe(false)
    expect(candidateRunSchema.safeParse(run({ applicability: 'STALE' })).success).toBe(false)
    expect(candidateRunSchema.safeParse(run({ createdAt: '2026-11-05 01:00' })).success).toBe(false)
    expect(performanceSchema.safeParse(performance({ status: 'DRAFT' })).success).toBe(false)
  })

  it('7개 상태, 14개 사유, 7개 적용 여부의 문구가 모두 서로 다르다', () => {
    expect(new Set(candidateStatuses.map((status) => candidateStatusLabels[status])).size).toBe(7)
    expect(new Set(candidateReasons.map((reason) => candidateReasonLabels[reason])).size).toBe(14)
    expect(new Set(applicabilities.map((value) => applicabilityLabels[value])).size).toBe(7)
  })
})

describe('검증 회차', () => {
  it('회차의 상태, revision, 출처 버전을 표시하고 등록은 키 없이 앞뒤 공백을 뺀 본문으로 한 번만 보낸 뒤 목록을 다시 조회한다', async () => {
    const calls = stubFetch({ [`POST ${perfsUrl}`]: () => json(201, performance({ performanceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', performanceRef: 'SYN-NEW' })) })
    renderApp()
    const region = await performanceRegion()
    const old = within(region).getByRole('article', { name: '검증 회차 SYN-PERF-OLD' })
    expect(within(old).getByText('철회됨 (WITHDRAWN)')).toBeInTheDocument()
    expect(within(old).queryByRole('button', { name: '회차 철회' })).not.toBeInTheDocument()
    const active = within(region).getByRole('article', { name: '검증 회차 SYN-PERF-20261202-19' })
    expect(within(active).getByText('syn-v3')).toBeInTheDocument()
    expect(within(active).getByText('3')).toBeInTheDocument()
    const form = within(region).getByRole('region', { name: '검증 회차 등록' })
    fireEvent.change(within(form).getByRole('textbox', { name: /회차 식별자/ }), { target: { value: '  SYN-NEW  ' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /검증 근거/ }), { target: { value: '합성 일정표 확인' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /출처 버전/ }), { target: { value: 'syn-v1' } })
    fireEvent.click(within(form).getByRole('button', { name: '검증 회차 등록' }))
    fireEvent.click(within(form).getByRole('button', { name: /회차 등록/ }))
    expect(await within(form).findByText('검증 회차를 등록했습니다.')).toBeInTheDocument()
    const posts = sent(calls, 'POST', perfsUrl)
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({ performanceRef: 'SYN-NEW', verificationBasis: '합성 일정표 확인', sourceVersion: 'syn-v1' })
    expect(posts[0].headers['Idempotency-Key']).toBeUndefined()
    await waitFor(() => expect(sent(calls, 'GET', perfsUrl).length).toBeGreaterThanOrEqual(2))
  })

  it('등록 응답이 유실되면 자동으로 다시 보내지 않고 목록만 다시 조회하며 확인 전까지 새 등록을 막는다', async () => {
    const calls = stubFetch({ [`POST ${perfsUrl}`]: () => { throw new TypeError('network') } })
    renderApp()
    const region = await performanceRegion()
    const form = within(region).getByRole('region', { name: '검증 회차 등록' })
    fireEvent.change(within(form).getByRole('textbox', { name: /회차 식별자/ }), { target: { value: 'SYN-PERF-20261201-19' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /검증 근거/ }), { target: { value: '합성 근거' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /출처 버전/ }), { target: { value: 'syn-v1' } })
    fireEvent.click(within(form).getByRole('button', { name: '검증 회차 등록' }))
    expect(await within(form).findByText(/결과 미확인: 회차 변경 결과를 확인하지 못했습니다/)).toBeInTheDocument()
    // 목록에 같은 식별자가 있어도 이 요청의 성공으로 확정하지 않는다.
    expect(within(form).queryByText('검증 회차를 등록했습니다.')).not.toBeInTheDocument()
    expect(within(form).getByText(/현재 목록 상태만으로 이 요청의 성공 여부를 확정하지 않습니다/)).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: '검증 회차 등록' })).toBeDisabled()
    await waitFor(() => expect(sent(calls, 'GET', perfsUrl).length).toBeGreaterThanOrEqual(2))
    expect(sent(calls, 'POST', perfsUrl)).toHaveLength(1)
    fireEvent.click(within(form).getByRole('button', { name: '목록을 확인했고 새 요청을 보낼 수 있게 합니다' }))
    expect(within(form).getByRole('button', { name: '검증 회차 등록' })).toBeEnabled()
    expect(sent(calls, 'POST', perfsUrl)).toHaveLength(1)
  })

  it.each([
    [409, 'PERFORMANCE_REF_CONFLICT', '같은 회차 식별자가 이미 있습니다'],
    [422, 'VALIDATION_FAILED', '서버가 입력 값을 거부했습니다'],
    [403, 'FORBIDDEN', '검증 회차 변경에 필요한 역할이 없습니다'],
  ])('등록 %s %s를 확정 거부로 안내하고 내부 정보를 표시하지 않는다', async (status, code, title) => {
    stubFetch({ [`POST ${perfsUrl}`]: () => problem(status, code) })
    renderApp()
    const region = await performanceRegion()
    const form = within(region).getByRole('region', { name: '검증 회차 등록' })
    fireEvent.change(within(form).getByRole('textbox', { name: /회차 식별자/ }), { target: { value: 'SYN-X' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /검증 근거/ }), { target: { value: '합성 근거' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /출처 버전/ }), { target: { value: 'syn-v1' } })
    fireEvent.click(within(form).getByRole('button', { name: '검증 회차 등록' }))
    expect(await within(form).findByText(`요청 거부: ${title}`, { exact: false })).toBeInTheDocument()
    expectNoSecret()
  })

  it('수정은 키 없는 PATCH로 expectedRevision을 보내고 revision 충돌을 안내한다', async () => {
    const calls = stubFetch({ [`PATCH ${perfsUrl}/${PERF_2}`]: () => problem(409, 'PERFORMANCE_REVISION_CONFLICT') })
    renderApp()
    const region = await performanceRegion()
    const item = within(region).getByRole('article', { name: '검증 회차 SYN-PERF-20261202-19' })
    fireEvent.click(within(item).getByRole('button', { name: '검증 근거 수정' }))
    const form = within(item).getByRole('region', { name: '검증 근거 수정' })
    fireEvent.change(within(form).getByRole('textbox', { name: /새 검증 근거/ }), { target: { value: '합성 재확인' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /출처 버전/ }), { target: { value: 'syn-v4' } })
    fireEvent.click(within(form).getByRole('button', { name: '수정 요청' }))
    expect(await screen.findByText(/요청 거부: 다른 변경이 먼저 반영되었습니다/)).toBeInTheDocument()
    const patches = sent(calls, 'PATCH', `${perfsUrl}/${PERF_2}`)
    expect(patches).toHaveLength(1)
    expect(patches[0].body).toEqual({ verificationBasis: '합성 재확인', sourceVersion: 'syn-v4', expectedRevision: 3 })
    expect(patches[0].headers['Idempotency-Key']).toBeUndefined()
  })

  it('철회는 사유와 expectedRevision을 보내고 성공 뒤 목록을 다시 조회한다', async () => {
    const calls = stubFetch({ [`POST ${perfsUrl}/${PERF_1}/withdrawals`]: () => json(200, performance({ status: 'WITHDRAWN', revision: 2, withdrawnAt: '2026-11-05T00:00:00' })) })
    renderApp()
    const region = await performanceRegion()
    const item = within(region).getByRole('article', { name: '검증 회차 SYN-PERF-20261201-19' })
    fireEvent.click(within(item).getByRole('button', { name: '회차 철회' }))
    const form = within(item).getByRole('region', { name: '회차 철회' })
    fireEvent.change(within(form).getByRole('textbox', { name: /철회 사유/ }), { target: { value: '합성 철회 사유' } })
    fireEvent.click(within(form).getByRole('button', { name: '철회 요청' }))
    await waitFor(() => expect(sent(calls, 'GET', perfsUrl).length).toBeGreaterThanOrEqual(2))
    const withdrawals = sent(calls, 'POST', `${perfsUrl}/${PERF_1}/withdrawals`)
    expect(withdrawals).toHaveLength(1)
    expect(withdrawals[0].body).toEqual({ reason: '합성 철회 사유', expectedRevision: 1 })
    expect(withdrawals[0].headers['Idempotency-Key']).toBeUndefined()
  })

  it('목록 403은 회차 영역에만 역할 안내를 표시하고 후보 대조 영역은 계속 쓸 수 있다', async () => {
    stubFetch({ [`GET ${perfsUrl}`]: () => problem(403, 'FORBIDDEN'), [`GET ${linkUrl}`]: () => problem(403, 'FORBIDDEN') })
    renderApp()
    const region = await screen.findByRole('region', { name: '검증 회차' })
    expect(await within(region).findByText('이 영역에 필요한 역할이 없습니다')).toBeInTheDocument()
    expect(within(region).getByText(/REVIEWER.*TENANT_ADMIN/)).toBeInTheDocument()
    expect(within(await candidateRegion()).getByRole('button', { name: '예매 후보 대조 실행' })).toBeEnabled()
  })

  it('다른 공연의 회차가 섞인 응답과 범위 밖 404는 표시하지 않는다', async () => {
    stubFetch({ [`GET ${perfsUrl}`]: () => json(200, [performance({ eventId: EVENT_OTHER })]), [`GET ${linkUrl}`]: () => new Response(null, { status: 404 }) })
    renderApp()
    const region = await screen.findByRole('region', { name: '검증 회차' })
    expect(await within(region).findByText('서버 응답 형식이 계약과 다릅니다')).toBeInTheDocument()
    const links = await screen.findByRole('region', { name: '제보 회차 연결' })
    expect(await within(links).findByText('제보를 찾을 수 없거나 접근 범위 밖입니다')).toBeInTheDocument()
  })
})

describe('제보 회차 연결', () => {
  it('ACTIVE 회차만 고를 수 있고 연결 PUT은 UUID v4 키와 expectedLinkRevision 0으로 보낸다', async () => {
    const calls = stubFetch({ [`PUT ${linkUrl}`]: () => json(201, link({ linkRevision: 1 })) })
    renderApp()
    const region = await linkRegion()
    const select = within(region).getByRole('combobox', { name: /연결할 검증 회차/ })
    const options = within(select).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['회차를 선택해 주세요', 'SYN-PERF-20261201-19 (revision 1)', 'SYN-PERF-20261202-19 (revision 3)'])
    // 팬 입력 일시나 분석의 공연 일시 관찰값으로 자동 선택하지 않는다.
    expect((select as HTMLSelectElement).value).toBe('')
    fireEvent.change(select, { target: { value: PERF_1 } })
    fireEvent.change(within(region).getByRole('textbox', { name: /연결 사유/ }), { target: { value: '합성 일정 대조' } })
    fireEvent.click(within(region).getByRole('button', { name: '회차 연결' }))
    fireEvent.click(within(region).getByRole('button', { name: /회차 연결/ }))
    expect(await within(region).findByText(/회차를 연결했습니다/)).toBeInTheDocument()
    const puts = sent(calls, 'PUT', linkUrl)
    expect(puts).toHaveLength(1)
    expect(puts[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(puts[0].body).toEqual({ performanceId: PERF_1, expectedLinkRevision: 0, reason: '합성 일정 대조' })
    await waitFor(() => expect(sent(calls, 'GET', linkUrl).length).toBeGreaterThanOrEqual(2))
  })

  it('교체는 현재 연결 revision을 보내고 동시 변경 409는 같은 키와 본문으로 재확인한 뒤 revision 충돌을 추정 없이 안내한다', async () => {
    const calls = stubFetch({
      [`GET ${linkUrl}`]: () => json(200, { items: [link(), link({ linkId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0', linkRevision: 1, status: 'REPLACED', endedAt: '2026-11-04T03:00:00' })] }),
      [`PUT ${linkUrl}`]: (_call, count) => problem(409, count === 1 ? 'PERFORMANCE_LINK_CONCURRENT_UPDATE' : 'PERFORMANCE_LINK_REVISION_CONFLICT'),
    })
    renderApp()
    const region = await linkRegion()
    expect(within(region).getByRole('region', { name: '회차 연결 이력' }).querySelectorAll('article')).toHaveLength(2)
    fireEvent.change(within(region).getByRole('combobox', { name: /연결할 검증 회차/ }), { target: { value: PERF_2 } })
    fireEvent.change(within(region).getByRole('textbox', { name: /연결 사유/ }), { target: { value: '합성 교체 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '회차 교체' }))
    expect(await within(region).findByText(/결과 미확인: 같은 제보의 회차 연결이 동시에 변경되고 있습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '회차 교체' })).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '연결 요청 재확인' }))
    expect(await within(region).findByText(/요청 거부: 회차 연결이 먼저 변경되었습니다/)).toBeInTheDocument()
    expect(within(region).getByText(/반영되었는지는 이 응답으로 추정하지 않으니/)).toBeInTheDocument()
    const puts = sent(calls, 'PUT', linkUrl)
    expect(puts).toHaveLength(2)
    expect(puts[1].headers['Idempotency-Key']).toBe(puts[0].headers['Idempotency-Key'])
    expect(puts[1].body).toEqual(puts[0].body)
    expect(puts[0].body).toEqual({ performanceId: PERF_2, expectedLinkRevision: 2, reason: '합성 교체 사유' })
    await waitFor(() => expect(sent(calls, 'GET', linkUrl).length).toBeGreaterThanOrEqual(2))
  })

  it('연결 철회는 키와 현재 연결 revision을 보내고, 같은 키 재사용 거부는 확정 거부로 안내한다', async () => {
    const calls = stubFetch({ [`GET ${linkUrl}`]: () => json(200, { items: [link()] }), [`POST ${linkUrl}/withdrawals`]: () => problem(409, 'IDEMPOTENCY_KEY_REUSED') })
    renderApp()
    const region = await linkRegion()
    fireEvent.change(within(region).getByRole('textbox', { name: /연결 철회 사유/ }), { target: { value: '합성 연결 철회' } })
    fireEvent.click(within(region).getByRole('button', { name: '회차 연결 철회' }))
    expect(await within(region).findByText(/요청 거부: 같은 요청 키가 다른 내용으로 사용되었습니다/)).toBeInTheDocument()
    const posts = sent(calls, 'POST', `${linkUrl}/withdrawals`)
    expect(posts[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(posts[0].body).toEqual({ expectedLinkRevision: 2, reason: '합성 연결 철회' })
  })

  it('연결된 회차가 이후 철회되거나 revision이 바뀌면 자동으로 바꾸지 않고 다시 확인하도록 안내한다', async () => {
    stubFetch({ [`GET ${linkUrl}`]: () => json(200, { items: [link({ performanceId: PERF_2, performanceRef: 'SYN-PERF-20261202-19', performanceRevision: 2 })] }) })
    renderApp()
    const region = await linkRegion()
    expect(within(region).getByText(/revision 3로 바뀌었습니다/)).toBeInTheDocument()
  })
})

describe('예매 후보 대조 실행', () => {
  it('자동 실행하지 않고, 연속 클릭에도 UUID v4 키로 본문 없이 한 번만 보내며 201을 실행 기록 생성으로만 안내한다', async () => {
    const calls = stubFetch({
      [`POST ${candidateUrl()}`]: () => json(201, run()),
      [`GET ${candidateHistoryUrl()}`]: () => json(200, page([run()])),
    })
    renderApp()
    const region = await candidateRegion()
    expect(sent(calls, 'POST', candidateUrl())).toHaveLength(0)
    expect(sent(calls, 'GET', candidateHistoryUrl())).toHaveLength(0)
    const button = within(region).getByRole('button', { name: '예매 후보 대조 실행' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await within(region).findByText('후보 실행 기록이 생성되었습니다')).toBeInTheDocument()
    const posts = sent(calls, 'POST', candidateUrl())
    expect(posts).toHaveLength(1)
    expect(posts[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(posts[0].body).toBeUndefined()
    const history = await within(region).findByRole('region', { name: '후보 실행 이력' })
    const item = await within(history).findByRole('article', { name: `후보 실행 ${formatUtc('2026-11-05T01:00:00')}` })
    expect(within(item).getByText('단일 조사 후보 (MATCH_CANDIDATE)')).toBeInTheDocument()
    expect(within(item).getByText('현재 기준에 적용됨 (CURRENT)')).toBeInTheDocument()
    expect(within(item).getByText('내부 후보 참조 (예매번호 아님)')).toBeInTheDocument()
    expect(within(item).getByText(/판매자, 동일인, 불법성, 부정 거래를 확정하지 않습니다/)).toBeInTheDocument()
    expectNoSecret()
  })

  it('기존 이미지 분석 응답의 NOT_LINKED 표시와 신규 후보 실행 결과를 분리한다', async () => {
    stubFetch({ [`GET ${candidateHistoryUrl()}`]: () => json(200, page([run({ status: 'NO_MATCH', reason: 'NO_CANDIDATE_FOUND', candidateCount: 0, candidateId: null })])) })
    renderApp()
    const attempt = await screen.findByRole('article', { name: `분석 시도 ${formatUtc('2026-11-03T09:59:58')}` })
    expect(within(attempt).getByText('분석 응답의 기존 대조 표시 (후보 실행과 별개)')).toBeInTheDocument()
    expect(within(attempt).getByText(/분석 시점 미연결/)).toBeInTheDocument()
    const region = within(attempt).getByRole('region', { name: '예매 후보 대조' })
    fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 보기' }))
    const history = await within(region).findByRole('region', { name: '후보 실행 이력' })
    expect(await within(history).findByText('후보 없음 (NO_MATCH)')).toBeInTheDocument()
    expect(within(history).getByText(/완전한 예매 스냅샷 조회가 성공했고/)).toBeInTheDocument()
    expect(within(history).queryByText(/NOT_LINKED|분석 시점 미연결/)).not.toBeInTheDocument()
  })

  it('모든 상태와 사유, 적용 여부를 각각 표시하고 과거 실행을 현재 판단 근거로 쓰지 않는다고 안내한다', async () => {
    const items = candidateReasons.map((reason, index) => run({
      runId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`, reason, status: candidateStatuses[index % 7],
      applicability: applicabilities[index % 7], createdAt: `2026-11-05T01:${String(index).padStart(2, '0')}:00`,
      candidateId: index % 7 === 1 ? CANDIDATE_1 : null, candidateCount: index % 7 === 2 ? 0 : null,
    }))
    stubFetch({ [`GET ${candidateHistoryUrl()}`]: () => json(200, page(items)) })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 보기' }))
    const history = await within(region).findByRole('region', { name: '후보 실행 이력' })
    await within(history).findAllByRole('article')
    for (const status of candidateStatuses) expect(within(history).getAllByText(candidateStatusLabels[status]).length).toBeGreaterThan(0)
    for (const reason of candidateReasons) expect(within(history).getByText(`${candidateReasonLabels[reason]} (${reason})`)).toBeInTheDocument()
    for (const value of applicabilities) expect(within(history).getAllByText(applicabilityLabels[value]).length).toBeGreaterThan(0)
    // CURRENT가 아닌 12건에만 현재 판단 근거 제외 안내를 붙인다.
    expect(within(history).getAllByText(/현재 판단 근거로 쓰지 않습니다/)).toHaveLength(12)
    expect(within(history).getAllByText(/후보 없음이 아닙니다/).length).toBeGreaterThan(0)
  })

  it('응답 유실은 같은 키로만 재확인하고, 진행 중 409도 같은 키를 유지한다', async () => {
    const calls = stubFetch({
      [`POST ${candidateUrl()}`]: (_call, count) => {
        if (count === 1) throw new TypeError('network')
        if (count === 2) return problem(409, 'CANDIDATE_LOOKUP_IN_PROGRESS')
        return json(201, run({ status: 'AMBIGUOUS', reason: 'MULTIPLE_CANDIDATES', candidateCount: 2, candidateId: null }))
      },
    })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '예매 후보 대조 실행' }))
    expect(await within(region).findByText(/결과 미확인: 후보 대조 결과를 확인하지 못했습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '예매 후보 대조 실행' })).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '같은 대조 요청 재확인' }))
    expect(await within(region).findByText('후보 대조가 아직 진행 중입니다')).toBeInTheDocument()
    expect(within(region).queryByText(/후보 없음 \(NO_MATCH\)/)).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '같은 대조 요청 재확인' }))
    expect(await within(region).findByText('후보 실행 기록이 생성되었습니다')).toBeInTheDocument()
    expect(within(region).getByText('복수 후보, 하나로 정하지 않음 (AMBIGUOUS)')).toBeInTheDocument()
    const posts = sent(calls, 'POST', candidateUrl())
    expect(posts).toHaveLength(3)
    expect(new Set(posts.map((call) => call.headers['Idempotency-Key'])).size).toBe(1)
  })

  it('503 CANDIDATE_LOOKUP_FAILED_UNRECORDED는 0건이나 실패로 확정하지 않고 새 키를 만들지 않는다', async () => {
    const calls = stubFetch({ [`POST ${candidateUrl()}`]: () => problem(503, 'CANDIDATE_LOOKUP_FAILED_UNRECORDED') })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '예매 후보 대조 실행' }))
    expect(await within(region).findByText(/결과 미확인: 후보 대조 실패 기록을 남겼는지 확인할 수 없습니다/)).toBeInTheDocument()
    expect(within(region).getByText(/후보 없음이나 실패로 확정하지 않습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /새 후보 대조 실행|예매 후보 대조 실행/ })).not.toBeInTheDocument()
    expect(sent(calls, 'POST', candidateUrl())).toHaveLength(1)
    fireEvent.click(within(region).getByRole('button', { name: '같은 대조 요청 재확인' }))
    await waitFor(() => expect(sent(calls, 'POST', candidateUrl())).toHaveLength(2))
    const posts = sent(calls, 'POST', candidateUrl())
    expect(posts[1].headers['Idempotency-Key']).toBe(posts[0].headers['Idempotency-Key'])
  })

  it.each([
    [403, 'FORBIDDEN', '후보 대조 실행에 필요한 역할이 없습니다'],
    [404, 'RESOURCE_NOT_FOUND', '분석 기록을 찾을 수 없거나 접근 범위 밖입니다'],
  ])('실행 %s는 확정 거부로 안내하고 새 대조는 새 키로만 보낸다', async (status, code, title) => {
    const calls = stubFetch({ [`POST ${candidateUrl()}`]: () => (status === 404 ? new Response(null, { status }) : problem(status, code)) })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '예매 후보 대조 실행' }))
    expect(await within(region).findByText(title)).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '새 후보 대조 실행' }))
    await waitFor(() => expect(sent(calls, 'POST', candidateUrl())).toHaveLength(2))
    const posts = sent(calls, 'POST', candidateUrl())
    expect(posts[1].headers['Idempotency-Key']).not.toBe(posts[0].headers['Idempotency-Key'])
    expectNoSecret()
  })

  it('다른 분석의 실행 응답은 성공으로 표시하지 않고 같은 키 재확인만 연다', async () => {
    stubFetch({ [`POST ${candidateUrl()}`]: () => json(201, run({ analysisId: ANALYSIS_FAILED })) })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '예매 후보 대조 실행' }))
    expect(await within(region).findByText(/요청한 분석의 실행과 맞지 않아/)).toBeInTheDocument()
    expect(within(region).queryByText('후보 실행 기록이 생성되었습니다')).not.toBeInTheDocument()
    expect(within(region).getByRole('button', { name: '같은 대조 요청 재확인' })).toBeInTheDocument()
  })

  it('실행 완료가 아닌 분석은 실행 버튼 없이 기존 이력만 조회한다', async () => {
    const calls = stubFetch({ [`GET ${candidateHistoryUrl(0, ANALYSIS_FAILED)}`]: () => json(200, page([run({ analysisId: ANALYSIS_FAILED, status: 'ANALYSIS_FAILED', reason: 'ANALYSIS_NOT_SUCCEEDED', candidateCount: null, candidateId: null, applicability: 'NOT_APPLICABLE' })])) })
    renderApp()
    const attempt = await screen.findByRole('article', { name: `분석 시도 ${formatUtc('2026-11-03T09:00:00')}` })
    const region = within(attempt).getByRole('region', { name: '예매 후보 대조' })
    expect(within(region).queryByRole('button', { name: '예매 후보 대조 실행' })).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 보기' }))
    expect(await within(region).findByText('분석 결과 사용 불가 (ANALYSIS_FAILED)')).toBeInTheDocument()
    expect(sent(calls, 'POST', candidateUrl(ANALYSIS_FAILED))).toHaveLength(0)
  })
})

describe('후보 실행 이력', () => {
  it('서버 페이지 단위로 이동하고 빈 이력을 후보 없음과 구분한다', async () => {
    const calls = stubFetch({
      [`GET ${candidateHistoryUrl()}`]: () => json(200, page([run()], { hasNext: true })),
      [`GET ${candidateHistoryUrl(1)}`]: () => json(200, page([], { page: 1 })),
    })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 보기' }))
    const history = await within(region).findByRole('region', { name: '후보 실행 이력' })
    await within(history).findByRole('article')
    fireEvent.click(within(history).getByRole('button', { name: '다음 실행' }))
    expect(await within(history).findByText('이 페이지에 표시할 후보 실행이 없습니다')).toBeInTheDocument()
    expect(sent(calls, 'GET', candidateHistoryUrl(1))).toHaveLength(1)
  })

  it('비어 있는 첫 페이지는 후보 없음이 아닌 실행 기록 없음으로 안내하고 다시 조회는 GET만 보낸다', async () => {
    const calls = stubFetch({})
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 보기' }))
    expect(await within(region).findByText('아직 후보 실행 이력이 없습니다')).toBeInTheDocument()
    expect(within(region).getByText(/후보 없음\(NO_MATCH\) 결과와는 다른 상태입니다/)).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 다시 조회' }))
    await waitFor(() => expect(sent(calls, 'GET', candidateHistoryUrl())).toHaveLength(2))
    expect(sent(calls, 'POST', candidateUrl())).toHaveLength(0)
  })

  it.each([
    ['403', () => problem(403, 'FORBIDDEN'), '후보 실행 이력에 필요한 역할이 없습니다'],
    ['다른 분석 행 혼입', () => json(200, page([run({ evidenceId: '66666666-6666-4666-8666-666666666669' })])), '서버 응답 형식이 계약과 다릅니다'],
    ['서버 오류', () => problem(500, 'INTERNAL'), '서버 오류로 조회하지 못했습니다'],
  ])('이력 %s는 이 영역에만 오류로 안내하고 회차 영역은 그대로 둔다', async (_label, handler, title) => {
    stubFetch({ [`GET ${candidateHistoryUrl()}`]: handler })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 보기' }))
    expect(await within(region).findByText(title)).toBeInTheDocument()
    expect(await performanceRegion()).toBeInTheDocument()
    expectNoSecret()
  })
})

describe('기존 기능 유지', () => {
  it('관찰값 수동 교정은 계속 비활성이고 후보 실행으로 Case나 공식 PDF 요청을 보내지 않는다', async () => {
    const calls = stubFetch({ [`POST ${candidateUrl()}`]: () => json(201, run()), [`GET ${candidateHistoryUrl()}`]: () => json(200, page([run()])) })
    renderApp()
    const region = await candidateRegion()
    fireEvent.click(within(region).getByRole('button', { name: '예매 후보 대조 실행' }))
    await within(region).findByText('후보 실행 기록이 생성되었습니다')
    expect(screen.getByRole('button', { name: '관찰값 수동 교정' })).toBeDisabled()
    expect(calls.some((call) => call.url.startsWith('/api/v1/cases') || call.url.includes('official-pdf') || call.url.includes('reservation-imports'))).toBe(false)
  })
})
