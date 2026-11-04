import { lazy } from 'react'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { LiveCaseDetailPage } from './LiveCaseDetailPage'
import { LiveCaseListPage } from './LiveCaseListPage'

// 합성 데모 화면과 demoCaseData는 개발 전용 미리보기에서만 불러와 인증 세션의 실제 화면 번들에 포함하지 않는다.
const CaseListPage = lazy(() => import('./CaseListPage').then((module) => ({ default: module.CaseListPage })))
const CaseDetailPage = lazy(() => import('./CaseDetailPage').then((module) => ({ default: module.CaseDetailPage })))

// 인증 세션에서는 실제 API 화면만, 개발 전용 미리보기에서는 합성 데모 화면만 연다.
// 실제 API가 실패해도 데모 데이터로 대체하지 않는다.

export function CaseListRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <CaseListPage /> : <LiveCaseListPage />
}

export function CaseDetailRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <CaseDetailPage /> : <LiveCaseDetailPage />
}
