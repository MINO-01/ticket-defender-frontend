import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { offsetDateTime, uuid, version } from './caseApi'
import { textError } from './caseWorkflowApi'
import type { OperationMessages, WorkflowMessage } from './caseWorkflowApi'

// Backend EvidenceIntegrityController 계약이다(기준 main 576cc9c). 원본 바이트 검증 기록과 보고서 초안의 무결성 평가를 다룬다.
// 검증 실행은 REVIEWER만 가능하며 서버가 판단한다. MATCH는 검증 시점의 바이트 일치일 뿐 보존 불변성이나 승인 적격성을 뜻하지 않는다.
// 평가의 technicalIntegrity와 approvalEligibility는 서로 다른 값이다. 기술 검증이 통과해도 승인 적격성은 서버 값 그대로 표시한다.

export const verificationPageSize = 20
export const reasonMin = 3
export const reasonMax = 1800

export const verificationStatuses = ['MATCH', 'HASH_MISMATCH', 'SIZE_MISMATCH', 'OBJECT_MISSING', 'OBJECT_CHANGED', 'STORAGE_UNAVAILABLE', 'TOO_LARGE', 'RETENTION_EXPIRED'] as const
export type VerificationStatus = (typeof verificationStatuses)[number]

const preservationStatuses = ['UNPROTECTED', 'VERSIONED_MUTABLE', 'UNKNOWN'] as const
const markerKinds = ['VERSION_ID', 'ETAG', 'NONE'] as const
const verificationMethods = ['STREAMED_SHA256', 'NOT_READ'] as const
const technicalIntegrityValues = ['VERIFIED_AT_TIME', 'METADATA_VALID', 'BLOCKED', 'UNAVAILABLE'] as const

const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/)

export const verificationSchema = z.object({
  recordId: uuid,
  caseId: uuid,
  evidenceSnapshotId: uuid,
  sourceReferenceId: uuid,
  evidenceId: uuid,
  verificationStatus: z.enum(verificationStatuses),
  preservationStatus: z.enum(preservationStatuses),
  markerKind: z.enum(markerKinds),
  verificationMethod: z.enum(verificationMethods),
  verifiedByteSize: z.number().int().nonnegative().nullable(),
  verifiedAt: offsetDateTime,
})

export const verificationPageSchema = z.object({
  items: z.array(verificationSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  hasNext: z.boolean(),
})

export const integrityEvaluationSchema = z.object({
  caseId: uuid,
  evidenceSnapshotId: uuid,
  reportVersionId: uuid,
  technicalIntegrity: z.enum(technicalIntegrityValues),
  approvalEligibility: code,
  reasons: z.array(code),
})

export type EvidenceVerification = z.infer<typeof verificationSchema>
export type IntegrityEvaluation = z.infer<typeof integrityEvaluationSchema>
export type VerifyBody = { expectedCaseVersion: z.infer<typeof version>; evidenceSnapshotId: string; sourceReferenceId: string; evidenceId: string; reason: string }

export function evidenceVerificationPath(caseId: string) {
  return `/api/v1/cases/${caseId}/evidence-verifications`
}

export function evidenceVerificationListPath(caseId: string) {
  return adminApiPath(evidenceVerificationPath(caseId), { page: 0, pageSize: verificationPageSize })
}

export function integrityEvaluationPath(caseId: string, reportVersionId: string) {
  return adminApiPath(`/api/v1/cases/${caseId}/integrity-evaluation`, { reportVersionId })
}

export function verifyReasonError(reason: string) {
  return textError(reason, reasonMin, reasonMax)
}

export function isVerificationOf(data: EvidenceVerification, caseId: string, body: VerifyBody) {
  return data.caseId === caseId && data.evidenceSnapshotId === body.evidenceSnapshotId && data.sourceReferenceId === body.sourceReferenceId && data.evidenceId === body.evidenceId
}

export function isEvaluationOf(data: IntegrityEvaluation, caseId: string, reportVersionId: string) {
  return data.caseId === caseId && data.reportVersionId === reportVersionId
}

export const verificationStatusLabels: Record<VerificationStatus, string> = {
  MATCH: '검증 시점 바이트 일치',
  HASH_MISMATCH: 'SHA-256 불일치',
  SIZE_MISMATCH: '파일 크기 불일치',
  OBJECT_MISSING: '원본 객체 없음',
  OBJECT_CHANGED: '원본 객체 표시 변경',
  STORAGE_UNAVAILABLE: '저장소 응답 없음 (검증 불가)',
  TOO_LARGE: '검증 크기 제한 초과 (검증 불가)',
  RETENTION_EXPIRED: '보존 기한 만료',
}

export const preservationLabels: Record<z.infer<typeof verificationSchema>['preservationStatus'], string> = {
  UNPROTECTED: '보호 없음',
  VERSIONED_MUTABLE: '버전 관리됨, 변경 가능',
  UNKNOWN: '확인 불가',
}

export const technicalIntegrityLabels: Record<IntegrityEvaluation['technicalIntegrity'], string> = {
  VERIFIED_AT_TIME: '검증 시점 기준 일치',
  METADATA_VALID: '파일 증거 없음, 메타데이터만 일치',
  BLOCKED: '기술 검증 차단',
  UNAVAILABLE: '확인 불가 (의존 서비스 장애)',
}

const reasonLabels: Record<string, string> = {
  POLICY_UNAPPROVED: '증거 보존 및 승인 정책이 아직 승인되지 않았습니다.',
  CASE_STATE_NOT_ELIGIBLE: '조사 사건이 검토 중 상태가 아닙니다.',
  EVIDENCE_REVISION_CHANGED: '조사 근거 묶음 이후 증거 구성이 바뀌었습니다.',
  SNAPSHOT_DIGEST_MISMATCH: '조사 근거 묶음의 해시가 일치하지 않습니다.',
  REPORT_DIGEST_MISMATCH: '보고서 초안의 해시나 근거 연결이 일치하지 않습니다.',
  TEMPLATE_NOT_RETAINED: '보고서 초안 상태나 템플릿 보존을 확인할 수 없습니다.',
  SOURCE_CHANGED: '출처 상태나 구성이 조사 근거 묶음 시점과 다릅니다.',
  RETENTION_EXPIRED: '증거 보존 기한이 만료되었습니다.',
  BYTE_CHECK_REQUIRED: '이 조사 근거 묶음에 대한 원본 바이트 검증 기록이 없습니다.',
  VERIFICATION_STALE: '검증 기록이 현재 증거 또는 조사 근거 묶음과 맞지 않습니다. 다시 검증해야 합니다.',
  ORIGINAL_NOT_IMMUTABLE: '원본이 불변 저장(Object Lock)으로 보호되는지 확인되지 않았습니다.',
  DEPENDENCY_UNAVAILABLE: '저장소나 의존 서비스에 연결하지 못했습니다.',
}

/** 서버 사유 코드의 화면 문구다. 모르는 코드는 의미를 바꾸지 않고 코드 그대로 보여 준다. */
export function describeIntegrityReason(reason: string) {
  const known = reasonLabels[reason]
  if (known) return known
  const byte = reason.startsWith('BYTE_CHECK_') ? verificationStatusLabels[reason.slice('BYTE_CHECK_'.length) as VerificationStatus] : undefined
  return byte ? `원본 바이트 검증 결과: ${byte}` : `알 수 없는 서버 사유 (${reason})`
}

const recorded = '서버가 이 결과를 검증 기록에 남겼습니다. 아래 기록을 확인해 주세요.'
const failureMessage = (title: string, description: string): WorkflowMessage => ({ title, description: `${description} ${recorded}` })

export const verifyMessages: OperationMessages = {
  forbidden: { title: '원본 바이트 검증에 필요한 역할이 없습니다', description: '원본 바이트 검증은 검토 담당(REVIEWER) 역할만 실행할 수 있어 서버가 거부했습니다. 변경된 내용은 없습니다.' },
  notFound: { title: '조사 사건이나 출처를 찾을 수 없습니다', description: '조사 사건이 접근 범위 밖이거나 선택한 근거 묶음과 출처가 이 사건의 것이 아닙니다. 변경된 내용은 없습니다.' },
  codes: {
    HASH_MISMATCH: failureMessage('저장된 원본의 SHA-256이 접수 기록과 다릅니다', '원본이 일치한다고 간주하지 않습니다.'),
    SIZE_MISMATCH: failureMessage('저장된 원본의 크기가 접수 기록과 다릅니다', '원본이 일치한다고 간주하지 않습니다.'),
    OBJECT_MISSING: failureMessage('저장소에서 원본 객체를 찾지 못했습니다', '원본을 검증하지 못했습니다.'),
    OBJECT_CHANGED: failureMessage('원본 객체의 버전 표시가 접수 기록과 다릅니다', '원본이 일치한다고 간주하지 않습니다.'),
    TOO_LARGE: failureMessage('검증 크기 제한을 넘어 원본을 읽지 않았습니다', '이 결과는 일치가 아니라 검증 불가입니다.'),
    RETENTION_EXPIRED: failureMessage('증거 보존 기한이 만료되었습니다', '원본을 검증하지 못했습니다.'),
    SOURCE_NOT_AVAILABLE: { title: '이 출처는 원본 바이트 검증 대상이 아닙니다', description: '파일 증거 출처만 검증할 수 있습니다. 변경된 내용은 없습니다.' },
    SOURCE_CHANGED: { title: '출처 상태가 조사 근거 묶음 시점과 다릅니다', description: '출처 상태를 확인해 주세요. 변경된 내용은 없습니다.' },
    EVIDENCE_VERSION_MISMATCH: { title: '선택한 조사 근거 묶음이 현재 증거 구성과 다릅니다', description: '현재 증거 구성의 묶음을 선택해 주세요. 변경된 내용은 없습니다.' },
    CASE_STATE_CONFLICT: { title: '현재 사건 상태에서는 검증할 수 없습니다', description: '사건 상태를 확인해 주세요. 변경된 내용은 없습니다.' },
    DEPENDENCY_UNAVAILABLE: { title: '저장소에 연결하지 못해 검증하지 못했습니다', description: '일치 여부를 알 수 없습니다. 같은 요청으로 다시 확인할 수 있습니다.' },
  },
}
