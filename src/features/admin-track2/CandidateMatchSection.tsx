import { useEffect, useState } from 'react'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { applicabilityLabels, candidateHistoryPath, candidateReasonLabels, candidateRunPageSchema, candidateStatusLabels, candidateTone } from './candidatePipelineApi'
import type { CandidateRun } from './candidatePipelineApi'
import type { CandidateAttempt } from './candidateMatchRun'
import { StatusPill } from './StatusPill'
import { isLinkableCandidateRun } from './useCandidateRunSelection'
import type { CandidateRunSelection } from './useCandidateRunSelection'
import { formatUtc } from './track2Api'
import type { ListingAnalysis } from './track2Api'
import styles from './Track2.module.css'

// 이미지 분석 시도 1건에 대한 예매 후보 대조 실행과 실행 이력이다. 이미지 분석 실행과는 다른 작업이다.
// 관리자가 버튼을 누를 때만 실행하고 자동 실행, 자동 재시도는 하지 않는다. 이력 조회도 관리자가 열 때만 요청한다.
// 실행 결과는 사람이 조사할 후보이며 부정 거래 확정이 아니다. 과거 실행은 바꾸지 않고 서버의 적용 여부(applicability)만 따로 표시한다.
// candidateId는 서버 내부의 불투명한 참조이며 예매번호나 계정이 아니다. 예매번호 원문, HMAC 값, 계정 정보는 응답에 없고 화면도 만들지 않는다.
// 관리자는 종료되었고 CURRENT인 실행만 신규 Case 출처로 명시적으로 고를 수 있다. 선택은 Case를 만들지 않으며 Case 생성 영역에서 따로 요청한다.

type Props = {
  fanReportId: string
  evidenceId: string
  analysis: ListingAnalysis
  attempt: CandidateAttempt | undefined
  historyVersion: number
  onStart: () => void
  onReconfirm: () => void
  onRefreshHistory: () => void
  /** 신규 Case 출처 선택. 없으면 선택 기능을 표시하지 않는다. */
  selection?: CandidateRunSelection
}

export function CandidateMatchSection({ fanReportId, evidenceId, analysis, attempt, historyVersion, onStart, onReconfirm, onRefreshHistory, selection }: Props) {
  const [open, setOpen] = useState(false)
  const runnable = analysis.executionStatus === 'SUCCEEDED'
  const sending = attempt?.phase === 'sending'
  const pending = attempt?.phase === 'uncertain' || attempt?.phase === 'inProgress'
  const settled = attempt?.phase === 'succeeded' || attempt?.phase === 'rejected'
  // 시도가 있으면 이력을 함께 보여 준다. 실행 결과를 이력의 최신 항목으로 단정하지는 않는다.
  const showHistory = open || attempt !== undefined

  return <section className={styles.analysisRun} aria-label="예매 후보 대조">
    <div className={styles.panelHeading}><h4>예매 후보 대조</h4><span>분석 담당 또는 검토 담당</span></div>
    <p className={styles.subtleNote}>사람이 확인한 회차 연결과 이 분석의 구역, 열, 좌석 관찰값을 그 회차의 완전한 예매 스냅샷과 비교합니다. 이미지 분석 실행과는 별도 작업이며 결과는 조사 후보일 뿐 부정 거래 확정이 아닙니다.</p>
    <p className={styles.caution} role="note">좌석 번호가 관찰되지 않은 게시물(예: 좌석 번호 없는 2연석)은 정확한 예매 1건으로 승격하지 않습니다.</p>
    {!runnable && <p className={styles.previewUnavailable}>실행 완료(SUCCEEDED)된 분석만 후보 대조를 실행할 수 있습니다. 이 분석의 기존 후보 실행 이력은 조회할 수 있습니다.</p>}

    {attempt?.phase === 'sending' && <p className={styles.runStatus} role="status">후보 대조를 요청했습니다. 서버 응답을 기다리는 중입니다.</p>}
    {attempt?.phase === 'succeeded' && <div className={styles.runStatus} role="status">
      <strong>후보 실행 기록이 생성되었습니다</strong>
      <span className={styles.pillGroup}><span>실행 결과</span><StatusPill label={candidateStatusLabels[attempt.run.status]} tone={candidateTone(attempt.run.status)} /></span>
      <p>{candidateReasonLabels[attempt.run.reason]}. 실행 기록 생성은 부정 거래 확정이 아닙니다. 아래 후보 실행 이력에서 적용 여부와 함께 확인해 주세요.</p>
    </div>}
    {attempt?.phase === 'inProgress' && <div className={styles.runStatus} role="status">
      <strong>후보 대조가 아직 진행 중입니다</strong>
      <p>이 분석의 후보 대조가 서버에서 실행 중입니다. 잠시 후 같은 대조 요청 재확인으로 결과를 확인해 주세요. 후보 없음이나 실패로 확정하지 않습니다.</p>
    </div>}
    {(attempt?.phase === 'rejected' || attempt?.phase === 'uncertain') && <div className={styles.runAlert} role="alert">
      <strong>{attempt.phase === 'uncertain' ? `결과 미확인: ${attempt.message.title}` : attempt.message.title}</strong>
      <p>{attempt.message.description}</p>
    </div>}

    <div className={styles.previewActions}>
      {pending
        ? <Button size="small" onClick={onReconfirm}>같은 대조 요청 재확인</Button>
        : runnable && <Button size="small" loading={sending} disabled={sending} onClick={onStart}>{sending ? '후보 대조 요청 중' : settled ? '새 후보 대조 실행' : '예매 후보 대조 실행'}</Button>}
      {showHistory
        ? <Button size="small" variant="secondary" onClick={onRefreshHistory}>후보 실행 이력 다시 조회</Button>
        : <Button size="small" variant="secondary" onClick={() => setOpen(true)}>후보 실행 이력 보기</Button>}
    </div>
    {showHistory && <CandidateRunHistory key={historyVersion} fanReportId={fanReportId} evidenceId={evidenceId} analysisId={analysis.analysisId} selection={selection} />}
  </section>
}

function CandidateRunHistory({ fanReportId, evidenceId, analysisId, selection }: { fanReportId: string; evidenceId: string; analysisId: string; selection?: CandidateRunSelection }) {
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(candidateHistoryPath(fanReportId, evidenceId, analysisId, page), candidateRunPageSchema)
  // 검증을 통과한 이력만 선택 목록의 최신 상태로 반영한다. 다른 제보, 증거, 분석의 실행은 반영하지 않는다.
  const verifiedItems = result?.kind === 'success' && result.data.page === page
    && result.data.items.every((item) => item.fanReportId === fanReportId && item.evidenceId === evidenceId && item.analysisId === analysisId)
    ? result.data.items : null
  const sync = selection?.sync
  useEffect(() => { if (verifiedItems && sync) sync(verifiedItems) }, [verifiedItems, sync])
  const heading = <div className={styles.panelHeading}><h4>후보 실행 이력</h4><span>최신 실행 순, 과거 결과를 덮어쓰지 않음</span></div>
  if (result === null) return <section className={styles.history} aria-label="후보 실행 이력">{heading}<LoadingSkeleton label="후보 실행 이력을 불러오는 중" /></section>

  // 다른 분석이나 다른 증거의 실행, 요청과 다른 페이지가 섞이면 표시하지 않는다.
  const mismatched = result.kind === 'success' && (result.data.page !== page
    || result.data.items.some((item) => item.fanReportId !== fanReportId || item.evidenceId !== evidenceId || item.analysisId !== analysisId))
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = failure.kind === 'forbidden'
      ? { title: '후보 실행 이력에 필요한 역할이 없습니다', description: '후보 대조 실행과 이력은 분석 담당(ANALYST) 또는 검토 담당(REVIEWER)만 조회할 수 있습니다. 검증 회차와 회차 연결 영역은 역할에 따라 따로 동작합니다.' }
      : describeAdminApiFailure(failure, '분석 기록을 찾을 수 없거나 접근 범위 밖입니다')
    return <section className={styles.history} aria-label="후보 실행 이력">{heading}<ErrorState title={message.title} description={message.description} onRetry={retry} /></section>
  }

  const data = result.data
  return <section className={styles.history} aria-label="후보 실행 이력">
    {heading}
    {data.items.length === 0
      ? page === 0
        ? <EmptyState title="아직 후보 실행 이력이 없습니다" description="이 분석으로 후보 대조를 실행한 기록이 없습니다. 후보 없음(NO_MATCH) 결과와는 다른 상태입니다." />
        : <><EmptyState title="이 페이지에 표시할 후보 실행이 없습니다" description="요청한 페이지가 이력 범위를 벗어났습니다." /><Button variant="secondary" size="small" onClick={() => setPage(0)}>첫 페이지로 이동</Button></>
      : <ol className={styles.attempts}>{data.items.map((item) => <li key={item.runId}><CandidateRunItem run={item} selection={selection} /></li>)}</ol>}
    {(page > 0 || data.hasNext) && <nav className={styles.pagination} aria-label="후보 실행 이력 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 실행</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>다음 실행</Button></nav>}
  </section>
}

function statusNote(run: CandidateRun) {
  switch (run.status) {
    case 'MATCH_CANDIDATE': return '관찰한 좌석과 같은 예매 후보가 하나 있다는 조사 후보입니다. 일치 후보가 있는 좌석이라는 뜻일 뿐 실제 티켓 확인이나 판매자 소유권 확인이 아닙니다. 판매자, 동일인, 불법성, 부정 거래를 확정하지 않습니다.'
    case 'NO_MATCH': return '정상적이고 완전한 예매 스냅샷 조회가 성공했고 같은 좌석 후보가 없었다는 뜻입니다. 거래가 없었다는 확인은 아닙니다.'
    case 'AMBIGUOUS': return '같은 좌석 후보가 여럿이라 하나로 정하지 않았습니다. 일치 후보로 바꾸지 않습니다.'
    case 'UNVERIFIABLE': return '대조에 필요한 회차 연결, 예매 출처 또는 좌석 관찰값을 확인할 수 없어 대조하지 않았습니다. 후보 없음이 아닙니다.'
    case 'LOOKUP_FAILED': return '예매 후보 조회가 실패한 기록입니다. 후보 없음이 아닙니다.'
    case 'ANALYSIS_FAILED': return '이미지 분석 결과를 대조에 쓸 수 없는 기록입니다. 후보 없음이 아닙니다.'
    case 'IN_PROGRESS': return '아직 끝나지 않은 실행입니다. 결과로 판단하지 않습니다.'
  }
}

function CandidateRunItem({ run, selection }: { run: CandidateRun; selection?: CandidateRunSelection }) {
  const current = run.applicability === 'CURRENT'
  const selected = selection?.selected.some((item) => item.runId === run.runId) ?? false
  const linkable = isLinkableCandidateRun(run)
  return <article className={styles.attempt} aria-label={`후보 실행 ${formatUtc(run.createdAt)}`}>
    <div className={styles.attemptHeading}>
      <strong><time dateTime={run.createdAt}>{formatUtc(run.createdAt)}</time> 실행</strong>
      <span className={styles.pillGroup}>
        <span>실행 결과</span><StatusPill label={candidateStatusLabels[run.status]} tone={candidateTone(run.status)} />
        <span>적용 여부</span><StatusPill label={applicabilityLabels[run.applicability]} tone={current ? 'info' : 'neutral'} />
      </span>
    </div>
    <p className={styles.fieldNote}>{candidateReasonLabels[run.reason]} ({run.reason})</p>
    <p className={styles.caution}>{statusNote(run)}</p>
    {!current && <p className={styles.caution} role="note">이 실행 이후 기준이 바뀌었거나 적용 대상이 아니어서 현재 판단 근거로 쓰지 않습니다. 과거 실행 기록은 바꾸지 않았습니다.</p>}
    <dl className={styles.factList}>
      <div><dt>실행 ID</dt><dd className={styles.idCell}>{run.runId}</dd></div>
      <div><dt>후보 개수</dt><dd>{run.candidateCount === null ? '조회하지 않음' : `${run.candidateCount}건`}</dd></div>
      {run.candidateId !== null && <div><dt>내부 후보 참조 (예매번호 아님)</dt><dd className={styles.idCell}>{run.candidateId}</dd></div>}
      <div><dt>회차 연결 revision</dt><dd>{run.performanceLinkRevision ?? '기록 없음'}</dd></div>
      <div><dt>검증 회차 revision</dt><dd>{run.verifiedPerformanceRevision ?? '기록 없음'}</dd></div>
      <div><dt>예매 출처 버전</dt><dd className={styles.plainText}>{run.reservationSourceVersion ?? '기록 없음'}</dd></div>
      <div><dt>증거 SHA-256</dt><dd className={styles.idCell}>{run.evidenceSha256 ?? '기록 없음'}</dd></div>
      <div><dt>분석 응답 SHA-256</dt><dd className={styles.idCell}>{run.analysisResponseSha256 ?? '기록 없음'}</dd></div>
      <div><dt>완료 시각</dt><dd>{run.completedAt === null ? '완료되지 않음' : <time dateTime={run.completedAt}>{formatUtc(run.completedAt)}</time>}</dd></div>
    </dl>
    {selection && <div className={styles.previewActions}>
      {(linkable || selected) && <Button size="small" variant="secondary" aria-pressed={selected} disabled={selection.locked} onClick={() => selection.toggle(run)}>{selected ? '신규 Case 출처 선택 해제' : '신규 Case 출처로 선택'}</Button>}
      {!linkable && <span className={styles.subtleNote}>{run.status === 'IN_PROGRESS' ? '진행 중인 실행은 Case 출처로 선택할 수 없습니다.' : '현재 기준(CURRENT)이 아닌 실행은 이력으로만 표시하며 Case 출처로 선택할 수 없습니다.'}</span>}
    </div>}
  </article>
}
