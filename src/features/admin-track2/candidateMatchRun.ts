import type { AdminApiResult } from '../../api/adminApiClient'
import type { CandidateRun } from './candidatePipelineApi'

// 예매 후보 대조 실행 한 번의 시도 상태와 응답 분류다. Backend track2-candidate-pipeline-v1 runListingCandidateMatch 계약을 따른다.
// 같은 요청자, 분석, Idempotency-Key 요청은 다시 조회하지 않고 기록된 실행을 돌려준다. 기록된 실행이 아직 진행 중이면 409 CANDIDATE_LOOKUP_IN_PROGRESS다.
// 503 CANDIDATE_LOOKUP_FAILED_UNRECORDED는 실패 기록을 남겼는지 보장할 수 없다는 뜻이다. 0건이나 실패로 확정하지 않고 같은 키 재확인만 허용한다.
// 201은 후보 실행 기록 생성이며 부정 거래 확정이 아니다. 새 키는 관리자가 새 대조를 명시적으로 시작할 때만 만든다.

export type CandidateMessage = { title: string; description: string }

export type CandidateAttempt =
  | { phase: 'sending'; key: string }
  /** 201과 계약 검증, 요청한 제보, 증거, 분석 일치를 확인했고 실행이 종료되었다. */
  | { phase: 'succeeded'; key: string; run: CandidateRun }
  /** 서버가 실행 전에 요청을 거부했다. 실행 기록은 남지 않았다. 다시 하려면 새 키가 필요하다. */
  | { phase: 'rejected'; key: string; message: CandidateMessage }
  /** 기록된 실행이 아직 진행 중이다. 같은 키로 재확인한다. */
  | { phase: 'inProgress'; key: string }
  /** 응답을 받지 못했거나 신뢰할 수 없다. 서버에서 실행되었을 수 있으므로 같은 키를 보존한다. */
  | { phase: 'uncertain'; key: string; message: CandidateMessage }

const notExecuted = '후보 대조를 실행하지 않았고 실행 기록도 남지 않았습니다.'
const sameKey = '같은 요청 재확인은 같은 요청 키를 다시 보내며, 이미 기록된 실행이 있으면 다시 조회하지 않고 그 결과를 받습니다. 후보 실행 이력의 최신 항목을 이 요청의 결과로 단정하지 않습니다.'

function uncertain(key: string, title: string, cause: string): CandidateAttempt {
  return { phase: 'uncertain', key, message: { title, description: `${cause} ${sameKey}` } }
}

function rejected(result: Exclude<AdminApiResult<CandidateRun>, { kind: 'success' }>): CandidateMessage | null {
  switch (result.kind) {
    case 'unauthenticated':
      return { title: '관리자 세션이 만료되었습니다', description: '다시 로그인한 뒤 후보 실행 이력에서 결과를 확인해 주세요.' }
    case 'forbidden':
      return { title: '후보 대조 실행에 필요한 역할이 없습니다', description: `후보 대조는 분석 담당(ANALYST) 또는 검토 담당(REVIEWER)만 실행할 수 있어 서버가 거부했습니다. ${notExecuted}` }
    case 'notFound':
      return { title: '분석 기록을 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notExecuted}` }
    case 'problem':
      if (result.status === 400 && result.code === 'INVALID_IDEMPOTENCY_KEY') return { title: '요청 키를 서버가 거부했습니다', description: `새 후보 대조로 새 요청 키를 만들어 다시 요청해 주세요. ${notExecuted}` }
      if (result.status === 400) return { title: '후보 대조 요청 값이 올바르지 않습니다', description: notExecuted }
      if (result.status === 409 && result.code === 'IDEMPOTENCY_KEY_REUSED') return { title: '같은 요청 키가 다른 요청에 사용되었습니다', description: `서버가 요청을 거부했습니다. 새 후보 대조는 새 요청 키를 만듭니다. ${notExecuted}` }
      if (result.status === 409 && result.code === 'TENANT_SELECTION_REQUIRED') return { title: '여러 고객사 소속 계정은 아직 지원하지 않습니다', description: `고객사 선택 정책이 확정되지 않아 요청을 차단했습니다. ${notExecuted}` }
      return null
    default:
      return null
  }
}

/** POST 결과를 시도 상태로 바꾼다. 요청한 제보, 증거, 분석과 다른 응답은 신뢰하지 않는다. */
export function classifyCandidateResult(result: AdminApiResult<CandidateRun>, key: string, ids: { fanReportId: string; evidenceId: string; analysisId: string }): CandidateAttempt {
  if (result.kind === 'success') {
    const run = result.data
    const matches = run.fanReportId === ids.fanReportId && run.evidenceId === ids.evidenceId && run.analysisId === ids.analysisId
    if (!matches) return uncertain(key, '후보 대조 결과를 확인하지 못했습니다', '서버 응답이 요청한 분석의 실행과 맞지 않아 표시하지 않았습니다.')
    return run.status === 'IN_PROGRESS' ? { phase: 'inProgress', key } : { phase: 'succeeded', key, run }
  }
  if (result.kind === 'network') return uncertain(key, '후보 대조 결과를 확인하지 못했습니다', '서버 응답을 받지 못했습니다.')
  if (result.kind === 'invalidResponse') return uncertain(key, '후보 대조 결과를 확인하지 못했습니다', '서버 응답 형식이 계약과 달라 표시하지 않았습니다.')
  if (result.kind === 'problem' && result.status === 409 && result.code === 'CANDIDATE_LOOKUP_IN_PROGRESS') return { phase: 'inProgress', key }
  if (result.kind === 'problem' && result.status === 503 && result.code === 'CANDIDATE_LOOKUP_FAILED_UNRECORDED') {
    return uncertain(key, '후보 대조 실패 기록을 남겼는지 확인할 수 없습니다', '서버 데이터베이스 장애로 실행 기록을 보장할 수 없다고 응답했습니다. 후보 없음이나 실패로 확정하지 않습니다.')
  }
  if (result.kind === 'problem' && result.status === 503) return uncertain(key, '후보 대조 결과를 확인하지 못했습니다', '서버 의존 서비스가 응답하지 않았습니다.')
  const message = rejected(result)
  if (message) return { phase: 'rejected', key, message }
  return uncertain(key, '후보 대조 결과를 확인하지 못했습니다', '서버가 결과를 확정하지 않은 오류를 반환했습니다.')
}
