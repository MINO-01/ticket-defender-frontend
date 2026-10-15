export const statusLabels = {
  job: {
    QUEUED: { label: '대기 중', tone: 'neutral' },
    RUNNING: { label: '분석 중', tone: 'info' },
    RETRY_WAIT: { label: '재시도 대기', tone: 'warning' },
    COMPLETED: { label: '완료', tone: 'success' },
    FAILED: { label: '실패', tone: 'critical' },
    CANCELLED: { label: '취소됨', tone: 'neutral' },
  },
  case: {
    OPEN: { label: '접수', tone: 'info' },
    TRIAGED: { label: '분류 완료', tone: 'info' },
    IN_REVIEW: { label: '검토 중', tone: 'warning' },
    NEEDS_EVIDENCE: { label: '추가 자료 필요', tone: 'warning' },
    READY_FOR_APPROVAL: { label: '승인 검토 대기', tone: 'info' },
    APPROVED_FOR_REPORT: { label: '보고서 작성 가능', tone: 'success' },
    DISMISSED: { label: '종결 검토', tone: 'neutral' },
    CLOSED: { label: '종료', tone: 'neutral' },
  },
  report: {
    DRAFT: { label: '초안', tone: 'neutral' },
    PENDING_APPROVAL: { label: '승인 대기', tone: 'warning' },
    APPROVED: { label: '승인됨', tone: 'success' },
    REJECTED: { label: '반려됨', tone: 'critical' },
    RENDERING: { label: '문서 생성 중', tone: 'info' },
    GENERATED: { label: '생성 완료', tone: 'success' },
    GENERATION_FAILED: { label: '생성 실패', tone: 'critical' },
    SUPERSEDED: { label: '이전 버전', tone: 'neutral' },
  },
} as const

export type StatusBadgeProps =
  | { domain: 'job'; status: keyof typeof statusLabels.job }
  | { domain: 'case'; status: keyof typeof statusLabels.case }
  | { domain: 'report'; status: keyof typeof statusLabels.report }
