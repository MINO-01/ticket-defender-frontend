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
      if (failure.status === 400) return { title: '요청 값이 올바르지 않습니다', description: '공연, 페이지 또는 정렬 값을 확인해 주세요.' }
      if (failure.status === 503) return { title: '서버가 일시적으로 응답할 수 없습니다', description: `잠시 후 다시 시도해 주세요. ${notVerified}` }
      if (failure.status >= 500) return { title: '서버 오류로 조회하지 못했습니다', description: `잠시 후 다시 시도해 주세요. ${notVerified}` }
      return { title: '요청을 처리하지 못했습니다', description: `서버가 요청을 거부했습니다(${failure.status}). ${notVerified}` }
  }
}
