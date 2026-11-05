import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createAdminApiClient, isAllowedAdminApiPath } from '../api/adminApiClient'
import { maxOfficialPdfBytes } from '../api/pdfResponse'

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

  it('403은 허용된 안정 코드만 읽고, 코드가 없거나 형식이 다르면 기존 권한 오류로 처리한다', async () => {
    const self = setup(jsonResponse(403, { code: 'SELF_APPROVAL_FORBIDDEN', detail: '내부 멤버십 정보' }))
    await expect(self.client.request('/api/v1/approval-requests/r-1/decision', { schema: itemSchema })).resolves.toEqual({ kind: 'forbidden', code: 'SELF_APPROVAL_FORBIDDEN' })
    for (const response of [
      jsonResponse(403, { code: 'FORBIDDEN' }),
      jsonResponse(403, { code: 'self_approval_forbidden' }),
      jsonResponse(403, { code: 42 }),
      jsonResponse(403, {}),
      new Response('<html>forbidden</html>', { status: 403 }),
      new Response(null, { status: 403 }),
    ]) {
      await expect(setup(response).client.request('/api/v1/cases/c-1', { schema: itemSchema })).resolves.toEqual({ kind: 'forbidden' })
    }
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
  it('검증된 UUID v4 Idempotency-Key만 본문 없는 POST에 붙이고 기존 보안 옵션을 유지한다', async () => {
    const key = '0f8fad5b-d9cb-469f-a165-70867728950e'
    const { client, fetchImpl } = setup(jsonResponse(201, { id: 'run-1' }))
    const path = '/api/v1/admin/fan-reports/r-1/evidence/e-1/listing-analyses'
    await expect(client.request(path, { method: 'POST', idempotencyKey: key, successStatus: 201, schema: itemSchema })).resolves.toEqual({ kind: 'success', status: 201, data: { id: 'run-1' } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(path)
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toEqual({ Accept: 'application/json, application/problem+json', Authorization: `Bearer ${SYNTHETIC_TOKEN}`, 'Idempotency-Key': key })
  })

  it('Case 담당자 PUT에도 검증된 Idempotency-Key와 JSON 본문을 함께 보낸다', async () => {
    const key = '0f8fad5b-d9cb-469f-a165-70867728950e'
    const { client, fetchImpl } = setup(jsonResponse(200, { id: 'case-1' }))
    await expect(client.request('/api/v1/cases/c-1/assignee', { method: 'PUT', body: { reason: 'synthetic' }, idempotencyKey: key, successStatus: 200, schema: itemSchema })).resolves.toEqual({ kind: 'success', status: 200, data: { id: 'case-1' } })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify({ reason: 'synthetic' }), redirect: 'error' })
    expect(init?.headers).toEqual({ Accept: 'application/json, application/problem+json', Authorization: `Bearer ${SYNTHETIC_TOKEN}`, 'Content-Type': 'application/json', 'Idempotency-Key': key })
  })

  it('UUID v4가 아니거나 GET 요청의 Idempotency-Key는 요청 전에 거부한다', async () => {
    const invalid: [string, 'GET' | 'POST' | 'PUT'][] = [
      ['0f8fad5b-d9cb-169f-a165-70867728950e', 'POST'],
      ['0f8fad5b-d9cb-469f-c165-70867728950e', 'POST'],
      ['not-a-uuid', 'POST'],
      ['0f8fad5b-d9cb-469f-a165-70867728950e\r\nX-Injected: 1', 'POST'],
      ['', 'POST'],
      ['0f8fad5b-d9cb-469f-a165-70867728950e', 'GET'],
      ['not-a-uuid', 'PUT'],
    ]
    for (const [key, method] of invalid) {
      const { client, fetchImpl } = setup(jsonResponse(201, { id: 'x' }))
      await expect(client.request('/api/v1/admin/fan-reports/r-1/evidence/e-1/listing-analyses', { method, idempotencyKey: key, schema: itemSchema }), key).rejects.toThrow(TypeError)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('지정한 성공 상태와 다른 2xx 응답은 성공으로 처리하지 않는다', async () => {
    const { client } = setup(jsonResponse(200, { id: 'run-1' }))
    await expect(client.request('/api/v1/cases', { method: 'POST', successStatus: 201, schema: itemSchema })).resolves.toEqual({ kind: 'invalidResponse', status: 200 })
    const plain = setup(jsonResponse(200, { id: 'x' }))
    await plain.client.request('/api/v1/cases', { schema: itemSchema })
    expect(Object.keys(plain.fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)).not.toContain('Idempotency-Key')
  })

  it('PATCH는 JSON 본문과 기존 보안 옵션으로 보내고 키를 지정하지 않으면 Idempotency-Key를 붙이지 않는다', async () => {
    const { client, fetchImpl } = setup(jsonResponse(200, { id: 'p-1' }))
    const result = await client.request('/api/v1/admin/events/e-1/verified-performances/p-1', { method: 'PATCH', body: { sourceVersion: 'v2' }, successStatus: 200, schema: itemSchema })
    expect(result).toEqual({ kind: 'success', status: 200, data: { id: 'p-1' } })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ sourceVersion: 'v2' }), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}`, 'Content-Type': 'application/json' })
    expect(Object.keys(init?.headers as Record<string, string>)).not.toContain('Idempotency-Key')
  })

  it('GET, POST, PUT, PATCH 모두 401이면 세션을 정리하고 허용되지 않은 경로에는 보내지 않는다', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH'] as const) {
      const unauthorized = setup(new Response(null, { status: 401 }))
      await expect(unauthorized.client.request('/api/v1/admin/events/e-1/verified-performances', { method, schema: itemSchema }), method).resolves.toEqual({ kind: 'unauthenticated' })
      expect(unauthorized.onUnauthorized, method).toHaveBeenCalledOnce()
      const outside = setup(jsonResponse(200, { id: 'x' }))
      await expect(outside.client.request('https://example.invalid/api/v1/cases', { method, schema: itemSchema }), method).rejects.toThrow(TypeError)
      expect(outside.fetchImpl, method).not.toHaveBeenCalled()
    }
  })

  describe('공식 PDF 바이너리 요청', () => {
    const path = '/api/v1/official-pdf-issuances/6b3f1c2e-8a4d-4f5b-9c6d-7e8f9a0b1c2d/download'
    const pdf = (text: string) => new TextEncoder().encode(text)
    const pdfResponse = (bytes: Uint8Array, headers: Record<string, string> = {}, status = 200) =>
      new Response(bytes.slice(), { status, headers: { 'Content-Type': 'application/pdf', ...headers } })

    it('Bearer와 기존 보안 옵션으로 GET하고 application/pdf 200 응답의 바이트만 돌려준다', async () => {
      const bytes = pdf('%PDF-1.7\n합성 본문\n%%EOF\n')
      const { client, fetchImpl } = setup(pdfResponse(bytes, { 'Content-Length': String(bytes.byteLength) }))
      const result = await client.requestPdf(path)
      expect(result.kind).toBe('success')
      if (result.kind !== 'success') return
      expect(result.data.byteSize).toBe(bytes.byteLength)
      expect(Array.from(result.data.bytes)).toEqual(Array.from(bytes))
      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toBe(path)
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}`, Accept: 'application/pdf, application/problem+json' })
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' })
    })

    it('끝의 개행, 공백과 매개변수가 있는 Content-Type은 정상 PDF로 받는다', async () => {
      const { client } = setup(pdfResponse(pdf('%PDF-1.4\nx\n%%EOF\r\n  \n'), { 'Content-Type': 'Application/PDF; charset=binary' }))
      await expect(client.requestPdf(path)).resolves.toMatchObject({ kind: 'success' })
    })

    it.each([
      ['JSON 형식', pdfResponse(pdf('%PDF-1.7\n%%EOF'), { 'Content-Type': 'application/json' })],
      ['HTML 로그인 화면', new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
      ['형식 없음', new Response(pdf('%PDF-1.7\n%%EOF'), { status: 200 })],
      ['PDF 서명 없음', pdfResponse(pdf('PK\u0003\u0004 not a pdf %%EOF'))],
      ['끝 표시 없음(잘린 PDF)', pdfResponse(pdf('%PDF-1.7\n1 0 obj'))],
      ['200이 아닌 2xx', pdfResponse(pdf('%PDF-1.7\n%%EOF'), {}, 206)],
      ['Content-Length와 실제 크기 불일치', pdfResponse(pdf('%PDF-1.7\n%%EOF'), { 'Content-Length': '999' })],
    ])('%s 응답은 PDF로 받지 않는다', async (_label, response) => {
      const { client } = setup(response)
      await expect(client.requestPdf(path)).resolves.toMatchObject({ kind: 'invalidResponse' })
    })

    it('Frontend 임시 상한을 넘는 선언 크기는 본문을 읽지 않고 거부한다', async () => {
      const { client } = setup(pdfResponse(pdf('%PDF-1.7\n%%EOF'), { 'Content-Length': String(maxOfficialPdfBytes + 1) }))
      await expect(client.requestPdf(path)).resolves.toMatchObject({ kind: 'invalidResponse' })
    })

    it('401은 세션을 정리하고, 403, 404, 409 코드는 기존 공통 처리로 구분한다', async () => {
      const unauthorized = setup(new Response(null, { status: 401 }))
      await expect(unauthorized.client.requestPdf(path)).resolves.toEqual({ kind: 'unauthenticated' })
      expect(unauthorized.onUnauthorized).toHaveBeenCalledOnce()
      await expect(setup(new Response(null, { status: 403 })).client.requestPdf(path)).resolves.toEqual({ kind: 'forbidden' })
      await expect(setup(new Response(null, { status: 404 })).client.requestPdf(path)).resolves.toEqual({ kind: 'notFound' })
      const conflict = new Response(JSON.stringify({ code: 'OFFICIAL_PDF_NOT_GENERATED' }), { status: 409, headers: { 'Content-Type': 'application/problem+json' } })
      await expect(setup(conflict).client.requestPdf(path)).resolves.toEqual({ kind: 'problem', status: 409, code: 'OFFICIAL_PDF_NOT_GENERATED' })
    })

    it('토큰이 없거나 허용되지 않은 경로면 요청하지 않는다', async () => {
      const anonymous = setup(pdfResponse(pdf('%PDF-1.7\n%%EOF')), null)
      await expect(anonymous.client.requestPdf(path)).resolves.toEqual({ kind: 'unauthenticated' })
      expect(anonymous.fetchImpl).not.toHaveBeenCalled()
      const outside = setup(pdfResponse(pdf('%PDF-1.7\n%%EOF')))
      await expect(outside.client.requestPdf('https://example.invalid/a.pdf')).rejects.toThrow(TypeError)
      expect(outside.fetchImpl).not.toHaveBeenCalled()
    })
  })
})
