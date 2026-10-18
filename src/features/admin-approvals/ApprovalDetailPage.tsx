import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { caseEvents, caseTypeLabels, isValidCaseDataset } from '../admin-cases/caseModel'
import type { CaseDataset, CaseRecord } from '../admin-cases/caseModel'
import { demoCaseData } from '../admin-cases/demoData'
import { demoTrack1Data, signalLabels } from '../admin-track1/demoData'
import type { Track1Dataset } from '../admin-track1/demoData'
import { demoTrack2Data } from '../admin-track2/demoData'
import { comparisonLabels, extractionLabels } from '../admin-track2/track2Model'
import type { Track2Dataset } from '../admin-track2/track2Model'
import { approvalChecklist } from './approvalModel'
import styles from './Approvals.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'
const displayTime = (value: string) => value.slice(0, 16).replace('T', ' ')

function EvidenceSources({ item, track1, track2 }: { item: CaseRecord; track1: Track1Dataset; track2: Track2Dataset }) {
  return <Card className={styles.panel} aria-label="출처별 조사 근거">
    <div className={styles.panelHeading}><h2>사건 출처와 근거</h2><span>{item.sources.length}개 출처</span></div>
    {item.type === 'COMBINED' && <p className={styles.linkReason}><strong>출처 간 관계 · 직접 연결 미확정</strong>{item.linkReason}<small>공동 검토 사유는 실제 출처 간 동일 예매·계정 관계의 증명이 아닙니다.</small></p>}
    <div className={styles.sourceList}>{item.sources.map((source) => {
      if (source.kind === 'GRAPH_CLUSTER') {
        const cluster = track1.clusters.find((entry) => entry.id === source.clusterId)
        const run = track1.runs.find((entry) => entry.id === source.analysisRunId)
        if (!cluster || !run) return <p key={`graph-${source.clusterId}`}>군집 참조를 확인할 수 없습니다.</p>
        const signals = [...new Set(cluster.signals.map((signal) => signal.kind))].map((kind) => signalLabels[kind])
        return <article className={styles.source} key={`graph-${cluster.id}`}>
          <span className={styles.sourceType}>Track 1 · 연관 예매 군집</span><h3>{cluster.id}</h3>
          <p>분석 실행 {run.id} · <time dateTime={run.analyzedAt}>{displayTime(run.analyzedAt)}</time></p>
          <dl className={styles.sourceFacts}><div><dt>관련 예매</dt><dd>{cluster.reservations.length}건</dd></div><div><dt>관련 계정</dt><dd>{cluster.accounts.length}개</dd></div><div><dt>공유 신호</dt><dd>{signals.join(' · ') || '표시 없음'}</dd></div></dl>
          <p className={styles.sourceCaution}>공유 신호는 연결 단서이며 동일인이나 부정 거래를 확정하지 않습니다.</p>
          <Link className={styles.detailLink} to={`/app/analysis/findings/${cluster.id}`}>군집 {cluster.id} 상세 보기</Link>
        </article>
      }
      const report = track2.reports.find((entry) => entry.id === source.reportId)
      if (!report) return <p key={`fan-${source.reportId}`}>팬 제보 참조를 확인할 수 없습니다.</p>
      const extraction = track2.extractions.find((entry) => entry.id === report.extractionId)
      const comparison = track2.comparisons.find((entry) => entry.id === report.comparisonId)
      return <article className={styles.source} key={`fan-${report.id}`}>
        <span className={styles.sourceType}>Track 2 · 팬 제보</span><h3>{report.id}</h3>
        <p>제보 접수 <time dateTime={report.receivedAt}>{displayTime(report.receivedAt)}</time></p>
        <dl className={styles.sourceFacts}><div><dt>첨부 증거</dt><dd>{report.evidenceIds.length}개</dd></div><div><dt>이미지 정보 추출</dt><dd>{extraction ? extractionLabels[extraction.status] : '확인 불가'}</dd></div><div><dt>예매 대조</dt><dd>{comparison ? comparisonLabels[comparison.status] : '확인 불가'}</dd></div></dl>
        {comparison && <p className={styles.sourceSummary}>{comparison.reason}</p>}
        <p className={styles.sourceCaution}>대조 후보는 거래 당사자나 부정 거래의 확정 결과가 아닙니다.</p>
        <Link className={styles.detailLink} to={`/app/fan-reports/${report.id}`}>제보 {report.id} 상세 보기</Link>
      </article>
    })}</div>
  </Card>
}

export function ApprovalDetailPage({ data = demoCaseData, track1 = demoTrack1Data, track2 = demoTrack2Data, state = 'ready' }: {
  data?: CaseDataset; track1?: Track1Dataset; track2?: Track2Dataset; state?: ViewState
}) {
  const { caseId } = useParams()
  if (state === 'loading') return <LoadingSkeleton label="승인 검토 근거를 불러오는 중" />
  if (state === 'failed') return <ErrorState title="승인 검토 근거를 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidCaseDataset(data, track1, track2)) return <ErrorState title="승인 검토 데이터를 확인할 수 없습니다" description="사건과 출처의 참조 관계를 확인해 주세요." />

  const item = data.cases.find((entry) => entry.id === caseId)
  if (!item) return <div className={styles.page}><EmptyState title="사건을 찾을 수 없습니다" description="사건 ID를 확인하거나 검토 후보 목록으로 돌아가 주세요." /><Link className={styles.detailLink} to="/app/approvals">검토 후보 목록으로 이동</Link></div>
  if (item.status !== 'READY_FOR_APPROVAL') return <div className={styles.page}><EmptyState title="승인 검토 후보가 아닙니다" description="이 사건은 합성 Case의 승인 검토 대기 상태가 아닙니다. 정식 승인 요청 상태를 뜻하지 않습니다." /><Link className={styles.detailLink} to={`/app/cases/${item.id}`}>사건 {item.id} 상세 보기</Link></div>

  const event = caseEvents(track1, track2).find((entry) => entry.id === item.eventId)
  const checklist = approvalChecklist(item)
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="위치"><Link to="/app/approvals">승인 검토 후보</Link><span aria-hidden="true">/</span><span>{item.id}</span></nav>
    <PageHeader eyebrow="Approval Review · 합성 데모 데이터" title={`승인 검토 · ${item.id}`} description={item.summary} action={<Link className={styles.backLink} to={`/app/cases/${item.id}`}>기존 사건 상세 보기</Link>} />
    <Card className={styles.policy} aria-label="검토 범위 안내"><strong>합성 검토 후보 · 실제 승인 요청 없음</strong><p>아래 체크리스트는 근거 표시 상태를 살펴보기 위한 자료입니다. 법적·업무적 승인 요건이나 승인 가능 여부를 판정하지 않습니다.</p></Card>
    <Card className={styles.overview} aria-label="사건 개요">
      <div className={styles.panelHeading}><h2>사건 개요</h2><StatusBadge domain="case" status={item.status} /></div>
      <dl className={styles.overviewGrid}>
        <div><dt>사건 ID</dt><dd>{item.id}</dd></div><div><dt>대상 공연</dt><dd>{event?.name}</dd></div><div><dt>사건 유형</dt><dd>{caseTypeLabels[item.type]}</dd></div>
        <div><dt>조사 담당자</dt><dd>{item.assignee ?? '미지정'} · 합성</dd></div><div><dt>조사 우선순위</dt><dd>{item.priority}점</dd></div><div><dt>생성 시각</dt><dd><time dateTime={item.createdAt}>{displayTime(item.createdAt)}</time></dd></div><div><dt>최근 검토</dt><dd><time dateTime={item.updatedAt}>{displayTime(item.updatedAt)}</time></dd></div>
      </dl>
      <p className={styles.overviewNote}>조사 담당자는 합성 Case 데이터의 담당자입니다. 승인자는 인증·권한 계약이 없어 지정하거나 표시하지 않습니다. 우선순위는 위법성 판단이 아닙니다.</p>
    </Card>
    <div className={styles.reviewLayout}>
      <div className={styles.evidenceColumn}>
        <EvidenceSources item={item} track1={track1} track2={track2} />
        <Card className={styles.panel} aria-label="확인 및 미확인 사항"><h2>확인된 내용과 추가 검토</h2>
          <section className={styles.factSection}><h3>자료에서 관찰된 정보</h3><ul>{item.facts.map((fact, index) => <li key={`${index}-${fact}`}>{fact}</li>)}</ul></section>
          <section className={styles.factSection}><h3>분석 연결 단서</h3>{item.clues.length ? <ul>{item.clues.map((clue, index) => <li key={`${index}-${clue}`}>{clue}</li>)}</ul> : <p>표시할 연결 단서가 없습니다.</p>}</section>
          <section className={`${styles.factSection} ${styles.unknownSection}`}><h3>미확인 사항 · 추가 확인 {item.unknowns.length}개</h3><ul>{item.unknowns.map((unknown, index) => <li key={`${index}-${unknown}`}>{unknown}</li>)}</ul></section>
        </Card>
      </div>
      <Card className={styles.panel} aria-label="검토 체크리스트"><div className={styles.panelHeading}><h2>검토 체크리스트</h2><span>표시 상태만 확인</span></div><p className={styles.checkIntro}>자료가 보인다는 사실은 승인 요건 충족을 뜻하지 않습니다.</p>
        <ol className={styles.checklist}>{checklist.map((check) => <li key={check.id}><div><strong>{check.label}</strong><span className={`${styles.checkState} ${styles[check.state]}`}>{check.result}</span></div><p>{check.detail}</p></li>)}</ol>
      </Card>
      <Card className={styles.panel} aria-label="업무 동작"><h2>업무 동작</h2><p className={styles.actionNote}>Backend 승인 요청·결정 API와 승인자 인증·권한 정책이 없습니다. 조사 담당자의 자기 승인을 허용하는 역할 전환도 제공하지 않습니다.</p>
        <div className={styles.actions}><Button disabled>승인 요청 제출</Button><Button variant="secondary" disabled>승인</Button><Button variant="danger" disabled>반려</Button><Button variant="secondary" disabled>보완 요청 전송</Button><Button variant="secondary" disabled>공식 보고서 발급</Button></div>
        <p className={styles.actionFootnote}>승인 기록과 감사 이력은 생성되지 않습니다. 공식 보고서 발급은 현재 Backend에서도 차단되어 있습니다.</p>
      </Card>
    </div>
    <p className={styles.notice}>실제 관리자 인증, 고객사·공연 범위 검사, 승인자 분리와 증거 접근 통제는 Backend 연동 후 적용해야 합니다.</p>
  </div>
}
