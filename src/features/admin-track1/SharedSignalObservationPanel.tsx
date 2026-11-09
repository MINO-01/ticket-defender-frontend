import { z } from 'zod'
import styles from './Track1.module.css'

// Data docs/api/shared-signal-observations-v1.md 계약이다. 필드와 enum은 Data Pydantic 스키마와 같아야 하며 계약 fixture로 함께 검증한다.
// Backend가 아직 이 값을 저장하거나 반환하지 않으면 미지원으로 표시하고 값을 만들지 않는다.
// 대량 공유 관찰은 Louvain 군집이 아니며 부정거래, 동일인, 조직 판단이 아니다.

export const ipNetworkTypes = ['MOBILE_CGNAT', 'RESIDENTIAL', 'CORPORATE_EDU', 'DATACENTER_PROXY', 'UNKNOWN'] as const
export const scopeTypes = ['EVENT', 'PERFORMANCE'] as const
export const signalTypes = ['IP', 'ADDRESS'] as const
export const ticketQuantityStatuses = ['VERIFIED', 'UNAVAILABLE'] as const

export const sharedSignalObservationSchema = z.strictObject({
  observationId: z.string().min(1),
  scopeType: z.enum(scopeTypes),
  scopeId: z.string().min(1),
  signalType: z.enum(signalTypes),
  distinctAccountCount: z.number().int().min(2),
  scopeAccountCount: z.number().int().min(2),
  distinctReservationCount: z.number().int().min(1),
  totalTicketQuantity: z.number().int().min(1).nullable(),
  ticketQuantityStatus: z.enum(ticketQuantityStatuses),
  corroboration: z.strictObject({ paymentSharedAccountCount: z.number().int().min(0), deviceSharedAccountCount: z.number().int().min(0) }),
  ipNetworkType: z.enum(ipNetworkTypes),
  purchaseWindowSeconds: z.number().int().min(0).nullable(),
  excludedFromLouvain: z.boolean(),
})

export const sharedSignalObservationsSchema = z.array(sharedSignalObservationSchema)
export type SharedSignalObservation = z.infer<typeof sharedSignalObservationSchema>

const networkLabels: Record<SharedSignalObservation['ipNetworkType'], string> = {
  MOBILE_CGNAT: '통신사 공용망 (MOBILE_CGNAT)',
  RESIDENTIAL: '가정망 (RESIDENTIAL)',
  CORPORATE_EDU: '기업 또는 교육기관망 (CORPORATE_EDU)',
  DATACENTER_PROXY: '데이터센터 또는 프록시 (DATACENTER_PROXY)',
  UNKNOWN: '미확인 (UNKNOWN)',
}

export function SharedSignalObservationPanel({ observations }: { observations: SharedSignalObservation[] | undefined }) {
  if (observations === undefined) return <p className={styles.muted}>대량 공유 관찰: 서버가 아직 이 값을 제공하지 않습니다(BLOCKED). 관찰이 없다는 뜻이 아닙니다.</p>
  if (observations.length === 0) return <p className={styles.muted}>대량 공유 관찰: 서버가 빈 목록을 반환했습니다.</p>
  return <section aria-label="대량 공유 관찰">
    <h3>대량 공유 관찰</h3>
    <p className={styles.warning}>Louvain 군집과 별개의 관찰입니다. 공용망, 가족, 직장 등 정상 공유일 수 있으며 부정 거래 확정이 아닙니다.</p>
    {observations.map((item) => <dl className={styles.factList} key={item.observationId} aria-label={`${item.signalType} 공유 ${item.distinctAccountCount}계정`}>
      <div><dt>공유 신호</dt><dd>{item.signalType === 'IP' ? 'IP' : '주소'}</dd></div>
      <div><dt>공유 계정</dt><dd>{item.distinctAccountCount}계정 (분석 범위 {item.scopeAccountCount}계정)</dd></div>
      <div><dt>예매 수</dt><dd>{item.distinctReservationCount}건</dd></div>
      <div><dt>예매 수량</dt><dd>{item.ticketQuantityStatus === 'VERIFIED' && item.totalTicketQuantity !== null ? `${item.totalTicketQuantity}매` : '미확인'}</dd></div>
      <div><dt>네트워크 유형</dt><dd>{networkLabels[item.ipNetworkType]}</dd></div>
      <div><dt>추가 결제 공유</dt><dd>{item.corroboration.paymentSharedAccountCount}계정</dd></div>
      <div><dt>추가 기기 공유</dt><dd>{item.corroboration.deviceSharedAccountCount}계정</dd></div>
      <div><dt>구매 시간 집중도</dt><dd>{item.purchaseWindowSeconds === null ? '미확인' : `${item.purchaseWindowSeconds}초 안에 구매`}</dd></div>
      <div><dt>Louvain 입력</dt><dd>{item.excludedFromLouvain ? '허브로 제외됨' : '포함됨'}</dd></div>
    </dl>)}
  </section>
}
