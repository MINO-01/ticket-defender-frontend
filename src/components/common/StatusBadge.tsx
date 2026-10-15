import { statusLabels } from './statusLabels'
import type { StatusBadgeProps } from './statusLabels'
import styles from './StatusBadge.module.css'

export function StatusBadge(props: StatusBadgeProps) {
  const presentation = props.domain === 'job'
    ? statusLabels.job[props.status]
    : props.domain === 'case'
      ? statusLabels.case[props.status]
      : statusLabels.report[props.status]

  return <span className={`${styles.badge} ${styles[presentation.tone]}`}>{presentation.label}</span>
}
