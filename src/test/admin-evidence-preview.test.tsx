import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { track2PipelineDefault } from './track2PipelineDefaults'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { readBlobBytes, SYNTHETIC_JPEG, SYNTHETIC_PNG } from './syntheticImages'

// Mock 인증 어댑터와 fetch로 관리자 증거 원본 미리보기 화면 계약을 검증한다.
// 오류 형식은 Backend main 15cf228의 admin-evidence-content-v1 계약을 따른다. 실제 Backend 연동을 대체하지 않으며 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const REPORT_1 = '55555555-5555-4555-8555-555555555551'
const REPORT_2 = '55555555-5555-4555-8555-555555555552'
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661'
const EVIDENCE_2 = '66666666-6666-4666-8666-666666666662'
const EVIDENCE_3 = '66666666-6666-4666-8666-666666666663'
const SHA = 'a'.repeat(64)

function createMockAdapter() {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function TestNavigator() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(`/app/fan-reports/${REPORT_2}`)}>테스트 제보 2로 이동</button>
}

function renderApp(path = `/app/fan-reports/${REPORT_1}`, strict = false) {
  const tree = <MemoryRouter initialEntries={[path]}><App adminAuthAdapter={createMockAdapter()} /><TestNavigator /></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Backend ProblemDetail 형식이다. detail에 내부 저장소 정보가 섞여 와도 화면에 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ title: 'Problem', status, code, requestId: '00000000-0000-4000-8000-000000000000', detail: 'evidence-bucket/tenant-b/object-key versionId=v1' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

function image(bytes: Uint8Array, contentType: string) {
  return new Response(bytes.slice().buffer, { status: 200, headers: { 'Content-Type': contentType } })
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

const eventA = { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }
const pngEvidence = { evidenceId: EVIDENCE_1, mediaType: 'image/png', byteSize: SYNTHETIC_PNG.length, storageStatus: 'STORED', originalStored: true, sha256: SHA, createdAt: '2026-11-01T09:30:00Z' }
const jpegEvidence = { ...pngEvidence, evidenceId: EVIDENCE_2, mediaType: 'image/jpeg', byteSize: SYNTHETIC_JPEG.length }
const failedEvidence = { evidenceId: EVIDENCE_3, mediaType: 'image/png', byteSize: 512, storageStatus: 'FAILED', originalStored: false, sha256: null, createdAt: '2026-11-01T09:30:00Z' }

function detail(overrides: Record<string, unknown> = {}) {
  return {
    fanReportId: REPORT_1, event: eventA, reportType: 'PREMIUM_RESALE', intakeStatus: 'RECEIVED',
    receivedAt: '2026-11-01T09:30:00Z', retentionUntil: '2027-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z',
    seatArea: null, description: '합성 설명', listingUrl: null, platform: null, seller: '합성판매자', askingPrice: null,
    evidence: [pngEvidence, jpegEvidence, failedEvidence], ...overrides,
  }
}

const detailPath = (id = REPORT_1) => `/api/v1/admin/fan-reports/${id}`
const historyPrefix = (reportId: string, evidenceId: string) => `/api/v1/admin/fan-reports/${reportId}/evidence/${evidenceId}/listing-analyses?`
const contentPath = (evidenceId = EVIDENCE_1, reportId = REPORT_1) => `/api/v1/admin/fan-reports/${reportId}/evidence/${evidenceId}/content`
const emptyHistory = { items: [], page: 0, pageSize: 20, hasNext: false }

type Route = (url: string) => Response | Promise<Response> | undefined
function stubFetch(content: Route, extra: Route = () => undefined) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const response = await (url.endsWith('/content') ? content(url) : extra(url) ?? (url === detailPath() ? json(200, detail()) : url.includes('/listing-analyses?') ? json(200, emptyHistory) : track2PipelineDefault(url)))
    if (!response) throw new Error(`예상하지 못한 요청: ${url}`)
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const contentCalls = (fetchMock: ReturnType<typeof stubFetch>) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/content'))

// jsdom의 Blob URL 구현 대신 생성과 해제를 기록하는 합성 구현을 둔다.
type BlobUrlApi = { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void }
const blobUrlApi = URL as unknown as BlobUrlApi
const originalBlobUrlApi = { createObjectURL: blobUrlApi.createObjectURL, revokeObjectURL: blobUrlApi.revokeObjectURL }
let created: { url: string; blob: Blob }[] = []
let revoked: string[] = []
const liveUrls = () => created.map((item) => item.url).filter((url) => !revoked.includes(url))

beforeEach(() => {
  created = []
  revoked = []
  let sequence = 0
  blobUrlApi.createObjectURL = (blob: Blob) => {
    sequence += 1
    const url = `blob:synthetic-${sequence}`
    created.push({ url, blob })
    return url
  }
  blobUrlApi.revokeObjectURL = (url: string) => { revoked.push(url) }
})

afterEach(() => {
  // 언마운트 정리에서 합성 해제 함수를 쓰도록 원래 구현을 복원하기 전에 먼저 정리한다.
  cleanup()
  blobUrlApi.createObjectURL = originalBlobUrlApi.createObjectURL
  blobUrlApi.revokeObjectURL = originalBlobUrlApi.revokeObjectURL
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// 첫 화면은 지연 로딩되는 라우트 번들을 기다리므로 전체 테스트 병렬 실행 부하에서도 충분히 기다린다.
const firstRender = { timeout: 15000 }

async function openPreview(evidenceLabel = '증거 1') {
  const preview = await screen.findByRole('region', { name: '원본 이미지 미리보기' }, firstRender)
  if (evidenceLabel !== '증거 1') fireEvent.click(screen.getByRole('button', { name: `${evidenceLabel} 선택` }))
  fireEvent.click(within(screen.getByRole('region', { name: '원본 이미지 미리보기' })).getByRole('button', { name: '원본 미리보기' }))
  return preview
}

describe('관리자 증거 원본 미리보기', () => {
  it('상세를 열어도 이미지를 요청하지 않고, 클릭한 저장 증거 하나만 Bearer 토큰으로 요청해 PNG를 표시한다', async () => {
    const fetchMock = stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    renderApp()
    expect(await screen.findByRole('button', { name: '원본 미리보기' }, firstRender)).toBeEnabled()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(contentCalls(fetchMock)).toHaveLength(0)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await openPreview()
    const img = await screen.findByRole('img', { name: '팬이 제출한 원본 이미지 (증거 1)' })
    expect(img).toHaveAttribute('src', 'blob:synthetic-1')
    expect(contentCalls(fetchMock)).toHaveLength(1)
    const [url, init] = contentCalls(fetchMock)[0]
    expect(url).toBe(contentPath())
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
    expect(created).toHaveLength(1)
    expect(created[0].blob.type).toBe('image/png')
    expect(await readBlobBytes(created[0].blob)).toEqual(SYNTHETIC_PNG)
    expect(screen.getByText(/팬이 제출한 원본 자료입니다/)).toBeInTheDocument()

    // 디코딩이 끝나기 전에는 표시 완료로 보지 않는다.
    const region = screen.getByRole('region', { name: '원본 이미지 미리보기' })
    expect(region).toHaveAttribute('data-preview-state', 'decoding')
    fireEvent.load(img)
    expect(region).toHaveAttribute('data-preview-state', 'displayed')
    expect(within(region).getByText(EVIDENCE_1)).toBeInTheDocument()
  })

  it('JPEG 증거를 선택해 미리보면 JPEG Blob으로 표시한다', async () => {
    stubFetch((url) => url === contentPath(EVIDENCE_2) ? image(SYNTHETIC_JPEG, 'image/jpeg') : undefined)
    renderApp()
    await openPreview('증거 2')
    expect(await screen.findByRole('img', { name: '팬이 제출한 원본 이미지 (증거 2)' })).toHaveAttribute('src', 'blob:synthetic-1')
    expect(created[0].blob.type).toBe('image/jpeg')
  })

  it('원본 저장이 확인되지 않은 증거는 미리보기 버튼이 비활성이고 이미지 API를 호출하지 않는다', async () => {
    const fetchMock = stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    renderApp()
    await screen.findByRole('region', { name: '원본 이미지 미리보기' }, firstRender)
    fireEvent.click(screen.getByRole('button', { name: '증거 3 선택' }))
    const region = screen.getByRole('region', { name: '원본 이미지 미리보기' })
    const button = within(region).getByRole('button', { name: '원본 미리보기' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(within(region).getByText('원본 저장이 확인되지 않아 미리볼 수 없습니다.')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(contentCalls(fetchMock)).toHaveLength(0)
  })

  it('증거를 A에서 B로 바꾸면 취소를 무시하고 늦게 도착한 A 응답을 표시하지 않고 Blob URL도 만들지 않는다', async () => {
    const lateA = deferred()
    const fetchMock = stubFetch((url) => url === contentPath(EVIDENCE_1) ? lateA.promise : url === contentPath(EVIDENCE_2) ? image(SYNTHETIC_JPEG, 'image/jpeg') : undefined)
    renderApp()
    await openPreview()
    expect(await screen.findByRole('status', { name: '원본 이미지를 불러오는 중' })).toBeInTheDocument()
    const firstSignal = contentCalls(fetchMock)[0][1]?.signal
    await openPreview('증거 2')
    expect(firstSignal?.aborted).toBe(true)
    expect(await screen.findByRole('img', { name: '팬이 제출한 원본 이미지 (증거 2)' })).toHaveAttribute('src', 'blob:synthetic-1')

    lateA.resolve(image(SYNTHETIC_PNG, 'image/png'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(created).toHaveLength(1)
    expect(created[0].blob.type).toBe('image/jpeg')
    expect(screen.queryByRole('img', { name: '팬이 제출한 원본 이미지 (증거 1)' })).not.toBeInTheDocument()
    // 증거 1로 돌아가도 이전 이미지를 자동으로 다시 표시하거나 요청하지 않는다.
    fireEvent.click(screen.getByRole('button', { name: '증거 1 선택' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(revoked).toContain('blob:synthetic-1')
    expect(contentCalls(fetchMock)).toHaveLength(2)
  })

  it('미리보기를 닫으면 이미지를 제거하고 Blob URL을 해제한다', async () => {
    stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    renderApp()
    await openPreview()
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: '미리보기 닫기' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(revoked).toEqual(['blob:synthetic-1'])
    expect(liveUrls()).toEqual([])
  })

  it('다른 제보 주소로 이동하면 이전 제보의 이미지를 제거하고 Blob URL을 해제한다', async () => {
    stubFetch(() => image(SYNTHETIC_PNG, 'image/png'), (url) => url === detailPath(REPORT_2) ? json(200, detail({ fanReportId: REPORT_2, seller: '두번째 판매자', evidence: [] })) : undefined)
    renderApp()
    await openPreview()
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: '테스트 제보 2로 이동' }))
    expect(await screen.findByText('두번째 판매자')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(liveUrls()).toEqual([])
  })

  it('다른 제보로 이동한 뒤 이전 제보의 늦은 이미지 응답은 Blob URL을 만들지 않는다', async () => {
    const late = deferred()
    stubFetch(() => late.promise, (url) => url === detailPath(REPORT_2) ? json(200, detail({ fanReportId: REPORT_2, seller: '두번째 판매자', evidence: [] })) : undefined)
    renderApp()
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: '테스트 제보 2로 이동' }))
    expect(await screen.findByText('두번째 판매자')).toBeInTheDocument()
    late.resolve(image(SYNTHETIC_PNG, 'image/png'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(created).toHaveLength(0)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('로그아웃하면 이미지를 제거하고 Blob URL을 해제한다', async () => {
    stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    renderApp()
    await openPreview()
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(liveUrls()).toEqual([])
  })

  it('다른 조회의 401로 세션이 만료되면 표시 중인 이미지를 제거하고 Blob URL을 해제한다', async () => {
    stubFetch(() => image(SYNTHETIC_PNG, 'image/png'), (url) => {
      if (url.startsWith(historyPrefix(REPORT_1, EVIDENCE_1)) && url.includes('page=1')) return new Response(null, { status: 401 })
      if (url.startsWith(historyPrefix(REPORT_1, EVIDENCE_1))) return json(200, { ...emptyHistory, hasNext: true })
      return undefined
    })
    renderApp()
    await openPreview()
    await screen.findByRole('img')
    fireEvent.click(await screen.findByRole('button', { name: '다음 이력' }))
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(liveUrls()).toEqual([])
  })

  it('이미지 요청의 401은 세션을 정리하고 이미지를 만들지 않는다', async () => {
    stubFetch(() => new Response(null, { status: 401 }))
    renderApp()
    await openPreview()
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    expect(created).toHaveLength(0)
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(SYNTHETIC_TOKEN)
  })

  it('React 개발 모드의 effect 재실행에서도 Blob URL을 하나만 유지하고 닫으면 모두 해제한다', async () => {
    stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    const view = renderApp(undefined, true)
    await openPreview()
    await screen.findByRole('img')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(liveUrls()).toHaveLength(1)
    expect(screen.getByRole('img')).toHaveAttribute('src', liveUrls()[0])
    view.unmount()
    expect(liveUrls()).toEqual([])
  })

  it('이미지 디코딩에 실패하면 표시 실패로 바꾸고 Blob URL을 해제하며 데모 이미지로 대체하지 않는다', async () => {
    stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    renderApp()
    await openPreview()
    fireEvent.error(await screen.findByRole('img'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('이미지를 표시하지 못했습니다')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(liveUrls()).toEqual([])
    expect(document.body.innerHTML).not.toMatch(/demo|data:image|synthetic-evidence/i)
  })

  it('증거 메타데이터와 다른 형식의 이미지 응답은 표시하지 않는다', async () => {
    stubFetch(() => image(SYNTHETIC_JPEG, 'image/jpeg'))
    renderApp()
    await openPreview()
    expect(await screen.findByRole('alert')).toHaveTextContent('이미지 응답을 확인하지 못했습니다')
    expect(created).toHaveLength(0)
  })

  it('200 HTML 응답은 이미지로 처리하지 않는다', async () => {
    stubFetch(() => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    renderApp()
    await openPreview()
    expect(await screen.findByRole('alert')).toHaveTextContent('이미지 응답을 확인하지 못했습니다')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(created).toHaveLength(0)
  })

  it.each([
    [403, 'ACCESS_DENIED', '이 원본을 볼 수 있는 역할이 없습니다', false],
    [404, 'RESOURCE_NOT_FOUND', '원본을 찾을 수 없거나 접근 범위 밖입니다', false],
    [409, 'TENANT_SELECTION_REQUIRED', '여러 고객사 소속 계정은 아직 지원하지 않습니다', false],
    [409, 'SOURCE_CHANGED', '원본 정보가 확인 중 바뀌었습니다', true],
    [422, 'SOURCE_NOT_AVAILABLE', '원본을 제공할 수 없는 상태입니다', false],
    [422, 'RETENTION_EXPIRED', '보존 기한이 지나 원본을 표시하지 않습니다', false],
    [422, 'OBJECT_CHANGED', '원본 무결성을 확인하지 못했습니다', false],
    [422, 'OBJECT_MISSING', '원본 무결성을 확인하지 못했습니다', false],
    [422, 'SIZE_MISMATCH', '원본 무결성을 확인하지 못했습니다', false],
    [422, 'MEDIA_TYPE_MISMATCH', '원본 무결성을 확인하지 못했습니다', false],
    [422, 'HASH_MISMATCH', '원본 무결성을 확인하지 못했습니다', false],
    [422, 'UNSUPPORTED_IMAGE_TYPE', '미리보기를 지원하지 않는 원본입니다', false],
    [422, 'EVIDENCE_CONTENT_TOO_LARGE', '미리보기를 지원하지 않는 원본입니다', false],
    [503, 'STORAGE_UNAVAILABLE', '원본 저장소에 연결하지 못했습니다', true],
    [503, 'EVIDENCE_CONTENT_BUSY', '원본 열람 요청이 많습니다', true],
    [503, 'AUDIT_UNAVAILABLE', '열람 기록을 저장하지 못해 원본을 표시하지 않았습니다', true],
    [503, 'DEPENDENCY_UNAVAILABLE', '서버가 일시적으로 응답할 수 없습니다', true],
    [400, 'INVALID_REQUEST', '요청 값이 올바르지 않습니다', false],
  ])('%s %s는 고정 문구로 표시하고 내부 정보와 이미지를 노출하지 않는다', async (status, code, title, retryable) => {
    stubFetch(() => problem(status, code))
    renderApp()
    const region = await openPreview()
    const alert = await within(region).findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(document.body.textContent).not.toMatch(/evidence-bucket|object-key|versionId|tenant-b/)
    expect(within(region).queryByRole('img')).not.toBeInTheDocument()
    expect(created).toHaveLength(0)
    if (retryable) expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    else expect(within(alert).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    // 이미지 실패는 증거 메타데이터와 분석 이력 표시를 바꾸지 않는다.
    expect(screen.getByRole('region', { name: '선택한 증거 정보' })).toHaveTextContent(SHA)
  })

  it('네트워크 장애와 503 이후 다시 시도하면 같은 증거를 다시 요청해 표시한다', async () => {
    const responses: (Response | Error)[] = [new TypeError('offline'), problem(503, 'STORAGE_UNAVAILABLE'), image(SYNTHETIC_PNG, 'image/png')]
    const fetchMock = stubFetch(() => {
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next
    })
    renderApp()
    const region = await openPreview()
    expect(await within(region).findByRole('alert')).toHaveTextContent('서버에 연결하지 못했습니다')
    fireEvent.click(within(region).getByRole('button', { name: '다시 시도' }))
    expect(await within(region).findByRole('alert')).toHaveTextContent('원본 저장소에 연결하지 못했습니다')
    fireEvent.click(within(region).getByRole('button', { name: '다시 시도' }))
    expect(await within(region).findByRole('img')).toHaveAttribute('src', 'blob:synthetic-1')
    expect(contentCalls(fetchMock).map(([url]) => String(url))).toEqual([contentPath(), contentPath(), contentPath()])
  })

  it('표시한 이미지를 다시 불러오면 이전 Blob URL을 해제하고 새 URL로 교체한다', async () => {
    stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    renderApp()
    const region = await openPreview()
    await within(region).findByRole('img')
    fireEvent.click(within(region).getByRole('button', { name: '다시 불러오기' }))
    await waitFor(() => expect(within(region).getByRole('img')).toHaveAttribute('src', 'blob:synthetic-2'))
    expect(revoked).toEqual(['blob:synthetic-1'])
    expect(liveUrls()).toEqual(['blob:synthetic-2'])
  })

  it('다운로드와 예매 대조는 연결하지 않고 미리보기가 분석이나 Case 생성을 요청하지 않으며 이미지와 토큰을 브라우저 저장소에 남기지 않는다', async () => {
    const fetchMock = stubFetch(() => image(SYNTHETIC_PNG, 'image/png'))
    renderApp()
    const region = await openPreview()
    const img = await within(region).findByRole('img')
    expect(img.closest('a')).toBeNull()
    expect(screen.queryByRole('link', { name: /다운로드/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /다운로드/ })).not.toBeInTheDocument()
    expect(document.querySelector('a[download]')).toBeNull()
    // 예매 후보 대조는 Issue #37에서 분석별 명시적 실행으로 연결했고, 수동 교정은 계속 막는다.
    expect(screen.getByRole('button', { name: '관찰값 수동 교정' })).toBeDisabled()
    // Case 생성은 관리자가 사유를 입력해 누를 때만 요청한다. 미리보기는 생성 요청을 만들지 않는다.
    expect(screen.getByRole('region', { name: 'Case 생성' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    const stored = JSON.stringify({ ...sessionStorage, ...localStorage })
    expect(stored).not.toContain(SYNTHETIC_TOKEN)
    expect(stored).not.toContain('blob:')
    expect(within(region).getByText(/다운로드는 지원하지 않습니다/)).toBeInTheDocument()
  })
})
