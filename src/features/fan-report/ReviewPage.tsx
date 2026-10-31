import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { ReportStepper } from '../../components/fan/ReportStepper'
import { useFormContext } from 'react-hook-form'
import { useFanReport } from './FanReportState'
import { EvidencePreview, formatFileSize } from './EvidencePreview'
import { demoEvent, reportTypes } from './reportModel'
import type { ReportDraft } from './reportModel'
import { getIntakeEvent } from './intakeConfig'
import styles from './FanReport.module.css'

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className={styles.summaryRow}><dt>{label}</dt><dd>{value || '입력하지 않음'}</dd></div>
}

export function ReviewPage() {
  const navigate = useNavigate()
  const { getValues } = useFormContext<ReportDraft>()
  const { evidence, reviewReady, submission, pendingRequest, submitReport } = useFanReport()
  const intakeEvent = getIntakeEvent()
  // 결과가 불확실한 이전 시도가 있으면 처음 제출한 스냅샷을 보여주고 그대로 재전송한다.
  const pending = pendingRequest?.report
  const draft = getValues()
  const shown = pending
    ? { eventId: pending.eventId, performanceAt: pending.performanceAt, seatArea: pending.seatArea ?? '', reportType: pending.reportType, description: pending.description, listingUrl: pending.listingUrl ?? '', platform: pending.platform ?? '', seller: pending.seller ?? '', askingPrice: pending.askingPrice ?? '' }
    : draft
  const files = pendingRequest ? pendingRequest.evidence.map((file, index) => ({ key: `pending-${index}`, file, item: evidence.find((candidate) => candidate.file === file) })) : evidence.map((item) => ({ key: `item-${item.id}`, file: item.file, item }))
  const eventLabel = intakeEvent && shown.eventId === intakeEvent.eventId ? intakeEvent.label : shown.eventId === demoEvent.value ? demoEvent.label : shown.eventId
  const submitting = submission.phase === 'submitting'
  const failure = submission.phase === 'failed' ? submission.failure : null
  const submittable = !!intakeEvent && shown.eventId === intakeEvent.eventId && failure?.category !== 'blocked'

  if (!reviewReady && !pendingRequest) return <div className={styles.page}><div className={styles.pageHeading}><h1>최종 확인</h1></div><ReportStepper currentStep={2} /><Card className={styles.centerCard}><h2>확인할 제보 내용이 없습니다</h2><p>작성 화면에서 필수 항목을 입력한 뒤 이동해 주세요. 새로고침하면 임시 입력이 초기화됩니다.</p><Link className={styles.primaryLink} to="/fan/write">제보 작성으로 이동</Link></Card></div>

  async function handleSubmit() {
    if (await submitReport()) navigate('/fan/complete')
  }

  const buttonLabel = submitting ? '제출 중' : pendingRequest ? '같은 내용으로 다시 시도' : intakeEvent ? '제보 제출하기' : '실제 접수 미설정'

  return <div className={styles.page}>
    <div className={styles.pageHeading}><span className={styles.eyebrow}>팬 제보 3단계</span><h1>최종 확인</h1><p>작성한 내용과 선택한 파일을 확인해 주세요. 제출하면 입력 내용과 이미지가 서버로 전송됩니다.</p></div>
    <ReportStepper currentStep={2} />
    <div className={styles.infoStrip}>{pendingRequest ? '이전 제출의 결과를 확인하지 못해 처음 제출한 내용 그대로 다시 시도합니다. 수정한 내용은 반영되지 않습니다.' : '수정할 내용이 있다면 작성 화면으로 돌아갈 수 있습니다. 입력값과 파일은 현재 탭에서만 유지됩니다.'}</div>
    <div className={styles.reviewGrid}>
      <div className={styles.stack}><Card><h2>제보 내용 요약</h2><dl className={styles.summaryList}>
        <SummaryRow label="대상 공연" value={eventLabel} />
        <SummaryRow label="공연 일시" value={shown.performanceAt.replace('T', ' ')} />
        <SummaryRow label="좌석 정보" value={shown.seatArea} />
      </dl></Card><Card><h2>제보 상세 정보</h2><dl className={styles.summaryList}>
        <SummaryRow label="제보 유형" value={reportTypes.find((type) => type.value === shown.reportType)?.label ?? ''} />
        <SummaryRow label="상황 설명" value={shown.description} />
        <SummaryRow label="관련 URL" value={shown.listingUrl} />
        <SummaryRow label="판매 플랫폼" value={shown.platform} />
        <SummaryRow label="판매자 표시명" value={shown.seller} />
        {shown.reportType === 'PREMIUM_RESALE' && <SummaryRow label="제시된 가격" value={shown.askingPrice ? `${shown.askingPrice}원` : ''} />}
      </dl></Card></div>
      <div className={styles.stack}>
        <Card><h2>선택한 증거 이미지 <span className={styles.count}>{files.length}개</span></h2><p className={styles.reviewHint}>선택한 파일은 제출할 때 아래 순서대로 서버에 전송됩니다.</p>{files.length ? <ul className={styles.reviewFiles}>{files.map(({ key, file, item }) => <li key={key}><div className={styles.preview}>{item && <EvidencePreview item={item} />}</div><span>{file.name}<small>{formatFileSize(file.size)}</small></span></li>)}</ul> : <p className={styles.emptyFiles}>선택한 파일이 없습니다. 관련 자료가 있다면 작성 화면에서 첨부할 수 있습니다.</p>}</Card>
        <Card className={styles.privacyCard}><h2>제출 전 확인 사항</h2><ul className={styles.list}><li>확인한 사실과 추측을 구분해 작성했는지 확인해 주세요.</li><li>첨부 이미지의 불필요한 개인정보를 직접 가렸는지 확인해 주세요.</li><li>제보만으로 거래의 위법성이나 판매자 신원은 확정되지 않습니다.</li></ul></Card>
      </div>
    </div>
    {submitting && <p role="status" className={styles.infoStrip}>제보를 제출하고 있습니다. 창을 닫거나 새로고침하지 말아 주세요.</p>}
    {failure && <div role="alert" className={styles.privacyNote}><strong>{failure.title}</strong><p>{failure.description}</p></div>}
    <div className={styles.actions}>{!pendingRequest && <Link className={styles.secondaryLink} to="/fan/write">내용 수정하기</Link>}<Button size="large" loading={submitting} disabled={!submittable} onClick={handleSubmit}>{buttonLabel}</Button></div>
    <p className={styles.footnote}>{intakeEvent ? '접수번호와 조회 코드는 서버가 접수를 확인한 뒤에만 표시됩니다.' : '실제 접수 가능한 공연이 설정되지 않은 환경이라 제출할 수 없습니다. 접수번호나 접수 완료 상태는 생성되지 않습니다.'}</p>
  </div>
}
