import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input } from '../../components/common/FormControls'
import { lookupSchema } from './reportModel'
import type { LookupFields } from './reportModel'
import { lookupFanReport } from './fanReportApi'
import { describeLookupFailure } from './submission'
import type { LookupFailureView } from './submission'
import { useFanReport } from './FanReportState'
import styles from './FanReport.module.css'

export function LookupPage() {
  const navigate = useNavigate()
  const { setLookupResult } = useFanReport()
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<LookupFailureView | null>(null)
  const inFlight = useRef(false)
  const { register, handleSubmit, formState: { errors } } = useForm<LookupFields>({ defaultValues: { receiptNumber: '', lookupCode: '' }, resolver: zodResolver(lookupSchema), mode: 'onChange' })

  async function lookup(fields: LookupFields) {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setFailure(null)
    setLookupResult(null)
    try {
      const result = await lookupFanReport(fields.receiptNumber.trim(), fields.lookupCode.trim())
      if (result.kind === 'success') {
        setLookupResult(result.result)
        navigate('/fan/status')
      } else {
        setFailure(describeLookupFailure(result))
      }
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  return <div className={styles.lookupPage}>
    <Card className={styles.lookupCard}>
      <span className={styles.eyebrow}>내 제보 조회</span><h1>제보 조회 인증</h1>
      <p>접수 완료 화면에서 받은 접수번호와 조회 코드를 입력하면 접수 상태를 확인할 수 있습니다.</p>
      <form noValidate className={styles.fields} onSubmit={(event) => { void handleSubmit(lookup)(event) }}>
        <Input label="접수번호" autoComplete="off" required placeholder="접수번호를 입력해 주세요" error={errors.receiptNumber?.message} {...register('receiptNumber')} />
        <Input label="비밀 조회 코드" type="password" autoComplete="off" required placeholder="조회 코드를 입력해 주세요" error={errors.lookupCode?.message} {...register('lookupCode')} />
        <Button type="submit" size="large" loading={loading}>{loading ? '조회 중' : '접수 상태 조회'}</Button>
      </form>
      {failure && <div role="alert" className={styles.privacyNote}><strong>{failure.title}</strong><p>{failure.description}</p></div>}
      <Link className={styles.textLink} to="/fan/guide">새 제보 안내 보기</Link>
    </Card>
    <Card className={styles.privacyCard}><h2>조회 시 정보 보호</h2><p>인증 전에는 특정 제보의 처리 상태를 공개하지 않습니다. 접수번호와 조회 코드는 주소에 기록되지 않고 요청 본문으로만 전송됩니다.</p></Card>
  </div>
}
