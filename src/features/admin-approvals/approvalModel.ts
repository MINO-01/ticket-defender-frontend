import type { Track1Dataset } from '../admin-track1/demoData'
import type { Track2Dataset } from '../admin-track2/track2Model'
import {
  caseEvents,
  defaultCaseFilters,
  filterCases,
  summarizeCaseEvidence,
} from '../admin-cases/caseModel'
import type { CaseDataset, CaseFilters, CaseRecord } from '../admin-cases/caseModel'

export type ApprovalFilters = Pick<CaseFilters, 'query' | 'type' | 'sort'> & {
  followUp: 'all' | 'yes' | 'no'
}

export const defaultApprovalFilters: ApprovalFilters = {
  query: '',
  type: '',
  sort: 'updated-desc',
  followUp: 'all',
}

export type ApprovalReviewCandidate = {
  item: CaseRecord
  eventName: string
  sourceCount: number
  unknownCount: number
}

export function selectApprovalCandidates(
  data: CaseDataset,
  track1: Track1Dataset,
  track2: Track2Dataset,
  filters: ApprovalFilters = defaultApprovalFilters,
): ApprovalReviewCandidate[] {
  const events = new Map(caseEvents(track1, track2).map((event) => [event.id, event.name]))
  return filterCases(data, track1, track2, {
    ...defaultCaseFilters,
    query: filters.query,
    type: filters.type,
    sort: filters.sort,
    status: 'READY_FOR_APPROVAL',
  }).filter((item) => filters.followUp === 'all' ||
    (filters.followUp === 'yes' ? item.unknowns.length > 0 : item.unknowns.length === 0))
    .map((item) => ({
      item,
      eventName: events.get(item.eventId) ?? '',
      sourceCount: summarizeCaseEvidence(item, track2).sourceCount,
      unknownCount: item.unknowns.length,
    }))
}

export type ApprovalChecklistItem = {
  id: string
  label: string
  result: string
  detail: string
  state: 'shown' | 'attention' | 'not-applicable' | 'unavailable'
}

export function approvalChecklist(item: CaseRecord): ApprovalChecklistItem[] {
  const combined = item.type === 'COMBINED'
  const unknownCount = item.unknowns.length
  return [
    {
      id: 'source-reference', label: '사건 출처 참조가 존재하는가?', result: '참조 확인',
      detail: `${item.sources.length}개 출처가 합성 데이터에서 확인됩니다.`, state: 'shown',
    },
    {
      id: 'evidence-link', label: '연결된 근거를 확인할 수 있는가?', result: '상세 연결',
      detail: '각 출처의 군집 또는 팬 제보 상세 화면으로 이동할 수 있습니다.', state: 'shown',
    },
    {
      id: 'unknowns-visible', label: '분석의 미확인 사항이 표시되어 있는가?', result: '표시됨',
      detail: `${unknownCount}개 미확인 사항을 별도 영역에 표시합니다.`, state: 'shown',
    },
    {
      id: 'cross-source', label: '출처 간 직접 연결 여부가 구분되는가?',
      result: combined ? '관계 설명 표시' : '단일 출처',
      detail: combined ? '사건의 공동 검토 사유를 표시합니다. 직접 연결이 성립했다는 뜻은 아닙니다.' : '서로 다른 트랙의 출처를 결합한 사건이 아닙니다.',
      state: combined ? 'shown' : 'not-applicable',
    },
    {
      id: 'follow-up', label: '추가 확인이 필요한 사항이 남아 있는가?',
      result: unknownCount > 0 ? '추가 확인' : '표시 항목 없음',
      detail: unknownCount > 0 ? `${unknownCount}개 미확인 사항이 남아 있습니다. 승인 가능 여부를 판정하지 않습니다.` : '합성 사건에 표시된 미확인 사항이 없습니다.',
      state: unknownCount > 0 ? 'attention' : 'not-applicable',
    },
    {
      id: 'backend-contract', label: '정식 승인 요청을 위한 Backend 계약이 존재하는가?',
      result: '미연동', detail: '승인 요청·결정 API와 승인자 권한 계약은 구현되지 않았습니다.', state: 'unavailable',
    },
  ]
}
