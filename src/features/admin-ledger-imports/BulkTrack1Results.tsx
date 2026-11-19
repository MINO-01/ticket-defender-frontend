import { useState } from 'react'
import type { z } from 'zod'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import type { AdminApiResult } from '../../api/adminApiClient'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { formatUtc } from '../admin-track2/track2Api'
import styles from '../admin-track1/Track1.module.css'
import {
  bulkAnalysisJobsPath, bulkClusterMembersPath, bulkClusterMembersPageSchema, bulkClusterPageSchema, bulkClustersPath, bulkEvaluationPageSchema,
  bulkEvaluationsPath, bulkFindingPageSchema, bulkFindingsPath, bulkJobListSchema, bulkSharedSignalPageSchema, bulkSharedSignalsPath,
  isBulkPageForJob, pageFor,
} from './bulkTrack1Api'
import type { BulkCluster, BulkEvaluation, BulkFinding, BulkJob, BulkSharedSignal } from './bulkTrack1Api'

type AdminQuery<T> = { result: AdminApiResult<T> | null; retry: () => void }

// BL-07 결과는 기존 analysis-runs(BL-06)와 결합하지 않는다. 이 컴포넌트는 실제 관리자 세션에서만 렌더링된다.
export function BulkTrack1Results({ eventId, performanceId }: { eventId: string; performanceId: string }) {
  const [refresh, setRefresh] = useState(0)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const jobs = useAdminQuery(bulkAnalysisJobsPath(eventId, performanceId), bulkJobListSchema, refresh)
  const selected = jobs.result?.kind === 'success' ? jobs.result.data.find((job) => job.jobId === selectedJobId) ?? null : null

  return <Card className={styles.panel} aria-label="대용량 Track 1 분석 결과">
    <div className={styles.sectionHeading}><h2>대용량 Track 1 분석 결과 (BL-07)</h2><Button size="small" variant="secondary" onClick={() => setRefresh((value) => value + 1)}>Job 목록 새로 고침</Button></div>
    <p className={styles.muted}>기존 Track 1 분석 작업(BL-06)과 다른 대용량 결과입니다. 조사 우선순위, 공유 신호, 한도 초과 후보는 부정 구매 확정이나 자동 제재 근거가 아닙니다.</p>
    {jobs.result === null ? <LoadingSkeleton label="대용량 분석 Job 목록을 불러오는 중" />
      : jobs.result.kind !== 'success' ? (() => { const message = describeAdminApiFailure(jobs.result, '대용량 분석 Job을 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={jobs.retry} /> })()
        : jobs.result.data.length === 0 ? <EmptyState title="대용량 분석 Job이 없습니다" description="분석 결과 0건을 뜻하지 않습니다. 공개 원장과 분석 작업 상태를 확인해 주세요." />
          : <>
            <DataTable caption="대용량 Track 1 분석 Job 목록" rows={jobs.result.data} getRowKey={(job) => job.jobId} columns={[
              { key: 'job', header: 'Job', render: (job: BulkJob) => <span>{job.jobId}<small className={styles.cellSub}>원장 version {job.ledgerVersionId}</small></span> },
              { key: 'status', header: '상태', render: (job: BulkJob) => <span>{job.status}<small className={styles.cellSub}>Data {job.dataStatus ?? '아직 없음'}</small></span> },
              { key: 'policy', header: '정책·수량 확인', render: (job: BulkJob) => `${job.policyVerificationStatus ?? '아직 없음'} / ${job.quantityDataStatus ?? '아직 없음'}` },
              { key: 'aux', header: '보조 수집', render: (job: BulkJob) => `신호 ${job.sharedSignalObservationsStatus ?? '수집 중'} / 한도 ${job.purchaseLimitEvaluationsStatus ?? '수집 중'}` },
              { key: 'open', header: '상세', render: (job: BulkJob) => <Button size="small" variant="secondary" onClick={() => setSelectedJobId(job.jobId)}>{selectedJobId === job.jobId ? '열림' : '상세 열기'}</Button> },
            ]} />
            {selected !== null && <BulkJobDetail key={selected.jobId} eventId={eventId} performanceId={performanceId} job={selected} onRefresh={() => setRefresh((value) => value + 1)} />}
          </>}
  </Card>
}

function JobStateNotice({ job }: { job: BulkJob }) {
  if (job.status === 'BLOCKED') return <p className={styles.warning} role="note">차단됨 (BLOCKED){job.failureCode ? `: ${job.failureCode}` : ''}. 빈 결과를 정상 0건으로 해석하지 않습니다.</p>
  if (job.status === 'FAILED') return <p className={styles.warning} role="note">실패함 (FAILED){job.failureCode ? `: ${job.failureCode}` : ''}. 빈 결과를 정상 0건으로 해석하지 않습니다.</p>
  if (job.status === 'RETRYABLE') return <p className={styles.warning} role="note">재시도 가능 상태입니다{job.failureCode ? `: ${job.failureCode}` : ''}. 결과 수집이 완료되지 않았습니다.</p>
  if (job.status !== 'COMPLETED') return <p className={styles.warning} role="note">현재 {job.status} 상태입니다. 수집 중 빈 목록은 정상 분석 0건이 아닙니다.</p>
  return null
}

function BulkJobDetail({ eventId, performanceId, job, onRefresh }: { eventId: string; performanceId: string; job: BulkJob; onRefresh: () => void }) {
  return <section className={styles.detailColumn} aria-label="선택한 대용량 분석 Job 상세">
    <h3>선택한 BL-07 Job</h3>
    <dl className={styles.factList}>
      <div><dt>Job / Data Job</dt><dd>{job.jobId} / {job.dataJobId ?? '아직 없음'}</dd></div>
      <div><dt>상태 / 실패 코드</dt><dd>{job.status} / {job.failureCode ?? '없음'}</dd></div>
      <div><dt>알고리즘 / 완료 시각</dt><dd>{job.algorithmVersion ?? '아직 없음'} / {job.completedAt ? formatUtc(job.completedAt) : '미완료'}</dd></div>
      <div><dt>정책 확인 / 수량 상태</dt><dd>{job.policyVerificationStatus ?? '아직 없음'} / {job.quantityDataStatus ?? '아직 없음'}</dd></div>
      <div><dt>차단 또는 불완전 사유</dt><dd>{job.dataCompletenessReason ?? '없음'}</dd></div>
    </dl>
    <JobStateNotice job={job} />
    <Button size="small" variant="secondary" onClick={onRefresh}>선택 Job 상태 새로 고침</Button>
    <Clusters eventId={eventId} performanceId={performanceId} job={job} />
    <SharedSignals eventId={eventId} performanceId={performanceId} job={job} />
    <PurchaseLimits eventId={eventId} performanceId={performanceId} job={job} />
  </section>
}

function InvalidScopedResponse({ retry }: { retry: () => void }) { return <ErrorState title="서버 응답의 Job 범위가 현재 선택과 다릅니다" description="다른 공연, 회차 또는 Job의 결과를 표시하지 않았습니다." onRetry={retry} /> }

function Clusters({ eventId, performanceId, job }: { eventId: string; performanceId: string; job: BulkJob }) {
  const [page, setPage] = useState(0); const [clusterId, setClusterId] = useState<string | null>(null)
  const query = useAdminQuery(bulkClustersPath(eventId, performanceId, job.jobId, page), bulkClusterPageSchema)
  if (query.result === null) return <LoadingSkeleton label="Louvain 군집을 불러오는 중" />
  if (query.result.kind !== 'success') { const message = describeAdminApiFailure(query.result, '군집 결과를 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={query.retry} /> }
  if (!isBulkPageForJob(query.result.data, job) || query.result.data.page !== page) return <InvalidScopedResponse retry={query.retry} />
  const data = query.result.data; const selected = data.items.find((item) => item.clusterId === clusterId) ?? null
  return <section aria-label="Louvain 군집 결과"><h3>Louvain 군집</h3>{data.items.length === 0 && job.status !== 'COMPLETED' ? <p className={styles.warning}>군집 수집이 완료되지 않았으므로 정상 0건으로 표시하지 않습니다.</p> : <DataTable caption="Louvain 군집 목록" rows={data.items} getRowKey={(item) => item.clusterId} emptyMessage="완료된 Job에 저장된 군집이 없습니다." columns={[
    { key: 'cluster', header: '군집', render: (item: BulkCluster) => item.clusterId },
    { key: 'risk', header: 'Risk Score (0~1)', render: (item: BulkCluster) => item.riskScore.toFixed(2) },
    { key: 'members', header: '구성원', render: (item: BulkCluster) => `${item.memberCount}건` },
    { key: 'signals', header: '공유 신호', render: (item: BulkCluster) => `결제 ${item.paymentSharedSignalCount} / 주소 ${item.addressSharedSignalCount} / 기기 ${item.deviceSharedSignalCount} / IP ${item.ipSharedSignalCount}` },
    { key: 'detail', header: '구성원', render: (item: BulkCluster) => <Button size="small" variant="secondary" onClick={() => setClusterId(item.clusterId)}>조회</Button> },
  ]} />}
    <Pager page={page} hasNext={data.hasNext} onPage={setPage} label="군집 목록" />
    {selected !== null && <ClusterMembers eventId={eventId} performanceId={performanceId} jobId={job.jobId} cluster={selected} />}
  </section>
}

function ClusterMembers({ eventId, performanceId, jobId, cluster }: { eventId: string; performanceId: string; jobId: string; cluster: BulkCluster }) {
  const [page, setPage] = useState(0); const path = bulkClusterMembersPath(eventId, performanceId, jobId, cluster.clusterId, page)
  const query = useAdminQuery(path, bulkClusterMembersPageSchema)
  if (path === null) return <ErrorState title="안전하지 않은 군집 식별자입니다" description="경로 인코딩으로 우회하지 않고 구성원 상세 조회를 차단했습니다." />
  if (query.result === null) return <LoadingSkeleton label="군집 구성원을 불러오는 중" />
  if (query.result.kind !== 'success') { const message = describeAdminApiFailure(query.result, '군집 구성원을 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={query.retry} /> }
  const data = query.result.data
  if (data.clusterId !== cluster.clusterId || data.page !== page) return <InvalidScopedResponse retry={query.retry} />
  return <section aria-label="선택한 군집 구성원"><h3>군집 구성원 (opaque ID)</h3><DataTable caption="군집 구성원" rows={data.items} getRowKey={(item) => item.memberId} emptyMessage="이 페이지에 구성원이 없습니다." columns={[{ key: 'member', header: 'job 범위 opaque memberId', render: (item: { memberId: string }) => item.memberId }]} /><Pager page={page} hasNext={data.hasNext} onPage={setPage} label="구성원 목록" /></section>
}

function SharedSignals({ eventId, performanceId, job }: { eventId: string; performanceId: string; job: BulkJob }) {
  const [page, setPage] = useState(0); const query = useAdminQuery(bulkSharedSignalsPath(eventId, performanceId, job.jobId, page), bulkSharedSignalPageSchema)
  if (query.result === null) return <LoadingSkeleton label="공유 신호 관찰을 불러오는 중" />
  if (query.result.kind !== 'success') { const message = describeAdminApiFailure(query.result, '공유 신호 관찰을 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={query.retry} /> }
  if (!isBulkPageForJob(query.result.data, job) || query.result.data.page !== page) return <InvalidScopedResponse retry={query.retry} />
  const data = query.result.data
  return <section aria-label="공유 신호 관찰"><h3>공유 신호 관찰</h3><p className={styles.muted}>공유 IP 또는 주소는 일반적인 공동 네트워크·공유 주소일 수 있는 조사 신호이며, 부정 구매의 확정 근거가 아닙니다.</p>{job.sharedSignalObservationsStatus !== 'COMPLETED' && <p className={styles.warning}>관찰 수집이 완료되지 않았습니다. 빈 목록은 정상 0건이 아닙니다.</p>}
    <DataTable caption="공유 신호 관찰 목록" rows={data.items} getRowKey={(item) => item.observationId} emptyMessage={job.sharedSignalObservationsStatus === 'COMPLETED' ? '완료된 수집에 저장된 관찰이 없습니다.' : '수집 중인 결과입니다.'} columns={[
      { key: 'type', header: '종류', render: (item: BulkSharedSignal) => item.signalType },
      { key: 'counts', header: '관찰 범위', render: (item: BulkSharedSignal) => `계정 ${item.distinctAccountCount}/${item.scopeAccountCount}, 예매 ${item.distinctReservationCount}` },
      { key: 'quantity', header: '티켓 수량', render: (item: BulkSharedSignal) => item.ticketQuantityStatus === 'VERIFIED' ? `${item.totalTicketQuantity} 확인됨` : '확인 불가 (UNAVAILABLE)' },
      { key: 'cross', header: '교차 근거', render: (item: BulkSharedSignal) => `결제 ${item.paymentSharedAccountCount}, 기기 ${item.deviceSharedAccountCount}` },
      { key: 'network', header: '네트워크·허브', render: (item: BulkSharedSignal) => `${item.ipNetworkType} / ${item.excludedFromLouvain ? 'Louvain 제외 허브' : '포함'}` },
    ]} /><Pager page={page} hasNext={data.hasNext} onPage={setPage} label="공유 신호 목록" />
  </section>
}

function PurchaseLimits({ eventId, performanceId, job }: { eventId: string; performanceId: string; job: BulkJob }) {
  const [evaluationPage, setEvaluationPage] = useState(0); const [findingPage, setFindingPage] = useState(0)
  const evaluations = useAdminQuery(bulkEvaluationsPath(eventId, performanceId, job.jobId, evaluationPage), bulkEvaluationPageSchema)
  const findings = useAdminQuery(bulkFindingsPath(eventId, performanceId, job.jobId, findingPage), bulkFindingPageSchema)
  return <section aria-label="구매 한도 결과"><h3>구매 한도 평가와 초과 후보</h3>
    <EvaluationTable job={job} performanceId={performanceId} page={evaluationPage} setPage={setEvaluationPage} query={evaluations} />
    <FindingTable job={job} page={findingPage} setPage={setFindingPage} query={findings} evaluation={evaluations.result?.kind === 'success' && isBulkPageForJob(evaluations.result.data, job) ? evaluations.result.data.items.find((item) => item.performanceId === performanceId) ?? null : null} />
  </section>
}

function EvaluationTable({ job, performanceId, page, setPage, query }: { job: BulkJob; performanceId: string; page: number; setPage: (value: number) => void; query: AdminQuery<z.infer<typeof bulkEvaluationPageSchema>> }) {
  if (query.result === null) return <LoadingSkeleton label="구매 한도 평가를 불러오는 중" />
  if (query.result.kind !== 'success') { const message = describeAdminApiFailure(query.result, '구매 한도 평가를 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={query.retry} /> }
  if (!isBulkPageForJob(query.result.data, job) || query.result.data.page !== page || query.result.data.items.some((item) => item.performanceId !== performanceId)) return <InvalidScopedResponse retry={query.retry} />
  const data = query.result.data
  return <section aria-label="구매 한도 평가"><h3>구매 한도 평가</h3>{job.purchaseLimitEvaluationsStatus !== 'COMPLETED' && <p className={styles.warning}>평가 수집이 완료되지 않았습니다. 빈 목록은 정상 0건이 아닙니다.</p>}<DataTable caption="구매 한도 평가 목록" rows={data.items} getRowKey={(item) => item.performanceId} emptyMessage={job.purchaseLimitEvaluationsStatus === 'COMPLETED' ? '완료된 수집에 평가가 없습니다.' : '수집 중인 결과입니다.'} columns={[
    { key: 'state', header: '평가 상태', render: (item: BulkEvaluation) => evaluationHelp(item.status) },
    { key: 'policy', header: '정책 버전', render: (item: BulkEvaluation) => item.policyVersion ?? '확인되지 않음' },
    { key: 'findings', header: '후보 수집', render: (item: BulkEvaluation) => `${item.findingsCollectionStatus} / ${item.status === 'EVALUATED' ? `${item.accountLimitFindingCount}건` : '평가 불가'}` },
  ]} /><Pager page={page} hasNext={data.hasNext} onPage={setPage} label="구매 한도 평가 목록" /></section>
}

function FindingTable({ job, page, setPage, query, evaluation }: { job: BulkJob; page: number; setPage: (value: number) => void; query: AdminQuery<z.infer<typeof bulkFindingPageSchema>>; evaluation: BulkEvaluation | null }) {
  if (query.result === null) return <LoadingSkeleton label="한도 초과 후보를 불러오는 중" />
  if (query.result.kind !== 'success') { const message = describeAdminApiFailure(query.result, '한도 초과 후보를 찾을 수 없거나 접근 범위 밖입니다'); return <ErrorState title={message.title} description={message.description} onRetry={query.retry} /> }
  if (!isBulkPageForJob(query.result.data, job) || query.result.data.page !== page) return <InvalidScopedResponse retry={query.retry} />
  const data = query.result.data; const final = evaluation?.status === 'EVALUATED' && evaluation.findingsCollectionStatus === 'COMPLETED'
  return <section aria-label="구매 한도 초과 후보"><h3>구매 한도 초과 후보</h3>{!final && <p className={styles.warning}>{evaluation === null ? '평가가 아직 없거나 수집 중입니다.' : evaluation.status !== 'EVALUATED' ? `${evaluationHelp(evaluation.status)}: 정상 0건이 아닙니다.` : `finding 수집 상태가 ${evaluation.findingsCollectionStatus}입니다. 최종 목록으로 취급하지 않습니다.`}</p>}<p className={styles.muted}>후보는 조사 대상일 뿐 자동 확정, Case 생성, 취소 또는 제재 근거가 아닙니다. 표시되는 ID는 원본 HMAC이 아닌 job 범위 opaque 식별자입니다.</p>
    <DataTable caption="구매 한도 초과 후보 목록" rows={data.items} getRowKey={(item) => item.accountId} emptyMessage={final ? '정상 평가가 완료되었고 한도 초과 후보는 0건입니다.' : '정상 0건으로 해석하지 않는 결과입니다.'} columns={[
      { key: 'account', header: 'opaque 계정 ID', render: (item: BulkFinding) => item.accountId },
      { key: 'quantity', header: '확인 수량 / 한도', render: (item: BulkFinding) => `${item.effectiveTicketQuantity} / ${item.maxTicketsPerAccount}` },
      { key: 'policy', header: '정책 버전', render: (item: BulkFinding) => item.policyVersion },
      { key: 'reservations', header: '예매별 수량 근거', render: (item: BulkFinding) => item.reservationQuantities.map((reservation) => `${reservation.reservationId}: ${reservation.effectiveTicketQuantity}`).join(', ') || '없음' },
    ]} /><Pager page={page} hasNext={data.hasNext} onPage={setPage} label="한도 초과 후보 목록" />
  </section>
}

function Pager({ page, hasNext, onPage, label }: { page: number; hasNext: boolean; onPage: (page: number) => void; label: string }) { return <nav className={styles.pagination} aria-label={`${label} 페이지`}><Button variant="secondary" size="small" disabled={page === 0} onClick={() => onPage(pageFor(page, hasNext, 'previous'))}>이전</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!hasNext} onClick={() => onPage(pageFor(page, hasNext, 'next'))}>다음</Button></nav> }

function evaluationHelp(status: BulkEvaluation['status']) { return ({ EVALUATED: '평가 완료 (EVALUATED)', POLICY_NOT_CONFIRMED: '정책 미확정 (POLICY_NOT_CONFIRMED)', QUANTITY_DATA_INCOMPLETE: '수량 자료 불완전 (QUANTITY_DATA_INCOMPLETE)', POLICY_TIME_NOT_APPLICABLE: '정책 적용 시간 불일치 (POLICY_TIME_NOT_APPLICABLE)' })[status] }
