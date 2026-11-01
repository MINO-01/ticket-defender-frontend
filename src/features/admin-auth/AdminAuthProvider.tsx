import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createAdminApiClient } from '../../api/adminApiClient'
import type { AdminApiClient } from '../../api/adminApiClient'
import { accessTokenExpirySkewMs, createDefaultAdminAuthAdapter, isUsableAccessToken } from './authAdapter'
import type { AdminAccessToken, AdminAuthAdapter, AdminAuthUnavailableReason } from './authAdapter'
import { isAdminDemoPreviewEnabled } from './authConfig'

// 관리자 인증 상태를 현재 탭 메모리에서만 관리한다.
// 액세스 토큰은 React 상태나 브라우저 저장소에 두지 않고 ref에만 보관하며, 새로고침하면 다시 로그인해야 한다.

export type AdminAuthState =
  | { status: 'initializing' }
  | { status: 'unavailable'; reason: AdminAuthUnavailableReason }
  /** 개발 빌드 전용 합성 데이터 미리보기. 인증 세션이 아니며 관리자 API를 호출하지 않는다. */
  | { status: 'preview' }
  | { status: 'signedOut' }
  /** 토큰이 만료되었거나 서버가 401로 거부해 세션을 정리했다. */
  | { status: 'expired' }
  | { status: 'authenticated'; expiresAt: number }

type AdminAuthContextValue = {
  state: AdminAuthState
  signIn: () => void
  signOut: () => void
  getAccessToken: () => string | null
  handleUnauthorized: () => void
  requestInitialization: () => void
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

const maxTimerDelayMs = 2_147_483_647

function initialState(adapter: AdminAuthAdapter): AdminAuthState {
  if (adapter.availability.status === 'ready') return { status: 'initializing' }
  return isAdminDemoPreviewEnabled() ? { status: 'preview' } : { status: 'unavailable', reason: adapter.availability.reason }
}

export function AdminAuthProvider({ adapter: adapterProp, children }: { adapter?: AdminAuthAdapter; children: ReactNode }) {
  const [adapter] = useState(() => adapterProp ?? createDefaultAdminAuthAdapter())
  const tokenRef = useRef<AdminAccessToken | null>(null)
  const [state, setState] = useState<AdminAuthState>(() => initialState(adapter))

  const endSession = useCallback((next: 'signedOut' | 'expired') => {
    tokenRef.current = null
    setState((current) => (current.status === 'authenticated' ? { status: next } : current))
  }, [])

  // 관리자 보호 라우트가 처음 열릴 때만 제공자를 초기화해 팬 제보 화면에서는 인증 서버에 접속하지 않는다.
  const [initializationRequested, setInitializationRequested] = useState(false)
  const requestInitialization = useCallback(() => setInitializationRequested(true), [])

  useEffect(() => {
    if (!initializationRequested || adapter.availability.status !== 'ready') return
    let active = true
    // 제공자가 돌려준 토큰도 형식과 만료 시각을 확인한 뒤에만 인증 상태로 전환한다.
    adapter.initialize().then((token) => {
      if (!active) return
      if (isUsableAccessToken(token)) {
        tokenRef.current = { value: token.value, expiresAt: token.expiresAt }
        setState({ status: 'authenticated', expiresAt: token.expiresAt })
      } else {
        setState({ status: 'signedOut' })
      }
    }, () => {
      if (active) setState({ status: 'signedOut' })
    })
    return () => { active = false }
  }, [adapter, initializationRequested])

  const expiresAt = state.status === 'authenticated' ? state.expiresAt : null
  useEffect(() => {
    if (expiresAt === null) return
    const delay = Math.min(Math.max(expiresAt - accessTokenExpirySkewMs - Date.now(), 0), maxTimerDelayMs)
    const timer = setTimeout(() => endSession('expired'), delay)
    return () => clearTimeout(timer)
  }, [expiresAt, endSession])

  const getAccessToken = useCallback(() => {
    const token = tokenRef.current
    if (isUsableAccessToken(token)) return token.value
    if (token) endSession('expired')
    return null
  }, [endSession])

  const handleUnauthorized = useCallback(() => endSession('expired'), [endSession])

  const signIn = useCallback(() => {
    if (adapter.availability.status !== 'ready') return
    void adapter.signIn().catch(() => undefined)
  }, [adapter])

  const signOut = useCallback(() => {
    endSession('signedOut')
    void adapter.signOut().catch(() => undefined)
  }, [adapter, endSession])

  const value = useMemo(() => ({ state, signIn, signOut, getAccessToken, handleUnauthorized, requestInitialization }), [state, signIn, signOut, getAccessToken, handleUnauthorized, requestInitialization])
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext)
  if (!context) throw new Error('AdminAuthProvider 안에서만 관리자 인증 상태를 사용할 수 있습니다')
  return context
}

/** 현재 관리자 세션의 토큰을 사용하는 공통 API 클라이언트. 401 응답을 받으면 세션을 정리한다. */
export function useAdminApiClient(fetchImpl?: typeof fetch): AdminApiClient {
  const { getAccessToken, handleUnauthorized } = useAdminAuth()
  return useMemo(() => createAdminApiClient({ getAccessToken, onUnauthorized: handleUnauthorized, fetchImpl }), [getAccessToken, handleUnauthorized, fetchImpl])
}
