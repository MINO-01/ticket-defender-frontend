import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import type { SupplierCsvMetadata } from '../admin-ledger-imports/ledgerImportApi'
import { isUuid } from '../fan-report/intakeConfig'

const uuid = z.string().refine(isUuid).transform((value) => value.toLowerCase())
const candidateId = z.string().regex(/^multi-[a-f0-9]{64}$/)
const supplierScopeRequestSchema = z.object({
  sourceEventCode: z.string().trim().min(1).max(128),
  sourcePerformanceCode: z.string().trim().min(1).max(128),
  eventTitle: z.string().trim().min(1).max(255),
  performanceStartsAt: z.string().datetime({ offset: true }),
  perAccountLimit: z.number().int().positive().nullable(),
  scopeAsOf: z.string().datetime({ offset: true }),
  declaredRowCount: z.number().int().nonnegative().safe(),
  cursorStart: z.null(),
  cursorEnd: z.string().trim().min(1).max(256),
  sourceSequenceStart: z.null(),
  sourceSequenceEnd: z.number().int().nonnegative().safe(),
})

export const supplierRegistrationRequestSchema = z.object({
  schemaVersion: z.literal('v3'),
  sourceSystem: z.string().trim().min(1).max(64),
  sourceBatchId: z.string().trim().min(1).max(128),
  mode: z.literal('FULL_SNAPSHOT'),
  format: z.literal('CSV'),
  declaredObjectSha256: z.string().regex(/^[a-f0-9]{64}$/),
  declaredFileBytes: z.number().int().nonnegative().safe(),
  declaredRowCount: z.number().int().nonnegative().safe(),
  completeSnapshot: z.literal(true),
  scopeKeyType: z.literal('SUPPLIER_CODE'),
  scopes: z.undefined().optional(),
  supplierScopes: z.array(supplierScopeRequestSchema).min(1),
}).strict()
export type SupplierRegistrationRequest = z.infer<typeof supplierRegistrationRequestSchema>

export type SupplierScopeCheckpoints = Readonly<Record<string, { cursorEnd: string; sourceSequenceEnd: string }>>

/** Builds only a complete v3 supplier-code snapshot. Source cursor values are never guessed from row counts or filenames. */
export function buildSupplierRegistrationRequest(input: {
  metadata: SupplierCsvMetadata
  sourceSystem: string
  sourceBatchId: string
  scopeAsOf: string
  checkpoints: SupplierScopeCheckpoints
}): { ok: true; body: SupplierRegistrationRequest } | { ok: false; message: string } {
  const scopeAsOf = input.scopeAsOf.trim()
  if (!z.string().datetime({ offset: true }).safeParse(scopeAsOf).success) return { ok: false, message: '데이터 기준시각은 시간대를 포함한 ISO 8601 형식이어야 합니다.' }
  const supplierScopes: unknown[] = []
  for (const scope of input.metadata.scopes) {
    const checkpoint = input.checkpoints[scopeKey(scope.sourceEventCode, scope.sourcePerformanceCode)]
    if (!checkpoint?.cursorEnd.trim() || checkpoint.cursorEnd.trim().length > 256) return { ok: false, message: '각 회차의 원본 cursorEnd를 1~256자로 입력해 주세요.' }
    if (!/^(0|[1-9]\d*)$/.test(checkpoint.sourceSequenceEnd) || !Number.isSafeInteger(Number(checkpoint.sourceSequenceEnd))) return { ok: false, message: '각 회차의 sourceSequenceEnd를 0 이상의 정수로 입력해 주세요.' }
    supplierScopes.push({
      sourceEventCode: scope.sourceEventCode,
      sourcePerformanceCode: scope.sourcePerformanceCode,
      eventTitle: scope.eventTitle,
      performanceStartsAt: scope.performanceStartsAt,
      perAccountLimit: scope.perAccountLimit,
      scopeAsOf,
      declaredRowCount: scope.declaredRowCount,
      cursorStart: null,
      cursorEnd: checkpoint.cursorEnd.trim(),
      sourceSequenceStart: null,
      sourceSequenceEnd: Number(checkpoint.sourceSequenceEnd),
    })
  }
  const parsed = supplierRegistrationRequestSchema.safeParse({
    schemaVersion: 'v3',
    sourceSystem: input.sourceSystem,
    sourceBatchId: input.sourceBatchId,
    mode: 'FULL_SNAPSHOT',
    format: 'CSV',
    declaredObjectSha256: input.metadata.sha256,
    declaredFileBytes: input.metadata.bytes,
    declaredRowCount: input.metadata.rows,
    completeSnapshot: true,
    scopeKeyType: 'SUPPLIER_CODE',
    supplierScopes,
  })
  return parsed.success ? { ok: true, body: parsed.data } : { ok: false, message: '필수 정보가 없거나 등록 값이 계약 범위를 벗어났습니다.' }
}

export function scopeKey(sourceEventCode: string, sourcePerformanceCode: string) {
  return JSON.stringify([sourceEventCode, sourcePerformanceCode])
}

function targetBasePath(eventId: string, runId: string, id: string) {
  if (!isUuid(eventId) || !isUuid(runId) || !candidateId.safeParse(id).success) return null
  return `/api/v1/admin/events/${eventId.toLowerCase()}/multi-event/${runId.toLowerCase()}/candidates/${id}/targets`
}

export function investigationTargetsPath(eventId: string, runId: string, id: string, page = 0) {
  const base = targetBasePath(eventId, runId, id)
  return base === null || page < 0 || !Number.isSafeInteger(page) ? null : adminApiPath(base, { page, pageSize: 50 })
}

export function investigationRevealPath(eventId: string, runId: string, id: string, page = 0) {
  const base = targetBasePath(eventId, runId, id)
  return base === null || page < 0 || !Number.isSafeInteger(page) ? null : adminApiPath(`${base}/reveal`, { page, pageSize: 50 })
}

export function investigationExportPath(eventId: string, runId: string, id: string) {
  const base = targetBasePath(eventId, runId, id)
  return base === null ? null : `${base}/export`
}

const targetItemSchema = z.object({
  targetId: uuid,
  accountReference: z.string().max(256).nullable(),
  reservationReference: z.string().max(256).nullable(),
  ticketReference: z.string().max(256).nullable(),
  performanceId: uuid,
  purchasedAt: z.string().max(64).nullable(),
  ticketStatus: z.string().max(32).nullable(),
  seatZone: z.string().max(64).nullable(),
  seatRow: z.string().max(64).nullable(),
  seatNumber: z.string().max(64).nullable(),
  reasons: z.array(z.string().min(1).max(128)),
  reservedAt: z.string().max(64).nullable(),
})

export const investigationTargetPageSchema = z.object({
  items: z.array(targetItemSchema),
  page: z.number().int().nonnegative().safe(),
  pageSize: z.number().int().min(1).max(100).safe(),
  total: z.number().int().nonnegative().safe(),
  hasNext: z.boolean(),
})

export type InvestigationTarget = z.infer<typeof targetItemSchema>
export type InvestigationTargetPage = z.infer<typeof investigationTargetPageSchema>
