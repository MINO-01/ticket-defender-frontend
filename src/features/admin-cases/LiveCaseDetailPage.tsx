import { useCallback, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StepNav, TechnicalDetails, WorkGuide } from '../../components/common/WorkGuide'
import type { GuideItem } from '../../components/common/WorkGuide'
import { terms } from '../../app/terms'
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
import { ApprovalAuditPanel, CaseWorkflowPanel } from './CaseLinkPanels'
import { EvidenceIntegrityPanel } from './EvidenceIntegrityPanel'
import { Track1CandidateLinkPanel } from './Track1CandidateLinkPanel'
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
  const back = (target: string | null) => <Link className={styles.backLink} to={target ? caseListRoute(target) : listLink}>← 조사 사건 목록</Link>
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
    <PageHeader eyebrow="조사 사건" title="조사 사건 상세" description="저장된 사건 상태, 연결 근거, 담당자, 조사 근거 묶음과 보고서 초안, 승인 단계를 확인하고 다음 업무를 진행합니다. 사건 상태는 조사 진행 단계이며 부정 거래 판정이 아닙니다." />
    {refreshing && <p className={styles.caution} role="status">서버의 최신 Case 상태를 다시 불러오는 중입니다. 완료될 때까지 변경 요청을 막습니다.</p>}
    {notice && <div className={notice.tone === 'success' ? styles.success : styles.failure} role={notice.tone === 'success' ? 'status' : 'alert'}>
      <strong>{notice.title}</strong>{notice.description && <p>{notice.description}</p>}
    </div>}
    <CaseGuide item={item} />
    <CaseOverview item={item} />
    <div className={styles.detailGrid}>
      <div className={styles.mainColumn}>
        <CaseWorkflowPanel caseId={item.caseId} refreshKey={refreshKey} />
        <div id="case-sources"><SourcePanel caseId={item.caseId} eventId={item.eventId} /></div>
        <Track1CandidateLinkPanel caseId={item.caseId} refreshKey={refreshKey} />
        <div id="case-preparation" />
        <PreparationPanels view={item} locked={locked} onOutcome={onOutcome} refreshKey={refreshKey}
          approvalPanel={(drafts) => <ApprovalSubmitPanel view={item} locked={locked} drafts={drafts} onOutcome={onOutcome} onRefresh={refresh} />} />
        <div id="case-integrity"><EvidenceIntegrityPanel view={item} locked={locked} onOutcome={onOutcome} refreshKey={refreshKey} /></div>
      </div>
      <aside className={styles.sideColumn} aria-label="활동 이력과 업무 동작">
        {reviewerDenied && <p className={styles.blocked} role="note">현재 계정은 검토 담당(REVIEWER) 역할이 없어 서버가 변경 요청을 거부했습니다. 이 화면의 변경 동작을 막았습니다. 역할은 고객사 관리자에게 확인해 주세요.</p>}
        {!reviewerDenied && <p className={styles.caution}>변경 동작은 역할과 관계없이 표시합니다. 상태 변경, 담당자, Snapshot, 초안은 검토 담당 역할만 가능하며 서버가 최종 확인합니다.</p>}
        <TransitionPanel view={item} locked={locked} onOutcome={onOutcome} />
        <AssigneePanel view={item} locked={locked} onOutcome={onOutcome} />
        {/* 활동 이력은 변경 성공이나 충돌 뒤 첫 페이지부터 다시 조회한다. */}
        <div id="case-activities"><ActivityPanel key={refreshKey} caseId={item.caseId} /></div>
        <ApprovalAuditPanel key={`approval-audit:${refreshKey}`} caseId={item.caseId} />
        <Card className={styles.panel}>
          <h2>후속 단계</h2>
          <p className={styles.caution}>공식 보고서 PDF 발급은 별도 절차입니다. 승인 결정이 있으면 위 업무 연결의 링크로 발급 화면을 열고, 서버가 그 화면에서 발급 가능 여부를 다시 확인합니다. 보고서 초안 저장과 승인 결정은 PDF 발급이 아닙니다.</p>
          <div className={styles.actions}>
            <Button variant="secondary" disabled>공식 PDF 발급</Button>
            <Link className={styles.detailLink} to="/app/report-center">조사 보고서 발급 화면으로 이동</Link>
          </div>
        </Card>
      </aside>
    </div>
  </div>
}

function textOrNone(value: string | null) {
  return value === null || value.trim() === '' ? '기록 없음' : value
}

// 저장된 사건 상태별 다음 작업 안내다. 실제 가능 여부는 서버가 요청마다 다시 확인하며, 발급 가능 여부는 사건 상태로 추측하지 않는다.
const nextByStatus: Record<CaseStatus, string[]> = {
  OPEN: ['연결 근거를 확인하고 담당자를 지정합니다.', '조사 범위를 정한 뒤 상태를 분류 완료나 검토 중으로 바꿉니다.'],
  TRIAGED: ['담당자를 지정하고 검토 중으로 상태를 바꿉니다.'],
  IN_REVIEW: [`근거가 갖춰지면 ${terms.evidenceSnapshot}을 만들고 ${terms.reportVersion}을 작성합니다.`, '근거가 부족하면 추가 자료 필요로 상태를 바꿉니다.'],
  NEEDS_EVIDENCE: ['부족한 근거를 보완한 뒤 검토 중으로 되돌립니다.'],
  READY_FOR_APPROVAL: [`${terms.reportVersion}으로 ${terms.approvalRequest}을 만들거나, 이미 만든 요청을 승인 담당이 독립 검토합니다.`],
  APPROVED_FOR_REPORT: ['승인 결정 직후 화면의 링크나 조사 보고서 발급 화면에서 발급 가능 여부를 확인합니다. 발급 가능 여부는 서버가 승인 결정 기준으로 다시 확인합니다.'],
  DISMISSED: ['종결 검토 상태입니다. 활동 기록으로 종결 사유를 확인합니다.'],
  CLOSED: ['종료된 사건입니다. 기록 확인만 할 수 있습니다.'],
}

function CaseGuide({ item }: { item: CaseView }) {
  const confirmed: GuideItem[] = [
    { key: 'status', content: <>현재 상태: {statusLabels.case[item.status].label} (서버 저장 값)</> },
    { key: 'type', content: <>사건 유형: {caseTypeLabels[item.type]}</> },
    { key: 'assignee', content: item.assigneeMembershipId === null ? '담당자: 미지정' : '담당자: 지정됨 (멤버십 ID는 기술 상세에 있습니다)' },
    { key: 'report', content: item.currentReportVersionId === null ? `${terms.reportVersion}: 아직 없음` : `${terms.reportVersion}: 저장됨` },
  ]
  const unconfirmed: GuideItem[] = [
    { key: 'judgement', content: '부정 거래 여부는 확인되지 않았습니다. 사건 상태는 조사 진행 단계입니다.' },
    { key: 'approval', content: '승인 요청과 결정의 현재 상태는 아래 업무 연결과 승인 요청 화면에서 서버 값으로 확인합니다.' },
    { key: 'pdf', content: '공식 보고서 PDF 발급 가능 여부는 승인 결정 기준으로 서버가 확인하기 전까지 알 수 없습니다.' },
    { key: 'names', content: '담당자와 수행자 이름은 조회 API가 없어 표시하지 않습니다.' },
  ]
  const next: GuideItem[] = nextByStatus[item.status].map((text, index) => ({ key: `next-${index}`, content: text }))
  return <>
    <WorkGuide title="조사 사건 진행 요약" confirmed={confirmed} unconfirmed={unconfirmed} next={next} />
    <StepNav label="조사 사건 단계" steps={[
      { key: 'sources', title: '연결 근거', href: '#case-sources', status: '사건에 연결된 제보, 그룹, 비교 실행' },
      { key: 'prepare', title: `${terms.evidenceSnapshot}과 초안`, href: '#case-preparation', status: item.currentReportVersionId === null ? '초안 없음' : '초안 저장됨' },
      { key: 'approval', title: '승인 요청', href: '#case-preparation', status: '초안 기준으로 요청' },
      { key: 'history', title: '활동 기록', href: '#case-activities', status: '변경과 결정 기록' },
    ]} />
  </>
}

function CaseOverview({ item }: { item: CaseView }) {
  return <Card className={styles.overview} aria-label="Case 개요">
    <div className={styles.panelHeading}><h2>사건 개요</h2><StatusBadge domain="case" status={item.status} /></div>
    <dl className={styles.overviewGrid}>
      <div><dt>사건 번호</dt><dd>사건 {item.caseId.slice(0, 8)}</dd></div>
      <div><dt>유형</dt><dd>{caseTypeLabels[item.type]}</dd></div>
      <div><dt>분류</dt><dd className={styles.plainText}>{textOrNone(item.classification)}</dd></div>
      <div><dt>담당자</dt><dd>{item.assigneeMembershipId === null ? '미지정' : '지정됨'}</dd></div>
      <div><dt>{terms.reportVersion}</dt><dd>{item.currentReportVersionId === null ? '없음' : '저장됨'}</dd></div>
      <div><dt>생성 시각</dt><dd><time dateTime={item.createdAt}>{formatUtc(item.createdAt)}</time></dd></div>
      <div><dt>최근 변경</dt><dd><time dateTime={item.updatedAt}>{formatUtc(item.updatedAt)}</time></dd></div>
    </dl>
    {item.relationReason !== null && <p className={styles.linkReason}><strong>연관 사유</strong><span className={styles.plainText}>{item.relationReason}</span></p>}
    <TechnicalDetails summary="기술 상세 (사건 ID, 버전, 증거 개정 번호, 멤버십 ID)">
      <dl className={styles.overviewGrid}>
        <div><dt>Case ID</dt><dd className={styles.idCell}>{item.caseId}</dd></div>
        <div><dt>공연 ID</dt><dd className={styles.idCell}>{item.eventId}</dd></div>
        <div><dt>Case 버전</dt><dd>{item.caseVersion}</dd></div>
        <div><dt>증거 개정 번호</dt><dd>{item.evidenceRevision}</dd></div>
        <div><dt>생성자 멤버십 ID</dt><dd className={styles.idCell}>{item.createdByMembershipId}</dd></div>
        <div><dt>담당자 멤버십 ID</dt><dd className={styles.idCell}>{item.assigneeMembershipId ?? '미지정'}</dd></div>
        <div><dt>연관 Case</dt><dd className={styles.idCell}>{item.relatedCaseId ?? '기록 없음'}</dd></div>
        <div><dt>현재 보고서 버전</dt><dd className={styles.idCell}>{item.currentReportVersionId ?? '기록 없음'}</dd></div>
      </dl>
      <p className={styles.caution}>Case 버전은 사건이 변경될 때마다 서버가 올리는 값이고, 증거 개정 번호는 조사 근거 묶음과 승인 요청이 참조하는 증거 구성 번호로 서로 다른 값입니다. 멤버십 ID를 이름으로 바꾸는 API가 없어 ID로만 표시합니다.</p>
    </TechnicalDetails>
  </Card>
}

function SourcePanel({ caseId, eventId }: { caseId: string; eventId: string }) {
  const { result, retry } = useAdminQuery(caseSourcesPath(caseId), caseSourceListSchema)
  const heading = (count?: number) => <div className={styles.panelHeading}><h2>연결 근거</h2>{count !== undefined && <span>{count}개 출처, 연결 순</span>}</div>
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
      <span className={styles.sourceType}>연결된 예매 그룹 (예매 관계 분석)</span>
      <dl className={styles.definition}>
        <div><dt>분석 요청 ID</dt><dd className={styles.idCell}>{analysisRequestId}</dd></div>
        <div><dt>군집 ID</dt><dd className={styles.idCell}>{clusterId}</dd></div>
        <div><dt>저장 구성원</dt><dd>{source.storedMemberCount}건</dd></div>
        <div><dt>분석 알고리즘</dt><dd>{algorithm === '' ? '기록 없음' : algorithm}</dd></div>
        <div><dt>분석 완료 시각</dt><dd>{source.analysisCompletedAt === null ? '기록 없음' : formatUtc(source.analysisCompletedAt)}</dd></div>
        <div><dt>조사 우선순위 (Risk Score)</dt><dd>{formatRiskScore(source.riskScore)}</dd></div>
        {common}
      </dl>
      <p className={styles.caution}>연결 시점에 저장된 예매 그룹 근거입니다. 조사 우선순위(Risk Score)는 먼저 살펴볼 순서이며 불법 확률이나 부정 거래 확정이 아닙니다.</p>
      <Link className={styles.detailLink} to={track1DetailRoute({ eventId, analysisRequestId, clusterId })}>예매 그룹 근거 보기</Link>
    </article>
  }
  const fanReportId = source.fanReportId ?? ''
  if (source.sourceType === 'FAN_REPORT') {
    return <article className={styles.source} aria-label="Track 2 팬 제보">
      <span className={styles.sourceType}>팬 제보</span>
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
      <span className={styles.sourceType}>예매 기록 비교 실행</span>
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
      <p className={styles.caution}>연결 시점의 후보 실행 기록이며 조사 참고 자료입니다. 부정 거래나 불법 거래 확정이 아닙니다. 예매 기록 비교 실행이 연결된 조사 사건은 비교 결과를 승인 근거로 쓰는 정책이 아직 확정되지 않아 승인 요청과 공식 PDF 발급이 서버에서 차단됩니다(APPROVAL_BASIS_BLOCKED). 승인과 공식 PDF 흐름은 후보 실행을 출처로 넣지 않은 별도의 적격 합성 Case에서 진행하며, 적격 여부는 서버가 다시 확인합니다.</p>
      <Link className={styles.detailLink} to={fanReportDetailRoute(fanReportId)}>소속 제보 상세 보기</Link>
    </article>
  }
  return <article className={styles.source} aria-label="Track 2 제보 증거 이미지">
    <span className={styles.sourceType}>제보 증거 이미지</span>
    <dl className={styles.definition}>
      <div><dt>소속 제보 ID</dt><dd className={styles.idCell}>{fanReportId}</dd></div>
      <div><dt>증거 ID</dt><dd className={styles.idCell}>{source.evidenceId}</dd></div>
      {common}
    </dl>
    <p className={styles.caution}>특정 제보에 속한 증거 이미지이며 독립된 분석 결과나 확정 판정이 아닙니다.</p>
    <Link className={styles.detailLink} to={fanReportDetailRoute(fanReportId)}>소속 제보 상세 보기</Link>
  </article>
}

export function ActivityPanel({ caseId }: { caseId: string }) {
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
