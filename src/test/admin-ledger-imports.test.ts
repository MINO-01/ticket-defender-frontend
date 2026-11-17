import { describe, expect, it } from 'vitest'
import { inspectCsv, validateScope } from '../features/admin-ledger-imports/ledgerImportApi'

describe('대용량 원장 CSV 사전 검사', () => {
  it('SHA-256과 인용부호 안 줄바꿈을 포함한 CSV 레코드 수를 계산한다', async () => {
    const csv = 'ticket,name\n1,"first\nsecond"\n2,last\n'
    const file = new File([csv], 'synthetic.csv', { type: 'text/csv' })
    const bytes = new TextEncoder().encode(csv)
    // jsdom File에는 브라우저의 stream()이 없으므로 실제 File 스트림 계약만 보완한다.
    Object.defineProperty(file, 'stream', { value: () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } }) })
    const value = await inspectCsv(file)
    expect(value.bytes).toBe(new TextEncoder().encode(csv).byteLength)
    expect(value.sha256).toBe('c9ec843a003c0c24c5db37d32c57994c29c9e4724977220f9067bb6c5223d49a')
    expect(value.rows).toBe(3)
  })

  it('mode별 서버 scope checkpoint 요구사항을 등록 전에 막는다', () => {
    expect(validateScope('FULL_SNAPSHOT', { performanceId: '22222222-2222-4222-8222-222222222222', scopeAsOf: '', cursorStart: '', cursorEnd: '', sequenceStart: '', sequenceEnd: '' })).toContain('FULL_SNAPSHOT')
    expect(validateScope('CHANGE_FEED', { performanceId: '22222222-2222-4222-8222-222222222222', scopeAsOf: '', cursorStart: 'a', cursorEnd: 'b', sequenceStart: '0', sequenceEnd: '1' })).toBeNull()
  })
})
