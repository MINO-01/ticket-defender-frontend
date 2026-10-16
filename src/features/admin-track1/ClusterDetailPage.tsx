import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { ClusterGraph } from './ClusterGraph'
import { demoTrack1Data, signalLabels } from './demoData'
import type { SignalKind, Track1Dataset } from './demoData'
import { buildGraph, isValidDataset } from './track1Model'
import styles from './Track1.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'
export function ClusterDetailPage({ data = demoTrack1Data, state = 'ready' }: { data?: Track1Dataset; state?: ViewState }) {
  const { clusterId } = useParams()
  if (state === 'loading') return <LoadingSkeleton label="군집 상세를 불러오는 중" />
  if (state === 'failed') return <ErrorState title="군집 상세를 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidDataset(data)) return <ErrorState title="군집 데이터 형식을 확인할 수 없습니다" description="연결 정보의 형식을 확인해 주세요." />
  const cluster = data.clusters.find((item) => item.id === clusterId)
  if (!cluster) return <div className={styles.page}><EmptyState title="군집을 찾을 수 없습니다" description="군집 ID를 확인하거나 목록으로 돌아가세요." /><Link className={styles.detailLink} to="/app/analysis/findings">군집 목록으로 돌아가기</Link></div>
  return <ClusterDetailReady key={cluster.id} data={data} cluster={cluster} />
}

function ClusterDetailReady({ data, cluster }: { data: Track1Dataset; cluster: Track1Dataset['clusters'][number] }) {
  const [signalFilter, setSignalFilter] = useState<SignalKind | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  return <ClusterDetailContent data={data} cluster={cluster} signalFilter={signalFilter} setSignalFilter={setSignalFilter} selectedId={selectedId} setSelectedId={setSelectedId} />
}

function ClusterDetailContent({ data, cluster, signalFilter, setSignalFilter, selectedId, setSelectedId }: {
  data: Track1Dataset
  cluster: Track1Dataset['clusters'][number]
  signalFilter: SignalKind | ''
  setSignalFilter: (value: SignalKind | '') => void
  selectedId: string | null
  setSelectedId: (value: string | null) => void
}) {
  const graph = useMemo(() => buildGraph(cluster, signalFilter), [cluster, signalFilter])
  const selectedNode = graph.nodes.find((node) => node.id === selectedId)
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedId)
  const event = data.events.find((item) => item.id === cluster.eventId)
  const run = data.runs.find((item) => item.id === cluster.analysisRunId)
  return <div className={styles.page}>
    <Link className={styles.backLink} to="/app/analysis/findings">← 군집 목록</Link>
    <PageHeader eyebrow="Track 1 · 합성 데모 데이터" title={`군집 ${cluster.id}`} description="연결 단서와 예매 구성을 확인합니다. 관계는 추가 조사 대상이며 동일인 또는 위법성의 확정 근거가 아닙니다." />
    <div className={styles.detailGrid}>
      <div className={styles.detailColumn}>
        <Card className={styles.panel}><h2>군집 개요</h2><dl className={styles.factList}><div><dt>대상 공연</dt><dd>{event?.name}</dd></div><div><dt>조사 우선순위</dt><dd>{cluster.priority}점</dd></div><div><dt>관련 계정·예매</dt><dd>{cluster.accounts.length}개 · {cluster.reservations.length}건</dd></div><div><dt>연결 정보</dt><dd>{cluster.signals.length}개</dd></div></dl></Card>
        <Card className={styles.panel}><h2>관련 계정·예매</h2>{cluster.accounts.length === 0 ? <p className={styles.muted}>표시할 구성원이 없습니다.</p> : <ul className={styles.memberList}>{cluster.accounts.map((account) => <li key={account.id}><button type="button" className={selectedId === account.id ? styles.selectedItem : ''} onClick={() => setSelectedId(account.id)}>{account.label}</button><small>{cluster.reservations.filter((reservation) => reservation.accountId === account.id).length}건의 합성 예매</small></li>)}</ul>}</Card>
        <Card className={styles.panel}><h2>분석 정보</h2><dl className={styles.factList}><div><dt>분석 작업</dt><dd>{run?.id}</dd></div><div><dt>분석 시각</dt><dd>{run?.analyzedAt.slice(0, 16).replace('T', ' ')}</dd></div><div><dt>방법·버전</dt><dd>{run?.method} · {run?.version}</dd></div></dl><p className={styles.muted}>이 군집 ID는 시연용이며 영속적인 Case 식별자가 아닙니다.</p></Card>
      </div>
      <Card className={`${styles.panel} ${styles.graphPanel}`}>
        <div className={styles.sectionHeading}><div><h2>연결 관계 그래프</h2><p>계정, 예매, 공유 신호를 구분해 표시합니다.</p></div></div>
        <label className={styles.graphFilter}>연결 신호 필터<select value={signalFilter} onChange={(event) => { setSignalFilter(event.target.value as SignalKind | ''); setSelectedId(null) }}><option value="">전체 신호</option>{(Object.keys(signalLabels) as SignalKind[]).map((kind) => <option key={kind} value={kind}>{signalLabels[kind]}</option>)}</select></label>
        {graph.nodes.length === 0 ? <EmptyState title="표시할 연결 관계가 없습니다" description="이 군집에는 그래프로 표시할 구성원이 없습니다." /> : <ClusterGraph graph={graph} selectedId={selectedId} onSelect={setSelectedId} />}
        <div className={styles.legend} aria-label="그래프 범례"><span><i className={styles.accountDot} />계정</span><span><i className={styles.signalDot} />공유 신호</span><span><i className={styles.reservationDot} />예매</span></div>
        <details className={styles.alternative} open><summary>목록으로 연결 근거 보기</summary><ul>{graph.edges.map((edge) => <li key={edge.id}><button type="button" className={selectedId === edge.id ? styles.selectedItem : ''} onClick={() => setSelectedId(edge.id)}><strong>{edge.label}</strong><span>{edge.source} ↔ {edge.target}</span><small>{edge.evidence}</small></button></li>)}</ul></details>
      </Card>
      <div className={styles.detailColumn}>
        <Card className={styles.panel}><h2>선택한 요소</h2>{selectedNode ? <div className={styles.selectedDetail} aria-live="polite"><strong>{selectedNode.label}</strong><p>식별자: {selectedNode.id}</p><p>{selectedNode.detail}</p><p>연결 관계 {graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length}건</p></div> : selectedEdge ? <div className={styles.selectedDetail} aria-live="polite"><strong>{selectedEdge.label}</strong><p>연결: {selectedEdge.source} ↔ {selectedEdge.target}</p><h3>공유된 연결 근거</h3><p>{selectedEdge.evidence}</p>{selectedEdge.caution && <p className={styles.warning}>{selectedEdge.caution}</p>}</div> : <p className={styles.muted}>그래프 또는 아래 근거 목록에서 요소를 선택해 주세요.</p>}</Card>
        <Card className={styles.panel}><h2>확인된 사실과 검토 사항</h2><h3>합성 데이터에 표시된 사실</h3><p>계정별 예매와 명시된 연결 신호만 표시했습니다.</p><h3>추가 검토 사항</h3><p>공유 단서의 생성 경위와 실제 거래 맥락을 별도로 확인해야 합니다.</p><p className={styles.warning}>공용 IP나 약한 신호만으로 동일인 또는 부정 거래를 판단하지 마세요.</p></Card>
        <Card className={styles.panel}><h2>후속 조치</h2><Button disabled>Case 생성</Button><p className={styles.muted}>Case 생성 API와 관리자 인가가 연결되지 않아 사용할 수 없습니다.</p></Card>
      </div>
    </div>
    <p className={styles.notice}>합성 데모 데이터입니다. 실제 분석 조회 API와 관리자 인증·인가는 아직 연결되지 않았습니다.</p>
  </div>
}
