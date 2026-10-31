import { afterEach, beforeEach, vi } from 'vitest'

/** 합성 데이터 관리자 화면 회귀 검증은 개발 전용 미리보기 플래그를 켠 상태에서만 수행한다. 인증 세션은 만들지 않는다. */
export function enableAdminDemoPreview() {
  beforeEach(() => vi.stubEnv('VITE_ADMIN_DEMO_PREVIEW', 'true'))
  afterEach(() => vi.unstubAllEnvs())
}
