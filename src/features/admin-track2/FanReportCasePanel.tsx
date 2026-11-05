import { useState } from 'react'
import { Button } from '../../components/common/Button'
import { CreateCasePanel, OptionalClusterFields } from '../admin-cases/CreateCasePanel'
import type { GraphClusterSource } from '../admin-cases/caseWorkflowApi'
import { applicabilityLabels, candidateReasonLabels, candidateStatusLabels } from './candidatePipelineApi'
import type { CandidateRun } from './candidatePipelineApi'
import { formatBytes, formatUtc } from './track2Api'
import type { FanReportDetail } from './track2Api'
import { isLinkableCandidateRun } from './useCandidateRunSelection'
import type { CandidateRunSelection } from './useCandidateRunSelection'
import styles from '../admin-cases/Cases.module.css'

// Track 2 제보 상세의 Case 생성 영역이다. 제보 ID와 공연은 상세 응답 값만 쓰고, 증거 이미지는 원본 저장이 확인된 항목만 선택할 수 있다.
// 분석 관찰값이나 FOUND 상태는 출처 판단에 쓰지 않으며 Case 생성이 제보 내용의 사실 확인이라는 뜻도 아니다.
// 서버는 정상 접수(RECEIVED)이고 보존 기한이 남은 제보만 연결하므로 그 밖의 제보는 요청 전에 막고 사유를 표시한다.
// 증거 영역의 후보 실행 이력에서 관리자가 고른 실행만 candidateRunIds로 보낸다. 실행의 소속 증거는 자동으로 고르지 않고 함께 선택하도록 안내한다.

const emptyCluster: GraphClusterSource = { analysisRequestId: '', clusterId: '' }

function candidateIssue(report: FanReportDetail, runs: CandidateRun[], evidenceIds: string[]) {
  if (runs.some((run) => run.fanReportId !== report.fanReportId)) return '이 제보에 속하지 않은 후보 실행이 선택되어 있습니다. 선택을 해제해 주세요.'
  if (runs.some((run) => !isLinkableCandidateRun(run))) return '진행 중이거나 현재 기준(CURRENT)이 아닌 후보 실행이 선택되어 있습니다. 선택을 해제한 뒤 요청해 주세요.'
  const missing = [...new Set(runs.map((run) => run.evidenceId).filter((id) => !evidenceIds.includes(id)))]
  if (missing.length === 0) return null
  const labels = missing.map((id) => {
    const index = report.evidence.findIndex((item) => item.evidenceId === id)
    return index < 0 ? '제보에 없는 증거' : `증거 ${index + 1}`
  })
  return `선택한 후보 실행의 소속 증거(${labels.join(', ')})를 함께 연결할 증거 이미지에서 선택해 주세요. 후보 실행은 소속 증거와 함께만 연결할 수 있습니다.`
}

export function FanReportCasePanel({ report, selection }: { report: FanReportDetail; selection?: CandidateRunSelection }) {
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
  const runs = selection?.selected ?? []
  const sourceIssue = candidateIssue(report, runs, evidenceIds)
  const evidenceLabel = (evidenceId: string) => {
    const index = report.evidence.findIndex((item) => item.evidenceId === evidenceId)
    return index < 0 ? '제보에 없는 증거' : `증거 ${index + 1}`
  }

  return <CreateCasePanel context="Track 2 팬 제보" blockedReason={blockedReason} sourceIssue={sourceIssue} onBusyChange={selection?.setLocked}
    sources={{ eventId: report.event.id, graphClusters: linkCluster ? [cluster] : [], fanReportIds: [report.fanReportId], evidenceIds, candidateRunIds: runs.map((run) => run.runId) }}>
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
    {selection && <fieldset className={styles.fieldset} aria-label="함께 연결할 후보 실행">
      <legend>함께 연결할 예매 후보 대조 실행 (선택)</legend>
      {runs.length === 0
        ? <p className={styles.caution}>선택한 후보 실행이 없습니다. 증거 영역의 후보 실행 이력에서 종료되었고 현재 기준(CURRENT)인 실행을 신규 Case 출처로 선택할 수 있습니다.</p>
        : <ul className={styles.checkList}>{runs.map((run) => <li key={run.runId}>
          <span>
            <strong>{evidenceLabel(run.evidenceId)}</strong>, 실행 결과 {candidateStatusLabels[run.status]}, 사유 {candidateReasonLabels[run.reason]} ({run.reason}), 적용 여부 {applicabilityLabels[run.applicability]}, <time dateTime={run.createdAt}>{formatUtc(run.createdAt)}</time> 실행
            <br /><span className={styles.idCell}>실행 ID {run.runId}</span>
          </span>
          <Button size="small" variant="secondary" onClick={() => selection.remove(run.runId)}>선택 해제</Button>
        </li>)}</ul>}
      <p className={styles.caution}>후보 대조 결과는 조사 참고 자료이며 부정 거래나 불법 거래 확정이 아닙니다. 후보 없음(NO_MATCH)과 확인 불가(UNVERIFIABLE), 후보 여러 건(AMBIGUOUS)은 서로 다른 결과입니다. 실행 상태와 소속 제보, 증거, 현재 기준 여부는 서버가 다시 확인합니다.</p>
      {runs.length > 0 && <p className={styles.blocked} role="note">후보 실행이 연결된 Case는 승인 근거 정책이 확정되지 않아 현재 승인 요청과 공식 PDF 발급이 차단됩니다(APPROVAL_BASIS_BLOCKED). 조사 기록용으로만 사용해 주세요.</p>}
    </fieldset>}
    <OptionalClusterFields value={cluster} onChange={setCluster} />
  </CreateCasePanel>
}
