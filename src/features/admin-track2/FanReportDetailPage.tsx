import { Link, useParams } from 'react-router-dom'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { demoTrack2Data } from './demoData'
import { EvidenceViewer } from './EvidenceViewer'
import { ExtractionReviewPanel } from './ExtractionReviewPanel'
import { ReservationComparisonPanel } from './ReservationComparisonPanel'
import { StatusPill } from './StatusPill'
import { isValidTrack2Dataset, reportTypeLabels, reviewLabels } from './track2Model'
import type { Track2Dataset } from './track2Model'
import styles from './Track2.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'
export function FanReportDetailPage({ data = demoTrack2Data, state = 'ready' }: { data?: Track2Dataset; state?: ViewState }) {
  const { reportId } = useParams()
  if (state === 'loading') return <LoadingSkeleton label="제보 상세를 불러오는 중" />
  if (state === 'failed') return <ErrorState title="제보 상세를 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidTrack2Dataset(data)) return <ErrorState title="제보 데이터 형식을 확인할 수 없습니다" description="합성 데이터의 참조 관계를 확인해 주세요." />
  const report = data.reports.find((item) => item.id === reportId)
  if (!report) return <div className={styles.page}><EmptyState title="제보를 찾을 수 없습니다" description="제보 번호를 확인하거나 목록으로 돌아가세요." /><Link className={styles.detailLink} to="/app/fan-reports">제보 목록으로 돌아가기</Link></div>
  const extraction = data.extractions.find((item) => item.id === report.extractionId)!
  const comparison = data.comparisons.find((item) => item.id === report.comparisonId)!
  const evidence = report.evidenceIds.map((id) => data.evidence.find((item) => item.id === id)!)
  const event = data.events.find((item) => item.id === report.eventId)!
  return <div className={styles.page}>
    <Link className={styles.backLink} to="/app/fan-reports">← 제보 목록</Link>
    <PageHeader eyebrow="Track 2 · 합성 데모 데이터" title={`제보 ${report.id} 증거 검토`} description="증거 예시, 이미지에서 관찰된 정보, 합성 예매 대조 결과를 나란히 확인합니다." />
    <Card className={styles.summary}>
      <div><span>대상 공연</span><strong>{event.name}</strong></div>
      <div><span>제보 유형</span><strong>{reportTypeLabels[report.reportType]}</strong></div>
      <div><span>접수 시각</span><strong><time dateTime={report.receivedAt}>{report.receivedAt.slice(0, 16).replace('T', ' ')}</time></strong></div>
      <div><span>검토 상태</span><StatusPill label={reviewLabels[report.reviewStatus]} tone={report.reviewStatus === 'NEEDS_MORE' ? 'warning' : report.reviewStatus === 'UNDER_REVIEW' ? 'info' : 'neutral'} /></div>
    </Card>
    <p className={styles.notice}>합성 데모 데이터입니다. 실제 팬 제보 접수, 이미지 분석, 예매처 조회, 관리자 인증은 연결되지 않았습니다.</p>
    <div className={styles.detailGrid}>
      <EvidenceViewer key={report.id} assets={evidence} />
      <ExtractionReviewPanel key={extraction.id} extraction={extraction} />
      <ReservationComparisonPanel comparison={comparison} />
    </div>
  </div>
}
