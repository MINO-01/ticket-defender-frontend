import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { terms } from '../../app/terms'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { approvalRequestRoute, approvalStatusLabels, decisionOutcomeLabels } from '../admin-approvals/approvalApi'
import type { ApprovalRequestView } from '../admin-approvals/approvalApi'
import { issuanceStatusLabels, officialPdfDecisionRoute } from '../admin-reports/officialPdfApi'
import { formatUtc } from '../admin-track2/track2Api'
import { approvalAuditPath, approvalAuditPageSchema, approvalAuditTypeLabels, caseWorkflowPath, caseWorkflowSchema, nextStepTitles } from './caseLinkApi'
import type { ApprovalAuditItem, CaseWorkflow } from './caseLinkApi'
import { reportVersionStatusLabels } from './caseWorkflowApi'
import styles from './Cases.module.css'

// 조사 사건의 업무 연결(workflow)과 승인 감사 이력 영역이다. 서버가 돌려준 저장 기록 참조만 보여 주고 없는 기록은 "없음"으로 둔다.
// nextStep은 안내 문구이며 버튼 활성화나 PDF 발급 가능 여부 판단에 쓰지 않는다. 발급 가능 여부는 공식 PDF 화면의 서버 적격성으로만 확인한다.

/** 조사 사건의 보고서 초안, 승인 요청, 승인 결정, 공식 PDF 기록 연결이다. refreshKey가 바뀌면 다시 조회한다. */
export function CaseWorkflowPanel({ caseId, refreshKey }: { caseId: string; refreshKey: number }) {
  const { result, retry } = useAdminQuery(caseWorkflowPath(caseId), caseWorkflowSchema, refreshKey)
  const heading = <div className={styles.panelHeading}><h2>업무 연결</h2><span>서버 저장 기록 기준</span></div>
  let content: ReactNode
  if (result === null) content = <LoadingSkeleton label="업무 연결을 불러오는 중" />
  else if (result.kind !== 'success' || result.data.investigation.caseId !== caseId) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else {
    content = <WorkflowContent workflow={result.data} />
  }
  return <Card className={styles.panel} aria-label="업무 연결">{heading}{content}</Card>
}

function WorkflowContent({ workflow }: { workflow: CaseWorkflow }) {
  const { nextStep, report, approval, officialPdf } = workflow
  return <>
    <section className={styles.created} aria-label="서버가 안내한 다음 단계">
      <h3>다음 단계: {nextStepTitles[nextStep.code] ?? nextStep.code}</h3>
      <p className={styles.plainText}>{nextStep.description}</p>
      <p className={styles.caution}>서버의 업무 단계 안내입니다. 실제 실행 권한과 공식 PDF 발급 가능 여부는 각 요청 시점에 서버가 따로 확인합니다.</p>
    </section>
    <dl className={styles.definition}>
      <div><dt>{terms.reportVersion}</dt><dd>{report === null ? '저장된 초안 없음' : `${reportVersionStatusLabels[report.status]}, 개정 ${report.revision}, 증거 개정 번호 ${report.evidenceRevision}`}</dd></div>
      <div><dt>{terms.approvalRequest}</dt><dd>{approval === null ? '승인 요청 없음' : <>{approvalStatusLabels[approval.requestStatus as ApprovalRequestView['status']]} <Link className={styles.detailLink} to={approvalRequestRoute(approval.approvalRequestId)}>승인 요청 열기</Link></>}</dd></div>
      <div><dt>승인 결정</dt><dd>{approval?.approvalDecisionId == null || approval.decisionOutcome === null || approval.decidedAt === null
        ? '결정 기록 없음'
        : <>{decisionOutcomeLabels[approval.decisionOutcome]}, {formatUtc(approval.decidedAt)}{approval.decisionOutcome === 'APPROVE' && <> <Link className={styles.detailLink} to={officialPdfDecisionRoute(approval.approvalDecisionId)}>공식 PDF 발급 화면 열기</Link></>}</>}</dd></div>
      <div><dt>{terms.officialPdf}</dt><dd>{officialPdf === null ? '발급 기록 없음' : `${issuanceStatusLabels[officialPdf.status]}${officialPdf.lastFailureCode === null ? '' : `, 마지막 실패 코드 ${officialPdf.lastFailureCode}`}`}</dd></div>
    </dl>
    {approval?.decisionOutcome === 'APPROVE' && <p className={styles.caution}>승인 결정만으로 발급되지 않습니다. 발급 화면에서 서버가 현재 근거와 운영 게이트를 다시 확인합니다.</p>}
  </>
}

/** 조사 사건의 승인 감사 이력이다. 조사 사건 활동 기록과 별개로 보여 주며 둘을 합친 전역 감사 기록으로 표현하지 않는다. */
export function ApprovalAuditPanel({ caseId }: { caseId: string }) {
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(approvalAuditPath(caseId, page), approvalAuditPageSchema)
  const heading = <div className={styles.panelHeading}><h2>승인 감사 이력</h2><span>오래된 순 (서버 정렬)</span></div>
  let content: ReactNode
  if (result === null) content = <LoadingSkeleton label="승인 감사 이력을 불러오는 중" />
  else if (result.kind !== 'success' || result.data.page !== page) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else if (result.data.items.length === 0) {
    content = page === 0
      ? <EmptyState title="승인 감사 이력이 없습니다" description="이 조사 사건에 승인 요청이나 결정 기록이 없습니다. 조회 장애가 아닙니다." />
      : <><EmptyState title="이 페이지에 표시할 이력이 없습니다" description="요청한 페이지가 이력 범위를 벗어났습니다." /><Button variant="secondary" size="small" onClick={() => setPage(0)}>첫 페이지로 이동</Button></>
  } else {
    content = <ol className={styles.timeline}>{result.data.items.map((item) => <li key={item.approvalAuditEventId}><ApprovalAuditEntry item={item} /></li>)}</ol>
  }
  const hasNext = result?.kind === 'success' && result.data.page === page && result.data.hasNext
  return <Card className={styles.panel} aria-label="승인 감사 이력">
    {heading}
    <p className={styles.caution}>승인 요청, 독립 검토 시작, 결정, 철회와 무효화 기록입니다. 위의 조사 사건 활동 기록과 별도로 저장되며, 둘을 합친 전체 감사 기록이 아닙니다.</p>
    {content}
    {(page > 0 || hasNext) && <nav className={styles.pagination} aria-label="승인 감사 이력 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 이력</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!hasNext} onClick={() => setPage(page + 1)}>다음 이력</Button></nav>}
  </Card>
}

function statusText(value: string | null) {
  if (value === null) return '없음'
  return approvalStatusLabels[value as ApprovalRequestView['status']] ?? value
}

function ApprovalAuditEntry({ item }: { item: ApprovalAuditItem }) {
  return <>
    <time dateTime={item.occurredAt}>{formatUtc(item.occurredAt)}</time>
    <p><strong>{approvalAuditTypeLabels[item.eventType] ?? item.eventType}</strong></p>
    <dl className={styles.activityFacts}>
      {(item.fromStatus !== null || item.toStatus !== null) && <div><dt>요청 상태</dt><dd>{statusText(item.fromStatus)} → {statusText(item.toStatus)}</dd></div>}
      <div><dt>사유</dt><dd className={styles.plainText}>{item.reason === null || item.reason.trim() === '' ? '기록 없음' : item.reason}</dd></div>
      <div><dt>수행자</dt><dd className={styles.idCell}>{item.actorMembershipId}</dd></div>
    </dl>
  </>
}
