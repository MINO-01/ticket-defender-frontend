import { z } from 'zod'
import { adminApiPath } from '../../api/adminApiClient'
import { isUuid } from '../fan-report/intakeConfig'

// Backend admin-events-v1 계약의 접근 가능 공연 목록이다. tenantId와 역할은 응답에 없고 요청에도 보내지 않는다.
// id만 Track 1, Track 2, Case API의 eventId로 사용하며 externalEventId는 고객사 간에 같을 수 있어 식별자로 쓰지 않는다.

export const adminEventsPageSize = 100

export const adminEventSchema = z.object({
  id: z.string().refine(isUuid).transform((value) => value.toLowerCase()),
  externalEventId: z.string(),
  name: z.string().min(1),
})

export const adminEventPageSchema = z.object({
  items: z.array(adminEventSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  totalItems: z.number().int().nonnegative(),
  hasNext: z.boolean(),
})

export type AdminEvent = z.infer<typeof adminEventSchema>

export function adminEventsPath(page: number) {
  return adminApiPath('/api/v1/admin/events', { page, pageSize: adminEventsPageSize })
}
