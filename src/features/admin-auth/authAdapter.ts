import { readAdminAuthConfig } from './authConfig'
import type { AdminAuthConfig } from './authConfig'
import { createKeycloakAdminAuthAdapter } from './keycloakAdapter'

// 운영 인증 제공자(OIDC 또는 기업 SSO)는 아직 확정되지 않았다. 캡스톤 검증에는 격리 Keycloak 어댑터를 사용한다.
// 다른 제공자가 확정되면 이 인터페이스를 구현하는 Authorization Code + PKCE 어댑터를 추가한다.
// 프런트엔드는 토큰을 발급하거나 역할, tenant를 부여하지 않고 제공자가 발급한 액세스 토큰만 전달한다.

/** 제공자가 발급한 액세스 토큰. expiresAt은 epoch 밀리초다. */
export type AdminAccessToken = Readonly<{ value: string; expiresAt: number }>

export type AdminAuthUnavailableReason = 'configMissing' | 'configInvalid' | 'providerUndecided'

export type AdminAuthAvailability = { status: 'ready' } | { status: 'unavailable'; reason: AdminAuthUnavailableReason }

export interface AdminAuthAdapter {
  readonly availability: AdminAuthAvailability
  /** 제공자 콜백이나 제공자 세션에서만 토큰을 복구한다. 브라우저 저장소에서 토큰을 읽지 않는다. 여러 번 호출되어도 안전해야 한다. */
  initialize(): Promise<AdminAccessToken | null>
  /** 제공자 로그인 화면으로 이동한다. 성공 여부는 initialize 결과로만 판단한다. */
  signIn(): Promise<void>
  /** 제공자 세션 종료를 요청한다. 로컬 메모리 세션은 호출 전에 이미 정리된다. */
  signOut(): Promise<void>
}

/** 토큰을 만료 판정할 때 서버와의 시계 차이를 고려한 여유 시간 */
export const accessTokenExpirySkewMs = 30_000

const compactJwsPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const maxTokenLength = 16_384

/** 형식이 올바르고 만료 여유 시간 전인 토큰만 사용한다. 서명과 claim 검증은 Backend가 담당한다. */
export function isUsableAccessToken(token: unknown, now: number = Date.now()): token is AdminAccessToken {
  if (typeof token !== 'object' || token === null) return false
  const { value, expiresAt } = token as { value?: unknown; expiresAt?: unknown }
  return typeof value === 'string' && value.length <= maxTokenLength && compactJwsPattern.test(value)
    && typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt - accessTokenExpirySkewMs > now
}

/** 로그인을 제공하지 않는 어댑터. 가짜 로그인 성공이나 임의 토큰을 만들지 않는다. */
export function createUnavailableAdminAuthAdapter(reason: AdminAuthUnavailableReason): AdminAuthAdapter {
  return {
    availability: { status: 'unavailable', reason },
    initialize: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
  }
}

/** 설정을 확인해 사용할 어댑터를 고른다. 제공자가 지정되지 않으면 설정이 올바르더라도 로그인은 비활성이다. */
export function createDefaultAdminAuthAdapter(config: AdminAuthConfig = readAdminAuthConfig()): AdminAuthAdapter {
  if (config.status === 'missing') return createUnavailableAdminAuthAdapter('configMissing')
  if (config.status === 'invalid') return createUnavailableAdminAuthAdapter('configInvalid')
  if (config.provider === 'keycloak') return createKeycloakAdminAuthAdapter(config)
  return createUnavailableAdminAuthAdapter('providerUndecided')
}
