import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createAdminApiClient, isAllowedAdminApiPath } from '../api/adminApiClient'

// 실제 인증 제공자 없이 합성 토큰과 Mock fetch로 클라이언트 계약만 검증한다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const itemSchema = z.object({ id: z.string() })

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(response: Response | Error, token: string | null = SYNTHETIC_TOKEN) {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response
    return response
  })
  const onUnauthorized = vi.fn()
  const client = createAdminApiClient({ getAccessToken: () => token, onUnauthorized, fetchImpl })
  return { client, fetchImpl, onUnauthorized }
}

describe('관리자 공통 API 클라이언트', () => {
  it('유효한 토큰이 있을 때만 Bearer 헤더와 안전한 요청 옵션으로 동일 출처에 요청한다', async () => {
    const { client, fetchImpl } = setup(jsonResponse(200, { id: 'synthetic-1' }))
    const result = await client.request('/api/v1/cases?page=0', { schema: itemSchema })
    expect(result).toEqual({ kind: 'success', status: 200, data: { id: 'synthetic-1' } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/v1/cases?page=0')
    expect(String(url)).not.toContain(SYNTHETIC_TOKEN)
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
  })

  it('토큰이 없으면 요청을 보내지 않고 미인증으로 반환한다', async () => {
    const { client, fetchImpl, onUnauthorized } = setup(jsonResponse(200, { id: 'x' }), null)
    await expect(client.request('/api/v1/cases', { schema: itemSchema })).resolves.toEqual({ kind: 'unauthenticated' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('401은 세션 정리 콜백을 호출하고 미인증으로 반환한다', async () => {
    const { client, onUnauthorized } = setup(new Response(null, { status: 401 }))
    await expect(client.request('/api/v1/cases', { schema: itemSchema })).resolves.toEqual({ kind: 'unauthenticated' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('403 권한 부족과 404 범위 비노출을 구분하고 세션은 유지한다', async () => {
    const forbidden = setup(jsonResponse(403, { code: 'ROLE_MISSING' }))
    await expect(forbidden.client.request('/api/v1/cases/c-1', { schema: itemSchema })).resolves.toEqual({ kind: 'forbidden' })
    expect(forbidden.onUnauthorized).not.toHaveBeenCalled()

    const notFound = setup(jsonResponse(404, { code: 'OTHER_TENANT_RESOURCE', detail: 'tenant-b' }))
    const result = await notFound.client.request('/api/v1/cases/c-2', { schema: itemSchema })
    // 404는 존재하지 않음과 범위 밖을 구분하지 않으며 서버 본문을 결과에 담지 않는다.
    expect(result).toEqual({ kind: 'notFound' })
    expect(notFound.onUnauthorized).not.toHaveBeenCalled()
  })

  it('네트워크 오류, 계약과 다른 응답, 서버 오류 코드를 구분한다', async () => {
    await expect(setup(new TypeError('offline')).client.request('/api/v1/cases', { schema: itemSchema })).resolves.toEqual({ kind: 'network' })
    await expect(setup(jsonResponse(200, { unexpected: true })).client.request('/api/v1/cases', { schema: itemSchema })).resolves.toEqual({ kind: 'invalidResponse', status: 200 })
    await expect(setup(jsonResponse(409, { code: 'STATE_CONFLICT', detail: '내부 정보' })).client.request('/api/v1/cases', { schema: itemSchema })).resolves.toEqual({ kind: 'problem', status: 409, code: 'STATE_CONFLICT' })
    await expect(setup(jsonResponse(500, { code: 'lower-case' })).client.request('/api/v1/cases', { schema: itemSchema })).resolves.toEqual({ kind: 'problem', status: 500, code: 'UNKNOWN' })
  })

  it('JSON 본문과 본문 없는 응답을 처리한다', async () => {
    const { client, fetchImpl } = setup(new Response(null, { status: 204 }))
    await expect(client.request('/api/v1/cases/c-1/assignee', { method: 'PUT', body: { assignee: 'synthetic' }, schema: z.undefined() })).resolves.toEqual({ kind: 'success', status: 204, data: undefined })
    const init = fetchImpl.mock.calls[0][1]
    expect(init?.body).toBe(JSON.stringify({ assignee: 'synthetic' }))
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('다른 출처, 공개 팬 제보 API, 반입 API, 비정상 경로에는 토큰을 보내지 않는다', async () => {
    const blocked = ['https://evil.example/api/v1/cases', '//evil.example/api/v1/cases', '/api/v1/fan-reports', '/api/v1/fan-reports/lookup', '/api/v1/audits/analyze', '/api/v1/../v1/cases', '/api/v1/cases/./x', '/api/v2/cases', 'api/v1/cases', '/api/v1/cases#frag']
    for (const path of blocked) {
      expect(isAllowedAdminApiPath(path)).toBe(false)
      const { client, fetchImpl } = setup(jsonResponse(200, { id: 'x' }))
      await expect(client.request(path, { schema: itemSchema })).rejects.toThrow(TypeError)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
    expect(isAllowedAdminApiPath('/api/v1/admin/fan-reports/r-1/evidence/e-1/listing-analyses')).toBe(true)
  })

  it('퍼센트 인코딩으로 경로 정규화를 우회하는 요청에는 토큰을 보내지 않는다', async () => {
    const blocked = [
      '/api/v1/cases/%2e%2e/fan-reports',
      '/api/v1/cases/%2E%2E/fan-reports/lookup',
      '/api/v1/cases/%2e%2e/audits/analyze',
      '/api/v1/cases/.%2e/fan-reports',
      '/api/v1/cases/%2e./fan-reports',
      '/api/v1/cases/%2e/x',
      '/api/v1/cases/%2e%2e%2ffan-reports',
      '/api/v1/cases%2f..%2ffan-reports',
      '/api/v1/cases/%5c..%5cfan-reports',
      '/api/v1/%66an-reports',
      '/api/v1/fan-reports%2flookup',
      '/api/v1/cases/%252e%252e/fan-reports',
      '/api/v1/cases/c-1%3fx=1',
      '/api/v1/cases/c-1%23frag',
      '/api/v1/cases/%zz',
      '/api/v1/cases\\..\\fan-reports',
      '/api/v1/cases/c-1?q=%zz',
      '/api/v1/cases/c-1?q=%2',
    ]
    for (const path of blocked) {
      expect(isAllowedAdminApiPath(path), path).toBe(false)
      const { client, fetchImpl } = setup(jsonResponse(200, { id: 'x' }))
      await expect(client.request(path, { method: 'POST', body: {}, schema: itemSchema }), path).rejects.toThrow(TypeError)
      expect(fetchImpl, path).not.toHaveBeenCalled()
    }
  })

  it('정상 관리자 경로와 페이지, 필터 쿼리는 그대로 허용한다', async () => {
    const allowed = [
      '/api/v1/cases',
      '/api/v1/cases?page=0&size=20',
      '/api/v1/cases?status=OPEN&eventId=3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      '/api/v1/cases?keyword=%ED%85%8C%EC%8A%A4%ED%8A%B8&sort=createdAt%2Cdesc',
      '/api/v1/admin/track1/clusters/detail?clusterId=cl-1',
      '/api/v1/cases/c-1/report-versions',
      '/api/v1/approval-requests/a-1/decision',
      '/api/v1/cases/c-1/assignee',
    ]
    for (const path of allowed) expect(isAllowedAdminApiPath(path), path).toBe(true)

    for (const [path, method] of [['/api/v1/cases?page=1&size=20', 'GET'], ['/api/v1/approval-requests/a-1/decision', 'POST'], ['/api/v1/cases/c-1/assignee', 'PUT']] as const) {
      const { client, fetchImpl } = setup(jsonResponse(200, { id: 'ok' }))
      await expect(client.request(path, { method, body: method === 'GET' ? undefined : { value: 'synthetic' }, schema: itemSchema })).resolves.toEqual({ kind: 'success', status: 200, data: { id: 'ok' } })
      expect(fetchImpl.mock.calls[0][0]).toBe(path)
      expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method, redirect: 'error', credentials: 'omit' })
    }
  })
})
