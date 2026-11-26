import { useEffect, useMemo, useRef, useState } from 'react'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { adminEventsPath, adminEventPageSchema } from '../admin-events/adminEventsApi'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { formatUtc } from '../admin-track2/track2Api'
import styles from '../admin-track1/Track1.module.css'
import {
  multiEventAcceptedSchema, multiEventAvailablePerformancesPath, multiEventCandidatePageSchema, multiEventCandidatesPath,
  multiEventMemberPageSchema, multiEventMembersPath, multiEventRelationshipPageSchema, multiEventRelationshipsPath,
  multiEventRunListSchema, multiEventRunsPath, multiEventScopeListSchema, multiEventScopePageSchema, multiEventSourcesPath, multiEventRetryPath, safeDetail,
  retiredScoreVersion,
} from './multiEventInvestigationApi'
import { parseSignalKeys, signalLabel } from './multiEventSignals'
import type { MultiEventCandidate, MultiEventRelationship, MultiEventRun, MultiEventRunPage } from './multiEventInvestigationApi'

function randomRequestId() { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null }
function localInputDate(date: Date) { const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16) }
const performanceRequired = '회차를 두 개 이상 선택해 주세요.'

// 작업 실패 코드는 고정 한국어 설명으로만 보여 준다. 알 수 없는 코드는 원래 코드만 표시한다.
const runFailureLabels: Record<string, string> = {
  SCORE_VERSION_RETIRED: '퇴역한 점수 모델이라 다시 실행하지 않음',
  DATA_CONTRACT_INVALID: '분석 결과가 계약과 달라 차단됨',
  DATA_UNAVAILABLE: '분석 서비스에 연결하지 못함',
  MULTI_EVENT_ANALYSIS_FAILED: '분석 실패',
  RETRY_LIMIT_EXCEEDED: '재시도 한도 초과',
}
function runStatusText(run: MultiEventRun) {
  if (!run.failureCode) return run.status
  const label = runFailureLabels[run.failureCode]
  return label === undefined ? `${run.status}: ${run.failureCode}` : `${run.status}: ${label}`
}

/** 신호 목록을 한국어 라벨로 보여 주고 원래 키는 툴팁에만 둔다. */
function SignalList({ value }: { value: string }) {
  const keys = parseSignalKeys(value)
  if (keys.length === 0) return <span>없음</span>
  return <>{keys.map((key, index) => <span key={key}>{index > 0 && ', '}<SignalName signal={key} /></span>)}</>
}
function SignalName({ signal }: { signal: string }) { return <span title={signal}>{signalLabel(signal)}</span> }

export function MultiEventInvestigationRoute() {
  const [eventPage, setEventPage] = useState(0)
  const events = useAdminQuery(adminEventsPath(eventPage), adminEventPageSchema)
  const client = useAdminApiClient()
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [selectedPerformanceMap, setSelectedPerformanceMap] = useState<Record<string, string[]>>({})
  const [periodStart, setPeriodStart] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 30); return localInputDate(date) })
  const [periodEnd, setPeriodEnd] = useState(() => localInputDate(new Date()))
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [runPage, setRunPage] = useState(0)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [availableCounts, setAvailableCounts] = useState<Record<string, number>>({})
  const pending = useRef<string | null>(null)
  const runs = useAdminQuery(anchor === null ? null : multiEventRunsPath(anchor, runPage), multiEventRunListSchema, refreshVersion)
  const selected = useMemo(() => new Set(selectedEvents), [selectedEvents])
  // 회차를 고르지 않은 공연은 공개 회차 전체를 분석하므로 그 공연의 공개 회차 수로 셉니다.
  const performanceCount = selectedEvents.reduce((total, eventId) => {
    const chosen = selectedPerformanceMap[eventId] ?? []
    return total + (chosen.length > 0 ? chosen.length : availableCounts[eventId] ?? 0)
  }, 0)
  // 회차는 한 공연에만 속하므로 서로 다른 공연이 둘 이상이면 서로 다른 회차도 둘 이상입니다.
  const canSubmit = selectedEvents.length >= 2 || (selectedEvents.length === 1 && performanceCount >= 2)
  const toggleEvent = (id: string) => {
    const next = selectedEvents.includes(id) ? selectedEvents.filter((value) => value !== id) : [...selectedEvents, id]
    setSelectedEvents(next)
    if (!next.includes(id)) setSelectedPerformanceMap((values) => { const copy = { ...values }; delete copy[id]; return copy })
  }
  const submit = async () => {
    if (!canSubmit) { setNotice(performanceRequired); return }
    const key = pending.current ?? randomRequestId()
    if (key === null) { setNotice('안전한 요청 키를 만들 수 없습니다.'); return }
    const start = new Date(periodStart); const end = new Date(periodEnd)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end > new Date()) { setNotice('분석 기간을 확인해 주세요. 종료 시각은 현재보다 늦을 수 없습니다.'); return }
    pending.current = key; setSubmitting(true)
    const result = await client.request('/api/v1/admin/multi-event-investigations', {
      method: 'POST', body: {
        eventIds: selectedEvents,
        performanceSelections: selectedEvents.map((eventId) => ({ eventId, performanceIds: selectedPerformanceMap[eventId] ?? [] })),
        analysisStartAt: start.toISOString(), analysisEndAt: end.toISOString(),
      }, idempotencyKey: key,
      successStatus: 202, schema: multiEventAcceptedSchema,
    })
    setSubmitting(false)
    if (result.kind === 'success') { pending.current = null; setAnchor(selectedEvents[0]); setRunPage(0); setRefreshVersion((value) => value + 1); setNotice(`분석 작업 ${result.data.runId} 상태: ${result.data.status}`) }
    else setNotice(describeAdminApiFailure(result, '다공연 분석 요청 결과를 확인하지 못했습니다').title)
  }
  return <main className={styles.page}>
    <h1>다공연 조사 분석</h1>
    <p className={styles.muted}>고정된 공개 원장 version만 사용합니다. 조사 후보는 불법 조직 확정, 자동 취소 또는 제재 근거가 아닙니다.</p>
    <Card className={styles.panel} aria-label="다공연 분석 범위 선택">
      <h2>분석 범위</h2>
      {events.result === null ? <LoadingSkeleton label="접근 가능한 공연을 불러오는 중" />
        : events.result.kind !== 'success' ? <Failure result={events.result} retry={events.retry} fallback="공연 목록을 불러오지 못했습니다" />
          : events.result.data.items.length === 0 ? <EmptyState title="접근 가능한 공연이 없습니다" />
            : <><p>공연 하나 이상과 서로 다른 회차 두 개 이상을 선택합니다. 같은 공연의 다른 회차도 반복 근거가 됩니다. 서버가 권한, 공개 상태, 공급자 namespace, HMAC 목적 및 키 버전을 재검증합니다.</p>
              <div className={styles.form}>{events.result.data.items.map((event) => <label key={event.id}><input type="checkbox" checked={selected.has(event.id)} onChange={() => toggleEvent(event.id)} /> {event.name}</label>)}</div>
              <p><Button size="small" variant="secondary" disabled={eventPage===0} onClick={() => setEventPage((value)=>Math.max(0,value-1))}>공연 이전</Button> <Button size="small" variant="secondary" disabled={!events.result.data.hasNext} onClick={() => setEventPage((value)=>value+1)}>공연 다음</Button> <span>공연 {selectedEvents.length}개, 회차 {performanceCount}개 선택</span></p>
              <div className={styles.form}><label>분석 시작 <input type="datetime-local" value={periodStart} max={periodEnd} onChange={(event) => setPeriodStart(event.target.value)} /></label><label>분석 종료 <input type="datetime-local" value={periodEnd} max={localInputDate(new Date())} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div>
              {selectedEvents.map((eventId) => <EventPerformancePicker key={eventId} eventId={eventId} values={selectedPerformanceMap[eventId] ?? []}
                onChange={(values) => setSelectedPerformanceMap((current) => ({ ...current, [eventId]: values }))}
                onAvailable={(count) => setAvailableCounts((current) => current[eventId] === count ? current : { ...current, [eventId]: count })} />)}
              {selectedEvents.length > 0 && !canSubmit && <p className={styles.warning}>{performanceRequired}</p>}
              <Button loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>고정 원장으로 다공연 분석 요청</Button>
            </>}
      {notice && <p className={styles.warning} role="status">{notice}</p>}
    </Card>
    {anchor !== null && <RunList eventId={anchor} query={runs} page={runPage} setPage={setRunPage} onRefresh={() => setRefreshVersion((value) => value + 1)} />}
  </main>
}

function EventPerformancePicker({ eventId, values, onChange, onAvailable }: { eventId: string; values: string[]; onChange: (values: string[]) => void; onAvailable: (count: number) => void }) {
  const [page, setPage] = useState(0)
  const query = useAdminQuery(multiEventAvailablePerformancesPath(eventId, page), multiEventScopePageSchema)
  // 다음 페이지가 있으면 회차가 더 있으므로 최소 한 개를 더해 알립니다. 확인하지 못하면 0개로 봅니다.
  const loaded = query.result?.kind === 'success' ? query.result.data.items.length + (query.result.data.hasNext ? 1 : 0) : 0
  useEffect(() => { onAvailable(loaded) }, [loaded, onAvailable])
  if (query.result === null) return <LoadingSkeleton label="공개 원장 회차를 확인하는 중" />
  if (query.result.kind !== 'success') return <Failure result={query.result} retry={query.retry} fallback="공개 원장 회차를 불러오지 못했습니다" />
  return <section><h3>회차 선택 / {query.result.data.items[0]?.eventReference ?? eventId}</h3>{query.result.data.items.length === 0 ? <p className={styles.warning}>공개된 원장 head가 있는 회차가 없습니다.</p> : <><p>선택하지 않으면 이 공연의 공개 회차 전체를 분석합니다. 출처 batch와 원장 version은 요청 시 고정됩니다.</p>{query.result.data.items.map((scope) => <label key={scope.performanceId}><input type="checkbox" checked={values.includes(scope.performanceId)} onChange={() => onChange(values.includes(scope.performanceId) ? values.filter((value) => value !== scope.performanceId) : [...values, scope.performanceId])} /> {scope.performanceId} (batch {scope.sourceBatchId}, 원장 {scope.ledgerVersionId})</label>)}<p><Button size="small" variant="secondary" disabled={page===0} onClick={() => setPage((value)=>Math.max(0,value-1))}>이전</Button> <Button size="small" variant="secondary" disabled={!query.result.data.hasNext} onClick={() => setPage((value)=>value+1)}>다음</Button></p></>}</section>
}

function RunList({ eventId, query, page, setPage, onRefresh }: { eventId: string; query: ReturnType<typeof useAdminQuery<MultiEventRunPage>>; page: number; setPage: (page: number) => void; onRefresh: () => void }) {
  const [selected, setSelected] = useState<MultiEventRun | null>(null)
  const selectedRun = selected === null ? null : query.result?.kind === 'success' ? query.result.data.items.find((run) => run.id === selected.id) ?? selected : selected
  if (query.result === null) return <LoadingSkeleton label="다공연 분석 작업을 불러오는 중" />
  if (query.result.kind !== 'success') return <Failure result={query.result} retry={query.retry} fallback="다공연 분석 작업을 불러오지 못했습니다" />
  return <Card className={styles.panel} aria-label="다공연 분석 작업 목록"><h2>다공연 분석 작업</h2>
    <DataTable caption="다공연 분석 작업" rows={query.result.data.items} getRowKey={(run) => run.id} emptyMessage="요청한 분석 작업이 없습니다." columns={[
      { key: 'run', header: '작업', render: (run) => run.id },
      { key: 'status', header: '상태', render: (run) => <span title={run.failureCode ?? undefined}>{runStatusText(run)}</span> },
      { key: 'time', header: '시각', render: (run) => formatUtc(run.updatedAt) },
      { key: 'open', header: '결과', render: (run) => <Button size="small" variant="secondary" onClick={() => setSelected(run)}>열기</Button> },
    ]} />
    <p><Button size="small" variant="secondary" disabled={page===0} onClick={() => setPage(Math.max(0,page-1))}>이전</Button> <Button size="small" variant="secondary" disabled={!query.result.data.hasNext} onClick={() => setPage(page+1)}>다음</Button></p>
    {selectedRun !== null && <RunDetail eventId={eventId} run={selectedRun} onRefresh={onRefresh} />}
  </Card>
}

function RunDetail({ eventId, run, onRefresh }: { eventId: string; run: MultiEventRun; onRefresh: () => void }) {
  const [page, setPage] = useState(0); const [candidate, setCandidate] = useState<MultiEventCandidate | null>(null)
  const [retrying, setRetrying] = useState(false); const [retryMessage, setRetryMessage] = useState('')
  const client = useAdminApiClient()
  const candidates = useAdminQuery(multiEventCandidatesPath(eventId, run.id, page), multiEventCandidatePageSchema)
  const sources = useAdminQuery(multiEventSourcesPath(eventId, run.id), multiEventScopeListSchema)
  const retryRun = async () => {
    const path = multiEventRetryPath(eventId, run.id)
    if (path === null) { setRetryMessage('작업 경로가 올바르지 않습니다.'); return }
    setRetrying(true)
    const result = await client.request(path, { method: 'POST', body: null, successStatus: 202, schema: multiEventAcceptedSchema })
    setRetrying(false)
    if (result.kind === 'success') { setRetryMessage('재시도 작업을 접수했습니다.'); onRefresh() }
    else setRetryMessage(describeAdminApiFailure(result, '재시도 요청을 처리하지 못했습니다').title)
  }
  const retired = run.scoreVersion === retiredScoreVersion
  const retiredNotice = retired && <p className={styles.warning}>이전 점수 모델(공연 수 기준 R)로 계산된 읽기 전용 결과입니다. 다시 실행하지 않으며, 새 분석은 회차 수 기준 모델로 요청해 주세요.</p>
  if (run.status !== 'COMPLETED') return <section><h3>작업 상세</h3>{retiredNotice}<p className={styles.warning}>현재 {runStatusText(run)} 상태입니다. 빈 후보 목록을 정상 결과 0건으로 표시하지 않습니다.</p>{run.status === 'RETRYABLE' && !retired && <Button loading={retrying} onClick={() => void retryRun()}>분석 재시도</Button>}{retryMessage && <p role="status">{retryMessage}</p>}</section>
  return <section className={styles.detailColumn}><h3>조사 후보</h3>{retiredNotice}
    <p>모델 {run.scoreVersion} / {run.projectionVersion} / {run.algorithmVersion ?? '분석기 버전 없음'}. 분석 기준 {formatUtc(run.analysisAsOf)}. 분석 기간 {formatUtc(run.analysisStartAt)} ~ {formatUtc(run.analysisEndAt)}.</p>
    {sources.result === null ? <LoadingSkeleton label="고정 원장 출처를 불러오는 중" />
      : sources.result.kind !== 'success' ? <Failure result={sources.result} retry={sources.retry} fallback="고정 원장 출처를 불러오지 못했습니다" />
        : sources.result.data.length === 0 ? <EmptyState title="고정 원장 출처가 없습니다" />
          : <p>고정 원장 source: {sources.result.data.length}개 회차 / {sources.result.data.map((source) => `${source.eventReference}/${source.performanceId} batch ${source.sourceBatchId}`).join(', ')}</p>}
    {candidates.result === null ? <LoadingSkeleton label="조사 후보를 불러오는 중" />
      : candidates.result.kind !== 'success' ? <Failure result={candidates.result} retry={candidates.retry} fallback="조사 후보를 불러오지 못했습니다" />
        : <><DataTable caption="다공연 조사 후보" rows={candidates.result.data.items} getRowKey={(item) => item.candidateId} columns={[
          { key: 'score', header: '우선순위', render: (item) => `${item.priorityBand} / ${item.investigationScore.toFixed(4)} (회차 최대 ${item.baselineMaxScore?.toFixed(4) ?? '미산출'})` },
          { key: 'scope', header: '범위', render: (item) => `공연 ${item.distinctEventCount}, 회차 ${item.distinctPerformanceCount}, 계정 ${item.distinctAccountCount}` },
          { key: 'relationship', header: '검증 관계', render: (item) => `${item.verifiedRelationshipCount}건` },
          { key: 'open', header: '근거', render: (item) => <Button size="small" variant="secondary" onClick={() => setCandidate(item)}>열기</Button> },
        ]} />
          <p><Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>이전</Button> <Button size="small" variant="secondary" disabled={!candidates.result.data.hasNext} onClick={() => setPage((value) => value + 1)}>다음</Button></p>
          {candidate !== null && <CandidateDetail key={candidate.candidateId} eventId={eventId} runId={run.id} candidate={candidate} />}
        </>}
  </section>
}

function CandidateDetail({ eventId, runId, candidate }: { eventId: string; runId: string; candidate: MultiEventCandidate }) {
  const [memberPage, setMemberPage] = useState(0)
  const [relationshipPage, setRelationshipPage] = useState(0)
  const members = useAdminQuery(multiEventMembersPath(eventId, runId, candidate.candidateId, memberPage), multiEventMemberPageSchema)
  const relationships = useAdminQuery(multiEventRelationshipsPath(eventId, runId, candidate.candidateId, relationshipPage), multiEventRelationshipPageSchema)
  const detail = safeDetail(candidate.scoreBreakdown)
  return <section aria-label="조사 후보 근거"><h3>조사 근거와 관계 그래프</h3>
    <p>그래프는 페이지 범위의 불투명 구성원과 검증된 관계만 표시합니다. 원본 HMAC, 개인정보, 저장소 경로는 브라우저로 전송하지 않습니다.</p>
    <dl className={styles.factList}><div><dt>공연 수 / 서로 다른 회차 수</dt><dd>공연 {candidate.distinctEventCount}개 / 회차 {candidate.distinctPerformanceCount}개</dd></div><div><dt>L / G / B</dt><dd>{String(detail?.L ?? '미확인')} / {String(detail?.G ?? '미확인')} / {String(detail?.B ?? '미확인')}</dd></div><div><dt>Q / 회차 반복 R</dt><dd>{String(detail?.Q ?? '미확인')} / {String(detail?.R ?? '미확인')}</dd></div><div><dt>수량 상태와 사유</dt><dd>{String(detail?.quantityStatus ?? '미확인')} / {String(detail?.quantityReason ?? '정책 미포함')}</dd></div></dl>
    <p className={styles.muted}>R은 서로 다른 회차 수 기준입니다: min((회차 수 - 1) / 3, 1). 같은 공연의 다른 회차도 반복으로 셉니다.</p>
    <p>가용 신호: <SignalList value={candidate.availableSignals} />. 제외 신호: <SignalList value={candidate.excludedSignals} />. 가용하지 않은 신호: <SignalList value={candidate.unavailableSignals} />. 정상 공유 가능성: {candidate.normalSharingPossibilities}.</p>
    <h4>다음 확인 항목</h4><ul><li>각 출처 batch와 공개 원장 version을 확인합니다.</li><li>신호가 반복된 계정 관계를 원본 계약 밖으로 내보내지 않은 승인 자료와 대조합니다.</li><li>가족, 공동 주소, 공용 기기 등 정상 공유 가능성을 검토합니다.</li><li>가용하지 않은 신호는 근거가 있다고 간주하지 않습니다.</li></ul>
    {relationships.result === null ? <LoadingSkeleton label="관계 근거를 불러오는 중" />
      : relationships.result.kind !== 'success' ? <Failure result={relationships.result} retry={relationships.retry} fallback="관계 근거를 불러오지 못했습니다" />
        : relationships.result.data.items.length === 0 ? <EmptyState title="현재 페이지에 표시할 관계가 없습니다" />
          : <><RelationshipGraph relationships={relationships.result.data.items} /><DataTable caption="검증된 관계" rows={relationships.result.data.items} getRowKey={(item) => item.relationshipId} columns={[{ key: 'signal', header: '신호', render: (item) => <SignalName signal={item.signalType} /> }, { key: 'accounts', header: '계정 수', render: (item) => `${item.accountCount}${item.membersTruncated ? ' (그래프 일부)' : ''}` }, { key: 'scopes', header: '공연 / 회차 출처', render: (item) => item.sourceScopes.map((scope) => `${scope.eventReference}/${scope.performanceId} batch ${scope.sourceBatchId}`).join(', ') }]} /><p><Button size="small" variant="secondary" disabled={relationshipPage===0} onClick={() => setRelationshipPage((value)=>Math.max(0,value-1))}>관계 이전</Button> <Button size="small" variant="secondary" disabled={!relationships.result.data.hasNext} onClick={() => setRelationshipPage((value)=>value+1)}>관계 다음</Button></p></>}
    {members.result === null ? <LoadingSkeleton label="구성원 페이지를 불러오는 중" />
      : members.result.kind !== 'success' ? <Failure result={members.result} retry={members.retry} fallback="구성원 페이지를 불러오지 못했습니다" />
        : members.result.data.items.length === 0 ? <EmptyState title="표시할 구성원이 없습니다" />
          : <><DataTable caption="불투명 구성원" rows={members.result.data.items} getRowKey={(item) => item.memberId} columns={[{ key: 'member', header: '구성원', render: (item) => item.memberId }]} /><p><Button size="small" variant="secondary" disabled={memberPage===0} onClick={() => setMemberPage((value)=>Math.max(0,value-1))}>구성원 이전</Button> <Button size="small" variant="secondary" disabled={!members.result.data.hasNext} onClick={() => setMemberPage((value)=>value+1)}>구성원 다음</Button></p></>}
  </section>
}

function RelationshipGraph({ relationships }: { relationships: MultiEventRelationship[] }) {
  const accountIds = [...new Set(relationships.flatMap((relationship) => relationship.memberIds))].slice(0, 20)
  if (accountIds.length === 0) return <p className={styles.muted}>현재 페이지에 표시할 구성원 연결이 없습니다.</p>
  const accountPositions = new Map(accountIds.map((id, index) => [id, { x: 44, y: 30 + index * 28 }]))
  const rowCount = Math.max(accountIds.length, relationships.length)
  return <svg role="img" aria-label="검증된 관계와 불투명 계정 참조 그래프" viewBox={`0 0 680 ${Math.max(100, 60 + rowCount * 28)}`} style={{ width: '100%', maxHeight: 480 }}>
    {relationships.map((relationship, index) => {
      const y = 30 + index * 28
      return <g key={relationship.relationshipId}>
        {relationship.memberIds.filter((id) => accountPositions.has(id)).map((id) => <line key={`${relationship.relationshipId}-${id}`} x1="190" y1={y} x2={accountPositions.get(id)?.x ?? 0} y2={accountPositions.get(id)?.y ?? 0} stroke="currentColor" opacity="0.35" />)}
        <rect x="190" y={y - 10} width="180" height="20" rx="5" fill="var(--surface-subtle, #eef2f7)" stroke="currentColor" />
        <text x="200" y={y + 4} fontSize="10"><title>{relationship.signalType}</title>{signalLabel(relationship.signalType)}</text>
      </g>
    })}
    {accountIds.map((id) => { const position = accountPositions.get(id); if (!position) return null; return <g key={id}><circle cx={position.x} cy={position.y} r="10" fill="var(--accent, #5577aa)" /><text x="62" y={position.y + 3} fontSize="9">{id}</text></g> })}
    <text x="400" y="24" fontSize="10">페이지 범위 / 최대 20개 계정</text>
  </svg>
}

function Failure({ result, retry, fallback }: { result: Exclude<ReturnType<typeof useAdminQuery>['result'], null | { kind: 'success' }>; retry: () => void; fallback: string }) { const message = describeAdminApiFailure(result, fallback); return <ErrorState title={message.title} description={message.description} onRetry={retry} /> }
