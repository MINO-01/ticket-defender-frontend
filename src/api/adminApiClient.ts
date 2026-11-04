import type { z } from 'zod'
import { detectImageMediaType, readImageContentType, readLimitedBody } from './imageResponse'
import type { EvidenceImageMediaType } from './imageResponse'
import { isPdfContentType, looksLikePdf, maxOfficialPdfBytes } from './pdfResponse'
import { readProblemCode } from './problemDetails'

// 관리자 업무 API를 동일 출처로 호출하는 공통 클라이언트다.
// 유효한 액세스 토큰이 있을 때만 Authorization: Bearer를 붙이고, 토큰은 URL, 로그, 브라우저 저장소에 남기지 않는다.
// tenant/event 접근 범위와 역할은 Backend AdminAccessService가 판단하며 클라이언트는 응답 상태만 구분한다.

export type AdminApiResult<T> =
  | { kind: 'success'; status: number; data: T }
  /** 유효한 세션이 없어 요청하지 않았거나 서버가 401로 거부했다. */
  | { kind: 'unauthenticated' }
  /** 인증은 되었지만 필요한 역할이 없다. code는 허용 목록의 안정 코드일 때만 붙는다. */
  | { kind: 'forbidden'; code?: ForbiddenProblemCode }
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
  /** 멱등 POST, PUT 키. UUID v4 형식만 Idempotency-Key 헤더로 보내며 임의 헤더는 받지 않는다. Backend Case 담당자 PUT도 이 헤더를 요구한다. */
  idempotencyKey?: string
  /** 계약상 성공 상태. 지정하면 다른 2xx 응답은 계약 위반으로 처리한다. */
  successStatus?: number
}

export type AdminImageRequestOptions = {
  signal?: AbortSignal
}

/** 크기와 형식 검사를 통과한 이미지 바이트. 브라우저 저장소에 보관하지 않고 화면 표시에만 쓴다. */
export type AdminImage = { blob: Blob; mediaType: EvidenceImageMediaType; byteSize: number }

/** 형식과 Frontend 임시 상한 검사를 통과한 PDF 바이트. 무결성 비교와 임시 다운로드에만 쓰고 브라우저 저장소에 보관하지 않는다. */
export type AdminPdf = { bytes: Uint8Array<ArrayBuffer>; byteSize: number }

export type AdminApiClientOptions = {
  /** 만료되지 않은 액세스 토큰만 반환하고, 없으면 null을 반환한다. */
  getAccessToken: () => string | null
  /** 서버가 401을 반환하면 호출해 로컬 세션을 정리한다. */
  onUnauthorized: () => void
  fetchImpl?: typeof fetch
}

export type AdminApiClient = {
  request<T>(path: string, options: AdminApiRequestOptions<T>): Promise<AdminApiResult<T>>
  /** PNG, JPEG 바이너리 GET 전용 요청. 성공 본문을 JSON으로 읽지 않는다. */
  requestImage(path: string, options?: AdminImageRequestOptions): Promise<AdminApiResult<AdminImage>>
  /** 공식 PDF 바이너리 GET 전용 요청. 성공 본문을 JSON으로 읽지 않는다. */
  requestPdf(path: string, options?: AdminImageRequestOptions): Promise<AdminApiResult<AdminPdf>>
}

type AdminApiFailureResult = Exclude<AdminApiResult<never>, { kind: 'success' }>

// pathname에는 퍼센트 인코딩을 전부 허용하지 않는다. 브라우저와 서버가 %2e, %2f, %5c 등을 다르게 정규화하면
// 원문 검사를 통과한 경로가 공개 API로 바뀔 수 있기 때문이다. 관리자 API 식별자는 UUID와 영문 식별자라 인코딩이 필요 없다.
const adminPathnamePattern = /^\/api\/v1\/[A-Za-z0-9\-._~/]+$/
// 쿼리는 경로 해석에 영향을 주지 않으므로 검색어, 정렬 등에 필요한 올바른 퍼센트 인코딩만 허용한다.
const adminQueryPattern = /^(?:[A-Za-z0-9\-._~&=+]|%[0-9A-Fa-f]{2})*$/
// 공개 팬 제보 API와 Track 1 반입 API는 관리자 토큰을 받지 않는 별도 보안 경계다.
const blockedPathPrefixes = ['/api/v1/fan-reports', '/api/v1/audits/analyze']
// 403 본문에서 읽는 코드 허용 목록이다. 역할 부족과 업무 규칙 차단을 구분해야 하는 코드만 두고, 나머지 403은 코드 없이 권한 오류로 처리한다.
const forbiddenProblemCodes = ['SELF_APPROVAL_FORBIDDEN'] as const
export type ForbiddenProblemCode = (typeof forbiddenProblemCodes)[number]
const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Backend가 받는 UUID v4 형식인지 확인한다. 줄바꿈 등 헤더 주입 문자가 섞인 값은 통과하지 않는다. */
export function isIdempotencyKey(value: string) {
  return idempotencyKeyPattern.test(value)
}

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

/** 쿼리 값을 RFC 3986 비예약 문자 외에는 모두 퍼센트 인코딩한다. 슬래시가 포함된 분석 ID도 경로가 아닌 쿼리 값으로 전달된다. */
function encodeQueryComponent(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** 고정 경로와 쿼리 값으로 관리자 API 경로를 만든다. 결과는 isAllowedAdminApiPath 검사를 통과하는 형식이다. */
export function adminApiPath(pathname: string, params: Record<string, string | number>) {
  const query = Object.entries(params).map(([key, value]) => `${encodeQueryComponent(key)}=${encodeQueryComponent(String(value))}`).join('&')
  return query ? `${pathname}?${query}` : pathname
}

export function createAdminApiClient({ getAccessToken, onUnauthorized, fetchImpl }: AdminApiClientOptions): AdminApiClient {
  /** JSON 요청과 이미지 요청이 같은 경로 검사, 토큰, 요청 옵션, 401 처리를 쓰도록 한 곳에서 보낸다. */
  async function send(path: string, method: 'GET' | 'POST' | 'PUT', accept: string, body: unknown, signal: AbortSignal | undefined, idempotencyKey?: string): Promise<{ kind: 'response'; response: Response } | AdminApiFailureResult> {
    if (!isAllowedAdminApiPath(path)) throw new TypeError('허용되지 않은 관리자 API 경로입니다')
    if (idempotencyKey !== undefined && (method === 'GET' || !isIdempotencyKey(idempotencyKey))) throw new TypeError('허용되지 않은 멱등성 키입니다')
    const token = getAccessToken()
    if (!token) return { kind: 'unauthenticated' }

    const headers: Record<string, string> = { Accept: accept, Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey

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
    if (response.status === 403) {
      const code = await readProblemCode(response)
      const known = forbiddenProblemCodes.find((item) => item === code)
      return known === undefined ? { kind: 'forbidden' } : { kind: 'forbidden', code: known }
    }
    if (response.status === 404) return { kind: 'notFound' }
    if (response.status >= 200 && response.status < 300) return { kind: 'response', response }
    return { kind: 'problem', status: response.status, code: await readProblemCode(response) }
  }

  return {
    async request<T>(path: string, { method = 'GET', body, schema, signal, idempotencyKey, successStatus }: AdminApiRequestOptions<T>): Promise<AdminApiResult<T>> {
      const sent = await send(path, method, 'application/json, application/problem+json', body, signal, idempotencyKey)
      if (sent.kind !== 'response') return sent
      const { response } = sent
      if (successStatus !== undefined && response.status !== successStatus) {
        await response.body?.cancel().catch(() => undefined)
        return { kind: 'invalidResponse', status: response.status }
      }
      try {
        const payload: unknown = response.status === 204 ? undefined : await response.json()
        const parsed = schema.safeParse(payload)
        if (parsed.success) return { kind: 'success', status: response.status, data: parsed.data }
      } catch {
        // 본문을 읽지 못한 응답은 성공으로 표시하지 않는다.
      }
      return { kind: 'invalidResponse', status: response.status }
    },

    async requestImage(path: string, { signal }: AdminImageRequestOptions = {}): Promise<AdminApiResult<AdminImage>> {
      const sent = await send(path, 'GET', 'image/png, image/jpeg, application/problem+json', undefined, signal)
      if (sent.kind !== 'response') return sent
      const { response } = sent
      // 200 HTML 로그인 화면이나 JSON 오류 본문을 이미지로 표시하지 않도록 상태, 선언 형식, 실제 바이트 형식을 모두 확인한다.
      const declared = readImageContentType(response.headers.get('Content-Type'))
      if (response.status !== 200 || declared === null) {
        await response.body?.cancel().catch(() => undefined)
        return { kind: 'invalidResponse', status: response.status }
      }
      const bytes = await readLimitedBody(response)
      if (bytes === null || detectImageMediaType(bytes) !== declared) return { kind: 'invalidResponse', status: response.status }
      return { kind: 'success', status: response.status, data: { blob: new Blob([bytes], { type: declared }), mediaType: declared, byteSize: bytes.byteLength } }
    },

    async requestPdf(path: string, { signal }: AdminImageRequestOptions = {}): Promise<AdminApiResult<AdminPdf>> {
      const sent = await send(path, 'GET', 'application/pdf, application/problem+json', undefined, signal)
      if (sent.kind !== 'response') return sent
      const { response } = sent
      // 상태와 선언 형식을 먼저 확인하고, 상한 안에서만 본문을 읽은 뒤 PDF 서명과 끝 표시를 보조로 확인한다.
      if (response.status !== 200 || !isPdfContentType(response.headers.get('Content-Type'))) {
        await response.body?.cancel().catch(() => undefined)
        return { kind: 'invalidResponse', status: response.status }
      }
      const bytes = await readLimitedBody(response, maxOfficialPdfBytes)
      if (bytes === null || !looksLikePdf(bytes)) return { kind: 'invalidResponse', status: response.status }
      return { kind: 'success', status: response.status, data: { bytes, byteSize: bytes.byteLength } }
    },
  }
}
