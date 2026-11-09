import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Select } from '../../components/common/FormControls'
import { approvalRequestRoute, approvalRequestStatuses } from '../admin-approvals/approvalApi'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { caseDetailRoute } from '../admin-cases/caseApi'
import { formatUtc } from '../admin-track2/track2Api'
import { adminMePath, adminMeSchema, approvalQueuePath, approvalQueueSchema, eventAuditPath, eventAuditSchema } from './adminConsoleApi'
import styles from './Operations.module.css'

// 관리자 콘솔 조회 영역이다. 조회 실패는 빈 목록으로 바꾸지 않고, 역할 표시는 안내일 뿐 권한 판단에 쓰지 않는다.

function Failure({ failure, onRetry, forbidden }: { failure: AdminApiFailure; onRetry: () => void; forbidden: string }) {
  const message = failure.kind === 'forbidden'
    ? { title: '이 영역에 필요한 역할이 없습니다', description: forbidden }
    : describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
  return <ErrorState title={message.title} description={message.description} onRetry={onRetry} />
}

function Pager({ page, hasNext, onPage }: { page: number; hasNext: boolean; onPage: (page: number) => void }) {
  if (page === 0 && !hasNext) return null
  return <div><Button variant="secondary" size="small" disabled={page === 0} onClick={() => onPage(page - 1)}>이전</Button> {page + 1} 페이지 <Button variant="secondary" size="small" disabled={!hasNext} onClick={() => onPage(page + 1)}>다음</Button></div>
}

export function MyAccessPanel() {
  const { result, retry } = useAdminQuery(adminMePath, adminMeSchema)
  let body
  if (result === null) body = <LoadingSkeleton label="내 역할을 불러오는 중" />
  else if (result.kind !== 'success') {
    const conflict = result.kind === 'problem' && result.code === 'TENANT_SELECTION_REQUIRED'
    body = conflict
      ? <ErrorState title="여러 고객사에 소속된 계정입니다" description="고객사 선택 정책이 확정되지 않아 이 계정의 역할을 표시할 수 없습니다." onRetry={retry} />
      : <Failure failure={result} onRetry={retry} forbidden="서버가 현재 계정의 멤버십을 확인하지 못했습니다." />
  } else {
    body = <dl className={styles.facts}>
      <div><dt>역할</dt><dd>{result.data.roles.length === 0 ? '없음' : result.data.roles.join(', ')}</dd></div>
      <div><dt>접근 가능한 공연</dt><dd>{result.data.eventIds.length}개</dd></div>
      <div><dt>고객사 ID</dt><dd>{result.data.tenantId}</dd></div>
    </dl>
  }
  return <Card className={styles.panel} aria-label="내 역할과 접근 범위">
    <h2>내 역할과 접근 범위</h2>
    <p className={styles.note}>서버에 저장된 멤버십 기준의 안내입니다. 실제 권한은 요청마다 서버가 판단합니다.</p>
    {body}
  </Card>
}

export function ApprovalQueuePanel({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState('PENDING')
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(approvalQueuePath(eventId, status, page), approvalQueueSchema)
  let body
  if (result === null) body = <LoadingSkeleton label="승인 요청을 불러오는 중" />
  else if (result.kind !== 'success') body = <Failure failure={result} onRetry={retry} forbidden="승인 요청 목록은 고객사 관리자, 검토 담당, 승인 담당만 조회할 수 있습니다." />
  else if (result.data.items.length === 0) body = <EmptyState title="조건에 맞는 승인 요청이 없습니다" description="서버가 빈 목록을 반환했습니다." />
  else body = <>
    <ul aria-label="승인 요청 목록">{result.data.items.map((item) => <li key={item.approvalRequestId}>
      <Link to={approvalRequestRoute(item.approvalRequestId)}>승인 요청 {item.approvalRequestId.slice(0, 8)}</Link> {item.status}, 보고서 개정 {item.reportRevision}, 요청 시각 {formatUtc(item.requestedAt)}
    </li>)}</ul>
    <Pager page={page} hasNext={result.data.hasNext} onPage={setPage} />
  </>
  return <Card className={styles.panel} aria-label="승인 요청 목록">
    <h2>승인 요청 목록</h2>
    <Select label="상태" value={status} onChange={(change) => { setStatus(change.target.value); setPage(0) }}>
      <option value="">전체</option>
      {approvalRequestStatuses.map((value) => <option key={value} value={value}>{value}</option>)}
    </Select>
    {body}
  </Card>
}

export function EventAuditPanel({ eventId }: { eventId: string }) {
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(eventAuditPath(eventId, page), eventAuditSchema)
  let body
  if (result === null) body = <LoadingSkeleton label="승인 감사 이력을 불러오는 중" />
  else if (result.kind !== 'success') body = <Failure failure={result} onRetry={retry} forbidden="공연 단위 승인 감사 이력은 고객사 관리자, 검토 담당, 승인 담당만 조회할 수 있습니다." />
  else if (result.data.items.length === 0) body = <EmptyState title="승인 감사 이력이 없습니다" description="서버가 빈 목록을 반환했습니다." />
  else body = <>
    <ul aria-label="공연 승인 감사 이력">{result.data.items.map((item) => <li key={item.auditEventId}>
      <time dateTime={item.occurredAt}>{formatUtc(item.occurredAt)}</time> {item.eventType}{item.fromStatus || item.toStatus ? ` (${item.fromStatus ?? '없음'} → ${item.toStatus ?? '없음'})` : ''} <Link to={caseDetailRoute(item.caseId, eventId)}>사건 {item.caseId.slice(0, 8)}</Link>
    </li>)}</ul>
    <Pager page={page} hasNext={result.data.hasNext} onPage={setPage} />
  </>
  return <Card className={styles.panel} aria-label="공연 승인 감사 이력">
    <h2>공연 승인 감사 이력</h2>
    <p className={styles.note}>공연 단위의 승인 감사만 표시합니다. 로그인, 증거 열람 등을 포함한 전체 감사 로그가 아닙니다.</p>
    {body}
  </Card>
}
