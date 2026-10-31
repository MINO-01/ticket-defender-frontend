import { Link } from 'react-router-dom'
import { Card } from '../../components/common/Card'
import { demoReport } from './demoFixture'
import { useFanReport } from './FanReportState'
import { intakeStatusLabels } from './submission'
import styles from './FanReport.module.css'

/** 서버가 반환한 UTC 시각을 한국 시간으로 표시한다. */
function formatReceivedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
}

export function CompletePage() {
  const { receipt } = useFanReport()
  if (!receipt) return <div className={styles.page}><div className={styles.pageHeading}><h1>접수 완료</h1></div><Card className={styles.centerCard}><h2>아직 접수된 제보가 없습니다</h2><p>서버에서 접수가 확인된 경우에만 접수번호를 표시합니다. 새로고침하거나 탭을 닫은 뒤에는 이전 접수 결과를 이 화면에서 다시 보여줄 수 없습니다.</p><Link className={styles.primaryLink} to="/fan/guide">제보 안내로 이동</Link></Card></div>

  const { receipt: value, recovered } = receipt
  return <div className={styles.page}>
    <Card className={styles.centerCard}>
      <span className={styles.demoIcon} aria-hidden="true">✓</span>
      <h1>{recovered ? '기존 접수를 확인했습니다' : '제보가 접수되었습니다'}</h1>
      <p>{recovered ? '이전 제출이 이미 접수되어 같은 접수 정보를 다시 받았습니다. 중복 접수되지 않았습니다.' : '서버가 제보 접수를 확인했습니다. 접수는 사실관계 확인의 시작이며 위반 여부를 확정하지 않습니다.'}</p>
      <dl className={styles.summaryList}>
        <div className={styles.summaryRow}><dt>접수번호</dt><dd><strong>{value.receiptNumber}</strong></dd></div>
        <div className={styles.summaryRow}><dt>조회 코드</dt><dd><strong>{value.lookupCode}</strong></dd></div>
        <div className={styles.summaryRow}><dt>접수 상태</dt><dd>{intakeStatusLabels[value.intakeStatus]}</dd></div>
        <div className={styles.summaryRow}><dt>접수 시각</dt><dd>{formatReceivedAt(value.receivedAt)}</dd></div>
      </dl>
    </Card>
    <Card className={styles.privacyCard}><h2>접수번호와 조회 코드를 안전하게 보관해 주세요</h2><ul className={styles.list}><li>조회 코드는 이 화면에서만 확인할 수 있으며 다시 발급되지 않습니다.</li><li>이 정보는 브라우저에 저장되지 않으므로 화면을 벗어나기 전에 따로 기록해 주세요.</li><li>조회 코드는 다른 사람과 공유하지 마세요.</li></ul></Card>
    <div className={styles.actions}><Link className={styles.primaryLink} to="/fan/lookup">접수 상태 조회하기</Link><Link className={styles.secondaryLink} to="/fan/guide">제보 안내로 돌아가기</Link></div>
  </div>
}

export function StatusPage() {
  const { lookupResult } = useFanReport()
  if (!lookupResult) return <div className={styles.page}><div className={styles.pageHeading}><h1>내 제보 상태</h1><p>제보 상태는 조회 인증을 거친 뒤에만 표시할 수 있습니다.</p></div><Card className={styles.centerCard}><h2>조회 인증이 필요합니다</h2><p>인증이 완료되기 전에는 특정 제보의 상태를 보여주지 않습니다.</p><Link className={styles.primaryLink} to="/fan/lookup">조회 인증 화면으로 이동</Link></Card></div>

  return <div className={styles.page}>
    <div className={styles.pageHeading}><h1>내 제보 상태</h1><p>서버가 확인한 접수 상태와 접수 시각만 표시합니다.</p></div>
    <Card><dl className={styles.summaryList}>
      <div className={styles.summaryRow}><dt>접수 상태</dt><dd>{intakeStatusLabels[lookupResult.intakeStatus]}</dd></div>
      <div className={styles.summaryRow}><dt>접수 시각</dt><dd>{formatReceivedAt(lookupResult.receivedAt)}</dd></div>
    </dl></Card>
    <p className={styles.note}>이 화면은 접수 처리 상태만 안내하며 조사 결과나 위반 여부를 나타내지 않습니다.</p>
    <Link className={styles.secondaryLink} to="/fan/lookup">다시 조회하기</Link>
  </div>
}

export function DemoCompletePage() {
  return <div className={styles.page}><p className={styles.demoBanner}>개발 전용 · 합성 데모 데이터 · 실제 제보 접수 아님</p><Card className={styles.centerCard}><span className={styles.demoIcon} aria-hidden="true">✓</span><h1>접수 완료 화면 시연</h1><p>접수 완료 시 사용할 화면 구조를 보여주는 합성 예시입니다. 실제 접수나 파일 전송은 일어나지 않았습니다.</p><div className={styles.demoReference}><span>데모 식별자 · 실제 접수번호 아님</span><strong>{demoReport.reference}</strong><small>시연 기준: {demoReport.recordedAt}</small></div></Card><Card><h2>합성 제보 요약</h2><dl className={styles.summaryList}><div className={styles.summaryRow}><dt>대상 공연</dt><dd>{demoReport.event}</dd></div><div className={styles.summaryRow}><dt>공연 일시</dt><dd>{demoReport.performanceAt}</dd></div><div className={styles.summaryRow}><dt>제보 유형</dt><dd>{demoReport.type}</dd></div><div className={styles.summaryRow}><dt>첨부 자료</dt><dd>실제 선택한 파일 없음 · 화면 구조만 시연</dd></div></dl></Card><div className={styles.actions}><Link className={styles.primaryLink} to="/fan/demo/status">합성 상태 화면 보기</Link><Link className={styles.secondaryLink} to="/fan/guide">제보 안내로 돌아가기</Link></div></div>
}

export function DemoStatusPage() {
  return <div className={styles.page}><p className={styles.demoBanner}>개발 전용 · 합성 데모 데이터 · 실제 처리 현황 아님</p><div className={styles.pageHeading}><h1>제보 처리 현황 시연</h1><p>실제 제보자 정보나 조사 결과가 아닌 화면 예시입니다.</p></div><Card><div className={styles.demoReference}><span>데모 식별자 · 실제 접수번호 아님</span><strong>{demoReport.reference}</strong></div><dl className={styles.summaryList}><div className={styles.summaryRow}><dt>대상 공연</dt><dd>{demoReport.event}</dd></div><div className={styles.summaryRow}><dt>시연 기준</dt><dd>{demoReport.recordedAt}</dd></div></dl></Card><Card><h2>처리 단계 예시</h2><ol className={styles.timeline}><li><strong>화면 예시 시작</strong><span>합성 데이터로만 표시 중입니다.</span></li><li><strong>자료 확인 예시</strong><span>실제 담당자 배정이나 검토는 이뤄지지 않았습니다.</span></li><li><strong>사실관계 검토 예시</strong><span>제보 내용만으로 거래의 위법성을 판단하지 않습니다.</span></li><li><strong>추가 자료 요청 예시</strong><span>필요 여부와 방식은 아직 정해지지 않았습니다.</span></li><li><strong>결과 안내 예시</strong><span>처리 기간이나 결과를 보장하지 않습니다.</span></li></ol></Card><Link className={styles.secondaryLink} to="/fan/guide">제보 안내로 돌아가기</Link></div>
}
