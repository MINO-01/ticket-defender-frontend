import type { AdminApiResult } from './adminApiClient'

export type AdminApiFailure = Exclude<AdminApiResult<unknown>, { kind: 'success' }>

// 실패 원인별 고정 문구만 표시한다. 서버의 상세 메시지, 고객사 정보, 토큰은 화면과 로그에 남기지 않는다.
// 모든 실패는 조회 결과를 확인하지 못한 상태이며 빈 목록이나 0점으로 바꾸지 않는다.
const notVerified = '조회 결과를 확인하지 못했으며 빈 결과로 간주하지 않습니다.'

export function describeAdminApiFailure(failure: AdminApiFailure, notFoundTitle: string): { title: string; description: string } {
  switch (failure.kind) {
    case 'unauthenticated':
      return { title: '관리자 세션이 만료되었습니다', description: '다시 로그인한 뒤 조회해 주세요.' }
    case 'forbidden':
      return { title: '이 화면에 필요한 역할이 없습니다', description: '인증은 되었지만 이 조회에 필요한 관리자 역할이 없습니다. 고객사 관리자에게 역할을 확인해 주세요.' }
    case 'notFound':
      return { title: notFoundTitle, description: '존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다.' }
    case 'network':
      return { title: '서버에 연결하지 못했습니다', description: `네트워크 상태를 확인한 뒤 다시 시도해 주세요. ${notVerified}` }
    case 'invalidResponse':
      return { title: '서버 응답 형식이 계약과 다릅니다', description: `응답을 신뢰할 수 없어 표시하지 않았습니다. ${notVerified}` }
    case 'problem':
      if (failure.status === 409 && failure.code === 'TENANT_SELECTION_REQUIRED') {
        return { title: '여러 고객사 소속 계정은 아직 지원하지 않습니다', description: '고객사 선택 정책이 확정되지 않아 조회를 차단했습니다. 고객사를 임의로 선택하거나 합치지 않습니다.' }
      }
      if (failure.status === 409 && failure.code === 'MULTI_EVENT_DISABLED') {
        return { title: '다공연 분석 기능이 비활성화되어 있습니다', description: '현재 환경에서 이 기능을 실행하도록 설정되지 않았습니다. 기존 작업의 빈 결과로 처리하지 않습니다.' }
      }
      if (failure.status === 409 && failure.code === 'MULTI_EVENT_PERFORMANCE_SCOPE_REQUIRED') {
        return { title: '회차를 두 개 이상 선택해 주세요', description: '같은 공연이어도 서로 다른 회차가 두 개 이상 있어야 반복 근거를 확인할 수 있습니다. 공개 원장이 있는 회차를 다시 선택해 주세요.' }
      }
      if (failure.status === 409 && failure.code === 'SCORE_VERSION_RETIRED') {
        return { title: '퇴역한 점수 모델의 작업입니다', description: '이전 점수 모델로 저장된 결과는 조회만 할 수 있으며 다시 실행하지 않습니다. 새 분석을 요청해 주세요.' }
      }
      if (failure.status === 409 && failure.code === 'MULTI_EVENT_SUPPLIER_MIXED') {
        return { title: '서로 다른 예매처의 원장은 함께 분석하지 않습니다', description: '선택한 회차의 공급자 namespace가 하나가 아닙니다. 예매처별로 나누어 요청해 주세요.' }
      }
      if (failure.status === 409 && failure.code === 'MULTI_EVENT_IDENTITY_CONTRACT_UNAVAILABLE') {
        return { title: '연결 신호의 키 정보가 하나로 맞지 않습니다', description: '선택한 회차의 HMAC 목적 또는 키 버전이 서로 다르거나 확인되지 않아 함께 분석하지 않습니다.' }
      }
      if (failure.status === 409 && failure.code === 'UPLOAD_OBJECT_EXPIRED') {
        return { title: '업로드 원본이 보존 한도를 넘겨 삭제되었습니다', description: '이 작업은 다시 처리할 수 없습니다. 새 반입 작업으로 등록해 주세요.' }
      }
      if (failure.status === 409 && failure.code === 'TRACK1_SIGNAL_KEY_UNAVAILABLE') {
        return { title: '신호 키 공급원이 설정되지 않았습니다', description: '원본 신호를 안전하게 변환할 키를 확인하지 못해 처리를 중단했습니다. 운영 설정을 확인해 주세요.' }
      }
      if (failure.status === 422 && failure.code === 'BULK_V3_RAW_INTAKE_DISABLED') {
        return { title: '원본 신호 반입(v3)이 비활성화되어 있습니다', description: '현재 환경에서는 v3 원본 신호 파일을 받지 않습니다. v1 또는 v2 형식은 그대로 사용할 수 있습니다.' }
      }
      if (failure.status === 503 && failure.code === 'BULK_V3_DELETE_PERMISSION_UNVERIFIED') {
        return { title: '업로드 원본 삭제 권한을 확인하지 못했습니다', description: `원본을 처리 직후 지울 수 있는지 확인되지 않아 v3 반입을 받지 않습니다. ${notVerified}` }
      }
      if (failure.status === 400) return { title: '요청 값이 올바르지 않습니다', description: '공연, 페이지 또는 정렬 값을 확인해 주세요.' }
      if (failure.status === 503) return { title: '서버가 일시적으로 응답할 수 없습니다', description: `잠시 후 다시 시도해 주세요. ${notVerified}` }
      if (failure.status >= 500) return { title: '서버 오류로 조회하지 못했습니다', description: `잠시 후 다시 시도해 주세요. ${notVerified}` }
      return { title: '요청을 처리하지 못했습니다', description: `서버가 요청을 거부했습니다(${failure.status}). ${notVerified}` }
  }
}
