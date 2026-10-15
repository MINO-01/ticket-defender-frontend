import type { HTMLAttributes } from 'react'
import styles from './Card.module.css'

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={[styles.card, className].filter(Boolean).join(' ')} />
}
