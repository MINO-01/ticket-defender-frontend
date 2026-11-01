import { useState } from 'react'
import type { FormEvent } from 'react'
import { z } from 'zod'
import type { AdminApiResult } from '../../api/adminApiClient'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input } from '../../components/common/FormControls'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { isUuid } from '../fan-report/intakeConfig'
import styles from './BackendAuthCheckPanel.module.css'

// 관리자 JWT가 실제 Backend 인증과 membership 권한 검사를 통과하는지 확인하는 점검 화면이다.
// 기존 관리자 팬 제보 목록 API를 호출하지만 결과 종류와 전체 건수만 표시하고 제보 내용은 표시하지 않는다.

const pageSummarySchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int().nonnegative(),
  hasNext: z.boolean(),
})

type PageSummary = z.infer<typeof pageSummarySchema>

function describe(result: AdminApiResult<PageSummary>) {
  switch (result.kind) {
    case 'success':
      return { tone: 'success', text: `인증과 권한 확인에 성공했습니다. 이 공연의 팬 제보 ${result.data.totalItems}건에 접근할 수 있습니다.` }
    case 'unauthenticated':
      return { tone: 'error', text: '유효한 관리자 세션이 없어 요청하지 않았거나 서버가 인증을 거부했습니다.' }
    case 'forbidden':
      return { tone: 'error', text: '인증은 되었지만 이 작업에 필요한 역할이 없습니다.' }
    case 'notFound':
      return { tone: 'error', text: '공연을 찾을 수 없거나 접근 범위 밖입니다.' }
    case 'network':
      return { tone: 'error', text: '서버에 연결하지 못했습니다.' }
    case 'invalidResponse':
      return { tone: 'error', text: '서버 응답 형식이 계약과 달라 결과를 확인하지 못했습니다.' }
    case 'problem':
      return { tone: 'error', text: `서버가 요청을 처리하지 못했습니다(${result.status}, ${result.code}).` }
  }
}

export function BackendAuthCheckPanel() {
  const client = useAdminApiClient()
  const [eventId, setEventId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<AdminApiResult<PageSummary> | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = eventId.trim()
    if (!isUuid(value)) {
      setError('공연 UUID 형식으로 입력해 주세요.')
      return
    }
    setError(undefined)
    setPending(true)
    try {
      setResult(await client.request(`/api/v1/admin/fan-reports?eventId=${value.toLowerCase()}&page=0&pageSize=1`, { schema: pageSummarySchema }))
    } finally {
      setPending(false)
    }
  }

  const message = result ? describe(result) : null
  return <Card className={styles.panel} aria-labelledby="backend-auth-check-title">
    <h2 id="backend-auth-check-title">백엔드 인증 연결 확인</h2>
    <p>현재 관리자 세션으로 공연 범위의 팬 제보 목록 권한을 확인합니다. 결과 종류와 전체 건수만 표시합니다.</p>
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <Input label="공연 UUID" value={eventId} onChange={(event) => setEventId(event.target.value)} error={error} autoComplete="off" spellCheck={false} />
      <Button type="submit" loading={pending}>권한 확인</Button>
    </form>
    {message && <p className={message.tone === 'success' ? styles.success : styles.error} role="status" data-result={result?.kind}>{message.text}</p>}
  </Card>
}
