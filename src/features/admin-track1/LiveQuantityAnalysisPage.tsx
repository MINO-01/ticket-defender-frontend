import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Input, Select, Textarea } from '../../components/common/FormControls'
import { PageHeader } from '../../components/common/PageHeader'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { MutationStatus } from '../admin-cases/MutationStatus'
import { useCaseMutation } from '../admin-cases/useCaseMutation'
import caseStyles from '../admin-cases/Cases.module.css'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import { isSyntheticImportUiEnabled } from '../admin-imports/reservationImportApi'
import { usePerformanceList } from '../admin-track2/PerformancePanels'
import type { VerifiedPerformance } from '../admin-track2/candidatePipelineApi'
import { formatUtc } from '../admin-track2/track2Api'
import {
  analysisRunDetailPath, analysisRunListPath, analysisRunMessages, analysisRunPageSchema, analysisRunPath, analysisRunSchema, buildLedgerImport, evaluationLabels, executionLabels, failureCodeLabels, ledgerBatchPageSchema, reasonCodeLabels,
  ledgerBatchSchema, ledgerErrorLabels, ledgerImportListPath, ledgerImportMessages, ledgerImportPath, maxLedgerRows, maxLedgerTextLength,
} from './quantityAnalysisApi'
import type { LedgerBatch, LedgerFormErrors, LedgerImportBody, QuantityAnalysisRun, RunRequestBody } from './quantityAnalysisApi'
import { SharedSignalObservationPanel } from './SharedSignalObservationPanel'
import { track1ListRoute } from './track1Api'
import styles from './Track1.module.css'

// Backend track1-quantity-v1의 구매 수량 원장 반입, v2 분석 실행, 결과 조회 화면이다.
// 서버 거부는 그대로 표시하고 결과를 만들지 않는다. 자동 폴링 없이 관리자가 상태를 새로 고친다. 표시 토큰은 실행 간에 비교하지 않는다.
// 구매 한도 초과는 조사 신호이며 위반 확정이 아니다. 평가 불가와 분석 실패는 초과 없음으로 표시하지 않는다.

export function QuantityAnalysisRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview'
    ? <AdminPagePlaceholder title="구매 수량 분석" description="구매 수량 분석은 인증된 관리자 세션에서만 실제 API로 제공합니다. 미리보기에서는 결과를 만들지 않습니다." />
    : <LiveQuantityAnalysisPage />
}

export function LiveQuantityAnalysisPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="조사" title="구매 수량 분석" description="고객사가 승인한 티켓 또는 주문 라인 원장을 반입하고 관계 분석과 구매 한도 평가를 실행합니다. 결과는 조사 신호이며 위반 확정이 아닙니다." />
    <AdminEventGate>{(event) => <EventQuantity key={event.id} eventId={event.id} />}</AdminEventGate>
  </div>
}

function isUnavailable(failure: AdminApiFailure) {
  return failure.kind === 'forbidden' || failure.kind === 'notFound'
}

function EventQuantity({ eventId }: { eventId: string }) {
  const [version, setVersion] = useState(0)
  const batches = useAdminQuery(ledgerImportListPath(eventId), ledgerBatchPageSchema, version)
  const runs = useAdminQuery(analysisRunListPath(eventId), analysisRunPageSchema, version)
  const performances = usePerformanceList(eventId)
  const refresh = () => setVersion((value) => value + 1)

  if (batches.result === null) return <LoadingSkeleton label="구매 수량 원장을 불러오는 중" />
  if (batches.result.kind !== 'success') {
    if (isUnavailable(batches.result)) {
      return <Card className={styles.panel} aria-label="구매 수량 분석 사용 불가">
        <h2>이 서버에서 사용할 수 없습니다</h2>
        <p className={styles.warning} role="note">조회 역할이 없거나 이 서버에 구매 수량 API가 없습니다(BLOCKED). 결과가 0건이라는 뜻이 아닙니다.</p>
        <Button variant="secondary" size="small" onClick={batches.retry}>다시 확인</Button>
      </Card>
    }
    const message = describeAdminApiFailure(batches.result, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    return <ErrorState title={message.title} description={message.description} onRetry={batches.retry} />
  }
  const active = performances.performances?.filter((item) => item.status === 'ACTIVE') ?? []
  return <>
    {isSyntheticImportUiEnabled()
      ? <LedgerImportForm eventId={eventId} performances={active} onDone={refresh} />
      : <p className={styles.warning} role="note">수량 원장 입력은 합성 격리 환경 설정에서만 열립니다. 실제 고객사 데이터 반입 기능이 아닙니다.</p>}
    <BatchList batches={batches.result.data.items} hasNext={batches.result.data.hasNext} />
    <RunForm eventId={eventId} batches={batches.result.data.items} onDone={refresh} />
    <Card className={styles.panel} aria-label="분석 실행 결과">
      <div className={styles.sectionHeading}><h2>분석 실행 결과</h2><Button variant="secondary" size="small" onClick={refresh}>상태 새로 고침</Button></div>
      {runs.result === null
        ? <LoadingSkeleton label="분석 실행을 불러오는 중" />
        : runs.result.kind !== 'success'
          ? <RunFailure failure={runs.result} onRetry={runs.retry} />
          : runs.result.data.items.length === 0
            ? <EmptyState title="분석 실행 기록이 없습니다" description="서버가 빈 목록을 반환했습니다. 초과 없음을 뜻하지 않습니다." />
            : runs.result.data.items.map((run) => <RunResult key={run.runId} run={run} eventId={eventId} />)}
    </Card>
  </>
}

function RunFailure({ failure, onRetry }: { failure: AdminApiFailure; onRetry: () => void }) {
  const message = describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
  return <ErrorState title={message.title} description={message.description} onRetry={onRetry} />
}

function LedgerImportForm({ eventId, performances, onDone }: { eventId: string; performances: VerifiedPerformance[]; onDone: () => void }) {
  const rowsRef = useRef<HTMLTextAreaElement>(null)
  const [performanceId, setPerformanceId] = useState('')
  const [sourceVersion, setSourceVersion] = useState('')
  const [sourceAsOf, setSourceAsOf] = useState('')
  const [quantityBasis, setQuantityBasis] = useState('')
  const [completeSnapshot, setCompleteSnapshot] = useState('')
  const [errors, setErrors] = useState<LedgerFormErrors>({})
  const mutation = useCaseMutation<LedgerImportBody, LedgerBatch>({ method: 'POST', schema: ledgerBatchSchema, successStatus: 201, messages: ledgerImportMessages })
  const path = ledgerImportPath(eventId)
  const sending = mutation.attempt?.kind === 'sending'
  const uncertain = mutation.attempt?.kind === 'uncertain'
  const done = (next: { kind: string } | null) => {
    if (next === null || next.kind === 'uncertain') return
    // 서버가 결과를 확정하면 민감할 수 있는 붙여넣기 입력을 지운다.
    if (next.kind === 'succeeded' && rowsRef.current) rowsRef.current.value = ''
    onDone()
  }
  const submit = () => {
    const built = buildLedgerImport({ performanceId, sourceVersion, sourceAsOf, quantityBasis, completeSnapshot: completeSnapshot === '' ? null : completeSnapshot === 'true', rowsText: rowsRef.current?.value ?? '' })
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const body = built.body
    void mutation.submit(path, body, (data) => data.eventId === eventId && data.performanceId === body.performanceId && data.sourceVersion === body.sourceVersion && data.inputRowCount === body.rows.length).then(done)
  }
  const locked = sending || uncertain
  const attempt = mutation.attempt
  return <Card className={styles.panel} aria-label="구매 수량 원장 반입">
    <h2>구매 수량 원장 반입</h2>
    <p className={styles.muted}>개별 티켓 또는 주문 라인 입력만 받습니다(INDIVIDUAL_TICKET). 집계 스냅샷은 지원하지 않습니다. 제공되지 않은 구매시각, 수량, 상태를 채우지 말고 UNKNOWN 또는 해당 행 제외로 처리해 주세요.</p>
    <div className={caseStyles.form}>
      <Select label="검증 회차" required value={performanceId} disabled={locked} onChange={(change) => setPerformanceId(change.target.value)} error={errors.performanceId}>
        <option value="">회차를 선택해 주세요</option>
        {performances.map((item) => <option key={item.performanceId} value={item.performanceId}>{item.performanceRef}</option>)}
      </Select>
      <Input label="원장 버전 (sourceVersion)" required maxLength={128} value={sourceVersion} disabled={locked} onChange={(change) => setSourceVersion(change.target.value)} error={errors.sourceVersion} />
      <Input label="데이터 기준시각 (sourceAsOf)" required placeholder="2026-11-08T10:00:00Z" value={sourceAsOf} disabled={locked} onChange={(change) => setSourceAsOf(change.target.value)} error={errors.sourceAsOf} />
      <Input label="수량 산정 기준" required maxLength={128} value={quantityBasis} disabled={locked} onChange={(change) => setQuantityBasis(change.target.value)} error={errors.quantityBasis} />
      <Select label="완전한 스냅샷 여부" required value={completeSnapshot} disabled={locked} onChange={(change) => setCompleteSnapshot(change.target.value)} error={errors.completeSnapshot}>
        <option value="">직접 선택해 주세요</option>
        <option value="true">완전함 (true)</option>
        <option value="false">불완전함 (false, 평가 불가로 남음)</option>
      </Select>
      <Textarea ref={rowsRef} label={`티켓 또는 주문 라인 행 (1~${maxLedgerRows}개)`} rows={6} maxLength={maxLedgerTextLength} readOnly={locked} spellCheck={false} autoComplete="off" error={errors.rows} />
      <p className={styles.muted}>한 줄에 쉼표나 탭으로 11개 값을 씁니다: 계정 참조, 예매 참조, 티켓 또는 주문 라인 참조, 구매시각(시간대 포함), 수량, 수량 단위(TICKET은 1, ORDER_LINE은 1 이상), 상태(ACTIVE, CANCELLED, REFUNDED, UNKNOWN), 결제 참조, 주소 참조, 기기 참조, IP 참조. 관계 참조 4개 중 하나 이상이 필요하며 없는 값은 비워 둡니다. 합성 값만 입력해 주세요.</p>
      {errors.rowLines && <ul className={styles.warning}>{errors.rowLines.map((line) => <li key={line}>{line}</li>)}</ul>}
      <div className={caseStyles.formActions}>
        {uncertain
          ? <Button size="small" onClick={() => void mutation.reconfirm(path, (data) => data.eventId === eventId).then(done)}>반입 결과 재확인</Button>
          : <Button size="small" loading={sending} onClick={submit}>{sending ? '반입 요청 중' : '원장 반입'}</Button>}
      </div>
      <MutationStatus attempt={attempt} successText={attempt?.kind === 'succeeded' ? `${attempt.data.status === 'ACCEPTED' ? '반입 수락' : '반입 거부'}: ${attempt.data.acceptedRowCount}행 수락, ${attempt.data.rejectedRowCount}행 거부` : null} />
    </div>
  </Card>
}

function BatchList({ batches, hasNext }: { batches: LedgerBatch[]; hasNext: boolean }) {
  return <Card className={styles.panel} aria-label="원장 반입 이력">
    <h2>원장 반입 이력</h2>
    {batches.length === 0
      ? <EmptyState title="반입된 원장이 없습니다" description="서버가 빈 목록을 반환했습니다." />
      : batches.map((batch) => <div key={batch.batchId}>
        <dl className={styles.factList} aria-label={`배치 ${batch.sourceVersion}`}>
          <div><dt>원장 버전</dt><dd>{batch.sourceVersion} (원장 개정 {batch.ledgerVersion})</dd></div>
          <div><dt>상태</dt><dd>{batch.status === 'ACCEPTED' ? '수락 (ACCEPTED)' : '거부 (REJECTED)'}</dd></div>
          <div><dt>수량 산정 기준</dt><dd>{batch.quantityBasis}</dd></div>
          <div><dt>완전한 스냅샷</dt><dd>{batch.completeSnapshot ? '예' : '아니요 (평가 불가로 남음)'}</dd></div>
          <div><dt>행 수</dt><dd>입력 {batch.inputRowCount}, 수락 {batch.acceptedRowCount}, 거부 {batch.rejectedRowCount}</dd></div>
          <div><dt>데이터 기준시각</dt><dd>{formatUtc(batch.sourceAsOf)}</dd></div>
          <div><dt>처리 시각</dt><dd>{formatUtc(batch.completedAt)}</dd></div>
        </dl>
        {batch.errors.length > 0 && <ul className={styles.warning}>{batch.errors.slice(0, 20).map((error, index) => <li key={`${error.rowIndex}:${error.code}:${index}`}>{error.rowIndex === null ? '배치 전체' : `${error.rowIndex + 1}번째 행`}: {ledgerErrorLabels[error.code] ?? `알 수 없는 서버 사유 (${error.code})`}</li>)}</ul>}
      </div>)}
    {hasNext && <p className={styles.muted}>최신 항목만 표시합니다. 이전 배치가 더 있습니다.</p>}
  </Card>
}

function RunForm({ eventId, batches, onDone }: { eventId: string; batches: LedgerBatch[]; onDone: () => void }) {
  const accepted = batches.filter((batch) => batch.status === 'ACCEPTED')
  const [choice, setChoice] = useState('')
  const mutation = useCaseMutation<RunRequestBody, QuantityAnalysisRun>({ method: 'POST', schema: analysisRunSchema, successStatus: 202, messages: analysisRunMessages })
  const sending = mutation.attempt?.kind === 'sending'
  const uncertain = mutation.attempt?.kind === 'uncertain'
  const path = analysisRunPath(eventId)
  const selected = accepted.find((batch) => batch.batchId === choice) ?? accepted[0]
  const done = (next: { kind: string } | null) => { if (next !== null && next.kind !== 'uncertain') onDone() }
  const submit = () => {
    if (!selected) return
    const body = { performanceId: selected.performanceId, ledgerBatchId: selected.batchId }
    void mutation.submit(path, body, (data) => data.eventId === eventId && data.ledgerBatchId === selected.batchId).then(done)
  }
  return <Card className={styles.panel} aria-label="Louvain과 구매 한도 분석 실행">
    <h2>Louvain과 구매 한도 분석 실행</h2>
    {accepted.length === 0
      ? <p className={styles.warning} role="note">수락된 원장 배치가 없어 분석을 실행할 수 없습니다.</p>
      : <div className={caseStyles.form}>
        <Select label="원장 배치" value={selected.batchId} disabled={sending || uncertain} onChange={(change) => setChoice(change.target.value)}>
          {accepted.map((batch) => <option key={batch.batchId} value={batch.batchId}>{batch.sourceVersion}</option>)}
        </Select>
        <div className={caseStyles.formActions}>
          {uncertain
            ? <Button size="small" onClick={() => void mutation.reconfirm(path, (data) => data.eventId === eventId).then(done)}>실행 요청 재확인</Button>
            : <Button size="small" loading={sending} onClick={submit}>{sending ? '요청 중' : '분석 실행'}</Button>}
        </div>
        <MutationStatus attempt={mutation.attempt} successText="분석 실행을 요청했습니다. 아래에서 상태를 새로 고쳐 주세요." />
      </div>}
  </Card>
}

function RunResult({ run: listed, eventId }: { run: QuantityAnalysisRun; eventId: string }) {
  // 실행 하나만 서버에서 다시 조회한다. 요청한 실행과 다른 응답은 표시하지 않는다.
  const [reload, setReload] = useState(0)
  const detail = useAdminQuery(reload === 0 ? null : analysisRunDetailPath(eventId, listed.runId), analysisRunSchema, reload)
  const fresh = detail.result?.kind === 'success' && detail.result.data.runId === listed.runId ? detail.result.data : null
  const detailFailed = detail.result !== null && fresh === null
  const run = fresh ?? listed
  const evaluation = run.evaluation
  return <article className={caseStyles.source} aria-label={`분석 실행 ${run.sourceVersion}`}>
    <dl className={styles.factList}>
      <div><dt>실행 상태</dt><dd>{executionLabels[run.executionStatus]}</dd></div>
      <div><dt>원장 버전</dt><dd>{run.sourceVersion}</dd></div>
      <div><dt>적용 정책 버전</dt><dd>{run.policyVersion ?? '없음'}</dd></div>
      <div><dt>알고리즘 버전</dt><dd>{run.algorithmVersion ?? '기록 없음'}</dd></div>
      <div><dt>요청 시각</dt><dd>{formatUtc(run.requestedAt)}</dd></div>
      <div><dt>완료 시각</dt><dd>{run.completedAt === null ? '미완료' : formatUtc(run.completedAt)}</dd></div>
    </dl>
    <div><Button variant="secondary" size="small" onClick={() => setReload((value) => value + 1)}>이 실행 다시 조회</Button></div>
    {detailFailed && <p className={styles.warning} role="alert">이 실행을 다시 조회하지 못했습니다. 위 값은 목록에서 받은 값입니다.</p>}
    {run.executionStatus === 'FAILED' && <p className={styles.warning} role="alert">분석에 실패했습니다: {failureCodeLabels[run.failureCode ?? ''] ?? '알 수 없는 서버 사유'} ({run.failureCode}). {run.retryable ? '새 요청으로 재시도할 수 있습니다.' : '재시도 불가로 기록되었습니다.'} 초과 없음이나 군집 없음이 아닙니다.</p>}
    {run.executionStatus === 'RUNNING' && <p className={styles.muted}>아직 결과가 없습니다. 상태를 새로 고쳐 주세요.</p>}
    {run.nettedExcludedRowCount > 0 && <p className={styles.muted}>취소와 환불로 제외된 행 {run.nettedExcludedRowCount}개</p>}
    {run.clusterCount !== null && <p>관계 군집 {run.clusterCount}개. <Link to={track1ListRoute(eventId)}>예매 관계 분석에서 보기</Link></p>}
    {run.clusters.length > 0 && <ul aria-label="관계 군집">{run.clusters.map((cluster) => <li key={cluster.clusterId}>구성원 {cluster.memberCount}건, 조사 우선순위 {cluster.riskScore.toFixed(4)}</li>)}</ul>}
    <SharedSignalObservationPanel observations={run.sharedSignalObservations} />
    {evaluation && <>
      <p><strong>구매 한도 평가: {evaluationLabels[evaluation.status].label}</strong></p>
      <p className={styles.muted}>{evaluationLabels[evaluation.status].help}</p>
      {evaluation.reasonCode !== null && <p className={styles.muted}>사유: {reasonCodeLabels[evaluation.reasonCode] ?? `알 수 없는 서버 사유 (${evaluation.reasonCode})`}</p>}
      {evaluation.status === 'EVALUATED' && (evaluation.findings.length === 0
        ? <p className={styles.muted}>이 정책 기준의 계정별 한도 초과 신호가 없습니다.</p>
        : <ul aria-label="계정별 한도 초과 조사 신호">{evaluation.findings.map((finding) => <li key={finding.accountToken}>
          계정 {finding.accountToken.slice(0, 12)}: 유효 {finding.effectiveTicketQuantity}매, 한도 {finding.maxTicketsPerAccount}매, 정책 {finding.policyVersion}
          <ul>{finding.reservationQuantities.map((item) => <li key={item.reservationToken}>예매 {item.reservationToken.slice(0, 12)}: {item.effectiveTicketQuantity}매</li>)}</ul>
        </li>)}</ul>)}
      {evaluation.findings.length > 0 && <p className={styles.warning} role="note">한도 초과는 조사 신호입니다. 위반 확정이나 자동 제재 근거가 아닙니다. 계정과 예매 표시는 이 실행에서만 유효하며 다른 실행의 같은 사람을 뜻하지 않습니다.</p>}
    </>}
  </article>
}
