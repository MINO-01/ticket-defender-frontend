import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { AdminApiClient } from '../../api/adminApiClient'
import type { AdminApiFailure } from '../../api/adminApiFailure'
import { useAdminApiClient } from '../admin-auth/AdminAuthProvider'
import { isUuid } from '../fan-report/intakeConfig'
import { adminEventPageSchema, adminEventsPath } from './adminEventsApi'
import type { AdminEvent } from './adminEventsApi'

// 로그인한 관리자가 접근할 수 있는 공연을 서버 페이지 단위로 불러온다.
// 주소에 지정된 공연이 첫 페이지에 없으면 제한된 페이지 수까지 이어서 조회해 접근 가능 여부를 다시 확인한다.

/** 주소의 공연을 찾기 위해 자동으로 조회하는 최대 페이지 수 */
const maxAutoPages = 10

export type AccessibleEventsState =
  | { status: 'loading' }
  | { status: 'failed'; failure: AdminApiFailure }
  | { status: 'ready'; events: AdminEvent[]; hasNext: boolean; nextPage: number; loadingMore: boolean; moreFailure: AdminApiFailure | null }

type PageResult = { kind: 'page'; items: AdminEvent[]; hasNext: boolean } | AdminApiFailure

async function fetchPage(client: AdminApiClient, page: number, signal: AbortSignal): Promise<PageResult> {
  const result = await client.request(adminEventsPath(page), { schema: adminEventPageSchema, signal })
  if (result.kind !== 'success') return result
  // 요청한 페이지와 다른 응답은 다른 범위의 목록일 수 있으므로 계약 위반으로 처리한다.
  if (result.data.page !== page) return { kind: 'invalidResponse', status: result.status }
  return { kind: 'page', items: result.data.items, hasNext: result.data.hasNext }
}

function merge(current: AdminEvent[], next: AdminEvent[]) {
  const ids = new Set(current.map((event) => event.id))
  return [...current, ...next.filter((event) => !ids.has(event.id))]
}

export function useAccessibleEvents(selectedEventId: string | null) {
  const client = useAdminApiClient()
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<AccessibleEventsState>({ status: 'loading' })
  const moreController = useRef<AbortController | null>(null)
  const readTarget = useEffectEvent(() => selectedEventId)

  useEffect(() => {
    const controller = new AbortController()
    // 형식이 잘못된 공연 값은 목록에 있을 수 없으므로 추가 페이지를 조회하지 않는다.
    const requested = readTarget()
    const target = requested !== null && isUuid(requested) ? requested : null
    void (async () => {
      let events: AdminEvent[] = []
      for (let page = 0; ; page += 1) {
        const result = await fetchPage(client, page, controller.signal)
        if (controller.signal.aborted) return
        if (result.kind !== 'page') { setState({ status: 'failed', failure: result }); return }
        events = merge(events, result.items)
        const found = target !== null && events.some((event) => event.id === target)
        if (!result.hasNext || target === null || found || page + 1 >= maxAutoPages) {
          setState({ status: 'ready', events, hasNext: result.hasNext, nextPage: page + 1, loadingMore: false, moreFailure: null })
          return
        }
      }
    })()
    return () => { controller.abort(); moreController.current?.abort() }
  }, [client, reload])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.hasNext || state.loadingMore) return
    const page = state.nextPage
    const controller = new AbortController()
    moreController.current = controller
    setState({ ...state, loadingMore: true, moreFailure: null })
    void fetchPage(client, page, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setState((current) => {
        if (current.status !== 'ready' || current.nextPage !== page) return current
        if (result.kind !== 'page') return { ...current, loadingMore: false, moreFailure: result }
        return { status: 'ready', events: merge(current.events, result.items), hasNext: result.hasNext, nextPage: page + 1, loadingMore: false, moreFailure: null }
      })
    })
  }, [client, state])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setReload((value) => value + 1)
  }, [])

  return { state, loadMore, retry }
}
