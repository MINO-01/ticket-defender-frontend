import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { describeAdminApiFailure } from '../../api/adminApiFailure'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StepNav, TechnicalDetails, WorkGuide } from '../../components/common/WorkGuide'
import type { GuideItem } from '../../components/common/WorkGuide'
import { terms } from '../../app/terms'
import { useAdminQuery } from '../admin-auth/useAdminQuery'
import { CandidateMatchSection } from './CandidateMatchSection'
import { EvidenceContentPreview } from './EvidenceContentPreview'
import { FanReportCasePanel } from './FanReportCasePanel'
import { ListingAnalysisRunPanel } from './ListingAnalysisRunPanel'
import { PerformanceSection } from './PerformancePanels'
import { StatusPill } from './StatusPill'
import {
  analysisStatusLabels, candidateMatchReasonLabels, executionStatusLabels, fanReportDetailPath, fanReportDetailSchema, fanReportListRoute, fieldStateLabels,
  formatBytes, formatCode, formatUtc, intakeStatusLabels, intakeTone, listingAnalysesPath, listingAnalysisPageSchema, listingFieldLabels, listingFieldNames,
  readFanReportId, storageStatusLabels, unknownReasonLabels, fanReportReference, intakeStatusHelp,
} from './track2Api'
import type { FanReportDetail, FanReportEvidence, ListingAnalysis, ListingField, ListingFieldName } from './track2Api'
import { reportTypeLabels } from './track2Model'
import styles from './Track2.module.css'
import { useCandidateMatchRuns } from './useCandidateMatchRuns'
import { useCandidateRunSelection } from './useCandidateRunSelection'
import type { CandidateRunSelection } from './useCandidateRunSelection'
import { useListingAnalysisRuns } from './useListingAnalysisRuns'

// 인증된 관리자의 Track 2 팬 제보 상세다. 주소의 제보 ID로 조회하며 다른 고객사나 권한 없는 공연의 제보는 서버가 404로 숨긴다.
// 팬 입력값은 검증되지 않은 문자열이므로 일반 텍스트로만 표시하고, listingUrl에 접속하거나 미리보기, 임베드를 만들지 않는다.
// 분석 이력, 원본 미리보기, 분석 실행, 후보 대조, 회차 연결, Case 생성은 상세 응답과 서버 응답의 ID로만 요청한다. 원본 다운로드와 수동 교정은 제공하지 않는다.
// 이미지 분석 응답의 candidateMatch(NOT_LINKED)는 분석 시점의 기존 표시이며 후보 대조 실행 이력과 섞지 않는다.
// 후보 실행 이력에서 고른 신규 Case 출처는 이 제보 화면 안에서만 공유하며 Case 생성 영역이 candidateRunIds로 보낸다.

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
  const selection = useCandidateRunSelection()
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
    <PageHeader eyebrow="팬 제보 조사" title="팬 제보 상세" description="제보 내용과 저장된 증거를 확인하고, 이미지 정보 추출, 검증 회차 연결, 예매 기록 비교를 거쳐 조사 사건을 만듭니다. 추출 관찰값과 일치 예매 후보는 사실 확인이나 부정 거래 판정이 아닙니다." />
    <Card className={styles.summary}>
      <div><span>접수번호</span><strong>{report.receiptNumber ?? fanReportReference(report)}</strong>{!report.receiptNumber && <small className={styles.cellSub}>서버 응답에 접수번호가 없어 제보 ID 앞부분으로 표시합니다</small>}</div>
      <div><span>대상 공연</span><strong>{report.event.name}</strong></div>
      <div><span>제보 유형</span><strong>{reportTypeLabels[report.reportType]}</strong></div>
      <div><span>접수 상태</span><StatusPill label={intakeStatusLabels[report.intakeStatus]} tone={intakeTone(report.intakeStatus)} /></div>
      <div><span>접수 시각</span><strong><time dateTime={report.receivedAt}>{formatUtc(report.receivedAt)}</time></strong></div>
      <div><span>보존 기한</span><strong><time dateTime={report.retentionUntil}>{formatUtc(report.retentionUntil)}</time></strong></div>
    </Card>
    <ReportGuide report={report} />
    <TechnicalDetails summary="기술 상세 (제보 ID, 공연 ID)">
      <div>제보 ID <span className={styles.idCell}>{report.fanReportId}</span></div>
      <div>공연 ID <span className={styles.idCell}>{report.event.id}</span></div>
    </TechnicalDetails>
    <div id="step-evidence" className={styles.liveGrid}>
      <FanInputPanel report={report} />
      <EvidencePanel fanReportId={report.fanReportId} evidence={report.evidence} selection={selection} />
    </div>
    <div id="step-performance"><PerformanceSection report={report} /></div>
    <Card className={styles.panel}>
      <h2>후속 기능</h2>
      <div className={styles.followUp}>
        <Button disabled>관찰값 수동 교정</Button>
      </div>
      <p className={styles.subtleNote}>이미지 정보 추출과 예매 기록 비교는 증거 영역의 추출 이력에서 추출 결과별로 요청합니다. 관찰값을 고치는 API가 없어 수동 교정은 제공하지 않습니다. 비교 실행은 이력에서 선택해 아래 신규 조사 사건 생성에만 연결하며, 기존 조사 사건에 출처를 추가하는 기능은 없습니다.</p>
    </Card>
    <div id="step-case"><FanReportCasePanel report={report} selection={selection} /></div>
  </div>
}

/** 제보 상세 응답만으로 만든 조사 진행 요약이다. 추출, 회차 연결, 비교 결과는 각 영역이 따로 조회하므로 여기서 완료 여부를 추정하지 않는다. */
function ReportGuide({ report }: { report: FanReportDetail }) {
  const stored = report.evidence.filter((item) => item.originalStored).length
  const total = report.evidence.length
  const confirmed: GuideItem[] = [
    { key: 'event', content: <>서버가 연결한 공연: {report.event.name}</> },
    { key: 'intake', content: <>접수 상태: {intakeStatusLabels[report.intakeStatus]}. {intakeStatusHelp[report.intakeStatus]}</> },
    { key: 'evidence', content: <>증거 {total}개 중 원본 저장과 SHA-256 기록이 확인된 증거 {stored}개</> },
  ]
  const unconfirmed: GuideItem[] = [
    { key: 'fan-input', content: '팬이 입력한 공연 일시, 좌석, 판매 플랫폼, 가격은 검증되지 않은 값입니다.' },
    { key: 'seller', content: '판매자 표시는 확인된 신원이 아니며, 제보자 본인이나 예매자 식별자와 다른 정보입니다.' },
    { key: 'extract', content: `${terms.listingAnalysis} 결과는 증거별 이력에서 확인합니다. 관찰값은 사람이 확인하기 전까지 후보입니다.` },
    { key: 'compare', content: `${terms.candidateMatch} 결과의 ${terms.matchCandidate}는 위반 확정이 아닙니다.` },
  ]
  const next: GuideItem[] = stored === 0
    ? [{ key: 'no-original', content: '원본 저장이 확인된 증거가 없어 이미지 정보 추출을 실행할 수 없습니다. 접수 상태와 증거 저장 상태를 먼저 확인하세요.' }]
    : [
      { key: 'extract', content: <><a href="#step-evidence">증거 영역</a>에서 증거를 골라 {terms.listingAnalysis} 이력을 확인하거나 실행합니다.</> },
      { key: 'performance', content: <><a href="#step-performance">검증 회차 연결</a>에서 이 제보의 공연 회차를 사람이 확인해 연결합니다.</> },
      { key: 'compare', content: `추출 결과별로 ${terms.candidateMatch}를 실행하고, 근거로 쓸 비교 실행을 선택합니다.` },
      { key: 'case', content: <><a href="#step-case">{terms.case} 생성</a>에서 선택한 근거로 조사 사건을 만듭니다.</> },
    ]
  return <>
    <WorkGuide confirmed={confirmed} unconfirmed={unconfirmed} next={next} />
    <StepNav label="팬 제보 조사 단계" steps={[
      { key: 'evidence', title: '증거 확인', href: '#step-evidence', status: `원본 저장 확인 ${stored} / ${total}개` },
      { key: 'extract', title: terms.listingAnalysis, href: '#step-evidence', status: '증거별 이력에서 실행과 결과 확인' },
      { key: 'performance', title: '검증 회차 연결', href: '#step-performance', status: '사람이 확인한 회차 연결' },
      { key: 'compare', title: terms.candidateMatch, href: '#step-evidence', status: '추출 결과별로 실행' },
      { key: 'case', title: `${terms.case} 생성`, href: '#step-case', status: '선택한 근거로 생성' },
    ]} />
  </>
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

function EvidencePanel({ fanReportId, evidence, selection }: { fanReportId: string; evidence: FanReportEvidence[]; selection: CandidateRunSelection }) {
  const [selectedId, setSelectedId] = useState(evidence[0]?.evidenceId ?? null)
  const selectedIndex = evidence.findIndex((item) => item.evidenceId === selectedId)
  const selected = evidence[selectedIndex]
  const runs = useListingAnalysisRuns(fanReportId)
  const candidates = useCandidateMatchRuns(fanReportId)
  return <Card className={styles.panel}>
    <div className={styles.panelHeading}><h2>증거</h2><span>{evidence.length}개 접수, 원본 저장 확인 {evidence.filter((item) => item.originalStored).length}개</span></div>
    {selected ? <>
      <div className={styles.evidenceList} role="group" aria-label="증거 선택">
        {evidence.map((item, index) => <button key={item.evidenceId} type="button" aria-pressed={item.evidenceId === selectedId} aria-label={`증거 ${index + 1} 선택`} onClick={() => setSelectedId(item.evidenceId)}>
          <span>증거 {index + 1}</span><strong>{item.mediaType} {formatBytes(item.byteSize)}</strong>
        </button>)}
      </div>
      {/* 증거마다 새로 만들어 다른 증거로 바꾸면 이전 요청과 이미지가 정리되게 한다. */}
      <EvidenceContentPreview key={`preview:${selected.evidenceId}`} fanReportId={fanReportId} evidence={selected} evidenceLabel={`증거 ${selectedIndex + 1}`} />
      <EvidenceMetadata evidence={selected} />
      <ListingAnalysisRunPanel evidence={selected} attempt={runs.attempts[selected.evidenceId]}
        onStart={() => runs.start(selected.evidenceId)} onReconfirm={() => runs.reconfirm(selected.evidenceId)} onRefreshHistory={() => runs.refreshHistory(selected.evidenceId)} />
      {/* 분석 시도가 끝나거나 재조회를 누르면 새로 만들어 최신 첫 페이지를 다시 조회한다. */}
      <ListingAnalysisHistory key={`${selected.evidenceId}:${runs.historyVersions[selected.evidenceId] ?? 0}`} fanReportId={fanReportId} evidenceId={selected.evidenceId} originalStored={selected.originalStored} candidates={candidates} selection={selection} />
    </> : <EmptyState title="접수된 증거가 없습니다" description="이 제보에는 증거 파일이 없어 이미지 분석 이력도 없습니다." />}
  </Card>
}

function EvidenceMetadata({ evidence }: { evidence: FanReportEvidence }) {
  return <section className={styles.evidenceMeta} aria-label="선택한 증거 정보">
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

type CandidateRuns = ReturnType<typeof useCandidateMatchRuns>

function ListingAnalysisHistory({ fanReportId, evidenceId, originalStored, candidates, selection }: { fanReportId: string; evidenceId: string; originalStored: boolean; candidates: CandidateRuns; selection: CandidateRunSelection }) {
  const [page, setPage] = useState(0)
  const { result, retry } = useAdminQuery(listingAnalysesPath(fanReportId, evidenceId, page), listingAnalysisPageSchema)
  const heading = <div className={styles.panelHeading}><h3>이미지 정보 추출 이력</h3><span>최신 시도 순</span></div>
  if (result === null) return <section className={styles.history}>{heading}<LoadingSkeleton label="이미지 정보 추출 이력을 불러오는 중" /></section>

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
      : <ol className={styles.attempts}>{data.items.map((item) => <li key={item.analysisId}><AnalysisAttempt analysis={item} candidates={candidates} selection={selection} /></li>)}</ol>}
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

function AnalysisAttempt({ analysis, candidates, selection }: { analysis: ListingAnalysis; candidates: CandidateRuns; selection: CandidateRunSelection }) {
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
      <div><dt>분석 응답의 기존 대조 표시 (후보 실행과 별개)</dt><dd>{analysis.candidateMatch === null ? '표시 없음' : `분석 시점 미연결 (${candidateMatchReasonLabels[analysis.candidateMatch.reason]})`}</dd></div>
    </dl>
    {analysis.fields === null
      ? analysis.executionStatus === 'IN_PROGRESS'
        ? <EmptyState title="분석이 아직 끝나지 않았습니다" description="실행 중인 시도이므로 관찰값이 없습니다." />
        : <ErrorState title="이 시도는 관찰값이 없습니다" description="분석이 실패해 관찰값을 만들지 못했습니다. 정상적인 빈 추출 결과가 아닙니다." />
      : <div className={styles.fields}>{listingFieldNames.map((name) => <ObservedField key={name} name={name} field={analysis.fields![name]} />)}</div>}
    {analysis.reviewRequired && <p className={styles.caution}>관찰값은 모델이 이미지에서 읽은 후보이며 사람의 확인이 필요합니다. 사실 확인, 예매 일치, 부정 거래 판정이 아닙니다.</p>}
    <CandidateMatchSection fanReportId={analysis.fanReportId} evidenceId={analysis.evidenceId} analysis={analysis} attempt={candidates.attempts[analysis.analysisId]}
      historyVersion={candidates.historyVersions[analysis.analysisId] ?? 0} onStart={() => candidates.start(analysis.evidenceId, analysis.analysisId)}
      onReconfirm={() => candidates.reconfirm(analysis.evidenceId, analysis.analysisId)} onRefreshHistory={() => candidates.refreshHistory(analysis.analysisId)} selection={selection} />
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
