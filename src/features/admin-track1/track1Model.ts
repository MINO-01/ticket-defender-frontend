import { signalLabels } from './demoData'
import type { Cluster, SignalKind, Track1Dataset } from './demoData'

export type ListFilters = { query: string; eventId: string; signal: SignalKind | ''; sort: 'priority-desc' | 'priority-asc' | 'recent' }
export const defaultFilters: ListFilters = { query: '', eventId: '', signal: '', sort: 'priority-desc' }
export const pageSize = 4

function uniqueIds(ids: unknown[]): boolean {
  return ids.every((id) => typeof id === 'string' && id.trim().length > 0) && new Set(ids).size === ids.length
}

export function isValidDataset(data: Track1Dataset): boolean {
  if (!data || !Array.isArray(data.events) || !Array.isArray(data.runs) || !Array.isArray(data.clusters)) return false
  if (!data.events.every((event) => event && typeof event.id === 'string' && typeof event.name === 'string' && event.name.trim().length > 0) ||
    !data.runs.every((run) => run && typeof run.id === 'string' && typeof run.analyzedAt === 'string' && run.analyzedAt.trim().length > 0 &&
      typeof run.method === 'string' && typeof run.version === 'string')) return false
  if (!uniqueIds(data.events.map((event) => event.id)) || !uniqueIds(data.runs.map((run) => run.id)) ||
    !uniqueIds(data.clusters.map((cluster) => cluster?.id))) return false
  const eventIds = new Set(data.events.map((event) => event.id))
  const runIds = new Set(data.runs.map((run) => run.id))
  return data.clusters.every((cluster) => {
    if (!cluster || typeof cluster.id !== 'string' || !eventIds.has(cluster.eventId) || !runIds.has(cluster.analysisRunId) ||
      !Number.isFinite(cluster.priority) || cluster.priority < 0 || cluster.priority > 100 ||
      !Array.isArray(cluster.accounts) || !Array.isArray(cluster.reservations) || !Array.isArray(cluster.signals)) return false
    if (!cluster.accounts.every((account) => account && typeof account.id === 'string' && typeof account.label === 'string' && account.label.trim().length > 0) ||
      !cluster.reservations.every((reservation) => reservation && typeof reservation.id === 'string' && typeof reservation.accountId === 'string' &&
        typeof reservation.seat === 'string' && reservation.seat.trim().length > 0) ||
      !cluster.signals.every((signal) => signal && typeof signal.id === 'string' && typeof signal.label === 'string' && signal.label.trim().length > 0 &&
        Object.hasOwn(signalLabels, signal.kind) && Array.isArray(signal.accountIds) &&
        signal.accountIds.length >= 2 && uniqueIds(signal.accountIds) && typeof signal.evidence === 'string' && signal.evidence.trim().length > 0)) return false
    if (!uniqueIds([...cluster.accounts.map((account) => account.id), ...cluster.reservations.map((reservation) => reservation.id),
      ...cluster.signals.map((signal) => signal.id)])) return false
    const accountIds = new Set(cluster.accounts.map((account) => account.id))
    return cluster.reservations.every((reservation) => accountIds.has(reservation.accountId)) &&
      cluster.signals.every((signal) => signal.accountIds.length > 0 && signal.accountIds.every((id) => accountIds.has(id)))
  })
}

export function filterClusters(data: Track1Dataset, filters: ListFilters): Cluster[] {
  const needle = filters.query.trim().toLocaleLowerCase()
  return data.clusters.filter((cluster) => {
    const event = data.events.find((item) => item.id === cluster.eventId)
    const run = data.runs.find((item) => item.id === cluster.analysisRunId)
    const searchable = [cluster.id, event?.name, run?.id, ...cluster.accounts.map((item) => item.id), ...cluster.reservations.map((item) => item.id)].join(' ').toLocaleLowerCase()
    return (!needle || searchable.includes(needle)) && (!filters.eventId || cluster.eventId === filters.eventId) &&
      (!filters.signal || cluster.signals.some((signal) => signal.kind === filters.signal))
  }).sort((a, b) => {
    if (filters.sort === 'priority-asc') return a.priority - b.priority || a.id.localeCompare(b.id)
    if (filters.sort === 'recent') {
      const aTime = data.runs.find((run) => run.id === a.analysisRunId)?.analyzedAt ?? ''
      const bTime = data.runs.find((run) => run.id === b.analysisRunId)?.analyzedAt ?? ''
      return bTime.localeCompare(aTime) || a.id.localeCompare(b.id)
    }
    return b.priority - a.priority || a.id.localeCompare(b.id)
  })
}

export type GraphNode = { id: string; label: string; graphLabel: string; kind: 'account' | 'reservation' | 'signal'; signalKind?: SignalKind; detail: string }
export type GraphEdge = { id: string; source: string; target: string; label: string; evidence: string; signalKind?: SignalKind; caution?: string }
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] }

function edgeId(source: string, target: string): string {
  return `EDGE-${source.length}:${source}-${target}`
}

export function buildGraph(cluster: Cluster, signalFilter: SignalKind | '' = ''): GraphModel {
  const signals = cluster.signals.filter((signal) => !signalFilter || signal.kind === signalFilter)
  const nodes: GraphNode[] = [
    ...cluster.accounts.map((account, index) => ({ id: account.id, label: account.label, graphLabel: `계정 ${index + 1}`, kind: 'account' as const, detail: '합성 계정 식별자' })),
    ...cluster.reservations.map((reservation, index) => ({ id: reservation.id, label: reservation.id, graphLabel: `예매 ${index + 1}`, kind: 'reservation' as const, detail: `${reservation.seat} · 합성 예매` })),
    ...signals.map((signal, index) => ({ id: signal.id, label: signal.label, graphLabel: `${signalLabels[signal.kind].replace(' 참조', '').replace('접속 ', '')} ${index + 1}`, kind: 'signal' as const, signalKind: signal.kind, detail: signal.evidence })),
  ]
  const edges: GraphEdge[] = [
    ...cluster.reservations.map((reservation) => ({
      id: edgeId(reservation.accountId, reservation.id), source: reservation.accountId, target: reservation.id,
      label: '계정의 예매', evidence: `${reservation.accountId}의 예매 ${reservation.id} (${reservation.seat})`,
    })),
    ...signals.flatMap((signal) => signal.accountIds.map((accountId) => ({
      id: edgeId(accountId, signal.id), source: accountId, target: signal.id,
      label: signal.label, evidence: signal.evidence, signalKind: signal.kind, caution: signal.caution,
    }))),
  ]
  return { nodes, edges }
}
