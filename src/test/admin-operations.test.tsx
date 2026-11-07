import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// 운영 메뉴(분석 작업, 감사 기록, 설정)를 Mock 인증 어댑터와 fetch로 검증한다. 실제 Backend HTTP 연동 결과가 아니다.
// 기존 조회 API만 부르고, Backend 계약이 없는 기능은 완료처럼 보이지 않게 계약 대기로 표시하는지 확인한다. 모든 값은 합성 데이터다.

const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const CASE_1 = '55555555-5555-4555-8555-555555555551'
const MEMBER = '66666666-6666-4666-8666-666666666661'
const ACTIVITY_1 = '77777777-7777-4777-8777-777777777771'
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'
const intakePath = (status: string) => `/api/v1/admin/fan-reports?eventId=${EVENT_A}&intakeStatus=${status}&page=0&pageSize=1`
const CASE_LIST_PATH = `/api/v1/cases?eventId=${EVENT_A}&page=0&pageSize=20`
const ACTIVITIES_PATH = `/api/v1/cases/${CASE_1}/activities?page=0&pageSize=20`

function createMockAdapter() {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function renderApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={createMockAdapter()} /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const eventA = { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }
const events = { items: [eventA], page: 0, pageSize: 100, totalItems: 1, hasNext: false }

function intakePage(status: string, totalItems: number, itemStatus = status) {
  const item = { fanReportId: '44444444-4444-4444-8444-444444444441', reportType: 'PREMIUM_RESALE', intakeStatus: itemStatus, receivedAt: '2026-11-01T09:30:00Z', submittedPerformanceAt: '2026-12-01T10:00:00Z', evidenceCount: 1, storedEvidenceCount: 1 }
  return { event: eventA, items: totalItems > 0 ? [item] : [], page: 0, pageSize: 1, totalItems, hasNext: totalItems > 1 }
}

const caseView = { caseId: CASE_1, eventId: EVENT_A, type: 'FAN_REPORT', status: 'IN_REVIEW', caseVersion: 2, evidenceRevision: 1, createdByMembershipId: MEMBER, assigneeMembershipId: null, relatedCaseId: null, relationReason: null, classification: null, currentReportVersionId: null, createdAt: '2026-11-06T01:00:00Z', updatedAt: '2026-11-06T01:00:00Z' }
const activity = { activityId: ACTIVITY_1, eventType: 'CASE_OPENED', actorMembershipId: MEMBER, actorRole: 'REVIEWER', reason: '합성 생성 사유', fromStatus: null, toStatus: 'OPEN', versionBefore: null, versionAfter: 1, evidenceRevision: 1, sourceReferenceId: null, previousAssigneeMembershipId: null, newAssigneeMembershipId: null, occurredAt: '2026-11-01T09:30:00Z' }

type Handler = () => Response
function stubFetch(routes: Record<string, Handler>) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    urls.push(path)
    const handler = { [EVENTS_PATH]: () => json(200, events), ...routes }[path]
    return handler ? handler() : json(404, { status: 404, code: 'NOT_FOUND' })
  }))
  return urls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('업무 중심 관리자 메뉴', () => {
  it('업무 시작, 조사, 검토, 운영 그룹으로 기존 주소를 유지하고 접수 완료 바로가기는 서버 필터로 이동한다', async () => {
    stubFetch({})
    renderApp(`/app/fan-reports?eventId=${EVENT_A}&intakeStatus=RECEIVED`)
    const nav = await screen.findByRole('navigation', { name: '관리자 탐색' })
    for (const group of ['업무 시작', '조사', '검토', '운영']) expect(within(nav).getByText(group)).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: '팬 제보 조사' })).toHaveAttribute('href', '/app/fan-reports')
    expect(within(nav).getByRole('link', { name: '예매 관계 분석' })).toHaveAttribute('href', '/app/analysis/findings')
    expect(within(nav).getByRole('link', { name: '조사 사건' })).toHaveAttribute('href', '/app/cases')
    const shortcut = within(nav).getByRole('link', { name: '접수 완료된 제보' })
    expect(shortcut).toHaveAttribute('href', '/app/fan-reports?intakeStatus=RECEIVED')
    expect(shortcut).toHaveAttribute('aria-current', 'page')
    // 서버 지원이 일부인 메뉴는 표시를 붙여 완료 기능처럼 보이지 않게 한다.
    expect(within(nav).getByRole('link', { name: /^감사 기록/ })).toHaveTextContent('일부 지원')
  })
})

describe('운영 메뉴 실제 조회', () => {
  it('분석 작업은 공연별 접수 상태 건수를 상태마다 한 번씩만 조회하고 공연 단위 작업 목록은 계약 대기로 표시한다', async () => {
    const urls = stubFetch({
      [intakePath('ANALYSIS_FAILED')]: () => json(200, intakePage('ANALYSIS_FAILED', 3)),
      [intakePath('ANALYSIS_PENDING')]: () => json(200, intakePage('ANALYSIS_PENDING', 0)),
      [intakePath('STORAGE_FAILED')]: () => json(403, { status: 403, code: 'FORBIDDEN' }),
    })
    renderApp(`/app/analysis/jobs?eventId=${EVENT_A}`)
    const failed = await screen.findByRole('region', { name: '접수 상태 분석 실패 기록' })
    expect(await within(failed).findByText('3건')).toBeInTheDocument()
    expect(within(failed).getByRole('link', { name: '해당 제보 목록 열기' })).toHaveAttribute('href', `/app/fan-reports?eventId=${EVENT_A}&intakeStatus=ANALYSIS_FAILED`)
    expect(await within(screen.getByRole('region', { name: '접수 상태 분석 대기' })).findByText('0건')).toBeInTheDocument()
    // 권한 부족은 0건으로 바꾸지 않는다.
    const storage = screen.getByRole('region', { name: '접수 상태 접수 실패 (증거 저장 실패)' })
    expect(await within(storage).findByText('이 영역에 필요한 역할이 없습니다')).toBeInTheDocument()
    expect(within(storage).queryByText(/건$/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '공연 단위 분석 작업 목록 (Backend 계약 대기)' })).toHaveTextContent('완료된 기능이 아닙니다')
    await waitFor(() => expect(urls.filter((url) => url.startsWith('/api/v1/admin/fan-reports'))).toHaveLength(3))
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('다른 접수 상태가 섞인 건수 응답은 계약 위반으로 처리하고 건수를 표시하지 않는다', async () => {
    stubFetch({
      [intakePath('ANALYSIS_FAILED')]: () => json(200, intakePage('ANALYSIS_FAILED', 2, 'RECEIVED')),
      [intakePath('ANALYSIS_PENDING')]: () => json(200, intakePage('ANALYSIS_PENDING', 0)),
      [intakePath('STORAGE_FAILED')]: () => json(200, intakePage('STORAGE_FAILED', 0)),
    })
    renderApp(`/app/analysis/jobs?eventId=${EVENT_A}`)
    const failed = await screen.findByRole('region', { name: '접수 상태 분석 실패 기록' })
    expect(await within(failed).findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(within(failed).queryByText('2건')).not.toBeInTheDocument()
  })

  it('감사 기록은 선택한 조사 사건의 활동 기록만 조회하고 고객사 전체 로그는 계약 대기로 표시한다', async () => {
    const urls = stubFetch({
      [CASE_LIST_PATH]: () => json(200, { items: [caseView], page: 0, pageSize: 20, hasNext: false }),
      [ACTIVITIES_PATH]: () => json(200, { items: [activity], page: 0, pageSize: 20, hasNext: false }),
    })
    renderApp(`/app/audit?eventId=${EVENT_A}`)
    expect(await screen.findByRole('heading', { name: '조사 사건을 선택해 주세요' })).toBeInTheDocument()
    expect(urls).not.toContain(ACTIVITIES_PATH)
    fireEvent.click(await screen.findByRole('button', { name: `${CASE_1} 활동 기록 보기` }))
    expect(await screen.findByText('합성 생성 사유')).toBeInTheDocument()
    expect(urls.filter((url) => url === ACTIVITIES_PATH)).toHaveLength(1)
    expect(screen.getByRole('link', { name: '이 조사 사건 열기' })).toHaveAttribute('href', `/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(screen.getByRole('region', { name: '고객사 전체 감사 로그 (Backend 계약 대기)' })).toBeInTheDocument()
  })

  it('설정은 서버가 준 접근 가능 공연만 보여 주고 역할과 서버 설정은 추정하지 않는다', async () => {
    stubFetch({})
    renderApp('/app/settings')
    const scope = await screen.findByRole('region', { name: '접근 가능한 공연' })
    expect(await within(scope).findByText('합성 공연 A')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '고객사 설정과 내 역할 조회 (Backend 계약 대기)' })).toHaveTextContent('표시하지 않습니다')
    expect(screen.queryByText(/^(고객사 관리자|분석 담당|검토 담당|승인 담당)입니다/)).not.toBeInTheDocument()
  })
})
