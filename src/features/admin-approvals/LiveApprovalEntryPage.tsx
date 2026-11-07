import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input } from '../../components/common/FormControls'
import { PageHeader } from '../../components/common/PageHeader'
import styles from '../admin-cases/Cases.module.css'
import { approvalRequestRoute, readApprovalRequestId } from './approvalApi'

// 인증 세션의 승인 검토 진입 화면이다. Backend에 승인 대기 목록 API가 없어 목록을 만들지 않고 승인 요청 ID로만 상세를 연다.
// 요청 ID는 비밀값이 아니며 접근 범위는 서버가 확인한다. 입력값은 저장하지 않는다.

export function LiveApprovalEntryPage() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const onOpen = () => {
    const requestId = readApprovalRequestId(value)
    if (requestId === null) { setError('승인 요청 ID를 UUID 형식으로 입력해 주세요.'); return }
    setError(null)
    navigate(approvalRequestRoute(requestId))
  }
  return <div className={styles.page}>
    <PageHeader eyebrow="검토" title="보고서 승인 요청 열기" description="승인 요청 ID로 요청 상세, 철회, 독립 검토와 결정 화면을 엽니다. 결정은 요청자와 다른 승인 담당만 할 수 있습니다." />
    <Card className={styles.panel} aria-label="승인 요청 ID 입력">
      <p className={styles.blocked} role="note">승인 대기 목록 API가 없어 이 화면은 실제 승인 대기열이 아닙니다. 승인 요청을 만든 뒤 이동한 요청 상세 주소나 전달받은 승인 요청 ID로만 열 수 있습니다.</p>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); onOpen() }}>
        <Input label="승인 요청 ID" required value={value} onChange={(change) => setValue(change.target.value)} error={error ?? undefined} autoComplete="off" spellCheck={false} />
        <div className={styles.formActions}><Button type="submit">승인 요청 열기</Button></div>
      </form>
    </Card>
  </div>
}
