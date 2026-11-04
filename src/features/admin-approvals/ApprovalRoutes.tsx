import { lazy } from 'react'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { LiveApprovalEntryPage } from './LiveApprovalEntryPage'
import { LiveApprovalRequestPage } from './LiveApprovalRequestPage'

// 합성 데모 승인 검토 화면은 개발 전용 미리보기에서만 불러와 인증 세션의 실제 화면 번들에 포함하지 않는다.
const ApprovalListPage = lazy(() => import('./ApprovalListPage').then((module) => ({ default: module.ApprovalListPage })))
const ApprovalDetailPage = lazy(() => import('./ApprovalDetailPage').then((module) => ({ default: module.ApprovalDetailPage })))

// 인증 세션에서는 승인 요청 ID 기반 실제 화면만, 개발 전용 미리보기에서는 합성 데모 화면만 연다.
// 미리보기의 상세 주소 값은 Case ID이고 실제 화면의 값은 승인 요청 ID다. 실제 API가 실패해도 데모 데이터로 대체하지 않는다.

export function ApprovalListRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <ApprovalListPage /> : <LiveApprovalEntryPage />
}

export function ApprovalDetailRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <ApprovalDetailPage /> : <LiveApprovalRequestPage />
}
