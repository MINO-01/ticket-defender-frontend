import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import type { CaseView } from '../features/admin-cases/caseApi'
import {
  buildAssignRequest, buildCaptureRequest, buildCreateCaseRequest, buildDraftRequest, buildTransitionRequest, caseAssigneePath, caseCreatePath, caseTransitionPath,
  classifyMutation, createCaseMessages, reportTextError, reportVersionCreatePath, reportVersionListPath, reportVersionSchema, snapshotCreatePath, snapshotDetailPath,
  snapshotListPath, snapshotSchema, transitionMessages, transitionOptions,
} from '../features/admin-cases/caseWorkflowApi'
import type { CreateCaseInput, EvidenceSnapshot, TransitionInput } from '../features/admin-cases/caseWorkflowApi'

// Issue #31 관리자 Case 생성과 조사 준비 쓰기 계약을 Mock 인증 어댑터와 fetch로 검증한다.
// 요청과 응답 형식은 Backend main 17c832b의 CaseController, CasePreparationController, CaseDto, CasePreparationDto를 따른다.
// 실제 Keycloak, Spring, MySQL 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const EVENT_B = '44444444-4444-4444-8444-444444444444'
const CASE_1 = '11111111-1111-4111-8111-111111111111'
const MEMBER_CREATOR = '22222222-2222-4222-8222-222222222221'
const MEMBER_ASSIGNEE = '22222222-2222-4222-8222-222222222222'
const MEMBER_OTHER = '22222222-2222-4222-8222-222222222223'
const REPORT_1 = '55555555-5555-4555-8555-555555555551'
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661'
const EVIDENCE_2 = '66666666-6666-4666-8666-666666666662'
const ANALYSIS_1 = '99999999-9999-4999-8999-999999999991'
const SNAPSHOT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const REPORT_VERSION_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'
const MANIFEST_SECRET = '{"sources":[{"objectKey":"fan-reports/synthetic-raw-object"}]}'
const CONTENT_SECRET = '{"assessment":"합성 보고서 원문 JSON"}'

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

// 계약에 없는 detail에 내부 정보가 섞여 와도 화면에 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ title: 'Problem', status, code, detail: '내부 고객사 정보 SQLSTATE' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | null | undefined }
type Handler = (call: Call, count: number) => Response | Promise<Response> | undefined

/** "METHOD 경로" 키로 응답을 고른다. 같은 키의 호출 횟수를 함께 넘겨 재조회 응답을 바꿀 수 있게 한다. */
function stubFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, signal: init?.signal,
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

const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET')
const gets = (calls: Call[], url: string) => calls.filter((call) => call.method === 'GET' && call.url === url)

function caseView(overrides: Partial<CaseView> = {}): CaseView {
  return {
    caseId: CASE_1, eventId: EVENT_A, type: 'GRAPH_CLUSTER', status: 'OPEN', caseVersion: 0, evidenceRevision: 1,
    createdByMembershipId: MEMBER_CREATOR, assigneeMembershipId: null, relatedCaseId: null, relationReason: null,
    classification: null, currentReportVersionId: null, createdAt: '2026-11-01T09:30:00Z', updatedAt: '2026-11-01T09:30:00Z', ...overrides,
  }
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    evidenceSnapshotId: SNAPSHOT_1, caseId: CASE_1, eventId: EVENT_A, evidenceRevision: 1, caseVersionAtCapture: 4, manifestSchemaVersion: 1,
    manifestSha256: SHA_A, manifestJson: MANIFEST_SECRET, sourceIntegrity: 'METADATA_ONLY', approvalEligible: false,
    createdByMembershipId: MEMBER_ASSIGNEE, capturedAt: '2026-11-02T10:00:00Z', ...overrides,
  }
}

function reportVersion(overrides: Record<string, unknown> = {}) {
  return {
    reportVersionId: REPORT_VERSION_1, caseId: CASE_1, eventId: EVENT_A, evidenceSnapshotId: SNAPSHOT_1, evidenceRevision: 1, revision: 1, version: 0,
    templateVersion: 'case-approval-input-v1', templateSha256: SHA_B, contentSha256: SHA_C, contentJson: CONTENT_SECRET, status: 'DRAFT',
    renderable: false, approvalEligible: false, createdByMembershipId: MEMBER_ASSIGNEE, createdAt: '2026-11-02T11:00:00Z', ...overrides,
  }
}

const page = (items: unknown[] = []) => ({ items, page: 0, pageSize: 20, hasNext: false })
const typed = (value: Record<string, unknown>) => snapshotSchema.parse(value) as EvidenceSnapshot

const casePath = `/api/v1/cases/${CASE_1}`
const sourcesPath = `${casePath}/sources`
const activitiesPath = `${casePath}/activities?page=0&pageSize=20`
const snapshotsPath = `${casePath}/evidence-snapshots?page=0&pageSize=20`
const draftsPath = `${casePath}/report-versions?page=0&pageSize=20`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Case 쓰기 계약 경로와 스키마', () => {
  it('Backend 컨트롤러 경로를 그대로 만든다', () => {
    expect(caseCreatePath).toBe('/api/v1/cases')
    expect(caseTransitionPath(CASE_1)).toBe(`${casePath}/transitions`)
    expect(caseAssigneePath(CASE_1)).toBe(`${casePath}/assignee`)
    expect(snapshotCreatePath(CASE_1)).toBe(`${casePath}/evidence-snapshots`)
    expect(snapshotListPath(CASE_1, 2)).toBe(`${casePath}/evidence-snapshots?page=2&pageSize=20`)
    expect(snapshotDetailPath(CASE_1, SNAPSHOT_1)).toBe(`${casePath}/evidence-snapshots/${SNAPSHOT_1}`)
    expect(reportVersionCreatePath(CASE_1)).toBe(`${casePath}/report-versions`)
    expect(reportVersionListPath(CASE_1, 0)).toBe(draftsPath)
  })

  it('Snapshot과 초안 응답은 원문 JSON을 확인 후 제거하고 계약 밖 값은 거부한다', () => {
    const parsed = snapshotSchema.parse(snapshot())
    expect(parsed).not.toHaveProperty('manifestJson')
    expect(parsed.manifestSha256).toBe(SHA_A)
    expect(snapshotSchema.safeParse(snapshot({ manifestJson: undefined })).success).toBe(false)
    expect(snapshotSchema.safeParse(snapshot({ sourceIntegrity: 'VERIFIED' })).success).toBe(false)
    expect(snapshotSchema.safeParse(snapshot({ manifestSha256: 'A'.repeat(64) })).success).toBe(false)
    const draft = reportVersionSchema.parse(reportVersion())
    expect(draft).not.toHaveProperty('contentJson')
    expect(reportVersionSchema.safeParse(reportVersion({ status: 'FINAL' })).success).toBe(false)
    expect(reportVersionSchema.safeParse(reportVersion({ revision: 0 })).success).toBe(false)
  })

  it('출처 구성으로 GRAPH_CLUSTER, FAN_REPORT, COMBINED 유형을 정하고 서버 사전 규칙을 위반하면 요청을 만들지 않는다', () => {
    const cluster = { analysisRequestId: ANALYSIS_1, clusterId: 'cluster-1' }
    const base: CreateCaseInput = { eventId: EVENT_A, graphClusters: [], fanReportIds: [], evidenceIds: [], reason: ' 합성 생성 사유 ' }
    const graph = buildCreateCaseRequest({ ...base, graphClusters: [cluster] })
    expect(graph).toEqual({ ok: true, body: { eventId: EVENT_A, type: 'GRAPH_CLUSTER', graphClusters: [cluster], fanReportIds: [], evidenceIds: [], reason: '합성 생성 사유', relatedCaseId: null, relationReason: null } })
    expect(buildCreateCaseRequest({ ...base, fanReportIds: [REPORT_1], evidenceIds: [EVIDENCE_1] })).toMatchObject({ ok: true, body: { type: 'FAN_REPORT' } })
    expect(buildCreateCaseRequest({ ...base, graphClusters: [cluster], fanReportIds: [REPORT_1] })).toMatchObject({ ok: true, body: { type: 'COMBINED' } })
    const rejected = (input: Partial<CreateCaseInput>) => buildCreateCaseRequest({ ...base, ...input })
    expect(rejected({})).toMatchObject({ ok: false, errors: { sources: '연결할 출처가 없습니다.' } })
    expect(rejected({ graphClusters: [cluster], evidenceIds: [EVIDENCE_1] })).toMatchObject({ ok: false, errors: { sources: expect.stringContaining('소속 제보와 함께') } })
    expect(rejected({ graphClusters: [{ analysisRequestId: 'run/1', clusterId: 'c' }] })).toMatchObject({ ok: false, errors: { sources: expect.stringContaining('소문자 UUID') } })
    expect(rejected({ graphClusters: [{ analysisRequestId: SNAPSHOT_1.toUpperCase(), clusterId: 'c' }] })).toMatchObject({ ok: false, errors: { sources: expect.stringContaining('소문자 UUID') } })
    expect(rejected({ graphClusters: [cluster, { ...cluster }] })).toMatchObject({ ok: false, errors: { sources: '같은 출처가 중복되었습니다.' } })
    expect(rejected({ fanReportIds: [REPORT_1], evidenceIds: Array.from({ length: 30 }, (_, index) => `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`) })).toMatchObject({ ok: false, errors: { sources: expect.stringContaining('최대 30개') } })
    expect(rejected({ fanReportIds: [REPORT_1], reason: '  가 ' })).toMatchObject({ ok: false, errors: { reason: expect.stringContaining('3자 이상') } })
    expect(rejected({ fanReportIds: [REPORT_1], reason: '가'.repeat(2001) })).toMatchObject({ ok: false, errors: { reason: expect.stringContaining('2000자') } })
    expect(rejected({ eventId: 'not-uuid', fanReportIds: [REPORT_1] })).toMatchObject({ ok: false })
  })

  it('서버 상태 전이 규칙의 조합만 허용하고 필요한 추가 필드와 expectedCaseVersion을 보낸다', () => {
    expect(transitionOptions('OPEN').map((item) => item.to)).toEqual(['TRIAGED'])
    expect(transitionOptions('IN_REVIEW').map((item) => item.to)).toEqual(['NEEDS_EVIDENCE', 'DISMISSED'])
    for (const status of ['READY_FOR_APPROVAL', 'APPROVED_FOR_REPORT', 'DISMISSED', 'CLOSED'] as const) expect(transitionOptions(status)).toEqual([])
    const empty: TransitionInput = { to: 'TRIAGED', reason: '', classification: '', unassignedReason: '', missingEvidence: '', requestedAction: '', unavailableReason: '', dismissalBasis: '' }
    expect(buildTransitionRequest(caseView(), empty)).toMatchObject({ ok: false, errors: { reason: expect.any(String), classification: expect.any(String), unassignedReason: expect.any(String) } })
    expect(buildTransitionRequest(caseView({ caseVersion: 7 }), { ...empty, reason: '합성 분류 사유', classification: '합성 분류', unassignedReason: '담당자 미정' })).toEqual({ ok: true, body: {
      toStatus: 'TRIAGED', expectedCaseVersion: 7, reason: '합성 분류 사유', classification: '합성 분류', unassignedReason: '담당자 미정',
      missingEvidence: null, requestedAction: null, unavailableReason: null, dismissalBasis: null,
    } })
    // 담당자가 있으면 미지정 사유를 보내지 않는다.
    expect(buildTransitionRequest(caseView({ assigneeMembershipId: MEMBER_ASSIGNEE }), { ...empty, reason: '합성 사유', classification: '합성 분류' })).toMatchObject({ ok: true, body: { unassignedReason: null } })
    expect(buildTransitionRequest(caseView({ status: 'TRIAGED' }), { ...empty, to: 'IN_REVIEW', reason: '합성 사유' })).toMatchObject({ ok: false, errors: { to: '담당자를 먼저 지정해야 합니다.' } })
    expect(buildTransitionRequest(caseView({ status: 'OPEN' }), { ...empty, to: 'IN_REVIEW', reason: '합성 사유' })).toMatchObject({ ok: false, errors: { to: expect.stringContaining('허용하지 않는') } })
    const review = caseView({ status: 'IN_REVIEW', assigneeMembershipId: MEMBER_ASSIGNEE, caseVersion: 3 })
    expect(buildTransitionRequest(review, { ...empty, to: 'DISMISSED', reason: '짧은 사유', dismissalBasis: '' })).toMatchObject({ ok: false, errors: { dismissalBasis: expect.any(String), reason: expect.stringContaining('10자') } })
    expect(buildTransitionRequest(review, { ...empty, to: 'DISMISSED', reason: '합성 종결 사유를 충분히 입력', dismissalBasis: 'NO_VIOLATION_FOUND_AFTER_REVIEW' })).toMatchObject({ ok: true, body: { toStatus: 'DISMISSED', dismissalBasis: 'NO_VIOLATION_FOUND_AFTER_REVIEW', expectedCaseVersion: 3 } })
    expect(buildTransitionRequest(review, { ...empty, to: 'NEEDS_EVIDENCE', reason: '합성 사유', missingEvidence: '가'.repeat(500), requestedAction: '나'.repeat(500) })).toMatchObject({ ok: true })
    expect(buildTransitionRequest(review, { ...empty, to: 'NEEDS_EVIDENCE', reason: '다'.repeat(1500), missingEvidence: '가'.repeat(400), requestedAction: '나'.repeat(400) })).toMatchObject({ ok: false, errors: { combined: expect.any(String) } })
    expect(buildTransitionRequest(caseView({ status: 'NEEDS_EVIDENCE', assigneeMembershipId: MEMBER_ASSIGNEE }), { ...empty, to: 'IN_REVIEW', reason: '합성 사유' })).toMatchObject({ ok: false, errors: { unavailableReason: expect.any(String) } })
  })

  it('담당자, Snapshot, 초안 입력을 서버 길이 규칙과 현재 caseVersion으로 만든다', () => {
    const view = caseView({ status: 'IN_REVIEW', assigneeMembershipId: MEMBER_ASSIGNEE, caseVersion: 5 })
    expect(buildAssignRequest(view, { assigneeMembershipId: MEMBER_ASSIGNEE, reason: '합성 사유' })).toMatchObject({ ok: false, errors: { assigneeMembershipId: expect.stringContaining('현재 담당자') } })
    expect(buildAssignRequest(view, { assigneeMembershipId: '데모 담당자', reason: '합성 사유' })).toMatchObject({ ok: false })
    expect(buildAssignRequest(view, { assigneeMembershipId: ` ${MEMBER_OTHER.toUpperCase()} `, reason: '합성 사유' })).toEqual({ ok: true, body: { assigneeMembershipId: MEMBER_OTHER, expectedCaseVersion: 5, reason: '합성 사유' } })
    expect(buildCaptureRequest(caseView({ status: 'TRIAGED' }), { reason: '합성 사유' })).toMatchObject({ ok: false, errors: { state: expect.any(String) } })
    expect(buildCaptureRequest(view, { reason: '합성 사유' })).toEqual({ ok: true, body: { expectedCaseVersion: 5, reason: '합성 사유' } })
    const draftInput = { evidenceSnapshotId: SNAPSHOT_1, title: '합성 제목', assessment: '합성 평가 내용입니다.', limitations: '합성 한계', conclusion: '합성 결론', reason: '합성 사유' }
    expect(buildDraftRequest(view, [typed(snapshot())], draftInput)).toEqual({ ok: true, body: { expectedCaseVersion: 5, ...draftInput } })
    expect(buildDraftRequest(view, [typed(snapshot({ evidenceRevision: 0 }))], draftInput)).toMatchObject({ ok: false, errors: { evidenceSnapshotId: expect.stringContaining('현재 증거 개정') } })
    expect(buildDraftRequest(view, [typed(snapshot())], { ...draftInput, assessment: '짧음' })).toMatchObject({ ok: false, errors: { assessment: expect.stringContaining('10자') } })
    expect(reportTextError('합성\u0001제목', 3, 160)).toContain('제어 문자')
    expect(reportTextError('합성\uD800제목', 3, 160)).toContain('제어 문자')
    expect(reportTextError('합성 😀 제목\n줄바꿈', 3, 160)).toBeNull()
  })

  it('쓰기 결과를 충돌, 권한, 확정 거부, 결과 미확인으로 구분하고 보존 실패와 원본 무결성 실패를 다른 문구로 안내한다', () => {
    const verify = () => true
    expect(classifyMutation({ kind: 'problem', status: 409, code: 'CASE_VERSION_CONFLICT' }, transitionMessages, verify).kind).toBe('conflict')
    expect(classifyMutation({ kind: 'forbidden' }, transitionMessages, verify)).toMatchObject({ kind: 'rejected', forbidden: true })
    expect(classifyMutation({ kind: 'network' }, transitionMessages, verify).kind).toBe('uncertain')
    expect(classifyMutation({ kind: 'invalidResponse', status: 201 }, transitionMessages, verify).kind).toBe('uncertain')
    expect(classifyMutation({ kind: 'problem', status: 503, code: 'DEPENDENCY_UNAVAILABLE' }, transitionMessages, verify).kind).toBe('uncertain')
    expect(classifyMutation({ kind: 'problem', status: 500, code: 'UNKNOWN' }, transitionMessages, verify).kind).toBe('uncertain')
    expect(classifyMutation({ kind: 'success', status: 200, data: 1 }, transitionMessages, () => false).kind).toBe('uncertain')
    const retention = classifyMutation({ kind: 'problem', status: 422, code: 'SOURCE_NOT_AVAILABLE' }, createCaseMessages, verify)
    const integrity = classifyMutation({ kind: 'problem', status: 422, code: 'SOURCE_OBJECT_MISMATCH' }, createCaseMessages, verify)
    expect(retention).toMatchObject({ kind: 'rejected', message: { title: expect.stringContaining('보존 기한') } })
    expect(integrity).toMatchObject({ kind: 'rejected', message: { title: expect.stringContaining('원본 상태') } })
  })

  it('uncertainCodes에 지정한 409 코드만 결과 미확인으로 분류하고 나머지 확정 충돌과 기존 분류는 바꾸지 않는다', () => {
    const verify = () => true
    const pending = { title: '합성 진행 중 안내', description: '같은 키로 재확인합니다.' }
    const messages = { ...transitionMessages, codes: { ...transitionMessages.codes, SYNTHETIC_REJECTED: { title: '합성 거부', description: '거부' } }, uncertainCodes: { SYNTHETIC_PENDING: pending } }
    expect(classifyMutation({ kind: 'problem', status: 409, code: 'SYNTHETIC_PENDING' }, messages, verify)).toEqual({ kind: 'uncertain', message: pending })
    expect(classifyMutation({ kind: 'problem', status: 409, code: 'SYNTHETIC_REJECTED' }, messages, verify).kind).toBe('rejected')
    expect(classifyMutation({ kind: 'problem', status: 409, code: 'IDEMPOTENCY_KEY_REUSED' }, messages, verify).kind).toBe('rejected')
    expect(classifyMutation({ kind: 'problem', status: 409, code: 'CASE_VERSION_CONFLICT' }, messages, verify).kind).toBe('conflict')
    // 409가 아닌 상태의 같은 코드는 uncertainCodes를 적용하지 않는다.
    expect(classifyMutation({ kind: 'problem', status: 422, code: 'SYNTHETIC_PENDING' }, messages, verify)).toMatchObject({ kind: 'uncertain', message: { title: '서버가 결과를 확정하지 않은 오류를 반환했습니다' } })
    // uncertainCodes가 없는 기존 메시지는 이전과 같이 분류한다.
    expect(classifyMutation({ kind: 'problem', status: 409, code: 'IDEMPOTENCY_KEY_REUSED' }, transitionMessages, verify).kind).toBe('rejected')
  })
})

describe('Track 1 군집에서 Case 생성', () => {
  const clusterRoute = `/app/analysis/findings/detail?eventId=${EVENT_A}&analysisRequestId=${ANALYSIS_1}&clusterId=cluster-1`
  const clusterApi = `/api/v1/admin/track1/clusters/detail?eventId=${EVENT_A}&analysisRequestId=${ANALYSIS_1}&clusterId=cluster-1`
  const eventPage = { items: [{ id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }, { id: EVENT_B, externalEventId: 'synthetic-b', name: '합성 공연 B' }], page: 0, pageSize: 100, totalItems: 2, hasNext: false }
  const clusterBody = (analysisRequestId = ANALYSIS_1) => ({
    event: eventPage.items[0],
    cluster: { analysisRequestId, clusterId: 'cluster-1', riskScore: 0.82, analysisAlgorithm: 'LOUVAIN', analysisAlgorithmVersion: '1.0.0', analyzedAt: '2026-10-08T10:15:30Z', storedMemberCount: 2 },
    members: [{ auditId: 123, accountId: 'account-1', reservationNo: 'reservation-1' }],
    coverage: 'STORED_EVIDENCE_ONLY',
  })
  const baseRoutes = (create: Handler): Record<string, Handler> => ({
    [`GET ${EVENTS_PATH}`]: () => json(200, eventPage),
    [`GET ${clusterApi}`]: () => json(200, clusterBody()),
    'POST /api/v1/cases': create,
    // 생성 후 이동한 실제 Case 상세 화면의 조회다.
    [`GET ${casePath}`]: () => json(200, caseView()),
    [`GET ${sourcesPath}`]: () => json(200, []),
    [`GET ${activitiesPath}`]: () => json(200, page()),
    [`GET ${snapshotsPath}`]: () => json(200, page()),
    [`GET ${draftsPath}`]: () => json(200, page()),
  })
  const region = () => screen.getByRole('region', { name: 'Case 생성' })
  const typeReason = (value = '합성 조사 사유') => fireEvent.change(within(region()).getByRole('textbox', { name: /생성 사유/ }), { target: { value } })
  const createButton = () => within(region()).getByRole('button', { name: 'Case 생성' })

  it('실제 공연과 분석 요청 ID, 군집 ID로 1회 요청하고 응답 Case를 확인한 뒤 실제 상세로 이동한다', async () => {
    const pending = deferred()
    const calls = stubFetch(baseRoutes(() => pending.promise))
    renderApp(clusterRoute)
    await screen.findByRole('region', { name: 'Case 생성' })
    expect(writes(calls)).toHaveLength(0)
    typeReason()
    // 같은 버튼을 연속으로 눌러도 한 번만 보낸다.
    const button = createButton()
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    const [post] = writes(calls)
    expect(post.headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(post.headers.Authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`)
    expect(post.body).toEqual({ eventId: EVENT_A, type: 'GRAPH_CLUSTER', graphClusters: [{ analysisRequestId: ANALYSIS_1, clusterId: 'cluster-1' }], fanReportIds: [], evidenceIds: [], reason: '합성 조사 사유', relatedCaseId: null, relationReason: null })
    expect(within(region()).getByRole('button', { name: /Case 생성 요청 중/ })).toBeDisabled()
    await act(async () => { pending.resolve(json(201, caseView())) })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/app/cases/${CASE_1}?eventId=${EVENT_A}`))
    expect(await screen.findByRole('heading', { name: '조사 사건 상세' })).toBeInTheDocument()
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(post.headers['Idempotency-Key'])
  })

  it.each([
    [409, 'SOURCE_ALREADY_LINKED', '이미 진행 중인 Case에 연결된 출처입니다'],
    [403, 'FORBIDDEN', 'Case 생성에 필요한 역할이 없습니다'],
    [404, 'RESOURCE_NOT_FOUND', '출처를 찾을 수 없거나 접근 범위 밖입니다'],
    [422, 'VALIDATION_FAILED', '서버가 입력 값을 거부했습니다'],
    [409, 'IDEMPOTENCY_KEY_REUSED', '같은 요청 키가 다른 내용으로 사용되었습니다'],
  ])('%i %s는 Case를 만들지 않고 이동하지 않는다', async (status, code, title) => {
    const calls = stubFetch(baseRoutes(() => problem(status, code)))
    renderApp(clusterRoute)
    await screen.findByRole('region', { name: 'Case 생성' })
    typeReason()
    fireEvent.click(createButton())
    expect(await within(region()).findByRole('alert')).toHaveTextContent(title)
    expect(screen.getByTestId('location')).toHaveTextContent('/app/analysis/findings/detail')
    expect(screen.queryByText(/SQLSTATE|내부 고객사/)).not.toBeInTheDocument()
    // 확정 거부 뒤에는 새 요청 키로 다시 보낼 수 있다.
    fireEvent.click(createButton())
    await waitFor(() => expect(writes(calls)).toHaveLength(2))
    expect(writes(calls)[1].headers['Idempotency-Key']).not.toBe(writes(calls)[0].headers['Idempotency-Key'])
  })

  it('응답을 받지 못하면 새 요청을 막고 같은 키와 같은 본문으로만 재확인한다', async () => {
    const calls = stubFetch(baseRoutes((_, count) => count === 1 ? Promise.reject(new TypeError('offline')) : json(201, caseView())))
    renderApp(clusterRoute)
    await screen.findByRole('region', { name: 'Case 생성' })
    typeReason()
    fireEvent.click(createButton())
    expect(await within(region()).findByRole('alert')).toHaveTextContent('결과 미확인: 서버 응답을 받지 못했습니다')
    expect(within(region()).queryByRole('button', { name: 'Case 생성' })).not.toBeInTheDocument()
    expect(within(region()).getByRole('textbox', { name: /생성 사유/ })).toBeDisabled()
    fireEvent.click(within(region()).getByRole('button', { name: '같은 요청 재확인' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/app/cases/${CASE_1}`))
    const [first, second] = writes(calls)
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key'])
    expect(second.body).toEqual(first.body)
  })

  it.each([
    ['다른 공연', caseView({ eventId: EVENT_B })],
    ['다른 유형', caseView({ type: 'FAN_REPORT' })],
    ['OPEN이 아닌 상태', caseView({ status: 'TRIAGED' })],
  ])('%s의 201 응답은 성공으로 보지 않고 이동하지 않는다', async (_, body) => {
    stubFetch(baseRoutes(() => json(201, body)))
    renderApp(clusterRoute)
    await screen.findByRole('region', { name: 'Case 생성' })
    typeReason()
    fireEvent.click(createButton())
    expect(await within(region()).findByRole('alert')).toHaveTextContent('서버 응답이 요청과 맞지 않습니다')
    expect(screen.getByTestId('location')).toHaveTextContent('/app/analysis/findings/detail')
  })

  it('사유가 짧으면 요청하지 않고, 분석 요청 ID가 서버 계약 형식이 아니면 생성 버튼을 막는다', async () => {
    const calls = stubFetch(baseRoutes(() => json(201, caseView())))
    const view = renderApp(clusterRoute)
    await screen.findByRole('region', { name: 'Case 생성' })
    typeReason('가')
    fireEvent.click(createButton())
    expect(await within(region()).findByText('공백을 제외하고 3자 이상 입력해 주세요.')).toBeInTheDocument()
    expect(writes(calls)).toHaveLength(0)
    view.unmount()

    const legacyRoute = `/app/analysis/findings/detail?eventId=${EVENT_A}&analysisRequestId=run%2F1&clusterId=cluster-1`
    const legacyApi = `/api/v1/admin/track1/clusters/detail?eventId=${EVENT_A}&analysisRequestId=run%2F1&clusterId=cluster-1`
    const legacyCalls = stubFetch({ ...baseRoutes(() => json(201, caseView())), [`GET ${legacyApi}`]: () => json(200, clusterBody('run/1')) })
    renderApp(legacyRoute)
    expect(await screen.findByRole('note')).toHaveTextContent('소문자 UUID 형식이 아니어서')
    expect(createButton()).toBeDisabled()
    expect(writes(legacyCalls)).toHaveLength(0)
  })
})

describe('Track 2 팬 제보에서 Case 생성', () => {
  const reportApi = `/api/v1/admin/fan-reports/${REPORT_1}`
  const storedPng = { evidenceId: EVIDENCE_1, mediaType: 'image/png', byteSize: 20480, storageStatus: 'STORED', originalStored: true, sha256: SHA_A, createdAt: '2026-11-01T09:30:00Z' }
  const failedJpeg = { evidenceId: EVIDENCE_2, mediaType: 'image/jpeg', byteSize: 512, storageStatus: 'FAILED', originalStored: false, sha256: null, createdAt: '2026-11-01T09:30:00Z' }
  const reportBody = (overrides: Record<string, unknown> = {}) => ({
    fanReportId: REPORT_1, event: { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }, reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED',
    receivedAt: '2026-11-01T09:30:00Z', retentionUntil: '2099-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z',
    seatArea: null, description: '합성 설명', listingUrl: null, platform: null, seller: '합성판매자', askingPrice: null, evidence: [storedPng, failedJpeg], ...overrides,
  })
  const routes = (create: Handler, report = reportBody()): Record<string, Handler> => ({
    [`GET ${reportApi}`]: () => json(200, report),
    [`GET ${reportApi}/evidence/${EVIDENCE_1}/listing-analyses?page=0&pageSize=20`]: () => json(200, page()),
    'POST /api/v1/cases': create,
    [`GET ${casePath}`]: () => json(200, caseView({ type: 'FAN_REPORT' })),
    [`GET ${sourcesPath}`]: () => json(200, []),
    [`GET ${activitiesPath}`]: () => json(200, page()),
    [`GET ${snapshotsPath}`]: () => json(200, page()),
    [`GET ${draftsPath}`]: () => json(200, page()),
  })
  const region = () => screen.getByRole('region', { name: 'Case 생성' })

  it('원본 저장이 확인된 증거만 선택해 FAN_REPORT로 요청하고 분석 결과로 자동 생성하지 않는다', async () => {
    const calls = stubFetch(routes(() => json(201, caseView({ type: 'FAN_REPORT' }))))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    await screen.findByText('합성판매자')
    expect(writes(calls)).toHaveLength(0)
    const boxes = within(region()).getAllByRole('checkbox')
    expect(boxes[0]).toBeEnabled()
    expect(boxes[1]).toBeDisabled()
    expect(within(region()).getByText(/원본 저장이 확인되지 않아 연결할 수 없음/)).toBeInTheDocument()
    fireEvent.click(boxes[0])
    fireEvent.change(within(region()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 제보 조사' } })
    fireEvent.click(within(region()).getByRole('button', { name: 'Case 생성' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/app/cases/${CASE_1}?eventId=${EVENT_A}`))
    expect(writes(calls)[0].body).toMatchObject({ eventId: EVENT_A, type: 'FAN_REPORT', graphClusters: [], fanReportIds: [REPORT_1], evidenceIds: [EVIDENCE_1] })
  })

  it('Track 1 군집을 함께 입력하면 COMBINED로 요청한다', async () => {
    const calls = stubFetch(routes(() => json(201, caseView({ type: 'COMBINED' }))))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    await screen.findByText('합성판매자')
    fireEvent.change(within(region()).getByRole('textbox', { name: '분석 요청 ID' }), { target: { value: ANALYSIS_1 } })
    fireEvent.change(within(region()).getByRole('textbox', { name: '군집 ID' }), { target: { value: 'cluster-1' } })
    fireEvent.change(within(region()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 복합 조사' } })
    fireEvent.click(within(region()).getByRole('button', { name: 'Case 생성' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0].body).toMatchObject({ type: 'COMBINED', graphClusters: [{ analysisRequestId: ANALYSIS_1, clusterId: 'cluster-1' }], fanReportIds: [REPORT_1], evidenceIds: [] })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/app/cases/${CASE_1}`))
  })

  it.each([
    ['SOURCE_NOT_AVAILABLE', '보존 기한 또는 접수 상태 때문에 연결할 수 없는 출처입니다', '원본 무결성 실패와는 다른 상태'],
    ['SOURCE_OBJECT_MISMATCH', '증거 원본 상태가 접수 기록과 맞지 않습니다', '원본 무결성을 확인하지 못했습니다'],
    ['SOURCE_OBJECT_MISSING', '증거 원본을 저장소에서 찾지 못했습니다', '원본 무결성을 확인하지 못했습니다'],
  ])('422 %s는 보존 실패와 원본 무결성 실패를 구분해 안내한다', async (code, title, detail) => {
    stubFetch(routes(() => problem(422, code)))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    await screen.findByText('합성판매자')
    fireEvent.click(within(region()).getAllByRole('checkbox')[0])
    fireEvent.change(within(region()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 제보 조사' } })
    fireEvent.click(within(region()).getByRole('button', { name: 'Case 생성' }))
    const alert = await within(region()).findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).toHaveTextContent(detail)
  })

  it.each([
    ['접수 실패 제보', { intakeStatus: 'STORAGE_FAILED' }, '정상 접수 상태의 제보만'],
    ['보존 기한이 지난 제보', { retentionUntil: '2026-01-01T00:00:00Z' }, '보존 기한이 지난 제보는'],
  ])('%s는 생성 요청을 막는다', async (_, overrides, reason) => {
    const calls = stubFetch(routes(() => json(201, caseView()), reportBody(overrides)))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    await screen.findByText('합성판매자')
    expect(within(region()).getByRole('note')).toHaveTextContent(reason)
    expect(within(region()).getByRole('button', { name: 'Case 생성' })).toBeDisabled()
    expect(writes(calls)).toHaveLength(0)
  })

  it('응답 대기 중 로그아웃하면 요청을 취소하고 늦은 응답으로 이동하지 않는다', async () => {
    const pending = deferred()
    const calls = stubFetch(routes(() => pending.promise))
    renderApp(`/app/fan-reports/${REPORT_1}`)
    await screen.findByText('합성판매자')
    fireEvent.change(within(region()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 제보 조사' } })
    fireEvent.click(within(region()).getByRole('button', { name: 'Case 생성' }))
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(writes(calls)[0].signal?.aborted).toBe(true)
    await act(async () => { pending.resolve(json(201, caseView({ type: 'FAN_REPORT' }))) })
    expect(screen.getByTestId('location')).not.toHaveTextContent('/app/cases/')
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(SYNTHETIC_TOKEN)
  })
})

describe('Case 상세 상태 변경과 담당자', () => {
  const detailRoute = `/app/cases/${CASE_1}?eventId=${EVENT_A}`
  const readRoutes = (views: CaseView[]): Record<string, Handler> => ({
    [`GET ${casePath}`]: (_, count) => json(200, views[Math.min(count, views.length) - 1]),
    [`GET ${sourcesPath}`]: () => json(200, []),
    [`GET ${activitiesPath}`]: () => json(200, page()),
    [`GET ${snapshotsPath}`]: () => json(200, page()),
    [`GET ${draftsPath}`]: () => json(200, page()),
  })
  const transitionRegion = () => screen.getByRole('region', { name: '상태 변경' })
  const assigneeRegion = () => screen.getByRole('region', { name: '담당자 변경' })
  const fill = (scope: HTMLElement, label: RegExp, value: string) => fireEvent.change(within(scope).getByRole('textbox', { name: label }), { target: { value } })

  it('OPEN에서 분류 완료로 바꾸며 expectedCaseVersion과 필수 필드를 보내고 성공 뒤 Case와 활동 이력을 다시 조회한다', async () => {
    const after = caseView({ status: 'TRIAGED', caseVersion: 1, classification: '합성 분류' })
    const calls = stubFetch({ ...readRoutes([caseView(), after]), [`POST ${casePath}/transitions`]: () => json(200, after) })
    renderApp(detailRoute)
    await screen.findByRole('region', { name: '상태 변경' })
    fireEvent.click(within(transitionRegion()).getByRole('button', { name: '상태 변경' }))
    expect(await within(transitionRegion()).findAllByText(/3자 이상/)).toHaveLength(3)
    expect(writes(calls)).toHaveLength(0)
    fill(transitionRegion(), /분류/, '합성 분류')
    fill(transitionRegion(), /담당자 미지정 사유/, '담당자 미정 합성')
    fill(transitionRegion(), /변경 사유/, '합성 분류 사유')
    fireEvent.click(within(transitionRegion()).getByRole('button', { name: '상태 변경' }))
    await waitFor(() => expect(screen.getByText('상태를 분류 완료(으)로 변경했습니다. Case 버전 1.')).toBeInTheDocument())
    const [post] = writes(calls)
    expect(post.headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(post.body).toEqual({ toStatus: 'TRIAGED', expectedCaseVersion: 0, reason: '합성 분류 사유', classification: '합성 분류', unassignedReason: '담당자 미정 합성', missingEvidence: null, requestedAction: null, unavailableReason: null, dismissalBasis: null })
    await waitFor(() => expect(gets(calls, casePath)).toHaveLength(2))
    await waitFor(() => expect(gets(calls, activitiesPath)).toHaveLength(2))
    expect(await within(screen.getByRole('region', { name: 'Case 개요' })).findByText('합성 분류')).toBeInTheDocument()
  })

  it('409 CASE_VERSION_CONFLICT는 서버 최신 상태를 다시 조회하고 충돌을 안내한다', async () => {
    const latest = caseView({ caseVersion: 2, assigneeMembershipId: MEMBER_ASSIGNEE })
    const calls = stubFetch({ ...readRoutes([caseView(), latest]), [`POST ${casePath}/transitions`]: () => problem(409, 'CASE_VERSION_CONFLICT') })
    renderApp(detailRoute)
    await screen.findByRole('region', { name: '상태 변경' })
    fill(transitionRegion(), /분류/, '합성 분류')
    fill(transitionRegion(), /담당자 미지정 사유/, '담당자 미정 합성')
    fill(transitionRegion(), /변경 사유/, '합성 분류 사유')
    fireEvent.click(within(transitionRegion()).getByRole('button', { name: '상태 변경' }))
    expect(await screen.findByText('다른 사용자가 먼저 Case를 변경했습니다')).toBeInTheDocument()
    await waitFor(() => expect(gets(calls, casePath)).toHaveLength(2))
    const overview = screen.getByRole('region', { name: 'Case 개요' })
    await waitFor(() => expect(within(overview).getByText(MEMBER_ASSIGNEE)).toBeInTheDocument())
    expect(within(overview).getByText('2')).toBeInTheDocument()
  })

  it('409 CASE_STATE_CONFLICT는 상태 전이 조건 위반으로 안내하고 기존 상태를 덮어쓰지 않는다', async () => {
    const view = caseView({ status: 'TRIAGED', caseVersion: 1, assigneeMembershipId: MEMBER_ASSIGNEE })
    const calls = stubFetch({ ...readRoutes([view]), [`POST ${casePath}/transitions`]: () => problem(409, 'CASE_STATE_CONFLICT') })
    renderApp(detailRoute)
    await screen.findByRole('region', { name: '상태 변경' })
    fill(transitionRegion(), /변경 사유/, '합성 검토 시작')
    fireEvent.click(within(transitionRegion()).getByRole('button', { name: '상태 변경' }))
    expect(await within(transitionRegion()).findByRole('alert')).toHaveTextContent('현재 Case 상태에서 허용되지 않는 요청입니다')
    expect(gets(calls, casePath)).toHaveLength(1)
    expect(writes(calls)[0].body).toMatchObject({ toStatus: 'IN_REVIEW', expectedCaseVersion: 1 })
  })

  it('담당자가 없으면 검토 시작 전 지정을 안내하고, 승인 대기 이후 상태에는 전이를 제공하지 않는다', async () => {
    stubFetch(readRoutes([caseView({ status: 'TRIAGED', caseVersion: 1 })]))
    const view = renderApp(detailRoute)
    await screen.findByRole('region', { name: '상태 변경' })
    expect(within(transitionRegion()).getByRole('note')).toHaveTextContent('담당자가 지정되어 있어야 합니다')
    view.unmount()
    stubFetch(readRoutes([caseView({ status: 'READY_FOR_APPROVAL', caseVersion: 9, assigneeMembershipId: MEMBER_ASSIGNEE })]))
    renderApp(detailRoute)
    await screen.findByRole('region', { name: '상태 변경' })
    expect(within(transitionRegion()).getByText(/제공하는 상태 변경이 없습니다/)).toBeInTheDocument()
    expect(within(transitionRegion()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('403 응답 뒤에는 검토 담당 전용 동작을 모두 막고 역할을 추정하지 않는다', async () => {
    const calls = stubFetch({ ...readRoutes([caseView()]), [`PUT ${casePath}/assignee`]: () => problem(403, 'FORBIDDEN') })
    renderApp(detailRoute)
    await screen.findByRole('region', { name: '담당자 변경' })
    fill(assigneeRegion(), /새 담당자 멤버십 ID/, MEMBER_OTHER)
    fill(assigneeRegion(), /변경 사유/, '합성 담당 지정')
    fireEvent.click(within(assigneeRegion()).getByRole('button', { name: '담당자 지정' }))
    expect(await within(assigneeRegion()).findByRole('alert')).toHaveTextContent('담당자 변경에 필요한 역할이 없습니다')
    expect(screen.getByText(/검토 담당\(REVIEWER\) 역할이 없어 서버가 변경 요청을 거부했습니다/)).toBeInTheDocument()
    expect(within(assigneeRegion()).getByRole('button', { name: '담당자 지정' })).toBeDisabled()
    expect(within(transitionRegion()).getByRole('button', { name: '상태 변경' })).toBeDisabled()
    expect(writes(calls)).toHaveLength(1)
  })

  it('담당자 PUT에 멱등 키와 expectedCaseVersion을 보내고, 실패는 상태 변경과 분리해 안내한다', async () => {
    const after = caseView({ caseVersion: 1, assigneeMembershipId: MEMBER_OTHER })
    const calls = stubFetch({
      ...readRoutes([caseView(), after]),
      [`PUT ${casePath}/assignee`]: (_, count) => count === 1 ? problem(422, 'ASSIGNEE_ROLE_INVALID') : json(200, after),
    })
    renderApp(detailRoute)
    await screen.findByRole('region', { name: '담당자 변경' })
    fill(assigneeRegion(), /새 담당자 멤버십 ID/, MEMBER_OTHER)
    fill(assigneeRegion(), /변경 사유/, '합성 담당 지정')
    fireEvent.click(within(assigneeRegion()).getByRole('button', { name: '담당자 지정' }))
    expect(await within(assigneeRegion()).findByRole('alert')).toHaveTextContent('담당자로 지정할 수 없는 역할입니다')
    expect(within(transitionRegion()).queryByRole('alert')).not.toBeInTheDocument()
    expect(gets(calls, casePath)).toHaveLength(1)
    fireEvent.click(within(assigneeRegion()).getByRole('button', { name: '담당자 지정' }))
    await waitFor(() => expect(screen.getByText('담당자를 변경했습니다. Case 버전 1.')).toBeInTheDocument())
    const [first, second] = writes(calls)
    expect(first.method).toBe('PUT')
    expect(first.headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(second.headers['Idempotency-Key']).not.toBe(first.headers['Idempotency-Key'])
    expect(second.body).toEqual({ assigneeMembershipId: MEMBER_OTHER, expectedCaseVersion: 0, reason: '합성 담당 지정' })
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Case 개요' })).getByText(MEMBER_OTHER)).toBeInTheDocument())
    expect(screen.queryByText(/시연 담당|DEMO-/)).not.toBeInTheDocument()
  })
})

describe('Case 상세 EvidenceSnapshot과 보고서 초안', () => {
  const detailRoute = `/app/cases/${CASE_1}?eventId=${EVENT_A}`
  const review = caseView({ status: 'IN_REVIEW', caseVersion: 4, assigneeMembershipId: MEMBER_ASSIGNEE, type: 'FAN_REPORT' })
  const routes = (extra: Record<string, Handler>, views: CaseView[] = [review]): Record<string, Handler> => ({
    [`GET ${casePath}`]: (_, count) => json(200, views[Math.min(count, views.length) - 1]),
    [`GET ${sourcesPath}`]: () => json(200, []),
    [`GET ${activitiesPath}`]: () => json(200, page()),
    [`GET ${snapshotsPath}`]: () => json(200, page()),
    [`GET ${draftsPath}`]: () => json(200, page()),
    ...extra,
  })
  const snapshotRegion = () => screen.getByRole('region', { name: 'EvidenceSnapshot' })
  const draftRegion = () => screen.getByRole('region', { name: '보고서 초안' })

  it('검토 중 Case에서 Snapshot을 생성하고 상세를 서버에서 재확인하며 원문 manifest를 표시하지 않는다', async () => {
    const after = { ...review, caseVersion: 5 }
    const calls = stubFetch(routes({
      [`POST ${casePath}/evidence-snapshots`]: () => json(201, snapshot()),
      [`GET ${snapshotsPath}`]: (_, count) => json(200, page(count === 1 ? [] : [snapshot()])),
      [`GET ${casePath}/evidence-snapshots/${SNAPSHOT_1}`]: () => json(200, snapshot()),
    }, [review, after]))
    renderApp(detailRoute)
    expect(await within(await screen.findByRole('region', { name: 'EvidenceSnapshot' })).findByText('생성된 EvidenceSnapshot이 없습니다')).toBeInTheDocument()
    fireEvent.change(within(snapshotRegion()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 증거 고정' } })
    const captureButton = within(snapshotRegion()).getByRole('button', { name: 'EvidenceSnapshot 생성' })
    fireEvent.click(captureButton)
    fireEvent.click(captureButton)
    await waitFor(() => expect(writes(calls)).toHaveLength(1))
    expect(writes(calls)[0].body).toEqual({ expectedCaseVersion: 4, reason: '합성 증거 고정' })
    expect(writes(calls)[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    const detail = await screen.findByRole('region', { name: 'Snapshot 상세 재확인' })
    expect(await within(detail).findByText(SHA_A)).toBeInTheDocument()
    expect(within(detail).getByText('메타데이터 대조 (원본 바이트 재검증 아님)')).toBeInTheDocument()
    expect(within(detail).getByText('승인 요청 불가 (서버 판정)')).toBeInTheDocument()
    expect(gets(calls, `${casePath}/evidence-snapshots/${SNAPSHOT_1}`).length).toBeGreaterThanOrEqual(1)
    await waitFor(() => expect(gets(calls, snapshotsPath).length).toBeGreaterThanOrEqual(2))
    // 같은 증거 개정 번호의 Snapshot이 생기면 다시 만들지 않는다.
    await waitFor(() => expect(within(snapshotRegion()).getByRole('button', { name: 'EvidenceSnapshot 생성' })).toBeDisabled())
    expect(document.body.textContent).not.toContain('synthetic-raw-object')
  })

  it.each([
    ['SNAPSHOT_ALREADY_EXISTS', '현재 증거 개정 번호의 Snapshot이 이미 있습니다'],
    ['SOURCE_CHANGED', '출처 보존 상태 또는 원본 기록이 연결 시점과 다릅니다'],
    ['CASE_STATE_CONFLICT', 'EvidenceSnapshot은 검토 중 상태에서만'],
  ])('Snapshot 409 %s를 정상 상태로 바꾸지 않고 안내한다', async (code, text) => {
    stubFetch(routes({ [`POST ${casePath}/evidence-snapshots`]: () => problem(409, code) }))
    renderApp(detailRoute)
    await within(await screen.findByRole('region', { name: 'EvidenceSnapshot' })).findByText('생성된 EvidenceSnapshot이 없습니다')
    fireEvent.change(within(snapshotRegion()).getByRole('textbox', { name: /생성 사유/ }), { target: { value: '합성 증거 고정' } })
    fireEvent.click(within(snapshotRegion()).getByRole('button', { name: 'EvidenceSnapshot 생성' }))
    expect(await within(snapshotRegion()).findByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByRole('region', { name: 'Snapshot 상세 재확인' })).not.toBeInTheDocument()
  })

  it('검토 중이 아니면 Snapshot과 초안 작성을 막는다', async () => {
    const calls = stubFetch(routes({}, [caseView({ status: 'TRIAGED', caseVersion: 1, assigneeMembershipId: MEMBER_ASSIGNEE })]))
    renderApp(detailRoute)
    await within(await screen.findByRole('region', { name: 'EvidenceSnapshot' })).findByText('생성된 EvidenceSnapshot이 없습니다')
    expect(within(snapshotRegion()).getByRole('button', { name: 'EvidenceSnapshot 생성' })).toBeDisabled()
    expect(within(draftRegion()).getByRole('button', { name: '보고서 초안 저장' })).toBeDisabled()
    expect(writes(calls)).toHaveLength(0)
  })

  it('현재 개정 Snapshot으로 초안을 저장하고 ID, 개정, SHA-256, 템플릿, DRAFT 상태를 표시하며 승인과 PDF는 계속 막는다', async () => {
    const after = { ...review, caseVersion: 5 }
    const calls = stubFetch(routes({
      [`GET ${snapshotsPath}`]: () => json(200, page([snapshot(), snapshot({ evidenceSnapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0', evidenceRevision: 0 })])),
      [`POST ${casePath}/report-versions`]: () => json(201, reportVersion()),
      [`GET ${draftsPath}`]: (_, count) => json(200, page(count === 1 ? [] : [reportVersion()])),
    }, [review, after]))
    renderApp(detailRoute)
    const region = await screen.findByRole('region', { name: '보고서 초안' })
    await within(region).findByText('저장된 보고서 초안이 없습니다')
    const select = within(region).getByRole('combobox', { name: /기준 EvidenceSnapshot/ })
    // 현재 증거 개정 번호의 Snapshot만 선택지로 제공한다.
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    fireEvent.change(select, { target: { value: SNAPSHOT_1 } })
    const set = (label: RegExp, value: string) => fireEvent.change(within(region).getByRole('textbox', { name: label }), { target: { value } })
    set(/제목/, '합성 보고서 제목')
    set(/평가/, '합성 평가 내용을 충분히 입력')
    set(/한계/, '합성 한계')
    set(/결론/, '합성 결론')
    set(/작성 사유/, '합성 초안 작성')
    fireEvent.click(within(region).getByRole('button', { name: '보고서 초안 저장' }))
    const created = await screen.findByRole('region', { name: '방금 저장한 초안' })
    expect(writes(calls)[0].body).toEqual({ expectedCaseVersion: 4, evidenceSnapshotId: SNAPSHOT_1, title: '합성 보고서 제목', assessment: '합성 평가 내용을 충분히 입력', limitations: '합성 한계', conclusion: '합성 결론', reason: '합성 초안 작성' })
    expect(within(created).getByText(REPORT_VERSION_1)).toBeInTheDocument()
    expect(within(created).getByText(SHA_C)).toBeInTheDocument()
    expect(within(created).getByText('case-approval-input-v1')).toBeInTheDocument()
    expect(within(created).getByText('초안 (승인 아님)')).toBeInTheDocument()
    expect(screen.getByText('보고서 초안 개정 1을 저장했습니다. 초안은 승인된 보고서가 아닙니다.')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByRole('list', { name: '보고서 초안 목록' })).getAllByRole('listitem')).toHaveLength(1))
    expect(document.body.textContent).not.toContain('합성 보고서 원문 JSON')
    // 승인 요청 제출은 Issue #33에서 별도 영역으로 연결했고 공식 PDF 발급은 계속 막는다.
    expect(screen.getByRole('button', { name: '공식 PDF 발급' })).toBeDisabled()
    expect(screen.getByRole('region', { name: '승인 요청 제출' })).toBeInTheDocument()
    expect(writes(calls).every((call) => !call.url.includes('approval') && !call.url.includes('pdf'))).toBe(true)
  })

  it.each([
    ['REPORT_CONTENT_UNCHANGED', '직전 초안과 내용이 같습니다'],
    ['EVIDENCE_VERSION_MISMATCH', '선택한 Snapshot이 현재 증거 개정 번호와 다릅니다'],
    ['SOURCE_CHANGED', '출처 상태가 Snapshot 시점과 다릅니다'],
  ])('초안 409 %s를 안내하고 입력을 유지한다', async (code, title) => {
    stubFetch(routes({
      [`GET ${snapshotsPath}`]: () => json(200, page([snapshot()])),
      [`POST ${casePath}/report-versions`]: () => problem(409, code),
    }))
    renderApp(detailRoute)
    const region = await screen.findByRole('region', { name: '보고서 초안' })
    await within(region).findByText('저장된 보고서 초안이 없습니다')
    await waitFor(() => expect(within(within(region).getByRole('combobox', { name: /기준 EvidenceSnapshot/ })).getAllByRole('option')).toHaveLength(2))
    fireEvent.change(within(region).getByRole('combobox', { name: /기준 EvidenceSnapshot/ }), { target: { value: SNAPSHOT_1 } })
    for (const [label, value] of [[/제목/, '합성 제목'], [/평가/, '합성 평가 내용을 충분히'], [/한계/, '합성 한계'], [/결론/, '합성 결론'], [/작성 사유/, '합성 사유']] as const) {
      fireEvent.change(within(region).getByRole('textbox', { name: label }), { target: { value } })
    }
    fireEvent.click(within(region).getByRole('button', { name: '보고서 초안 저장' }))
    expect(await within(region).findByRole('alert')).toHaveTextContent(title)
    expect(within(region).getByRole('textbox', { name: /제목/ })).toHaveValue('합성 제목')
  })
})
