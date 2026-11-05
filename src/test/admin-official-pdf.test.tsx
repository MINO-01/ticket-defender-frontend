import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import {
  eligibilityPath, eligibilitySchema, issuanceDetailPath, issuanceDownloadPath, issuanceHistoryPath, issuanceRequestPath, issuanceRetryPath, issuanceSchema,
} from '../features/admin-reports/officialPdfApi'

// Issue #35 공식 PDF 적격성, 발급, 상태, 재시도, 이력, 다운로드 화면을 Mock 인증 어댑터와 fetch로 검증한다.
// 요청과 응답 형식은 Backend main 17c832b의 case-w09-official-pdf-v1.yaml, OfficialPdfDto, OfficialPdfIssuanceService를 따른다.
// 실제 Keycloak, Spring, MySQL, MinIO 연동은 이 테스트로 대체하지 않는다. 모든 값과 PDF 바이트는 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const DECISION_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const REQUEST_1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const REPORT_VERSION_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const ISSUANCE_1 = '99999999-9999-4999-8999-999999999991'
const ARTIFACT_1 = '88888888-8888-4888-8888-888888888881'
const TEMPLATE_SHA = 'd'.repeat(64)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n% 합성 공식 PDF 바이트\n1 0 obj << >> endobj\n%%EOF\n')
const PDF_SHA = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', PDF_BYTES)), (value) => value.toString(16).padStart(2, '0')).join('')

function createMockAdapter() {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 86_400_000 })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={createMockAdapter()} /><LocationProbe /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// 계약에 없는 detail에 내부 정보가 섞여 와도 화면에 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ title: 'Problem', status, code, detail: '내부 객체 키 official-pdf/secret-key' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

function pdf(bytes: Uint8Array = PDF_BYTES, contentType = 'application/pdf') {
  return new Response(bytes.slice(), { status: 200, headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="official-case-report-${ARTIFACT_1}.pdf"` } })
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
    const call: Call = { method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body }
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

function eligibility(state = 'CURRENT', code = 'CURRENT') {
  return { approvalDecisionId: DECISION_1, reportVersionId: REPORT_VERSION_1, state, code }
}

function issuance(overrides: Record<string, unknown> = {}) {
  return {
    officialPdfIssuanceId: ISSUANCE_1, approvalDecisionId: DECISION_1, approvalRequestId: REQUEST_1, reportVersionId: REPORT_VERSION_1, reportRevision: 1,
    status: 'RESERVED', eligibility: 'CURRENT', eligibilityCode: 'CURRENT', officialTemplateVersion: 'official-case-pdf-v1', officialTemplateSha256: TEMPLATE_SHA,
    pdfSha256: null, pdfSize: null, requestedAt: '2026-11-05T01:00:00Z', completedAt: null, lastFailureCode: null, artifactId: null, ...overrides,
  }
}

const generated = (overrides: Record<string, unknown> = {}) => issuance({ status: 'GENERATED', pdfSha256: PDF_SHA, pdfSize: PDF_BYTES.byteLength, completedAt: '2026-11-05T01:00:05Z', artifactId: ARTIFACT_1, ...overrides })

const eligibilityUrl = eligibilityPath(DECISION_1)
const requestUrl = issuanceRequestPath(DECISION_1)
const historyUrl = issuanceHistoryPath(REPORT_VERSION_1)
const detailUrl = issuanceDetailPath(ISSUANCE_1)
const retryUrl = issuanceRetryPath(ISSUANCE_1)
const downloadUrl = issuanceDownloadPath(ISSUANCE_1)
const pageRoute = `/app/report-center/decisions/${DECISION_1}`

function routes(extra: Record<string, Handler> = {}, history: unknown[] = []): Record<string, Handler> {
  return { [`GET ${eligibilityUrl}`]: () => json(200, eligibility()), [`GET ${historyUrl}`]: () => json(200, history), ...extra }
}

async function openPage() {
  return screen.findByRole('region', { name: '공식 PDF 발급' })
}

function expectNoPdfPersisted() {
  for (const storage of [localStorage, sessionStorage]) expect(storage.length).toBe(0)
  expect(document.body.innerHTML).not.toContain('secret-key')
  expect(document.body.innerHTML).not.toContain('blob:')
}

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let anchorClicks: { href: string; download: string }[]

beforeEach(() => {
  anchorClicks = []
  createObjectURL = vi.fn(() => 'blob:synthetic-official-pdf')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    anchorClicks.push({ href: this.href, download: this.download })
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('계약 스키마', () => {
  it('적격성과 발급 응답은 서버 계약의 상태와 코드 형식만 받는다', () => {
    expect(eligibilitySchema.safeParse(eligibility()).success).toBe(true)
    expect(eligibilitySchema.safeParse(eligibility('APPROVED')).success).toBe(false)
    expect(eligibilitySchema.safeParse(eligibility('BLOCKED', '<b>x</b>')).success).toBe(false)
    expect(issuanceSchema.safeParse(generated()).success).toBe(true)
    expect(issuanceSchema.safeParse(issuance({ status: 'SUPERSEDED' })).success).toBe(false)
    expect(issuanceSchema.safeParse(issuance({ pdfSha256: 'A'.repeat(64) })).success).toBe(false)
  })
})

describe('보고서 센터 진입', () => {
  it('결정 조회 API가 없음을 알리고 UUID 결정 ID로만 발급 화면을 연다', async () => {
    stubFetch(routes())
    renderApp('/app/report-center')
    const region = await screen.findByRole('region', { name: '승인 결정 ID 입력' })
    expect(within(region).getByText(/승인 결정을 조회하는 API가 없어/)).toBeInTheDocument()
    fireEvent.change(within(region).getByRole('textbox', { name: /승인 결정 ID/ }), { target: { value: 'not-a-uuid' } })
    fireEvent.click(within(region).getByRole('button', { name: '발급 화면 열기' }))
    expect(within(region).getByText('승인 결정 ID를 UUID 형식으로 입력해 주세요.')).toBeInTheDocument()
    fireEvent.change(within(region).getByRole('textbox', { name: /승인 결정 ID/ }), { target: { value: ` ${DECISION_1.toUpperCase()} ` } })
    fireEvent.click(within(region).getByRole('button', { name: '발급 화면 열기' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(pageRoute))
    await openPage()
  })

  it('주소의 결정 ID가 UUID가 아니면 API를 호출하지 않는다', async () => {
    const calls = stubFetch({})
    renderApp('/app/report-center/decisions/not-a-uuid')
    expect(await screen.findByText('승인 결정 ID가 올바르지 않습니다')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})

describe('발급 적격성', () => {
  it.each([
    ['STALE', 'APPROVAL_BASIS_STALE', '승인 이후 근거가 바뀌었습니다'],
    ['BLOCKED', 'ISSUANCE_HOLD_ACTIVE', '발급 보류(IssuanceHold)가 걸려 있습니다'],
    ['BLOCKED', 'OFFICIAL_PDF_SYNTHETIC_SCOPE_UNVERIFIED', '합성 데이터 범위를 확인하지 못했습니다'],
    ['BLOCKED', 'OFFICIAL_PDF_OPERATION_NOT_APPROVED', '운영 발급은 승인되지 않았습니다'],
    ['BLOCKED', 'APPROVAL_NOT_CURRENT', '현재 유효한 승인 결정이 아닙니다'],
  ])('서버 적격성이 %s %s이면 발급 요청을 열지 않는다', async (state, code, title) => {
    const calls = stubFetch(routes({ [`GET ${eligibilityUrl}`]: () => json(200, eligibility(state, code)) }))
    renderApp(pageRoute)
    const region = await openPage()
    const facts = await within(region).findByRole('region', { name: '서버 발급 적격성' })
    expect(within(facts).getByText(state === 'STALE' ? '근거 변경 (STALE)' : '차단 (BLOCKED)')).toBeInTheDocument()
    expect(within(facts).getByText(title, { exact: false })).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '공식 PDF 발급 요청' })).not.toBeInTheDocument()
    expect(posts(calls, requestUrl)).toHaveLength(0)
  })

  it('이력 조회가 합성 격리 게이트로 409이면 기록 없음으로 보지 않고 발급을 막는다', async () => {
    const calls = stubFetch(routes({ [`GET ${historyUrl}`]: () => problem(409, 'OFFICIAL_PDF_SYNTHETIC_SCOPE_UNVERIFIED') }))
    renderApp(pageRoute)
    const region = await openPage()
    expect(await within(region).findByText('발급 이력을 확인하지 못했습니다', { exact: false })).toBeInTheDocument()
    expect(within(region).getByText(/합성 데이터 범위를 확인하지 못했습니다/)).toBeInTheDocument()
    expect(within(region).getByText(/발급 기록이 없다고 간주하지 않습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '공식 PDF 발급 요청' })).not.toBeInTheDocument()
    expect(posts(calls, requestUrl)).toHaveLength(0)
    expect(document.body.innerHTML).not.toContain('secret-key')
  })

  it.each([
    [403, '이 화면에 필요한 역할이 없습니다', /TENANT_ADMIN/],
    [404, '승인 결정을 찾을 수 없거나 접근 범위 밖입니다', /구분해 안내하지 않습니다/],
  ])('적격성 %s 응답은 권한과 범위 밖을 구분해 안내하고 이력을 조회하지 않는다', async (status, title, detail) => {
    const calls = stubFetch(routes({ [`GET ${eligibilityUrl}`]: () => new Response(null, { status }) }))
    renderApp(pageRoute)
    const region = await openPage()
    expect(await within(region).findByText(title)).toBeInTheDocument()
    expect(within(region).getByText(detail)).toBeInTheDocument()
    expect(gets(calls, historyUrl)).toHaveLength(0)
  })

  it('다른 결정의 적격성 응답은 신뢰하지 않는다', async () => {
    const calls = stubFetch(routes({ [`GET ${eligibilityUrl}`]: () => json(200, { ...eligibility(), approvalDecisionId: ISSUANCE_1 }) }))
    renderApp(pageRoute)
    const region = await openPage()
    expect(await within(region).findByText('서버 응답 형식이 계약과 다릅니다')).toBeInTheDocument()
    expect(gets(calls, historyUrl)).toHaveLength(0)
  })
})

describe('공식 PDF 발급 요청', () => {
  it('중복 클릭은 한 번만 보내고 HTTP 202 RESERVED를 완료로 표시하지 않는다', async () => {
    const calls = stubFetch(routes({ [`POST ${requestUrl}`]: () => json(202, issuance()) }))
    renderApp(pageRoute)
    const region = await openPage()
    const button = await within(region).findByRole('button', { name: '공식 PDF 발급 요청' })
    fireEvent.click(button)
    fireEvent.click(button)
    const state = await within(region).findByRole('region', { name: '발급 상태' })
    expect(within(state).getByText('예약됨 (RESERVED)')).toBeInTheDocument()
    expect(within(region).getByText(/HTTP 202는 요청 접수이며 발급 완료가 아닙니다/)).toBeInTheDocument()
    expect(within(region).queryByText('생성 완료 (GENERATED)')).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '공식 PDF 다운로드' })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '실패한 발급 재시도' })).not.toBeInTheDocument()
    expect(within(region).getByRole('button', { name: '상태 다시 조회' })).toBeInTheDocument()
    const sent = posts(calls, requestUrl)
    expect(sent).toHaveLength(1)
    expect(sent[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(sent[0].body).toBeUndefined()
    // 발급 기록이 생긴 뒤에는 새 발급 요청을 열지 않는다.
    expect(within(region).queryByRole('button', { name: '공식 PDF 발급 요청' })).not.toBeInTheDocument()
  })

  it('202 응답의 GENERATED만 생성 완료로 표시하고 다운로드를 연다', async () => {
    stubFetch(routes({ [`POST ${requestUrl}`]: () => json(202, generated()) }))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 발급 요청' }))
    const state = await within(region).findByRole('region', { name: '발급 상태' })
    expect(within(state).getByText('생성 완료 (GENERATED)')).toBeInTheDocument()
    expect(within(state).getByText(PDF_SHA)).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: '공식 PDF 다운로드' })).toBeEnabled()
    expect(document.body.textContent).not.toMatch(/부정 거래 확정|불법 거래 확정|자동 제재를/)
  })

  it.each([
    ['FAILED', { lastFailureCode: 'PDF_PROCESSING_FAILED', eligibility: 'BLOCKED', eligibilityCode: 'PDF_PROCESSING_FAILED' }, 'PDF 생성 또는 저장이 실패했습니다'],
    ['STALE', { lastFailureCode: 'OFFICIAL_TEMPLATE_CHANGED', eligibility: 'STALE', eligibilityCode: 'OFFICIAL_TEMPLATE_CHANGED' }, '공식 PDF 템플릿이 바뀌었습니다'],
  ])('202 응답이 %s이면 실패 사유를 표시하고 다운로드를 열지 않는다', async (status, overrides, title) => {
    stubFetch(routes({ [`POST ${requestUrl}`]: () => json(202, issuance({ status, ...overrides })) }))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 발급 요청' }))
    const state = await within(region).findByRole('region', { name: '발급 상태' })
    expect(within(state).getByText(status === 'FAILED' ? '실패 (FAILED)' : '근거 변경으로 중단 (STALE)')).toBeInTheDocument()
    expect(within(state).getAllByText(title, { exact: false }).length).toBeGreaterThan(0)
    expect(within(region).queryByRole('button', { name: '공식 PDF 다운로드' })).not.toBeInTheDocument()
  })

  it('응답이 유실되면 결과 미확인으로 두고 같은 키와 빈 본문으로만 재확인한다', async () => {
    const calls = stubFetch(routes({ [`POST ${requestUrl}`]: (_call, count) => { if (count === 1) throw new TypeError('network'); return json(202, generated()) } }))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 발급 요청' }))
    expect(await within(region).findByText(/결과 미확인/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '공식 PDF 발급 요청' })).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '발급 요청 재확인' }))
    expect(await within(region).findByText('생성 완료 (GENERATED)')).toBeInTheDocument()
    const sent = posts(calls, requestUrl)
    expect(sent).toHaveLength(2)
    expect(sent[1].headers['Idempotency-Key']).toBe(sent[0].headers['Idempotency-Key'])
    expect(sent[1].body).toBeUndefined()
  })

  it('다른 결정의 202 응답은 성공으로 표시하지 않는다', async () => {
    stubFetch(routes({ [`POST ${requestUrl}`]: () => json(202, issuance({ approvalDecisionId: REQUEST_1 })) }))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 발급 요청' }))
    expect(await within(region).findByText(/서버 응답이 요청과 맞지 않습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('region', { name: '발급 상태' })).not.toBeInTheDocument()
  })

  it.each([
    [409, 'ISSUANCE_HOLD_ACTIVE', '발급 보류(IssuanceHold)가 걸려 있습니다'],
    [409, 'OFFICIAL_PDF_SYNTHETIC_SCOPE_UNVERIFIED', '합성 데이터 범위를 확인하지 못했습니다'],
    [422, 'APPROVAL_BASIS_BLOCKED', '증거 보존이나 무결성을 확인하지 못했습니다'],
    [409, 'OFFICIAL_PDF_ISSUANCE_CONFLICT', '다른 발급 요청이 먼저 기록되었습니다'],
  ])('발급 요청 %s %s는 거부로 안내하고 적격성과 이력을 다시 조회한다', async (status, code, title) => {
    const calls = stubFetch(routes({ [`POST ${requestUrl}`]: () => problem(status, code) }))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 발급 요청' }))
    expect(await within(region).findByText(`요청 거부: ${title}`, { exact: false })).toBeInTheDocument()
    // 이력은 적격성 응답의 보고서 버전 ID로 이어서 조회한다.
    await waitFor(() => expect(gets(calls, historyUrl).length).toBeGreaterThanOrEqual(2))
    expect(gets(calls, eligibilityUrl).length).toBeGreaterThanOrEqual(2)
    expect(document.body.innerHTML).not.toContain('secret-key')
  })

  it('발급 요청 403은 TENANT_ADMIN 역할이 필요하다고 안내한다', async () => {
    stubFetch(routes({ [`POST ${requestUrl}`]: () => new Response(null, { status: 403 }) }))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 발급 요청' }))
    expect(await within(region).findByText(/공식 PDF 발급 요청에 필요한 역할이 없습니다/)).toBeInTheDocument()
    expect(within(region).getByText(/승인 담당\(APPROVER\) 역할만으로는 발급할 수 없습니다/)).toBeInTheDocument()
  })
})

describe('이력과 상태 재조회', () => {
  it('기존 발급 기록이 있으면 새 요청 대신 현재 기록과 보고서별 이력을 보여 준다', async () => {
    const other = issuance({ officialPdfIssuanceId: '99999999-9999-4999-8999-999999999992', approvalDecisionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', status: 'FAILED' })
    const calls = stubFetch(routes({}, [generated(), other]))
    renderApp(pageRoute)
    const region = await openPage()
    expect(await within(region).findByText(/이 승인 결정의 발급 기록이 이미 있습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '공식 PDF 발급 요청' })).not.toBeInTheDocument()
    const table = within(region).getByRole('table', { name: '보고서별 발급 이력' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText(ISSUANCE_1)).toBeInTheDocument()
    expect(posts(calls, requestUrl)).toHaveLength(0)
  })

  it.each(['RESERVED', 'RENDERING', 'OBJECT_STORED'])('%s 진행 상태에는 재시도 없이 상태 재조회만 제공하고 상세 GET으로 갱신한다', async (status) => {
    const calls = stubFetch(routes({ [`GET ${detailUrl}`]: () => json(200, generated()) }, [issuance({ status })]))
    renderApp(pageRoute)
    const region = await openPage()
    const state = await within(region).findByRole('region', { name: '발급 상태' })
    expect(within(state).getByText(/아직 완료가 아닙니다|아직 PDF가 생성되지 않았습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '실패한 발급 재시도' })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '공식 PDF 다운로드' })).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '상태 다시 조회' }))
    expect(await within(region).findByText('생성 완료 (GENERATED)', { selector: 'dd' })).toBeInTheDocument()
    expect(gets(calls, detailUrl)).toHaveLength(1)
    expect(posts(calls, retryUrl)).toHaveLength(0)
  })

  it('상태 재조회 응답이 다른 발급 기록이면 표시하지 않는다', async () => {
    stubFetch(routes({ [`GET ${detailUrl}`]: () => json(200, generated({ approvalDecisionId: REQUEST_1 })) }, [issuance({ status: 'RENDERING' })]))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '상태 다시 조회' }))
    expect(await within(region).findByText(/상태를 다시 조회하지 못했습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '공식 PDF 다운로드' })).not.toBeInTheDocument()
  })
})

describe('실패한 발급 재시도', () => {
  const failed = issuance({ status: 'FAILED', lastFailureCode: 'PDF_PROCESSING_FAILED' })

  it('FAILED이고 서버 적격성이 CURRENT일 때만 명시적 재시도를 보내고 결과 상태를 해석한다', async () => {
    const calls = stubFetch(routes({ [`POST ${retryUrl}`]: () => json(202, generated()) }, [failed]))
    renderApp(pageRoute)
    const region = await openPage()
    const button = await within(region).findByRole('button', { name: '실패한 발급 재시도' })
    // 화면을 여는 것만으로 재시도를 보내지 않는다.
    expect(posts(calls, retryUrl)).toHaveLength(0)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await within(region).findByText('생성 완료 (GENERATED)', { selector: 'dd' })).toBeInTheDocument()
    const sent = posts(calls, retryUrl)
    expect(sent).toHaveLength(1)
    expect(sent[0].headers['Idempotency-Key']).toMatch(UUID_V4)
    expect(sent[0].body).toBeUndefined()
  })

  it.each([
    ['적격성 BLOCKED', { [`GET ${eligibilityUrl}`]: () => json(200, eligibility('BLOCKED', 'ISSUANCE_HOLD_ACTIVE')) }, [failed]],
    ['적격성 STALE', { [`GET ${eligibilityUrl}`]: () => json(200, eligibility('STALE', 'APPROVAL_BASIS_STALE')) }, [issuance({ status: 'STALE', eligibility: 'STALE', eligibilityCode: 'APPROVAL_BASIS_STALE' })]],
    ['기록의 현재 적격성 BLOCKED', {}, [issuance({ status: 'FAILED', eligibility: 'BLOCKED', eligibilityCode: 'ISSUANCE_HOLD_ACTIVE' })]],
    ['GENERATED', {}, [generated()]],
  ])('%s이면 재시도를 열지 않는다', async (_label, extra, history) => {
    const calls = stubFetch(routes(extra, history))
    renderApp(pageRoute)
    const region = await openPage()
    await within(region).findByRole('region', { name: '발급 상태' })
    expect(within(region).queryByRole('button', { name: '실패한 발급 재시도' })).not.toBeInTheDocument()
    expect(posts(calls, retryUrl)).toHaveLength(0)
  })

  it('진행 중 충돌 409 OFFICIAL_PDF_ISSUANCE_IN_PROGRESS를 실패와 구분해 안내한다', async () => {
    stubFetch(routes({ [`POST ${retryUrl}`]: () => problem(409, 'OFFICIAL_PDF_ISSUANCE_IN_PROGRESS') }, [failed]))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '실패한 발급 재시도' }))
    expect(await within(region).findByText(/요청 거부: 발급 작업이 이미 진행 중입니다/)).toBeInTheDocument()
    expect(within(region).queryByText(/결과 미확인/)).not.toBeInTheDocument()
  })

  it('재시도 응답이 유실되면 같은 키로만 재확인하고 그동안 새 재시도를 막는다', async () => {
    const calls = stubFetch(routes({ [`POST ${retryUrl}`]: (_call, count) => (count === 1 ? problem(503, 'OFFICIAL_PDF_OBJECT_UNAVAILABLE') : json(202, generated())) }, [failed]))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '실패한 발급 재시도' }))
    expect(await within(region).findByText(/결과 미확인: PDF 저장소에서 객체를 확인하지 못했습니다/)).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: '실패한 발급 재시도' })).not.toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: '재시도 재확인' }))
    expect(await within(region).findByText('생성 완료 (GENERATED)', { selector: 'dd' })).toBeInTheDocument()
    const sent = posts(calls, retryUrl)
    expect(sent).toHaveLength(2)
    expect(sent[1].headers['Idempotency-Key']).toBe(sent[0].headers['Idempotency-Key'])
  })

  it('네트워크 유실 뒤 재확인이 끝나면 상태 다시 조회를 다시 쓸 수 있다', async () => {
    const calls = stubFetch(routes({
      [`POST ${retryUrl}`]: (_call, count) => { if (count === 1) throw new TypeError('network'); return json(202, failed) },
      [`GET ${detailUrl}`]: () => json(200, failed),
    }, [failed]))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '실패한 발급 재시도' }))
    fireEvent.click(await within(region).findByRole('button', { name: '재시도 재확인' }))
    expect(await within(region).findByText(/서버가 요청을 접수했습니다/)).toBeInTheDocument()
    const recheck = await within(region).findByRole('button', { name: '상태 다시 조회' })
    await waitFor(() => expect(recheck).toBeEnabled())
    fireEvent.click(recheck)
    await waitFor(() => expect(gets(calls, detailUrl)).toHaveLength(1))
  })
})

describe('공식 PDF 다운로드', () => {
  function downloadRoutes(download: Handler, detail: Handler = () => json(200, generated())) {
    return routes({ [`GET ${detailUrl}`]: detail, [`GET ${downloadUrl}`]: download }, [generated()])
  }

  it('상세를 다시 확인한 뒤 Bearer로 받은 바이트의 크기와 SHA-256이 맞을 때만 임시 URL로 내려받고 나중에 해제한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    const calls = stubFetch(downloadRoutes(() => pdf()))
    renderApp(pageRoute)
    const region = await openPage()
    const button = await within(region).findByRole('button', { name: '공식 PDF 다운로드' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await within(region).findByText(/공식 PDF를 내려받았습니다/)).toBeInTheDocument()
    expect(gets(calls, downloadUrl)).toHaveLength(1)
    expect(gets(calls, detailUrl)).toHaveLength(1)
    expect(gets(calls, downloadUrl)[0].headers.Authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`)
    expect(calls.findIndex((call) => call.url === detailUrl)).toBeLessThan(calls.findIndex((call) => call.url === downloadUrl))
    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBe(PDF_BYTES.byteLength)
    expect(anchorClicks).toEqual([{ href: 'blob:synthetic-official-pdf', download: `official-case-report-${ARTIFACT_1}.pdf` }])
    // 클릭 직후 동기 해제하지 않고 다운로드가 시작될 시간을 둔 뒤 해제한다.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-official-pdf')
    expectNoPdfPersisted()
  })

  it('화면을 떠나면 해제하지 않은 임시 URL을 정리한다', async () => {
    stubFetch(downloadRoutes(() => pdf()))
    const view = renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 다운로드' }))
    await within(region).findByText(/공식 PDF를 내려받았습니다/)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-official-pdf')
  })

  it.each([
    ['SHA-256 불일치', () => pdf(), () => json(200, generated({ pdfSha256: 'f'.repeat(64) })), '내려받은 PDF가 서버 기록과 다릅니다'],
    ['크기 불일치', () => pdf(), () => json(200, generated({ pdfSize: PDF_BYTES.byteLength + 1 })), '내려받은 PDF가 서버 기록과 다릅니다'],
    ['잘못된 Content-Type', () => pdf(PDF_BYTES, 'application/json'), undefined, 'PDF 응답 형식을 확인하지 못했습니다'],
    ['손상 PDF', () => pdf(new TextEncoder().encode('<html>login</html>')), undefined, 'PDF 응답 형식을 확인하지 못했습니다'],
    ['409 미생성', () => problem(409, 'OFFICIAL_PDF_NOT_GENERATED'), undefined, '아직 생성된 공식 PDF가 없습니다'],
    ['409 합성 범위', () => problem(409, 'OFFICIAL_PDF_SYNTHETIC_SCOPE_UNVERIFIED'), undefined, '합성 데이터 범위를 확인하지 못했습니다'],
    ['503 저장소', () => problem(503, 'OFFICIAL_PDF_OBJECT_UNAVAILABLE'), undefined, 'PDF 저장소에서 객체를 확인하지 못했습니다'],
    ['403 역할', () => new Response(null, { status: 403 }), undefined, '공식 PDF 다운로드에 필요한 역할이 없습니다'],
    ['404 범위 밖', () => new Response(null, { status: 404 }), undefined, '발급 기록을 찾을 수 없거나 접근 범위 밖입니다'],
    ['상세가 GENERATED 아님', () => pdf(), () => json(200, issuance({ status: 'RENDERING' })), '아직 생성된 공식 PDF가 없습니다'],
  ])('%s이면 파일을 만들지 않고 안내한다', async (_label, download, detail, title) => {
    const calls = stubFetch(downloadRoutes(download, detail))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 다운로드' }))
    expect(await within(region).findByText(`다운로드 실패: ${title}`, { exact: false })).toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(anchorClicks).toHaveLength(0)
    if (title === '아직 생성된 공식 PDF가 없습니다' && detail !== undefined) expect(gets(calls, downloadUrl)).toHaveLength(0)
    expectNoPdfPersisted()
  })

  it('다운로드 중 인증이 만료되면 세션을 정리하고 파일을 만들지 않는다', async () => {
    stubFetch(downloadRoutes(() => new Response(null, { status: 401 })))
    renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 다운로드' }))
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '공식 PDF 발급' })).not.toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()
    expectNoPdfPersisted()
  })

  it('응답을 기다리는 중 화면을 떠나면 늦게 온 PDF로 파일을 만들지 않는다', async () => {
    const late = deferred()
    stubFetch(downloadRoutes(() => late.promise))
    const view = renderApp(pageRoute)
    const region = await openPage()
    fireEvent.click(await within(region).findByRole('button', { name: '공식 PDF 다운로드' }))
    await waitFor(() => expect(within(region).getByRole('button', { name: /다운로드 중/ })).toBeDisabled())
    view.unmount()
    await act(async () => { late.resolve(pdf()) })
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(anchorClicks).toHaveLength(0)
  })
})
