import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { ClusterGraph } from './ClusterGraph'
import {
  formatAlgorithm, formatAnalyzedAt, formatRiskScore, readTrack1ClusterKey, readTrack1Page,
  track1ClusterListPath, track1ClusterPageSchema, track1DetailRoute, track1ListRoute,
} from './track1Api'
import type { Track1ClusterKey, Track1ClusterSummary } from './track1Api'
import { toGraphModel, track1ClusterGraphPath, track1ClusterGraphSchema } from './track1GraphApi'
import type { Track1ClusterGraph } from './track1GraphApi'
import type { GraphModel } from './track1Model'
import styles from './Track1.module.css'

// 인증된 관리자의 Track 1 관계 그래프 화면이다. 군집 목록과 그래프 API의 응답만 사용하며 합성 데모 데이터를 쓰지 않는다.
// 상세 API는 원본 accountId와 reservationNo를 포함하므로 이 화면에서 호출하지 않는다. 군집 메타데이터는 목록의 선택 항목을 쓴다.
// 그래프 응답이 요청한 분석과 군집이 아니면 다른 범위의 데이터가 섞일 수 있으므로 표시하지 않는다.

const invalidResponse = (status: number): AdminApiFailure => ({ kind: 'invalidResponse', status })

export function LiveClusterGraphPage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="예매 관계 분석" title="예매 관계 그래프" description="서버에 저장된 분석 결과의 계정, 예매, 공유 신호 관계를 확인합니다. 조사 우선순위는 먼저 살펴볼 순서이며 부정거래 확률이 아닙니다." />
    <AdminEventGate>{(event) => <GraphWorkspace key={event.id} event={event} />}</AdminEventGate>
  </div>
}

function GraphWorkspace({ event }: { event: AdminEvent }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = readTrack1Page(searchParams.get('page'))
  const { result, retry } = useAdminQuery(track1ClusterListPath(event.id, page, 'priority-desc'), track1ClusterPageSchema)

  const navigate = (next: { page: number; cluster?: Track1ClusterKey }) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    params.set('eventId', event.id)
    params.set('page', String(next.page))
    if (next.cluster) {
      params.set('analysisRequestId', next.cluster.analysisRequestId)
      params.set('clusterId', next.cluster.clusterId)
    } else {
      params.delete('analysisRequestId')
      params.delete('clusterId')
    }
    return params
  })

  if (result === null) return <LoadingSkeleton label="군집 목록을 불러오는 중" />
  const mismatched = result.kind === 'success' && (result.data.event.id !== event.id || result.data.page !== page)
  if (result.kind !== 'success' || mismatched) {
    const message = describeAdminApiFailure(result.kind === 'success' ? invalidResponse(result.status) : result, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    return <ErrorState title={message.title} description={message.description} onRetry={retry} />
  }

  const data = result.data
  if (data.totalItems === 0) return <EmptyState title="저장된 군집이 없습니다" description="선택한 공연에 저장된 군집이 없습니다. 분석 실행 여부나 분석 실패 여부를 뜻하지 않습니다." />

  const keyOf = (item: (typeof data.items)[number]): Track1ClusterKey => ({ eventId: event.id, analysisRequestId: item.analysisRequestId, clusterId: item.clusterId })
  const addressed = readTrack1ClusterKey(searchParams)
  const selected = addressed?.eventId === event.id ? addressed : data.items[0] ? keyOf(data.items[0]) : null
  const first = data.page * data.pageSize + 1

  return <div className={styles.posterGrid}>
    <Card className={styles.panel} aria-label="군집 목록">
      <h2>{event.name} 군집</h2>
      <p className={styles.muted}>전체 {data.totalItems}건, 조사 우선순위 높은 순</p>
      <ul className={styles.memberList}>{data.items.map((item, index) => {
        const isSelected = selected?.analysisRequestId === item.analysisRequestId && selected.clusterId === item.clusterId
        return <li key={JSON.stringify([item.analysisRequestId, item.clusterId])}>
          <button type="button" className={isSelected ? styles.selectedItem : undefined} aria-current={isSelected ? 'true' : undefined} onClick={() => navigate({ page: data.page, cluster: keyOf(item) })}>
            <strong>{first + index}번째 그룹</strong>
            <small className={styles.cellSub}>구성원 {item.storedMemberCount}건, 조사 우선순위 {formatRiskScore(item.riskScore)}</small>
            <small className={styles.cellSub}>{formatAlgorithm(item)}</small>
          </button>
        </li>
      })}</ul>
      <nav className={styles.posterPager} aria-label="군집 목록 페이지">
        <Button variant="secondary" size="small" disabled={data.page === 0} onClick={() => navigate({ page: data.page - 1 })}>이전</Button>
        <Button variant="secondary" size="small" disabled={!data.hasNext} onClick={() => navigate({ page: data.page + 1 })}>다음</Button>
      </nav>
      <Link className={styles.backLink} to={track1ListRoute(event.id)}>← 예매 그룹 목록</Link>
    </Card>
    {selected
      ? <SelectedCluster key={JSON.stringify(selected)} clusterKey={selected} summary={data.items.find((item) => item.analysisRequestId === selected.analysisRequestId && item.clusterId === selected.clusterId) ?? null} />
      : <EmptyState title="이 페이지에 표시할 군집이 없습니다" description="요청한 페이지가 전체 결과 범위를 벗어났습니다." />}
  </div>
}

function SelectedCluster({ clusterKey, summary }: { clusterKey: Track1ClusterKey; summary: Track1ClusterSummary | null }) {
  const graphQuery = useAdminQuery(track1ClusterGraphPath(clusterKey), track1ClusterGraphSchema)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const graphResult = graphQuery.result
  const graphMatches = graphResult?.kind === 'success' && graphResult.data.analysisRequestId === clusterKey.analysisRequestId && graphResult.data.clusterId === clusterKey.clusterId
  const graphData = graphMatches ? graphResult.data : null
  // ClusterGraph는 graph 참조가 바뀔 때 인스턴스를 다시 만들므로 응답이 같으면 같은 모델을 유지한다.
  const model = useMemo(() => graphData ? toGraphModel(graphData) : null, [graphData])

  let center
  if (graphResult === null) center = <LoadingSkeleton label="관계 그래프를 불러오는 중" />
  else if (model === null) {
    const message = describeAdminApiFailure(graphResult.kind === 'success' ? invalidResponse(graphResult.status) : graphResult, '그래프를 찾을 수 없거나 접근 범위 밖입니다')
    center = <ErrorState title={message.title} description={message.description} onRetry={graphQuery.retry} />
  } else if (model.nodes.length === 0) {
    center = <EmptyState title="저장된 관계가 없습니다" description="서버가 이 군집의 그래프를 정상 응답했지만 노드가 없습니다. 조회 장애가 아니며, 관계가 없다는 판정도 아닙니다." />
  } else {
    center = <>
      <ClusterGraph graph={model} selectedId={selectedId} onSelect={setSelectedId} />
      <ul className={styles.nodeChips} aria-label="그래프 노드 목록">{model.nodes.map((node) => <li key={node.id}>
        <button type="button" className={node.id === selectedId ? styles.selectedItem : undefined} aria-pressed={node.id === selectedId} onClick={() => setSelectedId(node.id)}>{node.label}</button>
      </li>)}</ul>
    </>
  }

  return <>
    <Card className={`${styles.panel} ${styles.graphPanel}`} aria-label="관계 그래프">
      <div className={styles.sectionHeading}><h2>관계 그래프</h2>
        <ul className={styles.graphLegend} aria-label="범례"><li>원: 계정</li><li>사각형: 예매</li><li>마름모: 공유 신호</li><li>점선: 공유 신호 간선</li></ul>
      </div>
      {center}
    </Card>
    <div className={styles.detailColumn}>
      <Card className={styles.panel} aria-label="선택한 요소"><h2>선택한 요소</h2><SelectionEvidence model={model} selectedId={selectedId} /></Card>
      <Card className={styles.panel} aria-label="공유 근거 요약"><h2>저장된 공유 근거</h2><GraphEvidenceSummary model={model} /></Card>
      <AnalysisFacts graph={graphData} summary={summary} clusterKey={clusterKey} />
      <Card className={styles.panel} aria-label="주의사항"><h2>주의사항</h2>
        {graphData?.warnings.map((warning, index) => <p key={index} className={styles.warning} role="note">{warning}</p>)}
        <p>그룹 소속이나 조사 우선순위만으로 동일인 또는 부정거래를 판단하지 마세요.</p>
        <p className={styles.muted}>이 그래프가 군집의 모든 관계를 포함하는지는 응답으로 확인되지 않습니다. 서버가 보낸 노드와 간선만 표시합니다.</p>
      </Card>
    </div>
  </>
}

function SelectionEvidence({ model, selectedId }: { model: GraphModel | null; selectedId: string | null }) {
  if (model === null || selectedId === null) return <p className={styles.muted}>그래프나 노드 목록에서 항목을 선택하면 서버 응답에 있는 연결을 표시합니다.</p>
  const labelOf = (id: string) => model.nodes.find((node) => node.id === id)?.label ?? '알 수 없는 노드'
  const edge = model.edges.find((item) => item.id === selectedId)
  if (edge) return <>
    <p><strong>{edge.label}</strong></p>
    <p>{edge.evidence}</p>
    {edge.caution && <p className={styles.warning}>{edge.caution}</p>}
  </>
  const node = model.nodes.find((item) => item.id === selectedId)
  if (!node) return <p className={styles.muted}>선택한 항목을 현재 그래프에서 찾을 수 없습니다.</p>
  const connected = model.edges.filter((item) => item.source === node.id || item.target === node.id)
  return <>
    <p><strong>{node.label}</strong></p>
    <p>{node.detail}</p>
    {connected.length === 0
      ? <p className={styles.muted}>서버 응답에 이 노드의 간선이 없습니다.</p>
      : <ul className={styles.signalList}>{connected.map((item) => <li key={item.id}>
        <strong>{labelOf(item.source === node.id ? item.target : item.source)}</strong>
        <span>{item.label}</span>
      </li>)}</ul>}
    {connected.some((item) => item.caution) && <p className={styles.warning}>{connected.find((item) => item.caution)?.caution}</p>}
  </>
}

/** 그래프 응답의 신호 노드와 간선만 집계한다. 원본 GDS 신호 전체로 설명하지 않는다. */
function GraphEvidenceSummary({ model }: { model: GraphModel | null }) {
  if (model === null) return <p className={styles.muted}>그래프 응답을 확인하기 전에는 표시하지 않습니다.</p>
  const signals = model.nodes.filter((node) => node.kind === 'signal')
  return <>
    {signals.length === 0
      ? <p className={styles.muted}>이 그래프 응답에는 공유 신호 노드가 없습니다.</p>
      : <ul className={styles.signalList}>{signals.map((signal) => <li key={signal.id}>
        <strong>{signal.label}</strong>
        <span>연결된 노드 {model.edges.filter((edge) => edge.source === signal.id || edge.target === signal.id).length}개</span>
      </li>)}</ul>}
    <p className={styles.muted}>그래프 API가 제공한 노드와 간선만 집계했으며 원본 GDS 신호 전체가 아닙니다.</p>
  </>
}

function AnalysisFacts({ graph, summary, clusterKey }: { graph: Track1ClusterGraph | null; summary: Track1ClusterSummary | null; clusterKey: Track1ClusterKey }) {
  return <Card className={styles.panel} aria-label="분석 정보"><h2>분석 정보</h2>
    <dl className={styles.factList}>
      <div><dt>분석 방법</dt><dd>{summary ? formatAlgorithm(summary) : '확인되지 않음'}</dd></div>
      <div><dt>그래프 알고리즘 버전</dt><dd>{graph ? graph.algorithmVersion ?? '기록 없음' : '확인되지 않음'}</dd></div>
      <div><dt>분석 시각</dt><dd>{summary ? formatAnalyzedAt(summary.analyzedAt) : '확인되지 않음'}</dd></div>
      <div><dt>조사 우선순위 (0~1)</dt><dd>{summary ? formatRiskScore(summary.riskScore) : '확인되지 않음'}<small className={styles.cellSub}>먼저 살펴볼 순서이며 부정거래 확률이 아닙니다.</small></dd></div>
      <div><dt>저장된 구성원</dt><dd>{summary ? `${summary.storedMemberCount}건` : '확인되지 않음'}</dd></div>
      <div><dt>근거 범위</dt><dd>{graph ? '저장 근거로 재구성한 그래프 (원본 GDS 투영 아님)' : '확인되지 않음'}</dd></div>
      <div><dt>원장 좌석</dt><dd>이 화면의 API 응답에 없어 표시하지 않습니다.</dd></div>
    </dl>
    <Link className={styles.detailLink} to={track1DetailRoute(clusterKey)}>그룹 상세 보기</Link>
  </Card>
}
