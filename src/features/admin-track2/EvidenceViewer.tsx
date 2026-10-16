import { useState } from 'react'
import { Card } from '../../components/common/Card'
import { EmptyState } from '../../components/common/Feedback'
import type { EvidenceAsset } from './track2Model'
import styles from './Track2.module.css'

export function EvidenceViewer({ assets }: { assets: EvidenceAsset[] }) {
  const [selectedId, setSelectedId] = useState(assets[0]?.id ?? null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const selected = assets.find((asset) => asset.id === selectedId)
  return <Card className={styles.panel}>
    <div className={styles.panelHeading}><h2>증거 파일</h2><span>{assets.length}개 · 합성 자료</span></div>
    {selected ? <>
      <div className={styles.preview}>
        {previewFailed ? <div className={styles.previewError} role="alert">이미지 미리보기를 불러오지 못했습니다. 파일 목록에서 다른 자료를 선택해 주세요.</div> :
          <img src={selected.previewPath} alt={`${selected.name}의 합성 화면 예시`} onError={() => setPreviewFailed(true)} />}
      </div>
      <div className={styles.fileMeta}><strong>{selected.name}</strong><span>{selected.mediaType} · {(selected.sizeBytes / 1024).toFixed(1)} KB · 합성 시연 파일</span></div>
      <div className={styles.evidenceList} role="group" aria-label="증거 파일 선택">
        {assets.map((asset, index) => <button key={asset.id} type="button" aria-label={`${index + 1}번 자료: ${asset.name}`} aria-pressed={asset.id === selectedId} onClick={() => { setSelectedId(asset.id); setPreviewFailed(false) }}><span>자료 {index + 1}</span><strong>{asset.name}</strong></button>)}
      </div>
    </> : <EmptyState title="첨부된 증거가 없습니다" description="이 합성 제보에는 이미지 자료가 없습니다." />}
    <p className={styles.subtleNote}>이 그림은 화면 검토용 합성 예시입니다. 원본 증거가 서버에 저장되거나 검증된 상태가 아닙니다.</p>
  </Card>
}
