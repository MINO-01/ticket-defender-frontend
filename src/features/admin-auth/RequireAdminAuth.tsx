import { useEffect, useEffectEvent } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { LoadingSkeleton } from '../../components/common/Feedback'
import { useAdminAuth } from './AdminAuthProvider'
import type { AdminAuthUnavailableReason } from './authAdapter'
import { rememberAdminReturnPath, takeAdminReturnPath } from './returnPath'
import styles from './AdminAuth.module.css'

// 인증되지 않은 상태에서는 관리자 레이아웃과 업무 화면을 렌더링하지 않아 관리자 정보 요청 자체가 일어나지 않게 한다.

const unavailableMessages: Record<AdminAuthUnavailableReason, { title: string; description: string }> = {
  configMissing: { title: '관리자 인증이 설정되지 않았습니다', description: '인증 발급자 설정이 없어 관리자 기능을 사용할 수 없습니다. 운영 담당자에게 인증 설정을 확인해 주세요.' },
  configInvalid: { title: '관리자 인증 설정이 올바르지 않습니다', description: '인증 발급자 설정 형식이 잘못되어 관리자 기능을 차단했습니다. 운영 담당자에게 인증 설정을 확인해 주세요.' },
  providerUndecided: { title: '관리자 로그인을 아직 사용할 수 없습니다', description: '인증 제공자가 확정되지 않아 로그인이 연결되지 않았습니다. 관리자 기능은 비활성 상태입니다.' },
}

function AuthGate({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <main className={styles.gate}>
    <section className={styles.panel} aria-labelledby="admin-auth-title">
      <span className={styles.brand}>Ticket Defender 관리자</span>
      <h1 id="admin-auth-title">{title}</h1>
      <p>{description}</p>
      <div className={styles.actions}>{action}<Link to="/">첫 화면으로 이동</Link></div>
    </section>
  </main>
}

export function RequireAdminAuth({ children }: { children: ReactNode }) {
  const { state, signIn: providerSignIn, requestInitialization } = useAdminAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // 콜백 fragment를 SDK가 먼저 처리하도록 초기화가 끝날 때까지 하위 라우트(Navigate 포함)를 렌더링하지 않는다.
  useEffect(() => requestInitialization(), [requestInitialization])

  // 로그인 콜백은 고정 주소로 돌아오므로 로그인 직전 주소를 보관했다가 인증된 뒤 한 번만 복원한다.
  const signIn = () => {
    rememberAdminReturnPath(`${location.pathname}${location.search}`)
    providerSignIn()
  }
  const restoreReturnPath = useEffectEvent(() => {
    const path = takeAdminReturnPath()
    if (path !== null && path !== `${location.pathname}${location.search}`) navigate(path, { replace: true })
  })
  useEffect(() => {
    if (state.status === 'authenticated') restoreReturnPath()
  }, [state.status])
  switch (state.status) {
    case 'authenticated':
    case 'preview':
      return children
    case 'initializing':
      return <main className={styles.gate}><LoadingSkeleton label="관리자 인증 상태를 확인하는 중" /></main>
    case 'unavailable':
      return <AuthGate {...unavailableMessages[state.reason]} />
    case 'expired':
      return <AuthGate title="관리자 세션이 종료되었습니다" description="세션이 만료되었거나 더 이상 유효하지 않습니다. 계속하려면 다시 로그인해 주세요." action={<Button onClick={signIn}>다시 로그인</Button>} />
    case 'signedOut':
      return <AuthGate title="관리자 로그인이 필요합니다" description="관리자 화면은 인증된 관리자만 사용할 수 있습니다." action={<Button onClick={signIn}>로그인</Button>} />
  }
}
