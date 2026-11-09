import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { caseDetailRoute, casePageSchema, caseTypeLabels } from '../admin-cases/caseApi'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { track1ClusterPageSchema, track1ListRoute } from '../admin-track1/track1Api'
import { terms } from '../../app/terms'
import { verifiedPerformanceRoute } from '../admin-track2/candidatePipelineApi'
import { analysisRunPageSchema, analysisRunsPath, isAnalysisRunPageFor } from '../admin-operations/operationsApi'
import { workflowSummaryPath, workflowSummarySchema } from '../admin-operations/adminConsoleApi'
import { fanReportListRoute, fanReportPageSchema, formatUtc, intakeStatusLabels } from '../admin-track2/track2Api'
import type { IntakeStatus } from '../admin-track2/track2Api'
import {
  isClusterCountFor, isFanReportCountFor, isRecentCasesFor, isWorkflowSummaryFor, overviewClusterCountPath, overviewFanReportCountPath, overviewIntakeCountPath, overviewRecentCasesPath, recentCasePageSize, unresolvedIntakeStatuses,
} from './overviewApi'
import styles from './Overview.module.css'

// 인증된 관리자의 공연별 전체 현황이다. 서버가 확인한 접근 가능 공연을 고른 뒤에만 조회하고, 합성 데모 데이터와 섞지 않는다.
// 영역마다 기존 조회 API를 첫 페이지 한 번씩만 부르며, 한 영역의 실패나 권한 부족은 그 영역에만 표시하고 0건으로 바꾸지 않는다.
// 역할은 화면이 추정하지 않고 서버 403을 따른다. 서버가 주지 않는 통계(Case 전체 건수, 승인 대기 총건수 등)는 만들지 않는다.

/** 개발 전용 미리보기 세션에서는 실제 API를 부르지 않고 안내만 표시한다. */
export function OverviewRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview'
    ? <AdminPagePlaceholder title="전체 현황" description="공연별 전체 현황은 인증된 관리자 세션에서만 실제 API로 제공합니다. 미리보기에서는 합성 데이터로 현황을 만들지 않습니다." />
    : <LiveOverviewPage />
}

export function LiveOverviewPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="업무 시작" title="전체 현황" description="선택한 공연의 팬 제보, 연결된 예매 그룹, 최근 조사 사건을 서버 조회 결과로 확인하고 다음 업무로 이동합니다. 건수와 상태는 조사 진행 현황이며 부정 거래 판정이 아닙니다." />
    <AdminEventGate>{(event) => <EventOverview key={event.id} event={event} />}</AdminEventGate>
    <p className={styles.notice}>각 영역은 기존 조회 API 결과만 표시하고 자동으로 다시 조회하지 않습니다. 역할에 따라 일부 영역만 볼 수 있으며, 조회하지 못한 영역은 0건으로 표시하지 않습니다.</p>
  </div>
}

function EventOverview({ event }: { event: AdminEvent }) {
  return <>
    <NextWork eventId={event.id} />
    <div className={styles.grid}>
      <FanReportSection eventId={event.id} />
      <ClusterSection eventId={event.id} />
      <WorkflowSummarySection eventId={event.id} />
      <UnresolvedIntakeSection eventId={event.id} />
      <RecentAnalysisSection eventId={event.id} />
      <RecentCaseSection eventId={event.id} />
    </div>
  </>
}

/** 업무 흐름 순서대로 다음 화면으로 이동하는 바로가기다. 건수나 대기 여부를 추정하지 않고 이동만 안내한다. */
function NextWork({ eventId }: { eventId: string }) {
  const query = new URLSearchParams({ eventId })
  const actions = [
    { to: `/app/fan-reports?${new URLSearchParams({ eventId, intakeStatus: 'RECEIVED' })}`, title: '접수 완료된 제보 확인', text: '증거 저장이 확인된 제보를 열어 이미지 정보 추출부터 진행합니다.' },
    { to: track1ListRoute(eventId), title: `${terms.cluster} 확인`, text: '조사 우선순위가 높은 그룹부터 저장된 관계 근거를 확인합니다.' },
    { to: `/app/cases?${query}`, title: `${terms.case} 확인`, text: '진행 중인 조사 사건의 근거, 보고서 초안, 승인 단계를 확인합니다.' },
    { to: '/app/approvals', title: `${terms.approvalRequest} 검토`, text: '전달받은 승인 요청을 열어 독립 검토와 결정을 진행합니다.' },
  ]
  return <nav className={styles.nextWork} aria-label="다음 업무">
    <h2>다음 업무</h2>
    <ol>{actions.map((action, index) => <li key={action.title}><Link to={action.to}><span className={styles.stepNo}>{index + 1}</span><span><strong>{action.title}</strong><small>{action.text}</small></span></Link></li>)}</ol>
  </nav>
}

type SectionProps = { title: string; role: string; children: ReactNode }

function Section({ title, role, children }: SectionProps) {
  return <Card className={styles.section} aria-label={title}>
    <div className={styles.heading}><h2>{title}</h2><span>{role}</span></div>
    {children}
  </Card>
}

/** 영역 하나의 실패 안내다. 403은 그 영역에 필요한 역할을, 나머지는 공통 문구를 쓴다. 실패는 빈 결과로 간주하지 않는다. */
function SectionFailure({ failure, forbidden, onRetry }: { failure: AdminApiFailure; forbidden: string; onRetry: () => void }) {
  const message = failure.kind === 'forbidden'
    ? { title: '이 영역에 필요한 역할이 없습니다', description: `${forbidden} 다른 영역은 역할에 따라 따로 표시됩니다.` }
    : describeAdminApiFailure(failure, '공연을 찾을 수 없거나 접근 범위 밖입니다')
  return <ErrorState title={message.title} description={message.description} onRetry={onRetry} />
}

/** 성공 응답이라도 요청한 공연과 페이지 범위가 맞지 않으면 계약 위반으로 처리한다. */
function checked<T>(result: { kind: 'success'; status: number; data: T } | AdminApiFailure, valid: (data: T) => boolean): { data: T } | { failure: AdminApiFailure } {
  if (result.kind !== 'success') return { failure: result }
  return valid(result.data) ? { data: result.data } : { failure: { kind: 'invalidResponse', status: result.status } }
}

function Count({ label, value }: { label: string; value: number }) {
  return <p className={styles.count}><strong>{value.toLocaleString('ko-KR')}</strong><span>{label}</span></p>
}

function FanReportSection({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(overviewFanReportCountPath(eventId), fanReportPageSchema)
  const links = <div className={styles.links}>
    <Link to={fanReportListRoute(eventId)}>팬 제보 조사</Link>
    <Link to={verifiedPerformanceRoute(eventId)}>검증 회차 관리</Link>
  </div>
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label="팬 제보 건수를 불러오는 중" />
  else {
    const outcome = checked(result, (data) => isFanReportCountFor(eventId, data))
    body = 'failure' in outcome
      ? <SectionFailure failure={outcome.failure} forbidden="팬 제보 목록은 분석 담당(ANALYST) 또는 검토 담당(REVIEWER)만 조회할 수 있습니다." onRetry={retry} />
      : <Count label="접수된 팬 제보 (서버 totalItems)" value={outcome.data.totalItems} />
  }
  return <Section title="팬 제보 (팬 제보 조사)" role="분석 담당, 검토 담당">{body}{links}</Section>
}

function ClusterSection({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(overviewClusterCountPath(eventId), track1ClusterPageSchema)
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label="연결된 예매 그룹 건수를 불러오는 중" />
  else {
    const outcome = checked(result, (data) => isClusterCountFor(eventId, data))
    body = 'failure' in outcome
      ? <SectionFailure failure={outcome.failure} forbidden="연결된 예매 그룹 목록은 고객사 관리자, 분석 담당, 검토 담당, 승인 담당만 조회할 수 있습니다." onRetry={retry} />
      : <>
        <Count label="저장된 연결된 예매 그룹 (서버 totalItems)" value={outcome.data.totalItems} />
        <p className={styles.note}>저장된 근거만 기준으로 한 그룹 수입니다. 조사 우선순위는 먼저 살펴볼 순서이며 불법 거래 확률이 아닙니다.</p>
      </>
  }
  return <Section title="연결된 예매 그룹 (예매 관계 분석)" role="고객사 관리자, 분석, 검토, 승인 담당">
    {body}
    <div className={styles.links}><Link to={track1ListRoute(eventId)}>예매 관계 분석</Link></div>
  </Section>
}

function SummaryCounts({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  return <div><h3>{title}</h3>{entries.length === 0
    ? <p className={styles.empty}>서버에 저장된 행이 없습니다.</p>
    : <ul className={styles.caseList}>{entries.map(([status, value]) => <li key={status}><span>{status}</span> <strong>{value.toLocaleString('ko-KR')}건</strong></li>)}</ul>}</div>
}

function WorkflowSummarySection({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(workflowSummaryPath(eventId), workflowSummarySchema)
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label="업무 진행 집계를 불러오는 중" />
  else {
    const outcome = checked(result, (data) => isWorkflowSummaryFor(eventId, data))
    body = 'failure' in outcome
      ? <SectionFailure failure={outcome.failure} forbidden="업무 진행 집계를 조회할 역할이 없습니다." onRetry={retry} />
      : <>
        <SummaryCounts title="조사 사건" counts={outcome.data.casesByStatus} />
        <SummaryCounts title="승인 요청" counts={outcome.data.approvalRequestsByStatus} />
        <SummaryCounts title="구매 수량 분석" counts={outcome.data.track1QuantityRunsByStatus} />
      </>
  }
  return <Section title="업무 진행 집계" role="조회 역할">
    <p className={styles.note}>서버에 저장된 행의 상태별 집계입니다. 판정 결과가 아닙니다.</p>
    {body}
  </Section>
}

/** 접수 상태 하나의 서버 건수다. 조회 실패는 0건이 아니라 조회 실패로 표시하고 그 행만 다시 조회한다. */
function IntakeStatusRow({ eventId, status }: { eventId: string; status: IntakeStatus }) {
  const { result, retry } = useAdminQuery(overviewIntakeCountPath(eventId, status), fanReportPageSchema)
  const to = `/app/fan-reports?${new URLSearchParams({ eventId, intakeStatus: status })}`
  let value: ReactNode
  if (result === null) value = <span>조회 중</span>
  else {
    const outcome = checked(result, (data) => isFanReportCountFor(eventId, data))
    value = 'failure' in outcome
      ? <><span>{outcome.failure.kind === 'forbidden' ? '역할 없음' : '조회 실패'}</span> <Button variant="secondary" size="small" onClick={retry}>다시 시도</Button></>
      : <strong>{outcome.data.totalItems.toLocaleString('ko-KR')}건</strong>
  }
  return <li><Link to={to}>{intakeStatusLabels[status]}</Link> {value}</li>
}

function UnresolvedIntakeSection({ eventId }: { eventId: string }) {
  return <Section title="미처리와 실패 제보" role="분석 담당, 검토 담당">
    <p className={styles.note}>접수 완료 외의 상태별 서버 건수입니다. 실패와 확인 불가는 위반 없음이나 정상 처리가 아닙니다.</p>
    <ul className={styles.caseList}>{unresolvedIntakeStatuses.map((status) => <IntakeStatusRow key={status} eventId={eventId} status={status} />)}</ul>
  </Section>
}

const failedExecutions = new Set(['INPUT_REJECTED', 'STORAGE_FAILED', 'ANALYZER_FAILED', 'ABANDONED'])

/** 이미지 정보 추출 최근 실행의 첫 페이지만 요약한다. 서버가 전체 건수를 주지 않으므로 합계나 실패율을 만들지 않는다. */
function RecentAnalysisSection({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(analysisRunsPath(eventId, 0), analysisRunPageSchema)
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label="최근 분석 실행을 불러오는 중" />
  else {
    const outcome = checked(result, (data) => isAnalysisRunPageFor(0, data))
    if ('failure' in outcome) {
      body = <SectionFailure failure={outcome.failure} forbidden="분석 실행 이력을 조회할 역할이 없습니다." onRetry={retry} />
    } else if (outcome.data.items.length === 0) {
      body = <p className={styles.empty}>저장된 이미지 정보 추출 실행이 없습니다. 서버가 빈 목록을 반환했습니다.</p>
    } else {
      const { items, hasNext } = outcome.data
      const failed = items.filter((item) => failedExecutions.has(item.executionStatus)).length
      const running = items.filter((item) => item.executionStatus === 'IN_PROGRESS').length
      body = <>
        <Count label={`최근 실행 ${items.length}건 중 실패`} value={failed} />
        <p className={styles.note}>진행 중 {running}건.{hasNext ? ' 더 이전 실행이 있어 전체 합계가 아닙니다.' : ''} 예매 관계 분석 실행 이력은 서버에 없어 포함하지 않습니다.</p>
      </>
    }
  }
  return <Section title="최근 이미지 정보 추출" role="서버 역할 기준">
    {body}
    <div className={styles.links}><Link to="/app/analysis/jobs">분석 작업 화면</Link></div>
  </Section>
}

function RecentCaseSection({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(overviewRecentCasesPath(eventId), casePageSchema)
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label="최근 조사 사건을 불러오는 중" />
  else {
    const outcome = checked(result, (data) => isRecentCasesFor(eventId, data))
    if ('failure' in outcome) {
      body = <SectionFailure failure={outcome.failure} forbidden="조사 사건 목록은 고객사 관리자, 분석 담당, 검토 담당만 조회할 수 있습니다." onRetry={retry} />
    } else if (outcome.data.items.length === 0) {
      body = <p className={styles.empty}>현재 계정이 볼 수 있는 조사 사건이 없습니다. 서버가 빈 목록을 반환했습니다.</p>
    } else {
      body = <>
        <ul className={styles.caseList}>
          {outcome.data.items.map((item) => <li key={item.caseId}>
            <Link to={caseDetailRoute(item.caseId, eventId)} aria-label={`${item.caseId} 상세 보기`}><span className={styles.caseId}>사건 {item.caseId.slice(0, 8)}</span></Link>
            <span>{caseTypeLabels[item.type]}</span>
            <StatusBadge domain="case" status={item.status} />
            <time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time>
          </li>)}
        </ul>
        {outcome.data.hasNext && <p className={styles.note}>더 많은 조사 사건이 있습니다. 전체 목록은 조사 사건 화면에서 확인해 주세요.</p>}
      </>
    }
  }
  return <Section title="최근 조사 사건" role="고객사 관리자, 분석 담당, 검토 담당">
    <p className={styles.note}>생성 시각 최신순 최대 {recentCasePageSize}건입니다. 서버가 전체 건수를 주지 않아 합계와 승인 대기 건수는 표시하지 않습니다. 분석 담당은 자신이 만들었거나 담당한 조사 사건만 받습니다.</p>
    {body}
    <div className={styles.links}><Link to={`/app/cases?${new URLSearchParams({ eventId })}`}>조사 사건 전체 보기</Link></div>
  </Section>
}
