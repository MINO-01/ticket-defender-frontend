import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import type { OperationMessages } from '../admin-cases/caseWorkflowApi'
import { utcDateTime } from '../admin-track2/track2Api'
import { isUuid } from '../fan-report/intakeConfig'
import { sharedSignalObservationsSchema } from './SharedSignalObservationPanel'

// Backend docs/api/track1-quantity-v1(main a4be847)의 구매 수량 원장과 v2 분석 API 클라이언트다.
// POST /analysis-runs는 202로 SUCCEEDED 또는 FAILED를 돌려준다. accountToken과 reservationToken은 실행별 표시 토큰이라 실행 간 비교에 쓰지 않는다.
// 서버의 거부 응답은 그대로 표시한다. 구매시각, 수량, 상태를 화면이 만들거나 기본값으로 채우지 않는다.
// 원문 계정과 예매 참조는 요청 본문에만 담고 화면 상태, 주소, 저장소, 콘솔, 오류 문구에 남기지 않는다.

export const maxLedgerRows = 1000
const maxText = 128
export const maxLedgerTextLength = maxLedgerRows * (maxText * 11 + 16)
export const quantityPageSize = 20

const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/)
const boundedText = z.string().trim().min(1).max(maxText)
const offsetInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/).refine((value) => !Number.isNaN(Date.parse(value)))

export const ticketStatuses = ['ACTIVE', 'CANCELLED', 'REFUNDED', 'UNKNOWN'] as const
export const quantityUnits = ['TICKET', 'ORDER_LINE'] as const

const ledgerRowSchema = z.object({
  accountReference: boundedText,
  reservationReference: boundedText,
  ticketReference: boundedText,
  purchasedAt: offsetInstant,
  quantity: z.number().int().positive(),
  quantityUnit: z.enum(quantityUnits),
  ticketStatus: z.enum(ticketStatuses),
  paymentReference: boundedText.optional(),
  addressReference: boundedText.optional(),
  deviceReference: boundedText.optional(),
  ipReference: boundedText.optional(),
}).strict().refine((row) => !!(row.paymentReference || row.addressReference || row.deviceReference || row.ipReference), { path: ['relationshipSignal'] })

export const ledgerImportRequestSchema = z.object({
  performanceId: uuid,
  inputType: z.literal('INDIVIDUAL_TICKET'),
  sourceVersion: boundedText,
  sourceAsOf: offsetInstant,
  quantityBasis: boundedText,
  completeSnapshot: z.boolean(),
  rows: z.array(ledgerRowSchema).min(1).max(maxLedgerRows),
}).strict()

export type LedgerImportBody = z.infer<typeof ledgerImportRequestSchema>

export const ledgerBatchSchema = z.object({
  batchId: uuid,
  eventId: uuid,
  performanceId: uuid,
  inputType: z.string().min(1),
  sourceVersion: z.string().min(1).max(maxText),
  sourceAsOf: utcDateTime,
  ledgerVersion: z.number().int().positive(),
  quantityBasis: z.string().min(1),
  completeSnapshot: z.boolean(),
  status: z.enum(['ACCEPTED', 'REJECTED']),
  inputRowCount: z.number().int().nonnegative(),
  acceptedRowCount: z.number().int().nonnegative(),
  rejectedRowCount: z.number().int().nonnegative(),
  errors: z.array(z.object({ rowIndex: z.number().int().nonnegative().nullable(), code })),
  completedAt: utcDateTime,
})

const pageOf = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item), page: z.number().int().nonnegative(), pageSize: z.number().int().min(1).max(100), hasNext: z.boolean(),
})

export const ledgerBatchPageSchema = pageOf(ledgerBatchSchema)

export const evaluationStatuses = ['EVALUATED', 'POLICY_NOT_CONFIRMED', 'QUANTITY_DATA_INCOMPLETE', 'POLICY_TIME_NOT_APPLICABLE'] as const

const findingSchema = z.object({
  accountToken: z.string().min(1).max(128),
  effectiveTicketQuantity: z.number().int().positive(),
  maxTicketsPerAccount: z.number().int().positive(),
  policyVersion: z.string().min(1),
  reservationQuantities: z.array(z.object({ reservationToken: z.string().min(1).max(128), effectiveTicketQuantity: z.number().int().positive() })).min(1),
})

const evaluationSchema = z.object({
  status: z.enum(evaluationStatuses),
  reasonCode: code.nullable(),
  policyVersion: z.string().nullable(),
  findings: z.array(findingSchema),
}).refine((item) => item.status === 'EVALUATED' || item.findings.length === 0)

const executionStatuses = ['RUNNING', 'SUCCEEDED', 'FAILED'] as const

export const analysisRunSchema = z.object({
  runId: uuid,
  eventId: uuid,
  performanceId: uuid,
  ledgerBatchId: uuid,
  sourceVersion: z.string().min(1),
  executionStatus: z.enum(executionStatuses),
  failureCode: code.nullable(),
  retryable: z.boolean(),
  policyId: uuid.nullable(),
  policyVersion: z.string().nullable(),
  algorithmVersion: z.string().nullable(),
  analysisRequestId: z.string().nullable(),
  clusterCount: z.number().int().nonnegative().nullable(),
  clusters: z.array(z.object({ clusterId: z.string().min(1), riskScore: z.number().min(0).max(1), memberCount: z.number().int().nonnegative() })),
  nettedExcludedRowCount: z.number().int().nonnegative(),
  evaluation: evaluationSchema.nullable(),
  // Data 계약의 대량 공유 관찰이다. Backend가 아직 반환하지 않으면 없다.
  sharedSignalObservations: sharedSignalObservationsSchema.optional(),
  requestedAt: utcDateTime,
  completedAt: utcDateTime.nullable(),
})
  // 실패를 빈 결과로, 성공을 결과 없음으로 볼 수 있는 조합은 계약 위반이다.
  .refine((run) => run.executionStatus !== 'SUCCEEDED' || run.evaluation !== null)
  .refine((run) => run.executionStatus !== 'FAILED' || (run.failureCode !== null && run.evaluation === null))

export const analysisRunPageSchema = pageOf(analysisRunSchema)

export type LedgerBatch = z.infer<typeof ledgerBatchSchema>
export type QuantityAnalysisRun = z.infer<typeof analysisRunSchema>
export type RunRequestBody = { performanceId: string; ledgerBatchId: string }

const base = (eventId: string) => `/api/v1/admin/events/${eventId}/track1-quantity`
export const ledgerImportPath = (eventId: string) => `${base(eventId)}/ledger-imports`
export const ledgerImportListPath = (eventId: string) => adminApiPath(ledgerImportPath(eventId), { page: 0, pageSize: quantityPageSize })
export const analysisRunPath = (eventId: string) => `${base(eventId)}/analysis-runs`
export const analysisRunDetailPath = (eventId: string, runId: string) => `${analysisRunPath(eventId)}/${runId}`
export const analysisRunListPath = (eventId: string) => adminApiPath(analysisRunPath(eventId), { page: 0, pageSize: quantityPageSize })

export const evaluationLabels: Record<(typeof evaluationStatuses)[number], { label: string; help: string }> = {
  EVALUATED: { label: '평가 완료 (EVALUATED)', help: '확인된 정책과 완전한 수량 자료로 평가했습니다. 초과 신호가 없으면 이 정책 기준 초과가 없다는 뜻이며 정상 확정이 아닙니다.' },
  POLICY_NOT_CONFIRMED: { label: '정책 미확인 (POLICY_NOT_CONFIRMED)', help: '적용할 확인된 정책이 없어 평가하지 않았습니다. 초과 없음이 아닙니다.' },
  QUANTITY_DATA_INCOMPLETE: { label: '수량 자료 불완전 (QUANTITY_DATA_INCOMPLETE)', help: '구매시각, 상태, 출처 버전 등을 확인할 수 없어 평가하지 않았습니다. 초과 없음이 아닙니다.' },
  POLICY_TIME_NOT_APPLICABLE: { label: '정책 기간 불일치 (POLICY_TIME_NOT_APPLICABLE)', help: '구매시각이 정책 적용 기간 밖이어서 평가하지 않았습니다. 초과 없음이 아닙니다.' },
}

export const executionLabels: Record<(typeof executionStatuses)[number], string> = {
  RUNNING: '실행 중 (RUNNING)', SUCCEEDED: '완료 (SUCCEEDED)', FAILED: '실패 (FAILED)',
}

// ---------- 붙여넣기 입력 해석 ----------

const columns = ['accountReference', 'reservationReference', 'ticketReference', 'purchasedAt', 'quantity', 'quantityUnit', 'ticketStatus', 'paymentReference', 'addressReference', 'deviceReference', 'ipReference'] as const
const signalColumns = columns.slice(7)
const columnLabels: Record<(typeof columns)[number], string> = {
  accountReference: '계정 참조', reservationReference: '예매 참조', ticketReference: '티켓 또는 주문 라인 참조', purchasedAt: '구매시각', quantity: '수량', quantityUnit: '수량 단위', ticketStatus: '티켓 상태',
  paymentReference: '결제 참조', addressReference: '주소 참조', deviceReference: '기기 참조', ipReference: 'IP 참조',
}
const maxLineErrors = 20

export type LedgerFormInput = { performanceId: string; sourceVersion: string; sourceAsOf: string; quantityBasis: string; completeSnapshot: boolean | null; rowsText: string }
export type LedgerFormErrors = { performanceId?: string; sourceVersion?: string; sourceAsOf?: string; quantityBasis?: string; completeSnapshot?: string; rows?: string; rowLines?: string[] }
export type BuiltLedger = { ok: true; body: LedgerImportBody } | { ok: false; errors: LedgerFormErrors }

/** 제출할 때 한 번만 해석한다. 오류 문구에는 입력 값을 넣지 않고 줄 번호와 항목 이름만 쓴다. */
export function buildLedgerImport(input: LedgerFormInput): BuiltLedger {
  const errors: LedgerFormErrors = {}
  if (!isUuid(input.performanceId)) errors.performanceId = '검증된(ACTIVE) 회차를 선택해 주세요.'
  if (!boundedText.safeParse(input.sourceVersion).success) errors.sourceVersion = `sourceVersion을 ${maxText}자 이하로 입력해 주세요.`
  if (!offsetInstant.safeParse(input.sourceAsOf.trim()).success) errors.sourceAsOf = '시간대를 포함한 기준시각을 입력해 주세요. 예: 2026-11-08T10:00:00Z'
  if (!boundedText.safeParse(input.quantityBasis).success) errors.quantityBasis = `수량 산정 기준을 ${maxText}자 이하로 입력해 주세요.`

  if (input.completeSnapshot === null) errors.completeSnapshot = '완전한 스냅샷인지 직접 선택해 주세요.'

  const rows: unknown[] = []
  const lineErrors: string[] = []
  let errorCount = 0
  const report = (message: string) => { errorCount += 1; if (lineErrors.length < maxLineErrors) lineErrors.push(message) }
  const lines = input.rowsText.split(/\r\n|\n|\r/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().length === 0) continue
    if (rows.length >= maxLedgerRows) { errors.rows = `행은 최대 ${maxLedgerRows}개까지 보낼 수 있습니다.`; break }
    const values = line.split(line.includes('\t') ? '\t' : ',').map((value) => value.trim())
    if (values.length !== columns.length) { report(`${index + 1}번째 줄: 값이 ${columns.length}개여야 합니다.`); rows.push({}); continue }
    const row = {
      ...Object.fromEntries(columns.map((column, position) => [column, values[position]]).filter(([column, value]) => value !== '' || !signalColumns.includes(column as never))),
      quantity: /^[1-9]\d{0,8}$/.test(values[4]) ? Number(values[4]) : null,
    }
    const parsed = ledgerRowSchema.safeParse(row)
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === 'relationshipSignal')) report(`${index + 1}번째 줄: 결제, 주소, 기기, IP 참조 중 하나 이상이 필요합니다.`)
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((field): field is (typeof columns)[number] => columns.includes(field as never)))]
      if (fields.length > 0) report(`${index + 1}번째 줄: ${fields.map((field) => columnLabels[field]).join(', ')} 값을 확인해 주세요.`)
    }
    rows.push(row)
  }
  if (!errors.rows && rows.length === 0) errors.rows = '티켓 또는 주문 라인 행을 1개 이상 입력해 주세요.'
  if (errorCount > 0) { errors.rowLines = lineErrors; if (!errors.rows) errors.rows = `형식이 맞지 않는 행이 ${errorCount}개 있습니다.` }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const parsed = ledgerImportRequestSchema.safeParse({ performanceId: input.performanceId, inputType: 'INDIVIDUAL_TICKET', sourceVersion: input.sourceVersion, sourceAsOf: input.sourceAsOf.trim(), quantityBasis: input.quantityBasis, completeSnapshot: input.completeSnapshot, rows })
  return parsed.success ? { ok: true, body: parsed.data } : { ok: false, errors: { rows: '요청 형식을 만들지 못했습니다. 입력을 확인해 주세요.' } }
}

export const ledgerErrorLabels: Record<string, string> = {
  DUPLICATE_TICKET_REFERENCE: '같은 티켓 또는 주문 라인 참조가 중복되었습니다.',
  INVALID_ROW: '행의 값이 계약에 맞지 않습니다.',
  INVALID_REFERENCE: '참조 값의 형식이 올바르지 않습니다.',
  PURCHASED_AFTER_SOURCE_AS_OF: '구매시각이 데이터 기준시각보다 뒤입니다.',
  PURCHASED_AT_REQUIRED: '구매시각이 없습니다.',
  QUANTITY_BASIS_REQUIRED: '수량 산정 기준이 없습니다.',
  QUANTITY_REQUIRED: '수량이 없습니다.',
  QUANTITY_UNIT_REQUIRED: '수량 단위가 없습니다.',
  RELATIONSHIP_SIGNAL_REQUIRED: '결제, 주소, 기기, IP 참조 중 하나 이상이 필요합니다.',
  RESERVATION_ACCOUNT_CONFLICT: '한 예매가 여러 계정에 연결되었습니다.',
  SOURCE_AS_OF_IN_FUTURE: '데이터 기준시각이 미래입니다.',
  TICKET_STATUS_REQUIRED: '티켓 상태가 없습니다.',
  TICKET_UNIT_QUANTITY_MUST_BE_ONE: 'TICKET 단위의 수량은 1이어야 합니다.',
  ACCOUNT_SNAPSHOT_NOT_SUPPORTED_BY_DATA_V2: '계정 집계 스냅샷은 지원하지 않습니다.',
}

export const reasonCodeLabels: Record<string, string> = {
  NO_CONFIRMED_ACCOUNT_POLICY: '확인된 계정 한도 정책이 없습니다.',
  EVENT_SCOPE_AGGREGATION_NOT_SUPPORTED: '공연 전체 범위의 합산은 지원하지 않습니다.',
  GROSS_RULE_NOT_SUPPORTED: '취소와 환불 미반영(GROSS) 규칙은 지원하지 않습니다.',
  INCOMPLETE_SNAPSHOT: '완전한 스냅샷이 아닙니다.',
  UNKNOWN_TICKET_STATUS: '상태를 알 수 없는 티켓이 있습니다.',
}

export const failureCodeLabels: Record<string, string> = {
  ANALYZER_TIMEOUT: '분석 서버 응답 시간 초과', ANALYZER_UNREACHABLE: '분석 서버 연결 실패', ANALYZER_HTTP_5XX: '분석 서버 오류', ANALYZER_HTTP_4XX: '분석 서버가 요청을 거부',
  ANALYZER_UNAVAILABLE: '분석 서버 사용 불가', ANALYZER_CONTRACT_VIOLATION: '분석 응답 계약 위반', ANALYZER_AUTH_CONFIGURATION: '분석 서버 인증 설정 오류', ANALYSIS_FAILED: '분석 실패',
  RESULT_PERSISTENCE_FAILED: '결과 저장 실패', ANALYSIS_INTERRUPTED: '분석 중단', LEDGER_INTEGRITY_MISMATCH: '원장 무결성 불일치', NO_EFFECTIVE_TICKETS_AFTER_NETTING: '취소와 환불 제외 후 유효 티켓 없음',
}

const notApplied = '요청이 반영되지 않았습니다.'
const unavailable = { title: '이 작업에 필요한 역할이 없습니다', description: `서버가 요청을 거부했습니다. 원장 반입은 고객사 관리자, 분석 실행은 고객사 관리자와 분석 담당만 할 수 있습니다. ${notApplied}` }

export const ledgerImportMessages: OperationMessages = {
  forbidden: unavailable,
  notFound: { title: '공연이나 회차를 찾을 수 없습니다', description: `접근 범위 밖이거나 API가 없는 서버입니다. ${notApplied}` },
  codes: {
    LEDGER_IMPORT_BODY_TOO_LARGE: { title: '요청 본문이 2MiB를 넘습니다', description: `행 수를 줄여 주세요. ${notApplied}` },
    LEDGER_IMPORT_CONCURRENT_UPDATE: { title: '같은 회차의 반입이 동시에 처리되었습니다', description: `다시 시도해 주세요. ${notApplied}` },
    IDEMPOTENCY_KEY_REUSED: { title: '같은 요청 키가 다른 내용으로 사용되었습니다', description: notApplied },
    LEDGER_SOURCE_VERSION_CONFLICT: { title: '같은 sourceVersion이 다른 내용으로 이미 반입되었습니다', description: `새 sourceVersion을 사용해 주세요. ${notApplied}` },
    PERFORMANCE_WITHDRAWN: { title: '철회된 검증 회차입니다', description: notApplied },
    DEPENDENCY_UNAVAILABLE: { title: '서버 의존 서비스에 연결하지 못했습니다', description: '결과를 알 수 없습니다. 같은 요청으로 다시 확인할 수 있습니다.' },
  },
}

export const analysisRunMessages: OperationMessages = {
  forbidden: unavailable,
  notFound: { title: '원장 배치나 회차를 찾을 수 없습니다', description: `접근 범위 밖이거나 API가 없는 서버입니다. ${notApplied}` },
  codes: {
    TRACK1_V2_DISABLED: { title: '서버에서 Track 1 v2 분석이 꺼져 있습니다', description: `합성 격리 환경에서 서버 설정을 켠 뒤 사용할 수 있습니다. ${notApplied}` },
    TRACK1_QUANTITY_RUN_IN_PROGRESS: { title: '같은 원장 배치의 분석이 이미 실행 중입니다', description: `기존 실행의 상태를 확인해 주세요. ${notApplied}` },
    TRACK1_QUANTITY_RUN_CONCURRENT: { title: '동시에 생성된 실행 요청이 있습니다', description: `기존 실행의 상태를 확인해 주세요. ${notApplied}` },
    IDEMPOTENCY_KEY_REUSED: { title: '같은 요청 키가 다른 내용으로 사용되었습니다', description: notApplied },
    DEPENDENCY_UNAVAILABLE: { title: '분석 서비스에 연결하지 못했습니다', description: '결과를 알 수 없습니다. 같은 요청으로 다시 확인할 수 있습니다.' },
  },
}
