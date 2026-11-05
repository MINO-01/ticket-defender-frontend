import { z } from 'zod'
import { isUuid } from '../fan-report/intakeConfig'
import { offsetDateTime, uuid } from '../admin-cases/caseApi'
import type { OperationMessages, WorkflowMessage } from '../admin-cases/caseWorkflowApi'

// Backend OfficialPdfIssuanceController(W09 공식 PDF 적격성, 발급, 상세, 재시도, 이력, 다운로드) 계약이다.
// 기준은 Backend main 17c832b의 case-w09-official-pdf-v1.yaml, OfficialPdfDto, OfficialPdfIssuanceService, OfficialPdfOperationGate다.
// 모든 W09 API는 TENANT_ADMIN만 허용하며, 이 역할은 합성 격리 개발용 잠정 역할이지 운영 발급 권한 정책이 아니다.
// 서버는 SYNTHETIC_ISOLATED 모드와 합성 고객사 등록부를 모두 확인할 때만 발급한다. 화면은 적격성과 권한을 추정하지 않고 서버 값만 쓴다.
// 결정 ID를 조회하는 API와 승인 요청에서 결정 ID를 찾는 API는 없다. 결정 ID를 아는 경우에만 발급 화면에 들어갈 수 있다.
// 공식 PDF 발급은 부정 거래 확정이나 자동 제재가 아니다.

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)
// 서버 안정 코드는 대문자 식별자다. 형식이 다르면 계약 위반으로 보고 표시하지 않는다.
const problemCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/)

export const eligibilityStates = ['CURRENT', 'STALE', 'BLOCKED'] as const
export type EligibilityState = (typeof eligibilityStates)[number]

export const issuanceStatuses = ['RESERVED', 'RENDERING', 'OBJECT_STORED', 'GENERATED', 'FAILED', 'STALE'] as const
export type IssuanceStatus = (typeof issuanceStatuses)[number]

export const eligibilitySchema = z.object({
  approvalDecisionId: uuid,
  reportVersionId: uuid,
  state: z.enum(eligibilityStates),
  code: problemCode,
})

export const issuanceSchema = z.object({
  officialPdfIssuanceId: uuid,
  approvalDecisionId: uuid,
  approvalRequestId: uuid,
  reportVersionId: uuid,
  reportRevision: z.number().int().positive(),
  status: z.enum(issuanceStatuses),
  eligibility: z.enum(eligibilityStates),
  eligibilityCode: problemCode,
  officialTemplateVersion: z.string().min(1).max(128),
  officialTemplateSha256: sha256Hex,
  pdfSha256: sha256Hex.nullable(),
  pdfSize: z.number().int().positive().nullable(),
  requestedAt: offsetDateTime,
  completedAt: offsetDateTime.nullable(),
  lastFailureCode: problemCode.nullable(),
  artifactId: uuid.nullable(),
})

export const issuanceHistorySchema = z.array(issuanceSchema).max(200)

export type Eligibility = z.infer<typeof eligibilitySchema>
export type Issuance = z.infer<typeof issuanceSchema>

export function eligibilityPath(decisionId: string) {
  return `/api/v1/approval-decisions/${decisionId}/official-pdf-eligibility`
}

/** 본문 없는 POST다. Idempotency-Key는 UUID v4만 받는다. */
export function issuanceRequestPath(decisionId: string) {
  return `/api/v1/approval-decisions/${decisionId}/official-pdf-issuances`
}

export function issuanceDetailPath(issuanceId: string) {
  return `/api/v1/official-pdf-issuances/${issuanceId}`
}

export function issuanceRetryPath(issuanceId: string) {
  return `/api/v1/official-pdf-issuances/${issuanceId}/retry`
}

export function issuanceDownloadPath(issuanceId: string) {
  return `/api/v1/official-pdf-issuances/${issuanceId}/download`
}

export function issuanceHistoryPath(reportVersionId: string) {
  return `/api/v1/report-versions/${reportVersionId}/official-pdf-issuances`
}

export const reportCenterRoute = '/app/report-center'

export function officialPdfDecisionRoute(decisionId: string) {
  return `/app/report-center/decisions/${decisionId}`
}

/** 주소나 입력의 결정 ID가 UUID일 때만 소문자로 반환한다. 형식이 다르면 API를 호출하지 않는다. */
export function readDecisionId(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  return isUuid(trimmed) ? trimmed.toLowerCase() : null
}

/** 같은 결정의 발급 기록이다. DB UNIQUE로 결정당 발급 작업은 하나다. */
export function issuanceForDecision(items: Issuance[], decisionId: string) {
  return items.find((item) => item.approvalDecisionId === decisionId) ?? null
}

/** 서버 계약상 재시도로 다시 처리하는 상태는 실패와 근거 변경 중단이다. 진행 상태는 상태 재조회만 제공한다. */
export function isRetryableStatus(status: IssuanceStatus) {
  return status === 'FAILED' || status === 'STALE'
}

/** GENERATED이고 서버가 완료본 ID, SHA-256, 크기를 모두 돌려준 경우만 다운로드할 수 있다. */
export function hasDownloadableArtifact(issuance: Issuance): issuance is Issuance & { artifactId: string; pdfSha256: string; pdfSize: number } {
  return issuance.status === 'GENERATED' && issuance.artifactId !== null && issuance.pdfSha256 !== null && issuance.pdfSize !== null
}

export function isIssuanceFor(data: Issuance, decisionId: string, reportVersionId: string) {
  return data.approvalDecisionId === decisionId && data.reportVersionId === reportVersionId
}

/** 바이트의 SHA-256을 소문자 16진수로 계산한다. Web Crypto가 없으면 null이며 다운로드하지 않는다. */
export async function sha256HexOf(bytes: Uint8Array<ArrayBuffer>) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
}

export const eligibilityLabels: Record<EligibilityState, string> = {
  CURRENT: '발급 가능 (CURRENT)',
  STALE: '근거 변경 (STALE)',
  BLOCKED: '차단 (BLOCKED)',
}

export const issuanceStatusLabels: Record<IssuanceStatus, string> = {
  RESERVED: '예약됨 (RESERVED)',
  RENDERING: '생성 중 (RENDERING)',
  OBJECT_STORED: '객체 저장됨, 최종화 전 (OBJECT_STORED)',
  GENERATED: '생성 완료 (GENERATED)',
  FAILED: '실패 (FAILED)',
  STALE: '근거 변경으로 중단 (STALE)',
}

export const issuanceStatusDescriptions: Record<IssuanceStatus, string> = {
  RESERVED: '서버가 발급 작업을 예약했습니다. 아직 PDF가 생성되지 않았습니다.',
  RENDERING: '서버가 PDF를 생성하고 있거나 작업이 중단되었을 수 있습니다. 아직 완료가 아닙니다.',
  OBJECT_STORED: '비공개 저장소에 PDF 후보를 저장했지만 서버 최종화 전입니다. 아직 완료가 아닙니다.',
  GENERATED: '서버가 저장소 객체와 SHA-256을 검증하고 불변 완료본을 기록했습니다.',
  FAILED: '발급이 실패했습니다. 완료본은 만들어지지 않았습니다.',
  STALE: '승인 근거나 템플릿이 바뀌어 발급하지 않았습니다. 완료본은 만들어지지 않았습니다.',
}

const notApplied = '요청이 반영되지 않았습니다.'

// 적격성 코드, 실패 코드, 쓰기 거부 코드에 함께 쓰는 고정 안내다. 목록에 없는 코드는 코드 값만 표시한다.
export const officialPdfCodeMessages: Record<string, WorkflowMessage> = {
  CURRENT: { title: '서버가 현재 발급 가능하다고 판단했습니다', description: '발급 요청 시점에 서버가 다시 확인합니다.' },
  OFFICIAL_PDF_DISABLED: { title: '공식 PDF 발급이 서버 설정에서 꺼져 있습니다', description: '기본값은 비활성입니다. 화면에서 켤 수 없습니다.' },
  OFFICIAL_PDF_OPERATION_NOT_APPROVED: { title: '운영 발급은 승인되지 않았습니다', description: '현재는 합성 격리(SYNTHETIC_ISOLATED) 모드에서만 발급할 수 있습니다. 개인정보 처리, 보존, 발급과 다운로드 권한 정책이 승인되지 않았습니다.' },
  OFFICIAL_PDF_ISOLATION_UNVERIFIED: { title: '합성 격리 환경을 확인하지 못했습니다', description: '서버가 격리 데이터베이스와 저장소 조건을 확인하지 못해 발급을 막았습니다.' },
  OFFICIAL_PDF_SYNTHETIC_SCOPE_UNVERIFIED: { title: '합성 데이터 범위를 확인하지 못했습니다', description: '이 Case의 고객사가 합성 등록부에 없거나 등록 이전 데이터가 포함되어 서버가 막았습니다.' },
  ISSUANCE_HOLD_ACTIVE: { title: '발급 보류(IssuanceHold)가 걸려 있습니다', description: '보류가 해제될 때까지 발급할 수 없습니다. 화면에서 보류를 해제하는 기능은 없습니다.' },
  APPROVAL_NOT_CURRENT: { title: '현재 유효한 승인 결정이 아닙니다', description: '반려 결정이거나, 승인 뒤 Case나 보고서 상태가 바뀌었습니다. 과거 승인 기록은 바뀌지 않습니다.' },
  APPROVAL_BINDING_STALE: { title: '승인에 고정된 기록이 현재와 맞지 않습니다', description: '승인 요청, 영수증, Snapshot, 보고서 중 고정된 값이 달라 발급하지 않습니다.' },
  APPROVAL_BASIS_STALE: { title: '승인 이후 근거가 바뀌었습니다', description: '증거 개정이나 manifest, 보고서 digest가 승인 시점과 달라 새 승인이 필요합니다.' },
  APPROVAL_BASIS_BLOCKED: { title: '증거 보존이나 무결성을 확인하지 못했습니다', description: '증거 원본 무결성 또는 보존 상태 확인이 실패해 발급을 막았습니다.' },
  OFFICIAL_TEMPLATE_CHANGED: { title: '공식 PDF 템플릿이 바뀌었습니다', description: '발급 기록에 고정된 템플릿과 현재 보존된 템플릿이 달라 발급하지 않습니다.' },
  REPORT_TEMPLATE_NOT_RETAINED: { title: '보고서 템플릿을 확인하지 못했습니다', description: '보고서에 고정된 템플릿이 보존되어 있지 않아 발급을 막았습니다.' },
  APPROVER_INDEPENDENCE_INVALID: { title: '승인자 독립성을 확인하지 못했습니다', description: '요청자와 승인자의 멤버십을 확인하지 못해 발급을 막았습니다.' },
  OFFICIAL_PDF_ISSUANCE_IN_PROGRESS: { title: '발급 작업이 이미 진행 중입니다', description: `진행 중인 시도가 끝나거나 서버 lease가 지난 뒤에만 다시 처리할 수 있습니다. 상태를 다시 조회해 주세요. ${notApplied}` },
  OFFICIAL_PDF_ISSUANCE_CONFLICT: { title: '다른 발급 요청이 먼저 기록되었습니다', description: `현재 발급 기록을 다시 불러왔습니다. ${notApplied}` },
  OFFICIAL_PDF_ATTEMPT_SUPERSEDED: { title: '더 새로운 발급 시도가 있습니다', description: '이전 시도는 새 시도의 결과를 덮어쓰지 않습니다. 상태를 다시 조회해 주세요.' },
  OFFICIAL_PDF_NOT_GENERATED: { title: '아직 생성된 공식 PDF가 없습니다', description: '생성 완료(GENERATED) 상태에서만 다운로드할 수 있습니다.' },
  OFFICIAL_PDF_OBJECT_UNAVAILABLE: { title: 'PDF 저장소에서 객체를 확인하지 못했습니다', description: '비공개 저장소가 응답하지 않거나 객체 검증이 실패했습니다. 잠시 후 다시 시도해 주세요.' },
  DEPENDENCY_UNAVAILABLE: { title: '증거 저장소에 연결하지 못했습니다', description: '증거 원본 검증에 필요한 저장소가 응답하지 않았습니다.' },
  PDF_PROCESSING_FAILED: { title: 'PDF 생성 또는 저장이 실패했습니다', description: '완료본은 만들어지지 않았습니다. 재시도는 사용자가 명시적으로 요청해야 합니다.' },
}

/** 코드의 고정 안내를 돌려준다. 모르는 코드는 서버 코드 값만 텍스트로 보여 준다. */
export function describeOfficialPdfCode(code: string): WorkflowMessage {
  return officialPdfCodeMessages[code] ?? { title: `서버 코드 ${code}`, description: '이 코드에 대한 화면 안내가 없습니다. 서버 판단을 그대로 따릅니다.' }
}

export const tenantAdminOnly = (action: string): WorkflowMessage => ({
  title: `${action}에 필요한 역할이 없습니다`,
  description: `W09 공식 PDF 기능은 고객사 관리자(TENANT_ADMIN) 역할만 쓸 수 있어 서버가 거부했습니다. 승인 담당(APPROVER) 역할만으로는 발급할 수 없습니다. ${notApplied}`,
})

const decisionHidden: WorkflowMessage = { title: '승인 결정을 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notApplied}` }
export const issuanceHidden: WorkflowMessage = { title: '발급 기록을 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notApplied}` }

const writeCodes = Object.fromEntries(Object.entries(officialPdfCodeMessages)
  .filter(([code]) => code !== 'CURRENT')
  .map(([code, message]) => [code, code === 'OFFICIAL_PDF_OBJECT_UNAVAILABLE' || code === 'DEPENDENCY_UNAVAILABLE' ? message : { title: message.title, description: message.description.endsWith(notApplied) ? message.description : `${message.description} ${notApplied}` }]))

export const issuanceRequestMessages: OperationMessages = {
  forbidden: tenantAdminOnly('공식 PDF 발급 요청'),
  notFound: decisionHidden,
  codes: writeCodes,
}

export const issuanceRetryMessages: OperationMessages = {
  forbidden: tenantAdminOnly('공식 PDF 재시도'),
  notFound: issuanceHidden,
  codes: writeCodes,
}
