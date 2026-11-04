import { z } from 'zod'
import { isUuid } from '../fan-report/intakeConfig'
import { offsetDateTime, uuid, version } from '../admin-cases/caseApi'
import type { CaseView } from '../admin-cases/caseApi'
import { javaTrim, textError } from '../admin-cases/caseWorkflowApi'
import type { OperationMessages, ReportVersionDraft, WorkflowMessage } from '../admin-cases/caseWorkflowApi'

// Backend ApprovalRequestController(W08a 승인 요청, W08b 검토 패키지, 영수증, 결정, 철회) 계약이다.
// 기준은 Backend main 17c832b의 ApprovalRequestDto, ApprovalReviewDto, ApprovalRequestService, ApprovalReviewService다.
// 역할: 승인 요청과 철회는 REVIEWER, 검토 패키지와 영수증과 결정은 APPROVER, 요청 상세는 TENANT_ADMIN, REVIEWER, APPROVER만 허용된다.
// 현재 계정의 역할을 조회하는 API가 없어 화면은 역할을 추정하지 않고 서버의 403 응답으로만 권한 없음을 확인한다.
// 승인 대기 목록 API와 Case에서 승인 요청 ID를 찾는 API는 없다. 요청 ID를 아는 경우에만 상세로 들어갈 수 있다.
// 승인 적격성과 발급 적격성은 서버가 항상 BLOCKED로 돌려준다. 승인 결정은 공식 PDF 발급이 아니다.

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)
const positive = z.number().int().positive()
const templateVersion = z.string().min(1).max(128)

export const approvalRequestStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'INVALIDATED'] as const
export type ApprovalRequestStatus = (typeof approvalRequestStatuses)[number]

export const approvalRequestSchema = z.object({
  approvalRequestId: uuid,
  caseId: uuid,
  eventId: uuid,
  reportVersionId: uuid,
  reportRevision: positive,
  reportContentSha256: sha256Hex,
  reportTemplateVersion: templateVersion,
  reportTemplateSha256: sha256Hex,
  evidenceSnapshotId: uuid,
  evidenceRevision: positive,
  manifestSha256: sha256Hex,
  requestedBy: uuid,
  requestedAt: offsetDateTime,
  reason: z.string().max(2000),
  status: z.enum(approvalRequestStatuses),
  caseVersionAtSubmit: version,
  version: version,
  approvalEligibility: z.literal('BLOCKED'),
})

// manifestJson과 reportContentJson은 서버가 봉인한 원문 문자열이다. 승인자의 검토 화면에서만 파싱해 텍스트로 표시하고 저장소나 로그에 남기지 않는다.
export const reviewPackageSchema = z.object({
  approvalRequestId: uuid,
  requestStatus: z.literal('PENDING'),
  caseId: uuid,
  eventId: uuid,
  caseVersion: version,
  evidenceSnapshotId: uuid,
  evidenceRevision: positive,
  manifestSha256: sha256Hex,
  manifestJson: z.string().min(1).max(1_000_000),
  reportVersionId: uuid,
  reportRevision: positive,
  reportVersion: version,
  reportContentSha256: sha256Hex,
  reportTemplateVersion: templateVersion,
  reportTemplateSha256: sha256Hex,
  reportContentJson: z.string().min(1).max(1_000_000),
  issuanceEligibility: z.literal('BLOCKED'),
})

// 영수증 토큰은 서버가 한 번만 돌려주는 일회용 값이다. URL-safe 문자만 허용해 헤더나 본문에 다른 값이 섞이지 않게 한다.
export const reviewReceiptSchema = z.object({
  reviewReceiptId: uuid,
  approvalRequestId: uuid,
  status: z.literal('ISSUED'),
  reviewReceiptToken: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
  issuedAt: offsetDateTime,
  expiresAt: offsetDateTime,
}).refine((value) => Date.parse(value.expiresAt) > Date.parse(value.issuedAt))

export const decisionOutcomes = ['APPROVE', 'REJECT'] as const
export type DecisionOutcome = (typeof decisionOutcomes)[number]

export const decisionViewSchema = z.object({
  approvalDecisionId: uuid,
  approvalRequestId: uuid,
  outcome: z.enum(decisionOutcomes),
  requestStatus: z.enum(['APPROVED', 'REJECTED']),
  caseStatus: z.enum(['APPROVED_FOR_REPORT', 'IN_REVIEW']),
  reportStatus: z.enum(['APPROVED', 'REJECTED']),
  reviewReceiptId: uuid,
  caseVersion: version,
  requestVersion: version,
  reportVersion: version,
  decidedAt: offsetDateTime,
  issuanceEligibility: z.literal('BLOCKED'),
})

export const withdrawViewSchema = z.object({
  approvalRequestId: uuid,
  requestStatus: z.literal('WITHDRAWN'),
  caseStatus: z.literal('IN_REVIEW'),
  reportStatus: z.literal('WITHDRAWN'),
  caseVersion: version,
  requestVersion: version,
  reportVersion: version,
})

export type ApprovalRequestView = z.infer<typeof approvalRequestSchema>
export type ReviewPackage = z.infer<typeof reviewPackageSchema>
export type ReviewReceipt = z.infer<typeof reviewReceiptSchema>
export type DecisionView = z.infer<typeof decisionViewSchema>
export type WithdrawView = z.infer<typeof withdrawViewSchema>

export function approvalSubmitPath(caseId: string) {
  return `/api/v1/cases/${caseId}/approval-requests`
}

export function approvalRequestPath(requestId: string) {
  return `/api/v1/approval-requests/${requestId}`
}

/** GET은 검토 패키지 조회, POST는 일회용 영수증 발급이다. POST는 멱등 API가 아니다. */
export function reviewPackagePath(requestId: string) {
  return `/api/v1/approval-requests/${requestId}/review-package`
}

export function decisionPath(requestId: string) {
  return `/api/v1/approval-requests/${requestId}/decision`
}

export function withdrawPath(requestId: string) {
  return `/api/v1/approval-requests/${requestId}/withdraw`
}

export function reportVersionDetailPath(reportVersionId: string) {
  return `/api/v1/report-versions/${reportVersionId}`
}

export const approvalEntryRoute = '/app/approvals'

export function approvalRequestRoute(requestId: string) {
  return `/app/approvals/${requestId}`
}

/** 주소나 입력의 승인 요청 ID가 UUID일 때만 소문자로 반환한다. 형식이 다르면 API를 호출하지 않는다. */
export function readApprovalRequestId(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  return isUuid(trimmed) ? trimmed.toLowerCase() : null
}

type Validated<T> = { ok: true; body: T } | { ok: false; errors: Record<string, string> }

function collect<T>(errors: Record<string, string | null>, body: () => T): Validated<T> {
  const found = Object.fromEntries(Object.entries(errors).filter((entry): entry is [string, string] => entry[1] !== null))
  return Object.keys(found).length === 0 ? { ok: true, body: body() } : { ok: false, errors: found }
}

// ---------- 승인 요청 ----------

export type ApprovalSubmitBody = {
  reportVersionId: string
  evidenceSnapshotId: string
  expectedCaseVersion: number
  expectedReportVersion: number
  expectedReportContentSha256: string
  reason: string
}

/** 서버는 Case의 최신 개정만 승인 요청으로 받으므로 목록에서 가장 높은 개정이 현재 증거 개정 번호의 DRAFT일 때만 후보로 쓴다. */
export function latestDraftFor(view: CaseView, items: ReportVersionDraft[]): ReportVersionDraft | null {
  const own = items.filter((item) => item.caseId === view.caseId)
  const latest = own.reduce<ReportVersionDraft | null>((best, item) => (best === null || item.revision > best.revision ? item : best), null)
  return latest !== null && latest.status === 'DRAFT' && latest.evidenceRevision === view.evidenceRevision ? latest : null
}

export function buildApprovalSubmitRequest(view: CaseView, draft: ReportVersionDraft | null, reason: string): Validated<ApprovalSubmitBody> {
  const trimmed = javaTrim(reason)
  let report: string | null = null
  if (view.status !== 'IN_REVIEW') report = 'Case가 검토 중 상태일 때만 승인 요청을 만들 수 있습니다.'
  else if (draft === null) report = '승인 요청할 최신 보고서 초안이 없습니다.'
  else if (draft.caseId !== view.caseId || draft.evidenceRevision !== view.evidenceRevision) report = '현재 증거 개정 번호의 초안만 승인 요청할 수 있습니다.'
  else if (draft.status !== 'DRAFT') report = '초안(DRAFT) 상태의 보고서만 승인 요청할 수 있습니다.'
  return collect({ report, reason: textError(trimmed, 3, 1800) }, () => {
    const target = draft as ReportVersionDraft
    return {
      reportVersionId: target.reportVersionId, evidenceSnapshotId: target.evidenceSnapshotId, expectedCaseVersion: view.caseVersion,
      expectedReportVersion: target.version, expectedReportContentSha256: target.contentSha256, reason: trimmed,
    }
  })
}

/** 같은 키 재전송은 서버가 저장된 요청을 돌려주므로 상태는 보지 않고 요청한 Case와 보고서, Snapshot, digest가 고정되었는지 확인한다. */
export function isSubmittedRequest(data: ApprovalRequestView, caseId: string, body: ApprovalSubmitBody) {
  return data.caseId === caseId && data.reportVersionId === body.reportVersionId && data.evidenceSnapshotId === body.evidenceSnapshotId
    && data.reportContentSha256 === body.expectedReportContentSha256
}

// ---------- 철회 ----------

export type WithdrawBody = { reason: string; expectedCaseVersion: number; expectedRequestVersion: number; expectedReportVersion: number }

/** 철회 직전에 서버에서 다시 읽은 Case와 보고서의 버전을 쓴다. 다른 Case나 보고서의 값은 쓰지 않는다. */
export function buildWithdrawRequest(request: ApprovalRequestView, view: CaseView, report: ReportVersionDraft, reason: string): Validated<WithdrawBody> {
  const trimmed = javaTrim(reason)
  let basis: string | null = null
  if (view.caseId !== request.caseId) basis = '요청과 다른 Case의 버전은 사용할 수 없습니다.'
  else if (report.reportVersionId !== request.reportVersionId) basis = '요청에 고정된 보고서가 아닙니다.'
  return collect({ basis, reason: textError(trimmed, 3, 1800) }, () => ({
    reason: trimmed, expectedCaseVersion: view.caseVersion, expectedRequestVersion: request.version, expectedReportVersion: report.version,
  }))
}

export function isWithdrawn(data: WithdrawView, requestId: string) {
  return data.approvalRequestId === requestId
}

// ---------- 검토 패키지 ----------

/** 검토 패키지가 요청에 고정된 근거와 같은 대상인지 확인한다. 다르면 다른 근거를 검토하게 되므로 영수증 발급과 결정을 막는다. */
export function packageMatchesRequest(request: ApprovalRequestView, pkg: ReviewPackage) {
  return pkg.approvalRequestId === request.approvalRequestId && pkg.caseId === request.caseId && pkg.eventId === request.eventId
    && pkg.evidenceSnapshotId === request.evidenceSnapshotId && pkg.evidenceRevision === request.evidenceRevision && pkg.manifestSha256 === request.manifestSha256
    && pkg.reportVersionId === request.reportVersionId && pkg.reportRevision === request.reportRevision && pkg.reportContentSha256 === request.reportContentSha256
    && pkg.reportTemplateVersion === request.reportTemplateVersion && pkg.reportTemplateSha256 === request.reportTemplateSha256
}

export type SealedJson = { ok: true; value: unknown } | { ok: false }

/** 봉인된 JSON 문자열을 파싱만 한다. 결과는 텍스트로만 표시하며 HTML로 해석하지 않는다. */
export function parseSealedJson(text: string): SealedJson {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

export type ReportContent = { title: string; assessment: string; limitations: string; conclusion: string }

/** 보고서 본문이 같은 Snapshot, manifest, 템플릿에 묶여 있고 필수 문자열 항목이 있을 때만 표시한다. 서버 ApprovalReviewBindingValidator와 같은 결합 기준이다. */
export function readReportContent(pkg: ReviewPackage): { ok: true; content: ReportContent } | { ok: false } {
  const parsed = parseSealedJson(pkg.reportContentJson)
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) return { ok: false }
  const value = parsed.value as Record<string, unknown>
  const text = (key: string) => (typeof value[key] === 'string' ? value[key] : null)
  const [title, assessment, limitations, conclusion] = [text('title'), text('assessment'), text('limitations'), text('conclusion')]
  if (value.evidenceSnapshotId !== pkg.evidenceSnapshotId || value.manifestSha256 !== pkg.manifestSha256 || value.templateVersion !== pkg.reportTemplateVersion) return { ok: false }
  if (title === null || assessment === null || limitations === null || conclusion === null) return { ok: false }
  return { ok: true, content: { title, assessment, limitations, conclusion } }
}

// ---------- 결정 ----------

export type DecisionInput = { outcome: DecisionOutcome | ''; reason: string; reviewConfirmed: boolean }

export type DecisionBody = {
  outcome: DecisionOutcome
  reason: string
  evidenceSnapshotId: string
  manifestSha256: string
  reportContentSha256: string
  reviewReceiptToken: string
  reviewConfirmed: true
  expectedCaseVersion: number
  expectedRequestVersion: number
  expectedReportVersion: number
}

/** 검토 패키지의 근거와 버전, 요청 버전, 현재 보유한 영수증 원문으로 결정 본문을 만든다. 본문은 화면 메모리에서만 쓴다. */
export function buildDecisionRequest(request: ApprovalRequestView, pkg: ReviewPackage, input: DecisionInput, token: string | null): Validated<DecisionBody> {
  const trimmed = javaTrim(input.reason)
  return collect({
    basis: packageMatchesRequest(request, pkg) ? null : '검토 패키지가 요청의 고정 근거와 달라 결정할 수 없습니다.',
    outcome: input.outcome === '' ? '승인 또는 반려를 선택해 주세요.' : null,
    reviewConfirmed: input.reviewConfirmed ? null : '봉인된 보고서와 증거 manifest의 검토 확인이 필요합니다.',
    receipt: token === null ? '유효한 검토 확인 영수증이 없습니다. 영수증을 먼저 발급해 주세요.' : null,
    reason: textError(trimmed, 3, 1800),
  }, () => ({
    outcome: input.outcome as DecisionOutcome, reason: trimmed, evidenceSnapshotId: pkg.evidenceSnapshotId, manifestSha256: pkg.manifestSha256,
    reportContentSha256: pkg.reportContentSha256, reviewReceiptToken: token as string, reviewConfirmed: true,
    expectedCaseVersion: pkg.caseVersion, expectedRequestVersion: request.version, expectedReportVersion: pkg.reportVersion,
  }))
}

export function isDecided(data: DecisionView, requestId: string, body: DecisionBody) {
  return data.approvalRequestId === requestId && data.outcome === body.outcome
}

// ---------- 안내 문구 ----------

const notApplied = '요청이 반영되지 않았습니다.'
const mayInvalidate = '서버가 영수증 발급이나 결정 시점의 재검증에서 이 변경을 확인하면 승인 요청을 무효화(INVALIDATED)할 수 있습니다. 최신 요청 상태를 다시 불러왔습니다.'
const dependency: WorkflowMessage = { title: '서버 의존 서비스에 연결하지 못했습니다', description: '데이터베이스가 응답하지 않았습니다. 서버에서 처리되었을 수 있어 실패로 확정하지 않습니다.' }

const basisCodes: Record<string, WorkflowMessage> = {
  APPROVAL_REQUEST_CLOSED: { title: '이미 종료된 승인 요청입니다', description: `승인, 반려, 철회 또는 무효화로 요청이 닫혔거나 Case와 보고서가 승인 대기 상태가 아닙니다. ${notApplied}` },
  EVIDENCE_VERSION_MISMATCH: { title: '증거 개정 번호가 요청 시점과 다릅니다', description: `${notApplied} ${mayInvalidate}` },
  SOURCE_CHANGED: { title: '출처 상태가 요청 시점과 다릅니다', description: `${notApplied} ${mayInvalidate}` },
  SOURCE_NOT_AVAILABLE: { title: '출처를 더 이상 사용할 수 없습니다', description: `제보나 증거 자산의 상태 변경 또는 보존 기간 만료가 확인되었습니다. ${notApplied} ${mayInvalidate}` },
  APPROVAL_BASIS_BLOCKED: { title: '증거 보존 근거가 승인 조건을 충족하지 않습니다', description: `원본 무결성 확인, 보존 기록, 보존 정책 승인 또는 보존 기간 중 하나가 충족되지 않습니다. ${notApplied} ${mayInvalidate}` },
  APPROVAL_REQUESTER_ACCESS_REVOKED: { title: '요청자의 검토 권한이 철회되었습니다', description: `요청자 멤버십, 검토 담당 역할 또는 공연 권한이 더 이상 유효하지 않습니다. ${notApplied} ${mayInvalidate}` },
  APPROVAL_REVIEW_MISMATCH: { title: '검토한 근거가 요청의 고정 근거와 다릅니다', description: `봉인된 기록이 요청 시점과 달라 조작 가능성을 사람이 확인해야 합니다. 서버는 이 경우 요청 상태를 자동으로 바꾸지 않습니다. ${notApplied}` },
  EVIDENCE_REVIEW_MISMATCH: { title: '봉인된 증거 manifest를 다시 확인하지 못했습니다', description: `저장된 manifest와 digest가 일치하지 않습니다. 서버는 이 경우 요청 상태를 자동으로 바꾸지 않습니다. ${notApplied}` },
  REPORT_CONTENT_MISMATCH: { title: '봉인된 보고서 본문을 다시 확인하지 못했습니다', description: `저장된 본문과 digest 또는 근거 결합이 일치하지 않습니다. 서버는 이 경우 요청 상태를 자동으로 바꾸지 않습니다. ${notApplied}` },
  TEMPLATE_NOT_RETAINED: { title: '보고서 템플릿 근거를 확인하지 못했습니다', description: `보관된 템플릿과 버전 또는 digest가 일치하지 않습니다. ${notApplied}` },
  ISSUANCE_HOLD_ACTIVE: { title: '발급 보류가 걸려 있습니다', description: `이 Case에 활성 IssuanceHold가 있어 서버가 차단했습니다. 화면에서 보류를 해제하지 않습니다. ${notApplied}` },
  DEPENDENCY_UNAVAILABLE: dependency,
}

const caseHidden: WorkflowMessage = { title: 'Case를 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notApplied}` }
const requestHidden: WorkflowMessage = { title: '승인 요청을 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notApplied}` }

export const submitApprovalMessages: OperationMessages = {
  forbidden: { title: '승인 요청에 필요한 역할이 없습니다', description: `승인 요청은 검토 담당(REVIEWER) 역할만 만들 수 있어 서버가 거부했습니다. ${notApplied}` },
  notFound: caseHidden,
  codes: {
    ...basisCodes,
    APPROVAL_BASIS_BLOCKED: { title: '증거 보존 근거가 승인 요청 조건을 충족하지 않습니다', description: `파일 증거의 원본 무결성 확인, 보존 기록, 보존 정책 승인 또는 보존 기간 중 하나가 충족되지 않아 요청을 만들지 않았습니다. ${notApplied}` },
    APPROVAL_REQUEST_ALREADY_PENDING: { title: '이미 승인 대기 중인 요청이 있습니다', description: `한 Case에는 승인 대기 요청이 하나만 있을 수 있습니다. ${notApplied}` },
    REPORT_REVISION_CLOSED: { title: '이미 승인 요청에 사용한 보고서 개정입니다', description: `같은 개정으로 다시 요청할 수 없습니다. 새 초안을 작성해 주세요. ${notApplied}` },
    REPORT_VERSION_CONFLICT: { title: '보고서가 먼저 변경되었습니다', description: `선택한 초안이 최신 개정이 아니거나 버전이 서버와 다릅니다. 최신 상태를 다시 불러왔습니다. ${notApplied}` },
    CASE_STATE_CONFLICT: { title: '현재 Case 상태에서 승인 요청을 만들 수 없습니다', description: `Case가 검토 중 상태여야 합니다. ${notApplied}` },
  },
}

export const withdrawMessages: OperationMessages = {
  forbidden: { title: '승인 요청 철회에 필요한 역할이 없습니다', description: `철회는 검토 담당(REVIEWER) 역할만 실행할 수 있어 서버가 거부했습니다. ${notApplied}` },
  notFound: requestHidden,
  codes: {
    ...basisCodes,
    REQUEST_VERSION_CONFLICT: { title: '승인 요청이 먼저 변경되었습니다', description: `최신 요청 상태를 다시 불러왔습니다. 확인한 뒤 다시 요청해 주세요. ${notApplied}` },
    REPORT_VERSION_CONFLICT: { title: '보고서가 먼저 변경되었습니다', description: `최신 요청 상태를 다시 불러왔습니다. ${notApplied}` },
  },
}

export const decisionMessages: OperationMessages = {
  forbidden: { title: '승인 결정에 필요한 역할이 없습니다', description: `승인과 반려는 승인 담당(APPROVER) 역할만 결정할 수 있어 서버가 거부했습니다. ${notApplied}` },
  forbiddenCodes: {
    SELF_APPROVAL_FORBIDDEN: { title: '자기 승인은 허용되지 않습니다', description: `승인 요청을 만든 사용자와 같은 사용자는 역할이나 멤버십 표현과 관계없이 결정할 수 없습니다. 다른 승인 담당자가 독립적으로 검토해야 합니다. ${notApplied}` },
  },
  notFound: requestHidden,
  codes: {
    ...basisCodes,
    REVIEW_RECEIPT_EXPIRED: { title: '검토 확인 영수증이 만료되었습니다', description: `결정이 기록되지 않았습니다. 검토 패키지를 다시 확인하고 새 영수증을 발급해 주세요.` },
    REVIEW_RECEIPT_ALREADY_USED: { title: '이미 사용한 검토 확인 영수증입니다', description: `영수증은 한 번만 쓸 수 있습니다. 최신 요청 상태를 다시 불러왔습니다. ${notApplied}` },
    REVIEW_RECEIPT_INVALID: { title: '검토 확인 영수증을 사용할 수 없습니다', description: `다른 승인자나 다른 요청의 영수증이거나 취소된 영수증입니다. 새 영수증을 발급해 주세요. ${notApplied}` },
    REQUEST_VERSION_CONFLICT: { title: '승인 요청이 먼저 변경되었습니다', description: `최신 요청 상태를 다시 불러왔습니다. ${notApplied}` },
    REPORT_VERSION_CONFLICT: { title: '보고서가 먼저 변경되었습니다', description: `최신 요청 상태를 다시 불러왔습니다. ${notApplied}` },
  },
}

export const receiptMessages: OperationMessages = {
  forbidden: { title: '검토 확인 영수증 발급에 필요한 역할이 없습니다', description: `영수증은 승인 담당(APPROVER) 역할만 발급받을 수 있어 서버가 거부했습니다. ${notApplied}` },
  notFound: requestHidden,
  codes: basisCodes,
}

export const receiptUncertain: WorkflowMessage = {
  title: '영수증 발급 결과를 확인하지 못했습니다',
  description: '영수증이 발급되었을 수 있습니다. 영수증 발급은 같은 결과를 다시 돌려주는 요청이 아니어서 자동으로 다시 보내지 않습니다. 새 영수증 발급을 누르면 서버가 이 승인자의 이전 미사용 영수증을 취소하고 새로 발급합니다.',
}

export const approvalStatusLabels: Record<ApprovalRequestStatus, string> = {
  PENDING: '승인 대기 (PENDING)',
  APPROVED: '승인됨 (APPROVED)',
  REJECTED: '반려됨 (REJECTED)',
  WITHDRAWN: '철회됨 (WITHDRAWN)',
  INVALIDATED: '무효화됨 (INVALIDATED)',
}

export const decisionOutcomeLabels: Record<DecisionOutcome, string> = { APPROVE: '승인 (APPROVE)', REJECT: '반려 (REJECT)' }
