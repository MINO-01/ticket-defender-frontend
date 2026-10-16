import styles from './Track2.module.css'

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'info' | 'success' | 'warning' | 'critical' }) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{label}</span>
}
