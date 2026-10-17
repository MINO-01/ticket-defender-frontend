import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from '../../components/common/Feedback'
import { PageHeader } from '../../components/common/PageHeader'
import { StatusBadge } from '../../components/common/StatusBadge'
import { demoTrack1Data, signalLabels } from '../admin-track1/demoData'
import type { Track1Dataset } from '../admin-track1/demoData'
import { demoTrack2Data } from '../admin-track2/demoData'
import { comparisonLabels, extractionLabels } from '../admin-track2/track2Model'
import type { Track2Dataset } from '../admin-track2/track2Model'
import { caseEvents, caseTypeLabels, isValidCaseDataset } from './caseModel'
import type { CaseDataset, CaseRecord } from './caseModel'
import { demoCaseData } from './demoData'
import styles from './Cases.module.css'

type ViewState = 'ready' | 'loading' | 'failed' | 'forbidden'
function displayTime(value: string) { return value.slice(0, 16).replace('T', ' ') }

function Sources({ item, track1, track2 }: { item: CaseRecord; track1: Track1Dataset; track2: Track2Dataset }) {
  return <Card className={styles.panel} aria-label="연결 근거">
    <div className={styles.panelHeading}><h2>연결 근거</h2><span>{item.sources.length}개 출처</span></div>
    {item.type === 'COMBINED' && <p className={styles.linkReason}><strong>임시 공동 검토 · 직접 연결 미확인</strong>{item.linkReason}</p>}
    <div className={styles.sourceList}>{item.sources.map((source) => {
      if (source.kind === 'GRAPH_CLUSTER') {
        const cluster = track1.clusters.find((entry) => entry.id === source.clusterId)
        const run = track1.runs.find((entry) => entry.id === source.analysisRunId)
        if (!cluster || !run) return <p key={source.clusterId}>군집 연결 정보를 확인할 수 없습니다.</p>
        return <article className={styles.source} key={`graph-${cluster.id}`}>
          <span className={styles.sourceType}>Track 1 · 연관 예매 군집</span><h3>{cluster.id}</h3>
          <dl className={styles.definition}><div><dt>분석 작업</dt><dd>{run.id}</dd></div><div><dt>분석 시각</dt><dd><time dateTime={run.analyzedAt}>{displayTime(run.analyzedAt)}</time></dd></div><div><dt>관련 예매 · 계정</dt><dd>{cluster.reservations.length}건 · {cluster.accounts.length}개</dd></div><div><dt>공유된 연결 정보</dt><dd>{[...new Set(cluster.signals.map((signal) => signal.kind))].map((kind) => signalLabels[kind]).join(' · ')}</dd></div></dl>
          <p className={styles.caution}>공유 신호는 연결 단서이며 동일인이나 부정 거래의 확정 근거가 아닙니다.</p>
          <Link className={styles.detailLink} to={`/app/analysis/findings/${cluster.id}`}>군집 {cluster.id} 상세 보기</Link>
        </article>
      }
      const report = track2.reports.find((entry) => entry.id === source.reportId)
      if (!report) return <p key={source.reportId}>제보 연결 정보를 확인할 수 없습니다.</p>
      const extraction = track2.extractions.find((entry) => entry.id === report.extractionId)
      const comparison = track2.comparisons.find((entry) => entry.id === report.comparisonId)
      return <article className={styles.source} key={`fan-${report.id}`}>
        <span className={styles.sourceType}>Track 2 · 팬 제보</span><h3>{report.id}</h3>
        <dl className={styles.definition}><div><dt>증거 파일</dt><dd>{report.evidenceIds.length}개</dd></div><div><dt>이미지 정보 추출</dt><dd>{extraction ? extractionLabels[extraction.status] : '확인 불가'}</dd></div><div><dt>예매 대조</dt><dd>{comparison ? comparisonLabels[comparison.status] : '확인 불가'}</dd></div></dl>
        <p className={styles.caution}>대조 후보는 거래 당사자나 부정 거래의 확정 결과가 아닙니다.</p>
        <Link className={styles.detailLink} to={`/app/fan-reports/${report.id}`}>제보 {report.id} 상세 보기</Link>
      </article>
    })}</div>
  </Card>
}

export function CaseDetailPage({ data = demoCaseData, track1 = demoTrack1Data, track2 = demoTrack2Data, state = 'ready' }: { data?: CaseDataset; track1?: Track1Dataset; track2?: Track2Dataset; state?: ViewState }) {
  const { caseId } = useParams()
  if (state === 'loading') return <LoadingSkeleton label="사건 상세를 불러오는 중" />
  if (state === 'failed') return <ErrorState title="사건 상세를 불러오지 못했습니다" description="조회 기능을 연결한 뒤 다시 시도해 주세요." />
  if (state === 'forbidden') return <PermissionDenied />
  if (!isValidCaseDataset(data, track1, track2)) return <ErrorState title="사건 데이터 형식을 확인할 수 없습니다" description="합성 출처의 참조 관계를 확인해 주세요." />
  const item = data.cases.find((entry) => entry.id === caseId)
  if (!item) return <div className={styles.page}><EmptyState title="사건을 찾을 수 없습니다" description="사건 ID를 확인하거나 목록으로 돌아가 주세요." /><Link className={styles.detailLink} to="/app/cases">사건 목록으로 이동</Link></div>
  const event = caseEvents(track1, track2).find((entry) => entry.id === item.eventId)
  const activities = [...item.activities].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="위치"><Link to="/app/cases">사건 목록</Link><span aria-hidden="true">/</span><span>{item.id}</span></nav>
    <PageHeader eyebrow="Case Management · 합성 데모 데이터" title={`사건 ${item.id}`} description={item.summary} />
    <Card className={styles.overview} aria-label="사건 개요">
      <div className={styles.panelHeading}><h2>사건 개요</h2><StatusBadge domain="case" status={item.status} /></div>
      <dl className={styles.overviewGrid}><div><dt>대상 공연</dt><dd>{event?.name}</dd></div><div><dt>사건 유형</dt><dd>{caseTypeLabels[item.type]}</dd></div><div><dt>조사 우선순위</dt><dd>{item.priority}점</dd></div><div><dt>담당자</dt><dd>{item.assignee ?? '미지정'} · 합성</dd></div><div><dt>생성 시각</dt><dd><time dateTime={item.createdAt}>{displayTime(item.createdAt)}</time></dd></div><div><dt>최근 검토</dt><dd><time dateTime={item.updatedAt}>{displayTime(item.updatedAt)}</time></dd></div></dl>
      <p className={styles.caution}>조사 우선순위는 검토 순서를 위한 합성 점수이며 불법 가능성이나 위법성 판단이 아닙니다.</p>
    </Card>
    <div className={styles.detailGrid}>
      <div className={styles.mainColumn}>
        <Sources item={item} track1={track1} track2={track2} />
        <Card className={styles.panel} aria-label="확인 및 미확인 사항"><h2>확인된 사항과 추가 검토</h2>
          <div className={styles.reviewGrid}><section><h3>자료에서 확인한 내용</h3><ul>{item.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></section><section><h3>분석이 제시한 단서</h3>{item.clues.length ? <ul>{item.clues.map((clue) => <li key={clue}>{clue}</li>)}</ul> : <p>표시할 연결 단서가 없습니다.</p>}</section><section className={styles.unknowns}><h3>미확인 사항 · 추가 검토</h3><ul>{item.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}</ul></section></div>
        </Card>
      </div>
      <aside className={styles.sideColumn} aria-label="조사 이력 및 업무 동작">
        <Card className={styles.panel}><h2>조사 활동 이력</h2><p className={styles.caution}>아래 이력은 합성 시연 내용이며 실제 감사 로그나 저장 기록이 아닙니다.</p><ol className={styles.timeline}>{activities.map((activity) => <li key={activity.id}><time dateTime={activity.at}>{displayTime(activity.at)}</time><p>{activity.detail}</p></li>)}</ol></Card>
        <Card className={styles.panel}><h2>업무 동작</h2><p className={styles.caution}>사건 상태·담당자·승인·보고서 API와 권한 정책이 연결되지 않아 실행할 수 없습니다.</p><div className={styles.actions}><Button variant="secondary" disabled>담당자 변경</Button><Button variant="secondary" disabled>상태 변경</Button><Button variant="secondary" disabled>승인 요청</Button><Button variant="secondary" disabled>승인·반려</Button><Button variant="secondary" disabled>사건 종료</Button><Button variant="secondary" disabled>공식 보고서 발급</Button></div></Card>
      </aside>
    </div>
    <p className={styles.notice}>합성 사건 화면입니다. 실제 Backend Case API, 관리자 인증·고객사 격리, 증거 접근 통제는 구현되지 않았습니다.</p>
  </div>
}
