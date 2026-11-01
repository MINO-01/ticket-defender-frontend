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
import {
  formatAlgorithm, formatAnalyzedAt, formatRiskScore, readTrack1Page, readTrack1Sort, track1ClusterListPath, track1ClusterPageSchema, track1DetailRoute,
} from './track1Api'
import type { Track1ClusterSummary, Track1Sort } from './track1Api'
import styles from './Track1.module.css'

// 인증된 관리자의 Track 1 군집 목록이다. 선택한 공연의 서버 페이지와 서버 정렬만 사용하며 합성 데모 데이터와 섞지 않는다.
// 검색과 연결 정보 필터는 Backend가 지원하지 않아 제공하지 않는다. 현재 페이지만 거르는 검색을 전체 검색처럼 보이지 않게 하기 위해서다.

export function LiveClusterListPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="Track 1 저장 증거 조회" title="연관 예매 군집" description="선택한 공연에 저장된 군집 증거를 조사 우선순위 순으로 살펴봅니다. 점수는 불법 가능성을 뜻하지 않습니다." />
    <AdminEventGate>{(event) => <ClusterList key={event.id} event={event} />}</AdminEventGate>
    <p className={styles.notice}>Risk Score는 0~1 사이의 조사 우선순위 신호이며 부정 거래 확률이 아닙니다. 저장된 증거만 표시하므로 전체 분석 결과나 확정 판정으로 해석하지 마세요. 검색과 연결 정보 필터는 서버가 지원하지 않아 제공하지 않습니다.</p>
  </div>
}

function ClusterList({ event }: { event: AdminEvent }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = readTrack1Page(searchParams.get('page'))
  const sort = readTrack1Sort(searchParams.get('sort'))
  const { result, retry } = useAdminQuery(track1ClusterListPath(event.id, page, sort), track1ClusterPageSchema)

  const navigate = (next: { page?: number; sort?: Track1Sort }) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    params.set('eventId', event.id)
    if (next.sort) params.set('sort', next.sort)
    params.set('page', String(next.page ?? 0))
    return params
  })

  const sortControl = <Card className={styles.filterCard} aria-label="군집 정렬">
    <div className={styles.serverFilters}>
      <label>정렬<select value={sort} onChange={(change) => navigate({ sort: change.target.value as Track1Sort, page: 0 })}><option value="priority-desc">조사 우선순위 높은 순</option><option value="priority-asc">조사 우선순위 낮은 순</option><option value="recent">최근 분석 순</option></select></label>
    </div>
  </Card>

  if (result === null) return <>{sortControl}<LoadingSkeleton label="군집 목록을 불러오는 중" /></>
  // 다른 공연이나 다른 페이지의 응답은 현재 화면에 섞일 수 있으므로 계약 위반으로 처리한다.
  const mismatched = result.kind === 'success' && (result.data.event.id !== event.id || result.data.page !== page)
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    return <>{sortControl}<ErrorState title={message.title} description={message.description} onRetry={retry} /></>
  }

  const data = result.data
  const pageCount = Math.max(Math.ceil(data.totalItems / data.pageSize), 1)
  const first = data.page * data.pageSize + 1
  const columns = [
    { key: 'id', header: '군집 / 분석 요청', render: (cluster: Track1ClusterSummary) => <span><strong>{cluster.clusterId}</strong><small className={styles.cellSub}>{cluster.analysisRequestId}</small></span> },
    { key: 'members', header: '저장 구성원', render: (cluster: Track1ClusterSummary) => `${cluster.storedMemberCount}건` },
    { key: 'priority', header: '조사 우선순위 (0~1)', render: (cluster: Track1ClusterSummary) => <strong className={styles.priority}>{formatRiskScore(cluster.riskScore)}</strong> },
    { key: 'algorithm', header: '분석 방법', render: formatAlgorithm },
    { key: 'time', header: '분석 시각', render: (cluster: Track1ClusterSummary) => cluster.analyzedAt === null ? '기록 없음' : <time dateTime={cluster.analyzedAt}>{formatAnalyzedAt(cluster.analyzedAt)}</time> },
    { key: 'detail', header: '상세', render: (cluster: Track1ClusterSummary) => <Link className={styles.detailLink} to={track1DetailRoute({ eventId: event.id, analysisRequestId: cluster.analysisRequestId, clusterId: cluster.clusterId })} aria-label={`${cluster.clusterId} 상세 보기`}>상세 보기</Link> },
  ]

  return <>
    {sortControl}
    <div className={styles.metrics} aria-label="서버 조회 결과 요약">
      <Card><span>저장된 군집 (전체)</span><strong>{data.totalItems}건</strong></Card>
      <Card><span>현재 페이지</span><strong>{data.items.length}개 표시</strong></Card>
      <Card><span>증거 범위</span><strong>저장 증거만</strong></Card>
    </div>
    {data.totalItems === 0
      ? <EmptyState title="저장된 군집이 없습니다" description="선택한 공연에 저장된 Track 1 군집 증거가 없습니다. 분석 실행 여부나 분석 실패 여부를 뜻하지 않습니다." />
      : data.items.length === 0
        ? <div className={styles.page}><EmptyState title="이 페이지에 표시할 군집이 없습니다" description="요청한 페이지가 전체 결과 범위를 벗어났습니다." /><Button variant="secondary" onClick={() => navigate({ page: 0 })}>첫 페이지로 이동</Button></div>
        : <Card className={styles.tableCard}>
          <div className={styles.sectionHeading}><h2>{event.name} 군집 목록</h2><span>전체 {data.totalItems}건 중 {first}~{first + data.items.length - 1}번째</span></div>
          <DataTable caption="Track 1 저장 증거 군집 목록" columns={columns} rows={data.items} getRowKey={(cluster) => JSON.stringify([cluster.analysisRequestId, cluster.clusterId])} />
          <nav className={styles.pagination} aria-label="군집 목록 페이지"><Button variant="secondary" size="small" disabled={data.page === 0} onClick={() => navigate({ page: data.page - 1 })}>이전</Button><span>{data.page + 1} / {pageCount} 페이지</span><Button variant="secondary" size="small" disabled={!data.hasNext} onClick={() => navigate({ page: data.page + 1 })}>다음</Button></nav>
        </Card>}
  </>
}
