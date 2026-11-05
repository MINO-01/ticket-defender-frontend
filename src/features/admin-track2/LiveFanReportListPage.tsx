import { Link, useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { verifiedPerformanceRoute } from './candidatePipelineApi'
import { StatusPill } from './StatusPill'
import {
  fanReportDetailRoute, fanReportListPath, fanReportPageSchema, formatUtc, intakeStatusLabels, intakeStatuses, intakeTone, readIntakeStatusParam, readPageParam,
} from './track2Api'
import type { FanReportSummary, IntakeStatus } from './track2Api'
import { reportTypeLabels } from './track2Model'
import styles from './Track2.module.css'

// 인증된 관리자의 Track 2 팬 제보 목록이다. 서버가 확인한 접근 가능 공연의 UUID로만 조회하고 합성 데모 데이터와 섞지 않는다.
// 서버는 접수 상태 필터와 페이지만 지원하므로 전체 검색, 분석 상태 필터, 예매 대조 필터와 추출 통계는 제공하지 않는다.

export function LiveFanReportListPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="Track 2 팬 제보 조회" title="팬 제보 검토" description="선택한 공연에 접수된 팬 제보를 최근 접수 순으로 살펴봅니다. 접수 상태는 분석 결과나 부정 거래 판정이 아닙니다." />
    <AdminEventGate>{(event) => <ReportList key={event.id} event={event} />}</AdminEventGate>
    <p className={styles.notice}>접수 상태는 증거 저장 여부를 나타내며 이미지 분석 결과가 아닙니다. 분석 이력과 관찰값은 제보 상세에서 증거별로 확인합니다. 검색, 분석 상태 필터, 예매 대조 필터는 서버가 지원하지 않아 제공하지 않습니다.</p>
  </div>
}

function ReportList({ event }: { event: AdminEvent }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = readPageParam(searchParams.get('page'))
  const intakeStatus = readIntakeStatusParam(searchParams.get('intakeStatus'))
  const { result, retry } = useAdminQuery(fanReportListPath(event.id, page, intakeStatus), fanReportPageSchema)

  const navigate = (next: { page: number; intakeStatus?: IntakeStatus | null }) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    params.set('eventId', event.id)
    if (next.intakeStatus !== undefined) {
      if (next.intakeStatus) params.set('intakeStatus', next.intakeStatus)
      else params.delete('intakeStatus')
    }
    params.set('page', String(next.page))
    return params
  })

  const filterControl = <Card className={styles.filterCard} aria-label="제보 접수 상태 필터">
    <div className={styles.serverFilters}>
      <label>접수 상태<select value={intakeStatus ?? ''} onChange={(change) => navigate({ page: 0, intakeStatus: readIntakeStatusParam(change.target.value) })}>
        <option value="">전체 접수 상태</option>
        {intakeStatuses.map((status) => <option key={status} value={status}>{intakeStatusLabels[status]}</option>)}
      </select></label>
      <Link className={styles.detailLink} to={verifiedPerformanceRoute(event.id)}>이 공연의 검증 회차 관리</Link>
    </div>
  </Card>

  if (result === null) return <>{filterControl}<LoadingSkeleton label="팬 제보 목록을 불러오는 중" /></>
  // 다른 공연이나 다른 페이지의 응답은 현재 화면에 섞일 수 있으므로 계약 위반으로 처리한다.
  const mismatched = result.kind === 'success' && (result.data.event.id !== event.id || result.data.page !== page
    || (intakeStatus !== null && result.data.items.some((item) => item.intakeStatus !== intakeStatus)))
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    return <>{filterControl}<ErrorState title={message.title} description={message.description} onRetry={retry} /></>
  }

  const data = result.data
  const pageCount = Math.max(Math.ceil(data.totalItems / data.pageSize), 1)
  const first = data.page * data.pageSize + 1
  const scope = intakeStatus ? `접수 상태 "${intakeStatusLabels[intakeStatus]}"` : '전체 접수 상태'
  const columns = [
    { key: 'id', header: '제보 ID', render: (report: FanReportSummary) => <span className={styles.idCell}>{report.fanReportId}</span> },
    { key: 'type', header: '제보 유형', render: (report: FanReportSummary) => reportTypeLabels[report.reportType] },
    { key: 'received', header: '접수 시각', render: (report: FanReportSummary) => <time dateTime={report.receivedAt}>{formatUtc(report.receivedAt)}</time> },
    { key: 'intake', header: '접수 상태', render: (report: FanReportSummary) => <StatusPill label={intakeStatusLabels[report.intakeStatus]} tone={intakeTone(report.intakeStatus)} /> },
    { key: 'evidence', header: '증거 (저장 완료 / 접수)', render: (report: FanReportSummary) => `${report.storedEvidenceCount} / ${report.evidenceCount}개` },
    { key: 'performance', header: '팬 입력 공연 일시', render: (report: FanReportSummary) => <span>{formatUtc(report.submittedPerformanceAt)}<small className={styles.cellSub}>검증된 회차 아님</small></span> },
    { key: 'detail', header: '상세', render: (report: FanReportSummary) => <Link className={styles.detailLink} to={fanReportDetailRoute(report.fanReportId)} aria-label={`${report.fanReportId} 상세 보기`}>상세 보기</Link> },
  ]

  return <>
    {filterControl}
    <div className={styles.liveMetrics} aria-label="서버 조회 결과 요약">
      <Card><span>제보 수 ({scope})</span><strong>{data.totalItems}건</strong></Card>
      <Card><span>현재 페이지</span><strong>{data.items.length}건 표시</strong></Card>
    </div>
    {data.totalItems === 0
      ? <EmptyState title="조건에 맞는 제보가 없습니다" description={`선택한 공연에 ${scope}의 팬 제보가 없습니다. 조회 장애가 아닙니다.`} />
      : data.items.length === 0
        ? <div className={styles.page}><EmptyState title="이 페이지에 표시할 제보가 없습니다" description="요청한 페이지가 전체 결과 범위를 벗어났습니다." /><Button variant="secondary" onClick={() => navigate({ page: 0 })}>첫 페이지로 이동</Button></div>
        : <Card className={styles.tableCard}>
          <div className={styles.tableHeading}><h2>{event.name} 제보 목록</h2><span>전체 {data.totalItems}건 중 {first}~{first + data.items.length - 1}번째</span></div>
          <DataTable caption="Track 2 팬 제보 목록" columns={columns} rows={data.items} getRowKey={(report) => report.fanReportId} />
          <nav className={styles.pagination} aria-label="팬 제보 목록 페이지"><Button variant="secondary" size="small" disabled={data.page === 0} onClick={() => navigate({ page: data.page - 1 })}>이전</Button><span>{data.page + 1} / {pageCount} 페이지</span><Button variant="secondary" size="small" disabled={!data.hasNext} onClick={() => navigate({ page: data.page + 1 })}>다음</Button></nav>
        </Card>}
  </>
}
