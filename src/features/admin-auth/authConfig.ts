// 관리자 인증 제공자에 필요한 공개 설정만 읽는다. client secret 같은 비밀값은 브라우저 설정으로 받지 않는다.
// Backend는 issuer, JWKS, audience, 만료 시각, subject를 검증하며 tenant/event 범위와 역할은 서버가 판단한다.

/** 캡스톤 합성 데이터 검증용으로 연결한 제공자. 운영 인증 제공자 선정과는 별개이며 null이면 제공자 미확정이다. */
export type AdminAuthProvider = 'keycloak'

export type AdminAuthConfig =
  | { status: 'configured'; provider: AdminAuthProvider | null; issuer: string; clientId: string; audience: string }
  | { status: 'missing' }
  | { status: 'invalid' }

type AdminAuthEnv = Readonly<Record<string, unknown>>

const clientIdPattern = /^[A-Za-z0-9._:-]{1,128}$/
// Keycloak issuer는 https://호스트/realms/realm 형식이어야 한다.
const keycloakRealmPathPattern = /^\/realms\/[A-Za-z0-9._-]{1,64}$/

function readText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Backend와 같이 issuer는 host가 있는 HTTPS 주소만 허용한다. */
function isHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0 && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** issuer가 query, fragment, 끝 슬래시 없이 Keycloak realm 경로만 가리키는지 확인한다. */
export function isKeycloakIssuer(issuer: string) {
  try {
    const url = new URL(issuer)
    return url.search === '' && url.hash === '' && keycloakRealmPathPattern.test(url.pathname) && `${url.origin}${url.pathname}` === issuer
  } catch {
    return false
  }
}

/** 설정이 모두 비어 있으면 missing, 일부만 있거나 형식이 잘못되면 invalid로 판단해 관리자 기능을 막는다. */
export function readAdminAuthConfig(env: AdminAuthEnv = import.meta.env): AdminAuthConfig {
  const providerText = readText(env.VITE_ADMIN_AUTH_PROVIDER)
  const issuer = readText(env.VITE_ADMIN_AUTH_ISSUER)
  const clientId = readText(env.VITE_ADMIN_AUTH_CLIENT_ID)
  const audience = readText(env.VITE_ADMIN_AUTH_AUDIENCE)
  if (!providerText && !issuer && !clientId && !audience) return { status: 'missing' }
  if (!isHttpsUrl(issuer) || !clientIdPattern.test(clientId) || audience.length === 0 || audience.length > 255) return { status: 'invalid' }
  // 제공자 값이 비어 있으면 미확정으로 남겨 로그인을 막고, 알 수 없는 값이나 형식이 맞지 않는 issuer는 설정 오류로 차단한다.
  if (!providerText) return { status: 'configured', provider: null, issuer, clientId, audience }
  if (providerText !== 'keycloak' || !isKeycloakIssuer(issuer)) return { status: 'invalid' }
  return { status: 'configured', provider: 'keycloak', issuer, clientId, audience }
}

/** 개발 빌드에서 명시적으로 켠 경우에만 합성 데이터 관리자 화면 미리보기를 허용한다. 운영 빌드에서는 항상 false다. */
export function isAdminDemoPreviewEnabled(env: AdminAuthEnv = import.meta.env) {
  return env.DEV === true && readText(env.VITE_ADMIN_DEMO_PREVIEW) === 'true'
}
