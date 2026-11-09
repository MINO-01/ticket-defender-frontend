import { describe, expect, it } from 'vitest'
import { toGraphModel, track1ClusterGraphPath, track1ClusterGraphSchema } from '../features/admin-track1/track1GraphApi'

// PROPOSED 그래프 계약의 검증과 화면 모델 변환을 확인한다. 모든 값은 합성 데이터이며 실제 Backend 응답 검증을 대체하지 않는다.
const RAW_LABEL = 'raw-account-synthetic-9001'

function graph(overrides: Record<string, unknown> = {}) {
  return {
    analysisRequestId: 'run-1', clusterId: 'cluster-1', algorithmVersion: '1.0.0', coverage: 'STORED_EVIDENCE_ONLY', warnings: [],
    nodes: [
      { id: 'n-a1', label: RAW_LABEL, kind: 'ACCOUNT' },
      { id: 'n-a2', label: RAW_LABEL, kind: 'ACCOUNT' },
      { id: 'n-r1', label: 'raw-reservation-synthetic', kind: 'RESERVATION' },
      { id: 'n-s1', label: 'hmac-synthetic-token', kind: 'SIGNAL', signalType: 'DEVICE_ID_HASH' },
      { id: 'n-s2', label: 'hmac-synthetic-token-2', kind: 'SIGNAL' },
    ],
    edges: [
      { id: 'e-1', source: 'n-a1', target: 'n-r1', kind: 'RESERVATION' },
      { id: 'e-2', source: 'n-a1', target: 'n-s1', kind: 'SHARED_SIGNAL' },
      { id: 'e-3', source: 'n-s1', target: 'n-a2', kind: 'SHARED_SIGNAL' },
    ],
    ...overrides,
  }
}

const baseNodes = graph().nodes

describe('Track 1 그래프 계약', () => {
  it('정상 응답을 받아들이고 세 식별자로 경로를 만든다', () => {
    expect(track1ClusterGraphSchema.safeParse(graph()).success).toBe(true)
    expect(track1ClusterGraphPath({ eventId: 'e', analysisRequestId: 'run/1', clusterId: 'c 1' })).toBe('/api/v1/admin/track1/clusters/graph?eventId=e&analysisRequestId=run%2F1&clusterId=c%201')
  })

  it.each([
    ['없는 노드를 참조하는 간선', { edges: [{ id: 'e-1', source: 'n-a1', target: 'missing', kind: 'SHARED_SIGNAL' }] }],
    ['잘못된 노드 kind', { nodes: [{ id: 'n-1', label: 'x', kind: 'PAYMENT' }], edges: [] }],
    ['잘못된 간선 kind', { edges: [{ id: 'e-1', source: 'n-a1', target: 'n-s1', kind: 'SAME_PERSON' }] }],
    ['잘못된 signalType', { nodes: [{ id: 'n-1', label: 'x', kind: 'SIGNAL', signalType: 'PAYMENT_HASH' }], edges: [] }],
    ['SIGNAL이 아닌 노드의 signalType', { nodes: [{ id: 'n-1', label: 'x', kind: 'ACCOUNT', signalType: 'IP_HASH' }], edges: [] }],
    ['중복 노드 ID', { nodes: [...baseNodes, baseNodes[0]] }],
    ['중복 간선 ID', { edges: [{ id: 'e-1', source: 'n-a1', target: 'n-r1', kind: 'RESERVATION' }, { id: 'e-1', source: 'n-a2', target: 'n-r1', kind: 'RESERVATION' }] }],
    ['노드와 같은 간선 ID', { edges: [{ id: 'n-a1', source: 'n-a1', target: 'n-r1', kind: 'RESERVATION' }] }],
    ['RESERVATION 간선의 끝점 불일치', { edges: [{ id: 'e-1', source: 'n-a1', target: 'n-a2', kind: 'RESERVATION' }] }],
    ['신호 노드가 없는 SHARED_SIGNAL 간선', { edges: [{ id: 'e-1', source: 'n-a1', target: 'n-a2', kind: 'SHARED_SIGNAL' }] }],
    ['다른 coverage', { coverage: 'COMPLETE' }],
    ['warnings 누락', { warnings: undefined }],
  ])('%s 응답을 거부한다', (_name, overrides) => {
    expect(track1ClusterGraphSchema.safeParse(graph(overrides)).success).toBe(false)
  })

  it('순번 라벨만 만들고 서버 ID와 연결은 유지하며 간선을 추가하지 않는다', () => {
    const model = toGraphModel(track1ClusterGraphSchema.parse(graph()))
    expect(model.nodes.map((node) => node.graphLabel)).toEqual(['계정 1', '계정 2', '예매 1', '공유 기기 1', '공유 신호 1'])
    expect(model.nodes.map((node) => node.id)).toEqual(baseNodes.map((node) => node.id))
    expect(model.edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual(graph().edges.map((edge) => [edge.id, edge.source, edge.target]))
    expect(model.edges.map((edge) => edge.relation)).toEqual(['reservation', 'shared-signal', 'shared-signal'])
    expect(model.edges[1].label).toBe('공유 기기')
  })

  it('서버 label을 화면 모델로 옮기지 않는다', () => {
    const serialized = JSON.stringify(toGraphModel(track1ClusterGraphSchema.parse(graph({ nodes: [...baseNodes, { id: 'n-x', label: '<img src=x onerror=alert(1)>', kind: 'ACCOUNT' }] }))))
    for (const raw of [RAW_LABEL, 'raw-reservation-synthetic', 'hmac-synthetic-token', '<img']) expect(serialized).not.toContain(raw)
  })
})
