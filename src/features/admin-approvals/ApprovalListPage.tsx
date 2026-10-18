import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { casePageSize, caseTypeLabels, isValidCaseDataset } from '../admin-cases/caseModel'
import type { CaseDataset, CaseType } from '../admin-cases/caseModel'
import { demoCaseData } from '../admin-cases/demoData'
import { demoTrack1Data } from '../admin-track1/demoData'
import type { Track1Dataset } from '../admin-track1/demoData'
import { demoTrack2Data } from '../admin-track2/demoData'
import type { Track2Dataset } from '../admin-track2/track2Model'
import { defaultApprovalFilters, selectApprovalCandidates } from './approvalModel'
import type { ApprovalFilters, ApprovalReviewCandidate } from './approvalModel'
import styles from './Approvals.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'

export function ApprovalListPage({ data = demoCaseData, track1 = demoTrack1Data, track2 = demoTrack2Data, state = 'ready' }: {
  data?: CaseDataset; track1?: Track1Dataset; track2?: Track2Dataset; state?: ViewState
}) {
  const [filters, setFilters] = useState<ApprovalFilters>(defaultApprovalFilters)
  const [page, setPage] = useState(1)
  const update = (next: Partial<ApprovalFilters>) => { setFilters((current) => ({ ...current, ...next })); setPage(1) }

  if (state === 'loading') return <LoadingSkeleton label="승인 검토 후보를 불러오는 중" />
  if (state === 'failed') return <ErrorState title="승인 검토 후보를 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidCaseDataset(data, track1, track2)) return <ErrorState title="승인 검토 데이터를 확인할 수 없습니다" description="사건과 출처의 참조 관계를 확인해 주세요." />

  const allCandidates = selectApprovalCandidates(data, track1, track2)
  const matching = selectApprovalCandidates(data, track1, track2, filters)
  const pageCount = Math.ceil(matching.length / casePageSize)
  const currentPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))
  const visible = matching.slice((currentPage - 1) * casePageSize, currentPage * casePageSize)
  const columns = [
    { key: 'case', header: '사건 ID', render: ({ item }: ApprovalReviewCandidate) => <strong className={styles.caseId}>{item.id}</strong> },
    { key: 'event', header: '대상 공연', render: ({ eventName }: ApprovalReviewCandidate) => <span className={styles.eventName}>{eventName}</span> },
    { key: 'type', header: '사건 유형', render: ({ item }: ApprovalReviewCandidate) => caseTypeLabels[item.type] },
    { key: 'assignee', header: '조사 담당자', render: ({ item }: ApprovalReviewCandidate) => item.assignee ?? '미지정' },
    { key: 'priority', header: '조사 우선순위', render: ({ item }: ApprovalReviewCandidate) => <strong>{item.priority}점</strong> },
    { key: 'sources', header: '관련 출처', render: ({ sourceCount }: ApprovalReviewCandidate) => `${sourceCount}개` },
    { key: 'unknowns', header: '미확인 사항', render: ({ unknownCount }: ApprovalReviewCandidate) => `${unknownCount}개` },
    { key: 'updated', header: '최근 검토', render: ({ item }: ApprovalReviewCandidate) => <time dateTime={item.updatedAt}>{item.updatedAt.slice(0, 16).replace('T', ' ')}</time> },
    { key: 'readiness', header: '검토 준비 상태', render: () => <span className={styles.candidateStatus}>검토 후보<small>실제 요청 아님</small></span> },
    { key: 'detail', header: '상세', render: ({ item }: ApprovalReviewCandidate) => <Link className={styles.detailLink} to={`/app/approvals/${item.id}`} aria-label={`${item.id} 근거 보기`}>근거 보기</Link> },
  ]

  return <div className={styles.page}>
    <PageHeader eyebrow="Approval Review · 합성 데모 데이터" title="승인 검토 후보" description="사건의 연결 근거와 미확인 사항을 확인합니다. 이 목록은 정식 승인 요청 대기열이 아닙니다." />
    <Card className={styles.policy} aria-label="승인 검토 안내"><strong>승인 검토는 근거 확인 단계입니다.</strong><p>현재 Case 시연 상태에서 후보를 파생했습니다. 승인 요청·승인자 지정·승인 결정·공식 보고서 발급은 연결되지 않았습니다.</p></Card>
    <div className={styles.metrics} role="region" aria-label="현재 필터 결과 요약">
      <Card><span>표시 중인 검토 후보</span><strong>{matching.length}건</strong></Card>
      <Card><span>연결된 출처</span><strong>{matching.reduce((count, candidate) => count + candidate.sourceCount, 0)}개</strong></Card>
      <Card><span>미확인 사항</span><strong>{matching.reduce((count, candidate) => count + candidate.unknownCount, 0)}개</strong></Card>
      <Card><span>연관 예매 출처 포함</span><strong>{matching.filter(({ item }) => item.sources.some((source) => source.kind === 'GRAPH_CLUSTER')).length}건</strong></Card>
    </div>
    <Card className={styles.filterCard} aria-label="승인 검토 후보 검색 및 필터">
      <div className={styles.filters}>
        <label className={styles.search}>사건 ID · 공연 검색<input value={filters.query} onChange={(event) => update({ query: event.target.value })} placeholder="사건 ID 또는 공연명" /></label>
        <label>사건 유형<select value={filters.type} onChange={(event) => update({ type: event.target.value as CaseType | '' })}><option value="">전체 유형</option>{(Object.keys(caseTypeLabels) as CaseType[]).map((type) => <option key={type} value={type}>{caseTypeLabels[type]}</option>)}</select></label>
        <label>추가 검토<select value={filters.followUp} onChange={(event) => update({ followUp: event.target.value as ApprovalFilters['followUp'] })}><option value="all">전체</option><option value="yes">미확인 사항 있음</option><option value="no">미확인 사항 없음</option></select></label>
        <label>정렬<select value={filters.sort} onChange={(event) => update({ sort: event.target.value as ApprovalFilters['sort'] })}><option value="updated-desc">최근 검토 순</option><option value="updated-asc">오래된 검토 순</option><option value="priority-desc">우선순위 높은 순</option><option value="priority-asc">우선순위 낮은 순</option></select></label>
        <Button variant="secondary" onClick={() => { setFilters(defaultApprovalFilters); setPage(1) }}>필터 초기화</Button>
      </div>
      <p className={styles.filterNote}>추가 검토 필터는 사건에 기록된 미확인 사항 수만 사용합니다. 증거 부족이나 승인 가능 여부를 판정하지 않습니다.</p>
    </Card>
    {allCandidates.length === 0 ? <EmptyState title="승인 검토 후보가 없습니다" description="현재 합성 사건 중 승인 검토 대기 상태가 없습니다." /> : matching.length === 0 ? <EmptyState title="검색 결과가 없습니다" description="조건을 바꾸거나 필터를 초기화해 주세요." /> : <Card className={styles.tableCard}>
      <div className={styles.tableHeading}><h2>검토 후보 목록</h2><span aria-live="polite">{matching.length}건 중 {(currentPage - 1) * casePageSize + 1}–{Math.min(currentPage * casePageSize, matching.length)}건 표시</span></div>
      <p className={styles.tableHint}>좁은 화면에서는 표를 좌우로 스크롤해 모든 항목과 상세 링크를 확인할 수 있습니다.</p>
      <DataTable caption="합성 승인 검토 후보" columns={columns} rows={visible} getRowKey={({ item }) => item.id} />
      <nav className={styles.pagination} aria-label="승인 검토 후보 페이지"><Button variant="secondary" size="small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button><span>{currentPage} / {pageCount} 페이지</span><Button variant="secondary" size="small" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button></nav>
    </Card>}
    <p className={styles.notice}>합성 데모 데이터입니다. 조사 우선순위는 검토 순서를 위한 점수이며 불법 가능성이나 승인 가능성을 뜻하지 않습니다.</p>
  </div>
}
