import styles from './Feedback.module.css'

export function LoadingSkeleton({ label = '내용을 불러오는 중입니다' }: { label?: string }) {
  return <div className={styles.skeleton} role="status" aria-label={label}><span /><span /><span /></div>
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return <div className={styles.state}><span className={styles.symbol} aria-hidden="true">○</span><h2>{title}</h2>{description && <p>{description}</p>}</div>
}

export function ErrorState({ title = '내용을 불러오지 못했습니다', description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return <div className={styles.state} role="alert"><span className={styles.symbol} aria-hidden="true">!</span><h2>{title}</h2>{description && <p>{description}</p>}{onRetry && <button type="button" onClick={onRetry}>다시 시도</button>}</div>
}

export function PermissionDenied() {
  return <div className={styles.state} role="alert"><span className={styles.symbol} aria-hidden="true">!</span><h2>접근 권한이 없습니다</h2><p>이 화면에 접근할 수 있는지 관리자에게 확인해 주세요.</p></div>
}
