import { beforeEach, describe, expect, it } from 'vitest'
import {
  emptyInvestigationWizardSnapshot,
  readInvestigationWizardSnapshot,
  writeInvestigationWizardSnapshot,
} from '../features/admin-investigation/investigationWizardState'

const eventId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const candidateId = `multi-${'a'.repeat(64)}`

beforeEach(() => sessionStorage.clear())

describe('조사 흐름 복구 정보', () => {
  it('작업 ID, 범위, 후보 선택만 sessionStorage에 복구용으로 보관한다', () => {
    const snapshot = {
      ...emptyInvestigationWizardSnapshot,
      runContext: { eventId, runId },
      selection: { familyPage: 2, familyId: candidateId, candidateId },
      scopeDraft: {
        eventPage: 1, selectedEvents: [eventId], selectedPerformanceMap: { [eventId]: [runId] },
        periodStart: '2026-11-01T00:00', periodEnd: '2026-11-28T00:00',
      },
    }

    writeInvestigationWizardSnapshot(snapshot)

    const encoded = sessionStorage.getItem('td.admin-investigation.v1')
    expect(encoded).not.toBeNull()
    expect(encoded).not.toContain('SYNTHETIC-ACCOUNT-REAL')
    expect(encoded).not.toContain('SYNTHETIC-RESERVATION-REAL')
    expect(encoded).not.toContain('SYNTHETIC-TICKET-REAL')
    expect(readInvestigationWizardSnapshot()).toEqual(snapshot)
  })

  it('실제 조사 참조번호처럼 저장 필드에 없는 값을 발견하면 복구 상태를 폐기한다', () => {
    sessionStorage.setItem('td.admin-investigation.v1', JSON.stringify({
      ...emptyInvestigationWizardSnapshot,
      revealedTargets: [{ reservationReference: 'SYNTHETIC-RESERVATION-REAL' }],
    }))

    expect(readInvestigationWizardSnapshot()).toEqual(emptyInvestigationWizardSnapshot)
    expect(sessionStorage.getItem('td.admin-investigation.v1')).toBeNull()
  })
})
