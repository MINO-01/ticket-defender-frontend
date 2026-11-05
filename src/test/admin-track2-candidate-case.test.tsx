import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { buildCreateCaseRequest } from '../features/admin-cases/caseWorkflowApi'
import type { CreateCaseInput } from '../features/admin-cases/caseWorkflowApi'
import { formatUtc } from '../features/admin-track2/track2Api'

// Issue #39 Track 2 후보 실행을 신규 Case 출처로 연결하는 화면과 요청 계약을 Mock 인증 어댑터와 fetch로 검증한다.
// 요청 형식은 Backend main 5cacd75의 case-foundation-v1.yaml CreateCase.candidateRunIds와 CaseSourceVerifier를 따른다.
// 실제 Spring, MySQL 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터이며 예매번호 원문, HMAC 값은 쓰지 않는다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const CASE_1 = '11111111-1111-4111-8111-111111111111'
const MEMBER_CREATOR = '22222222-2222-4222-8222-222222222221'
const REPORT_1 = '55555555-5555-4555-8555-555555555551'
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661'
const ANALYSIS_1 = '77777777-7777-4777-8777-777777777771'
const PERF_1 = '99999999-9999-4999-8999-999999999991'
const LINK_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const RUN_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const RUN_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const RUN_OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'
const RUN_PENDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4'
const CANDIDATE_1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const BATCH_1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const SOURCE_REF = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const SHA = 'a'.repeat(64)

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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function problem(status: number, code: string) {
  return new Response(JSON.stringify({ status, code, detail: '내부 예매번호 SYN-RAW-0001 hmac=ffff' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

const found = (value: string) => ({ state: 'FOUND', value, evidenceQuote: null, unknownReason: null, candidates: [] })
const unknown = { state: 'UNKNOWN', value: null, evidenceQuote: null, unknownReason: 'ABSENT', candidates: [] }

const detail = {
  fanReportId: REPORT_1, event: { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }, reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED',
  receivedAt: '2026-11-01T09:30:00Z', retentionUntil: '2099-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z',
  seatArea: null, description: '합성 설명', listingUrl: null, platform: null, seller: '합성판매자', askingPrice: null,
  evidence: [{ evidenceId: EVIDENCE_1, mediaType: 'image/png', byteSize: 20480, storageStatus: 'STORED', originalStored: true, sha256: SHA, createdAt: '2026-11-01T09:30:00Z' }],
}

const analysis = {
  analysisId: ANALYSIS_1, fanReportId: REPORT_1, evidenceId: EVIDENCE_1, requestId: '88888888-8888-4888-8888-888888888881',
  executionStatus: 'SUCCEEDED', analysisStatus: 'COMPLETED', errorCode: null, analyzerHttpStatus: null, analyzerErrorCode: null,
  input: { expectedSha256: SHA, verifiedSha256: SHA, expectedByteSize: 20480, verifiedByteSize: 20480, mediaType: 'image/png' },
  modelName: 'synthetic-fake-provider', modelVersion: 'test-v1', analyzedAt: '2026-11-03T10:00:00', reviewRequired: true,
  fields: {
    eventName: found('합성 관찰 공연명'), performanceAt: found('2026-12-01 19:00'), platformDisplayName: unknown, askingPrice: unknown,
    currency: unknown, saleText: unknown, zone: found('A'), row: found('3'), seat: found('12'),
  },
  candidateMatch: { status: 'NOT_LINKED', reason: 'PERFORMANCE_REF_UNVERIFIED' }, createdAt: '2026-11-03T09:59:58', completedAt: '2026-11-03T10:00:01',
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_1, analysisId: ANALYSIS_1, fanReportId: REPORT_1, evidenceId: EVIDENCE_1, status: 'MATCH_CANDIDATE', reason: 'MATCHED_SINGLE_CANDIDATE',
    candidateCount: 1, candidateId: CANDIDATE_1, performanceLinkId: LINK_1, performanceLinkRevision: 2, verifiedPerformanceId: PERF_1, verifiedPerformanceRevision: 1,
    reservationBatchId: BATCH_1, reservationSourceVersion: 'syn-snapshot-1', evidenceSha256: SHA, analysisResponseSha256: 'b'.repeat(64), analysisRowVersion: 3,
    applicability: 'CURRENT', createdAt: '2026-11-05T01:00:00', completedAt: '2026-11-05T01:00:01', ...overrides,
  }
}

const runNoMatch = run({ runId: RUN_2, status: 'NO_MATCH', reason: 'NO_CANDIDATE_FOUND', candidateCount: 0, candidateId: null, createdAt: '2026-11-05T00:30:00' })
const runOld = run({ runId: RUN_OLD, applicability: 'RESERVATION_SOURCE_SUPERSEDED', createdAt: '2026-11-04T01:00:00' })
const runPending = run({ runId: RUN_PENDING, status: 'IN_PROGRESS', reason: 'LOOKUP_STARTED', candidateCount: null, candidateId: null, completedAt: null, createdAt: '2026-11-05T02:00:00' })

const caseView = {
  caseId: CASE_1, eventId: EVENT_A, type: 'FAN_REPORT', status: 'OPEN', caseVersion: 0, evidenceRevision: 1,
  createdByMembershipId: MEMBER_CREATOR, assigneeMembershipId: null, relatedCaseId: null, relationReason: null,
  classification: null, currentReportVersionId: null, createdAt: '2026-11-05T03:00:00Z', updatedAt: '2026-11-05T03:00:00Z',
}

const emptySource = {
  analysisRequestId: null, clusterId: null, storedMemberCount: null, analysisAlgorithm: null, analysisAlgorithmVersion: null,
  analysisCompletedAt: null, riskScore: null, linkedAt: '2026-11-05T03:00:00Z',
}

const candidateSource = {
  ...emptySource, sourceReferenceId: SOURCE_REF, sourceType: 'LISTING_CANDIDATE_MATCH', fanReportId: REPORT_1, evidenceId: EVIDENCE_1,
  candidateRunId: RUN_1, candidateAnalysisId: ANALYSIS_1, candidateStatus: 'MATCH_CANDIDATE', candidateReason: 'MATCHED_SINGLE_CANDIDATE',
  candidateCount: 1, candidateId: CANDIDATE_1, candidateApplicability: 'CURRENT',
}

const page = (items: unknown[] = [], extra: Record<string, unknown> = {}) => ({ items, page: 0, pageSize: 20, hasNext: false, ...extra })
const detailUrl = `/api/v1/admin/fan-reports/${REPORT_1}`
const historyUrl = (pageNumber = 0) => `${detailUrl}/evidence/${EVIDENCE_1}/listing-analyses/${ANALYSIS_1}/candidate-matches?page=${pageNumber}&pageSize=20`
const casePath = `/api/v1/cases/${CASE_1}`

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }
type Handler = (call: Call, count: number) => Response | Promise<Response> | undefined

function stubFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const base: Record<string, Handler> = {
    [`GET ${detailUrl}`]: () => json(200, detail),
    [`GET ${detailUrl}/evidence/${EVIDENCE_1}/listing-analyses?page=0&pageSize=20`]: () => json(200, page([analysis])),
    [`GET /api/v1/admin/events/${EVENT_A}/verified-performances`]: () => json(200, []),
    [`GET ${detailUrl}/performance-link`]: () => json(200, { items: [] }),
    [`GET ${historyUrl()}`]: () => json(200, page([run(), runNoMatch, runOld, runPending])),
    'POST /api/v1/cases': () => json(201, caseView),
    [`GET ${casePath}`]: () => json(200, caseView),
    [`GET ${casePath}/sources`]: () => json(200, [
      { ...emptySource, sourceReferenceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', sourceType: 'FAN_REPORT', fanReportId: REPORT_1, evidenceId: null },
      { ...emptySource, sourceReferenceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', sourceType: 'EVIDENCE_ASSET', fanReportId: REPORT_1, evidenceId: EVIDENCE_1 },
      candidateSource,
    ]),
    [`GET ${casePath}/activities?page=0&pageSize=20`]: () => json(200, page()),
    [`GET ${casePath}/evidence-snapshots?page=0&pageSize=20`]: () => json(200, page()),
    [`GET ${casePath}/report-versions?page=0&pageSize=20`]: () => json(200, page()),
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

const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')

function renderApp() {
  return render(<MemoryRouter initialEntries={[`/app/fan-reports/${REPORT_1}`]}><App adminAuthAdapter={createMockAdapter()} /><LocationProbe /></MemoryRouter>)
}

const caseRegion = () => screen.getByRole('region', { name: 'Case 생성' })

async function openHistory() {
  const attempt = await screen.findByRole('article', { name: `분석 시도 ${formatUtc('2026-11-03T09:59:58')}` })
  const region = within(attempt).getByRole('region', { name: '예매 후보 대조' })
  fireEvent.click(within(region).getByRole('button', { name: '후보 실행 이력 보기' }))
  return within(region).findByRole('region', { name: '후보 실행 이력' })
}

async function runItem(history: HTMLElement, createdAt: string) {
  return within(history).findByRole('article', { name: `후보 실행 ${formatUtc(createdAt)}` })
}

function selectEvidenceAndReason() {
  fireEvent.click(within(caseRegion()).getAllByRole('checkbox')[0])
  fireEvent.change(within(caseRegion()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 후보 조사' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Case 생성 요청의 candidateRunIds 계약', () => {
  const base: CreateCaseInput = { eventId: EVENT_A, graphClusters: [], fanReportIds: [REPORT_1], evidenceIds: [EVIDENCE_1], reason: '합성 생성 사유' }
  const cluster = { analysisRequestId: '99999999-9999-4999-8999-999999999990', clusterId: 'cluster-1' }

  it('선택한 후보 실행만 본문에 넣고, 선택하지 않으면 기존 본문을 그대로 만든다', () => {
    expect(buildCreateCaseRequest({ ...base, candidateRunIds: [RUN_1.toUpperCase()] })).toMatchObject({ ok: true, body: { type: 'FAN_REPORT', fanReportIds: [REPORT_1], evidenceIds: [EVIDENCE_1], candidateRunIds: [RUN_1] } })
    expect(buildCreateCaseRequest({ ...base, graphClusters: [cluster], candidateRunIds: [RUN_1] })).toMatchObject({ ok: true, body: { type: 'COMBINED', candidateRunIds: [RUN_1] } })
    for (const input of [base, { ...base, candidateRunIds: [] }]) {
      const built = buildCreateCaseRequest(input)
      expect(built.ok && 'candidateRunIds' in built.body).toBe(false)
    }
  })

  it.each([
    ['후보만 있는 요청', { fanReportIds: [], evidenceIds: [], candidateRunIds: [RUN_1] }, '연결할 출처가 없습니다'],
    ['군집만 있는 GRAPH_CLUSTER', { graphClusters: [cluster], fanReportIds: [], evidenceIds: [], candidateRunIds: [RUN_1] }, '소속 제보와 증거 이미지를 함께'],
    ['증거 없이 제보와 후보', { evidenceIds: [], candidateRunIds: [RUN_1] }, '소속 제보와 증거 이미지를 함께'],
    ['UUID가 아닌 실행 ID', { candidateRunIds: ['run-1'] }, '후보 실행 ID 형식'],
    ['대소문자만 다른 중복 실행', { candidateRunIds: [RUN_1, RUN_1.toUpperCase()] }, '중복'],
    ['총 출처 30개 초과', { candidateRunIds: Array.from({ length: 29 }, (_, index) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`) }, '최대 30개'],
  ])('%s는 요청을 만들지 않는다', (_, overrides, message) => {
    expect(buildCreateCaseRequest({ ...base, ...overrides })).toMatchObject({ ok: false, errors: { sources: expect.stringContaining(message) } })
  })
})

describe('후보 실행 이력에서 신규 Case 출처 선택', () => {
  it('CURRENT 실행을 고르고 소속 증거와 함께 요청한 뒤 실제 Case 상세에서 후보 출처를 확인한다', async () => {
    const calls = stubFetch({})
    renderApp()
    const history = await openHistory()
    const item = await runItem(history, '2026-11-05T01:00:00')
    expect(writes(calls)).toHaveLength(0)
    fireEvent.click(within(item).getByRole('button', { name: '신규 Case 출처로 선택' }))
    expect(within(item).getByRole('button', { name: '신규 Case 출처 선택 해제' })).toHaveAttribute('aria-pressed', 'true')
    // 선택만으로 Case를 만들지 않는다.
    expect(writes(calls)).toHaveLength(0)

    const selected = within(caseRegion()).getByRole('group', { name: '함께 연결할 후보 실행' })
    expect(selected).toHaveTextContent('단일 조사 후보 (MATCH_CANDIDATE)')
    expect(selected).toHaveTextContent('현재 기준에 적용됨 (CURRENT)')
    expect(selected).toHaveTextContent(RUN_1)
    expect(selected).toHaveTextContent('부정 거래나 불법 거래 확정이 아닙니다')
    expect(within(selected).getByRole('note')).toHaveTextContent('APPROVAL_BASIS_BLOCKED')

    selectEvidenceAndReason()
    fireEvent.click(within(caseRegion()).getByRole('button', { name: 'Case 생성' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/app/cases/${CASE_1}?eventId=${EVENT_A}`))
    expect(writes(calls)).toHaveLength(1)
    expect(writes(calls)[0].body).toEqual({
      eventId: EVENT_A, type: 'FAN_REPORT', graphClusters: [], fanReportIds: [REPORT_1], evidenceIds: [EVIDENCE_1], candidateRunIds: [RUN_1],
      reason: '합성 후보 조사', relatedCaseId: null, relationReason: null,
    })
    const source = await screen.findByRole('article', { name: 'Track 2 예매 후보 대조 실행' })
    expect(source).toHaveTextContent(RUN_1)
    expect(source).toHaveTextContent('단일 조사 후보 (MATCH_CANDIDATE)')
    expect(source).toHaveTextContent('APPROVAL_BASIS_BLOCKED')
    expect(screen.queryByText(/SYN-RAW|hmac/)).not.toBeInTheDocument()
  })

  it('NO_MATCH도 원래 의미대로 선택할 수 있고, 과거 실행과 진행 중 실행은 선택할 수 없다', async () => {
    stubFetch({})
    renderApp()
    const history = await openHistory()
    const noMatch = await runItem(history, '2026-11-05T00:30:00')
    expect(noMatch).toHaveTextContent('후보 없음 (NO_MATCH)')
    expect(within(noMatch).getByRole('button', { name: '신규 Case 출처로 선택' })).toBeEnabled()
    const old = await runItem(history, '2026-11-04T01:00:00')
    expect(within(old).queryByRole('button', { name: /신규 Case 출처/ })).not.toBeInTheDocument()
    expect(old).toHaveTextContent('현재 기준(CURRENT)이 아닌 실행은 이력으로만 표시')
    const pending = await runItem(history, '2026-11-05T02:00:00')
    expect(within(pending).queryByRole('button', { name: /신규 Case 출처/ })).not.toBeInTheDocument()
    expect(pending).toHaveTextContent('진행 중인 실행은 Case 출처로 선택할 수 없습니다')
  })

  it('소속 증거를 선택하지 않으면 안내하고 생성을 막으며, 선택 해제하면 기존 팬 제보 요청으로 돌아간다', async () => {
    const calls = stubFetch({})
    renderApp()
    const history = await openHistory()
    fireEvent.click(within(await runItem(history, '2026-11-05T01:00:00')).getByRole('button', { name: '신규 Case 출처로 선택' }))
    fireEvent.change(within(caseRegion()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 후보 조사' } })
    expect(within(caseRegion()).getByText(/소속 증거\(증거 1\)를 함께 연결할 증거 이미지에서 선택해 주세요/)).toBeInTheDocument()
    expect(within(caseRegion()).getByRole('button', { name: 'Case 생성' })).toBeDisabled()
    expect(writes(calls)).toHaveLength(0)

    fireEvent.click(within(caseRegion()).getByRole('button', { name: '선택 해제' }))
    expect(within(caseRegion()).getByRole('button', { name: 'Case 생성' })).toBeEnabled()
    fireEvent.click(within(caseRegion()).getByRole('button', { name: 'Case 생성' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0].body).toEqual({ eventId: EVENT_A, type: 'FAN_REPORT', graphClusters: [], fanReportIds: [REPORT_1], evidenceIds: [], reason: '합성 후보 조사', relatedCaseId: null, relationReason: null })
  })

  it('이력 페이지를 넘겨도 선택한 실행이 유지되고 다른 실행으로 옮겨 가지 않는다', async () => {
    stubFetch({
      [`GET ${historyUrl()}`]: () => json(200, page([run()], { hasNext: true })),
      [`GET ${historyUrl(1)}`]: () => json(200, page([runNoMatch], { page: 1 })),
    })
    renderApp()
    const history = await openHistory()
    fireEvent.click(within(await runItem(history, '2026-11-05T01:00:00')).getByRole('button', { name: '신규 Case 출처로 선택' }))
    fireEvent.click(within(history).getByRole('button', { name: '다음 실행' }))
    const next = await runItem(history, '2026-11-05T00:30:00')
    expect(within(next).getByRole('button', { name: '신규 Case 출처로 선택' })).toHaveAttribute('aria-pressed', 'false')
    const selected = within(caseRegion()).getByRole('group', { name: '함께 연결할 후보 실행' })
    expect(selected).toHaveTextContent(RUN_1)
    expect(selected).not.toHaveTextContent(RUN_2)
  })

  it('재조회에서 선택한 실행이 CURRENT가 아니게 되면 생성을 막고 해제를 안내한다', async () => {
    stubFetch({ [`GET ${historyUrl()}`]: (_, count) => json(200, page([count === 1 ? run() : run({ applicability: 'PERFORMANCE_REVISION_CHANGED' })])) })
    renderApp()
    const history = await openHistory()
    fireEvent.click(within(await runItem(history, '2026-11-05T01:00:00')).getByRole('button', { name: '신규 Case 출처로 선택' }))
    selectEvidenceAndReason()
    expect(within(caseRegion()).getByRole('button', { name: 'Case 생성' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '후보 실행 이력 다시 조회' }))
    await waitFor(() => expect(within(caseRegion()).getByText(/현재 기준\(CURRENT\)이 아닌 후보 실행이 선택되어 있습니다/)).toBeInTheDocument())
    expect(within(caseRegion()).getByRole('button', { name: 'Case 생성' })).toBeDisabled()
  })

  it('응답을 받지 못하면 선택을 잠그고 같은 키와 같은 본문으로만 재확인한다', async () => {
    const calls = stubFetch({ 'POST /api/v1/cases': (_, count) => count === 1 ? Promise.reject(new TypeError('offline')) : json(201, caseView) })
    renderApp()
    const history = await openHistory()
    const item = await runItem(history, '2026-11-05T01:00:00')
    fireEvent.click(within(item).getByRole('button', { name: '신규 Case 출처로 선택' }))
    selectEvidenceAndReason()
    fireEvent.click(within(caseRegion()).getByRole('button', { name: 'Case 생성' }))
    expect(await within(caseRegion()).findByRole('alert')).toHaveTextContent('결과 미확인')
    // 결과를 확인하지 못한 동안에는 선택을 바꾸지 못한다.
    expect(within(item).getByRole('button', { name: '신규 Case 출처 선택 해제' })).toBeDisabled()
    expect(within(await runItem(history, '2026-11-05T00:30:00')).getByRole('button', { name: '신규 Case 출처로 선택' })).toBeDisabled()
    expect(within(caseRegion()).getByRole('button', { name: '선택 해제' })).toBeDisabled()
    await act(async () => { fireEvent.click(within(caseRegion()).getByRole('button', { name: '같은 요청 재확인' })) })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/app/cases/${CASE_1}`))
    const [first, second] = writes(calls)
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key'])
    expect(second.body).toEqual(first.body)
    expect(first.body).toMatchObject({ candidateRunIds: [RUN_1], evidenceIds: [EVIDENCE_1] })
  })

  it.each([
    [422, 'SOURCE_NOT_AVAILABLE', '현재 기준(CURRENT)이 아니게 된 경우'],
    [404, 'RESOURCE_NOT_FOUND', '후보 실행의 소속 제보와 증거'],
    [409, 'SOURCE_CHANGED', '확인 중에 출처 상태가 바뀌었습니다'],
    [403, 'FORBIDDEN', 'Case 생성에 필요한 역할이 없습니다'],
  ])('%i %s는 Case를 만들지 않고 안내한다', async (status, code, text) => {
    stubFetch({ 'POST /api/v1/cases': () => problem(status, code) })
    renderApp()
    const history = await openHistory()
    fireEvent.click(within(await runItem(history, '2026-11-05T01:00:00')).getByRole('button', { name: '신규 Case 출처로 선택' }))
    selectEvidenceAndReason()
    fireEvent.click(within(caseRegion()).getByRole('button', { name: 'Case 생성' }))
    expect(await within(caseRegion()).findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByTestId('location')).toHaveTextContent(`/app/fan-reports/${REPORT_1}`)
    expect(screen.queryByText(/SYN-RAW|hmac/)).not.toBeInTheDocument()
  })
})
