import { z } from 'zod'
import type { OperationMessages } from '../admin-cases/caseWorkflowApi'
import { isUuid } from '../fan-report/intakeConfig'

// Backend PR #80(Issue #79, 82c5899)의 구매 한도 정책 API 계약이다. 역할은 TENANT_ADMIN이며 서버가 판단한다.
// 이 API는 멱등 키를 받지 않고 expectedRevision으로 충돌을 막는다. 결과가 불확실하면 자동 재전송하지 않고 목록을 다시 확인한다.
// 시각은 시간대 없는 LocalDateTime이며 서버 정책 계산은 UTC 기준이다. 의미 값이 없는 정책은 등록할 수 있으나 분석에서는 정책 미확인으로 남는다.

export const limitSubjects = ['ACCOUNT', 'PERSON'] as const
export const applicationScopes = ['EVENT', 'PERFORMANCE', 'SALES_PHASE'] as const
export const cancellationRefundRules = ['NETTED', 'GROSS'] as const

const uuid = z.string().refine(isUuid)

export const policySchema = z.object({
  policyId: uuid,
  eventId: uuid,
  performanceId: uuid,
  maxTicketsPerAccount: z.number().int().positive(),
  policyVersion: z.string().min(1),
  effectiveFrom: z.string().min(1),
  effectiveUntil: z.string().nullable(),
  status: z.string().min(1),
  policySource: z.string(),
  verificationBasis: z.string(),
  limitSubject: z.string().nullable(),
  applicationScope: z.string().nullable(),
  salesPhaseRef: z.string().nullable(),
  cancellationRefundRule: z.string().nullable(),
  includesPresale: z.boolean().nullable(),
  revision: z.number().int().positive(),
  changedAt: z.string().min(1),
})

export const policyListSchema = z.array(policySchema)
export type PurchaseLimitPolicy = z.infer<typeof policySchema>

export function policyListPath(eventId: string) {
  return `/api/v1/admin/events/${eventId}/purchase-limit-policies`
}

export function policyItemPath(eventId: string, policyId: string) {
  return `${policyListPath(eventId)}/${policyId}`
}

export function policyWithdrawPath(eventId: string, policyId: string) {
  return `${policyItemPath(eventId, policyId)}/withdrawals`
}

export type PolicyForm = {
  performanceId: string
  maxTicketsPerAccount: string
  policyVersion: string
  effectiveFrom: string
  effectiveUntil: string
  policySource: string
  verificationBasis: string
  limitSubject: string
  applicationScope: string
  salesPhaseRef: string
  cancellationRefundRule: string
  includesPresale: string
}

export const emptyPolicyForm: PolicyForm = {
  performanceId: '', maxTicketsPerAccount: '', policyVersion: '', effectiveFrom: '', effectiveUntil: '', policySource: '', verificationBasis: '',
  limitSubject: '', applicationScope: '', salesPhaseRef: '', cancellationRefundRule: '', includesPresale: '',
}

export function formFromPolicy(policy: PurchaseLimitPolicy): PolicyForm {
  return {
    performanceId: policy.performanceId, maxTicketsPerAccount: String(policy.maxTicketsPerAccount), policyVersion: '',
    effectiveFrom: policy.effectiveFrom.slice(0, 19), effectiveUntil: policy.effectiveUntil?.slice(0, 19) ?? '', policySource: policy.policySource, verificationBasis: policy.verificationBasis,
    limitSubject: policy.limitSubject ?? '', applicationScope: policy.applicationScope ?? '', salesPhaseRef: policy.salesPhaseRef ?? '',
    cancellationRefundRule: policy.cancellationRefundRule ?? '', includesPresale: policy.includesPresale === null ? '' : String(policy.includesPresale),
  }
}

/** datetime-local 값을 Backend LocalDateTime 형식으로 맞춘다. 시간대를 더하지 않는다. */
function localDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
}

const validDateTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}Z`))

type PolicyValues = Omit<PolicyBody, 'performanceId'>
export type PolicyBody = {
  performanceId: string
  maxTicketsPerAccount: number
  policyVersion: string
  effectiveFrom: string
  effectiveUntil: string | null
  policySource: string
  verificationBasis: string
  limitSubject: string | null
  applicationScope: string | null
  salesPhaseRef: string | null
  cancellationRefundRule: string | null
  includesPresale: boolean | null
}
export type RevisePolicyBody = PolicyValues & { expectedRevision: number }
export type Validated<T> = { ok: true; body: T } | { ok: false; errors: Partial<Record<keyof PolicyForm, string>> }

const text = (value: string, name: string, max: number) => {
  const size = value.trim().length
  return size === 0 ? `${name}을(를) 입력해 주세요.` : value.trim().length > max ? `${max}자 이하로 입력해 주세요.` : undefined
}

function validate(form: PolicyForm): Validated<PolicyValues> {
  const errors: Partial<Record<keyof PolicyForm, string>> = {}
  const maximum = /^[1-9]\d{0,8}$/.test(form.maxTicketsPerAccount.trim()) ? Number(form.maxTicketsPerAccount.trim()) : null
  if (maximum === null) errors.maxTicketsPerAccount = '1 이상의 정수를 입력해 주세요. 기본 한도는 없습니다.'
  errors.policyVersion = text(form.policyVersion, '정책 버전', 128)
  errors.policySource = text(form.policySource, '정책 출처', 512)
  errors.verificationBasis = text(form.verificationBasis, '확인 근거', 512)
  const from = localDateTime(form.effectiveFrom.trim())
  const until = form.effectiveUntil.trim() === '' ? null : localDateTime(form.effectiveUntil.trim())
  if (!validDateTime(from)) errors.effectiveFrom = '적용 시작 시각을 입력해 주세요.'
  if (until !== null && !validDateTime(until)) errors.effectiveUntil = '적용 종료 시각 형식이 올바르지 않습니다.'
  else if (until !== null && until <= from) errors.effectiveUntil = '종료 시각은 시작 시각보다 뒤여야 합니다.'
  const phase = form.applicationScope === 'SALES_PHASE' ? form.salesPhaseRef.trim() : ''
  if (form.applicationScope === 'SALES_PHASE') errors.salesPhaseRef = text(form.salesPhaseRef, '판매 단계 참조', 128)
  const found = Object.entries(errors).filter(([, value]) => value !== undefined)
  if (found.length > 0) return { ok: false, errors: Object.fromEntries(found) }
  return { ok: true, body: {
    maxTicketsPerAccount: maximum as number, policyVersion: form.policyVersion.trim(), effectiveFrom: from, effectiveUntil: until,
    policySource: form.policySource.trim(), verificationBasis: form.verificationBasis.trim(),
    limitSubject: form.limitSubject || null, applicationScope: form.applicationScope || null, salesPhaseRef: phase || null,
    cancellationRefundRule: form.cancellationRefundRule || null, includesPresale: form.includesPresale === '' ? null : form.includesPresale === 'true',
  } }
}

export function buildCreatePolicy(form: PolicyForm): Validated<PolicyBody> {
  const result = validate(form)
  if (!isUuid(form.performanceId)) return { ok: false, errors: { ...(result.ok ? {} : result.errors), performanceId: '검증 회차를 선택해 주세요.' } }
  return result.ok ? { ok: true, body: { performanceId: form.performanceId, ...result.body } } : result
}

export function buildRevisePolicy(form: PolicyForm, policy: PurchaseLimitPolicy): Validated<RevisePolicyBody> {
  const result = validate(form)
  if (result.ok && result.body.policyVersion === policy.policyVersion) return { ok: false, errors: { policyVersion: '수정할 때는 새 정책 버전을 입력해야 합니다.' } }
  return result.ok ? { ok: true, body: { expectedRevision: policy.revision, ...result.body } } : result
}

export type PolicyAnalysisReadiness = 'CONFIRMED_ACCOUNT' | 'PERSON_BASIS_REQUIRED' | 'SEMANTICS_MISSING' | 'NOT_ACTIVE'

/** 서버의 hasConfirmedAccountLimitSemantics와 같은 조건의 안내다. 실제 평가 결과가 아니며 서버가 분석 시점에 다시 판단한다. */
export function policyReadiness(policy: PurchaseLimitPolicy): PolicyAnalysisReadiness {
  if (policy.status !== 'ACTIVE') return 'NOT_ACTIVE'
  const complete = policy.limitSubject !== null && policy.applicationScope !== null && policy.cancellationRefundRule !== null && policy.includesPresale !== null
    && (policy.applicationScope !== 'SALES_PHASE' || policy.salesPhaseRef !== null)
  if (!complete) return 'SEMANTICS_MISSING'
  return policy.limitSubject === 'ACCOUNT' ? 'CONFIRMED_ACCOUNT' : 'PERSON_BASIS_REQUIRED'
}

export const readinessLabels: Record<PolicyAnalysisReadiness, string> = {
  CONFIRMED_ACCOUNT: '계정 한도 의미 값 확인됨. 평가 여부는 분석 시점에 서버가 판단합니다.',
  PERSON_BASIS_REQUIRED: '동일인 정책입니다. 고객사가 승인한 신원 근거가 없으면 정책 미확인(POLICY_NOT_CONFIRMED)으로 남습니다.',
  SEMANTICS_MISSING: '의미 값이 비어 있어 분석에서 정책 미확인(POLICY_NOT_CONFIRMED)으로 남습니다.',
  NOT_ACTIVE: '적용 중이 아닌 정책입니다. 분석에 쓰이지 않습니다.',
}

export type PerformanceCoverage = 'NONE' | 'UNCONFIRMED_ONLY' | 'CONFIRMED'

/** 회차에 적용될 수 있는 적용 중 정책을 요약한다. 판매 단계 선택과 기간 판단은 서버 몫이므로 평가 가능으로 단정하지 않는다. */
export function performanceCoverage(performanceId: string, policies: PurchaseLimitPolicy[]): PerformanceCoverage {
  const relevant = policies.filter((policy) => policy.status === 'ACTIVE' && (policy.performanceId === performanceId || policy.applicationScope === 'EVENT'))
  if (relevant.length === 0) return 'NONE'
  return relevant.some((policy) => policyReadiness(policy) === 'CONFIRMED_ACCOUNT') ? 'CONFIRMED' : 'UNCONFIRMED_ONLY'
}

export const coverageLabels: Record<PerformanceCoverage, string> = {
  NONE: '정책 없음. 한도를 평가하지 않습니다 (POLICY_NOT_CONFIRMED).',
  UNCONFIRMED_ONLY: '의미 값이 확인된 계정 한도 정책 없음 (POLICY_NOT_CONFIRMED).',
  CONFIRMED: '확인된 정책 있음. 수량 자료가 불완전하면 평가하지 않습니다 (QUANTITY_DATA_INCOMPLETE).',
}

export const codeLabels: Record<string, string> = {
  ACTIVE: '적용 중', WITHDRAWN: '철회됨', ACCOUNT: '계정별', PERSON: '동일인별', EVENT: '공연 전체', PERFORMANCE: '회차', SALES_PHASE: '판매 단계',
  NETTED: '취소와 환불 반영', GROSS: '취소와 환불 미반영',
}

export function describePolicyCode(value: string | null) {
  if (value === null) return '미지정'
  return codeLabels[value] ? `${codeLabels[value]} (${value})` : `알 수 없는 서버 값 (${value})`
}

const notApplied = '변경된 내용은 없습니다.'

export const policyMessages: OperationMessages = {
  forbidden: { title: '구매 한도 정책을 변경하지 못했습니다', description: `고객사 관리자(TENANT_ADMIN) 역할이 없거나, 이 서버에 구매 한도 정책 API가 아직 배포되지 않아 서버가 거부했습니다. ${notApplied}` },
  notFound: { title: '정책이나 회차를 찾을 수 없습니다', description: `접근 범위 밖이거나 삭제된 대상입니다. ${notApplied}` },
  codes: {
    PURCHASE_LIMIT_POLICY_CONFLICT: { title: '같은 범위의 적용 중 정책이 이미 있습니다', description: `기존 정책을 수정하거나 철회해 주세요. ${notApplied}` },
    PURCHASE_LIMIT_POLICY_VERSION_REUSE: { title: '이미 사용한 정책 버전입니다', description: `정책 버전은 다시 쓸 수 없습니다. 새 버전을 입력해 주세요. ${notApplied}` },
    PURCHASE_LIMIT_POLICY_REVISION_CONFLICT: { title: '다른 변경이 먼저 저장되었습니다', description: `목록을 새로 불러왔습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요. ${notApplied}` },
    PURCHASE_LIMIT_POLICY_WITHDRAWN: { title: '이미 철회된 정책입니다', description: `철회된 정책은 변경할 수 없습니다. ${notApplied}` },
    PERFORMANCE_WITHDRAWN: { title: '철회된 검증 회차입니다', description: `적용 중인 검증 회차를 선택해 주세요. ${notApplied}` },
  },
}
