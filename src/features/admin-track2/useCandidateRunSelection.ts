import { useCallback, useRef, useState } from 'react'
import type { CandidateRun } from './candidatePipelineApi'

// 한 제보 상세 화면에서 관리자가 Case 출처로 고른 후보 실행 목록이다. 현재 탭 메모리에만 두고 브라우저 저장소에 남기지 않는다.
// 실행 ID를 키로 보관하므로 이력 페이지를 넘기거나 다른 분석, 증거로 바꿔도 선택이 사라지거나 다른 실행으로 옮겨 가지 않는다.
// 값은 서버 이력 응답의 실행 그대로이며, 다시 조회한 이력에 같은 실행이 있으면 최신 상태로만 바꾼다. 자동으로 선택하거나 해제하지 않는다.
// Case 생성 요청 중이거나 결과 미확인인 동안에는 잠가 재확인 본문과 화면의 선택이 어긋나지 않게 한다.

/** 서버 계약상 Case 출처로 연결할 수 있는 실행이다. 종료되었고 현재 기준(CURRENT)이어야 한다. 최종 판단은 서버가 한다. */
export function isLinkableCandidateRun(run: CandidateRun) {
  return run.status !== 'IN_PROGRESS' && run.applicability === 'CURRENT'
}

function sameRun(a: CandidateRun, b: CandidateRun) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function useCandidateRunSelection() {
  const [selected, setSelected] = useState<CandidateRun[]>([])
  const [locked, setLockedState] = useState(false)
  // 상태 갱신은 비동기라 같은 렌더링 안의 클릭도 막도록 잠금 여부를 동기적으로 함께 기록한다.
  const lockedRef = useRef(false)

  const setLocked = useCallback((next: boolean) => {
    lockedRef.current = next
    setLockedState(next)
  }, [])

  /** 관리자의 명시적 선택과 선택 해제다. 연결할 수 없는 실행은 새로 선택하지 않는다. */
  const toggle = useCallback((run: CandidateRun) => {
    if (lockedRef.current) return
    setSelected((current) => {
      if (current.some((item) => item.runId === run.runId)) return current.filter((item) => item.runId !== run.runId)
      return isLinkableCandidateRun(run) ? [...current, run] : current
    })
  }, [])

  const remove = useCallback((runId: string) => {
    if (lockedRef.current) return
    setSelected((current) => current.filter((item) => item.runId !== runId))
  }, [])

  /** 다시 조회한 이력에서 이미 선택한 실행의 최신 상태를 반영한다. 바뀐 값이 없으면 상태를 바꾸지 않는다. */
  const sync = useCallback((runs: CandidateRun[]) => {
    setSelected((current) => {
      let changed = false
      const next = current.map((item) => {
        const fresh = runs.find((run) => run.runId === item.runId)
        if (!fresh || sameRun(fresh, item)) return item
        changed = true
        return fresh
      })
      return changed ? next : current
    })
  }, [])

  return { selected, locked, toggle, remove, sync, setLocked }
}

export type CandidateRunSelection = ReturnType<typeof useCandidateRunSelection>
