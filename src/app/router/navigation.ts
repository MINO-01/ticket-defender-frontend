export const adminPages = [
  { path: 'overview', label: '전체 현황', group: '운영', description: '작업 현황을 확인하는 화면입니다.' },
  { path: 'imports', label: '데이터 반입', group: '운영', description: '데이터 반입 내역을 확인하는 화면입니다.' },
  { path: 'analysis/jobs', label: '분석 작업', group: '운영', description: '분석 작업의 실행 상태를 확인하는 화면입니다.' },
  { path: 'analysis/findings', label: '연관 예매 분석', group: '조사', description: '연관 예매 조사 결과를 살펴보는 화면입니다.' },
  { path: 'fan-reports', label: '팬 제보 검토', group: '조사', description: '팬 제보를 검토하는 화면입니다.' },
  { path: 'cases', label: '사건 관리', group: '조사', description: '사건 검토와 상태 관리를 위한 화면입니다.' },
  { path: 'report-center', label: '보고서 센터', group: '관리', description: '보고서 관련 화면입니다.' },
  { path: 'audit', label: '감사 이력', group: '관리', description: '작업 이력을 확인하는 화면입니다.' },
  { path: 'settings', label: '설정', group: '관리', description: '서비스 설정 화면입니다.' },
] as const

export const fanPages = [
  { path: 'guide', label: '제보 안내', description: '제보 절차와 준비할 내용을 안내합니다.', step: 0 },
  { path: 'write', label: '제보 작성', description: '제보 내용을 작성하고 증거파일을 선택합니다.', step: 1 },
  { path: 'review', label: '최종 확인', description: '입력한 내용을 확인합니다. 실제 접수는 아직 할 수 없습니다.', step: 2 },
  { path: 'complete', label: '접수 완료', description: '실제 접수 API 연결 후에만 완료 상태를 표시합니다.', step: null },
  { path: 'lookup', label: '내 제보 조회 인증', description: '안전한 조회 인증 방식이 확정되면 이 화면을 제공할 예정입니다.', step: null },
  { path: 'status', label: '내 제보 상태', description: '조회 인증 전에는 제보 상세 내용과 이미지를 표시하지 않습니다.', step: null },
] as const
