import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { ApprovalDetailPage } from '../features/admin-approvals/ApprovalDetailPage'
import { ApprovalListPage } from '../features/admin-approvals/ApprovalListPage'
import { approvalChecklist, defaultApprovalFilters, selectApprovalCandidates } from '../features/admin-approvals/approvalModel'
import type { CaseDataset } from '../features/admin-cases/caseModel'
import { isValidCaseDataset } from '../features/admin-cases/caseModel'
import { demoCaseData } from '../features/admin-cases/demoData'
import { demoTrack1Data } from '../features/admin-track1/demoData'
import { demoTrack2Data } from '../features/admin-track2/demoData'

function renderList(data: CaseDataset = demoCaseData, state: 'ready' | 'loading' | 'failed' | 'forbidden' = 'ready') {
  return render(<MemoryRouter><ApprovalListPage data={data} state={state} /></MemoryRouter>)
}
function renderDetail(id: string, data: CaseDataset = demoCaseData, state: 'ready' | 'loading' | 'failed' | 'forbidden' = 'ready') {
  return render(<MemoryRouter initialEntries={[`/app/approvals/${id}`]}><Routes><Route path="/app/approvals/:caseId" element={<ApprovalDetailPage data={data} state={state} />} /></Routes></MemoryRouter>)
}
function replaceCase(index: number, update: Partial<CaseDataset['cases'][number]>): CaseDataset {
  return { cases: demoCaseData.cases.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item) }
}

describe('승인 검토 후보 데이터', () => {
  it('READY_FOR_APPROVAL 사건만 Case 데이터에서 파생하고 실제 요청으로 간주하지 않는다', () => {
    const candidates = selectApprovalCandidates(demoCaseData, demoTrack1Data, demoTrack2Data)
    expect(candidates.map(({ item }) => item.id)).toEqual(['DEMO-CASE-004'])
    expect(candidates[0]).toMatchObject({ sourceCount: 1, unknownCount: 1 })
    expect(selectApprovalCandidates(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultApprovalFilters, query: 'K-POP', type: 'GRAPH_CLUSTER', followUp: 'yes' })).toHaveLength(1)
    expect(selectApprovalCandidates(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultApprovalFilters, type: 'FAN_REPORT' })).toHaveLength(0)
    expect(selectApprovalCandidates(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultApprovalFilters, followUp: 'no' })).toHaveLength(0)
    expect(approvalChecklist(candidates[0].item).find((check) => check.id === 'backend-contract')).toMatchObject({ result: '미연동', state: 'unavailable' })
  })

  it('기존 Case 검증으로 군집·분석 실행·제보 참조와 공연 범위를 거부한다', () => {
    const valid = (data: CaseDataset) => isValidCaseDataset(data, demoTrack1Data, demoTrack2Data)
    expect(valid(demoCaseData)).toBe(true)
    expect(valid(replaceCase(3, { sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'missing', analysisRunId: 'DEMO-RUN-20261015-A' }] }))).toBe(false)
    expect(valid(replaceCase(3, { sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'DEMO-CL-003', analysisRunId: 'missing' }] }))).toBe(false)
    expect(valid(replaceCase(3, { eventId: 'DEMO-EVT-A' }))).toBe(false)
    expect(valid(replaceCase(0, { sources: [demoCaseData.cases[0].sources[0], { kind: 'FAN_REPORT', reportId: 'missing' }] }))).toBe(false)
    expect(valid(replaceCase(3, { sources: [demoCaseData.cases[3].sources[0], demoCaseData.cases[3].sources[0]] }))).toBe(false)
  })
})

describe('승인 검토 후보 목록', () => {
  it('메뉴와 지연 로딩 경로에서 후보 1건과 실제 출처·미확인 수를 표시한다', async () => {
    render(<MemoryRouter initialEntries={['/app/approvals']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '승인 검토 후보' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '승인 검토' })).toHaveAttribute('href', '/app/approvals')
    const summary = screen.getByRole('region', { name: '현재 필터 결과 요약' })
    expect(within(summary).getAllByText('1건')).toHaveLength(2)
    expect(within(summary).getAllByText('1개')).toHaveLength(2)
    expect(screen.queryByText('승인 완료')).not.toBeInTheDocument()
    expect(screen.getByText('실제 요청 아님')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'DEMO-CASE-004 근거 보기' }))
    expect(await screen.findByRole('heading', { name: '승인 검토 · DEMO-CASE-004' })).toBeInTheDocument()
  })

  it('검색·유형·추가 검토 필터를 적용하고 초기화한다', () => {
    renderList()
    fireEvent.change(screen.getByRole('textbox', { name: '사건 ID · 공연 검색' }), { target: { value: '없는 공연' } })
    expect(screen.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    fireEvent.change(screen.getByRole('combobox', { name: '사건 유형' }), { target: { value: 'FAN_REPORT' } })
    expect(screen.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    fireEvent.change(screen.getByRole('combobox', { name: '추가 검토' }), { target: { value: 'no' } })
    expect(screen.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    expect(screen.getByRole('link', { name: 'DEMO-CASE-004 근거 보기' })).toBeInTheDocument()
  })

  it('실제 후보 배열을 정렬하고 5건 단위로 페이지를 이동한다', () => {
    const base = demoCaseData.cases[3]
    const data: CaseDataset = { cases: Array.from({ length: 6 }, (_, index) => ({
      ...base, id: `DEMO-CASE-P${index + 1}`, priority: 70 + index,
      updatedAt: `2026-10-16T09:0${index}:00+09:00`,
    })) }
    expect(isValidCaseDataset(data, demoTrack1Data, demoTrack2Data)).toBe(true)
    renderList(data)
    expect(screen.getByText('1 / 2 페이지')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DEMO-CASE-P6 근거 보기' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DEMO-CASE-P1 근거 보기' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '정렬' }), { target: { value: 'priority-desc' } })
    expect(screen.getByText('1 / 2 페이지')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DEMO-CASE-P6 근거 보기' })).toBeInTheDocument()
  })

  it('후보 없음·데이터 오류·로딩·조회 실패·권한 제한을 구분한다', () => {
    const view = renderList({ cases: demoCaseData.cases.filter((item) => item.status !== 'READY_FOR_APPROVAL') })
    expect(screen.getByRole('heading', { name: '승인 검토 후보가 없습니다' })).toBeInTheDocument()
    view.rerender(<MemoryRouter><ApprovalListPage data={replaceCase(3, { eventId: 'missing' })} /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('승인 검토 데이터를 확인할 수 없습니다')
    view.rerender(<MemoryRouter><ApprovalListPage state="loading" /></MemoryRouter>)
    expect(screen.getByRole('status', { name: '승인 검토 후보를 불러오는 중' })).toBeInTheDocument()
    view.rerender(<MemoryRouter><ApprovalListPage state="failed" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
    view.rerender(<MemoryRouter><ApprovalListPage state="forbidden" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('접근 권한')
  })
})

describe('승인 검토 근거 상세', () => {
  it('사건 상태와 근거·미확인 사항을 표시하고 모든 업무 동작을 비활성화한다', () => {
    renderDetail('DEMO-CASE-004')
    expect(within(screen.getByRole('region', { name: '사건 개요' })).getByText('승인 검토 대기')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '군집 DEMO-CL-003 상세 보기' })).toHaveAttribute('href', '/app/analysis/findings/DEMO-CL-003')
    expect(screen.getByRole('link', { name: '기존 사건 상세 보기' })).toHaveAttribute('href', '/app/cases/DEMO-CASE-004')
    expect(screen.getByRole('heading', { name: '미확인 사항 · 추가 확인 1개' })).toBeInTheDocument()
    const checklist = screen.getByRole('region', { name: '검토 체크리스트' })
    expect(within(checklist).getAllByRole('listitem')).toHaveLength(6)
    expect(within(checklist).getByText('정식 승인 요청을 위한 Backend 계약이 존재하는가?')).toBeInTheDocument()
    expect(within(checklist).getByText('미연동')).toBeInTheDocument()
    for (const name of ['승인 요청 제출', '승인', '반려', '보완 요청 전송', '공식 보고서 발급']) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.getByText(/승인 기록과 감사 이력은 생성되지 않습니다/)).toBeInTheDocument()
  })

  it('복합 후보에서 Track 1·2 링크와 직접 연결 미확정을 함께 보여준다', () => {
    renderDetail('DEMO-CASE-001', replaceCase(0, { status: 'READY_FOR_APPROVAL' }))
    expect(screen.getByText('출처 간 관계 · 직접 연결 미확정')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '군집 DEMO-CL-001 상세 보기' })).toHaveAttribute('href', '/app/analysis/findings/DEMO-CL-001')
    expect(screen.getByRole('link', { name: '제보 DEMO-REP-008 상세 보기' })).toHaveAttribute('href', '/app/fan-reports/DEMO-REP-008')
    expect(screen.getByText('관계 설명 표시')).toBeInTheDocument()
  })

  it('잘못된 ID, 후보가 아닌 Case, 누락 출처와 시연 오류 상태를 구분한다', () => {
    const missing = renderDetail('missing')
    expect(screen.getByRole('heading', { name: '사건을 찾을 수 없습니다' })).toBeInTheDocument()
    missing.unmount()
    const other = renderDetail('DEMO-CASE-001')
    expect(screen.getByRole('heading', { name: '승인 검토 후보가 아닙니다' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '사건 DEMO-CASE-001 상세 보기' })).toHaveAttribute('href', '/app/cases/DEMO-CASE-001')
    other.unmount()
    const bad = renderDetail('DEMO-CASE-004', replaceCase(3, { sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'missing', analysisRunId: 'DEMO-RUN-20261015-A' }] }))
    expect(screen.getByRole('alert')).toHaveTextContent('승인 검토 데이터를 확인할 수 없습니다')
    bad.unmount()
    const states = renderDetail('DEMO-CASE-004', demoCaseData, 'loading')
    expect(screen.getByRole('status', { name: '승인 검토 근거를 불러오는 중' })).toBeInTheDocument()
    states.rerender(<MemoryRouter initialEntries={['/app/approvals/DEMO-CASE-004']}><Routes><Route path="/app/approvals/:caseId" element={<ApprovalDetailPage state="failed" />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
    states.rerender(<MemoryRouter initialEntries={['/app/approvals/DEMO-CASE-004']}><Routes><Route path="/app/approvals/:caseId" element={<ApprovalDetailPage state="forbidden" />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('접근 권한')
  })
})
