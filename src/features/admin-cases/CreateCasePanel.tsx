import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input, Textarea } from '../../components/common/FormControls'
import { caseDetailRoute, caseTypeLabels, caseViewSchema } from './caseApi'
import type { CaseView } from './caseApi'
import { buildCreateCaseRequest, caseCreatePath, caseTypeFor, createCaseMessages, isCreatedCase } from './caseWorkflowApi'
import type { CreateCaseBody, CreateCaseInput, GraphClusterSource } from './caseWorkflowApi'
import { MutationStatus } from './MutationStatus'
import styles from './Cases.module.css'
import { useCaseMutation } from './useCaseMutation'

// Track 1 군집 상세와 Track 2 제보 상세에서 관리자가 명시적으로 Case를 만드는 영역이다. 자동 생성은 하지 않는다.
// 출처 ID와 공연은 현재 화면이 서버에서 받은 값만 사용하고, 출처 존재와 범위, 보존, 원본 상태는 서버가 다시 확인한다.
// 성공 응답의 Case ID와 공연, 유형을 확인한 뒤에만 실제 Case 상세로 이동한다.

export type CreateCaseSources = Omit<CreateCaseInput, 'reason'>

type Props = {
  /** 화면 문맥 설명. 예: Track 1 군집 */
  context: string
  sources: CreateCaseSources
  /** 서버 규칙상 연결할 수 없는 출처라 요청 자체를 막아야 할 때의 사유 */
  blockedReason?: string | null
  /** 출처 선택 같은 화면별 추가 입력 */
  children?: ReactNode
  /** 사용자가 고칠 수 있는 출처 선택 문제. 사유 입력은 막지 않고 생성 버튼만 막는다. */
  sourceIssue?: string | null
  /** 요청 중이거나 결과 미확인 상태가 바뀔 때 알린다. 패널 밖의 출처 선택을 같은 기간 동안 잠그는 데 쓴다. */
  onBusyChange?: (busy: boolean) => void
}

export function CreateCasePanel({ context, sources, blockedReason = null, children, sourceIssue = null, onBusyChange }: Props) {
  const navigate = useNavigate()
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { attempt, submit, reconfirm } = useCaseMutation<CreateCaseBody, CaseView>({ method: 'POST', schema: caseViewSchema, successStatus: 201, messages: createCaseMessages })
  const sending = attempt?.kind === 'sending'
  const uncertain = attempt?.kind === 'uncertain'
  const type = caseTypeFor(sources)
  // 결과를 확인하지 못한 요청의 본문이다. 재확인 응답도 이 본문 기준으로 검증한다.
  const sentBody = useRef<CreateCaseBody | null>(null)
  const busy = sending || uncertain
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])

  const finish = (next: Awaited<ReturnType<typeof submit>>) => {
    if (next?.kind === 'succeeded') navigate(caseDetailRoute(next.data.caseId, next.data.eventId))
  }

  const onSubmit = () => {
    if (blockedReason !== null || sourceIssue !== null) return
    const built = buildCreateCaseRequest({ ...sources, reason })
    if (!built.ok) { setErrors(built.errors); return }
    setErrors({})
    const body = built.body
    sentBody.current = body
    void submit(caseCreatePath, body, (view) => isCreatedCase(view, body)).then(finish)
  }

  const onReconfirm = () => {
    const body = sentBody.current
    if (body === null) return
    void reconfirm(caseCreatePath, (view) => isCreatedCase(view, body)).then(finish)
  }

  return <Card className={styles.panel} aria-label="Case 생성">
    <div className={styles.panelHeading}><h2>Case 생성</h2>{type && <span>유형: {caseTypeLabels[type]}</span>}</div>
    <p className={styles.caution}>조사 대상 출처: {context}. Case 생성은 조사 시작 기록이며 부정 거래 판정이나 티켓 제재가 아닙니다. 생성은 분석 담당 또는 검토 담당 역할만 가능하고 서버가 역할과 출처를 다시 확인합니다.</p>
    {blockedReason !== null && <p className={styles.blocked} role="note">{blockedReason}</p>}
    {/* 요청 중이거나 결과를 확인하지 못한 동안에는 출처 선택을 바꾸지 못하게 해 재확인 본문과 화면이 어긋나지 않게 한다. */}
    {children && <fieldset className={styles.plainFieldset} disabled={sending || uncertain}>{children}</fieldset>}
    <Textarea label="생성 사유" required value={reason} maxLength={2000} rows={3} disabled={sending || uncertain || blockedReason !== null}
      onChange={(change) => setReason(change.target.value)} error={errors.reason} placeholder="조사가 필요한 이유를 3자 이상 입력해 주세요" />
    {errors.sources && <p className={styles.fieldError} role="alert">{errors.sources}</p>}
    {sourceIssue !== null && !uncertain && <p className={styles.fieldError}>{sourceIssue}</p>}
    <div className={styles.formActions}>
      {uncertain
        ? <Button onClick={onReconfirm} loading={sending}>같은 요청 재확인</Button>
        : <Button onClick={onSubmit} loading={sending} disabled={blockedReason !== null || sourceIssue !== null}>{sending ? 'Case 생성 요청 중' : 'Case 생성'}</Button>}
    </div>
    <MutationStatus attempt={attempt} successText={null} />
  </Card>
}

/** Track 2 화면에서 선택적으로 함께 연결하는 Track 1 군집 입력이다. 값이 모두 비어 있으면 연결하지 않는다. */
export function OptionalClusterFields({ value, onChange, disabled }: { value: GraphClusterSource; onChange: (next: GraphClusterSource) => void; disabled?: boolean }) {
  return <fieldset className={styles.fieldset} disabled={disabled}>
    <legend>Track 1 군집 함께 연결 (선택, 복합 검토)</legend>
    <p className={styles.caution}>군집 상세의 분석 요청 ID와 군집 ID를 그대로 입력하면 복합 검토 Case로 만듭니다. 같은 공연의 저장된 군집인지 서버가 확인합니다.</p>
    <Input label="분석 요청 ID" value={value.analysisRequestId} onChange={(change) => onChange({ ...value, analysisRequestId: change.target.value.trim() })} />
    <Input label="군집 ID" value={value.clusterId} maxLength={191} onChange={(change) => onChange({ ...value, clusterId: change.target.value })} />
  </fieldset>
}
