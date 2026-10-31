import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import App from '../App'
import type { AdminApiResult } from '../api/adminApiClient'
import { AdminAuthProvider, useAdminApiClient, useAdminAuth } from '../features/admin-auth/AdminAuthProvider'
import { RequireAdminAuth } from '../features/admin-auth/RequireAdminAuth'
import { createDefaultAdminAuthAdapter, isUsableAccessToken } from '../features/admin-auth/authAdapter'
import type { AdminAccessToken, AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { isAdminDemoPreviewEnabled, readAdminAuthConfig } from '../features/admin-auth/authConfig'
import { submitFanReport } from '../features/fan-report/fanReportApi'

// 실제 인증 제공자가 미확정이므로 아래 검증은 모두 Mock 어댑터와 합성 토큰을 사용한다. 실제 로그인 E2E가 아니다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'

function syntheticToken(lifetimeMs = 10 * 60_000): AdminAccessToken {
  return { value: SYNTHETIC_TOKEN, expiresAt: Date.now() + lifetimeMs }
}

function createMockAdapter(token: AdminAccessToken | null | Error) {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => {
      if (token instanceof Error) throw token
      return token
    }),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
}

function renderApp(path: string, adapter?: AdminAuthAdapter) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={adapter} /><LocationProbe /></MemoryRouter>)
}

function ApiProbe({ fetchImpl }: { fetchImpl: typeof fetch }) {
  const client = useAdminApiClient(fetchImpl)
  const [result, setResult] = useState<AdminApiResult<{ id: string }> | null>(null)
  return <div>
    <button type="button" onClick={() => void client.request('/api/v1/cases/synthetic-case', { schema: z.object({ id: z.string() }) }).then(setResult)}>요청</button>
    <output data-testid="api-result">{result?.kind ?? 'none'}</output>
  </div>
}

function renderApiProbe(adapter: AdminAuthAdapter, fetchImpl: typeof fetch) {
  return render(<MemoryRouter><AdminAuthProvider adapter={adapter}><RequireAdminAuth><ApiProbe fetchImpl={fetchImpl} /></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
}

afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.clear()
  sessionStorage.clear()
})

describe('관리자 인증 설정', () => {
  it('설정이 모두 없으면 missing, 일부만 있거나 HTTPS가 아니면 invalid로 판단한다', () => {
    expect(readAdminAuthConfig({})).toEqual({ status: 'missing' })
    expect(readAdminAuthConfig({ VITE_ADMIN_AUTH_ISSUER: 'https://idp.example.test' })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ VITE_ADMIN_AUTH_ISSUER: 'http://idp.example.test', VITE_ADMIN_AUTH_CLIENT_ID: 'td-admin', VITE_ADMIN_AUTH_AUDIENCE: 'td-admin-api' })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ VITE_ADMIN_AUTH_ISSUER: 'https://user:pw@idp.example.test', VITE_ADMIN_AUTH_CLIENT_ID: 'td-admin', VITE_ADMIN_AUTH_AUDIENCE: 'td-admin-api' })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ VITE_ADMIN_AUTH_ISSUER: 'https://idp.example.test', VITE_ADMIN_AUTH_CLIENT_ID: 'td-admin', VITE_ADMIN_AUTH_AUDIENCE: 'td-admin-api' })).toEqual({ status: 'configured', issuer: 'https://idp.example.test', clientId: 'td-admin', audience: 'td-admin-api' })
  })

  it('제공자가 미확정이므로 설정이 올바르더라도 기본 어댑터는 로그인을 제공하지 않는다', async () => {
    const adapter = createDefaultAdminAuthAdapter({ status: 'configured', issuer: 'https://idp.example.test', clientId: 'td-admin', audience: 'td-admin-api' })
    expect(adapter.availability).toEqual({ status: 'unavailable', reason: 'providerUndecided' })
    await expect(adapter.initialize()).resolves.toBeNull()
  })

  it('합성 데이터 미리보기는 개발 빌드에서 명시적으로 켠 경우에만 허용한다', () => {
    expect(isAdminDemoPreviewEnabled({ DEV: true, VITE_ADMIN_DEMO_PREVIEW: 'true' })).toBe(true)
    expect(isAdminDemoPreviewEnabled({ DEV: false, VITE_ADMIN_DEMO_PREVIEW: 'true' })).toBe(false)
    expect(isAdminDemoPreviewEnabled({ DEV: true, VITE_ADMIN_DEMO_PREVIEW: '1' })).toBe(false)
    expect(isAdminDemoPreviewEnabled({ DEV: true })).toBe(false)
  })

  it('형식이 맞고 만료 여유 시간 전인 토큰만 사용한다', () => {
    const now = Date.now()
    expect(isUsableAccessToken({ value: SYNTHETIC_TOKEN, expiresAt: now + 60_000 }, now)).toBe(true)
    expect(isUsableAccessToken({ value: SYNTHETIC_TOKEN, expiresAt: now + 10_000 }, now)).toBe(false)
    expect(isUsableAccessToken({ value: 'not-a-jwt', expiresAt: now + 60_000 }, now)).toBe(false)
    expect(isUsableAccessToken({ value: SYNTHETIC_TOKEN, expiresAt: Number.NaN }, now)).toBe(false)
    expect(isUsableAccessToken(null, now)).toBe(false)
  })
})

describe('관리자 보호 라우트', () => {
  it('인증 설정이 없으면 관리자 화면과 메뉴를 렌더링하지 않는다', () => {
    renderApp('/app/cases')
    expect(screen.getByRole('heading', { name: '관리자 인증이 설정되지 않았습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '관리자 탐색' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /로그인/ })).not.toBeInTheDocument()
  })

  it('잘못된 설정이나 미확정 제공자 상태에서는 가짜 로그인 없이 차단한다', () => {
    vi.stubEnv('VITE_ADMIN_AUTH_ISSUER', 'http://idp.example.test')
    const invalid = renderApp('/app/overview')
    expect(screen.getByRole('heading', { name: '관리자 인증 설정이 올바르지 않습니다' })).toBeInTheDocument()
    invalid.unmount()

    vi.stubEnv('VITE_ADMIN_AUTH_ISSUER', 'https://idp.example.test')
    vi.stubEnv('VITE_ADMIN_AUTH_CLIENT_ID', 'td-admin')
    vi.stubEnv('VITE_ADMIN_AUTH_AUDIENCE', 'td-admin-api')
    renderApp('/app/overview')
    expect(screen.getByRole('heading', { name: '관리자 로그인을 아직 사용할 수 없습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /로그인/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '관리자 탐색' })).not.toBeInTheDocument()
  })

  it('운영 빌드에서는 미리보기 플래그를 무시한다', () => {
    vi.stubEnv('VITE_ADMIN_DEMO_PREVIEW', 'true')
    vi.stubEnv('DEV', false)
    renderApp('/app/overview')
    expect(screen.getByRole('heading', { name: '관리자 인증이 설정되지 않았습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '관리자 탐색' })).not.toBeInTheDocument()
  })

  it('개발 미리보기는 인증되지 않은 합성 데이터 화면으로 표시하고 로그아웃을 제공하지 않는다', () => {
    vi.stubEnv('VITE_ADMIN_DEMO_PREVIEW', 'true')
    renderApp('/app/overview')
    expect(screen.getByRole('navigation', { name: '관리자 탐색' })).toBeInTheDocument()
    expect(screen.getByText('합성 데이터 미리보기 (인증되지 않음)')).toBeInTheDocument()
    expect(screen.queryByText('인증된 관리자 세션')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument()
  })

  it('세션이 없으면 로그인 안내만 표시하고 제공자 로그인을 요청한다', async () => {
    const adapter = createMockAdapter(null)
    renderApp('/app/overview', adapter)
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '관리자 탐색' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(adapter.signIn).toHaveBeenCalledTimes(1)
  })

  it('만료된 토큰이나 초기화 실패는 인증 상태로 전환하지 않는다', async () => {
    const expired = renderApp('/app/overview', createMockAdapter(syntheticToken(-1000)))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expired.unmount()
    renderApp('/app/overview', createMockAdapter(new Error('provider failure')))
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
  })

  it('유효한 세션에서는 관리자 화면을 표시하고 토큰을 화면, URL, 브라우저 저장소에 남기지 않는다', async () => {
    renderApp('/app/overview', createMockAdapter(syntheticToken()))
    expect(await screen.findByRole('navigation', { name: '관리자 탐색' })).toBeInTheDocument()
    expect(screen.getByText('인증된 관리자 세션')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(SYNTHETIC_TOKEN)
    expect(screen.getByTestId('location')).toHaveTextContent('/app/overview')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('로그아웃하면 메모리 세션을 정리하고 다른 관리자 경로도 차단한다', async () => {
    const adapter = createMockAdapter(syntheticToken())
    renderApp('/app/overview', adapter)
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
    expect(screen.getByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(adapter.signOut).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('link', { name: '첫 화면으로 이동' }))
    fireEvent.click(screen.getByRole('link', { name: /관리자/ }))
    expect(screen.getByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '관리자 탐색' })).not.toBeInTheDocument()
  })

  it('토큰 만료 시각이 지나면 세션을 정리하고 재인증을 안내한다', async () => {
    const adapter = createMockAdapter(syntheticToken(30_000 + 300))
    renderApp('/app/overview', adapter)
    expect(await screen.findByRole('navigation', { name: '관리자 탐색' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 로그인' }))
    expect(adapter.signIn).toHaveBeenCalledTimes(1)
  })
})

describe('인증된 관리자 API 요청', () => {
  it('유효한 세션의 토큰을 Bearer로 전달한다', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'synthetic-case' }), { status: 200 }))
    renderApiProbe(createMockAdapter(syntheticToken()), fetchImpl)
    fireEvent.click(await screen.findByRole('button', { name: '요청' }))
    await waitFor(() => expect(screen.getByTestId('api-result')).toHaveTextContent('success'))
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
  })

  it('401 응답은 세션을 종료하고 재인증 화면으로 전환한다', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }))
    renderApiProbe(createMockAdapter(syntheticToken()), fetchImpl)
    fireEvent.click(await screen.findByRole('button', { name: '요청' }))
    expect(await screen.findByRole('heading', { name: '관리자 세션이 종료되었습니다' })).toBeInTheDocument()
  })

  it('403과 404는 세션을 유지한 채 결과만 구분한다', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    renderApiProbe(createMockAdapter(syntheticToken()), fetchImpl)
    fireEvent.click(await screen.findByRole('button', { name: '요청' }))
    await waitFor(() => expect(screen.getByTestId('api-result')).toHaveTextContent('forbidden'))
    fireEvent.click(screen.getByRole('button', { name: '요청' }))
    await waitFor(() => expect(screen.getByTestId('api-result')).toHaveTextContent('notFound'))
    expect(screen.queryByRole('heading', { name: '관리자 세션이 종료되었습니다' })).not.toBeInTheDocument()
  })

  it('로그아웃 이후에는 관리자 API 요청에 토큰을 사용하지 않는다', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 }))
    // 보호 라우트 밖에 둔 Probe로 로그아웃 이후의 요청 동작만 확인한다.
    render(<MemoryRouter><AdminAuthProvider adapter={createMockAdapter(syntheticToken())}><ApiProbe fetchImpl={fetchImpl} /><RequireAdminAuth><LogoutButton /></RequireAdminAuth></AdminAuthProvider></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '테스트 로그아웃' }))
    fireEvent.click(screen.getByRole('button', { name: '요청' }))
    await waitFor(() => expect(screen.getByTestId('api-result')).toHaveTextContent('unauthenticated'))
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

function LogoutButton() {
  const { signOut } = useAdminAuth()
  return <button type="button" onClick={signOut}>테스트 로그아웃</button>
}

describe('공개 팬 제보 API 경계', () => {
  it('관리자 세션이 있어도 팬 제보 요청에는 Authorization 헤더와 쿠키를 보내지 않는다', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }))
    renderApp('/app/overview', createMockAdapter(syntheticToken()))
    await screen.findByText('인증된 관리자 세션')
    await submitFanReport({ report: { eventId: '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b', performanceAt: '2026-11-20T19:00:00+09:00', reportType: 'OTHER', description: '합성 제보 내용입니다.' }, evidence: [], idempotencyKey: '7b0f5a4e-2c1d-4e3f-9a8b-1c2d3e4f5a6b', recoverySecret: 'A'.repeat(43) }, fetchImpl)
    const init = fetchImpl.mock.calls[0][1]
    expect(init?.headers).not.toHaveProperty('Authorization')
    expect(JSON.stringify(init?.headers)).not.toContain(SYNTHETIC_TOKEN)
    expect(init?.credentials).toBe('omit')
  })
})
