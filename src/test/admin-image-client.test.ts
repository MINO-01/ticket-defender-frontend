import { describe, expect, it, vi } from 'vitest'
import { createAdminApiClient } from '../api/adminApiClient'
import { detectImageMediaType, maxEvidenceImageBytes } from '../api/imageResponse'
import { readBlobBytes, SYNTHETIC_JPEG, SYNTHETIC_PNG } from './syntheticImages'

// 관리자 이미지 바이너리 요청의 계약만 Mock fetch로 검증한다. 실제 Backend 연동을 대체하지 않으며 모든 값은 합성 데이터다.
const SYNTHETIC_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtYWRtaW4ifQ.c3ludGhldGljLXNpZ25hdHVyZQ'
const IMAGE_PATH = '/api/v1/admin/fan-reports/55555555-5555-4555-8555-555555555551/evidence/66666666-6666-4666-8666-666666666661/content'


function imageResponse(bytes: Uint8Array, contentType: string | null, status = 200, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders }
  if (contentType !== null) headers['Content-Type'] = contentType
  return new Response(bytes.slice().buffer, { status, headers })
}

function setup(response: Response | Error | (() => Response), token: string | null = SYNTHETIC_TOKEN) {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response
    return typeof response === 'function' ? response() : response
  })
  const onUnauthorized = vi.fn()
  const client = createAdminApiClient({ getAccessToken: () => token, onUnauthorized, fetchImpl })
  return { client, fetchImpl, onUnauthorized }
}

/** 지정한 크기의 조각을 끝없이 보내는 합성 스트림이다. 클라이언트가 중단하면 cancel이 호출된다. */
function endlessStream(chunkSize: number) {
  let pulled = 0
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1
      const chunk = new Uint8Array(chunkSize)
      // 첫 조각은 PNG 서명으로 시작해 형식 검사가 아닌 크기 제한으로 중단되는지 확인한다.
      if (pulled === 1) chunk.set(SYNTHETIC_PNG.subarray(0, 16))
      controller.enqueue(chunk)
    },
    cancel,
  })
  return { stream, cancel, pulls: () => pulled }
}

describe('관리자 이미지 바이너리 요청', () => {
  it('기존 Bearer 토큰과 안전한 요청 옵션으로 동일 출처에 요청하고 PNG 바이트를 Blob으로 반환한다', async () => {
    const { client, fetchImpl } = setup(imageResponse(SYNTHETIC_PNG, 'image/png'))
    const controller = new AbortController()
    const result = await client.requestImage(IMAGE_PATH, { signal: controller.signal })
    expect(result.kind).toBe('success')
    if (result.kind !== 'success') return
    expect(result.status).toBe(200)
    expect(result.data.mediaType).toBe('image/png')
    expect(result.data.blob.type).toBe('image/png')
    expect(result.data.byteSize).toBe(SYNTHETIC_PNG.length)
    expect(await readBlobBytes(result.data.blob)).toEqual(SYNTHETIC_PNG)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(IMAGE_PATH)
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SYNTHETIC_TOKEN}` })
    expect(String((init?.headers as Record<string, string>).Accept)).toContain('image/png')
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal })
    expect(init?.body).toBeUndefined()
  })

  it('JPEG와 매개변수가 붙은 Content-Type도 실제 형식이 같으면 허용한다', async () => {
    const result = await setup(imageResponse(SYNTHETIC_JPEG, 'Image/JPEG; charset=binary')).client.requestImage(IMAGE_PATH)
    expect(result.kind === 'success' && result.data.mediaType).toBe('image/jpeg')
  })

  it('응답 본문을 JSON으로 읽지 않는다', async () => {
    const response = imageResponse(SYNTHETIC_PNG, 'image/png')
    const jsonSpy = vi.spyOn(response, 'json')
    const result = await setup(response).client.requestImage(IMAGE_PATH)
    expect(result.kind).toBe('success')
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('토큰이 없으면 요청하지 않고, 허용되지 않은 경로는 토큰을 보내기 전에 거부한다', async () => {
    const noToken = setup(imageResponse(SYNTHETIC_PNG, 'image/png'), null)
    await expect(noToken.client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'unauthenticated' })
    expect(noToken.fetchImpl).not.toHaveBeenCalled()
    for (const path of ['https://evil.example' + IMAGE_PATH, '//evil.example' + IMAGE_PATH, '/api/v1/fan-reports/x/content', '/api/v1/admin/../fan-reports/x', '/api/v1/admin/%2e%2e/x', 'http://localhost:9000/evidence/bucket/key']) {
      const blocked = setup(imageResponse(SYNTHETIC_PNG, 'image/png'))
      await expect(blocked.client.requestImage(path)).rejects.toThrow(TypeError)
      expect(blocked.fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('401은 기존 세션 정리를 호출하고 403, 404, 오류 코드는 기존 분류를 따른다', async () => {
    const unauthorized = setup(new Response(null, { status: 401 }))
    await expect(unauthorized.client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'unauthenticated' })
    expect(unauthorized.onUnauthorized).toHaveBeenCalledTimes(1)
    await expect(setup(new Response(null, { status: 403 })).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'forbidden' })
    await expect(setup(new Response(null, { status: 404 })).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'notFound' })
    const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code, detail: 'bucket/object-key', requestId: 'x' }), { status, headers: { 'Content-Type': 'application/problem+json' } })
    await expect(setup(problem(422, 'HASH_MISMATCH')).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'problem', status: 422, code: 'HASH_MISMATCH' })
    await expect(setup(problem(503, 'EVIDENCE_CONTENT_BUSY')).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'problem', status: 503, code: 'EVIDENCE_CONTENT_BUSY' })
    await expect(setup(problem(409, 'TENANT_SELECTION_REQUIRED')).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'problem', status: 409, code: 'TENANT_SELECTION_REQUIRED' })
    await expect(setup(new TypeError('offline')).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'network' })
  })

  it.each([
    ['200 HTML 로그인 화면', () => new Response('<html><body>login</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['200 JSON 오류 본문', () => new Response(JSON.stringify({ code: 'ERROR' }), { status: 200, headers: { 'Content-Type': 'application/json' } })],
    ['image/png로 표시한 HTML', () => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'image/png' } })],
    ['Content-Type 없음', () => imageResponse(SYNTHETIC_PNG, null)],
    ['허용하지 않는 이미지 형식', () => imageResponse(SYNTHETIC_PNG, 'image/svg+xml')],
    ['PNG라고 했지만 JPEG 바이트', () => imageResponse(SYNTHETIC_JPEG, 'image/png')],
    ['JPEG라고 했지만 PNG 바이트', () => imageResponse(SYNTHETIC_PNG, 'image/jpeg')],
    ['빈 본문', () => imageResponse(new Uint8Array(0), 'image/png')],
    ['서명만 있는 잘린 PNG', () => imageResponse(SYNTHETIC_PNG.subarray(0, 8), 'image/png')],
    ['200이 아닌 성공 상태', () => imageResponse(SYNTHETIC_PNG, 'image/png', 206)],
    ['실제 크기와 다른 Content-Length', () => imageResponse(SYNTHETIC_PNG, 'image/png', 200, { 'Content-Length': String(SYNTHETIC_PNG.length + 10) })],
    ['숫자가 아닌 Content-Length', () => imageResponse(SYNTHETIC_PNG, 'image/png', 200, { 'Content-Length': '12abc' })],
  ])('%s은 이미지로 처리하지 않는다', async (_label, response) => {
    await expect(setup(response).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'invalidResponse', status: expect.any(Number) })
  })

  it('Content-Length가 20 MiB를 넘으면 본문을 읽지 않고 중단한다', async () => {
    const { stream, cancel, pulls } = endlessStream(1024)
    const response = new Response(stream, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(maxEvidenceImageBytes + 1) } })
    await expect(setup(response).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'invalidResponse', status: 200 })
    expect(cancel).toHaveBeenCalled()
    // ReadableStream은 생성 시 한 번 미리 pull할 수 있으므로 1회 이하만 허용한다.
    expect(pulls()).toBeLessThanOrEqual(1)
  })

  it('Content-Length가 없거나 거짓이어도 실제 수신 바이트가 20 MiB를 넘는 순간 스트림을 중단한다', async () => {
    const chunkSize = 1024 * 1024
    const missing = endlessStream(chunkSize)
    await expect(setup(new Response(missing.stream, { status: 200, headers: { 'Content-Type': 'image/png' } })).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'invalidResponse', status: 200 })
    expect(missing.cancel).toHaveBeenCalled()
    // 20 MiB를 넘긴 조각에서 멈추고 무제한으로 읽지 않는다.
    expect(missing.pulls()).toBeLessThanOrEqual(maxEvidenceImageBytes / chunkSize + 3)

    const lying = endlessStream(chunkSize)
    await expect(setup(new Response(lying.stream, { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '1024' } })).client.requestImage(IMAGE_PATH)).resolves.toEqual({ kind: 'invalidResponse', status: 200 })
    expect(lying.cancel).toHaveBeenCalled()
    expect(lying.pulls()).toBeLessThanOrEqual(maxEvidenceImageBytes / chunkSize + 3)
  })

  it('정확히 20 MiB인 응답은 크기 제한을 통과한다', async () => {
    const bytes = new Uint8Array(maxEvidenceImageBytes)
    bytes.set(SYNTHETIC_PNG.subarray(0, 33))
    const result = await setup(imageResponse(bytes, 'image/png', 200, { 'Content-Length': String(maxEvidenceImageBytes) })).client.requestImage(IMAGE_PATH)
    expect(result.kind === 'success' && result.data.byteSize).toBe(maxEvidenceImageBytes)
  })

  it('요청을 취소하면 성공으로 반환하지 않는다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const client = createAdminApiClient({ getAccessToken: () => SYNTHETIC_TOKEN, onUnauthorized: vi.fn(), fetchImpl })
    const pending = client.requestImage(IMAGE_PATH, { signal: controller.signal })
    controller.abort()
    await expect(pending).resolves.toEqual({ kind: 'network' })
  })
})

describe('PNG와 JPEG 바이트 검사', () => {
  it('서명과 최소 구조로 형식을 판별하고 그 외에는 null을 반환한다', () => {
    expect(detectImageMediaType(SYNTHETIC_PNG)).toBe('image/png')
    expect(detectImageMediaType(SYNTHETIC_JPEG)).toBe('image/jpeg')
    expect(detectImageMediaType(new Uint8Array(0))).toBeNull()
    expect(detectImageMediaType(new TextEncoder().encode('<!doctype html>'))).toBeNull()
    expect(detectImageMediaType(new TextEncoder().encode('{"code":"X"}'))).toBeNull()
    expect(detectImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(detectImageMediaType(Uint8Array.from([0xff, 0xd8]))).toBeNull()
    // PNG 서명 뒤 첫 청크가 IHDR가 아니면 PNG로 보지 않는다.
    const broken = SYNTHETIC_PNG.slice()
    broken[12] = 0x41
    expect(detectImageMediaType(broken)).toBeNull()
  })
})
