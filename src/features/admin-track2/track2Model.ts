import { z } from 'zod'

const fieldKeys = ['EVENT_NAME', 'PERFORMANCE_AT', 'SECTION', 'ROW', 'SEAT'] as const
const extractionStates = ['QUEUED', 'COMPLETED', 'FAILED'] as const
const comparisonStates = ['MATCH_CANDIDATE', 'NO_MATCH', 'UNVERIFIABLE'] as const
const reviewStates = ['NEW', 'UNDER_REVIEW', 'NEEDS_MORE'] as const

const observationSchema = z.discriminatedUnion('status', [
  z.object({ key: z.enum(fieldKeys), status: z.literal('VISIBLE'), value: z.string().trim().min(1), note: z.string().optional() }),
  z.object({ key: z.enum(fieldKeys), status: z.enum(['ABSENT', 'UNREADABLE', 'AMBIGUOUS']), value: z.null(), note: z.string().optional() }),
])

const datasetSchema = z.object({
  events: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  reports: z.array(z.object({
    id: z.string().min(1), eventId: z.string().min(1), reportType: z.enum(['PREMIUM_RESALE', 'AUTOMATION_OFFER', 'FAKE_TICKET', 'OTHER']),
    receivedAt: z.string().datetime({ offset: true }), reviewStatus: z.enum(reviewStates),
    evidenceIds: z.array(z.string().min(1)), extractionId: z.string().min(1), comparisonId: z.string().min(1),
  })),
  evidence: z.array(z.object({
    id: z.string().min(1), reportId: z.string().min(1), name: z.string().min(1),
    mediaType: z.string().min(1), sizeBytes: z.number().int().nonnegative(), previewPath: z.string().startsWith('/demo-evidence-'),
  })),
  extractions: z.array(z.object({ id: z.string().min(1), reportId: z.string().min(1), status: z.enum(extractionStates), fields: z.array(observationSchema), reason: z.string().optional() })),
  comparisons: z.array(z.object({
    id: z.string().min(1), reportId: z.string().min(1), status: z.enum(comparisonStates), reservationId: z.string().nullable(),
    reason: z.string().min(1), checks: z.array(z.object({ label: z.string().min(1), observation: z.string().min(1), reference: z.string().min(1), result: z.enum(['MATCH', 'MISMATCH', 'UNKNOWN']) })),
    unknowns: z.array(z.string().min(1)),
  })),
})

export type Track2Dataset = z.infer<typeof datasetSchema>
export type FanReport = Track2Dataset['reports'][number]
export type EvidenceAsset = Track2Dataset['evidence'][number]
export type Extraction = Track2Dataset['extractions'][number]
export type Comparison = Track2Dataset['comparisons'][number]
export type FieldKey = (typeof fieldKeys)[number]
export type ExtractionStatus = (typeof extractionStates)[number]
export type ComparisonStatus = (typeof comparisonStates)[number]
export type ReviewStatus = (typeof reviewStates)[number]
export type Observation = Extraction['fields'][number]

export const fieldLabels: Record<FieldKey, string> = {
  EVENT_NAME: '공연명', PERFORMANCE_AT: '공연 일시', SECTION: '좌석 구역', ROW: '좌석 열', SEAT: '좌석번호',
}

export const reportTypeLabels: Record<FanReport['reportType'], string> = {
  PREMIUM_RESALE: '고액 재판매 정황', AUTOMATION_OFFER: '대리 예매 제안', FAKE_TICKET: '위조 티켓 의심', OTHER: '기타 의심 거래',
}

export const extractionLabels: Record<ExtractionStatus, string> = { QUEUED: '추출 대기', COMPLETED: '추출 완료', FAILED: '추출 실패' }
export const comparisonLabels: Record<ComparisonStatus, string> = { MATCH_CANDIDATE: '일치 후보', NO_MATCH: '예매 후보 미발견', UNVERIFIABLE: '대조 불가' }
export const reviewLabels: Record<ReviewStatus, string> = { NEW: '신규', UNDER_REVIEW: '검토 중', NEEDS_MORE: '자료 보완 필요' }
export const observationLabels: Record<Observation['status'], string> = { VISIBLE: '확인됨', ABSENT: '표시 없음', UNREADABLE: '읽기 어려움', AMBIGUOUS: '해석 불명확' }

function unique(ids: string[]) { return ids.every((id) => id.trim().length > 0) && new Set(ids).size === ids.length }

export function isValidTrack2Dataset(input: unknown): input is Track2Dataset {
  const parsed = datasetSchema.safeParse(input)
  if (!parsed.success) return false
  const data = parsed.data
  if (![data.events, data.reports, data.evidence, data.extractions, data.comparisons].every((items) => unique(items.map((item) => item.id)))) return false
  const eventIds = new Set(data.events.map((event) => event.id))
  const reports = new Map(data.reports.map((report) => [report.id, report]))
  const evidence = new Map(data.evidence.map((item) => [item.id, item]))
  const extractions = new Map(data.extractions.map((item) => [item.id, item]))
  const comparisons = new Map(data.comparisons.map((item) => [item.id, item]))
  if (!data.reports.every((report) => eventIds.has(report.eventId) && unique(report.evidenceIds) &&
    report.evidenceIds.every((id) => evidence.get(id)?.reportId === report.id) &&
    extractions.get(report.extractionId)?.reportId === report.id && comparisons.get(report.comparisonId)?.reportId === report.id)) return false
  if (!data.evidence.every((item) => reports.get(item.reportId)?.evidenceIds.includes(item.id)) ||
    !data.extractions.every((item) => reports.get(item.reportId)?.extractionId === item.id &&
      (item.status === 'COMPLETED' ? item.fields.length === fieldKeys.length && unique(item.fields.map((field) => field.key)) : item.fields.length === 0)) ||
    !data.comparisons.every((item) => reports.get(item.reportId)?.comparisonId === item.id &&
      (item.status === 'MATCH_CANDIDATE' ? Boolean(item.reservationId) && item.checks.some((check) => check.result === 'MATCH') : item.reservationId === null))) return false
  return true
}

export type ReportFilters = { query: string; eventId: string; extraction: ExtractionStatus | ''; comparison: ComparisonStatus | ''; review: ReviewStatus | ''; sort: 'recent' | 'oldest' | 'id' }
export const defaultReportFilters: ReportFilters = { query: '', eventId: '', extraction: '', comparison: '', review: '', sort: 'recent' }
export const reportPageSize = 5

export function filterReports(data: Track2Dataset, filters: ReportFilters): FanReport[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return data.reports.filter((report) => {
    const eventName = data.events.find((event) => event.id === report.eventId)?.name ?? ''
    const searchable = [report.id, eventName, reportTypeLabels[report.reportType]].join(' ').toLocaleLowerCase()
    return (!query || searchable.includes(query)) && (!filters.eventId || report.eventId === filters.eventId) &&
      (!filters.extraction || data.extractions.find((item) => item.id === report.extractionId)?.status === filters.extraction) &&
      (!filters.comparison || data.comparisons.find((item) => item.id === report.comparisonId)?.status === filters.comparison) &&
      (!filters.review || report.reviewStatus === filters.review)
  }).sort((a, b) => {
    if (filters.sort === 'id') return a.id.localeCompare(b.id)
    return (filters.sort === 'recent' ? b.receivedAt.localeCompare(a.receivedAt) : a.receivedAt.localeCompare(b.receivedAt)) || a.id.localeCompare(b.id)
  })
}
