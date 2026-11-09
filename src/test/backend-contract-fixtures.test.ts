/// <reference types="node" />
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analysisRunSchema, buildLedgerImport, ledgerImportRequestSchema } from '../features/admin-track1/quantityAnalysisApi'
import { ipNetworkTypes, scopeTypes, sharedSignalObservationsSchema, signalTypes, ticketQuantityStatuses } from '../features/admin-track1/SharedSignalObservationPanel'

// Backend docs/api/fixtures/track1-quantity와 Data shared_signal_observations.contract.json의 복사본으로 실제 계약을 검증한다.
// Backend 복사 기준은 main a4be847이다. Data fixture는 실제 구현 출력이며 SHA-256으로 같은 파일임을 고정한다.

const read = (name: string) => readFileSync(resolve(process.cwd(), 'src/test/fixtures', name))
const json = (name: string) => JSON.parse(read(name).toString('utf8'))
const DATA_CONTRACT_SHA256 = 'cb3c8de3a2f362684e4a5ac5d673a812772d040d656fac003bf36d24535651d7'

describe('Backend #81 실제 fixture', () => {
  it('분석 실행 응답을 그대로 받는다', () => {
    const fixture = json('backend-81/analysis-run-response.json')
    const parsed = analysisRunSchema.safeParse(fixture)
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true)
    if (parsed.success) {
      expect(parsed.data.clusters).toEqual(fixture.clusters)
      expect(parsed.data.nettedExcludedRowCount).toBe(0)
      expect(parsed.data.evaluation?.reasonCode).toBeNull()
      expect(parsed.data.sharedSignalObservations).toBeUndefined()
    }
  })

  it('반입 요청 fixture가 요청 스키마를 통과한다', () => {
    const parsed = ledgerImportRequestSchema.safeParse(json('backend-81/ledger-import-request.json'))
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true)
  })

  it('화면의 입력 해석 결과가 Backend 요청 fixture와 같다', () => {
    const fixture = json('backend-81/ledger-import-request.json')
    const columns = ['accountReference', 'reservationReference', 'ticketReference', 'purchasedAt', 'quantity', 'quantityUnit', 'ticketStatus', 'paymentReference', 'addressReference', 'deviceReference', 'ipReference']
    const rowsText = fixture.rows.map((row: Record<string, unknown>) => columns.map((column) => row[column] ?? '').join(',')).join('\n')
    const built = buildLedgerImport({ performanceId: fixture.performanceId, sourceVersion: fixture.sourceVersion, sourceAsOf: fixture.sourceAsOf, quantityBasis: fixture.quantityBasis, completeSnapshot: fixture.completeSnapshot, rowsText })
    expect(built).toEqual({ ok: true, body: fixture })
  })

  it('없는 QUEUED 상태를 받지 않는다', () => {
    const fixture = { ...json('backend-81/analysis-run-response.json'), executionStatus: 'QUEUED', evaluation: null }
    expect(analysisRunSchema.safeParse(fixture).success).toBe(false)
  })

  it('실패 응답에 평가가 함께 오면 계약 위반이다', () => {
    const fixture = { ...json('backend-81/analysis-run-response.json'), executionStatus: 'FAILED', failureCode: 'ANALYZER_TIMEOUT' }
    expect(analysisRunSchema.safeParse(fixture).success).toBe(false)
  })
})

describe('Data 대량 공유 관찰 계약', () => {
  const name = 'shared-signal-observations.contract.json'

  it('Data 저장소의 계약 fixture와 같은 파일이다', () => {
    expect(createHash('sha256').update(read(name).toString('utf8').replace(/\r\n/g, '\n')).digest('hex')).toBe(DATA_CONTRACT_SHA256)
  })

  it('실제 구현 출력이 엄격한 스키마를 통과한다', () => {
    const parsed = sharedSignalObservationsSchema.safeParse(json(name))
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true)
  })

  it('enum이 Data와 같다', () => {
    expect([...ipNetworkTypes]).toEqual(['MOBILE_CGNAT', 'RESIDENTIAL', 'CORPORATE_EDU', 'DATACENTER_PROXY', 'UNKNOWN'])
    expect([...scopeTypes]).toEqual(['EVENT', 'PERFORMANCE'])
    expect([...signalTypes]).toEqual(['IP', 'ADDRESS'])
    expect([...ticketQuantityStatuses]).toEqual(['VERIFIED', 'UNAVAILABLE'])
  })

  it('모르는 필드와 값을 거부한다', () => {
    const [first] = json(name)
    expect(sharedSignalObservationsSchema.safeParse([{ ...first, extra: 1 }]).success).toBe(false)
    expect(sharedSignalObservationsSchema.safeParse([{ ...first, ipNetworkType: 'VPN' }]).success).toBe(false)
  })

  it('수량 미확인 회차는 값을 null로 유지한다', () => {
    const unavailable = json(name).find((item: { ticketQuantityStatus: string }) => item.ticketQuantityStatus === 'UNAVAILABLE')
    expect(unavailable.totalTicketQuantity).toBeNull()
    expect(unavailable.purchaseWindowSeconds).toBeNull()
  })
})
