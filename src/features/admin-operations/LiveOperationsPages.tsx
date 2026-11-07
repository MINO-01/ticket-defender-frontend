import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { adminApiPath } from '../../api/adminApiClient'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { roleLabels, terms } from '../../app/terms'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { ActivityPanel } from '../admin-cases/LiveCaseDetailPage'
import { caseDetailRoute, caseListPath, casePageSchema, caseTypeLabels } from '../admin-cases/caseApi'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { useAccessibleEvents } from '../admin-events/useAccessibleEvents'
import { BackendAuthCheckPanel } from '../admin-settings/BackendAuthCheckPanel'
import { fanReportPageSchema, formatUtc, intakeStatusHelp, intakeStatusLabels } from '../admin-track2/track2Api'
import type { FanReportPage, IntakeStatus } from '../admin-track2/track2Api'
import styles from './Operations.module.css'

// 운영 메뉴(분석 작업, 감사 기록, 설정)의 실제 조회 화면이다. 기존 Backend 조회 API가 지원하는 범위만 실제 데이터로 보여 준다.
// 공연 단위 분석 작업 목록, 고객사 전체 감사 로그, 서버 설정 조회 API는 아직 없으므로 만들어 내지 않고 계약 대기로 안내한다.
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
    <PageHeader eyebrow="운영" title="분석 작업" description={`${terms.listingAnalysis}과 ${terms.candidateMatch} 실행 상태를 확인하는 곳을 안내하고, 접수 기록상 분석 대기나 실패가 남은 제보를 공연별로 찾습니다.`} />
    <AdminEventGate>{(event) => <IntakeWatch key={event.id} event={event} />}</AdminEventGate>
    <Card className={styles.panel} aria-label="실행 이력 확인 위치">
      <h2>실행 이력은 어디서 보나요</h2>
      <ul className={styles.list}>
        <li>{terms.listingAnalysis}: 팬 제보 상세의 증거 영역에서 증거별로 실행 상태(실행 중, 실행 완료, 입력 검증 실패, 분석 서버 실패 등)와 결과 상태를 따로 확인합니다.</li>
        <li>{terms.candidateMatch}: 같은 화면의 추출 결과별 비교 실행 이력에서 확인합니다.</li>
        <li>{terms.track1}: 저장된 분석 결과만 연결된 예매 그룹 화면에서 확인합니다. 실행 중이거나 실패한 분석 요청 목록은 제공되지 않습니다.</li>
      </ul>
    </Card>
    <PendingContract title="공연 단위 분석 작업 목록">
      <p>공연 전체의 추출, 비교, 예매 관계 분석 실행을 한 번에 보는 조회 API가 없습니다. 화면이 증거마다 반복 조회해 목록을 만들지 않습니다(N+1 금지). 필요한 응답 계약은 docs/contracts/backend-requests.md의 분석 작업 조회 항목에 정리했습니다.</p>
    </PendingContract>
  </div>
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
  const { state, retry } = useAccessibleEvents(null)
  let events: ReactNode
  if (state.status === 'loading') events = <LoadingSkeleton label="접근 가능한 공연을 불러오는 중" />
  else if (state.status === 'failed') {
    const message = describeAdminApiFailure(state.failure, '공연 목록을 찾을 수 없습니다')
    events = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else if (state.events.length === 0) {
    events = <EmptyState title="접근 가능한 공연이 없습니다" description="서버가 빈 목록을 반환했습니다. 고객사 관리자에게 공연 권한을 확인해 주세요." />
  } else {
    events = <ul className={styles.list}>{state.events.map((event) => <li key={event.id}>{event.name}</li>)}</ul>
  }
  return <div className={styles.page}>
    <PageHeader eyebrow="운영" title="설정" description="현재 관리자 세션의 접근 범위와 서버 인증 상태를 확인합니다. 역할과 권한은 서버가 요청마다 판단합니다." />
    <Card className={styles.panel} aria-label="현재 세션">
      <h2>현재 세션</h2>
      <p className={styles.note}>인증된 관리자 세션입니다. 화면은 토큰 내용에서 역할을 추정하지 않으며, 권한이 없는 작업은 서버가 403으로 거부합니다.</p>
    </Card>
    <Card className={styles.panel} aria-label="접근 가능한 공연">
      <h2>접근 가능한 공연</h2>
      {events}
    </Card>
    <BackendAuthCheckPanel />
    <PendingContract title="고객사 설정과 내 역할 조회">
      <p>현재 계정의 역할, 고객사 이름, 보존 기간, 공식 PDF 발급 정책 등 서버 설정을 조회하는 API가 없어 표시하지 않습니다. 설정 변경 기능도 제공하지 않습니다. 필요한 응답 계약은 docs/contracts/backend-requests.md의 설정 조회 항목에 정리했습니다.</p>
    </PendingContract>
  </div>
}
