import { describe, expect, it } from 'vitest'
import { inspectCsv, inspectSupplierCsv, validateScope } from '../features/admin-ledger-imports/ledgerImportApi'
import { buildSupplierRegistrationRequest, scopeKey } from '../features/admin-investigation/investigationWizardApi'

describe('대용량 원장 CSV 사전 검사', () => {
  const streamedFile = (csv: string, cuts: number[] = [31]) => {
    const file = new File([csv], 'synthetic.csv', { type: 'text/csv' }); const bytes = new TextEncoder().encode(csv)
    Object.defineProperty(file, 'stream', { value: () => new ReadableStream<Uint8Array>({ start(controller) { let start = 0; for (const end of cuts) { controller.enqueue(bytes.slice(start, end)); start = end } controller.enqueue(bytes.slice(start)); controller.close() } }) })
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

  it('1바이트 청크, 이스케이프 따옴표와 UTF-8 경계도 같은 레코드와 digest로 처리한다', async () => {
    const event = '11111111-1111-4111-8111-111111111111'; const performance = '22222222-2222-4222-8222-222222222222'
    const csv = `event_id,performance_id,note\r\n${event},${performance},"한글, ""인용""\n줄"\r\n`
    const bytes = new TextEncoder().encode(csv); const value = await inspectCsv(streamedFile(csv, [...bytes.keys()].map((index) => index + 1)))
    expect(value.rows).toBe(1); expect(value.scopeRows.get(`${event}:${performance}`)).toBe(1)
    const expected = await crypto.subtle.digest('SHA-256', bytes)
    expect(value.sha256).toBe([...new Uint8Array(expected)].map((item) => item.toString(16).padStart(2, '0')).join(''))
  })

  it('잘못된 따옴표, 중복 헤더와 열 개수 불일치를 Backend 전 단계에서 거부한다', async () => {
    const event = '11111111-1111-4111-8111-111111111111'; const performance = '22222222-2222-4222-8222-222222222222'
    await expect(inspectCsv(streamedFile(`event_id,event_id,performance_id\n${event},x,${performance}\n`))).rejects.toThrow('중복')
    await expect(inspectCsv(streamedFile(`event_id,performance_id,note\n${event},${performance},"ok"bad\n`))).rejects.toThrow('닫는')
    await expect(inspectCsv(streamedFile(`event_id,performance_id,note\n${event},${performance}\n`))).rejects.toThrow('열 수')
  })

  it('mode별 서버 scope checkpoint 요구사항을 등록 전에 막는다', () => {
    expect(validateScope('FULL_SNAPSHOT', { performanceId: '22222222-2222-4222-8222-222222222222', declaredRowCount: '2', scopeAsOf: '', cursorStart: '', cursorEnd: '', sequenceStart: '', sequenceEnd: '' })).toContain('FULL_SNAPSHOT')
    expect(validateScope('CHANGE_FEED', { performanceId: '22222222-2222-4222-8222-222222222222', declaredRowCount: '2', scopeAsOf: '', cursorStart: 'a', cursorEnd: 'b', sequenceStart: '0', sequenceEnd: '1' })).toBeNull()
    expect(validateScope('CHANGE_FEED', { performanceId: '22222222-2222-4222-8222-222222222222', declaredRowCount: '3', scopeAsOf: '', cursorStart: 'a', cursorEnd: 'b', sequenceStart: '0', sequenceEnd: '1' })).toContain('정확히')
  })

  it('SUPPLIER_CODE CSV에서 메타데이터와 파일 해시만 반환하고 실제 예매 참조 열은 반환하지 않는다', async () => {
    const csv = [
      'source_event_code,source_performance_code,event_title,performance_starts_at,per_account_limit,reservation_reference',
      'EV-1,PF-1,합성 공연,2026-12-01T19:00:00+09:00,4,SYNTHETIC-RESERVATION-1',
      'EV-1,PF-1,합성 공연,2026-12-01T19:00:00+09:00,4,SYNTHETIC-RESERVATION-2',
    ].join('\n') + '\n'
    const bytes = new TextEncoder().encode(csv)
    const value = await inspectSupplierCsv(streamedFile(csv, [...bytes.keys()].map((index) => index + 1)))
    const expected = await crypto.subtle.digest('SHA-256', bytes)
    expect(value).toMatchObject({
      bytes: bytes.byteLength,
      rows: 2,
      scopes: [{ sourceEventCode: 'EV-1', sourcePerformanceCode: 'PF-1', eventTitle: '합성 공연', performanceStartsAt: '2026-12-01T19:00:00+09:00', perAccountLimit: 4, declaredRowCount: 2 }],
    })
    expect(value.sha256).toBe([...new Uint8Array(expected)].map((item) => item.toString(16).padStart(2, '0')).join(''))
    expect(JSON.stringify(value)).not.toContain('SYNTHETIC-RESERVATION')
  })

  it('SUPPLIER_CODE 등록에 TD UUID, 상충한 범위 메타데이터, 추정 checkpoint를 허용하지 않는다', async () => {
    const uuidCsv = 'event_id,source_event_code,source_performance_code,event_title,performance_starts_at\nevt,EV-1,PF-1,합성 공연,2026-12-01T19:00:00+09:00\n'
    await expect(inspectSupplierCsv(streamedFile(uuidCsv))).rejects.toThrow('TD UUID')
    const inconsistent = [
      'source_event_code,source_performance_code,event_title,performance_starts_at',
      'EV-1,PF-1,합성 공연,2026-12-01T19:00:00+09:00',
      'EV-1,PF-1,다른 제목,2026-12-01T19:00:00+09:00',
    ].join('\n')
    await expect(inspectSupplierCsv(streamedFile(inconsistent))).rejects.toThrow('제목이 서로 다릅니다')

    const csv = 'source_event_code,source_performance_code,event_title,performance_starts_at\nEV-1,PF-1,합성 공연,2026-12-01T19:00:00+09:00\n'
    const metadata = await inspectSupplierCsv(streamedFile(csv))
    const key = scopeKey('EV-1', 'PF-1')
    const base = { metadata, sourceSystem: 'synthetic-source', sourceBatchId: 'synthetic-batch', scopeAsOf: '2026-11-30T23:00:00+09:00' }
    expect(buildSupplierRegistrationRequest({ ...base, checkpoints: {} }).ok).toBe(false)
    const built = buildSupplierRegistrationRequest({ ...base, checkpoints: { [key]: { cursorEnd: 'source-cursor-17', sourceSequenceEnd: '17' } } })
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.body).toMatchObject({ schemaVersion: 'v3', scopeKeyType: 'SUPPLIER_CODE', mode: 'FULL_SNAPSHOT', completeSnapshot: true })
      expect(built.body.supplierScopes[0]).toMatchObject({ cursorStart: null, cursorEnd: 'source-cursor-17', sourceSequenceStart: null, sourceSequenceEnd: 17 })
    }
  })
})
