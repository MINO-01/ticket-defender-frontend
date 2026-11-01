import { lazy } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/common/Feedback'
import { useAdminAuth } from '../admin-auth/AdminAuthProvider'
import { InvalidClusterAddress, LiveClusterDetailPage } from './LiveClusterDetailPage'
import { LiveClusterListPage } from './LiveClusterListPage'
import styles from './Track1.module.css'

// 합성 데모 화면과 그래프 라이브러리는 미리보기에서만 불러와 인증 세션의 실제 화면 번들에 포함하지 않는다.
const ClusterListPage = lazy(() => import('./ClusterListPage').then((module) => ({ default: module.ClusterListPage })))
const ClusterDetailPage = lazy(() => import('./ClusterDetailPage').then((module) => ({ default: module.ClusterDetailPage })))

// 인증 세션에서는 실제 API 화면만, 개발 전용 미리보기에서는 합성 데모 화면만 연다.
// 두 데이터 출처를 한 화면에 섞지 않으며, 인증 세션에서 데모 데이터를 업무 데이터처럼 표시하지 않는다.

export function Track1ListRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <ClusterListPage /> : <LiveClusterListPage />
}

/** 실제 상세 주소. 개발 미리보기에서는 실제 API를 호출하지 않는다. */
export function Track1DetailRoute() {
  const { state } = useAdminAuth()
  if (state.status !== 'preview') return <LiveClusterDetailPage />
  return <div className={styles.page}>
    <EmptyState title="미리보기에서는 실제 군집을 조회하지 않습니다" description="개발 전용 합성 데이터 미리보기는 인증 세션이 아니어서 관리자 API를 호출하지 않습니다." />
    <Link className={styles.detailLink} to="/app/analysis/findings">군집 목록으로 돌아가기</Link>
  </div>
}

/** 합성 데모 군집 ID 주소. 인증 세션에서는 실제 군집을 특정할 수 없으므로 주소 오류로 처리한다. */
export function Track1DemoDetailRoute() {
  const { state } = useAdminAuth()
  return state.status === 'preview' ? <ClusterDetailPage /> : <InvalidClusterAddress />
}
