import { lazy } from 'react'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { LiveFanReportDetailPage } from './LiveFanReportDetailPage'
import { LiveFanReportListPage } from './LiveFanReportListPage'
import { LiveVerifiedPerformancePage } from './LiveVerifiedPerformancePage'

// 합성 데모 화면과 demoTrack2Data는 개발 전용 미리보기에서만 불러와 인증 세션의 실제 화면 번들에 포함하지 않는다.
const FanReportListPage = lazy(() => import('./FanReportListPage').then((module) => ({ default: module.FanReportListPage })))
const FanReportDetailPage = lazy(() => import('./FanReportDetailPage').then((module) => ({ default: module.FanReportDetailPage })))

// 인증 세션에서는 실제 API 화면만, 개발 전용 미리보기에서는 합성 데모 화면만 연다.
// 실제 API가 실패해도 데모 데이터로 대체하지 않는다.

export function Track2ListRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <FanReportListPage /> : <LiveFanReportListPage />
}

/** 공연 단위 검증 회차 관리. 미리보기에는 합성 데모가 없어 안내만 표시하고 실제 API를 부르지 않는다. */
export function VerifiedPerformanceRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview'
    ? <AdminPagePlaceholder title="검증 회차 관리" description="공연 단위 검증 회차 관리는 인증된 관리자 세션에서만 실제 API로 제공합니다." />
    : <LiveVerifiedPerformancePage />
}

export function Track2DetailRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <FanReportDetailPage /> : <LiveFanReportDetailPage />
}
