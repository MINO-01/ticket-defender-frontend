import type { ReactNode } from 'react'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Card } from '../../components/common/Card'
import { ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { formatLedgerSeat, ledgerSeatStatusLabels, ledgerSeatTone } from '../admin-track1/track1Api'
import { StatusPill } from '../admin-track2/StatusPill'
import { evidenceLinkMessages, evidenceLinkTone, evidenceLinkViewSchema, track1CandidateLinksPath } from './track1CandidateLinkApi'
import type { EvidenceLink } from './track1CandidateLinkApi'
import styles from './Cases.module.css'

// Case에 연결된 Track 1 군집과 Track 2 후보 실행의 수렴 조회 영역이다. 서버 상태를 그대로 표시하고 미연결을 정상 0건으로 바꾸지 않는다.
// Case 생성 이후의 현재 조회이므로 생성 전 연결 여부로 표시하지 않는다. 결과는 승인이나 공식 PDF 적격성 판단에 쓰지 않는다.

export function Track1CandidateLinkPanel({ caseId, refreshKey }: { caseId: string; refreshKey: number }) {
  const { result, retry } = useAdminQuery(track1CandidateLinksPath(caseId), evidenceLinkViewSchema, refreshKey)
  let content: ReactNode
  if (result === null) content = <LoadingSkeleton label="Track 1 연결 비교를 불러오는 중" />
  else if (result.kind !== 'success') {
    const message = describeAdminApiFailure(result, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else {
    const { status, items } = result.data
    content = <>
      <div className={styles.created} role="status">
        <StatusPill label={status} tone={evidenceLinkTone(status)} />
        <p>{evidenceLinkMessages[status]}</p>
      </div>
      {items.length === 0
        ? <p className={styles.caution}>서버가 돌려준 비교 항목이 없습니다. 연결 기록이 정상적으로 0건이라는 뜻이 아닙니다.</p>
        : <div className={styles.sourceList}>{items.map((item) => <LinkItem key={`${item.graphSourceId}:${item.candidateSourceId}`} item={item} />)}</div>}
    </>
  }
  return <Card className={styles.panel} aria-label="Track 1 연결 비교">
    <div className={styles.panelHeading}><h2>Track 1 연결 비교</h2><span>Case 생성 이후 조회</span></div>
    <p className={styles.caution} role="note">이미 생성된 이 사건의 출처만 현재 시점으로 비교한 결과입니다. Case 생성 이전의 연결 여부를 확인한 것이 아닙니다. 부정 거래, 티켓 진위, 판매자 소유권 확인이 아니며 승인 근거나 공식 PDF 발급 가능 여부를 바꾸지 않습니다.</p>
    {content}
  </Card>
}

function LinkItem({ item }: { item: EvidenceLink }) {
  return <article className={styles.source} aria-label={`연결 비교 ${item.candidateRunId}`}>
    <StatusPill label={item.status} tone={evidenceLinkTone(item.status)} />
    <p>{evidenceLinkMessages[item.status]}</p>
    <dl className={styles.definition}>
      <div><dt>Track 1 출처 참조 ID</dt><dd className={styles.idCell}>{item.graphSourceId}</dd></div>
      <div><dt>후보 출처 참조 ID</dt><dd className={styles.idCell}>{item.candidateSourceId}</dd></div>
      <div><dt>후보 실행 ID</dt><dd className={styles.idCell}>{item.candidateRunId}</dd></div>
      <div><dt>연결 근거</dt><dd>{item.linkBasis === undefined ? '서버 미제공' : '예매 참조 일치 (RESERVATION_REFERENCE)'}</dd></div>
    </dl>
    {item.linkBasis !== undefined && <p className={styles.caution}>예매 참조가 일치한다는 뜻입니다. 티켓 단위 동일성, 소유권, 진위, 부정 거래나 승인 근거가 아닙니다.</p>}
    {item.ledgerSeats.length === 0
      ? <p className={styles.caution}>서버가 돌려준 원장 좌석이 없습니다.</p>
      : <ul className={styles.checkList} aria-label="구성원별 원장 좌석">{item.ledgerSeats.map((seat) => <li key={seat.auditId}>
        <span>저장 기록 {seat.auditId}</span>
        <StatusPill label={ledgerSeatStatusLabels[seat.status]} tone={ledgerSeatTone(seat.status)} />
        <span>{formatLedgerSeat(seat)}</span>
      </li>)}</ul>}
  </article>
}
