import { PageHeader } from '../../components/common/PageHeader'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { PerformanceManagementCard, usePerformanceList } from './PerformancePanels'
import styles from './Track2.module.css'

// 인증된 관리자의 공연 단위 검증 회차 관리 화면이다. 서버가 확인한 접근 가능 공연(AdminEventGate)의 ID로만 회차 API를 부른다.
// 팬 제보 상세 GET은 ANALYST, REVIEWER만 허용되므로, TENANT_ADMIN은 이 화면에서 회차를 관리한다. 팬 제보 정보와 회차 연결은 이 화면에서 조회하지 않는다.
// 역할은 추정하지 않는다. 회차 관리 역할(REVIEWER, TENANT_ADMIN)이 없으면 서버 403을, 범위 밖 공연은 서버 404를 그대로 안내한다.

const roleNote = '제보별 회차 연결은 팬 제보 상세에서 검토 담당이 진행합니다.'

export function LiveVerifiedPerformancePage() {
  return <div className={styles.page}>
    <PageHeader eyebrow="Track 2 검증 회차" title="검증 회차 관리" description="선택한 공연의 검증 회차를 조회하고 등록, 근거 수정, 철회합니다. 회차 검증은 예매 후보 대조의 기준이며 부정 거래 판정이 아닙니다." />
    <AdminEventGate>{(event) => <EventPerformances key={event.id} event={event} />}</AdminEventGate>
    <p className={styles.notice}>제보별 회차 연결과 예매 후보 대조는 팬 제보 상세에서 진행합니다. 팬 입력 공연 일시와 이미지 분석의 공연 일시 관찰값으로 회차를 자동 확정하지 않습니다.</p>
  </div>
}

function EventPerformances({ event }: { event: AdminEvent }) {
  const list = usePerformanceList(event.id)
  return <PerformanceManagementCard eventId={event.id} eventName={event.name} list={list} roleNote={roleNote} />
}
