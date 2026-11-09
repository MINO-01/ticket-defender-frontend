import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { approvalRequestStatuses } from '../admin-approvals/approvalApi'
import { offsetDateTime, uuid } from '../admin-cases/caseApi'

// Backend main a4be847 AdminConsoleController의 조회 계약이다. 서버에 저장된 행만 담는다.
// /admin/me의 역할은 화면 안내용이다. 권한은 서버가 요청마다 판단한다.

const count = z.number().int().nonnegative()

export const adminMeSchema = z.object({ tenantId: uuid, roles: z.array(z.string().min(1)), eventIds: z.array(uuid) })

const pageOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), page: z.number().int().nonnegative(), pageSize: z.number().int().min(1).max(100), hasNext: z.boolean() })

const approvalItemSchema = z.object({
  approvalRequestId: uuid,
  caseId: uuid,
  reportVersionId: uuid,
  reportRevision: z.number().int().positive(),
  evidenceRevision: z.number().int().nonnegative(),
  status: z.enum(approvalRequestStatuses),
  requestedAt: offsetDateTime,
})
export const approvalQueueSchema = pageOf(approvalItemSchema)

const auditItemSchema = z.object({
  auditEventId: uuid,
  caseId: uuid,
  approvalRequestId: uuid.nullable(),
  actorMembershipId: uuid,
  eventType: z.string().min(1),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  occurredAt: offsetDateTime,
})
export const eventAuditSchema = pageOf(auditItemSchema)

export const workflowSummarySchema = z.object({
  eventId: uuid,
  casesByStatus: z.record(z.string(), count),
  approvalRequestsByStatus: z.record(z.string(), count),
  track1QuantityRunsByStatus: z.record(z.string(), count),
  coverage: z.string().min(1),
})
export type WorkflowSummary = z.infer<typeof workflowSummarySchema>

export const consolePageSize = 20
export const adminMePath = '/api/v1/admin/me'
export const workflowSummaryPath = (eventId: string) => `/api/v1/admin/events/${eventId}/workflow-summary`
export function approvalQueuePath(eventId: string, status: string, page: number) {
  return adminApiPath(`/api/v1/admin/events/${eventId}/approval-requests`, { ...(status ? { status } : {}), page, pageSize: consolePageSize })
}
export const eventAuditPath = (eventId: string, page: number) => adminApiPath(`/api/v1/admin/events/${eventId}/approval-audit-events`, { page, pageSize: consolePageSize })
