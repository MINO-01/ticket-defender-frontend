import { NavLink, Outlet } from 'react-router-dom'
import { adminPages } from '../../app/router/navigation'
import styles from './AdminLayout.module.css'

export function AdminSidebar() {
  const groups = ['운영', '조사', '관리'] as const
  return <aside className={styles.sidebar} aria-label="관리자 메뉴">
    <NavLink to="/" className={styles.brand}><span className={styles.brandMark}>TD</span><span>Ticket Defender<small>관리자 화면</small></span></NavLink>
    <nav aria-label="관리자 탐색">
      {groups.map((group) => <div key={group} className={styles.navGroup}>
        <p className={styles.groupLabel}>{group}</p>
        {adminPages.filter((page) => page.group === group).map((page) => <NavLink key={page.path} to={`/app/${page.path}`} className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}><span>{page.label}</span></NavLink>)}
      </div>)}
    </nav>
    <p className={styles.sidebarNote}>초기 화면 구성 · 인증 기능 미구현</p>
  </aside>
}

export function AdminHeader() {
  return <header className={styles.header}><div><span className={styles.headerEyebrow}>운영 화면</span><strong>관리자 작업 공간</strong></div><span className={styles.previewTag}>레이아웃 미리보기</span></header>
}

export function AdminContent() {
  return <main id="main-content" className={styles.content}><Outlet /></main>
}

export function AdminLayout() {
  return <div className={styles.shell}><a className={styles.skipLink} href="#main-content">본문으로 건너뛰기</a><AdminSidebar /><div className={styles.workspace}><AdminHeader /><AdminContent /></div></div>
}
