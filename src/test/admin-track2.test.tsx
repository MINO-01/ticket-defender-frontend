import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { demoTrack2Data } from '../features/admin-track2/demoData'
import { FanReportDetailPage } from '../features/admin-track2/FanReportDetailPage'
import { FanReportListPage } from '../features/admin-track2/FanReportListPage'
import { ReservationComparisonPanel } from '../features/admin-track2/ReservationComparisonPanel'
import { defaultReportFilters, filterReports, isValidTrack2Dataset, reportPageSize } from '../features/admin-track2/track2Model'
import type { Track2Dataset } from '../features/admin-track2/track2Model'

function renderApp(path: string) { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>) }
function renderList(data: Track2Dataset = demoTrack2Data, state: 'ready' | 'loading' | 'failed' | 'forbidden' = 'ready') {
  return render(<MemoryRouter><FanReportListPage data={data} state={state} /></MemoryRouter>)
}
function renderDetail(path: string, data: Track2Dataset = demoTrack2Data, state: 'ready' | 'loading' | 'failed' | 'forbidden' = 'ready') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/app/fan-reports/:reportId" element={<FanReportDetailPage data={data} state={state} />} /></Routes></MemoryRouter>)
}

describe('Track 2 합성 데이터', () => {
  it('제보와 증거·추출·대조 참조가 일치하고 사례별 상태가 구분된다', () => {
    expect(isValidTrack2Dataset(demoTrack2Data)).toBe(true)
    const statuses = new Set(demoTrack2Data.comparisons.map((item) => item.status))
    expect(statuses).toEqual(new Set(['MATCH_CANDIDATE', 'NO_MATCH', 'UNVERIFIABLE']))
    expect(demoTrack2Data.extractions.map((item) => item.status)).toContain('FAILED')
    expect(demoTrack2Data.extractions.flatMap((item) => item.fields.map((field) => field.status))).toEqual(expect.arrayContaining(['VISIBLE', 'ABSENT', 'UNREADABLE', 'AMBIGUOUS']))
    for (const report of demoTrack2Data.reports) {
      expect(demoTrack2Data.evidence.filter((item) => report.evidenceIds.includes(item.id)).every((item) => item.reportId === report.id)).toBe(true)
      expect(demoTrack2Data.extractions.find((item) => item.id === report.extractionId)?.reportId).toBe(report.id)
      expect(demoTrack2Data.comparisons.find((item) => item.id === report.comparisonId)?.reportId).toBe(report.id)
    }
  })

  it('중복 ID와 다른 제보를 가리키는 참조 및 불명확한 필드의 값을 거부한다', () => {
    const changedEvidence = { ...demoTrack2Data, evidence: demoTrack2Data.evidence.map((item, index) => index ? item : { ...item, reportId: 'DEMO-REP-009' }) }
    const changedExtraction = { ...demoTrack2Data, extractions: demoTrack2Data.extractions.map((item, index) => index ? item : { ...item, reportId: 'DEMO-REP-009' }) }
    const changedComparison = { ...demoTrack2Data, comparisons: demoTrack2Data.comparisons.map((item, index) => index ? item : { ...item, reportId: 'DEMO-REP-009' }) }
    expect(isValidTrack2Dataset(changedEvidence)).toBe(false)
    expect(isValidTrack2Dataset(changedExtraction)).toBe(false)
    expect(isValidTrack2Dataset(changedComparison)).toBe(false)
    expect(isValidTrack2Dataset({ ...demoTrack2Data, reports: [...demoTrack2Data.reports, demoTrack2Data.reports[0]] })).toBe(false)
    const candidateWithoutEvidence = { ...demoTrack2Data, comparisons: demoTrack2Data.comparisons.map((item) => item.id === 'DEMO-CMP-008' ? { ...item, checks: [] } : item) }
    expect(isValidTrack2Dataset(candidateWithoutEvidence)).toBe(false)
    const partial = demoTrack2Data.extractions[2]
    expect(isValidTrack2Dataset({ ...demoTrack2Data, extractions: demoTrack2Data.extractions.map((item) => item.id === partial.id ? { ...item, fields: partial.fields.map((field) => field.key === 'SEAT' ? { ...field, value: '추정 14번' } : field) } : item) })).toBe(false)
  })

  it('검색, 필터, 정렬을 순서대로 적용하고 동률은 ID로 정렬한다', () => {
    expect(filterReports(demoTrack2Data, defaultReportFilters)).toHaveLength(6)
    const filtered = filterReports(demoTrack2Data, { ...defaultReportFilters, query: 'Autumn', eventId: 'DEMO-EVT-A', extraction: 'COMPLETED', comparison: 'MATCH_CANDIDATE', review: 'UNDER_REVIEW' })
    expect(filtered.map((item) => item.id)).toEqual(['DEMO-REP-008'])
    expect(filterReports(demoTrack2Data, { ...defaultReportFilters, query: '없는 제보' })).toHaveLength(0)
    const tied = { ...demoTrack2Data, reports: demoTrack2Data.reports.map((item) => item.id === 'DEMO-REP-009' ? { ...item, receivedAt: demoTrack2Data.reports[0].receivedAt } : item) }
    expect(filterReports(tied, defaultReportFilters).slice(0, 2).map((item) => item.id)).toEqual(['DEMO-REP-008', 'DEMO-REP-009'])
    expect(filterReports(demoTrack2Data, { ...defaultReportFilters, sort: 'oldest' })[0].id).toBe('DEMO-REP-013')
    expect(reportPageSize).toBe(5)
  })
})

describe('Track 2 제보 목록', () => {
  it('합성 집계를 계산하고 다음 페이지에서 상세 화면으로 이동한다', async () => {
    renderApp('/app/fan-reports')
    expect(await screen.findByRole('heading', { name: '팬 제보 검토' })).toBeInTheDocument()
    expect(screen.getByText('6건')).toBeInTheDocument()
    expect(screen.getAllByText('4건')).toHaveLength(2)
    expect(screen.getByText('2건')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(6)
    expect(screen.getByRole('region', { name: '합성 팬 제보 검토 목록 가로 스크롤 영역' })).toHaveAttribute('tabindex', '0')
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'DEMO-REP-013 상세 검토' }))
    expect(await screen.findByRole('heading', { name: '제보 DEMO-REP-013 증거 검토' })).toBeInTheDocument()
  })

  it('검색·상태 필터 조합의 건수와 빈 결과 및 초기화를 표시한다', () => {
    renderList()
    fireEvent.change(screen.getByRole('textbox', { name: '검색' }), { target: { value: 'DEMO-REP-008' } })
    expect(within(screen.getByText('검색 결과').closest('section')!).getByText('1건')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '대조 상태' }), { target: { value: 'NO_MATCH' } })
    expect(screen.getByRole('heading', { name: '검색 결과가 없습니다' })).toBeInTheDocument()
    expect(screen.getAllByText('0건')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    fireEvent.change(screen.getByRole('combobox', { name: '추출 상태' }), { target: { value: 'FAILED' } })
    expect(within(screen.getByText('검색 결과').closest('section')!).getByText('1건')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('DEMO-REP-011')).toBeInTheDocument()
  })

  it('마지막 페이지에서 조건이나 데이터가 줄면 페이지 범위를 보정한다', () => {
    const view = renderList()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.change(screen.getByRole('textbox', { name: '검색' }), { target: { value: 'DEMO-REP-008' } })
    expect(screen.getByText('1 / 1 페이지')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    view.rerender(<MemoryRouter><FanReportListPage data={{ ...demoTrack2Data, reports: demoTrack2Data.reports.slice(0, 2), evidence: demoTrack2Data.evidence.filter((item) => ['DEMO-REP-008', 'DEMO-REP-009'].includes(item.reportId)), extractions: demoTrack2Data.extractions.slice(0, 2), comparisons: demoTrack2Data.comparisons.slice(0, 2) }} /></MemoryRouter>)
    expect(screen.getByText('1 / 1 페이지')).toBeInTheDocument()
    expect(screen.getByText('2건 중 1–2건 표시')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
  })

  it('빈 데이터, 형식 오류, 로딩, 조회 실패와 권한 제한을 구분한다', () => {
    const empty: Track2Dataset = { events: [], reports: [], evidence: [], extractions: [], comparisons: [] }
    const view = renderList(empty)
    expect(screen.getByRole('heading', { name: '표시할 제보가 없습니다' })).toBeInTheDocument()
    view.rerender(<MemoryRouter><FanReportListPage data={{ ...demoTrack2Data, reports: [{ ...demoTrack2Data.reports[0], eventId: 'missing' }] }} /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('제보 데이터 형식')
    view.rerender(<MemoryRouter><FanReportListPage state="loading" /></MemoryRouter>)
    expect(screen.getByRole('status', { name: '팬 제보 목록을 불러오는 중' })).toBeInTheDocument()
    view.rerender(<MemoryRouter><FanReportListPage state="failed" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
    view.rerender(<MemoryRouter><FanReportListPage state="forbidden" /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('접근 권한')
  })
})

describe('Track 2 제보 상세', () => {
  it('부분 일치가 있어도 조회 범위에서 좌석 후보가 없으면 정확한 상태를 표시한다', () => {
    const comparison = demoTrack2Data.comparisons.find((item) => item.id === 'DEMO-CMP-009')!
    expect(comparison.checks.some((check) => check.result === 'MATCH')).toBe(true)
    expect(comparison.checks.find((check) => check.label === '좌석 구역·번호')?.result).toBe('UNKNOWN')
    renderDetail('/app/fan-reports/DEMO-REP-009')
    expect(screen.getByText('예매 후보 미발견')).toBeInTheDocument()
    expect(screen.getByText('확인한 합성 예매 자료 범위에서 해당 좌석의 예매 후보를 찾지 못했습니다. 공연·회차 정보는 일치합니다.')).toBeInTheDocument()
    expect(screen.getByText('표시 정보 일치')).toBeInTheDocument()
    expect(screen.getByText(/조회 범위에서 좌석 후보 미발견/)).toBeInTheDocument()
    expect(screen.queryByText('일치 항목 없음')).not.toBeInTheDocument()
  })

  it('실제 대조값이 다를 때는 항목별 불일치로 표시한다', () => {
    render(<ReservationComparisonPanel comparison={{ id: 'DEMO-CMP-CHECK', reportId: 'DEMO-REP-CHECK', status: 'NO_MATCH', reservationId: null, reason: '확인한 자료에서 일치 후보를 찾지 못했습니다.', checks: [{ label: '좌석번호', observation: '14번', reference: '15번', result: 'MISMATCH' }], unknowns: [] }} />)
    expect(screen.getByText('대조값 불일치')).toBeInTheDocument()
    expect(screen.getByText('예매 후보 미발견')).toBeInTheDocument()
  })

  it('없는 ID는 제보 정보를 노출하지 않고 목록 링크를 표시한다', async () => {
    renderApp('/app/fan-reports/missing')
    expect(await screen.findByRole('heading', { name: '제보를 찾을 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '제보 목록으로 돌아가기' })).toHaveAttribute('href', '/app/fan-reports')
    expect(screen.queryByRole('heading', { name: '증거 파일' })).not.toBeInTheDocument()
  })

  it('증거를 선택하고 미리보기 오류를 안내한다', () => {
    renderDetail('/app/fan-reports/DEMO-REP-008')
    expect(screen.getByRole('img', { name: '합성 티켓 예시.svg의 합성 화면 예시' })).toHaveAttribute('src', '/demo-evidence-ticket.svg')
    fireEvent.click(screen.getByRole('button', { name: '2번 자료: 합성 게시글 예시.svg' }))
    expect(screen.getByRole('img', { name: '합성 게시글 예시.svg의 합성 화면 예시' })).toHaveAttribute('src', '/demo-evidence-listing.svg')
    fireEvent.error(screen.getByRole('img', { name: '합성 게시글 예시.svg의 합성 화면 예시' }))
    expect(screen.getByRole('alert')).toHaveTextContent('미리보기를 불러오지 못했습니다')
    fireEvent.click(screen.getByRole('button', { name: '1번 자료: 합성 티켓 예시.svg' }))
    expect(screen.getByRole('img', { name: '합성 티켓 예시.svg의 합성 화면 예시' })).toBeInTheDocument()
  })

  it('수정 초안이 원본 관찰값을 바꾸지 않고 Case 연결은 비활성화된다', () => {
    renderDetail('/app/fan-reports/DEMO-REP-008')
    const field = screen.getByRole('heading', { name: '공연명' }).closest('section')!
    const comparison = screen.getByRole('heading', { name: '예매 정보 대조' }).closest('section')!
    const comparisonBefore = comparison.textContent
    const original = within(field).getByText('2026 Autumn Live')
    expect(within(field).getByRole('textbox', { name: '분석관 수정 초안' })).toHaveValue('')
    fireEvent.change(within(field).getByRole('textbox', { name: '분석관 수정 초안' }), { target: { value: '수정한 공연명' } })
    expect(original).toHaveTextContent('2026 Autumn Live')
    expect(within(field).getByRole('textbox', { name: '분석관 수정 초안' })).toHaveValue('수정한 공연명')
    expect(demoTrack2Data.extractions[0].fields[0].value).toBe('2026 Autumn Live')
    expect(comparison.textContent).toBe(comparisonBefore)
    expect(screen.getByText(/수정 초안은 현재 예매 대조 결과에 반영되지 않으며, 실제 재검증은 수행되지 않았습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Case 생성·연결' })).toBeDisabled()
    expect(screen.getByText('DEMO-RSV-0921')).toBeInTheDocument()
  })

  it('불명확한 추출, 추출 실패와 대조 불가를 확정 결과로 표시하지 않는다', () => {
    const view = renderDetail('/app/fan-reports/DEMO-REP-010')
    expect(screen.getByText('읽기 어려움')).toBeInTheDocument()
    expect(screen.getByText('해석 불명확')).toBeInTheDocument()
    expect(screen.getByText('좌석 열과 번호를 읽기 어려워 후보를 좁힐 수 없습니다.')).toBeInTheDocument()
    view.unmount()
    renderDetail('/app/fan-reports/DEMO-REP-011')
    expect(screen.getByRole('heading', { name: '합성 추출 실패' })).toBeInTheDocument()
    expect(screen.getByText('추출에 실패하여 예매 정보를 대조하지 않았습니다.')).toBeInTheDocument()
    expect(screen.queryByText('합성 예매 후보')).not.toBeInTheDocument()
  })

  it('증거가 없거나 상세 상태가 실패한 경우 안전한 안내를 표시한다', () => {
    const view = renderDetail('/app/fan-reports/DEMO-REP-013')
    expect(screen.getByRole('heading', { name: '첨부된 증거가 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '추출 결과가 없습니다' })).toBeInTheDocument()
    view.rerender(<MemoryRouter initialEntries={['/app/fan-reports/DEMO-REP-008']}><Routes><Route path="/app/fan-reports/:reportId" element={<FanReportDetailPage state="loading" />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('status', { name: '제보 상세를 불러오는 중' })).toBeInTheDocument()
    view.rerender(<MemoryRouter initialEntries={['/app/fan-reports/DEMO-REP-008']}><Routes><Route path="/app/fan-reports/:reportId" element={<FanReportDetailPage state="failed" />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('불러오지 못했습니다')
    view.rerender(<MemoryRouter initialEntries={['/app/fan-reports/DEMO-REP-008']}><Routes><Route path="/app/fan-reports/:reportId" element={<FanReportDetailPage state="forbidden" />} /></Routes></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('접근 권한')
  })
})

describe('공통 테이블 회귀', () => {
  it('Track 1 목록의 가로 스크롤 영역도 키보드 포커스를 받는다', async () => {
    renderApp('/app/analysis/findings')
    expect(await screen.findByRole('heading', { name: '연관 예매 군집' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '합성 연관 예매 군집 목록 가로 스크롤 영역' })).toHaveAttribute('tabindex', '0')
  })
})
