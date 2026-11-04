import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminApiResult } from '../../api/adminApiClient'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import type { WorkflowMessage } from '../admin-cases/caseWorkflowApi'
import { receiptMessages, receiptUncertain, reviewPackagePath, reviewReceiptSchema } from './approvalApi'
import type { ReviewReceipt } from './approvalApi'

// 일회용 검토 확인 영수증을 현재 화면 메모리의 ref에만 보관한다. 원문은 React 상태, URL, 브라우저 저장소, 로그, 오류 문구에 넣지 않는다.
// 발급 POST는 멱등 API가 아니므로 응답을 받지 못해도 자동으로 다시 보내지 않고, 새 발급은 사용자가 명시적으로 요청할 때만 보낸다.
// 만료 시각은 서버의 발급 시각과 만료 시각 차이를 응답 수신 시각에 더해 계산해 브라우저 시계 차이의 영향을 줄이고, 여유 시간만큼 먼저 폐기한다.
// 화면을 떠나거나 로그아웃, 세션 만료로 화면이 사라지면 원문과 타이머를 정리한다.

const expirySafetyMs = 5_000

export type ReceiptState =
  | { kind: 'none' }
  | { kind: 'issuing' }
  | { kind: 'issued'; receiptId: string; issuedAt: string; expiresAt: string }
  | { kind: 'expired' }
  | { kind: 'failed'; message: WorkflowMessage; forbidden: boolean }
  | { kind: 'uncertain'; message: WorkflowMessage }

export type ReceiptSettled = Exclude<ReceiptState, { kind: 'none' } | { kind: 'issuing' }>

const sessionEnded: WorkflowMessage = { title: '관리자 세션이 만료되었습니다', description: '다시 로그인한 뒤 요청 상태를 확인해 주세요.' }

function classify(result: AdminApiResult<ReviewReceipt>, requestId: string): ReceiptSettled | { kind: 'received'; receipt: ReviewReceipt } {
  switch (result.kind) {
    case 'success':
      return result.data.approvalRequestId === requestId ? { kind: 'received', receipt: result.data } : { kind: 'uncertain', message: receiptUncertain }
    case 'network':
    case 'invalidResponse':
      return { kind: 'uncertain', message: receiptUncertain }
    case 'unauthenticated':
      return { kind: 'failed', forbidden: false, message: sessionEnded }
    case 'forbidden':
      return { kind: 'failed', forbidden: true, message: receiptMessages.forbidden }
    case 'notFound':
      return { kind: 'failed', forbidden: false, message: receiptMessages.notFound }
    case 'problem': {
      const known = receiptMessages.codes[result.code]
      if (known && result.status < 500) return { kind: 'failed', forbidden: false, message: known }
      if (result.status < 500) return { kind: 'failed', forbidden: false, message: { title: '서버가 영수증 발급을 거부했습니다', description: `서버가 요청을 거부했습니다(${result.status}). 영수증이 발급되지 않았습니다.` } }
      return { kind: 'uncertain', message: receiptUncertain }
    }
  }
}

export function useReviewReceipt(requestId: string) {
  const client = useAdminApiClient()
  const [state, setState] = useState<ReceiptState>({ kind: 'none' })
  const tokenRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const issuingRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    clearTimer()
    tokenRef.current = null
    issuingRef.current = false
  }, [])

  /** 영수증을 한 번 발급한다. 전송 중이면 보내지 않는다. 결과를 확인하지 못해도 다시 보내지 않는다. */
  const issue = useCallback(async (): Promise<ReceiptSettled | null> => {
    if (issuingRef.current) return null
    issuingRef.current = true
    clearTimer()
    tokenRef.current = null
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ kind: 'issuing' })
    let next: ReturnType<typeof classify>
    try {
      next = classify(await client.request(reviewPackagePath(requestId), { method: 'POST', schema: reviewReceiptSchema, successStatus: 201, signal: controller.signal }), requestId)
    } catch {
      next = { kind: 'failed', forbidden: false, message: { title: '요청을 보내지 않았습니다', description: '요청 경로 검사에 실패해 서버에 보내지 않았습니다.' } }
    } finally {
      issuingRef.current = false
      if (controllerRef.current === controller) controllerRef.current = null
    }
    if (controller.signal.aborted) return null
    if (next.kind !== 'received') { setState(next); return next }
    const { receipt } = next
    tokenRef.current = receipt.reviewReceiptToken
    const lifetime = Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      tokenRef.current = null
      setState({ kind: 'expired' })
    }, Math.max(lifetime - expirySafetyMs, 0))
    const issued: ReceiptSettled = { kind: 'issued', receiptId: receipt.reviewReceiptId, issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt }
    setState(issued)
    return issued
  }, [client, requestId])

  /** 결정 본문을 만들 때만 원문을 꺼낸다. 만료되었거나 폐기되었으면 null이다. */
  const token = useCallback(() => tokenRef.current, [])

  /** 결정이 확정되었거나 더 쓸 수 없는 영수증을 폐기한다. */
  const discard = useCallback(() => {
    clearTimer()
    tokenRef.current = null
    setState({ kind: 'none' })
  }, [])

  return { state, issue, token, discard }
}
