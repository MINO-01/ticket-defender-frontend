const problemCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/

/** problem+json 응답에서 code만 읽는다. 서버의 상세 메시지는 화면에 노출하지 않는다. */
export async function readProblemCode(response: Response) {
  try {
    const body: unknown = await response.json()
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined
    return typeof code === 'string' && problemCodePattern.test(code) ? code : 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}
