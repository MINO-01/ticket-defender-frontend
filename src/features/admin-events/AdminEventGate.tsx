import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Select } from '../../components/common/FormControls'
import { isUuid } from '../fan-report/intakeConfig'
import type { AdminEvent } from './adminEventsApi'
import { useAccessibleEvents } from './useAccessibleEvents'
import styles from './AdminEventGate.module.css'

// 관리자 업무 화면의 공연 선택 영역이다. 선택한 공연은 주소의 eventId 쿼리로 유지해 새로고침 없이 이동하거나 주소로 접근해도 복원한다.
// 서버가 반환한 접근 가능 공연 목록에서 확인된 공연만 하위 화면에 전달하며, 확인 전에는 업무 API를 호출하지 않는다.
// Track 2와 Case 화면에서도 같은 방식으로 재사용할 수 있다.

/** 주소의 eventId를 읽고 바꾼다. 공연이 바뀌면 이전 공연 기준의 page 값은 버린다. */
export function useSelectedEventId() {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('eventId')?.trim() ?? ''
  const selectEvent = (eventId: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (eventId) next.set('eventId', eventId)
    else next.delete('eventId')
    next.delete('page')
    return next
  })
  return { eventId: raw === '' ? null : raw.toLowerCase(), selectEvent }
}

export function AdminEventGate({ children }: { children: (event: AdminEvent) => ReactNode }) {
  const { eventId, selectEvent } = useSelectedEventId()
  const { state, loadMore, retry } = useAccessibleEvents(eventId)

  if (state.status === 'loading') return <LoadingSkeleton label="접근 가능한 공연을 불러오는 중" />
  if (state.status === 'failed') {
    const message = describeAdminApiFailure(state.failure, '공연 목록을 찾을 수 없습니다')
    return <ErrorState title={message.title} description={message.description} onRetry={retry} />
  }
  if (state.events.length === 0 && !state.hasNext) {
    return <EmptyState title="접근 가능한 공연이 없습니다" description="현재 계정에 권한이 부여된 활성 공연이 없습니다. 조회 장애가 아니며, 공연 권한은 고객사 관리자에게 확인해 주세요." />
  }

  const selected = eventId === null ? undefined : state.events.find((event) => event.id === eventId)
  const moreMessage = state.moreFailure ? describeAdminApiFailure(state.moreFailure, '공연 목록을 찾을 수 없습니다') : null
  let content: ReactNode
  if (selected) content = children(selected)
  else if (eventId === null) content = <EmptyState title="공연을 선택해 주세요" description="접근 가능한 공연 중 하나를 선택하면 해당 공연의 조회 결과를 불러옵니다." />
  else if (isUuid(eventId) && state.hasNext) content = <EmptyState title="선택한 공연을 아직 확인하지 못했습니다" description="불러온 공연 목록에 없는 공연입니다. 공연을 더 불러와 접근 가능 여부를 확인해 주세요." />
  else content = <ErrorState title="선택한 공연에 접근할 수 없습니다" description="접근 가능한 공연 목록에 없는 공연입니다. 목록에서 다른 공연을 선택해 주세요." />

  return <>
    <Card className={styles.selector} aria-label="공연 선택">
      <div className={styles.controls}>
        <Select label="조회할 공연" value={selected?.id ?? ''} onChange={(event) => selectEvent(event.target.value)}>
          <option value="">공연을 선택해 주세요</option>
          {state.events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
        </Select>
        {state.hasNext && <Button variant="secondary" loading={state.loadingMore} onClick={loadMore}>공연 더 불러오기</Button>}
      </div>
      <p className={styles.help}>서버가 확인한 접근 가능 공연만 표시합니다. {state.hasNext ? `현재 ${state.events.length}개를 불러왔으며 더 있습니다.` : `전체 ${state.events.length}개입니다.`}</p>
      {moreMessage && <p className={styles.error} role="alert">{moreMessage.title}</p>}
    </Card>
    {content}
  </>
}
