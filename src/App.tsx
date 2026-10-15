import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { adminPages, fanPages } from './app/router/navigation'
import { AdminLayout } from './layouts/admin/AdminLayout'
import { FanLayout } from './layouts/fan/FanLayout'
import { AdminPagePlaceholder } from './pages/admin/AdminPagePlaceholder'
import { FanPagePlaceholder } from './pages/fan/FanPagePlaceholder'
import styles from './App.module.css'

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
      {adminPages.map((page) => <Route key={page.path} path={page.path} element={<AdminPagePlaceholder title={page.label} description={page.description} reportCenter={page.path === 'report-center'} />} />)}
    </Route>
    <Route path="/fan" element={<FanLayout />}>
      <Route index element={<Navigate to="guide" replace />} />
      {fanPages.map((page) => <Route key={page.path} path={page.path} element={<FanPagePlaceholder title={page.label} description={page.description} step={page.step} />} />)}
    </Route>
    <Route path="*" element={<main className={styles.notFound}><h1>페이지를 찾을 수 없습니다</h1><Link to="/">첫 화면으로 이동</Link></main>} />
  </Routes>
}
