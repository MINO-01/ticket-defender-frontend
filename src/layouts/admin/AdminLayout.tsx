import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { adminGroups, adminPages, adminShortcuts, supportLabels } from '../../app/router/navigation'
import { Button } from '../../components/common/Button'
import { useAdminAuth } from '../../features/admin-auth/AdminAuthProvider'
import styles from './AdminLayout.module.css'

export function AdminSidebar() {
  const location = useLocation()
  // 바로가기와 원래 메뉴가 같은 경로를 쓰므로 서버 필터 값까지 같을 때만 바로가기를 현재 위치로 표시한다.
  const params = new URLSearchParams(location.search)
  const activeShortcut = adminShortcuts.find((shortcut) => location.pathname === shortcut.match.path && params.get(shortcut.match.param) === shortcut.match.value)
  return <aside className={styles.sidebar} aria-label="관리자 메뉴">
    <NavLink to="/" className={styles.brand}><span className={styles.brandMark}>TD</span><span>Ticket Defender<small>조사 지원 관리자 화면</small></span></NavLink>
    <nav aria-label="관리자 탐색">
      {adminGroups.map((group) => <div key={group} className={styles.navGroup}>
        <p className={styles.groupLabel}>{group}</p>
        {adminPages.filter((page) => page.group === group).map((page) => <NavLink key={page.path} to={`/app/${page.path}`}
          className={({ isActive }) => `${styles.navLink} ${isActive && !(activeShortcut && activeShortcut.match.path === `/app/${page.path}`) ? styles.active : ''}`}>
          <span>{page.label}</span>{page.support !== 'live' && <small className={styles.supportTag}>{supportLabels[page.support]}</small>}
        </NavLink>)}
        {adminShortcuts.filter((shortcut) => shortcut.group === group).map((shortcut) => <Link key={shortcut.to} to={shortcut.to} aria-current={activeShortcut === shortcut ? 'page' : undefined}
          className={`${styles.navLink} ${activeShortcut === shortcut ? styles.active : ''}`}><span>{shortcut.label}</span></Link>)}
      </div>)}
    </nav>
    <p className={styles.sidebarNote}>분석 결과와 상태는 조사 지원 정보이며 부정 거래 판정이 아닙니다.</p>
  </aside>
}

export function AdminHeader() {
  const { state, signOut } = useAdminAuth()
  // 미리보기 상태는 인증 세션이 아니므로 인증된 관리자처럼 표시하지 않는다. 사용자 식별 정보는 서버 조회 없이 표시하지 않는다.
  const sessionArea = state.status === 'authenticated'
    ? <div className={styles.session}><span className={styles.previewTag}>인증된 관리자 세션</span><Button variant="secondary" size="small" onClick={signOut}>로그아웃</Button></div>
    : <span className={styles.previewTag}>합성 데이터 미리보기 (인증되지 않음)</span>
  return <header className={styles.header}><div><span className={styles.headerEyebrow}>운영 화면</span><strong>관리자 작업 공간</strong></div>{sessionArea}</header>
}

export function AdminContent() {
  return <main id="main-content" className={styles.content}><Outlet /></main>
}

export function AdminLayout() {
  return <div className={styles.shell}><a className={styles.skipLink} href="#main-content">본문으로 건너뛰기</a><AdminSidebar /><div className={styles.workspace}><AdminHeader /><AdminContent /></div></div>
}
