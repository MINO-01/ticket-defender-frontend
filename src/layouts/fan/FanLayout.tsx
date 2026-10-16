import { NavLink, Outlet } from 'react-router-dom'
import { FanIcon } from '../../components/fan/FanIcon'
import { FanReportProvider } from '../../features/fan-report/FanReportState'
import styles from './FanLayout.module.css'

export function FanHeader() {
  return <header className={styles.header}><div className={styles.headerInner}><NavLink to="/fan/guide" className={styles.brand}><span className={styles.mark}><FanIcon name="shield" size={27} /></span><span>Ticket Defender<small>팬 제보</small></span></NavLink><nav className={styles.topNav} aria-label="팬 상단 탐색"><NavLink to="/fan/guide">제보 안내</NavLink><NavLink to="/fan/write">제보 작성</NavLink><NavLink to="/fan/lookup">내 제보 조회</NavLink></nav><NavLink to="/fan/lookup" className={styles.mobileLookup}><FanIcon name="lookup" size={18} />내 제보 조회</NavLink></div></header>
}

export function FanBottomNavigation() {
  const links = [
    { to: '/fan/guide', label: '제보 안내', icon: 'guide' as const },
    { to: '/fan/write', label: '제보 작성', icon: 'write' as const },
    { to: '/fan/lookup', label: '내 제보 조회', icon: 'lookup' as const },
  ]
  return <nav className={styles.bottomNav} aria-label="팬 제보 탐색">{links.map((link) => <NavLink key={link.to} to={link.to} className={({ isActive }) => `${styles.bottomLink} ${isActive ? styles.active : ''}`}><FanIcon name={link.icon} size={21} /><span>{link.label}</span></NavLink>)}</nav>
}

export function FanLayout() {
  return <FanReportProvider><div className={styles.shell}><a className={styles.skipLink} href="#fan-content">본문으로 건너뛰기</a><FanHeader /><main id="fan-content" className={styles.content}><Outlet /></main><FanBottomNavigation /></div></FanReportProvider>
}
