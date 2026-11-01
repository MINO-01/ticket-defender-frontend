import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAccessToken, AdminAuthAdapter } from '../features/admin-auth/authAdapter'

// Mock 인증 어댑터로 점검 패널의 요청과 표시 계약만 검증한다. 실제 Backend 호출은 E2E에서 확인한다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_ID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'

function createMockAdapter(token: AdminAccessToken | null) {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => token),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function renderApp(path: string, adapter?: AdminAuthAdapter) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={adapter} /></MemoryRouter>)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('백엔드 인증 연결 확인', () => {
  function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  async function submitEvent(value: string) {
    fireEvent.change(await screen.findByLabelText('공연 UUID'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '권한 확인' }))
  }

  it('인증 세션의 토큰으로 기존 관리자 API를 호출하고 건수만 표시한다', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, { event: { name: '합성 공연' }, items: [{ description: '합성 제보 본문' }], page: 0, pageSize: 1, totalItems: 3, hasNext: true }))
    vi.stubGlobal('fetch', fetchMock)
    renderApp('/app/settings', createMockAdapter({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 }))
    await submitEvent(EVENT_ID)
    expect(await screen.findByText('인증과 권한 확인에 성공했습니다. 이 공연의 팬 제보 3건에 접근할 수 있습니다.')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/v1/admin/fan-reports?eventId=${EVENT_ID}&page=0&pageSize=1`)
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
    expect(screen.queryByText('합성 제보 본문')).not.toBeInTheDocument()
    expect(screen.queryByText('합성 공연')).not.toBeInTheDocument()
  })

  it('403 역할 부족과 404 범위 밖을 구분해 표시한다', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    renderApp('/app/settings', createMockAdapter({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 }))
    await submitEvent(EVENT_ID)
    expect(await screen.findByText('인증은 되었지만 이 작업에 필요한 역할이 없습니다.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '권한 확인' }))
    expect(await screen.findByText('공연을 찾을 수 없거나 접근 범위 밖입니다.')).toBeInTheDocument()
  })

  it('UUID 형식이 아니면 요청하지 않는다', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    renderApp('/app/settings', createMockAdapter({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 }))
    await submitEvent('../fan-reports')
    expect(screen.getByText('공연 UUID 형식으로 입력해 주세요.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('개발 미리보기는 인증 세션이 아니므로 관리자 API를 호출하지 않는다', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_ADMIN_DEMO_PREVIEW', 'true')
    renderApp('/app/settings')
    await submitEvent(EVENT_ID)
    await waitFor(() => expect(screen.getByText('유효한 관리자 세션이 없어 요청하지 않았거나 서버가 인증을 거부했습니다.')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
