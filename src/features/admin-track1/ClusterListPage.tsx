import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { demoTrack1Data, signalLabels } from './demoData'
import type { Cluster, Track1Dataset, SignalKind } from './demoData'
import { defaultFilters, filterClusters, isValidDataset, pageSize } from './track1Model'
import type { ListFilters } from './track1Model'
import styles from './Track1.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'
export function ClusterListPage({ data = demoTrack1Data, state = 'ready' }: { data?: Track1Dataset; state?: ViewState }) {
  const [filters, setFilters] = useState<ListFilters>(defaultFilters)
  const [page, setPage] = useState(1)
  const update = (next: Partial<ListFilters>) => { setFilters((current) => ({ ...current, ...next })); setPage(1) }
  if (state === 'loading') return <LoadingSkeleton label="군집 목록을 불러오는 중" />
  if (state === 'failed') return <ErrorState title="군집 목록을 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidDataset(data)) return <ErrorState title="군집 데이터 형식을 확인할 수 없습니다" description="분석 결과의 연결 정보를 확인해 주세요." />

  const matching = filterClusters(data, filters)
  const pageCount = Math.ceil(matching.length / pageSize)
  const currentPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))
  const visible = matching.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const eventName = (cluster: Cluster) => data.events.find((event) => event.id === cluster.eventId)?.name ?? '공연 정보 없음'
  const run = (cluster: Cluster) => data.runs.find((item) => item.id === cluster.analysisRunId)
  const columns = [
    { key: 'event', header: '대상 공연', render: (cluster: Cluster) => <strong>{eventName(cluster)}</strong> },
    { key: 'id', header: '군집 · 분석 작업', render: (cluster: Cluster) => <span><strong>{cluster.id}</strong><small className={styles.cellSub}>{cluster.analysisRunId}</small></span> },
    { key: 'members', header: '관련 예매 / 계정', render: (cluster: Cluster) => `${cluster.reservations.length}건 / ${cluster.accounts.length}개` },
    { key: 'signals', header: '공유된 연결 정보', render: (cluster: Cluster) => [...new Set(cluster.signals.map((signal) => signal.kind))].map((kind) => signalLabels[kind]).join(' · ') },
    { key: 'priority', header: '조사 우선순위', render: (cluster: Cluster) => <strong className={styles.priority}>{cluster.priority}점</strong> },
    { key: 'time', header: '분석 시각', render: (cluster: Cluster) => <time dateTime={run(cluster)?.analyzedAt}>{run(cluster)?.analyzedAt.slice(0, 16).replace('T', ' ')}</time> },
    { key: 'detail', header: '상세', render: (cluster: Cluster) => <Link className={styles.detailLink} to={`/app/analysis/findings/${cluster.id}`} aria-label={`${cluster.id} 상세 보기`}>상세 보기</Link> },
  ]

  return <div className={styles.page}>
    <PageHeader eyebrow="Track 1 · 합성 데모 데이터" title="연관 예매 군집" description="공유된 연결 단서를 살펴보고 추가 검토가 필요한 군집을 찾습니다. 점수는 불법 가능성을 뜻하지 않습니다." />
    <div className={styles.metrics} aria-label="현재 필터 결과 요약">
      <Card><span>검색 결과</span><strong>{matching.length}건</strong></Card>
      <Card><span>관련 예매</span><strong>{matching.reduce((sum, cluster) => sum + cluster.reservations.length, 0)}건</strong></Card>
      <Card><span>관련 계정</span><strong>{matching.reduce((sum, cluster) => sum + cluster.accounts.length, 0)}개</strong></Card>
    </div>
    <Card className={styles.filterCard} aria-label="군집 검색 및 필터">
      <div className={styles.filters}>
        <label>검색<input value={filters.query} onChange={(event) => update({ query: event.target.value })} placeholder="공연, 군집, 계정, 예매 또는 분석 작업" /></label>
        <label>공연<select value={filters.eventId} onChange={(event) => update({ eventId: event.target.value })}><option value="">전체 공연</option>{data.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
        <label>연결 정보<select value={filters.signal} onChange={(event) => update({ signal: event.target.value as SignalKind | '' })}><option value="">전체 유형</option>{(Object.keys(signalLabels) as SignalKind[]).map((kind) => <option key={kind} value={kind}>{signalLabels[kind]}</option>)}</select></label>
        <label>정렬<select value={filters.sort} onChange={(event) => update({ sort: event.target.value as ListFilters['sort'] })}><option value="priority-desc">조사 우선순위 높은 순</option><option value="priority-asc">조사 우선순위 낮은 순</option><option value="recent">최근 분석 순</option></select></label>
        <Button variant="secondary" onClick={() => { setFilters(defaultFilters); setPage(1) }}>필터 초기화</Button>
      </div>
    </Card>
    {data.clusters.length === 0 ? <EmptyState title="분석 군집이 없습니다" description="표시할 합성 분석 결과가 없습니다." /> : matching.length === 0 ? <EmptyState title="검색 결과가 없습니다" description="조건을 바꾸거나 필터를 초기화해 주세요." /> : <Card className={styles.tableCard}>
      <div className={styles.sectionHeading}><h2>군집 목록</h2><span>{matching.length}건 중 {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, matching.length)}건 표시</span></div>
      <DataTable caption="합성 연관 예매 군집 목록" columns={columns} rows={visible} getRowKey={(cluster) => cluster.id} />
      <nav className={styles.pagination} aria-label="군집 목록 페이지"><Button variant="secondary" size="small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button><span>{currentPage} / {pageCount} 페이지</span><Button variant="secondary" size="small" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button></nav>
    </Card>}
    <p className={styles.notice}>합성 데모 데이터입니다. 실제 분석 조회·관리자 인증은 연결되지 않았습니다. IP 등 연결 단서만으로 동일인이나 부정 거래를 확정할 수 없습니다.</p>
  </div>
}
