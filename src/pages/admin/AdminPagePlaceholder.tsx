import { Card } from '../../components/common/Card'
import { PageHeader } from '../../components/common/PageHeader'
import styles from './AdminPagePlaceholder.module.css'

type AdminPagePlaceholderProps = { title: string; description: string; reportCenter?: boolean }

export function AdminPagePlaceholder({ title, description, reportCenter = false }: AdminPagePlaceholderProps) {
  return <div className={styles.page}>
    <PageHeader eyebrow="관리자" title={title} description={description} />
    <Card className={styles.panel}>
      <div className={styles.icon} aria-hidden="true">{reportCenter ? '□' : '○'}</div>
      <div><p className={styles.kicker}>화면 준비 중</p><h2>{reportCenter ? '공식 PDF 발급은 비활성화되어 있습니다' : '업무 기능은 다음 단계에서 연결됩니다'}</h2><p>{reportCenter ? '발급 및 다운로드 동작은 제공하지 않습니다.' : '현재는 공통 레이아웃과 화면 이동만 확인할 수 있습니다. 실제 데이터와 권한 확인은 연결되지 않았습니다.'}</p></div>
    </Card>
  </div>
}
