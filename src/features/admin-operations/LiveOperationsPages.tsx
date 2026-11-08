import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { adminApiPath } from '../../api/adminApiClient'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { roleLabels, terms } from '../../app/terms'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { ApprovalAuditPanel } from '../admin-cases/CaseLinkPanels'
import { ActivityPanel } from '../admin-cases/LiveCaseDetailPage'
import { caseDetailRoute, caseListPath, casePageSchema, caseTypeLabels } from '../admin-cases/caseApi'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { BackendAuthCheckPanel } from '../admin-settings/BackendAuthCheckPanel'
import { StatusPill } from '../admin-track2/StatusPill'
import { analysisStatusLabels, executionStatusLabels, fanReportDetailRoute, fanReportPageSchema, formatUtc, intakeStatusHelp, intakeStatusLabels } from '../admin-track2/track2Api'
import type { FanReportPage, IntakeStatus } from '../admin-track2/track2Api'
import { analysisRunPageSchema, analysisRunsPath, describeOperationState, isAnalysisRunPageFor, operationSettingsPath, operationSettingsSchema } from './operationsApi'
import type { AnalysisRun } from './operationsApi'
import styles from './Operations.module.css'

// 운영 메뉴(분석 작업, 감사 기록, 설정)의 실제 조회 화면이다. Backend 조회 API가 지원하는 범위만 실제 데이터로 보여 준다.
// 이미지 정보 추출 실행 이력, 조사 사건별 활동과 승인 감사 이력, 고객사 관리자용 운영 상태는 실제로 조회한다.
// 통합 분석 작업 이력, 고객사 전체 감사 로그, 사용자 역할 목록은 아직 없으므로 만들어 내지 않고 계약 대기로 안내한다.
// 계약 초안은 docs/contracts/backend-requests.md에 정리한다.

function PendingContract({ title, children }: { title: string; children: ReactNode }) {
  return <Card className={styles.pending} aria-label={`${title} (Backend 계약 대기)`}>
    <h2>{title}</h2>
    <p className={styles.pendingTag}>Backend 계약 대기, 완료된 기능이 아닙니다</p>
    <div className={styles.note}>{children}</div>
  </Card>
}

function previewOnly(title: string, description: string, live: ReactNode, status: string) {
  return status === 'preview' ? <AdminPagePlaceholder title={title} description={description} /> : live
}

// ---------- 분석 작업 ----------

export function AnalysisJobsRoute() {
  const { state } = useAdminAuth()
  return previewOnly('분석 작업', '분석 작업 현황은 인증된 관리자 세션에서만 실제 API로 제공합니다.', <AnalysisJobsPage />, state.status)
}

const watchedStatuses = ['ANALYSIS_FAILED', 'ANALYSIS_PENDING', 'STORAGE_FAILED'] as const satisfies readonly IntakeStatus[]

function intakeCountPath(eventId: string, intakeStatus: IntakeStatus) {
  return adminApiPath('/api/v1/admin/fan-reports', { eventId, intakeStatus, page: 0, pageSize: 1 })
}

/** 건수 응답이 요청한 공연, 접수 상태, 첫 페이지와 맞는지 확인한다. 맞지 않으면 건수를 표시하지 않는다. */
export function isIntakeCountFor(eventId: string, intakeStatus: IntakeStatus, data: FanReportPage) {
  return data.event.id === eventId && data.page === 0 && data.pageSize === 1 && data.items.length === Math.min(data.totalItems, 1)
    && data.items.every((item) => item.intakeStatus === intakeStatus) && data.hasNext === data.totalItems > 1
}

function AnalysisJobsPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="운영" title="분석 작업" description={`저장된 ${terms.listingAnalysis} 실행 이력을 공연별로 확인합니다. 실행 상태와 분석 결과 상태는 서로 다른 값이며, 실패한 실행도 숨기지 않습니다.`} />
    <AdminEventGate>{(event) => <EventAnalysisWork key={event.id} event={event} />}</AdminEventGate>
    <Card className={styles.panel} aria-label="실행 이력 확인 위치">
      <h2>이 화면에 없는 실행</h2>
      <ul className={styles.list}>
        <li>{terms.candidateMatch}: 팬 제보 상세의 추출 결과별 비교 실행 이력에서 확인합니다.</li>
        <li>{terms.track1}: 저장된 분석 결과만 연결된 예매 그룹 화면에서 확인합니다. 실행 중이거나 결과 없이 끝난 분석 요청 목록은 제공되지 않습니다.</li>
      </ul>
    </Card>
    <PendingContract title="통합 분석 작업 이력">
      <p>{terms.track1}과 {terms.track2}의 모든 실행(예매 기록 비교, 결과 없이 끝난 요청 포함)을 한 번에 보는 조회 API는 아직 없습니다. 위 실행 이력은 이미지 정보 추출만 포함합니다.</p>
    </PendingContract>
  </div>
}

function EventAnalysisWork({ event }: { event: AdminEvent }) {
  return <>
    <AnalysisRunHistory eventId={event.id} />
    <h2 className={styles.subheading}>접수 상태로 본 제보</h2>
    <IntakeWatch event={event} />
  </>
}

function executionTone(status: AnalysisRun['executionStatus']) {
  if (status === 'SUCCEEDED') return 'success' as const
  return status === 'IN_PROGRESS' ? 'neutral' as const : 'critical' as const
}

/** 서버의 Track 2 이미지 정보 추출 실행 이력이다. 전체 건수를 주지 않으므로 페이지와 다음 페이지 여부만 표시한다. */
function AnalysisRunHistory({ eventId }: { eventId: string }) {
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(analysisRunsPath(eventId, page), analysisRunPageSchema)
  let content: ReactNode
  if (result === null) content = <LoadingSkeleton label="이미지 정보 추출 실행 이력을 불러오는 중" />
  else if (result.kind !== 'success' || !isAnalysisRunPageFor(page, result.data)) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = failure.kind === 'forbidden'
      ? { title: '실행 이력에 필요한 역할이 없습니다', description: `${roleLabels.ANALYST} 또는 ${roleLabels.REVIEWER}만 조회할 수 있습니다.` }
      : describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else if (result.data.items.length === 0) {
    content = page === 0
      ? <EmptyState title="저장된 실행 이력이 없습니다" description="이 공연의 제보 증거로 이미지 정보 추출을 실행한 기록이 없습니다. 실패 기록과는 다른 상태입니다." />
      : <><EmptyState title="이 페이지에 표시할 실행 이력이 없습니다" description="요청한 페이지가 이력 범위를 벗어났습니다." /><Button variant="secondary" size="small" onClick={() => setPage(0)}>첫 페이지로 이동</Button></>
  } else {
    const columns = [
      { key: 'created', header: '실행 시각', render: (run: AnalysisRun) => <time dateTime={run.createdAt}>{formatUtc(run.createdAt)}</time> },
      { key: 'execution', header: '실행 상태', render: (run: AnalysisRun) => <StatusPill label={executionStatusLabels[run.executionStatus]} tone={executionTone(run.executionStatus)} /> },
      { key: 'analysis', header: '분석 결과 상태', render: (run: AnalysisRun) => run.analysisStatus === null ? '결과 없음' : analysisStatusLabels[run.analysisStatus] },
      { key: 'failure', header: '실패 코드', render: (run: AnalysisRun) => run.errorCode === null && run.analyzerErrorCode === null ? '없음'
        : <span>{[run.errorCode, run.analyzerErrorCode === null ? null : `분석 서버 ${run.analyzerErrorCode}`].filter(Boolean).join(', ')}<small className={styles.sub}>실패 기록이며 빈 결과가 아닙니다</small></span> },
      { key: 'completed', header: '종료 시각', render: (run: AnalysisRun) => run.completedAt === null ? '기록 없음' : formatUtc(run.completedAt) },
      { key: 'report', header: '제보', render: (run: AnalysisRun) => <Link className={styles.link} to={fanReportDetailRoute(run.fanReportId)} aria-label={`${run.analysisId} 실행의 제보 열기`}>제보 열기</Link> },
    ]
    content = <>
      <DataTable caption="이미지 정보 추출 실행 이력" columns={columns} rows={result.data.items} getRowKey={(run) => run.analysisId} />
      {(page > 0 || result.data.hasNext) && <nav className={styles.pagination} aria-label="실행 이력 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!result.data.hasNext} onClick={() => setPage(page + 1)}>다음</Button></nav>}
    </>
  }
  return <Card className={styles.panel} aria-label="이미지 정보 추출 실행 이력">
    <h2>{terms.listingAnalysis} 실행 이력</h2>
    <p className={styles.note}>저장된 {terms.track2} 이미지 정보 추출 실행만 포함합니다(서버 범위 PERSISTED_TRACK2_LISTING_CONTEXT_ANALYSES_ONLY). 최신 실행 순이며 서버가 전체 건수를 주지 않아 합계는 표시하지 않습니다.</p>
    {content}
  </Card>
}

function IntakeWatch({ event }: { event: AdminEvent }) {
  return <div className={styles.grid}>
    {watchedStatuses.map((status) => <IntakeCount key={status} eventId={event.id} intakeStatus={status} />)}
  </div>
}

function IntakeCount({ eventId, intakeStatus }: { eventId: string; intakeStatus: IntakeStatus }) {
  const { result, retry } = useAdminQuery(intakeCountPath(eventId, intakeStatus), fanReportPageSchema)
  const label = intakeStatusLabels[intakeStatus]
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label={`${label} 건수를 불러오는 중`} />
  else if (result.kind !== 'success' || !isIntakeCountFor(eventId, intakeStatus, result.data)) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = failure.kind === 'forbidden'
      ? { title: '이 영역에 필요한 역할이 없습니다', description: `팬 제보 목록은 ${roleLabels.ANALYST} 또는 ${roleLabels.REVIEWER}만 조회할 수 있습니다.` }
      : describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    body = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else {
    body = <p className={styles.count}><strong>{result.data.totalItems.toLocaleString('ko-KR')}건</strong><span>서버 totalItems</span></p>
  }
  return <Card className={styles.panel} aria-label={`접수 상태 ${label}`}>
    <h2>{label}</h2>
    <p className={styles.note}>{intakeStatusHelp[intakeStatus]}</p>
    {body}
    <Link className={styles.link} to={`/app/fan-reports?${new URLSearchParams({ eventId, intakeStatus })}`}>해당 제보 목록 열기</Link>
  </Card>
}

// ---------- 감사 기록 ----------

export function AuditRoute() {
  const { state } = useAdminAuth()
  return previewOnly('감사 기록', '감사 기록은 인증된 관리자 세션에서만 실제 API로 제공합니다.', <AuditPage />, state.status)
}

function AuditPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="운영" title="감사 기록" description={`${terms.case}별로 서버에 저장된 활동 기록(상태 변경, 담당자 지정, 근거 연결, 보고서와 승인 관련 기록)을 확인합니다. 기록은 수정할 수 없습니다.`} />
    <AdminEventGate>{(event) => <CaseAudit key={event.id} event={event} />}</AdminEventGate>
    <PendingContract title="고객사 전체 감사 로그">
      <p>조사 사건에 속하지 않은 기록(로그인, 증거 열람, 공식 PDF 다운로드, 설정 변경 등)을 함께 보는 고객사 단위 감사 로그 조회 API가 없습니다. 필요한 응답 계약은 docs/contracts/backend-requests.md의 감사 기록 조회 항목에 정리했습니다.</p>
    </PendingContract>
  </div>
}

function CaseAudit({ event }: { event: AdminEvent }) {
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const { result, retry } = useAdminQuery(caseListPath(event.id, page, null), casePageSchema)
  let list: ReactNode
  if (result === null) list = <LoadingSkeleton label="조사 사건 목록을 불러오는 중" />
  else if (result.kind !== 'success' || result.data.page !== page || result.data.items.some((item) => item.eventId !== event.id)) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = failure.kind === 'forbidden'
      ? { title: '조사 사건 목록에 필요한 역할이 없습니다', description: `${roleLabels.TENANT_ADMIN}, ${roleLabels.ANALYST}, ${roleLabels.REVIEWER}만 조회할 수 있습니다.` }
      : describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    list = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else if (result.data.items.length === 0) {
    list = <EmptyState title="볼 수 있는 조사 사건이 없습니다" description="서버가 빈 목록을 반환했습니다. 조회 장애가 아닙니다." />
  } else {
    const data = result.data
    list = <>
      <ul className={styles.caseList}>{data.items.map((item) => <li key={item.caseId}>
        <button type="button" aria-pressed={selected === item.caseId} onClick={() => setSelected(item.caseId)} aria-label={`${item.caseId} 활동 기록 보기`}>
          <strong>사건 {item.caseId.slice(0, 8)}</strong><span>{caseTypeLabels[item.type]}</span><StatusBadge domain="case" status={item.status} /><time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time>
        </button>
      </li>)}</ul>
      {(page > 0 || data.hasNext) && <nav className={styles.pagination} aria-label="조사 사건 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>다음</Button></nav>}
    </>
  }
  return <div className={styles.split}>
    <Card className={styles.panel} aria-label="조사 사건 선택">
      <h2>조사 사건 선택</h2>
      <p className={styles.note}>최근 생성 순입니다. {roleLabels.ANALYST}은 자신이 만들었거나 담당한 사건만 받습니다.</p>
      {list}
    </Card>
    <div>
      {selected === null
        ? <EmptyState title="조사 사건을 선택해 주세요" description="왼쪽 목록에서 사건을 고르면 그 사건의 활동 기록을 조회합니다." />
        : <>
          <ActivityPanel key={selected} caseId={selected} />
          <ApprovalAuditPanel key={`approval-audit:${selected}`} caseId={selected} />
          <Link className={styles.link} to={caseDetailRoute(selected, event.id)}>이 조사 사건 열기</Link>
        </>}
    </div>
  </div>
}

// ---------- 설정 ----------

export function SettingsRoute() {
  const { state } = useAdminAuth()
  if (state.status === 'preview') return <><AdminPagePlaceholder title="설정" description="설정 화면은 인증된 관리자 세션에서 접근 범위를 확인합니다." /><BackendAuthCheckPanel /></>
  return <SettingsPage />
}

function SettingsPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="운영" title="설정" description="선택한 공연 기준의 운영 기능 상태와 서버 인증 상태를 확인합니다. 역할과 권한은 서버가 요청마다 판단하며, 이 화면에서 설정을 바꿀 수 없습니다." />
    <Card className={styles.panel} aria-label="현재 세션">
      <h2>현재 세션</h2>
      <p className={styles.note}>인증된 관리자 세션입니다. 화면은 토큰 내용에서 역할을 추정하지 않으며, 권한이 없는 작업은 서버가 403으로 거부합니다.</p>
    </Card>
    <AdminEventGate>{(event) => <OperationStatus key={event.id} eventId={event.id} />}</AdminEventGate>
    <BackendAuthCheckPanel />
    <PendingContract title="내 역할과 감사 담당 권한">
      <p>로그인한 계정의 전체 역할 목록, 고객사 이름, 감사 담당(AUDITOR) 역할과 권한은 아직 서버에 없어 표시하지 않습니다. 설정 변경 기능도 제공하지 않습니다.</p>
    </PendingContract>
  </div>
}

function enabledText(value: boolean, on: string, off: string) {
  return value ? on : off
}

/** 서버의 안전 운영 상태다. 고객사 관리자만 조회할 수 있으며 사용자 역할 목록이 아니다. */
function OperationStatus({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(operationSettingsPath(eventId), operationSettingsSchema)
  let content: ReactNode
  if (result === null) content = <LoadingSkeleton label="운영 상태를 불러오는 중" />
  else if (result.kind !== 'success') {
    const message = result.kind === 'forbidden'
      ? { title: '운영 상태를 볼 역할이 없습니다', description: `${roleLabels.TENANT_ADMIN}만 조회할 수 있습니다. 다른 화면은 역할에 따라 계속 사용할 수 있습니다.` }
      : describeAdminApiFailure(result, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else {
    const data = result.data
    content = <dl className={styles.facts}>
      <div><dt>팬 제보 접수</dt><dd>{enabledText(data.fanReportIntakeEnabled, '사용 중', '꺼짐')}</dd></div>
      <div><dt>{terms.listingAnalysis} 분석기 연결</dt><dd>{enabledText(data.track2ListingAnalysisConfigured, '설정됨', '설정되지 않음')}</dd></div>
      <div><dt>{terms.track1} 근거 범위</dt><dd>{describeOperationState(data.track1RelationshipEvidenceCoverage)}</dd></div>
      <div><dt>{terms.officialPdf} 발급</dt><dd>{describeOperationState(data.officialPdfIssuanceState)}</dd></div>
      <div><dt>감사 담당 접근</dt><dd>{describeOperationState(data.auditorAccessState)}</dd></div>
    </dl>
  }
  return <Card className={styles.panel} aria-label="운영 상태">
    <h2>운영 상태</h2>
    <p className={styles.note}>기능 활성 상태만 표시합니다. 비밀 값, 내부 주소, 저장소 정보는 서버가 반환하지 않습니다.</p>
    {content}
  </Card>
}
