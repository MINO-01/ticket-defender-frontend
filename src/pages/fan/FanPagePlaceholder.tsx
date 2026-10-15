import { Link } from 'react-router-dom'
import { ReportStepper } from '../../components/fan/ReportStepper'
import { Card } from '../../components/common/Card'
import { PageHeader } from '../../components/common/PageHeader'
import styles from './FanPagePlaceholder.module.css'

type FanPagePlaceholderProps = { title: string; description: string; step: number | null }

export function FanPagePlaceholder({ title, description, step }: FanPagePlaceholderProps) {
  const isLookup = step === null
  return <div className={styles.page}>
    {step !== null && <ReportStepper currentStep={step} />}
    <PageHeader eyebrow="팬 제보" title={title} description={description} />
    <Card className={styles.card}>
      <span className={styles.symbol} aria-hidden="true">{isLookup ? '⌕' : '✳'}</span>
      <h2>{isLookup ? '조회 인증 기능을 준비하고 있습니다' : '제보 화면을 준비하고 있습니다'}</h2>
      <p>{isLookup ? '인증이 완료되기 전에는 특정 제보의 상태, 상세 내용, 이미지를 보여주지 않습니다.' : '현재는 제보 절차의 화면 이동만 확인할 수 있습니다. 작성, 업로드, 제출은 아직 사용할 수 없습니다.'}</p>
      {step === 0 && <Link to="/fan/write" className={styles.link}>작성 화면 살펴보기 <span aria-hidden="true">→</span></Link>}
    </Card>
    <p className={styles.notice}>이 화면에서는 실제 제보가 접수되거나 조회되지 않습니다.</p>
  </div>
}
