import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import type { CaseView } from '../features/admin-cases/caseApi'
import { reportVersionSchema } from '../features/admin-cases/caseWorkflowApi'
import {
  approvalRequestPath, approvalRequestRoute, approvalRequestSchema, approvalSubmitPath, buildApprovalSubmitRequest, buildDecisionRequest, buildWithdrawRequest,
  decisionPath, decisionViewSchema, readReportContent, reportVersionDetailPath, reviewPackagePath, reviewPackageSchema, reviewReceiptSchema, withdrawPath,
} from '../features/admin-approvals/approvalApi'
import type { ApprovalRequestView, ReviewPackage } from '../features/admin-approvals/approvalApi'

// Issue #33 승인 요청, 철회, 독립 검토, 영수증, 결정 화면을 Mock 인증 어댑터와 fetch로 검증한다.
// 요청과 응답 형식은 Backend main 17c832b의 ApprovalRequestController, ApprovalRequestDto, ApprovalReviewDto, ApprovalReviewService를 따른다.
// 실제 Keycloak, Spring, MySQL 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const CASE_1 = '11111111-1111-4111-8111-111111111111'
const MEMBER_REVIEWER = '22222222-2222-4222-8222-222222222222'
const SNAPSHOT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const REPORT_VERSION_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const REQUEST_1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const RECEIPT_1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const DECISION_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const RECEIPT_TOKEN = 'SyntheticReviewReceiptToken_Only-For-Tests_0123456789'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TEMPLATE = 'case-approval-input-v1'

const CONTENT_JSON = JSON.stringify({
  contentSchemaVersion: 1, templateVersion: TEMPLATE, evidenceSnapshotId: SNAPSHOT_1, manifestSha256: SHA_A,
  title: '<img src=x onerror="window.__approvalXss=1">합성 보고서 제목',
  assessment: '<script>window.__approvalXss=1</script>합성 평가 본문',
  limitations: '합성 한계', conclusion: '합성 결론',
})
const MANIFEST_JSON = JSON.stringify({
  manifestSchemaVersion: 1,
  sources: [{ sourceType: 'STORED_CLUSTER_EVIDENCE', clusterId: '<b onclick="window.__approvalXss=1">cluster-7</b>', riskScore: 0.42 }],
})

function createMockAdapter() {
  return {
    availability: { status: 'ready' },
    // 영수증 만료 시험에서 시계를 앞당겨도 관리자 세션은 유지되도록 길게 둔다.
    initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 86_400_000 })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

let navigateTo: (path: string) => void = () => undefined

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  // 화면 이탈과 재진입을 시험하려고 렌더링 뒤에만 이동 함수를 바깥에 노출한다.
  useEffect(() => { navigateTo = (path) => navigate(path) }, [navigate])
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={createMockAdapter()} /><LocationProbe /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// 계약에 없는 detail에 내부 정보가 섞여 와도 화면에 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ title: 'Problem', status, code, detail: `내부 정보 ${RECEIPT_TOKEN}` }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

function deferred() {
  let resolve!: (response: Response) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }
type Handler = (call: Call, count: number) => Response | Promise<Response> | undefined

function stubFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const key = `${call.method} ${call.url}`
    counts[key] = (counts[key] ?? 0) + 1
    const response = await routes[key]?.(call, counts[key])
    if (!response) throw new Error(`예상하지 못한 요청: ${key}`)
    return response
  }))
  return calls
}

const posts = (calls: Call[], url: string) => calls.filter((call) => call.method === 'POST' && call.url === url)
const gets = (calls: Call[], url: string) => calls.filter((call) => call.method === 'GET' && call.url === url)

function caseView(overrides: Partial<CaseView> = {}): CaseView {
  return {
    caseId: CASE_1, eventId: EVENT_A, type: 'GRAPH_CLUSTER', status: 'IN_REVIEW', caseVersion: 6, evidenceRevision: 1,
    createdByMembershipId: MEMBER_REVIEWER, assigneeMembershipId: MEMBER_REVIEWER, relatedCaseId: null, relationReason: null,
    classification: '합성 분류', currentReportVersionId: null, createdAt: '2026-11-01T09:30:00Z', updatedAt: '2026-11-02T09:30:00Z', ...overrides,
  }
}

function reportVersion(overrides: Record<string, unknown> = {}) {
  return {
    reportVersionId: REPORT_VERSION_1, caseId: CASE_1, eventId: EVENT_A, evidenceSnapshotId: SNAPSHOT_1, evidenceRevision: 1, revision: 1, version: 0,
    templateVersion: TEMPLATE, templateSha256: SHA_B, contentSha256: SHA_C, contentJson: CONTENT_JSON, status: 'DRAFT',
    renderable: false, approvalEligible: false, createdByMembershipId: MEMBER_REVIEWER, createdAt: '2026-11-02T11:00:00Z', ...overrides,
  }
}

function requestView(overrides: Record<string, unknown> = {}) {
  return {
    approvalRequestId: REQUEST_1, caseId: CASE_1, eventId: EVENT_A, reportVersionId: REPORT_VERSION_1, reportRevision: 1, reportContentSha256: SHA_C,
    reportTemplateVersion: TEMPLATE, reportTemplateSha256: SHA_B, evidenceSnapshotId: SNAPSHOT_1, evidenceRevision: 1, manifestSha256: SHA_A,
    requestedBy: MEMBER_REVIEWER, requestedAt: '2026-11-03T10:00:00Z', reason: '<b>합성 승인 요청 사유</b>', status: 'PENDING',
    caseVersionAtSubmit: 6, version: 0, approvalEligibility: 'BLOCKED', ...overrides,
  }
}

function reviewPackage(overrides: Record<string, unknown> = {}) {
  return {
    approvalRequestId: REQUEST_1, requestStatus: 'PENDING', caseId: CASE_1, eventId: EVENT_A, caseVersion: 7, evidenceSnapshotId: SNAPSHOT_1,
    evidenceRevision: 1, manifestSha256: SHA_A, manifestJson: MANIFEST_JSON, reportVersionId: REPORT_VERSION_1, reportRevision: 1, reportVersion: 1,
    reportContentSha256: SHA_C, reportTemplateVersion: TEMPLATE, reportTemplateSha256: SHA_B, reportContentJson: CONTENT_JSON, issuanceEligibility: 'BLOCKED',
    ...overrides,
  }
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    reviewReceiptId: RECEIPT_1, approvalRequestId: REQUEST_1, status: 'ISSUED', reviewReceiptToken: RECEIPT_TOKEN,
    issuedAt: '2026-11-04T01:00:00Z', expiresAt: '2026-11-04T01:15:00Z', ...overrides,
  }
}

function decisionView(outcome: 'APPROVE' | 'REJECT', overrides: Record<string, unknown> = {}) {
  const approved = outcome === 'APPROVE'
  return {
    approvalDecisionId: DECISION_1, approvalRequestId: REQUEST_1, outcome, requestStatus: approved ? 'APPROVED' : 'REJECTED',
    caseStatus: approved ? 'APPROVED_FOR_REPORT' : 'IN_REVIEW', reportStatus: approved ? 'APPROVED' : 'REJECTED', reviewReceiptId: RECEIPT_1,
    caseVersion: 8, requestVersion: 1, reportVersion: 2, decidedAt: '2026-11-04T01:05:00Z', issuanceEligibility: 'BLOCKED', ...overrides,
  }
}

const withdrawView = { approvalRequestId: REQUEST_1, requestStatus: 'WITHDRAWN', caseStatus: 'IN_REVIEW', reportStatus: 'WITHDRAWN', caseVersion: 8, requestVersion: 1, reportVersion: 2 }

const page = (items: unknown[] = []) => ({ items, page: 0, pageSize: 20, hasNext: false })
const casePath = `/api/v1/cases/${CASE_1}`
const sourcesPath = `${casePath}/sources`
const activitiesPath = `${casePath}/activities?page=0&pageSize=20`
const snapshotsPath = `${casePath}/evidence-snapshots?page=0&pageSize=20`
const draftsPath = `${casePath}/report-versions?page=0&pageSize=20`
const requestPath = `/api/v1/approval-requests/${REQUEST_1}`
const packagePath = `${requestPath}/review-package`
const caseRoute = `/app/cases/${CASE_1}?eventId=${EVENT_A}`
const requestRoute = `/app/approvals/${REQUEST_1}`

function caseRoutes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    [`GET ${casePath}`]: () => json(200, caseView()),
    [`GET ${sourcesPath}`]: () => json(200, []),
    [`GET ${activitiesPath}`]: () => json(200, page()),
    [`GET ${snapshotsPath}`]: () => json(200, page()),
    [`GET ${draftsPath}`]: () => json(200, page([reportVersion()])),
    ...extra,
  }
}

function requestRoutes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return { [`GET ${requestPath}`]: () => json(200, requestView()), ...extra }
}

function expectTokenNotLeaked(spies: ReturnType<typeof vi.spyOn>[] = []) {
  expect(document.body.innerHTML).not.toContain(RECEIPT_TOKEN)
  expect(screen.getByTestId('location').textContent).not.toContain(RECEIPT_TOKEN)
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) ?? ''
      expect(`${key}${storage.getItem(key)}`).not.toContain(RECEIPT_TOKEN)
    }
  }
  for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(RECEIPT_TOKEN)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  delete (window as { __approvalXss?: unknown }).__approvalXss
})

describe('승인 계약 경로와 스키마', () => {
  it('Backend 컨트롤러 경로를 그대로 만든다', () => {
    expect(approvalSubmitPath(CASE_1)).toBe(`${casePath}/approval-requests`)
    expect(approvalRequestPath(REQUEST_1)).toBe(requestPath)
    expect(reviewPackagePath(REQUEST_1)).toBe(packagePath)
    expect(decisionPath(REQUEST_1)).toBe(`${requestPath}/decision`)
    expect(withdrawPath(REQUEST_1)).toBe(`${requestPath}/withdraw`)
    expect(reportVersionDetailPath(REPORT_VERSION_1)).toBe(`/api/v1/report-versions/${REPORT_VERSION_1}`)
    expect(approvalRequestRoute(REQUEST_1)).toBe(requestRoute)
  })

  it('승인 적격성과 발급 적격성이 BLOCKED가 아닌 응답은 계약 위반으로 거부한다', () => {
    expect(approvalRequestSchema.safeParse(requestView()).success).toBe(true)
    expect(approvalRequestSchema.safeParse(requestView({ approvalEligibility: 'ELIGIBLE' })).success).toBe(false)
    expect(approvalRequestSchema.safeParse(requestView({ status: 'DONE' })).success).toBe(false)
    expect(reviewPackageSchema.safeParse(reviewPackage()).success).toBe(true)
    expect(reviewPackageSchema.safeParse(reviewPackage({ issuanceEligibility: 'ELIGIBLE' })).success).toBe(false)
    expect(reviewPackageSchema.safeParse(reviewPackage({ requestStatus: 'APPROVED' })).success).toBe(false)
    expect(decisionViewSchema.safeParse(decisionView('APPROVE')).success).toBe(true)
    expect(decisionViewSchema.safeParse(decisionView('APPROVE', { issuanceEligibility: 'ELIGIBLE' })).success).toBe(false)
  })

  it('영수증 토큰은 길이와 URL-safe 문자 형식을 확인한다', () => {
    expect(reviewReceiptSchema.safeParse(receipt()).success).toBe(true)
    expect(reviewReceiptSchema.safeParse(receipt({ reviewReceiptToken: 'short' })).success).toBe(false)
    expect(reviewReceiptSchema.safeParse(receipt({ reviewReceiptToken: `${'a'.repeat(40)}\r\nX-Injected: 1` })).success).toBe(false)
    expect(reviewReceiptSchema.safeParse(receipt({ status: 'CONSUMED' })).success).toBe(false)
  })

  it('승인 요청 본문은 최신 DRAFT 보고서와 현재 Case 버전, 보고서 digest를 그대로 쓴다', () => {
    const view = caseView()
    const draft = reportVersionSchema.parse(reportVersion())
    expect(buildApprovalSubmitRequest(view, draft, '  합성 승인 요청 사유  ')).toEqual({ ok: true, body: {
      reportVersionId: REPORT_VERSION_1, evidenceSnapshotId: SNAPSHOT_1, expectedCaseVersion: 6, expectedReportVersion: 0, expectedReportContentSha256: SHA_C, reason: '합성 승인 요청 사유',
    } })
    expect(buildApprovalSubmitRequest(view, draft, ' a ').ok).toBe(false)
    expect(buildApprovalSubmitRequest(view, draft, 'x'.repeat(1801)).ok).toBe(false)
    expect(buildApprovalSubmitRequest(caseView({ status: 'TRIAGED' }), draft, '합성 사유').ok).toBe(false)
    expect(buildApprovalSubmitRequest(view, reportVersionSchema.parse(reportVersion({ evidenceRevision: 2 })), '합성 사유').ok).toBe(false)
    expect(buildApprovalSubmitRequest(view, reportVersionSchema.parse(reportVersion({ status: 'PENDING_APPROVAL' })), '합성 사유').ok).toBe(false)
    expect(buildApprovalSubmitRequest(view, null, '합성 사유').ok).toBe(false)
  })

  it('결정 본문은 검토 확인과 영수증이 있어야 만들고 서버 필드만 보낸다', () => {
    const request = approvalRequestSchema.parse(requestView()) as ApprovalRequestView
    const pkg = reviewPackageSchema.parse(reviewPackage()) as ReviewPackage
    expect(buildDecisionRequest(request, pkg, { outcome: 'APPROVE', reason: ' 합성 승인 사유 ', reviewConfirmed: true }, RECEIPT_TOKEN)).toEqual({ ok: true, body: {
      outcome: 'APPROVE', reason: '합성 승인 사유', evidenceSnapshotId: SNAPSHOT_1, manifestSha256: SHA_A, reportContentSha256: SHA_C, reviewReceiptToken: RECEIPT_TOKEN,
      reviewConfirmed: true, expectedCaseVersion: 7, expectedRequestVersion: 0, expectedReportVersion: 1,
    } })
    expect(buildDecisionRequest(request, pkg, { outcome: 'APPROVE', reason: '합성 사유', reviewConfirmed: false }, RECEIPT_TOKEN).ok).toBe(false)
    expect(buildDecisionRequest(request, pkg, { outcome: 'APPROVE', reason: '합성 사유', reviewConfirmed: true }, null).ok).toBe(false)
    expect(buildDecisionRequest(request, pkg, { outcome: '', reason: '합성 사유', reviewConfirmed: true }, RECEIPT_TOKEN).ok).toBe(false)
    // 검토 패키지가 요청의 고정 근거와 다르면 결정 본문을 만들지 않는다.
    const changed = reviewPackageSchema.parse(reviewPackage({ manifestSha256: SHA_B })) as ReviewPackage
    expect(buildDecisionRequest(request, changed, { outcome: 'APPROVE', reason: '합성 사유', reviewConfirmed: true }, RECEIPT_TOKEN).ok).toBe(false)
  })

  it('철회 본문은 최신 Case, 요청, 보고서 버전을 쓴다', () => {
    const request = approvalRequestSchema.parse(requestView({ version: 3 })) as ApprovalRequestView
    const report = reportVersionSchema.parse(reportVersion({ version: 1, status: 'PENDING_APPROVAL' }))
    expect(buildWithdrawRequest(request, caseView({ status: 'READY_FOR_APPROVAL', caseVersion: 7 }), report, '합성 철회 사유')).toEqual({ ok: true, body: {
      reason: '합성 철회 사유', expectedCaseVersion: 7, expectedRequestVersion: 3, expectedReportVersion: 1,
    } })
    expect(buildWithdrawRequest(request, caseView({ caseId: '11111111-1111-4111-8111-111111111112' }), report, '합성 철회 사유').ok).toBe(false)
    expect(buildWithdrawRequest(request, caseView(), reportVersionSchema.parse(reportVersion({ reportVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' })), '합성 철회 사유').ok).toBe(false)
  })

  it('봉인된 보고서 JSON은 파싱 실패나 근거 불일치를 확인 불가로 돌려준다', () => {
    const pkg = reviewPackageSchema.parse(reviewPackage()) as ReviewPackage
    expect(readReportContent(pkg)).toMatchObject({ ok: true, content: { title: '<img src=x onerror="window.__approvalXss=1">합성 보고서 제목', conclusion: '합성 결론' } })
    expect(readReportContent({ ...pkg, reportContentJson: '{not json' }).ok).toBe(false)
    expect(readReportContent({ ...pkg, reportContentJson: JSON.stringify({ ...JSON.parse(CONTENT_JSON), manifestSha256: SHA_B }) }).ok).toBe(false)
    expect(readReportContent({ ...pkg, reportContentJson: JSON.stringify({ ...JSON.parse(CONTENT_JSON), title: 7 }) }).ok).toBe(false)
  })
})

describe('REVIEWER 승인 요청 생성', () => {
  it('Case 상세에서 최신 DRAFT로 승인 요청을 만들고 요청 상세로 이동해 고정 근거를 표시한다', async () => {
    const calls = stubFetch({ ...caseRoutes(), ...requestRoutes(), [`POST ${casePath}/approval-requests`]: () => json(201, requestView()) })
    renderApp(caseRoute)
    const region = await screen.findByRole('region', { name: '승인 요청 제출' })
    expect(await within(region).findByText(REPORT_VERSION_1)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '공식 PDF 발급' })).toBeDisabled()
    fireEvent.change(within(region).getByRole('textbox', { name: /승인 요청 사유/ }), { target: { value: '합성 승인 요청 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '승인 요청 제출' }))
    fireEvent.click(within(region).getByRole('button', { name: /승인 요청/ }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(requestRoute))
    const sent = posts(calls, `${casePath}/approval-requests`)
    expect(sent).toHaveLength(1)
    expect(sent[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(sent[0].body).toEqual({ reportVersionId: REPORT_VERSION_1, evidenceSnapshotId: SNAPSHOT_1, expectedCaseVersion: 6, expectedReportVersion: 0, expectedReportContentSha256: SHA_C, reason: '합성 승인 요청 사유' })
    const overview = await screen.findByRole('region', { name: '승인 요청 개요' })
    expect(within(overview).getByText('승인 대기 (PENDING)')).toBeInTheDocument()
    for (const value of [CASE_1, SNAPSHOT_1, REPORT_VERSION_1, SHA_A, SHA_C, MEMBER_REVIEWER]) expect(within(overview).getAllByText(value).length).toBeGreaterThan(0)
    expect(within(overview).getByText('<b>합성 승인 요청 사유</b>')).toBeInTheDocument()
    expect(within(overview).getByText(/차단 \(BLOCKED\)/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('합성 평가 본문')
  })

  it('응답 유실은 결과 미확인으로 두고 같은 키와 같은 본문으로만 재확인한다', async () => {
    const calls = stubFetch({
      ...caseRoutes(), ...requestRoutes(),
      [`POST ${casePath}/approval-requests`]: (_call, count) => { if (count === 1) throw new TypeError('network'); return json(201, requestView()) },
    })
    renderApp(caseRoute)
    const region = await screen.findByRole('region', { name: '승인 요청 제출' })
    await within(region).findByText(REPORT_VERSION_1)
    fireEvent.change(within(region).getByRole('textbox', { name: /승인 요청 사유/ }), { target: { value: '합성 승인 요청 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '승인 요청 제출' }))
    expect(await within(region).findByText(/결과 미확인/)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(`/app/cases/${CASE_1}`)
    fireEvent.click(within(region).getByRole('button', { name: '승인 요청 재확인' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(requestRoute))
    const sent = posts(calls, `${casePath}/approval-requests`)
    expect(sent).toHaveLength(2)
    expect(sent[1].headers['Idempotency-Key']).toBe(sent[0].headers['Idempotency-Key'])
    expect(sent[1].body).toEqual(sent[0].body)
  })

  it.each([
    [409, 'APPROVAL_REQUEST_ALREADY_PENDING', '이미 승인 대기 중인 요청이 있습니다'],
    [422, 'APPROVAL_BASIS_BLOCKED', '증거 보존 근거가 승인 요청 조건을 충족하지 않습니다'],
    [409, 'REPORT_VERSION_CONFLICT', '보고서가 먼저 변경되었습니다'],
  ])('승인 요청 %s %s를 안내하고 서버의 최신 Case를 다시 조회한다', async (status, code, title) => {
    const calls = stubFetch({ ...caseRoutes(), [`POST ${casePath}/approval-requests`]: () => problem(status, code) })
    renderApp(caseRoute)
    const region = await screen.findByRole('region', { name: '승인 요청 제출' })
    await within(region).findByText(REPORT_VERSION_1)
    fireEvent.change(within(region).getByRole('textbox', { name: /승인 요청 사유/ }), { target: { value: '합성 승인 요청 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '승인 요청 제출' }))
    expect(await screen.findByText(title, { exact: false })).toBeInTheDocument()
    await waitFor(() => expect(gets(calls, casePath).length).toBeGreaterThanOrEqual(2))
    expect(document.body.textContent).not.toContain('내부 정보')
  })

  it('승인 대기 중인 Case는 요청 ID를 조회할 계약이 없음을 안내하고 새 요청을 받지 않는다', async () => {
    stubFetch(caseRoutes({ [`GET ${casePath}`]: () => json(200, caseView({ status: 'READY_FOR_APPROVAL', currentReportVersionId: REPORT_VERSION_1 })) }))
    renderApp(caseRoute)
    const region = await screen.findByRole('region', { name: '승인 요청 제출' })
    expect(within(region).getByText(/승인 요청 ID를 알려 주는 Backend 계약이 없습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '승인 요청 제출' })).not.toBeInTheDocument()
    expect(within(region).getByRole('link', { name: '승인 요청 ID로 열기' })).toHaveAttribute('href', '/app/approvals')
  })
})

describe('승인 요청 ID 진입 화면', () => {
  it('목록 API가 없음을 밝히고 UUID 형식의 ID로만 이동한다', async () => {
    stubFetch(requestRoutes())
    renderApp('/app/approvals')
    expect(await screen.findByText(/승인 대기 목록 API가 없어/)).toBeInTheDocument()
    expect(screen.queryByText(/합성 데모 데이터/)).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: /승인 요청 ID/ })
    fireEvent.change(input, { target: { value: 'not-a-uuid' } })
    fireEvent.click(screen.getByRole('button', { name: '승인 요청 열기' }))
    expect(screen.getByText('승인 요청 ID를 UUID 형식으로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/approvals$/)
    fireEvent.change(input, { target: { value: ` ${REQUEST_1.toUpperCase()} ` } })
    fireEvent.click(screen.getByRole('button', { name: '승인 요청 열기' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(requestRoute))
    expect(await screen.findByRole('region', { name: '승인 요청 개요' })).toBeInTheDocument()
  })

  it('다른 고객사나 공연의 요청은 서버 404를 그대로 숨김 안내로 표시하고 하위 조회를 하지 않는다', async () => {
    const calls = stubFetch({ [`GET ${requestPath}`]: () => problem(404, 'RESOURCE_NOT_FOUND') })
    renderApp(requestRoute)
    expect(await screen.findByText('승인 요청을 찾을 수 없거나 접근 범위 밖입니다')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '검토 패키지 조회' })).not.toBeInTheDocument()
    expect(calls.every((call) => call.url === requestPath)).toBe(true)
  })

  it('요청한 ID와 다른 응답은 표시하지 않는다', async () => {
    stubFetch({ [`GET ${requestPath}`]: () => json(200, requestView({ approvalRequestId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2' })) })
    renderApp(requestRoute)
    expect(await screen.findByText('서버 응답 형식이 계약과 다릅니다')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '승인 요청 개요' })).not.toBeInTheDocument()
  })

  it('INVALIDATED 요청은 무효화 상태를 표시하되 실시간 감지라고 주장하지 않고 검토와 철회를 열지 않는다', async () => {
    stubFetch({ [`GET ${requestPath}`]: () => json(200, requestView({ status: 'INVALIDATED', version: 1 })) })
    renderApp(requestRoute)
    const overview = await screen.findByRole('region', { name: '승인 요청 개요' })
    expect(within(overview).getByText('무효화됨 (INVALIDATED)')).toBeInTheDocument()
    expect(screen.getByText(/실시간으로 감지하지 않습니다/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/실시간으로 감지합니다|자동으로 모두 감지/)
    expect(screen.queryByRole('button', { name: '검토 패키지 조회' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '승인 요청 철회' })).not.toBeInTheDocument()
  })
})

describe('REVIEWER 승인 요청 철회', () => {
  it('최신 Case와 보고서 버전을 다시 조회해 철회하고 요청 상태를 재조회한다', async () => {
    const calls = stubFetch({
      [`GET ${requestPath}`]: (_call, count) => json(200, count === 1 ? requestView({ version: 2 }) : requestView({ status: 'WITHDRAWN', version: 3 })),
      [`GET ${casePath}`]: () => json(200, caseView({ status: 'READY_FOR_APPROVAL', caseVersion: 7, currentReportVersionId: REPORT_VERSION_1 })),
      [`GET /api/v1/report-versions/${REPORT_VERSION_1}`]: () => json(200, reportVersion({ version: 1, status: 'PENDING_APPROVAL' })),
      [`POST ${requestPath}/withdraw`]: () => json(200, withdrawView),
    })
    renderApp(requestRoute)
    const region = await screen.findByRole('region', { name: '승인 요청 철회' })
    fireEvent.change(within(region).getByRole('textbox', { name: /철회 사유/ }), { target: { value: '합성 철회 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '승인 요청 철회' }))
    expect(await screen.findByText(/승인 요청을 철회했습니다/)).toBeInTheDocument()
    const sent = posts(calls, `${requestPath}/withdraw`)
    expect(sent).toHaveLength(1)
    expect(sent[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(sent[0].body).toEqual({ reason: '합성 철회 사유', expectedCaseVersion: 7, expectedRequestVersion: 2, expectedReportVersion: 1 })
    expect(await within(await screen.findByRole('region', { name: '승인 요청 개요' })).findByText('철회됨 (WITHDRAWN)')).toBeInTheDocument()
  })

  it('철회 응답 유실은 같은 키와 같은 본문으로만 재확인한다', async () => {
    const calls = stubFetch({
      ...requestRoutes(),
      [`GET ${casePath}`]: () => json(200, caseView({ status: 'READY_FOR_APPROVAL', caseVersion: 7 })),
      [`GET /api/v1/report-versions/${REPORT_VERSION_1}`]: () => json(200, reportVersion({ version: 1, status: 'PENDING_APPROVAL' })),
      [`POST ${requestPath}/withdraw`]: (_call, count) => { if (count === 1) throw new TypeError('network'); return json(200, withdrawView) },
    })
    renderApp(requestRoute)
    const region = await screen.findByRole('region', { name: '승인 요청 철회' })
    fireEvent.change(within(region).getByRole('textbox', { name: /철회 사유/ }), { target: { value: '합성 철회 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '승인 요청 철회' }))
    fireEvent.click(await within(region).findByRole('button', { name: '철회 재확인' }))
    expect(await screen.findByText(/승인 요청을 철회했습니다/)).toBeInTheDocument()
    const sent = posts(calls, `${requestPath}/withdraw`)
    expect(sent).toHaveLength(2)
    expect(sent[1].headers['Idempotency-Key']).toBe(sent[0].headers['Idempotency-Key'])
    expect(sent[1].body).toEqual(sent[0].body)
    // 재확인은 처음 조회한 버전을 그대로 보내므로 Case와 보고서를 다시 조회하지 않는다.
    expect(gets(calls, casePath)).toHaveLength(1)
  })

  it('REVIEWER가 아니면 Case 조회 단계의 403을 권한 없음으로 안내하고 철회를 보내지 않는다', async () => {
    const calls = stubFetch({ ...requestRoutes(), [`GET ${casePath}`]: () => problem(403, 'FORBIDDEN') })
    renderApp(requestRoute)
    const region = await screen.findByRole('region', { name: '승인 요청 철회' })
    fireEvent.change(within(region).getByRole('textbox', { name: /철회 사유/ }), { target: { value: '합성 철회 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '승인 요청 철회' }))
    expect(await within(region).findByText('승인 요청 철회에 필요한 역할이 없습니다', { exact: false })).toBeInTheDocument()
    expect(posts(calls, `${requestPath}/withdraw`)).toHaveLength(0)
    expect(within(region).getByRole('button', { name: '승인 요청 철회' })).toBeDisabled()
  })
})

async function openPackage() {
  const region = await screen.findByRole('region', { name: '독립 검토와 결정' })
  fireEvent.click(within(region).getByRole('button', { name: '검토 패키지 조회' }))
  await within(region).findByRole('region', { name: '봉인된 보고서 본문' })
  return region
}

async function issueReceipt(region: HTMLElement) {
  fireEvent.click(within(region).getByRole('checkbox', { name: /봉인된 보고서 본문과 증거 manifest를 검토했습니다/ }))
  fireEvent.click(within(region).getByRole('button', { name: '검토 확인 영수증 발급' }))
  await within(region).findByText(RECEIPT_1)
}

function fillDecision(region: HTMLElement, outcome: 'APPROVE' | 'REJECT', reason = '합성 결정 사유') {
  fireEvent.click(within(region).getByRole('radio', { name: outcome === 'APPROVE' ? /승인 \(APPROVE\)/ : /반려 \(REJECT\)/ }))
  fireEvent.change(within(region).getByRole('textbox', { name: /결정 사유/ }), { target: { value: reason } })
}

describe('APPROVER 독립 검토와 영수증', () => {
  it('검토 패키지는 명시적 조회 뒤에만 불러오고 JSON을 텍스트로만 표시하며 HTML을 실행하지 않는다', async () => {
    const calls = stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage()) }))
    renderApp(requestRoute)
    const region = await screen.findByRole('region', { name: '독립 검토와 결정' })
    expect(gets(calls, packagePath)).toHaveLength(0)
    fireEvent.click(within(region).getByRole('button', { name: '검토 패키지 조회' }))
    const report = await within(region).findByRole('region', { name: '봉인된 보고서 본문' })
    expect(within(report).getByText('<img src=x onerror="window.__approvalXss=1">합성 보고서 제목')).toBeInTheDocument()
    expect(within(report).getByText('<script>window.__approvalXss=1</script>합성 평가 본문')).toBeInTheDocument()
    const manifest = within(region).getByRole('region', { name: '증거 manifest' })
    expect(within(manifest).getByText('<b onclick="window.__approvalXss=1">cluster-7</b>')).toBeInTheDocument()
    expect(region.querySelector('img, script, b[onclick]')).toBeNull()
    expect((window as { __approvalXss?: unknown }).__approvalXss).toBeUndefined()
    // 조회만으로 영수증을 발급하지 않고, 검토 확인 전에는 발급 버튼을 막는다.
    expect(posts(calls, packagePath)).toHaveLength(0)
    expect(within(region).getByRole('button', { name: '검토 확인 영수증 발급' })).toBeDisabled()
    expect(within(region).getByText(/공식 PDF 발급 불가/)).toBeInTheDocument()
  })

  it.each([
    ['manifest digest', { manifestSha256: SHA_B }],
    ['보고서 본문 근거', { reportContentJson: JSON.stringify({ ...JSON.parse(CONTENT_JSON), evidenceSnapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' }) }],
    ['파싱할 수 없는 manifest', { manifestJson: '{broken' }],
  ])('검토 패키지의 %s가 요청 고정 근거와 맞지 않으면 영수증 발급을 막는다', async (_label, overrides) => {
    stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage(overrides)) }))
    renderApp(requestRoute)
    const region = await screen.findByRole('region', { name: '독립 검토와 결정' })
    fireEvent.click(within(region).getByRole('button', { name: '검토 패키지 조회' }))
    expect(await within(region).findByText('검토 패키지를 신뢰할 수 없습니다')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '검토 확인 영수증 발급' })).not.toBeInTheDocument()
  })

  it('검토 패키지 403과 404를 구분해 안내하고 영수증 발급을 열지 않는다', async () => {
    stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => problem(403, 'FORBIDDEN') }))
    renderApp(requestRoute)
    const region = await screen.findByRole('region', { name: '독립 검토와 결정' })
    fireEvent.click(within(region).getByRole('button', { name: '검토 패키지 조회' }))
    expect(await within(region).findByText('이 화면에 필요한 역할이 없습니다')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '검토 확인 영수증 발급' })).not.toBeInTheDocument()
  })

  it('영수증 원문은 화면, 주소, 저장소, 콘솔에 남기지 않고 발급 ID와 만료 시각만 표시한다', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name))
    stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage()), [`POST ${packagePath}`]: () => json(201, receipt()) }))
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    expect(within(region).getByText(/영수증 발급됨/)).toBeInTheDocument()
    expectTokenNotLeaked(spies)
  })

  it('영수증 발급 응답 유실은 자동 재시도하지 않고 사용자가 명시적으로 새 영수증을 요청해야 한다', async () => {
    const calls = stubFetch(requestRoutes({
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: (_call, count) => { if (count === 1) throw new TypeError('network'); return json(201, receipt()) },
    }))
    renderApp(requestRoute)
    const region = await openPackage()
    fireEvent.click(within(region).getByRole('checkbox', { name: /봉인된 보고서 본문과 증거 manifest를 검토했습니다/ }))
    fireEvent.click(within(region).getByRole('button', { name: '검토 확인 영수증 발급' }))
    fireEvent.click(within(region).getByRole('button', { name: /영수증 발급/ }))
    expect(await within(region).findByText(/영수증이 발급되었을 수 있습니다/)).toBeInTheDocument()
    await new Promise((done) => setTimeout(done, 30))
    expect(posts(calls, packagePath)).toHaveLength(1)
    expect(calls.find((call) => call.method === 'POST')?.headers['Idempotency-Key']).toBeUndefined()
    expect(within(region).queryByRole('button', { name: '결정 제출' })).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '새 영수증 발급' }))
    await within(region).findByText(RECEIPT_1)
    expect(posts(calls, packagePath)).toHaveLength(2)
  })

  it.each([
    [422, 'APPROVAL_BASIS_BLOCKED', '증거 보존 근거가 승인 조건을 충족하지 않습니다'],
    [409, 'APPROVAL_REQUESTER_ACCESS_REVOKED', '요청자의 검토 권한이 철회되었습니다'],
    [409, 'APPROVAL_REQUEST_CLOSED', '이미 종료된 승인 요청입니다'],
    [409, 'ISSUANCE_HOLD_ACTIVE', '발급 보류가 걸려 있습니다'],
  ])('영수증 발급 %s %s를 안내하고 요청 상태를 다시 조회한다', async (status, code, title) => {
    const calls = stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage()), [`POST ${packagePath}`]: () => problem(status, code) }))
    renderApp(requestRoute)
    const region = await openPackage()
    fireEvent.click(within(region).getByRole('checkbox', { name: /봉인된 보고서 본문과 증거 manifest를 검토했습니다/ }))
    fireEvent.click(within(region).getByRole('button', { name: '검토 확인 영수증 발급' }))
    expect(await within(region).findByText(title, { exact: false })).toBeInTheDocument()
    await waitFor(() => expect(gets(calls, requestPath).length).toBeGreaterThanOrEqual(2))
    expect(posts(calls, packagePath)).toHaveLength(1)
  })
})

describe('APPROVER 승인과 반려 결정', () => {
  it.each(['APPROVE', 'REJECT'] as const)('%s 결정을 실제 계약대로 보내고 결과와 최신 요청 상태를 표시한다', async (outcome) => {
    const decided = outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    const calls = stubFetch({
      [`GET ${requestPath}`]: (_call, count) => json(200, count === 1 ? requestView() : requestView({ status: decided, version: 1 })),
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: () => json(201, receipt()),
      [`POST ${requestPath}/decision`]: () => json(201, decisionView(outcome)),
    })
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    fillDecision(region, outcome)
    fireEvent.click(within(region).getByRole('button', { name: '결정 제출' }))
    fireEvent.click(within(region).getByRole('button', { name: /결정/ }))
    const result = await screen.findByRole('region', { name: '결정 결과' })
    const sent = posts(calls, `${requestPath}/decision`)
    expect(sent).toHaveLength(1)
    expect(sent[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(sent[0].body).toEqual({
      outcome, reason: '합성 결정 사유', evidenceSnapshotId: SNAPSHOT_1, manifestSha256: SHA_A, reportContentSha256: SHA_C, reviewReceiptToken: RECEIPT_TOKEN,
      reviewConfirmed: true, expectedCaseVersion: 7, expectedRequestVersion: 0, expectedReportVersion: 1,
    })
    expect(within(result).getByText(`${outcome === 'APPROVE' ? '승인됨' : '반려됨'} (${decided})`)).toBeInTheDocument()
    expect(within(result).getByText('차단 (BLOCKED)')).toBeInTheDocument()
    expect(within(result).getByText(/공식 PDF 발급이 아닙니다/)).toBeInTheDocument()
    expect(within(await screen.findByRole('region', { name: '승인 요청 개요' })).getByText(new RegExp(`\\(${decided}\\)`))).toBeInTheDocument()
    // 사용한 영수증은 버리고 같은 화면에서 두 번째 결정을 보낼 수 없다.
    expect(screen.queryByRole('button', { name: '결정 제출' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/부정 거래 확정|불법 거래 확정|자동 제재/)
    expectTokenNotLeaked()
  })

  it.each([
    [403, 'SELF_APPROVAL_FORBIDDEN', '자기 승인은 허용되지 않습니다'],
    [403, 'FORBIDDEN', '승인 결정에 필요한 역할이 없습니다'],
    [422, 'REVIEW_RECEIPT_EXPIRED', '검토 확인 영수증이 만료되었습니다'],
    [409, 'REVIEW_RECEIPT_ALREADY_USED', '이미 사용한 검토 확인 영수증입니다'],
    [422, 'REVIEW_RECEIPT_INVALID', '검토 확인 영수증을 사용할 수 없습니다'],
    [409, 'APPROVAL_REVIEW_MISMATCH', '검토한 근거가 요청의 고정 근거와 다릅니다'],
    [409, 'EVIDENCE_VERSION_MISMATCH', '증거 개정 번호가 요청 시점과 다릅니다'],
    [409, 'REQUEST_VERSION_CONFLICT', '승인 요청이 먼저 변경되었습니다'],
    [409, 'IDEMPOTENCY_KEY_REUSED', '같은 요청 키가 다른 내용으로 사용되었습니다'],
  ])('결정 %s %s를 안내하고 영수증을 버린 뒤 요청 상태를 다시 조회한다', async (status, code, title) => {
    const calls = stubFetch(requestRoutes({
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: () => json(201, receipt()),
      [`POST ${requestPath}/decision`]: () => problem(status, code),
    }))
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    fillDecision(region, 'APPROVE')
    fireEvent.click(within(region).getByRole('button', { name: '결정 제출' }))
    expect(await within(region).findByText(title, { exact: false })).toBeInTheDocument()
    await waitFor(() => expect(gets(calls, requestPath).length).toBeGreaterThanOrEqual(2))
    expect(within(region).queryByRole('button', { name: '결정 제출' })).not.toBeInTheDocument()
    expect(within(region).queryByText(RECEIPT_1)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('내부 정보')
    expectTokenNotLeaked()
  })
})

describe('영수증 만료와 결정 결과 미확인', () => {
  it('결정을 보내기 전에 영수증이 만료되면 원문을 버리고 새 영수증 발급을 안내한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const calls = stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage()), [`POST ${packagePath}`]: () => json(201, receipt()) }))
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    act(() => { vi.advanceTimersByTime(15 * 60_000) })
    expect(await within(region).findByText(/검토 확인 영수증이 만료되어 폐기했습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '결정 제출' })).not.toBeInTheDocument()
    expect(posts(calls, `${requestPath}/decision`)).toHaveLength(0)
    fireEvent.click(within(region).getByRole('button', { name: '새 영수증 발급' }))
    await within(region).findByRole('button', { name: '결정 제출' })
    expect(posts(calls, packagePath)).toHaveLength(2)
  })

  it('영수증 발급 응답이 늦게 오면 요청 시작부터 지난 시간을 유효기간에서 빼고 남은 시간이 없으면 바로 폐기한다', async () => {
    // 단조 시계만 앞당기고 타이머는 실제로 둔다. 브라우저 절대 시계(Date)는 쓰지 않는다.
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const late = deferred()
    const calls = stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage()), [`POST ${packagePath}`]: () => late.promise }))
    renderApp(requestRoute)
    const region = await openPackage()
    fireEvent.click(within(region).getByRole('checkbox', { name: /봉인된 보고서 본문과 증거 manifest를 검토했습니다/ }))
    fireEvent.click(within(region).getByRole('button', { name: '검토 확인 영수증 발급' }))
    // 15분 영수증의 응답이 14분 56초 뒤 도착하면 5초 여유를 빼고 남은 시간이 없다.
    now += 14 * 60_000 + 56_000
    await act(async () => { late.resolve(json(201, receipt())) })
    expect(await within(region).findByText(/검토 확인 영수증이 만료되어 폐기했습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '결정 제출' })).not.toBeInTheDocument()
    expect(posts(calls, `${requestPath}/decision`)).toHaveLength(0)
    expect(posts(calls, packagePath)).toHaveLength(1)
    expectTokenNotLeaked()
  })

  it('타이머가 늦게 실행되어도 결정 본문을 만들 때 만료를 확인하고 지연 응답 시간만큼 일찍 폐기한다', async () => {
    let now = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const late = deferred()
    const calls = stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage()), [`POST ${packagePath}`]: () => late.promise }))
    renderApp(requestRoute)
    const region = await openPackage()
    fireEvent.click(within(region).getByRole('checkbox', { name: /봉인된 보고서 본문과 증거 manifest를 검토했습니다/ }))
    fireEvent.click(within(region).getByRole('button', { name: '검토 확인 영수증 발급' }))
    // 응답이 10분 늦게 오면 남은 시간은 4분 55초다. 실제 타이머는 그 사이 실행되지 않는다.
    now += 10 * 60_000
    await act(async () => { late.resolve(json(201, receipt())) })
    await within(region).findByText(RECEIPT_1)
    now += 4 * 60_000 + 56_000
    fillDecision(region, 'APPROVE')
    fireEvent.click(within(region).getByRole('button', { name: '결정 제출' }))
    expect(await within(region).findByText(/검토 확인 영수증이 만료되어 폐기했습니다/)).toBeInTheDocument()
    expect(posts(calls, `${requestPath}/decision`)).toHaveLength(0)
    expect(within(region).queryByRole('button', { name: '결정 제출' })).not.toBeInTheDocument()
    expect(posts(calls, packagePath)).toHaveLength(1)
    expectTokenNotLeaked()
  })

  it('만료 직전 보낸 결정의 응답이 유실되면 만료 뒤에도 같은 키와 본문으로 재확인하고 새 영수증과 새 결정을 막는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const first = deferred()
    const calls = stubFetch({
      [`GET ${requestPath}`]: (_call, count) => json(200, count <= 1 ? requestView() : requestView({ status: 'APPROVED', version: 1 })),
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: () => json(201, receipt()),
      [`POST ${requestPath}/decision`]: (_call, count) => (count === 1 ? first.promise : json(201, decisionView('APPROVE'))),
    })
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    act(() => { vi.advanceTimersByTime(14 * 60_000 + 40_000) })
    fillDecision(region, 'APPROVE')
    fireEvent.click(within(region).getByRole('button', { name: '결정 제출' }))
    // 전송 중에 영수증 만료 시각이 지나도 보낸 본문은 버리지 않는다.
    act(() => { vi.advanceTimersByTime(60_000) })
    await act(async () => { first.reject(new TypeError('network')) })
    expect(await within(region).findByText(/결과 미확인/)).toBeInTheDocument()
    expect(within(region).queryByText(/검토 확인 영수증이 만료되어 폐기했습니다/)).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '새 영수증 발급' })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '검토 확인 영수증 발급' })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '결정 제출' })).not.toBeInTheDocument()
    // 결과를 실패나 미처리로 확정하지 않는다.
    expect(within(region).queryByText(/결정이 처리되지 않았습니다|결정 실패/)).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '결정 재확인' }))
    expect(await screen.findByRole('region', { name: '결정 결과' })).toBeInTheDocument()
    const sent = posts(calls, `${requestPath}/decision`)
    expect(sent).toHaveLength(2)
    expect(sent[1].headers['Idempotency-Key']).toBe(sent[0].headers['Idempotency-Key'])
    expect(sent[1].body).toEqual(sent[0].body)
    expect(posts(calls, packagePath)).toHaveLength(1)
    expectTokenNotLeaked()
  })

  it('재확인이 영수증 만료로 확정 거부되면 그때 새 검토를 안내한다', async () => {
    stubFetch(requestRoutes({
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: () => json(201, receipt()),
      [`POST ${requestPath}/decision`]: (_call, count) => { if (count === 1) throw new TypeError('network'); return problem(422, 'REVIEW_RECEIPT_EXPIRED') },
    }))
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    fillDecision(region, 'REJECT')
    fireEvent.click(within(region).getByRole('button', { name: '결정 제출' }))
    fireEvent.click(await within(region).findByRole('button', { name: '결정 재확인' }))
    expect(await within(region).findByText('검토 확인 영수증이 만료되었습니다', { exact: false })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: '검토 확인 영수증 발급' })).toBeInTheDocument()
  })

  it('결과 미확인 상태로 화면을 떠났다 돌아오면 원문 없이 불확실성을 안내하고 서버 상태를 확인한다', async () => {
    const calls = stubFetch({
      [`GET ${requestPath}`]: () => json(200, requestView()),
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: () => json(201, receipt()),
      [`POST ${requestPath}/decision`]: () => { throw new TypeError('network') },
      ...caseRoutes(),
    })
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    fillDecision(region, 'APPROVE')
    fireEvent.click(within(region).getByRole('button', { name: '결정 제출' }))
    await within(region).findByRole('button', { name: '결정 재확인' })
    act(() => navigateTo(caseRoute))
    await screen.findByRole('region', { name: 'Case 개요' })
    expectTokenNotLeaked()
    const before = gets(calls, requestPath).length
    act(() => navigateTo(requestRoute))
    const notice = await screen.findByRole('alert', { name: '이전 결정 결과 미확인' })
    expect(notice).toHaveTextContent(/결과를 확인하지 못한 채 화면을 떠났습니다/)
    await waitFor(() => expect(gets(calls, requestPath).length).toBeGreaterThan(before))
    expect(notice).toHaveTextContent(/서버 기준 아직 승인 대기/)
    const review = screen.getByRole('region', { name: '독립 검토와 결정' })
    // 새 검토는 사용자가 서버 상태를 확인했다고 명시한 뒤에만 연다.
    expect(within(review).queryByRole('button', { name: '검토 패키지 조회' })).not.toBeInTheDocument()
    fireEvent.click(within(notice).getByRole('button', { name: '서버 상태를 확인했고 새 검토를 진행합니다' }))
    expect(within(review).getByRole('button', { name: '검토 패키지 조회' })).toBeInTheDocument()
    expect(posts(calls, `${requestPath}/decision`)).toHaveLength(1)
  })

  it('재진입 시 서버가 이미 결정을 기록했으면 불확실성 안내를 해소한다', async () => {
    stubFetch({
      [`GET ${requestPath}`]: (_call, count) => json(200, count <= 1 ? requestView() : requestView({ status: 'REJECTED', version: 1 })),
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: () => json(201, receipt()),
      [`POST ${requestPath}/decision`]: () => { throw new TypeError('network') },
      ...caseRoutes(),
    })
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    fillDecision(region, 'REJECT')
    fireEvent.click(within(region).getByRole('button', { name: '결정 제출' }))
    await within(region).findByRole('button', { name: '결정 재확인' })
    act(() => navigateTo(caseRoute))
    await screen.findByRole('region', { name: 'Case 개요' })
    act(() => navigateTo(requestRoute))
    expect(await screen.findByText(/서버에 결정 상태가 기록되어 있습니다/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '승인 요청 개요' })).getByText('반려됨 (REJECTED)')).toBeInTheDocument()
  })

  it('로그아웃하면 검토 화면과 영수증 정보를 모두 폐기한다', async () => {
    stubFetch(requestRoutes({ [`GET ${packagePath}`]: () => json(200, reviewPackage()), [`POST ${packagePath}`]: () => json(201, receipt()) }))
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(screen.queryByText(RECEIPT_1)).not.toBeInTheDocument()
    expect(screen.queryByText('합성 결론')).not.toBeInTheDocument()
    expectTokenNotLeaked()
  })

  it('결정 버튼을 연속으로 눌러도 한 번만 보낸다', async () => {
    const pending = deferred()
    const calls = stubFetch(requestRoutes({
      [`GET ${packagePath}`]: () => json(200, reviewPackage()),
      [`POST ${packagePath}`]: () => json(201, receipt()),
      [`POST ${requestPath}/decision`]: () => pending.promise,
    }))
    renderApp(requestRoute)
    const region = await openPackage()
    await issueReceipt(region)
    fillDecision(region, 'APPROVE')
    const button = within(region).getByRole('button', { name: '결정 제출' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(posts(calls, `${requestPath}/decision`)).toHaveLength(1))
    await act(async () => { pending.resolve(json(201, decisionView('APPROVE'))) })
    expect(await screen.findByRole('region', { name: '결정 결과' })).toBeInTheDocument()
    expect(posts(calls, `${requestPath}/decision`)).toHaveLength(1)
  })
})
