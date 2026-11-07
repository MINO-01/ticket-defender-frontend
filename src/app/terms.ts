// 관리자 화면에 표시하는 업무 용어 사전이다. API enum, DB 필드명, 경로는 바꾸지 않고 화면 문구만 이 이름을 쓴다.
// 내부 개념(Track 1, Cluster, Case 등)을 처음 보는 관리자도 업무 흐름을 이해할 수 있게 하는 것이 목적이다.

export const terms = {
  track1: '예매 관계 분석',
  track2: '팬 제보 조사',
  cluster: '연결된 예매 그룹',
  case: '조사 사건',
  listingAnalysis: '이미지 정보 추출',
  candidateMatch: '예매 기록 비교',
  matchCandidate: '일치 예매 후보',
  evidenceSnapshot: '조사 근거 묶음',
  reportVersion: '조사 보고서 초안',
  approvalRequest: '보고서 승인 요청',
  approvalDecision: '승인 결정',
  officialPdf: '공식 보고서 PDF',
  verifiedPerformance: '검증 회차',
  reservationImport: '예매 자료 준비',
} as const

/** 화면에서 쓰는 역할 이름이다. 실제 권한 판단은 서버가 하며 화면은 안내에만 쓴다. */
export const roleLabels = {
  TENANT_ADMIN: '고객사 관리자',
  ANALYST: '분석 담당',
  REVIEWER: '검토 담당',
  APPROVER: '승인 담당',
} as const

/** 관리자 업무 흐름의 단계 순서다. 팬 제보 경로와 예매 관계 분석 경로가 조사 사건에서 합류한다. */
export const workflowSteps = [
  { key: 'report', label: '팬 제보 접수' },
  { key: 'extract', label: terms.listingAnalysis },
  { key: 'compare', label: terms.candidateMatch },
  { key: 'case', label: terms.case },
  { key: 'approval', label: '승인 검토' },
  { key: 'pdf', label: '보고서 발급' },
] as const
