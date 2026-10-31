// 공개 공연 목록 API가 없으므로 격리된 시연 환경에서 서버에 등록된 공연 UUID를 환경 설정으로만 주입한다.
// 설정이 없거나 형식이 잘못되면 실제 제출을 비활성화한다. 활성 여부와 제보 허용 여부는 Backend가 최종 검증한다.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type IntakeEvent = { eventId: string; label: string }

export function isUuid(value: string) {
  return uuidPattern.test(value)
}

/** 실제 접수 가능한 공연 설정을 읽는다. 유효하지 않으면 null을 반환한다. */
export function getIntakeEvent(): IntakeEvent | null {
  const eventId = String(import.meta.env.VITE_FAN_REPORT_EVENT_ID ?? '').trim()
  if (!isUuid(eventId)) return null
  const label = String(import.meta.env.VITE_FAN_REPORT_EVENT_LABEL ?? '').trim().slice(0, 80)
  return { eventId: eventId.toLowerCase(), label: label || '시연 환경 등록 공연' }
}
