import { Link } from 'react-router-dom'
import { Card } from '../../components/common/Card'
import { FanIcon } from '../../components/fan/FanIcon'
import { ReportStepper } from '../../components/fan/ReportStepper'
import { getIntakeEvent } from './intakeConfig'
import styles from './FanReport.module.css'

const reportExamples = [
  { title: '고액 재판매 정황', detail: '정가보다 높은 가격을 요구하는 판매 게시글이나 대화' },
  { title: '매크로·대리 예매 제안', detail: '자동 예매 프로그램이나 대리 예매를 제안하는 정황' },
  { title: '위조 티켓·결제 사기 의심', detail: '확인하기 어려운 티켓이나 외부 결제를 유도하는 정황' },
]

export function GuidePage() {
  const intakeEnabled = getIntakeEvent() !== null
  return <div className={styles.page}>
    <section className={styles.hero}>
      <span className={styles.eyebrow}>팬 제보 안내</span>
      <h1>제보 안내</h1>
      <p>의심스러운 티켓 거래를 발견했다면, 확인한 사실과 관련 자료를 정리해 주세요.</p>
      <div className={styles.heroNotice}><FanIcon name="info" /><span>제출된 자료는 사실관계 확인이 필요합니다. 제보만으로 위반 여부가 확정되지는 않습니다. {intakeEnabled ? '최종 확인 화면에서 제출하면 서버에 접수됩니다.' : '현재 환경은 실제 접수가 설정되지 않아 제출할 수 없습니다.'}</span></div>
    </section>
    <div className={styles.guideGrid}>
      <div className={styles.stack}>
        <ReportStepper currentStep={0} />
        <Card><h2>제보 가능한 주요 유형</h2><div className={styles.typeList}>{reportExamples.map((item) => <div className={styles.tinted} key={item.title}><span className={styles.typeIcon}><FanIcon name="guide" /></span><div><strong>{item.title}</strong><p>{item.detail}</p></div></div>)}</div></Card>
      </div>
      <div className={styles.stack}>
        <Card><h2><FanIcon name="evidence" /> 준비해 주실 자료</h2><ul className={styles.list}><li>판매 게시글 화면이나 링크</li><li>가격과 거래 방식을 확인할 수 있는 대화 화면</li><li>공연 일시와 좌석 등 확인 가능한 정보</li></ul><p className={styles.note}>확인에 도움이 되는 이미지가 있다면 첨부해 주세요. JPEG 또는 PNG, 최대 5개, 파일당 20MB까지 선택할 수 있습니다. 선택한 파일은 제출할 때만 서버로 전송되며, 서버에서 형식을 다시 검사합니다.</p></Card>
        <Card className={styles.privacyCard}><h2>개인정보를 가려 주세요</h2><p>이름, 연락처, 계좌번호, 주민등록번호, 카드번호 등 불필요한 민감 정보는 직접 가린 뒤 첨부해 주세요. 이 화면은 자동으로 가림 처리하지 않습니다.</p></Card>
      </div>
    </div>
    <div className={styles.actions}><Link className={styles.primaryLink} to="/fan/write">제보 작성 시작 <span aria-hidden="true">→</span></Link><Link className={styles.secondaryLink} to="/fan/lookup">기존 제보 조회</Link></div>
    <p className={styles.footnote}>{intakeEnabled ? '접수가 완료되면 접수번호와 조회 코드가 표시됩니다. 작성 중인 내용은 새로고침하면 사라집니다.' : '현재 환경은 실제 접수 공연이 설정되지 않아 제출할 수 없습니다. 작성한 내용은 새로고침하면 사라집니다.'}</p>
  </div>
}
