import { Link, useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { useAccessibleEvents } from '../admin-events/useAccessibleEvents'
import {
  formatAlgorithm, formatAnalyzedAt, formatRiskScore, readTrack1ClusterKey, track1ClusterDetailPath, track1ClusterDetailSchema, track1ListRoute,
} from './track1Api'
import type { Track1ClusterDetail, Track1ClusterKey } from './track1Api'
import styles from './Track1.module.css'

// 인증된 관리자의 Track 1 군집 상세다. eventId, analysisRequestId, clusterId를 주소에서 읽어 함께 조회하므로 직접 주소로 접근해도 같은 군집을 연다.
// 공연은 접근 가능 공연 목록에서 확인된 뒤에만 상세를 조회한다.
// 현재 응답은 저장된 구성원 식별자와 분석 메타데이터뿐이므로 공유 신호와 그래프 간선을 만들지 않고 미지원으로 표시한다.

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
  const backLink = <Link className={styles.backLink} to={track1ListRoute(clusterKey.eventId)}>← 군집 목록</Link>
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
  const backLink = <Link className={styles.backLink} to={track1ListRoute(clusterKey.eventId)}>← 군집 목록</Link>
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
    { key: 'auditId', header: '감사 ID', render: (member: Member) => member.auditId },
    { key: 'account', header: '계정 참조', render: (member: Member) => member.accountId ?? '기록 없음' },
    { key: 'reservation', header: '예매 참조', render: (member: Member) => member.reservationNo ?? '기록 없음' },
  ]
  return <div className={styles.page}>
    {backLink}
    <PageHeader eyebrow="Track 1 저장 증거 조회" title={`군집 ${cluster.clusterId}`} description="저장된 구성원과 분석 정보를 확인합니다. 구성원 관계는 추가 조사 대상이며 동일인 또는 위법성의 확정 근거가 아닙니다." />
    <div className={styles.detailGrid}>
      <div className={styles.detailColumn}>
        <Card className={styles.panel}><h2>군집 개요</h2><dl className={styles.factList}>
          <div><dt>대상 공연</dt><dd>{event.name}</dd></div>
          <div><dt>조사 우선순위 (0~1)</dt><dd>{formatRiskScore(cluster.riskScore)}</dd></div>
          <div><dt>저장 구성원</dt><dd>{cluster.storedMemberCount}건</dd></div>
          <div><dt>증거 범위</dt><dd>저장 증거만 (STORED_EVIDENCE_ONLY)</dd></div>
        </dl></Card>
        <Card className={styles.panel}><h2>분석 정보</h2><dl className={styles.factList}>
          <div><dt>분석 요청 ID</dt><dd>{cluster.analysisRequestId}</dd></div>
          <div><dt>분석 시각</dt><dd>{formatAnalyzedAt(cluster.analyzedAt)}</dd></div>
          <div><dt>방법과 버전</dt><dd>{formatAlgorithm(cluster)}</dd></div>
        </dl><p className={styles.muted}>군집 ID는 분석 요청 안에서만 유효하며 영속적인 Case 식별자가 아닙니다.</p></Card>
      </div>
      <div className={styles.detailColumn}>
        <Card className={`${styles.panel} ${styles.graphPanel}`}>
          <div className={styles.sectionHeading}><div><h2>연결 관계 그래프</h2><p>실제 저장 증거로 구성할 수 있는 관계만 표시합니다.</p></div></div>
          <EmptyState title="연결 관계 그래프를 표시할 수 없습니다" description="현재 서버 응답은 저장된 구성원 식별자만 제공하며 공유 신호, 신호별 연결 관계, 그래프 간선, 좌석 정보를 제공하지 않습니다. 관계를 임의로 만들지 않기 위해 그래프를 표시하지 않습니다." />
        </Card>
        <Card className={styles.tableCard}>
          <div className={styles.sectionHeading}><h2>저장된 구성원</h2><span>{members.length}건</span></div>
          {members.length === 0
            ? <EmptyState title="저장된 구성원이 없습니다" description="이 군집에 저장된 구성원 증거가 없습니다." />
            : <DataTable caption="저장된 군집 구성원" columns={memberColumns} rows={members} getRowKey={(member) => member.auditId} />}
        </Card>
      </div>
      <div className={styles.detailColumn}>
        <Card className={styles.panel}><h2>확인된 사실과 검토 사항</h2><h3>저장 증거로 확인되는 사실</h3><p>분석 요청에서 이 군집에 속한 것으로 저장된 계정과 예매 참조만 표시했습니다.</p><h3>추가 검토 사항</h3><p>중복 저장 방지로 일부 구성원이 저장되지 않았을 수 있습니다. 전체 분석 스냅샷이나 확정 판정으로 해석하지 마세요.</p><p className={styles.warning}>군집 소속이나 조사 우선순위만으로 동일인 또는 부정 거래를 판단하지 마세요.</p></Card>
        <Card className={styles.panel}><h2>후속 조치</h2><Button disabled>Case 생성</Button><p className={styles.muted}>Case 생성 화면은 이번 범위에서 연결하지 않았습니다.</p></Card>
      </div>
    </div>
  </div>
}
