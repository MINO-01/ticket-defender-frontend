import type { MutationAttempt } from './useCaseMutation'
import styles from './Cases.module.css'

// 쓰기 요청 한 건의 결과 안내다. 서버 상세 메시지와 요청 키는 표시하지 않고 고정 문구만 보여 준다.
// 결과를 확인하지 못한 상태는 실패로도 성공으로도 표시하지 않는다.

export function MutationStatus<T>({ attempt, successText }: { attempt: MutationAttempt<T> | null; successText: string | null }) {
  if (attempt === null || attempt.kind === 'sending') return null
  if (attempt.kind === 'succeeded') return successText === null ? null : <p className={styles.success} role="status">{successText}</p>
  const tone = attempt.kind === 'uncertain' ? styles.uncertain : styles.failure
  const label = attempt.kind === 'uncertain' ? '결과 미확인' : attempt.kind === 'conflict' ? '버전 충돌' : '요청 거부'
  return <div className={tone} role="alert">
    <strong>{label}: {attempt.message.title}</strong>
    <p>{attempt.message.description}</p>
  </div>
}
