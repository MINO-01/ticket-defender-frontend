import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input } from '../../components/common/FormControls'
import { PageHeader } from '../../components/common/PageHeader'
import styles from '../admin-cases/Cases.module.css'
import { officialPdfDecisionRoute, readDecisionId } from './officialPdfApi'

// 인증 세션의 보고서 센터 진입 화면이다. Backend에 승인 결정 조회 API와 결정 목록 API가 없어 목록을 만들지 않고 승인 결정 ID로만 발급 화면을 연다.
// 결정 ID는 비밀값이 아니며 접근 범위와 권한은 서버가 확인한다. 입력값은 저장하지 않는다.

export function LiveReportCenterEntryPage() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const onOpen = () => {
    const decisionId = readDecisionId(value)
    if (decisionId === null) { setError('승인 결정 ID를 UUID 형식으로 입력해 주세요.'); return }
    setError(null)
    navigate(officialPdfDecisionRoute(decisionId))
  }
  return <div className={styles.page}>
    <PageHeader eyebrow="검토" title="조사 보고서 발급" description="승인 결정 ID로 서버의 공식 보고서 PDF 발급 가능 여부, 발급 기록, 다운로드 화면을 엽니다. 승인되지 않은 보고서는 발급할 수 없습니다." />
    <Card className={styles.panel} aria-label="승인 결정 ID 입력">
      <p className={styles.blocked} role="note">승인 결정을 조회하는 API가 없어 이 화면은 실제 발급 대기열이 아닙니다. 승인 결정 직후 결과 화면의 링크나 전달받은 승인 결정 ID로만 열 수 있습니다. 승인 요청 상세에서도 결정 ID를 다시 찾을 수 없습니다.</p>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); onOpen() }}>
        <Input label="승인 결정 ID" required value={value} onChange={(change) => setValue(change.target.value)} error={error ?? undefined} autoComplete="off" spellCheck={false} />
        <div className={styles.formActions}><Button type="submit">발급 화면 열기</Button></div>
      </form>
    </Card>
  </div>
}
