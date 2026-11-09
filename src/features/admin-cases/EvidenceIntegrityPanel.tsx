import { useState } from 'react'
import type { ReactNode } from 'react'
import type { AdminApiResult } from '../../api/adminApiClient'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Select, Textarea } from '../../components/common/FormControls'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { formatUtc } from '../admin-track2/track2Api'
import { caseSourceListSchema, caseSourcesPath } from './caseApi'
import type { CaseSource, CaseView } from './caseApi'
import { reportVersionListPath, reportVersionPageSchema, snapshotListPath, snapshotPageSchema } from './caseWorkflowApi'
import type { MutationOutcome } from './caseWorkflowApi'
import type { WorkflowOutcome } from './CaseWorkflowPanels'
import {
  describeIntegrityReason, evidenceVerificationListPath, evidenceVerificationPath, integrityEvaluationPath, integrityEvaluationSchema, isEvaluationOf, isVerificationOf,
  preservationLabels, technicalIntegrityLabels, verificationPageSchema, verificationSchema, verificationStatusLabels, verifyMessages, verifyReasonError,
} from './evidenceIntegrityApi'
import type { EvidenceVerification, IntegrityEvaluation, VerifyBody } from './evidenceIntegrityApi'
import { MutationStatus } from './MutationStatus'
import styles from './Cases.module.css'
import { useCaseMutation } from './useCaseMutation'

// 조사 근거 묶음에 포함된 파일 증거의 원본 바이트를 서버가 다시 읽어 검증하고, 보고서 초안의 무결성을 평가하는 영역이다.
// 검증 실패와 저장소 장애는 일치로 표시하지 않고 서버 상태 그대로 구분한다. 검증 일치도 승인 적격성이나 부정 거래 판정이 아니다.

type Props = { view: CaseView; locked: boolean; onOutcome: (outcome: WorkflowOutcome) => void; refreshKey: number }
type EvidenceAssetSource = CaseSource & { sourceType: 'EVIDENCE_ASSET'; evidenceId: string }

function isEvidenceAsset(source: CaseSource): source is EvidenceAssetSource {
  return source.sourceType === 'EVIDENCE_ASSET' && !!source.evidenceId
}

function QueryFailure({ result, onRetry }: { result: Parameters<typeof describeAdminApiFailure>[0]; onRetry: () => void }) {
  const message = describeAdminApiFailure(result, '조사 사건을 찾을 수 없거나 접근 범위 밖입니다')
  return <ErrorState title={message.title} description={message.description} onRetry={onRetry} />
}

export function EvidenceIntegrityPanel({ view, locked, onOutcome, refreshKey }: Props) {
  // 검증 실패(422)도 기록이 남으므로 부모의 Case 재조회 없이 이 영역의 기록만 다시 불러온다.
  const [localKey, setLocalKey] = useState(0)
  const reloadKey = refreshKey + localKey
  const records = useAdminQuery(evidenceVerificationListPath(view.caseId), verificationPageSchema, reloadKey)
  return <Card className={styles.panel} aria-label="증거 무결성 검증">
    <div className={styles.panelHeading}><h2>증거 무결성 검증</h2></div>
    <p className={styles.caution}>저장된 원본 바이트를 서버가 다시 읽어 접수 기록과 대조합니다. 일치 결과는 검증 시점의 사실이며, 원본 불변 보존이나 승인 적격성, 부정 거래 여부를 뜻하지 않습니다.</p>
    <VerifyForm view={view} locked={locked} onOutcome={onOutcome} refreshKey={refreshKey} onRecorded={() => setLocalKey((value) => value + 1)} />
    <h3>검증 기록</h3>
    {records.result === null
      ? <LoadingSkeleton label="검증 기록을 불러오는 중" />
      : records.result.kind !== 'success'
        ? <QueryFailure result={records.result} onRetry={records.retry} />
        : records.result.data.items.length === 0
          ? <EmptyState title="검증 기록이 없습니다" description="서버에 저장된 검증 기록이 없습니다. 무결성이 확인되었다는 뜻이 아닙니다." />
          : <>
            <ul className={styles.sourceList}>{records.result.data.items.map((item) => <li key={item.recordId}><VerificationItem item={item} /></li>)}</ul>
            {records.result.data.hasNext && <p className={styles.caution}>최신 {records.result.data.pageSize}건만 표시합니다. 이전 기록이 더 있습니다.</p>}
          </>}
    <EvaluationSection caseId={view.caseId} reloadKey={reloadKey} />
  </Card>
}

function VerifyForm({ view, locked, onOutcome, refreshKey, onRecorded }: Props & { onRecorded: () => void }) {
  const snapshots = useAdminQuery(snapshotListPath(view.caseId, 0), snapshotPageSchema, refreshKey)
  const sources = useAdminQuery(caseSourcesPath(view.caseId), caseSourceListSchema, refreshKey)
  const [snapshotChoice, setSnapshotChoice] = useState('')
  const [sourceChoice, setSourceChoice] = useState('')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | undefined>()
  const mutation = useCaseMutation<VerifyBody, EvidenceVerification>({ method: 'POST', schema: verificationSchema, successStatus: 201, messages: verifyMessages })
  const sending = mutation.attempt?.kind === 'sending'
  const uncertain = mutation.attempt?.kind === 'uncertain'
  const path = evidenceVerificationPath(view.caseId)

  if (snapshots.result === null || sources.result === null) return <LoadingSkeleton label="검증 대상을 불러오는 중" />
  if (snapshots.result.kind !== 'success') return <QueryFailure result={snapshots.result} onRetry={snapshots.retry} />
  if (sources.result.kind !== 'success') return <QueryFailure result={sources.result} onRetry={sources.retry} />

  const snapshotItems = snapshots.result.data.items
  const assets = sources.result.data.filter(isEvidenceAsset)
  if (snapshotItems.length === 0) return <p className={styles.blocked} role="note">조사 근거 묶음이 없어 검증할 수 없습니다. 먼저 조사 근거 묶음을 만들어 주세요.</p>
  if (assets.length === 0) return <p className={styles.caution} role="note">이 조사 사건에는 파일 증거 출처가 없어 원본 바이트 검증 대상이 없습니다.</p>

  const snapshot = snapshotItems.find((item) => item.evidenceSnapshotId === snapshotChoice) ?? snapshotItems[0]
  const asset = assets.find((item) => item.sourceReferenceId === sourceChoice) ?? assets[0]

  const settle = (next: MutationOutcome<EvidenceVerification> | null) => {
    if (!next) return
    if (next.kind === 'succeeded') {
      setReason('')
      onOutcome({ kind: 'succeeded', message: `원본 바이트 검증 결과: ${verificationStatusLabels[next.data.verificationStatus]}` })
    } else if (next.kind === 'conflict') onOutcome({ kind: 'conflict', message: next.message })
    else if (next.kind === 'rejected' && next.forbidden) onOutcome({ kind: 'forbidden' })
    onRecorded()
  }
  const onSubmit = () => {
    const error = verifyReasonError(reason)
    if (error) { setReasonError(error); return }
    setReasonError(undefined)
    const body: VerifyBody = { expectedCaseVersion: view.caseVersion, evidenceSnapshotId: snapshot.evidenceSnapshotId, sourceReferenceId: asset.sourceReferenceId, evidenceId: asset.evidenceId, reason }
    void mutation.submit(path, body, (data) => isVerificationOf(data, view.caseId, body)).then(settle)
  }
  const onReconfirm = () => {
    void mutation.reconfirm(path, (data) => data.caseId === view.caseId).then(settle)
  }
  const disabled = locked || sending || uncertain
  return <div className={styles.form}>
    <Select label="조사 근거 묶음" value={snapshot.evidenceSnapshotId} disabled={disabled} onChange={(change) => setSnapshotChoice(change.target.value)}>
      {snapshotItems.map((item) => <option key={item.evidenceSnapshotId} value={item.evidenceSnapshotId}>증거 개정 {item.evidenceRevision}, {formatUtc(item.capturedAt)}</option>)}
    </Select>
    <Select label="파일 증거" value={asset.sourceReferenceId} disabled={disabled} onChange={(change) => setSourceChoice(change.target.value)}>
      {assets.map((item) => <option key={item.sourceReferenceId} value={item.sourceReferenceId}>증거 {item.evidenceId.slice(0, 8)}</option>)}
    </Select>
    <Textarea label="검증 사유" required rows={2} maxLength={1800} value={reason} disabled={disabled} onChange={(change) => setReason(change.target.value)} error={reasonError} />
    <div className={styles.formActions}>
      {uncertain
        ? <Button onClick={onReconfirm} loading={sending} disabled={locked}>검증 결과 재확인</Button>
        : <Button onClick={onSubmit} loading={sending} disabled={locked}>{sending ? '원본 검증 중' : '원본 바이트 검증'}</Button>}
    </div>
    <MutationStatus attempt={mutation.attempt?.kind === 'conflict' ? null : mutation.attempt} successText={null} />
  </div>
}

function VerificationItem({ item }: { item: EvidenceVerification }) {
  return <article className={styles.source} aria-label="검증 기록">
    <span className={styles.sourceType}>{verificationStatusLabels[item.verificationStatus]} ({item.verificationStatus})</span>
    <dl className={styles.definition}>
      <div><dt>증거 ID</dt><dd className={styles.idCell}>{item.evidenceId}</dd></div>
      <div><dt>조사 근거 묶음 ID</dt><dd className={styles.idCell}>{item.evidenceSnapshotId}</dd></div>
      <div><dt>보존 상태</dt><dd>{preservationLabels[item.preservationStatus]}</dd></div>
      <div><dt>검증 방식</dt><dd>{item.verificationMethod === 'STREAMED_SHA256' ? '원본 스트림 SHA-256' : '원본을 읽지 않음'}</dd></div>
      <div><dt>검증한 크기</dt><dd>{item.verifiedByteSize === null ? '확인되지 않음' : `${item.verifiedByteSize.toLocaleString('ko-KR')} 바이트`}</dd></div>
      <div><dt>검증 시각</dt><dd><time dateTime={item.verifiedAt}>{formatUtc(item.verifiedAt)}</time></dd></div>
    </dl>
  </article>
}

function EvaluationSection({ caseId, reloadKey }: { caseId: string; reloadKey: number }) {
  const drafts = useAdminQuery(reportVersionListPath(caseId, 0), reportVersionPageSchema, reloadKey)
  const [choice, setChoice] = useState('')
  const [requested, setRequested] = useState<string | null>(null)
  const evaluation = useAdminQuery(requested === null ? null : integrityEvaluationPath(caseId, requested), integrityEvaluationSchema, reloadKey)
  let body: ReactNode
  if (drafts.result === null) body = <LoadingSkeleton label="보고서 초안을 불러오는 중" />
  else if (drafts.result.kind !== 'success') body = <QueryFailure result={drafts.result} onRetry={drafts.retry} />
  else if (drafts.result.data.items.length === 0) body = <EmptyState title="평가할 보고서 초안이 없습니다" description="서버에 저장된 보고서 초안이 없습니다." />
  else {
    const items = drafts.result.data.items
    const selected = items.find((item) => item.reportVersionId === choice) ?? items[0]
    body = <>
      <div className={styles.form}>
        <Select label="보고서 초안" value={selected.reportVersionId} onChange={(change) => { setChoice(change.target.value); setRequested(null) }}>
          {items.map((item) => <option key={item.reportVersionId} value={item.reportVersionId}>개정 {item.revision}, {formatUtc(item.createdAt)}</option>)}
        </Select>
        <div className={styles.formActions}><Button variant="secondary" onClick={() => setRequested(selected.reportVersionId)}>무결성 평가 조회</Button></div>
      </div>
      {requested !== null && <EvaluationResult caseId={caseId} reportVersionId={requested} result={evaluation.result} onRetry={evaluation.retry} />}
    </>
  }
  return <>
    <h3>보고서 초안 무결성 평가</h3>
    <p className={styles.caution}>기술 무결성과 승인 근거 적격성은 별도의 서버 값입니다. 공식 PDF 발급 가능 여부는 발급 화면에서 서버가 다시 확인합니다.</p>
    {body}
  </>
}

function EvaluationResult({ caseId, reportVersionId, result, onRetry }: { caseId: string; reportVersionId: string; result: AdminApiResult<IntegrityEvaluation> | null; onRetry: () => void }) {
  if (result === null) return <LoadingSkeleton label="무결성 평가를 불러오는 중" />
  if (result.kind !== 'success') return <QueryFailure result={result} onRetry={onRetry} />
  // 요청한 초안과 다른 응답은 다른 사건의 값일 수 있으므로 표시하지 않는다.
  if (!isEvaluationOf(result.data, caseId, reportVersionId)) return <QueryFailure result={{ kind: 'invalidResponse', status: result.status }} onRetry={onRetry} />
  const data = result.data
  return <div aria-label="무결성 평가 결과" role="group">
    <dl className={styles.definition}>
      <div><dt>기술 무결성</dt><dd>{technicalIntegrityLabels[data.technicalIntegrity]} ({data.technicalIntegrity})</dd></div>
      <div><dt>승인 근거 적격성</dt><dd>{data.approvalEligibility === 'BLOCKED' ? '차단' : '서버 값 확인 필요'} ({data.approvalEligibility})</dd></div>
    </dl>
    {data.reasons.length > 0 && <ul>{data.reasons.map((reason) => <li key={reason}>{describeIntegrityReason(reason)}</li>)}</ul>}
  </div>
}
