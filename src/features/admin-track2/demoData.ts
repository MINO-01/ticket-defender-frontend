import type { Observation, Track2Dataset } from './track2Model'

function visibleFields(eventName: string, performanceAt: string, section: string, row: string, seat: string): Observation[] {
  return [
    { key: 'EVENT_NAME', status: 'VISIBLE', value: eventName },
    { key: 'PERFORMANCE_AT', status: 'VISIBLE', value: performanceAt },
    { key: 'SECTION', status: 'VISIBLE', value: section },
    { key: 'ROW', status: 'VISIBLE', value: row },
    { key: 'SEAT', status: 'VISIBLE', value: seat },
  ]
}

const autumnFields = visibleFields('2026 Autumn Live', '2026-10-15 18:00', 'VIP A구역', '12열', '14번')
const showcaseFields = visibleFields('K-POP 쇼케이스', '2026-10-21 19:00', 'B구역', '5열', '8번')
const missingRowFields: Observation[] = [
  { key: 'EVENT_NAME', status: 'VISIBLE', value: '2026 Autumn Live' },
  { key: 'PERFORMANCE_AT', status: 'VISIBLE', value: '2026-10-15 18:00' },
  { key: 'SECTION', status: 'VISIBLE', value: 'B구역' },
  { key: 'ROW', status: 'ABSENT', value: null, note: '이미지에 좌석 열 표시가 없습니다.' },
  { key: 'SEAT', status: 'VISIBLE', value: '11번' },
]

export const demoTrack2Data: Track2Dataset = {
  events: [
    { id: 'DEMO-EVT-A', name: '2026 Autumn Live · 합성 공연' },
    { id: 'DEMO-EVT-B', name: 'K-POP 쇼케이스 · 합성 공연' },
  ],
  reports: [
    { id: 'DEMO-REP-008', eventId: 'DEMO-EVT-A', reportType: 'PREMIUM_RESALE', receivedAt: '2026-10-14T14:32:00+09:00', reviewStatus: 'UNDER_REVIEW', evidenceIds: ['DEMO-EV-008-1', 'DEMO-EV-008-2'], extractionId: 'DEMO-EXT-008', comparisonId: 'DEMO-CMP-008' },
    { id: 'DEMO-REP-009', eventId: 'DEMO-EVT-A', reportType: 'FAKE_TICKET', receivedAt: '2026-10-14T13:19:00+09:00', reviewStatus: 'NEW', evidenceIds: ['DEMO-EV-009-1'], extractionId: 'DEMO-EXT-009', comparisonId: 'DEMO-CMP-009' },
    { id: 'DEMO-REP-010', eventId: 'DEMO-EVT-A', reportType: 'PREMIUM_RESALE', receivedAt: '2026-10-14T11:45:00+09:00', reviewStatus: 'NEEDS_MORE', evidenceIds: ['DEMO-EV-010-1', 'DEMO-EV-010-2'], extractionId: 'DEMO-EXT-010', comparisonId: 'DEMO-CMP-010' },
    { id: 'DEMO-REP-011', eventId: 'DEMO-EVT-A', reportType: 'OTHER', receivedAt: '2026-10-14T09:12:00+09:00', reviewStatus: 'NEEDS_MORE', evidenceIds: ['DEMO-EV-011-1'], extractionId: 'DEMO-EXT-011', comparisonId: 'DEMO-CMP-011' },
    { id: 'DEMO-REP-012', eventId: 'DEMO-EVT-B', reportType: 'AUTOMATION_OFFER', receivedAt: '2026-10-13T18:06:00+09:00', reviewStatus: 'UNDER_REVIEW', evidenceIds: ['DEMO-EV-012-1'], extractionId: 'DEMO-EXT-012', comparisonId: 'DEMO-CMP-012' },
    { id: 'DEMO-REP-013', eventId: 'DEMO-EVT-B', reportType: 'OTHER', receivedAt: '2026-10-13T15:20:00+09:00', reviewStatus: 'NEW', evidenceIds: [], extractionId: 'DEMO-EXT-013', comparisonId: 'DEMO-CMP-013' },
  ],
  evidence: [
    { id: 'DEMO-EV-008-1', reportId: 'DEMO-REP-008', name: '합성 티켓 예시.svg', mediaType: 'image/svg+xml', sizeBytes: 1927, previewPath: '/demo-evidence-ticket.svg' },
    { id: 'DEMO-EV-008-2', reportId: 'DEMO-REP-008', name: '합성 게시글 예시.svg', mediaType: 'image/svg+xml', sizeBytes: 1834, previewPath: '/demo-evidence-listing.svg' },
    { id: 'DEMO-EV-009-1', reportId: 'DEMO-REP-009', name: '합성 티켓 예시.svg', mediaType: 'image/svg+xml', sizeBytes: 1927, previewPath: '/demo-evidence-ticket.svg' },
    { id: 'DEMO-EV-010-1', reportId: 'DEMO-REP-010', name: '합성 티켓 예시.svg', mediaType: 'image/svg+xml', sizeBytes: 1927, previewPath: '/demo-evidence-ticket.svg' },
    { id: 'DEMO-EV-010-2', reportId: 'DEMO-REP-010', name: '합성 게시글 예시.svg', mediaType: 'image/svg+xml', sizeBytes: 1834, previewPath: '/demo-evidence-listing.svg' },
    { id: 'DEMO-EV-011-1', reportId: 'DEMO-REP-011', name: '합성 게시글 예시.svg', mediaType: 'image/svg+xml', sizeBytes: 1834, previewPath: '/demo-evidence-listing.svg' },
    { id: 'DEMO-EV-012-1', reportId: 'DEMO-REP-012', name: '합성 티켓 예시.svg', mediaType: 'image/svg+xml', sizeBytes: 1927, previewPath: '/demo-evidence-ticket.svg' },
  ],
  extractions: [
    { id: 'DEMO-EXT-008', reportId: 'DEMO-REP-008', status: 'COMPLETED', fields: autumnFields },
    { id: 'DEMO-EXT-009', reportId: 'DEMO-REP-009', status: 'COMPLETED', fields: missingRowFields },
    { id: 'DEMO-EXT-010', reportId: 'DEMO-REP-010', status: 'COMPLETED', fields: [
      { key: 'EVENT_NAME', status: 'VISIBLE', value: '2026 Autumn Live' },
      { key: 'PERFORMANCE_AT', status: 'VISIBLE', value: '2026-10-15 18:00' },
      { key: 'SECTION', status: 'VISIBLE', value: 'VIP A구역' },
      { key: 'ROW', status: 'UNREADABLE', value: null, note: '이미지 일부가 가려져 열을 읽기 어렵습니다.' },
      { key: 'SEAT', status: 'AMBIGUOUS', value: null, note: '좌석번호가 가려져 둘 이상의 해석이 가능합니다.' },
    ] },
    { id: 'DEMO-EXT-011', reportId: 'DEMO-REP-011', status: 'FAILED', fields: [], reason: '합성 시나리오에서 이미지 내용을 읽지 못했습니다.' },
    { id: 'DEMO-EXT-012', reportId: 'DEMO-REP-012', status: 'COMPLETED', fields: showcaseFields },
    { id: 'DEMO-EXT-013', reportId: 'DEMO-REP-013', status: 'QUEUED', fields: [], reason: '첨부 이미지가 없어 추출 결과가 없습니다.' },
  ],
  comparisons: [
    { id: 'DEMO-CMP-008', reportId: 'DEMO-REP-008', status: 'MATCH_CANDIDATE', reservationId: 'DEMO-RSV-0921', reason: '합성 자료의 공연, 회차와 좌석 정보가 후보와 일치합니다.', checks: [
      { label: '공연·회차', observation: '2026 Autumn Live · 10월 15일 18:00', reference: '동일', result: 'MATCH' },
      { label: '구역·열', observation: 'VIP A구역 · 12열', reference: '동일', result: 'MATCH' },
      { label: '좌석번호', observation: '14번', reference: '동일', result: 'MATCH' },
    ], unknowns: ['후보와 게시글 작성자의 관계는 확인되지 않았습니다.'] },
    { id: 'DEMO-CMP-009', reportId: 'DEMO-REP-009', status: 'NO_MATCH', reservationId: null, reason: '확인한 합성 예매 자료 범위에서 해당 좌석의 예매 후보를 찾지 못했습니다. 공연·회차 정보는 일치합니다.', checks: [
      { label: '공연·회차', observation: '2026 Autumn Live · 10월 15일 18:00', reference: '동일', result: 'MATCH' },
      { label: '좌석 구역·번호', observation: 'B구역 11번 · 열 표시 없음', reference: '조회 범위에서 좌석 후보 미발견', result: 'UNKNOWN' },
    ], unknowns: ['자료 범위 밖 예매 여부는 확인할 수 없습니다.'] },
    { id: 'DEMO-CMP-010', reportId: 'DEMO-REP-010', status: 'UNVERIFIABLE', reservationId: null, reason: '좌석 열과 번호를 읽기 어려워 후보를 좁힐 수 없습니다.', checks: [
      { label: '공연·회차', observation: '2026 Autumn Live · 10월 15일 18:00', reference: '합성 공연 자료', result: 'MATCH' },
      { label: '좌석 열·번호', observation: '가림 또는 불명확', reference: '대조 보류', result: 'UNKNOWN' },
    ], unknowns: ['좌석 열과 번호를 다시 확인할 자료가 필요합니다.'] },
    { id: 'DEMO-CMP-011', reportId: 'DEMO-REP-011', status: 'UNVERIFIABLE', reservationId: null, reason: '추출에 실패하여 예매 정보를 대조하지 않았습니다.', checks: [], unknowns: ['이미지의 공연·좌석 정보를 확인할 수 없습니다.'] },
    { id: 'DEMO-CMP-012', reportId: 'DEMO-REP-012', status: 'MATCH_CANDIDATE', reservationId: 'DEMO-RSV-1052', reason: '합성 자료에서 같은 공연·회차와 좌석 후보가 있습니다.', checks: [
      { label: '공연·회차', observation: 'K-POP 쇼케이스 · 10월 21일 19:00', reference: '동일', result: 'MATCH' },
      { label: '좌석', observation: 'B구역 5열 8번', reference: '동일', result: 'MATCH' },
    ], unknowns: ['제보한 거래와 후보 예매의 관련성은 확인되지 않았습니다.'] },
    { id: 'DEMO-CMP-013', reportId: 'DEMO-REP-013', status: 'UNVERIFIABLE', reservationId: null, reason: '증거 이미지와 추출 결과가 없어 대조하지 않았습니다.', checks: [], unknowns: ['추가 자료가 확보되기 전에는 판단할 수 없습니다.'] },
  ],
}
