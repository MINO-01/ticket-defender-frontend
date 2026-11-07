import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import type { AdminApiFailure } from '../../api/adminApiFailure'
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
import { verifiedPerformanceRoute } from '../admin-track2/candidatePipelineApi'
import { fanReportListRoute, fanReportPageSchema, formatUtc } from '../admin-track2/track2Api'
import {
  isClusterCountFor, isFanReportCountFor, isRecentCasesFor, overviewClusterCountPath, overviewFanReportCountPath, overviewRecentCasesPath, recentCasePageSize,
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
    <PageHeader eyebrow="운영 현황" title="전체 현황" description="선택한 공연의 팬 제보, 저장된 연관 예매 군집, 최근 Case를 서버 조회 결과로 확인합니다. 건수와 상태는 조사 진행 현황이며 부정 거래 판정이 아닙니다." />
    <AdminEventGate>{(event) => <EventOverview key={event.id} event={event} />}</AdminEventGate>
    <p className={styles.notice}>각 영역은 기존 조회 API 결과만 표시하고 자동으로 다시 조회하지 않습니다. 역할에 따라 일부 영역만 볼 수 있으며, 조회하지 못한 영역은 0건으로 표시하지 않습니다.</p>
  </div>
}

function EventOverview({ event }: { event: AdminEvent }) {
  return <div className={styles.grid}>
    <FanReportSection eventId={event.id} />
    <ClusterSection eventId={event.id} />
    <RecentCaseSection eventId={event.id} />
  </div>
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
    <Link to={fanReportListRoute(eventId)}>팬 제보 검토</Link>
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
  return <Section title="팬 제보 (Track 2)" role="분석 담당, 검토 담당">{body}{links}</Section>
}

function ClusterSection({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(overviewClusterCountPath(eventId), track1ClusterPageSchema)
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label="저장된 군집 건수를 불러오는 중" />
  else {
    const outcome = checked(result, (data) => isClusterCountFor(eventId, data))
    body = 'failure' in outcome
      ? <SectionFailure failure={outcome.failure} forbidden="저장된 군집 목록은 고객사 관리자, 분석 담당, 검토 담당, 승인 담당만 조회할 수 있습니다." onRetry={retry} />
      : <>
        <Count label="저장된 연관 예매 군집 (서버 totalItems)" value={outcome.data.totalItems} />
        <p className={styles.note}>저장된 증거만 기준으로 한 군집 수입니다. 위험 점수는 조사 우선순위이며 불법 거래 확률이 아닙니다.</p>
      </>
  }
  return <Section title="연관 예매 군집 (Track 1)" role="고객사 관리자, 분석, 검토, 승인 담당">
    {body}
    <div className={styles.links}><Link to={track1ListRoute(eventId)}>연관 예매 분석</Link></div>
  </Section>
}

function RecentCaseSection({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(overviewRecentCasesPath(eventId), casePageSchema)
  let body: ReactNode
  if (result === null) body = <LoadingSkeleton label="최근 Case를 불러오는 중" />
  else {
    const outcome = checked(result, (data) => isRecentCasesFor(eventId, data))
    if ('failure' in outcome) {
      body = <SectionFailure failure={outcome.failure} forbidden="Case 목록은 고객사 관리자, 분석 담당, 검토 담당만 조회할 수 있습니다." onRetry={retry} />
    } else if (outcome.data.items.length === 0) {
      body = <p className={styles.empty}>현재 계정이 볼 수 있는 Case가 없습니다. 서버가 빈 목록을 반환했습니다.</p>
    } else {
      body = <>
        <ul className={styles.caseList}>
          {outcome.data.items.map((item) => <li key={item.caseId}>
            <Link to={caseDetailRoute(item.caseId, eventId)} aria-label={`${item.caseId} 상세 보기`}><span className={styles.caseId}>{item.caseId}</span></Link>
            <span>{caseTypeLabels[item.type]}</span>
            <StatusBadge domain="case" status={item.status} />
            <time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time>
          </li>)}
        </ul>
        {outcome.data.hasNext && <p className={styles.note}>더 많은 Case가 있습니다. 전체 목록은 사건 관리에서 확인해 주세요.</p>}
      </>
    }
  }
  return <Section title="최근 Case" role="고객사 관리자, 분석 담당, 검토 담당">
    <p className={styles.note}>생성 시각 최신순 최대 {recentCasePageSize}건입니다. 서버가 전체 건수를 주지 않아 합계와 승인 대기 건수는 표시하지 않습니다. 분석 담당은 자신이 만들었거나 담당한 Case만 받습니다.</p>
    {body}
    <div className={styles.links}><Link to={`/app/cases?${new URLSearchParams({ eventId })}`}>사건 관리</Link></div>
  </Section>
}
