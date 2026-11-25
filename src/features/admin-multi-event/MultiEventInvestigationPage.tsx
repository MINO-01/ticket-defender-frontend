import { useMemo, useRef, useState } from 'react'
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
} from './multiEventInvestigationApi'
import type { MultiEventCandidate, MultiEventRelationship, MultiEventRun, MultiEventRunPage } from './multiEventInvestigationApi'

function randomRequestId() { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null }
function localInputDate(date: Date) { const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16) }

export function MultiEventInvestigationRoute() {
  const events = useAdminQuery(adminEventsPath(0), adminEventPageSchema)
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
  const pending = useRef<string | null>(null)
  const runs = useAdminQuery(anchor === null ? null : multiEventRunsPath(anchor, runPage), multiEventRunListSchema, refreshVersion)
  const selected = useMemo(() => new Set(selectedEvents), [selectedEvents])
  const toggleEvent = (id: string) => {
    const next = selectedEvents.includes(id) ? selectedEvents.filter((value) => value !== id) : [...selectedEvents, id]
    setSelectedEvents(next)
    if (!next.includes(id)) setSelectedPerformanceMap((values) => { const copy = { ...values }; delete copy[id]; return copy })
  }
  const submit = async () => {
    if (selectedEvents.length < 2) { setNotice('서로 다른 공연을 두 개 이상 선택해 주세요.'); return }
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
            : <><p>서로 다른 공연을 둘 이상 선택합니다. 서버가 권한, 공개 상태, 공급자 namespace, HMAC 목적 및 키 버전을 재검증합니다.</p>
              <div className={styles.form}>{events.result.data.items.map((event) => <label key={event.id}><input type="checkbox" checked={selected.has(event.id)} onChange={() => toggleEvent(event.id)} /> {event.name}</label>)}</div>
              <div className={styles.form}><label>분석 시작 <input type="datetime-local" value={periodStart} max={periodEnd} onChange={(event) => setPeriodStart(event.target.value)} /></label><label>분석 종료 <input type="datetime-local" value={periodEnd} max={localInputDate(new Date())} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div>
              {selectedEvents.map((eventId) => <EventPerformancePicker key={eventId} eventId={eventId} values={selectedPerformanceMap[eventId] ?? []} onChange={(values) => setSelectedPerformanceMap((current) => ({ ...current, [eventId]: values }))} />)}
              <Button loading={submitting} disabled={selectedEvents.length < 2} onClick={() => void submit()}>고정 원장으로 다공연 분석 요청</Button>
            </>}
      {notice && <p className={styles.warning} role="status">{notice}</p>}
    </Card>
    {anchor !== null && <RunList eventId={anchor} query={runs} page={runPage} setPage={setRunPage} onRefresh={() => setRefreshVersion((value) => value + 1)} />}
  </main>
}

function EventPerformancePicker({ eventId, values, onChange }: { eventId: string; values: string[]; onChange: (values: string[]) => void }) {
  const [page, setPage] = useState(0)
  const query = useAdminQuery(multiEventAvailablePerformancesPath(eventId, page), multiEventScopePageSchema)
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
      { key: 'status', header: '상태', render: (run) => `${run.status}${run.failureCode ? `: ${run.failureCode}` : ''}` },
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
  if (run.status !== 'COMPLETED') return <section><h3>작업 상세</h3><p className={styles.warning}>현재 {run.status} 상태입니다. 빈 후보 목록을 정상 결과 0건으로 표시하지 않습니다.</p>{run.status === 'RETRYABLE' && <Button loading={retrying} onClick={() => void retryRun()}>분석 재시도</Button>}{retryMessage && <p role="status">{retryMessage}</p>}</section>
  return <section className={styles.detailColumn}><h3>조사 후보</h3>
    <p>모델 {run.scoreVersion} / {run.projectionVersion} / {run.algorithmVersion ?? '분석기 버전 없음'}. 분석 기준 {formatUtc(run.analysisAsOf)}. 분석 기간 {formatUtc(run.analysisStartAt)} ~ {formatUtc(run.analysisEndAt)}.</p>
    {sources.result?.kind === 'success' && <p>고정 원장 source: {sources.result.data.length}개 회차 / {sources.result.data.map((source) => `${source.eventReference}/${source.performanceId} batch ${source.sourceBatchId}`).join(', ')}</p>}
    {candidates.result === null ? <LoadingSkeleton label="조사 후보를 불러오는 중" />
      : candidates.result.kind !== 'success' ? <Failure result={candidates.result} retry={candidates.retry} fallback="조사 후보를 불러오지 못했습니다" />
        : <><DataTable caption="다공연 조사 후보" rows={candidates.result.data.items} getRowKey={(item) => item.candidateId} columns={[
          { key: 'score', header: '우선순위', render: (item) => `${item.priorityBand} / ${item.investigationScore.toFixed(4)} (회차 최대 ${item.baselineMaxScore?.toFixed(4) ?? '미산출'})` },
          { key: 'scope', header: '범위', render: (item) => `공연 ${item.distinctEventCount}, 회차 ${item.distinctPerformanceCount}, 계정 ${item.distinctAccountCount}` },
          { key: 'relationship', header: '검증 관계', render: (item) => `${item.verifiedRelationshipCount}건` },
          { key: 'open', header: '근거', render: (item) => <Button size="small" variant="secondary" onClick={() => setCandidate(item)}>열기</Button> },
        ]} />
          <p><Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>이전</Button> <Button size="small" variant="secondary" disabled={!candidates.result.data.hasNext} onClick={() => setPage((value) => value + 1)}>다음</Button></p>
          {candidate !== null && <CandidateDetail eventId={eventId} runId={run.id} candidate={candidate} />}
        </>}
  </section>
}

function CandidateDetail({ eventId, runId, candidate }: { eventId: string; runId: string; candidate: MultiEventCandidate }) {
  const members = useAdminQuery(multiEventMembersPath(eventId, runId, candidate.candidateId, 0), multiEventMemberPageSchema)
  const relationships = useAdminQuery(multiEventRelationshipsPath(eventId, runId, candidate.candidateId, 0), multiEventRelationshipPageSchema)
  const detail = safeDetail(candidate.scoreBreakdown)
  return <section aria-label="조사 후보 근거"><h3>조사 근거와 관계 그래프</h3>
    <p>그래프는 페이지 범위의 불투명 구성원과 검증된 관계만 표시합니다. 원본 HMAC, 개인정보, 저장소 경로는 브라우저로 전송하지 않습니다.</p>
    <dl className={styles.factList}><div><dt>L / G / B</dt><dd>{String(detail?.L ?? '미확인')} / {String(detail?.G ?? '미확인')} / {String(detail?.B ?? '미확인')}</dd></div><div><dt>Q / 공연 반복 R</dt><dd>{String(detail?.Q ?? '미확인')} / {String(detail?.R ?? '미확인')}</dd></div><div><dt>수량 상태와 사유</dt><dd>{String(detail?.quantityStatus ?? '미확인')} / {String(detail?.quantityReason ?? '정책 미포함')}</dd></div></dl>
    <p>가용 신호: {candidate.availableSignals}. 제외 신호: {candidate.excludedSignals}. 가용하지 않은 신호: {candidate.unavailableSignals}. 정상 공유 가능성: {candidate.normalSharingPossibilities}.</p>
    <h4>다음 확인 항목</h4><ul><li>각 출처 batch와 공개 원장 version을 확인합니다.</li><li>신호가 반복된 계정 관계를 원본 계약 밖으로 내보내지 않은 승인 자료와 대조합니다.</li><li>가족, 공동 주소, 공용 기기 등 정상 공유 가능성을 검토합니다.</li><li>가용하지 않은 신호는 근거가 있다고 간주하지 않습니다.</li></ul>
    {relationships.result?.kind === 'success' && <><RelationshipGraph relationships={relationships.result.data.items} /><DataTable caption="검증된 관계" rows={relationships.result.data.items} getRowKey={(item) => item.relationshipId} columns={[{ key: 'signal', header: '신호', render: (item) => item.signalType }, { key: 'accounts', header: '계정 수', render: (item) => `${item.accountCount}${item.membersTruncated ? ' (그래프 일부)' : ''}` }, { key: 'scopes', header: '공연 / 회차 출처', render: (item) => item.sourceScopes.map((scope) => `${scope.eventReference}/${scope.performanceId} batch ${scope.sourceBatchId}`).join(', ') }]} /></>}
    {members.result?.kind === 'success' && <DataTable caption="불투명 구성원" rows={members.result.data.items} getRowKey={(item) => item.memberId} columns={[{ key: 'member', header: '구성원', render: (item) => item.memberId }]} />}
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
        <text x="200" y={y + 4} fontSize="10">{relationship.signalType}</text>
      </g>
    })}
    {accountIds.map((id) => { const position = accountPositions.get(id); if (!position) return null; return <g key={id}><circle cx={position.x} cy={position.y} r="10" fill="var(--accent, #5577aa)" /><text x="62" y={position.y + 3} fontSize="9">{id}</text></g> })}
    <text x="400" y="24" fontSize="10">페이지 범위 / 최대 20개 계정</text>
  </svg>
}

function Failure({ result, retry, fallback }: { result: Exclude<ReturnType<typeof useAdminQuery>['result'], null | { kind: 'success' }>; retry: () => void; fallback: string }) { const message = describeAdminApiFailure(result, fallback); return <ErrorState title={message.title} description={message.description} onRetry={retry} /> }
