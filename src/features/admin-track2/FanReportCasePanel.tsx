import { useState } from 'react'
import { CreateCasePanel, OptionalClusterFields } from '../admin-cases/CreateCasePanel'
import type { GraphClusterSource } from '../admin-cases/caseWorkflowApi'
import { formatBytes } from './track2Api'
import type { FanReportDetail } from './track2Api'
import styles from '../admin-cases/Cases.module.css'

// Track 2 제보 상세의 Case 생성 영역이다. 제보 ID와 공연은 상세 응답 값만 쓰고, 증거 이미지는 원본 저장이 확인된 항목만 선택할 수 있다.
// 분석 관찰값이나 FOUND 상태는 출처 판단에 쓰지 않으며 Case 생성이 제보 내용의 사실 확인이라는 뜻도 아니다.
// 서버는 정상 접수(RECEIVED)이고 보존 기한이 남은 제보만 연결하므로 그 밖의 제보는 요청 전에 막고 사유를 표시한다.

const emptyCluster: GraphClusterSource = { analysisRequestId: '', clusterId: '' }

export function FanReportCasePanel({ report }: { report: FanReportDetail }) {
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [cluster, setCluster] = useState(emptyCluster)
  const linkCluster = cluster.analysisRequestId !== '' || cluster.clusterId !== ''
  const selectable = report.evidence.filter((item) => item.originalStored && item.storageStatus === 'STORED')
  // 렌더링 시각의 보존 기한 비교는 요청 전 안내일 뿐이며 서버가 요청 시각 기준으로 다시 확인한다.
  // eslint-disable-next-line react-hooks/purity
  const retentionPassed = Date.parse(report.retentionUntil) <= Date.now()
  let blockedReason: string | null = null
  if (report.intakeStatus !== 'RECEIVED') blockedReason = '정상 접수 상태의 제보만 Case 출처로 연결할 수 있습니다. 접수 실패나 분석 상태의 제보를 정상 출처로 바꾸지 않습니다.'
  else if (retentionPassed) blockedReason = '보존 기한이 지난 제보는 Case 출처로 연결할 수 없습니다.'

  const toggle = (evidenceId: string) => setEvidenceIds((current) => current.includes(evidenceId) ? current.filter((id) => id !== evidenceId) : [...current, evidenceId])

  return <CreateCasePanel context="Track 2 팬 제보" blockedReason={blockedReason}
    sources={{ eventId: report.event.id, graphClusters: linkCluster ? [cluster] : [], fanReportIds: [report.fanReportId], evidenceIds }}>
    <fieldset className={styles.fieldset}>
      <legend>함께 연결할 증거 이미지 (선택)</legend>
      {report.evidence.length === 0
        ? <p className={styles.caution}>이 제보에는 증거 이미지가 없습니다. 제보만 연결합니다.</p>
        : <ul className={styles.checkList}>{report.evidence.map((item, index) => {
          const allowed = selectable.includes(item)
          return <li key={item.evidenceId}><label>
            <input type="checkbox" checked={evidenceIds.includes(item.evidenceId)} disabled={!allowed} onChange={() => toggle(item.evidenceId)} />
            <span>증거 {index + 1} ({item.mediaType}, {formatBytes(item.byteSize)}){allowed ? '' : ', 원본 저장이 확인되지 않아 연결할 수 없음'}</span>
          </label></li>
        })}</ul>}
      <p className={styles.caution}>원본 크기, 형식, 객체 버전은 서버가 저장소에서 다시 확인합니다. 원본 무결성 실패와 보존 기한 실패는 구분해 안내합니다.</p>
    </fieldset>
    <OptionalClusterFields value={cluster} onChange={setCluster} />
  </CreateCasePanel>
}
