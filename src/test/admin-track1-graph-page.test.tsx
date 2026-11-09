import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// Mock 인증과 fetch로 그래프 화면의 상태를 검증한다. 실제 Backend 연동을 대체하지 않으며 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const ROUTE = `/app/analysis/findings/graph?eventId=${EVENT_A}`
const RAW = ['raw-account-synthetic-9001', 'raw-reservation-synthetic', 'hmac-synthetic-token', 'node-opaque-a1']

const graphMock = vi.hoisted(() => ({ created: 0, destroyed: 0, registered: 0, removed: 0 }))
vi.mock('cytoscape', () => ({ default: () => {
  graphMock.created += 1
  return {
    on: () => { graphMock.registered += 1 },
    off: () => { graphMock.removed += 1 },
    destroy: () => { graphMock.destroyed += 1 },
    elements: () => ({ unselect: () => ({ removeClass: () => {} }) }),
    $id: () => ({ select: () => {}, neighborhood: () => ({ addClass: () => {} }) }),
    nodes: () => ({ positions: () => {} }),
    resize: () => {},
    zoom: (value?: number) => value ?? 1,
    fit: () => {},
  }
} }))
// 실제 관리자 화면이 합성 데이터를 불러오면 이 모의 모듈이 예외를 던져 테스트가 실패한다.
vi.mock('../features/admin-track1/demoData', () => { throw new Error('실제 화면에서 demoData를 불러왔습니다') })

const adapter = () => ({
  availability: { status: 'ready' },
  initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}) satisfies AdminAuthAdapter

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code }), { status, headers: { 'Content-Type': 'application/problem+json' } })

const event = { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }
const summary = (clusterId: string) => ({ analysisRequestId: 'run-1', clusterId, riskScore: 0.82, analysisAlgorithm: 'LOUVAIN', analysisAlgorithmVersion: '1.0.0', analyzedAt: '2026-10-08T10:15:30Z', storedMemberCount: 2 })
const clusters = [summary('cluster-1'), summary('cluster-2')]
const graph = (clusterId: string, overrides: Record<string, unknown> = {}) => ({
  analysisRequestId: 'run-1', clusterId, algorithmVersion: 'graph-1.0.0', coverage: 'STORED_EVIDENCE_RECONSTRUCTION', warnings: ['합성 경고 문구'],
  nodes: [
    { id: 'node-opaque-a1', label: 'raw-account-synthetic-9001', kind: 'ACCOUNT' },
    { id: 'node-opaque-r1', label: 'raw-reservation-synthetic', kind: 'RESERVATION' },
    { id: 'node-opaque-s1', label: '<img src=x onerror=alert(1)>hmac-synthetic-token', kind: 'SIGNAL', signalType: 'DEVICE_ID_HASH' },
  ],
  edges: [
    { id: 'edge-1', source: 'node-opaque-a1', target: 'node-opaque-r1', kind: 'RESERVATION' },
    { id: 'edge-2', source: 'node-opaque-a1', target: 'node-opaque-s1', kind: 'SHARED_SIGNAL' },
  ],
  ...overrides,
})

type GraphResponder = (clusterId: string) => Response
function stub(graphResponse: GraphResponder = (clusterId) => json(200, graph(clusterId))) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), 'http://local')
    const clusterId = url.searchParams.get('clusterId') ?? ''
    if (url.pathname === '/api/v1/admin/events') return json(200, { items: [event], page: 0, pageSize: 100, totalItems: 1, hasNext: false })
    if (url.pathname === '/api/v1/admin/track1/clusters') return json(200, { event, items: clusters, page: 0, pageSize: 20, totalItems: 2, hasNext: false, coverage: 'STORED_EVIDENCE_ONLY' })
    if (url.pathname === '/api/v1/admin/track1/clusters/graph') return graphResponse(clusterId)
    throw new Error(`예상하지 못한 요청: ${url.pathname}`)
  }))
}

const requestedPaths = () => vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), 'http://local').pathname)

const renderPage = () => render(<MemoryRouter initialEntries={[ROUTE]}><App adminAuthAdapter={adapter()} /></MemoryRouter>)

beforeEach(() => { Object.assign(graphMock, { created: 0, destroyed: 0, registered: 0, removed: 0 }) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Track 1 관계 그래프 화면', () => {
  it('서버 응답으로 그래프를 그리고 순번 라벨과 근거만 표시한다', async () => {
    stub()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '공유 기기 1' }))
    expect(await screen.findByText('합성 경고 문구')).toBeInTheDocument()
    expect(screen.getByText('graph-1.0.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1번째 그룹 구성원 2건, 조사 우선순위 0.82 LOUVAIN 1.0.0' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText(/부정거래 확률이 아닙니다\.$/, { selector: 'small' })).toBeInTheDocument()
    expect(graphMock.created).toBe(1)
    expect(within(screen.getByRole('region', { name: '분석 정보' })).getByText(/^0\.82/)).toBeInTheDocument()
    expect(requestedPaths()).toContain('/api/v1/admin/track1/clusters/graph')
    expect(requestedPaths()).not.toContain('/api/v1/admin/track1/clusters/detail')
    for (const raw of RAW) expect(document.body.textContent).not.toContain(raw)
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('군집을 바꾸면 이전 그래프 인스턴스와 이벤트를 정리한다', async () => {
    stub()
    renderPage()
    await screen.findByRole('button', { name: '계정 1' })
    fireEvent.click(screen.getByRole('button', { name: /^2번째 그룹/ }))
    await waitFor(() => expect(graphMock.created).toBe(2))
    expect(graphMock.destroyed).toBe(1)
    expect(graphMock.removed).toBe(1)
  })

  it('요청과 다른 군집의 응답은 표시하지 않는다', async () => {
    stub(() => json(200, graph('cluster-other')))
    renderPage()
    expect(await screen.findByText('서버 응답 형식이 계약과 다릅니다')).toBeInTheDocument()
    expect(graphMock.created).toBe(0)
  })

  it('잘못된 간선 응답을 거부한다', async () => {
    stub((clusterId) => json(200, graph(clusterId, { edges: [{ id: 'edge-1', source: 'node-opaque-a1', target: 'missing', kind: 'SHARED_SIGNAL' }] })))
    renderPage()
    expect(await screen.findByText('서버 응답 형식이 계약과 다릅니다')).toBeInTheDocument()
    expect(graphMock.created).toBe(0)
  })

  it('정상 빈 그래프와 API 실패를 구분한다', async () => {
    stub((clusterId) => json(200, graph(clusterId, { nodes: [], edges: [] })))
    const { unmount } = renderPage()
    expect(await screen.findByText('저장된 관계가 없습니다')).toBeInTheDocument()
    unmount()
    stub(() => problem(500, 'INTERNAL'))
    renderPage()
    expect(await screen.findByText('서버 오류로 조회하지 못했습니다')).toBeInTheDocument()
    expect(screen.queryByText('저장된 관계가 없습니다')).toBeNull()
  })

  it.each([
    [401, '관리자 세션이 종료되었습니다'],
    [403, '이 화면에 필요한 역할이 없습니다'],
  ])('%i 응답의 권한 오류를 표시한다', async (status, title) => {
    stub(() => problem(status, 'DENIED'))
    renderPage()
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(graphMock.created).toBe(0)
  })
})
