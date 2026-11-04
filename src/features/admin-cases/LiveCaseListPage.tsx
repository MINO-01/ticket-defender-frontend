import { Link, useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { statusLabels } from '../../components/common/statusLabels'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { formatUtc, readPageParam } from '../admin-track2/track2Api'
import { caseDetailRoute, caseListPath, casePageSchema, casePageSize, caseStatuses, caseTypeLabels, readCaseStatusParam } from './caseApi'
import type { CaseStatus, CaseView } from './caseApi'
import styles from './Cases.module.css'

// 인증된 관리자의 Case 목록이다. 서버가 확인한 접근 가능 공연의 UUID로만 조회하고 합성 데모 데이터와 섞지 않는다.
// 서버는 상태 필터와 페이지만 지원하고 전체 건수를 주지 않으므로 검색, 담당자 필터, 정렬, 합성 통계, 전체 페이지 수는 제공하지 않는다.
// ANALYST는 자신이 생성했거나 담당한 Case만 받으며, 역할별 범위는 Backend가 판단한다.

export function LiveCaseListPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="Case 조회" title="사건 관리" description="선택한 공연의 Case를 최근 생성 순으로 살펴봅니다. Case 상태는 조사 진행 단계이며 부정 거래 판정이 아닙니다." />
    <AdminEventGate>{(event) => <CaseList key={event.id} event={event} />}</AdminEventGate>
    <p className={styles.notice}>서버가 반환한 Case만 표시합니다. 검색, 담당자 필터, 정렬과 전체 건수는 서버가 지원하지 않아 제공하지 않습니다. Case 생성과 상태 변경은 이 화면에서 실행할 수 없습니다.</p>
  </div>
}

function CaseList({ event }: { event: AdminEvent }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = readPageParam(searchParams.get('page'))
  const status = readCaseStatusParam(searchParams.get('status'))
  const { result, retry } = useAdminQuery(caseListPath(event.id, page, status), casePageSchema)

  const navigate = (next: { page: number; status?: CaseStatus | null }) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    params.set('eventId', event.id)
    if (next.status !== undefined) {
      if (next.status) params.set('status', next.status)
      else params.delete('status')
    }
    params.set('page', String(next.page))
    return params
  })

  const filterControl = <Card className={styles.filterCard} aria-label="Case 상태 필터">
    <div className={styles.serverFilters}>
      <label>조사 상태<select value={status ?? ''} onChange={(change) => navigate({ page: 0, status: readCaseStatusParam(change.target.value) })}>
        <option value="">전체 상태</option>
        {caseStatuses.map((value) => <option key={value} value={value}>{statusLabels.case[value].label}</option>)}
      </select></label>
    </div>
  </Card>

  if (result === null) return <>{filterControl}<LoadingSkeleton label="Case 목록을 불러오는 중" /></>
  // 다른 공연, 다른 페이지, 필터와 다른 상태의 Case가 섞이면 현재 화면의 결과로 볼 수 없으므로 계약 위반으로 처리한다.
  const mismatched = result.kind === 'success' && (result.data.page !== page || result.data.pageSize !== casePageSize
    || result.data.items.some((item) => item.eventId !== event.id || (status !== null && item.status !== status)))
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    return <>{filterControl}<ErrorState title={message.title} description={message.description} onRetry={retry} /></>
  }

  const data = result.data
  const scope = status ? `조사 상태 "${statusLabels.case[status].label}"` : '전체 상태'
  const columns = [
    { key: 'id', header: 'Case ID', render: (item: CaseView) => <span className={styles.idCell}>{item.caseId}</span> },
    { key: 'type', header: '유형', render: (item: CaseView) => caseTypeLabels[item.type] },
    { key: 'status', header: '조사 상태', render: (item: CaseView) => <StatusBadge domain="case" status={item.status} /> },
    { key: 'version', header: 'Case 버전', render: (item: CaseView) => item.caseVersion },
    { key: 'assignee', header: '담당자 지정', render: (item: CaseView) => item.assigneeMembershipId === null ? '미지정' : '지정됨' },
    { key: 'created', header: '생성 시각', render: (item: CaseView) => <time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time> },
    { key: 'updated', header: '최근 변경', render: (item: CaseView) => <time dateTime={item.updatedAt}>{formatUtc(item.updatedAt)}</time> },
    { key: 'detail', header: '상세', render: (item: CaseView) => <Link className={styles.detailLink} to={caseDetailRoute(item.caseId, event.id)} aria-label={`${item.caseId} 상세 보기`}>상세 보기</Link> },
  ]

  return <>
    {filterControl}
    {data.items.length === 0
      ? data.page === 0
        ? <EmptyState title="조건에 맞는 Case가 없습니다" description={`선택한 공연에 ${scope}의 Case가 없거나 현재 계정의 조회 범위에 없습니다. 조회 장애가 아닙니다.`} />
        : <div className={styles.page}><EmptyState title="이 페이지에 표시할 Case가 없습니다" description="요청한 페이지가 결과 범위를 벗어났습니다." /><Button variant="secondary" onClick={() => navigate({ page: 0 })}>첫 페이지로 이동</Button></div>
      : <Card className={styles.tableCard}>
        <div className={styles.tableHeading}><h2>{event.name} Case 목록</h2><span>{scope}, 이 페이지 {data.items.length}건</span></div>
        <p className={styles.tableHint}>담당자 이름을 조회하는 API가 없어 지정 여부만 표시합니다. 표를 좌우로 스크롤하면 상세 보기를 확인할 수 있습니다.</p>
        <DataTable caption="Case 목록" columns={columns} rows={data.items} getRowKey={(item) => item.caseId} />
        <nav className={styles.pagination} aria-label="Case 목록 페이지"><Button variant="secondary" size="small" disabled={data.page === 0} onClick={() => navigate({ page: data.page - 1 })}>이전</Button><span>{data.page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!data.hasNext} onClick={() => navigate({ page: data.page + 1 })}>다음</Button></nav>
      </Card>}
  </>
}
