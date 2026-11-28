import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import type { AdminApiResult } from '../../api/adminApiClient'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Input } from '../../components/common/FormControls'
import { useAdminApiClient, useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { adminEventPageSchema, adminEventsPath } from '../admin-events/adminEventsApi'
import { jobSchema, uploadSessionSchema, completeUploadPath, candidatesPath, candidatePreviewSchema, ledgerImportPath, publishPath, publicationSchema, uploadSessionPath, inspectSupplierCsv } from '../admin-ledger-imports/ledgerImportApi'
import type { LedgerImportJob, SupplierCsvMetadata } from '../admin-ledger-imports/ledgerImportApi'
import { multiEventAcceptedSchema, multiEventAvailablePerformancesPath, multiEventCandidateFamiliesPath, multiEventCandidateFamilyPageSchema, multiEventRunPath, multiEventRunSchema } from '../admin-multi-event/multiEventInvestigationApi'
import type { MultiEventCandidate, MultiEventCandidateFamily, MultiEventRun } from '../admin-multi-event/multiEventInvestigationApi'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { buildSupplierRegistrationRequest, investigationExportPath, investigationRevealPath, investigationTargetPageSchema, investigationTargetsPath, scopeKey } from './investigationWizardApi'
import type { InvestigationTargetPage } from './investigationWizardApi'
import { readInvestigationWizardSnapshot, writeInvestigationWizardSnapshot } from './investigationWizardState'
import type { InvestigationScopeDraft, InvestigationSelectionRef, InvestigationWizardSnapshot } from './investigationWizardState'
import styles from './InvestigationWizard.module.css'
import caseStyles from '../admin-cases/Cases.module.css'
import { caseListRoute } from '../admin-cases/caseApi'
import trackStyles from '../admin-track1/Track1.module.css'

const steps = [
  { path: '1', title: '예매 내역 올리기', caption: '예매처 CSV와 코드 등록' },
  { path: '2', title: '조사 범위 고르기', caption: '공연, 회차, 기간 설정' },
  { path: '3', title: '의심 묶음 찾기', caption: '가족 후보와 조사 우선순위' },
  { path: '4', title: '의심 묶음 검토', caption: '근거와 조사 대상 확인' },
  { path: '5', title: '결과와 한계 확인', caption: '담당자 검토 자료' },
] as const

const availablePerformancePageSchema = z.object({
  items: z.array(z.object({ eventId: z.string(), performanceId: z.string(), eventReference: z.string(), sourceBatchId: z.string(), ledgerVersionId: z.string() })),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(100),
  hasNext: z.boolean(),
})

type PublishedScope = { eventId: string; performanceId: string }
type InvestigationRunContext = { eventId: string; runId: string }
type SelectedInvestigation = { eventId: string; runId: string; familyPage: number; run: MultiEventRun; family: MultiEventCandidateFamily; candidate: MultiEventCandidate }

export function InvestigationWizardRoute() {
  const { state } = useAdminAuth()
  const { step: stepParam } = useParams()
  if (state.status === 'preview') return <AdminPagePlaceholder title="암표 조사 5단계" description="인증된 관리자 세션에서만 실제 조사 API를 호출합니다." />
  const step = stepParam ?? '1'
  if (!steps.some((item) => item.path === step)) return <Navigate to="/app/investigate/1" replace />
  return <InvestigationWizard step={step} />
}

function InvestigationWizard({ step }: { step: string }) {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<InvestigationWizardSnapshot>(() => readInvestigationWizardSnapshot())
  const [selection, setSelection] = useState<SelectedInvestigation | null>(null)
  const goTo = (next: string) => navigate(`/app/investigate/${next}`)
  const updateSnapshot = useCallback((change: Partial<InvestigationWizardSnapshot>) => {
    setSnapshot((current) => ({ ...current, ...change }))
  }, [])
  useEffect(() => { writeInvestigationWizardSnapshot(snapshot) }, [snapshot])
  const onPublished = useCallback((scopes: PublishedScope[]) => {
    setSelection(null)
    setSnapshot((current) => ({ ...current, publishedScopes: scopes, runContext: null, selection: null, scopeDraft: null }))
  }, [])
  const onImportIdChange = useCallback((importId: string | null) => updateSnapshot({ importId }), [updateSnapshot])
  const onScopeDraftChange = useCallback((scopeDraft: InvestigationScopeDraft) => {
    setSnapshot((current) => JSON.stringify(current.scopeDraft) === JSON.stringify(scopeDraft) ? current : { ...current, scopeDraft })
  }, [])
  const onRunCreated = useCallback((value: InvestigationRunContext) => {
    setSelection(null)
    updateSnapshot({ runContext: value, selection: null })
  }, [updateSnapshot])
  const onCandidateSelected = useCallback((value: SelectedInvestigation) => {
    setSelection(value)
    updateSnapshot({
      runContext: { eventId: value.eventId, runId: value.runId },
      selection: { familyPage: value.familyPage, familyId: value.family.familyId, candidateId: value.candidate.candidateId },
    })
  }, [updateSnapshot])
  const onSelectionRestored = useCallback((value: SelectedInvestigation) => setSelection((current) => current ?? value), [])
  const restoreSelection = step === '4' || step === '5' ? snapshot.selection : null

  return <main className={styles.page}>
    <header className={styles.heading}>
      <p className={styles.eyebrow}>관리자 조사 흐름</p>
      <h1>암표 조사 5단계</h1>
      <p>분석 점수는 검토 순서를 돕는 신호입니다. 후보를 위반이나 부정 거래로 확정하지 않습니다.</p>
    </header>
    <nav className={styles.stepNav} aria-label="조사 단계">
      {steps.map((item, index) => <button key={item.path} type="button" aria-current={step === item.path ? 'step' : undefined} onClick={() => goTo(item.path)} className={step === item.path ? styles.currentStep : ''}>
        <span>{index + 1}</span><strong>{item.title}</strong><small>{item.caption}</small>
      </button>)}
    </nav>
    {step === '1' && <SupplierCodeImportStep initialImportId={snapshot.importId} onImportIdChange={onImportIdChange} onPublished={onPublished} />}
    {step === '2' && <AnalysisScopeStep publishedScopes={snapshot.publishedScopes} initialDraft={snapshot.scopeDraft} onDraftChange={onScopeDraftChange} onRunCreated={onRunCreated} />}
    {step === '3' && <CandidateFamiliesStep runContext={snapshot.runContext} initialPage={snapshot.selection?.familyPage ?? 0} onSelect={onCandidateSelected} />}
    {step === '4' && (selection !== null ? <TargetReviewStep key={`${selection.runId}:${selection.candidate.candidateId}`} selection={selection} /> : restoreSelection !== null && snapshot.runContext !== null
      ? <RestoreSelectedInvestigation runContext={snapshot.runContext} reference={restoreSelection} onResolved={onSelectionRestored} />
      : <section className={styles.emptyPanel}><EmptyState title="검토할 후보를 먼저 선택해 주세요" description="3단계에서 완료된 분석을 열고 후보 가족의 구성원을 선택합니다." /><Button onClick={() => goTo('3')}>3단계로 이동</Button></section>)}
    {step === '5' && <FinalResultStep selection={selection} restore={selection === null && restoreSelection !== null && snapshot.runContext !== null
      ? <RestoreSelectedInvestigation runContext={snapshot.runContext} reference={restoreSelection} onResolved={onSelectionRestored} /> : null} />}
    <footer className={styles.footerNote}>참조번호는 권한과 사유를 확인한 후에만 열 수 있습니다. 실제 값은 현재 화면 메모리에서만 처리되며 화면을 벗어나면 지웁니다.</footer>
  </main>
}

function SupplierCodeImportStep({ initialImportId, onImportIdChange, onPublished }: {
  initialImportId: string | null; onImportIdChange: (importId: string | null) => void; onPublished: (scopes: PublishedScope[]) => void
}) {
  const client = useAdminApiClient()
  const [file, setFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<SupplierCsvMetadata | null>(null)
  const [sourceSystem, setSourceSystem] = useState('')
  const [sourceBatchId, setSourceBatchId] = useState('')
  const [scopeAsOf, setScopeAsOf] = useState('')
  const [checkpoints, setCheckpoints] = useState<Record<string, { cursorEnd: string; sourceSequenceEnd: string }>>({})
  const [job, setJob] = useState<LedgerImportJob | null>(null)
  const [registration, setRegistration] = useState<{ key: string; body: unknown } | null>(null)
  const [publicationKey, setPublicationKey] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkingFile, setCheckingFile] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const restoredImport = useAdminQuery(initialImportId === null ? null : ledgerImportPath(initialImportId), jobSchema)
  const restoredJob = initialImportId !== null && restoredImport.result?.kind === 'success'
    && restoredImport.result.data.importId === initialImportId ? restoredImport.result.data : null
  const activeJob = job ?? restoredJob
  const parsedJob = activeJob
  const candidatePreview = useAdminQuery(parsedJob?.status === 'READY_TO_PUBLISH' ? candidatesPath(parsedJob.importId) : null, candidatePreviewSchema)
  const publishReady = candidatePreview.result?.kind === 'success' && candidateCanPublish(candidatePreview.result.data, parsedJob)
  const registrationPending = registration !== null

  const inspectFile = async (selected: File | null) => {
    setFile(selected)
    setMetadata(null)
    setCheckpoints({})
    if (selected === null) return
    setCheckingFile(true)
    try {
      const result = await inspectSupplierCsv(selected)
      setMetadata(result)
      setCheckpoints(Object.fromEntries(result.scopes.map((scope) => [scopeKey(scope.sourceEventCode, scope.sourcePerformanceCode), { cursorEnd: '', sourceSequenceEnd: '' }])))
      setNotice(`파일 정보 확인 완료: ${result.rows.toLocaleString()}행, 회차 ${result.scopes.length}개.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'CSV 메타데이터를 확인하지 못했습니다.')
    } finally { setCheckingFile(false) }
  }

  const sendRegistration = async (pending: { key: string; body: unknown }) => {
    setBusy(true)
    const result = await client.request('/api/v1/admin/ledger-imports', { method: 'POST', body: pending.body, idempotencyKey: pending.key, schema: jobSchema, successStatus: 201 })
    setBusy(false)
    if (result.kind === 'success') {
      if (metadata === null || result.data.declaredObjectSha256 !== metadata.sha256 || result.data.declaredFileBytes !== metadata.bytes || result.data.declaredRowCount !== metadata.rows || result.data.scopeKeyType !== 'SUPPLIER_CODE') {
        setNotice('등록 응답이 현재 파일 범위와 일치하지 않습니다. 서버 응답을 확인하기 전에는 업로드하지 않습니다.')
        return
      }
      setJob(result.data)
      onImportIdChange(result.data.importId)
      setRegistration(null)
      setNotice(`SUPPLIER_CODE 등록 완료. 작업 상태: ${result.data.status}`)
      return
    }
    const unknown = result.kind === 'network' || result.kind === 'invalidResponse' || (result.kind === 'problem' && result.status >= 500)
    if (unknown) {
      setRegistration(pending)
      setNotice(`${describeAdminApiFailure(result, '등록 결과를 확인하지 못했습니다').title} 같은 요청 키와 본문으로만 다시 확인할 수 있습니다.`)
    } else if (result.kind === 'problem' && result.status === 422 && result.code === 'BULK_V3_RAW_INTAKE_DISABLED') {
      setNotice('이 서버에서는 v3 원본 반입 기능이 비활성 상태입니다. 기능 설정이 확인될 때까지 등록을 진행할 수 없습니다.')
    } else setNotice(describeAdminApiFailure(result, '등록 요청이 거부되었습니다').title)
  }

  const submitRegistration = async () => {
    if (registration !== null) { setNotice('기존 요청 결과를 같은 키와 본문으로 먼저 확인해 주세요.'); return }
    if (metadata === null) { setNotice('먼저 CSV 파일을 선택하고 파일 정보를 확인해 주세요.'); return }
    const built = buildSupplierRegistrationRequest({ metadata, sourceSystem, sourceBatchId, scopeAsOf, checkpoints })
    if (!built.ok) { setNotice(built.message); return }
    const key = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null
    if (!key) { setNotice('안전한 요청 키를 만들 수 없습니다.'); return }
    await sendRegistration({ key, body: built.body })
  }

  const retryRegistration = () => { if (registration !== null) void sendRegistration(registration) }

  const refreshJob = async () => {
    if (activeJob === null) return
    setBusy(true)
    const result = await client.request(ledgerImportPath(activeJob.importId), { schema: jobSchema })
    setBusy(false)
    if (result.kind === 'success' && result.data.importId === activeJob.importId) {
      setJob(result.data)
      setNotice(`작업 상태를 확인했습니다: ${result.data.status}`)
    } else setNotice(result.kind === 'success' ? '다른 작업의 상태가 반환되어 표시하지 않았습니다.' : describeAdminApiFailure(result, '작업 상태를 확인하지 못했습니다').title)
  }

  const upload = async (selectedFile: File | null = file) => {
    if (activeJob === null || selectedFile === null || metadata === null) { setNotice('등록에 사용한 CSV 파일을 다시 선택해 주세요.'); return }
    setBusy(true)
    try {
      const fresh = await inspectSupplierCsv(selectedFile)
      if (fresh.bytes !== activeJob.declaredFileBytes || fresh.sha256 !== activeJob.declaredObjectSha256 || fresh.rows !== activeJob.declaredRowCount) throw new Error('선택한 파일의 크기, SHA-256 또는 행 수가 등록 때와 다릅니다. 업로드하지 않았습니다.')
      const session = await client.request(uploadSessionPath(activeJob.importId), { method: 'POST', body: {}, schema: uploadSessionSchema, successStatus: 201 })
      if (session.kind !== 'success') throw new Error(describeAdminApiFailure(session, '업로드 세션을 만들지 못했습니다').title)
      const url = new URL(session.data.uploadUrl)
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('안전하지 않은 업로드 주소를 받았습니다. 파일을 보내지 않았습니다.')
      const response = await fetch(url, { method: 'PUT', body: selectedFile, headers: { 'Content-Type': 'text/csv' }, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error(`비공개 파일 업로드가 실패했습니다 (${response.status}).`)
      const completed = await client.request(completeUploadPath(activeJob.importId), { method: 'POST', body: {}, schema: jobSchema, successStatus: 200 })
      if (completed.kind !== 'success') throw new Error(describeAdminApiFailure(completed, '업로드 완료 결과를 확인하지 못했습니다').title)
      if (completed.data.importId !== activeJob.importId) throw new Error('다른 등록 작업의 완료 응답이 반환되어 표시하지 않았습니다.')
      setJob(completed.data)
      setNotice(`업로드 완료. 작업 상태: ${completed.data.status}`)
    } catch (error) {
      const confirmed = await client.request(ledgerImportPath(activeJob.importId), { schema: jobSchema })
      if (confirmed.kind === 'success' && confirmed.data.importId === activeJob.importId) {
        setJob(confirmed.data)
        setNotice(`업로드 결과를 다시 확인했습니다. 작업 상태: ${confirmed.data.status}`)
      } else setNotice(error instanceof Error ? error.message : '업로드 상태를 확인하지 못했습니다.')
    } finally { setBusy(false) }
  }

  const publish = async () => {
    if (activeJob === null || !publishReady) { setNotice('모든 후보 version과 현재 원장 head를 확인한 뒤 공개할 수 있습니다.'); return }
    setBusy(true)
    const key = publicationKey ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null)
    if (!key) { setBusy(false); setNotice('안전한 요청 키를 만들 수 없습니다.'); return }
    setPublicationKey(key)
    const result = await client.request(publishPath(activeJob.importId), { method: 'POST', body: {}, idempotencyKey: key, schema: publicationSchema, successStatus: 200 })
    setBusy(false)
    if (result.kind === 'success' && result.data.importId === activeJob.importId) {
      setPublicationKey(null)
      const scopes = result.data.scopes.map(({ eventId, performanceId }) => ({ eventId, performanceId }))
      onPublished(scopes)
      setNotice('모든 supplier code 회차의 공개가 완료되었습니다. 공개는 분석 성공이나 구매 한도 검증을 뜻하지 않습니다.')
      const refreshed = await client.request(ledgerImportPath(activeJob.importId), { schema: jobSchema })
      if (refreshed.kind === 'success' && refreshed.data.importId === activeJob.importId) setJob(refreshed.data)
    } else if (result.kind === 'success') setNotice('다른 등록 작업의 공개 응답이 반환되어 표시하지 않았습니다. 같은 요청 키로 다시 확인해 주세요.')
    else if (result.kind === 'network' || result.kind === 'invalidResponse' || (result.kind === 'problem' && result.status >= 500)) {
      setNotice(`${describeAdminApiFailure(result, '공개 결과를 확인하지 못했습니다').title} 같은 공개 요청 키로 결과를 다시 확인할 수 있습니다.`)
    } else {
      setPublicationKey(null)
      setNotice(`${describeAdminApiFailure(result, '공개 결과를 확인하지 못했습니다').title} 공개 상태를 다시 확인해 주세요.`)
    }
  }

  return <section className={styles.panelStack} aria-label="예매처 CSV 등록">
    <Card className={trackStyles.panel}>
      <div className={trackStyles.sectionHeading}><h2>예매처 CSV 등록</h2><span>v3 SUPPLIER_CODE</span></div>
      {initialImportId !== null && activeJob === null && (restoredImport.result === null
        ? <LoadingSkeleton label="저장된 등록 작업 상태를 복구하는 중" />
        : restoredImport.result.kind !== 'success'
          ? <ErrorState title={describeAdminApiFailure(restoredImport.result, '저장된 등록 작업을 복구하지 못했습니다').title} description="작업을 확인할 수 없으면 CSV와 참조번호는 복구하지 않습니다." onRetry={restoredImport.retry} />
          : <p className={styles.notice} role="status">저장된 등록 작업 응답이 현재 작업과 일치하지 않아 표시하지 않았습니다.</p>)}
      <p className={trackStyles.muted}>CSV의 예매처 공연 코드와 파일 SHA-256, 바이트 수, 행 수를 읽어 등록합니다. TD 내부 UUID를 예매처에 요구하지 않습니다. 원본 파일은 브라우저 저장소에 쓰지 않습니다.</p>
      <div className={caseStyles.form}>
        <Input ref={fileInput} label="예매처 CSV 파일" type="file" accept=".csv,text/csv" disabled={busy || activeJob !== null || registrationPending} onChange={(event) => void inspectFile(event.target.files?.[0] ?? null)} />
        <div className={styles.inlineFields}>
          <Input label="예매처 시스템 코드" required maxLength={64} value={sourceSystem} disabled={busy || activeJob !== null || registrationPending} onChange={(event) => setSourceSystem(event.target.value)} />
          <Input label="예매처 배치 코드" required maxLength={128} value={sourceBatchId} disabled={busy || activeJob !== null || registrationPending} onChange={(event) => setSourceBatchId(event.target.value)} />
        </div>
        <Input label="전체 스냅샷 기준시각" required maxLength={64} placeholder="2026-11-28T12:00:00+09:00" value={scopeAsOf} disabled={busy || activeJob !== null || registrationPending} onChange={(event) => setScopeAsOf(event.target.value)} />
        <p className={trackStyles.muted}>기준시각, cursorEnd, sourceSequenceEnd는 원본 제공 내역에 맞춰 입력합니다. 행 수나 파일명에서 추정하지 않습니다. 이 화면은 FULL_SNAPSHOT 등록을 사용합니다.</p>
        {checkingFile && <LoadingSkeleton label="CSV 메타데이터와 SHA-256을 확인하는 중" />}
        {metadata !== null && <>
          <dl className={styles.metadata}>
            <div><dt>파일 바이트</dt><dd>{metadata.bytes.toLocaleString()}</dd></div>
            <div><dt>데이터 행</dt><dd>{metadata.rows.toLocaleString()}</dd></div>
            <div><dt>회차 수</dt><dd>{metadata.scopes.length}</dd></div>
            <div className={styles.hash}><dt>파일 SHA-256</dt><dd>{metadata.sha256}</dd></div>
          </dl>
          {metadata.scopes.map((scope) => {
            const key = scopeKey(scope.sourceEventCode, scope.sourcePerformanceCode)
            const value = checkpoints[key] ?? { cursorEnd: '', sourceSequenceEnd: '' }
            return <fieldset key={key} className={styles.scopeBox}>
              <legend>예매처 회차 코드 범위</legend>
              <p><strong>{scope.eventTitle}</strong> / {scope.sourceEventCode} / {scope.sourcePerformanceCode}</p>
              <p>회차 시작 {scope.performanceStartsAt}, 행 {scope.declaredRowCount.toLocaleString()}, 예매처가 제공한 1인당 한도 {scope.perAccountLimit ?? '미제공'}</p>
              <div className={styles.inlineFields}>
                <Input label="원본 cursorEnd" required maxLength={256} value={value.cursorEnd} disabled={busy || activeJob !== null || registrationPending} onChange={(event) => setCheckpoints((current) => ({ ...current, [key]: { ...value, cursorEnd: event.target.value } }))} />
                <Input label="원본 sourceSequenceEnd" required inputMode="numeric" value={value.sourceSequenceEnd} disabled={busy || activeJob !== null || registrationPending} onChange={(event) => setCheckpoints((current) => ({ ...current, [key]: { ...value, sourceSequenceEnd: event.target.value } }))} />
              </div>
            </fieldset>
          })}
        </>}
        <div className={styles.actions}>
          <Button loading={busy} disabled={checkingFile || activeJob !== null || metadata === null} onClick={() => void submitRegistration()}>SUPPLIER_CODE 등록</Button>
          {registration !== null && <Button variant="secondary" loading={busy} onClick={retryRegistration}>같은 등록 요청 다시 확인</Button>}
          {activeJob !== null && <Button variant="secondary" loading={busy} onClick={() => void refreshJob()}>작업 상태 새로 고침</Button>}
        </div>
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </div>
    </Card>
    {activeJob !== null && <SupplierImportJob job={activeJob} file={file} busy={busy} candidatePreview={candidatePreview.result} publishReady={publishReady} publicationPending={publicationKey !== null} onUpload={(selectedFile) => void upload(selectedFile)} onPublish={() => void publish()} onRefresh={() => void refreshJob()} onRetryPreview={candidatePreview.retry} />}
  </section>
}

function SupplierImportJob({ job, file, busy, candidatePreview, publishReady, publicationPending, onUpload, onPublish, onRefresh, onRetryPreview }: {
  job: LedgerImportJob; file: File | null; busy: boolean; candidatePreview: ReturnType<typeof useAdminQuery<z.infer<typeof candidatePreviewSchema>>>['result']; publishReady: boolean; publicationPending: boolean; onUpload: (selectedFile: File | null) => void; onPublish: () => void; onRefresh: () => void; onRetryPreview: () => void
}) {
  const [uploadFile, setUploadFile] = useState<File | null>(file)
  return <Card className={trackStyles.panel} aria-label="예매처 CSV 등록 작업">
    <div className={trackStyles.sectionHeading}><h2>등록 작업</h2><Button size="small" variant="secondary" disabled={busy} onClick={onRefresh}>상태 다시 확인</Button></div>
    <dl className={styles.metadata}>
      <div><dt>작업 상태</dt><dd>{job.status}</dd></div>
      <div><dt>처리 행</dt><dd>{job.processedRowCount.toLocaleString()} / {job.declaredRowCount.toLocaleString()}</dd></div>
      <div><dt>수락 / 거부</dt><dd>{job.acceptedRowCount.toLocaleString()} / {job.rejectedRowCount.toLocaleString()}</dd></div>
      <div><dt>범위 방식</dt><dd>{job.scopeKeyType ?? '확인되지 않음'}</dd></div>
    </dl>
    {job.supplierScopes && <ul className={styles.mappingList}>{job.supplierScopes.map((scope) => <li key={`${scope.sourceEventCode}:${scope.sourcePerformanceCode}`}>
      {scope.eventTitle} / {scope.sourceEventCode} / {scope.sourcePerformanceCode}: {scope.eventId ?? '공연 미확인'} / {scope.performanceId ?? '회차 미확인'}
      {scope.eventCreated || scope.performanceCreated ? <span> (새로 생성: {scope.eventCreated ? '공연' : ''}{scope.eventCreated && scope.performanceCreated ? ', ' : ''}{scope.performanceCreated ? '회차' : ''})</span> : null}
    </li>)}</ul>}
    {job.status === 'CREATED' && <div className={caseStyles.form}>
      <Input label="등록한 CSV 파일을 다시 선택" type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} />
      <Button size="small" loading={busy} disabled={uploadFile === null} onClick={() => onUpload(uploadFile)}>파일 SHA-256을 다시 확인하고 비공개 업로드</Button>
      <p className={trackStyles.muted}>업로드 세션은 한 번만 발급됩니다. 결과가 불확실하면 같은 작업의 상태를 새로 확인합니다.</p>
    </div>}
    {job.status === 'UPLOAD_PENDING' && <p className={styles.notice} role="note">업로드 세션이 이미 발급되었습니다. 세션이 만료되었거나 사라진 경우 서버의 상태를 확인하고 작업을 다시 등록해야 할 수 있습니다.</p>}
    {job.status === 'READY_TO_PUBLISH' && <>
      {candidatePreview === null ? <LoadingSkeleton label="공개 전 원장 범위를 확인하는 중" /> : candidatePreview.kind !== 'success'
        ? <ErrorState title={describeAdminApiFailure(candidatePreview, '공개 전 원장 범위를 확인하지 못했습니다').title} description="조회 실패를 공개 가능이나 정상 결과로 처리하지 않습니다." onRetry={onRetryPreview} />
        : <section aria-label="공개 전 원장 범위 확인"><h3>공개 전 원장 범위 확인</h3><p>준비 {candidatePreview.data.preparationStatus}, 데이터 {candidatePreview.data.dataStatus}</p>
          <ul>{candidatePreview.data.scopes.map((scope) => <li key={`${scope.eventId}:${scope.performanceId}`}>공연 {scope.eventId}, 회차 {scope.performanceId}: {scope.versionStatus ?? 'version 미준비'}, head {scope.headStatus}</li>)}</ul>
          {!publishReady && <p className={styles.notice} role="note">모든 회차의 원장 version과 현재 head 관계가 확인되어야 공개할 수 있습니다.</p>}
        </section>}
      <Button size="small" loading={busy} disabled={!publishReady} onClick={onPublish}>{publicationPending ? '같은 공개 요청 결과 다시 확인' : '모든 회차 원장 공개'}</Button>
    </>}
    {job.status === 'PUBLISHED' && <p className={styles.notice} role="status">원장 공개가 완료되었습니다. 이는 분석 성공, 구매 한도 검증 또는 정상 결과 0건을 뜻하지 않습니다. 2단계에서 조사 범위를 설정해 주세요.</p>}
    {['FAILED_RETRYABLE', 'REJECTED', 'CANCELLED'].includes(job.status) && <p className={styles.notice} role="alert">작업이 {job.status} 상태입니다. 원장 공개나 분석 가능 상태로 취급하지 않습니다. 상세 원인 코드는 작업 상태에서 확인해 주세요.</p>}
  </Card>
}

function candidateCanPublish(preview: z.infer<typeof candidatePreviewSchema>, job: LedgerImportJob | null) {
  if (job === null || preview.importId !== job.importId || preview.preparationStatus !== 'READY' || preview.dataStatus !== 'COMPLETE' || preview.scopes.length !== job.supplierScopes?.length) return false
  const expected = new Set((job.supplierScopes ?? []).map((scope) => `${scope.eventId}:${scope.performanceId}`))
  return preview.scopes.every((scope) => scope.eventId !== null && scope.performanceId !== null
    && expected.delete(`${scope.eventId}:${scope.performanceId}`) && scope.versionId !== null && scope.generation !== null
    && scope.revision !== null && scope.versionStatus === 'READY' && scope.headStatus === 'CURRENT') && expected.size === 0
}

function AnalysisScopeStep({ publishedScopes, initialDraft, onDraftChange, onRunCreated }: {
  publishedScopes: PublishedScope[]; initialDraft: InvestigationScopeDraft | null;
  onDraftChange: (draft: InvestigationScopeDraft) => void; onRunCreated: (value: InvestigationRunContext) => void
}) {
  const client = useAdminApiClient()
  const [eventPage, setEventPage] = useState(initialDraft?.eventPage ?? 0)
  const events = useAdminQuery(adminEventsPath(eventPage), adminEventPageSchema)
  const [selectedEventsOverride, setSelectedEventsOverride] = useState<string[] | null>(initialDraft?.selectedEvents ?? null)
  const [selectedPerformanceMapOverride, setSelectedPerformanceMapOverride] = useState<Record<string, string[]> | null>(initialDraft?.selectedPerformanceMap ?? null)
  const [availableCounts, setAvailableCounts] = useState<Record<string, number>>({})
  const [periodStart, setPeriodStart] = useState(() => initialDraft?.periodStart ?? localInputDate(daysAgo(30)))
  const [periodEnd, setPeriodEnd] = useState(() => initialDraft?.periodEnd ?? localInputDate(new Date()))
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState<{ key: string; body: unknown; eventId: string } | null>(null)
  const defaultEvents = useMemo(() => [...new Set(publishedScopes.map((scope) => scope.eventId))], [publishedScopes])
  const defaultPerformanceMap = useMemo(() => Object.fromEntries(defaultEvents.map((eventId) => [eventId, publishedScopes.filter((scope) => scope.eventId === eventId).map((scope) => scope.performanceId)])), [defaultEvents, publishedScopes])
  const selectedEvents = selectedEventsOverride ?? defaultEvents
  const selectedPerformanceMap = selectedPerformanceMapOverride ?? defaultPerformanceMap
  const selected = useMemo(() => new Set(selectedEvents), [selectedEvents])
  const performanceCount = selectedEvents.reduce((total, eventId) => total + ((selectedPerformanceMap[eventId] ?? []).length || availableCounts[eventId] || 0), 0)

  useEffect(() => {
    onDraftChange({ eventPage, selectedEvents, selectedPerformanceMap, periodStart, periodEnd })
  }, [eventPage, onDraftChange, periodEnd, periodStart, selectedEvents, selectedPerformanceMap])

  const toggleEvent = (eventId: string) => {
    const next = selectedEvents.includes(eventId) ? selectedEvents.filter((value) => value !== eventId) : [...selectedEvents, eventId]
    setSelectedEventsOverride(next)
    if (!next.includes(eventId)) setSelectedPerformanceMapOverride((current) => { const result = { ...(current ?? defaultPerformanceMap) }; delete result[eventId]; return result })
  }

  const send = async (request: { key: string; body: unknown; eventId: string }) => {
    setSubmitting(true)
    const result = await client.request('/api/v1/admin/multi-event-investigations', { method: 'POST', body: request.body, idempotencyKey: request.key, successStatus: 202, schema: multiEventAcceptedSchema })
    setSubmitting(false)
    if (result.kind === 'success') {
      setPending(null)
      setNotice(`조사 분석 요청 접수: ${result.data.status}`)
      onRunCreated({ eventId: request.eventId, runId: result.data.runId })
      return
    }
    if (result.kind === 'network' || result.kind === 'invalidResponse' || (result.kind === 'problem' && result.status >= 500)) {
      setPending(request)
      setNotice(`${describeAdminApiFailure(result, '분석 요청 결과를 확인하지 못했습니다').title} 같은 요청 키로 결과를 다시 확인할 수 있습니다.`)
    } else setNotice(describeAdminApiFailure(result, '분석 요청이 거부되었습니다').title)
  }

  const submit = () => {
    if (pending !== null) { void send(pending); return }
    if (selectedEvents.length === 0 || performanceCount < 2) { setNotice('서버가 확인한 공개 원장 회차를 두 개 이상 선택해 주세요.'); return }
    const start = new Date(periodStart)
    const end = new Date(periodEnd)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end > new Date()) { setNotice('분석 기간을 확인해 주세요. 종료 시각은 현재보다 늦을 수 없습니다.'); return }
    const key = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null
    if (!key) { setNotice('안전한 요청 키를 만들 수 없습니다.'); return }
    const request = { key, eventId: selectedEvents[0], body: {
      eventIds: selectedEvents,
      performanceSelections: selectedEvents.map((eventId) => ({ eventId, performanceIds: selectedPerformanceMap[eventId] ?? [] })),
      analysisStartAt: start.toISOString(), analysisEndAt: end.toISOString(),
    } }
    void send(request)
  }

  return <Card className={trackStyles.panel} aria-label="조사 범위 설정과 분석 실행">
    <h2>분석 범위</h2>
    <p className={trackStyles.muted}>공개된 원장 version만 선택할 수 있습니다. 같은 공연의 다른 회차도 반복 근거가 됩니다. 1인당 구매 한도 숫자는 실제 구매 수량으로 간주하지 않습니다.</p>
    {publishedScopes.length > 0 && <p className={styles.notice}>최근 공개한 supplier code 회차 {publishedScopes.length}개를 기본 선택했습니다. 실제 공개 head를 다시 확인합니다.</p>}
    {events.result === null ? <LoadingSkeleton label="접근 가능한 공연과 공개 회차를 불러오는 중" />
      : events.result.kind !== 'success' ? <ScopeFailure result={events.result} retry={events.retry} />
        : events.result.data.items.length === 0 ? <EmptyState title="접근 가능한 공연이 없습니다" description="예매처 CSV를 공개했거나 공연 권한이 부여된 뒤 다시 불러와 주세요." />
          : <>
            <div className={styles.eventList}>{events.result.data.items.map((event) => <label key={event.id}><input type="checkbox" checked={selected.has(event.id)} disabled={pending !== null || submitting} onChange={() => toggleEvent(event.id)} /> {event.name}</label>)}</div>
            <div className={styles.actions}>
              <Button size="small" variant="secondary" disabled={eventPage === 0 || pending !== null || submitting} onClick={() => setEventPage((value) => Math.max(0, value - 1))}>공연 이전</Button>
              <Button size="small" variant="secondary" disabled={!events.result.data.hasNext || pending !== null || submitting} onClick={() => setEventPage((value) => value + 1)}>공연 다음</Button>
              <span>공연 {selectedEvents.length}개, 확인된 회차 {performanceCount}개 선택</span>
            </div>
            {selectedEvents.map((eventId) => <EventPerformancePicker key={eventId} eventId={eventId} values={selectedPerformanceMap[eventId] ?? []} disabled={pending !== null || submitting}
              onChange={(values) => setSelectedPerformanceMapOverride((current) => ({ ...(current ?? defaultPerformanceMap), [eventId]: values }))}
              onAvailable={(count) => setAvailableCounts((current) => current[eventId] === count ? current : { ...current, [eventId]: count })} />)}
            <div className={styles.inlineFields}>
              <label>분석 시작 <input type="datetime-local" value={periodStart} max={periodEnd} disabled={pending !== null || submitting} onChange={(event) => setPeriodStart(event.target.value)} /></label>
              <label>분석 종료 <input type="datetime-local" value={periodEnd} max={localInputDate(new Date())} disabled={pending !== null || submitting} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
            </div>
            <Button loading={submitting} disabled={selectedEvents.length === 0 || performanceCount < 2} onClick={submit}>{pending === null ? '조사 분석 실행' : '같은 요청 결과 다시 확인'}</Button>
            {notice && <p className={styles.notice} role="status">{notice}</p>}
          </>}
  </Card>
}

function EventPerformancePicker({ eventId, values, disabled, onChange, onAvailable }: { eventId: string; values: string[]; disabled: boolean; onChange: (values: string[]) => void; onAvailable: (count: number) => void }) {
  const [page, setPage] = useState(0)
  const query = useAdminQuery(multiEventAvailablePerformancesPath(eventId, page), availablePerformancePageSchema)
  const loaded = query.result?.kind === 'success' ? query.result.data.items.length + (query.result.data.hasNext ? 1 : 0) : 0
  useEffect(() => { onAvailable(loaded) }, [loaded, onAvailable])
  if (query.result === null) return <LoadingSkeleton label="공개 원장 회차를 확인하는 중" />
  if (query.result.kind !== 'success') return <ScopeFailure result={query.result} retry={query.retry} />
  return <section className={styles.performanceList} aria-label="공개 원장 회차">
    <h3>공연 {query.result.data.items[0]?.eventReference ?? eventId}의 회차</h3>
    {query.result.data.items.length === 0 ? <p className={styles.notice}>공개 원장 head가 있는 회차가 없습니다.</p> : <>
      <p>회차를 고르지 않으면 이 공연의 공개 회차 전체를 분석합니다.</p>
      {query.result.data.items.map((scope) => <label key={scope.performanceId}>
        <input type="checkbox" disabled={disabled} checked={values.includes(scope.performanceId)} onChange={() => onChange(values.includes(scope.performanceId) ? values.filter((value) => value !== scope.performanceId) : [...values, scope.performanceId])} />
        회차 {scope.performanceId} / 공개 batch {scope.sourceBatchId}
      </label>)}
      <div className={styles.actions}><Button size="small" variant="secondary" disabled={page === 0 || disabled} onClick={() => setPage((value) => Math.max(0, value - 1))}>회차 이전</Button><Button size="small" variant="secondary" disabled={!query.result.data.hasNext || disabled} onClick={() => setPage((value) => value + 1)}>회차 다음</Button></div>
    </>}
  </section>
}

function CandidateFamiliesStep({ runContext, initialPage, onSelect }: { runContext: InvestigationRunContext | null; initialPage: number; onSelect: (value: SelectedInvestigation) => void }) {
  const [page, setPage] = useState(initialPage)
  const path = runContext === null ? null : multiEventRunPath(runContext.eventId, runContext.runId)
  const runQuery = useAdminQuery(path, multiEventRunSchema)
  const familiesPath = runContext === null ? null : multiEventCandidateFamiliesPath(runContext.eventId, runContext.runId, page)
  const familyQuery = useAdminQuery(runQuery.result?.kind === 'success' && runQuery.result.data.status === 'COMPLETED' ? familiesPath : null, multiEventCandidateFamilyPageSchema)
  const run = runQuery.result?.kind === 'success' ? runQuery.result.data : null
  if (runContext === null) return <Card className={trackStyles.panel}><h2>완료된 분석을 선택해 주세요</h2><p>2단계에서 공개된 원장 범위와 기간을 정하고 분석을 실행합니다.</p><Link to="/app/investigate/2">2단계로 이동</Link></Card>
  if (runQuery.result === null) return <LoadingSkeleton label="분석 작업 상태를 불러오는 중" />
  if (runQuery.result.kind !== 'success') return <ScopeFailure result={runQuery.result} retry={runQuery.retry} />
  if (runQuery.result.data.status !== 'COMPLETED') return <Card className={trackStyles.panel}>
    <h2>분석 작업 상태: {runQuery.result.data.status}</h2>
    <p className={styles.notice}>완료된 결과가 아닙니다. 빈 후보 목록을 정상 0건으로 표시하지 않습니다. 작업 상태를 다시 확인해 주세요.</p>
    <Button size="small" variant="secondary" onClick={runQuery.retry}>작업 상태 다시 확인</Button>
  </Card>
  if (familyQuery.result === null) return <LoadingSkeleton label="후보 가족과 조사 근거를 불러오는 중" />
  if (familyQuery.result.kind !== 'success') return <ScopeFailure result={familyQuery.result} retry={familyQuery.retry} />
  const data = familyQuery.result.data
  return <Card className={trackStyles.panel} aria-label="후보 가족 검토">
    <div className={trackStyles.sectionHeading}><h2>의심 묶음</h2><Button size="small" variant="secondary" onClick={familyQuery.retry}>후보 새로 고침</Button></div>
    <p className={trackStyles.muted}>점수는 조사 우선순위이며 부정 거래 확률이 아닙니다. 가족 점수는 구성 후보 중 가장 높은 우선순위입니다.</p>
    {data.items.length === 0 ? <EmptyState title="완료된 분석에 표시할 의심 묶음이 없습니다" description={data.hasNext ? '다음 페이지에 더 있을 수 있습니다.' : '완료된 수집에서 저장된 후보 가족이 0개입니다.'} />
      : <div className={styles.familyList}>{data.items.map((family) => <article key={family.familyId} className={styles.familyCard}>
        <header><div><h3>의심 묶음</h3><p>조사 우선순위 {family.familyScore.toFixed(3)} / 후보 {family.candidates.length}개</p></div></header>
        {family.candidates.map((candidate) => <section key={candidate.candidateId} className={styles.candidateCard}>
          <div><strong>{candidate.priorityBand} 조사 후보</strong><span> 점수 {candidate.investigationScore.toFixed(3)} / 계정 {candidate.distinctAccountCount}개 / 회차 {candidate.distinctPerformanceCount}개</span></div>
          <ReasonList reasons={candidate.reasons ?? []} />
          <Button size="small" variant="secondary" onClick={() => { if (run !== null) onSelect({ eventId: runContext.eventId, runId: runContext.runId, familyPage: data.page, run, family, candidate }) }}>이 후보 검토</Button>
        </section>)}
      </article>)}</div>}
    <div className={styles.actions}><Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>이전 가족</Button><span>{data.page + 1} 페이지</span><Button size="small" variant="secondary" disabled={!data.hasNext} onClick={() => setPage((value) => value + 1)}>다음 가족</Button></div>
  </Card>
}

function RestoreSelectedInvestigation({ runContext, reference, onResolved }: {
  runContext: InvestigationRunContext; reference: InvestigationSelectionRef; onResolved: (value: SelectedInvestigation) => void
}) {
  const runPath = multiEventRunPath(runContext.eventId, runContext.runId)
  const runQuery = useAdminQuery(runPath, multiEventRunSchema)
  const run = runQuery.result?.kind === 'success' ? runQuery.result.data : null
  const familiesPath = run?.status === 'COMPLETED'
    ? multiEventCandidateFamiliesPath(runContext.eventId, runContext.runId, reference.familyPage) : null
  const familiesQuery = useAdminQuery(familiesPath, multiEventCandidateFamilyPageSchema)
  const families = familiesQuery.result?.kind === 'success' ? familiesQuery.result.data : null
  const family = families?.items.find((item) => item.familyId === reference.familyId) ?? null
  const candidate = family?.candidates.find((item) => item.candidateId === reference.candidateId) ?? null

  useEffect(() => {
    if (run !== null && family !== null && candidate !== null) {
      onResolved({ eventId: runContext.eventId, runId: runContext.runId, familyPage: reference.familyPage, run, family, candidate })
    }
  }, [candidate, family, onResolved, reference.familyPage, run, runContext.eventId, runContext.runId])

  if (runQuery.result === null) return <LoadingSkeleton label="저장된 조사 선택을 복구하는 중" />
  if (runQuery.result.kind !== 'success') return <ScopeFailure result={runQuery.result} retry={runQuery.retry} />
  if (runQuery.result.data.status !== 'COMPLETED') return <Card className={trackStyles.panel}>
    <h2>저장된 분석이 아직 완료되지 않았습니다</h2>
    <p className={styles.notice}>작업 상태 {runQuery.result.data.status}. 완료되지 않은 결과를 후보 없음으로 표시하지 않습니다.</p>
    <Button size="small" variant="secondary" onClick={runQuery.retry}>작업 상태 다시 확인</Button>
  </Card>
  if (familiesQuery.result === null || candidate !== null) return <LoadingSkeleton label="저장된 후보를 복구하는 중" />
  if (familiesQuery.result.kind !== 'success') return <ScopeFailure result={familiesQuery.result} retry={familiesQuery.retry} />
  return <section className={styles.emptyPanel}>
    <EmptyState title="저장된 후보를 찾지 못했습니다" description="분석 상태를 새로 확인한 뒤 3단계에서 후보를 다시 선택해 주세요." />
    <Link to="/app/investigate/3">3단계 후보 목록으로 이동</Link>
  </section>
}

function TargetReviewStep({ selection }: { selection: SelectedInvestigation }) {
  const client = useAdminApiClient()
  const [reason, setReason] = useState('')
  const [page, setPage] = useState(0)
  const [masked, setMasked] = useState<InvestigationTargetPage | null>(null)
  const [revealed, setRevealed] = useState<InvestigationTargetPage | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [access, setAccess] = useState<'unknown' | 'available' | 'forbidden' | 'not-found' | 'disabled' | 'failed'>('unknown')
  const validReason = reason.trim().length > 0 && reason.trim().length <= 500
  const listPath = investigationTargetsPath(selection.eventId, selection.runId, selection.candidate.candidateId, page)
  const revealPath = investigationRevealPath(selection.eventId, selection.runId, selection.candidate.candidateId, page)
  const exportPath = investigationExportPath(selection.eventId, selection.runId, selection.candidate.candidateId)

  const loadMasked = async () => {
    if (!validReason || listPath === null) { setNotice('조사 사유를 입력해 주세요.'); return }
    setBusy(true)
    const result = await client.requestInvestigationTargets(listPath, reason, investigationTargetPageSchema)
    setBusy(false)
    if (result.kind === 'success' && result.data.page === page && result.data.pageSize === 50) {
      setMasked(result.data)
      setRevealed(null)
      setAccess('available')
      setNotice('마스킹된 조사 대상과 구성원별 근거를 불러왔습니다.')
    } else {
      setMasked(null)
      setRevealed(null)
      if (result.kind === 'success') {
        setAccess('failed')
        setNotice('대상 응답 범위가 현재 요청과 일치하지 않아 표시하지 않았습니다.')
      } else {
        setAccess(mapAccess(result))
        setNotice(accessMessage(result))
      }
    }
  }

  const reveal = async () => {
    if (!validReason || masked === null || revealPath === null || access !== 'available') { setNotice('권한이 확인된 상태에서 사유를 입력하고 마스킹된 대상을 먼저 불러와 주세요.'); return }
    setBusy(true)
    const result = await client.requestInvestigationReveal(revealPath, reason, investigationTargetPageSchema)
    setBusy(false)
    if (result.kind === 'success' && result.data.page === masked.page && result.data.pageSize === masked.pageSize
      && result.data.items.length === masked.items.length && result.data.items.every((item, index) => item.targetId === masked.items[index]?.targetId)) {
      setRevealed(result.data)
      setNotice('실제 참조번호를 현재 화면에서 열람 중입니다. 화면을 벗어나면 값이 지워집니다.')
    } else {
      setRevealed(null)
      if (result.kind === 'success') {
        setAccess('failed')
        setNotice('응답 대상 범위가 현재 요청과 일치하지 않아 표시하지 않았습니다.')
      } else {
        setAccess(mapAccess(result))
        setNotice(accessMessage(result))
      }
    }
  }

  const exportCsv = async () => {
    if (!validReason || exportPath === null || access !== 'available') { setNotice('권한이 확인되고 사유가 입력되어야 CSV를 내려받을 수 있습니다.'); return }
    setBusy(true)
    const result = await client.requestInvestigationCsv(exportPath, reason)
    setBusy(false)
    if (result.kind !== 'success') { setAccess(mapAccess(result)); setNotice(accessMessage(result)); return }
    const url = URL.createObjectURL(result.data.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'investigation-targets.csv'
    link.rel = 'noreferrer'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setNotice('감사 기록을 남기는 조사 대상 CSV를 내려받았습니다.')
  }

  const changePage = (next: number) => { setPage(next); setMasked(null); setRevealed(null); setAccess('unknown'); setNotice('새 페이지의 마스킹된 대상을 불러와 주세요.') }
  const visible = revealed ?? masked

  return <Card className={trackStyles.panel} aria-label="조사 대상과 근거 검토">
    <div className={trackStyles.sectionHeading}><h2>조사 대상 계정</h2><span>기본은 가린 값</span></div>
    <p className={trackStyles.muted}>선택 후보의 근거만 표시합니다. 계정, 예매, 티켓 참조번호 열람과 CSV 내보내기는 권한 확인 후 사유를 기록합니다.</p>
    <div className={styles.candidateSummary}>
      <strong>가족 우선순위 {selection.family.familyScore.toFixed(3)}</strong>
      <span>후보 점수 {selection.candidate.investigationScore.toFixed(3)}는 조사 순서 참고값입니다.</span>
      <ReasonList reasons={selection.candidate.reasons ?? []} />
    </div>
    <label className={styles.reasonField}>조사 사유
      <textarea maxLength={500} rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setRevealed(null) }} placeholder="이 후보를 확인해야 하는 구체적인 업무 사유를 입력해 주세요." />
    </label>
    <div className={styles.actions}>
      <Button size="small" loading={busy} disabled={!validReason} onClick={() => void loadMasked()}>마스킹된 대상 불러오기</Button>
      <Button size="small" variant="secondary" loading={busy} disabled={!validReason || access !== 'available' || masked === null || revealed !== null} onClick={() => void reveal()}>실제 참조번호 보기</Button>
      <Button size="small" variant="secondary" loading={busy} disabled={!validReason || access !== 'available' || masked === null} onClick={() => void exportCsv()}>조사 대상 CSV 내려받기</Button>
      {revealed !== null && <Button size="small" variant="secondary" onClick={() => { setRevealed(null); setNotice('참조번호를 가렸습니다.') }}>다시 가리기</Button>}
    </div>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {access !== 'unknown' && access !== 'available' && <p className={styles.accessNotice} role="note">{access === 'forbidden' ? '이 계정에는 조사 대상 권한이 없어 열람과 내보내기가 비활성화되었습니다.' : access === 'not-found' ? '대상 범위가 없거나 접근 권한이 없어 열람과 내보내기가 비활성화되었습니다.' : access === 'disabled' ? '서버의 조사 참조번호 보호 기능이 비활성화되어 있습니다.' : '서버 응답을 확인할 수 없어 열람 기능이 비활성화되었습니다.'}</p>}
    {visible === null ? <EmptyState title="마스킹된 대상을 불러와 주세요" description="조사 사유를 입력한 뒤 조회를 누르면 대상 목록과 구성원별 근거를 확인합니다." /> : <>
      {revealed !== null && <p className={styles.sensitiveNotice} role="alert">실제 참조번호가 현재 화면에 표시됩니다. 다른 단계로 이동하면 값이 지워집니다.</p>}
      {visible.items.length === 0 ? <EmptyState title="조사 대상이 없습니다" description="저장된 대상이 0건입니다. 조회 실패나 분석 오류를 0건으로 해석하지 않습니다." /> : <DataTable caption="조사 대상 계정과 구성원별 근거" rows={visible.items} getRowKey={(item) => item.targetId} columns={[
        { key: 'account', header: '계정 ID', render: (item) => item.accountReference ?? '미제공' },
        { key: 'reservation', header: '예매번호', render: (item) => item.reservationReference ?? '미제공' },
        { key: 'ticket', header: '티켓번호', render: (item) => item.ticketReference ?? '미제공' },
        { key: 'performance', header: '회차', render: (item) => item.performanceId },
        { key: 'seat', header: '좌석', render: (item) => [item.seatZone, item.seatRow, item.seatNumber].filter(Boolean).join(' / ') || '미제공' },
        { key: 'reservedAt', header: '예매 시각', render: (item) => item.reservedAt === null ? '미제공' : formatTargetTime(item.reservedAt) },
        { key: 'reasons', header: '구성원별 근거', render: (item) => item.reasons.map(reasonLabel).join(', ') || '저장된 근거 없음' },
      ]} />}
      <div className={styles.actions}><Button size="small" variant="secondary" disabled={visible.page === 0 || busy} onClick={() => changePage(visible.page - 1)}>이전 대상</Button><span>{visible.page + 1} / {Math.max(1, Math.ceil(visible.total / visible.pageSize))} 페이지</span><Button size="small" variant="secondary" disabled={!visible.hasNext || busy} onClick={() => changePage(visible.page + 1)}>다음 대상</Button></div>
    </>}
  </Card>
}

function FinalResultStep({ selection, restore }: { selection: SelectedInvestigation | null; restore: ReactNode }) {
  if (selection === null) return restore ?? <Card className={trackStyles.panel}><h2>최종 결과를 확인할 분석이 없습니다</h2><p>2단계에서 분석을 실행하고 3단계에서 후보를 선택해 주세요.</p><Link to="/app/investigate/2">조사 범위 설정으로 이동</Link></Card>
  const completed = selection.run.status === 'COMPLETED'
  return <Card className={trackStyles.panel} aria-label="조사 결과와 한계">
    <h2>{completed ? '조사 결과 요약' : '최종 결과 대기'}</h2>
    <p className={trackStyles.muted}>분석 작업 상태: {selection.run.status}. {completed ? '완료된 분석 결과의 조사 우선순위를 요약합니다.' : '완료되지 않은 분석은 후보 0건으로 표시하지 않습니다.'}</p>
    {completed ? <dl className={styles.summaryList}>
      <div><dt>조사 묶음 우선순위</dt><dd>{selection.family.familyScore.toFixed(3)}</dd></div>
      <div><dt>선택 후보 우선순위</dt><dd>{selection.candidate.investigationScore.toFixed(3)} / {selection.candidate.priorityBand}</dd></div>
      <div><dt>후보 규모</dt><dd>계정 {selection.candidate.distinctAccountCount}개, 공연 {selection.candidate.distinctEventCount}개, 회차 {selection.candidate.distinctPerformanceCount}개</dd></div>
      <div><dt>근거</dt><dd><ReasonList reasons={selection.candidate.reasons ?? []} /></dd></div>
    </dl> : <ErrorState title={`분석 상태 ${selection.run.status}`} description="실패, 차단, 대기 상태를 정상 0건 결과로 취급하지 않습니다." onRetry={() => undefined} />}
    <section className={styles.limitations}>
      <h3>결과 해석과 한계</h3>
      <ul>
        <li>점수는 조사 우선순위 참고값이며 부정 거래 확률, 동일인 확인 또는 위반 판정이 아닙니다.</li>
        <li>공동 주소, 가족, 회사, 공용 기기와 같은 정상적인 공유 가능성을 담당자가 확인해야 합니다.</li>
        <li>예매 시각은 `reservedAt`만 표시합니다. 값이 없으면 미제공이며 구매 시각 `purchasedAt`으로 대신하지 않습니다.</li>
        <li>분석 오류, 불완전 데이터, 권한 문제는 깨끗한 결과나 후보 없음으로 표시하지 않습니다.</li>
        <li>이 화면은 자동 취소나 제재를 실행하지 않습니다. 최종 판단은 권한 있는 담당자가 근거를 확인한 뒤 내립니다.</li>
      </ul>
    </section>
    <section className={styles.limitations} aria-label="후속 사건과 보고서 업무">
      <h3>사건과 보고서 업무</h3>
      <p>이 화면의 다공연 후보를 기존 사건의 근거로 직접 연결하는 기능은 제공되지 않습니다. 지원되는 근거로 사건을 만들거나 연결한 뒤 승인 요청과 보고서를 진행해 주세요.</p>
      <div className={styles.actions}>
        <Link to={caseListRoute(selection.eventId)}>사건 목록 열기</Link>
        <Link to="/app/approvals">승인 요청 화면 열기</Link>
        <Link to="/app/report-center">보고서 센터 열기</Link>
      </div>
    </section>
  </Card>
}

function ReasonList({ reasons }: { reasons: readonly { code: string; count: number; performances: readonly string[]; strengthRank: number }[] }) {
  if (reasons.length === 0) return <p className={styles.muted}>저장된 후보 근거가 없습니다.</p>
  return <ul className={styles.reasonList}>{reasons.map((reason) => <li key={`${reason.code}:${reason.strengthRank}`}><strong>{reasonLabel(reason.code)}</strong> / {reason.count}개 계정 / {reason.performances.length}개 회차</li>)}</ul>
}

function ScopeFailure({ result, retry }: { result: Exclude<AdminApiResult<unknown>, { kind: 'success' }>; retry: () => void }) {
  const message = describeAdminApiFailure(result, '조사 범위를 불러오지 못했습니다')
  return <ErrorState title={message.title} description={message.description} onRetry={retry} />
}

function mapAccess(result: Exclude<AdminApiResult<unknown>, { kind: 'success' }>): 'forbidden' | 'not-found' | 'disabled' | 'failed' {
  if (result.kind === 'forbidden') return 'forbidden'
  if (result.kind === 'notFound') return 'not-found'
  if (result.kind === 'problem' && result.status === 503 && result.code === 'INVESTIGATION_REVEAL_DISABLED') return 'disabled'
  return 'failed'
}

function accessMessage(result: Exclude<AdminApiResult<unknown>, { kind: 'success' }>) {
  if (result.kind === 'forbidden') return '권한이 없어 마스킹된 대상과 실제 참조번호를 불러오지 못했습니다.'
  if (result.kind === 'notFound') return '대상 범위가 없거나 접근 권한이 없어 참조번호를 불러오지 못했습니다.'
  if (result.kind === 'problem' && result.status === 503 && result.code === 'INVESTIGATION_REVEAL_DISABLED') return '서버의 조사 참조번호 보호 기능이 비활성화되어 있습니다.'
  return describeAdminApiFailure(result, '조사 대상을 확인하지 못했습니다').title
}

function reasonLabel(code: string) {
  const labels: Record<string, string> = {
    SHARED_REFUND_ACCOUNT: '같은 환불 계좌', refund_account_hash: '같은 환불 계좌',
    SHARED_PHONE: '같은 연락처', phone_hash: '같은 연락처',
    SHARED_DEVICE: '같은 기기', device_id_hash: '같은 기기',
    SHARED_ADDRESS: '같은 배송지', address_hash: '같은 배송지',
    IP_SAME_WINDOW: '10분 안 같은 인터넷 주소', ip_window: '10분 안 같은 인터넷 주소',
    REBOOK_CHAIN: '취소 후 재예매 연결', rebook_chain: '취소 후 재예매 연결',
    RESOURCE_CONTINUITY: '공연 간 자원 연결', resource_continuity: '공연 간 자원 연결',
    REPEATED_PERFORMANCES: '여러 회차 반복', stable_account_cocluster: '여러 회차 반복',
    HIGH_QUANTITY: '구매 수량 신호',
  }
  return labels[code] ?? '알 수 없는 근거'
}

function formatTargetTime(value: string) {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`
  const date = new Date(normalized)
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '시각 형식 확인 필요'
}

function localInputDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}
