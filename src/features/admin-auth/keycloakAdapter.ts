import type Keycloak from 'keycloak-js'
import type { KeycloakInitOptions } from 'keycloak-js'
import type { AdminAccessToken, AdminAuthAdapter } from './authAdapter'

// 캡스톤 합성 데이터 검증용 Keycloak OIDC 어댑터다. 운영 인증 제공자 선정을 의미하지 않는다.
// 공식 keycloak-js SDK의 Authorization Code + PKCE(S256) 흐름을 사용하며 client secret은 없다.
// 액세스 토큰은 SDK 인스턴스 메모리에만 있고, state, nonce, PKCE verifier 같은 일회용 거래 정보만 SDK가 콜백 처리 전까지 보관한다.

export type KeycloakAdapterConfig = Readonly<{ issuer: string; clientId: string }>

type KeycloakConstructor = new (config: { url: string; realm: string; clientId: string }) => Keycloak

export type KeycloakAdapterDependencies = {
  /** SDK는 관리자 인증이 필요할 때만 불러와 팬 제보 화면에서는 인증 서버에 접속하지 않는다. */
  loadKeycloak: () => Promise<KeycloakConstructor>
  /** 로그인 콜백과 로그아웃 후 이동할 동일 출처 */
  origin: string
}

const defaultDependencies = (): KeycloakAdapterDependencies => ({
  loadKeycloak: () => import('keycloak-js').then((module) => module.default),
  origin: window.location.origin,
})

/** Keycloak에 등록한 정확한 Redirect URI와 같아야 한다. 콜백 fragment는 SDK가 초기화 중에 읽고 주소에서 제거한다. */
export const keycloakCallbackPath = '/app/overview'

export function createKeycloakAdminAuthAdapter(config: KeycloakAdapterConfig, dependencies: KeycloakAdapterDependencies = defaultDependencies()): AdminAuthAdapter {
  const issuerUrl = new URL(config.issuer)
  const realm = decodeURIComponent(issuerUrl.pathname.slice('/realms/'.length))
  const redirectUri = `${dependencies.origin}${keycloakCallbackPath}`
  const postLogoutRedirectUri = `${dependencies.origin}/`
  const initOptions: KeycloakInitOptions = {
    flow: 'standard',
    pkceMethod: 'S256',
    responseMode: 'fragment',
    // 제3자 쿠키에 의존하는 세션 확인 iframe은 쓰지 않는다. 새로고침하면 다시 로그인하는 기존 정책을 따른다.
    checkLoginIframe: false,
    enableLogging: false,
    redirectUri,
  }

  let client: Promise<Keycloak> | null = null
  let initialization: Promise<AdminAccessToken | null> | null = null

  function readToken(keycloak: Keycloak): AdminAccessToken | null {
    const exp = keycloak.tokenParsed?.exp
    if (!keycloak.authenticated || typeof keycloak.token !== 'string' || typeof exp !== 'number') return null
    // timeSkew는 브라우저 시각에서 서버 발급 시각을 뺀 초 단위 값이므로 만료 시각을 브라우저 기준으로 맞춘다.
    return { value: keycloak.token, expiresAt: (exp + (keycloak.timeSkew ?? 0)) * 1000 }
  }

  function initialize() {
    // SDK 인스턴스는 한 번만 초기화할 수 있으므로 StrictMode 중복 호출에도 같은 결과를 공유한다.
    initialization ??= (async () => {
      client ??= dependencies.loadKeycloak().then((KeycloakClient) => new KeycloakClient({ url: issuerUrl.origin, realm, clientId: config.clientId }))
      const keycloak = await client
      const authenticated = await keycloak.init(initOptions)
      return authenticated ? readToken(keycloak) : null
    })().catch((error: unknown) => {
      // 초기화나 콜백 검증에 실패하면 다음 로그인 시도에서 새 인스턴스로 다시 시작한다.
      client = null
      initialization = null
      throw error
    })
    return initialization
  }

  return {
    availability: { status: 'ready' },
    initialize,
    async signIn() {
      await initialize().catch(() => null)
      const keycloak = await client
      await keycloak?.login({ redirectUri })
    },
    async signOut() {
      const keycloak = client ? await client.catch(() => null) : null
      if (!keycloak?.didInitialize) return
      // GET 로그아웃은 id_token_hint가 URL에 남으므로 POST 방식으로 요청한다.
      await keycloak.logout({ redirectUri: postLogoutRedirectUri, logoutMethod: 'POST' })
    },
  }
}
