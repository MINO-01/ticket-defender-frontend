import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode, Suspense } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { ClusterDetailPage } from '../features/admin-track1/ClusterDetailPage'
import { ClusterListPage } from '../features/admin-track1/ClusterListPage'
import { ClusterGraph } from '../features/admin-track1/ClusterGraph'
import { AdminRouteErrorBoundary } from '../features/admin-track1/AdminRouteErrorBoundary'
import { demoTrack1Data } from '../features/admin-track1/demoData'
import { buildGraph, filterClusters, defaultFilters, isValidDataset } from '../features/admin-track1/track1Model'
import { enableAdminDemoPreview } from './adminPreview'

enableAdminDemoPreview()

const graphMock = vi.hoisted(() => ({
  created: 0,
  destroyed: 0,
  registered: 0,
  removed: 0,
  positioned: 0,
  resized: 0,
  handler: null as null | ((event: { target: { id: () => string } }) => void),
}))
vi.mock('cytoscape', () => ({ default: () => {
  graphMock.created += 1
  return {
    on: (_type: string, _selector: string, handler: typeof graphMock.handler) => { graphMock.registered += 1; graphMock.handler = handler },
    off: () => { graphMock.removed += 1; graphMock.handler = null },
    destroy: () => { graphMock.destroyed += 1 },
    elements: () => ({ unselect: () => ({ removeClass: () => {} }) }),
    $id: () => ({ select: () => {}, neighborhood: () => ({ addClass: () => {} }) }),
    nodes: () => ({ positions: () => { graphMock.positioned += 1 } }),
    resize: () => { graphMock.resized += 1 },
    zoom: (value?: number) => value ?? 1,
    fit: () => {},
  }
} }))

function renderApp(path: string) { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>) }
function renderList(state: 'ready' | 'loading' | 'failed' | 'forbidden' = 'ready', data = demoTrack1Data) {
  return render(<MemoryRouter><ClusterListPage state={state} data={data} /></MemoryRouter>)
}

beforeEach(() => { graphMock.created = 0; graphMock.destroyed = 0; graphMock.registered = 0; graphMock.removed = 0; graphMock.positioned = 0; graphMock.resized = 0; graphMock.handler = null })

describe('연관 예매 군집 목록', () => {
  it('끝에 슬래시가 있는 목록 경로도 관리자 화면으로 연다', async () => {
    renderApp('/app/analysis/findings/')
    expect(await screen.findByRole('heading', { name: '연관 예매 군집' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '관리자 탐색' })).toBeInTheDocument()
  })

  it('Fixture에서 건수와 페이지를 계산하고 상세로 이동한다', async () => {
    renderApp('/app/analysis/findings')
    expect(await screen.findByRole('heading', { name: '연관 예매 군집' })).toBeInTheDocument()
    expect(screen.getByText('7건')).toBeInTheDocument()
    expect(screen.getByText('1 / 2 페이지')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'DEMO-CL-005 상세 보기' }))
    expect(await screen.findByRole('heading', { name: '군집 DEMO-CL-005' })).toBeInTheDocument()
  })

  it('검색·공연·신호 필터를 반영하고 정렬과 초기화가 동작한다', () => {
    renderList()
    fireEvent.change(screen.getByRole('textbox', { name: '검색' }), { target: { value: 'DEMO-CL-001' } })
    expect(screen.getByText('1건')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '공연' }), { target: { value: 'DEMO-EVT-B' } })
    expect(screen.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeInTheDocument()
    expect(screen.getAllByText('0건')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    fireEvent.change(screen.getByRole('combobox', { name: '연결 정보' }), { target: { value: 'IP' } })
    expect(screen.getByText('3건')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '정렬' }), { target: { value: 'priority-asc' } })
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(within(rows[1]).getByText('DEMO-CL-004')).toBeInTheDocument()
  })

  it('빈 데이터·형식 오류·조회 실패·권한 제한을 구분한다', () => {
    const empty = { ...demoTrack1Data, clusters: [] }
    const view = renderList('ready', empty)
    expect(screen.getByRole('heading', { name: '분석 군집이 없습니다' })).toBeInTheDocument()
    expect(screen.getAllByText('0건')).toHaveLength(2)
    view.rerender(<MemoryRouter><ClusterListPage data={{ ...demoTrack1Data, clusters: [{ ...demoTrack1Data.clusters[0], eventId: 'missing' }] }} /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('군집 데이터 형식')
    view.rerender(<MemoryRouter><ClusterListPage state="failed" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
    view.rerender(<MemoryRouter><ClusterListPage state="forbidden" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    view.rerender(<MemoryRouter><ClusterListPage state="loading" /></MemoryRouter>)
    expect(screen.getByRole('status', { name: '군집 목록을 불러오는 중' })).toBeInTheDocument()
  })

  it('마지막 페이지에서 데이터가 줄어도 유효한 페이지와 건수를 표시한다', () => {
    const view = renderList()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '검색' }), { target: { value: 'DEMO-CL-001' } })
    expect(screen.getByText('1 / 1 페이지')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('DEMO-CL-001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    view.rerender(<MemoryRouter><ClusterListPage data={{ ...demoTrack1Data, clusters: demoTrack1Data.clusters.slice(0, 2) }} /></MemoryRouter>)
    expect(screen.getByText('1 / 1 페이지')).toBeInTheDocument()
    expect(screen.getByText('2건 중 1–2건 표시')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
  })

  it('검색·필터·정렬 순서와 동일 점수의 순서를 유지한다', () => {
    const tied = { ...demoTrack1Data, clusters: demoTrack1Data.clusters.map((cluster) => cluster.id === 'DEMO-CL-002' ? { ...cluster, priority: 82 } : cluster) }
    const result = filterClusters(tied, { query: 'Autumn', eventId: 'DEMO-EVT-A', signal: 'DEVICE', sort: 'priority-desc' })
    expect(result.map((cluster) => cluster.id)).toEqual(['DEMO-CL-001', 'DEMO-CL-002'])
    expect(filterClusters(tied, { query: 'Autumn', eventId: 'DEMO-EVT-B', signal: 'DEVICE', sort: 'priority-desc' })).toHaveLength(0)
    const searched = filterClusters(tied, { query: 'DEMO-CL-002', eventId: 'DEMO-EVT-A', signal: 'DEVICE', sort: 'priority-asc' })
    expect(searched.map((cluster) => cluster.id)).toEqual(['DEMO-CL-002'])
  })
})

describe('그래프 데이터 정합성', () => {
  it('모든 Fixture의 노드·간선 ID와 끝점 및 근거가 유효하다', () => {
    expect(isValidDataset(demoTrack1Data)).toBe(true)
    for (const cluster of demoTrack1Data.clusters) {
      const graph = buildGraph(cluster)
      const nodeIds = new Set(graph.nodes.map((node) => node.id))
      const edgeIds = new Set(graph.edges.map((edge) => edge.id))
      expect(nodeIds.size).toBe(graph.nodes.length)
      expect(edgeIds.size).toBe(graph.edges.length)
      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true)
        expect(nodeIds.has(edge.target)).toBe(true)
        expect(edge.evidence.trim().length).toBeGreaterThan(0)
        expect(graph.nodes.find((node) => node.id === edge.source)?.kind).toBe('account')
        expect(graph.nodes.find((node) => node.id === edge.target)?.kind).not.toBe('account')
      }
      for (const signal of cluster.signals) {
        const signalEdges = graph.edges.filter((edge) => edge.target === signal.id)
        expect(signalEdges.map((edge) => edge.source).sort()).toEqual([...signal.accountIds].sort())
        expect(signalEdges.every((edge) => edge.evidence === signal.evidence)).toBe(true)
      }
      for (const reservation of cluster.reservations) {
        expect(graph.edges.filter((edge) => edge.target === reservation.id).map((edge) => edge.source)).toEqual([reservation.accountId])
      }
    }
  })

  it('신호 필터는 해당 신호 노드·간선만 남기고 계정과 예매 연결은 유지한다', () => {
    const cluster = demoTrack1Data.clusters[0]
    const full = buildGraph(cluster)
    const filtered = buildGraph(cluster, 'IP')
    expect(filtered.nodes.filter((node) => node.kind === 'signal').map((node) => node.id)).toEqual(cluster.signals.filter((signal) => signal.kind === 'IP').map((signal) => signal.id))
    expect(filtered.edges.filter((edge) => edge.signalKind).every((edge) => edge.signalKind === 'IP')).toBe(true)
    expect(filtered.edges.filter((edge) => !edge.signalKind)).toHaveLength(cluster.reservations.length)
    expect(filtered.nodes.length).toBeLessThan(full.nodes.length)
  })

  it('중복 ID, 없는 끝점, 중복 구성원과 빈 근거를 형식 오류로 거부한다', () => {
    const cluster = demoTrack1Data.clusters[0]
    const invalid = [
      { ...cluster, accounts: [...cluster.accounts, cluster.accounts[0]] },
      { ...cluster, reservations: [{ ...cluster.reservations[0], accountId: 'missing' }, ...cluster.reservations.slice(1)] },
      { ...cluster, signals: [{ ...cluster.signals[0], accountIds: [cluster.accounts[0].id, cluster.accounts[0].id] }, ...cluster.signals.slice(1)] },
      { ...cluster, signals: [{ ...cluster.signals[0], evidence: '  ' }, ...cluster.signals.slice(1)] },
      { ...cluster, signals: [{ ...cluster.signals[0], id: cluster.accounts[0].id }, ...cluster.signals.slice(1)] },
    ]
    for (const candidate of invalid) expect(isValidDataset({ ...demoTrack1Data, clusters: [candidate] })).toBe(false)
    expect(isValidDataset({ ...demoTrack1Data, clusters: [cluster, cluster] })).toBe(false)
  })

  it('합성 조사 우선순위의 표시 범위와 참조 ID를 검증한다', () => {
    const cluster = demoTrack1Data.clusters[0]
    for (const priority of [0, 100]) expect(isValidDataset({ ...demoTrack1Data, clusters: [{ ...cluster, priority }] })).toBe(true)
    for (const priority of [-1, 101, Infinity]) expect(isValidDataset({ ...demoTrack1Data, clusters: [{ ...cluster, priority }] })).toBe(false)
    expect(isValidDataset({ ...demoTrack1Data, clusters: [{ ...cluster, eventId: 'missing' }] })).toBe(false)
    expect(isValidDataset({ ...demoTrack1Data, clusters: [{ ...cluster, analysisRunId: 'missing' }] })).toBe(false)
    expect(isValidDataset({ ...demoTrack1Data, clusters: [{ ...cluster, signals: [{ ...cluster.signals[0], accountIds: ['missing', cluster.accounts[0].id] }] }] })).toBe(false)
  })

  it('구분자가 포함된 ID에서도 생성된 간선 ID가 충돌하지 않는다', () => {
    const cluster = { ...demoTrack1Data.clusters[0], accounts: [{ id: 'A-B', label: '계정 A' }, { id: 'A', label: '계정 B' }], reservations: [{ id: 'C', accountId: 'A-B', seat: '가구역' }, { id: 'B-C', accountId: 'A', seat: '나구역' }], signals: [] }
    expect(isValidDataset({ ...demoTrack1Data, clusters: [cluster] })).toBe(true)
    const graph = buildGraph(cluster)
    expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length)
    expect(graph.nodes.find((node) => node.id === 'B-C')?.graphLabel).toBe('예매 2')
  })
})

describe('군집 상세와 그래프', () => {
  it('없는 군집에서 목록으로 복귀할 수 있다', async () => {
    renderApp('/app/analysis/findings/missing')
    expect(await screen.findByRole('heading', { name: '군집을 찾을 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '군집 목록으로 돌아가기' })).toHaveAttribute('href', '/app/analysis/findings')
  })

  it('그래프 노드와 목록의 간선을 선택해 근거를 확인한다', async () => {
    renderApp('/app/analysis/findings/DEMO-CL-001')
    await screen.findByRole('heading', { name: '군집 DEMO-CL-001' })
    expect(graphMock.created).toBe(1)
    const evidenceList = screen.getByText('목록으로 연결 근거 보기').closest('details')!
    expect(within(evidenceList).getAllByRole('button')).toHaveLength(buildGraph(demoTrack1Data.clusters[0]).edges.length)
    act(() => graphMock.handler?.({ target: { id: () => 'DEMO-ACC-1-1' } }))
    expect(screen.getByRole('heading', { name: '선택한 요소' }).parentElement).toHaveTextContent('시연 계정 1-1')
    expect(screen.getByRole('heading', { name: '선택한 요소' }).parentElement).toHaveTextContent('식별자: DEMO-ACC-1-1')
    const evidence = screen.getAllByRole('button', { name: /결제수단 참조/ })[0]
    fireEvent.click(evidence)
    expect(screen.getByRole('heading', { name: '선택한 요소' }).parentElement).toHaveTextContent('공유된 연결 근거')
    expect(graphMock.created).toBe(1)
    expect(screen.getByRole('button', { name: 'Case 생성' })).toBeDisabled()
  })

  it('신호 필터를 바꾸면 선택을 해제하고 그래프를 재생성하며 언마운트 때 파괴한다', async () => {
    const view = renderApp('/app/analysis/findings/DEMO-CL-001')
    await screen.findByRole('heading', { name: '군집 DEMO-CL-001' })
    fireEvent.click(screen.getAllByRole('button', { name: /결제수단 참조/ })[0])
    fireEvent.change(screen.getByRole('combobox', { name: '연결 신호 필터' }), { target: { value: 'IP' } })
    expect(screen.getByText('그래프 또는 아래 근거 목록에서 요소를 선택해 주세요.')).toBeInTheDocument()
    expect(within(screen.getByText('목록으로 연결 근거 보기').closest('details')!).getAllByRole('button')).toHaveLength(buildGraph(demoTrack1Data.clusters[0], 'IP').edges.length)
    expect(graphMock.created).toBe(2)
    expect(graphMock.destroyed).toBe(1)
    view.unmount()
    expect(graphMock.destroyed).toBe(2)
    const second = renderApp('/app/analysis/findings/DEMO-CL-001')
    expect(graphMock.created).toBe(3)
    second.unmount()
    expect(graphMock.destroyed).toBe(3)
  })

  it('모든 간선에 근거가 있고 계정 사이의 직접 간선을 만들지 않는다', () => {
    const graph = buildGraph(demoTrack1Data.clusters[0])
    expect(graph.edges.length).toBeGreaterThan(0)
    expect(graph.edges.every((edge) => edge.evidence.length > 0)).toBe(true)
    expect(graph.edges.every((edge) => !edge.target.startsWith('DEMO-ACC'))).toBe(true)
    expect(filterClusters(demoTrack1Data, defaultFilters)).toHaveLength(7)
  })

  it('상세의 조회 실패와 형식 오류를 표시한다', () => {
    const view = render(<MemoryRouter initialEntries={['/app/analysis/findings/DEMO-CL-001']}><Routes><Route path="/app/analysis/findings/:clusterId" element={<ClusterDetailPage state="failed" />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
    view.rerender(<MemoryRouter initialEntries={['/app/analysis/findings/DEMO-CL-001']}><Routes><Route path="/app/analysis/findings/:clusterId" element={<ClusterDetailPage data={{ ...demoTrack1Data, clusters: [{ ...demoTrack1Data.clusters[0], eventId: 'missing' }] }} />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('데이터 형식')
  })

  it('구성원이 없는 유효한 군집에는 빈 그래프 안내를 표시한다', () => {
    const empty = { ...demoTrack1Data.clusters[0], accounts: [], reservations: [], signals: [] }
    render(<MemoryRouter initialEntries={['/app/analysis/findings/DEMO-CL-001']}><Routes><Route path="/app/analysis/findings/:clusterId" element={<ClusterDetailPage data={{ ...demoTrack1Data, clusters: [empty] }} />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('heading', { name: '표시할 연결 관계가 없습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /관계 그래프/ })).not.toBeInTheDocument()
    expect(graphMock.created).toBe(0)
  })

  it('Strict Mode 재마운트에서도 핸들러 하나만 남기고 언마운트 시 정리한다', () => {
    const graph = buildGraph(demoTrack1Data.clusters[0])
    const view = render(<StrictMode><ClusterGraph graph={graph} selectedId={null} onSelect={() => {}} /></StrictMode>)
    expect(graphMock.created).toBeGreaterThanOrEqual(2)
    expect(graphMock.created - graphMock.destroyed).toBe(1)
    expect(graphMock.registered - graphMock.removed).toBe(1)
    view.unmount()
    expect(graphMock.created).toBe(graphMock.destroyed)
    expect(graphMock.registered).toBe(graphMock.removed)
  })

  it('화면 크기 변경 때 그래프를 재생성하지 않고 위치를 다시 맞춘다', () => {
    const graph = buildGraph(demoTrack1Data.clusters[0])
    const view = render(<ClusterGraph graph={graph} selectedId={null} onSelect={() => {}} />)
    fireEvent(window, new Event('resize'))
    expect(graphMock.created).toBe(1)
    expect(graphMock.positioned).toBe(1)
    expect(graphMock.resized).toBe(1)
    view.unmount()
    fireEvent(window, new Event('resize'))
    expect(graphMock.positioned).toBe(1)
  })

  it('다른 군집으로 이동하면 이전 인스턴스와 선택을 정리한다', async () => {
    renderApp('/app/analysis/findings/DEMO-CL-001')
    await screen.findByRole('heading', { name: '군집 DEMO-CL-001' })
    fireEvent.click(screen.getByRole('button', { name: '시연 계정 1-1' }))
    fireEvent.click(screen.getByRole('link', { name: '← 군집 목록' }))
    await screen.findByRole('heading', { name: '연관 예매 군집' })
    expect(graphMock.created).toBe(graphMock.destroyed)
    fireEvent.click(screen.getByRole('link', { name: 'DEMO-CL-003 상세 보기' }))
    await screen.findByRole('heading', { name: '군집 DEMO-CL-003' })
    expect(graphMock.created - graphMock.destroyed).toBe(1)
    expect(screen.getByText('그래프 또는 아래 근거 목록에서 요소를 선택해 주세요.')).toBeInTheDocument()
  })
})

describe('지연 로드 오류', () => {
  it('화면 코드 로드 실패 시 빈 화면 대신 복귀 링크를 표시한다', () => {
    const previous = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): never { throw new Error('chunk load failed') }
    try {
      render(<MemoryRouter><AdminRouteErrorBoundary backTo="/app/overview" backLabel="전체 현황으로 이동"><Suspense fallback={<p>열고 있습니다</p>}><Broken /></Suspense></AdminRouteErrorBoundary></MemoryRouter>)
      expect(screen.getByRole('alert')).toHaveTextContent('조사 화면을 열지 못했습니다')
      expect(screen.getByRole('link', { name: '전체 현황으로 이동' })).toHaveAttribute('href', '/app/overview')
    } finally { previous.mockRestore() }
  })
})
