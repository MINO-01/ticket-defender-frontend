import { useState } from 'react'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Input, Select, Textarea } from '../../components/common/FormControls'
import { statusLabels } from '../../components/common/statusLabels'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { formatUtc } from '../admin-track2/track2Api'
import { caseViewSchema } from './caseApi'
import type { CaseView } from './caseApi'
import {
  assignMessages, buildAssignRequest, buildCaptureRequest, buildDraftRequest, buildTransitionRequest, captureMessages, caseAssigneePath, caseTransitionPath,
  dismissalBases, dismissalBasisLabels, draftMessages, isAssigned, isCapturedSnapshot, isCreatedDraft, isTransitioned, reportVersionCreatePath,
  reportVersionListPath, reportVersionPageSchema, reportVersionSchema, reportVersionStatusLabels, snapshotCreatePath, snapshotDetailPath, snapshotListPath,
  snapshotPageSchema, snapshotSchema, sourceIntegrityLabels, transitionMessages, transitionOptions,
} from './caseWorkflowApi'
import type {
  AssignBody, CaptureBody, DismissalBasis, DraftBody, DraftInput, EvidenceSnapshot, MutationOutcome, ReportVersionDraft, TransitionBody, TransitionInput,
  TransitionTarget, WorkflowMessage,
} from './caseWorkflowApi'
import { MutationStatus } from './MutationStatus'
import styles from './Cases.module.css'
import { useCaseMutation } from './useCaseMutation'

// 인증된 Case 상세의 조사 준비 업무 영역이다. 모든 쓰기는 현재 화면의 caseVersion을 expectedCaseVersion으로 보내고 서버가 최종 판단한다.
// 상태 전이, 담당자, Snapshot, 초안은 검토 담당(REVIEWER)만 허용되며 역할 조회 API가 없어 403 응답 뒤에만 동작을 막는다.
// 승인 요청, 승인 결정, ReviewReceipt, 공식 PDF는 이번 범위가 아니므로 연결하지 않는다.

/** 부모(Case 상세)가 결과에 따라 최신 상태 재조회, 안내, 역할 차단을 처리한다. */
export type WorkflowOutcome = { kind: 'succeeded'; message: string } | { kind: 'conflict'; message: WorkflowMessage } | { kind: 'forbidden' }

type PanelProps = { view: CaseView; locked: boolean; onOutcome: (outcome: WorkflowOutcome) => void }

function report<T>(outcome: MutationOutcome<T> | undefined | null, onOutcome: PanelProps['onOutcome'], success: (data: T) => string) {
  if (!outcome) return
  if (outcome.kind === 'succeeded') onOutcome({ kind: 'succeeded', message: success(outcome.data) })
  else if (outcome.kind === 'conflict') onOutcome({ kind: 'conflict', message: outcome.message })
  else if (outcome.kind === 'rejected' && outcome.forbidden) onOutcome({ kind: 'forbidden' })
}

const emptyTransition = { reason: '', classification: '', unassignedReason: '', missingEvidence: '', requestedAction: '', unavailableReason: '', dismissalBasis: '' as DismissalBasis | '' }

export function TransitionPanel({ view, locked, onOutcome }: PanelProps) {
  const options = transitionOptions(view.status)
  const [selected, setSelected] = useState<TransitionTarget | ''>('')
  const [fields, setFields] = useState(emptyTransition)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const mutation = useCaseMutation<TransitionBody, CaseView>({ method: 'POST', schema: caseViewSchema, successStatus: 200, messages: transitionMessages })
  const sending = mutation.attempt?.kind === 'sending'
  const uncertain = mutation.attempt?.kind === 'uncertain'
  // 서버 상태가 바뀌어 이전 선택이 허용 목록에 없으면 첫 허용 전이를 쓴다.
  const rule = options.find((item) => item.to === selected) ?? options[0]
  const path = caseTransitionPath(view.caseId)
  const set = (name: keyof typeof emptyTransition) => (change: { target: { value: string } }) => setFields((current) => ({ ...current, [name]: change.target.value }))
  const success = (data: CaseView) => `상태를 ${statusLabels.case[data.status].label}(으)로 변경했습니다. Case 버전 ${data.caseVersion}.`

  const onSubmit = () => {
    if (!rule) return
    const input: TransitionInput = { to: rule.to, ...fields }
    const built = buildTransitionRequest(view, input)
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const body = built.body
    void mutation.submit(path, body, (data) => isTransitioned(data, view.caseId, body)).then((next) => {
      if (next?.kind === 'succeeded') { setFields(emptyTransition); setSelected('') }
      report(next, onOutcome, success)
    })
  }
  const onReconfirm = () => {
    void mutation.reconfirm(path, (data) => data.caseId === view.caseId).then((next) => report(next, onOutcome, success))
  }

  const disabled = locked || sending || uncertain
  return <Card className={styles.panel} aria-label="상태 변경">
    <div className={styles.panelHeading}><h2>상태 변경</h2><span>현재 {statusLabels.case[view.status].label}</span></div>
    {options.length === 0 || !rule
      ? <p className={styles.caution}>현재 상태에서 이 화면이 제공하는 상태 변경이 없습니다. 승인 대기 이후 단계와 종료 처리는 이번 범위에서 연결하지 않았습니다.</p>
      : <div className={styles.form}>
        <Select label="변경할 상태" value={rule.to} disabled={disabled} onChange={(change) => setSelected(change.target.value as TransitionTarget)} error={errors.to}>
          {options.map((item) => <option key={item.to} value={item.to}>{item.label} ({statusLabels.case[item.to].label})</option>)}
        </Select>
        {rule.requiresAssignee && view.assigneeMembershipId === null && <p className={styles.blocked} role="note">이 변경은 담당자가 지정되어 있어야 합니다. 먼저 담당자를 지정해 주세요.</p>}
        {rule.to === 'TRIAGED' && <>
          <Input label="분류" required maxLength={160} value={fields.classification} disabled={disabled} onChange={set('classification')} error={errors.classification} />
          {view.assigneeMembershipId === null && <Textarea label="담당자 미지정 사유" required rows={2} maxLength={500} value={fields.unassignedReason} disabled={disabled} onChange={set('unassignedReason')} error={errors.unassignedReason} />}
        </>}
        {rule.to === 'NEEDS_EVIDENCE' && <>
          <Textarea label="부족한 자료" required rows={2} maxLength={500} value={fields.missingEvidence} disabled={disabled} onChange={set('missingEvidence')} error={errors.missingEvidence} />
          <Textarea label="요청할 조치" required rows={2} maxLength={500} value={fields.requestedAction} disabled={disabled} onChange={set('requestedAction')} error={errors.requestedAction} />
        </>}
        {rule.to === 'IN_REVIEW' && view.status === 'NEEDS_EVIDENCE' && <>
          <p className={styles.caution}>출처를 추가하는 API가 없어 새 자료가 연결되었다고 기록하지 않습니다. 자료를 받지 못한 사유를 남기고 검토를 재개합니다.</p>
          <Textarea label="자료를 받지 못한 사유" required rows={2} maxLength={500} value={fields.unavailableReason} disabled={disabled} onChange={set('unavailableReason')} error={errors.unavailableReason} />
        </>}
        {rule.to === 'DISMISSED' && <>
          <p className={styles.caution}>종결 검토는 조사 종결 기록이며 제보자나 구매자에 대한 판정이 아닙니다.</p>
          <Select label="종결 근거" required value={fields.dismissalBasis} disabled={disabled} onChange={set('dismissalBasis')} error={errors.dismissalBasis}>
            <option value="">선택해 주세요</option>
            {dismissalBases.map((basis) => <option key={basis} value={basis}>{dismissalBasisLabels[basis]}</option>)}
          </Select>
        </>}
        <Textarea label="변경 사유" required rows={3} maxLength={2000} value={fields.reason} disabled={disabled} onChange={set('reason')} error={errors.reason} />
        {errors.combined && <p className={styles.fieldError} role="alert">{errors.combined}</p>}
        <div className={styles.formActions}>
          {uncertain
            ? <Button onClick={onReconfirm} loading={sending} disabled={locked}>상태 변경 재확인</Button>
            : <Button onClick={onSubmit} loading={sending} disabled={locked}>{sending ? '상태 변경 요청 중' : '상태 변경'}</Button>}
        </div>
      </div>}
    <MutationStatus attempt={mutation.attempt?.kind === 'conflict' ? null : mutation.attempt} successText={null} />
  </Card>
}

export function AssigneePanel({ view, locked, onOutcome }: PanelProps) {
  const [assignee, setAssignee] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const mutation = useCaseMutation<AssignBody, CaseView>({ method: 'PUT', schema: caseViewSchema, successStatus: 200, messages: assignMessages })
  const sending = mutation.attempt?.kind === 'sending'
  const uncertain = mutation.attempt?.kind === 'uncertain'
  const path = caseAssigneePath(view.caseId)
  const success = (data: CaseView) => `담당자를 변경했습니다. Case 버전 ${data.caseVersion}.`

  const onSubmit = () => {
    const built = buildAssignRequest(view, { assigneeMembershipId: assignee, reason })
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const body = built.body
    void mutation.submit(path, body, (data) => isAssigned(data, view.caseId, body)).then((next) => {
      if (next?.kind === 'succeeded') { setAssignee(''); setReason('') }
      report(next, onOutcome, success)
    })
  }
  const onReconfirm = () => {
    void mutation.reconfirm(path, (data) => data.caseId === view.caseId).then((next) => report(next, onOutcome, success))
  }

  const disabled = locked || sending || uncertain
  const canUseCreator = view.createdByMembershipId !== view.assigneeMembershipId
  return <Card className={styles.panel} aria-label="담당자 변경">
    <div className={styles.panelHeading}><h2>담당자 변경</h2></div>
    <p className={styles.caution}>담당자 후보를 조회하는 API가 없어 멤버십 ID를 직접 입력합니다. 같은 고객사의 활성 멤버이고 이 공연 권한과 분석 담당 또는 검토 담당 역할이 있는지는 서버가 확인합니다.</p>
    <div className={styles.form}>
      <p className={styles.caution}>현재 담당자: <span className={styles.idCell}>{view.assigneeMembershipId ?? '미지정'}</span></p>
      <Input label="새 담당자 멤버십 ID" required value={assignee} disabled={disabled} onChange={(change) => setAssignee(change.target.value)} error={errors.assigneeMembershipId} placeholder="00000000-0000-4000-8000-000000000000" />
      {canUseCreator && <Button variant="ghost" size="small" disabled={disabled} onClick={() => setAssignee(view.createdByMembershipId)}>생성자 멤버십 ID 입력</Button>}
      <Textarea label="변경 사유" required rows={2} maxLength={2000} value={reason} disabled={disabled} onChange={(change) => setReason(change.target.value)} error={errors.reason} />
      <div className={styles.formActions}>
        {uncertain
          ? <Button onClick={onReconfirm} loading={sending} disabled={locked}>담당자 변경 재확인</Button>
          : <Button onClick={onSubmit} loading={sending} disabled={locked}>{sending ? '담당자 변경 요청 중' : '담당자 지정'}</Button>}
      </div>
    </div>
    <MutationStatus attempt={mutation.attempt?.kind === 'conflict' ? null : mutation.attempt} successText={null} />
  </Card>
}

function approvalText(value: boolean) {
  return value ? '서버가 승인 가능으로 표시 (이 화면에서 승인 요청 불가)' : '승인 요청 불가 (서버 판정)'
}

function SnapshotFacts({ snapshot }: { snapshot: EvidenceSnapshot }) {
  return <dl className={styles.definition}>
    <div><dt>Snapshot ID</dt><dd className={styles.idCell}>{snapshot.evidenceSnapshotId}</dd></div>
    <div><dt>증거 개정 번호</dt><dd>{snapshot.evidenceRevision}</dd></div>
    <div><dt>생성 시 Case 버전</dt><dd>{snapshot.caseVersionAtCapture}</dd></div>
    <div><dt>Manifest SHA-256</dt><dd className={styles.idCell}>{snapshot.manifestSha256}</dd></div>
    <div><dt>출처 무결성 확인 범위</dt><dd>{sourceIntegrityLabels[snapshot.sourceIntegrity]}</dd></div>
    <div><dt>승인 요청 가능 여부</dt><dd>{approvalText(snapshot.approvalEligible)}</dd></div>
    <div><dt>생성자 멤버십 ID</dt><dd className={styles.idCell}>{snapshot.createdByMembershipId}</dd></div>
    <div><dt>생성 시각</dt><dd><time dateTime={snapshot.capturedAt}>{formatUtc(snapshot.capturedAt)}</time></dd></div>
  </dl>
}

function DraftFacts({ draft }: { draft: ReportVersionDraft }) {
  return <dl className={styles.definition}>
    <div><dt>ReportVersion ID</dt><dd className={styles.idCell}>{draft.reportVersionId}</dd></div>
    <div><dt>개정 번호</dt><dd>{draft.revision}</dd></div>
    <div><dt>보고서 상태</dt><dd>{reportVersionStatusLabels[draft.status]}</dd></div>
    <div><dt>템플릿 버전</dt><dd>{draft.templateVersion}</dd></div>
    <div><dt>본문 SHA-256</dt><dd className={styles.idCell}>{draft.contentSha256}</dd></div>
    <div><dt>기준 Snapshot</dt><dd className={styles.idCell}>{draft.evidenceSnapshotId}</dd></div>
    <div><dt>증거 개정 번호</dt><dd>{draft.evidenceRevision}</dd></div>
    <div><dt>승인 요청 가능 여부</dt><dd>{approvalText(draft.approvalEligible)}</dd></div>
    <div><dt>PDF 렌더링 가능 여부</dt><dd>{draft.renderable ? '서버가 렌더링 가능으로 표시 (이 화면에서 발급 불가)' : '렌더링 불가 (서버 판정)'}</dd></div>
    <div><dt>작성 시각</dt><dd><time dateTime={draft.createdAt}>{formatUtc(draft.createdAt)}</time></dd></div>
  </dl>
}

const emptyDraft: Omit<DraftInput, 'evidenceSnapshotId'> = { title: '', assessment: '', limitations: '', conclusion: '', reason: '' }

/** EvidenceSnapshot과 ReportVersion 초안 영역이다. 목록은 refreshKey가 바뀔 때마다 다시 조회하고 작성 중인 입력은 유지한다. */
export function PreparationPanels({ view, locked, onOutcome, refreshKey }: PanelProps & { refreshKey: number }) {
  const [snapshotPage, setSnapshotPage] = useState(0)
  const [draftPage, setDraftPage] = useState(0)
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null)
  const [captureReason, setCaptureReason] = useState('')
  const [captureErrors, setCaptureErrors] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState(emptyDraft)
  const [draftSnapshotId, setDraftSnapshotId] = useState('')
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({})
  const [createdDraft, setCreatedDraft] = useState<ReportVersionDraft | null>(null)
  const snapshots = useAdminQuery(snapshotListPath(view.caseId, snapshotPage), snapshotPageSchema, refreshKey)
  const drafts = useAdminQuery(reportVersionListPath(view.caseId, draftPage), reportVersionPageSchema, refreshKey)
  const capture = useCaseMutation<CaptureBody, EvidenceSnapshot>({ method: 'POST', schema: snapshotSchema, successStatus: 201, messages: captureMessages })
  const write = useCaseMutation<DraftBody, ReportVersionDraft>({ method: 'POST', schema: reportVersionSchema, successStatus: 201, messages: draftMessages })

  // 다른 Case나 다른 페이지의 기록이 섞이면 표시하지 않는다.
  const snapshotItems = snapshots.result?.kind === 'success' && snapshots.result.data.page === snapshotPage
    && snapshots.result.data.items.every((item) => item.caseId === view.caseId && item.eventId === view.eventId) ? snapshots.result.data.items : null
  const draftItems = drafts.result?.kind === 'success' && drafts.result.data.page === draftPage
    && drafts.result.data.items.every((item) => item.caseId === view.caseId && item.eventId === view.eventId) ? drafts.result.data.items : null
  const currentSnapshots = (snapshotItems ?? []).filter((item) => item.evidenceRevision === view.evidenceRevision)
  const existingCurrent = currentSnapshots.length > 0
  const inReview = view.status === 'IN_REVIEW'

  const captureSending = capture.attempt?.kind === 'sending'
  const captureUncertain = capture.attempt?.kind === 'uncertain'
  const captureDone = (next: Awaited<ReturnType<typeof capture.submit>>) => {
    if (next?.kind === 'succeeded') { setCaptureReason(''); setSelectedSnapshotId(next.data.evidenceSnapshotId); setDraftSnapshotId(next.data.evidenceSnapshotId) }
    report(next, onOutcome, (data) => `EvidenceSnapshot을 생성했습니다. 증거 개정 번호 ${data.evidenceRevision}. 아래에서 서버 재조회 결과를 확인해 주세요.`)
  }
  const onCapture = () => {
    const built = buildCaptureRequest(view, { reason: captureReason })
    if (!built.ok) { setCaptureErrors(built.errors); return }
    setCaptureErrors({})
    void capture.submit(snapshotCreatePath(view.caseId), built.body, (data) => isCapturedSnapshot(data, view)).then(captureDone)
  }

  const writeSending = write.attempt?.kind === 'sending'
  const writeUncertain = write.attempt?.kind === 'uncertain'
  const draftDone = (next: Awaited<ReturnType<typeof write.submit>>) => {
    if (next?.kind === 'succeeded') { setDraft(emptyDraft); setCreatedDraft(next.data) }
    report(next, onOutcome, (data) => `보고서 초안 개정 ${data.revision}을 저장했습니다. 초안은 승인된 보고서가 아닙니다.`)
  }
  const onDraft = () => {
    const built = buildDraftRequest(view, currentSnapshots, { evidenceSnapshotId: draftSnapshotId, ...draft })
    if (!built.ok) { setDraftErrors(built.errors); return }
    setDraftErrors({})
    const body = built.body
    setCreatedDraft(null)
    void write.submit(reportVersionCreatePath(view.caseId), body, (data) => isCreatedDraft(data, view, body)).then(draftDone)
  }
  const setDraftField = (name: keyof typeof emptyDraft) => (change: { target: { value: string } }) => setDraft((current) => ({ ...current, [name]: change.target.value }))

  const captureDisabled = locked || captureSending || captureUncertain
  const draftDisabled = locked || writeSending || writeUncertain

  return <>
    <Card className={styles.panel} aria-label="EvidenceSnapshot">
      <div className={styles.panelHeading}><h2>EvidenceSnapshot</h2><span>현재 증거 개정 번호 {view.evidenceRevision}</span></div>
      <p className={styles.caution}>연결 출처의 현재 기록을 고정합니다. 출처 무결성 값은 서버가 메타데이터를 대조한 범위이며 원본 바이트 재검증이나 보존 검증 완료가 아닙니다. 승인 요청 가능 여부는 서버 값만 표시합니다.</p>
      <SnapshotList query={snapshots} items={snapshotItems} page={snapshotPage} setPage={setSnapshotPage} selectedId={selectedSnapshotId} onSelect={setSelectedSnapshotId} />
      {selectedSnapshotId !== null && <SnapshotDetail key={`${selectedSnapshotId}:${refreshKey}`} caseId={view.caseId} snapshotId={selectedSnapshotId} />}
      <div className={styles.form}>
        <h3>새 Snapshot 생성</h3>
        {!inReview && <p className={styles.blocked} role="note">Case가 검토 중 상태일 때만 생성할 수 있습니다.</p>}
        {inReview && existingCurrent && <p className={styles.blocked} role="note">현재 증거 개정 번호 {view.evidenceRevision}의 Snapshot이 이미 있습니다. 같은 증거 구성으로 다시 만들지 않습니다.</p>}
        <Textarea label="생성 사유" required rows={2} maxLength={1800} value={captureReason} disabled={captureDisabled || !inReview || existingCurrent} onChange={(change) => setCaptureReason(change.target.value)} error={captureErrors.reason ?? captureErrors.state} />
        <div className={styles.formActions}>
          {captureUncertain
            ? <Button onClick={() => { void capture.reconfirm(snapshotCreatePath(view.caseId), (data) => isCapturedSnapshot(data, view)).then(captureDone) }} loading={captureSending} disabled={locked}>Snapshot 생성 재확인</Button>
            : <Button onClick={onCapture} loading={captureSending} disabled={locked || !inReview || existingCurrent}>{captureSending ? 'Snapshot 생성 요청 중' : 'EvidenceSnapshot 생성'}</Button>}
        </div>
        <MutationStatus attempt={capture.attempt?.kind === 'conflict' ? null : capture.attempt} successText={null} />
      </div>
    </Card>
    <Card className={styles.panel} aria-label="보고서 초안">
      <div className={styles.panelHeading}><h2>보고서 초안 (ReportVersion)</h2></div>
      <p className={styles.caution}>초안은 검토 담당이 작성한 보고서 개정이며 승인된 보고서가 아닙니다. 서버는 초안의 수정과 삭제를 제공하지 않아 새 개정으로만 저장합니다.</p>
      <DraftList query={drafts} items={draftItems} page={draftPage} setPage={setDraftPage} />
      {createdDraft && <section className={styles.created} aria-label="방금 저장한 초안"><h3>방금 저장한 초안</h3><DraftFacts draft={createdDraft} /></section>}
      <div className={styles.form}>
        <h3>새 초안 작성</h3>
        {!inReview && <p className={styles.blocked} role="note">Case가 검토 중 상태일 때만 작성할 수 있습니다.</p>}
        <Select label="기준 EvidenceSnapshot" required value={draftSnapshotId} disabled={draftDisabled || !inReview} onChange={(change) => setDraftSnapshotId(change.target.value)} error={draftErrors.evidenceSnapshotId}>
          <option value="">선택해 주세요</option>
          {currentSnapshots.map((item) => <option key={item.evidenceSnapshotId} value={item.evidenceSnapshotId}>증거 개정 {item.evidenceRevision}, {formatUtc(item.capturedAt)}</option>)}
        </Select>
        {inReview && snapshotItems !== null && currentSnapshots.length === 0 && <p className={styles.caution}>현재 증거 개정 번호의 Snapshot이 이 목록 페이지에 없습니다. Snapshot을 먼저 생성하거나 첫 페이지를 확인해 주세요.</p>}
        <Input label="제목" required maxLength={160} value={draft.title} disabled={draftDisabled || !inReview} onChange={setDraftField('title')} error={draftErrors.title} />
        <Textarea label="평가" required rows={4} maxLength={6000} value={draft.assessment} disabled={draftDisabled || !inReview} onChange={setDraftField('assessment')} error={draftErrors.assessment} />
        <Textarea label="한계" required rows={3} maxLength={3000} value={draft.limitations} disabled={draftDisabled || !inReview} onChange={setDraftField('limitations')} error={draftErrors.limitations} />
        <Textarea label="결론" required rows={3} maxLength={3000} value={draft.conclusion} disabled={draftDisabled || !inReview} onChange={setDraftField('conclusion')} error={draftErrors.conclusion} />
        <Textarea label="작성 사유" required rows={2} maxLength={1800} value={draft.reason} disabled={draftDisabled || !inReview} onChange={setDraftField('reason')} error={draftErrors.reason} />
        <div className={styles.formActions}>
          {writeUncertain
            ? <Button onClick={() => { void write.reconfirm(reportVersionCreatePath(view.caseId), (data) => data.caseId === view.caseId && data.status === 'DRAFT').then(draftDone) }} loading={writeSending} disabled={locked}>초안 저장 재확인</Button>
            : <Button onClick={onDraft} loading={writeSending} disabled={locked || !inReview}>{writeSending ? '초안 저장 요청 중' : '보고서 초안 저장'}</Button>}
        </div>
        <MutationStatus attempt={write.attempt?.kind === 'conflict' ? null : write.attempt} successText={null} />
      </div>
    </Card>
  </>
}

type ListQuery<T> = ReturnType<typeof useAdminQuery<T>>

function listFailure<T>(query: ListQuery<T>, retry: () => void) {
  const result = query.result
  const failure = result === null || result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result?.kind === 'success' ? result.status : 0 } : result
  const message = describeAdminApiFailure(failure, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
  return <ErrorState title={message.title} description={message.description} onRetry={retry} />
}

function SnapshotList({ query, items, page, setPage, selectedId, onSelect }: {
  query: ListQuery<{ items: EvidenceSnapshot[]; page: number; pageSize: number; hasNext: boolean }>
  items: EvidenceSnapshot[] | null; page: number; setPage: (page: number) => void; selectedId: string | null; onSelect: (id: string) => void
}) {
  if (query.result === null) return <LoadingSkeleton label="EvidenceSnapshot 목록을 불러오는 중" />
  if (items === null) return listFailure(query, query.retry)
  const hasNext = query.result.kind === 'success' && query.result.data.hasNext
  return <>
    {items.length === 0
      ? <EmptyState title={page === 0 ? '생성된 EvidenceSnapshot이 없습니다' : '이 페이지에 표시할 Snapshot이 없습니다'} description={page === 0 ? '서버에 저장된 Snapshot 기록이 없습니다. 조회 장애가 아닙니다.' : '요청한 페이지가 목록 범위를 벗어났습니다.'} />
      : <ul className={styles.recordList} aria-label="EvidenceSnapshot 목록">{items.map((item) => <li key={item.evidenceSnapshotId}>
        <span>증거 개정 {item.evidenceRevision}, <time dateTime={item.capturedAt}>{formatUtc(item.capturedAt)}</time></span>
        <span className={styles.idCell}>{item.manifestSha256}</span>
        <span>{sourceIntegrityLabels[item.sourceIntegrity]}</span>
        <Button variant="secondary" size="small" aria-pressed={item.evidenceSnapshotId === selectedId} onClick={() => onSelect(item.evidenceSnapshotId)}>서버에서 상세 재확인</Button>
      </li>)}</ul>}
    {(page > 0 || hasNext) && <nav className={styles.pagination} aria-label="Snapshot 목록 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 Snapshot</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!hasNext} onClick={() => setPage(page + 1)}>다음 Snapshot</Button></nav>}
  </>
}

function SnapshotDetail({ caseId, snapshotId }: { caseId: string; snapshotId: string }) {
  const { result, retry } = useAdminQuery(snapshotDetailPath(caseId, snapshotId), snapshotSchema)
  let content
  if (result === null) content = <LoadingSkeleton label="Snapshot 상세를 서버에서 다시 불러오는 중" />
  else if (result.kind !== 'success' || result.data.evidenceSnapshotId !== snapshotId || result.data.caseId !== caseId) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, 'Snapshot을 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else content = <SnapshotFacts snapshot={result.data} />
  return <section className={styles.created} aria-label="Snapshot 상세 재확인"><h3>Snapshot 상세 (서버 재조회)</h3>{content}</section>
}

function DraftList({ query, items, page, setPage }: {
  query: ListQuery<{ items: ReportVersionDraft[]; page: number; pageSize: number; hasNext: boolean }>
  items: ReportVersionDraft[] | null; page: number; setPage: (page: number) => void
}) {
  if (query.result === null) return <LoadingSkeleton label="보고서 초안 목록을 불러오는 중" />
  if (items === null) return listFailure(query, query.retry)
  const hasNext = query.result.kind === 'success' && query.result.data.hasNext
  return <>
    {items.length === 0
      ? <EmptyState title={page === 0 ? '저장된 보고서 초안이 없습니다' : '이 페이지에 표시할 초안이 없습니다'} description={page === 0 ? '서버에 저장된 초안 기록이 없습니다. 조회 장애가 아닙니다.' : '요청한 페이지가 목록 범위를 벗어났습니다.'} />
      : <ul className={styles.recordList} aria-label="보고서 초안 목록">{items.map((item) => <li key={item.reportVersionId}>
        <span>개정 {item.revision}, {reportVersionStatusLabels[item.status]}, <time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time></span>
        <span className={styles.idCell}>{item.reportVersionId}</span>
        <span>템플릿 {item.templateVersion}, 증거 개정 {item.evidenceRevision}</span>
        <span className={styles.idCell}>본문 SHA-256 {item.contentSha256}</span>
      </li>)}</ul>}
    {(page > 0 || hasNext) && <nav className={styles.pagination} aria-label="초안 목록 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 초안</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!hasNext} onClick={() => setPage(page + 1)}>다음 초안</Button></nav>}
  </>
}
