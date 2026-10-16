import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input } from '../../components/common/FormControls'
import { lookupSchema } from './reportModel'
import type { LookupFields } from './reportModel'
import styles from './FanReport.module.css'

export function LookupPage() {
  const [attempted, setAttempted] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<LookupFields>({ defaultValues: { receiptNumber: '', secretCode: '' }, resolver: zodResolver(lookupSchema), mode: 'onChange' })

  return <div className={styles.lookupPage}>
    <Card className={styles.lookupCard}>
      <span className={styles.eyebrow}>내 제보 조회</span><h1>제보 조회 인증</h1>
      <p>접수번호와 조회 코드를 입력할 수 있습니다. 현재 인증 API가 연결되지 않아 실제 제보는 조회할 수 없습니다.</p>
      <form noValidate className={styles.fields} onSubmit={handleSubmit(() => setAttempted(true))} onChange={() => setAttempted(false)}>
        <Input label="접수번호" autoComplete="off" required placeholder="접수번호를 입력해 주세요" error={errors.receiptNumber?.message} {...register('receiptNumber')} />
        <Input label="비밀 조회 코드" type="password" autoComplete="off" required placeholder="조회 코드를 입력해 주세요" error={errors.secretCode?.message} {...register('secretCode')} />
        <p className={styles.fieldHint}>조회 코드의 형식·발급·만료 정책은 추후 백엔드 계약에서 정합니다.</p>
        <Button type="submit" size="large">입력 내용 확인</Button>
      </form>
      {attempted && <p role="status" className={styles.infoStrip}>조회 인증 API가 연결되지 않았습니다. 입력한 값은 전송되지 않았으며 제보 상세 정보는 표시할 수 없습니다.</p>}
      <Link className={styles.textLink} to="/fan/guide">새 제보 안내 보기</Link>
    </Card>
    <Card className={styles.privacyCard}><h2>조회 시 정보 보호</h2><p>인증 전에는 특정 제보의 처리 상태, 상세 내용, 증거 이미지를 공개하지 않습니다. 접수번호나 코드는 주소에 기록되지 않습니다.</p></Card>
  </div>
}
