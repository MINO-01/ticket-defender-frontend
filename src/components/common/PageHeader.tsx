import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'

type PageHeaderProps = { eyebrow?: string; title: string; description?: string; action?: ReactNode }

export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return <header className={styles.header}><div>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}<h1>{title}</h1>{description && <p className={styles.description}>{description}</p>}</div>{action && <div className={styles.action}>{action}</div>}</header>
}
