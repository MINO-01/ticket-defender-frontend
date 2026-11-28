import { beforeEach, describe, expect, it } from 'vitest'
import {
  emptyInvestigationWizardSnapshot,
  investigationStorageNamespace,
  readInvestigationWizardSnapshot,
  writeInvestigationWizardSnapshot,
} from '../features/admin-investigation/investigationWizardState'

const eventId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const candidateId = `multi-${'a'.repeat(64)}`
const namespace = 'a'.repeat(64)

function fakeCrypto(): Crypto {
  return {
    subtle: {
      digest: async (_algorithm: AlgorithmIdentifier, input: BufferSource) => {
        const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        const text = new TextDecoder().decode(bytes)
        const output = new Uint8Array(32)
        for (let index = 0; index < text.length; index += 1) output[index % output.length] = (output[index % output.length] + text.charCodeAt(index) + index) % 256
        return output.buffer
      },
    },
  } as unknown as Crypto
}

function identityToken(subject: string, tenant: string) {
  const payload = btoa(JSON.stringify({ iss: 'https://synthetic-identity.invalid', sub: subject, tenant_id: tenant }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `e30.${payload}.c2ln`
}

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

    writeInvestigationWizardSnapshot(snapshot, namespace)

    const key = `td.admin-investigation.v1.${namespace}`
    const encoded = sessionStorage.getItem(key)
    expect(encoded).not.toBeNull()
    expect(encoded).not.toContain('SYNTHETIC-ACCOUNT-REAL')
    expect(encoded).not.toContain('SYNTHETIC-RESERVATION-REAL')
    expect(encoded).not.toContain('SYNTHETIC-TICKET-REAL')
    expect(readInvestigationWizardSnapshot(namespace)).toEqual(snapshot)
  })

  it('실제 조사 참조번호처럼 저장 필드에 없는 값을 발견하면 복구 상태를 폐기한다', () => {
    sessionStorage.setItem('td.admin-investigation.v1', JSON.stringify({
      ...emptyInvestigationWizardSnapshot,
      revealedTargets: [{ reservationReference: 'SYNTHETIC-RESERVATION-REAL' }],
    }))

    expect(readInvestigationWizardSnapshot(namespace)).toEqual(emptyInvestigationWizardSnapshot)
    expect(sessionStorage.getItem('td.admin-investigation.v1')).toBeNull()
  })

  it('서로 다른 관리자 또는 테넌트는 다른 저장 네임스페이스를 사용하고 원래 식별자는 키에 넣지 않는다', async () => {
    const crypto = fakeCrypto()
    const first = await investigationStorageNamespace(identityToken('admin-a', 'tenant-a'), crypto)
    const same = await investigationStorageNamespace(identityToken('admin-a', 'tenant-a'), crypto)
    const otherUser = await investigationStorageNamespace(identityToken('admin-b', 'tenant-a'), crypto)
    const otherTenant = await investigationStorageNamespace(identityToken('admin-a', 'tenant-b'), crypto)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(same).toBe(first)
    expect(otherUser).not.toBe(first)
    expect(otherTenant).not.toBe(first)
    expect(`td.admin-investigation.v1.${first}`).not.toContain('admin-a')
    expect(`td.admin-investigation.v1.${first}`).not.toContain('tenant-a')
  })
})
