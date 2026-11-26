// 다회차 후보의 신호 키를 한국어 라벨로 바꾼다. 원래 키는 화면 본문에 쓰지 않고 툴팁(title)으로만 남긴다.
const baseLabels: Record<string, string> = {
  refund_account_hash: '환불 계좌',
  phone_hash: '연락처',
  device_id_hash: '기기',
  address_hash: '배송지',
  payment_hash: '결제',
  ip_window: 'IP 시간창',
  stable_account_cocluster: '같은 계정 반복 동시 군집',
}

const networkLabels: Record<string, string> = {
  RESIDENTIAL: '주거망',
  CORPORATE_EDU: '기업과 교육망',
  DATACENTER_PROXY: '데이터센터와 프록시',
  MOBILE_CGNAT: '모바일 공유망',
  UNKNOWN: '망 유형 미확인',
}

export const unknownSignalLabel = '알 수 없는 신호'

export function signalLabel(key: string): string {
  if (key in baseLabels) return baseLabels[key]
  if (key.startsWith('ip_window:')) {
    const network = networkLabels[key.slice('ip_window:'.length)]
    return network === undefined ? unknownSignalLabel : `IP 시간창(${network})`
  }
  return unknownSignalLabel
}

/** 서버가 JSON 배열 문자열 또는 쉼표 구분 문자열로 보낸 신호 목록을 키 배열로 읽는다. 해석할 수 없으면 빈 배열이다. */
export function parseSignalKeys(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed === '') return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64) : []
    } catch {
      return []
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 64)
}
