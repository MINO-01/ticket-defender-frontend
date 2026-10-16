import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { ReportStepper } from '../../components/fan/ReportStepper'
import { useFormContext } from 'react-hook-form'
import { useFanReport } from './FanReportState'
import { EvidencePreview, formatFileSize } from './EvidencePreview'
import { demoEvent, reportTypes } from './reportModel'
import type { ReportDraft } from './reportModel'
import styles from './FanReport.module.css'

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className={styles.summaryRow}><dt>{label}</dt><dd>{value || '입력하지 않음'}</dd></div>
}

export function ReviewPage() {
  const { getValues } = useFormContext<ReportDraft>()
  const { evidence, reviewReady } = useFanReport()
  const draft = getValues()

  if (!reviewReady) return <div className={styles.page}><div className={styles.pageHeading}><h1>최종 확인</h1></div><ReportStepper currentStep={2} /><Card className={styles.centerCard}><h2>확인할 제보 내용이 없습니다</h2><p>작성 화면에서 필수 항목을 입력한 뒤 이동해 주세요. 새로고침하면 임시 입력이 초기화됩니다.</p><Link className={styles.primaryLink} to="/fan/write">제보 작성으로 이동</Link></Card></div>

  return <div className={styles.page}>
    <div className={styles.pageHeading}><span className={styles.eyebrow}>팬 제보 · 3단계</span><h1>최종 확인</h1><p>작성한 내용과 선택한 파일을 확인해 주세요. 실제 접수는 아직 지원하지 않습니다.</p></div>
    <ReportStepper currentStep={2} />
    <div className={styles.infoStrip}>수정할 내용이 있다면 작성 화면으로 돌아갈 수 있습니다. 입력값과 파일은 현재 탭에서만 유지됩니다.</div>
    <div className={styles.reviewGrid}>
      <div className={styles.stack}><Card><h2>제보 내용 요약</h2><dl className={styles.summaryList}>
        <SummaryRow label="대상 공연" value={draft.eventId === demoEvent.value ? demoEvent.label : draft.eventId} />
        <SummaryRow label="공연 일시" value={draft.performanceAt.replace('T', ' ')} />
        <SummaryRow label="좌석 정보" value={draft.seatArea} />
      </dl></Card><Card><h2>제보 상세 정보</h2><dl className={styles.summaryList}>
        <SummaryRow label="제보 유형" value={reportTypes.find((type) => type.value === draft.reportType)?.label ?? ''} />
        <SummaryRow label="상황 설명" value={draft.description} />
        <SummaryRow label="관련 URL" value={draft.listingUrl} />
        <SummaryRow label="판매 플랫폼" value={draft.platform} />
        <SummaryRow label="판매자 표시명" value={draft.seller} />
        {draft.reportType === 'PREMIUM_RESALE' && <SummaryRow label="제시된 가격" value={draft.askingPrice ? `${draft.askingPrice}원` : ''} />}
      </dl></Card></div>
      <div className={styles.stack}>
        <Card><h2>선택한 증거 이미지 <span className={styles.count}>{evidence.length}개</span></h2><p className={styles.reviewHint}>선택한 파일은 현재 브라우저에만 있으며 서버에 전송되지 않았습니다.</p>{evidence.length ? <ul className={styles.reviewFiles}>{evidence.map((item) => <li key={item.id}><div className={styles.preview}><EvidencePreview item={item} /></div><span>{item.file.name}<small>{formatFileSize(item.file.size)}</small></span></li>)}</ul> : <p className={styles.emptyFiles}>선택한 파일이 없습니다. 관련 자료가 있다면 작성 화면에서 첨부할 수 있습니다.</p>}</Card>
        <Card className={styles.privacyCard}><h2>제출 전 확인 사항</h2><ul className={styles.list}><li>확인한 사실과 추측을 구분해 작성했는지 확인해 주세요.</li><li>첨부 이미지의 불필요한 개인정보를 직접 가렸는지 확인해 주세요.</li><li>제보만으로 거래의 위법성이나 판매자 신원은 확정되지 않습니다.</li></ul></Card>
      </div>
    </div>
    <div className={styles.actions}><Link className={styles.secondaryLink} to="/fan/write">내용 수정하기</Link><Button size="large" disabled>제보 제출 준비 중</Button></div>
    <p className={styles.footnote}>접수 API가 연결되지 않아 제출할 수 없습니다. 접수번호나 접수 완료 상태는 생성되지 않습니다.</p>
  </div>
}
