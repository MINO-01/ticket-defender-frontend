import type { z } from 'zod'
import { readProblemCode } from './problemDetails'

// 관리자 업무 API를 동일 출처로 호출하는 공통 클라이언트다.
// 유효한 액세스 토큰이 있을 때만 Authorization: Bearer를 붙이고, 토큰은 URL, 로그, 브라우저 저장소에 남기지 않는다.
// tenant/event 접근 범위와 역할은 Backend AdminAccessService가 판단하며 클라이언트는 응답 상태만 구분한다.

export type AdminApiResult<T> =
  | { kind: 'success'; status: number; data: T }
  /** 유효한 세션이 없어 요청하지 않았거나 서버가 401로 거부했다. */
  | { kind: 'unauthenticated' }
  /** 인증은 되었지만 필요한 역할이 없다. */
  | { kind: 'forbidden' }
  /** 존재하지 않거나 접근 범위 밖이다. 서버 정책에 따라 두 경우를 구분하지 않는다. */
  | { kind: 'notFound' }
  | { kind: 'problem'; status: number; code: string }
  | { kind: 'network' }
  | { kind: 'invalidResponse'; status: number }

export type AdminApiRequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PUT'
  /** JSON으로 직렬화할 요청 본문 */
  body?: unknown
  /** 성공 응답 검증 스키마. 검증에 실패한 응답은 성공으로 처리하지 않는다. */
  schema: z.ZodType<T>
  signal?: AbortSignal
}

export type AdminApiClientOptions = {
  /** 만료되지 않은 액세스 토큰만 반환하고, 없으면 null을 반환한다. */
  getAccessToken: () => string | null
  /** 서버가 401을 반환하면 호출해 로컬 세션을 정리한다. */
  onUnauthorized: () => void
  fetchImpl?: typeof fetch
}

export type AdminApiClient = {
  request<T>(path: string, options: AdminApiRequestOptions<T>): Promise<AdminApiResult<T>>
}

// pathname에는 퍼센트 인코딩을 전부 허용하지 않는다. 브라우저와 서버가 %2e, %2f, %5c 등을 다르게 정규화하면
// 원문 검사를 통과한 경로가 공개 API로 바뀔 수 있기 때문이다. 관리자 API 식별자는 UUID와 영문 식별자라 인코딩이 필요 없다.
const adminPathnamePattern = /^\/api\/v1\/[A-Za-z0-9\-._~/]+$/
// 쿼리는 경로 해석에 영향을 주지 않으므로 검색어, 정렬 등에 필요한 올바른 퍼센트 인코딩만 허용한다.
const adminQueryPattern = /^(?:[A-Za-z0-9\-._~&=+]|%[0-9A-Fa-f]{2})*$/
// 공개 팬 제보 API와 Track 1 반입 API는 관리자 토큰을 받지 않는 별도 보안 경계다.
const blockedPathPrefixes = ['/api/v1/fan-reports', '/api/v1/audits/analyze']

/** 동일 출처 관리자 API 경로만 허용해 토큰이 다른 출처나 공개 API로 전달되지 않게 한다. */
export function isAllowedAdminApiPath(path: string) {
  const queryIndex = path.indexOf('?')
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : path.slice(queryIndex + 1)
  if (!adminPathnamePattern.test(pathname) || !adminQueryPattern.test(query) || pathname.includes('//')) return false
  if (pathname.split('/').some((segment) => segment === '..' || segment === '.')) return false
  // 브라우저 URL 정규화 결과가 원문과 다르면 실제 요청 대상이 달라질 수 있으므로 차단한다.
  if (new URL(pathname, 'https://admin-api.invalid').pathname !== pathname) return false
  return !blockedPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function createAdminApiClient({ getAccessToken, onUnauthorized, fetchImpl }: AdminApiClientOptions): AdminApiClient {
  return {
    async request<T>(path: string, { method = 'GET', body, schema, signal }: AdminApiRequestOptions<T>): Promise<AdminApiResult<T>> {
      if (!isAllowedAdminApiPath(path)) throw new TypeError('허용되지 않은 관리자 API 경로입니다')
      const token = getAccessToken()
      if (!token) return { kind: 'unauthenticated' }

      const headers: Record<string, string> = { Accept: 'application/json, application/problem+json', Authorization: `Bearer ${token}` }
      if (body !== undefined) headers['Content-Type'] = 'application/json'

      let response: Response
      try {
        // 리다이렉트를 따라가지 않아 Authorization 헤더가 다른 주소로 전달되지 않게 한다.
        response = await (fetchImpl ?? fetch)(path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          redirect: 'error',
          signal,
        })
      } catch {
        return { kind: 'network' }
      }

      if (response.status === 401) {
        onUnauthorized()
        return { kind: 'unauthenticated' }
      }
      if (response.status === 403) return { kind: 'forbidden' }
      if (response.status === 404) return { kind: 'notFound' }
      if (response.status >= 200 && response.status < 300) {
        try {
          const payload: unknown = response.status === 204 ? undefined : await response.json()
          const parsed = schema.safeParse(payload)
          if (parsed.success) return { kind: 'success', status: response.status, data: parsed.data }
        } catch {
          // 본문을 읽지 못한 응답은 성공으로 표시하지 않는다.
        }
        return { kind: 'invalidResponse', status: response.status }
      }
      return { kind: 'problem', status: response.status, code: await readProblemCode(response) }
    },
  }
}
