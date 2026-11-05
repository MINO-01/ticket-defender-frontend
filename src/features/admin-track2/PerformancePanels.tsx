import { useState } from 'react'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Input, Select, Textarea } from '../../components/common/FormControls'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import caseStyles from '../admin-cases/Cases.module.css'
import { MutationStatus } from '../admin-cases/MutationStatus'
import { useCaseMutation } from '../admin-cases/useCaseMutation'
import {
  activeLink, buildCreatePerformance, buildLink, buildRevisePerformance, buildWithdrawLink, buildWithdrawPerformance, linkMessages, linkStatusLabels,
  performanceLinkHistorySchema, performanceLinkPath, performanceLinkSchema, performanceLinkWithdrawPath, performanceListSchema, performancePath, performanceSchema,
  performancesPath, performanceStatusLabels, performanceWithdrawPath, withdrawLinkMessages,
} from './candidatePipelineApi'
import type { LinkBody, PerformanceLink, VerifiedPerformance, WithdrawLinkBody } from './candidatePipelineApi'
import { StatusPill } from './StatusPill'
import { formatUtc } from './track2Api'
import type { FanReportDetail } from './track2Api'
import styles from './Track2.module.css'
import { usePerformanceWrite } from './usePerformanceWrite'
import type { PerformanceWriteState } from './usePerformanceWrite'

// 제보 상세의 검증 회차 관리와 제보 회차 연결 영역이다. 제보 응답의 공연 ID로만 조회하고, 다른 공연이나 다른 제보의 응답은 표시하지 않는다.
// 회차 목록, 쓰기, 연결은 REVIEWER, TENANT_ADMIN만 허용된다. 403은 이 영역에만 안내하고 제보 상세나 후보 대조 영역을 막지 않는다.
// 팬 입력 공연 일시나 이미지 분석의 공연 일시 관찰값으로 회차를 자동 선택하거나 연결하지 않는다. 연결은 관리자가 회차를 고르고 명시적으로 요청할 때만 보낸다.

function failureOf<T>(result: { kind: 'success'; status: number; data: T } | AdminApiFailure, valid: (data: T) => boolean): AdminApiFailure | null {
  if (result.kind !== 'success') return result
  return valid(result.data) ? null : { kind: 'invalidResponse', status: result.status }
}

function manageFailure(failure: AdminApiFailure, notFoundTitle: string) {
  if (failure.kind === 'forbidden') return { title: '이 영역에 필요한 역할이 없습니다', description: '검증 회차와 회차 연결은 검토 담당(REVIEWER) 또는 고객사 관리자(TENANT_ADMIN)만 조회하고 변경할 수 있습니다. 아래 증거와 후보 대조 영역은 역할에 따라 따로 동작합니다.' }
  return describeAdminApiFailure(failure, notFoundTitle)
}

export function PerformanceSection({ report }: { report: FanReportDetail }) {
  const eventId = report.event.id
  const [listVersion, setListVersion] = useState(0)
  const [linkVersion, setLinkVersion] = useState(0)
  const list = useAdminQuery(performancesPath(eventId), performanceListSchema, listVersion)
  const links = useAdminQuery(performanceLinkPath(report.fanReportId), performanceLinkHistorySchema, linkVersion)
  const listFailure = list.result === null ? null : failureOf(list.result, (items) => items.every((item) => item.eventId === eventId))
  const freshPerformances = list.result?.kind === 'success' && listFailure === null ? list.result.data : null
  const linkFailure = links.result === null ? null : failureOf(links.result, (data) => data.items.every((item) => item.fanReportId === report.fanReportId))
  const freshLinks = links.result?.kind === 'success' && linkFailure === null ? links.result.data.items : null
  // 쓰기 뒤 다시 조회하는 동안에는 직전 목록을 계속 보여 준다. 화면을 다시 만들면 쓰기 결과 안내와 결과 미확인 차단 상태가 사라지기 때문이다.
  const [lastPerformances, setLastPerformances] = useState<VerifiedPerformance[] | null>(null)
  const [lastLinks, setLastLinks] = useState<PerformanceLink[] | null>(null)
  if (freshPerformances !== null && freshPerformances !== lastPerformances) setLastPerformances(freshPerformances)
  if (freshLinks !== null && freshLinks !== lastLinks) setLastLinks(freshLinks)
  const performances = freshPerformances ?? (list.result === null ? lastPerformances : null)
  const linkItems = freshLinks ?? (links.result === null ? lastLinks : null)

  return <>
    <Card className={styles.panel} aria-label="검증 회차">
      <div className={styles.panelHeading}><h2>검증 회차</h2><span>{report.event.name}, 검토 담당 또는 고객사 관리자</span></div>
      <p className={styles.subtleNote}>관리자가 고객사 공연의 회차 식별자를 직접 확인해 등록합니다. 팬 입력 공연 일시와 이미지 분석의 공연 일시 관찰값은 참고일 뿐 회차를 자동으로 확정하지 않습니다.</p>
      {performances === null && list.result === null ? <LoadingSkeleton label="검증 회차를 불러오는 중" />
        : performances === null ? (() => { const message = manageFailure(listFailure!, '공연을 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={list.retry} /> })()
          : <PerformanceManager eventId={eventId} performances={performances} onChanged={() => setListVersion((value) => value + 1)} />}
    </Card>
    <Card className={styles.panel} aria-label="제보 회차 연결">
      <div className={styles.panelHeading}><h2>제보 회차 연결</h2><span>사람이 확인한 연결</span></div>
      <p className={styles.subtleNote}>사람이 확인한 회차 연결입니다. 이미지 분석이 읽은 공연명, 공연 일시 관찰값과는 다른 기록이며 후보 대조는 이 연결만 사용합니다.</p>
      {linkItems === null && links.result === null ? <LoadingSkeleton label="회차 연결 이력을 불러오는 중" />
        : linkItems === null ? (() => { const message = manageFailure(linkFailure!, '제보를 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={links.retry} /> })()
          : <LinkManager fanReportId={report.fanReportId} items={linkItems} performances={performances} onChanged={() => setLinkVersion((value) => value + 1)} />}
    </Card>
  </>
}

function WriteStatus<T>({ state, successText, onAcknowledge }: { state: PerformanceWriteState<T> | null; successText: string; onAcknowledge: () => void }) {
  if (state === null || state.kind === 'sending') return null
  if (state.kind === 'succeeded') return <p className={caseStyles.success} role="status">{successText}</p>
  if (state.kind === 'rejected') return <div className={caseStyles.failure} role="alert"><strong>요청 거부: {state.message.title}</strong><p>{state.message.description}</p></div>
  return <div className={caseStyles.uncertain} role="alert">
    <strong>결과 미확인: {state.message.title}</strong>
    <p>{state.message.description}</p>
    <Button size="small" variant="secondary" onClick={onAcknowledge}>목록을 확인했고 새 요청을 보낼 수 있게 합니다</Button>
  </div>
}

type Action = { kind: 'revise' | 'withdraw'; performance: VerifiedPerformance }

function PerformanceManager({ eventId, performances, onChanged }: { eventId: string; performances: VerifiedPerformance[]; onChanged: () => void }) {
  const [form, setForm] = useState({ performanceRef: '', verificationBasis: '', sourceVersion: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const create = usePerformanceWrite(performanceSchema, 201)
  const [action, setAction] = useState<Action | null>(null)

  const onCreate = () => {
    const built = buildCreatePerformance(form)
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const body = built.body
    void create.send(performancesPath(eventId), 'POST', body, (data) => data.eventId === eventId && data.performanceRef === body.performanceRef && data.revision === 1).then((next) => {
      if (next === null) return
      if (next.kind === 'succeeded') setForm({ performanceRef: '', verificationBasis: '', sourceVersion: '' })
      // 성공, 거부, 결과 미확인 모두 서버의 현재 목록을 다시 불러온다. 목록은 이 요청의 결과 확정에 쓰지 않는다.
      onChanged()
    })
  }
  const createBlocked = create.state?.kind === 'sending' || create.state?.kind === 'uncertain'

  return <>
    {performances.length === 0
      ? <EmptyState title="검증된 회차가 없습니다" description="이 공연에 등록된 검증 회차가 없습니다. 회차 연결과 후보 대조에는 검증 회차가 필요합니다." />
      : <ol className={styles.attempts} aria-label="검증 회차 목록">{performances.map((item) => <li key={item.performanceId}>
        <article className={styles.attempt} aria-label={`검증 회차 ${item.performanceRef}`}>
          <div className={styles.attemptHeading}>
            <strong className={styles.plainText}>{item.performanceRef}</strong>
            <StatusPill label={performanceStatusLabels[item.status]} tone={item.status === 'ACTIVE' ? 'info' : 'neutral'} />
          </div>
          <dl className={styles.factList}>
            <div><dt>revision</dt><dd>{item.revision}</dd></div>
            <div><dt>출처 버전 (sourceVersion)</dt><dd className={styles.plainText}>{item.sourceVersion}</dd></div>
            <div><dt>검증 시각</dt><dd><time dateTime={item.verifiedAt}>{formatUtc(item.verifiedAt)}</time></dd></div>
            <div><dt>철회 시각</dt><dd>{item.withdrawnAt === null ? '철회되지 않음' : <time dateTime={item.withdrawnAt}>{formatUtc(item.withdrawnAt)}</time>}</dd></div>
            <div><dt>회차 ID</dt><dd className={styles.idCell}>{item.performanceId}</dd></div>
          </dl>
          {item.status === 'ACTIVE' && <div className={styles.previewActions}>
            <Button size="small" variant="secondary" onClick={() => setAction({ kind: 'revise', performance: item })}>검증 근거 수정</Button>
            <Button size="small" variant="secondary" onClick={() => setAction({ kind: 'withdraw', performance: item })}>회차 철회</Button>
          </div>}
          {action !== null && action.performance.performanceId === item.performanceId && <PerformanceActionForm key={`${action.kind}:${item.performanceId}:${item.revision}`} eventId={eventId} action={action} onClose={() => setAction(null)} onChanged={onChanged} />}
        </article>
      </li>)}</ol>}
    <section className={caseStyles.created} aria-label="검증 회차 등록">
      <h3>검증 회차 등록</h3>
      <p className={caseStyles.caution}>검증 근거에는 개인정보, 예매번호, 계정 정보를 넣지 마세요. 회차 식별자는 등록 후 바꿀 수 없으며 다른 식별자는 새 회차로 등록합니다.</p>
      <div className={caseStyles.form}>
        <Input label="회차 식별자 (performanceRef)" required maxLength={128} value={form.performanceRef} disabled={createBlocked} onChange={(change) => setForm({ ...form, performanceRef: change.target.value })} error={errors.performanceRef} autoComplete="off" spellCheck={false} />
        <Textarea label="검증 근거" required rows={2} maxLength={512} value={form.verificationBasis} disabled={createBlocked} onChange={(change) => setForm({ ...form, verificationBasis: change.target.value })} error={errors.verificationBasis} />
        <Input label="출처 버전 (sourceVersion)" required maxLength={128} value={form.sourceVersion} disabled={createBlocked} onChange={(change) => setForm({ ...form, sourceVersion: change.target.value })} error={errors.sourceVersion} autoComplete="off" spellCheck={false} />
        <div className={caseStyles.formActions}><Button onClick={onCreate} loading={create.state?.kind === 'sending'} disabled={createBlocked}>{create.state?.kind === 'sending' ? '회차 등록 중' : '검증 회차 등록'}</Button></div>
      </div>
      <WriteStatus state={create.state} successText="검증 회차를 등록했습니다." onAcknowledge={create.acknowledge} />
    </section>
  </>
}

function PerformanceActionForm({ eventId, action, onClose, onChanged }: { eventId: string; action: Action; onClose: () => void; onChanged: () => void }) {
  const performance = action.performance
  const revise = action.kind === 'revise'
  const write = usePerformanceWrite(performanceSchema, 200)
  const [basis, setBasis] = useState('')
  const [sourceVersion, setSourceVersion] = useState(performance.sourceVersion)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const blocked = write.state?.kind === 'sending' || write.state?.kind === 'uncertain'

  const onSubmit = () => {
    const built = revise ? buildRevisePerformance(performance, { verificationBasis: basis, sourceVersion }) : buildWithdrawPerformance(performance, reason)
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const path = revise ? performancePath(eventId, performance.performanceId) : performanceWithdrawPath(eventId, performance.performanceId)
    const verify = (data: VerifiedPerformance) => data.performanceId === performance.performanceId && data.eventId === eventId
      && data.revision === performance.revision + 1 && data.status === (revise ? 'ACTIVE' : 'WITHDRAWN')
    void write.send(path, revise ? 'PATCH' : 'POST', built.body, verify).then((next) => { if (next !== null) onChanged() })
  }

  return <section className={caseStyles.created} aria-label={revise ? '검증 근거 수정' : '회차 철회'}>
    <h3>{revise ? '검증 근거 수정' : '회차 철회'} (revision {performance.revision} 기준)</h3>
    {revise
      ? <p className={caseStyles.caution}>조회 응답에는 이전 검증 근거가 없어 다시 입력해야 합니다. 수정하면 revision이 올라가고, 이전 revision으로 연결된 기존 후보 실행은 적용 대상이 바뀝니다.</p>
      : <p className={caseStyles.caution}>철회는 기존 후보 실행 기록을 바꾸지 않습니다. 이후 이 회차로 후보 대조를 실행할 수 없고 과거 실행의 적용 여부만 다시 평가됩니다.</p>}
    <div className={caseStyles.form}>
      {revise ? <>
        <Textarea label="새 검증 근거" required rows={2} maxLength={512} value={basis} disabled={blocked} onChange={(change) => setBasis(change.target.value)} error={errors.verificationBasis} />
        <Input label="출처 버전 (sourceVersion)" required maxLength={128} value={sourceVersion} disabled={blocked} onChange={(change) => setSourceVersion(change.target.value)} error={errors.sourceVersion} autoComplete="off" spellCheck={false} />
      </> : <Textarea label="철회 사유" required rows={2} maxLength={512} value={reason} disabled={blocked} onChange={(change) => setReason(change.target.value)} error={errors.reason} />}
      <div className={caseStyles.formActions}>
        <Button onClick={onSubmit} loading={write.state?.kind === 'sending'} disabled={blocked || write.state?.kind === 'succeeded'}>{revise ? '수정 요청' : '철회 요청'}</Button>
        <Button variant="secondary" onClick={onClose} disabled={write.state?.kind === 'sending'}>닫기</Button>
      </div>
    </div>
    <WriteStatus state={write.state} successText={revise ? '검증 근거를 수정했습니다.' : '검증 회차를 철회했습니다.'} onAcknowledge={write.acknowledge} />
  </section>
}

function LinkManager({ fanReportId, items, performances, onChanged }: { fanReportId: string; items: PerformanceLink[]; performances: VerifiedPerformance[] | null; onChanged: () => void }) {
  const active = activeLink(items)
  const [selected, setSelected] = useState('')
  const [reason, setReason] = useState('')
  const [withdrawReason, setWithdrawReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const link = useCaseMutation<LinkBody, PerformanceLink>({ method: 'PUT', schema: performanceLinkSchema, successStatus: 201, messages: linkMessages })
  const withdraw = useCaseMutation<WithdrawLinkBody, PerformanceLink>({ method: 'POST', schema: performanceLinkSchema, successStatus: 200, messages: withdrawLinkMessages })
  const busy = link.attempt?.kind === 'sending' || withdraw.attempt?.kind === 'sending'
  const pending = link.attempt?.kind === 'uncertain' || withdraw.attempt?.kind === 'uncertain'
  const choices = performances?.filter((item) => item.status === 'ACTIVE') ?? []
  const linked = active === null ? null : performances?.find((item) => item.performanceId === active.performanceId) ?? null

  const settle = (next: { kind: string } | null) => {
    if (next === null || next.kind === 'sending') return
    if (next.kind === 'succeeded') { setReason(''); setWithdrawReason(''); setSelected('') }
    // 확정 충돌과 결과 미확인 모두 이력을 다시 불러온다. 이력으로 이전 요청의 반영 여부를 추정하지 않는다.
    onChanged()
  }
  const verifyLink = (body: LinkBody) => (data: PerformanceLink) => data.fanReportId === fanReportId && data.performanceId === body.performanceId
  const verifyWithdraw = (data: PerformanceLink) => data.fanReportId === fanReportId && data.status === 'WITHDRAWN'

  const onLink = () => {
    const built = buildLink(active, selected, reason)
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    void link.submit(performanceLinkPath(fanReportId), built.body, verifyLink(built.body)).then(settle)
  }
  const onWithdraw = () => {
    if (active === null) return
    const built = buildWithdrawLink(active, withdrawReason)
    if (!built.ok) { setErrors({ withdrawReason: built.errors.reason }); return }
    setErrors({})
    void withdraw.submit(performanceLinkWithdrawPath(fanReportId), built.body, verifyWithdraw).then(settle)
  }

  return <>
    {active === null
      ? <p className={caseStyles.blocked} role="note">현재 연결된 검증 회차가 없습니다. 연결이 없으면 후보 대조는 회차 연결 미확인(PERFORMANCE_LINK_UNVERIFIED)으로 종료됩니다.</p>
      : <dl className={styles.factList} aria-label="현재 회차 연결">
        <div><dt>연결 회차</dt><dd className={styles.plainText}>{active.performanceRef}</dd></div>
        <div><dt>연결 시점 회차 revision</dt><dd>{active.performanceRevision}</dd></div>
        <div><dt>연결 revision</dt><dd>{active.linkRevision}</dd></div>
        <div><dt>연결 시각</dt><dd><time dateTime={active.createdAt}>{formatUtc(active.createdAt)}</time></dd></div>
      </dl>}
    {linked !== null && (linked.status !== 'ACTIVE' || linked.revision !== active?.performanceRevision) && <p className={caseStyles.caution} role="note">연결 이후 검증 회차가 {linked.status !== 'ACTIVE' ? '철회되었습니다' : `revision ${linked.revision}로 바뀌었습니다`}. 연결을 다시 확인해 주세요. 화면이 연결을 자동으로 바꾸지 않습니다.</p>}

    {performances === null
      ? <p className={caseStyles.caution}>검증 회차 목록을 불러오지 못해 연결할 회차를 고를 수 없습니다.</p>
      : <section className={caseStyles.created} aria-label={active === null ? '회차 연결' : '회차 교체'}>
        <h3>{active === null ? '회차 연결' : '다른 회차로 교체'}</h3>
        <div className={caseStyles.form}>
          <Select label="연결할 검증 회차" required value={selected} disabled={busy || pending || choices.length === 0} onChange={(change) => setSelected(change.target.value)} error={errors.performanceId}>
            <option value="">회차를 선택해 주세요</option>
            {choices.map((item) => <option key={item.performanceId} value={item.performanceId}>{item.performanceRef} (revision {item.revision})</option>)}
          </Select>
          <Textarea label="연결 사유" required rows={2} maxLength={512} value={reason} disabled={busy || pending} onChange={(change) => setReason(change.target.value)} error={errors.reason} />
          <div className={caseStyles.formActions}>
            {link.attempt?.kind === 'uncertain'
              ? <Button onClick={() => { void link.reconfirm(performanceLinkPath(fanReportId), (data) => data.fanReportId === fanReportId).then(settle) }} loading={busy}>연결 요청 재확인</Button>
              : <Button onClick={onLink} loading={link.attempt?.kind === 'sending'} disabled={busy || pending || choices.length === 0}>{active === null ? '회차 연결' : '회차 교체'}</Button>}
          </div>
        </div>
      </section>}
    <MutationStatus attempt={link.attempt} successText="회차를 연결했습니다. 기존 연결은 교체 이력으로 남습니다." />

    {active !== null && <section className={caseStyles.created} aria-label="회차 연결 철회">
      <h3>회차 연결 철회</h3>
      <div className={caseStyles.form}>
        <Textarea label="연결 철회 사유" required rows={2} maxLength={512} value={withdrawReason} disabled={busy || pending} onChange={(change) => setWithdrawReason(change.target.value)} error={errors.withdrawReason} />
        <div className={caseStyles.formActions}>
          {withdraw.attempt?.kind === 'uncertain'
            ? <Button onClick={() => { void withdraw.reconfirm(performanceLinkWithdrawPath(fanReportId), verifyWithdraw).then(settle) }} loading={busy}>철회 요청 재확인</Button>
            : <Button variant="secondary" onClick={onWithdraw} loading={withdraw.attempt?.kind === 'sending'} disabled={busy || pending}>회차 연결 철회</Button>}
        </div>
      </div>
    </section>}
    <MutationStatus attempt={withdraw.attempt} successText="회차 연결을 철회했습니다." />

    <section className={styles.history} aria-label="회차 연결 이력">
      <div className={styles.panelHeading}><h3>회차 연결 이력</h3><span>최신 순, 삭제하지 않음</span></div>
      {items.length === 0 ? <EmptyState title="회차 연결 이력이 없습니다" description="이 제보에 회차를 연결한 기록이 없습니다." />
        : <ol className={styles.attempts}>{items.map((item) => <li key={item.linkId}>
          <article className={styles.attempt} aria-label={`회차 연결 ${item.linkRevision}`}>
            <div className={styles.attemptHeading}><strong className={styles.plainText}>{item.performanceRef}</strong><StatusPill label={linkStatusLabels[item.status]} tone={item.status === 'ACTIVE' ? 'info' : 'neutral'} /></div>
            <dl className={styles.factList}>
              <div><dt>연결 revision</dt><dd>{item.linkRevision}</dd></div>
              <div><dt>회차 revision</dt><dd>{item.performanceRevision}</dd></div>
              <div><dt>연결 시각</dt><dd><time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time></dd></div>
              <div><dt>종료 시각</dt><dd>{item.endedAt === null ? '종료되지 않음' : <time dateTime={item.endedAt}>{formatUtc(item.endedAt)}</time>}</dd></div>
            </dl>
          </article>
        </li>)}</ol>}
    </section>
  </>
}
