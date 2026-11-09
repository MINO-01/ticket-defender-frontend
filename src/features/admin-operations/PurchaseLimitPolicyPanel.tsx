import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Input, Select, Textarea } from '../../components/common/FormControls'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { classifyMutation } from '../admin-cases/caseWorkflowApi'
import type { MutationOutcome } from '../admin-cases/caseWorkflowApi'
import caseStyles from '../admin-cases/Cases.module.css'
import { performanceListSchema, performancesPath } from '../admin-track2/candidatePipelineApi'
import type { VerifiedPerformance } from '../admin-track2/candidatePipelineApi'
import {
  applicationScopes, buildCreatePolicy, buildRevisePolicy, cancellationRefundRules, codeLabels, coverageLabels, describePolicyCode, emptyPolicyForm, formFromPolicy, limitSubjects,
  performanceCoverage, policyItemPath, policyListPath, policyListSchema, policyMessages, policyReadiness, policySchema, policyWithdrawPath, readinessLabels,
} from './purchaseLimitPolicyApi'
import type { PolicyForm, PurchaseLimitPolicy, Validated } from './purchaseLimitPolicyApi'
import styles from './Operations.module.css'

// Backend PR #80의 구매 한도 정책 조회, 등록, 수정, 철회 영역이다. 이 API가 없는 서버에서는 거부 응답을 그대로 안내하고 빈 정책으로 바꾸지 않는다.
// 한도 값과 의미 값은 고객사 관리자가 입력하며 화면이 기본값을 넣지 않는다. 결과가 불확실한 쓰기는 재전송하지 않고 목록을 다시 확인하게 한다.

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'revise'; policy: PurchaseLimitPolicy } | { kind: 'withdraw'; policy: PurchaseLimitPolicy }
type Notice = { tone: 'success' | 'failure' | 'uncertain'; title: string; description?: string }

function usePolicyWrite() {
  const client = useAdminApiClient()
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const send = async (path: string, method: 'POST' | 'PATCH', body: unknown, successStatus: number, verify: (data: PurchaseLimitPolicy) => boolean): Promise<MutationOutcome<PurchaseLimitPolicy> | null> => {
    if (sendingRef.current) return null
    sendingRef.current = true
    setSending(true)
    try {
      return classifyMutation(await client.request(path, { method, body, successStatus, schema: policySchema }), policyMessages, verify)
    } catch {
      return { kind: 'rejected', forbidden: false, message: { title: '요청을 보내지 않았습니다', description: '요청 경로 검사에 실패해 서버에 보내지 않았습니다.' } }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }
  return { sending, send }
}

export function PurchaseLimitPolicyPanel({ eventId }: { eventId: string }) {
  const [version, setVersion] = useState(0)
  const policies = useAdminQuery(policyListPath(eventId), policyListSchema, version)
  const performances = useAdminQuery(performancesPath(eventId), performanceListSchema)
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [notice, setNotice] = useState<Notice | null>(null)
  const write = usePolicyWrite()
  const uncertain = notice?.tone === 'uncertain'

  const settle = (outcome: MutationOutcome<PurchaseLimitPolicy> | null, success: string) => {
    if (outcome === null) return
    if (outcome.kind === 'succeeded') { setNotice({ tone: 'success', title: success }); setMode({ kind: 'closed' }) }
    else setNotice({ tone: outcome.kind === 'uncertain' ? 'uncertain' : 'failure', title: outcome.message.title, description: outcome.message.description })
    if (outcome.kind !== 'uncertain') setVersion((value) => value + 1)
  }
  const recheck = () => { setNotice(null); setMode({ kind: 'closed' }); setVersion((value) => value + 1) }

  const submitForm = (built: Validated<object>, target: Mode) => {
    if (!built.ok) return
    if (target.kind === 'create') {
      const body = built.body as { performanceId: string; policyVersion: string }
      void write.send(policyListPath(eventId), 'POST', body, 201, (data) => data.eventId === eventId && data.performanceId === body.performanceId && data.policyVersion === body.policyVersion)
        .then((outcome) => settle(outcome, '구매 한도 정책을 등록했습니다.'))
    } else if (target.kind === 'revise') {
      const body = built.body as { policyVersion: string }
      void write.send(policyItemPath(eventId, target.policy.policyId), 'PATCH', body, 200, (data) => data.policyId === target.policy.policyId && data.policyVersion === body.policyVersion)
        .then((outcome) => settle(outcome, '구매 한도 정책을 수정했습니다.'))
    }
  }
  const withdraw = (policy: PurchaseLimitPolicy) => {
    void write.send(policyWithdrawPath(eventId, policy.policyId), 'POST', { expectedRevision: policy.revision }, 200, (data) => data.policyId === policy.policyId && data.status === 'WITHDRAWN')
      .then((outcome) => settle(outcome, '구매 한도 정책을 철회했습니다.'))
  }

  let content
  if (policies.result === null) content = <LoadingSkeleton label="구매 한도 정책을 불러오는 중" />
  else if (policies.result.kind !== 'success') {
    const message = policies.result.kind === 'forbidden'
      ? { title: '구매 한도 정책을 조회하지 못했습니다', description: '고객사 관리자(TENANT_ADMIN) 역할이 없거나, 이 서버에 구매 한도 정책 API가 아직 배포되지 않아 서버가 거부했습니다.' }
      : describeAdminApiFailure(policies.result, '이 서버에 구매 한도 정책 API가 아직 없거나 공연이 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={policies.retry} />
  } else {
    const items = policies.result.data
    const active = performances.result?.kind === 'success' ? performances.result.data.filter((item) => item.status === 'ACTIVE') : null
    const locked = write.sending || uncertain
    content = <>
      {active !== null && <Coverage performances={active} policies={items} />}
      {performances.result !== null && performances.result.kind !== 'success' && <p className={caseStyles.caution} role="note">검증 회차를 불러오지 못해 회차별 정책 현황과 신규 등록을 표시하지 않습니다.</p>}
      {items.length === 0
        ? <EmptyState title="등록된 구매 한도 정책이 없습니다" description="정책이 없으면 한도 평가는 정책 미확인으로 남으며 기본 한도를 적용하지 않습니다." />
        : items.map((policy) => <PolicyItem key={policy.policyId} policy={policy} locked={locked} performances={performances.result?.kind === 'success' ? performances.result.data : []} mode={mode} onMode={setMode} onWithdraw={withdraw} />)}
      {mode.kind === 'create' && active !== null && <PolicyEditor key="create" performances={active} locked={locked} sending={write.sending} onCancel={() => setMode({ kind: 'closed' })} build={buildCreatePolicy} initial={emptyPolicyForm} onSubmit={(built) => submitForm(built, mode)} />}
      {mode.kind === 'revise' && <PolicyEditor key={`revise:${mode.policy.policyId}:${mode.policy.revision}`} performances={null} locked={locked} sending={write.sending} onCancel={() => setMode({ kind: 'closed' })} build={(form) => buildRevisePolicy(form, mode.policy)} initial={formFromPolicy(mode.policy)} onSubmit={(built) => submitForm(built, mode)} />}
      {mode.kind === 'closed' && active !== null && <div><Button size="small" disabled={locked || active.length === 0} onClick={() => { setNotice(null); setMode({ kind: 'create' }) }}>정책 등록</Button></div>}
    </>
  }
  return <Card className={styles.panel} aria-label="구매 한도 정책">
    <h2>구매 한도 정책</h2>
    <p className={styles.note}>고객사가 확인한 정책만 등록합니다. 플랫폼 기본 한도는 없고, 한도 초과는 조사 신호이며 위반 확정이 아닙니다. 고객사 관리자만 사용할 수 있고 서버가 권한을 판단합니다.</p>
    {notice && <div className={notice.tone === 'success' ? caseStyles.success : notice.tone === 'uncertain' ? caseStyles.uncertain : caseStyles.failure} role={notice.tone === 'success' ? 'status' : 'alert'}>
      <strong>{notice.tone === 'uncertain' ? '결과 미확인: ' : ''}{notice.title}</strong>
      {notice.description && <p>{notice.description}</p>}
      {uncertain && <><p>이 요청은 안전한 재전송을 지원하지 않습니다. 다시 보내지 말고 목록에서 실제 저장 여부를 확인해 주세요.</p><Button variant="secondary" size="small" onClick={recheck}>목록 다시 확인</Button></>}
    </div>}
    {content}
  </Card>
}

function Coverage({ performances, policies }: { performances: VerifiedPerformance[]; policies: PurchaseLimitPolicy[] }) {
  if (performances.length === 0) return <p className={caseStyles.caution} role="note">적용 중인 검증 회차가 없어 정책을 등록할 수 없습니다.</p>
  return <dl className={styles.facts} aria-label="회차별 정책 현황">
    {performances.map((item) => <div key={item.performanceId}><dt>{item.performanceRef}</dt><dd>{coverageLabels[performanceCoverage(item.performanceId, policies)]}</dd></div>)}
  </dl>
}

type ItemProps = { policy: PurchaseLimitPolicy; locked: boolean; performances: VerifiedPerformance[]; mode: Mode; onMode: (mode: Mode) => void; onWithdraw: (policy: PurchaseLimitPolicy) => void }

function PolicyItem({ policy, locked, performances, mode, onMode, onWithdraw }: ItemProps) {
  const active = policy.status === 'ACTIVE'
  const confirming = mode.kind === 'withdraw' && mode.policy.policyId === policy.policyId
  const reference = performances.find((item) => item.performanceId === policy.performanceId)?.performanceRef ?? policy.performanceId
  return <article className={caseStyles.source} aria-label={`정책 ${policy.policyVersion}`}>
    <dl className={styles.facts}>
      <div><dt>정책 버전 (개정)</dt><dd>{policy.policyVersion} ({policy.revision})</dd></div>
      <div><dt>상태</dt><dd>{describePolicyCode(policy.status)}</dd></div>
      <div><dt>회차</dt><dd>{reference}</dd></div>
      <div><dt>최대 수량</dt><dd>{policy.maxTicketsPerAccount}매</dd></div>
      <div><dt>한도 주체</dt><dd>{describePolicyCode(policy.limitSubject)}</dd></div>
      <div><dt>적용 범위</dt><dd>{describePolicyCode(policy.applicationScope)}{policy.salesPhaseRef ? `, ${policy.salesPhaseRef}` : ''}</dd></div>
      <div><dt>취소와 환불</dt><dd>{describePolicyCode(policy.cancellationRefundRule)}</dd></div>
      <div><dt>선예매</dt><dd>{policy.includesPresale === null ? '미지정' : policy.includesPresale ? '포함' : '제외'}</dd></div>
      <div><dt>적용 기간 (UTC, 시간대 없는 서버 값)</dt><dd>{policy.effectiveFrom} ~ {policy.effectiveUntil ?? '종료 없음'}</dd></div>
      <div><dt>정책 출처</dt><dd>{policy.policySource}</dd></div>
      <div><dt>확인 근거</dt><dd>{policy.verificationBasis}</dd></div>
    </dl>
    <p className={caseStyles.caution}>{readinessLabels[policyReadiness(policy)]}</p>
    {active && (confirming
      ? <div className={caseStyles.formActions}>
        <span>이 정책을 철회합니다. 되돌릴 수 없습니다.</span>
        <Button size="small" disabled={locked} onClick={() => onWithdraw(policy)}>철회 확인</Button>
        <Button variant="secondary" size="small" disabled={locked} onClick={() => onMode({ kind: 'closed' })}>취소</Button>
      </div>
      : <div className={caseStyles.formActions}>
        <Button variant="secondary" size="small" disabled={locked} onClick={() => onMode({ kind: 'revise', policy })}>수정</Button>
        <Button variant="secondary" size="small" disabled={locked} onClick={() => onMode({ kind: 'withdraw', policy })}>철회</Button>
      </div>)}
  </article>
}

type EditorProps<T extends object> = { performances: VerifiedPerformance[] | null; locked: boolean; sending: boolean; initial: PolicyForm; build: (form: PolicyForm) => Validated<T>; onSubmit: (built: Validated<T>) => void; onCancel: () => void }

function PolicyEditor<T extends object>({ performances, locked, sending, initial, build, onSubmit, onCancel }: EditorProps<T>) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof PolicyForm, string>>>({})
  const set = (name: keyof PolicyForm) => (change: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [name]: change.target.value }))
  const submit = () => {
    const built = build(form)
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    onSubmit(built)
  }
  const option = (value: string) => <option key={value} value={value}>{codeLabels[value]} ({value})</option>
  return <div className={caseStyles.form} role="group" aria-label={performances ? '정책 등록' : '정책 수정'}>
    {performances && <Select label="검증 회차" required value={form.performanceId} disabled={locked} onChange={set('performanceId')} error={errors.performanceId}>
      <option value="">회차를 선택해 주세요</option>
      {performances.map((item) => <option key={item.performanceId} value={item.performanceId}>{item.performanceRef}</option>)}
    </Select>}
    <Input label="계정당 최대 수량" required inputMode="numeric" value={form.maxTicketsPerAccount} disabled={locked} onChange={set('maxTicketsPerAccount')} error={errors.maxTicketsPerAccount} />
    <Input label={performances ? '정책 버전' : '새 정책 버전'} required maxLength={128} value={form.policyVersion} disabled={locked} onChange={set('policyVersion')} error={errors.policyVersion} />
    <Input label="적용 시작 (UTC)" required type="datetime-local" step={1} value={form.effectiveFrom} disabled={locked} onChange={set('effectiveFrom')} error={errors.effectiveFrom} />
    <Input label="적용 종료 (UTC, 비우면 종료 없음)" type="datetime-local" step={1} value={form.effectiveUntil} disabled={locked} onChange={set('effectiveUntil')} error={errors.effectiveUntil} />
    <Textarea label="정책 출처" required rows={2} maxLength={512} value={form.policySource} disabled={locked} onChange={set('policySource')} error={errors.policySource} />
    <Textarea label="확인 근거" required rows={2} maxLength={512} value={form.verificationBasis} disabled={locked} onChange={set('verificationBasis')} error={errors.verificationBasis} />
    <p className={caseStyles.caution}>아래 값을 확인하지 못했다면 비워 두세요. 비워 두면 추정하지 않고 분석에서 정책 미확인으로 남습니다.</p>
    <Select label="한도 주체" value={form.limitSubject} disabled={locked} onChange={set('limitSubject')}><option value="">확인되지 않음</option>{limitSubjects.map(option)}</Select>
    <Select label="적용 범위" value={form.applicationScope} disabled={locked} onChange={set('applicationScope')}><option value="">확인되지 않음</option>{applicationScopes.map(option)}</Select>
    {form.applicationScope === 'SALES_PHASE' && <>
      <Input label="판매 단계 참조" required maxLength={128} value={form.salesPhaseRef} disabled={locked} onChange={set('salesPhaseRef')} error={errors.salesPhaseRef} />
      <p className={caseStyles.caution}>판매 단계별 정책 선택은 현재 분석 계약 밖이라 등록해도 한도를 평가하지 않을 수 있습니다.</p>
    </>}
    <Select label="취소와 환불 처리" value={form.cancellationRefundRule} disabled={locked} onChange={set('cancellationRefundRule')}><option value="">확인되지 않음</option>{cancellationRefundRules.map(option)}</Select>
    {form.cancellationRefundRule === 'GROSS' && <p className={caseStyles.caution}>현재 분석 계약은 취소와 환불이 반영된(NETTED) 수량만 평가합니다.</p>}
    <Select label="선예매 포함 여부" value={form.includesPresale} disabled={locked} onChange={set('includesPresale')}><option value="">확인되지 않음</option><option value="true">포함</option><option value="false">제외</option></Select>
    <div className={caseStyles.formActions}>
      <Button size="small" loading={sending} disabled={locked} onClick={submit}>{performances ? '정책 저장' : '수정 저장'}</Button>
      <Button variant="secondary" size="small" disabled={sending} onClick={onCancel}>취소</Button>
    </div>
  </div>
}
