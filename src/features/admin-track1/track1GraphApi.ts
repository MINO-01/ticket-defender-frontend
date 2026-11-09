import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { sharedSignalTypes } from './track1Api'
import type { SharedSignalType, Track1ClusterKey } from './track1Api'
import type { SignalKind } from './demoData'
import type { GraphEdge, GraphModel, GraphNode } from './track1Model'

// PROPOSED 계약이다. Backend의 GET /api/v1/admin/track1/clusters/graph 구현이 확정되면 실제 DTO에 맞춰 조정한다.
// signalType은 Frontend가 제안한 필드이며 값은 Backend Track1ClusterDto.SharedSignalType과 같다.
// 서버 label에는 원본 식별자가 포함될 수 있으므로 검증만 하고 화면 모델로 옮기지 않는다.
// demoData는 타입만 참조한다. 값을 가져오면 합성 데이터가 실제 화면 번들에 포함된다.

const opaqueIdSchema = z.string().min(1).max(512)

const graphNodeSchema = z.object({
  id: opaqueIdSchema,
  label: z.string(),
  kind: z.enum(['ACCOUNT', 'RESERVATION', 'SIGNAL']),
  signalType: z.enum(sharedSignalTypes).nullable().optional(),
})

const graphEdgeSchema = z.object({
  id: opaqueIdSchema,
  source: opaqueIdSchema,
  target: opaqueIdSchema,
  kind: z.enum(['RESERVATION', 'SHARED_SIGNAL']),
})

type GraphResponseShape = { nodes: z.infer<typeof graphNodeSchema>[]; edges: z.infer<typeof graphEdgeSchema>[] }

/** Cytoscape는 노드와 간선이 ID 공간을 공유하므로 둘을 합쳐 중복을 검사한다. 간선은 kind에 맞는 노드만 이을 수 있다. */
function isConsistentGraph({ nodes, edges }: GraphResponseShape) {
  const ids = [...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)]
  if (new Set(ids).size !== ids.length) return false
  if (nodes.some((node) => node.kind !== 'SIGNAL' && node.signalType != null)) return false
  const kinds = new Map(nodes.map((node) => [node.id, node.kind]))
  return edges.every((edge) => {
    const source = kinds.get(edge.source)
    const target = kinds.get(edge.target)
    if (source === undefined || target === undefined) return false
    if (edge.kind === 'RESERVATION') return [source, target].sort().join('+') === 'ACCOUNT+RESERVATION'
    return (source === 'SIGNAL') !== (target === 'SIGNAL')
  })
}

export const track1ClusterGraphSchema = z.object({
  analysisRequestId: z.string().min(1),
  clusterId: z.string().min(1),
  algorithmVersion: z.string().min(1).nullable(),
  coverage: z.literal('STORED_EVIDENCE_ONLY'),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  warnings: z.array(z.string().min(1).max(500)).max(50),
}).refine(isConsistentGraph)

export type Track1ClusterGraph = z.infer<typeof track1ClusterGraphSchema>

export function track1ClusterGraphPath(key: Track1ClusterKey) {
  return adminApiPath('/api/v1/admin/track1/clusters/graph', { eventId: key.eventId, analysisRequestId: key.analysisRequestId, clusterId: key.clusterId })
}

export function track1GraphRoute(eventId: string) {
  return `/app/analysis/findings/graph?${new URLSearchParams({ eventId })}`
}

const signalPresentation: Record<SharedSignalType, { kind: SignalKind; name: string; detail: string }> = {
  DEVICE_ID_HASH: { kind: 'DEVICE', name: '공유 기기', detail: '저장된 기기 식별 신호가 같은 구성원을 잇는 신호입니다. 신호 원문과 토큰은 표시하지 않습니다.' },
  IP_HASH: { kind: 'IP', name: '공유 IP', detail: '저장된 네트워크(IP) 신호가 같은 구성원을 잇는 신호입니다. 신호 원문과 토큰은 표시하지 않습니다.' },
}

const sharingCaution = '공용 기기나 같은 네트워크를 정상적으로 함께 쓴 경우일 수 있습니다.'

/** 화면용 순번 라벨을 붙인다. 서버의 노드 ID와 간선 연결은 그대로 두고, 응답에 없는 노드와 간선은 만들지 않는다. */
export function toGraphModel(graph: Track1ClusterGraph): GraphModel {
  const counts = new Map<string, number>()
  const nextLabel = (name: string) => {
    const count = (counts.get(name) ?? 0) + 1
    counts.set(name, count)
    return `${name} ${count}`
  }

  const nodes = graph.nodes.map((node): GraphNode => {
    if (node.kind === 'ACCOUNT') {
      const label = nextLabel('계정')
      return { id: node.id, label, graphLabel: label, kind: 'account', detail: '이 군집에 저장된 계정입니다. 원본 계정 식별자는 표시하지 않습니다.' }
    }
    if (node.kind === 'RESERVATION') {
      const label = nextLabel('예매')
      return { id: node.id, label, graphLabel: label, kind: 'reservation', detail: '이 군집에 저장된 예매입니다. 원본 예매참조는 표시하지 않습니다.' }
    }
    const signal = node.signalType ? signalPresentation[node.signalType] : null
    const label = nextLabel(signal?.name ?? '공유 신호')
    return { id: node.id, label, graphLabel: label, kind: 'signal', signalKind: signal?.kind, detail: signal?.detail ?? '서버 응답에 신호 종류가 없어 종류를 표시하지 않습니다.' }
  })

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges = graph.edges.map((edge): GraphEdge => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const evidence = `${source?.label} - ${target?.label} 연결은 서버 응답에 포함된 간선입니다.`
    if (edge.kind === 'RESERVATION') return { id: edge.id, source: edge.source, target: edge.target, relation: 'reservation', label: '계정의 예매', evidence }
    const signal = source?.kind === 'signal' ? source : target
    return {
      id: edge.id, source: edge.source, target: edge.target, relation: 'shared-signal', signalKind: signal?.signalKind,
      label: signal?.signalKind === 'DEVICE' ? '공유 기기' : signal?.signalKind === 'IP' ? '공유 IP' : '공유 신호', evidence, caution: sharingCaution,
    }
  })
  return { nodes, edges }
}
