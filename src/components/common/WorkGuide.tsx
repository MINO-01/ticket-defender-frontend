import type { ReactNode } from 'react'
import { Card } from './Card'
import styles from './WorkGuide.module.css'

// 주요 관리자 화면 상단의 업무 안내다. 서버 응답으로 확인한 사실, 아직 확인되지 않은 내용, 다음 작업을 나눠 보여 준다.
// 확인한 사실에는 현재 화면이 받은 서버 응답에서 나온 내용만 넣는다. 추정이나 판정은 넣지 않는다.

export type GuideItem = { key: string; content: ReactNode }

export function WorkGuide({ title = '조사 진행 요약', confirmed, unconfirmed, next }: {
  title?: string
  confirmed: GuideItem[]
  unconfirmed: GuideItem[]
  next: GuideItem[]
}) {
  return <Card className={styles.guide} aria-label={title}>
    <h2 className={styles.title}>{title}</h2>
    <div className={styles.columns}>
      <GuideColumn heading="확인한 사실" tone="confirmed" items={confirmed} empty="서버가 확인해 준 사실이 아직 없습니다." />
      <GuideColumn heading="아직 확인되지 않은 내용" tone="unconfirmed" items={unconfirmed} empty="이 화면 기준으로 남은 미확인 항목이 없습니다." />
      <GuideColumn heading="다음 작업" tone="next" items={next} empty="이 화면에서 바로 할 작업이 없습니다." />
    </div>
  </Card>
}

function GuideColumn({ heading, tone, items, empty }: { heading: string; tone: 'confirmed' | 'unconfirmed' | 'next'; items: GuideItem[]; empty: string }) {
  return <section className={`${styles.column} ${styles[tone]}`} aria-label={heading}>
    <h3>{heading}</h3>
    {items.length === 0 ? <p className={styles.empty}>{empty}</p> : <ul>{items.map((item) => <li key={item.key}>{item.content}</li>)}</ul>}
  </section>
}

/** 업무 단계 이동 막대다. 각 단계는 같은 화면의 영역으로 이동하며 단계 상태는 호출한 쪽이 서버 응답에서만 계산해 넘긴다. */
export function StepNav({ label, steps }: { label: string; steps: { key: string; title: string; href: string; status: string }[] }) {
  return <nav className={styles.steps} aria-label={label}>
    <ol>
      {steps.map((step, index) => <li key={step.key}>
        <a href={step.href}><span className={styles.stepNo}>{index + 1}</span><span><strong>{step.title}</strong><small>{step.status}</small></span></a>
      </li>)}
    </ol>
  </nav>
}

/** UUID, revision, digest 같은 기술 정보를 기본으로 접어 두는 영역이다. 값은 그대로 유지해 감사와 문의에 쓸 수 있게 한다. */
export function TechnicalDetails({ children, summary = '기술 상세 (ID, 버전, 무결성 값)' }: { children: ReactNode; summary?: string }) {
  return <details className={styles.technical}>
    <summary>{summary}</summary>
    <div className={styles.technicalBody}>{children}</div>
  </details>
}
