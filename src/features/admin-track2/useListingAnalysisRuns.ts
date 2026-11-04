import { useCallback, useEffect, useRef, useState } from 'react'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { classifyRunResult, createIdempotencyKey } from './listingAnalysisRun'
import type { RunAttempt } from './listingAnalysisRun'
import { listingAnalysisRunPath, listingAnalysisSchema } from './track2Api'

// 한 제보 상세 화면에서 증거별 분석 실행 시도를 현재 탭 메모리에만 보관한다. 키와 상태는 브라우저 저장소에 남기지 않는다.
// 응답은 요청한 증거의 칸에만 기록하므로 증거를 바꾼 뒤 늦게 도착한 응답이 다른 증거 화면에 표시되지 않는다.
// 화면을 떠나거나 로그아웃, 세션 만료로 화면이 사라지면 대기 중 요청을 취소한다. 이는 브라우저 요청 취소일 뿐 서버 분석 취소가 아니다.

export function useListingAnalysisRuns(fanReportId: string) {
  const client = useAdminApiClient()
  const [attempts, setAttempts] = useState<Record<string, RunAttempt>>({})
  // 증거별 이력 재조회 횟수. 값이 바뀌면 이력 화면을 새로 만들어 첫 페이지를 다시 조회한다.
  const [historyVersions, setHistoryVersions] = useState<Record<string, number>>({})
  const attemptsRef = useRef<Record<string, RunAttempt>>({})
  // 상태 갱신은 비동기라 같은 렌더링 안의 연속 클릭을 막지 못하므로 전송 중 증거를 동기적으로 기록한다.
  const sendingRef = useRef(new Set<string>())
  const controllersRef = useRef(new Set<AbortController>())

  useEffect(() => {
    const controllers = controllersRef.current
    const sending = sendingRef.current
    return () => {
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
      sending.clear()
    }
  }, [])

  const record = useCallback((evidenceId: string, attempt: RunAttempt) => {
    attemptsRef.current = { ...attemptsRef.current, [evidenceId]: attempt }
    setAttempts(attemptsRef.current)
  }, [])

  const refreshHistory = useCallback((evidenceId: string) => {
    setHistoryVersions((current) => ({ ...current, [evidenceId]: (current[evidenceId] ?? 0) + 1 }))
  }, [])

  const send = useCallback(async (evidenceId: string, key: string) => {
    if (sendingRef.current.has(evidenceId)) return
    sendingRef.current.add(evidenceId)
    const controller = new AbortController()
    controllersRef.current.add(controller)
    record(evidenceId, { phase: 'sending', key })
    let attempt: RunAttempt
    try {
      const result = await client.request(listingAnalysisRunPath(fanReportId, evidenceId), {
        method: 'POST', idempotencyKey: key, successStatus: 201, schema: listingAnalysisSchema, signal: controller.signal,
      })
      attempt = classifyRunResult(result, key, fanReportId, evidenceId)
    } catch {
      // 경로나 키 검사에서 요청 전에 거부된 경우다. 서버에 보내지 않았다.
      attempt = { phase: 'rejected', key, message: { title: '요청을 보내지 않았습니다', description: '요청 경로나 요청 키 검사에 실패해 서버에 보내지 않았습니다.' } }
    } finally {
      sendingRef.current.delete(evidenceId)
      controllersRef.current.delete(controller)
    }
    if (controller.signal.aborted) return
    record(evidenceId, attempt)
    if (attempt.phase !== 'rejected') refreshHistory(evidenceId)
  }, [client, fanReportId, record, refreshHistory])

  /** 관리자가 새 분석을 명시적으로 시작할 때만 새 키를 만든다. 결과가 불확실하거나 진행 중인 시도가 있으면 새 키를 만들지 않는다. */
  const start = useCallback((evidenceId: string) => {
    const current = attemptsRef.current[evidenceId]
    if (sendingRef.current.has(evidenceId) || current?.phase === 'uncertain' || current?.phase === 'inProgress') return
    const key = createIdempotencyKey()
    if (key === null) {
      record(evidenceId, { phase: 'rejected', key: '', message: { title: '요청 키를 만들 수 없습니다', description: '이 브라우저에서 안전한 요청 키를 만들 수 없어 분석을 요청하지 않았습니다.' } })
      return
    }
    void send(evidenceId, key)
  }, [record, send])

  /** 결과가 불확실하거나 진행 중인 시도를 같은 키로 다시 확인한다. */
  const reconfirm = useCallback((evidenceId: string) => {
    const current = attemptsRef.current[evidenceId]
    if (current?.phase !== 'uncertain' && current?.phase !== 'inProgress') return
    void send(evidenceId, current.key)
  }, [send])

  return { attempts, historyVersions, start, reconfirm, refreshHistory }
}
