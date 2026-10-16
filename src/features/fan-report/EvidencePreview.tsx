import { useState } from 'react'
import type { EvidenceItem } from './FanReportState'
import styles from './FanReport.module.css'

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function EvidencePreview({ item }: { item: EvidenceItem }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <span className={styles.previewFailure} role="alert">미리보기를 표시할 수 없습니다</span>
    : <img src={item.previewUrl} alt={`${item.file.name} 미리보기`} onError={() => setFailed(true)} />
}
