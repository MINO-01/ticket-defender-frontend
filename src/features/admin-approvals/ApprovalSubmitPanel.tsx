import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Textarea } from '../../components/common/FormControls'
import type { CaseView } from '../admin-cases/caseApi'
import type { DraftListState, WorkflowOutcome } from '../admin-cases/CaseWorkflowPanels'
import { MutationStatus } from '../admin-cases/MutationStatus'
import styles from '../admin-cases/Cases.module.css'
import { useCaseMutation } from '../admin-cases/useCaseMutation'
import { formatUtc } from '../admin-track2/track2Api'
import {
  approvalEntryRoute, approvalRequestRoute, approvalRequestSchema, approvalSubmitPath, buildApprovalSubmitRequest, isSubmittedRequest, latestDraftFor,
  submitApprovalMessages,
} from './approvalApi'
import type { ApprovalRequestView, ApprovalSubmitBody } from './approvalApi'

// Case 상세에서 검토 담당(REVIEWER)이 최신 보고서 초안과 그 EvidenceSnapshot을 승인 요청으로 고정한다.
// 보고서 목록은 초안 영역의 조회 결과를 함께 쓰며, 첫 페이지의 가장 높은 개정이 현재 증거 개정 번호의 DRAFT일 때만 요청할 수 있다. 최종 판단은 서버가 한다.
// 성공하면 요청 상세로 이동한다. Case 화면에서 승인 요청 ID를 다시 찾는 API는 없으므로 이동한 주소가 요청에 다시 들어가는 방법이다.

type Props = { view: CaseView; locked: boolean; drafts: DraftListState; onOutcome: (outcome: WorkflowOutcome) => void; onRefresh: () => void }

export function ApprovalSubmitPanel({ view, locked, drafts, onOutcome, onRefresh }: Props) {
  const navigate = useNavigate()
  const inReview = view.status === 'IN_REVIEW'
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const mutation = useCaseMutation<ApprovalSubmitBody, ApprovalRequestView>({ method: 'POST', schema: approvalRequestSchema, successStatus: 201, messages: submitApprovalMessages })
  const sending = mutation.attempt?.kind === 'sending'
  const uncertain = mutation.attempt?.kind === 'uncertain'
  const items = drafts.page === 0 ? drafts.items : null
  const candidate = items === null ? null : latestDraftFor(view, items)
  const path = approvalSubmitPath(view.caseId)

  const settle = (next: Awaited<ReturnType<typeof mutation.submit>>) => {
    if (!next || next.kind === 'uncertain') return
    if (next.kind === 'succeeded') { navigate(approvalRequestRoute(next.data.approvalRequestId)); return }
    if (next.kind === 'conflict') onOutcome({ kind: 'conflict', message: next.message })
    else if (next.forbidden) onOutcome({ kind: 'forbidden' })
    else onRefresh()
  }

  const onSubmit = () => {
    const built = buildApprovalSubmitRequest(view, candidate, reason)
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const body = built.body
    void mutation.submit(path, body, (data) => isSubmittedRequest(data, view.caseId, body)).then(settle)
  }

  let content
  if (view.status === 'READY_FOR_APPROVAL') {
    content = <>
      <p className={styles.blocked} role="note">승인 대기 중인 Case입니다. 현재 Case 화면에서 승인 요청 ID를 알려 주는 Backend 계약이 없습니다. 요청을 만들 때 이동한 요청 상세 주소나 전달받은 승인 요청 ID로 확인해 주세요.</p>
      <Link className={styles.detailLink} to={approvalEntryRoute}>승인 요청 ID로 열기</Link>
    </>
  } else if (!inReview) {
    content = <p className={styles.caution}>Case가 검토 중 상태일 때 최신 보고서 초안으로만 승인 요청을 만들 수 있습니다.</p>
  } else if (drafts.page !== 0) {
    content = <p className={styles.caution}>최신 초안은 보고서 초안 목록의 첫 페이지에 있습니다. 초안 목록을 첫 페이지로 이동하면 승인 요청 대상을 확인할 수 있습니다.</p>
  } else if (drafts.query.result === null) {
    content = <LoadingSkeleton label="승인 요청할 보고서 초안을 확인하는 중" />
  } else if (items === null) {
    const failure = drafts.query.result.kind === 'success' ? { kind: 'invalidResponse' as const, status: drafts.query.result.status } : drafts.query.result
    const message = describeAdminApiFailure(failure, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={drafts.query.retry} />
  } else {
    const disabled = locked || sending || uncertain
    content = <>
      {candidate === null
        ? <p className={styles.blocked} role="note">현재 증거 개정 번호 {view.evidenceRevision}의 최신 초안(DRAFT)이 없습니다. 초안을 먼저 저장해 주세요.</p>
        : <dl className={styles.definition} aria-label="승인 요청 대상">
          <div><dt>보고서 버전 ID</dt><dd className={styles.idCell}>{candidate.reportVersionId}</dd></div>
          <div><dt>보고서 개정</dt><dd>{candidate.revision}, <time dateTime={candidate.createdAt}>{formatUtc(candidate.createdAt)}</time></dd></div>
          <div><dt>EvidenceSnapshot ID</dt><dd className={styles.idCell}>{candidate.evidenceSnapshotId}</dd></div>
          <div><dt>보고서 본문 SHA-256</dt><dd className={styles.idCell}>{candidate.contentSha256}</dd></div>
          <div><dt>템플릿</dt><dd>{candidate.templateVersion}</dd></div>
          <div><dt>Case 버전, 보고서 버전</dt><dd>{view.caseVersion}, {candidate.version}</dd></div>
        </dl>}
      {errors.report && <p className={styles.fieldError}>{errors.report}</p>}
      <div className={styles.form}>
        <Textarea label="승인 요청 사유" required rows={2} maxLength={1800} value={reason} disabled={disabled || candidate === null} onChange={(change) => setReason(change.target.value)} error={errors.reason} />
        <div className={styles.formActions}>
          {uncertain
            ? <Button onClick={() => { void mutation.reconfirm(path, (data) => data.caseId === view.caseId).then(settle) }} loading={sending} disabled={locked}>승인 요청 재확인</Button>
            : <Button onClick={onSubmit} loading={sending} disabled={locked || sending || candidate === null}>{sending ? '승인 요청 중' : '승인 요청 제출'}</Button>}
        </div>
      </div>
    </>
  }

  return <Card className={styles.panel} aria-label="승인 요청 제출">
    <div className={styles.panelHeading}><h2>승인 요청 제출</h2><span>검토 담당(REVIEWER)</span></div>
    <p className={styles.caution}>최신 초안과 EvidenceSnapshot, 보고서 digest를 승인 요청으로 고정합니다. 승인 요청은 승인이나 공식 PDF 발급이 아니며, 승인 적격성은 서버 값만 사용합니다.</p>
    {content}
    <MutationStatus attempt={mutation.attempt?.kind === 'conflict' ? null : mutation.attempt} successText={null} />
  </Card>
}
