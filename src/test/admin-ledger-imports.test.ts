import { describe, expect, it } from 'vitest'
import { inspectCsv, validateScope } from '../features/admin-ledger-imports/ledgerImportApi'

describe('대용량 원장 CSV 사전 검사', () => {
  const streamedFile = (csv: string) => {
    const file = new File([csv], 'synthetic.csv', { type: 'text/csv' }); const bytes = new TextEncoder().encode(csv)
    Object.defineProperty(file, 'stream', { value: () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 31)); controller.enqueue(bytes.slice(31)); controller.close() } }) })
    return file
  }
  it('SHA-256과 인용부호 안 줄바꿈을 포함한 CSV 데이터 행 수를 헤더 없이 계산한다', async () => {
    const event = '11111111-1111-4111-8111-111111111111'; const performance = '22222222-2222-4222-8222-222222222222'
    const csv = `event_id,performance_id,ticket\r\n${event},${performance},"first\nsecond"\r\n${event},${performance},last\r\n`
    const value = await inspectCsv(streamedFile(csv))
    expect(value.bytes).toBe(new TextEncoder().encode(csv).byteLength)
    expect(value.sha256).toBe('74dbbd7f784b77e89619dd7087567a89f6f79d8be35c06e41b7bd13d994580a7')
    expect(value.rows).toBe(2)
    expect(value.scopeRows.get(`${event}:${performance}`)).toBe(2)
  })

  it('헤더만 있는 파일은 데이터 행 0개로 두고 필수 헤더가 없는 CSV는 거부한다', async () => {
    expect((await inspectCsv(streamedFile('event_id,performance_id,ticket\r\n'))).rows).toBe(0)
    await expect(inspectCsv(streamedFile('ticket,name\n1,a\n'))).rejects.toThrow('event_id')
  })

  it('mode별 서버 scope checkpoint 요구사항을 등록 전에 막는다', () => {
    expect(validateScope('FULL_SNAPSHOT', { performanceId: '22222222-2222-4222-8222-222222222222', declaredRowCount: '2', scopeAsOf: '', cursorStart: '', cursorEnd: '', sequenceStart: '', sequenceEnd: '' })).toContain('FULL_SNAPSHOT')
    expect(validateScope('CHANGE_FEED', { performanceId: '22222222-2222-4222-8222-222222222222', declaredRowCount: '2', scopeAsOf: '', cursorStart: 'a', cursorEnd: 'b', sequenceStart: '0', sequenceEnd: '1' })).toBeNull()
    expect(validateScope('CHANGE_FEED', { performanceId: '22222222-2222-4222-8222-222222222222', declaredRowCount: '3', scopeAsOf: '', cursorStart: 'a', cursorEnd: 'b', sequenceStart: '0', sequenceEnd: '1' })).toContain('정확히')
  })
})
