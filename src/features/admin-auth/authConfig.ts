// 관리자 인증 제공자에 필요한 공개 설정만 읽는다. client secret 같은 비밀값은 브라우저 설정으로 받지 않는다.
// Backend는 issuer, JWKS, audience, 만료 시각, subject를 검증하며 tenant/event 범위와 역할은 서버가 판단한다.

export type AdminAuthConfig =
  | { status: 'configured'; issuer: string; clientId: string; audience: string }
  | { status: 'missing' }
  | { status: 'invalid' }

type AdminAuthEnv = Readonly<Record<string, unknown>>

const clientIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

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

/** 설정이 모두 비어 있으면 missing, 일부만 있거나 형식이 잘못되면 invalid로 판단해 관리자 기능을 막는다. */
export function readAdminAuthConfig(env: AdminAuthEnv = import.meta.env): AdminAuthConfig {
  const issuer = readText(env.VITE_ADMIN_AUTH_ISSUER)
  const clientId = readText(env.VITE_ADMIN_AUTH_CLIENT_ID)
  const audience = readText(env.VITE_ADMIN_AUTH_AUDIENCE)
  if (!issuer && !clientId && !audience) return { status: 'missing' }
  if (!isHttpsUrl(issuer) || !clientIdPattern.test(clientId) || audience.length === 0 || audience.length > 255) return { status: 'invalid' }
  return { status: 'configured', issuer, clientId, audience }
}

/** 개발 빌드에서 명시적으로 켠 경우에만 합성 데이터 관리자 화면 미리보기를 허용한다. 운영 빌드에서는 항상 false다. */
export function isAdminDemoPreviewEnabled(env: AdminAuthEnv = import.meta.env) {
  return env.DEV === true && readText(env.VITE_ADMIN_DEMO_PREVIEW) === 'true'
}
