import { z } from 'zod'
import type { OperationMessages, WorkflowMessage } from '../admin-cases/caseWorkflowApi'
import { utcDateTime } from '../admin-track2/track2Api'
import { isUuid } from '../fan-report/intakeConfig'

// Backend track2-candidate-pipeline-v1의 합성 격리 예매 스냅샷 반입(importSyntheticReservationSnapshot) 계약이다.
// 기준은 Backend main 2027c15의 ReservationImportController, CandidatePipelineDto.ImportReservations, ImportResult다.
// 역할은 TENANT_ADMIN만 허용되고, 서버 게이트(SYNTHETIC_ISOLATED 모드, 격리 ID, 격리 DB, 등록된 synthetic tenant, HMAC 키)가 모두 확인될 때만 동작한다.
// 화면 설정은 화면 표시 여부만 정하며 서버 게이트를 대체하지 않는다. 실제 고객사 예매 반입이나 보존기간 승인이 아니다.
// 원문 예매번호(reservationReference)는 요청 본문에만 담고 화면 상태, 주소, 브라우저 저장소, 콘솔, 오류 문구에 남기지 않는다. 응답에도 포함되지 않는다.
// 배치 이력 조회 GET API는 Backend에 없으므로 이 화면은 방금 보낸 요청의 응답만 표시한다.

export const maxImportRows = 1000
const maxText = 128
/** 행 하나는 최대 4개 값과 구분자, 줄바꿈이다. 상한을 넘는 붙여넣기는 입력창에서 잘라 메모리 사용을 제한한다. */
export const maxRowsTextLength = maxImportRows * (maxText * 4 + 8)

const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
/** 서버 bounded, seat 규칙과 같다. 앞뒤 공백을 뺀 값이 1~128자여야 한다. */
const boundedText = z.string().trim().min(1).max(maxText)

const reservationRowSchema = z.object({
  reservationReference: boundedText,
  zone: boundedText,
  row: boundedText,
  seat: boundedText,
  // Backend #79 다좌석 계약의 선택 값이다. 같은 예매의 여러 좌석 행을 구분한다. 서버에서 HMAC 처리된다.
  ticketReference: boundedText.optional(),
}).strict()

/** 요청 본문 스키마다. 계약의 additionalProperties: false에 맞춰 정의하지 않은 필드는 보내지 않는다. */
export const importRequestSchema = z.object({
  performanceId: uuid,
  sourceVersion: boundedText,
  completeSnapshot: z.boolean(),
  rows: z.array(reservationRowSchema).min(1).max(maxImportRows),
}).strict()

export type ImportRequestBody = z.infer<typeof importRequestSchema>

export const importStatuses = ['ACCEPTED', 'REJECTED'] as const

export const importResultSchema = z.object({
  batchId: uuid,
  eventId: uuid,
  performanceId: uuid,
  sourceVersion: z.string().min(1).max(maxText),
  status: z.enum(importStatuses),
  completeSnapshot: z.boolean(),
  inputRowCount: z.number().int().min(0).max(maxImportRows),
  acceptedRowCount: z.number().int().min(0).max(maxImportRows),
  rejectedRowCount: z.number().int().min(0).max(maxImportRows + 1),
  // 불완전 스냅샷 사유(INCOMPLETE_SOURCE)가 행 오류와 함께 올 수 있어 행 수보다 1개 많을 수 있다.
  errors: z.array(z.object({ rowIndex: z.number().int().min(0), code: z.string().min(1).max(128) })).max(maxImportRows + 1),
  completedAt: utcDateTime,
})

export type ImportResult = z.infer<typeof importResultSchema>

export function reservationImportPath(eventId: string) {
  return `/api/v1/admin/events/${eventId}/reservation-imports`
}

// ---------- 화면 설정 ----------

export type ReservationImportEnv = Readonly<Record<string, unknown>>

/** A3 합성 격리 환경에서 명시적으로 true로 켠 경우에만 입력 화면을 연다. 서버 게이트 통과 여부는 이 값으로 추정하지 않는다. */
export function isSyntheticImportUiEnabled(env: ReservationImportEnv = import.meta.env) {
  return typeof env.VITE_SYNTHETIC_RESERVATION_IMPORT_UI === 'string' && env.VITE_SYNTHETIC_RESERVATION_IMPORT_UI.trim() === 'true'
}

// ---------- 입력 해석과 사전 검증 ----------

export type ImportFormInput = { performanceId: string; sourceVersion: string; completeSnapshot: boolean | null; rowsText: string }
export type ImportFormErrors = { performanceId?: string; sourceVersion?: string; completeSnapshot?: string; rows?: string; rowLines?: string[] }
export type BuiltImport = { ok: true; body: ImportRequestBody } | { ok: false; errors: ImportFormErrors }

const rowFields = ['reservationReference', 'zone', 'row', 'seat', 'ticketReference'] as const
const requiredRowFields = 4
const rowFieldLabels: Record<(typeof rowFields)[number], string> = { reservationReference: '합성 예매번호', zone: '구역', row: '열', seat: '좌석', ticketReference: '티켓 참조' }
/** 행 오류 안내는 앞부분만 보여 준다. 오류 문구에는 입력 값을 넣지 않고 줄 번호와 항목 이름만 쓴다. */
const maxLineErrors = 20

/**
 * 붙여넣은 행 문자열을 계약의 rows 배열로 바꾸고 Zod로 한 번만 검증한다. 제출할 때만 호출해 입력 중 전체 행을 반복 검증하지 않는다.
 * 한 줄이 한 행이며 값은 탭 또는 쉼표로 구분한다. 빈 줄은 건너뛴다. 값 안에 쉼표나 탭은 넣을 수 없다.
 */
export function buildImportRequest(input: ImportFormInput): BuiltImport {
  const errors: ImportFormErrors = {}
  if (!isUuid(input.performanceId)) errors.performanceId = '검증된(ACTIVE) 회차를 선택해 주세요.'
  const sourceVersion = boundedText.safeParse(input.sourceVersion)
  if (!sourceVersion.success) errors.sourceVersion = input.sourceVersion.trim().length === 0 ? 'sourceVersion을 입력해 주세요.' : `앞뒤 공백을 뺀 sourceVersion은 ${maxText}자 이하여야 합니다.`
  if (input.completeSnapshot === null) errors.completeSnapshot = '완전한 스냅샷인지 직접 선택해 주세요.'

  const lines = input.rowsText.split(/\r\n|\n|\r/)
  const rows: Record<string, string>[] = []
  const lineErrors: string[] = []
  let lineErrorCount = 0
  const addLineError = (message: string) => {
    lineErrorCount += 1
    if (lineErrors.length < maxLineErrors) lineErrors.push(message)
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().length === 0) continue
    if (rows.length >= maxImportRows) {
      errors.rows = `예매 행은 최대 ${maxImportRows}개까지 보낼 수 있습니다. 빈 줄을 뺀 행 수를 줄여 주세요.`
      break
    }
    const values = line.split(line.includes('\t') ? '\t' : ',')
    if (values.length !== requiredRowFields && values.length !== rowFields.length) {
      addLineError(`${index + 1}번째 줄: 값이 ${requiredRowFields}개(합성 예매번호, 구역, 열, 좌석) 또는 티켓 참조를 더한 ${rowFields.length}개여야 합니다.`)
      rows.push({})
      continue
    }
    const row = Object.fromEntries(rowFields.slice(0, values.length).map((field, position) => [field, values[position]]))
    const parsed = reservationRowSchema.safeParse(row)
    if (!parsed.success) {
      // Zod 오류에는 입력 값이 들어갈 수 있어 경로의 항목 이름만 읽어 고정 문구로 바꾼다.
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((field): field is (typeof rowFields)[number] => rowFields.includes(field as never)))]
      addLineError(`${index + 1}번째 줄: ${fields.map((field) => rowFieldLabels[field]).join(', ')} 값은 앞뒤 공백을 뺀 1~${maxText}자여야 합니다.`)
    }
    rows.push(row)
  }
  if (!errors.rows && rows.length === 0) errors.rows = '합성 예매 행을 1개 이상 입력해 주세요.'
  if (lineErrorCount > 0) {
    errors.rowLines = lineErrors
    if (!errors.rows) errors.rows = `형식이 맞지 않는 행이 ${lineErrorCount}개 있습니다.${lineErrorCount > maxLineErrors ? ` 앞의 ${maxLineErrors}개만 표시합니다.` : ''}`
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const parsed = importRequestSchema.safeParse({ performanceId: input.performanceId, sourceVersion: input.sourceVersion, completeSnapshot: input.completeSnapshot, rows })
  if (!parsed.success) return { ok: false, errors: { rows: '요청 형식을 만들지 못했습니다. 입력을 확인해 주세요.' } }
  return { ok: true, body: parsed.data }
}

/** 응답 확인에 쓸 요청 요약이다. 원문 예매번호는 담지 않는다. */
export type SentImport = { eventId: string; performanceId: string; sourceVersion: string; completeSnapshot: boolean; rowCount: number }

export function summarizeImport(eventId: string, body: ImportRequestBody): SentImport {
  return { eventId, performanceId: body.performanceId, sourceVersion: body.sourceVersion, completeSnapshot: body.completeSnapshot, rowCount: body.rows.length }
}

/** 201 응답이 보낸 요청과 같은 공연, 회차, 원본 버전, 행 수인지와 ACCEPTED/REJECTED 건수가 서로 맞는지 확인한다. 맞지 않으면 결과를 표시하지 않는다. */
export function matchesImport(sent: SentImport, result: ImportResult) {
  if (result.eventId !== sent.eventId || result.performanceId !== sent.performanceId || result.sourceVersion !== sent.sourceVersion) return false
  if (result.completeSnapshot !== sent.completeSnapshot || result.inputRowCount !== sent.rowCount) return false
  if (result.errors.some((error) => error.rowIndex >= result.inputRowCount)) return false
  if (result.status === 'ACCEPTED') return result.completeSnapshot && result.errors.length === 0 && result.rejectedRowCount === 0 && result.acceptedRowCount === result.inputRowCount
  return result.errors.length > 0 && result.acceptedRowCount === 0 && result.rejectedRowCount === result.errors.length
}

// ---------- 결과와 오류 안내 ----------

export const importStatusLabels: Record<ImportResult['status'], string> = {
  ACCEPTED: '반입 수락 (ACCEPTED)',
  REJECTED: '반입 거부 (REJECTED)',
}

export const importErrorCodeLabels: Record<string, string> = {
  INCOMPLETE_SOURCE: '완전한 스냅샷(completeSnapshot=true)이 아니어서 배치 전체를 거부했습니다. 특정 행의 오류가 아닙니다.',
  INVALID_ROW: '행이 비어 있습니다.',
  INVALID_RESERVATION_ROW: '예매번호, 구역, 열, 좌석 중 값이 비었거나 128자를 넘습니다.',
  DUPLICATE_RESERVATION_REFERENCE: '같은 배치 안에 같은 예매번호가 이미 있습니다.',
}

const notApplied = '요청이 반영되지 않았고 배치도 기록되지 않았습니다.'
const gate = (code: string, reason: string): WorkflowMessage => ({
  title: '서버의 합성 반입 안전 게이트가 요청을 차단했습니다',
  description: `${reason} (${code}) ${notApplied} 화면에서는 게이트를 켜거나 우회할 수 없습니다.`,
})

export const importMessages: OperationMessages = {
  forbidden: { title: '합성 예매 반입에 필요한 역할이 없습니다', description: `합성 예매 스냅샷 반입은 고객사 관리자(TENANT_ADMIN)만 할 수 있어 서버가 거부했습니다. ${notApplied}` },
  notFound: { title: '공연이나 검증 회차를 찾을 수 없거나 접근 범위 밖입니다', description: `존재하지 않거나 현재 계정의 접근 범위 밖입니다. 두 경우는 구분해 안내하지 않습니다. ${notApplied}` },
  codes: {
    RESERVATION_IMPORT_DISABLED: gate('RESERVATION_IMPORT_DISABLED', '서버 설정에서 합성 예매 반입이 꺼져 있습니다. 기본 차단 상태입니다.'),
    RESERVATION_IMPORT_OPERATION_NOT_APPROVED: gate('RESERVATION_IMPORT_OPERATION_NOT_APPROVED', '서버 운영 모드가 SYNTHETIC_ISOLATED가 아닙니다.'),
    RESERVATION_IMPORT_ISOLATION_UNVERIFIED: gate('RESERVATION_IMPORT_ISOLATION_UNVERIFIED', '서버가 격리 ID나 격리 데이터베이스를 확인하지 못했습니다.'),
    RESERVATION_IMPORT_SYNTHETIC_SCOPE_UNVERIFIED: gate('RESERVATION_IMPORT_SYNTHETIC_SCOPE_UNVERIFIED', '현재 고객사가 서버에 등록된 합성 고객사로 확인되지 않았습니다.'),
    RESERVATION_IMPORT_CONCURRENT_UPDATE: { title: '같은 회차의 반입이 동시에 처리되었습니다', description: `서버가 배치 전체를 되돌렸습니다. (RESERVATION_IMPORT_CONCURRENT_UPDATE) ${notApplied} 입력은 화면에 남아 있으니 잠시 뒤 다시 반입할 수 있습니다.` },
    RESERVATION_SOURCE_VERSION_CONFLICT: { title: '같은 sourceVersion이 다른 내용으로 이미 반입되었습니다', description: `같은 회차에 같은 sourceVersion으로 기록된 배치가 있고 내용이 다릅니다. (RESERVATION_SOURCE_VERSION_CONFLICT) 새 sourceVersion을 사용해 주세요. ${notApplied}` },
    PERFORMANCE_WITHDRAWN: { title: '철회된 검증 회차에는 반입할 수 없습니다', description: `현재 검증된(ACTIVE) 회차만 선택할 수 있습니다. 회차 목록을 다시 불러와 주세요. (PERFORMANCE_WITHDRAWN) ${notApplied}` },
    VALIDATION_FAILED: { title: '서버가 입력 값을 거부했습니다', description: `행 수와 입력 길이를 확인해 주세요. (VALIDATION_FAILED) ${notApplied}` },
    INVALID_REQUEST: { title: '요청 형식이 올바르지 않습니다', description: `행 수(1~${maxImportRows})와 필수 항목을 확인해 주세요. (INVALID_REQUEST) ${notApplied}` },
    DEPENDENCY_UNAVAILABLE: { title: '서버 의존 서비스에 연결하지 못했습니다', description: '(DEPENDENCY_UNAVAILABLE) 서버에서 처리되었을 수 있습니다. 같은 요청 재확인은 같은 요청 키와 같은 내용을 다시 보내며, 이미 기록된 배치면 서버가 그 결과를 돌려줍니다.' },
  },
}
