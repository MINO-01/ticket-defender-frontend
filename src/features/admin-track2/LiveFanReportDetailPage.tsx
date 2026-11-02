import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { StatusPill } from './StatusPill'
import {
  analysisStatusLabels, candidateMatchReasonLabels, executionStatusLabels, fanReportDetailPath, fanReportDetailSchema, fanReportListRoute, fieldStateLabels,
  formatBytes, formatCode, formatUtc, intakeStatusLabels, intakeTone, listingAnalysesPath, listingAnalysisPageSchema, listingFieldLabels, listingFieldNames,
  readFanReportId, storageStatusLabels, unknownReasonLabels,
} from './track2Api'
import type { FanReportDetail, FanReportEvidence, ListingAnalysis, ListingField, ListingFieldName } from './track2Api'
import { reportTypeLabels } from './track2Model'
import styles from './Track2.module.css'

// 인증된 관리자의 Track 2 팬 제보 상세다. 주소의 제보 ID로 조회하며 다른 고객사나 권한 없는 공연의 제보는 서버가 404로 숨긴다.
// 팬 입력값은 검증되지 않은 문자열이므로 일반 텍스트로만 표시하고, listingUrl에 접속하거나 미리보기, 임베드를 만들지 않는다.
// 분석 이력은 상세 응답에 있는 증거 ID로만 조회한다. 원본 이미지 미리보기, 분석 실행, 예매 대조, 수동 교정은 이번 범위에서 제공하지 않는다.

const listLink = '/app/fan-reports'

export function InvalidFanReportAddress() {
  return <div className={styles.page}>
    <ErrorState title="제보 주소가 올바르지 않습니다" description="제보 ID 형식이 올바르지 않아 조회하지 않았습니다. 제보 목록에서 다시 선택해 주세요." />
    <Link className={styles.detailLink} to={listLink}>제보 목록으로 돌아가기</Link>
  </div>
}

export function LiveFanReportDetailPage() {
  const { reportId } = useParams()
  const fanReportId = readFanReportId(reportId)
  if (!fanReportId) return <InvalidFanReportAddress />
  return <ReportDetail key={fanReportId} fanReportId={fanReportId} />
}

function ReportDetail({ fanReportId }: { fanReportId: string }) {
  const { result, retry } = useAdminQuery(fanReportDetailPath(fanReportId), fanReportDetailSchema)
  if (result === null) return <div className={styles.page}><Link className={styles.backLink} to={listLink}>← 제보 목록</Link><LoadingSkeleton label="제보 상세를 불러오는 중" /></div>

  // 요청한 제보와 다른 응답은 다른 제보의 정보가 섞일 수 있으므로 표시하지 않는다.
  const mismatched = result.kind === 'success' && result.data.fanReportId !== fanReportId
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '제보를 찾을 수 없거나 접근 범위 밖입니다')
    return <div className={styles.page}><Link className={styles.backLink} to={listLink}>← 제보 목록</Link><ErrorState title={message.title} description={message.description} onRetry={retry} /></div>
  }

  const report = result.data
  return <div className={styles.page}>
    <Link className={styles.backLink} to={fanReportListRoute(report.event.id)}>← 제보 목록</Link>
    <PageHeader eyebrow="Track 2 팬 제보 조회" title="팬 제보 상세" description="팬이 제출한 정보와 저장된 증거, 증거별 이미지 분석 이력을 확인합니다. 분석 관찰값은 사실 확인이나 부정 거래 판정이 아닙니다." />
    <Card className={styles.summary}>
      <div><span>제보 ID</span><strong className={styles.idCell}>{report.fanReportId}</strong></div>
      <div><span>대상 공연</span><strong>{report.event.name}</strong></div>
      <div><span>제보 유형</span><strong>{reportTypeLabels[report.reportType]}</strong></div>
      <div><span>접수 상태</span><StatusPill label={intakeStatusLabels[report.intakeStatus]} tone={intakeTone(report.intakeStatus)} /></div>
      <div><span>접수 시각</span><strong><time dateTime={report.receivedAt}>{formatUtc(report.receivedAt)}</time></strong></div>
      <div><span>보존 기한</span><strong><time dateTime={report.retentionUntil}>{formatUtc(report.retentionUntil)}</time></strong></div>
    </Card>
    <div className={styles.liveGrid}>
      <FanInputPanel report={report} />
      <EvidencePanel fanReportId={report.fanReportId} evidence={report.evidence} />
    </div>
    <Card className={styles.panel}>
      <h2>후속 기능</h2>
      <div className={styles.followUp}>
        <Button disabled>이미지 분석 실행</Button>
        <Button disabled>예매 후보 대조</Button>
        <Button disabled>관찰값 수동 교정</Button>
        <Button disabled>Case 생성</Button>
      </div>
      <p className={styles.subtleNote}>이번 화면은 조회 전용입니다. 분석 실행, 예매 후보 대조, 수동 교정, Case 생성, 승인과 공식 PDF 발급은 연결하지 않았습니다.</p>
    </Card>
  </div>
}

function textOrNone(value: string | null) {
  return value === null || value.trim() === '' ? '입력 없음' : value
}

function FanInputPanel({ report }: { report: FanReportDetail }) {
  return <Card className={styles.panel}>
    <div className={styles.panelHeading}><h2>팬 입력 정보</h2><span>팬이 입력한 값이며 검증되지 않았습니다</span></div>
    <dl className={styles.factList}>
      <div><dt>공연 일시 (팬 입력)</dt><dd>{formatUtc(report.submittedPerformanceAt)}</dd></div>
      <div><dt>좌석 구역</dt><dd>{textOrNone(report.seatArea)}</dd></div>
      <div><dt>판매 플랫폼</dt><dd>{textOrNone(report.platform)}</dd></div>
      <div><dt>판매자 표시</dt><dd>{textOrNone(report.seller)}</dd></div>
      <div><dt>판매 가격 (팬 입력)</dt><dd>{report.askingPrice === null ? '입력 없음' : report.askingPrice.toLocaleString('ko-KR')}</dd></div>
      {/* 링크로 만들지 않는다. 팬 입력 주소에 자동 접속하거나 미리보기를 만들지 않기 위해서다. */}
      <div><dt>판매 게시물 주소 (팬 입력, 미검증)</dt><dd className={styles.plainText}>{textOrNone(report.listingUrl)}</dd></div>
    </dl>
    <section className={styles.fanText}>
      <h3>제보 설명</h3>
      <p className={styles.plainText}>{report.description.trim() === '' ? '입력 없음' : report.description}</p>
    </section>
    <p className={styles.subtleNote}>판매 게시물 주소는 서버와 화면 모두 접속하거나 확인하지 않았습니다. 판매자 표시는 확인된 신원이 아닙니다.</p>
  </Card>
}

function EvidencePanel({ fanReportId, evidence }: { fanReportId: string; evidence: FanReportEvidence[] }) {
  const [selectedId, setSelectedId] = useState(evidence[0]?.evidenceId ?? null)
  const selected = evidence.find((item) => item.evidenceId === selectedId)
  return <Card className={styles.panel}>
    <div className={styles.panelHeading}><h2>증거</h2><span>{evidence.length}개 접수, 원본 저장 확인 {evidence.filter((item) => item.originalStored).length}개</span></div>
    {selected ? <>
      <div className={styles.evidenceList} role="group" aria-label="증거 선택">
        {evidence.map((item, index) => <button key={item.evidenceId} type="button" aria-pressed={item.evidenceId === selectedId} aria-label={`증거 ${index + 1} 선택`} onClick={() => setSelectedId(item.evidenceId)}>
          <span>증거 {index + 1}</span><strong>{item.mediaType} {formatBytes(item.byteSize)}</strong>
        </button>)}
      </div>
      <EvidenceMetadata evidence={selected} />
      <ListingAnalysisHistory key={selected.evidenceId} fanReportId={fanReportId} evidenceId={selected.evidenceId} originalStored={selected.originalStored} />
    </> : <EmptyState title="접수된 증거가 없습니다" description="이 제보에는 증거 파일이 없어 이미지 분석 이력도 없습니다." />}
  </Card>
}

function EvidenceMetadata({ evidence }: { evidence: FanReportEvidence }) {
  return <section className={styles.evidenceMeta} aria-label="선택한 증거 정보">
    <div className={styles.previewUnavailable}>원본 이미지 미리보기와 다운로드는 아직 지원하지 않습니다.</div>
    <dl className={styles.factList}>
      <div><dt>증거 ID</dt><dd className={styles.idCell}>{evidence.evidenceId}</dd></div>
      <div><dt>형식과 크기</dt><dd>{evidence.mediaType}, {formatBytes(evidence.byteSize)}</dd></div>
      <div><dt>저장 상태</dt><dd><StatusPill label={storageStatusLabels[evidence.storageStatus]} tone={evidence.storageStatus === 'STORED' ? 'info' : evidence.storageStatus === 'FAILED' ? 'critical' : 'warning'} /></dd></div>
      <div><dt>원본 저장 확인</dt><dd>{evidence.originalStored ? '확인됨' : '정상 원본으로 확인되지 않음'}</dd></div>
      <div><dt>접수 시 원본 SHA-256</dt><dd className={styles.idCell}>{evidence.originalStored && evidence.sha256 ? evidence.sha256 : '없음 (원본 저장이 확인되지 않음)'}</dd></div>
      <div><dt>접수 시각</dt><dd>{formatUtc(evidence.createdAt)}</dd></div>
    </dl>
  </section>
}

function ListingAnalysisHistory({ fanReportId, evidenceId, originalStored }: { fanReportId: string; evidenceId: string; originalStored: boolean }) {
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(listingAnalysesPath(fanReportId, evidenceId, page), listingAnalysisPageSchema)
  const heading = <div className={styles.panelHeading}><h3>이미지 분석 이력</h3><span>최신 시도 순</span></div>
  if (result === null) return <section className={styles.history}>{heading}<LoadingSkeleton label="분석 이력을 불러오는 중" /></section>

  // 다른 제보나 다른 증거의 이력, 요청과 다른 페이지가 섞이면 표시하지 않는다.
  const mismatched = result.kind === 'success' && (result.data.page !== page
    || result.data.items.some((item) => item.fanReportId !== fanReportId || item.evidenceId !== evidenceId))
  if (result.kind !== 'success' || mismatched) {
    const failure = result.kind === 'success' ? { kind: 'invalidResponse' as const, status: result.status } : result
    const message = describeAdminApiFailure(failure, '증거를 찾을 수 없거나 접근 범위 밖입니다')
    return <section className={styles.history}>{heading}<ErrorState title={message.title} description={message.description} onRetry={retry} /></section>
  }

  const data = result.data
  return <section className={styles.history}>
    {heading}
    {data.items.length === 0
      ? page === 0
        ? <EmptyState title="아직 분석 이력이 없습니다" description={originalStored ? '이 증거로 이미지 분석을 실행한 기록이 없습니다. 분석 실패 기록과는 다른 상태입니다.' : '원본 저장이 확인되지 않은 증거이며 분석 기록이 없습니다.'} />
        : <><EmptyState title="이 페이지에 표시할 분석 이력이 없습니다" description="요청한 페이지가 이력 범위를 벗어났습니다." /><Button variant="secondary" size="small" onClick={() => setPage(0)}>첫 페이지로 이동</Button></>
      : <ol className={styles.attempts}>{data.items.map((item) => <li key={item.analysisId}><AnalysisAttempt analysis={item} /></li>)}</ol>}
    {(page > 0 || data.hasNext) && <nav className={styles.pagination} aria-label="분석 이력 페이지"><Button variant="secondary" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>이전 이력</Button><span>{page + 1} 페이지</span><Button variant="secondary" size="small" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>다음 이력</Button></nav>}
  </section>
}

function executionTone(status: ListingAnalysis['executionStatus']) {
  if (status === 'SUCCEEDED') return 'success' as const
  return status === 'IN_PROGRESS' ? 'neutral' as const : 'critical' as const
}

function analysisTone(status: NonNullable<ListingAnalysis['analysisStatus']>) {
  if (status === 'COMPLETED') return 'info' as const
  return status === 'FAILED' ? 'critical' as const : 'warning' as const
}

function inputCheck(input: ListingAnalysis['input']) {
  if (input.verifiedSha256 === null) return '원본 확인 전에 종료됨'
  return input.verifiedSha256 === input.expectedSha256 ? '접수 원본과 SHA-256 일치' : '접수 원본과 SHA-256 다름'
}

function AnalysisAttempt({ analysis }: { analysis: ListingAnalysis }) {
  const failed = analysis.executionStatus !== 'SUCCEEDED' && analysis.executionStatus !== 'IN_PROGRESS'
  return <article className={styles.attempt} aria-label={`분석 시도 ${formatUtc(analysis.createdAt)}`}>
    <div className={styles.attemptHeading}>
      <strong><time dateTime={analysis.createdAt}>{formatUtc(analysis.createdAt)}</time> 시도</strong>
      <span className={styles.pillGroup}>
        <span>실행 상태</span><StatusPill label={executionStatusLabels[analysis.executionStatus]} tone={executionTone(analysis.executionStatus)} />
        <span>결과 상태</span>{analysis.analysisStatus === null ? <StatusPill label="결과 없음" /> : <StatusPill label={analysisStatusLabels[analysis.analysisStatus]} tone={analysisTone(analysis.analysisStatus)} />}
      </span>
    </div>
    <dl className={styles.factList}>
      <div><dt>모델</dt><dd>{analysis.modelName ?? '기록 없음'}{analysis.modelName && ` (버전 ${analysis.modelVersion ?? '기록 없음'})`}</dd></div>
      <div><dt>분석 시각</dt><dd>{analysis.analyzedAt === null ? '기록 없음' : formatUtc(analysis.analyzedAt)}</dd></div>
      <div><dt>입력 확인</dt><dd>{inputCheck(analysis.input)}</dd></div>
      {failed && <div><dt>실패 분류 코드</dt><dd>{formatCode(analysis.errorCode)}{analysis.analyzerErrorCode !== null && `, 분석 서버 ${formatCode(analysis.analyzerErrorCode)}`}{analysis.analyzerHttpStatus !== null && ` (HTTP ${analysis.analyzerHttpStatus})`}</dd></div>}
      <div><dt>예매 후보 대조</dt><dd>{analysis.candidateMatch === null ? '대조 기록 없음' : `예매 대조 미연결 (${candidateMatchReasonLabels[analysis.candidateMatch.reason]})`}</dd></div>
    </dl>
    {analysis.fields === null
      ? analysis.executionStatus === 'IN_PROGRESS'
        ? <EmptyState title="분석이 아직 끝나지 않았습니다" description="실행 중인 시도이므로 관찰값이 없습니다." />
        : <ErrorState title="이 시도는 관찰값이 없습니다" description="분석이 실패해 관찰값을 만들지 못했습니다. 정상적인 빈 추출 결과가 아닙니다." />
      : <div className={styles.fields}>{listingFieldNames.map((name) => <ObservedField key={name} name={name} field={analysis.fields![name]} />)}</div>}
    {analysis.reviewRequired && <p className={styles.caution}>관찰값은 모델이 이미지에서 읽은 후보이며 사람의 확인이 필요합니다. 사실 확인, 예매 일치, 부정 거래 판정이 아닙니다.</p>}
  </article>
}

function fieldValue(name: ListingFieldName, field: ListingField) {
  if (field.value === null) return null
  if (typeof field.value === 'string') return field.value
  return name === 'askingPrice' ? `${field.value.raw} (금액 ${field.value.amount})` : null
}

function ObservedField({ name, field }: { name: ListingFieldName; field: ListingField }) {
  const value = fieldValue(name, field)
  return <section className={styles.fieldCard} aria-label={`${listingFieldLabels[name]} 관찰`}>
    <div className={styles.fieldHeading}><h4>{listingFieldLabels[name]}</h4><StatusPill label={fieldStateLabels[field.state]} tone={field.state === 'FOUND' ? 'info' : field.state === 'AMBIGUOUS' ? 'warning' : 'neutral'} /></div>
    {field.state === 'FOUND' && <p className={styles.original}><span>관찰값</span><strong className={styles.plainText}>{value}</strong></p>}
    {field.state === 'UNKNOWN' && <p className={styles.fieldNote}>{field.unknownReason === null ? '값을 확인하지 못했습니다.' : unknownReasonLabels[field.unknownReason]}</p>}
    {field.state === 'AMBIGUOUS' && <div className={styles.original}><span>해석 후보 (하나로 정하지 않음)</span>{field.candidates.length === 0 ? <strong>후보 없음</strong> : <ul className={styles.candidates}>{field.candidates.map((candidate, index) => <li key={index} className={styles.plainText}>{candidate}</li>)}</ul>}</div>}
    {field.evidenceQuote !== null && <p className={styles.fieldNote}>근거 문구: <span className={styles.plainText}>{field.evidenceQuote}</span></p>}
  </section>
}
