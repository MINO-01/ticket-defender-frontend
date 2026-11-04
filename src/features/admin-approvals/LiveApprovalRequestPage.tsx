import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { Textarea } from '../../components/common/FormControls'
import { statusLabels } from '../../components/common/statusLabels'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { caseDetailPath, caseDetailRoute, caseViewSchema } from '../admin-cases/caseApi'
import { reportVersionSchema, reportVersionStatusLabels, textError } from '../admin-cases/caseWorkflowApi'
import type { WorkflowMessage } from '../admin-cases/caseWorkflowApi'
import { MutationStatus } from '../admin-cases/MutationStatus'
import styles from '../admin-cases/Cases.module.css'
import { useCaseMutation } from '../admin-cases/useCaseMutation'
import { formatUtc } from '../admin-track2/track2Api'
import {
  approvalEntryRoute, approvalRequestPath, approvalRequestSchema, approvalStatusLabels, buildDecisionRequest, buildWithdrawRequest, decisionMessages,
  decisionOutcomeLabels, decisionOutcomes, decisionPath, decisionViewSchema, isDecided, isWithdrawn, packageMatchesRequest, parseSealedJson,
  readApprovalRequestId, readReportContent, reportVersionDetailPath, reviewPackagePath, reviewPackageSchema, withdrawMessages, withdrawPath, withdrawViewSchema,
} from './approvalApi'
import type { ApprovalRequestView, DecisionBody, DecisionOutcome, DecisionView, ReviewPackage, WithdrawBody, WithdrawView } from './approvalApi'
import { useApprovalAttempts } from './approvalAttempts'
import { useReviewReceipt } from './useReviewReceipt'

// 인증된 관리자의 승인 요청 상세다. 승인 대기 목록 API가 없어 요청 ID를 아는 경우에만 들어올 수 있다.
// 다른 고객사나 권한 없는 공연의 요청은 서버가 404로 숨긴다. 요청한 ID와 다른 응답은 표시하지 않는다.
// 철회(REVIEWER)와 독립 검토 및 결정(APPROVER)은 역할을 추정하지 않고 모두 보여 주며 서버의 403 응답 뒤에만 막는다.
// 쓰기 성공이나 확정된 거부 뒤에는 서버의 최신 요청 상태를 다시 조회한다. 승인 결정은 공식 PDF 발급이 아니며 PDF 기능은 연결하지 않는다.

export function LiveApprovalRequestPage() {
  const { approvalRequestId } = useParams()
  const requestId = readApprovalRequestId(approvalRequestId)
  if (requestId === null) {
    return <div className={styles.page}>
      <ErrorState title="승인 요청 주소가 올바르지 않습니다" description="승인 요청 ID 형식이 올바르지 않아 조회하지 않았습니다." />
      <Link className={styles.detailLink} to={approvalEntryRoute}>승인 요청 ID 입력으로 돌아가기</Link>
    </div>
  }
  // 요청이 바뀌면 새로 만들어 이전 요청의 검토 패키지와 영수증이 남지 않게 한다.
  return <ApprovalRequestDetail key={requestId} requestId={requestId} />
}

type Reentry = null | 'checking' | 'pending' | { resolved: ApprovalRequestView['status'] }

function ApprovalRequestDetail({ requestId }: { requestId: string }) {
  const attempts = useApprovalAttempts()
  const [refreshKey, setRefreshKey] = useState(0)
  const { result } = useAdminQuery(approvalRequestPath(requestId), approvalRequestSchema, refreshKey)
  const [lastView, setLastView] = useState<ApprovalRequestView | null>(null)
  const [reentry, setReentry] = useState<Reentry>(() => (attempts.has(requestId) ? 'checking' : null))
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])
  const verified = result?.kind === 'success' && result.data.approvalRequestId === requestId ? result.data : null
  if (verified !== null && verified !== lastView) {
    setLastView(verified)
    // 재진입 시 서버가 요청을 닫았으면 이전 결정 시도의 불확실성은 서버 상태로 해소된다. 승인 대기면 결과를 확정하지 않는다.
    if (reentry !== null && typeof reentry !== 'object') {
      if (verified.status === 'PENDING') setReentry('pending')
      else { attempts.unmark(requestId); setReentry({ resolved: verified.status }) }
    }
  }
  const back = <Link className={styles.backLink} to={approvalEntryRoute}>← 승인 요청 ID 입력</Link>

  const shown = verified ?? (result === null ? lastView : null)
  if (shown === null) {
    if (result === null) return <div className={styles.page}>{back}<LoadingSkeleton label="승인 요청을 불러오는 중" /></div>
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '승인 요청을 찾을 수 없거나 접근 범위 밖입니다')
    return <div className={styles.page}>{back}<ErrorState title={message.title} description={message.description} onRetry={refresh} /></div>
  }
  const request = shown
  const refreshing = verified === null
  const reviewBlocked = reentry === 'checking' || reentry === 'pending'
  return <div className={styles.page}>
    {back}
    <PageHeader eyebrow="승인 검토" title="승인 요청 상세" description="검토 담당이 고정한 증거와 보고서 개정을 독립된 승인 담당이 검토하고 승인 또는 반려를 기록합니다. 승인 결정은 부정 거래 판정이나 공식 PDF 발급이 아닙니다." />
    {refreshing && <p className={styles.caution} role="status">서버의 최신 요청 상태를 다시 불러오는 중입니다. 완료될 때까지 변경 요청을 막습니다.</p>}
    {reentry !== null && <ReentryNotice reentry={reentry} onRecheck={refresh} onAcknowledge={() => { attempts.unmark(requestId); setReentry(null) }} />}
    <RequestOverview request={request} />
    <div className={styles.detailGrid}>
      <div className={styles.mainColumn}>
        <ReviewPanel request={request} locked={refreshing} blocked={reviewBlocked} onRefresh={refresh} />
      </div>
      <aside className={styles.sideColumn} aria-label="철회와 후속 단계">
        <WithdrawPanel request={request} locked={refreshing} onRefresh={refresh} />
        <Card className={styles.panel}>
          <h2>후속 단계</h2>
          <p className={styles.caution}>공식 PDF 발급은 별도 절차이며 이번 화면에서 연결하지 않아 실행할 수 없습니다. 승인 결정 뒤에도 서버의 발급 적격성은 차단(BLOCKED)입니다.</p>
          <div className={styles.actions}><Button variant="secondary" disabled>공식 PDF 발급</Button></div>
        </Card>
      </aside>
    </div>
  </div>
}

function ReentryNotice({ reentry, onRecheck, onAcknowledge }: { reentry: Exclude<Reentry, null>; onRecheck: () => void; onAcknowledge: () => void }) {
  if (typeof reentry === 'object') {
    const decided = reentry.resolved === 'APPROVED' || reentry.resolved === 'REJECTED'
    return <div className={styles.success} role="status">
      <strong>{decided ? `서버에 결정 상태가 기록되어 있습니다: ${approvalStatusLabels[reentry.resolved]}` : `요청이 더 이상 승인 대기 상태가 아닙니다: ${approvalStatusLabels[reentry.resolved]}`}</strong>
      <p>이전 결정 요청의 응답은 확인하지 못했습니다. 아래 요청 개요의 서버 상태를 기준으로 확인해 주세요.</p>
    </div>
  }
  return <div className={styles.uncertain} role="alert" aria-label="이전 결정 결과 미확인">
    <strong>결과 미확인: 이 요청에 보낸 결정의 결과를 확인하지 못한 채 화면을 떠났습니다</strong>
    <p>영수증과 결정 본문은 화면을 떠날 때 폐기해 같은 요청을 다시 보낼 수 없습니다. 서버의 요청 상태로만 결과를 확인합니다.</p>
    {reentry === 'checking'
      ? <p>서버 상태를 확인하는 중입니다.</p>
      : <>
        <p>서버 기준 아직 승인 대기(PENDING)입니다. 이전 결정이 반영되지 않았거나 아직 처리 중일 수 있어 결과를 실패나 미처리로 확정하지 않습니다.</p>
        <div className={styles.formActions}>
          <Button variant="secondary" size="small" onClick={onRecheck}>서버 상태 다시 확인</Button>
          <Button size="small" onClick={onAcknowledge}>서버 상태를 확인했고 새 검토를 진행합니다</Button>
        </div>
      </>}
  </div>
}

function RequestOverview({ request }: { request: ApprovalRequestView }) {
  return <Card className={styles.overview} aria-label="승인 요청 개요">
    <div className={styles.panelHeading}><h2>승인 요청 개요</h2><strong>{approvalStatusLabels[request.status]}</strong></div>
    <dl className={styles.overviewGrid}>
      <div><dt>승인 요청 ID</dt><dd className={styles.idCell}>{request.approvalRequestId}</dd></div>
      <div><dt>Case ID</dt><dd className={styles.idCell}>{request.caseId}</dd></div>
      <div><dt>공연 ID</dt><dd className={styles.idCell}>{request.eventId}</dd></div>
      <div><dt>요청자 멤버십 ID</dt><dd className={styles.idCell}>{request.requestedBy}</dd></div>
      <div><dt>요청 시각</dt><dd><time dateTime={request.requestedAt}>{formatUtc(request.requestedAt)}</time></dd></div>
      <div><dt>요청 버전</dt><dd>{request.version}</dd></div>
      <div><dt>요청 시점 Case 버전</dt><dd>{request.caseVersionAtSubmit}</dd></div>
      <div><dt>승인 적격성 (서버 값)</dt><dd>차단 (BLOCKED)</dd></div>
    </dl>
    <h3>고정된 근거</h3>
    <dl className={styles.definition}>
      <div><dt>EvidenceSnapshot ID</dt><dd className={styles.idCell}>{request.evidenceSnapshotId}</dd></div>
      <div><dt>증거 개정 번호</dt><dd>{request.evidenceRevision}</dd></div>
      <div><dt>manifest SHA-256</dt><dd className={styles.idCell}>{request.manifestSha256}</dd></div>
      <div><dt>보고서 버전 ID</dt><dd className={styles.idCell}>{request.reportVersionId}</dd></div>
      <div><dt>보고서 개정</dt><dd>{request.reportRevision}</dd></div>
      <div><dt>보고서 본문 SHA-256</dt><dd className={styles.idCell}>{request.reportContentSha256}</dd></div>
      <div><dt>템플릿</dt><dd>{request.reportTemplateVersion}</dd></div>
      <div><dt>템플릿 SHA-256</dt><dd className={styles.idCell}>{request.reportTemplateSha256}</dd></div>
    </dl>
    <p className={styles.linkReason}><strong>요청 사유</strong><span className={styles.plainText}>{request.reason}</span></p>
    {request.status === 'INVALIDATED' && <p className={styles.blocked} role="note">서버가 영수증 발급이나 결정 시점의 재검증에서 근거 또는 요청자 권한 변경을 확인해 이 요청을 무효화했습니다. 서버는 근거 변경을 실시간으로 감지하지 않습니다. 새 승인 요청은 Case를 다시 검토한 뒤 만들어야 합니다.</p>}
    <p className={styles.caution}>승인 적격성은 서버가 돌려준 값이며 화면에서 계산하지 않습니다. 멤버십 ID를 이름으로 바꾸는 API가 없어 ID로만 표시합니다.</p>
    <Link className={styles.detailLink} to={caseDetailRoute(request.caseId, request.eventId)}>Case 상세 보기</Link>
  </Card>
}

// ---------- 철회 ----------

type Prepared = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'failed'; message: WorkflowMessage; forbidden: boolean }

function WithdrawPanel({ request, locked, onRefresh }: { request: ApprovalRequestView; locked: boolean; onRefresh: () => void }) {
  const client = useAdminApiClient()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<Prepared>({ kind: 'idle' })
  const [denied, setDenied] = useState(false)
  const mutation = useCaseMutation<WithdrawBody, WithdrawView>({ method: 'POST', schema: withdrawViewSchema, successStatus: 200, messages: withdrawMessages })
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => controllerRef.current?.abort(), [])
  const sending = mutation.attempt?.kind === 'sending'
  const uncertain = mutation.attempt?.kind === 'uncertain'
  const pending = request.status === 'PENDING'
  const verify = (data: WithdrawView) => isWithdrawn(data, request.approvalRequestId)

  const settle = (next: Awaited<ReturnType<typeof mutation.submit>>) => {
    if (!next || next.kind === 'uncertain') return
    if (next.kind === 'rejected' && next.forbidden) setDenied(true)
    if (next.kind === 'succeeded') setReason('')
    onRefresh()
  }

  // 철회 직전에 Case와 보고서를 서버에서 다시 읽어 expected 버전을 만든다. 재확인은 처음 만든 본문을 그대로 보낸다.
  const onWithdraw = async () => {
    const reasonError = textError(reason, 3, 1800)
    if (reasonError) { setError(reasonError); return }
    setError(null)
    mutation.clear()
    const controller = new AbortController()
    controllerRef.current = controller
    setPrepared({ kind: 'preparing' })
    const fail = (result: { kind: string }, notFoundTitle: string) => {
      if (controller.signal.aborted) return
      const forbidden = result.kind === 'forbidden'
      if (forbidden) setDenied(true)
      const message = forbidden ? withdrawMessages.forbidden : describeAdminApiFailure(result as Parameters<typeof describeAdminApiFailure>[0], notFoundTitle)
      setPrepared({ kind: 'failed', forbidden, message })
    }
    const caseResult = await client.request(caseDetailPath(request.caseId), { schema: caseViewSchema, signal: controller.signal })
    if (caseResult.kind !== 'success') { fail(caseResult, 'Case를 찾을 수 없거나 접근 범위 밖입니다'); return }
    const reportResult = await client.request(reportVersionDetailPath(request.reportVersionId), { schema: reportVersionSchema, signal: controller.signal })
    if (reportResult.kind !== 'success') { fail(reportResult, '보고서를 찾을 수 없거나 접근 범위 밖입니다'); return }
    if (controller.signal.aborted) return
    const built = buildWithdrawRequest(request, caseResult.data, reportResult.data, reason)
    if (!built.ok) { setPrepared({ kind: 'failed', forbidden: false, message: { title: '철회 요청을 만들 수 없습니다', description: Object.values(built.errors).join(' ') } }); return }
    setPrepared({ kind: 'idle' })
    settle(await mutation.submit(withdrawPath(request.approvalRequestId), built.body, verify))
  }

  const busy = sending || prepared.kind === 'preparing'
  const disabled = locked || busy || denied
  return <Card className={styles.panel} aria-label="승인 요청 철회">
    <div className={styles.panelHeading}><h2>승인 요청 철회</h2><span>검토 담당(REVIEWER)</span></div>
    <p className={styles.caution}>철회는 결정되지 않은 승인 대기 요청을 닫고 Case와 보고서를 검토 중 상태로 되돌립니다. 승인이나 반려 결정이 아닙니다.</p>
    {denied && <p className={styles.blocked} role="note">현재 계정은 검토 담당(REVIEWER) 역할이 없어 서버가 거부했습니다. 철회 동작을 막았습니다.</p>}
    {!pending && !uncertain && <p className={styles.caution}>요청이 승인 대기 상태가 아니어서 철회할 수 없습니다.</p>}
    {(pending || uncertain) && <div className={styles.form}>
      <Textarea label="철회 사유" required rows={2} maxLength={1800} value={reason} disabled={disabled || uncertain} onChange={(change) => setReason(change.target.value)} error={error ?? undefined} />
      <div className={styles.formActions}>
        {uncertain
          ? <Button onClick={() => { void mutation.reconfirm(withdrawPath(request.approvalRequestId), verify).then(settle) }} loading={sending} disabled={locked}>철회 재확인</Button>
          : <Button variant="danger" onClick={() => { void onWithdraw() }} loading={busy} disabled={disabled}>{busy ? '철회 요청 중' : '승인 요청 철회'}</Button>}
      </div>
    </div>}
    {prepared.kind === 'failed' && <div className={styles.failure} role="alert"><strong>요청 거부: {prepared.message.title}</strong><p>{prepared.message.description}</p></div>}
    <MutationStatus attempt={mutation.attempt} successText="승인 요청을 철회했습니다. Case와 보고서는 검토 중 상태로 돌아갔습니다." />
  </Card>
}

// ---------- 독립 검토와 결정 ----------

function ReviewPanel({ request, locked, blocked, onRefresh }: { request: ApprovalRequestView; locked: boolean; blocked: boolean; onRefresh: () => void }) {
  const attempts = useApprovalAttempts()
  const requestId = request.approvalRequestId
  const [packageRequested, setPackageRequested] = useState(false)
  const pkgQuery = useAdminQuery(packageRequested ? reviewPackagePath(requestId) : null, reviewPackageSchema)
  const [confirmed, setConfirmed] = useState(false)
  const [outcome, setOutcome] = useState<DecisionOutcome | ''>('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [decided, setDecided] = useState<DecisionView | null>(null)
  const receipt = useReviewReceipt(requestId)
  const decision = useCaseMutation<DecisionBody, DecisionView>({ method: 'POST', schema: decisionViewSchema, successStatus: 201, messages: decisionMessages })
  const decisionBusy = decision.attempt?.kind === 'sending' || decision.attempt?.kind === 'uncertain'

  // 결정 결과를 확인하지 못한 채 화면이 사라지면 요청 ID만 기록해 재진입 화면이 서버 상태를 확인하게 한다. 원문과 본문은 함께 폐기된다.
  const busyRef = useRef(false)
  useEffect(() => { busyRef.current = decisionBusy }, [decisionBusy])
  useEffect(() => () => { if (busyRef.current) attempts.mark(requestId) }, [attempts, requestId])

  const pkg = pkgQuery.result?.kind === 'success' ? pkgQuery.result.data : null
  const content = pkg === null ? null : readReportContent(pkg)
  const manifest = pkg === null ? null : parseSealedJson(pkg.manifestJson)
  const trusted = pkg !== null && packageMatchesRequest(request, pkg) && content?.ok === true && manifest?.ok === true

  const settle = (next: Awaited<ReturnType<typeof decision.submit>>) => {
    if (!next || next.kind === 'uncertain') return
    // 결정이 확정되었거나 서버가 확정적으로 거부했다. 영수증은 소비되었거나 더 쓸 수 없으므로 폐기한다.
    receipt.discard()
    if (next.kind === 'succeeded') { setDecided(next.data); setReason(''); setOutcome('') }
    onRefresh()
  }

  const onIssue = async () => {
    const next = await receipt.issue()
    if (next?.kind === 'failed') onRefresh()
  }

  const onDecide = () => {
    if (pkg === null) return
    const built = buildDecisionRequest(request, pkg, { outcome, reason, reviewConfirmed: confirmed }, receipt.token())
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const body = built.body
    void decision.submit(decisionPath(requestId), body, (data) => isDecided(data, requestId, body)).then(settle)
  }

  const onReconfirm = () => {
    void decision.reconfirm(decisionPath(requestId), (data) => data.approvalRequestId === requestId).then(settle)
  }

  const pending = request.status === 'PENDING'
  let body
  if (blocked) body = <p className={styles.blocked} role="note">이전 결정 요청의 결과를 서버 상태로 확인할 때까지 새 검토와 영수증 발급을 막습니다.</p>
  else if (!pending && !decisionBusy) body = <p className={styles.caution}>요청이 승인 대기 상태가 아니어서 검토할 수 없습니다.</p>
  else if (!packageRequested) body = <div className={styles.formActions}><Button variant="secondary" onClick={() => setPackageRequested(true)} disabled={locked}>검토 패키지 조회</Button></div>
  else if (pkgQuery.result === null) body = <LoadingSkeleton label="검토 패키지를 불러오는 중" />
  else if (pkgQuery.result.kind !== 'success') {
    const message = describeAdminApiFailure(pkgQuery.result, '승인 요청을 찾을 수 없거나 접근 범위 밖입니다')
    body = <ErrorState title={message.title} description={message.description} onRetry={pkgQuery.retry} />
  } else if (!trusted || pkg === null || content?.ok !== true || manifest?.ok !== true) {
    body = <ErrorState title="검토 패키지를 신뢰할 수 없습니다" description="검토 패키지가 요청에 고정된 근거와 다르거나 봉인된 JSON을 해석하지 못했습니다. 다른 근거를 검토하게 될 수 있어 영수증 발급과 결정을 막았습니다." onRetry={pkgQuery.retry} />
  } else {
    body = <>
      <PackageFacts pkg={pkg} />
      <section className={styles.created} aria-label="봉인된 보고서 본문">
        <h3>봉인된 보고서 본문</h3>
        <dl className={styles.definition}>
          <div><dt>제목</dt><dd className={styles.plainText}>{content.content.title}</dd></div>
          <div><dt>평가</dt><dd className={styles.plainText}>{content.content.assessment}</dd></div>
          <div><dt>한계</dt><dd className={styles.plainText}>{content.content.limitations}</dd></div>
          <div><dt>결론</dt><dd className={styles.plainText}>{content.content.conclusion}</dd></div>
        </dl>
      </section>
      <section className={styles.created} aria-label="증거 manifest">
        <h3>증거 manifest</h3>
        <p className={styles.caution}>서버가 봉인한 출처 메타데이터입니다. 원본 객체 키나 이미지 바이트는 포함되지 않으며 화면은 값을 텍스트로만 표시합니다.</p>
        <JsonView value={manifest.value} depth={0} />
      </section>
      <DecisionArea
        locked={locked} confirmed={confirmed} setConfirmed={setConfirmed} receiptState={receipt.state} onIssue={() => { void onIssue() }}
        decisionBusy={decisionBusy} decision={decision.attempt} outcome={outcome} setOutcome={setOutcome} reason={reason} setReason={setReason}
        errors={errors} onDecide={onDecide} onReconfirm={onReconfirm}
      />
    </>
  }

  return <Card className={styles.panel} aria-label="독립 검토와 결정">
    <div className={styles.panelHeading}><h2>독립 검토와 결정</h2><span>승인 담당(APPROVER)</span></div>
    <p className={styles.caution}>검토 패키지 조회는 상태를 바꾸지 않습니다. 검토를 마쳤다고 확인한 뒤에만 일회용 영수증을 발급받고, 영수증으로 승인 또는 반려를 한 번 기록합니다. 요청자와 같은 사용자는 결정할 수 없으며 서버가 확인합니다. 근거 변경은 영수증 발급과 결정 시점에 서버가 다시 확인합니다(실시간 감지 아님).</p>
    {body}
    {decided && <DecisionResult view={decided} />}
  </Card>
}

function PackageFacts({ pkg }: { pkg: ReviewPackage }) {
  return <dl className={styles.definition} aria-label="검토 패키지 버전">
    <div><dt>Case 버전 (검토 시점)</dt><dd>{pkg.caseVersion}</dd></div>
    <div><dt>보고서 버전 (낙관적 잠금)</dt><dd>{pkg.reportVersion}</dd></div>
    <div><dt>템플릿</dt><dd>{pkg.reportTemplateVersion}</dd></div>
    <div><dt>발급 적격성 (서버 값)</dt><dd>차단 (BLOCKED), 공식 PDF 발급 불가</dd></div>
  </dl>
}

const maxJsonDepth = 8

/** 파싱한 JSON을 텍스트 노드로만 그린다. 문자열은 HTML로 해석하지 않는다. */
function JsonView({ value, depth }: { value: unknown; depth: number }) {
  if (depth > maxJsonDepth) return <span className={styles.caution}>(표시 깊이 제한으로 생략)</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>(빈 목록)</span>
    return <ol className={styles.recordList}>{value.map((item, index) => <li key={index}><JsonView value={item} depth={depth + 1} /></li>)}</ol>
  }
  if (typeof value === 'object' && value !== null) {
    return <dl className={styles.definition}>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key}</dt><dd className={styles.plainText}><JsonView value={item} depth={depth + 1} /></dd></div>)}</dl>
  }
  return <span className={styles.plainText}>{value === null ? 'null' : String(value)}</span>
}

type DecisionAreaProps = {
  locked: boolean
  confirmed: boolean
  setConfirmed: (value: boolean) => void
  receiptState: ReturnType<typeof useReviewReceipt>['state']
  onIssue: () => void
  decisionBusy: boolean
  decision: ReturnType<typeof useCaseMutation<DecisionBody, DecisionView>>['attempt']
  outcome: DecisionOutcome | ''
  setOutcome: (value: DecisionOutcome) => void
  reason: string
  setReason: (value: string) => void
  errors: Record<string, string>
  onDecide: () => void
  onReconfirm: () => void
}

function DecisionArea(props: DecisionAreaProps) {
  const { locked, confirmed, setConfirmed, receiptState, onIssue, decisionBusy, decision, outcome, setOutcome, reason, setReason, errors, onDecide, onReconfirm } = props
  const sending = decision?.kind === 'sending'
  const issuing = receiptState.kind === 'issuing'
  return <div className={styles.form}>
    <h3>검토 확인과 결정</h3>
    <label className={styles.checkList}>
      <input type="checkbox" checked={confirmed} disabled={locked || decisionBusy} onChange={(change) => setConfirmed(change.target.checked)} />
      봉인된 보고서 본문과 증거 manifest를 검토했습니다
    </label>
    {errors.reviewConfirmed && <p className={styles.fieldError}>{errors.reviewConfirmed}</p>}
    {decisionBusy
      ? <p className={styles.caution}>결정 결과를 확인하는 동안에는 새 영수증 발급과 새 결정을 막습니다. 보낸 결정은 같은 요청 키와 같은 본문으로만 재확인합니다.</p>
      : <ReceiptStatus state={receiptState} confirmed={confirmed} locked={locked} issuing={issuing} onIssue={onIssue} />}
    {(receiptState.kind === 'issued' || decisionBusy) && <>
      {!decisionBusy && <>
        <fieldset className={styles.plainFieldset}>
          <legend>결정</legend>
          {decisionOutcomes.map((value) => <label key={value} className={styles.checkList}>
            <input type="radio" name="approval-outcome" value={value} checked={outcome === value} disabled={locked} onChange={() => setOutcome(value)} />
            {decisionOutcomeLabels[value]}
          </label>)}
        </fieldset>
        {errors.outcome && <p className={styles.fieldError}>{errors.outcome}</p>}
        <Textarea label="결정 사유" required rows={3} maxLength={1800} value={reason} disabled={locked} onChange={(change) => setReason(change.target.value)} error={errors.reason} />
        {(errors.receipt || errors.basis) && <p className={styles.fieldError}>{errors.receipt ?? errors.basis}</p>}
      </>}
      <div className={styles.formActions}>
        {decision?.kind === 'uncertain'
          ? <Button onClick={onReconfirm} disabled={locked}>결정 재확인</Button>
          : <Button onClick={onDecide} loading={sending} disabled={locked || sending}>{sending ? '결정 요청 중' : '결정 제출'}</Button>}
      </div>
    </>}
    <MutationStatus attempt={decision} successText={null} />
  </div>
}

function ReceiptStatus({ state, confirmed, locked, issuing, onIssue }: { state: ReturnType<typeof useReviewReceipt>['state']; confirmed: boolean; locked: boolean; issuing: boolean; onIssue: () => void }) {
  if (state.kind === 'issued') {
    return <dl className={styles.definition} aria-label="검토 확인 영수증">
      <div><dt>영수증 상태</dt><dd>영수증 발급됨 (일회용, 화면 메모리에만 보관)</dd></div>
      <div><dt>영수증 ID</dt><dd className={styles.idCell}>{state.receiptId}</dd></div>
      <div><dt>서버 만료 시각</dt><dd><time dateTime={state.expiresAt}>{formatUtc(state.expiresAt)}</time></dd></div>
    </dl>
  }
  const reissue = state.kind === 'expired' || state.kind === 'uncertain'
  const label = issuing ? '영수증 발급 요청 중' : reissue ? '새 영수증 발급' : '검토 확인 영수증 발급'
  return <>
    {state.kind === 'expired' && <div className={styles.failure} role="alert"><strong>검토 확인 영수증이 만료되어 폐기했습니다</strong><p>결정을 보내지 않았습니다. 새 영수증을 발급받아 결정해 주세요.</p></div>}
    {state.kind === 'uncertain' && <div className={styles.uncertain} role="alert"><strong>결과 미확인: {state.message.title}</strong><p>{state.message.description}</p></div>}
    {state.kind === 'failed' && <div className={styles.failure} role="alert"><strong>요청 거부: {state.message.title}</strong><p>{state.message.description}</p></div>}
    {!(state.kind === 'failed' && state.forbidden) && <div className={styles.formActions}>
      <Button variant={reissue ? 'secondary' : 'primary'} onClick={onIssue} loading={issuing} disabled={locked || issuing || !confirmed}>{label}</Button>
    </div>}
  </>
}

function DecisionResult({ view }: { view: DecisionView }) {
  const requestLabel = view.requestStatus === 'APPROVED' ? approvalStatusLabels.APPROVED : approvalStatusLabels.REJECTED
  return <section className={styles.created} aria-label="결정 결과">
    <h3>결정 결과</h3>
    <dl className={styles.definition}>
      <div><dt>결정</dt><dd>{decisionOutcomeLabels[view.outcome]}</dd></div>
      <div><dt>요청 상태</dt><dd>{requestLabel}</dd></div>
      <div><dt>Case 상태</dt><dd>{statusLabels.case[view.caseStatus].label}</dd></div>
      <div><dt>보고서 상태</dt><dd>{reportVersionStatusLabels[view.reportStatus]}</dd></div>
      <div><dt>결정 시각</dt><dd><time dateTime={view.decidedAt}>{formatUtc(view.decidedAt)}</time></dd></div>
      <div><dt>결정 ID</dt><dd className={styles.idCell}>{view.approvalDecisionId}</dd></div>
      <div><dt>사용한 영수증 ID</dt><dd className={styles.idCell}>{view.reviewReceiptId}</dd></div>
      <div><dt>발급 적격성 (서버 값)</dt><dd>차단 (BLOCKED)</dd></div>
    </dl>
    <p className={styles.caution}>승인 결정은 사람이 검토 근거를 확인한 기록이며 공식 PDF 발급이 아닙니다. 공식 PDF 발급은 별도 절차에서 서버가 다시 검증해야 하며 현재 비활성입니다.</p>
  </section>
}
