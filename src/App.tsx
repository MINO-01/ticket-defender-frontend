import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { adminPages, fanPages } from './app/router/navigation'
import { AdminLayout } from './layouts/admin/AdminLayout'
import { FanLayout } from './layouts/fan/FanLayout'
import { AdminPagePlaceholder } from './pages/admin/AdminPagePlaceholder'
import { LoadingSkeleton } from './components/common/Feedback'
import { AdminRouteErrorBoundary } from './features/admin-track1/AdminRouteErrorBoundary'
import { GuidePage } from './features/fan-report/GuidePage'
import { WritePage } from './features/fan-report/WritePage'
import { ReviewPage } from './features/fan-report/ReviewPage'
import { LookupPage } from './features/fan-report/LookupPage'
import { CompletePage, DemoCompletePage, DemoStatusPage, StatusPage } from './features/fan-report/OutcomePages'
import styles from './App.module.css'

const ClusterListPage = lazy(() => import('./features/admin-track1/ClusterListPage').then((module) => ({ default: module.ClusterListPage })))
const ClusterDetailPage = lazy(() => import('./features/admin-track1/ClusterDetailPage').then((module) => ({ default: module.ClusterDetailPage })))

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

export default function App() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/app" element={<AdminLayout />}>
      <Route index element={<Navigate to="overview" replace />} />
      <Route path="analysis/findings" element={<AdminRouteErrorBoundary backTo="/app/overview" backLabel="전체 현황으로 이동"><Suspense fallback={<LoadingSkeleton label="군집 목록을 여는 중" />}><ClusterListPage /></Suspense></AdminRouteErrorBoundary>} />
      <Route path="analysis/findings/:clusterId" element={<AdminRouteErrorBoundary backTo="/app/analysis/findings" backLabel="군집 목록으로 이동"><Suspense fallback={<LoadingSkeleton label="군집 상세를 여는 중" />}><ClusterDetailPage /></Suspense></AdminRouteErrorBoundary>} />
      {adminPages.filter((page) => page.path !== 'analysis/findings').map((page) => <Route key={page.path} path={page.path} element={<AdminPagePlaceholder title={page.label} description={page.description} reportCenter={page.path === 'report-center'} />} />)}
    </Route>
    <Route path="/fan" element={<FanLayout />}>
      <Route index element={<Navigate to="guide" replace />} />
      {fanPages.map((page) => <Route key={page.path} path={page.path} element={fanPageElements[page.path]} />)}
      {import.meta.env.DEV && <Route path="demo/complete" element={<DemoCompletePage />} />}
      {import.meta.env.DEV && <Route path="demo/status" element={<DemoStatusPage />} />}
    </Route>
    <Route path="*" element={<main className={styles.notFound}><h1>페이지를 찾을 수 없습니다</h1><Link to="/">첫 화면으로 이동</Link></main>} />
  </Routes>
}
