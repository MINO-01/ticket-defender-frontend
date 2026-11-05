// Issue #37 이후 제보 상세는 검증 회차 목록과 회차 연결 이력을 함께 조회한다.
// 그 영역을 다루지 않는 기존 Track 2 테스트에서는 빈 정상 응답을 돌려주어 기존 검증 대상만 확인하게 한다.

export function track2PipelineDefault(url: string, method = 'GET'): Response | undefined {
  if (method !== 'GET') return undefined
  const body = /\/api\/v1\/admin\/events\/[^/]+\/verified-performances$/.test(url) ? []
    : /\/api\/v1\/admin\/fan-reports\/[^/]+\/performance-link$/.test(url) ? { items: [] } : undefined
  return body === undefined ? undefined : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** 회차 영역의 기본 조회를 뺀 요청 주소 목록이다. 기존 테스트의 요청 순서 검증에 쓴다. */
export function withoutPipelineReads(urls: string[]) {
  return urls.filter((url) => track2PipelineDefault(url) === undefined)
}
