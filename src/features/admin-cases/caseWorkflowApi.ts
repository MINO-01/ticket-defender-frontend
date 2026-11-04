import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import type { AdminApiResult } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'
import { offsetDateTime, uuid, version } from './caseApi'
import type { CaseStatus, CaseType, CaseView } from './caseApi'

// Backend CaseController(생성, 상태 전이, 담당자)와 CasePreparationController(EvidenceSnapshot, ReportVersion 초안) 쓰기 계약이다.
// 기준은 Backend main 17c832b의 CaseDto, CasePreparationDto, CaseService, CaseWriteService, CaseSourceVerifier, CasePreparationService다.
// 입력 길이와 상태 전이 규칙은 서버 규칙을 그대로 옮긴 사전 확인일 뿐이며 최종 판단은 항상 서버가 한다.
// 역할: 생성은 ANALYST, REVIEWER만, 상태 전이, 담당자, Snapshot, 초안은 REVIEWER만 허용된다. 현재 계정의 역할을 조회하는 API가 없어
// 화면은 역할을 추정하지 않고 서버의 403 응답으로만 권한 없음을 확인한다.

export const snapshotPageSize = 20
export const reportVersionPageSize = 20

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

// sourceIntegrity는 Snapshot 시점에 원본 바이트를 다시 해시하지 않고 메타데이터만 대조했다는 서버 값이다. 목록에 없는 값은 계약 위반으로 처리한다.
export const sourceIntegrityValues = ['METADATA_ONLY', 'NO_FILE'] as const
export type SourceIntegrity = (typeof sourceIntegrityValues)[number]

export const reportVersionStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'INVALIDATED'] as const
export type ReportVersionStatus = (typeof reportVersionStatuses)[number]

// manifestJson과 contentJson은 증거 구성과 보고서 원문이다. 존재만 확인하고 파싱 결과에서 제거해 화면 상태, 로그, 저장소에 남기지 않는다.
export const snapshotSchema = z.object({
  evidenceSnapshotId: uuid,
  caseId: uuid,
  eventId: uuid,
  evidenceRevision: version,
  caseVersionAtCapture: version,
  manifestSchemaVersion: z.number().int().positive(),
  manifestSha256: sha256Hex,
  manifestJson: z.string().min(1),
  sourceIntegrity: z.enum(sourceIntegrityValues),
  approvalEligible: z.boolean(),
  createdByMembershipId: uuid,
  capturedAt: offsetDateTime,
}).transform(({ manifestJson, ...rest }) => {
  void manifestJson
  return rest
})

export const snapshotPageSchema = z.object({
  items: z.array(snapshotSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export const reportVersionSchema = z.object({
  reportVersionId: uuid,
  caseId: uuid,
  eventId: uuid,
  evidenceSnapshotId: uuid,
  evidenceRevision: version,
  revision: z.number().int().positive(),
  version: version,
  templateVersion: z.string().min(1).max(128),
  templateSha256: sha256Hex,
  contentSha256: sha256Hex,
  contentJson: z.string().min(1),
  status: z.enum(reportVersionStatuses),
  renderable: z.boolean(),
  approvalEligible: z.boolean(),
  createdByMembershipId: uuid,
  createdAt: offsetDateTime,
}).transform(({ contentJson, ...rest }) => {
  void contentJson
  return rest
})

export const reportVersionPageSchema = z.object({
  items: z.array(reportVersionSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export type EvidenceSnapshot = z.infer<typeof snapshotSchema>
export type ReportVersionDraft = z.infer<typeof reportVersionSchema>

export const caseCreatePath = '/api/v1/cases'

export function caseTransitionPath(caseId: string) {
  return `/api/v1/cases/${caseId}/transitions`
}

export function caseAssigneePath(caseId: string) {
  return `/api/v1/cases/${caseId}/assignee`
}

export function snapshotCreatePath(caseId: string) {
  return `/api/v1/cases/${caseId}/evidence-snapshots`
}

export function snapshotListPath(caseId: string, page: number) {
  return adminApiPath(`/api/v1/cases/${caseId}/evidence-snapshots`, { page, pageSize: snapshotPageSize })
}

export function snapshotDetailPath(caseId: string, snapshotId: string) {
  return `/api/v1/cases/${caseId}/evidence-snapshots/${snapshotId}`
}

export function reportVersionCreatePath(caseId: string) {
  return `/api/v1/cases/${caseId}/report-versions`
}

export function reportVersionListPath(caseId: string, page: number) {
  return adminApiPath(`/api/v1/cases/${caseId}/report-versions`, { page, pageSize: reportVersionPageSize })
}

// ---------- 입력 검증 ----------

/** Java String.trim()과 같이 앞뒤의 U+0020 이하 문자만 제거한다. 서버와 같은 기준으로 최소 길이를 확인하기 위해서다. */
export function javaTrim(value: string) {
  let start = 0
  let end = value.length
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1
  return value.slice(start, end)
}

/** 서버 validateText와 같은 규칙이다. 앞뒤 공백을 뺀 길이가 min 이상, 원문 길이(UTF-16 단위)가 max 이하여야 한다. */
export function textError(value: string, min: number, max: number) {
  if (javaTrim(value).length < min) return `공백을 제외하고 ${min}자 이상 입력해 주세요.`
  if (value.length > max) return `${max}자 이하로 입력해 주세요.`
  return null
}

// XML 1.0에서 허용하지 않는 제어 문자와 짝이 없는 surrogate를 찾는다. 보고서 본문은 서버가 이 문자를 삭제하지 않고 거부한다.
// eslint-disable-next-line no-control-regex
const xmlInvalidPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

export function reportTextError(value: string, min: number, max: number) {
  return textError(value, min, max) ?? (xmlInvalidPattern.test(value) ? '보고서에 넣을 수 없는 제어 문자가 포함되어 있습니다.' : null)
}

/** Backend가 받는 Track 1 분석 요청 ID 형식이다. UUID를 소문자 정규 표기로 쓴 값만 Case 출처로 연결할 수 있다. */
export function isCanonicalAnalysisRequestId(value: string) {
  return isUuid(value) && value === value.toLowerCase()
}

type Validated<T> = { ok: true; body: T } | { ok: false; errors: Record<string, string> }

function collect<T>(errors: Record<string, string | null>, body: () => T): Validated<T> {
  const found = Object.fromEntries(Object.entries(errors).filter((entry): entry is [string, string] => entry[1] !== null))
  return Object.keys(found).length === 0 ? { ok: true, body: body() } : { ok: false, errors: found }
}

// ---------- Case 생성 ----------

export type GraphClusterSource = { analysisRequestId: string; clusterId: string }

export type CreateCaseInput = {
  eventId: string
  graphClusters: GraphClusterSource[]
  fanReportIds: string[]
  evidenceIds: string[]
  reason: string
}

export type CreateCaseBody = {
  eventId: string
  type: CaseType
  graphClusters: GraphClusterSource[]
  fanReportIds: string[]
  evidenceIds: string[]
  reason: string
  relatedCaseId: null
  relationReason: null
}

const maxCaseSources = 30

/** 출처 구성으로 Case 유형을 정한다. 군집만이면 GRAPH_CLUSTER, 제보만이면 FAN_REPORT, 둘 다면 COMBINED다. 증거 이미지는 제보와 함께만 연결된다. */
export function caseTypeFor(input: Pick<CreateCaseInput, 'graphClusters' | 'fanReportIds'>): CaseType | null {
  if (input.graphClusters.length > 0 && input.fanReportIds.length > 0) return 'COMBINED'
  if (input.graphClusters.length > 0) return 'GRAPH_CLUSTER'
  if (input.fanReportIds.length > 0) return 'FAN_REPORT'
  return null
}

/**
 * CaseSourceVerifier 사전 규칙과 같은 조건으로 생성 요청을 만든다. 출처 존재, 고객사와 공연 범위, 보존 기한, 원본 상태는 서버만 확인한다.
 * 후속 Case(relatedCaseId) 연결은 이번 범위에서 제공하지 않아 항상 null로 보낸다.
 */
export function buildCreateCaseRequest(input: CreateCaseInput): Validated<CreateCaseBody> {
  const reason = javaTrim(input.reason)
  const type = caseTypeFor(input)
  const clusterKeys = input.graphClusters.map((item) => `${item.analysisRequestId}\u0000${item.clusterId}`)
  const total = input.graphClusters.length + input.fanReportIds.length + input.evidenceIds.length
  let sources: string | null = null
  if (!isUuid(input.eventId)) sources = '공연 범위를 확인하지 못했습니다.'
  else if (type === null) sources = '연결할 출처가 없습니다.'
  else if (input.evidenceIds.length > 0 && input.fanReportIds.length === 0) sources = '증거 이미지는 소속 제보와 함께만 연결할 수 있습니다.'
  else if (total > maxCaseSources) sources = `출처는 최대 ${maxCaseSources}개까지 연결할 수 있습니다.`
  else if (input.graphClusters.some((item) => !isCanonicalAnalysisRequestId(item.analysisRequestId))) sources = '분석 요청 ID는 소문자 UUID 형식이어야 Case 출처로 연결할 수 있습니다.'
  else if (input.graphClusters.some((item) => javaTrim(item.clusterId) === '' || item.clusterId.length > 191)) sources = '군집 ID가 비어 있거나 너무 깁니다.'
  else if (input.fanReportIds.some((id) => !isUuid(id)) || input.evidenceIds.some((id) => !isUuid(id))) sources = '제보 또는 증거 ID 형식이 올바르지 않습니다.'
  else if (new Set(clusterKeys).size !== clusterKeys.length || new Set(input.fanReportIds).size !== input.fanReportIds.length || new Set(input.evidenceIds).size !== input.evidenceIds.length) sources = '같은 출처가 중복되었습니다.'
  return collect({ sources, reason: textError(reason, 3, 2000) }, () => ({
    eventId: input.eventId.toLowerCase(),
    type: type as CaseType,
    graphClusters: input.graphClusters.map((item) => ({ analysisRequestId: item.analysisRequestId, clusterId: item.clusterId })),
    fanReportIds: input.fanReportIds.map((id) => id.toLowerCase()),
    evidenceIds: input.evidenceIds.map((id) => id.toLowerCase()),
    reason,
    relatedCaseId: null,
    relationReason: null,
  }))
}

/** 생성 응답이 요청한 공연과 유형의 새 OPEN Case인지 확인한다. 다른 공연이나 유형의 응답은 성공으로 보지 않는다. */
export function isCreatedCase(view: CaseView, body: CreateCaseBody) {
  return view.eventId === body.eventId && view.type === body.type && view.status === 'OPEN' && view.relatedCaseId === null
}

// ---------- 상태 전이 ----------

export const dismissalBases = ['EVIDENCE_REFUTES_ALLEGATION', 'NO_VIOLATION_FOUND_AFTER_REVIEW'] as const
export type DismissalBasis = (typeof dismissalBases)[number]

export const dismissalBasisLabels: Record<DismissalBasis, string> = {
  EVIDENCE_REFUTES_ALLEGATION: '증거가 제보 내용을 반박함',
  NO_VIOLATION_FOUND_AFTER_REVIEW: '검토 결과 위반 사실을 찾지 못함',
}

export type TransitionTarget = 'TRIAGED' | 'IN_REVIEW' | 'NEEDS_EVIDENCE' | 'DISMISSED'

type TransitionRule = { to: TransitionTarget; label: string; requiresAssignee: boolean }

// CaseWriteService.transition의 허용 조합만 둔다. READY_FOR_APPROVAL 이후 상태와 CLOSED 전이는 승인 흐름 또는 미제공 기능이라 제공하지 않는다.
// OPEN에서 TRIAGED는 담당자가 없어도 되지만 미지정 사유가 필요하고, 나머지는 현재 유효한 담당자가 있어야 한다.
const transitionRules: Partial<Record<CaseStatus, TransitionRule[]>> = {
  OPEN: [{ to: 'TRIAGED', label: '분류 완료로 변경', requiresAssignee: false }],
  TRIAGED: [{ to: 'IN_REVIEW', label: '검토 시작', requiresAssignee: true }],
  IN_REVIEW: [
    { to: 'NEEDS_EVIDENCE', label: '추가 자료 필요로 변경', requiresAssignee: true },
    { to: 'DISMISSED', label: '종결 검토 처리', requiresAssignee: true },
  ],
  NEEDS_EVIDENCE: [{ to: 'IN_REVIEW', label: '검토 재개', requiresAssignee: true }],
}

export function transitionOptions(status: CaseStatus): TransitionRule[] {
  return transitionRules[status] ?? []
}

export type TransitionInput = {
  to: TransitionTarget
  reason: string
  classification: string
  unassignedReason: string
  missingEvidence: string
  requestedAction: string
  unavailableReason: string
  dismissalBasis: DismissalBasis | ''
}

export type TransitionBody = {
  toStatus: TransitionTarget
  expectedCaseVersion: number
  reason: string
  classification: string | null
  unassignedReason: string | null
  missingEvidence: string | null
  requestedAction: string | null
  unavailableReason: string | null
  dismissalBasis: DismissalBasis | null
}

/** 서버는 사유와 추가 필드를 " | "로 합쳐 2000자 이하로 기록한다. 합친 길이가 넘으면 서버가 거부하므로 미리 알린다. */
function combinedTooLong(...values: string[]) {
  return values.join(' | ').length > 2000 ? '사유와 추가 입력을 합쳐 2000자 이하로 줄여 주세요.' : null
}

export function buildTransitionRequest(view: CaseView, input: TransitionInput): Validated<TransitionBody> {
  const rule = transitionOptions(view.status).find((item) => item.to === input.to)
  const trimmed = {
    reason: javaTrim(input.reason), classification: javaTrim(input.classification), unassignedReason: javaTrim(input.unassignedReason),
    missingEvidence: javaTrim(input.missingEvidence), requestedAction: javaTrim(input.requestedAction), unavailableReason: javaTrim(input.unavailableReason),
  }
  const errors: Record<string, string | null> = { reason: textError(trimmed.reason, 3, 2000) }
  const body: TransitionBody = {
    toStatus: input.to, expectedCaseVersion: view.caseVersion, reason: trimmed.reason,
    classification: null, unassignedReason: null, missingEvidence: null, requestedAction: null, unavailableReason: null, dismissalBasis: null,
  }
  const assigned = view.assigneeMembershipId !== null
  if (!rule) errors.to = '현재 상태에서 서버가 허용하지 않는 변경입니다.'
  else if (rule.requiresAssignee && !assigned) errors.to = '담당자를 먼저 지정해야 합니다.'
  else if (input.to === 'TRIAGED') {
    errors.classification = textError(trimmed.classification, 3, 160)
    body.classification = trimmed.classification
    if (!assigned) {
      errors.unassignedReason = textError(trimmed.unassignedReason, 3, 500)
      errors.combined = combinedTooLong(trimmed.reason, trimmed.unassignedReason)
      body.unassignedReason = trimmed.unassignedReason
    }
  } else if (input.to === 'NEEDS_EVIDENCE') {
    errors.missingEvidence = textError(trimmed.missingEvidence, 3, 500)
    errors.requestedAction = textError(trimmed.requestedAction, 3, 500)
    errors.combined = combinedTooLong(trimmed.reason, trimmed.missingEvidence, trimmed.requestedAction)
    body.missingEvidence = trimmed.missingEvidence
    body.requestedAction = trimmed.requestedAction
  } else if (input.to === 'IN_REVIEW' && view.status === 'NEEDS_EVIDENCE') {
    // 서버에 출처 추가 API가 없어 새 자료가 붙었다고 기록하지 않는다. 자료를 받지 못한 사유를 남기고 재개한다.
    errors.unavailableReason = textError(trimmed.unavailableReason, 3, 500)
    errors.combined = combinedTooLong(trimmed.reason, trimmed.unavailableReason)
    body.unavailableReason = trimmed.unavailableReason
  } else if (input.to === 'DISMISSED') {
    if (input.dismissalBasis === '') errors.dismissalBasis = '종결 근거를 선택해 주세요.'
    else body.dismissalBasis = input.dismissalBasis
    if (errors.reason === null && trimmed.reason.length < 10) errors.reason = '종결 사유는 공백을 제외하고 10자 이상 입력해 주세요.'
    if (input.dismissalBasis !== '') errors.combined = combinedTooLong(input.dismissalBasis, trimmed.reason)
  }
  return collect(errors, () => body)
}

/** 전이 응답이 같은 Case이고 요청한 상태와 더 높은 버전인지 확인한다. */
export function isTransitioned(view: CaseView, caseId: string, body: TransitionBody) {
  return view.caseId === caseId && view.status === body.toStatus && view.caseVersion > body.expectedCaseVersion
}

// ---------- 담당자 ----------

export type AssignBody = { assigneeMembershipId: string; expectedCaseVersion: number; reason: string }

export function buildAssignRequest(view: CaseView, input: { assigneeMembershipId: string; reason: string }): Validated<AssignBody> {
  const assignee = input.assigneeMembershipId.trim().toLowerCase()
  const reason = javaTrim(input.reason)
  let assigneeError: string | null = null
  if (!isUuid(assignee)) assigneeError = '담당자 멤버십 ID를 UUID 형식으로 입력해 주세요.'
  else if (assignee === view.assigneeMembershipId) assigneeError = '현재 담당자와 같습니다. 다른 멤버십 ID를 입력해 주세요.'
  return collect({ assigneeMembershipId: assigneeError, reason: textError(reason, 3, 2000) }, () => ({ assigneeMembershipId: assignee, expectedCaseVersion: view.caseVersion, reason }))
}

export function isAssigned(view: CaseView, caseId: string, body: AssignBody) {
  return view.caseId === caseId && view.assigneeMembershipId === body.assigneeMembershipId && view.caseVersion > body.expectedCaseVersion
}

// ---------- EvidenceSnapshot ----------

export type CaptureBody = { expectedCaseVersion: number; reason: string }

export function buildCaptureRequest(view: CaseView, input: { reason: string }): Validated<CaptureBody> {
  const reason = javaTrim(input.reason)
  const state = view.status === 'IN_REVIEW' ? null : 'Case가 검토 중 상태일 때만 생성할 수 있습니다.'
  return collect({ state, reason: textError(reason, 3, 1800) }, () => ({ expectedCaseVersion: view.caseVersion, reason }))
}

/** 같은 키 재전송은 서버가 이미 만든 Snapshot을 그대로 돌려주므로 버전 증가는 확인하지 않고 Case와 공연 범위만 확인한다. */
export function isCapturedSnapshot(snapshot: EvidenceSnapshot, view: CaseView) {
  return snapshot.caseId === view.caseId && snapshot.eventId === view.eventId && snapshot.evidenceRevision === view.evidenceRevision
}

// ---------- ReportVersion 초안 ----------

export type DraftInput = { evidenceSnapshotId: string; title: string; assessment: string; limitations: string; conclusion: string; reason: string }
export type DraftBody = { expectedCaseVersion: number } & DraftInput

export function buildDraftRequest(view: CaseView, snapshots: EvidenceSnapshot[], input: DraftInput): Validated<DraftBody> {
  const trimmed = {
    title: javaTrim(input.title), assessment: javaTrim(input.assessment), limitations: javaTrim(input.limitations),
    conclusion: javaTrim(input.conclusion), reason: javaTrim(input.reason),
  }
  const snapshot = snapshots.find((item) => item.evidenceSnapshotId === input.evidenceSnapshotId)
  let snapshotError: string | null = null
  if (view.status !== 'IN_REVIEW') snapshotError = 'Case가 검토 중 상태일 때만 초안을 작성할 수 있습니다.'
  else if (!snapshot) snapshotError = '기준 EvidenceSnapshot을 선택해 주세요.'
  else if (snapshot.caseId !== view.caseId || snapshot.evidenceRevision !== view.evidenceRevision) snapshotError = '현재 증거 개정 번호의 Snapshot만 선택할 수 있습니다.'
  return collect({
    evidenceSnapshotId: snapshotError,
    title: reportTextError(trimmed.title, 3, 160),
    assessment: reportTextError(trimmed.assessment, 10, 6000),
    limitations: reportTextError(trimmed.limitations, 3, 3000),
    conclusion: reportTextError(trimmed.conclusion, 3, 3000),
    reason: textError(trimmed.reason, 3, 1800),
  }, () => ({ expectedCaseVersion: view.caseVersion, evidenceSnapshotId: input.evidenceSnapshotId, ...trimmed }))
}

/** 초안 응답은 DRAFT 상태이고 요청한 Case, 공연, Snapshot을 가리켜야 한다. 승인 상태의 응답은 초안 생성 성공으로 보지 않는다. */
export function isCreatedDraft(draft: ReportVersionDraft, view: CaseView, body: DraftBody) {
  return draft.caseId === view.caseId && draft.eventId === view.eventId && draft.evidenceSnapshotId === body.evidenceSnapshotId && draft.status === 'DRAFT'
}

// ---------- 결과 분류 ----------

export type WorkflowMessage = { title: string; description: string }

export type MutationOutcome<T> =
  | { kind: 'succeeded'; data: T }
  /** 서버가 요청을 확정적으로 거부했다. 다시 하려면 입력을 고쳐 새 요청 키로 보낸다. */
  | { kind: 'rejected'; message: WorkflowMessage; forbidden: boolean }
  /** 409 CASE_VERSION_CONFLICT. 화면의 Case가 최신이 아니므로 서버 상태를 다시 조회한다. */
  | { kind: 'conflict'; message: WorkflowMessage }
  /** 결과를 확인하지 못했다. 서버에서 처리되었을 수 있으므로 같은 키와 같은 본문으로만 재확인한다. */
  | { kind: 'uncertain'; message: WorkflowMessage }

const notApplied = '요청이 반영되지 않았습니다.'

const commonCodes: Record<string, WorkflowMessage> = {
  VALIDATION_FAILED: { title: '서버가 입력 값을 거부했습니다', description: `필수 사유와 입력 길이, 출처 구성을 확인해 주세요. ${notApplied}` },
  INVALID_REQUEST: { title: '요청 형식이 올바르지 않습니다', description: notApplied },
  INVALID_IDEMPOTENCY_KEY: { title: '요청 키를 서버가 거부했습니다', description: `다시 요청하면 새 요청 키를 만듭니다. ${notApplied}` },
  IDEMPOTENCY_KEY_REUSED: { title: '같은 요청 키가 다른 내용으로 사용되었습니다', description: `서버가 요청을 거부했습니다. 다시 요청하면 새 요청 키를 만듭니다. ${notApplied}` },
  TENANT_SELECTION_REQUIRED: { title: '여러 고객사 소속 계정은 아직 지원하지 않습니다', description: `고객사 선택 정책이 확정되지 않아 요청을 차단했습니다. ${notApplied}` },
}

export type OperationMessages = {
  forbidden: WorkflowMessage
  /** 403 중 공통 클라이언트가 읽은 안정 코드별 안내다. 없거나 모르는 코드는 forbidden 문구를 쓴다. */
  forbiddenCodes?: Record<string, WorkflowMessage>
  notFound: WorkflowMessage
  codes: Record<string, WorkflowMessage>
}

const versionConflict: WorkflowMessage = {
  title: '다른 사용자가 먼저 Case를 변경했습니다',
  description: `화면의 Case 버전이 서버와 달라 ${notApplied} 서버의 최신 상태를 다시 불러왔으니 확인한 뒤 다시 요청해 주세요.`,
}

const uncertainDescription = '서버에서 처리되었을 수 있습니다. 같은 요청 재확인은 같은 요청 키와 같은 내용을 다시 보내며, 이미 처리된 요청이면 서버가 기록된 결과를 돌려주고 새로 처리하지 않습니다.'

/**
 * POST, PUT 결과를 분류한다. 성공 응답도 verify를 통과해야 성공이다.
 * 네트워크 오류, 계약과 다른 응답, 계약 코드가 없는 5xx는 서버 반영 여부를 알 수 없으므로 실패로 확정하지 않는다.
 */
export function classifyMutation<T>(result: AdminApiResult<T>, messages: OperationMessages, verify: (data: T) => boolean): MutationOutcome<T> {
  if (result.kind === 'success') {
    return verify(result.data) ? { kind: 'succeeded', data: result.data } : { kind: 'uncertain', message: { title: '서버 응답이 요청과 맞지 않습니다', description: `응답을 표시하지 않았습니다. ${uncertainDescription}` } }
  }
  switch (result.kind) {
    case 'network':
      return { kind: 'uncertain', message: { title: '서버 응답을 받지 못했습니다', description: uncertainDescription } }
    case 'invalidResponse':
      return { kind: 'uncertain', message: { title: '서버 응답 형식이 계약과 다릅니다', description: `응답을 표시하지 않았습니다. ${uncertainDescription}` } }
    case 'unauthenticated':
      return { kind: 'rejected', forbidden: false, message: { title: '관리자 세션이 만료되었습니다', description: `다시 로그인한 뒤 Case 상태를 확인해 주세요.` } }
    case 'forbidden':
      return { kind: 'rejected', forbidden: true, message: (result.code === undefined ? undefined : messages.forbiddenCodes?.[result.code]) ?? messages.forbidden }
    case 'notFound':
      return { kind: 'rejected', forbidden: false, message: messages.notFound }
    case 'problem': {
      if (result.status === 409 && result.code === 'CASE_VERSION_CONFLICT') return { kind: 'conflict', message: versionConflict }
      const known = messages.codes[result.code] ?? commonCodes[result.code]
      if (known && result.status < 500) return { kind: 'rejected', forbidden: false, message: known }
      if (known && result.status === 503) return { kind: 'uncertain', message: known }
      return { kind: 'uncertain', message: { title: '서버가 결과를 확정하지 않은 오류를 반환했습니다', description: `서버 오류(${result.status}). ${uncertainDescription}` } }
    }
  }
}

const dependency: WorkflowMessage = { title: '서버 의존 서비스에 연결하지 못했습니다', description: `저장소나 데이터베이스가 응답하지 않았습니다. ${uncertainDescription}` }

const reviewerOnly = (action: string): WorkflowMessage => ({
  title: `${action}에 필요한 역할이 없습니다`,
  description: `${action}은 검토 담당(REVIEWER) 역할만 실행할 수 있어 서버가 거부했습니다. ${notApplied}`,
})

const caseHidden: WorkflowMessage = { title: 'Case를 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notApplied}` }
const stateConflict = (description: string): WorkflowMessage => ({ title: '현재 Case 상태에서 허용되지 않는 요청입니다', description: `${description} ${notApplied}` })

export const createCaseMessages: OperationMessages = {
  forbidden: { title: 'Case 생성에 필요한 역할이 없습니다', description: `Case 생성은 분석 담당(ANALYST) 또는 검토 담당(REVIEWER) 역할만 실행할 수 있어 서버가 거부했습니다. ${notApplied}` },
  notFound: { title: '출처를 찾을 수 없거나 접근 범위 밖입니다', description: `출처가 없거나 다른 고객사 또는 다른 공연의 출처입니다. 두 경우는 구분해 안내하지 않습니다. Case를 만들지 않았습니다.` },
  codes: {
    SOURCE_ALREADY_LINKED: { title: '이미 진행 중인 Case에 연결된 출처입니다', description: '같은 출처를 가진 종결되지 않은 Case가 있어 새 Case를 만들지 않았습니다. Case 목록에서 기존 Case를 확인해 주세요.' },
    SOURCE_NOT_AVAILABLE: { title: '보존 기한 또는 접수 상태 때문에 연결할 수 없는 출처입니다', description: '제보가 정상 접수 상태가 아니거나 보존 기한이 지났거나 증거 원본 저장이 확인되지 않았습니다. 원본 무결성 실패와는 다른 상태입니다. Case를 만들지 않았습니다.' },
    SOURCE_OBJECT_MISMATCH: { title: '증거 원본 상태가 접수 기록과 맞지 않습니다', description: '저장소의 원본 크기, 형식 또는 객체 버전이 접수 기록과 달라 원본 무결성을 확인하지 못했습니다. Case를 만들지 않았습니다.' },
    SOURCE_OBJECT_MISSING: { title: '증거 원본을 저장소에서 찾지 못했습니다', description: '접수 기록은 있지만 원본 객체가 없어 원본 무결성을 확인하지 못했습니다. Case를 만들지 않았습니다.' },
    SOURCE_CHANGED: { title: '확인 중에 출처 상태가 바뀌었습니다', description: '출처 확인과 저장 사이에 출처가 변경되어 Case를 만들지 않았습니다. 출처 상태를 다시 확인한 뒤 요청해 주세요.' },
    CASE_STATE_CONFLICT: stateConflict('연관 Case가 종결 상태가 아닙니다.'),
    DEPENDENCY_UNAVAILABLE: dependency,
  },
}

export const transitionMessages: OperationMessages = {
  forbidden: reviewerOnly('상태 변경'),
  notFound: caseHidden,
  codes: {
    CASE_STATE_CONFLICT: stateConflict('서버의 상태 전이 규칙에 맞지 않거나 담당자가 없거나 더 이상 이 공연에 배정할 수 없는 담당자입니다.'),
    DEPENDENCY_UNAVAILABLE: dependency,
  },
}

export const assignMessages: OperationMessages = {
  forbidden: reviewerOnly('담당자 변경'),
  notFound: { title: 'Case 또는 담당자를 찾을 수 없습니다', description: `Case가 접근 범위 밖이거나, 입력한 멤버십이 같은 고객사의 활성 멤버가 아니거나 이 공연 권한이 없습니다. 각 경우는 구분해 안내하지 않습니다. ${notApplied}` },
  codes: {
    ASSIGNEE_ROLE_INVALID: { title: '담당자로 지정할 수 없는 역할입니다', description: `담당자는 분석 담당 또는 검토 담당 역할이 있어야 합니다. ${notApplied}` },
    CASE_STATE_CONFLICT: stateConflict('이미 같은 담당자가 지정되어 있습니다.'),
    DEPENDENCY_UNAVAILABLE: dependency,
  },
}

export const captureMessages: OperationMessages = {
  forbidden: reviewerOnly('EvidenceSnapshot 생성'),
  notFound: caseHidden,
  codes: {
    CASE_STATE_CONFLICT: stateConflict('EvidenceSnapshot은 검토 중 상태에서만 생성할 수 있습니다.'),
    SNAPSHOT_ALREADY_EXISTS: { title: '현재 증거 개정 번호의 Snapshot이 이미 있습니다', description: '같은 증거 구성으로 Snapshot을 다시 만들지 않습니다. 아래 목록의 기존 Snapshot을 사용해 주세요.' },
    SOURCE_CHANGED: { title: '출처 보존 상태 또는 원본 기록이 연결 시점과 다릅니다', description: '보존 기한 만료, 접수나 저장 상태 변경, 원본 객체 표시 변경 중 하나가 확인되어 Snapshot을 만들지 않았습니다. 정상 상태로 간주하지 않습니다.' },
    DEPENDENCY_UNAVAILABLE: dependency,
  },
}

export const draftMessages: OperationMessages = {
  forbidden: reviewerOnly('보고서 초안 작성'),
  notFound: { title: 'Case 또는 Snapshot을 찾을 수 없습니다', description: `Case가 접근 범위 밖이거나 선택한 Snapshot이 이 Case의 것이 아닙니다. ${notApplied}` },
  codes: {
    CASE_STATE_CONFLICT: stateConflict('보고서 초안은 검토 중 상태에서만 작성할 수 있습니다.'),
    EVIDENCE_VERSION_MISMATCH: { title: '선택한 Snapshot이 현재 증거 개정 번호와 다릅니다', description: `현재 증거 개정 번호의 Snapshot을 선택해 주세요. ${notApplied}` },
    SOURCE_CHANGED: { title: '출처 상태가 Snapshot 시점과 다릅니다', description: `보존 기한 만료나 저장 상태 변경 등으로 현재 출처가 Snapshot과 일치하지 않습니다. 정상 상태로 간주하지 않으며 ${notApplied}` },
    REPORT_CONTENT_UNCHANGED: { title: '직전 초안과 내용이 같습니다', description: `같은 내용의 새 개정을 만들지 않습니다. ${notApplied}` },
    DEPENDENCY_UNAVAILABLE: dependency,
  },
}

// ---------- 표시 문구 ----------

export const sourceIntegrityLabels: Record<SourceIntegrity, string> = {
  METADATA_ONLY: '메타데이터 대조 (원본 바이트 재검증 아님)',
  NO_FILE: '파일 증거 없음 (군집 또는 제보 기록만)',
}

export const reportVersionStatusLabels: Record<ReportVersionStatus, string> = {
  DRAFT: '초안 (승인 아님)',
  PENDING_APPROVAL: '승인 대기',
  APPROVED: '승인됨',
  REJECTED: '반려됨',
  WITHDRAWN: '철회됨',
  INVALIDATED: '무효화됨',
}
