import { useCallback, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { statusLabels } from '../../components/common/statusLabels'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { formatRiskScore, track1DetailRoute } from '../admin-track1/track1Api'
import { applicabilityLabels, candidateReasonLabels, candidateStatusLabels } from '../admin-track2/candidatePipelineApi'
import { fanReportDetailRoute, formatUtc } from '../admin-track2/track2Api'
import { isUuid } from '../fan-report/intakeConfig'
import {
  activityTypeLabels, actorRoleLabels, caseActivitiesPath, caseActivityPageSchema, caseDetailPath, caseListRoute, caseSourceListSchema, caseSourcesPath, caseTypeLabels,
  caseViewSchema, readCaseId,
} from './caseApi'
import type { CaseActivity, CaseSource, CaseStatus, CaseView } from './caseApi'
import { ApprovalSubmitPanel } from '../admin-approvals/ApprovalSubmitPanel'
import { AssigneePanel, PreparationPanels, TransitionPanel } from './CaseWorkflowPanels'
import type { WorkflowOutcome } from './CaseWorkflowPanels'
import styles from './Cases.module.css'

// 인증된 관리자의 Case 상세다. 주소의 Case UUID로 조회하며 다른 고객사, 권한 없는 공연, ANALYST에게 허용되지 않은 Case는 서버가 404로 숨긴다.
// 주소에 공연이 있으면 응답의 eventId와 일치할 때만 표시한다. 공연이 없는 직접 주소는 서버 권한 검증 결과를 그대로 따르고 목록 링크는 응답 공연으로 만든다.
// 출처와 활동 이력은 상세 조회가 성공하고 공연이 확인된 뒤에만 요청한다.
// 상태 변경, 담당자, EvidenceSnapshot, 보고서 초안은 쓰기 성공이나 버전 충돌 뒤 서버의 최신 Case를 다시 조회한다.
// 재조회 중에는 직전에 확인한 Case를 표시하되 모든 쓰기를 막아 오래된 caseVersion으로 요청하지 않는다.
// 승인 요청 제출은 이 화면에서, 철회와 승인 결정은 승인 요청 상세에서 한다. 공식 PDF는 보고서 센터에서 승인 결정 ID로만 다룬다.

const listLink = '/app/cases'

function InvalidCaseAddress() {
  return <div className={styles.page}>
    <ErrorState title="Case 주소가 올바르지 않습니다" description="Case ID 또는 공연 값의 형식이 올바르지 않아 조회하지 않았습니다. Case 목록에서 다시 선택해 주세요." />
    <Link className={styles.detailLink} to={listLink}>Case 목록으로 돌아가기</Link>
  </div>
}

export function LiveCaseDetailPage() {
  const { caseId: rawCaseId } = useParams()
  const [searchParams] = useSearchParams()
  const caseId = readCaseId(rawCaseId)
  const rawEventId = searchParams.get('eventId')?.trim() ?? ''
  if (!caseId || (rawEventId !== '' && !isUuid(rawEventId))) return <InvalidCaseAddress />
  const eventId = rawEventId === '' ? null : rawEventId.toLowerCase()
  // Case나 공연이 바뀌면 새로 만들어 이전 요청과 하위 조회 결과가 남지 않게 한다.
  return <CaseDetail key={`${caseId}:${eventId ?? ''}`} caseId={caseId} eventId={eventId} />
}

type Notice = { tone: 'success' | 'conflict'; title: string; description?: string }

function CaseDetail({ caseId, eventId }: { caseId: string; eventId: string | null }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const { result } = useAdminQuery(caseDetailPath(caseId), caseViewSchema, refreshKey)
  const [lastView, setLastView] = useState<CaseView | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [reviewerDenied, setReviewerDenied] = useState(false)
  const back = (target: string | null) => <Link className={styles.backLink} to={target ? caseListRoute(target) : listLink}>← Case 목록</Link>
  const verified = result?.kind === 'success' && result.data.caseId === caseId && (eventId === null || result.data.eventId === eventId) ? result.data : null
  // 직전에 확인한 Case를 기억해 재조회 중에도 작성 중인 입력과 결과 안내가 사라지지 않게 한다.
  if (verified !== null && verified !== lastView) setLastView(verified)
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  const onOutcome = useCallback((outcome: WorkflowOutcome) => {
    if (outcome.kind === 'forbidden') { setReviewerDenied(true); return }
    setNotice(outcome.kind === 'succeeded'
      ? { tone: 'success', title: outcome.message }
      : { tone: 'conflict', title: outcome.message.title, description: outcome.message.description })
    refresh()
  }, [refresh])

  const shown = verified ?? (result === null ? lastView : null)
  if (shown === null) {
    if (result === null) return <div className={styles.page}>{back(eventId)}<LoadingSkeleton label="Case 상세를 불러오는 중" /></div>
    if (result.kind === 'success' && result.data.caseId === caseId && eventId !== null && result.data.eventId !== eventId) {
      return <div className={styles.page}>{back(eventId)}<ErrorState title="선택한 공연의 Case가 아닙니다" description="주소의 공연과 Case의 공연이 달라 표시하지 않았습니다. Case 목록에서 다시 선택해 주세요." /></div>
    }
    // 요청한 Case와 다른 응답은 다른 Case의 정보가 섞일 수 있으므로 표시하지 않는다.
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
    return <div className={styles.page}>{back(eventId)}<ErrorState title={message.title} description={message.description} onRetry={refresh} /></div>
  }

  const item = shown
  const refreshing = verified === null
  const locked = refreshing || reviewerDenied
  return <div className={styles.page}>
    {back(item.eventId)}
    <PageHeader eyebrow="Case 조사 준비" title="Case 상세" description="서버에 저장된 Case 정보와 연결 출처, 활동 이력을 확인하고 조사 준비 업무를 진행합니다. Case 상태는 조사 진행 단계이며 부정 거래 판정이 아닙니다." />
    {refreshing && <p className={styles.caution} role="status">서버의 최신 Case 상태를 다시 불러오는 중입니다. 완료될 때까지 변경 요청을 막습니다.</p>}
    {notice && <div className={notice.tone === 'success' ? styles.success : styles.failure} role={notice.tone === 'success' ? 'status' : 'alert'}>
      <strong>{notice.title}</strong>{notice.description && <p>{notice.description}</p>}
    </div>}
    <CaseOverview item={item} />
    <div className={styles.detailGrid}>
      <div className={styles.mainColumn}>
        <SourcePanel caseId={item.caseId} eventId={item.eventId} />
        <PreparationPanels view={item} locked={locked} onOutcome={onOutcome} refreshKey={refreshKey}
          approvalPanel={(drafts) => <ApprovalSubmitPanel view={item} locked={locked} drafts={drafts} onOutcome={onOutcome} onRefresh={refresh} />} />
      </div>
      <aside className={styles.sideColumn} aria-label="활동 이력과 업무 동작">
        {reviewerDenied && <p className={styles.blocked} role="note">현재 계정은 검토 담당(REVIEWER) 역할이 없어 서버가 변경 요청을 거부했습니다. 이 화면의 변경 동작을 막았습니다. 역할은 고객사 관리자에게 확인해 주세요.</p>}
        {!reviewerDenied && <p className={styles.caution}>현재 계정의 역할을 조회하는 API가 없어 변경 동작을 표시합니다. 상태 변경, 담당자, Snapshot, 초안은 검토 담당 역할만 가능하며 서버가 최종 확인합니다.</p>}
        <TransitionPanel view={item} locked={locked} onOutcome={onOutcome} />
        <AssigneePanel view={item} locked={locked} onOutcome={onOutcome} />
        {/* 활동 이력은 변경 성공이나 충돌 뒤 첫 페이지부터 다시 조회한다. */}
        <ActivityPanel key={refreshKey} caseId={item.caseId} />
        <Card className={styles.panel}>
          <h2>후속 단계</h2>
          <p className={styles.caution}>공식 PDF 발급은 별도 절차입니다. Case 화면에서는 승인 결정 ID를 찾는 계약이 없어 여기서 발급할 수 없고, 보고서 센터에서 승인 결정 ID로 진행합니다. 보고서 초안 저장과 승인 결정은 PDF 발급이 아닙니다.</p>
          <div className={styles.actions}>
            <Button variant="secondary" disabled>공식 PDF 발급</Button>
          </div>
        </Card>
      </aside>
    </div>
  </div>
}

function textOrNone(value: string | null) {
  return value === null || value.trim() === '' ? '기록 없음' : value
}

function CaseOverview({ item }: { item: CaseView }) {
  return <Card className={styles.overview} aria-label="Case 개요">
    <div className={styles.panelHeading}><h2>Case 개요</h2><StatusBadge domain="case" status={item.status} /></div>
    <dl className={styles.overviewGrid}>
      <div><dt>Case ID</dt><dd className={styles.idCell}>{item.caseId}</dd></div>
      <div><dt>공연 ID</dt><dd className={styles.idCell}>{item.eventId}</dd></div>
      <div><dt>유형</dt><dd>{caseTypeLabels[item.type]}</dd></div>
      <div><dt>Case 버전</dt><dd>{item.caseVersion}</dd></div>
      <div><dt>증거 개정 번호</dt><dd>{item.evidenceRevision}</dd></div>
      <div><dt>분류</dt><dd className={styles.plainText}>{textOrNone(item.classification)}</dd></div>
      <div><dt>생성자 멤버십 ID</dt><dd className={styles.idCell}>{item.createdByMembershipId}</dd></div>
      <div><dt>담당자 멤버십 ID</dt><dd className={styles.idCell}>{item.assigneeMembershipId ?? '미지정'}</dd></div>
      <div><dt>연관 Case</dt><dd className={styles.idCell}>{item.relatedCaseId ?? '기록 없음'}</dd></div>
      <div><dt>현재 보고서 버전</dt><dd className={styles.idCell}>{item.currentReportVersionId ?? '기록 없음'}</dd></div>
      <div><dt>생성 시각</dt><dd><time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time></dd></div>
      <div><dt>최근 변경</dt><dd><time dateTime={item.updatedAt}>{formatUtc(item.updatedAt)}</time></dd></div>
    </dl>
    {item.relationReason !== null && <p className={styles.linkReason}><strong>연관 사유</strong><span className={styles.plainText}>{item.relationReason}</span></p>}
    <p className={styles.caution}>Case 버전은 Case가 변경될 때마다 서버가 올리는 값이고, 증거 개정 번호는 EvidenceSnapshot과 승인 요청이 참조하는 증거 구성 번호로 서로 다른 값입니다. 멤버십 ID를 이름으로 바꾸는 API가 없어 ID로만 표시합니다.</p>
  </Card>
}

function SourcePanel({ caseId, eventId }: { caseId: string; eventId: string }) {
  const { result, retry } = useAdminQuery(caseSourcesPath(caseId), caseSourceListSchema)
  const heading = (count?: number) => <div className={styles.panelHeading}><h2>연결 출처</h2>{count !== undefined && <span>{count}개 출처, 연결 순</span>}</div>
  let content
  if (result === null) content = <LoadingSkeleton label="연결 출처를 불러오는 중" />
  else if (result.kind !== 'success') {
    const message = describeAdminApiFailure(result, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else if (result.data.length === 0) content = <EmptyState title="연결된 출처가 없습니다" description="서버에 저장된 출처 기록이 없습니다. 조회 장애가 아닙니다." />
  else content = <div className={styles.sourceList}>{result.data.map((source) => <SourceItem key={source.sourceReferenceId} source={source} eventId={eventId} />)}</div>
  return <Card className={styles.panel} aria-label="연결 출처">
    {heading(result?.kind === 'success' ? result.data.length : undefined)}
    {content}
  </Card>
}

function SourceItem({ source, eventId }: { source: CaseSource; eventId: string }) {
  const common = <>
    <div><dt>출처 참조 ID</dt><dd className={styles.idCell}>{source.sourceReferenceId}</dd></div>
    <div><dt>연결 시각</dt><dd><time dateTime={source.linkedAt}>{formatUtc(source.linkedAt)}</time></dd></div>
  </>
  if (source.sourceType === 'STORED_CLUSTER_EVIDENCE') {
    // 스키마에서 군집 출처의 분석 ID와 군집 ID가 채워져 있음을 확인했다.
    const analysisRequestId = source.analysisRequestId ?? ''
    const clusterId = source.clusterId ?? ''
    const algorithm = [source.analysisAlgorithm, source.analysisAlgorithmVersion].filter((part): part is string => !!part).join(' ')
    return <article className={styles.source} aria-label="Track 1 저장 군집 증거">
      <span className={styles.sourceType}>Track 1 저장 군집 증거</span>
      <dl className={styles.definition}>
        <div><dt>분석 요청 ID</dt><dd className={styles.idCell}>{analysisRequestId}</dd></div>
        <div><dt>군집 ID</dt><dd className={styles.idCell}>{clusterId}</dd></div>
        <div><dt>저장 구성원</dt><dd>{source.storedMemberCount}건</dd></div>
        <div><dt>분석 알고리즘</dt><dd>{algorithm === '' ? '기록 없음' : algorithm}</dd></div>
        <div><dt>분석 완료 시각</dt><dd>{source.analysisCompletedAt === null ? '기록 없음' : formatUtc(source.analysisCompletedAt)}</dd></div>
        <div><dt>Risk Score</dt><dd>{formatRiskScore(source.riskScore)}</dd></div>
        {common}
      </dl>
      <p className={styles.caution}>연결 시점에 저장된 군집 증거입니다. Risk Score는 조사 우선순위 신호이며 불법 확률이나 부정 거래 확정이 아닙니다.</p>
      <Link className={styles.detailLink} to={track1DetailRoute({ eventId, analysisRequestId, clusterId })}>군집 상세 보기</Link>
    </article>
  }
  const fanReportId = source.fanReportId ?? ''
  if (source.sourceType === 'FAN_REPORT') {
    return <article className={styles.source} aria-label="Track 2 팬 제보">
      <span className={styles.sourceType}>Track 2 팬 제보</span>
      <dl className={styles.definition}>
        <div><dt>제보 ID</dt><dd className={styles.idCell}>{fanReportId}</dd></div>
        {common}
      </dl>
      <p className={styles.caution}>제보 연결은 조사 대상이라는 뜻이며 제보 내용이 사실로 확인되었다는 뜻이 아닙니다.</p>
      <Link className={styles.detailLink} to={fanReportDetailRoute(fanReportId)}>제보 상세 보기</Link>
    </article>
  }
  if (source.sourceType === 'LISTING_CANDIDATE_MATCH') {
    // 계약 밖의 새 코드는 원래 코드 그대로 표시하고 다른 의미로 바꾸지 않는다.
    const label = (labels: Record<string, string>, value: string | null) => value === null ? '기록 없음' : `${labels[value] ?? value} (${value})`
    return <article className={styles.source} aria-label="Track 2 예매 후보 대조 실행">
      <span className={styles.sourceType}>Track 2 예매 후보 대조 실행</span>
      <dl className={styles.definition}>
        <div><dt>소속 제보 ID</dt><dd className={styles.idCell}>{fanReportId}</dd></div>
        <div><dt>소속 증거 ID</dt><dd className={styles.idCell}>{source.evidenceId}</dd></div>
        <div><dt>후보 실행 ID</dt><dd className={styles.idCell}>{source.candidateRunId}</dd></div>
        <div><dt>연결 시점 실행 결과</dt><dd>{label(candidateStatusLabels, source.candidateStatus)}</dd></div>
        <div><dt>연결 시점 사유</dt><dd>{label(candidateReasonLabels, source.candidateReason)}</dd></div>
        <div><dt>후보 개수</dt><dd>{source.candidateCount === null ? '조회하지 않음' : `${source.candidateCount}건`}</dd></div>
        <div><dt>현재 적용 여부</dt><dd>{label(applicabilityLabels, source.candidateApplicability)}</dd></div>
        {common}
      </dl>
      <p className={styles.caution}>연결 시점의 후보 실행 기록이며 조사 참고 자료입니다. 부정 거래나 불법 거래 확정이 아닙니다. 후보 실행이 연결된 Case는 승인 근거 정책이 확정되지 않아 승인 요청과 공식 PDF 발급이 차단됩니다(APPROVAL_BASIS_BLOCKED).</p>
      <Link className={styles.detailLink} to={fanReportDetailRoute(fanReportId)}>소속 제보 상세 보기</Link>
    </article>
  }
  return <article className={styles.source} aria-label="Track 2 제보 증거 이미지">
    <span className={styles.sourceType}>Track 2 제보 증거 이미지</span>
    <dl className={styles.definition}>
      <div><dt>소속 제보 ID</dt><dd className={styles.idCell}>{fanReportId}</dd></div>
      <div><dt>증거 ID</dt><dd className={styles.idCell}>{source.evidenceId}</dd></div>
      {common}
    </dl>
    <p className={styles.caution}>특정 제보에 속한 증거 이미지이며 독립된 분석 결과나 확정 판정이 아닙니다.</p>
    <Link className={styles.detailLink} to={fanReportDetailRoute(fanReportId)}>소속 제보 상세 보기</Link>
  </article>
}

function ActivityPanel({ caseId }: { caseId: string }) {
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(caseActivitiesPath(caseId, page), caseActivityPageSchema)
  const heading = <div className={styles.panelHeading}><h2>활동 이력</h2><span>오래된 순 (서버 정렬)</span></div>
  let content
  if (result === null) content = <LoadingSkeleton label="활동 이력을 불러오는 중" />
  else if (result.kind !== 'success' || result.data.page !== page) {
    // 요청과 다른 페이지의 이력은 다른 범위일 수 있으므로 표시하지 않는다.
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, 'Case를 찾을 수 없거나 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else if (result.data.items.length === 0) {
    content = page === 0
      ? <EmptyState title="활동 이력이 없습니다" description="서버에 저장된 활동 기록이 없습니다. 조회 장애가 아닙니다." />
      : <><EmptyState title="이 페이지에 표시할 이력이 없습니다" description="요청한 페이지가 이력 범위를 벗어났습니다." /><Button variant="secondary" size="small" onClick={() => setPage(0)}>첫 페이지로 이동</Button></>
  } else {
    content = <ol className={styles.timeline}>{result.data.items.map((item) => <li key={item.activityId}><ActivityItem activity={item} /></li>)}</ol>
  }
  const hasNext = result?.kind === 'success' && result.data.page === page && result.data.hasNext
  return <Card className={styles.panel} aria-label="활동 이력">
    {heading}
    <p className={styles.caution}>서버에 저장된 기록이며 이 화면에서 수정할 수 없습니다. 수행자는 이름 조회 API가 없어 멤버십 ID로 표시합니다.</p>
    {content}
    {(page > 0 || hasNext) && <nav className={styles.pagination} aria-label="활동 이력 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 이력</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!hasNext} onClick={() => setPage(page + 1)}>다음 이력</Button></nav>}
  </Card>
}

function statusText(status: CaseStatus | null) {
  return status === null ? '없음' : statusLabels.case[status].label
}

function ActivityItem({ activity }: { activity: CaseActivity }) {
  const versionText = activity.versionBefore === null ? `Case 버전 ${activity.versionAfter}` : `Case 버전 ${activity.versionBefore} → ${activity.versionAfter}`
  const assigneeChanged = activity.previousAssigneeMembershipId !== null || activity.newAssigneeMembershipId !== null
  return <>
    <time dateTime={activity.occurredAt}>{formatUtc(activity.occurredAt)}</time>
    <p><strong>{activityTypeLabels[activity.eventType] ?? activity.eventType}</strong></p>
    <dl className={styles.activityFacts}>
      <div><dt>수행자</dt><dd>{actorRoleLabels[activity.actorRole] ?? activity.actorRole}, <span className={styles.idCell}>{activity.actorMembershipId}</span></dd></div>
      {(activity.fromStatus !== null || activity.toStatus !== null) && <div><dt>상태</dt><dd>{statusText(activity.fromStatus)} → {statusText(activity.toStatus)}</dd></div>}
      <div><dt>버전</dt><dd>{versionText}, 증거 개정 번호 {activity.evidenceRevision}</dd></div>
      {activity.sourceReferenceId !== null && <div><dt>출처 참조 ID</dt><dd className={styles.idCell}>{activity.sourceReferenceId}</dd></div>}
      {assigneeChanged && <div><dt>담당자</dt><dd className={styles.idCell}>{activity.previousAssigneeMembershipId ?? '미지정'} → {activity.newAssigneeMembershipId ?? '미지정'}</dd></div>}
      <div><dt>사유</dt><dd className={styles.plainText}>{activity.reason.trim() === '' ? '기록 없음' : activity.reason}</dd></div>
    </dl>
  </>
}
