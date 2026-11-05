import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { adminPages, fanPages } from './app/router/navigation'
import { AdminLayout } from './layouts/admin/AdminLayout'
import { FanLayout } from './layouts/fan/FanLayout'
import { AdminPagePlaceholder } from './pages/admin/AdminPagePlaceholder'
import { LoadingSkeleton } from './components/common/Feedback'
import { AdminRouteErrorBoundary } from './features/admin-track1/AdminRouteErrorBoundary'
import { AdminAuthProvider } from './features/admin-auth/AdminAuthProvider'
import { ApprovalAttemptProvider } from './features/admin-approvals/approvalAttempts'
import { RequireAdminAuth } from './features/admin-auth/RequireAdminAuth'
import type { AdminAuthAdapter } from './features/admin-auth/authAdapter'
import { BackendAuthCheckPanel } from './features/admin-settings/BackendAuthCheckPanel'
import { OfficialPdfDecisionRoute, ReportCenterRoute } from './features/admin-reports/ReportCenterRoutes'
import { GuidePage } from './features/fan-report/GuidePage'
import { WritePage } from './features/fan-report/WritePage'
import { ReviewPage } from './features/fan-report/ReviewPage'
import { LookupPage } from './features/fan-report/LookupPage'
import { CompletePage, DemoCompletePage, DemoStatusPage, StatusPage } from './features/fan-report/OutcomePages'
import styles from './App.module.css'

const Track1ListRoute = lazy(() => import('./features/admin-track1/Track1Routes').then((module) => ({ default: module.Track1ListRoute })))
const Track1DetailRoute = lazy(() => import('./features/admin-track1/Track1Routes').then((module) => ({ default: module.Track1DetailRoute })))
const Track1DemoDetailRoute = lazy(() => import('./features/admin-track1/Track1Routes').then((module) => ({ default: module.Track1DemoDetailRoute })))
const Track2ListRoute = lazy(() => import('./features/admin-track2/Track2Routes').then((module) => ({ default: module.Track2ListRoute })))
const VerifiedPerformanceRoute = lazy(() => import('./features/admin-track2/Track2Routes').then((module) => ({ default: module.VerifiedPerformanceRoute })))
const Track2DetailRoute = lazy(() => import('./features/admin-track2/Track2Routes').then((module) => ({ default: module.Track2DetailRoute })))
const CaseListRoute = lazy(() => import('./features/admin-cases/CaseRoutes').then((module) => ({ default: module.CaseListRoute })))
const CaseDetailRoute = lazy(() => import('./features/admin-cases/CaseRoutes').then((module) => ({ default: module.CaseDetailRoute })))
const ApprovalListRoute = lazy(() => import('./features/admin-approvals/ApprovalRoutes').then((module) => ({ default: module.ApprovalListRoute })))
const ApprovalDetailRoute = lazy(() => import('./features/admin-approvals/ApprovalRoutes').then((module) => ({ default: module.ApprovalDetailRoute })))

// 보고서 센터는 실제 세션에서 승인 결정 ID 기반 공식 PDF 화면을, 미리보기에서 기존 비활성 안내를 연다.
const reportCenterPage = adminPages.find((page) => page.path === 'report-center') ?? { label: '보고서 센터', description: '보고서 관련 화면입니다.' }

const fanPageElements = {
  guide: <GuidePage />,
  write: <WritePage />,
  review: <ReviewPage />,
  complete: <CompletePage />,
  lookup: <LookupPage />,
  status: <StatusPage />,
} satisfies Record<(typeof fanPages)[number]['path'], ReactNode>

function Home() {
  return <main className={styles.home}>
    <span className={styles.brand}>Ticket Defender</span>
    <h1>필요한 화면으로 이동하세요</h1>
    <p>초기 화면 구조를 확인할 수 있습니다. 실제 서비스 인증과 업무 기능은 아직 연결되지 않았습니다.</p>
    <div className={styles.choices}>
      <Link to="/app/overview"><span>관리자</span><strong>운영 화면 살펴보기</strong><small>공통 메뉴와 화면 이동</small></Link>
      <Link to="/fan/guide"><span>팬 제보</span><strong>제보 화면 살펴보기</strong><small>안내부터 조회 화면까지</small></Link>
    </div>
  </main>
}

export default function App({ adminAuthAdapter }: { adminAuthAdapter?: AdminAuthAdapter }) {
  return <AdminAuthProvider adapter={adminAuthAdapter}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/app" element={<RequireAdminAuth><ApprovalAttemptProvider><AdminLayout /></ApprovalAttemptProvider></RequireAdminAuth>}>
      <Route index element={<Navigate to="overview" replace />} />
      <Route path="analysis/findings" element={<AdminRouteErrorBoundary backTo="/app/overview" backLabel="전체 현황으로 이동"><Suspense fallback={<LoadingSkeleton label="군집 목록을 여는 중" />}><Track1ListRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="analysis/findings/detail" element={<AdminRouteErrorBoundary backTo="/app/analysis/findings" backLabel="군집 목록으로 이동"><Suspense fallback={<LoadingSkeleton label="군집 상세를 여는 중" />}><Track1DetailRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="analysis/findings/:clusterId" element={<AdminRouteErrorBoundary backTo="/app/analysis/findings" backLabel="군집 목록으로 이동"><Suspense fallback={<LoadingSkeleton label="군집 상세를 여는 중" />}><Track1DemoDetailRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="fan-reports" element={<AdminRouteErrorBoundary backTo="/app/overview" backLabel="전체 현황으로 이동"><Suspense fallback={<LoadingSkeleton label="팬 제보 목록을 여는 중" />}><Track2ListRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="verified-performances" element={<AdminRouteErrorBoundary backTo="/app/fan-reports" backLabel="팬 제보 목록으로 이동"><Suspense fallback={<LoadingSkeleton label="검증 회차 관리를 여는 중" />}><VerifiedPerformanceRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="fan-reports/:reportId" element={<AdminRouteErrorBoundary backTo="/app/fan-reports" backLabel="제보 목록으로 이동"><Suspense fallback={<LoadingSkeleton label="제보 상세를 여는 중" />}><Track2DetailRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="cases" element={<AdminRouteErrorBoundary backTo="/app/overview" backLabel="전체 현황으로 이동"><Suspense fallback={<LoadingSkeleton label="사건 목록을 여는 중" />}><CaseListRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="cases/:caseId" element={<AdminRouteErrorBoundary backTo="/app/cases" backLabel="사건 목록으로 이동"><Suspense fallback={<LoadingSkeleton label="사건 상세를 여는 중" />}><CaseDetailRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="approvals" element={<AdminRouteErrorBoundary backTo="/app/cases" backLabel="사건 목록으로 이동"><Suspense fallback={<LoadingSkeleton label="승인 검토 화면을 여는 중" />}><ApprovalListRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="approvals/:approvalRequestId" element={<AdminRouteErrorBoundary backTo="/app/approvals" backLabel="승인 검토 화면으로 이동"><Suspense fallback={<LoadingSkeleton label="승인 요청을 여는 중" />}><ApprovalDetailRoute /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="report-center" element={<AdminRouteErrorBoundary backTo="/app/overview" backLabel="전체 현황으로 이동"><ReportCenterRoute title={reportCenterPage.label} description={reportCenterPage.description} /></AdminRouteErrorBoundary>} />
      <Route path="report-center/decisions/:approvalDecisionId" element={<AdminRouteErrorBoundary backTo="/app/report-center" backLabel="보고서 센터로 이동"><OfficialPdfDecisionRoute title={reportCenterPage.label} description={reportCenterPage.description} /></AdminRouteErrorBoundary>} />
      {adminPages.filter((page) => page.path !== 'analysis/findings' && page.path !== 'fan-reports' && page.path !== 'verified-performances' && page.path !== 'cases' && page.path !== 'approvals' && page.path !== 'report-center').map((page) => <Route key={page.path} path={page.path} element={<><AdminPagePlaceholder title={page.label} description={page.description} />{page.path === 'settings' && <BackendAuthCheckPanel />}</>} />)}
    </Route>
    <Route path="/fan" element={<FanLayout />}>
      <Route index element={<Navigate to="guide" replace />} />
      {fanPages.map((page) => <Route key={page.path} path={page.path} element={fanPageElements[page.path]} />)}
      {import.meta.env.DEV && <Route path="demo/complete" element={<DemoCompletePage />} />}
      {import.meta.env.DEV && <Route path="demo/status" element={<DemoStatusPage />} />}
    </Route>
    <Route path="*" element={<main className={styles.notFound}><h1>페이지를 찾을 수 없습니다</h1><Link to="/">첫 화면으로 이동</Link></main>} />
  </Routes></AdminAuthProvider>
}
