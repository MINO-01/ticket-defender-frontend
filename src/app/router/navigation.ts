// 관리자 메뉴와 라우트 목록이다. 경로(path)는 기존 URL을 유지하고 화면 이름만 업무 용어로 쓴다.
// support는 서버 지원 범위다. live는 실제 조회와 작업, partial은 일부만 실제 조회, pending은 Backend 계약 대기다.

export const adminGroups = ['업무 시작', '조사', '검토', '운영'] as const
export type AdminGroup = (typeof adminGroups)[number]
export type AdminSupport = 'live' | 'partial' | 'pending'

export const adminPages = [
  { path: 'overview', label: '전체 현황', group: '업무 시작', support: 'live', description: '선택한 공연의 팬 제보, 연결된 예매 그룹, 최근 조사 사건을 확인하고 다음 업무로 이동합니다.' },
  { path: 'fan-reports', label: '팬 제보 조사', group: '조사', support: 'live', description: '팬 제보를 열어 이미지 정보 추출, 검증 회차 연결, 예매 기록 비교, 조사 사건 생성을 진행합니다.' },
  { path: 'verified-performances', label: '검증 회차 관리', group: '조사', support: 'live', description: '공연의 검증된 회차를 등록하고 관리합니다. 예매 기록 비교의 기준이 됩니다.' },
  { path: 'analysis/findings', label: '예매 관계 분석', group: '조사', support: 'live', description: '저장된 연결된 예매 그룹을 조사 우선순위 순으로 확인하고 조사 사건으로 연결합니다.' },
  { path: 'cases', label: '조사 사건', group: '조사', support: 'live', description: '조사 사건의 상태, 연결 근거, 담당자, 보고서 초안과 승인 단계를 관리합니다.' },
  { path: 'approvals', label: '보고서 승인 요청', group: '검토', support: 'partial', description: '조사 보고서 초안의 승인 요청을 열어 독립 검토와 결정을 진행합니다.' },
  { path: 'report-center', label: '조사 보고서 발급', group: '검토', support: 'partial', description: '승인 결정을 기준으로 공식 보고서 PDF 발급 가능 여부와 발급 기록을 확인합니다.' },
  { path: 'imports', label: '예매 자료 준비', group: '운영', support: 'live', description: '합성 격리 테스트 환경에서 예매 스냅샷을 반입합니다.' },
  { path: 'analysis/jobs', label: '분석 작업', group: '운영', support: 'partial', description: '이미지 정보 추출과 예매 기록 비교 실행 상태를 확인하는 경로를 안내합니다.' },
  { path: 'audit', label: '감사 기록', group: '운영', support: 'partial', description: '조사 사건별 활동 기록을 확인합니다.' },
  { path: 'settings', label: '설정', group: '운영', support: 'partial', description: '현재 관리자 세션과 접근 가능한 공연, 서버 인증 상태를 확인합니다.' },
] as const satisfies readonly { path: string; label: string; group: AdminGroup; support: AdminSupport; description: string }[]

/** 메뉴에만 있는 업무 바로가기다. 별도 라우트를 만들지 않고 기존 화면의 서버 필터로 이동한다. */
export const adminShortcuts = [
  // RECEIVED는 증거 저장이 확인된 접수 완료 상태이며 담당자가 아직 보지 않은 신규 제보라는 뜻이 아니다.
  { to: '/app/fan-reports?intakeStatus=RECEIVED', label: '접수 완료된 제보', group: '업무 시작', match: { path: '/app/fan-reports', param: 'intakeStatus', value: 'RECEIVED' } },
] as const

export const supportLabels: Record<AdminSupport, string> = { live: '', partial: '일부 지원', pending: '서버 준비 중' }

export const fanPages = [
  { path: 'guide', label: '제보 안내', description: '제보 절차와 준비할 내용을 안내합니다.', step: 0 },
  { path: 'write', label: '제보 작성', description: '제보 내용을 작성하고 증거파일을 선택합니다.', step: 1 },
  { path: 'review', label: '최종 확인', description: '입력한 내용을 확인하고 제출합니다. 접수 공연이 설정된 환경에서만 제출할 수 있습니다.', step: 2 },
  { path: 'complete', label: '접수 완료', description: '서버가 접수를 확인한 경우에만 접수번호와 조회 코드를 표시합니다.', step: null },
  { path: 'lookup', label: '내 제보 조회 인증', description: '접수번호와 조회 코드로 본인 제보를 확인합니다.', step: null },
  { path: 'status', label: '내 제보 상태', description: '조회 인증 전에는 제보 상세 내용과 이미지를 표시하지 않습니다.', step: null },
] as const
