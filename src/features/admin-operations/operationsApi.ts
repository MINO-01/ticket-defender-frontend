import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { offsetDateTime, uuid } from '../admin-cases/caseApi'
import { analysisStatuses, executionStatuses } from '../admin-track2/track2Api'

// Backend capstone-demo-integration-v1의 운영 조회 계약이다.
// analysis-runs는 저장된 Track 2 이미지 정보 추출 실행 이력만 담는다(coverage). Track 1 실행이나 전체 작업 이력이 아니며 totalItems가 없다.
// operations/settings는 TENANT_ADMIN에게 기능 활성 상태만 준다. 로그인한 사용자의 역할 목록이 아니며 비밀 값, URL, 버킷을 담지 않는다.

export const analysisRunPageSize = 20
export const analysisRunCoverage = 'PERSISTED_TRACK2_LISTING_CONTEXT_ANALYSES_ONLY'

const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/)

const analysisRunSchema = z.object({
  analysisId: uuid,
  fanReportId: uuid,
  evidenceId: uuid,
  executionStatus: z.enum(executionStatuses),
  analysisStatus: z.enum(analysisStatuses).nullable(),
  errorCode: code.nullable(),
  analyzerErrorCode: code.nullable(),
  createdAt: offsetDateTime,
  completedAt: offsetDateTime.nullable(),
})
  // 실행 중에는 결과 상태가 없고, 실패로 끝난 실행은 결과가 FAILED이거나 없다. 실패를 정상 결과로 볼 수 있는 조합은 계약 위반이다.
  .refine((run) => run.executionStatus !== 'IN_PROGRESS' || run.analysisStatus === null)
  .refine((run) => run.executionStatus === 'SUCCEEDED' || run.executionStatus === 'IN_PROGRESS' || run.analysisStatus === null || run.analysisStatus === 'FAILED')

export const analysisRunPageSchema = z.object({
  items: z.array(analysisRunSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
  coverage: z.literal(analysisRunCoverage),
})

export const operationSettingsSchema = z.object({
  fanReportIntakeEnabled: z.boolean(),
  track2ListingAnalysisConfigured: z.boolean(),
  track1RelationshipEvidenceCoverage: code,
  officialPdfIssuanceState: code,
  auditorAccessState: code,
})

export type AnalysisRun = z.infer<typeof analysisRunSchema>
export type AnalysisRunPage = z.infer<typeof analysisRunPageSchema>
export type OperationSettings = z.infer<typeof operationSettingsSchema>

export function analysisRunsPath(eventId: string, page: number) {
  return adminApiPath('/api/v1/admin/analysis-runs', { eventId, page, pageSize: analysisRunPageSize })
}

export function operationSettingsPath(eventId: string) {
  return adminApiPath('/api/v1/admin/operations/settings', { eventId })
}

export function isAnalysisRunPageFor(page: number, data: AnalysisRunPage) {
  return data.page === page && data.pageSize === analysisRunPageSize && data.items.length <= analysisRunPageSize
}

/** 서버 상태 코드의 화면 문구다. 모르는 값은 의미를 바꾸지 않고 코드 그대로 보여 준다. */
export const operationStateLabels: Record<string, string> = {
  STORED_DEVICE_AND_IP_SIGNALS_ONLY: '저장된 기기와 IP 신호만 근거로 사용',
  SYNTHETIC_ISOLATION_ONLY: '합성 격리 환경에서만 발급 가능',
  BLOCKED: '발급 차단',
  NOT_IMPLEMENTED_POLICY_PENDING: '정책 결정 전이라 구현되지 않음',
}

export function describeOperationState(value: string) {
  return operationStateLabels[value] ?? `알 수 없는 서버 값 (${value})`
}
