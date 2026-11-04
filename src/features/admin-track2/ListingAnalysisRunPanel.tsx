import { Button } from '../../components/common/Button'
import { analysisEligibility } from './listingAnalysisRun'
import type { RunAttempt } from './listingAnalysisRun'
import { StatusPill } from './StatusPill'
import { analysisStatusLabels } from './track2Api'
import type { FanReportEvidence } from './track2Api'
import styles from './Track2.module.css'

// 선택한 증거 1건의 이미지 분석 실행 영역이다. 관리자가 버튼을 누를 때만 요청하며 자동 실행이나 자동 재시도는 하지 않는다.
// 요청 키는 화면에 표시하지 않는다. 결과는 사람이 확인할 관찰 후보이며 예매 후보 대조, Case 생성으로 이어지지 않는다.

type Props = {
  evidence: FanReportEvidence
  attempt: RunAttempt | undefined
  onStart: () => void
  onReconfirm: () => void
  onRefreshHistory: () => void
}

export function ListingAnalysisRunPanel({ evidence, attempt, onStart, onReconfirm, onRefreshHistory }: Props) {
  const eligibility = analysisEligibility(evidence)
  const sending = attempt?.phase === 'sending'
  // 결과가 확정된 뒤에만 새 키로 새 분석을 시작할 수 있다.
  const settled = attempt?.phase === 'succeeded' || attempt?.phase === 'failed' || attempt?.phase === 'rejected'
  const pending = attempt?.phase === 'uncertain' || attempt?.phase === 'inProgress'

  return <section className={styles.analysisRun} aria-label="이미지 분석 실행">
    <div className={styles.panelHeading}><h3>이미지 분석 실행</h3><span>JPEG, PNG 5 MiB 이하</span></div>
    {!eligibility.runnable && <p className={styles.previewUnavailable}>{eligibility.reason}</p>}
    {eligibility.runnable && attempt === undefined && <p className={styles.subtleNote}>버튼을 누를 때만 서버에 분석을 요청합니다. 결과는 사람의 확인이 필요한 관찰 후보이며 사실 확인이나 부정 거래 판정이 아닙니다.</p>}

    {attempt?.phase === 'sending' && <p className={styles.runStatus} role="status">분석을 요청했습니다. 서버 응답을 기다리는 중입니다. 화면을 떠나 요청이 취소되어도 서버 분석은 계속될 수 있습니다.</p>}
    {attempt?.phase === 'succeeded' && <div className={styles.runStatus} role="status">
      <strong>분석 요청이 끝났습니다</strong>
      <span className={styles.pillGroup}><span>결과 상태</span><StatusPill label={analysisStatusLabels[attempt.analysis.analysisStatus!]} tone={attempt.analysis.analysisStatus === 'COMPLETED' ? 'info' : 'warning'} /></span>
      <p>관찰값은 아래 분석 이력에서 확인해 주세요. 사람의 확인이 필요한 관찰 후보이며 사실 확인, 예매 일치, 부정 거래 판정이 아닙니다.</p>
    </div>}
    {attempt?.phase === 'inProgress' && <div className={styles.runStatus} role="status">
      <strong>분석이 아직 진행 중입니다</strong>
      <p>이 증거의 분석 시도가 서버에서 실행 중입니다. 잠시 후 같은 요청 재확인으로 결과를 확인해 주세요. 이 요청이 아직 기록되지 않았다면 재확인할 때 같은 요청 키로 실행될 수 있습니다.</p>
    </div>}
    {(attempt?.phase === 'failed' || attempt?.phase === 'rejected' || attempt?.phase === 'uncertain') && <div className={styles.runAlert} role="alert">
      <strong>{attempt.message.title}</strong>
      <p>{attempt.message.description}</p>
    </div>}

    <div className={styles.previewActions}>
      {pending
        ? <>
          <Button size="small" onClick={onReconfirm}>같은 요청 재확인</Button>
          <Button size="small" variant="secondary" onClick={onRefreshHistory}>분석 이력 다시 조회</Button>
        </>
        : <Button size="small" loading={sending} disabled={!eligibility.runnable} onClick={onStart}>{sending ? '분석 요청 중' : settled ? '새 분석 실행' : '이미지 분석 실행'}</Button>}
    </div>
  </section>
}
