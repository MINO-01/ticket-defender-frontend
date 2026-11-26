import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminAuthProvider } from '../features/admin-auth/AdminAuthProvider'
import type { AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { RequireAdminAuth } from '../features/admin-auth/RequireAdminAuth'
import { MultiEventInvestigationRoute } from '../features/admin-multi-event/MultiEventInvestigationPage'
import { parseSignalKeys, signalLabel } from '../features/admin-multi-event/multiEventSignals'
import { describeAdminApiFailure } from '../api/adminApiFailure'

const eventA = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const performanceA = '33333333-3333-4333-8333-333333333333'
const performanceB = '44444444-4444-4444-8444-444444444444'
const versionA = '55555555-5555-4555-8555-555555555555'
const versionB = '66666666-6666-4666-8666-666666666666'
const candidateId = `multi-${'c'.repeat(64)}`
const memberA = 'a'.repeat(24)
const memberB = 'b'.repeat(24)
const relationshipA = '77777777-7777-4777-8777-777777777777'
const relationshipB = '88888888-8888-4888-8888-888888888888'
// 형식 검사 전용 더미 compact JWS이며 실제 인증 제공자나 Backend에서 사용할 수 없다.
const token = 'e30.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const adapter = (): AdminAuthAdapter => ({
  availability: { status: 'ready' },
  initialize: vi.fn(async () => ({ value: token, expiresAt: Date.now() + 600_000 })),
  signIn: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const page = (items: unknown[], current: number, pageSize: number, hasNext: boolean) => ({ items, page: current, pageSize, hasNext })
const scopeA = { eventId: eventA, performanceId: performanceA, ledgerVersionId: versionA, eventReference: 'EXT-A', sourceBatchId: 'batch-a' }
const scopeB = { eventId: eventA, performanceId: performanceB, ledgerVersionId: versionB, eventReference: 'EXT-A', sourceBatchId: 'batch-b' }
const rawKeys = ['refund_account_hash', 'ip_window:CORPORATE_EDU', 'stable_account_cocluster', 'payment_hash', 'device_id_hash']

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: runId, status: 'COMPLETED', failureCode: null, ledgerVersionSetDigest: 'c'.repeat(64),
    scoreVersion: 'score-v2-exp2-multi-performance-recurrence', projectionVersion: 'projection-v2.2-exp2-ipwindow-softhub',
    algorithmVersion: 'gds-2.6.6', analysisAsOf: '2026-11-25T00:00:00Z', analysisStartAt: '2026-11-01T00:00:00Z',
    analysisEndAt: '2026-11-24T00:00:00Z', createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:01:00Z',
    completedAt: '2026-11-25T00:01:00Z', ...overrides,
  }
}

function stubServer(performances: unknown[], runs: unknown[], posts: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname === '/api/v1/admin/events') return json({ items: [{ id: eventA, externalEventId: 'ext-a', name: '공연 A' }], page: 0, pageSize: 100, totalItems: 1, hasNext: false })
    if (url.pathname.endsWith('/performances')) return json(page(performances, 0, 100, false))
    if (url.pathname === '/api/v1/admin/multi-event-investigations' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return json({ runId, existing: false, status: 'PENDING' }, 202)
    }
    if (url.pathname === `/api/v1/admin/multi-event-investigations/events/${eventA}`) return json(page(runs, 0, 20, false))
    if (url.pathname.endsWith(`/${runId}/sources`)) return json([scopeA, scopeB])
    if (url.pathname.endsWith(`/${runId}/candidates`)) return json(page([{
      candidateId, priorityBand: 'LOW', investigationScore: 0.1514, baselineMaxScore: null,
      distinctAccountCount: 3, distinctEventCount: 1, distinctPerformanceCount: 2, verifiedRelationshipCount: 4,
      scoreBreakdown: '{"L":0.5,"G":0.7268,"B":0.4167,"Q":0.5,"R":0.3333,"score":0.1514,"quantityStatus":"NEUTRAL_NO_POLICY","quantityReason":"UNKNOWN"}',
      availableSignals: '["ip_window:CORPORATE_EDU","payment_hash","refund_account_hash"]', excludedSignals: '[]',
      unavailableSignals: '["address_hash","device_id_hash","phone_hash"]', normalSharingPossibilities: '["NORMAL_SHARED_POSSIBLE"]',
    }], 0, 20, false))
    if (url.pathname.endsWith(`/candidates/${candidateId}/members`)) return json(page([{ memberId: memberA }, { memberId: memberB }], 0, 100, false))
    if (url.pathname.endsWith(`/candidates/${candidateId}/relationships`)) return json(page([
      { relationshipId: relationshipA, signalType: 'stable_account_cocluster', accountCount: 3, sourceScopeCount: 2, memberIds: [memberA, memberB], membersTruncated: false, sourceScopes: [scopeA, scopeB] },
      { relationshipId: relationshipB, signalType: 'refund_account_hash', accountCount: 3, sourceScopeCount: 2, memberIds: [memberA, memberB], membersTruncated: false, sourceScopes: [scopeA, scopeB] },
    ], 0, 20, false))
    return new Response(null, { status: 404 })
  }))
}

function renderPage() {
  return render(<MemoryRouter><AdminAuthProvider adapter={adapter()}><RequireAdminAuth><MultiEventInvestigationRoute /></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
}

/** 툴팁(title 속성과 SVG title 요소)을 뺀, 화면 본문에 실제로 보이는 글자입니다. */
function visibleText(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll('title').forEach((node) => node.remove())
  return clone.textContent ?? ''
}

afterEach(() => vi.unstubAllGlobals())

describe('다회차 조사 화면', () => {
  it('공연 하나의 서로 다른 회차 두 개로 분석을 요청한다', async () => {
    const posts: unknown[] = []
    stubServer([scopeA, scopeB], [run()], posts)
    renderPage()
    fireEvent.click(await screen.findByLabelText('공연 A'))
    const button = screen.getByRole('button', { name: '고정 원장으로 다공연 분석 요청' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(await screen.findByLabelText(new RegExp(performanceA)))
    fireEvent.click(screen.getByLabelText(new RegExp(performanceB)))
    expect(screen.getByText('공연 1개, 회차 2개 선택')).toBeInTheDocument()
    fireEvent.click(button)
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ eventIds: [eventA], performanceSelections: [{ eventId: eventA, performanceIds: [performanceA, performanceB] }] })
  })

  it('공연 하나에 회차가 하나뿐이면 요청하지 않고 회차 선택을 안내한다', async () => {
    const posts: unknown[] = []
    stubServer([scopeA], [], posts)
    renderPage()
    fireEvent.click(await screen.findByLabelText('공연 A'))
    await screen.findByLabelText(new RegExp(performanceA))
    expect(screen.getByRole('button', { name: '고정 원장으로 다공연 분석 요청' })).toBeDisabled()
    expect(screen.getByText('회차를 두 개 이상 선택해 주세요.')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it('후보 상세에 공연 수와 회차 수, 한국어 신호 라벨을 보여 주고 원래 키는 툴팁에만 둔다', async () => {
    stubServer([scopeA, scopeB], [run()])
    renderPage()
    fireEvent.click(await screen.findByLabelText('공연 A'))
    await screen.findByLabelText(new RegExp(performanceB))
    const submit = screen.getByRole('button', { name: '고정 원장으로 다공연 분석 요청' })
    // 회차 수가 반영되어 버튼이 활성화된 뒤에만 요청합니다.
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    fireEvent.click(await screen.findByRole('button', { name: '열기' }, { timeout: 5000 }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '열기' })).toHaveLength(2), { timeout: 5000 })
    fireEvent.click(screen.getAllByRole('button', { name: '열기' })[1])

    const detail = await screen.findByRole('region', { name: '조사 후보 근거' })
    await within(detail).findByRole('table', { name: '검증된 관계' })
    expect(within(detail).getByText('공연 1개 / 회차 2개')).toBeInTheDocument()
    expect(within(detail).getByText(/R은 서로 다른 회차 수 기준입니다/)).toBeInTheDocument()
    expect(within(detail).getAllByText('IP 시간창(기업과 교육망)')[0]).toHaveAttribute('title', 'ip_window:CORPORATE_EDU')
    expect(within(detail).getAllByText('결제')[0]).toHaveAttribute('title', 'payment_hash')
    const relationships = within(detail).getByRole('table', { name: '검증된 관계' })
    expect(within(relationships).getByText('같은 계정 반복 동시 군집')).toHaveAttribute('title', 'stable_account_cocluster')
    expect(within(relationships).getByText('환불 계좌')).toHaveAttribute('title', 'refund_account_hash')

    const text = visibleText(document.body)
    for (const key of rawKeys) expect(text).not.toContain(key)
    for (const key of ['refund_account_hash', 'ip_window:CORPORATE_EDU', 'stable_account_cocluster', 'payment_hash']) {
      expect(document.body.querySelector(`[title="${key}"]`)).not.toBeNull()
    }
  })

  it('퇴역 점수 모델 작업은 읽기 전용으로 안내하고 재시도 버튼을 숨긴다', async () => {
    stubServer([scopeA, scopeB], [run({ status: 'RETRYABLE', failureCode: 'SCORE_VERSION_RETIRED', scoreVersion: 'score-v2-exp2-multi-event-recurrence', completedAt: null })])
    renderPage()
    fireEvent.click(await screen.findByLabelText('공연 A'))
    await screen.findByLabelText(new RegExp(performanceB))
    const submit = screen.getByRole('button', { name: '고정 원장으로 다공연 분석 요청' })
    // 회차 수가 반영되어 버튼이 활성화된 뒤에만 요청합니다.
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    expect(await screen.findByText('RETRYABLE: 퇴역한 점수 모델이라 다시 실행하지 않음', undefined, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '열기' }))
    expect(await screen.findByText(/이전 점수 모델\(공연 수 기준 R\)로 계산된 읽기 전용 결과입니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '분석 재시도' })).toBeNull()
  })
})

describe('다회차 신호 라벨과 오류 안내', () => {
  it('신호 키를 한국어 라벨로 바꾸고 알 수 없는 키는 숨기지 않는다', () => {
    expect(signalLabel('refund_account_hash')).toBe('환불 계좌')
    expect(signalLabel('phone_hash')).toBe('연락처')
    expect(signalLabel('device_id_hash')).toBe('기기')
    expect(signalLabel('address_hash')).toBe('배송지')
    expect(signalLabel('payment_hash')).toBe('결제')
    expect(signalLabel('ip_window:RESIDENTIAL')).toBe('IP 시간창(주거망)')
    expect(signalLabel('ip_window')).toBe('IP 시간창')
    expect(signalLabel('stable_account_cocluster')).toBe('같은 계정 반복 동시 군집')
    expect(signalLabel('ip_window:HOME')).toBe('알 수 없는 신호')
    expect(signalLabel('raw_ip')).toBe('알 수 없는 신호')
    expect(parseSignalKeys('["payment_hash","ip_window"]')).toEqual(['payment_hash', 'ip_window'])
    expect(parseSignalKeys('address_hash, phone_hash')).toEqual(['address_hash', 'phone_hash'])
    expect(parseSignalKeys('[broken')).toEqual([])
  })

  it('새 오류 코드마다 고정 한국어 안내를 보여 준다', () => {
    const cases: Array<[number, string, string]> = [
      [409, 'MULTI_EVENT_PERFORMANCE_SCOPE_REQUIRED', '회차를 두 개 이상 선택해 주세요'],
      [409, 'SCORE_VERSION_RETIRED', '퇴역한 점수 모델의 작업입니다'],
      [409, 'MULTI_EVENT_SUPPLIER_MIXED', '서로 다른 예매처의 원장은 함께 분석하지 않습니다'],
      [409, 'MULTI_EVENT_IDENTITY_CONTRACT_UNAVAILABLE', '연결 신호의 키 정보가 하나로 맞지 않습니다'],
      [409, 'UPLOAD_OBJECT_EXPIRED', '업로드 원본이 보존 한도를 넘겨 삭제되었습니다'],
      [409, 'TRACK1_SIGNAL_KEY_UNAVAILABLE', '신호 키 공급원이 설정되지 않았습니다'],
      [422, 'BULK_V3_RAW_INTAKE_DISABLED', '원본 신호 반입(v3)이 비활성화되어 있습니다'],
      [503, 'BULK_V3_DELETE_PERMISSION_UNVERIFIED', '업로드 원본 삭제 권한을 확인하지 못했습니다'],
    ]
    for (const [status, code, title] of cases) {
      const message = describeAdminApiFailure({ kind: 'problem', status, code }, '확인하지 못했습니다')
      expect(message.title).toBe(title)
      expect(message.description).not.toContain(code)
    }
  })
})
