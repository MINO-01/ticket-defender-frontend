import { lazy, Suspense } from 'react'
import { LoadingSkeleton } from '../../components/common/Feedback'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'

// 인증 세션에서는 승인 결정 ID 기반 실제 공식 PDF 화면만, 개발 전용 미리보기에서는 기존 비활성 안내만 연다.
// 미리보기는 실제 API를 부르지 않고, 실제 API가 실패해도 데모 데이터로 대체하지 않는다.
const LiveReportCenterEntryPage = lazy(() => import('./LiveReportCenterEntryPage').then((module) => ({ default: module.LiveReportCenterEntryPage })))
const LiveOfficialPdfPage = lazy(() => import('./LiveOfficialPdfPage').then((module) => ({ default: module.LiveOfficialPdfPage })))

type Props = { title: string; description: string }

export function ReportCenterRoute({ title, description }: Props) {
  const { state } = useAdminAuth()
  if (state.status === 'preview') return <AdminPagePlaceholder title={title} description={description} reportCenter />
  return <Suspense fallback={<LoadingSkeleton label="보고서 센터를 여는 중" />}><LiveReportCenterEntryPage /></Suspense>
}

export function OfficialPdfDecisionRoute({ title, description }: Props) {
  const { state } = useAdminAuth()
  if (state.status === 'preview') return <AdminPagePlaceholder title={title} description={description} reportCenter />
  return <Suspense fallback={<LoadingSkeleton label="공식 PDF 화면을 여는 중" />}><LiveOfficialPdfPage /></Suspense>
}
