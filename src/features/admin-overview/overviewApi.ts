import type { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import type { casePageSchema } from '../admin-cases/caseApi'
import type { Track1ClusterPage } from '../admin-track1/track1Api'
import type { FanReportPage } from '../admin-track2/track2Api'

// 관리자 전체 현황(/app/overview)이 쓰는 기존 조회 API 경로와 응답 범위 확인이다. 새 API나 집계 API를 쓰지 않는다.
// 공연 하나를 고르면 팬 제보 목록, 저장된 Track 1 군집 목록, Case 목록을 각각 첫 페이지 한 번씩만 조회한다. 페이지 순회와 자동 재조회는 하지 않는다.
// 건수는 서버가 totalItems로 준 값만 쓴다. Case 목록은 전체 건수를 주지 않으므로 최근 몇 건만 보여 주고 합계를 만들지 않는다.

type CasePage = z.infer<typeof casePageSchema>

/** 건수만 필요하므로 항목은 1개만 받는다. totalItems는 pageSize와 무관한 공연 전체 건수다. */
export const countPageSize = 1
/** 최근 Case는 서버의 생성 시각 내림차순 첫 페이지에서 이만큼만 보여 준다. */
export const recentCasePageSize = 5

export function overviewFanReportCountPath(eventId: string) {
  return adminApiPath('/api/v1/admin/fan-reports', { eventId, page: 0, pageSize: countPageSize })
}

export function overviewClusterCountPath(eventId: string) {
  return adminApiPath('/api/v1/admin/track1/clusters', { eventId, page: 0, pageSize: countPageSize, sort: 'recent' })
}

export function overviewRecentCasesPath(eventId: string) {
  return adminApiPath('/api/v1/cases', { eventId, page: 0, pageSize: recentCasePageSize })
}

/** 응답이 요청한 공연, 첫 페이지, 요청한 크기와 맞는지 확인한다. 맞지 않으면 건수를 표시하지 않는다. */
export function isFanReportCountFor(eventId: string, data: FanReportPage) {
  return data.event.id === eventId && data.page === 0 && data.pageSize === countPageSize && data.items.length <= countPageSize
    && data.items.length === Math.min(data.totalItems, countPageSize) && data.hasNext === data.totalItems > countPageSize
}

export function isClusterCountFor(eventId: string, data: Track1ClusterPage) {
  return data.event.id === eventId && data.page === 0 && data.pageSize === countPageSize && data.items.length <= countPageSize
    && data.items.length === Math.min(data.totalItems, countPageSize) && data.hasNext === data.totalItems > countPageSize
}

export function isRecentCasesFor(eventId: string, data: CasePage) {
  return data.page === 0 && data.pageSize === recentCasePageSize && data.items.length <= recentCasePageSize
    && data.items.every((item) => item.eventId === eventId)
}
