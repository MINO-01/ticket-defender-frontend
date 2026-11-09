import { z } from 'zod'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import styles from './Operations.module.css'

// Backend Issue #79(eed2106, main 미병합)의 구매 한도 정책 조회 계약이다. 이 API가 없는 서버에서는 404를 그대로 안내한다.
// 등록과 수정, 철회는 #79 완료 전이라 연결하지 않는다. 정책의 의미 값은 #79에서 변경될 수 있어 모르는 코드는 그대로 표시한다.
// 정책이 없을 때 기본 한도를 표시하거나 추정하지 않는다.

const policySchema = z.object({
  policyId: z.string().min(1),
  performanceId: z.string().min(1),
  maxTicketsPerAccount: z.number().int().positive(),
  policyVersion: z.string().min(1),
  effectiveFrom: z.string().min(1),
  effectiveUntil: z.string().nullable(),
  status: z.string().min(1),
  limitSubject: z.string().nullish(),
  applicationScope: z.string().nullish(),
  salesPhaseRef: z.string().nullish(),
  cancellationRefundRule: z.string().nullish(),
  includesPresale: z.boolean().nullish(),
  revision: z.number().int().positive(),
})

const policyListSchema = z.array(policySchema)

function policyListPath(eventId: string) {
  return `/api/v1/admin/events/${encodeURIComponent(eventId)}/purchase-limit-policies`
}

const codeLabels: Record<string, string> = {
  ACTIVE: '적용 중', WITHDRAWN: '철회됨', ACCOUNT: '계정별', PERSON: '동일인별', EVENT: '공연 전체', PERFORMANCE: '회차', SALES_PHASE: '판매 단계',
  NETTED: '취소와 환불 반영', GROSS: '취소와 환불 미반영',
}

function describe(value: string | null | undefined) {
  if (value === null || value === undefined) return '미지정'
  return codeLabels[value] ? `${codeLabels[value]} (${value})` : `알 수 없는 서버 값 (${value})`
}

function presaleText(value: boolean | null | undefined) {
  if (value === null || value === undefined) return '미지정'
  return value ? '포함' : '제외'
}

export function PurchaseLimitPolicyPanel({ eventId }: { eventId: string }) {
  const { result, retry } = useAdminQuery(policyListPath(eventId), policyListSchema)
  let content
  if (result === null) content = <LoadingSkeleton label="구매 한도 정책을 불러오는 중" />
  else if (result.kind !== 'success') {
    const message = result.kind === 'forbidden'
      ? { title: '구매 한도 정책을 조회하지 못했습니다', description: '고객사 관리자(TENANT_ADMIN) 역할이 없거나, 이 서버에 구매 한도 정책 API가 아직 배포되지 않아 서버가 거부했습니다.' }
      : describeAdminApiFailure(result, '이 서버에 구매 한도 정책 API가 아직 없거나 공연이 접근 범위 밖입니다')
    content = <ErrorState title={message.title} description={message.description} onRetry={retry} />
  } else if (result.data.length === 0) {
    content = <EmptyState title="등록된 구매 한도 정책이 없습니다" description="정책이 없으면 한도 평가는 정책 미확인으로 남으며 기본 한도를 적용하지 않습니다." />
  } else {
    content = result.data.map((policy) => <dl className={styles.facts} key={policy.policyId} aria-label={`정책 ${policy.policyVersion}`}>
      <div><dt>정책 버전 (개정)</dt><dd>{policy.policyVersion} ({policy.revision})</dd></div>
      <div><dt>상태</dt><dd>{describe(policy.status)}</dd></div>
      <div><dt>회차 ID</dt><dd>{policy.performanceId}</dd></div>
      <div><dt>최대 수량</dt><dd>{policy.maxTicketsPerAccount}매</dd></div>
      <div><dt>한도 주체</dt><dd>{describe(policy.limitSubject)}</dd></div>
      <div><dt>적용 범위</dt><dd>{describe(policy.applicationScope)}{policy.salesPhaseRef ? `, ${policy.salesPhaseRef}` : ''}</dd></div>
      <div><dt>취소와 환불</dt><dd>{describe(policy.cancellationRefundRule)}</dd></div>
      <div><dt>선예매</dt><dd>{presaleText(policy.includesPresale)}</dd></div>
      <div><dt>적용 기간 (시간대 없는 서버 값)</dt><dd>{policy.effectiveFrom} ~ {policy.effectiveUntil ?? '종료 없음'}</dd></div>
    </dl>)
  }
  return <Card className={styles.panel} aria-label="구매 한도 정책">
    <h2>구매 한도 정책</h2>
    <p className={styles.note}>고객사가 등록한 정책을 조회만 합니다. 한도 초과는 조사 신호이며 위반 확정이 아닙니다. 등록과 수정은 Backend 작업 완료 뒤 연결합니다.</p>
    {content}
  </Card>
}
