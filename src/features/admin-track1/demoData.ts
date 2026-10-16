export type SignalKind = 'PAYMENT' | 'DEVICE' | 'ADDRESS' | 'IP'

export type AnalysisRun = {
  id: string
  analyzedAt: string
  method: string
  version: string
}

export type DemoEvent = { id: string; name: string }
export type Account = { id: string; label: string }
export type Reservation = { id: string; accountId: string; seat: string }
export type SharedSignal = {
  id: string
  kind: SignalKind
  label: string
  accountIds: string[]
  evidence: string
  caution?: string
}

export type Cluster = {
  id: string
  eventId: string
  analysisRunId: string
  priority: number
  accounts: Account[]
  reservations: Reservation[]
  signals: SharedSignal[]
}

export type Track1Dataset = { events: DemoEvent[]; runs: AnalysisRun[]; clusters: Cluster[] }

export const signalLabels: Record<SignalKind, string> = {
  PAYMENT: '결제수단 참조',
  DEVICE: '기기 참조',
  ADDRESS: '배송지 참조',
  IP: '접속 IP',
}

type SignalSpec = {
  kind: SignalKind
  members: number[]
  evidence: string
  caution?: string
}

function demoCluster(number: number, eventId: string, analysisRunId: string, priority: number, reservationCounts: number[], signalSpecs: SignalSpec[]): Cluster {
  const id = `DEMO-CL-${String(number).padStart(3, '0')}`
  const accounts = reservationCounts.map((_, index) => ({
    id: `DEMO-ACC-${number}-${index + 1}`,
    label: `시연 계정 ${number}-${index + 1}`,
  }))
  const reservations = reservationCounts.flatMap((count, accountIndex) => Array.from({ length: count }, (_, index) => ({
    id: `DEMO-RSV-${number}-${accountIndex + 1}-${index + 1}`,
    accountId: accounts[accountIndex].id,
    seat: `${accountIndex + 1}층 ${String.fromCharCode(65 + accountIndex)}구역`,
  })))
  const signals = signalSpecs.map((spec, index) => ({
    id: `DEMO-SIG-${number}-${index + 1}`,
    kind: spec.kind,
    label: `${signalLabels[spec.kind]} 예시 ${number}-${index + 1}`,
    accountIds: spec.members.map((member) => accounts[member].id),
    evidence: spec.evidence,
    caution: spec.caution,
  }))
  return { id, eventId, analysisRunId, priority, accounts, reservations, signals }
}

export const demoTrack1Data: Track1Dataset = {
  events: [
    { id: 'DEMO-EVT-A', name: '2026 Autumn Live · 합성 공연' },
    { id: 'DEMO-EVT-B', name: 'K-POP 쇼케이스 · 합성 공연' },
    { id: 'DEMO-EVT-C', name: '가을 실내 공연 · 합성 공연' },
  ],
  runs: [
    { id: 'DEMO-RUN-20261015-A', analyzedAt: '2026-10-15T13:40:00+09:00', method: '합성 연결 예시', version: 'demo-1' },
    { id: 'DEMO-RUN-20261015-B', analyzedAt: '2026-10-15T15:10:00+09:00', method: '합성 연결 예시', version: 'demo-1' },
  ],
  clusters: [
    demoCluster(1, 'DEMO-EVT-A', 'DEMO-RUN-20261015-A', 82, [2, 2, 1, 1], [
      { kind: 'PAYMENT', members: [0, 1], evidence: '합성 입력에서 두 계정의 예매에 같은 결제수단 참조가 기록됐습니다.' },
      { kind: 'DEVICE', members: [1, 2], evidence: '합성 입력에서 두 계정의 기기 참조가 일치합니다.' },
      { kind: 'IP', members: [0, 3], evidence: '합성 입력에서 두 계정의 접속 IP 참조가 일치합니다.', caution: '공용 네트워크나 통신사 환경에서도 IP가 같을 수 있습니다.' },
    ]),
    demoCluster(2, 'DEMO-EVT-A', 'DEMO-RUN-20261015-A', 74, [2, 1, 1], [
      { kind: 'DEVICE', members: [0, 1], evidence: '합성 입력에서 두 계정의 기기 참조가 일치합니다.' },
      { kind: 'ADDRESS', members: [1, 2], evidence: '합성 입력에서 두 계정의 배송지 참조가 일치합니다.' },
    ]),
    demoCluster(3, 'DEMO-EVT-B', 'DEMO-RUN-20261015-A', 88, [2, 2, 2], [
      { kind: 'PAYMENT', members: [0, 1], evidence: '합성 입력에서 두 계정의 결제수단 참조가 일치합니다.' },
      { kind: 'ADDRESS', members: [1, 2], evidence: '합성 입력에서 두 계정의 배송지 참조가 일치합니다.' },
    ]),
    demoCluster(4, 'DEMO-EVT-C', 'DEMO-RUN-20261015-A', 61, [1, 1, 1], [
      { kind: 'IP', members: [0, 1, 2], evidence: '합성 입력에서 세 계정의 접속 IP 참조가 일치합니다.', caution: '공용 IP만으로 동일인이나 부정 거래를 판단할 수 없습니다.' },
    ]),
    demoCluster(5, 'DEMO-EVT-A', 'DEMO-RUN-20261015-B', 58, [2, 1, 1], [
      { kind: 'PAYMENT', members: [0, 1], evidence: '합성 입력에서 두 계정의 결제수단 참조가 일치합니다.' },
    ]),
    demoCluster(6, 'DEMO-EVT-B', 'DEMO-RUN-20261015-B', 79, [1, 2, 1], [
      { kind: 'DEVICE', members: [0, 1], evidence: '합성 입력에서 두 계정의 기기 참조가 일치합니다.' },
      { kind: 'IP', members: [1, 2], evidence: '합성 입력에서 두 계정의 접속 IP 참조가 일치합니다.', caution: '공유 네트워크 사용 가능성을 별도로 검토해야 합니다.' },
    ]),
    demoCluster(7, 'DEMO-EVT-C', 'DEMO-RUN-20261015-B', 67, [1, 1, 2], [
      { kind: 'ADDRESS', members: [0, 1], evidence: '합성 입력에서 두 계정의 배송지 참조가 일치합니다.' },
      { kind: 'DEVICE', members: [1, 2], evidence: '합성 입력에서 두 계정의 기기 참조가 일치합니다.' },
    ]),
  ],
}
