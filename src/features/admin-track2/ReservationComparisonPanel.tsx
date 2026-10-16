import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { StatusPill } from './StatusPill'
import { comparisonLabels } from './track2Model'
import type { Comparison } from './track2Model'
import styles from './Track2.module.css'

const checkLabels = { MATCH: '표시 정보 일치', MISMATCH: '대조값 불일치', UNKNOWN: '확인 불가' } as const

export function ReservationComparisonPanel({ comparison }: { comparison: Comparison }) {
  return <Card className={styles.panel}>
    <div className={styles.panelHeading}><h2>예매 정보 대조</h2><StatusPill label={comparisonLabels[comparison.status]} tone={comparison.status === 'MATCH_CANDIDATE' ? 'info' : comparison.status === 'NO_MATCH' ? 'warning' : 'neutral'} /></div>
    <p className={styles.panelIntro}>{comparison.reason}</p>
    {comparison.reservationId && <div className={styles.candidate}><span>합성 예매 후보</span><strong>{comparison.reservationId}</strong></div>}
    {comparison.checks.length > 0 ? <div className={styles.checks}>{comparison.checks.map((check) => <div key={check.label} className={styles.checkRow}>
      <strong>{check.label}</strong><StatusPill label={checkLabels[check.result]} tone={check.result === 'MATCH' ? 'success' : check.result === 'MISMATCH' ? 'warning' : 'neutral'} />
      <span>증거 관찰: {check.observation}</span><span>대조 자료: {check.reference}</span>
    </div>)}</div> : <p className={styles.subtleNote}>대조한 항목이 없습니다.</p>}
    <section className={styles.unknowns}><h3>아직 확인되지 않은 점</h3><ul>{comparison.unknowns.map((item) => <li key={item}>{item}</li>)}</ul></section>
    <p className={styles.caution}>일치 후보는 동일인, 실제 판매 또는 위법성의 확정 근거가 아닙니다.</p>
    <div className={styles.caseAction}><Button disabled>Case 생성·연결</Button><p>Case API와 관리자 인가가 연결되지 않아 사용할 수 없습니다.</p></div>
  </Card>
}
