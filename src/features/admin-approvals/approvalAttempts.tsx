import { createContext, useContext, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

// 결정 결과를 확인하지 못한 채 화면을 떠난 승인 요청 ID만 현재 관리자 세션 메모리에 기록한다.
// 영수증 원문, 요청 키, 결정 본문은 기록하지 않는다. 화면을 떠날 때 그 값들은 폐기되므로 재진입 화면은 서버 상태로만 결과를 확인한다.
// 인증된 관리자 화면 안에서만 렌더링되므로 로그아웃이나 세션 만료로 관리자 화면이 사라지면 기록도 함께 사라진다.

type ApprovalAttempts = {
  mark: (requestId: string) => void
  unmark: (requestId: string) => void
  has: (requestId: string) => boolean
}

const fallback: ApprovalAttempts = { mark: () => undefined, unmark: () => undefined, has: () => false }
const ApprovalAttemptContext = createContext<ApprovalAttempts>(fallback)

export function ApprovalAttemptProvider({ children }: { children: ReactNode }) {
  const ids = useRef(new Set<string>())
  const value = useMemo<ApprovalAttempts>(() => ({
    mark: (requestId) => { ids.current.add(requestId) },
    unmark: (requestId) => { ids.current.delete(requestId) },
    has: (requestId) => ids.current.has(requestId),
  }), [])
  return <ApprovalAttemptContext.Provider value={value}>{children}</ApprovalAttemptContext.Provider>
}

export function useApprovalAttempts() {
  return useContext(ApprovalAttemptContext)
}
