import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { buildLedgerImport } from '../features/admin-track1/quantityAnalysisApi'

// Backend Issue #81 PROPOSED 계약의 화면을 Mock 인증과 Mock fetch로 검증한다. 실제 Backend 연동 결과가 아니며 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT = '33333333-3333-4333-8333-333333333333'
const PERF = '77777777-7777-4777-8777-777777777771'
const BATCH = '88888888-8888-4888-8888-888888888881'
const RUN = '99999999-9999-4999-8999-999999999991'
const BASE = `/api/v1/admin/events/${EVENT}/track1-quantity`
const IMPORTS = `${BASE}/ledger-imports`
const RUNS = `${BASE}/analysis-runs`
const LIST_QUERY = '?page=0&pageSize=20'
const ROUTE = `/app/analysis/quantity?eventId=${EVENT}`
const VALID_ROW = 'syn-account,syn-res,syn-line-1,2026-11-02T10:00:00Z,1,TICKET,ACTIVE'

const adapter = () => ({
  availability: { status: 'ready' },
  initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}) satisfies AdminAuthAdapter

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code, detail: '내부 정보 secret-detail' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
const page = (items: unknown[]) => ({ items, page: 0, pageSize: 20, hasNext: false })
const events = { items: [{ id: EVENT, externalEventId: 'syn', name: '합성 공연' }], page: 0, pageSize: 100, totalItems: 1, hasNext: false }
const performance = { performanceId: PERF, eventId: EVENT, performanceRef: 'syn-perf', status: 'ACTIVE', revision: 1, sourceVersion: 'src', verifiedAt: '2026-11-01T00:00:00Z', withdrawnAt: null }
const batch = (overrides = {}) => ({ batchId: BATCH, eventId: EVENT, performanceId: PERF, sourceVersion: 'syn-ledger-1', sourceAsOf: '2026-11-08T10:00:00Z', ledgerVersion: 1, status: 'ACCEPTED', inputRowCount: 1, acceptedRowCount: 1, rejectedRowCount: 0, errors: [], completedAt: '2026-11-08T10:01:00Z', ...overrides })
const run = (overrides = {}) => ({ runId: RUN, eventId: EVENT, performanceId: PERF, ledgerBatchId: BATCH, sourceVersion: 'syn-ledger-1', executionStatus: 'SUCCEEDED', failureCode: null, retryable: false, policyId: null, policyVersion: 'r1', algorithmVersion: 'gds-2.6.6;projection-v2-account;score-v2-exp1', analysisRequestId: 'a1', clusterCount: 1, evaluation: { status: 'EVALUATED', policyVersion: 'r1', findings: [] }, requestedAt: '2026-11-08T10:02:00Z', completedAt: '2026-11-08T10:03:00Z', ...overrides })

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }
type Handler = (count: number) => Response

function stub(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const merged: Record<string, Handler> = {
    'GET /api/v1/admin/events?page=0&pageSize=100': () => json(200, events),
    [`GET /api/v1/admin/events/${EVENT}/verified-performances`]: () => json(200, [performance]),
    [`GET ${IMPORTS}${LIST_QUERY}`]: () => json(200, page([])),
    [`GET ${RUNS}${LIST_QUERY}`]: () => json(200, page([])),
    ...routes,
  }
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const key = `${call.method} ${call.url}`
    counts[key] = (counts[key] ?? 0) + 1
    return merged[key]?.(counts[key]) ?? problem(404, 'RESOURCE_NOT_FOUND')
  }))
  return calls
}

const open = () => render(<MemoryRouter initialEntries={[ROUTE]}><App adminAuthAdapter={adapter()} /></MemoryRouter>)
const region = (name: string) => screen.findByRole('region', { name })

beforeEach(() => vi.stubEnv('VITE_SYNTHETIC_RESERVATION_IMPORT_UI', 'true'))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('구매 수량 분석', () => {
  it.each([[403, 'ACCESS_DENIED'], [404, 'RESOURCE_NOT_FOUND']])('API가 없는 서버의 %i은 BLOCKED로 표시하고 0건이나 입력 화면을 만들지 않는다', async (status, code) => {
    stub({ [`GET ${IMPORTS}${LIST_QUERY}`]: () => problem(status, code) })
    open()
    const node = await region('구매 수량 분석 사용 불가')
    expect(within(node).getByText(/Backend Issue #81 API가 이 서버에 아직 배포되지 않았습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '구매 수량 원장 반입' })).not.toBeInTheDocument()
    expect(screen.queryByText('반입된 원장이 없습니다')).not.toBeInTheDocument()
  })

  it('503은 장애로 표시하고 빈 결과로 바꾸지 않는다', async () => {
    stub({ [`GET ${IMPORTS}${LIST_QUERY}`]: () => problem(503, 'DEPENDENCY_UNAVAILABLE') })
    open()
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.queryByText('반입된 원장이 없습니다')).not.toBeInTheDocument()
  })

  it('입력한 행을 멱등 키와 함께 그대로 보내고 수락 후 입력을 지운다', async () => {
    const calls = stub({ [`POST ${IMPORTS}`]: () => json(201, batch()) })
    open()
    const form = await region('구매 수량 원장 반입')
    await waitFor(() => expect(within(form).getByRole('option', { name: 'syn-perf' })).toBeInTheDocument())
    fireEvent.change(within(form).getByLabelText(/검증 회차/), { target: { value: PERF } })
    fireEvent.change(within(form).getByLabelText(/원장 버전/), { target: { value: 'syn-ledger-1' } })
    fireEvent.change(within(form).getByLabelText(/데이터 기준시각/), { target: { value: '2026-11-08T10:00:00Z' } })
    fireEvent.change(within(form).getByLabelText(/수량 산정 기준/), { target: { value: 'syn-basis' } })
    const rows = within(form).getByLabelText(/티켓 또는 주문 라인 행/) as HTMLTextAreaElement
    rows.value = VALID_ROW
    fireEvent.click(within(form).getByRole('button', { name: '원장 반입' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    const post = calls.find((call) => call.method === 'POST')!
    expect(post.body).toEqual({ performanceId: PERF, inputType: 'INDIVIDUAL_TICKET', sourceVersion: 'syn-ledger-1', sourceAsOf: '2026-11-08T10:00:00Z', quantityBasis: 'syn-basis', rows: [{ accountReference: 'syn-account', reservationReference: 'syn-res', ticketReference: 'syn-line-1', purchasedAt: '2026-11-02T10:00:00Z', quantity: 1, quantityUnit: 'TICKET', ticketStatus: 'ACTIVE' }] })
    expect(post.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    await waitFor(() => expect(rows.value).toBe(''))
    await waitFor(() => expect(calls.filter((call) => call.url === `${IMPORTS}${LIST_QUERY}`).length).toBeGreaterThan(1))
  })

  it('수락된 배치로 분석을 요청한다', async () => {
    const calls = stub({ [`GET ${IMPORTS}${LIST_QUERY}`]: () => json(200, page([batch()])), [`POST ${RUNS}`]: () => json(202, run({ executionStatus: 'QUEUED', evaluation: null, clusterCount: null, completedAt: null })) })
    open()
    const form = await region('Louvain과 구매 한도 분석 실행')
    fireEvent.click(await within(form).findByRole('button', { name: '분석 실행' }))
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ performanceId: PERF, ledgerBatchId: BATCH })
  })

  it('거부된 배치만 있으면 분석을 요청할 수 없고 행 오류를 보여 준다', async () => {
    stub({ [`GET ${IMPORTS}${LIST_QUERY}`]: () => json(200, page([batch({ status: 'REJECTED', acceptedRowCount: 0, rejectedRowCount: 1, errors: [{ rowIndex: 0, code: 'DUPLICATE_TICKET_REFERENCE' }, { rowIndex: null, code: 'NEW_CODE' }] })])) })
    open()
    expect(await within(await region('원장 반입 이력')).findByText(/같은 티켓 또는 주문 라인 참조가 중복/)).toBeInTheDocument()
    expect(within(await region('원장 반입 이력')).getByText(/알 수 없는 서버 사유 \(NEW_CODE\)/)).toBeInTheDocument()
    expect(within(await region('Louvain과 구매 한도 분석 실행')).queryByRole('button', { name: '분석 실행' })).not.toBeInTheDocument()
  })

  it('한도 초과는 조사 신호로 표시하고 예매별 수량을 함께 보여 준다', async () => {
    stub({ [`GET ${RUNS}${LIST_QUERY}`]: () => json(200, page([run({ evaluation: { status: 'EVALUATED', policyVersion: 'r1', findings: [{ accountToken: 'tok-account-123456', effectiveTicketQuantity: 3, maxTicketsPerAccount: 2, policyVersion: 'r1', reservationQuantities: [{ reservationToken: 'tok-res-1234567', effectiveTicketQuantity: 3 }] }] } })])) })
    open()
    const node = await region('분석 실행 결과')
    expect(await within(node).findByText(/유효 3매, 한도 2매/)).toBeInTheDocument()
    expect(within(node).getByText(/위반 확정이나 자동 제재 근거가 아닙니다/)).toBeInTheDocument()
  })

  it.each([
    ['POLICY_NOT_CONFIRMED', /정책 미확인/],
    ['QUANTITY_DATA_INCOMPLETE', /수량 자료 불완전/],
    ['POLICY_TIME_NOT_APPLICABLE', /정책 기간 불일치/],
  ])('%s는 초과 없음으로 표시하지 않는다', async (status, label) => {
    stub({ [`GET ${RUNS}${LIST_QUERY}`]: () => json(200, page([run({ evaluation: { status, policyVersion: null, findings: [] } })])) })
    open()
    const node = await region('분석 실행 결과')
    expect(await within(node).findByText(label, { selector: 'strong' })).toBeInTheDocument()
    expect(within(node).queryByText('이 정책 기준의 계정별 한도 초과 신호가 없습니다.')).not.toBeInTheDocument()
  })

  it('분석 실패는 실패로 표시하고 결과를 만들지 않는다', async () => {
    stub({ [`GET ${RUNS}${LIST_QUERY}`]: () => json(200, page([run({ executionStatus: 'FAILED', failureCode: 'ANALYSIS_UNAVAILABLE', retryable: true, evaluation: null, clusterCount: null })])) })
    open()
    const node = await region('분석 실행 결과')
    expect(await within(node).findByText(/분석에 실패했습니다 \(ANALYSIS_UNAVAILABLE\)/)).toBeInTheDocument()
    expect(within(node).queryByText(/구매 한도 평가/)).not.toBeInTheDocument()
  })

  it('성공인데 평가가 없는 응답은 계약 위반으로 표시한다', async () => {
    stub({ [`GET ${RUNS}${LIST_QUERY}`]: () => json(200, page([run({ evaluation: null })])) })
    open()
    const node = await region('분석 실행 결과')
    await waitFor(() => expect(within(node).queryByText('분석 실행을 불러오는 중')).not.toBeInTheDocument())
    expect(within(node).getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})

describe('수량 원장 입력 해석', () => {
  const form = { performanceId: PERF, sourceVersion: 'v', sourceAsOf: '2026-11-08T10:00:00Z', quantityBasis: 'b' }

  it('같은 예매의 여러 라인을 각각 유지한다', () => {
    const built = buildLedgerImport({ ...form, rowsText: `${VALID_ROW}\nsyn-account,syn-res,syn-line-2,2026-11-02T10:00:00Z,2,ORDER_LINE,ACTIVE` })
    expect(built.ok && built.body.rows.map((row) => [row.ticketReference, row.quantity, row.quantityUnit])).toEqual([['syn-line-1', 1, 'TICKET'], ['syn-line-2', 2, 'ORDER_LINE']])
  })

  it.each([
    ['시간대 없는 구매시각', 'a,r,l,2026-11-02T10:00:00,1,TICKET,ACTIVE'],
    ['수량 0', 'a,r,l,2026-11-02T10:00:00Z,0,TICKET,ACTIVE'],
    ['알 수 없는 상태', 'a,r,l,2026-11-02T10:00:00Z,1,TICKET,VALID'],
    ['알 수 없는 단위', 'a,r,l,2026-11-02T10:00:00Z,1,SEAT,ACTIVE'],
    ['빠진 값', 'a,r,l,2026-11-02T10:00:00Z,1,TICKET'],
  ])('%s은 보내지 않고 입력 값을 오류에 넣지 않는다', (_name, rowsText) => {
    const built = buildLedgerImport({ ...form, rowsText })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(JSON.stringify(built.errors)).not.toContain('2026-11-02')
  })
})
