import { Link } from 'react-router-dom'
import { Card } from '../../components/common/Card'
import { demoReport } from './demoFixture'
import styles from './FanReport.module.css'

export function CompletePage() {
  return <div className={styles.page}><div className={styles.pageHeading}><h1>접수 완료</h1></div><Card className={styles.centerCard}><h2>아직 접수된 제보가 없습니다</h2><p>제보 접수 API가 연결되지 않아 이 화면에서 접수 성공이나 접수번호를 표시할 수 없습니다.</p><Link className={styles.primaryLink} to="/fan/guide">제보 안내로 이동</Link></Card></div>
}

export function StatusPage() {
  return <div className={styles.page}><div className={styles.pageHeading}><h1>내 제보 상태</h1><p>제보 상세 정보는 조회 인증을 거친 뒤에만 표시할 수 있습니다.</p></div><Card className={styles.centerCard}><h2>조회 인증이 필요합니다</h2><p>인증이 완료되기 전에는 특정 제보의 상태, 상세 내용, 이미지를 보여주지 않습니다. 현재 조회 인증 API도 연결되지 않았습니다.</p><Link className={styles.primaryLink} to="/fan/lookup">조회 인증 화면으로 이동</Link></Card></div>
}

export function DemoCompletePage() {
  return <div className={styles.page}><p className={styles.demoBanner}>개발 전용 · 합성 데모 데이터 · 실제 제보 접수 아님</p><Card className={styles.centerCard}><span className={styles.demoIcon} aria-hidden="true">✓</span><h1>접수 완료 화면 시연</h1><p>접수 완료 시 사용할 화면 구조를 보여주는 합성 예시입니다. 실제 접수나 파일 전송은 일어나지 않았습니다.</p><div className={styles.demoReference}><span>데모 식별자 · 실제 접수번호 아님</span><strong>{demoReport.reference}</strong><small>시연 기준: {demoReport.recordedAt}</small></div></Card><Card><h2>합성 제보 요약</h2><dl className={styles.summaryList}><div className={styles.summaryRow}><dt>대상 공연</dt><dd>{demoReport.event}</dd></div><div className={styles.summaryRow}><dt>공연 일시</dt><dd>{demoReport.performanceAt}</dd></div><div className={styles.summaryRow}><dt>제보 유형</dt><dd>{demoReport.type}</dd></div><div className={styles.summaryRow}><dt>첨부 자료</dt><dd>실제 선택한 파일 없음 · 화면 구조만 시연</dd></div></dl></Card><div className={styles.actions}><Link className={styles.primaryLink} to="/fan/demo/status">합성 상태 화면 보기</Link><Link className={styles.secondaryLink} to="/fan/guide">제보 안내로 돌아가기</Link></div></div>
}

export function DemoStatusPage() {
  return <div className={styles.page}><p className={styles.demoBanner}>개발 전용 · 합성 데모 데이터 · 실제 처리 현황 아님</p><div className={styles.pageHeading}><h1>제보 처리 현황 시연</h1><p>실제 제보자 정보나 조사 결과가 아닌 화면 예시입니다.</p></div><Card><div className={styles.demoReference}><span>데모 식별자 · 실제 접수번호 아님</span><strong>{demoReport.reference}</strong></div><dl className={styles.summaryList}><div className={styles.summaryRow}><dt>대상 공연</dt><dd>{demoReport.event}</dd></div><div className={styles.summaryRow}><dt>시연 기준</dt><dd>{demoReport.recordedAt}</dd></div></dl></Card><Card><h2>처리 단계 예시</h2><ol className={styles.timeline}><li><strong>화면 예시 시작</strong><span>합성 데이터로만 표시 중입니다.</span></li><li><strong>자료 확인 예시</strong><span>실제 담당자 배정이나 검토는 이뤄지지 않았습니다.</span></li><li><strong>사실관계 검토 예시</strong><span>제보 내용만으로 거래의 위법성을 판단하지 않습니다.</span></li><li><strong>추가 자료 요청 예시</strong><span>필요 여부와 방식은 아직 정해지지 않았습니다.</span></li><li><strong>결과 안내 예시</strong><span>처리 기간이나 결과를 보장하지 않습니다.</span></li></ol></Card><Link className={styles.secondaryLink} to="/fan/guide">제보 안내로 돌아가기</Link></div>
}
