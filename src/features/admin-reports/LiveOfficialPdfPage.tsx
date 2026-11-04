import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import type { WorkflowMessage } from '../admin-cases/caseWorkflowApi'
import { MutationStatus } from '../admin-cases/MutationStatus'
import styles from '../admin-cases/Cases.module.css'
import { useCaseMutation } from '../admin-cases/useCaseMutation'
import { formatUtc } from '../admin-track2/track2Api'
import {
  describeOfficialPdfCode, eligibilityLabels, eligibilityPath, eligibilitySchema, hasDownloadableArtifact, isIssuanceFor, isRetryableStatus,
  issuanceDetailPath, issuanceForDecision, issuanceHistoryPath, issuanceHistorySchema, issuanceRequestMessages, issuanceRequestPath, issuanceRetryMessages,
  issuanceRetryPath, issuanceSchema, issuanceStatusDescriptions, issuanceStatusLabels, readDecisionId, reportCenterRoute,
} from './officialPdfApi'
import type { Eligibility, Issuance } from './officialPdfApi'
import { useOfficialPdfDownload } from './useOfficialPdfDownload'

// 승인 결정 ID 하나의 공식 PDF 적격성, 발급 요청, 상태, 재시도, 이력, 다운로드 화면이다.
// 적격성(CURRENT, STALE, BLOCKED)과 권한은 서버 값만 쓰며, CURRENT가 아니면 발급과 재시도를 열지 않는다.
// 이력을 확인하지 못하면 발급 기록이 없다고 보지 않고 발급을 막는다. 기존 기록이 있으면 새 요청 대신 그 기록을 보여 준다.
// HTTP 202는 요청 접수이며 응답의 status만 실제 처리 결과다. 진행 상태는 상태 재조회만 제공하고 자동 폴링이나 자동 재시도는 하지 않는다.
// 발급과 재시도는 기존 useCaseMutation의 같은 키 재확인 규칙을 쓴다. 결과가 불확실하면 같은 키와 같은 빈 본문으로만 다시 보낸다.

const accepted = '서버가 요청을 접수했습니다. HTTP 202는 요청 접수이며 발급 완료가 아닙니다. 아래 발급 상태가 서버의 실제 처리 결과입니다.'

export function LiveOfficialPdfPage() {
  const params = useParams()
  const decisionId = readDecisionId(params.approvalDecisionId)
  if (decisionId === null) {
    return <div className={styles.page}>
      <PageHeader eyebrow="보고서 센터" title="공식 PDF 발급" description="승인 결정 ID로 공식 PDF 발급 적격성과 기록을 확인합니다." />
      <ErrorState title="승인 결정 ID가 올바르지 않습니다" description="주소의 승인 결정 ID가 UUID 형식이 아니어서 서버에 요청하지 않았습니다." />
      <Link className={styles.backLink} to={reportCenterRoute}>승인 결정 ID 입력으로 이동</Link>
    </div>
  }
  return <OfficialPdfWorkspace key={decisionId} decisionId={decisionId} />
}

function OfficialPdfWorkspace({ decisionId }: { decisionId: string }) {
  const client = useAdminApiClient()
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = () => setRefreshKey((value) => value + 1)
  // 쓰기 응답이나 상세 재조회로 받은 같은 결정의 최신 기록이다. 화면 메모리에만 둔다.
  const [latest, setLatest] = useState<Issuance | null>(null)
  const [detailState, setDetailState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'failed'; message: WorkflowMessage }>({ kind: 'idle' })

  const eligibilityQuery = useAdminQuery(eligibilityPath(decisionId), eligibilitySchema, refreshKey)
  const eligibility = eligibilityQuery.result?.kind === 'success' && eligibilityQuery.result.data.approvalDecisionId === decisionId ? eligibilityQuery.result.data : null
  const historyQuery = useAdminQuery(eligibility === null ? null : issuanceHistoryPath(eligibility.reportVersionId), issuanceHistorySchema, refreshKey)
  const historyItems = historyQuery.result?.kind === 'success' && eligibility !== null && historyQuery.result.data.every((item) => item.reportVersionId === eligibility.reportVersionId)
    ? historyQuery.result.data : null
  const record = historyItems === null ? null : issuanceForDecision(historyItems, decisionId)
  const shown = latest ?? record

  const request = useCaseMutation<undefined, Issuance>({ method: 'POST', schema: issuanceSchema, successStatus: 202, messages: issuanceRequestMessages })
  const retry = useCaseMutation<undefined, Issuance>({ method: 'POST', schema: issuanceSchema, successStatus: 202, messages: issuanceRetryMessages })
  const download = useOfficialPdfDownload()
  const busy = request.attempt?.kind === 'sending' || retry.attempt?.kind === 'sending' || detailState.kind === 'loading'
  const uncertain = request.attempt?.kind === 'uncertain' || retry.attempt?.kind === 'uncertain'

  const settle = (next: Awaited<ReturnType<typeof request.submit>>) => {
    if (!next || next.kind === 'uncertain') return
    if (next.kind === 'succeeded') setLatest(next.data)
    // 확정된 거부도 서버의 최신 적격성과 이력을 다시 보여 준다.
    refresh()
  }

  const reportVersionId = eligibility?.reportVersionId ?? ''
  const verifyRequest = (data: Issuance) => isIssuanceFor(data, decisionId, reportVersionId)
  const onRequest = () => { void request.submit(issuanceRequestPath(decisionId), undefined, verifyRequest).then(settle) }
  const onRequestReconfirm = () => { void request.reconfirm(issuanceRequestPath(decisionId), verifyRequest).then(settle) }
  const onRetry = (target: Issuance) => {
    const verify = (data: Issuance) => data.officialPdfIssuanceId === target.officialPdfIssuanceId && verifyRequest(data)
    void retry.submit(issuanceRetryPath(target.officialPdfIssuanceId), undefined, verify).then(settle)
  }
  const onRetryReconfirm = (target: Issuance) => {
    const verify = (data: Issuance) => data.officialPdfIssuanceId === target.officialPdfIssuanceId && verifyRequest(data)
    void retry.reconfirm(issuanceRetryPath(target.officialPdfIssuanceId), verify).then(settle)
  }

  const onRecheck = async (target: Issuance) => {
    if (busy) return
    setDetailState({ kind: 'loading' })
    let result
    try {
      result = await client.request(issuanceDetailPath(target.officialPdfIssuanceId), { schema: issuanceSchema })
    } catch {
      result = { kind: 'problem' as const, status: 400, code: 'CLIENT_REJECTED_PATH' }
    }
    if (result.kind === 'success' && result.data.officialPdfIssuanceId === target.officialPdfIssuanceId && isIssuanceFor(result.data, decisionId, target.reportVersionId)) {
      setLatest(result.data)
      setDetailState({ kind: 'idle' })
      refresh()
      return
    }
    const failure: AdminApiFailure = result.kind === 'success' ? { kind: 'invalidResponse', status: result.status } : result
    const message = failure.kind === 'problem' && failure.status < 500 ? describeOfficialPdfCode(failure.code) : describeAdminApiFailure(failure, '발급 기록을 찾을 수 없거나 접근 범위 밖입니다')
    setDetailState({ kind: 'failed', message: { title: `상태를 다시 조회하지 못했습니다: ${message.title}`, description: message.description } })
  }

  let body
  if (eligibilityQuery.result === null) body = <LoadingSkeleton label="공식 PDF 발급 적격성을 확인하는 중" />
  else if (eligibility === null) {
    const result = eligibilityQuery.result
    const failure: AdminApiFailure = result.kind === 'success' ? { kind: 'invalidResponse', status: result.status } : result
    const message = failure.kind === 'problem' && failure.status < 500 && failure.status !== 400 ? describeOfficialPdfCode(failure.code) : describeAdminApiFailure(failure, '승인 결정을 찾을 수 없거나 접근 범위 밖입니다')
    body = <>
      <ErrorState title={message.title} description={message.description} onRetry={eligibilityQuery.retry} />
      {failure.kind === 'forbidden' && <p className={styles.caution} role="note">W09 공식 PDF 기능은 고객사 관리자(TENANT_ADMIN) 역할만 쓸 수 있습니다. 승인 결정을 내린 역할과 다릅니다.</p>}
    </>
  } else {
    body = <>
      <EligibilityFacts eligibility={eligibility} />
      <IssuanceArea
        eligibility={eligibility} historyResult={historyQuery.result} historyItems={historyItems} onHistoryRetry={historyQuery.retry} record={record} shown={shown}
        busy={busy} uncertain={uncertain} requestUncertain={request.attempt?.kind === 'uncertain'} retryUncertain={retry.attempt?.kind === 'uncertain'}
        requestSending={request.attempt?.kind === 'sending'} retrySending={retry.attempt?.kind === 'sending'}
        onRequest={onRequest} onRequestReconfirm={onRequestReconfirm} onRetry={onRetry} onRetryReconfirm={onRetryReconfirm}
        onRecheck={(target) => { void onRecheck(target) }} rechecking={detailState.kind === 'loading'}
        downloading={download.state.kind === 'downloading'} onDownload={(target) => { void download.download(target.officialPdfIssuanceId, decisionId) }}
      />
      {historyItems !== null && historyItems.length > 0 && <HistoryTable items={historyItems} />}
    </>
  }

  return <div className={styles.page}>
    <PageHeader eyebrow="보고서 센터" title="공식 PDF 발급" description="사람의 승인 결정 뒤 서버가 다시 검증한 경우에만 공식 PDF를 발급합니다. 승인 결정과 공식 PDF 발급은 별도 동작이며, 공식 PDF는 부정 거래 판정이나 제재 결정이 아닙니다." />
    <Card className={styles.panel} aria-label="공식 PDF 발급">
      <div className={styles.panelHeading}><h2>공식 PDF 발급</h2><span>고객사 관리자</span></div>
      <dl className={styles.definition}><div><dt>승인 결정 ID</dt><dd className={styles.idCell}>{decisionId}</dd></div></dl>
      <p className={styles.caution}>서버는 합성 격리(SYNTHETIC_ISOLATED) 환경에서만 발급하며 운영 발급은 정책 승인 전까지 막혀 있습니다. 화면은 역할과 적격성을 추정하지 않고 서버 판단만 표시합니다.</p>
      {body}
      <MutationStatus attempt={request.attempt} successText={accepted} />
      <MutationStatus attempt={retry.attempt} successText={accepted} />
      {detailState.kind === 'failed' && <div className={styles.failure} role="alert"><strong>{detailState.message.title}</strong><p>{detailState.message.description}</p></div>}
      <DownloadStatus state={download.state} />
    </Card>
  </div>
}

function EligibilityFacts({ eligibility }: { eligibility: Eligibility }) {
  const message = describeOfficialPdfCode(eligibility.code)
  return <section className={styles.created} aria-label="서버 발급 적격성">
    <h3>서버 발급 적격성</h3>
    <dl className={styles.definition}>
      <div><dt>현재 적격성</dt><dd>{eligibilityLabels[eligibility.state]}</dd></div>
      <div><dt>서버 코드</dt><dd className={styles.idCell}>{eligibility.code}</dd></div>
      <div><dt>보고서 버전 ID</dt><dd className={styles.idCell}>{eligibility.reportVersionId}</dd></div>
    </dl>
    <p className={eligibility.state === 'CURRENT' ? styles.caution : styles.blocked} role="note"><strong>{message.title}</strong> {message.description}</p>
  </section>
}

type IssuanceAreaProps = {
  eligibility: Eligibility
  historyResult: ReturnType<typeof useAdminQuery<Issuance[]>>['result']
  historyItems: Issuance[] | null
  onHistoryRetry: () => void
  record: Issuance | null
  shown: Issuance | null
  busy: boolean
  uncertain: boolean
  requestUncertain: boolean
  retryUncertain: boolean
  requestSending: boolean
  retrySending: boolean
  onRequest: () => void
  onRequestReconfirm: () => void
  onRetry: (target: Issuance) => void
  onRetryReconfirm: (target: Issuance) => void
  onRecheck: (target: Issuance) => void
  rechecking: boolean
  downloading: boolean
  onDownload: (target: Issuance) => void
}

function IssuanceArea(props: IssuanceAreaProps) {
  const { eligibility, historyResult, historyItems, record, shown, busy, uncertain } = props
  if (shown !== null) {
    const retryable = isRetryableStatus(shown.status) && eligibility.state === 'CURRENT' && shown.eligibility === 'CURRENT'
    const downloadable = hasDownloadableArtifact(shown)
    return <>
      {record !== null && shown === record && <p className={styles.notice} role="note">이 승인 결정의 발급 기록이 이미 있습니다. 새 발급 요청 대신 현재 기록의 상태를 확인해 주세요. 결정당 발급 기록은 하나입니다.</p>}
      <IssuanceState issuance={shown} />
      <div className={styles.formActions}>
        <Button variant="secondary" onClick={() => props.onRecheck(shown)} loading={props.rechecking} disabled={busy}>상태 다시 조회</Button>
        {props.retryUncertain
          ? <Button onClick={() => props.onRetryReconfirm(shown)} loading={props.retrySending} disabled={busy}>재시도 재확인</Button>
          : retryable && !uncertain && <Button onClick={() => props.onRetry(shown)} loading={props.retrySending} disabled={busy}>실패한 발급 재시도</Button>}
        {downloadable && <Button onClick={() => props.onDownload(shown)} loading={props.downloading} disabled={busy || props.downloading}>{props.downloading ? '공식 PDF 다운로드 중' : '공식 PDF 다운로드'}</Button>}
      </div>
      {!retryable && isRetryableStatus(shown.status) && <p className={styles.caution}>서버의 현재 적격성이 발급 가능(CURRENT)이 아니어서 재시도를 열지 않습니다. 보류나 근거 변경을 화면에서 우회하지 않습니다.</p>}
      {downloadable && <p className={styles.caution}>다운로드할 때 발급 상세를 다시 조회하고, 받은 바이트의 크기와 SHA-256을 서버 기록과 대조한 뒤에만 파일을 만듭니다. 적격성이 바뀐 기존 문서의 다운로드 정책(DEC-14)은 확정되지 않아 서버 판단을 따릅니다.</p>}
    </>
  }
  if (historyResult === null) return <LoadingSkeleton label="발급 이력을 확인하는 중" />
  if (historyItems === null) {
    const failure: AdminApiFailure = historyResult.kind === 'success' ? { kind: 'invalidResponse', status: historyResult.status } : historyResult
    const message = failure.kind === 'problem' && failure.status < 500 && failure.status !== 400 ? describeOfficialPdfCode(failure.code) : describeAdminApiFailure(failure, '보고서를 찾을 수 없거나 접근 범위 밖입니다')
    return <ErrorState title={`발급 이력을 확인하지 못했습니다: ${message.title}`} description={`${message.description} 발급 기록이 없다고 간주하지 않습니다. 이력을 확인할 때까지 발급 요청을 막습니다.`} onRetry={props.onHistoryRetry} />
  }
  if (props.requestUncertain) {
    return <div className={styles.formActions}><Button onClick={props.onRequestReconfirm} loading={props.requestSending} disabled={busy}>발급 요청 재확인</Button></div>
  }
  if (eligibility.state !== 'CURRENT') return <p className={styles.blocked} role="note">서버 적격성이 발급 가능(CURRENT)이 아니어서 발급 요청을 열지 않습니다.</p>
  return <>
    <p className={styles.caution}>이 결정의 발급 기록이 없습니다. 발급 요청은 서버가 근거, 증거 보존, 보류, 합성 격리 조건을 다시 확인한 뒤 처리합니다.</p>
    <div className={styles.formActions}>
      <Button onClick={props.onRequest} loading={props.requestSending} disabled={busy || uncertain}>{props.requestSending ? '발급 요청 중' : '공식 PDF 발급 요청'}</Button>
    </div>
  </>
}

function IssuanceState({ issuance }: { issuance: Issuance }) {
  const failure = issuance.lastFailureCode === null ? null : describeOfficialPdfCode(issuance.lastFailureCode)
  const current = describeOfficialPdfCode(issuance.eligibilityCode)
  return <section className={styles.created} aria-label="발급 상태">
    <h3>발급 상태</h3>
    <p className={issuance.status === 'GENERATED' ? styles.success : issuance.status === 'FAILED' || issuance.status === 'STALE' ? styles.failure : styles.uncertain}>{issuanceStatusDescriptions[issuance.status]}</p>
    <dl className={styles.definition}>
      <div><dt>발급 상태</dt><dd>{issuanceStatusLabels[issuance.status]}</dd></div>
      <div><dt>발급 기록 ID</dt><dd className={styles.idCell}>{issuance.officialPdfIssuanceId}</dd></div>
      <div><dt>보고서 개정</dt><dd>{issuance.reportRevision}</dd></div>
      <div><dt>현재 적격성 (서버 값)</dt><dd>{eligibilityLabels[issuance.eligibility]}, {current.title}</dd></div>
      {failure !== null && <div><dt>마지막 실패 코드</dt><dd>{issuance.lastFailureCode}, {failure.title}</dd></div>}
      <div><dt>공식 템플릿</dt><dd>{issuance.officialTemplateVersion}</dd></div>
      <div><dt>요청 시각</dt><dd><time dateTime={issuance.requestedAt}>{formatUtc(issuance.requestedAt)}</time></dd></div>
      {issuance.completedAt !== null && <div><dt>완료 시각</dt><dd><time dateTime={issuance.completedAt}>{formatUtc(issuance.completedAt)}</time></dd></div>}
      {issuance.artifactId !== null && <div><dt>완료본 ID</dt><dd className={styles.idCell}>{issuance.artifactId}</dd></div>}
      {issuance.pdfSha256 !== null && <div><dt>PDF SHA-256</dt><dd className={styles.idCell}>{issuance.pdfSha256}</dd></div>}
      {issuance.pdfSize !== null && <div><dt>PDF 크기</dt><dd>{issuance.pdfSize} 바이트</dd></div>}
    </dl>
  </section>
}

function HistoryTable({ items }: { items: Issuance[] }) {
  const columns = [
    { key: 'id', header: '발급 기록 ID', render: (item: Issuance) => <span className={styles.idCell}>{item.officialPdfIssuanceId}</span> },
    { key: 'decision', header: '승인 결정 ID', render: (item: Issuance) => <span className={styles.idCell}>{item.approvalDecisionId}</span> },
    { key: 'status', header: '발급 상태', render: (item: Issuance) => issuanceStatusLabels[item.status] },
    { key: 'eligibility', header: '현재 적격성', render: (item: Issuance) => eligibilityLabels[item.eligibility] },
    { key: 'failure', header: '마지막 실패 코드', render: (item: Issuance) => item.lastFailureCode ?? '없음' },
    { key: 'requested', header: '요청 시각', render: (item: Issuance) => <time dateTime={item.requestedAt}>{formatUtc(item.requestedAt)}</time> },
    { key: 'completed', header: '완료 시각', render: (item: Issuance) => item.completedAt === null ? '미완료' : <time dateTime={item.completedAt}>{formatUtc(item.completedAt)}</time> },
  ]
  return <section className={styles.created} aria-label="발급 이력">
    <h3>보고서별 발급 이력</h3>
    <p className={styles.caution}>같은 보고서 개정의 발급 작업과 불변 완료본 기록입니다. 이전 완료본을 대체(SUPERSEDED)로 바꾸는 규칙(DEC-09)은 확정되지 않았습니다.</p>
    <DataTable caption="보고서별 발급 이력" columns={columns} rows={items} getRowKey={(item) => item.officialPdfIssuanceId} />
  </section>
}

function DownloadStatus({ state }: { state: ReturnType<typeof useOfficialPdfDownload>['state'] }) {
  if (state.kind === 'done') return <p className={styles.success} role="status">공식 PDF를 내려받았습니다 ({state.byteSize} 바이트, 서버 기록의 크기와 SHA-256 일치). 브라우저 저장소에는 보관하지 않습니다.</p>
  if (state.kind !== 'failed') return null
  return <div className={styles.failure} role="alert"><strong>다운로드 실패: {state.message.title}</strong><p>{state.message.description}</p></div>
}
