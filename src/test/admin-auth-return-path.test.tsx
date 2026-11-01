import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminAccessToken, AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { adminReturnPathStorageKey, isSafeAdminReturnPath } from '../features/admin-auth/returnPath'

// 로그아웃 상태에서 관리자 주소로 접근해 로그인하면 고정 콜백 주소(/app/overview)를 거쳐 원래 주소로 돌아오는지 검증한다.
// Keycloak Redirect URI는 바꾸지 않고, 브라우저 저장소에는 토큰이 아닌 동일 출처 관리자 경로만 잠시 보관한다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const DETAIL_PATH = `/app/analysis/findings/detail?eventId=${EVENT_ID}&analysisRequestId=run%2F1&clusterId=cluster-1`

function adapterWith(token: AdminAccessToken | null) {
  return {
    availability: { status: 'ready' },
    initialize: vi.fn(async () => token),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
  } satisfies AdminAuthAdapter
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
}

function renderApp(path: string, adapter: AdminAuthAdapter) {
  return render(<MemoryRouter initialEntries={[path]}><App adminAuthAdapter={adapter} /><LocationProbe /></MemoryRouter>)
}

const validToken = () => ({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 600_000 })

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  // 복원된 상세 화면의 API 요청은 이 검증의 대상이 아니므로 404로 응답한다.
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('관리자 로그인 후 원래 주소 복원', () => {
  it('로그아웃 상태의 군집 상세 주소에서 로그인하면 콜백 후 같은 주소로 돌아온다', async () => {
    const signedOut = adapterWith(null)
    const first = renderApp(DETAIL_PATH, signedOut)
    fireEvent.click(await screen.findByRole('button', { name: '로그인' }))
    expect(signedOut.signIn).toHaveBeenCalledTimes(1)
    first.unmount()

    // Keycloak은 등록된 고정 Redirect URI로 돌아온다.
    renderApp('/app/overview', adapterWith(validToken()))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(DETAIL_PATH))
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('세션 만료 후 다시 로그인해도 만료 당시 주소로 돌아온다', async () => {
    const expiring = adapterWith({ value: SYNTHETIC_TOKEN, expiresAt: Date.now() + 30_300 })
    const first = renderApp(DETAIL_PATH, expiring)
    fireEvent.click(await screen.findByRole('button', { name: '다시 로그인' }))
    expect(expiring.signIn).toHaveBeenCalledTimes(1)
    first.unmount()
    renderApp('/app/overview', adapterWith(validToken()))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(DETAIL_PATH))
  })

  it('저장소에는 토큰 없이 경로와 저장 시각만 남긴다', async () => {
    renderApp(DETAIL_PATH, adapterWith(null))
    fireEvent.click(await screen.findByRole('button', { name: '로그인' }))
    const stored = sessionStorage.getItem(adminReturnPathStorageKey)!
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['path', 'savedAt'])
    expect(JSON.parse(stored).path).toBe(DETAIL_PATH)
    expect(stored).not.toContain(SYNTHETIC_TOKEN)
    expect(localStorage.length).toBe(0)
  })

  it.each([
    ['다른 출처', '//evil.example/app/overview'],
    ['절대 URL', 'https://evil.example/app/overview'],
    ['팬 화면', '/fan/guide'],
    ['경로 이탈', '/app/../fan/guide'],
    ['인코딩된 경로 이탈', '/app/%2e%2e/fan/guide'],
    ['역슬래시', '/app\\evil'],
    ['fragment 포함', '/app/overview#access_token=x'],
    ['제어 문자', '/app/overview\n'],
  ])('%s 경로는 복원하지 않고 저장값을 지운다', async (_label, path) => {
    expect(isSafeAdminReturnPath(path)).toBe(false)
    sessionStorage.setItem(adminReturnPathStorageKey, JSON.stringify({ path, savedAt: Date.now() }))
    renderApp('/app/overview', adapterWith(validToken()))
    expect(await screen.findByRole('heading', { name: '전체 현황' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/overview$/)
    expect(sessionStorage.getItem(adminReturnPathStorageKey)).toBeNull()
  })

  it('오래된 저장값과 형식이 잘못된 저장값은 복원하지 않는다', async () => {
    sessionStorage.setItem(adminReturnPathStorageKey, JSON.stringify({ path: DETAIL_PATH, savedAt: Date.now() - 11 * 60_000 }))
    const view = renderApp('/app/overview', adapterWith(validToken()))
    expect(await screen.findByRole('heading', { name: '전체 현황' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/overview$/)
    expect(sessionStorage.getItem(adminReturnPathStorageKey)).toBeNull()
    view.unmount()

    sessionStorage.setItem(adminReturnPathStorageKey, 'not-json')
    renderApp('/app/overview', adapterWith(validToken()))
    expect(await screen.findByRole('heading', { name: '전체 현황' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/overview$/)
    expect(sessionStorage.getItem(adminReturnPathStorageKey)).toBeNull()
  })

  it('로그인에 실패하면 저장한 주소로 이동하지 않는다', async () => {
    sessionStorage.setItem(adminReturnPathStorageKey, JSON.stringify({ path: DETAIL_PATH, savedAt: Date.now() }))
    renderApp('/app/overview', adapterWith(null))
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/overview$/)
  })
})
