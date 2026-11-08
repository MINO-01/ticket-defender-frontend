import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { approvalRequestStatuses, decisionOutcomes } from '../admin-approvals/approvalApi'
import { issuanceStatuses } from '../admin-reports/officialPdfApi'
import { caseViewSchema, offsetDateTime, uuid, version } from './caseApi'
import { reportVersionStatuses } from './caseWorkflowApi'

// Backend capstone-demo-integration-v1의 조사 사건 업무 연결(workflow)과 승인 감사 이력 조회 계약이다.
// workflow의 report, approval, officialPdf는 연결된 저장 기록이 없으면 null이다. nextStep은 화면 안내이며 실행 권한이나 PDF 적격성 판단이 아니다.
// 승인 감사 이력은 승인 요청, 검토 영수증, 결정, 철회와 무효화 기록만 담으며 조사 사건 활동 기록과 합친 전체 감사 기록이 아니다.

export const approvalAuditPageSize = 20

const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)

export const caseWorkflowSchema = z.object({
  investigation: caseViewSchema,
  nextStep: z.object({ code, description: z.string().min(1).max(500) }),
  report: z.object({
    reportVersionId: uuid,
    evidenceSnapshotId: uuid,
    evidenceRevision: version,
    revision: version,
    version,
    status: z.enum(reportVersionStatuses),
  }).nullable(),
  approval: z.object({
    approvalRequestId: uuid,
    requestStatus: z.enum(approvalRequestStatuses),
    approvalDecisionId: uuid.nullable(),
    decisionOutcome: z.enum(decisionOutcomes).nullable(),
    decidedAt: offsetDateTime.nullable(),
  }).refine((value) => (value.approvalDecisionId === null) === (value.decisionOutcome === null)
    && (value.approvalDecisionId === null) === (value.decidedAt === null)).nullable(),
  officialPdf: z.object({
    officialPdfIssuanceId: uuid,
    status: z.enum(issuanceStatuses),
    lastFailureCode: code.nullable(),
  }).nullable(),
})
  // 승인 없이 발급 기록이 있거나, 보고서 없이 승인 요청이 있는 조합은 저장 관계와 맞지 않으므로 계약 위반으로 처리한다.
  .refine((value) => value.officialPdf === null || value.approval?.approvalDecisionId != null)
  .refine((value) => value.approval === null || value.report !== null)

const approvalAuditItemSchema = z.object({
  approvalAuditEventId: uuid,
  approvalRequestId: uuid,
  approvalDecisionId: uuid.nullable(),
  reportVersionId: uuid.nullable(),
  evidenceSnapshotId: uuid.nullable(),
  actorMembershipId: uuid,
  eventType: code,
  fromStatus: code.nullable(),
  toStatus: code.nullable(),
  evidenceRevision: version,
  caseVersionBefore: version,
  caseVersionAfter: version,
  reason: z.string().max(2000).nullable(),
  occurredAt: offsetDateTime,
})

export const approvalAuditPageSchema = z.object({
  items: z.array(approvalAuditItemSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export type CaseWorkflow = z.infer<typeof caseWorkflowSchema>
export type ApprovalAuditItem = z.infer<typeof approvalAuditItemSchema>

export function caseWorkflowPath(caseId: string) {
  return `/api/v1/cases/${caseId}/workflow`
}

export function approvalAuditPath(caseId: string, page: number) {
  return adminApiPath(`/api/v1/cases/${caseId}/approval-audit-events`, { page, pageSize: approvalAuditPageSize })
}

/** 서버 문자열 그대로의 감사 유형을 업무 문구로 바꾼다. 모르는 값은 다른 의미로 바꾸지 않고 코드 그대로 보여 준다. */
export const approvalAuditTypeLabels: Record<string, string> = {
  APPROVAL_REQUESTED: '승인 요청 생성',
  REVIEW_RECEIPT_ISSUED: '독립 검토 시작 (검토 영수증 발급)',
  APPROVAL_DECIDED: '승인 결정 기록',
  APPROVAL_WITHDRAWN: '승인 요청 철회',
  APPROVAL_INVALIDATED: '승인 요청 무효화',
}

/** 서버 nextStep 코드의 화면 제목이다. 설명 문구는 서버 값을 그대로 함께 보여 준다. */
export const nextStepTitles: Record<string, string> = {
  TRIAGE_REQUIRED: '분류와 담당 지정',
  REVIEW_START_REQUIRED: '검토 시작',
  EVIDENCE_AND_REPORT_PREPARATION: '조사 근거 묶음과 보고서 초안 준비',
  EVIDENCE_GAP_REVIEW: '부족한 근거 확인',
  APPROVAL_BINDING_MISSING: '승인 요청 연결 확인',
  INDEPENDENT_APPROVER_DECISION_REQUIRED: '독립 승인 결정 필요',
  OFFICIAL_PDF_POLICY_GATE: '공식 PDF 발급 가능 여부 확인',
  OFFICIAL_PDF_RECORD_EXISTS: '공식 PDF 발급 기록 확인',
  CASE_CLOSURE_REVIEW: '종결 검토',
  CASE_CLOSED: '종료된 사건',
}
