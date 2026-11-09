import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { TechnicalDetails, WorkGuide } from '../../components/common/WorkGuide'
import type { GuideItem } from '../../components/common/WorkGuide'
import { terms } from '../../app/terms'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { CreateCasePanel } from '../admin-cases/CreateCasePanel'
import { isCanonicalAnalysisRequestId } from '../admin-cases/caseWorkflowApi'
import { useAccessibleEvents } from '../admin-events/useAccessibleEvents'
import {
  formatAlgorithm, formatAnalyzedAt, formatRiskScore, readTrack1ClusterKey, sharedSignalTypes, track1ClusterDetailPath, track1ClusterDetailSchema, track1ListRoute,
} from './track1Api'
import type { SharedSignalType, Track1ClusterDetail, Track1ClusterKey, Track1Relationship } from './track1Api'
import { ClusterGraph } from './ClusterGraph'
import { LedgerSeatLookupPanel } from './LedgerSeatLookupPanel'
import type { GraphModel } from './track1Model'
import styles from './Track1.module.css'

// 인증된 관리자의 Track 1 군집 상세다. eventId, analysisRequestId, clusterId를 주소에서 읽어 함께 조회하므로 직접 주소로 접근해도 같은 군집을 연다.
// 공연은 접근 가능 공연 목록에서 확인된 뒤에만 상세를 조회한다.
// 공유 근거는 서버의 relationship 요약 수치만 표시한다. 신호 값과 구성원 사이의 간선은 응답에 없으므로 그래프를 만들지 않는다.
// Case 생성은 서버가 확인한 이 군집의 공연, 분석 요청 ID, 군집 ID만 출처로 보내며 관리자가 사유를 입력해 명시적으로 요청할 때만 실행한다.

type Member = Track1ClusterDetail['members'][number]

export function InvalidClusterAddress() {
  return <div className={styles.page}>
    <ErrorState title="군집 주소가 올바르지 않습니다" description="공연, 분석 요청, 군집 식별자가 모두 필요합니다. 군집 목록에서 다시 선택해 주세요." />
    <Link className={styles.detailLink} to="/app/analysis/findings">군집 목록으로 돌아가기</Link>
  </div>
}

export function LiveClusterDetailPage() {
  const [searchParams] = useSearchParams()
  const key = readTrack1ClusterKey(searchParams)
  if (!key) return <InvalidClusterAddress />
  return <VerifiedClusterDetail key={JSON.stringify(key)} clusterKey={key} />
}

// 상세 직접 주소도 목록과 같이 접근 가능 공연 목록에서 공연을 먼저 확인한다.
// Backend Track 1 API는 다중 고객사 계정을 409로 막지 않으므로, 공연 목록의 409 차단(DEC-02)을 상세에서도 유지하기 위해서다.
function VerifiedClusterDetail({ clusterKey }: { clusterKey: Track1ClusterKey }) {
  const { state, retry } = useAccessibleEvents(clusterKey.eventId)
  const backLink = <Link className={styles.backLink} to={track1ListRoute(clusterKey.eventId)}>← 예매 그룹 목록</Link>
  if (state.status === 'loading') return <div className={styles.page}>{backLink}<LoadingSkeleton label="공연 접근 권한을 확인하는 중" /></div>
  if (state.status === 'failed') {
    const message = describeAdminApiFailure(state.failure, '공연 목록을 찾을 수 없습니다')
    return <div className={styles.page}>{backLink}<ErrorState title={message.title} description={message.description} onRetry={retry} /></div>
  }
  if (!state.events.some((event) => event.id === clusterKey.eventId)) {
    return <div className={styles.page}>{backLink}<ErrorState title="선택한 공연에 접근할 수 없습니다" description="접근 가능한 공연 목록에서 확인되지 않은 공연입니다. 군집 목록에서 공연을 다시 선택해 주세요." /></div>
  }
  return <ClusterDetail clusterKey={clusterKey} />
}

function ClusterDetail({ clusterKey }: { clusterKey: Track1ClusterKey }) {
  const { result, retry } = useAdminQuery(track1ClusterDetailPath(clusterKey), track1ClusterDetailSchema)
  const backLink = <Link className={styles.backLink} to={track1ListRoute(clusterKey.eventId)}>← 예매 그룹 목록</Link>
  if (result === null) return <div className={styles.page}>{backLink}<LoadingSkeleton label="군집 상세를 불러오는 중" /></div>

  // 요청한 세 식별자와 다른 군집이 돌아오면 다른 범위의 증거가 섞일 수 있으므로 표시하지 않는다.
  const mismatched = result.kind === 'success' && (result.data.event.id !== clusterKey.eventId
    || result.data.cluster.analysisRequestId !== clusterKey.analysisRequestId || result.data.cluster.clusterId !== clusterKey.clusterId)
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '군집을 찾을 수 없거나 접근 범위 밖입니다')
    return <div className={styles.page}>{backLink}<ErrorState title={message.title} description={message.description} onRetry={retry} /></div>
  }

  const { event, cluster, members } = result.data
  const memberColumns = [
    { key: 'auditId', header: '저장 기록 번호', render: (member: Member) => member.auditId },
  ]
  const confirmed: GuideItem[] = [
    { key: 'event', content: <>대상 공연: {event.name}</> },
    { key: 'members', content: <>이 그룹에 속한 것으로 저장된 예매 기록 {cluster.storedMemberCount}건 (화면 표시 {members.length}건)</> },
    { key: 'priority', content: <>조사 우선순위 {formatRiskScore(cluster.riskScore)} (0~1, 먼저 살펴볼 순서이며 불법 확률이 아님)</> },
    { key: 'analysis', content: <>분석 방법 {formatAlgorithm(cluster)}, 분석 시각 {formatAnalyzedAt(cluster.analyzedAt)}</> },
  ]
  const unconfirmed: GuideItem[] = [
    { key: 'signals', content: result.data.relationship
      ? '공유 근거는 저장된 기기와 IP 신호의 개수 요약만 있으며, 공유한 값 자체와 결제, 주소 근거는 제공되지 않습니다.'
      : '이 서버 응답에는 공유 근거 요약이 없어 표시하지 않습니다.' },
    { key: 'normal', content: '공용 기기나 같은 네트워크를 정상적으로 함께 쓴 경우일 수 있습니다.' },
    { key: 'identity', content: '같은 사람인지, 부정 거래인지는 확인되지 않았습니다.' },
    { key: 'coverage', content: '중복 저장 방지로 일부 예매 기록이 저장되지 않았을 수 있습니다.' },
  ]
  const next: GuideItem[] = [
    { key: 'members', content: <><a href="#cluster-members">저장된 예매 기록</a>을 확인합니다.</> },
    { key: 'case', content: <>조사가 필요하면 <a href="#cluster-case">{terms.case} 생성</a>에서 사유를 적고 사건을 만듭니다.</> },
    { key: 'list', content: <><Link to={track1ListRoute(event.id)}>다른 그룹</Link>과 우선순위를 비교합니다.</> },
  ]
  return <div className={styles.page}>
    {backLink}
    <PageHeader eyebrow="예매 관계 분석" title={`연결된 예매 그룹 ${cluster.clusterId}`} description="저장된 예매 기록과 분석 정보를 확인합니다. 그룹 관계는 추가 조사 대상이며 동일인 또는 위법성의 확정 근거가 아닙니다." />
    <WorkGuide confirmed={confirmed} unconfirmed={unconfirmed} next={next} />
    <TechnicalDetails summary="기술 상세 (분석 요청 ID, 그룹 참조, 근거 범위)">
      <div>분석 요청 ID <span>{cluster.analysisRequestId}</span></div>
      <div>분석 내 그룹 참조 <span>{cluster.clusterId}</span> (분석 요청 안에서만 유효하며 조사 사건 식별자가 아님)</div>
      <div>근거 범위 STORED_EVIDENCE_ONLY</div>
    </TechnicalDetails>
    <div className={styles.detailGrid}>
      <div className={styles.detailColumn}>
        <Card className={styles.panel}><h2>그룹 개요</h2><dl className={styles.factList}>
          <div><dt>대상 공연</dt><dd>{event.name}</dd></div>
          <div><dt>조사 우선순위 (0~1)</dt><dd>{formatRiskScore(cluster.riskScore)}</dd></div>
          <div><dt>저장된 예매 기록</dt><dd>{cluster.storedMemberCount}건</dd></div>
          <div><dt>근거 범위</dt><dd>저장된 근거만</dd></div>
        </dl></Card>
        <Card className={styles.panel}><h2>분석 정보</h2><dl className={styles.factList}>
          <div><dt>분석 시각</dt><dd>{formatAnalyzedAt(cluster.analyzedAt)}</dd></div>
          <div><dt>방법과 버전</dt><dd>{formatAlgorithm(cluster)}</dd></div>
        </dl><p className={styles.muted}>그룹 참조는 분석 요청 안에서만 유효하며 영속적인 조사 사건 식별자가 아닙니다.</p></Card>
      </div>
      <div className={styles.detailColumn}>
        <Card className={`${styles.panel} ${styles.graphPanel}`}>
          <div className={styles.sectionHeading}><div><h2>공유 근거</h2><p>서버가 저장된 기기와 IP 신호로 계산한 요약만 표시합니다. 연결 그래프는 그리지 않습니다.</p></div></div>
          <RelationshipEvidence relationship={result.data.relationship} />
          {result.data.graph && result.data.graph.nodes.length > 0
            ? <><StoredGraph graph={result.data.graph} /><p className={styles.muted}>저장된 기기와 IP 공유 근거만 그립니다. 결제와 주소 연결은 저장 근거가 없어 표시되지 않습니다.</p></>
            : <p className={styles.muted}>서버에 저장된 연결 관계가 없어 그래프를 표시하지 않습니다. 요약 수치로 간선을 추정하지 않습니다.</p>}
        </Card>
        <Card id="cluster-members" className={styles.tableCard}>
          <div className={styles.sectionHeading}><h2>저장된 예매 기록</h2><span>{members.length}건</span></div>
          {members.length === 0
            ? <EmptyState title="저장된 예매 기록이 없습니다" description="이 그룹에 저장된 예매 기록이 없습니다." />
            : <DataTable caption="저장된 그룹 구성원" columns={memberColumns} rows={members} getRowKey={(member) => member.auditId} />}
          <p className={styles.muted}>저장 기록 번호는 내부 참조이며 계정, 예매번호, 신원 정보가 아닙니다. 서버는 계정과 예매 참조를 응답하지 않습니다.</p>
        </Card>
        <LedgerSeatLookupPanel clusterKey={clusterKey} />
      </div>
      <div id="cluster-case" className={styles.detailColumn}>
        <Card className={styles.panel}><h2>판단 시 주의</h2><p>분석 요청에서 이 그룹에 속한 것으로 저장된 기록 번호만 표시했습니다. 전체 분석 스냅샷이나 확정 판정으로 해석하지 마세요.</p><p className={styles.warning}>그룹 소속이나 조사 우선순위만으로 동일인 또는 부정 거래를 판단하지 마세요.</p></Card>
        <CreateCasePanel context="연결된 예매 그룹" sources={{ eventId: event.id, graphClusters: [{ analysisRequestId: cluster.analysisRequestId, clusterId: cluster.clusterId }], fanReportIds: [], evidenceIds: [] }}
          blockedReason={isCanonicalAnalysisRequestId(cluster.analysisRequestId) ? null : '이 그룹의 분석 요청 ID가 소문자 UUID 형식이 아니어서 서버 계약상 조사 사건 출처로 연결할 수 없습니다. 분석 결과를 다시 반입해야 하며 화면에서 ID를 바꾸지 않습니다.'} />
      </div>
    </div>
  </div>
}

const signalLabels: Record<SharedSignalType, string> = { DEVICE_ID_HASH: '같은 기기 식별 신호', IP_HASH: '같은 네트워크(IP) 신호' }
const unavailableLabels: Record<string, string> = { PAYMENT_HASH: '결제 수단', ADDRESS_HASH: '배송 주소' }

/**
 * 서버가 계산한 공유 근거 요약만 보여 준다. 신호 값, HMAC, 구성원 사이의 간선은 응답에 없으므로 그래프를 그리지 않는다.
 * 전체 verifiedConnectionCount는 신호별 연결 쌍의 합이라 고유한 예매 연결 수로 설명하지 않는다.
 */
/** 서버가 저장 근거로 돌려준 노드와 간선만 그린다. 값을 보강하거나 추정하지 않는다. */
function StoredGraph({ graph }: { graph: NonNullable<Track1ClusterDetail['graph']> }) {
  const [selected, setSelected] = useState<string | null>(null)
  const model = useMemo<GraphModel>(() => ({
    nodes: graph.nodes.map((node) => ({ id: node.id, label: node.label, graphLabel: node.label, kind: node.kind, detail: '서버 저장 근거' })),
    edges: graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, signalKind: edge.signalKind ?? undefined, label: edge.signalKind ?? '예매', evidence: '서버 저장 근거' })),
  }), [graph])
  return <ClusterGraph graph={model} selectedId={selected} onSelect={setSelected} />
}

function RelationshipEvidence({ relationship }: { relationship: Track1Relationship | undefined }) {
  if (relationship === undefined) {
    return <EmptyState title="공유 근거를 표시할 수 없습니다" description="이 서버 응답에는 공유 근거 요약(relationship)이 없습니다. 관계를 임의로 만들지 않기 위해 그래프와 연결을 표시하지 않습니다." />
  }
  // 기기와 IP 근거를 먼저 보여 준다. 서버가 준 유형만 순서를 고정해 표시한다.
  const signals = sharedSignalTypes.flatMap((type) => relationship.sharedSignals.filter((signal) => signal.type === type))
  return <section className={styles.relationship} aria-label="공유 근거 요약">
    <p className={styles.warning} role="note">{relationship.normalSharingNotice}</p>
    {signals.length === 0
      ? <EmptyState title="저장된 구성원끼리 공유한 기기나 IP 신호가 없습니다" description="서버가 저장된 기기와 IP 신호를 확인한 결과입니다. 조회 장애가 아니며, 관계가 없다는 판정도 아닙니다." />
      : <ul className={styles.signalList}>{signals.map((signal) => <li key={signal.type}>
        <strong>{signalLabels[signal.type]}</strong>
        <span>같은 저장 값을 가진 예매 기록 {signal.sharedMemberCount}건</span>
        <span>이 신호로 이어지는 예매 기록 쌍 {signal.verifiedConnectionCount}개</span>
      </li>)}</ul>}
    <dl className={styles.factList}>
      <div><dt>신호별 연결 쌍 합계</dt><dd>{relationship.verifiedConnectionCount}개 (신호마다 따로 센 합계라 같은 두 예매가 중복될 수 있으며, 고유한 예매 연결 수가 아닙니다)</dd></div>
      <div><dt>제공되지 않는 근거</dt><dd>{relationship.unavailableSignalTypes.length === 0 ? '없음' : relationship.unavailableSignalTypes.map((type) => unavailableLabels[type] ?? type).join(', ')} (이 그룹에 저장된 근거가 아니어서 만들거나 추정하지 않습니다)</dd></div>
      <div><dt>근거 범위</dt><dd>저장된 그룹 구성원만 (원래 전체 그룹을 복원하지 않습니다)</dd></div>
    </dl>
  </section>
}
