import { Link, useNavigate } from 'react-router-dom'
import { useFormContext, useWatch } from 'react-hook-form'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input, Select, Textarea } from '../../components/common/FormControls'
import { ReportStepper } from '../../components/fan/ReportStepper'
import { useFanReport } from './FanReportState'
import { EvidencePreview, formatFileSize } from './EvidencePreview'
import { demoEvent, evidencePolicy, reportTypes } from './reportModel'
import type { ReportDraft } from './reportModel'
import styles from './FanReport.module.css'

export function EvidenceAttachments() {
  const { evidence, fileError, addEvidence, removeEvidence } = useFanReport()
  return <Card className={styles.evidenceCard}>
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>자료 선택</span><h2>증거 자료 첨부</h2></div><span className={styles.count}>{evidence.length}/{evidencePolicy.maxFiles}</span></div>
    <p>관련 게시글이나 대화 화면 등 확인에 도움이 되는 자료가 있다면 첨부해 주세요. 실제 서버 업로드는 아직 지원하지 않습니다.</p>
    <div className={styles.filePicker}>
      <span aria-hidden="true" className={styles.fileSymbol}>＋</span>
      <label htmlFor="evidence-files" className={styles.fileLabel}>사진 선택하기</label>
      <input id="evidence-files" className={styles.fileInput} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple aria-describedby={fileError ? 'evidence-help evidence-error' : 'evidence-help'} onChange={(event) => { if (event.target.files) addEvidence(event.target.files); event.target.value = '' }} />
      <small id="evidence-help">JPEG·PNG, 최대 5개, 파일당 20MB</small>
    </div>
    {fileError && <p id="evidence-error" role="alert" className={styles.error}>{fileError}</p>}
    {evidence.length ? <ul className={styles.evidenceList}>{evidence.map((item) => <li key={item.id} className={styles.evidenceItem}>
      <div className={styles.preview}><EvidencePreview item={item} /></div>
      <div className={styles.fileMeta}><strong title={item.file.name}>{item.file.name}</strong><small>{formatFileSize(item.file.size)} · 브라우저에서 선택됨</small></div>
      <button type="button" className={styles.removeFile} onClick={() => removeEvidence(item.id)} aria-label={`${item.file.name} 제거`}>제거</button>
    </li>)}</ul> : <p className={styles.emptyFiles}>선택한 파일이 없습니다.</p>}
    <div className={styles.privacyNote}><strong>첨부 전 개인정보를 확인해 주세요</strong><p>민감한 정보는 직접 가린 뒤 선택해 주세요. 파일 이름과 형식 검사는 안전성을 보장하지 않습니다.</p></div>
  </Card>
}

export function WritePage() {
  const navigate = useNavigate()
  const { setReviewReady } = useFanReport()
  const { register, handleSubmit, control, formState: { errors } } = useFormContext<ReportDraft>()
  const selectedType = useWatch({ control, name: 'reportType' })

  function continueToReview() {
    setReviewReady(true)
    navigate('/fan/review')
  }

  return <div className={styles.page}>
    <div className={styles.pageHeading}><span className={styles.eyebrow}>팬 제보 · 2단계</span><h1>제보 내용 작성</h1><p>확인한 사실을 입력해 주세요. 관련 이미지가 있다면 함께 선택할 수 있습니다. 이 화면에서는 아직 제보가 접수되지 않습니다.</p></div>
    <ReportStepper currentStep={1} />
    <p className={styles.note}>입력 내용과 파일은 현재 탭의 메모리에만 유지됩니다. 새로고침하거나 탭을 닫으면 사라지며 자동 저장되지 않습니다.</p>
    <form noValidate onSubmit={handleSubmit(continueToReview)} onChange={() => setReviewReady(false)}>
      <div className={styles.formGrid}>
        <div className={styles.stack}>
          <Card><div className={styles.sectionHeading}><h2>대상 공연 정보</h2></div><div className={styles.fields}>
            <Select label="공연 선택" required error={errors.eventId?.message} {...register('eventId')}><option value="">공연을 선택해 주세요</option><option value={demoEvent.value}>{demoEvent.label}</option></Select>
            <p className={styles.fieldHint}>공연 목록 API 연결 전이므로 시연용 공연만 제공됩니다.</p>
            <Input label="공연 일시 또는 회차" type="datetime-local" required error={errors.performanceAt?.message} {...register('performanceAt')} />
            <Input label="좌석 구역·등급 (선택)" placeholder="알고 있다면 입력해 주세요" error={errors.seatArea?.message} {...register('seatArea')} />
          </div></Card>
          <Card><div className={styles.sectionHeading}><h2>제보 유형 및 상세 정황</h2></div><div className={styles.fields}>
            <fieldset className={styles.typeField} aria-invalid={!!errors.reportType || undefined} aria-describedby={errors.reportType ? 'report-type-error' : undefined}><legend>제보 유형 <span className={styles.asterisk}>*</span></legend><div className={styles.typeGrid}>{reportTypes.map((type) => <label key={type.value} className={styles.typeOption}><input type="radio" value={type.value} {...register('reportType')} /><span>{type.label}</span></label>)}</div>{errors.reportType && <p id="report-type-error" className={styles.error}>{errors.reportType.message}</p>}</fieldset>
            <Textarea label="의심 거래 설명" required rows={6} placeholder="언제, 어디에서, 어떤 거래 정황을 보셨는지 사실 중심으로 적어 주세요." maxLength={1000} error={errors.description?.message} {...register('description')} />
            <Input label="관련 URL (선택)" type="url" inputMode="url" placeholder="https://" error={errors.listingUrl?.message} {...register('listingUrl')} />
            <div className={styles.twoFields}><Input label="판매 플랫폼 (선택)" placeholder="알고 있다면 입력해 주세요" error={errors.platform?.message} {...register('platform')} /><Input label="판매자 표시명 (선택)" placeholder="알고 있다면 입력해 주세요" error={errors.seller?.message} {...register('seller')} /></div>
            {selectedType === 'PREMIUM_RESALE' && <Input label="제시된 판매 가격(원, 선택)" type="text" inputMode="numeric" placeholder="예: 450000" error={errors.askingPrice?.message} {...register('askingPrice')} />}
            <p className={styles.fieldHint}>플랫폼·판매자·가격은 확인된 경우에만 입력해 주세요. 입력만으로 판매자 신원이나 위법성이 확정되지 않습니다.</p>
          </div></Card>
        </div>
        <EvidenceAttachments />
      </div>
      <div className={styles.actions}><Button type="submit" size="large">다음 단계: 최종 확인</Button><Link className={styles.secondaryLink} to="/fan/guide">제보 안내로 돌아가기</Link></div>
    </form>
  </div>
}
