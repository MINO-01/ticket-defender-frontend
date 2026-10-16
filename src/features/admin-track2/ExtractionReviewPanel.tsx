import { useState } from 'react'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState } from '../../components/common/Feedback'
import { StatusPill } from './StatusPill'
import { extractionLabels, fieldLabels, observationLabels } from './track2Model'
import type { Extraction, FieldKey } from './track2Model'
import styles from './Track2.module.css'

export function ExtractionReviewPanel({ extraction }: { extraction: Extraction }) {
  const [draft, setDraft] = useState<Record<FieldKey, string>>({ EVENT_NAME: '', PERFORMANCE_AT: '', SECTION: '', ROW: '', SEAT: '' })
  return <Card className={styles.panel}>
    <div className={styles.panelHeading}><h2>이미지 정보 추출 검토</h2><StatusPill label={extractionLabels[extraction.status]} tone={extraction.status === 'COMPLETED' ? 'success' : extraction.status === 'FAILED' ? 'critical' : 'neutral'} /></div>
    <p className={styles.panelIntro}>원본 관찰값과 분석관의 수정 초안을 분리해 표시합니다.</p>
    {extraction.status === 'FAILED' ? <ErrorState title="합성 추출 실패" description={extraction.reason ?? '이미지에서 정보를 읽지 못했습니다.'} /> :
      extraction.status === 'QUEUED' ? <EmptyState title="추출 결과가 없습니다" description={extraction.reason ?? '아직 표시할 관찰값이 없습니다.'} /> :
        <div className={styles.fields}>{extraction.fields.map((field) => <section key={field.key} className={styles.fieldCard}>
          <div className={styles.fieldHeading}><h3>{fieldLabels[field.key]}</h3><StatusPill label={observationLabels[field.status]} tone={field.status === 'VISIBLE' ? 'success' : field.status === 'UNREADABLE' ? 'critical' : 'warning'} /></div>
          <p className={styles.original}><span>원본 관찰값</span><strong>{field.value ?? '확인된 값 없음'}</strong></p>
          {field.note && <p className={styles.fieldNote}>{field.note}</p>}
          <label>분석관 수정 초안<input value={draft[field.key]} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} placeholder="필요한 경우에만 입력" /></label>
        </section>)}</div>}
    <p className={styles.subtleNote}>수정 초안은 이 화면의 브라우저 메모리에만 남습니다. 원본 추출값을 바꾸거나 서버에 저장하지 않습니다. 수정 초안은 현재 예매 대조 결과에 반영되지 않으며, 실제 재검증은 수행되지 않았습니다.</p>
  </Card>
}
