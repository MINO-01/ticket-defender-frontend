import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'
import type { AdminApiResult } from '../../api/adminApiClient'
import { useAdminApiClient } from './AdminAuthProvider'

// 관리자 GET 조회 결과를 요청 경로와 재시도 횟수로 묶어 보관한다.
// 경로가 바뀌면 이전 요청을 중단하고, 늦게 도착한 이전 응답은 현재 경로와 일치하지 않아 화면에 표시되지 않는다.

type Settled<T> = { key: string; result: AdminApiResult<T> }

/** path가 null이면 요청하지 않는다. schema는 렌더링마다 바뀌지 않는 모듈 상수를 전달해야 한다. */
export function useAdminQuery<T>(path: string | null, schema: z.ZodType<T>) {
  const client = useAdminApiClient()
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled<T> | null>(null)

  useEffect(() => {
    if (path === null) return
    const controller = new AbortController()
    const key = `${attempt}:${path}`
    client.request(path, { schema, signal: controller.signal }).then(
      (result) => { if (!controller.signal.aborted) setSettled({ key, result }) },
      // 클라이언트가 경로 검사로 요청을 거부한 경우다. 요청 값 오류로 표시한다.
      () => { if (!controller.signal.aborted) setSettled({ key, result: { kind: 'problem', status: 400, code: 'CLIENT_REJECTED_PATH' } }) },
    )
    return () => controller.abort()
  }, [client, path, schema, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const current = path !== null && settled?.key === `${attempt}:${path}` ? settled.result : null
  return { result: current, retry }
}
