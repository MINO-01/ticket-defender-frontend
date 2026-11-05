import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { classifyMutation } from '../admin-cases/caseWorkflowApi'
import type { WorkflowMessage } from '../admin-cases/caseWorkflowApi'
import { performanceUncertain, performanceWriteMessages } from './candidatePipelineApi'

// 검증 회차 등록, 수정, 철회 요청 한 종류의 시도 상태를 현재 화면 메모리에만 보관한다.
// 이 API들에는 Idempotency-Key가 없어 같은 요청 재확인을 제공하지 않고, 응답을 받지 못해도 자동으로 다시 보내지 않는다.
// 결과가 불확실하면 관리자가 서버 목록을 확인했다고 명시적으로 누를 때까지 새 요청을 막는다. 목록 상태로 이 요청의 성공을 확정하지 않는다.

export type PerformanceWriteState<T> =
  | { kind: 'sending' }
  | { kind: 'succeeded'; data: T }
  | { kind: 'rejected'; message: WorkflowMessage; forbidden: boolean }
  | { kind: 'uncertain'; message: WorkflowMessage }

export function usePerformanceWrite<T>(schema: z.ZodType<T>, successStatus: number) {
  const client = useAdminApiClient()
  const [state, setState] = useState<PerformanceWriteState<T> | null>(null)
  const sendingRef = useRef(false)
  const uncertainRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    sendingRef.current = false
  }, [])

  /** 요청을 한 번 보낸다. 전송 중이거나 확인하지 않은 불확실한 시도가 있으면 보내지 않는다. */
  const send = useCallback(async (path: string, method: 'POST' | 'PATCH', body: unknown, verify: (data: T) => boolean): Promise<PerformanceWriteState<T> | null> => {
    if (sendingRef.current || uncertainRef.current) return null
    sendingRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ kind: 'sending' })
    let next: PerformanceWriteState<T>
    try {
      const result = await client.request(path, { method, body, successStatus, schema, signal: controller.signal })
      const outcome = classifyMutation(result, performanceWriteMessages, verify)
      if (outcome.kind === 'succeeded') next = { kind: 'succeeded', data: outcome.data }
      else if (outcome.kind === 'uncertain') next = { kind: 'uncertain', message: performanceUncertain }
      else if (outcome.kind === 'conflict') next = { kind: 'rejected', forbidden: false, message: outcome.message }
      else next = { kind: 'rejected', forbidden: outcome.forbidden, message: outcome.message }
    } catch {
      next = { kind: 'rejected', forbidden: false, message: { title: '요청을 보내지 않았습니다', description: '요청 경로 검사에 실패해 서버에 보내지 않았습니다.' } }
    } finally {
      sendingRef.current = false
      if (controllerRef.current === controller) controllerRef.current = null
    }
    if (controller.signal.aborted) return null
    uncertainRef.current = next.kind === 'uncertain'
    setState(next)
    return next
  }, [client, schema, successStatus])

  /** 관리자가 서버 목록을 확인했다고 밝힌 뒤에만 불확실한 시도를 정리하고 새 요청을 허용한다. */
  const acknowledge = useCallback(() => {
    if (sendingRef.current) return
    uncertainRef.current = false
    setState(null)
  }, [])

  return { state, send, acknowledge }
}
