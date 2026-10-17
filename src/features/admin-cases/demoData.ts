import type { CaseDataset, CaseRecord } from './caseModel'

function activity(id: string, createdAt: string, updatedAt: string, note: string): CaseRecord['activities'] {
  return [
    { id: `${id}-CREATED`, at: createdAt, kind: 'CREATED', detail: '합성 사건을 생성했습니다.' },
    { id: `${id}-REVIEWED`, at: updatedAt, kind: 'REVIEWED', detail: note },
  ]
}

export const demoCaseData: CaseDataset = { cases: [
  {
    id: 'DEMO-CASE-001', eventId: 'DEMO-EVT-A', type: 'COMBINED', status: 'IN_REVIEW', assignee: '시연 담당 A', priority: 82,
    createdAt: '2026-10-15T16:00:00+09:00', updatedAt: '2026-10-16T09:20:00+09:00',
    summary: '같은 공연을 대상으로 한 연관 예매 군집과 팬 제보를 병렬 검토하는 합성 사건입니다.',
    linkReason: '동일 공연을 다룬 두 합성 자료를 병렬로 살펴보기 위한 임시 묶음입니다. 동일 예매·계정 관계는 확인되지 않았으며, 실제 사건 통합 근거가 아닙니다.',
    sources: [
      { kind: 'GRAPH_CLUSTER', clusterId: 'DEMO-CL-001', analysisRunId: 'DEMO-RUN-20261015-A' },
      { kind: 'FAN_REPORT', reportId: 'DEMO-REP-008' },
    ],
    facts: ['합성 군집에 결제수단·기기 참조를 공유하는 계정이 있습니다.', '합성 팬 제보에 증거 이미지 2개가 첨부되어 있습니다.'],
    clues: ['제보의 예매 대조는 일치 후보 상태입니다. 군집의 예매와 직접 연결된 사실은 아닙니다.'],
    unknowns: ['두 출처의 예매·계정이 동일한지 확인되지 않았습니다.', '공유 IP는 공용 네트워크 사용으로도 나타날 수 있습니다.'],
    activities: activity('DEMO-CASE-001', '2026-10-15T16:00:00+09:00', '2026-10-16T09:20:00+09:00', '두 출처의 직접 연결 여부를 미확인 사항으로 남겼습니다.'),
  },
  {
    id: 'DEMO-CASE-002', eventId: 'DEMO-EVT-A', type: 'GRAPH_CLUSTER', status: 'TRIAGED', assignee: '시연 담당 B', priority: 74,
    createdAt: '2026-10-15T16:10:00+09:00', updatedAt: '2026-10-15T17:00:00+09:00',
    summary: '기기와 배송지 참조가 연결된 합성 군집을 검토합니다.', linkReason: null,
    sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'DEMO-CL-002', analysisRunId: 'DEMO-RUN-20261015-A' }],
    facts: ['합성 군집에 기기·배송지 참조 신호가 있습니다.'], clues: ['신호의 관계 범위를 살펴볼 필요가 있습니다.'],
    unknowns: ['참조 일치만으로 계정 소유자가 동일한지 알 수 없습니다.'],
    activities: activity('DEMO-CASE-002', '2026-10-15T16:10:00+09:00', '2026-10-15T17:00:00+09:00', '연결 신호를 검토 대상으로 분류했습니다.'),
  },
  {
    id: 'DEMO-CASE-003', eventId: 'DEMO-EVT-A', type: 'FAN_REPORT', status: 'NEEDS_EVIDENCE', assignee: '시연 담당 A', priority: 68,
    createdAt: '2026-10-15T15:00:00+09:00', updatedAt: '2026-10-15T17:35:00+09:00',
    summary: '좌석 정보가 부족한 합성 팬 제보를 검토합니다.', linkReason: null,
    sources: [{ kind: 'FAN_REPORT', reportId: 'DEMO-REP-009' }],
    facts: ['공연·회차 정보는 확인한 자료에서 일치합니다.'], clues: ['확인한 자료 범위에서 예매 후보를 찾지 못했습니다.'],
    unknowns: ['좌석 열 정보가 없어 후보 부재를 최종 결론으로 볼 수 없습니다.'],
    activities: [...activity('DEMO-CASE-003', '2026-10-15T15:00:00+09:00', '2026-10-15T17:35:00+09:00', '좌석 열 정보의 부재를 확인했습니다.'), { id: 'DEMO-CASE-003-REQUEST', at: '2026-10-15T17:20:00+09:00', kind: 'EVIDENCE_REQUESTED', detail: '추가 자료 요청 상황을 가정한 합성 이력입니다. 실제 요청은 전송되지 않았습니다.' }],
  },
  {
    id: 'DEMO-CASE-004', eventId: 'DEMO-EVT-B', type: 'GRAPH_CLUSTER', status: 'READY_FOR_APPROVAL', assignee: '시연 담당 C', priority: 88,
    createdAt: '2026-10-15T16:30:00+09:00', updatedAt: '2026-10-16T08:30:00+09:00',
    summary: '결제수단과 배송지 참조가 연결된 합성 군집을 살펴봅니다.', linkReason: null,
    sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'DEMO-CL-003', analysisRunId: 'DEMO-RUN-20261015-A' }],
    facts: ['합성 군집에 결제수단·배송지 참조 신호가 있습니다.'], clues: ['신호가 공유되는 범위를 추가 검토할 수 있습니다.'],
    unknowns: ['실제 승인 요청이나 승인 심사는 수행되지 않았습니다.'],
    activities: activity('DEMO-CASE-004', '2026-10-15T16:30:00+09:00', '2026-10-16T08:30:00+09:00', '시연 상태를 승인 검토 대기로 표시했습니다. 실제 요청은 아닙니다.'),
  },
  {
    id: 'DEMO-CASE-005', eventId: 'DEMO-EVT-B', type: 'FAN_REPORT', status: 'OPEN', assignee: null, priority: 60,
    createdAt: '2026-10-15T15:20:00+09:00', updatedAt: '2026-10-15T15:20:00+09:00',
    summary: '합성 팬 제보의 증거와 대조 후보를 살펴봅니다.', linkReason: null,
    sources: [{ kind: 'FAN_REPORT', reportId: 'DEMO-REP-012' }],
    facts: ['합성 제보에 증거 이미지 1개가 있습니다.'], clues: ['예매 대조에 일치 후보가 표시됩니다.'],
    unknowns: ['제보 거래와 예매 후보의 실제 관계는 확인되지 않았습니다.'],
    activities: [{ id: 'DEMO-CASE-005-CREATED', at: '2026-10-15T15:20:00+09:00', kind: 'CREATED', detail: '합성 사건을 생성했습니다.' }],
  },
  {
    id: 'DEMO-CASE-006', eventId: 'DEMO-EVT-C', type: 'GRAPH_CLUSTER', status: 'IN_REVIEW', assignee: '시연 담당 B', priority: 61,
    createdAt: '2026-10-15T15:00:00+09:00', updatedAt: '2026-10-15T18:10:00+09:00',
    summary: '공유 IP 신호만 있는 합성 군집을 신중하게 검토합니다.', linkReason: null,
    sources: [{ kind: 'GRAPH_CLUSTER', clusterId: 'DEMO-CL-004', analysisRunId: 'DEMO-RUN-20261015-A' }],
    facts: ['합성 군집에서 공용 IP 참조가 일치합니다.'], clues: ['IP 정보는 추가 확인의 출발점일 뿐입니다.'],
    unknowns: ['공용 네트워크 사용 가능성이 있으며 동일인을 뜻하지 않습니다.'],
    activities: activity('DEMO-CASE-006', '2026-10-15T15:00:00+09:00', '2026-10-15T18:10:00+09:00', '공용 IP 해석의 한계를 기록했습니다.'),
  },
] }
