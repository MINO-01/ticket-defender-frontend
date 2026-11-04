import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { createIdempotencyKey } from '../admin-track2/listingAnalysisRun'
import { classifyMutation } from './caseWorkflowApi'
import type { MutationOutcome, OperationMessages, WorkflowMessage } from './caseWorkflowApi'

// Case 쓰기 요청 한 종류의 시도 상태를 현재 화면 메모리에만 보관한다. 요청 키와 본문은 브라우저 저장소나 로그에 남기지 않는다.
// 같은 Idempotency-Key는 같은 본문일 때만 서버가 기록된 결과를 돌려주므로, 결과를 확인하지 못한 시도는 키와 본문을 함께 보존해 그대로 재전송한다.
// 새 키는 관리자가 새 요청을 명시적으로 보낼 때만 만들고, 결과가 불확실한 동안에는 새 요청을 막는다.
// 화면을 떠나거나 로그아웃, 세션 만료로 화면이 사라지면 대기 중 요청을 취소하고 늦게 도착한 응답은 버린다. 서버 처리 취소는 아니다.

export type SettledAttempt<T> = { key: string } & MutationOutcome<T>
export type MutationAttempt<T> = { kind: 'sending'; key: string } | SettledAttempt<T>

type Pending<B> = { key: string; body: B }

export type CaseMutationOptions<T> = {
  method: 'POST' | 'PUT'
  schema: z.ZodType<T>
  /** 계약상 성공 상태. 생성은 201, 전이와 담당자는 200이다. */
  successStatus: number
  messages: OperationMessages
}

export function useCaseMutation<B, T>({ method, schema, successStatus, messages }: CaseMutationOptions<T>) {
  const client = useAdminApiClient()
  const [attempt, setAttempt] = useState<MutationAttempt<T> | null>(null)
  // 상태 갱신은 비동기라 같은 렌더링 안의 연속 클릭을 막지 못하므로 전송 여부를 동기적으로 기록한다.
  const sendingRef = useRef(false)
  const uncertainRef = useRef<Pending<B> | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    sendingRef.current = false
    uncertainRef.current = null
  }, [])

  const send = useCallback(async (path: string, pending: Pending<B>, verify: (data: T) => boolean): Promise<SettledAttempt<T> | null> => {
    if (sendingRef.current) return null
    sendingRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setAttempt({ kind: 'sending', key: pending.key })
    let next: SettledAttempt<T>
    try {
      const result = await client.request(path, { method, body: pending.body, idempotencyKey: pending.key, successStatus, schema, signal: controller.signal })
      next = { key: pending.key, ...classifyMutation(result, messages, verify) }
    } catch {
      // 경로나 키 검사에서 요청 전에 거부된 경우다. 서버에 보내지 않았다.
      next = { key: pending.key, kind: 'rejected', forbidden: false, message: { title: '요청을 보내지 않았습니다', description: '요청 경로나 요청 키 검사에 실패해 서버에 보내지 않았습니다.' } }
    } finally {
      sendingRef.current = false
      if (controllerRef.current === controller) controllerRef.current = null
    }
    if (controller.signal.aborted) return null
    uncertainRef.current = next.kind === 'uncertain' ? pending : null
    setAttempt(next)
    return next
  }, [client, method, messages, schema, successStatus])

  /** 새 요청을 보낸다. 결과가 불확실한 시도가 있거나 전송 중이면 보내지 않는다. */
  const submit = useCallback((path: string, body: B, verify: (data: T) => boolean) => {
    if (sendingRef.current || uncertainRef.current !== null) return Promise.resolve<SettledAttempt<T> | null>(null)
    const key = createIdempotencyKey()
    if (key === null) {
      const message: WorkflowMessage = { title: '요청 키를 만들 수 없습니다', description: '이 브라우저에서 안전한 요청 키를 만들 수 없어 요청하지 않았습니다.' }
      setAttempt({ key: '', kind: 'rejected', forbidden: false, message })
      return Promise.resolve<SettledAttempt<T> | null>(null)
    }
    return send(path, { key, body }, verify)
  }, [send])

  /** 결과가 불확실한 시도를 같은 키와 같은 본문으로 다시 보낸다. */
  const reconfirm = useCallback((path: string, verify: (data: T) => boolean) => {
    const pending = uncertainRef.current
    if (pending === null) return Promise.resolve<SettledAttempt<T> | null>(null)
    return send(path, pending, verify)
  }, [send])

  /** 확정된 결과 표시를 지운다. 불확실한 시도는 지우지 않는다. */
  const clear = useCallback(() => {
    if (sendingRef.current || uncertainRef.current !== null) return
    setAttempt(null)
  }, [])

  return { attempt, submit, reconfirm, clear }
}
