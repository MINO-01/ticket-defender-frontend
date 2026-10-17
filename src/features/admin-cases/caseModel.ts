import { z } from 'zod'
import type { Track1Dataset } from '../admin-track1/demoData'
import { isValidDataset } from '../admin-track1/track1Model'
import { isValidTrack2Dataset } from '../admin-track2/track2Model'
import type { Track2Dataset } from '../admin-track2/track2Model'

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GRAPH_CLUSTER'), clusterId: z.string().min(1), analysisRunId: z.string().min(1) }),
  z.object({ kind: z.literal('FAN_REPORT'), reportId: z.string().min(1) }),
])
const activitySchema = z.object({ id: z.string().min(1), at: z.string().datetime({ offset: true }), kind: z.enum(['CREATED', 'ASSIGNED', 'REVIEWED', 'EVIDENCE_REQUESTED']), detail: z.string().trim().min(1) })
const caseSchema = z.object({
  id: z.string().min(1), eventId: z.string().min(1), type: z.enum(['GRAPH_CLUSTER', 'FAN_REPORT', 'COMBINED']),
  status: z.enum(['OPEN', 'TRIAGED', 'IN_REVIEW', 'NEEDS_EVIDENCE', 'READY_FOR_APPROVAL']),
  assignee: z.string().trim().min(1).nullable(), priority: z.number().int().min(0).max(100),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  summary: z.string().trim().min(1), linkReason: z.string().trim().min(1).nullable(),
  sources: z.array(sourceSchema).min(1), facts: z.array(z.string().trim().min(1)).min(1),
  clues: z.array(z.string().trim().min(1)), unknowns: z.array(z.string().trim().min(1)).min(1),
  activities: z.array(activitySchema).min(1),
})
const datasetSchema = z.object({ cases: z.array(caseSchema) })
export type CaseRecord = z.infer<typeof caseSchema>
export type CaseDataset = z.infer<typeof datasetSchema>
export type CaseSourceReference = z.infer<typeof sourceSchema>
export type CaseActivity = z.infer<typeof activitySchema>
export type CaseEvidenceSummary = { sourceCount: number; evidenceFileCount: number }
export type CaseStatus = CaseRecord['status']
export type CaseType = CaseRecord['type']
export type CaseFilters = { query: string; type: CaseType | ''; status: CaseStatus | ''; assignee: string; sort: 'priority-desc' | 'priority-asc' | 'updated-desc' | 'updated-asc' }
export const defaultCaseFilters: CaseFilters = { query: '', type: '', status: '', assignee: '', sort: 'updated-desc' }
export const casePageSize = 5
export const caseTypeLabels: Record<CaseType, string> = { GRAPH_CLUSTER: '연관 예매', FAN_REPORT: '팬 제보', COMBINED: '복합 검토' }
export const caseStatusLabels: Record<CaseStatus, string> = { OPEN: '접수', TRIAGED: '분류 완료', IN_REVIEW: '검토 중', NEEDS_EVIDENCE: '추가 자료 필요', READY_FOR_APPROVAL: '승인 검토 대기' }

export function caseEvents(track1: Track1Dataset, track2: Track2Dataset) {
  return [...new Map([...track1.events, ...track2.events].map((event) => [event.id, event])).values()]
}

export function summarizeCaseEvidence(item: CaseRecord, track2: Track2Dataset): CaseEvidenceSummary {
  return {
    sourceCount: item.sources.length,
    evidenceFileCount: item.sources.reduce((count, source) => source.kind === 'FAN_REPORT'
      ? count + (track2.reports.find((report) => report.id === source.reportId)?.evidenceIds.length ?? 0) : count, 0),
  }
}

function unique(ids: string[]) { return new Set(ids).size === ids.length }
function time(value: string) { return Date.parse(value) }

export function isValidCaseDataset(input: unknown, track1: Track1Dataset, track2: Track2Dataset): input is CaseDataset {
  if (!isValidDataset(track1) || !isValidTrack2Dataset(track2)) return false
  const parsed = datasetSchema.safeParse(input)
  if (!parsed.success) return false
  const data = parsed.data
  if (!unique(data.cases.map((item) => item.id))) return false
  const track1Events = new Map(track1.events.map((event) => [event.id, event.name]))
  if (track2.events.some((event) => track1Events.has(event.id) && track1Events.get(event.id) !== event.name)) return false
  const events = new Set(caseEvents(track1, track2).map((event) => event.id))
  const clusters = new Map(track1.clusters.map((cluster) => [cluster.id, cluster]))
  const runs = new Set(track1.runs.map((run) => run.id))
  const reports = new Map(track2.reports.map((report) => [report.id, report]))
  return data.cases.every((item) => {
    if (!events.has(item.eventId)) return false
    const graph = item.sources.filter((source) => source.kind === 'GRAPH_CLUSTER')
    const fan = item.sources.filter((source) => source.kind === 'FAN_REPORT')
    if (item.type === 'GRAPH_CLUSTER' && (graph.length === 0 || fan.length !== 0)) return false
    if (item.type === 'FAN_REPORT' && (fan.length === 0 || graph.length !== 0)) return false
    if (item.type === 'COMBINED' && (graph.length === 0 || fan.length === 0 || !item.linkReason)) return false
    if (!unique(item.sources.map((source) => source.kind === 'GRAPH_CLUSTER'
      ? JSON.stringify([source.kind, source.clusterId, source.analysisRunId])
      : JSON.stringify([source.kind, source.reportId])))) return false
    if (!item.sources.every((source) => source.kind === 'GRAPH_CLUSTER'
      ? runs.has(source.analysisRunId) && clusters.get(source.clusterId)?.analysisRunId === source.analysisRunId && clusters.get(source.clusterId)?.eventId === item.eventId
      : reports.get(source.reportId)?.eventId === item.eventId)) return false
    if (time(item.createdAt) > time(item.updatedAt) || !unique(item.activities.map((activity) => activity.id))) return false
    if (!item.activities.some((activity) => activity.kind === 'CREATED' && time(activity.at) === time(item.createdAt))) return false
    return item.activities.every((activity) => time(activity.at) >= time(item.createdAt) && time(activity.at) <= time(item.updatedAt))
  })
}

export function filterCases(data: CaseDataset, track1: Track1Dataset, track2: Track2Dataset, filters: CaseFilters): CaseRecord[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const events = new Map(caseEvents(track1, track2).map((event) => [event.id, event.name]))
  return data.cases.filter((item) => {
    const event = events.get(item.eventId) ?? ''
    return (!query || `${item.id} ${event}`.toLocaleLowerCase().includes(query)) &&
      (!filters.type || item.type === filters.type) && (!filters.status || item.status === filters.status) &&
      (!filters.assignee || (filters.assignee === 'UNASSIGNED' ? item.assignee === null : item.assignee === filters.assignee))
  }).sort((a, b) => {
    const delta = filters.sort === 'priority-desc' ? b.priority - a.priority : filters.sort === 'priority-asc' ? a.priority - b.priority :
      filters.sort === 'updated-desc' ? time(b.updatedAt) - time(a.updatedAt) : time(a.updatedAt) - time(b.updatedAt)
    return delta || a.id.localeCompare(b.id)
  })
}
