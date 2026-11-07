import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { buildImportRequest, isSyntheticImportUiEnabled, matchesImport, maxImportRows, summarizeImport } from '../features/admin-imports/reservationImportApi'
import type { ImportResult } from '../features/admin-imports/reservationImportApi'

// Issue #42: 합성 격리 예매 스냅샷 반입 화면(/app/imports)을 Mock 인증 어댑터와 fetch로 검증한다.
// 실제 Backend HTTP 연동 결과가 아니다. 서버 게이트, 역할, 범위 판단은 격리 E2E로 따로 확인해야 한다.
// 모든 값은 합성 데이터이며 예매번호는 SYN-RSV 접두어의 가짜 값이다. 토큰도 서명되지 않은 합성 문자열이다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const PERF_ACTIVE = '99999999-9999-4999-8999-999999999991'
const PERF_WITHDRAWN = '99999999-9999-4999-8999-999999999992'
const BATCH = '77777777-7777-4777-8777-777777777771'
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'
const PERFS_URL = `/api/v1/admin/events/${EVENT_A}/verified-performances`
const IMPORT_URL = `/api/v1/admin/events/${EVENT_A}/reservation-imports`
const ROUTE = `/app/imports?eventId=${EVENT_A}`
const REF_1 = 'SYN-RSV-SECRETLIKE-0001'
const REF_2 = 'SYN-RSV-SECRETLIKE-0002'
const ROWS_TEXT = `  ${REF_1} , A , 1 , 10 \n\n${REF_2}\tB\t2\t20\n`
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
}

function renderApp(path = ROUTE) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={createMockAdapter()} /><LocationProbe /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function problem(status: number, code: string) {
  return new Response(JSON.stringify({ status, code, detail: '내부 정보 secret-detail' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

const events = { items: [{ id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }], page: 0, pageSize: 100, totalItems: 1, hasNext: false }

function verifiedPerformance(overrides: Record<string, unknown> = {}) {
  return { performanceId: PERF_ACTIVE, eventId: EVENT_A, performanceRef: 'SYN-PERF-1', status: 'ACTIVE', revision: 1, sourceVersion: 'syn-v1', verifiedAt: '2026-11-04T01:00:00', withdrawnAt: null, ...overrides }
}

function importResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return { batchId: BATCH, eventId: EVENT_A, performanceId: PERF_ACTIVE, sourceVersion: 'syn-snapshot-1', status: 'ACCEPTED', completeSnapshot: true, inputRowCount: 2, acceptedRowCount: 2, rejectedRowCount: 0, errors: [], completedAt: '2026-11-07T03:00:00', ...overrides }
}

type Call = { method: string; url: string; headers: Record<string, string>; rawBody: string | undefined; body: unknown }
type Handler = (call: Call, count: number) => Response | Promise<Response> | undefined

function stubFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const merged: Record<string, Handler> = {
    [`GET ${EVENTS_PATH}`]: () => json(200, events),
    [`GET ${PERFS_URL}`]: () => json(200, [verifiedPerformance(), verifiedPerformance({ performanceId: PERF_WITHDRAWN, performanceRef: 'SYN-PERF-OLD', status: 'WITHDRAWN', withdrawnAt: '2026-11-05T00:00:00' })]),
    ...routes,
  }
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    const call: Call = { method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, rawBody, body: rawBody === undefined ? undefined : JSON.parse(rawBody) }
    calls.push(call)
    const key = `${call.method} ${call.url}`
    counts[key] = (counts[key] ?? 0) + 1
    const response = await merged[key]?.(call, counts[key])
    if (!response) throw new Error(`예상하지 못한 요청: ${key}`)
    return response
  }))
  return calls
}

const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST' && call.url === IMPORT_URL)

async function openForm() {
  return screen.findByRole('region', { name: '합성 예매 스냅샷 입력' })
}

function fill(form: HTMLElement, { rows = ROWS_TEXT, sourceVersion = ' syn-snapshot-1 ', complete = true }: { rows?: string; sourceVersion?: string; complete?: boolean | null } = {}) {
  fireEvent.change(within(form).getByRole('combobox', { name: /검증 회차/ }), { target: { value: PERF_ACTIVE } })
  fireEvent.change(within(form).getByRole('textbox', { name: /sourceVersion/ }), { target: { value: sourceVersion } })
  if (complete === true) fireEvent.click(within(form).getByRole('radio', { name: /완전한 스냅샷입니다/ }))
  if (complete === false) fireEvent.click(within(form).getByRole('radio', { name: /완전하지 않습니다/ }))
  fireEvent.change(within(form).getByRole('textbox', { name: /합성 예매 행/ }), { target: { value: rows } })
}

const rowsBox = (form: HTMLElement) => within(form).getByRole('textbox', { name: /합성 예매 행/ }) as HTMLTextAreaElement
const submitButton = (form: HTMLElement) => within(form).getByRole('button', { name: '합성 스냅샷 반입' })

beforeEach(() => {
  vi.stubEnv('VITE_SYNTHETIC_RESERVATION_IMPORT_UI', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('합성 예매 반입 요청 해석', () => {
  it('화면 설정은 정확히 true일 때만 켜진다', () => {
    expect(isSyntheticImportUiEnabled({ VITE_SYNTHETIC_RESERVATION_IMPORT_UI: 'true' })).toBe(true)
    expect(isSyntheticImportUiEnabled({ VITE_SYNTHETIC_RESERVATION_IMPORT_UI: ' true ' })).toBe(true)
    for (const value of [undefined, '', 'false', 'TRUE', '1', true]) expect(isSyntheticImportUiEnabled({ VITE_SYNTHETIC_RESERVATION_IMPORT_UI: value })).toBe(false)
  })

  it('앞뒤 공백을 빼고 계약의 네 필드만 담으며 빈 줄은 건너뛴다', () => {
    const built = buildImportRequest({ performanceId: PERF_ACTIVE, sourceVersion: ' syn-snapshot-1 ', completeSnapshot: true, rowsText: ROWS_TEXT })
    expect(built).toEqual({ ok: true, body: { performanceId: PERF_ACTIVE, sourceVersion: 'syn-snapshot-1', completeSnapshot: true, rows: [
      { reservationReference: REF_1, zone: 'A', row: '1', seat: '10' },
      { reservationReference: REF_2, zone: 'B', row: '2', seat: '20' },
    ] } })
  })

  it('필수 값, 길이, 행 형식을 검증하고 오류 문구에 입력 값을 넣지 않는다', () => {
    const long = 'x'.repeat(129)
    const built = buildImportRequest({ performanceId: '', sourceVersion: '   ', completeSnapshot: null, rowsText: `${REF_1},A,1\n${REF_2},${long},1,1\n${REF_1}, ,1,1` })
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.errors.performanceId).toBeDefined()
    expect(built.errors.sourceVersion).toBeDefined()
    expect(built.errors.completeSnapshot).toBeDefined()
    expect(built.errors.rowLines).toEqual([
      '1번째 줄: 값이 4개(합성 예매번호, 구역, 열, 좌석)여야 합니다.',
      '2번째 줄: 구역 값은 앞뒤 공백을 뺀 1~128자여야 합니다.',
      '3번째 줄: 구역 값은 앞뒤 공백을 뺀 1~128자여야 합니다.',
    ])
    expect(JSON.stringify(built.errors)).not.toContain('SYN-RSV')
    expect(buildImportRequest({ performanceId: PERF_ACTIVE, sourceVersion: 'v', completeSnapshot: true, rowsText: '\n \n' })).toMatchObject({ ok: false, errors: { rows: '합성 예매 행을 1개 이상 입력해 주세요.' } })
    expect(buildImportRequest({ performanceId: PERF_ACTIVE, sourceVersion: 'v'.repeat(129), completeSnapshot: true, rowsText: `${REF_1},A,1,1` })).toMatchObject({ ok: false, errors: { sourceVersion: expect.any(String) } })
  })

  it('1000행은 한 번의 해석으로 빠르게 검증하고 1001행은 요청 전에 막는다', () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `SYN-RSV-${String(index).padStart(5, '0')},Z${index % 30},R${index % 40},S${index}`).join('\n')
    const started = performance.now()
    const built = buildImportRequest({ performanceId: PERF_ACTIVE, sourceVersion: 'syn', completeSnapshot: true, rowsText: lines(maxImportRows) })
    const elapsed = performance.now() - started
    expect(built.ok && built.body.rows).toHaveLength(maxImportRows)
    // 테스트 환경 편차를 고려한 넉넉한 상한이다. 정상이면 수 ms 안에 끝난다.
    expect(elapsed).toBeLessThan(500)
    expect(buildImportRequest({ performanceId: PERF_ACTIVE, sourceVersion: 'syn', completeSnapshot: true, rowsText: lines(maxImportRows + 1) })).toMatchObject({ ok: false, errors: { rows: expect.stringContaining('최대 1000개') } })
  })

  it('201 응답이 보낸 요청과 다르거나 건수가 맞지 않으면 결과로 인정하지 않는다', () => {
    const sent = summarizeImport(EVENT_A, { performanceId: PERF_ACTIVE, sourceVersion: 'syn-snapshot-1', completeSnapshot: true, rows: [{ reservationReference: REF_1, zone: 'A', row: '1', seat: '1' }, { reservationReference: REF_2, zone: 'A', row: '1', seat: '2' }] })
    expect(JSON.stringify(sent)).not.toContain('SYN-RSV')
    expect(matchesImport(sent, importResult())).toBe(true)
    expect(matchesImport(sent, importResult({ status: 'REJECTED', acceptedRowCount: 0, rejectedRowCount: 1, errors: [{ rowIndex: 1, code: 'DUPLICATE_RESERVATION_REFERENCE' }] }))).toBe(true)
    expect(matchesImport(sent, importResult({ performanceId: PERF_WITHDRAWN }))).toBe(false)
    expect(matchesImport(sent, importResult({ sourceVersion: 'other' }))).toBe(false)
    expect(matchesImport(sent, importResult({ inputRowCount: 3, acceptedRowCount: 3 }))).toBe(false)
    expect(matchesImport(sent, importResult({ acceptedRowCount: 1, rejectedRowCount: 1 }))).toBe(false)
    expect(matchesImport(sent, importResult({ status: 'REJECTED', acceptedRowCount: 0, rejectedRowCount: 0, errors: [] }))).toBe(false)
    expect(matchesImport(sent, importResult({ status: 'REJECTED', acceptedRowCount: 0, rejectedRowCount: 1, errors: [{ rowIndex: 5, code: 'INVALID_ROW' }] }))).toBe(false)
  })
})

describe('합성 예매 반입 화면', () => {
  it('화면 설정이 꺼져 있으면 테스트 전용 안내만 보이고 공연, 회차, 반입 API를 부르지 않는다', async () => {
    vi.stubEnv('VITE_SYNTHETIC_RESERVATION_IMPORT_UI', '')
    const calls = stubFetch({})
    renderApp()
    expect(await screen.findByText('이 환경에서는 합성 예매 반입 화면이 꺼져 있습니다')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('테스트 전용')
    expect(screen.queryByRole('region', { name: '합성 예매 스냅샷 입력' })).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('메뉴에서 열고 ACTIVE 회차만 선택지로 보여 준다', async () => {
    stubFetch({})
    renderApp('/app/overview')
    fireEvent.click(await screen.findByRole('link', { name: '데이터 반입' }))
    expect(await screen.findByRole('heading', { name: '데이터 반입' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('실제 고객사 예매 데이터 반입 기능이 아니며')
    fireEvent.change(screen.getByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_A } })
    const form = await openForm()
    const options = within(within(form).getByRole('combobox', { name: /검증 회차/ })).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['회차를 선택해 주세요', 'SYN-PERF-1 (revision 1)'])
    expect(within(form).getByText('철회된 회차 1개는 반입 대상에서 제외했습니다.')).toBeInTheDocument()
  })

  it('계약 본문과 UUIDv4 요청 키, Bearer 토큰으로 한 번만 보내고 ACCEPTED 결과를 표시한 뒤 민감 입력을 지운다', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method))
    let release: (response: Response) => void = () => undefined
    const calls = stubFetch({ [`POST ${IMPORT_URL}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
    renderApp()
    const form = await openForm()
    fill(form)
    fireEvent.click(submitButton(form))
    fireEvent.click(submitButton(form))
    fireEvent.submit(rowsBox(form).closest('form')!)
    await waitFor(() => expect(posts(calls)).toHaveLength(1))
    release(json(201, importResult()))

    const result = await screen.findByRole('region', { name: '반입 결과' })
    expect(posts(calls)).toHaveLength(1)
    const [post] = posts(calls)
    expect(post.headers.Authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`)
    expect(post.headers['Idempotency-Key']).toMatch(uuidV4)
    expect(post.body).toEqual({ performanceId: PERF_ACTIVE, sourceVersion: 'syn-snapshot-1', completeSnapshot: true, rows: [
      { reservationReference: REF_1, zone: 'A', row: '1', seat: '10' },
      { reservationReference: REF_2, zone: 'B', row: '2', seat: '20' },
    ] })
    expect(within(result).getByText('반입 수락 (ACCEPTED)')).toBeInTheDocument()
    expect(within(result).getByText(BATCH)).toBeInTheDocument()
    expect(within(result).getByText('2 / 2 / 0')).toBeInTheDocument()

    // 확정 결과 뒤에는 예매 행과 스냅샷 입력을 지우고 화면, 주소, 저장소, 콘솔 어디에도 원문 예매번호를 남기지 않는다.
    expect(rowsBox(form).value).toBe('')
    expect(within(form).getByRole('textbox', { name: /sourceVersion/ })).toHaveValue('')
    expect(within(form).getByRole('radio', { name: /완전한 스냅샷입니다/ })).not.toBeChecked()
    expect(document.body.innerHTML).not.toContain('SYN-RSV')
    expect(screen.getByTestId('location').textContent).toBe(ROUTE)
    expect(setItem.mock.calls.flat().join(' ')).not.toContain('SYN-RSV')
    expect(JSON.stringify({ ...localStorage })).not.toContain('SYN-RSV')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('SYN-RSV')
    for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain('SYN-RSV')
  })

  it('REJECTED 배치의 rowIndex와 코드를 그대로 표시하고 입력을 지운다', async () => {
    stubFetch({ [`POST ${IMPORT_URL}`]: () => json(201, importResult({ status: 'REJECTED', completeSnapshot: false, acceptedRowCount: 0, rejectedRowCount: 2, errors: [{ rowIndex: 0, code: 'INCOMPLETE_SOURCE' }, { rowIndex: 1, code: 'DUPLICATE_RESERVATION_REFERENCE' }] })) })
    renderApp()
    const form = await openForm()
    fill(form, { complete: false })
    fireEvent.click(submitButton(form))
    const result = await screen.findByRole('region', { name: '반입 결과' })
    expect(within(result).getByText('반입 거부 (REJECTED)')).toBeInTheDocument()
    expect(within(result).getByText('INCOMPLETE_SOURCE')).toBeInTheDocument()
    expect(within(result).getByText('DUPLICATE_RESERVATION_REFERENCE')).toBeInTheDocument()
    const rows = within(result).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(rows).toEqual(['0', '1'])
    expect(within(result).getByText('2 / 0 / 2')).toBeInTheDocument()
    expect(rowsBox(form).value).toBe('')
  })

  it('필수 입력이 빠지면 요청하지 않는다', async () => {
    const calls = stubFetch({})
    renderApp()
    const form = await openForm()
    fill(form, { complete: null })
    fireEvent.click(submitButton(form))
    expect(await within(form).findByText('완전한 스냅샷인지 직접 선택해 주세요.')).toBeInTheDocument()
    expect(posts(calls)).toHaveLength(0)
    expect(rowsBox(form).value).toBe(ROWS_TEXT)
  })

  it.each([
    [409, 'RESERVATION_IMPORT_DISABLED', '서버의 합성 반입 안전 게이트가 요청을 차단했습니다'],
    [409, 'RESERVATION_IMPORT_OPERATION_NOT_APPROVED', '서버의 합성 반입 안전 게이트가 요청을 차단했습니다'],
    [409, 'RESERVATION_IMPORT_ISOLATION_UNVERIFIED', '서버의 합성 반입 안전 게이트가 요청을 차단했습니다'],
    [409, 'RESERVATION_IMPORT_SYNTHETIC_SCOPE_UNVERIFIED', '서버의 합성 반입 안전 게이트가 요청을 차단했습니다'],
    [409, 'RESERVATION_SOURCE_VERSION_CONFLICT', '같은 sourceVersion이 다른 내용으로 이미 반입되었습니다'],
    [409, 'PERFORMANCE_WITHDRAWN', '철회된 검증 회차에는 반입할 수 없습니다'],
    [409, 'RESERVATION_IMPORT_CONCURRENT_UPDATE', '같은 회차의 반입이 동시에 처리되었습니다'],
    [409, 'IDEMPOTENCY_KEY_REUSED', '같은 요청 키가 다른 내용으로 사용되었습니다'],
    [422, 'VALIDATION_FAILED', '서버가 입력 값을 거부했습니다'],
    [400, 'INVALID_REQUEST', '요청 형식이 올바르지 않습니다'],
    [403, 'FORBIDDEN', '합성 예매 반입에 필요한 역할이 없습니다'],
    [404, 'RESOURCE_NOT_FOUND', '공연이나 검증 회차를 찾을 수 없거나 접근 범위 밖입니다'],
  ])('%i %s는 요청 거부로 표시하고 결과나 성공으로 바꾸지 않는다', async (status, code, title) => {
    const calls = stubFetch({ [`POST ${IMPORT_URL}`]: () => problem(status, code) })
    renderApp()
    const form = await openForm()
    fill(form)
    fireEvent.click(submitButton(form))
    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent(`요청 거부: ${title}`)
    if (code.startsWith('RESERVATION_IMPORT_') && code !== 'RESERVATION_IMPORT_CONCURRENT_UPDATE') expect(alert).toHaveTextContent(code)
    expect(alert).not.toHaveTextContent('secret-detail')
    expect(screen.queryByRole('region', { name: '반입 결과' })).not.toBeInTheDocument()
    // 거부된 요청의 입력은 고쳐 다시 보낼 수 있도록 화면 메모리에 남기고, 회차 목록은 다시 불러온다.
    expect(rowsBox(form).value).toBe(ROWS_TEXT)
    expect(submitButton(form)).toBeEnabled()
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.url === PERFS_URL)).toHaveLength(2))
  })

  it('401이면 세션을 정리하고 반입 결과를 표시하지 않는다', async () => {
    stubFetch({ [`POST ${IMPORT_URL}`]: () => new Response(null, { status: 401 }) })
    renderApp()
    const form = await openForm()
    fill(form)
    fireEvent.click(submitButton(form))
    expect(await screen.findByText('관리자 세션이 종료되었습니다')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '반입 결과' })).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('SYN-RSV')
  })

  it.each([
    ['응답 유실', () => { throw new TypeError('network') }],
    ['503 DEPENDENCY_UNAVAILABLE', () => problem(503, 'DEPENDENCY_UNAVAILABLE')],
    ['계약과 다른 201', () => json(201, importResult({ performanceId: PERF_WITHDRAWN }))],
    ['201이 아닌 200', () => json(200, importResult())],
  ])('%s는 결과 미확인으로 잠그고 같은 키와 같은 본문으로만 재확인한다', async (_label, first) => {
    const calls = stubFetch({ [`POST ${IMPORT_URL}`]: (_call, count) => count === 1 ? first() : json(201, importResult()) })
    renderApp()
    const form = await openForm()
    fill(form)
    fireEvent.click(submitButton(form))
    expect(await within(form).findByRole('alert')).toHaveTextContent('결과 미확인')
    expect(screen.queryByRole('region', { name: '반입 결과' })).not.toBeInTheDocument()

    // 입력이 잠기고 새 요청 키로는 보낼 수 없다.
    expect(rowsBox(form)).toHaveAttribute('readonly')
    expect(submitButton(form)).toBeDisabled()
    fireEvent.submit(rowsBox(form).closest('form')!)
    expect(posts(calls)).toHaveLength(1)

    fireEvent.click(within(form).getByRole('button', { name: '같은 요청 재확인' }))
    expect(await screen.findByRole('region', { name: '반입 결과' })).toBeInTheDocument()
    const [original, retry] = posts(calls)
    expect(posts(calls)).toHaveLength(2)
    expect(retry.headers['Idempotency-Key']).toBe(original.headers['Idempotency-Key'])
    expect(retry.rawBody).toBe(original.rawBody)
    expect(rowsBox(form).value).toBe('')
    expect(rowsBox(form)).not.toHaveAttribute('readonly')
  })

  it('확정 결과 뒤 새 반입은 새 요청 키를 쓴다', async () => {
    const calls = stubFetch({ [`POST ${IMPORT_URL}`]: (call) => json(201, importResult({ sourceVersion: (call.body as { sourceVersion: string }).sourceVersion })) })
    renderApp()
    const form = await openForm()
    fill(form)
    fireEvent.click(submitButton(form))
    await screen.findByRole('region', { name: '반입 결과' })
    fill(form, { sourceVersion: 'syn-snapshot-2' })
    fireEvent.click(submitButton(form))
    await waitFor(() => expect(posts(calls)).toHaveLength(2))
    await screen.findByText('syn-snapshot-2')
    const [first, second] = posts(calls)
    expect(second.headers['Idempotency-Key']).toMatch(uuidV4)
    expect(second.headers['Idempotency-Key']).not.toBe(first.headers['Idempotency-Key'])
  })

  it('1000행 입력을 한 번의 요청으로 보낸다', async () => {
    const rows = Array.from({ length: maxImportRows }, (_, index) => `SYN-RSV-${String(index).padStart(5, '0')},Z,R,S${index}`).join('\n')
    const calls = stubFetch({ [`POST ${IMPORT_URL}`]: () => json(201, importResult({ inputRowCount: maxImportRows, acceptedRowCount: maxImportRows })) })
    renderApp()
    const form = await openForm()
    fill(form, { rows })
    fireEvent.click(submitButton(form))
    expect(await screen.findByText(`${maxImportRows} / ${maxImportRows} / 0`)).toBeInTheDocument()
    expect((posts(calls)[0].body as { rows: unknown[] }).rows).toHaveLength(maxImportRows)
  })

  it('회차 목록 403은 역할 안내를 표시하고 반입 입력을 열지 않는다', async () => {
    const calls = stubFetch({ [`GET ${PERFS_URL}`]: () => problem(403, 'FORBIDDEN') })
    renderApp()
    expect(await screen.findByText('검증 회차를 조회할 역할이 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '합성 예매 스냅샷 입력' })).not.toBeInTheDocument()
    expect(posts(calls)).toHaveLength(0)
  })
})
