import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createDefaultAdminAuthAdapter } from '../features/admin-auth/authAdapter'
import type { AdminAccessToken, AdminAuthAdapter } from '../features/admin-auth/authAdapter'
import { readAdminAuthConfig } from '../features/admin-auth/authConfig'
import { createKeycloakAdminAuthAdapter, keycloakCallbackPath } from '../features/admin-auth/keycloakAdapter'
import type { KeycloakAdapterDependencies } from '../features/admin-auth/keycloakAdapter'

// 공식 SDK 대신 테스트 대역을 사용하는 Mock 검증이다. 실제 Keycloak 로그인 E2E는 별도로 수행한다.
const ISSUER = 'https://localhost:18443/realms/ticket-defender-demo'
const ORIGIN = 'http://localhost:15173'
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'

type KeycloakLoader = KeycloakAdapterDependencies['loadKeycloak']
type InitBehavior = { authenticated: boolean; exp?: number; timeSkew?: number } | Error

function createFakeSdk(behavior: InitBehavior) {
  const instances: FakeKeycloak[] = []
  class FakeKeycloak {
    authenticated = false
    didInitialize = false
    token: string | undefined
    tokenParsed: { exp?: number } | undefined
    timeSkew: number | null = null
    readonly init = vi.fn(async () => {
      this.didInitialize = true
      if (behavior instanceof Error) throw behavior
      this.authenticated = behavior.authenticated
      if (behavior.authenticated) {
        this.token = SYNTHETIC_TOKEN
        this.tokenParsed = { exp: behavior.exp }
        this.timeSkew = behavior.timeSkew ?? 0
      }
      return behavior.authenticated
    })
    readonly login = vi.fn(async () => undefined)
    readonly logout = vi.fn(async () => undefined)
    readonly config: { url: string; realm: string; clientId: string }
    constructor(config: { url: string; realm: string; clientId: string }) {
      this.config = config
      instances.push(this)
    }
  }
  const loadKeycloak = vi.fn(async () => FakeKeycloak) as unknown as KeycloakLoader & ReturnType<typeof vi.fn>
  return { instances, loadKeycloak }
}

function createAdapter(behavior: InitBehavior) {
  const sdk = createFakeSdk(behavior)
  const adapter = createKeycloakAdminAuthAdapter({ issuer: ISSUER, clientId: 'ticket-defender-web' }, { loadKeycloak: sdk.loadKeycloak, origin: ORIGIN })
  return { adapter, ...sdk }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Keycloak 인증 설정', () => {
  const base = { VITE_ADMIN_AUTH_ISSUER: ISSUER, VITE_ADMIN_AUTH_CLIENT_ID: 'ticket-defender-web', VITE_ADMIN_AUTH_AUDIENCE: 'ticket-defender-admin' }

  it('keycloak 제공자와 realm issuer가 모두 맞을 때만 설정을 사용한다', () => {
    expect(readAdminAuthConfig({ ...base, VITE_ADMIN_AUTH_PROVIDER: 'keycloak' })).toEqual({ status: 'configured', provider: 'keycloak', issuer: ISSUER, clientId: 'ticket-defender-web', audience: 'ticket-defender-admin' })
    expect(readAdminAuthConfig({ ...base, VITE_ADMIN_AUTH_PROVIDER: 'keycloak', VITE_ADMIN_AUTH_ISSUER: 'https://localhost:18443/' })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ ...base, VITE_ADMIN_AUTH_PROVIDER: 'keycloak', VITE_ADMIN_AUTH_ISSUER: `${ISSUER}/` })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ ...base, VITE_ADMIN_AUTH_PROVIDER: 'keycloak', VITE_ADMIN_AUTH_ISSUER: `${ISSUER}?x=1` })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ ...base, VITE_ADMIN_AUTH_PROVIDER: 'keycloak', VITE_ADMIN_AUTH_ISSUER: 'http://localhost:18443/realms/ticket-defender-demo' })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ ...base, VITE_ADMIN_AUTH_PROVIDER: 'auth0' })).toEqual({ status: 'invalid' })
    expect(readAdminAuthConfig({ VITE_ADMIN_AUTH_PROVIDER: 'keycloak' })).toEqual({ status: 'invalid' })
  })

  it('keycloak 설정이면 기본 어댑터가 SDK를 불러오기 전 로그인 가능 상태가 된다', () => {
    expect(createDefaultAdminAuthAdapter({ status: 'configured', provider: 'keycloak', issuer: ISSUER, clientId: 'ticket-defender-web', audience: 'ticket-defender-admin' }).availability).toEqual({ status: 'ready' })
  })
})

describe('Keycloak 어댑터', () => {
  it('SDK는 초기화 시점에만 불러오고 PKCE S256 표준 흐름과 정확한 Redirect URI로 한 번만 초기화한다', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600
    const { adapter, instances, loadKeycloak } = createAdapter({ authenticated: true, exp, timeSkew: 2 })
    expect(loadKeycloak).not.toHaveBeenCalled()
    const [first, second] = await Promise.all([adapter.initialize(), adapter.initialize()])
    expect(first).toEqual<AdminAccessToken>({ value: SYNTHETIC_TOKEN, expiresAt: (exp + 2) * 1000 })
    expect(second).toBe(first)
    expect(instances).toHaveLength(1)
    expect(instances[0].config).toEqual({ url: 'https://localhost:18443', realm: 'ticket-defender-demo', clientId: 'ticket-defender-web' })
    expect(instances[0].init).toHaveBeenCalledTimes(1)
    expect(instances[0].init).toHaveBeenCalledWith({ flow: 'standard', pkceMethod: 'S256', responseMode: 'fragment', checkLoginIframe: false, enableLogging: false, redirectUri: `${ORIGIN}${keycloakCallbackPath}` })
  })

  it('미인증이거나 만료 정보가 없으면 토큰을 반환하지 않는다', async () => {
    await expect(createAdapter({ authenticated: false }).adapter.initialize()).resolves.toBeNull()
    await expect(createAdapter({ authenticated: true }).adapter.initialize()).resolves.toBeNull()
  })

  it('초기화나 콜백 검증 실패는 오류로 전달하고 다음 시도에서 새 SDK 인스턴스를 만든다', async () => {
    const { adapter, instances } = createAdapter(new Error('Invalid nonce.'))
    await expect(adapter.initialize()).rejects.toThrow('Invalid nonce.')
    await expect(adapter.initialize()).rejects.toThrow('Invalid nonce.')
    expect(instances).toHaveLength(2)
  })

  it('로그인은 같은 Redirect URI로 이동하고 로그아웃은 POST 방식으로 요청한다', async () => {
    const { adapter, instances } = createAdapter({ authenticated: false })
    await adapter.signOut()
    expect(instances).toHaveLength(0)
    await adapter.signIn()
    expect(instances[0].login).toHaveBeenCalledWith({ redirectUri: `${ORIGIN}${keycloakCallbackPath}` })
    await adapter.signOut()
    expect(instances[0].logout).toHaveBeenCalledWith({ redirectUri: `${ORIGIN}/`, logoutMethod: 'POST' })
  })
})

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

describe('관리자 인증 초기화 시점', () => {
  it('팬 제보 화면에서는 인증 제공자를 초기화하지 않고 관리자 보호 라우트에서만 초기화한다', async () => {
    const adapter = createMockAdapter(null)
    const fan = renderApp('/fan/guide', adapter)
    expect(screen.getByRole('heading', { name: '제보 안내' })).toBeInTheDocument()
    expect(adapter.initialize).not.toHaveBeenCalled()
    fan.unmount()
    renderApp('/app', adapter)
    expect(await screen.findByRole('heading', { name: '관리자 로그인이 필요합니다' })).toBeInTheDocument()
    expect(adapter.initialize).toHaveBeenCalledTimes(1)
  })
})
