import { useState } from 'react'
import type { FormEvent } from 'react'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { DataTable } from '../../components/common/DataTable'
import { ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Input, Select } from '../../components/common/FormControls'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { performanceListSchema, performancesPath } from '../admin-track2/candidatePipelineApi'
import { StatusPill } from '../admin-track2/StatusPill'
import { formatLedgerSeat, ledgerSeatStatusLabels, ledgerSeatTone, track1ClusterDetailPath, track1ClusterDetailSchema } from './track1Api'
import type { LedgerSeatQuery, Track1ClusterDetail, Track1ClusterKey } from './track1Api'
import styles from './Track1.module.css'

// 군집 구성원별 원장 좌석 조회 영역이다. 관리자가 검증 회차와 원장 sourceVersion을 고른 뒤 조회할 때만 요청한다.
// 기존 군집 상세 API를 조회 조건과 함께 다시 호출하므로 Case나 후보 실행을 만들거나 바꾸지 않고 LINKED 판정도 만들지 않는다.
// 조회 실패는 이 영역에만 표시해 저장된 군집 증거 화면을 가리지 않는다.

const maxSourceVersion = 128

type Member = Track1ClusterDetail['members'][number]

export function LedgerSeatLookupPanel({ clusterKey }: { clusterKey: Track1ClusterKey }) {
  const [open, setOpen] = useState(false)
  return <Card className={styles.panel} aria-label="구성원 원장 좌석 조회">
    <h2>구성원 원장 좌석</h2>
    <p className={styles.muted}>검증 회차와 고정된 원장 버전을 골라 저장된 구성원의 좌석을 조회합니다. Case 생성 전 조사용 조회이며 Case나 후보 대조 결과를 만들지 않습니다.</p>
    {open ? <LookupForm clusterKey={clusterKey} /> : <div><Button variant="secondary" size="small" onClick={() => setOpen(true)}>원장 좌석 조회 열기</Button></div>}
  </Card>
}

function LookupForm({ clusterKey }: { clusterKey: Track1ClusterKey }) {
  const { result, retry } = useAdminQuery(performancesPath(clusterKey.eventId), performanceListSchema)
  const [performanceId, setPerformanceId] = useState('')
  const [sourceVersion, setSourceVersion] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [query, setQuery] = useState<LedgerSeatQuery | null>(null)

  if (result === null) return <LoadingSkeleton label="검증 회차를 불러오는 중" />
  if (result.kind !== 'success') {
    const message = result.kind === 'forbidden'
      ? { title: '검증 회차를 조회할 역할이 없습니다', description: '서버가 검증 회차 조회를 거부해 원장 좌석을 조회할 수 없습니다.' }
      : describeAdminApiFailure(result, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    return <ErrorState title={message.title} description={message.description} onRetry={retry} />
  }

  // 철회된 회차는 서버가 404로 거부하므로 활성 회차만 선택지로 보여 준다.
  const active = result.data.filter((item) => item.status === 'ACTIVE')
  if (active.length === 0) return <p className={styles.warning} role="note">이 공연에 활성 검증 회차가 없어 원장 좌석을 조회할 수 없습니다. 좌석이 없다는 결과가 아닙니다.</p>

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const version = sourceVersion.trim()
    if (performanceId === '' || version === '' || version.length > maxSourceVersion) {
      setFormError(`검증 회차를 선택하고 원장 버전을 ${maxSourceVersion}자 이하로 입력해 주세요.`)
      return
    }
    setFormError(null)
    setQuery({ performanceId, sourceVersion: version })
  }
  const performanceRef = active.find((item) => item.performanceId === query?.performanceId)?.performanceRef

  return <>
    <form noValidate onSubmit={submit} className={styles.panel}>
      <Select label="검증 회차" required value={performanceId} onChange={(event) => setPerformanceId(event.target.value)}>
        <option value="">회차를 선택해 주세요</option>
        {active.map((item) => <option key={item.performanceId} value={item.performanceId}>{item.performanceRef}</option>)}
      </Select>
      <Input label="원장 버전 (sourceVersion)" required value={sourceVersion} maxLength={maxSourceVersion} onChange={(event) => setSourceVersion(event.target.value)} />
      {formError && <p className={styles.warning} role="alert">{formError}</p>}
      <div><Button type="submit" size="small">원장 좌석 조회</Button></div>
    </form>
    {query && <>
      <p className={styles.muted}>조회 조건: 회차 {performanceRef ?? query.performanceId}, 원장 버전 {query.sourceVersion}</p>
      <LedgerSeatResult key={`${query.performanceId}:${query.sourceVersion}`} clusterKey={clusterKey} query={query} />
    </>}
  </>
}

const columns = [
  { key: 'auditId', header: '저장 기록 번호', render: (member: Member) => member.auditId },
  { key: 'status', header: '원장 상태', render: (member: Member) => member.ledgerSeat ? <StatusPill label={ledgerSeatStatusLabels[member.ledgerSeat.status]} tone={ledgerSeatTone(member.ledgerSeat.status)} /> : '응답에 원장 상태 없음' },
  { key: 'seat', header: '원장 좌석', render: (member: Member) => member.ledgerSeat ? formatLedgerSeat(member.ledgerSeat) : '좌석 정보 없음' },
]

function LedgerSeatResult({ clusterKey, query }: { clusterKey: Track1ClusterKey; query: LedgerSeatQuery }) {
  const { result, retry } = useAdminQuery(track1ClusterDetailPath(clusterKey, query), track1ClusterDetailSchema)
  if (result === null) return <LoadingSkeleton label="원장 좌석을 조회하는 중" />
  const mismatched = result.kind === 'success' && (result.data.event.id !== clusterKey.eventId
    || result.data.cluster.analysisRequestId !== clusterKey.analysisRequestId || result.data.cluster.clusterId !== clusterKey.clusterId)
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '회차를 찾을 수 없거나 철회되었거나 접근 범위 밖입니다')
    return <ErrorState title={message.title} description={message.description} onRetry={retry} />
  }
  return <>
    <DataTable caption="구성원별 원장 좌석" columns={columns} rows={result.data.members} getRowKey={(member) => member.auditId} />
    <p className={styles.muted}>원장에 있는 좌석이라는 뜻일 뿐 티켓 진위, 판매자 소유권, 부정 거래, 승인이나 PDF 발급의 근거가 아닙니다. 원장 확인 불가는 좌석이 없다는 결과가 아닙니다.</p>
  </>
}
