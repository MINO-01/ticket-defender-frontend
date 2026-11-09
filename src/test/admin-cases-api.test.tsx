import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import {
  caseActivitiesPath, caseActivityPageSchema, caseDetailPath, caseDetailRoute, caseListPath, caseListRoute, casePageSchema, caseSourceListSchema, caseSourcesPath,
  caseViewSchema, readCaseId, readCaseStatusParam,
} from '../features/admin-cases/caseApi'

// Mock 인증 어댑터와 fetch로 관리자 Case 조회 API 연동 계약을 검증한다.
// 응답 형식은 Backend main 17c832b의 CaseController, CaseDto(View, Page, Source, Activity, Activities) 직렬화 형식을 따른다.
// 실제 Keycloak과 Spring HTTP 연동은 이 테스트로 대체하지 않는다. 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_A = '33333333-3333-4333-8333-333333333333'
const EVENT_B = '44444444-4444-4444-8444-444444444444'
const CASE_1 = '11111111-1111-4111-8111-111111111111'
const CASE_2 = '11111111-1111-4111-8111-111111111112'
const MEMBER_CREATOR = '22222222-2222-4222-8222-222222222221'
const MEMBER_ASSIGNEE = '22222222-2222-4222-8222-222222222222'
const REPORT_1 = '55555555-5555-4555-8555-555555555551'
const EVIDENCE_1 = '66666666-6666-4666-8666-666666666661'
const SOURCE_CLUSTER = '77777777-7777-4777-8777-777777777771'
const SOURCE_REPORT = '77777777-7777-4777-8777-777777777772'
const SOURCE_ASSET = '77777777-7777-4777-8777-777777777773'
const ACTIVITY_1 = '88888888-8888-4888-8888-888888888881'
const ACTIVITY_2 = '88888888-8888-4888-8888-888888888882'
const EVENTS_PATH = '/api/v1/admin/events?page=0&pageSize=100'

function createMockAdapter(token: string | null = SYNTHETIC_TOKEN) {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => token === null ? null : { value: token, expiresAt: Date.now() + 600_000 }),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function TestNavigator() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(`/app/cases/${CASE_2}?eventId=${EVENT_A}`)}>테스트 Case 2로 이동</button>
}

function renderApp(path: string, adapter = createMockAdapter()) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={adapter} /><LocationProbe /><TestNavigator /></MemoryRouter>)
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Backend ProblemDetail 형식이다. 계약에 없는 detail에 내부 정보가 섞여 와도 노출하지 않는지 확인한다.
function problem(status: number, code: string) {
  return new Response(JSON.stringify({ title: 'Problem', status, instance: '/api/v1/cases', code, requestId: '00000000-0000-4000-8000-000000000000', detail: '내부 고객사 정보 SQLSTATE' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

const eventA = { id: EVENT_A, externalEventId: 'synthetic-a', name: '합성 공연 A' }
const eventB = { id: EVENT_B, externalEventId: 'synthetic-b', name: '합성 공연 B' }
const eventPage = (items = [eventA, eventB]) => ({ items, page: 0, pageSize: 100, totalItems: items.length, hasNext: false })

// CaseDto.View는 OffsetDateTime(UTC 오프셋)으로 직렬화된다. null 필드도 생략하지 않고 null로 내려온다.
function caseView(overrides: Record<string, unknown> = {}) {
  return {
    caseId: CASE_1, eventId: EVENT_A, type: 'COMBINED', status: 'IN_REVIEW', caseVersion: 3, evidenceRevision: 1,
    createdByMembershipId: MEMBER_CREATOR, assigneeMembershipId: MEMBER_ASSIGNEE, relatedCaseId: null, relationReason: null,
    classification: '합성 분류', currentReportVersionId: null, createdAt: '2026-11-01T09:30:00Z', updatedAt: '2026-11-02T10:15:00Z', ...overrides,
  }
}

const casePage = (items: unknown[] = [caseView()], extra: Record<string, unknown> = {}) => ({ items, page: 0, pageSize: 20, hasNext: false, ...extra })

function listPath(eventId: string, page = 0, status?: string) {
  return `/api/v1/cases?eventId=${eventId}&page=${page}&pageSize=20${status ? `&status=${status}` : ''}`
}
const detailPath = (id = CASE_1) => `/api/v1/cases/${id}`
const sourcesPath = (id = CASE_1) => `/api/v1/cases/${id}/sources`
const activitiesPath = (id = CASE_1, page = 0) => `/api/v1/cases/${id}/activities?page=${page}&pageSize=20`
const snapshotsPath = (id = CASE_1, page = 0) => `/api/v1/cases/${id}/evidence-snapshots?page=${page}&pageSize=20`
const reportVersionsPath = (id = CASE_1, page = 0) => `/api/v1/cases/${id}/report-versions?page=${page}&pageSize=20`
const workflowPath = (id = CASE_1) => `/api/v1/cases/${id}/workflow`
const linksPath = (id = CASE_1) => `/api/v1/cases/${id}/track1-candidate-links`
const approvalAuditPath = (id = CASE_1, page = 0) => `/api/v1/cases/${id}/approval-audit-events?page=${page}&pageSize=20`
const REPORT_VERSION_1 = '77777777-7777-4777-8777-777777777771'
const SNAPSHOT_1 = '77777777-7777-4777-8777-777777777772'
const APPROVAL_REQUEST_1 = '88888888-8888-4888-8888-888888888881'
const APPROVAL_DECISION_1 = '88888888-8888-4888-8888-888888888882'
const APPROVAL_AUDIT_1 = '88888888-8888-4888-8888-888888888883'

/** 연결 기록이 없는 조사 사건의 workflow 응답이다. report, approval, officialPdf는 null이다. */
function workflowView(overrides: Record<string, unknown> = {}) {
  return { investigation: caseView(), nextStep: { code: 'EVIDENCE_AND_REPORT_PREPARATION', description: '합성 다음 단계 설명' }, report: null, approval: null, officialPdf: null, ...overrides }
}

const clusterSource = {
  sourceReferenceId: SOURCE_CLUSTER, sourceType: 'STORED_CLUSTER_EVIDENCE', analysisRequestId: 'synthetic-run/2026-11', clusterId: 'cluster-7',
  storedMemberCount: 4, analysisAlgorithm: 'louvain', analysisAlgorithmVersion: '1.2', analysisCompletedAt: '2026-10-31T23:00:00Z', riskScore: 0.42,
  fanReportId: null, evidenceId: null, linkedAt: '2026-11-01T09:30:00Z',
}
const reportSource = {
  sourceReferenceId: SOURCE_REPORT, sourceType: 'FAN_REPORT', analysisRequestId: null, clusterId: null, storedMemberCount: null,
  analysisAlgorithm: null, analysisAlgorithmVersion: null, analysisCompletedAt: null, riskScore: null, fanReportId: REPORT_1, evidenceId: null, linkedAt: '2026-11-01T09:30:00Z',
}
const assetSource = { ...reportSource, sourceReferenceId: SOURCE_ASSET, sourceType: 'EVIDENCE_ASSET', evidenceId: EVIDENCE_1 }

function activity(overrides: Record<string, unknown> = {}) {
  return {
    activityId: ACTIVITY_1, eventType: 'CASE_OPENED', actorMembershipId: MEMBER_CREATOR, actorRole: 'REVIEWER', reason: '<b>합성 생성 사유</b>',
    fromStatus: null, toStatus: 'OPEN', versionBefore: null, versionAfter: 1, evidenceRevision: 1, sourceReferenceId: null,
    previousAssigneeMembershipId: null, newAssigneeMembershipId: null, occurredAt: '2026-11-01T09:30:00Z', ...overrides,
  }
}
const activityPage = (items: unknown[] = [activity()], extra: Record<string, unknown> = {}) => ({ items, page: 0, pageSize: 20, hasNext: false, ...extra })

type Route = (url: string) => Response | Promise<Response> | undefined
function stubFetch(route: Route) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const response = await route(url)
    if (!response) throw new Error(`예상하지 못한 요청: ${url}`)
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const requestedUrls = (fetchMock: ReturnType<typeof stubFetch>) => fetchMock.mock.calls.map(([url]) => String(url))

/** 상세, 출처, 활동 이력 기본 응답 라우터다. */
function detailRoute(overrides: Partial<Record<string, () => Response | Promise<Response>>> = {}): Route {
  const defaults: Record<string, () => Response | Promise<Response>> = {
    [detailPath()]: () => json(200, caseView()),
    [sourcesPath()]: () => json(200, [clusterSource, reportSource, assetSource]),
    [snapshotsPath()]: () => json(200, { items: [], page: 0, pageSize: 20, hasNext: false }),
    [reportVersionsPath()]: () => json(200, { items: [], page: 0, pageSize: 20, hasNext: false }),
    [workflowPath()]: () => json(200, workflowView()),
    [linksPath()]: () => json(200, { status: 'NOT_APPLICABLE', items: [] }),
    [approvalAuditPath()]: () => json(200, { items: [], page: 0, pageSize: 20, hasNext: false }),
    [activitiesPath()]: () => json(200, activityPage([
      activity(),
      activity({ activityId: ACTIVITY_2, eventType: 'CASE_TRIAGED', reason: '합성 분류 사유', fromStatus: 'OPEN', toStatus: 'TRIAGED', versionBefore: 1, versionAfter: 2, occurredAt: '2026-11-01T11:00:00Z' }),
    ])),
  }
  const routes = { ...defaults, ...overrides }
  return (url) => routes[url]?.()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Case 조회 API 계약', () => {
  it('Backend 경로와 쿼리를 서버 계약대로 만들고 화면 주소를 구성한다', () => {
    expect(caseListPath(EVENT_A, 0, null)).toBe(listPath(EVENT_A))
    expect(caseListPath(EVENT_A, 2, 'NEEDS_EVIDENCE')).toBe(listPath(EVENT_A, 2, 'NEEDS_EVIDENCE'))
    expect(caseDetailPath(CASE_1)).toBe(detailPath())
    expect(caseSourcesPath(CASE_1)).toBe(sourcesPath())
    expect(caseActivitiesPath(CASE_1, 3)).toBe(activitiesPath(CASE_1, 3))
    expect(caseListRoute(EVENT_A)).toBe(`/app/cases?eventId=${EVENT_A}`)
    expect(caseDetailRoute(CASE_1, EVENT_A)).toBe(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(readCaseId(CASE_1.toUpperCase())).toBe(CASE_1)
    expect(readCaseId('DEMO-CASE-001')).toBeNull()
    expect(readCaseId('../events')).toBeNull()
    expect(readCaseStatusParam('CLOSED')).toBe('CLOSED')
    expect(readCaseStatusParam('MATCH_CANDIDATE')).toBeNull()
  })

  it('Case 응답의 필수 필드, 상태 값, 관계 사유 조합을 검증한다', () => {
    expect(caseViewSchema.safeParse(caseView()).success).toBe(true)
    expect(caseViewSchema.safeParse(caseView({ status: 'CLOSED', assigneeMembershipId: null, classification: null })).success).toBe(true)
    expect(caseViewSchema.safeParse(caseView({ relatedCaseId: CASE_2, relationReason: '합성 후속 사유' })).success).toBe(true)
    expect(caseViewSchema.safeParse(caseView({ relatedCaseId: CASE_2 })).success).toBe(false)
    expect(caseViewSchema.safeParse(caseView({ status: 'CONFIRMED_FRAUD' })).success).toBe(false)
    expect(caseViewSchema.safeParse(caseView({ caseId: 'DEMO-CASE-001' })).success).toBe(false)
    expect(caseViewSchema.safeParse(caseView({ evidenceRevision: undefined })).success).toBe(false)
    expect(caseViewSchema.safeParse(caseView({ createdAt: '2026-11-03T00:00:00Z' })).success).toBe(false)
    // 서버가 주지 않는 전체 건수 없이도 목록 계약을 받아들인다.
    expect(casePageSchema.safeParse(casePage()).success).toBe(true)
    expect(casePageSchema.safeParse({ items: [], page: 0, pageSize: 20 }).success).toBe(false)
  })

  it('출처 유형별로 허용된 필드 조합만 받아들인다', () => {
    expect(caseSourceListSchema.safeParse([clusterSource, reportSource, assetSource]).success).toBe(true)
    expect(caseSourceListSchema.safeParse([{ ...clusterSource, riskScore: null, analysisAlgorithm: null, analysisCompletedAt: null }]).success).toBe(true)
    expect(caseSourceListSchema.safeParse([{ ...clusterSource, fanReportId: REPORT_1 }]).success).toBe(false)
    expect(caseSourceListSchema.safeParse([{ ...clusterSource, clusterId: null }]).success).toBe(false)
    expect(caseSourceListSchema.safeParse([{ ...reportSource, fanReportId: null }]).success).toBe(false)
    expect(caseSourceListSchema.safeParse([{ ...reportSource, evidenceId: EVIDENCE_1 }]).success).toBe(false)
    expect(caseSourceListSchema.safeParse([{ ...assetSource, evidenceId: null }]).success).toBe(false)
    expect(caseSourceListSchema.safeParse([{ ...assetSource, riskScore: 0.9 }]).success).toBe(false)
    expect(caseSourceListSchema.safeParse([{ ...clusterSource, sourceType: 'MATCH_CANDIDATE' }]).success).toBe(false)
  })

  it('활동 이력의 필수 필드와 상태, 버전 값을 검증한다', () => {
    expect(caseActivityPageSchema.safeParse(activityPage()).success).toBe(true)
    expect(caseActivityPageSchema.safeParse(activityPage([activity({ occurredAt: undefined })])).success).toBe(false)
    expect(caseActivityPageSchema.safeParse(activityPage([activity({ toStatus: 'CONFIRMED' })])).success).toBe(false)
    expect(caseActivityPageSchema.safeParse(activityPage([activity({ versionAfter: null })])).success).toBe(false)
    expect(caseActivityPageSchema.safeParse(activityPage([activity({ actorMembershipId: null })])).success).toBe(false)
  })
})

describe('Case 목록 실제 API', () => {
  it('공연을 고르기 전에는 Case 목록을 조회하지 않는다', async () => {
    const fetchMock = stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage()) : undefined)
    renderApp('/app/cases')
    expect(await screen.findByRole('heading', { name: '공연을 선택해 주세요' })).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH])
  })

  it('인증 전에는 공연과 Case API를 호출하지 않는다', async () => {
    const fetchMock = stubFetch(() => undefined)
    renderApp(`/app/cases/${CASE_1}`, createMockAdapter(null))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('선택한 공연의 서버 목록만 Bearer 토큰으로 조회하고 실제 필드와 상세 링크를 표시하며 데모 데이터를 섞지 않는다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, casePage([caseView(), caseView({ caseId: CASE_2, type: 'FAN_REPORT', status: 'OPEN', assigneeMembershipId: null, caseVersion: 1 })]))
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}`)
    const table = await screen.findByRole('table')
    expect(within(table).getByText(CASE_1)).toBeInTheDocument()
    expect(within(table).getByText('복합 검토')).toBeInTheDocument()
    expect(within(table).getByText('검토 중')).toBeInTheDocument()
    expect(within(table).getByText('팬 제보')).toBeInTheDocument()
    expect(within(table).getByText('미지정')).toBeInTheDocument()
    expect(within(table).getAllByText('2026-11-01 09:30 UTC')).toHaveLength(2)
    expect(within(table).getByRole('link', { name: `${CASE_1} 상세 보기` })).toHaveAttribute('href', `/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    // 서버가 지원하지 않는 검색, 담당자 필터, 정렬, 합성 통계와 전체 건수를 표시하지 않는다.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '담당자' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '정렬' })).not.toBeInTheDocument()
    expect(screen.queryByText(/검색 결과|조사 우선순위|전체 \d+건|\/ \d+ 페이지/)).not.toBeInTheDocument()
    expect(screen.queryByText(/DEMO-|합성 데모 데이터|시연 담당/)).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, listPath(EVENT_A)])
    for (const [url, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
      expect(String(url)).not.toMatch(/tenant|role/i)
    }
  })

  it('주소의 공연, 상태, 페이지로 서버를 조회하고 hasNext로만 이동하며 상태와 공연 변경 시 첫 페이지로 돌아간다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A, 1, 'IN_REVIEW')) return json(200, casePage([caseView()], { page: 1, hasNext: true }))
      if (url === listPath(EVENT_A, 2, 'IN_REVIEW')) return json(200, casePage([caseView({ caseId: CASE_2 })], { page: 2, hasNext: false }))
      if (url === listPath(EVENT_A, 0, 'OPEN')) return json(200, casePage([caseView({ caseId: CASE_2, status: 'OPEN' })]))
      if (url === listPath(EVENT_B, 0, 'OPEN')) return json(200, casePage([]))
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}&status=IN_REVIEW&page=1`)
    expect(await screen.findByText(CASE_1)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '조사 상태' })).toHaveValue('IN_REVIEW')
    expect(screen.getByText('2 페이지')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이전' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('3 페이지')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
    expect(screen.getByTestId('location')).toHaveTextContent(`eventId=${EVENT_A}&status=IN_REVIEW&page=2`)

    fireEvent.change(screen.getByRole('combobox', { name: '조사 상태' }), { target: { value: 'OPEN' } })
    expect(await screen.findByText('1 페이지')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('status=OPEN&page=0')
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()

    fireEvent.change(screen.getByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_B } })
    expect(await screen.findByRole('heading', { name: '조건에 맞는 Case가 없습니다' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=')
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, listPath(EVENT_A, 1, 'IN_REVIEW'), listPath(EVENT_A, 2, 'IN_REVIEW'), listPath(EVENT_A, 0, 'OPEN'), listPath(EVENT_B, 0, 'OPEN')])
  })

  it('알 수 없는 상태 값은 서버에 전달하지 않는다', async () => {
    const fetchMock = stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, casePage())
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}&status=CONFIRMED_FRAUD&page=-1`)
    expect(await screen.findByText(CASE_1)).toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([EVENTS_PATH, listPath(EVENT_A)])
  })

  it('첫 페이지가 비면 오류가 아닌 빈 상태를, 범위를 벗어난 페이지는 첫 페이지 이동을 안내한다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, casePage([]))
      if (url === listPath(EVENT_A, 4)) return json(200, casePage([], { page: 4 }))
      return undefined
    })
    const view = renderApp(`/app/cases?eventId=${EVENT_A}`)
    expect(await screen.findByRole('heading', { name: '조건에 맞는 Case가 없습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    view.unmount()
    renderApp(`/app/cases?eventId=${EVENT_A}&page=4`)
    expect(await screen.findByRole('heading', { name: '이 페이지에 표시할 Case가 없습니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '첫 페이지로 이동' }))
    expect(await screen.findByRole('heading', { name: '조건에 맞는 Case가 없습니다' })).toBeInTheDocument()
  })

  it.each([
    ['요청과 다른 페이지', casePage([caseView()], { page: 3 })],
    ['다른 공연의 Case', casePage([caseView(), caseView({ caseId: CASE_2, eventId: EVENT_B })])],
    ['요청과 다른 페이지 크기', casePage([caseView()], { pageSize: 50 })],
    ['필수 필드가 빠진 응답', casePage([{ ...caseView(), caseVersion: undefined }])],
  ])('%s 응답은 성공으로 표시하지 않는다', async (_, body) => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return json(200, body)
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(CASE_2)).not.toBeInTheDocument()
  })

  it('상태 필터와 다른 상태의 Case가 섞이면 성공으로 표시하지 않는다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A, 0, 'OPEN')) return json(200, casePage([caseView({ status: 'IN_REVIEW' })]))
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}&status=OPEN`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it.each([
    [403, 'FORBIDDEN', '이 화면에 필요한 역할이 없습니다'],
    [404, 'RESOURCE_NOT_FOUND', '공연을 찾을 수 없거나 접근 범위 밖입니다'],
    [409, 'TENANT_SELECTION_REQUIRED', '여러 고객사 소속 계정은 아직 지원하지 않습니다'],
    [503, 'DEPENDENCY_UNAVAILABLE', '서버가 일시적으로 응답할 수 없습니다'],
  ])('목록 %i 응답은 빈 목록이 아닌 오류로 표시하고 내부 상세를 노출하지 않는다', async (status, code, title) => {
    let calls = 0
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) { calls += 1; return calls === 1 ? problem(status, code) : json(200, casePage()) }
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(title)
    expect(screen.queryByText(/조건에 맞는 Case가 없습니다/)).not.toBeInTheDocument()
    expect(screen.queryByText(/SQLSTATE|내부 고객사/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText(CASE_1)).toBeInTheDocument()
  })

  it('목록 401 응답은 세션 만료로 처리하고 로컬 세션을 정리한다', async () => {
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return problem(401, 'UNAUTHENTICATED')
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}`)
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(SYNTHETIC_TOKEN)
    expect(screen.queryByText(CASE_1)).not.toBeInTheDocument()
    expect(screen.queryByText(/조건에 맞는 Case가 없습니다/)).not.toBeInTheDocument()
  })

  it('공연을 바꾸면 늦게 도착한 이전 공연 응답을 표시하지 않는다', async () => {
    const lateA = deferred()
    stubFetch((url) => {
      if (url === EVENTS_PATH) return json(200, eventPage())
      if (url === listPath(EVENT_A)) return lateA.promise
      if (url === listPath(EVENT_B)) return json(200, casePage([caseView({ caseId: CASE_2, eventId: EVENT_B })]))
      return undefined
    })
    renderApp(`/app/cases?eventId=${EVENT_A}`)
    expect(await screen.findByRole('status', { name: 'Case 목록을 불러오는 중' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '조회할 공연' }), { target: { value: EVENT_B } })
    expect(await screen.findByText(CASE_2)).toBeInTheDocument()
    lateA.resolve(json(200, casePage([caseView()])))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText(CASE_1)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: `${CASE_2} 상세 보기` })).toHaveAttribute('href', `/app/cases/${CASE_2}?eventId=${EVENT_B}`)
  })
})

describe('Case 상세 Track 1 연결 비교 실제 API', () => {
  const RUN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  const CANDIDATE_SOURCE = '77777777-7777-4777-8777-777777777774'
  const seats = [
    { auditId: 123, status: 'FOUND', zone: 'A', row: '1', seat: '2' },
    { auditId: 124, status: 'NOT_IN_LEDGER', zone: null, row: null, seat: null },
    { auditId: 125, status: 'LEDGER_UNAVAILABLE', zone: null, row: null, seat: null },
  ]
  const item = (status: string, ledgerSeats: unknown[] = seats) => ({ graphSourceId: SOURCE_CLUSTER, candidateSourceId: CANDIDATE_SOURCE, candidateRunId: RUN, status, ledgerSeats })
  const route = `/app/cases/${CASE_1}?eventId=${EVENT_A}`
  const region = () => screen.findByRole('region', { name: 'Track 1 연결 비교' })
  const open = (respond: () => Response | Promise<Response>) => {
    stubFetch((url) => url === EVENTS_PATH ? json(200, eventPage()) : detailRoute({ [linksPath()]: respond })(url))
    renderApp(route)
  }

  it.each([
    ['LINKED', '팬 제보의 예매 후보와 Track 1에 저장된 예매 기록이 연결됩니다.'],
    ['NO_TRACK1_LINK', '현재 연결된 Track 1 출처에는 동일한 예매 기록이 없습니다.'],
    ['NOT_APPLICABLE', '현재 사건의 출처 조합에는 연결 비교를 적용할 수 없습니다.'],
    ['LEDGER_UNAVAILABLE', '현재 원장 또는 비교 근거를 확인할 수 없습니다.'],
  ])('%s 상태 문구를 표시하고 Case 생성 이후 조회임을 밝힌다', async (status, message) => {
    open(() => json(200, { status, items: [item(status)] }))
    const panel = await region()
    expect(await within(panel).findAllByText(message)).toHaveLength(2)
    expect(within(panel).getByRole('note')).toHaveTextContent('Case 생성 이전의 연결 여부를 확인한 것이 아닙니다')
    expect(within(panel).getByText('Case 생성 이후 조회')).toBeInTheDocument()
  })

  it('원장 좌석 3개 상태를 구분하고 출처 참조를 표시하며 FOUND가 아닌 값과 계약 밖 필드는 표시하지 않는다', async () => {
    const leaked = [{ ...seats[0], reservationNo: 'SYN-LEAK-RESERVATION', hmac: 'SYN-LEAK-HMAC' }, { ...seats[1], zone: 'SYN-LEAK-ZONE' }, seats[2]]
    open(() => json(200, { status: 'LINKED', items: [item('LINKED', leaked)] }))
    const article = await within(await region()).findByRole('article', { name: `연결 비교 ${RUN}` })
    expect(article).toHaveTextContent(SOURCE_CLUSTER)
    expect(article).toHaveTextContent(CANDIDATE_SOURCE)
    const rows = within(article).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('저장 기록 123')
    expect(rows[0]).toHaveTextContent('원장 좌석 확인 (FOUND)')
    expect(rows[0]).toHaveTextContent('구역 A, 열 1, 좌석 2')
    expect(rows[1]).toHaveTextContent('원장에 없음 (NOT_IN_LEDGER)')
    expect(rows[2]).toHaveTextContent('원장 확인 불가 (LEDGER_UNAVAILABLE)')
    expect(screen.queryByText(/SYN-LEAK/)).not.toBeInTheDocument()
  })

  it('비교 항목이 없으면 정상 0건으로 표시하지 않는다', async () => {
    open(() => json(200, { status: 'NOT_APPLICABLE', items: [] }))
    const panel = await region()
    expect(await within(panel).findByText(/정상적으로 0건이라는 뜻이 아닙니다/)).toBeInTheDocument()
  })

  it.each([
    ['404', () => new Response(null, { status: 404 }), 'Case를 찾을 수 없거나 접근 범위 밖입니다'],
    ['403', () => new Response(null, { status: 403 }), '이 화면에 필요한 역할이 없습니다'],
    ['500', () => problem(500, 'INTERNAL_ERROR'), '서버 오류로 조회하지 못했습니다'],
    ['계약 밖 상태', () => json(200, { status: 'MAYBE_LINKED', items: [] }), '서버 응답 형식이 계약과 다릅니다'],
  ])('%s 실패는 연결 없음으로 바꾸지 않고 이 영역에만 표시한다', async (_label, respond, message) => {
    open(respond)
    const panel = await region()
    expect(await within(panel).findByRole('alert')).toHaveTextContent(message)
    expect(within(panel).queryByRole('status')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/동일한 예매 기록이 없습니다/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '조사 사건 상세' })).toBeInTheDocument()
  })
})

describe('Case 상세, 출처, 활동 이력 실제 API', () => {
  it('업무 연결이 없으면 각 기록을 없음으로 표시하고 다음 단계는 안내로만 보여 준다', async () => {
    stubFetch(detailRoute())
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    const panel = await screen.findByRole('region', { name: '업무 연결' })
    expect(await within(panel).findByText('저장된 초안 없음')).toBeInTheDocument()
    expect(within(panel).getByText('승인 요청 없음')).toBeInTheDocument()
    expect(within(panel).getByText('결정 기록 없음')).toBeInTheDocument()
    expect(within(panel).getByText('발급 기록 없음')).toBeInTheDocument()
    expect(within(panel).getByRole('heading', { name: '다음 단계: 조사 근거 묶음과 보고서 초안 준비' })).toBeInTheDocument()
    expect(within(panel).getByText('합성 다음 단계 설명')).toBeInTheDocument()
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument()
  })

  it('업무 연결의 승인 요청과 승인 결정은 기존 상세와 발급 화면 주소로 연결하고 발급 가능 여부는 추정하지 않는다', async () => {
    stubFetch(detailRoute({
      [detailPath()]: () => json(200, caseView({ status: 'APPROVED_FOR_REPORT' })),
      [workflowPath()]: () => json(200, workflowView({
        investigation: caseView({ status: 'APPROVED_FOR_REPORT' }),
        nextStep: { code: 'OFFICIAL_PDF_POLICY_GATE', description: '합성 발급 게이트 안내' },
        report: { reportVersionId: REPORT_VERSION_1, evidenceSnapshotId: SNAPSHOT_1, evidenceRevision: 2, revision: 1, version: 3, status: 'APPROVED' },
        approval: { approvalRequestId: APPROVAL_REQUEST_1, requestStatus: 'APPROVED', approvalDecisionId: APPROVAL_DECISION_1, decisionOutcome: 'APPROVE', decidedAt: '2026-11-07T10:00:00Z' },
      })),
      [approvalAuditPath()]: () => json(200, { items: [{
        approvalAuditEventId: APPROVAL_AUDIT_1, approvalRequestId: APPROVAL_REQUEST_1, approvalDecisionId: APPROVAL_DECISION_1, reportVersionId: REPORT_VERSION_1,
        evidenceSnapshotId: SNAPSHOT_1, actorMembershipId: MEMBER_ASSIGNEE, eventType: 'APPROVAL_DECIDED', fromStatus: 'PENDING', toStatus: 'APPROVED',
        evidenceRevision: 2, caseVersionBefore: 5, caseVersionAfter: 6, reason: '<b>합성 결정 사유</b>', occurredAt: '2026-11-07T10:00:00Z',
      }], page: 0, pageSize: 20, hasNext: false }),
    }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    const panel = await screen.findByRole('region', { name: '업무 연결' })
    expect(await within(panel).findByRole('link', { name: '승인 요청 열기' })).toHaveAttribute('href', `/app/approvals/${APPROVAL_REQUEST_1}`)
    expect(within(panel).getByRole('link', { name: '공식 PDF 발급 화면 열기' })).toHaveAttribute('href', `/app/report-center/decisions/${APPROVAL_DECISION_1}`)
    expect(within(panel).getByText('발급 기록 없음')).toBeInTheDocument()
    expect(panel).toHaveTextContent('승인 결정만으로 발급되지 않습니다')
    expect(panel).not.toHaveTextContent('발급 가능 (CURRENT)')
    const audit = screen.getByRole('region', { name: '승인 감사 이력' })
    expect(await within(audit).findByText('승인 결정 기록')).toBeInTheDocument()
    expect(within(audit).getByText('<b>합성 결정 사유</b>')).toBeInTheDocument()
    expect(audit).toHaveTextContent('둘을 합친 전체 감사 기록이 아닙니다')
    expect(audit).not.toHaveTextContent(/전체 \d+건/)
  })

  it('업무 연결 조회가 실패하거나 다른 사건 응답이면 그 영역만 오류로 표시한다', async () => {
    stubFetch(detailRoute({ [workflowPath()]: () => json(200, workflowView({ investigation: caseView({ caseId: CASE_2 }) })) }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    const panel = await screen.findByRole('region', { name: '업무 연결' })
    expect(await within(panel).findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(within(panel).queryByText('승인 요청 없음')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Case 개요' })).toBeInTheDocument()
  })

  it('상세 필드와 출처 유형별 정보, 서버 순서의 활동 이력을 실제 응답 값으로 표시한다', async () => {
    const fetchMock = stubFetch(detailRoute())
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    const overview = await screen.findByRole('region', { name: 'Case 개요' })
    // 상단 진행 요약은 저장된 상태로 다음 작업만 안내하고 공식 PDF 발급 가능 여부를 추측하지 않는다.
    const guide = screen.getByRole('region', { name: '조사 사건 진행 요약' })
    expect(within(guide).getByRole('region', { name: '확인한 사실' })).toHaveTextContent('현재 상태: 검토 중 (서버 저장 값)')
    expect(within(guide).getByRole('region', { name: '다음 작업' })).toHaveTextContent('조사 근거 묶음을 만들고')
    expect(within(guide).getByRole('region', { name: '아직 확인되지 않은 내용' })).toHaveTextContent('발급 가능 여부는 승인 결정 기준으로 서버가 확인하기 전까지 알 수 없습니다')
    expect(guide).not.toHaveTextContent('발급 가능합니다')
    expect(within(overview).getByText(CASE_1)).toBeInTheDocument()
    expect(within(overview).getByText(EVENT_A)).toBeInTheDocument()
    expect(within(overview).getByText('복합 검토')).toBeInTheDocument()
    expect(within(overview).getByText('검토 중')).toBeInTheDocument()
    expect(within(overview).getByText('Case 버전').nextElementSibling).toHaveTextContent('3')
    expect(within(overview).getByText('증거 개정 번호').nextElementSibling).toHaveTextContent('1')
    expect(within(overview).getByText(MEMBER_ASSIGNEE)).toBeInTheDocument()
    expect(within(overview).getByText('합성 분류')).toBeInTheDocument()
    expect(within(overview).getByText('연관 Case').nextElementSibling).toHaveTextContent('기록 없음')
    expect(within(overview).getByText('현재 보고서 버전').nextElementSibling).toHaveTextContent('기록 없음')

    const sources = await screen.findByRole('region', { name: '연결 출처' })
    const cluster = await within(sources).findByRole('article', { name: 'Track 1 저장 군집 증거' })
    expect(within(cluster).getByText('synthetic-run/2026-11')).toBeInTheDocument()
    expect(within(cluster).getByText('cluster-7')).toBeInTheDocument()
    expect(within(cluster).getByText('4건')).toBeInTheDocument()
    expect(within(cluster).getByText('louvain 1.2')).toBeInTheDocument()
    expect(within(cluster).getByText('0.42')).toBeInTheDocument()
    expect(within(cluster).getByRole('link')).toHaveAttribute('href', `/app/analysis/findings/detail?eventId=${EVENT_A}&analysisRequestId=synthetic-run%2F2026-11&clusterId=cluster-7`)
    const report = within(sources).getByRole('article', { name: 'Track 2 팬 제보' })
    expect(within(report).getByText(REPORT_1)).toBeInTheDocument()
    expect(within(report).getByRole('link')).toHaveAttribute('href', `/app/fan-reports/${REPORT_1}`)
    const asset = within(sources).getByRole('article', { name: 'Track 2 제보 증거 이미지' })
    expect(within(asset).getByText(EVIDENCE_1)).toBeInTheDocument()
    expect(within(asset).getByRole('link')).toHaveAttribute('href', `/app/fan-reports/${REPORT_1}`)
    // 출처에 없는 추출 상태, 예매 대조, 판정 문구를 만들지 않는다.
    expect(within(sources).queryByText(/일치 후보|추출 완료|예매 일치|MATCH_CANDIDATE/)).not.toBeInTheDocument()

    const history = await screen.findByRole('region', { name: '활동 이력' })
    const items = within(history).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Case 생성')
    expect(items[0]).toHaveTextContent('<b>합성 생성 사유</b>')
    expect(items[0]).toHaveTextContent(MEMBER_CREATOR)
    expect(items[1]).toHaveTextContent('분류 완료 처리')
    expect(items[1]).toHaveTextContent('Case 버전 1 → 2')
    expect(within(history).queryByRole('textbox')).not.toBeInTheDocument()

    // 조사 준비 업무는 Issue #31, 승인 요청 제출은 Issue #33에서 연결했고 공식 PDF 발급은 계속 막는다.
    expect(screen.getByRole('button', { name: '공식 PDF 발급' })).toBeDisabled()
    expect(screen.getByRole('region', { name: '승인 요청 제출' })).toBeInTheDocument()
    for (const name of ['상태 변경', '담당자 변경', 'EvidenceSnapshot', '보고서 초안']) expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(screen.queryByText(/DEMO-|합성 데모 데이터|시연 담당/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← 조사 사건 목록' })).toHaveAttribute('href', `/app/cases?eventId=${EVENT_A}`)
    expect([...requestedUrls(fetchMock)].sort()).toEqual([detailPath(), workflowPath(), sourcesPath(), sourcesPath(), linksPath(), snapshotsPath(), snapshotsPath(), reportVersionsPath(), reportVersionsPath(), activitiesPath(), approvalAuditPath(), `/api/v1/cases/${CASE_1}/evidence-verifications?page=0&pageSize=20`].sort())
  })

  it.each([
    [404, 'RESOURCE_NOT_FOUND', 'Case를 찾을 수 없거나 접근 범위 밖입니다'],
    [403, 'FORBIDDEN', '이 화면에 필요한 역할이 없습니다'],
    [409, 'TENANT_SELECTION_REQUIRED', '여러 고객사 소속 계정은 아직 지원하지 않습니다'],
    [503, 'DEPENDENCY_UNAVAILABLE', '서버가 일시적으로 응답할 수 없습니다'],
  ])('상세 %i 응답이면 출처와 활동 이력을 요청하거나 표시하지 않는다', async (status, code, title) => {
    const fetchMock = stubFetch(detailRoute({ [detailPath()]: () => problem(status, code) }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent(title)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('region', { name: '연결 출처' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '활동 이력' })).not.toBeInTheDocument()
    expect(screen.queryByText(/SQLSTATE|내부 고객사/)).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([detailPath()])
    expect(screen.getByRole('link', { name: '← 조사 사건 목록' })).toHaveAttribute('href', `/app/cases?eventId=${EVENT_A}`)
  })

  it('주소의 공연과 다른 공연의 Case 응답은 표시하지 않고 출처를 요청하지 않는다', async () => {
    const fetchMock = stubFetch(detailRoute({ [detailPath()]: () => json(200, caseView({ eventId: EVENT_B })) }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('선택한 공연의 Case가 아닙니다')
    expect(screen.queryByText(CASE_1)).not.toBeInTheDocument()
    expect(requestedUrls(fetchMock)).toEqual([detailPath()])
  })

  it('요청과 다른 Case ID 응답은 계약 위반으로 처리한다', async () => {
    const fetchMock = stubFetch(detailRoute({ [detailPath()]: () => json(200, caseView({ caseId: CASE_2 })) }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    expect(requestedUrls(fetchMock)).toEqual([detailPath()])
  })

  it('공연 정보가 없는 직접 주소는 서버 권한 검증 결과로 표시하고 목록 링크는 응답의 공연으로 만든다', async () => {
    const fetchMock = stubFetch(detailRoute())
    renderApp(`/app/cases/${CASE_1}`)
    expect(await screen.findByRole('region', { name: 'Case 개요' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← 조사 사건 목록' })).toHaveAttribute('href', `/app/cases?eventId=${EVENT_A}`)
    await screen.findByRole('region', { name: '활동 이력' })
    await screen.findByText('승인 감사 이력이 없습니다')
    expect([...requestedUrls(fetchMock)].sort()).toEqual([detailPath(), workflowPath(), sourcesPath(), sourcesPath(), linksPath(), snapshotsPath(), snapshotsPath(), reportVersionsPath(), reportVersionsPath(), activitiesPath(), approvalAuditPath(), `/api/v1/cases/${CASE_1}/evidence-verifications?page=0&pageSize=20`].sort())
  })

  it('UUID가 아닌 Case 주소나 잘못된 공연 값은 API를 호출하지 않는다', async () => {
    const fetchMock = stubFetch(() => undefined)
    const view = renderApp('/app/cases/DEMO-CASE-001')
    expect(await screen.findByRole('alert')).toHaveTextContent('Case 주소가 올바르지 않습니다')
    view.unmount()
    renderApp(`/app/cases/${CASE_1}?eventId=not-a-uuid`)
    expect(await screen.findByRole('alert')).toHaveTextContent('Case 주소가 올바르지 않습니다')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('출처나 활동 이력 조회 실패는 상세와 분리해 오류로 표시하고 각각 다시 시도한다', async () => {
    let sourceCalls = 0
    stubFetch(detailRoute({
      [sourcesPath()]: () => { sourceCalls += 1; return sourceCalls === 1 ? problem(503, 'DEPENDENCY_UNAVAILABLE') : json(200, [reportSource]) },
      [activitiesPath()]: () => json(200, { ...activityPage(), items: [{ ...activity(), occurredAt: 'yesterday' }] }),
    }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(await screen.findByRole('region', { name: 'Case 개요' })).toBeInTheDocument()
    const sources = screen.getByRole('region', { name: '연결 출처' })
    expect(await within(sources).findByRole('alert')).toHaveTextContent('서버가 일시적으로 응답할 수 없습니다')
    expect(within(sources).queryByText(/연결된 출처가 없습니다/)).not.toBeInTheDocument()
    const history = screen.getByRole('region', { name: '활동 이력' })
    expect(await within(history).findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    fireEvent.click(within(sources).getByRole('button', { name: '다시 시도' }))
    expect(await within(sources).findByText(REPORT_1)).toBeInTheDocument()
  })

  it('출처가 없으면 오류가 아닌 기록 없음으로 표시한다', async () => {
    stubFetch(detailRoute({ [sourcesPath()]: () => json(200, []) }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    const sources = await screen.findByRole('region', { name: '연결 출처' })
    expect(await within(sources).findByText('연결된 출처가 없습니다')).toBeInTheDocument()
  })

  it('null 출처 값은 0이나 임의 값으로 채우지 않는다', async () => {
    stubFetch(detailRoute({ [sourcesPath()]: () => json(200, [{ ...clusterSource, riskScore: null, analysisAlgorithm: null, analysisAlgorithmVersion: null, analysisCompletedAt: null }]) }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    const cluster = await screen.findByRole('article', { name: 'Track 1 저장 군집 증거' })
    expect(within(cluster).getByText('조사 우선순위 (Risk Score)').nextElementSibling).toHaveTextContent('값 없음')
    expect(within(cluster).getByText('분석 알고리즘').nextElementSibling).toHaveTextContent('기록 없음')
    expect(within(cluster).getByText('분석 완료 시각').nextElementSibling).toHaveTextContent('기록 없음')
    expect(within(cluster).queryByText('0.00')).not.toBeInTheDocument()
  })

  it('활동 이력은 서버 페이지와 hasNext로 이동하고 요청과 다른 페이지 응답은 표시하지 않는다', async () => {
    stubFetch(detailRoute({
      [activitiesPath()]: () => json(200, activityPage([activity()], { hasNext: true })),
      [activitiesPath(CASE_1, 1)]: () => json(200, activityPage([activity({ activityId: ACTIVITY_2, eventType: 'UNLISTED_EVENT', reason: '둘째 페이지 사유' })], { page: 0 })),
    }))
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    const history = await screen.findByRole('region', { name: '활동 이력' })
    expect(await within(history).findByText('<b>합성 생성 사유</b>')).toBeInTheDocument()
    fireEvent.click(within(history).getByRole('button', { name: '다음 이력' }))
    expect(await within(history).findByRole('alert')).toHaveTextContent('서버 응답 형식이 계약과 다릅니다')
    expect(within(history).queryByText('둘째 페이지 사유')).not.toBeInTheDocument()
  })

  it('다른 Case로 이동하면 늦게 도착한 이전 Case 응답을 표시하지 않는다', async () => {
    const late = deferred()
    stubFetch((url) => {
      if (url === detailPath()) return late.promise
      if (url === detailPath(CASE_2)) return json(200, caseView({ caseId: CASE_2, classification: '두 번째 분류' }))
      if (url === sourcesPath(CASE_2)) return json(200, [])
      if (url === activitiesPath(CASE_2)) return json(200, activityPage([]))
      return undefined
    })
    renderApp(`/app/cases/${CASE_1}?eventId=${EVENT_A}`)
    expect(await screen.findByRole('status', { name: 'Case 상세를 불러오는 중' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '테스트 Case 2로 이동' }))
    expect(await screen.findByText('두 번째 분류')).toBeInTheDocument()
    late.resolve(json(200, caseView({ classification: '첫 번째 분류' })))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('첫 번째 분류')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Case 개요' })).toHaveTextContent(CASE_2))
  })
})
