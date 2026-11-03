import { isIdempotencyKey } from '../../api/adminApiClient'
import type { AdminApiResult } from '../../api/adminApiClient'
import type { FanReportEvidence, ListingAnalysis } from './track2Api'

// 관리자 이미지 분석 실행 한 번의 시도 상태와 응답 분류다. Backend track2-listing-analysis-v1 계약을 따른다.
// 같은 요청자, 증거, Idempotency-Key 요청은 Python을 다시 호출하지 않고 기록된 결과를 같은 상태 코드로 돌려준다.
// 따라서 결과를 확인하지 못한 시도는 같은 키로만 재확인하고, 새 키는 관리자가 새 분석을 명시적으로 시작할 때만 만든다.
// 분석 이력 GET에는 키가 없으므로 최신 이력 행을 이 시도의 결과로 단정하지 않는다.

/** Backend 분석 입력 상한. 원본 접수 상한과 다르며, 넘는 원본도 정상 접수된 원본일 수 있다. */
export const analysisInputMaxBytes = 5 * 1024 * 1024
const analysisMediaTypes = ['image/jpeg', 'image/png']

export type RunEligibility = { runnable: true } | { runnable: false; reason: string }

/** 상세 응답의 증거 메타데이터로 실행 가능 여부를 판단한다. 최종 검증은 서버가 원본 바이트로 다시 수행한다. */
export function analysisEligibility(evidence: FanReportEvidence): RunEligibility {
  if (!evidence.originalStored) return { runnable: false, reason: '원본 저장이 확인되지 않아 분석할 수 없습니다.' }
  if (!analysisMediaTypes.includes(evidence.mediaType)) return { runnable: false, reason: '분석은 JPEG와 PNG만 지원합니다. 원본 접수 실패가 아닙니다.' }
  if (evidence.byteSize > analysisInputMaxBytes) return { runnable: false, reason: '분석 입력 상한 5 MiB를 넘어 분석할 수 없습니다. 원본 접수 실패가 아닙니다.' }
  return { runnable: true }
}

/** 브라우저 암호 난수로 UUID v4 키를 만든다. 만들 수 없는 환경이면 null을 반환하고 요청하지 않는다. */
export function createIdempotencyKey(): string | null {
  try {
    const key = globalThis.crypto?.randomUUID?.()
    return typeof key === 'string' && isIdempotencyKey(key) ? key.toLowerCase() : null
  } catch {
    return null
  }
}

export type RunMessage = { title: string; description: string }

export type RunAttempt =
  /** 요청을 보냈고 응답을 기다린다. */
  | { phase: 'sending'; key: string }
  /** 201과 계약 검증, 제보와 증거 일치를 확인한 결과다. */
  | { phase: 'succeeded'; key: string; analysis: ListingAnalysis }
  /** 서버가 이 시도를 실패로 확정했다. 다시 하려면 새 키가 필요하다. */
  | { phase: 'failed'; key: string; message: RunMessage }
  /** 서버가 분석 전에 요청을 거부했거나 분석 기능이 꺼져 있다. 분석 이력은 남지 않는다. */
  | { phase: 'rejected'; key: string; message: RunMessage }
  /** 409 ANALYSIS_IN_PROGRESS. 같은 키로 재확인한다. */
  | { phase: 'inProgress'; key: string }
  /** 응답을 받지 못했거나 신뢰할 수 없다. 서버 분석은 실행되었을 수 있으므로 같은 키를 보존한다. */
  | { phase: 'uncertain'; key: string; message: RunMessage }

const recorded = '이 시도는 분석 실패 이력으로 기록되었습니다. 정상 빈 결과가 아닙니다.'
const retryLater = '잠시 후 새 분석 실행으로 다시 요청할 수 있으며 새 요청으로 기록됩니다.'
const integrity: RunMessage = { title: '원본 무결성 확인에 실패해 분석하지 않았습니다', description: `저장된 원본의 크기, 형식, 버전 또는 SHA-256이 접수 기록과 맞지 않습니다. ${recorded}` }

// 서버가 실패 이력을 남기고 결과를 확정하는 코드만 둔다. 목록에 없는 코드는 결과를 확인하지 못한 것으로 처리한다.
const failedMessages: Record<number, Record<string, RunMessage>> = {
  409: {
    ANALYSIS_ABANDONED: { title: '이전 분석 시도가 시간 초과로 종료되었습니다', description: '같은 요청의 처리 시간이 서버 임대 시간을 넘어 종료로 기록되었습니다. 다시 분석하려면 새 분석 실행을 눌러 주세요.' },
  },
  422: {
    SOURCE_NOT_AVAILABLE: { title: '원본 저장이 확인되지 않아 분석하지 않았습니다', description: recorded },
    RETENTION_EXPIRED: { title: '보존 기한이 지나 분석하지 않았습니다', description: recorded },
    UNSUPPORTED_IMAGE_TYPE: { title: '분석이 지원하지 않는 이미지 형식입니다', description: `분석은 JPEG와 PNG만 지원합니다. 원본 접수 실패가 아닙니다. ${recorded}` },
    ANALYSIS_INPUT_TOO_LARGE: { title: '분석 입력 크기 상한을 넘었습니다', description: `분석 입력은 5 MiB 이하만 지원합니다. 원본 접수 실패가 아닙니다. ${recorded}` },
    OBJECT_MISSING: integrity, OBJECT_CHANGED: integrity, SIZE_MISMATCH: integrity, MEDIA_TYPE_MISMATCH: integrity, HASH_MISMATCH: integrity,
  },
  502: {
    ANALYZER_AUTH_FAILED: { title: '분석 서버 내부 인증에 실패했습니다', description: `서버 간 인증 설정을 확인해야 합니다. ${recorded}` },
    ANALYZER_INPUT_REJECTED: { title: '분석 서버가 입력 이미지를 거부했습니다', description: recorded },
    ANALYZER_MODEL_FAILED: { title: '모델이 관찰 결과를 만들지 못했습니다', description: `${recorded} ${retryLater}` },
    ANALYZER_INTERNAL_ERROR: { title: '분석 서버 내부 오류로 분석하지 못했습니다', description: `${recorded} ${retryLater}` },
    ANALYZER_RESPONSE_INVALID: { title: '분석 서버 응답이 계약과 달라 거부했습니다', description: `계약을 벗어난 결과는 저장하거나 표시하지 않습니다. ${recorded}` },
    ANALYZER_IDENTITY_MISMATCH: { title: '분석 응답이 요청한 증거와 일치하지 않아 거부했습니다', description: `요청 ID, 증거 ID 또는 SHA-256이 다른 응답은 저장하거나 표시하지 않습니다. ${recorded}` },
  },
  503: {
    STORAGE_UNAVAILABLE: { title: '원본 저장소에 연결하지 못했습니다', description: `${recorded} ${retryLater}` },
    ANALYZER_UNAVAILABLE: { title: '분석 서버에 연결하지 못했습니다', description: `${recorded} ${retryLater}` },
    ANALYZER_CONNECTION_FAILED: { title: '분석 서버에 연결하지 못했습니다', description: `${recorded} ${retryLater}` },
  },
  504: {
    ANALYZER_TIMEOUT: { title: '분석 서버 응답 대기 시간이 초과되었습니다', description: `서버가 결과를 기다리다 실패로 기록했습니다. ${recorded} ${retryLater}` },
    ANALYZER_MODEL_TIMEOUT: { title: '모델 처리 시간이 초과되었습니다', description: `${recorded} ${retryLater}` },
  },
}

const notExecuted = '분석을 실행하지 않았고 분석 이력도 남지 않았습니다.'

function rejectedMessage(result: Exclude<AdminApiResult<ListingAnalysis>, { kind: 'success' }>): RunMessage | null {
  switch (result.kind) {
    case 'unauthenticated':
      return { title: '관리자 세션이 만료되었습니다', description: '다시 로그인한 뒤 분석 이력에서 결과를 확인해 주세요.' }
    case 'forbidden':
      return { title: '분석 실행에 필요한 역할이 없습니다', description: `분석 실행은 분석가나 검토자 역할이 필요합니다. ${notExecuted}` }
    case 'notFound':
      return { title: '증거를 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notExecuted}` }
    case 'problem':
      if (result.status === 400 && result.code === 'INVALID_IDEMPOTENCY_KEY') return { title: '요청 키를 서버가 거부했습니다', description: `새 분석 실행으로 새 요청 키를 만들어 다시 요청해 주세요. ${notExecuted}` }
      if (result.status === 400) return { title: '분석 요청 값이 올바르지 않습니다', description: notExecuted }
      if (result.status === 409 && result.code === 'TENANT_SELECTION_REQUIRED') return { title: '여러 고객사 소속 계정은 아직 지원하지 않습니다', description: `고객사 선택 정책이 확정되지 않아 요청을 차단했습니다. 고객사를 임의로 선택하거나 합치지 않습니다. ${notExecuted}` }
      if (result.status === 503 && result.code === 'ANALYZER_DISABLED') return { title: '이미지 분석 기능이 비활성 상태입니다', description: `서버 설정에서 분석 기능이 꺼져 있어 ${notExecuted} 화면에서 기능을 켤 수 없습니다.` }
      return null
    default:
      return null
  }
}

const uncertainDescription = '서버에서 분석이 실행되었을 수 있습니다. 같은 요청 재확인은 같은 요청 키를 다시 보내며, 이미 기록된 결과가 있으면 다시 분석하지 않고 그 결과를 받습니다. 분석 이력의 최신 항목을 이 요청의 결과로 단정하지 않습니다.'

function uncertain(key: string, cause: string): RunAttempt {
  return { phase: 'uncertain', key, message: { title: '분석 결과를 확인하지 못했습니다', description: `${cause} ${uncertainDescription}` } }
}

/**
 * POST 결과를 시도 상태로 바꾼다. 201 응답도 실행 완료, 사람 확인 필요, 요청한 제보와 증거가 모두 맞아야 성공이다.
 * 프록시가 만든 5xx처럼 계약 코드가 없는 실패는 서버 분석 실행 여부를 알 수 없으므로 실패로 확정하지 않는다.
 */
export function classifyRunResult(result: AdminApiResult<ListingAnalysis>, key: string, fanReportId: string, evidenceId: string): RunAttempt {
  if (result.kind === 'success') {
    const analysis = result.data
    const valid = analysis.fanReportId === fanReportId && analysis.evidenceId === evidenceId && analysis.executionStatus === 'SUCCEEDED'
      && analysis.analysisStatus !== null && analysis.analysisStatus !== 'FAILED' && analysis.reviewRequired === true
    return valid ? { phase: 'succeeded', key, analysis } : uncertain(key, '서버 응답이 요청한 증거의 분석 결과와 맞지 않아 표시하지 않았습니다.')
  }
  if (result.kind === 'network') return uncertain(key, '서버 응답을 받지 못했습니다.')
  if (result.kind === 'invalidResponse') return uncertain(key, '서버 응답 형식이 계약과 달라 표시하지 않았습니다.')
  if (result.kind === 'problem' && result.status === 409 && result.code === 'ANALYSIS_IN_PROGRESS') return { phase: 'inProgress', key }
  if (result.kind === 'problem') {
    const message = failedMessages[result.status]?.[result.code]
    if (message) return { phase: 'failed', key, message }
  }
  const rejected = rejectedMessage(result)
  if (rejected) return { phase: 'rejected', key, message: rejected }
  return uncertain(key, '서버가 분석 결과를 확정하지 않은 오류를 반환했습니다.')
}
