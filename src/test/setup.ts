import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// CI 부하에서 폼 검증 후 화면 전환을 기다릴 수 있도록 비동기 조회 대기 시간을 늘린다.
configure({ asyncUtilTimeout: 5000 })

afterEach(cleanup)
