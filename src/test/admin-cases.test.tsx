import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { demoTrack1Data } from '../features/admin-track1/demoData'
import { demoTrack2Data } from '../features/admin-track2/demoData'
import { CaseDetailPage } from '../features/admin-cases/CaseDetailPage'
import { CaseListPage } from '../features/admin-cases/CaseListPage'
import { caseEvents, casePageSize, defaultCaseFilters, filterCases, isValidCaseDataset, summarizeCaseEvidence } from '../features/admin-cases/caseModel'
import type { CaseDataset } from '../features/admin-cases/caseModel'
import { demoCaseData } from '../features/admin-cases/demoData'
import { enableAdminDemoPreview } from './adminPreview'

enableAdminDemoPreview()

function renderList(data: CaseDataset = demoCaseData, state: 'ready' | 'loading' | 'failed' | 'forbidden' = 'ready') {
  return render(<MemoryRouter><CaseListPage data={data} state={state} /></MemoryRouter>)
}
function renderDetail(id: string, data: CaseDataset = demoCaseData, state: 'ready' | 'loading' | 'failed' | 'forbidden' = 'ready') {
  return render(<MemoryRouter initialEntries={[`/app/cases/${id}`]}><Routes><Route path="/app/cases/:caseId" element={<CaseDetailPage data={data} state={state} />} /></Routes></MemoryRouter>)
}
function changed(index: number, update: Partial<CaseDataset['cases'][number]>): CaseDataset {
  return { cases: demoCaseData.cases.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item) }
}
const valid = (data: unknown) => isValidCaseDataset(data, demoTrack1Data, demoTrack2Data)

describe('합성 Case 데이터와 검색', () => {
  it('Case와 분석 실행·군집·팬 제보의 참조를 검증한다', () => {
    expect(valid(demoCaseData)).toBe(true)
    expect(summarizeCaseEvidence(demoCaseData.cases[0], demoTrack2Data)).toEqual({ sourceCount: 2, evidenceFileCount: 2 })
    expect(valid(changed(0, { id: demoCaseData.cases[1].id }))).toBe(false)
    expect(valid(changed(0, { sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'missing', analysisRunId: 'DEMO-RUN-20261015-A' }, demoCaseData.cases[0].sources[1]] }))).toBe(false)
    expect(valid(changed(0, { sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'DEMO-CL-001', analysisRunId: 'missing' }, demoCaseData.cases[0].sources[1]] }))).toBe(false)
    expect(valid(changed(0, { sources: [demoCaseData.cases[0].sources[0], { kind: 'FAN_REPORT', reportId: 'missing' }] }))).toBe(false)
    expect(valid(changed(0, { sources: [demoCaseData.cases[0].sources[0], demoCaseData.cases[0].sources[0], demoCaseData.cases[0].sources[1]] }))).toBe(false)
    expect(valid(changed(0, { type: 'FAN_REPORT' }))).toBe(false)
    expect(valid(changed(0, { eventId: 'DEMO-EVT-B' }))).toBe(false)
    expect(valid(changed(0, { linkReason: null }))).toBe(false)
  })

  it('날짜·우선순위·필수 이력과 공연 이름 불일치를 거부한다', () => {
    expect(valid(changed(0, { priority: 101 }))).toBe(false)
    expect(valid(changed(0, { createdAt: '2026-10-17T00:00:00+09:00' }))).toBe(false)
    expect(valid(changed(0, { activities: [] }))).toBe(false)
    expect(valid(changed(0, { activities: [{ id: 'x', at: demoCaseData.cases[0].createdAt, kind: 'CREATED', detail: '' }] }))).toBe(false)
    expect(isValidCaseDataset(demoCaseData, demoTrack1Data, { ...demoTrack2Data, events: demoTrack2Data.events.map((event) => event.id === 'DEMO-EVT-A' ? { ...event, name: '다른 공연' } : event) })).toBe(false)
  })

  it('각 트랙에만 있는 공연과 공통 공연을 출처 범위에 맞게 검증한다', () => {
    expect(valid({ cases: [demoCaseData.cases[5]] })).toBe(true)
    expect(valid({ cases: [demoCaseData.cases[0]] })).toBe(true)
    const track2 = {
      ...demoTrack2Data,
      events: [...demoTrack2Data.events, { id: 'DEMO-EVT-T2', name: '단독 팬 공연' }],
      reports: demoTrack2Data.reports.map((report) => report.id === 'DEMO-REP-013' ? { ...report, eventId: 'DEMO-EVT-T2' } : report),
    }
    const fanCase = {
      ...demoCaseData.cases[4], id: 'DEMO-CASE-T2', eventId: 'DEMO-EVT-T2',
      summary: 'Track 2에만 있는 공연의 합성 제보입니다.',
      sources: [{ kind: 'FAN_REPORT' as const, reportId: 'DEMO-REP-013' }],
      facts: ['합성 제보에는 첨부 이미지가 없습니다.'], clues: [],
    }
    const cases: CaseDataset = { cases: [fanCase] }
    expect(isValidCaseDataset(cases, demoTrack1Data, track2)).toBe(true)
    expect(caseEvents(demoTrack1Data, track2).find((event) => event.id === fanCase.eventId)?.name).toBe('단독 팬 공연')
    expect(filterCases(cases, demoTrack1Data, track2, { ...defaultCaseFilters, query: '단독 팬 공연' })).toHaveLength(1)
    expect(isValidCaseDataset({ cases: [{ ...fanCase, eventId: 'DEMO-EVT-A' }] }, demoTrack1Data, track2)).toBe(false)
    const list = render(<MemoryRouter><CaseListPage data={cases} track1={demoTrack1Data} track2={track2} /></MemoryRouter>)
    expect(within(screen.getByRole('table')).getByText('단독 팬 공연')).toBeInTheDocument()
    list.unmount()
    render(<MemoryRouter initialEntries={['/app/cases/DEMO-CASE-T2']}><Routes><Route path="/app/cases/:caseId" element={<CaseDetailPage data={cases} track1={demoTrack1Data} track2={track2} />} /></Routes></MemoryRouter>)
    expect(within(screen.getByRole('region', { name: '사건 개요' })).getByText('단독 팬 공연')).toBeInTheDocument()
  })

  it('구분자가 포함된 서로 다른 군집·실행 조합을 충돌 없이 구분한다', () => {
    const track1 = {
      ...demoTrack1Data,
      runs: [{ ...demoTrack1Data.runs[0], id: 'c' }, { ...demoTrack1Data.runs[1], id: 'b:c' }],
      clusters: [
        { ...demoTrack1Data.clusters[0], id: 'a:b', analysisRunId: 'c' },
        { ...demoTrack1Data.clusters[1], id: 'a', analysisRunId: 'b:c' },
      ],
    }
    const first = { kind: 'GRAPH_CLUSTER' as const, clusterId: 'a:b', analysisRunId: 'c' }
    const second = { kind: 'GRAPH_CLUSTER' as const, clusterId: 'a', analysisRunId: 'b:c' }
    const record = { ...demoCaseData.cases[1], sources: [first, second] }
    expect(isValidCaseDataset({ cases: [record] }, track1, demoTrack2Data)).toBe(true)
    expect(isValidCaseDataset({ cases: [{ ...record, sources: [first, first] }] }, track1, demoTrack2Data)).toBe(false)
  })

  it('검색·필터·정렬을 조합하고 동점은 ID 순서로 유지한다', () => {
    expect(casePageSize).toBe(5)
    expect(filterCases(demoCaseData, demoTrack1Data, demoTrack2Data, defaultCaseFilters)).toHaveLength(6)
    expect(filterCases(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultCaseFilters, query: 'Autumn', type: 'COMBINED', status: 'IN_REVIEW', assignee: '시연 담당 A' }).map((item) => item.id)).toEqual(['DEMO-CASE-001'])
    expect(filterCases(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultCaseFilters, query: '없는 공연' })).toHaveLength(0)
    expect(filterCases(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultCaseFilters, assignee: 'UNASSIGNED' }).map((item) => item.id)).toEqual(['DEMO-CASE-005'])
    expect(filterCases(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultCaseFilters, sort: 'priority-desc' })[0].id).toBe('DEMO-CASE-004')
    const tied = changed(1, { priority: demoCaseData.cases[0].priority })
    expect(filterCases(tied, demoTrack1Data, demoTrack2Data, { ...defaultCaseFilters, sort: 'priority-desc' }).filter((item) => item.priority === 82).map((item) => item.id)).toEqual(['DEMO-CASE-001', 'DEMO-CASE-002'])
    expect(filterCases(demoCaseData, demoTrack1Data, demoTrack2Data, { ...defaultCaseFilters, sort: 'updated-asc' })[0].id).toBe('DEMO-CASE-005')
  })
})

describe('사건 목록과 상세', () => {
  it('검색 결과 지표와 페이지를 계산하고 상세로 이동한다', async () => {
    render(<MemoryRouter initialEntries={['/app/cases']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '사건 관리' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '현재 필터 결과 요약' })).getByText('6건')).toBeInTheDocument()
    expect(screen.getByText('1 / 2 페이지')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'DEMO-CASE-005 상세 보기' }))
    expect(await screen.findByRole('heading', { name: '사건 DEMO-CASE-005' })).toBeInTheDocument()
  })

  it('마지막 페이지에서 검색 조건이 줄면 첫 페이지로 돌아가고 필터를 초기화한다', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.change(screen.getByRole('textbox', { name: '사건 ID · 공연 검색' }), { target: { value: 'DEMO-CASE-001' } })
    expect(screen.getByText('1 / 1 페이지')).toBeInTheDocument()
    expect(screen.getByText('1건 중 1–1건 표시')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '사건 유형' }), { target: { value: 'FAN_REPORT' } })
    expect(screen.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    expect(screen.getByText('1 / 2 페이지')).toBeInTheDocument()
  })

  it('빈 목록·잘못된 데이터·로딩·조회 실패·권한 제한을 구분한다', () => {
    const view = renderList({ cases: [] })
    expect(screen.getByRole('heading', { name: '표시할 사건이 없습니다' })).toBeInTheDocument()
    view.rerender(<MemoryRouter><CaseListPage data={changed(0, { eventId: 'missing' })} /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('사건 데이터 형식')
    view.rerender(<MemoryRouter><CaseListPage state="loading" /></MemoryRouter>)
    expect(screen.getByRole('status', { name: '사건 목록을 불러오는 중' })).toBeInTheDocument()
    view.rerender(<MemoryRouter><CaseListPage state="failed" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
    view.rerender(<MemoryRouter><CaseListPage state="forbidden" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('접근 권한')
  })

  it('복합 사건에서 두 출처를 구분하고 실제 연결은 미확인으로 표시한다', () => {
    renderDetail('DEMO-CASE-001')
    expect(screen.getByText('임시 공동 검토 · 직접 연결 미확인')).toBeInTheDocument()
    expect(screen.getByText('동일 예매·계정 관계는 확인되지 않았으며, 실제 사건 통합 근거가 아닙니다.', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '군집 DEMO-CL-001 상세 보기' })).toHaveAttribute('href', '/app/analysis/findings/DEMO-CL-001')
    expect(screen.getByRole('link', { name: '제보 DEMO-REP-008 상세 보기' })).toHaveAttribute('href', '/app/fan-reports/DEMO-REP-008')
    expect(screen.getByText('아래 이력은 합성 시연 내용이며 실제 감사 로그나 저장 기록이 아닙니다.')).toBeInTheDocument()
    for (const name of ['담당자 변경', '상태 변경', '승인 요청', '승인·반려', '사건 종료', '공식 보고서 발급']) expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  it('없는 ID는 목록 링크를 제공하고 상세 오류 상태를 구분한다', () => {
    const view = renderDetail('missing')
    expect(screen.getByRole('heading', { name: '사건을 찾을 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '사건 목록으로 이동' })).toHaveAttribute('href', '/app/cases')
    view.rerender(<MemoryRouter initialEntries={['/app/cases/missing']}><Routes><Route path="/app/cases/:caseId" element={<CaseDetailPage data={changed(0, { sources: [{ kind: 'FAN_REPORT', reportId: 'missing' }] })} />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('사건 데이터 형식')
    view.rerender(<MemoryRouter initialEntries={['/app/cases/missing']}><Routes><Route path="/app/cases/:caseId" element={<CaseDetailPage state="failed" />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
  })
})
