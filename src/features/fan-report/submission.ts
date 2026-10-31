import type { ApiFailure, FanReportSubmission, SubmissionRequest } from './fanReportApi'
import type { ReportDraft } from './reportModel'

// 제출 시도 생성과 서버 응답 분류를 담당한다. 화면 상태와 분리해 단위 테스트로 검증한다.

/** 브라우저 Web Crypto로 UUID v4 멱등성 키를 생성한다. */
export function createIdempotencyKey() {
  return crypto.randomUUID()
}

/** 32바이트 CSPRNG 값을 padding 없는 Base64url 43자로 인코딩한다. */
export function createRecoverySecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function optional(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** datetime-local 값을 계약 예시와 같은 초 단위 ISO 로컬 일시로 맞춘다. */
function toLocalDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
}

/** 검증된 입력값을 계약에 명시된 report 필드로만 변환한다. 설정된 공연 UUID가 아니면 전송하지 않는다. */
export function toSubmission(draft: ReportDraft, allowedEventId: string): FanReportSubmission | null {
  if (draft.eventId !== allowedEventId) return null
  const report: FanReportSubmission = {
    eventId: allowedEventId,
    performanceAt: toLocalDateTime(draft.performanceAt),
    reportType: draft.reportType as FanReportSubmission['reportType'],
    description: draft.description.trim(),
  }
  const seatArea = optional(draft.seatArea)
  const listingUrl = optional(draft.listingUrl)
  const platform = optional(draft.platform)
  const seller = optional(draft.seller)
  const askingPrice = draft.reportType === 'PREMIUM_RESALE' ? optional(draft.askingPrice) : undefined
  if (seatArea) report.seatArea = seatArea
  if (listingUrl) report.listingUrl = listingUrl
  if (platform) report.platform = platform
  if (seller) report.seller = seller
  if (askingPrice) report.askingPrice = askingPrice
  return report
}

/** 입력 스냅샷, 파일 순서, 키, 비밀을 하나의 시도로 고정한다. */
export function createSubmissionRequest(report: FanReportSubmission, evidence: readonly File[]): SubmissionRequest {
  return Object.freeze({
    report: Object.freeze({ ...report }),
    evidence: Object.freeze([...evidence]),
    idempotencyKey: createIdempotencyKey(),
    recoverySecret: createRecoverySecret(),
  })
}

/**
 * uncertain: 결과를 알 수 없어 같은 시도를 그대로 재전송해야 한다.
 * rejected: 서버가 실패를 확정했다. 다음 제출은 새 시도로 시작한다.
 * blocked: 같은 키의 다른 요청과 충돌해 자동 처리하지 않는다.
 */
export type FailureCategory = 'uncertain' | 'rejected' | 'blocked'

export type FailureView = { category: FailureCategory; title: string; description: string }

const uncertainNote = '같은 내용과 같은 요청 정보로 다시 시도하면 중복 접수 없이 결과를 확인할 수 있습니다. 이 탭을 닫거나 새로고침하면 재시도 정보가 사라져 결과를 복구할 수 없습니다.'

/** 서버 응답을 사용자 안내로 변환한다. 서버의 상세 메시지는 사용하지 않는다. */
export function describeSubmitFailure(failure: ApiFailure, retried: boolean): FailureView {
  if (failure.kind === 'network') return { category: 'uncertain', title: '접수 결과를 확인하지 못했습니다', description: `네트워크 문제로 서버 응답을 받지 못했습니다. 제보가 접수되었는지 아직 알 수 없습니다. ${uncertainNote}` }
  if (failure.kind === 'invalidResponse') return { category: 'uncertain', title: '접수 결과를 확인하지 못했습니다', description: `서버 응답을 확인할 수 없습니다. 제보가 접수되었는지 아직 알 수 없습니다. ${uncertainNote}` }

  const { status, code } = failure
  if (status === 400 || status === 422) return { category: 'rejected', title: '입력 내용을 확인해 주세요', description: status === 422 ? '첨부 이미지가 비어 있거나 손상되었거나 크기가 허용 범위를 벗어났습니다. 이미지를 확인한 뒤 다시 제출해 주세요.' : '입력값 형식이 올바르지 않아 접수되지 않았습니다. 내용을 수정한 뒤 다시 제출해 주세요.' }
  if (status === 404) return { category: 'rejected', title: '현재 제보를 받을 수 없는 공연입니다', description: '선택한 공연이 등록되지 않았거나 제보 접수가 종료되었습니다. 접수되지 않았습니다.' }
  if (status === 409 && code === 'INTAKE_IN_PROGRESS') return { category: 'uncertain', title: '같은 접수를 처리하고 있습니다', description: `서버가 같은 요청을 아직 처리 중입니다. 잠시 후 다시 시도해 결과를 확인해 주세요. ${uncertainNote}` }
  if (status === 409) return { category: 'blocked', title: '요청을 자동으로 처리할 수 없습니다', description: '같은 요청 정보로 처리된 다른 요청과 충돌했습니다. 중복 접수를 막기 위해 자동으로 다시 접수하지 않습니다.' }
  if (status === 413) return { category: 'rejected', title: '첨부 용량이 너무 큽니다', description: '파일 또는 전체 요청 용량이 제한을 넘어 접수되지 않았습니다. 파일 수나 크기를 줄여 주세요.' }
  if (status === 415) return { category: 'rejected', title: '지원하지 않는 파일입니다', description: 'JPEG 또는 PNG 이미지만 첨부할 수 있습니다. 파일 형식을 확인해 주세요.' }
  if (status === 429) return { category: 'uncertain', title: '요청이 너무 많습니다', description: `잠시 후 같은 요청으로 다시 시도해 주세요. ${uncertainNote}` }
  if (status === 503 && code === 'INTAKE_STORAGE_UNAVAILABLE' && !retried) return { category: 'rejected', title: '지금은 접수할 수 없습니다', description: '접수 기능 또는 저장소를 사용할 수 없어 접수되지 않았습니다. 잠시 후 다시 제출해 주세요.' }
  // 응답 유실 뒤 재시도에서 받은 503은 원래 요청의 접수 여부를 확정하지 못하므로 같은 시도를 유지한다.
  if (status >= 500) return { category: 'uncertain', title: '지금은 접수 결과를 확인할 수 없습니다', description: `접수 기능 또는 저장소를 일시적으로 사용할 수 없습니다. ${uncertainNote}` }
  return { category: 'rejected', title: '지금은 접수할 수 없습니다', description: '접수 기능을 사용할 수 없어 접수되지 않았습니다.' }
}

export type LookupFailureView = { title: string; description: string }

/** 조회 실패 안내. 404는 접수번호와 조회 코드 중 무엇이 틀렸는지 구분하지 않는다. */
export function describeLookupFailure(failure: ApiFailure): LookupFailureView {
  if (failure.kind === 'network') return { title: '조회하지 못했습니다', description: '네트워크 문제로 서버 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  if (failure.kind === 'invalidResponse') return { title: '조회하지 못했습니다', description: '서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.' }
  if (failure.status === 404) return { title: '일치하는 제보를 찾을 수 없습니다', description: '접수번호 또는 조회 코드를 다시 확인해 주세요.' }
  if (failure.status === 400) return { title: '입력 형식을 확인해 주세요', description: '접수번호와 조회 코드 형식이 올바르지 않습니다.' }
  if (failure.status === 429) return { title: '조회 요청이 너무 많습니다', description: '잠시 후 다시 시도해 주세요.' }
  if (failure.status === 503) return { title: '지금은 조회할 수 없습니다', description: '조회 기능을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.' }
  return { title: '조회하지 못했습니다', description: '조회 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.' }
}

export const intakeStatusLabels = {
  RECEIVED: '접수됨',
  ANALYSIS_PENDING: '확인 대기',
  ANALYSIS_FAILED: '확인 처리 실패',
  UNVERIFIABLE: '확인 불가',
} as const
