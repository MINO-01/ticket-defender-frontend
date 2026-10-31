import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { submitFanReport } from '../features/fan-report/fanReportApi'
import type { FanReportSubmission } from '../features/fan-report/fanReportApi'
import { getIntakeEvent } from '../features/fan-report/intakeConfig'
import { createIdempotencyKey, createRecoverySecret, createSubmissionRequest, toSubmission } from '../features/fan-report/submission'
import { initialReportDraft } from '../features/fan-report/reportModel'

// 모든 값은 합성 데이터다. 실제 공연, 접수번호, 개인정보를 사용하지 않는다.
const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const RECEIPT = {
  fanReportId: '11111111-1111-4111-8111-111111111111',
  receiptNumber: 'FR-SYNTHETIC-0001',
  lookupCode: 'SYNTHETIC-LOOKUP-CODE-0001',
  intakeStatus: 'RECEIVED',
  receivedAt: '2026-10-31T01:02:03.456Z',
}
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const secretPattern = /^[A-Za-z0-9_-]{43}$/

type Call = { url: string; headers: Record<string, string>; report: Record<string, unknown> | null; files: { name: string; size: number; type: string }[]; json: unknown }

let calls: Call[] = []
let locations: string[] = []

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function record(input: RequestInfo | URL, init?: RequestInit) {
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
  const call: Call = { url: String(input), headers, report: null, files: [], json: null }
  if (init?.body instanceof FormData) {
    const report = init.body.get('report') as Blob
    call.report = { __type: report.type, ...JSON.parse(await readBlob(report)) }
    call.files = (init.body.getAll('evidence') as File[]).map((file) => ({ name: file.name, size: file.size, type: file.type }))
  } else if (typeof init?.body === 'string') {
    call.json = JSON.parse(init.body)
  }
  calls.push(call)
}

function json(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } })
}

function problem(status: number, code: string) {
  return json(status, { type: 'about:blank', title: 'synthetic', status, code, requestId: 'req-1', detail: 'sensitive server detail' }, 'application/problem+json')
}

/** 응답 목록을 순서대로 반환하는 fetch 대역. Error를 넣으면 네트워크 실패로 처리한다. */
function mockFetch(...responses: (Response | Error | Promise<Response>)[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    await record(input, init)
    const next = responses.shift()
    if (!next) throw new Error('예상하지 않은 요청')
    if (next instanceof Error) throw next
    return next
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function LocationProbe() {
  const location = useLocation()
  locations.push(`${location.pathname}${location.search}${location.hash}${JSON.stringify(location.state ?? null)}`)
  return null
}

function renderRoute(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /><LocationProbe /></MemoryRouter>)
}

function image(name: string, size = 5) {
  return new File(['x'.repeat(size)], name, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' })
}

async function fillAndReview(files: File[] = [image('first.png', 5), image('second.jpg', 7)]) {
  renderRoute('/fan/write')
  fireEvent.change(screen.getByRole('combobox', { name: /공연 선택/ }), { target: { value: EVENT_ID } })
  fireEvent.change(screen.getByLabelText(/공연 일시 또는 회차/), { target: { value: '2026-11-01T19:30' } })
  fireEvent.click(screen.getByRole('radio', { name: '고액 재판매 정황' }))
  fireEvent.change(screen.getByRole('textbox', { name: /의심 거래 설명/ }), { target: { value: '  합성 데이터로 작성한 고액 재판매 게시글 관찰 내용입니다.  ' } })
  fireEvent.change(screen.getByLabelText(/좌석 구역/), { target: { value: 'VIP' } })
  fireEvent.change(screen.getByRole('textbox', { name: /제시된 판매 가격/ }), { target: { value: '450000' } })
  if (files.length) fireEvent.change(screen.getByLabelText('사진 선택하기'), { target: { files } })
  fireEvent.click(screen.getByRole('button', { name: '다음 단계: 최종 확인' }))
  expect(await screen.findByRole('heading', { name: '제보 내용 요약' })).toBeInTheDocument()
}

const consoleSpies: ReturnType<typeof vi.spyOn>[] = []

beforeEach(() => {
  calls = []
  locations = []
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) consoleSpies.push(vi.spyOn(console, method))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore())
})

function expectNoLeak(...secrets: string[]) {
  const logged = JSON.stringify(consoleSpies.map((spy) => spy.mock.calls))
  const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
  for (const secret of secrets) {
    expect(locations.join('\n')).not.toContain(secret)
    expect(window.location.href).not.toContain(secret)
    expect(logged).not.toContain(secret)
    expect(stored).not.toContain(secret)
  }
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
}

describe('팬 제보 API 클라이언트', () => {
  it('계약에 맞는 multipart report와 evidence를 전송하고 Authorization과 Content-Type을 지정하지 않는다', async () => {
    mockFetch(json(201, RECEIPT))
    const report: FanReportSubmission = { eventId: EVENT_ID, performanceAt: '2026-11-01T19:30:00', reportType: 'OTHER', description: '합성 데이터 설명 문장입니다. 스무 자 이상.' }
    const request = createSubmissionRequest(report, [image('a.png', 3), image('b.jpg', 4)])
    const result = await submitFanReport(request)
    expect(result).toEqual({ kind: 'success', status: 201, receipt: RECEIPT })
    const [call] = calls
    expect(call.url).toBe('/api/v1/fan-reports')
    expect(call.report).toEqual({ __type: 'application/json', ...report })
    expect(call.files).toEqual([{ name: 'a.png', size: 3, type: 'image/png' }, { name: 'b.jpg', size: 4, type: 'image/jpeg' }])
    expect(call.headers['Idempotency-Key']).toBe(request.idempotencyKey)
    expect(call.headers['Report-Recovery-Secret']).toBe(request.recoverySecret)
    expect(Object.keys(call.headers).map((key) => key.toLowerCase())).not.toContain('authorization')
    expect(Object.keys(call.headers).map((key) => key.toLowerCase())).not.toContain('content-type')
  })

  it('UUID v4 멱등성 키와 32바이트 Base64url 복구 비밀을 독립적으로 생성한다', () => {
    const keys = new Set(Array.from({ length: 20 }, createIdempotencyKey))
    const secrets = new Set(Array.from({ length: 20 }, createRecoverySecret))
    expect(keys.size).toBe(20)
    expect(secrets.size).toBe(20)
    keys.forEach((key) => expect(key).toMatch(uuidV4))
    secrets.forEach((secret) => {
      expect(secret).toMatch(secretPattern)
      expect(atob(secret.replace(/-/g, '+').replace(/_/g, '/') + '=')).toHaveLength(32)
    })
  })

  it('계약 필드만 담고 시연 공연은 변환하지 않으며 입력 스냅샷과 파일 순서를 고정한다', () => {
    const draft = { ...initialReportDraft, eventId: EVENT_ID, performanceAt: '2026-11-01T19:30', reportType: 'AUTOMATION_OFFER', description: ' 합성 데이터 설명 문장입니다. 스무 자 이상. ', askingPrice: '1000', seller: '  ' }
    const report = toSubmission(draft, EVENT_ID)
    expect(report).toEqual({ eventId: EVENT_ID, performanceAt: '2026-11-01T19:30:00', reportType: 'AUTOMATION_OFFER', description: '합성 데이터 설명 문장입니다. 스무 자 이상.' })
    expect(toSubmission({ ...draft, eventId: 'DEMO_AUTUMN_LIVE' }, EVENT_ID)).toBeNull()
    const files = [image('1.png'), image('2.png'), image('3.png')]
    const request = createSubmissionRequest(report!, files)
    files.reverse()
    files.pop()
    expect(request.evidence.map((file) => file.name)).toEqual(['1.png', '2.png', '3.png'])
    expect(Object.isFrozen(request.report)).toBe(true)
    expect(Object.isFrozen(request.evidence)).toBe(true)
  })

  it('설정된 공연 UUID만 허용한다', () => {
    expect(getIntakeEvent()).toBeNull()
    vi.stubEnv('VITE_FAN_REPORT_EVENT_ID', 'DEMO_AUTUMN_LIVE')
    expect(getIntakeEvent()).toBeNull()
    vi.stubEnv('VITE_FAN_REPORT_EVENT_ID', EVENT_ID)
    expect(getIntakeEvent()).toEqual({ eventId: EVENT_ID, label: '시연 환경 등록 공연' })
  })
})

describe('팬 제보 실제 제출 화면', () => {
  beforeEach(() => vi.stubEnv('VITE_FAN_REPORT_EVENT_ID', EVENT_ID))

  it('응답 유실 뒤 같은 키, 비밀, 입력, 파일 순서로 재시도하고 200 복구 결과를 표시한다', async () => {
    mockFetch(new TypeError('Failed to fetch'), json(200, RECEIPT))
    await fillAndReview()
    fireEvent.click(screen.getByRole('button', { name: '제보 제출하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('접수 결과를 확인하지 못했습니다')
    expect(screen.queryByText(RECEIPT.receiptNumber)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '내용 수정하기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }))
    expect(await screen.findByRole('heading', { name: '기존 접수를 확인했습니다' })).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    const [first, second] = calls
    expect(first.headers['Idempotency-Key']).toMatch(uuidV4)
    expect(first.headers['Report-Recovery-Secret']).toMatch(secretPattern)
    expect(second.headers).toEqual(first.headers)
    expect(second.report).toEqual(first.report)
    expect(second.files).toEqual(first.files)
    expect(first.report).toEqual({ __type: 'application/json', eventId: EVENT_ID, performanceAt: '2026-11-01T19:30:00', seatArea: 'VIP', reportType: 'PREMIUM_RESALE', description: '합성 데이터로 작성한 고액 재판매 게시글 관찰 내용입니다.', askingPrice: '450000' })
    expect(first.files.map((file) => file.name)).toEqual(['first.png', 'second.jpg'])
    expect(screen.getByText(RECEIPT.receiptNumber)).toBeInTheDocument()
    expect(screen.getByText(RECEIPT.lookupCode)).toBeInTheDocument()
    expectNoLeak(first.headers['Report-Recovery-Secret'], RECEIPT.lookupCode, '합성 데이터로 작성한')
  })

  it('201 신규 접수 시 접수번호와 조회 코드를 표시하고 보관 안내를 보여준다', async () => {
    mockFetch(json(201, RECEIPT))
    await fillAndReview([])
    fireEvent.click(screen.getByRole('button', { name: '제보 제출하기' }))
    expect(await screen.findByRole('heading', { name: '제보가 접수되었습니다' })).toBeInTheDocument()
    expect(screen.getByText(RECEIPT.receiptNumber)).toBeInTheDocument()
    expect(screen.getByText(RECEIPT.lookupCode)).toBeInTheDocument()
    expect(screen.getByText('접수됨')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /안전하게 보관해 주세요/ })).toBeInTheDocument()
    expect(screen.queryByText('DEMO-ONLY-0001')).not.toBeInTheDocument()
    expect(calls[0].files).toEqual([])
    expectNoLeak(calls[0].headers['Report-Recovery-Secret'], RECEIPT.lookupCode)
  })

  it('제출 중 버튼 중복 클릭으로 요청을 두 번 보내지 않는다', async () => {
    let resolve: (response: Response) => void = () => undefined
    const fetchMock = mockFetch(new Promise<Response>((done) => { resolve = done }))
    await fillAndReview()
    const button = screen.getByRole('button', { name: '제보 제출하기' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByRole('button', { name: '제출 중' })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '제출 중' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolve(json(201, RECEIPT))
    expect(await screen.findByRole('heading', { name: '제보가 접수되었습니다' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('409 진행 중은 같은 시도를 유지하고 확정 실패 뒤에만 새 키를 만든다', async () => {
    mockFetch(problem(409, 'INTAKE_IN_PROGRESS'), problem(400, 'INVALID_REPORT_REQUEST'), json(201, RECEIPT))
    await fillAndReview()
    fireEvent.click(screen.getByRole('button', { name: '제보 제출하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('같은 접수를 처리하고 있습니다')
    fireEvent.click(screen.getByRole('button', { name: '같은 내용으로 다시 시도' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('입력 내용을 확인해 주세요')
    expect(screen.queryByText('sensitive server detail')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '최종 확인' })).toBeInTheDocument()
    expect(calls[1].headers).toEqual(calls[0].headers)
    fireEvent.click(screen.getByRole('button', { name: '제보 제출하기' }))
    expect(await screen.findByRole('heading', { name: '제보가 접수되었습니다' })).toBeInTheDocument()
    expect(calls[2].headers['Idempotency-Key']).not.toBe(calls[0].headers['Idempotency-Key'])
    expect(calls[2].headers['Report-Recovery-Secret']).not.toBe(calls[0].headers['Report-Recovery-Secret'])
  })

  it.each([
    [problem(413, 'REQUEST_TOO_LARGE'), '첨부 용량이 너무 큽니다'],
    [problem(415, 'UNSUPPORTED_IMAGE'), '지원하지 않는 파일입니다'],
    [problem(422, 'INVALID_IMAGE'), '입력 내용을 확인해 주세요'],
    [problem(404, 'EVENT_NOT_AVAILABLE'), '현재 제보를 받을 수 없는 공연입니다'],
    [problem(429, 'RATE_LIMITED'), '요청이 너무 많습니다'],
    [problem(503, 'INTAKE_STORAGE_UNAVAILABLE'), '지금은 접수할 수 없습니다'],
    [problem(503, 'INTAKE_BUSY'), '지금은 접수 결과를 확인할 수 없습니다'],
    [problem(409, 'IDEMPOTENCY_CONFLICT'), '요청을 자동으로 처리할 수 없습니다'],
    [json(201, { ...RECEIPT, lookupCode: undefined }), '접수 결과를 확인하지 못했습니다'],
  ])('실패 응답 %#은 성공 화면으로 이동하지 않는다', async (response, message) => {
    mockFetch(response)
    await fillAndReview([])
    fireEvent.click(screen.getByRole('button', { name: '제보 제출하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('heading', { name: '최종 확인' })).toBeInTheDocument()
    expect(screen.queryByText(RECEIPT.receiptNumber)).not.toBeInTheDocument()
    expect(screen.queryByText('sensitive server detail')).not.toBeInTheDocument()
    expect(locations.at(-1)).toContain('/fan/review')
  })

  it('설정된 공연만 선택지로 제공하고 시연 공연은 표시하지 않는다', () => {
    renderRoute('/fan/write')
    const options = Array.from(screen.getByRole('combobox', { name: /공연 선택/ }).querySelectorAll('option')).map((option) => option.value)
    expect(options).toEqual(['', EVENT_ID])
  })
})

describe('실제 접수 설정이 없는 환경', () => {
  it('제출 버튼이 비활성이고 시연 공연을 API로 전송하지 않는다', async () => {
    vi.stubEnv('VITE_FAN_REPORT_EVENT_ID', 'not-a-uuid')
    const fetchMock = mockFetch()
    renderRoute('/fan/write')
    fireEvent.change(screen.getByRole('combobox', { name: /공연 선택/ }), { target: { value: 'DEMO_AUTUMN_LIVE' } })
    fireEvent.change(screen.getByLabelText(/공연 일시 또는 회차/), { target: { value: '2026-11-01T19:30' } })
    fireEvent.click(screen.getByRole('radio', { name: '기타 의심 거래' }))
    fireEvent.change(screen.getByRole('textbox', { name: /의심 거래 설명/ }), { target: { value: '합성 데이터로 작성한 의심 거래 관찰 내용입니다.' } })
    fireEvent.click(screen.getByRole('button', { name: '다음 단계: 최종 확인' }))
    expect(await screen.findByRole('heading', { name: '제보 내용 요약' })).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '실제 접수 미설정' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('접수 상태 조회', () => {
  async function lookup() {
    renderRoute('/fan/lookup')
    fireEvent.change(screen.getByRole('textbox', { name: /접수번호/ }), { target: { value: RECEIPT.receiptNumber } })
    fireEvent.change(screen.getByLabelText(/비밀 조회 코드/), { target: { value: RECEIPT.lookupCode } })
    fireEvent.click(screen.getByRole('button', { name: '접수 상태 조회' }))
  }

  it('조회 코드를 JSON 본문으로만 보내고 서버가 반환한 상태와 시각만 표시한다', async () => {
    mockFetch(json(200, { intakeStatus: 'RECEIVED', receivedAt: RECEIPT.receivedAt }))
    await lookup()
    expect(await screen.findByRole('heading', { name: '내 제보 상태' })).toBeInTheDocument()
    expect(screen.getByText('접수됨')).toBeInTheDocument()
    expect(screen.getByText(/2026년 10월 31일/)).toBeInTheDocument()
    expect(calls[0].url).toBe('/api/v1/fan-reports/lookup')
    expect(calls[0].json).toEqual({ receiptNumber: RECEIPT.receiptNumber, lookupCode: RECEIPT.lookupCode })
    expect(screen.queryByText(RECEIPT.lookupCode)).not.toBeInTheDocument()
    expectNoLeak(RECEIPT.lookupCode)
  })

  it.each([
    [problem(404, 'REPORT_NOT_FOUND'), '일치하는 제보를 찾을 수 없습니다'],
    [problem(429, 'RATE_LIMITED'), '조회 요청이 너무 많습니다'],
    [problem(503, 'INTAKE_STORAGE_UNAVAILABLE'), '지금은 조회할 수 없습니다'],
    [new TypeError('Failed to fetch'), '네트워크 문제로'],
    [json(200, { intakeStatus: 'CONFIRMED_VIOLATION', receivedAt: RECEIPT.receivedAt }), '서버 응답을 확인할 수 없습니다'],
  ])('조회 실패 %#를 구분해 표시한다', async (response, message) => {
    mockFetch(response)
    await lookup()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('heading', { name: '내 제보 상태' })).not.toBeInTheDocument()
    expect(screen.queryByText(/접수번호가 틀렸|조회 코드가 틀렸/)).not.toBeInTheDocument()
  })
})
