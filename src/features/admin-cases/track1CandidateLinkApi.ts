import { z } from 'zod'
import { ledgerSeatSchema } from '../admin-track1/track1Api'
import { isUuid } from '../fan-report/intakeConfig'

// Backend track1-candidate-evidence-link-v1 계약이다. 이미 생성된 Case에 연결된 출처만 현재 시점으로 비교하는 읽기 전용 조회다.
// 예매참조, HMAC, 계정 식별자는 응답에 없고 이 스키마는 계약 밖 필드를 버린다.

const uuid = z.string().refine(isUuid)

export const evidenceLinkStatuses = ['LINKED', 'NO_TRACK1_LINK', 'NOT_APPLICABLE', 'LEDGER_UNAVAILABLE'] as const
export type EvidenceLinkStatus = (typeof evidenceLinkStatuses)[number]

const linkedLedgerSeatSchema = ledgerSeatSchema.extend({ auditId: z.number().int() })

const evidenceLinkSchema = z.object({
  graphSourceId: uuid,
  candidateSourceId: uuid,
  candidateRunId: uuid,
  status: z.enum(evidenceLinkStatuses),
  ledgerSeats: z.array(linkedLedgerSeatSchema),
  // Backend #79에서 필수가 된 연결 근거다. 이전 서버 응답에는 없다.
  linkBasis: z.literal('RESERVATION_REFERENCE').optional(),
})

export const evidenceLinkViewSchema = z.object({
  status: z.enum(evidenceLinkStatuses),
  items: z.array(evidenceLinkSchema),
})

export type EvidenceLink = z.infer<typeof evidenceLinkSchema>

export function track1CandidateLinksPath(caseId: string) {
  return `/api/v1/cases/${caseId}/track1-candidate-links`
}

export const evidenceLinkMessages: Record<EvidenceLinkStatus, string> = {
  LINKED: '팬 제보의 예매 후보와 Track 1에 저장된 예매 기록이 연결됩니다.',
  NO_TRACK1_LINK: '현재 연결된 Track 1 출처에는 동일한 예매 기록이 없습니다.',
  NOT_APPLICABLE: '현재 사건의 출처 조합에는 연결 비교를 적용할 수 없습니다.',
  LEDGER_UNAVAILABLE: '현재 원장 또는 비교 근거를 확인할 수 없습니다.',
}

export function evidenceLinkTone(status: EvidenceLinkStatus) {
  if (status === 'LINKED') return 'info' as const
  return status === 'LEDGER_UNAVAILABLE' ? 'warning' as const : 'neutral' as const
}
