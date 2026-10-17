import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { demoTrack1Data } from '../admin-track1/demoData'
import type { Track1Dataset } from '../admin-track1/demoData'
import { demoTrack2Data } from '../admin-track2/demoData'
import type { Track2Dataset } from '../admin-track2/track2Model'
import { caseEvents, casePageSize, caseStatusLabels, caseTypeLabels, defaultCaseFilters, filterCases, isValidCaseDataset, summarizeCaseEvidence } from './caseModel'
import type { CaseDataset, CaseFilters, CaseRecord, CaseStatus, CaseType } from './caseModel'
import { demoCaseData } from './demoData'
import styles from './Cases.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'
export function CaseListPage({ data = demoCaseData, track1 = demoTrack1Data, track2 = demoTrack2Data, state = 'ready' }: { data?: CaseDataset; track1?: Track1Dataset; track2?: Track2Dataset; state?: ViewState }) {
  const [filters, setFilters] = useState<CaseFilters>(defaultCaseFilters)
  const [page, setPage] = useState(1)
  const update = (next: Partial<CaseFilters>) => { setFilters((current) => ({ ...current, ...next })); setPage(1) }
  if (state === 'loading') return <LoadingSkeleton label="사건 목록을 불러오는 중" />
  if (state === 'failed') return <ErrorState title="사건 목록을 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidCaseDataset(data, track1, track2)) return <ErrorState title="사건 데이터 형식을 확인할 수 없습니다" description="합성 출처의 참조 관계를 확인해 주세요." />

  const matching = filterCases(data, track1, track2, filters)
  const pageCount = Math.ceil(matching.length / casePageSize)
  const currentPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))
  const visible = matching.slice((currentPage - 1) * casePageSize, currentPage * casePageSize)
  const events = new Map(caseEvents(track1, track2).map((event) => [event.id, event.name]))
  const eventName = (item: CaseRecord) => events.get(item.eventId) ?? ''
  const assignees = [...new Set(data.cases.map((item) => item.assignee).filter((name): name is string => Boolean(name)))].sort()
  const columns = [
    { key: 'id', header: '사건 ID', render: (item: CaseRecord) => <strong>{item.id}</strong> },
    { key: 'event', header: '대상 공연', render: (item: CaseRecord) => eventName(item) },
    { key: 'type', header: '유형', render: (item: CaseRecord) => caseTypeLabels[item.type] },
    { key: 'status', header: '조사 상태', render: (item: CaseRecord) => <StatusBadge domain="case" status={item.status} /> },
    { key: 'assignee', header: '담당자', render: (item: CaseRecord) => item.assignee ?? '미지정' },
    { key: 'priority', header: '조사 우선순위', render: (item: CaseRecord) => <strong>{item.priority}점</strong> },
    { key: 'evidence', header: '연결 근거', render: (item: CaseRecord) => { const summary = summarizeCaseEvidence(item, track2); return `${summary.sourceCount}개 출처 · 첨부 ${summary.evidenceFileCount}개` } },
    { key: 'created', header: '생성 시각', render: (item: CaseRecord) => <time dateTime={item.createdAt}>{item.createdAt.slice(0, 16).replace('T', ' ')}</time> },
    { key: 'updated', header: '최근 검토', render: (item: CaseRecord) => <time dateTime={item.updatedAt}>{item.updatedAt.slice(0, 16).replace('T', ' ')}</time> },
    { key: 'detail', header: '상세', render: (item: CaseRecord) => <Link className={styles.detailLink} to={`/app/cases/${item.id}`} aria-label={`${item.id} 상세 보기`}>상세 보기</Link> },
  ]

  return <div className={styles.page}>
    <PageHeader eyebrow="Case Management · 합성 데모 데이터" title="사건 관리" description="연관 예매 군집과 팬 제보를 사건 단위로 살펴봅니다. 상태와 담당자는 시연용이며 실제 업무 처리는 연결되지 않았습니다." />
    <div className={styles.metrics} role="region" aria-label="현재 필터 결과 요약">
      <Card><span>검색 결과</span><strong>{matching.length}건</strong></Card>
      <Card><span>군집 출처</span><strong>{matching.filter((item) => item.sources.some((source) => source.kind === 'GRAPH_CLUSTER')).length}건</strong></Card>
      <Card><span>팬 제보 출처</span><strong>{matching.filter((item) => item.sources.some((source) => source.kind === 'FAN_REPORT')).length}건</strong></Card>
      <Card><span>추가 자료 필요</span><strong>{matching.filter((item) => item.status === 'NEEDS_EVIDENCE').length}건</strong></Card>
    </div>
    <Card className={styles.filterCard} aria-label="사건 검색 및 필터">
      <div className={styles.filters}>
        <label className={styles.search}>사건 ID · 공연 검색<input value={filters.query} onChange={(event) => update({ query: event.target.value })} placeholder="사건 ID 또는 공연명" /></label>
        <label>사건 유형<select value={filters.type} onChange={(event) => update({ type: event.target.value as CaseType | '' })}><option value="">전체 유형</option>{(Object.keys(caseTypeLabels) as CaseType[]).map((type) => <option key={type} value={type}>{caseTypeLabels[type]}</option>)}</select></label>
        <label>조사 상태<select value={filters.status} onChange={(event) => update({ status: event.target.value as CaseStatus | '' })}><option value="">전체 상태</option>{(Object.keys(caseStatusLabels) as CaseStatus[]).map((status) => <option key={status} value={status}>{caseStatusLabels[status]}</option>)}</select></label>
        <label>담당자<select value={filters.assignee} onChange={(event) => update({ assignee: event.target.value })}><option value="">전체 담당자</option><option value="UNASSIGNED">미지정</option>{assignees.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>정렬<select value={filters.sort} onChange={(event) => update({ sort: event.target.value as CaseFilters['sort'] })}><option value="updated-desc">최근 검토 순</option><option value="updated-asc">오래된 검토 순</option><option value="priority-desc">우선순위 높은 순</option><option value="priority-asc">우선순위 낮은 순</option></select></label>
        <Button variant="secondary" onClick={() => { setFilters(defaultCaseFilters); setPage(1) }}>필터 초기화</Button>
      </div>
    </Card>
    {data.cases.length === 0 ? <EmptyState title="표시할 사건이 없습니다" description="합성 사건 데이터가 없습니다." /> : matching.length === 0 ? <EmptyState title="검색 결과가 없습니다" description="조건을 바꾸거나 필터를 초기화해 주세요." /> : <Card className={styles.tableCard}>
      <div className={styles.tableHeading}><h2>사건 목록</h2><span aria-live="polite">{matching.length}건 중 {(currentPage - 1) * casePageSize + 1}–{Math.min(currentPage * casePageSize, matching.length)}건 표시</span></div>
      <p className={styles.tableHint}>표를 좌우로 스크롤하면 최근 검토 시각과 상세 보기를 확인할 수 있습니다.</p>
      <DataTable caption="합성 사건 목록" columns={columns} rows={visible} getRowKey={(item) => item.id} />
      <nav className={styles.pagination} aria-label="사건 목록 페이지"><Button variant="secondary" size="small" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</Button><span>{currentPage} / {pageCount} 페이지</span><Button variant="secondary" size="small" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</Button></nav>
    </Card>}
    <p className={styles.notice}>합성 데모 데이터입니다. 조사 우선순위 점수는 불법 가능성을 뜻하지 않습니다. 실제 관리자 인증·사건 조회 API는 연결되지 않았습니다.</p>
  </div>
}
