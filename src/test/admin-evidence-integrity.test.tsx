import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { evidenceLinkViewSchema } from '../features/admin-cases/track1CandidateLinkApi'
import { formatLedgerSeat } from '../features/admin-track1/track1Api'

// 증거 무결성 패널과 구매 한도 정책 조회를 Mock 인증과 Mock fetch로 검증한다. 실제 Backend HTTP 연동 결과가 아니며 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const CASE_1 = '11111111-1111-4111-8111-111111111111'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const MEMBER = '22222222-2222-4222-8222-222222222221'
const SNAPSHOT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const SOURCE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const REPORT = '55555555-5555-4555-8555-555555555551'
const EVIDENCE = '66666666-6666-4666-8666-666666666661'
const RECORD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const SHA = 'a'.repeat(64)
const LIST = `/api/v1/cases/${CASE_1}/evidence-verifications?page=0&pageSize=20`
const VERIFY = `/api/v1/cases/${CASE_1}/evidence-verifications`
const EVALUATION = `/api/v1/cases/${CASE_1}/integrity-evaluation?reportVersionId=${DRAFT}`
const POLICY = `/api/v1/admin/events/${EVENT_A}/purchase-limit-policies`
const EVENTS = '/api/v1/admin/events?page=0&pageSize=100'
const SETTINGS = `/api/v1/admin/operations/settings?eventId=${EVENT_A}`
const PERFS = `/api/v1/admin/events/${EVENT_A}/verified-performances`
const PERF = '77777777-7777-4777-8777-777777777771'
const POLICY_1 = '88888888-8888-4888-8888-888888888881'

const adapter = () => ({
  availability: { status: 'ready' },
  initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}) satisfies AdminAuthAdapter

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => new Response(JSON.stringify({ title: 'Problem', status, code, detail: '내부 정보 secret-detail' }), { status, headers: { 'Content-Type': 'application/problem+json' } })

const caseBody = { caseId: CASE_1, eventId: EVENT_A, type: 'FAN_REPORT', status: 'IN_REVIEW', caseVersion: 7, evidenceRevision: 1, createdByMembershipId: MEMBER, assigneeMembershipId: null, relatedCaseId: null, relationReason: null, classification: null, currentReportVersionId: DRAFT, createdAt: '2026-11-06T01:00:00Z', updatedAt: '2026-11-06T01:00:00Z' }
const snapshot = { evidenceSnapshotId: SNAPSHOT, caseId: CASE_1, eventId: EVENT_A, evidenceRevision: 1, caseVersionAtCapture: 6, manifestSchemaVersion: 1, manifestSha256: SHA, manifestJson: '{}', sourceIntegrity: 'METADATA_ONLY', approvalEligible: false, createdByMembershipId: MEMBER, capturedAt: '2026-11-06T02:00:00Z' }
const draft = { reportVersionId: DRAFT, caseId: CASE_1, eventId: EVENT_A, evidenceSnapshotId: SNAPSHOT, evidenceRevision: 1, revision: 1, version: 0, templateVersion: 't1', templateSha256: SHA, contentSha256: SHA, contentJson: '{}', status: 'DRAFT', renderable: true, approvalEligible: false, createdByMembershipId: MEMBER, createdAt: '2026-11-06T03:00:00Z' }
const assetSource = { sourceType: 'EVIDENCE_ASSET', sourceReferenceId: SOURCE, analysisRequestId: null, clusterId: null, storedMemberCount: null, analysisAlgorithm: null, analysisAlgorithmVersion: null, analysisCompletedAt: null, riskScore: null, fanReportId: REPORT, evidenceId: EVIDENCE, linkedAt: '2026-11-06T01:00:00Z' }
const record = (verificationStatus: string, overrides = {}) => ({ recordId: RECORD, caseId: CASE_1, evidenceSnapshotId: SNAPSHOT, sourceReferenceId: SOURCE, evidenceId: EVIDENCE, verificationStatus, preservationStatus: 'VERSIONED_MUTABLE', markerKind: 'VERSION_ID', verificationMethod: 'STREAMED_SHA256', verifiedByteSize: 1024, verifiedAt: '2026-11-06T04:00:00Z', ...overrides })
const page = (items: unknown[], pageSize = 20) => ({ items, page: 0, pageSize, hasNext: false })

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }
type Handler = (call: Call, count: number) => Response

function stub(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const key = `${call.method} ${call.url}`
    counts[key] = (counts[key] ?? 0) + 1
    return routes[key]?.(call, counts[key]) ?? problem(404, 'RESOURCE_NOT_FOUND')
  }))
  return calls
}

const caseRoutes = (overrides: Record<string, Handler> = {}): Record<string, Handler> => ({
  [`GET /api/v1/cases/${CASE_1}`]: () => json(200, caseBody),
  [`GET /api/v1/cases/${CASE_1}/sources`]: () => json(200, [assetSource]),
  [`GET /api/v1/cases/${CASE_1}/evidence-snapshots?page=0&pageSize=20`]: () => json(200, page([snapshot])),
  [`GET /api/v1/cases/${CASE_1}/report-versions?page=0&pageSize=20`]: () => json(200, page([draft])),
  [`GET ${LIST}`]: () => json(200, page([])),
  ...overrides,
})

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={adapter()} /></MemoryRouter>)
const panel = () => screen.findByRole('region', { name: '증거 무결성 검증' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('증거 무결성 검증', () => {
  it('검증 기록이 없으면 무결성이 확인되었다고 표시하지 않는다', async () => {
    stub(caseRoutes())
    open(`/app/cases/${CASE_1}`)
    expect(await within(await panel()).findByText('검증 기록이 없습니다')).toBeInTheDocument()
    expect(within(await panel()).getByText(/무결성이 확인되었다는 뜻이 아닙니다/)).toBeInTheDocument()
  })

  it('검증 실패와 저장소 장애를 일치와 구분해 표시한다', async () => {
    stub(caseRoutes({ [`GET ${LIST}`]: () => json(200, page([
      record('HASH_MISMATCH'),
      record('STORAGE_UNAVAILABLE', { recordId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', verifiedByteSize: null, verificationMethod: 'NOT_READ', preservationStatus: 'UNKNOWN', markerKind: 'NONE' }),
    ])) }))
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    expect(await within(region).findByText('SHA-256 불일치 (HASH_MISMATCH)')).toBeInTheDocument()
    expect(within(region).getByText('저장소 응답 없음 (검증 불가) (STORAGE_UNAVAILABLE)')).toBeInTheDocument()
    expect(within(region).getByText('확인되지 않음')).toBeInTheDocument()
    expect(within(region).queryByText(/검증 시점 바이트 일치/)).not.toBeInTheDocument()
  })

  it('화면의 Case 버전과 요청 키로 검증을 요청하고 성공 뒤 기록을 다시 조회한다', async () => {
    const calls = stub(caseRoutes({ [`POST ${VERIFY}`]: () => json(201, record('MATCH')) }))
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    fireEvent.change(await within(region).findByRole('textbox', { name: /검증 사유/ }), { target: { value: '합성 검증 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '원본 바이트 검증' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    const post = calls.find((call) => call.method === 'POST')!
    expect(post.body).toEqual({ expectedCaseVersion: 7, evidenceSnapshotId: SNAPSHOT, sourceReferenceId: SOURCE, evidenceId: EVIDENCE, reason: '합성 검증 사유' })
    expect(post.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(calls.filter((call) => call.url === LIST).length).toBeGreaterThan(1))
  })

  it('사유가 너무 짧으면 서버에 보내지 않는다', async () => {
    const calls = stub(caseRoutes())
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    fireEvent.change(await within(region).findByRole('textbox', { name: /검증 사유/ }), { target: { value: '  a ' } })
    fireEvent.click(within(region).getByRole('button', { name: '원본 바이트 검증' }))
    expect(await within(region).findByText(/3자 이상/)).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('해시 불일치 422는 실패로 안내하고 남겨진 기록을 다시 조회한다', async () => {
    const calls = stub(caseRoutes({ [`POST ${VERIFY}`]: () => problem(422, 'HASH_MISMATCH') }))
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    fireEvent.change(await within(region).findByRole('textbox', { name: /검증 사유/ }), { target: { value: '합성 검증 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '원본 바이트 검증' }))
    expect(await within(region).findByText('요청 거부: 저장된 원본의 SHA-256이 접수 기록과 다릅니다')).toBeInTheDocument()
    expect(within(region).queryByText(/secret-detail/)).not.toBeInTheDocument()
    await waitFor(() => expect(calls.filter((call) => call.url === LIST).length).toBeGreaterThan(1))
  })

  it('저장소 503은 일치 여부를 알 수 없음으로 유지하고 재확인만 허용한다', async () => {
    const calls = stub(caseRoutes({ [`POST ${VERIFY}`]: (_call, count) => count === 1 ? problem(503, 'DEPENDENCY_UNAVAILABLE') : json(201, record('MATCH')) }))
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    fireEvent.change(await within(region).findByRole('textbox', { name: /검증 사유/ }), { target: { value: '합성 검증 사유' } })
    fireEvent.click(within(region).getByRole('button', { name: '원본 바이트 검증' }))
    fireEvent.click(await within(region).findByRole('button', { name: '검증 결과 재확인' }))
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2))
    const [first, second] = calls.filter((call) => call.method === 'POST')
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key'])
    expect(second.body).toEqual(first.body)
  })

  it('파일 증거 출처가 없으면 검증 요청 동작을 제공하지 않는다', async () => {
    stub(caseRoutes({ [`GET /api/v1/cases/${CASE_1}/sources`]: () => json(200, []) }))
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    expect(await within(region).findByText(/파일 증거 출처가 없어/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '원본 바이트 검증' })).not.toBeInTheDocument()
  })

  it('기술 검증이 일치해도 승인 근거 적격성 차단을 그대로 표시한다', async () => {
    stub(caseRoutes({ [`GET ${EVALUATION}`]: () => json(200, { caseId: CASE_1, evidenceSnapshotId: SNAPSHOT, reportVersionId: DRAFT, technicalIntegrity: 'VERIFIED_AT_TIME', approvalEligibility: 'BLOCKED', reasons: ['POLICY_UNAPPROVED', 'ORIGINAL_NOT_IMMUTABLE', 'BYTE_CHECK_HASH_MISMATCH', 'NEW_SERVER_REASON'] }) }))
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    fireEvent.click(await within(region).findByRole('button', { name: '무결성 평가 조회' }))
    const result = await within(region).findByRole('group', { name: '무결성 평가 결과' })
    expect(within(result).getByText('검증 시점 기준 일치 (VERIFIED_AT_TIME)')).toBeInTheDocument()
    expect(within(result).getByText('차단 (BLOCKED)')).toBeInTheDocument()
    expect(within(result).getByText('원본 바이트 검증 결과: SHA-256 불일치')).toBeInTheDocument()
    expect(within(result).getByText('알 수 없는 서버 사유 (NEW_SERVER_REASON)')).toBeInTheDocument()
  })

  it('요청한 초안과 다른 평가 응답은 표시하지 않는다', async () => {
    stub(caseRoutes({ [`GET ${EVALUATION}`]: () => json(200, { caseId: CASE_1, evidenceSnapshotId: SNAPSHOT, reportVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', technicalIntegrity: 'VERIFIED_AT_TIME', approvalEligibility: 'BLOCKED', reasons: [] }) }))
    open(`/app/cases/${CASE_1}`)
    const region = await panel()
    fireEvent.click(await within(region).findByRole('button', { name: '무결성 평가 조회' }))
    await waitFor(() => expect(within(region).queryByText('무결성 평가를 불러오는 중')).not.toBeInTheDocument())
    expect(within(region).queryByRole('group', { name: '무결성 평가 결과' })).not.toBeInTheDocument()
  })
})

describe('다좌석 원장 표시', () => {
  it('seats가 여러 개면 모든 좌석을 표시하고 없으면 기존 단일 값을 쓴다', () => {
    expect(formatLedgerSeat({ status: 'FOUND', zone: null, row: null, seat: null, seats: [{ zone: 'A', row: '1', seat: '1' }, { zone: 'A', row: '1', seat: '2' }] })).toBe('구역 A, 열 1, 좌석 1 / 구역 A, 열 1, 좌석 2 (같은 예매 2석)')
    expect(formatLedgerSeat({ status: 'FOUND', zone: 'B', row: '2', seat: '3', seats: [{ zone: 'B', row: '2', seat: '3' }] })).toBe('구역 B, 열 2, 좌석 3')
    expect(formatLedgerSeat({ status: 'FOUND', zone: 'C', row: '4', seat: '5' })).toBe('구역 C, 열 4, 좌석 5')
    expect(formatLedgerSeat({ status: 'NOT_IN_LEDGER', seats: [] })).toBe('좌석 정보 없음')
  })

  it('linkBasis는 알려진 값만 받고 이전 서버 응답도 허용한다', () => {
    const view = (extra: object) => ({ status: 'LINKED', items: [{ graphSourceId: SOURCE, candidateSourceId: SOURCE, candidateRunId: SOURCE, status: 'LINKED', ledgerSeats: [], ...extra }] })
    expect(evidenceLinkViewSchema.safeParse(view({ linkBasis: 'RESERVATION_REFERENCE' })).success).toBe(true)
    expect(evidenceLinkViewSchema.safeParse(view({})).success).toBe(true)
    expect(evidenceLinkViewSchema.safeParse(view({ linkBasis: 'SAME_TICKET' })).success).toBe(false)
  })
})

describe('구매 한도 정책 조회', () => {
  const settingsBody = { fanReportIntakeEnabled: true, track2ListingAnalysisConfigured: false, track1RelationshipEvidenceCoverage: 'STORED_DEVICE_AND_IP_SIGNALS_ONLY', officialPdfIssuanceState: 'BLOCKED', auditorAccessState: 'NOT_IMPLEMENTED_POLICY_PENDING' }
  const events = { items: [{ id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }], page: 0, pageSize: 100, totalItems: 1, hasNext: false }
  const performance = { performanceId: PERF, eventId: EVENT_A, performanceRef: 'synthetic-perf-1', status: 'ACTIVE', revision: 1, sourceVersion: 'src-1', verifiedAt: '2026-11-01T00:00:00Z', withdrawnAt: null }
  const policy = (overrides = {}) => ({ policyId: POLICY_1, eventId: EVENT_A, performanceId: PERF, maxTicketsPerAccount: 2, policyVersion: 'synthetic-r1', effectiveFrom: '2026-11-01T00:00:00', effectiveUntil: null, status: 'ACTIVE', policySource: 'synthetic source', verificationBasis: 'synthetic basis', limitSubject: 'ACCOUNT', applicationScope: 'PERFORMANCE', salesPhaseRef: null, cancellationRefundRule: 'NETTED', includesPresale: true, revision: 1, changedAt: '2026-11-01T00:00:00', ...overrides })
  const base = (list: Handler, extra: Record<string, Handler> = {}): Record<string, Handler> => ({ [`GET ${EVENTS}`]: () => json(200, events), [`GET ${SETTINGS}`]: () => json(200, settingsBody), [`GET ${POLICY}`]: list, [`GET ${PERFS}`]: () => json(200, [performance]), ...extra })
  const fill = (scope: HTMLElement, name: RegExp, value: string) => fireEvent.change(within(scope).getByLabelText(name), { target: { value } })
  const region = () => screen.findByRole('region', { name: '구매 한도 정책' })
  const route = `/app/settings?eventId=${EVENT_A}`

  it('서버 정책을 표시하고 모르는 코드는 코드 그대로 둔다', async () => {
    stub(base(() => json(200, [policy({ applicationScope: 'FUTURE_SCOPE', includesPresale: null })])))
    open(route)
    const panelNode = await region()
    expect(await within(panelNode).findByText('2매')).toBeInTheDocument()
    expect(within(panelNode).getByText('계정별 (ACCOUNT)')).toBeInTheDocument()
    expect(within(panelNode).getByText('알 수 없는 서버 값 (FUTURE_SCOPE)')).toBeInTheDocument()
    expect(within(panelNode).getByText('미지정')).toBeInTheDocument()
    expect(within(panelNode).getByText(/의미 값이 비어 있어 분석에서 정책 미확인/)).toBeInTheDocument()
    expect(within(panelNode).getByText(/의미 값이 확인된 계정 한도 정책 없음/)).toBeInTheDocument()
  })

  it('회차별로 정책 없음을 정책 미확인으로 표시한다', async () => {
    stub(base(() => json(200, [])))
    open(route)
    expect(await within(await region()).findByText(/정책 없음. 한도를 평가하지 않습니다/)).toBeInTheDocument()
  })

  it('관리자가 입력한 값만 시간대 없이 등록하고 미확인 의미 값은 null로 보낸다', async () => {
    const calls = stub(base((_call, count) => json(200, count === 1 ? [] : [policy()]), { [`POST ${POLICY}`]: () => json(201, policy()) }))
    open(route)
    const panelNode = await region()
    fireEvent.click(await within(panelNode).findByRole('button', { name: '정책 등록' }))
    const form = await within(panelNode).findByRole('group', { name: '정책 등록' })
    fill(form, /검증 회차/, PERF)
    fill(form, /계정당 최대 수량/, '2')
    fill(form, /^정책 버전/, 'synthetic-r1')
    fill(form, /적용 시작/, '2026-11-01T00:00')
    fill(form, /정책 출처/, 'synthetic source')
    fill(form, /확인 근거/, 'synthetic basis')
    fireEvent.click(within(form).getByRole('button', { name: '정책 저장' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ performanceId: PERF, maxTicketsPerAccount: 2, policyVersion: 'synthetic-r1', effectiveFrom: '2026-11-01T00:00:00', effectiveUntil: null, policySource: 'synthetic source', verificationBasis: 'synthetic basis', limitSubject: null, applicationScope: null, salesPhaseRef: null, cancellationRefundRule: null, includesPresale: null })
    expect(await within(panelNode).findByText('구매 한도 정책을 등록했습니다.')).toBeInTheDocument()
  })

  it('수량이나 필수 값이 없으면 보내지 않고 기본 한도를 넣지 않는다', async () => {
    const calls = stub(base(() => json(200, [])))
    open(route)
    const panelNode = await region()
    fireEvent.click(await within(panelNode).findByRole('button', { name: '정책 등록' }))
    const form = await within(panelNode).findByRole('group', { name: '정책 등록' })
    expect((within(form).getByLabelText(/계정당 최대 수량/) as HTMLInputElement).value).toBe('')
    fireEvent.click(within(form).getByRole('button', { name: '정책 저장' }))
    expect(await within(form).findByText(/기본 한도는 없습니다/)).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('수정은 expectedRevision을 PATCH로 보내고 같은 버전은 막는다', async () => {
    const calls = stub(base(() => json(200, [policy({ revision: 3 })]), { [`PATCH ${POLICY}/${POLICY_1}`]: () => json(200, policy({ revision: 4, policyVersion: 'synthetic-r2' })) }))
    open(route)
    const panelNode = await region()
    fireEvent.click(await within(panelNode).findByRole('button', { name: '수정' }))
    const form = await within(panelNode).findByRole('group', { name: '정책 수정' })
    fill(form, /새 정책 버전/, 'synthetic-r1')
    fireEvent.click(within(form).getByRole('button', { name: '수정 저장' }))
    expect(await within(form).findByText(/새 정책 버전을 입력해야/)).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
    fill(form, /새 정책 버전/, 'synthetic-r2')
    fireEvent.click(within(form).getByRole('button', { name: '수정 저장' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({ expectedRevision: 3, policyVersion: 'synthetic-r2', limitSubject: 'ACCOUNT', includesPresale: true })
    expect(calls.find((call) => call.method === 'PATCH')?.headers['Idempotency-Key']).toBeUndefined()
  })

  it('철회는 확인 뒤 expectedRevision으로 요청하고 충돌을 안내한다', async () => {
    const calls = stub(base(() => json(200, [policy({ revision: 5 })]), { [`POST ${POLICY}/${POLICY_1}/withdrawals`]: () => problem(409, 'PURCHASE_LIMIT_POLICY_REVISION_CONFLICT') }))
    open(route)
    const panelNode = await region()
    fireEvent.click(await within(panelNode).findByRole('button', { name: '철회' }))
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    fireEvent.click(await within(panelNode).findByRole('button', { name: '철회 확인' }))
    expect(await within(panelNode).findByText('다른 변경이 먼저 저장되었습니다')).toBeInTheDocument()
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ expectedRevision: 5 })
    expect(within(panelNode).queryByText(/secret-detail/)).not.toBeInTheDocument()
  })

  it('결과가 불확실한 쓰기는 다시 보내지 않고 목록 확인만 허용한다', async () => {
    const calls = stub(base(() => json(200, [policy()]), { [`POST ${POLICY}/${POLICY_1}/withdrawals`]: () => problem(500, 'INTERNAL_ERROR') }))
    open(route)
    const panelNode = await region()
    fireEvent.click(await within(panelNode).findByRole('button', { name: '철회' }))
    fireEvent.click(await within(panelNode).findByRole('button', { name: '철회 확인' }))
    fireEvent.click(await within(panelNode).findByRole('button', { name: '목록 다시 확인' }))
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.url === POLICY).length).toBeGreaterThan(1))
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('정책이 없으면 기본 한도를 표시하지 않는다', async () => {
    stub(base(() => json(200, [])))
    open(route)
    const panelNode = await region()
    expect(await within(panelNode).findByText('등록된 구매 한도 정책이 없습니다')).toBeInTheDocument()
    expect(within(panelNode).queryByText(/\d매/)).not.toBeInTheDocument()
  })

  it('API가 없는 서버의 404를 빈 정책으로 바꾸지 않는다', async () => {
    stub(base(() => problem(404, 'RESOURCE_NOT_FOUND')))
    open(route)
    const panelNode = await region()
    expect(await within(panelNode).findByText(/이 서버에 구매 한도 정책 API가 아직 없거나/)).toBeInTheDocument()
    expect(within(panelNode).queryByText('등록된 구매 한도 정책이 없습니다')).not.toBeInTheDocument()
  })

  it('403은 필요한 역할을 안내한다', async () => {
    stub(base(() => problem(403, 'ACCESS_DENIED')))
    open(route)
    expect(await within(await region()).findByText('구매 한도 정책을 조회하지 못했습니다')).toBeInTheDocument()
  })
})
