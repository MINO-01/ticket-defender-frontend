// 로그인 전 관리자 주소를 현재 탭의 sessionStorage에 잠시 보관했다가 로그인 콜백 후 한 번만 복원한다.
// Keycloak Redirect URI는 등록된 고정 주소(/app/overview)를 그대로 쓰고, 토큰이나 인증 응답 값은 저장하지 않는다.
// 복원 경로는 동일 출처의 /app 하위 경로와 쿼리만 허용해 외부 주소나 공개 화면으로의 이동을 막는다.

export const adminReturnPathStorageKey = 'ticket-defender.admin.returnPath'
/** 로그인 화면에서 오래 머문 뒤 다른 경로로 이동하지 않도록 보관 시간을 제한한다. */
const maxAgeMs = 10 * 60_000
const maxPathLength = 2048
const probeOrigin = 'https://admin-return.invalid'

export function isSafeAdminReturnPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > maxPathLength) return false
  if (path !== '/app' && !path.startsWith('/app/') && !path.startsWith('/app?')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\#]/.test(path) || path.includes('//')) return false
  try {
    // 정규화 결과가 원문과 다르면 %2e%2e 같은 경로 이탈이 숨어 있을 수 있으므로 거부한다.
    const url = new URL(path, probeOrigin)
    return url.origin === probeOrigin && `${url.pathname}${url.search}` === path && (url.pathname === '/app' || url.pathname.startsWith('/app/'))
  } catch {
    return false
  }
}

export function rememberAdminReturnPath(path: string) {
  try {
    if (isSafeAdminReturnPath(path)) sessionStorage.setItem(adminReturnPathStorageKey, JSON.stringify({ path, savedAt: Date.now() }))
    else sessionStorage.removeItem(adminReturnPathStorageKey)
  } catch {
    // 저장소를 쓸 수 없으면 복원 없이 기존 콜백 주소로 이동한다.
  }
}

/** 보관한 경로를 꺼내고 항상 지운다. 유효하지 않거나 오래된 값은 null이다. */
export function takeAdminReturnPath(): string | null {
  try {
    const raw = sessionStorage.getItem(adminReturnPathStorageKey)
    sessionStorage.removeItem(adminReturnPathStorageKey)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { path, savedAt } = parsed as { path?: unknown; savedAt?: unknown }
    if (typeof savedAt !== 'number' || savedAt > Date.now() || Date.now() - savedAt > maxAgeMs) return null
    return isSafeAdminReturnPath(path) ? path : null
  } catch {
    return null
  }
}
