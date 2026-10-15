import { NavLink, Outlet } from 'react-router-dom'
import styles from './FanLayout.module.css'

export function FanHeader() {
  return <header className={styles.header}><NavLink to="/" className={styles.brand}><span className={styles.mark}>TD</span><span>Ticket Defender<small>팬 제보</small></span></NavLink><span className={styles.headerTag}>화면 미리보기</span></header>
}

export function FanBottomNavigation() {
  const links = [
    { to: '/fan/guide', label: '제보 안내' },
    { to: '/fan/write', label: '제보 작성' },
    { to: '/fan/lookup', label: '내 제보 조회' },
  ]
  return <nav className={styles.bottomNav} aria-label="팬 제보 탐색">{links.map((link) => <NavLink key={link.to} to={link.to} className={({ isActive }) => `${styles.bottomLink} ${isActive ? styles.active : ''}`}>{link.label}</NavLink>)}</nav>
}

export function FanLayout() {
  return <div className={styles.shell}><a className={styles.skipLink} href="#fan-content">본문으로 건너뛰기</a><FanHeader /><main id="fan-content" className={styles.content}><Outlet /></main><FanBottomNavigation /></div>
}
