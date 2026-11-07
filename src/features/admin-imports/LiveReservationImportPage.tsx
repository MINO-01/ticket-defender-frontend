import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { Input, Select, Textarea } from '../../components/common/FormControls'
import { PageHeader } from '../../components/common/PageHeader'
import { AdminPagePlaceholder } from '../../pages/admin/AdminPagePlaceholder'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { MutationStatus } from '../admin-cases/MutationStatus'
import { useCaseMutation } from '../admin-cases/useCaseMutation'
import type { SettledAttempt } from '../admin-cases/useCaseMutation'
import { AdminEventGate } from '../admin-events/AdminEventGate'
import type { AdminEvent } from '../admin-events/adminEventsApi'
import { usePerformanceList } from '../admin-track2/PerformancePanels'
import type { VerifiedPerformance } from '../admin-track2/candidatePipelineApi'
import { verifiedPerformanceRoute } from '../admin-track2/candidatePipelineApi'
import { StatusPill } from '../admin-track2/StatusPill'
import { formatUtc } from '../admin-track2/track2Api'
import trackStyles from '../admin-track2/Track2.module.css'
import {
  buildImportRequest, importErrorCodeLabels, importMessages, importResultSchema, importStatusLabels, isSyntheticImportUiEnabled,
  matchesImport, maxImportRows, maxRowsTextLength, reservationImportPath, summarizeImport,
} from './reservationImportApi'
import type { ImportFormErrors, ImportRequestBody, ImportResult, SentImport } from './reservationImportApi'
import styles from './ReservationImport.module.css'

// 합성 격리(SYNTHETIC_ISOLATED) 예매 스냅샷 반입 테스트 화면이다. 실제 고객사 예매 반입 기능이 아니다.
// 화면 설정(VITE_SYNTHETIC_RESERVATION_IMPORT_UI)이 꺼져 있으면 입력 화면과 API 호출을 모두 열지 않는다. 켜져 있어도 서버 게이트가 최종 판단한다.
// 예매 행 입력은 비제어 입력창의 DOM 값으로만 두고 React 상태, 주소, 브라우저 저장소, 콘솔에 넣지 않는다. 제출할 때 한 번만 해석하고 검증한다.
// 서버가 배치를 확정(201 ACCEPTED 또는 REJECTED)하면 민감 입력을 지운다. 결과가 불확실하면 같은 요청 키와 같은 본문을 메모리에만 보존하고 입력을 잠근다.

const notice = '이 화면은 합성 격리 환경(A3 SYNTHETIC_ISOLATED)의 테스트 전용입니다. 실제 고객사 예매 데이터 반입 기능이 아니며, 실제 예매번호나 개인정보를 입력하지 마세요.'

/** 개발 전용 미리보기 세션에서는 실제 API를 부르지 않고 안내만 표시한다. */
export function ReservationImportRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview'
    ? <AdminPagePlaceholder title="데이터 반입" description="합성 예매 스냅샷 반입은 인증된 관리자 세션에서만 실제 API로 제공합니다." />
    : <LiveReservationImportPage />
}

export function LiveReservationImportPage() {
  const enabled = isSyntheticImportUiEnabled()
  return <div className={trackStyles.page}>
    <PageHeader eyebrow="Track 2 합성 격리 테스트" title="데이터 반입" description="검증된 회차에 합성 예매 스냅샷을 반입합니다. 반입한 스냅샷은 예매 후보 대조의 기준 자료이며 부정 거래 판정이 아닙니다." />
    <p className={styles.testOnly} role="note"><strong>테스트 전용</strong> {notice}</p>
    {enabled
      ? <AdminEventGate>{(event) => <EventImport key={event.id} event={event} />}</AdminEventGate>
      : <EmptyState title="이 환경에서는 합성 예매 반입 화면이 꺼져 있습니다" description="합성 격리 시험 환경에서 화면 설정을 명시적으로 켠 경우에만 입력 화면을 엽니다. 화면 설정은 서버의 반입 차단 게이트를 대체하지 않으며, 운영 환경의 실제 예매 반입은 제공하지 않습니다." />}
    <p className={trackStyles.notice}>Backend에 반입 배치 이력 조회 API가 없어 새로고침하거나 화면을 떠나면 이전 반입 결과를 다시 볼 수 없습니다. 필요하면 결과의 배치 ID를 따로 기록해 주세요.</p>
  </div>
}

function EventImport({ event }: { event: AdminEvent }) {
  const list = usePerformanceList(event.id)
  if (list.loading) return <LoadingSkeleton label="검증 회차를 불러오는 중" />
  if (list.performances === null) {
    const message = list.failure?.kind === 'forbidden'
      ? { title: '검증 회차를 조회할 역할이 없습니다', description: '검증 회차 목록은 검토 담당(REVIEWER) 또는 고객사 관리자(TENANT_ADMIN)만 조회할 수 있고, 반입은 고객사 관리자만 할 수 있습니다.' }
      : describeAdminApiFailure(list.failure!, '공연을 찾을 수 없거나 접근 범위 밖입니다')
    return <ErrorState title={message.title} description={message.description} onRetry={list.retry} />
  }
  return <ImportForm eventId={event.id} eventName={event.name} performances={list.performances} onRejected={list.refresh} />
}

function ImportForm({ eventId, eventName, performances, onRejected }: { eventId: string; eventName: string; performances: VerifiedPerformance[]; onRejected: () => void }) {
  const mutation = useCaseMutation<ImportRequestBody, ImportResult>({ method: 'POST', schema: importResultSchema, successStatus: 201, messages: importMessages })
  const [performanceId, setPerformanceId] = useState('')
  const [sourceVersion, setSourceVersion] = useState('')
  const [completeSnapshot, setCompleteSnapshot] = useState<boolean | null>(null)
  const [errors, setErrors] = useState<ImportFormErrors | null>(null)
  const rowsRef = useRef<HTMLTextAreaElement>(null)
  // 응답 확인에 쓰는 요청 요약이다. 원문 예매번호는 담지 않는다.
  const sentRef = useRef<SentImport | null>(null)

  // 화면을 떠날 때 입력창에 남은 예매 행을 지운다. 대기 중 요청과 불확실한 시도는 useCaseMutation이 정리한다.
  useEffect(() => {
    const node = rowsRef.current
    return () => { if (node) node.value = '' }
  }, [])

  const active = performances.filter((performance) => performance.status === 'ACTIVE')
  const withdrawnCount = performances.length - active.length
  const selected = active.find((performance) => performance.performanceId === performanceId)
  const attempt = mutation.attempt
  const sending = attempt?.kind === 'sending'
  const locked = sending || attempt?.kind === 'uncertain'

  const settle = (settled: SettledAttempt<ImportResult> | null) => {
    if (settled === null) return
    if (settled.kind === 'succeeded') {
      // 서버가 배치를 확정했으므로 민감 입력을 지운다. 회차 선택은 다음 반입을 위해 남긴다.
      if (rowsRef.current) rowsRef.current.value = ''
      setSourceVersion('')
      setCompleteSnapshot(null)
      sentRef.current = null
    } else if (settled.kind === 'rejected') {
      sentRef.current = null
      onRejected()
    }
  }

  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault()
    if (locked) return
    const built = buildImportRequest({ performanceId: selected?.performanceId ?? '', sourceVersion, completeSnapshot, rowsText: rowsRef.current?.value ?? '' })
    if (!built.ok) {
      setErrors(built.errors)
      return
    }
    setErrors(null)
    const sent = summarizeImport(eventId, built.body)
    sentRef.current = sent
    settle(await mutation.submit(reservationImportPath(eventId), built.body, (data) => matchesImport(sent, data)))
  }

  const reconfirm = async () => {
    const sent = sentRef.current
    if (sent === null || sending) return
    settle(await mutation.reconfirm(reservationImportPath(eventId), (data) => matchesImport(sent, data)))
  }

  return <>
    <Card className={trackStyles.panel} aria-label="합성 예매 스냅샷 입력">
      <div className={trackStyles.panelHeading}><h2>합성 예매 스냅샷 입력</h2><span>{eventName}, 고객사 관리자</span></div>
      {active.length === 0
        ? <EmptyState title="반입할 수 있는 검증 회차가 없습니다" description={`현재 검증된(ACTIVE) 회차가 없습니다.${withdrawnCount > 0 ? ` 철회된 회차 ${withdrawnCount}개는 선택할 수 없습니다.` : ''} 검증 회차 관리에서 회차를 먼저 등록해 주세요.`} />
        : <form className={styles.form} onSubmit={submit} noValidate>
          <Select label="검증 회차 (ACTIVE만 선택)" value={selected?.performanceId ?? ''} onChange={(changeEvent) => setPerformanceId(changeEvent.target.value)} disabled={locked} error={errors?.performanceId} required>
            <option value="">회차를 선택해 주세요</option>
            {active.map((performance) => <option key={performance.performanceId} value={performance.performanceId}>{performance.performanceRef} (revision {performance.revision})</option>)}
          </Select>
          {withdrawnCount > 0 && <p className={trackStyles.subtleNote}>철회된 회차 {withdrawnCount}개는 반입 대상에서 제외했습니다.</p>}
          <Input label="sourceVersion (합성 스냅샷 버전)" value={sourceVersion} onChange={(changeEvent) => setSourceVersion(changeEvent.target.value)} maxLength={256} autoComplete="off" spellCheck={false} disabled={locked} error={errors?.sourceVersion} required />
          <fieldset className={styles.choice} disabled={locked} aria-invalid={errors?.completeSnapshot ? true : undefined}>
            <legend>완전한 스냅샷 여부 (completeSnapshot) *</legend>
            <label><input type="radio" name="completeSnapshot" checked={completeSnapshot === true} onChange={() => setCompleteSnapshot(true)} /> 완전한 스냅샷입니다 (true)</label>
            <label><input type="radio" name="completeSnapshot" checked={completeSnapshot === false} onChange={() => setCompleteSnapshot(false)} /> 완전하지 않습니다 (false, 서버가 배치 전체를 REJECTED로 기록)</label>
            {errors?.completeSnapshot && <p className={styles.fieldError}>{errors.completeSnapshot}</p>}
          </fieldset>
          <div className={styles.rows}><Textarea ref={rowsRef} label={`합성 예매 행 (1~${maxImportRows}개)`} aria-describedby="reservation-rows-format" maxLength={maxRowsTextLength} readOnly={locked}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-gramm="false" error={errors?.rows} required /></div>
          <p id="reservation-rows-format" className={trackStyles.subtleNote}>한 줄에 한 행씩 <code>합성 예매번호,구역,열,좌석</code> 순서로 입력합니다. 쉼표 또는 탭으로 구분하고 빈 줄은 건너뜁니다. 각 값은 앞뒤 공백을 뺀 1~128자이며 값 안에 쉼표나 탭은 넣을 수 없습니다. 입력은 이 화면 메모리에만 있고 저장되지 않습니다.</p>
          {errors?.rowLines && <ul className={styles.lineErrors} aria-label="행 형식 오류">{errors.rowLines.map((line) => <li key={line}>{line}</li>)}</ul>}
          <div className={styles.actions}>
            <Button type="submit" loading={sending} disabled={locked}>합성 스냅샷 반입</Button>
            {attempt?.kind === 'uncertain' && <Button type="button" variant="secondary" loading={sending} onClick={reconfirm}>같은 요청 재확인</Button>}
          </div>
        </form>}
      {attempt?.kind === 'uncertain' && <p className={trackStyles.caution}>결과를 확인하기 전에는 입력이 잠기고 새 요청 키로 보낼 수 없습니다. 같은 요청 재확인만 같은 요청 키와 같은 내용을 다시 보냅니다. 화면을 떠나면 이 재확인도 할 수 없습니다.</p>}
      <MutationStatus attempt={attempt} successText={null} />
      <p className={trackStyles.subtleNote}>회차 등록과 철회는 <Link to={verifiedPerformanceRoute(eventId)}>검증 회차 관리</Link>에서 합니다.</p>
    </Card>
    {attempt?.kind === 'succeeded' && <ImportResultView result={attempt.data} />}
  </>
}

function ImportResultView({ result }: { result: ImportResult }) {
  const accepted = result.status === 'ACCEPTED'
  return <Card className={trackStyles.panel} aria-label="반입 결과">
    <div className={trackStyles.panelHeading}><h2>반입 결과</h2><StatusPill label={importStatusLabels[result.status]} tone={accepted ? 'success' : 'warning'} /></div>
    <p className={trackStyles.subtleNote}>{accepted
      ? '서버가 배치를 ACCEPTED로 기록했습니다. 후보 대조 적용 여부는 팬 제보 상세의 후보 실행 이력에서 서버 기준으로 확인합니다.'
      : '서버가 배치를 REJECTED로 기록했고 후보 행은 저장하지 않았습니다. 입력을 고쳐 새 sourceVersion으로 다시 반입해 주세요.'}</p>
    <dl className={trackStyles.factList}>
      <div><dt>배치 ID</dt><dd>{result.batchId}</dd></div>
      <div><dt>검증 회차 ID</dt><dd>{result.performanceId}</dd></div>
      <div><dt>sourceVersion</dt><dd>{result.sourceVersion}</dd></div>
      <div><dt>완전한 스냅샷</dt><dd>{result.completeSnapshot ? '예 (true)' : '아니요 (false)'}</dd></div>
      <div><dt>입력 행 / 수락 행 / 거부 건수</dt><dd>{result.inputRowCount} / {result.acceptedRowCount} / {result.rejectedRowCount}</dd></div>
      <div><dt>처리 시각</dt><dd>{formatUtc(result.completedAt)}</dd></div>
    </dl>
    {result.errors.length > 0 && <table className={styles.errorTable}>
      <caption>서버가 기록한 오류 {result.errors.length}건</caption>
      <thead><tr><th scope="col">rowIndex</th><th scope="col">코드</th><th scope="col">설명</th></tr></thead>
      <tbody>{result.errors.map((error, index) => <tr key={`${error.rowIndex}-${error.code}-${index}`}>
        <td>{error.rowIndex}</td><td><code>{error.code}</code></td><td>{importErrorCodeLabels[error.code] ?? '계약 문서에 설명이 없는 코드입니다. 서버 코드를 그대로 표시합니다.'}</td>
      </tr>)}</tbody>
    </table>}
  </Card>
}
