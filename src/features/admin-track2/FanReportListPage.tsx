import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { demoTrack2Data } from './demoData'
import { StatusPill } from './StatusPill'
import { comparisonLabels, defaultReportFilters, extractionLabels, filterReports, isValidTrack2Dataset, reportPageSize, reportTypeLabels, reviewLabels } from './track2Model'
import type { ComparisonStatus, ExtractionStatus, FanReport, ReportFilters, ReviewStatus, Track2Dataset } from './track2Model'
import styles from './Track2.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'
export function FanReportListPage({ data = demoTrack2Data, state = 'ready' }: { data?: Track2Dataset; state?: ViewState }) {
  const [filters, setFilters] = useState<ReportFilters>(defaultReportFilters)
  const [page, setPage] = useState(1)
  const update = (next: Partial<ReportFilters>) => { setFilters((current) => ({ ...current, ...next })); setPage(1) }
  if (state === 'loading') return <LoadingSkeleton label="팬 제보 목록을 불러오는 중" />
  if (state === 'failed') return <ErrorState title="팬 제보 목록을 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidTrack2Dataset(data)) return <ErrorState title="제보 데이터 형식을 확인할 수 없습니다" description="합성 데이터의 참조 관계를 확인해 주세요." />

  const matching = filterReports(data, filters)
  const pageCount = Math.ceil(matching.length / reportPageSize)
  const currentPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))
  const visible = matching.slice((currentPage - 1) * reportPageSize, currentPage * reportPageSize)
  const extraction = (report: FanReport) => data.extractions.find((item) => item.id === report.extractionId)!
  const comparison = (report: FanReport) => data.comparisons.find((item) => item.id === report.comparisonId)!
  const columns = [
    { key: 'report', header: '제보 번호', render: (report: FanReport) => <strong>{report.id}</strong> },
    { key: 'event', header: '공연 · 제보 유형', render: (report: FanReport) => <span><strong>{data.events.find((event) => event.id === report.eventId)?.name}</strong><small className={styles.cellSub}>{reportTypeLabels[report.reportType]}</small></span> },
    { key: 'evidence', header: '증거', render: (report: FanReport) => `${report.evidenceIds.length}개` },
    { key: 'extraction', header: '추출', render: (report: FanReport) => <StatusPill label={extractionLabels[extraction(report).status]} tone={extraction(report).status === 'COMPLETED' ? 'success' : extraction(report).status === 'FAILED' ? 'critical' : 'neutral'} /> },
    { key: 'comparison', header: '예매 대조', render: (report: FanReport) => <StatusPill label={comparisonLabels[comparison(report).status]} tone={comparison(report).status === 'MATCH_CANDIDATE' ? 'info' : comparison(report).status === 'NO_MATCH' ? 'warning' : 'neutral'} /> },
    { key: 'review', header: '검토', render: (report: FanReport) => <StatusPill label={reviewLabels[report.reviewStatus]} tone={report.reviewStatus === 'NEEDS_MORE' ? 'warning' : report.reviewStatus === 'UNDER_REVIEW' ? 'info' : 'neutral'} /> },
    { key: 'time', header: '접수 시각', render: (report: FanReport) => <time dateTime={report.receivedAt}>{report.receivedAt.slice(0, 16).replace('T', ' ')}</time> },
    { key: 'detail', header: '상세', render: (report: FanReport) => <Link className={styles.detailLink} to={`/app/fan-reports/${report.id}`} aria-label={`${report.id} 상세 검토`}>상세 검토</Link> },
  ]

  return <div className={styles.page}>
    <PageHeader eyebrow="Track 2 · 합성 데모 데이터" title="팬 제보 검토" description="증거 관찰 내용과 예매 대조 후보를 살펴봅니다. 실제 접수·분석 조회 기능은 아직 연결되지 않았습니다." />
    <div className={styles.metrics} aria-label="현재 필터 결과 요약">
      <Card><span>검색 결과</span><strong>{matching.length}건</strong></Card>
      <Card><span>추출 완료</span><strong>{matching.filter((report) => extraction(report).status === 'COMPLETED').length}건</strong></Card>
      <Card><span>일치 후보</span><strong>{matching.filter((report) => comparison(report).status === 'MATCH_CANDIDATE').length}건</strong></Card>
      <Card><span>검토·보완 대상</span><strong>{matching.filter((report) => report.reviewStatus !== 'NEW').length}건</strong></Card>
    </div>
    <Card className={styles.filterCard} aria-label="제보 검색 및 필터">
      <div className={styles.filters}>
        <label className={styles.searchField}>검색<input value={filters.query} onChange={(event) => update({ query: event.target.value })} placeholder="제보 번호, 공연 또는 제보 유형" /></label>
        <label>공연<select value={filters.eventId} onChange={(event) => update({ eventId: event.target.value })}><option value="">전체 공연</option>{data.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
        <label>추출 상태<select value={filters.extraction} onChange={(event) => update({ extraction: event.target.value as ReportFilters['extraction'] })}><option value="">전체</option>{(Object.keys(extractionLabels) as ExtractionStatus[]).map((status) => <option key={status} value={status}>{extractionLabels[status]}</option>)}</select></label>
        <label>대조 상태<select value={filters.comparison} onChange={(event) => update({ comparison: event.target.value as ReportFilters['comparison'] })}><option value="">전체</option>{(Object.keys(comparisonLabels) as ComparisonStatus[]).map((status) => <option key={status} value={status}>{comparisonLabels[status]}</option>)}</select></label>
        <label>검토 상태<select value={filters.review} onChange={(event) => update({ review: event.target.value as ReportFilters['review'] })}><option value="">전체</option>{(Object.keys(reviewLabels) as ReviewStatus[]).map((status) => <option key={status} value={status}>{reviewLabels[status]}</option>)}</select></label>
        <label>정렬<select value={filters.sort} onChange={(event) => update({ sort: event.target.value as ReportFilters['sort'] })}><option value="recent">최근 접수 순</option><option value="oldest">오래된 접수 순</option><option value="id">제보 번호 순</option></select></label>
        <Button variant="secondary" onClick={() => { setFilters(defaultReportFilters); setPage(1) }}>필터 초기화</Button>
      </div>
    </Card>
    {data.reports.length === 0 ? <EmptyState title="표시할 제보가 없습니다" description="합성 제보 데이터가 없습니다." /> : matching.length === 0 ? <EmptyState title="검색 결과가 없습니다" description="조건을 바꾸거나 필터를 초기화해 주세요." /> : <Card className={styles.tableCard}>
      <div className={styles.tableHeading}><h2>제보 목록</h2><span aria-live="polite">{matching.length}건 중 {(currentPage - 1) * reportPageSize + 1}–{Math.min(currentPage * reportPageSize, matching.length)}건 표시</span></div>
      <p className={styles.tableHint}>표를 좌우로 스크롤하면 상태와 상세 보기를 확인할 수 있습니다.</p>
      <DataTable caption="합성 팬 제보 검토 목록" columns={columns} rows={visible} getRowKey={(report) => report.id} />
      <nav className={styles.pagination} aria-label="팬 제보 목록 페이지"><Button variant="secondary" size="small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button><span>{currentPage} / {pageCount} 페이지</span><Button variant="secondary" size="small" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button></nav>
    </Card>}
    <p className={styles.notice}>합성 데모 데이터입니다. 일치 후보는 실제 판매자나 부정 거래의 확정 결과가 아닙니다. 실제 관리자 인증·증거 접근 기능은 연결되지 않았습니다.</p>
  </div>
}
